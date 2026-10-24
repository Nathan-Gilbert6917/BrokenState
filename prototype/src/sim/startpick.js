// @ts-check
// Where you start, rolled again on the same map (the new-run screen's New start position, 2026-10-16, user request).
// world.js createWorld picks the hub's town, hardcore-start.js spawnTile the roadside tile; both from lists of
// candidates in order of preference (the first that has any is used). The world's die is always cast and kept out of
// it, so the map, the hives and every later draw follow the seed as before; with a start of its own
// ({ roll, not }), dice of their own pick the tile instead, away from `not` (the one on screen) when there is anywhere
// else to go, widening to the next list if the first offers nowhere new.
// A start picked on the map ({ tile }, the new-run screen's Pick start on map, 2026-10-22, user request): that tile, if
// it can be a start (startWhyNot: open land START_CLEAR tiles or more from the towns, cities, hives and groups); the
// world's die is cast all the same, so only where you start changes.
import { Rng } from "./rng.js";

// A town's or a city's tile (the user's request 2026-10-22: "Bases cannot be established in towns and city tiles"): the
// city's blocks and suburbs (terrain city, suburb), a town's centre (loc town) and its shops and services round it (a
// site with the settlement it belongs to; a farm out by a town is countryside, not the town). staging.js campProblem
// and parties.js missionProblem keep every new base of yours off them; the start keeps START_CLEAR tiles away.
// Since the user's word 2026-10-23 ("The ban should be on the tiles for town and city crawls. When you set up a base
// you can raid the other POIs on the same tile and show the base on the POI map") the ban on a new base is only the
// crawl tiles (citycrawl.js crawlTile: a town's or a city's centre, a bare city block): the suburbs and a city tile
// with a place of its own take a camp once the dead there are cleared (siteclear.js). The start's rule stays this one.
/** @param {any} t */
export const isSettlementTile = (t) => !!t && (t.terrain === "city" || t.terrain === "suburb" ||
  (!!t.loc && (t.loc.type === "town" || t.loc.type === "city" || (t.loc.settlement != null && t.loc.zone !== "rural"))));
export const SETTLEMENT_WHY = "Not in a town or a city: a base has to go up outside them.";
export const CRAWL_WHY = "Not on a town's or a city's crawl tile (its blocks are gone through block by block): a base goes up in the suburbs or beyond.";

/**
 * @template {{ id: number }} T
 * @param {Rng} rng the world's dice
 * @param {Array<() => T[]>} lists candidates, best first (worked out only when needed)
 * @param {{ roll?: number | null, not?: number | null, tile?: number | null } | null} [start]
 * @returns {T}
 */
export function pickStart(rng, lists, start = null) {
  const seen = [];
  const get = (i) => (seen[i] ??= lists[i]());
  let rolled = null;
  for (let i = 0; i < lists.length && !rolled; i++) if (get(i).length) rolled = rng.pick(get(i));
  if (!start || start.roll == null) return rolled;
  const own = new Rng(start.roll);
  for (let i = 0; i < lists.length; i++) {
    const others = get(i).filter((t) => t.id !== start.not);
    if (others.length) return own.pick(others);
  }
  return rolled;
}

// How far a start keeps from the towns, the cities, the hives, the Guard's bases and the other groups' bases (the user's
// request 2026-10-22: "When you select your start on the map make it so you can only select 5 tiles away from cities,
// towns, hives etc"; normal mode only): at least this many tiles. The normal start's hub is out in the open, never in a town (no base is:
// isSettlementTile), and world.js rolls its own start by the same rule (startNear).
export const START_CLEAR = 5;
// What is too near each tile for a start: Map id → { what, d } (the nearest of them), worked out once a map and its
// groups' bases (the hover tip asks for every tile under the mouse).
const nearCache = new WeakMap();
/** @param {any} state @returns {Map<number, { what: string, d: number }>} */
export function startNear(state) {
  const key = `${(state.factions || []).map((f) => (f.alive === false ? "" : (f.bases || []).join("."))).join("|")}#${(state.militaryIds || []).join(".")}`;
  const hit = nearCache.get(state);
  if (hit && hit.key === key) return hit.near;
  const g = state.grid, near = new Map();
  const mark = (id, what) => {
    for (const n of g.within(id, START_CLEAR - 1)) {
      const d = g.distance(id, n), was = near.get(n);
      if (!was || d < was.d) near.set(n, { what, d });
    }
  };
  for (const t of state.tiles) {
    if (isSettlementTile(t)) {
      const c = t.loc && t.loc.type === "town" ? t : t.loc && t.loc.settlement != null ? state.tiles[t.loc.settlement] : null;
      const town = c && c.loc && c.loc.type === "town";
      mark(t.id, town ? `the town of ${c.loc.name}` : c && c.loc ? `the city of ${c.loc.name}` : "the city");
    }
    if (t.hive) mark(t.id, "a hive");
  }
  for (const id of state.militaryIds || []) mark(id, "a National Guard base");
  for (const f of state.factions || []) if (f.alive !== false) for (const id of f.bases || []) mark(id, `${f.name}'s base`);
  nearCache.set(state, { key, near });
  return near;
}

// Why a tile cannot be picked as the start ("" when it can). A normal start's hub: open land (no water, mountain or
// hive), outside every town and city and START_CLEAR tiles or more from them, the hives, the Guard's bases and the
// other groups' (startNear; the user's request 2026-10-22, for normal mode). A Hardcore start (as it was): any open land
// that is not a hive or another group's base or the Guard's.
/**
 * @param {any} state
 * @param {number} id
 * @returns {string}
 */
export function startWhyNot(state, id) {
  const t = state.tiles[id];
  if (!t) return "That is off the map.";
  if (t.terrain === "water") return "You cannot start on the water.";
  if (t.terrain === "mountain") return "You cannot start in the mountains.";
  if (t.hive) return "A hive is there.";
  if ((state.militaryIds || []).includes(id)) return "The National Guard holds that base.";
  if (state.factions.some((f) => (f.bases || []).includes(id))) return "Another group's base is there.";
  if (state.mode === "hardcore" || state.crash) return ""; // Hardcore and Crashlanding (crashmode.js, 2026-10-24): any open land that is no hive and no base
  if (isSettlementTile(t)) return `Your hub cannot be in a town or a city: pick open land at least ${START_CLEAR} tiles out.`;
  const n = startNear(state).get(id);
  if (n) return `Too close to ${n.what} (${n.d} tile${n.d === 1 ? "" : "s"}): a start has to be at least ${START_CLEAR} tiles from the towns, the cities, the hives and the other groups.`;
  return "";
}

// The tile a start picked on the map names, when it can be one (else null: the dice's start stands).
/**
 * @param {any} state
 * @param {{ tile?: number | null } | null} start
 */
export function chosenStart(state, start) {
  return start && start.tile != null && !startWhyNot(state, start.tile) ? state.tiles[start.tile] : null;
}
