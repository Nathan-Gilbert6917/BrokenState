// Headless supply-run test: founds two outposts directly in state, sets up supply-run jobs between the
// bases (repeat, one-off, with and without a vehicle, hold, disband, recreate, blocked cases) and runs a
// long campaign. Checks stock moves, schedules, blocked messages and that nothing crashes or gets stuck.
// Usage: node tools/supplytest.js [days] [seeds...]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { totalRounds } from "../src/sim/ammo.js"; // rounds by calibre
import { createWorld, tickHour, day, hub, atBase, newId, survivorById, baseById } from "../src/sim/world.js";
import { planPath, partyMembers } from "../src/sim/parties.js";
import { recomputeOwnership } from "../src/sim/factions.js";
import { addBuilding } from "../src/sim/buildings.js";
import { createVehicle, vehicleById } from "../src/sim/vehicles.js";
import {
  saveSupplyRun, dispatchSupplyRun, supplyRunById, jobParty, jobForm, releaseHeld, pauseSupplyRun, supplyStatus,
  deleteSupplyRun, supplyEstimate, supplyRuns,
} from "../src/sim/supply.js";
import { setAutopilot, autopilotDaily } from "../src/sim/autopilot.js";
import { breakFixture } from "../src/sim/breakdowns.js";

const days = Number(process.argv[2] || 70);
const seeds = process.argv.length > 3 ? process.argv.slice(3).map(Number) : [42, 7, 1234];
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log(`  FAIL: ${msg}`); } return ok; };

function makeOutpost(state, tile, name, staff) {
  const base = {
    id: newId(), tile, type: "outpost", name, stock: { food: 60, water: 30, fuel: 10, meds: 2, ammo: 30, parts: 0, scrap: 20 },
    radio: false, watchtower: false, buildings: [], construction: [], armory: [],
  };
  state.bases.push(base);
  for (const s of staff) { s.location = { kind: "base", baseId: base.id }; s.role = "guard"; }
  for (let i = 0; i < 3; i++) addBuilding(base, "walls");
  recomputeOwnership(state);
  return base;
}

function freeTile(state, near, dmin, dmax, avoid = []) {
  const g = state.grid;
  return state.tiles.find((t) => {
    const d = g.distance(t.id, near);
    if (d < dmin || d > dmax || t.terrain === "water") return false;
    if (state.bases.some((b) => g.distance(b.tile, t.id) < 3) || avoid.some((a) => g.distance(a, t.id) < 3)) return false;
    if (state.factions.some((f) => f.bases.some((b) => g.distance(b, t.id) <= 3))) return false;
    if (typeof t.owner === "number") return false;
    return !!planPath(state, near, t.id, true);
  });
}

function resolveCards(state) {
  let n = 0;
  while (state.cards.length) {
    if (++n > 50) { check(false, `card loop: ${state.cards[0].title}`); state.cards.length = 0; break; }
    const c = state.cards.shift();
    const opts = c.choices.filter((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(state) : x.disabled));
    // Newcomers are turned away: this test is about supply runs, and a crowded hub loses people (morale.js).
    const ch = (c.recruit && opts.find((x) => x.kind === "away")) || opts.find((x) => !/fight|attack|storm|ambush|killzone/i.test(x.label)) || opts[0];
    // A hub fire that burns a bunkhouse is put right at once: crowding (morale.js) would drive the crews away, and
    // this test is about the supply runs, not about which seed draws a summer fire.
    const bunks = state.bases.map((b) => [b, b.buildings.filter((x) => x.type === "bunkhouse").length]);
    if (ch) ch.resolve(state);
    for (const [b, k] of bunks) for (let i = b.buildings.filter((x) => x.type === "bunkhouse").length; i < k; i++) addBuilding(b, "bunkhouse");
  }
}

// Every log line of the campaign (the in-game log keeps only the last 200).
let allLogs = [];
const collect = (state) => { for (const l of state.log) { if (l.hour !== state.hour) break; allLogs.push(l); } };
const logHas = (state, re, since) => allLogs.some((l) => l.hour >= since && re.test(l.text));
const form = (o) => ({ jobId: null, vehicleId: null, pickup: [], atDest: "return", schedule: "repeat", every: 5, stance: "normal", allowPartial: false, ...o });

const summary = [];
for (const seed of seeds) {
  console.log(`--- seed ${seed} ---`);
  const state = createWorld({ seed, factionCount: 6 });
  allLogs = [];
  state.started = true;
  state.visitorsOff = true; // no outsiders (visitors.js): their trade windows and cards are not this test's business
  // No raids by the groups either: they are sized to a base's defence and come when its people are out, so the
  // test outposts (whose crews are on the road) would be lost; raids are tested in fighttest.js and raidcensus.js.
  for (const f of state.factions) f.raidCooldown = 1e9;
  state.noNewGangs = true;
  const h = hub(state);
  Object.assign(h.stock, { water: 200, fuel: 120, ammo: 400, meds: 20, parts: 6, scrap: 60 }); setFood(h, 700);
  for (let i = 0; i < 6; i++) state.survivors.push({ ...state.survivors[i], id: newId(), name: `Extra${i} Hand`, leader: false, gear: { weapon: null, armor: null, tool: null }, skills: { ...state.survivors[i].skills }, traits: [], location: { kind: "base", baseId: h.id } });
  addBuilding(h, "bunkhouse"); // beds for the 6 extra hands, so crowding (morale.js) does not drive the crews away
  const people = atBase(state, h.id);
  const tA = freeTile(state, h.tile, 3, 6);
  const tB = tA && freeTile(state, tA.id, 3, 6, [h.tile]);
  if (!check(tA && tB, "could not place outposts")) continue;
  const A = makeOutpost(state, tA.id, "Test Outpost A", [people[6], people[7]]);
  const B = makeOutpost(state, tB.id, "Test Outpost B", [people[8]]);
  people[7].role = "scavenge";
  const sedan = createVehicle(state, "sedan", { kind: "base", baseId: A.id }, { fuel: 12, condition: 70 });
  const truck = state.vehicles.find((v) => v.type === "truck");
  const hubCrew = atBase(state, h.id).filter((s) => !s.leader);

  // 1. Controlled run: hub -> A by truck, deliver food + ammo, pick up scrap + fuel, come back. Repeat every 4 days.
  const est = supplyEstimate(state, form({ originId: h.id, destId: A.id, crew: [hubCrew[0].id, hubCrew[1].id], vehicleId: truck.id, deliver: [{ key: "food", qty: 20 }, { key: "ammo", qty: 40 }] }));
  check(!est.error && est.hoursOut > 0, `estimate failed: ${est.error}`);
  const j1 = saveSupplyRun(state, form({ originId: h.id, destId: A.id, crew: [hubCrew[0].id, hubCrew[1].id], vehicleId: truck.id,
    deliver: [{ key: "food", qty: 20 }, { key: "ammo", qty: 40 }, { key: "water", qty: 10 }], pickup: [{ key: "scrap", qty: 4 }, { key: "fuel", qty: 5 }], every: 4 })).job;
  const before = { ammo: totalRounds(h.stock), food: food(h) }; // ammo.js: every round, any calibre
  dispatchSupplyRun(state, j1, true);
  const p1 = jobParty(state, j1);
  check(p1 && p1.vehicle && p1.routeKind === "supply", "run 1 did not leave by truck");
  check(before.ammo - totalRounds(h.stock) === 40 + totalRounds(p1.supplies), `hub ammo moved ${before.ammo - totalRounds(h.stock)}, expected ${40 + totalRounds(p1.supplies)}`);
  check(Math.abs(food(p1.cargo) - 20) < 1e-6 && Math.abs(before.food - food(h) - (food(p1) + food(p1.cargo))) < 1e-6, `hub food did not move by delivery + road food (${(before.food - food(h)).toFixed(2)}: ${food(p1.cargo).toFixed(2)} delivered + ${food(p1).toFixed(2)} for the road)`);
  let delivered = null, pickedUp = null, hours = 0;
  while (jobParty(state, j1) && hours < 24 * 6) {
    const snapA = { ...A.stock };
    const cargo = { ...jobParty(state, j1).cargo.supplies };
    const phase = jobParty(state, j1).phase;
    tickHour(state); resolveCards(state); hours++;
    const q = jobParty(state, j1);
    if (phase === "out" && q && q.phase === "back" && state.hour % 24 !== 0) {
      delivered = { food: food(A) - snapA.food + (snapA.food >= 0 ? 0 : 0), ammo: totalRounds(A.stock) - totalRounds(snapA), cargoAmmo: totalRounds(cargo) };
      pickedUp = { scrap: q.cargo.supplies.scrap || 0, fuel: q.cargo.supplies.fuel || 0 };
    }
  }
  check(!jobParty(state, j1), "run 1 did not come home within 6 days");
  if (delivered) {
    check(delivered.ammo === Math.floor(delivered.cargoAmmo), `outpost A got ${delivered.ammo} ammo, cargo had ${delivered.cargoAmmo}`);
    check(pickedUp.scrap > 0, "nothing picked up at A");
  } else check(false, "could not observe the arrival at A");
  check(hubCrew[0].location.kind === "base" && hubCrew[0].location.baseId === h.id, "crew not back at hub");
  if (truck.loc.kind !== "base") console.log("  truck:", JSON.stringify(truck), state.log.slice(0, 8).map((l) => l.text).join(" | "));
  check(truck.loc.kind === "base" && truck.loc.baseId === h.id, "truck not parked at hub");
  console.log(`  run 1: delivered ${JSON.stringify(delivered)}, picked up ${JSON.stringify(pickedUp)}, ${hours}h round trip`);

  // 1b. Winter stores: no fresh food at the hub, only preserved: the run still leaves, its road food packed from the
  // preserved stores (census seed 3, aggressive: a hub with 0 fresh and 934 preserved kept every run home "for want of
  // food" while an outpost died of thirst).
  {
    const keep = { food: food(h), preserved: jarred(h) };
    setFood(h, 0); setJarred(h, 60);
    const jw = saveSupplyRun(state, form({ originId: h.id, destId: A.id, crew: [hubCrew[2].id], deliver: [{ key: "scrap", qty: 2 }], schedule: "once" })).job;
    dispatchSupplyRun(state, jw, true);
    const pw = jobParty(state, jw);
    check(!!pw, `a run on preserved food alone did not leave (${jw.blocked})`);
    if (pw) check(jarred(pw) > 0 && Math.abs(jarred(h) - (60 - jarred(pw))) < 1e-6, `road food packed from the jarred stores (${JSON.stringify(pw.supplies)}, hub jarred ${jarred(h)})`);
    for (let k = 0; jobParty(state, jw) && k < 24 * 6; k++) { tickHour(state); resolveCards(state); }
    check(!jobParty(state, jw), "the run on preserved food did not come home within 6 days");
    setFood(h, keep.food); setJarred(h, keep.preserved);
  }

  // 2. Outpost -> outpost on foot, every 6 days.
  const j2 = saveSupplyRun(state, form({ originId: A.id, destId: B.id, crew: [people[6].id], deliver: [{ key: "scrap", qty: 5 }, { key: "food", qty: 8 }], pickup: [{ key: "fuel", qty: 1 }], every: 6 })).job;
  // 3. Hold at B, once; released later.
  const j3 = saveSupplyRun(state, form({ originId: h.id, destId: B.id, crew: [hubCrew[2].id], deliver: [{ key: "meds", qty: 3 }], pickup: [{ key: "scrap", qty: 3 }], atDest: "hold", schedule: "once" })).job;
  // 4. Disband at B, once, then recreate from B.
  const j4 = saveSupplyRun(state, form({ originId: h.id, destId: B.id, crew: [hubCrew[3].id], deliver: [{ key: "ammo", qty: 30 }], pickup: [], atDest: "disband", schedule: "once", stance: "rushed" })).job;
  // 5. Blocked: not enough stock.
  const j5 = saveSupplyRun(state, form({ originId: h.id, destId: A.id, crew: [hubCrew[4].id], deliver: [{ key: "parts", qty: 999 }], every: 3 })).job;
  // 6. Blocked: crew dead.
  const doomed = hubCrew[5];
  const j6 = saveSupplyRun(state, form({ originId: h.id, destId: A.id, crew: [doomed.id], deliver: [{ key: "food", qty: 2 }], every: 3 })).job;
  doomed.alive = false;
  // 7. Vehicle without fuel at A: falls back to hand carts.
  const j7 = saveSupplyRun(state, form({ originId: A.id, destId: h.id, crew: [people[7].id], vehicleId: sedan.id, deliver: [{ key: "scrap", qty: 4 }], schedule: "once" })).job;
  sedan.fuel = 0; A.stock.fuel = 0;
  // 8. Destination lost.
  const tC = freeTile(state, h.tile, 3, 8, [tB.id]);
  const C = tC ? makeOutpost(state, tC.id, "Test Outpost C", []) : null;
  const j8 = C ? saveSupplyRun(state, form({ originId: h.id, destId: C.id, crew: [hubCrew[4].id], deliver: [{ key: "food", qty: 1 }], every: 2 })).job : null;
  if (C) { state.bases.splice(state.bases.indexOf(C), 1); }

  // Surplus shipping from outposts to the hub still works next to supply runs (no job reserves meds at A).
  A.stock.meds = 20;
  const hubMeds = h.stock.meds;
  while (state.hour % 24 !== 23) { tickHour(state); collect(state); resolveCards(state); }
  tickHour(state); collect(state); resolveCards(state);
  check(A.stock.meds <= 3 && h.stock.meds > hubMeds, `outpost surplus not shipped (A meds ${A.stock.meds}, hub ${hubMeds} -> ${h.stock.meds})`);
  check(A.stock.water >= 3, "outpost A shipped away the water its supply run needs");
  const t0 = 0;
  const runs = {};
  let maxRoad = 0, released = false, recreated = false, recreateDone = false, paused = false, deleted = false;
  const roadSince = new Map();
  try {
    while (day(state) <= days && !state.gameOver) {
      tickHour(state);
      collect(state);
      resolveCards(state);
      if (state.engagement || state.trade || state.combat) { check(false, "unexpected engagement/trade/combat"); state.engagement = null; state.trade = null; state.combat = null; }
      // Road time per convoy (stuck detection).
      for (const p of state.parties) {
        if (p.routeKind !== "supply") continue;
        if (p.phase === "holding") { roadSince.delete(p.id); continue; }
        if (!roadSince.has(p.id)) roadSince.set(p.id, state.hour);
        maxRoad = Math.max(maxRoad, state.hour - roadSince.get(p.id));
      }
      const d = day(state);
      // The player keeps the truck repaired.
      if (truck.loc.kind === "base" && truck.condition < 40) truck.condition = 85;
      if (h.stock.fuel < 40) h.stock.fuel += 30; // and finds fuel now and then
      // Teams bring food and water home (crops ripen in batches and stored food spoils), and scrap to Outpost A
      // (picking around a base rarely finds anything now): this test is about the supply runs, not about famine.
      if (food(h) < 200) addDays(h, 100);
      if (h.stock.water < 60) h.stock.water += 40;
      if (A.stock.scrap < 8 && d % 3 === 0) A.stock.scrap += 6;
      // Release the held convoy after 4 days of holding.
      if (!released && jobParty(state, j3)?.phase === "holding" && d >= (j3.lastDay || 0) + 6) {
        check(supplyStatus(state, j3).key === "holding", "j3 status not holding");
        releaseHeld(state, j3, "return");
        released = d;
      }
      // Recreate the disbanded job from B (it should go back to the hub with the lists swapped).
      if (!recreated && j4.status === "disbanded") {
        const f = jobForm(state, j4, B.id, "recreate");
        check(f.originId === B.id && f.destId === h.id, "recreate did not swap direction");
        check(f.crew.length === 1, "recreate found no crew at B");
        check(!f.deliver.length && f.pickup[0]?.key === "ammo", "recreate did not swap deliver and pick-up");
        f.atDest = "disband";
        addDays(B, 10); B.stock.water += 10; // the player tops up B so the crew has road supplies
        saveSupplyRun(state, f);
        recreated = d;
      } else if (recreated && !recreateDone && j4.status === "disbanded" && j4.originId === B.id) {
        recreateDone = d;
        check(hubCrew[3].location.baseId === h.id, "recreated run did not disband at hub");
      }
      // Pause the repeating run for 10 days mid-campaign.
      if (!paused && d === 20) { pauseSupplyRun(state, j1, true); paused = { day: d, runs: j1.runs }; }
      if (paused && d === 30 && j1.paused) { check(j1.runs <= paused.runs + 1, "paused job kept dispatching"); pauseSupplyRun(state, j1, false); }
      if (!deleted && d === days - 5) { deleteSupplyRun(state, j5); deleted = true; }
      for (const j of [j1, j2, j3, j4, j7]) runs[j.id] = j.runs;
    }
  } catch (e) {
    check(false, `crash on day ${day(state)}: ${e.stack}`);
  }
  check(j1.runs >= Math.floor((days - 12) / 5), `j1 only ran ${j1.runs} times in ${days} days (every 4)`);
  check(j2.runs >= 3, `j2 (outpost to outpost) only ran ${j2.runs} times`);
  check(released && j3.status === "done", `hold job: released ${released}, status ${j3.status}`);
  check(!!recreateDone, "recreate did not complete");
  check(logHas(state, /cannot leave: not enough at .* to send 999 parts/, t0), "no blocked log for missing stock");
  check(logHas(state, /cannot leave: no crew at/, t0), "no blocked log for dead crew");
  check(j7.runs === 1 && logHas(state, /on foot because not enough fuel/, t0), `no on-foot fallback for the sedan (runs ${j7.runs})`);
  if (j8) check(logHas(state, /cannot leave: the destination base is gone/, t0), "no blocked log for a lost destination");
  check(!supplyRunById(state, j5.id), "deleted job still listed");
  const blockedLogs = allLogs.filter((l) => /cannot leave/.test(l.text)).length;
  check(blockedLogs < 40, `too many blocked logs (${blockedLogs}): spam`);
  check(maxRoad < 24 * 8, `a convoy was on the road for ${maxRoad}h`);
  const lost = allLogs.filter((l) => /never arrived/.test(l.text)).length;
  const ships = A.stock.scrap;
  console.log(`  runs: j1 ${j1.runs} (every 4d, paused 10d), j2 ${j2.runs}, hold j3 ${j3.runs}, disband+recreate j4 ${j4.runs}, fallback j7 ${j7.runs}; longest road ${maxRoad}h; lost convoys ${lost}; blocked logs ${blockedLogs}`);
  console.log(`  statuses: ${[j1, j2, j3, j4, j6, j7, j8].filter(Boolean).map((j) => `${j.id}:${supplyStatus(state, j).key}`).join(" ")}; A scrap ${Math.floor(ships)}, hub food ${Math.floor(food(h))}`);
  for (const j of [j1, j2, j3, j4, j7].filter(Boolean)) console.log(`  job ${j.id}: ${supplyStatus(state, j).text} | ${j.lastResult}`);
  summary.push({ seed, j1: j1.runs, j2: j2.runs, lost });
}
// The governor ships scrap and parts to an outpost whose well broke and waits for them (autopilot.js
// waterRepairLoad): an outpost makes no scrap, and without them it lived on the hub's water runs for good (census
// seed 3, aggressive: the old holdout's two wells stood broken from day 303, 0 scrap there and 101 at the hub).
{
  console.log("--- the governor mends an outpost's well ---");
  const state = createWorld({ seed: 42, factionCount: 6 });
  state.started = true;
  const h = hub(state);
  const tO = freeTile(state, h.tile, 3, 6);
  if (check(tO, "could not place the outpost")) {
    const people = atBase(state, h.id).filter((s) => !s.leader);
    const O = makeOutpost(state, tO.id, "Test Outpost W", people.slice(0, 2));
    for (const s of people) s.health = 100;
    addBuilding(O, "well");
    O.stock.scrap = 0; O.stock.parts = 0;
    h.stock.scrap = 60; h.stock.parts = 6; setFood(h, Math.max(food(h) || 0, 80));
    setAutopilot(state, true, "balanced");
    const well = O.buildings.find((b) => b.type === "well");
    breakFixture(state, O, well, "test");
    check(!!well.broken && !(O.repairs || []).length, "test setup: the well should be broken with no repair started (no scrap there)");
    autopilotDaily(state);
    const run = supplyRuns(state).find((j) => j.destId === O.id && j.apMade && jobParty(state, j));
    const scrapOut = run ? (run.deliver.find((l) => l.key === "scrap") || {}).qty || 0 : 0;
    const partsOut = run ? (run.deliver.find((l) => l.key === "parts") || {}).qty || 0 : 0;
    check(!!run && scrapOut >= 3 && partsOut >= 1, `no supply run with a repair's scrap and part for the broken well (${run ? JSON.stringify(run.deliver) : "no run"})`);
    for (let k = 0; k < 24 * 4 && well.broken; k++) { tickHour(state); resolveCards(state); }
    check(!well.broken, "the outpost's well was not mended within 4 days of the delivery");
    console.log(`  delivered ${scrapOut} scrap, ${partsOut} parts; the well is ${well.broken ? "still broken" : `mended${well.rigged ? " (jury-rigged)" : ""}`}`);
  }
}
console.log(fails ? `${fails} check(s) failed.` : `All checks passed on ${summary.length} seed(s).`);
process.exit(fails ? 1 : 0);
