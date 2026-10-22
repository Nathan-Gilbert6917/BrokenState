// @ts-check
// The shelves of a gun store or a pawn shop that is a point of interest (shops.js): every site table here rolls by
// the tile's site type (tile.loc.type), so a shop POI beside another site, or on a bare suburb or city block, would
// find none of its own rigs, magazines and survival gear. This roll gives it its own kind's tables (carrykit.js
// SITE_KIT, data-survival.js SURV_FINDS, loot.js SITE_FINDS / SITE_MODS / GUNMOD_FINDS / HUNT_FINDS / LIGHT_FINDS /
// CART_FINDS, blades.js BLADE_FINDS, helmets.js HEAD_FINDS), a hardware store's building materials and wood
// (rollShopSupplies: BUILDMAT_FINDS, SITE_WOOD) and an extra gun by its draws (data-guns.js ARSENAL_FINDS, gundist.js), each on dice of its own (skills.js hash01), × what
// is left of the place. Called from scavenge.js searchHour; the shop that is the tile's own site rolls nothing here.
/** @import { State } from "./types" */
import { GEAR } from "./data.js";
import { hash01 } from "./skills.js";
import { lootItem } from "./inventory.js";
import { siteSource } from "./itemcond.js";
import { SITE_KIT, gunMags } from "./carrykit.js";
import { SURV_FINDS } from "./data-survival.js";
import { TOOL_FINDS } from "./data-tools.js"; // tools for building and crafting: a hardware store's aisles most of all
import { SITE_FINDS, SITE_MODS, GUNMOD_FINDS, HUNT_FINDS, LIGHT_FINDS, CART_FINDS, BUILDMAT_FINDS, SITE_WOOD } from "./loot.js";
import { HEAD_FINDS } from "./helmets.js";
import { BLADE_FINDS } from "./blades.js";
import { ARSENAL_FINDS } from "./data-guns.js";
import { drawGun } from "./gundist.js";
import { foundFill } from "./gunrounds.js";
import { isShopKind } from "./shops.js";

/** @param {Record<string, number>} items @param {number} r */
function pickW(items, r) {
  const keys = Object.keys(items).filter((k) => GEAR[k]).sort();
  const tot = keys.reduce((a, k) => a + items[k], 0);
  let x = r * tot;
  for (const k of keys) { x -= items[k]; if (x < 0) return k; }
  return keys[keys.length - 1] || null;
}
/**
 * This search hour's finds on a shop POI's shelves: [] unless the place searched is a gun store or a pawn shop that is
 * not the tile's own site. left: what is left of it (0–1); mult: Treasure Hunter, the pace.
 * @param {State} state @param {number} tileId @param {string} kind @param {number} left @param {number} [mult] @param {string} [salt]
 * @returns {any[]}
 */
export function rollShopShelves(state, tileId, kind, left, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  if (!isShopKind(kind) || !t || (t.loc && t.loc.type === kind)) return [];
  const L = Math.max(0.1, Math.min(1, left ?? 1));
  const src = siteSource(kind);
  /** @type {any[]} */
  const out = [];
  /** @type {[string, Record<string, { p: number, items: Record<string, number> }>][]} */
  const rows = [["kit", SITE_KIT], ["surv", SURV_FINDS], ["find", SITE_FINDS], ["mod", SITE_MODS], ["gunmod", GUNMOD_FINDS], ["blade", BLADE_FINDS],
    ["hunt", HUNT_FINDS], ["light", LIGHT_FINDS], ["cart", CART_FINDS], ["head", HEAD_FINDS], ["tool", TOOL_FINDS]]; // tools last: the rows before roll as they did
  for (const [name, table] of rows) {
    const tab = table[kind];
    if (!tab || hash01(state.seed, `shop${name}`, tileId, state.hour, salt) >= tab.p * L * mult) continue;
    const key = pickW(tab.items, hash01(state.seed, `shop${name}pick`, tileId, state.hour, salt));
    if (key) out.push(lootItem(key, src, hash01(state.seed, `shop${name}dur`, tileId, state.hour, salt)));
  }
  // An extra gun (as gunfinds.js rollSiteGuns, by the shop's draws), with its few rounds and its spare magazines.
  const p = ARSENAL_FINDS.site[kind] || 0;
  if (p && hash01(state.seed, "shopgun", tileId, state.hour, salt) < p * L * mult) {
    const key = drawGun(`site:${kind}`, hash01(state.seed, "shopgunpick", tileId, state.hour, salt), { fresh: true });
    if (key) {
      const tag = [state.seed, "shopg", tileId, state.hour, salt];
      const gun = lootItem(key, src, [...tag, "q"]);
      foundFill(gun, ...tag);
      out.push(gun, ...gunMags(gun, src, ...tag));
    }
  }
  return out;
}
/**
 * This search hour's building materials and wood on a shop POI's shelves (a hardware store's lumber, blocks and fixings:
 * loot.js BUILDMAT_FINDS, SITE_WOOD by its kind), as rollBuildmat and rollSiteWood roll them for a site; {} unless the
 * place is a shop POI that is not the tile's own site.
 * @param {State} state @param {number} tileId @param {string} kind @param {number} left @param {number} [mult] @param {string} [salt]
 * @returns {Record<string, number>}
 */
export function rollShopSupplies(state, tileId, kind, left, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  if (!isShopKind(kind) || !t || (t.loc && t.loc.type === kind)) return {};
  const L = Math.max(0.1, Math.min(1, left ?? 1));
  /** @type {Record<string, number>} */
  const out = {};
  for (const [key, row] of [["buildmat", BUILDMAT_FINDS[kind]], ["wood", SITE_WOOD[kind]]]) {
    if (!row || hash01(state.seed, `shop${key}`, tileId, state.hour, salt) >= row[0] * L * mult) continue;
    out[key] = row[1] + Math.floor(hash01(state.seed, `shop${key}qty`, tileId, state.hour, salt) * (row[2] - row[1] + 1));
  }
  return out;
}

