// @ts-check
// Deep loot and what a team keeps (2026-10-13, docs/crawl-balance.md).
//
// 1. Deeper in a city, what a place holds is worth more by the kilo. The outer streets were stripped first and by
//    everyone of the bulky things people need every day (tins, water, scrap); the heart of the city emptied in a day
//    and nobody has been back, so its places still hold what is small and dear (rounds, meds, gun parts,
//    electronics). From block DEEP.from, the supplies a search finds that are worth less than DEEP.bulkVk a kilo come
//    × (1 − bulk × k) (at least bulkMin), those worth DEEP.fineVk a kilo or more × (1 + fine × k), k = the blocks from
//    DEEP.from on (1 at block 3). citycrawl.js quickSearch (by the numbers) and combat.js searchBox (a crawl's
//    building played on the map: b.raid.deep) both use it; a quick search also turns up a cache now and then
//    (citycrawl.js quickSearch, DEEP.cache, cacheChance).
// 2. A team that is full swaps: a find worth more by the kilo than what is already in its cargo, for what its home
//    base needs (wantOf), takes the place of the least wanted cargo (DEEP.swapMargin better at least); what is put
//    down stays in the city (citycrawl.js give).
import { SUPPLIES, supValue, supWeight } from "./data.js";
import { FOODS } from "./foods.js";

export const DEEP = {
  from: 3, bulkVk: 3, fineVk: 10, bulk: 0.2, bulkMin: 0.35, fine: 0.25,
  cache: 0.12, cacheMax: 0.5, cacheAreas: ["pharmacy", "gunshop", "armory", "lockers", "clinic"], cacheRich: 1.5,
  swapMargin: 0.25,
};

// A supply's worth a kilo (data.js value / weight); 0 for what weighs nothing.
export const valuePerKg = (k) => { const w = supWeight(k); return w > 0 ? supValue(k) / w : 0; };
const tier = (k) => { const v = valuePerKg(k); return v >= DEEP.fineVk ? "fine" : v > 0 && v < DEEP.bulkVk ? "bulk" : "mid"; };
export const isFine = (k) => tier(k) === "fine";

// The supplies of one search, shifted for the block it was made on (n). Changes sup in place and returns it.
/** @param {Record<string, number>} sup @param {number} n */
export function deepShift(sup, n) {
  const k = (n || 0) - DEEP.from + 1;
  if (!(k > 0) || !sup) return sup;
  for (const key of Object.keys(sup)) {
    const t = tier(key);
    if (t === "bulk") sup[key] = Math.round(sup[key] * Math.max(DEEP.bulkMin, 1 - DEEP.bulk * k));
    else if (t === "fine") sup[key] = Math.max(1, Math.round(sup[key] * (1 + DEEP.fine * k)));
    if (!(sup[key] > 0)) delete sup[key];
  }
  return sup;
}
// The chance a quick search on block n also turns up a cache (a locker, a stash behind a panel, a medic's bag).
export const cacheChance = (n) => Math.min(DEEP.cacheMax, Math.max(0, DEEP.cache * ((n || 0) - DEEP.from + 1)));

// How much the team's home base wants a supply (× its worth when the team chooses what to carry): food and water by the
// days left, meds and rounds by how many a head; 0.5 for what the base has plenty of.
/** @param {any} base @param {number} people @param {string} key */
export function wantOf(base, people, key) {
  if (!base || !base.stock) return 1;
  const st = base.stock, n = Math.max(1, people || 1);
  const sum = (pred) => Object.entries(st).reduce((a, [k, v]) => a + (pred(k) ? Math.max(0, Number(v) || 0) : 0), 0);
  if (FOODS[key] || key === "food") {
    const days = sum((k) => !!FOODS[k] || k === "food") * 0.5 / n; // about two units a person a day
    return days < 7 ? 3 : days < 20 ? 1.8 : days > 60 ? 0.5 : 1;
  }
  if (key === "water" || key === "rawwater") { const days = (Number(st.water) || 0) / (n * 3); return days < 3 ? 3 : days < 10 ? 1.6 : days > 30 ? 0.5 : 1; }
  if (key === "meds") { const per = (Number(st.meds) || 0) / n; return per < 1 ? 2 : per < 3 ? 1.3 : per > 8 ? 0.6 : 1; }
  if (SUPPLIES[key] && /^a_/.test(key)) { const per = sum((k) => /^a_/.test(k)) / n; return per < 20 ? 1.6 : per > 150 ? 0.6 : 1; }
  return 1;
}
