# API

Alamat JSON untuk pihak lain. Bentuknya mengikuti [JSONPlaceholder](https://jsonplaceholder.typicode.com): daftar, satu record, buat, ubah, hapus.

Pihak lain memakai URL dan objek JSON. Mereka tidak mengirim `op`, `driver`, atau nama database. Di dalam proses, modul ini memanggil perintah yang sama dengan `modules/storage`.

`server.js` tetap berkas hasil `nx8v init`. NX8V memasang modul ini karena `"api"` ada di `dependencies` pada `project.json`.

`POST /api/storage` tetap untuk halaman sendiri. Balasan `{ ok, error, hint, meta }` tetap milik alamat itu.

---

## Daftar isi

1. [Mulai cepat](#1-mulai-cepat)
2. [Daftar resource](#2-daftar-resource)
3. [Metode dan perintah storage](#3-metode-dan-perintah-storage)
4. [Query dan relasi](#4-query-dan-relasi)
5. [Bentuk balasan](#5-bentuk-balasan)
6. [Akses dari luar](#6-akses-dari-luar)
7. [Yang tetap di storage](#7-yang-tetap-di-storage)
8. [Berkas](#8-berkas)

---

## 1. Mulai cepat

Server berjalan di port `project.json` (`5023` pada aplikasi ini). Nama resource harus persis seperti di `config.json`. `post` tidak sama dengan `posts`.

```bash
curl --location -X POST "http://localhost:5023/api/posts" ^
  -H "Content-Type: application/json" ^
  -d "{\"title\":\"contoh\",\"body\":\"isi\",\"userId\":\"1\"}"
```

Balasan `201` adalah objek yang baru disimpan, lengkap dengan `id` string (`k-...`).

```bash
curl "http://localhost:5023/api/posts"
curl "http://localhost:5023/api/posts/k-1"
curl "http://localhost:5023/api/comments?postId=k-1"
curl "http://localhost:5023/api/posts/k-1/comments"
```

Setelah mengubah `modules/api/config.json` atau `dependencies`, jalankan ulang nx8v. Proses yang sudah hidup tidak memuat daftar resource yang baru.

---

## 2. Daftar resource

`modules/api/config.json`:

```json
{
  "driver": "mysql",
  "namespace": "api",
  "resources": ["posts", "comments", "albums", "photos", "todos", "users"],
  "relations": {
    "posts": { "comments": "postId" },
    "users": { "posts": "userId", "albums": "userId", "todos": "userId" },
    "albums": { "photos": "albumId" }
  }
}
```

| Field | Arti |
|---|---|
| `driver` | nama driver storage yang mengerjakan perintah. Harus ada di `drivers` pada `modules/storage/config.json` |
| `namespace` | pemisah data di storage. `api` terpisah dari data form |
| `resources` | nama tabel yang boleh dipanggil. Nama di luar daftar membalas `404` |
| `relations` | field penghubung untuk URL bersarang |

Menambah resource berarti menambah satu string di `resources`, lalu menjalankan ulang nx8v. Tidak ada kompilasi ulang dan tidak ada rute baru di `server.js`.

Sambungan host, port, user, dan password tetap di config driver storage, misalnya `modules/storage/mysql/config.json`. Berkas di folder modul yang ber-ekstensi dapat diunduh lewat HTTP, jadi rahasia tidak ditulis di `modules/api/config.json`.

Nama `storage`, `hello`, `proxy`, dan `middleware` dilewati modul ini, begitu juga path di bawah `/api/storage/`. Alias yang sudah terdaftar di modul Proxy, misalnya `feed`, dilayani sebagai `/api/feed`. Pengelola token ada di `/middleware`, terpisah dari `/api`.

Karena situs ini SPA, `GET` di luar `/api` yang bukan berkas dilayani sebagai halaman. Resource pihak lain selalu di bawah `/api`.

---

## 3. Metode dan perintah storage

Badan `POST`, `PUT`, dan `PATCH` adalah objek resource itu sendiri.

| Permintaan | Perintah storage | Balasan sukses |
|---|---|---|
| `GET /api/posts` | `{ op: "select", table: "posts" }` | `200` dan array |
| `GET /api/posts/:id` | `{ op: "get", table: "posts", key }` | `200` dan objek |
| `POST /api/posts` | `{ op: "insert", table: "posts", data }` | `201` dan objek baru |
| `PUT /api/posts/:id` | `get`, lalu `{ op: "set", table, key, data }` | `200` dan objek |
| `PATCH /api/posts/:id` | `{ op: "update", table, key, data }` | `200` dan objek |
| `DELETE /api/posts/:id` | `{ op: "delete", table, key }` | `200` dan `{}` |

`id` adalah string milik storage. `POST` tanpa `id` di badan membuat `k-...`. `id` yang dikirim di badan `POST` dipakai sebagai kunci.

`PUT` mengganti isi record dengan badan yang dikirim. Field yang tidak ikut dikirim hilang. Record yang belum ada membalas `404`, jadi `PUT` tidak membuat record baru.

`PATCH` menggabungkan field yang dikirim ke isi yang sudah ada. Field lain tetap.

`POST` ke path yang sudah berisi id, misalnya `POST /api/posts/k-1`, membalas `405`. URL bersarang juga hanya menerima `GET`.

Badan kosong pada `POST` disimpan sebagai objek kosong. Badan yang bukan objek JSON membalas `400`.

---

## 4. Query dan relasi

Query string menyaring hasil `select`. Setiap field harus sama nilainya. Beberapa field digabung dengan AND. `"1"` cocok dengan `1`.

```text
GET /api/comments?postId=k-1
```

URL bersarang memakai `relations`. `GET /api/posts/k-1/comments` membaca tabel `comments` yang field `postId`-nya sama dengan `k-1`. Query tambahan tetap berlaku. Bila query mengulang field relasi, id induk yang menang.

Nama anak yang tidak ada di `resources`, atau relasi yang tidak tertulis, membalas `404`.

---

## 5. Bentuk balasan

Sukses mengirim objek atau array itu sendiri, plus status HTTP. `id` ada di dalam objek.

Gagal mengirim:

```json
{ "error": "not_found", "hint": "resource tidak ada" }
```

| Status | `error` | Arti |
|---|---|---|
| `200` | | daftar, satu record, hasil `PUT` atau `PATCH`, atau hapus |
| `201` | | record baru |
| `204` | | jawaban `OPTIONS` |
| `400` | `bad_request`, `type_mismatch`, `validation_failed`, `no_where`, `no_table` | path, badan, atau isi ditolak storage |
| `401` | `unauthorized` | target ini dikunci modul Middleware dan Bearer tidak cocok |
| `404` | `not_found` | resource, relasi, atau id tidak ada |
| `405` | `method_not_allowed` | metode tidak ada di tabel metode |
| `503` | `driver_unavailable` dan kesalahan driver lain | driver belum hidup atau database tidak menjawab |

CLI mencetak satu baris per permintaan modul ini: metode, path tanpa query, dan status. Badan JSON dan token tidak dicetak.

---

## 6. Akses dari luar

`OPTIONS` dijawab `204`. Pemeriksaan token dilakukan modul Middleware sebelum permintaan sampai ke sini. Header yang dikirim:

| Header | Nilai |
|---|---|
| `Access-Control-Allow-Origin` | `NX8V_API_ORIGIN`, atau `*` bila kosong |
| `Access-Control-Allow-Methods` | `GET, POST, PUT, PATCH, DELETE, OPTIONS` |
| `Access-Control-Allow-Headers` | `Authorization, Content-Type` |
| `Cache-Control` | `no-store` |

Token tidak diatur di modul ini. API mana yang wajib `Authorization: Bearer` diatur di modul Middleware, lewat SQLite.

---

## 7. Yang tetap di storage

Perintah storage yang tidak ada di tabel metode tetap lewat `POST /api/storage`: `where` bersyarat, `tx`, `join`, `search`, `clear`, `export`, `import`, dan sisanya di `modules/storage/README.md`.

Halaman form tetap memakai driver storage. Data form tidak berada di namespace `api`.

---

## 8. Berkas

```text
modules/api/
├── config.json    daftar resource, relasi, driver, namespace
├── server.cjs     menerjemahkan URL ke perintah storage
└── README.md
```
