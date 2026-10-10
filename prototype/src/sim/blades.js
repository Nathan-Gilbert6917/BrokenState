// Knives and swords (data-blades.js): where they turn up. Their own tables and dice, rolled after everything else a
// search hour, a raid container or a trader's table rolls (loot.js rollAnyModFind, rollAreaMod, gunmodWares: only when
// those found nothing, and a trader's table on top), so every find from before them comes out as it did.
//   BLADE_FINDS  a site's search hour (by site type): homes and shops the everyday knives, hunting stores and lodges the
//                good fixed blades, army sites the bayonets, prisons the shivs; a sword now and then in a town, a city,
//                a mall or a church (a collector's house, a pawn shop, a war memorial).
//   AREA_BLADES  a raid container (by area type): kitchens, houses, cells, gun counters, barracks...
//   WARE_BLADES  a trader's or a merchant's table (by group type).
// AI parity: a group's scavengers find them too (arsenal.js scavFinds: scavBlade, the same site table on their dice).
import { hash01 } from "./skills.js";
import { lootItem } from "./inventory.js";
import { siteSource, areaSource, traderSource } from "./itemcond.js";

export const BLADE_FINDS = {
  town: { p: 0.05, items: { pocketknife: 3, flipknife: 1.5, lockback: 1.5, multitool: 1, boxcutter: 1, balisong: 0.6, steakknife: 2, cleaver: 0.8, bowie: 0.4, cutlass: 0.08, sabre: 0.06 } },
  city: { p: 0.05, items: { pocketknife: 2, flipknife: 2, balisong: 1, boxcutter: 1.5, multitool: 1, steakknife: 1.5, cleaver: 0.6, shiv: 0.3, cutlass: 0.05, sabre: 0.05, broadsword: 0.05 } },
  apartments: { p: 0.05, items: { steakknife: 3, pocketknife: 2, cleaver: 1, flipknife: 0.8, boxcutter: 0.6, multitool: 0.6 } },
  mall: { p: 0.06, items: { multitool: 2, lockback: 1.5, survivalknife: 1.5, balisong: 1, pocketknife: 1.5, steakknife: 1, broadsword: 0.3 } },
  supermarket: { p: 0.04, items: { steakknife: 2, filletknife: 1, cleaver: 1, boxcutter: 2, pocketknife: 0.5 } },
  grocery: { p: 0.04, items: { steakknife: 2, filletknife: 1, cleaver: 1, boxcutter: 2 } },
  diner: { p: 0.05, items: { steakknife: 3, cleaver: 2, filletknife: 1 } },
  hardware: { p: 0.05, items: { multitool: 2, boxcutter: 3, lockback: 1, pocketknife: 1 } },
  gunstore: { p: 0.07, items: { huntknife: 2, bowie: 1.5, survivalknife: 1, lockback: 1, bayonet: 0.6 } },
  police: { p: 0.03, items: { flipknife: 1.5, balisong: 1, shiv: 0.3 } }, // the evidence lockers
  prison: { p: 0.05, items: { shiv: 3, flipknife: 0.5 } },
  military: { p: 0.05, items: { bayonet: 2, survivalknife: 1 } },
  crash_mil: { p: 0.03, items: { bayonet: 1, survivalknife: 0.5 } },
  convoy: { p: 0.03, items: { bayonet: 1, survivalknife: 0.5 } },
  cabin: { p: 0.05, items: { huntknife: 2, lockback: 1.5, filletknife: 1, pocketknife: 1, bowie: 0.5, multitool: 0.5 } },
  lodge: { p: 0.06, items: { huntknife: 2, bowie: 1, filletknife: 1.5, lockback: 1, survivalknife: 0.6 } },
  campground: { p: 0.04, items: { pocketknife: 2, multitool: 1.5, lockback: 1, survivalknife: 1, filletknife: 0.6 } },
  ranger: { p: 0.03, items: { survivalknife: 1, multitool: 1, lockback: 1 } },
  farm: { p: 0.03, items: { pocketknife: 2, huntknife: 1, bowie: 0.5, multitool: 1 } },
  ranch: { p: 0.04, items: { pocketknife: 2, huntknife: 1, bowie: 0.6, multitool: 1 } },
  truckstop: { p: 0.04, items: { pocketknife: 2, flipknife: 0.6, multitool: 1, lockback: 1 } },
  motel: { p: 0.03, items: { pocketknife: 1, flipknife: 1, balisong: 0.5 } },
  warehouse: { p: 0.03, items: { boxcutter: 3, multitool: 1 } },
  factory: { p: 0.03, items: { boxcutter: 3, multitool: 1 } },
  church: { p: 0.02, items: { sabre: 0.4, steakknife: 1, pocketknife: 0.6 } },
  office: { p: 0.02, items: { boxcutter: 2 } },
};
export const AREA_BLADES = {
  house: { p: 0.04, items: { steakknife: 2, pocketknife: 1.5, cleaver: 0.6, multitool: 0.6, flipknife: 0.4, balisong: 0.2, sabre: 0.03, cutlass: 0.03, broadsword: 0.02 } },
  farmhouse: { p: 0.04, items: { pocketknife: 2, huntknife: 1, steakknife: 1, bowie: 0.4, cleaver: 0.5 } },
  kitchen: { p: 0.08, items: { steakknife: 3, cleaver: 2, filletknife: 1 } },
  store: { p: 0.03, items: { pocketknife: 1, boxcutter: 2, multitool: 1, lockback: 0.5 } },
  garage: { p: 0.03, items: { multitool: 1.5, boxcutter: 1.5, pocketknife: 1 } },
  workshop: { p: 0.03, items: { boxcutter: 2, multitool: 1 } },
  warehouse: { p: 0.03, items: { boxcutter: 3 } },
  armory: { p: 0.04, items: { bayonet: 1, huntknife: 0.5 } },
  barracks: { p: 0.05, items: { bayonet: 2, survivalknife: 1 } },
  cellblock: { p: 0.07, items: { shiv: 3, flipknife: 0.4 } },
  cabin: { p: 0.05, items: { huntknife: 1.5, lockback: 1, filletknife: 1, bowie: 0.4 } },
  campsite: { p: 0.04, items: { pocketknife: 1.5, multitool: 1, lockback: 1, survivalknife: 0.6 } },
  gunshop: { p: 0.06, items: { huntknife: 2, bowie: 1, bayonet: 0.5, survivalknife: 1 } },
  roadcars: { p: 0.04, items: { pocketknife: 2, multitool: 1, flipknife: 0.3, lockback: 0.6 } },
  milwreck: { p: 0.03, items: { bayonet: 1, survivalknife: 0.6 } },
  office: { p: 0.02, items: { boxcutter: 2 } },
  chapel: { p: 0.015, items: { sabre: 1 } },
};
export const WARE_BLADES = {
  traders: { p: 0.3, items: { pocketknife: 1, lockback: 1, huntknife: 1, multitool: 1, cleaver: 0.5, bowie: 0.5, cutlass: 0.1, sabre: 0.1 } },
  military: { p: 0.25, items: { bayonet: 2, survivalknife: 1 } },
  raider: { p: 0.25, items: { flipknife: 1, balisong: 1, bowie: 1, cutlass: 0.3, shiv: 0.5 } },
  expansionist: { p: 0.15, items: { huntknife: 1, bowie: 0.6, survivalknife: 1 } },
  fortress: { p: 0.15, items: { huntknife: 1, cleaver: 1, multitool: 1 } },
  zealot: { p: 0.2, items: { cutlass: 1, bowie: 1, broadsword: 0.3 } },
  commune: { p: 0.15, items: { steakknife: 1, filletknife: 1, pocketknife: 1 } },
  merchants: { p: 0.3, items: { sabre: 0.5, broadsword: 0.3, cutlass: 0.5, bowie: 1, survivalknife: 1, balisong: 0.5 } },
};

function pick(items, u) {
  let total = 0;
  for (const w of Object.values(items)) total += w;
  let r = u * total;
  for (const [k, w] of Object.entries(items)) { r -= w; if (r < 0) return k; }
  return Object.keys(items).pop() || null;
}
// One search hour's roll at a site (loot.js rollAnyModFind, last).
export function rollBladeFind(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = t && t.loc ? BLADE_FINDS[t.loc.type] : null;
  if (!site) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "bladefind", tileId, state.hour, salt) >= site.p * loot * mult) return null;
  const key = pick(site.items, hash01(state.seed, "bladepick", tileId, state.hour, salt));
  return key ? lootItem(key, siteSource(t.loc.type), hash01(state.seed, "bladedur", tileId, state.hour, salt)) : null;
}
// One raid container's roll (loot.js rollAreaMod, last).
export function rollAreaBlade(state, tileId, areaType, salt = "") {
  const a = AREA_BLADES[areaType];
  if (!a || hash01(state.seed, "areablade", tileId, salt) >= a.p) return null;
  const key = pick(a.items, hash01(state.seed, "areabladepick", tileId, salt));
  const t = state.tiles[tileId];
  return key ? lootItem(key, areaSource(areaType, t && t.loc ? t.loc.type : null), hash01(state.seed, "areabladedur", tileId, salt)) : null;
}
// A trader's or merchant's table (loot.js gunmodWares).
export function bladeWares(state, type, name, salt = "") {
  const w = WARE_BLADES[type];
  if (!w || hash01(state.seed, "bladeware", name, salt) >= w.p) return [];
  const key = pick(w.items, hash01(state.seed, "bladewarepick", name, salt));
  return key ? [lootItem(key, traderSource(type), hash01(state.seed, "bladewareq", name, salt))] : [];
}
// A group's scavengers at a site (arsenal.js scavFinds): the same table, SCAV × its chance a scavenging trip that took
// anything (tag: their hashed dice). Returns a key or null.
export const BLADE_SCAV = 3;
export function scavBlade(siteType, tag) {
  const site = BLADE_FINDS[siteType];
  if (!site || hash01(...tag, "blade") >= Math.min(1, site.p * BLADE_SCAV)) return null;
  return pick(site.items, hash01(...tag, "bladepick"));
}
