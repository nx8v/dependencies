/**
 * Perintah JSON yang sama untuk sqlite, mysql, postgreSQL, indexeDB, dan localstorage.
 * Penyimpanan diserahkan ke objek store (sync).
 */
(function (root) {
  function fail(error, hint) {
    return { ok: false, error, hint, meta: { error, message: hint } };
  }

  function ok(data, meta) {
    return { ok: true, data, meta: meta || {} };
  }

  function autoKey() {
    return "k-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function matchCond(actual, cond) {
    if (cond === null || typeof cond !== "object" || Array.isArray(cond)) return actual === cond;
    for (const op of Object.keys(cond)) {
      const expected = cond[op];
      const name = String(op).toLowerCase();
      if ((name === "=" || name === "eq") && actual !== expected) return false;
      else if ((name === "!=" || name === "ne") && actual === expected) return false;
      else if (name === ">" && !(actual > expected)) return false;
      else if (name === ">=" && !(actual >= expected)) return false;
      else if (name === "<" && !(actual < expected)) return false;
      else if (name === "<=" && !(actual <= expected)) return false;
      else if (name === "like" || name === "not_like" || name === "notlike") {
        if (actual == null) return false;
        const pattern = String(expected).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
        const hit = new RegExp("^" + pattern + "$", "i").test(String(actual));
        if (name === "like" ? !hit : hit) return false;
      } else if (name === "in" || name === "notin" || name === "not_in") {
        if (!Array.isArray(expected)) return false;
        const hit = expected.includes(actual);
        if (name === "in" ? !hit : hit) return false;
      } else if (name === "between") {
        if (!Array.isArray(expected) || expected.length !== 2) return false;
        if (!(actual >= expected[0] && actual <= expected[1])) return false;
      } else if ((name === "null" || name === "isnull" || name === "is_null") && actual != null) return false;
      else if ((name === "isnotnull" || name === "is_not_null") && actual == null) return false;
      else if (name === "not") {
        if (expected === null) {
          if (actual == null) return false;
        } else if (matchCond(actual, expected)) return false;
      } else if (name !== "=" && name !== "eq" && name !== "!=" && name !== "ne" && name !== ">" && name !== ">=" && name !== "<" && name !== "<=" && name !== "like" && name !== "not_like" && name !== "notlike" && name !== "in" && name !== "notin" && name !== "not_in" && name !== "between" && name !== "null" && name !== "isnull" && name !== "is_null" && name !== "isnotnull" && name !== "is_not_null" && name !== "not") {
        return false;
      }
    }
    return true;
  }

  function matchWhere(value, where) {
    if (where == null || typeof where !== "object" || Array.isArray(where)) return true;
    if (Array.isArray(where.and) && !where.and.every((w) => matchWhere(value, w))) return false;
    if (Array.isArray(where.or) && !where.or.some((w) => matchWhere(value, w))) return false;
    if (where.not && typeof where.not === "object" && !Array.isArray(where.not) && Object.keys(where).length === 1) {
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
    let list = spec.filter ? rows.filter((r) => matchWhere(r, spec.filter)) : rows;
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
    if (fn === "count") return field === "*" ? list.length : vals.filter((v) => v != null).length;
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
            else if (col && typeof col === "object") out[col.as || "agg"] = aggOf(bucket, col);
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
        const mark = cmd.after[col] !== undefined ? cmd.after[col] : cmd.after[String(col).split(".").pop()];
        list = list.filter((r) => (desc ? fieldOf(r, col) < mark : fieldOf(r, col) > mark));
      }
      if (cmd.distinct) {
        const seen = new Set();
        list = list.filter((r) => {
          const k = JSON.stringify(projectRow(r, select));
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
        const key = String(col).split(".").pop();
        meta.next = {};
        meta.next[key] = last[key] !== undefined ? last[key] : last[col];
      }
    }
    return { rows: page, meta };
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

  function checkUnique(store, table, schema, data, ignoreId) {
    if (!schema || !Array.isArray(schema.indexes)) return null;
    const rows = store.list(table);
    for (const idx of schema.indexes) {
      if (!idx.unique || !Array.isArray(idx.columns)) continue;
      const clash = rows.some((r) => String(r.id) !== String(ignoreId) && idx.columns.every((c) => r[c] === data[c]));
      if (clash) return "nilai " + idx.columns.join(", ") + " sudah dipakai";
    }
    return null;
  }

  function apply(store, cmd, driverName) {
    const name = driverName || "storage";
    function run(input) {
      const op = String((input && input.op) || "").toLowerCase();
      const table = input && input.table != null && input.table !== "" ? String(input.table) : "";
      const key = input && (input.key != null || input.id != null) ? String(input.key != null ? input.key : input.id) : "";

      if (op === "tables" || op === "show_tables") {
        const names = store.tables().filter((t) => String(t).indexOf("__nx") !== 0);
        if (op === "tables") return ok(names, { count: names.length, driver: name });
        const data = names.map((t) => {
          const schema = store.schema(t);
          const cols = new Set(["id"]);
          const types = { id: "text" };
          if (schema && schema.columns) {
            for (const k of Object.keys(schema.columns)) {
              cols.add(k);
              types[k] = schema.columns[k];
            }
          }
          for (const row of store.list(t)) {
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
        const steps = Array.isArray(input.ops) ? input.ops : null;
        if (!steps || !steps.length) return fail("bad_request", "tx butuh 'ops' berisi insert, update, atau delete");
        for (const step of steps) {
          const sop = String((step && step.op) || "").toLowerCase();
          if (sop !== "insert" && sop !== "update" && sop !== "delete" && sop !== "remove") {
            return fail("validation_failed", "tx hanya boleh insert, update, dan delete");
          }
        }
        store.begin();
        try {
          const applied = [];
          for (const step of steps) {
            const hasil = run(step);
            if (!hasil.ok) {
              store.rollback();
              return hasil;
            }
            applied.push(hasil);
          }
          store.commit();
          return ok(applied, { applied: applied.length, driver: name });
        } catch (e) {
          store.rollback();
          throw e;
        }
      }

      if (op === "migrate" || op === "migration_status" || op === "create_migration") {
        const bag = store.schema("__nx_migrations") || { items: [] };
        if (!Array.isArray(bag.items)) bag.items = [];
        if (op === "create_migration") {
          if (input.version == null) return fail("bad_request", "create_migration butuh 'version'");
          bag.items = bag.items.filter((m) => m.version !== input.version);
          bag.items.push({ version: input.version, name: input.name || "", ops: input.ops || [], applied: false });
          bag.items.sort((a, b) => a.version - b.version);
          store.saveSchema("__nx_migrations", bag);
          return ok({ version: input.version, name: input.name || "" }, { driver: name });
        }
        if (op === "migration_status") {
          return ok(bag.items.map((m) => ({
            version: m.version, name: m.name || "", applied: !!m.applied, appliedAt: m.appliedAt || null,
          })), { count: bag.items.length, driver: name });
        }
        store.begin();
        try {
          const done = [];
          for (const m of bag.items) {
            if (m.applied) continue;
            for (const step of m.ops || []) {
              const hasil = run(step);
              if (!hasil.ok) {
                store.rollback();
                return hasil;
              }
            }
            m.applied = true;
            m.appliedAt = new Date().toISOString();
            done.push({ version: m.version, name: m.name || "", applied: true });
          }
          store.saveSchema("__nx_migrations", bag);
          store.commit();
          return ok(done, { rowsAffected: done.length, driver: name });
        } catch (e) {
          store.rollback();
          throw e;
        }
      }

      if (!table && op !== "join") return fail("no_table", "Field 'table' wajib diisi");

      if (op === "create_table") {
        const columns = {};
        const src = input.columns && typeof input.columns === "object" ? input.columns : {};
        for (const k of Object.keys(src)) columns[k] = canonType(src[k]);
        const prev = store.schema(table) || {};
        store.saveSchema(table, Object.assign({}, prev, { columns }));
        return ok({ table, columns: ["id"].concat(Object.keys(columns)) }, { driver: name });
      }

      if (op === "drop_table") {
        const removed = store.delTable(table);
        store.del("__nx_schema", table);
        return ok({ table, removed }, { count: removed, driver: name });
      }

      if (op === "create_index") {
        const columns = Array.isArray(input.columns) ? input.columns.map(String) : [];
        if (!columns.length) return fail("bad_request", "create_index butuh 'columns'");
        const schema = store.schema(table) || { columns: {}, indexes: [] };
        if (!Array.isArray(schema.indexes)) schema.indexes = [];
        const indexName = input.name || "idx_" + table + "_" + columns.join("_");
        schema.indexes = schema.indexes.filter((i) => i.name !== indexName);
        schema.indexes.push({ name: indexName, columns, unique: input.unique === true });
        store.saveSchema(table, schema);
        return ok({ name: indexName, columns, unique: input.unique === true }, { driver: name });
      }

      if (op === "add_column") {
        if (!input.column) return fail("bad_request", "add_column butuh 'column'");
        const schema = store.schema(table) || { columns: {}, indexes: [] };
        if (!schema.columns) schema.columns = {};
        if (!schema.columns[input.column]) schema.columns[input.column] = canonType(input.type || "text");
        store.saveSchema(table, schema);
        if (input.default !== undefined) {
          for (const row of store.list(table)) {
            if (row[input.column] !== undefined) continue;
            const next = Object.assign({}, row, { [input.column]: input.default });
            delete next.id;
            store.put(table, String(row.id), next);
          }
        }
        return ok({ table, column: input.column, type: schema.columns[input.column] }, { driver: name });
      }

      if (op === "drop_column") {
        if (!input.column) return fail("bad_request", "drop_column butuh 'column'");
        const schema = store.schema(table);
        if (schema && schema.columns) {
          delete schema.columns[input.column];
          store.saveSchema(table, schema);
        }
        for (const row of store.list(table)) {
          if (row[input.column] === undefined) continue;
          const next = Object.assign({}, row);
          delete next.id;
          delete next[input.column];
          store.put(table, String(row.id), next);
        }
        return ok({ table, column: input.column }, { driver: name });
      }

      if (op === "rename_column") {
        if (!input.from || !input.to) return fail("bad_request", "rename_column butuh 'from' dan 'to'");
        const schema = store.schema(table);
        if (schema && schema.columns && schema.columns[input.from]) {
          schema.columns[input.to] = schema.columns[input.from];
          delete schema.columns[input.from];
          store.saveSchema(table, schema);
        }
        for (const row of store.list(table)) {
          if (row[input.from] === undefined) continue;
          const next = Object.assign({}, row);
          next[input.to] = next[input.from];
          delete next.id;
          delete next[input.from];
          store.put(table, String(row.id), next);
        }
        return ok({ table, from: input.from, to: input.to }, { driver: name });
      }

      if (op === "rename_table") {
        if (!input.to) return fail("bad_request", "rename_table butuh 'to'");
        const schema = store.schema(table);
        store.renameTable(table, String(input.to));
        if (schema) {
          store.del("__nx_schema", table);
          store.saveSchema(String(input.to), schema);
        }
        return ok({ from: table, to: String(input.to) }, { driver: name });
      }

      if (op === "join") {
        if (!table) return fail("no_table", "join butuh 'table'");
        const joins = Array.isArray(input.joins) ? input.joins : [];
        if (!joins.length) return fail("bad_request", "join butuh 'joins'");
        let rows = store.list(table).map((r) => {
          const o = {};
          for (const k of Object.keys(r)) o[table + "." + k] = r[k];
          return o;
        });
        for (const j of joins) {
          const kind = String(j.type || "inner").toLowerCase();
          if (["inner", "left", "right", "full"].indexOf(kind) < 0) {
            return fail("bad_request", "type join harus inner, left, right, atau full");
          }
          const right = store.list(j.table).map((r) => {
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
            right.forEach((one, i) => { if (!used.has(i)) next.push(Object.assign({}, one)); });
          }
          rows = next;
        }
        const shaped = shapePage(rows, input);
        if (shaped.error) return shaped.error;
        let data = shaped.rows;
        if (input.nest && input.nest.children && input.nest.on) {
          const child = joins[0] && joins[0].table;
          const groups = new Map();
          for (const row of rows.filter((r) => matchWhere(r, input.where))) {
            const pk = row[input.nest.on];
            if (!groups.has(pk)) {
              const parent = {};
              for (const k of Object.keys(row)) {
                if (child && k.indexOf(child + ".") === 0) continue;
                parent[k.split(".").pop()] = row[k];
              }
              parent[input.nest.children] = [];
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
            if (any) groups.get(pk)[input.nest.children].push(item);
          }
          data = [...groups.values()];
        }
        return ok(data, Object.assign({ driver: name }, shaped.meta, { count: data.length }));
      }

      if (op === "insert" || op === "set") {
        if (op === "set" && !key) return fail("bad_request", "op 'set' butuh 'key'. Untuk key otomatis, pakai op 'insert'");
        const list = Array.isArray(input.data) ? input.data : [input.data ?? {}];
        const saved = [];
        for (let i = 0; i < list.length; i++) {
          const data = list[i] && typeof list[i] === "object" ? list[i] : {};
          const schema = store.schema(table);
          const msg = checkTypes(schema, data, i + 1);
          if (msg) return fail("type_mismatch", msg);
          const id = list.length === 1 && key ? key : (data.id != null ? String(data.id) : autoKey());
          const uniq = checkUnique(store, table, schema, data, id);
          if (uniq) return fail("validation_failed", uniq);
          const stored = Object.assign({}, data);
          delete stored.id;
          store.put(table, id, stored);
          saved.push(Object.assign({ id }, stored));
        }
        if (input["return"] === false) {
          return ok([], {
            key: saved.length ? saved[saved.length - 1].id : null,
            lastInsertId: saved.length ? saved[saved.length - 1].id : null,
            rowsAffected: saved.length,
            count: saved.length,
            driver: name,
          });
        }
        const one = !Array.isArray(input.data);
        return ok(one ? saved[0] : saved, {
          key: saved[0] ? saved[0].id : null,
          lastInsertId: saved.length ? saved[saved.length - 1].id : null,
          returned: saved.length,
          rowsAffected: saved.length,
          count: saved.length,
          driver: name,
        });
      }

      if (op === "update") {
        const want = input["return"] !== false;
        let targets = [];
        if (key && !input.where) {
          const row = store.list(table).find((r) => String(r.id) === key);
          if (!row) return fail("not_found", "Record " + table + "/" + key + " tidak ada");
          targets = [row];
        } else {
          if (!input.where && !input.all) {
            return fail("no_where", "update tanpa 'where' ditolak. Sertakan where, atau all:true bila memang semua");
          }
          targets = store.list(table).filter((r) => input.all || matchWhere(r, input.where));
        }
        const saved = [];
        for (const row of targets) {
          const merged = Object.assign({}, row, input.data || {});
          const msg = checkTypes(store.schema(table), merged, 1);
          if (msg) return fail("type_mismatch", msg);
          delete merged.id;
          store.put(table, String(row.id), merged);
          saved.push(Object.assign({ id: row.id }, merged));
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
        if (key && !input.where) {
          if (!store.del(table, key)) return fail("not_found", "Record " + table + "/" + key + " tidak ada");
          return ok(null, { key, count: 1, deleted: 1, driver: name });
        }
        if (!input.where && !input.all) {
          return fail("no_where", "delete tanpa 'where' ditolak. Sertakan where, atau all:true bila memang semua");
        }
        const victims = store.list(table).filter((r) => input.all || matchWhere(r, input.where));
        for (const row of victims) store.del(table, String(row.id));
        return ok(null, { deleted: victims.length, count: victims.length, driver: name });
      }

      if (op === "select") {
        const shaped = shapePage(store.list(table), input);
        if (shaped.error) return shaped.error;
        return ok(shaped.rows, Object.assign({ driver: name }, shaped.meta));
      }

      return fail("unknown_op", 'op "' + op + '" tidak dikenal');
    }
    return run(cmd || {});
  }

  function memory(seed) {
    const data = new Map();
    function clone(v) {
      if (v == null || typeof v !== "object") return v;
      if (Array.isArray(v)) return v.map(clone);
      const o = {};
      for (const k of Object.keys(v)) o[k] = clone(v[k]);
      return o;
    }
    function putMap(table, id, obj) {
      if (!data.has(table)) data.set(table, new Map());
      const copy = obj && typeof obj === "object" ? clone(obj) : {};
      delete copy.id;
      data.get(table).set(String(id), copy);
    }
    if (seed) {
      for (const table of Object.keys(seed)) {
        for (const row of seed[table] || []) {
          const id = row.id != null ? row.id : row.key;
          const value = row.value !== undefined ? row.value : row;
          putMap(table, id, value);
        }
      }
    }
    let snap = null;
    return {
      list(table) {
        const m = data.get(table);
        if (!m) return [];
        return [...m.entries()].map(([id, obj]) => Object.assign({ id }, clone(obj)));
      },
      tables() { return [...data.keys()]; },
      put(table, id, obj) { putMap(table, id, obj); },
      del(table, id) {
        const m = data.get(table);
        if (!m || !m.has(String(id))) return false;
        m.delete(String(id));
        return true;
      },
      delTable(table) {
        const n = data.has(table) ? data.get(table).size : 0;
        data.set(table, new Map());
        return n;
      },
      renameTable(from, to) {
        data.set(String(to), data.get(from) || new Map());
        data.set(from, new Map());
      },
      schema(table) {
        const m = data.get("__nx_schema");
        if (!m || !m.has(table)) return null;
        return m.get(table);
      },
      saveSchema(table, schema) { putMap("__nx_schema", table, schema); },
      begin() {
        snap = new Map();
        for (const [t, m] of data) {
          const c = new Map();
          for (const [id, obj] of m) c.set(id, clone(obj));
          snap.set(t, c);
        }
      },
      commit() { snap = null; },
      rollback() {
        if (!snap) return;
        data.clear();
        for (const [t, m] of snap) data.set(t, m);
        snap = null;
      },
      dump() {
        const out = {};
        for (const [t, m] of data) out[t] = [...m.entries()].map(([id, obj]) => Object.assign({ id }, obj));
        return out;
      },
    };
  }

  root.NxSintaks = { apply: apply, memory: memory };
})(typeof globalThis !== "undefined" ? globalThis : this);
