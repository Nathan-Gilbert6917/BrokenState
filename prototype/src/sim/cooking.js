// Cooking (wave 2 cooking, 2026-10-11). User request: "Use the kitchen, campfire etc to craft food items as well using
// other food items like raw meat from hunting and berries as ingredients to make a meal. Follow similar to how it is like
// in Rimworld." Picks: 1 food poisoning (low Cooking, raw food or a dirty kitchen: vomiting for a day), 7 packaged
// survival meals with the vacuum sealer, 13 cookbooks found while scavenging ("even when not at the correct level"),
// 15 "crafting food costs purified water depending on the recipe", and from the freezer list a hand-cranked grain mill
// and a meat grinder. The standing rule: "AI groups need to have the same restrictions and gameplay features".
//
// THE EATING CONTRACT (with the `eating` branch, which owns who eats what and when: meal breaks, rations, the mood ladder,
// the Picky eater / vegetarian / cannibal traits). This module only makes food; it never chooses what anyone eats.
//   - Every lot this module makes carries `pz` (the chance that a day of food, 2000 kcal, eaten from it gives food
//     poisoning: the cook's Cooking, the station's dirt, a cookbook used below the recipe's level) and `by` (the cook's
//     survivor id; absent for the AI groups and lots merged across cooks). foods.js keeps both on the lot (addFood
//     { pz, by }), averages pz by quantity when lots merge, and hands them back from takeFood (result.lots[i].pz / .by),
//     takeItem and moveFood, so they follow the food into packs, cargo, other bases and trade.
//   - Whoever decides who ate a lot rolls it with poisonRoll(state, eaters, lots, { cooked, where }): eaters share the
//     lots evenly (pass one person and their own lots for per-person meals). Raw meat or fish (FOODS[k].raw) eaten from a
//     clean lot where nothing cooks it (cooked: false) counts POISON.raw a day of food. Lots with the worm's eggs are
//     skipped (worm.js eatRaw rolls them: food poisoning at its own odds). Iron Stomach / Weak Stomach scale it.
//   - The eating branch (eating.js, wave 2) rolls it per person on the lots each one ate: at a base (baseEatHour), from a
//     pack, on an errand, and on a team (needs.js teamNeedsHour: cooked at a lit camp fire or a stop). storage.js
//     eatFromStore rolls it only for eaters its caller names; poisonAtBase and teamPoisonHour (p.ateLots from needs.js
//     takeFood) are left for other callers.
//   - Meals keep their catalogue fields (foods.js: tier, moodLift, diet) for the eating branch's mood ladder.
//
// STATIONS AND BILLS (RimWorld's bills). A station is the Kitchen (buildings.js "canteen", kitchen.js) or a cook fire
// ("cookhouse"; at a shelter or camp its own fire is the station, "Camp fire", while it is lit). Each keeps base.cooking
// [key] = { bills, dirt, clean }. A bill: { id, recipe, mode, n, done, auto, paused, flt, prog, by, why }:
//   mode   "count" Do N times · "until" Do until you have N (auto: N is COOK.autoDays of the residents' eating, kept in
//          step with the head count) · "forever" Do forever (while there are ingredients and time);
//   flt    the ingredient filter: fresh (only fresh ingredients: raw meat and fish, eggs and milk, produce, crops and
//          forage; off: also the dry and preserved ones in DRY_MEAT / DRY_VEG), human (meat from people: never by
//          default; nothing makes it yet), order ("spoil": what spoils first, "cheap": the cheapest a calorie first),
//          no (item keys left out);
//   paused, and the order of the list is the priority: the cooks work the first bill that can go, then the next.
// The day (cookBills, storage.js cookDaily at midnight before the eating): each station's crew has the day's work-hours
//   - Kitchen: its cooks (kitchen.js cooksAt): a fixed all-day Cook COOK.fullDay hours, a part-time cook (Cook + a
//     second job, work priorities) their cooking hours that day (kitchen.js cookLog, 7 at most), × their work factor;
//     a cold stove (no wood) cooks nothing;
//   - Cook fire / camp fire: whoever is home with the best Cooking tends the pot COOK.fireHours a day; a cook fire burns
//     COOK.fireWood wood a work-hour (a shelter's lit fire burns what lies about: free);
//   × the cook's speed (speedOf: 0.6 + 0.04 a Cooking point, 60% at 0, 100% at 10, 140% at 20). First the cleaning
//   (below), then the bills in order: a batch takes its recipe's hours (÷ 1.1 with a cookbook that covers it; work
//   carries over to the next day), its ingredients (by kcal: the output's kcal ÷ the recipe's gain), its purified water
//   (un-purified boiled for the pot at COOK.boilWood wood a water when the purified is gone) and any wood or
//   machine it needs. Done batches go to the base's stores as lots with pz and by (above). Meals spoil in days (foods.js:
//   3–4, longer in a cold room or a freezer).
// The gain (satiety): every meal holds more calories than its raw makings (RimWorld's simple meal), the recipe's gain:
//   simple meal 1.25 (storage.js MEAL.gain), stew 1.35 (water and bones), fine meal 1.4, lavish 0.8 (lots of meat and
//   veg for the mood), pemmican, survival meals, flour, ground meat and sausage 1 (they keep, they do not stretch),
//   bread 1.1, the camp roast 1.1. The Kitchen's own −10% (kitchen.js KITCHEN.save: portions, soups) stays: a cook's day
//   at a 12-person base now saves about 2.5–3.5 days of food where it saved 1.2.
// Cooking skill: a recipe needs its Cooking level (COOK_RECIPES.skill: simple 0, stew 2, bread 2, pemmican 3, sausage 3,
//   survival 4, fine 6, lavish 8), or a read cookbook's lower one (blueprints.js CRAFT_BOOKS cook: below it, POISON.below
//   more poisoning a level short and no extra speed).
// Dirt (the kitchen's cleanliness, pick 1). A number per station, 0–100: +COOK.dirt.perHour every work-hour cooked; each
//   day the crew first cleans (while the station's "Clean first" is on and dirt ≥ cleanAt), up to dirt.share of the
//   day's hours, dirt.rate an hour. A real level, not a "days since cleaning" proxy: it costs the cooks visible time
//   (the trade-off is the player's: turn cleaning off for more meals and more poisoning), it grows with how hard the
//   kitchen works, and it is one number to show and save. A 12-hour day dirties 36 and takes about 1.2 hours to clean.
// Food poisoning (pick 1, health.js "poisoning", an illness: the sick-rest rule sends them to bed): a batch's pz =
//   POISON.base × POISON.per^Cooking (3% at 0, 1.7% at 3, 1.1% at 5, 0.6% at 8, 0.4% at 10, 0.06% at 20; RimWorld's
//   curve, halved for a day of food and a smaller colony), × (1 + POISON.dirt × dirt/100) (a filthy kitchen triples it),
//   × (1 + POISON.below a level cooked below the recipe with a cookbook); at most POISON.max. Raw meat or fish eaten
//   uncooked: POISON.raw a day of food. A severe case (POISON.severe) is worse (health.js). A team's camp pot counts
//   POISON.camp dirt.
// Machines (pick, the freezer list): the grain mill ("grainmill": flour from grain) and the meat grinder
//   ("meatgrinder": ground meat from raw game, sausage from ground meat) are hand-cranked machines on a utility plot
//   (buildings.js; no power), cheap in machine parts, worn on the days they turn (breakdowns.js FIXTURES ranDay: b.ran).
//   The vacuum sealer (power.js hasSealer: powered and working) packs survival meals.
// Teams (teamCookHour, worm.js wormTeamHour): at a lit, fed camp fire the team's raw meat and fish is roasted into simple
//   meals (the camp roast: COOK.team.perHour days of it an hour × the best cook's speed, a little purified water).
// Camp fires and the cook pot (2026-10-12, user request: "Lit camp fires use fire wood it goes out. Cooking uses camp
//   fires. Eatting non-cooked food for days is a mood negative so it pushes for getting cooking. Add a craft to allow
//   cooking small meal types at a camp or any base level"). A camp's or shelter's fire cooks only while it is lit and fed
//   (woodcutting.js shelterFire burns its wood by the hour and puts it out when the store runs dry); a team's camp
//   pot only while its fire burns carried wood (campFireHour). The camp cook pot (data.js GEAR cookpot, crafting.js
//   CRAFTS cookpot: 3 scrap, Cooking 0, anywhere): at any base with no Kitchen and no cook fire (an outpost or the hub
//   too), kept in its armory or carried by someone there, it makes a "Camp fire" station (the cookhouse key) for the
//   small meals (COOK_RECIPES small: simple meal and stew), tended and fuelled as a cook fire (COOK.fireHours,
//   COOK.fireWood an hour); a camp or shelter already cooks on its own fire. Carried by a team at a lit, fed camp fire,
//   the pot cooks every fresh ingredient it carries (CLASSES.any: forage, vegetables, eggs, raw meat and fish) into
//   simple meals at the simple meal's gain (POT.team) where the bare fire only roasts raw meat. Days without hot food
//   are a mood thought (eating.js THOUGHTS.cold).
// AI groups (groupCookDaily, factions.js before the day's eating; coarse, daily, no lots): a group whose kitchens are lit
//   turns the fresh ingredients its kitchens' people eat in a day into meals at the same gains (fine meals for
//   COOK_AI.fine of it with a Cooking 6+ cook or a cookbook's lower level, else simple), packs survival meals from
//   the surplus while its vacuum sealer runs, grinds grain (a grain mill) into bread and surplus game (a meat grinder)
//   into sausage; food poisoning is a daily illness rate (f.ill, groupcare.js) of the people fed × the cook's pz at
//   COOK_AI.dirt, each case COOK_AI.days of an ill head (their ill mend over about ten days: GROUP_ILL.mend). Their
//   Cooking: COOK_AI.skill by type, + a point per 15 people (to 3). Cookbooks: traders and communes
//   know the Family Cookbook from the start; any group finds one now and then (COOK_AI.bookP a day: their scavengers and
//   trade). Mills and grinders are built with your locks (groupworks.js LOCKS mill / grinder: a workshop, Mechanics 1)
//   and wear by the same fixtures. Abstract for them: no bills, no dirt (a fixed level), no water for cooking (their
//   water is one pool and never runs dry in their model), no named cooks.
import { FOODS, DAY_KCAL, addFood, takeFood, foodUnits, unitsOf, qtyOf, foodWord } from "./foods.js";
import { log, atBase, residents, skill, day } from "./world.js";
import { count, isShelter } from "./buildings.js";
import { hasKitchen, kitchenCold, kitchenService, cookHoursLately, dayRole, cookPlusOf } from "./kitchen.js";
import { isManaged } from "./work.js";
import { workFactor, addCondition, hasCondition, sickStats } from "./health.js";
import { hasSealer } from "./power.js";
import { fireLit, teamFire, teamKit } from "./fieldheat.js";
import { carriedAll } from "./comforts.js"; // the cook pot carried by someone at the base
import { stomachMult } from "./traits.js";
import { Rng } from "./rng.js";
import { CRAFT_BOOKS, isKnown } from "./blueprints.js";
import { RAW } from "./water.js";
import { GEAR } from "./data.js";
import { hash01 } from "./skills.js";
import { worksAt, groupKitchenShare, groupSealer, groupTech, groupKnows, groupsBuild, canPayParts, payParts, GROUP_WORKS } from "./groupworks.js";
import { FIXTURES, WEAR } from "./breakdowns.js";
import { GROUP_ILL } from "./groupcare.js"; // their ill and how fast they mend
import { baseCooks } from "./worm.js";
import { WOOD } from "./woodcutting.js"; // what a camp fire burns (the help)

export const COOK = {
  speed: { base: 0.6, per: 0.04, max: 1.4 },
  fullDay: 12, fireHours: 4, fireWood: 1, boilWood: 0.5, bookSpeed: 0.1, autoDays: 2,
  dirt: { perHour: 3, cleanAt: 10, rate: 30, share: 0.3, max: 100 },
  team: { perHour: 0.5, keep: 1.5 },
};
export const POISON = { base: 0.03, per: 0.82, dirt: 2, below: 0.3, raw: 0.05, camp: 25, max: 0.5, sev: [35, 60], severe: 0.05, severeSev: [75, 90] };
export const COOK_AI = { fine: 0.3, dirt: 20, days: 1.5, skill: { commune: 7, traders: 6, fortress: 5, military: 5, expansionist: 5, zealot: 4, explorers: 5, merchants: 6, raider: 3, band: 3, dflt: 5 }, bookP: 0.004,
  seal: { surplus: 20, share: 0.1 }, bread: 0.15, sausage: { keep: 0.5, max: 4 }, millGrain: 10, grinderMeat: 4 };

// The stations (base.cooking keys).
export const STATIONS = { canteen: { name: "Kitchen", icon: "🍳" }, cookhouse: { name: "Cook fire", icon: "🔥" } };
export const stationName = (base, key) => (key === "cookhouse" && !count(base, "cookhouse") ? "Camp fire" : (STATIONS[key] || { name: key }).name);
// A camp cook pot at the base: in its armory or carried by someone there.
export const hasPot = (state, base) => !!base && ((base.armory || []).some((it) => it && it.key === POT.item) || (!!state && atBase(state, base.id).some((s) => s.alive && carriedAll(s).some((it) => it && it.key === POT.item))));
// A base whose only cook station is a cook pot over a fire (no Kitchen, no cook fire, not a camp or shelter): small meals only.
export const potOnly = (state, base) => !hasKitchen(base) && !count(base, "cookhouse") && !isShelter(base) && hasPot(state, base);
// Is this recipe made at this station here (a pot-only Camp fire: the small meals)?
export const madeAt = (state, base, key, recipe) => { const R = COOK_RECIPES[recipe]; return !!R && R.at.includes(key) && (key !== "cookhouse" || !!R.small || !potOnly(state, base)); };

// The ingredient classes a recipe's inputs take. fresh-only filters keep to FOODS[k].ingredient (raw meat and fish, eggs
// and milk, produce, crops and forage); with fresh off the dry and preserved ones below count too.
const DRY_MEAT = ["f_jerky", "f_smokedfish", "f_cannedmeat", "f_cheese"];
const DRY_VEG = ["f_rice", "f_pasta", "f_oats", "f_drybeans", "f_driedfruit", "f_cannedveg", "f_nuts"];
const FAT = ["f_berries", "f_nuts", "f_driedfruit", "f_apples"];
const human = (f, flt) => f.diet === "human" && !(flt && flt.human);
const isMeat = (k, f, flt) => !human(f, flt) && k !== "f_sausage" && ((!!f.ingredient && (f.diet === "meat" || f.diet === "animal" || f.diet === "human")) || (!flt.fresh && DRY_MEAT.includes(k)));
const isVeg = (k, f, flt) => (!!f.ingredient && f.diet === "veg") || (!flt.fresh && DRY_VEG.includes(k));
export const CLASSES = {
  any:     { name: "meat, fish, eggs, milk, vegetables, fruit or forage", test: (k, f, flt) => isMeat(k, f, flt) || isVeg(k, f, flt) },
  meat:    { name: "meat, fish, eggs or milk", test: isMeat },
  veg:     { name: "vegetables, fruit or forage", test: isVeg },
  raw:     { name: "raw meat or fish", test: (k, f, flt) => !!f.raw && !human(f, flt) },
  game:    { name: "raw game (not fish)", test: (k, f, flt) => !!f.raw && f.group !== "rawfish" && k !== "f_groundmeat" && !human(f, flt) },
  ground:  { name: "ground meat", test: (k) => k === "f_groundmeat" },
  drymeat: { name: "meat or jerky", test: (k, f, flt) => (isMeat(k, f, flt) && f.diet !== "animal") || k === "f_jerky" },
  fat:     { name: "berries, nuts or dried fruit", test: (k) => FAT.includes(k) },
  grain:   { name: "grain", test: (k) => k === "f_grain" },
  flour:   { name: "flour", test: (k) => k === "f_flour" },
};
// The recipes. out: the item and n made a batch; gain: kcal out per kcal in (the satiety); in: [{ cls, share }] of the
// batch's input kcal; water: purified water a batch (stews and boiling more, frying and roasting less); hours: work-hours a
// batch at speed 1; skill: Cooking needed (a cookbook may lower it); at: the stations; needs: a machine at the base
// ("sealer", "grainmill", "meatgrinder"); wood: wood a batch (smoking). team: the team's camp pot (teamCookHour).
export const COOK_RECIPES = {
  simple:   { name: "Simple meal",     out: "f_simplemeal",   n: 4, gain: 1.25, in: [{ cls: "any", share: 1 }],  water: 1,   hours: 0.75, skill: 0, at: ["canteen", "cookhouse"], small: true, desc: "Whatever is to hand in one pot: any meat, fish, eggs, vegetables or forage." },
  stew:     { name: "Stew",            out: "f_stew",         n: 4, gain: 1.35, in: [{ cls: "any", share: 1 }],  water: 4,   hours: 1.5,  skill: 2, at: ["canteen", "cookhouse"], small: true, desc: "Meat, roots and plenty of water simmered for hours: stretches the food furthest of the everyday meals." },
  fine:     { name: "Fine meal",       out: "f_finemeal",     n: 3, gain: 1.4,  in: [{ cls: "meat", share: 0.5 }, { cls: "veg", share: 0.5 }], water: 1.5, hours: 1.25, skill: 6, at: ["canteen"], desc: "Meat and vegetables cooked properly: more filling and better for the mood." },
  lavish:   { name: "Lavish meal",     out: "f_lavishmeal",   n: 2, gain: 0.8,  in: [{ cls: "meat", share: 0.5 }, { cls: "veg", share: 0.5 }], water: 2, hours: 1.5, skill: 8, at: ["canteen"], desc: "A feast: lots of meat and vegetables for less food than went in, worth it for the mood." },
  pemmican: { name: "Pemmican",        out: "f_pemmican",     n: 2, gain: 1,    in: [{ cls: "drymeat", share: 0.67 }, { cls: "fat", share: 0.33 }], water: 0.5, hours: 2, skill: 3, at: ["canteen", "cookhouse"], desc: "Dried meat pounded with fat and berries or nuts: light travelling food that keeps a year." },
  survival: { name: "Survival meal",   out: "f_survivalmeal", n: 4, gain: 1,    in: [{ cls: "meat", share: 0.5 }, { cls: "veg", share: 0.5 }], water: 2, hours: 2, skill: 4, at: ["canteen"], needs: "sealer", desc: "A cooked meal dried and vacuum packed in a pouch: ten years on the shelf and almost no weight. Needs a working, powered vacuum sealer here." },
  flour:    { name: "Flour",           out: "f_flour",        n: 4, gain: 0.98, in: [{ cls: "grain", share: 1 }], water: 0, hours: 1.5, skill: 0, at: ["canteen", "cookhouse"], needs: "grainmill", desc: "Grain ground on the hand-cranked mill. Needs a grain mill here." },
  bread:    { name: "Bread",           out: "f_bread",        n: 4, gain: 1.1,  in: [{ cls: "flour", share: 1 }], water: 2, hours: 2, skill: 2, at: ["canteen"], desc: "Loaves from flour and water in the Kitchen's oven. Stale in days." },
  ground:   { name: "Ground meat",     out: "f_groundmeat",   n: 4, gain: 1,    in: [{ cls: "game", share: 1 }],  water: 0.5, hours: 1, skill: 0, at: ["canteen", "cookhouse"], needs: "meatgrinder", desc: "Tough cuts of game run through the grinder. Needs a meat grinder here." },
  sausage:  { name: "Smoked sausage",  out: "f_sausage",      n: 2, gain: 1,    in: [{ cls: "ground", share: 1 }], water: 1, hours: 2, skill: 3, at: ["canteen", "cookhouse"], needs: "meatgrinder", wood: 4, desc: "Ground meat salted, stuffed and smoked: keeps months. Needs a meat grinder here and 4 wood a batch for the smoke." },
  roast:    { name: "Camp roast",      out: "f_simplemeal",   n: 2, gain: 1.1,  in: [{ cls: "raw", share: 1 }],  water: 0.25, hours: 0.5, skill: 0, at: ["cookhouse"], team: true, desc: "Raw meat or fish roasted over the fire: little water, a little more filling than raw, and safe." },
};
for (const [k, R] of Object.entries(COOK_RECIPES)) { R.key = k; R.kcalOut = R.n * FOODS[R.out].kcal; R.units = R.kcalOut / R.gain / DAY_KCAL; } // units: days of food in a batch
export const RECIPE_KEYS = Object.keys(COOK_RECIPES);
// The camp cook pot on a team's fire: every fresh ingredient into simple meals.
export const POT = { item: "cookpot", team: "simple" };
export const NEEDS_NAME = { sealer: "a working vacuum sealer (powered)", grainmill: "a grain mill", meatgrinder: "a meat grinder" };

// ---------- the numbers ----------
const clamp01 = (v) => Math.max(0, Math.min(1, v || 0));
const r1 = (v) => Math.round((v || 0) * 10) / 10;
const r2 = (v) => Math.round((v || 0) * 100) / 100;
export const speedOf = (lvl) => Math.min(COOK.speed.max, COOK.speed.base + COOK.speed.per * Math.max(0, lvl || 0));
export const skillPz = (lvl) => POISON.base * Math.pow(POISON.per, Math.max(0, lvl || 0));
// The chance a day of food of a batch gives food poisoning: the cook's Cooking, the station's dirt (0–100), levels below
// the recipe's own (a cookbook).
export const poisonChance = (lvl, dirt = 0, below = 0) => Math.min(POISON.max, skillPz(lvl) * (1 + POISON.dirt * clamp01(dirt / COOK.dirt.max)) * (1 + POISON.below * Math.max(0, below)));
export const cookRng = (state) => state.cookRng || (state.cookRng = new Rng((((state.seed || 1) * 2654435761) ^ 0xc00c) >>> 0)); // its own dice: the world's are untouched
export function cookStats(state) {
  const s = state.cookStats || (state.cookStats = { batches: 0, hours: 0, clean: 0, kcalIn: 0, kcalOut: 0, made: {}, cases: 0, casesRaw: 0, casesMeal: 0, ai: { kcalIn: 0, kcalOut: 0, cases: 0, sealed: 0, bread: 0, sausage: 0 } });
  if (!s.ai) s.ai = { kcalIn: 0, kcalOut: 0, cases: 0, sealed: 0, bread: 0, sausage: 0 };
  return s;
}

// ---------- cookbooks (blueprints.js CRAFT_BOOKS entries with `cook`) ----------
export const cookbookIds = () => Object.keys(CRAFT_BOOKS).filter((id) => CRAFT_BOOKS[id].cook);
// The books that cover a recipe: [{ id, min }].
export const booksFor = (key) => cookbookIds().filter((id) => CRAFT_BOOKS[id].cook[key] != null).map((id) => ({ id, min: CRAFT_BOOKS[id].cook[key] }));
// The Cooking a recipe needs here: its own level, or the lowest of the read cookbooks that cover it. knows(id): a book
// is read (yours: blueprints.js isKnown; a group's: groupKnows).
export function recipeMin(key, knows) {
  const R = COOK_RECIPES[key];
  let min = R.skill, book = null;
  for (const b of booksFor(key)) if (b.min < min && knows(b.id)) { min = b.min; book = b.id; }
  return { min, book, covered: booksFor(key).some((b) => knows(b.id)) };
}
const youKnow = (state) => (id) => isKnown(state, id);

// ---------- stations ----------
export function cookState(base) { return base.cooking || (base.cooking = { next: 1 }); }
export function stationState(base, key) {
  const c = cookState(base);
  return c[key] || (c[key] = { bills: [], dirt: 0, clean: true });
}
// state: for the cook pot (a Camp fire at a base with no Kitchen or cook fire); without it only buildings and a shelter's fire count.
export const hasStation = (base, key, state = null) => (key === "canteen" ? hasKitchen(base) : key === "cookhouse" ? count(base, "cookhouse") > 0 || isShelter(base) || (!hasKitchen(base) && hasPot(state, base)) : false);
export const stationsAt = (base, state = null) => Object.keys(STATIONS).filter((k) => hasStation(base, k, state));
// Can it cook today? "" when it can, else why not.
export function stationWhy(state, base, key) {
  if (!hasStation(base, key, state)) return key === "canteen" ? "no Kitchen" : "no cook fire (build one, or craft a camp cook pot)";
  if (key === "canteen" && kitchenCold(base)) return "the stove is cold (no wood)";
  if (key === "cookhouse" && isShelter(base) && !count(base, "cookhouse") && !fireBurned(state, base)) return "the fire is out (it burns wood: light it again once some comes in)";
  return "";
}
// A camp's or shelter's fire that burned in the last day (woodcutting.js shelterFire: base.fireAt, the last hour it was
// fed) or is lit now: the day's cooking is done on it (the bills run at midnight, when the governor keeps it out).
const fireBurned = (state, base) => (fireLit(base) && (base.stock.wood || 0) > 0) || (base.fireAt != null && state.hour - base.fireAt < 24);
const freeFire = (state, base) => isShelter(base) && !count(base, "cookhouse") && fireBurned(state, base); // a camp's or shelter's own fire: its wood is paid by the hour (woodcutting.js shelterFire)
export const machineAt = (state, base, need) => (need === "sealer" ? hasSealer(state, base) : count(base, need) > 0);

// The defaults: a new Kitchen gets "Simple meal, until you have 2 days of eating" (the old automatic meals, now a bill
// you can change); a cook fire starts with none (the governor and the stewards add theirs).
export function ensureStations(state, base) {
  for (const key of stationsAt(base, state)) {
    const S = stationState(base, key);
    if (S.init) continue;
    S.init = true;
    if (key === "canteen" && !S.bills.length) S.bills.push(newBill(base, "simple", { mode: "until", auto: true, by: "player" }));
  }
}
export function newBill(base, recipe, o = {}) {
  const c = cookState(base);
  return { id: c.next++, recipe, mode: o.mode || "until", n: o.n ?? 10, done: 0, auto: !!o.auto, paused: false, flt: { fresh: true, human: false, order: "spoil", no: [], ...(o.flt || {}) }, prog: 0, by: o.by || "player", why: "" };
}
// N for an "until" bill: its own, or (auto) COOK.autoDays of the residents' eating in the recipe's item.
export function billTarget(state, base, b) {
  if (!b.auto) return Math.max(0, b.n || 0);
  const R = COOK_RECIPES[b.recipe];
  return Math.max(4, Math.ceil((residents(state, base.id).length * COOK.autoDays * DAY_KCAL) / FOODS[R.out].kcal));
}
export const billHave = (base, b) => Math.max(0, base.stock[COOK_RECIPES[b.recipe].out] || 0);
// Does the bill want another batch now?
export function billWants(state, base, b) {
  if (b.mode === "count") return (b.done || 0) < (b.n || 0);
  if (b.mode === "until") return billHave(base, b) + 1e-6 < billTarget(state, base, b);
  return true;
}
export const billDone = (b) => b.mode === "count" && (b.done || 0) >= (b.n || 0);

// The ingredient test for one input of a bill.
export const inputTest = (inp, flt) => (k, f) => !!f && !(flt.no || []).includes(k) && CLASSES[inp.cls].test(k, f, flt);
// What a bill lacks for one batch here now ("" when it can go): the station, a machine, ingredients, water, wood.
export function batchWhy(state, base, key, b, wood = Infinity) {
  const R = COOK_RECIPES[b.recipe];
  if (!R) return "an unknown recipe";
  if (!madeAt(state, base, key, b.recipe)) return R.at.includes(key) ? "a cook pot over a fire makes only small meals (simple meal, stew)" : `not made at a ${stationName(base, key).toLowerCase()}`;
  if (R.needs && !machineAt(state, base, R.needs)) return `needs ${NEEDS_NAME[R.needs]}`;
  for (const inp of R.in) {
    const need = R.units * inp.share, have = foodUnits(base, inputTest(inp, b.flt));
    if (have + 1e-9 < need) return `short of ${CLASSES[inp.cls].name} (${r1(have)} of ${r1(need)} days of food)`;
  }
  const w = waterPlan(base, R.water, freeFire(state, base));
  if (!w.ok) return `short of purified water (${r1(w.pure)} of ${R.water}; un-purified water needs wood to boil)`;
  if ((R.wood || 0) + w.wood > Math.max(0, Math.min(wood, base.stock.wood || 0)) + 1e-9) return `short of wood (${R.wood || 0} a batch${w.wood ? ` + ${r1(w.wood)} to boil water` : ""})`;
  return "";
}
// A batch's water: purified first, then un-purified boiled for the pot (COOK.boilWood a water; free on a shelter's fire).
function waterPlan(base, need, free) {
  const pure = Math.max(0, base.stock.water || 0), raw = Math.max(0, base.stock[RAW] || 0);
  const fromPure = Math.min(pure, need), fromRaw = Math.max(0, need - fromPure);
  return { ok: fromRaw <= raw + 1e-9, pure, fromPure, fromRaw, wood: free ? 0 : fromRaw * COOK.boilWood };
}

// ---------- the crews ----------
// The Kitchen's cooks today: [{ s, lvl, left (effective work-hours) }], the best cook first.
export function kitchenCrew(state, base) {
  if (!hasKitchen(base) || kitchenCold(base)) return [];
  return kitchenService(state, base).cooks.map((s) => {
    const full = dayRole(state, s) === "cook" && !cookPlusOf(state, s) && !isManaged(state, s);
    const hrs = full ? COOK.fullDay : cookHoursLately(state, s);
    const lvl = skill(s, "cooking");
    return { s, lvl, hours: hrs * Math.min(1, workFactor(s)), left: hrs * Math.min(1, workFactor(s)) * speedOf(lvl) };
  }).filter((c) => c.left > 1e-6).sort((a, b) => b.lvl - a.lvl || a.s.id - b.s.id);
}
// The cook fire's (or a shelter's fire's) tender: the best cook at home, COOK.fireHours.
export function fireCrew(state, base) {
  if (stationWhy(state, base, "cookhouse")) return [];
  const ppl = atBase(state, base.id).filter((s) => s.alive && !s.inBed && workFactor(s) >= 0.35);
  if (!ppl.length) return [];
  const s = [...ppl].sort((a, b) => skill(b, "cooking") - skill(a, "cooking") || a.id - b.id)[0];
  const lvl = skill(s, "cooking");
  return [{ s, lvl, hours: COOK.fireHours * Math.min(1, workFactor(s)), left: COOK.fireHours * Math.min(1, workFactor(s)) * speedOf(lvl) }];
}
const crewOf = (state, base, key) => (key === "canteen" ? kitchenCrew(state, base) : fireCrew(state, base));

// ---------- the day ----------
// Midnight, before the eating (storage.js cookDaily): every station works its bills. Returns the days of food that went
// into the pots (ingredients). base.cookDay records the day for the screens.
export function cookBills(state, base) {
  if (state.cookOff) return 0; // test switch (balance A/B): no cooking at all
  ensureStations(state, base);
  const rec = { day: day(state), hours: 0, clean: 0, batches: 0, made: {}, kcalIn: 0, kcalOut: 0, water: 0, wood: 0, st: {} };
  for (const key of stationsAt(base, state)) runStation(state, base, key, rec);
  base.cookDay = rec;
  const cs = cookStats(state);
  cs.batches += rec.batches; cs.hours += rec.hours; cs.clean += rec.clean; cs.kcalIn += rec.kcalIn; cs.kcalOut += rec.kcalOut;
  for (const [k, q] of Object.entries(rec.made)) cs.made[k] = (cs.made[k] || 0) + q;
  return rec.kcalIn / DAY_KCAL;
}
function runStation(state, base, key, rec) {
  const S = stationState(base, key);
  for (const b of S.bills) b.why = "";
  const live = S.bills.filter((b) => !b.paused && !billDone(b));
  const sr = rec.st[key] = { hours: 0, clean: 0, batches: 0, cooks: [], why: "" };
  if (!live.length) return;
  const why = stationWhy(state, base, key);
  const crew = why ? [] : crewOf(state, base, key);
  if (!crew.length) { sr.why = why || (key === "canteen" ? "no cook on duty" : "nobody home to tend it"); for (const b of live) b.why = sr.why; return; }
  // A cook fire burns wood a work-hour (not a shelter's own fire): the crew's day is cut to what the woodpile pays.
  const perHour = key === "cookhouse" && !freeFire(state, base) ? COOK.fireWood : 0;
  if (perHour > 0) {
    const cap = Math.max(0, base.stock.wood || 0) / perHour;
    const tot = crew.reduce((a, c) => a + c.hours, 0);
    if (tot > cap) for (const c of crew) { const k = tot > 0 ? cap / tot : 0; c.left *= k; c.hours *= k; }
    if (cap < 1e-6) { sr.why = "no wood for the cook fire"; for (const b of live) b.why = sr.why; return; }
  }
  const spend = (h) => { let need = h; for (const c of [...crew].reverse()) { const t = Math.min(c.left, need); c.left -= t; need -= t; if (need <= 1e-9) break; } return h - need; };
  const leftAll = () => crew.reduce((a, c) => a + c.left, 0);
  const total0 = leftAll();
  // The cleaning: first thing, while it is on and the station is dirty (the least skilled cook's hours first).
  if (S.clean !== false && S.dirt >= COOK.dirt.cleanAt) {
    const h = spend(Math.min(total0 * COOK.dirt.share, S.dirt / COOK.dirt.rate));
    S.dirt = Math.max(0, S.dirt - h * COOK.dirt.rate);
    sr.clean += h; rec.clean += h;
  }
  const knows = youKnow(state);
  for (const b of live) {
    const R = COOK_RECIPES[b.recipe];
    const M = recipeMin(b.recipe, knows);
    const batchHours = R.hours / (M.covered ? 1 + COOK.bookSpeed : 1);
    for (let guard = 0; guard < 400; guard++) {
      if (!billWants(state, base, b)) { b.why = b.mode === "count" ? "done" : "enough in store"; break; }
      const cook = crew.find((c) => c.left > 1e-6 && c.lvl >= M.min);
      if (!cook) { b.why = leftAll() > 1e-6 ? `needs Cooking ${M.min}${M.min < R.skill ? "" : booksFor(b.recipe).length ? " (or a cookbook)" : ""}` : b.prog > 0 ? "out of cooking time today (carried over)" : "out of cooking time today"; break; }
      const block = batchWhy(state, base, key, b, perHour > 0 ? Math.max(0, (base.stock.wood || 0) - leftAll() * perHour) : Infinity);
      if (block) { b.why = block; break; }
      const h = Math.min(cook.left, batchHours - b.prog);
      cook.left -= h; b.prog += h; sr.hours += h; rec.hours += h;
      if (perHour > 0) { const w = Math.min(base.stock.wood || 0, (h / speedOf(cook.lvl)) * perHour); base.stock.wood -= w; rec.wood += w; } // the fire burns by the clock hour, not the cook's speed
      if (b.prog + 1e-9 < batchHours) continue; // the next cook carries on, or tomorrow
      b.prog = 0;
      makeBatch(state, base, key, b, cook, Math.max(0, R.skill - cook.lvl), rec);
      S.dirt = Math.min(COOK.dirt.max, S.dirt + COOK.dirt.perHour * R.hours);
      sr.batches++;
      if (!sr.cooks.includes(cook.s.id)) sr.cooks.push(cook.s.id);
    }
  }
}
// One batch: ingredients, water, wood, the machine's day; the output as a lot with its pz and cook.
function makeBatch(state, base, key, b, cook, below, rec) {
  const R = COOK_RECIPES[b.recipe];
  const S = stationState(base, key);
  let kin = 0;
  for (const inp of R.in) {
    const got = takeFood(base, R.units * inp.share, { only: inputTest(inp, b.flt), order: b.flt.order === "cheap" ? "cheap" : "spoil", state });
    kin += got.kcal;
  }
  const w = waterPlan(base, R.water, freeFire(state, base));
  base.stock.water = r2(Math.max(0, (base.stock.water || 0) - w.fromPure));
  base.stock[RAW] = r2(Math.max(0, (base.stock[RAW] || 0) - w.fromRaw));
  const wood = (R.wood || 0) + w.wood;
  if (wood > 0) { base.stock.wood = Math.max(0, (base.stock.wood || 0) - wood); rec.wood += wood; }
  rec.water += R.water;
  if (R.needs && R.needs !== "sealer") { const m = base.buildings.find((x) => x.type === R.needs && !x.broken); if (m) m.ran = day(state); } // breakdowns.js: worn on the days it turned
  if (R.needs === "sealer") { const m = base.buildings.find((x) => x.type === "sealer" && !x.broken); if (m) m.ran = day(state); }
  const pz = poisonChance(cook.lvl, S.dirt, below);
  addFood(base, R.out, R.n, { left: FOODS[R.out].shelf, state, pz, by: cook.s.id });
  b.done = (b.done || 0) + 1;
  rec.batches++;
  rec.kcalIn += kin;
  rec.kcalOut += R.kcalOut;
  rec.made[R.out] = (rec.made[R.out] || 0) + R.n;
}

// ---------- bills (the UI and the governor) ----------
const billOf = (base, key, id) => stationState(base, key).bills.find((b) => b.id === Number(id));
export function addBill(state, base, key, recipe, by = "player") {
  if (!hasStation(base, key, state)) return "No such station here.";
  const R = COOK_RECIPES[recipe];
  if (!R || R.team || !madeAt(state, base, key, recipe)) return "That is not made here.";
  const S = stationState(base, key);
  if (S.bills.length >= 12) return "Twelve bills at most a station.";
  const b = newBill(base, recipe, { mode: "until", n: Math.max(4, R.n * 2), auto: recipe === "simple", by });
  S.bills.push(b);
  return `${R.name}: a bill added at the ${stationName(base, key).toLowerCase()} (${modeText(state, base, b)}).`;
}
export function removeBill(state, base, key, id) {
  const S = stationState(base, key);
  const i = S.bills.findIndex((b) => b.id === Number(id));
  if (i < 0) return "";
  const [b] = S.bills.splice(i, 1);
  return `${COOK_RECIPES[b.recipe] ? COOK_RECIPES[b.recipe].name : b.recipe}: bill removed.`;
}
export function moveBill(state, base, key, id, dir) {
  const S = stationState(base, key);
  const i = S.bills.findIndex((b) => b.id === Number(id));
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= S.bills.length) return "";
  [S.bills[i], S.bills[j]] = [S.bills[j], S.bills[i]];
  return "";
}
// patch: { mode, n, paused, fresh, human, order, no: [keys] | toggle: key }. A player's change makes the bill theirs.
export function setBill(state, base, key, id, patch, by = "player") {
  const b = billOf(base, key, id);
  if (!b) return "";
  if (patch.mode && ["count", "until", "forever"].includes(patch.mode)) { if (b.mode !== patch.mode) { b.mode = patch.mode; b.done = 0; } }
  if (patch.n != null && Number.isFinite(Number(patch.n))) { b.n = Math.max(0, Math.min(9999, Math.round(Number(patch.n)))); b.auto = false; if (b.mode === "count") b.done = Math.min(b.done || 0, b.n); }
  if (patch.auto != null) b.auto = !!patch.auto;
  if (patch.paused != null) b.paused = !!patch.paused;
  if (patch.fresh != null) b.flt.fresh = !!patch.fresh;
  if (patch.human != null) b.flt.human = !!patch.human;
  if (patch.order && ["spoil", "cheap"].includes(patch.order)) b.flt.order = patch.order;
  if (patch.toggle) { const no = b.flt.no || (b.flt.no = []); const i = no.indexOf(patch.toggle); if (i >= 0) no.splice(i, 1); else no.push(patch.toggle); }
  if (patch.again) b.done = 0;
  if (by === "player") b.by = "player";
  return "";
}
export function setStationClean(base, key, on) { stationState(base, key).clean = !!on; return ""; }
export function modeText(state, base, b) {
  if (b.mode === "count") return `do ${b.n} times (${b.done || 0} done)`;
  if (b.mode === "until") return `until you have ${billTarget(state, base, b)}${b.auto ? " (2 days of eating)" : ""}`;
  return "forever";
}
// Can the base's crew make this recipe as far as skill and books go: { ok, min, book, best }.
export function recipeSkillOk(state, base, key, recipe) {
  const M = recipeMin(recipe, youKnow(state));
  const crew = key === "canteen" ? kitchenService(state, base).cooks : atBase(state, base.id).filter((s) => s.alive);
  const best = crew.reduce((a, s) => Math.max(a, skill(s, "cooking")), -1);
  return { ok: best >= M.min, min: M.min, book: M.book, best };
}

// ---------- the governor and the stewards (autopilot.js governBase, areas.production) ----------
// Bills marked "ai" are theirs to set; the player's bills are left alone. A Kitchen: fine meals first once a cook can
// make them and meat and vegetables are both in, else the default simple meals; pemmican from surplus meat (for the
// trips); flour and bread with a grain mill and grain; ground meat and sausage with a meat grinder and surplus game;
// survival meals while the vacuum sealer runs and the stores are deep. A cook fire with no Kitchen: simple meals.
export function govCookBills(state, base) {
  if (state.cookOff) return;
  ensureStations(state, base);
  const eaters = Math.max(1, residents(state, base.id).length);
  const units = (cls, fresh = true) => foodUnits(base, (k, f) => CLASSES[cls].test(k, f, { fresh, human: false }));
  const want = [];
  if (hasStation(base, "canteen")) {
    const fine = recipeSkillOk(state, base, "canteen", "fine").ok && units("meat") >= 1 && units("veg") >= 1;
    if (fine) want.push(["canteen", "fine", "until", Math.ceil((eaters * DAY_KCAL) / FOODS.f_finemeal.kcal)]);
    if (units("game") >= eaters * 1.5 && recipeSkillOk(state, base, "canteen", "pemmican").ok && units("fat", false) >= 1) want.push(["canteen", "pemmican", "until", 10]);
    if (machineAt(state, base, "grainmill") && (base.stock.f_grain || 0) >= 8) want.push(["canteen", "flour", "until", 8]);
    if ((base.stock.f_flour || 0) >= 2 && recipeSkillOk(state, base, "canteen", "bread").ok) want.push(["canteen", "bread", "until", Math.ceil(eaters / 2)]);
    if (machineAt(state, base, "meatgrinder") && units("game") >= eaters * 2) { want.push(["canteen", "ground", "until", 4]); if (recipeSkillOk(state, base, "canteen", "sausage").ok) want.push(["canteen", "sausage", "until", 10]); }
    if (hasSealer(state, base) && foodUnits(base) >= eaters * 30 && recipeSkillOk(state, base, "canteen", "survival").ok) want.push(["canteen", "survival", "until", 20]);
  } else if (hasStation(base, "cookhouse", state)) want.push(["cookhouse", "simple", "until", Math.ceil((eaters * DAY_KCAL) / FOODS.f_simplemeal.kcal)]);
  for (const key of stationsAt(base, state)) {
    const S = stationState(base, key);
    const mine = want.filter((w) => w[0] === key);
    // Drop their bills they no longer want; keep the player's.
    S.bills = S.bills.filter((b) => b.by !== "ai" || mine.some((w) => w[1] === b.recipe));
    for (const [, recipe, mode, n] of mine) {
      if (S.bills.some((b) => b.recipe === recipe && b.by !== "ai")) continue; // the player has one of these
      let b = S.bills.find((x) => x.recipe === recipe && x.by === "ai");
      if (!b) { b = newBill(base, recipe, { mode, n, by: "ai" }); if (recipe === "fine") S.bills.unshift(b); else S.bills.push(b); }
      else { b.mode = mode; b.n = n; b.auto = false; b.paused = false; }
    }
  }
}

// ---------- food poisoning ----------
// The eating contract (top of this file): eaters share `lots` (takeFood's result.lots) evenly. opts.cooked: raw meat
// counts as cooked here (a cook fire, a lit stove or a team's lit fire); opts.where: " at Base" text. Returns the people
// who came down with it.
export function poisonRoll(state, eaters, lots, opts = {}) {
  if (state.cookOff) return [];
  const people = (eaters || []).filter((s) => s && s.alive);
  if (!people.length || !lots || !lots.length) return [];
  const n = people.length;
  let L = 0, top = null, topV = 0, rawU = 0;
  for (const l of lots) {
    const f = FOODS[l.k];
    if (!f || l.egg) continue; // the worm's egg lots: worm.js eatRaw rolls them
    const p = l.pz > 0 ? l.pz : f.raw && !opts.cooked ? POISON.raw : 0;
    if (!(p > 0)) continue;
    const u = unitsOf(l.k, l.q) / n;
    const v = -u * Math.log(1 - Math.min(0.99, p));
    L += v;
    if (!(l.pz > 0)) rawU += u * n;
    if (v > topV) { topV = v; top = l; }
  }
  if (!(L > 0)) return [];
  const base = 1 - Math.exp(-L);
  const hit = [];
  const rng = cookRng(state);
  for (const s of people) {
    if (hasCondition(s, "poisoning")) continue;
    const c = Math.min(POISON.max, base * stomachMult(s)); // Iron Stomach, Weak Stomach (traits.js)
    if (!rng.chance(c)) continue;
    const severe = rng.chance(POISON.severe);
    const sev = severe ? rng.int(POISON.severeSev[0], POISON.severeSev[1]) : rng.int(POISON.sev[0], POISON.sev[1]);
    const cook = top && top.pz > 0 && top.by != null ? state.survivors.find((x) => x.id === top.by) : null;
    const why = top && top.pz > 0 ? `after a ${FOODS[top.k].name.toLowerCase()}${cook ? ` cooked by ${cook.name.split(" ")[0]}` : ""}${opts.where || ""}` : `from raw ${top && FOODS[top.k].group === "rawfish" ? "fish" : "meat"} eaten uncooked${opts.where || ""}`;
    if (addCondition(state, s, "poisoning", why, { sev, quiet: true, cause: "food" })) hit.push({ s, severe, raw: !(top && top.pz > 0), why });
  }
  if (hit.length) {
    const cs = cookStats(state);
    cs.cases += hit.length;
    for (const h of hit) { if (h.raw) cs.casesRaw++; else cs.casesMeal++; }
    const names = hit.map((h) => h.s.name.split(" ")[0]);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    log(state, `🤮 ${list} came down with food poisoning ${hit[0].why}${hit.some((h) => h.severe) ? " (a bad case)" : ""}: off work for about a day.${hit[0].raw ? " Cook the meat: a cook fire, a Kitchen or a lit camp fire." : ""}`, "danger");
  }
  void rawU;
  return hit.map((h) => h.s);
}
// A base's day of eating (storage.js eatFromStore): everyone living here shares the day's clean lots.
export function poisonAtBase(state, base, lots) {
  if (!state || !base || !lots || !lots.length) return [];
  const hit = poisonRoll(state, residents(state, base.id), lots, { cooked: baseCooks(base), where: ` at ${base.name}` });
  if (hit.length) base.poisonDay = { day: day(state), n: hit.length };
  return hit;
}
// A team's hour (needs.js teamNeedsHour): the lots its members ate this hour (p.ateLots, needs.js takeFood).
export function teamPoisonHour(state, p, members) {
  const lots = p.ateLots;
  delete p.ateLots;
  if (!lots || !lots.length) return [];
  return poisonRoll(state, members, lots, { cooked: teamFire(state, p) === true, where: "" });
}

// ---------- a team's camp pot ----------
// worm.js wormTeamHour, while the camp fire is lit and fed: up to COOK.team.perHour days of the team's raw meat and
// fish × the best cook's speed is roasted into simple meals (COOK_RECIPES.roast; with a camp cook pot carried, every
// fresh ingredient is cooked into simple meals at the simple meal's gain: POT.team), with its little purified water (none
// left: it waits), up to COOK.team.keep days of the team's eating in meals. The lots carry the camp pot's pz (POISON.camp dirt) and the cook.
export function teamCookHour(state, p, members) {
  if (state.cookOff) return 0;
  const pot = teamKit(state, p).some((it) => it && it.key === POT.item); // a camp cook pot: anything fresh into simple meals
  const R = pot ? COOK_RECIPES[POT.team] : COOK_RECIPES.roast;
  const hs = [p, p.cargo].filter((h) => h && h.supplies);
  const only = (k, f) => CLASSES[pot ? "any" : "raw"].test(k, f, { fresh: true, human: false });
  const have = hs.reduce((a, h) => a + foodUnits(h, only), 0);
  if (!(have > 0.02)) return 0;
  const crew = (members || []).filter((s) => s && s.alive);
  if (!crew.length) return 0;
  const cook = [...crew].sort((a, b) => skill(b, "cooking") - skill(a, "cooking") || a.id - b.id)[0];
  const lvl = skill(cook, "cooking");
  // Only what the team will eat soon: meals in its packs up to COOK.team.keep days of its eating (the rest stays raw:
  // the water it would take is the team's drinking).
  const ready = hs.reduce((a, h) => a + foodUnits(h, (k) => k === R.out), 0);
  const room = Math.max(0, crew.length * COOK.team.keep - ready) / R.gain;
  let units = Math.min(have, COOK.team.perHour * speedOf(lvl), room);
  const water = (u) => (R.water * u) / R.units;
  const pure = hs.reduce((a, h) => a + Math.max(0, h.supplies.water || 0), 0);
  if (pure + 1e-9 < water(units)) units = R.water > 0 ? (pure * R.units) / R.water : units;
  if (!(units > 0.02)) return 0;
  let w = water(units);
  for (const h of hs) { const t = Math.min(w, Math.max(0, h.supplies.water || 0)); h.supplies.water = r2(h.supplies.water - t); w -= t; }
  const got = takeFood(hs, units, { only, state });
  if (!(got.units > 0)) return 0;
  const q = qtyOf(R.out, got.units * R.gain);
  addFood(p, R.out, q, { left: FOODS[R.out].shelf, state, pz: poisonChance(lvl, POISON.camp), by: cook.id });
  const cs = cookStats(state);
  cs.kcalIn += got.kcal; cs.kcalOut += got.kcal * R.gain; cs.made[R.out] = (cs.made[R.out] || 0) + q; cs.team = (cs.team || 0) + got.units;
  return got.units;
}

// ---------- the AI groups (coarse; see the header) ----------
export function groupCookSkill(state, f) {
  const t = COOK_AI.skill[f.type] ?? COOK_AI.skill.dflt;
  return t + Math.min(3, Math.floor((f.pop || 0) / 15));
}
const groupKnowsBook = (state, f) => (id) => groupTech(f).known.includes(id);
// Their cookbooks: traders and communes know the Family Cookbook; any group finds or buys one now and then.
export function groupCookbooks(state, f) {
  if (!groupsBuild(state, f)) return;
  const T = groupTech(f);
  if (!f.cookInit) { f.cookInit = 1; if ((f.type === "traders" || f.type === "commune") && !T.known.includes("cookbook")) T.known.push("cookbook"); }
  const open = cookbookIds().filter((id) => !T.known.includes(id));
  if (open.length && hash01(state.seed, "gcbk", f.name, day(state)) < COOK_AI.bookP) T.known.push(open[Math.floor(hash01(state.seed, "gcbkk", f.name, day(state)) * open.length) % open.length]);
}
// Their grain mills and meat grinders (groupworks.js works "mill" / "grinder"): ran today, worn by your fixtures, mended
// when they can pay your proper repair.
const FIT = { mill: "grainmill", grinder: "meatgrinder" };
function groupFitOk(state, f, k) {
  return f.bases.some((t) => { const w = worksAt(f, t); return (w[k] || 0) > 0 && !(w.mach && w.mach[k] && w.mach[k].broken); });
}
function groupFitWear(state, f, ran) {
  for (const t of f.bases) {
    const w = worksAt(f, t);
    for (const k of Object.keys(FIT)) {
      if (!(w[k] > 0)) continue;
      const mach = w.mach || (w.mach = {});
      const m = mach[k] || (mach[k] = { wear: 0, spares: 0, broken: false });
      const def = FIXTURES[FIT[k]];
      if (m.broken) {
        const cost = def.repair.cost;
        if (Object.entries(cost).every(([key, v]) => (key === "parts" ? canPayParts(f, v, "machine") : (f.stock[key] || 0) >= v))) {
          for (const [key, v] of Object.entries(cost)) { if (key === "parts") payParts(f, v, "machine"); else f.stock[key] -= v; }
          m.broken = false; m.wear = WEAR.repairWear;
        }
        continue;
      }
      m.wear = Math.max(0, m.wear + (ran[k] ? def.use : def.idle || 0) - GROUP_WORKS.MACH.mend);
      const p = m.wear >= WEAR.breakAt ? 1 : m.wear >= WEAR.riskFrom ? ((m.wear - WEAR.riskFrom) / (WEAR.breakAt - WEAR.riskFrom)) ** 2 * WEAR.riskMax : 0;
      if (p > 0 && hash01(state.seed, "gfit", f.name, t, k, day(state)) < p) m.broken = true;
    }
  }
}
// Daily (factions.js, after the day's food comes in and before they eat).
export function groupCookDaily(state, f) {
  if (!f || !f.alive || !f.stock || state.cookOff) return;
  groupCookbooks(state, f);
  const ran = {};
  const share = groupKitchenShare(state, f);
  if (share > 0) {
    const st = f.stock;
    const knows = groupKnowsBook(state, f);
    const lvl = groupCookSkill(state, f);
    const cs = cookStats(state).ai;
    const flt = { fresh: true, human: false };
    // The day's meals: the fresh ingredients the kitchens' people eat in a day, simple or (a skilled cook) part fine.
    const only = (k, x) => CLASSES.any.test(k, x, flt);
    const fed = (f.pop || 0) * share;
    const units = Math.min(foodUnits(st, only), fed);
    if (units > 0.01) {
      const got = takeFood(st, units, { only, state });
      const fine = lvl >= recipeMin("fine", knows).min ? COOK_AI.fine : 0;
      const mk = (key, u) => { const R = COOK_RECIPES[key]; const q = qtyOf(R.out, u * R.gain); st[R.out] = (st[R.out] || 0) + q; cs.kcalOut += q * FOODS[R.out].kcal; };
      mk("fine", got.units * fine);
      mk("simple", got.units * (1 - fine));
      cs.kcalIn += got.kcal;
      // Food poisoning: a daily illness rate of the people who ate the meals (groupcare.js f.ill).
      const cases = Math.min(fed, got.units * poisonChance(lvl, COOK_AI.dirt)); // a day of the meals' food a head: pz a head
      // Their ill (groupcare.js) mend GROUP_ILL.mend a day (about ten days a case); food poisoning lasts COOK_AI.days, so a
      // case adds that share of an ill head (the same ill-days as yours).
      f.ill = Math.round(((f.ill || 0) + cases * COOK_AI.days * GROUP_ILL.mend) * 1000) / 1000;
      f.poisoned = (f.poisoned || 0) + cases;
      cs.cases += cases;
    }
    // A running vacuum sealer: a share of the surplus beyond COOK_AI.seal.surplus days a head packed for the road.
    if (groupSealer(f) && lvl >= recipeMin("survival", knows).min) {
      const spare = foodUnits(st) - (f.pop || 0) * COOK_AI.seal.surplus;
      const u = Math.min(Math.max(0, spare) * COOK_AI.seal.share, foodUnits(st, only), (f.pop || 0) * 0.5);
      if (u > 0.05) { const got = takeFood(st, u, { only, state }); st.f_survivalmeal = (st.f_survivalmeal || 0) + qtyOf("f_survivalmeal", got.units); cs.sealed += got.units; }
    }
    // A grain mill: grain into bread for COOK_AI.bread of the day's eating.
    if (groupFitOk(state, f, "mill") && lvl >= recipeMin("bread", knows).min && (st.f_grain || 0) > 0) {
      const u = Math.min(unitsOf("f_grain", st.f_grain), (f.pop || 0) * COOK_AI.bread);
      if (u > 0.05) { st.f_grain -= qtyOf("f_grain", u); const out = u * COOK_RECIPES.flour.gain * COOK_RECIPES.bread.gain; st.f_bread = (st.f_bread || 0) + qtyOf("f_bread", out); cs.bread += out; ran.mill = true; }
    }
    // A meat grinder: raw game beyond COOK_AI.sausage.keep days a head ground and smoked into sausage (it keeps).
    if (groupFitOk(state, f, "grinder") && lvl >= recipeMin("sausage", knows).min) {
      const game = (k, x) => CLASSES.game.test(k, x, flt);
      const u = Math.min(Math.max(0, foodUnits(st, game) - fed * COOK_AI.sausage.keep), COOK_AI.sausage.max);
      if (u > 0.05) { const got = takeFood(st, u, { only: game, state }); st.f_sausage = (st.f_sausage || 0) + qtyOf("f_sausage", got.units); cs.sausage += got.units; ran.grinder = true; }
    }
  }
  if (groupsBuild(state, f)) groupFitWear(state, f, ran);
}
// For their works list: does a group want a grain mill / a meat grinder (groupworks.js nextWork)?
export const groupWantsMill = (f) => (f.stock.f_grain || 0) >= COOK_AI.millGrain;
export const groupWantsGrinder = (f) => foodUnits(f.stock, (k, x) => CLASSES.game.test(k, x, { fresh: true })) >= COOK_AI.grinderMeat;

// ---------- text ----------
export function recipeText(R) {
  const one = { grain: "f_grain", flour: "f_flour", ground: "f_groundmeat" }; // a single item: its own count ("4.5 kg of grain")
  const ins = R.in.map((i) => (one[i.cls] ? foodWord(one[i.cls], qtyOf(one[i.cls], R.units * i.share)) : `${r1(R.units * i.share)} days of ${CLASSES[i.cls].name}`)).join(" + ");
  return `${ins}${R.water ? ` + ${R.water} purified water` : ""}${R.wood ? ` + ${R.wood} wood` : ""} → ${foodWord(R.out, R.n)} (${Math.round((R.gain - 1) * 100) >= 0 ? "+" : ""}${Math.round((R.gain - 1) * 100)}% food)`;
}
export function cookingHelp() {
  const rows = RECIPE_KEYS.filter((k) => !COOK_RECIPES[k].team).map((k) => {
    const R = COOK_RECIPES[k];
    const books = booksFor(k).map((b) => `${GEAR[b.id] ? GEAR[b.id].name : b.id}: Cooking ${b.min}`).join(", ");
    return `<b>${R.name}</b>: ${recipeText(R)}; ${r2(R.hours)} work-hours, Cooking ${R.skill}${books ? ` (${books})` : ""}${R.needs ? `, ${NEEDS_NAME[R.needs]}` : ""}; ${R.at.map((a) => STATIONS[a].name).join(" or ")}. ${R.desc}`;
  });
  return `<b>Bills.</b> The Kitchen and a cook fire (at a shelter or camp, its own fire) take bills, as in RimWorld: pick a recipe, then <i>Do N times</i>, <i>Do until you have N</i> or <i>Do forever</i>, an ingredient filter (fresh only or also dry and preserved food, no human meat, what spoils first or the cheapest first, any item left out) and pause. The list is the order of work: the cooks take the first bill that can go. A new Kitchen starts with <i>Simple meal, until you have ${COOK.autoDays} days of eating</i>. The Kitchen's cooks work its bills (a fixed Cook ${COOK.fullDay} hours a day, a part-time cook their cooking hours); a cook fire is tended ${COOK.fireHours} hours a day by whoever cooks best at home, burning ${COOK.fireWood} wood an hour (a shelter's lit fire is free). Work goes at ${Math.round(COOK.speed.base * 100)}% at Cooking 0 up to ${Math.round(COOK.speed.max * 100)}% at 20.<br><br>
<b>Recipes.</b> Meals are more filling than their makings and spoil in days (a cold room or a freezer keeps them longer). Every recipe takes purified water (un-purified is boiled for the pot at ${COOK.boilWood} wood a water when the purified runs out).<br>${rows.join("<br>")}<br><br>
<b>Cookbooks.</b> Found in houses, schools, colleges, malls, diners and restaurants, lodges and cabins, and sold by traders. Read one to the end (the Read role) and the cooks may make its meals below the usual Cooking (a little slower and more often bad), and its meals go ${Math.round(COOK.bookSpeed * 100)}% faster. They also teach Cooking.<br><br>
<b>A clean kitchen.</b> Every hour of cooking dirties a station (+${COOK.dirt.perHour}); with <i>Clean first</i> on the cooks spend up to ${Math.round(COOK.dirt.share * 100)}% of their day scrubbing before they cook. Dirt makes food poisoning up to ${1 + POISON.dirt} times as likely.<br><br>
<b>Food poisoning.</b> Vomiting and cramps: off work about a day (an illness: the sick rest), a low mood, now and then a bad case for a few days. A day of a meal's food gives it at ${Math.round(skillPz(0) * 1000) / 10}% from a Cooking 0 cook, ${Math.round(skillPz(5) * 1000) / 10}% at 5, ${Math.round(skillPz(10) * 1000) / 10}% at 10, × the dirt, more below a recipe's level with a cookbook; raw meat or fish eaten uncooked ${Math.round(POISON.raw * 100)}% a day of it, and game or greens with the worm's eggs eaten raw too. Iron Stomach halves it. 1 meds ends it at once; automatic care lets it pass.<br><br>
<b>Machines.</b> The grain mill (flour from grain) and the meat grinder (ground meat and sausage) are hand-cranked machines on a utility plot: no power, a machine part to build, and they wear on the days they turn. The vacuum sealer packs survival meals while it has power.<br><br>
<b>Camp fires.</b> Every lit fire burns wood (a camp's or shelter's ${WOOD.fire.shelter} a day from its store, a team's ${WOOD.fire.camp} a day from what it carries; deadfall about × ${WOOD.fire.deadfall}) and goes out when there is none left; a camp or shelter cooks on its own fire only on days it burned. Days with no hot food sour the mood.<br><br>
<b>Camp cook pot.</b> Crafted from 3 scrap by anyone (Cooking 0, anywhere, a team too). Kept at a base with no Kitchen and no cook fire (in its armory or carried by someone there) it is a Camp fire station for the small meals (simple meal, stew), tended ${COOK.fireHours} hours a day and burning ${COOK.fireWood} wood an hour.<br><br>
<b>On the road.</b> A team at a lit, fed camp fire roasts its raw meat and fish into simple meals (a little purified water each); with a camp cook pot it cooks any fresh food it carries (forage, vegetables, eggs, meat, fish) into simple meals. <b>Other groups</b> cook in their kitchens by the same recipes, coarsely: simple and fine meals, survival meals with a sealer, bread with a mill, sausage with a grinder; their cooks' poisonings make people ill.`;
}
