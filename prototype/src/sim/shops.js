// @ts-check
// The town's and the city's shops and services as places, and their franchises (the user's requests 2026-10-21:
// "Add gun shop, pawn shops POI and to town and city crawls which have increased loot chances for guns rigs and
// other survival gear"; "add hardware store that has increased spawn of materials needed for building and
// crafting"; "Add sporting good/out door store … electronics shop, radio shop, bookstore and libraries, grocery
// stores, diners, clinics, motels, churches, auto shops, animal/pet stores, fire station, police stations, garden
// center, clothing stores, vet clinics, car dealership, pizza shops and other restaurants, banks, bars, liquor store
// … more common in areas that makes sense … versions that fit the setting … for city, town, suburbs POIs and
// crawls"; "Create many variants for each to show being different franchises including colors, layout etc").
// The kinds, where they stand and their franchises are data: data-shops.js (PLACE_W, FRANCHISES, NEW_KINDS).
//
// THE SETTING (settingOf): a city block ("city"), a city's suburbs (a suburb tile in a city's footprint: "suburb") or
// a town's suburb ring ("town"); nowhere else. Each kind has its weight in each (PLACE_W): banks, clothing,
// electronics and restaurants downtown; garden centers, dealerships, hardware and pet stores in the suburbs; diners,
// churches, vets, gun stores and the feed-and-tackle kind in the towns.
//
// AS POINTS OF INTEREST (pois.js generatePois → shopExtras): up to two on a suburb or city tile, each a roll of its
// own (SHOP.POI by the setting), after the tile's list (so the list before them, and a save's changes to it, stay as
// they were), never a kind the tile has, never past POI.MAX, and beside a site only when it does not out-rank it.
// Marked extra: "shop". Hidden in the unknown zone, in the known zone now and then.
//
// IN THE CITY AND TOWN CRAWLS (citycrawl.js genBlock → shopPlaces): up to two places besides a block's own, each a
// roll of its own (SHOP.CRAWL by a city's or a town's crawl), the kind by its crawl weight (+ deep a block deeper
// in, from block `from`); the block's places before them are as they were.
//
// FRANCHISES (franchiseFor): every place of a kind with franchises is one of them, by its own dice and the setting's
// weights (a Burger Barn anywhere, Big Sky Steakhouse in the suburbs, Smoky Pete's in the towns): poi.v (pois.js,
// every POI of such a kind, the site's too), place.v (the crawl's). Its name is the place's name (pois.js poiName,
// the crawl's card), its look the map's sprite (ui/mapsprites.js), its plan the building's layout (buildingmaps.js
// planOf: a POI's or a crawl place's building option carries variant). A place saved before it had a franchise
// keeps its old building (the containers it remembers line up).
//
// THE OFFICE BUILDINGS (data-offices.js, issue #27): a storefront office, a business park, a call center, a tech office,
// a TV or radio station or the paper are places too (PLACE_W, their own firms), rolled on dice of their own after the
// shops (officeExtras: one more POI a tile at SHOP.OFFICE by the setting; officePlaces: one more crawl place a block at
// SHOP.CRAWL.office), so the shops' rolls and everything before them are as they were. City hall and the courthouse
// stand once a town or a city, on its crawl's civic block (civicPlaces). The office tower's firms (site type "office";
// the crawl's "offices" reads the same list) name it and lay it out as a corporate tower. A save from before them
// (worldcfg.js legacyOffices) gets none of it: its lists, its blocks and its towers stay as they were.
//
// THE SHELVES OF A SHOP POI (shopshelves.js, from scavenge.js searchHour): a site's own tables roll by the tile's site
// type; a shop or a service that is a POI beside another site (or on a bare block) rolls its own kind's rows on dice
// of its own, × what is left of it. (This module stays light: pois.js and citycrawl.js import it.)
/** @import { State, Tile } from "./types" */
import { LOCATIONS } from "./data.js";
import { hash01 } from "./skills.js";
import { PLACE_W, FRANCHISES } from "./data-shops.js";
import { OFFICE_W, COUNTY_SEAT } from "./data-offices.js"; // the office buildings: their own rolls (issue #27)
import { legacyOffices } from "./worldcfg.js"; // a save from before them: none of the office places, its towers without firms

export const SHOP = {
  // POIs: the chance of a first and a second shop on a tile, by the setting; KNOWN: the share of them known from the
  // start in the known zone (the rest hidden until a survey).
  POI: { city: [0.6, 0.3], suburb: [0.5, 0.2], town: [0.45, 0.15] },
  KNOWN: 0.7,
  POOL: [0.7, 1.2],   // pois.js POI.POOL: the pool from richness × this
  URBAN_RICH: 1.15,   // pois.js POI.URBAN_RICH
  CITY_R: [4, 3],     // pois.js POI.CITY_R: a city's footprint (Calder City, the others): its suburbs
  // The crawl: the chance of a first and a second place besides a block's own, by a city's or a town's crawl.
  CRAWL: { city: [0.45, 0.12], town: [0.5, 0.12], office: { city: 0.35, town: 0.3 } }, // office: one office building more, its own roll (officePlaces)
  OFFICE: { city: 0.3, suburb: 0.3, town: 0.25 }, // a POI tile's chance of an office building besides its shops (officeExtras)
  OUTER: 2, // a city crawl's blocks up to this level are its suburbs (their franchises)
};
export const SHOP_KINDS = Object.keys(PLACE_W);
// The office kinds (rolled on their own dice) and the shops' (the old rolls pick among these only, as they always did).
export const OFFICE_KINDS = SHOP_KINDS.filter((k) => !!OFFICE_W[k]);
const BASE_KINDS = SHOP_KINDS.filter((k) => !OFFICE_W[k]);
/** @param {string} k */
export const isShopKind = (k) => !!PLACE_W[k];

/** The setting of a tile: "city", "suburb" (a city's), "town" (a town's ring) or null. @param {State} state @param {Tile} t */
export function settingOf(state, t) {
  if (!t) return null;
  if (t.terrain === "city") return "city";
  if (t.terrain !== "suburb") return null;
  const g = state.grid, cities = state.cityIds || [];
  for (let i = 0; i < cities.length; i++) if (g && g.distance(cities[i], t.id) <= SHOP.CITY_R[i ? 1 : 0]) return "suburb";
  return "town";
}
// A weighted pick of keys by w(key) (keys in a fixed order: the same dice give the same pick).
/** @param {string[]} keys @param {(k: string) => number} w @param {number} r */
function pickW(keys, w, r) {
  const ws = keys.map((k) => Math.max(0, w(k) || 0));
  const tot = ws.reduce((a, b) => a + b, 0);
  if (!(tot > 0)) return null;
  let x = r * tot;
  for (let i = 0; i < keys.length; i++) { x -= ws[i]; if (x < 0 && ws[i] > 0) return keys[i]; }
  for (let i = keys.length - 1; i >= 0; i--) if (ws[i] > 0) return keys[i];
  return null;
}

// ---------- franchises ----------
/** The kind's franchises (data-shops.js), [] for none. @param {string} kind */
export const franchisesOf = (kind) => FRANCHISES[FIRM_KIND[kind] || kind] || [];
// A building key whose firms are a site type's (the crawl's office tower is "offices", its site type "office").
const FIRM_KIND = { offices: "office" };
// Kinds whose firms came later than the place (the office tower's, issue #27): none in a save from before them, so a
// tower there keeps its old plan. @param {State} state @param {string} kind
export const noFirm = (state, kind) => (kind === "office" || kind === "offices") && legacyOffices(state);
/** A franchise by its id, or null. @param {string} kind @param {string | null | undefined} id */
export const franchiseById = (kind, id) => (id ? franchisesOf(kind).find((f) => f.id === id) || null : null);
/** The franchise a place of this kind is in this setting, by its dice r (0–1): its id, or null for a kind without. @param {string} kind @param {string | null} setting @param {number} r */
export function franchiseFor(kind, setting, r) {
  const list = franchisesOf(kind);
  if (!list.length) return null;
  const s = setting || "town";
  return pickW(list.map((f) => f.id), (id) => (list.find((f) => f.id === id) || { w: {} }).w[s], r) || list[0].id;
}
/** A place's name by its franchise ("Burger Barn"), else the kind's. @param {string} kind @param {string | null | undefined} id */
export const franchiseName = (kind, id) => { const f = franchiseById(kind, id); return f ? f.name : LOCATIONS[kind] ? LOCATIONS[kind].name : kind; };

// ---------- points of interest ----------
/**
 * The shops a tile holds besides its list (pois.js generatePois, after the campsite): 0–2 POIs.
 * @param {State} state @param {Tile} t @param {any[]} list @param {boolean} knownZone @param {number} max
 */
export function shopExtras(state, t, list, knownZone, max) {
  const set = settingOf(state, t);
  if (!set) return [];
  const out = [];
  const site = list.find((p) => p.site);
  const cap = site && LOCATIONS[site.kind] ? LOCATIONS[site.kind].richness : Infinity; // never out-ranks the site
  // One more place of the kinds, by its dice (salts: the roll's own names).
  const roll = (kinds, salt, j) => {
    const have = new Set([...list, ...out].map((p) => p.kind));
    if (t.loc) have.add(t.loc.type);
    const kind = pickW(kinds.filter((k) => !have.has(k) && LOCATIONS[k] && LOCATIONS[k].richness <= cap), (k) => PLACE_W[k][set], hash01(state.seed, `${salt}kind`, t.id, j));
    if (!kind) return;
    const spread = SHOP.POOL[0] + (SHOP.POOL[1] - SHOP.POOL[0]) * hash01(state.seed, `${salt}pool`, t.id, j);
    const pool = Math.min(1, LOCATIONS[kind].richness * (t.terrain === "city" ? SHOP.URBAN_RICH : 1) * spread);
    const hidden = !(knownZone && hash01(state.seed, `${salt}known`, t.id, j) < SHOP.KNOWN);
    const v = franchiseFor(kind, set, hash01(state.seed, `${salt}fr`, t.id, j));
    out.push({ kind, hidden, pool, visits: 0, lastDay: null, cont: null, threatStamp: null, stripped: false, extra: "shop", ...(v ? { v } : {}) });
  };
  SHOP.POI[set].forEach((chance, j) => {
    if (list.length + out.length >= max || hash01(state.seed, "shoppoi", t.id, j) >= chance) return;
    roll(BASE_KINDS, "shop", j);
  });
  // An office building (data-offices.js), on its own dice after the shops (theirs as they were).
  if (!legacyOffices(state) && list.length + out.length < max && hash01(state.seed, "officepoi", t.id) < SHOP.OFFICE[set]) roll(OFFICE_KINDS, "office", 0);
  return out;
}

// ---------- the crawl ----------
/**
 * The kinds a crawl block has besides its places (citycrawl.js genBlock): [] to 2 kinds (BUILDINGS keys). n: the
 * block's level; setting: "city" or "town" (the crawl's); has: the building key exists.
 * @param {State} state @param {number} tileId @param {string} cell @param {any[]} places @param {number} max @param {number} n @param {string} setting @param {(k: string) => boolean} has
 */
export function shopPlaces(state, tileId, cell, places, max, n, setting, has) {
  const out = [];
  const pick = (kinds, w, r) => {
    const taken = new Set([...places.map((p) => p.key), ...out]);
    return pickW(kinds.filter((k) => has(k) && !taken.has(k) && n >= PLACE_W[k].crawl.from), (k) => { const c = PLACE_W[k].crawl; return Math.max(w, (c[setting] ?? c.city) + c.deep * (n - 1)); }, r);
  };
  (SHOP.CRAWL[setting] || SHOP.CRAWL.city).forEach((chance, j) => {
    if (places.length + out.length >= max || hash01(state.seed, "crawlshop", tileId, cell, j) >= chance) return;
    const kind = pick(BASE_KINDS, 0.02, hash01(state.seed, "crawlshopkind", tileId, cell, j));
    if (kind) out.push(kind);
  });
  // An office building (data-offices.js), on its own dice after the shops.
  const oc = SHOP.CRAWL.office ? SHOP.CRAWL.office[setting] ?? SHOP.CRAWL.office.city : 0;
  if (!legacyOffices(state) && places.length + out.length < max && hash01(state.seed, "crawloffice", tileId, cell) < oc) {
    const kind = pick(OFFICE_KINDS, 0, hash01(state.seed, "crawlofficekind", tileId, cell));
    if (kind) out.push(kind);
  }
  return out;
}
/**
 * City hall and the courthouse on a crawl's civic block (citycrawl.js genBlock: the block at its heart, civic true):
 * city hall in every town and city, the courthouse in every city and a county seat (COUNTY_SEAT of the towns). [] on
 * any other block, and in a save from before them.
 * @param {State} state @param {number} tileId @param {boolean} civic @param {string} setting @param {(k: string) => boolean} has
 */
export function civicPlaces(state, tileId, civic, setting, has) {
  if (!civic || legacyOffices(state)) return [];
  const seat = setting !== "town" || hash01(state.seed, "countyseat", tileId) < COUNTY_SEAT;
  return ["cityhall", ...(seat ? ["courthouse"] : [])].filter(has);
}
/**
 * A crawl place's franchise (its own dice: the city's, the block's and the slot's): a town's by the town's weights, a
 * city's outer blocks (level SHOP.OUTER or less) by its suburbs', the rest by downtown's.
 * @param {State} state @param {number} tileId @param {string} cell @param {number} slot @param {string} key @param {string} setting @param {number} n
 */
export const crawlFranchise = (state, tileId, cell, slot, key, setting, n) =>
  noFirm(state, key) ? null : franchiseFor(key, setting === "town" ? "town" : n <= SHOP.OUTER ? "suburb" : "city", hash01(state.seed, "crawlfr", tileId, cell, slot, key));
