// @ts-check
// Where buildings stand (issue #42, the user's request 2026-10-26: "Stadiums, zoos hospitals should show in and near
// City centers. Towns can have some large building types and some small buildings and rural areas have smaller
// buildings"). The table is data-placement.js; this module reads it.
//
// - tileClass(state, tile): the tile's class (data-placement.js TILE_CLASSES: centre, city, suburb, town, highway, coast,
//   scenic, rural). crawlClass(c, n): a crawl block's (a town's crawl is a town; a city's rim blocks its suburbs, its
//   heart its centre, the blocks between its city).
// - placeWeight(key, cls), sizeFor(key, cls): a kind's weight and its variant's size class on a class (0 / null where it
//   never stands). sizeClassOf(w, d, storeys): a footprint's size class by its floor area.
// - placementCtx(state, tile, key): what the variant picker (variantpick.js pickVariant, #41) is passed: { tileClass,
//   setting (the six: centre, city, suburb, town, rural, highway; settingOfClass gives buildvariants.js's three), size } for a building of kind key on that tile.
// - New worlds only (state.placeV; save.js marks an older save placeLegacy, worldcfg.js legacyPlace): a new world's
//   POI lists draw their kinds by the table's weights (pois.js generatePois), its shops' and its crawl blocks' picks are
//   weighted by it (shops.js shopExtras / shopPlaces, citycrawl.js genBlock), a hotel, a mall or a bunker never stands
//   where its row says it does not (standsOn), and placeExtra adds the kinds the table puts where the old pools had none:
//   a city centre's medical centre, a town's county hospital, big-box store and high school, the country's clinic,
//   chapel and feed store. An older world's POIs, crawl blocks and buildings stay exactly as they were (placementtest.js
//   checks their hashes).
/** @import { State, Tile } from "./types" */
/** @import { TileClass, SizeClass } from "./data-placement.js" */
import { PLACEMENT, TILE_CLASSES, SIZE_CLASSES, SIZE_AREA, PLACE } from "./data-placement.js";
import { LOCATIONS } from "./data.js";
import { hash01 } from "./skills.js";
import { useSizeClassOf } from "./variantpick.js"; // the shared picker (#41): its plans' size classes by sizeClassOf
import { settingAt } from "./settings.js"; // the six settings (issue #40): this module adds coast and scenic land
import { legacyPlace } from "./worldcfg.js";
import { maxLevel } from "./citygrid.js";

export { TILE_CLASSES, SIZE_CLASSES, PLACE };

// ---------- the tile's class ----------
const classMemo = new WeakMap(); // tiles array -> Uint8Array (index into TILE_CLASSES + 1)
/** @param {State} state @param {Tile | number} tile */
const tileOf = (state, tile) => (typeof tile === "number" ? state.tiles[tile] : tile);
/** Tiles from the nearest city's heart (state.cityIds), Infinity with none. @param {State} state @param {number} id */
export function cityDistance(state, id) {
  const g = state.grid, ids = state.cityIds || [];
  let d = Infinity;
  if (g && g.distance) for (const c of ids) d = Math.min(d, g.distance(c, id));
  return d;
}
/** The class a tile is (see the header and data-placement.js). @param {State} state @param {Tile | number} tile @returns {TileClass} */
export function tileClass(state, tile) {
  const t = tileOf(state, tile);
  if (!t) return "rural";
  let m = classMemo.get(state.tiles);
  if (!m) classMemo.set(state.tiles, (m = new Uint8Array(state.tiles.length)));
  if (!m[t.id]) m[t.id] = TILE_CLASSES.indexOf(classOf(state, t)) + 1;
  return TILE_CLASSES[m[t.id] - 1];
}
// The six settings are settings.js settingAt's (the centre rule is there); a tile out of the cities and towns is coast or
// scenic land before it is a highway's or rural.
/** @param {State} state @param {Tile} t @returns {TileClass} */
function classOf(state, t) {
  const s = settingAt(state, t);
  if (s !== "rural" && s !== "highway") return s;
  if (t.terrain === "water") return "coast";
  if (s === "highway") return "highway";
  const g = state.grid;
  if (t.river || (g && g.neighbors && g.neighbors(t.id).some((n) => state.tiles[n] && state.tiles[n].terrain === "water"))) return "coast";
  if (t.terrain === "forest" || t.terrain === "hills" || t.terrain === "mountain") return "scenic";
  return "rural";
}
/** A class as one of the six settings (#40's settings.js SETTINGS: centre, city, suburb, town, rural, highway): coast and scenic land are rural. @param {TileClass | string | null | undefined} cls */
export const settingAtClass = (cls) => (cls === "coast" || cls === "scenic" || !cls ? "rural" : cls);
/** A class as the three settings the layouts read (buildvariants.js): rural | town | city. @param {TileClass | string | null | undefined} cls */
export const settingOfClass = (cls) => (cls === "centre" || cls === "city" ? "city" : cls === "suburb" || cls === "town" ? "town" : "rural");
/**
 * A crawl block's class: a town's crawl a town; a city's rim blocks (level SHOP.OUTER, 2, or less) its suburbs, its
 * heart (its deepest level and the one before, from level 3) its centre, the rest city.
 * @param {{ grid?: { size: number, r: number, town?: boolean } } | null} c the crawl (citycrawl.js p.crawl) @param {number} n the block's level @param {string} [setting] the crawl's ("town" | "city")
 * @returns {TileClass}
 */
export function crawlClass(c, n, setting = c && c.grid && c.grid.town ? "town" : "city") {
  if (setting === "town") return "town";
  if (n <= 2) return "suburb";
  const top = c && c.grid ? maxLevel(c.grid) : 4;
  return n >= Math.max(3, top - 1) ? "centre" : "city";
}

// ---------- the table ----------
/** A kind's weight on a class (0: it never stands there). @param {string} key @param {TileClass | string} cls */
export const placeWeight = (key, cls) => (PLACEMENT[key] && PLACEMENT[key].at[cls]) || 0;
/** The size class a kind's variant takes on a class (null: it never stands there). @param {string} key @param {TileClass | string} cls @returns {SizeClass | null} */
export const sizeFor = (key, cls) => (PLACEMENT[key] && PLACEMENT[key].size[cls]) || null;
/** The classes a kind stands on. @param {string} key @returns {TileClass[]} */
export const classesOf = (key) => TILE_CLASSES.filter((c) => placeWeight(key, c) > 0);
/** A footprint's size class by its floor area (w × d metres, all storeys). @param {number} w @param {number} d @param {number} [storeys] @returns {SizeClass} */
export function sizeClassOf(w, d, storeys = 1) {
  const a = Math.max(0, w) * Math.max(0, d) * Math.max(1, storeys || 1);
  const i = SIZE_AREA.findIndex((x) => a < x);
  return SIZE_CLASSES[i < 0 ? SIZE_CLASSES.length - 1 : i];
}
useSizeClassOf(sizeClassOf); // the variant picker classes a plan by its foot with it (variantpick.js, #41)
/**
 * What the variant picker is passed for a building of kind key on a tile (variantpick.js pickVariant's ctx, #41):
 * { tileClass, setting, size }: setting the six-word one (settingAtClass: coast and scenic land rural; settingOfClass gives
 * the layouts' three), size the table's for the kind on the class, null where it does not stand.
 * @param {State} state @param {Tile | number} tile @param {string} key
 * @returns {{ tileClass: TileClass, setting: string, size: SizeClass | null }}
 */
export function placementCtx(state, tile, key) {
  const cls = tileClass(state, tile);
  return { tileClass: cls, setting: settingAtClass(cls), size: sizeFor(key, cls) };
}
/** The same for a crawl block. @param {any} c @param {number} n @param {string} key @param {string} [setting] */
export function crawlCtx(c, n, key, setting) {
  const cls = crawlClass(c, n, setting);
  return { tileClass: cls, setting: settingAtClass(cls), size: sizeFor(key, cls) };
}

// ---------- a new world's picks ----------
/** Does the table weigh this world's picks (a new world)? @param {State} state */
export const placing = (state) => !legacyPlace(state);
/**
 * The multiplier the table puts on a pick of kind key on a tile or a crawl block of class cls: 1 in an older world; 0
 * where the kind never stands.
 * @param {State} state @param {string} key @param {TileClass | string} cls
 */
export const placeMult = (state, key, cls) => (placing(state) && PLACEMENT[key] ? placeWeight(key, cls) : 1);
/** May a kind stand on this tile (a new world: the table's; an older one: yes)? @param {State} state @param {string} key @param {Tile | number} tile */
export const standsOn = (state, key, tile) => placeMult(state, key, tileClass(state, tile)) > 0;

// The kinds placeExtra adds where the old pools had none: [kind, { class: chance a tile }]. A city centre's medical
// centre (and the city blocks'), a town's county hospital, big-box store and high school, the country's clinic, chapel
// and feed store, a farm stand by the road.
export const PLACE_EXTRA = [
  ["hospital", { centre: 0.06, city: 0.03, town: 0.0015 }],
  ["supermarket", { town: 0.006 }],
  ["school", { town: 0.008 }],
  ["clinic", { rural: 0.004, scenic: 0.002, highway: 0.004 }],
  ["church", { rural: 0.006, highway: 0.004 }],
  ["feedstore", { rural: 0.004, highway: 0.006 }],
  ["farmstand", { highway: 0.01 }],
  // Issue #59: a zoo (zoo.js), its variant by the placement table's size class: about one big zoo for every two or three
  // cities by their centres, a few in the suburbs and the towns, a handful out in the country (a world of 17 cities
  // has some 98 centre tiles, 370 suburb, 2,300 town, 2,500 highway, 2,400 coast, 10,000 rural and 18,000 scenic).
  ["zoo", { centre: 0.1, city: 0.05, suburb: 0.008, town: 0.002, highway: 0.001, coast: 0.0008, scenic: 0.00015, rural: 0.0004 }],
];
export const PLACE_KNOWN = 0.7; // the share of them known from the start in the known zone (shops.js SHOP.KNOWN)
/**
 * The kind of one more POI a new world's tile may hold by the table (pois.js generatePois builds it, last, on dice of
 * its own): the kind or null. Never past max, never a kind the tile has, never beside a site it would out-rank.
 * @param {State} state @param {Tile} t @param {any[]} list @param {number} max @returns {string | null}
 */
export function placeExtraKind(state, t, list, max) {
  if (!t || !placing(state) || list.length >= max || t.terrain === "water") return null;
  const cls = tileClass(state, t);
  const site = list.find((p) => p.site);
  const cap = site && LOCATIONS[site.kind] ? LOCATIONS[site.kind].richness : Infinity;
  for (const [kind, at] of PLACE_EXTRA) {
    const p = /** @type {Record<string, number>} */ (at)[cls] || 0;
    if (!p || !LOCATIONS[kind] || LOCATIONS[kind].richness > cap || list.some((q) => q.kind === kind) || (t.loc && t.loc.type === kind)) continue;
    if (hash01(state.seed, "placepoi", t.id, kind) < p) return /** @type {string} */ (kind);
  }
  return null;
}
