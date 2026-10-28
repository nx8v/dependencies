import { createPelanggan } from "./pelanggan.js?v=4";
import { createPesanan } from "./pesanan.js?v=1";

const daftarModel = {
  pelanggan: createPelanggan,
  pesanan: createPesanan,
};

function argsOf(cmd) {
  if (Array.isArray(cmd.params)) return cmd.params;
  if (cmd.data && typeof cmd.data === "object" && !Array.isArray(cmd.data)) return Object.values(cmd.data);
  if (Array.isArray(cmd.data)) return cmd.data;
  if (cmd.where && typeof cmd.where === "object" && !Array.isArray(cmd.where)) return Object.values(cmd.where);
  return [];
}

export function models(db) {
  const tables = {};
  for (const [name, create] of Object.entries(daftarModel)) {
    tables[name] = create(db);
  }

  return function model(cmd) {
    if (cmd == null || typeof cmd !== "object" || Array.isArray(cmd)) {
      return { ok: false, error: "bad_request", hint: "Perintah harus berupa objek, contoh: { op: 'select', table: 'pelanggan', where: { kota: 'Bandung' } }" };
    }
    if (typeof cmd.sql === "string" && cmd.sql.trim() && !cmd.table) return db(cmd);

    const table = cmd.table != null ? String(cmd.table) : "";
    if (!table) return { ok: false, error: "no_table", hint: "Field 'table' wajib diisi" };

    const item = tables[table];
    if (!item) {
      return { ok: false, error: "unknown_op", hint: "Model '" + table + "' tidak ada di modules/storage/model" };
    }

    const fn = item[cmd.op];
    if (typeof fn !== "function") {
      return { ok: false, error: "unknown_op", hint: "op '" + cmd.op + "' tidak ada pada model " + table };
    }
    return fn.apply(item, argsOf(cmd));
  };
}
