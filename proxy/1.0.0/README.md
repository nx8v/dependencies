# Proxy

Meneruskan permintaan HTTP ke mesin lain. Pihak luar melihat alamat di server ini. URL mesin tujuan tetap di server.

Alamat publiknya sama dengan resource API: `/api/<alias>`. Kata `proxy` tidak muncul di URL. Alias yang belum terdaftar tidak diklaim, jadi `/api/posts` tetap milik modul API.

`server.js` tetap berkas hasil `nx8v init`. NX8V memasang modul ini karena `"proxy"` ada di `dependencies` pada `project.json`.

---

## Daftar isi

1. [Mulai cepat](#1-mulai-cepat)
2. [Alias dan tujuan](#2-alias-dan-tujuan)
3. [Yang diteruskan](#3-yang-diteruskan)
4. [Bentuk balasan](#4-bentuk-balasan)
5. [Akses dari luar](#5-akses-dari-luar)
6. [Berkas](#6-berkas)

---

## 1. Mulai cepat

Alias contohnya `feed`. Setelah `upstreams` terisi, jalankan ulang nx8v, lalu:

```bash
curl "http://localhost:5023/api/feed/posts"
curl "http://localhost:5023/api/feed/posts/1"
```

Pihak luar tidak mengirim URL mesin tujuan. Mereka hanya menyebut alias.

---

## 2. Alias dan tujuan

`modules/proxy/config.json` hanya berisi nama publik. Berkas ini ber-ekstensi, jadi dapat diunduh. Jangan tulis URL di sini.

```json
{
  "aliases": ["feed"]
}
```

URL tujuan ada di `modules/proxy/upstreams`, tanpa ekstensi:

```json
{
  "feed": "https://mesin-lain.example"
}
```

`GET /api/feed/posts/1` memanggil `https://mesin-lain.example/posts/1`. Query string ikut. `feed` adalah alias yang sudah tertulis di `aliases`. Nama yang sama dengan resource API, misalnya `posts`, tidak dipakai sebagai alias. Daftar alias dibaca pada setiap permintaan.

Variabel `NX8V_PROXY_UPSTREAMS` menimpa berkas `upstreams`. Isinya objek JSON dengan nama alias yang sama.

Alias yang tidak ada di `aliases` membalas `404`. Klien tidak bisa memilih host sendiri.

---

## 3. Yang diteruskan

| Permintaan | Yang dikirim ke mesin tujuan |
|---|---|
| `GET /api/feed/posts` | `GET <tujuan>/posts` |
| `GET /api/feed/posts/1` | `GET <tujuan>/posts/1` |
| `POST /api/feed/posts` | metode, badan, dan `Content-Type` yang sama |
| `PUT`, `PATCH`, `DELETE` | sama seperti di atas |
| `HEAD` | status dan header, tanpa badan |
| `OPTIONS` | dijawab di server ini, tidak diteruskan |

`Accept` ikut. `Authorization` tidak diteruskan ke mesin tujuan. Header itu diperiksa modul Middleware di server ini. `Host`, cookie, dan header `Location` dari mesin tujuan tidak dikirim balik. Redirect tidak membuka host asli ke klien.

Segmen `..` di path ditolak.

---

## 4. Bentuk balasan

Sukses mengirim status dan badan dari mesin tujuan.

Gagal di server ini:

```json
{ "error": "not_found", "hint": "alias tidak ada" }
```

| Status | `error` | Arti |
|---|---|---|
| status mesin tujuan | | badan mesin tujuan |
| `204` | | jawaban `OPTIONS` |
| `400` | `bad_request` | path tidak sah |
| `401` | `unauthorized` | alias ini dikunci modul Middleware dan Bearer tidak cocok |
| `404` | `not_found` | alias tidak ada |
| `405` | `method_not_allowed` | metode di luar tabel |
| `502` | `bad_gateway` | mesin tujuan tidak menjawab |
| `503` | `driver_unavailable` | alias belum punya tujuan, atau tujuan tidak sah |

Pesan gagal tidak memuat URL tujuan. CLI mencetak metode, path publik tanpa query, dan status.

---

## 5. Akses dari luar

Alias mana yang wajib `Authorization: Bearer` diatur di modul Middleware, lewat SQLite. `OPTIONS` tidak memeriksa token.

`NX8V_PROXY_ORIGIN` kosong berarti `Access-Control-Allow-Origin` bernilai `*`.

---

## 6. Berkas

```text
modules/proxy/
├── config.json    nama alias yang boleh dipanggil
├── upstreams      URL tujuan, tanpa ekstensi
├── server.cjs     meneruskan permintaan
└── README.md
```
