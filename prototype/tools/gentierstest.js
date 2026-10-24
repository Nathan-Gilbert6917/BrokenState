// Generator tiers (gen-tiers 2026-10-10; power.js GEN_TIERS, buildings.js canUpgradeGenerator / queueGenUpgrade,
// breakdowns.js generator2 / generator3, blueprints.js the Industrial Power Manual, autopilot.js autoGenUpgrade,
// groupworks.js the groups' tiers): the tier table (more power, more fuel at any load, a little better per power at full
// load, a day and a half's tank); upgrade gates (broken, one at a time, materials, Mechanics 4 / 5, the manual for
// tier 3), the work done where it stands (no plot, it runs meanwhile, no demolishing), cancel and demolish refunds;
// the burn by the load (tier 1 flat), tanks and refuelling by tier, two generators (the cheapest that covers the load
// first, the sum), Heat; wear, spares and repairs by tier; old saves (tier 1, the groups' too); the governor's upgrade
// (power short, the hand and materials, never into a fuel deficit: the 28-day flows, the floor with the winter's heating,
// tier 3 behind the manual); the AI groups' tiers by the same rules (demand, Mechanics, the manual, the fuel rule,
// the burn and the wear by tier); and governor runs with nothing NaN or negative.
// Usage: node tools/gentierstest.js [days for the governor runs=60] [seeds...=1]
import { createWorld, tickHour, hub, atBase, day } from "../src/sim/world.js";
import { addBuilding, canBuild, queueBuild, constructionHour, BUILDINGS, canUpgradeGenerator, queueGenUpgrade, cancelBuild, demolishRefund, canDemolish, demolish, jobName, plotsUsed, countAll } from "../src/sim/buildings.js";
import { POWER, GEN_TIERS, genBurn, genTier, genTank, refreshPower, powerStatus, generatorHeat, generatorLine, genFuelFor, genUpgradeFuelOk, powerLine } from "../src/sim/power.js";
import { FIXTURES, fxDef, dailyWear, useSpares, repairPlan, fixtureName, machinesHelp, breakFixture, genFixture } from "../src/sim/breakdowns.js";
import { tech, BLUEPRINTS, LOCKED, upgradeLock, siteBlueprints } from "../src/sim/blueprints.js";
import { setAutopilot, autopilotResolve, autoGenUpgrade, genFuelFlows, heatFuelWant } from "../src/sim/autopilot.js";
import { ensureHistory } from "../src/sim/history.js";
import { GROUP_WORKS, groupTech, worksAt, nextWork, groupWorksDaily, groupGenTier, groupPowerNeed, groupPowerUpWhy, groupGenBurn, worksText, groupMachinesDaily, workLock } from "../src/sim/groupworks.js";
import { POWER_USERS } from "../src/sim/power.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { seasonOfDay } from "../src/sim/weather.js";
import { setFood, clearFood } from "./foodkit.js"; // food by type (sim/foods.js)
import { setMech } from "./groupkit.js"; // a group's mechanic is one of its people
import { siteCost } from "../src/sim/buildmats.js"; // what a cost takes from the stores (building materials made from scrap when short)

const govDays = Number(process.argv[2] || 60);
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [1];
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const W = (seed = 42) => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; return st; };
const at8 = (st) => { st.hour = Math.ceil(st.hour / 24) * 24 + 8; };
function quietHub(st) {
  const h = hub(st);
  for (const s of atBase(st, h.id)) { s.traits = []; s.conditions = []; s.role = "rest"; s.station = null; s.health = 100; s.mood = 80; s.skills.mechanics = 0; }
  Object.assign(h.stock, { water: 200, scrap: 300, parts: 40, electronics: 6, fuel: 200, meds: 20 }); setFood(h, 500); // days of ration bars (tools/foodkit.js)
  delete h.tier; delete h.camp;
  tech(st).known.push("refrig", "genschem");
  at8(st);
  return h;
}
const T = GEN_TIERS;

// ---------- 1. the tier table ----------
{
  console.log("The tiers");
  check(T.length === 4 && T[1].out === POWER.genOut && T[1].idle === POWER.genFuel && T[1].full === POWER.genFuel && T[1].tank === POWER.tank && T[1].heat === POWER.genHeat, "tier 1 is today's generator (6 power, a flat 2 fuel a day, tank 3, +4 Heat)");
  for (let t = 2; t < T.length; t++) {
    const a = T[t - 1], b = T[t];
    check(b.out > a.out && b.heat > a.heat && b.tank > a.tank, `tier ${t}: more power (${b.out}), more Heat (${b.heat}), a bigger tank (${b.tank})`);
    let more = true;
    for (let load = 0; load <= a.out; load += 0.5) if (!(genBurn(b, load) > genBurn(a, load))) more = false;
    check(more && b.full > a.full && b.idle >= a.idle, `tier ${t}: more fuel than tier ${t - 1} at any load it could carry (${b.idle}–${b.full} against ${a.idle}–${a.full})`);
    check(b.full / b.out < a.full / a.out, `tier ${t}: a little thriftier per power at full load (${(b.full / b.out).toFixed(3)} against ${(a.full / a.out).toFixed(3)})`);
    check(b.cost.parts > 0 && b.cost.scrap > 0 && b.hours > 0 && b.req.mechanics === t + 2, `tier ${t}: scrap, parts, work-hours and Mechanics ${t + 2} (${JSON.stringify(b.cost)}, ${b.hours} h)`);
  }
  check(T[3].cost.electronics > 0 && T[3].bp === "indpower" && !T[2].bp, "tier 3 takes electronics and the Industrial Power Manual; tier 2 no manual");
  for (let t = 1; t < T.length; t++) check(T[t].tank / T[t].full >= 1.4 && T[t].tank / T[t].full <= 1.6, `tier ${t}: the tank holds ${(T[t].tank / T[t].full).toFixed(2)} days at full burn`);
  check(near(genBurn(T[3], 2), 3.25) && near(genBurn(T[2], 2), 2.25 + 1.25 * 2 / 12) && genBurn(T[1], 2) === 2, `one freezer (2 power): ${genBurn(T[1], 2)} / ${genBurn(T[2], 2).toFixed(2)} / ${genBurn(T[3], 2)} fuel a day by tier`);
  check(near(genBurn(T[3], 24), 6) && near(genBurn(T[3], 99), 6) && near(genBurn(T[2], 0), 2.25), "full load and idle as listed; never above full");
  check(BLUEPRINTS.indpower && LOCKED.upgrades.generator3 === "indpower" && !LOCKED.buildings.generator3, "the manual locks the upgrade, not a building type");
  check(siteBlueprints("dam").includes("indpower") && siteBlueprints("crash_mil").includes("indpower") && !siteBlueprints("farm").includes("indpower"), "found at dams, factories, military crashes (not farms)");
  check(/Industrial diesel set/.test(machinesHelp()) && /Standby generator/.test(machinesHelp()), "the Help topic lists the tiers");
}

// ---------- 2. upgrade gates and the work ----------
{
  console.log("Upgrading where it stands");
  const st = W();
  const h = quietHub(st);
  const g = addBuilding(h, "generator");
  check(g.tier === 1 && genTier(g) === 1 && genTier({ type: "generator" }) === 1, "a new generator is tier 1 (a missing tier reads 1)");
  const p = atBase(st, h.id);
  let chk = canUpgradeGenerator(st, h, g.id);
  check(!chk.ok && /Mechanics 4/.test(chk.reason), `no Mechanics 4 here: refused (${chk.reason})`);
  p[0].skills.mechanics = 4;
  h.stock.parts = 2;
  chk = canUpgradeGenerator(st, h, g.id);
  check(!chk.ok && /parts/.test(chk.reason), `short of parts: refused (${chk.reason})`);
  h.stock.parts = 40;
  g.broken = { day: 1, cause: "test" };
  chk = canUpgradeGenerator(st, h, g.id);
  check(!chk.ok && /Repair it first/.test(chk.reason), `broken: refused (${chk.reason})`);
  g.broken = null;
  chk = canUpgradeGenerator(st, h, g.id);
  check(chk.ok && chk.tier === 2, "Mechanics 4, the materials: ok");
  const used = plotsUsed(h, "utility"), s0 = h.stock.scrap, p0 = h.stock.parts;
  const take = siteCost(h.stock, T[2].cost).take;
  const msg = queueGenUpgrade(st, h, g.id);
  check(/Standby generator queued/.test(msg) && h.stock.scrap === s0 - take.scrap && h.stock.parts === p0 - T[2].cost.parts, `queued and paid (${msg})`);
  check(plotsUsed(h, "utility") === used && canBuild(st, h, "generator").ok, "no new plot, and it does not count against the generators' max");
  check(!canUpgradeGenerator(st, h, g.id).ok && /already queued/.test(canUpgradeGenerator(st, h, g.id).reason), "one upgrade at a time");
  check(!canDemolish(st, h, g.id).ok, "not pulled down with an upgrade queued");
  check(/standby generator/.test(jobName(h.construction[0])), `the queue's line (${jobName(h.construction[0])})`);
  // Cancel: everything back while untouched.
  cancelBuild(st, h, h.construction[0].id);
  check(h.stock.scrap === s0 && h.stock.parts === p0 && !h.construction.length, "cancelled untouched: all back");
  queueGenUpgrade(st, h, g.id);
  // It runs meanwhile: a freezer on, the builders at it.
  addBuilding(h, "freezer");
  refreshPower(st, h);
  check(h.freezerOn, "the generator runs at tier 1 while it is upgraded");
  for (const s of p) s.role = "build";
  let hours = 0;
  while (genTier(g) === 1 && hours < 300) { constructionHour(st); st.hour++; refreshPower(st, h); hours++; }
  check(genTier(g) === 2 && countAll(h, "generator") === 1, `done in ${hours} hours: a standby generator where it stood`);
  check(fixtureName(g) === "Standby generator" && /tier 2/.test(powerLine(st, h)), `its name and the Power line (${powerLine(st, h)})`);
  // Tier 3: Mechanics 5 and the manual.
  chk = canUpgradeGenerator(st, h, g.id);
  check(!chk.ok && /Mechanics 5/.test(chk.reason), `tier 3 without Mechanics 5: refused (${chk.reason})`);
  p[0].skills.mechanics = 5;
  chk = canUpgradeGenerator(st, h, g.id);
  check(!chk.ok && chk.locked && /Industrial Power Manual/.test(chk.reason), `everything but the manual: locked (${chk.reason})`);
  tech(st).known.push("indpower");
  check(!upgradeLock(st, "generator3") && canUpgradeGenerator(st, h, g.id).ok, "the manual studied: ok");
  queueGenUpgrade(st, h, g.id);
  while (genTier(g) === 2 && hours < 900) { constructionHour(st); st.hour++; hours++; }
  check(genTier(g) === 3 && /top tier/.test(canUpgradeGenerator(st, h, g.id).reason), "an industrial diesel set: the top tier");
  const back = demolishRefund(g);
  const tot = (k) => [BUILDINGS.generator.cost, T[2].cost, T[3].cost].reduce((a, c) => a + (c[k] || 0), 0);
  check(back.scrap === Math.floor(tot("scrap") / 2) && back.parts === Math.floor(tot("parts") / 2) && back.electronics === Math.floor(tot("electronics") / 2), `demolished: half of everything put in back (${JSON.stringify(back)})`);
  const sc = h.stock.scrap;
  demolish(st, h, g.id);
  check(h.stock.scrap === sc + back.scrap && !countAll(h, "generator"), "pulled down, the refund paid");
}

// ---------- 3. fuel by tier and load, tanks, two generators, Heat ----------
{
  console.log("Fuel by tier and load");
  for (const t of [1, 2, 3]) {
    const st = W();
    const h = quietHub(st);
    const g = addBuilding(h, "generator"); g.tier = t;
    addBuilding(h, "freezer");
    refreshPower(st, h);
    check(near(g.tank, T[t].tank - genBurn(T[t], 2) / 24), `tier ${t}: refuelled to its tank of ${T[t].tank}`);
    const t0 = g.tank;
    for (let i = 0; i < 12; i++) { st.hour++; refreshPower(st, h); }
    check(near(t0 - g.tank, genBurn(T[t], 2) / 2, 1e-6), `tier ${t}, one freezer: ${(genBurn(T[t], 2)).toFixed(3)} fuel a day (${((t0 - g.tank) * 2).toFixed(3)} measured)`);
    check(generatorHeat(h) === T[t].heat && powerStatus(st, h).heat === T[t].heat, `tier ${t}: +${T[t].heat} Heat while it runs`);
    check(new RegExp(`Running: 2 of ${T[t].out} power`).test(generatorLine(st, h, g)), `the line (${generatorLine(st, h, g)})`);
  }
  // Two generators: a portable and a standby.
  const st = W();
  const h = quietHub(st);
  const a = addBuilding(h, "generator"); const b = addBuilding(h, "generator"); b.tier = 2;
  a.tank = 3; b.tank = 5;
  addBuilding(h, "freezer");
  let ps = powerStatus(st, h);
  check(ps.gens.find((x) => x.b === a).running && !ps.gens.find((x) => x.b === b).running && ps.fuelPerDay === 2, "one freezer: the portable set runs (2 a day), the standby set waits (it would burn 2.46)");
  addBuilding(h, "freezer"); addBuilding(h, "sealer"); addBuilding(h, "radio"); addBuilding(h, "floodlights");
  ps = powerStatus(st, h);
  check(ps.demand === 7 && ps.running === 1 && ps.gens.find((x) => x.b === b).running && ps.supply === 12, `7 wanted: the standby set alone (${ps.supply} supply)`);
  POWER_USERS.radio.need = 7; // a test: 13 wanted
  ps = powerStatus(st, h);
  check(ps.demand === 13 && ps.running === 2 && ps.supply === 18 && ps.served === 13 && near(ps.fuelPerDay, Math.round((genBurn(T[2], 12) + genBurn(T[1], 1)) * 100) / 100), `13 wanted: both, 18 supply, the standby set full and the portable the rest (${ps.fuelPerDay} a day)`);
  check(ps.heat === T[1].heat + T[2].heat, "their Heat adds up");
  POWER_USERS.radio.need = 1;
  b.broken = { day: 1 };
  ps = powerStatus(st, h);
  check(ps.supply === 6 && ps.demand === 7 && ps.served <= 6, "the standby set broken: the portable gives its 6, a user goes without");
  b.broken = null;
  check(near(genFuelFor(h, 7), genBurn(T[2], 7)) && near(genFuelFor(h, 7, a), genBurn(T[2], 7)) && near(genFuelFor(h, 20, a), genBurn(T[2], 12) + genBurn(T[2], 8)), "genFuelFor: the biggest first, and with one upgraded");
}

// ---------- 4. wear, spares and repairs by tier ----------
{
  console.log("Wear, spares, repairs");
  const st = W();
  const h = quietHub(st);
  const g = addBuilding(h, "generator"); addBuilding(h, "freezer");
  refreshPower(st, h);
  const w1 = dailyWear(st, h, g, null);
  g.tier = 3;
  refreshPower(st, h);
  const w3 = dailyWear(st, h, g, null);
  check(fxDef(g) === FIXTURES.generator3 && w3 > w1 && near(w3 / w1, FIXTURES.generator3.use / FIXTURES.generator.use), `tier 3 wears faster (${w1.toFixed(2)} → ${w3.toFixed(2)} a running day)`);
  check(FIXTURES.generator2.spares < FIXTURES.generator.spares && FIXTURES.generator3.spares < FIXTURES.generator2.spares, "spares sooner by tier (20 / 16 / 12 days)");
  g.spares = 1 - 1 / FIXTURES.generator3.spares + 1e-9;
  const p0 = h.stock.parts;
  useSpares(st, h, g);
  check(h.stock.parts === p0 - 1, "a spare part after the tier's days of running");
  breakFixture(st, h, g, "test", { card: false, quiet: true });
  atBase(st, h.id)[0].skills.mechanics = 4;
  let plan = repairPlan(st, h, g);
  check(!plan.ok && /Mechanics 5/.test(plan.why), `a broken tier 3 needs Mechanics 5 (${plan.why})`);
  atBase(st, h.id)[0].skills.mechanics = 5;
  plan = repairPlan(st, h, g);
  check(plan.ok && plan.cost.parts === FIXTURES.generator3.repair.cost.parts && plan.cost.parts > FIXTURES.generator.repair.cost.parts, `and more parts (${JSON.stringify(plan.cost)})`);
  check(genFixture(1) === FIXTURES.generator && genFixture(2) === FIXTURES.generator2, "genFixture by tier");
}

// ---------- 5. old saves ----------
{
  console.log("Old saves");
  const st = W(5);
  const h = quietHub(st);
  const g = addBuilding(h, "generator");
  delete g.tier;
  const f = st.factions.find((x) => x.alive && !x.hcMilitary);
  const w = worksAt(f, f.bases[0]); w.power = 1; delete w.powerTier;
  const save = serializeState(st);
  delete save.state?.genTiersV; // the save's state object (either shape)
  const raw = JSON.parse(JSON.stringify(save));
  const strip = (o) => { if (o && typeof o === "object") { if ("genTiersV" in o) delete o.genTiersV; for (const v of Object.values(o)) if (v && typeof v === "object" && !Array.isArray(v)) strip(v); } };
  strip(raw);
  const S = deserializeState(raw);
  const G = hub(S).buildings.find((x) => x.type === "generator");
  const F = S.factions.find((x) => x.name === f.name);
  check(G.tier === 1 && S.genTiersV === 1, "a generator from before the tiers is tier 1");
  check(F.works[f.bases[0]].powerTier === 1, "and a group's generator too");
}

// ---------- 6. the governor's upgrade ----------
// Fake fuel flows: days of history rows with this fuel in and out a day.
function fakeFlows(st, base, inn, out, days = 28) {
  const H = ensureHistory(st);
  const cols = H.bc;
  const rows = [];
  for (let d = day(st) - days; d < day(st); d++) {
    const r = cols.map(() => 0);
    r[0] = d; r[1] = 1; r[cols.indexOf("i_fuel")] = inn; r[cols.indexOf("o_fuel")] = out;
    rows.push(r);
  }
  H.bases[String(base.id)] = { name: base.name, rows };
}
function govHub(seed, { summer = true } = {}) {
  const st = W(seed);
  if (summer) { st.hour = 0; while (seasonOfDay(Math.floor(st.hour / 24)).key !== "summer") st.hour += 24; }
  const h = quietHub(st);
  const g = addBuilding(h, "generator");
  for (const t of ["freezer", "freezer", "sealer", "radio", "floodlights"]) addBuilding(h, t); // 7 power wanted
  atBase(st, h.id)[0].skills.mechanics = 4;
  setAutopilot(st, true, "balanced");
  return { st, h, g };
}
{
  console.log("The governor's upgrade");
  let { st, h, g } = govHub(3);
  fakeFlows(st, h, 6, 2.5);
  check(near(genFuelFlows(st, h).income, 6) && near(genFuelFlows(st, h).out, 2.5), "the 28-day flows from the history");
  let msg = autoGenUpgrade(st, h);
  check(/Standby generator queued/.test(msg) && h.construction.some((c) => c.target === g.id && c.tier === 2), `7 wanted, 6 given, fuel 6 in and 2.5 out: upgraded (${msg})`);
  check(autoGenUpgrade(st, h) === "", "not twice");
  // Never into a deficit: 2.6 in, 2.5 out, the upgrade adds about 1 a day.
  ({ st, h, g } = govHub(3));
  fakeFlows(st, h, 2.6, 2.5);
  msg = autoGenUpgrade(st, h);
  check(msg === "" && !h.construction.length && /run it down/.test(h.genUp.why), `2.6 in, 2.5 out: no upgrade (${h.genUp.why})`);
  // The stock above the floor must carry 30 days of the extra.
  ({ st, h, g } = govHub(3));
  fakeFlows(st, h, 6, 2.5);
  const extra = genFuelFor(h, 7, g) - genFuelFor(h, 7);
  h.stock.fuel = 10 + extra * 30 - 2;
  msg = autoGenUpgrade(st, h);
  check(msg === "" && /above the floor/.test(h.genUp.why), `short of fuel above the floor: no upgrade (${h.genUp.why})`);
  // The winter's heating counts in the floor before it is near.
  ({ st, h, g } = govHub(3, { summer: false }));
  st.hour = 0; while (heatFuelWant(st, h).need < 5 || heatFuelWant(st, h).want) st.hour += 24;
  st.hour += 8;
  fakeFlows(st, h, 6, 2.5);
  const hw = heatFuelWant(st, h);
  h.stock.fuel = 10 + hw.need + extra * 30 - 2;
  msg = autoGenUpgrade(st, h);
  check(msg === "" && /above the floor/.test(h.genUp.why), `autumn, ${hw.need} fuel of heating ahead: no upgrade into it (${h.genUp.why})`);
  h.stock.fuel = 10 + hw.need + extra * 30 + 2;
  msg = autoGenUpgrade(st, h);
  check(/queued/.test(msg), `with the heating's fuel over: upgraded (${msg || h.genUp.why})`);
  // No hand, no spare parts, no need, no history.
  ({ st, h, g } = govHub(3));
  fakeFlows(st, h, 6, 2.5);
  atBase(st, h.id)[0].skills.mechanics = 3;
  check(autoGenUpgrade(st, h) === "" && /Mechanics 4/.test(h.genUp.why), `no Mechanics 4 hand: no upgrade (${h.genUp.why})`);
  atBase(st, h.id)[0].skills.mechanics = 4;
  h.stock.parts = T[2].cost.parts + 1;
  check(autoGenUpgrade(st, h) === "" && /saving the parts/.test(h.genUp.why), `parts for it but not the spares: no upgrade (${h.genUp.why})`);
  h.stock.parts = 40;
  h.buildings = h.buildings.filter((x) => x.type !== "radio" && x.type !== "floodlights");
  check(autoGenUpgrade(st, h) === "" && /6 power for 5 wanted/.test(h.genUp.why), `5 wanted, 6 given: no upgrade (${h.genUp.why})`);
  ({ st, h, g } = govHub(3));
  check(autoGenUpgrade(st, h) === "" && /history/.test(h.genUp.why), `no fuel history: no upgrade on a guess (${h.genUp.why})`);
  // Tier 3 waits for the manual (13 wanted: a test need).
  ({ st, h, g } = govHub(3));
  g.tier = 2;
  atBase(st, h.id)[0].skills.mechanics = 5;
  fakeFlows(st, h, 9, 3.5);
  POWER_USERS.radio.need = 7;
  check(autoGenUpgrade(st, h) === "" && /Industrial Power Manual/.test(h.genUp.why), `13 wanted, tier 2: waits for the manual (${h.genUp.why})`);
  tech(st).known.push("indpower");
  msg = autoGenUpgrade(st, h);
  check(/Industrial diesel set queued/.test(msg), `the manual studied: upgraded (${msg || h.genUp.why})`);
  POWER_USERS.radio.need = 1;
}

// ---------- 7. the AI groups ----------
{
  console.log("AI groups");
  const st = W(9);
  st.hour = 24 * 40;
  const f = st.factions.find((x) => x.alive && !x.hcMilitary);
  f.type = "military"; setMech(st, f, 6); // mechanic 6
  groupTech(f).known.push("genschem", "refrig", "machinist");
  f.pop = 20;
  Object.assign(f.stock, { fuel: 40, parts: 30, scrap: 100 }); setFood(f.stock, 600); // days of ration bars
  const tile = f.bases[0];
  const w = worksAt(f, tile);
  Object.assign(w, { water: 3, farms: 3, beds: 3, walls: 7, bench: 1, store: 1, sickbay: 4, pens: 1, still: 1, power: 1, freezer: 1, sealer: 1, kitchen: 1 });
  f.jails = { [tile]: 3 };
  check(groupGenTier(w) === 1 && groupPowerNeed(w) === 3, "a freezer and a sealer: 3 power wanted of a tier-1 set");
  check(/6 power for 3 wanted/.test(groupPowerUpWhy(st, f, tile)), `no upgrade while it covers them (${groupPowerUpWhy(st, f, tile)})`);
  // Tier 1's burn as before: the flat 2.
  setFood(f.stock, 600); const fuel0 = f.stock.fuel = 40;
  groupMachinesDaily(st, f);
  check(near(fuel0 - f.stock.fuel, 2, 1e-9) || near(fuel0 - f.stock.fuel, 2 - GROUP_WORKS.MACH.still.fuel, 1e-9), `tier 1 burns its flat 2 a day (${fuel0} → ${f.stock.fuel})`);
  // A test need: their freezer draws 7.
  POWER_USERS.freezer.need = 7;
  f.fuelFlow = { in: 6, out: 2, days: 30, mark: f.stock.fuel };
  f.stock.fuel = 60;
  check(groupPowerUpWhy(st, f, tile) === "", `8 wanted: they would upgrade (${groupPowerUpWhy(st, f, tile)})`);
  f.fuelFlow.in = 2.2;
  check(/run it down/.test(groupPowerUpWhy(st, f, tile)), `never into a fuel deficit (${groupPowerUpWhy(st, f, tile)})`);
  f.fuelFlow.in = 6;
  f.type = "commune"; setMech(st, f, 3); // mechanic 3
  check(/Mechanics 4/.test(groupPowerUpWhy(st, f, tile)), `no Mechanics 4 hand (${groupPowerUpWhy(st, f, tile)})`);
  f.type = "military"; setMech(st, f, 6);
  w.bench = 0;
  check(/workshop/.test(groupPowerUpWhy(st, f, tile)) && /workshop/.test(workLock(st, f, "power2")), `ai-locks' workLock: no workshop, no upgrade (${groupPowerUpWhy(st, f, tile)})`);
  w.bench = 1;
  const p0 = f.stock.parts;
  let done = 0;
  for (let i = 0; i < 20 && groupGenTier(w) < 2; i++) { const nw = !f.job ? nextWork(st, f) : null; if (nw && nw.type === "powerup") done++; f.fuelFlow.in = 6; f.fuelFlow.days = 30; setFood(f.stock, 600); f.stock.fuel = 60; groupWorksDaily(st, f); st.hour += 24; }
  check(groupGenTier(w) === 2 && done >= 1 && f.stock.parts <= p0 - GROUP_WORKS.MACH.tiers[2].cost.parts + 2, `upgraded to a standby generator (parts ${p0} → ${f.stock.parts})`);
  check(/standby generator/.test(worksText(st, f)), `the Groups tab (${worksText(st, f)})`);
  // Tier 2's burn: genBurn at the load.
  clearFood(f.stock); f.stock.fuel = 40; // no still today
  w.alarm = 0; if (w.mach) delete w.mach.alarm; // groups-power-grid (2026-10-24): the perimeter alarm they put up first draws 1 at night; this check is the generator's burn at the machines' 8 alone
  groupMachinesDaily(st, f);
  check(near(40 - f.stock.fuel, genBurn(T[2], 8), 1e-9) && near(groupGenBurn(w, 8), genBurn(T[2], 8)), `tier 2 burns ${genBurn(T[2], 8).toFixed(3)} a day at 8 power (${(40 - f.stock.fuel).toFixed(3)})`);
  // Tier 3: the manual.
  POWER_USERS.freezer.need = 13;
  setFood(f.stock, 600); f.stock.fuel = 60; f.stock.parts = 30; f.fuelFlow.in = 9;
  check(/Industrial Power Manual/.test(groupPowerUpWhy(st, f, tile)), `tier 3 waits for the manual (${groupPowerUpWhy(st, f, tile)})`);
  groupTech(f).known.push("indpower");
  check(groupPowerUpWhy(st, f, tile) === "", "the manual known: they would");
  f.type = "traders"; setMech(st, f, 4); // mechanic 4
  check(/Mechanics 5/.test(groupPowerUpWhy(st, f, tile)), "tier 3 needs a Mechanics 5 hand");
  f.type = "military"; setMech(st, f, 6);
  for (let i = 0; i < 20 && groupGenTier(w) < 3; i++) { f.fuelFlow.in = 9; f.fuelFlow.days = 30; setFood(f.stock, 600); f.stock.fuel = 60; groupWorksDaily(st, f); st.hour += 24; }
  check(groupGenTier(w) === 3, "an industrial diesel set");
  // Wear and repair by tier.
  const m = w.mach.power;
  m.broken = true; f.type = "traders"; setMech(st, f, 4); f.stock.parts = 30; f.stock.scrap = 100;
  groupMachinesDaily(st, f);
  check(m.broken, "a broken tier 3 waits for a Mechanics 5 hand");
  f.type = "military"; setMech(st, f, 6);
  const pp = f.stock.parts;
  groupMachinesDaily(st, f);
  check(!m.broken && pp - f.stock.parts >= FIXTURES.generator3.repair.cost.parts, `repaired with the tier's parts (${pp} → ${f.stock.parts})`);
  POWER_USERS.freezer.need = 2;
}

// ---------- 8. governor runs ----------
for (const seed of seeds) {
  console.log(`Governor run (seed ${seed}, ${govDays} days)`);
  const st = W(seed);
  setAutopilot(st, true, "balanced");
  let bad = null;
  try {
    while (day(st) <= govDays && !st.gameOver) {
      autopilotResolve(st);
      tickHour(st);
      if (st.hour % 24 === 0) for (const b of st.bases) {
        for (const [k, v] of Object.entries(b.stock)) if (typeof v === "number" && (!Number.isFinite(v) || v < -1e-6) && !(k === "food" && b.type === "outpost")) bad = bad || `day ${day(st)} ${b.name} ${k}=${v}`;
        for (const x of b.buildings) if (x.type === "generator" && (!Number.isFinite(x.tank ?? 0) || (x.tank || 0) > genTank(x) + 1e-9)) bad = bad || `day ${day(st)} ${b.name} tank ${x.tank}`;
      }
    }
  } catch (e) { bad = `crash day ${day(st)}: ${e.stack.split("\n").slice(0, 3).join(" | ")}`; }
  check(!bad, `no NaN or negative stock, tanks within their tier, no crash (${bad || "ok"})`);
  check(st.factions.every((f) => !f.fuelFlow || (Number.isFinite(f.fuelFlow.in) && Number.isFinite(f.fuelFlow.out))), "the groups' fuel flows are finite");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
