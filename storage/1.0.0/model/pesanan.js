export function createPesanan(db) {
  return {
    async create_table() {
      const kepala = await db({
        op: "query",
        sql: "CREATE TABLE IF NOT EXISTS pesanan (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, nama VARCHAR(80))",
      });
      if (!kepala.ok) return kepala;
      return db({
        op: "query",
        sql: "CREATE TABLE IF NOT EXISTS pesanan_item (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, pesanan_id INT NOT NULL, barang VARCHAR(80), jumlah INT NOT NULL)",
      });
    },

    simpan(nama, barang, jumlah) {
      const n = Number(jumlah);
      if (!nama || !barang || !Number.isInteger(n) || n < 1) {
        return { ok: false, error: "bad_request", hint: "nama, barang, dan jumlah wajib diisi" };
      }
      return db({
        op: "transaction",
        steps: [
          { sql: "INSERT INTO pesanan (nama) VALUES (?)", params: [nama] },
          {
            sql: "INSERT INTO pesanan_item (pesanan_id, barang, jumlah) VALUES (LAST_INSERT_ID(), ?, ?)",
            params: [barang, n],
          },
        ],
      });
    },
  };
}
