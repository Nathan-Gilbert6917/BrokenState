// The walk-in freezer, the vacuum sealer and machine parts (freezer-parts 2026-10-10; buildings.js freezer / sealer,
// power.js base.freezerOn / hasSealer, breakdowns.js machines and spares, crafting.js parts recipes, groupworks.js
// the groups' machines): build gates (Mechanics 3, parts, electronics, a building plot); power on and off sets
// base.freezerOn and says why in the log; a broken freezer is off and a proper repair takes parts; the spares upkeep
// (a part every 12 days it runs, wear faster with none); storage room on and off; the sealer hook; the crafting
// recipes with a mechanism take parts and the pressure canner adds to the preserving kitchen; an AI group builds a
// still, a generator and a freezer, runs it on fuel, breaks it and repairs it with parts; and a 120-day governor run
// with nothing NaN or negative.
// Usage: node tools/freezertest.js [days for the governor run] [seeds...]
import { createWorld, tickHour, hub, atBase, day } from "../src/sim/world.js";
import { addBuilding, canBuild, queueBuild, constructionHour, BUILDINGS, recipeOutput, CANNER, count, countAll, demolishRefund } from "../src/sim/buildings.js";
import { POWER, POWER_USERS, refreshPower, isPowered, hasSealer, freezerLine, powerStatus } from "../src/sim/power.js";
import { FIXTURES, WEAR, breakFixture, repairPlan, startRepair, breakdownsHour, useSpares, dailyWear, machineRan, isMachine, machineText, fixtures } from "../src/sim/breakdowns.js";
import { storeSpaces, foodStore, STORE } from "../src/sim/storage.js";
import { CRAFTS, queueCraft, canCraft, craftQueue, makeItem } from "../src/sim/crafting.js";
import { GROUP_WORKS, groupWorksDaily, nextWork, worksAt, groupFreezerOn, groupSealer, groupMachineCount, worksText } from "../src/sim/groupworks.js";
import { groupPartsTarget } from "../src/sim/trade.js";
import { setAutopilot, autopilotResolve } from "../src/sim/autopilot.js";

const govDays = Number(process.argv[2] || 120);
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [11];
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const W = (seed = 42) => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; return st; };
function quietHub(st) {
  const h = hub(st);
  for (const s of atBase(st, h.id)) { s.traits = []; s.conditions = []; s.role = "rest"; s.station = null; s.health = 100; s.mood = 80; s.skills.mechanics = 0; }
  Object.assign(h.stock, { food: 500, water: 200, scrap: 300, parts: 30, electronics: 6, fuel: 40, meds: 20, jars: 40, preserved: 0 });
  delete h.tier; delete h.camp; // a full base (building plots)
  return h;
}
const lastLog = (st, re) => st.log.slice(-12).some((e) => re.test(e.text));

// ---------- 1. build gates ----------
{
  console.log("Build gates");
  const st = W();
  const h = quietHub(st);
  const d = BUILDINGS.freezer;
  check(d.plot === "building" && d.cost.parts >= 4 && d.cost.electronics >= 1 && d.req.mechanics === 3, `a building plot, parts and electronics, Mechanics 3 (${JSON.stringify(d.cost)})`);
  check(d.cost.parts > BUILDINGS.generator.cost.parts - 1 && d.cost.parts < BUILDINGS.radio.cost.parts, "priced between the generator and the radio station in parts");
  let chk = canBuild(st, h, "freezer");
  check(!chk.ok && /Mechanics 3/.test(chk.reason), `no Mechanics 3 here: refused (${chk.reason})`);
  atBase(st, h.id)[0].skills.mechanics = 3;
  h.stock.electronics = 1;
  chk = canBuild(st, h, "freezer");
  check(!chk.ok && /electronics/.test(chk.reason), `short of electronics: refused (${chk.reason})`);
  h.stock.electronics = 6; h.stock.parts = 2;
  chk = canBuild(st, h, "freezer");
  check(!chk.ok && /parts/.test(chk.reason), `short of parts: refused (${chk.reason})`);
  h.stock.parts = 30;
  chk = canBuild(st, h, "freezer");
  check(chk.ok, `with all of it: ok (${chk.reason || ""})`);
  const p0 = h.stock.parts, e0 = h.stock.electronics;
  queueBuild(st, h, "freezer");
  check(h.stock.parts === p0 - d.cost.parts && h.stock.electronics === e0 - d.cost.electronics, "queuing pays the parts and electronics");
  for (const s of atBase(st, h.id)) s.role = "build";
  for (let i = 0; i < 200 && !countAll(h, "freezer"); i++) constructionHour(st);
  check(countAll(h, "freezer") === 1 && count(h, "freezer") === 1, "the builders finish it (count(base, \"freezer\") works)");
  const back = demolishRefund({ type: "freezer" });
  check(back.electronics === 1 && back.parts === Math.floor(d.cost.parts / 2), `demolishing gives half the parts and electronics back (${JSON.stringify(back)})`);
  check(canBuild(st, h, "sealer").ok && BUILDINGS.sealer.plot === "utility" && BUILDINGS.sealer.cost.electronics > 0, "the vacuum sealer: a utility plot, parts and electronics, Mechanics 3");
  // A camp cannot.
  const st2 = W(5);
  const h2 = hub(st2);
  check(!canBuild(st2, h2, "freezer").ok, "not at a camp or shelter");
}

// ---------- 2. power on and off: base.freezerOn ----------
{
  console.log("Power on and off");
  const st = W();
  const h = quietHub(st);
  const fz = addBuilding(h, "freezer");
  refreshPower(st, h);
  check(h.freezerOn === false && !isPowered(h, fz), "no generator: off");
  check(lastLog(st, /freezer at .* is off: there is no generator/), "the log says why (no generator)");
  check(/no generator/.test(freezerLine(st, h)), `the buildings line says why (${freezerLine(st, h)})`);
  const room = storeSpaces(h).filter((s) => /freezer/.test(s.key));
  check(room.length === 1 && room[0].kind === "dry" && room[0].cap === STORE.freezer, "off: its 300 room keeps like a pantry");
  const gen = addBuilding(h, "generator");
  refreshPower(st, h);
  check(h.freezerOn === false && /no one operates/.test(freezerLine(st, h)), `a generator nobody runs: off (${freezerLine(st, h)})`);
  const [a] = atBase(st, h.id);
  a.role = "operate"; a.station = gen.id;
  const fuel0 = h.stock.fuel;
  refreshPower(st, h);
  check(h.freezerOn === true && h.freezersOn === 1 && isPowered(h, fz), "an operator and fuel: on");
  check(lastLog(st, /freezer at .* is cold again/), "the log says it is cold again");
  check(h.stock.fuel === fuel0 - POWER.genFuel, `the generator burns its ${POWER.genFuel} fuel for the day`);
  check(powerStatus(st, h).demand === POWER_USERS.freezer.need, `the freezer draws ${POWER_USERS.freezer.need} power`);
  const on = storeSpaces(h).find((s) => s.key === "freezer");
  check(on && on.kind === "walkin" && on.cap === STORE.freezer, "on: its room is the freezer's");
  h.stock.food = 250;
  const fs = foodStore(st, h);
  const sp = fs.spaces.find((s) => s.key === "freezer");
  check(fs.spaces[0].key === "freezer" && sp.held === 250, "the food goes into the freezer first (the slowest to spoil)");
  check(sp.rate < 0.001, `and keeps ~20× longer than in a cellar (${sp.rate})`);
  // The next day with no fuel: off.
  st.hour += 24;
  h.stock.fuel = 0;
  refreshPower(st, h);
  check(h.freezerOn === false && /fuel/.test(freezerLine(st, h)), `no fuel: off (${freezerLine(st, h)})`);
  check(lastLog(st, /thawing/), "the log: the food is thawing");
  h.stock.fuel = 40;
  refreshPower(st, h);
  check(h.freezerOn === true, "fuel back: on");
  // Switched off by hand.
  h.powerOff = { [fz.id]: true };
  refreshPower(st, h);
  check(h.freezerOn === false && /switched off/.test(freezerLine(st, h)), "switched off by hand: off");
  h.powerOff = {};
  refreshPower(st, h);
  // Not enough power: a second freezer, a machine shop and the rest on one generator.
  for (const t of ["freezer", "radio", "floodlights"]) addBuilding(h, t);
  refreshPower(st, h);
  check(h.freezersOn === 2 && h.freezerOn, `two freezers (4) and the rest (2) on one generator's 6 (${h.freezersOn} on)`);
  addBuilding(h, "coldstore");
  refreshPower(st, h);
  check(h.freezersOn === 2, "freezers come first in the power order");
  // The vacuum sealer hook.
  const se = addBuilding(h, "sealer");
  refreshPower(st, h);
  check(!hasSealer(st, h), "no power left for the sealer: hasSealer false");
  h.buildings = h.buildings.filter((x) => x.type !== "coldstore" && x.type !== "floodlights" && x.type !== "radio");
  refreshPower(st, h);
  check(hasSealer(st, h) && isPowered(h, se), "power for it: hasSealer true");
  breakFixture(st, h, se, "worn out", { card: false, quiet: true });
  refreshPower(st, h);
  check(!hasSealer(st, h), "broken: hasSealer false");
  // No freezer any more: the flag goes.
  h.buildings = h.buildings.filter((x) => x.type !== "freezer");
  refreshPower(st, h);
  check(h.freezerOn === undefined, "no freezer: no flag");
}

// ---------- 3. breakdowns and repair ----------
{
  console.log("Breakdowns and repairs");
  const st = W();
  const h = quietHub(st);
  const fz = addBuilding(h, "freezer");
  const gen = addBuilding(h, "generator");
  const [a, b] = atBase(st, h.id);
  a.role = "operate"; a.station = gen.id;
  refreshPower(st, h);
  check(h.freezerOn, "on to start with");
  breakFixture(st, h, fz, "worn out", { card: false });
  refreshPower(st, h);
  check(h.freezerOn === false && /broken/.test(freezerLine(st, h)), `broken: off (${freezerLine(st, h)})`);
  check(powerStatus(st, h).demand === 0, "a broken freezer draws nothing");
  check(storeSpaces(h).some((s) => s.key === "freezeroff" && s.cap === STORE.freezer), "a broken freezer keeps its room (as a pantry)");
  let plan = repairPlan(st, h, fz, "repair");
  check(!plan.ok && /Mechanics 3/.test(plan.why), `a proper repair needs Mechanics 3 (${plan.why})`);
  b.skills.mechanics = 5; b.role = "build";
  plan = repairPlan(st, h, fz, "repair");
  check(plan.ok && plan.cost.parts === FIXTURES.freezer.repair.cost.parts, `and machine parts (${JSON.stringify(plan.cost)})`);
  const p0 = h.stock.parts;
  startRepair(st, h, fz, "repair");
  check(h.stock.parts === p0 - FIXTURES.freezer.repair.cost.parts, "the repair takes the parts");
  st.hour = Math.ceil(st.hour / 24) * 24 + 8;
  for (let i = 0; i < 30 && fz.broken; i++) { breakdownsHour(st); st.hour++; }
  check(!fz.broken && fz.wear === WEAR.repairWear && fz.lastBroke != null, "repaired: wear back down, the last breakdown kept");
  refreshPower(st, h);
  check(h.freezerOn, "and on again");
  // Wear: only on days it has power.
  const wOn = dailyWear(st, h, fz, null);
  h.stock.fuel = 0; st.hour += 24; refreshPower(st, h);
  const wOff = dailyWear(st, h, fz, null);
  check(wOn >= FIXTURES.freezer.use * 0.6 && wOff < wOn / 5, `it wears while on (${wOn.toFixed(2)}), hardly while off (${wOff.toFixed(2)})`);
  // A broken generator: the freezer is off.
  h.stock.fuel = 40;
  breakFixture(st, h, gen, "worn out", { card: false, quiet: true });
  refreshPower(st, h);
  check(h.freezerOn === false && /generator is broken/.test(freezerLine(st, h)), `a broken generator: the freezer is off (${freezerLine(st, h)})`);
}

// ---------- 4. spares upkeep ----------
{
  console.log("Spares");
  const st = W();
  const h = quietHub(st);
  const fz = addBuilding(h, "freezer");
  const gen = addBuilding(h, "generator");
  const [a] = atBase(st, h.id);
  a.role = "operate"; a.station = gen.id;
  refreshPower(st, h);
  check(machineRan(st, h, fz), "a freezer with power counts as running");
  const p0 = h.stock.parts;
  for (let i = 0; i < FIXTURES.freezer.spares; i++) useSpares(st, h, fz);
  check(h.stock.parts === p0 - 1 && st.stats.partsUpkeep >= 1, `a spare part every ${FIXTURES.freezer.spares} days it runs (${p0 - h.stock.parts} used)`);
  h.stock.parts = 0;
  for (let i = 0; i < FIXTURES.freezer.spares; i++) useSpares(st, h, fz);
  check(fz.noSpares === true && lastLog(st, /needs a spare machine part/), "no part anywhere: it runs on worn bits (one log line)");
  const w = dailyWear(st, h, fz, null);
  h.stock.parts = 3;
  useSpares(st, h, fz);
  check(!fz.noSpares && h.stock.parts === 2 && dailyWear(st, h, fz, null) < w - 2, "a part in: paid, and the extra wear stops");
  h.stock.fuel = 0; st.hour += 24; refreshPower(st, h);
  const s0 = fz.spares;
  useSpares(st, h, fz);
  check(fz.spares === s0, "no spares used on a day it was off");
  // The machine table: every machine needs parts somewhere, the plain buildings never.
  for (const t of ["generator", "well", "still", "machine_shop", "ammo_bench", "reload_bench", "radio", "relay", "garage", "floodlights", "freezer", "sealer", "coldstore"]) check(isMachine(t), `${t} is a machine (${machineText(t)})`);
  for (const t of ["walls", "cellar", "bunkhouse", "smoker", "cistern", "boiler"]) check(!isMachine(t) && !(BUILDINGS[t].cost.parts), `${t} takes no parts`);
  check(FIXTURES.garage.age > 0 && !FIXTURES.garage.raidOnly && FIXTURES.floodlights.attack > 0, "the garage wears with age, floodlights in attacks");
}

// ---------- 5. crafting with parts ----------
{
  console.log("Crafting with parts");
  const st = W();
  const h = quietHub(st);
  addBuilding(h, "workbench");
  const [a] = atBase(st, h.id);
  a.skills.mechanics = 5; a.skills.crafting = 5; a.role = "craft";
  for (const k of ["fishrod", "beartrap", "canner"]) {
    const r = CRAFTS[k];
    check(r.in.parts >= 1, `${k} takes machine parts (${JSON.stringify(r.in)})`);
    const p0 = h.stock.parts;
    const ok = canCraft(st, h, k);
    check(ok.ok, `${k} can be made here (${ok.reason || ""})`);
    queueCraft(st, h, k);
    check(h.stock.parts === p0 - r.in.parts, `${k}: the parts are paid when it is queued`);
  }
  check(craftQueue(h).length === 3, "three jobs queued");
  h.stock.parts = 0;
  check(!canCraft(st, h, "canner").ok, "no parts: no canner");
  // The canner in the armory: the preserving kitchen jars one more a day.
  const base = recipeOutput(a, "preserve", h, st).preserved;
  h.armory.push(makeItem("canner", 0.9));
  check(recipeOutput(a, "preserve", h, st).preserved === base + CANNER.out, `a pressure canner in the armory: +${CANNER.out} preserved a day`);
  for (const k of ["crossbow", "pipegun", "flashlight", "spotlight", "suppressor", "bicycle", "repairkit", "pulleybow"]) check(CRAFTS[k].in.parts >= 1, `${k} (a mechanism) takes parts`);
}

// ---------- 6. an AI group's machines ----------
{
  console.log("AI groups");
  const st = W(9);
  const f = st.factions.find((x) => x.alive && !x.hcMilitary);
  const tile = f.bases[0];
  f.pop = 20;
  Object.assign(f.stock, { food: 600, fuel: 30, parts: 20, scrap: 100 });
  const w = worksAt(f, tile);
  Object.assign(w, { water: 3, farms: 3, beds: 3, walls: 6, bench: 1, store: 1, sickbay: 4, pens: 1 });
  f.jails = { [tile]: 3 };
  const built = [];
  for (let i = 0; i < 60 && !w.freezer; i++) {
    const nw = !f.job ? nextWork(st, f) : null;
    if (nw && !built.includes(nw.type)) built.push(nw.type);
    groupWorksDaily(st, f);
    f.stock.food = 600; // keep them fed (the test is the machines)
  }
  check(w.still && w.power && w.freezer, `they build a still, a generator and a freezer (${built.join(", ")})`);
  const fuel0 = f.stock.fuel;
  st.hour += 24;
  groupWorksDaily(st, f);
  check(groupFreezerOn(f), "their freezer runs");
  check(/walk-in freezer \(on\)/.test(worksText(st, f)), `the Groups tab says so (${worksText(st, f)})`);
  check(f.stock.fuel <= fuel0 + GROUP_WORKS.MACH.still.fuel - POWER.genFuel + 1e-9, `the generator burns fuel (${fuel0} → ${f.stock.fuel})`);
  f.stock.fuel = 0;
  f.stock.food = GROUP_WORKS.MACH.foodDays * f.pop - 1; // no surplus for the still either
  st.hour += 24;
  groupWorksDaily(st, f);
  check(!groupFreezerOn(f), "no fuel: their freezer is off");
  f.stock.fuel = 30; f.stock.food = 600;
  w.mach.freezer.broken = true;
  const p0 = f.stock.parts;
  st.hour += 24;
  groupWorksDaily(st, f);
  check(!w.mach.freezer.broken && f.stock.parts <= p0 - FIXTURES.freezer.repair.cost.parts, `broken: repaired the next day with parts (${p0} → ${f.stock.parts})`);
  // Wear to a breakdown.
  w.mach.freezer.wear = WEAR.breakAt - 0.1;
  st.hour += 24;
  groupWorksDaily(st, f);
  check(w.mach.freezer.broken || w.mach.freezer.wear < WEAR.breakAt, "worn out: it breaks");
  check(groupMachineCount(f) >= 3 && groupPartsTarget(f) >= groupMachineCount(f) + 4, `their machines raise the parts they buy (${groupPartsTarget(f)})`);
  // Spares.
  f.stock.parts = 10;
  w.mach.freezer.broken = false; w.mach.freezer.wear = 10; w.mach.freezer.spares = 0.99;
  st.hour += 24;
  groupWorksDaily(st, f);
  check(f.stock.parts <= 9, "a spare part for the running freezer");
  // The sealer comes next with the parts.
  f.stock.parts = 20;
  for (let i = 0; i < 20 && !w.sealer; i++) { st.hour += 24; groupWorksDaily(st, f); f.stock.food = 600; f.stock.fuel = 30; }
  st.hour += 24; groupWorksDaily(st, f);
  check(w.sealer && groupSealer(f), "and a vacuum sealer (the groupSealer hook)");
}

// ---------- 7. a governor run ----------
for (const seed of seeds) {
  console.log(`Governor run (seed ${seed}, ${govDays} days)`);
  const st = W(seed);
  setAutopilot(st, true, "balanced");
  let bad = null;
  try {
    while (day(st) <= govDays && !st.gameOver) {
      autopilotResolve(st);
      tickHour(st);
      if (st.hour % 24 === 0) for (const b of st.bases) for (const [k, v] of Object.entries(b.stock)) if (typeof v === "number" && (!Number.isFinite(v) || v < -1e-6) && !(k === "food" && b.type === "outpost")) bad = bad || `day ${day(st)} ${b.name} ${k}=${v}`;
    }
  } catch (e) { bad = `crash day ${day(st)}: ${e.stack.split("\n").slice(0, 3).join(" | ")}`; }
  check(!bad, `no NaN or negative stock, no crash (${bad || "ok"})`);
  check(st.factions.every((f) => !f.works || Object.values(f.works).every((w) => !w.mach || Object.values(w.mach).every((m) => Number.isFinite(m.wear)))), "the groups' machines' wear is finite");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
