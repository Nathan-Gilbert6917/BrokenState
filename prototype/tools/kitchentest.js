// The Kitchen (src/sim/kitchen.js; buildings.js "canteen"), its cooks and its hot meals:
// - the building: a building plot, its cost, built from the queue; the old "kitchen" key is the Preserving room (it still
//   jars), the cook fire is unchanged; a kitchen cooks game and greens like a cook fire (the worm), cook or no cook;
// - no kitchen or no cook: the food is eaten as before; one cook per 12 people: −10% (−13% with Farming 10), partial with
//   too few cooks; a cook too ill to work feeds nobody;
// - the day: the eating at midnight is 10% lower, base.kitchenDay and the Work now panel's Cook row record the meals and
//   the food saved;
// - mood +1 (+1.5 with a Farming 6+ cook; the preserving room's stove +1, never both); a quarter of the drinking boiled;
// - the People tab's activity: the cooks' day (05:00 breakfast … 21:00 washing up), "Eating dinner at the kitchen";
// - work priorities: the Cook type (meals) staffs one per 12, older saves' default roles get it once;
// - the governor builds one at 8+ people and staffs its cooks; a steward's roles too;
// - AI groups: a kitchen at a base of 8+, their food a day −10%;
// - the UI: the Buildings tab's and Construction's Kitchen card, the Work now row; save and load.
// Usage: node tools/kitchentest.js [seed]
import { createWorld, tickHour, hub, atBase, makeSurvivor, newId, hourOfDay, day, residents } from "../src/sim/world.js";
import { BUILDINGS, addBuilding, canBuild, queueBuild, constructionHour, count } from "../src/sim/buildings.js";
import { KITCHEN, kitchenService, kitchenEatMult, hasKitchen, cooksWanted } from "../src/sim/kitchen.js";
import { foodUse } from "../src/sim/upkeep.js";
import { basesDaily } from "../src/sim/economy.js";
import { econStats } from "../src/sim/farming.js";
import { baseCooks, purifyCap, wormMeatAt } from "../src/sim/worm.js";
import { cookDaily } from "../src/sim/storage.js";
import { addDays, setFood, setJarred, clearFood } from "./foodkit.js"; // food by type (sim/foods.js): the meat with eggs is an egg lot
import { describeActivity, baseWork, workingActivity } from "../src/sim/activity.js";
import { moodFactors } from "../src/sim/relations.js";
import { workState, assignRole, planBase, WORK_TYPES, workHour } from "../src/sim/work.js";
import { governRoles, setAutopilot } from "../src/sim/autopilot.js";
import { nextWork, groupEatMult, groupCookShare, worksAt, groupsBuild, GROUP_WORKS } from "../src/sim/groupworks.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { renderModal } from "../src/ui/ui.js";
import { workNowPanel } from "../src/ui/activity.js";
import { kitchenNote } from "../src/ui/kitchen.js";
import { baseNeeds, planIdle } from "../src/sim/idlework.js";
// kitchen-plus (2026-10-10): firewood, part-time fixed cooks, the Cooking skill, the cook fire down, the kitchen's slot, AI parity.
import { kitchenWood, kitchenCanLight, kitchenCold, cookShiftHour, cooksHour, cookPlusOf, isCookHour, COOK_SECOND, jobShare } from "../src/sim/kitchen.js";
import { farmLabour } from "../src/sim/farming.js";
import { workFactor } from "../src/sim/health.js";
import { woodNeed } from "../src/sim/woodcutting.js";
import { applyRoleChoice, roleSelect } from "../src/ui/work.js";
import { upkeepLine, woodLine } from "../src/ui/farming.js";
import { skillsDaily, PERK_TREE, PERKS, ensureSkills } from "../src/sim/skills.js";
import { SKILLS, SKILL_NAMES } from "../src/sim/data.js";
import { skill, fillCooking } from "../src/sim/world.js";
import { cookingOldSave } from "../src/sim/appearance.js";
import { traitSkill } from "../src/sim/traits.js";
import { HC_START } from "../src/sim/hardcore-start.js";
import { cookFireRedundant, governBase, safetyAI } from "../src/sim/autopilot.js";
import { groupKitchenWood, groupKitchenDaily, groupKitchenGrowth, groupKitchenMorale, groupKitchenText } from "../src/sim/groupworks.js";
import { desertPressure } from "../src/sim/groupcare.js";
import { groupCardExtras } from "../src/ui/diplomacy.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const BAD = /\b(undefined|NaN)\b|\[object [A-Za-z]+\]/;
const plain = (s) => { s.traits = []; s.conditions = []; s.health = 100; s.mood = 60; s.inBed = false; return s; };
const freshUi = (extra = {}) => ({ started: true, speed: 0, tab: "people", selected: -1, survivor: null, baseView: null, expedition: null, diary: null, roster: null, help: false, ...extra });

// A hub with exactly n people (everyone plain, on Rest), plenty of stores, no cold.
function mk(n = 12, seed = SEED) {
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true; st.autoCombat = true; st.visitorsOff = true;
  const h = hub(st);
  for (const s of atBase(st, h.id)) { s.location = { kind: "away" }; s.alive = false; }
  for (let i = 0; i < n; i++) { const s = plain(makeSurvivor(st, 1)); s.location = { kind: "base", baseId: h.id }; s.role = "rest"; s.pinned = true; st.survivors.push(s); }
  Object.assign(h.stock, { water: 600, scrap: 200, parts: 20, fuel: 50, meds: 20, wood: 2000 });
  setFood(h, 2000); // food by type (sim/foods.js): ration bars
  return { st, h, ppl: atBase(st, h.id) };
}
const cook = (s, cooking = 3) => { s.role = "cook"; s.skills.cooking = cooking; return s; }; // kitchen-plus: the Cooking skill

// ======================================================================
section("The building");
{
  const d = BUILDINGS.canteen;
  check(d && d.name === "Kitchen" && d.plot === "building" && d.max === 1 && d.cost.scrap === 20 && d.cost.parts === 1 && d.hours === 24, `the Kitchen: building plot, 20 scrap + a part, 24 hours (${JSON.stringify(d && d.cost)} ${d && d.hours}h)`);
  check(BUILDINGS.kitchen.name === "Preserving room" && BUILDINGS.kitchen.station === "preserve", "the old key `kitchen` is the Preserving room and still jars food");
  check(BUILDINGS.cookhouse.name === "Cook fire" && BUILDINGS.cookhouse.plot === "utility", "the cook fire unchanged");
  const { st, h } = mk(10);
  check(canBuild(st, h, "canteen").ok, `can be built at the hub (${canBuild(st, h, "canteen").reason || "ok"})`);
  const before = h.stock.scrap;
  queueBuild(st, h, "canteen");
  check(h.construction.some((c) => c.type === "canteen") && h.stock.scrap === before - 20, "queued and paid");
  check(!canBuild(st, h, "canteen").ok, "only one");
  const b = atBase(st, h.id).slice(0, 3);
  for (const s of b) { s.role = "build"; s.pinned = true; }
  for (let i = 0; i < 60 && !count(h, "canteen"); i++) { st.hour++; constructionHour(st); }
  check(count(h, "canteen") === 1, "built by the builders");
  check(baseCooks(h), "a kitchen cooks like a cook fire (the worm)");
  addDays(h, 5, "f_venison", { egg: true });
  cookDaily(st, h, 5);
  check(wormMeatAt(h) === 0, "the game with the worm's eggs is cooked through, cook or no cook");
}

// ======================================================================
section("Food: no kitchen, no cook, one cook per 12, skill, a sick cook");
{
  const { st, h, ppl } = mk(12);
  const base0 = foodUse(st, h).residents;
  cook(ppl[0]);
  check(near(foodUse(st, h).residents, base0) && kitchenEatMult(st, h) === 1, "a cook with no kitchen changes nothing");
  check(workingActivity(st, ppl[0]).kind === "stalled" && /no kitchen/.test(workingActivity(st, ppl[0]).text), `a cook with no kitchen is stalled (${workingActivity(st, ppl[0]).text})`);
  ppl[0].role = "rest";
  addBuilding(h, "canteen");
  check(near(foodUse(st, h).residents, base0) && kitchenService(st, h).cover === 0, "a kitchen with no cook: the food is eaten as before");
  check(cooksWanted(st, h) === 1, "12 people want one cook");
  cook(ppl[0], 3);
  let ks = kitchenService(st, h);
  check(ks.cover === 1 && near(ks.save, 0.1) && ks.served === 12, `one cook feeds 12: −10% (${ks.save})`);
  check(near(foodUse(st, h).residents, base0 * 0.9), `foodUse ×0.9 (${base0} → ${foodUse(st, h).residents})`);
  cook(ppl[0], 10);
  ks = kitchenService(st, h);
  check(near(ks.save, KITCHEN.saveMax) && near(ks.save, 0.13), `Cooking 10: −13% (${ks.save})`);
  check(ks.mood === KITCHEN.moodSkilled && ks.mood === 1.5, "Cooking 6+: +1.5 mood");
  cook(ppl[0], 3);
  for (let i = 0; i < 12; i++) { const s = plain(makeSurvivor(st, 1)); s.location = { kind: "base", baseId: h.id }; s.role = "rest"; s.pinned = true; st.survivors.push(s); }
  ks = kitchenService(st, h);
  check(cooksWanted(st, h) === 2 && near(ks.cover, 0.5) && near(ks.save, 0.05) && ks.served === 12, `24 people, one cook: half fed, −5% (${ks.cover}, ${ks.save})`);
  cook(atBase(st, h.id)[1], 2);
  check(kitchenService(st, h).cover === 1, "two cooks feed 24");
  atBase(st, h.id)[1].inBed = true;
  check(near(kitchenService(st, h).cover, 0.5), "a cook in a hospital bed feeds nobody");
}

// ======================================================================
section("The day: eating, the record, the Work now row");
{
  const pair = [mk(12), mk(12)];
  addBuilding(pair[1].h, "canteen");
  cook(pair[1].ppl[0], 3);
  for (const { st, h } of pair) { st.hour = 24 * 3; setFood(h, 150); setJarred(h, 0); }
  const eat = pair.map(({ st }) => { const e0 = econStats(st).eaten; basesDaily(st); return econStats(st).eaten - e0; });
  console.log(`  a day's food at a 12-person hub: ${eat[0].toFixed(2)} without a kitchen, ${eat[1].toFixed(2)} with a cook`);
  check(near(eat[1], eat[0] * 0.9, 0.01), `the kitchen's hub ate 10% less (${eat[1].toFixed(2)} vs ${eat[0].toFixed(2)})`);
  const { st, h } = pair[1];
  const kd = h.kitchenDay;
  check(kd && kd.cooks === 1 && kd.served === 12 && kd.meals === 24 && kd.saved > 1 && kd.saved < 1.6, `base.kitchenDay: ${JSON.stringify(kd)}`);
  check(!pair[0].h.kitchenDay, "no record without a kitchen");
  const row = baseWork(st, h).find((r) => r.job === "cook");
  check(row && row.name === "Cook" && row.progress && /Hot meals for 12 of 12/.test(row.progress.text), `the Work now panel's Cook row (${row && row.progress && row.progress.text})`);
  check(row && row.last.length && /24 hot meals/.test(row.last[0].text) && /food saved/.test(row.last[0].text), `what it brought in: ${row && row.last[0] && row.last[0].text}`);
  const panel = workNowPanel(st, h);
  check(/Cook/.test(panel) && /hot meals/.test(panel) && !BAD.test(panel), "the panel shows it");
}

// ======================================================================
section("Mood and water");
{
  const { st, h, ppl } = mk(12);
  const hot = (s) => moodFactors(st, s).list.find((f) => /Hot meals/.test(f.label));
  check(!hot(ppl[3]), "no kitchen: no hot meals");
  addBuilding(h, "canteen");
  check(!hot(ppl[3]), "a kitchen with no cook: no hot meals");
  cook(ppl[0], 3);
  check(hot(ppl[3]) && hot(ppl[3]).v === 1 && /kitchen/.test(hot(ppl[3]).label), `a cook: +1 (${hot(ppl[3]) && hot(ppl[3]).label})`);
  cook(ppl[0], 7);
  check(hot(ppl[3]).v === 1.5, "a Cooking 6+ cook: +1.5");
  addBuilding(h, "kitchen");
  check(moodFactors(st, ppl[3]).list.filter((f) => /Hot meals/.test(f.label)).length === 1 && hot(ppl[3]).v === 1.5, "with a preserving room too: the kitchen's only");
  ppl[0].role = "rest";
  check(!hot(ppl[3]), "a preserving room alone: no hot meals (kitchen-plus pick 4: only the Kitchen serves them)");
  cook(ppl[0], 3);
  const cap = purifyCap(st, h);
  check(near(cap.kitchen, cap.drink * KITCHEN.boil, 0.02) && cap.kitchen > 0, `a quarter of the drinking boiled for the meals (${cap.kitchen} of ${cap.drink})`);
  addBuilding(h, "boiler");
  check(purifyCap(st, h).kitchen === 0, "nothing extra where the boiler boils it all");
}

// ======================================================================
section("The People tab: the cooks' day and the meals");
{
  const { st, h, ppl } = mk(12);
  addBuilding(h, "canteen");
  const c = cook(ppl[0]);
  const other = ppl[3];
  other.role = "rest"; other.pinned = true;
  const at = (s, hr) => describeActivity(st, s, hr);
  check(at(c, 5).text === "Cooking breakfast" && at(c, 5).kind === "work" && at(c, 5).job === "cook", `05:00 ${at(c, 5).text}`);
  check(at(c, 6).text === "Serving breakfast", `06:00 ${at(c, 6).text}`);
  check(at(c, 12).kind === "work" && /bread/.test(at(c, 12).text), `12:00 ${at(c, 12).text}`);
  check(at(c, 17).text === "Cooking dinner", `17:00 ${at(c, 17).text}`);
  check(at(c, 20).text === "Serving dinner", `20:00 ${at(c, 20).text}`);
  check(at(c, 23).kind === "sleep", `23:00 ${at(c, 23).text}`);
  check(at(other, 20).kind === "eat" && at(other, 20).text === "Eating dinner at the kitchen", `20:00 the others: ${at(other, 20).text}`);
  check(at(other, 6).text === "Eating breakfast at the kitchen", `06:00 ${at(other, 6).text}`);
  c.role = "rest";
  check(at(other, 20).text === "Eating dinner", `no cook: ${at(other, 20).text}`);
}

// ======================================================================
section("Work priorities: the Cook type");
{
  const { st, h, ppl } = mk(14);
  addBuilding(h, "canteen");
  const w = workState(st);
  const gen = w.roles.find((r) => r.name === "Generalist");
  check(WORK_TYPES.meals && WORK_TYPES.meals.role === "cook" && WORK_TYPES.meals.name === "Cook" && WORK_TYPES.cook.name === "Preserve", "the Cook type (meals) next to Preserve");
  check(gen.pri.meals === 3 && w.roles.find((r) => r.name === "Farmer").pri.meals === 2, "Generalist 3, Farmer 2");
  for (const s of ppl) { s.pinned = false; assignRole(st, s, gen.id); }
  st.hour = 24 * 2 + 17;
  planBase(st, h);
  const cooks = atBase(st, h.id).filter((s) => s.role === "cook");
  check(cooks.length === 2, `17:00, 14 people: two cooks (${cooks.length})`);
  check(cooks.every((s) => describeActivity(st, s).text === "Cooking dinner"), `a cook by priorities: ${describeActivity(st, cooks[0]).text}`);
  // Part-time: outside the cooking hours they work their other priorities, and still count as the day's cooks.
  st.hour = 24 * 3 + 10;
  planBase(st, h);
  check(!atBase(st, h.id).some((s) => s.role === "cook"), `10:00: nobody on Cook (${cooks.map((s) => s.role).join(", ")})`);
  check(cooks.every((s) => describeActivity(st, s).job !== "cook"), `10:00 the cooks do other work: ${describeActivity(st, cooks[0]).text}`);
  st.hour = 24 * 2 + 20; planBase(st, h);
  st.hour = 24 * 2 + 21; planBase(st, h);
  check(!atBase(st, h.id).some((s) => s.role === "cook"), "21:00: no washing-up block");
  for (const hr of KITCHEN.cookHours) { st.hour = 24 * 2 + hr; planBase(st, h); } // the day's cooking hours (the kitchen counts the hours they cooked)
  st.hour = 24 * 2 + 21; planBase(st, h);
  st.hour = 24 * 3; // midnight: the day's eating
  const ks = kitchenService(st, h);
  check(ks.cooks.length === 2 && ks.cover === 1, `at midnight the day's two priority cooks count (${ks.cooks.length}, cover ${ks.cover})`);
  st.hour = 24 * 4 + 1;
  check(kitchenService(st, h).cooks.length === 0, "a day later, without cooking again, they no longer count");
  // An older save's roles: the default roles get the Cook type once.
  delete gen.pri.meals; delete w.mealsV;
  workHour(st);
  check(gen.pri.meals === 3 && w.mealsV === 1, "an older save's Generalist gets Cook 3 once");
  delete gen.pri.meals;
  workHour(st);
  check(gen.pri.meals == null, "only once (a role cleared after that stays cleared)");
}

// ======================================================================
section("Assign all idle: the kitchen short of cooks");
{
  const { st, h, ppl } = mk(13);
  check(!baseNeeds(st, h).some((n) => n.job === "cook"), "no kitchen: no Cook need");
  addBuilding(h, "canteen");
  const need = baseNeeds(st, h).find((n) => n.job === "cook");
  check(need && need.cap === 2 && /2 cooks/.test(need.why), `a kitchen for 13: two cooks wanted (${need && need.why})`);
  for (const s of ppl) s.role = "build"; // nothing to build: all idle
  h.construction = [];
  const plan = planIdle(st, h);
  check(plan.filter((p) => p.job === "cook").length === 2, `the idle: two to the kitchen (${plan.map((p) => p.job).join(", ")})`);
}

// ======================================================================
section("The governor");
{
  // 12 people: the governor may found an outpost with three of them in the first days (dev 0c22861 on seed 42: a hub
  // of 9 kept 6), and the hub must stay at 8+.
  const { st, h, ppl } = mk(12);
  for (const s of ppl) s.pinned = false;
  setAutopilot(st, true);
  st.hour = 24 * 5 + 9;
  h.construction = [];
  Object.assign(h.stock, { scrap: 400, parts: 30 });
  let queued = false;
  for (let i = 0; i < 24 * 16 && !queued; i++) { h.stock.scrap = Math.max(h.stock.scrap, 300); tickHour(st); queued = h.construction.some((c) => c.type === "canteen") || count(h, "canteen") > 0; }
  check(queued, `a hub of 8+ queues a kitchen (after its first beds, water, stores and infirmary: day ${day(st)})`);
  const { st: s2, h: h2, ppl: p2 } = mk(13);
  for (const s of p2) s.pinned = false;
  addBuilding(h2, "canteen");
  s2.autopilot = true;
  s2.hour = 24 * 2 + 17;
  governRoles(s2, h2);
  const govCooks = atBase(s2, h2.id).filter((s) => s.role === "cook");
  check(govCooks.length === 2, `13 people with a kitchen, 17:00: the governor staffs two cooks (${govCooks.length})`);
  const { st: s3, h: h3, ppl: p3 } = mk(6);
  for (const s of p3) s.pinned = false;
  s3.autopilot = true;
  governRoles(s3, h3);
  check(!atBase(s3, h3.id).some((s) => s.role === "cook"), "no kitchen, no cook");
}

// ======================================================================
section("AI groups");
{
  const st = createWorld({ seed: SEED, factionCount: 6 });
  st.started = true;
  const f = st.factions.find((x) => x.alive && groupsBuild(st, x) && x.bases.length);
  if (check(!!f, "a group that builds")) {
    f.pop = 20; f.bases = [f.bases[0]];
    const w = worksAt(f, f.bases[0]);
    Object.assign(w, { water: 5, farms: 5, beds: 5, walls: 7, bench: 1, store: 1, pens: 1, sickbay: 4, still: 1, power: 1, freezer: 1, sealer: 1 }); // dev's machines (freezer-parts) come before the kitchen at the main base: built here
    f.jails = { [f.bases[0]]: 3 };
    setFood(f.stock, 20 * 30); f.stock.scrap = 50; f.stock.parts = 5;
    const nw = nextWork(st, f);
    check(nw && nw.type === "kitchen", `the next work at a base of 20: a kitchen (${nw && nw.type})`);
    check(groupEatMult(st, f) === 1, "no kitchen: eats as before");
    w.kitchen = 1;
    check(near(groupEatMult(st, f), 1 - GROUP_WORKS.KITCHEN.save), `with one: ×${groupEatMult(st, f)}`);
    check(near(groupCookShare(st, f), 1 / 12), `its cooks (one per 12) work no fields: ${groupCookShare(st, f)}`);
    check(nextWork(st, f) === null || nextWork(st, f).type !== "kitchen", "one a base");
    f.pop = 5;
    delete w.kitchen;
    check(!nextWork(st, f) || nextWork(st, f).type !== "kitchen", "a base of 5 builds none");
  }
}

// ======================================================================
section("Firewood: the stove (kitchen-plus pick 1)");
{
  const { st, h, ppl } = mk(12);
  addBuilding(h, "canteen");
  cook(ppl[0], 3);
  const kw = kitchenWood(st, h);
  console.log(`  firewood a day for a 12-person base: ${kw.need} (stove ${kw.stove} + meals ${kw.meals})`);
  check(kw.need === KITCHEN.wood.stove + 12 * 2 * KITCHEN.wood.meal && kw.need === 28, `12 fed: 4 + 24 = 28 a day (${kw.need})`);
  const w = woodNeed(st, h);
  check(w.kitchen === 28 && w.daily >= 28 && w.need >= 28 * KITCHEN.wood.keepDays, `the firewood forecast counts it (kitchen ${w.kitchen}, need ${w.need})`);
  st.hour = 24 * 3; h.stock.wood = 2000; setFood(h, 150); setJarred(h, 0);
  basesDaily(st);
  check(!kitchenCold(h) && h.kitchenDay && h.kitchenDay.wood === 28 && near(h.stock.wood, 2000 - 28, 0.01), `midnight: the stove burned 28 (${h.kitchenDay && h.kitchenDay.wood}, ${h.stock.wood} left)`);
  check(kitchenCanLight(st, h), "can light with firewood in store");
  h.stock.wood = 27;
  check(!kitchenCanLight(st, h), "27 firewood will not light a 28 stove");
  h.stock.wood = 10;
  st.hour = 24 * 4;
  basesDaily(st);
  plain(ppl[0]); // the day's mood, back where it was
  const ks = kitchenService(st, h);
  check(kitchenCold(h) && ks.cold && ks.save === 0 && ks.mood === 0 && ks.boil === 0 && near(h.stock.wood, 10), `no firewood: cold meals, nothing saved, nothing burned (${h.stock.wood})`);
  check(kitchenEatMult(st, h) === 1, "the food is eaten as without a kitchen");
  check(!moodFactors(st, ppl[3]).list.some((f) => /Hot meals/.test(f.label)), "no hot-meal mood");
  check(!baseCooks(h), "a cold stove cooks nothing (the worm)");
  addBuilding(h, "cookhouse");
  check(baseCooks(h), "the cook fire does it then");
  check(st.log.some((l) => /kitchen at .* is cold/.test(typeof l === "string" ? l : l.text || l.msg || "")), "a log line when it goes cold");
  const note = kitchenNote(st, h);
  check(/Cold meals/.test(note) && /Firewood: 28 a day/.test(note) && !BAD.test(note), `the card says so: ${note.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`);
  h.stock.wood = 500; st.hour = 24 * 5;
  basesDaily(st);
  plain(ppl[0]);
  check(!kitchenCold(h) && kitchenService(st, h).save > 0, "firewood in: lit again at midnight");
  const up = upkeepLine(st, h);
  check(/Kitchen stove: 28 firewood a day/.test(up.kitchen) && /firewood \d+/.test(up.short), `the Upkeep line: ${up.kitchen}; ${up.short}`);
  const wl = woodLine(st, h);
  check(/^\d+d$/.test(wl.short) && /Kitchen's stove burns 28/.test(wl.tip), `the needs bar's firewood: ${wl.short} (days at the day's burn)`);
  ppl[0].perks = ["lowflame"];
  check(kitchenWood(st, h).need === 4 + 16, `Low Flame: a third less on the meals (${kitchenWood(st, h).need})`);
}

// ======================================================================
section("Part-time fixed cooks: Cook + second job (kitchen-plus pick 2)");
{
  const { st, h, ppl } = mk(12);
  addBuilding(h, "canteen");
  const c = ppl[0];
  c.pinned = false; c.skills.cooking = 4;
  const msg = applyRoleChoice(st, c, "cook+farm");
  check(c.cookPlus === "farm" && cookPlusOf(st, c) === "farm" && /Cook \+ Farm/.test(msg), `the drop-down's Cook + Farm (${msg})`);
  const sel = roleSelect(st, c);
  check(/Cook \(\+ second job\)/.test(sel) && /value="cook\+farm" selected/.test(sel) && /Cook \(kitchen all day\)/.test(sel), "the drop-down: Cook (+ second job) with Cook + Farm picked, and plain Cook as the kitchen all day");
  check(COOK_SECOND.includes("wood") && COOK_SECOND.includes("rest") && !COOK_SECOND.includes("operate"), "second jobs: the jobs without a station");
  const roles = [];
  st.hour = 24 * 2;
  for (let i = 0; i < 24; i++) { st.hour++; cookShiftHour(st); cooksHour(st); roles.push(`${hourOfDay(st)}:${c.role}`); }
  const ok = roles.every((x) => { const [hr, r] = x.split(":"); return r === (isCookHour(Number(hr)) ? "cook" : "farm"); });
  check(ok, `the cooking hours at the stove, Farm the rest (${roles.filter((x) => x.endsWith("cook")).map((x) => x.split(":")[0]).join(", ")} cooking)`);
  check(hourOfDay(st) === 0 && c.role === "farm", "at midnight the day's systems count them at Farm");
  const ks = kitchenService(st, h);
  check(ks.cooks.includes(c) && ks.cover === 1, "...and the kitchen counts them as the day's cook (s.cookHour)");
  // The farm's day: the cooking hours are not free (jobShare: 6 of the 16 working hours at the stove).
  check(near(jobShare(st, c, "farm"), 1 - 6 / 16) && jobShare(st, c, "wood") === 1, `the day's farm credit: ${jobShare(st, c, "farm")} (the trip jobs lose the hours by themselves: 1)`);
  const other = ppl[5]; other.role = "farm"; other.pinned = true;
  check(near(farmLabour(st, h), workFactor(c) * 0.625 + workFactor(other) * (other.role === "farm" ? jobShare(st, other) : 0)) && farmLabour(st, h) < workFactor(c) + workFactor(other), `farm labour counts the part-time cook at 0.625 (${farmLabour(st, h).toFixed(3)})`);
  other.role = "rest";
  // A handover at noon: the morning's cook and the evening's are one cook's day between them, not "2 of 1".
  const c2 = ppl[6];
  c2.cookLog = [st.hour - 19, st.hour - 18]; c2.cookHour = st.hour - 18; c2.role = "farm";
  c.cookLog = c.cookLog.filter((x) => st.hour - x <= 8);
  const ksh = kitchenService(st, h);
  check(ksh.cooks.length === 2 && ksh.count === 1 && ksh.main[0] === c && ksh.cover === 1, `two cooks sharing the day: ${ksh.count} of ${ksh.wanted} (main ${ksh.main.map((x) => x.name).join(", ")}, cover ${ksh.cover})`);
  check(/1 of 1 wanted/.test(kitchenNote(st, h)) && /for some of the hours/.test(kitchenNote(st, h)), "the card: 1 of 1 wanted, the other for some of the hours");
  c2.cookLog = []; delete c2.cookHour;
  check(describeActivity(st, c, 17).text === "Cooking dinner" && describeActivity(st, c, 10).job === "farm", `the People tab: 17:00 ${describeActivity(st, c, 17).text}, 10:00 ${describeActivity(st, c, 10).text}`);
  // Cooking XP from the cooking hours, counted at Farm.
  ensureSkills(st, c);
  const tot = () => (c.xp.cooking || 0) + c.skills.cooking * 10000;
  const xp0 = tot();
  skillsDaily(st);
  check(tot() > xp0, "a part-time cook learns Cooking too");
  // Resting sick: left alone.
  c.sickWas = { role: "farm", station: null, base: h.id }; c.role = "rest";
  st.hour = 24 * 3 + 16; cookShiftHour(st);
  check(c.role === "rest" && c.cookPlus === "farm", "resting sick: the shift leaves them be (and keeps the setting)");
  delete c.sickWas; c.role = "farm";
  cookShiftHour(st);
  check(c.role === "cook", "well again: back at the stove in the cooking hours");
  c.role = "guard"; // someone gave them another job
  cookShiftHour(st);
  check(!c.cookPlus && c.role === "guard", "another job given by hand drops the Cook + second job");
  applyRoleChoice(st, c, "cook+wood");
  applyRoleChoice(st, c, "cook");
  check(!c.cookPlus && c.role === "cook", "plain Cook: the kitchen all day (no second job)");
  // The save keeps it.
  applyRoleChoice(st, c, "cook+scavenge");
  const back = loadFromString(saveToString(st));
  check(back.survivors.find((x) => x.id === c.id).cookPlus === "scavenge", "save and load keep the second job");
}

// ======================================================================
section("The Cooking skill (kitchen-plus pick 3)");
{
  check(SKILLS.includes("cooking") && SKILLS[SKILLS.length - 1] === "cooking" && SKILL_NAMES.cooking === "Cooking", "Cooking is a skill (last in SKILLS)");
  const st = createWorld({ seed: SEED, factionCount: 6 });
  const made = Array.from({ length: 200 }, () => makeSurvivor(st, 1));
  const avg = made.reduce((a, s) => a + s.skills.cooking, 0) / made.length;
  console.log(`  200 new survivors: Cooking ${avg.toFixed(2)} on average (0-${Math.max(...made.map((s) => s.skills.cooking))})`);
  check(made.every((s) => Number.isFinite(s.skills.cooking)) && avg > 3 && avg < 7, `new people roll it (average ${avg.toFixed(2)})`);
  // An old save: no Cooking, half their Farming plus 0-4 by their name.
  const old = made[0];
  delete old.skills.cooking; old.skills.farming = 8; old.traits = [];
  check(skill(old, "cooking") === cookingOldSave(old.name, 8) && skill(old, "cooking") >= 4 && skill(old, "cooking") <= 8, `before it is filled, skill() reads Farming / 2 + 0-4 (${skill(old, "cooking")})`);
  fillCooking(old);
  check(old.skills.cooking === cookingOldSave(old.name, 8), "fillCooking (save.js) writes it");
  const st2 = mk(12).st;
  const s0 = atBase(st2, hub(st2).id)[0];
  delete s0.skills.cooking;
  const loaded = loadFromString(saveToString(st2));
  check(Number.isFinite(loaded.survivors.find((x) => x.id === s0.id).skills.cooking), "an old save loads with Cooking filled in");
  // The kitchen goes by Cooking, not Farming.
  const { st: s3, h: h3, ppl: p3 } = mk(12);
  addBuilding(h3, "canteen");
  cook(p3[0], 10); p3[0].skills.farming = 0;
  check(near(kitchenService(s3, h3).save, 0.13), "Cooking 10, Farming 0: −13%");
  p3[0].skills.cooking = 0; p3[0].skills.farming = 10;
  check(near(kitchenService(s3, h3).save, 0.1), "Cooking 0, Farming 10: −10%");
  // Perks.
  check(PERK_TREE.cooking && [5, 10, 15].every((m) => PERK_TREE.cooking[m].length === 2) && Object.keys(PERKS).length === 72, `six Cooking perks (${Object.keys(PERKS).length} in all)`);
  p3[0].skills.cooking = 3;
  p3[0].perks = ["hearty", "thrifty"];
  let ks = kitchenService(s3, h3);
  check(near(ks.mood, 1.5) && near(ks.save, 0.12), `Hearty Portions +0.5 mood, Thrifty Cook −2% (${ks.mood}, ${ks.save})`);
  p3[0].perks = ["bigpot"];
  for (let i = 0; i < 6; i++) { const s = plain(makeSurvivor(s3, 1)); s.location = { kind: "base", baseId: h3.id }; s.role = "rest"; s.pinned = true; s3.survivors.push(s); }
  ks = kitchenService(s3, h3);
  check(ks.fed === 18 && ks.cover === 1, `Big Pot: one cook feeds 18 (${ks.served} of ${ks.fed})`);
  // Farm-Raised and the backgrounds.
  const fr = plain(makeSurvivor(s3, 1)); fr.traits = ["farmraised"];
  check(traitSkill(fr, "cooking") === 1, `Farm-Raised: +1 Cooking (${traitSkill(fr, "cooking")})`);
  check(HC_START.ARCHETYPES.farmer.skills.cooking && HC_START.ARCHETYPES.prepper.skills.cooking && !HC_START.ARCHETYPES.office.skills.cooking, "the farmer and the prepper backgrounds bump Cooking");
  // XP at the stove.
  const { st: s4, h: h4, ppl: p4 } = mk(12);
  addBuilding(h4, "canteen");
  const ck = cook(p4[0], 3);
  ensureSkills(s4, ck);
  const before = (ck.xp.cooking || 0) + ck.skills.cooking * 10000;
  s4.hour = 24 * 3;
  skillsDaily(s4);
  check((ck.xp.cooking || 0) + ck.skills.cooking * 10000 > before, "a full-day cook learns Cooking");
}

// ======================================================================
section("The governor: part-time cooks, the cook fire (picks 2, 5, 6)");
{
  const { st, h, ppl } = mk(13);
  for (const s of ppl) s.pinned = false;
  addBuilding(h, "canteen");
  st.autopilot = true;
  st.hour = 24 * 2 + 10;
  governRoles(st, h);
  check(!atBase(st, h.id).some((s) => s.role === "cook"), "10:00: the governor's cooks do other work");
  st.hour = 24 * 2 + 17;
  governRoles(st, h); cooksHour(st);
  const first2 = atBase(st, h.id).filter((s) => s.role === "cook").map((s) => s.id).sort();
  check(first2.length === 2, `17:00: two cooks (${first2.length})`);
  st.hour = 24 * 3 + 5;
  for (const s of atBase(st, h.id)) if (s.role === "cook") s.role = "rest"; // a night in between
  governRoles(st, h);
  const next2 = atBase(st, h.id).filter((s) => s.role === "cook").map((s) => s.id).sort();
  check(JSON.stringify(first2) === JSON.stringify(next2), `the same cooks the next morning (${next2})`);
  h.stock.wood = 0;
  st.hour = 24 * 3 + 16;
  for (const s of atBase(st, h.id)) if (s.role === "cook") s.role = "rest";
  governRoles(st, h);
  check(!atBase(st, h.id).some((s) => s.role === "cook"), "no firewood for the stove: no cooks");
  // A Manual Cook + Farm whose roles the governor runs: it plans them itself.
  const c = atBase(st, h.id)[0];
  applyRoleChoice(st, c, "cook+farm");
  h.stock.wood = 2000;
  governRoles(st, h);
  check(!c.cookPlus, "the governor's roles drop a Cook + second job it plans");
  // The cook fire comes down once the kitchen does its job and the firewood is there.
  const { st: s2, h: h2 } = mk(10);
  addBuilding(h2, "cookhouse"); addBuilding(h2, "canteen");
  s2.autopilot = true;
  h2.stock.wood = 30;
  check(!cookFireRedundant(s2, h2), "firewood short (under two weeks of the stove): the cook fire stays");
  s2.hour = 24 * 3 + 9; governBase(s2, h2);
  check(count(h2, "cookhouse") === 1, "...and is not pulled down");
  h2.stock.wood = 2000;
  check(cookFireRedundant(s2, h2), "a lit kitchen with firewood: the cook fire is redundant");
  governBase(s2, h2);
  check(count(h2, "cookhouse") === 0 && s2.log.some((l) => /cook fire at .* came down/.test(typeof l === "string" ? l : l.text || l.msg || "")), "pulled down at 09:00, with a line in the log");
  addBuilding(h2, "cookhouse");
  h2.kitchenCold = true;
  check(!cookFireRedundant(s2, h2), "a cold kitchen never makes it redundant");
  // The kitchen's slot: saved for from 8 people, ahead of the infirmary and the benches.
  const { st: s3, h: h3 } = mk(9);
  s3.autopilot = true;
  Object.assign(h3.stock, { scrap: 5, parts: 3 });
  const ws = safetyAI.buildWishes(s3, h3);
  const ki = ws.findIndex((x) => x.type === "canteen");
  const later = ["infirmary", "craftbench", "workbench", "watchtower", "med_station", "storehouse", "machine_shop", "common_room"].map((t) => ws.findIndex((x) => x.type === t)).filter((i) => i >= 0);
  check(ki >= 0 && ws[ki].save === true && later.every((i) => i > ki), `9 people: the kitchen is saved for, ahead of ${later.length} later wishes (${ws.map((x) => x.type + (x.save ? "*" : "")).join(" ")})`);
}

// ======================================================================
section("AI groups: firewood, growth, morale, the Groups card (pick 7)");
{
  const st = createWorld({ seed: SEED, factionCount: 6 });
  st.started = true;
  const f = st.factions.find((x) => x.alive && groupsBuild(st, x) && x.bases.length);
  if (check(!!f, "a group that builds")) {
    f.pop = 20; f.bases = [f.bases[0]];
    const w = worksAt(f, f.bases[0]);
    Object.assign(w, { water: 5, farms: 5, beds: 5, walls: 7, bench: 1, store: 1, pens: 1, sickbay: 4, kitchen: 1 });
    check(groupKitchenWood(st, f) === 4 + 20 * 2, `a kitchen for 20 burns 44 firewood a day (${groupKitchenWood(st, f)})`);
    f.stock.wood = 1000;
    groupKitchenDaily(st, f, 0);
    check(f.stock.wood === 956 && !f.kitchenCold && near(groupEatMult(st, f), 0.9), "burned from the woodpile: hot meals");
    check(near(groupKitchenGrowth(st, f), 1.2) && near(groupKitchenMorale(st, f), 0.25), "growth ×1.2, desertion pressure −0.25");
    clearFood(f.stock);
    const p1 = desertPressure(st, f);
    const txt = groupKitchenText(st, f);
    check(/Kitchen: hot meals for 20 of 20/.test(txt), `the Groups card line: ${txt}`);
    check(/🍲 Kitchen: hot meals/.test(groupCardExtras(st, f)), "on the Groups card");
    f.stock.wood = 30;
    groupKitchenDaily(st, f, 0);
    check(f.kitchenCold && groupEatMult(st, f) === 1 && groupCookShare(st, f) === 0 && f.stock.wood === 30, "short of firewood: cold, no saving, the cooks back in the fields");
    check(desertPressure(st, f) > p1 && /cold/.test(groupKitchenText(st, f)), "and no morale from it");
    f.stock.wood = 1000;
    groupKitchenDaily(st, f, 980);
    check(f.kitchenCold, "the day's heating comes first");
  }
}

// ======================================================================
section("The UI and saves");
{
  const { st, h, ppl } = mk(12);
  addBuilding(h, "canteen");
  cook(ppl[0], 5);
  st.hour = 24 * 3;
  basesDaily(st);
  const note = kitchenNote(st, h);
  check(/Cooks: /.test(note) && /Hot meals today: 24/.test(note) && /Food saved/.test(note) && !BAD.test(note), `the Kitchen card: ${note.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`);
  const bt = renderModal(st, freshUi({ baseView: { id: h.id, tab: "buildings" } }));
  check(/Kitchen/.test(bt) && /Cooks: /.test(bt) && /Meals/.test(bt) && !BAD.test(bt), "the Buildings tab: the Kitchen card and the Meals line");
  const ct = renderModal(st, freshUi({ baseView: { id: h.id, tab: "construction" } }));
  check(/Kitchen/.test(ct) && /Hot meals today/.test(ct) && /Preserving room/.test(ct) && !BAD.test(ct), "Construction: the Kitchen with its card, the Preserving room by its new name");
  const ov = renderModal(st, freshUi({ baseView: { id: h.id, tab: "overview" } }));
  check(/Cook/.test(ov) && /hot meals/i.test(ov), "the Overview's Work now panel has the Cook row");
  const wk = renderModal(st, freshUi({ baseView: { id: h.id, tab: "work" } }));
  check(/Cook/.test(wk) && /Jar/.test(wk) && !BAD.test(wk), "the Work tab: Cook and the Preserve column (Jar)");
  const back = loadFromString(saveToString(st));
  const hb = hub(back);
  check(count(hb, "canteen") === 1 && hb.kitchenDay && hb.kitchenDay.meals === 24 && kitchenService(back, hb).cover === 1, "save and load: the kitchen, its cook and its record");
}

console.log(`\n${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
