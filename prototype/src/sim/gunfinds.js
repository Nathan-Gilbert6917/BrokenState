// @ts-check
// An extra gun now and then (first for the arsenal of 2026-10-10: the over-unders, single-shots, 20 gauges, the NATO
// carbines and battle rifles, the .45s, the hand cannon, the .308 machine gun). Every roll here is on dice of its own
// (skills.js hash01 of the world's seed and the place), never the world's random numbers, so everything else a search,
// a raid, a trader's week, an AI scavenging trip or a gun safe turns up comes out as it did before.
//
// The chance a roll finds one: ARSENAL_FINDS.site / area / wares / scav / stash. Which gun: the place's or shelf's draws
// in the gun distribution (gundist.js: "site:<type>", "area:<type>", "trader:<type>", "stash:<table>"; any gun whose
// class the source draws, by rarity). A gun found comes with its spare magazines (carrykit.js gunMags, its own dice) and
// its factory parts.
import { GEAR } from "./data.js";
import { hash01 } from "./skills.js";
import { lootItem } from "./inventory.js";
import { siteSource, areaSource, traderSource } from "./itemcond.js";
import { ARSENAL_FINDS, THEME_DRAWS } from "./data-guns.js";
import { gunsFrom, drawGun, areaSourceName } from "./gundist.js";
import { gunMags } from "./carrykit.js";

const FRESH = { fresh: true }; // the extra rolls: new guns × GUN_NEWNESS.mult (data-guns.js; the lists' swaps and kits keep their weights)

// The guns that fit these loot.js theme tags: { key: weight } (the draws of the tags, data-guns.js THEME_DRAWS, by
// rarity: gundist.js). kinds: only these GEAR cats (a pistol case: pistols). For the tools; the rolls below name
// their source.
/** @param {string[]} tags @param {string[] | null} [kinds] @returns {Record<string, number>} */
export function gunPool(tags, kinds = null) {
  /** @type {Record<string, number>} */
  const draws = {};
  for (const t of tags || []) for (const [u, w] of Object.entries(THEME_DRAWS[t] || {})) draws[u] = Math.max(draws[u] || 0, w);
  /** @type {Record<string, number>} */
  const out = {};
  const name = `pool:${(tags || []).join(",")}|${(kinds || []).join(",")}`;
  const def = { draws, theme: tags || [], ...(kinds ? { cats: kinds } : {}) };
  for (const [k, w] of Object.entries(gunsFrom(name, { def }))) out[k] = w;
  return out;
}
// A gun and its spare magazines.
/** @param {string} key @param {string} source @param {any[]} tag */
function found(key, source, tag) {
  const gun = lootItem(key, source, [...tag, "q"]);
  return [gun, ...gunMags(gun, source, ...tag)];
}

// This search hour's find at a site (scavenge.js searchHour; mult: Treasure Hunter and the search pace).
/** @param {any} state @param {number} tileId @param {number} [mult] @param {string} [salt] @returns {any[]} */
export function rollSiteGuns(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const type = t && t.loc ? t.loc.type : null;
  const p = type ? ARSENAL_FINDS.site[type] : 0;
  if (!p) return [];
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "arsfind", tileId, state.hour, salt) >= p * loot * mult) return [];
  const key = drawGun(`site:${type}`, hash01(state.seed, "arspick", tileId, state.hour, salt), FRESH);
  return key ? found(key, siteSource(type), [state.seed, "arsf", tileId, state.hour, salt]) : [];
}
// A raid container's find (combat.js searchBox), by its area type.
/** @param {any} state @param {number} tileId @param {string} areaType @param {string | null} [site] @param {string} [salt] @returns {any[]} */
export function rollAreaGuns(state, tileId, areaType, site = null, salt = "") {
  const p = ARSENAL_FINDS.area[areaType];
  if (!p || hash01(state.seed, "arsarea", tileId, salt) >= p) return [];
  const key = drawGun(areaSourceName(areaType, site), hash01(state.seed, "arsareapick", tileId, salt), FRESH);
  return key ? found(key, areaSource(areaType, site), [state.seed, "arsa", tileId, areaType, salt]) : [];
}
// A city crawl's container (citycrawl.js rollArea, by the numbers): the same chance by its area as a raid container's,
// the gun by the room at its building (a police station's armoury: police guns; an Army checkpoint's: the Army's), on
// dice of its own (a hash of the crawl's dice position: no draw).
/** @param {string} areaType @param {string | null} site @param {any} rng */
export function crawlGuns(areaType, site, rng) {
  const p = ARSENAL_FINDS.area[areaType];
  const seed = rng && Number.isFinite(rng.state) ? rng.state : 0;
  if (!p || hash01(seed, "crawlgun", areaType) >= p) return [];
  const key = drawGun(areaSourceName(areaType, site), hash01(seed, "crawlgunpick", areaType), FRESH);
  return key ? found(key, areaSource(areaType, site || "city"), [seed, "crawlg", areaType]) : [];
}
// A group's shelf a week (trade.js ensureWares): now and then one of the arsenal's guns, by what the group stocks.
/** @param {any} state @param {string} type @param {string} name @param {any} [salt] @returns {any[]} */
export function gunWares(state, type, name, salt = "") {
  const p = ARSENAL_FINDS.wares[type];
  if (!p || hash01(state.seed, "arsware", name, salt) >= p) return [];
  const key = drawGun(`trader:${type}`, hash01(state.seed, "arswarepick", name, salt), FRESH);
  return key ? found(key, traderSource(type), [state.seed, "arsw", name, salt]) : [];
}
// An AI group's scavenging trip (arsenal.js): the same site table your searches roll, on its dice (AI parity).
// taken: the share of the site's loot the trip took. Returns a key or null.
/** @param {string} siteType @param {number} taken @param {any[]} tag */
export function scavGun(siteType, taken, tag) {
  const p = ARSENAL_FINDS.site[siteType];
  if (!p || !(taken > 0) || hash01(...tag, "arsscav") >= Math.min(1, p * ARSENAL_FINDS.scav * taken * 40)) return null;
  return drawGun(`site:${siteType}`, hash01(...tag, "arsscavpick"), FRESH);
}
// A gun safe's or a gun case's extra gun (gunsafes.js registers it): ctx { roll, tier, table, siteType }.
/** @param {any} ctx @param {any} out */
export function stashGun(ctx, out) {
  const name = ctx && (ctx.table || ctx.tier);
  const p = ARSENAL_FINDS.stash[name];
  if (!p || !out || !Array.isArray(out.gear) || ctx.roll("arsgun") >= p) return;
  const key = drawGun(`stash:${name}`, ctx.roll("arsgunpick"), FRESH);
  if (key) out.gear.push(lootItem(key, ctx.source || "gunsafe", ctx.roll("arsgunq"))); // (no spare magazines: the safe's own rolls gave them out)
}
