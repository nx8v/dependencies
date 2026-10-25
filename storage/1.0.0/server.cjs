/**
 * Dipasang bila "storage" ada di dependencies.
 * Hanya nama di config.json "drivers" yang dimuat.
 * Kosong berarti tidak ada database server: indexeDB dan localstorage
 * tetap jalan di browser.
 */
const fs = require("fs");
const path = require("path");

function readJson(req, res, run) {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    let cmd;
    try {
      cmd = JSON.parse(raw || "{}");
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ ok: false, error: "bad_request", hint: "body bukan JSON" }));
      return;
    }
    Promise.resolve()
      .then(() => run(cmd))
      .then((hasil) => {
        const code = hasil && hasil.ok === false && (hasil.error === "bad_request" || hasil.error === "config_error") ? 400 : 200;
        res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(hasil));
      })
      .catch((e) => {
        const error = e && e.code ? e.code : "driver_unavailable";
        res.writeHead(error === "config_error" ? 400 : 200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: false, error, hint: (e && (e.hint || e.message)) || String(e) }));
      });
  });
}

function wantedNames() {
  const file = path.join(__dirname, "config.json");
  try {
    const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(cfg.drivers) ? cfg.drivers : [];
    return new Set(list.map((n) => String(n).trim()).filter(Boolean));
  } catch (e) {
    return new Set();
  }
}

const wanted = wantedNames();
const loaded = new Map();

function load(name) {
  if (!wanted.has(name)) return null;
  if (loaded.has(name)) return loaded.get(name);
  const file = path.join(__dirname, name, "server.cjs");
  if (!fs.existsSync(file)) {
    loaded.set(name, null);
    return null;
  }
  const mod = require(file);
  const fn = mod && typeof mod.handle === "function" ? mod.handle : null;
  loaded.set(name, fn);
  return fn;
}

function refuse(res, name) {
  const hint = wanted.has(name)
    ? name + " tidak punya server. indexeDB dan localstorage jalan di browser."
    : 'Tambahkan "' + name + '" ke drivers di modules/storage/config.json bila database itu dipakai.';
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ ok: false, error: "driver_unavailable", hint }));
}

function handle(req, res) {
  if (req.method !== "POST") return false;
  const clean = String(req.url || "").split("?")[0];
  let name = "";
  if (clean === "/api/storage") name = "sqlite";
  else if (clean.startsWith("/api/storage/")) name = decodeURIComponent(clean.slice("/api/storage/".length));
  else return false;
  if (!name || name.indexOf("/") !== -1) return false;
  const run = load(name);
  if (!run) {
    refuse(res, name);
    return true;
  }
  readJson(req, res, run);
  return true;
}

module.exports = { handle };
