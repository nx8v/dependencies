# Form — `Nxform`

Helper validasi form + pengumpulan data untuk form HTML biasa (tanpa framework).
`Nxform` memvalidasi field wajib, menampilkan error langsung di DOM, dan mengembalikan
data form dalam bentuk Promise.

**Entry point:** `modules/form/index.js`
**Export:** `Nxform` (named export, class)
**Import di halaman:** `import { Nxform } from "/form";`

> **Konvensi NX8V.** Nama modul sama dengan nama folder di `modules/`. Browser yang meminta
> `/form` untuk HTML menerima `public/form.html`, sedangkan `import` dari `/form` menerima
> `modules/form/index.js`. Contoh: `public/myform.html` memakai `import { Nxform } from "/form";`.
> Nama modul **wajib** terdaftar di `dependencies` pada `project.json`:
>
> ```json
> "dependencies": { "form": "1.0.0", "spinner": "1.0.0" }
> ```

---

## Quick start

```js
import { Nxform } from "/form";

const res = await new Nxform({
  elementFormId: "myForm",
  type: "insert",
});

if (res?.status) {
  console.log(res.data);   // data form siap dikirim
} else {
  console.log("validasi gagal");
}
```

Karena `constructor` mengembalikan Promise, **wajib** pakai `await` / `.then()`.

---

## Config constructor

```js
new Nxform({
  elementFormId,     // string  (wajib) ID form / container
  getValidationBy,   // string[] default ["name"]
  required,          // object | string[] default {}
  noValidationBy,    // string[] default []
  type,              // "insert" | "update" default "insert"
  spinner,           // object | null default null
})
```

| Option           | Tipe                  | Default      | Keterangan |
|------------------|-----------------------|--------------|------------|
| `elementFormId`  | `string`              | —            | ID elemen yang dicari lewat `document.getElementById`. Kalau tidak ada → Promise resolve `null`. |
| `getValidationBy`| `string[]`            | `["name"]`   | Diteruskan ke `collectFormData` saat mengambil data. **Tidak** dipakai oleh logika validasi (validasi selalu cari `[name=...]` lalu `#id`). |
| `required`       | `object \| string[]`  | `{}`         | Daftar field wajib. Lihat [Normalisasi `required`](#normalisasi-required). |
| `noValidationBy` | `string[]`            | `[]`         | Nama field yang **dikecualikan** dari validasi wajib. |
| `type`           | `string`              | `"insert"`   | Selain `"update"` → form otomatis di-reset setelah validasi sukses. |
| `spinner`        | `object \| null`      | `null`       | Konfigurasi loading indicator. Lihat [Spinner](#spinner). |

---

## Return value

Promise resolve ke salah satu dari:

| Kondisi | Nilai |
|---|---|
| Elemen form tidak ditemukan | `null` |
| Ada field yang tidak valid | `{ status: false, data: null }` |
| Semua valid | `{ status: true, data: <hasil collectFormData> }` |

```js
const res = await new Nxform({ elementFormId: "myForm" });

if (res === null)          { /* form tidak ada */ }
else if (!res.status)      { /* error sudah tampil di DOM */ }
else                       { /* res.data */ }
```

Error **tidak** dilempar sebagai exception — semuanya dikomunikasikan lewat `status`.

---

## Format data hasil `collectFormData`

`collectFormData(formId, getValidationBy)` adalah fungsi lokal di dalam `index.js`.
Ia membaca `form.elements` dan membangun object `data`.

### Pemilihan key

Key tiap field diambil dari sumber pertama yang tidak kosong, sesuai urutan `getValidationBy`:

```js
getValidationBy: ["name"]        // pakai el.name, fallback tidak ada
getValidationBy: ["id"]          // pakai el.id
getValidationBy: ["name", "id"]  // el.name, kalau kosong pakai el.id
```

Field yang tidak punya key sama sekali **dilewati**.

### Nilai per tipe field

| Field | Nilai |
|---|---|
| `text`, `email`, `password`, `date`, `number`, `textarea`, `select` tunggal | `string` — otomatis `.trim()` untuk tipe teks |
| `radio` | `string` — hanya radio yang `checked`; satu nilai per grup |
| `checkbox` | **Selalu `Array`** — hanya yang `checked`; `value` kosong → `"on"` |
| `select[multiple]` | **Selalu `Array`** — dari `selectedOptions` |
| `file` | `File` (tunggal) atau `File[]` (kalau `multiple`); file kosong → dilewati |
| `input[multiple]` | **Selalu `Array`** |

### Field yang dilewati

- `el.disabled === true`
- Tipe: `submit`, `button`, `reset`, `image`
- Tag: `button`, `fieldset`, `output`, `object`, `option`
- `file` tanpa file terpilih
- `radio` / `checkbox` yang tidak `checked`

### Nilai ganda → Array

Kalau satu key muncul lebih dari sekali (mis. dua input `name="dup"`), nilainya otomatis
digabung menjadi Array:

```js
// <input name="dup" value="satu"> <input name="dup" value="dua">
{ dup: ["satu", "dua"] }
```

### Contoh output

```html
<form id="myForm">
  <input type="text"     name="nama"    value="  Budi  ">
  <input type="radio"    name="jk"      value="L">
  <input type="radio"    name="jk"      value="P" checked>
  <input type="checkbox" name="hobi"    value="baca"  checked>
  <input type="checkbox" name="hobi"    value="musik" checked>
  <input type="checkbox" name="hobi"    value="masak">
  <input type="checkbox" name="tos"     checked>
  <select name="kota"><option value="bdg" selected>Bandung</option></select>
  <select name="tags" multiple>
    <option value="a" selected>A</option>
    <option value="b" selected>B</option>
  </select>
  <input type="file" name="foto">
  <input type="submit" name="kirim" value="Kirim">
</form>
```

```js
{
  nama: "Budi",                    // string, sudah di-trim
  jk: "P",                         // radio terpilih
  hobi: ["baca", "musik"],         // checkbox → selalu array
  tos: ["on"],                     // checkbox tanpa value
  kota: "bdg",                     // select tunggal
  tags: ["a", "b"],                // select multiple
  foto: File,                      // file tunggal (kalau ada)
  // kirim tidak ikut (type submit)
}
```

---

## Normalisasi `required`

Isi `required` boleh tiga bentuk:

### 1. Array nama field (label diambil otomatis)

```js
await new Nxform({
  elementFormId: "myForm",
  required: ["nama", "email", "telpon"],
});
```

Label diambil dari `<label for="...">` lewat `getLabelText()`:

- Cari `label[for="<el.id>"]`, fallback `label[for="<fieldName>"]`.
- Teks label dibersihkan dari ikon: `.octicon`, `.fa`, `.fas`, `.far`, `.fab`,
  `.material-icons*`, `.material-symbols-*`, `.form-label-icon`.
- Kalau label tidak ada / kosong → pakai nama field apa adanya.

### 2. Object `{ fieldName: "Label" }`

```js
await new Nxform({
  elementFormId: "myForm",
  required: { nama: "Nama Lengkap", email: "Alamat Email" },
});
```

Dipakai **apa adanya** — label sepenuhnya Anda kontrol.

### 3. Kosong → auto-deteksi atribut `[required]`

```js
// HTML: <input name="email" required>
await new Nxform({ elementFormId: "myForm" });
```

Semua elemen dengan atribut `required` di dalam form otomatis jadi aturan wajib.
Nama diambil dari `el.name || el.id`; duplikat dilewati.

---

## Aturan validasi per tipe field

Field yang **tidak ditemukan** di DOM akan di-`continue` (dilewati diam-diam) —
aturan yang menunjuk field tidak ada tidak menghasilkan error.

| Tipe field | Dianggap valid jika |
|---|---|
| `radio` | Minimal satu radio dengan `name` sama dalam keadaan `checked` |
| `checkbox` | Minimal satu checkbox dengan `name` sama dalam keadaan `checked` |
| `file` | Hanya divalidasi kalau elemen punya atribut `required` **dan** `files.length === 0` → error |
| `color` | Nilai cocok regex `/^#[0-9A-Fa-f]{6}$/` |
| `range` | Nilai tidak kosong/NaN, dan berada di antara `min`–`max` (kalau atribut itu ada) |
| Lainnya (`text`, `email`, `password`, `date`, `select`, `textarea`, …) | `el.value.trim() !== ""` |

Catatan penting:

- **`file` tanpa atribut `required` selalu lolos** meski ada di daftar `required`.
- Untuk `range` di luar batas, pesan error memakai label modifikasi:
  `"<Label> harus antara <min> - <max>"`.
- Pesan default untuk field kosong adalah `"<Label> wajib diisi"`.

---

## Tampilan error di DOM

`markError(fieldName, label)` melakukan:

1. Tambah class `nw-invalid` ke elemen field (untuk radio/checkbox: elemen **pertama** di grup).
2. Kalau field adalah `<select>` ber-Select2 → tambah `nw-invalid-select2` ke `.select2-selection`.
3. Kalau label ditemukan → sisipkan `<span class="nw-inline-err">wajib diisi</span>` ke dalam label.
4. Kalau label tidak ditemukan → buat `<div class="nw-err">"<Label> wajib diisi"</div>`
   dan append ke `el.parentElement`.

Pencarian label saat markError, berurutan:

1. `label[for="<el.id || fieldName>"]`
2. `label[for="<fieldName>"]`
3. `.form-group-header label` di dalam `.form-group` terdekat
4. `dt label` di dalam `.form-group` terdekat

CSS di-inject otomatis ke `<style id="nw-style">`:

```css
.nw-err        { color:#cf222e; font-size:12px; margin-top:4px; font-weight:500; }
.nw-inline-err { color:#cf222e; font-size:12px; font-weight:500; margin-left:6px; }
```

---

## Live validation

Listener `input`/`change` **hanya dipasang pada field yang gagal validasi**. Setelah user
memperbaiki nilainya, class error & pesan error otomatis dihapus.

```js
// field gagal → attachLive(name) dipanggil
// user mengetik nilai valid → clearError(el)
```

- `text`/`textarea`/`email`/… → event `input`, dibersihkan bila `.value.trim() !== ""`.
- `select` dan `file` → event `change`, file dibersihkan bila `files.length > 0`.
- `radio` → `change` pada tiap radio, langsung membersihkan seluruh grup.
- `checkbox` → `change`, dibersihkan bila minimal satu checkbox tercentang.

`clearError()` menghapus `nw-invalid`, `nw-invalid-select2`, semua `.nw-err` di `parentElement`,
dan semua `.nw-inline-err` di dalam `.form-group` terdekat.

Field yang **sudah valid sejak awal tidak mendapat listener** — kalau nanti nilainya
dikosongkan lagi, tidak ada error baru sampai `Nxform` dijalankan ulang.

---

## Auto-reset

```js
if (type !== "update") {
  form.reset();
  Nxform.clear(elementFormId);
}
```

- `type: "insert"` (default) → form dikosongkan setelah sukses.
- `type: "update"` → nilai form dipertahankan.

Form **tidak** di-reset kalau validasi gagal.

---

## Spinner

```js
await new Nxform({
  elementFormId: "myForm",
  spinner: {
    enabled: true,          // false → spinner tidak dipakai
    centerScreen: true,     // true → overlay; false → inline di dalam form
    size: "medium",         // 'small' | 'medium' | 'large'
    color: "#007bff",
    message: "Memproses...",
    position: "center",     // 'center' | 'top' | 'bottom'
  },
});
```

Logika pemetaan di dalam constructor:

```js
const spinnerType = spinner.centerScreen === false
  ? (spinner.type || "inline")
  : "overlay";
```

| Kondisi | Hasil |
|---|---|
| `spinner` = `null` / tidak diisi | Tidak ada spinner |
| `spinner.enabled === false` | Tidak ada spinner |
| `spinner.centerScreen === false` | `type: spinner.type \|\| "inline"`, `target: "#" + elementFormId` |
| Selain itu (termasuk `centerScreen` tidak diisi) | `type: "overlay"` |

- `spinner.show()` dipanggil **sebelum** validasi berjalan, lalu constructor menunggu
  `nextPaint()` (2× `requestAnimationFrame`) agar spinner benar-benar tergambar.
- `hide()` dijamin terpanggil lewat helper `done()` yang membungkus `resolve()`.
- Detail modul spinner: lihat [`modules/spinner/README.md`](../spinner/README.md).

---

## Static members

### `Nxform.clear(formId)`

Hapus **semua** jejak error validasi pada form.

```js
Nxform.clear("myForm");
```

Menghapus:
- semua `.nw-err`
- semua `.nw-inline-err`
- class `nw-invalid` dari semua elemen
- class `nw-invalid-select2` dari semua elemen

Tidak melakukan `form.reset()` — nilai field tetap. Panggil `form.reset()` sendiri bila perlu.

```js
Nxform.clear("myForm");
document.getElementById("myForm").reset();
```

### `Nxform.initFormEnhancers(formId = "myForm")`

Bind helper global (file upload, toggle password, Select2) lalu inisialisasi Select2 pada
form tersebut. Mengembalikan `true` kalau ada `.js-select2` yang diproses, `false` kalau tidak.

```js
Nxform.initFormEnhancers("myForm");
```

Constructor **sudah** memanggil ini otomatis, jadi pemanggilan manual hanya perlu kalau
form di-render ulang setelah `Nxform` selesai.

---

## Helper global yang di-inject

`ensureGlobalFormHelpers()` mendefinisikan fungsi berikut di `globalThis` **hanya jika belum ada**
(tidak menimpa implementasi Anda sendiri):

### `fileUploadUpdate(input, labelId, dropId)`

Memperbarui label & state drop zone saat file dipilih.

```html
<input type="file" id="foto" onchange="fileUploadUpdate(this, 'fotoLabel', 'fotoDrop')">
<label id="fotoLabel">JPG, PNG, GIF, WEBP</label>
<div id="fotoDrop" class="dropzone"></div>
```

- 0 file → label kembali `"JPG, PNG, GIF, WEBP"`, class `has-file` dihapus.
- 1 file → label = nama file.
- >1 file → label = `"<n> file dipilih"`.
- Class `has-file` ditambahkan ke `dropEl` bila ada file.

### `togglePasswordVisibility(buttonEl)`

Toggle visibilitas input password. Target dibaca dari `data-target` pada button.

```html
<input type="password" id="pass">
<button type="button" data-target="pass" onclick="togglePasswordVisibility(this)">
  <span class="pwd-eye-on">👁</span>
  <span class="pwd-eye-off">🙈</span>
</button>
```

- Mengubah `input.type` antara `password` ↔ `text`.
- Set `data-password-visible="true|false"` pada button.
- Set `aria-label` ke `"Sembunyikan password"` / `"Tampilkan password"`.
- Menukar `display` `.pwd-eye-on` / `.pwd-eye-off` (jika keduanya ada).

### `initDeploymentFormSelects(formId = "myForm")`

Inisialisasi Select2 untuk semua elemen `.js-select2` di dalam form.

```html
<select id="kota" class="js-select2"
        data-placeholder="Pilih kota"
        data-allow-clear="true"></select>
```

| Atribut data | Efek |
|---|---|
| `data-placeholder` | Placeholder Select2. Default: `"Pilih tags"` untuk `multiple`, `"Pilih opsi"` untuk single. |
| `data-allow-clear` | `"true"` → `allowClear: true`. Selain itu `false`. |

- `width` selalu `"100%"`.
- Prioritas: `NXUI.initSelect2(selector, opts)` → fallback `jQuery.fn.select2`.
- Return `true` kalau minimal satu select diproses, `false` kalau form tidak ada / tidak ada `.js-select2`.

---

## Contoh lengkap

```html
<form id="myForm">
  <div class="form-group">
    <label for="nama">Nama Lengkap</label>
    <input type="text" id="nama" name="nama" required>
  </div>

  <div class="form-group">
    <label for="email">Email</label>
    <input type="email" id="email" name="email">
  </div>

  <div class="form-group">
    <label for="jk">Jenis Kelamin</label>
    <input type="radio" name="jk" value="L"> L
    <input type="radio" name="jk" value="P"> P
  </div>

  <div class="form-group">
    <label for="kota">Kota</label>
    <select id="kota" name="kota" class="js-select2" data-placeholder="Pilih kota"></select>
  </div>

  <button type="submit">Simpan</button>
</form>
```

```js
import { Nxform } from "/form";

document.querySelector("#myForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const res = await new Nxform({
    elementFormId: "myForm",
    type: "insert",
    required: ["nama", "email", "jk", "kota"],
    noValidationBy: ["telpon"],
    spinner: { message: "Menyimpan..." },
  });

  if (res === null) return console.warn("form tidak ditemukan");
  if (!res.status) return console.warn("validasi gagal");

  await fetch("/api/simpan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(res.data),
  });
});
```

---

## Batasan & perilaku aktual

Hal-hal yang perlu diketahui agar tidak salah asumsi:

1. **`collectFormData` kini lokal.** Implementasi default ada di dalam `index.js` sendiri,
   jadi modul ini tidak lagi bergantung pada `modules/forms/NexaForm.js`. Kalau nanti Anda
   punya `collectFormData` eksternal, ganti fungsi lokalnya dengan import — signature-nya
   `(formId, getValidationBy) => Promise<object|null>`.

2. **`Nxform.clear()` sekarang bersih total.** Menghapus `.nw-err`, `.nw-inline-err`,
   class `nw-invalid`, dan `nw-invalid-select2`. Pembersihan awal di dalam `constructor`
   juga memakai jalur yang sama, jadi error lama tidak pernah tersisa antar-submit.
   `clear()` **tidak** memanggil `form.reset()` — nilai field dipertahankan.

3. **`getValidationBy` hanya untuk pengumpulan data**, bukan untuk validasi. Validasi selalu
   mencari `[name="x"]` lalu `#x`, apa pun isi `getValidationBy`.

4. **Error radio/checkbox hanya menempel pada elemen pertama** grup, karena `querySelector`
   mengembalikan elemen pertama. Field lain dalam grup tidak mendapat `nw-invalid`.

5. **Posisi `.nw-err` bergantung pada `parentElement`.** Kalau field dibungkus wrapper
   tambahan, pesan error bisa muncul di tempat yang tidak diharapkan. Bungkus tiap field
   dalam `.form-group` agar `markError` menemukan label dan pesan tampil konsisten.

6. **`file` di daftar `required` tetap lolos tanpa atribut `required`** di HTML — kondisi
   validasinya `if (el.required && el.files.length === 0)`.

7. **Spinner kini dijamin sempat terlihat.** Setelah `show()`, constructor menunggu
   `nextPaint()` (dua `requestAnimationFrame`) sebelum validasi sinkron berjalan. Tanpa jeda
   itu, `show()` dan `hide()` terjadi dalam satu blok sinkron dan browser tidak pernah
   menggambar spinner. Konsekuensinya satu frame tambahan (~16 ms) per submit.

8. **`spinner: {}` mengaktifkan spinner** (`{}?.enabled !== false` bernilai `true`). Untuk
   mematikan, kirim `null`/`undefined` atau `enabled: false`.

9. **Listener live menumpuk** kalau `Nxform` dijalankan berulang pada form yang sama.
   Tidak berbahaya (hanya membersihkan class), tetapi `removeEventListener` tidak pernah
   dipanggil — form yang divalidasi ratusan kali akan menumpuk listener.

10. **`required` bentuk object dipakai mentah**, tanpa pembersihan ikon label seperti pada
    bentuk array. Konsistenkan sendiri labelnya.

11. **Tidak ada dukungan async validator** (cek ke server, cek keunikan, dsb). Semua aturan
    bersifat sinkron berbasis nilai input.
