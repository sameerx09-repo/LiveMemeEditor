import { IDBFactory } from "fake-indexeddb";
import { clearExports, listExports, saveExport, linkScheduledClip, listScheduledClips } from "@/lib/export-history";
import type { ClipHistoryItem } from "@/lib/types";

function clip(id: string, exportedAt = 1): ClipHistoryItem {
  return { id, exportedAt, mode: "clip", aspectRatio: "9:16", thumbnail: "", inPoint: 0, outPoint: 2, duration: 2, overlays: [], exportFileName: `${id}.mp4`, exportUrl: "blob:expired-page-url" };
}

beforeEach(() => { global.indexedDB = new IDBFactory(); });

test("reload restores actual video bytes with a fresh blob URL", async () => {
  await saveExport("alice", clip("one"), new Blob(["rendered-video"], { type: "video/mp4" }));
  const [restored] = await listExports("alice");
  expect(restored.exportUrl).not.toBe("blob:expired-page-url");
  const response = await fetch(restored.exportUrl!);
  expect(await response.text()).toBe("rendered-video");
  expect(restored.exportFileName).toBe("one.mp4");
  URL.revokeObjectURL(restored.exportUrl!);
});

test("history is newest first and isolated per account, including clear", async () => {
  await saveExport("alice", clip("same", 1), new Blob(["alice"]));
  await saveExport("bob", clip("same", 2), new Blob(["bob"]));
  await saveExport("alice", clip("new", 3), new Blob(["new"]));
  const alice = await listExports("alice");
  expect(alice.map(item => item.id)).toEqual(["new", "same"]);
  alice.forEach(item => URL.revokeObjectURL(item.exportUrl!));
  await clearExports("alice");
  expect(await listExports("alice")).toEqual([]);
  const bob = await listExports("bob");
  expect(await (await fetch(bob[0].exportUrl!)).text()).toBe("bob");
  URL.revokeObjectURL(bob[0].exportUrl!);
});

test("saving more than twenty clips does not silently discard local history", async () => {
  for (let i = 0; i < 21; i++) await saveExport("alice", clip(String(i), i), new Blob([String(i)]));
  const items = await listExports("alice");
  expect(items).toHaveLength(21);
  items.forEach(item => URL.revokeObjectURL(item.exportUrl!));
});

test("scheduled clip references persist, are account scoped, and survive history clearing", async () => {
  await saveExport("alice",clip("one"),new Blob(["video"]));
  await linkScheduledClip("alice","post-a",{...clip("one"),thumbnail:"data:image/png;base64,test"});
  expect(await listScheduledClips("bob")).toEqual([]);
  await clearExports("alice");
  expect(await listScheduledClips("alice")).toEqual([{postId:"post-a",clipId:"one",name:"one.mp4",thumbnail:"data:image/png;base64,test"}]);
});

test("upgrading existing history to add links preserves saved videos", async () => {
  await new Promise<void>((resolve,reject) => {
    const request=indexedDB.open("clipmeme_exports",1);
    request.onupgradeneeded=()=>{const store=request.result.createObjectStore("exports",{keyPath:"storageId"});store.createIndex("userId","userId");};
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result;const tx=db.transaction("exports","readwrite");
      tx.objectStore("exports").put({...clip("old"),userId:"alice",storageId:"alice:old",blob:new Blob(["existing-video"])});
      tx.oncomplete=()=>{db.close();resolve();};
    };
  });
  await linkScheduledClip("alice","post-old",clip("old"));
  const [restored]=await listExports("alice");
  expect(await (await fetch(restored.exportUrl!)).text()).toBe("existing-video");
  URL.revokeObjectURL(restored.exportUrl!);
});
