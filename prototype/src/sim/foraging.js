// Foraging: wild food gathered off the land: berries, nuts, mushrooms, wild greens, roots, apples from abandoned
// orchards, now and then a wild hive's honey or a handful of medicinal herbs. Three ways to forage:
//   - the team order "Forage" on a land tile (N hours, like Hunt; orders.js), and a plan step;
//   - a team in camp short of food (under a day): its fit people forage around the camp in daylight (orders.js campHour);
//   - the base job "Forage" (work.js, economy.js ROLES): people gather within 2 tiles of the base 6 hours a day.
// It stretches food; it does not replace farming: a forager brings in about a ration a day around a base in summer,
// more in autumn, little in spring and next to nothing in winter, and the land around runs out when picked hard.
//
// The land (per tile; state.forage[tile] = [level, hour], created on the first picking):
//   abundance = terrain (forest 1, farmland 0.8, hills 0.6, mountains 0.35, suburbs 0.3: overgrown gardens and fruit
//               trees, city 0.08) × 1.15 by a river or lake (berry thickets, cattails) × a site (farms, ranches and
//               barns 1.3: orchards and gardens gone wild; cabins, lodges, campgrounds 1.1) × (1 − 0.5 × infection)
//               × hive land 0.5 (its red ring 0.25)
//   level     = 1 untouched; each ration taken lowers it by 1 / (DEPLETE × the tile's abundance, at least 0.15):
//               a forest tile gives about 40 rations from full before it is stripped; it grows back toward 1 with a
//               half-life of HALF_LIFE days (most of it back within a season). Unlike a site's loot, it comes back.
// Season (weather.js; 28 days each): spring 0.35 → 0.75 (greens and shoots, then the first strawberries), summer
//   0.95 → 1.1 (berries), autumn 1.25 → 0.8 (nuts, apples, mushrooms and roots, until the frosts), winter 0.08
//   (winter.js WINTER.forage: rose hips and roots; × 0.5 under snow). Time of day: daylight (07–18) 1, dawn and dusk (05–06, 19) 0.6, night
//   0.1. A storm or blizzard × 0.5.
// People: a forager = 0.6 + 0.05 × (0.55 Farming + 0.45 Scouting) (Farming: knowing the plants; Scouting: finding
//   them) × 1.25 with the Forager perk × their work factor (illness), × 0.5 when badly hurt (under 40 health).
//   On one tile the best counts 1, the next 0.9, 0.8, … (they get in each other's way), never below 0.4.
// Rations an hour = RATE (0.3) × abundance × level × season × time × weather × the team's foragers.
//   Expect: one average forager (skill ~4: × 0.8), 8 daylight hours in a summer forest, ~2 food; three of them
//   ~5–6; autumn a fifth more; farmland four fifths; a town next to nothing.
// Finds and risks (per forager-hour of daylight foraging): medicinal herbs 1% (spring to autumn: 1 meds), a wild
//   hive 0.4% (summer and autumn, forest and farmland: 2 preserved food, honey keeps), and a mistaken mushroom
//   0.25% (summer and autumn; × (1 − skill/20), at least a fifth): dysentery, mild (health.js).
// Danger: foraging is time on one tile, so it builds field Heat like any work on the spot (fieldheat.js, ×1) and the
//   dead and raiders find foragers like they find a camp.
// Foraged food is by kind (foods.js, FORAGE_MIX by the season: wild greens, mushrooms and roots in spring, berries in
// summer, apples, nuts, mushrooms and roots in autumn, roots and rose hips in winter), weighing what it weighs (greens
// and berries are heavy for their food: 3–7 kg a day of food, nuts light): fresh, so it spoils in days (nuts keep for
// months), at a base the Kitchen makes meals of it and the drying racks and the preserving room take it (storage.js).
// Gathered on infected ground it is an egg lot (worm.js). A wild hive's honey is honey (it never spoils).
import { log, skill, atBase } from "./world.js";
import { partyMembers, partyTile, tileLabel, teamName, cargoRoom, carried, planPath, partySpeed, clockText } from "./parties.js";
import { hasPerk, gainXp, USE } from "./skills.js";
import { zombieToughness } from "./hives.js";
import * as Weather from "./weather.js";
import { workFactor, addCondition } from "./health.js";
import { SUPPLIES } from "./data.js";
import { econStats, farmFoodPerDay } from "./farming.js";
import { foodUse } from "./upkeep.js"; // landFoodGap: everyone fed here
import { edibleFood } from "./storage.js";
import { huntInfo, huntProblem, fishProblem, fishKit, expectFish, fishSpot, partyHuntMix } from "./hunting.js";
import { cropEggs } from "./worm.js"; // the worm: forage from infected ground carries its eggs
import { FOODS, addFood, typedFood, unitsOf, qtyOf, foodIn, foodText } from "./foods.js"; // forage by kind
import { sumRecs } from "./rounds.js"; // rounds by calibre
import { noteOutput } from "./output.js"; // the base's Work now panel: what each job brought in a day (activity.js)
import { workLand, distFactor, walkMult, tileFactor } from "./tripland.js"; // the Forage job in trips: the land and its walking (jobtrips.js)
import { WINTER } from "./winter.js"; // winter's forage (call-time only)
import { cutOffWhy } from "./poirooms.js"; // a camp inside a POI cut off: nobody leaves its map (issue #71; call-time only)

// ---------- numbers ----------
export const FORAGE = {
  rate: 0.3,                 // rations a forager-hour: average forager, untouched forest, high summer, daylight
  deplete: 40,               // rations a full tile of abundance 1 gives before it is stripped
  halfLife: 10,              // days for the picked land to grow half back
  minHours: 0.5, maxHours: 24, defHours: 8, // in half hours (the user's request 2026-10-26: "Minimum is 30 min orders"; 2 before)
  weights: [1, 0.9, 0.8, 0.7, 0.6, 0.5], floorWeight: 0.4,
  dusk: 0.6, night: 0.1, storm: 0.5,
  hurt: 40, hurtMult: 0.5,   // under this health a forager counts half
  camp: { share: 0.4, health: 50, below: 1 }, // a camp short of food (under `below` days) forages: its fit people, in daylight, a share of each hour
  herbs: 0.01, honey: 0.004, honeyFood: 2, mushroom: 0.0025, mushroomSev: [12, 28],
  // The Forage job: hours a day; no head-count cap (tune-jobcaps: it was 3, 4 at 12+ people). Each forager takes the
  // best tile left and strips it (a forest tile ~40 rations, half back in 10 days), so a crowd yields less each.
  // How many go is sized to the need (landFoodHands): the day's eating and refilling the stores, less the plots.
  base: { radius: 2, hours: 6 },
  refill: 20,                // landFoodGap: the stores are refilled to the goal over this many days
};
// What a day's gathering is by the season: shares of the calories (foods.js items).
export const FORAGE_MIX = {
  spring: { f_wildgreens: 45, f_mushrooms: 20, f_roots: 25, f_berries: 10 },
  summer: { f_berries: 55, f_wildgreens: 20, f_roots: 15, f_mushrooms: 10 },
  autumn: { f_apples: 25, f_nuts: 30, f_mushrooms: 15, f_roots: 20, f_berries: 10 },
  winter: { f_roots: 70, f_berries: 20, f_nuts: 10 },
};
const mixOf = (state, hour) => FORAGE_MIX[seasonKey(state, hour)] || FORAGE_MIX.summer;
// Kg a day of food (2000 kcal) of the season's forage weighs (what a team can carry home).
export function forageKg(state, hour = state.hour) {
  const m = mixOf(state, hour);
  const w = Object.values(m).reduce((a, v) => a + v, 0);
  return Object.entries(m).reduce((a, [k, v]) => a + (v / w) * (FOODS[k].kg / unitsOf(k, 1)), 0);
}
// `rations` days of the season's forage as items (every kind of the mix in its share: no dice).
export const forageItems = (state, rations, hour = state.hour) => typedFood(state, mixOf(state, hour), rations, { whole: false, kinds: 99 });
// Forage gathered on `tile` into a holder (a team's cargo, a base): egg lots on infected ground. Returns the items.
export function addForage(state, h, rations, tile, hour = state.hour) {
  const items = forageItems(state, rations, hour);
  const egg = tile != null && cropEggs(state, tile);
  for (const [k, q] of Object.entries(items)) addFood(h, k, q, { state, egg });
  return items;
}
export const FORAGE_TERRAIN = { forest: 1, plains: 0.8, hills: 0.6, mountain: 0.35, suburb: 0.3, city: 0.08, water: 0 };
// What foraging turns up by season (the summary's words; the yields are all just food).
export const FORAGE_FINDS = {
  spring: ["wild greens", "nettles", "fiddleheads", "morels", "early strawberries"],
  summer: ["blackberries", "raspberries", "blueberries", "wild plums", "greens"],
  autumn: ["apples", "walnuts", "hazelnuts", "mushrooms", "acorns", "roots"],
  winter: ["rose hips", "roots dug from the frozen ground", "frozen crab apples"],
};
const r1 = (x) => Math.round(x * 10) / 10;
const first = (s) => s.name.split(" ")[0];
const SITE_BONUS = (type) => (/farm|ranch|barn|orchard/.test(type || "") ? 1.3 : /cabin|lodge|camp|ranger/.test(type || "") ? 1.1 : 1);

// ---------- the land ----------
export function forageAbundance(state, tile) {
  const t = state.tiles[tile];
  if (!t || (t.terrain === "water" && !t.bridge)) return 0;
  let a = FORAGE_TERRAIN[t.terrain] ?? 0.4;
  if (t.river || state.grid.neighbors(tile).some((n) => state.tiles[n] && state.tiles[n].terrain === "water")) a *= 1.15;
  if (t.loc) a *= SITE_BONUS(t.loc.type);
  a *= 1 - 0.5 * Math.max(0, Math.min(1, t.infection || 0));
  const tough = state.hives ? zombieToughness(state, tile) : 0;
  if (tough) a *= tough >= 3 ? 0.25 : 0.5;
  return a;
}
export function forageLevel(state, tile, hour = state.hour) {
  const r = state.forage && state.forage[tile];
  if (!r) return 1;
  const days = Math.max(0, hour - r[1]) / 24;
  return 1 - (1 - r[0]) * Math.pow(0.5, days / FORAGE.halfLife);
}
const depletePer = (state, tile) => 1 / (FORAGE.deplete * Math.max(0.15, forageAbundance(state, tile)));
// Takes `rations` off a tile's level.
export function takeForage(state, tile, rations) {
  if (!(rations > 0)) return;
  const store = state.forage || (state.forage = {});
  store[tile] = [Math.max(0, Math.round((forageLevel(state, tile) - rations * depletePer(state, tile)) * 1e4) / 1e4), state.hour];
}
export const forageWord = (v) => (v >= 0.6 ? "plenty" : v >= 0.3 ? "some" : v >= 0.08 ? "scarce" : "none");

// ---------- season, hour, weather ----------
export function seasonForage(state, hour = state.hour) {
  const s = Weather.season(state, hour);
  const f = Math.max(0, Math.min(1, (s.dayOfSeason - 1) / 27));
  if (s.key === "spring") return 0.35 + 0.4 * f;
  if (s.key === "summer") return 0.95 + 0.15 * f;
  if (s.key === "autumn") return 1.25 - 0.45 * f;
  return WINTER.forage * ((Weather.weather(state, hour).snowCover || 0) >= 0.3 ? 0.5 : 1); // winter.js
}
export function forageTime(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 7 && h <= 18) return 1;
  if (h === 5 || h === 6 || h === 19) return FORAGE.dusk;
  return FORAGE.night;
}
const daylight = (hour) => forageTime(hour) >= 1;
const weatherMult = (state, hour, tile) => (Weather.weather(state, hour, tile).severe ? FORAGE.storm : 1); // a storm over that tile (weather.js)
const seasonKey = (state, hour = state.hour) => Weather.season(state, hour).key;

// ---------- people ----------
export const foragerSkill = (s) => 0.55 * skill(s, "farming") + 0.45 * skill(s, "scouting");
export function foragerMult(s) {
  let m = (0.6 + 0.05 * foragerSkill(s)) * (hasPerk(s, "forager") ? 1.25 : 1);
  m *= Math.max(0, Math.min(1.1, workFactor(s)));
  if ((s.health ?? 100) < FORAGE.hurt) m *= FORAGE.hurtMult;
  return m;
}
// The team's foragers on one tile: the best counts 1, then 0.9, 0.8 … (at least 0.4 each).
export function foragePower(members) {
  const ms = members.map(foragerMult).sort((a, b) => b - a);
  return ms.reduce((a, m, i) => a + m * (FORAGE.weights[i] ?? FORAGE.floorWeight), 0);
}

// ---------- rates and estimates ----------
// Rations an hour on this tile at this level for a team of power `power` (no randomness).
export function forageRate(state, tile, hour, power, level = forageLevel(state, tile, hour)) {
  return FORAGE.rate * forageAbundance(state, tile) * level * seasonForage(state, hour) * forageTime(hour) * weatherMult(state, hour, tile) * power;
}
// Expected haul of `hours` of foraging from startHour, the land depleting as it goes; room = kg the team can still
// carry (the haul is capped by it; all = what was gathered).
export function expectForage(state, members, tile, hours, startHour = state.hour, room = Infinity, power = foragePower(members)) {
  let level = forageLevel(state, tile, startHour), rations = 0;
  const per = depletePer(state, tile);
  for (let h = 1; h - 1 < hours - 1e-9; h++) { // a half hour at the end: half an hour's
    const r = forageRate(state, tile, startHour + h, power, level) * Math.min(1, hours - h + 1);
    rations += r;
    level = Math.max(0, level - r * per);
  }
  const kept = Math.min(rations, Math.max(0, room) / forageKg(state, startHour));
  return { rations: r1(kept), all: r1(rations), levelAfter: level, perHour: hours ? kept / hours : 0 };
}
// The tile panel's and team panel's line: what the land holds and what foraging would bring.
export function forageInfo(state, tile, { members = null, hours = FORAGE.defHours, startHour = state.hour, room = Infinity } = {}) {
  const abundance = forageAbundance(state, tile);
  const level = forageLevel(state, tile);
  const season = seasonForage(state, startHour);
  const out = { abundance, level, season, word: forageWord(abundance * level * Math.min(1, season)), seasonKey: seasonKey(state, startHour) };
  if (members && members.length) out.est = expectForage(state, members, tile, hours, startHour, room);
  return out;
}
// Why a team cannot forage here ("" = it can).
export function forageProblem(state, p, tile = partyTile(p)) {
  const t = state.tiles[tile];
  if (!t || (t.terrain === "water" && !t.bridge)) return "not on open water.";
  if (!partyMembers(state, p).length) return "nobody to forage.";
  if (forageAbundance(state, tile) < 0.02) return "nothing grows here (the dead own this ground).";
  return "";
}

// ---------- one hour of foraging (orders.js taskHour, and campHour at a share) ----------
// Gathers into the team's cargo (as much as fits), rolls the finds and the risk. share: the part of the hour spent
// foraging (1 for the order; FORAGE.camp.share in camp). Returns the rations gathered this hour.
function gatherHour(state, p, members, got, share = 1) {
  const tile = partyTile(p);
  if (!members.length) return 0;
  const power = foragePower(members) * share;
  const rate = forageRate(state, tile, state.hour, power);
  if (!(rate > 0)) return 0;
  // A good hour or a poor one: 40% to 160% of the expected.
  const amount = Math.round(rate * (0.4 + 1.2 * state.rng.next()) * 100) / 100;
  const fit = Math.max(0, cargoRoom(state, p) / forageKg(state));
  const kept = Math.max(0, Math.min(amount, fit));
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  if (kept > 0) addForage(state, p.cargo, kept, tile); // foods.js: by the season; worm.js: an egg lot on land at CROP_MIN+ infection (a camp fire boils it)
  got.rations += kept;
  got.left += amount - kept;
  takeForage(state, tile, amount);
  const es = econStats(state);
  es.foragedField = (es.foragedField || 0) + kept; // the teams' foraging (the base job counts in es.foraged)
  // Finds and risks, by the people out there this hour (daylight work only).
  if (daylight(state.hour)) {
    const key = seasonKey(state);
    const terr = state.tiles[tile].terrain;
    const people = members.length * share;
    if (key !== "winter" && state.rng.chance(Math.min(0.5, FORAGE.herbs * people))) {
      p.cargo.supplies.meds = (p.cargo.supplies.meds || 0) + 1;
      got.herbs = (got.herbs || 0) + 1;
    }
    if ((key === "summer" || key === "autumn") && (terr === "forest" || terr === "plains") && state.rng.chance(Math.min(0.5, FORAGE.honey * people))) {
      addFood(p.cargo, "f_honey", qtyOf("f_honey", FORAGE.honeyFood), { state });
      got.honey = (got.honey || 0) + 1;
    }
    if (key === "summer" || key === "autumn") {
      for (const s of members) {
        const careless = Math.max(0.2, 1 - foragerSkill(s) / 20);
        if (state.rng.chance(FORAGE.mushroom * careless * share)) {
          addCondition(state, s, "dysentery", "after eating a mushroom picked in the wild", { sev: state.rng.int(FORAGE.mushroomSev[0], FORAGE.mushroomSev[1]) });
          (got.sick || (got.sick = [])).push(s.id);
        }
      }
    }
  }
  for (const s of members) { gainXp(state, s, "farming", 0.5 * share); gainXp(state, s, "scouting", 0.3 * share); }
  return kept;
}
export function forageHour(state, p, share = 1) { // share: of the hour (a half hour)
  const t = p.task;
  const got = t.got || (t.got = { rations: 0, left: 0 });
  const members = partyMembers(state, p);
  if (!members.length) { got.stopped = "nobody left to forage."; return false; }
  gatherHour(state, p, members, got, share);
  return true;
}
// A team in camp (orders.js campHour): its fit people forage around the camp in daylight, part of the hour.
export function campForageHour(state, p) {
  if (!daylight(state.hour) || !p.task) return 0;
  // Only while the team is short of food: a well-fed camp rests (and carries home what its plan expected).
  const all = partyMembers(state, p);
  if (!all.length || carried(p, "food") / all.length >= FORAGE.camp.below) return 0;
  const members = all.filter((s) => s.health >= FORAGE.camp.health && !s.woundInfected && workFactor(s) >= 0.35);
  if (!members.length || forageAbundance(state, partyTile(p)) < 0.02) return 0;
  const got = p.task.forage || (p.task.forage = { rations: 0, left: 0 });
  return gatherHour(state, p, members, got, FORAGE.camp.share);
}
const findsText = (got) => [got.herbs ? `${got.herbs === 1 ? "a handful" : `${got.herbs} handfuls`} of medicinal herbs (${got.herbs} meds)` : "", got.honey ? `${got.honey === 1 ? "a wild hive's honey" : `${got.honey} wild hives' honey`} (${got.honey * FORAGE.honeyFood} days of food in honey)` : ""].filter(Boolean).join(" and ");
const sickText = (state, got) => (got.sick && got.sick.length ? ` ${got.sick.map((id) => state.survivors.find((s) => s.id === id)).filter(Boolean).map(first).join(" and ")} ate a bad mushroom and fell ill.` : "");
export function forageWhat(state, hour = state.hour) {
  const list = FORAGE_FINDS[seasonKey(state, hour)] || FORAGE_FINDS.summer;
  const d = Math.floor(hour / 24);
  return [list[d % list.length], list[(d + 2) % list.length]].join(" and ");
}
export function forageSummary(state, p, t) {
  const got = t.got || { rations: 0, left: 0 };
  const tile = partyTile(p);
  const left = got.left >= 1 ? ` No room to carry ${Math.floor(got.left)} more.` : "";
  const finds = findsText(got);
  const word = forageWord(forageAbundance(state, tile) * forageLevel(state, tile) * Math.min(1, seasonForage(state)));
  p.lastHaul = { kind: "forage", rations: got.rations, hour: state.hour };
  const stop = got.stopped ? ` Stopped: ${got.stopped}` : "";
  if (got.rations >= 1) log(state, `${teamName(state, p)} foraged near ${tileLabel(state, tile)}: ${Math.floor(got.rations)} days of food (${forageWhat(state)}).`, "good");
  return got.rations >= 0.5
    ? `Foraged ${clockText(t.worked ?? t.done)}: ${r1(got.rations)} days of food (${forageWhat(state)})${finds ? `, and ${finds}` : ""}.${left}${sickText(state, got)} Left to gather here: ${word}.${stop}`
    : `Foraged ${clockText(t.worked ?? t.done)} and found next to nothing${seasonKey(state) === "winter" ? " (winter: little grows)" : ""}.${finds ? ` Still: ${finds}.` : ""}${sickText(state, got)} Left to gather here: ${word}.${stop}`;
}
// What a camp gathered (orders.js finishTask, the break-camp line).
export function campForageNote(state, p, t) {
  const got = t && t.forage;
  if (!got || !(got.rations >= 0.5 || got.herbs || got.honey || (got.sick && got.sick.length))) return "";
  const finds = findsText(got);
  return ` Foraged around the camp: ${r1(got.rations)} days of food${finds ? `, ${finds}` : ""}.${sickText(state, got)}`;
}

// ---------- the Forage job at a base ----------
// The best tiles around a base, by what they would give now.
export function baseForageTiles(state, base, hour = state.hour) {
  return state.grid.within(base.tile, FORAGE.base.radius).filter((id) => forageAbundance(state, id) >= 0.05)
    .map((id) => ({ id, v: forageAbundance(state, id) * forageLevel(state, id, hour) }))
    .sort((a, b) => b.v - a.v || a.id - b.id);
}
// The tile the base's foragers go to (jobtrips.js): the best of its land by what a day there gives, walking included
// (tripland.js distFactor): { id, v, d, f } or null.
export function forageTripTile(state, base, hour = state.hour) {
  let best = null;
  for (const id of workLand(state, base.tile)) {
    const a = forageAbundance(state, id);
    if (a < 0.05) continue;
    const d = state.grid.distance(base.tile, id), f = tileFactor(state, base, "forage", id, d, walkMult(state)), v = a * forageLevel(state, id, hour);
    if (!best || v * f > best.v * best.f + 1e-12 || (Math.abs(v * f - best.v * best.f) <= 1e-12 && id < best.id)) best = { id, v, d, f };
  }
  return best;
}
// Expected food a forager brings in a day at this base now (for the job's "worth it", the panels, the autopilot), from
// the tile they would go to, its walk counted.
export function baseForageDay(state, base, s = null, hour = state.hour) {
  const t = forageTripTile(state, base, hour);
  if (!t) return 0;
  const m = s ? foragerMult(s) : 0.8;
  const dayStart = hour - (hour % 24);
  let r = 0;
  for (let i = 0; i < FORAGE.base.hours; i++) r += forageRate(state, t.id, dayStart + 9 + i * 2, m);
  return r * t.f;
}
export const FORAGE_WORTH = 0.3; // a forager must be expected to bring in this much a day for the job to be open
export const FORAGE_SHORT = 25;  // the Forage job (work.js) opens while the base has less food than this many days
export function forageWorkWhy(state, base) {
  const co = cutOffWhy(state, base); // poirooms.js (#71): a cut-off camp's people cannot leave its map
  if (co) return co;
  const d = baseForageDay(state, base);
  if (d < FORAGE_WORTH) return seasonKey(state) === "winter" ? "winter: almost nothing to gather" : "the land around is picked clean or bare";
  return "";
}
// Food a day a base wants from the land (the land jobs' sizing, tune-jobcaps: hunt, fish and forage have no fixed
// cap): the day's eating for everyone fed here (upkeep.js foodUse) plus refilling the stores to `goalDays` of it over
// FORAGE.refill days, less what the plots bring in a day over the next month (farming.js farmFoodPerDay).
export function landFoodGap(state, base, goalDays) {
  const use = foodUse(state, base).total;
  return Math.max(0, use + Math.max(0, goalDays * use - edibleFood(base)) / FORAGE.refill - farmFoodPerDay(state, base));
}
// Hands that bring in the land food gap at `each` a day (at most `max`): the Forage, Hunt and Fish jobs' room (work.js)
// and the governor's crews (autopilot.js). Callers ask only while the job is open (food short of its goal), so at
// least one while the land gives anything: the plots' coming harvests can cover the gap on paper (a summer crop due in
// three weeks) while the stores are down to days.
export function landFoodHands(state, base, goalDays, each, max = 40) {
  if (!(each > 0)) return 0;
  return Math.max(1, Math.min(max, Math.ceil(landFoodGap(state, base, goalDays) / each - 1e-9)));
}
// The Forage job's room: foragers to close the land food gap (no fixed cap; the land thins as they pick it).
export const forageWorkCap = (state, base, goalDays = FORAGE_SHORT) => landFoodHands(state, base, goalDays, baseForageDay(state, base));
// One forager's trip (jobtrips.js): `hours` of the old job's hours (the walk already out of them) on `tile`, read at
// `hour`. The land thins by what they pick; now and then herbs (meds) or honey; a bad mushroom eaten out there.
// Returns { food, herbs, honey, sick } (the food and finds come home with them).
export function forageTrip(state, base, s, tile, hours, hour) {
  const m = foragerMult(s) * Math.min(1, workFactor(s));
  const amount = Math.round(forageRate(state, tile, hour, m) * hours * (0.6 + 0.8 * state.rng.next()) * 100) / 100;
  takeForage(state, tile, amount);
  const got = { food: amount, herbs: 0, honey: 0, sick: false };
  const key = seasonKey(state, hour);
  const terr = state.tiles[tile].terrain;
  if (key !== "winter" && state.rng.chance(FORAGE.herbs * hours)) got.herbs++;
  if ((key === "summer" || key === "autumn") && (terr === "forest" || terr === "plains") && state.rng.chance(FORAGE.honey * hours)) got.honey++;
  if ((key === "summer" || key === "autumn") && state.rng.chance(FORAGE.mushroom * hours * Math.max(0.2, 1 - foragerSkill(s) / 20))) {
    addCondition(state, s, "dysentery", "after eating a mushroom picked in the wild", { sev: state.rng.int(FORAGE.mushroomSev[0], FORAGE.mushroomSev[1]) });
    got.sick = true;
  }
  const share = hours / FORAGE.base.hours;
  gainXp(state, s, "farming", USE.forage * share); // skills.js
  gainXp(state, s, "scouting", USE.forageScout * share);
  return got;
}
// Daily (hunting.js huntingDaily, from economy.js baseDaily): the Forage job's day is in (its trips brought the food
// home through the day, jobtrips.js): the day's total for the panels and the log. Returns { rations, herbs, honey, sick }
// or null with nobody on the job.
export function foragingDaily(state, base) {
  const people = atBase(state, base.id).filter((s) => s.role === "forage" && !s.inBed && workFactor(s) >= 0.35);
  const day = (base.tripTally && base.tripTally.day === Math.floor((state.hour - 1) / 24) && base.tripTally.forage) || null;
  if (!people.length && !day) return null;
  const got = { rations: day ? r1(day.food || 0) : 0, left: 0, herbs: day ? day.herbs || 0 : 0, honey: day ? day.honey || 0 : 0, sick: day ? day.sick || [] : [] };
  base.foragedToday = r1(got.rations);
  if (!day) noteOutput(state, base, "forage", 0, "food");
  const who = day ? day.who.map((id) => people.find((x) => x.id === id) || null).filter(Boolean) : people;
  if (got.rations >= 1 || got.herbs || got.honey) {
    const finds = findsText(got);
    log(state, `${(who.length ? who : people).map(first).join(" and ")} foraged around ${base.name}: ${r1(got.rations)} days of food (${forageWhat(state, state.hour - 12)})${finds ? `, and ${finds}` : ""}.`, "good");
  }
  return got;
}

// ---------- food from the land: hunt, fish or forage (the autopilot, the alerts, the team panel) ----------
// Directions on the map, from one tile to another.
const DIRS = ["east", "southeast", "south", "southwest", "west", "northwest", "north", "northeast"];
export function dirWord(state, from, to) {
  if (from === to) return "here";
  const [ax, ay] = state.grid.toPixel(from, 1), [bx, by] = state.grid.toPixel(to, 1);
  const a = Math.atan2(by - ay, bx - ax);
  return DIRS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}
const TERRAIN_WORD = { forest: "forest", plains: "farmland", hills: "hills", mountain: "mountains", suburb: "suburbs", city: "city" };
// What the land around a team offers for food now: hunting, fishing and foraging on its tile and the tiles within
// `range`, with what each would bring in `hours` and the walk there. Best first by food an hour (walk included).
// { kind: "hunt" | "fish" | "forage", tile, rations, hours, travel, dist, dir, score }.
export function landFoodOptions(state, p, { range = 1, hours = FORAGE.defHours, from = partyTile(p), startHour = state.hour, walk = true, kinds = ["forage", "hunt", "fish"] } = {}) {
  const members = partyMembers(state, p);
  if (!members.length) return [];
  const room = cargoRoom(state, p);
  const out = [];
  const power = foragePower(members);
  const kit = fishKit(members, (p.cargo && p.cargo.gear) || []);
  const ammo = sumRecs(p.supplies, p.cargo && p.cargo.supplies); // rounds by key: each gun hunts with its own calibre (ammo.js)
  const huntOk = kinds.includes("hunt") && !/hunting weapon/.test(huntProblem(state, p, from));
  for (const id of state.grid.within(from, range)) {
    const t = state.tiles[id];
    if (!t || t.terrain === "water" || t.hive) continue;
    if (id !== from && state.hives && zombieToughness(state, id) >= 3) continue;
    const dist = state.grid.distance(from, id);
    let travel = 0;
    if (id !== from) {
      if (walk) {
        const res = planPath(state, from, id, p.vehicle);
        if (!res) continue;
        travel = res.cost / Math.max(0.3, partySpeed(p));
      } else travel = dist * 3;
    }
    const at = startHour + Math.round(travel);
    const push = (kind, rations) => { if (rations > 0) out.push({ kind, tile: id, rations: r1(rations), hours, travel: r1(travel), dist, dir: dirWord(state, from, id), terrain: t.terrain, score: rations / (hours + travel) }); };
    if (kinds.includes("forage") && forageAbundance(state, id) >= 0.02) push("forage", expectForage(state, members, id, hours, at, room, power).rations);
    if (huntOk && !huntProblem(state, p, id)) push("hunt", (huntInfo(state, id, { members, ammo, arrows: carried(p, "arrows"), mix: partyHuntMix(state, p), hours, startHour: at, room }).est || { rations: 0 }).rations);
    if (kinds.includes("fish") && fishSpot(state, id) && kit.power && !fishProblem(state, p, id)) push("fish", expectFish(state, kit, id, hours, at, room).rations);
  }
  return out.sort((a, b) => b.score - a.score || a.dist - b.dist || a.tile - b.tile);
}
const KIND_VERB = { forage: "forage", hunt: "hunt", fish: "fish" };
// One line for an alert or a panel: "forage or hunt nearby: forest to the east (~5 food in 8h of foraging)".
export function landFoodHint(state, p, opts = {}) {
  const list = landFoodOptions(state, p, { range: 2, walk: false, ...opts });
  if (!list.length || list[0].rations < 1) return "";
  const b = list[0];
  const kinds = [...new Set(list.filter((x) => x.rations >= 1).slice(0, 4).map((x) => KIND_VERB[x.kind]))];
  const where = b.dist === 0 ? `right here (${TERRAIN_WORD[b.terrain] || b.terrain})` : `${TERRAIN_WORD[b.terrain] || b.terrain} to the ${b.dir}`;
  return `${kinds.join(" or ")} nearby: ${where}, about ${Math.round(b.rations)} days of food in ${b.hours}h of ${b.kind === "forage" ? "foraging" : b.kind === "hunt" ? "hunting" : "fishing"}`;
}
// A base short of food: the land around it (foraging and game), for the alert.
export function baseFoodHint(state, base) {
  const tiles = baseForageTiles(state, base);
  if (!tiles.length) return "";
  const best = tiles[0].id;
  const perDay = baseForageDay(state, base);
  const where = best === base.tile ? `around the base (${TERRAIN_WORD[state.tiles[best].terrain] || state.tiles[best].terrain})` : `${TERRAIN_WORD[state.tiles[best].terrain] || state.tiles[best].terrain} to the ${dirWord(state, base.tile, best)}`;
  if (perDay < FORAGE_WORTH) return seasonKey(state) === "winter" ? "winter: little to forage, so hunt, fish or trade" : "";
  return `hunt or forage nearby: ${where} (a forager brings in about ${r1(perDay)} food a day)`;
}
