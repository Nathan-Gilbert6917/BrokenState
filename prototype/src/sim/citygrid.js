// @ts-check
// The city crawl's ground (2026-10-13, docs/crawl-balance.md): a city or a town is a round grid of blocks, a size × size
// square with its corners cut away in a curve (a block is in when its centre lies within the circle). A city is 15–30
// blocks across, a town 9–12, by the world's dice (the same every visit). You come in at a block on its rim, on the side
// facing the way you came; from any block you go left, right or straight on; any block on the rim is a way out.
// How deep a block is: its ring counted in from the rim (1 on the rim); its level (1–8, what the danger and the loot
// tables read: citycrawl.js CRAWL, the old "block" number) climbs a level every LEVEL_RINGS rings, so the heart of the
// biggest city is level 8 and a town's never goes past 3. Pure geometry: no state but what is passed in.
import { hash01 } from "./skills.js";

export const GRID = {
  CITY: [15, 30], TOWN: [9, 12],
  LEVEL_RINGS: 2, MAX_LEVEL: 8,
};
// N, E, S, W (heading 0–3) and their steps.
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const DIR_NAMES = ["north", "east", "south", "west"];
export const keyOf = (x, y) => `c${x}_${y}`;
export function xyOf(key) { const m = /^c(-?\d+)_(-?\d+)$/.exec(key || ""); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; }

// The grid of a site tile: { size, r } (r: the circle's radius in blocks). Towns are smaller.
/** @param {any} state @param {any} t */
export function gridOf(state, t) {
  const town = t && t.loc && t.loc.type === "town";
  const [lo, hi] = town ? GRID.TOWN : GRID.CITY;
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
// A turn from a heading: "left", "straight", "right" → the new heading.
export const turn = (heading, way) => (way === "left" ? (heading + 3) % 4 : way === "right" ? (heading + 1) % 4 : heading);
// The blocks from (x, y) going `dir` until off the grid: the cells crossed (not the one you stand on).
/** @param {{ size: number, r: number }} g */
export function lineOut(g, x, y, dir) {
  const [dx, dy] = DIRS[dir];
  const out = [];
  let cx = x + dx, cy = y + dy;
  while (inGrid(g, cx, cy)) { out.push(keyOf(cx, cy)); cx += dx; cy += dy; }
  return out;
}
