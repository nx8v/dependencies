/**
 * POST /api/storage/firebase
 * Sambungan dibaca dari modules/storage/firebase/config.json
 * (project, region, secret, token, base_url). Env NX8V_FIREBASE_* menimpa berkas itu.
 */
const fs = require("fs");
const path = require("path");
require("../engine.js");

const IDX_ROOT = "__nx_idx";

function fail(error, hint) {
  return { ok: false, error, hint, meta: { error, message: hint } };
}

function settings() {
  const file = path.join(__dirname, "config.json");
  let cfg = {};
  if (fs.existsSync(file)) cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  const project = String(process.env.NX8V_FIREBASE_PROJECT || cfg.project || "").trim();
  const baseUrl = String(process.env.NX8V_FIREBASE_BASE_URL || cfg.base_url || "").trim();
  if (!project && !baseUrl) {
    const err = new Error("config");
    err.code = "config_error";
    err.hint = "Isi " + file + " dengan project. Tambahkan secret bila database dikunci";
    throw err;
  }
  return {
    project,
    region: String(process.env.NX8V_FIREBASE_REGION || cfg.region || "").trim(),
    secret: process.env.NX8V_FIREBASE_SECRET || cfg.secret || "",
    token: process.env.NX8V_FIREBASE_TOKEN || cfg.token || "",
    base_url: baseUrl,
  };
}

function safeSegment(s) {
  return String(s).replace(/[.#$\[\]\/\u0000-\u001f\u007f]/g, "-");
}

function segments(fullKey) {
  return String(fullKey).split(":").filter((s) => s !== "").map(safeSegment);
}

function baseURL(cfg) {
  if (cfg.base_url) return String(cfg.base_url).replace(/\/+$/, "");
  if (!cfg.project) return null;
  const host = cfg.region
    ? cfg.project + "." + cfg.region + ".firebasedatabase.app"
    : cfg.project + ".firebaseio.com";
  return "https://" + host;
}

function authQuery(cfg) {
  const token = cfg.token || cfg.secret;
  return token ? "auth=" + encodeURIComponent(token) : "";
}

async function read(cfg, nodePath) {
  const base = baseURL(cfg);
  if (!base) throw new Error("config_error");
  const qs = [];
  const a = authQuery(cfg);
  if (a) qs.push(a);
  const url = base + nodePath + ".json" + (qs.length ? "?" + qs.join("&") : "");
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error("network_error");
  }
  if (res.status === 401) throw new Error("unauthorized");
  if (res.status === 403) throw new Error("permission_denied");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("network_error");
  const text = await res.text();
  if (!text || text === "null") return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("corrupt_data");
  }
}

async function send(cfg, method, nodePath, body) {
  const base = baseURL(cfg);
  if (!base) throw new Error("config_error");
  const a = authQuery(cfg);
  const url = base + nodePath + ".json" + (a ? "?" + a : "");
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("network_error");
  }
  if (res.status === 401) throw new Error("unauthorized");
  if (res.status === 403) throw new Error("permission_denied");
  if (!res.ok) throw new Error("network_error");
  const text = await res.text();
  if (!text || text === "null") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function collectLeaves(node, trail, out) {
  if (node === null || node === undefined) return;
  if (typeof node !== "object") {
    out.push(trail);
    return;
  }
  for (const k of Object.keys(node)) collectLeaves(node[k], trail.concat(k), out);
}

async function keysUnder(cfg, prefix) {
  const clean = String(prefix).replace(/:+$/, "");
  const cleanSegs = segments(clean);
  const tree = await read(cfg, "/" + IDX_ROOT + "/" + cleanSegs.join("/"));
  if (!tree) return [];
  const leaves = [];
  collectLeaves(tree, [], leaves);
  return leaves.map((segs) => cleanSegs.concat(segs).join(":")).sort();
}

function namespacePrefix(namespace) {
  return "nx:" + namespace + ":";
}

function parsePhysical(fullKey, namespace) {
  const rest = String(fullKey).slice(namespacePrefix(namespace).length);
  const at = rest.lastIndexOf(":");
  if (at < 0) return { table: rest, key: "" };
  return { table: rest.slice(0, at), key: rest.slice(at + 1) };
}

function physicalKey(namespace, table, key) {
  const safe = (v) => String(v).replace(/:/g, "-");
  return "nx:" + namespace + ":" + safe(table) + ":" + safe(key);
}

async function putRecord(cfg, fullKey, value) {
  await send(cfg, "PUT", "/" + segments(fullKey).join("/"), value);
  await send(cfg, "PUT", "/" + IDX_ROOT + "/" + segments(fullKey).join("/"), true);
}

async function delRecord(cfg, fullKey) {
  const body = await read(cfg, "/" + segments(fullKey).join("/"));
  if (body === null || body === undefined) return false;
  await send(cfg, "DELETE", "/" + segments(fullKey).join("/"));
  await send(cfg, "DELETE", "/" + IDX_ROOT + "/" + segments(fullKey).join("/"));
  return true;
}

async function run(cmd, cfg) {
  const namespace = cmd && cmd.namespace ? String(cmd.namespace) : "default";
  const fullKeys = await keysUnder(cfg, namespacePrefix(namespace));
  const seed = {};
  for (const fullKey of fullKeys) {
    const parsed = parsePhysical(fullKey, namespace);
    const value = await read(cfg, "/" + segments(fullKey).join("/"));
    if (value === null || value === undefined) continue;
    if (!seed[parsed.table]) seed[parsed.table] = [];
    seed[parsed.table].push({ key: parsed.key, value });
  }
  const store = globalThis.NxSintaks.memory(seed);
  const hasil = globalThis.NxSintaks.apply(store, cmd, "firebase");
  if (hasil && hasil.ok) {
    const after = store.dump();
    const names = new Set(Object.keys(seed).concat(Object.keys(after)));
    for (const table of names) {
      const next = new Map((after[table] || []).map((r) => [String(r.id), r]));
      const prev = new Map((seed[table] || []).map((r) => [String(r.key), r.value]));
      for (const [id, row] of next) {
        const obj = Object.assign({}, row);
        delete obj.id;
        if (JSON.stringify(prev.get(id)) !== JSON.stringify(obj)) {
          await putRecord(cfg, physicalKey(namespace, table, id), obj);
        }
      }
      for (const [id] of prev) {
        if (!next.has(id)) await delRecord(cfg, physicalKey(namespace, table, id));
      }
    }
  }
  if (hasil && hasil.meta) hasil.meta.place = baseURL(cfg);
  return hasil;
}

function handle(cmd) {
  let cfg;
  try {
    cfg = settings();
  } catch (e) {
    if (e && e.code === "config_error") return fail("config_error", e.hint);
    return fail("config_error", e && e.message ? e.message : "config.json tidak bisa dibaca");
  }
  return run(cmd, cfg);
}

module.exports = { handle };
