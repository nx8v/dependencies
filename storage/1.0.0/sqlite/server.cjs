/**
 * POST /api/storage → berkas modules/storage/sqlite/data.db
 */
const path = require("path");
const { createHandle } = require("../kv.cjs");

const handle = createHandle({
  name: "sqlite",
  connect(dbmod) {
    const file = process.env.NX8V_SQLITE_FILE || path.join(__dirname, "data.db");
    const conn = dbmod.open({ driver: "sqlite", file });
    conn.exec(
      "CREATE TABLE IF NOT EXISTS nx_kv (" +
        "ns TEXT NOT NULL, tbl TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, " +
        "PRIMARY KEY (ns, tbl, k))"
    );
    return { conn, place: file };
  },
});

module.exports = { handle };
