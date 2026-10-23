// @ts-check
// The ground by the season (the user's request 2026-10-23: "In raid and base view: Spring can create random mud on dirt
// tiles slows movement speed. Fall can have the red orange and brown leaves on the ground. Winter has snow on the
// ground slowing movement speed."): what lies on the level ground of a fight's, a raid's or a base's map (combat.js
// createBattle / createRaid, after ponds.js pondsBattle), from the calendar and the tile's own weather.
//   - Spring: patches of mud on the dirt (MUD.FLOORS: trodden earth and fields), more of them after rain (the hollows'
//     state, ponds.js pondsOn: days since the rain filled them) and none while the ground is frozen or snow lies.
//     Where the patches lie is the tile's and the year's (smooth noise from the cell, the tile and the year), so the
//     same spring's mud is in the same low spots and spreads out from them after rain. c.gnd "mud": MUD.COST more a
//     step (as a hollow's mud, ponds.js PONDS.COST.mud).
//   - Winter (any day snow lies, weather.js snowCover SNOW.MIN or more: as ponds.js b.snowLie): snow on all the
//     outdoor ground (SNOW.FLOORS; under a fence or a car too, not up on a walkway or a stand: SNOW.RAISED), not on
//     a pond (ponds.js: its ice keeps its own cost and its drifts). c.gnd "snow", c.sd its depth (snow cover in
//     quarters, as b.snowLie): SNOW.COST more a step, SNOW.DEEP_COST in deep snow.
//   - Autumn's fallen leaves are drawing only (ui/groundlook.js leafField, by ui/seasontrees.js's look): nothing on
//     the cells.
//   - Every side alike (docs/adr/0001-ai-parity.md): groundCost is in the step cost of combat.js reachable (people,
//     the AI's groups) and distField (the dead, every walker's field), next to ponds.js wetCost.
//   - Not on a map with no sky over it (the hive's chambers: NO_SKY) nor on a building's floors (their floor is "floor").
// b.ground = { key, mud (cells), snow (depth) }: the view's ground cache key (ui/isoview.js) changes with it.
// API: seasonGround(state, b, tileId) -> cells marked; groundCost(c); groundWord(c) (ui/combat.js hover);
//      mudShare(seasonKey, dry, ice) (the share of the dirt in mud).
import { weatherAt, season } from "./weather.js";
import { pondsOn, PONDS } from "./ponds.js"; // call-time only (ponds.js imports combat.js, which imports this)
/** @import { State } from "./types" */

export const MUD = {
  FLOORS: new Set(["dirt", "field"]), // trodden earth, a base's yard, a field's soil
  KINDS: new Set(["open", "bush", "outline", "tent", "torn"]), // ground cells (a bush's, a tent's ground too)
  BASE: 0.06,      // the share of the dirt in mud on a spring day with no rain for a while
  WET: 0.22,       // more right after rain (the hollows just filled), less each dry day (ponds.js DRAIN + MUD days)
  SCALE: 5,        // cells between the noise's points (patches a few cells across)
  COST: 0.5,       // moves added to a step into it (as a hollow's mud, ponds.js PONDS.COST.mud)
};
export const SNOW = {
  MIN: 0.15,       // snow cover (weather.js snowCover) from which it lies on the ground (ponds.js b.snowLie)
  FLOORS: new Set(["grass", "field", "dirt", "gravel", "road", "rubble"]), // outdoors (not a building's floor or roof)
  RAISED: new Set(["walkway", "stand", "tower", "ladder", "stairs", "roof", "loft", "water", "void"]), // not on the ground (or a river)
  COST: 0.25,      // moves added to a step in snow
  DEEP: 0.75,      // from this depth (snow cover) it is deep snow:
  DEEP_COST: 0.5,  // moves added to a step in deep snow
};
// Maps under ground (hivecrawl.js layouts): no weather.
const NO_SKY = new Set(["hivechamber", "hivecore"]);

function hash(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// Smooth value noise in 0..1 at cell (x, y): two octaves, the points SCALE cells apart.
function noise(x, y, seed) {
  const at = (s, k) => {
    const fx = x / s, fy = y / s, ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const a = hash(ix, iy, seed + k), b = hash(ix + 1, iy, seed + k), c = hash(ix, iy + 1, seed + k), d = hash(ix + 1, iy + 1, seed + k);
    return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
  };
  return at(MUD.SCALE, 0) * 0.7 + at(MUD.SCALE / 2.5, 7) * 0.3;
}
// The noise's values are bunched round the middle: the share wanted → the threshold that gives about that share.
let QUANT = null; // worked out the first time it is asked
function below(share) {
  if (share <= 0) return -1;
  if (share >= 1) return 2;
  if (!QUANT) { const v = []; for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) v.push(noise(x, y, 4242)); QUANT = v.sort((a, b) => a - b); }
  return QUANT[Math.floor(share * (QUANT.length - 1))];
}

/**
 * The share of the dirt in mud: spring only, none while the hollows are frozen; dry (ponds.js { dry }): days since rain
 * filled them, up to DRAIN + MUD (dry through).
 * @param {string} key @param {number} dry @param {boolean} [ice]
 */
export function mudShare(key, dry, ice = false) {
  if (key !== "spring" || ice) return 0;
  const through = PONDS.DRAIN + PONDS.MUD;
  return MUD.BASE + MUD.WET * Math.max(0, 1 - Math.max(0, dry) / through);
}
const lieOf = (cover) => (cover >= SNOW.MIN ? Math.round(Math.min(1, cover) * 4) / 4 : 0);

/**
 * The season on a battle map's level ground: c.gnd "mud" (spring) or "snow" (c.sd its depth) by the tile's weather;
 * b.ground for the view; b.snowLie set as ponds.js does when it was not (a map with no hills). Returns the cells marked.
 * @param {State} state @param {any} b @param {number | null} tileId
 */
export function seasonGround(state, b, tileId) {
  if (!b || !b.cells || tileId == null || !state || !state.tiles || (b.setup && NO_SKY.has(b.setup.layout))) return 0;
  let s, cover = 0;
  try { s = season(state); cover = weatherAt(state, tileId).snowCover || 0; } catch { return 0; } // no calendar or weather
  const lie = b.snowLie || lieOf(cover);
  let n = 0;
  if (lie > 0) {
    if (!b.snowLie) b.snowLie = lie;
    for (const c of b.cells) {
      if (c.plot) continue; // a crop plot is built: it keeps its own surface, never under the season's snow or mud (the user's word 2026-10-23: builds are the top layer)
      if (c.wet || !SNOW.FLOORS.has(c.f) || SNOW.RAISED.has(c.k)) continue; // under a fence or a car too (its look), walked or not
      c.gnd = "snow"; c.sd = lie; n++;
    }
    b.ground = { key: `s${lie}`, mud: 0, snow: lie };
    return n;
  }
  if (s.key !== "spring") return 0;
  const st = pondsOn(state, tileId);
  const share = mudShare(s.key, st.dry, st.ice);
  if (!(share > 0)) return 0;
  const cut = below(share), seed = (tileId * 7919 + (s.year || 1) * 104729) | 0; // this year's spring
  for (let i = 0; i < b.cells.length; i++) {
    const c = b.cells[i];
    if (c.plot) continue; // as above: a built plot's soil is not the season's mud
    if (c.wet || !MUD.FLOORS.has(c.f) || !MUD.KINDS.has(c.k)) continue;
    if (noise(i % b.w, (i / b.w) | 0, seed) >= cut) continue;
    c.gnd = "mud"; n++;
  }
  if (n) b.ground = { key: `m${seed}:${share.toFixed(3)}`, mud: n, snow: 0 };
  return n;
}
// The moves a step into a cell costs more for the season's mud or snow (combat.js reachable, distField).
/** @param {any} c */
export const groundCost = (c) => (!c || !c.gnd ? 0 : c.gnd === "mud" ? MUD.COST : c.gnd === "snow" ? ((c.sd || 0) >= SNOW.DEEP ? SNOW.DEEP_COST : SNOW.COST) : 0);
// The battle's hover words (ui/combat.js previewText).
/** @param {any} c */
export function groundWord(c) {
  if (!c || !c.gnd) return "";
  if (c.gnd === "mud") return `<b>Spring mud</b>: soft ground after the thaw and the rain, +${MUD.COST} moves a step in (more of it the wetter the spring).`;
  if (c.gnd === "snow") {
    const deep = (c.sd || 0) >= SNOW.DEEP;
    return `<b>${deep ? "Deep snow" : "Snow"} on the ground</b> (${Math.round((c.sd || 0) * 100)}% cover): +${groundCost(c)} moves a step in, people and the dead alike${deep ? "" : ` (+${SNOW.DEEP_COST} in deep snow)`}.`;
  }
  return "";
}
