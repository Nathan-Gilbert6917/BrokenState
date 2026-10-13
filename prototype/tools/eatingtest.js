// Eating test (wave 2: src/sim/eating.js, meals.js ration levels; user request 2026-10-11 "Survivors will take breaks in
// their day to eat food until they hit 80 to 100% full satiation ... they must carry some on them with water"; picks 2
// the meal mood ladder, 3 food preferences, 4 ration levels):
//   1. meal breaks: people eat at the mealtimes and when hungry, each to their own target in 80–100 (a Glutton 100), a
//      break of 20–45 minutes on s.meal, "Eating breakfast (24 min)"; the day's food against upkeep.js foodUse;
//   2. what they eat: cooked meals first (the best tier), lean / short: soonest to spoil first; raw meat last where
//      nothing cooks; a Vegetarian's plant food first; the same food two days running skipped while it keeps;
//   3. work time: the meal hours are the cost (meals.js MEAL_WORK_SHARE, unchanged), the minutes by the food eaten;
//   4. the pack: topped up at 05:00 from the stores (not while rationing), untouched at home, eaten away from the stores
//      (a job trip, a field work's post), weighed in the load, a team's packs counting toward its supplies and eaten
//      after its shared food, a death at a base giving it to the stores;
//   5. starving still works: a hub out of food counts hunger days; an outpost's missed meals come from the hub;
//   6. the mood ladder: Ate raw food −7 once (not again while it lasts), a stew / fine / lavish meal +3 / +6 / +12, Same
//      food again −3 after 3 days, A feast +6;
//   7. traits: Picky Eater, Vegetarian, Cannibal (a test-only human-meat item), their roll at birth and their points;
//   8. ration levels: lean eats about 80% and costs mood, a feast day 1.5× and back to the level; foodUse follows; the
//      governor goes lean when short and back; the harvest festival is a feast;
//   9. AI groups: lean when short (less eaten), a feast, the pressure on desertion, their parties' rations.
// Usage: node tools/eatingtest.js [seed]
import { food, setFood, addDays, clearFood } from "./foodkit.js";
import { createWorld, hub, atBase, residents, tickHour, killSurvivor, makeSurvivor } from "../src/sim/world.js";
import { basesDaily } from "../src/sim/economy.js";
import { factionsDaily } from "../src/sim/factions.js";
import { foodUse } from "../src/sim/upkeep.js";
import { econStats } from "../src/sim/farming.js";
import { launchExpedition, partyMembers, spawnAiParty, removeParty } from "../src/sim/parties.js";
import { needsHour, teamNeedsHour, NEEDS } from "../src/sim/needs.js";
import { EAT, PACK, THOUGHTS, MEAL_MOOD, RATION_PLAN, GROUP_EAT, eatTarget, targetAt, packFood, packWater, packKg, rationOf, thought, thoughtsOf, planRations, setRationLevel, groupRation, groupDietPressure, breakMin, eatPack, topUpPack, noteEat, mealPlan, mealOver, mealFV, nextMeal, sharedMeal } from "../src/sim/eating.js";
import { RATION_LEVELS, rationKey, rationUse, MEAL_WORK_SHARE, mealOf, lunchHour, setLunchHour, isMealHour, lunchOverlap, LUNCH_HOURS } from "../src/sim/meals.js";
import { FOODS, addFood, unitsOf, qtyOf, foodIn, MEAL_FV } from "../src/sim/foods.js";
import { describeActivity } from "../src/sim/activity.js";
import { wornLoad } from "../src/sim/load.js";
import { TRAITS, DIET_TRAITS, traitsClash } from "../src/sim/data.js";
import { traitDesc, traitPoints, TRAIT_ROLL, hasTrait } from "../src/sim/traits.js";
import { desertPressure } from "../src/sim/groupcare.js";
import { holdFestival } from "../src/sim/festival.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { dayMeanTemp, foodNeedFactor } from "../src/sim/weather.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const r1 = (v) => Math.round(v * 10) / 10;
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 5 }); st.started = true; st.visitorsOff = true; return st; };
const plain = (s) => { s.traits = []; delete s.traitTier; s.conditions = []; s.perks = []; s.health = 100; s.mood = 60; s.hunger = 90; s.thirst = 100; delete s.thoughts; delete s.food; delete s.meal; delete s.ration; return s; };
// A hub where everyone rests at home (no trips, no jobs out), plenty of water, `days` of ration bars.
function quietHub(st, days = 400) {
  const h = hub(st);
  for (const s of atBase(st, h.id)) { plain(s); s.role = "rest"; s.station = null; }
  Object.assign(h.stock, { water: 400, scrap: 300, parts: 30, fuel: 40, meds: 20, ammo: 50, wood: 3000 });
  setFood(h, days);
  return h;
}
// A mild day (no cold appetite), at hour `hr` of it.
const mildHour = (st, hr = 0) => { for (let d = 3; d < 80; d++) if (dayMeanTemp(st, d) > 5 && foodNeedFactor(st, d) === 1) return d * 24 + hr; return 5 * 24 + hr; };
const hours = (st, n) => { for (let i = 0; i < n; i++) { st.hour++; needsHour(st); } };
// n days: the hours, then the base's day at midnight.
const days = (st, n) => { for (let d = 0; d < n; d++) { hours(st, 24); basesDaily(st); } };
const at = (st, hr) => { while (st.hour % 24 !== hr) { st.hour++; needsHour(st); } };

// ---------- 1. meal breaks and the fullness band ----------
{
  console.log("Meal breaks and the fullness band");
  const st = W();
  const h = quietHub(st);
  st.hour = mildHour(st, 0);
  const ppl = residents(st, h.id);
  const tg = ppl.map(eatTarget);
  check(tg.every((t) => t >= EAT.band[0] && t <= EAT.band[1]) && new Set(tg).size > 1, `everyone has their own target in ${EAT.band.join("–")} (${tg.join(", ")})`);
  const g = makeSurvivor(st); g.traits = ["glutton"];
  check(eatTarget(g) === 100, "a Glutton eats to 100");
  days(st, 2);
  const mealsAt = new Set();
  let mins = [];
  for (let i = 0; i < 24; i++) {
    st.hour++; needsHour(st);
    for (const s of ppl) if (s.meal && s.meal.h === st.hour) { mealsAt.add(st.hour % 24); mins.push(s.meal.min); }
  }
  check([...mealsAt].sort((a, b) => a - b).join(",") === "6,12,20", `they eat at breakfast, lunch and dinner (${[...mealsAt].join(", ")})`);
  check(mins.every((m) => m >= EAT.min.meal && m <= EAT.min.max), `meal breaks of ${Math.min(...mins)}–${Math.max(...mins)} minutes`);
  check(ppl.every((s) => s.hunger > 75), `the gauges stay well fed: at least a meal's food value three times a day (${ppl.map((s) => r1(s.hunger)).join(", ")})`);
  // Right after a meal everyone is at their target or over it (a meal is at least MEAL_FV, whole items).
  const pre = ppl.map((s) => s.hunger - NEEDS.food / 24);
  at(st, 6);
  check(ppl.every((s, i) => s.hunger >= tg[i] - 0.5 || s.hunger >= Math.min(100, pre[i] + NEEDS.food / 3) - 0.5), "after breakfast everyone has eaten a meal: at their target or a meal's worth fuller");
  check(/^Eating breakfast \(\d+ min\)$/.test(describeActivity(st, ppl[0]).text), `the activity: "${describeActivity(st, ppl[0]).text}"`);
  // A day's food against upkeep.js: about the old once-a-day total.
  basesDaily(st);
  const e0 = econStats(st).eaten;
  const use = foodUse(st, h).residents;
  days(st, 4);
  const ate = (econStats(st).eaten - e0) / 4;
  check(Math.abs(ate / use - 1) < 0.06, `a day's eating is upkeep.js's per head × heads: ${r1(ate)} vs ${r1(use)} (×${(ate / use).toFixed(3)})`);
  // Someone who comes home starving eats now, not at the next mealtime.
  at(st, 12);
  const s = ppl[1];
  s.hunger = 20;
  hours(st, 1);
  check(s.hunger > 75 && s.meal && s.meal.h === st.hour && !s.meal.meal, `hungry between meals: a snack to their target (${r1(s.hunger)})`);
  // At night only below EAT.night.
  at(st, 1);
  s.hunger = 40;
  hours(st, 1);
  check(s.hunger < 40, "at night nobody gets up for a snack at 40");
  s.hunger = 20;
  hours(st, 1);
  check(s.hunger > 75, "at night they do eat when really hungry");
}

// ---------- 2. what they eat ----------
{
  console.log("What they eat");
  const st = W();
  const h = quietHub(st, 0);
  st.hour = mildHour(st, 5);
  // Lavish, fine meals, stew, beans and bread about to go: the best meals first.
  addFood(h, "f_lavishmeal", 1, { state: st });
  addFood(h, "f_finemeal", 1, { state: st });
  addFood(h, "f_beans", 50, { state: st });
  addFood(h, "f_bread", 20, { left: 1, state: st });
  const ppl = residents(st, h.id);
  for (const s of ppl) s.hunger = 60;
  at(st, 6);
  const keys = ppl.map((s) => s.meal && s.meal.k);
  check(keys[0] === "f_lavishmeal" && (h.stock.f_lavishmeal || 0) < 1e-6, `the first at the table gets the lavish meal (${keys.join(", ")})`);
  check((h.stock.f_finemeal || 0) < 1e-6 && ppl.every((x) => !(x.food.u.f_beans > 0)), "then the fine meal; nobody eats the beans (they keep)");
  check(keys.slice(2).every((k) => k === "f_bread"), `then the soonest to spoil (the bread with a day left), not the beans (${keys.slice(2).join(", ")})`);
  // Lean: the soonest to spoil first, the meals in their place.
  const st2 = W();
  const h2 = quietHub(st2, 0);
  st2.hour = mildHour(st2, 5);
  addFood(h2, "f_finemeal", 3, { left: 3.5, state: st2 });
  addFood(h2, "f_bread", 20, { left: 1, state: st2 });
  h2.rationLevel = "lean";
  for (const s of residents(st2, h2.id)) s.hunger = 50;
  at(st2, 6);
  check(residents(st2, h2.id)[0].meal.k === "f_bread", `lean: the food about to spoil before the meals (${residents(st2, h2.id)[0].meal.k})`);
  // Raw meat last where nothing cooks; "Ate raw food" when nothing else is left.
  const st3 = W();
  const h3 = quietHub(st3, 0);
  st3.hour = mildHour(st3, 5);
  h3.buildings = h3.buildings.filter((b) => !["cookhouse", "kitchen", "canteen"].includes(b.type));
  addFood(h3, "f_venison", 3, { left: 1, state: st3 });
  addFood(h3, "f_beans", 4, { state: st3 });
  const [a, b] = residents(st3, h3.id);
  a.hunger = 60; b.hunger = 60;
  for (const x of residents(st3, h3.id)) if (x !== a && x !== b) x.hunger = 95;
  at(st3, 6);
  check(a.meal && a.meal.k === "f_beans" && !thoughtsOf(st3, a).some((t) => t.id === "raw"), `raw meat last where nothing cooks (${a.meal && a.meal.k})`);
  check(b.meal && b.meal.k === "f_venison" && thoughtsOf(st3, b).some((t) => t.id === "raw" && t.v === THOUGHTS.raw.v), `nothing else left: raw meat, "Ate raw food" ${THOUGHTS.raw.v} (${b.meal && b.meal.k})`);
  // A Vegetarian: plant food first.
  const st4 = W();
  const h4 = quietHub(st4, 0);
  st4.hour = mildHour(st4, 5);
  addFood(h4, "f_cannedmeat", 20, { left: 5, state: st4 });
  addFood(h4, "f_beans", 80, { state: st4 });
  const v = residents(st4, h4.id)[0];
  v.traits = ["vegetarian"]; v.hunger = 50;
  const o = residents(st4, h4.id)[1];
  o.hunger = 50;
  at(st4, 6);
  check(v.meal.k === "f_beans" && o.meal.k === "f_cannedmeat", `a Vegetarian takes the beans, the rest the meat that spoils first (${v.meal.k}, ${o.meal.k})`);
  // Variety: the same food two days running is skipped while it keeps.
  o.food = { d: o.food.d, u: {}, log: ["f_cannedmeat", "f_cannedmeat"] };
  o.hunger = 50;
  at(st4, 20);
  check(o.meal.k === "f_beans", `tired of the canned meat two days running, they pick something else (${o.meal.k})`);
}

// Food poisoning (cooking.js, the eating contract): a cooked lot's pz is rolled for each person on what they ate.
{
  const st = W();
  const h = quietHub(st, 0);
  st.hour = mildHour(st, 5);
  addFood(h, "f_simplemeal", 40, { state: st });
  h.foodLots.f_simplemeal[0].pz = 0.95;
  h.foodLots.f_simplemeal[0].by = residents(st, h.id)[0].id;
  const clean = W();
  const hc = quietHub(clean, 0);
  clean.hour = mildHour(clean, 5);
  addFood(hc, "f_simplemeal", 40, { state: clean });
  for (const x of [...residents(st, h.id), ...residents(clean, hc.id)]) x.hunger = 40;
  at(st, 6); at(clean, 6);
  const sick = residents(st, h.id).filter((x) => (x.conditions || []).some((c) => c.key === "poisoning")).length;
  check(sick > 0 && residents(clean, hc.id).every((x) => !(x.conditions || []).some((c) => c.key === "poisoning")), `meals from a lot with pz 0.95: ${sick} of ${residents(st, h.id).length} poisoned; a clean lot: none`);
}

// ---------- 3. work time ----------
{
  console.log("Work time");
  check(near(MEAL_WORK_SHARE, 21 / 24), "the round-the-clock jobs lose the three meal hours (meals.js MEAL_WORK_SHARE): one cost for the breaks");
  check(breakMin(0.5, true) === Math.round(EAT.min.base + EAT.min.per * 0.5) && breakMin(0.05, true) === EAT.min.meal && breakMin(3, true) === EAT.min.max && breakMin(0.1, false) < EAT.min.meal, `minutes by the food eaten: ${breakMin(0.1, false)} (a snack) · ${breakMin(0.5, true)} (half a day's food) · ${breakMin(3, true)} (most)`);
  check(mealOf("hunt", 10) === "breakfast" && mealOf("farm", 6) === "breakfast" && mealOf("farm", 12) === "lunch" && mealOf("farm", 20) === "dinner" && !mealOf("farm", 13), "the mealtimes (the hunters' late breakfast, lunch at 12:00)");
}

// ---------- 3b. lunch (TIME-03: an hour, to 80–100% full, a small lift, set in the Work tab) ----------
{
  console.log("Lunch");
  const st = W();
  const h = quietHub(st);
  st.hour = mildHour(st, 0);
  const ppl = residents(st, h.id);
  check(lunchHour(st) === 12 && isMealHour(12, st) && !isMealHour(14, st), "lunch at 12:00 unless set");
  check(!setLunchHour(st, 9) && !setLunchHour(st, 20) && lunchHour(st) === 12, `only ${LUNCH_HOURS.join(", ")} can be lunch (not 09:00, not dinner's 20:00)`);
  check(setLunchHour(st, 14) && lunchHour(st) === 14 && isMealHour(14, st) && !isMealHour(12, st) && mealOf("farm", 14, st) === "lunch" && !mealOf("farm", 12, st), "moved to 14:00 (the Work tab)");
  days(st, 2);
  const mealsAt = new Set();
  for (let i = 0; i < 24; i++) {
    st.hour++; needsHour(st);
    for (const s of ppl) if (s.meal && s.meal.h === st.hour) mealsAt.add(st.hour % 24);
  }
  check([...mealsAt].sort((a, b) => a - b).join(",") === "6,14,20", `they eat at 06:00, 14:00 and 20:00 (${[...mealsAt].join(", ")})`);
  // To their own target (80–100), and a small lift for it.
  at(st, 13);
  const p = plain(ppl[0]); p.hunger = eatTarget(p) - 20; p.mood = 50;
  at(st, 14);
  check(p.meal && p.meal.h === st.hour && p.meal.meal === "lunch" && p.hunger >= Math.min(EAT.band[0], eatTarget(p)) - 1 && p.hunger <= eatTarget(p) + 1e-6, `lunch fills them to their target (${r1(p.hunger)} of ${eatTarget(p)})`);
  check(p.mood >= 50 + EAT.lunchMood - 1e-9 && p.mood < 50 + 3, `a small lift to mood (+${r1(p.mood - 50)})`);
  check(/^Eating lunch/.test(describeActivity(st, p).text), `the activity: "${describeActivity(st, p).text}"`);
  // Out on a job trip at lunch: from the pack where they are.
  at(st, 13);
  const q = plain(ppl[1]); q.hunger = eatTarget(q) - 20;
  topUpPack(st, h, q);
  const pk0 = packFood(q);
  q.trip = { job: "wood", base: h.id, tile: h.tile, at: h.tile, d: 1, leave: st.hour, arrive: st.hour + 0.5, workEnd: st.hour + 3, home: st.hour + 4 };
  at(st, 14);
  check(q.meal && q.meal.h === st.hour && q.meal.from === "pack" && packFood(q) < pk0 - 0.05, `out on a trip, lunch from the pack (${r1(pk0)} → ${r1(packFood(q))} days)`);
  delete q.trip;
  check(PACK.trip >= 1 && PACK.food >= PACK.trip, `a job trip sets out with at least ${PACK.trip} day of food (the pack holds ${PACK.food})`);
  // The hour of lunch inside a stretch of time (a trip's work).
  check(lunchOverlap(8, 11, st) === 0 && near(lunchOverlap(13.5, 15.25, st), 1) && near(lunchOverlap(14.5, 18, st), 0.5) && near(lunchOverlap(24 + 14.25, 24 + 14.75, st), 0.5) && near(lunchOverlap(0, 48, st), 2), "lunchOverlap: the lunch hour's share of a span, day by day");
  setLunchHour(st, 12);
}

// ---------- 4. the pack ----------
{
  console.log("The pack");
  const st = W();
  const h = quietHub(st);
  st.hour = mildHour(st, 0);
  const ppl = residents(st, h.id);
  const f0 = food(h), w0 = h.stock.water;
  at(st, PACK.hour);
  check(ppl.every((s) => packFood(s) >= PACK.food - 1e-6 && packWater(s) >= PACK.water - 1e-6), `topped up at 0${PACK.hour}:00: ${r1(packFood(ppl[0]))} days of food and ${r1(packWater(ppl[0]))} water each`);
  const packs = ppl.reduce((x, s) => x + packFood(s), 0);
  check(near(f0 - food(h), packs, 1e-6) && h.stock.water < w0, "out of the stores");
  check(Object.keys(ppl[0].ration.supplies).every((k) => !FOODS[k] || FOODS[k].shelf >= PACK.keepShelf), `food that keeps (${Object.keys(ppl[0].ration.supplies).join(", ")})`);
  check(near(wornLoad(ppl[0]) - (wornLoad({ ...ppl[0], ration: null })), packKg(ppl[0]), 1e-9) && packKg(ppl[0]) > 1, `weighed in their load (${r1(packKg(ppl[0]))} kg)`);
  // At home: the stores, the pack untouched.
  const p0 = packFood(ppl[0]);
  hours(st, 24);
  check(near(packFood(ppl[0]), p0) && ppl[0].meal && ppl[0].meal.from !== "pack", "at home they eat from the stores; the pack is for leaving");
  // Out on a job trip: the pack.
  const s = ppl[0];
  at(st, 19);
  s.trip = { job: "wood", base: h.id, leave: st.hour - 6, home: st.hour + 6 };
  s.hunger = 60;
  const fh = food(h);
  hours(st, 1);
  check(s.meal.from === "pack" && packFood(s) < p0, `out on a job trip: dinner from the pack (${r1(packFood(s))} days left)`);
  void fh;
  delete s.trip;
  // Topped up again in the morning.
  at(st, PACK.hour); hours(st, 1);
  check(packFood(s) >= PACK.food - 1e-6, "topped up next morning");
  // A lookout at a field work: the pack.
  const t = ppl[1];
  t.location = { kind: "post", baseId: h.id, fw: 1, at: st.hour };
  t.hunger = 30;
  const tp = packFood(t);
  hours(st, 1);
  check(packFood(t) < tp && t.hunger > 70, "posted at a field work: the pack");
  t.location = { kind: "base", baseId: h.id };
  // No top-up while rationing.
  const u = ppl[2];
  clearFood(u.ration);
  h.rationing = true;
  at(st, PACK.hour); hours(st, 1);
  check(packFood(u) < 0.01, "no top-up while the base is on short rations");
  h.rationing = false;
  // The stores empty at home: the pack.
  clearFood(h);
  for (const x of ppl) x.hunger = 60;
  at(st, 20);
  check(ppl.filter((x) => x.meal.from === "pack" && x.meal.h === st.hour).length >= ppl.length - 2 && ppl.every((x) => x === u || packFood(x) < 0.01 || (x.meal.from === "pack" && x.meal.h === st.hour)), `the stores empty: they eat what they carry (${ppl.map((x) => `${x.meal && x.meal.from}@${x.meal && x.meal.h - st.hour}`).join(", ")})`);
  // A death at a base: the pack to the stores.
  setFood(h, 100);
  const dead = ppl[3];
  topUpPack(st, h, dead);
  const df = packFood(dead), hf = food(h);
  killSurvivor(st, dead, h.tile, "of a test");
  check(near(food(h), hf + df, 1e-6) && !dead.ration, `a death at the base: their pack goes to the stores (${r1(df)} days)`);
  // Saved.
  const st2 = loadFromString(saveToString((st.cards.length = 0, st)));
  const s2 = st2.survivors.find((x) => x.id === ppl[0].id);
  check(near(packFood(s2), packFood(ppl[0])) && s2.ration.foodLots && Object.keys(s2.ration.foodLots).length > 0, "the pack and its lots are saved");
}
// ---------- 4b. a team: the packs count toward its supplies; shared food first, then the packs ----------
{
  console.log("A team and its packs");
  const st = W();
  const h = quietHub(st);
  st.hour = mildHour(st, 0);
  at(st, PACK.hour);
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, 2);
  const pk = crew.reduce((a, s) => a + packFood(s), 0), pw = crew.reduce((a, s) => a + packWater(s), 0);
  const dest = st.tiles.find((t) => !t.loc && t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 2);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: dest.id, mission: "move", stance: "normal", vehicleId: null, supplies: { food: 10, water: 10 } });
  const p = res.party;
  check(p && near(food(p) + pk, 10, 1.3) && near(p.supplies.water + Math.floor(pw), 10, 1e-6), `asked for 10 days of food and 10 water: ${r1(food(p))} + ${r1(pk)} in their packs, ${p.supplies.water} + ${r1(pw)} water`);
  p.phase = "waiting"; p.path = [p.path[0]]; p.idx = 0;
  for (const s of crew) s.hunger = 60;
  const before = crew.map(packFood);
  teamNeedsHour(st, p, crew);
  check(crew.every((s, i) => near(packFood(s), before[i])) && crew.every((s) => s.meal && s.meal.from === "team"), "the team's shared food first");
  clearFood(p);
  for (const s of crew) s.hunger = 50;
  teamNeedsHour(st, p, crew);
  check(crew.every((s, i) => packFood(s) < before[i] && s.hunger > 70), "its food gone: their own packs");
  check(!p.noFood, "not out of food while the packs last");
}

// ---------- 5. starving still works ----------
{
  console.log("Starving");
  const st = W();
  const h = quietHub(st, 0);
  st.hour = mildHour(st, 0);
  const ppl = residents(st, h.id);
  days(st, 2);
  check(h.hungerDays >= 1 && ppl.every((s) => s.starveDays >= 1), `a hub with nothing in store or in the packs counts hunger days (${h.hungerDays}) and starving mornings`);
  const hp = ppl.map((s) => s.health);
  days(st, 1);
  check(ppl.every((s, i) => s.health < hp[i]), "and hunger costs health (economy.js)");
  setFood(h, 100);
  days(st, 1);
  check(!h.hungerDays && ppl.every((s) => !s.starveDays), "fed again: over");
}

// ---------- 6. the mood ladder ----------
{
  console.log("The mood ladder");
  const st = W();
  const h = quietHub(st, 0);
  st.hour = mildHour(st, 0);
  const s = residents(st, h.id)[0];
  const m0 = s.mood;
  check(thought(st, s, "raw") && near(s.mood, m0 + THOUGHTS.raw.v), `Ate raw food ${THOUGHTS.raw.v}`);
  check(!thought(st, s, "raw") && near(s.mood, m0 + THOUGHTS.raw.v), "not again while it lasts (not stacking)");
  st.hour += THOUGHTS.raw.hours;
  check(thought(st, s, "raw"), `again once it has run out (${THOUGHTS.raw.hours} h)`);
  check((s.moodNotes || []).some((n) => n.label === "Ate raw food"), "in the mood notes");
  check(MEAL_MOOD * FOODS.f_lavishmeal.moodLift === 12 && MEAL_MOOD * FOODS.f_finemeal.moodLift === 6 && MEAL_MOOD * FOODS.f_stew.moodLift === 3 && FOODS.f_simplemeal.moodLift === 0, "the meal ladder: stew +3, fine +6, lavish +12, simple 0");
  // Eating a lavish meal.
  addFood(h, "f_lavishmeal", 2, { state: st });
  addFood(h, "f_beans", 100, { state: st });
  for (const x of residents(st, h.id)) x.hunger = 95;
  s.hunger = 60; s.mood = 50;
  at(st, 6);
  check(thoughtsOf(st, s).some((t) => t.id === "meal" && t.v === 12) && s.mood > 50 + 11, `a lavish meal: +12 (${thoughtsOf(st, s).map((t) => `${t.label} ${t.v}`).join(", ")})`);
  // Same food again: three days of nothing but beans.
  clearFood(h); addFood(h, "f_beans", 700, { state: st });
  delete s.food; s.thoughts = [];
  days(st, EAT.sameDays + 1);
  check(thoughtsOf(st, s).some((t) => t.id === "same" && t.v === THOUGHTS.same.v), `the same food ${EAT.sameDays} days running: "Same food again" ${THOUGHTS.same.v} (${(s.food.log || []).join(", ")})`);
  // A feast.
  setRationLevel(st, h, "feast");
  for (const x of residents(st, h.id)) delete x.thoughts;
  at(st, 20);
  check(thoughtsOf(st, s).some((t) => t.id === "feast" && t.v === THOUGHTS.feast.v), `a feast: +${THOUGHTS.feast.v}`);
}

// ---------- 7. traits ----------
{
  console.log("Traits");
  check(DIET_TRAITS.every((t) => TRAITS[t]) && traitsClash("vegetarian", "cannibal"), "Picky Eater, Vegetarian and Cannibal (a Vegetarian is no Cannibal)");
  check(traitPoints("picky", 1) < 0 && traitPoints("vegetarian") < 0 && traitPoints("cannibal") === 0, `custom points: Picky ${traitPoints("picky", 1)}/${traitPoints("picky", 3)}, Vegetarian ${traitPoints("vegetarian")}, Cannibal ${traitPoints("cannibal")}`);
  check(/simple meal/.test(traitDesc("picky", 2)) && /plant food/.test(traitDesc("vegetarian")) && /worm/.test(traitDesc("cannibal")), "their text");
  const st = W();
  const h = quietHub(st, 0);
  st.hour = mildHour(st, 0);
  const [p, v, c, n] = residents(st, h.id);
  p.traits = ["picky"]; v.traits = ["vegetarian"]; c.traits = ["cannibal"];
  // Picky: a simple meal −3, raw food −4 more; a lavish meal +3 more.
  for (const x of [p, v, c, n]) { x.mood = 50; delete x.thoughts; }
  const ate = (x, k, q = 1) => { x.ration = { supplies: { [k]: q }, foodLots: {} }; const t = eatPack(st, x, unitsOf(k, q)); return t; };
  noteEat(st, p, { ...ate(p, "f_simplemeal"), from: "pack" }, {});
  check(thoughtsOf(st, p).some((t) => t.id === "picky" && t.v === -3), `Picky Eater: a simple meal −3 (${thoughtsOf(st, p).map((t) => `${t.label} ${t.v}`).join(", ")})`);
  delete p.thoughts;
  noteEat(st, p, { ...ate(p, "f_lavishmeal"), from: "pack" }, {});
  check(thoughtsOf(st, p).some((t) => t.id === "picky" && t.v === 3) && thoughtsOf(st, p).some((t) => t.id === "meal" && t.v === 12), "a lavish meal: +12 and +3 more");
  delete p.thoughts;
  noteEat(st, p, { ...ate(p, "f_venison"), from: "pack" }, {});
  check(thoughtsOf(st, p).some((t) => t.id === "raw") && thoughtsOf(st, p).some((t) => t.id === "picky" && t.v === -4), "raw food: −7 and −4 more");
  // Vegetarian: meat −6; plant food nothing.
  noteEat(st, v, { ...ate(v, "f_beans"), from: "pack" }, {});
  check(!thoughtsOf(st, v).length, "a Vegetarian eating beans: nothing");
  noteEat(st, v, { ...ate(v, "f_jerky"), from: "pack" }, {});
  check(thoughtsOf(st, v).some((t) => t.id === "veg" && t.v === -6), "a Vegetarian eating jerky: −6");
  // Cannibal (a test-only item: the game has no human meat).
  FOODS.f_testhuman = { key: "f_testhuman", name: "Test", word: "test", group: "rawmeat", tier: "raw", kcal: 2000, kg: 1, shelf: 3, diet: "human", raw: false, value: 0 };
  noteEat(st, c, { units: 1, items: { f_testhuman: 1 }, lots: [], raw: 0, from: "pack" }, {});
  noteEat(st, n, { units: 1, items: { f_testhuman: 1 }, lots: [], raw: 0, from: "pack" }, {});
  check(thoughtsOf(st, c).some((t) => t.id === "cannibal" && t.v === 10) && thoughtsOf(st, n).some((t) => t.id === "human" && t.v === THOUGHTS.human.v), `human meat: a Cannibal +10, anyone else ${THOUGHTS.human.v}`);
  delete FOODS.f_testhuman;
  check(!Object.values(FOODS).some((f) => f.diet === "human"), "there is no human meat in the game");
  // The birth roll: Picky Eater and Vegetarian come up, a Cannibal never.
  const sw = W(seed + 1);
  let n1 = 0, n2 = 0, n3 = 0, slots = 0;
  for (let i = 0; i < 3000; i++) { const s = makeSurvivor(sw); slots += s.traits.length; if (hasTrait(s, "picky")) n1++; if (hasTrait(s, "vegetarian")) n2++; if (hasTrait(s, "cannibal")) n3++; }
  check(n1 > 0 && n2 > 0 && n3 === 0 && Math.abs((n1 + n2) / slots - TRAIT_ROLL.DIET_SHARE) < 0.02, `rolled at birth: Picky ${n1}, Vegetarian ${n2}, Cannibal ${n3} of ${slots} traits (${((n1 + n2) / slots).toFixed(3)}, aimed at about ${TRAIT_ROLL.DIET_SHARE.toFixed(3)})`);
}

// ---------- 8. ration levels ----------
{
  console.log("Ration levels");
  const run = (lvl) => {
    const st = W();
    const h = quietHub(st);
    st.hour = mildHour(st, 0);
    days(st, 2);
    h.rationLevel = lvl;
    for (const s of residents(st, h.id)) s.mood = 60;
    const e0 = econStats(st).eaten;
    days(st, 6);
    return { ate: (econStats(st).eaten - e0) / 6, h, st, mood: residents(st, h.id).reduce((a, s) => a + s.mood, 0) / residents(st, h.id).length, hung: residents(st, h.id).map((s) => s.hunger) };
  };
  const N = run("normal"), L = run("lean");
  check(L.ate / N.ate > 0.7 && L.ate / N.ate < 0.88, `lean eats about ${RATION_LEVELS.lean.use * 100}% (${r1(L.ate)} vs ${r1(N.ate)} a day: ×${(L.ate / N.ate).toFixed(2)})`);
  check(L.hung.every((v) => v > NEEDS.lean), `lean: everyone above ${NEEDS.lean} (no work lost: ${L.hung.map(r1).join(", ")})`);
  check(L.mood < N.mood - 3, `and it costs mood (−1 a day: ${r1(L.mood)} vs ${r1(N.mood)})`);
  check(near(rationUse(L.st, L.h), RATION_LEVELS.lean.use) && near(foodUse(L.st, L.h).residents / foodUse(N.st, N.h).residents, RATION_LEVELS.lean.use, 0.02), "upkeep.js foodUse follows (every forecast agrees)");
  // A feast day: ×1.5 the food, then back to the level.
  const st = W();
  const h = quietHub(st);
  st.hour = mildHour(st, 0);
  days(st, 2);
  const e0 = econStats(st).eaten;
  days(st, 1);
  const normalDay = econStats(st).eaten - e0;
  setRationLevel(st, h, "feast");
  check(rationKey(st, h) === "feast", "a feast today");
  const e1 = econStats(st).eaten;
  hours(st, 24); basesDaily(st);
  const feastDay = econStats(st).eaten - e1;
  check(feastDay / normalDay > 1.3 && feastDay / normalDay < 1.9, `a feast day eats about 1.5× (${r1(feastDay)} vs ${r1(normalDay)})`);
  check(rationKey(st, h) === "normal", "and the next day it is back to normal");
  // The governor: lean when short and the plots will not cover it, back when the stores are good.
  const g = W();
  const gh = quietHub(g, 5 * residents(g, hub(g).id).length);
  g.hour = mildHour(g, 0);
  check(planRations(g, gh, -2) === "lean" && gh.rationLevel === "lean", `the governor goes lean under ${RATION_PLAN.lean} days with the plots behind`);
  check(planRations(g, gh, -2) === "", "and stays");
  setFood(gh, 40 * residents(g, gh.id).length);
  check(planRations(g, gh, -2) === "normal", `back over ${RATION_PLAN.normal} days`);
  check(planRations(g, gh, 5) === "", "plenty and the plots ahead: nothing to change");
  // The festival is a feast.
  const fz = W();
  const fh = quietHub(fz);
  fz.hour = mildHour(fz, 7);
  holdFestival(fz, fh, "FULL");
  check(rationKey(fz, fh) === "feast", "the harvest festival is a feast day");
  // Saved.
  const L2 = loadFromString(saveToString((L.st.cards.length = 0, L.st)));
  check(hub(L2).rationLevel === "lean", "the level is saved");
}

// ---------- 9. AI groups ----------
{
  console.log("AI groups");
  const st = W();
  st.hour = mildHour(st, 0);
  const f = st.factions.find((x) => x.alive && x.bases && x.bases.length);
  f.pop = 20;
  clearFood(f.stock); addDays(f.stock, 20 * 5);
  check(groupRation(st, f) === "lean", `under ${GROUP_EAT.leanBelow} days a head: lean`);
  clearFood(f.stock); addDays(f.stock, 20 * 30);
  check(groupRation(st, f) === "normal" && groupRation(st, f, true) === "feast", "plenty: normal, a feast on the festival day");
  f.rationLevel = "lean";
  clearFood(f.stock); addDays(f.stock, 20 * 10);
  check(groupRation(st, f) === "lean", "lean stays lean until it is well over the line again");
  // Less eaten on lean; desertion pressure.
  const p0 = desertPressure(st, f);
  f.rationLevel = "normal";
  const p1 = desertPressure(st, f);
  check(p0 > p1, `lean rations push their people (${r1(p0)} vs ${r1(p1)})`);
  check(groupDietPressure(st, { ...f, stock: { f_beans: 200 } }) >= GROUP_EAT.monotony, "the same food all the time pushes them too");
  // A party carries its rations, and brings what is left home.
  clearFood(f.stock); addDays(f.stock, 20 * 30);
  const before = food(f.stock);
  const far = st.tiles.find((t) => !t.loc && t.terrain !== "water" && st.grid.distance(t.id, f.bases[0]) === 3);
  const q = spawnAiParty(st, f, "scav", f.bases[0], far.id, { strength: 4 });
  check(q && q.rations && near(before - food(f.stock), foodIn(q.rations), 1e-6) && foodIn(q.rations) >= PACK.food - 1e-6, `a party carries ${r1(foodIn(q.rations))} days of their food (${q.heads} heads)`);
  const mid = food(f.stock);
  q.idx = 0; q.path = [f.bases[0]];
  removeParty(st, q);
  check(food(f.stock) > mid, "home again: what is left goes back into the stock");
  // factionsDaily: a lean group eats about 80%.
  const eatDay = (lvlFood) => {
    const s2 = W();
    s2.hour = mildHour(s2, 0);
    const g2 = s2.factions.find((x) => x.alive && x.bases && x.bases.length);
    g2.pop = 20;
    clearFood(g2.stock); addDays(g2.stock, 20 * lvlFood);
    s2.parties = s2.parties.filter((x) => x.owner !== g2.id);
    s2.rng.chance = () => false;
    const b0 = food(g2.stock);
    const fields = g2.stock; void fields;
    factionsDaily(s2);
    return { g2, used: b0 - food(g2.stock) };
  };
  const a = eatDay(6), b = eatDay(40);
  check(a.g2.rationLevel === "lean" && b.g2.rationLevel === "normal", `the day's level: ${a.g2.rationLevel} at 6 days a head, ${b.g2.rationLevel} at 40`);
}

// ---------- 10. food value: at least a meal's worth at each meal ----------
{
  console.log("Food value");
  check(FOODS.f_beans.fv === 0.6 && FOODS.f_cannedmeat.fv === 0.9 && FOODS.f_mre.fv === 1.88 && FOODS.f_rice.fv === 5.4 && Object.values(FOODS).every((f) => f.fv > 0 && Math.abs(Math.round(f.fv * 100) - f.fv * 100) < 1e-6), "every item has a food value to two places (beans 0.60, canned meat 0.90, an MRE 1.88, rice 5.40)");
  const m = (k, q) => ({ k, f: FOODS[k], q });
  let p = mealPlan([m("f_beans", 10)], MEAL_FV);
  check(p.items.length === 1 && p.items[0].q === 2 && near(p.fv, 1.2), `cans of beans alone: two whole cans make one person's meal (${p.fv.toFixed(2)})`);
  p = mealPlan([m("f_beans", 10), m("f_cannedfruit", 5), m("f_candybar", 5)], MEAL_FV);
  check(p.items.length === 2 && p.items[0].k === "f_beans" && p.items[0].q === 1 && p.items[1].k === "f_cannedfruit" && p.items[1].q === 1 && near(p.fv, 1.05), `the closest fit: a can of beans and a can of fruit 1.05, not two cans of beans 1.20 (${p.items.map((x) => `${x.q} ${x.k}`).join(", ")})`);
  p = mealPlan([m("f_beans", 10), m("f_rice", 1)], MEAL_FV);
  check(near(p.fv, 1) && p.items[1].k === "f_rice", `or a can of beans and a portion of rice: 1.00 (${p.fv.toFixed(2)})`);
  p = mealPlan([m("f_beans", 1), m("f_candybar", 5)], MEAL_FV);
  check(p.items[0].q === 1 && p.items[1].q === 2 && p.fv >= MEAL_FV && near(p.fv, 1.36), `one can left, then candy bars until it adds up (${p.fv.toFixed(2)})`);
  p = mealPlan([m("f_rice", 3)], MEAL_FV);
  check(near(p.items[0].q * FOODS.f_rice.fv, 1) && near(p.fv, 1), `a kilo of rice is cut to a meal's portion (${p.items[0].q.toFixed(3)} kg)`);
  p = mealPlan([m("f_soup", 1)], MEAL_FV);
  check(p.fv < MEAL_FV, "not enough in store: what there is");
  // Shared: three people and cans of beans: 5 cans for 3 meals of 1.00 (not 6), each eats 1.00.
  {
    const st0 = W(), h0 = quietHub(st0, 0);
    addFood(h0, "f_beans", 10, { state: st0 });
    const ppl0 = residents(st0, h0.id).slice(0, 3);
    for (const x of ppl0) { delete x.food; x.traits = []; }
    const sm = sharedMeal(st0, h0, [{ ...m("f_beans", 10), h: h0 }], ppl0.map((s) => ({ s, units: MEAL_FV / 3 })));
    check(near(10 - h0.stock.f_beans, 5) && ppl0.every((s) => near(sm.got.get(s).units * 3, 1, 1e-6)), `a shared pot: 5 cans of beans feed 3 (each 1.00; ${r1(10 - h0.stock.f_beans)} cans)`);
  }
  // A base of cans eats whole cans: at least a meal each, three a day, and the forecast eats what they ate.
  const st = W();
  const h = quietHub(st, 0);
  st.hour = mildHour(st, 0);
  addFood(h, "f_beans", 3000, { state: st });
  const ppl = residents(st, h.id);
  days(st, 2); // the packs filled first
  const b0 = h.stock.f_beans;
  days(st, 3);
  const perHead = (b0 - h.stock.f_beans) / 3 / ppl.length;
  check(perHead >= 4.95 && perHead <= 5.15, `beans only: the cans shared out, 5 a day a head (3 meals × 1.00 ÷ 0.60: ${perHead.toFixed(2)})`);
  check(mealOver(h) >= 1 && mealOver(h) < 1.03, `shared cans: the meals hardly run over (×${mealOver(h).toFixed(3)})`);
  check(near(foodUse(st, h).rate, mealOver(h) * foodUse(st, { ...h, mealOver: 1 }).rate, 1e-6), "and the forecast eats it (foodUse ×mealOver)");
  check(near(mealFV(st, h), MEAL_FV) && nextMeal(st, h).items[0].q === 2, `the next meal here: ${nextMeal(st, h).text}`);
  h.rationLevel = "lean";
  check(near(mealFV(st, h), 0.8), "lean: a meal is 0.80");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
