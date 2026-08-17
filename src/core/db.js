const DB_NAME = "fpl_cache";
const DB_VERSION = 1;
const STORES = [
  "meta",
  "players",
  "teams",
  "gameweeks",
  "positions",
  "fixtures",
  "player_gw_stats",
];

let dbp = null;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: "id" });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(db, store, mode = "readonly") {
  return db.transaction(store, mode).objectStore(store);
}

export async function putAll(store, items, keyPath = "id") {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const txs = db.transaction(store, "readwrite");
    const os = txs.objectStore(store);
    os.clear();
    for (const it of items) {
      os.put(it);
    }
    txs.oncomplete = () => resolve(items.length);
    txs.onerror = () => reject(txs.error);
    void keyPath;
  });
}

export async function getAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const os = tx(db, store);
    const r = os.getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  });
}

export async function get(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = tx(db, store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function put(store, item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store, "readwrite").objectStore(store).put(item);
    r.onsuccess = () => resolve(item);
    r.onerror = () => reject(r.error);
  });
}

export async function setMeta(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db
      .transaction("meta", "readwrite")
      .objectStore("meta")
      .put({ id: key, value });
    r.onsuccess = () => resolve(value);
    r.onerror = () => reject(r.error);
  });
}

export async function getMeta(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = tx(db, "meta").get(key);
    r.onsuccess = () => resolve(r.result ? r.result.value : null);
    r.onerror = () => reject(r.error);
  });
}

export async function bulkPutStats(stats) {
  if (!stats.length) return 0;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const txs = db.transaction("player_gw_stats", "readwrite");
    const os = txs.objectStore("player_gw_stats");
    for (const s of stats) os.put(s);
    txs.oncomplete = () => resolve(stats.length);
    txs.onerror = () => reject(txs.error);
  });
}
