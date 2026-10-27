// Racks and box presets, from Supabase when it is configured and from this
// browser when it is not. Both halves answer the same four calls, so nothing
// above here has to know which one is in use.
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
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers: Object.assign({}, SB_HEADERS, opts.method === "POST" ? { Prefer: "return=representation" } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(table + " " + res.status + ": " + text.slice(0, 200));
    }
    return res.status === 204 ? null : res.json();
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

  return {
    configured: configured,
    racks: makeStore(RACK_TABLE, "rackPlanner.racks", SEED_RACKS, function (a, b) {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      return byName(a, b);
    }),
    presets: makeStore(PRESET_TABLE, "rackPlanner.presets", [], byName),
  };
})();
