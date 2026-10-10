// @ts-check
// Where the arsenal of 2026-10-10 turns up (data-guns.js ARSENAL_GEAR: the over-unders, single-shots, 20 gauges, the
// NATO carbines and battle rifles, the .45s, the hand cannon, the .308 machine gun). Every roll here is on dice of its
// own (skills.js hash01 of the world's seed and the place), never the world's random numbers, so everything else a
// search, a raid, a trader's week, an AI scavenging trip or a gun safe turns up comes out as it did before.
//
// The pool at a place: the arsenal's guns whose theme tags (data-guns.js ARSENAL_TAGS, loot.js ITEM_TAGS) meet the
// place's (loot.js SITE_TAGS / AREA_TAGS; a group's shelf: GUN_FINDS.WARE_TAGS; a safe: STASH_TAGS), each weighted by
// its rarity (GUN_RARITY → GUN_FINDS.FIND_W). The chance a roll finds one: GUN_FINDS.site / area / wares / scav /
// stash. A gun found comes with its spare magazines (carrykit.js gunMags, its own dice) and its factory parts.
import { GEAR } from "./data.js";
import { hash01 } from "./skills.js";
import { lootItem } from "./inventory.js";
import { siteSource, areaSource, traderSource } from "./itemcond.js";
import { SITE_TAGS, AREA_TAGS } from "./loot.js";
import { ARSENAL_GEAR, ARSENAL_TAGS, GUN_RARITY, GUN_FINDS } from "./data-guns.js";
import { gunMags } from "./carrykit.js";

const POOLS = new Map();
// The guns that fit these tags: { key: weight }. kinds: only these GEAR cats (a pistol case: pistols).
/** @param {string[]} tags @param {string[] | null} [kinds] @returns {Record<string, number>} */
export function gunPool(tags, kinds = null) {
  const id = `${(tags || []).join(",")}|${(kinds || []).join(",")}`;
  if (!POOLS.has(id)) {
    /** @type {Record<string, number>} */
    const out = {};
    for (const k of Object.keys(ARSENAL_GEAR)) {
      if (!GEAR[k] || !(ARSENAL_TAGS[k] || []).some((t) => (tags || []).includes(t))) continue;
      if (kinds && !kinds.includes(GEAR[k].cat)) continue;
      out[k] = GUN_FINDS.FIND_W[GUN_RARITY[k] || "rare"] || 0;
    }
    POOLS.set(id, out);
  }
  return POOLS.get(id);
}
/** @param {Record<string, number>} pool @param {number} u */
function pick(pool, u) {
  const list = Object.entries(pool).filter(([, w]) => w > 0).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const tot = list.reduce((a, [, w]) => a + w, 0);
  let x = u * tot;
  for (const [k, w] of list) { x -= w; if (x < 0) return k; }
  return list.length ? list[list.length - 1][0] : null;
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
  const p = type ? GUN_FINDS.site[type] : 0;
  if (!p) return [];
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "arsfind", tileId, state.hour, salt) >= p * loot * mult) return [];
  const key = pick(gunPool(SITE_TAGS[type] || []), hash01(state.seed, "arspick", tileId, state.hour, salt));
  return key ? found(key, siteSource(type), [state.seed, "arsf", tileId, state.hour, salt]) : [];
}
// A raid container's find (combat.js searchBox), by its area type.
/** @param {any} state @param {number} tileId @param {string} areaType @param {string | null} [site] @param {string} [salt] @returns {any[]} */
export function rollAreaGuns(state, tileId, areaType, site = null, salt = "") {
  const p = GUN_FINDS.area[areaType];
  if (!p || hash01(state.seed, "arsarea", tileId, salt) >= p) return [];
  const key = pick(gunPool(AREA_TAGS[areaType] || []), hash01(state.seed, "arsareapick", tileId, salt));
  return key ? found(key, areaSource(areaType, site), [state.seed, "arsa", tileId, areaType, salt]) : [];
}
// A group's shelf a week (trade.js ensureWares): now and then one of the arsenal's guns, by what the group stocks.
/** @param {any} state @param {string} type @param {string} name @param {any} [salt] @returns {any[]} */
export function gunWares(state, type, name, salt = "") {
  const p = GUN_FINDS.wares[type];
  if (!p || hash01(state.seed, "arsware", name, salt) >= p) return [];
  const key = pick(gunPool(GUN_FINDS.WARE_TAGS[type] || []), hash01(state.seed, "arswarepick", name, salt));
  return key ? found(key, traderSource(type), [state.seed, "arsw", name, salt]) : [];
}
// An AI group's scavenging trip (arsenal.js): the same site table your searches roll, on its dice (AI parity).
// taken: the share of the site's loot the trip took. Returns a key or null.
/** @param {string} siteType @param {number} taken @param {any[]} tag */
export function scavGun(siteType, taken, tag) {
  const p = GUN_FINDS.site[siteType];
  if (!p || !(taken > 0) || hash01(...tag, "arsscav") >= Math.min(1, p * GUN_FINDS.scav * taken * 40)) return null;
  return pick(gunPool(SITE_TAGS[siteType] || []), hash01(...tag, "arsscavpick"));
}
// A gun safe's or a gun case's extra gun (gunsafes.js registers it): ctx { roll, tier, table, siteType }.
const STASH_KINDS = { pistolcase: ["pistol"], riflecase: ["rifle", "shotgun"] };
/** @param {any} ctx @param {any} out */
export function stashGun(ctx, out) {
  const name = ctx && (ctx.table || ctx.tier);
  const p = GUN_FINDS.stash[name];
  if (!p || !out || !Array.isArray(out.gear) || ctx.roll("arsgun") >= p) return;
  const key = pick(gunPool(GUN_FINDS.STASH_TAGS[name] || [], STASH_KINDS[name] || null), ctx.roll("arsgunpick"));
  if (!key) return;
  const src = ctx.source || "gunsafe";
  const gun = lootItem(key, src, ctx.roll("arsgunq"));
  out.gear.push(gun, ...gunMags(gun, src, "stash", name, ctx.roll("arsgunmags")));
}
