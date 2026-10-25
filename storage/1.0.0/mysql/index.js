/**
 * Driver MySQL untuk modul storage.
 *
 * Browser mengirim perintah JSON ke server NX8V. Server yang membuka MySQL
 * lewat require("db"), memakai modules/storage/mysql/config.json.
 *
 *   import { mysql } from "/storage";
 *   await mysql({ op: "insert", table: "users", data: { nama: "Budi" } });
 *
 * Alamat bawaan: POST /api/storage
 * Nama driver ikut di badan JSON. config.json di server yang mengizinkannya.
 */
let cfg = { url: "/api/storage" };

export const mysql = {
  name: "mysql",

  config(obj) {
    if (obj === undefined) return cfg;
    if (obj && typeof obj === "object" && obj.url) cfg = { ...cfg, ...obj };
    else cfg = { url: "/api/storage" };
    return cfg;
  },

  configured() {
    return Boolean(cfg && cfg.url);
  },

  available() {
    return typeof fetch === "function" && Boolean(cfg && cfg.url);
  },

  async forward(cmd, namespace, started) {
    const url = cfg && cfg.url;
    if (!url) throw new Error("config_error");

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(cfg.headers || {}),
    };
    if (cfg.token) headers.Authorization = "Bearer " + cfg.token;

    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const ms = Number(cfg.timeout) > 0 ? Number(cfg.timeout) : 15000;
    const timer = controller ? setTimeout(() => controller.abort(), ms) : null;

    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...cmd, namespace, driver: "mysql" }),
        signal: controller ? controller.signal : undefined,
      });
    } catch (e) {
      if (e?.name === "AbortError") throw new Error("timeout");
      throw new Error("network_error");
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (res.status === 401) throw new Error("unauthorized");
    if (res.status === 403) throw new Error("permission_denied");

    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("bad_gateway");
    }

    if (!res.ok) {
      if (body && body.ok === false) return body;
      throw new Error("bad_gateway");
    }

    if (!body || typeof body !== "object" || typeof body.ok !== "boolean") {
      return {
        ok: true,
        data: body,
        meta: { driver: "mysql", ms: Math.round(performance.now() - started) },
      };
    }

    return {
      ...body,
      meta: { ...(body.meta || {}), driver: "mysql", ms: Math.round(performance.now() - started) },
    };
  },
};

export default mysql;
