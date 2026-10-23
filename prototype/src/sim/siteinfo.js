// @ts-check
// What a camp's spot is like (the user's words 2026-10-23: "add valuable information to setting up camp. Update let
// the game pick"). One set of facts for a 5 × 5 on the tile's 500 × 500 map (map coordinates of the fire, the middle
// 0, 0), read by the picker's side panel and hover line (ui/campsite.js) and by the game's own pick (bestSite, under
// basemap.js defaultSite: the governor, a team with nobody to ask, Let the game pick):
//   - the setup: how long this team takes (the camp fire and the clearing, staging.js siteSetup) and what the land
//     there gives, with and without an axe, saw or machete;
//   - the ground: level, or on a hill or in a hollow (the setup digs it down or fills it in level: its work-hours),
//     and the lie of the land round it once the camp stands level (LIE: the ring of cells round it higher, overlooking
//     the camp, or lower, the camp looking down on it: basescatter.js reliefLayer: hills up to 3 levels, hollows a
//     level down, the mountain's crag 3 to 13);
//   - sight lines: how much of the ground within SIGHT cells is open (trees, buildings, wrecks, the crag and higher
//     ground give the dead cover to come up unseen);
//   - room to grow: how much of a shelter's yard round it (ROOM) is open ground, the work-hours to clear the rest, and
//     how far the yard can grow before the map's edge stops it (basemap.js edgeRoom: a hub's yard grows to 180 × 180
//     only near the middle);
//   - wood for the fires standing within WOOD cells (trees, logs, stumps, bushes: felled on the base map);
//   - the river on the map (cells to its water) and the tile's own water (staging.js waterSource), the road or the
//     town's streets (cells to it);
//   - the places on the tile the team knows of (pois.js knownPois; poiwalk.js poiSpot, the hex scaled onto the map as
//     poiwalk.js baseSpot does): a base raids them, the nearer the shorter the walk;
//   - the dead to clear first and their kinds (siteclear.js siteThreat: the same anywhere on the tile).
// The game's pick (bestSite) weighs every spot in reach on the same facts (SITE_SCORE: setup time, the lie of the land,
// sight, water, the road, room, wood, room to the edge; never a spot that cannot take the camp, and off buildings and
// high ground while there is any such spot): a quick score from sums over the map's cells for every spot, the best
// REFINE weighed again in full, ties to the spot nearest the middle. Deterministic (the land alone), cached by the land.
//   siteInfo(state, p, tile, at)  the facts for team p (p null: one person with a cutting tool)
//   siteScore(f)                  the score of a spot's facts, with its parts
//   bestSite(state, tile)         the game's spot ([x, y]); bestSiteOn(land) the same on any land
//   landFacts(land, at)           the facts that are the land's alone (the pick weighs these)
//   pickReasons(f)                why the game picked it: ["it is quick to set up", "on level ground", …]
import { siteLand, siteProblem, terrainOf, SITE_RANGE, GRID, GRID_MAX, NO_BUILD } from "./basemap.js"; // (call-time only: basemap.js defaultSite calls bestSite)
import { SITE, siteBox, clearOf, landSpec, siteLevel, CLEAR } from "./basescatter.js";
import { CAMP } from "./buildings.js"; // (call-time only)
import { siteSetup, waterSource } from "./staging.js"; // (call-time only)
import { siteThreat } from "./siteclear.js"; // (call-time only)
import { mixText } from "./zombietypes.js";
import { knownPois, poiName } from "./pois.js"; // (call-time only)
import { poiSpot, BASE_SPOT } from "./poiwalk.js"; // (call-time only)

export const SITE_INFO = {
  SIGHT: 12,     // sight lines: the ground within this many cells of the fire
  LIE: [4, 10],  // the lie of the land: the ring of cells this far out (nearer, the ground eases down to the dug camp)
  ROOM: 12,      // room to grow: a shelter's yard round the fire (basemap.js GRID.shelter.yard), 24 × 24
  WOOD: 20,      // wood for the fires within this many cells
  REFINE: 24,    // bestSite: the best this many by the quick score weighed again in full
};
// The game's pick: a spot's score in work-hours saved (the setup's work-hours count against it one for one).
//   TIME     a work-hour of the setup (the camp fire and clearing the 5 × 5, with a cutting tool)
//   HIGH     the share of the ring round it lower than the camp, less the share higher (looks down on it / overlooked)
//   SIGHT    the share of the ground within SIGHT open
//   WATER    the river within WATER_NEAR cells, none from WATER_FAR
//   ROAD     the road or a street at the camp, none from ROAD_FAR
//   ROOM     the share of the shelter's yard round it that is open ground
//   WOOD     the wood standing within WOOD cells, full at WOOD_FULL
//   YARD     how far the yard can grow before the map's edge (a hub's GRID.hub.cap: full near the middle)
//   DEAD     each of the dead to clear first (the same anywhere on a tile: it never moves the pick, only the score)
export const SITE_SCORE = { TIME: 1, HIGH: 6, SIGHT: 4, WATER: 3, WATER_NEAR: 20, WATER_FAR: 80, ROAD: 2, ROAD_FAR: 40, ROOM: 8, WOOD: 4, WOOD_FULL: 2400, YARD: 6, DEAD: 0.6 };
// Pulling a building down or digging a hill away to pitch a camp is days of work (the user's request 2026-10-22, the
// towns, the cities and the hills of the base maps): the game's spot keeps off them while it can.
const BIG = new Set(["house", "store", "block", "rise", "slope", "dip", "crag"]);
const SIGHT_BLOCK = new Set(["tree", "house", "store", "block", "crag", "wreck"]); // no sight through (bushes, fences, rocks: seen over)
const WOODY = new Set(["tree", "log", "stump", "bush"]);
const LEVELS = [-2, -1, 0, 1, 2, 3]; // the ground's levels a camp can stand at (gridsOf's higher, lower, no sight through)                          // wood for the fires (a house's timbers: pulled down, not felled)

// ---------- the map's cells summed (cached by the land) ----------
// Per cell of the tile's map (map coordinates [-G, G)): what stands there, summed from the corner (a box's count in
// four reads), and the cells to the river and to the road (eight ways). { G, N, sum(layer, x0, y0, x1, y1), water, road }.
const gridCache = []; // the last few lands summed ([land, sums]: 4.5 MB each, so only the tile on screen and the last picks)
function gridsOf(land) {
  let g = (gridCache.find((e) => e[0] === land) || [])[1];
  if (g) return g;
  const G = GRID_MAX, N = 2 * G, M = N + 1;
  // gt<t>: ground higher than level t (the crag at any level), lt<t>: lower; sv<t>: no sight through from a camp at
  // level t (a tree, a building, the crag, ground higher than it). The camp's own level (basescatter.js siteLevel) picks
  // the layers: a camp on a hill is not overlooked by the hill it stands on (the user's request 2026-10-23).
  const L = { solid: 0, bad: 1, big: 2, hrs: 3, wood: 4, trees: 5 };
  for (const t of LEVELS) { L[`gt${t}`] = Object.keys(L).length; L[`sv${t}`] = Object.keys(L).length; if (t > LEVELS[0]) L[`lt${t}`] = Object.keys(L).length; }
  // Each layer's cell (x, y) at P[(y + G + 1) * M + x + G + 1], then summed in place from the corner (row 0 and
  // column 0 stay 0): P[(y + 1) * M + x + 1] = the cells [0, x] × [0, y].
  const P = Object.keys(L).map((k) => (k === "hrs" || k === "wood" ? new Float64Array(M * M) : new Int32Array(M * M))); // counts in whole numbers (a third the memory)
  const at = (x, y) => (x >= -G && y >= -G && x < G && y < G ? (y + G + 1) * M + (x + G + 1) : -1);
  const cellOf = (x, y) => (y + G) * N + (x + G); // the distance fields' index
  const water = [], road = [];
  for (const p of land.list) {
    const n = p.cells.length;
    const c = p.k === "water" || p.k === "crag" ? null : clearOf(p, true, "clear");
    const wood = WOODY.has(p.k) && c ? c.get.wood || 0 : 0;
    for (let j = 0; j < n; j++) {
      const [x, y] = p.cells[j], i = at(x, y);
      if (i < 0) continue;
      if (p.k === "water") { P[L.bad][i] = 1; water.push(cellOf(x, y)); continue; }
      P[L.solid][i] = 1;
      if (p.k === "crag") { P[L.bad][i] = 1; for (const t of LEVELS) P[L[`gt${t}`]][i] = 1; }
      if (BIG.has(p.k)) P[L.big][i] = 1;
      if (SIGHT_BLOCK.has(p.k)) for (const t of LEVELS) P[L[`sv${t}`]][i] = 1;
      if (c) P[L.hrs][i] += c.hours / n; // a piece's hours spread over its cells (bestSite weighs the best in full)
      if (!j && wood) { P[L.wood][i] += wood; if (p.k === "tree") P[L.trees][i] += 1; }
    }
  }
  for (let y = -G; y < G; y++) for (let x = -G; x < G; x++) {
    const i = at(x, y), h = (land.heights && land.heights.get(`${x},${y}`)) || 0;
    for (const t of LEVELS) {
      if (h > t) { P[L[`gt${t}`]][i] = 1; P[L[`sv${t}`]][i] = 1; }
      else if (h < t && t > LEVELS[0]) P[L[`lt${t}`]][i] = 1;
    }
  }
  for (const [k, f] of land.floors || []) if (f === "road") { const c = k.indexOf(","), x = +k.slice(0, c), y = +k.slice(c + 1); if (at(x, y) >= 0) road.push(cellOf(x, y)); }
  for (const s of P) for (let y = 1; y <= N; y++) { let row = 0; for (let x = 1; x <= N; x++) { row += s[y * M + x]; s[y * M + x] = s[(y - 1) * M + x] + row; } }
  const sum = (layer, x0, y0, x1, y1) => {
    const a = Math.max(0, x0 + G), b = Math.max(0, y0 + G), c = Math.min(N, x1 + G), d = Math.min(N, y1 + G);
    if (c <= a || d <= b) return 0;
    const s = P[L[layer]];
    return s[d * M + c] - s[b * M + c] - s[d * M + a] + s[b * M + a];
  };
  const area = (x0, y0, x1, y1) => Math.max(0, Math.min(G, x1) - Math.max(-G, x0)) * Math.max(0, Math.min(G, y1) - Math.max(-G, y0));
  g = { G, N, sum, area, water: distField(N, water), road: distField(N, road) };
  gridCache.unshift([land, g]);
  gridCache.length = Math.min(gridCache.length, 3);
  return g;
}
// Cells (eight ways) from the nearest source to each cell, or null with none.
function distField(N, src) {
  if (!src.length) return null;
  const d = new Int32Array(N * N).fill(-1), q = new Int32Array(N * N);
  let h = 0, t = 0;
  for (const i of src) if (d[i] < 0) { d[i] = 0; q[t++] = i; }
  while (h < t) {
    const i = q[h++], x = i % N, y = (i - x) / N;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx;
      if (d[j] < 0) { d[j] = d[i] + 1; q[t++] = j; }
    }
  }
  return d;
}
const distAt = (g, field, at) => (field ? field[(at[1] + g.G) * g.N + (at[0] + g.G)] : null);

// ---------- the facts ----------
// Is the box all on one level (gt<t>: the cells higher than t; at level t: those over t-1 and not over t)?
const onOneLevel = (g, x0, y0, x1, y1) => {
  const n = (x1 - x0) * (y1 - y0), gt = (t) => (t < LEVELS[0] ? n : g.sum(`gt${t}`, x0, y0, x1, y1));
  return LEVELS.some((t) => gt(t - 1) - gt(t) === n);
};
const lvOf = (t) => Math.max(LEVELS[0], Math.min(LEVELS[LEVELS.length - 1], t));
const ringLv = (g, kind, t, at, r0, r1) => (kind === "lt" && lvOf(t) === LEVELS[0] ? 0 : ring(g, `${kind}${lvOf(t)}`, at, r0, r1));
const ring = (g, layer, at, r0, r1) => { const [x, y] = at; return g.sum(layer, x - r1, y - r1, x + r1 + 1, y + r1 + 1) - g.sum(layer, x - r0 + 1, y - r0 + 1, x + r0, y + r0); };
const ringArea = (g, at, r0, r1) => { const [x, y] = at; return g.area(x - r1, y - r1, x + r1 + 1, y + r1 + 1) - g.area(x - r0 + 1, y - r0 + 1, x + r0, y + r0); };
const sq = (g, layer, at) => { const B = siteBox(at); return g.sum(layer, B.x0, B.y0, B.x1, B.y1); };
// The lie of the land round the camp (level once it stands): "high" (looks down on the ground round it), "low"
// (overlooked), "flat", "uneven".
const lieOf = (higher, lower) => (higher + lower < 0.08 ? "flat" : lower >= 0.2 && lower > higher * 2 ? "high" : higher >= 0.2 && higher > lower * 2 ? "low" : "uneven");
// How far a base's yard can grow round a fire at `at` (half-size: a hub's GRID.hub.cap, less near the map's edge:
// basemap.js edgeRoom).
const yardRoom = (at) => Math.max(0, Math.min(GRID.hub.cap, GRID_MAX - NO_BUILD - 2 - Math.max(Math.abs(at[0]), Math.abs(at[1]))));

/**
 * The facts of a spot that are the land's alone (no team: a cutting tool to hand), for the game's pick and siteInfo: {
 * at, work, ground, lie, sight, room, yard, wood, trees, water, road, big }. at should take the camp.
 * @param {any} land basemap.js siteLand (or any land: pieces, list, floors, heights) @param {number[]} at
 */
export function landFacts(land, at) {
  const g = gridsOf(land), I = SITE_INFO;
  // The 5 × 5 itself: its clearing (with a cutting tool), its ground levelled to its own level (siteLevel, as
  // basemap.js siteYield: an open hilltop is level already, the camp stands on it).
  const B = siteBox(at), seen = new Set(), level = siteLevel(land, at);
  let work = CAMP.fireHours, dig = 0, hi = 0, lo = 0;
  for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) {
    const h = ((land.heights && land.heights.get(`${x},${y}`)) || 0) - level;
    hi = Math.max(hi, h); lo = Math.min(lo, h);
    const p = land.pieces.get(`${x},${y}`);
    if (p && p.k === "water") continue;
    if (!p || p.k === "rise" || p.k === "dip") { const d = CLEAR[h > 0 ? "rise" : "dip"].hours * Math.abs(h); work += d; dig += d; continue; }
    if (seen.has(p)) continue;
    seen.add(p);
    const c = clearOf(p, true, "clear");
    if (!c) continue;
    work += c.hours;
    if (p.k === "slope") dig += c.hours;
  }
  // The ring round it: higher and lower ground than the camp (hills 1 to 3 up and the mountain's crag 3 to 13 alike;
  // hollows; a camp on a hill looks down on the plain).
  const rn = Math.max(1, ringArea(g, at, I.LIE[0], I.LIE[1]));
  const higher = ringLv(g, "gt", level, at, I.LIE[0], I.LIE[1]) / rn, lower = ringLv(g, "lt", level, at, I.LIE[0], I.LIE[1]) / rn;
  // Sight within SIGHT (the camp's own 5 × 5 left out: it is cleared), over ground no higher than the camp.
  const sv = `sv${lvOf(level)}`, sn = Math.max(1, g.area(at[0] - I.SIGHT, at[1] - I.SIGHT, at[0] + I.SIGHT + 1, at[1] + I.SIGHT + 1) - SITE.SIZE * SITE.SIZE);
  const sight = 1 - Math.max(0, g.sum(sv, at[0] - I.SIGHT, at[1] - I.SIGHT, at[0] + I.SIGHT + 1, at[1] + I.SIGHT + 1) - sq(g, sv, at)) / sn;
  // Room to grow: the shelter's yard round it.
  const R = I.ROOM, rb = { x0: at[0] - R, y0: at[1] - R, x1: at[0] + R, y1: at[1] + R };
  const roomN = Math.max(1, g.area(rb.x0, rb.y0, rb.x1, rb.y1)), room = 1 - g.sum("solid", rb.x0, rb.y0, rb.x1, rb.y1) / roomN;
  // Wood within WOOD (beyond the 5 × 5: its wood is the setup's yield).
  const W = I.WOOD, wb = [at[0] - W, at[1] - W, at[0] + W + 1, at[1] + W + 1];
  const wood = Math.round(g.sum("wood", ...wb) - sq(g, "wood", at)), trees = Math.round(g.sum("trees", ...wb) - sq(g, "trees", at));
  const water = distAt(g, g.water, at), road = distAt(g, g.road, at);
  return {
    at: [at[0], at[1]], work: Math.round(work * 10) / 10,
    ground: { level: !hi && !lo, hi, lo, dig: Math.round(dig * 10) / 10, at: level }, // hi, lo: from the camp's level (at)
    lie: { kind: lieOf(higher, lower), higher: r2(higher), lower: r2(lower) },
    sight: r2(sight), room: r2(room), yard: yardRoom(at),
    wood, trees, water: water == null ? null : Math.max(0, water - 2), road: road == null ? null : Math.max(0, road - 2), // from the 5 × 5's edge
    big: sq(g, "big", at) > 0,
  };
}
const r2 = (v) => Math.round(v * 100) / 100;

/** The score of a spot's facts (higher is better) and its parts, in work-hours saved (SITE_SCORE). @param {any} f */
export function siteScore(f) {
  const S = SITE_SCORE;
  const near = (d, a, b) => (d == null ? 0 : d <= a ? 1 : d >= b ? 0 : (b - d) / (b - a));
  const parts = {
    time: -S.TIME * f.work,
    high: S.HIGH * (f.lie.lower - f.lie.higher),
    sight: S.SIGHT * f.sight,
    water: S.WATER * near(f.water, S.WATER_NEAR, S.WATER_FAR),
    road: S.ROAD * near(f.road, 0, S.ROAD_FAR),
    room: S.ROOM * f.room,
    wood: S.WOOD * Math.min(1, f.wood / S.WOOD_FULL),
    yard: S.YARD * Math.min(1, f.yard / GRID.hub.cap),
    dead: -S.DEAD * ((f.dead && f.dead.count) || 0),
  };
  const total = Object.values(parts).reduce((a, v) => a + v, 0);
  return { total: Math.round(total * 100) / 100, parts };
}

/**
 * The facts of a camp's spot for team p (null: one person with a cutting tool): { ok, why, at, setup { hours, work,
 * workers, clear, n, get, tool }, other (the same without / with a cutting tool, or null when it changes nothing),
 * work, ground, lie, sight, room, roomClear, yard, wood, trees, water, waterTile, road, places [{ i, name, d, dir }],
 * dead { count, place, kinds }, score, picked (the game's own spot) }.
 * @param {any} state @param {any} p @param {number} tile @param {number[]} at
 */
export function siteInfo(state, p, tile, at) {
  const why = siteProblem(state, tile, at);
  if (why) return { ok: false, why, at };
  const land = siteLand(state, tile), f = landFacts(land, at);
  const tool = p ? null : true;
  const s = siteSetup(state, p, tile, at, tool), o = siteSetup(state, p, tile, at, !s.tool);
  const other = o.hours !== s.hours || (o.get.wood || 0) !== (s.get.wood || 0) ? { hours: o.hours, wood: o.get.wood || 0, tool: o.tool } : null;
  // The yard's clearing: the work-hours to clear the shelter's yard round it (each piece once).
  const R = SITE_INFO.ROOM, done = new Set();
  let roomClear = 0;
  for (let y = at[1] - R; y < at[1] + R; y++) for (let x = at[0] - R; x < at[0] + R; x++) {
    const q = land.pieces.get(`${x},${y}`);
    if (!q || done.has(q)) continue;
    done.add(q);
    const c = clearOf(q, s.tool, "clear");
    if (c) roomClear += c.hours;
  }
  const t = state.tiles[tile];
  const places = t ? knownPois(state, tile, p).map((i) => {
    const [hx, hy] = poiSpot(state, t, i), mx = (hx / BASE_SPOT.SCALE) * BASE_SPOT.HALF, my = (hy / BASE_SPOT.SCALE) * BASE_SPOT.HALF;
    const dx = mx - at[0], dy = my - at[1];
    return { i, name: poiName(t, i), d: Math.round(Math.hypot(dx, dy)), dir: dirWord(dx, dy) };
  }).sort((a, b) => a.d - b.d || a.i - b.i) : [];
  const th = siteThreat(state, tile);
  const dead = { count: th.count, place: th.place, kinds: th.count && th.mix ? mixText(th.mix, th.count) : "" };
  const w = waterSource(state, tile);
  const info = { ok: true, why: "", ...f, setup: { hours: s.hours, work: s.work, workers: s.workers, clear: s.clear, n: s.n, get: s.get, tool: s.tool, dig: s.dig }, other, roomClear: Math.round(roomClear * 10) / 10, places, dead, waterTile: w ? { kind: w.kind, dist: w.dist } : null };
  const best = bestSite(state, tile);
  return { ...info, score: siteScore(info), picked: best[0] === at[0] && best[1] === at[1] };
}
// "north-east" from the camp (x east, y south).
const DIRS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
function dirWord(dx, dy) {
  if (Math.hypot(dx, dy) < 4) return "";
  return DIRS[((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8];
}

// ---------- the game's pick ----------
// Kept by what the land is made from (basescatter.js landSpec: the tile's dice, its terrain, road and river), so a
// land made again gives the same spot without weighing it again.
const pickCache = new Map();
const pickKey = (state, tile) => { const s = landSpec(state, { tile }, { G: GRID_MAX, C: 0, tier: "camp", terrain: terrainOf(state, { tile }), fresh: true }); return `${s.seed}|${s.terrain}|${s.road}|${s.river}${s.riverSide}|${s.style}`; };
/** The game's spot for a camp on this tile: [x, y] (map coordinates of the fire). @param {any} state @param {number} tile */
export function bestSite(state, tile) {
  const key = pickKey(state, tile), hit = pickCache.get(key);
  if (hit) return hit.slice();
  const best = bestSiteOn(siteLand(state, tile), (at) => !siteProblem(state, tile, at)) || [0, 0];
  if (pickCache.size > 256) pickCache.clear();
  pickCache.set(key, best.slice());
  return best.slice();
}
/**
 * The best spot on a land ([x, y], or null with none): every spot in reach by the quick score, the best REFINE weighed
 * again in full (landFacts, siteScore) and checked by ok(at). @param {any} land @param {(at: number[]) => boolean} [ok]
 */
export function bestSiteOn(land, ok = () => true) {
  const g = gridsOf(land), I = SITE_INFO, S = SITE_SCORE, Rg = SITE_RANGE, cap = GRID.hub.cap;
  // Every spot in reach by the quick score (siteScore's sum, the setup's hours from each piece's share of its cells),
  // off the river and the crag; off buildings and high ground while any spot is. The best REFINE kept, best first.
  const R = I.ROOM, W = I.WOOD, V = I.SIGHT, [L0, L1] = I.LIE, sightN = (2 * V + 1) ** 2 - SITE.SIZE * SITE.SIZE, lo = SITE.LO, hi = SITE.LO + SITE.SIZE;
  const near = (d, a, b) => (d <= a ? 1 : d >= b ? 0 : (b - d) / (b - a));
  const order = (a, b) => b.q - a.q || a.d - b.d || Math.abs(a.at[0]) + Math.abs(a.at[1]) - (Math.abs(b.at[0]) + Math.abs(b.at[1])) || a.at[1] - b.at[1] || a.at[0] - b.at[0];
  const keep = (top, c) => {
    if (top.length >= I.REFINE && order(c, top[top.length - 1]) >= 0) return;
    let i = top.length;
    while (i > 0 && order(c, top[i - 1]) < 0) i--;
    top.splice(i, 0, c);
    if (top.length > I.REFINE) top.pop();
  };
  const clean = [], any = [];
  for (let y = -Rg; y <= Rg; y++) for (let x = -Rg; x <= Rg; x++) {
    const sx0 = x + lo, sy0 = y + lo, sx1 = x + hi, sy1 = y + hi;
    if (g.sum("bad", sx0, sy0, sx1, sy1)) continue;
    if (!onOneLevel(g, sx0, sy0, sx1, sy1)) continue; // basemap.js siteProblem: the square whole on one level
    const big = g.sum("big", sx0, sy0, sx1, sy1) > 0;
    const rn = Math.max(1, g.area(x - L1, y - L1, x + L1 + 1, y + L1 + 1) - g.area(x - L0 + 1, y - L0 + 1, x + L0, y + L0));
    const up = ring(g, "gt0", [x, y], L0, L1), down = ring(g, "lt0", [x, y], L0, L1); // the quick score on level ground (the full one at the spot's level: landFacts)
    const sight = 1 - Math.max(0, g.sum("sv0", x - V, y - V, x + V + 1, y + V + 1) - g.sum("sv0", sx0, sy0, sx1, sy1)) / sightN;
    const room = 1 - g.sum("solid", x - R, y - R, x + R, y + R) / (4 * R * R);
    const wood = g.sum("wood", x - W, y - W, x + W + 1, y + W + 1) - g.sum("wood", sx0, sy0, sx1, sy1);
    const d = Math.max(Math.abs(x), Math.abs(y)), yard = Math.max(0, Math.min(cap, GRID_MAX - NO_BUILD - 2 - d));
    const q = -S.TIME * (CAMP.fireHours + g.sum("hrs", sx0, sy0, sx1, sy1)) + (S.HIGH * (down - up)) / rn + S.SIGHT * sight
      + (g.water ? S.WATER * near(Math.max(0, distAt(g, g.water, [x, y]) - 2), S.WATER_NEAR, S.WATER_FAR) : 0)
      + (g.road ? S.ROAD * near(Math.max(0, distAt(g, g.road, [x, y]) - 2), 0, S.ROAD_FAR) : 0)
      + S.ROOM * room + S.WOOD * Math.min(1, wood / S.WOOD_FULL) + S.YARD * Math.min(1, yard / cap);
    const c = { at: [x, y], d, q };
    if (!big) keep(clean, c);
    keep(any, c);
  }
  const pool = clean.length ? clean : any;
  // The best of them weighed again in full (each piece's whole clearing), the one that truly takes the camp.
  for (const c of pool) c.q = ok(c.at) ? siteScore(landFacts(land, c.at)).total : -Infinity;
  pool.sort(order);
  return pool.length && pool[0].q > -Infinity ? pool[0].at.slice() : null;
}

// ---------- why ----------
/**
 * Why the game picked a spot, from its facts (siteInfo or landFacts): short phrases, the strongest first.
 * @param {any} f @returns {string[]}
 */
export function pickReasons(f) {
  const out = [];
  if (f.work <= 3) out.push(f.work <= CAMP.fireHours ? "nothing stands there to clear" : "it is quick to set up");
  if (f.ground && f.ground.level) out.push("it is on level ground");
  if (f.lie && f.lie.kind === "high") out.push("it looks down on the ground round it");
  else if (f.lie && f.lie.kind === "flat" && f.ground && f.ground.level && out.length < 2) out.push("nothing overlooks it");
  if (f.room >= 0.8) out.push("there is open ground round it to grow");
  if (f.sight >= 0.85) out.push("it has clear sight all round");
  if (f.wood >= 1200) out.push("there is wood near for the fires");
  if (f.water != null && f.water <= SITE_SCORE.WATER_NEAR) out.push("the river is near");
  if (f.road != null && f.road <= 10) out.push(f.road ? "the road is near" : "the road runs by it");
  if (out.length < 2 && f.yard >= GRID.hub.cap) out.push("it is near enough the middle for a base to grow");
  if (!out.length) out.push("it was the least work of the spots near the middle");
  return out.slice(0, 4);
}
/** "The game picked this spot because it is quick to set up, it is on level ground and …" @param {any} f */
export function pickWords(f) {
  const r = pickReasons(f);
  return `The game picked this spot because ${r.length > 1 ? `${r.slice(0, -1).join(", ")} and ${r[r.length - 1]}` : r[0]}.`;
}
