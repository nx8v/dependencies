/**
 * Perintah JSON storage (insert, select, clear, ...) di atas require("db").
 * Dipakai sqlite, mysql, dan postgreSQL. SQL upsert berbeda per driver.
 */
function fail(error, hint) {
  return { ok: false, error, hint, meta: { error, message: hint } };
}

function ok(data, meta) {
  return { ok: true, data, meta: meta || {} };
}

function autoKey() {
  return "k-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function parseValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function col(row, name) {
  if (!row || typeof row !== "object") return undefined;
  if (row[name] !== undefined) return row[name];
  const want = name.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase() === want) return row[key];
  }
  return undefined;
}

function matchCond(actual, cond) {
  if (cond === null || typeof cond !== "object" || Array.isArray(cond)) {
    return actual === cond;
  }
  for (const op of Object.keys(cond)) {
    const expected = cond[op];
    const name = op.toLowerCase();
    if (name === "=" || name === "eq") {
      if (actual !== expected) return false;
    } else if (name === "!=" || name === "ne") {
      if (actual === expected) return false;
    } else if (name === ">") {
      if (!(actual > expected)) return false;
    } else if (name === ">=") {
      if (!(actual >= expected)) return false;
    } else if (name === "<") {
      if (!(actual < expected)) return false;
    } else if (name === "<=") {
      if (!(actual <= expected)) return false;
    } else if (name === "like" || name === "not_like" || name === "notlike") {
      if (actual == null) return false;
      const pattern = String(expected)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/%/g, ".*")
        .replace(/_/g, ".");
      const hit = new RegExp("^" + pattern + "$", "i").test(String(actual));
      if (name === "like" ? !hit : hit) return false;
    } else if (name === "in" || name === "notin" || name === "not_in") {
      if (!Array.isArray(expected)) return false;
      const hit = expected.includes(actual);
      if (name === "in" ? !hit : hit) return false;
    } else if (name === "between") {
      if (!Array.isArray(expected) || expected.length !== 2) return false;
      if (!(actual >= expected[0] && actual <= expected[1])) return false;
    } else if (name === "null" || name === "isnull" || name === "is_null") {
      if (actual != null) return false;
    } else if (name === "isnotnull" || name === "is_not_null") {
      if (actual == null) return false;
    } else if (name === "not") {
      if (expected === null) {
        if (actual == null) return false;
      } else if (matchCond(actual, expected)) return false;
    } else return false;
  }
  return true;
}

function matchWhere(value, where) {
  if (where === undefined || where === null) return true;
  if (typeof where !== "object" || Array.isArray(where)) return true;
  if (Array.isArray(where.and)) {
    if (!where.and.every((w) => matchWhere(value, w))) return false;
  }
  if (Array.isArray(where.or)) {
    if (!where.or.some((w) => matchWhere(value, w))) return false;
  }
  if (where.not && typeof where.not === "object" && !Array.isArray(where.not) && where.and === undefined && where.or === undefined && Object.keys(where).length === 1) {
    return !matchWhere(value, where.not);
  }
  for (const field of Object.keys(where)) {
    if (field === "and" || field === "or" || field === "not") continue;
    const actual = value == null ? undefined : value[field];
    if (!matchCond(actual, where[field])) return false;
  }
  return true;
}

function fieldOf(row, name) {
  if (!row) return undefined;
  if (row[name] !== undefined) return row[name];
  const short = String(name).split(".").pop();
  return row[short];
}

function orderRows(rows, order) {
  if (!Array.isArray(order) || !order.length) return rows;
  const spec = order.map((o) => ({
    column: o.column || o.kolom,
    dir: String(o.dir || "asc").toLowerCase() === "desc" ? -1 : 1,
  }));
  return rows.slice().sort((a, b) => {
    for (const o of spec) {
      const av = fieldOf(a, o.column);
      const bv = fieldOf(b, o.column);
      if (av < bv) return -1 * o.dir;
      if (av > bv) return 1 * o.dir;
    }
    return 0;
  });
}

function aggOf(rows, spec) {
  const fn = ["count", "sum", "avg", "min", "max"].find((k) => spec[k] !== undefined);
  if (!fn) return undefined;
  const field = spec[fn];
  let list = rows;
  if (spec.filter) list = rows.filter((r) => matchWhere(r, spec.filter));
  let vals = list.map((r) => (field === "*" ? 1 : fieldOf(r, field)));
  if (spec.distinct) {
    const seen = new Set();
    vals = vals.filter((v) => {
      const k = JSON.stringify(v);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  if (fn === "count") {
    return field === "*" ? list.length : vals.filter((v) => v != null).length;
  }
  const nums = vals.filter((v) => typeof v === "number");
  if (!nums.length) return null;
  if (fn === "sum") return nums.reduce((a, b) => a + b, 0);
  if (fn === "avg") return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (fn === "min") return Math.min.apply(null, nums);
  if (fn === "max") return Math.max.apply(null, nums);
  return null;
}

function projectRow(row, select) {
  if (!Array.isArray(select) || !select.length) return row;
  const out = {};
  const used = {};
  for (const col of select) {
    if (typeof col !== "string") continue;
    let name = col;
    if (col.indexOf(".") >= 0) {
      const short = col.split(".").pop();
      name = used[short] ? col : short;
      used[short] = true;
    }
    out[name] = fieldOf(row, col);
  }
  return out;
}

function shapePage(rows, cmd) {
  let list = rows.filter((r) => matchWhere(r, cmd.where));
  const grouped = Array.isArray(cmd.group) && cmd.group.length;
  const select = cmd.select;
  const hasAgg = Array.isArray(select) && select.some((c) => c && typeof c === "object");
  if (grouped || hasAgg) {
    if (cmd.after) return { error: fail("validation_failed", "after tidak bisa dipakai bersama group") };
    if (cmd.having && !grouped) return { error: fail("validation_failed", "having butuh group") };
    const buckets = new Map();
    const keys = grouped ? cmd.group : [];
    for (const row of list) {
      const id = JSON.stringify(keys.map((g) => fieldOf(row, g)));
      if (!buckets.has(id)) buckets.set(id, []);
      buckets.get(id).push(row);
    }
    list = [];
    for (const bucket of buckets.values()) {
      const sample = bucket[0];
      const out = {};
      if (Array.isArray(select)) {
        for (const col of select) {
          if (typeof col === "string") out[col.split(".").pop()] = fieldOf(sample, col);
          else if (col && typeof col === "object") {
            const alias = col.as || "agg";
            out[alias] = aggOf(bucket, col);
          }
        }
      }
      list.push(out);
    }
    if (cmd.having) list = list.filter((r) => matchWhere(r, cmd.having));
  } else {
    list = orderRows(list, cmd.order);
    if (cmd.after && Array.isArray(cmd.order) && cmd.order.length) {
      const col = cmd.order[0].column || cmd.order[0].kolom;
      const desc = String(cmd.order[0].dir || "").toLowerCase() === "desc";
      const mark = cmd.after[col] !== undefined ? cmd.after[col] : cmd.after[col.split(".").pop()];
      list = list.filter((r) => (desc ? fieldOf(r, col) < mark : fieldOf(r, col) > mark));
    }
    if (cmd.distinct) {
      const seen = new Set();
      list = list.filter((r) => {
        const view = projectRow(r, select);
        const k = JSON.stringify(view);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    list = list.map((r) => projectRow(r, select));
  }
  const total = list.length;
  const offset = Number(cmd.offset) > 0 ? Number(cmd.offset) : 0;
  const limit = Number(cmd.limit) > 0 ? Number(cmd.limit) : 0;
  let page = offset ? list.slice(offset) : list;
  let hasMore = false;
  if (limit) {
    hasMore = page.length > limit;
    page = page.slice(0, limit);
  }
  const meta = { count: page.length };
  if (limit) meta.limit = limit;
  if (offset) meta.offset = offset;
  if (cmd.countTotal) meta.total = total;
  if (limit && Array.isArray(cmd.order) && cmd.order.length) {
    meta.hasMore = hasMore;
    if (hasMore && page.length) {
      const col = cmd.order[0].column || cmd.order[0].kolom;
      const last = page[page.length - 1];
      const key = col.split(".").pop();
      meta.next = {};
      meta.next[key] = last[key] !== undefined ? last[key] : last[col];
    }
  }
  return { rows: page, meta };
}

function upsert(c, name, ns, table, id, json) {
  if (name === "mysql") {
    c.run(
      "INSERT INTO nx_kv (ns, tbl, k, v) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)",
      [ns, table, id, json]
    );
    return;
  }
  if (name === "postgreSQL") {
    c.run(
      "INSERT INTO nx_kv (ns, tbl, k, v) VALUES (?, ?, ?, ?) ON CONFLICT (ns, tbl, k) DO UPDATE SET v = EXCLUDED.v",
      [ns, table, id, json]
    );
    return;
  }
  c.run("INSERT OR REPLACE INTO nx_kv (ns, tbl, k, v) VALUES (?, ?, ?, ?)", [ns, table, id, json]);
}

function createHandle(spec) {
  let conn = null;
  let place = "";

  function drop() {
    const old = conn;
    conn = null;
    place = "";
    if (!old) return;
    try { old.close(); } catch (ignore) {}
  }

  function database() {
    if (conn) return conn;
    const opened = spec.connect(require("db"));
    conn = opened.conn;
    place = opened.place || "";
    return conn;
  }

  function rowsOf(ns, table) {
    const list = database().all(
      "SELECT k, v FROM nx_kv WHERE ns = ? AND tbl = ? ORDER BY k",
      [ns, table]
    );
    const out = [];
    for (const row of list) {
      const value = parseValue(col(row, "v"));
      if (value === undefined) continue;
      out.push({ key: String(col(row, "k")), value });
    }
    return out;
  }

  function asRecord(row) {
    if (row.value && typeof row.value === "object" && !Array.isArray(row.value)) {
      return Object.assign({ id: row.key }, row.value);
    }
    return { id: row.key, value: row.value };
  }

  function records(ns, table) {
    return rowsOf(ns, table).map(asRecord);
  }

  function schemaOf(ns, table) {
    const row = database().get(
      "SELECT v FROM nx_kv WHERE ns = ? AND tbl = ? AND k = ?",
      [ns, "__nx_schema", table]
    );
    if (!row) return null;
    const value = parseValue(col(row, "v"));
    return value && typeof value === "object" ? value : null;
  }

  function saveSchema(ns, table, schema) {
    upsert(database(), spec.name, ns, "__nx_schema", table, JSON.stringify(schema));
  }

  function canonType(t) {
    const s = String(t || "text").toLowerCase();
    if (s === "int" || s === "integer") return "integer";
    if (s === "bool" || s === "boolean") return "bool";
    if (s === "real" || s === "float" || s === "double" || s === "number") return "real";
    return "text";
  }

  function typeOk(typ, value) {
    if (value == null) return true;
    if (typ === "integer") return typeof value === "number" && Number.isInteger(value);
    if (typ === "bool") return typeof value === "boolean" || value === 0 || value === 1;
    if (typ === "real") return typeof value === "number";
    return typeof value === "string";
  }

  function checkTypes(schema, data, rowNo) {
    if (!schema || !schema.columns || !data || typeof data !== "object") return null;
    for (const name of Object.keys(data)) {
      if (name === "id") continue;
      const declared = schema.columns[name];
      if (!declared) continue;
      if (!typeOk(canonType(declared), data[name])) {
        return "kolom '" + name + "' bertipe " + declared + " tetapi nilai pada baris " + rowNo + " bukan tipe itu";
      }
    }
    return null;
  }

  function checkUnique(ns, table, schema, data, ignoreId) {
    if (!schema || !Array.isArray(schema.indexes)) return null;
    const rows = records(ns, table);
    for (const idx of schema.indexes) {
      if (!idx.unique || !Array.isArray(idx.columns)) continue;
      const clash = rows.some((r) => String(r.id) !== String(ignoreId) && idx.columns.every((c) => r[c] === data[c]));
      if (clash) return "nilai " + idx.columns.join(", ") + " sudah dipakai";
    }
    return null;
  }

  function jawab(cmd) {
    const name = spec.name;
    const op = String((cmd && cmd.op) || "").toLowerCase();
    const ns = (cmd && cmd.namespace) || "default";
    const table = cmd && cmd.table != null && cmd.table !== "" ? String(cmd.table) : "";
    const key = cmd && (cmd.key != null || cmd.id != null) ? String(cmd.key != null ? cmd.key : cmd.id) : "";
    const c = database();

    if (op === "tables" || op === "show_tables") {
      const list = c.all("SELECT DISTINCT tbl FROM nx_kv WHERE ns = ? ORDER BY tbl", [ns]);
      const names = list.map((r) => col(r, "tbl")).filter((t) => String(t).indexOf("__nx") !== 0);
      if (op === "tables") return ok(names, { count: names.length, driver: name });
      const data = names.map((t) => {
        const schema = schemaOf(ns, t);
        const cols = new Set(["id"]);
        const types = { id: "text" };
        if (schema && schema.columns) {
          for (const k of Object.keys(schema.columns)) {
            cols.add(k);
            types[k] = schema.columns[k];
          }
        }
        for (const row of records(ns, t)) {
          for (const k of Object.keys(row)) {
            if (!cols.has(k)) {
              cols.add(k);
              types[k] = types[k] || typeof row[k];
            }
          }
        }
        return { table: t, columns: [...cols], types };
      });
      return ok(data, { count: data.length, driver: name });
    }

    if (op === "tx") {
      const steps = Array.isArray(cmd.ops) ? cmd.ops : null;
      if (!steps || !steps.length) return fail("bad_request", "tx butuh 'ops' berisi insert, update, atau delete");
      for (const step of steps) {
        const sop = String((step && step.op) || "").toLowerCase();
        if (sop !== "insert" && sop !== "update" && sop !== "delete" && sop !== "remove") {
          return fail("validation_failed", "tx hanya boleh insert, update, dan delete");
        }
      }
      c.exec("BEGIN");
      try {
        const applied = [];
        for (const step of steps) {
          const hasil = jawab(Object.assign({ namespace: ns }, step));
          if (!hasil.ok) {
            c.exec("ROLLBACK");
            return hasil;
          }
          applied.push(hasil);
        }
        c.exec("COMMIT");
        return ok(applied, { applied: applied.length, driver: name });
      } catch (e) {
        try { c.exec("ROLLBACK"); } catch (ignore) {}
        throw e;
      }
    }

    if (op === "migrate" || op === "migration_status" || op === "create_migration") {
      const bag = schemaOf(ns, "__nx_migrations") || { items: [] };
      if (!Array.isArray(bag.items)) bag.items = [];
      if (op === "create_migration") {
        if (cmd.version == null) return fail("bad_request", "create_migration butuh 'version'");
        bag.items = bag.items.filter((m) => m.version !== cmd.version);
        bag.items.push({ version: cmd.version, name: cmd.name || "", ops: cmd.ops || [], applied: false });
        bag.items.sort((a, b) => a.version - b.version);
        saveSchema(ns, "__nx_migrations", bag);
        return ok({ version: cmd.version, name: cmd.name || "" }, { driver: name });
      }
      if (op === "migration_status") {
        return ok(bag.items.map((m) => ({
          version: m.version,
          name: m.name || "",
          applied: !!m.applied,
          appliedAt: m.appliedAt || null,
        })), { count: bag.items.length, driver: name });
      }
      c.exec("BEGIN");
      try {
        const done = [];
        for (const m of bag.items) {
          if (m.applied) continue;
          for (const step of m.ops || []) {
            const hasil = jawab(Object.assign({ namespace: ns }, step));
            if (!hasil.ok) {
              c.exec("ROLLBACK");
              return hasil;
            }
          }
          m.applied = true;
          m.appliedAt = new Date().toISOString();
          done.push({ version: m.version, name: m.name || "", applied: true });
        }
        saveSchema(ns, "__nx_migrations", bag);
        c.exec("COMMIT");
        return ok(done, { rowsAffected: done.length, driver: name });
      } catch (e) {
        try { c.exec("ROLLBACK"); } catch (ignore) {}
        throw e;
      }
    }

    if (op === "export") {
      const list = c.all("SELECT tbl, k, v FROM nx_kv WHERE ns = ? ORDER BY tbl, k", [ns]);
      const data = {};
      for (const row of list) {
        const value = parseValue(col(row, "v"));
        if (value === undefined) continue;
        const t = col(row, "tbl");
        data[t] = data[t] || {};
        data[t][col(row, "k")] = value;
      }
      return ok({ namespace: ns, data }, { driver: name });
    }

    if (op === "import") {
      const payload = cmd.data;
      if (!payload || typeof payload !== "object") {
        return fail("bad_request", "import butuh 'data' hasil export");
      }
      const source = payload.data && typeof payload.data === "object" ? payload.data : payload;
      let written = 0;
      for (const t of Object.keys(source)) {
        const rows = source[t];
        if (!rows || typeof rows !== "object") continue;
        for (const k of Object.keys(rows)) {
          upsert(c, name, ns, t, k, JSON.stringify(rows[k]));
          written++;
        }
      }
      return ok({ written }, { count: written, driver: name });
    }

    if (op === "info") {
      const records = c.get("SELECT COUNT(*) AS n FROM nx_kv WHERE ns = ?", [ns]);
      const tables = c.get("SELECT COUNT(DISTINCT tbl) AS n FROM nx_kv WHERE ns = ?", [ns]);
      return ok(
        {
          driver: name,
          place,
          namespace: ns,
          tables: tables ? Number(col(tables, "n")) || 0 : 0,
          records: records ? Number(col(records, "n")) || 0 : 0,
        },
        { driver: name }
      );
    }

    if (!table && !(op === "clear" && cmd.all) && op !== "join") {
      if (op === "clear") {
        return fail("no_table", "clear butuh 'table', atau all:true untuk menghapus semua data namespace ini");
      }
      if (op === "join") return fail("no_table", "join butuh 'table'");
      return fail("no_table", "Field 'table' wajib diisi");
    }

    if (op === "create_table") {
      const columns = {};
      const src = cmd.columns && typeof cmd.columns === "object" ? cmd.columns : {};
      for (const k of Object.keys(src)) columns[k] = canonType(src[k]);
      const prev = schemaOf(ns, table) || {};
      saveSchema(ns, table, Object.assign({}, prev, { columns }));
      return ok({ table, columns: ["id"].concat(Object.keys(columns)) }, { driver: name });
    }

    if (op === "drop_table") {
      const info = c.run("DELETE FROM nx_kv WHERE ns = ? AND tbl = ?", [ns, table]);
      c.run("DELETE FROM nx_kv WHERE ns = ? AND tbl = ? AND k = ?", [ns, "__nx_schema", table]);
      return ok({ table, removed: info.changes }, { count: info.changes, driver: name });
    }

    if (op === "create_index") {
      const columns = Array.isArray(cmd.columns) ? cmd.columns.map(String) : [];
      if (!columns.length) return fail("bad_request", "create_index butuh 'columns'");
      const schema = schemaOf(ns, table) || { columns: {}, indexes: [] };
      if (!Array.isArray(schema.indexes)) schema.indexes = [];
      const indexName = cmd.name || "idx_" + table + "_" + columns.join("_");
      schema.indexes = schema.indexes.filter((i) => i.name !== indexName);
      schema.indexes.push({ name: indexName, columns, unique: cmd.unique === true });
      saveSchema(ns, table, schema);
      return ok({ name: indexName, columns, unique: cmd.unique === true }, { driver: name });
    }

    if (op === "add_column") {
      if (!cmd.column) return fail("bad_request", "add_column butuh 'column'");
      const schema = schemaOf(ns, table) || { columns: {}, indexes: [] };
      if (!schema.columns) schema.columns = {};
      if (!schema.columns[cmd.column]) schema.columns[cmd.column] = canonType(cmd.type || "text");
      saveSchema(ns, table, schema);
      if (cmd.default !== undefined) {
        for (const row of records(ns, table)) {
          if (row[cmd.column] !== undefined) continue;
          const next = Object.assign({}, row, { [cmd.column]: cmd.default });
          delete next.id;
          upsert(c, name, ns, table, String(row.id), JSON.stringify(next));
        }
      }
      return ok({ table, column: cmd.column, type: schema.columns[cmd.column] }, { driver: name });
    }

    if (op === "drop_column") {
      if (!cmd.column) return fail("bad_request", "drop_column butuh 'column'");
      const schema = schemaOf(ns, table);
      if (schema && schema.columns) {
        delete schema.columns[cmd.column];
        saveSchema(ns, table, schema);
      }
      for (const row of records(ns, table)) {
        if (row[cmd.column] === undefined) continue;
        const next = Object.assign({}, row);
        delete next.id;
        delete next[cmd.column];
        upsert(c, name, ns, table, String(row.id), JSON.stringify(next));
      }
      return ok({ table, column: cmd.column }, { driver: name });
    }

    if (op === "rename_column") {
      if (!cmd.from || !cmd.to) return fail("bad_request", "rename_column butuh 'from' dan 'to'");
      const schema = schemaOf(ns, table);
      if (schema && schema.columns && schema.columns[cmd.from]) {
        schema.columns[cmd.to] = schema.columns[cmd.from];
        delete schema.columns[cmd.from];
        saveSchema(ns, table, schema);
      }
      for (const row of records(ns, table)) {
        if (row[cmd.from] === undefined) continue;
        const next = Object.assign({}, row);
        next[cmd.to] = next[cmd.from];
        delete next.id;
        delete next[cmd.from];
        upsert(c, name, ns, table, String(row.id), JSON.stringify(next));
      }
      return ok({ table, from: cmd.from, to: cmd.to }, { driver: name });
    }

    if (op === "rename_table") {
      if (!cmd.to) return fail("bad_request", "rename_table butuh 'to'");
      c.run("UPDATE nx_kv SET tbl = ? WHERE ns = ? AND tbl = ?", [String(cmd.to), ns, table]);
      const schema = schemaOf(ns, table);
      if (schema) {
        c.run("DELETE FROM nx_kv WHERE ns = ? AND tbl = ? AND k = ?", [ns, "__nx_schema", table]);
        saveSchema(ns, String(cmd.to), schema);
      }
      return ok({ from: table, to: String(cmd.to) }, { driver: name });
    }

    if (op === "join") {
      if (!table) return fail("no_table", "join butuh 'table'");
      const joins = Array.isArray(cmd.joins) ? cmd.joins : [];
      if (!joins.length) return fail("bad_request", "join butuh 'joins'");
      let rows = records(ns, table).map((r) => {
        const o = {};
        for (const k of Object.keys(r)) o[table + "." + k] = r[k];
        return o;
      });
      for (const j of joins) {
        const kind = String(j.type || "inner").toLowerCase();
        if (["inner", "left", "right", "full"].indexOf(kind) < 0) {
          return fail("bad_request", "type join harus inner, left, right, atau full");
        }
        const right = records(ns, j.table).map((r) => {
          const o = {};
          for (const k of Object.keys(r)) o[j.table + "." + k] = r[k];
          return o;
        });
        const on = j.on || {};
        const next = [];
        const used = new Set();
        for (const left of rows) {
          let hit = false;
          right.forEach((one, i) => {
            const match = Object.keys(on).every((lk) => left[lk] === one[on[lk]]);
            if (!match) return;
            hit = true;
            used.add(i);
            next.push(Object.assign({}, left, one));
          });
          if (!hit && (kind === "left" || kind === "full")) next.push(Object.assign({}, left));
        }
        if (kind === "right" || kind === "full") {
          right.forEach((one, i) => {
            if (!used.has(i)) next.push(Object.assign({}, one));
          });
        }
        rows = next;
      }
      const shaped = shapePage(rows, cmd);
      if (shaped.error) return shaped.error;
      let data = shaped.rows;
      if (cmd.nest && cmd.nest.children && cmd.nest.on) {
        const child = joins[0] && joins[0].table;
        const groups = new Map();
        for (const row of data.length ? rows.filter((r) => matchWhere(r, cmd.where)) : []) {
          const pk = row[cmd.nest.on];
          if (!groups.has(pk)) {
            const parent = {};
            for (const k of Object.keys(row)) {
              if (child && k.indexOf(child + ".") === 0) continue;
              parent[k.split(".").pop()] = row[k];
            }
            parent[cmd.nest.children] = [];
            groups.set(pk, parent);
          }
          if (!child) continue;
          const item = {};
          let any = false;
          for (const k of Object.keys(row)) {
            if (k.indexOf(child + ".") !== 0) continue;
            item[k.split(".").pop()] = row[k];
            if (row[k] != null) any = true;
          }
          if (any) groups.get(pk)[cmd.nest.children].push(item);
        }
        data = [...groups.values()];
      }
      return ok(data, Object.assign({ driver: name }, shaped.meta, { count: data.length }));
    }

    if (op === "set" || op === "insert") {
      if (op === "set" && !key) return fail("bad_request", "op 'set' butuh 'key'. Untuk key otomatis, pakai op 'insert'");
      const list = Array.isArray(cmd.data) ? cmd.data : [cmd.data ?? {}];
      const saved = [];
      for (let i = 0; i < list.length; i++) {
        const data = list[i] && typeof list[i] === "object" ? list[i] : {};
        const schema = schemaOf(ns, table);
        const msg = checkTypes(schema, data, i + 1);
        if (msg) return fail("type_mismatch", msg);
        const id = list.length === 1 && key ? key : (data.id != null ? String(data.id) : autoKey());
        const uniq = checkUnique(ns, table, schema, data, id);
        if (uniq) return fail("validation_failed", uniq);
        const stored = Object.assign({}, data);
        delete stored.id;
        upsert(c, name, ns, table, id, JSON.stringify(stored));
        saved.push(Object.assign({ id }, stored));
      }
      if (cmd["return"] === false) {
        return ok([], {
          key: saved.length ? saved[saved.length - 1].id : null,
          lastInsertId: saved.length ? saved[saved.length - 1].id : null,
          rowsAffected: saved.length,
          count: saved.length,
          driver: name,
        });
      }
      const one = !Array.isArray(cmd.data);
      return ok(one ? saved[0] : saved, {
        key: saved[0] ? saved[0].id : null,
        lastInsertId: saved.length ? saved[saved.length - 1].id : null,
        returned: saved.length,
        rowsAffected: saved.length,
        count: saved.length,
        driver: name,
      });
    }

    if (op === "get" || op === "has") {
      if (!key) return fail("bad_request", "op '" + op + "' butuh 'key'");
      const row = c.get("SELECT v FROM nx_kv WHERE ns = ? AND tbl = ? AND k = ?", [ns, table, key]);
      if (op === "has") return ok(!!row, { key, driver: name });
      if (!row) return fail("not_found", "Record " + table + "/" + key + " tidak ada");
      const value = parseValue(col(row, "v"));
      if (value === undefined) return fail("corrupt_data", "Isi record bukan JSON");
      return ok(value, { key, driver: name });
    }

    if (op === "update") {
      const want = cmd["return"] !== false;
      const targets = [];
      if (key && !cmd.where) {
        const row = c.get("SELECT v FROM nx_kv WHERE ns = ? AND tbl = ? AND k = ?", [ns, table, key]);
        if (!row) return fail("not_found", "Record " + table + "/" + key + " tidak ada");
        const existing = parseValue(col(row, "v"));
        targets.push({ key, value: existing });
      } else {
        if (!cmd.where && !cmd.all) {
          return fail("no_where", "update tanpa 'where' ditolak. Sertakan where, atau all:true bila memang semua");
        }
        for (const row of rowsOf(ns, table)) {
          const view = asRecord(row);
          if (!cmd.all && !matchWhere(view, cmd.where)) continue;
          targets.push(row);
        }
      }
      const saved = [];
      for (const row of targets) {
        const base = row.value && typeof row.value === "object" && !Array.isArray(row.value) ? row.value : {};
        const merged = Object.assign({}, base, cmd.data || {});
        const schema = schemaOf(ns, table);
        const msg = checkTypes(schema, merged, 1);
        if (msg) return fail("type_mismatch", msg);
        delete merged.id;
        c.run("UPDATE nx_kv SET v = ? WHERE ns = ? AND tbl = ? AND k = ?", [
          JSON.stringify(merged), ns, table, row.key,
        ]);
        saved.push(Object.assign({ id: row.key }, merged));
      }
      return ok(want ? saved : [], {
        returned: want ? saved.length : 0,
        rowsAffected: saved.length,
        count: saved.length,
        key: saved.length === 1 ? saved[0].id : undefined,
        driver: name,
      });
    }

    if (op === "remove" || op === "delete") {
      const victims = [];
      if (key && !cmd.where) {
        const info = c.run("DELETE FROM nx_kv WHERE ns = ? AND tbl = ? AND k = ?", [ns, table, key]);
        if (!info.changes) return fail("not_found", "Record " + table + "/" + key + " tidak ada");
        return ok(null, { key, count: 1, deleted: 1, driver: name });
      }
      if (!cmd.where && !cmd.all) {
        return fail("no_where", "delete tanpa 'where' ditolak. Sertakan where, atau all:true bila memang semua");
      }
      for (const row of rowsOf(ns, table)) {
        if (!cmd.all && !matchWhere(asRecord(row), cmd.where)) continue;
        victims.push(row.key);
      }
      for (const id of victims) {
        c.run("DELETE FROM nx_kv WHERE ns = ? AND tbl = ? AND k = ?", [ns, table, id]);
      }
      return ok(null, { deleted: victims.length, count: victims.length, driver: name });
    }

    if (op === "select" || op === "search") {
      let rows = records(ns, table);
      if (op === "search") {
        const q = String(cmd.q || "").trim().toLowerCase();
        if (!q) return fail("bad_request", "op 'search' butuh 'q'");
        rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
        return ok(rows, { count: rows.length, driver: name });
      }
      const shaped = shapePage(rows, cmd);
      if (shaped.error) return shaped.error;
      return ok(shaped.rows, Object.assign({ driver: name }, shaped.meta));
    }

    if (op === "keys") {
      const list = c.all("SELECT k FROM nx_kv WHERE ns = ? AND tbl = ? ORDER BY k", [ns, table]);
      const keys = list.map((r) => col(r, "k"));
      return ok(keys, { count: keys.length, driver: name });
    }

    if (op === "count") {
      const row = c.get("SELECT COUNT(*) AS n FROM nx_kv WHERE ns = ? AND tbl = ?", [ns, table]);
      const n = row ? Number(col(row, "n")) || 0 : 0;
      return ok(n, { count: n, driver: name });
    }

    if (op === "clear") {
      const info = !table && cmd.all
        ? c.run("DELETE FROM nx_kv WHERE ns = ?", [ns])
        : c.run("DELETE FROM nx_kv WHERE ns = ? AND tbl = ?", [ns, table]);
      return ok({ removed: info.changes }, { count: info.changes, driver: name });
    }

    return fail("unknown_op", 'op "' + op + '" tidak dikenal server ' + name);
  }

  function deadLink(msg) {
    return /koneksi sudah ditutup|waktu habis|sambungan putus|gagal tersambung|gagal menulis|tidak menjawab|terputus|refused|timeout|ECONN/i.test(msg);
  }

  function asFail(e) {
    if (e && e.code === "config_error") return fail("config_error", e.hint || e.message);
    const msg = e && e.message ? e.message : String(e);
    if (/require\('db'\)|cannot find module/i.test(msg)) {
      return fail("driver_unavailable", "Modul db belum ada di nx8v yang sedang berjalan. Jalankan ulang nx8v.");
    }
    if (deadLink(msg)) return fail("network_error", msg);
    return fail("sql_error", msg);
  }

  function handle(cmd) {
    try {
      return jawab(cmd || {});
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (!deadLink(msg)) return asFail(e);
      drop();
      try {
        return jawab(cmd || {});
      } catch (again) {
        drop();
        return asFail(again);
      }
    }
  }

  return handle;
}

module.exports = { createHandle };
