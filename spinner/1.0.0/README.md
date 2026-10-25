# Spinner

Loading indicator ringan berbasis CSS (tanpa dependency) untuk menampilkan status loading
di seluruh layar, di dalam container tertentu, atau di dalam sebuah button.

**Entry point:** `modules/spinner/index.js`
**Export:** `spinner(options)` (named export)
**Import di halaman:** `import { spinner } from "/spinner";`

> **Konvensi NX8V.** `import` dari `/spinner` menerima `modules/spinner/index.js`. Modul wajib
> terdaftar di `dependencies` pada `project.json` agar dilayani.

---

## Quick start

```js
import { spinner } from "/spinner";

// 1. Overlay full screen
const sp = spinner();
sp.show();
await doSomething();
sp.hide();
```

Spinner juga didaftarkan ke `window.nx` (lihat [Integrasi `nx`](#integrasi-nx)) sehingga bisa
dipanggil sebagai `nx.spinner()`.

---

## Options

`spinner(options)` menerima **object** konfigurasi. Kalau yang dikirim **string**, nilainya
otomatis dianggap sebagai `target`:

```js
spinner("#myContainer");            // sama dengan spinner({ target: "#myContainer" })
```

| Option     | Tipe                  | Default     | Keterangan |
|------------|-----------------------|-------------|------------|
| `target`   | `string \| Element`   | `'body'`    | Selector, ID, atau elemen DOM. Dipakai oleh `type: 'inline'` dan `type: 'button'`. |
| `type`     | `string`              | `'overlay'` | `'overlay'` \| `'inline'` \| `'button'` |
| `size`     | `string`              | `'medium'`  | `'small'` (20px) \| `'medium'` (40px) \| `'large'` (60px). Nilai tak dikenal → `medium`. |
| `color`    | `string`              | `'#007bff'` | Warna `border-top-color` spinner. |
| `message`  | `string`              | `''`        | Teks di bawah spinner. Kosong → tidak dirender. |
| `autoShow` | `boolean`             | `false`     | Tampilkan otomatis setelah DOM siap. |
| `position` | `string`              | `'center'`  | Khusus `inline`: `'center'` \| `'top'` \| `'bottom'`. |

Resolusi `target` (dilakukan sekali, lalu di-cache):

1. Kalau `target` adalah DOM element → dipakai langsung.
2. Kalau `target === 'body'` → `document.body`.
3. `document.querySelector(target)`.
4. Fallback `document.getElementById()` (dengan atau tanpa `#`).
5. Tidak ketemu → `console.warn` dan fallback ke `document.body`.

---

## API yang dikembalikan

```js
const sp = spinner({ ... });
```

| Method          | Return      | Keterangan |
|-----------------|-------------|------------|
| `show()`        | `void`      | Tampilkan spinner. Idempotent — dipanggil saat sudah visible tidak berefek. |
| `hide()`        | `void`      | Sembunyikan spinner. Idempotent. Untuk `button` mengembalikan konten & `disabled` asli. |
| `toggle()`      | `void`      | `show()` / `hide()` sesuai state saat ini. |
| `destroy()`     | `void`      | `hide()` + hapus elemen spinner dari DOM. Instance tidak bisa dipakai lagi. |
| `isVisible()`   | `boolean`   | Status tampil saat ini. |
| `getElement()`  | `Element\|null` | Elemen spinner. Bernilai `null` sebelum `show()` pertama. |

---

## Tipe spinner

### `overlay` (default)

Menutupi viewport, spinner di tengah layar.

```js
const sp = spinner({
  message: "Menyimpan data...",
  color: "#0d6efd",
  size: "large",
});

sp.show();
try {
  await fetch("/api/save", { method: "POST" });
} finally {
  sp.hide();
}
```

Karakteristik penting:

- Elemen **selalu** di-append ke `document.body` — option `target` **diabaikan** pada tipe ini.
- `position: fixed`, `z-index: 9999`, `background: transparent`.
- `pointer-events: none` → **tidak memblokir klik**. User masih bisa mengklik UI di belakangnya.
  Kalau butuh memblokir interaksi, tambahkan CSS sendiri, misal:

  ```css
  .nx-spinner.nx-spinner-blocking { pointer-events: auto; background: rgba(255,255,255,.6); }
  ```

### `inline`

Spinner di dalam container, mengalir bersama konten (tidak fixed).

```js
const sp = spinner({
  target: "#listContainer",
  type: "inline",
  position: "top",   // 'center' | 'top' | 'bottom'
  message: "Memuat data...",
});
sp.show();
```

- Di-append sebagai child terakhir dari `target`.
- `min-height` mengikuti `size`, `padding: 20px`.
- Konten lama container **tidak** disembunyikan — spinner ditambahkan di bawahnya.
  Sembunyikan konten sendiri kalau perlu.

### `button`

Spinner menggantikan isi button selama proses berjalan.

```js
const sp = spinner({ target: "#submitBtn", type: "button" });

btn.addEventListener("click", async () => {
  sp.show();                      // button disabled + konten diganti spinner
  await submit();
  sp.hide();                      // konten asli & disabled dipulihkan
});
```

- Menyimpan `target.innerHTML` sebagai `originalContent`.
- Set `target.disabled = true`, lalu render spinner putih di tengah + teks asli dengan `opacity: .5`.
- Warna spinner di tipe ini **hardcode putih** (`#fff`) — option `color` tidak berpengaruh.
- `size` tetap dipakai (dimensi spinner).

---

## `autoShow`

```js
const sp = spinner({ message: "Loading...", autoShow: true });
```

- Kalau `document.readyState === 'loading'` → `show()` ditunda ke `DOMContentLoaded`.
- Selain itu → `show()` dijadwalkan lewat `setTimeout(..., 0)`.
- Konsekuensinya: `isVisible()` masih `false` tepat setelah pembuatan. Jangan mengandalkannya
  untuk cek sinkron; panggil `show()` manual kalau butuh perilaku pasti.

---

## Contoh umum

### Pola try/finally (disarankan)

```js
async function withSpinner(opts, fn) {
  const sp = spinner(opts);
  sp.show();
  try {
    return await fn();
  } finally {
    sp.hide();          // atau sp.destroy() kalau tidak dipakai lagi
  }
}

await withSpinner({ message: "Mengirim..." }, () => fetch("/api/send"));
```

### Satu instance, dipakai berulang

```js
const globalSp = spinner({ size: "large" });

function loading(on) {
  on ? globalSp.show() : globalSp.hide();
}
```

### Toggle

```js
const sp = spinner();
document.querySelector("#toggleLoader").onclick = () => sp.toggle();
```

### Cleanup total

```js
sp.destroy();
// elemen <div id="nx-spinner-..."> dihapus dari DOM; instance tidak dipakai lagi
```

---

## Integrasi `nx`

Di akhir modul:

```js
if (typeof window !== "undefined" && window.nx) {
  window.nx.spinner = spinner;
}
```

Artinya `nx.spinner()` hanya tersedia kalau **`window.nx` sudah ada sebelum modul ini dieksekusi**.
Kalau `nx` dimuat belakangan, gunakan import langsung atau daftarkan manual:

```js
import { spinner } from "/spinner";
window.nx = window.nx || {};
window.nx.spinner = window.nx.spinner || spinner;
```

---

## Catatan & batasan (perilaku aktual kode)

Hal-hal yang perlu diketahui agar tidak salah asumsi:

1. **CSS di-inject sekali.** `<style id="nx-spinner-styles">` berisi `@keyframes nx-spin` dan
   `box-sizing` dasar. Semua styling lain inline, jadi tidak bisa di-override lewat stylesheet
   tanpa `!important`.
2. **Konfigurasi bersifat final.** Elemen spinner dibuat sekali pada `show()` pertama; mengubah
   `config` setelahnya tidak berefek. Buat instance baru untuk konfigurasi berbeda.
3. **`message` di-render via `innerHTML`** (tidak di-escape). Jangan memasukkan input user mentah
   ke `message`.
4. **`target` di-cache** setelah resolusi pertama. Kalau elemen target dihapus/diganti di DOM,
   instance lama akan menunjuk elemen yang sudah lepas dari dokumen.
5. **`type: 'button'` dengan konten kosong.** Restore konten memakai cek `if (originalContent)`,
   sehingga button tanpa teks (`innerHTML === ''`) tidak akan dipulihkan: spinner disembunyikan,
   tetapi **button tetap `disabled`**. Selalu beri konten teks pada button.
6. **`position` hanya berlaku untuk `inline`.** Untuk `overlay` dan `button` nilainya diabaikan.
7. **Tidak ada antrean/counter.** Kalau `show()` dipanggil dari beberapa alur sekaligus pada satu
   instance, `hide()` dari alur pertama langsung menyembunyikan spinner. Buat instance terpisah
   atau kelola counter sendiri.
8. **`destroy()` tidak melepas listener `DOMContentLoaded`** yang mungkin sudah didaftarkan oleh
   `autoShow` bila dipanggil sebelum DOM siap.

---

## Integrasi dengan `Nxform` (modul form)

Modul form memakai spinner sebagai opsi `spinner`:

```js
const res = await new NXUI.Nxform({
  elementFormId: "myForm",
  type: "insert",
  spinner: {
    enabled: true,        // false → spinner tidak dipakai
    centerScreen: true,   // true → type 'overlay'; false → 'inline' di dalam form
    size: "medium",
    color: "#007bff",
    message: "Memproses...",
    position: "center",
  },
});
```

Pemetaan yang dilakukan `Nxform`:

- `centerScreen !== false` → `type: 'overlay'` (option `target` tidak dikirim).
- `centerScreen === false` → `type: spinner.type || 'inline'` dengan `target: '#' + elementFormId`.
- `hide()` selalu dipanggil saat promise selesai (dibungkus pada helper `done`).

> Catatan: `modules/form/index.js` meng-import spinner secara relatif dari `../spinner/index.js`,
> yang oleh NX8V di-resolve ke `/spinner`.

---

## Struktur DOM yang dihasilkan

```html
<!-- type: overlay / inline -->
<div id="nx-spinner-<timestamp>-<random>" class="nx-spinner" style="...">
  <div class="nx-spinner-loader" style="width:40px;height:40px;border-radius:50%;..."></div>
  <div class="nx-spinner-message" style="...">Menyimpan data...</div>
</div>

<!-- type: button (di dalam target) -->
<button id="submitBtn" disabled style="position:relative">
  <div class="nx-spinner" style="position:absolute;top:50%;left:50%;..."></div>
  <span style="opacity:.5">Simpan</span>
</button>
```

ID unik dibuat dengan `Date.now()` + `Math.random()`, jadi beberapa instance bisa hidup bersamaan.
