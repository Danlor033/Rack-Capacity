// 4KB Qty from JSTERP, every 30 seconds.
//
// This file does not run in Rack Planner. It is loaded into a JSTERP tab by
// the "Rack Planner 4KB sync" bookmark (see the set-up window on the Racks
// page), because JSTERP only answers someone signed in to it. Once loaded it
// reads Warehouse > Zone Inventory -- owner Shigetsu, Main Warehouse, start
// position 4KB -- adds the quantities up per SKU, and writes any 4KB Qty that
// changed into Rack Planner. Every open Rack Planner page then shows the new
// numbers at once. It keeps going while the tab stays open and signed in.
(function () {
  "use strict";

  const SUPABASE_URL = "https://zvzeojcdjafzqunzladl.supabase.co";
  const SUPABASE_KEY = "sb_publishable_ycQbkzbjsiDtitEhZIjvMQ_fGdch1Qp";
  const EVERY = 30 * 1000;
  const SYNC_NAME = "jsterp-4kb";
  const HOST = "asia.jsterp.com";
  const PAGE_URL = "https://asia.jsterp.com/Wms/Pack/PackItem";

  // The Zone Inventory filters, as JSTERP sends them: owner Shigetsu
  // (LinkCoIds / LinkWarehouseIds), warehouse area Main, start position 4KB,
  // stock above zero only.
  const FILTER = {
    SkuIds: [], ItemIds: [], LinkWarehouseIds: ["3948"], LinkCoIds: [12697134],
    WarehouseId: 3938, BinTypes: [], AreaTypes: ["Main"], ShowZeroType: "AllNoZero",
    Keywords: [], PackItemIds: [], BinStart: "4KB",
  };

  // JSTERP's own pages live on asia.jsterp.com; the menu shell around them
  // (asia-web) cannot ask for the stock. Go to Zone Inventory first.
  if (location.hostname !== HOST) {
    if (confirm("Rack Planner 4KB sync runs on JSTERP's Zone Inventory page.\n\n" +
                "Open it now? Then click the bookmark once more there.")) {
      location.href = PAGE_URL;
    }
    return;
  }
  if (window.__rackSync) { window.__rackSync.show(); return; }

  // --- the badge in the corner ------------------------------------------------

  const badge = document.createElement("div");
  badge.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:300px;" +
    "font:13px/1.45 system-ui,sans-serif;background:#fff;color:#1d2433;border:1px solid #d5dbe5;" +
    "border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:12px 14px";
  badge.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;font-weight:600">' +
    '<span data-dot style="width:9px;height:9px;border-radius:50%;background:#e0a100;flex:none"></span>' +
    '<span style="flex:1">Rack Planner 4KB sync</span>' +
    '<button data-stop type="button" style="border:1px solid #d5dbe5;background:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font:inherit;font-weight:400">Stop</button>' +
    "</div>" +
    '<div data-text style="margin-top:6px;color:#5a6478">Starting…</div>' +
    '<div style="margin-top:6px;color:#8a93a5;font-size:12px">Keep this tab open. Every 30 seconds.</div>';
  document.body.appendChild(badge);
  const dot = badge.querySelector("[data-dot]");
  const line = badge.querySelector("[data-text]");

  function say(text, kind) {
    line.textContent = text;
    dot.style.background = kind === "bad" ? "#d64545" : kind === "ok" ? "#2e9d5b" : "#e0a100";
  }

  // --- JSTERP -------------------------------------------------------------------

  // Every row of the filtered list, all pages.
  async function readStock() {
    const rows = [];
    for (let page = 1; page < 50; page++) {
      const res = await fetch("/wms/Pack/GetPackItemsPages", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ RequestModel: FILTER, DataPage: { pageSize: 1000, pageIndex: page } }),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (e) { /* the sign-in page, not data */ }
      if (!res.ok || !json || !Array.isArray(json.Data)) {
        throw new Error("JSTERP did not send the stock list -- signed out? Sign in again and click the bookmark.");
      }
      rows.push.apply(rows, json.Data);
      if (!json.DataPage || json.DataPage.IsLast || !json.Data.length) break;
    }
    // Start position 4KB already narrows it; this keeps anything else out
    // should JSTERP ever read it as "from 4KB onwards".
    const qty = new Map();
    for (const r of rows) {
      if (!/^4KB/i.test(String(r.Bin || ""))) continue;
      const sku = String(r.SkuId || "").trim().toLowerCase();
      if (!sku) continue;
      qty.set(sku, (qty.get(sku) || 0) + (Number(r.Qty) || 0));
    }
    return { qty: qty, rows: rows.length };
  }

  // --- Rack Planner (Supabase) -----------------------------------------------------

  async function sb(path, options) {
    const opts = options || {};
    const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
      method: opts.method || "GET",
      headers: Object.assign({ apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        opts.prefer ? { Prefer: opts.prefer } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) throw new Error("Rack Planner " + res.status + ": " + (await res.text()).slice(0, 160));
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function plannerSkus() {
    const head = await sb("rack_imports?select=id&order=imported_at.desc&limit=1");
    if (!head || !head.length) return [];
    const out = [];
    for (let from = 0; ; from += 1000) {
      const part = await sb("rack_skus?select=id,sku,quantity&import_id=eq." + head[0].id +
        "&order=line_no&limit=1000&offset=" + from);
      out.push.apply(out, part);
      if (part.length < 1000) break;
    }
    return out;
  }

  function report(ok, message, info) {
    return sb("rack_sync?on_conflict=name", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { name: SYNC_NAME, synced_at: new Date().toISOString(), ok: ok, message: message, info: info || {} },
    });
  }

  // --- one round --------------------------------------------------------------------

  let busy = false, stopped = false, total = 0;

  async function round() {
    if (busy || stopped) return;
    busy = true;
    try {
      const stock = await readStock();
      const skus = await plannerSkus();
      const known = new Set();
      const changed = [];
      for (const s of skus) {
        const key = String(s.sku || "").trim().toLowerCase();
        known.add(key);
        // Not in 4KB at all: none there.
        const q = stock.qty.get(key) || 0;
        if (Number(s.quantity) !== q) changed.push({ id: s.id, quantity: q });
      }
      // A few at a time.
      for (let i = 0; i < changed.length; i += 8) {
        await Promise.all(changed.slice(i, i + 8).map((c) =>
          sb("rack_skus?id=eq." + c.id, { method: "PATCH", prefer: "return=minimal", body: { quantity: c.quantity } })));
      }
      total += changed.length;
      const notInPlanner = [...stock.qty.keys()].filter((k) => !known.has(k));
      const units = [...stock.qty.values()].reduce((a, b) => a + b, 0);
      await report(true, null, {
        skus: stock.qty.size, rows: stock.rows, units: units, changed: changed.length,
        notInPlanner: notInPlanner.slice(0, 50), notInPlannerCount: notInPlanner.length,
      });
      const when = new Date().toLocaleTimeString();
      say(when + " · " + stock.qty.size + " SKUs, " + units.toLocaleString() + " pcs in 4KB · " +
        (changed.length ? changed.length + " updated" : "no change") +
        (notInPlanner.length ? " · " + notInPlanner.length + " not in Rack Planner" : ""), "ok");
    } catch (e) {
      console.error(e);
      say(e.message, "bad");
      report(false, e.message).catch(function () { /* Rack Planner unreachable too */ });
    } finally {
      busy = false;
    }
  }

  // A worker keeps time: a background tab's own timers can be slowed to once
  // a minute, a worker's are not.
  const worker = new Worker(URL.createObjectURL(new Blob(
    ["setInterval(function(){postMessage(0)}," + EVERY + ")"], { type: "text/javascript" })));
  worker.onmessage = round;
  round();

  badge.querySelector("[data-stop]").addEventListener("click", function () {
    stopped = true;
    worker.terminate();
    say("Stopped. Click the bookmark to start again.", "bad");
    report(false, "Stopped in JSTERP").catch(function () {});
    window.__rackSync = null;
    setTimeout(function () { badge.remove(); }, 4000);
  });

  window.__rackSync = { show: function () { badge.style.outline = "3px solid #2e9d5b"; setTimeout(function () { badge.style.outline = ""; }, 800); } };
})();
