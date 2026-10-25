/**
 * Middleware Authorization.
 * Daftar API yang wajib token, token klien, dan grant ada di SQLite.
 * Berkas vault tanpa ekstensi supaya tidak terunduh lewat HTTP.
 * Modul ini terdaftar paling awal di dependencies agar pemeriksaan jalan sebelum API dan Proxy.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const file = process.env.NX8V_MIDDLEWARE_FILE || path.join(__dirname, "vault");
let db = null;

function open() {
  if (db) return db;
  const dbmod = require("db");
  db = dbmod.open({ driver: "sqlite", file });
  db.exec(
    "CREATE TABLE IF NOT EXISTS auth_target (" +
      "kind TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, " +
      "PRIMARY KEY (kind, name))"
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS auth_token (" +
      "name TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, " +
      "expires_at INTEGER)"
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS auth_grant (" +
      "token_name TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, " +
      "PRIMARY KEY (token_name, kind, name))"
  );
  const cols = db.all("PRAGMA table_info(auth_token)");
  let hasExpiry = false;
  for (const col of cols) if (col.name === "expires_at") hasExpiry = true;
  if (!hasExpiry) db.exec("ALTER TABLE auth_token ADD COLUMN expires_at INTEGER");
  return db;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function newToken() {
  return "NX_" + crypto.randomBytes(24).toString("hex");
}

function withPrefix(token) {
  const value = String(token || "");
  if (value.indexOf("NX_") === 0) return value;
  return "NX_" + value;
}

function header(req, name) {
  const bag = req && req.headers;
  if (!bag) return "";
  const want = name.toLowerCase();
  for (const key of Object.keys(bag)) {
    if (String(key).toLowerCase() === want) return String(bag[key] || "");
  }
  return "";
}

function bearer(req) {
  const value = header(req, "authorization");
  if (value.slice(0, 7).toLowerCase() !== "bearer ") return "";
  return value.slice(7).trim();
}

function origin() {
  const value = process.env.NX8V_API_ORIGIN;
  return value ? String(value) : "*";
}

function send(res, status, payload, method, path) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin(),
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  });
  res.end(payload === undefined ? "" : JSON.stringify(payload));
  console.log(method, path, status);
}

function fail(res, status, error, hint, method, path) {
  send(res, status, { error, hint }, method, path);
}

function cleanPart(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value || "")) return "";
  return value;
}

function kindOf(value) {
  const kind = String(value || "");
  if (kind === "api" || kind === "proxy") return kind;
  return "";
}

function grantKind(value) {
  const kind = String(value || "");
  if (kind === "api" || kind === "proxy" || kind === "storage" || kind === "middleware") return kind;
  return "";
}

function apiResourceNames() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "../api/config.json"), "utf8"));
    const list = Array.isArray(cfg.resources) ? cfg.resources : [];
    return new Set(list.map((n) => String(n).trim()).filter(Boolean));
  } catch (e) {
    return new Set();
  }
}

function proxyAliases() {
  const reserved = { storage: 1, hello: 1, middleware: 1, proxy: 1 };
  const resources = apiResourceNames();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "../proxy/config.json"), "utf8"));
    const list = Array.isArray(cfg.aliases) ? cfg.aliases : [];
    return new Set(list.map((n) => String(n).trim()).filter((n) => /^[A-Za-z0-9_-]+$/.test(n) && !reserved[n] && !resources.has(n)));
  } catch (e) {
    return new Set();
  }
}

function targetOf(url) {
  const clean = String(url || "").split("?")[0].split("#")[0];
  if (clean.indexOf("/api/") !== 0) return null;
  const parts = clean.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const raw = parts[1];
  if (raw === "storage" || raw === "hello" || raw === "middleware" || raw === "proxy") return null;
  const name = cleanPart(raw);
  if (!name) return null;
  if (proxyAliases().has(name)) return { kind: "proxy", name, path: clean };
  return { kind: "api", name, path: clean };
}

function localRequest(req) {
  const ip = String((req && req.remoteAddress) || "");
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function storagePath(url) {
  const clean = String(url || "").split("?")[0].split("#")[0];
  return clean === "/api/storage" || clean.indexOf("/api/storage/") === 0;
}

function isEnabled(row) {
  return !!row && Number(row.enabled) === 1;
}

function tokenCount(sql) {
  const row = sql.get("SELECT COUNT(*) AS n FROM auth_token");
  return row ? Number(row.n) || 0 : 0;
}

function authRow(sql, token) {
  if (!token) return null;
  return sql.get(
    "SELECT name, enabled, expires_at FROM auth_token WHERE token_hash = ?",
    [hashToken(token)]
  );
}

function expired(row) {
  return !!row && row.expires_at != null && Number(row.expires_at) <= Date.now();
}

function denyHint(sql, token) {
  if (expired(authRow(sql, token))) return "token kedaluwarsa";
  return "Authorization: Bearer tidak cocok";
}

function granted(sql, token, kind, name) {
  const row = authRow(sql, token);
  if (!row || Number(row.enabled) !== 1 || expired(row)) return null;
  return sql.get(
    "SELECT token_name FROM auth_grant WHERE token_name = ? AND kind = ? AND name = ?",
    [row.name, kind, name]
  );
}

function spanOf(body) {
  const picked = [];
  for (const key of ["days", "months", "years"]) {
    if (body[key] != null && body[key] !== "") picked.push(key);
  }
  if (!picked.length) return { at: null };
  if (picked.length > 1) return { error: "isi salah satu: days, months, atau years" };
  const key = picked[0];
  const n = Number(body[key]);
  const max = key === "days" ? 36500 : key === "months" ? 1200 : 100;
  if (!Number.isInteger(n) || n < 1 || n > max) return { error: key + " harus bilangan bulat, minimal 1" };
  const date = new Date();
  if (key === "days") date.setUTCDate(date.getUTCDate() + n);
  else if (key === "months") date.setUTCMonth(date.getUTCMonth() + n);
  else date.setUTCFullYear(date.getUTCFullYear() + n);
  return { at: date.getTime() };
}

function when(ms) {
  if (ms == null || ms === "") return null;
  const n = Number(ms);
  if (!n) return null;
  return new Date(n).toISOString();
}

function manageRoute(url) {
  const clean = String(url || "").split("?")[0].split("#")[0];
  if (clean !== "/middleware" && clean.indexOf("/middleware/") !== 0) return null;
  const rest = clean.slice("/middleware".length).replace(/^\/+/, "");
  const parts = [];
  for (const part of rest.split("/")) {
    if (!part) continue;
    try {
      parts.push(decodeURIComponent(part));
    } catch (e) {
      return { bad: true, path: clean, parts: [] };
    }
  }
  return { bad: false, path: clean, parts };
}

function readBody(req, res, method, path, done) {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    let body = {};
    if (String(raw).trim()) {
      try {
        body = JSON.parse(raw);
      } catch (e) {
        fail(res, 400, "bad_request", "body bukan JSON", method, path);
        return;
      }
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      fail(res, 400, "bad_request", "body harus objek", method, path);
      return;
    }
    done(body);
  });
}

function listTargets(sql) {
  return sql.all("SELECT kind, name, enabled FROM auth_target ORDER BY kind, name").map((row) => ({
    kind: row.kind,
    name: row.name,
    enabled: Number(row.enabled) === 1,
  }));
}

function listTokens(sql) {
  return sql.all("SELECT name, enabled, expires_at FROM auth_token ORDER BY name").map((row) => ({
    name: row.name,
    enabled: Number(row.enabled) === 1,
    expires: when(row.expires_at),
  }));
}

function listGrants(sql) {
  return sql.all("SELECT token_name, kind, name FROM auth_grant ORDER BY token_name, kind, name").map((row) => ({
    token: row.token_name,
    kind: row.kind,
    name: row.name,
  }));
}

function manage(req, res, method, route) {
  const path = route.path;
  const sql = open();
  const openGate = tokenCount(sql) === 0 && localRequest(req);
  if (tokenCount(sql) === 0 && !localRequest(req)) {
    fail(res, 401, "unauthorized", "token pertama hanya dari mesin ini", method, path);
    return;
  }
  if (!openGate && !granted(sql, bearer(req), "middleware", "middleware")) {
    fail(res, 401, "unauthorized", denyHint(sql, bearer(req)), method, path);
    return;
  }
  const parts = route.parts;
  const table = parts[0] || "";

  if (method === "GET" && table === "targets" && parts.length === 1) {
    send(res, 200, listTargets(sql), method, path);
    return;
  }
  if (method === "GET" && table === "tokens" && parts.length === 1) {
    send(res, 200, listTokens(sql), method, path);
    return;
  }
  if (method === "GET" && table === "grants" && parts.length === 1) {
    send(res, 200, listGrants(sql), method, path);
    return;
  }

  if (method === "DELETE" && table === "targets" && parts.length === 3) {
    const kind = kindOf(parts[1]);
    const name = cleanPart(parts[2]);
    if (!kind || !name) {
      fail(res, 400, "bad_request", "kind atau name tidak sah", method, path);
      return;
    }
    sql.run("DELETE FROM auth_grant WHERE kind = ? AND name = ?", [kind, name]);
    sql.run("DELETE FROM auth_target WHERE kind = ? AND name = ?", [kind, name]);
    send(res, 200, {}, method, path);
    return;
  }
  if (method === "DELETE" && table === "tokens" && parts.length === 2) {
    const name = cleanPart(parts[1]);
    if (!name) {
      fail(res, 400, "bad_request", "name tidak sah", method, path);
      return;
    }
    sql.run("DELETE FROM auth_grant WHERE token_name = ?", [name]);
    sql.run("DELETE FROM auth_token WHERE name = ?", [name]);
    send(res, 200, {}, method, path);
    return;
  }
  if (method === "DELETE" && table === "grants" && parts.length === 4) {
    const token = cleanPart(parts[1]);
    const kind = grantKind(parts[2]);
    const name = cleanPart(parts[3]);
    if (!token || !kind || !name) {
      fail(res, 400, "bad_request", "grant tidak sah", method, path);
      return;
    }
    sql.run("DELETE FROM auth_grant WHERE token_name = ? AND kind = ? AND name = ?", [token, kind, name]);
    send(res, 200, {}, method, path);
    return;
  }

  if (method !== "POST" || parts.length !== 1) {
    fail(res, 404, "not_found", "path middleware tidak ada", method, path);
    return;
  }

  readBody(req, res, method, path, (body) => {
    if (table === "targets") {
      const kind = kindOf(body.kind);
      const name = cleanPart(body.name);
      if (!kind || !name) {
        fail(res, 400, "bad_request", "kind harus api atau proxy, name huruf angka", method, path);
        return;
      }
      sql.run(
        "INSERT INTO auth_target (kind, name, enabled) VALUES (?, ?, 1) " +
          "ON CONFLICT(kind, name) DO UPDATE SET enabled = 1",
        [kind, name]
      );
      send(res, 201, { kind, name, enabled: true }, method, path);
      return;
    }
    if (table === "tokens") {
      const name = cleanPart(body.name);
      if (!name) {
        fail(res, 400, "bad_request", "name huruf angka", method, path);
        return;
      }
      const existed = sql.get("SELECT name FROM auth_token WHERE name = ?", [name]);
      if (existed) {
        fail(res, 400, "bad_request", "name token sudah ada", method, path);
        return;
      }
      const token = withPrefix(body.token != null && String(body.token) ? String(body.token) : newToken());
      if (token.length < 8 || /[\r\n]/.test(token)) {
        fail(res, 400, "bad_request", "token minimal 8 karakter", method, path);
        return;
      }
      const span = spanOf(body);
      if (span.error) {
        fail(res, 400, "bad_request", span.error, method, path);
        return;
      }
      const first = tokenCount(sql) === 0;
      sql.run(
        "INSERT INTO auth_token (name, token_hash, enabled, expires_at) VALUES (?, ?, 1, ?)",
        [name, hashToken(token), span.at]
      );
      if (first) {
        sql.run(
          "INSERT INTO auth_grant (token_name, kind, name) VALUES (?, 'middleware', 'middleware')",
          [name]
        );
      }
      const payload = { name, token };
      if (span.at != null) payload.expires = when(span.at);
      send(res, 201, payload, method, path);
      return;
    }
    if (table === "grants") {
      const token = cleanPart(body.token);
      const kind = grantKind(body.kind);
      const name = cleanPart(body.name);
      if (!token || !kind || !name) {
        fail(res, 400, "bad_request", "grant butuh token, kind, dan name", method, path);
        return;
      }
      if ((kind === "middleware" && name !== "middleware") || (kind === "storage" && name !== "storage")) {
        fail(res, 400, "bad_request", "nama grant tidak sah", method, path);
        return;
      }
      const owner = sql.get("SELECT name FROM auth_token WHERE name = ?", [token]);
      const target = kind === "api" || kind === "proxy"
        ? sql.get("SELECT name FROM auth_target WHERE kind = ? AND name = ?", [kind, name])
        : { name };
      if (!owner || !target) {
        fail(res, 404, "not_found", "token atau target tidak ada", method, path);
        return;
      }
      sql.run(
        "INSERT INTO auth_grant (token_name, kind, name) VALUES (?, ?, ?) " +
          "ON CONFLICT(token_name, kind, name) DO NOTHING",
        [token, kind, name]
      );
      send(res, 201, { token, kind, name }, method, path);
      return;
    }
    fail(res, 404, "not_found", "path middleware tidak ada", method, path);
  });
}

function guard(req, res, method) {
  if (storagePath(req.url)) {
    if (localRequest(req)) return false;
    const sql = open();
    if (tokenCount(sql) === 0) return false;
    if (granted(sql, bearer(req), "storage", "storage")) return false;
    const path = String(req.url || "").split("?")[0];
    fail(res, 401, "unauthorized", denyHint(sql, bearer(req)), method, path);
    return true;
  }
  const target = targetOf(req.url);
  if (!target) return false;
  const sql = open();
  const row = sql.get(
    "SELECT enabled FROM auth_target WHERE kind = ? AND name = ?",
    [target.kind, target.name]
  );
  if (!isEnabled(row)) return false;
  const ok = granted(sql, bearer(req), target.kind, target.name);
  if (ok) return false;
  fail(res, 401, "unauthorized", denyHint(sql, bearer(req)), method, target.path);
  return true;
}

function handle(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (method === "OPTIONS") return false;
  try {
    const route = manageRoute(req.url);
    if (route) {
      if (route.bad) {
        fail(res, 400, "bad_request", "path tidak sah", method, route.path);
        return true;
      }
      manage(req, res, method, route);
      return true;
    }
    return guard(req, res, method);
  } catch (e) {
    const path = String(req.url || "").split("?")[0];
    if (path === "/middleware" || path.indexOf("/middleware/") === 0 || targetOf(req.url)) {
      fail(res, 503, "driver_unavailable", "sqlite middleware tidak menjawab", method, path);
      return true;
    }
    return false;
  }
}

module.exports = { handle };
