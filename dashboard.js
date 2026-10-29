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
    rulesSummary: $("rulesSummary"),
    ruleOrder: $("ruleOrder"), ruleFill: $("ruleFill"), ruleMix: $("ruleMix"), ruleTurn: $("ruleTurn"),
    map: $("rackMap"),
    detail: $("detail"), detailClose: $("detailClose"),
    rowGap: $("rowGap"), rowGapText: $("rowGapText"),
    dLabel: $("dLabel"), dWhere: $("dWhere"), dCanvas: $("dCanvas"), dTable: $("dTable"),
    skuFilter: $("skuFilter"), skuTable: $("skuTable"),
    tierList: $("tierList"), gap: $("dataGap"), gapText: $("dataGapText"), gapShow: $("dataGapShow"),
    ruleDays: $("ruleDays"), skuStatus: $("skuStatus"),
    catList: $("catList"), catHint: $("catHint"), skuAdd: $("skuAdd"),
    catModal: $("catModal"), catTitle: $("catTitle"), catClose: $("catClose"), catAdd: $("catAdd"), catBody: $("catBody"),
    skuDialog: $("skuDialog"), skuForm: $("skuForm"), skuFormError: $("skuFormError"),
    skuCancel: $("skuCancel"), catOptions: $("catOptions"), tierOptions: $("tierOptions"),
  };

  const state = {
    data: null,        // { import, skus }
    rules: Object.assign({}, Allocate.DEFAULT_RULES),
    alloc: null,
    selected: null,    // shelf label
    category: null,    // the category whose SKUs are open; ALL for every one
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

  function buildColors() {
    const skus = state.data.skus;
    const uniq = (f) => [...new Set(skus.map(f))].sort(Allocate.compareText);
    const tiers = new Map();
    uniq((s) => s.tier).forEach((t, i) => tiers.set(t, TIER_COLORS[i % TIER_COLORS.length]));
    state.colors = {
      category: wheel(uniq((s) => s.category)),
      tier: tiers,
      sku: wheel(uniq((s) => s.sku)),
    };
  }

  function colorOf(skuIndex) {
    const s = state.data.skus[skuIndex];
    const by = el.colorBy.value;
    return state.colors[by].get(by === "category" ? s.category : by === "tier" ? s.tier : s.sku) || "#94a3b8";
  }

  // --- loading -------------------------------------------------------------

  const ALL = "__all__";

  // Nothing saved yet is an empty list, not an error: SKUs can be added by
  // hand from here.
  function load(data) {
    state.data = data && data.skus ? data : { import: null, skus: [] };
    el.empty.hidden = true;
    el.dash.hidden = false;
    state.rules = Object.assign({}, Allocate.DEFAULT_RULES, (state.data.import && state.data.import.rules) || {});
    el.ruleOrder.value = state.rules.order;
    el.ruleFill.value = state.rules.fill;
    el.ruleMix.value = state.rules.mix;
    el.ruleTurn.value = state.rules.turn;
    el.ruleDays.value = state.rules.days;

    buildColors();
    recompute();
  }

  function recompute() {
    state.alloc = Allocate.run(state.data.skus, state.rules);
    render();
  }

  // --- drawing everything ----------------------------------------------------

  function render() {
    renderKpis();
    renderRules();
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

    // One category per row: more categories than rows means some share.
    const guests = state.alloc.categories.filter((c) => c.guest);
    if (guests.length) {
      const name = (c) => esc(c.name || "(no category)");
      const list = (xs) => (xs.length > 1 ? xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1] : xs[0]);
      const shared = [...new Set(guests.flatMap((g) => g.rows))].sort((a, b) => a - b);
      const hosts = shared.map(function (row) {
        const host = state.alloc.categories.find((c) => !c.guest && c.rows.indexOf(row) >= 0);
        return "Row " + row + (host ? " with " + name(host) + " (" + host.skus + " SKUs)" : "");
      });
      el.rowGapText.innerHTML = "There are more categories than rows, so <b>" + list(guests.map(name)) + "</b> " +
        (guests.length === 1 ? "shares " : "share ") + list(hosts) +
        " &mdash; " + (hosts.length === 1 ? "the category" : "the categories") + " with the fewest SKUs.";
      el.rowGap.hidden = false;
    } else {
      el.rowGap.hidden = true;
    }
  }

  function renderRules() {
    const pick = (sel) => sel.options[sel.selectedIndex].text;
    const skip = state.rules.skipTiers || [];
    el.rulesSummary.textContent = "— " + [
      state.rules.days + " days of stock",
      state.alloc.tiers.filter((t) => skip.indexOf(t) < 0).map((t) => t || "(no tier)").join(" › "),
      pick(el.ruleMix).toLowerCase(),
    ].join(", ");

    const count = new Map();
    for (const sku of state.data.skus) count.set(sku.tier || "", (count.get(sku.tier || "") || 0) + 1);
    const tiers = state.alloc.tiers;
    el.tierList.innerHTML = tiers.map(function (t, i) {
      const off = skip.indexOf(t) >= 0;
      return '<li data-tier="' + esc(t) + '"' + (off ? ' class="off"' : "") + ">" +
        '<span class="rank">' + (i + 1) + "</span>" +
        '<span class="name">' + (t ? esc(t) : '<em class="sub">(no tier)</em>') + "</span>" +
        '<span class="sub cnt">' + (count.get(t) || 0) + " SKUs</span>" +
        '<label class="give"><input type="checkbox"' + (off ? "" : " checked") + "> gets shelves</label>" +
        '<button type="button" class="ghost small" data-move="-1"' + (i === 0 ? " disabled" : "") + ' title="Better shelves">↑</button>' +
        '<button type="button" class="ghost small" data-move="1"' + (i === tiers.length - 1 ? " disabled" : "") + ' title="Worse shelves">↓</button>' +
        "</li>";
    }).join("");
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

  function cellHtml(row, col, layer) {
    const label = Layout.label(row, col, layer);
    const rec = state.alloc.locations.get(label);
    const shelf = Layout.SHELF;
    const cls = ["cell"];
    if (!rec) cls.push("free");
    if (state.selected === label) cls.push("selected");
    if (state.search) cls.push(matches(rec, label) ? "hit" : "dim");

    let inner = "";
    let tip = label + (rec ? " · " + pct(rec.fill) + " full" : " · empty");
    if (rec) {
      for (const sec of rec.sections) {
        const s = state.data.skus[sec.sku];
        const slab = sec.len * shelf.w * shelf.h;
        const level = Math.min(1, (sec.boxes * s.length * s.width * s.height) / slab);
        inner += '<i style="left:' + (sec.x / shelf.l * 100).toFixed(2) + "%;width:" +
          (sec.len / shelf.l * 100).toFixed(2) + "%;height:" + Math.max(8, level * 100).toFixed(1) +
          "%;background:" + colorOf(sec.sku) + '"></i>';
        tip += "\n" + s.sku + " ×" + sec.boxes + (s.category ? "  · " + s.category : "") + (s.tier ? "  · " + s.tier : "");
      }
      if (rec.sections.length > 1) inner += '<b class="n">' + rec.sections.length + "</b>";
    }
    return '<div class="' + cls.join(" ") + '" data-label="' + label + '" title="' + esc(tip) + '">' + inner + "</div>";
  }

  function renderMap() {
    let html = "";
    const widest = Math.max.apply(null, Layout.ROWS);
    // Each row's categories: its own first, then any sharing it.
    const rowNames = new Map();
    for (const c of state.alloc.categories.filter((c) => !c.guest).concat(state.alloc.categories.filter((c) => c.guest))) {
      for (const row of c.rows) {
        const names = rowNames.get(row) || [];
        names.push(c.name || "(no category)");
        rowNames.set(row, names);
      }
    }
    Layout.ROWS.forEach(function (cols, i) {
      const row = i + 1;
      let used = 0;
      let colsHtml = "";
      for (let col = 1; col <= cols; col++) {
        colsHtml += '<div class="rack-col">';
        for (let layer = Layout.LAYERS; layer >= 1; layer--) {
          if (state.alloc.locations.has(Layout.label(row, col, layer))) used++;
          colsHtml += cellHtml(row, col, layer);
        }
        colsHtml += '<div class="col-num">Col ' + col + "</div></div>";
      }
      const name = rowNames.has(row) ? '<span class="row-cat">' + rowNames.get(row).map(esc).join(" · ") + "</span>" : "";
      html += '<div class="rack-row"><div class="rack-row-head"><b>Row ' + row + "</b>" + name +
        '<span class="sub">' + cols + " columns · " + used + " of " + cols * Layout.LAYERS + " shelves used</span></div>" +
        '<div class="rack-cols" style="--max:' + widest + '"><div class="layer-axis"><span>Layer 3</span><span>Layer 2</span><span>Layer 1</span></div>' +
        colsHtml + "</div></div>";
    });
    el.map.innerHTML = html;
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
    "no-room": "racks are full",
    "none-needed": "no boxes needed",
    "no-count": "no qty per box",
    "skipped": "tier gets no shelves",
  };
  const ATTENTION = ["too-big", "no-size", "no-room", "no-count"];

  // The numbers a SKU's boxes are worked out from. Sizes and qty per box
  // can be edited in place; sold per day and quantity are only shown.
  const EDITABLE = [
    { key: "soldPerDay", label: "Sold / day", fixed: true },
    { key: "quantity", label: "Quantity", fixed: true },
    { key: "length", label: "L" },
    { key: "width", label: "W" },
    { key: "height", label: "H" },
    { key: "qtyPerBox", label: "Qty / box" },
  ];

  // A box that is empty but needed for this SKU to get a shelf.
  function wanting(r, key) {
    const s = r.sku;
    if (key === "qtyPerBox") return r.problem === "no-count";
    if (key === "length" || key === "width" || key === "height") return r.problem === "no-size" || !(s[key] > 0) && s.soldPerDay > 0;
    return false;
  }

  const needsAttention = (r) => ATTENTION.indexOf(r.problem) >= 0;

  // A row's cells that are worked out rather than typed: needed, boxes,
  // placed, no shelf, per shelf, locations.
  function workedOut(r) {
    const where = r.spots.map((p) => '<a href="#" data-loc="' + p.label + '">' + p.label + "</a>" +
      (p.boxes ? ' <span class="sub">\u00d7' + p.boxes + "</span>" : "")).join(", ");
    const note = r.problem && r.problem !== "none-needed"
      ? ' <span class="tag' + (needsAttention(r) ? " bad" : "") + '">' + WHY[r.problem] + "</span>" : "";
    return [
      fmt(r.needed),
      "<b>" + (r.problem === "no-count" ? "?" : fmt(r.wanted)) + "</b>",
      fmt(r.placed),
      r.unplaced ? fmt(r.unplaced) : "",
      r.perShelf ? fmt(r.perShelf) : "",
      where + note,
    ];
  }

  // After an edit, the rows already on screen get their worked-out cells
  // brought up to date and nothing else is touched. Rebuilding the whole
  // list -- some 1,500 inputs -- stalled every edit and replaced the box the
  // cursor had just moved on to.
  const WORKED_CELLS = [4 + EDITABLE.length, 5 + EDITABLE.length, 6 + EDITABLE.length,
    7 + EDITABLE.length, 8 + EDITABLE.length, 9 + EDITABLE.length];
  function updateSkus() {
    const body = el.skuTable.tBodies[0];
    if (!body) return;
    for (const tr of body.rows) {
      if (tr.dataset.sku === undefined) continue;
      const r = state.alloc.results[Number(tr.dataset.sku)];
      const worked = workedOut(r);
      WORKED_CELLS.forEach(function (c, i) {
        const td = tr.cells[c];
        if (td && td.innerHTML !== worked[i]) td.innerHTML = worked[i];
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
  function renderCategories() {
    const by = new Map();
    for (const r of state.alloc.results) {
      const c = r.sku.category || "";
      const e = by.get(c) || { name: c, skus: 0, attention: 0 };
      e.skus++;
      if (needsAttention(r)) e.attention++;
      by.set(c, e);
    }
    const cats = [...by.values()].sort((a, b) => b.skus - a.skus || Allocate.compareText(a.name, b.name));
    if (state.category !== null && state.category !== ALL && !by.has(state.category)) state.category = null;

    const button = (key, name, e) => '<button type="button" class="cat-btn' + (state.category === key ? " on" : "") +
      '" data-cat="' + esc(key) + '"><b>' + esc(name) + '</b><span class="cnt">' + e.skus.toLocaleString() +
      " SKU" + (e.skus === 1 ? "" : "s") +
      (e.attention ? ' · <span class="warn">' + e.attention + " need" + (e.attention === 1 ? "s" : "") + " attention</span>" : "") +
      "</span></button>";
    const total = { skus: state.alloc.results.length, attention: state.alloc.results.filter(needsAttention).length };
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
        if (filter === "skipped") return r.problem === "skipped";
        return true;
      });

    const days = state.rules.days;
    let html = "<thead><tr><th>#</th><th>Tier</th><th>Category</th><th>SKU</th>" +
      EDITABLE.map((f) => '<th class="num' + (f.fixed ? "" : " edit-col") + '">' + f.label + "</th>").join("") +
      '<th class="num" title="Sold per day \u00d7 ' + days + '">Needed (' + days + " d)</th>" +
      '<th class="num" title="Needed \u00f7 Qty per box, rounded up">Boxes</th><th class="num">Placed</th>' +
      '<th class="num">No shelf</th><th class="num">Per shelf</th><th>Locations</th><th></th></tr></thead><tbody>';
    // # counts down this list from 1, whatever is open.
    rows.forEach(function (r, i) {
      const s = r.sku;
      const worked = workedOut(r);
      const inputs = EDITABLE.map(function (f) {
        const v = s[f.key];
        if (f.fixed) return '<td class="num">' + fmt(v) + "</td>";
        return '<td class="num edit-col"><input class="cell-in' + (wanting(r, f.key) ? " want" : "") +
          '" type="number" min="0" step="any" inputmode="decimal" data-sku="' + r.index +
          '" data-field="' + f.key + '" value="' + (v === null || v === undefined ? "" : v) + '"></td>';
      }).join("");
      html += '<tr data-sku="' + r.index + '"' + (needsAttention(r) ? ' class="short"' : "") + ">" +
        '<td class="sub">' + (i + 1) + "</td>" +
        "<td>" + esc(s.tier) + "</td><td>" + esc(s.category) + '</td><td class="sku-name"><b>' + esc(s.sku) + "</b></td>" +
        inputs +
        '<td class="num">' + worked[0] + '</td><td class="num">' + worked[1] + "</td>" +
        '<td class="num">' + worked[2] + '</td><td class="num">' + worked[3] + "</td>" +
        '<td class="num">' + worked[4] + "</td><td>" + worked[5] + "</td>" +
        '<td><button type="button" class="ghost small row-del" data-del="' + r.index + '" title="Remove this SKU">&times;</button></td></tr>';
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
    else if (!el.catModal.hidden) closeCategory();
  });

  el.skuTable.addEventListener("click", function (e) {
    const del = e.target.closest("button[data-del]");
    if (del) { removeSku(Number(del.dataset.del)); return; }
    const link = e.target.closest("a[data-loc]");
    if (link) {
      e.preventDefault();
      select(link.dataset.loc, true);
      return;
    }
    if (e.target.closest("input")) return;
    const tr = e.target.closest("tr[data-sku]");
    if (!tr) return;
    const r = state.alloc.results[Number(tr.dataset.sku)];
    el.search.value = r.sku.sku;
    state.search = r.sku.sku.toLowerCase();
    renderMap();
    if (r.spots.length) select(r.spots[0].label, true);
  });

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
      state.alloc = Allocate.run(state.data.skus, state.rules);
      renderKpis();
      renderMap();
      renderDetail();
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
  el.skuFilter.addEventListener("change", renderSkus);

  // A rule change re-lays the racks at once and is saved for everyone.
  let saveTimer = null;
  function ruleChanged() {
    const days = Math.round(Number(el.ruleDays.value));
    state.rules = Object.assign({}, state.rules, {
      order: el.ruleOrder.value, fill: el.ruleFill.value,
      mix: el.ruleMix.value, turn: el.ruleTurn.value,
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
  [el.ruleOrder, el.ruleFill, el.ruleMix, el.ruleTurn, el.ruleDays].forEach((s) => s.addEventListener("change", ruleChanged));

  // Reordering a tier, or taking it off the racks altogether.
  el.tierList.addEventListener("click", function (e) {
    const btn = e.target.closest("button[data-move]");
    if (!btn) return;
    const tiers = state.alloc.tiers.slice();
    const i = tiers.indexOf(btn.closest("li").dataset.tier);
    const j = i + Number(btn.dataset.move);
    if (i < 0 || j < 0 || j >= tiers.length) return;
    [tiers[i], tiers[j]] = [tiers[j], tiers[i]];
    state.rules.tiers = tiers;
    ruleChanged();
  });
  el.tierList.addEventListener("change", function (e) {
    if (e.target.type !== "checkbox") return;
    const tier = e.target.closest("li").dataset.tier;
    const skip = (state.rules.skipTiers || []).filter((t) => t !== tier);
    if (!e.target.checked) skip.push(tier);
    state.rules.skipTiers = skip;
    state.rules.tiers = state.alloc.tiers.slice();
    ruleChanged();
  });

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

  async function removeSku(index) {
    const s = state.data.skus[index];
    if (!s || !confirm("Remove " + s.sku + " (" + catName(s.category) + ")? This cannot be undone.")) return;
    failed = null;
    saving++;
    status();
    try {
      await DB.imports.removeSku(s.id);
      state.data.skus.splice(state.data.skus.indexOf(s), 1);
      if (state.selected && !state.alloc.locations.has(state.selected)) state.selected = null;
      relayout();
    } catch (err) {
      console.error(err);
      failed = "Could not remove " + s.sku + ": " + err.message;
    } finally {
      saving--;
      status();
    }
  }

  el.exportBtn.addEventListener("click", function () {
    if (!Excel.available()) { alert("The spreadsheet library did not load, so the list cannot be written."); return; }
    Excel.putAway(state.data.skus, state.alloc, state.data.import);
  });

  document.addEventListener("themechange", function () { if (state.data) renderDetail(); });

  // --- start -----------------------------------------------------------------

  async function start() {
    try {
      load(await DB.imports.latest());
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
