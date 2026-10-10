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
import { baseCooks, cookAtBase, purifyCap } from "../src/sim/worm.js";
import { describeActivity, baseWork, workingActivity } from "../src/sim/activity.js";
import { moodFactors } from "../src/sim/relations.js";
import { workState, assignRole, planBase, WORK_TYPES, workHour } from "../src/sim/work.js";
import { governRoles, setAutopilot } from "../src/sim/autopilot.js";
import { nextWork, groupEatMult, worksAt, groupsBuild, GROUP_WORKS } from "../src/sim/groupworks.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { renderModal } from "../src/ui/ui.js";
import { workNowPanel } from "../src/ui/activity.js";
import { kitchenNote } from "../src/ui/kitchen.js";
import { baseNeeds, planIdle } from "../src/sim/idlework.js";

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
  Object.assign(h.stock, { food: 2000, water: 600, scrap: 200, parts: 20, fuel: 50, meds: 20, wood: 2000 });
  return { st, h, ppl: atBase(st, h.id) };
}
const cook = (s, farming = 3) => { s.role = "cook"; s.skills.farming = farming; return s; };

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
  h.wormMeat = 5; h.meat = 5;
  check(cookAtBase(st, h) > 0 && !h.wormMeat, "the game with the worm's eggs is cooked through, cook or no cook");
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
  check(near(ks.save, KITCHEN.saveMax) && near(ks.save, 0.13), `Farming 10: −13% (${ks.save})`);
  check(ks.mood === KITCHEN.moodSkilled && ks.mood === 1.5, "Farming 6+: +1.5 mood");
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
  for (const { st, h } of pair) { st.hour = 24 * 3; h.stock.food = 150; h.stock.preserved = 0; }
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
  check(hot(ppl[3]).v === 1.5, "a Farming 6+ cook: +1.5");
  addBuilding(h, "kitchen");
  check(moodFactors(st, ppl[3]).list.filter((f) => /Hot meals/.test(f.label)).length === 1 && hot(ppl[3]).v === 1.5, "with a preserving room too: not both");
  ppl[0].role = "rest";
  check(hot(ppl[3]) && hot(ppl[3]).v === 1 && /preserving room/.test(hot(ppl[3]).label), "a preserving room alone keeps its +1");
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
  const { st, h, ppl } = mk(9);
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
  governRoles(s2, h2);
  check(atBase(s2, h2.id).filter((s) => s.role === "cook").length === 2, `13 people with a kitchen: the governor staffs two cooks (${atBase(s2, h2.id).filter((s) => s.role === "cook").length})`);
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
    Object.assign(w, { water: 5, farms: 5, beds: 5, walls: 7, bench: 1, store: 1, pens: 1, sickbay: 4 });
    f.jails = { [f.bases[0]]: 3 };
    f.stock.food = 20 * 30; f.stock.scrap = 50; f.stock.parts = 5;
    const nw = nextWork(st, f);
    check(nw && nw.type === "kitchen", `the next work at a base of 20: a kitchen (${nw && nw.type})`);
    check(groupEatMult(st, f) === 1, "no kitchen: eats as before");
    w.kitchen = 1;
    check(near(groupEatMult(st, f), 1 - GROUP_WORKS.KITCHEN.save), `with one: ×${groupEatMult(st, f)}`);
    check(nextWork(st, f) === null || nextWork(st, f).type !== "kitchen", "one a base");
    f.pop = 5;
    delete w.kitchen;
    check(!nextWork(st, f) || nextWork(st, f).type !== "kitchen", "a base of 5 builds none");
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
