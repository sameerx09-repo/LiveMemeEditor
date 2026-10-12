import type { ClipHistoryItem } from "./types";

type SavedExport = Omit<ClipHistoryItem, "exportUrl"> & { userId: string; storageId: string; blob: Blob };
export type ScheduledClipLink = { postId: string; clipId: string; name: string; thumbnail: string };
type StoredLink = ScheduledClipLink & { userId: string; storageId: string };

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("clipmeme_exports", 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("exports")) {
        const store = db.createObjectStore("exports", { keyPath: "storageId" });
        store.createIndex("userId", "userId");
      }
      if (!db.objectStoreNames.contains("scheduled_clips")) {
        const store = db.createObjectStore("scheduled_clips", { keyPath: "storageId" });
        store.createIndex("userId", "userId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveExport(userId: string, item: ClipHistoryItem, blob: Blob): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("exports", "readwrite");
      const { exportUrl: _url, ...metadata } = item;
      void _url;
      tx.objectStore("exports").put({ ...metadata, userId, storageId: `${userId}:${item.id}`, blob });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error("Could not save clip to browser storage"));
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function listExports(userId: string): Promise<ClipHistoryItem[]> {
  const db = await openDB();
  try {
    const records = await new Promise<SavedExport[]>((resolve, reject) => {
      const tx = db.transaction("exports", "readonly");
      const request = tx.objectStore("exports").index("userId").getAll(userId);
      let results: SavedExport[] = [];
      request.onsuccess = () => { results = request.result; };
      tx.oncomplete = () => resolve(results);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
    return records.sort((a,b) => b.exportedAt - a.exportedAt).map(({ blob, userId: _user, storageId: _id, ...item }) => {
      void _user; void _id;
      return { ...item, exportUrl: URL.createObjectURL(blob) };
    });
  } finally { db.close(); }
}

export async function clearExports(userId: string): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("exports", "readwrite");
      const store = tx.objectStore("exports");
      const request = store.index("userId").openKeyCursor(userId);
      request.onsuccess = () => { const cursor = request.result; if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); } };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function linkScheduledClip(userId: string, postId: string, clip: ClipHistoryItem): Promise<ScheduledClipLink> {
  const link: ScheduledClipLink = { postId, clipId: clip.id, name: clip.exportFileName || `Clip ${clip.id}`, thumbnail: clip.thumbnail };
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("scheduled_clips", "readwrite");
      tx.objectStore("scheduled_clips").put({ ...link, userId, storageId: `${userId}:${postId}` });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
    return link;
  } finally { db.close(); }
}

export async function listScheduledClips(userId: string): Promise<ScheduledClipLink[]> {
  const db = await openDB();
  try {
    return await new Promise<ScheduledClipLink[]>((resolve, reject) => {
      const tx = db.transaction("scheduled_clips", "readonly");
      const request = tx.objectStore("scheduled_clips").index("userId").getAll(userId);
      let links: StoredLink[] = [];
      request.onsuccess = () => { links = request.result; };
      tx.oncomplete = () => resolve(links.map(({ postId, clipId, name, thumbnail }) => ({ postId, clipId, name, thumbnail })));
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
