// @ts-check
// Gun stores and pawn shops in the towns and cities (the user's request 2026-10-21: "Add gun shop, pawn shops POI and
// to town and city crawls which have increased loot chances for guns rigs and other survival gear").
//
// The hardware store too (the user's request 2026-10-21: "add hardware store that has increased spawn of materials
// needed for building and crafting"): the old hardware store site, now with aisles of its own on a raid map (combat.js
// AREAS hardware: building materials, lumber, scrap and parts, the tools), more scrap and parts by the search hour,
// the most building materials of any place (loot.js BUILDMAT_FINDS) and more wood (SITE_WOOD); as a POI or a crawl
// place like the others (shopshelves.js rollShopSupplies: its building materials and wood as a POI).
//
// THE SHOPS (data.js LOCATIONS gunstore, pawnshop, hardware): the gun store is the old gun store site (guns, rounds, rigs, a
// gun cage); the pawn shop is new: what people pawned behind a counter (handguns, hunting guns, rigs, packs, filters,
// stoves, lamps, radios and blades among the jewellery and the electronics), a locked gun case in the back. Both have
// gearRate (scavenge.js: the search hour's gear roll × it) and their own rows in the tables of rigs and magazines
// (carrykit.js SITE_KIT / AREA_KIT), survival gear (data-survival.js SURV_FINDS / AREA_SURV), extra guns
// (data-guns.js ARSENAL_FINDS, PLACE_DRAWS), parts, blades, books and locks; a raid's rooms are the "pawnshop" and
// "gunshop" areas (combat.js AREAS, buildingmaps.js shop).
//
// AS POINTS OF INTEREST (pois.js generatePois → shopExtra): on a suburb tile (the ring round every town) or a city
// block, by their own dice after the tile's list (so the list before it, and a save's changes to it, stay as they
// were), one shop at most (SHOP.POI), never a second of a kind the tile has, never past POI.MAX, and beside a site only
// when it does not out-rank it. Marked extra: "shop". Hidden in the unknown zone, in the known zone now and then.
//
// IN THE CITY AND TOWN CRAWLS (citycrawl.js genBlock → shopPlace): a block may have a gun store or a pawn shop
// besides its places, by its own dice (SHOP.CRAWL; the block's places before it are as they were), from the first
// block in; shown as a find on the block's card (rare). Their richness and dead: SHOP.PLACE.
//
// THE SHELVES OF A SHOP POI (shopshelves.js, from scavenge.js searchHour): a site's own tables roll by the tile's site
// type; a gun store or a pawn shop that is a POI beside another site (or on a bare block) rolls its own kind's rigs,
// magazines, survival gear, small finds, attachments and an extra gun on dice of its own, × what is left of it.
// (This module stays light: pois.js and citycrawl.js import it.)
/** @import { State, Tile } from "./types" */
import { LOCATIONS } from "./data.js";
import { hash01 } from "./skills.js";

export const SHOP = {
  // POIs: the chance a tile holds one, by terrain and kind (one roll a tile: pawn shop, else gun store, else none);
  // KNOWN: the share of them known from the start in the known zone (the rest hidden until a survey).
  POI: { suburb: { pawnshop: 0.08, gunstore: 0.05, hardware: 0.07 }, city: { pawnshop: 0.07, gunstore: 0.05, hardware: 0.06 } },
  KNOWN: 0.7,
  POOL: [0.7, 1.2],   // pois.js POI.POOL: the pool from richness × this
  URBAN_RICH: 1.15,   // pois.js POI.URBAN_RICH
  // The crawl: the chance a block has one besides its places (one roll a block).
  CRAWL: { pawnshop: 0.07, gunstore: 0.05, hardware: 0.05 },
  // The crawl's place stats (citycrawl.js PLACE_POOL's rich, dead, rare) for a shop placed by these dice.
  PLACE: { pawnshop: { rich: 1.1, dead: 0.9, rare: true }, gunstore: { rich: 1.2, dead: 1, rare: true }, hardware: { rich: 1.1, dead: 0.9 } },
};
export const SHOP_KINDS = ["pawnshop", "gunstore", "hardware"]; // (the roll's order: a new kind goes last, the others' tiles stay as they were)
export const isShopKind = (k) => SHOP_KINDS.includes(k);

/** @param {Record<string, number>} chances @param {number} r @returns {string | null} */
function pickShop(chances, r) {
  let acc = 0;
  for (const k of SHOP_KINDS) { acc += chances[k] || 0; if (r < acc) return k; }
  return null;
}

// ---------- points of interest ----------
/**
 * The shop a tile holds besides its list, or null (pois.js generatePois, after the campsite).
 * @param {State} state @param {Tile} t @param {any[]} list @param {boolean} knownZone @param {number} max
 */
export function shopExtra(state, t, list, knownZone, max) {
  const odds = t && SHOP.POI[t.terrain];
  if (!odds || list.length >= max) return null;
  const kind = pickShop(odds, hash01(state.seed, "shoppoi", t.id));
  if (!kind || list.some((p) => p.kind === kind) || (t.loc && t.loc.type === kind)) return null;
  const site = list.find((p) => p.site);
  if (site && LOCATIONS[kind].richness > LOCATIONS[site.kind].richness) return null; // never out-ranks the site
  const spread = SHOP.POOL[0] + (SHOP.POOL[1] - SHOP.POOL[0]) * hash01(state.seed, "shoppool", t.id);
  const pool = Math.min(1, LOCATIONS[kind].richness * (t.terrain === "city" ? SHOP.URBAN_RICH : 1) * spread);
  const hidden = !(knownZone && hash01(state.seed, "shopknown", t.id) < SHOP.KNOWN);
  return { kind, hidden, pool, visits: 0, lastDay: null, cont: null, threatStamp: null, stripped: false, extra: "shop" };
}

// ---------- the crawl ----------
/**
 * The shop a crawl block has besides its places (citycrawl.js genBlock), or null: the building key.
 * @param {State} state @param {number} tileId @param {string} cell @param {any[]} places @param {number} max
 */
export function shopPlace(state, tileId, cell, places, max) {
  if (places.length >= max) return null;
  const kind = pickShop(SHOP.CRAWL, hash01(state.seed, "crawlshop", tileId, cell));
  return kind && !places.some((p) => p.key === kind) ? kind : null;
}
