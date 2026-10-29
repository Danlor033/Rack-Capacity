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
    tierList: $("tierList"), gap: $("dataGap"), gapText: $("dataGapText"), gapShow: $("dataGapShow"),
    ruleDays: $("ruleDays"), skuStatus: $("skuStatus"),
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
    el.ruleDays.value = state.rules.days;

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
        "cannot be counted and the racks have no room set aside for them. Fill it in, in the SKU list below.";
      el.gap.hidden = false;
    } else {
      el.gap.hidden = true;
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
    let html = "<thead><tr><th></th><th>SKU</th><th class=\"num\">Boxes</th>" +
      "<th class=\"num\">Qty</th><th class=\"num\">Width</th></tr></thead><tbody>";
    rec.sections.forEach(function (sec, i) {
      const s = state.data.skus[sec.sku];
      const qty = s.qtyPerBox > 0 ? fmt(sec.boxes * s.qtyPerBox) : "";
      const size = [s.length, s.width, s.height].join(" × ") + " cm";
      html += '<tr><td><span class="chip" style="background:' + colorFor(i) + '"></span></td>' +
        '<td class="sku-cell"><b>' + esc(s.sku) + '</b><span class="sub">' +
        esc([s.category, s.tier, size].filter(Boolean).join(" · ")) + "</span></td>" +
        '<td class="num">' + fmt(sec.boxes) + '</td><td class="num">' + qty + "</td>" +
        '<td class="num">' + Math.round(sec.len) + " cm</td></tr>";
    });
    const free = Layout.SHELF.l - rec.sections.reduce((n, s) => n + s.len, 0);
    html += "</tbody>";
    if (free > 0.5 && rec.sections.length && rec.sections[0].len < Layout.SHELF.l) {
      html += '<tfoot><tr><td></td><td colspan="4" class="sub">' + Math.round(free) + " cm of shelf width still free</td></tr></tfoot>";
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

  // The numbers a SKU's boxes are worked out from, editable in place.
  const EDITABLE = [
    { key: "soldPerDay", label: "Sold / day" },
    { key: "quantity", label: "Quantity" },
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

  function renderSkus() {
    const filter = el.skuFilter.value;
    // Sheet order, not priority order: a row must not jump away while
    // somebody is typing in it. The # column still gives its priority.
    const rows = state.alloc.results.slice()
      .sort((a, b) => a.index - b.index)
      .filter(function (r) {
        if (filter === "missing") return ATTENTION.indexOf(r.problem) >= 0;
        if (filter === "nocount") return r.problem === "no-count";
        if (filter === "placed") return r.placed > 0 && r.unplaced === 0;
        if (filter === "skipped") return r.problem === "skipped";
        return true;
      });

    const days = state.rules.days;
    let html = "<thead><tr><th title=\"Priority: the order shelves were handed out in\">#</th><th>Tier</th><th>Category</th><th>SKU</th>" +
      EDITABLE.map((f) => '<th class="num edit-col">' + f.label + "</th>").join("") +
      '<th class="num" title="Sold per day \u00d7 ' + days + '">Needed (' + days + " d)</th>" +
      '<th class="num" title="Needed \u00f7 Qty per box, rounded up">Boxes</th><th class="num">Placed</th>' +
      '<th class="num">No shelf</th><th class="num">Per shelf</th><th>Locations</th></tr></thead><tbody>';
    for (const r of rows) {
      const s = r.sku;
      const where = r.spots.map((p) => '<a href="#" data-loc="' + p.label + '">' + p.label + "</a>" +
        (p.boxes ? ' <span class="sub">\u00d7' + p.boxes + "</span>" : "")).join(", ");
      const attention = ATTENTION.indexOf(r.problem) >= 0;
      const note = r.problem && r.problem !== "none-needed"
        ? ' <span class="tag' + (attention ? " bad" : "") + '">' + WHY[r.problem] + "</span>" : "";
      const inputs = EDITABLE.map(function (f) {
        const v = s[f.key];
        return '<td class="num edit-col"><input class="cell-in' + (wanting(r, f.key) ? " want" : "") +
          '" type="number" min="0" step="any" inputmode="decimal" data-sku="' + r.index +
          '" data-field="' + f.key + '" value="' + (v === null || v === undefined ? "" : v) + '"></td>';
      }).join("");
      html += '<tr data-sku="' + r.index + '"' + (attention ? ' class="short"' : "") + ">" +
        '<td class="sub">' + (r.order + 1) + "</td>" +
        "<td>" + esc(s.tier) + "</td><td>" + esc(s.category) + '</td><td class="sku-name"><b>' + esc(s.sku) + "</b></td>" +
        inputs +
        '<td class="num">' + fmt(r.needed) + "</td>" +
        '<td class="num"><b>' + (r.problem === "no-count" ? "?" : fmt(r.wanted)) + "</b></td>" +
        '<td class="num">' + fmt(r.placed) + '</td><td class="num">' + (r.unplaced ? fmt(r.unplaced) : "") + "</td>" +
        '<td class="num">' + (r.perShelf ? fmt(r.perShelf) : "") + "</td>" +
        "<td>" + where + note + "</td></tr>";
    }
    if (!rows.length) html += '<tr><td colspan="16" class="sub">Nothing to show.</td></tr>';
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

  // Lay out again and redraw, putting the cursor back where it was -- the
  // table is rebuilt, so the box being typed in is a new element.
  let refreshTimer = null;
  function refresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      const a = document.activeElement;
      const keep = a && a.dataset && a.dataset.field ? { sku: a.dataset.sku, field: a.dataset.field } : null;
      recompute();
      if (keep) {
        const again = el.skuTable.querySelector('input[data-sku="' + keep.sku + '"][data-field="' + keep.field + '"]');
        if (again) { again.focus(); again.select(); }
      }
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
      DB.imports.setRules(state.data.import.id, state.rules)
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

  el.gapShow.addEventListener("click", function () {
    el.skuFilter.value = "nocount";
    renderSkus();
    el.skuTable.scrollIntoView({ block: "start", behavior: "smooth" });
  });

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
