/**
 * POST /api/upload
 * Bidang multipart "file" disimpan di modules/upload/out/<tahun>/<bulan>
 * dengan nama baru. Pemiliknya adalah akun yang sedang masuk.
 * Nama asli pengirim tidak dipakai sebagai path.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const oauth = require("../oauth/server.cjs");

const MAX = 2 * 1024 * 1024;
const TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
};
const fileDb = process.env.NX8V_UPLOAD_FILE || path.join(__dirname, "vault");
let db = null;

function send(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function hex(size) {
  const buf = crypto.randomBytes(size);
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    const n = buf[i];
    out += (n < 16 ? "0" : "") + n.toString(16);
  }
  return out;
}

function extOf(filename) {
  const base = path.basename(String(filename || ""));
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

function period(now) {
  const date = now || new Date();
  const year = String(date.getFullYear());
  let month = String(date.getMonth() + 1);
  if (month.length < 2) month = "0" + month;
  return { year: year, month: month };
}

function choose(file) {
  const type = String(file.type || "").toLowerCase();
  if (TYPES[type]) return { type, ext: TYPES[type] };
  const ext = extOf(file.filename);
  if (ext === "jpg" || ext === "jpeg") return { type: "image/jpeg", ext: "jpg" };
  for (const key of Object.keys(TYPES)) {
    if (TYPES[key] === ext) return { type: key, ext };
  }
  return null;
}

function open() {
  if (db) return db;
  const dbmod = require("db");
  db = dbmod.open({ driver: "sqlite", file: fileDb });
  db.exec(
    "CREATE TABLE IF NOT EXISTS upload_file (" +
      "name TEXT PRIMARY KEY, folder TEXT NOT NULL, owner TEXT NOT NULL, " +
      "type TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL)"
  );
  return db;
}

function signed(req, res, method, clean) {
  const user = oauth.account(req);
  if (user) return user;
  send(res, 401, { ok: false, error: "unauthorized", hint: "masuk dulu di /oauth" });
  console.log(method, clean, 401);
  return null;
}

function safeFolder(value) {
  const folder = String(value || "");
  return /^\d{4}\/(0[1-9]|1[0-2])$/.test(folder) ? folder : "";
}

function safeName(value) {
  const name = String(value || "");
  return /^[a-f0-9]{32}\.(png|jpg|webp|gif|pdf|txt|csv)$/.test(name) ? name : "";
}

function rowOut(row) {
  return {
    name: row.name,
    folder: row.folder,
    url: "/" + row.folder + "/" + row.name,
    type: row.type,
    size: Number(row.size) || 0,
  };
}

function listOf(owner, folder) {
  const sql = open();
  const rows = folder
    ? sql.all(
      "SELECT name, folder, type, size FROM upload_file WHERE owner = ? AND folder = ? ORDER BY created_at DESC",
      [owner, folder]
    )
    : sql.all(
      "SELECT name, folder, type, size FROM upload_file WHERE owner = ? ORDER BY folder DESC, created_at DESC",
      [owner]
    );
  const files = [];
  for (const row of rows) files.push(rowOut(row));
  return files;
}

function removeFile(owner, folder, name) {
  const sql = open();
  const row = sql.get(
    "SELECT name, folder FROM upload_file WHERE owner = ? AND folder = ? AND name = ?",
    [owner, folder, name]
  );
  if (!row) return false;
  const parts = folder.split("/");
  const dir = path.join(__dirname, "out", parts[0], parts[1]);
  const dest = path.join(dir, name);
  if (path.dirname(dest) === dir) {
    try { fs.unlinkSync(dest); } catch (e) {}
  }
  sql.run("DELETE FROM upload_file WHERE owner = ? AND folder = ? AND name = ?", [owner, folder, name]);
  return true;
}

const MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
};

function viewed(url) {
  const clean = String(url || "").split("?")[0];
  const parts = clean.split("/");
  if (parts.length !== 4 || parts[0] !== "") return null;
  const folder = safeFolder(parts[1] + "/" + parts[2]);
  const name = safeName(parts[3]);
  if (!folder || !name) return null;
  return { folder: folder, name: name, year: parts[1], month: parts[2] };
}

function sendView(req, res, hit) {
  const user = oauth.account(req);
  const row = user
    ? open().get(
      "SELECT name FROM upload_file WHERE owner = ? AND folder = ? AND name = ?",
      [user.name, hit.folder, hit.name]
    )
    : null;
  if (!row) {
    res.writeHead(404, { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" });
    res.end("");
    return true;
  }
  const dir = path.join(__dirname, "out", hit.year, hit.month);
  const dest = path.join(dir, hit.name);
  if (path.dirname(dest) !== dir) {
    res.writeHead(404, { "Cache-Control": "no-store" });
    res.end("");
    return true;
  }
  let data;
  try {
    data = fs.readFileSync(dest);
  } catch (e) {
    res.writeHead(404, { "Cache-Control": "no-store" });
    res.end("");
    return true;
  }
  const ext = hit.name.slice(hit.name.lastIndexOf(".") + 1);
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": "private, max-age=3600",
  });
  res.end(data);
  return true;
}

function handle(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  const clean = String(req.url || "").split("?")[0];
  const hit = viewed(clean);
  if (hit) {
    if (method !== "GET") return false;
    return sendView(req, res, hit);
  }
  if (clean !== "/api/upload") return false;
  if (method === "OPTIONS") {
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return true;
  }

  const user = signed(req, res, method, clean);
  if (!user) return true;

  if (method === "GET") {
    const folder = safeFolder(req.query && req.query.folder);
    const asked = req.query && req.query.folder != null && String(req.query.folder) !== "";
    if (asked && !folder) {
      send(res, 400, { ok: false, error: "bad_request", hint: "folder harus tahun/bulan, contoh 2026/10" });
      return true;
    }
    send(res, 200, { ok: true, files: listOf(user.name, folder) });
    console.log("GET", clean, 200);
    return true;
  }

  if (method === "DELETE") {
    const folder = safeFolder(req.query && req.query.folder);
    const name = safeName(req.query && req.query.name);
    if (!folder || !name) {
      send(res, 400, { ok: false, error: "bad_request", hint: "folder dan name wajib diisi" });
      return true;
    }
    if (!removeFile(user.name, folder, name)) {
      send(res, 404, { ok: false, error: "not_found", hint: "berkas tidak ada" });
      return true;
    }
    send(res, 200, { ok: true });
    console.log("DELETE", clean, 200);
    return true;
  }

  if (method !== "POST") {
    send(res, 405, { ok: false, error: "method_not_allowed", hint: "pakai POST" });
    return true;
  }

  const files = req.files || {};
  const file = files.file;
  if (!file || !file.data) {
    send(res, 400, { ok: false, error: "bad_request", hint: "bidang file wajib diisi" });
    return true;
  }
  const size = file.data.length || 0;
  if (!size) {
    send(res, 400, { ok: false, error: "bad_request", hint: "berkas kosong" });
    return true;
  }
  if (size > MAX) {
    send(res, 400, { ok: false, error: "bad_request", hint: "ukuran maksimal 2 MB" });
    return true;
  }
  const picked = choose(file);
  if (!picked) {
    send(res, 400, { ok: false, error: "bad_request", hint: "jenis berkas tidak diizinkan" });
    return true;
  }

  const when = period(new Date());
  const name = hex(16) + "." + picked.ext;
  const folder = when.year + "/" + when.month;
  const dir = path.join(__dirname, "out", when.year, when.month);
  const dest = path.join(dir, name);
  if (path.dirname(dest) !== dir) {
    send(res, 400, { ok: false, error: "bad_request", hint: "nama berkas tidak sah" });
    return true;
  }
  fs.mkdirSync(dir);
  fs.writeFileSync(dest, file.data);
  try {
    open().run(
      "INSERT INTO upload_file (name, folder, owner, type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [name, folder, user.name, picked.type, size, Date.now()]
    );
  } catch (e) {
    try { fs.unlinkSync(dest); } catch (ignore) {}
    send(res, 503, { ok: false, error: "driver_unavailable", hint: "catatan berkas gagal disimpan" });
    return true;
  }
  send(res, 201, {
    ok: true,
    file: {
      name,
      folder,
      url: "/" + folder + "/" + name,
      type: picked.type,
      size,
      owner: user.name,
    },
  });
  console.log("POST", clean, 201);
  return true;
}

module.exports = { handle };
