/**
 * Akun halaman: daftar, masuk, keluar, dan sesi aktif.
 * Kata sandi tidak disimpan. Sesi ada di cookie HttpOnly.
 * Berkas vault tanpa ekstensi supaya tidak terunduh lewat HTTP.
 * Bukan token Bearer di modul middleware.
 */
const path = require("path");
const crypto = require("crypto");

const file = process.env.NX8V_OAUTH_FILE || path.join(__dirname, "vault");
const WEEK = 7 * 24 * 60 * 60;
const ROUNDS = 2000;
let db = null;

function open() {
  if (db) return db;
  const dbmod = require("db");
  db = dbmod.open({ driver: "sqlite", file });
  db.exec(
    "CREATE TABLE IF NOT EXISTS oauth_user (" +
      "name TEXT PRIMARY KEY, salt TEXT NOT NULL, pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL)"
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS oauth_session (" +
      "token_hash TEXT PRIMARY KEY, name TEXT NOT NULL, expires_at INTEGER NOT NULL)"
  );
  return db;
}

function sha(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function stretch(password, salt) {
  let cur = String(salt) + "\n" + String(password);
  for (let i = 0; i < ROUNDS; i++) cur = sha(cur);
  return cur;
}

function send(res, status, payload, method, route) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
  console.log(method, route, status);
}

function fail(res, status, error, hint, method, route) {
  send(res, status, { ok: false, error, hint }, method, route);
}

function routeOf(url) {
  const clean = String(url || "").split("?")[0].split("#")[0];
  if (clean !== "/api/oauth" && clean.indexOf("/api/oauth/") !== 0) return null;
  const action = clean.slice("/api/oauth".length).replace(/^\/+/, "");
  if (action.indexOf("/") !== -1) return { bad: true, path: clean, action: "" };
  return { bad: false, path: clean, action };
}

function readBody(req, res, method, route, done) {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    let body = {};
    if (String(raw).trim()) {
      try {
        body = JSON.parse(raw);
      } catch (e) {
        fail(res, 400, "bad_request", "body bukan JSON", method, route);
        return;
      }
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      fail(res, 400, "bad_request", "body harus objek", method, route);
      return;
    }
    done(body);
  });
}

function nameOf(value) {
  const name = String(value || "");
  if (!/^[A-Za-z0-9_]{3,32}$/.test(name)) return "";
  return name;
}

function passwordOf(value) {
  const password = String(value || "");
  if (password.length < 8 || password.length > 72) return "";
  if (/[\r\n]/.test(password)) return "";
  return password;
}

function cookieOf(req) {
  const bag = (req && req.cookies) || {};
  return String(bag.nx_oauth || "");
}

function setSession(res, token) {
  res.cookie("nx_oauth", token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: String(WEEK),
  });
}

function clearSession(res) {
  res.cookie("nx_oauth", "", {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: "0",
  });
}

function userBySession(sql, token) {
  if (!token) return null;
  const now = Date.now();
  sql.run("DELETE FROM oauth_session WHERE expires_at <= ?", [now]);
  const row = sql.get(
    "SELECT name, expires_at FROM oauth_session WHERE token_hash = ?",
    [sha(token)]
  );
  if (!row || Number(row.expires_at) <= now) return null;
  return { name: row.name };
}

function begin(sql, name) {
  const token = crypto.randomBytes(24).toString("hex");
  sql.run("DELETE FROM oauth_session WHERE name = ?", [name]);
  sql.run(
    "INSERT INTO oauth_session (token_hash, name, expires_at) VALUES (?, ?, ?)",
    [sha(token), name, Date.now() + WEEK * 1000]
  );
  return token;
}

function signup(sql, body, res, method, route) {
  const name = nameOf(body.name);
  const password = passwordOf(body.password);
  if (!name) {
    fail(res, 400, "bad_request", "nama 3-32 huruf, angka, atau garis bawah", method, route);
    return;
  }
  if (!password) {
    fail(res, 400, "bad_request", "kata sandi 8-72 karakter", method, route);
    return;
  }
  if (sql.get("SELECT name FROM oauth_user WHERE name = ?", [name])) {
    fail(res, 409, "conflict", "nama sudah terdaftar", method, route);
    return;
  }
  const salt = crypto.randomBytes(16).toString("hex");
  sql.run(
    "INSERT INTO oauth_user (name, salt, pass_hash, created_at) VALUES (?, ?, ?, ?)",
    [name, salt, stretch(password, salt), Date.now()]
  );
  setSession(res, begin(sql, name));
  send(res, 201, { ok: true, user: { name } }, method, route);
}

function signin(sql, body, res, method, route) {
  const name = nameOf(body.name);
  const password = passwordOf(body.password);
  if (!name || !password) {
    fail(res, 401, "unauthorized", "nama atau kata sandi salah", method, route);
    return;
  }
  const row = sql.get("SELECT name, salt, pass_hash FROM oauth_user WHERE name = ?", [name]);
  const salt = row ? row.salt : crypto.randomBytes(16).toString("hex");
  const hash = stretch(password, salt);
  if (!row || hash !== row.pass_hash) {
    fail(res, 401, "unauthorized", "nama atau kata sandi salah", method, route);
    return;
  }
  setSession(res, begin(sql, name));
  send(res, 200, { ok: true, user: { name } }, method, route);
}

function handle(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  const route = routeOf(req.url);
  if (!route) return false;
  if (route.bad) {
    fail(res, 400, "bad_request", "path tidak sah", method, route.path);
    return true;
  }
  if (method === "OPTIONS") {
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return true;
  }
  try {
    const sql = open();
    const action = route.action;
    if (method === "GET" && action === "me") {
      send(res, 200, { ok: true, user: userBySession(sql, cookieOf(req)) }, method, route.path);
      return true;
    }
    if (method === "POST" && action === "logout") {
      const token = cookieOf(req);
      if (token) sql.run("DELETE FROM oauth_session WHERE token_hash = ?", [sha(token)]);
      clearSession(res);
      send(res, 200, { ok: true }, method, route.path);
      return true;
    }
    if (method === "POST" && (action === "signup" || action === "signin")) {
      readBody(req, res, method, route.path, (body) => {
        if (action === "signup") signup(sql, body, res, method, route.path);
        else signin(sql, body, res, method, route.path);
      });
      return true;
    }
    fail(res, 404, "not_found", "path oauth tidak ada", method, route.path);
    return true;
  } catch (e) {
    fail(res, 503, "driver_unavailable", "sqlite oauth tidak menjawab", method, route.path);
    return true;
  }
}

function account(req) {
  try {
    return userBySession(open(), cookieOf(req));
  } catch (e) {
    return null;
  }
}

module.exports = { handle, account };
