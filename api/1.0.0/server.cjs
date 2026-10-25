/**
 * API pihak lain, bentuknya seperti JSONPlaceholder.
 * Dipasang bila "api" ada di dependencies.
 * Daftar resource di config.json. Rahasia database tidak ada di berkas ini.
 */
const fs = require("fs");
const path = require("path");

function readConfig() {
  const empty = { driver: "", namespace: "api", resources: [], relations: {}, broken: false };
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
    const resources = Array.isArray(cfg.resources) ? cfg.resources.map((n) => String(n).trim()).filter(Boolean) : [];
    return {
      driver: cfg.driver ? String(cfg.driver).trim() : "",
      namespace: cfg.namespace ? String(cfg.namespace) : "api",
      resources,
      relations: cfg.relations && typeof cfg.relations === "object" ? cfg.relations : {},
      broken: false,
    };
  } catch (e) {
    empty.broken = true;
    return empty;
  }
}

const cfg = readConfig();
const resourceSet = new Set(cfg.resources);
let driverFn = null;
let driverError = "";

function loadDriver() {
  if (driverFn || driverError) return;
  const name = cfg.driver;
  if (!name || name.indexOf("..") !== -1 || /[/\\:]/.test(name)) {
    driverError = "driver di modules/api/config.json tidak sah";
    return;
  }
  let allowed = [];
  try {
    const storageCfg = JSON.parse(fs.readFileSync(path.join(__dirname, "../storage/config.json"), "utf8"));
    allowed = Array.isArray(storageCfg.drivers) ? storageCfg.drivers.map((n) => String(n)) : [];
  } catch (e) {
    driverError = "modules/storage/config.json tidak terbaca";
    return;
  }
  if (allowed.indexOf(name) < 0) {
    driverError = 'Tambahkan "' + name + '" ke drivers di modules/storage/config.json';
    return;
  }
  const file = path.join(__dirname, "../storage", name, "server.cjs");
  if (!fs.existsSync(file)) {
    driverError = name + " tidak punya server";
    return;
  }
  const mod = require(file);
  if (!mod || typeof mod.handle !== "function") {
    driverError = name + " tidak punya handle";
    return;
  }
  driverFn = mod.handle;
}

function origin() {
  const value = process.env.NX8V_API_ORIGIN;
  return value ? String(value) : "*";
}

function queryOf(url) {
  const text = String(url || "");
  const q = text.indexOf("?");
  if (q < 0) return {};
  const out = {};
  const parts = text.slice(q + 1).split("#")[0].split("&");
  for (const pair of parts) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    let key = eq < 0 ? pair : pair.slice(0, eq);
    let value = eq < 0 ? "" : pair.slice(eq + 1);
    try {
      key = decodeURIComponent(key.replace(/\+/g, " "));
      value = decodeURIComponent(value.replace(/\+/g, " "));
    } catch (e) {
      continue;
    }
    if (key) out[key] = value;
  }
  return out;
}

function same(actual, expected) {
  if (actual === expected) return true;
  if (actual == null || expected == null) return false;
  return String(actual) === String(expected);
}

function matchRow(row, where) {
  for (const key of Object.keys(where)) {
    if (!same(row[key], where[key])) return false;
  }
  return true;
}

function decodePart(value) {
  try {
    return decodeURIComponent(value);
  } catch (e) {
    return null;
  }
}

function routeOf(url) {
  const clean = String(url || "").split("?")[0];
  if (clean.indexOf("/api/") !== 0) return null;
  const parts = clean.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] !== "api") return null;
  const name = decodePart(parts[1]);
  if (name == null || name === "storage" || name === "hello" || name === "proxy" || name === "middleware") return null;
  if (parts.length > 4) return { missing: true, path: clean };
  const id = parts.length >= 3 ? decodePart(parts[2]) : "";
  const child = parts.length === 4 ? decodePart(parts[3]) : "";
  if (id == null || child == null) return { bad: true, path: clean };
  return { name, id, child, path: clean };
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

function statusOf(hasil) {
  const error = hasil && hasil.error;
  if (error === "not_found") return 404;
  if (error === "bad_request" || error === "type_mismatch" || error === "validation_failed" || error === "no_where" || error === "no_table") {
    return 400;
  }
  return 503;
}

function run(cmd) {
  loadDriver();
  if (!driverFn) {
    return { ok: false, error: "driver_unavailable", hint: driverError || "driver tidak hidup" };
  }
  try {
    return driverFn(Object.assign({ namespace: cfg.namespace }, cmd));
  } catch (e) {
    return { ok: false, error: (e && e.code) || "driver_unavailable", hint: (e && (e.hint || e.message)) || String(e) };
  }
}

function after(hasil, res, method, path, done) {
  const go = (value) => {
    if (!value || value.ok === false) {
      const code = statusOf(value);
      fail(res, code, (value && value.error) || "driver_unavailable", (value && value.hint) || "", method, path);
      return;
    }
    done(value.data);
  };
  if (hasil && typeof hasil.then === "function") {
    hasil.then(go, (e) => fail(res, 503, "driver_unavailable", (e && e.message) || String(e), method, path));
    return;
  }
  go(hasil);
}

function handle(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  const route = routeOf(req.url);
  if (!route) return false;
  if (route.missing) {
    fail(res, 404, "not_found", "resource tidak ada", method, route.path);
    return true;
  }
  if (route.bad) {
    fail(res, 400, "bad_request", "path tidak sah", method, String(req.url || "").split("?")[0]);
    return true;
  }
  const path = route.path;

  if (method === "OPTIONS") {
    send(res, 204, undefined, method, path);
    return true;
  }
  if (cfg.broken) {
    fail(res, 503, "driver_unavailable", "modules/api/config.json tidak terbaca", method, path);
    return true;
  }
  if (!resourceSet.has(route.name)) {
    fail(res, 404, "not_found", "resource tidak ada", method, path);
    return true;
  }
  if (route.child && (!resourceSet.has(route.child) || method !== "GET")) {
    if (method !== "GET") fail(res, 405, "method_not_allowed", "nested hanya menerima GET", method, path);
    else fail(res, 404, "not_found", "resource tidak ada", method, path);
    return true;
  }

  const needsBody = method === "POST" || method === "PUT" || method === "PATCH";
  if (!needsBody) {
    respond(req, res, method, route, null);
    return true;
  }

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
    respond(req, res, method, route, body);
  });
  return true;
}

function respond(req, res, method, route, body) {
  const path = route.path;
  const table = route.name;

  if (route.child) {
    const rel = cfg.relations[table] || {};
    const field = rel[route.child];
    if (!field) {
      fail(res, 404, "not_found", "relasi tidak ada", method, path);
      return;
    }
    after(run({ op: "select", table: route.child }), res, method, path, (data) => {
      const where = queryOf(req.url);
      where[field] = route.id;
      const rows = (Array.isArray(data) ? data : []).filter((row) => matchRow(row, where));
      send(res, 200, rows, method, path);
    });
    return;
  }

  if (!route.id && method === "GET") {
    after(run({ op: "select", table }), res, method, path, (data) => {
      const where = queryOf(req.url);
      const rows = (Array.isArray(data) ? data : []).filter((row) => matchRow(row, where));
      send(res, 200, rows, method, path);
    });
    return;
  }

  if (!route.id && method === "POST") {
    after(run({ op: "insert", table, data: body }), res, method, path, (data) => {
      send(res, 201, data, method, path);
    });
    return;
  }

  if (route.id && method === "GET") {
    after(run({ op: "get", table, key: route.id }), res, method, path, (data) => {
      const row = data && typeof data === "object" && !Array.isArray(data) ? data : { value: data };
      send(res, 200, Object.assign({ id: route.id }, row), method, path);
    });
    return;
  }

  if (route.id && method === "PUT") {
    after(run({ op: "get", table, key: route.id }), res, method, path, () => {
      after(run({ op: "set", table, key: route.id, data: body }), res, method, path, (data) => {
        send(res, 200, data, method, path);
      });
    });
    return;
  }

  if (route.id && method === "PATCH") {
    after(run({ op: "update", table, key: route.id, data: body }), res, method, path, (data) => {
      const row = Array.isArray(data) ? data[0] : data;
      send(res, 200, row, method, path);
    });
    return;
  }

  if (route.id && method === "DELETE") {
    after(run({ op: "delete", table, key: route.id }), res, method, path, () => {
      send(res, 200, {}, method, path);
    });
    return;
  }

  fail(res, 405, "method_not_allowed", method + " tidak dipakai di path ini", method, path);
}

module.exports = { handle };
