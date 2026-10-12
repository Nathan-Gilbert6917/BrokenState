// Mealtimes at a base: breakfast, lunch and dinner, an hour each (the clock runs by the hour). No imports: the hourly
// jobs (buildings.js construction, crafting.js, repair.js gear repairs) read it without a cycle; activity.js shows it.
//
// - Everyone at a base eats breakfast at 06:00, lunch at the lunch hour (12:00 unless the Work tab moves it: LUNCH_HOURS,
//   state.lunchHour) and dinner at 20:00; hunters and fishers, out on their dawn trip (tripland.js TRIP_JOBS:
//   06:00–10:00), eat breakfast at 10:00 when they are back. The People tab and the Work now panel show "Eating" then
//   (activity.js).
// - Lunch (user request 2026-10-12, TIME-03): an hour; everyone eats to their own target (80–100% full, eating.js) and
//   gets a small lift (eating.js EAT.lunchMood: an hour of free time's mood). All work stops for it: the jobs that work
//   every hour (construction, hand crafting, gear and building repairs) lose the hour as they do the other meals, and
//   the people out on a job trip (jobtrips.js) stop where they are and eat from their pack (at least PACK.trip, a
//   day of food, taken out with them): the hour does not count as work on the trip. The guards stay on the walls.
// - The food and water still come out of the store once a day (economy.js baseDaily): meals change nothing eaten.
// - The jobs that work every hour of the day lose the three meal hours: construction, hand crafting and the repairs
//   stop at 06:00, lunch and 20:00 (21 working hours of 24: MEAL_WORK_SHARE). The daily jobs (farms, stations,
//   teaching, reading) are counted at midnight as a day's work: the meals are inside it.
// - The AI groups (groupworks.js) build by crew-days: their crews do MEAL_WORK_SHARE of a day's work as well (their
//   lunch hour too).
export const MEALS = { breakfast: 6, lateBreakfast: 10, lunch: 12, dinner: 20 };
// The hours the Work tab can put lunch at (between the hunters' late breakfast and their dusk trip).
export const LUNCH_HOURS = [11, 12, 13, 14, 15];
const hod = (h) => ((h % 24) + 24) % 24;
/** The lunch hour of this game (state.lunchHour; missing or not one of LUNCH_HOURS: 12:00). @param {any} [state] */
export const lunchHour = (state) => (state && LUNCH_HOURS.includes(state.lunchHour) ? state.lunchHour : MEALS.lunch);
/** @param {any} state @param {number} h */
export function setLunchHour(state, h) {
  const n = Number(h);
  if (!state || !LUNCH_HOURS.includes(n)) return false;
  state.lunchHour = n;
  return true;
}
// The meal hours of the jobs that work every hour (MEAL_HOURS: the default lunch; mealHours: this game's).
export const MEAL_HOURS = [MEALS.breakfast, MEALS.lunch, MEALS.dinner];
/** @param {any} [state] */
export const mealHours = (state) => [MEALS.breakfast, lunchHour(state), MEALS.dinner];
/** @param {number} h @param {any} [state] */
export const isMealHour = (h, state) => mealHours(state).includes(hod(h));
export const MEAL_WORK_SHARE = (24 - MEAL_HOURS.length) / 24;
/** Is hour h (absolute or of the day) the lunch hour? @param {number} h @param {any} [state] */
export const isLunchHour = (h, state) => hod(h) === lunchHour(state);
// Hours of [a, b) (absolute) inside the lunch hour of each day: the part of a trip's work eaten by lunch (jobtrips.js).
/** @param {number} a @param {number} b @param {any} [state] */
export function lunchOverlap(a, b, state) {
  if (!(b > a)) return 0;
  const L = lunchHour(state);
  let o = 0;
  for (let d = Math.floor(a / 24); d * 24 <= b; d++) o += Math.max(0, Math.min(b, d * 24 + L + 1) - Math.max(a, d * 24 + L));
  return o;
}

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
// The mealtime for someone on `job` at hour h (activity.js mealAt says the same): "breakfast", "lunch", "dinner" or null.
/** @param {string} job @param {number} h @param {any} [state] */
export function mealOf(job, h, state) {
  const hh = hod(h);
  const b = job === "hunt" || job === "fish" ? MEALS.lateBreakfast : MEALS.breakfast;
  return hh === b ? "breakfast" : hh === lunchHour(state) ? "lunch" : hh === MEALS.dinner ? "dinner" : null;
}
