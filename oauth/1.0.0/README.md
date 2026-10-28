# OAuth

Akun untuk halaman `/oauth`. Seseorang daftar, masuk, keluar, dan melihat sesi yang sedang aktif. Kata sandi tidak disimpan. Sesi dikirim sebagai cookie `nx_oauth` (HttpOnly, 7 hari).

Ini bukan token `Authorization: Bearer` di modul Middleware. Token itu tetap untuk izin API. Path `/api/oauth` tidak menjadi target Bearer.

Cookie sesi ini wajib untuk mengunggah berkas dan untuk SQL model (`query` serta `transaction`). Tanpa sesi, keduanya membalas `401`. Dokumen form tidak memakai cookie ini.

Akun dan sesi ada di `modules/oauth/vault`, tanpa ekstensi. `NX8V_OAUTH_FILE` memindahkan berkas itu.

```js
import { signup, signin, logout, me } from "/oauth";

await signup("budi", "rahasia12");
await signin("budi", "rahasia12");
await me();
await logout();
```

| Fungsi | Permintaan | Balasan |
| --- | --- | --- |
| `signup(nama, kataSandi)` | `POST /api/oauth/signup` | `201` `{ ok, user: { name } }` dan cookie |
| `signin(nama, kataSandi)` | `POST /api/oauth/signin` | `200` `{ ok, user: { name } }` dan cookie |
| `logout()` | `POST /api/oauth/logout` | `200` `{ ok: true }` dan cookie dihapus |
| `me()` | `GET /api/oauth/me` | `{ ok: true, user }` atau `user: null` |

Nama 3–32 huruf, angka, atau garis bawah. Kata sandi 8–72 karakter. Nama yang sudah ada membalas `409`. Nama atau kata sandi yang salah membalas `401` dengan petunjuk yang sama.
