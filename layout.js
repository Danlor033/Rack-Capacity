// The 4KB rack floor: which shelves exist, what each is called, and which
// order to fill them in.
//
// Every row is a line of rack columns; every column has three shelves
// ("layers") stacked up from the floor. Every shelf is the same length and
// depth; Layer 3, the top, is taller than the two below it.
const Layout = (function () {
  "use strict";

  const PREFIX = "4KB";
  const SHELF = { l: 240, w: 120, h: 85 };
  const LAYERS = 3;
  // Layers whose height is not SHELF.h.
  const HEIGHTS = { 3: 140 };

  // The opening of a shelf on `layer`.
  function shelfOf(layer) {
    return HEIGHTS[layer] ? { l: SHELF.l, w: SHELF.w, h: HEIGHTS[layer] } : SHELF;
  }

  // Columns in each row, Row 1 first.
  const ROWS = [14, 9, 9, 9, 9, 9, 9, 9];

  function label(row, col, layer) {
    return PREFIX + "-" + row + "-" + col + "-" + layer;
  }

  // Every shelf, in label order: 4KB-1-1-1, 4KB-1-1-2, 4KB-1-1-3, 4KB-1-2-1 ...
  const ALL = [];
  ROWS.forEach(function (cols, r) {
    for (let c = 1; c <= cols; c++) {
      for (let layer = 1; layer <= LAYERS; layer++) {
        ALL.push({ label: label(r + 1, c, layer), row: r + 1, col: c, layer: layer });
      }
    }
  });

  // Which shelves count as the best ones, best first.
  const FILLS = {
    // The floor everywhere, then the middle shelf, then the top.
    layer: (a, b) => a.layer - b.layer || a.row - b.row || a.col - b.col,
    // Finish one row before starting the next, lowest shelves first within it.
    row: (a, b) => a.row - b.row || a.layer - b.layer || a.col - b.col,
    // Straight down the labels.
    label: (a, b) => a.row - b.row || a.col - b.col || a.layer - b.layer,
    // The highest column number first, and within a column the floor first.
    // Where several rows share a column number, Row 1 leads.
    colDesc: (a, b) => b.col - a.col || a.layer - b.layer || a.row - b.row,
  };

  function ordered(fill) {
    return ALL.slice().sort(FILLS[fill] || FILLS.layer);
  }

  return {
    PREFIX: PREFIX,
    SHELF: SHELF,
    LAYERS: LAYERS,
    shelfOf: shelfOf,
    ROWS: ROWS,
    label: label,
    all: () => ALL.slice(),
    ordered: ordered,
    count: ALL.length,
  };
})();
