const DB_NAME = "clipmeme";
const DB_VERSION = 2;
// Keep legacy ownerless records untouched, but never assign them to a new login.
const STORE = "source_clips_by_owner";
const MAX_CLIPS = 10;

export interface StoredSourceClip {
  userId: string;
  id: string;        // 32-char hex clipId
  blob: Blob;
  title: string;
  thumbnail: string; // base64 data URL, "" until video loads
  duration: number;  // 0 until video loads
  savedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: ["userId", "id"] });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSourceClip(clip: StoredSourceClip): Promise<void> {
  if (!clip.userId) throw new Error("Sign in to save source clips");
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put(clip);
    // Evict oldest when over limit
    store.getAll().addEventListener("success", (e) => {
      const all = ((e.target as IDBRequest).result as StoredSourceClip[]).filter(item => item.userId === clip.userId)
        .sort((a, b) => a.savedAt - b.savedAt);
      while (all.length > MAX_CLIPS) store.delete([clip.userId, all.shift()!.id]);
    });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function updateSourceClipMeta(id: string, thumbnail: string, duration: number, userId: string): Promise<void> {
  if (!userId) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.get([userId, id]);
    req.onsuccess = () => {
      const clip = req.result as StoredSourceClip | undefined;
      if (clip) store.put({ ...clip, thumbnail, duration });
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getSourceClip(id: string, userId: string): Promise<StoredSourceClip | undefined> {
  if (!userId) return undefined;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get([userId, id]);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function listSourceClips(userId: string): Promise<StoredSourceClip[]> {
  if (!userId) return [];
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () =>
      resolve((req.result as StoredSourceClip[]).filter(clip => clip.userId === userId).sort((a, b) => b.savedAt - a.savedAt));
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function deleteSourceClip(id: string, userId: string): Promise<void> {
  if (!userId) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete([userId, id]);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
