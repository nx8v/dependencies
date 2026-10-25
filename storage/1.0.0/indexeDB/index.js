/**
 * Driver IndexedDB untuk modul storage.
 *
 * Semua method mengembalikan Promise. Nilai disimpan apa adanya lewat
 * structured clone (objek, array, Date, Blob, dll) — bukan JSON string.
 *
 * Struktur database:
 *   DB    : "nx-storage"
 *   store : "kv"        key = string, value = bebas
 *   index : "prefix"    (opsional, untuk daftar cepat per prefix)
 *
 * Kontrak driver (sama dengan ../localstorage/index.js):
 *   name, available(), getItem(key), setItem(key, value), removeItem(key),
 *   keys(prefix), clearPrefix(prefix), clearAll(), byteSize()
 */

const DB_NAME = "nx-storage";
const STORE = "kv";
const VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const idb = globalThis.indexedDB;
    if (!idb) {
      reject(new Error("driver_unavailable"));
      return;
    }

    let req;
    try {
      req = idb.open(DB_NAME, VERSION);
    } catch (e) {
      reject(new Error("driver_unavailable"));
      return;
    }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error("driver_unavailable"));
    req.onblocked = () => reject(new Error("driver_unavailable"));
  });

  return dbPromise;
}

function tx(mode, run) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        let t;
        try {
          t = db.transaction(STORE, mode);
        } catch {
          reject(new Error("driver_unavailable"));
          return;
        }
        const store = t.objectStore(STORE);
        let result;

        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error || new Error("driver_unavailable"));
        t.onabort = () => reject(t.error || new Error("driver_unavailable"));

        try {
          result = run(store);
        } catch (e) {
          reject(e);
        }
      })
  );
}

/** Bungkus IDBRequest menjadi Promise */
function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const indexeDB = {
  name: "indexeDB",

  available() {
    return typeof globalThis.indexedDB !== "undefined";
  },

  async getItem(key) {
    return tx("readonly", (store) => wrap(store.get(key)));
  },

  async setItem(key, value) {
    let quota = false;
    try {
      await tx("readwrite", (store) => wrap(store.put(value, key)));
    } catch (e) {
      const name = e?.name || "";
      if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
        quota = true;
      } else {
        throw e;
      }
    }
    if (quota) throw new Error("quota_exceeded");
  },

  async removeItem(key) {
    // Cek dulu supaya bisa melaporkan ada/tidaknya
    const existed = (await this.getItem(key)) !== undefined;
    await tx("readwrite", (store) => wrap(store.delete(key)));
    return existed;
  },

  async keys(prefix) {
    const all = await tx("readonly", (store) => wrap(store.getAllKeys()));
    return all
      .map((k) => String(k))
      .filter((k) => k.startsWith(prefix))
      .sort();
  },

  async clearPrefix(prefix) {
    const found = await this.keys(prefix);
    if (!found.length) return 0;
    await tx("readwrite", (store) => {
      for (const k of found) store.delete(k);
      return found.length;
    });
    return found.length;
  },

  async clearAll() {
    const count = (await tx("readonly", (store) => wrap(store.count()))) || 0;
    await tx("readwrite", (store) => wrap(store.clear()));
    return count;
  },

  async byteSize() {
    // Perkiraan: ukur panjang JSON tiap nilai. Tidak persis seperti kuota asli,
    // tetapi cukup untuk laporan "info".
    const all = await tx("readonly", (store) => wrap(store.getAll()));
    const allKeys = await tx("readonly", (store) => wrap(store.getAllKeys()));
    let total = 0;
    all.forEach((v, i) => {
      total += String(allKeys[i]).length;
      try {
        total += JSON.stringify(v).length;
      } catch {
        total += 0;
      }
    });
    return total;
  },
};

export default indexeDB;
