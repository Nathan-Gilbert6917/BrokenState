// @ts-check
// Ponds in the hollows (the user's word 2026-10-23: "Update weather effects for the new terrain with hollows turning
// into ponds (after x days of no more rain the water goes away and it turns to mud filled hollow and if the water still
// exists and winter sets in it turns into a frozen pond and hills are harder to climb in rain and very hard in winter"):
// the hollows of the lie of the land (basescatter.js reliefLayer, relief.js: a cell's ground below level, combat.js
// groundH with c.ter; the base map's land.heights) fill with the tile's own rain, drain, dry out and freeze by its
// weather, a day at a time.
//   - One state a tile, not a cell: { d (the day), dry (days with no rain since the hollows last filled; DRY: dry
//     through), ice (frozen over) }, stepped a day at a time (pondStep) from the tile's own weather (weather.js
//     weatherOnDay: the front that sat over it, else the day's sky; iceIndex, the freezing index): a day's rain (FILL)
//     or a thaw (MELT of the snow cover gone) fills them (dry 0); a day with no rain or snow and no ice dries them a day
//     (a heat wave or a dry spell HOT days); while the freezing index is past FREEZE the water is ice and keeps (nothing
//     drains under ice) and the mud is frozen hard.
//   - Your bases keep theirs (base.ponds, ticked at midnight: pondsDaily); any other tile's is worked out from the last
//     LOOK days of its weather when a fight or a raid is made there (pondsOn), so it is the same whenever it is asked.
//   - A cell's state (cellWet): the hollow holds water until DRAIN days with no rain (the user's "x days"), then mud
//     MUD days more, then dry ground; all of a tile's hollows alike (they are all a level down, basescatter.js HIGH
//     DIP_MIN across). The water stands WATER of a level over a level-down floor; the middle of a pond, DEEP_IN cells
//     or more in from its rim (or ground dug down further), is over a person's head: deep.
//   - On a battle map (pondsBattle, from combat.js createBattle / createRaid): c.wet "wade" | "deep" | "mud" | "ice",
//     c.wl the water's level. Deep water is the river's water (CELL.water: no way through, as a river with no ford)
//     unless that would cut some of the map off from the rest; then it is waded, deeper (COST.deep). Wading costs
//     COST.wade more a step and SHOOT_WADE off a shot from it, mud COST.mud, the ice COST.ice (slippery).
//   - Building: nothing on a pond or mud until it is dry, nor is a wet hollow filled in (pondWhy: basemap.js
//     placeProblemAt; pondWaits: the clearing job waits).
//   - Climbing (climbWx): the ground's climb (combat.js climbCost) × CLIMB.rain in the rain, × CLIMB.winter in winter
//     or in snow (b.climbX on the battle; ladders and stairs as they were).
// Ponds on the State Map (the user's words 2026-10-23: "add pond decor to the world map when a tile has a pond in the
// world map generate a pond in the battle map"): a pond tile (mapgen.js tile.pond) has one hollow fed by a spring
// (basescatter.js SPRING on its base map, relief.js on a fight's or a raid's: c.spring): water whatever the rain, never
// mud nor dry (springSt), ice while the freezing index is past FREEZE like the rest (pondIce: the same for every tile,
// as the freezing index is), and otherwise a pond like any other (wading, deep water, the aim, nothing built on it).
import { weatherOnDay, weatherAt, iceIndex, dayIndex, season } from "./weather.js";
import { CELL, mapLv } from "./combat.js"; // call-time only
/** @import { State } from "./types" */

export const PONDS = {
  FILL: 0.25,         // a day's rain (weather.js rain, 0–1: a rain day 0.3–0.6, a storm 0.75–1) that fills the hollows
  MELT: 0.1,          // snow cover gone in a day (the thaw) that fills them too
  DRAIN: 4,           // days with no rain until a hollow's water is gone, leaving mud (the user's "after x days")
  MUD: 4,             // days more until the mud has dried
  HOT: 2,             // a heat wave or a dry spell day dries as much as this many
  FREEZE: 3,          // the freezing index (weather.js ICE: degree-days below 0 °C) a pond is ice at (a river: 30)
  LOOK: 30,           // days of weather looked back over for a tile with no record of its own
  WATER: 0.6,         // levels of water over a hollow's floor (a level down: its surface 0.4 of a level under the rim)
  DEEP_IN: 3,         // cells in from a pond's rim where it is over a person's head
  COST: { wade: 1, deep: 2, mud: 0.5, ice: 0.25 }, // moves added to a step into it
  SHOOT_WADE: 15,     // aim off a shot fired standing in water
};
const DRY = PONDS.DRAIN + PONDS.MUD; // dry through
// A spring-fed hollow's state under the tile's hollows `st`: full whatever the rain, frozen when they are.
export const springSt = (st) => ({ d: st ? st.d : 0, dry: 0, ice: !!(st && st.ice) });
// Are the ponds frozen on day D (the freezing index past FREEZE at its noon, as pondStep reads it)? The same on every
// tile (weather.js iceIndex is the state's): the State Map's pond decor (ui/terraindeco.js) and its tooltip.
/** @param {State} state @param {number} [D] */
export const pondIce = (state, D = dayIndex(state)) => { try { return iceIndex(state, D * 24 + 12) >= PONDS.FREEZE; } catch { return false; } };
export const CLIMB = { rain: 1.5, winter: 2.5 };

// The tile's weather that day, as the hollows feel it (dayIdx 0: the campaign's first day).
/** @param {State} state @param {number} tileId @param {number} i */
function dayWx(state, tileId, i) {
  const w = weatherOnDay(state, i + 1, tileId), prev = i > 0 ? weatherOnDay(state, i, tileId) : null;
  return { key: w.key, rain: w.rain || 0, snow: w.snow || 0, melt: prev ? Math.max(0, (prev.snowCover || 0) - (w.snowCover || 0)) : 0, ice: iceIndex(state, i * 24 + 12) };
}
// A day on the hollows: { d, dry, ice } the day after `st`.
/** @param {{ d: number, dry: number, ice: boolean }} st @param {{ key: string, rain: number, snow: number, melt: number, ice: number }} w */
export function pondStep(st, w) {
  const ice = w.ice >= PONDS.FREEZE, d = st.d + 1;
  if (!ice && (w.rain >= PONDS.FILL || w.melt >= PONDS.MELT)) return { d, dry: 0, ice };
  if (ice || w.rain > 0 || w.snow > 0) return { d, dry: st.dry, ice }; // under ice, in a drizzle or under falling snow nothing dries
  return { d, dry: Math.min(DRY, st.dry + (w.key === "heat" || w.key === "drought" ? PONDS.HOT : 1)), ice };
}
const ownBase = (state, tileId) => (state.bases || []).find((b) => b && b.tile === tileId && !b.group && b.ponds);
// Worked out from the weather (no base's record), the last few asked kept: the same for the same weather.
let memoW = null;
const memo = new Map();
/** The hollows of a tile on a day: { d, dry, ice }. @param {State} state @param {number} tileId @param {number} [D] */
export function pondsOn(state, tileId, D = dayIndex(state)) {
  const b = ownBase(state, tileId);
  if (b && b.ponds.d <= D && D - b.ponds.d <= PONDS.LOOK) {
    let st = { d: b.ponds.d, dry: b.ponds.dry, ice: !!b.ponds.ice };
    while (st.d < D) st = pondStep(st, dayWx(state, tileId, st.d + 1));
    return st;
  }
  if (memoW !== state.weather || memo.size > 256) { memo.clear(); memoW = state.weather; }
  const key = `${tileId}|${D}`, hit = memo.get(key);
  if (hit) return hit;
  let st = { d: Math.max(0, D - PONDS.LOOK) - 1, dry: DRY, ice: false };
  while (st.d < D) st = pondStep(st, dayWx(state, tileId, st.d + 1));
  memo.set(key, st);
  return st;
}
// At midnight (world.js, after weatherDaily): each of your bases' hollows a day on.
/** @param {State} state */
export function pondsDaily(state) {
  const D = dayIndex(state);
  for (const b of state.bases || []) {
    if (!b || b.group || b.tile == null || (b.ponds && b.ponds.d === D)) continue;
    const st = pondsOn(state, b.tile, D);
    b.ponds = { d: st.d, dry: st.dry, ice: st.ice };
  }
}
/**
 * A hollow's cell `depth` levels down, `inner` cells in from its rim (1: at the rim, the default), under the
 * tile's hollows `st`: { s: "wade" | "deep" | "mud" | "ice", wl (the water's level, or the mud's) } or null (dry ground).
 * @param {{ dry: number, ice: boolean } | null} st @param {number} depth @param {number} [inner]
 */
export function cellWet(st, depth, inner = 1) {
  if (!st || !(depth >= 1)) return null;
  if (st.dry < PONDS.DRAIN) return { s: st.ice ? "ice" : depth > 1 || inner >= PONDS.DEEP_IN ? "deep" : "wade", wl: PONDS.WATER - 1 }; // level with a level-down pond's water
  if (!st.ice && st.dry < PONDS.DRAIN + PONDS.MUD) return { s: "mud", wl: -depth };
  return null;
}

// ---------- on a battle map ----------
// The cells' components over walkable ground (4-way): an id a cell, -1 for none.
function comps(cells, W, H) {
  const lab = new Int32Array(W * H).fill(-1);
  let n = 0;
  for (let s = 0; s < W * H; s++) {
    if (lab[s] >= 0 || !CELL[cells[s].k] || !CELL[cells[s].k].walk) continue;
    const q = [s];
    lab[s] = n;
    while (q.length) {
      const i = q.pop(), x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) if (j >= 0 && lab[j] < 0 && CELL[cells[j].k] && CELL[cells[j].k].walk) { lab[j] = n; q.push(j); }
    }
    n++;
  }
  return lab;
}
// Does any part of the ground walked before (lab0) fall apart now?
function splits(cells, W, H, lab0) {
  const lab1 = comps(cells, W, H), to = new Map();
  for (let i = 0; i < W * H; i++) {
    if (lab1[i] < 0 || lab0[i] < 0) continue;
    const m = to.get(lab0[i]);
    if (m == null) to.set(lab0[i], lab1[i]); else if (m !== lab1[i]) return true;
  }
  return false;
}
/**
 * The tile's ponds, mud and ice on a battle map's hollows (c.ter, c.h < 0), and the weather on its slopes (b.climbX,
 * b.climbWhy, b.snowLie: the snow lying, for the view). Nothing at all on a map with no ground of its own (no hills,
 * no hollows: the weather is not even asked). Deep water becomes the river's (no way through; b.reach without it)
 * where no part of the map is cut off by it. Returns the cells made wet.
 * @param {State} state @param {any} b @param {number} tileId
 */
export function pondsBattle(state, b, tileId) {
  const { cells, w: W, h: H } = b;
  if (tileId == null || !state || !state.tiles || !cells.some((c) => c.ter)) return 0;
  const cw = climbWx(state, tileId);
  if (cw.x !== 1) { b.climbX = cw.x; b.climbWhy = cw.why; }
  try { const wx = weatherAt(state, tileId); if ((wx.snowCover || 0) >= 0.15) b.snowLie = Math.round(Math.min(1, wx.snowCover) * 4) / 4; } catch { /* no weather */ }
  // Sunk ground: below level ground (a base's map on a hill is laid from its own level: combat.js mapLv; its c.h, wl too).
  const lv = mapLv(b), sunk = (c) => c.ter && !c.bld && c.h + lv < 0; // c.bld: a building's floor in a hollow stays dry (basemap.js groundBuilt)
  if (!cells.some(sunk)) return 0;
  const st = pondsOn(state, tileId), sp = springSt(st);
  if (!cellWet(st, 1) && !cells.some((c) => c.spring && sunk(c))) return 0; // a pond tile's spring is never dry
  // How far in from its rim each hollow cell is (eight ways; the map's edge is no rim): its middle is deep.
  const inner = new Uint16Array(W * H), q = [];
  for (let i = 0; i < W * H; i++) if (sunk(cells[i])) inner[i] = 0xffff; else q.push(i);
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy, j = ny * W + nx; if (nx >= 0 && ny >= 0 && nx < W && ny < H && inner[j] === 0xffff) { inner[j] = inner[i] + 1; q.push(j); } }
  }
  const deep = [];
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    const c = cells[i];
    if (!sunk(c)) continue;
    const wet = cellWet(c.spring ? sp : st, -(c.h + lv), inner[i]);
    if (!wet) continue;
    c.wet = wet.s; c.wl = wet.wl - lv; n++;
    if (wet.s === "deep" && c.k === "open") deep.push(i);
  }
  if (n) b.ponds = { dry: st.dry, ice: st.ice, ...(cells.some((c) => c.spring && c.wet) ? { spring: true } : {}) };
  if (!deep.length) return n;
  // Deep water: no way through, unless that cuts some of the map off (then waded, all of it, or each pond that can be).
  const lab0 = comps(cells, W, H);
  for (const i of deep) cells[i].k = "water";
  if (splits(cells, W, H, lab0)) {
    for (const i of deep) cells[i].k = "open";
    const inDeep = new Set(deep), seen = new Set();
    for (const s of deep) {
      if (seen.has(s)) continue;
      const blob = [s];
      seen.add(s);
      for (let k = 0; k < blob.length; k++) { const i = blob[k], x = i % W; for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) if (inDeep.has(j) && !seen.has(j)) { seen.add(j); blob.push(j); } }
      for (const i of blob) cells[i].k = "water";
      if (splits(cells, W, H, lab0)) for (const i of blob) cells[i].k = "open";
    }
  }
  if (b.reach) for (const i of deep) if (cells[i].k === "water") b.reach[i] = 0;
  return n;
}
// The moves a step into a cell costs more for its water, mud or ice (combat.js reachable, distField).
export const wetCost = (c) => (c && c.wet ? PONDS.COST[c.wet] || 0 : 0);
// The aim off a shot fired by someone standing in water.
export const wadeAim = (c) => (c && (c.wet === "wade" || c.wet === "deep") ? PONDS.SHOOT_WADE : 0);
/**
 * How much harder the ground is to climb in the weather (combat.js climbCost: the ground's own hills and hollows):
 * { x, why }: × CLIMB.winter in winter or in snow (falling or lying), × CLIMB.rain in the rain.
 * @param {State} state @param {number} tileId @param {number} [hour]
 */
export function climbWx(state, tileId, hour = state.hour) {
  let w;
  try { w = weatherAt(state, tileId, hour); } catch { return { x: 1, why: "" }; }
  if (!w) return { x: 1, why: "" };
  if (season(state, hour).key === "winter" || w.key === "snow" || w.key === "blizzard" || (w.snowCover || 0) >= 0.25) return { x: CLIMB.winter, why: w.key === "snow" || w.key === "blizzard" ? "snow" : (w.snowCover || 0) >= 0.25 ? "snow on the slopes" : "winter, the slopes frozen" };
  if (w.key === "rain" || w.key === "storm") return { x: CLIMB.rain, why: w.key === "storm" ? "the storm" : "the rain" };
  return { x: 1, why: "" };
}

// The battle's hover words (ui/combat.js previewText): a cell's water, mud or ice, and the climb in the weather.
export function wetWord(c) {
  if (!c || !c.wet) return "";
  const days = (n) => `${n} day${n === 1 ? "" : "s"}`;
  if (c.spring) { // a pond tile's spring-fed pond: it never drains
    if (c.wet === "deep" && c.k === "water") return `<b>Deep water</b>: a spring-fed pond, over a person's head in the middle. No way through (as a river); round it, or wade the shallows at its edge.`;
    if (c.wet === "deep") return `<b>Deep water</b>: the middle of a spring-fed pond, up to the chest: wading, +${PONDS.COST.deep} moves a step in, −${PONDS.SHOOT_WADE} aim to shoot from it. It never dries.`;
    if (c.wet === "wade") return `<b>A pond</b>: spring water in the hollow, up to the knees: wading, +${PONDS.COST.wade} move a step in, −${PONDS.SHOOT_WADE} aim to shoot from it. It never dries.`;
    if (c.wet === "ice") return `<b>A frozen pond</b>: spring-fed, frozen over: walked across, slippery (+${PONDS.COST.ice} moves a step in). Water again when it thaws.`;
  }
  if (c.wet === "deep" && c.k === "water") return `<b>Deep water</b>: a pond filled by the rain, over a person's head in the middle of the hollow. No way through (as a river); round it, or wade the shallows at its edge.`;
  if (c.wet === "deep") return `<b>Deep water</b>: the middle of a pond filled by the rain, up to the chest: wading, +${PONDS.COST.deep} moves a step in, −${PONDS.SHOOT_WADE} aim to shoot from it. It drains to mud after ${days(PONDS.DRAIN)} with no rain.`;
  if (c.wet === "wade") return `<b>A pond</b>: rain water in the hollow, up to the knees: wading, +${PONDS.COST.wade} move a step in, −${PONDS.SHOOT_WADE} aim to shoot from it. It drains to mud after ${days(PONDS.DRAIN)} with no rain.`;
  if (c.wet === "mud") return `<b>Mud</b>: a hollow the water has drained from: +${PONDS.COST.mud} moves a step in. Dry after ${days(PONDS.MUD)} more with no rain.`;
  if (c.wet === "ice") return `<b>A frozen pond</b>: walked across, slippery (+${PONDS.COST.ice} moves a step in). Water again when it thaws.`;
  return "";
}
const CLIMB_WORD = `rain ×${CLIMB.rain}, winter or snow ×${CLIMB.winter}`;
export const climbWord = (b) => (b && b.climbX > 1 ? `The climb costs ×${b.climbX} in ${b.climbWhy || "this weather"} (${CLIMB_WORD}).` : "");

// ---------- the base map ----------
// Why nothing can stand on these cells (grid coordinates) while the hollows under them are wet, or "". st: the base's
// hollows (pondsOn), heights: its land's ground (basescatter.js landOf heights, "x,y" → h; what layLand lays).
// springs: the cells of a pond tile's spring-fed hollow (landOf springs): never dry, never built on nor filled in.
/** @param {{ dry: number, ice: boolean } | null} st @param {Map<string, number> | null | undefined} heights @param {number[][]} cells @param {Set<string> | null} [springs] */
export function pondWhy(st, heights, cells, springs = null) {
  if (!st || !heights || !heights.size) return "";
  let worst = null;
  for (const [x, y] of cells) {
    const h = heights.get(`${x},${y}`);
    if (!(h < 0)) continue;
    if (springs && springs.has(`${x},${y}`)) return st.ice ? "A frozen pond, spring-fed: nothing is built on it or filled in, ever" : "A spring-fed pond: it never dries out, and nothing is built on it or filled in";
    const w = cellWet(st, -h);
    if (w) { worst = w; break; }
  }
  if (!worst) return "";
  const left = Math.max(1, PONDS.DRAIN + PONDS.MUD - st.dry); // until the mud has dried too
  if (worst.s === "ice") return "A frozen pond in the hollow: nothing is built on it or filled in until it has thawed and dried out";
  return `${worst.s === "mud" ? "Mud in the hollow" : "A pond in the hollow"}: nothing is built on it or filled in until it dries out (${left} day${left === 1 ? "" : "s"} with no rain)`;
}
// A clearing job that fills in a hollow still wet waits for it to dry (basemap.js siteWaits).
/** @param {State} state @param {any} base @param {any} job @param {Map<string, number> | null | undefined} heights @param {Set<string> | null} [springs] */
export function pondWaits(state, base, job, heights, springs = null) {
  if (!job || !job.pieces || !heights || !heights.size || !job.pieces.some((p) => p.k === "dip")) return false;
  const st = pondsOn(state, base.tile);
  return !!pondWhy(st, heights, job.pieces.filter((p) => p.k === "dip").flatMap((p) => p.cells), springs);
}

// ---------- the State Map ----------
// A pond tile's line in the map's tooltip (ui/render.js tileTooltip), or "".
/** @param {State} state @param {number} tileId */
export function pondTileWord(state, tileId) {
  const t = state && state.tiles ? state.tiles[tileId] : null;
  if (!t || !t.pond) return "";
  return pondIce(state) ? "A pond (spring-fed): frozen over, walked across in a fight" : "A pond (spring-fed): open water that never dries; waded at its edge in a fight";
}
