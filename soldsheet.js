// Sold per day, read live from a Google Sheet: SKU in column A, sold per day
// in column D. The sheet is shared as "anyone with the link can view", which
// lets a browser read it as CSV with no Google sign-in.
const SoldSheet = (function () {
  "use strict";

  const SHEET_ID = "1P8TbyHF1CRoHzy82dHBGXT331LZk3x-52VIqRtF6r-c";
  const GID = "0";
  const SKU_COL = 0;   // A
  const SOLD_COL = 3;  // D

  const CSV_URL = "https://docs.google.com/spreadsheets/d/" + SHEET_ID + "/gviz/tq?tqx=out:csv&gid=" + GID;
  const VIEW_URL = "https://docs.google.com/spreadsheets/d/" + SHEET_ID + "/edit#gid=" + GID;

  // Every field comes back quoted; a quote inside one is doubled.
  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // "1,274" -> 1274; anything that is not a number -> null.
  function number(v) {
    const t = String(v === undefined ? "" : v).replace(/,/g, "").trim();
    if (!t) return null;
    const n = Number(t);
    return isFinite(n) ? n : null;
  }

  // Map of SKU (lower case) -> sold per day. The header row, blank rows and
  // rows without a number in column D are left out.
  async function read() {
    const res = await fetch(CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("Google Sheets answered " + res.status);
    const text = await res.text();
    if (/^\s*</.test(text)) throw new Error("the sheet is not shared for viewing");
    const sold = new Map();
    for (const row of parseCsv(text)) {
      const sku = String(row[SKU_COL] || "").trim().toLowerCase();
      const n = number(row[SOLD_COL]);
      if (sku && n !== null) sold.set(sku, n);
    }
    return sold;
  }

  return { read: read, url: VIEW_URL };
})();
