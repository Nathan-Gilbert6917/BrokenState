// AI parity: the other groups look after themselves with the systems you use (user, 2026-10-07: "AI groups use all
// the same game system mechanics and try to stay alive by repairing, healing, expanding, handling scenarios").
// Coarse and cheap: one pass a day per group (factions.js factionsDaily), counts rather than people.
//
// Wounded (f.wounded): a fight leaves WOUND_PER_DEAD wounded for each of a group's dead (a fight by the numbers you
// won: the 40% of their "killed" that conflicts.js did not count as dead). The wounded do not fight (fitPeople:
// arsenal.js strength counts the fit), and heal HEAL a day, HEAL + HEAL_MEDS with meds (MEDS a wounded head a day from
// their stock); with none, DIE_NO_MEDS of them a day die of their wounds.
// Repairs (repairGear): a group with a workshop (groupworks.js "bench", what a workbench is for you) mends its kit by
// the rules of your repairs (repair.js on ow-economy: the same formula, to be wired to it): every REPAIR.every days up
// to one piece per REPAIR.perPop people below REPAIR.below of its maximum, best first, back to its maximum, the maximum
// dropping by restored × max(0.08, 0.25 − 0.01 × skill) (the group's mechanic: REPAIR.skill by type). Inputs from
// their stock: guns a part per 20% of full durability restored and a scrap; hard armour a part and 2 scrap; soft
// armour 2 scrap and a part (for the kevlar kit); makeshift and melee 1 scrap. Ceramic plates and worn-out pieces
// (maximum under 20% of full) are not mended.
// Vehicles (f.vehicles): a turreted vehicle loses VEHICLE.fight condition a fight it is in (VEHICLE.lost when its side
// loses); at 0 it is out (vehicles.js groupTurret). With a workshop, one in need (under VEHICLE.below) gets
// VEHICLE.step back a day for a part and 2 scrap.
// Hunger (hungerTrade): a group with under HUNGER.below days of food a head buys food from a group that has HUNGER.rich
// (not one at war with it, relation above HUNGER.rel), paying with ammo, scrap, fuel and meds at their worth (data.js
// SUPPLIES) × HUNGER.markup, once every HUNGER.gap days.
// Raids (raidAnswer): a group raided by a group HOLD_RATIO × stronger than its defence at a base pays tribute
// (TRIBUTE share of its food, ammo, meds and scrap) TRIBUTE_ODDS of the time instead of fighting, as you can.
// Expansion (canExpand): a new base takes EXPAND.scrap scrap and EXPAND.fit fit people at home.
// Every roll is a hash (skills.js hash01): the world's dice are not touched.
import { SUPPLIES, GEAR } from "./data.js";
import { day, log } from "./world.js";
import { hash01 } from "./skills.js";
import { itemDur, itemDurMax } from "./crafting.js";
import { workshopFactor } from "./groupworks.js";
import { factionVehicles, groupTurret } from "./vehicles.js";
import { relation, warsOf } from "./diplomacy.js";

export const CARE = {
  WOUND_PER_DEAD: 1.5, HEAL: 0.08, HEAL_MEDS: 0.12, MEDS: 0.25, DIE_NO_MEDS: 0.01,
  REPAIR: { every: 2, below: 0.6, perPop: 10, skill: { military: 6, fortress: 5, expansionist: 4, traders: 4, raider: 3, zealot: 2, commune: 3 },
    lossBase: 0.25, lossPer: 0.01, lossMin: 0.08, wornOut: 0.2, gunStep: 0.2 },
  VEHICLE: { fight: [2, 6], lost: [10, 25], below: 80, step: 15, parts: 1, scrap: 2 },
  HUNGER: { below: 2, rich: 8, want: 4, markup: 1.3, gap: 5, rel: -15 },
  HOLD_RATIO: 1.4, TRIBUTE_ODDS: 0.4, TRIBUTE: 0.25,
  EXPAND: { scrap: 8, fit: 8 },
};
const h = (state, ...k) => hash01(state.seed, "groupcare", ...k);
const known = (state, ...fs) => fs.some((f) => f && f.known);

// ---------- the wounded ----------
export const woundedOf = (f) => Math.max(0, Math.min(f.pop || 0, Math.round(f.wounded || 0)));
export const fitPeople = (f) => Math.max(0, (f.pop || 0) - woundedOf(f));
export function woundGroup(f, n) {
  if (!f || !(n > 0)) return;
  f.wounded = Math.min(f.pop || 0, (f.wounded || 0) + Math.round(n));
}
// The wounded a fight leaves for `dead` dead.
export const woundsFor = (dead) => Math.round(Math.max(0, dead) * CARE.WOUND_PER_DEAD);

function heal(state, f, d) {
  const w = woundedOf(f);
  f.wounded = w;
  if (!w) return;
  const need = Math.ceil(w * CARE.MEDS);
  const meds = (f.stock.meds || 0) >= need;
  if (meds) f.stock.meds -= need;
  const healed = Math.min(w, Math.floor(w * (CARE.HEAL + (meds ? CARE.HEAL_MEDS : 0)) + h(state, f.name, d, "heal")));
  f.wounded = w - healed;
  if (!meds) {
    const dead = Math.min(f.wounded, Math.floor(f.wounded * CARE.DIE_NO_MEDS + h(state, f.name, d, "die")));
    if (dead > 0) { f.wounded -= dead; f.pop = Math.max(0, f.pop - dead); f.diedOfWounds = (f.diedOfWounds || 0) + dead; }
  }
}

// ---------- repairs (the same contract as repair.js: repairMath / repairInputs) ----------
const GUN_CATS = ["pistol", "shotgun", "rifle", "automatic"];
const SOFT = ["vest", "tacvest", "softinsert"];
const CERAMIC = ["plate", "ceramicplate"];
export function groupLossRate(skill) { const R = CARE.REPAIR; return Math.max(R.lossMin, R.lossBase - R.lossPer * Math.max(0, skill || 0)); }
// What mending one piece takes and does: { restore, newMax, parts, scrap } or null (nothing to mend, or it cannot be).
export function groupRepairPlan(item, skill) {
  const d = item && GEAR[item.key];
  if (!d || !d.dur || d.throw) return null;
  const max = itemDurMax(item), dur = itemDur(item);
  if (max == null || dur == null || dur >= max) return null;
  if (max < CARE.REPAIR.wornOut * d.dur - 1e-9) return null; // worn out
  if (CERAMIC.includes(item.key)) return null; // replaced, not mended
  const restore = max - dur;
  let parts = 0, scrap = 1;
  if (d.slot === "weapon" && GUN_CATS.includes(d.cat) && !d.makeshift) parts = Math.ceil(restore / (CARE.REPAIR.gunStep * d.dur) - 1e-9);
  else if (["armor", "head", "arms", "legs"].includes(d.slot) && !d.makeshift) { parts = 1; scrap = 2; if (SOFT.includes(item.key)) scrap = 2; }
  const newMax = Math.round(Math.max(1, max - restore * groupLossRate(skill)) * 10) / 10;
  return { restore, newMax, parts, scrap };
}
export function repairGear(state, f, d = day(state)) {
  const A = f.arsenal;
  const R = CARE.REPAIR;
  if (!A || workshopFactor(state, f) < 1 || (d + Math.floor(h(state, f.name, "rph") * R.every)) % R.every) return 0;
  const skill = R.skill[f.type] ?? 3;
  const worn = A.items.filter((it) => { const m = itemDurMax(it), u = itemDur(it); return m && u != null && u < m * R.below; })
    .sort((a, b) => (GEAR[b.key].value || 0) - (GEAR[a.key].value || 0) || String(a.aid).localeCompare(String(b.aid)));
  let n = 0;
  for (const it of worn) {
    if (n >= Math.max(1, Math.ceil(f.pop / R.perPop))) break;
    const p = groupRepairPlan(it, skill);
    if (!p || (f.stock.parts || 0) < p.parts || (f.stock.scrap || 0) < p.scrap) continue;
    f.stock.parts = (f.stock.parts || 0) - p.parts;
    f.stock.scrap -= p.scrap;
    if (it.durBase == null) it.durBase = itemDurMax(it);
    it.durMax = p.newMax;
    it.dur = p.newMax;
    A.rev++;
    A.stats.in.repaired = (A.stats.in.repaired || 0) + 1;
    n++;
  }
  return n;
}

// ---------- vehicles ----------
export function wearGroupVehicles(state, f, lost = false, tag = "") {
  if (!f || !groupTurret(f)) return;
  const v = factionVehicles(f).find((x) => x.condition > 0 && x.up && x.up.turret) || factionVehicles(f).find((x) => x.condition > 0);
  if (!v) return;
  const [lo, hi] = lost ? CARE.VEHICLE.lost : CARE.VEHICLE.fight;
  v.condition = Math.max(0, Math.round(v.condition - (lo + (hi - lo) * h(state, f.name, state.hour, tag, "veh"))));
  if (v.condition <= 0 && f.known) log(state, `${f.name}'s ${v.name} was knocked out; it is out of action until they repair it.`, "info");
}
function repairVehicles(state, f) {
  if (workshopFactor(state, f) < 1) return;
  const V = CARE.VEHICLE;
  const v = factionVehicles(f).filter((x) => x.condition < V.below).sort((a, b) => a.condition - b.condition)[0];
  if (!v || (f.stock.parts || 0) < V.parts || (f.stock.scrap || 0) < V.scrap) return;
  f.stock.parts -= V.parts;
  f.stock.scrap -= V.scrap;
  v.condition = Math.min(100, v.condition + V.step);
}

// ---------- hunger: buy food ----------
export function hungerTrade(state, f, d = day(state)) {
  const H = CARE.HUNGER;
  if ((f.stock.food || 0) >= f.pop * H.below || (f.foodDeal != null && d - f.foodDeal < H.gap)) return null;
  const wars = new Set(warsOf(state, f).flatMap((w) => [w.a, w.b]));
  const partners = state.factions.filter((o) => o.alive && o !== f && !o.outsider && !wars.has(o.id) && (o.stock.food || 0) >= o.pop * H.rich && relation(state, f, o) > H.rel);
  if (!partners.length) return null;
  const o = partners.sort((a, b) => b.stock.food / b.pop - a.stock.food / a.pop || a.id - b.id)[0];
  let want = Math.min(Math.floor(f.pop * H.want - (f.stock.food || 0)), Math.floor((o.stock.food || 0) - o.pop * (H.rich - 2)));
  if (want <= 0) return null;
  // Pay with what they can spare most (ammo above 3 a head, scrap, fuel, meds above 1 a head), at their worth.
  const spare = { ammo: (f.stock.ammo || 0) - f.pop * 3, scrap: f.stock.scrap || 0, fuel: (f.stock.fuel || 0) - f.pop * 0.5, meds: (f.stock.meds || 0) - f.pop };
  let owed = want * SUPPLIES.food.value * H.markup;
  const paid = {};
  for (const k of ["scrap", "ammo", "fuel", "meds"]) {
    if (owed <= 0) break;
    const q = Math.min(Math.max(0, Math.floor(spare[k])), Math.ceil(owed / SUPPLIES[k].value));
    if (q <= 0) continue;
    paid[k] = q;
    owed -= q * SUPPLIES[k].value;
  }
  if (owed > 0) want = Math.floor(want * (1 - owed / (want * SUPPLIES.food.value * H.markup)));
  if (want <= 0) return null;
  for (const [k, q] of Object.entries(paid)) { f.stock[k] -= q; o.stock[k] = (o.stock[k] || 0) + q; }
  f.stock.food = (f.stock.food || 0) + want;
  o.stock.food -= want;
  f.foodDeal = d;
  f.foodBought = (f.foodBought || 0) + want;
  if (known(state, f, o) && f.known && o.known) log(state, `${f.name}, short of food, bought ${want} food from ${o.name}.`, "info");
  return { from: o, food: want, paid };
}

// ---------- a raid at their walls ----------
// Pay or fight? "tribute" when they pay (what was paid goes to the raiders), or null (they fight).
export function raidAnswer(state, attacker, target, att, def) {
  if (!attacker || !target || att < def * CARE.HOLD_RATIO) return null;
  if (h(state, target.name, attacker.name, state.hour, "tribute") >= CARE.TRIBUTE_ODDS) return null;
  for (const k of ["food", "ammo", "meds", "scrap"]) {
    const q = Math.floor((target.stock[k] || 0) * CARE.TRIBUTE);
    target.stock[k] -= q;
    attacker.stock[k] = (attacker.stock[k] || 0) + q;
  }
  target.tributes = (target.tributes || 0) + 1;
  return "tribute";
}

// ---------- expanding ----------
export const canExpand = (f) => (f.stock.scrap || 0) >= CARE.EXPAND.scrap && fitPeople(f) >= CARE.EXPAND.fit;
export function expanded(f) { f.stock.scrap -= CARE.EXPAND.scrap; }

// One group's day (factions.js factionsDaily).
export function groupCareDaily(state, f) {
  const d = day(state);
  heal(state, f, d);
  repairGear(state, f, d);
  repairVehicles(state, f);
  hungerTrade(state, f, d);
}
