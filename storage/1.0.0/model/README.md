# Model bisnis

Model hanya menyimpan SQL. Pemanggilannya sama dengan perintah storage yang lain.

```js
import { model } from "/storage";
const db = model;

await db({ op: "create_table", table: "pelanggan" });
await db({ op: "insert", table: "pelanggan", data: { nama: "Budi", kota: "Bandung" } });
const daftar = await db({ op: "select", table: "pelanggan", where: { kota: "Bandung" } });
```

`create_table`, `insert`, `select`, `update`, dan `remove` dijalankan dari SQL di berkas model. Urutan nilai di `data` atau `where` mengikuti tanda `?`. `update` dan `remove` butuh `id`.

```js
await db({ op: "update", table: "pelanggan", data: { nama: "Budi", kota: "Bandung", id: 7 } });
await db({ op: "remove", table: "pelanggan", where: { id: 7 } });
```

Beberapa tabel dalam satu aksi memakai `op: "transaction"`. `pesanan` menyimpan kepala pesanan dan baris barang bersama. Bila barang gagal, pesanan ikut dibatalkan.

```js
await db({ op: "create_table", table: "pesanan" });
await db({
  op: "simpan",
  table: "pesanan",
  data: { nama: "Budi", barang: "Buku", jumlah: 2 },
});
```

`query` dan `transaction` butuh cookie dari `/oauth`. Tanpa sesi, server membalas `401`.

## Menambah urusan baru

Salin `pelanggan.js`. Isi berkas tetap fungsi yang mengirim `sql`. Daftarkan pembuatnya di `daftarModel` pada `index.js`.

`model` memakai MySQL. Untuk PostgreSQL, ganti `models(mysql)` menjadi `models(postgreSQL)` di `modules/storage/index.js`. Jangan menaruh kata sandi di folder ini.
