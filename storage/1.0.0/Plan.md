# Rencana API untuk pihak lain

Bentuk yang dituju sama dengan [JSONPlaceholder](https://jsonplaceholder.typicode.com): daftar resource, ambil satu, buat, ubah, hapus. Pihak lain memakai URL dan JSON. Mereka tidak mengirim `op`, `driver`, atau nama database.

## Keputusan

Folder baru: `modules/api`.

NX8V tidak perlu cara baru untuk menerima endpoint. Runtime sudah memanggil `modules/<nama>/server.cjs` untuk setiap nama di `dependencies`, sebelum `server.js`. Modul `api` membaca daftar resource dari `config.json` dan mencocokkan URL dengan daftar itu.

`server.js` tetap berkas hasil `nx8v init`. Tidak ada rute `posts` atau `users` di situ.

Storage tetap mesin data. `POST /api/storage` tetap untuk halaman sendiri (`myform` dan perintah `{ op, table, data }`). API pihak lain tidak melewati alamat itu.

Satu folder untuk semua resource. `posts`, `comments`, dan `users` adalah nama di daftar, bukan folder baru masing-masing.

## Mengapa prefiks `/api`

Situs ini SPA. `GET` yang bukan berkas dan bukan di bawah `/api` dilayani sebagai halaman. `GET /posts` akan jatuh ke `index.html`.

`GET` dan `POST` di bawah `/api` tidak ditelan SPA, lalu sampai ke `handle` modul. Alamat pihak lain:

```text
http://localhost:5023/api/posts
http://localhost:5023/api/posts/k-1
http://localhost:5023/api/posts/k-1/comments
http://localhost:5023/api/comments?postId=k-1
```

Tiga nama sudah terpakai dan tidak boleh menjadi resource: `storage`, `hello`, dan berkas di bawah `/api/storage/`.

## Daftar yang diiterasi

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

`handle` mengulang `resources`. Nama yang tidak ada di daftar mendapat 404. Menambah resource berarti menambah satu string, lalu menjalankan ulang nx8v. Tidak ada kompilasi ulang.

`driver` harus sudah tertulis di `modules/storage/config.json` pada `drivers`. Sambungan host, port, user, dan password tetap di `modules/storage/mysql/config.json`. Berkas `modules/api/config.json` hanya menyebut nama driver. Berkas modul ber-ekstensi dapat diunduh lewat HTTP, jadi rahasia tidak ditaruh di sana.

## Metode

| Permintaan | Perintah storage | Balasan |
|---|---|---|
| `GET /api/posts` | `select` tabel `posts` | `200` dan array |
| `GET /api/posts/:id` | `select` dengan `id` | `200` objek, atau `404` |
| `GET /api/comments?postId=k-1` | `select` dengan `where` sama dengan query | `200` dan array |
| `GET /api/posts/:id/comments` | `select` `comments` bila `relations.posts.comments` ada | `200` dan array |
| `POST /api/posts` | `insert` | `201` dan objek baru |
| `PUT /api/posts/:id` | `set` pada `id` itu | `200` objek, atau `404` |
| `PATCH /api/posts/:id` | `update` pada `id` itu | `200` objek, atau `404` |
| `DELETE /api/posts/:id` | `delete` pada `id` itu | `200` dan `{}` |

Query hanya perbandingan sama dengan. `id` adalah string milik storage (`k-...`), atau `id` yang dikirim klien saat `POST`. JSONPlaceholder memakai angka. Di sini `id` tetap string supaya tidak bentrok dengan kunci yang sudah ada di `nx_kv`.

Badan `POST`, `PUT`, dan `PATCH` adalah objek resource, bukan bungkus `{ op, data }`. `PUT` mengganti isi record. `PATCH` menggabungkan field yang dikirim.

Balasan sukses adalah objek atau array itu sendiri. `{ ok, error, hint, meta }` tetap milik `POST /api/storage`. Pihak lain melihat status HTTP:

| Status | Arti |
|---|---|
| `200` | daftar, satu record, pengganti, gabungan, atau hapus |
| `201` | record baru |
| `400` | badan bukan JSON, atau resource menolak isi |
| `401` | token wajib tetapi tidak ada |
| `404` | resource atau `id` tidak ada |
| `405` | metode tidak ada di tabel di atas |
| `503` | driver di config belum hidup |

## Modul `api` memanggil storage dari dalam proses

`modules/api/server.cjs` memakai `handle` driver yang sama dengan `modules/storage/mysql/server.cjs` (atau driver lain yang tertulis di config). Tidak ada HTTP ke `localhost` untuk menyimpan data.

Alurnya:

1. NX8V melihat `"api"` di `dependencies`.
2. Permintaan yang bukan berkas statis masuk ke `modules/api/server.cjs`.
3. Path dipecah. Nama resource dicocokkan dengan daftar.
4. Perintah JSON storage dijalankan pada `namespace` config.
5. Hasil dibuka menjadi objek atau array, lalu dikirim dengan status HTTP.
6. Path lain, termasuk `POST /api/storage`, dikembalikan `false` supaya modul storage dan `server.js` yang mengurusnya.

`project.json` menambah `"api": "1.0.0"` di `dependencies`. Urutan kunci tidak masalah selama `handle` yang tidak mengenal path mengembalikan `false`.

## Pihak lain di luar mesin ini

Untuk pemanggilan dari origin lain, `OPTIONS` dijawab di modul yang sama, dengan `Access-Control-Allow-Methods` sesuai tabel metode. Origin yang diizinkan dibaca dari env `NX8V_API_ORIGIN`. Kosong berarti `*`, seperti JSONPlaceholder di mesin sendiri.

Token dan daftar API yang wajib Bearer ada di modul `middleware`, disimpan di SQLite. Kosong berarti API itu tidak dikunci.

CLI mencetak satu baris per permintaan API ini: metode, path, dan status. Badan JSON dan token tidak dicetak. `GET` halaman dan modul tetap diam.

## Yang tidak berubah

- `server.js` tetap template init.
- `POST /api/storage` dan enam driver tetap seperti sekarang.
- `const db = mysql` di `myform.html` tidak dialihkan ke API ini.
- Runtime C++ tidak mendapat daftar endpoint.
- Data `users` yang sudah ada (WinPG, asasa, WinMY, dan baris lain) tidak dipindah atau dihapus. Resource `users` pada API ini memakai `namespace` `api`, terpisah dari namespace form.

## Urutan saat dikerjakan

1. `modules/api/config.json` dengan daftar resource dan relations di atas, driver `mysql`.
2. `modules/api/server.cjs` yang mengiterasi daftar itu dan menerjemahkan metode ke perintah storage.
3. `"api"` di `dependencies`.
4. Uji enam URL: daftar, satu id, query, nested, `POST`, `PATCH`, `DELETE`.
5. Baru isi contoh JSONPlaceholder bila URL kosong terasa kurang. Isi contoh adalah data baru di namespace `api`, bukan pengganti data form.
