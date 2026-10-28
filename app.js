// Wiring: read the sizes, run the packer, say what came out of it, and keep
// the two views in step with the slider.
(function () {
  "use strict";

  const UNITS = { cm: 1, mm: 0.1, in: 2.54 };
  const $ = (id) => document.getElementById(id);

  const el = {
    unit: $("unit"),
    boxL: $("boxL"), boxW: $("boxW"), boxH: $("boxH"),
    rackL: $("rackL"), rackW: $("rackW"), rackH: $("rackH"),
    mode: $("mode"), qty: $("qty"),
    presetSel: $("presetSel"), presetSave: $("presetSave"), presetDel: $("presetDel"),
    rackSel: $("rackSel"), rackSave: $("rackSave"), rackDel: $("rackDel"),
    total: $("total"), totalWord: $("totalWord"), verdict: $("verdict"),
    fillPct: $("fillPct"), perLayer: $("perLayer"), stackHi: $("stackHi"),
    racksStat: $("racksStat"), racksNeeded: $("racksNeeded"),
    legend: $("legend"), note: $("note"), dbStatus: $("dbStatus"),
    cut: $("cut"), cutLabel: $("cutLabel"), resetView: $("resetView"),
    wrap3d: $("wrap3d"), wrap2d: $("wrap2d"), c2d: $("c2d"),
    themeBtn: $("themeBtn"), hint: $("hint"),
  };

  const state = {
    view: "3d",
    rack: { l: 240, w: 120, h: 85 },
    result: null,
    placements: [],
    view3d: null,
  };

  // --- small helpers ---------------------------------------------------------

  const unitFactor = () => UNITS[el.unit.value] || 1;
  const toCm = (value) => Number(value) * unitFactor();
  const fromCm = (value) => value / unitFactor();
  const dark = () => document.documentElement.getAttribute("data-theme") === "dark";

  function round(n, places) {
    const f = Math.pow(10, places === undefined ? 1 : places);
    return Math.round(n * f) / f;
  }

  function label(cm) {
    return round(fromCm(cm), 1) + " " + el.unit.value;
  }

  // --- the calculation -------------------------------------------------------

  function compute() {
    const rack = { l: toCm(el.rackL.value), w: toCm(el.rackW.value), h: toCm(el.rackH.value) };
    const box = { l: toCm(el.boxL.value), w: toCm(el.boxW.value), h: toCm(el.boxH.value) };
    state.rack = rack;

    const bad = [rack.l, rack.w, rack.h, box.l, box.w, box.h].some((n) => !(n > 0));
    if (bad) {
      state.result = null;
      state.placements = [];
      el.total.textContent = "—";
      el.totalWord.textContent = "";
      el.verdict.textContent = "Fill in every size to see the count.";
      el.verdict.classList.remove("bad");
      el.fillPct.textContent = el.perLayer.textContent = el.stackHi.textContent = "—";
      el.legend.innerHTML = "";
      el.note.hidden = true;
      el.racksStat.hidden = true;
      draw();
      return;
    }

    const result = Packer.pack(rack, box, el.mode.value);
    state.result = result;
    state.placements = Packer.placements(result.blocks, View3D.max);
    report(result, rack, box);
    el.cut.value = el.cut.max;
    draw();
  }

  function report(result, rack, box) {
    el.total.textContent = result.count.toLocaleString();
    el.totalWord.textContent = result.count === 1 ? "box fits" : "boxes fit";

    if (!result.fits) {
      const smallestBox = Math.min(box.l, box.w, box.h);
      const smallestRack = Math.min(rack.l, rack.w, rack.h);
      const why = smallestBox > smallestRack
        ? " — even its thinnest side is wider than the rack's smallest opening."
        : " — no way of turning it clears every side.";
      el.verdict.textContent = "This box does not fit in the rack" + why;
      el.verdict.classList.add("bad");
    } else {
      el.verdict.classList.remove("bad");
      el.verdict.textContent = result.byOrientation.length > 1
        ? "Best fit mixes " + result.byOrientation.length + " orientations."
        : "All boxes sit the same way up.";
    }

    el.fillPct.textContent = Math.round(result.utilization * 100) + "%";

    el.perLayer.textContent = Packer.onFloor(result.blocks).toLocaleString();
    el.stackHi.textContent = result.usedHeight ? label(result.usedHeight) : "—";

    const want = parseInt(el.qty.value, 10);
    if (want > 0 && result.count > 0) {
      el.racksStat.hidden = false;
      el.racksNeeded.textContent = Math.ceil(want / result.count).toLocaleString();
    } else {
      el.racksStat.hidden = true;
    }

    el.legend.innerHTML = "";
    for (const o of result.byOrientation) {
      const item = document.createElement("div");
      item.className = "item";
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.style.background = View3D.colors[o.index % View3D.colors.length];
      const text = document.createElement("span");
      const dims = o.dims.map((d) => round(fromCm(d), 1)).join(" × ");
      text.innerHTML = "<b>" + o.count.toLocaleString() + "</b> at " + dims + " " + el.unit.value;
      item.appendChild(chip);
      item.appendChild(text);
      el.legend.appendChild(item);
    }

    const notes = [];
    if (result.count > View3D.max) {
      notes.push("The drawing shows the first " + View3D.max.toLocaleString() +
        " boxes; the count above is the full figure.");
    }
    const gap = rack.h - result.usedHeight;
    if (result.fits && gap > 0.5) notes.push(label(gap) + " of height is left unused at the top.");
    el.note.hidden = notes.length === 0;
    el.note.textContent = notes.join(" ");
  }

  // --- the two views ---------------------------------------------------------

  function cutHeight() {
    const pct = Number(el.cut.value) / Number(el.cut.max);
    return state.rack.h * pct;
  }

  function draw() {
    const cut = cutHeight();
    const atTop = Number(el.cut.value) >= Number(el.cut.max);

    if (state.view === "3d") {
      el.cutLabel.textContent = atTop ? "Show all" : "Up to " + label(cut);
      // A box counts as placed once its base is below the cut, so a layer
      // taller than the cut still shows instead of leaving the rack empty.
      const shown = atTop ? state.placements : state.placements.filter((p) => p.z < cut - 1e-6);
      if (state.view3d) state.view3d.show(state.rack, shown, dark());
    } else {
      const h = atTop ? Math.max(0, state.rack.h - 0.01) : cut;
      el.cutLabel.textContent = "Cut at " + label(h);
      const blocks = state.result ? state.result.blocks : [];
      View2D.show(el.c2d, state.rack, Packer.slice(blocks, h), dark(), View3D.colors);
    }
  }

  function setView(name) {
    state.view = name;
    document.querySelectorAll("#page-calc .tab").forEach((t) => t.classList.toggle("on", t.dataset.view === name));
    el.wrap3d.hidden = name !== "3d";
    el.wrap2d.hidden = name !== "2d";
    el.hint.textContent = name === "3d"
      ? "Drag to turn · scroll to zoom · shift-drag to slide"
      : "The rack from above, cut through at the slider's height.";
    if (name === "3d" && state.view3d) state.view3d.redraw();
    draw();
  }

  // --- saved racks and box sizes --------------------------------------------

  function warn(e) {
    console.error(e);
    el.dbStatus.textContent = "Saved lists unavailable — " + e.message;
  }

  async function loadRacks(selectId) {
    let rows = [];
    try { rows = await DB.racks.list(); } catch (e) { warn(e); }
    el.rackSel.innerHTML = "";
    for (const r of rows) {
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = r.name + " — " + r.length_cm + "×" + r.width_cm + "×" + r.height_cm;
      opt.dataset.l = r.length_cm; opt.dataset.w = r.width_cm; opt.dataset.h = r.height_cm;
      el.rackSel.appendChild(opt);
    }
    const custom = document.createElement("option");
    custom.value = "custom";
    custom.textContent = "Custom size…";
    el.rackSel.appendChild(custom);

    const pick = selectId && [...el.rackSel.options].some((o) => o.value === selectId)
      ? selectId
      : rows.length ? rows[0].id : "custom";
    el.rackSel.value = pick;
    applyRack();
  }

  function applyRack() {
    const opt = el.rackSel.selectedOptions[0];
    if (!opt || opt.value === "custom") return;
    el.rackL.value = round(fromCm(Number(opt.dataset.l)), 2);
    el.rackW.value = round(fromCm(Number(opt.dataset.w)), 2);
    el.rackH.value = round(fromCm(Number(opt.dataset.h)), 2);
    compute();
  }

  async function loadPresets(selectId) {
    let rows = [];
    try { rows = await DB.presets.list(); } catch (e) { warn(e); }
    el.presetSel.innerHTML = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = rows.length ? "— pick a saved size —" : "— nothing saved yet —";
    el.presetSel.appendChild(none);
    for (const p of rows) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name + " — " + p.length_cm + "×" + p.width_cm + "×" + p.height_cm;
      opt.dataset.l = p.length_cm; opt.dataset.w = p.width_cm; opt.dataset.h = p.height_cm;
      el.presetSel.appendChild(opt);
    }
    if (selectId) el.presetSel.value = selectId;
  }

  // --- events ----------------------------------------------------------------

  let timer = null;
  function later() {
    clearTimeout(timer);
    timer = setTimeout(compute, 140);
  }

  [el.boxL, el.boxW, el.boxH].forEach((i) => i.addEventListener("input", later));
  [el.rackL, el.rackW, el.rackH].forEach((i) => i.addEventListener("input", function () {
    el.rackSel.value = "custom";
    later();
  }));
  el.mode.addEventListener("change", compute);
  el.qty.addEventListener("input", later);
  el.rackSel.addEventListener("change", applyRack);

  // Switching unit keeps the numbers meaning the same thing: 240 cm becomes
  // 2400 mm, not 240 mm.
  el.unit.dataset.was = "cm";
  el.unit.addEventListener("change", function () {
    const was = UNITS[el.unit.dataset.was] || 1;
    const now = unitFactor();
    [el.boxL, el.boxW, el.boxH, el.rackL, el.rackW, el.rackH].forEach(function (input) {
      if (input.value !== "") input.value = round((Number(input.value) * was) / now, 2);
    });
    el.unit.dataset.was = el.unit.value;
    compute();
  });

  el.presetSel.addEventListener("change", function () {
    const opt = el.presetSel.selectedOptions[0];
    if (!opt || !opt.value) return;
    el.boxL.value = round(fromCm(Number(opt.dataset.l)), 2);
    el.boxW.value = round(fromCm(Number(opt.dataset.w)), 2);
    el.boxH.value = round(fromCm(Number(opt.dataset.h)), 2);
    compute();
  });

  el.presetSave.addEventListener("click", async function () {
    const name = prompt("Name this box size");
    if (!name) return;
    try {
      const saved = await DB.presets.create({
        name: name.trim(),
        length_cm: round(toCm(el.boxL.value), 2),
        width_cm: round(toCm(el.boxW.value), 2),
        height_cm: round(toCm(el.boxH.value), 2),
      });
      await loadPresets(saved.id);
    } catch (e) { warn(e); }
  });

  el.presetDel.addEventListener("click", async function () {
    const opt = el.presetSel.selectedOptions[0];
    if (!opt || !opt.value) return;
    if (!confirm("Delete “" + opt.textContent + "”?")) return;
    try { await DB.presets.remove(opt.value); await loadPresets(); } catch (e) { warn(e); }
  });

  el.rackSave.addEventListener("click", async function () {
    const name = prompt("Name this rack");
    if (!name) return;
    try {
      const saved = await DB.racks.create({
        name: name.trim(),
        length_cm: round(toCm(el.rackL.value), 2),
        width_cm: round(toCm(el.rackW.value), 2),
        height_cm: round(toCm(el.rackH.value), 2),
        is_default: false,
      });
      await loadRacks(saved.id);
    } catch (e) { warn(e); }
  });

  el.rackDel.addEventListener("click", async function () {
    const opt = el.rackSel.selectedOptions[0];
    if (!opt || opt.value === "custom") return;
    if (!confirm("Delete “" + opt.textContent + "”?")) return;
    try { await DB.racks.remove(opt.value); await loadRacks(); } catch (e) { warn(e); }
  });

  el.cut.addEventListener("input", draw);
  el.resetView.addEventListener("click", function () { if (state.view3d) state.view3d.frame(state.rack); });
  document.querySelectorAll("#page-calc .tab").forEach(function (t) {
    t.addEventListener("click", function () { setView(t.dataset.view); });
  });

  el.themeBtn.addEventListener("click", function () {
    const next = dark() ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("rackPlanner.theme", next); } catch (e) { /* ignore */ }
    el.themeBtn.textContent = next === "dark" ? "Light" : "Dark";
    draw();
    // Anything else drawn on a canvas picks its colours from the theme too.
    document.dispatchEvent(new CustomEvent("themechange"));
  });

  // --- start -----------------------------------------------------------------

  (function start() {
    let theme = null;
    try { theme = localStorage.getItem("rackPlanner.theme"); } catch (e) { /* ignore */ }
    if (!theme && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      theme = "dark";
    }
    document.documentElement.setAttribute("data-theme", theme || "light");
    el.themeBtn.textContent = theme === "dark" ? "Light" : "Dark";

    el.dbStatus.textContent = DB.configured()
      ? "Racks and box sizes shared through Supabase"
      : "Racks and box sizes saved in this browser";

    if (View3D.available()) {
      state.view3d = View3D.create(document.getElementById("c3d"));
      state.view3d.frame(state.rack);
    } else {
      el.wrap3d.innerHTML =
        "<p class='fallback'>The 3D view needs three.js, which did not load. The plan view still works.</p>";
      setView("2d");
    }

    loadRacks().then(loadPresets).then(compute);
    window.addEventListener("resize", function () { if (state.view === "2d") draw(); });
  })();
})();
