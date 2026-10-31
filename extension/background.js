// 4KB Qty from JSTERP, every 30 seconds, with no tab open.
//
// This runs in Chrome itself, using the JSTERP sign-in of the Chrome it is
// installed in, for as long as that Chrome is open. Any number of Chromes can
// have it: each writes only what changed. It reads Warehouse > Zone Inventory -- owner Shigetsu, Main
// Warehouse, start position 4KB -- adds the quantities up per SKU, and writes
// any 4KB Qty that changed into Rack Planner. It is jstsync.js without the
// page: same filter, same note in rack_sync.
"use strict";

const SUPABASE_URL = "https://zvzeojcdjafzqunzladl.supabase.co";
const SUPABASE_KEY = "sb_publishable_ycQbkzbjsiDtitEhZIjvMQ_fGdch1Qp";
const SYNC_NAME = "jsterp-4kb";
const STOCK_URL = "https://asia.jsterp.com/wms/Pack/GetPackItemsPages";
const SIGN_IN_URL = "https://asia-web.jsterp.com/";
const ALARM = "sync";
const EVERY_MINUTES = 0.5;
const STALE = 2 * 60 * 1000;

// The Zone Inventory filters, as JSTERP sends them: owner Shigetsu
// (LinkCoIds / LinkWarehouseIds), warehouse area Main, start position 4KB,
// stock above zero only.
const FILTER = {
  SkuIds: [], ItemIds: [], LinkWarehouseIds: ["3948"], LinkCoIds: [12697134],
  WarehouseId: 3938, BinTypes: [], AreaTypes: ["Main"], ShowZeroType: "AllNoZero",
  Keywords: [], PackItemIds: [], BinStart: "4KB",
};

class SignedOut extends Error {}

// --- JSTERP -------------------------------------------------------------------

// Every row of the filtered list, all pages.
async function readStock() {
  const rows = [];
  for (let page = 1; page < 50; page++) {
    const res = await fetch(STOCK_URL, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ RequestModel: FILTER, DataPage: { pageSize: 1000, pageIndex: page } }),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* the sign-in page, not data */ }
    if (!res.ok || !json || !Array.isArray(json.Data)) {
      throw new SignedOut("JSTERP did not send the stock list -- signed out? Sign in to JSTERP in Chrome.");
    }
    rows.push.apply(rows, json.Data);
    if (!json.DataPage || json.DataPage.IsLast || !json.Data.length) break;
  }
  // Nobody runs 4KB down to nothing: an empty list is a fault at JSTERP, and
  // taking it at its word would zero every SKU in Rack Planner.
  if (!rows.length) throw new Error("JSTERP sent an empty stock list, so 4KB Qty was left as it is.");
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

// True while the last note is a good one, from this Chrome or another. One
// Chrome signed out should not raise the alarm over one that is still syncing.
async function stillFresh() {
  const notes = await sb("rack_sync?select=ok,synced_at&name=eq." + SYNC_NAME);
  const n = notes && notes[0];
  return !!n && n.ok && Date.now() - new Date(n.synced_at).getTime() < STALE;
}

// --- what the toolbar button shows ---------------------------------------------

async function show(ok, text) {
  await chrome.storage.local.set({ last: { ok: ok, text: text, at: Date.now() } });
  await chrome.action.setBadgeText({ text: ok ? "" : "!" });
  await chrome.action.setBadgeBackgroundColor({ color: "#d64545" });
}

// Once when the sign-in goes, not every 30 seconds after it.
async function warnSignedOut(message) {
  const { warned } = await chrome.storage.local.get("warned");
  if (warned) return;
  await chrome.storage.local.set({ warned: true });
  chrome.notifications.create(ALARM, {
    type: "basic", iconUrl: "icon128.png",
    title: "Rack Planner 4KB sync stopped", message: message + " Click to sign in.",
    requireInteraction: true,
  });
}

chrome.notifications.onClicked.addListener(function () {
  chrome.tabs.create({ url: SIGN_IN_URL });
});

// --- one round --------------------------------------------------------------------

let busy = false;

async function round() {
  if (busy) return;
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
    const notInPlanner = [...stock.qty.keys()].filter((k) => !known.has(k));
    const units = [...stock.qty.values()].reduce((a, b) => a + b, 0);
    await report(true, null, {
      via: "extension", skus: stock.qty.size, rows: stock.rows, units: units, changed: changed.length,
      notInPlanner: notInPlanner.slice(0, 50), notInPlannerCount: notInPlanner.length,
    });
    await chrome.storage.local.remove("warned");
    await show(true, stock.qty.size + " SKUs, " + units.toLocaleString() + " pcs in 4KB · " +
      (changed.length ? changed.length + " updated" : "no change") +
      (notInPlanner.length ? " · " + notInPlanner.length + " not in Rack Planner" : ""));
  } catch (e) {
    console.error(e);
    await show(false, e.message);
    if (e instanceof SignedOut) await warnSignedOut(e.message);
    try {
      if (!(await stillFresh())) await report(false, e.message);
    } catch (err) { /* Rack Planner unreachable too */ }
  } finally {
    busy = false;
  }
}

// --- the timer --------------------------------------------------------------------

// An alarm wakes this worker even after Chrome has put it to sleep. Chrome
// keeps alarms across restarts, but one lost is a sync that silently stops,
// so every start checks.
async function keepTime() {
  if (!(await chrome.alarms.get(ALARM))) {
    await chrome.alarms.create(ALARM, { periodInMinutes: EVERY_MINUTES });
  }
}

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === ALARM) round();
});
chrome.runtime.onInstalled.addListener(function () { keepTime(); round(); });
chrome.runtime.onStartup.addListener(function () { keepTime(); round(); });
chrome.runtime.onMessage.addListener(function (message, sender, reply) {
  if (message !== "sync-now") return false;
  round().then(function () { reply(true); });
  return true;
});
keepTime();
