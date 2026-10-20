// Needs test (src/sim/needs.js, upkeep.js heating): hunger and thirst gauges fall and refill from the team's
// inventory out of a base (the food nearest to spoiling first, packed or found, sim/foods.js; found water) and follow the base's stores at a
// base (the base's daily totals stay upkeep.js's); low gauges cut work and aim and an empty one costs health away from
// a base; rations (full / short / none) and who eats first when short; treats used by the simple rule and by hand,
// keepsakes kept; an errand takes about a day's food and water a day and brings back what is left; heating fuel per head
// below 0°C (×1.5 below −8°C), the cold without it, a shelter's camp fire; a team at a lit camp fire stays out of the
// cold; gauges saved, and old saves start full; starving and parched day after day (the morning mood hit grows, resets
// when they eat, a base out of food counts from its first day in place of the old flat penalty, reaches rock bottom on
// the road before hunger kills) and the starving status icon.
// Usage: node tools/needstest.js [seed]
import { FOODS, addFood, foodIn } from "../src/sim/foods.js"; // food value (a meal 1.00)
import { food, setFood, addDays, clearFood, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, hub, atBase, residents, makeSurvivor, tickHour } from "../src/sim/world.js";
import { basesDaily } from "../src/sim/economy.js";
import { foodUse, heatUse, heatRate, HEAT } from "../src/sim/upkeep.js";
import { econStats } from "../src/sim/farming.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import {
  NEEDS, COLD, teamNeedsHour, needsHour, needsWork, needsAim, teamTreats, treatsFor, useTreat, heatDaily, packErrand, teamCold, takeFood,
  STARVE, starveMood, starvingDaily, hungerOf,
} from "../src/sim/needs.js";
import { moodFactors } from "../src/sim/relations.js";
import { SNAP } from "../src/sim/mentalbreaks.js";
import { statusesOf } from "../src/sim/status.js";
import { moodWork } from "../src/sim/morale.js";
import { hubUpkeepDaily } from "../src/sim/hubevents.js";
import { newItem } from "../src/sim/inventory.js";
import { dayMeanTemp, dayLowTemp, foodNeedFactor, thirstAt } from "../src/sim/weather.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { upkeepLine } from "../src/ui/farming.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const r1 = (v) => Math.round(v * 10) / 10;
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.visitorsOff = true; return st; };
const plain = (s) => { s.traits = []; s.conditions = []; s.perks = []; s.health = 100; s.mood = 70; s.hunger = 100; s.thirst = 100; return s; };
function quietHub(st) {
  const h = hub(st);
  for (const s of atBase(st, h.id)) { plain(s); s.role = "rest"; s.station = null; }
  Object.assign(h.stock, { water: 70, scrap: 300, parts: 30, fuel: 40, meds: 20, ammo: 50, jars: 40 });
  setFood(h, 500); // 500 days of ration bars (tools/foodkit.js)
  return h;
}
// A spring day at noon, in the mild weather (no cold appetite, no heating).
const mildDay = (st) => { for (let d = 3; d < 60; d++) if (dayMeanTemp(st, d) > 5 && foodNeedFactor(st, d) === 1) return d; return 5; };
// A team of n from the hub, waiting on a tile nearby (not moving: one ration a day each).
function team(st, n, supplies) {
  const h = hub(st);
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, n);
  const dest = st.tiles.find((t) => !t.loc && t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 2);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: dest.id, mission: "move", stance: "normal", vehicleId: null, supplies });
  const p = res.party;
  p.phase = "waiting";
  p.path = [p.path[0]]; p.idx = 0;
  for (const s of crew) plain(s);
  return { p, crew };
}

// ---------- 1. out of a base: the gauges fall and are refilled from the team's inventory ----------
{
  console.log("A team eats and drinks from what it carries");
  const st = W();
  quietHub(st);
  st.hour = mildDay(st) * 24 + 13;
  const { p, crew } = team(st, 2, { food: 10, water: 10 });
  const f0 = food(p), w0 = p.supplies.water;
  for (let i = 0; i < 6; i++) teamNeedsHour(st, p, crew);
  check(near(crew[0].hunger, 100 - NEEDS.food / 4) && near(crew[0].thirst, 100 - (NEEDS.water * thirstAt(st)) / 4, 1e-6), `six hours at rest: hunger 100 → ${r1(crew[0].hunger)}, thirst → ${r1(crew[0].thirst)}`);
  check(food(p) === f0 && p.supplies.water === w0, "nobody eats while the gauges are high (above 70)");
  for (let i = 0; i < 24; i++) teamNeedsHour(st, p, crew);
  check(food(p) < f0 && p.supplies.water < w0, `then they eat and drink from the team's supplies (food ${f0} → ${r1(food(p))}, water ${w0} → ${r1(p.supplies.water)})`);
  check(crew.every((s) => s.hunger >= 69 && s.thirst >= 69), "and stay fed");
  // A day's food per person in the long run.
  const g0 = crew.reduce((a, s) => a + s.hunger, 0), fA = food(p);
  for (let i = 0; i < 48; i++) teamNeedsHour(st, p, crew);
  const ate = fA - food(p) + (g0 - crew.reduce((a, s) => a + s.hunger, 0)) / NEEDS.food;
  check(near(ate, 2 * 2, 1e-6), `two days at rest: 1 ration a person a day, the gauges counted (${r1(ate)} for 2 people)`);
  // The food nearest to spoiling first, packed or found: raw venison (3 days), then apples (a month), then the packed
  // beans (years), and the MREs (longer still) last.
  setFood(p, 3, "f_beans"); clearFood(p.cargo);
  addDays(p.cargo, 2, "f_venison"); addDays(p.cargo, 1, "f_apples"); addDays(p.cargo, 2, "f_mre");
  const got = takeFood(p, 2.5);
  const kc = kindsOf(p.cargo);
  check(near(got, 2.5) && !kc.f_venison && near(kc.f_apples, 0.5) && near(food(p), 3) && near(kc.f_mre, 2), "the food nearest to spoiling is eaten first (raw venison, then apples), found or packed");
  takeFood(p, 2);
  check(!kindsOf(p.cargo).f_apples && near(food(p), 1.5) && near(kindsOf(p.cargo).f_mre, 2), "then the packed beans before the MREs that keep longer");
  // Found water once the packed water is gone.
  p.supplies.water = 0; p.cargo.supplies.water = 5;
  for (const s of crew) s.thirst = 30;
  teamNeedsHour(st, p, crew);
  check(p.cargo.supplies.water < 5 && crew.every((s) => s.thirst > 90), "found water is drunk when the packed water is gone");
  // Nothing left: the gauges run down, then cost health; no free water.
  clearFood(p); clearFood(p.cargo); p.supplies.water = 0; p.cargo.supplies.water = 0;
  for (const s of crew) { s.hunger = 2; s.thirst = 2; s.health = 100; }
  for (let i = 0; i < 3; i++) teamNeedsHour(st, p, crew);
  check(p.noFood && p.noWater, "out of food and water: the team is starving (no camp healing)");
  check(near(crew[0].health, 100 - 2 * (NEEDS.hurtFood + NEEDS.hurtWater), 1e-6) || crew[0].health < 100 - 2 * (NEEDS.hurtFood + NEEDS.hurtWater) + 1e-6, `empty gauges cost health: ${r1(crew[0].health)} after three hours (hunger ${NEEDS.hurtFood}/h, thirst ${NEEDS.hurtWater}/h)`);
}

// ---------- 2. at a base: the gauges follow the stores; the base's totals stay upkeep.js's ----------
{
  console.log("At a base");
  const st = W();
  const h = quietHub(st);
  st.hour = mildDay(st) * 24 + 1;
  const n = residents(st, h.id).length;
  // eating.js: everyone eats by the hour at the mealtimes, each to their own target (80–100); the stores pay as they eat.
  // Two days to settle (the gauges start full), then a day measured against upkeep.js's per head × heads.
  for (let d = 0; d < 2; d++) { for (let i = 0; i < 24; i++) { st.hour++; needsHour(st); } basesDaily(st); }
  check(residents(st, h.id).every((s) => s.hunger >= 60 && s.hunger <= 100 && s.thirst >= NEEDS.drink[0] && s.thirst <= 100), `fed and watered in full, everyone stays in their band (hunger ${residents(st, h.id).map((s) => r1(s.hunger)).join(", ")}; thirst ${residents(st, h.id).map((s) => r1(s.thirst)).join(", ")})`);
  // Thirst moves at a base as hunger does (2026-10-19): it falls by the hour at the day's rate and they drink from the
  // stores below the drink line, up to full; so over a day everyone drinks about a day's water at the day's thirst.
  {
    const r0 = residents(st, h.id)[0];
    const t0 = r0.thirst;
    st.hour++; needsHour(st);
    check(near(r0.thirst, t0 - (NEEDS.water / 24) * thirstAt(st), 1e-6) || (t0 - (NEEDS.water / 24) * thirstAt(st) < NEEDS.drink[0] && near(r0.thirst, NEEDS.drink[1], 1e-6)), `thirst falls by the hour at a base (${r1(t0)} → ${r1(r0.thirst)}, ${r1((NEEDS.water / 24) * thirstAt(st))} an hour at today's thirst ${thirstAt(st)})`);
    // Two days: the drinks (each hour's rise plus the hour's fall before it) add up to the days' water, give or take
    // one drink (the sawtooth's phase), and the gauge never sits below the drink line.
    let drank = 0, drinks = 0, tMin = 100;
    for (let i = 0; i < 48; i++) { const b = r0.thirst; st.hour++; needsHour(st); const wr = (NEEDS.water / 24) * thirstAt(st); if (r0.thirst > b) { drank += r0.thirst - b + wr; drinks++; } tMin = Math.min(tMin, r0.thirst); if (st.hour % 24 === 0) basesDaily(st); }
    const want = 2 * NEEDS.water * thirstAt(st), aDrink = NEEDS.drink[1] - NEEDS.drink[0];
    check(drinks >= 2 && tMin >= NEEDS.drink[0] - 1e-6, `they drink from the stores below ${NEEDS.drink[0]} and never sit under it (${drinks} drinks in two days, lowest ${r1(tMin)})`);
    check(Math.abs(drank - want) <= aDrink + 1e-6, `about a day's water a day, at the season's thirst (${r1(drank)} of ${r1(want)} points over two days)`);
  }
  const e0 = econStats(st).eaten, f0 = food(h);
  for (let i = 0; i < 24; i++) { st.hour++; needsHour(st); }
  basesDaily(st);
  const ate = econStats(st).eaten - e0;
  check(Math.abs(ate - foodUse(st, h).residents) < 0.15 * foodUse(st, h).residents && near(f0 - food(h), ate, 0.3), `the day's eating is about upkeep.js's per head × heads (${r1(ate)} for ${n}, ${r1(foodUse(st, h).residents)} expected; the stores ${r1(f0 - food(h))})`);
  // Come home hungry: they eat at the next mealtime (or now, below the snack line), from the stores.
  const s = residents(st, h.id)[0];
  s.hunger = 20; s.thirst = 20;
  const fb = food(h);
  for (let i = 0; i < 10; i++) { st.hour++; needsHour(st); }
  check(s.hunger > 75 && s.thirst > 40 && food(h) < fb - 0.5, `back home hungry: they eat their fill at home, from the stores (hunger 20 → ${r1(s.hunger)}, ${r1(fb - food(h))} days of food)`);
  // Short rations: the gauges sink to the lean level and hold.
  for (const x of residents(st, h.id)) { x.hunger = 100; x.thirst = 100; }
  h.rationing = true;
  for (let i = 0; i < 24 * 8; i++) { st.hour++; needsHour(st); }
  const hs = residents(st, h.id).map((x) => x.hunger);
  check(hs.every((v) => v < NEEDS.lean + 1 && v > 20), `a week on short rations: hungry but holding (${hs.map(r1).join(", ")})`);
  h.rationing = false;
  // Out of food: everyone's hunger falls (the base's hunger days do the damage, economy.js).
  h.hungerDays = 1;
  clearFood(h);
  for (const x of residents(st, h.id)) if (x.ration) clearFood(x.ration); // nothing in the packs either (eating.js)
  const before = residents(st, h.id).map((x) => x.health);
  for (let i = 0; i < 24; i++) { st.hour++; needsHour(st); }
  check(residents(st, h.id).every((x, i) => x.hunger < hs[i] && x.health === before[i]), "a base out of food: hunger falls, and only economy.js's hunger days cost health");
  h.hungerDays = 0;
}

// ---------- 3. what low gauges do ----------
{
  console.log("Low gauges");
  const s = { hunger: 100, thirst: 100, mood: 60, name: "A B" };
  check(needsWork(s) === 1 && needsAim(s) === 0, "fed and watered: no effect");
  s.hunger = 25;
  check(near(needsWork(s), 0.8, 1e-3) && needsAim(s) < 0, `very hungry: work ×${needsWork(s)}, aim ${needsAim(s)}`);
  s.hunger = 100; s.thirst = 25;
  check(near(needsWork(s), 0.75, 1e-3) && needsAim(s) < -5, `very thirsty is worse: work ×${needsWork(s)}, aim ${needsAim(s)}`);
  s.thirst = 0; s.hunger = 0;
  check(near(needsWork(s), 0.3, 1e-3), `both empty: work ×${needsWork(s)}`);
  check(near(moodWork(s), 0.3 * moodWork({ mood: 60 }), 1e-2), "morale.js moodWork takes hunger and thirst in (base work, building, crafting …)");
}

// ---------- 4. rations and who eats first ----------
{
  console.log("Rations and sharing");
  const st = W();
  quietHub(st);
  st.hour = mildDay(st) * 24 + 13;
  const full = team(st, 2, { food: 30, water: 30 });
  const days = 6;
  for (let i = 0; i < 24 * days; i++) teamNeedsHour(st, full.p, full.crew);
  const usedFull = 30 - food(full.p);
  const st2 = W();
  quietHub(st2);
  st2.hour = mildDay(st2) * 24 + 13;
  const sh = team(st2, 2, { food: 30, water: 30 });
  sh.p.ration = "short";
  for (let i = 0; i < 24 * days; i++) teamNeedsHour(st2, sh.p, sh.crew);
  const usedShort = 30 - food(sh.p);
  check(usedShort < usedFull * 0.7 && sh.crew.every((s) => s.hunger < NEEDS.lean && s.hunger > 25), `short rations stretch the food (${r1(usedShort)} vs ${r1(usedFull)} in ${days} days; hunger ${sh.crew.map((s) => r1(s.hunger)).join(", ")})`);
  sh.p.ration = "none";
  const f1 = food(sh.p);
  for (let i = 0; i < 24; i++) teamNeedsHour(st2, sh.p, sh.crew);
  check(food(sh.p) === f1, "no rations: the food is kept");
  // Scarce food: the hurt eat first (default); evenly when set.
  const st3 = W();
  quietHub(st3);
  st3.hour = mildDay(st3) * 24 + 13;
  const sc = team(st3, 2, { food: 0.5, water: 10 });
  sc.crew[0].hunger = 30; sc.crew[1].hunger = 30; sc.crew[1].health = 40;
  teamNeedsHour(st3, sc.p, sc.crew);
  check(sc.crew[1].hunger > sc.crew[0].hunger + 15, `short of food, the hurt eat first (${r1(sc.crew[1].hunger)} vs ${r1(sc.crew[0].hunger)})`);
  const st4 = W();
  quietHub(st4);
  st4.hour = mildDay(st4) * 24 + 13;
  const ev = team(st4, 2, { food: 0.5, water: 10 });
  ev.p.share = "even";
  ev.crew[0].hunger = 30; ev.crew[1].hunger = 30; ev.crew[1].health = 40;
  teamNeedsHour(st4, ev.p, ev.crew);
  check(near(ev.crew[0].hunger, ev.crew[1].hunger, 1e-6), "evenly: the same share each");
}

// ---------- 4b. a team's meals: breakfast, lunch and dinner from one pot ----------
{
  console.log("A team's meals (food value)");
  const st = W();
  quietHub(st);
  st.hour = mildDay(st) * 24 + 1;
  const { p, crew } = team(st, 3, { food: 0, water: 30 });
  clearFood(p.supplies);
  addFood(p, "f_beans", 60, { state: st });
  for (const s of crew) { s.hunger = 90; delete s.food; s.traits = []; if (s.ration) s.ration.supplies = {}; }
  const meals = new Set();
  const b0 = p.supplies.f_beans;
  for (let i = 0; i < 72; i++) {
    st.hour++;
    const before = p.supplies.f_beans;
    teamNeedsHour(st, p, crew);
    if (p.supplies.f_beans < before - 1e-9) meals.add(st.hour % 24);
  }
  check([...meals].sort((a, b) => a - b).join(",") === "6,12,20", `they eat at breakfast, lunch and dinner on the road (${[...meals].sort((a, b) => a - b).join(", ")})`);
  const perHead = (b0 - p.supplies.f_beans) / 3 / 3;
  check(perHead >= 4.95 && perHead <= 5.2, `the pot shares the cans: 5 cans of beans a day a head (3 × 1.00 ÷ 0.60: ${perHead.toFixed(2)})`);
  check(crew.every((s) => s.hunger > 75), `and they stay fed (${crew.map((s) => r1(s.hunger)).join(", ")})`);
  // A lone traveller: the closest fit from what the team carries.
  const st2 = W();
  quietHub(st2);
  st2.hour = mildDay(st2) * 24 + 5;
  const t2 = team(st2, 1, { food: 0, water: 10 });
  clearFood(t2.p.supplies);
  addFood(t2.p, "f_beans", 10, { state: st2 }); addFood(t2.p, "f_cannedfruit", 10, { state: st2 });
  const s1 = t2.crew[0]; s1.hunger = 80; delete s1.food; s1.traits = []; if (s1.ration) s1.ration.supplies = {};
  st2.hour++;
  teamNeedsHour(st2, t2.p, t2.crew);
  const ate = (10 - t2.p.supplies.f_beans) * FOODS.f_beans.fv + (10 - t2.p.supplies.f_cannedfruit) * FOODS.f_cannedfruit.fv;
  check(ate >= 1 - 1e-9 && ate <= 1.06, `alone at breakfast: the closest fit, at least 1.00 (${ate.toFixed(2)}: not two cans of beans)`);
  // Nearly full: the meal fills them to 100, no more (no food thrown away).
  s1.hunger = 96; s1.food = null;
  const fv0 = foodIn(t2.p.supplies) * 3;
  st2.hour += 6; // lunch
  teamNeedsHour(st2, t2.p, t2.crew);
  check(s1.hunger <= 100 && (fv0 - foodIn(t2.p.supplies) * 3) < 0.65, `nearly full at lunch: a smaller meal (${((fv0 - foodIn(t2.p.supplies) * 3)).toFixed(2)}), not a full stomach topped over`);
  st2.hour -= 6;
  // Short rations: a meal is 0.60.
  t2.p.ration = "short";
  s1.hunger = 45;
  const f0 = foodIn(t2.p.supplies);
  st2.hour += 6; // lunch
  teamNeedsHour(st2, t2.p, t2.crew);
  const fvAte = (f0 - foodIn(t2.p.supplies)) * 3;
  check(fvAte >= 0.6 - 1e-6 && fvAte < 0.75, `short rations: a meal of at least 0.60 (${fvAte.toFixed(2)})`);
}

// ---------- 5. treats ----------
{
  console.log("Treats");
  const st = W();
  quietHub(st);
  st.hour = mildDay(st) * 24 + 13;
  const { p, crew } = team(st, 2, { food: 10, water: 10 });
  const [a, b] = crew;
  a.mood = 20; b.mood = 80;
  a.pockets[0] = newItem("chocolate");
  a.pockets[1] = newItem("photos");
  p.cargo.gear.push(newItem("whiskey"));
  const lines = teamTreats(st, p);
  check(lines.length === 1 && !a.pockets[0] && a.mood > 20 && a.pockets[1] && a.pockets[1].key === "photos", `the glum one eats the chocolate (mood 20 → ${r1(a.mood)}), the photos are kept`);
  check(p.cargo.gear.some((it) => it.key === "whiskey"), "valuables are not used above mood 20");
  a.mood = 10; a.buzz = null;
  p.phase = "waiting";
  teamTreats(st, p);
  check(!p.cargo.gear.some((it) => it.key === "whiskey") && a.buzz && a.buzz.label === "Hungover", "below 20, at rest: the whiskey from the cargo (a hangover follows)");
  // By hand: someone in good spirits can still be given one.
  b.pockets[0] = newItem("candy");
  const t = treatsFor(st, b).find((x) => x.key === "candy");
  const m0 = b.mood;
  const line = t ? useTreat(st, b, t.loc) : "";
  check(line && b.mood > m0 && !b.pockets[0], `by hand: ${line}`);
  // The hourly rule runs at the treat hour.
  a.mood = 20; a.buzz = null; a.pockets[2] = newItem("instcoffee");
  st.hour = Math.floor(st.hour / 24) * 24 + NEEDS.treatHour;
  needsHour(st);
  check(!a.pockets[2], "at the evening hour the team uses its treats by itself");
}

// ---------- 6. errands ----------
{
  console.log("Errands");
  const st = W();
  const h = quietHub(st);
  st.hour = mildDay(st) * 24 + 1;
  const s = atBase(st, h.id).find((x) => !x.leader);
  const food0 = food(h), water0 = h.stock.water;
  const add = packErrand(st, h, s, 4); // eating.js: their own pack, topped up to the errand's days
  const pk = s.ration;
  check(food(pk) >= 4 && food(pk) < 4 + 1.21 && pk.supplies.water >= 4 && near(food(h), food0 - food(pk)) && near(h.stock.water, water0 - add.water), `a 4-day errand fills their pack with ${r1(food(pk))} days of food (whole ration bars) and ${pk.supplies.water} water from the base`);
  s.location = { kind: "errand", baseId: h.id, until: Math.floor(st.hour / 24) + 1 + 4 };
  for (let i = 0; i < 24 * 4; i++) { st.hour++; needsHour(st); }
  check(s.hunger > 50 && s.thirst > 50 && food(pk) < 4 && food(pk) > 0, `they eat on the way (hunger ${r1(s.hunger)}, ${r1(food(pk))} days of food left)`);
  const left = food(pk);
  const f1 = food(h);
  st.hour = (s.location.until - 1) * 24 + 1;
  st.rng.chance = () => false; // never lost, no find
  hubUpkeepDaily(st);
  const back = food(h) - f1;
  check(s.location.kind === "base" && near(back + food(pk), left, 1e-6) && food(pk) <= 1.5 + 1.21, `back home: what is over their usual pack comes back (${r1(back)} of ${r1(left)} days; ${r1(food(pk))} kept in the pack)`);
}

// ---------- 7. heating ----------
{
  console.log("Heating fuel per head");
  const st = W();
  const h = quietHub(st);
  let cold = null, bitter = null, warm = null, chill = null;
  for (let d = 0; d < 112 * 2 && (cold == null || bitter == null || warm == null || chill == null); d++) {
    const t = dayMeanTemp(st, d), lo = dayLowTemp(st, d);
    if (cold == null && t < 0 && t >= -8) cold = d;
    if (bitter == null && t < -8) bitter = d;
    if (warm == null && t > 2 && lo >= HEAT.chillAt && d > 3) warm = d;
    if (chill == null && t > 2 && lo < HEAT.chillAt && d > 3) chill = d;
  }
  const n = residents(st, h.id).length;
  st.hour = warm * 24 + 1;
  check(heatRate(st) === 0 && heatUse(st, h).total === 0, "a warm day and night: no heating");
  // fire-nights: a cool night (under HEAT.chillAt) above freezing burns the night's share of a freezing day's heating.
  st.hour = chill * 24 + 1;
  check(near(heatRate(st), HEAT.fuel * HEAT.night) && near(heatUse(st, h).total, n * HEAT.fuel * HEAT.night) && heatUse(st, h).night, `a cool night (low ${dayLowTemp(st, chill)}°C): the night's fire, ${HEAT.night} of a freezing day's (${heatUse(st, h).total} fuel's worth for ${n})`);
  st.hour = cold * 24 + 1;
  const u = heatUse(st, h);
  check(near(u.each, HEAT.fuel) && near(u.total, n * HEAT.fuel), `below 0°C: ${u.text}`);
  check(upkeepLine(st, h).heating === `Heating: ${n} people × 0.1 = ${r1(n * 0.1).toFixed(1)} → ${Math.round(n * 0.1 / HEAT.wood)} wood a day (or ${r1(n * 0.1).toFixed(1)} fuel)`, `the base panel: "${upkeepLine(st, h).heating}"`);
  // woodcutting.js: wood burns first (1 wood = HEAT.wood fuel of heat); the fuel figures below are without any.
  h.stock.wood = 300; h.stock.fuel = 10; // more than a day's wood (0.1 kg a unit)
  heatDaily(st, h);
  check(near(h.stock.wood, 300 - n * HEAT.fuel / HEAT.wood) && h.stock.fuel === 10 && !h.cold, `wood first: ${r1(n * HEAT.fuel / HEAT.wood)} wood, no fuel`);
  h.stock.wood = 0;
  heatDaily(st, h);
  check(near(h.stock.fuel, 10 - n * HEAT.fuel) && !h.cold, `a day's heating burns ${r1(n * HEAT.fuel)} fuel`);
  if (bitter != null) {
    st.hour = bitter * 24 + 1;
    check(near(heatUse(st, h).each, HEAT.fuel * HEAT.bitter), `below −8°C ×${HEAT.bitter}: ${heatUse(st, h).text}`);
    st.hour = cold * 24 + 1;
  } else console.log("  (no day below −8°C in two years of this seed's weather)");
  // Twice the people, twice the fuel.
  for (let i = 0; i < n; i++) { const x = plain(makeSurvivor(st, 1)); x.location = { kind: "base", baseId: h.id }; x.role = "rest"; st.survivors.push(x); }
  check(near(heatUse(st, h).total, 2 * n * HEAT.fuel), "bigger groups burn more");
  // No fuel: everyone is cold.
  h.stock.fuel = 0;
  const ppl = residents(st, h.id);
  const hp0 = ppl.map((x) => x.health), m0 = ppl.map((x) => x.mood);
  heatDaily(st, h);
  check(h.cold === 1 && ppl.every((x, i) => near(x.health, hp0[i] - COLD.hp) && near(x.mood, m0[i] - COLD.mood)), `no fuel: cold (health −${COLD.hp}, mood −${COLD.mood} each)`);
  // Half the fuel: half as cold.
  h.stock.fuel = heatUse(st, h).total / 2;
  heatDaily(st, h);
  check(near(h.cold, 0.5, 0.02) && h.stock.fuel === 0, `half the fuel: ${Math.round(h.cold * 100)}% short`);
  // A shelter's lit camp fire keeps it warm without fuel.
  h.tier = 0; h.fire = true;
  check(heatUse(st, h).total === 0 && heatUse(st, h).fire, `a shelter with its fire lit: ${heatUse(st, h).text}`);
  h.fire = false;
  check(heatUse(st, h).total > 0, "with the fire out it needs fuel");
  delete h.tier; delete h.fire;
  // A team at a lit camp fire stays out of the cold's appetite.
  const tm = team(st, 2, { food: 10, water: 10 });
  if (foodNeedFactor(st) > 1) {
    check(teamCold(st, tm.p) === foodNeedFactor(st), `a team in the cold eats more (×${teamCold(st, tm.p)})`);
    tm.p.phase = "task"; tm.p.task = { type: "camp" }; tm.p.fire = true;
    check(teamCold(st, tm.p) === 1, "camped at a lit fire: no extra");
  } else console.log("  (the cold day is not below 0°C mean for the appetite: skipped)");
}

// ---------- 8. save and load ----------
{
  console.log("Save and load");
  const st = W();
  quietHub(st);
  for (let i = 0; i < 30; i++) tickHour(st);
  st.cards.length = 0; // a card's choices cannot be saved (a stranger at the gate on some rolls)
  const s = atBase(st, hub(st).id)[0];
  s.hunger = 33.5; s.thirst = 44.25;
  const st2 = loadFromString(saveToString(st));
  const s2 = st2.survivors.find((x) => x.id === s.id);
  check(s2.hunger === 33.5 && s2.thirst === 44.25, "gauges are saved");
  const raw = JSON.parse(saveToString(st));
  const strip = (o) => { if (o && typeof o === "object") { if ("hunger" in o && "thirst" in o && "skills" in o) { delete o.hunger; delete o.thirst; } for (const v of Object.values(o)) strip(v); } };
  strip(raw.state);
  const st3 = loadFromString(JSON.stringify(raw));
  check(st3.survivors.every((x) => x.hunger === 100 && x.thirst === 100), "an old save (no gauges) starts everyone full");
}

// ---------- 9. starving day after day: the mood hit grows each morning, resets when they eat ----------
{
  console.log("Starving and parched day after day");
  const st = W();
  quietHub(st);
  const s = team(st, 1, { food: 0, water: 10 }).crew[0]; // away from a base the gauge decides
  s.mood = 90; s.hunger = 5;
  const hits = [];
  for (let d = 1; d <= 5; d++) { const m0 = s.mood; s.hunger = 5; starvingDaily(st); hits.push(r1(m0 - s.mood)); }
  check(hits.join(",") === [1, 2, 3, 4, 5].map((d) => STARVE.food.step * d).join(","), `the hit grows each morning starving: ${hits.join(", ")}`);
  check(s.starveDays === 5, `five mornings counted (${s.starveDays})`);
  check((s.moodNotes || []).some((n) => /Starving \(day 5\)/.test(n.label)), "it shows in the mood notes");
  check(st.log.some((l) => /has been starving for 3 days/.test(l.text)), "one log line on day 3");
  s.mood = 60; s.starveDays = 40; s.hunger = 5;
  starvingDaily(st);
  check(r1(60 - s.mood) === STARVE.food.max, `capped at −${STARVE.food.max} (${r1(60 - s.mood)})`);
  s.hunger = 30; s.mood = 60;
  starvingDaily(st);
  check(s.starveDays == null && s.mood === 60, "a morning fed again resets it, no mood lost");
  s.hunger = 100; s.thirst = 5; s.mood = 60;
  starvingDaily(st); s.thirst = 5; starvingDaily(st);
  check(s.parchDays === 2 && r1(60 - s.mood) === STARVE.water.step * 3, `parched: −${STARVE.water.step}, then −${STARVE.water.step * 2} (${r1(60 - s.mood)} in all)`);
  check(starveMood(0) === 0 && starveMood(2, "water") === STARVE.water.step * 2, "starveMood");
  const mf = moodFactors(st, s).list.find((f) => /^Parched: day 2/.test(f.label));
  check(mf && mf.v === -STARVE.water.step * 2 && !mf.own, "the mood breakdown lists it (applied in needs.js)");
  // A captive is not counted.
  const c = atBase(st, hub(st).id).find((x) => x !== s && !x.leader);
  c.hunger = 0; c.mood = 50; const loc = c.location; c.location = { kind: "captive", factionId: 1 };
  starvingDaily(st);
  check(c.mood === 50 && !c.starveDays, "captives are not counted");
  c.location = loc;
  // A base out of food: everyone living there counts as starving from the first day, whatever the gauge, and that
  // is the base's whole mood penalty for it (the flat −10 a day is gone); out of water the same as parched.
  {
    const sb = W();
    const hb = quietHub(sb);
    sb.hour = mildDay(sb) * 24;
    clearFood(hb); hb.stock.water = 500;
    const ppl = residents(sb, hb.id);
    for (const x of ppl) { x.mood = 70; x.hunger = 100; x.role = "farm"; }
    const one = ppl.find((x) => !x.leader);
    const moods = [];
    for (const x of ppl) if (x.ration) clearFood(x.ration); // nothing in their packs (eating.js)
    // eating.js: they eat by the hour; the day's missed meals make the base's hunger day at midnight.
    for (let d = 0; d < 3; d++) { const m0 = one.mood; for (let k = 0; k < 24; k++) { sb.hour++; needsHour(sb); } basesDaily(sb); moods.push([one.starveDays, r1(m0 - one.mood)]); }
    check(hb.hungerDays >= 1 && moods[0][0] === 1, `starving from the base's first day out of food (day ${moods[0][0]}, hunger ${Math.round(one.hunger)})`);
    check(moods.map((m) => m[0]).join(",") === "1,2,3", `counted each morning: ${moods.map((m) => m[0]).join(", ")}`);
    const f = moodFactors(sb, one).list;
    check(f.some((x) => /^Starving: day 3 \(.* is out of food/.test(x.label) && x.v === -starveMood(3)) && !f.some((x) => /^Out of food/.test(x.label)), "the breakdown names the base, and the flat 'Out of food' line is gone");
    setFood(hb, 500);
    for (let k = 0; k < 24; k++) { sb.hour++; needsHour(sb); }
    basesDaily(sb);
    check(!one.starveDays || hungerOf(one) < NEEDS.starving, "fed again: the count ends");
  }
  // Saved.
  const s2 = loadFromString(saveToString((st.cards.length = 0, st))).survivors.find((x) => x.id === s.id);
  check(s2.parchDays === s.parchDays && s.parchDays > 0, "the count is saved");

  // A team with water but no food, left alone: hunger runs out and the hit grows until rock bottom while they live.
  const st2 = W();
  quietHub(st2);
  st2.hour = mildDay(st2) * 24;
  const { p, crew } = team(st2, 2, { food: 0, water: 40 });
  for (const m of crew) { m.mood = 60; m.hunger = 60; }
  const who = crew[0];
  let lowAt = null, perDay = [];
  for (let h = 1; h <= 24 * 14 && who.alive; h++) {
    st2.hour++;
    teamNeedsHour(st2, p, crew);
    if (st2.hour % 24 === 0) { const m0 = who.mood; starvingDaily(st2); if (who.mood > 0) perDay.push(r1(m0 - who.mood)); } // at 0 mood the floor cuts it
    if (lowAt == null && who.mood < SNAP.at) lowAt = Math.ceil(h / 24);
  }
  const steps = perDay.filter((v) => v > 0);
  check(steps.length >= 3 && steps.every((v, i) => i === 0 || v > steps[i - 1] || v === STARVE.food.max), `on the road the morning hit grows: ${steps.join(", ")}`);
  check(lowAt != null && lowAt <= 9, `rock bottom (mood under ${SNAP.at}, where breaks start) by day ${lowAt} from mood 60, still alive then`);
  // The status icons: starving with its day and mood.
  const st3 = W();
  const q = atBase(st3, hub(st3).id)[0];
  plain(q); q.hunger = 4; q.starveDays = 3; hub(st3).hungerDays = 3; // at a base the stores decide
  const icon = statusesOf(st3, q).find((x) => x.key === "hunger");
  check(icon && icon.tone === "danger" && icon.tip.includes(`Starving: day 3, mood −${starveMood(3)} a day`), `the starving icon says the day and the mood (${icon && icon.tip})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
