// Deciding what goes where: which SKU sits on which shelf, and how many of
// its boxes.
//
// SKUs are taken in priority order, and each takes the best shelves still
// free. A SKU first claims as many whole shelves as its boxes can fill. What
// is left over gets a section of a shelf -- a slice running front to back,
// the full height, only as wide as those boxes need -- and sections from
// different SKUs sit side by side along the shelf. Nothing is ever stacked
// on or hidden behind another SKU, so every SKU on a shelf faces the aisle.
//
// Ordered by category, each category also gets rows of its own: the one
// with the most SKUs starts on Row 1, each next one on a fresh row, and a
// category carries on into the next free row only if it needs more. Once
// every row is taken, the categories left over share the row of the
// category with the fewest SKUs (then the next fewest, as rows fill up).
const Allocate = (function () {
  "use strict";

  const EPS = 1e-6;

  const DEFAULT_RULES = {
    mix: "category", // "category" | "one" | "any"
    order: "tier",   // "tier" | "category" | "sales"
    fill: "layer",   // see Layout
    turn: "any",     // "any" | "upright"
    tiers: null,     // tier names, best first; null = tierDefaults()
    skipTiers: [],   // tiers that get no shelf at all
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
  // "Discontinue" -- so alphabetical order would put Discontinue first. Until
  // somebody sets an order on the dashboard, numbered tiers lead, then gift
  // and new lines, then anything unrecognised, and discontinued lines last.
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

  // Every tier in the sheet, best first: the saved order where there is one,
  // and the default ranking for any tier it does not mention.
  function tierOrder(skus, saved) {
    const present = [...new Set(skus.map((s) => text(s.tier)))];
    const known = (saved || []).filter((t) => present.indexOf(t) >= 0);
    const rest = present.filter((t) => known.indexOf(t) < 0)
      .sort((a, b) => defaultRank(a) - defaultRank(b) || compareText(a, b));
    return known.concat(rest);
  }

  // categorySold / categorySkus: each category's total sold per day and
  // number of SKUs, for ranking whole categories against each other.
  function makeOrders(rank, categorySold, categorySkus) {
    const tier = (a, b) => rank(a.tier) - rank(b.tier);
    const sold = (a, b) => num(b.soldPerDay) - num(a.soldPerDay);
    const sku = (a, b) => compareText(a.sku, b.sku);
    const biggest = (a, b) =>
      (categorySkus.get(text(b.category)) || 0) - (categorySkus.get(text(a.category)) || 0) ||
      (categorySold.get(text(b.category)) || 0) - (categorySold.get(text(a.category)) || 0) ||
      compareText(a.category, b.category);
    return {
      tier: (a, b) => tier(a, b) || sold(a, b) || sku(a, b),
      category: (a, b) => compareText(a.category, b.category) || tier(a, b) || sold(a, b) || sku(a, b),
      sales: (a, b) => sold(a, b) || tier(a, b) || sku(a, b),
      // The category with the most SKUs first (ties: the better-selling
      // one), and within each category the best-selling SKU first. Each
      // category gets rows of its own (see run).
      categorySales: (a, b) => biggest(a, b) || sold(a, b) || sku(a, b),
    };
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

    // One category per row: the same shelf order, cut into rows, with the
    // rows taken in the order their best shelf comes up.
    const byRow = rules.order === "categorySales";
    const rows = [];
    if (byRow) {
      const at = new Map();
      for (const spot of queue) {
        if (!at.has(spot.row)) { at.set(spot.row, rows.length); rows.push([]); }
        rows[at.get(spot.row)].push(spot);
      }
    }
    let rowAt = -1, rowCategory = null;
    const taken = rows.map(() => 0);  // shelves used so far in each row
    const owner = rows.map(() => null); // the category each row was given to
    const rowsOf = new Map(); // category -> the rows it has shelves in

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

    function nextSpot(category) {
      if (!byRow) return next < queue.length ? queue[next++] : null;
      if (category !== rowCategory) { rowAt++; rowCategory = category; }
      while (rowAt < rows.length && taken[rowAt] >= rows[rowAt].length) rowAt++;
      let at = rowAt;
      if (at < rows.length) {
        if (owner[at] === null) owner[at] = category;
      } else {
        // No fresh row left: the free shelves of the row whose category has
        // the fewest SKUs.
        at = -1;
        for (let i = 0; i < rows.length; i++) {
          if (taken[i] >= rows[i].length) continue;
          if (at < 0 || skusIn(owner[i]) < skusIn(owner[at])) at = i;
        }
        if (at < 0) return null;
      }
      const spot = rows[at][taken[at]++];
      const given = rowsOf.get(category) || [];
      if (given.indexOf(spot.row) < 0) given.push(spot.row);
      rowsOf.set(category, given);
      return spot;
    }

    function takeShelf(category) {
      const spot = nextSpot(category);
      if (!spot) return null;
      const rec = {
        label: spot.label, row: spot.row, col: spot.col, layer: spot.layer,
        sections: [], free: shelf.l, category: category,
      };
      locations.set(rec.label, rec);
      return rec;
    }

    const days = num(rules.days) > 0 ? rules.days : DEFAULT_RULES.days;
    rules.days = days;
    const tiers = tierOrder(skus, rules.tiers);
    const rankOf = new Map(tiers.map((t, i) => [t, i]));
    const rank = (t) => (rankOf.has(text(t)) ? rankOf.get(text(t)) : tiers.length);
    const skip = new Set((rules.skipTiers || []).map(text));
    // A tier left off the racks does not make its category look busier.
    const categorySold = new Map(), categorySkus = new Map();
    for (const s of skus) {
      if (skip.has(text(s.tier))) continue;
      const c = text(s.category);
      categorySold.set(c, (categorySold.get(c) || 0) + num(s.soldPerDay));
      categorySkus.set(c, (categorySkus.get(c) || 0) + 1);
    }
    const ORDERS = makeOrders(rank, categorySold, categorySkus);
    const skusByKey = new Map();
    for (const [c, n] of categorySkus) {
      const key = c.toLowerCase();
      skusByKey.set(key, (skusByKey.get(key) || 0) + n);
    }
    function skusIn(category) { return skusByKey.get(category) || 0; }

    const results = skus.map(function (s, i) {
      const wanted = boxesWanted(s, days);
      return {
        index: i, sku: s, needed: neededQty(s, days),
        wanted: wanted === null ? 0 : wanted, placed: 0, unplaced: 0,
        perShelf: 0, spots: [], problem: wanted === null ? "no-count" : null,
      };
    });

    const order = results.slice().sort((a, b) => (ORDERS[rules.order] || ORDERS.tier)(a.sku, b.sku));
    order.forEach((r, i) => { r.order = i; });

    for (const r of order) {
      const s = r.sku;
      if (r.problem === "no-count") continue;
      if (skip.has(text(s.tier))) { r.problem = "skipped"; continue; }
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
              ((rules.mix === "any" && !byRow) || o.category === category));
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

    // Which rows each category ended up in, in priority order, and whose
    // row each one is: a category's own, or a guest in another's.
    const categories = [];
    if (byRow) {
      const owned = new Map();
      owner.forEach((c, i) => { if (c !== null) owned.set(rows[i][0].row, c); });
      const seen = new Set();
      for (const r of order) {
        const key = text(r.sku.category).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const inRows = rowsOf.get(key) || [];
        categories.push({
          key: key, name: text(r.sku.category), skus: skusIn(key), rows: inRows,
          guest: inRows.length > 0 && inRows.every((row) => owned.get(row) !== key),
        });
      }
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

    const counted = results.filter((r) => r.problem !== "skipped" && r.problem !== "no-count");
    const stats = {
      shelves: Layout.count,
      shelvesUsed: locations.size,
      skus: skus.length,
      skusNeeding: counted.filter((r) => r.wanted > 0).length,
      skusPlaced: counted.filter((r) => r.wanted > 0 && r.unplaced === 0 && r.placed > 0).length,
      skusNoCount: results.filter((r) => r.problem === "no-count").length,
      skusSkipped: results.filter((r) => r.problem === "skipped").length,
      boxesWanted: counted.reduce((n, r) => n + r.wanted, 0),
      boxesPlaced: results.reduce((n, r) => n + r.placed, 0),
      boxesUnplaced: results.reduce((n, r) => n + r.unplaced, 0),
      fill: boxVolume / (shelfVolume * Layout.count),
    };

    return {
      rules: rules, tiers: tiers, locations: locations, results: results, stats: stats, packIn: packIn,
      byRow: byRow, categories: categories,
    };
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
    neededQty: neededQty,
    tierOrder: tierOrder,
    compareText: compareText,
    DEFAULT_RULES: DEFAULT_RULES,
  };
})();
