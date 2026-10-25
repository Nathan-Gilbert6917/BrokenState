// @ts-check
// Where hotels stand (issue #29, the user's request 2026-10-25: "add hotel 200x200 max"). Their buildings are
// hotellayout.js's; their kinds are their franchises' (data-shops.js FRANCHISES.hotel: a roadside inn, a business
// hotel, a resort, a city tower).
//
// AS POINTS OF INTEREST (pois.js generatePois, after the shops: hotelExtra): one now and then on a tile, at HOTELS.AT by
// the setting (shops.js settingOf: a city block, a city's suburbs, a town's ring; else scenic land on or by a road:
// forest, hills or a mountain, or any land by water: HOTELS.SCENIC), on dice of its own after everything else on the tile, so a world's
// lists (and a save's changes to them) stay as they were. Never past POI.MAX, never a second hotel on a tile, never
// beside a site it would out-rank. Its franchise by the setting's weights (w.scenic for scenic land): towns get inns and
// business hotels, cities towers and business hotels, scenic land resorts. Known like a shop in the known zone
// (shops.js SHOP.KNOWN), hidden elsewhere.
//
// IN THE CITY AND TOWN CRAWLS (citycrawl.js genBlock, after the shops: hotelPlace): a block with room for one more
// place holds a hotel at HOTELS.CRAWL (+ deep a block deeper in), on dice of its own; its franchise is the crawl's
// (shops.js crawlFranchise: a town's inns, the outer blocks' business hotels, downtown's towers).
//
// The rates over 300 worlds' dice are measured by tools/hoteltest.js and stated in docs/features/travel.md.
/** @import { State, Tile } from "./types" */
import { LOCATIONS } from "./data.js";
import { hash01 } from "./skills.js";
import { settingOf, franchiseFor, SHOP } from "./shops.js";
import { nearRoad } from "./discovery.js"; // a resort stands by a road

export const HOTELS = {
  AT: { city: 0.09, suburb: 0.06, town: 0.045, scenic: 0.006 }, // a tile's chance of a hotel, by its setting
  SCENIC: ["forest", "hills", "mountain"],                        // scenic land (and any land tile by water), on or by a road
  MAX: 4,                                                        // pois.js POI.MAX
  POOL: [0.7, 1.2], URBAN_RICH: 1.15,                            // its pool: richness × this spread (× the city's)
  CRAWL: { city: 0.07, town: 0.06, deep: 0.015, max: 0.15 },     // a crawl block's chance (+ deep a block deeper, at most max)
  PLACE: { rich: 1.05, dead: 1.2 },                              // a crawl hotel's richness and its dead (citycrawl.js addPlace)
};

/** A tile's setting for a hotel: shops.js settingOf's, else "scenic" (scenic land, land by water, on or by a road), else null. @param {State} state @param {Tile} t */
export function hotelSetting(state, t) {
  const s = settingOf(state, t);
  if (s) return s;
  if (!t || t.terrain === "water" || t.terrain === "city" || t.terrain === "suburb" || !nearRoad(state, t.id)) return null;
  if (HOTELS.SCENIC.includes(t.terrain)) return "scenic";
  const g = state.grid;
  const byWater = !!t.river || !!(g && g.neighbors && g.neighbors(t.id).some((n) => state.tiles[n] && (state.tiles[n].terrain === "water" || state.tiles[n].river)));
  return byWater ? "scenic" : null;
}

/**
 * A hotel the tile holds besides its list (pois.js generatePois, last): the POI, or null.
 * @param {State} state @param {Tile} t @param {any[]} list @param {boolean} knownZone
 */
export function hotelExtra(state, t, list, knownZone) {
  if (!t || list.length >= HOTELS.MAX || list.some((p) => p.kind === "hotel") || (t.loc && t.loc.type === "hotel")) return null;
  const set = hotelSetting(state, t);
  if (!set || hash01(state.seed, "hotelpoi", t.id) >= HOTELS.AT[set]) return null;
  const def = LOCATIONS.hotel, site = list.find((p) => p.site);
  if (site && LOCATIONS[site.kind] && LOCATIONS[site.kind].richness < def.richness) return null; // never out-ranks the site
  const spread = HOTELS.POOL[0] + (HOTELS.POOL[1] - HOTELS.POOL[0]) * hash01(state.seed, "hotelpool", t.id);
  const pool = Math.min(1, def.richness * (t.terrain === "city" ? HOTELS.URBAN_RICH : 1) * spread);
  const hidden = !(knownZone && hash01(state.seed, "hotelknown", t.id) < SHOP.KNOWN);
  const v = franchiseFor("hotel", set, hash01(state.seed, "hotelfr", t.id));
  return { kind: "hotel", hidden, pool, visits: 0, lastDay: null, cont: null, threatStamp: null, stripped: false, extra: "hotel", ...(v ? { v } : {}) };
}

/**
 * Does a crawl block hold a hotel besides its places (citycrawl.js genBlock, after the shops)? n: the block's level;
 * setting: "city" or "town" (the crawl's). @param {State} state @param {number} tileId @param {string} cell @param {any[]} places @param {number} max @param {number} n @param {string} setting
 */
export function hotelPlace(state, tileId, cell, places, max, n, setting) {
  if (places.length >= max || places.some((p) => p.key === "hotel")) return false;
  const C = HOTELS.CRAWL;
  return hash01(state.seed, "crawlhotel", tileId, cell) < Math.min(C.max, (C[setting] ?? C.city) + C.deep * (n - 1));
}
