// What sits where: every shelf a SKU has been given by hand, and how many of
// its boxes each one holds.
//
// Shelves are chosen on the dashboard, and several SKUs may share one. The
// choices are worked through in the order they were made: each SKU puts as
// many of its remaining boxes on the shelf as fit in the room still free
// there, in a slice running front to back, the full height, only as wide as
// those boxes need. A later SKU on the same shelf gets the slice beside it.
// Boxes left over have no shelf yet. Nothing is placed automatically.
const Allocate = (function () {
  "use strict";

  const EPS = 1e-6;

  const DEFAULT_RULES = {
    turn: "any",     // "any" | "upright"
    days: 15,        // days of sales 4KB holds stock for
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

  // Tier names are words, not letters -- "Tier 1", "GWP", "New SKU",
  // "Discontinue" -- so alphabetical order would put Discontinue first.
  // Numbered tiers lead, then gift and new lines, then anything
  // unrecognised, and discontinued lines last.
  function defaultRank(name) {
    const t = text(name).toLowerCase();
    if (!t) return 1000;
    const n = t.match(/^tier\s*(\d+)/);
    if (n) return 10 + Number(n[1]);
    if (/gwp|gift/.test(t)) return 200;
    if (/new/.test(t)) return 300;
    if (/discon|phase.?out|end.?of.?life|\beol\b/.test(t)) return 900;
    return 500;
  }

  // Every tier in the list, best first: the saved order where there is one,
  // and the default ranking for any tier it does not mention.
  function tierOrder(skus, saved) {
    const present = [...new Set(skus.map((s) => text(s.tier)))];
    const known = (saved || []).filter((t) => present.indexOf(t) >= 0);
    const rest = present.filter((t) => known.indexOf(t) < 0)
      .sort((a, b) => defaultRank(a) - defaultRank(b) || compareText(a, b));
    return known.concat(rest);
  }

  // What 4KB has to hold for a SKU: enough to sell from for `days` days.
  function neededQty(s, days) {
    return num(s.soldPerDay) * days;
  }

  // How many boxes that comes to, or null when it cannot be known because
  // nobody has said how many units a box holds. Rounded up: a part-full
  // carton still takes a whole carton's room on the shelf.
  function boxesWanted(s, days) {
    const needed = neededQty(s, days);
    const perBox = num(s.qtyPerBox);
    if (perBox <= 0) return needed > 0 ? null : 0;
    return Math.max(0, Math.ceil(needed / perBox - EPS));
  }

  // The boxes 4KB actually has for a SKU: its 4KB Qty in boxes, rounded up.
  // These are what go on shelves, so No shelf counts down from here. Null
  // when there is stock but no Qty per box.
  function stockBoxes(s) {
    const qty = num(s.quantity);
    const perBox = num(s.qtyPerBox);
    if (perBox <= 0) return qty > 0 ? null : 0;
    return Math.max(0, Math.ceil(qty / perBox - EPS));
  }

  function hasSize(s) {
    return num(s.length) > 0 && num(s.width) > 0 && num(s.height) > 0;
  }

  function boxOf(s) {
    return { l: s.length, w: s.width, h: s.height };
  }

  // skus: the list. shelves: [{ label, sku }] -- sku being the SKU's id --
  // in the order the shelves were given. One entry per SKU on a shelf.
  function place(skus, shelves, rulesIn) {
    const rules = Object.assign({}, DEFAULT_RULES, rulesIn || {});
    const shelf = Layout.SHELF;
    const days = num(rules.days) > 0 ? rules.days : DEFAULT_RULES.days;
    rules.days = days;

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

    const spotOf = new Map(Layout.all().map((s) => [s.label, s]));
    const results = skus.map(function (s, i) {
      const wanted = boxesWanted(s, days);
      const stock = stockBoxes(s);
      return {
        index: i, order: i, sku: s, needed: neededQty(s, days),
        wanted: wanted === null ? 0 : wanted, stock: stock === null ? 0 : stock,
        counted: stock !== null && wanted !== null, placed: 0, unplaced: 0,
        perShelf: 0, spots: [], problem: null,
      };
    });
    function extent(result) {
      let x = 0;
      for (const b of result.blocks) x = Math.max(x, b.x + b.nx * b.l);
      return x;
    }

    // The narrowest slice of shelf that still holds `count` boxes.
    function slice(count, box) {
      let lo = 1, hi = Math.ceil(shelf.l);
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (packIn(mid, box).count >= count) hi = mid; else lo = mid + 1;
      }
      return { packLen: lo, len: Math.min(lo, extent(packIn(lo, box))) };
    }

    const byId = new Map(results.map((r) => [String(r.sku.id), r]));
    const left = new Map(results.map((r) => [r, r.counted ? r.stock : 0]));
    for (const r of results) r.perShelf = hasSize(r.sku) ? packIn(shelf.l, boxOf(r.sku)).count : 0;

    const locations = new Map();
    const seen = new Set();
    for (const a of shelves) {
      const r = byId.get(String(a.sku));
      const spot = spotOf.get(a.label);
      if (!r || !spot || seen.has(a.label + "|" + r.index)) continue;
      seen.add(a.label + "|" + r.index);
      let rec = locations.get(a.label);
      if (!rec) {
        rec = {
          label: a.label, row: spot.row, col: spot.col, layer: spot.layer,
          sections: [], free: shelf.l, category: text(r.sku.category).toLowerCase(),
        };
        locations.set(a.label, rec);
      }
      // As many of the SKU's remaining boxes as fit in the room still free.
      const s = r.sku;
      let boxes = 0, cut = { len: 0, packLen: 0 };
      if (left.get(r) > 0 && r.perShelf && rec.free > 1) {
        boxes = Math.min(left.get(r), packIn(Math.floor(rec.free + EPS), boxOf(s)).count);
        if (boxes) cut = slice(boxes, boxOf(s));
      }
      rec.sections.push({ sku: r.index, x: shelf.l - rec.free, len: cut.len, packLen: cut.packLen, boxes: boxes });
      rec.free -= cut.len;
      left.set(r, left.get(r) - boxes);
      r.spots.push({ label: a.label, boxes: boxes });
    }

    for (const r of results) {
      const s = r.sku;
      const remaining = left.get(r);
      r.placed = (r.counted ? r.stock : 0) - remaining;
      r.unplaced = remaining;
      if (!r.counted) r.problem = "no-count";
      else if (r.stock <= 0) r.problem = "no-stock";
      else if (!hasSize(s)) r.problem = "no-size";
      else if (!r.perShelf) r.problem = "too-big";
      else if (remaining > 0) r.problem = r.spots.length ? "short" : "no-location";
    }

    // Totals.
    const shelfVolume = shelf.l * shelf.w * shelf.h;
    let boxVolume = 0;
    for (const rec of locations.values()) {
      let v = 0;
      for (const sec of rec.sections) {
        const s = skus[sec.sku];
        if (sec.boxes && hasSize(s)) v += sec.boxes * s.length * s.width * s.height;
      }
      rec.volume = v;
      rec.fill = v / shelfVolume;
      boxVolume += v;
    }

    const counted = results.filter((r) => r.counted);
    const stats = {
      shelves: Layout.count,
      shelvesUsed: locations.size,
      skus: skus.length,
      skusNeeding: counted.filter((r) => r.stock > 0).length,
      skusPlaced: counted.filter((r) => r.stock > 0 && r.unplaced === 0 && r.placed > 0).length,
      skusNoCount: results.filter((r) => r.problem === "no-count").length,
      boxesWanted: counted.reduce((n, r) => n + r.wanted, 0),
      boxesStock: counted.reduce((n, r) => n + r.stock, 0),
      boxesPlaced: results.reduce((n, r) => n + r.placed, 0),
      boxesUnplaced: results.reduce((n, r) => n + r.unplaced, 0),
      fill: boxVolume / (shelfVolume * Layout.count),
    };

    return {
      rules: rules, tiers: tierOrder(skus, rules.tiers), locations: locations,
      results: results, stats: stats, packIn: packIn,
    };
  }

  // Every box on one shelf, positioned for drawing. The boxes go in from the
  // floor up, so a part-full shelf looks the way it would on the day.
  function placementsOn(rec, skus, allocation) {
    const out = [];
    rec.sections.forEach(function (sec, i) {
      const s = skus[sec.sku];
      if (!sec.boxes || !hasSize(s)) return;
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
    place: place,
    placementsOn: placementsOn,
    boxesWanted: boxesWanted,
    stockBoxes: stockBoxes,
    neededQty: neededQty,
    tierOrder: tierOrder,
    compareText: compareText,
    hasSize: hasSize,
    DEFAULT_RULES: DEFAULT_RULES,
  };
})();
