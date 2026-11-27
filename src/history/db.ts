// Small IndexedDB wrapper for saved sessions (falls back to memory when IndexedDB is unavailable,
// e.g. some private windows — sessions then last until the page closes).
const DB = 'climbpose', STORE = 'sessions', VERSION = 1;
let dbp: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, unknown>();

function open(): Promise<IDBDatabase | null> {
  if (!dbp) dbp = new Promise((res) => {
    if (typeof indexedDB === 'undefined') { res(null); return; }
    const rq = indexedDB.open(DB, VERSION);
    rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE, { keyPath: 'id' }); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => res(null);
  });
  return dbp;
}

const done = <T>(rq: IDBRequest<T>) => new Promise<T>((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });

export async function dbAll<T>(): Promise<T[]> {
  const db = await open();
  if (!db) return [...memory.values()] as T[];
  return done(db.transaction(STORE).objectStore(STORE).getAll()) as Promise<T[]>;
}
export async function dbPut<T extends { id: string }>(v: T): Promise<void> {
  const db = await open();
  if (!db) { memory.set(v.id, v); return; }
  await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put(v));
}
export async function dbDelete(id: string): Promise<void> {
  const db = await open();
  if (!db) { memory.delete(id); return; }
  await done(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id));
}
