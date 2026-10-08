// Merchant caravans from outside the state: what they carry (by speciality) and the escort that cargo buys them.
// Data and pure helpers only (visitors.js makes the caravans, caravanraids.js fights them).
//
// Speciality (SPECIALITIES, picked by weight when a caravan is made): what fills the wagons. General traders carry
// a bit of everything; gunrunners guns and ammunition; armourers armour and military kit; mechanics fuel, parts and
// tools; medics medicine; provisioners food and water. Every caravan also brings the manuals, books, valuables and
// gun attachments merchants always did (visitors.js merchantGoods). The item condition and quality per source is a
// simple roll here (QUALITY); a richer model can replace merchantCargo's rolls.
//
// Escort (ESCORT_TIERS): the cargo's worth (escortValue: supplies at their base value, items at valuation.js
// itemValue, guns, armour, explosives and military electronics counted 1.5×) sets how well they are guarded. Guards come +1 every ESCORT.GUARDS_PER_DAYS days (at most +2), and every guard is
// stronger with the year (+1 power over ESCORT.POWER_DAYS days, at most ESCORT.POWER_MAX).
//
//   cargo worth   tier       guards                                   vehicle              strength
//   under 550     light      2–3 on foot, pistols and shotguns        none                 power 3.0
//   550–1000      armed      4–5 with rifles, a few vests             a pickup truck (+3)  power 3.8
//   1000+         armoured   6–8 in vests and plates, automatic       a Humvee (+8) with   power 4.6
//                            rifles, and a scout riding ahead         a gunner in the
//                                                                     turret; from 1500
//                                                                     worth an MRAP (+11)
//
// The vehicle adds its strength to the caravan's (vStrength) and stands on the battle map behind the guards; the
// turret gunner of a Humvee or an MRAP is one more guard. Won, it is yours if it still runs (caravanraids.js).
import { SUPPLIES, SUPPLY_KEYS, GEAR } from "./data.js";
import { newItem } from "./inventory.js";
import { itemValue, itemCat } from "./valuation.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const ESCORT = { GUARDS_PER_DAYS: 120, GUARDS_EXTRA: 2, POWER_DAYS: 150, POWER_MAX: 1.2, MRAP_FROM: 1500 };
export const ESCORT_TIERS = [
  { key: "light", upTo: 550, guards: [2, 3], power: 3.0, kit: "guards", vehicle: null, scout: 0,
    words: "a few guards on foot with pistols and shotguns" },
  { key: "armed", upTo: 1000, guards: [4, 5], power: 3.8, kit: "escorts", vehicle: "truck", scout: 0,
    words: "armed guards with rifles and a pickup truck" },
  { key: "armoured", upTo: Infinity, guards: [6, 8], power: 4.6, kit: "contractors", vehicle: "hummer", scout: 1,
    words: "an armoured escort: guards in vests and plates with automatic rifles, an armoured vehicle and a scout riding ahead" },
];
// The escort's vehicles: the vehicle type it becomes when taken (vehicles.js), how it is drawn on a battle map
// (combat.js enemy vehicle body), its name, and the strength it adds (a turret gunner for the armoured ones).
export const ESCORT_VEHICLES = {
  truck: { type: "truck", body: "truck", model: "pickup", name: "pickup truck", power: 3, gunner: 0 },
  hummer: { type: "hummer", body: "humvee", model: "humvee", name: "Humvee", power: 8, gunner: 1 },
  mrap: { type: "miltruck", body: "mrap", model: "mrap", name: "MRAP", power: 11, gunner: 1 },
};
export const tierOf = (key) => ESCORT_TIERS.find((t) => t.key === key) || ESCORT_TIERS[0];
export const tierForValue = (value) => ESCORT_TIERS.find((t) => value < t.upTo) || ESCORT_TIERS[ESCORT_TIERS.length - 1];

// What a caravan carries is worth: supplies at their base value, every item at its worth (condition, uses left).
export function cargoValue(stock, wares) {
  let v = 0;
  for (const k of SUPPLY_KEYS) v += Math.max(0, (stock && stock[k]) || 0) * SUPPLIES[k].value;
  for (const it of wares || []) v += itemValue(it);
  return Math.round(v);
}

// The worth that sets the escort: the cargo's worth, with guns, armour, explosives and military electronics counted
// MILITARY × (what draws the most trouble on the road, and what the escort is paid out of).
export const MILITARY = { mult: 1.5, cats: ["pistol", "shotgun", "rifle", "automatic", "armor", "explosive", "electronics", "optics", "gunmod"] };
export function escortValue(stock, wares) {
  let extra = 0;
  for (const it of wares || []) if (MILITARY.cats.includes(itemCat(it.key))) extra += itemValue(it) * (MILITARY.mult - 1);
  return Math.round(cargoValue(stock, wares) + extra);
}

// The escort for a cargo of this worth on this day: { tier, guards, scout, gunner, kit, power, vehicle, vehPower, value }.
export function escortFor(value, d, rng) {
  const t = tierForValue(value);
  const extra = Math.min(ESCORT.GUARDS_EXTRA, Math.floor(d / ESCORT.GUARDS_PER_DAYS));
  const guards = rng.int(t.guards[0], t.guards[1]) + extra;
  const vehicle = t.vehicle === "hummer" && value >= ESCORT.MRAP_FROM ? "mrap" : t.vehicle;
  const V = vehicle ? ESCORT_VEHICLES[vehicle] : null;
  return {
    tier: t.key, guards, scout: t.scout, gunner: V ? V.gunner : 0, kit: t.kit,
    power: Math.round((t.power + Math.min(ESCORT.POWER_MAX, d / ESCORT.POWER_DAYS)) * 10) / 10,
    vehicle, vehPower: V ? V.power : 0, value,
  };
}
// The fighters on the battle map: the guards, the scout and a turret gunner.
export const escortFighters = (e) => (e ? e.guards + (e.scout || 0) + (e.gunner || 0) : 0);
// In words, for cards and tooltips ("armed guards with rifles and a pickup truck"; the armoured name their vehicle).
export function escortWords(e) {
  if (!e) return "";
  const t = tierOf(e.tier);
  if (e.tier === "armoured" && e.vehicle) return t.words.replace("an armoured vehicle", `${e.vehicle === "mrap" ? "an MRAP" : "a Humvee"} with a gunner in the turret`);
  return t.words;
}
export const escortShort = (e) => (!e ? "" : e.tier === "armoured" ? `armoured escort (${e.vehicle === "mrap" ? "MRAP" : "Humvee"})` : e.tier === "armed" ? "armed escort (pickup)" : "light guard");

// ---------- specialities ----------
// sup: [lo, hi] units of each supply; gear: the item pool, n: [lo, hi] items drawn from it.
export const SPECIALITIES = {
  general: { w: 3, label: "general goods", sup: { fuel: [15, 40], meds: [8, 22], preserved: [20, 50], parts: [3, 9], ammo: [60, 160], food: [5, 15], water: [10, 20] },
    gear: ["ar", "plate", "nvg", "milradio", "surgkit", "assaultpack", "riothelmet", "vest", "huntrifle", "waterfilter", "suppressor", "flashlight", "shotgun", "carbine", "xbow", "compbow", "rucksack", "hikingpack", "camonet", "stove", "smokegren", "binoculars", "spotscope", "thermal"], n: [2, 4] },
  arms: { w: 2, label: "guns and ammunition", sup: { ammo: [400, 900], parts: [2, 6], fuel: [5, 15], food: [5, 12], water: [8, 16] },
    gear: ["pistol", "revolver", "shotgun", "shotgun", "huntrifle", "huntrifle", "leverrifle", "carbine", "carbine", "ar", "ar", "ar", "holo", "scope4x", "frag"], n: [6, 10] },
  armour: { w: 1, label: "armour and military kit", sup: { ammo: [150, 300], meds: [4, 10], fuel: [5, 15], food: [5, 12], water: [8, 16] },
    gear: ["vest", "vest", "vest", "plate", "plate", "plate", "milhelmet", "milhelmet", "riothelmet", "nvg", "milradio", "thermal", "assaultpack", "smokegren"], n: [6, 9] },
  mechanic: { w: 2, label: "fuel, parts and tools", sup: { fuel: [30, 70], parts: [6, 14], ammo: [10, 40], food: [5, 12], water: [8, 16] },
    gear: ["crowbar", "flashlight", "headlamp", "lantern", "spotlight", "waterfilter", "handradio", "ladder", "batteries", "stove", "fishrod"], n: [3, 5] },
  medic: { w: 2, label: "medicine", sup: { meds: [20, 45], preserved: [5, 15], food: [5, 12], water: [10, 20], ammo: [10, 40] },
    gear: ["surgkit", "traumakit", "traumakit", "bandagekit", "bandagekit", "dewormer", "puritabs", "medbook", "surgerybook"], n: [2, 4] },
  provisions: { w: 2, label: "food and water", sup: { preserved: [30, 70], food: [15, 35], water: [15, 30], jars: [6, 16], fuel: [5, 12], ammo: [10, 30] },
    gear: ["stove", "waterfilter", "fishrod", "fishnet", "snarewire", "puritabs"], n: [1, 3] },
};
export const SPECIALITY_KEYS = Object.keys(SPECIALITIES);
// The condition of what they sell: [lo, hi] quality, and the share of its uses left for gear that wears.
export const QUALITY = { lo: 0.65, hi: 1, durLo: 0.6 };

export function pickSpeciality(rng) {
  return rng.weighted(SPECIALITY_KEYS, (k) => SPECIALITIES[k].w);
}
// Fills a caravan's stock and wares by its speciality (adds to what is there). Returns the speciality key.
export function merchantCargo(v, rng, speciality = null) {
  const key = speciality && SPECIALITIES[speciality] ? speciality : pickSpeciality(rng);
  const S = SPECIALITIES[key];
  for (const k of SUPPLY_KEYS) v.stock[k] = v.stock[k] || 0;
  for (const [k, [lo, hi]] of Object.entries(S.sup)) v.stock[k] = (v.stock[k] || 0) + rng.int(lo, hi);
  const pool = S.gear.filter((k) => GEAR[k]);
  const n = rng.int(S.n[0], S.n[1]);
  for (let i = 0; i < n && pool.length; i++) {
    const it = newItem(rng.pick(pool), Math.round(rng.range(QUALITY.lo, QUALITY.hi) * 100) / 100);
    if (it.dur && !GEAR[it.key].count) it.dur = Math.max(1, Math.round(it.dur * rng.range(QUALITY.durLo, 1)));
    v.wares.push(it);
  }
  v.speciality = key;
  return key;
}
export const specialityLabel = (key) => (SPECIALITIES[key] ? SPECIALITIES[key].label : "general goods");

// ---------- the guards' own gear ----------
// What each guard fought with (a fight resolved by the numbers: there were no bodies to search on a map): their
// gun and armour from their kit (combat.js KITS, by key here so this module needs nothing from combat.js), worn,
// and a few rounds each. dice(i, k): a number in [0, 1).
export const GUARD_KIT = {
  guards: { weapons: ["pistol", "pistol", "shotgun", "revolver"], armor: [null, null, "vest"] },
  escorts: { weapons: ["huntrifle", "huntrifle", "leverrifle", "shotgun", "carbine"], armor: [null, "vest", "vest"] },
  contractors: { weapons: ["ar", "ar", "carbine", "carbine", "huntrifle"], armor: ["vest", "plate", "plate"] },
};
export function guardGear(kit, n, dice) {
  const K = GUARD_KIT[kit] || GUARD_KIT.guards;
  const gear = [];
  let ammo = 0;
  for (let i = 0; i < n; i++) {
    const w = K.weapons[Math.floor(dice(i, "w") * K.weapons.length) % K.weapons.length];
    if (GEAR[w]) gear.push(newItem(w, Math.round((0.5 + dice(i, "wq") * 0.4) * 100) / 100));
    const a = K.armor[Math.floor(dice(i, "a") * K.armor.length) % K.armor.length];
    // Armour that was shot through is often ruined: half of it is worth taking.
    if (a && GEAR[a] && dice(i, "ak") < 0.5) gear.push(newItem(a, Math.round((0.4 + dice(i, "aq") * 0.4) * 100) / 100));
    ammo += 6 + Math.floor(dice(i, "ammo") * 12);
  }
  return { gear, supplies: { ammo } };
}
export const clampGuards = (n) => clamp(Math.round(n), 1, 14);
