// @ts-check
// Custom mode and the "Start with a vehicle" box (2026-10-24, user request: "Add a toggle for start with a vehicle or
// not to start with a vehicle. Add to the normal/hardcore dropdown custom ... set any number above 1 for starting
// survivors, hives, cities etc").
// - Custom is not a third state.mode: a Custom run is a normal (hub) start with the counts set on the new-run screen,
//   kept as state.custom (CUSTOM_RUN's keys; saved with the state). isCustomRun says which runs are Custom.
//   createWorld (world.js) takes them as its `custom` option: the survivors at the hub, the AI groups, the hives and
//   the map's cities, towns and military sites (customSizeDef: mapgen.js places what fits, a city or a base that finds
//   no room is skipped).
// - Start with a vehicle (every mode): createWorld's `vehicle` option, kept as state.startVehicles (false: off). Off,
//   a normal or Custom hub has no pickup (and a custom background's car stays home), and a Hardcore team flees on foot:
//   the car's dice are still cast (so the map and the groups stay put) but the car and its back are left behind.
// A leaf module (no imports), safe to read from the sim and the UI.

// Each count: at least 1 ("any number above 1"); the maxima keep a run from hanging (more survivors, groups and
// hives cost every hour; cities, towns and bases need room on the map). DEF: a Normal map's own counts.
import { isRoadStart } from "./roadstart.js";
export const CUSTOM_RUN = {
  people: { MIN: 1, MAX: 30, DEF: 6, label: "Starting survivors" },
  groups: { MIN: 1, MAX: 50, DEF: 7, label: "AI groups" },
  hives: { MIN: 1, MAX: 50, DEF: 4, label: "Starting hives" },
  cities: { MIN: 1, MAX: 12, DEF: 2, label: "Cities" },
  towns: { MIN: 1, MAX: 60, DEF: 13, label: "Towns" },
  military: { MIN: 1, MAX: 12, DEF: 1, label: "Military sites" },
};
export const CUSTOM_KEYS = /** @type {(keyof typeof CUSTOM_RUN)[]} */ (Object.keys(CUSTOM_RUN));

/** One count clamped to its range (its default when not a number). @param {string} key @param {any} v */
export function clampCustomCount(key, v) {
  const R = CUSTOM_RUN[/** @type {keyof typeof CUSTOM_RUN} */ (key)];
  if (!R) return 0;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.max(R.MIN, Math.min(R.MAX, n)) : R.DEF;
}
/** Every count clamped: { people, groups, hives, cities, towns, military }. @param {any} raw */
export function cleanCustom(raw) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of CUSTOM_KEYS) out[k] = clampCustomCount(k, raw && typeof raw === "object" ? raw[k] : null);
  return /** @type {{ people: number, groups: number, hives: number, cities: number, towns: number, military: number }} */ (out);
}
export const defaultCustom = () => cleanCustom(null);

/** A Custom run (a normal start with the counts set: state.custom). @param {any} state */
export const isCustomRun = (state) => !!state && !isRoadStart(state) && !!state.custom;

/** Start with a vehicle: on unless the run was made with it off (older saves: on). @param {any} state */
export const startsWithVehicle = (state) => !state || state.startVehicles !== false;

// A size definition (worldsize.js) with Custom's cities, towns and military sites: with def.customCounts, mapgen.js
// generateMap takes def.cities, def.military and def.towns (in place of its scaled TOWN_COUNT) as they are, lets them
// sit closer when they do not fit, and adds no 50% extra base (its die is still cast).
/** @param {any} def @param {any} custom */
export function customSizeDef(def, custom) {
  const c = cleanCustom(custom);
  return { ...def, cities: c.cities, towns: c.towns, military: c.military, customCounts: true };
}
