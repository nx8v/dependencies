# Middleware

Pemeriksaan `Authorization: Bearer` untuk API yang dipilih. Daftar target, token, dan grant disimpan di SQLite, bukan di environment dan bukan di `config.json`.

Modul ini berdiri sendiri. `modules/api` dan `modules/proxy` tidak membandingkan token. NX8V memanggil modul ini lebih dulu karena `"middleware"` adalah kunci pertama di `dependencies`.

Alamat pengelola adalah `/middleware`, terpisah dari `/api`. API yang tidak masuk tabel target tetap terbuka. `POST /api/storage` tidak ikut tabel ini. Akun halaman ada di modul `oauth` dan tidak menjadi target Bearer. Path `/api/oauth` dilewati pemeriksaan ini.

Jalankan ulang nx8v sekali supaya modul ini terpasang. Perubahan isi SQLite setelah itu langsung berlaku.

Dalam contoh di bawah, `TOKEN_ADMIN` dan `TOKEN_KLIEN` adalah nilai field `token` dari balasan `201`. Jangan menulis rahasia itu ke berkas ini.

---

## Daftar isi

1. [Token pertama](#1-token-pertama)
2. [Mengunci satu API](#2-mengunci-satu-api)
3. [Token baru](#3-token-baru)
4. [Mengakhiri token](#4-mengakhiri-token)
5. [Tiga tabel](#5-tiga-tabel)
6. [Alamat pengelola](#6-alamat-pengelola)
7. [Permintaan yang dikunci](#7-permintaan-yang-dikunci)
8. [Berkas](#8-berkas)

---

## 1. Token pertama

Selama tabel token kosong, `POST /middleware/tokens` tidak meminta header, dan hanya diterima dari mesin ini (`127.0.0.1`). Permintaan dari alamat lain membalas `401`.

```bash
curl -X POST "http://localhost:5023/middleware/tokens" ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"admin\"}"
```

Balasan `201`:

```json
{ "name": "admin", "token": "NX_nilai-ini-hanya-muncul-sekali" }
```

Simpan `token`. Setiap rahasia diawali `NX_`. Bila field `token` dikirim tanpa awalan itu, server yang menambahkannya. Permintaan berikutnya ke `/middleware` memakai:

```text
Authorization: Bearer NX_nilai-ini-hanya-muncul-sekali
```

Token asli tidak disimpan di SQLite, hanya hash SHA-256. `GET /middleware/tokens` mengembalikan nama, bukan rahasia. Nilai yang hilang tidak bisa ditampilkan lagi.

Tanpa `days`, `months`, atau `years`, token tidak kedaluwarsa. Contoh `admin` di atas begitu. Bila token pertama ikut dibatasi, isi salah satu jumlah pada badan yang sama, misalnya `{"name":"admin","years":1}`. `days` dihitung 24 jam. `months` dan `years` mengikuti kalender. Balasan `201` menambah `expires`, waktu UTC saat token berhenti berlaku.

Token pertama otomatis mendapat grant `middleware` / `middleware`. Grant itu membuka alamat pengelola. Resource seperti `posts` tetap butuh grant sendiri.

`POST` dengan nama `admin` untuk kedua kali membalas `400` karena nama itu sudah ada.

---

## 2. Mengunci satu API

Header di contoh ini adalah token `admin` yang disimpan pada langkah 1.

Kunci resource `posts`:

```bash
curl -X POST "http://localhost:5023/middleware/targets" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer TOKEN_ADMIN" ^
  -d "{\"kind\":\"api\",\"name\":\"posts\"}"
```

Beri nama `admin` hak memanggil `posts`. Field `token` di badan JSON adalah nama klien, bukan rahasia:

```bash
curl -X POST "http://localhost:5023/middleware/grants" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer TOKEN_ADMIN" ^
  -d "{\"token\":\"admin\",\"kind\":\"api\",\"name\":\"posts\"}"
```

`GET /api/posts` tanpa header membalas `401`. Dengan Bearer `admin`, permintaan diteruskan ke modul API:

```bash
curl "http://localhost:5023/api/posts" ^
  -H "Authorization: Bearer TOKEN_ADMIN"
```

Alias Proxy yang sudah terdaftar dikunci dengan cara yang sama. Permintaan publiknya `GET /api/feed/posts`.

```bash
curl -X POST "http://localhost:5023/middleware/targets" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer TOKEN_ADMIN" ^
  -d "{\"kind\":\"proxy\",\"name\":\"feed\"}"

curl -X POST "http://localhost:5023/middleware/grants" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer TOKEN_ADMIN" ^
  -d "{\"token\":\"admin\",\"kind\":\"proxy\",\"name\":\"feed\"}"
```

Membuka kembali resource berarti menghapus target. Grant pada target itu ikut terhapus:

```bash
curl -X DELETE "http://localhost:5023/middleware/targets/api/posts" ^
  -H "Authorization: Bearer TOKEN_ADMIN"
```

---

## 3. Token baru

Nama harus baru. Perintah ini wajib Bearer yang punya grant `middleware`, yaitu `admin` pada contoh ini. Masa berlaku memakai salah satu field: `days`, `months`, atau `years`.

Tiga puluh hari:

```bash
curl -X POST "http://localhost:5023/middleware/tokens" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer TOKEN_ADMIN" ^
  -d "{\"name\":\"klien\",\"days\":30}"
```

Enam bulan, atau satu tahun:

```bash
curl -X POST "http://localhost:5023/middleware/tokens" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer TOKEN_ADMIN" ^
  -d "{\"name\":\"musim\",\"months\":6}"

curl -X POST "http://localhost:5023/middleware/tokens" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer TOKEN_ADMIN" ^
  -d "{\"name\":\"tahunan\",\"years\":1}"
```

Mengisi dua field sekaligus, misalnya `days` dan `months`, membalas `400`. Tanpa ketiga field itu, token tidak kedaluwarsa.

Balasan `201`:

```json
{
  "name": "klien",
  "token": "NX_nilai-ini-hanya-muncul-sekali",
  "expires": "2026-11-24T00:00:00.000Z"
}
```

`expires` adalah saat token berhenti. `GET /middleware/tokens` menampilkan `expires` yang sama, atau `null` bila tidak ada batas. Rahasia tidak ikut.

Token itu belum boleh mengelola `/middleware` dan belum boleh memanggil `posts`.

Hak memanggil `posts`:

```bash
curl -X POST "http://localhost:5023/middleware/grants" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer TOKEN_ADMIN" ^
  -d "{\"token\":\"klien\",\"kind\":\"api\",\"name\":\"posts\"}"
```

Hak mengelola Middleware, bila `klien` juga boleh menambah target dan token. Grant ini tidak membutuhkan baris target:

```bash
curl -X POST "http://localhost:5023/middleware/grants" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer TOKEN_ADMIN" ^
  -d "{\"token\":\"klien\",\"kind\":\"middleware\",\"name\":\"middleware\"}"
```

`POST /api/storage` dari mesin lain dikunci setelah token pertama ada. Halaman di mesin ini, termasuk form, tetap bisa mengirim storage tanpa Bearer. Mesin lain membutuhkan grant `storage`:

```bash
curl -X POST "http://localhost:5023/middleware/grants" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer TOKEN_ADMIN" ^
  -d "{\"token\":\"admin\",\"kind\":\"storage\",\"name\":\"storage\"}"
```

`"token"` di badan itu nama klien yang diberi izin. Header tetap Bearer pengelola.

Setelah grant ada, mesin lain mengirim perintah storage yang sama dengan `modules/storage/README.md`. Badan HTTP adalah JSON itu plus `"driver"`. JSON harus satu rangkaian utuh. Pindah baris di tengah angka, misalnya `40` terbelah, membalas `body bukan JSON`.

```bash
curl --location -X POST "http://localhost:5023/api/storage" ^
  --header "Authorization: Bearer TOKEN_ADMIN" ^
  --header "Content-Type: application/json" ^
  --data "{\"op\":\"insert\",\"table\":\"users\",\"driver\":\"mysql\",\"data\":[{\"nama\":\"Budi\",\"umur\":40},{\"nama\":\"Siti\",\"umur\":17}]}"
```

Bearer di perintah ini adalah rahasia token yang namanya `admin`, karena grant di atas diberikan kepada `admin`. Balasan sukses `{ "ok": true, "data": [ ... ] }`.

Field `token` yang dikirim sendiri juga diterima. Panjangnya minimal 8 karakter. Bila field itu kosong, server yang membuat nilainya.

```bash
curl -X POST "http://localhost:5023/middleware/tokens" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer TOKEN_ADMIN" ^
  -d "{\"name\":\"mesin\",\"token\":\"NX_rahasia-mesin-123\"}"
```

---

## 4. Mengakhiri token

Token yang membawa `days`, `months`, atau `years` berhenti sendiri pada `expires`. Setelah itu Bearer membalas:

```json
{ "error": "unauthorized", "hint": "token kedaluwarsa" }
```

Token tanpa ketiga field itu tidak berhenti sendiri. Menghapus baris mengakhiri token lebih awal. Grant milik nama itu ikut terhapus.

```bash
curl -X DELETE "http://localhost:5023/middleware/tokens/klien" ^
  -H "Authorization: Bearer TOKEN_ADMIN"
```

`admin` tetap hidup. Menghapus satu grant tanpa menghapus token:

```bash
curl -X DELETE "http://localhost:5023/middleware/grants/klien/api/posts" ^
  -H "Authorization: Bearer TOKEN_ADMIN"
```

Setelah grant itu hilang, Bearer `klien` pada `GET /api/posts` membalas `401`. Nama `klien` masih ada dan masih bisa diberi grant lagi.

---

## 5. Tiga tabel

Berkasnya `modules/middleware/vault`. Tanpa ekstensi, jadi tidak terunduh lewat HTTP. `NX8V_MIDDLEWARE_FILE` memindahkan lokasi berkas.

| Tabel | Isi |
|---|---|
| `auth_target` | API yang wajib token. `kind` adalah `api` atau `proxy`. `name` adalah resource atau alias |
| `auth_token` | nama klien, hash SHA-256, dan `expires_at`. Kosong berarti tidak kedaluwarsa. Token asli tidak disimpan |
| `auth_grant` | nama token, `kind`, dan `name` target yang boleh dipanggil |

`kind` untuk target hanya `api` dan `proxy`. Grant `middleware` / `middleware` tidak ditulis lewat `POST /middleware/targets`. Token pertama menerimanya otomatis. Token lain menerimanya lewat `POST /middleware/grants`.

---

## 6. Alamat pengelola

Semua baris di bawah ini, setelah token pertama ada, meminta `Authorization: Bearer` dari token yang punya grant `middleware`.

| Permintaan | Hasil |
|---|---|
| `GET /middleware/targets` | daftar target |
| `POST /middleware/targets` | `{ "kind":"api", "name":"posts" }` menambah target |
| `DELETE /middleware/targets/api/posts` | target dan grant-nya dihapus. API itu terbuka lagi |
| `GET /middleware/tokens` | nama token dan `expires`, tanpa rahasia |
| `POST /middleware/tokens` | `{ "name":"klien", "days":30 }`. Ganti `days` dengan `months` atau `years`. Satu jumlah saja. Rahasia dibuat bila field `token` kosong. Balasan `201` memuat rahasia sekali dan `expires` bila ada batas |
| `DELETE /middleware/tokens/klien` | token dan grant-nya dihapus |
| `GET /middleware/grants` | daftar grant. `token` di daftar ini adalah nama klien |
| `POST /middleware/grants` | `{ "token":"klien", "kind":"api", "name":"posts" }` |
| `DELETE /middleware/grants/klien/api/posts` | satu grant dihapus |

`GET /middleware/tokens` tidak mengembalikan rahasia. CLI tidak mencetak badan JSON.

---

## 7. Permintaan yang dikunci

| Target | Permintaan yang diperiksa |
|---|---|
| `kind: api`, `name: posts` | `/api/posts`, `/api/posts/k-1`, `/api/posts/k-1/comments` |
| `kind: proxy`, `name: feed` | `/api/feed` dan path di bawahnya, bila `feed` ada di alias proxy |

`OPTIONS` tidak diperiksa, supaya preflight CORS tetap dijawab modul API atau Proxy.

Bila target aktif dan Bearer tidak punya grant, balasannya:

```json
{ "error": "unauthorized", "hint": "Authorization: Bearer tidak cocok" }
```

Statusnya `401`. Permintaan tidak diteruskan ke modul API atau Proxy. Balasan yang sama muncul di `/middleware` bila Bearer tidak punya grant `middleware`.

---

## 8. Berkas

```text
modules/middleware/
├── server.cjs    pemeriksaan Bearer dan alamat pengelola
├── vault         SQLite, dibuat saat modul pertama kali jalan
└── README.md
```
