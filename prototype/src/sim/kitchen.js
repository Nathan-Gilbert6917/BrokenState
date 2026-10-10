// @ts-check
// The Kitchen (buildings.js "canteen"; the older "kitchen" key is the Preserving room, which jars food): a base's
// cookhouse with a cook on the Cook job (economy.js ROLES.cook, work.js work type "meals"). User request 2026-10-10:
// "Add kitchen building" that makes meals real.
//
// What it does (everything scales with `cover`, the share of the people living here a day's cooks can feed):
//   food     everyone fed hot meals eats KITCHEN.save less a day (−10%: soups and stews stretch the stores, nothing is
//            wasted; upkeep.js foodUse × kitchenEatMult, so every forecast and the governor see it too). The best
//            cook's Farming (the game has no Cooking skill; Farming is the preserving skill too) adds KITCHEN.skillStep
//            a point above KITCHEN.skillFrom, up to KITCHEN.saveMax (−13% at Farming 10).
//   mood     hot meals: +KITCHEN.mood a day (+KITCHEN.moodSkilled with a Farming 6+ cook) for everyone here
//            (relations.js moodFactors; the Preserving room's old +1 "hot meals" is the floor, never added on top).
//   water    the meals' water (soup, tea, porridge) is boiled: KITCHEN.boil of the day's drinking is purified
//            (worm.js purifyCap), no firewood of its own (the stove is lit for the cooking anyway).
//   the worm the kitchen's stoves cook every meat, fish and crop through, cooks on duty or not: it does all the cook
//            fire does (worm.js baseCooks), so a base with a kitchen needs no cook fire.
// Cooks: one per KITCHEN.perCook people living here (cooksWanted), a full day's job: up before the others to cook
// breakfast (05:00), serving at the mealtimes (activity.js MEALS: 06:00, the hunters' 08:00, dinner 20:00), bread,
// stock and washing up between, dinner from 16:00 (cookActivity: what the People tab shows). A cook too ill to work
// (work factor under KITCHEN.minWork) feeds nobody; a weaker one feeds fewer (× work factor).
// No kitchen, or nobody on Cook: the food is eaten as before (no penalty beyond the worm's raw-food rules).
// The day (kitchenDaily, economy.js after the eating): base.kitchenDay = { day, cooks, served, meals, saved, cover }
// for the base's Kitchen card, and the Work now panel's Cook row (output.js: meals and food saved).
// AI groups (groupworks.js KITCHEN): a group base of KITCHEN size builds one; the people it serves eat 10% less.
import { atBase, residents, skill } from "./world.js";
import { count } from "./buildings.js";
import { isManaged } from "./work.js";
import { workFactor } from "./health.js";
import { noteOutput, workDay } from "./output.js";

export const KITCHEN = {
  perCook: 12, save: 0.1, skill: "farming", skillFrom: 4, skillStep: 0.005, saveMax: 0.13,
  mood: 1, moodSkilled: 1.5, moodSkillAt: 6, boil: 0.25, minWork: 0.35,
  govFrom: 8, // the governor (and a steward with Building and Farming & food) builds one at a base of 8+ people
  day: [5, 21], // the cooks' working hours (05:00–21:59)
};

// A working kitchen here (a broken one, breakdowns.js, cooks nothing).
export const hasKitchen = (base) => !!base && count(base, "canteen") > 0;
// The job someone counts at for the day (activity.js dayJob: people on priorities are counted at their last work).
export function dayRole(state, s) {
  const t = isManaged(state, s) ? s.task : null;
  if (t && (t.kind === "sched" || t.kind === "emerg") && t.last && state.hour - t.last.hour <= 72) return t.last.role;
  return s.role;
}
// The cooks at a base able to work today.
export const cooksAt = (state, base) => atBase(state, base.id).filter((s) => dayRole(state, s) === "cook" && !s.inBed && workFactor(s) >= KITCHEN.minWork);
// Cooks a base's kitchen wants: one per KITCHEN.perCook people living here (0 without a kitchen).
export const cooksWanted = (state, base) => (hasKitchen(base) ? Math.max(1, Math.ceil(residents(state, base.id).length / KITCHEN.perCook)) : 0);

// The kitchen's day: { built, cooks, wanted, fed (people living here), served (of them, fed hot meals), cover (0–1),
// skill (the best cook's Farming), rate (the saving at full cover), save (rate × cover), mood, boil }.
export function kitchenService(state, base) {
  const built = hasKitchen(base);
  const fed = built ? residents(state, base.id).length : 0;
  const none = { built, cooks: [], wanted: built ? cooksWanted(state, base) : 0, fed, served: 0, cover: 0, skill: 0, rate: 0, save: 0, mood: 0, boil: 0 };
  if (!built || !fed) return none;
  const cooks = cooksAt(state, base);
  if (!cooks.length) return none;
  const hands = cooks.reduce((a, s) => a + Math.min(1, workFactor(s)), 0);
  const cover = Math.min(1, (hands * KITCHEN.perCook) / fed);
  const best = Math.max(...cooks.map((s) => skill(s, KITCHEN.skill)));
  const rate = Math.min(KITCHEN.saveMax, KITCHEN.save + KITCHEN.skillStep * Math.max(0, best - KITCHEN.skillFrom));
  const mood = best >= KITCHEN.moodSkillAt ? KITCHEN.moodSkilled : KITCHEN.mood;
  return { built, cooks, wanted: cooksWanted(state, base), fed, served: Math.min(fed, Math.round(fed * cover)), cover, skill: best, rate, save: rate * cover, mood: mood * cover, boil: KITCHEN.boil * cover };
}
// What a resident eats a day here × this (upkeep.js foodUse): 1 without a kitchen or cooks.
export const kitchenEatMult = (state, base) => (hasKitchen(base) ? 1 - kitchenService(state, base).save : 1);
// Is this person fed hot meals at the kitchen today (the first `served` of the people living here, by id)?
export function eatsAtKitchen(state, base, s) {
  const ks = kitchenService(state, base);
  if (!ks.served) return false;
  if (ks.served >= ks.fed) return true;
  const ids = residents(state, base.id).map((x) => x.id).sort((a, b) => a - b);
  return ids.indexOf(s.id) < ks.served;
}

// After the eating (economy.js baseDaily): the day's record. eaten: what the people living here ate.
export function kitchenDaily(state, base, eaten) {
  const ks = kitchenService(state, base);
  if (!ks.built) { delete base.kitchenDay; return; }
  const saved = ks.save > 0 && ks.save < 1 ? Math.max(0, eaten) * ks.save / (1 - ks.save) : 0;
  base.kitchenDay = { day: workDay(state.hour), cooks: ks.cooks.length, served: ks.served, meals: ks.served * 2, saved: Math.round(saved * 100) / 100, cover: Math.round(ks.cover * 100) / 100 };
  if (ks.cooks.length) {
    noteOutput(state, base, "cook", ks.served * 2, "meals");
    noteOutput(state, base, "cook", saved, "foodsaved");
  }
}

// What a cook is doing at hour h (activity.js describeActivity): { text, why } or null outside the cooks' hours.
export function cookActivity(h) {
  if (h < KITCHEN.day[0] || h > KITCHEN.day[1]) return null;
  if (h === 5) return { text: "Cooking breakfast", why: "Up before the others: porridge, eggs and tea on for breakfast at 06:00." };
  if (h === 6) return { text: "Serving breakfast", why: "Breakfast at the kitchen; the cooks eat when everyone is served." };
  if (h === 7) return { text: "Washing up after breakfast", why: "" };
  if (h === 8) return { text: "Serving the hunters' breakfast", why: "The hunters and fishers eat after the dawn hunt." };
  if (h < 16) return { text: "Kitchen work: bread, stock, soaking beans", why: "Between the meals: the bread, the stock pot and tomorrow's beans." };
  if (h < 20) return { text: "Cooking dinner", why: "Dinner is at 20:00." };
  if (h === 20) return { text: "Serving dinner", why: "Dinner at the kitchen; the cooks eat when everyone is served." };
  return { text: "Washing up after dinner", why: "" };
}
