// Mealtimes at a base: breakfast and dinner, an hour each (the clock runs by the hour). No imports: the hourly jobs
// (buildings.js construction, crafting.js, repair.js gear repairs) read it without a cycle; activity.js shows it.
//
// - Everyone at a base eats breakfast at 06:00 and dinner at 20:00; hunters and fishers, out on their dawn trip
//   (tripland.js TRIP_JOBS: 06:00–10:00), eat breakfast at 10:00 when they are back. The People tab and the Work now panel show "Eating" then (activity.js).
// - The food and water still come out of the store once a day (economy.js baseDaily): meals change nothing eaten.
// - The jobs that work every hour of the day lose the two meal hours: construction, hand crafting and the gear repairs
//   at the bench stop at 06:00 and 20:00 (22 working hours of 24: MEAL_WORK_SHARE). The jobs with set hours (wood
//   08–18, foraging 09–19, hunting and fishing at dawn and dusk, building repairs 08–20) and the daily jobs (farms,
//   stations, scavenging, teaching, reading) have no meal in their hours: unchanged.
// - The AI groups (groupworks.js) build by crew-days: their crews do MEAL_WORK_SHARE of a day's work as well.
export const MEALS = { breakfast: 6, lateBreakfast: 10, dinner: 20 };
// The meal hours of the jobs that work every hour.
export const MEAL_HOURS = [MEALS.breakfast, MEALS.dinner];
export const isMealHour = (h) => MEAL_HOURS.includes(((h % 24) + 24) % 24);
export const MEAL_WORK_SHARE = (24 - MEAL_HOURS.length) / 24;

// ---------- ration levels per base (wave 2 eating, user pick 4) ----------
// base.rationLevel (the player's, the governor's or a steward's choice; missing = normal) and base.feastDay (a feast on
// that day only, then back to the level). The automatic short rations under a week of food (economy.js base.rationing,
// RATION 60%) still come first. eating.js applies them person by person; upkeep.js foodUse × use, so every forecast,
// the planners and the governor see the same numbers:
//   normal  everyone eats to their own target (80–100% full) at the mealtimes and when hungry: a ration a day.
//   lean    smaller portions, fuller later: target 75, the body gets by on `use` (80%) of a ration; mood −1 a day.
//           Food lasts a quarter longer; nobody goes Hungry (the gauge stays above 50: no work or aim lost).
//   feast   one day: everyone eats to 100 and half as much again (×1.5 the day's food); "A feast" mood +6 (eating.js
//           THOUGHTS). The harvest festival is one (festival.js).
// AI groups (factions.js): the same levels coarsely (lean when short, a feast on the festival day).
export const RATION_LEVELS = {
  normal: { name: "Normal", use: 1, target: null, mood: 0, desc: "Everyone eats at the mealtimes and when hungry, until they are 80–100% full (each their own): about a ration a day." },
  lean: { name: "Lean", use: 0.8, target: 75, mood: -1, desc: "Smaller portions: everyone eats to about 75% full and the body gets by on 80% of a ration. Food lasts a quarter longer; mood −1 a day. Nobody goes hungry enough to work worse." },
  feast: { name: "Feast", use: 1.5, target: 100, mood: 0, desc: "A feast today: everyone eats their fill and half as much again (×1.5 the day's food) and gets \"A feast\" (mood +6 for 3 days). Back to the usual level tomorrow." },
};
// The day of an hour (world.js day is 1-based from hour 0; here only "the same day" matters).
const dayOfHour = (h) => Math.floor(h / 24);
// The level a base eats at now: "short" (economy.js's automatic short rations), "feast" (its feast day), else its
// setting.
export function rationKey(state, base) {
  if (!base) return "normal";
  if (base.rationing) return "short";
  if (base.feastDay != null && base.feastDay === dayOfHour(state ? state.hour : 0)) return "feast";
  return RATION_LEVELS[base.rationLevel] ? base.rationLevel : "normal";
}
// A base's day of food × this (upkeep.js foodUse): lean 0.8, a feast day 1.5 (short rations are economy.RATION's).
export const rationUse = (state, base) => { const k = rationKey(state, base); return k === "short" ? 1 : RATION_LEVELS[k].use; };
// The mealtime for someone on `job` at hour h (activity.js mealAt says the same): "breakfast", "dinner" or null.
export function mealOf(job, h) {
  const hh = ((h % 24) + 24) % 24;
  const b = job === "hunt" || job === "fish" ? MEALS.lateBreakfast : MEALS.breakfast;
  return hh === b ? "breakfast" : hh === MEALS.dinner ? "dinner" : null;
}
