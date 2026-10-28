// The import page: read a sheet, show what was understood and what was not,
// and only then make it the sheet everybody's racks are laid out from.
const Importer = (function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = {
    input: $("fileInput"), drop: $("drop"), expect: $("expectCols"),
    result: $("importResult"), summary: $("importSummary"), notes: $("importNotes"),
    preview: $("importPreview"), use: $("importUse"), cancel: $("importCancel"),
  };

  let parsed = null;

  function esc(v) {
    return String(v === null || v === undefined ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  const fmt = (n) => (n === null || n === undefined || n === "" ? "" : Number(n).toLocaleString());

  el.expect.innerHTML = Excel.FIELDS.map((f) =>
    '<span class="colname' + (f.required ? " req" : "") + '">' + esc(f.label) + "</span>").join(" ");

  async function read(file) {
    parsed = null;
    el.result.hidden = false;
    el.notes.innerHTML = "";
    el.preview.innerHTML = "";
    el.use.disabled = true;

    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      el.summary.innerHTML = '<p class="bad-text"><b>' + esc(file.name) + "</b> is not an Excel file (.xls or .xlsx).</p>";
      return;
    }
    if (!Excel.available()) {
      el.summary.innerHTML = '<p class="bad-text">The spreadsheet library did not load. Check the connection and reload the page.</p>';
      return;
    }

    el.summary.innerHTML = '<p class="sub">Reading ' + esc(file.name) + "…</p>";
    try {
      parsed = Excel.parse(await file.arrayBuffer(), file.name);
    } catch (e) {
      console.error(e);
      el.summary.innerHTML = '<p class="bad-text">Could not read <b>' + esc(file.name) + "</b>: " + esc(e.message) + "</p>";
      return;
    }
    show();
  }

  function show() {
    if (!parsed.ok) {
      let html = '<p class="bad-text">' + esc(parsed.error) + "</p>";
      if (parsed.map) html += columnsHtml();
      el.summary.innerHTML = html;
      return;
    }

    // Lay it out with the rules already in use, as a preview of the result.
    const trial = Allocate.run(parsed.skus, Dashboard.rules());
    const st = trial.stats;

    let html = "<h3>" + esc(parsed.fileName) + "</h3>" +
      '<p class="sub">Sheet “' + esc(parsed.sheetName) + "”, headers on row " + parsed.headerRow + "</p>" +
      '<div class="kpis compact">' +
      '<div class="kpi"><span>' + parsed.skus.length.toLocaleString() + "</span><label>SKUs</label></div>" +
      '<div class="kpi"><span>' + st.boxesWanted.toLocaleString() + "</span><label>boxes to place</label></div>" +
      '<div class="kpi"><span>' + st.shelvesUsed + " / " + st.shelves + "</span><label>shelves it needs</label></div>" +
      '<div class="kpi' + (st.boxesUnplaced ? " bad" : "") + '"><span>' + st.boxesUnplaced.toLocaleString() +
      "</span><label>boxes with no shelf</label></div>" +
      "</div>" + columnsHtml();
    el.summary.innerHTML = html;

    if (parsed.notes.length) {
      const shown = parsed.notes.slice(0, 40);
      el.notes.innerHTML = '<details class="notes"' + (parsed.notes.length <= 8 ? " open" : "") + "><summary>" +
        parsed.notes.length + " thing" + (parsed.notes.length === 1 ? "" : "s") + " to check</summary><ul>" +
        shown.map((n) => "<li>" + (n.line ? "Row " + n.line + ": " : "") + (n.sku ? "<b>" + esc(n.sku) + "</b> — " : "") +
          esc(n.text) + "</li>").join("") +
        (parsed.notes.length > shown.length ? "<li>…and " + (parsed.notes.length - shown.length) + " more</li>" : "") +
        "</ul></details>";
    }

    const head = Excel.FIELDS.map((f) => "<th" + (f.number ? ' class="num"' : "") + ">" + esc(f.label) + "</th>").join("");
    let rows = "";
    for (const s of parsed.skus.slice(0, 20)) {
      rows += "<tr>" + Excel.FIELDS.map((f) => "<td" + (f.number ? ' class="num"' : "") + ">" +
        esc(f.number ? fmt(s[f.key]) : s[f.key]) + "</td>").join("") + "</tr>";
    }
    el.preview.innerHTML = "<caption>First " + Math.min(20, parsed.skus.length) + " of " +
      parsed.skus.length.toLocaleString() + " rows</caption><thead><tr>" + head + "</tr></thead><tbody>" + rows + "</tbody>";

    el.use.disabled = false;
  }

  // Which header in the file went to which field, so a wrong guess is visible.
  function columnsHtml() {
    const headers = parsed.headers || [];
    return '<div class="colmap">' + Excel.FIELDS.map(function (f) {
      const col = parsed.map[f.key];
      if (col === undefined) {
        return '<span class="colname missing' + (f.required ? " req" : "") + '" title="Not found in the sheet">' +
          esc(f.label) + "</span>";
      }
      const from = headers[col] || "";
      const same = from.trim().toLowerCase() === f.label.toLowerCase();
      return '<span class="colname found" title="Column ' + (col + 1) + '">' + esc(f.label) +
        (same ? "" : ' <em>← “' + esc(from) + "”</em>") + "</span>";
    }).join(" ") + "</div>";
  }

  el.use.addEventListener("click", async function () {
    if (!parsed || !parsed.ok) return;
    const now = Dashboard.current();
    if (now && !confirm("This replaces “" + now.import.file_name + "” (" + now.skus.length +
      " SKUs) for everyone who opens the racks. Go ahead?")) return;

    el.use.disabled = true;
    const label = el.use.textContent;
    el.use.textContent = "Saving…";
    try {
      const saved = await DB.imports.save(parsed.fileName, parsed.skus, Dashboard.rules());
      Dashboard.load(saved);
      reset();
      Pages.show("racks");
    } catch (e) {
      console.error(e);
      alert("The sheet could not be saved: " + e.message);
      el.use.disabled = false;
    } finally {
      el.use.textContent = label;
    }
  });

  function reset() {
    parsed = null;
    el.input.value = "";
    el.result.hidden = true;
  }

  el.cancel.addEventListener("click", function () { reset(); el.input.click(); });
  el.input.addEventListener("change", function () { if (el.input.files[0]) read(el.input.files[0]); });

  ["dragenter", "dragover"].forEach((t) => el.drop.addEventListener(t, function (e) {
    e.preventDefault();
    el.drop.classList.add("over");
  }));
  ["dragleave", "drop"].forEach((t) => el.drop.addEventListener(t, function () { el.drop.classList.remove("over"); }));
  el.drop.addEventListener("drop", function (e) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) read(f);
  });

  document.querySelectorAll("[data-template]").forEach((b) => b.addEventListener("click", function () {
    if (Excel.available()) Excel.template();
    else alert("The spreadsheet library did not load.");
  }));

  return { read: read };
})();
