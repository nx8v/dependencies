# Storage

Satu perintah JSON untuk enam mesin penyimpanan.

```js
import { storage, indexeDB, sqlite, mysql, postgreSQL, firebase } from "/storage";
//        │        │         │      │      │            └── Firebase Realtime Database
//        │        │         │      │      └─────────────── PostgreSQL
//        │        │         │      └────────────────────── MySQL
//        │        │         └───────────────────────────── SQLite (sqlite/data.db)
//        │        └─────────────────────────────────────── IndexedDB
//        └──────────────────────────────────────────────── localStorage
```

| Export | Mesin | Data ada di |
|---|---|---|
| `storage` | localStorage | browser |
| `indexeDB` | IndexedDB | browser |
| `sqlite` | SQLite | `modules/storage/sqlite/data.db` |
| `mysql` | MySQL | server yang tertulis di `mysql/config.json` |
| `postgreSQL` | PostgreSQL | server yang tertulis di `postgreSQL/config.json` |
| `firebase` | Firebase Realtime Database | project yang tertulis di `firebase/config.json` |

Semua perintah mengembalikan Promise dan bentuk balasan yang sama. Ganti driver cukup ganti nama import.

`server.js` tetap berkas pendek hasil `nx8v init`. NX8V memasang modul ini sendiri karena `"storage"` ada di `dependencies` pada `project.json`.

---

## Daftar isi

1. [Mulai cepat](#1-mulai-cepat)
2. [Driver server](#2-driver-server)
3. [Model data](#3-model-data)
4. [Bentuk perintah](#4-bentuk-perintah)
5. [Daftar op](#5-daftar-op)
6. [Bentuk balasan](#6-bentuk-balasan)
7. [Pengaman](#7-pengaman)
8. [Memilih driver](#8-memilih-driver)
9. [Gaya ringkas](#9-gaya-ringkas)
10. [Contoh](#10-contoh)
11. [Batasan](#11-batasan)
12. [Berkas](#12-berkas)

---

## 1. Mulai cepat

`storage` dan `indexeDB` langsung jalan di browser.

```js
import { storage } from "/storage";

await storage({ op: "insert", table: "users", data: { nama: "Budi", umur: 30 } });

const res = await storage({ op: "select", table: "users", where: { umur: { ">": 20 } } });
if (!res.ok) console.warn(res.error, res.hint);
```

Kegagalan tidak melempar exception. Periksa `res.ok`.

---

## 2. Driver server

`sqlite`, `mysql`, `postgreSQL`, dan `firebase` dikerjakan di server. Halaman hanya mengirim JSON.

### Menyalakan

Daftar nama di `modules/storage/config.json`:

```json
{
  "drivers": ["mysql"]
}
```

Nama yang boleh ditulis: `sqlite`, `mysql`, `postgreSQL`, `firebase`. Nama yang tidak ada di daftar tidak dimuat. `storage` dan `indexeDB` tidak masuk daftar ini.

Halaman hanya mengirim `POST /api/storage`. Nama driver ada di badan JSON (`driver`). Server menerima nama itu hanya bila tertulis di `drivers` pada `config.json`. Daftar Network di browser menampilkan `storage`, bukan nama database. Setelah mengubah daftar atau isi `config.json` sebuah driver, jalankan ulang nx8v.

| Nama | Alamat dari browser | Berkas pengatur |
|---|---|---|
| `sqlite` | `POST /api/storage` | berkas `sqlite/data.db` |
| `mysql` | `POST /api/storage` | `mysql/config.json` |
| `postgreSQL` | `POST /api/storage` | `postgreSQL/config.json` |
| `firebase` | `POST /api/storage` | `firebase/config.json` |

### Mengirim perintah

Badan `POST /api/storage` adalah perintah JSON yang sama dengan [bentuk perintah](#4-bentuk-perintah). Tambahkan `"driver"`. Nilainya harus ada di `drivers`. Bila `driver` kosong, server memakai nama pertama dalam daftar itu.

Dari komputer lain, header `Authorization: Bearer` wajib. Token itu harus sudah punya grant `storage` di modul Middleware. Nama di grant adalah nama klien, misalnya `admin`. Rahasia token yang ditaruh di header.

Dari komputer yang menjalankan nx8v, form tetap boleh mengirim tanpa Bearer.

JSON harus utuh. Angka tidak boleh terbelah oleh pindah baris. `40` yang tertulis `4` di satu baris dan `0` di baris berikutnya membuat badan itu bukan JSON. Server membalas:

```json
{ "ok": false, "error": "bad_request", "hint": "body bukan JSON" }
```

Contoh banyak record, satu baris:

```bash
curl --location -X POST "http://localhost:5023/api/storage" ^
  --header "Authorization: Bearer TOKEN_ADMIN" ^
  --header "Content-Type: application/json" ^
  --data "{\"op\":\"insert\",\"table\":\"users\",\"driver\":\"mysql\",\"data\":[{\"nama\":\"Budi\",\"umur\":40},{\"nama\":\"Siti\",\"umur\":17}]}"
```

Balasan sukses:

```json
{
  "ok": true,
  "data": [
    { "id": "k-...", "nama": "Budi", "umur": 40 },
    { "id": "k-...", "nama": "Siti", "umur": 17 }
  ]
}
```

`users` di contoh ini tabel yang sama dengan form, namespace `default`.

### Query SQL

Untuk SQL proyek, tulis teksnya di `sql`. Berlaku pada `mysql` dan `postgreSQL`. Placeholder `?` diisi lewat `params`. Satu pernyataan.

```js
import { mysql } from "/storage";

const daftar = await mysql({
  sql: "SELECT id, nama FROM pelanggan WHERE kota = ?",
  params: ["Bandung"],
});
```

Bentuk fungsi yang sama: `mysql.sql("SELECT id, nama FROM pelanggan WHERE kota = ?", ["Bandung"])`.

SQL sebuah urusan bisnis ditaruh di `modules/storage/model/`. Halaman memakai perintah yang sama:

```js
import { model } from "/storage";
const db = model;

const daftar = await db({ op: "select", table: "pelanggan", where: { kota: "Bandung" } });
```

`SELECT` membalas array baris. `INSERT`, `UPDATE`, dan `DELETE` membalas `{ changes, lastInsertRowid }`. `insert` dokumen form tidak memakai field ini.

### MySQL

`modules/storage/mysql/config.json`:

```json
{
  "host": "127.0.0.1",
  "port": 3306,
  "user": "root",
  "password": "",
  "database": "nx8v"
}
```

Variabel lingkungan `NX8V_MYSQL_HOST`, `NX8V_MYSQL_PORT`, `NX8V_MYSQL_USER`, `NX8V_MYSQL_PASSWORD`, dan `NX8V_MYSQL_DATABASE` menimpa berkas itu.

### PostgreSQL

`modules/storage/postgreSQL/config.json` memakai field yang sama. Port bawaan bila dikosongkan adalah `5432`.

Variabel lingkungan: `NX8V_PG_HOST`, `NX8V_PG_PORT`, `NX8V_PG_USER`, `NX8V_PG_PASSWORD`, `NX8V_PG_DATABASE`.

### SQLite

Berkasnya `modules/storage/sqlite/data.db`. Pindah lokasi dengan `NX8V_SQLITE_FILE`.

### Firebase

`modules/storage/firebase/config.json`:

```json
{
  "project": "my-app-default-rtdb",
  "region": "asia-southeast1",
  "secret": "",
  "token": "",
  "base_url": ""
}
```

`region` kosong memakai `firebaseio.com`. `secret` atau `token` diisi bila rules database mengunci akses. `base_url` menimpa alamat, misalnya emulator.

Variabel lingkungan: `NX8V_FIREBASE_PROJECT`, `NX8V_FIREBASE_REGION`, `NX8V_FIREBASE_SECRET`, `NX8V_FIREBASE_TOKEN`, `NX8V_FIREBASE_BASE_URL`.

`project` dan `base_url` yang keduanya kosong membalas `config_error`.

---

## 3. Model data

```
namespace        table          key              nilai
"default"   →   "users"   →   "budi"    →   { "nama": "Budi", "umur": 30 }
```

| Tingkat | Arti |
|---|---|
| namespace | pemisah data. Bawaan: `default` |
| table | kelompok record. Boleh bersarang: `"users/aktif"` |
| key | id record. Kosong pada `insert` berarti id dibuat otomatis (`k-...`) |

Di browser, kunci fisiknya `nx:default:users:budi`. Di SQLite, MySQL, dan PostgreSQL record disimpan sebagai JSON. Di Firebase path-nya `/nx/default/users/budi`, plus catatan `/__nx_idx/... = true` supaya record bisa didaftar.

Namespace lain:

```js
await storage({ op: "insert", table: "users", data: { nama: "Siti" }, namespace: "app2" });
await storage({ op: "tables" }, { namespace: "app2" });
```

---

## 4. Bentuk perintah

```json
{ "op": "insert", "table": "users", "data": { "nama": "Budi", "umur": 30 } }
```

`value` diterima sebagai alias `data`. `id` diterima sebagai alias `key`.

Gaya path:

```json
{ "op": "set", "path": "/users/budi", "data": { "nama": "Budi" } }
```

Segmen terakhir menjadi `key`, sisanya menjadi `table`.

Perintah boleh berupa string JSON:

```js
await storage('{"op":"select","table":"users"}');
```

### Alias

| Ditulis | Dianggap |
|---|---|
| `put`, `upsert` | `set` |
| `del` | `remove` |
| `find` | `select` |
| `query` | `select`, bila tidak ada field `sql` |
| `list` | `keys` |

`delete` adalah perintah sendiri, sama hasilnya dengan `remove`.

---

## 5. Daftar op

Perintah di bawah ini sama pada keenam driver.

### Tulis dan baca

| Op | Guna |
|---|---|
| `insert` | tambah satu objek, atau satu array untuk banyak record. Satu objek kembali sebagai objek. Banyak record kembali sebagai array |
| `set` | timpa satu record. Wajib ada `key` |
| `get` | baca satu record |
| `has` | `true` bila record ada |
| `update` | gabung field. Satu `key`, atau `where`, atau `all: true` |
| `delete`, `remove` | hapus. Satu `key`, atau `where`, atau `all: true` |
| `select` | banyak record |
| `keys` | daftar id dalam satu table |
| `tables` | daftar nama table |
| `count` | jumlah record |
| `search` | cari teks di isi record (`q`) |
| `clear` | hapus satu table, atau semua data namespace bila `all: true` |
| `export` | seluruh data namespace |
| `import` | masukkan hasil `export` |
| `info` | driver, jumlah, ukuran |

`insert` satu record:

```js
await mysql({ op: "insert", table: "users", data: { nama: "Budi", umur: 30 } });
```

`insert` banyak record:

```js
await mysql({
  op: "insert",
  table: "users",
  data: [
    { nama: "Budi", umur: 40 },
    { nama: "Siti", umur: 17 },
  ],
});
```

### `where`

```json
{ "umur": 30 }
{ "umur": { ">": 20 } }
{ "nama": { "like": "bud%" } }
{ "umur": { "between": [20, 40] } }
{ "kota": { "in": ["bdg", "jkt"] } }
{ "kota": { "notin": ["bdg"] } }
{ "hapus": { "null": true } }
```

Operator: `=`, `!=`, `>`, `>=`, `<`, `<=`, `like`, `not_like`, `in`, `notin`, `between`, `null`, `isnotnull`. Alias: `eq`, `ne`, `notlike`, `not_in`, `isnull`, `is_null`, `is_not_null`.

Gabungan:

```json
{
  "op": "select",
  "table": "users",
  "where": {
    "and": [
      { "kota": "Jakarta" },
      { "or": [ { "umur": { ">": 30 } }, { "nama": "Siti" } ] }
    ]
  }
}
```

`not` meniadakan satu syarat.

### Urutan dan halaman

```json
{
  "op": "select",
  "table": "users",
  "order": [ { "column": "umur", "dir": "desc" } ],
  "limit": 25,
  "offset": 0,
  "countTotal": true,
  "select": ["nama", "umur"],
  "distinct": true
}
```

`after` memakai nilai kolom urutan pertama sebagai kursor. `after` tidak dipakai bersama `group`.

### Kelompok dan hitungan

```json
{
  "op": "select",
  "table": "orders",
  "select": [
    "user_id",
    { "count": "*", "as": "n" },
    { "sum": "total", "filter": { "status": "lunas" }, "as": "lunas" }
  ],
  "group": ["user_id"],
  "having": { "n": { ">": 1 } }
}
```

Fungsi: `count`, `sum`, `avg`, `min`, `max`. `filter` membatasi baris yang dihitung. `distinct` di dalam fungsi membuang nilai kembar.

### `join` dan `nest`

```json
{
  "op": "join",
  "table": "users",
  "joins": [
    { "type": "left", "table": "orders", "on": { "users.id": "orders.user_id" } }
  ],
  "select": ["users.nama", "orders.total"],
  "where": { "orders.total": { ">": 100 } }
}
```

`type`: `inner`, `left`, `right`, `full`.

`nest` mengumpulkan baris anak di bawah induk:

```json
{
  "op": "join",
  "table": "users",
  "joins": [ { "type": "left", "table": "orders", "on": { "users.id": "orders.user_id" } } ],
  "nest": { "children": "orders", "on": "users.id" }
}
```

### Skema

Tipe kolom: `text`, `integer`, `real`, `bool`. Nilai yang tidak cocok membalas `type_mismatch`.

```js
await db({
  op: "create_table",
  table: "users",
  columns: { nama: "text", umur: "integer" },
});

await db({ op: "show_tables" });
await db({ op: "add_column", table: "users", column: "kota", type: "text" });
await db({ op: "drop_column", table: "users", column: "kota" });
await db({ op: "rename_column", table: "users", from: "nama", to: "name" });
await db({ op: "rename_table", table: "users", to: "orang" });
await db({ op: "drop_table", table: "orang" });

await db({
  op: "create_index",
  table: "users",
  name: "idx_users_kota",
  columns: ["kota"],
  unique: true,
});
```

### Transaksi

`tx` menyimpan beberapa dokumen `insert`, `update`, dan `delete` bersama. Satu langkah gagal, tidak ada yang tersimpan.

`transaction` untuk SQL MySQL atau PostgreSQL. Setiap langkah satu kalimat `insert`, `update`, `delete`, atau `select`. Langkah yang gagal membatalkan langkah sebelumnya.

```js
await db({
  op: "tx",
  ops: [
    { op: "update", table: "users", where: { nama: "Siti" }, data: { umur: 18 } },
    { op: "delete", table: "orders", where: { status: "batal" } },
  ],
});

await db({
  op: "transaction",
  steps: [
    { sql: "INSERT INTO pesanan (nama) VALUES (?)", params: ["Budi"] },
    { sql: "INSERT INTO pesanan_item (pesanan_id, barang, jumlah) VALUES (LAST_INSERT_ID(), ?, ?)", params: ["Buku", 2] },
  ],
});
```

### Migrasi

```js
await db({
  op: "create_migration",
  version: 1,
  name: "umur-siti",
  ops: [
    { op: "update", table: "users", where: { nama: "Siti" }, data: { umur: 18 } },
  ],
});

await db({ op: "migrate" });
await db({ op: "migration_status" });
```

---

## 6. Bentuk balasan

Sukses:

```json
{ "ok": true, "data": { "nama": "Budi" }, "meta": { "key": "k-...", "driver": "mysql", "ms": 8 } }
```

Gagal:

```json
{ "ok": false, "error": "not_found", "hint": "Record users/budi tidak ada" }
```

| Field | Arti |
|---|---|
| `ok` | berhasil atau gagal |
| `data` | hasil |
| `meta` | `ms`, `count`, `key`, `driver`, `rowsAffected`, `deleted` |
| `error` | kode, hanya saat gagal |
| `hint` | kalimat perbaikan |

| `error` | Arti |
|---|---|
| `bad_request` | perintah rusak, field wajib kosong, atau badan HTTP bukan JSON |
| `unknown_op` | `op` tidak dikenal |
| `not_found` | record tidak ada |
| `no_table` | `table` wajib |
| `no_where` | `update` atau `delete` massal tanpa `where` dan tanpa `all: true` |
| `type_mismatch` | nilai tidak cocok dengan tipe kolom |
| `validation_failed` | `tx`, `having`, atau `after` tidak sah |
| `corrupt_data` | isi tersimpan bukan JSON |
| `quota_exceeded` | ruang browser penuh |
| `driver_unavailable` | nama belum masuk `config.json`, atau mesinnya tidak bisa dibuka |
| `config_error` | `config.json` driver belum lengkap |
| `sql_error` | perintah SQL di server gagal |
| `network_error` | server atau database tidak terjangkau. Sambungan yang putus dibuang, lalu perintah yang sama dicoba sekali lagi. nx8v tetap jalan. |
| `unauthorized` | Firebase menolak token (401) |
| `permission_denied` | Firebase Rules menolak (403) |
| `timeout` | server tidak menjawab dalam batas waktu |
| `bad_gateway` | balasan server bukan JSON yang diharapkan |

---

## 7. Pengaman

`update` dan `delete` tanpa `key`, tanpa `where`, dan tanpa `all: true` ditolak dengan `no_where`.

```js
await storage({ op: "delete", table: "users" });
```

`clear` tanpa `table` dan tanpa `all: true` ditolak dengan `no_table`.

```js
await storage({ op: "clear", table: "users" });
await storage({ op: "clear", all: true });
```

---

## 8. Memilih driver

| | `storage` | `indexeDB` | `sqlite` | `mysql` | `postgreSQL` | `firebase` |
|---|---|---|---|---|---|---|
| Tempat | browser | browser | berkas `.db` | MySQL | PostgreSQL | Firebase |
| Jaringan | tidak | tidak | ke nx8v | ke nx8v, lalu MySQL | ke nx8v, lalu PostgreSQL | ke nx8v, lalu Firebase |
| Dinyalakan di | — | — | `config.json` `drivers` | sama | sama | sama |
| Perintah dokumen | sama | sama | sama | sama | sama | sama |
| `query` (SQL sendiri) | tidak | tidak | tidak | ya | ya | tidak |

```js
import { mysql } from "/storage";

const db = mysql;
await db({ op: "select", table: "users", where: { umur: { ">": 20 } } });
```

`db.config({ url })` pada driver server hanya mengganti alamat POST. Sambungan database tetap dibaca dari `config.json` di foldernya.

---

## 9. Gaya ringkas

```js
import { storage } from "/storage";

await storage.set("users", "budi", { nama: "Budi" });
await storage.get("users", "budi");
await storage.has("users", "budi");
await storage.insert("users", { nama: "Siti" });
await storage.update("users", "budi", { umur: 31 });
await storage.update("users", { umur: { ">": 30 } }, { status: "senior" });
await storage.remove("users", "budi");
await storage.select("users", { umur: { ">": 20 } });
await storage.keys("users");
await storage.count("users");
await storage.tables();
await storage.search("users", "budi");
await storage.clear("users");
await storage.export();
await storage.import(cadangan);
await storage.info();
```

Metode yang sama ada pada `indexeDB`, `sqlite`, `mysql`, `postgreSQL`, dan `firebase`.

---

## 10. Contoh

Form di `public/myform.html` mengimpor driver lalu memilih satu:

```js
import { Nxform } from "/form";
import { mysql } from "/storage";

const db = mysql;

const res = await new Nxform({
  elementFormId: "myForm",
  type: "insert",
  required: ["nama", "alamat", "jk"],
});

if (res?.status) {
  const simpan = await db({ op: "insert", table: "users", data: res.data });
  console.log(simpan);
}
```

Cadangan:

```js
const cadangan = await db({ op: "export" });
await db({ op: "import", data: cadangan.data });
```

---

## 11. Batasan

1. `storage` dan `indexeDB` hanya ada di browser itu. Membersihkan data situs menghapus isinya.
2. `storage` menyimpan teks dan kuotanya kecil. Data besar di browser memakai `indexeDB`.
3. Isi di browser bisa dibaca lewat DevTools. Jangan simpan rahasia di `storage` atau `indexeDB`.
4. Dua tab yang menulis `storage` atau `indexeDB` bersamaan: tulisan terakhir yang tinggal.
5. `tx` pada `storage` dan `indexeDB` membatalkan perubahan di memori bila satu langkah gagal, lalu menulis hasilnya. Itu bukan kunci database antar tab.
6. `sqlite`, `mysql`, `postgreSQL`, dan `firebase` berbagi data antar perangkat karena datanya di server.
7. `config.json` driver berisi host dan kata sandi. Berkas tersembunyi, `config.json`, serta ekstensi `.php`, `.sql`, `.pem`, `.key`, `.so`, dan `.dll` tidak dikirim lewat HTTP.
8. Mengubah `drivers` atau sambungan baru terbaca setelah nx8v dijalankan ulang.
9. Akun halaman ada di modul `oauth`. Unggah berkas ada di modul `upload`. Token mesin ada di modul `middleware`. Modul storage tidak menyimpan ketiganya.

---

## 12. Berkas

```
modules/storage/
├── index.js                 perintah JSON di browser
├── engine.js                perintah yang sama untuk storage dan indexeDB
├── server.cjs               dipasang NX8V; hanya memuat nama di config.json
├── config.json              daftar drivers yang hidup di server
├── kv.cjs                   perintah untuk sqlite, mysql, dan postgreSQL
├── model/                   SQL bisnis, satu berkas satu urusan
│   ├── index.js
│   ├── pelanggan.js
│   └── pesanan.js
├── localstorage/index.js
├── indexeDB/index.js
├── sqlite/index.js          POST /api/storage
├── sqlite/server.cjs
├── sqlite/data.db
├── mysql/index.js           POST /api/storage  driver mysql
├── mysql/server.cjs
├── mysql/config.json
├── postgreSQL/index.js      POST /api/storage  driver postgreSQL
├── postgreSQL/server.cjs
├── postgreSQL/config.json
├── firebase/index.js        POST /api/storage  driver firebase
├── firebase/server.cjs
└── firebase/config.json
```

Import di dalam folder modul memakai path relatif. Halaman tetap `import { mysql } from "/storage"`.

```js
import { localstorage } from "./localstorage/index.js";
import "./engine.js";
```
