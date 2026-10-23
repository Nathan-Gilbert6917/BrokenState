// @ts-check
// The lie of the land on a fight's or a raid's map (the user's word 2026-10-23: "These hills occur on hill raids as
// well"): the hills, hollows and, in an open fight, the mountains' crag of the tile's own land (basescatter.js
// reliefLayer, the base map's dice: the same hills) laid on a battle map of a hills or mountain tile. The heights go
// under whatever natural stands there (open ground, trees, bushes, rocks: RELIEF.NATURAL); a building's floor and the
// cells round it, the map's edges (the ways in and out) and the raid's entry zones stay level, and the ground steps a
// level at most between neighbours, so everything walked to before is walked to still (combat.js climbCost). Crag
// never shuts off ground the map's edges reached without it (the user's words 2026-10-23: "Blocking base due to
// ridge"): a pass is carved through it (basescatter.js cragPasses; it was left out whole when it cut the west edge from
// the east, and the foothills either side of where it stood were left three levels over the ground: a trench).
// cragWays(cells, W, H): the same for a map the land was laid on (basescatter.js layLand: a base's map, the camp's
// spot, an AI group's margin), its ground eased a level a step.
//   applyRelief(cells, W, H, tile, opts) → the cells raised or lowered. opts.crags: the ridges too (an open fight);
//   opts.keep(x, y): cells to keep level (a raid's zones).
// A pond tile (the user's words 2026-10-23: "add pond decor to the world map when a tile has a pond in the world map
// generate a pond in the battle map"; mapgen.js tile.pond), whatever its terrain: a hollow fed by a spring on the map
// (c.spring: ponds.js keeps it water whatever the rain), SPRING_FIGHT.R half-sizes across (at least HIGH.DIP_MIN once
// smoothed), its ground RIM cells round it level, in the middle MID share of the map's width (clear of where each side
// comes in), at the first of TRIES spots by the tile's dice where all of it is natural ground the relief may change
// (springFight: then smaller, then anywhere, then partly cut by what stays level).
// The rest of a plains, forest or farm tile's land stays level as before.
import { reliefLayer, scatterSeed, HIGH, cragPasses } from "./basescatter.js";
import { CELL, groundH } from "./combat.js"; // call-time only

export const RELIEF = {
  TERRAIN: new Set(["hills", "mountain"]),
  NATURAL: new Set(["open", "tree", "bush", "rock", "boulder", "stump", "log", "hay"]),
  EDGE: 3,        // columns kept level at the west and east edges (where each side comes in and goes out)
  NEAR_FLOOR: 2,  // cells kept level round a building's floor
  TRIES: 10,      // windows of the tile's land tried; the one with the most relief taken
  G: 250,         // the land's half-size (basemap.js GRID_MAX)
};
export const SPRING_FIGHT = { R: [5, 7], MIN: 5, RIM: 2, MID: 0.4, TRIES: 64, CUT: 0.3 };
const hashN = (a, b, c) => { let h = Math.imul(a ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul(b + 0x632b, 0xc2b2ae35) ^ Math.imul(c + 0x27d4, 0x165667b1); h ^= h >>> 15; return (h >>> 0) / 4294967296; };

/** @param {any[]} cells @param {number} W @param {number} H @param {any} tile @param {{ crags?: boolean, keep?: (x: number, y: number) => boolean }} [opts] */
export function applyRelief(cells, W, H, tile, opts = {}) {
  const pond = !!(tile && tile.pond), land = !!tile && RELIEF.TERRAIN.has(tile.terrain);
  if (!tile || (!land && !pond) || !HIGH) return 0;
  const R = land ? reliefLayer(scatterSeed(tile.id), tile.terrain, RELIEF.G) : { heights: [], crags: [] };
  const hm = new Map(R.heights.map(([x, y, h]) => [`${x},${y}`, h])), crag = new Map(opts.crags ? R.crags.map(([x, y, lv]) => [`${x},${y}`, lv]) : []); // the rock's height by cell
  // The window of the tile's land the map shows: the one with the most relief of a few.
  const span = RELIEF.G * 2 - Math.max(W, H) - 4;
  let best = null;
  for (let k = 0; k < RELIEF.TRIES; k++) {
    const ox = Math.floor(-RELIEF.G + 2 + hashN(tile.id, k, 1) * span), oy = Math.floor(-RELIEF.G + 2 + hashN(tile.id, k, 2) * Math.max(1, RELIEF.G * 2 - H - 4));
    let n = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (hm.has(`${x + ox},${y + oy}`) || crag.has(`${x + ox},${y + oy}`)) n++;
    if (!best || n > best.n) best = { ox, oy, n };
  }
  if ((!best || !best.n) && !pond) return 0;
  if (!best) best = { ox: 0, oy: 0, n: 0 };
  // What stays level: the edges, what is not natural ground, round a building's floor, what the caller keeps.
  const N = W * H, fixed = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = cells[y * W + x];
    if (x < RELIEF.EDGE || x >= W - RELIEF.EDGE || y < 1 || y >= H - 1 || !RELIEF.NATURAL.has(c.k) || c.f === "floor" || c.car || (opts.keep && opts.keep(x, y))) fixed[y * W + x] = 1;
    if (c.f === "floor") for (let dy = -RELIEF.NEAR_FLOOR; dy <= RELIEF.NEAR_FLOOR; dy++) for (let dx = -RELIEF.NEAR_FLOOR; dx <= RELIEF.NEAR_FLOOR; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) fixed[ny * W + nx] = 1; }
  }
  const h = new Int8Array(N), isCrag = new Uint8Array(N), cragH = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (fixed[i]) continue;
    const key = `${x + best.ox},${y + best.oy}`;
    if (crag.has(key) && cells[i].k === "open") { isCrag[i] = 1; cragH[i] = crag.get(key); }
    else h[i] = hm.get(key) || 0;
  }
  // The crag leaves every way open: a pass through it, the shortest way, where it would shut ground off from the edges
  // (its cells level ground: the foothills ease down into it below).
  if (isCrag.some((v) => v)) {
    const block = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (!isCrag[i] && !(CELL[cells[i].k] && CELL[cells[i].k].walk)) block[i] = 1;
    cragPasses(isCrag, block, W, H);
  }
  // A pond tile's spring: its hollow stamped on natural ground, the ground round it level.
  const spring = pond ? springFight(h, isCrag, fixed, W, H, tile.id) : null;
  // Smoothed as the base map's land is (basescatter.js relaxHeights): a raised cell in a 2 × 2 as high or higher (a sunk
  // one as deep), else a level less; then a level at most between neighbours (eight ways); the fixed cells level, the
  // crag as high as any hill beside it.
  const lvAt = (x, y, s) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : isCrag[y * W + x] ? (s > 0 ? 9 : -9) : h[y * W + x]);
  for (let round = 0, any = true; any && round < 8; round++) {
    any = false;
    for (let pass = 0, changed = true; changed && pass < 12; pass++) {
      changed = false;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, v0 = h[i];
        if (!v0 || isCrag[i]) continue;
        const ok = [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([ox, oy]) => [[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dy]) => { const v = lvAt(x + ox + dx, y + oy + dy, v0); return v0 > 0 ? v >= v0 : v <= v0; }));
        if (!ok) { h[i] = v0 > 0 ? v0 - 1 : v0 + 1; changed = any = true; }
      }
    }
    for (let pass = 0, changed = true; changed && pass < 12; pass++) {
      changed = false;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!h[i] || isCrag[i]) continue;
        let lo = Infinity, hi = -Infinity;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (isCrag[j]) continue;
          lo = Math.min(lo, h[j]); hi = Math.max(hi, h[j]);
        }
        const v = h[i] > 0 ? Math.min(h[i], lo + 1) : Math.max(h[i], hi - 1);
        if (v !== h[i]) { h[i] = v; changed = any = true; }
      }
    }
  }
  // A hollow cut narrower than HIGH.DIP_MIN either way (by the level edges, a building, a zone) is filled in.
  {
    const seen = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (h[i] >= 0 || seen[i]) continue;
      const comp = [i];
      seen[i] = 1;
      let x0 = W, x1 = 0, y0 = H, y1 = 0;
      for (let k = 0; k < comp.length; k++) {
        const j = comp[k], x = j % W, y = (j / W) | 0;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const n = ny * W + nx; if (!seen[n] && h[n] < 0) { seen[n] = 1; comp.push(n); } }
      }
      if (x1 - x0 + 1 < HIGH.DIP_MIN || y1 - y0 + 1 < HIGH.DIP_MIN) for (const j of comp) h[j] = 0;
    }
  }
  let n = 0;
  for (let i = 0; i < N; i++) {
    const c = cells[i];
    if (isCrag[i]) { c.k = "crag"; c.ch = cragH[i]; n++; continue; }
    if (h[i]) { c.h = h[i]; c.ter = 1; n++; if (spring && spring[i] && h[i] < 0) { c.spring = 1; if (c.k !== "open") c.k = "open"; } } // nothing natural stands in the spring's pond (a tree, a rock: as on the base map)
  }
  return n;
}
// The spring's hollow on a fight's map (SPRING_FIGHT): stamped into h (−1 inside, 0 on its rim, the cells that must stay
// level left as they are) at the first spot where all of it is free, the largest size first, then anywhere across the
// map; else at the spot with the least of it blocked (a road's wrecks across a small map), at most CUT of it. Returns
// the cells (1), or null when nothing fits (a map packed with buildings).
function springFight(h, isCrag, fixed, W, H, id) {
  const S = SPRING_FIGHT, roll = (k, j) => hashN(id ^ 0x5b1e, k, j);
  const ax0 = S.R[0] + Math.floor(roll(0, 1) * (S.R[1] - S.R[0] + 1)), ay0 = S.R[0] + Math.floor(roll(0, 2) * (S.R[1] - S.R[0] + 1));
  const inE = (x, y, cx, cy, a, b) => ((x - cx) / a) ** 2 + ((y - cy) / b) ** 2 <= 1;
  /** @type {{ cx: number, cy: number, ax: number, ay: number, share?: number } | null} */
  let best = null;
  const stamp = ({ cx, cy, ax, ay }) => {
    const rx = ax + S.RIM, ry = ay + S.RIM, out = new Uint8Array(W * H);
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
      const i = y * W + x;
      if (fixed[i] || isCrag[i]) continue;
      if (inE(x, y, cx, cy, ax, ay)) { h[i] = -1; out[i] = 1; } else if (inE(x, y, cx, cy, rx, ry)) h[i] = 0;
    }
    return out;
  };
  for (const [ax, ay, mid] of [[ax0, ay0, S.MID], [S.MIN, S.MIN, S.MID], [S.MIN, S.MIN, 1]]) {
    const rx = ax + S.RIM, ry = ay + S.RIM, xlo = Math.max(rx + RELIEF.EDGE, Math.floor((W * (1 - mid)) / 2)), xhi = Math.min(W - rx - RELIEF.EDGE - 1, Math.ceil((W * (1 + mid)) / 2)), ylo = ry + 1, yhi = H - ry - 2;
    if (xhi < xlo || yhi < ylo) continue;
    for (let k = 0; k < S.TRIES; k++) {
      const cx = xlo + Math.floor(roll(k + 1, 3) * (xhi - xlo + 1)), cy = ylo + Math.floor(roll(k + 1, 4) * (yhi - ylo + 1));
      let blocked = 0, inner = 0, n = 0;
      for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
        if (!inE(x, y, cx, cy, rx, ry)) continue;
        const i = y * W + x, inside = inE(x, y, cx, cy, ax, ay);
        if (inside) n++;
        if (fixed[i] || isCrag[i]) { blocked++; if (inside) inner++; }
      }
      if (!blocked) return stamp({ cx, cy, ax, ay });
      if (inner / n <= S.CUT && (!best || inner / n < best.share)) best = { cx, cy, ax, ay, share: inner / n };
    }
  }
  return best ? stamp(best) : null;
}

/**
 * A map the land was laid on (basescatter.js layLand: a base's map, the camp's spot, an AI group's margin) left open
 * and walked up and down anywhere (the user's words 2026-10-23: "Blocking base due to ridge"; tools/mapreachtest.js):
 * where the crag the map's crop takes in shuts off ground the edges reach without it, a pass is carved through it
 * (basescatter.js cragPasses: level ground), and the ground's heights (c.h with c.ter) are eased a level a step down
 * (a hollow up) to what is level beside them: the map's outermost ring and what stands there (no land laid), a pass.
 * In place; returns the crag cells carved away.
 * @param {any[]} cells @param {number} W @param {number} H
 */
export function cragWays(cells, W, H) {
  const N = W * H, rock = new Uint8Array(N);
  let any = false;
  for (let i = 0; i < N; i++) if (cells[i].k === "crag") { rock[i] = 1; any = true; }
  let carved = [];
  if (any) {
    const block = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (!rock[i] && !(CELL[cells[i].k] && CELL[cells[i].k].walk)) block[i] = 1;
    carved = cragPasses(rock, block, W, H).carved;
    for (const i of carved) { const c = cells[i]; c.k = "open"; delete c.ch; delete c.h; delete c.ter; }
  }
  // The ground a level a step (eight ways): a hill lowered, a hollow raised, toward the ground beside it (a raised
  // floor of its own, a walkway or a roof, and the crag left out).
  const gh = (c) => (c.k === "crag" ? null : groundH(c));
  for (let pass = 0, changed = true; changed && pass < 16; pass++) {
    changed = false;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = cells[y * W + x];
      if (!c.ter || !c.h || c.k === "crag") continue;
      let lo = Infinity, hi = -Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || y + dy < 0 || x + dx >= W || y + dy >= H) continue;
        const v = gh(cells[(y + dy) * W + x + dx]);
        if (v == null) continue;
        lo = Math.min(lo, v); hi = Math.max(hi, v);
      }
      if (lo === Infinity) continue;
      const v = c.h > 0 ? Math.min(c.h, lo + 1) : Math.max(c.h, hi - 1);
      if (v === c.h) continue;
      changed = true;
      if (v) c.h = v; else { delete c.h; delete c.ter; }
    }
  }
  return carved.length;
}
