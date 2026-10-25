/**
 * Driver localStorage untuk modul storage.
 *
 * Semua method mengembalikan Promise supaya bentuknya sama dengan driver lain
 * (IndexedDB, SQLite). Isi nilai disimpan sebagai JSON string.
 *
 * Kontrak driver (dipakai oleh ../index.js):
 *   name            : string
 *   available()     : boolean
 *   getItem(key)    : Promise<any | undefined>
 *   setItem(key, v) : Promise<void>
 *   removeItem(key) : Promise<boolean>
 *   keys(prefix)    : Promise<string[]>
 *   clearPrefix(p)  : Promise<number>
 *   clearAll()      : Promise<number>
 *   byteSize()      : Promise<number>
 */

const LS = () => globalThis.localStorage;

export const localstorage = {
  name: "localstorage",

  available() {
    try {
      const ls = LS();
      if (!ls) return false;
      const probe = "__nx_storage_probe__";
      ls.setItem(probe, "1");
      ls.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  },

  async getItem(key) {
    const raw = LS().getItem(key);
    if (raw === null || raw === undefined) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      // Isi tidak bisa dibaca: beri tahu pemanggil, jangan diam-diam jadi null
      throw new Error("corrupt_data");
    }
  },

  async setItem(key, value) {
    try {
      LS().setItem(key, JSON.stringify(value));
    } catch (e) {
      const name = e?.name || "";
      if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
        throw new Error("quota_exceeded");
      }
      throw e;
    }
  },

  async removeItem(key) {
    const ls = LS();
    const existed = ls.getItem(key) !== null;
    ls.removeItem(key);
    return existed;
  },

  async keys(prefix) {
    const ls = LS();
    const out = [];
    const n = ls.length;
    for (let i = 0; i < n; i++) {
      const k = ls.key(i);
      if (k !== null && k.startsWith(prefix)) out.push(k);
    }
    return out.sort();
  },

  async clearPrefix(prefix) {
    const ls = LS();
    const found = await this.keys(prefix);
    for (const k of found) ls.removeItem(k);
    return found.length;
  },

  async clearAll() {
    const ls = LS();
    const n = ls.length;
    ls.clear();
    return n;
  },

  async byteSize() {
    const ls = LS();
    let total = 0;
    const n = ls.length;
    for (let i = 0; i < n; i++) {
      const k = ls.key(i);
      if (k === null) continue;
      total += k.length + (ls.getItem(k) || "").length;
    }
    return total;
  },
};

export default localstorage;
