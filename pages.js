// Which page is showing. The address keeps it (#racks, #import, #calc), so a
// bookmark or a refresh lands where you were.
const Pages = (function () {
  "use strict";

  const NAMES = ["racks", "import", "calc"];

  function show(name) {
    if (NAMES.indexOf(name) < 0) name = "racks";
    NAMES.forEach(function (n) {
      document.getElementById("page-" + n).hidden = n !== name;
    });
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("on", b.dataset.page === name));
    if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
    if (name === "racks") Dashboard.shown();
  }

  document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => show(b.dataset.page)));
  document.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => show(b.dataset.goto)));
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));

  show(location.hash.slice(1) || "racks");
  Dashboard.start();

  return { show: show };
})();
