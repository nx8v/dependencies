/**
 * Storage — pengelolaan penyimpanan berbasis perintah JSON.
 *
 * Empat driver, satu bentuk perintah, satu bentuk balasan:
 *
 *   import { storage, indexeDB, sqlite, mysql, postgreSQL, firebase } from "/storage";
 *   //        │        │         │      │         │            └── Firebase Realtime DB
 *   //        │        │         │      │         └─────────────── PostgreSQL (config.json di folder postgreSQL)
 *   //        │        │         │      └───────────────────────── MySQL (config.json di folder mysql)
 *   //        │        │         └──────────────────────────────── SQLite (sqlite/data.db)
 *   //        │        └────────────────────────────────────────── IndexedDB
 *   //        └─────────────────────────────────────────────────── localStorage
 *
 * Semua op mengembalikan Promise dan membalas:
 *   { ok: true,  data, meta }
 *   { ok: false, error, hint }
 *
 * Dokumentasi lengkap: ./README.md
 */

import { localstorage } from "./localstorage/index.js?v=3";
import { indexeDB as indexeDBDriver } from "./indexeDB/index.js?v=3";
import { sqlite as sqliteDriver } from "./sqlite/index.js?v=4";
import { firebase as firebaseDriver } from "./firebase/index.js?v=8";
import { mysql as mysqlDriver } from "./mysql/index.js?v=4";
import { postgreSQL as postgreSQLDriver } from "./postgreSQL/index.js?v=4";
import "./engine.js?v=5";

const MODULE_PREFIX = "nx";
const DEFAULT_NAMESPACE = "default";

/* ------------------------------------------------------------------ */
/* Daftar op                                                           */
/* ------------------------------------------------------------------ */

const ALIAS = {
  put: "set",
  upsert: "set",
  del: "remove",
  find: "select",
  query: "select",
  list: "keys",
};

// op yang hanya butuh driver (tidak butuh table)
const OPS_NO_TABLE = new Set([
  "tables", "export", "import", "info",
  "show_tables", "tx", "migrate", "migration_status",
]);

const KNOWN_OPS = new Set([
  "set", "get", "update", "remove", "delete", "has",
  "insert", "select", "keys", "tables", "count", "search",
  "clear", "export", "import", "info",
  "sql", "create_table", "show_tables", "create_index", "drop_table",
  "join", "tx",
  "add_column", "drop_column", "rename_column", "rename_table",
  "create_migration", "migrate", "migration_status",
  "config",
]);

/* ------------------------------------------------------------------ */
/* Utilitas                                                            */
/* ------------------------------------------------------------------ */

const now = () =>
  typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();

const fail = (error, hint) => ({ ok: false, error, hint });

const ok = (data, meta = {}) => ({ ok: true, data, meta });

/** Balasan sukses dengan pengukur waktu */
function timed(started, data, meta = {}) {
  return ok(data, { ...meta, ms: Math.round(now() - started) });
}

/** Key acak untuk op insert tanpa key */
function autoKey() {
  return "k-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

/** Buang ":" dari nama karena dipakai sebagai pemisah key fisik */
function safeName(v) {
  return String(v).replace(/:/g, "-");
}

function physicalKey(namespace, table, key) {
  return `${MODULE_PREFIX}:${namespace}:${safeName(table)}:${safeName(key)}`;
}

function tablePrefix(namespace, table) {
  return `${MODULE_PREFIX}:${namespace}:${safeName(table)}:`;
}

function namespacePrefix(namespace) {
  return `${MODULE_PREFIX}:${namespace}:`;
}

/**
 * Pecah key fisik kembali menjadi { table, key }.
 * Contoh: "nx:default:users:budi" -> { table:"users", key:"budi" }
 * Table boleh bersarang ("users/aktif"), key tidak boleh mengandung ":".
 */
function parsePhysical(fullKey, namespace) {
  const rest = String(fullKey).slice(namespacePrefix(namespace).length);
  const at = rest.lastIndexOf(":");
  if (at < 0) return { table: rest, key: "" };
  return { table: rest.slice(0, at), key: rest.slice(at + 1) };
}

/** Samakan bentuk perintah: dukung gaya tabel dan gaya path */
function normalize(cmd) {
  if (cmd === null || typeof cmd !== "object" || Array.isArray(cmd)) {
    return { error: fail("bad_request", "Perintah harus berupa objek, contoh: { op: 'get', table: 'users', key: 'budi' }") };
  }

  const rawOp = cmd.op;
  if (typeof rawOp !== "string" || !rawOp.trim()) {
    return { error: fail("bad_request", "Field 'op' wajib diisi, contoh: 'set', 'get', 'select'") };
  }

  const op = ALIAS[rawOp.toLowerCase()] || rawOp.toLowerCase();
  if (!KNOWN_OPS.has(op)) {
    return { error: fail("unknown_op", `op "${rawOp}" tidak dikenal. Yang tersedia: ${[...KNOWN_OPS].join(", ")}`) };
  }

  let table = cmd.table;
  let key = cmd.key ?? cmd.id;

  // Gaya path: "/users/budi" -> table "users", key "budi"
  if ((table === undefined || table === null || table === "") && typeof cmd.path === "string") {
    const parts = cmd.path.split("/").filter(Boolean);
    if (parts.length === 1) {
      table = parts[0];
    } else if (parts.length > 1) {
      key = parts[parts.length - 1];
      table = parts.slice(0, -1).join("/");
    }
  }

  if (table !== undefined && table !== null && table !== "") {
    if (typeof table !== "string" && typeof table !== "number") {
      return { error: fail("bad_request", "Field 'table' harus berupa teks") };
    }
    table = String(table);
  } else {
    table = undefined;
  }

  if (key !== undefined && key !== null && key !== "") {
    key = String(key);
  } else {
    key = undefined;
  }

  return {
    cmd: {
      ...cmd,
      op,
      table,
      key,
      data: cmd.data !== undefined ? cmd.data : cmd.value,
      all: cmd.all === true,
      namespace: typeof cmd.namespace === "string" && cmd.namespace ? cmd.namespace : undefined,
      q: cmd.q,
      params: Array.isArray(cmd.params) ? cmd.params : [],
    },
  };
}

/** Cocokkan satu nilai dengan objek where */
function matchWhere(value, where) {
  if (where === undefined || where === null) return true;
  if (typeof where !== "object") return true;

  for (const [field, cond] of Object.entries(where)) {
    const actual = value == null ? undefined : value[field];

    // Kondisi sederhana: { umur: 30 }
    if (cond === null || typeof cond !== "object" || Array.isArray(cond)) {
      if (Array.isArray(cond)) {
        if (!cond.includes(actual)) return false;
        continue;
      }
      if (actual !== cond) return false;
      continue;
    }

    // Kondisi ber-operator: { umur: { ">": 20 } }
    for (const [op, expected] of Object.entries(cond)) {
      switch (op) {
        case "=":
        case "eq":
          if (actual !== expected) return false;
          break;
        case "!=":
        case "ne":
          if (actual === expected) return false;
          break;
        case ">":
          if (!(actual > expected)) return false;
          break;
        case ">=":
          if (!(actual >= expected)) return false;
          break;
        case "<":
          if (!(actual < expected)) return false;
          break;
        case "<=":
          if (!(actual <= expected)) return false;
          break;
        case "like": {
          if (actual == null) return false;
          const pattern = String(expected)
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            .replace(/%/g, ".*")
            .replace(/_/g, ".");
          if (!new RegExp("^" + pattern + "$", "i").test(String(actual))) return false;
          break;
        }
        case "in":
          if (!Array.isArray(expected) || !expected.includes(actual)) return false;
          break;
        case "between": {
          if (!Array.isArray(expected) || expected.length !== 2) return false;
          if (!(actual >= expected[0] && actual <= expected[1])) return false;
          break;
        }
        case "null":
          if (expected === true ? actual != null : actual == null) return false;
          break;
        default:
          return false;
      }
    }
  }
  return true;
}

const DOCUMENT_OPS = new Set([
  "insert", "update", "delete", "remove", "select",
  "join", "tx", "tables", "show_tables",
  "create_table", "create_index", "drop_table",
  "add_column", "drop_column", "rename_column", "rename_table",
  "create_migration", "migrate", "migration_status",
]);

function usesDocument(op) {
  return DOCUMENT_OPS.has(op);
}

async function runDocument(driver, cmd, namespace, started) {
  const fullKeys = await driver.keys(namespacePrefix(namespace));
  const seed = {};
  for (const fullKey of fullKeys) {
    const parsed = parsePhysical(fullKey, namespace);
    const value = await driver.getItem(fullKey);
    if (!seed[parsed.table]) seed[parsed.table] = [];
    seed[parsed.table].push({ key: parsed.key, value });
  }
  const store = globalThis.NxSintaks.memory(seed);
  let hasil;
  try {
    hasil = globalThis.NxSintaks.apply(store, cmd, driver.name);
  } catch (e) {
    return fail("driver_unavailable", `${driver.name}: ${e?.message || e}`);
  }
  if (hasil && hasil.ok) {
    const after = store.dump();
    const names = new Set([...Object.keys(seed), ...Object.keys(after)]);
    for (const table of names) {
      const next = new Map((after[table] || []).map((r) => [String(r.id), r]));
      const prevList = seed[table] || [];
      const prev = new Map(prevList.map((r) => [String(r.key), r.value]));
      for (const [id, row] of next) {
        const obj = { ...row };
        delete obj.id;
        if (JSON.stringify(prev.get(id)) !== JSON.stringify(obj)) {
          await driver.setItem(physicalKey(namespace, table, id), obj);
        }
      }
      for (const [id] of prev) {
        if (!next.has(id)) await driver.removeItem(physicalKey(namespace, table, id));
      }
    }
  }
  if (hasil && hasil.meta) hasil.meta.ms = Math.round(now() - started);
  return hasil;
}

/* ------------------------------------------------------------------ */
/* Pembuat API untuk satu driver                                       */
/* ------------------------------------------------------------------ */

function createAPI(driver) {
  /** Ambil semua { key, value } dalam satu table */
  async function readTable(namespace, table) {
    const fullKeys = await driver.keys(tablePrefix(namespace, table));
    const rows = [];
    for (const fullKey of fullKeys) {
      const value = await driver.getItem(fullKey);
      const { key } = parsePhysical(fullKey, namespace);
      rows.push({ key, value });
    }
    return rows;
  }

  async function run(cmd, namespace) {
    const started = now();
    const { op, table, key } = cmd;

    if (op === "config") {
      if (typeof driver.config !== "function") {
        return fail(
          "unknown_op",
          `op "config" hanya untuk driver firebase, mysql, postgreSQL, dan sqlite`
        );
      }
      if (cmd.data === undefined || cmd.data === null) {
        return timed(
          started,
          { configured: driver.configured(), config: driver.config() },
          { driver: driver.name }
        );
      }
      driver.config(cmd.data);
      return timed(
        started,
        { configured: driver.configured() },
        { driver: driver.name }
      );
    }

    // mysql, postgreSQL, sqlite, dan firebase: perintah dikerjakan server.
    if (typeof driver.forward === "function") {
      return await driver.forward(cmd, namespace, started);
    }

    if ((driver.name === "localstorage" || driver.name === "indexeDB") && usesDocument(op)) {
      return await runDocument(driver, cmd, namespace, started);
    }

    // --- op yang tidak butuh table ---
    if (op === "tables") {
      const fullKeys = await driver.keys(namespacePrefix(namespace));
      const seen = new Set();
      for (const fullKey of fullKeys) {
        seen.add(parsePhysical(fullKey, namespace).table);
      }
      const tables = [...seen].sort();
      return timed(started, tables, { count: tables.length, driver: driver.name });
    }

    if (op === "export") {
      const fullKeys = await driver.keys(namespacePrefix(namespace));
      const data = {};
      for (const fullKey of fullKeys) {
        const { table: t, key: k } = parsePhysical(fullKey, namespace);
        data[t] = data[t] || {};
        data[t][k] = await driver.getItem(fullKey);
      }
      return timed(started, { namespace, data }, { driver: driver.name });
    }

    if (op === "import") {
      const payload = cmd.data;
      if (!payload || typeof payload !== "object") {
        return fail("bad_request", "import butuh 'data' hasil export: { namespace, data: { table: { key: nilai } } }");
      }
      const source = payload.data && typeof payload.data === "object" ? payload.data : payload;
      let written = 0;
      for (const [t, rows] of Object.entries(source)) {
        if (!rows || typeof rows !== "object") continue;
        for (const [k, v] of Object.entries(rows)) {
          await driver.setItem(physicalKey(namespace, t, k), v);
          written++;
        }
      }
      return timed(started, { written }, { count: written, driver: driver.name });
    }

    if (op === "info") {
      const bytes = await driver.byteSize();
      const fullKeys = await driver.keys(namespacePrefix(namespace));
      const tables = new Set(fullKeys.map((f) => parsePhysical(f, namespace).table));
      return timed(
        started,
        {
          driver: driver.name,
          available: driver.available(),
          namespace,
          tables: tables.size,
          records: fullKeys.length,
          bytes,
        },
        { driver: driver.name }
      );
    }

    // --- op khusus sqlite lokal (sql.js). Driver sqlite sekarang lewat server. ---
    if (op === "sql" || op === "create_table") {
      if (typeof driver.raw !== "function") {
        return fail("unknown_op", `op "${op}" hanya untuk driver sqlite. Import { sqlite } dari "/storage"`);
      }
      return await driver.raw(cmd, started);
    }

    // --- mulai sini semua op butuh table ---
    // --- op yang butuh table ATAU flag all ---
    if (!table && !(op === "clear" && cmd.all)) {
      if (op === "clear") {
        return fail(
          "no_table",
          "clear butuh 'table' untuk menghapus satu table, atau all:true untuk menghapus SEMUA data di namespace ini"
        );
      }
      return fail("no_table", "Field 'table' wajib diisi, contoh: { op: 'select', table: 'users' }");
    }

    switch (op) {
      case "set": {
        if (!key) {
          return fail("bad_request", "op 'set' butuh 'key'. Untuk key otomatis, pakai op 'insert'");
        }
        await driver.setItem(physicalKey(namespace, table, key), cmd.data ?? null);
        return timed(started, cmd.data ?? null, { key, driver: driver.name });
      }

      case "get": {
        if (!key) {
          return fail("bad_request", "op 'get' butuh 'key'");
        }
        const value = await driver.getItem(physicalKey(namespace, table, key));
        if (value === undefined) {
          return fail("not_found", `Record ${table}/${key} tidak ada`);
        }
        return timed(started, value, { key, driver: driver.name });
      }

      case "has": {
        if (!key) {
          return fail("bad_request", "op 'has' butuh 'key'");
        }
        const value = await driver.getItem(physicalKey(namespace, table, key));
        return timed(started, value !== undefined, { key, driver: driver.name });
      }

      case "insert": {
        const newKey = key || autoKey();
        await driver.setItem(physicalKey(namespace, table, newKey), cmd.data ?? null);
        return timed(started, cmd.data ?? null, { key: newKey, count: 1, driver: driver.name });
      }

      case "update": {
        // Satu record
        if (key) {
          const existing = await driver.getItem(physicalKey(namespace, table, key));
          if (existing === undefined) {
            return fail("not_found", `Record ${table}/${key} tidak ada`);
          }
          const base = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
          const merged = { ...base, ...(cmd.data || {}) };
          await driver.setItem(physicalKey(namespace, table, key), merged);
          return timed(started, merged, { key, count: 1, driver: driver.name });
        }

        // Massal: wajib where atau all:true
        if (!cmd.where && !cmd.all) {
          return fail("no_where", "update massal tanpa 'where' ditolak. Sertakan where, atau all:true bila memang semua");
        }

        const rows = await readTable(namespace, table);
        let affected = 0;
        for (const row of rows) {
          if (!cmd.all && !matchWhere(row.value, cmd.where)) continue;
          const base = row.value && typeof row.value === "object" && !Array.isArray(row.value) ? row.value : {};
          const merged = { ...base, ...(cmd.data || {}) };
          await driver.setItem(physicalKey(namespace, table, row.key), merged);
          affected++;
        }
        return timed(started, null, { count: affected, driver: driver.name });
      }

      case "delete":
      case "remove": {
        // Satu record
        if (key) {
          const existed = await driver.removeItem(physicalKey(namespace, table, key));
          if (!existed) {
            return fail("not_found", `Record ${table}/${key} tidak ada`);
          }
          return timed(started, null, { key, count: 1, driver: driver.name });
        }

        // Massal
        if (!cmd.where && !cmd.all) {
          return fail("no_where", "remove massal tanpa 'where' ditolak. Sertakan where, atau all:true bila memang semua");
        }

        const rows = await readTable(namespace, table);
        let deleted = 0;
        for (const row of rows) {
          if (!cmd.all && !matchWhere(row.value, cmd.where)) continue;
          await driver.removeItem(physicalKey(namespace, table, row.key));
          deleted++;
        }
        return timed(started, null, { count: deleted, driver: driver.name });
      }

      case "select": {
        const rows = await readTable(namespace, table);
        let out = rows
          .filter((r) => matchWhere(r.value, cmd.where))
          .map((r) => {
            // Sertakan key agar hasil bisa dilacak
            if (r.value && typeof r.value === "object" && !Array.isArray(r.value)) {
              return { id: r.key, ...r.value };
            }
            return { id: r.key, value: r.value };
          });
        return timed(started, out, { count: out.length, driver: driver.name });
      }

      case "keys": {
        const fullKeys = await driver.keys(tablePrefix(namespace, table));
        const keys = fullKeys.map((f) => parsePhysical(f, namespace).key).sort();
        return timed(started, keys, { count: keys.length, driver: driver.name });
      }

      case "count": {
        const fullKeys = await driver.keys(tablePrefix(namespace, table));
        return timed(started, fullKeys.length, { count: fullKeys.length, driver: driver.name });
      }

      case "search": {
        const q = String(cmd.q ?? "").trim().toLowerCase();
        if (!q) {
          return fail("bad_request", "op 'search' butuh 'q', contoh: { op:'search', table:'users', q:'budi' }");
        }
        const rows = await readTable(namespace, table);
        const out = rows
          .filter((r) => {
            let text = "";
            try {
              text = JSON.stringify(r.value);
            } catch {
              text = String(r.value);
            }
            return text.toLowerCase().includes(q);
          })
          .map((r) =>
            r.value && typeof r.value === "object" && !Array.isArray(r.value)
              ? { id: r.key, ...r.value }
              : { id: r.key, value: r.value }
          );
        return timed(started, out, { count: out.length, driver: driver.name });
      }

      case "clear": {
        if (!table && cmd.all) {
          // Hapus SEMUA data pada namespace ini
          const removed = await driver.clearPrefix(namespacePrefix(namespace));
          return timed(started, { removed }, { count: removed, driver: driver.name });
        }
        const removed = await driver.clearPrefix(tablePrefix(namespace, table));
        return timed(started, { removed }, { count: removed, driver: driver.name });
      }

      default:
        return fail("unknown_op", `op "${op}" belum didukung driver ${driver.name}`);
    }
  }

  /**
   * API utama: bisa dipanggil sebagai fungsi dengan perintah JSON,
   * sekaligus punya method ringkas.
   */
  const api = async function storage(input, options = {}) {
    // Izinkan pemanggilan dengan string JSON mentah
    let cmdInput = input;
    if (typeof cmdInput === "string") {
      try {
        cmdInput = JSON.parse(cmdInput);
      } catch {
        return fail("bad_request", "String perintah bukan JSON valid");
      }
    }

    const normalized = normalize(cmdInput);
    if (normalized.error) return normalized.error;

    const namespace =
      normalized.cmd.namespace || options.namespace || DEFAULT_NAMESPACE;

    // op "config" harus lolos walau driver belum tersedia — justru itu cara
    // mengonfigurasinya. Untuk driver lain, op ini ditolak di dalam run().
    if (normalized.cmd.op !== "config" && !driver.available()) {
      const hint =
        driver.name === "sqlite"
          ? "SQLite lewat POST /api/storage. Jalankan ulang nx8v bila server.cjs baru."
          : driver.name === "mysql"
          ? "MySQL lewat POST /api/storage. Nama mysql harus ada di modules/storage/config.json, lalu jalankan ulang nx8v."
          : driver.name === "postgreSQL"
          ? "PostgreSQL lewat POST /api/storage. Nama postgreSQL harus ada di modules/storage/config.json, lalu jalankan ulang nx8v."
          : driver.name === "firebase"
          ? "Firebase lewat POST /api/storage. Nama firebase harus ada di modules/storage/config.json, lalu jalankan ulang nx8v."
          : `Driver ${driver.name} tidak tersedia di browser ini`;
      return fail("driver_unavailable", hint);
    }

    try {
      return await run(normalized.cmd, namespace);
    } catch (e) {
      const code = typeof e?.message === "string" ? e.message : "driver_unavailable";
      if (
        [
          "corrupt_data",
          "quota_exceeded",
          "driver_unavailable",
          "sql_error",
          "network_error",
          "config_error",
          "unauthorized",
          "permission_denied",
          "timeout",
          "bad_gateway",
        ].includes(code)
      ) {
        return fail(code, hintFor(code, driver.name));
      }
      return fail("driver_unavailable", `${driver.name}: ${e?.message || e}`);
    }
  };

  /* ---------------- gaya ringkas ---------------- */

  api.set = (table, key, data, options) =>
    api({ op: "set", table, key, data }, options);

  api.get = (table, key, options) =>
    api({ op: "get", table, key }, options);

  api.has = (table, key, options) =>
    api({ op: "has", table, key }, options);

  api.insert = (table, data, options) =>
    api({ op: "insert", table, data }, options);

  api.update = (table, keyOrWhere, data, options) =>
    typeof keyOrWhere === "string"
      ? api({ op: "update", table, key: keyOrWhere, data }, options)
      : api({ op: "update", table, where: keyOrWhere, data }, options);

  api.remove = (table, keyOrWhere, options) =>
    typeof keyOrWhere === "string"
      ? api({ op: "remove", table, key: keyOrWhere }, options)
      : api({ op: "remove", table, where: keyOrWhere }, options);

  api.select = (table, where, options) =>
    api({ op: "select", table, where }, options);

  api.keys = (table, options) => api({ op: "keys", table }, options);
  api.count = (table, options) => api({ op: "count", table }, options);
  api.tables = (options) => api({ op: "tables" }, options);
  api.search = (table, q, options) => api({ op: "search", table, q }, options);
  api.clear = (table, options) => api({ op: "clear", table }, options);
  api.export = (options) => api({ op: "export" }, options);
  api.import = (data, options) => api({ op: "import", data }, options);
  api.info = (options) => api({ op: "info" }, options);

  /**
   * Khusus driver firebase: set konfigurasi secara langsung.
   *   firebase.config({ project: "...", secret: "..." })
   *   firebase.config()  -> konfigurasi aktif
   * Driver lain membalas unknown_op.
   */
  api.config = (data) => api({ op: "config", data });

  // Jejak driver, berguna untuk debugging
  api.driver = driver.name;

  return api;
}

function hintFor(code, driverName) {
  switch (code) {
    case "corrupt_data":
      return "Isi penyimpanan bukan JSON valid. Hapus record bermasalah dengan op 'remove' atau bersihkan dengan 'clear'";
    case "quota_exceeded":
      return `Ruang ${driverName} penuh. Hapus data lama, atau pindah ke driver indexeDB`;
    case "sql_error":
      return "Query SQL gagal. Periksa nama tabel/kolom dan jumlah parameter";
    case "network_error":
      return "Tidak bisa menghubungi server penyimpanan. Periksa nx8v, atau host dan port di config.json";
    case "config_error":
      return "Isi config.json driver ini. Untuk Firebase: project, dan secret bila database dikunci";
    case "unauthorized":
      return "Firebase menolak autentikasi (401). Periksa secret/token";
    case "permission_denied":
      return "Akses ditolak (403). Periksa token/izin di server Anda";
    case "timeout":
      return "Server tidak menjawab dalam batas waktu. Periksa server, atau naikkan config.timeout";
    case "bad_gateway":
      return "Server membalas bukan JSON yang diharapkan. Pastikan endpoint menerima POST JSON dan membalas { ok, data }";
    default:
      return `Driver ${driverName} tidak bisa dipakai di lingkungan ini`;
  }
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

/** Driver default: localStorage */
export const storage = createAPI(localstorage);

/** Driver IndexedDB */
export const indexeDB = createAPI(indexeDBDriver);

/** Driver SQLite — POST /api/storage, berkas data.db di server */
export const sqlite = createAPI(sqliteDriver);

/** Driver Firebase Realtime Database (butuh konfigurasi) */
export const firebase = createAPI(firebaseDriver);

/** Driver MySQL — POST /api/storage, sambungan di modules/storage/mysql/config.json */
export const mysql = createAPI(mysqlDriver);

/** Driver PostgreSQL — POST /api/storage, sambungan di modules/storage/postgreSQL/config.json */
export const postgreSQL = createAPI(postgreSQLDriver);

export default storage;
