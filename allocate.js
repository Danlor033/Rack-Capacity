// Deciding what goes where: which SKU sits on which shelf, and how many of
// its boxes.
//
// SKUs are taken in priority order, and each takes the best shelves still
// free. A SKU first claims as many whole shelves as its boxes can fill. What
// is left over gets a section of a shelf -- a slice running front to back,
// the full height, only as wide as those boxes need -- and sections from
// different SKUs sit side by side along the shelf. Nothing is ever stacked
// on or hidden behind another SKU, so every SKU on a shelf faces the aisle.
const Allocate = (function () {
  "use strict";

  const EPS = 1e-6;

  const DEFAULT_RULES = {
    mix: "category", // "category" | "one" | "any"
    order: "tier",   // "tier" | "category" | "sales"
    fill: "layer",   // see Layout
    turn: "any",     // "any" | "upright"
  };

  function text(v) {
    return v === null || v === undefined ? "" : String(v).trim();
  }

  // Blank sorts last; "Tier 2" before "Tier 10".
  function compareText(a, b) {
    const x = text(a), y = text(b);
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
  }

  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);

  const ORDERS = {
    tier: (a, b) =>
      compareText(a.tier, b.tier) || num(b.soldPerDay) - num(a.soldPerDay) || compareText(a.sku, b.sku),
    category: (a, b) =>
      compareText(a.category, b.category) || compareText(a.tier, b.tier) ||
      num(b.soldPerDay) - num(a.soldPerDay) || compareText(a.sku, b.sku),
    sales: (a, b) =>
      num(b.soldPerDay) - num(a.soldPerDay) || compareText(a.tier, b.tier) || compareText(a.sku, b.sku),
  };

  // How many boxes a SKU needs room for. The sheet's own total wins; failing
  // that, what fifteen days of sales come to in boxes.
  function boxesWanted(s) {
    if (num(s.totalBoxes) > 0) return Math.ceil(s.totalBoxes - EPS);
    const perBox = num(s.qtyPerBox);
    if (perBox <= 0) return 0;
    const needed = num(s.neededQty) > 0 ? s.neededQty : num(s.soldPerDay) * 15;
    return Math.max(0, Math.ceil(needed / perBox - EPS));
  }

  function hasSize(s) {
    return num(s.length) > 0 && num(s.width) > 0 && num(s.height) > 0;
  }

  function boxOf(s) {
    return { l: s.length, w: s.width, h: s.height };
  }

  function run(skus, rulesIn) {
    const rules = Object.assign({}, DEFAULT_RULES, rulesIn || {});
    const shelf = Layout.SHELF;
    const queue = Layout.ordered(rules.fill);
    let next = 0;

    const locations = new Map(); // label -> shelf record, for every shelf in use
    const open = [];             // shelves with room left for another section

    // Packing the same box into the same space comes up again and again.
    const cache = new Map();
    function packIn(length, box) {
      const key = length.toFixed(3) + "|" + box.l + "|" + box.w + "|" + box.h;
      let hit = cache.get(key);
      if (!hit) {
        hit = Packer.pack({ l: length, w: shelf.w, h: shelf.h }, box, rules.turn);
        cache.set(key, hit);
      }
      return hit;
    }

    function extent(result) {
      let x = 0;
      for (const b of result.blocks) x = Math.max(x, b.x + b.nx * b.l);
      return x;
    }

    // The narrowest slice of shelf that still holds `count` boxes.
    function slice(count, box) {
      let lo = 1, hi = Math.ceil(shelf.l);
      if (packIn(hi, box).count < count) return null;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (packIn(mid, box).count >= count) hi = mid; else lo = mid + 1;
      }
      const packed = packIn(lo, box);
      return { packLen: lo, len: Math.min(lo, extent(packed)) };
    }

    function takeShelf(category) {
      if (next >= queue.length) return null;
      const spot = queue[next++];
      const rec = {
        label: spot.label, row: spot.row, col: spot.col, layer: spot.layer,
        sections: [], free: shelf.l, category: category,
      };
      locations.set(rec.label, rec);
      return rec;
    }

    const results = skus.map(function (s, i) {
      return {
        index: i, sku: s, wanted: boxesWanted(s), placed: 0, unplaced: 0,
        perShelf: 0, spots: [], problem: null,
      };
    });

    const order = results.slice().sort((a, b) => (ORDERS[rules.order] || ORDERS.tier)(a.sku, b.sku));
    order.forEach((r, i) => { r.order = i; });

    for (const r of order) {
      const s = r.sku;
      if (r.wanted <= 0) { r.problem = "none-needed"; continue; }
      if (!hasSize(s)) { r.problem = "no-size"; r.unplaced = r.wanted; continue; }

      const box = boxOf(s);
      const whole = packIn(shelf.l, box);
      r.perShelf = whole.count;
      if (!whole.count) { r.problem = "too-big"; r.unplaced = r.wanted; continue; }

      const category = text(s.category).toLowerCase();
      let left = r.wanted;

      // Whole shelves, as many as the boxes fill.
      while (left >= whole.count) {
        const rec = takeShelf(category);
        if (!rec) break;
        rec.sections.push({ sku: r.index, x: 0, len: shelf.l, packLen: shelf.l, boxes: whole.count });
        rec.free = 0;
        r.spots.push({ label: rec.label, boxes: whole.count });
        left -= whole.count;
      }

      // The remainder.
      if (left > 0 && left < whole.count) {
        if (rules.mix === "one") {
          const rec = takeShelf(category);
          if (rec) {
            rec.sections.push({ sku: r.index, x: 0, len: shelf.l, packLen: shelf.l, boxes: left });
            rec.free = 0;
            r.spots.push({ label: rec.label, boxes: left });
            left = 0;
          }
        } else {
          const cut = slice(left, box);
          if (cut) {
            let rec = open.find((o) => o.free >= cut.len - EPS &&
              (rules.mix === "any" || o.category === category));
            if (!rec) {
              rec = takeShelf(category);
              if (rec) open.push(rec);
            }
            if (rec) {
              rec.sections.push({ sku: r.index, x: shelf.l - rec.free, len: cut.len, packLen: cut.packLen, boxes: left });
              rec.free -= cut.len;
              r.spots.push({ label: rec.label, boxes: left });
              left = 0;
            }
          }
        }
      }

      r.placed = r.wanted - left;
      r.unplaced = left;
      if (left > 0) r.problem = "no-room";
    }

    // Totals.
    const shelfVolume = shelf.l * shelf.w * shelf.h;
    let boxVolume = 0;
    for (const rec of locations.values()) {
      let v = 0;
      for (const sec of rec.sections) {
        const s = skus[sec.sku];
        v += sec.boxes * s.length * s.width * s.height;
      }
      rec.volume = v;
      rec.fill = v / shelfVolume;
      boxVolume += v;
    }

    const stats = {
      shelves: Layout.count,
      shelvesUsed: locations.size,
      skus: skus.length,
      skusPlaced: results.filter((r) => r.wanted > 0 && r.unplaced === 0 && r.placed > 0).length,
      boxesWanted: results.reduce((n, r) => n + (r.problem === "none-needed" ? 0 : r.wanted), 0),
      boxesPlaced: results.reduce((n, r) => n + r.placed, 0),
      boxesUnplaced: results.reduce((n, r) => n + r.unplaced, 0),
      fill: boxVolume / (shelfVolume * Layout.count),
    };

    return { rules: rules, locations: locations, results: results, stats: stats, packIn: packIn };
  }

  // Every box on one shelf, positioned for drawing. Within a section the
  // boxes go in from the floor up, so a part-full section looks the way it
  // would on the day.
  function placementsOn(rec, skus, allocation) {
    const out = [];
    rec.sections.forEach(function (sec, i) {
      const s = skus[sec.sku];
      const packed = allocation.packIn(sec.packLen, boxOf(s));
      const all = Packer.placements(packed.blocks)
        .sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x)
        .slice(0, sec.boxes);
      for (const p of all) {
        p.x += sec.x;
        p.section = i;
        out.push(p);
      }
    });
    return out;
  }

  return {
    run: run,
    placementsOn: placementsOn,
    boxesWanted: boxesWanted,
    compareText: compareText,
    DEFAULT_RULES: DEFAULT_RULES,
  };
})();
