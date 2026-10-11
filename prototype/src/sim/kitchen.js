// @ts-check
// The Kitchen (buildings.js "canteen"; the older "kitchen" key is the Preserving room, which jars food): a base's
// cookhouse with a cook on the Cook job (economy.js ROLES.cook, work.js work type "meals"). User request 2026-10-10:
// "Add kitchen building" that makes meals real; kitchen-plus (the same day): firewood, part-time fixed cooks, the
// Cooking skill.
//
// What it does (everything scales with `cover`, the share of the people living here a day's cooks can feed):
//   food     everyone fed hot meals eats KITCHEN.save less a day (−10%: soups and stews stretch the stores, nothing is
//            wasted; upkeep.js foodUse × kitchenEatMult, so every forecast and the governor see it too). The best
//            cook's Cooking (data.js SKILLS; it was Farming before the skill) adds KITCHEN.skillStep a point above
//            KITCHEN.skillFrom, up to KITCHEN.saveMax (−13% at Cooking 10); the Cooking perks add to it (skills.js
//            PERK_TREE.cooking: Thrifty Cook, Nothing Wasted).
//   mood     hot meals: +KITCHEN.mood a day (+KITCHEN.moodSkilled with a Cooking 6+ cook; Hearty Portions +0.5) for
//            everyone here (relations.js moodFactors). Only the Kitchen gives it (the Preserving room jars, no meals).
//   water    the meals' water (soup, tea, porridge) is boiled: KITCHEN.boil of the day's drinking is purified
//            (worm.js purifyCap) on the stove's firewood.
//   the worm the kitchen's stoves cook every meat, fish and crop through, cooks on duty or not, while the stove is lit:
//            it does all the cook fire does (worm.js baseCooks), so a base with a lit kitchen needs no cook fire (the
//            governor takes its cook fire down for the utility plot: autopilot.js cookFireDown).
//   firewood the stove burns KITCHEN.wood.stove a day (lit for the worm whether anyone cooks or not) and
//            KITCHEN.wood.meal a meal served (two a person fed: 12 people = 4 + 24 = 28 firewood, 2.8 kg, a day; Low
//            Flame a third less on the meals). Burned at midnight before the day's eating (kitchenFireDaily, economy.js
//            baseDaily) from what the base holds beyond the day's water boiler and heating (they come first). Short of it
//            the stove is cold (base.kitchenCold): cold meals, no saving, no mood, no boiled water, and the worm's food
//            waits for a cook fire as before. It counts in the firewood forecasts (woodcutting.js woodNeed: kitchen).
// Cooks on work priorities (work.js type "meals") are part-time: the Cook type claims only the cooking hours
// (KITCHEN.cookHours: 05:00 breakfast, serving at 06:00, dinner 16–19, serving at 20:00) and the rest of their day goes
// to their other priorities; s.cookHour (the last hour they cooked) counts them as the day's cooks for 24 hours.
// Fixed-role cooks are part-time too (kitchen-plus pick 2):
//   - Manual "Cook + <second job>" (s.cookPlus = the second job's ROLES key, COOK_SECOND): an hourly shift
//     (cookShiftHour, world.js after the work priorities) puts them on Cook in the cooking hours and on their second job
//     the rest of the day. s.role is what they do this hour, so every hourly system (building, crafting, the job trips,
//     the activity line) sees the right job, and the daily systems at midnight (not a cooking hour) count them at the
//     second job, as people on work priorities are counted at their last work; the kitchen counts them by s.cookHour.
//   - Manual "Cook" alone (no second job): the kitchen all day, as before (up before the others to cook breakfast,
//     serving at the mealtimes, bread, stock and washing up between, dinner from 16:00: cookActivity).
//   - The governor's and a steward's cooks: it plans roles every hour (autopilot.js planRoles 5c), so it puts its cooks
//     on Cook in the cooking hours only (the same person each day: whoever cooked last) and plans them like anyone else
//     the rest of the day.
// A cook too ill to work (work factor under KITCHEN.minWork) feeds nobody; a weaker one feeds fewer (× work factor).
// No kitchen, or nobody on Cook: the food is eaten as before (no penalty beyond the worm's raw-food rules).
// The day (kitchenDaily, economy.js after the eating): base.kitchenDay = { day, cooks, served, meals, saved, cover, wood,
// cold } for the base's Kitchen card, and the Work now panel's Cook row (output.js: meals and food saved).
// AI groups (groupworks.js KITCHEN): a group base of KITCHEN size builds one; the people it serves eat 10% less, burn
// the same firewood a head from the group's woodpile, and their groups grow a little faster (no skills by name).
import { MEALS } from "./meals.js"; // the mealtimes (the hunters' late breakfast)
import { atBase, residents, skill, hourOfDay, log } from "./world.js";
import { count } from "./buildings.js";
import { isManaged } from "./work.js";
import { workFactor } from "./health.js";
import { noteOutput, workDay } from "./output.js";
import { hasPerk } from "./skills.js";
import { boilerUse } from "./worm.js";
import { heatUse } from "./upkeep.js";

export const KITCHEN = {
  perCook: 12, save: 0.1, skill: "cooking", skillFrom: 4, skillStep: 0.005, saveMax: 0.13,
  mood: 1, moodSkilled: 1.5, moodSkillAt: 6, boil: 0.25, minWork: 0.35,
  // Firewood (0.1 kg a unit): the stove a day, and a meal (two a person fed a day). Measured 2026-10-10: 28 a day for
  // 12 people, about a quarter of one woodcutter's day on forest land (woodcutting.js WOOD.rate 18 an hour × 6).
  wood: { stove: 4, meal: 1, keepDays: 14 },
  // Cooking perks (skills.js PERK_TREE.cooking).
  perk: { hearty: 0.5, thrifty: 0.02, nowaste: 0.03, bigpot: 18, lowflame: 2 / 3 },
  govFrom: 8, // the governor (and a steward with Building and Farming & food) builds one at a base of 8+ people
  day: [5, 21], // a fixed-role cook's working hours (05:00–21:59)
  cookHours: [5, 6, 16, 17, 18, 19, 20], // the hours a part-time cook cooks: before and at the meals
  cookedFor: 24, // hours a cook who cooked counts as one of the day's cooks (s.cookHour)
  workDay: [6, 22], // the working day a daily job's credit is counted against (jobShare: 16 hours)

};
// The second jobs a fixed "Cook + …" may have (economy.js ROLES keys): the jobs that need no station, lesson or book.
export const COOK_SECOND = ["farm", "scavenge", "wood", "forage", "hunt", "fish", "water", "build", "craft", "guard", "rest"];

// A working kitchen here (a broken one, breakdowns.js, cooks nothing).
export const hasKitchen = (base) => !!base && count(base, "canteen") > 0;
// The job someone counts at for the day (activity.js dayJob: people on priorities are counted at their last work).
export function dayRole(state, s) {
  const t = isManaged(state, s) ? s.task : null;
  if (t && (t.kind === "sched" || t.kind === "emerg") && t.last && state.hour - t.last.hour <= 72) return t.last.role;
  return s.role;
}
export const isCookHour = (h) => KITCHEN.cookHours.includes(((h % 24) + 24) % 24);
// Cooked within the last KITCHEN.cookedFor hours (s.cookHour: work.js planBase, cookShiftHour, cooksHour).
export const cookedLately = (state, s) => s.cookHour != null && state.hour - s.cookHour >= 0 && state.hour - s.cookHour < KITCHEN.cookedFor;
// A fixed cook with a second job ("Cook + Farm"): s.cookPlus, for Manual people only.
export const cookPlusOf = (state, s) => (s && s.cookPlus && COOK_SECOND.includes(s.cookPlus) && !isManaged(state, s) ? s.cookPlus : null);
// Is this person one of the base's cooks (now or today): on Cook, a Cook + second job, or cooked within the day.
export const isCook = (state, s) => s.role === "cook" || !!cookPlusOf(state, s) || cookedLately(state, s);
// What a Manual "Cook + second job" does at hour h here: Cook in the cooking hours (with a kitchen), else the second job.
export const cookShiftRole = (base, s, h) => (hasKitchen(base) && isCookHour(h) ? "cook" : s.cookPlus);
// The cooking hours someone worked in the last KITCHEN.cookedFor hours (s.cookLog: the absolute hours, kept 24 h).
export const cookHoursLately = (state, s) => (Array.isArray(s.cookLog) ? s.cookLog.filter((h) => state.hour - h >= 0 && state.hour - h < KITCHEN.cookedFor).length : 0);
// Someone on Cook this hour at a kitchen: s.cookHour and the hour in s.cookLog (work.js planBase, cooksHour).
export function markCooked(state, s) {
  s.cookHour = state.hour;
  const log = (Array.isArray(s.cookLog) ? s.cookLog : []).filter((h) => state.hour - h < KITCHEN.cookedFor);
  if (log[log.length - 1] !== state.hour) log.push(state.hour);
  s.cookLog = log;
}
// The jobs whose day is not counted once at midnight: the job trips (jobtrips.js: the cooking hours cut a trip short)
// and the hourly ones (building, crafting, the walls) lose the cooking hours by themselves.
const HOURLY_JOBS = new Set(["wood", "forage", "hunt", "fish", "scavenge", "water", "build", "craft", "guard", "rest", "cook"]);
// A part-time cook's credit for the job the day's systems count them at (farming, a workshop station, medic duty,
// teaching, reading, use XP): the share of that job's working day (KITCHEN.workDay, 16 hours) they did not spend at
// the stove: 1 − the cooking hours inside the working day / 16 (the usual 06:00 and 16–20 are 6 hours: 0.625).
// 1 for a full-day job of their own and for the hourly and trip jobs (the cooking hours already cost them those).
export function jobShare(state, s, job = s && s.role) {
  if (!s || HOURLY_JOBS.has(job) || !Array.isArray(s.cookLog)) return 1;
  const [a, b] = KITCHEN.workDay;
  const hrs = s.cookLog.filter((h) => state.hour - h >= 0 && state.hour - h < KITCHEN.cookedFor && ((h % 24) + 24) % 24 >= a && ((h % 24) + 24) % 24 < b).length;
  return hrs ? Math.max(0, 1 - hrs / (b - a)) : 1;
}
// How much of the day's cooking someone did (0–1): a cook on Cook now (or counted at Cook for the day) 1; a part-time
// one their cooking hours of KITCHEN.cookHours (one cook who handed over at noon and the one after: about 1 between them).
export const cookShare = (state, s) => (dayRole(state, s) === "cook" ? 1 : Math.min(1, cookHoursLately(state, s) / KITCHEN.cookHours.length) || (cookedLately(state, s) ? 1 : 0));
export const cooksAt = (state, base) => atBase(state, base.id).filter((s) => (dayRole(state, s) === "cook" || cookedLately(state, s)) && !s.inBed && workFactor(s) >= KITCHEN.minWork);
// Cooks a base's kitchen wants: one per KITCHEN.perCook people living here (0 without a kitchen).
export const cooksWanted = (state, base) => (hasKitchen(base) ? Math.max(1, Math.ceil(residents(state, base.id).length / KITCHEN.perCook)) : 0);
// The stove is cold today (no firewood to spare at midnight: kitchenFireDaily).
export const kitchenCold = (base) => !!base && hasKitchen(base) && base.kitchenCold === true;

// The kitchen's day as if its stove is lit: { built, cooks, wanted, fed, served, cover, skill (the best cook's
// Cooking), rate (the saving at full cover), save (rate × cover), mood, boil, perks }.
function serviceOf(state, base) {
  const built = hasKitchen(base);
  const fed = built ? residents(state, base.id).length : 0;
  const none = { built, cooks: [], main: [], count: 0, wanted: built ? cooksWanted(state, base) : 0, fed, served: 0, cover: 0, skill: 0, rate: 0, save: 0, mood: 0, boil: 0, cold: false };
  if (!built || !fed) return none;
  const cooks = cooksAt(state, base);
  if (!cooks.length) return none;
  const hands = cooks.reduce((a, s) => a + Math.min(1, workFactor(s)) * cookShare(state, s) * (hasPerk(s, "bigpot") ? KITCHEN.perk.bigpot : KITCHEN.perCook), 0);
  const cover = Math.min(1, hands / fed);
  const best = Math.max(...cooks.map((s) => skill(s, KITCHEN.skill)));
  const any = (id) => cooks.some((s) => hasPerk(s, id));
  const perkSave = (any("thrifty") ? KITCHEN.perk.thrifty : 0) + (any("nowaste") ? KITCHEN.perk.nowaste : 0);
  const rate = Math.min(KITCHEN.saveMax, KITCHEN.save + KITCHEN.skillStep * Math.max(0, best - KITCHEN.skillFrom)) + perkSave;
  const mood = (best >= KITCHEN.moodSkillAt ? KITCHEN.moodSkilled : KITCHEN.mood) + (any("hearty") ? KITCHEN.perk.hearty : 0);
  // The day's main cooks (count): the cooks' shares of the day's cooking added up (one who handed over at noon and the
  // one after it: one cook's day between them), the biggest shares first (main), never more than cooked.
  const shares = cooks.map((s) => ({ s, v: cookShare(state, s) })).sort((x, y) => y.v - x.v || x.s.id - y.s.id);
  const count = Math.min(cooks.length, Math.max(1, Math.ceil(shares.reduce((a, x) => a + x.v, 0) - 0.15)));
  return { built, cooks, main: shares.slice(0, count).map((x) => x.s), count, wanted: cooksWanted(state, base), fed, served: Math.min(fed, Math.round(fed * cover)), cover, skill: best, rate, save: rate * cover, mood: mood * cover, boil: KITCHEN.boil * cover, cold: false };
}
// The kitchen's day: as serviceOf, with a cold stove (no firewood) serving nothing: { …, cold: true, served 0, cover 0,
// save 0, mood 0, boil 0 } (the cooks still listed).
export function kitchenService(state, base) {
  const ks = serviceOf(state, base);
  if (!ks.built || !kitchenCold(base)) return ks;
  return { ...ks, served: 0, cover: 0, save: 0, mood: 0, boil: 0, cold: true };
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

// The stove's firewood a day with its stove lit and today's cooks: { stove, meals (two a person served), need, low
// (Low Flame), served }. 0 without a kitchen.
export function kitchenWood(state, base) {
  if (!hasKitchen(base)) return { stove: 0, meals: 0, need: 0, low: false, served: 0 };
  const ks = serviceOf(state, base);
  const low = ks.cooks.some((s) => hasPerk(s, "lowflame"));
  const meals = ks.served * 2 * KITCHEN.wood.meal * (low ? KITCHEN.perk.lowflame : 1);
  const need = Math.round((KITCHEN.wood.stove + meals) * 100) / 100;
  return { stove: KITCHEN.wood.stove, meals: Math.round(meals * 100) / 100, need, low, served: ks.served };
}
// What the day's water boiler and heating will burn here first (they come before the stove).
function woodReserve(state, base) {
  const boil = boilerUse(state, base);
  const heat = heatUse(state, base);
  return (boil.active ? boil.wood * (boil.share ?? 1) : 0) + (heat.total > 0 ? heat.wood : 0);
}
// Can the stove be lit today (firewood beyond the boiler's and the heating's day)? For the governor and the Work tab.
export const kitchenCanLight = (state, base) => hasKitchen(base) && Math.max(0, base.stock.wood || 0) - woodReserve(state, base) + 1e-9 >= kitchenWood(state, base).need;
// Daily at midnight (economy.js baseDaily, before the worm's cooking and the day's eating): the stove burns its day of
// firewood, or goes cold. base.kitchenBurn = { day, wood }; a log line when it goes cold and when it is lit again.
export function kitchenFireDaily(state, base) {
  if (!hasKitchen(base)) { delete base.kitchenCold; delete base.kitchenBurn; return; }
  const w = kitchenWood(state, base);
  const st = base.stock;
  // base.stoveSave: the governor (or a steward with Production) keeps the stove cold in the run-up to the cold while the
  // woodpile is well short of the winter's need (autopilot.js stoveSave): the winter's heating comes first.
  const lit = residents(state, base.id).length > 0 && !base.stoveSave && kitchenCanLight(state, base);
  if (lit) {
    st.wood = Math.max(0, (st.wood || 0) - w.need);
    base.kitchenBurn = { day: workDay(state.hour), wood: w.need };
    if (base.kitchenCold) log(state, `The kitchen at ${base.name} is lit again: hot meals are back.`, "good");
    base.kitchenCold = false;
  } else {
    base.kitchenBurn = { day: workDay(state.hour), wood: 0 };
    if (!base.kitchenCold && residents(state, base.id).length && base.stoveSave) log(state, `The kitchen's stove at ${base.name} is let go cold: the woodpile is kept for the winter's heating (${Math.round(base.stock.wood || 0)} of the ${base.stoveSave} the cold needs). Cold meals until the wood is in.`, "info");
    else if (!base.kitchenCold && residents(state, base.id).length) log(state, `The kitchen at ${base.name} is cold: no firewood to spare for the stove (it needs ${Math.ceil(w.need)} a day after the water boiler and the heating). Cold meals: no food saved, no lift to the mood${count(base, "cookhouse") ? "; the cook fire cooks the game and greens" : ", and nothing cooks the game and greens from infected land"}.`, "danger");
    base.kitchenCold = true;
  }
}

// After the eating (economy.js baseDaily): the day's record. eaten: what the people living here ate.
export function kitchenDaily(state, base, eaten) {
  const ks = kitchenService(state, base);
  if (!ks.built) { delete base.kitchenDay; return; }
  const saved = ks.save > 0 && ks.save < 1 ? Math.max(0, eaten) * ks.save / (1 - ks.save) : 0;
  const wood = base.kitchenBurn && base.kitchenBurn.day === workDay(state.hour) ? base.kitchenBurn.wood : 0;
  base.kitchenDay = { day: workDay(state.hour), cooks: ks.count, served: ks.served, meals: ks.served * 2, saved: Math.round(saved * 100) / 100, cover: Math.round(ks.cover * 100) / 100, wood, cold: !!ks.cold };
  if (ks.cooks.length) {
    noteOutput(state, base, "cook", ks.served * 2, "meals");
    noteOutput(state, base, "cook", saved, "foodsaved");
  }
}

// ---------- the cooks' hours ----------
// Hourly (world.js, after the work priorities, before the stewards and the governor): a Manual "Cook + second job" is
// on Cook in the cooking hours and on the second job the rest of the day. Left alone while they rest sick (sickrest.js
// s.sickWas), are in a hospital bed, or stand their watch or a jail's guard (watch.js, prisoners.js). A second job
// that is not one (an old value) or someone on work priorities drops s.cookPlus.
export function cookShiftHour(state) {
  const h = hourOfDay(state);
  for (const base of state.bases) {
    for (const s of atBase(state, base.id)) {
      if (!s.cookPlus) continue;
      if (!cookPlusOf(state, s)) { delete s.cookPlus; continue; }
      if (s.inBed || s.sickWas || s.govWatch || s.watchWas || s.jailWas) continue;
      if (s.role !== "cook" && s.role !== s.cookPlus) { delete s.cookPlus; continue; } // someone (a steward, the player) gave them another job
      const want = cookShiftRole(base, s, h);
      if (s.role !== want) { s.role = want; s.station = null; }
    }
  }
}
// Hourly, after every role is set (world.js, after the stewards, the watch and the sick): anyone on Cook at a kitchen
// in a cooking hour counts as one of the day's cooks (s.cookHour) for KITCHEN.cookedFor hours.
export function cooksHour(state) {
  if (!isCookHour(hourOfDay(state))) return;
  for (const base of state.bases) {
    if (!hasKitchen(base)) continue;
    for (const s of atBase(state, base.id)) if (s.role === "cook" && !s.inBed) markCooked(state, s);
  }
}
// The role drop-down's choice "cook+farm" (ui/work.js applyRoleChoice): a Manual Cook with a second job.
export function setCookPlus(state, s, second) {
  if (!s || !COOK_SECOND.includes(second)) return false;
  s.cookPlus = second;
  const base = s.location && s.location.kind === "base" ? state.bases.find((b) => b.id === s.location.baseId) : null;
  s.role = base ? cookShiftRole(base, s, hourOfDay(state)) : "cook";
  s.station = null;
  return true;
}

// What a cook is doing at hour h (activity.js describeActivity): { text, why } or null outside the cooks' hours.
export function cookActivity(h) {
  if (h < KITCHEN.day[0] || h > KITCHEN.day[1]) return null;
  if (h === 5) return { text: "Cooking breakfast", why: "Up before the others: porridge, eggs and tea on for breakfast at 06:00." };
  if (h === 6) return { text: "Serving breakfast", why: "Breakfast at the kitchen; the cooks eat when everyone is served." };
  if (h === 7) return { text: "Washing up after breakfast", why: "" };
  if (h === MEALS.lateBreakfast) return { text: "Serving the hunters' breakfast", why: "The hunters and fishers eat when they are back from the dawn trip." };
  if (h < 16) return { text: "Kitchen work: bread, stock, soaking beans", why: "Between the meals: the bread, the stock pot and tomorrow's beans." };
  if (h < 20) return { text: "Cooking dinner", why: "Dinner is at 20:00." };
  if (h === 20) return { text: "Serving dinner", why: "Dinner at the kitchen; the cooks eat when everyone is served." };
  return { text: "Washing up after dinner", why: "" };
}
