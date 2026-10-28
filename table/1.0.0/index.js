/**
 * Tabel data interaktif (filter teks, sort kolom, paginasi).
 * Stylesheet tabel dimuat lewat import di bawah. Halaman cukup `import { NxTables } from "/table"`.
 */

import {
  sanitizeFileName,
  dateStamp,
  downloadFile,
  toCSV,
  toXLSXHtml,
  exportToPDF,
} from "./Export.js";
import "./index.css";
import "./pagination.css";
// Ikon + floating editor — DEFAULT LOKAL (mandiri, tanpa import modul lama
// `../icons/NexaIcons.js` / `../floating/NexaFloating.js`). Implementasi di
// bawah ini padanan 1:1 resolver ikon Fluent; generator field floating
// bersifat opsional — dipakai hanya jika host menyediakannya via
// `window.NXUI.NexaFloating` / `window.NexaFloating`, jika tidak editor
// inline lokal yang dipakai.

/** Padanan nama: tipe field → nama ikon Fluent (nama pendek, bukan class). */
const FLUENT_ALIAS = {
  maps: "location",
  currency: "money",
  url: "link",
  time: "clock",
  sesi: "clock",
  name: "person",
  email: "mail",
  tel: "phone",
  password: "lock_closed",
  date: "calendar_ltr",
  "datetime-local": "calendar_clock",
  month: "calendar_month",
  week: "calendar_work_week",
  category: "text_bullet_list",
  amount: "number_symbol",
  number: "number_symbol",
  gender: "circle",
  interests: "checkmark_circle",
  file: "arrow_upload",
  range: "options",
  select: "list",
  select2: "tag",
  populate: "search",
  instansi: "building",
  slug: "link_square",
  richtext: "text_paragraph",
  textarea: "textbox",
  text: "text_field",
  hidden: "eye_off",
  checkbox: "checkbox_checked",
  radio: "radio_button",
  switch: "toggle_left",
  tags: "tag_multiple",
  avatar: "person_circle",
  keyup: "keyboard",
  approval: "checkmark_starburst",
  filtering: "filter",
};

/** Ikon terakhir kalau tipe tidak dikenal — sengaja netral. */
const FLUENT_FALLBACK = "text_field";

/**
 * Bentuk class Fluent System Icons dari nama pendek.
 *   toFluentIconClass("document")     → icon-ic_fluent_document_16_regular
 *   toFluentIconClass("person", 24)   → icon-ic_fluent_person_24_regular
 *   toFluentIconClass("icon-ic_fluent_mail_20_regular") → dipakai apa adanya
 */
function toFluentIconClass(nama, ukuran = 16) {
  const s = String(nama || "").trim();
  if (!s) return "";
  if (s.startsWith("icon-ic_fluent_")) return s;
  if (s.startsWith("ic_fluent_")) return `icon-${s}`;
  let inti = s.toLowerCase().replace(/[\s-]+/g, "_").replace(/_+/g, "_");
  let uk = ukuran;
  const m = inti.match(/_(\d{1,2})(?:_regular|_filled|_light)?$/);
  if (m) { uk = m[1]; inti = inti.slice(0, m.index); }
  inti = inti.replace(/_(regular|filled|light)$/, "");
  if (!inti) return "";
  return `icon-ic_fluent_${inti}_${uk}_regular`;
}

/**
 * Resolver ikon default untuk inline editor — padanan getIconByTypeUniversal.
 * @param {string} type tipe field ('text', 'select', …)
 * @param {string} [_iconType] diabaikan (API lama), selalu Fluent
 * @param {string} [customIcon] nama pendek / class lengkap pilihan developer
 * @returns {string} class CSS Fluent
 */
function getIconByTypeUniversal(type, iconType = "fluent", customIcon = "") {
  const generik = ["attach_file", "edit_note"];
  const pilihan = String(customIcon || "").trim();
  if (pilihan && !generik.includes(pilihan.toLowerCase())) {
    return toFluentIconClass(pilihan);
  }
  const nama = FLUENT_ALIAS[type] || type || FLUENT_FALLBACK;
  return toFluentIconClass(nama) || toFluentIconClass(FLUENT_FALLBACK);
}

/**
 * Generator field floating OPSIONAL dari host (window), bukan import lama.
 * Dipakai hanya bila tersedia; selain itu editor inline lokal dipakai.
 */
function getFloatingCtor() {
  return (
    window?.NXUI?.floating?.NexaFloating ||
    window?.NXUI?.NexaFloating ||
    window?.NexaFloating ||
    null
  );
}

/**
 * No-op: pemutusan tautan CSS dinamis — muat `table.css`, `pagination.css`, `assets/css/form.css`, `button.css`, `select2.min.css` lewat `<link>` di HTML.
 * Tetap diekspor agar `NXUI.ensureTableStylesheet()` / `await ensureTableStylesheet()` tidak patah.
 */
export async function ensureTableStylesheet() {
  if (typeof document === "undefined") return;
}

/**
 * Normalisasi respons Storage / API menjadi array baris.
 * @param {*} res — objek atau array (mis. `{ status, data: [...] }`, `{ response: [...] }`)
 * @returns {Array<object>}
 */
export function rowsFromStorageResponse(res) {
  if (res == null) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.data)) return res.data;
  if (Array.isArray(res.response)) return res.response;
  if (Array.isArray(res.rows)) return res.rows;
  // Support nested shapes used by Storage().model().get() / API wrappers
  if (res.data && Array.isArray(res.data.rows)) return res.data.rows;
  if (res.data && Array.isArray(res.data.data)) return res.data.data;
  return [];
}

function inferColumns(rows) {
  if (!rows.length) return [];
  const keys = new Set();
  rows.forEach((row) => {
    if (row && typeof row === "object" && !Array.isArray(row)) {
      Object.keys(row).forEach((k) => keys.add(k));
    }
  });
  return [...keys].map((key) => ({ key, title: key }));
}

/** Tampilan teks header kolom: `_` dianggap spasi (mis. Tanggal_lahir → Tanggal lahir). */
function formatColumnHeaderLabel(raw) {
  return String(raw ?? "").replaceAll("_", " ");
}

function cellText(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = cellText(a);
  const sb = cellText(b);
  const na = Number(sa);
  const nb = Number(sb);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && sa !== "" && sb !== "") {
    return na - nb;
  }
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * @typedef {{ key: string, title?: string }} NxTablesColumn
 * @typedef {{
 *   container: string|Element,
 *   data?: Array<object>,
 *   columns?: NxTablesColumn[],
 *   pageSize?: number,
 *   pageSizeOptions?: number[],
 *   paginationSize?: 'default'|'sm',
 *   paginationClass?: string,
 *   pageInfoClass?: string,
 *   searchable?: boolean,
 *   sortable?: boolean,
 *   tableClass?: string,
 *   wrapperClass?: string,
 *   caption?: string,
 *   formatCell?: (value: unknown, key: string, row: object) => string,
 *   paginationActiveBg?: string|null,
 *   paginationActiveBorder?: string|null,
 *   paginationActiveColor?: string|null,
 *   export?: {
 *     enabled?: boolean,
 *     types?: Array<'csv'|'json'|'xlsx'|'pdf'>,
 *     include?: 'filtered'|'all'|'page',
 *     fileName?: string
 *   },
 *   spinner?: {
 *     enabled?: boolean,
 *     centerScreen?: boolean,
 *     type?: 'overlay'|'inline'|'button',
 *     size?: 'small'|'medium'|'large',
 *     color?: string,
 *     position?: 'center'|'top'|'bottom',
 *     message?: string,
 *   },
 *   storage?: {
 *     model: string,
 *     select?: string|string[],
 *     query?: (builder: any) => any,
 *   },
 *   columnMenu?: boolean,
 *   actions?: {
 *     edit?: boolean,
 *     delete?: boolean,
 *     view?: boolean,
 *     add?: boolean,
 *     export?: boolean,
 *     import?: boolean,
 *     print?: boolean,
 *     share?: boolean,
 *   },
 *   actionsColumnTitle?: string,
 *   actionsColumnPosition?: 'start'|'end',
 *   onAction?: (action: string, row: object) => void,
 *   editing?: {
 *     [key: string]: {
 *       type: 'text'|'number'|'checkbox'|'select'|'textarea'|'search'|'email'|'password'|'tel'|'url'|'date'|'datetime-local'|'time'|'color'|'range',
 *       options?: Array<string|{ value: string, label?: string }>,
 *       min?: number,
 *       max?: number,
 *       step?: number,
 *     }
 *   },
 *   onEdit?: (key: string, value: unknown, row: object) => void,
 *   onRefresh?: () => void|Promise<void>,
 *   rowNumberColumn?: boolean,
 *   rowNumberColumnTitle?: string,
 *   hideColumnKeys?: string[],
 * }} NxTablesOptions
 */
export class NxTables {
  /**
   * @param {NxTablesOptions} options
   */
  constructor(options = {}) {
    // console.log('options:', options);
    const c = options.container;
    this.container =
      typeof c === "string" ? document.querySelector(c) : c;
    if (!this.container) {
      throw new Error("NxTables: container tidak ditemukan.");
    }

    // Persist pagination state per-container.
    const containerKey = typeof c === "string" ? c : this.container?.id ? `#${this.container.id}` : "default";
    const safeKey = String(containerKey).replace(/[^a-zA-Z0-9_-]/g, "_");
    this._pageSizeStorageKey  = `NxTables_pageSize_${safeKey}`;
    this._pageStorageKey      = `NxTables_page_${safeKey}`;
    this._colWidthsStorageKey = `NxTables_colWidths_${safeKey}`;

    // Column resize state
    this._colWidths = this._loadColWidths(); // { [colKey]: widthPx }
    this._colgroup  = null;

    this.columns = options.columns;
    this.pageSize = Math.max(1, options.pageSize ?? 10);

    // Server-side pagination
    this.serverSide = options.serverSide === true;
    this._serverTotal = (this.serverSide && Number.isFinite(options.serverTotal)) ? options.serverTotal : 0;
    this.onFetchPage = typeof options.onFetchPage === "function" ? options.onFetchPage : null;
    this._fetchingPage = false;
    this._serverSearch = "";        // current server-side search term
    this._searchDebounceTimer = null; // debounce handle for server search

    this.pageSizeOptions =
      Array.isArray(options.pageSizeOptions) && options.pageSizeOptions.length
        ? options.pageSizeOptions
            .map((n) => parseInt(n, 10))
            .filter((n) => Number.isFinite(n) && n > 0)
        : [10, 25, 50, 100];
    this.paginationSize = options.paginationSize === "sm" ? "sm" : "default";
    this.paginationClass =
      options.paginationClass ??
      (this.paginationSize === "sm" ? "pagination-sm" : "pagination");
    this.pageInfoClass =
      options.pageInfoClass ??
      (this.paginationSize === "sm" ? "page-info-sm" : "page-info");
    this.searchable = options.searchable !== false;
    this.sortable = options.sortable !== false;

    const DEFAULT_NX_TABLE_CLASSES =
      "nx-table nx-table-striped nx-table-hover nx-table-md nx-table-bordered";
    const settingClassRaw =
      options.setting &&
      typeof options.setting === "object" &&
      !Array.isArray(options.setting)
        ? String(options.setting.classTabel ?? "").trim()
        : "";
    if (typeof options.tableClass === "string" && options.tableClass.trim()) {
      this.tableClass = options.tableClass.trim();
    } else if (!settingClassRaw || settingClassRaw === "nx-table") {
      this.tableClass = DEFAULT_NX_TABLE_CLASSES;
    } else {
      this.tableClass = settingClassRaw;
    }

    this.wrapperClass = options.wrapperClass ?? "";
    this.caption = options.caption ?? "";
    this.formatCell = typeof options.formatCell === "function" ? options.formatCell : null;

    // Optional data loader (mirrors NexaDom `storage: { model, select?, query? }`).
    // If provided and `data` is not set, NxTables will fetch rows dari `NXUI.Storage().model(...).select(...).get()`.
    this.storageModel = options.storage || null;

    this.exportOptions = options.export || null;

    /** Menu filter/sort per kolom (dropdown) di header */
    this.columnMenu = options.columnMenu !== false;

    // Row actions dropdown — default di UJUNG tabel ('end'), atau 'start'
    // untuk ditempatkan PALING DEPAN (sebelum kolom data, setelah
    // __rowNo__ kalau rowNumberColumn aktif) — berguna kalau tabel punya
    // banyak kolom data dan user harus scroll ke samping untuk mencapai
    // action di ujung.
    this.actions = options.actions || null;
    this.actionsColumnTitle = options.actionsColumnTitle || "Actions";
    this.actionsColumnPosition =
      options.actionsColumnPosition === "start" ? "start" : "end";
    this.onAction =
      typeof options.onAction === "function" ? options.onAction : null;
    this._hasRowActions =
      !!this.actions && Object.values(this.actions).some((v) => Boolean(v));

    this.onRefresh =
      typeof options.onRefresh === "function" ? options.onRefresh : null;

    // Inline editing per kolom.
    this.editing = options.editing || null;
    this.onEdit =
      typeof options.onEdit === "function" ? options.onEdit : null;

    /** Jika diisi, hanya kolom yang ada dalam array ini yang bisa diedit (meski `editing` mencakup semua kolom). */
    this.inlineColumns = Array.isArray(options.inline) && options.inline.length
      ? options.inline.map((k) => String(k).trim()).filter(Boolean)
      : null;

    /** Kolom pertama penomoran urut (1…n) mengikuti halaman + pageSize */
    this.rowNumberColumn = options.rowNumberColumn === true;
    this.rowNumberColumnTitle = options.rowNumberColumnTitle ?? "No.";

    /** Kunci kolom yang tidak ditampilkan (tetap ada di objek baris, mis. `id` sensitif) */
    this.hideColumnKeys = Array.isArray(options.hideColumnKeys)
      ? options.hideColumnKeys.filter((k) => typeof k === "string" && k.trim())
      : [];

    /** Override warna `.pagination .page-link.active` (dan hover halaman aktif) per instance */
    this.paginationActiveBg = options.paginationActiveBg ?? null;
    this.paginationActiveBorder = options.paginationActiveBorder ?? null;
    this.paginationActiveColor = options.paginationActiveColor ?? null;

    this._paginationDomId = null;
    this._paginationStyleEl = null;

    /** Konfigurasi spinner sederhana (mirip NexaDom), dipakai saat load storage model di mount(). */
    const spin = options.spinner || {};
    this.spinner = {
      enabled: !!spin.enabled,
      centerScreen: !!spin.centerScreen,
      type: spin.type || "overlay",
      size: spin.size || "medium",
      color: spin.color || "#007bff",
      position: spin.position || "center",
      message: spin.message || "",
    };
    this._spinnerEl = null;

    this._data = Array.isArray(options.data) ? [...options.data] : [];
    this._filtered = [...this._data];
    this._sortKey = null;
    this._sortDir = "asc";
    this._page = 0;

    this._hydratePaginationState();

    // Per kolom: { [colKey]: filterString }
    this._columnFilters = {};
    this._columnMenuEl = null;
    this._activeColumnMenuKey = null;
    this._columnMenuDebounceTimer = null;
    this._columnMenuDocAttached = false;
    this._columnMenuValueDatalistId =
      `nx-table-col-datalist-${Math.random().toString(36).slice(2)}`;
    this._boundDocMouseDown = (e) => {
      try {
        if (!this._columnMenuEl || !this._activeColumnMenuKey) return;
        const target = e.target;
        // Jangan tutup menu kalau user memilih value dari datalist/option.
        if (target?.tagName === "OPTION") return;
        if (target?.closest?.("datalist")) return;
        const menu = this._columnMenuEl;
        if (menu.contains(target)) return;
        const menuBtn = target?.closest?.(".nx-table-col-menu");
        if (menuBtn) return;
        this._closeColumnMenu();
      } catch {
        // ignore
      }
    };

    // Row actions dropdown (<details>) — track semua instance supaya bisa ditutup saat klik di luar.
    this._actionDetails = new Set();
    this._actionsDocHandlerAttached = false;
    this._boundActionsDocMouseDown = (e) => {
      try {
        if (!this._actionDetails || this._actionDetails.size === 0) return;
        const target = e.target;
        this._actionDetails.forEach((detailsEl) => {
          if (!detailsEl) return;
          // Menu DIPINDAH ke <body> saat terbuka (lihat
          // `_attachRowActionsMenuPosition`), jadi ia bukan lagi
          // keturunan <details>. Tanpa memeriksa menunya sendiri, klik
          // pada item menu terbaca sebagai "klik di luar" dan menu
          // tertutup sebelum aksinya sempat jalan.
          const menuEl = detailsEl._nxActionMenu;
          const diDalam =
            detailsEl.contains(target) ||
            (menuEl && menuEl.contains(target));
          if (!diDalam) {
            detailsEl.removeAttribute("open");
          }
        });
      } catch {
        /* ignore */
      }
    };

    // Handler klik sel untuk inline editing.
    this._cellClickHandler = (e) => this._onCellClick(e);

    this._root = null;
    this._table = null;
    this._tbody = null;
    this._searchInput = null;
    this._paginationEl = null;
    this._captionEl = null;

    this._boundFilter = () => this._applyFilter();
    this._sortHandler = (e) => this._onSortClick(e);

    // Keep references for potential cleanup.
    this._exportButtons = [];
  }

  _hydratePaginationState() {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      const ps = parseInt(window.localStorage.getItem(this._pageSizeStorageKey), 10);
      if (!Number.isNaN(ps) && ps > 0) this.pageSize = ps;
      // In server-side mode, always start at page 0 — initial data is fetched from page 0.
      // Restoring _page from localStorage would show wrong row numbers against server-fetched page-0 data.
      if (!this.serverSide) {
        const pg = parseInt(window.localStorage.getItem(this._pageStorageKey), 10);
        if (!Number.isNaN(pg) && pg >= 0) this._page = pg;
      }
    } catch {
      /* ignore */
    }
  }

  _persistPageSize() {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      window.localStorage.setItem(this._pageSizeStorageKey, String(this.pageSize));
    } catch {
      /* ignore */
    }
  }

  _persistPage() {
    try {
      if (typeof window === "undefined" || !window.localStorage) return;
      window.localStorage.setItem(this._pageStorageKey, String(this._page));
    } catch {
      /* ignore */
    }
  }

  /**
   * Bangun instance dari respons Storage (ekstrak array otomatis).
   * @param {string|Element} container
   * @param {*} storageResult
   * @param {Omit<NxTablesOptions, "container"|"data">} [options]
   * @returns {Promise<NxTables>}
   */
  /**
   * Inject scroll CSS (nx-scroll-x, nx-scroll-thin) once per document.
   * Uses a data attribute to avoid duplicate injections.
   */
  static _injectScrollStyles() {
    if (document.querySelector("style[data-nexa-scroll]")) return;
    const style = document.createElement("style");
    style.setAttribute("data-nexa-scroll", "1");
    style.textContent = `
/* NxTables — scroll wrapper styles (from nx-scroll module) */
.nx-scroll-x {
  overflow-x: auto;
  overflow-y: hidden;
  width: 100%;
  -webkit-overflow-scrolling: touch;
}
.nx-scroll-x::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.nx-scroll-x::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 4px;
}
.nx-scroll-x::-webkit-scrollbar-thumb {
  background: #bbb;
  border-radius: 4px;
}
.nx-scroll-x::-webkit-scrollbar-thumb:hover {
  background: #888;
}
.nx-scroll-thin::-webkit-scrollbar {
  height: 6px;
  width: 6px;
}
/* dark mode */
body.dark-mode-grid .nx-scroll-x::-webkit-scrollbar-track { background: var(--main-code-bg, #1e1e1e); }
body.dark-mode-grid .nx-scroll-x::-webkit-scrollbar-thumb { background: var(--border-primary, #444); }
body.dark-mode-grid .nx-scroll-x::-webkit-scrollbar-thumb:hover { background: var(--menu-hover-bg, #666); }
`;
    document.head.appendChild(style);
  }

  static async fromStorageResponse(container, storageResult, options = {}) {
    const rows = rowsFromStorageResponse(storageResult);
    const t = new NxTables({
      ...options,
      container,
      data: rows,
    });
    await t.mount();
    return t;
  }

  /**
   * Ambil data lewat `NXUI.Storage` (GET / POST / `api` POST), lalu `fromStorageResponse`.
   * Pola setingkat `NexaDom` + `storage: { model }`, tetapi untuk **NxTables** (tanpa `render` HTML string).
   *
   * @param {string|Element} container
   * @param {{
   *   method?: 'get'|'post'|'api',
   *   url?: string,
   *   path?: string,
   *   options?: object,
   *   query?: object,
   *   body?: object,
   *   apiBody?: object,
   *   fetchOptions?: object,
   *   acceptObjectAsRow?: boolean,
   * }} load
   * @param {Omit<NxTablesOptions, "container"|"data">} [tableOptions]
   * @returns {Promise<NxTables>}
   *
   * - **get** (default): `Storage().get(load.url || load.path, load.options || load.query)`
   * - **post**: `Storage().post(load.path || load.url, load.body, load.fetchOptions)`
   * - **api**: `Storage().api(load.path || load.apiPath || load.url, load.body || load.apiBody)` — POST ke `baseAPI` (sama seperti `Storage().api("test", { … })` di route)
   * - **acceptObjectAsRow**: jika respons bukan array dan `rowsFromStorageResponse` kosong, bungkus satu objek `data` (atau root) jadi satu baris
   */
  static async fromStorage(container, load = {}, tableOptions = {}) {
    const storage = window.NXUI?.Storage?.();
    if (!storage || typeof storage.get !== "function") {
      throw new Error("NxTables.fromStorage: NXUI.Storage tidak tersedia");
    }
    const method = String(load.method || "get").toLowerCase();
    let raw;
    if (method === "post") {
      raw = await storage.post(
        load.path || load.url,
        load.body ?? {},
        load.fetchOptions ?? {}
      );
    } else if (method === "api") {
      raw = await storage.api(
        load.path || load.apiPath || load.url,
        load.body ?? load.apiBody ?? {}
      );
    } else {
      raw = await storage.get(
        load.url || load.path,
        load.options ?? load.query ?? {}
      );
    }

    if (load.acceptObjectAsRow) {
      const rows = rowsFromStorageResponse(raw);
      if (
        rows.length === 0 &&
        raw &&
        typeof raw === "object"
      ) {
        const cand =
          raw.data !== undefined && raw.data !== null ? raw.data : raw;
        if (
          cand &&
          typeof cand === "object" &&
          !Array.isArray(cand)
        ) {
          raw = { ...raw, data: [cand] };
        }
      }
    }

    return NxTables.fromStorageResponse(container, raw, tableOptions);
  }

  /**
   * Ambil data lewat `NXUI.Storage().buckets(app).get(getOptions)` (query / federated),
   * lalu `fromStorageResponse` — pola sama seperti `about.js` (objek `app` + alias).
   *
   * @param {string|Element} container
   * @param {object} app — konfigurasi bucket (alias, aliasNames, tabelName, operasi, access, id, …)
   * @param {object} [getOptions] — argumen ke `.get()`, mis. `{ limit: 50 }`
   * @param {Omit<NxTablesOptions, "container"|"data">} [tableOptions]
   * @returns {Promise<NxTables>}
   */
  static async fromBuckets(container, app, getOptions = {}, tableOptions = {}) {
    const storage = window.NXUI?.Storage?.();
    if (!storage || typeof storage.buckets !== "function") {
      throw new Error("NxTables.fromBuckets: NXUI.Storage tidak tersedia");
    }
    const raw = await storage.buckets(app).get(getOptions);
    return NxTables.fromStorageResponse(container, raw, tableOptions);
  }

  _isHiddenColumnKey(key) {
    if (!key || !Array.isArray(this.hideColumnKeys)) return false;
    return this.hideColumnKeys.includes(key);
  }

  getColumns() {
    let baseCols;
    if (this.columns && this.columns.length) {
      baseCols = this.columns.filter(
        (c) => c && c.key && !this._isHiddenColumnKey(c.key)
      );
    } else {
      baseCols = inferColumns(this._data).filter(
        (c) => c && c.key && !this._isHiddenColumnKey(c.key)
      );
    }

    if (this.rowNumberColumn) {
      baseCols = [
        { key: "__rowNo__", title: this.rowNumberColumnTitle || "No." },
        ...baseCols,
      ];
    }

    if (this._hasRowActions) {
      const exists = baseCols.some((c) => c && c.key === "__actions__");
      if (!exists) {
        const actionsCol = {
          key: "__actions__",
          title: this.actionsColumnTitle,
        };
        if (this.actionsColumnPosition === "start") {
          return [actionsCol, ...baseCols];
        }
        return [...baseCols, actionsCol];
      }
    }
    return baseCols;
  }

  /**
   * @param {Array<object>} rows
   */
  setData(rows) {
    this._data = Array.isArray(rows) ? [...rows] : [];
    this._sortKey = null;
    this._sortDir = "asc";
    this._page = 0;
    this._applyFilter();
  }

  /**
   * Hapus baris dari data internal + re-render tanpa harus reload.
   * @param {function} predicate - fn(row) return true untuk baris yang dihapus
   */
  deleteRow(predicate) {
    if (typeof predicate !== "function") return;
    const before = this._data.length;
    this._data = this._data.filter((r) => !predicate(r));
    if (this._data.length < before) {
      this._sortKey = null;
      this._sortDir = "asc";
      this._applyFilter();
    }
  }

  _applyFilter() {
    const q = (this._searchInput?.value || "").trim().toLowerCase();

    // In server-side mode: send search to server via debounced _fetchServerPage(0).
    if (this.serverSide) {
      const newSearch = q; // already trimmed + lowercased above
      if (newSearch !== this._serverSearch) {
        // Search term changed — debounce then re-fetch from page 0.
        this._serverSearch = newSearch;
        if (this._searchDebounceTimer) clearTimeout(this._searchDebounceTimer);
        this._searchDebounceTimer = setTimeout(() => {
          this._page = 0;
          this._fetchServerPage(0);
        }, 350);
      } else {
        // No search change (e.g. called from column-menu sort or column filter) — re-render local data with column filters.
        let rows = Array.isArray(this._data) ? [...this._data] : [];
        const colFilters = this._columnFilters || {};
        const activeColEntries = Object.entries(colFilters)
          .filter(([_, v]) => v != null && String(v).trim() !== "")
          .map(([k, v]) => [k, String(v).trim().toLowerCase()]);
        if (activeColEntries.length) {
          rows = rows.filter((row) => {
            if (!row || typeof row !== "object") return false;
            return activeColEntries.every(([k, fv]) => {
              const val = cellText(row?.[k]).toLowerCase();
              return val.includes(fv);
            });
          });
        }
        this._filtered = rows;
        if (this._sortKey) this._sortRows();
        const maxPage = Math.max(0, Math.ceil(this._filtered.length / this.pageSize) - 1);
        if (this._page > maxPage) this._page = maxPage;
        this._renderBody();
        this._renderPagination();
      }
      return;
    }

    // ── Client-side mode below ──

    // 1) Column filters
    let rows = Array.isArray(this._data) ? [...this._data] : [];
    const colFilters = this._columnFilters || {};
    const activeColEntries = Object.entries(colFilters)
      .filter(([_, v]) => v != null && String(v).trim() !== "")
      .map(([k, v]) => [k, String(v).trim().toLowerCase()]);

    if (activeColEntries.length) {
      rows = rows.filter((row) => {
        if (!row || typeof row !== "object") return false;
        return activeColEntries.every(([k, fv]) => {
          const val = cellText(row?.[k]).toLowerCase();
          return val.includes(fv);
        });
      });
    }

    // 2) Global search
    if (q) {
      rows = rows.filter((row) => {
        if (!row || typeof row !== "object") return false;
        return Object.values(row).some((v) =>
          cellText(v).toLowerCase().includes(q)
        );
      });
    }

    this._filtered = rows;

    if (this._sortKey) {
      this._sortRows();
    }
    const maxPage = Math.max(
      0,
      Math.ceil(this._filtered.length / this.pageSize) - 1
    );
    if (this._page > maxPage) this._page = maxPage;
    this._persistPage();
    this._renderBody();
    this._renderPagination();
  }

  /**
   * Load data dari `NXUI.Storage().model().select().get()` menggunakan pola:
   * `storage: { model, select?, query?(builder) }`
   */
  async _loadStorageModelDataIfNeeded() {
    if (!this.storageModel || typeof this.storageModel.model !== "string") return;
    if (Array.isArray(this._data) && this._data.length > 0) return; // data precedence

    const storage = window.NXUI?.Storage?.();
    if (!storage || typeof storage.model !== "function") return;

    const model = this.storageModel.model;
    const sel =
      this.storageModel.select !== undefined && this.storageModel.select !== null
        ? this.storageModel.select
        : "*";

    let q = storage.model(model).select(sel);
    if (typeof this.storageModel.query === "function") {
      const out = this.storageModel.query(q);
      if (out) q = out;
    }

    const res = await q.get();
    const rows = rowsFromStorageResponse(res);
    this._data = rows;
    this._filtered = [...rows];
  }

  _sortRows() {
    const key = this._sortKey;
    if (!key) return;
    const dir = this._sortDir === "desc" ? -1 : 1;
    this._filtered.sort((a, b) => dir * compareValues(a?.[key], b?.[key]));
  }

  _onSortClick(e) {
    // Jangan trigger sort saat klik menu filter kolom
    if (e.target?.closest?.(".nx-table-col-menu")) return;
    const th = e.target.closest("th.sortable");
    if (!th || !this._table.contains(th)) return;
    const key = th.getAttribute("data-col");
    if (!key) return;
    if (this._sortKey === key) {
      this._sortDir = this._sortDir === "asc" ? "desc" : "asc";
    } else {
      this._sortKey = key;
      this._sortDir = "asc";
    }
    this._sortRows();
    this._page = 0;
    this._persistPage();
    this._renderBody();
    this._renderPagination();
    this._updateSortIndicators();
  }

  _updateSortIndicators() {
    if (!this._table) return;
    this._table.querySelectorAll("thead th.sortable").forEach((th) => {
      const key = th.getAttribute("data-col");
      const base = th.getAttribute("data-title") || key;
      if (this._sortKey === key) {
        th.setAttribute(
          "aria-sort",
          this._sortDir === "asc" ? "ascending" : "descending"
        );
        // Switch indikator sort menjadi ikon Font Awesome.
        // Ascending: A–Z / kecil → besar
        // Descending: Z–A / besar → kecil
        const ascIcon = "icon-ic_fluent_text_sort_ascending_16_regular";
        const descIcon = "icon-ic_fluent_text_sort_descending_16_regular";
        const iconClass = this._sortDir === "asc" ? ascIcon : descIcon;

        const titleEl = th.querySelector(".nx-table-th-title");
        if (titleEl) titleEl.textContent = base;

        const iconEl = th.querySelector(".nx-table-sort-icon");
        if (iconEl) {
          iconEl.className = iconClass;
          iconEl.style.display = "inline-block";
        }
      } else {
        th.removeAttribute("aria-sort");
        const titleEl = th.querySelector(".nx-table-th-title");
        if (titleEl) titleEl.textContent = base;
        const iconEl = th.querySelector(".nx-table-sort-icon");
        if (iconEl) {
          iconEl.className = "nx-table-sort-icon";
          iconEl.style.display = "none";
        }
      }
    });
  }

  _pageSlice() {
    // In server-side mode, the server already applied offset — always slice from index 0.
    // This ensures initial over-fetch (e.g. 200 rows) still shows only pageSize rows.
    if (this.serverSide) return this._filtered.slice(0, this.pageSize);
    const start = this._page * this.pageSize;
    return this._filtered.slice(start, start + this.pageSize);
  }

  /**
   * Nilai unik (string) untuk satu kolom dari `this._data` — dipakai untuk opsi inline `type: "search"`.
   * @param {string} colKey
   * @returns {string[]}
   */
  _getDistinctColumnValues(colKey) {
    const rows = Array.isArray(this._data) ? this._data : [];
    const set = new Set();
    rows.forEach((r) => {
      if (!r || typeof r !== "object") return;
      const v = r[colKey];
      const s = cellText(v).trim();
      if (s !== "") set.add(s);
    });
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
  }

  // ─── Column resize ──────────────────────────────────────────────────────────

  _loadColWidths() {
    try {
      const raw = window.localStorage?.getItem(this._colWidthsStorageKey);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  _saveColWidths() {
    try {
      window.localStorage?.setItem(this._colWidthsStorageKey, JSON.stringify(this._colWidths));
    } catch { /* ignore */ }
  }

  /** Default min-width (px) for a column if no stored width exists */
  _defaultColMinWidth(colKey) {
    if (colKey === "__rowNo__")  return 52;
    // Cukup untuk tombol titik-tiga (20px) + padding sel.
    //
    // Sebelumnya 15px — lebih sempit dari tombolnya sendiri, sehingga
    // judul kolom meluber dan menimpa kolom sebelahnya (terlihat jelas
    // saat kolom aksi dipindah ke depan: "Actions" menabrak "No.").
    if (colKey === "__actions__") return 44;
    return 140;
  }

  /** Build / rebuild <colgroup> applying stored widths */
  _buildColgroup() {
    const cg   = document.createElement("colgroup");
    const cols = this.getColumns();
    cols.forEach((col) => {
      const colEl = document.createElement("col");
      colEl.dataset.col = col.key;
      colEl.style.boxSizing = "border-box";
      const w = this._colWidths[col.key];
      if (w) {
        colEl.style.width = `${w}px`;
      } else {
        colEl.style.width = `${this._defaultColMinWidth(col.key)}px`;
      }
      cg.appendChild(colEl);
    });
    return cg;
  }

  /**
   * Jumlah lebar semua kolom — dipakai sebagai `min-width` tabel yang
   * PASTI, ketimbang `max-content` (lihat komentar di `mount()` soal
   * kenapa `max-content` salah untuk `table-layout:fixed` + resize).
   *
   * Baca dari `<colgroup>` DOM kalau sudah ada (sumber kebenaran
   * real-time — termasuk lebar yang SEDANG di-drag, belum tersimpan ke
   * `_colWidths`), fallback ke `_colWidths`/default sebelum colgroup
   * pertama kali dibangun.
   */
  _sumColWidths() {
    if (this._colgroup) {
      let total = 0;
      this._colgroup.querySelectorAll("col[data-col]").forEach((colEl) => {
        total += parseFloat(colEl.style.width) || this._defaultColMinWidth(colEl.dataset.col);
      });
      return total;
    }
    return this.getColumns().reduce((total, col) => {
      return total + (this._colWidths[col.key] || this._defaultColMinWidth(col.key));
    }, 0);
  }

  /**
   * Terapkan `width` tabel = PERSIS jumlah lebar kolom sekarang, dalam px
   * eksplisit. WAJIB px eksplisit — bukan `auto` (kolom tidak bisa
   * mengecil di bawah kontennya, `table-layout:fixed` tidak benar-benar
   * "fixed" tanpa width eksplisit) dan bukan `100%`/`max()` (redistribusi
   * proporsional ke kolom lain). Lihat komentar panjang di `mount()`.
   */
  _syncTableWidth() {
    if (!this._table) return;
    const sumPx = this._sumColWidths();
    this._table.style.width = `${sumPx}px`;
    this._table.style.minWidth = `${sumPx}px`;
  }

  /** Sync <colgroup> widths after a resize drag */
  _applyColWidths() {
    if (!this._colgroup) return;
    this._colgroup.querySelectorAll("col[data-col]").forEach((colEl) => {
      const key = colEl.dataset.col;
      const w   = this._colWidths[key];
      colEl.style.width = w ? `${w}px` : "";
    });
  }

  /**
   * Attach drag-to-resize handles on every <th>.
   * A thin (6 px) absolutely-positioned div sits on the right edge of each
   * header cell. Dragging it updates the matching <col> width and persists
   * to localStorage.
   *
   * Ditulis ulang total (bukan tambal) — bug lama: base width diambil dari
   * `<col>.offsetWidth`, yang SELALU 0 (`<col>` tidak punya box render
   * sendiri), lalu delta mouse dihitung di atas basis 0 itu — kolom
   * melebar jauh melebihi jarak tarikan mouse yang sebenarnya. Ganti
   * total ke Pointer Events + `setPointerCapture`: satu event stream per
   * drag (tidak bisa "kehilangan" mouseup kalau kursor sempat keluar dari
   * handle/window), base width dibaca dari `<th>` (elemen yang benar-benar
   * dirender), dan lebar ditulis langsung tiap event (browser modern sudah
   * meng-coalesce pointermove ke refresh rate sendiri — tidak perlu rAF
   * manual di atasnya).
   */
  _initColResize() {
    if (!this._table) return;
    const ths = this._table.querySelectorAll("thead tr th");
    ths.forEach((th) => {
      const colKey = th.getAttribute("data-col");
      if (!colKey) return;

      th.style.position = "relative";
      th.style.boxSizing = "border-box";
      th.style.userSelect = "none";

      const handle = document.createElement("div");
      handle.className = "nx-col-resize-handle";
      handle.style.cssText = [
        "position:absolute",
        "top:0",
        "right:0",
        "width:6px",
        "height:100%",
        "cursor:col-resize",
        "z-index:2",
        "background:transparent",
        "touch-action:none",
      ].join(";");

      handle.addEventListener("mouseenter", () => {
        if (handle.dataset.dragging !== "1") handle.style.background = "rgba(9,105,218,.35)";
      });
      handle.addEventListener("mouseleave", () => {
        if (handle.dataset.dragging !== "1") handle.style.background = "transparent";
      });

      handle.addEventListener("pointerdown", (e) => {
        // Klik kanan / tombol selain kiri tidak memulai resize.
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        const colEl = this._colgroup?.querySelector(`col[data-col="${CSS.escape(colKey)}"]`);
        if (!colEl) return;

        const startX = e.clientX;
        // BUKAN `th.getBoundingClientRect().width`: terbukti (lewat log
        // instrumentasi) nilainya bisa MELOMPAT antara render awal dan
        // `pointerdown` (mis. 346.6 → 422.7) tanpa drag apa pun terjadi —
        // sumbernya reflow yang dipicu hal lain (redistribusi
        // `table-layout:fixed`, scrollbar muncul, dst), di luar kendali
        // baris ini. `<col>.style.width` adalah nilai yang KITA tulis
        // sendiri terakhir kali (lewat drag sebelumnya atau `_buildColgroup`)
        // — tidak bisa "berubah sendiri" oleh reflow, base yang pasti benar.
        const startW = parseFloat(colEl.style.width) || this._defaultColMinWidth(colKey);
        handle.dataset.dragging = "1";
        handle.style.background = "rgba(9,105,218,.55)";
        handle.setPointerCapture(e.pointerId);

        // `_syncTableWidth()` DIPANGGIL tiap event — kali ini aman: ia
        // set `width` tabel PERSIS = sum kolom (px eksplisit, tidak
        // pernah `100%`/`auto`), jadi tidak pernah ada ruang ekstra untuk
        // didistribusikan ke kolom lain oleh `table-layout:fixed`. Dua
        // percobaan sebelumnya (`max(100%,sum)`, lalu `auto`) gagal
        // karena keduanya membuat lebar tabel BUKAN persis sum — lihat
        // komentar panjang di `mount()`.
        const onMove = (mv) => {
          const newW = Math.max(20, Math.round(startW + (mv.clientX - startX)));
          colEl.style.width = `${newW}px`;
          this._syncTableWidth();
        };

        const finish = (mu) => {
          handle.removeEventListener("pointermove", onMove);
          handle.removeEventListener("pointerup", finish);
          handle.removeEventListener("pointercancel", finish);
          try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
          handle.dataset.dragging = "0";
          handle.style.background = "transparent";

          const endX = mu?.clientX ?? startX;
          const finalW = Math.max(20, Math.round(startW + (endX - startX)));
          colEl.style.width = `${finalW}px`;
          this._colWidths[colKey] = finalW;
          this._saveColWidths();
          this._syncTableWidth();
        };

        // Listener di HANDLE, bukan `document`: dengan `setPointerCapture`,
        // semua event pointer berikutnya (termasuk saat kursor sudah di
        // luar batas fisik elemen) tetap dikirim ke `handle` — tidak perlu
        // listener document-level yang harus di-cleanup manual dari
        // banyak titik keluar berbeda.
        handle.addEventListener("pointermove", onMove);
        handle.addEventListener("pointerup", finish);
        handle.addEventListener("pointercancel", finish);
      });

      th.appendChild(handle);
    });
  }

  _renderHead() {
    const cols = this.getColumns();
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    cols.forEach((col) => {
      const th = document.createElement("th");
      th.setAttribute("data-col", col.key);
      const headerLabel = formatColumnHeaderLabel(col.title || col.key);
      th.setAttribute("data-title", headerLabel);
      const isMetaCol = col.key === "__actions__" || col.key === "__rowNo__";
      const useRichHeader =
        !isMetaCol && (this.sortable || this.columnMenu);

      if (useRichHeader) {
        if (this.sortable) {
          th.className = "sortable";
        }
        // Jangan set `display:flex` langsung di <th> (bisa merusak layout tabel),
        // tapi pakai wrapper di dalamnya.
        //
        // `min-width: 0` WAJIB di sini: flex container/item defaultnya
        // `min-width: auto`, yang berarti mereka menolak mengecil di bawah
        // ukuran KONTEN-nya (min-content) — pengukuran otomatis
        // (Playwright, getBoundingClientRect) membuktikan ini persis yang
        // membuat `<th>` tetap lebar mengikuti teks judul walau `<col>`
        // sudah di-set lebih kecil oleh drag resize: `overflow:hidden` di
        // `<th>` (table.css) TIDAK CUKUP karena batasnya datang dari
        // intrinsic sizing flexbox DI DALAM `<th>`, bukan dari `<th>` itu
        // sendiri. `table-layout:fixed` pun tidak bisa menang melawan itu.
        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.alignItems = "center";
        wrap.style.justifyContent = "space-between";
        wrap.style.gap = "8px";
        wrap.style.minWidth = "0";

        const title = document.createElement("span");
        title.className = "nx-table-th-title";
        title.textContent = headerLabel;
        title.style.minWidth = "0";
        title.style.overflow = "hidden";
        title.style.textOverflow = "ellipsis";
        title.style.whiteSpace = "nowrap";

        const right = document.createElement("div");
        right.style.display = "flex";
        right.style.alignItems = "center";
        right.style.justifyContent = "flex-end";
        right.style.gap = "10px";

        if (this.sortable) {
          const icon = document.createElement("i");
          icon.className = "nx-table-sort-icon";
          icon.style.display = "none";
          icon.style.fontSize = "0.9em";
          right.appendChild(icon);
        }

        if (this.columnMenu) {
          const menuIcon = document.createElement("i");
          menuIcon.className = "nx-table-col-menu icon-ic_fluent_filter_16_regular";
          menuIcon.setAttribute("data-col", col.key);
          menuIcon.style.cursor = "pointer";
          menuIcon.style.fontSize = "0.9em";
          menuIcon.setAttribute("aria-label", `Column menu ${headerLabel}`);
          menuIcon.addEventListener("click", (ev) => {
            ev.stopPropagation();
            this._openColumnMenu(col.key, th);
          });
          right.appendChild(menuIcon);
        }

        wrap.appendChild(title);
        wrap.appendChild(right);
        th.appendChild(wrap);
      } else {
        th.textContent = headerLabel;
        if (col.key === "__actions__") {
          th.style.textAlign = "center";
        }
        if (col.key === "__rowNo__") {
          th.style.textAlign = "center";
          th.style.width = "3.25rem";
        }
      }
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    return thead;
  }

  _buildInlineEditor(colKey, rawValue, row, cfg) {
    const type = cfg?.type || "text";
    let el;
    if (type === "checkbox") {
      el = document.createElement("input");
      el.type = "checkbox";
      el.checked = Boolean(rawValue);
      el.addEventListener("change", () => {
        const next = el.checked;
        row[colKey] = next;
        if (this.onEdit) {
          this.onEdit(colKey, next, row);
        }
        if (this.container) {
          this.container.dispatchEvent(
            new CustomEvent("nexa-table-edit", {
              detail: { key: colKey, value: next, row },
            })
          );
        }
      });
      return el;
    }

    el = document.createElement("input");
    el.type = type === "number" ? "number" : "text";
    el.className = "form-nexa-control form-nexa-control-sm";
    if (type === "number") {
      if (cfg.min != null) el.min = String(cfg.min);
      if (cfg.max != null) el.max = String(cfg.max);
      if (cfg.step != null) el.step = String(cfg.step);
    }
    el.value =
      rawValue == null
        ? ""
        : typeof rawValue === "object"
        ? JSON.stringify(rawValue)
        : String(rawValue);

    const commit = () => {
      let next;
      if (type === "number") {
        const n = Number(el.value);
        next = Number.isNaN(n) ? null : n;
      } else {
        next = el.value;
      }
      row[colKey] = next;
      if (this.onEdit) {
        this.onEdit(colKey, next, row);
      }
      if (this.container) {
        this.container.dispatchEvent(
          new CustomEvent("nexa-table-edit", {
            detail: { key: colKey, value: next, row },
          })
        );
      }
    };

    el.addEventListener("change", commit);
    el.addEventListener("blur", commit);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        commit();
      }
    });

    return el;
  }

  _buildRowActionsDropdown(row) {
    if (!this._hasRowActions || !this.actions) return null;
    const enabled = this.actions || {};

    const entries = [
      { key: "view", label: "View", icon: "icon-ic_fluent_eye_16_regular" },
      { key: "add", label: "Add", icon: "icon-ic_fluent_add_16_regular" },
      { key: "edit", label: "Edit", icon: "icon-ic_fluent_edit_16_regular" },
      { key: "delete", label: "Delete", icon: "icon-ic_fluent_delete_16_regular" },
      { key: "export", label: "Export", icon: "icon-ic_fluent_arrow_export_16_regular" },
      { key: "import", label: "Import", icon: "icon-ic_fluent_arrow_import_16_regular" },
      { key: "print", label: "Print", icon: "icon-ic_fluent_print_16_regular" },
      { key: "share", label: "Share", icon: "icon-ic_fluent_share_16_regular" },
    ];

    // Aksi CUSTOM — `options.actions.custom`: array `{ key, label, icon }`
    // untuk package yang butuh aksi baris dengan makna di luar 8 kunci
    // tetap di atas (mis. "Penyimpanan"/"Buka Folder" — tidak ada kunci
    // bawaan yang cocok labelnya, memaksa pakai kunci existing dengan
    // label salah, mis. "Export" dipakai untuk aksi "Penyimpanan",
    // membingungkan user). SELALU tampil kalau didaftarkan — tidak perlu
    // `enabled[key] = true` terpisah, karena mendaftarkannya di sini
    // SUDAH berarti developer memang menghendakinya. Kunci custom TIDAK
    // BOLEH bentrok salah satu dari 8 kunci tetap (diabaikan kalau
    // bentrok, supaya `onAction` tidak pernah menerima key yang
    // maknanya ambigu antara aksi bawaan vs custom).
    const fixedKeys = new Set(entries.map((e) => e.key));
    const rawCustom = Array.isArray(enabled.custom)
      ? enabled.custom.filter(
          (e) => e && typeof e.key === "string" && e.key && !fixedKeys.has(e.key),
        )
      : [];
    // Set of KEYS, bukan referensi objek — `entries.push({...})` di bawah
    // membuat objek BARU (bukan `e` dari `rawCustom`), jadi perbandingan
    // by-reference (`customEntries.includes(e)`) akan selalu gagal walau
    // key-nya sama.
    const customKeys = new Set(rawCustom.map((e) => e.key));
    for (const e of rawCustom) {
      entries.push({
        key: e.key,
        label: typeof e.label === "string" && e.label ? e.label : e.key,
        icon: typeof e.icon === "string" && e.icon ? e.icon : "icon-ic_fluent_circle_16_regular",
      });
    }

    const anyEnabled = entries.some((e) => Boolean(enabled[e.key]) || customKeys.has(e.key));
    if (!anyEnabled) return null;

    const details = document.createElement("details");
    details.style.display = "inline-flex";
    details.style.position = "relative";
    details.style.verticalAlign = "middle";

    const summary = document.createElement("summary");
    summary.style.cursor = "pointer";
    summary.style.listStyle = "none";
    summary.style.display = "flex";
    summary.style.alignItems = "center";
    summary.style.justifyContent = "center";
    summary.style.width = "20px";
    summary.style.height = "28px";
    summary.style.padding = "0";

    const btnIcon = document.createElement("i");
    btnIcon.className = "icon-ic_fluent_more_vertical_16_regular";
    summary.appendChild(btnIcon);
    details.appendChild(summary);

    const menu = document.createElement("div");
    // SATU mode posisi saja: `fixed`, dihitung sekali saat dibuka.
    //
    // Dulu menu lahir `absolute` (`top:100%` + `left/right:0`) lalu
    // DIUBAH jadi `fixed` dua frame kemudian oleh reposition. Dua mode =
    // dua tampilan: menu muncul di titik yang tepat, lalu MELOMPAT ke
    // koordinat viewport. Menambal nilai `left`-nya tidak menolong —
    // selama dua mode itu ada, lompatannya ikut ada.
    //
    // Sekarang `fixed` sejak awal dan disembunyikan (`visibility`, bukan
    // `display`) sampai koordinatnya siap. `visibility:hidden` tetap
    // punya ukuran, jadi `offsetWidth/Height` terbaca untuk menghitung
    // posisi — `display:none` tidak bisa dipakai di sini.
    menu.style.position = "fixed";
    menu.style.visibility = "hidden";
    menu.style.top = "0";
    menu.style.left = "0";
    menu.style.background = "#ffffff";
    menu.style.border = "1px solid rgba(0,0,0,0.1)";
    menu.style.borderRadius = "8px";
    menu.style.boxShadow = "0 10px 24px rgba(0,0,0,0.12)";
    menu.style.padding = "6px";
    menu.style.minWidth = "190px";
    menu.style.zIndex = "9999";

    const actionsHandler = (actionKey) => {
      try {
        if (this.onAction) {
          this.onAction(actionKey, row);
          return;
        }
        if (this.container) {
          this.container.dispatchEvent(
            new CustomEvent("nexa-table-action", {
              detail: { action: actionKey, row },
            })
          );
        }
      } catch {
        /* ignore */
      }
    };

    entries.forEach((e) => {
      // Entry custom LOLOS tanpa `enabled[e.key]` (lihat komentar di
      // atas — terdaftar di `actions.custom` sudah cukup); entry TETAP
      // (8 kunci) tetap butuh `enabled[key] = true` seperti sebelumnya.
      if (!enabled[e.key] && !customKeys.has(e.key)) return;

      const item = document.createElement("button");
      item.type = "button";
      item.style.width = "100%";
      item.style.display = "flex";
      item.style.alignItems = "center";
      item.style.gap = "10px";
      item.style.padding = "10px 10px";
      item.style.border = "none";
      item.style.background = "transparent";
      item.style.cursor = "pointer";
      item.style.textAlign = "left";

      const i = document.createElement("i");
      i.className = e.icon;
      item.appendChild(i);

      const span = document.createElement("span");
      span.textContent = e.label;
      item.appendChild(span);

      item.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        actionsHandler(e.key);
        details.removeAttribute("open");
      });

      item.addEventListener("mouseenter", () => {
        item.style.background = "rgba(0,0,0,0.04)";
      });
      item.addEventListener("mouseleave", () => {
        item.style.background = "transparent";
      });

      menu.appendChild(item);
    });

    details.appendChild(menu);
    details._nxActionMenu = menu;
    // Induk asli — menu dipindah ke <body> saat dibuka (lihat
    // `_attachRowActionsMenuPosition`) dan dikembalikan ke sini saat
    // ditutup, supaya ikut terbuang bersama tabel.
    details._nxActionMenuHost = details;
    details._nxActionSummary = summary;

    details.addEventListener("toggle", () => {
      if (details.open) {
        this._attachRowActionsMenuPosition(details);
      } else {
        this._detachRowActionsMenuPosition(details);
      }
    });

    this._actionDetails.add(details);

    if (!this._actionsDocHandlerAttached) {
      document.addEventListener("mousedown", this._boundActionsDocMouseDown);
      this._actionsDocHandlerAttached = true;
    }

    return details;
  }

  /**
   * Menu baris memakai position:absolute di dalam area overflow — baris terakhir terpotong.
   * Saat <details> open, pindahkan ke fixed + sync posisi (scroll/resize).
   */
  _attachRowActionsMenuPosition(details) {
    const menu = details._nxActionMenu;
    const summary = details._nxActionSummary;
    if (!menu || !summary) return;

    this._detachRowActionsMenuPosition(details);

    const reposition = () => {
      if (!details.open) return;

      // Menu DIPINDAH ke <body> saat dibuka.
      //
      // `position: fixed` hanya relatif viewport kalau TIDAK ADA leluhur
      // yang membuat containing block baru. App window melakukannya:
      // `.nx-app-window` memakai `will-change: opacity, transform`
      // (system/window/style.css ~51) — dan `will-change: transform`
      // membuat containing block persis seperti `transform` sungguhan,
      // walau nilainya `none`.
      //
      // Akibatnya koordinat dari `getBoundingClientRect()` (relatif
      // VIEWPORT) diterapkan relatif app window, jadi menu tergeser
      // sejauh posisi window itu di layar — terlihat muncul beberapa
      // baris di bawah tombolnya.
      //
      // Memindahkannya ke <body> melepaskannya dari containing block
      // tersebut, tanpa menyentuh CSS window (mengubah `will-change` di
      // sana akan mematikan animasi buka/tutupnya).
      if (menu.parentNode !== document.body) {
        document.body.appendChild(menu);
      }

      const r = summary.getBoundingClientRect();
      const mh = menu.offsetHeight || 1;
      const mw = menu.offsetWidth || 190;
      const pad = 6;

      // Vertikal: di bawah tombol; pindah ke atas kalau tidak muat.
      let top = r.bottom + pad;
      if (top + mh > window.innerHeight - pad) {
        const above = r.top - mh - pad;
        top = above >= pad ? above : Math.max(pad, window.innerHeight - mh - pad);
      }

      // Horizontal: jangkar mengikuti posisi kolom aksi.
      //
      // Kolom di depan → rata KIRI tombol. Kalau tetap rata kanan
      // (`r.right - mw`), menu ditarik ke kiri sejauh lebarnya (~190px)
      // dan terlihat seperti milik kolom lain.
      let left = this.actionsColumnPosition === "start" ? r.left : r.right - mw;
      if (left < pad) left = pad;
      if (left + mw > window.innerWidth - pad) {
        left = Math.max(pad, window.innerWidth - mw - pad);
      }

      menu.style.top = `${Math.round(top)}px`;
      menu.style.left = `${Math.round(left)}px`;
      // Baru ditampilkan setelah koordinatnya benar — tidak ada frame
      // yang sempat memperlihatkan posisi sementara.
      menu.style.visibility = "visible";
    };

    // Satu frame cukup: menu sudah di DOM dan `visibility:hidden` tetap
    // punya ukuran, jadi `offsetWidth/Height` terbaca. Dua rAF bertingkat
    // dulu dipakai untuk menunggu peralihan absolute→fixed yang kini
    // sudah tidak ada.
    requestAnimationFrame(reposition);

    details._nxRowActionsReposition = reposition;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
  }

  _detachRowActionsMenuPosition(details) {
    if (!details) return;
    const menu = details._nxActionMenu;
    if (details._nxRowActionsReposition) {
      window.removeEventListener("scroll", details._nxRowActionsReposition, true);
      window.removeEventListener("resize", details._nxRowActionsReposition);
      details._nxRowActionsReposition = null;
    }
    if (menu) {
      // Tetap `fixed` — mode posisi cuma SATU (lihat
      // `_buildRowActionsDropdown`). Dulu di sini menu dikembalikan ke
      // `absolute` + `right:0`, dan itu justru yang menyiapkan lompatan
      // pada pembukaan berikutnya.
      menu.style.visibility = "hidden";

      // Kembalikan ke dalam <details> supaya menu ikut terbuang saat
      // tabel di-destroy / baris dirender ulang. Kalau ditinggal di
      // <body>, tiap render menumpuk elemen yatim yang tak pernah
      // dibersihkan.
      const induk = details._nxActionMenuHost;
      if (induk && menu.parentNode !== induk) {
        induk.appendChild(menu);
      }
    }
  }

  _closeColumnMenu() {
    if (this._columnMenuEl) {
      this._columnMenuEl.style.display = "none";
    }
    this._activeColumnMenuKey = null;
  }

  _openColumnMenu(colKey, thEl) {
    if (!this.columnMenu) return;
    if (!thEl) return;

    // If already open for same col, toggle off
    if (this._activeColumnMenuKey === colKey && this._columnMenuEl?.style.display !== "none") {
      this._closeColumnMenu();
      return;
    }

    this._activeColumnMenuKey = colKey;

    if (!this._columnMenuEl) {
      const panel = document.createElement("div");
      panel.className = "nx-table-column-menu";
      panel.style.position = "absolute";
      panel.style.zIndex = "9999";
      panel.style.background = "#ffffff";
      panel.style.border = "1px solid rgba(0,0,0,0.1)";
      panel.style.borderRadius = "8px";
      panel.style.boxShadow = "0 10px 24px rgba(0,0,0,0.12)";
      panel.style.padding = "10px";
      panel.style.minWidth = "240px";
      panel.style.display = "none";
      this._columnMenuEl = panel;

      const valInput = document.createElement("input");
      valInput.type = "text";
      valInput.placeholder = "Contains…";
      valInput.className = "form-nexa-control form-nexa-control-sm";
      valInput.setAttribute("aria-label", `Filter value ${colKey}`);
      valInput.setAttribute("list", this._columnMenuValueDatalistId);

      // Value input row
      const opRow = document.createElement("div");
      opRow.style.display = "flex";
      opRow.style.flexDirection = "column";
      opRow.style.gap = "8px";
      opRow.appendChild(valInput);

      // Datalist suggestions (berdasarkan data tabel)
      const datalistEl = document.createElement("datalist");
      datalistEl.id = this._columnMenuValueDatalistId;
      panel.appendChild(datalistEl);

      // Sort section
      const sortTitle = document.createElement("div");
      sortTitle.textContent = "Sort";
      sortTitle.style.fontWeight = "600";
      sortTitle.style.marginTop = "10px";
      sortTitle.style.marginBottom = "8px";
      sortTitle.style.fontSize = "0.9rem";
      sortTitle.style.color = "var(--nx-gray-700, #374151)";

      const sortItemsWrap = document.createElement("div");
      sortItemsWrap.style.display = "flex";
      sortItemsWrap.style.flexDirection = "column";
      sortItemsWrap.style.gap = "6px";

      const makeItem = (label, action) => {
        const item = document.createElement("div");
        item.textContent = label;
        item.dataset.action = action;
        item.style.cursor = "pointer";
        item.style.padding = "8px 10px";
        item.style.borderRadius = "6px";
        item.style.userSelect = "none";
        item.addEventListener("mouseenter", () => {
          item.style.background = "var(--nx-gray-100, #f3f4f6)";
        });
        item.addEventListener("mouseleave", () => {
          item.style.background = "";
        });
        return item;
      };

      const itemAsc = makeItem("Sort Ascending", "asc");
      const itemDesc = makeItem("Sort Descending", "desc");
      const itemClear = makeItem("Clear sort", "clear");

      sortItemsWrap.appendChild(itemAsc);
      sortItemsWrap.appendChild(itemDesc);
      sortItemsWrap.appendChild(itemClear);

      panel.appendChild(opRow);
      panel.appendChild(sortTitle);
      panel.appendChild(sortItemsWrap);

      // Save refs
      this._columnMenuValueInputEl = valInput;
      this._columnMenuItems = { itemAsc, itemDesc, itemClear };

      // Input debounce
      valInput.addEventListener("input", () => {
        const key = this._activeColumnMenuKey;
        if (!key) return;
        const v = valInput.value == null ? "" : String(valInput.value);
        if (v.trim() === "") delete this._columnFilters[key];
        else this._columnFilters[key] = v.trim();
        this._page = 0;
        this._persistPage();
        this._applyFilter();
      });

      // Terapkan segera saat user memilih value (datalist biasanya trigger `change`)
      valInput.addEventListener("change", () => {
        const key = this._activeColumnMenuKey;
        if (!key) return;
        const v = valInput.value == null ? "" : String(valInput.value);
        if (v.trim() === "") delete this._columnFilters[key];
        else this._columnFilters[key] = v.trim();
        this._page = 0;
        this._persistPage();
        this._applyFilter();
      });

      valInput.addEventListener("blur", () => {
        const key = this._activeColumnMenuKey;
        if (!key) return;
        const v = valInput.value == null ? "" : String(valInput.value);
        if (v.trim() === "") delete this._columnFilters[key];
        else this._columnFilters[key] = v.trim();
        this._page = 0;
        this._persistPage();
        this._applyFilter();
      });

      // Sort actions
      itemAsc.addEventListener("click", () => {
        const key = this._activeColumnMenuKey;
        if (!key) return;
        this._sortKey = key;
        this._sortDir = "asc";
        this._page = 0;
        this._persistPage();
        this._applyFilter();
        this._closeColumnMenu();
      });

      itemDesc.addEventListener("click", () => {
        const key = this._activeColumnMenuKey;
        if (!key) return;
        this._sortKey = key;
        this._sortDir = "desc";
        this._page = 0;
        this._persistPage();
        this._applyFilter();
        this._closeColumnMenu();
      });

      itemClear.addEventListener("click", () => {
        // Clear sort + clear filter kolom yang aktif
        const key = this._activeColumnMenuKey;
        this._sortKey = null;
        this._sortDir = "asc";
        if (key) delete this._columnFilters[key];
        this._page = 0;
        this._persistPage();
        this._applyFilter();
        this._closeColumnMenu();
      });
    }

    // Position panel relative to container
    if (!this.container) return;
    const cs = window.getComputedStyle(this.container);
    if (cs.position === "static" || !cs.position) {
      this.container.style.position = "relative";
    }

    if (!this._columnMenuEl.parentNode) {
      this.container.appendChild(this._columnMenuEl);
    }

    // Update input from current filter
    const current = this._columnFilters?.[colKey];
    if (this._columnMenuValueInputEl) {
      this._columnMenuValueInputEl.value = current ? String(current) : "";
    }

    // Update datalist suggestions for this column.
    try {
      const datalist = this._columnMenuEl?.querySelector(
        `datalist#${this._columnMenuValueDatalistId}`
      );
      if (datalist) {
        datalist.innerHTML = "";
        // Pakai data mentah agar opsi tetap ada walaupun hasil filter sebelumnya sudah mengecil / 0 baris.
        const sourceRows = Array.isArray(this._data) ? this._data : [];
        const values = Array.isArray(sourceRows)
          ? sourceRows
              .map((r) => (r ? r[colKey] : null))
              .filter((v) => v != null && String(v).trim() !== "")
          : [];
        const uniq = Array.from(new Set(values.map((v) => String(v).trim())));
        uniq.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        uniq.slice(0, 100).forEach((v) => {
          const opt = document.createElement("option");
          opt.value = v;
          datalist.appendChild(opt);
        });
      }
    } catch {
      /* ignore */
    }


    const containerRect = this.container.getBoundingClientRect();
    const thRect = thEl.getBoundingClientRect();

    const top = thRect.bottom - containerRect.top + 6;
    const left = thRect.left - containerRect.left;

    this._columnMenuEl.style.top = `${top}px`;
    this._columnMenuEl.style.left = `${left}px`;
    this._columnMenuEl.style.display = "block";

    // Start listening outside click once
    if (!this._columnMenuDocAttached) {
      document.addEventListener("mousedown", this._boundDocMouseDown);
      this._columnMenuDocAttached = true;
    }
  }

  _renderBody() {
    if (!this._tbody) return;

    // Tutup menu aksi yang masih terbuka SEBELUM baris dibuang.
    //
    // Menu yang terbuka sedang berada di <body> (dipindah oleh
    // `_attachRowActionsMenuPosition`), jadi `innerHTML = ""` di bawah
    // TIDAK ikut menghapusnya. Tanpa penutupan ini, tiap paginasi atau
    // filter meninggalkan satu menu yatim yang menggantung di layar.
    if (this._actionDetails && this._actionDetails.size) {
      this._actionDetails.forEach((d) => {
        if (d?.open) d.removeAttribute("open");
        this._detachRowActionsMenuPosition(d);
      });
      this._actionDetails.clear();
    }

    const cols = this.getColumns();
    this._tbody.innerHTML = "";
    const slice = this._pageSlice();

    if (!slice || slice.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = Math.max(1, cols.length);
      td.textContent = "Tidak ada data.";
      td.style.textAlign = "center";
      td.style.color = "var(--nx-gray-600, #6b7280)";
      td.style.fontWeight = "600";
      td.style.fontSize = "0.95rem";
      td.style.backgroundColor = "rgba(0,0,0,0.02)";
      td.style.padding = "14px 10px";
      tr.appendChild(td);
      this._tbody.appendChild(tr);
      this._updateSortIndicators();
      return;
    }

    slice.forEach((row, rowIdx) => {
      const tr = document.createElement("tr");
      // Kolom FILE: kernel fileType dipanggil setelah tr masuk DOM
      // (fileType memakai document.querySelector).
      const pendingFiles = [];
      cols.forEach((col) => {
        const td = document.createElement("td");
        if (col.key === "__rowNo__") {
          td.textContent = String(this._page * this.pageSize + rowIdx + 1);
          td.style.textAlign = "center";
          td.style.verticalAlign = "middle";
        } else if (col.key === "__actions__") {
          const el = this._buildRowActionsDropdown(row);
          if (el) td.appendChild(el);
          td.style.textAlign = "center";
          td.style.verticalAlign = "middle";
          td.style.whiteSpace = "nowrap";
        } else {
          const raw = row?.[col.key];
          // formatCell boleh mengembalikan undefined/null → jatuh ke
          // tampilan bawaan (cellText), BUKAN "undefined" literal.
          let displayText = cellText(raw);
          if (this.formatCell) {
            try {
              const formatted = this.formatCell(raw, col.key, row);
              if (formatted != null) displayText = String(formatted);
            } catch {
              /* formatCell error → pakai tampilan bawaan */
            }
          }
          const editCfg = this.editing && this.editing[col.key];

          // Kolom FILE — tampilkan lewat kernel assets/modules/type
          // (fileType): gambar → thumbnail via NEXA.url + lightbox,
          // non-gambar → ikon jenis file berwarna, PDF → preview modal.
          if (
            editCfg?.formulirType === "file" &&
            typeof raw === "string" &&
            raw.trim() !== ""
          ) {
            td.id = `nxfile-${rowIdx}-${col.key}`;
            pendingFiles.push({ path: raw.trim(), tdId: td.id });
            td.title = displayText; // path lengkap saat hover
            td.style.maxWidth = "120px";
            td.style.overflow = "hidden";
            td.style.whiteSpace = "nowrap";
            td.style.textOverflow = "ellipsis";
          } else {
            // Satu baris + ellipsis (gaya phpMyAdmin) — klik lihat full
            td.textContent = displayText;
            td.style.maxWidth = "220px";
            td.style.overflow = "hidden";
            td.style.textOverflow = "ellipsis";
            td.style.whiteSpace = "nowrap";
            if (displayText.length > 30) {
              td.title = displayText; // tooltip teks lengkap saat hover
            }
          }
          td.style.verticalAlign = "middle";

          // Tandai sel yang bisa diedit agar hanya aktif saat di-klik.
          const isInlineAllowed = !this.inlineColumns || this.inlineColumns.includes(col.key);
          if (editCfg && isInlineAllowed) {
            td.dataset.editable = "1";
            td.dataset.col = col.key;
            td.__nexaRow = row;
            td.classList.add("nx-table-editable-cell");
            td.style.cursor = "pointer";
          }
        }
        tr.appendChild(td);
      });
      this._tbody.appendChild(tr);

      // Kernel type (`NXUI.fileType`, assets/modules/type/NexaType.js) —
      // butuh elemen SUDAH di DOM (document.querySelector). Gambar →
      // thumbnail NEXA.url + lightbox; non-gambar → ikon jenis file;
      // PDF → preview modal. Dipanggil lewat API publik, bukan import.
      pendingFiles.forEach(({ path, tdId }) => {
        try {
          const nxType = window.NXUI;
          if (nxType && typeof nxType.fileType === "function") {
            nxType.fileType(path, `#${tdId}`);
          } else {
            const td = document.getElementById(tdId);
            if (td) td.textContent = path;
          }
        } catch (_) {
          /* tampilan file gagal — sel tetap bisa diedit inline */
        }
      });
    });
    this._updateSortIndicators();
  }

  /**
   * Fetch a server-side page. Calls onFetchPage(page, pageSize) and replaces _data/_filtered.
   * @param {number} page
   */
  async _fetchServerPage(page) {
    if (this._fetchingPage) return;
    this._fetchingPage = true;
    try {
      // Pass current search term as 3rd arg so caller can send it to backend.
      const result = await this.onFetchPage(page, this.pageSize, this._serverSearch || "");
      const rows = Array.isArray(result?.rows) ? result.rows : [];
      // Only update _serverTotal if the backend returned a real value (>= 0).
      // total === -1 means backend skipped COUNT(*) — keep the existing total.
      if (Number.isFinite(result?.total) && result.total >= 0) this._serverTotal = result.total;
      this._data = rows;
      this._filtered = [...rows];
      if (this._sortKey) this._sortRows();
      this._renderBody();
      this._renderPagination();
    } catch (err) {
      console.error("NxTables._fetchServerPage error:", err);
    } finally {
      this._fetchingPage = false;
    }
  }

  _renderPagination() {
    if (!this._paginationEl) return;
    const total = this.serverSide ? this._serverTotal : this._filtered.length;
    const pages = Math.max(1, Math.ceil(total / this.pageSize));
    this._paginationEl.innerHTML = "";
    this._paginationEl.className = "nx-table-pagination";

    // Layout custom: butuh dropdown di kiri dan pagination di kanan.
    this._paginationEl.style.display = "block";
    this._paginationEl.style.width = "100%";

    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.justifyContent = "space-between";
    wrapper.style.gap = "12px";
    wrapper.style.width = "100%";

    const from = total === 0 ? 0 : this._page * this.pageSize + 1;
    // In server-side mode: _data may have more rows than pageSize (e.g. initial over-fetch).
    // Use Math.min(_data.length, pageSize) so "to" matches what's actually displayed.
    const displayedCount = this.serverSide
      ? Math.min(this._data.length, this.pageSize)
      : this._filtered.length;
    const to = Math.min(
      this._page * this.pageSize + displayedCount,
      total
    );

    const info = document.createElement("div");
    info.className = this.pageInfoClass;
    info.textContent = `${from}–${to} dari ${total} baris`;

    const lengthWrap = document.createElement("div");
    lengthWrap.style.display = "flex";
    lengthWrap.style.alignItems = "center";
    lengthWrap.style.gap = "8px";

    const select = document.createElement("select");
    select.className = "form-nexa-control form-nexa-control-sm";
    select.style.maxWidth = "120px";
    select.style.width = "auto";
    select.setAttribute("aria-label", "entries per page");

    const optionValues = Array.from(
      new Set([...this.pageSizeOptions, this.pageSize])
    ).sort((a, b) => a - b);

    optionValues.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = String(v);
      opt.textContent = String(v);
      if (v === this.pageSize) opt.selected = true;
      select.appendChild(opt);
    });

    select.addEventListener("change", () => {
      const next = parseInt(select.value, 10);
      if (Number.isNaN(next) || next <= 0) return;
      this.pageSize = next;
      this._page = 0; // reset halaman
      this._persistPageSize();
      this._persistPage();
      if (this.serverSide && typeof this.onFetchPage === "function") {
        this._fetchServerPage(0);
      } else {
        this._applyFilter();
      }
    });

    lengthWrap.appendChild(select);

    const rightWrap = document.createElement("div");
    rightWrap.style.display = "flex";
    rightWrap.style.alignItems = "center";
    rightWrap.style.gap = "16px";
    rightWrap.style.flexWrap = "wrap";
    rightWrap.appendChild(info);

    const ul = document.createElement("ul");
    ul.className = this.paginationClass;
    ul.setAttribute("role", "navigation");
    ul.setAttribute("aria-label", "Paginasi tabel");

    /**
     * @param {string} label
     * @param {number} targetPage
     * @param {{ disabled?: boolean, active?: boolean, nav?: string }} [opts]
     */
    const appendPageControl = (label, targetPage, opts = {}) => {
      const { disabled = false, active = false, nav } = opts;
      const li = document.createElement("li");
      li.className = "page-item";
      if (disabled) li.classList.add("disabled");
      if (active) li.classList.add("active");
      if (nav) li.setAttribute("data-nav", nav);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "page-link";
      if (active) btn.classList.add("active");
      btn.textContent = label;
      if (nav) btn.setAttribute("data-nav", nav);
      btn.disabled = !!disabled;

      btn.addEventListener("click", () => {
        if (disabled || active) return;
        if (targetPage === this._page) return;
        this._page = targetPage;
        this._persistPage();
        if (this.serverSide && typeof this.onFetchPage === "function") {
          this._fetchServerPage(targetPage);
        } else {
          this._renderBody();
          this._renderPagination();
        }
      });

      li.appendChild(btn);
      ul.appendChild(li);
    };

    const appendEllipsis = () => {
      const li = document.createElement("li");
      li.className = "page-item disabled";
      const span = document.createElement("span");
      span.className = "page-link";
      span.style.cursor = "default";
      span.style.display = "flex";
      span.style.alignItems = "center";
      span.style.justifyContent = "center";
      span.setAttribute("aria-hidden", "true");
      const icon = document.createElement("i");
      icon.className = "icon-ic_fluent_more_horizontal_16_regular";
      span.appendChild(icon);
      li.appendChild(span);
      ul.appendChild(li);
    };

    appendPageControl("Prev", Math.max(0, this._page - 1), {
      disabled: this._page <= 0,
      nav: "prev",
    });

    appendPageControl("Next", Math.min(pages - 1, this._page + 1), {
      disabled: this._page >= pages - 1,
      nav: "next",
    });

    const MAX_MIDDLE_PAGES = 4;
    let left = Math.max(0, this._page - Math.floor(MAX_MIDDLE_PAGES / 2));
    let right = left + MAX_MIDDLE_PAGES - 1;
    if (right >= pages) {
      right = pages - 1;
      left = Math.max(0, right - MAX_MIDDLE_PAGES + 1);
    }

    if (left > 0) {
      appendPageControl("1", 0, { active: this._page === 0 });
      if (left > 1) appendEllipsis();
    }

    for (let p = left; p <= right; p++) {
      appendPageControl(String(p + 1), p, { active: p === this._page });
    }

    if (right < pages - 1) {
      if (right < pages - 2) appendEllipsis();
      appendPageControl(String(pages), pages - 1, {
        active: this._page === pages - 1,
      });
    }

    rightWrap.appendChild(ul);
    wrapper.appendChild(lengthWrap);
    wrapper.appendChild(rightWrap);
    this._paginationEl.appendChild(wrapper);
    this._applyPaginationActiveTheme();
  }

  /**
   * Terapkan warna tombol halaman aktif (mengalahkan `pagination.css` termasuk state hover).
   */
  _applyPaginationActiveTheme() {
    const hasCustom =
      this.paginationActiveBg ||
      this.paginationActiveBorder ||
      this.paginationActiveColor;
    if (!this._paginationDomId) return;

    if (!hasCustom) {
      if (this._paginationStyleEl?.parentNode) {
        this._paginationStyleEl.remove();
        this._paginationStyleEl = null;
      }
      return;
    }

    const bg = this.paginationActiveBg || "#DC2626";
    const bd = this.paginationActiveBorder || bg;
    const fg = this.paginationActiveColor || "#ffffff";
    const id = this._paginationDomId;

    const css = `#${id} .pagination .page-link.active,
#${id} .pagination .page-item.active .page-link:hover {
  background-color: ${bg} !important;
  border-color: ${bd} !important;
  color: ${fg} !important;
}`;

    if (!this._paginationStyleEl) {
      this._paginationStyleEl = document.createElement("style");
      this._paginationStyleEl.setAttribute("data-nexa-tables-pagination-theme", this._paginationDomId);
      document.head.appendChild(this._paginationStyleEl);
    }
    this._paginationStyleEl.textContent = css;
  }

  /**
   * Render ke DOM (panggil sekali). Gunakan `setData` untuk memperbarui isi.
   */
  async mount() {
    this.container.innerHTML = "";
    this._root = document.createElement("div");
    if (this.wrapperClass) {
      this._root.className = this.wrapperClass;
    }

    const exportOpts = this.exportOptions;
    const exportEnabled = !!exportOpts?.enabled;
    const hasRefresh = typeof this.onRefresh === "function";

    const hasTopBar = this.searchable || exportEnabled || hasRefresh;
    const topBar = document.createElement("div");
    topBar.style.display = "flex";
    topBar.style.alignItems = "center";
    topBar.style.gap = "12px";
    topBar.style.justifyContent =
      this.searchable && exportEnabled ? "space-between" : "flex-end";
    topBar.style.marginBottom = this.searchable ? "10px" : "6px";

    // Search + Refresh — dibungkus satu container dengan gap ketat
    const searchRefreshWrap = document.createElement("div");
    searchRefreshWrap.style.display = "flex";
    searchRefreshWrap.style.alignItems = "center";
    searchRefreshWrap.style.gap = "4px";

    // Search input
    if (this.searchable) {
      const filterWrap = document.createElement("div");
      filterWrap.className = "nx-table-filter";
      const input = document.createElement("input");
      input.type = "search";
      input.className = "form-control input-sm input-block";
      input.placeholder = "Cari…";
      input.setAttribute("autocomplete", "off");
      input.setAttribute("aria-label", "Cari di tabel");
      input.addEventListener("input", this._boundFilter);
      filterWrap.appendChild(input);
      const searchIcon = document.createElement("i");
      searchIcon.className = "icon-ic_fluent_search_16_regular nx-table-search-icon";
      searchIcon.setAttribute("aria-hidden", "true");
      filterWrap.appendChild(searchIcon);
      searchRefreshWrap.appendChild(filterWrap);
      this._searchInput = input;
    }

    // Refresh button — rapat dengan search
    if (hasRefresh) {
      const refreshBtn = document.createElement("button");
      refreshBtn.className = "nx-table-refresh-btn";
      refreshBtn.type = "button";
      refreshBtn.title = "Refresh data";
      refreshBtn.setAttribute("aria-label", "Refresh data");
      const refreshIcon = document.createElement("i");
      refreshIcon.className = "icon-ic_fluent_arrow_sync_16_regular";
      refreshBtn.appendChild(refreshIcon);
      refreshBtn.addEventListener("click", async () => {
        if (refreshBtn.disabled) return;
        refreshBtn.disabled = true;
        refreshIcon.classList.add("nx-table-refresh-spin");
        try {
          await this.onRefresh();
        } finally {
          refreshBtn.disabled = false;
          refreshIcon.classList.remove("nx-table-refresh-spin");
        }
      });
      searchRefreshWrap.appendChild(refreshBtn);
    }

    if (searchRefreshWrap.children.length) {
      topBar.appendChild(searchRefreshWrap);
    }

    // Optional export controls (kanan)
    if (exportEnabled) {
      const types =
        Array.isArray(exportOpts.types) && exportOpts.types.length
          ? exportOpts.types
          : ["csv"];
      const include = exportOpts.include || "filtered";
      const fileName =
        exportOpts.fileName || (this.caption ? this.caption : "nexa-tables");

      const exportWrap = document.createElement("div");
      exportWrap.className = "nx-table-export";
      exportWrap.style.display = "flex";
      exportWrap.style.gap = "8px";
      exportWrap.style.alignItems = "center";
      exportWrap.style.justifyContent = "flex-end";
      exportWrap.style.transform = "none";
      exportWrap.style.alignSelf = "center";
      exportWrap.style.marginTop = "0";
      exportWrap.style.gap = "6px";

      const download = (type) => {
        const rows = this._getExportRows(include);
        if (!rows || rows.length === 0) return;

        const base = this._sanitizeFileName(fileName);
        const stamp = this._dateStamp();
        switch (type) {
          case "json": {
            this._downloadFile(
              `${base}_${stamp}.json`,
              "application/json;charset=utf-8",
              JSON.stringify(rows, null, 2)
            );
            return;
          }
          case "xlsx": {
            const xlsx = this._toXLSX(rows);
            this._downloadFile(
              `${base}_${stamp}.xlsx`,
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              xlsx
            );
            return;
          }
          case "pdf": {
            this._exportToPDF(rows, base);
            return;
          }
          case "csv":
          default: {
            const csv = this._toCSV(rows);
            this._downloadFile(
              `${base}_${stamp}.csv`,
              "text/csv;charset=utf-8",
              csv
            );
            return;
          }
        }
      };

      const iconMap = {
        csv: { iconClass: "icon icon-csv" },
        json: { iconClass: "icon icon-json" },
        xlsx: { iconClass: "icon icon-xlsx" },
        pdf: { iconClass: "icon icon-pdf" },
      };
      const labelMap = {
        csv: "CSV",
        json: "JSON",
        xlsx: "XLSX",
        pdf: "PDF",
      };

      types.forEach((type) => {
        const btn = document.createElement("button");
        btn.type = "button";

        btn.className = "nx-btn nx-btn-primary1 is-small icon-button";
        btn.style.display = "inline-flex";
        btn.style.alignItems = "center";
        btn.style.justifyContent = "center";
        btn.style.padding = "5px 10px";
        btn.style.fontSize = "11px";
        btn.style.lineHeight = "1.1";
        btn.style.minHeight = "32px";
        btn.style.minWidth = "0";
        btn.style.gap = "2px";
        btn.style.columnGap = "2px";
        btn.style.whiteSpace = "nowrap";
        btn.style.backgroundColor = "transparent";
        btn.style.border = "none";
        btn.style.borderRadius = "0";
        btn.style.boxShadow = "none";

        const icon = document.createElement("span");
        icon.className = iconMap[type]?.iconClass || "icon icon-default";
        icon.style.width = "14px";
        icon.style.height = "14px";
        icon.style.margin = "0";
        icon.style.flex = "0 0 auto";
        btn.appendChild(icon);

        const span = document.createElement("span");
        span.textContent = labelMap[type] || "Download";
        // Tampilkan teks agar jelas tipe yang akan diunduh
        span.style.display = "inline-block";
        span.style.fontSize = "11px";
        span.style.fontWeight = "600";
        span.style.margin = "0";
        span.style.padding = "0";
        span.style.flex = "0 0 auto";
        btn.appendChild(span);

        btn.setAttribute("aria-label", `Download ${labelMap[type] || type}`);
        btn.addEventListener("click", () => download(type));
        this._exportButtons.push({ btn, type });
        exportWrap.appendChild(btn);
      });

      topBar.appendChild(exportWrap);
    }

    if (hasTopBar) {
      this._root.appendChild(topBar);
    }

    // If user uses `storage: { model, query }` like NexaDom,
    // load data first so head/columns can be inferred.
    let hideSpinner = null;
    try {
      if (this.spinner.enabled && this.storageModel) {
        hideSpinner = this._showSpinner();
      }
      await this._loadStorageModelDataIfNeeded();
    } catch (e) {
      console.warn("NxTables: failed to load storage model data:", e);
      this._data = [];
      this._filtered = [];
    } finally {
      if (typeof hideSpinner === "function") {
        hideSpinner();
      }
    }

    // Horizontal scroll wrapper — prevents column squeezing when there are many columns
    this._tableWrapper = document.createElement("div");
    this._tableWrapper.className = "nx-scroll-x nx-scroll-thin";
    NxTables._injectScrollStyles();

    this._table = document.createElement("table");
    this._table.className = this.sortable
      ? `${this.tableClass} nx-table-sortable`
      : this.tableClass;
    this._table.style.tableLayout = "fixed";
    // AKAR bug resize drag — dibuktikan lewat pengukuran otomatis
    // (Playwright, getBoundingClientRect sebelum/sesudah tiap langkah
    // drag simulasi, DUA penyebab berbeda ditemukan berurutan):
    //
    // 1. `width: 100%` (atau `max(100%, sum)`) — SELAMA lebar tabel bisa
    //    melebihi sum kolom, `table-layout:fixed` mendistribusikan ruang
    //    ekstra itu PROPORSIONAL ke semua kolom (bukan cuma yang
    //    di-drag) — makin lebar container relatif ke sum, makin besar
    //    distorsinya (terukur ~2x pada container 1368px vs sum 472px).
    //
    // 2. `width: auto` (percobaan berikutnya, sama-sama SALAH) — spek
    //    CSS: `table-layout:fixed` hanya benar-benar "fixed" kalau
    //    `<table>` punya WIDTH EKSPLISIT. Dengan `width:auto`, total
    //    lebar tabel tetap dihitung dari max-content kolom meski
    //    `table-layout:fixed` aktif — kolom TIDAK BISA mengecil di bawah
    //    kontennya sendiri sama sekali (dibuktikan: set `<col>` ke 80px
    //    manual, `<th>` tetap 191px = lebar teks "Judul artikel").
    //
    // Satu-satunya kombinasi yang membuat `<col>` benar-benar otoritatif:
    // `width` EKSPLISIT dalam px = PERSIS sum kolom (bukan `auto`, bukan
    // `%`, bukan `max()`). Diset di sini sebagai placeholder 0 (colgroup
    // belum ada), nilai sebenarnya dari `_syncTableWidth()` di bawah.
    this._table.style.width = "0px";
    this._table.style.minWidth = "0";

    this._colgroup = this._buildColgroup();
    this._table.appendChild(this._colgroup);
    this._table.appendChild(this._renderHead());
    this._tbody = document.createElement("tbody");
    this._table.appendChild(this._tbody);
    this._tableWrapper.appendChild(this._table);
    this._root.appendChild(this._tableWrapper);
    this._syncTableWidth();

    this._initColResize();

    if (this.sortable) {
      this._table.addEventListener("click", this._sortHandler);
    }
    if (this._tbody) {
      this._tbody.addEventListener("click", this._cellClickHandler);
    }

    this._paginationEl = document.createElement("div");
    this._paginationEl.className = "nx-table-pagination";
    this._paginationDomId = `nx-tables-pag-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    this._paginationEl.id = this._paginationDomId;
    this._root.appendChild(this._paginationEl);

    this.container.appendChild(this._root);

    if (this.serverSide) {
      // Server-side mode: render directly without client-side filter/page-reset.
      this._renderBody();
      this._renderPagination();
    } else {
      this._applyFilter();
    }
    return this;
  }

  /**
   * Spinner sederhana untuk proses async (saat ini hanya storage model di `mount()`).
   * Mengembalikan fungsi untuk menghilangkan spinner.
   */
  _showSpinner() {
    if (!this.container || typeof document === "undefined") return () => {};

    const overlay = document.createElement("div");
    const color = this.spinner.color || "#007bff";
    const msg = this.spinner.message || "";

    if (this.spinner.centerScreen) {
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.background = "rgba(0,0,0,0.25)";
      overlay.style.zIndex = "9999";
    } else {
      overlay.style.position = "absolute";
      overlay.style.inset = "0";
      overlay.style.display = "flex";
      overlay.style.alignItems =
        this.spinner.position === "top"
          ? "flex-start"
          : this.spinner.position === "bottom"
          ? "flex-end"
          : "center";
      overlay.style.justifyContent = "center";
      overlay.style.background = "rgba(255,255,255,0.6)";
      overlay.style.zIndex = "10";
    }

    const box = document.createElement("div");
    box.style.display = "flex";
    box.style.flexDirection = "column";
    box.style.alignItems = "center";
    box.style.gap = "8px";

    const circle = document.createElement("div");
    const sizePx =
      this.spinner.size === "small"
        ? 24
        : this.spinner.size === "large"
        ? 48
        : 32;
    circle.style.width = `${sizePx}px`;
    circle.style.height = `${sizePx}px`;
    circle.style.borderRadius = "50%";
    circle.style.border = `3px solid ${color}`;
    circle.style.borderTopColor = "transparent";
    circle.style.animation = "nexa-tables-spin 0.8s linear infinite";

    // Inject keyframes sekali saja
    if (!document.getElementById("nexa-tables-spinner-style")) {
      const style = document.createElement("style");
      style.id = "nexa-tables-spinner-style";
      style.textContent =
        "@keyframes nexa-tables-spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}";
      document.head.appendChild(style);
    }

    box.appendChild(circle);

    if (msg) {
      const text = document.createElement("div");
      text.textContent = msg;
      text.style.color = this.spinner.centerScreen ? "#fff" : "#333";
      text.style.fontSize = "0.9rem";
      box.appendChild(text);
    }

    overlay.appendChild(box);

    // Saat bukan centerScreen, pastikan container relatif
    if (!this.spinner.centerScreen) {
      const cs = window.getComputedStyle(this.container);
      if (cs.position === "static" || !cs.position) {
        this.container.style.position = "relative";
      }
    }

    this.container.appendChild(overlay);
    this._spinnerEl = overlay;

    return () => {
      if (this._spinnerEl && this._spinnerEl.parentNode) {
        this._spinnerEl.parentNode.removeChild(this._spinnerEl);
      }
      this._spinnerEl = null;
    };
  }

  _getExportRows(include) {
    if (include === "page") return this._pageSlice();
    if (include === "all") return Array.isArray(this._data) ? this._data : [];
    // default: filtered
    return Array.isArray(this._filtered) ? this._filtered : [];
  }

  _sanitizeFileName(name) {
    return sanitizeFileName(name);
  }

  _dateStamp() {
    return dateStamp();
  }

  _downloadFile(fileName, mime, content) {
    downloadFile(fileName, mime, content);
  }

  _exportColumns() {
    return this.getColumns().filter(
      (c) =>
        c?.key &&
        c.key !== "__actions__" &&
        c.key !== "__rowNo__"
    );
  }

  _toCSV(rows) {
    const cols = this._exportColumns();
    return toCSV(rows, cols, this.formatCell);
  }

  _escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  _rowValueForExport(row, colKey) {
    const raw = row?.[colKey];
    if (this.formatCell) {
      try {
        return this.formatCell(raw, colKey, row);
      } catch {
        // fall back to raw
      }
    }
    return raw;
  }

  /**
   * Export XLSX: menggunakan format HTML + MIME XLSX (mirip recordExport.js)
   * agar bisa diunduh tanpa dependency library besar.
   */
  _toXLSX(rows) {
    const cols = this._exportColumns();
    return toXLSXHtml(rows, cols, this.formatCell);
  }

  _exportToPDF(rows, baseFileName) {
    const cols = this._exportColumns();
    exportToPDF(rows, cols, baseFileName, this.formatCell);
  }

  /**
   * Klik pada sel body untuk mengaktifkan inline editing hanya pada sel tersebut.
   * @param {MouseEvent} e
   */
  _onCellClick(e) {
    // Klik thumbnail file (kelas nexa-lightbox dari NXUI.fileType) =
    // buka lightbox, BUKAN edit inline.
    if (e.target?.closest?.(".nexa-lightbox")) return;
    const td = e.target?.closest?.("td");
    if (!td || !this._tbody || !this._tbody.contains(td)) return;
    if (!td.dataset || td.dataset.editable !== "1") return;
    // Jika sudah ada editor (input / select / textarea), jangan re-init lagi.
    if (td.querySelector("input, select, textarea")) return;

    const colKey = td.dataset.col;
    if (!colKey || !this.editing || !this.editing[colKey]) return;
    if (this.inlineColumns && !this.inlineColumns.includes(colKey)) return;
    const cfg = this.editing[colKey];
    // Kolom FILE: klik TUNGGAL = hanya LIHAT (lightbox gambar / modal PDF
    // sudah ditangani elemennya sendiri); mengganti/upload file butuh
    // DOUBLE KLIK — supaya 1 klik tidak membuka dialog pilih file.
    if (cfg?.formulirType === "file" && e.detail < 2) return;
    const row = td.__nexaRow;
    if (!row) return;

    this._enterInlineEdit(td, colKey, row, cfg);
  }

  /**
   * Bungkus kontrol edit inline dengan tombol ikon di sampingnya (input-group)
   * — SAMA dengan floating/wizard: tipe pemilih (date/time/month/week/select/
   * search/tags) mendapat tombol PEMICU `data-nx-picker-for` (klik → showPicker
   * atau select2('open')), tipe lain mendapat tombol ikon dekoratif (aria-hidden).
   * @param {HTMLElement} control
   * @param {object} cfg
   * @param {string} fieldName
   * @returns {HTMLElement} div.input-group berisi kontrol + tombol
   */
  _wrapInlineWithIcon(control, cfg, fieldName) {
    const tipe = cfg?.formulirType || cfg?.type || "text";
    const tipePemicu = [
      "date",
      "time",
      "datetime-local",
      "month",
      "week",
      "select",
      "search",
      "tags",
    ];
    const pemicu = tipePemicu.includes(tipe);

    const div = document.createElement("div");
    div.className = "input-group";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.tabIndex = -1;
    if (pemicu) {
      btn.dataset.nxPickerFor = fieldName;
      btn.setAttribute("aria-label", cfg?.placeholder || fieldName);
    } else {
      btn.setAttribute("aria-hidden", "true");
    }
    const icon = document.createElement("i");
    icon.className = getIconByTypeUniversal(tipe, "fluent", cfg?.icons);
    btn.appendChild(icon);
    // KRITIS: tanpa ini, klik tombol ikon membuat input blur → auto-save
    // jalan sebelum user memilih — sel langsung tertutup.
    btn.addEventListener("mousedown", (ev) => ev.preventDefault());
    btn.addEventListener("click", () => {
      if (control.disabled || control.readOnly) return;
      // Select2 punya API sendiri — showPicker() tidak berlaku.
      const pakaiSelect2 =
        control.tagName === "SELECT" &&
        window.$ &&
        window.$.fn &&
        window.$.fn.select2 &&
        window.$(control).data("select2");
      if (pakaiSelect2) {
        window.$(control).select2("open");
        return;
      }
      control.focus();
      // showPicker() = API resmi untuk date/time; fallback focus() cukup.
      if (typeof control.showPicker === "function") {
        try {
          control.showPicker();
        } catch (_) {
          /* butuh gestur user */
        }
      }
    });

    const btnWrap = document.createElement("div");
    btnWrap.className = "input-group-button";
    btnWrap.appendChild(btn);

    div.appendChild(control);
    div.appendChild(btnWrap);
    return div;
  }

  /**
   * Editor inline via FLOATING (NexaFloating.generateField) — markup label,
   * ikon, input-group, dan tombol pemicu yang PERSIS sama dengan forms/
   * wizard. Instance dibuat ringan (Object.create) karena hanya generateField
   * yang dipakai — tanpa form DOM, tanpa event binding forms.
   */
  _enterInlineFloating(td, colKey, row, cfg, type, rawValue, originalNorm) {
    const normalize = (v) =>
      v == null
        ? ""
        : typeof v === "object"
          ? JSON.stringify(v)
          : String(v);

    const FloatingCtor = getFloatingCtor();
    const flo = Object.create(FloatingCtor.prototype);
    flo.formData = { settings: {} };
    flo.settings = {};
    flo.options = { mode: "update" };
    flo.formId = `inline-${colKey}`;
    // Nilai lama di-escape HTML — generator floating menyisipkan string
    // mentah ke atribut value (data user bisa memuat tanda kutip).
    const safeValue =
      typeof rawValue === "string"
        ? rawValue
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;")
        : rawValue;
    flo.value = { [colKey]: safeValue };
    flo.getFormStyle = () => ({
      floating: true,
      size: "form-control",
      validation: true,
    });

    const fieldConfig = {
      type,
      placeholder: cfg?.placeholder || colKey,
      validation: cfg?.validation,
      icons: cfg?.icons,
      select: cfg?.select,
      select2: cfg?.select2,
      searchable: cfg?.searchable,
      height: cfg?.height,
      condition: true,
      inline: true,
    };

    let html = "";
    try {
      html = flo.generateField(colKey, fieldConfig);
    } catch (err) {
      html = "";
    }
    if (!html) {
      this._renderBody();
      return;
    }

    td.innerHTML = html;
    td.classList.add("nx-table-editing");
    td.style.cursor = "default";
    td.__nexaCommitted = false;

    // Select2 untuk select tunggal — generator floating TIDAK meng-init
    // (di forms di-init bindToDom). Di sel: init manual.
    if (type === "select") {
      const sel = td.querySelector("select");
      if (sel) {
        try {
          const nx = window.NXUI;
          if (nx && typeof nx.initSelect2 === "function") {
            nx.initSelect2(sel, { width: "100%" });
          }
        } catch (_) {
          /* Select2 opsional — select polos tetap berfungsi */
        }
      }
    }

    // Tombol pemicu (data-nx-picker-for) — di forms dibinding floating/
    // _events.js; di sel dibinding manual dengan logika yang sama
    // (select2 → open, date/time → showPicker).
    td.querySelectorAll("[data-nx-picker-for]").forEach((btn) => {
      // KRITIS: tanpa ini, klik tombol ikon membuat input blur → commit
      // (auto-save) jalan DULUAN sebelum user sempat memilih tanggal/
      // opsi — sel langsung tertutup. preventDefault pada mousedown
      // membuat fokus TETAP di input, lalu click membuka picker.
      btn.addEventListener("mousedown", (ev) => ev.preventDefault());
      btn.addEventListener("click", () => {
        const target = td.querySelector(
          `[name="${btn.getAttribute("data-nx-picker-for")}"]`
        );
        if (!target || target.disabled || target.readOnly) return;
        if (target.dataset?.nxPickerKind === "maps") return;
        const pakaiSelect2 =
          target.tagName === "SELECT" &&
          window.$ &&
          window.$.fn &&
          window.$.fn.select2 &&
          window.$(target).data("select2");
        if (pakaiSelect2) {
          window.$(target).select2("open");
          return;
        }
        target.focus();
        if (typeof target.showPicker === "function") {
          try {
            target.showPicker();
          } catch (_) {
            /* butuh gestur user */
          }
        }
      });
    });

    // ── Commit (blur / change / Enter; Escape batal) ──
    const commit = () => {
      if (td.__nexaCommitted) return;
      td.__nexaCommitted = true;
      const control = td.querySelector("input, select, textarea");
      if (!control) {
        this._renderBody();
        return;
      }
      let next;
      if (control.tagName === "SELECT") {
        // tags (multiple) → array (sama seperti forms/wizard); select
        // tunggal → string value.
        next = control.multiple
          ? Array.from(control.selectedOptions).map((o) => o.value)
          : control.value;
      } else if (control.tagName === "TEXTAREA") {
        next = control.value;
      } else if (type === "number") {
        const n = Number(control.value);
        next = Number.isNaN(n) ? null : n;
      } else {
        next = control.value;
      }
      const nextNorm = normalize(next);
      if (nextNorm !== originalNorm) {
        row[colKey] = next;
        if (this.onEdit) {
          this.onEdit(colKey, next, row);
        }
        if (this.container) {
          this.container.dispatchEvent(
            new CustomEvent("nexa-table-edit", {
              detail: { key: colKey, value: next, row },
            })
          );
        }
      }
      this._renderBody();
    };

    const cancel = () => {
      td.__nexaCommitted = true;
      this._renderBody();
    };

    td.querySelectorAll("input, select, textarea").forEach((el) => {
      // Select/Select2: commit saat value berubah, bukan di blur — biar
      // user sempat memilih opsi dari dropdown dulu.
      if (el.tagName === "SELECT") {
        el.addEventListener("change", commit);
        return;
      }
      el.addEventListener("blur", (ev) => {
        // JANGAN commit kalau fokus pindah ke tombol pemicu ikon atau
        // elemen dropdown Select2 — user belum selesai memilih (mis.
        // belum memilih tanggal dari kalender yang baru dibuka).
        const rt = ev.relatedTarget;
        if (
          rt &&
          (rt.closest?.("[data-nx-picker-for]") ||
            rt.closest?.(".select2-container, .select2-dropdown, .select2-search"))
        ) {
          return;
        }
        commit();
      });
      el.addEventListener("keydown", (ev) => {
        const textareaEnter = el.tagName === "TEXTAREA" && !(ev.ctrlKey || ev.metaKey);
        if (ev.key === "Enter" && !textareaEnter) {
          ev.preventDefault();
          commit();
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          cancel();
        }
      });
    });

    const first = td.querySelector(
      "input:not([type='hidden']):not([type='checkbox']):not([type='radio']), select, textarea"
    );
    if (first) {
      first.focus();
      first.select?.();
    }
  }

  /**
   * Masuk ke mode edit pada satu sel.
   */
  _enterInlineEdit(td, colKey, row, cfg) {
    const type = cfg?.formulirType || cfg?.type || "text";
    const rawValue = row?.[colKey];
    const normalize = (v) =>
      v == null
        ? ""
        : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
    const originalNorm = normalize(rawValue);

    // Bersihkan isi sel dan bangun editor.
    td.innerHTML = "";
    td.classList.add("nx-table-editing");
    td.style.cursor = "default";
    // Flag supaya commit hanya sekali per sesi edit.
    td.__nexaCommitted = false;

    // Tipe yang didukung FLOATING dirender PERSIS seperti forms/wizard
    // (label + ikon + input-group + tombol pemicu) — hanya bila host
    // menyediakan generator floating; jika tidak, jatuh ke editor lokal.
    const tipeFloating = [
      "text", "email", "tel", "url",
      "date", "datetime-local", "time", "month", "week",
      "number", "color", "range",
      "select", "tags",
    ];
    if (tipeFloating.includes(type) && getFloatingCtor()) {
      return this._enterInlineFloating(
        td, colKey, row, cfg, type, rawValue, originalNorm
      );
    }

    // FILE — klik sel langsung membuka dialog pemilih file (seperti
    // forms/wizard). File yang dipilih dikirim via onEdit → pipeline
    // sendModelAction → send/upload.js mengenali File/Blob → req.upload
    // → tersimpan ke storage. Nilai row TIDAK diubah (sel tetap
    // menampilkan referensi lama sampai tabel dimuat ulang).
    if (type === "file") {
      const input = document.createElement("input");
      input.type = "file";
      if (cfg?.accept) input.accept = String(cfg.accept);
      const restore = () => {
        if (td.__nexaCommitted) return;
        td.__nexaCommitted = true;
        this._renderBody();
      };
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) {
          restore();
          return;
        }
        if (td.__nexaCommitted) return;
        td.__nexaCommitted = true;
        if (this.onEdit) {
          this.onEdit(colKey, file, row);
        }
        if (this.container) {
          this.container.dispatchEvent(
            new CustomEvent("nexa-table-edit", {
              detail: { key: colKey, value: file, row },
            })
          );
        }
        this._renderBody();
      });
      // Dismiss dialog tanpa memilih (Chromium) → kembali ke tampilan sel.
      input.addEventListener("cancel", restore);
      td.appendChild(input);
      // `input.click()` butuh gestur user — dipanggil dari klik sel. ✓
      input.click();
      return;
    }

    if (type === "checkbox") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(rawValue);

      const commitCheckbox = () => {
        if (td.__nexaCommitted) return;
        td.__nexaCommitted = true;
        const next = Boolean(input.checked);
        const nextNorm = normalize(next);
        if (nextNorm !== originalNorm) {
          row[colKey] = next;
          if (this.onEdit) {
            this.onEdit(colKey, next, row);
          }
          if (this.container) {
            this.container.dispatchEvent(
              new CustomEvent("nexa-table-edit", {
                detail: { key: colKey, value: next, row },
              })
            );
          }
        }
        // Kembali ke tampilan teks setelah edit.
        this._renderBody();
      };

      input.addEventListener("change", commitCheckbox);
      input.addEventListener("blur", commitCheckbox);

      td.appendChild(input);
      input.focus();
      return;
    }

    // SELECT — atau SEARCH (Select2 + opsi dari kolom / options)
    if (type === "select" || type === "search") {
      const select = document.createElement("select");
      select.className = "form-nexa-control form-nexa-control-sm";
      let opts;
      if (type === "select") {
        opts = Array.isArray(cfg.options) ? cfg.options : [];
      } else {
        // type === "search": seperti select dengan data kolom; opsi eksplisit mengalahkan.
        opts =
          Array.isArray(cfg.options) && cfg.options.length
            ? cfg.options
            : this._getDistinctColumnValues(colKey);
      }
      const currentStr =
        rawValue == null
          ? ""
          : typeof rawValue === "object"
          ? JSON.stringify(rawValue)
          : String(rawValue);
      if (type === "search" && currentStr) {
        const exists = opts.some((opt) => {
          if (typeof opt === "string") return opt === currentStr;
          if (opt && typeof opt === "object")
            return String(opt.value ?? "") === currentStr;
          return false;
        });
        if (!exists) opts = [currentStr, ...opts];
      }
      opts.forEach((opt) => {
        const o = document.createElement("option");
        if (typeof opt === "string") {
          o.value = opt;
          o.textContent = opt;
        } else if (opt && typeof opt === "object") {
          o.value = String(opt.value ?? "");
          o.textContent = opt.label ?? String(opt.value ?? "");
        }
        select.appendChild(o);
      });
      const current =
        rawValue == null
          ? ""
          : typeof rawValue === "object"
          ? JSON.stringify(rawValue)
          : String(rawValue);
      select.value = current;

      const commitSelect = () => {
        if (td.__nexaCommitted) return;
        td.__nexaCommitted = true;
        const next = select.value;
        const nextNorm = normalize(next);
        if (nextNorm !== originalNorm) {
          row[colKey] = next;
          if (this.onEdit) {
            this.onEdit(colKey, next, row);
          }
          if (this.container) {
            this.container.dispatchEvent(
              new CustomEvent("nexa-table-edit", {
                detail: { key: colKey, value: next, row },
              })
            );
          }
        }
        this._renderBody();
      };

      // Untuk select, commit hanya saat value berubah (event change),
      // jangan di blur supaya user sempat memilih opsi dari dropdown.
      select.addEventListener("change", commitSelect);

      // Tombol ikon pemicu di samping select — SAMA dengan floating
      // (input-group + data-nx-picker-for → select2('open')).
      td.appendChild(this._wrapInlineWithIcon(select, cfg, colKey));
      select.focus();
      // Upgrade ke Select2 jika tersedia lewat NXUI.initSelect2
      try {
        const nx = window.NXUI;
        if (nx && typeof nx.initSelect2 === "function") {
          // Gunakan selector langsung ke element, Select2 mendukung ini.
          nx.initSelect2(select, {
            width: "100%",
          });
          // Jika helper onSelect2Change tersedia, pastikan commitSelect terpanggil
          // saat user memilih opsi di dropdown Select2.
          if (typeof nx.onSelect2Change === "function") {
            nx.onSelect2Change(select, () => {
              commitSelect();
            });
          }
        }
      } catch {
        // abaikan error Select2
      }
      return;
    }

    // TEXTAREA
    if (type === "textarea") {
      const ta = document.createElement("textarea");
      ta.className = "form-nexa-control form-nexa-control-sm";
      ta.rows = cfg.rows != null ? cfg.rows : 3;
      ta.value =
        rawValue == null
          ? ""
          : typeof rawValue === "object"
          ? JSON.stringify(rawValue)
          : String(rawValue);

      const commitTextarea = () => {
        if (td.__nexaCommitted) return;
        td.__nexaCommitted = true;
        const next = ta.value;
        const nextNorm = normalize(next);
        if (nextNorm !== originalNorm) {
          row[colKey] = next;
          if (this.onEdit) {
            this.onEdit(colKey, next, row);
          }
          if (this.container) {
            this.container.dispatchEvent(
              new CustomEvent("nexa-table-edit", {
                detail: { key: colKey, value: next, row },
              })
            );
          }
        }
        this._renderBody();
      };

      ta.addEventListener("blur", commitTextarea);
      ta.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault();
          commitTextarea();
        }
        if (ev.key === "Escape") {
          ev.preventDefault();
          this._renderBody();
        }
      });

      td.appendChild(ta);
      ta.focus();
      ta.select?.();
      return;
    }

    const input = document.createElement("input");
    const allowedTypes = [
      "text",
      "number",
      "email",
      "password",
      "tel",
      "url",
      "date",
      "datetime-local",
      "time",
      "color",
      "range",
    ];
    const htmlType = allowedTypes.includes(type) ? type : "text";
    input.type = htmlType;
    input.className = "form-nexa-control form-nexa-control-sm";
    if (type === "number") {
      if (cfg.min != null) input.min = String(cfg.min);
      if (cfg.max != null) input.max = String(cfg.max);
      if (cfg.step != null) input.step = String(cfg.step);
    }
    input.value =
      rawValue == null
        ? ""
        : typeof rawValue === "object"
        ? JSON.stringify(rawValue)
        : String(rawValue);

    const commitText = () => {
      if (td.__nexaCommitted) return;
      td.__nexaCommitted = true;
      let next;
      if (type === "number") {
        const n = Number(input.value);
        next = Number.isNaN(n) ? null : n;
      } else {
        next = input.value;
      }
      const nextNorm = normalize(next);
      if (nextNorm !== originalNorm) {
        row[colKey] = next;
        if (this.onEdit) {
          this.onEdit(colKey, next, row);
        }
        if (this.container) {
          this.container.dispatchEvent(
            new CustomEvent("nexa-table-edit", {
              detail: { key: colKey, value: next, row },
            })
          );
        }
      }
      // Setelah commit, render ulang body sehingga sel kembali menjadi teks.
      this._renderBody();
    };

    input.addEventListener("blur", commitText);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commitText();
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        // Batalkan dan kembali ke tampilan awal tanpa menyimpan.
        this._renderBody();
      }
    });

    // Tipe fallback (slug/file/richtext/approval/dll) tetap input polos —
    // yang punya padanan floating sudah di-route ke _enterInlineFloating.
    td.appendChild(input);
    input.focus();
    input.select?.();
  }

  destroy() {
    if (this._table && this.sortable) {
      this._table.removeEventListener("click", this._sortHandler);
    }
    if (this._tbody && this._cellClickHandler) {
      this._tbody.removeEventListener("click", this._cellClickHandler);
    }
    if (this._searchInput) {
      this._searchInput.removeEventListener("input", this._boundFilter);
    }

    if (this._boundDocMouseDown) {
      document.removeEventListener("mousedown", this._boundDocMouseDown);
    }
    this._boundDocMouseDown = null;
    if (this._columnMenuEl?.parentNode) {
      this._columnMenuEl.parentNode.removeChild(this._columnMenuEl);
    }
    this._columnMenuEl = null;
    this._activeColumnMenuKey = null;
    if (this._columnMenuDebounceTimer) {
      clearTimeout(this._columnMenuDebounceTimer);
    }
    this._columnMenuDebounceTimer = null;

    if (this._boundActionsDocMouseDown && this._actionsDocHandlerAttached) {
      document.removeEventListener("mousedown", this._boundActionsDocMouseDown);
    }
    this._boundActionsDocMouseDown = null;
    this._actionsDocHandlerAttached = false;
    if (this._actionDetails) {
      this._actionDetails.forEach((d) => this._detachRowActionsMenuPosition(d));
      this._actionDetails.clear();
    }

    if (this._paginationStyleEl?.parentNode) {
      this._paginationStyleEl.remove();
    }
    this._paginationStyleEl = null;
    this._paginationDomId = null;
    this._exportButtons = [];
    if (this.container) {
      this.container.innerHTML = "";
    }
    this._root = null;
    this._tableWrapper = null;
    this._table = null;
    this._tbody = null;
    this._colgroup = null;
    this._searchInput = null;
    this._paginationEl = null;
  }
}
