// @ts-check
// The one setting vocabulary (issue #40 of the round-2 epic #39, agreed with #42's placement table): where a building
// stands, as every variant picker (variantpick.js, #41) and the placement table by setting (#42) read it.
//
//   centre    a city's own tile (state.cityIds: its downtown; #42's stadiums, zoos and hospitals stand in and near it)
//   city      the rest of a city's tiles (terrain "city"), and a site the map calls urban (loc.zone "urban")
//   suburb    a city's suburbs (shops.js settingOf: a suburb tile within SHOP.CITY_R of a city)
//   town      a town's ring (the other suburb tiles), and a site in a town (loc.zone "town")
//   highway   open land with a road through it (a truck stop's, a motel's, a strip's)
//   rural     everything else: farms, the countryside's sites, open land
// A tile's site type (tile.loc.type: military, prison, univ, farm...) is not a setting: whereOf gives it as `site`.
// #42 owns the rule for centre against city and may refine settingAt; the six names stay.
//
// THE OLDER WORDS. The pickers from epic #7 each read the setting in their own words, and keep them so a save's picks
// never move (each is its module's projection of the tile; buildingmaps.js makeSpec passes every one, and the canonical
// one as o.where):
//   o.lset     buildvariants.js settingOfTile: rural | town | city (#32's homes and motels; #23's schools)
//              (centre, city → city; suburb, town → town; highway, rural → rural; a site's loc.zone first)
//   o.vset     shopvariants.js variantSetting: rural | town | city | highway (+ strip, a strip mall's slot) (#35)
//              (centre, city → city; suburb, town → town; highway; rural), from the terrain alone
//   o.setting  buildingmaps.js siteWhere: city | suburb | town | rural (#36's civic and medical; realStoreys)
//              (centre, city → city; suburb; town; highway, rural → rural)
//   o.site     industrylayout.js SETTING_OF: urban | industrial | campus | rural, by the site's type (#37)
// The arrows say how a new picker reads an old table (asLayoutSetting...): on a few tiles (an urban site off the city's
// terrain) the older projections differ from each other, which is why they stay as they were.
import { settingOf as shopSetting } from "./shops.js";

/** @typedef {"centre" | "city" | "suburb" | "town" | "rural" | "highway"} Setting */
/** @type {Setting[]} */
export const SETTINGS = ["centre", "city", "suburb", "town", "rural", "highway"];
/** @param {any} s @returns {s is Setting} */
export const isSetting = (s) => SETTINGS.includes(s);

/**
 * The setting a tile stands in (the header's list). No tile (a hint, a test): "town".
 * @param {any} state @param {any} tile @returns {Setting}
 */
export function settingAt(state, tile) {
  if (!tile) return "town";
  const cities = (state && state.cityIds) || [];
  if (tile.terrain === "city") return cities.includes(tile.id) ? "centre" : "city";
  const z = tile.loc && tile.loc.zone;
  if (z === "urban") return "city";
  if (z === "town") return "town";
  if (tile.terrain === "suburb") return (state && state.grid ? shopSetting(state, tile) : "town") === "suburb" ? "suburb" : "town";
  return tile.road ? "highway" : "rural";
}

/** Where a building stands: its setting and its site's type (null off a site). @param {any} state @param {any} tile @returns {{ setting: Setting, site: string | null }} */
export const whereOf = (state, tile) => ({ setting: settingAt(state, tile), site: tile && tile.loc ? tile.loc.type || null : null });

// A canonical setting in an older table's words (the header's arrows).
/** @param {string | null | undefined} s @returns {"rural" | "town" | "city"} */
export const asLayoutSetting = (s) => (s === "centre" || s === "city" ? "city" : s === "suburb" || s === "town" ? "town" : s === "rural" || s === "highway" ? "rural" : "town");
/** @param {string | null | undefined} s @returns {"rural" | "town" | "city" | "highway"} */
export const asShopSetting = (s) => (s === "centre" || s === "city" ? "city" : s === "suburb" || s === "town" ? "town" : s === "highway" ? "highway" : "rural");
/** @param {string | null | undefined} s @returns {"city" | "suburb" | "town" | "rural"} */
export const asCivicSetting = (s) => (s === "centre" || s === "city" ? "city" : s === "suburb" ? "suburb" : s === "town" ? "town" : "rural");
