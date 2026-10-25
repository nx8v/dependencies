# Tables — `NxTables`

Tabel data interaktif client-side (filter teks, sort kolom, paginasi, edit inline,
menu aksi per baris, export CSV/JSON/XLSX/PDF) tanpa framework — cukup satu class.

**Entry point:** `modules/table/index.js`
**Export:** `NxTables` (class), `rowsFromStorageResponse(res)` (helper), `ensureTableStylesheet()` (no-op, untuk kompatibilitas)
**Import di halaman:** `import { NxTables } from "/table";`

> **Konvensi NX8V.** `import` dari `/table` menerima `modules/table/index.js`. Modul wajib
> terdaftar di `dependencies` pada `project.json` agar dilayani:
>
> ```json
> "dependencies": { "table": "1.0.0" }
> ```
>
> Impor di dalam folder modul memakai path relatif (`./Export.js`, `./table.css`).
> Permintaan skrip ke `/table` dialihkan ke `/table/index.js`, jadi path itu tetap
> di dalam `modules/table/`. `import "./table.css"` memasang stylesheet-nya.
> Halaman tidak menulis lokasi berkas CSS.

---

## Quick start

```js
import { NxTables } from "/table";

const table = await new NxTables({
  container: "#myTable",
  data: [
    { id: 1, nama: "Budi", umur: 30 },
    { id: 2, nama: "Sari", umur: 25 },
  ],
}).mount();
```

`mount()` mengembalikan instance (Promise), jadi wajib `await` / `.then()`.

---

## Persyaratan halaman

`table.css` dan `index.css` ikut termuat dari `index.js`. Ikon Material dan select2,
bila dipakai, tetap ditambahkan di halaman:

```html
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet" />
<link rel="stylesheet" href="assets/css/select2.min.css" />
<script src="assets/js/select2.full.min.js"></script>
```

---

## Config constructor

```js
await new NxTables({
  container,             // string|Element (wajib)
  data,                  // Array<object> — data awal
  columns,               // [{ key, title? }] — jika kosong, di-infer dari data
  pageSize,               // number  default 10
  pageSizeOptions,        // number[] default [10,25,50,100]
  paginationSize,        // 'default' | 'sm'
  paginationClass,       // string
  pageInfoClass,         // string
  searchable,            // boolean default true  — kotak "Cari…"
  sortable,               // boolean default true  — klik header untuk sort
  tableClass,             // string  — override class tabel (default nx-table set)
  wrapperClass,           // string  — class wrapper <div>
  caption,                // string  — dipakai untuk nama file export default
  formatCell,             // fn(value, key, row) => string — format nilai sel
  hideColumnKeys,         // string[] — kolom disembunyikan (tetap ada di objek baris)
  rowNumberColumn,        // boolean — kolom penomoran "No."
  rowNumberColumnTitle,   // string default "No."
  columnMenu,             // boolean default true — menu filter/sort per kolom
  onRefresh,              // fn() => void|Promise — tombol refresh (muncul jika diisi)
  onAction,               // fn(action, row) => void — klik aksi baris
  onEdit,                 // fn(key, value, row) => void — edit inline commit
  onFetchPage,             // fn(page) => void — paginasi server-side
  serverSide,              // boolean — paginasi/filter via server
  serverTotal,             // number — total baris (server) untuk paginasi server-side
  export,                  // { enabled, types, include, fileName }
  actions,                 // { view, add, edit, delete, export, import, print, share, custom }
  actionsColumnTitle,      // string default "Actions"
  actionsColumnPosition,   // 'start' | 'end' default 'end'
  editing,                 // { [key]: { type, options, min, max, step } }
  inline,                   // string[] — kolom yang boleh diedit inline
  spinner,                 // { enabled, centerScreen, type, size, color, position, message }
  storage,                 // { model, select?, query?(builder) } — muat dari NXUI.Storage
  paginationActiveBg/Border/Color, // string|null — warna override pagination aktif
  setting,                 // { classTabel } — sumber class tabel lama
})
```

> **Catatan:** `storage` hanya dipakai jika `data` kosong. Data precedence: `data` → `storage`.

---

## Method publik

| Method | Keterangan |
| --- | --- |
| `mount()` | Render tabel + pagination. **Wajib dipanggil** (async, mengembalikan instance). |
| `setData(rows)` | Ganti seluruh data, reset sort & ke halaman 0, re-render. |
| `deleteRow(predicate)` | Hapus baris yang memenuhi `predicate(row)` tanpa reload, re-render. |
| `getColumns()` | Kolom efektif (termasuk `__rowNo__`/`__actions__` jika aktif). |
| `destroy()` | Bersihkan semua listener & DOM yang dibuat instance. |
| `static fromStorageResponse(container, storageResult, options)` | Bangun dari respons Storage (ekstraksi baris otomatis) + mount. |
| `static fromStorage(container, load, tableOptions)` | Ambil data via `NXUI.Storage` (`get`/`post`/`api`) lalu mount. |
| `static fromBuckets(container, app, getOptions, tableOptions)` | Ambil data via `NXUI.Storage().buckets(app).get()` lalu mount. |

### `fromStorage` — opsi `load`

| Kunci | Keterangan |
| --- | --- |
| `method` | `'get'` (default) \| `'post'` \| `'api'` |
| `url` / `path` | Endpoint untuk `get` / `post` / `api` |
| `options` / `query` | Query (method `get`) |
| `body` / `apiBody` | Body (method `post` / `api`) |
| `fetchOptions` | Argumen tambahan (method `post`) |
| `acceptObjectAsRow` | Bungkus objek respons non-array jadi satu baris jika kosong |

---

## Aksi baris (actions)

Tombol titik-tiga per baris. Aktifkan dengan `actions: { edit: true, delete: true }` dsb.
Kunci tetap: `view`, `add`, `edit`, `delete`, `export`, `import`, `print`, `share`.
Aksi custom: `actions.custom = [{ key, label, icon }]` — selalu tampil, tidak boleh
bentrok dengan 8 kunci tetap.

Callback `onAction(actionKey, row)` — atau dengarkan event `nexa-table-action` pada container:

```js
const t = await new NxTables({ ... }).mount();
t.container.addEventListener("nexa-table-action", (e) => {
  const { action, row } = e.detail;
  if (action === "delete") { /* hapus row */ }
});
```

---

## Edit inline

Kolom yang bisa diedit didaftarkan di `editing` (opsional) DAN/ATAU `inline`:

```js
editing: {
  status: { type: "select", options: ["Aktif", "Nonaktif"] },
  umur:   { type: "number", min: 0, max: 150 },
  aktif:  { type: "checkbox" },
},
inline: ["status", "umur"], // batasi kolom yang benar-benar bisa diedit
```

Klik sel untuk mengedit; tipe didukung: `text`, `number`, `checkbox`, `select`,
`textarea`, `search`, `email`, `password`, `tel`, `url`, `date`, `datetime-local`,
`time`, `color`, `range`. Commit lewat `onEdit(key, value, row)` atau event
`nexa-table-edit` pada container.

---

## Export

```js
export: {
  enabled: true,
  types: ["csv", "json", "xlsx", "pdf"],
  include: "filtered", // 'filtered' | 'all' | 'page'
  fileName: "data-pengguna", // default caption / "nexa-tables"
}
```

- `include: "filtered"` (default) hanya baris hasil filter, `"all"` semua baris,
  `"page"` hanya baris halaman aktif.
- XLSX dibuat dari HTML dengan MIME `xlsx` (tanpa dependency library).
- PDF dibuka di window baru → print → Save as PDF.
- `formatCell` ikut diterapkan pada nilai export.

---

## Server-side pagination

```js
await new NxTables({
  container: "#tabel",
  serverSide: true,
  serverTotal: 120,
  pageSize: 10,
  onFetchPage: async (page) => {
    const res = await fetch(`/api?page=${page}&size=${pageSize}&q=${search}`);
    // ...
  },
  searchable: true, // search dikirim ke server (debounce 350ms)
}).mount();
```

- `onFetchPage(page)` dipanggil saat ganti halaman / search (debounce 350 ms).
- `serverTotal` menentukan jumlah halaman yang dirender.
- `_applyFilter` tidak menjalankan filter client-side pada mode ini.

---

## Integrasi `nx`

- `NxTables.ensureTableStylesheet()` diekspor agar `NXUI.ensureTableStylesheet()` / `await` tidak patah — sekarang no-op.
- Dapat dipanggil dari `window.nx` jika tersedia.
- `rowsFromStorageResponse(res)` menormalkan berbagai bentuk respons (array, `{ data }`, `{ response }`, `{ rows }`, `{ data: { rows } }`, dsb.).

---

## Struktur file

```
table/
├── Export.js     # helper export (sanitize nama, CSV, XLSX HTML, PDF)
├── index.css     # kelas dasar tabel (Primer CSS) + ikon label form
├── index.js      # implementasi NxTables
├── table.css     # styling tabel, pagination, tombol, form assets (37 KB)
└── README.md
```

Logika export dipisah ke `Export.js` agar mudah di-maintain/dikembangkan.