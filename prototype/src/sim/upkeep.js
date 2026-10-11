// Upkeep per head: who eats and drinks from a base's stores, and how much. Everything a base uses up just by people
// living there is a rate per person present, a day, times the people there (the base's own stock; the hub and every
// outpost feed their own people, economy.js baseDaily):
//   residents   everyone living at the base (atBase; at the hub also trade-route escorts waiting between trips,
//               world.js residents): UPKEEP.food food each × the cold (weather.foodNeedFactor: ×1.1 on a day below
//               0°C, ×1.2 below −8°C) × a Quartermaster living there (×0.9, skills.js) × the Kitchen's hot meals
//               (kitchen.js kitchenEatMult: ×0.9 with its cooks feeding everyone, ×0.87 at best) × the base's ration level
//               (meals.js: lean ×0.8, a feast day ×1.5; eaten person by person at meal breaks: eating.js); water UPKEEP.water each × the
//               day's thirst (weather.thirstFactor: spring and autumn 1, summer 1.3, winter 0.9, a hot day at least
//               1.6), +1 for each case of dysentery (economy.waterNeed). Under a week of food left they go on short
//               rations (economy.RATION, 60%).
//   prisoners   in the cells or the shed (prisoners.js): PRISON.FOOD × their rations each (Short 0.6 by default; Full
//               1, Starvation 0.3, None 0) × the cold, water as anyone.
//   guests      travellers you shelter (visitors.js shelter): UPKEEP.guest each × the cold, water as anyone.
//   crew        a supply convoy holding at the base (supply.js holdUpkeep): UPKEEP.crew each × the cold, water as
//               anyone (from the base first, then what the convoy carries).
//   the dog     (hubevents.js DOG.food) when the base took one in.
//   heating     on a day below 0°C (the day's mean) a base burns HEAT.fuel (0.1) fuel a person present (everyone
//               fed there, the heads above) a day, ×HEAT.bitter (1.5) below −8°C: firewood first (30 firewood = 0.2
//               fuel of heat, HEAT.wood: so 15 firewood, 1.5 kg, a head), then fuel for what the wood does not cover (needs.js
//               heatDaily). A shelter (buildings.js, tier 0) with its camp fire lit is warmed by the fire (deadfall
//               from around it, or firewood where the ground is bare: woodcutting.js). Without either everyone there
//               is cold: needs.js COLD.
// People away from the base (a team, a convoy on the road, a crew, an errand) do not eat its food: a team eats its own
// packed supplies, one ration a person a day and more on the move under a load, person by person (needs.js gauges,
// load.js personRation); an errand takes about a day's food and water a day from the base when it leaves. Food spoils by what is stored (storage.js), not by who eats it; a generator burns fuel per day it runs
// and a vehicle per hour it drives (power.js, parties.js); wear is per building (breakdowns.js); meds go per
// treatment of someone sick or hurt (medical.js, health.js).
import { residents } from "./world.js";
import { partyMembers } from "./parties.js";
import { PRISON, prisonFoodAt } from "./prisoners.js";
import { DOG } from "./hubevents.js";
import { eatMult } from "./skills.js";
import { appetite } from "./traits.js"; // Glutton
import * as Weather from "./weather.js";
import { childRations, childrenAt } from "./family.js"; // children (family.js): fed here, eaten in familyDaily
import { edibleFood } from "./storage.js";
import { FOODS, foodIn, unitsOf } from "./foods.js"; // food by type: the reserve counts days of food
import { waterIn } from "./water.js";
import { kitchenEatMult } from "./kitchen.js"; // hot meals stretch the food
import { rationUse } from "./meals.js"; // the base's ration level (lean 0.8, a feast day 1.5)

export const UPKEEP = { food: 1, water: 1, guest: 1, crew: 1 };

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

// Food one person eats a day at a base, by the cold (today unless dayIdx).
export const coldFactor = (state, dayIdx) => (Weather.foodNeedFactor ? (dayIdx == null ? Weather.foodNeedFactor(state) : Weather.foodNeedFactor(state, dayIdx)) : 1);

// Prisoners held at a base (in the cells or the shed).
export const prisonersAt = (state, base) => (state.prisoners || []).filter((p) => p.at && p.at.kind === "base" && p.at.baseId === base.id).length;
// Travellers sheltering at a base (visitors.js shelter).
export const guestsAt = (state, base) => (state.visitors || []).filter((v) => v.phase === "sheltered" && v.shelterBase === base.id).reduce((a, v) => a + (v.size || 0), 0);
// The crew of supply convoys holding at a base (supply.js holdUpkeep).
export const crewAt = (state, base) => (state.parties || []).filter((p) => p.routeKind === "supply" && p.phase === "holding" && p.destBaseId === base.id).reduce((a, p) => a + partyMembers(state, p).length, 0);

// Everyone fed from a base's stores today, by group: { residents, prisoners, guests, crew, dog, heads }. heads: the
// people (not the dog).
export function mouthsAt(state, base) {
  const res = residents(state, base.id).length;
  const prisoners = prisonersAt(state, base), guests = guestsAt(state, base), crew = crewAt(state, base);
  const children = state.children && state.children.length ? childrenAt(state, base.id).length : 0; // family.js
  return { residents: res, prisoners, guests, crew, children, dog: base.dog ? 1 : 0, heads: res + prisoners + guests + crew + children };
}

// Food a day from a base's stores, per head × heads, by group: { rate (a resident's), cold, groups: [{ key, label, n,
// each, total }], residents (their total), total, heads }. Nothing for an empty base.
export function foodUse(state, base, dayIdx) {
  const m = mouthsAt(state, base);
  const cold = coldFactor(state, dayIdx);
  // × the base's ration level (meals.js RATION_LEVELS: eating.js eats to it person by person, so the forecasts agree).
  const rate = UPKEEP.food * cold * (m.residents ? eatMult(state, base) * kitchenEatMult(state, base) * rationUse(state, base) : 1);
  // A Glutton eats a quarter ration more (traits.js): the residents' each is their average.
  const gluttons = m.residents ? residents(state, base.id).reduce((a, s) => a + appetite(s) - 1, 0) : 0;
  const groups = [];
  const add = (key, label, n, each) => { if (n > 0) groups.push({ key, label, n, each: r2(each), total: n * each }); };
  add("residents", m.residents === 1 ? "person" : "people", m.residents, rate * (1 + gluttons / Math.max(1, m.residents)));
  // prisoners-tab: each prisoner eats by their rations (prisoners.js RATIONS: Short 60% by default), so `each` is the average.
  add("prisoners", m.prisoners === 1 ? "prisoner" : "prisoners", m.prisoners, (m.prisoners ? prisonFoodAt(state, base) / m.prisoners : PRISON.FOOD) * cold);
  add("guests", m.guests === 1 ? "guest" : "guests", m.guests, UPKEEP.guest * cold);
  add("crew", "convoy crew", m.crew, UPKEEP.crew * cold);
  // family.js: a quarter of a ration for a baby, half for a child, three quarters for a youngster (eaten in familyDaily).
  if (m.children) add("children", m.children === 1 ? "child" : "children", m.children, (rate * childRations(state, base)) / m.children);
  add("dog", "the dog", m.dog, DOG.food);
  const total = groups.reduce((a, g) => a + g.total, 0);
  return { rate: r2(rate), cold, groups, residents: (m.residents + gluttons) * rate, total, heads: m.heads, mouths: m };
}

// ---------- the pay-out reserve ----------
// Food and water are never paid out of a base below PAYOUT.days of its own need: the governor's and the base
// leaders' trades (caravans, merchants, radio deals and the caravans that fetch them), raid tribute, ransoms,
// envoys' gifts and the hub's supply runs all pay only from what is above it. (2026-10-08 thirst diagnosis: a hub
// whose wells kept up rated its water "plenty" and sold it to every merchant at the gates, 466 water in a year on one
// seed, so a broken well or a heat wave found it with two days' drinking in store.) Need: everyone fed at the base
// (mouthsAt heads: residents, prisoners, guests, a holding convoy's crew) eating today's ration (foodUse) or drinking
// today's thirst (weather.js thirstFactor). Both water kinds count (water.js waterIn); food is fresh + preserved.
// AI groups (coarse: f.stock per head, a day each) keep the same days (trade.js RESERVE, groupcare.js raidAnswer,
// diplomacy.js peace tribute): groupPayoutSpare.
export const PAYOUT = { days: 4 };
const PAYOUT_KINDS = ["food", "water"];
// What a base keeps back of food or water before it pays any out: PAYOUT.days of its need. 0 for other kinds.
export function payoutFloor(state, base, kind) {
  if (!base || !PAYOUT_KINDS.includes(kind)) return 0;
  if (kind === "food") return foodUse(state, base).total * PAYOUT.days;
  const heads = mouthsAt(state, base).heads;
  return heads * UPKEEP.water * (Weather.thirstFactor ? Weather.thirstFactor(state) : 1) * PAYOUT.days;
}
// What a base holds of a kind for the reserve (food: fresh + preserved; water: purified + un-purified).
const payoutHave = (base, kind) => (kind === "food" ? edibleFood(base) : kind === "water" || kind === "rawwater" ? waterIn(base.stock) : Math.max(0, base.stock[kind] || 0));
// What a base can pay out of a kind without going below its floor (Infinity for kinds the reserve does not cover).
// "preserved" counts as food (days of it) and "rawwater" as water; a food item (foods.js) as many of it as the days of
// food over the floor allow (never more than there is).
export function payoutSpare(state, base, kind) {
  if (FOODS[kind]) {
    const days = payoutSpare(state, base, "food");
    return base ? Math.max(0, Math.floor(Math.min(base.stock[kind] || 0, days / unitsOf(kind, 1)) + 1e-9)) : Infinity;
  }
  const k = kind === "preserved" ? "food" : kind === "rawwater" ? "water" : kind;
  if (!base || !PAYOUT_KINDS.includes(k)) return Infinity;
  return Math.max(0, Math.floor(payoutHave(base, k) - payoutFloor(state, base, k)));
}
// The goods { key: qty } would take a base's food or water below its floor (food items count in days of food).
export const payoutBreaks = (state, base, goods) => {
  const by = { food: 0, water: 0 };
  for (const [k, q] of Object.entries(goods || {})) { if (FOODS[k]) { by.food += unitsOf(k, Math.max(0, q || 0)); continue; } const kk = k === "preserved" ? "food" : k === "rawwater" ? "water" : k; if (kk in by) by[kk] += Math.max(0, q || 0); }
  return PAYOUT_KINDS.some((k) => by[k] > 0 && by[k] > payoutSpare(state, base, k));
};
// An AI group (its coarse stock: a day's food and water a head a day): what it can pay out of a kind (food in days).
export const groupPayoutSpare = (f, kind) => (PAYOUT_KINDS.includes(kind) ? Math.max(0, Math.floor((kind === "food" ? foodIn(f.stock) : f.stock[kind] || 0) - (f.pop || 0) * PAYOUT.days)) : Math.max(0, Math.floor(f.stock[kind] || 0)));

// ---------- heating ----------
// The need is counted in fuel (HEAT.fuel a head a day below 0°C); a base burns firewood first (woodcutting.js: a
// firewood heats as much as HEAT.wood fuel, so the need in firewood is 150 times the fuel figure), then fuel for the
// rest. Wood is the winter's heating; fuel is kept for the vehicles and the generator.
// HEAT.wood 0.2 (tune-winter, was 0.5): at 0.5 the autopilot's colonies never went cold (0 cold base-days in 20 games ×
// two winters); at 0.2 a winter takes about 15 firewood a head (450 since a unit is 0.1 kg), a forest hub's woodcutters keep up, a big hub on
// farmland or one short of hands does not quite (about 2 cold base-days a winter on average, all on poor land).
// HEAT.wood is per firewood of 0.1 kg (0.2 a 3 kg bundle, the unit before: every firewood figure is 30 times what it was).
export const HEAT = { fuel: 0.1, bitter: 1.5, freezeAt: 0, bitterAt: -8, wood: 0.2 / 30 };
// Fuel one person needs heating a day (today unless dayIdx): 0 at or above 0°C, HEAT.fuel below, ×HEAT.bitter below −8°C.
export function heatRate(state, dayIdx) {
  const t = Weather.dayMeanTemp ? (dayIdx == null ? Weather.dayMeanTemp(state) : Weather.dayMeanTemp(state, dayIdx)) : 10;
  return t < HEAT.bitterAt ? HEAT.fuel * HEAT.bitter : t < HEAT.freezeAt ? HEAT.fuel : 0;
}
// Firewood for `fuel` worth of heat.
export const woodFor = (fuel) => Math.round((fuel / HEAT.wood) * 1e9) / 1e9; // rounded off: HEAT.wood is a 30th
// A shelter (tier 0) with its camp fire lit (fieldheat.js fireLit: lit unless put out) is warmed by the fire. The fire
// burns deadfall gathered around it, or firewood from the store where the ground is bare (woodcutting.js shelterFire:
// base.fireFed false = nothing left to burn, so it does not warm).
export const fireWarmed = (base) => !!base && base.tier === 0 && (base.campFire ?? base.fire) !== false && base.fireFed !== false;
// Heating a day at a base: { each (fuel a head), n (the heads fed there), total (in fuel), wood (the same in firewood),
// fire (a shelter's fire does it), text }. text: "6 people × 0.1 = 0.6 → 90 firewood a day (or 0.6 fuel)".
export function heatUse(state, base, dayIdx) {
  const each = heatRate(state, dayIdx);
  const n = mouthsAt(state, base).heads;
  const fire = each > 0 && fireWarmed(base);
  const total = fire ? 0 : n * each;
  const text = !each ? "no heating needed (above 0°C)" : fire ? `the camp fire keeps ${n} ${n === 1 ? "person" : "people"} warm (no fuel)` : n ? `${perHeadText(n, n === 1 ? "person" : "people", each)} → ${Math.round(woodFor(n * each))} firewood a day (or ${r1(n * each).toFixed(1)} fuel)` : "nobody here";
  return { each: r2(each), n, total, wood: woodFor(total), fire, text };
}

// A per-head rate as text: 1.0, 1.3, 0.99.
export const eachText = (v) => v.toFixed(Math.abs(v * 10 - Math.round(v * 10)) > 1e-6 ? 2 : 1);
// "6 people × 1.0 = 6.0" (n × each = total), the label after the count.
export const perHeadText = (n, label, each) => `${n} ${label} × ${eachText(each)} = ${r1(n * each).toFixed(1)}`;
// "6 people × 1.0 = 6.0", "the dog 0.5": one group.
export const groupText = (g) => (g.key === "dog" ? `${g.label} ${r1(g.total)}` : perHeadText(g.n, g.label, g.each));
// The whole use: "6 people × 1.0 = 6.0" or "6 people × 1.0 = 6.0 + 2 prisoners × 1.0 = 2.0 (8.0)".
export function useText(use) {
  if (!use.groups.length) return "nobody here";
  const parts = use.groups.map(groupText);
  return parts.length === 1 ? parts[0] : `${parts.join(" + ")} (${r1(use.total).toFixed(1)})`;
}
