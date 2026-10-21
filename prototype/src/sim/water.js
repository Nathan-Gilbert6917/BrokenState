// @ts-check
// Purified and un-purified water (data.js SUPPLIES water / rawwater). Plain helpers (importing only the data and rounds.js), so any
// module can use them (no import cycles).
//
// - Purified water (`water`) is safe to drink: boiled, filtered, treated with tablets, or bottled water found in shops,
//   houses and crates. Un-purified water (`rawwater`) comes from the land: a base's well or spring, wells, a stream,
//   rain catchers, the wells on its claims, prisoners hauling it (economy.js waterProduction), a team filling its
//   containers at a river or lake (orders.js fetchWater), a camp or shelter beside one (staging.js). It weighs the same.
// - A base (economy.js baseDaily, worm.js purifyDaily): each day before drinking a lit water boiler purifies the day's
//   drinking for everyone fed there, each water filter WORM.PURIFY_FILTER a day, a shelter's lit fire like the boiler.
//   People drink purified water first, then un-purified water (rather than go thirsty: the share drunk un-purified
//   carries the worm's eggs of the ground it came from, worm.js); crops are watered with un-purified water first. The
//   tanks and cisterns (economy.js waterCapacity) hold both together, and thirst counts both.
// - A team (needs.js teamNeedsHour, worm.js drinkHour): purified water first; un-purified water is made safe by a water
//   filter carried, a lit camp fire (it also boils WORM.BOIL an hour into purified water while camping), purification
//   tablets (one per WORM.TABS_WATER), or is drunk as it is.
// - Other groups keep a single pool (their f.stock.water: they never meet the worm's water rules); un-purified water
//   sold to them goes into it at about half the price (trade.js).
import { totalRounds, spendAmmo, isRoundKey } from "./rounds.js"; // "ammo" as every round (rounds.js imports only data)
import { SUPPLIES } from "./data.js";
import { FOODS, foodIn, foodSplit, takeFood } from "./foods.js"; // a food item's word after a count ("cans of beans")
export const RAW = "rawwater";
export const WATER_KEYS = ["water", RAW];
const pos = (v) => Math.max(0, Number(v) || 0);
const r2 = (v) => Math.round(v * 100) / 100;

// Both kinds in a stock (a base's stock, a team's supplies or cargo, a camp's stores).
export const waterIn = (o) => (o ? pos(o.water) + pos(o[RAW]) : 0);
// Both kinds a team carries (packed and found).
export const teamWaterIn = (p) => (p ? waterIn(p.supplies) + waterIn(p.cargo && p.cargo.supplies) : 0);
// Un-purified water a team carries.
export const teamRawIn = (p) => (p ? pos(p.supplies && p.supplies[RAW]) + pos(p.cargo && p.cargo.supplies && p.cargo.supplies[RAW]) : 0);

// Takes up to `qty` water from a stock: purified first (drinking), or un-purified first (rawFirst: crops, a fire, a
// still or the preserving room, where it is boiled anyway). Never below zero. Returns { pure, raw, got }.
export function drawWater(o, qty, { rawFirst = false } = {}) {
  const out = { pure: 0, raw: 0, got: 0 };
  let want = pos(qty);
  if (!o || !(want > 0)) return out;
  for (const k of rawFirst ? [RAW, "water"] : ["water", RAW]) {
    const q = Math.min(want, pos(o[k]));
    if (!(q > 0)) continue;
    o[k] = r2(pos(o[k]) - q);
    want -= q;
    if (k === RAW) out.raw += q; else out.pure += q;
  }
  out.pure = r2(out.pure); out.raw = r2(out.raw); out.got = r2(out.pure + out.raw);
  return out;
}
// Takes water from a team: the packed supplies, then the cargo, purified first (both places) unless rawFirst.
// Returns { pure, raw, got }.
export function takeTeamWater(p, qty, { rawFirst = false } = {}) {
  const out = { pure: 0, raw: 0, got: 0 };
  if (!p || !(qty > 0)) return out;
  const cargo = p.cargo && p.cargo.supplies;
  for (const k of rawFirst ? [RAW, "water"] : ["water", RAW]) {
    for (const o of [p.supplies, cargo]) {
      if (!o) continue;
      const q = Math.min(qty - out.got, pos(o[k]));
      if (!(q > 0)) continue;
      o[k] = pos(o[k]) - q;
      out.got += q;
      if (k === RAW) out.raw += q; else out.pure += q;
    }
  }
  return out;
}
// Moves up to `qty` water from one stock into another, purified first (packing a team at a base, a supply run): the
// kinds keep their keys. Returns { pure, raw, got }.
export function moveWater(from, to, qty, opts = {}) {
  const d = drawWater(from, qty, opts);
  if (to) {
    if (d.pure > 0) to.water = r2(pos(to.water) + d.pure);
    if (d.raw > 0) to[RAW] = r2(pos(to[RAW]) + d.raw);
  }
  return d;
}
// "57 water (+30 un-purified)" style text: purified and un-purified apart.
export function waterText(pure, raw, { word = "water" } = {}) {
  const p = Math.floor(pos(pure) + 1e-9), r = Math.floor(pos(raw) + 1e-9);
  return r > 0 ? `${p} ${word} (+${r} un-purified)` : `${p} ${word}`;
}
// A supply in a stock for a recipe (a station, a craft, a field craft), water counting both kinds: the amount there is.
// "ammo": every round there, any calibre (rounds.js totalRounds; a recipe or a cost in generic ammo).
// "food": days of food of any kind (foods.js foodIn), "fresh": days of the food that needs a cold room (what a
// preserving kitchen jars and a still ferments).
export const stockHas = (o, k) => (k === "water" ? waterIn(o) : k === "ammo" ? totalRounds(o) : k === "food" ? foodIn(o) : k === "fresh" ? foodSplit(o).fresh : (o && o[k]) || 0);
const isFresh = (k, f) => !f.stable;
// Uses up `qty` of a supply from a stock for a recipe; water: un-purified first (it is boiled in the work anyway).
export function useStock(o, k, qty) {
  if (k === "water") return drawWater(o, qty, { rawFirst: true }).got;
  if (k === "ammo") return spendAmmo(o, qty).n; // rounds.js: the cheapest rounds first
  if (k === "food" || k === "fresh") return takeFood(o, qty, k === "fresh" ? { only: isFresh } : {}).units; // the soonest to spoil first (foods.js)
  o[k] = (o[k] || 0) - qty;
  return qty;
}
// Takes `qty` of a supply from a stock (a cost paid, a share given), never below zero; water: purified first.
export function takeStock(o, k, qty) {
  if (k === "water") return drawWater(o, qty).got;
  if (k === "ammo") return spendAmmo(o, qty).n; // rounds.js: the cheapest rounds first
  if (k === "food" || k === "fresh") return takeFood(o, pos(qty), k === "fresh" ? { only: isFresh } : {}).units; // days of food (foods.js)
  const q = Math.min(pos(o[k]), pos(qty));
  o[k] = Math.max(0, (o[k] || 0) - qty);
  return q;
}
// A supply key as a word in a text ("12 un-purified water", "12 scrap").
export const keyWord = (k) => (k === RAW ? "un-purified water" : FOODS[k] ? FOODS[k].word : k === "food" ? "days of food" : k === "fresh" ? "days of fresh food" : isRoundKey(k) ? SUPPLIES[k].name : k === "ammo" ? "rounds" : k === "metalsheet" ? "metal sheets" : k); // rounds: "9mm FMJ" (rounds.js); a generic count: "rounds" (any calibre)
