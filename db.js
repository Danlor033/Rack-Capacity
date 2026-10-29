// Racks, box presets and imported SKU sheets, from Supabase when it is
// configured and from this browser when it is not. Both halves answer the
// same calls, so nothing above here has to know which one is in use.
const DB = (function () {
  "use strict";

  const RACK_TABLE = "rack_racks";
  const PRESET_TABLE = "rack_box_presets";

  const SEED_RACKS = [
    { id: "seed-standard", name: "Standard Rack", length_cm: 240, width_cm: 120, height_cm: 85, is_default: true },
  ];

  function configured() {
    return typeof SUPABASE_URL === "string" && SUPABASE_URL.indexOf("https://") === 0 && !!SUPABASE_KEY;
  }

  async function rest(table, options) {
    const opts = options || {};
    const url = SUPABASE_URL + "/rest/v1/" + table + (opts.query || "");
    const prefer = opts.prefer || (opts.method === "POST" || opts.method === "PATCH" ? "return=representation" : null);
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers: Object.assign({}, SB_HEADERS, prefer ? { Prefer: prefer } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(table + " " + res.status + ": " + text.slice(0, 200));
    }
    // A write asked for "return=minimal" answers 201 with no body at all.
    const body = await res.text();
    return body ? JSON.parse(body) : null;
  }

  // --- the browser-only half -------------------------------------------------

  function localRead(key, seed) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* private window, blocked storage -- fall through to the seed */ }
    return seed ? seed.slice() : [];
  }

  function localWrite(key, rows) {
    try { localStorage.setItem(key, JSON.stringify(rows)); } catch (e) { /* nothing to do */ }
  }

  function localId() {
    return "local-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  // --- the two lists ---------------------------------------------------------

  function makeStore(table, storageKey, seed, sort) {
    return {
      async list() {
        if (!configured()) {
          const rows = localRead(storageKey, seed);
          return rows.slice().sort(sort);
        }
        const rows = await rest(table, { query: "?select=*" });
        return rows.slice().sort(sort);
      },
      async create(row) {
        if (!configured()) {
          const rows = localRead(storageKey, seed);
          const saved = Object.assign({ id: localId(), created_at: new Date().toISOString() }, row);
          rows.push(saved);
          localWrite(storageKey, rows);
          return saved;
        }
        const out = await rest(table, { method: "POST", body: [row] });
        return out[0];
      },
      async remove(id) {
        if (!configured()) {
          const rows = localRead(storageKey, seed).filter((r) => r.id !== id);
          localWrite(storageKey, rows);
          return;
        }
        await rest(table, { method: "DELETE", query: "?id=eq." + encodeURIComponent(id) });
      },
    };
  }

  const byName = (a, b) => String(a.name).localeCompare(String(b.name));

  // --- imported SKU sheets ---------------------------------------------------

  const IMPORT_TABLE = "rack_imports";
  const SKU_TABLE = "rack_skus";
  const LOCAL_IMPORT = "rackPlanner.import";
  const PAGE = 1000; // the most rows Supabase hands back in one go

  // The fields that can be edited after import, and the column each lives in.
  // needed_qty_15d and total_boxes are no longer read or written: both are
  // worked out from sold per day, the days rule and qty per box.
  const COLUMNS = {
    soldPerDay: "sold_per_day", quantity: "quantity",
    length: "length_cm", width: "width_cm", height: "height_cm",
    qtyPerBox: "qty_per_box",
  };

  function toRow(s, importId, line) {
    const row = {
      import_id: importId, line_no: line,
      tier: s.tier || null, category: s.category || null, sku: s.sku,
    };
    for (const k in COLUMNS) row[COLUMNS[k]] = s[k] === undefined ? null : s[k];
    return row;
  }

  // numeric columns come back from PostgREST as numbers, or as null
  function fromRow(r) {
    const s = { id: r.id, line: r.line_no, tier: r.tier || "", category: r.category || "", sku: r.sku };
    for (const k in COLUMNS) s[k] = r[COLUMNS[k]];
    return s;
  }

  const imports = {
    // The newest sheet and its rows, or null when nothing has been imported.
    async latest() {
      if (!configured()) {
        try {
          const raw = localStorage.getItem(LOCAL_IMPORT);
          return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
      }
      const found = await rest(IMPORT_TABLE, { query: "?select=*&order=imported_at.desc&limit=1" });
      if (!found.length) return null;
      const head = found[0];
      const skus = [];
      for (let from = 0; ; from += PAGE) {
        const page = await rest(SKU_TABLE, {
          query: "?select=*&import_id=eq." + head.id + "&order=line_no&limit=" + PAGE + "&offset=" + from,
        });
        for (const r of page) skus.push(fromRow(r));
        if (page.length < PAGE) break;
      }
      return { import: head, skus: skus };
    },

    // Store a sheet as the new current one. If any batch of rows fails, the
    // half-written import is taken out again so it never becomes "newest".
    async save(fileName, skus, rules) {
      if (!configured()) {
        const head = {
          id: localId(), file_name: fileName, row_count: skus.length,
          rules: rules || {}, imported_at: new Date().toISOString(),
        };
        const data = { import: head, skus: skus.map((s, i) => Object.assign({}, s, { id: i + 1 })) };
        localStorage.setItem(LOCAL_IMPORT, JSON.stringify(data));
        return data;
      }
      const head = (await rest(IMPORT_TABLE, {
        method: "POST",
        body: [{ file_name: fileName, row_count: skus.length, rules: rules || {} }],
      }))[0];
      try {
        for (let i = 0; i < skus.length; i += 500) {
          const batch = skus.slice(i, i + 500).map((s, j) => toRow(s, head.id, i + j + 1));
          await rest(SKU_TABLE, { method: "POST", body: batch, prefer: "return=minimal" });
        }
      } catch (e) {
        await rest(IMPORT_TABLE, { method: "DELETE", query: "?id=eq." + head.id }).catch(function () {});
        throw e;
      }
      // Read it back: the rows need the ids the database gave them before
      // anybody can edit one.
      return imports.latest();
    },

    // Change some of one SKU's numbers. `fields` uses the app's names
    // (soldPerDay, qtyPerBox ...); anything not editable is refused.
    async updateSku(id, fields) {
      const patch = {};
      for (const k in fields) {
        if (!COLUMNS[k]) throw new Error(k + " cannot be edited");
        patch[COLUMNS[k]] = fields[k];
      }
      if (!configured()) {
        const data = JSON.parse(localStorage.getItem(LOCAL_IMPORT));
        const row = data.skus.find((s) => s.id === id);
        if (row) Object.assign(row, fields);
        localStorage.setItem(LOCAL_IMPORT, JSON.stringify(data));
        return;
      }
      await rest(SKU_TABLE, {
        method: "PATCH", query: "?id=eq." + encodeURIComponent(id),
        body: patch, prefer: "return=minimal",
      });
    },

    // An empty list to add SKUs to by hand, for when nothing was ever
    // imported.
    async create(rules) {
      if (!configured()) {
        const data = {
          import: { id: localId(), file_name: "Entered by hand", row_count: 0, rules: rules || {}, imported_at: new Date().toISOString() },
          skus: [],
        };
        localStorage.setItem(LOCAL_IMPORT, JSON.stringify(data));
        return data.import;
      }
      return (await rest(IMPORT_TABLE, {
        method: "POST",
        body: [{ file_name: "Entered by hand", row_count: 0, rules: rules || {} }],
      }))[0];
    },

    // One new SKU at the end of the list. Returns it with the id it was
    // given, which it needs before it can be edited or removed.
    async addSku(importId, sku, line) {
      if (!configured()) {
        const data = JSON.parse(localStorage.getItem(LOCAL_IMPORT));
        const id = data.skus.reduce((n, s) => Math.max(n, Number(s.id) || 0), 0) + 1;
        const added = Object.assign({}, sku, { id: id, line: line });
        data.skus.push(added);
        localStorage.setItem(LOCAL_IMPORT, JSON.stringify(data));
        return added;
      }
      return fromRow((await rest(SKU_TABLE, { method: "POST", body: [toRow(sku, importId, line)] }))[0]);
    },

    async removeSku(id) {
      if (!configured()) {
        const data = JSON.parse(localStorage.getItem(LOCAL_IMPORT));
        data.skus = data.skus.filter((s) => s.id !== id);
        localStorage.setItem(LOCAL_IMPORT, JSON.stringify(data));
        return;
      }
      await rest(SKU_TABLE, { method: "DELETE", query: "?id=eq." + encodeURIComponent(id), prefer: "return=minimal" });
    },

    async setRules(id, rules) {
      if (!configured()) {
        const raw = localStorage.getItem(LOCAL_IMPORT);
        if (!raw) return;
        const data = JSON.parse(raw);
        data.import.rules = rules;
        localStorage.setItem(LOCAL_IMPORT, JSON.stringify(data));
        return;
      }
      await rest(IMPORT_TABLE, {
        method: "PATCH", query: "?id=eq." + encodeURIComponent(id),
        body: { rules: rules }, prefer: "return=minimal",
      });
    },
  };

  return {
    configured: configured,
    imports: imports,
    racks: makeStore(RACK_TABLE, "rackPlanner.racks", SEED_RACKS, function (a, b) {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      return byName(a, b);
    }),
    presets: makeStore(PRESET_TABLE, "rackPlanner.presets", [], byName),
  };
})();
