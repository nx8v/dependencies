/**
 * Server contoh untuk driver mysql/ dan postgreSQL/ di modul storage.
 *
 * Ini HANYA contoh cara kerja. Di produksi, ganti bagian "simpan" dengan
 * driver MySQL/PostgreSQL sungguhan (mis. `mysql2` atau `pg` di Node, atau
 * backend apa pun: PHP, Go, Python, NxfireDB, TeritipDB).
 *
 * Kontrak yang diharapkan driver:
 *   POST /query   body: { op, table, key, data, where, namespace, ... }
 *   balas:        { ok: true,  data, meta }
 *                 { ok: false, error, hint }
 *
 * Jalankan:  node modules/storage/mysql/server-contoh.cjs
 */

const http = require("http");

const PORT = Number(process.env.PORT) || 8080;

// "Database" contoh: cukup di memori. Ganti dengan MySQL/PostgreSQL asli.
const tabel = new Map(); // table -> Map(key -> row)
let counter = 0;

function getTable(name) {
  if (!tabel.has(name)) tabel.set(name, new Map());
  return tabel.get(name);
}

function cocok(row, where) {
  if (!where || typeof where !== "object") return true;
  for (const [field, cond] of Object.entries(where)) {
    const val = row[field];
    if (cond === null || typeof cond !== "object") {
      if (val !== cond) return false;
      continue;
    }
    for (const [op, exp] of Object.entries(cond)) {
      if (op === ">" && !(val > exp)) return false;
      else if (op === ">=" && !(val >= exp)) return false;
      else if (op === "<" && !(val < exp)) return false;
      else if (op === "<=" && !(val <= exp)) return false;
      else if (op === "!=" && val === exp) return false;
      else if (op === "in" && !(Array.isArray(exp) && exp.includes(val))) return false;
      else if (op === "like") {
        const re = new RegExp("^" + String(exp).replace(/%/g, ".*").replace(/_/g, ".") + "$", "i");
        if (!re.test(String(val ?? ""))) return false;
      } else if (op === "between" && !(val >= exp[0] && val <= exp[1])) return false;
    }
  }
  return true;
}

function jawab(op, table, key, data, where, all) {
  if (!table) {
    return { ok: false, error: "no_table", hint: "field 'table' wajib diisi" };
  }
  const t = getTable(table);

  switch (op) {
    case "set": {
      if (!key) return { ok: false, error: "bad_request", hint: "set butuh 'key'" };
      t.set(key, data);
      return { ok: true, data, meta: { key, driver: "contoh-server" } };
    }
    case "get": {
      if (!key) return { ok: false, error: "bad_request", hint: "get butuh 'key'" };
      if (!t.has(key)) return { ok: false, error: "not_found", hint: `Record ${table}/${key} tidak ada` };
      return { ok: true, data: t.get(key), meta: { key } };
    }
    case "insert": {
      const k = key || "id-" + ++counter;
      t.set(k, data);
      return { ok: true, data, meta: { key: k, count: 1 } };
    }
    case "select": {
      const rows = [];
      for (const [k, v] of t) {
        if (cocok(v, where)) rows.push({ id: k, ...v });
      }
      return { ok: true, data: rows, meta: { count: rows.length } };
    }
    case "update": {
      if (key) {
        if (!t.has(key)) return { ok: false, error: "not_found", hint: `Record ${table}/${key} tidak ada` };
        const merged = { ...t.get(key), ...data };
        t.set(key, merged);
        return { ok: true, data: merged, meta: { key, count: 1 } };
      }
      if (!where && !all) {
        return { ok: false, error: "no_where", hint: "update massal tanpa 'where' ditolak. Sertakan where, atau all:true" };
      }
      let n = 0;
      for (const [k, v] of t) {
        if (all || cocok(v, where)) { t.set(k, { ...v, ...data }); n++; }
      }
      return { ok: true, data: null, meta: { count: n } };
    }
    case "remove": {
      if (key) {
        if (!t.has(key)) return { ok: false, error: "not_found", hint: `Record ${table}/${key} tidak ada` };
        t.delete(key);
        return { ok: true, data: null, meta: { key, count: 1 } };
      }
      if (!where && !all) {
        return { ok: false, error: "no_where", hint: "remove massal tanpa 'where' ditolak. Sertakan where, atau all:true" };
      }
      let n = 0;
      for (const [k, v] of [...t]) {
        if (all || cocok(v, where)) { t.delete(k); n++; }
      }
      return { ok: true, data: null, meta: { count: n } };
    }
    case "keys":
      return { ok: true, data: [...t.keys()].sort(), meta: { count: t.size } };
    case "count":
      return { ok: true, data: t.size, meta: { count: t.size } };
    case "tables":
      return { ok: true, data: [...tabel.keys()].sort(), meta: { count: tabel.size } };
    case "clear": {
      if (all) {
        const n = t.size;
        t.clear();
        return { ok: true, data: { removed: n }, meta: { count: n } };
      }
      const n = t.size;
      t.clear();
      return { ok: true, data: { removed: n }, meta: { count: n } };
    }
    case "has":
      return { ok: true, data: t.has(key), meta: { key } };
    default:
      return { ok: false, error: "unknown_op", hint: `op "${op}" tidak dikenal server contoh` };
  }
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "bad_request", hint: "gunakan POST" }));
    return;
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let cmd;
    try {
      cmd = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "bad_request", hint: "body bukan JSON" }));
      return;
    }

    const hasil = jawab(
      String(cmd.op || "").toLowerCase(),
      cmd.table,
      cmd.key,
      cmd.data,
      cmd.where,
      cmd.all === true
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(hasil));
  });
});

server.listen(PORT, () => console.log("server contoh (mysql/postgreSQL) di :" + PORT));
