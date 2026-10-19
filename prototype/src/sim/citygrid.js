// @ts-check
// The city crawl's ground (2026-10-13, docs/crawl-balance.md): a city or a town is a round grid of blocks, a size × size
// square with its corners cut away in a curve (a block is in when its centre lies within the circle). A city is 15–30
// blocks across, a town 9–12, by the world's dice (the same every visit). You come in at a block on its rim (the
// player picks which; the autopilot by the visit's dice); from any block you go north, east, south or west, the way you
// came included; any block on the rim is a way out, walked to block by block (2026-10-13).
// How deep a block is: its ring counted in from the rim (1 on the rim); its level (1–8, what the danger and the loot
// tables read: citycrawl.js CRAWL, the old "block" number) climbs a level every LEVEL_RINGS rings, so the heart of the
// biggest city is level 8 and a town's never goes past 3. Pure geometry: no state but what is passed in.
import { hash01 } from "./skills.js";
import { cfgOf, WORLD_CFG } from "./worldcfg.js"; // the run's dials: City crawl smallest / largest

export const GRID = {
  CITY: [15, 30], TOWN: [9, 12],
  LEVEL_RINGS: 2, MAX_LEVEL: 8,
};
// N, E, S, W (heading 0–3) and their steps.
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const DIR_NAMES = ["north", "east", "south", "west"];
export const keyOf = (x, y) => `c${x}_${y}`;
export function xyOf(key) { const m = /^c(-?\d+)_(-?\d+)$/.exec(key || ""); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; }

// The blocks across a crawl can be, [lo, hi]: GRID's, or the run's City crawl dials (worldcfg.js cityMin / cityMax; a
// town keeps its share of a city's: 9–12 of 15–30 is 0.6–0.4), at least 3 across.
export function crawlRange(state, town) {
  const [lo, hi] = town ? GRID.TOWN : GRID.CITY;
  const cLo = cfgOf(state, "cityMin"), cHi = cfgOf(state, "cityMax");
  if (cLo === WORLD_CFG.cityMin.def && cHi === WORLD_CFG.cityMax.def) return [lo, hi];
  if (!town) return [Math.min(cLo, cHi), Math.max(cLo, cHi)];
  const a = Math.max(3, Math.round(cLo * (GRID.TOWN[0] / GRID.CITY[0]))), b = Math.max(3, Math.round(cHi * (GRID.TOWN[1] / GRID.CITY[1])));
  return [Math.min(a, b), Math.max(a, b)];
}
// The grid of a site tile: { size, r } (r: the circle's radius in blocks). Towns are smaller.
/** @param {any} state @param {any} t */
export function gridOf(state, t) {
  const town = t && t.loc && t.loc.type === "town";
  // worldcfg.js: the run's City crawl smallest / largest (a city's range itself; a town's scaled by the same shares).
  const [lo, hi] = crawlRange(state, town);
  const size = lo + Math.floor(hash01(state.seed, "citygrid", t ? t.id : 0) * (hi - lo + 1));
  return { size, r: size / 2, town };
}
/** @param {{ size: number, r: number }} g */
export const inGrid = (g, x, y) => x >= 0 && y >= 0 && x < g.size && y < g.size && (x + 0.5 - g.r) ** 2 + (y + 0.5 - g.r) ** 2 <= g.r * g.r;
/** @param {{ size: number, r: number }} g */
export const isEdge = (g, x, y) => inGrid(g, x, y) && DIRS.some(([dx, dy]) => !inGrid(g, x + dx, y + dy));
// Rings in from the rim: 1 on it.
/** @param {{ size: number, r: number }} g */
export function ringOf(g, x, y) {
  const d = Math.hypot(x + 0.5 - g.r, y + 0.5 - g.r);
  return Math.max(1, Math.floor(g.r - d) + 1);
}
/** @param {{ size: number, r: number }} g */
export const levelOf = (g, x, y) => Math.min(GRID.MAX_LEVEL, 1 + Math.floor((ringOf(g, x, y) - 1) / GRID.LEVEL_RINGS));
/** @param {{ size: number, r: number }} g */
export const maxLevel = (g) => levelOf(g, Math.floor(g.r), Math.floor(g.r));
// Every block of the grid: [[x, y], ...].
/** @param {{ size: number, r: number }} g */
export function cellsOf(g) {
  const out = [];
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (inGrid(g, x, y)) out.push([x, y]);
  return out;
}
// Where a team comes in: the rim block on the side facing `angle` (radians, from the city's centre toward where the
// team came from; null: the visit's own dice), and the heading that points in toward the centre.
/** @param {{ size: number, r: number }} g @param {number | null} angle @param {number} jitter 0..1 */
export function entryOf(g, angle, jitter = 0.5) {
  const a = angle == null ? jitter * Math.PI * 2 : angle + (jitter - 0.5) * 0.5;
  let best = null, bd = Infinity;
  for (const [x, y] of cellsOf(g)) {
    if (!isEdge(g, x, y)) continue;
    const ca = Math.atan2(y + 0.5 - g.r, x + 0.5 - g.r);
    const d = Math.abs(Math.atan2(Math.sin(ca - a), Math.cos(ca - a)));
    if (d < bd) { bd = d; best = [x, y]; }
  }
  const [x, y] = best || [0, Math.floor(g.r)];
  return { x, y, heading: headingToward(g, x, y) };
}
// The heading from a block that points most nearly at the centre.
/** @param {{ size: number, r: number }} g */
export function headingToward(g, x, y) {
  const dx = g.r - (x + 0.5), dy = g.r - (y + 0.5);
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 1 : 3) : (dy >= 0 ? 2 : 0);
}
// A turn from a heading: "left", "straight", "right", "back" → the new heading.
export const turn = (heading, way) => (heading + ({ straight: 0, right: 1, back: 2, left: 3 }[way] ?? 0)) % 4;
// Every block on the rim: [[x, y], ...] (where a crawl can start and where it walks out).
/** @param {{ size: number, r: number }} g */
export const rimOf = (g) => cellsOf(g).filter(([x, y]) => isEdge(g, x, y));
// The cheapest walk from (x, y) to any rim block: Dijkstra over the 4 ways, `cost(key)` the price of stepping onto a
// block (Infinity: never; `skip(from, dir)` true: that way out of a block is shut). { path: [keys, not the one you
// stand on], cost }, or null when no rim block can be reached. On the rim already: an empty path.
/** @param {{ size: number, r: number }} g @param {(key: string) => number} cost @param {(from: string, dir: number) => boolean} [skip] */
export function pathToRim(g, x, y, cost, skip = () => false) {
  const start = keyOf(x, y);
  const dist = new Map([[start, 0]]), prev = new Map(), done = new Set();
  const open = [start];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist.get(open[i]) < dist.get(open[bi])) bi = i;
    const k = open.splice(bi, 1)[0];
    if (done.has(k)) continue;
    done.add(k);
    const [cx, cy] = xyOf(k);
    if (isEdge(g, cx, cy)) {
      const path = [];
      for (let at = k; at !== start; at = prev.get(at)) path.unshift(at);
      return { path, cost: dist.get(k) };
    }
    for (let d = 0; d < 4; d++) {
      const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
      if (!inGrid(g, nx, ny) || skip(k, d)) continue;
      const nk = keyOf(nx, ny), w = cost(nk);
      if (!(w < Infinity) || done.has(nk)) continue;
      const nd = dist.get(k) + w;
      if (!(nd >= dist.get(nk))) { dist.set(nk, nd); prev.set(nk, k); open.push(nk); }
    }
  }
  return null;
}
// The way (heading 0-3) from one block to the one beside it, or -1.
export function dirTo(a, b) {
  const [x0, y0] = xyOf(a), [x1, y1] = xyOf(b);
  return DIRS.findIndex(([dx, dy]) => x0 + dx === x1 && y0 + dy === y1);
}
