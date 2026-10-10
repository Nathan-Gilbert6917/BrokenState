// @ts-check
// The parts catalogue's own finds (2026-10-10, user: "attachments that you would find in Tarkov and that would be
// common in the US, and Chinese products that are less valuable and less stats than American / European brands"): the
// new parts (data-gunmods.js PART_INFO) and the budget magazines (BUDGET_MAGS) turn up where their tags meet the
// place's (loot.js SITE_TAGS for a search hour, AREA_TAGS for a raid container, PART_FINDS.WARE_TAGS for a group's
// table), weighted by their rarity (PART_FINDS.FIND_W): the cheap Chinese clones in homes, malls, town pawn shelves and
// cheap traders, the brand-name parts at gun stores, police stations and the military. Every roll is on its own dice
// (rolled last in loot.js's chains), so nothing else found changes. The gun-loot branch can draw the same parts by
// gunmods.js partClass (tier, rarity, tags).
import { hash01 } from "./skills.js";
import { lootItem } from "./inventory.js";
import { siteSource, areaSource, traderSource } from "./itemcond.js";
import { GEAR } from "./data.js";
import { PART_INFO, BUDGET_MAGS, PART_FINDS } from "./data-gunmods.js";
import { SITE_TAGS, AREA_TAGS, ITEM_TAGS } from "./loot.js"; // (call time only: loot.js imports this module)

// The parts the catalogue rolls for.
export const CATALOG_KEYS = [...Object.keys(PART_INFO), ...Object.keys(BUDGET_MAGS)];
const rarityOf = (k) => (PART_INFO[k] || BUDGET_MAGS[k]).rarity;
// The parts a place with these tags keeps, with their weights: { key: weight } (empty: none).
export function partPool(tags) {
  /** @type {Record<string, number>} */
  const out = {};
  if (!tags || !tags.length) return out;
  for (const k of CATALOG_KEYS) {
    if (!GEAR[k] || !(ITEM_TAGS[k] || []).some((t) => tags.includes(t))) continue;
    const w = PART_FINDS.FIND_W[rarityOf(k)] ?? 0;
    if (w > 0) out[k] = w;
  }
  return out;
}
function pick(pool, u) {
  const keys = Object.keys(pool);
  const total = keys.reduce((s, k) => s + pool[k], 0);
  if (!(total > 0)) return null;
  let x = u * total;
  for (const k of keys) { x -= pool[k]; if (x < 0) return k; }
  return keys[keys.length - 1];
}
// A search hour at a site (loot.js rollAnyModFind, last).
export function rollPartFind(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const type = t && t.loc ? t.loc.type : null;
  const p = type ? PART_FINDS.site[type] : 0;
  if (!p) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "catfind", tileId, state.hour, salt) >= p * loot * mult) return null;
  const key = pick(partPool(SITE_TAGS[type]), hash01(state.seed, "catpick", tileId, state.hour, salt));
  return key ? lootItem(key, siteSource(type), hash01(state.seed, "catdur", tileId, state.hour, salt)) : null;
}
// One raid container (loot.js rollAreaMod, last).
export function rollAreaPart(state, tileId, areaType, salt = "") {
  const p = PART_FINDS.area[areaType];
  if (!p || hash01(state.seed, "areacat", tileId, salt) >= p) return null;
  const key = pick(partPool(AREA_TAGS[areaType]), hash01(state.seed, "areacatpick", tileId, salt));
  const t = state.tiles[tileId];
  return key ? lootItem(key, areaSource(areaType, t && t.loc ? t.loc.type : null), hash01(state.seed, "areacatdur", tileId, salt)) : null;
}
// A trader's or merchant's table (loot.js gunmodWares).
export function partWares(state, type, name, salt = "") {
  const p = PART_FINDS.wares[type];
  if (!p || hash01(state.seed, "catware", name, salt) >= p) return [];
  const key = pick(partPool(PART_FINDS.WARE_TAGS[type]), hash01(state.seed, "catwarepick", name, salt));
  return key ? [lootItem(key, traderSource(type), hash01(state.seed, "catwareq", name, salt))] : [];
}
