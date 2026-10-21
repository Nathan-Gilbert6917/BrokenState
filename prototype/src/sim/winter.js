// @ts-check
// Winter (the user's request 2026-10-21: "Winters can kill crops easier, food is hard to find in winter wood can be
// found but yields less in winter"): the cold season's numbers for what the land gives, in one table, read where each
// rate is applied (the season tables stay in their own modules; winter's entry in each is here):
//   frost     weather.js cropDamage: in winter frost and a hard freeze kill FROST.winter times as readily (the tender
//             share of a crop, 1 − hardy), in the last FROST.edgeDays of autumn and the first of spring FROST.edge
//             times; and outdoors even a hardy crop can be lost (coldSnap): FROST.hardy a frosty day in those parts of
//             the year, + FROST.snapKill on a night at FROST.snap °C or colder, + FROST.deepKill at FROST.deep or colder,
//             × FROST.cover under deep snow (it blankets them). Under glass (a greenhouse: sheltered) none of it. The
//             farmers' plans read the same function (farming.js climateTable), so they sow for it. About a third of a
//             hardy crop (kale, winter roots, winter wheat) standing outdoors through a whole winter is lost.
//   forage    foraging.js seasonForage: winter WINTER.forage (× 0.5 under snow, as before);
//   game      hunting.js seasonGame (hunts, snares, the hunting cabin): winter WINTER.game (× 1.2 with snow: tracks);
//   fish      hunting.js seasonFish: winter WINTER.fish (frozen water: ice fishing halves it again, as before);
//   wood      woodcutting.js seasonWood (wood trips, and felling through woodwork.js chopRate): winter WINTER.wood
//             (× WOOD.snow under deep snow, as before);
//   scavFood  the food a scavenged find holds in winter (gardens frozen, larders long eaten): scavenge.js searchHour,
//             economy.js scavTrip (the base's scavengers), aiscav.js haulFor (the groups').
// AI parity (docs/adr/0001-ai-parity.md): the groups' food is one number a day (factions.js), WINTER.wild of it from
// the wild (their hunters, foragers and fishers: grouptrips.js groupFoodLand × groupWildSeason): that share follows
// your forage, game and fish season by season, scaled so a year's total is what it was (the groups were tuned to it),
// so their winters are leaner and their autumns fatter. Their wood: grouptrips.js groupWoodLand × seasonWood, yours.
import * as Weather from "./weather.js";

export const WINTER = { forage: 0.08, game: 0.6, fish: 0.5, wood: 0.7, scavFood: 0.85, wild: 0.25 };
export const FROST = { winter: 1.5, edge: 1.3, edgeDays: 10, hardy: 0.004, snap: -8, snapKill: 0.02, deep: -14, deepKill: 0.04, cover: 0.5 };

// The part of the year frost bites hardest: "winter", "edge" (late autumn, early spring) or "".
/** @param {number} dayIdx */
export function frostPhase(dayIdx) {
  const s = Weather.seasonOfDay(dayIdx);
  if (s.key === "winter") return "winter";
  if ((s.key === "autumn" && s.daysLeft < FROST.edgeDays) || (s.key === "spring" && s.dayOfSeason <= FROST.edgeDays)) return "edge";
  return "";
}
// × on frost and a hard freeze for the tender share of a crop.
/** @param {number} dayIdx */
export const frostMult = (dayIdx) => ({ winter: FROST.winter, edge: FROST.edge })[frostPhase(dayIdx)] || 1;
// A cold snap outdoors, hardy crops too: the day's chance (0 when none). d: weather.js's day record (lo, cover).
/** @param {number} dayIdx @param {{ lo: number, cover?: number }} d */
export function coldSnap(dayIdx, d) {
  let p = 0;
  if (frostPhase(dayIdx) && d.lo <= 0) p += FROST.hardy * frostMult(dayIdx);
  if (d.lo <= FROST.snap) p += FROST.snapKill;
  if (d.lo <= FROST.deep) p += FROST.deepKill;
  if ((d.cover || 0) >= 0.5) p *= FROST.cover;
  return Math.round(p * 10000) / 10000;
}

const isWinter = (state, hour = state.hour) => Weather.season(state, hour).key === "winter";
// Scavenged food in winter: a find's food (days, or whole units) × WINTER.scavFood; whole finds stay at least 1.
/** @param {any} state @param {number} q */
export function winterScavFood(state, q, whole = true) {
  if (!(q > 0) || !isWinter(state)) return q;
  return whole ? Math.max(1, Math.round(q * WINTER.scavFood)) : q * WINTER.scavFood;
}

// ---------- AI parity: the groups' food from the wild ----------
// Your wild food by season (the mean over the season of foraging.js seasonForage, hunting.js seasonGame and
// seasonFish; winter's with its usual snow and ice), averaged over the three.
export function wildSeason(key) {
  const forage = { spring: 0.55, summer: 1.025, autumn: 1.025, winter: WINTER.forage * 0.7 }[key];
  const game = { spring: 0.8, summer: 0.9, autumn: 1.25, winter: WINTER.game * 1.15 }[key];
  const fish = { spring: 1.15, summer: 1, autumn: 0.9, winter: WINTER.fish * 0.7 }[key];
  return forage == null ? 1 : (forage + game + fish) / 3;
}
const wildMean = () => (wildSeason("spring") + wildSeason("summer") + wildSeason("autumn") + wildSeason("winter")) / 4;
// × on a group's food today: 1 − wild + wild × the season's wild food against the year's mean (a year's mean 1).
/** @param {any} state */
export function groupWildSeason(state) {
  const k = Weather.season(state).key;
  return Math.round((1 - WINTER.wild + WINTER.wild * wildSeason(k) / wildMean()) * 1000) / 1000;
}
