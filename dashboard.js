// The racks dashboard: every shelf in the 4KB racks, what the imported sheet
// puts on it, and the rules that decided.
//
// Placement is never stored. It is worked out here from the sheet and the
// rules every time, so a rule change shows at once and every PC that opens
// the page sees the same racks.
const Dashboard = (function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const SECTION_COLORS = ["#2f6fed", "#f0982c", "#17a673", "#e05260", "#8b5cf6", "#0ea5b7", "#d4a106", "#64748b"];
  const TIER_COLORS = ["#17a673", "#2f6fed", "#f0982c", "#e05260", "#8b5cf6", "#0ea5b7", "#64748b"];

  const el = {
    empty: $("dashEmpty"), dash: $("dash"), source: $("dashSource"),
    search: $("dashSearch"), colorBy: $("dashColor"), exportBtn: $("dashExport"),
    kShelves: $("kShelves"), kBoxes: $("kBoxes"), kMiss: $("kMiss"), kMissWrap: $("kMissWrap"),
    kSkus: $("kSkus"), kFill: $("kFill"),
    map: $("rackMap"), mapReset: $("mapReset"),
    detail: $("detail"), detailClose: $("detailClose"),
    dLabel: $("dLabel"), dWhere: $("dWhere"), dCanvas: $("dCanvas"), dTable: $("dTable"),
    skuFilter: $("skuFilter"), skuTable: $("skuTable"),
    gap: $("dataGap"), gapText: $("dataGapText"), gapShow: $("dataGapShow"),
    ruleDays: $("ruleDays"), skuStatus: $("skuStatus"),
    catList: $("catList"), catHint: $("catHint"), skuAdd: $("skuAdd"),
    pickModal: $("pickModal"), pickTitle: $("pickTitle"), pickSub: $("pickSub"),
    pickMap: $("pickMap"), pickClose: $("pickClose"), pickLegend: $("pickLegend"), pickHint: $("pickHint"),
    mapLegend: $("mapLegend"),
    catStats: $("catStats"), catModal: $("catModal"), catTitle: $("catTitle"), catClose: $("catClose"), catAdd: $("catAdd"), catBody: $("catBody"),
    skuDialog: $("skuDialog"), skuForm: $("skuForm"), skuFormError: $("skuFormError"),
    skuCancel: $("skuCancel"), catOptions: $("catOptions"), tierOptions: $("tierOptions"),
  };

  const state = {
    data: null,        // { import, skus }
    rules: Object.assign({}, Allocate.DEFAULT_RULES),
    alloc: null,
    selected: null,    // shelf label
    category: null,    // the category whose SKUs are open; ALL for every one
    picking: null,     // the SKU (result index) a shelf is being picked for
    search: "",
    colors: null,
    view: null,
  };

  // --- small helpers ---------------------------------------------------------

  function esc(v) {
    return String(v === null || v === undefined ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  const fmt = (n) => (n === null || n === undefined || n === "" ? "" : Number(n).toLocaleString());
  const pct = (f) => Math.round(f * 100) + "%";
  const dark = () => document.documentElement.getAttribute("data-theme") === "dark";

  // Distinct, stable colours: values sorted, then spaced round the colour
  // wheel by the golden angle so neighbours never look alike.
  function wheel(values) {
    const map = new Map();
    values.forEach(function (v, i) {
      const hue = Math.round((205 + i * 137.508) % 360);
      map.set(v, "hsl(" + hue + ", 62%, 52%)");
    });
    return map;
  }

  // One colour per category, far enough apart to tell on the map, given in
  // name order so a category keeps its colour as SKUs come and go. Past
  // twenty, the wheel takes over.
  const CATEGORY_COLORS = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f",
    "#bcbd22", "#17becf", "#393b79", "#ffbb78", "#98df8a", "#ff9896", "#c5b0d5", "#c49c94",
    "#f7b6d2", "#dbdb8d", "#9edae5", "#aec7e8",
  ];

  function buildColors() {
    const skus = state.data.skus;
    const uniq = (f) => [...new Set(skus.map(f))].sort(Allocate.compareText);
    const tiers = new Map();
    uniq((s) => s.tier).forEach((t, i) => tiers.set(t, TIER_COLORS[i % TIER_COLORS.length]));
    const names = uniq((s) => s.category || "");
    const extra = wheel(names.slice(CATEGORY_COLORS.length));
    const category = new Map(names.map((c, i) => [c, CATEGORY_COLORS[i] || extra.get(c)]));
    state.colors = {
      category: category,
      tier: tiers,
      sku: wheel(uniq((s) => s.sku)),
    };
  }

  function colorOf(skuIndex) {
    const s = state.data.skus[skuIndex];
    const by = el.colorBy.value;
    return state.colors[by].get(by === "category" ? s.category || "" : by === "tier" ? s.tier : s.sku) || "#94a3b8";
  }

  function categoryColor(name) {
    return state.colors.category.get(name || "") || "#94a3b8";
  }

  // The key to the map's colours: categories (or tiers), each with how many
  // shelves it has. Ones with no shelf yet are shown faded.
  function legendHtml(by) {
    if (by === "sku") return '<span class="sub">Each SKU has its own colour.</span>';
    const shelves = new Map();
    for (const rec of state.alloc.locations.values()) {
      const keys = new Set(rec.sections.map(function (sec) {
        const s = state.data.skus[sec.sku];
        return by === "tier" ? s.tier || "" : s.category || "";
      }));
      for (const k of keys) shelves.set(k, (shelves.get(k) || 0) + 1);
    }
    const keys = [...state.colors[by].keys()];
    return keys.map(function (k) {
      const n = shelves.get(k) || 0;
      return '<span' + (n ? "" : ' class="off"') + ' title="' + n + " shel" + (n === 1 ? "f" : "ves") + '">' +
        '<i style="background:' + state.colors[by].get(k) + '"></i>' +
        esc(k || (by === "tier" ? "(no tier)" : "(no category)")) + "</span>";
    }).join("");
  }

  // --- loading -------------------------------------------------------------

  const ALL = "__all__";

  // Nothing saved yet is an empty list, not an error: SKUs can be added by
  // hand from here.
  function load(data) {
    state.data = data && data.skus ? data : { import: null, skus: [] };
    if (!state.data.shelves) state.data.shelves = [];
    el.empty.hidden = true;
    el.dash.hidden = false;
    state.rules = Object.assign({}, Allocate.DEFAULT_RULES, (state.data.import && state.data.import.rules) || {});
    el.ruleDays.value = state.rules.days;

    buildColors();
    recompute();
  }

  function layout() {
    return Allocate.place(state.data.skus, state.data.shelves, state.rules);
  }

  function recompute() {
    state.alloc = layout();
    render();
  }

  // --- drawing everything ----------------------------------------------------

  function render() {
    renderKpis();
    renderMap();
    renderDetail();
    renderCategories();
    renderSkus();
  }

  function catName(c) { return c || "(no category)"; }

  function renderKpis() {
    const s = state.alloc.stats;
    const cats = new Set(state.data.skus.map((k) => k.category || ""));
    el.source.textContent = s.skus.toLocaleString() + " SKUs in " + cats.size + " categor" + (cats.size === 1 ? "y" : "ies");
    el.kShelves.textContent = s.shelvesUsed + " / " + s.shelves;
    el.kBoxes.textContent = s.boxesPlaced.toLocaleString() + " / " + s.boxesWanted.toLocaleString();
    el.kMiss.textContent = s.boxesUnplaced.toLocaleString();
    el.kMissWrap.classList.toggle("bad", s.boxesUnplaced > 0);
    el.kSkus.textContent = s.skusPlaced + " / " + s.skusNeeding;
    el.kFill.textContent = pct(s.fill);

    // SKUs the sheet asks stock for but gives no box count: the racks cannot
    // hold what nobody has said the size of. Easy to miss in a table, so it
    // is said up front.
    if (s.skusNoCount) {
      const units = state.alloc.results.filter((r) => r.problem === "no-count")
        .reduce((n, r) => n + r.needed, 0);
      el.gapText.innerHTML = "<b>" + s.skusNoCount + " SKUs</b> sell (" + units.toLocaleString() +
        " units over " + state.rules.days + " days) but have no <em>Qty per box</em>, so their boxes " +
        "cannot be counted and the racks have no room set aside for them. Click <em>Show them</em> to fill it in.";
      el.gap.hidden = false;
    } else {
      el.gap.hidden = true;
    }
  }

  function matches(rec, label) {
    const q = state.search;
    if (!q) return true;
    if (label.toLowerCase().includes(q)) return true;
    if (!rec) return false;
    return rec.sections.some(function (sec) {
      const s = state.data.skus[sec.sku];
      return [s.sku, s.category, s.tier].some((v) => String(v || "").toLowerCase().includes(q));
    });
  }

  // pick: the result index a shelf is being picked for, when drawing the
  // picker; its own shelves are marked, and search and selection are left
  // out.
  // How many boxes of SKU `index` still fit in the room left on a shelf.
  // A SKU with no box size cannot be fitted anywhere already in use.
  function roomFor(rec, index) {
    const s = state.data.skus[index];
    if (!rec) return Infinity;
    if (!Allocate.hasSize(s) || rec.free < 1) return 0;
    return state.alloc.packIn(Math.floor(rec.free + 1e-6), { l: s.length, w: s.width, h: s.height }).count;
  }

  function cellHtml(row, col, layer, pick) {
    const label = Layout.label(row, col, layer);
    const rec = state.alloc.locations.get(label);
    const shelf = Layout.SHELF;
    const cls = ["cell"];
    if (!rec) cls.push("free");
    if (pick === undefined) {
      if (state.selected === label) cls.push("selected");
      if (state.search) cls.push(matches(rec, label) ? "hit" : "dim");
    } else {
      cls.push("pick", !rec ? "vacant" : rec.sections.some((sec) => sec.sku === pick) ? "mine"
        : roomFor(rec, pick) > 0 ? "taken" : "full");
    }

    let inner = "";
    let tip = label + (rec ? " · " + pct(rec.fill) + " full" : pick === undefined ? " · empty" : " · vacant");
    if (rec) {
      for (const sec of rec.sections) {
        const s = state.data.skus[sec.sku];
        const slab = sec.len * shelf.w * shelf.h;
        const level = sec.boxes && Allocate.hasSize(s) ? Math.min(1, (sec.boxes * s.length * s.width * s.height) / slab) : 0;
        inner += '<i style="left:' + (sec.x / shelf.l * 100).toFixed(2) + "%;width:" +
          (sec.len / shelf.l * 100).toFixed(2) + "%;height:" + Math.max(8, level * 100).toFixed(1) +
          "%;background:" + colorOf(sec.sku) + '"></i>';
        tip += "\n" + s.sku + " ×" + sec.boxes + (s.category ? "  · " + s.category : "") + (s.tier ? "  · " + s.tier : "");
      }
      if (rec.sections.length > 1) inner += '<b class="n">' + rec.sections.length + "</b>";
    }
    if (pick !== undefined && cls.indexOf("full") >= 0) tip += "\nNo room left for this SKU";
    // An occupied shelf is tinted its colour all over, so a shelf with a
    // single box still reads as its category; the bar shows how full it is.
    const tint = rec ? ' style="background:color-mix(in srgb, ' + colorOf(rec.sections[0].sku) + ' 30%, transparent)"' : "";
    return '<div class="' + cls.join(" ") + '" data-label="' + label + '"' + tint + ' title="' + esc(tip) + '">' + inner + "</div>";
  }

  function renderMap() {
    el.map.innerHTML = mapHtml();
    el.mapLegend.innerHTML = legendHtml(el.colorBy.value);
  }

  function mapHtml(pick) {
    let html = "";
    const widest = Math.max.apply(null, Layout.ROWS);
    // The categories on each row, most shelves first.
    const rowNames = new Map();
    const perRow = new Map();
    for (const rec of state.alloc.locations.values()) {
      if (!perRow.has(rec.row)) perRow.set(rec.row, new Map());
      for (const c of new Set(rec.sections.map((sec) => catName(state.data.skus[sec.sku].category)))) {
        perRow.get(rec.row).set(c, (perRow.get(rec.row).get(c) || 0) + 1);
      }
    }
    for (const [row, m] of perRow) rowNames.set(row, [...m].sort((x, y) => y[1] - x[1]).map((e) => e[0]));
    Layout.ROWS.forEach(function (cols, i) {
      const row = i + 1;
      let used = 0;
      let colsHtml = "";
      for (let col = 1; col <= cols; col++) {
        colsHtml += '<div class="rack-col">';
        for (let layer = Layout.LAYERS; layer >= 1; layer--) {
          if (state.alloc.locations.has(Layout.label(row, col, layer))) used++;
          colsHtml += cellHtml(row, col, layer, pick);
        }
        colsHtml += '<div class="col-num">Col ' + col + "</div></div>";
      }
      const name = rowNames.has(row) ? '<span class="row-cat">' + rowNames.get(row).map(esc).join(" · ") + "</span>" : "";
      html += '<div class="rack-row"><div class="rack-row-head"><b>Row ' + row + "</b>" + name +
        '<span class="sub">' + cols + " columns · " + used + " of " + cols * Layout.LAYERS + " shelves used</span></div>" +
        '<div class="rack-cols" style="--max:' + widest + '"><div class="layer-axis"><span>Layer 3</span><span>Layer 2</span><span>Layer 1</span></div>' +
        colsHtml + "</div></div>";
    });
    return html;
  }

  function renderDetail() {
    const label = state.selected;
    el.detail.hidden = !label;
    document.body.classList.toggle("detail-open", !!label);
    if (!label) return;

    const [, row, col, layer] = label.split("-").map(Number);
    const rec = state.alloc.locations.get(label) || null;
    el.dLabel.textContent = label;
    const stat = (name, value) => "<div><dt>" + name + "</dt><dd>" + value + "</dd></div>";
    el.dWhere.innerHTML = stat("Row", row) + stat("Column", col) +
      stat("Layer", layer + ' <span class="sub">' + (layer === 1 ? "floor" : layer === Layout.LAYERS ? "top" : "middle") + "</span>") +
      stat("Full", rec ? pct(rec.fill) : "0%");

    // The map's colours, unless two SKUs here would share one.
    let colors = SECTION_COLORS;
    if (rec) {
      const mapColors = rec.sections.map((sec) => colorOf(sec.sku));
      if (new Set(mapColors).size === mapColors.length) colors = mapColors;
    }
    const colorFor = (i) => (colors === SECTION_COLORS ? SECTION_COLORS[i % SECTION_COLORS.length] : colors[i]);

    if (!state.view && View3D.available()) state.view = View3D.create(el.dCanvas);
    if (state.view) {
      const placements = rec ? Allocate.placementsOn(rec, state.data.skus, state.alloc) : [];
      for (const p of placements) p.color = colorFor(p.section);
      state.view.show(Layout.SHELF, placements, dark());
    }

    if (!rec) {
      el.dTable.innerHTML = '<p class="sub detail-none">Empty shelf — nothing in the sheet needs it.</p>';
      return;
    }

    // One card per SKU on the shelf, every number named.
    const dash = '<span class="sub">—</span>';
    const boxes = rec.sections.reduce((n, sec) => n + sec.boxes, 0);
    let html = '<p class="detail-sum"><b>' + rec.sections.length + "</b> SKU" + (rec.sections.length === 1 ? "" : "s") +
      " · <b>" + fmt(boxes) + "</b> box" + (boxes === 1 ? "" : "es") + " on this shelf</p>";
    rec.sections.forEach(function (sec, i) {
      const s = state.data.skus[sec.sku];
      const fact = (name, value, wide) => '<div' + (wide ? ' class="wide"' : "") + "><dt>" + name + "</dt><dd>" +
        (value === "" || value === null || value === undefined ? dash : value) + "</dd></div>";
      html += '<article class="dsku">' +
        '<header><span class="chip" style="background:' + colorFor(i) + '"></span><b>' + esc(s.sku) + "</b></header>" +
        "<dl>" +
        fact("Category", esc(s.category)) +
        fact("Tier", esc(s.tier)) +
        fact("Sold per day", fmt(s.soldPerDay)) +
        fact("Qty per box", s.qtyPerBox > 0 ? fmt(s.qtyPerBox) : "") +
        fact("Boxes on shelf", "<b>" + fmt(sec.boxes) + "</b>") +
        fact("Qty on shelf", s.qtyPerBox > 0 ? fmt(sec.boxes * s.qtyPerBox) : "") +
        fact("Box size (L × W × H)", [s.length, s.width, s.height].join(" × ") + " cm", true) +
        "</dl></article>";
    });
    const free = Layout.SHELF.l - rec.sections.reduce((n, s) => n + s.len, 0);
    if (free > 0.5 && rec.sections.length && rec.sections[0].len < Layout.SHELF.l) {
      html += '<p class="sub detail-free">' + Math.round(free) + " cm of shelf width still free</p>";
    }
    el.dTable.innerHTML = html;
  }

  const WHY = {
    "too-big": "box is bigger than a shelf",
    "no-size": "box size missing",
    "no-location": "pick a location",
    "short": "needs more shelves",
    "none-needed": "no boxes needed",
    "no-count": "no qty per box",
  };
  const ATTENTION = ["too-big", "no-size", "no-location", "short", "no-count"];

  // The SKU list's columns after #, Tier, Category and SKU, in order.
  // "fixed" shows a SKU number, "edit" makes it editable in place, and the
  // rest are worked out (see worked()). w is the width in px; Locations
  // takes what is left.
  const COLUMNS = [
    { head: "4KB Qty", w: 72, fixed: "quantity" },
    { head: "Sold/Day", w: 70, fixed: "soldPerDay" },
    { head: "Needed", w: 68, worked: "needed", title: "Sold per day \u00d7 days of stock" },
    { head: "Qty/Box", w: 72, edit: "qtyPerBox" },
    { head: "Boxes", w: 56, worked: "boxes", title: "Needed \u00f7 Qty/Box, rounded up" },
    { head: "Per Shelf", w: 68, worked: "perShelf", title: "Boxes that fit on one empty shelf" },
    { head: "Shelf Needed", w: 92, worked: "shelvesNeeded", title: "Boxes \u00f7 Per Shelf, rounded up" },
    { head: "Placed", w: 56, worked: "placed" },
    { head: "No shelf", w: 64, worked: "unplaced" },
    { head: "L", w: 54, edit: "length" },
    { head: "W", w: 54, edit: "width" },
    { head: "H", w: 54, edit: "height" },
    { head: "Locations", w: 0, worked: "locations", cls: "locs" },
  ];
  const LEAD = 4; // #, Tier, Category, SKU

  // A box that is empty but needed for this SKU to get a shelf.
  function wanting(r, key) {
    const s = r.sku;
    if (key === "qtyPerBox") return r.problem === "no-count";
    if (key === "length" || key === "width" || key === "height") return r.problem === "no-size" || !(s[key] > 0) && s.soldPerDay > 0;
    return false;
  }

  const needsAttention = (r) => ATTENTION.indexOf(r.problem) >= 0;

  const COPY_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.5 10.5h-1a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v1" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  const DONE_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // The clipboard API only exists on https and localhost. The office copy is
  // plain http on the network, so there the old copy command does the job.
  function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value).catch(function () { return copyByCommand(value); });
    }
    return copyByCommand(value);
  }

  function copyByCommand(value) {
    return new Promise(function (resolve, reject) {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      if (ok) resolve(); else reject(new Error("copy refused"));
    });
  }

  // Each location: the shelf (opens it), boxes and qty this SKU has there,
  // a copy button, and the x that takes the SKU off it.
  function locationsHtml(r) {
    const perBox = r.sku.qtyPerBox > 0 ? r.sku.qtyPerBox : 0;
    const where = r.spots.map(function (p) {
      const shared = (state.alloc.locations.get(p.label) || { sections: [] }).sections.length > 1;
      return '<span class="loc-chip"><a href="#" data-loc="' + p.label + '">' + p.label + "</a>" +
        '<span class="loc-qty">' + fmt(p.boxes) + " box" + (p.boxes === 1 ? "" : "es") +
        (perBox ? " \u00b7 " + fmt(p.boxes * perBox) + " qty" : "") + "</span>" +
        // A shelf that filled up before this SKU got any room on it, for
        // instance when the SKU before it was given its qty per box later.
        (!p.boxes && r.counted && r.wanted > 0 && r.perShelf
          ? '<span class="loc-noroom" title="The shelf is full: none of this SKU\u2019s boxes fit. Delete this location.">no room</span>'
          : shared ? '<span class="loc-mixed" title="Shared with other SKUs">mixed</span>' : "") +
        '<span class="loc-acts"><button type="button" class="copy-btn" data-copy="' + p.label + '" title="Copy location" aria-label="Copy ' + p.label + '">' + COPY_ICON + "</button>" +
        '<button type="button" class="loc-free" data-free="' + p.label + '" data-free-sku="' + r.index + '" title="Delete this location" aria-label="Delete ' + p.label + '">\u00d7</button></span></span>';
    }).join("");
    const total = r.spots.length > 1 && perBox
      ? '<span class="loc-total">Total ' + fmt(r.placed) + " boxes \u00b7 " + fmt(r.placed * perBox) + " qty</span>" : "";
    const note = r.problem && r.problem !== "none-needed"
      ? '<span class="tag' + (needsAttention(r) ? " bad" : "") + '">' + WHY[r.problem] + "</span>" : "";
    return where + total + '<span class="loc-foot"><button type="button" class="ghost small loc-pick" data-pick="' + r.index +
      '">+ Select location</button>' + note + "</span>";
  }

  // The value of one worked-out column for a SKU.
  function worked(key, r) {
    switch (key) {
      case "needed": return fmt(r.needed);
      case "boxes": return "<b>" + (r.problem === "no-count" ? "?" : fmt(r.wanted)) + "</b>";
      case "perShelf": return r.perShelf ? fmt(r.perShelf) : "";
      case "shelvesNeeded": return r.perShelf && r.counted && r.wanted > 0 ? fmt(Math.ceil(r.wanted / r.perShelf)) : "";
      case "placed": return fmt(r.placed);
      case "unplaced": return r.unplaced ? '<span class="pending">' + fmt(r.unplaced) + "</span>" : "";
      case "locations": return locationsHtml(r);
    }
    return "";
  }

  // After an edit, the rows already on screen get their worked-out cells
  // brought up to date and nothing else is touched. Rebuilding the whole
  // list -- some 1,500 inputs -- stalled every edit and replaced the box the
  // cursor had just moved on to.
  const WORKED_CELLS = COLUMNS.map((c, i) => (c.worked ? i + LEAD : -1)).filter((i) => i >= 0);
  function updateSkus() {
    const body = el.skuTable.tBodies[0];
    if (!body) return;
    for (const tr of body.rows) {
      if (tr.dataset.sku === undefined) continue;
      const r = state.alloc.results[Number(tr.dataset.sku)];
      WORKED_CELLS.forEach(function (c) {
        const td = tr.cells[c];
        const html = worked(COLUMNS[c - LEAD].worked, r);
        if (td && td.innerHTML !== html) td.innerHTML = html;
      });
      tr.classList.toggle("short", needsAttention(r));
      for (const input of tr.querySelectorAll("input[data-field]")) {
        input.classList.toggle("want", !!wanting(r, input.dataset.field));
        // A save that failed puts the old number back.
        const v = r.sku[input.dataset.field];
        const shown = v === null || v === undefined ? "" : String(v);
        if (input !== document.activeElement && input.value !== shown) input.value = shown;
      }
    }
  }

  // One button per category, the biggest first -- the same order the rows
  // are handed out in -- with how many SKUs it has.
  // What one category (or ALL) takes on the racks: shelves holding any of
  // its SKUs, which rows those are in, and the boxes placed.
  function categoryUse(key) {
    const skus = state.data.skus;
    const rows = new Set();
    let shelves = 0;
    for (const rec of state.alloc.locations.values()) {
      if (key === ALL || rec.sections.some((sec) => (skus[sec.sku].category || "") === key)) {
        shelves++;
        rows.add(rec.row);
      }
    }
    const results = state.alloc.results.filter((r) => key === ALL || (r.sku.category || "") === key);
    return {
      skus: results.length,
      shelves: shelves,
      rows: [...rows].sort((a, b) => a - b),
      boxes: results.reduce((n, r) => n + r.placed, 0),
    };
  }

  function renderCatStats() {
    if (state.category === null) return;
    const u = categoryUse(state.category);
    const stat = (name, value) => "<div><dt>" + name + "</dt><dd>" + value + "</dd></div>";
    el.catStats.innerHTML = stat("SKUs", fmt(u.skus)) +
      stat("Shelves", fmt(u.shelves) + ' <span class="sub">of ' + Layout.count + "</span>") +
      stat("Boxes placed", fmt(u.boxes)) +
      stat(u.rows.length === 1 ? "Row" : "Rows", u.rows.length ? u.rows.join(", ") : "\u2014");
  }

  function renderCategories() {
    const by = new Map();
    for (const r of state.alloc.results) {
      const c = r.sku.category || "";
      const e = by.get(c) || { name: c, skus: 0, attention: 0 };
      e.skus++;
      if (needsAttention(r)) e.attention++;
      by.set(c, e);
    }
    for (const e of by.values()) e.shelves = categoryUse(e.name).shelves;
    const cats = [...by.values()].sort((a, b) => b.skus - a.skus || Allocate.compareText(a.name, b.name));
    if (state.category !== null && state.category !== ALL && !by.has(state.category)) state.category = null;

    const button = (key, name, e) => '<button type="button" class="cat-btn' + (state.category === key ? " on" : "") +
      '" data-cat="' + esc(key) + '"><b>' + (key === ALL ? "" : '<i style="background:' + categoryColor(key) + '"></i>') +
      esc(name) + '</b><span class="cnt">' + e.skus.toLocaleString() +
      " SKU" + (e.skus === 1 ? "" : "s") + " · " + e.shelves.toLocaleString() + " shel" + (e.shelves === 1 ? "f" : "ves") +
      (e.attention ? ' · <span class="warn">' + e.attention + " need" + (e.attention === 1 ? "s" : "") + " attention</span>" : "") +
      "</span></button>";
    const total = {
      skus: state.alloc.results.length, shelves: state.alloc.locations.size,
      attention: state.alloc.results.filter(needsAttention).length,
    };
    el.catList.innerHTML = (cats.length > 1 ? button(ALL, "All categories", total) : "") +
      cats.map((e) => button(e.name, catName(e.name), e)).join("");
    el.catOptions.innerHTML = cats.filter((e) => e.name).map((e) => '<option value="' + esc(e.name) + '">').join("");
    el.tierOptions.innerHTML = state.alloc.tiers.filter(Boolean).map((t) => '<option value="' + esc(t) + '">').join("");
  }

  function renderSkus() {
    const picked = state.category;
    el.catHint.textContent = state.data.skus.length
      ? "Click a category to see and edit its SKUs, best seller first."
      : "No SKUs yet \u2014 add the first one with + Add SKU.";
    el.catModal.hidden = picked === null;
    document.body.classList.toggle("cat-open", picked !== null);
    if (picked === null) { el.skuTable.innerHTML = ""; return; }
    el.catTitle.textContent = picked === ALL ? "All categories" : catName(picked);
    renderCatStats();

    const filter = el.skuFilter.value;
    // Best seller first. The order is set when the list is drawn, and an
    // edit does not redraw it, so a row never jumps away while somebody is
    // typing in it. The # column gives its priority on the racks.
    const sold = (r) => (typeof r.sku.soldPerDay === "number" ? r.sku.soldPerDay : -1);
    const rows = state.alloc.results
      .filter((r) => picked === ALL || (r.sku.category || "") === picked)
      .sort((a, b) => sold(b) - sold(a) || Allocate.compareText(a.sku.sku, b.sku.sku))
      .filter(function (r) {
        if (filter === "missing") return ATTENTION.indexOf(r.problem) >= 0;
        if (filter === "nocount") return r.problem === "no-count";
        if (filter === "placed") return r.placed > 0 && r.unplaced === 0;
        return true;
      });

    const days = state.rules.days;
    const widths = [40, 80, 100, 240].concat(COLUMNS.map((c) => c.w));
    let html = "<colgroup>" + widths.map((w) => (w ? '<col style="width:' + w + 'px">' : "<col>")).join("") + "</colgroup>" +
      "<thead><tr><th>#</th><th>Tier</th><th>Category</th><th>SKU</th>" +
      COLUMNS.map(function (c) {
        const title = c.worked === "needed" ? "Sold per day \u00d7 " + days + " days" : c.title;
        return "<th" + (title ? ' title="' + title + '"' : "") + ">" + c.head + "</th>";
      }).join("") + "</tr></thead><tbody>";
    // # counts down this list from 1, whatever is open.
    rows.forEach(function (r, i) {
      const s = r.sku;
      const cells = COLUMNS.map(function (c) {
        if (c.fixed) return '<td class="num">' + fmt(s[c.fixed]) + "</td>";
        if (c.edit) {
          const v = s[c.edit];
          return '<td class="num edit-col"><input class="cell-in' + (wanting(r, c.edit) ? " want" : "") +
            '" type="number" min="0" step="any" inputmode="decimal" data-sku="' + r.index +
            '" data-field="' + c.edit + '" value="' + (v === null || v === undefined ? "" : v) + '"></td>';
        }
        return '<td class="' + (c.cls || "num") + '">' + worked(c.worked, r) + "</td>";
      }).join("");
      html += '<tr data-sku="' + r.index + '"' + (needsAttention(r) ? ' class="short"' : "") + ">" +
        '<td class="sub">' + (i + 1) + "</td>" +
        '<td title="' + esc(s.tier) + '">' + esc(s.tier) + '</td><td title="' + esc(s.category) + '"><i class="cat-dot" style="background:' + categoryColor(s.category) + '"></i>' + esc(s.category) +
        '</td><td class="sku-name" title="' + esc(s.sku) + '"><span class="sku-wrap"><b>' + esc(s.sku) + "</b>" +
        '<button type="button" class="copy-btn" data-copy="' + esc(s.sku) + '" title="Copy SKU" aria-label="Copy ' + esc(s.sku) + '">' +
        COPY_ICON + "</button></span></td>" +
        cells + "</tr>";
    });
    if (!rows.length) html += '<tr><td colspan="17" class="sub">Nothing to show.</td></tr>';
    el.skuTable.innerHTML = html + "</tbody>";
  }


  // --- interaction -----------------------------------------------------------

  function select(label, scroll) {
    state.selected = label;
    el.map.querySelectorAll(".cell.selected").forEach((c) => c.classList.remove("selected"));
    const cell = el.map.querySelector('.cell[data-label="' + label + '"]');
    if (cell) {
      cell.classList.add("selected");
      if (scroll) cell.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    renderDetail();
    if (scroll) el.map.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  el.map.addEventListener("click", function (e) {
    const cell = e.target.closest(".cell");
    if (cell) select(cell.dataset.label, false);
  });

  function closeDetail() {
    state.selected = null;
    el.map.querySelectorAll(".cell.selected").forEach((c) => c.classList.remove("selected"));
    el.detail.hidden = true;
    document.body.classList.remove("detail-open");
  }

  el.detailClose.addEventListener("click", closeDetail);
  // Esc closes the window on top: the shelf, then the category. The Add SKU
  // form closes itself.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || el.skuDialog.open) return;
    if (!el.detail.hidden) closeDetail();
    else if (!el.pickModal.hidden) closePicker();
    else if (!el.catModal.hidden) closeCategory();
  });

  el.skuTable.addEventListener("click", function (e) {
    const link = e.target.closest("a[data-loc]");
    if (link) {
      e.preventDefault();
      select(link.dataset.loc, true);
      return;
    }
    const copy = e.target.closest("button[data-copy]");
    if (copy) {
      const was = copy.title;
      copyText(copy.dataset.copy).then(function () {
        copy.innerHTML = DONE_ICON;
        copy.classList.add("done");
        copy.title = "Copied";
        setTimeout(function () {
          copy.innerHTML = COPY_ICON;
          copy.classList.remove("done");
          copy.title = was;
        }, 1200);
      }).catch(function () { copy.title = "Could not copy"; });
      return;
    }
    const free = e.target.closest("button[data-free]");
    if (free) { freeShelf(free.dataset.free, Number(free.dataset.freeSku)); return; }
    const pick = e.target.closest("button[data-pick]");
    if (pick) { openPicker(Number(pick.dataset.pick)); return; }
    if (e.target.closest("input, select, button")) return;
    const tr = e.target.closest("tr[data-sku]");
    if (!tr) return;
    const r = state.alloc.results[Number(tr.dataset.sku)];
    el.search.value = r.sku.sku;
    state.search = r.sku.sku.toLowerCase();
    renderMap();
    if (r.spots.length) select(r.spots[0].label, true);
  });

  // --- choosing shelves -------------------------------------------------------

  // Picking a shelf on the rack map. Vacant shelves are given at once; an
  // occupied one asks first.
  function openPicker(index) {
    state.picking = index;
    renderPicker();
    el.pickModal.hidden = false;
  }

  function closePicker() {
    state.picking = null;
    el.pickModal.hidden = true;
    el.pickMap.innerHTML = "";
  }

  function renderPicker() {
    if (state.picking === null) return;
    const r = state.alloc.results[state.picking];
    el.pickTitle.textContent = r.sku.sku;
    const vacant = Layout.count - state.alloc.locations.size;
    const facts = [catName(r.sku.category)];
    if (r.counted && r.wanted > 0) facts.push(fmt(r.wanted) + (r.wanted === 1 ? " box" : " boxes") + " needed");
    if (r.perShelf) facts.push(fmt(r.perShelf) + " fit on a shelf");
    facts.push(r.spots.length ? "on " + r.spots.map((p) => p.label).join(", ") : "no shelf yet");
    facts.push(vacant + " shelves vacant");
    el.pickSub.textContent = facts.join(" · ");
    el.pickMap.innerHTML = mapHtml(state.picking);
    el.pickLegend.innerHTML = legendHtml(el.colorBy.value);
  }

  el.pickMap.addEventListener("click", function (e) {
    const cell = e.target.closest(".cell[data-label]");
    if (!cell || cell.classList.contains("mine")) return;
    if (cell.classList.contains("full")) {
      pickNote(cell.dataset.label + " is full \u2014 there is no room left on it for this SKU. Pick another shelf.");
      return;
    }
    giveShelf(state.picking, cell.dataset.label);
  });

  const PICK_HINT = el.pickHint.textContent;
  let pickNoteTimer = null;
  function pickNote(text) {
    el.pickHint.textContent = text;
    el.pickHint.classList.add("bad-text");
    clearTimeout(pickNoteTimer);
    pickNoteTimer = setTimeout(function () {
      el.pickHint.textContent = PICK_HINT;
      el.pickHint.classList.remove("bad-text");
    }, 4000);
  }
  el.pickClose.addEventListener("click", closePicker);
  el.pickModal.addEventListener("click", function (e) {
    if (e.target === el.pickModal) closePicker();
  });

  async function giveShelf(index, label) {
    const r = state.alloc.results[index];
    if (roomFor(state.alloc.locations.get(label), index) <= 0) {
      pickNote(label + " is full \u2014 there is no room left on it for this SKU. Pick another shelf.");
      return;
    }
    if (!r.sku.id) {
      failed = "This SKU was loaded before shelves could be chosen \u2014 reload the page, then try again.";
      status();
      return;
    }
    failed = null;
    saving++;
    status();
    try {
      const head = await ensureImport();
      const given = await DB.shelves.assign(head.id, label, r.sku.id);
      state.data.shelves = state.data.shelves.concat([given]);
      closePicker();
      refresh();
    } catch (err) {
      console.error(err);
      failed = "Could not give " + label + " to " + r.sku.sku + ": " + err.message;
    } finally {
      saving--;
      status();
    }
  }

  async function freeShelf(label, index) {
    const r = state.alloc.results[index];
    if (!r || !confirm("Take " + r.sku.sku + " off " + label + "?")) return;
    failed = null;
    saving++;
    status();
    try {
      await DB.shelves.free(state.data.import.id, label, r.sku.id);
      state.data.shelves = state.data.shelves.filter((a) => !(a.label === label && String(a.sku) === String(r.sku.id)));
      if (state.selected === label && !state.data.shelves.some((a) => a.label === label)) closeDetail();
      refresh();
    } catch (err) {
      console.error(err);
      failed = "Could not take " + r.sku.sku + " off " + label + ": " + err.message;
    } finally {
      saving--;
      status();
    }
  }

  // An edit is saved the moment it is committed (Enter, Tab, or clicking
  // away), and the racks are laid out again with the new numbers.
  let saving = 0;
  let failed = null;
  function status() {
    if (failed) {
      el.skuStatus.textContent = failed;
      el.skuStatus.className = "save-status bad-text";
    } else {
      el.skuStatus.textContent = saving ? "Saving\u2026" : "Changes are saved for everyone";
      el.skuStatus.className = "save-status sub";
    }
  }

  el.skuTable.addEventListener("change", function (e) {
    const input = e.target.closest("input[data-field]");
    if (!input) return;
    const r = state.alloc.results[Number(input.dataset.sku)];
    const field = input.dataset.field;
    const raw = input.value.trim();
    const value = raw === "" ? null : Number(raw);
    if (value !== null && !(isFinite(value) && value >= 0)) {
      input.value = r.sku[field] === null || r.sku[field] === undefined ? "" : r.sku[field];
      return;
    }
    const before = r.sku[field] === undefined ? null : r.sku[field];
    if (value === before) return;
    if (!r.sku.id) {
      failed = "This sheet was loaded before editing existed \u2014 reload the page, then edit.";
      status();
      return;
    }

    r.sku[field] = value;
    failed = null;
    saving++;
    status();
    const patch = {};
    patch[field] = value;
    DB.imports.updateSku(r.sku.id, patch)
      .catch(function (err) {
        console.error(err);
        r.sku[field] = before;
        failed = "Could not save " + r.sku.sku + ": " + err.message + " \u2014 the old value is back.";
        refresh();
      })
      .finally(function () { saving--; status(); });
    refresh();
  });

  // Lay out again and redraw everything but the SKU list, whose rows only
  // have their worked-out numbers brought up to date.
  let refreshTimer = null;
  function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      state.alloc = layout();
      renderKpis();
      renderMap();
      renderDetail();
      renderCategories();
      renderCatStats();
      updateSkus();
    }, 0);
  }

  let searchTimer = null;
  el.search.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.search = el.search.value.trim().toLowerCase();
      renderMap();
    }, 120);
  });
  // Enter jumps to the first shelf that matches.
  el.search.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    state.search = el.search.value.trim().toLowerCase();
    renderMap();
    const hit = el.map.querySelector(".cell.hit:not(.free)") || el.map.querySelector(".cell.hit");
    if (hit) select(hit.dataset.label, true);
  });

  el.colorBy.addEventListener("change", function () { renderMap(); renderDetail(); });

  // Back to how the map looks when the page opens: no search, no shelf
  // picked, coloured by category, scrolled to the start. Rules and SKUs are
  // left alone.
  el.mapReset.addEventListener("click", function () {
    el.search.value = "";
    state.search = "";
    el.colorBy.value = "category";
    closeDetail();
    renderMap();
    el.map.scrollLeft = 0;
  });
  el.skuFilter.addEventListener("change", renderSkus);

  // The days of stock re-lay the racks at once and are saved for everyone.
  // The other rules are no longer on the page; the ones saved with the
  // list still apply.
  let saveTimer = null;
  function ruleChanged() {
    const days = Math.round(Number(el.ruleDays.value));
    state.rules = Object.assign({}, state.rules, {
      days: days >= 1 && days <= 365 ? days : state.rules.days,
    });
    el.ruleDays.value = state.rules.days;
    recompute();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      ensureImport()
        .then((head) => DB.imports.setRules(head.id, state.rules))
        .then(function () { state.data.import.rules = state.rules; })
        .catch(function (e) { console.error(e); alert("The new rules could not be saved: " + e.message); });
    }, 400);
  }
  el.ruleDays.addEventListener("change", ruleChanged);

  function openCategory(key, filter) {
    state.category = key;
    el.skuFilter.value = filter || "all";
    renderCategories();
    renderSkus();
    el.catBody.scrollTop = 0;
  }

  function closeCategory() {
    state.category = null;
    renderCategories();
    renderSkus();
  }

  el.gapShow.addEventListener("click", function () { openCategory(ALL, "nocount"); });

  el.catList.addEventListener("click", function (e) {
    const btn = e.target.closest("button[data-cat]");
    if (btn) openCategory(btn.dataset.cat);
  });
  el.catClose.addEventListener("click", closeCategory);
  // A click on the dimmed page around the window closes it too.
  el.catModal.addEventListener("click", function (e) {
    if (e.target === el.catModal) closeCategory();
  });

  // --- adding and removing SKUs ---------------------------------------------

  // The list SKUs belong to. One is made the first time it is needed.
  async function ensureImport() {
    if (!state.data.import) state.data.import = await DB.imports.create(state.rules);
    return state.data.import;
  }

  function relayout() {
    buildColors();
    recompute();
  }

  const NUMBERS = ["soldPerDay", "quantity", "length", "width", "height", "qtyPerBox"];

  function openAdd() {
    el.skuForm.reset();
    el.skuFormError.hidden = true;
    if (state.category !== null && state.category !== ALL) el.skuForm.querySelector('[name="category"]').value = state.category;
    el.skuDialog.showModal();
    el.skuForm.querySelector('[name="sku"]').focus();
  }
  el.skuAdd.addEventListener("click", openAdd);
  el.catAdd.addEventListener("click", openAdd);
  el.skuCancel.addEventListener("click", function () { el.skuDialog.close(); });

  el.skuForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    // By name through querySelector: elements.length is the form's own
    // count of its controls, not the Length box.
    const box = (name) => el.skuForm.querySelector('[name="' + name + '"]');
    const fail = function (msg, field) {
      el.skuFormError.textContent = msg;
      el.skuFormError.hidden = false;
      if (field) box(field).focus();
    };
    const sku = { sku: box("sku").value.trim(), category: box("category").value.trim(), tier: box("tier").value.trim() };
    if (!sku.sku) return fail("Give the SKU code.", "sku");
    if (!sku.category) return fail("Give the category.", "category");
    const taken = state.data.skus.find((s) => String(s.sku).toLowerCase() === sku.sku.toLowerCase());
    if (taken) return fail(sku.sku + " is already in the list, under " + catName(taken.category) + ".", "sku");
    for (const k of NUMBERS) {
      const raw = box(k).value.trim();
      const v = raw === "" ? null : Number(raw);
      if (v !== null && !(isFinite(v) && v >= 0)) return fail("That is not a number.", k);
      sku[k] = v;
    }

    const save = document.getElementById("skuSave");
    save.disabled = true;
    try {
      const head = await ensureImport();
      const line = state.data.skus.reduce((n, s) => Math.max(n, Number(s.line) || 0), 0) + 1;
      const added = await DB.imports.addSku(head.id, sku, line);
      state.data.skus.push(added);
      el.skuDialog.close();
      state.category = added.category || "";
      el.skuFilter.value = "all";
      relayout();
      const tr = el.skuTable.querySelector('tr[data-sku="' + (state.data.skus.length - 1) + '"]');
      if (tr) {
        tr.classList.add("just-added");
        tr.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    } catch (err) {
      console.error(err);
      fail("Could not save: " + err.message);
    } finally {
      save.disabled = false;
    }
  });

  el.exportBtn.addEventListener("click", function () {
    if (!Excel.available()) { alert("The spreadsheet library did not load, so the list cannot be written."); return; }
    Excel.putAway(state.data.skus, state.alloc, state.data.import);
  });

  document.addEventListener("themechange", function () { if (state.data) renderDetail(); });

  // --- start -----------------------------------------------------------------

  async function start() {
    try {
      const data = await DB.imports.latest();
      if (data && data.import) data.shelves = await DB.shelves.list(data.import.id);
      load(data);
    } catch (e) {
      console.error(e);
      el.empty.hidden = false;
      el.dash.hidden = true;
      el.empty.querySelector("p").textContent = e.message;
    }
  }

  return {
    load: load,
    start: start,
    rules: () => Object.assign({}, state.rules),
    hasData: () => !!state.data,
    current: () => state.data,
    shown: function () { if (state.view) state.view.redraw(); },
  };
})();
