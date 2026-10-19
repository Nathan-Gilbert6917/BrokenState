// Survival gear (data-survival.js): where it turns up. Its own tables and dice, rolled after everything else a search
// hour, a raid container or a trader's table rolls (loot.js rollAnyModFind, rollAreaMod, gunmodWares: only when those
// found nothing, and a trader's table on top), so every find from before them comes out as it did.
//   SURV_FINDS  a site's search hour (by site type)
//   AREA_SURV   a raid container (by area type)
//   WARE_SURV   a trader's or a merchant's table (by group type)
// AI parity: a group's scavengers find it too (arsenal.js scavFinds: scavSurv, the same site table on their dice).
import { hash01 } from "./skills.js";
import { lootItem } from "./inventory.js";
import { siteSource, areaSource, traderSource } from "./itemcond.js";
import { SURV_FINDS, AREA_SURV, WARE_SURV } from "./data-survival.js";
export { SURV_FINDS, AREA_SURV, WARE_SURV };

function pick(items, u) {
  let total = 0;
  for (const w of Object.values(items)) total += w;
  let r = u * total;
  for (const [k, w] of Object.entries(items)) { r -= w; if (r < 0) return k; }
  return Object.keys(items).pop() || null;
}
// One search hour's roll at a site (loot.js rollAnyModFind, last).
export function rollSurvFind(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = t && t.loc ? SURV_FINDS[t.loc.type] : null;
  if (!site) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "survfind", tileId, state.hour, salt) >= site.p * loot * mult) return null;
  const key = pick(site.items, hash01(state.seed, "survpick", tileId, state.hour, salt));
  return key ? lootItem(key, siteSource(t.loc.type), hash01(state.seed, "survdur", tileId, state.hour, salt)) : null;
}
// One raid container's roll (loot.js rollAreaMod, last).
export function rollAreaSurv(state, tileId, areaType, salt = "") {
  const a = AREA_SURV[areaType];
  if (!a || hash01(state.seed, "areasurv", tileId, salt) >= a.p) return null;
  const key = pick(a.items, hash01(state.seed, "areasurvpick", tileId, salt));
  const t = state.tiles[tileId];
  return key ? lootItem(key, areaSource(areaType, t && t.loc ? t.loc.type : null), hash01(state.seed, "areasurvdur", tileId, salt)) : null;
}
// A trader's or merchant's table (loot.js gunmodWares).
export function survWares(state, type, name, salt = "") {
  const w = WARE_SURV[type];
  if (!w || hash01(state.seed, "survware", name, salt) >= w.p) return [];
  const key = pick(w.items, hash01(state.seed, "survwarepick", name, salt));
  return key ? [lootItem(key, traderSource(type), hash01(state.seed, "survwareq", name, salt))] : [];
}
// A group's scavengers at a site (arsenal.js scavFinds): the same table, SURV_SCAV × its chance a scavenging trip that
// took anything (tag: their hashed dice). Returns a key or null.
export const SURV_SCAV = 3;
export function scavSurv(siteType, tag) {
  const site = SURV_FINDS[siteType];
  if (!site || hash01(...tag, "surv") >= Math.min(1, site.p * SURV_SCAV)) return null;
  return pick(site.items, hash01(...tag, "survpick"));
}
