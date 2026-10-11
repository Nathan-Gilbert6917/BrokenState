// Food by type test (src/sim/foods.js, storage.js; the food-types overhaul, 2026-10-10): the catalog (every item
// whole: calories, weight, shelf life, tier, diet, raw and meal fields; its value from calories, tier and shelf; no
// generic Food left in SUPPLIES); the calories a source brings are what the old generic food's were (finds, hunting,
// foraging: the dice keep the average); lots age by the room they sit in (cellar, dry, cold store, outside, food that
// keeps) and a walk-in freezer freezes only while base.freezerOn; a base eats the soonest to spoil first and leaves the
// food with the worm's eggs to the end; a team packs what keeps longest and weighs least and eats the soonest to spoil
// first; spoiled food is thrown out (gone) and logged; the shops run down as they are looted and with time (three
// quarters full at the start of a hardcore game, hc-food 2026-10-11); an old save's generic food is typed on load with its calories; the AI groups keep
// typed food, aged coarsely, with no generic keys left after a fortnight of play.
// Usage: node tools/foodtypestest.js [seed]
import { createWorld, hub, atBase, tickHour } from "../src/sim/world.js";
import { SUPPLIES } from "../src/sim/data.js";
import {
  FOODS, TIERS, TIER_VALUE, foodValue, DAY_KCAL, unitsOf, qtyOf, foodIn, typedFood, MIXES, addFood, takeFood, packPick, ageLots, ageCoarse,
  shopFood, drawShop, shopTime, SHOP, SHOP_FOOD, addFoodFind, NORMAL_START, migrateFood, lotsOf, syncLots,
} from "../src/sim/foods.js";
import { STORE, storeFactor, storeSpaces, placeFood, eatFromStore, storageDaily } from "../src/sim/storage.js";
import { launchExpedition } from "../src/sim/parties.js";
import { takeFood as teamTake } from "../src/sim/needs.js";
import { addMeat } from "../src/sim/hunting.js";
import { addForage } from "../src/sim/foraging.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { food, setFood, addDays, clearFood, kindsOf } from "./foodkit.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const W = (opts = {}) => { const st = createWorld({ seed, factionCount: 6, ...opts }); st.started = true; st.visitorsOff = true; return st; };

// ---------- 1. the catalog ----------
{
  console.log("The catalog");
  const keys = Object.keys(FOODS);
  check(keys.length >= 40, `${keys.length} kinds of food`);
  check(!SUPPLIES.food && !SUPPLIES.preserved, "no generic Food or Preserved food in SUPPLIES");
  check(keys.every((k) => SUPPLIES[k] && SUPPLIES[k].weight === FOODS[k].kg), "every food item is a supply with its weight");
  const bad = keys.filter((k) => { const f = FOODS[k]; return !(f.kcal > 0 && f.kg > 0 && f.shelf > 0 && f.name && f.icon && f.word && TIERS.includes(f.tier) && ["meat", "veg", "mixed", "animal", "human"].includes(f.diet)); });
  check(!bad.length, `every item has calories, weight, shelf life, a tier and a diet${bad.length ? `: ${bad.join(", ")}` : ""}`);
  const rawBad = keys.filter((k) => (FOODS[k].group === "rawmeat" || FOODS[k].group === "rawfish") !== !!(FOODS[k].raw && FOODS[k].group !== "shop"));
  check(keys.filter((k) => FOODS[k].group === "rawmeat" || FOODS[k].group === "rawfish").every((k) => FOODS[k].raw), `raw meat and fish are raw: true${rawBad.length ? ` (${rawBad.join(", ")})` : ""}`);
  check(!keys.some((k) => FOODS[k].diet === "human"), "no food is human (the tag is there, no source yet)");
  const meals = keys.filter((k) => FOODS[k].group === "meal");
  check(meals.length >= 4 && meals.every((k) => FOODS[k].moodLift != null), `meals carry a mood lift: ${meals.map((k) => `${FOODS[k].name} ${FOODS[k].moodLift}`).join(", ")}`);
  check(["f_survivalmeal", "f_pemmican", "f_stew", "f_finemeal", "f_lavishmeal"].every((k) => FOODS[k]), "survival meal, pemmican, stew, fine and lavish meals are in the catalog");
  check(FOODS.f_flour && FOODS.f_groundmeat && FOODS.f_groundmeat.raw && FOODS.f_sausage && !Object.values(MIXES).some((m) => m.f_groundmeat || m.f_sausage), "flour, ground meat and sausage are there for the grain mill and the meat grinder (no source yet)");
  check(FOODS.f_lavishmeal.moodLift > FOODS.f_finemeal.moodLift && FOODS.f_finemeal.moodLift > FOODS.f_simplemeal.moodLift, "a lavish meal lifts more than a fine one, a fine one more than a simple one");
  check(keys.every((k) => near(FOODS[k].value, foodValue(FOODS[k]))), "every item's value is foodValue (calories × tier × shelf life)");
  const perKcal = (k) => FOODS[k].value / FOODS[k].kcal;
  check(perKcal("f_mre") > perKcal("f_beans") && perKcal("f_beans") > perKcal("f_bread") && perKcal("f_cannedmeat") > perKcal("f_frozenmeat"), "a calorie that keeps is worth more than one that spoils (MRE > beans > bread; canned > frozen meat)");
  check(perKcal("f_lavishmeal") > perKcal("f_simplemeal") && TIER_VALUE.lavish > TIER_VALUE.simple, "a better meal is worth more a calorie");
  // A day of the usual stores is worth about what a day of the old generic food was (2; preserved food 4).
  const dayVal = (mix) => { const it = typedFood(null, mix, 100, { rng: false, kinds: 99 }); return Object.entries(it).reduce((a, [k, q]) => a + q * FOODS[k].value, 0) / 100; };
  check(dayVal("stores") > 1.5 && dayVal("stores") < 3.2 && dayVal("keeps") > dayVal("fields"), `a day of food is worth ${r2(dayVal("stores"))} of the usual stores, ${r2(dayVal("keeps"))} of food that keeps, ${r2(dayVal("fields"))} of a group's fields (old: 2 and 4)`);
  check(near(unitsOf("f_rationbar", qtyOf("f_rationbar", 3)), 3) && near(unitsOf("f_beans", 5), 1), "units: 5 cans of beans are a day of food (2000 kcal)");
  check(DAY_KCAL === 2000, "a day of food is 2000 kcal");
}

// ---------- 2. the calories a source brings ----------
{
  console.log("Sources keep the old food's calories");
  const st = W();
  for (const mix of Object.keys(MIXES)) {
    let sum = 0;
    const N = 300;
    for (let i = 0; i < N; i++) sum += foodIn(typedFood(st, mix, 10));
    check(Math.abs(sum / N - 10) < 0.35, `10 days of "${mix}" food average ${r2(sum / N)} days (the dice round whole items)`);
  }
  check(near(foodIn(typedFood(null, "shop", 7)), 7), "no game state: no dice, the calories exact");
  const stock = {};
  const items = addFoodFind(st, stock, "farm", 12);
  check(near(foodIn(stock), foodIn(items)) && foodIn(stock) > 9 && foodIn(stock) < 15, `a find of 12 days at a farmstead: ${r1(foodIn(stock))} days as ${Object.keys(items).length} kinds`);
  // Hunting and foraging: days of food in, days of food out.
  const h = hub(st);
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, 2);
  const dest = st.tiles.find((t) => !t.loc && t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 2);
  const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: dest.id, mission: "move", stance: "normal", vehicleId: null, supplies: {} }).party;
  clearFood(p.cargo);
  const kept = addMeat(st, p, 4, 0, "deer");
  check(kept > 0 && near(food(p.cargo), kept, 1e-6) && kindsOf(p.cargo).f_venison, `a deer's 4 days of meat: ${r1(food(p.cargo))} days of venison in the cargo`);
  clearFood(p.cargo);
  addForage(st, p.cargo, 3, null);
  check(near(food(p.cargo), 3, 1e-6) && Object.keys(kindsOf(p.cargo)).length >= 3, `3 days of forage: ${Object.keys(kindsOf(p.cargo)).map((k) => FOODS[k].name).join(", ")}`);
  // New food is fresh, but what only shops have is as old as the outbreak (bread found on day 3 has 2 days left).
  clearFood(p.cargo);
  addFood(p.cargo, "f_potatoes", 5, { state: st });
  addFood(p.cargo, "f_bread", 1, { state: st });
  check(lotsOf(p.cargo).f_potatoes[0].left === FOODS.f_potatoes.shelf && lotsOf(p.cargo).f_bread[0].left < 1, "dug potatoes have their whole shelf; a shop's bread 60 days on is all but gone");
}

// ---------- 3. lots age by the room ----------
{
  console.log("Storage rooms");
  check(storeFactor("cellar", 15) === 0.35 && storeFactor("dry", 15) === 1 && storeFactor("outside", 15) === 1.5 && storeFactor("freezer", 30) === 0.05, "factors: cellar 0.35, dry 1, outside 1.5, freezer 0.05 (at 15°C; the freezer whatever the weather)");
  check(storeFactor("outside", -5) < storeFactor("cellar", 15) && storeFactor("outside", 30, { wet: true }) > storeFactor("outside", 15), "outside: frozen keeps, heat and rain rot");
  check(storeFactor("cold", -3) < storeFactor("cold", 10) && storeFactor("cold", 10) < storeFactor("cold", 20), "an ice house is cold in winter, less so in summer");
  const st = W();
  const h = hub(st);
  h.buildings = h.buildings.filter((b) => !["cellar", "storehouse", "coldstore", "crates", "freezer", "huntcabin"].includes(b.type));
  clearFood(h);
  const sp = storeSpaces(h);
  check(sp.length === 1 && sp[0].kind === "cellar" && sp[0].cap === STORE.hubCellar, `the hub has its own cellar (${STORE.hubCellar} days)`);
  addDays(h, 150, "f_potatoes");
  addDays(h, 100, "f_greens");
  addDays(h, 50, "f_beans");
  let P = placeFood(st, h, 15, false, false);
  const fac = (k) => P.place.get(lotsOf(h)[k][0]);
  check(near(fac("f_greens"), 0.35) && fac("f_potatoes") > 0.35 && fac("f_potatoes") < 1.5 && near(P.outside, 50, 1e-6), `greens (spoil first) fill the cellar first; 50 days of potatoes are outside (potatoes ×${r2(fac("f_potatoes"))})`);
  check(near(fac("f_beans"), 1) && near(P.stable, 50, 1e-6), "the cans keep in any corner: no room needed");
  const left0 = lotsOf(h).f_greens[0].left;
  ageLots(h, 4, (k, f, l) => P.place.get(l));
  check(near(lotsOf(h).f_greens[0].left, left0 - 4 * 0.35, 1e-9), `four days in the cellar: greens' shelf ${left0} → ${r2(lotsOf(h).f_greens[0].left)}`);
  // Spoiled food is gone.
  ageLots(h, 30, (k, f, l) => P.place.get(l));
  check(!kindsOf(h).f_greens && !h.stock.f_greens && near(food(h), 50 + kindsOf(h).f_potatoes || 50, 1e-6), "spoiled greens are thrown out (gone from the stock and its lots)");
  // storageDaily logs what spoiled.
  clearFood(h);
  addFood(h, "f_milk", 10, { left: 0.1 });
  const top = st.log[0];
  const res = storageDaily(st, h);
  const lines = st.log.slice(0, st.log.indexOf(top)).map((l) => l.text);
  check(res.items.f_milk > 0 && !h.stock.f_milk && lines.some((l) => /food spoiled and was thrown out: .*milk/i.test(l)), `a day's spoiling logged: ${lines.join(" | ").slice(0, 160)}`);
  check(h.spoiledToday && h.spoiledToday.units > 0, "and kept for the screens (base.spoiledToday)");

  // The walk-in freezer (the freezer-parts branch builds it; here faked): freezes only while base.freezerOn.
  clearFood(h);
  addDays(h, 100, "f_frozenmeat");
  h.buildings.push({ type: "freezer", id: "fz-test" }); // power.js sets base.freezerOn / freezersOn: faked here
  h.freezerOn = true;
  P = placeFood(st, h, 15, false, false);
  const fz = P.spaces.find((s) => s.key === "freezer");
  check(fz && fz.cap === STORE.freezer && near(P.place.get(lotsOf(h).f_frozenmeat[0]), 0.05), `a running walk-in freezer: ${STORE.freezer} days, the meat in it ×0.05`);
  h.freezerOn = false;
  P = placeFood(st, h, 15, false, false);
  check(P.spaces.find((s) => s.key === "freezeroff").kind === "dry" && near(P.place.get(lotsOf(h).f_frozenmeat[0]), 0.35), "switched off (no power): a cool pantry; the meat goes to the colder cellar first (×0.35)");
  h.buildings = h.buildings.filter((b) => b.id !== "fz-test");
  delete h.freezerOn;
}

// ---------- 4. eating at a base ----------
{
  console.log("A base eats the soonest to spoil first");
  const st = W();
  const h = hub(st);
  clearFood(h);
  addDays(h, 2, "f_bread");
  addDays(h, 5, "f_beans");
  addDays(h, 3, "f_potatoes", { egg: true });
  let short = eatFromStore(h, 3, st);
  check(short === 0 && !kindsOf(h).f_bread && near(kindsOf(h).f_beans, 4) && near(kindsOf(h).f_potatoes, 3), "bread first (5 days' shelf), then the cans; the potatoes with the worm's eggs are left");
  h.rawCropEaten = 0;
  short = eatFromStore(h, 6, st);
  check(short === 0 && !kindsOf(h).f_beans && near(kindsOf(h).f_potatoes, 1) && near(h.rawCropEaten, 2), `then the potatoes with eggs, eaten raw (base.rawCropEaten ${r1(h.rawCropEaten)})`);
  short = eatFromStore(h, 3, st);
  check(near(short, 2), `what is not there is short (${r1(short)} days)`);
  check(h.ate && h.ate.units > 0, "the day's eating is noted (base.ate: the mood from meals, relations.js)");
}

// ---------- 5. a team packs and eats ----------
{
  console.log("A team packs what keeps and weighs least");
  const st = W();
  const h = hub(st);
  clearFood(h);
  addDays(h, 20, "f_beans"); addDays(h, 10, "f_rationbar"); addDays(h, 6, "f_bread"); addDays(h, 6, "f_jerky");
  const pick = packPick(st, h, 14, { days: 7 });
  check(pick.f_rationbar > 0 && pick.f_jerky > 0 && !pick.f_bread && !pick.f_beans && foodIn(pick) >= 14, `14 days for a week's trip: ration bars and jerky, no bread (spoils), no cans (heavy): ${Object.entries(pick).map(([k, q]) => `${r1(q)} ${FOODS[k].word}`).join(", ")}`);
  const pre = packPick(st, h, 2, { days: 7, prefer: "f_beans" });
  check(pre.f_beans > 0 && Object.keys(pre).length === 1, "a chosen kind goes first (the planner's Pack first)");
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, 2);
  const dest = st.tiles.find((t) => !t.loc && t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 2);
  const f0 = food(h);
  const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: dest.id, mission: "move", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6 } }).party;
  check(p && food(p) >= 6 && near(food(h), f0 - food(p), 1e-6) && !p.supplies.food && kindsOf(p).f_rationbar, `the team leaves with ${r1(food(p))} days of food, typed (${Object.keys(kindsOf(p)).map((k) => FOODS[k].name).join(", ")}), taken from the base`);
  check(Object.keys(p.foodLots || {}).length > 0, "with their lots (shelf left) from the base");
  addDays(p.cargo, 1, "f_berries");
  teamTake(p, 1);
  check(!kindsOf(p.cargo).f_berries, "the team eats the found berries (spoil soonest) first");
  // Carried food ages by the hour; berries in a hot pack spoil.
  addFood(p.cargo, "f_berries", 2, { left: 0.02 });
  ageLots(p.cargo, 1 / 24, () => 1.6);
  check(!kindsOf(p.cargo).f_berries, "carried berries that run out of shelf are thrown out");
}

// ---------- 6. the shops run down ----------
{
  console.log("Shops run down");
  const st = W();
  const t = st.tiles.find((x) => x.loc && x.loc.type === "supermarket") || st.tiles.find((x) => x.loc && SHOP_FOOD[x.loc.type]);
  check(!!t, `a shop on the map (${t && t.loc.type})`);
  if (t) {
    st.hour = 0;
    const full = shopFood(st, t);
    check(near(full, 1), "a normal game's shop starts full");
    drawShop(st, t, SHOP_FOOD[t.loc.type] / 2);
    check(near(shopFood(st, t), 0.5), "looting half its food leaves half");
    const s1 = {}, s2 = {};
    const n1 = foodIn(addFoodFind(st, s1, t.loc.type, 10, { tile: t.id }));
    check(n1 < 7 && shopFood(st, t) < 0.5, `a find there now brings ${r1(n1)} of 10 days, and lowers it again`);
    t.foodStock = 1;
    st.hour = 24 * SHOP.halfLife;
    check(near(shopTime(st), 0.5, 1e-9) && near(shopFood(st, t), 0.5, 1e-9), `time: half after ${SHOP.halfLife} days (rats, other survivors)`);
    st.hour = 24 * 5000;
    check(near(shopTime(st), SHOP.floor), `never below ${SHOP.floor}`);
    st.hour = 24 * 20;
    const it = typedFood(st, "shop", 300);
    check(!it.f_bread && !it.f_frozenmeat && !it.f_eggs, `${NORMAL_START + 20} days after the outbreak: no bread, frozen meat or eggs left in the shops`);
    void s2;
  }
  const hc = W({ mode: "hardcore" });
  hc.mode = "hardcore";
  const t2 = hc.tiles.find((x) => x.loc && SHOP_FOOD[x.loc.type]);
  check(t2 && near(shopFood(hc, t2), SHOP.hardcoreStart), `hardcore: the shops start ${Math.round(SHOP.hardcoreStart * 100)}% full (${t2 && r2(shopFood(hc, t2))})`);
  check(near(SHOP.hardcoreStart, 0.75), `hc-food: hardcore's shops start three quarters full, not half (${SHOP.hardcoreStart})`);
  const nm = W();
  const t3 = nm.tiles.find((x) => x.loc && SHOP_FOOD[x.loc.type]);
  check(t3 && near(shopFood(nm, t3), shopTime(nm)), `normal: the shops start full (${t3 && r2(shopFood(nm, t3))}, × the outbreak's time ${r2(shopTime(nm))})`);
}

// ---------- 7. an old save ----------
{
  console.log("Old saves are typed on load");
  const st = W();
  const h = hub(st);
  clearFood(h);
  h.stock.food = 120; h.stock.preserved = 30; h.meat = 6; h.wormCrop = 4; h.jarsInUse = 5;
  delete h.foodLots;
  for (const f of st.factions) if (f.stock) { for (const k of Object.keys(f.stock)) if (FOODS[k]) delete f.stock[k]; f.stock.food = 50; f.stock.preserved = 10; }
  delete st.foodTypes;
  const back = loadFromString(saveToString(st));
  const hb = back.bases.find((b) => b.id === h.id);
  check(!("food" in hb.stock) && !("preserved" in hb.stock) && hb.meat == null && hb.wormCrop == null, "no generic food or base.meat left");
  check(near(foodIn(hb.stock), 150, 1e-6), `the calories kept: 120 + 30 → ${r2(foodIn(hb.stock))} days`);
  check(near(kindsOf(hb).f_venison, 6, 1e-6) && lotsOf(hb).f_venison.every((l) => l.left < FOODS.f_venison.shelf), "the meat as raw venison, half its shelf gone");
  check(lotsOf(hb).f_potatoes && lotsOf(hb).f_potatoes.some((l) => l.egg), "the crops with the worm's eggs on an egg lot");
  check(near(kindsOf(hb).f_jarred, 10, 1e-6), "jarred food as many portions as the jars in use held (5 jars: 10)");
  check(back.factions.filter((f) => f.stock).every((f) => !("food" in f.stock) && near(foodIn(f.stock), 60, 1e-6)), "the groups' stores typed with the same calories");
  check(back.foodTypes === 1, "once (state.foodTypes)");
  const again = loadFromString(saveToString(back));
  check(near(foodIn(again.bases.find((b) => b.id === h.id).stock), foodIn(hb.stock), 1e-6), "a second load changes nothing");
  void migrateFood; void syncLots;
}

// ---------- 8. the AI groups ----------
{
  console.log("AI groups keep typed food, aged coarsely");
  const stock = { f_bread: 10, f_beans: 50 };
  const lost = ageCoarse(stock, 1);
  check(stock.f_bread < 10 && stock.f_beans > 49.9 && lost > 0, `a day: bread ${r2(stock.f_bread)} of 10, beans ${r2(stock.f_beans)} of 50 (${r2(lost)} days of food lost)`);
  const st = W();
  const groups = st.factions.filter((f) => f.stock && f.alive !== false);
  check(groups.length > 0 && groups.every((f) => !("food" in f.stock) && foodIn(f.stock) > 0), `every group starts with typed food (${groups.map((f) => r1(foodIn(f.stock))).join(", ")} days)`);
  for (let i = 0; i < 24 * 14; i++) tickHour(st);
  const generic = st.factions.filter((f) => f.stock && ("food" in f.stock || "preserved" in f.stock));
  check(!generic.length, `two weeks on: no group holds generic food${generic.length ? ` (${generic.map((f) => f.name).join(", ")})` : ""}`);
  check(!(st.foodStray > 0), `nothing needed the stray-food safety net (state.foodStray ${st.foodStray || 0})`);
  check(st.factions.some((f) => f.foodSpoiled > 0), "the groups' food spoils too (f.foodSpoiled)");
  const hb = hub(st);
  check(!("food" in hb.stock) && foodIn(hb.stock) > 0, `the hub still eats typed food (${r1(foodIn(hb.stock))} days)`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
