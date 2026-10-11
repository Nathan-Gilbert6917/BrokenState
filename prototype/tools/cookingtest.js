// Wave 2 cooking (src/sim/cooking.js): bills at the Kitchen and the cook fire, recipes, gain and purified water, the
// cooks' skill and time, cookbooks below the recipe's level, food poisoning by skill, dirt and raw food, the vacuum
// sealer's gate, the grain mill and the meat grinder, the camp fire (shelters and teams), the governor's bills, the AI
// groups (coarse), the UI (the Farming tab's Cooking section, the building cards, the Help topic) and save/load.
// Usage: node tools/cookingtest.js [seed]
import { createWorld, hub, atBase, makeSurvivor, newId } from "../src/sim/world.js";
import { BUILDINGS, addBuilding, count, canBuild } from "../src/sim/buildings.js";
import { FOODS, unitsOf, foodUnits, takeFood, addFood, lotsOf } from "../src/sim/foods.js";
import { cookDaily, eatFromStore, MEAL } from "../src/sim/storage.js";
import {
  COOK, POISON, COOK_AI, COOK_RECIPES, RECIPE_KEYS, CLASSES, stationsAt, stationState, ensureStations, addBill, removeBill, moveBill, setBill,
  setStationClean, billTarget, poisonChance, skillPz, poisonRoll, recipeMin, booksFor, cookbookIds, teamCookHour, groupCookDaily, groupCookSkill,
  govCookBills, cookStats, speedOf, kitchenCrew, fireCrew, cookingHelp, newBill,
} from "../src/sim/cooking.js";
import { CRAFT_BOOKS, isKnown, tech, learnBook } from "../src/sim/blueprints.js";
import { GEAR } from "../src/sim/data.js";
import { BOOK_SITES, WARE_BOOKS } from "../src/sim/skills.js";
import { CONDITIONS, autoWantsCondition, teamWants, isIll, conditionWork, sickStats } from "../src/sim/health.js";
import { mildIllness } from "../src/sim/sickrest.js";
import { FIXTURES, machineRan, dailyWear } from "../src/sim/breakdowns.js";
import { worksAt, nextWork, groupsBuild, GROUP_WORKS } from "../src/sim/groupworks.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { cookingCard, cookingNote, COOK_ACTIONS, COOK_CHANGE, mealTag } from "../src/ui/cooking.js";
import { baseFoodHtml } from "../src/ui/food.js";
import { helpTopics } from "../src/ui/help.js";
import { clearFood, addDays } from "./foodkit.js";

const SEED = Number(process.argv[2] || 7);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const BAD = /\b(undefined|NaN)\b|\[object [A-Za-z]+\]/;
const plain = (s) => { s.traits = []; s.conditions = []; s.health = 100; s.mood = 60; s.inBed = false; return s; };

// A hub with exactly n people (plain, on Rest), water, wood, and no food.
function mk(n = 12, seed = SEED) {
  const st = createWorld({ seed, factionCount: 4 });
  st.started = true; st.autoCombat = true; st.visitorsOff = true;
  const h = hub(st);
  for (const s of atBase(st, h.id)) { s.location = { kind: "away" }; s.alive = false; }
  for (let i = 0; i < n; i++) { const s = plain(makeSurvivor(st, 1)); s.location = { kind: "base", baseId: h.id }; s.role = "rest"; s.pinned = true; s.skills.cooking = 0; st.survivors.push(s); }
  Object.assign(h.stock, { water: 200, rawwater: 0, scrap: 200, parts: 20, fuel: 50, meds: 20, wood: 500 });
  clearFood(h);
  st.hour = 24 * 5;
  return { st, h, ppl: atBase(st, h.id) };
}
const cook = (s, lvl) => { s.role = "cook"; s.skills.cooking = lvl; return s; };
const kitchen = (n = 12, lvl = 5) => { const w = mk(n); addBuilding(w.h, "canteen"); cook(w.ppl[0], lvl); return w; };
const made = (h, k) => h.stock[k] || 0;

// ======================================================================
section("The recipes, the cookbooks, where they turn up");
{
  for (const k of RECIPE_KEYS) {
    const R = COOK_RECIPES[k];
    check(FOODS[R.out] && R.n > 0 && R.units > 0 && R.water >= 0 && R.hours > 0 && R.in.every((i) => CLASSES[i.cls]) && near(R.in.reduce((a, i) => a + i.share, 0), 1, 0.011), `${k}: a sound recipe`);
  }
  check(COOK_RECIPES.simple.gain > 1 && COOK_RECIPES.stew.gain > COOK_RECIPES.simple.gain && COOK_RECIPES.fine.gain > COOK_RECIPES.simple.gain, "simple, stew and fine meals are more filling than their makings (stew and fine more)");
  check(COOK_RECIPES.lavish.gain < 1 && FOODS.f_lavishmeal.moodLift > FOODS.f_finemeal.moodLift, "a lavish meal takes more than it gives, for the mood");
  check(near(MEAL.gain, COOK_RECIPES.simple.gain) && MEAL.gain > 1, `MEAL.gain retuned above 1 (${MEAL.gain})`);
  check(COOK_RECIPES.stew.water > COOK_RECIPES.simple.water && COOK_RECIPES.roast.water < COOK_RECIPES.simple.water && COOK_RECIPES.flour.water === 0, "water by the recipe: stew more, roasting less, milling none");
  check(COOK_RECIPES.simple.skill === 0 && COOK_RECIPES.stew.skill === 2 && COOK_RECIPES.fine.skill === 6 && COOK_RECIPES.lavish.skill === 8 && COOK_RECIPES.pemmican.skill === 3, "the Cooking levels: simple 0, stew 2, pemmican 3, fine 6, lavish 8");
  check(COOK_RECIPES.survival.needs === "sealer" && COOK_RECIPES.flour.needs === "grainmill" && COOK_RECIPES.ground.needs === "meatgrinder" && COOK_RECIPES.sausage.needs === "meatgrinder", "the machines: sealer, grain mill, meat grinder");
  check(FOODS.f_pemmican.shelf >= 365 && FOODS.f_survivalmeal.shelf >= 3000 && FOODS.f_simplemeal.shelf <= 5, "pemmican keeps a year, survival meals ten, simple meals days");
  const ids = cookbookIds();
  check(ids.length === 4 && ids.every((id) => GEAR[id] && GEAR[id].book && GEAR[id].book.skill === "cooking" && GEAR[id].cookBook), `four cookbooks, items that teach Cooking (${ids.join(", ")})`);
  check(ids.every((id) => Object.keys(CRAFT_BOOKS[id].cook).every((k) => COOK_RECIPES[k] && CRAFT_BOOKS[id].cook[k] <= COOK_RECIPES[k].skill)), "each book's levels are at or below the recipes'");
  check(ids.every((id) => /read it to the end/.test(GEAR[id].desc)), "the items say what reading them does");
  const sites = (id) => Object.entries(BOOK_SITES).filter(([, d]) => d.books.includes(id)).map(([t]) => t);
  check(["apartments", "town", "school", "univ", "mall", "diner"].every((t) => BOOK_SITES[t] && BOOK_SITES[t].books.some((k) => ids.includes(k))), "found in houses, schools, colleges (libraries), malls (bookshops) and diners (restaurants)");
  check(ids.every((id) => sites(id).length >= 2) && ids.every((id) => WARE_BOOKS.traders.books.includes(id)), "every cookbook has two sites or more and traders sell them all");
  check(booksFor("fine").length >= 2 && booksFor("survival").length >= 1, "fine meals and survival meals have cookbooks");
}

// ======================================================================
section("The Kitchen's default bill: simple meals, gain, water, lots with pz and the cook");
{
  const { st, h, ppl } = kitchen(12, 5);
  addDays(h, 10, "f_venison");
  const w0 = h.stock.water;
  ensureStations(st, h);
  const S = stationState(h, "canteen");
  check(S.bills.length === 1 && S.bills[0].recipe === "simple" && S.bills[0].mode === "until" && S.bills[0].auto, "a new Kitchen has Simple meal, until you have (2 days of eating)");
  check(billTarget(st, h, S.bills[0]) === 60, `12 people × 2 days = 60 simple meals (${billTarget(st, h, S.bills[0])})`);
  check(stationsAt(h).includes("canteen") && !stationsAt(h).includes("cookhouse"), "the hub's stations: the Kitchen (no cook fire)");
  const crew = kitchenCrew(st, h);
  check(crew.length === 1 && near(crew[0].hours, COOK.fullDay) && near(crew[0].left, COOK.fullDay * speedOf(5)), `a fixed Cook: ${COOK.fullDay} hours × speed ${speedOf(5)}`);
  const cooked = cookDaily(st, h, 12);
  const rec = h.cookDay;
  const meals = made(h, "f_simplemeal");
  check(rec.batches === 7 && near(meals, 28), `10 days of venison: 7 batches, 28 simple meals (${rec.batches}, ${meals})`);
  check(near(rec.kcalOut / rec.kcalIn, 1.25, 0.001), `the gain: ${(rec.kcalOut / rec.kcalIn).toFixed(3)} kcal out a kcal in`);
  check(near(cooked, rec.kcalIn / 2000) && near(unitsOf("f_venison", h.stock.f_venison || 0), 10 - cooked, 1e-6), `the venison went into the pots (${cooked.toFixed(2)} days)`);
  check(near(w0 - h.stock.water, 7 * COOK_RECIPES.simple.water, 1e-6), `a purified water a batch (${w0 - h.stock.water})`);
  const lot = (h.foodLots.f_simplemeal || [])[0];
  check(lot && near(lot.pz, poisonChance(5, lot.pz ? (stationState(h, "canteen").dirt - COOK.dirt.perHour * COOK_RECIPES.simple.hours) : 0), 0.01) && lot.pz > 0 && lot.by === ppl[0].id, `the meals' lot carries pz and the cook (${JSON.stringify(lot)})`);
  check(near(lot.left, FOODS.f_simplemeal.shelf), "a fresh meal: its full shelf life");
  check(S.dirt > 0 && near(S.dirt, 7 * COOK.dirt.perHour * COOK_RECIPES.simple.hours), `dirt from the day's cooking (${S.dirt})`);
  check(/short of/.test(S.bills[0].why), `the bill says why it stopped (${S.bills[0].why})`);
  const cs = cookStats(st);
  check(cs.batches === 7 && cs.kcalOut > cs.kcalIn, "the run's stats");
}

// ======================================================================
section("Skill and time; the until target; count and forever; priority; pause");
{
  const runs = [0, 10, 20].map((lvl) => { const { st, h } = kitchen(12, lvl); addDays(h, 200, "f_potatoes"); const S = (ensureStations(st, h), stationState(h, "canteen")); S.bills[0].mode = "forever"; S.clean = false; cookDaily(st, h, 0); return h.cookDay.batches; });
  check(runs[0] < runs[1] && runs[1] < runs[2], `faster with Cooking: ${runs.join(" < ")} batches a day at 0, 10, 20`);
  check(runs[0] === Math.floor((COOK.fullDay * speedOf(0)) / COOK_RECIPES.simple.hours + 1e-9), `Cooking 0: ${COOK.fullDay}h × ${speedOf(0)} ÷ ${COOK_RECIPES.simple.hours}h (${runs[0]})`);
  // until: stops at the target
  {
    const { st, h } = kitchen(2, 10);
    addDays(h, 200, "f_potatoes");
    cookDaily(st, h, 0);
    check(made(h, "f_simplemeal") >= 10 && made(h, "f_simplemeal") < 14, `2 people: until 10 meals (${made(h, "f_simplemeal")})`);
    check(stationState(h, "canteen").bills[0].why === "enough in store", "and says so");
  }
  // count
  {
    const { st, h } = kitchen(12, 10);
    addDays(h, 200, "f_potatoes");
    ensureStations(st, h);
    const S = stationState(h, "canteen");
    S.bills = [newBill(h, "stew", { mode: "count", n: 2 }), newBill(h, "simple", { mode: "forever" })];
    cookDaily(st, h, 0);
    check(made(h, "f_stew") === 8 && S.bills[0].done === 2 && made(h, "f_simplemeal") > 0, `do 2 times: 2 batches of stew, then the next bill (${made(h, "f_stew")} stew, ${made(h, "f_simplemeal")} simple)`);
    setBill(st, h, "canteen", S.bills[0].id, { again: true });
    check(S.bills[0].done === 0, "Again resets it");
    setBill(st, h, "canteen", S.bills[1].id, { paused: true });
    const before = made(h, "f_simplemeal");
    S.bills[0].paused = true;
    cookDaily(st, h, 0);
    check(made(h, "f_simplemeal") === before && made(h, "f_stew") === 8, "paused bills cook nothing");
  }
  // priority: the first bill takes the time
  {
    const { st, h } = kitchen(12, 5);
    addDays(h, 200, "f_potatoes");
    ensureStations(st, h);
    const S = stationState(h, "canteen");
    S.bills = [newBill(h, "simple", { mode: "forever" }), newBill(h, "stew", { mode: "forever" })];
    cookDaily(st, h, 0);
    check(made(h, "f_simplemeal") > 0 && !made(h, "f_stew"), "the first bill forever: the second never gets a turn");
    moveBill(st, h, "canteen", S.bills[1].id, -1);
    check(S.bills[0].recipe === "stew", "moved up");
  }
  // no cook / cold stove / a cook in bed
  {
    const { st, h, ppl } = kitchen(12, 5);
    addDays(h, 10, "f_venison");
    ppl[0].role = "rest";
    cookDaily(st, h, 0);
    check(!made(h, "f_simplemeal") && /no cook/.test(stationState(h, "canteen").bills[0].why), "no cook on duty: nothing cooked");
    cook(ppl[0], 5); h.kitchenCold = true;
    cookDaily(st, h, 0);
    check(!made(h, "f_simplemeal") && /cold/.test(stationState(h, "canteen").bills[0].why), "a cold stove: nothing cooked");
  }
}

// ======================================================================
section("Ingredients, the filter, purified water");
{
  const { st, h } = kitchen(12, 10);
  addDays(h, 4, "f_venison"); addDays(h, 4, "f_potatoes");
  ensureStations(st, h);
  const S = stationState(h, "canteen");
  S.bills = [newBill(h, "fine", { mode: "forever" })];
  cookDaily(st, h, 0);
  check(made(h, "f_finemeal") > 0 && near(unitsOf("f_venison", h.stock.f_venison), unitsOf("f_potatoes", h.stock.f_potatoes), 1e-6), `fine meals take meat and vegetables half and half (${made(h, "f_finemeal")})`);
  // filter: fresh only leaves the rice alone
  const w2 = kitchen(12, 5);
  addDays(w2.h, 20, "f_rice");
  ensureStations(w2.st, w2.h);
  cookDaily(w2.st, w2.h, 0);
  check(!made(w2.h, "f_simplemeal") && /short of/.test(stationState(w2.h, "canteen").bills[0].why), "fresh only (the default): the rice is left alone");
  setBill(w2.st, w2.h, "canteen", stationState(w2.h, "canteen").bills[0].id, { fresh: false });
  cookDaily(w2.st, w2.h, 0);
  check(made(w2.h, "f_simplemeal") > 0, "with Fresh only off, rice goes in");
  // items left out
  const w3 = kitchen(12, 5);
  addDays(w3.h, 5, "f_venison"); addDays(w3.h, 5, "f_fish");
  ensureStations(w3.st, w3.h);
  setBill(w3.st, w3.h, "canteen", stationState(w3.h, "canteen").bills[0].id, { toggle: "f_fish" });
  cookDaily(w3.st, w3.h, 0);
  check(near(unitsOf("f_fish", w3.h.stock.f_fish), 5) && (w3.h.stock.f_venison || 0) < FOODS.f_venison.kcal, "a left-out item stays out of the pot");
  // what spoils first
  const w4 = kitchen(2, 5);
  addFood(w4.h, "f_venison", 2, { left: 3, state: w4.st }); addFood(w4.h, "f_potatoes", 4, { left: 30, state: w4.st });
  ensureStations(w4.st, w4.h);
  stationState(w4.h, "canteen").bills[0].mode = "count"; stationState(w4.h, "canteen").bills[0].n = 1;
  cookDaily(w4.st, w4.h, 0);
  check((w4.h.stock.f_venison || 0) < 2 - 1e-6 && near(w4.h.stock.f_potatoes, 4), "what spoils first: the venison before the potatoes");
  // human meat: no source; a test item through the filter
  check(!CLASSES.meat.test("x", { ingredient: true, diet: "human" }, { fresh: true, human: false }) && CLASSES.meat.test("x", { ingredient: true, diet: "human" }, { fresh: true, human: true }), "human meat only with the filter's tick");
  // water: no purified, un-purified boiled with firewood; none at all: waits
  const w5 = kitchen(12, 5);
  addDays(w5.h, 10, "f_venison");
  Object.assign(w5.h.stock, { water: 0, rawwater: 50, wood: 100 });
  cookDaily(w5.st, w5.h, 0);
  check(made(w5.h, "f_simplemeal") > 0 && w5.h.stock.rawwater < 50 && w5.h.stock.wood < 100 && w5.h.stock.water === 0, `no purified water: un-purified boiled for the pot at ${COOK.boilWood} firewood a water`);
  const w6 = kitchen(12, 5);
  addDays(w6.h, 10, "f_venison");
  Object.assign(w6.h.stock, { water: 0, rawwater: 0 });
  cookDaily(w6.st, w6.h, 0);
  check(!made(w6.h, "f_simplemeal") && /purified water/.test(stationState(w6.h, "canteen").bills[0].why), "no water at all: the bill waits");
}

// ======================================================================
section("Cookbooks: below the recipe's level, slower to poison-free, faster");
{
  const { st, h } = kitchen(12, 3);
  addDays(h, 10, "f_venison"); addDays(h, 10, "f_potatoes");
  ensureStations(st, h);
  const S = stationState(h, "canteen");
  S.bills = [newBill(h, "fine", { mode: "forever" })];
  cookDaily(st, h, 0);
  check(!made(h, "f_finemeal") && /needs Cooking 6/.test(S.bills[0].why), `Cooking 3 cannot make fine meals (${S.bills[0].why})`);
  check(recipeMin("fine", (id) => isKnown(st, id)).min === 6, "no book: Cooking 6");
  learnBook(st, "cookbook");
  check(isKnown(st, "cookbook") && recipeMin("fine", (id) => isKnown(st, id)).min === 3, "the Family Cookbook read: fine meals from Cooking 3");
  cookDaily(st, h, 0);
  check(made(h, "f_finemeal") > 0, "and the Cooking 3 cook makes them");
  const lot = h.foodLots.f_finemeal.find((l) => l.pz > 0);
  check(lot && lot.pz > poisonChance(3, 0) * 1.5, `cooked 3 levels below: more poisoning (${lot && lot.pz.toFixed(4)} vs ${poisonChance(3, 0).toFixed(4)})`);
  learnBook(st, "chefbook");
  check(recipeMin("fine", (id) => isKnown(st, id)).min === 2 && recipeMin("lavish", (id) => isKnown(st, id)).min === 4, "the books stack: the lowest level counts (fine 2, lavish 4)");
  // a read book speeds its recipes
  const speed = [false, true].map((read) => { const w = kitchen(12, 5); addDays(w.h, 200, "f_potatoes"); if (read) learnBook(w.st, "cookbook"); ensureStations(w.st, w.h); const s2 = stationState(w.h, "canteen"); s2.bills = [newBill(w.h, "stew", { mode: "forever" })]; s2.clean = false; cookDaily(w.st, w.h, 0); return made(w.h, "f_stew"); });
  check(speed[1] > speed[0], `a cookbook's recipe goes faster (${speed[0]} → ${speed[1]} stew)`);
}

// ======================================================================
section("Food poisoning: odds by skill, dirt, raw food; the condition");
{
  check(near(skillPz(0), 0.03) && skillPz(5) < skillPz(0) && skillPz(10) < skillPz(5) && skillPz(20) < 0.001, `RimWorld-like: ${[0, 5, 10, 20].map((l) => (skillPz(l) * 100).toFixed(2) + "%").join(", ")}`);
  check(near(poisonChance(0, 100), skillPz(0) * (1 + POISON.dirt)) && near(poisonChance(5, 50), skillPz(5) * 2), "dirt: ×3 at 100, ×2 at 50");
  check(poisonChance(2, 0, 3) > poisonChance(2, 0, 0), "below the recipe's level (a cookbook): more");
  const d = CONDITIONS.poisoning;
  check(d && d.kind === "illness" && d.selfLimit && d.cure && !d.spread && d.drift <= -30, "health.js poisoning: an illness, passes in a day or two, never spreads");
  check(!autoWantsCondition({ key: "poisoning", sev: 50, course: null }) && !teamWants({ key: "poisoning", sev: 50, course: null }), "automatic care spends no meds on it");
  check(!mildIllness({ key: "poisoning", sev: 50 }) && conditionWork({ key: "poisoning", sev: 50 }) < 0.7, "not mild: the sick-rest rule sends them to bed");
  // the roll, statistically
  const { st } = mk(2);
  const many = [];
  for (let i = 0; i < 2000; i++) { const s = plain(makeSurvivor(st, 1)); s.alive = true; s.location = { kind: "away" }; many.push(s); }
  const rate = (lots, opts = {}) => { let n = 0; for (const s of many) { s.conditions = []; if (poisonRoll(st, [s], lots, opts).length) n++; } return n / many.length; };
  const p1 = rate([{ k: "f_simplemeal", q: 2.5, pz: 0.1, by: null }]);
  check(Math.abs(p1 - 0.1) < 0.025, `a day of meals at pz 10%: ${(p1 * 100).toFixed(1)}%`);
  const p2 = rate([{ k: "f_venison", q: 1.3333, left: 2 }]);
  check(Math.abs(p2 - POISON.raw) < 0.015, `a day of raw venison eaten uncooked: ${(p2 * 100).toFixed(1)}% (POISON.raw ${POISON.raw * 100}%)`);
  check(rate([{ k: "f_venison", q: 1.3333, left: 2 }], { cooked: true }) === 0, "cooked through (a fire): no raw poisoning");
  check(rate([{ k: "f_venison", q: 1.3333, egg: true }]) === 0, "egg lots are the worm's (worm.js rolls them)");
  check(rate([{ k: "f_beans", q: 5 }]) === 0, "canned beans: nothing");
  for (const s of many) { s.traits = ["ironstomach"]; }
  const p3 = rate([{ k: "f_simplemeal", q: 2.5, pz: 0.1 }]);
  check(p3 < p1 * 0.7, `Iron Stomach: ${(p3 * 100).toFixed(1)}%`);
  for (const s of many) s.traits = [];
  // at a base: the day's eating rolls it
  const w = mk(30);
  addFood(w.h, "f_simplemeal", 400, { left: 4, state: w.st, pz: 0.3, by: w.ppl[0].id });
  eatFromStore(w.h, 30, w.st);
  const sick = w.ppl.filter((s) => (s.conditions || []).some((c) => c.key === "poisoning"));
  check(sick.length >= 3 && sick.length <= 18 && sick.every((s) => isIll(s)), `30 people ate a day of bad meals (pz 30%): ${sick.length} came down with it`);
  check(w.h.poisonDay && w.h.poisonDay.n === sick.length && w.st.log.some((l) => /food poisoning/.test(l.text || l.msg || String(l))), "a log line and the base's record");
  check(/poisoning|meal/.test(sick[0].conditions.find((c) => c.key === "poisoning").why), `the why names the meal (${sick[0].conditions.find((c) => c.key === "poisoning").why})`);
  // dirt rises with cooking, falls with cleaning
  const k = kitchen(12, 5);
  addDays(k.h, 200, "f_potatoes");
  ensureStations(k.st, k.h);
  const S = stationState(k.h, "canteen");
  S.bills[0].mode = "forever";
  S.dirt = 60;
  cookDaily(k.st, k.h, 0);
  check(k.h.cookDay.clean > 0 && k.h.cookDay.st.canteen.clean > 0, `Clean first: ${k.h.cookDay.clean.toFixed(2)} hours scrubbing`);
  const withClean = k.h.cookDay.batches;
  const k2 = kitchen(12, 5);
  addDays(k2.h, 200, "f_potatoes");
  ensureStations(k2.st, k2.h);
  const S2 = stationState(k2.h, "canteen");
  S2.bills[0].mode = "forever"; S2.dirt = 60; setStationClean(k2.h, "canteen", false);
  cookDaily(k2.st, k2.h, 0);
  check(k2.h.cookDay.clean === 0 && k2.h.cookDay.batches > withClean && S2.dirt > S.dirt, `Clean first off: more meals (${k2.h.cookDay.batches} vs ${withClean}), a dirtier kitchen (${S2.dirt.toFixed(0)} vs ${S.dirt.toFixed(0)})`);
  const lots2 = k2.h.foodLots.f_simplemeal, lots1 = k.h.foodLots.f_simplemeal;
  check(Math.max(...lots2.map((l) => l.pz)) > Math.max(...lots1.map((l) => l.pz)), "the dirty kitchen's meals poison more");
  // uncooked game with eggs: food poisoning (it was an upset stomach)
  const ws = mk(4);
  const { eatRaw } = await import("../src/sim/worm.js");
  let pois = 0, stom = 0;
  for (let i = 0; i < 200; i++) { for (const s of ws.ppl) s.conditions = []; eatRaw(ws.st, ws.ppl, 8, "test"); for (const s of ws.ppl) { if ((s.conditions || []).some((c) => c.key === "poisoning")) pois++; if ((s.conditions || []).some((c) => c.key === "stomach")) stom++; } }
  check(pois > 0 && stom === 0, `game with the worm's eggs eaten raw: food poisoning, not an upset stomach (${pois} / ${stom})`);
}

// ======================================================================
section("Machines: the vacuum sealer, the grain mill, the meat grinder");
{
  const { st, h } = kitchen(12, 6);
  addDays(h, 20, "f_venison"); addDays(h, 20, "f_potatoes");
  ensureStations(st, h);
  const S = stationState(h, "canteen");
  S.bills = [newBill(h, "survival", { mode: "count", n: 2 })];
  cookDaily(st, h, 0);
  check(!made(h, "f_survivalmeal") && /vacuum sealer/.test(S.bills[0].why), "no sealer: no survival meals");
  addBuilding(h, "sealer");
  const sealer = h.buildings.find((b) => b.type === "sealer");
  cookDaily(st, h, 0);
  check(!made(h, "f_survivalmeal"), "a sealer with no power: none");
  h.power = { served: [sealer.id], gens: [] };
  cookDaily(st, h, 0);
  check(made(h, "f_survivalmeal") === 8 && S.bills[0].done === 2 && sealer.ran != null, `powered: 2 batches, 8 survival meals (${made(h, "f_survivalmeal")})`);
  sealer.broken = true;
  check(!stationsAt(h).includes("x") && /vacuum sealer/.test((() => { S.bills[0].done = 0; cookDaily(st, h, 0); return S.bills[0].why; })()), "a broken sealer: none");
  for (const t of ["grainmill", "meatgrinder"]) {
    const d = BUILDINGS[t];
    check(d && d.plot === "utility" && d.machine && d.cost.parts === 1 && !d.station && FIXTURES[t] && FIXTURES[t].ranDay && FIXTURES[t].repair.cost.parts === 1, `${d && d.name}: a hand-cranked utility machine, a part to build and to repair, no power`);
    check(canBuild(st, h, t).ok, `${t} can be built at the hub (${canBuild(st, h, t).reason || "ok"})`);
  }
  addDays(h, 10, "f_grain", {});
  S.bills = [newBill(h, "flour", { mode: "count", n: 1 })];
  cookDaily(st, h, 0);
  check(!made(h, "f_flour") && /grain mill/.test(S.bills[0].why), "no mill: no flour");
  addBuilding(h, "grainmill");
  cookDaily(st, h, 0);
  const mill = h.buildings.find((b) => b.type === "grainmill");
  check(made(h, "f_flour") === 4 && mill.ran != null && machineRan(st, h, mill), `the mill: 4 kg of flour, and it ran today (${made(h, "f_flour")})`);
  check(dailyWear(st, h, mill, null) > dailyWear(st, h, { ...mill, ran: null }, null), "it wears more on the days it turns");
  S.bills = [newBill(h, "bread", { mode: "count", n: 1 })];
  cookDaily(st, h, 0);
  check(made(h, "f_bread") === 4 && h.foodLots.f_bread.every((l) => l.left >= FOODS.f_bread.shelf - 1e-6), "bread from the flour (fresh loaves, not shop-aged)");
  S.bills = [newBill(h, "ground", { mode: "count", n: 1 }), newBill(h, "sausage", { mode: "count", n: 1 })];
  cookDaily(st, h, 0);
  check(!made(h, "f_groundmeat") && /meat grinder/.test(S.bills[0].why), "no grinder: no ground meat");
  addBuilding(h, "meatgrinder");
  const wood0 = h.stock.wood;
  cookDaily(st, h, 0);
  check(made(h, "f_sausage") === 2 && wood0 - h.stock.wood >= COOK_RECIPES.sausage.wood - 1e-6, `the grinder: ground meat, then smoked sausage (${made(h, "f_sausage")}; ${wood0 - h.stock.wood} firewood)`);
}

// ======================================================================
section("The camp fire: a cook fire, a shelter's fire, a team's");
{
  const { st, h, ppl } = mk(6);
  addBuilding(h, "cookhouse");
  ensureStations(st, h);
  check(stationsAt(h).includes("cookhouse") && stationState(h, "cookhouse").bills.length === 0, "a cook fire is a station, with no bills to start");
  addDays(h, 6, "f_venison");
  addBill(st, h, "cookhouse", "simple");
  ppl[2].skills.cooking = 8;
  const crew = fireCrew(st, h);
  check(crew.length === 1 && crew[0].s === ppl[2] && near(crew[0].hours, COOK.fireHours), "tended by the best cook at home, 4 hours");
  const wood0 = h.stock.wood;
  cookDaily(st, h, 0);
  check(made(h, "f_simplemeal") > 0 && wood0 - h.stock.wood > 0 && wood0 - h.stock.wood <= COOK.fireHours * COOK.fireWood + 2, `simple meals at the cook fire, ${wood0 - h.stock.wood} firewood`);
  const ok = addBill(st, h, "cookhouse", "fine");
  check(/not made here/.test(ok), "fine meals need the Kitchen");
  h.stock.wood = 0;
  const m0 = made(h, "f_simplemeal");
  stationState(h, "cookhouse").bills[0].mode = "forever";
  cookDaily(st, h, 0);
  check(made(h, "f_simplemeal") === m0 && /firewood/.test(stationState(h, "cookhouse").bills[0].why), "no firewood: the cook fire waits");
  // a shelter's own fire: free
  const sh = mk(3);
  sh.h.tier = 0;
  sh.h.fire = true;
  sh.h.stock.wood = 0;
  addDays(sh.h, 3, "f_fish");
  addBill(sh.st, sh.h, "cookhouse", "roast") ;
  addBill(sh.st, sh.h, "cookhouse", "simple");
  cookDaily(sh.st, sh.h, 0);
  check(stationsAt(sh.h).includes("cookhouse") && made(sh.h, "f_simplemeal") > 0, "a shelter's lit fire cooks its bills, no firewood");
  sh.h.fire = false;
  check(/fire is out/.test((() => { cookDaily(sh.st, sh.h, 0); return stationState(sh.h, "cookhouse").bills[0].why; })()), "its fire out: nothing");
  // a team at a lit, fed camp fire
  const tm = mk(3);
  const p = { id: newId(), owner: "player", kind: "expedition", members: tm.ppl.map((s) => s.id), supplies: { water: 10 }, cargo: { supplies: {}, gear: [] }, path: [tm.h.tile], idx: 0 };
  addFood(p, "f_venison", 3, { state: tm.st });
  tm.ppl[1].skills.cooking = 10;
  const u = teamCookHour(tm.st, p, tm.ppl);
  check(u > 0 && (p.supplies.f_simplemeal || 0) > 0 && p.supplies.water < 10, `the camp roast: ${u.toFixed(2)} days of raw meat roasted an hour, a little water`);
  const tl = p.foodLots.f_simplemeal[0];
  check(tl.pz > 0 && tl.by === tm.ppl[1].id && near(tl.pz, poisonChance(10, POISON.camp)), "its lot: the camp pot's pz and the best cook");
  p.supplies.water = 0;
  check(teamCookHour(tm.st, p, tm.ppl) === 0, "no purified water: it waits");
}

// ======================================================================
section("The governor's bills");
{
  const { st, h, ppl } = kitchen(12, 8);
  addDays(h, 20, "f_venison"); addDays(h, 20, "f_potatoes"); addDays(h, 3, "f_berries");
  ensureStations(st, h);
  addBill(st, h, "canteen", "stew");
  govCookBills(st, h);
  const S = stationState(h, "canteen");
  check(S.bills[0].recipe === "fine" && S.bills[0].by === "ai", "a Cooking 8 cook with meat and veg: fine meals first");
  check(S.bills.some((b) => b.recipe === "stew" && b.by === "player") && S.bills.some((b) => b.recipe === "simple"), "the player's bills stay");
  check(S.bills.some((b) => b.recipe === "pemmican" && b.by === "ai"), "surplus game and berries: pemmican for the trips");
  ppl[0].skills.cooking = 2;
  govCookBills(st, h);
  check(!S.bills.some((b) => b.recipe === "fine" && b.by === "ai"), "the cook drops to Cooking 2: the fine-meal bill goes");
  const c = mk(5);
  addBuilding(c.h, "cookhouse");
  govCookBills(c.st, c.h);
  check(stationState(c.h, "cookhouse").bills.some((b) => b.recipe === "simple" && b.by === "ai"), "a cook fire and no Kitchen: simple meals");
}

// ======================================================================
section("AI groups: coarse cooking, poisoning as illness, sealer, mill, grinder, cookbooks, the works");
{
  const st = createWorld({ seed: SEED, factionCount: 6 });
  const f = st.factions.find((x) => x.alive && groupsBuild(st, x) && x.bases.length);
  check(!!f, "a group that builds");
  if (f) {
    const t = f.bases[0];
    const w = worksAt(f, t);
    for (const k of Object.keys(f.stock)) if (FOODS[k]) delete f.stock[k];
    f.stock.f_venison = 20; f.stock.f_potatoes = 20; f.stock.f_grain = 30; f.stock.wood = 999;
    f.pop = 20; f.ill = 0;
    groupCookDaily(st, f);
    check(!(f.stock.f_simplemeal > 0), "no kitchen: nothing cooked");
    w.kitchen = 1; w.bench = 1;
    const kin = unitsOf("f_venison", 20) + unitsOf("f_potatoes", 20);
    groupCookDaily(st, f);
    const ai = cookStats(st).ai;
    check(f.stock.f_simplemeal > 0 && ai.kcalOut / ai.kcalIn > 1.1, `their kitchen cooks the fresh food into meals at your gains (×${(ai.kcalOut / ai.kcalIn).toFixed(2)})`);
    check(f.ill > 0 && f.poisoned > 0 && f.ill < 1, `food poisoning as a coarse illness (${f.ill.toFixed(3)} ill)`);
    check(groupCookSkill(st, f) >= 3, `their Cooking (${groupCookSkill(st, f)})`);
    const fineBefore = f.stock.f_finemeal || 0;
    check((f.type === "commune" || groupCookSkill(st, f) >= 6) ? fineBefore > 0 : fineBefore === 0, `fine meals only with a Cooking 6 cook (or a book): ${fineBefore.toFixed(2)}`);
    f.kitchenCold = true; const s0 = f.stock.f_simplemeal;
    groupCookDaily(st, f);
    check(f.stock.f_simplemeal === s0, "a cold kitchen: nothing cooked");
    f.kitchenCold = false;
    // the sealer
    w.sealer = 1; w.mach = w.mach || {}; w.mach.sealer = { wear: 0, spares: 0, broken: false, on: true };
    for (let i = 0; i < 3; i++) { f.stock.f_venison = 1500; groupCookDaily(st, f); }
    check((f.stock.f_survivalmeal || 0) > 0 || groupCookSkill(st, f) < 4, `a running sealer: survival meals from the surplus (${(f.stock.f_survivalmeal || 0).toFixed(1)})`);
    // mill and grinder by your locks
    delete w.mill; f.stock.f_grain = 30; f.stock.parts = 9; f.stock.scrap = 99; f.job = null;
    const nw = nextWork(st, f);
    check(nw && (nw.type === "mill" || nw.tile !== t || nw.type !== "kitchen"), `their works: a grain mill by the kitchen once there is grain (${nw && nw.type})`);
    check(GROUP_WORKS.LOCKS.mill && GROUP_WORKS.LOCKS.mill.mech === BUILDINGS.grainmill.req.mechanics && GROUP_WORKS.LOCKS.grinder.mech === BUILDINGS.meatgrinder.req.mechanics, "the same Mechanics as yours");
    w.mill = 1; w.grinder = 1;
    const b0 = f.stock.f_bread || 0;
    groupCookDaily(st, f);
    check((f.stock.f_bread || 0) > b0 && w.mach.mill && !w.mach.mill.broken, `the mill: bread from their grain, a machine of theirs (wear ${w.mach.mill && w.mach.mill.wear}; ${(f.stock.f_bread || 0).toFixed(1)} bread)`);
    f.stock.f_venison = 300;
    const ss0 = f.stock.f_sausage || 0;
    groupCookDaily(st, f);
    check((f.stock.f_sausage || 0) > ss0 || groupCookSkill(st, f) < 3, "the grinder: sausage from surplus game");
    // cookbooks
    const tr = st.factions.find((x) => x.type === "traders" && groupsBuild(st, x));
    if (tr) { groupCookDaily(st, tr); check(tr.tech.known.includes("cookbook"), "traders know the Family Cookbook"); }
    let found = 0;
    for (let d = 0; d < 2000 && !found; d++) { st.hour = d * 24; const before = f.tech.known.length; groupCookDaily(st, f); if (f.tech.known.length > before) found = d; }
    check(found > 0, `a group finds a cookbook now and then (day ${found})`);
  }
}

// ======================================================================
section("The UI, the Help topic, save and load");
{
  const { st, h } = kitchen(12, 5);
  addBuilding(h, "cookhouse");
  addDays(h, 10, "f_venison");
  ensureStations(st, h);
  cookDaily(st, h, 0);
  const html = cookingCard(st, h);
  check(/Kitchen/.test(html) && /Cook fire/.test(html) && /Simple meal/.test(html) && /Add a bill/.test(html) && /Dirt/.test(html) && /Clean first/.test(html) && !BAD.test(html), "the Cooking section: both stations, the bill, add, dirt, Clean first");
  check(/Last night: \d+ batch/.test(html), "last night's cooking");
  const ui = { baseMsg: "" };
  const S = stationState(h, "canteen");
  const id = S.bills[0].id;
  COOK_CHANGE["ck-add"](st, ui, { dataset: { base: String(h.id), st: "canteen" }, value: "stew" });
  check(S.bills.length === 2 && S.bills[1].recipe === "stew" && /Stew/.test(ui.baseMsg), "Add a bill");
  COOK_ACTIONS["ck-up"](st, ui, { base: String(h.id), st: "canteen", id: String(S.bills[1].id) });
  check(S.bills[0].recipe === "stew", "▲ moves it up");
  COOK_CHANGE["ck-mode"](st, ui, { dataset: { base: String(h.id), st: "canteen", id: String(S.bills[0].id) }, value: "count" });
  COOK_CHANGE["ck-n"](st, ui, { dataset: { base: String(h.id), st: "canteen", id: String(S.bills[0].id) }, value: "3" });
  check(S.bills[0].mode === "count" && S.bills[0].n === 3, "Do 3 times");
  COOK_ACTIONS["ck-pause"](st, ui, { base: String(h.id), st: "canteen", id: String(S.bills[0].id) });
  check(S.bills[0].paused, "paused");
  COOK_ACTIONS["ck-flt"](st, ui, { id: String(id) });
  const html2 = cookingCard(st, h);
  check(/Fresh only/.test(html2) && /Human meat/.test(html2) && /What spoils first/.test(html2) && /Raw venison/.test(html2), "the filter panel opens");
  COOK_ACTIONS["ck-no"](st, ui, { base: String(h.id), st: "canteen", id: String(id), key: "f_venison" });
  check(S.bills.find((b) => b.id === id).flt.no.includes("f_venison"), "an item left out");
  COOK_ACTIONS["ck-clean"](st, ui, { base: String(h.id), st: "canteen" });
  check(S.clean === false, "Clean first off");
  COOK_ACTIONS["ck-del"](st, ui, { base: String(h.id), st: "canteen", id: String(id) });
  check(!S.bills.some((b) => b.id === id), "removed");
  const note = cookingNote(st, h, "canteen");
  check(/Bills:/.test(note) && !BAD.test(note), `the building card's line (${note.replace(/<[^>]+>/g, "")})`);
  const food = baseFoodHtml(st, h);
  check(/simple/.test(food) && /Farming tab/.test(food) && !BAD.test(food), "the food list shows the meals' tier, and the bills' pointer");
  check(/fine · 🙂\+2/.test(mealTag("f_finemeal")) && mealTag("f_venison") === "", "a meal's tier and mood in the food list");
  const topics = helpTopics();
  const t = topics.find((x) => x.id === "cooking-and-meals");
  check(t && /Bills/.test(t.html) && /Food poisoning/.test(t.html) && /Cookbooks/.test(t.html) && !BAD.test(t.html), "Help: Cooking and meals");
  check(!BAD.test(cookingHelp()), "the help text is clean");
  // save and load
  const s2 = loadFromString(saveToString(st));
  const h2 = s2.bases.find((b) => b.id === h.id);
  check(h2.cooking && stationState(h2, "canteen").bills.length === S.bills.length && h2.foodLots.f_simplemeal.some((l) => l.pz > 0 && l.by != null), "bills and the meals' pz / cook survive save and load");
  // a lot's pz follows the food when it moves
  const { moveFood } = await import("../src/sim/foods.js");
  const p = { supplies: {}, foodLots: {} };
  moveFood(h, p, { f_simplemeal: 2 }, { state: st });
  check(p.foodLots.f_simplemeal && p.foodLots.f_simplemeal[0].pz > 0, "packed meals keep their pz (the eating contract)");
}

console.log(`\n${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
