import type { Snapshot } from "./types";
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("pocket-scan", 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore("snapshots", { keyPath: "scope" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
async function transact<T>(
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("snapshots", mode);
    const req = action(tx.objectStore("snapshots"));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export const readSnapshots = () =>
  transact<Snapshot[]>("readonly", (s) => s.getAll());
export const saveSnapshot = (snapshot: Snapshot) =>
  transact("readwrite", (s) => s.put(snapshot));
export const removeSnapshot = (scope: string) =>
  transact("readwrite", (s) => s.delete(scope));
export const clearSnapshots = () => transact("readwrite", (s) => s.clear());
