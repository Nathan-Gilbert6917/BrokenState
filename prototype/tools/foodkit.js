// Test helpers for food by type (src/sim/foods.js): the tools set and read food in days of food (2000 kcal), as the
// old generic "food" was, without caring which kinds unless a test says so.
//   food(h)            days of food in a holder (a base, a team, a cargo, a group) or a bare stock
//   setFood(h, days, key = DEFAULT_FOOD, opts)   replaces every food in it with `days` of one kind (lots by its shelf)
//   addDays(h, days, key = DEFAULT_FOOD, opts)   adds `days` of one kind
//   clearFood(h)       takes every food out
//   kindsOf(h)         { key: days } of what it holds
//   jarred(h), setJarred(h, days)   the old "preserved" stock: portions of jarred food
import { FOODS, foodIn, stockOf, addFood, qtyOf, unitsOf } from "../src/sim/foods.js";

// Ration bars keep for years and weigh about what a day of the old generic food did (0.42 kg a day): a test's food
// that never spoils under it and fits a team's packs.
export const DEFAULT_FOOD = "f_rationbar";
export const food = (h) => foodIn(stockOf(h) || {});
export function clearFood(h) {
  const st = stockOf(h);
  for (const k of Object.keys(st)) if (FOODS[k] || k === "food" || k === "preserved") delete st[k];
  if (h && h.foodLots) h.foodLots = {};
}
export function addDays(h, days, key = DEFAULT_FOOD, opts = {}) {
  if (!(days > 0)) return 0;
  return addFood(h, key, qtyOf(key, days), opts);
}
export function setFood(h, days, key = DEFAULT_FOOD, opts = {}) {
  clearFood(h);
  addDays(h, days, key, opts);
}
export function kindsOf(h) {
  const st = stockOf(h) || {};
  const out = {};
  for (const k of Object.keys(st)) if (FOODS[k] && st[k] > 1e-9) out[k] = unitsOf(k, st[k]);
  return out;
}
// The old "preserved" stock in a test: portions of jarred food (a day each).
export const jarred = (h) => unitsOf("f_jarred", (stockOf(h) || {}).f_jarred || 0);
export function setJarred(h, days) {
  const st = stockOf(h);
  delete st.f_jarred; delete st.preserved;
  if (h && h.foodLots) delete h.foodLots.f_jarred;
  addDays(h, days, "f_jarred");
}
