/**
 * Dipasang bila "storage" ada di dependencies.
 * Hanya nama di config.json "drivers" yang dimuat.
 * Kosong berarti tidak ada database server: indexeDB dan localstorage
 * tetap jalan di browser.
 */
const fs = require("fs");
const path = require("path");
const oauth = require("../oauth/server.cjs");

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
        const denied = hasil && hasil.ok === false && hasil.error === "unauthorized";
        const bad = hasil && hasil.ok === false && (hasil.error === "bad_request" || hasil.error === "config_error");
        const code = denied ? 401 : bad ? 400 : 200;
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

function driverName(clean, cmd) {
  if (clean === "/api/storage") {
    const named = cmd && cmd.driver != null ? String(cmd.driver).trim() : "";
    if (named) return named;
    if (wanted.has("sqlite")) return "sqlite";
    const first = wanted.values().next();
    return first.done ? "" : first.value;
  }
  if (clean.startsWith("/api/storage/")) return decodeURIComponent(clean.slice("/api/storage/".length));
  return "";
}

function handle(req, res) {
  if (req.method !== "POST") return false;
  const clean = String(req.url || "").split("?")[0];
  if (clean !== "/api/storage" && !clean.startsWith("/api/storage/")) return false;
  readJson(req, res, (cmd) => {
    const name = driverName(clean, cmd);
    if (!name || name.indexOf("/") !== -1) {
      return {
        ok: false,
        error: "driver_unavailable",
        hint: "Isi drivers di modules/storage/config.json",
      };
    }
    const op = String((cmd && cmd.op) || "").toLowerCase();
    const sqlText = cmd && cmd.sql != null ? String(cmd.sql).trim() : "";
    if (op === "query" || op === "transaction" || (!op && sqlText)) {
      if (!oauth.account(req)) {
        return { ok: false, error: "unauthorized", hint: "masuk dulu di /oauth" };
      }
    }
    const run = load(name);
    if (!run) {
      const hint = wanted.has(name)
        ? name + " tidak punya server. indexeDB dan localstorage jalan di browser."
        : 'Tambahkan "' + name + '" ke drivers di modules/storage/config.json bila database itu dipakai.';
      return { ok: false, error: "driver_unavailable", hint };
    }
    return run(cmd);
  });
  return true;
}

module.exports = { handle };
