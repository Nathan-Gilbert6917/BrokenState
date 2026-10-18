// Batch 1 of the inventory backlog (INV-01, 03, 04, 06, 07): a team home from a trip (sim/parties.js returnHome,
// sim/teaminv.js noteUnpack / pendingUnpack / unpackHome, ui/teaminv.js unpackModal): its supplies and finds into the
// stores exactly once (food by type and the Needs row, water, scrap), what its people carry on them listed for the
// Home from a trip window and put away into the armory (boxes of rounds into the stores, counted once), the log
// naming what reached the stores or that nothing was found, and a fishing trip's catch; the job tools carried out of
// the armory (sim/jobtrips.js checkOutTool / returnTools: Fish needs one, one tool one fisher, back home after);
// the Needs food row (ui/needsbar.js: rations and days, 1d under a day); the Sleep bar (ui/needs.js).
// Usage: node tools/homeinvtest.js [seed]
import { food, setFood, addDays } from "./foodkit.js";
import { fvIn } from "../src/sim/foods.js"; // the Needs food row counts food value (a meal 1.00)
import { createWorld, hub, atBase, tickHour, hourOfDay } from "../src/sim/world.js";
import { launchExpedition, planPath, startReturn, stockGain, storedText } from "../src/sim/parties.js";
import { stripAll, newItem, stow, ensurePack, allCarried } from "../src/sim/inventory.js";
import { pendingUnpack, unpackHome, unpackSpots, noteUnpack } from "../src/sim/teaminv.js";
import { unpackModal, unpackUp, UNPACK_ACTIONS } from "../src/ui/teaminv.js";
import { baseNeeds } from "../src/ui/needsbar.js";
import { gaugeRows, gaugeMini, sleepGauge } from "../src/ui/needs.js";
import { foodOutlook } from "../src/sim/economy.js";
import { checkOutTool, returnTools } from "../src/sim/jobtrips.js";
import * as H from "../src/sim/hunting.js";
import { TIRED } from "../src/sim/sleep.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

const SEED = Number(process.argv[2] || 42);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ data: new Uint8ClampedArray(4) })), set: (t, k, v) => ((t[k] = v), true) });
globalThis.document = globalThis.document || { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, toDataURL: () => "" }) };
const text = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 5 });
  state.started = true; state.noWanderers = true; state.visitorsOff = true;
  Object.assign(hub(state).stock, { water: 100, scrap: 10 }); setFood(hub(state), 50);
  return state;
}
// A team of two from the hub, stood back on the hub's tile, about to come home.
function team(state, mission = "scavenge", gear = () => {}) {
  const h = hub(state);
  const crew = atBase(state, h.id).slice(0, 2);
  for (const s of crew) { s.traits = []; stripAll(s); }
  gear(crew);
  let dest = null;
  for (const t of state.tiles) { const d = state.grid.distance(h.tile, t.id); if (d >= 2 && d <= 3 && t.terrain !== "water" && planPath(state, h.tile, t.id, false)) { dest = t.id; break; } }
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest, mission, stance: "normal", supplies: { water: 4 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  p.path = [h.tile]; p.idx = 0; p.progress = 0; p.phase = "waiting"; p.orders = [];
  return { p, crew, h };
}
const withPack = (s) => { s.gear.backpack = newItem("backpack"); ensurePack(s.gear.backpack); };

// ---------------------------------------------------------------------------------------------------------
section("INV-01 / INV-07: supplies home exactly once, the log says what reached the stores");
{
  const state = mk();
  const { p, h } = team(state);
  addDays(p.cargo, 6, "f_beans"); p.cargo.supplies.water = 3; p.cargo.supplies.scrap = 5; p.supplies.scrap = 2;
  const teamFood = food(p) + food(p.cargo), teamWater = (p.supplies.water || 0) + 3;
  const f0 = food(h), w0 = h.stock.water, s0 = h.stock.scrap;
  const row0 = baseNeeds(state, h).find((r) => r.k === "food").amt;
  startReturn(state, p);
  check(!state.parties.includes(p), "the team is home and gone from the map");
  check(near(food(h) - f0, teamFood, 1e-6), `food: +${food(h) - f0} days, what the team had (${teamFood})`);
  check(near(h.stock.water - w0, teamWater), `water: +${h.stock.water - w0} (packed and found: ${teamWater})`);
  check(h.stock.scrap - s0 === 7, `scrap: +${h.stock.scrap - s0} (5 found, 2 packed)`);
  startReturn(state, p);
  check(near(food(h) - f0, teamFood, 1e-6) && h.stock.scrap - s0 === 7, "a second call on the gone team adds nothing (no double count)");
  check(baseNeeds(state, h).find((r) => r.k === "food").amt === Math.floor(fvIn(h.stock) + 1e-9) && baseNeeds(state, h).find((r) => r.k === "food").amt > row0, "the Needs food row counts it");
  const line = state.log[0].text;
  check(/is home with 30 cans of beans, 3 water, 5 scrap/.test(line) && /stores: 6 days of food \(30 cans of beans\), \d+ water, 7 scrap/.test(line), `the log names the finds and what reached the stores ("${line}")`);
}
{
  const state = mk();
  const { p } = team(state);
  p.supplies = {}; p.hold = null;
  startReturn(state, p);
  check(/: found nothing\./.test(state.log[0].text) && !/stores:/.test(state.log[0].text), `a search with nothing: "${state.log[0].text}"`);
}
{
  const g = stockGain({ water: 1, f_beans: 5 }, { water: 4, f_beans: 10, scrap: 2, junk: 9 });
  check(g.water === 3 && g.f_beans === 5 && g.scrap === 2 && !("junk" in g), "stockGain: the supplies and food that went up");
  check(storedText({}) === "" && /^1 days of food \(5 cans of beans\), 3 water$/.test(storedText({ f_beans: 5, water: 3 })), `storedText (${storedText({ f_beans: 5, water: 3 })})`);
}

section("INV-07: a fishing team's catch against what reached the stores");
{
  const state = mk();
  const { p, h } = team(state, "move");
  p.caught = { fish: 2.5, fished: 1 };
  addDays(p.cargo, 2, H.gameItem ? H.gameItem(state, "fish") : "f_rawfish");
  startReturn(state, p);
  check(/Caught 2\.5 days of food in fish, 2 brought into the stores\./.test(state.log[0].text), `"${state.log[0].text}"`);
  const st2 = mk();
  const t2 = team(st2, "move");
  t2.p.caught = { fish: 0, fished: 2 };
  startReturn(st2, t2.p);
  check(/Caught no fish\./.test(st2.log[0].text), `nothing caught: "${st2.log[0].text}"`);
}

section("INV-01: what they carry on them, put away in the armory (Home from a trip)");
{
  const state = mk();
  let box;
  const { p, crew, h } = team(state, "scavenge", (c) => {
    withPack(c[0]);
    box = newItem("a_9mm_fmj"); box.dur = 30;
    stow(c[0], box); stow(c[0], newItem("fishrod")); stow(c[0], newItem("lighters"));
  });
  startReturn(state, p);
  const u = pendingUnpack(state);
  check(u && u.baseId === h.id && u.sids.length === 1 && u.sids[0] === crew[0].id, "one pending unpack: the one who carries things");
  check(/water/.test(u.stored), `it says what already went into the stores (${u.stored})`);
  const spots = unpackSpots(crew[0]);
  const def = Object.fromEntries(spots.map((x) => [x.item.key, x.def]));
  check(def.a_9mm_fmj === true && def.fishrod === true && def.lighters === false, `ticked to start: rounds and the pack, not a pocket's lighter (${JSON.stringify(def)})`);
  check(!unpackSpots(crew[1]).length, "the other carries nothing to sort");
  const ui = { started: true };
  check(unpackUp(state, ui), "the window is up");
  const html = unpackModal(state, ui);
  check(/Home from a trip/.test(html) && /Fishing rod/.test(html) && /9mm FMJ/.test(html) && /Put away 2 things/.test(html), `the window lists them (${text(html).slice(0, 160)}…)`);
  UNPACK_ACTIONS["up-tick"](state, ui, { loc: spots.find((x) => x.item.key === "lighters").loc });
  check(/Put away 3 things/.test(unpackModal(state, ui)), "ticking the lighter counts it");
  const r0 = h.stock.a_9mm_fmj || 0, a0 = h.armory.length;
  const saved = loadFromString(saveToString(state));
  check(pendingUnpack(saved) && pendingUnpack(saved).sids[0] === crew[0].id, "a save keeps the pending unpack");
  UNPACK_ACTIONS["up-store"](state, ui);
  check((h.stock.a_9mm_fmj || 0) - r0 === 30, `the box: +${(h.stock.a_9mm_fmj || 0) - r0} rounds in the stores (30)`);
  check(h.armory.length - a0 === 2 && h.armory.some((it) => it.key === "fishrod") && h.armory.some((it) => it.key === "lighters"), "the rod and the lighter in the armory");
  check(!allCarried(crew[0]).some((it) => ["a_9mm_fmj", "fishrod", "lighters"].includes(it.key)) && !h.armory.includes(box), "off the person, the box not in the armory too (no double count)");
  check(!pendingUnpack(state) && !unpackUp(state, ui) && !state.unpack, "done: no window");
  check(/Put away in .*9mm FMJ, Fishing rod, Bag of|Put away in .*30 rounds into the stores/.test(state.log[0].text), `logged ("${state.log[0].text}")`);
}
{
  const state = mk();
  const { p, crew } = team(state, "scavenge", (c) => { withPack(c[0]); stow(c[0], newItem("fishrod")); });
  startReturn(state, p);
  UNPACK_ACTIONS["up-keep"](state, {});
  check(!pendingUnpack(state) && allCarried(crew[0]).some((it) => it.key === "fishrod"), "Keep everything: nothing moves, the window closes");
  const st2 = mk();
  const t2 = team(st2, "scavenge");
  startReturn(st2, t2.p);
  check(!pendingUnpack(st2), "nobody carries anything: no window");
  const st3 = mk();
  st3.autopilot = true;
  const t3 = team(st3, "scavenge", (c) => { withPack(c[0]); stow(c[0], newItem("fishrod")); });
  startReturn(st3, t3.p);
  check(!pendingUnpack(st3), "the autopilot never gets one");
  const st4 = mk();
  const t4 = team(st4, "scavenge", (c) => { withPack(c[0]); stow(c[0], newItem("fishrod")); });
  startReturn(st4, t4.p);
  t4.crew[0].location = { kind: "party", partyId: 999 };
  check(!pendingUnpack(st4) && !st4.unpack, "out of date (they left again): dropped");
  const st5 = mk();
  check(noteUnpack(st5, null, [], "x") === null && unpackHome(st5, hub(st5).id, ["s:1:pack:0"]).moved.length === 0, "nothing pending: nothing moves");
}

section("INV-03: the Fish job's rod goes out with the fisher, one rod one fisher");
{
  let state = null, base = null;
  for (let seed = SEED; seed < SEED + 80 && !state; seed++) { const st = mk(seed); if (H.fishWater(st, hub(st))) { state = st; base = hub(st); } }
  check(!!state, "a hub by the water");
  for (const it of [...base.armory]) if (H.isFishTool(it)) base.armory.splice(base.armory.indexOf(it), 1);
  const ppl = atBase(state, base.id);
  for (const s of ppl) for (const it of allCarried(s)) if (H.isFishTool(it)) stripAll(s);
  const rod = newItem("fishrod");
  base.armory.push(rod);
  const [a, b] = ppl;
  for (const s of [a, b]) { s.role = "fish"; s.station = null; s.pinned = true; s.health = 100; s.inBed = false; s.conditions = []; s.mood = 70; }
  check(checkOutTool(state, base, a, "fish") && allCarried(a).includes(rod) && !base.armory.includes(rod) && rod.jobTool === "fish", "checked out: the rod leaves the armory for the fisher");
  check(!checkOutTool(state, base, b, "fish"), "a second fisher: no rod left, no trip");
  check(H.fishTrip(state, base, b, H.fishWater(state, base).shore, 3, state.hour).noTool, "and catches nothing without one");
  check(checkOutTool(state, base, a, "fish") && base.armory.length === base.armory.filter((x) => x !== rod).length, "the one who has it keeps it (no second rod taken)");
  check(returnTools(state, base, a) === 1 && base.armory.includes(rod) && !allCarried(a).includes(rod) && !rod.jobTool, "home with no trip: back in the armory");
  // A day of the job: out at dawn with the rod, home after, the rod back on the shelf.
  let outWith = false, outSeen = false, bOut = false;
  for (let i = 0; i < 30; i++) {
    tickHour(state);
    if (a.trip && a.trip.job === "fish") { outSeen = true; if (allCarried(a).includes(rod) || allCarried(b).includes(rod)) outWith = true; }
    if (a.trip && b.trip) bOut = true;
  }
  check(outSeen && outWith, "on a fishing trip the rod is carried, not in the armory");
  check(!bOut, "never two fishers out on one rod");
  for (let i = 0; i < 48 && (a.trip || b.trip); i++) tickHour(state);
  tickHour(state);
  check(base.armory.includes(rod) && !allCarried(a).includes(rod) && !allCarried(b).includes(rod), "after the trips it is back in the armory");
}

section("INV-04: the Needs food row");
{
  const state = mk();
  const h = hub(state);
  const heads = foodOutlook(state, h).heads;
  const row = () => baseNeeds(state, h).find((r) => r.k === "food");
  check(row().name === "Food (FV)" && row().amt === Math.floor(fvIn(h.stock) + 1e-9), `the amount is food value (a meal 1.00), not days (${row().name} ${row().amt})`);
  setFood(h, 2 * heads);
  const o = foodOutlook(state, h);
  check(row().note === `${Math.floor(o.daysLeft + 1e-9)}d` && o.eat === heads, `${2 * heads} rations for ${heads} eating 1 a day: ${row().note} (${Math.round(o.daysLeft * 100) / 100} days)`);
  setFood(h, heads * 0.5);
  check(row().note === "1d", `under a day's food: 1d, not "<1d" (${row().note})`);
  setFood(h, 0);
  check(row().note === "0d", `none: 0d (${row().note})`);
  check(/rations \(one ration is a person's food for a day\)/.test(row().tip), "the tooltip explains the units");
}

section("INV-06: the Sleep bar follows the sleep owed, hour by hour");
{
  const s = { hunger: 80, thirst: 80, mood: 50, tired: 0, traits: [] };
  check(sleepGauge(s) === 100 && sleepGauge({ tired: TIRED.EXHAUSTED }) === 0 && near(sleepGauge({ tired: TIRED.EXHAUSTED / 2 }), 50), "full when rested, empty at Exhausted");
  check(/Sleep/.test(text(gaugeRows(s))) && /0h/.test(text(gaugeRows(s))), "a Sleep row on the gauges (People tab, survivor screen, team panel)");
  s.tired = 30;
  check(/30h/.test(text(gaugeRows(s))) && /Tired \(owes 30 h of sleep\)/.test(gaugeMini(s)), "it reads the hours owed, the roster's mini bars too");
  const state = mk();
  const h = hub(state);
  const p0 = atBase(state, h.id)[0];
  p0.tired = 0;
  while (hourOfDay(state) !== 8) tickHour(state);
  const g0 = sleepGauge(p0);
  for (let i = 0; i < 6; i++) tickHour(state);
  check(sleepGauge(p0) < g0, `awake, the bar falls (${Math.round(g0)} → ${Math.round(sleepGauge(p0))})`);
  while (hourOfDay(state) !== 7) tickHour(state);
  check(sleepGauge(p0) > 90, `after the night it is full again (${Math.round(sleepGauge(p0))})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
