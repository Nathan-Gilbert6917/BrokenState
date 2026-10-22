// @ts-check
// The walk to a point of interest (pois.js) inside a tile: where each place stands on the tile, how many minutes on
// foot it lies from where the team stands, and the walk itself before the raid.
//
// - Where (poiSpot): every POI of a tile has a spot inside the hex, in hex radii from its centre (x right, y down, as
//   hex.js toPixel), by hash dice from the seed, the tile and the index: the top POI near the centre (its sprite is
//   drawn there, ui/render.js), the others round it 0.45–0.75 out, spread by the index. Fixed for the world.
// - The weighted map (walkGrid): an 11 × 11 grid over the hex, a cost a cell by the tile's terrain (WALK.TERRAIN:
//   brush, slopes, rubble) × its own hash dice (thickets, fences, gullies), a road across the tile (its roadLinks'
//   directions from the centre) cheaper. The walk is the cheapest way through it (Dijkstra, 8 ways, diagonals √2), its
//   cost in cells turned to minutes: WALK.MIN + cost × WALK.PER, never under WALK.MIN (5) or over WALK.MAX (20).
// - From where (walkFrom): the place the team last walked to on this tile (p.atPoi, kept until it steps off the tile:
//   parties.js stepAlong), else the tile's centre, where the map draws a team that has arrived. Raid one place, then
//   another: the minutes are from the first place to the second. The place it stands at is "here" (no walk).
// - The walk (startPoiWalk): picking a place on the POI dialogue (poiraid.js poiPickCard) starts a task "poiwalk" of
//   its minutes (orders.js startTask: it ends at its minute, tasksDue); the clock stays stopped from the card (the
//   player unpauses), the map draws the team walking from its spot to the place's (ui/render.js walkPos), and when the
//   minutes are up (poiWalkDone, from orders.js finishTask) the team stands at the place and the raid starts there
//   (parties.js giveOrder "scavenge" with the pick set). Stopped or cut short by a card, the team stays where it was.
// - Only the player's own pick walks: the autopilot, a crew and the tools never see the card and go straight in.
// Hash dice only (skills.js hash01), never state.rng: a card's minutes never change the run.
/** @import { State, Tile, Party } from "./types" */
import { hash01 } from "./skills.js";
import { poisOf, poiAt, poiName } from "./pois.js";
import { partyTile, giveOrder, tileLabel } from "./parties.js";
import { startTask } from "./orders.js"; // call-time only (orders.js finishTask calls poiWalkDone)

export const WALK = {
  MIN: 5,        // minutes: the nearest place
  MAX: 20,       // minutes: the farthest
  PER: 1.25,     // minutes a cell of cost (a cell is 2/11 of the hex's width)
  N: 11,         // the grid's cells a side
  ROAD: 0.55,    // a cell on the road
  ROAD_W: 0.14,  // the road's half width, hex radii
  NOISE: [0.8, 1.3], // a cell's own dice: open ground to a thicket
  TERRAIN: { plains: 1, suburb: 0.9, city: 1.15, forest: 1.45, hills: 1.5, mountain: 1.9 },
};

const SQ3 = Math.sqrt(3);
// Inside a pointy-top hex of radius 1 (hex.js toPixel's layout).
const inHex = (x, y) => { const ax = Math.abs(x), ay = Math.abs(y); return ax <= SQ3 / 2 && ay <= 1 && ax * 0.5 + ay * (SQ3 / 2) <= SQ3 / 2; };

/** Where POI i stands on its tile: [x, y] in hex radii from the centre. @param {State} state @param {Tile} t @param {number} i @returns {[number, number]} */
export function poiSpot(state, t, i) {
  const n = poisOf(t).length;
  const h = (k) => hash01(state.seed, "poispot", t.id, i, k);
  if (i === 0) { const a = h(0) * Math.PI * 2, r = 0.08 + 0.14 * h(1); return [Math.cos(a) * r, Math.sin(a) * r]; }
  const a0 = hash01(state.seed, "poispot", t.id, "a0") * Math.PI * 2;
  const a = a0 + ((i - 1) * Math.PI * 2) / Math.max(1, n - 1) + (h(0) - 0.5) * 0.9;
  const r = 0.45 + 0.3 * h(1);
  return [Math.cos(a) * r, Math.sin(a) * r];
}

// The weighted map of a tile: cost per cell (Infinity outside the hex).
function walkGrid(state, t) {
  const N = WALK.N, cells = new Float64Array(N * N);
  const base = WALK.TERRAIN[t.terrain] || 1;
  const [cx, cy] = state.grid.toPixel(t.id, 1);
  const roads = (t.roadLinks || []).map((id) => { const [x, y] = state.grid.toPixel(id, 1); const d = Math.hypot(x - cx, y - cy) || 1; return [(x - cx) / d, (y - cy) / d]; });
  for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
    const [x, y] = cellXY(gx, gy);
    if (!inHex(x, y)) { cells[gy * N + gx] = Infinity; continue; }
    const onRoad = roads.some(([dx, dy]) => { const s = x * dx + y * dy; return s > -WALK.ROAD_W && Math.abs(x * dy - y * dx) < WALK.ROAD_W; });
    const [lo, hi] = WALK.NOISE;
    cells[gy * N + gx] = onRoad ? WALK.ROAD : base * (lo + (hi - lo) * hash01(state.seed, "poiwalk", t.id, gx, gy));
  }
  return cells;
}
const cellXY = (gx, gy) => [((gx + 0.5) / WALK.N) * 2 - 1, ((gy + 0.5) / WALK.N) * 2 - 1];
// The cell a spot falls in (inside the hex: the nearest such cell).
function cellOf(cells, [x, y]) {
  const N = WALK.N, c = (v) => Math.max(0, Math.min(N - 1, Math.floor(((v + 1) / 2) * N)));
  let gx = c(x), gy = c(y);
  if (isFinite(cells[gy * N + gx])) return gy * N + gx;
  let best = -1, bd = Infinity;
  for (let k = 0; k < N * N; k++) {
    if (!isFinite(cells[k])) continue;
    const [px, py] = cellXY(k % N, Math.floor(k / N)), d = Math.hypot(px - x, py - y);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
// The cheapest way between two spots through the weighted map, in cells of cost.
function walkCost(cells, from, to) {
  const N = WALK.N, a = cellOf(cells, from), b = cellOf(cells, to);
  if (a < 0 || b < 0) return 0;
  const dist = new Float64Array(N * N).fill(Infinity), done = new Uint8Array(N * N);
  dist[a] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let k = 0; k < N * N; k++) if (!done[k] && dist[k] < best) { best = dist[k]; u = k; }
    if (u < 0 || u === b) break;
    done[u] = 1;
    const ux = u % N, uy = Math.floor(u / N);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const vx = ux + dx, vy = uy + dy;
      if (vx < 0 || vy < 0 || vx >= N || vy >= N) continue;
      const v = vy * N + vx;
      if (done[v] || !isFinite(cells[v])) continue;
      const step = ((cells[u] + cells[v]) / 2) * (dx && dy ? Math.SQRT2 : 1);
      if (dist[u] + step < dist[v]) dist[v] = dist[u] + step;
    }
  }
  return dist[b];
}

/** Where the team stands on its tile: { spot, poi } (poi: the place it walked to, or null at the centre). @param {State} state @param {Party} p @param {number} [tile] */
export function walkFrom(state, p, tile = partyTile(p)) {
  const t = state.tiles[tile];
  const at = p && p.atPoi;
  if (at && at.tile === tile && poiAt(t, at.i)) return { spot: poiSpot(state, t, at.i), poi: at.i };
  return { spot: /** @type {[number, number]} */ ([0, 0]), poi: null };
}

/** Minutes on foot from the team's spot to POI i of its tile (0: it stands there). @param {State} state @param {Party} p @param {number} i @param {number} [tile] */
export function poiWalkMins(state, p, i, tile = partyTile(p)) {
  const t = state.tiles[tile];
  if (!poiAt(t, i)) return 0;
  const from = walkFrom(state, p, tile);
  if (from.poi === i) return 0;
  const cost = walkCost(walkGrid(state, t), from.spot, poiSpot(state, t, i));
  return Math.max(WALK.MIN, Math.min(WALK.MAX, Math.round(WALK.MIN + cost * WALK.PER)));
}
// "12 min on foot" / "you are here".
export const walkText = (mins) => (mins > 0 ? `${mins} min on foot` : "you are here");

/** Start the walk to POI i (the dialogue's pick); the raid starts when it is done. Returns the log line, or null with no walk (it stands there). @param {State} state @param {Party} p @param {number} i @param {string | null} [building] */
export function startPoiWalk(state, p, i, building = null) {
  const tile = partyTile(p), t = state.tiles[tile];
  const mins = poiWalkMins(state, p, i, tile);
  if (!mins) return null;
  startTask(state, p, { type: "poiwalk", hours: mins / 60, mins, poi: i, building, name: poiName(t, i), from: walkFrom(state, p, tile).spot, to: poiSpot(state, t, i) });
  return `The team sets off on foot for ${poiName(t, i).toLowerCase()} at ${tileLabel(state, tile)}: ${mins} minutes away. The raid starts when it gets there.`;
}
/** The walk is over (orders.js finishTask): the team stands at the place and goes in. @param {State} state @param {Party} p */
export function poiWalkDone(state, p) {
  const w = p.task;
  p.task = null;
  p.atPoi = { tile: partyTile(p), i: w.poi };
  p.poi = w.poi;
  if (w.building) p.poiBuilding = w.building; else delete p.poiBuilding;
  return giveOrder(state, p, "scavenge");
}

/** Where the map draws a team on its tile at this minute: { x, y, walking, to, mins } in hex radii, or null (the centre). @param {State} state @param {Party} p @param {number} frac */
export function walkPos(state, p, frac) {
  const w = p.phase === "task" && p.task && p.task.type === "poiwalk" ? p.task : null;
  if (w) {
    const u = Math.max(0, Math.min(1, (w.done - (w.owed || 0) + frac) / w.hours));
    const [ax, ay] = w.from, [bx, by] = w.to;
    return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u, walking: true, from: w.from, to: w.to, name: w.name, mins: Math.max(1, Math.ceil(w.mins * (1 - u))) };
  }
  const at = walkFrom(state, p);
  if (at.poi == null) return null;
  return { x: at.spot[0], y: at.spot[1], walking: false };
}
