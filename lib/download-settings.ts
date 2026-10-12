const DB_NAME = "clipmeme_settings";
const DB_VERSION = 1;
const STORE = "kv";
const KEY_DIR = "download_dir";

function openSettingsDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getDownloadDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openSettingsDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY_DIR);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function setDownloadDir(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openSettingsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, KEY_DIR);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearDownloadDir(): Promise<void> {
  const db = await openSettingsDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY_DIR);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Returns true if the handle still has (or was granted) readwrite permission. */
export async function verifyDirPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const h = handle as any;
    const status = await h.queryPermission({ mode: "readwrite" });
    if (status === "granted") return true;
    const requested = await h.requestPermission({ mode: "readwrite" });
    return requested === "granted";
  } catch {
    return false;
  }
}

/** Save blob directly to a directory. Returns true on success. */
export async function saveToDir(
  handle: FileSystemDirectoryHandle,
  filename: string,
  blob: Blob
): Promise<boolean> {
  try {
    const fileHandle = await handle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Download a blob: tries the stored directory first, falls back to <a download>.
 * Returns the object URL (caller should revoke it when done if they created it).
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const handle = await getDownloadDir();
  if (handle) {
    const ok = await verifyDirPermission(handle);
    if (ok) {
      const saved = await saveToDir(handle, filename, blob);
      if (saved) return;
      // Permission revoked or write failed — fall through to browser download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const supportsFilePicker = typeof window !== "undefined" && "showDirectoryPicker" in window;
