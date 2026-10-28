export function createPelanggan(db) {
  return {
    async create_table() {
      const buat = await db({
        op: "query",
        sql: "CREATE TABLE IF NOT EXISTS pelanggan (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, nama VARCHAR(80), kota VARCHAR(40))",
      });
      if (!buat.ok) return buat;
      return db({
        op: "query",
        sql: "ALTER TABLE pelanggan MODIFY id INT NOT NULL AUTO_INCREMENT",
      });
    },

    insert(nama, kota) {
      return db({
        op: "query",
        sql: "INSERT INTO pelanggan (nama, kota) VALUES (?, ?)",
        params: [nama, kota],
      });
    },

    select(kota) {
      return db({
        op: "query",
        sql: "SELECT id, nama FROM pelanggan WHERE kota = ?",
        params: [kota],
      });
    },

    update(nama, kota, id) {
      const n = Number(id);
      if (!Number.isInteger(n) || n < 1) {
        return { ok: false, error: "bad_request", hint: "id wajib untuk ubah" };
      }
      return db({
        op: "query",
        sql: "UPDATE pelanggan SET nama = ?, kota = ? WHERE id = ?",
        params: [nama, kota, n],
      });
    },

    remove(id) {
      const n = Number(id);
      if (!Number.isInteger(n) || n < 1) {
        return { ok: false, error: "bad_request", hint: "id wajib untuk hapus" };
      }
      return db({
        op: "query",
        sql: "DELETE FROM pelanggan WHERE id = ?",
        params: [n],
      });
    },
  };
}
