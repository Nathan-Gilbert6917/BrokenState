// @ts-check
// Carry kit around the game (docs/weapons-overhaul-plan.md sections 15–17 and the weight half of 18's addendum; the
// user's decisions R16 rigs now, R17 heavy kit slows everyone, enemies too):
// - Weight in battle: a fighter's mob by the kg they wear and carry (BATTLE_BANDS: the load bands of load.js), your
//   people's felt kg (an assault pack's frame, a bad back), everyone else's by their kit (kitKg). u.armLoad is that kg
//   (combat.js escapeOdds: the escape check's load penalty).
// - Enemies (kitEnemy): soldiers wear a chest rig or the carrier's pouches, police a tactical vest, raiders now and then
//   a makeshift rig; their spare magazines (mags.js enemyMags) and their rig drop with the body (inventory.js enemyBody:
//   bodyKit). A group's own fighters (arsenal.js armFromArsenal: armKit) carry the group's own rig and magazines.
// - Out of a fight: packing magazines onto a team (packMags: from the armory into rig pouches, pockets, then the pack;
//   rifle guns 4, pistols 3), a colonist's starting spares (starterMags), loot (gunMags: 0–2 standard magazines with a
//   found gun; rollSiteKit / rollAreaKit / kitWares: magazines, rigs, plates by place, their own dice), the autopilot's
//   kit (equipKit: the best rig and carrier, plates in the carrier, magazines into pouches; spare plates kept),
//   and old saves (migrateKit: carriers get their plates, guns their spare magazines).
import { GEAR } from "./data.js";
import { MAGAZINES, CLIPS, KIT_LOOT } from "./data-kit.js";
import { WEAPONS, KITS } from "./combat.js";
import { hash01 } from "./skills.js";
import { lootItem, newItem, stow, ensureInv, rigOf, rigPouches, pouchesOf, pouchReason, isCarrier, insertsOf, INSERT_SIDES, itemLoad, itemKg, allItems, storageFor, personPlace, carriedSpots, ensureRig, migrateCarrier, packOf } from "./inventory.js";
import { fittedKg, gunMods } from "./gunmods.js";
import { calOf, roundsOf } from "./ammo.js";
import { CALIBERS } from "./data-ammo.js";
import { typeFor } from "./rounds.js";
import { standardMag, magFitsGun, isMag, enemyMags, enemyMagCount, magLoad, takesMagItems, usesInternal } from "./mags.js";
import { feelFactor, bandIndex, LOAD_BANDS } from "./load.js";
import { kitSource, siteSource, areaSource, traderSource } from "./itemcond.js";
import { armourSpec, armourBroken } from "./armour.js";
import { itemDur, itemDurMax } from "./crafting.js";

export const CARRY = {
  // Battle mob by kg (light / medium / heavy / overloaded: load.js LOAD_BANDS' limits): Medium keeps 5 tiles an action
  // but a dash (both actions) loses a tile.
  BANDS: [{ mob: 5, dash: 0 }, { mob: 5, dash: -1 }, { mob: 4, dash: 0 }, { mob: 3, dash: 0 }],
  // What an enemy carries besides the kit it fights with (water, food, a ruck, odds and ends), kg by kit.
  BASE_KG: { soldiers: 12, escorts: 6, contractors: 8, guards: 4, raiders: 3, fighters: 4, militia: 4, zealots: 2, survivors: 3 },
  THROW_KG: 0.45, MEDKIT_KG: 0.5,
  // Enemy rigs by kit: [chance, rig key] (a carrier or a tactical vest already has pouches).
  RIG: { soldiers: [0.85, "chestrig"], escorts: [0.25, "chestrig"], contractors: [0.5, "chestrig"], raiders: [0.3, "makeshiftrig"], fighters: [0.15, "makeshiftrig"], militia: [0.15, "makeshiftrig"] },
  TACVEST: { guards: 0.5, contractors: 0.3 }, // police and SWAT: a tactical vest instead of a plain vest
  // Packing magazines for a trip (packMags): spares a gun.
  PACK: { rifle: 4, pistol: 3 },
  START: 2, // a colonist's starting gun comes with this many spare magazines
  GUN_MAGS: [0.35, 0.45, 0.2], // a found gun: 0, 1 or 2 spare magazines (its standard one)
  SPARE_PLATES: 2, // the governor keeps this many spare plates at a base with a carrier in use
};
const num = (v) => (Number.isFinite(v) ? v : 0);
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- weight and the battle bands ----------
// What loaded magazines add (the rounds in them: kept in the pools' weight otherwise; load.js moves it onto the
// person). Spares full of their load, the gun's own too.
export function magRoundsKg(s) {
  let kg = 0;
  for (const x of carriedSpots(s)) if (isMag(x.item)) kg += MAGAZINES[x.item.key].cap * (CALIBERS[MAGAZINES[x.item.key].cal] ? CALIBERS[MAGAZINES[x.item.key].cal].kg : 0);
  const gun = s && s.gear && s.gear.weapon;
  const w = gun && WEAPONS[gun.key], cal = gun ? calOf(gun.key) : null;
  if (w && cal && w.cap > 0) kg += w.cap * CALIBERS[cal].kg;
  return kg;
}
// Kg a person takes into a fight: everything worn and carried (inventory.js itemLoad: a rig's pouches, a carrier's
// plates, a gun's parts) and the rounds in their magazines.
export const battleKg = (s) => (s ? allItems(s).reduce((a, it) => a + itemLoad(it), 0) + magRoundsKg(s) : 0);
// The band for a kg (felt): { band, mob, dash }.
export function bandFor(kg) {
  const i = bandIndex(kg);
  return { band: i, name: LOAD_BANDS[i].name, ...CARRY.BANDS[i] };
}
// combat.js playerUnit: the unit's kg (u.armLoad), mob and dash by its felt load.
export function weighPlayer(u, s) {
  const kg = battleKg(s);
  const B = bandFor(kg * feelFactor(s));
  u.armLoad = r2(kg);
  u.mob = B.mob;
  u.dash = B.dash;
  u.loadBand = B.band;
}
// An enemy's kg: its gun and parts, armour (a carrier's plates), rig, magazines with their rounds, throwables, a medic's
// kit, and what its kind carries besides (BASE_KG).
export function kitKg(u, kind) {
  let kg = num(CARRY.BASE_KG[kind]);
  const w = u.arsItem || (GEAR[u.weapon] ? { key: u.weapon, mods: u.modItems || null } : null);
  if (w && GEAR[w.key]) kg += num(GEAR[w.key].weight) + Object.values(w.mods || {}).reduce((a, m) => a + (m ? fittedKg(m) : 0), 0);
  const torso = (u.arsArmour || []).find((it) => it && GEAR[it.key] && GEAR[it.key].slot === "armor");
  if (torso) kg += itemLoad(torso);
  else if (u.armorKey && GEAR[u.armorKey]) kg += num(GEAR[u.armorKey].weight) + (GEAR[u.armorKey].inserts ? 2 * num(GEAR.ceramicplate.weight) : 0);
  for (const it of u.arsArmour || []) if (it && it !== torso && GEAR[it.key]) kg += itemLoad(it);
  if (u.rigKey && GEAR[u.rigKey]) kg += num(GEAR[u.rigKey].weight);
  const cal = calOf(u.weapon);
  for (const m of u.mags || []) { if (m.key && MAGAZINES[m.key] && m.where !== "gun") kg += MAGAZINES[m.key].kg; if (cal) kg += num(m.cap) * CALIBERS[cal].kg; }
  for (const n of Object.values(u.throwables || {})) kg += num(n) * CARRY.THROW_KG;
  if (u.medKit) kg += CARRY.MEDKIT_KG;
  return r2(kg);
}
export function weighEnemy(u, kind) {
  const kg = kitKg(u, kind);
  const B = bandFor(kg);
  u.armLoad = kg;
  u.mob = B.mob;
  u.dash = B.dash;
  u.loadBand = B.band;
}

// ---------- enemies' kit ----------
// combat.js enemyUnit (after its gun, armour and throwables): a rig by kit (own dice), spare magazines, the weight.
export function kitEnemy(b, u, kind, seed) {
  if (!u || u.kind !== "human") return;
  const h = (...k) => hash01("enemykit", seed, u.id, kind, ...k);
  if (CARRY.TACVEST[kind] && u.armorKey === "vest" && h("tacvest") < CARRY.TACVEST[kind]) { u.armorKey = "tacvest"; u.pieces = undefined; } // armour.js enemyPieces fits it again
  const pouched = !!(u.armorKey && GEAR[u.armorKey] && GEAR[u.armorKey].pouches);
  const R = CARRY.RIG[kind];
  u.rigKey = !pouched && R && h("rig") < R[0] ? R[1] : null;
  const hasRig = pouched || !!u.rigKey;
  enemyMags(u, staticCap(u), enemyMagCount(kind, seed, u.id), hasRig);
  weighEnemy(u, kind);
}
// A group's fighter (arsenal.js armFromArsenal): the group's own rig and magazines for its gun, from what nobody else
// on this map carries. take(pred) → an item of theirs or null (marks it used).
export function armKit(u, kind, take) {
  if (!u || u.kind !== "human") return;
  const torso = (u.arsArmour || []).find((it) => it && GEAR[it.key] && GEAR[it.key].slot === "armor");
  const pouched = !!(torso && pouchesOf(torso));
  const rig = pouched ? null : take((it) => GEAR[it.key] && GEAR[it.key].slot === "rig");
  u.arsRig = rig || null;
  u.rigKey = rig ? rig.key : null;
  const want = enemyMagCount(kind, u.id, u.arsFid);
  const mags = [];
  if (WEAPONS[u.weapon] && takesMagItems(u.weapon)) for (let i = 0; i < want; i++) { const m = take((it) => isMag(it) && magFitsGun(u.weapon, it.key)); if (!m) break; mags.push(m); }
  u.arsMags = mags;
  enemyMags(u, staticCap(u), 0, pouched || !!rig, mags);
  weighEnemy(u, kind);
}
// Carry kit an AI group keeps in its arsenal (arsenal.js addToArsenal; not counted in its fighting worth).
export const kitWorthy = (it) => !!(it && GEAR[it.key] && (GEAR[it.key].slot === "rig" || GEAR[it.key].slot === "insert" || GEAR[it.key].mag || CLIPS[it.key]));
// A group's starting carry kit (arsenal.js seedArsenal, own dice): spare magazines for its guns (SEED_MAGS a gun by
// kit), rigs for a share of its people (RIG chances; soldiers also for those in a plain vest), a spare plate for every
// four carriers. items: the starting arsenal (its guns and armour).
export const SEED_MAGS = { soldiers: 4, guards: 3, escorts: 3, contractors: 3, default: 2 };
export function seedKit(seed, salt, kind, items) {
  const out = [];
  const src = kitSource(kind);
  const h = (...k) => hash01(seed, "arskit", salt, ...k);
  const per = SEED_MAGS[kind] ?? SEED_MAGS.default;
  items.forEach((it, i) => {
    const key = it && WEAPONS[it.key] ? standardMag(it.key) : null;
    if (!key || usesInternal(it.key, it)) return;
    for (let j = 0; j < per; j++) out.push(lootItem(key, src, [seed, "arsm", salt, i, j]));
  });
  const R = CARRY.RIG[kind];
  const guns = items.filter((it) => it && WEAPONS[it.key] && WEAPONS[it.key].ammo > 0).length;
  const plain = items.filter((it) => it && GEAR[it.key] && GEAR[it.key].slot === "armor" && !GEAR[it.key].pouches).length;
  const rigs = R ? Math.round((kind === "soldiers" ? Math.max(plain, guns * 0.5) : guns) * R[0]) : 0;
  for (let i = 0; i < rigs; i++) out.push(lootItem(R[1], src, [seed, "arsr", salt, i]));
  const carriers = items.filter((it) => isCarrier(it)).length;
  for (let i = 0; i < Math.floor(carriers / 4); i++) out.push(lootItem(h("plate", i) < 0.8 ? "ceramicplate" : "steelplate", src, [seed, "arsp", salt, i]));
  return out;
}
const staticCap = (u) => {
  const w = WEAPONS[u.weapon];
  if (!w || !(w.cap > 0)) return 0;
  const gun = u.arsItem || (u.modItems ? { key: u.weapon, mods: u.modItems } : { key: u.weapon });
  const m = gunMods(gun);
  const fit = gun.mods && gun.mods.mag && MAGAZINES[gun.mods.mag.key] ? MAGAZINES[gun.mods.mag.key].cap : null;
  return Math.max(1, Math.round((fit || w.cap) * (m.capMult ?? 1)) + (m.cap || 0));
};
// The enemy's carried kit onto its body (inventory.js enemyBody): its rig (a group's own, else a found one by its
// kit's condition) and its spare magazines, loaded with its type, into the rig's pouches first. src: itemcond.js source.
export function bodyKit(body, u, src) {
  if (!u || u.kind !== "human" || !KIT_LOOT.on) return;
  if (u.arsRig) body.gear.rig = u.arsRig;
  else if (u.rigKey && GEAR[u.rigKey] && !body.gear.rig && !(body.gear.armor && pouchesOf(body.gear.armor))) body.gear.rig = lootItem(u.rigKey, src, [u.id, "rig"]);
  if (body.gear.rig) ensureRig(body.gear.rig);
  for (const it of unitMagItems(u, src)) stow(body, it, "");
}
// A unit's spare magazines as items (a body's loot): a group's own, else new ones of its kit's condition, loaded with
// what they held (own dice).
export function unitMagItems(u, src) {
  if (!u || u.kind !== "human" || !KIT_LOOT.on) return [];
  if (u.arsMags && u.arsMags.length) return u.arsMags.slice();
  const cal = calOf(u.weapon);
  return (u.mags || []).filter((m) => m.where !== "gun" && m.key && MAGAZINES[m.key]).map((m, i) => {
    const it = lootItem(m.key, src, [u.id, "mag", i]);
    if (cal && m.load && m.load !== typeFor(cal, null)) it.load = m.load;
    return it;
  });
}

// ---------- packing, starting kit ----------
// Moves spare magazines for each person's gun from a list (a base's armory) onto them: into rig pouches, then pockets,
// then the pack, up to PACK (rifle 4, pistol 3) less what they carry already; loaded with the gun's own type. Returns the
// names of what went.
export function packMags(list, crew) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const s of crew) {
    ensureInv(s);
    const gun = s.gear && s.gear.weapon;
    if (!gun || !WEAPONS[gun.key] || !takesMagItems(gun.key) || usesInternal(gun.key, gun)) continue;
    const pistol = (MAGAZINES[standardMag(gun.key)] || {}).pouch === "pistol";
    const want = (pistol ? CARRY.PACK.pistol : CARRY.PACK.rifle) - carriedSpots(s).filter((x) => isMag(x.item) && magFitsGun(gun.key, x.item.key)).length;
    const cands = list.filter((it) => isMag(it) && magFitsGun(gun.key, it.key)).sort((a, b) => MAGAZINES[b.key].cap - MAGAZINES[a.key].cap);
    let n = 0;
    for (const it of cands) {
      if (n >= want) break;
      if (!stow(s, it)) break;
      list.splice(list.indexOf(it), 1);
      if (it.load == null && gun.load) it.load = gun.load;
      n++;
    }
    if (n) out.push(`${n} magazine${n > 1 ? "s" : ""} (${s.name.split(" ")[0]})`);
  }
  return out;
}
// A starting colonist's gun: CARRY.START spare standard magazines (a rig pouch, the pack, a pocket while two stay free
// for other things; else the hub's armory, where packing for a trip finds them).
export function starterMags(s, armory = null) {
  const gun = s && s.gear && s.gear.weapon;
  const key = gun ? standardMag(gun.key) : null;
  if (!key || usesInternal(gun.key, gun)) return 0;
  let n = 0;
  for (let i = 0; i < CARRY.START; i++) {
    const it = newItem(key); // starting gear (not loot): a magazine has no wear
    if (gun.load) it.load = gun.load;
    ensureInv(s);
    const rp = rigPouches(s), kinds = rp ? pouchesOf(rigOf(s)) : [];
    const ri = rp ? kinds.findIndex((k, j) => !rp[j] && !pouchReason(it, k) && k !== "admin") : -1;
    const pk = packOf(s), pi = pk ? pk.indexOf(null) : -1;
    const free = s.pockets.filter((x) => !x).length;
    if (ri >= 0) { rp[ri] = it; n++; }
    else if (pi >= 0) { pk[pi] = it; n++; }
    else if (free > 2) { s.pockets[s.pockets.indexOf(null)] = it; n++; }
    else if (armory) { armory.push(it); n++; }
  }
  return n;
}

// ---------- loot ----------
// A found gun's spare magazines (0–2 of its standard one; own dice): the items to add beside it. salt: anything that
// varies by find.
export function gunMags(gun, source, ...salt) {
  const key = gun && WEAPONS[gun.key] && KIT_LOOT.on ? standardMag(gun.key) : null;
  if (!key || usesInternal(gun.key, gun)) return [];
  const r = hash01("gunmags", gun.key, ...salt);
  const n = r < CARRY.GUN_MAGS[0] ? 0 : r < CARRY.GUN_MAGS[0] + CARRY.GUN_MAGS[1] ? 1 : 2;
  return Array.from({ length: n }, (_, i) => lootItem(key, source, [gun.key, "gm", i, ...salt]));
}
// Spare magazines for the guns in a list of found gear (appended to it). Returns the list.
export function withMags(gear, source, ...salt) {
  if (!Array.isArray(gear)) return gear;
  const guns = gear.filter((it) => it && WEAPONS[it.key] && standardMag(it.key));
  guns.forEach((g, i) => gear.push(...gunMags(g, source, i, ...salt)));
  return gear;
}
// Loose magazines, rigs and plates by place (their own tables and dice; loot.js calls these after its own rolls).
export const SITE_KIT = {
  gunstore: { p: 0.1, items: { mag_glock_15: 3, mag_glock_17: 2, mag_glock_33: 0.5, mag_stanag_30: 2, mag_stanag_20: 1, mag_ak_30: 1, mag_22_10: 2, mag_22_25: 1, mag_1911_7: 1.5, mag_bolt_5: 1, mag_bolt_10: 0.5, mag_ar10_10: 0.5, mag_ak_45: 0.4, mag_glock_8: 1, speedloader: 2, stripper308: 1.5, chestrig: 0.6, steelplate: 0.4 } },
  police: { p: 0.06, items: { mag_glock_15: 3, mag_glock_17: 2, mag_glock_8: 1, mag_stanag_30: 2, mag_mp5_30: 1, speedloader: 1, tacvest: 0.8, softinsert: 1 } },
  military: { p: 0.08, items: { mag_stanag_30: 5, mag_stanag_40: 1, mag_stanag_100: 0.2, mag_m249_100: 0.8, mag_ar10_20: 1, mag_glock_17: 1, mag_mp5_30: 0.5, mag_50_10: 0.2, chestrig: 1.5, ceramicplate: 1.5, softinsert: 0.6 } },
  crash_mil: { p: 0.06, items: { mag_stanag_30: 3, chestrig: 1, ceramicplate: 1 } },
  convoy: { p: 0.05, items: { mag_stanag_30: 3, mag_m249_100: 0.6, chestrig: 1, ceramicplate: 0.8 } },
  prison: { p: 0.03, items: { mag_glock_15: 2, softinsert: 1, tacvest: 0.4 } },
  lodge: { p: 0.03, items: { mag_22_10: 1, mag_bolt_5: 1, mag_bolt_10: 0.4, stripper308: 1 } },
  cabin: { p: 0.02, items: { mag_22_10: 1, stripper308: 1 } },
  town: { p: 0.008, items: { mag_glock_15: 1, mag_22_10: 1 } },
};
export const AREA_KIT = {
  armory: { p: 0.1, items: { mag_glock_15: 2, mag_stanag_30: 2, speedloader: 1, tacvest: 0.5, softinsert: 1, chestrig: 0.5 } },
  gunshop: { p: 0.1, items: { mag_glock_15: 2, mag_glock_17: 1, mag_stanag_30: 1.5, mag_22_10: 1.5, mag_1911_7: 1, speedloader: 1.5, stripper308: 1, steelplate: 0.4 } },
  barracks: { p: 0.08, items: { mag_stanag_30: 3, chestrig: 1, ceramicplate: 0.8, mag_m249_100: 0.3 } },
  milwreck: { p: 0.06, items: { mag_stanag_30: 2, chestrig: 0.6, ceramicplate: 0.6 } },
};
export const WARE_KIT = {
  traders: { p: 0.25, items: { mag_glock_15: 2, mag_stanag_30: 2, mag_22_10: 1, speedloader: 1, makeshiftrig: 1, steelplate: 0.5 } },
  military: { p: 0.3, items: { mag_stanag_30: 3, chestrig: 1.5, ceramicplate: 1.5, softinsert: 1 } },
  raider: { p: 0.15, items: { mag_glock_15: 1, mag_ak_30: 1, mag_ak_45: 0.4, makeshiftrig: 1.5, steelplate: 0.5 } },
  merchants: { p: 0.35, items: { mag_stanag_30: 2, mag_stanag_40: 0.6, mag_ak_30: 1, mag_ak_75: 0.3, mag_glock_17: 1, chestrig: 1, tacvest: 0.6, ceramicplate: 1, steelplate: 1 } },
};
function pickW(items, r) {
  const keys = Object.keys(items).filter((k) => GEAR[k]).sort();
  const tot = keys.reduce((a, k) => a + items[k], 0);
  let x = r * tot;
  for (const k of keys) { x -= items[k]; if (x < 0) return k; }
  return keys[keys.length - 1] || null;
}
export function rollKitTable(tab, gate, pickR, src, roll) {
  if (!tab || gate >= tab.p || !KIT_LOOT.on) return null;
  const key = pickW(tab.items, pickR);
  return key ? lootItem(key, src, roll) : null;
}
// A search hour's find (loot.js rollAnyModFind, after the attachments: only when they found nothing).
export function rollSiteKit(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const tab = t && t.loc ? SITE_KIT[t.loc.type] : null;
  if (!tab) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  return rollKitTable({ ...tab, p: tab.p * loot * mult }, hash01(state.seed, "kitfind", tileId, state.hour, salt), hash01(state.seed, "kitpick", tileId, state.hour, salt), siteSource(t.loc.type), hash01(state.seed, "kitdur", tileId, state.hour, salt));
}
// A raid container's (loot.js rollAreaMod, when it found nothing).
export function rollAreaKit(state, tileId, areaType, salt = "") {
  const t = state.tiles[tileId];
  return rollKitTable(AREA_KIT[areaType], hash01(state.seed, "areakit", tileId, salt), hash01(state.seed, "areakitpick", tileId, salt), areaSource(areaType, t && t.loc ? t.loc.type : null), hash01(state.seed, "areakitdur", tileId, salt));
}
// A trader's table (loot.js modWares, when it had no part).
export function kitWares(state, type, name, salt = "") {
  const it = rollKitTable(WARE_KIT[type], hash01(state.seed, "kitware", name, salt), hash01(state.seed, "kitwarepick", name, salt), traderSource(type), hash01(state.seed, "kitwareq", name, salt));
  return it ? [it] : [];
}

// ---------- the autopilot's kit ----------
// The best rig and carrier from a list (an armory) for each person (the best fighters first), plates into the carrier's
// empty pockets (the best: ceramic, then steel, then soft), and spare magazines for their guns. Returns what moved:
// [{ s, item, was }]. Weight: a rig is light; a carrier's plates only while the person stays out of Overloaded.
export function equipKit(list, people) {
  const out = [];
  if (!Array.isArray(list)) return out;
  const plateScore = (it) => (armourSpec(it.key) ? armourSpec(it.key).ac * 10 : 0) + (itemDur(it) ?? 0) / Math.max(1, itemDurMax(it) ?? 1);
  for (const s of people) {
    ensureInv(s);
    const g = s.gear;
    // A chest rig when the body armour has no pouches (one over a pouched vest goes back, its contents into the vest's).
    if (g.rig && g.armor && pouchesOf(g.armor)) {
      const rig = g.rig, into = ensureRig(g.armor), kinds = pouchesOf(g.armor);
      g.rig = null;
      for (const [i, it] of (rig.contents || []).entries()) {
        if (!it) continue;
        const j = kinds.findIndex((k, n) => !into[n] && !pouchReason(it, k));
        if (j >= 0) { into[j] = it; rig.contents[i] = null; }
      }
      list.push(rig);
    }
    if (!g.rig && !(g.armor && pouchesOf(g.armor))) {
      const rigs = list.filter((it) => GEAR[it.key] && GEAR[it.key].slot === "rig").sort((a, b) => pouchesOf(b).length - pouchesOf(a).length);
      if (rigs.length) { const it = rigs[0]; list.splice(list.indexOf(it), 1); ensureRig(it); g.rig = it; out.push({ s, item: it, was: null }); }
    }
    // Plates into an empty pocket of the worn carrier.
    if (isCarrier(g.armor)) {
      const ins = insertsOf(g.armor);
      for (const side of INSERT_SIDES) {
        if (ins[side] && !armourBroken(ins[side])) continue;
        const plates = list.filter((it) => GEAR[it.key] && GEAR[it.key].slot === "insert" && !armourBroken(it)).sort((a, b) => plateScore(b) - plateScore(a));
        if (!plates.length) break;
        const p = plates[0];
        list.splice(list.indexOf(p), 1);
        if (ins[side]) list.push(ins[side]);
        ins[side] = p;
        out.push({ s, item: p, was: null });
      }
    }
  }
  for (const n of packMags(list, people)) out.push({ s: null, item: { name: n }, was: null });
  return out;
}
// Plates a base keeps: how many spare plates are in its armory and how many it wants (a carrier in use: SPARE_PLATES).
export function plateNeed(people, armory) {
  const carriers = people.filter((s) => s.gear && isCarrier(s.gear.armor)).length + (armory || []).filter((it) => isCarrier(it)).length;
  const have = (armory || []).filter((it) => it && GEAR[it.key] && GEAR[it.key].slot === "insert" && !armourBroken(it)).length;
  return { have, want: carriers ? CARRY.SPARE_PLATES : 0, carriers };
}

// ---------- old saves ----------
// Carriers from before inserts get their plates (inventory.js migrateCarrier), anywhere in the save (people, armories,
// cargo, bodies, wares, death sites, arsenals); your people's guns get their spare magazines once (CARRY.START, as a new
// colonist's: on them, else in their base's armory or the team's cargo). Safe to call any number of times.
export function migrateKit(state) {
  if (state.kitV >= 2) return;
  const seen = new Set();
  const walk = (o) => {
    if (!o || typeof o !== "object" || seen.has(o) || ArrayBuffer.isView(o)) return;
    seen.add(o);
    if (o instanceof Map) { for (const v of o.values()) walk(v); return; }
    if (o instanceof Set || Array.isArray(o)) { for (const v of o) walk(v); return; }
    if (typeof o.key === "string" && GEAR[o.key] && GEAR[o.key].inserts && o.inserts === undefined && o.name) migrateCarrier(o);
    for (const k of Object.keys(o)) { const v = o[k]; if (v && typeof v === "object") walk(v); }
  };
  walk(state);
  state.kitV = 2;
  for (const s of state.survivors || []) {
    if (!s || !s.alive || !s.gear || !s.gear.weapon) continue;
    const gun = s.gear.weapon;
    if (!standardMag(gun.key) || usesInternal(gun.key, gun) || carriedSpots(s).some((x) => isMag(x.item))) continue;
    const st = storageFor(state, personPlace(s));
    starterMags(s, st ? st.list : null);
  }
}

// ---------- the governor's plates (autopilot.js governBase, hourly at a base it runs) ----------
// Plates break and need replacing: a worn carrier's missing, broken or badly worn plate (under PLATE_SWAP of its
// points) is swapped for the best spare in the armory; a worn steel plate in the armory is queued for the workbench
// (repair.js: steel can be patched, ceramic cannot); with fewer spare plates than SPARE_PLATES while carriers are in
// use, a steel plate is crafted (crafting.js steelplate: scrap 8, Mechanics 4, a workshop). Returns the messages.
export const PLATE_SWAP = 0.35;
export function governPlates(state, base, people, repair) {
  const out = [];
  if (!base || !base.armory) return out;
  const cond = (it) => { const m = itemDurMax(it); return m ? (itemDur(it) ?? m) / m : 1; };
  const spareOk = (it) => it && GEAR[it.key] && GEAR[it.key].slot === "insert" && !armourBroken(it) && cond(it) >= PLATE_SWAP;
  const score = (it) => (armourSpec(it.key) ? armourSpec(it.key).ac : 0) * 10 + cond(it) * 5;
  for (const s of people) {
    const c = s.gear && s.gear.armor;
    if (!isCarrier(c)) continue;
    const ins = insertsOf(c);
    for (const side of INSERT_SIDES) {
      const cur = ins[side];
      if (cur && !armourBroken(cur) && cond(cur) >= PLATE_SWAP) continue;
      const best = base.armory.filter(spareOk).sort((a, b) => score(b) - score(a))[0];
      if (!best) continue;
      base.armory.splice(base.armory.indexOf(best), 1);
      if (cur && !armourBroken(cur)) base.armory.push(cur);
      ins[side] = best;
      out.push(`${s.name.split(" ")[0]}'s ${side} plate: ${best.name.toLowerCase()}`);
    }
  }
  if (repair) {
    const i = base.armory.findIndex((it) => it && it.key === "steelplate" && !armourBroken(it) && cond(it) < 0.6);
    if (i >= 0 && (base.gearRepairs || []).length < 2) { const m = repair.queue(state, base, `armory:${base.id}:list:${i}`); if (/queued/.test(m)) out.push(m); }
    const need = plateNeed(people, base.armory);
    if (need.want && need.have < need.want && !(base.crafting || []).some((j) => j.recipe === "steelplate") && (base.stock.scrap || 0) >= 14) { const m = repair.craft(state, base, "steelplate"); if (/queued/.test(m)) out.push(m); }
  }
  return out;
}
