// How many boxes fit in a rack, and exactly where each one sits.
//
// The search is a block-and-split heuristic. Pick an orientation for the box,
// fill as big a solid grid of it as the space allows, then cut what is left
// into three smaller spaces and solve those the same way. Every orientation is
// tried, and the leftover is cut three different ways, because which cut wins
// depends on the numbers -- a thin strip down the side is sometimes worth more
// than a thin slab on top. The best total wins.
const Packer = (function () {
  "use strict";

  const EPS = 1e-6;
  const EMPTY = { count: 0, blocks: [] };

  // Up to six ways to stand a box. Identical dimensions collapse into one.
  function orientations(l, w, h, mode) {
    let all;
    if (mode === "fixed") {
      all = [[l, w, h]];
    } else if (mode === "upright") {
      // Height stays height; only the footprint turns.
      all = [[l, w, h], [w, l, h]];
    } else {
      all = [
        [l, w, h], [l, h, w],
        [w, l, h], [w, h, l],
        [h, l, w], [h, w, l],
      ];
    }
    const seen = new Set();
    const out = [];
    for (const o of all) {
      const k = o.map((n) => n.toFixed(4)).join("x");
      if (!seen.has(k)) { seen.add(k); out.push(o); }
    }
    return out;
  }

  // The three ways to cut up what is left once a grid block is in the corner.
  // ux/uy/uz are how far the block reaches along each axis.
  function splits(L, W, H, ux, uy, uz) {
    const rx = L - ux, ry = W - uy, rz = H - uz;
    return [
      // The strip beside the block runs the full depth and height.
      [{ x: ux, y: 0, z: 0, l: rx, w: W, h: H },
       { x: 0, y: uy, z: 0, l: ux, w: ry, h: H },
       { x: 0, y: 0, z: uz, l: ux, w: uy, h: rz }],
      // The strip behind the block runs the full width and height.
      [{ x: 0, y: uy, z: 0, l: L, w: ry, h: H },
       { x: ux, y: 0, z: 0, l: rx, w: uy, h: H },
       { x: 0, y: 0, z: uz, l: ux, w: uy, h: rz }],
      // The slab above the block covers the whole footprint.
      [{ x: 0, y: 0, z: uz, l: L, w: W, h: rz },
       { x: ux, y: 0, z: 0, l: rx, w: W, h: uz },
       { x: 0, y: uy, z: 0, l: ux, w: ry, h: uz }],
    ];
  }

  function solve(L, W, H, depth, ctx) {
    if (L < ctx.min - EPS || W < ctx.min - EPS || H < ctx.min - EPS) return EMPTY;
    if (L * W * H < ctx.volume - EPS) return EMPTY;

    const key = L.toFixed(3) + "|" + W.toFixed(3) + "|" + H.toFixed(3) + "|" + depth;
    const cached = ctx.memo.get(key);
    if (cached) return cached;

    let best = EMPTY;
    const last = depth >= ctx.maxDepth;

    for (let oi = 0; oi < ctx.orients.length; oi++) {
      const o = ctx.orients[oi];
      const nx = Math.floor((L + EPS) / o[0]);
      const ny = Math.floor((W + EPS) / o[1]);
      const nz = Math.floor((H + EPS) / o[2]);
      if (!nx || !ny || !nz) continue;

      const ux = nx * o[0], uy = ny * o[1], uz = nz * o[2];
      const block = { x: 0, y: 0, z: 0, nx: nx, ny: ny, nz: nz, l: o[0], w: o[1], h: o[2], oi: oi };
      const grid = nx * ny * nz;

      if (last) {
        if (grid > best.count) best = { count: grid, blocks: [block] };
        continue;
      }

      for (const variant of splits(L, W, H, ux, uy, uz)) {
        let total = grid;
        const parts = [];
        for (const s of variant) {
          if (s.l < ctx.min - EPS || s.w < ctx.min - EPS || s.h < ctx.min - EPS) continue;
          const sub = solve(s.l, s.w, s.h, depth + 1, ctx);
          if (sub.count) { total += sub.count; parts.push([sub, s]); }
        }
        if (total > best.count) {
          const blocks = [block];
          for (const [sub, s] of parts) {
            for (const b of sub.blocks) {
              blocks.push({
                x: b.x + s.x, y: b.y + s.y, z: b.z + s.z,
                nx: b.nx, ny: b.ny, nz: b.nz,
                l: b.l, w: b.w, h: b.h, oi: b.oi,
              });
            }
          }
          best = { count: total, blocks: blocks };
        }
        // A block that fills the space leaves nothing to cut differently.
        if (ux >= L - EPS && uy >= W - EPS && uz >= H - EPS) break;
      }
    }

    ctx.memo.set(key, best);
    return best;
  }

  // rack and box are {l, w, h} in the same unit. mode: "any" | "upright" | "fixed".
  function pack(rack, box, mode, maxDepth) {
    const orients = orientations(box.l, box.w, box.h, mode || "any");
    const min = Math.min(box.l, box.w, box.h);
    const result = { count: 0, blocks: [], orientations: orients, fits: false };

    if (!(rack.l > 0 && rack.w > 0 && rack.h > 0 && box.l > 0 && box.w > 0 && box.h > 0)) {
      return result;
    }

    const ctx = {
      orients: orients,
      min: min,
      volume: box.l * box.w * box.h,
      memo: new Map(),
      maxDepth: typeof maxDepth === "number" ? maxDepth : 3,
    };

    const solved = solve(rack.l, rack.w, rack.h, 0, ctx);
    result.count = solved.count;
    result.blocks = solved.blocks;
    result.fits = solved.count > 0;

    const boxVolume = box.l * box.w * box.h;
    const rackVolume = rack.l * rack.w * rack.h;
    result.utilization = rackVolume > 0 ? (solved.count * boxVolume) / rackVolume : 0;
    result.boxVolume = boxVolume;
    result.rackVolume = rackVolume;

    // What each orientation contributed, for the legend.
    const byOrient = orients.map((o, i) => ({ index: i, dims: o, count: 0 }));
    for (const b of solved.blocks) byOrient[b.oi].count += b.nx * b.ny * b.nz;
    result.byOrientation = byOrient.filter((o) => o.count > 0);

    // The tallest point anything reaches, so an unused top gap can be reported.
    let top = 0;
    for (const b of solved.blocks) top = Math.max(top, b.z + b.nz * b.h);
    result.usedHeight = top;

    return result;
  }

  // Blocks are compact; the viewers want one entry per box.
  function placements(blocks, limit) {
    const out = [];
    const cap = limit || Infinity;
    for (const b of blocks) {
      for (let i = 0; i < b.nx; i++) {
        for (let j = 0; j < b.ny; j++) {
          for (let k = 0; k < b.nz; k++) {
            if (out.length >= cap) return out;
            out.push({
              x: b.x + i * b.l, y: b.y + j * b.w, z: b.z + k * b.h,
              l: b.l, w: b.w, h: b.h, oi: b.oi,
            });
          }
        }
      }
    }
    return out;
  }

  // Every box the given height passes through, worked out from the blocks
  // rather than from a capped list, so a plan view of a rack holding tens of
  // thousands of small cartons is still the whole truth.
  function slice(blocks, height) {
    const out = [];
    for (const b of blocks) {
      const k = Math.floor((height - b.z) / b.h + EPS);
      if (k < 0 || k >= b.nz) continue;
      const z = b.z + k * b.h;
      if (height >= z + b.h - EPS) continue;
      for (let i = 0; i < b.nx; i++) {
        for (let j = 0; j < b.ny; j++) {
          out.push({ x: b.x + i * b.l, y: b.y + j * b.w, z: z, l: b.l, w: b.w, h: b.h, oi: b.oi });
        }
      }
    }
    return out;
  }

  // How many boxes stand directly on the shelf.
  function onFloor(blocks) {
    let n = 0;
    for (const b of blocks) if (b.z < EPS) n += b.nx * b.ny;
    return n;
  }

  return {
    pack: pack,
    placements: placements,
    slice: slice,
    onFloor: onFloor,
    orientations: orientations,
  };
})();
