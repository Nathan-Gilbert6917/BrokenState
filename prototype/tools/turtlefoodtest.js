// The careful styles' food (ap-food 2026-10-12, user question: "Is cautious and turtle using the old food system
// counting where 12 Food (days) was counted as 1 day of food when making choices. Also just make them want to farm and
// get food more."). Checks:
//   1. the units: every planner reads days of food (foods.js foodIn = kcal / DAY_KCAL), no base holds the old generic
//      "food" or "preserved" key, and in a headless Turtle game the people eat what the planner counts a head a day
//      (farming.js usualFoodNeed, upkeep.js foodUse), give or take the cold, lean days and snacks: no 12× (or any) factor;
//   2. the trade cap by item (foods.js spareOf / spendSpare): the governor's spare table counts food in days under one
//      key ("food") while a deal is made by food item, so merchants at the gates are paid at most the days of food the
//      hub can spare (none while the winter stores fall short), whatever the items;
//   3. the newcomer rule (autopilot.js roomAt, GROW): a small hub (GROW.heads with the newcomers) takes people in on
//      GROW.foodDays a head and its built or queued beds, whatever the winter plan says; a bigger Cautious or Turtle hub
//      refuses them while the winter plan falls short (strictWinter), only from mid-summer (winterActive), not in spring;
//   4. the hub's food run (FOOD_RUN): a hunting trip goes when the food is short even with the style's trip cooldown
//      running, and no hunting or fishing trip while the game in store would rot first (rawGlut), the drying rack
//      wished for instead.
// Usage: node tools/turtlefoodtest.js [days=24]
import { setFood, food } from "./foodkit.js";
import { createWorld, tickHour, hub, atBase, residents, makeSurvivor, day } from "../src/sim/world.js";
import { setAutopilot, safetyAI, GROW, FOOD_RUN, foodTarget } from "../src/sim/autopilot.js";
import { FOODS, foodIn, qtyOf, unitsOf, DAY_KCAL, spareOf, spendSpare, addFood } from "../src/sim/foods.js";
import { econStats, usualFoodNeed, winterOutlook } from "../src/sim/farming.js";
import { foodUse } from "../src/sim/upkeep.js";
import { addBuilding, baseBeds } from "../src/sim/buildings.js";
import { spawnVisitor, openVisitorTrade, autoVisitorTrade } from "../src/sim/visitors.js";
import { lootItem } from "../src/sim/inventory.js";

const DAYS = Number(process.argv[2] || 24);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else console.log(`  FAIL: ${msg}`); if (!ok) fails++; return ok; };
const plain = (s) => { s.traits = []; s.conditions = []; s.perks = []; s.health = 100; s.mood = 80; return s; };
const addPerson = (st, base) => { const s = plain(makeSurvivor(st, 1)); s.location = { kind: "base", baseId: base.id }; s.role = "rest"; st.survivors.push(s); return s; };
const sizeTo = (st, base, n) => {
  while (residents(st, base.id).length < n) addPerson(st, base);
  for (const s of atBase(st, base.id).slice(n)) { s.alive = false; s.location = { kind: "gone" }; }
  for (const s of atBase(st, base.id)) plain(s);
};
const W = (seed = 42) => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.visitorsOff = true; return st; };
// The governor's winter plan for today, with `short` forced (winterPlan keeps one a base a day: gov.winter).
const forceShort = (st, h, short) => { const w = safetyAI.winterPlan(st, h); st.governor.winter[h.id] = { ...w, short }; };

// ---------- 1. the units ----------
{
  console.log("The units: days of food");
  check(Math.abs(foodIn({ f_grain: 10 }) - (10 * FOODS.f_grain.kcal) / DAY_KCAL) < 1e-9, `10 kg of grain is ${foodIn({ f_grain: 10 })} days of food (kcal / ${DAY_KCAL}), not 10 nor 10/12`);
  check(Math.abs(unitsOf("f_beans", qtyOf("f_beans", 7)) - 7) < 1e-9, "qtyOf and unitsOf are inverses (days ↔ items)");
  const st = createWorld({ seed: 6005, factionCount: 20, mode: "normal", size: "normal" });
  st.started = true;
  setAutopilot(st, true, "turtle");
  const h = hub(st);
  let headDays = 0, planned = 0, used = 0;
  const eaten0 = econStats(st).eaten;
  while (day(st) <= DAYS) {
    tickHour(st);
    if (st.hour % 24 !== 1 || !hub(st)) continue;
    const n = st.bases.reduce((a, b) => a + residents(st, b.id).length, 0);
    headDays += n;
    planned += n * usualFoodNeed(day(st) - 2);
    used += n * foodUse(st, h).rate;
    for (const b of st.bases) check(b.stock.food == null && b.stock.preserved == null, `day ${day(st)}: ${b.name} holds no legacy "food" / "preserved" key`);
  }
  const eaten = econStats(st).eaten - eaten0;
  const perHead = eaten / Math.max(1, headDays), plan = planned / Math.max(1, headDays), rate = used / Math.max(1, headDays);
  console.log(`  ${DAYS} days, ${headDays} head-days: eaten ${eaten.toFixed(1)} = ${perHead.toFixed(3)} a head a day; the winter planner counts ${plan.toFixed(3)}, foodUse ${rate.toFixed(3)}`);
  check(perHead >= 0.75 * plan && perHead <= 1.2 * plan, `eaten a head a day (${perHead.toFixed(3)}) is the planner's need (${plan.toFixed(3)}) within 25% / 20%`);
  check(Math.abs(rate - plan) <= 0.25 * plan, `foodUse's rate (${rate.toFixed(3)}) and the winter planner's need (${plan.toFixed(3)}) agree`);
  const t = foodTarget(st, h);
  check(t >= 15 && t <= 150, `foodTarget is days a head (${t.toFixed(1)})`);
}

// ---------- 2. the trade cap by item ----------
{
  console.log("The trade cap by item");
  const spare = { food: 10, water: 5, ammo: 3 };
  check(spareOf(spare, "f_grain") === Math.floor(qtyOf("f_grain", 10)), `10 days to spare is ${spareOf(spare, "f_grain")} kg of grain`);
  check(spareOf(spare, "water") === 5 && spareOf(spare, "scrap") === undefined && spareOf(null, "f_grain") === undefined, "other keys as before; no cap where the table has none");
  spendSpare(spare, { f_grain: qtyOf("f_grain", 4), water: 2 });
  check(Math.abs(spare.food - 6) < 1e-6 && spare.water === 3, `a deal paid comes off in days of food (${spare.food.toFixed(2)} left) and in units (water ${spare.water})`);
  // Merchants at the gates of a hub with plenty of grain, short of scrap: the food they take is capped by spare.food.
  const trade = (spareFood) => {
    const st = createWorld({ seed: 77, factionCount: 6 });
    st.started = true;
    const h = hub(st);
    setFood(h, 600, "f_grain");
    h.stock.scrap = 0;
    const v = spawnVisitor(st, "merchants");
    v.stock.scrap = 200;
    v.tile = h.tile; v.phase = "stop"; v.stayUntil = st.hour + 24;
    openVisitorTrade(st, v, { baseId: h.id });
    const before = food(h);
    const needs = { food: 0.2, scrap: 2.5, fuel: 1, water: 1, meds: 1, parts: 1, ammo: 1 };
    const text = autoVisitorTrade(st, needs, "cautious", { food: spareFood, water: 0, ammo: 0 });
    return { sold: before - food(h), text };
  };
  const none = trade(0), some = trade(12), lots = trade(400);
  check(none.sold < 1e-6, `nothing to spare (the winter short): no food sold (${none.sold.toFixed(1)} days; ${none.text})`);
  check(some.sold <= 12 + 1e-6, `12 days to spare: at most 12 days of food sold (${some.sold.toFixed(1)}; ${some.text})`);
  check(lots.sold > 0, `plenty to spare: food pays for the scrap (${lots.sold.toFixed(1)} days; ${lots.text})`);
}

// ---------- 3. the newcomer rule ----------
{
  console.log("Newcomers (roomAt, GROW, strictWinter)");
  // Late summer (winterActive), a Turtle hub, the winter plan short.
  const at = (n, daysEach, { hour = 50 * 24, beds = 2, short = 300, wells = false } = {}) => {
    const st = W();
    setAutopilot(st, true, "turtle");
    st.hour = hour;
    const h = hub(st);
    sizeTo(st, h, n);
    for (let i = 0; i < beds; i++) addBuilding(h, "bunkhouse");
    if (wells) { addBuilding(h, "well"); addBuilding(h, "well"); addBuilding(h, "cistern"); addBuilding(h, "cistern"); for (let i = 0; i < 4; i++) addBuilding(h, "rain_catcher"); }
    Object.assign(h.stock, { water: 400, scrap: 0, parts: 0 });
    setFood(h, daysEach * n);
    forceShort(st, h, short);
    return { st, h, room: safetyAI.roomAt(st, h, 1), active: safetyAI.winterActive(st, h) };
  };
  const small = at(4, 20);
  check(small.active, "day 50 is in the winter plan's season (mid-summer on)");
  check(small.room, `a Turtle hub of 4 (GROW.heads ${GROW.heads}), short for the winter, ${20} days of food a head: takes a newcomer`);
  check(!at(4, GROW.foodDays * 0.6).room, `the same under GROW.foodDays (${GROW.foodDays}) a head after the newcomer: no`);
  check(!at(4, 20, { beds: 0 }).room, `the same with its ${baseBeds(at(4, 20, { beds: 0 }).h)} beds full (nothing queued): no, not on a bunkhouse it could still build`);
  const big = at(GROW.heads + 1, 150, { beds: 3, wells: true });
  check(!big.room, `a Turtle hub of ${GROW.heads + 1}, short for the winter from mid-summer: no newcomer (strictWinter)`);
  const spring = at(GROW.heads + 1, 150, { hour: 5 * 24, beds: 3, short: 300, wells: true });
  check(!spring.active && spring.room, `the same hub in spring (no winter plan yet: ${spring.active}): the strict rule waits for mid-summer, a newcomer comes in`);
}

// ---------- 4. the hub's food run ----------
{
  console.log("The food run (FOOD_RUN)");
  const st = W(43);
  setAutopilot(st, true, "turtle");
  st.hour = 20 * 24 + 7;
  const h = hub(st);
  sizeTo(st, h, 8);
  for (const s of atBase(st, h.id)) s.gear.weapon = lootItem("huntrifle", "home", ["tf", s.id]);
  Object.assign(h.stock, { water: 300, ammo: 200 }); // ammo.js baseAmmo counts the generic rounds too
  setFood(h, 8 * 4); // four days a head: well under the target
  st.governor.lastLaunch = day(st); // the style's trip cooldown is running (planTrip would wait days)
  const cands = safetyAI.foodTripCands(st, h);
  if (cands.length) {
    const p = safetyAI.hubFoodRun(st);
    check(!!p && p.apFoodRun && (p.apFood === "huntTrips" || p.apFood === "fishTrips"), `short of food with the cooldown running: the hub's food run goes (${p ? p.apFood : "none"})`);
    check(!safetyAI.hubFoodRun(st), "one food run at a time");
  } else console.log("  (no game or water within reach of this hub: the launch checks skipped)");
  // The game glut: raw meat past FOOD_RUN.rawDays a head: no hunting or fishing trip, and the drying rack is wished for.
  const st2 = W(44);
  setAutopilot(st2, true, "turtle");
  const h2 = hub(st2);
  sizeTo(st2, h2, 5);
  setFood(h2, 5 * 3);
  addFood(h2, "f_venison", qtyOf("f_venison", 5 * FOOD_RUN.rawDays + 5));
  check(safetyAI.rawGlut(st2, h2), `${Math.round(unitsOf("f_venison", h2.stock.f_venison))} days of raw venison for 5: a glut`);
  check(safetyAI.foodTripCands(st2, h2).length === 0, "no hunting or fishing trip while it would rot first");
  check(safetyAI.buildWishes(st2, h2).some((w) => w.type === "smoker"), "the drying rack is wished for");
  h2.stock.f_venison = 0;
  check(!safetyAI.rawGlut(st2, h2), "no raw game in store: no glut");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
