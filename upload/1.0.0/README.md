# Upload

Halaman `/upload` menampilkan `2026/10/<nama>` dan gambarnya. Berkas di disk ada di `modules/upload/out/2026/10/<nama>`. Peramban membuka `/2026/10/<nama>`. Alamat itu hanya menjawab pemilik yang masih masuk. Nama modul tidak ditulis di halaman.

```js
import { upload, list, remove } from "/upload";

const hasil = await upload(file);
const daftar = await list("2026/10");
await remove(hasil.file.folder, hasil.file.name);
```

`hasil.file.folder` berisi `2026/10`. `hasil.file.owner` adalah nama akun. `list` hanya mengembalikan berkas milik akun yang sedang masuk. `remove` menghapus berkas itu beserta catatannya. Jenis yang diterima: PNG, JPEG, WEBP, GIF, PDF, TXT, dan CSV. Ukuran maksimal 2 MB.

Tanpa cookie sesi, unggah dan daftar membalas `401`. Membuka berkas tanpa sesi membalas `404`.

Catatan pemilik ada di `modules/upload/vault`, tanpa ekstensi. `NX8V_UPLOAD_FILE` memindahkan berkas itu. Mengubah `server.cjs` baru terbaca setelah nx8v dijalankan ulang.

```bash
curl -b cookies.txt -F "file=@foto.png" http://127.0.0.1:5023/api/upload
curl -b cookies.txt http://127.0.0.1:5023/2026/10/nama-berkas.jpg
```
