// Caravan escorts: what the cargo makes the sender WANT to put toward guarding it, capped by what the sender HAS.
// Data and pure helpers only (visitors.js makes the merchants' caravans, caravans.js / jobs.js / factions.js the
// groups', caravanraids.js fights them).
//
// What fills a merchant's wagons is visitors.js merchantGoods (the speciality, MERCHANT_SPECS: arms dealers, medics,
// mechanics, general traders; every item's condition by itemcond.js, source "merchant"). The escort reads the rolled
// items.
//
// The wish (escortWant): the cargo's worth (escortValue: supplies at their base value, items at valuation.js
// itemValue, guns, armour, explosives and military electronics counted 1.5×) sets the SHARE of what the sender could
// send that it wants to: 0.15 + worth / 1500, at most all of it (300 worth → 35%, 750 → 65%, 1275 and up → everything
// it can spare). Cheap cargo gets a token guard, rich cargo as much as the sender can spare.
//
// What the sender has (a capacity: { guards, power, kit, vehicles }):
// - A merchant company from outside (companyFor, rolled when it crosses in, dice of its own by its serial; a little
//   richer every year): 2–8 hired guns (+1 a year, at most +2), their gear (power 2.8–4.6, +0.25 a year, at most +0.5:
//   pistols and shotguns, riflemen in vests, or hired guns in plate with automatic rifles: combat.js KITS guards /
//   escorts / contractors), and the vehicles it owns: a pickup (50%, +5% a year to 70%), a Humvee (15%, +5% a year to
//   30%), an MRAP (4%, +2% a year to 10%).
// - A group (groupCapacity): its fighters (FIGHTERS of its people) less a home guard (HOME of them, HOME_THREAT at war
//   or with the dead at its gates), at its fighters' power (caravans.js guardPower) plus its best weapons and armour on
//   the shelf (+0.15 a gun or a piece of armour among its wares, at most +0.8); its own vehicles (vehicles.js
//   factionVehicles: a military group's Humvee, when no other caravan of theirs has it out).
//
// What goes (escortFrom): guards = the wish × what it has (at least 1, at most all); the vehicle: its armoured one
// (MRAP, else Humvee) from a wish of VEHICLE_AT.armour, else a pickup from VEHICLE_AT.car; a scout riding ahead at a
// wish of SCOUT_AT with SCOUT_MIN or more guards. One of the guards mans the turret of an armoured vehicle.
// The tier is only a label for the sprite and the tooltip: armoured (a Humvee or MRAP, or 6+ in plate), armed (a
// pickup or 4+ guards), else light. A rich cargo of a poor sender still goes lightly guarded.
//
// The vehicle adds its strength to the caravan's (vStrength) and stands on the battle map behind the guards (a
// Humvee's or MRAP's M2 by the numbers: vehicles.js TURRET_ODDS). Won, it is yours if it still runs (caravanraids.js).
import { SUPPLIES, SUPPLY_KEYS, GEAR, FACTION_TYPES } from "./data.js";
import { lootItem } from "./inventory.js";
import { kitSource } from "./itemcond.js"; // the condition of a guard's gun by their kit (a contractor's kept like a soldier's)
import { itemValue, itemCat } from "./valuation.js";
import { hash01 } from "./skills.js";
import { factionVehicles } from "./vehicles.js";
import { issueKit, unitPower } from "./arsenal.js"; // a group's guards armed from its arsenal (home guard kept)
import { weightOf, fitPeople } from "./groupcare.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;

export const ESCORT = {
  WANT: { base: 0.15, per: 1 / 1500 },
  VEHICLE_AT: { car: 0.4, armour: 0.7 },
  SCOUT_AT: 0.85, SCOUT_MIN: 5,
  COMPANY: {
    guards: [2, 8], guardsPerYear: 1, guardsMax: 2,
    power: [2.8, 4.6], powerPerYear: 0.25, powerMax: 0.5,
    own: { truck: [0.5, 0.05, 0.7], hummer: [0.15, 0.05, 0.3], mrap: [0.04, 0.02, 0.1] }, // [chance, + a year, at most]
  },
  FIGHTERS: 0.6, HOME: 0.55, HOME_THREAT: 0.7, WARES_GUN: 0.15, WARES_MAX: 0.8, THREAT_RANGE: 4,
  KIT_AT: { escorts: 3.4, contractors: 4.3 }, // the merchants' guards by their power: guards, escorts, contractors
  TIER: { armouredGuards: 6, armedGuards: 4 },
};
// The escort's vehicles: the vehicle type it becomes when taken (vehicles.js), how it is drawn on a battle map
// (combat.js enemy vehicle body), its name, and the strength it adds. turret: the gun on the roof (vehicles.js
// TURRET_ODDS: + its power by the numbers); the armoured ones are plated and glassed too (vehicles.js fitMilitary),
// on the battle map and when taken; one of the guards mans the gun (gunner).
export const ESCORT_VEHICLES = {
  truck: { type: "truck", body: "truck", model: "pickup", name: "pickup truck", power: 3, gunner: 0, turret: null, armour: false },
  hummer: { type: "hummer", body: "humvee", model: "humvee", name: "Humvee", power: 8, gunner: 1, turret: "m2hb", armour: true },
  mrap: { type: "miltruck", body: "mrap", model: "mrap", name: "MRAP", power: 11, gunner: 1, turret: "m2hb", armour: true },
};
export const TIER_KEYS = ["light", "armed", "armoured"];

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

// The share of what it could send that a sender wants to put on this cargo (0.15 … 1).
export const escortWant = (value) => clamp(ESCORT.WANT.base + Math.max(0, value || 0) * ESCORT.WANT.per, ESCORT.WANT.base, 1);
const kitFor = (power) => (power >= ESCORT.KIT_AT.contractors ? "contractors" : power >= ESCORT.KIT_AT.escorts ? "escorts" : "guards");

// A merchant company's means (its own dice by the caravan's serial; d: the day).
export function companyFor(state, serial, d) {
  const C = ESCORT.COMPANY, yrs = Math.max(0, d) / 365;
  const dice = (k) => hash01(state.seed, "mcompany", serial, k);
  const guards = C.guards[0] + Math.floor(dice("g") * (C.guards[1] - C.guards[0] + 1)) + Math.min(C.guardsMax, Math.floor(yrs * C.guardsPerYear));
  const power = r1(C.power[0] + dice("q") * (C.power[1] - C.power[0]) + Math.min(C.powerMax, yrs * C.powerPerYear));
  const vehicles = Object.entries(C.own).filter(([k, [c, per, max]]) => dice(`v${k}`) < Math.min(max, c + per * yrs)).map(([k]) => k);
  return { guards, power, kit: kitFor(power), vehicles };
}
// A group's means for a caravan: its fighters less a home guard, their power and its free vehicles.
export function groupCapacity(state, f) {
  const fighters = Math.floor(Math.max(0, f.pop || 0) * ESCORT.FIGHTERS);
  const threat = (f.atWar || 0) > 0 || (state.hordes || []).some((h) => f.bases.some((b) => state.grid.distance(b, h.tile) <= ESCORT.THREAT_RANGE));
  // groupcare.js GROUP_PRIORITIES escort: how much of its fighters a type will put on the road (fit people only).
  const share = clamp(1 - (threat ? ESCORT.HOME_THREAT : ESCORT.HOME) * (f.arsenal ? 1 / weightOf(f, "escort") : 1), 0, 1);
  let guards = Math.max(0, Math.min(fighters - Math.ceil(fighters * (1 - share)), f.arsenal ? fitPeople(f) - Math.ceil(f.pop * (1 - ESCORT.FIGHTERS)) : Infinity));
  const def = FACTION_TYPES[f.type] || { arms: 1 };
  let power;
  if (f.arsenal) {
    // arsenal.js: the guards are armed from the arsenal past the home guard (issueKit "field"): no more guards than
    // guns for them, at the group's power by its kit.
    const armed = issueKit(state, f, guards, "field").filter((lo) => lo.weapon).length;
    guards = Math.min(guards, armed);
    power = r1(unitPower(f, 2.2));
  } else {
    const guns = (f.wares || []).filter((it) => ["rifle", "automatic", "shotgun", "pistol", "armor"].includes(itemCat(it.key))).length;
    power = r1(2.2 + def.arms * 1.6 + Math.min(ESCORT.WARES_MAX, guns * ESCORT.WARES_GUN)); // caravans.js guardPower, and the shelf
  }
  const busy = new Set((state.parties || []).filter((q) => q.owner === f.id && q.escort && q.escort.vehicleId != null).map((q) => q.escort.vehicleId));
  const free = factionVehicles(f).filter((v) => v.condition > 0 && !busy.has(v.id));
  const vehicles = [], ids = {};
  for (const v of free) { const k = v.type === "hummer" ? "hummer" : v.type === "truck" ? "truck" : null; if (k && !ids[k]) { vehicles.push(k); ids[k] = v.id; } }
  return { guards: Math.max(0, guards), power, vehicles, vehicleIds: ids, home: fighters - Math.max(0, guards), threat };
}
// What goes with this cargo: { tier, guards, scout, gunner, kit, power, vehicle, vehPower, vehicleId, value, want, could }.
export function escortFrom(value, cap) {
  const want = escortWant(value);
  const guards = cap.guards > 0 ? clamp(Math.round(cap.guards * want), 1, cap.guards) : 0;
  const owns = (k) => (cap.vehicles || []).includes(k);
  const armoured = owns("mrap") ? "mrap" : owns("hummer") ? "hummer" : null;
  const vehicle = !guards ? null : want >= ESCORT.VEHICLE_AT.armour && armoured ? armoured : want >= ESCORT.VEHICLE_AT.car && owns("truck") ? "truck" : null;
  const V = vehicle ? ESCORT_VEHICLES[vehicle] : null;
  const kit = cap.kit || kitFor(cap.power);
  const tier = (V && V.armour) || (kit === "contractors" && guards >= ESCORT.TIER.armouredGuards) ? "armoured" : vehicle || guards >= ESCORT.TIER.armedGuards ? "armed" : "light";
  return {
    tier, guards, scout: want >= ESCORT.SCOUT_AT && guards >= ESCORT.SCOUT_MIN ? 1 : 0, gunner: V && V.gunner ? 1 : 0, kit, power: cap.power,
    vehicle, vehPower: V ? V.power : 0, vehicleId: vehicle && cap.vehicleIds ? cap.vehicleIds[vehicle] ?? null : null,
    value: Math.round(value || 0), want: Math.round(want * 100) / 100,
    could: { guards: cap.guards, vehicle: armoured || (owns("truck") ? "truck" : null) },
  };
}
// A merchant caravan's escort (visitors.js makeVisitor): the company's means, the cargo's wish.
export function merchantEscort(state, serial, value, d, company = null) {
  const cap = company || companyFor(state, serial, d);
  const e = escortFrom(value, cap);
  e.company = cap;
  return e;
}
// A group's caravan or convoy (caravans.js sendCaravan, jobs.js, factions.js): its means, the cargo's wish. kit: its own
// fighters (caravanraids.js).
export function groupEscort(state, f, value) {
  return escortFrom(value, groupCapacity(state, f));
}
// How strong a caravan's escort is by the numbers: the guards at their power and the vehicle (traders not counted).
export const escortStrength = (e) => (e ? e.guards * e.power + (e.vehicle ? e.vehPower : 0) : 0);
// The fighters on the battle map: the guards (the scout and the turret gunner are among them).
export const escortFighters = (e) => (e ? e.guards : 0);
const KIT_WORDS = { guards: "pistols and shotguns", escorts: "rifles, some in vests", contractors: "vests, plates and automatic rifles" };
// In words, for cards and tooltips ("4 guards with rifles, some in vests, and a pickup truck").
export function escortWords(e) {
  if (!e) return "";
  if (!e.guards) return "nobody to guard it";
  const V = e.vehicle ? ESCORT_VEHICLES[e.vehicle] : null;
  const who = `${e.guards} ${e.kit === "contractors" ? "hired gun" : "guard"}${e.guards === 1 ? "" : "s"} with ${KIT_WORDS[e.kit] || "what they have"}`;
  const veh = V ? `${V.armour ? `${V.model === "mrap" ? "an MRAP" : "a Humvee"} with an M2 in the turret` : "a pickup truck"}` : "";
  const parts = [who, e.scout ? "a scout riding ahead" : "", veh].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
}
export const escortShort = (e) => (!e ? "" : e.tier === "armoured" ? `armoured escort${e.vehicle && ESCORT_VEHICLES[e.vehicle].armour ? ` (${e.vehicle === "mrap" ? "MRAP" : "Humvee"})` : ""}` : e.tier === "armed" ? `armed escort${e.vehicle === "truck" ? " (pickup)" : ""}` : "light guard");

// ---------- the guards' own gear ----------
// What each guard fought with (a fight resolved by the numbers: there were no bodies to search on a map): their
// gun and armour from their kit (combat.js KITS, by key here so this module needs nothing from combat.js), in the
// condition their kit keeps it (itemcond.js kitSource), and a few rounds each. dice(i, k): a number in [0, 1).
export const GUARD_KIT = {
  guards: { weapons: ["pistol", "pistol", "shotgun", "revolver"], armor: [null, null, "vest"] },
  escorts: { weapons: ["huntrifle", "huntrifle", "leverrifle", "shotgun", "carbine"], armor: [null, "vest", "vest"] },
  contractors: { weapons: ["ar", "ar", "carbine", "carbine", "huntrifle"], armor: ["vest", "plate", "plate"] },
};
export function guardGear(kit, n, dice) {
  const K = GUARD_KIT[kit] || GUARD_KIT.guards, src = kitSource(GUARD_KIT[kit] ? kit : "guards");
  const gear = [];
  let ammo = 0;
  for (let i = 0; i < n; i++) {
    const w = K.weapons[Math.floor(dice(i, "w") * K.weapons.length) % K.weapons.length];
    if (GEAR[w]) gear.push(lootItem(w, src, ["escortgun", i, dice(i, "wq")])); // itemcond.js: by their kit, as their bodies on a battle map (a hired gun's rifle looked after)
    const a = K.armor[Math.floor(dice(i, "a") * K.armor.length) % K.armor.length];
    // Armour that was shot through is often ruined: half of it is worth taking.
    if (a && GEAR[a] && dice(i, "ak") < 0.5) gear.push(lootItem(a, src, ["escortarmor", i, dice(i, "aq")]));
    ammo += 6 + Math.floor(dice(i, "ammo") * 12);
  }
  return { gear, supplies: { ammo } };
}
export const clampGuards = (n) => clamp(Math.round(n), 1, 14);
