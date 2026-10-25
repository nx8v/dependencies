/**
 * Proxy ke mesin lain.
 * Pihak luar memanggil /api/<alias>/... bila alias sudah terdaftar.
 * Bentuknya sama dengan resource API. Kata proxy tidak muncul di URL.
 * URL tujuan ada di berkas upstreams (tanpa ekstensi) atau NX8V_PROXY_UPSTREAMS.
 * Berkas ber-ekstensi di folder ini dapat diunduh, jadi URL tujuan tidak ditulis di config.json.
 */
const fs = require("fs");
const path = require("path");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return null;
  }
}

const warnedAlias = new Set();

function apiResourceNames() {
  const cfg = readJson(path.join(__dirname, "../api/config.json"));
  const list = cfg && Array.isArray(cfg.resources) ? cfg.resources : [];
  return new Set(list.map((n) => String(n).trim()).filter(Boolean));
}

function loadConfig() {
  const cfg = readJson(path.join(__dirname, "config.json")) || {};
  const reserved = { storage: 1, hello: 1, middleware: 1, proxy: 1 };
  const resources = apiResourceNames();
  const aliases = Array.isArray(cfg.aliases)
    ? cfg.aliases.map((n) => String(n).trim()).filter((n) => /^[A-Za-z0-9_-]+$/.test(n) && !reserved[n])
    : [];
  let targets = {};
  const fromEnv = process.env.NX8V_PROXY_UPSTREAMS;
  if (fromEnv) {
    try {
      const parsed = JSON.parse(fromEnv);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) targets = parsed;
    } catch (e) {
      targets = {};
    }
  } else {
    const file = readJson(path.join(__dirname, "upstreams"));
    if (file && typeof file === "object" && !Array.isArray(file)) targets = file;
  }
  const map = {};
  for (const name of aliases) {
    if (resources.has(name)) {
      if (!warnedAlias.has(name)) {
        warnedAlias.add(name);
        console.error('alias "' + name + '" sama dengan resource API, tidak dipakai proxy');
      }
      continue;
    }
    const value = targets[name];
    map[name] = value != null ? String(value).trim() : "";
  }
  return map;
}

function origin() {
  const value = process.env.NX8V_PROXY_ORIGIN;
  return value ? String(value) : "*";
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

function routeOf(url) {
  const text = String(url || "");
  const q = text.indexOf("?");
  const clean = (q < 0 ? text : text.slice(0, q)).split("#")[0];
  const query = q < 0 ? "" : text.slice(q + 1).split("#")[0];
  if (clean.indexOf("/api/") !== 0) return null;
  const map = loadConfig();
  const rest = clean.slice("/api/".length);
  const slash = rest.indexOf("/");
  let alias = slash < 0 ? rest : rest.slice(0, slash);
  try {
    alias = decodeURIComponent(alias);
  } catch (e) {
    return null;
  }
  if (!alias || !Object.prototype.hasOwnProperty.call(map, alias)) return null;
  const tail = slash < 0 ? "" : rest.slice(slash + 1);
  return { alias, tail, query, path: clean, base: map[alias] };
}

function safeAlias(raw) {
  if (!raw) return "";
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  return raw;
}

function safeTail(raw) {
  if (!raw) return "";
  if (raw.indexOf("\\") !== -1 || raw.indexOf("://") !== -1 || raw.indexOf("//") === 0) return null;
  const out = [];
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") continue;
    let decoded;
    try {
      decoded = decodeURIComponent(part);
    } catch (e) {
      return null;
    }
    if (decoded === ".." || decoded.indexOf("/") !== -1 || decoded.indexOf("\\") !== -1) return null;
    out.push(part);
  }
  return out.join("/");
}

function targetUrl(base, tail, query) {
  const root = String(base || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+/i.test(root) || /[\r\n]/.test(root)) return null;
  const url = tail ? root + "/" + tail : root;
  return query ? url + "?" + query : url;
}

function corsHeaders(extra) {
  return Object.assign({}, extra || {}, {
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin(),
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
  });
}

function send(res, status, body, headers, method, path) {
  res.writeHead(status, corsHeaders(headers));
  res.end(body == null ? "" : body);
  console.log(method, path, status);
}

function fail(res, status, error, hint, method, path) {
  send(res, status, JSON.stringify({ error, hint }), {
    "Content-Type": "application/json; charset=utf-8",
  }, method, path);
}

function upstreamHeaders(response) {
  const bag = response && response.headers;
  const type = bag && (bag["content-type"] || bag["Content-Type"]);
  return type ? { "Content-Type": String(type) } : {};
}

function requestHeaders(req) {
  const out = {};
  const type = header(req, "content-type");
  const accept = header(req, "accept");
  if (type) out["Content-Type"] = type;
  if (accept) out["Accept"] = accept;
  return out;
}

function forward(req, res, method, route, body) {
  const path = route.path;
  const alias = safeAlias(route.alias);
  if (alias == null) {
    fail(res, 400, "bad_request", "path tidak sah", method, path);
    return;
  }
  if (!alias) {
    fail(res, 404, "not_found", "alias tidak ada", method, path);
    return;
  }
  const tail = safeTail(route.tail);
  if (tail == null) {
    fail(res, 400, "bad_request", "path tidak sah", method, path);
    return;
  }
  const base = route.base;
  if (!base) {
    fail(res, 503, "driver_unavailable", "alias belum punya tujuan", method, path);
    return;
  }
  const url = targetUrl(base, tail, route.query);
  if (!url) {
    fail(res, 503, "driver_unavailable", "tujuan tidak sah", method, path);
    return;
  }
  const opts = { method, headers: requestHeaders(req) };
  if (body != null && method !== "GET" && method !== "HEAD") opts.body = body;
  let pending;
  try {
    pending = fetch(url, opts);
  } catch (e) {
    fail(res, 502, "bad_gateway", "mesin tujuan tidak menjawab", method, path);
    return;
  }
  Promise.resolve(pending).then((response) => {
    return response.text().then((text) => {
      const status = response.status || 502;
      send(res, status, method === "HEAD" ? "" : text, upstreamHeaders(response), method, path);
    });
  }, () => {
    fail(res, 502, "bad_gateway", "mesin tujuan tidak menjawab", method, path);
  });
}

function handle(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  const route = routeOf(req.url);
  if (!route) return false;
  const path = route.path;

  if (method === "OPTIONS") {
    send(res, 204, "", null, method, path);
    return true;
  }
  const allowed = { GET: 1, POST: 1, PUT: 1, PATCH: 1, DELETE: 1, HEAD: 1 };
  if (!allowed[method]) {
    fail(res, 405, "method_not_allowed", method + " tidak dipakai di path ini", method, path);
    return true;
  }
  const needsBody = method === "POST" || method === "PUT" || method === "PATCH";
  if (!needsBody) {
    forward(req, res, method, route, null);
    return true;
  }
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => forward(req, res, method, route, raw));
  return true;
}

module.exports = { handle };
