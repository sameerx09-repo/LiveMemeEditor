import { IDBFactory } from "fake-indexeddb";
import type { StoredSourceClip } from "@/lib/clip-db";

// Give each test a fresh in-memory IndexedDB
beforeEach(() => {
  (global as any).indexedDB = new IDBFactory();
});

// Import functions after global is set so they pick up the fresh instance each call
async function getDb() {
  return await import("@/lib/clip-db");
}

function makeClip(id: string, savedAt: number): StoredSourceClip {
  return {
    userId: "alice",
    id,
    blob: new Blob(["fake-video"]),
    title: `Clip ${id}`,
    thumbnail: "",
    duration: 0,
    savedAt,
  };
}

describe("clip-db", () => {
  test("saves and retrieves a clip", async () => {
    const { saveSourceClip, getSourceClip } = await getDb();
    await saveSourceClip(makeClip("aaa", 1000));
    const result = await getSourceClip("aaa", "alice");
    expect(result?.id).toBe("aaa");
    expect(result?.title).toBe("Clip aaa");
  });

  test("getSourceClip returns undefined for unknown id", async () => {
    const { getSourceClip } = await getDb();
    expect(await getSourceClip("nope", "alice")).toBeUndefined();
  });

  test("listSourceClips returns newest-first order", async () => {
    const { saveSourceClip, listSourceClips } = await getDb();
    await saveSourceClip(makeClip("id1", 1000));
    await saveSourceClip(makeClip("id2", 3000));
    await saveSourceClip(makeClip("id3", 2000));
    const list = await listSourceClips("alice");
    expect(list.map((c) => c.id)).toEqual(["id2", "id3", "id1"]);
  });

  test("deleteSourceClip removes the clip", async () => {
    const { saveSourceClip, deleteSourceClip, getSourceClip } = await getDb();
    await saveSourceClip(makeClip("del1", 1000));
    await deleteSourceClip("del1", "alice");
    expect(await getSourceClip("del1", "alice")).toBeUndefined();
  });

  test("updateSourceClipMeta updates thumbnail and duration", async () => {
    const { saveSourceClip, updateSourceClipMeta, getSourceClip } = await getDb();
    await saveSourceClip(makeClip("upd1", 1000));
    await updateSourceClipMeta("upd1", "data:image/jpeg;base64,abc", 12.5, "alice");
    const clip = await getSourceClip("upd1", "alice");
    expect(clip?.thumbnail).toBe("data:image/jpeg;base64,abc");
    expect(clip?.duration).toBe(12.5);
  });

  test("evicts oldest clip when saving more than 10", async () => {
    const { saveSourceClip, listSourceClips } = await getDb();
    // Save 11 clips with ascending savedAt
    for (let i = 1; i <= 11; i++) {
      await saveSourceClip(makeClip(`clip${String(i).padStart(2, "0")}`, i * 1000));
    }
    const list = await listSourceClips("alice");
    expect(list).toHaveLength(10);
    // clip01 (oldest) should be gone
    expect(list.find((c) => c.id === "clip01")).toBeUndefined();
    // clip11 (newest) should still be there
    expect(list.find((c) => c.id === "clip11")).toBeDefined();
  });
});

test("accounts cannot list/read/update/delete each other's clips", async () => {
  const db = await getDb();
  await db.saveSourceClip(makeClip("private", 1000));
  expect(await db.listSourceClips("bob")).toEqual([]);
  expect(await db.getSourceClip("private", "bob")).toBeUndefined();
  await db.updateSourceClipMeta("private", "changed", 99, "bob");
  await db.deleteSourceClip("private", "bob");
  expect((await db.getSourceClip("private", "alice"))?.duration).toBe(0);
});
test("identical clip IDs and eviction are isolated by account", async () => {
  const db = await getDb();
  await db.saveSourceClip({ ...makeClip("same", 1), userId: "bob" });
  for (let i = 0; i < 11; i++) await db.saveSourceClip(makeClip(String(i), i));
  expect(await db.listSourceClips("alice")).toHaveLength(10);
  expect(await db.listSourceClips("bob")).toHaveLength(1);
  expect((await db.getSourceClip("same", "bob"))?.userId).toBe("bob");
});
test("legacy ownerless records survive the upgrade but are not assigned to a login", async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("clipmeme", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("source_clips", { keyPath: "id" });
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("source_clips", "readwrite");
      transaction.objectStore("source_clips").put({ id: "legacy", blob: new Blob(["legacy"]) });
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  });
  const db = await getDb();
  expect(await db.listSourceClips("alice")).toEqual([]);
  expect(await db.listSourceClips("bob")).toEqual([]);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("clipmeme", 2);
    request.onsuccess = () => {
      const database = request.result;
      const get = database.transaction("source_clips").objectStore("source_clips").get("legacy");
      get.onsuccess = () => { expect(get.result.id).toBe("legacy"); database.close(); resolve(); };
      get.onerror = () => reject(get.error);
    };
  });
});
