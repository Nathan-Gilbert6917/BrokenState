// The dead met away from the hives broaden as the run goes on, whatever the hives do (the user's request 2026-10-21:
// "make the zombie pool you can encounter in raids and city, town and hive crawls become more diverse as times go
// on regardless of hive activity"). Every number in hiveconst.js POOL.
// - The era's kinds (zombietypes.js eraKinds: what the hives have grown by the calendar, hivetech.js eraTier) met
//   exploring (zombietypes.js ambientMix, hivetech.js siteSpecials) are shaped by the place (shapeKinds: × AFFINITY by
//   the kind of place, the total kept): Climbers, screamers and Melters in the cities, runners, crawlers and Diggers in
//   the countryside, brutes, Bonebacks and Trippers round the military sites (poolPlace). The counter-dead are at
//   POOL.WILD of their share there: they are bred in answer to walls, rarer in the wild.
// - From POOL.START_DAY on, more of the dead nobody bred (widenMix), growing a little every game year: soldiers who
//   walked out of the military sites within MIL_RANGE tiles (fewer farther off), riot police in the towns and cities,
//   the dead beasts of the countryside's ground (BEASTS.LAND by its terrain). Merged with the site's own (scavenge.js
//   raidEnemies: raids and the places on a tile, towns' too; conflicts.js: fights on the road; citycrawl.js: the
//   street's dead).
// - A hive's brood (hivecrawl.js broodTypes) gets the era's kinds it does not breed itself at BROOD_YEAR a year.
// - All of it × the run's Zombie damage dial to the power POOL.DIAL (worldcfg.js zDmg: a gentle run meets fewer).
// No dice: the same tile on the same day has the same pool.
import { crashSpecials } from "./crashmode.js"; // Crashlanding (2026-10-24): the special dead more often
import { POOL, BEASTS } from "./hiveconst.js";
import { placeKind, eraKinds } from "./zombietypes.js";
import { rampDay } from "./eras.js";
import { cfgOf } from "./worldcfg.js";

const r3 = (v) => Math.round(v * 1000) / 1000;
export const poolYears = (state) => rampDay(state) / 112;
export const poolDial = (state) => Math.pow(Math.max(0.25, cfgOf(state, "zDmg") || 1), POOL.DIAL);
// The military sites (National Guard bases, army wrecks; hardcore's state.militaryIds too), found once a day per world.
const MIL = new WeakMap();
const MIL_TYPES = new Set(["military", "crash_mil"]);
function milSites(state) {
  const day = Math.floor((state.hour || 0) / 24), have = state.tiles ? MIL.get(state.tiles) : null;
  if (have && have.day === day) return have.ids;
  const ids = new Set(state.militaryIds || []);
  for (const t of state.tiles || []) if (t && t.loc && MIL_TYPES.has(t.loc.type)) ids.add(t.id);
  const out = [...ids];
  if (state.tiles) MIL.set(state.tiles, { day, ids: out });
  return out;
}
const milDist = (state, tileId) => {
  const g = state.grid;
  let d = Infinity;
  if (g) for (const id of milSites(state)) d = Math.min(d, id === tileId ? 0 : g.distance(id, tileId));
  return d;
};
export const militaryNear = (state, tileId) => milDist(state, tileId);
// The kind of place for the pool's shape: "military" (a military site or next to one), else zombietypes.js placeKind.
export const poolPlace = (state, t) => (t && milDist(state, t.id) <= 1 ? "military" : placeKind(t));
// The kinds (shares) × the place's AFFINITY, scaled back to the same total.
export function shapeKinds(kinds, place) {
  const A = POOL.AFFINITY[place];
  if (!A || !kinds) return kinds;
  const tot = Object.values(kinds).reduce((a, v) => a + v, 0);
  const out = {};
  for (const k in kinds) out[k] = kinds[k] * (A[k] ?? 1);
  const t2 = Object.values(out).reduce((a, v) => a + v, 0);
  if (t2 > 0) for (const k in out) out[k] = (out[k] * tot) / t2;
  return out;
}
// The dead nobody bred that the years bring to a tile: { soldier, riot, deadstag, ... } or null.
export function widenMix(state, tileId) {
  const t = state.tiles[tileId];
  if (!t || rampDay(state) < POOL.START_DAY || (t.terrain === "water" && !t.bridge)) return null;
  const y = poolYears(state), f = poolDial(state) * crashSpecials(state), out = {}; // crashmode.js: × CRASH.SPECIALS in a Crashlanding run (each cap still holds below)
  const md = milDist(state, tileId);
  if (md <= POOL.MIL_RANGE) out.soldier = Math.min(POOL.MIL_MAX, POOL.MIL_YEAR * y) * (1 - md / (POOL.MIL_RANGE + 1)) * f;
  const kind = placeKind(t);
  if (kind === "city" || kind === "town") out.riot = Math.min(POOL.RIOT_MAX, POOL.RIOT_YEAR * y) * f;
  else if (BEASTS.LAND[t.terrain] && !(state.bases || []).some((b) => b.tile === tileId)) {
    const land = BEASTS.LAND[t.terrain], tot = Object.values(land).reduce((a, v) => a + v, 0);
    const share = Math.min(POOL.BEAST_MAX, POOL.BEAST_YEAR * y) * f;
    for (const k in land) out[k] = (share * land[k]) / tot;
  }
  for (const k in out) { out[k] = r3(out[k]); if (!(out[k] > 0)) delete out[k]; }
  return Object.keys(out).length ? out : null;
}
// A hive's brood (hivecrawl.js broodTypes): the era's kinds it does not breed, by the years: { kind: n } or null.
// Spread through those kinds by the layer (no dice), at most n − 1 of them.
export function broodWiden(state, tier, bred, n, layer = 0) {
  if (rampDay(state) < POOL.START_DAY || n < 2) return null;
  const kinds = Object.keys(eraKinds(tier)).filter((k) => !bred.includes(k));
  if (!kinds.length) return null;
  const k = Math.min(n - 1, Math.round(n * Math.min(POOL.BROOD_MAX, POOL.BROOD_YEAR * poolYears(state)) * poolDial(state) * crashSpecials(state))); // crashmode.js: Crashlanding's × CRASH.SPECIALS
  if (k <= 0) return null;
  const out = {};
  for (let i = 0; i < k; i++) { const kind = kinds[(i + layer) % kinds.length]; out[kind] = (out[kind] || 0) + 1; }
  return out;
}
