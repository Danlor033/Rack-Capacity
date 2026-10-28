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
    detailEmpty: $("detailEmpty"), detailBody: $("detailBody"),
    dLabel: $("dLabel"), dWhere: $("dWhere"), dFill: $("dFill"), dCanvas: $("dCanvas"), dTable: $("dTable"),
    skuFilter: $("skuFilter"), skuTable: $("skuTable"),
  };

  const state = {
    data: null,        // { import, skus }
    rules: Object.assign({}, Allocate.DEFAULT_RULES),
    alloc: null,
    selected: null,    // shelf label
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

  function layerName(layer) {
    return layer === 1 ? "Layer 1 (floor)" : layer === Layout.LAYERS ? "Layer " + layer + " (top)" : "Layer " + layer;
  }

  // --- loading -------------------------------------------------------------

  function load(data) {
    state.data = data && data.skus && data.skus.length ? data : null;
    if (!state.data) {
      el.empty.hidden = false;
      el.dash.hidden = true;
      return;
    }
    el.empty.hidden = true;
    el.dash.hidden = false;
    state.rules = Object.assign({}, Allocate.DEFAULT_RULES, state.data.import.rules || {});
    el.ruleOrder.value = state.rules.order;
    el.ruleFill.value = state.rules.fill;
    el.ruleMix.value = state.rules.mix;
    el.ruleTurn.value = state.rules.turn;

    const when = new Date(state.data.import.imported_at);
    el.source.textContent = state.data.import.file_name + " · " + state.data.skus.length.toLocaleString() +
      " SKUs · imported " + when.toLocaleString();

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
    renderSkus();
  }

  function renderKpis() {
    const s = state.alloc.stats;
    const needing = state.alloc.results.filter((r) => r.wanted > 0).length;
    el.kShelves.textContent = s.shelvesUsed + " / " + s.shelves;
    el.kBoxes.textContent = s.boxesPlaced.toLocaleString() + " / " + s.boxesWanted.toLocaleString();
    el.kMiss.textContent = s.boxesUnplaced.toLocaleString();
    el.kMissWrap.classList.toggle("bad", s.boxesUnplaced > 0);
    el.kSkus.textContent = s.skusPlaced + " / " + needing;
    el.kFill.textContent = pct(s.fill);
  }

  function renderRules() {
    const pick = (sel) => sel.options[sel.selectedIndex].text;
    el.rulesSummary.textContent = "— " + [pick(el.ruleOrder), pick(el.ruleMix).toLowerCase()].join(", ");
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
        colsHtml += '<div class="col-num">' + col + "</div></div>";
      }
      html += '<div class="rack-row"><div class="rack-row-head"><b>Row ' + row + "</b>" +
        '<span class="sub">' + cols + " columns · " + used + " of " + cols * Layout.LAYERS + " shelves used</span></div>" +
        '<div class="rack-cols" style="--cols:' + cols + '"><div class="layer-axis"><span>3</span><span>2</span><span>1</span></div>' +
        colsHtml + "</div></div>";
    });
    el.map.innerHTML = html;
  }

  function renderDetail() {
    const label = state.selected;
    if (!label) {
      el.detailEmpty.hidden = false;
      el.detailBody.hidden = true;
      return;
    }
    el.detailEmpty.hidden = true;
    el.detailBody.hidden = false;

    const [, row, col, layer] = label.split("-").map(Number);
    const rec = state.alloc.locations.get(label) || null;
    el.dLabel.textContent = label;
    el.dWhere.textContent = "Row " + row + " · Column " + col + " · " + layerName(layer);
    el.dFill.textContent = rec ? pct(rec.fill) : "0%";

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
      el.dTable.innerHTML = '<tbody><tr><td class="sub">Empty shelf — nothing in the sheet needs it.</td></tr></tbody>';
      return;
    }
    let html = "<thead><tr><th></th><th>SKU</th><th>Category</th><th>Tier</th><th class=\"num\">Boxes</th>" +
      "<th class=\"num\">Qty</th><th>Box (cm)</th><th class=\"num\">Width used</th></tr></thead><tbody>";
    rec.sections.forEach(function (sec, i) {
      const s = state.data.skus[sec.sku];
      const qty = s.qtyPerBox > 0 ? fmt(sec.boxes * s.qtyPerBox) : "";
      html += '<tr><td><span class="chip" style="background:' + colorFor(i) + '"></span></td>' +
        "<td><b>" + esc(s.sku) + "</b></td><td>" + esc(s.category) + "</td><td>" + esc(s.tier) + "</td>" +
        '<td class="num">' + fmt(sec.boxes) + '</td><td class="num">' + qty + "</td>" +
        "<td>" + [s.length, s.width, s.height].join(" × ") + "</td>" +
        '<td class="num">' + Math.round(sec.len) + " cm</td></tr>";
    });
    const free = Layout.SHELF.l - rec.sections.reduce((n, s) => n + s.len, 0);
    html += "</tbody>";
    if (free > 0.5 && rec.sections.length && rec.sections[0].len < Layout.SHELF.l) {
      html += '<tfoot><tr><td></td><td colspan="7" class="sub">' + Math.round(free) + " cm of shelf width still free</td></tr></tfoot>";
    }
    el.dTable.innerHTML = html;
  }

  const WHY = {
    "too-big": "box is bigger than a shelf",
    "no-size": "box size missing",
    "no-room": "racks are full",
    "none-needed": "no boxes needed",
  };

  function renderSkus() {
    const filter = el.skuFilter.value;
    const rows = state.alloc.results.slice()
      .sort((a, b) => a.order - b.order)
      .filter(function (r) {
        if (filter === "missing") return r.unplaced > 0;
        if (filter === "placed") return r.wanted > 0 && r.unplaced === 0;
        return true;
      });

    let html = "<thead><tr><th>#</th><th>Tier</th><th>Category</th><th>SKU</th><th class=\"num\">Sold / day</th>" +
      "<th class=\"num\">Boxes</th><th class=\"num\">Placed</th><th class=\"num\">No shelf</th>" +
      "<th class=\"num\">Per shelf</th><th>Locations</th></tr></thead><tbody>";
    for (const r of rows) {
      const s = r.sku;
      const where = r.spots.map((p) => '<a href="#" data-loc="' + p.label + '">' + p.label + "</a>" +
        (p.boxes ? ' <span class="sub">×' + p.boxes + "</span>" : "")).join(", ");
      const note = r.problem && r.problem !== "none-needed" ? ' <span class="tag bad">' + WHY[r.problem] + "</span>" : "";
      html += '<tr data-sku="' + r.index + '"' + (r.unplaced > 0 ? ' class="short"' : "") + ">" +
        '<td class="sub">' + (r.order + 1) + "</td>" +
        "<td>" + esc(s.tier) + "</td><td>" + esc(s.category) + "</td><td><b>" + esc(s.sku) + "</b></td>" +
        '<td class="num">' + fmt(s.soldPerDay) + '</td><td class="num">' + fmt(r.wanted) + "</td>" +
        '<td class="num">' + fmt(r.placed) + '</td><td class="num">' + (r.unplaced ? fmt(r.unplaced) : "") + "</td>" +
        '<td class="num">' + (r.perShelf ? fmt(r.perShelf) : "") + "</td>" +
        "<td>" + where + note + "</td></tr>";
    }
    if (!rows.length) html += '<tr><td colspan="10" class="sub">Nothing to show.</td></tr>';
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

  el.skuTable.addEventListener("click", function (e) {
    const link = e.target.closest("a[data-loc]");
    if (link) {
      e.preventDefault();
      select(link.dataset.loc, true);
      return;
    }
    const tr = e.target.closest("tr[data-sku]");
    if (!tr) return;
    const r = state.alloc.results[Number(tr.dataset.sku)];
    el.search.value = r.sku.sku;
    state.search = r.sku.sku.toLowerCase();
    renderMap();
    if (r.spots.length) select(r.spots[0].label, true);
  });

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
    state.rules = {
      order: el.ruleOrder.value, fill: el.ruleFill.value,
      mix: el.ruleMix.value, turn: el.ruleTurn.value,
    };
    recompute();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      DB.imports.setRules(state.data.import.id, state.rules)
        .then(function () { state.data.import.rules = state.rules; })
        .catch(function (e) { console.error(e); alert("The new rules could not be saved: " + e.message); });
    }, 400);
  }
  [el.ruleOrder, el.ruleFill, el.ruleMix, el.ruleTurn].forEach((s) => s.addEventListener("change", ruleChanged));

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
      el.empty.querySelector("p").textContent = "The imported sheet could not be loaded: " + e.message;
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
