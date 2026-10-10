// Mealtimes at a base: breakfast and dinner, an hour each (the clock runs by the hour). No imports: the hourly jobs
// (buildings.js construction, crafting.js, repair.js gear repairs) read it without a cycle; activity.js shows it.
//
// - Everyone at a base eats breakfast at 06:00 and dinner at 20:00; hunters and fishers, out at dawn (05–07), eat
//   breakfast at 08:00. The People tab and the Work now panel show "Eating" then (activity.js).
// - The food and water still come out of the store once a day (economy.js baseDaily): meals change nothing eaten.
// - The jobs that work every hour of the day lose the two meal hours: construction, hand crafting and the gear repairs
//   at the bench stop at 06:00 and 20:00 (22 working hours of 24: MEAL_WORK_SHARE). The jobs with set hours (wood
//   08–18, foraging 09–19, hunting and fishing at dawn and dusk, building repairs 08–20) and the daily jobs (farms,
//   stations, scavenging, teaching, reading) have no meal in their hours: unchanged.
// - The AI groups (groupworks.js) build by crew-days: their crews do MEAL_WORK_SHARE of a day's work as well.
export const MEALS = { breakfast: 6, lateBreakfast: 8, dinner: 20 };
// The meal hours of the jobs that work every hour.
export const MEAL_HOURS = [MEALS.breakfast, MEALS.dinner];
export const isMealHour = (h) => MEAL_HOURS.includes(((h % 24) + 24) % 24);
export const MEAL_WORK_SHARE = (24 - MEAL_HOURS.length) / 24;
