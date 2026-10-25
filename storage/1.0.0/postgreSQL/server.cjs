/**
 * POST /api/storage/postgreSQL
 * Sambungan dibaca dari modules/storage/postgreSQL/config.json
 * (host, port, user, password, database). Env NX8V_PG_* menimpa berkas itu.
 */
const fs = require("fs");
const path = require("path");
const { createHandle } = require("../kv.cjs");

function settings() {
  const file = path.join(__dirname, "config.json");
  let cfg = {};
  if (fs.existsSync(file)) cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  const host = process.env.NX8V_PG_HOST || cfg.host;
  const database = process.env.NX8V_PG_DATABASE || cfg.database;
  if (!host || !database) {
    const err = new Error("config");
    err.code = "config_error";
    err.hint = "Isi " + file + " dengan host, port, user, password, dan database";
    throw err;
  }
  return {
    host,
    port: Number(process.env.NX8V_PG_PORT || cfg.port || 5432),
    user: process.env.NX8V_PG_USER || cfg.user || "postgres",
    password: process.env.NX8V_PG_PASSWORD || cfg.password || cfg.pass || "",
    database,
  };
}

const handle = createHandle({
  name: "postgreSQL",
  connect(dbmod) {
    const s = settings();
    const conn = dbmod.open({
      driver: "postgres",
      host: s.host,
      port: s.port,
      user: s.user,
      password: s.password,
      database: s.database,
      timeout: 8000,
    });
    conn.exec(
      "CREATE TABLE IF NOT EXISTS nx_kv (" +
        "ns VARCHAR(128) NOT NULL, tbl VARCHAR(128) NOT NULL, k VARCHAR(128) NOT NULL, " +
        "v TEXT NOT NULL, PRIMARY KEY (ns, tbl, k))"
    );
    return { conn, place: s.host + ":" + s.port + "/" + s.database };
  },
});

module.exports = { handle };
