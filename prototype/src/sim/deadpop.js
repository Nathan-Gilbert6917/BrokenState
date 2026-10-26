// @ts-check
// The dead and the raiders on the land: real counts per tile and per POI (the heat epic #64, issue #65; the user's
// request 2026-10-26: "This is the heat system not an arbitrary number that goes up and zombies just spawn from. A tile
// has a base level zombie and raiders and a POI you raid does too. … Every zombie kill reduces the POI level and the
// Tile level. … rural areas will always have less zombie threat level than a city tile.").
//
// TWO LEVELS. Each land tile holds a count of the dead and of raiders, and each of its POIs (pois.js tile.pois) a count
// of its own. The POIs' counts are part of the tile's: tileDead = openDead (the open ground's) + Σ poiDead, so one kill
// always lowers both. The same for raiders (tileRaiders = openRaiders + Σ poiRaiders).
// THE CAP (popCap, raiderCap): by the tile's land class (placement.js tileClass): a city centre ≫ a city ≫ the suburbs >
// a town > a highway's land > farmland, the coast > the wild (scenic: forest, hills, mountains), DEADPOP.CAP, × the
// run's Dead at sites dial, × HIVE_CAP on a hive's land. A rural cap is always below a city cap. No daily rise ever goes
// above it.
// SEEDING (the generated default, seedOf): what a tile holds untouched, from the world's facts as they stand now:
//   - a POI: the old raid roster's formula without its dice (scavenge.js raidEnemies: 1 + 5 × infection, +1 on a city
//     block, + the kind's danger (pois.js LOCATIONS; outside the cities and towns at most 1, as data.js siteDanger), +2 on
//     a hive's land), × the building's size (placement.js sizeFor: SIZE_K), × the year's growth of the hordes (eras.js
//     hordeGrowth) × the Dead at sites dial, ± a hash die (JITTER);
//   - the tile: cap × (FILL by class + INF_FILL × infection + HIVE_FILL on a hive's land) × hordeGrowth, ± a hash die;
//     its open ground is that less the POIs' (never below 0);
//   - raiders: RAIDERS by class (nomads, outsider bands and drifters on the roads), + OWNED on a hostile group's land; a
//     POI holds a band of POI_RAIDERS (the old raid's "rival scavengers" 15% roll, now a hash die per POI, likelier as
//     the tile's raiders near their cap), drawn from the tile's.
// A tile nobody has touched is never stored: its counts are its default, read when asked (so a world made before this
// module, or a new one, needs nothing at generation). The first kill, draw, noise or old-save fold on a tile stores its
// record (state.deadPop[tileId], plain data, saved as it is): only the tiles that differ from their defaults are kept
// (deadPopDaily drops a record back at its default with nothing remembered: the poiMods pattern).
// Record: { o: open dead, p: [dead per POI index], r: open raiders, q: [raiders per POI], n: tile noise, pn: { i: POI
// noise }, k: recent kills, rn: raiding seen here }.
// NOISE (noteNoise / noiseOf): a decaying memory per tile and per POI (× NOISE_DECAY a day: about 3 days). Shots, loud
// kills, going in and out of places (pois.js addTileHeat, now a thin wrapper over it) and other groups' raids add to it.
// KILLS (killDead / killRaiders): n off the POI (as many as it holds) and the rest off the open ground; the tile's count
// falls by all of them. Each kill adds to the tile's recent-kill memory (recentKills, for #64 §8's spread) and to the
// noise: LOUD_KILL a kill when loud (gunfire, explosives), QUIET_KILL when quiet (melee, bows, suppressed, takedowns).
// DRAWS (drawFromTile / putBack): reinforcements, surges, a camp's trickle, a hunt's encounters come out of the open
// ground; the ones that walk away alive go back. A battle on the map counts at its end (deadPopBattleEnd, combat.js
// finishCombat): the reinforcements (u.drawn; b.reinfMax: the open ground within earshot, earshot()) killed come off the open
// ground, the rest stay there; the map's own dead killed come off the POI, scaled to the roster it was given (a map
// shows at most ROSTER_MAX of a POI's dead: kills × roster / placed).
// BANDS (deadBand / raiderBand): none / low / medium / high / overrun of the count against the cap (a POI's against its
// own cap, poiCap: its seed × POI_CAP), with skulls.
// THE DAY (deadPopDaily, world.js at midnight, where tile heat's daily fall was): for each stored tile, by its band and
// yesterday's noise (loud: noise ≥ LOUD):
//   - low tile (and every POI low): a very small chance (DAY.lowP) of a very small rise (+1);
//   - medium: quiet, a small chance (medP) of a small rise (medRise of the cap); loud, a larger chance (medLoudP) and
//     rise (medLoudRise);
//   - high or overrun: drifts toward the cap (highDrift of the gap a day, highLoudDrift after a loud night);
//   - a quiet day's rise (all three) stops at the tile's own level, its generated default (× quietCeil): only a loud
//     night raises it past that toward the cap. Without that, every tile the spread (deadspread.js) touched, so stored,
//     rose to its cap within months (the fix to #66, the user's decision 2026-10-26: a 2-year run had 97% of the land
//     overrun by year 1); the spread itself still fills the land near the towns, cities and hives up to the caps;
//   - first, a count over its cap is trimmed to it (a POI's excess goes to the open ground, the tile's is lost: the
//     dead a hive's land held when its hive died, popCap's HIVE_CAP gone, dispersed and rotted; the spread pushes
//     nothing for them);
//   - a POI below its cap refills only out of its own tile's open ground: none on a low tile at 0 (it stays clear); a
//     POI with some left on a low tile the very small chance of +1; on a medium tile a chance (refillP, refillLoudP when
//     the POI was loud) of refill of its gap; on a high tile every day (refillHigh, × 2 when loud);
//   - raiders the same, "loud" read as "seen raiding here" (rn: other groups' raids, noteRaid);
//   - nothing goes above the cap; the noise, the kills and the raids seen fade.
// Then deadPopSpread runs: the spread between tiles (deadspread.js spreadDaily, #66: out from the towns, cities and
// hives, ring by ring, up to each tile's cap).
// AI PARITY (docs/adr/0001): the groups' raids (grouppois.js raidPoiAsGroup) kill from and are counted on the same
// pools (aiRaidKills), and their noise counts the same.
// Hash dice from the world seed (skills.js hash01), never state.rng: the same run for the same seed.
/** @import { State, Tile } from "./types" */
import { LOCATIONS } from "./data.js";
import { hash01 } from "./skills.js";
import { poisOf, isSitePoi } from "./pois.js"; // call-time only (pois.js reads this module for its wrappers)
import { tileClass, sizeFor } from "./placement.js";
import { hordeGrowth } from "./eras.js";
import { cfgOf } from "./worldcfg.js";
import { zombieToughness } from "./hives.js"; // call-time only
import { spreadDaily } from "./deadspread.js"; // call-time only (the spread between tiles, #66)

export const DEADPOP = {
  // The most dead a tile can hold, by land class (placement.js TILE_CLASSES).
  CAP: { centre: 600, city: 320, suburb: 140, town: 100, highway: 50, rural: 36, coast: 32, scenic: 24 },
  HIVE_CAP: 1.5,                      // a hive's land (hives.js zombieToughness): this × the cap
  // The share of the cap a tile holds untouched: by class, + INF_FILL × its infection, + HIVE_FILL on a hive's land.
  FILL: { centre: 0.45, city: 0.4, suburb: 0.35, town: 0.3, highway: 0.25, rural: 0.2, coast: 0.2, scenic: 0.15 },
  INF_FILL: 0.4, HIVE_FILL: 0.2,
  JITTER: 0.15,                       // a tile's default ± this share (hash die); a POI's ± 1
  // A POI's default: the old roster's formula (header) × its building's size by the placement table's class.
  SIZE_K: { small: 0.8, medium: 1, large: 1.3, huge: 1.6 },
  POI_CAP: 2, POI_CAP_MIN: 3,         // a POI's cap: its default × this, at least POI_CAP_MIN
  ROSTER_MAX: 14,                     // the most of a POI's dead one raid map shows (the old roster's cap)
  // Raiders by class, their cap (× RCAP), more on a hostile group's land, a POI's band.
  RAIDERS: { centre: 10, city: 8, suburb: 5, town: 5, highway: 4, rural: 2, coast: 2, scenic: 1 },
  RCAP: 3, OWNED: 4,
  POI_RAIDERS: { p: 0.15, n: 2, max: 6 }, // the chance a POI holds a band (× fill × 3, at most × 2), its size; a map's most
  RAIDER_NAME: "raiders holed up here", // the roster group's name (deadPopBattleEnd counts its people by it)
  // Bands of the count against the cap: [cut, word] (fill < cut); none is a count of 0.
  BANDS: [[0.3, "low"], [0.6, "medium"], [0.85, "high"], [Infinity, "overrun"]],
  // Noise and memories.
  NOISE_MAX: 100, NOISE_DECAY: 0.7, KILL_DECAY: 0.7, RAID_DECAY: 0.7, FLOOR: 0.5,
  LOUD: 10,                           // a noise memory this high is a loud night
  LOUD_KILL: 1, QUIET_KILL: 0.1,      // the noise a kill adds
  SHOT: 0.5, SHOT_CAP: 15,            // a battle's shots heard (combat.js b.gunshots), as the old tile heat's
  LOUD_SHOTS: 3,                      // a battle with this many shots heard is loud
  // Reinforcements: the open ground's dead within earshot of one fight (a share, at most EARSHOT_MAX).
  EARSHOT: 0.35, EARSHOT_MAX: 40, REINF_MAX: 8,
  // A surge (scavenge.js heatSurge): a loud tile (noise ≥ SURGE_NOISE) with a medium or higher open ground, a chance of
  // up to SURGE_P (by the noise) of a chunk SURGE_SHARE of the open ground (SURGE_MIN–SURGE_MAX) drawn to the POI.
  SURGE_NOISE: 50, SURGE_P: 0.2, SURGE_SHARE: 0.15, SURGE_MIN: 5, SURGE_MAX: 14,
  // The day's recalculation (header).
  DAY: {
    lowP: 0.04, medP: 0.15, medRise: 0.02, medLoudP: 0.4, medLoudRise: 0.06, highDrift: 0.05, highLoudDrift: 0.12,
    refillP: 0.12, refillLoudP: 0.35, refill: 0.15, refillHigh: 0.2,
    quietCeil: 1, // a quiet day's rise stops at this × the tile's default count (its own level); a loud one at the cap (#66 fix)
  },
  // poiThreat (pois.js): + THREAT × (the POI's dead over its default − 1), between THREAT_LO and THREAT_HI.
  THREAT: 0.6, THREAT_LO: -1, THREAT_HI: 1.5,
  // fieldheat.js trouble: danger + FIELD × (open fill − FIELD_BASE).
  FIELD: 0.6, FIELD_BASE: 0.3,
  // A search hour's fights (scavenge.js searchHour): their chance × (POI dead + SEARCH_OPEN × earshot) / its default,
  // between SEARCH_LO and SEARCH_HI.
  SEARCH_OPEN: 0.25, SEARCH_LO: 0, SEARCH_HI: 1.5,
  // Another group's raid (grouppois.js raidPoiAsGroup): kills up to AI_KILLS a call (× hours / 4 for a long one).
  AI_KILLS: 2,
  // An old save's tile heat: its noise memory, and floor(heat / HEAT_ROSTER) more of the dead in each of its POIs (the
  // old roster's one more every TILE_HEAT.ROSTER).
  HEAT_ROSTER: 20,
};

/** @param {State} state @param {Tile | number} t @returns {Tile} */
const tileOf = (state, t) => (typeof t === "number" ? state.tiles[t] : t);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const day = (state) => Math.floor((state.hour || 0) / 24) + 1;
/** @param {State} state */
const dial = (state) => { const d = cfgOf(state, "siteDead"); return d == null ? 1 : Number(d); };
/** @param {State} state @param {Tile} t */
const landClass = (state, t) => { const c = tileClass(state, t); return DEADPOP.CAP[c] != null ? c : "rural"; };
/** @param {State} state @param {Tile} t */
const hiveLand = (state, t) => { try { return zombieToughness(state, t.id); } catch { return 0; } };

// ---------- caps ----------
/** The most dead tile can hold. @param {State} state @param {Tile | number} tile */
export function popCap(state, tile) {
  const t = tileOf(state, tile);
  if (!t || t.terrain === "water") return 0;
  return Math.round(DEADPOP.CAP[landClass(state, t)] * dial(state) * (hiveLand(state, t) || t.hive ? DEADPOP.HIVE_CAP : 1));
}
/** The most raiders a tile can hold. @param {State} state @param {Tile | number} tile */
export function raiderCap(state, tile) {
  const t = tileOf(state, tile);
  if (!t || t.terrain === "water") return 0;
  return Math.round(DEADPOP.RAIDERS[landClass(state, t)] * DEADPOP.RCAP);
}

// ---------- the generated default ----------
// A POI's danger as the old roster read a site's (data.js siteDanger: outside the cities and towns at most 1).
/** @param {State} state @param {Tile} t @param {number} i */
function poiDanger(state, t, i) {
  const p = poisOf(t)[i];
  if (!p) return 0;
  const kind = isSitePoi(t, i) ? t.loc.type : p.kind;
  const d = (LOCATIONS[kind] && LOCATIONS[kind].danger) ?? 1;
  const cls = landClass(state, t);
  return cls === "centre" || cls === "city" || cls === "suburb" ? d : Math.min(1, d);
}
/** What POI i holds untouched (the dead). @param {State} state @param {Tile} t @param {number} i */
function poiSeed(state, t, i) {
  const p = poisOf(t)[i];
  if (!p) return 0;
  const inf = t.infection || 0, hz = hiveLand(state, t);
  const size = sizeFor(isSitePoi(t, i) ? t.loc.type : p.kind, tileClass(state, t));
  const k = (size && DEADPOP.SIZE_K[size]) || 1;
  const base = (1 + inf * 5 + (t.terrain === "city" ? 1 : 0) + poiDanger(state, t, i) + (hz ? 2 : 0)) * k * hordeGrowth(state) * dial(state);
  return Math.max(0, Math.round(base + Math.floor(hash01(state.seed, "dpoi", t.id, i) * 3) - 1));
}
/**
 * The tile's generated default: { o, p, r, q } (open dead, per POI, open raiders, per POI). @param {State} state @param {Tile} t
 */
function seedOf(state, t) {
  const cap = popCap(state, t);
  const list = poisOf(t);
  const p = list.map((_, i) => Math.min(cap, poiSeed(state, t, i)));
  if (!cap) return { o: 0, p: p.map(() => 0), r: 0, q: list.map(() => 0) };
  const cls = landClass(state, t), hz = hiveLand(state, t) || (t.hive ? 1 : 0);
  const fill = clamp((DEADPOP.FILL[cls] + DEADPOP.INF_FILL * (t.infection || 0) + (hz ? DEADPOP.HIVE_FILL : 0)) * hordeGrowth(state), 0, 1);
  const total = Math.round(cap * fill * (1 + (hash01(state.seed, "dptile", t.id) - 0.5) * 2 * DEADPOP.JITTER));
  const sum = p.reduce((a, b) => a + b, 0);
  const o = Math.max(0, Math.min(cap, total) - sum);
  // Raiders: by class, more on a hostile group's land; a POI's band drawn from them.
  const rcap = raiderCap(state, t);
  const owner = typeof t.owner === "number" ? (state.factions || []).find((f) => f.id === t.owner && f.alive) : null;
  const hostile = !!(owner && owner.goodwill <= -40);
  let rt = Math.min(rcap, Math.round(DEADPOP.RAIDERS[cls] * (1 + (hash01(state.seed, "dpraid", t.id) - 0.5) * 2 * DEADPOP.JITTER) + (hostile ? DEADPOP.OWNED : 0)));
  const rf = rcap ? rt / rcap : 0;
  const q = list.map((_, i) => {
    if (rt < DEADPOP.POI_RAIDERS.n || hash01(state.seed, "dppoiraid", t.id, i) >= DEADPOP.POI_RAIDERS.p * Math.min(2, rf * 3)) return 0;
    rt -= DEADPOP.POI_RAIDERS.n;
    return DEADPOP.POI_RAIDERS.n;
  });
  return { o, p, r: Math.max(0, rt), q };
}

// ---------- the records ----------
/** @param {State} state */
const store = (state) => (state.deadPop && typeof state.deadPop === "object" ? state.deadPop : (state.deadPop = {}));
/** The tile's record, or null when it is at its default (make: store the default now). @param {State} state @param {Tile} t @param {boolean} [make] */
function rec(state, t, make = false) {
  const s = state.deadPop && typeof state.deadPop === "object" ? state.deadPop[t.id] : null;
  if (s || !make) return s || null;
  const d = seedOf(state, t);
  return (store(state)[t.id] = { o: d.o, p: d.p, r: d.r, q: d.q, n: 0, pn: {}, k: 0, rn: 0 });
}
// The counts now: the record's, or the default's. A POI index past the record's list (a list that grew) reads 0.
/** @param {State} state @param {Tile} t */
const counts = (state, t) => rec(state, t) || seedOf(state, t);
/** @param {number[]} list @param {number} n */
const sumTo = (list, n) => { let s = 0; for (let i = 0; i < n; i++) s += list[i] || 0; return s; };

// ---------- the counts ----------
/** The dead on the tile, its POIs' among them. @param {State} state @param {Tile | number} tile */
export function tileDead(state, tile) {
  const t = tileOf(state, tile);
  if (!t) return 0;
  const c = counts(state, t);
  return c.o + sumTo(c.p, poisOf(t).length);
}
/** The tile's dead outside its POIs (tileDead − Σ poiDead). @param {State} state @param {Tile | number} tile */
export function openDead(state, tile) {
  const t = tileOf(state, tile);
  return t ? counts(state, t).o : 0;
}
/** The dead in POI i. @param {State} state @param {Tile | number} tile @param {number} i */
export function poiDead(state, tile, i) {
  const t = tileOf(state, tile);
  if (!t || i == null || i < 0 || i >= poisOf(t).length) return 0;
  return counts(state, t).p[i] || 0;
}
/** The raiders on the tile, its POIs' among them. @param {State} state @param {Tile | number} tile */
export function tileRaiders(state, tile) {
  const t = tileOf(state, tile);
  if (!t) return 0;
  const c = counts(state, t);
  return c.r + sumTo(c.q, poisOf(t).length);
}
/** The tile's raiders outside its POIs. @param {State} state @param {Tile | number} tile */
export function openRaiders(state, tile) {
  const t = tileOf(state, tile);
  return t ? counts(state, t).r : 0;
}
/** The raiders holed up in POI i. @param {State} state @param {Tile | number} tile @param {number} i */
export function poiRaiders(state, tile, i) {
  const t = tileOf(state, tile);
  if (!t || i == null || i < 0 || i >= poisOf(t).length) return 0;
  return counts(state, t).q[i] || 0;
}
/** POI i's untouched count (its generated default now). @param {State} state @param {Tile | number} tile @param {number} i */
export function poiDefault(state, tile, i) {
  const t = tileOf(state, tile);
  return t ? Math.min(popCap(state, t), poiSeed(state, t, i)) : 0;
}
/** POI i's cap: its default × POI_CAP, at least POI_CAP_MIN (and never over the tile's). @param {State} state @param {Tile | number} tile @param {number} i */
export function poiCap(state, tile, i) {
  const t = tileOf(state, tile);
  if (!t) return 0;
  return Math.min(popCap(state, t), Math.max(DEADPOP.POI_CAP_MIN, Math.round(poiSeed(state, t, i) * DEADPOP.POI_CAP)));
}

// ---------- kills, draws, putting back ----------
// n off POI i (as many as it holds; i null: none) and the rest off the open ground. Returns { fromPoi, fromOpen }.
/** @param {any} r @param {"p" | "q"} key @param {"o" | "r"} open @param {number | null} i @param {number} n @param {number} len */
function takeFrom(r, key, open, i, n, len) {
  let fromPoi = 0;
  if (i != null && i >= 0 && i < len) { fromPoi = Math.min(n, r[key][i] || 0); r[key][i] = (r[key][i] || 0) - fromPoi; }
  const fromOpen = Math.min(n - fromPoi, r[open]);
  r[open] -= fromOpen;
  return { fromPoi, fromOpen };
}
/**
 * Kills n of the dead: off POI i (if given, as many as it holds) and the rest off the open ground; the tile's count
 * falls by them all. Adds to the tile's recent-kill memory and to the noise (loud: LOUD_KILL a kill, else QUIET_KILL).
 * Returns how many were killed (never more than there were).
 * @param {State} state @param {Tile | number} tile @param {number | null} poiIndex @param {number} n @param {{ loud?: boolean }} [opts]
 */
export function killDead(state, tile, poiIndex, n, opts = {}) {
  const t = tileOf(state, tile);
  n = Math.floor(n || 0);
  if (!t || n <= 0) return 0;
  const r = rec(state, t, true);
  const { fromPoi, fromOpen } = takeFrom(r, "p", "o", poiIndex, n, poisOf(t).length);
  const k = fromPoi + fromOpen;
  if (k > 0) {
    r.k = (r.k || 0) + k;
    noteNoise(state, t, poiIndex, k * (opts.loud ? DEADPOP.LOUD_KILL : DEADPOP.QUIET_KILL));
  }
  return k;
}
/** Kills n raiders: off POI i first, the rest off the open ground. Returns how many. @param {State} state @param {Tile | number} tile @param {number | null} poiIndex @param {number} n @param {{ loud?: boolean }} [opts] */
export function killRaiders(state, tile, poiIndex, n, opts = {}) {
  const t = tileOf(state, tile);
  n = Math.floor(n || 0);
  if (!t || n <= 0) return 0;
  const r = rec(state, t, true);
  const { fromPoi, fromOpen } = takeFrom(r, "q", "r", poiIndex, n, poisOf(t).length);
  const k = fromPoi + fromOpen;
  if (k > 0 && opts.loud) noteNoise(state, t, poiIndex, k * DEADPOP.LOUD_KILL);
  return k;
}
/** Takes up to n of the dead out of the open ground (reinforcements, a surge, a camp's trickle, a hunt); returns how many. @param {State} state @param {Tile | number} tile @param {number} n */
export function drawFromTile(state, tile, n) {
  const t = tileOf(state, tile);
  n = Math.floor(n || 0);
  if (!t || n <= 0 || openDead(state, t) <= 0) return 0;
  const r = rec(state, t, true);
  const k = Math.min(n, r.o);
  r.o -= k;
  return k;
}
/** The ones drawn that walked away alive go back: into POI i (if given) or the open ground, never over the cap. Returns how many. @param {State} state @param {Tile | number} tile @param {number | null} poiIndex @param {number} n */
export function putBack(state, tile, poiIndex, n) {
  const t = tileOf(state, tile);
  n = Math.floor(n || 0);
  if (!t || n <= 0) return 0;
  const k = Math.min(n, Math.max(0, popCap(state, t) - tileDead(state, t)));
  if (k <= 0) return 0;
  const r = rec(state, t, true);
  if (poiIndex != null && poiIndex >= 0 && poiIndex < poisOf(t).length) r.p[poiIndex] = (r.p[poiIndex] || 0) + k;
  else r.o += k;
  return k;
}
/** Raiders drawn out (a band's raid) and put back, as the dead. @param {State} state @param {Tile | number} tile @param {number} n */
export function drawRaiders(state, tile, n) {
  const t = tileOf(state, tile);
  n = Math.floor(n || 0);
  if (!t || n <= 0 || openRaiders(state, t) <= 0) return 0;
  const r = rec(state, t, true);
  const k = Math.min(n, r.r);
  r.r -= k;
  return k;
}

// ---------- noise and memories ----------
/** Adds to the tile's noise memory (and POI i's, if given), up to NOISE_MAX; returns the tile's after. @param {State} state @param {Tile | number} tile @param {number | null} poiIndex @param {number} amount */
export function noteNoise(state, tile, poiIndex, amount) {
  const t = tileOf(state, tile);
  if (!t) return 0;
  if (!(amount > 0)) return noiseOf(state, t);
  const r = rec(state, t, true);
  r.n = Math.min(DEADPOP.NOISE_MAX, (r.n || 0) + amount);
  if (poiIndex != null && poiIndex >= 0) { r.pn = r.pn || {}; r.pn[poiIndex] = Math.min(DEADPOP.NOISE_MAX, (r.pn[poiIndex] || 0) + amount); }
  return r.n;
}
/** The tile's noise memory (POI i's, if given). @param {State} state @param {Tile | number} tile @param {number | null} [poiIndex] */
export function noiseOf(state, tile, poiIndex = null) {
  const t = tileOf(state, tile);
  const r = t ? rec(state, t) : null;
  if (!r) return 0;
  return poiIndex != null && poiIndex >= 0 ? (r.pn && r.pn[poiIndex]) || 0 : r.n || 0;
}
/** The kills on the tile lately (a decaying memory: × KILL_DECAY a day). @param {State} state @param {Tile | number} tile */
export function recentKills(state, tile) {
  const t = tileOf(state, tile);
  const r = t ? rec(state, t) : null;
  return r ? r.k || 0 : 0;
}
/** Another group was seen raiding here (raiders' "loud"). @param {State} state @param {Tile | number} tile @param {number} [amount] */
export function noteRaid(state, tile, amount = 1) {
  const t = tileOf(state, tile);
  if (!t || !(amount > 0)) return;
  const r = rec(state, t, true);
  r.rn = (r.rn || 0) + amount;
}

// ---------- bands ----------
/** A count's band against a cap: { band 0–4, word, skulls, fill }. @param {number} n @param {number} cap */
export function bandOfCount(n, cap) {
  if (!(n > 0)) return { band: 0, word: "none", skulls: "", fill: 0 };
  const fill = cap > 0 ? n / cap : 1;
  const i = DEADPOP.BANDS.findIndex(([cut]) => fill < Number(cut));
  const b = (i < 0 ? DEADPOP.BANDS.length - 1 : i) + 1;
  return { band: b, word: String(DEADPOP.BANDS[b - 1][1]), skulls: "☠".repeat(b - 1), fill };
}
/** The dead's level on the tile (POI i's against its own cap, if given): { band 0–4, word (none … overrun), skulls, fill }. @param {State} state @param {Tile | number} tile @param {number | null} [poiIndex] */
export function deadBand(state, tile, poiIndex = null) {
  const t = tileOf(state, tile);
  if (!t) return bandOfCount(0, 0);
  if (poiIndex != null && poiIndex >= 0) return bandOfCount(poiDead(state, t, poiIndex), poiCap(state, t, poiIndex));
  return bandOfCount(tileDead(state, t), popCap(state, t));
}
/** The raiders' level, as deadBand (a POI's against POI_RAIDERS.max). @param {State} state @param {Tile | number} tile @param {number | null} [poiIndex] */
export function raiderBand(state, tile, poiIndex = null) {
  const t = tileOf(state, tile);
  if (!t) return bandOfCount(0, 0);
  if (poiIndex != null && poiIndex >= 0) return bandOfCount(poiRaiders(state, t, poiIndex), DEADPOP.POI_RAIDERS.max);
  return bandOfCount(tileRaiders(state, t), raiderCap(state, t));
}
/** The open ground's dead within earshot of one fight (reinforcements' pool). @param {State} state @param {Tile | number} tile */
export function earshot(state, tile) {
  const o = openDead(state, tile);
  return o > 0 ? Math.min(DEADPOP.EARSHOT_MAX, Math.max(1, Math.round(o * DEADPOP.EARSHOT))) : 0;
}

// ---------- raids and battles ----------
/**
 * A surge: a loud tile's open ground sends a chunk of its dead to the place (hash dice of the seed, the tile, the hour).
 * The ones drawn go into POI i (they are there now: they leave the open ground). Returns how many, 0 for none.
 * @param {State} state @param {Tile | number} tile @param {number | null} poiIndex
 */
export function surgeDraw(state, tile, poiIndex) {
  const t = tileOf(state, tile);
  if (!t) return 0;
  const n = noiseOf(state, t);
  if (n < DEADPOP.SURGE_NOISE || deadBand(state, t).band < 2 || openDead(state, t) < DEADPOP.SURGE_MIN) return 0;
  const p = Math.min(DEADPOP.SURGE_P, ((n - DEADPOP.SURGE_NOISE) / (DEADPOP.NOISE_MAX - DEADPOP.SURGE_NOISE)) * DEADPOP.SURGE_P);
  if (hash01(state.seed, "dpsurge", t.id, state.hour) >= p) return 0;
  const want = clamp(Math.round(openDead(state, t) * DEADPOP.SURGE_SHARE), DEADPOP.SURGE_MIN, DEADPOP.SURGE_MAX);
  const k = drawFromTile(state, t, want);
  if (k && poiIndex != null) putBack(state, t, poiIndex, k);
  else if (k) putBack(state, t, null, k); // no place: they stay about the open ground (a raid off the POIs: the roster shows them)
  return k;
}
/**
 * A battle on the map is over (combat.js finishCombat): its kills come off the pools.
 * - The reinforcements (u.drawn: combat.js reinforcements and a raid's waves, out of the open ground within earshot)
 *   killed come off the open ground. Other late dead (the risen, sleepers, a hive's brood, a crawl's old bodies) are not.
 * - With setup.deadPop ({ tile, poi, roster }: a raid on a POI or the tile's own dead: scavenge.js startScavenge, the
 *   crawl, a site clear), the map's own dead killed come off the POI (then the open ground), scaled to the roster
 *   (roster × killed / placed), and the POI's raiders (DEADPOP.RAIDER_NAME) killed off its raiders.
 * - The noise: the shots heard (b.gunshots × SHOT, at most SHOT_CAP) on the tile and the POI.
 * A fight by the numbers (no map): the share of setup.enemy.count killed × the roster.
 * @param {State} state @param {any} setup @param {any} result @param {any} battle
 */
export function deadPopBattleEnd(state, setup, result, battle) {
  const dp = setup && setup.deadPop;
  const tileId = dp && dp.tile != null ? dp.tile : battle ? battle.tileId : null;
  const t = tileId != null ? state.tiles[tileId] : null;
  if (!t || (!dp && !battle)) return;
  const poi = dp && dp.poi != null && dp.poi >= 0 ? dp.poi : null;
  const shots = battle ? battle.gunshots || 0 : 0;
  const loud = shots >= DEADPOP.LOUD_SHOTS;
  if (battle) {
    const zs = battle.units.filter((u) => u.side === "enemy" && u.kind === "zombie");
    const reinf = zs.filter((u) => u.drawn && u.dead).length;
    if (reinf) killDead(state, t, null, reinf, { loud });
    if (dp) {
      const own = zs.filter((u) => !u.reinforcement && !u.restored), placed = own.length, killed = own.filter((u) => u.dead).length;
      const roster = dp.roster != null ? dp.roster : placed;
      if (killed && placed) killDead(state, t, poi, Math.min(roster, Math.round((roster * killed) / placed)), { loud });
      const rs = battle.units.filter((u) => u.side === "enemy" && u.kind !== "zombie" && u.gname === DEADPOP.RAIDER_NAME);
      const rk = rs.filter((u) => u.dead).length;
      if (rk) killRaiders(state, t, poi, Math.min(dp.raiders != null ? dp.raiders : rk, rk), { loud });
    }
  } else if (dp && result) {
    const total = Math.max(1, (setup.enemy && setup.enemy.count) || 0);
    const share = clamp((result.enemiesKilled || 0) / total, 0, 1);
    const roster = dp.roster != null ? dp.roster : (setup.enemy && setup.enemy.kind === "zombies" ? setup.enemy.count || 0 : 0);
    if (roster && share) killDead(state, t, poi, Math.round(roster * share), { loud: !!(result.ammoUsed > 0) });
    if (dp.raiders && share) killRaiders(state, t, poi, Math.round(dp.raiders * share));
  }
  if (shots > 0) noteNoise(state, t, poi, Math.min(DEADPOP.SHOT_CAP, shots * DEADPOP.SHOT));
}
/** Another group raids POI i without a map (grouppois.js raidPoiAsGroup): its fight kills some of the dead there, loudly; they were seen raiding. @param {State} state @param {Tile | number} tile @param {number} i @param {{ hours?: number }} [opts] */
export function aiRaidKills(state, tile, i, opts = {}) {
  const t = tileOf(state, tile);
  if (!t) return 0;
  const n = Math.min(poiDead(state, t, i), Math.round(DEADPOP.AI_KILLS * Math.max(1, (opts.hours || 0) / 4)));
  const k = n > 0 ? killDead(state, t, i, n, { loud: true }) : 0;
  noteRaid(state, t, 1);
  return k;
}

// ---------- the day ----------
/** @param {State} state @param {number} id @param {number} d @param {string} what @param {any} [i] */
const die = (state, id, d, what, i = 0) => hash01(state.seed, "dpday", id, d, what, i);
/**
 * A pool over its cap trimmed to it (the header): each POI's excess to the open ground, then the tile's off the open
 * ground and the POIs (last first), lost. Returns how many were lost. @param {any} r @param {"dead" | "raiders"} kind
 * @param {number} cap @param {(i: number) => number} pcap @param {number} n the POIs
 */
function trimToCap(r, kind, cap, pcap, n) {
  const openK = kind === "dead" ? "o" : "r", poiK = kind === "dead" ? "p" : "q";
  for (let i = 0; i < n; i++) {
    const x = (r[poiK][i] || 0) - pcap(i);
    if (x > 0) { r[poiK][i] -= x; r[openK] += x; }
  }
  let over = r[openK] + sumTo(r[poiK], n) - cap;
  if (over <= 0) return 0;
  const lost = over;
  const k = Math.min(over, r[openK]);
  r[openK] -= k; over -= k;
  for (let i = n - 1; i >= 0 && over > 0; i--) { const m = Math.min(over, r[poiK][i] || 0); r[poiK][i] -= m; over -= m; }
  return lost;
}
/**
 * One stored pool's day (the header's rules): the open ground's rise to its band (a quiet one up to the default's
 * count d0, a loud one up to the cap), the POIs' refill out of it. Returns the record.
 * @param {State} state @param {Tile} t @param {any} r @param {"dead" | "raiders"} kind @param {{ o: number, p: number[], r: number, q: number[] }} d0
 */
function dayOf(state, t, r, kind, d0) {
  const D = DEADPOP.DAY, d = day(state), list = poisOf(t), n = list.length;
  const dead = kind === "dead";
  const openK = dead ? "o" : "r", poiK = dead ? "p" : "q";
  const cap = dead ? popCap(state, t) : raiderCap(state, t);
  const total = () => r[openK] + sumTo(r[poiK], n);
  const loud = dead ? (r.n || 0) >= DEADPOP.LOUD : (r.rn || 0) >= 1;
  const band = bandOfCount(total(), cap).band;
  // A quiet day rises only up to the tile's own level (its default), a loud one up to the cap.
  const own = dead ? d0.o + sumTo(d0.p, n) : d0.r + sumTo(d0.q, n);
  const lim = loud ? cap : Math.min(cap, Math.round(own * D.quietCeil));
  const room = () => Math.max(0, lim - total());
  let rise = 0;
  if (band <= 1) {
    const allLow = list.every((_, i) => (dead ? bandOfCount(r.p[i] || 0, poiCap(state, t, i)) : bandOfCount(r.q[i] || 0, DEADPOP.POI_RAIDERS.max)).band <= 1);
    if (band === 1 && allLow && die(state, t.id, d, kind + "low") < D.lowP) rise = 1;
  } else if (band === 2) {
    if (die(state, t.id, d, kind + "med") < (loud ? D.medLoudP : D.medP)) rise = Math.max(1, Math.round(cap * (loud ? D.medLoudRise : D.medRise)));
  } else if (room() > 0) rise = Math.max(1, Math.round(room() * (loud ? D.highLoudDrift : D.highDrift)));
  r[openK] += Math.min(rise, room());
  // The POIs refill only out of their own tile's open ground.
  const tb = bandOfCount(total(), cap).band;
  for (let i = 0; i < n; i++) {
    const pc = dead ? poiCap(state, t, i) : DEADPOP.POI_RAIDERS.max;
    const have = r[poiK][i] || 0;
    if (have >= pc || r[openK] <= 0) continue;
    const ploud = dead ? ((r.pn && r.pn[i]) || 0) >= DEADPOP.LOUD : loud;
    let move = 0;
    if (tb <= 1) { if (have > 0 && die(state, t.id, d, kind + "plow", i) < D.lowP) move = 1; }
    else if (tb === 2) { if (die(state, t.id, d, kind + "pmed", i) < (ploud ? D.refillLoudP : D.refillP)) move = Math.max(1, Math.round((pc - have) * D.refill)); }
    else move = Math.max(1, Math.round((pc - have) * D.refillHigh * (ploud ? 2 : 1)));
    move = Math.min(move, r[openK], pc - have);
    if (move > 0) { r[poiK][i] = have + move; r[openK] -= move; }
  }
  return r;
}
/** A record back at its default with nothing remembered is dropped. @param {State} state @param {Tile} t @param {any} r */
function atDefault(state, t, r, d = seedOf(state, t)) {
  if ((r.n || 0) > 0 || (r.k || 0) > 0 || (r.rn || 0) > 0 || Object.keys(r.pn || {}).length) return false;
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  return r.o === d.o && r.r === d.r && same(r.p, d.p) && same(r.q, d.q);
}
/** The midnight recalculation (world.js tickHour, after the day's other work): every stored tile by its band and yesterday's noise. @param {State} state */
export function deadPopDaily(state) {
  const S = state.deadPop;
  if (!S || typeof S !== "object") return;
  const fade = (v, k) => { const x = (v || 0) * k; return x >= DEADPOP.FLOOR ? x : 0; };
  for (const key of Object.keys(S)) {
    const t = state.tiles[+key], r = S[key];
    if (!t || !r) { delete S[key]; continue; }
    const n = poisOf(t).length;
    while (r.p.length < n) r.p.push(0); // a list that grew (a crash's site): its new places start empty
    while (r.q.length < n) r.q.push(0);
    // Over a cap that fell (a hive died: HIVE_CAP gone) trimmed back to it, the excess lost (the header).
    const cap = popCap(state, t);
    trimToCap(r, "dead", cap, (i) => poiCap(state, t, i), n);
    trimToCap(r, "raiders", raiderCap(state, t), () => DEADPOP.POI_RAIDERS.max, n);
    const d0 = seedOf(state, t);
    dayOf(state, t, r, "dead", d0);
    dayOf(state, t, r, "raiders", d0);
    r.n = fade(r.n, DEADPOP.NOISE_DECAY);
    r.k = fade(r.k, DEADPOP.KILL_DECAY);
    r.rn = fade(r.rn, DEADPOP.RAID_DECAY);
    for (const i of Object.keys(r.pn || {})) { const v = fade(r.pn[i], DEADPOP.NOISE_DECAY); if (v) r.pn[i] = v; else delete r.pn[i]; }
    if (atDefault(state, t, r, d0)) delete S[key];
  }
}
/** The spread between tiles (the heat epic's #66, deadspread.js spreadDaily): runs right after deadPopDaily. @param {State} state */
export function deadPopSpread(state) {
  spreadDaily(state);
}
/**
 * The tile's dead now (tileDead), without building its default's lists for a tile nobody touched (deadspread.js reads
 * every tile near the towns and cities each day). @param {State} state @param {Tile} t
 */
export function deadNow(state, t) {
  const r = rec(state, t);
  if (r) return r.o + sumTo(r.p, poisOf(t).length);
  const cap = popCap(state, t);
  if (!cap) return 0;
  const n = poisOf(t).length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.min(cap, poiSeed(state, t, i));
  const cls = landClass(state, t), hz = hiveLand(state, t) || (t.hive ? 1 : 0);
  const fill = clamp((DEADPOP.FILL[cls] + DEADPOP.INF_FILL * (t.infection || 0) + (hz ? DEADPOP.HIVE_FILL : 0)) * hordeGrowth(state), 0, 1);
  const total = Math.round(cap * fill * (1 + (hash01(state.seed, "dptile", t.id) - 0.5) * 2 * DEADPOP.JITTER));
  return Math.max(0, Math.min(cap, total) - sum) + sum; // seedOf's o + Σ p
}

// ---------- older saves ----------
/**
 * A save from before the pools (save.js deserializeState, after ensurePois): its tile heat (state.tileHeat) folded in,
 * deterministically: each heated tile's record stored from its default, its noise memory the old heat (up to
 * NOISE_MAX), and floor(heat / HEAT_ROSTER) more of the dead in each of its POIs (the old roster's bonus), out of
 * nowhere but never over the cap. state.tileHeat is then gone. A save with no tile heat needs nothing (its tiles read
 * their defaults). @param {State} state
 */
export function ensureDeadPop(state) {
  if (state.deadPop != null && typeof state.deadPop !== "object") delete state.deadPop;
  const h = state.tileHeat;
  if (h && typeof h === "object") {
    for (const k of Object.keys(h).sort((a, b) => +a - +b)) {
      const t = state.tiles[+k], v = Number(h[k]) || 0;
      if (!t || !(v > 0)) continue;
      const r = rec(state, t, true);
      r.n = Math.min(DEADPOP.NOISE_MAX, Math.max(r.n || 0, v));
      const more = Math.floor(v / DEADPOP.HEAT_ROSTER);
      for (let i = 0; i < r.p.length && more > 0; i++) {
        const add = Math.min(more, Math.max(0, popCap(state, t) - (r.o + sumTo(r.p, r.p.length))));
        r.p[i] += add;
      }
    }
  }
  delete state.tileHeat;
  return state;
}
