// Vehicle upgrades (sim/vehicles.js, weapons overhaul plan section 11): bulletproof glass, mesh grilles, armour plate,
// scrap plating, the military pre-fits and a military group's motor pool. Checks:
//   - costs (car parts fall back to parts until the part kinds exist), skill gates, the shop (a garage or a workbench,
//     a bench for scrap plating), the garage job (materials when queued, crafters' hours, cancel refunds)
//   - weights: upgradeKg off the payload (vehicleCapacity, load.js teamLoad), fuel ×1.15 / speed ×0.95 a plating level
//   - breakdowns ×0.8 a level; wear ×0.6 a level (blasts, ramming); mesh halves ramming the dead
//   - riders: glass ×0.35 / ×0.8 / ×1 by pen (riderMult, riderHitMult from a weapon or a typed round); a grenade next to
//     the vehicle hurts the riders less behind glass and never drops them
//   - cover: a plated car is full cover; platedCell
//   - by the numbers: an ambush on a glassed vehicle ×0.85 (mesh: the dead only); a turret +6 for the side it fights on
//   - pre-fitted: a claimed Army vehicle is plated and glassed; a National Guard motor pool always has a running cargo
//     truck and a turreted Humvee, guarded, claimable; raider technicals half plated (own dice)
//   - a military group starts with a cargo truck and a turreted Humvee (f.vehicles, not state.vehicles); it adds to their
//     raids, their home base's defence and fights against them by the numbers
//   - strip refunds (half the car parts, the glass whole: a spare set fitted again for free); value; save round-trip
//   - drawing: the sprites with upgrades (stub canvases)
// Usage: node tools/vehupgradetest.js [seed = 7]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { SUPPLIES } from "../src/sim/data.js";
import {
  VEH_UPGRADES, costOf, upgradeCost, upgradesOf, upgradeKg, payloadOf, vehicleCapacity, typeFuel, typeSpeed, breakdownChance, wearMult, riderMult,
  ambushMult, queueUpgrade, cancelGarageJob, garageHour, garageQueue, upgradeProblem, upgradeOptions, finishUpgrade, stripRefund, createVehicle,
  vehicleValue, factionVehicles, groupTurret, groupTurretPower, isTechnical, fitTechnical, fitMilitary, TURRET_ODDS, upgradeText, armourOf,
  raidHumvee, raidTurretPower, factionVehiclesDaily, HUMVEE,
} from "../src/sim/vehicles.js";
import { spawnAiParty } from "../src/sim/parties.js";
import { resolveRaidOnPlayer, resolveRaidOnFaction } from "../src/sim/factions.js";
import { defendInPerson } from "../src/sim/conflicts.js";
import { finishCombat, combatAct, damage, shotOdds, ammoLeft, turretRounds, active, gunnerOf, TURRET, WEAPONS, autoPlayerTurn, runEnemyPhase, magIn, canSee } from "../src/sim/combat.js";
import { carOptions } from "../src/sim/foundcars.js";
import { captureBase } from "../src/sim/conquest.js";
import { teamLoad } from "../src/sim/load.js";
import { createBattle, registerCombatHandler, byNumbersOdds, riderHitMult, vehicleBlast, coverAgainst, platedCell, driveTo, CELL, BLAST_WEAR } from "../src/sim/combat.js";
import { FRAG } from "../src/sim/throwables.js";
import { trucksAt, MILTRUCK } from "../src/sim/miltrucks.js";
import { carRecord, claimCar, runs } from "../src/sim/foundcars.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import { assaultForce, assaultOdds } from "../src/sim/conquest.js";
import { serializeState, deserializeState } from "../src/sim/save.js";

const SEED = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
registerCombatHandler("vut", () => {});
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };
const addBuilding = (b, type) => b.buildings.push({ id: 90000 + b.buildings.length, type, progress: 1, done: true });
function team(st, tile, n = 3, vehicleId = null) {
  const h = hub(st);
  const res = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, n).map((s) => s.id), dest: tile, mission: "move", stance: "normal", vehicleId, supplies: { food: 6, water: 6, fuel: vehicleId ? 4 : 0 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.phase = "waiting"; p.dest = tile;
  return p;
}
const raidSetup = (st, tile, p) => ({ mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "vut", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(st, tile) }, raid: { heat0: 5 }, context: {} });
const fieldSetup = (tile, p, extra = {}) => ({ tile, partyId: p.id, enemy: { kind: "zombies", count: 3, power: 3 }, ambush: null, canRetreat: true, handler: "vut", context: {}, ...extra });
const isBuilt = (b) => b.buildings.find((x) => x.type === "garage");

// ---------------------------------------------------------------------------------------------------------------
section("Costs, skill gates, the shop, the garage job");
{
  check(costOf("carparts") === (SUPPLIES.carparts ? "carparts" : "parts") && costOf("parts") === "parts" && costOf("scrap") === "scrap", `costOf: car parts are "${costOf("carparts")}" (parts until the part kinds exist)`);
  const g = upgradeCost("glass"), pl = upgradeCost("plating");
  if (!SUPPLIES.carparts) check(g.parts === 4 && g.scrap === 12 && pl.parts === 8 && pl.scrap === 40, `glass ${JSON.stringify(g)}, plating ${JSON.stringify(pl)} (car parts 6 + machine parts 2 merge)`);
  SUPPLIES.carparts = { name: "Car parts", value: 7, weight: 3, cat: "vehicle" }; // as after the part kinds split (plan section 10)
  const g2 = upgradeCost("glass"), pl2 = upgradeCost("plating");
  check(g2.carparts === 4 && !g2.parts && pl2.carparts === 6 && pl2.parts === 2, `after the split: glass ${JSON.stringify(g2)}, plating ${JSON.stringify(pl2)}`);
  delete SUPPLIES.carparts;
  check(VEH_UPGRADES.glass.hours === 16 && VEH_UPGRADES.glass.mech === 5 && VEH_UPGRADES.glass.kg === 90 && VEH_UPGRADES.plating.hours === 24 && VEH_UPGRADES.plating.mech === 6 && VEH_UPGRADES.plating.kg === 180 && VEH_UPGRADES.mesh.kg === 30 && VEH_UPGRADES.scrapPlate.kg === 230, "section 11's hours and Mechanics; weights glass 90, plate 180 a level, grilles 30, scrap plating 230");
  check(VEH_UPGRADES.scrapPlate.mech === 3 && VEH_UPGRADES.scrapPlate.max === 1 && VEH_UPGRADES.scrapPlate.kg / VEH_UPGRADES.scrapPlate.armour > VEH_UPGRADES.plating.kg / VEH_UPGRADES.plating.armour, "scrap plating: one level, Mechanics 3, heavier per protection");

  const st = createWorld({ seed: SEED, factionCount: 3 });
  const h = hub(st);
  const v = st.vehicles.find((x) => x.type === "truck" && x.loc.kind === "base");
  const people = atBase(st, h.id);
  for (const s of people) { s.skills.mechanics = 1; s.role = "farm"; }
  h.buildings = h.buildings.filter((b) => b.type !== "garage" && !["craftbench", "workbench", "toolbench"].includes(b.type));
  h.stock.parts = 40; h.stock.scrap = 200;
  check(/Mechanics 5/.test(upgradeProblem(st, h, v, "glass")), `glass gated: "${upgradeProblem(st, h, v, "glass")}"`);
  people[0].skills.mechanics = 6;
  check(/garage or a workbench/.test(upgradeProblem(st, h, v, "glass")), `glass needs a garage or a workbench: "${upgradeProblem(st, h, v, "glass")}"`);
  check(/bench/.test(upgradeProblem(st, h, v, "scrapPlate")), "scrap plating needs a bench (or a garage)");
  check(upgradeProblem(st, h, v, "mesh") === "", "mesh grilles: anywhere at a base");
  addBuilding(h, "workbench");
  check(upgradeProblem(st, h, v, "glass") === "" && upgradeProblem(st, h, v, "plating") === "", "a workbench will do for glass and plate when there is no garage");
  h.buildings = h.buildings.filter((b) => b.type !== "workbench");
  addBuilding(h, "garage");
  check(isBuilt(h) && upgradeProblem(st, h, v, "glass") === "", "with a garage and a Mechanics 6 survivor glass can be fitted");
  people[0].skills.mechanics = 5;
  check(/Mechanics 6/.test(upgradeProblem(st, h, v, "plating")), "armour plate needs Mechanics 6");
  people[0].skills.mechanics = 6;
  const parts0 = h.stock.parts, scrap0 = h.stock.scrap;
  const msg = queueUpgrade(st, h, v, "glass");
  check(garageQueue(h).length === 1 && h.stock.parts === parts0 - 4 && h.stock.scrap === scrap0 - 12, `queued, materials paid: ${msg}`);
  check(/Already in the garage/.test(upgradeProblem(st, h, v, "plating")), "one job per vehicle at a time");
  // Cancel untouched: everything back.
  cancelGarageJob(st, h, garageQueue(h)[0].id);
  check(h.stock.parts === parts0 && h.stock.scrap === scrap0 && !garageQueue(h).length, "cancelled untouched: all the materials back");
  queueUpgrade(st, h, v, "glass");
  for (let i = 0; i < 5; i++) garageHour(st);
  check(garageQueue(h)[0].progress === 0, "nobody on the Craft role: the job waits");
  people[0].role = "craft";
  let hours = 0;
  while (garageQueue(h).length && hours < 40) { garageHour(st); hours++; }
  check(upgradesOf(v).glass === 1 && hours >= 13 && hours <= 16, `one Mechanics 6 crafter fits the glass in ${hours}h (16 work-hours, +3% a point)`);
  queueUpgrade(st, h, v, "plating"); hours = 0;
  while (garageQueue(h).length && hours < 60) { garageHour(st); hours++; }
  queueUpgrade(st, h, v, "plating");
  while (garageQueue(h).length && hours < 120) { garageHour(st); hours++; }
  check(upgradesOf(v).plating === 2 && /most/.test(upgradeProblem(st, h, v, "plating")), "two levels of plate, no third");
  check(/Take the bulletproof glass off first/.test(upgradeProblem(st, h, v, "mesh")) && /armour plate off first/.test(upgradeProblem(st, h, v, "scrapPlate")), "glass or grilles, plate or scrap plating: one of each");
  check(/not yet usable|later/.test(upgradeProblem(st, h, v, "turret")), "no turrets yet");
  check(upgradeOptions(st, h, v).some((o) => o.op === "strip" && o.key === "glass") && upgradeText(v) === "Bulletproof glass, armour plate ×2", `the details line: "${upgradeText(v)}"`);
  const bike = createVehicle(st, "bike", { kind: "base", baseId: h.id }, { count: 2 });
  check(/Only cars/.test(upgradeProblem(st, h, bike, "mesh")), "bikes take no upgrades");
  v.loc = { kind: "abandoned", tile: h.tile, since: 0 };
  check(/Park it/.test(upgradeProblem(st, h, v, "mesh")), "only a vehicle parked at this base");
}

// ---------------------------------------------------------------------------------------------------------------
section("Weight, fuel, speed, breakdowns, wear");
{
  const st = createWorld({ seed: SEED, factionCount: 3 });
  const h = hub(st);
  const v = createVehicle(st, "truck", { kind: "base", baseId: h.id }, { fuel: 20, condition: 60 });
  const base = { cap: vehicleCapacity(v), fuel: typeFuel(v), speed: typeSpeed(v), brk: breakdownChance(v, 0.5) };
  const people = atBase(st, h.id).slice(0, 3);
  const t0 = teamLoad(people, 100, v);
  v.upgrades = { glass: 1, plating: 1 };
  check(upgradeKg(v) === 270 && payloadOf(v) === 650 - 270 && vehicleCapacity(v) === 380, `glass + plate: +${upgradeKg(v)} kg, payload ${payloadOf(v)} (vehicleCapacity ${vehicleCapacity(v)})`);
  const t1 = teamLoad(people, 100, v);
  check(t1.payload === 380 && t1.fill > t0.fill && t1.capacity < t0.capacity, `load.js teamLoad: payload ${t0.payload} → ${t1.payload}, fill ${t0.fill} → ${t1.fill}, capacity ${Math.round(t0.capacity)} → ${Math.round(t1.capacity)}`);
  check(near(typeFuel(v), base.fuel * 1.15) && near(typeSpeed(v), base.speed * 0.95), `plating 1: fuel ×${typeFuel(v).toFixed(3)}, speed ×${typeSpeed(v).toFixed(3)}`);
  check(t1.fuelMult >= Math.round(t0.fuelMult * 1.15 * 100) / 100 - 0.01, `the trip's fuel multiplier carries it (${t0.fuelMult} → ${t1.fuelMult})`);
  check(near(breakdownChance(v, 0.5), base.brk * 0.8) && near(wearMult(v), 0.6), "breakdowns ×0.8, wear ×0.6 at level 1");
  v.upgrades = { glass: 1, plating: 2 };
  check(upgradeKg(v) === 450 && payloadOf(v) === 200, `the full kit on a pickup (glass + plate ×2) weighs ${upgradeKg(v)} kg (payload ${payloadOf(v)})`);
  v.upgrades = { plating: 2 };
  check(near(typeFuel(v), 1.15 ** 2) && near(typeSpeed(v), 0.95 ** 2) && near(breakdownChance(v, 0.5), base.brk * 0.64) && near(wearMult(v), 0.36), "level 2: fuel ×1.32, speed ×0.90, breakdowns ×0.64, wear ×0.36");
  v.upgrades = { scrapPlate: 1 };
  check(near(armourOf(v), 0.5) && payloadOf(v) === 420 && near(typeFuel(v), 1.18) && breakdownChance(v, 0.5) < base.brk, "scrap plating: half a level of armour, +230 kg, fuel ×1.18");
  const mt = createVehicle(st, "miltruck", { kind: "base", baseId: h.id }, {});
  const f0 = typeFuel(mt), s0 = typeSpeed(mt);
  fitMilitary(mt);
  check(near(typeFuel(mt), f0 * 1.15) && near(typeSpeed(mt), s0 * 0.95) && payloadOf(mt) === 2500 - 270, "the Army truck's own ×2 fuel and ×0.67 speed stack with its plate");
  const old = createVehicle(st, "sedan", { kind: "base", baseId: h.id }, {});
  check(old.upgrades === undefined && upgradeKg(old) === 0 && payloadOf(old) === 400 && armourOf(old) === 0 && typeFuel(old) === 1 && wearMult(old) === 1, "a vehicle with no upgrades record (old saves) is unchanged");
}

// ---------------------------------------------------------------------------------------------------------------
section("Riders, blasts, cover, ramming (combat.js)");
{
  check(riderMult({ upgrades: { glass: 1 } }, 15) === 0.35 && riderMult({ upgrades: { glass: 1 } }, 30) === 0.35 && riderMult({ upgrades: { glass: 1 } }, 38) === 0.8 && riderMult({ upgrades: { glass: 1 } }, 45) === 0.8 && riderMult({ upgrades: { glass: 1 } }, 55) === 1 && riderMult({ upgrades: { glass: 1 } }, 70) === 1, "glass: ×0.35 to pen 30, ×0.8 to pen 45, full above");
  check(riderMult({ upgrades: { mesh: 1 } }, 15) === 1 && riderMult({}, 15) === 1, "grilles and bare windows stop no bullets");
  const st = createWorld({ seed: SEED, factionCount: 3 });
  const h = hub(st);
  const v = st.vehicles.find((x) => x.type === "truck");
  const tile = st.tiles.find((t) => t.road && !t.loc && t.terrain === "plains" && !st.bases.some((b) => b.tile === t.id)) || st.tiles.find((t) => t.terrain === "plains" && !t.loc);
  const p = team(st, tile.id, 3, v.id);
  v.upgrades = { glass: 1 };
  const b = inBrowser(() => createBattle(st, fieldSetup(tile.id, p)));
  check(!!b.vehicle && b.vehicle.up && b.vehicle.up.glass === 1, "the team's vehicle on the map carries its upgrades (fitMapVehicle)");
  check(riderHitMult(b, { weapon: "pistol" }) === 0.35 && riderHitMult(b, { weapon: "huntrifle" }) === 0.8 && riderHitMult(b, { cal: "308", ammo: "ap" }) === 1 && riderHitMult(b, { cal: "556", ammo: "fmj" }) === 0.35 && riderHitMult(b, {}) === 0.35, "riderHitMult: a 9mm ×0.35, a .308 ×0.8, .308 AP full, typed 5.56 ×0.35, unknown (pen 25) ×0.35");
  // A grenade next to the vehicle with people aboard.
  const blastRun = (ups) => {
    const st2 = createWorld({ seed: SEED, factionCount: 3 });
    const v2 = st2.vehicles.find((x) => x.type === "truck");
    v2.upgrades = ups;
    const p2 = team(st2, tile.id, 3, v2.id);
    const b2 = inBrowser(() => createBattle(st2, fieldSetup(tile.id, p2)));
    const riders = b2.units.filter((u) => u.side === "player").slice(0, 2);
    for (const u of riders) { u.aboard = true; u.off = true; u.x = b2.vehicle.x; u.y = b2.vehicle.y; }
    const hp0 = riders.reduce((a, u) => a + u.hp, 0);
    let text = "";
    for (let i = 0; i < 3; i++) text = vehicleBlast(b2, b2.vehicle.x + b2.vehicle.w, b2.vehicle.y, FRAG.r, FRAG.dmg, "frag");
    return { lost: hp0 - riders.reduce((a, u) => a + u.hp, 0), wear: b2.vehicle.wear, down: riders.some((u) => u.hp < 1 || u.down), text, far: vehicleBlast(b2, b2.vehicle.x + b2.vehicle.w + 6, b2.vehicle.y + 6, FRAG.r, FRAG.dmg, "frag") };
  };
  const bare = blastRun({}), glass = blastRun({ glass: 1 }), plate = blastRun({ plating: 1 }), plate2 = blastRun({ plating: 2 }), mesh = blastRun({ mesh: 1 });
  console.log(`    three grenades by the vehicle: riders lose ${bare.lost} hp (bare), ${mesh.lost} (grilles), ${glass.lost} (glass); vehicle wear ${bare.wear} / ${plate.wear} / ${plate2.wear} (plate 0 / 1 / 2)`);
  check(bare.lost > 0 && glass.lost < bare.lost * 0.6 && mesh.lost < bare.lost && !bare.down && !glass.down, "riders: glass stops most of the fragments, grilles some; nobody is dropped inside");
  check(near(bare.wear, 3 * BLAST_WEAR.frag) && near(plate.wear, 3 * Math.round(BLAST_WEAR.frag * 0.6 * 10) / 10) && plate2.wear < plate.wear, "blast wear ×0.6 a plating level");
  check(bare.far === "" && /takes the blast/.test(bare.text), "a blast away from the vehicle does nothing to it");
  // Cover: a plated car is full cover.
  let coverOk = false;
  for (let i = 0; i < b.cells.length && !coverOk; i++) {
    const c = b.cells[i];
    if (c.k !== "car" || !c.car) continue;
    const x = i % b.w, y = (i / b.w) | 0;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const ux = x + dx, uy = y + dy, ax = x - dx * 6, ay = y - dy * 6;
      if (ux < 0 || uy < 0 || ux >= b.w || uy >= b.h || ax < 0 || ay < 0 || ax >= b.w || ay >= b.h || !CELL[b.cells[uy * b.w + ux].k].walk) continue;
      const before = coverAgainst(b, ux, uy, ax, ay).level;
      c.car.up = { p: 1, s: 0, g: 0, m: 0, t: null };
      const after = coverAgainst(b, ux, uy, ax, ay).level;
      if (before === 1 && after === 2 && platedCell(b, x, y) === 1) coverOk = true;
      delete c.car.up;
      if (coverOk) break;
    }
  }
  check(coverOk, "a car with plate on it is full cover (half without); platedCell says so");
  // Ramming: crates in the way, with and without plate.
  const ramRun = (ups, k = "crate") => {
    const st2 = createWorld({ seed: SEED, factionCount: 3 });
    const v2 = st2.vehicles.find((x) => x.type === "truck");
    v2.upgrades = ups;
    const p2 = team(st2, tile.id, 3, v2.id);
    const b2 = inBrowser(() => createBattle(st2, fieldSetup(tile.id, p2)));
    for (const u of b2.units) if (u.side === "enemy") u.dead = true;
    const bv = b2.vehicle, u = b2.units.find((x) => x.side === "player");
    u.aboard = true; u.off = true; u.ap = 2;
    const vert = bv.ax === "y";
    // Two cells ahead of it on its axis: crates (or the dead) right across its width.
    const cells = [];
    for (let s = 0; s < 2; s++) for (let w = 0; w < 2; w++) cells.push(vert ? [bv.x + w, bv.y + bv.h + s] : [bv.x + bv.w + s, bv.y + w]);
    if (!cells.every(([x, y]) => x < b2.w && y < b2.h && b2.cells[y * b2.w + x].k === "open")) return null;
    if (k === "crate") for (const [x, y] of cells) b2.cells[y * b2.w + x].k = "crate";
    const err = driveTo(b2, u, vert ? bv.x : bv.x + bv.w + 1, vert ? bv.y + bv.h + 1 : bv.y);
    return err ? null : bv.wear || 0;
  };
  const r0 = ramRun({}), r1 = ramRun({ plating: 1 });
  console.log(`    ramming crates: wear ${r0} bare, ${r1} with plate`);
  check(r0 != null && r1 != null && r0 > 0 && near(r1, Math.round(r0 * 0.6 * 10) / 10), "ramming wear ×0.6 with a level of plate");
}

// ---------------------------------------------------------------------------------------------------------------
section("By the numbers: ambushes and turrets (byNumbersOdds)");
{
  const st = createWorld({ seed: SEED, factionCount: 3 });
  const v = st.vehicles.find((x) => x.type === "truck");
  const tile = st.tiles.find((t) => t.road && !t.loc && !st.bases.some((b) => b.tile === t.id));
  const p = team(st, tile.id, 3, v.id);
  const people = partyMembers(st, p);
  const setup = (kind, ambush, extra = {}) => ({ tile: tile.id, partyId: p.id, enemy: { kind, count: 4, power: 3, ...extra }, ambush, handler: "vut", context: {} });
  const th = (s) => byNumbersOdds(st, s, people).theirs;
  const plain = th(setup("raiders", "enemy"));
  v.upgrades = { glass: 1 };
  const glassed = th(setup("raiders", "enemy"));
  check(near(glassed / plain, 0.85), `an ambush on the road on a glassed vehicle: their side ×${(glassed / plain).toFixed(3)}`);
  check(near(th(setup("raiders", null)), 12) && near(th(setup("raiders", "player")), 12), "no ambush (or yours): glass changes nothing");
  v.upgrades = { mesh: 1 };
  check(near(th(setup("raiders", "enemy")), plain) && near(th(setup("zombies", "enemy")) / plain, 0.85), "grilles: only the dead's ambush is blunted");
  check(ambushMult(v, "zombies") === 0.85 && ambushMult(null, "zombies") === 1, "ambushMult");
  v.upgrades = {};
  check(near(th(setup("raiders", null, { turret: "m2hb" })) - th(setup("raiders", null)), TURRET_ODDS.m2hb) && TURRET_ODDS.m2hb === 6 && TURRET_ODDS.lmg === 4, "their turret: +6 (M2), +4 (LMG)");
}

// ---------------------------------------------------------------------------------------------------------------
section("Pre-fitted: claimed Army vehicles, the National Guard motor pool, raider technicals");
{
  let pools = 0, poolOk = 0, claimedOk = 0, guarded = 0, humvee = null, truck = null;
  for (let i = 0; i < 6 && claimedOk < 2; i++) {
    const st = createWorld({ seed: SEED * 100 + i, factionCount: 7 });
    const tile = (st.militaryIds || [])[0];
    if (tile == null) continue;
    pools++;
    const list = trucksAt(st, tile);
    if (list[0] && list[0].kind === "cargo" && list[0].runs && list[1] && list[1].kind === "humvee" && list[1].turret === "m2hb" && list[1].runs && list.every((x, j) => j < 2 || !x.runs)) poolOk++;
    const p = team(st, tile, 3);
    const b = inBrowser(() => createBattle(st, raidSetup(st, tile, p)));
    const area = b.raid.areas.find((a) => a.trucks);
    if (area && area.trucks.filter((t) => t.guard).length === 2) {
      const soldiers = b.units.filter((u) => u.ztype === "soldier").length;
      if (soldiers >= 2 * (MILTRUCK.AROUND[0] + MILTRUCK.GUARD)) guarded++;
    }
    const ids = [...new Set(b.cells.filter((c) => c.car && c.car.mil && c.car.mil.runs).map((c) => c.car.id))];
    for (const id of ids) {
      const rec = carRecord(st, b, id);
      rec.open = true; rec.inspected = true;
      if (!runs(rec)) continue;
      const v = claimCar(st, b, rec);
      const u = upgradesOf(v);
      if (v && u.plating === 1 && u.glass === 1) {
        claimedOk++;
        if (v.type === "hummer") humvee = v; else truck = v;
      }
    }
    if (humvee) {
      const again = trucksAt(st, tile);
      check(!again.some((x) => x.i === 1), "a claimed motor-pool vehicle is gone from the base's maps");
      const blob = serializeState(st);
      const st2 = deserializeState(blob);
      const h2 = st2.vehicles.find((x) => x.id === humvee.id);
      check(h2 && upgradesOf(h2).turret && upgradesOf(h2).turret.gun === "m2hb" && /M2 turret \(not yet usable\)/.test(upgradeText(h2)), `the claimed Humvee keeps its M2 through a save ("${upgradeText(h2)}")`);
    }
  }
  check(pools > 0 && poolOk === pools, `every National Guard motor pool (${poolOk}/${pools}) has a running cargo truck and a Humvee with an M2, and only those two are ready`);
  check(guarded > 0, `the ready vehicles are guarded (more dead soldiers round them: ${guarded} maps)`);
  check(claimedOk >= 2 && humvee && humvee.type === "hummer" && upgradesOf(humvee).turret && truck && truck.type === "miltruck" && !upgradesOf(truck).turret, "claimed: both run, plated and glassed; the Humvee has its M2, the truck no turret");
  // Technicals.
  const st = createWorld({ seed: SEED, factionCount: 7 });
  const raider = st.factions.find((f) => f.type === "raider"), other = st.factions.find((f) => f.type !== "raider");
  let tech = 0, n = 400;
  for (let i = 0; i < n; i++) if (isTechnical(st, raider.id, "truck", i)) tech++;
  check(tech / n > 0.4 && tech / n < 0.6, `raider pickups: ${Math.round((100 * tech) / n)}% are plated technicals`);
  check(![...Array(50).keys()].some((i) => isTechnical(st, raider.id, "sedan", i) || (other && isTechnical(st, other.id, "truck", i))), "only raiders' pickups");
  const salt = [...Array(50).keys()].find((i) => isTechnical(st, raider.id, "truck", i));
  const rng0 = JSON.stringify(st.rng.state ?? st.rng);
  const tv = createVehicle(st, "truck", { kind: "abandoned", tile: 0, since: 0 }, {});
  check(fitTechnical(st, tv, raider.id, salt) && upgradesOf(tv).scrapPlate === 1 && JSON.stringify(st.rng.state ?? st.rng) === rng0, "their technical left on the field keeps its scrap plating (own dice: the world's untouched)");
}

// ---------------------------------------------------------------------------------------------------------------
section("A military group's motor pool (factions.js f.vehicles)");
{
  let st = null, f = null;
  for (let i = 0; i < 30 && !f; i++) { st = createWorld({ seed: SEED + i * 13, factionCount: 3 }); f = st.factions.find((x) => x.type === "military"); }
  check(!!f, "a world with a Military remnant");
  if (f) {
    const vs = f.vehicles || [];
    const hv = vs.find((v) => v.type === "hummer"), mt = vs.find((v) => v.type === "miltruck");
    check(vs.length === 2 && hv && mt && upgradesOf(hv).turret && upgradesOf(hv).turret.gun === "m2hb" && upgradesOf(mt).plating === 1 && upgradesOf(hv).glass === 1, "it starts with an Army truck and a Humvee with an M2, plated and glassed");
    check(!st.vehicles.some((v) => vs.includes(v) || String(v.id).startsWith("f")), "their vehicles are not in state.vehicles (nothing takes them for yours)");
    check(groupTurret(f) === "m2hb" && groupTurretPower(f) === 6, "groupTurret: the M2 (+6 by the numbers)");
    const other = st.factions.find((x) => x.type !== "military");
    check(factionVehicles(other).length === 0 && groupTurretPower(other) === 0, "other groups have none");
    const force = assaultForce(st, f, f.bases[0]);
    const force2 = { ...force };
    delete force2.turret;
    check(force.turret === "m2hb" && assaultOdds(100, force) < assaultOdds(100, force2), "an assault on their home base meets the Humvee (worse odds)");
    // Old saves: a military group without f.vehicles gets its pool when first read.
    delete f.vehicles;
    const st2 = deserializeState(serializeState(st));
    const f2 = st2.factions.find((x) => x.id === f.id);
    check(groupTurret(f2) === "m2hb" && f2.vehicles.length === 2, "an old save's military group gets its motor pool");
    hv.condition = 0; f.vehicles = [mt, hv];
    check(groupTurret(f) === null, "a wrecked Humvee adds nothing");
  }
}

// ---------------------------------------------------------------------------------------------------------------
section("The Humvee on raids: lost when a raid fails, replaced slowly, seized with their base");
{
  const milWorld = (salt) => { for (let i = 0; i < 40; i++) { const st = createWorld({ seed: SEED + salt + i * 17, factionCount: 3 }); const f = st.factions.find((x) => x.type === "military"); if (f) return { st, f }; } return {}; };
  const raidOn = (st, f, strength = 1) => { const h = hub(st); return spawnAiParty(st, f, "raid", f.bases[0], h.tile, { strength, target: { kind: "player", baseId: h.id, tile: h.tile } }); };
  // By the numbers: beaten off at the walls.
  {
    const { st, f } = milWorld(1);
    const h = hub(st);
    const p = raidOn(st, f);
    check(p && raidHumvee(st, p) && raidTurretPower(st, p) === 6, "a military group's raid brings its Humvee (+6 by the numbers)");
    const p2 = raidOn(st, f);
    check(p2 && !raidHumvee(st, p2), "one Humvee, one raid at a time");
    const n0 = st.vehicles.length;
    const res = resolveRaidOnPlayer(st, p);
    const hv = st.vehicles.find((v) => v.type === "hummer" && v.loc.kind === "base" && v.loc.baseId === h.id);
    check(res.outcome === "held" && hv && st.vehicles.length === n0 + 1, `held at the walls: their Humvee is left at ${h.name} ("${(res.text.match(/left their[^.]*\./) || [""])[0]}")`);
    check(hv && upgradesOf(hv).turret && upgradesOf(hv).turret.gun === "m2hb" && upgradesOf(hv).plating === 1 && upgradesOf(hv).glass === 1 && hv.condition >= HUMVEE.LEFT_COND[0] && hv.condition <= HUMVEE.LEFT_COND[1], `it keeps its M2, plate and glass, damaged (condition ${hv && hv.condition}%)`);
    check(!f.vehicles.some((v) => v.type === "hummer") && groupTurret(f) === null && groupTurretPower(f) === 0 && f.vehicles.some((v) => v.type === "miltruck"), "the group lost it (no turret bonus now); it keeps its cargo truck");
    check(!raidHumvee(st, raidOn(st, f)), "their next raid comes without one");
    // Replacement: 60–90 days, while they are still strong.
    f.pop = HUMVEE.MIN_POP + 5;
    st.hour += 59 * 24; factionVehiclesDaily(st);
    check(groupTurret(f) === null, "no new Humvee within 59 days");
    f.pop = HUMVEE.MIN_POP - 1;
    st.hour += 40 * 24; factionVehiclesDaily(st);
    check(groupTurret(f) === null, "nor when the group is weak");
    f.pop = HUMVEE.MIN_POP + 5;
    factionVehiclesDaily(st);
    check(groupTurret(f) === "m2hb", "after 60–90 days a strong group has a new one");
    st.cards = [];
    const st2 = deserializeState(serializeState(st));
    check(st2.vehicles.some((v) => v.type === "hummer" && upgradesOf(v).turret) && groupTurret(st2.factions.find((x) => x.id === f.id)) === "m2hb", "save / load: the taken Humvee and their new one");
  }
  // Against another group.
  {
    const { st, f } = milWorld(2);
    const g = st.factions.find((x) => x.alive && x !== f && x.bases.length);
    const p = spawnAiParty(st, f, "raid", f.bases[0], g.bases[0], { strength: 1, target: { kind: "faction", factionId: g.id, tile: g.bases[0] } });
    check(p && raidHumvee(st, p), "a raid on another group brings it too");
    resolveRaidOnFaction(st, p, []);
    check(!f.vehicles.some((v) => v.type === "hummer") && (g.vehicles || []).some((v) => v.type === "hummer" && upgradesOf(v).turret) && groupTurret(g) === "m2hb", `held off by ${g.type}: they take it (their turret now)`);
    const q = spawnAiParty(st, g, "raid", g.bases[0], f.bases[0], { strength: 1, target: { kind: "faction", factionId: f.id, tile: f.bases[0] } });
    check(q && raidHumvee(st, q), "and bring it on their own raids");
  }
  // In person: the defence map shows it; won, it is yours.
  {
    const { st, f } = milWorld(3);
    const h = hub(st);
    const p = raidOn(st, f, 20);
    inBrowser(() => defendInPerson(st, p));
    const b = st.combat;
    const cells = b ? b.cells.filter((c) => c.car && c.car.mil && c.car.mil.enemy) : [];
    check(b && b.setup.enemy.turret === "m2hb" && b.raidHumvee && cells.length === 6 && cells.every((c) => c.car.body === "humvee" && c.car.up && c.car.up.t === "m2hb"), "fought in person: their Humvee stands on the defence map, the M2 on its roof");
    if (b && cells.length) {
      const id = cells[0].car.id;
      const rec = carRecord(st, b, id);
      rec.open = true; rec.inspected = true;
      const u = b.units.find((x) => x.side === "player");
      check(!carOptions(st, b, u, rec).claim.ok, "it cannot be claimed during the fight");
    }
    const cards0 = st.cards.length;
    finishCombat(st, b.setup, { outcome: "victory", enemiesKilled: 4, enemiesLeft: 0, survivorsHurt: [], survivorsDead: [], turns: 6, loot: { supplies: {}, gear: [] } });
    const hv = st.vehicles.find((v) => v.type === "hummer" && v.loc.kind === "base" && v.loc.baseId === h.id);
    const card = st.cards.slice(cards0).find((c) => /Raid defense/.test(c.title));
    check(hv && upgradesOf(hv).turret && !f.vehicles.some((v) => v.type === "hummer") && card && /left their Humvee/.test(card.text), `beaten off in person: the Humvee is the base's, with a card ("${card ? (card.text.match(/left their[^.]*\./) || [""])[0] : ""}")`);
  }
  // Their base taken: the motor pool is yours.
  {
    const { st, f } = milWorld(4);
    const n0 = st.vehicles.length;
    const text = captureBase(st, f, f.bases[0], null, { people: 4 });
    const got = st.vehicles.slice(n0);
    check(got.length === 2 && got.some((v) => v.type === "hummer" && upgradesOf(v).turret) && got.some((v) => v.type === "miltruck" && upgradesOf(v).plating === 1) && got.every((v) => v.loc.kind === "base") && !(f.vehicles || []).length && /motor pool is yours/.test(text), "taking their home base: the Army truck and the Humvee are yours");
  }
}

// ---------------------------------------------------------------------------------------------------------------
section("The turret in battle: the gunner (combat.js manTurret, turret_m2)");
{
  check(WEAPONS.turret_m2 && WEAPONS.turret_m2.dmg[0] === 40 && WEAPONS.turret_m2.dmg[1] === 58 && WEAPONS.turret_m2.opt === 14 && WEAPONS.turret_m2.fall === 1.5 && WEAPONS.turret_m2.aim === 6 && WEAPONS.turret_m2.noise === 6 && WEAPONS.turret_m2.cap === 100 && WEAPONS.turret_m2.ammo === 3 && WEAPONS.turret_m2.pierce === 1 && WEAPONS.turret_lmg, "turret_m2: 40–58, opt 14, fall 1.5, aim +6, noise 6, a 100-round belt, 3-round bursts, pierce 1 (and turret_lmg)");
  const st = createWorld({ seed: SEED, factionCount: 3 });
  const h = hub(st);
  const v = createVehicle(st, "hummer", { kind: "base", baseId: h.id }, { fuel: 30, condition: 80 });
  fitMilitary(v, "m2hb");
  const tile = st.tiles.find((t) => t.terrain === "plains" && !t.loc && !st.bases.some((b) => b.tile === t.id));
  const p = team(st, tile.id, 3, v.id);
  p.supplies.ammo = 60;
  p.supplies.a_50bmg_ball = 60; // the M2's belt: .50 BMG (ammo.js rounds by calibre; turretRounds)
  const b = inBrowser(() => createBattle(st, fieldSetup(tile.id, p, { enemy: { kind: "raiders", count: 3, power: 3 } })));
  st.combat = b;
  b.phase = "player";
  const [g, r2] = b.units.filter((u) => u.side === "player");
  for (const u of [g, r2]) { u.aboard = true; u.off = true; u.x = b.vehicle.x; u.y = b.vehicle.y; u.ow = false; u.ap = 2; }
  const gun0 = g.weapon, load0 = g.load;
  const err = combatAct(st, { type: "gunner", unit: g.id });
  check(g.load === "ball", `on the M2 the gunner's load is .50 BMG ball (${g.load})`);
  const cell = b.cells[b.vehicle.gunAt];
  check(!err && g.gunner && !g.off && g.weapon === "turret_m2" && g.ap === 1 && cell && cell.h === 1 && gunnerOf(b) === g, `Man the turret (1 action): ${g.name} is up on the roof (a level up), the M2 in hand${err ? ` [${err}]` : ""}`);
  check(active(g) && !active(r2), "the gunner is on the map; the other riders are not (only the gunner can be shot)");
  check(/On the turret/.test(combatAct(st, { type: "move", unit: g.id, x: 0, y: 0 })), "the gunner cannot walk off");
  // A raider in sight of the turret.
  const foes = b.units.filter((u) => u.side === "enemy" && active(u));
  const t = foes[0];
  let spot = null;
  for (let y = 0; y < b.h && !spot; y++) for (let x = 0; x < b.w && !spot; x++) {
    const d = Math.hypot(x - g.x, y - g.y);
    if (d < 3 || d > 7 || b.cells[y * b.w + x].k !== "open" || b.units.some((o) => !o.dead && !o.off && o.x === x && o.y === y)) continue;
    const ox = t.x, oy = t.y; t.x = x; t.y = y;
    if (canSee(b, g, t)) spot = [x, y]; else { t.x = ox; t.y = oy; }
  }
  for (const o of foes) if (o !== t) { o.aware = true; }
  check(!!spot, "a raider in the gunner's sight");
  const ammo0 = turretRounds(b), noise0 = b.noise || 0;
  const e2 = combatAct(st, { type: "turret", unit: g.id, target: t.id });
  check(!e2 && turretRounds(b) === ammo0 - 3 && magIn(g) === 97 && b.vehicle.belt === 97 && g.turretMag === 97, `a burst: 3 rounds of .50 BMG from the team's (${ammo0} → ${turretRounds(b)}), the belt 97/100${e2 ? ` [${e2}]` : ""}`);
  check((b.noise || 0) - noise0 >= 6 && foes.every((o) => o.dead || o.aware), `very loud: noise +${(b.noise || 0) - noise0}, everyone awake`);
  check(t.dead || t.pinT === b.turn, "whoever it lands near is pinned (−10 aim their next turn)");
  // (measured with a hunting rifle in their hands: a raider's own gun may be a sawn-off, at 5% from here pinned or not)
  if (!t.dead) { const w0 = t.weapon; t.weapon = "huntrifle"; const a0 = shotOdds(b, t, g).chance; t.pinT = null; check(shotOdds(b, t, g).chance - a0 === TURRET.PIN || shotOdds(b, t, g).chance === 95, `the pin costs 10 aim (${a0}% pinned, ${shotOdds(b, t, g).chance}% not)`); t.weapon = w0; }
  // Cover: half, full behind plate x2.
  const shooter = foes.find((o) => !o.dead) || t;
  check(shotOdds(b, shooter, g).cover === 1, "the gunner has half cover");
  b.vehicle.up.plating = 2;
  check(shotOdds(b, shooter, g).cover === 2, "full cover behind plate ×2");
  b.vehicle.up.plating = 1;
  // Reload: both actions.
  g.ap = 1; g.mag = 40;
  check(/both actions/.test(combatAct(st, { type: "reload", unit: g.id })), "a new belt needs both actions");
  g.ap = 2;
  const e3 = combatAct(st, { type: "reload", unit: g.id });
  check(!e3 && g.ap === 0 && magIn(g) === Math.min(100, turretRounds(b)) && b.vehicle.belt === magIn(g), `reloaded (${magIn(g)}, as far as the team's .50 BMG goes)`);
  // Jams (gunfire.js: the turret's rel): a jammed turret will not fire; the gunner clears it on the turret (Unjam).
  g.ap = 2; g.jam = { kind: "stovepipe", ap: 1 };
  const ej = combatAct(st, { type: "turret", unit: g.id, target: t.id });
  check(/Jammed/.test(ej), `a jammed turret will not fire ("${ej}")`);
  const eu = combatAct(st, { type: "unjam", unit: g.id });
  check(!eu && !g.jam && g.gunner && g.ap === 1, `the gunner clears it on the turret (1 action)${eu ? ` [${eu}]` : ""}`);
  // The belt's last rounds: 100 and 200 do not divide into 3-round bursts, so the last burst fires what is left.
  const t2 = foes.find((o) => !o.dead && canSee(b, g, o));
  if (t2) {
    g.ap = 2; g.mag = 1; g.magW = g.weapon;
    const r0 = turretRounds(b);
    const e4 = combatAct(st, { type: "turret", unit: g.id, target: t2.id });
    check(!e4 && magIn(g) === 0 && turretRounds(b) === r0 - 1, `the belt's last round fires as a short burst (${r0} → ${turretRounds(b)}, belt ${magIn(g)})${e4 ? ` [${e4}]` : ""}`);
  }
  g.ap = 1; g.jam = { kind: "double", ap: 2 }; const belt1 = magIn(g);
  check(/both actions/.test(combatAct(st, { type: "reload", unit: g.id })) && g.jam && magIn(g) === belt1, "a double feed: a new belt still needs both actions (the jam and the belt left as they were)");
  g.jam = null; g.ap = 2;
  // Save mid-battle.
  st.cards = [];
  const st2 = deserializeState(serializeState(st));
  const g2 = st2.combat.units.find((u) => u.id === g.id);
  check(g2 && g2.gunner && g2.weapon === "turret_m2" && g2.mag === g.mag && st2.combat.vehicle.belt === b.vehicle.belt && g2.gunSave && g2.gunSave.weapon === gun0, "a save mid-battle keeps the gunner, the belt and their own gun");
  // Switching, getting down, getting out.
  r2.ap = 2;
  combatAct(st, { type: "gunner", unit: r2.id });
  check(r2.gunner && !g.gunner && g.off && g.weapon === gun0 && g.load === load0 && gunnerOf(b) === r2 && magIn(r2) === b.vehicle.belt, "another rider takes over: one gunner at a time, the belt carries over, the first is back inside with their own gun");
  r2.ap = 2;
  combatAct(st, { type: "disembark", unit: r2.id });
  check(!r2.gunner && !r2.aboard && !gunnerOf(b) && !b.cells.some((c) => c.h === 1 && c.k === "vehicle"), "getting out ends it");
  // Downed: back inside.
  g.ap = 2;
  combatAct(st, { type: "gunner", unit: g.id });
  damage(b, g, 999, shooter);
  check(g.down && g.off && g.aboard && !g.gunner && g.weapon === gun0 && !gunnerOf(b), "a downed gunner drops back inside");
  // A raid: Heat.
  st.combat = null;
}
{
  const st = createWorld({ seed: SEED + 3, factionCount: 3 });
  const h = hub(st);
  const v = createVehicle(st, "hummer", { kind: "base", baseId: h.id }, { fuel: 30 });
  fitMilitary(v, "m2hb");
  const tile = st.tiles.find((t) => t.road && !t.loc && !st.bases.some((b) => b.tile === t.id));
  const p = team(st, tile.id, 2, v.id);
  p.supplies.ammo = 60;
  p.supplies.a_50bmg_ball = 60; // the M2's belt: .50 BMG (ammo.js rounds by calibre; turretRounds)
  const b = inBrowser(() => createBattle(st, raidSetup(st, tile.id, p)));
  st.combat = b; b.phase = "player";
  const g = b.units.find((u) => u.side === "player");
  g.aboard = true; g.off = true; g.ap = 2;
  combatAct(st, { type: "gunner", unit: g.id });
  const t = b.units.find((u) => u.side === "enemy" && active(u));
  if (t) {
    const heat0 = b.raid.heat;
    combatAct(st, { type: "turret", unit: g.id, target: t.id }); // in sight or not: a refusal leaves the Heat as it was
    const fired = b.raid.heat > heat0;
    if (!fired) { t.x = g.x + 3; t.y = g.y; if (b.cells[t.y * b.w + t.x] && b.cells[t.y * b.w + t.x].k === "open" && canSee(b, g, t)) { g.ap = 2; combatAct(st, { type: "turret", unit: g.id, target: t.id }); } }
    check(b.raid.heat - heat0 >= TURRET.HEAT || !canSee(b, g, t), `a raid: Heat +${Math.round(b.raid.heat - heat0)} for a burst (the shot's own and TURRET.HEAT)`);
  }
  st.combat = null;
}
{
  // The enemy's gunner on a raid's Humvee at your base.
  let st = null, f = null;
  for (let i = 0; i < 40 && !f; i++) { st = createWorld({ seed: SEED + 5 + i * 17, factionCount: 3 }); f = st.factions.find((x) => x.type === "military"); }
  const h = hub(st);
  const raid = spawnAiParty(st, f, "raid", f.bases[0], h.tile, { strength: 20, target: { kind: "player", baseId: h.id, tile: h.tile } });
  inBrowser(() => defendInPerson(st, raid));
  const b = st.combat;
  const eg = b && b.units.find((u) => u.side === "enemy" && u.gunner);
  check(eg && eg.weapon === "turret_m2" && b.cells[eg.y * b.w + eg.x].k === "truck" && b.cells[eg.y * b.w + eg.x].h === 1, "their Humvee is manned: one of them on the M2, up on the roof");
  if (eg) {
    autoPlayerTurn(st); // the deploy step: your people to their posts
    // One of your people out in the open in the gunner's sight (the Humvee stands behind their front).
    const me = b.units.find((u) => u.side === "player" && active(u));
    let put = false;
    for (let y = 0; y < b.h && !put; y++) for (let x = 0; x < b.w && !put; x++) {
      const d = Math.hypot(x - eg.x, y - eg.y);
      if (d < 4 || d > 9 || b.cells[y * b.w + x].k !== "open" || b.units.some((o) => !o.dead && !o.off && o.x === x && o.y === y)) continue;
      const ox = me.x, oy = me.y; me.x = x; me.y = y;
      if (canSee(b, eg, me)) put = true; else { me.x = ox; me.y = oy; }
    }
    let shots = 0, turns = 0, moved = false;
    const at = [eg.x, eg.y];
    for (; turns < 6 && st.combat === b && !b.over; turns++) {
      for (const u of b.units) if (u.side === "player") u.ap = 0;
      combatAct(st, { type: "end" });
      const m0 = magIn(eg);
      runEnemyPhase(st);
      if (magIn(eg) < m0 || (eg.mag === eg.magMax && m0 < 3)) shots++;
      if (eg.x !== at[0] || eg.y !== at[1]) moved = true;
      if (eg.dead) break;
    }
    check(shots > 0 && !moved, `their gunner fires the M2 at you and stays on it (${shots} bursts in ${turns} turns)`);
  }
  st.combat = null;
}
{
  // By the numbers: the team's own turret.
  const st = createWorld({ seed: SEED, factionCount: 3 });
  const v = createVehicle(st, "hummer", { kind: "base", baseId: hub(st).id }, { fuel: 30 });
  const tile = st.tiles.find((t) => t.road && !t.loc && !st.bases.some((b) => b.tile === t.id));
  const p = team(st, tile.id, 3, v.id);
  const people = partyMembers(st, p);
  const s0 = { tile: tile.id, partyId: p.id, enemy: { kind: "raiders", count: 4, power: 3 }, ambush: null, handler: "vut", context: {} };
  const m0 = byNumbersOdds(st, s0, people).mine;
  fitMilitary(v, "m2hb");
  check(near(byNumbersOdds(st, s0, people).mine - m0, TURRET_ODDS.m2hb), "by the numbers: a team riding its own turreted Humvee gets +6");
}

// ---------------------------------------------------------------------------------------------------------------
section("Strip, refunds, value, save");
{
  const st = createWorld({ seed: SEED, factionCount: 3 });
  const h = hub(st);
  const v = st.vehicles.find((x) => x.type === "truck");
  const value0 = vehicleValue(v);
  v.upgrades = { glass: 1, plating: 2 };
  check(vehicleValue(v) > value0 + 100, `upgrades add to its worth (${value0} → ${vehicleValue(v)})`);
  const pk = costOf("carparts");
  h.stock[pk] = 0; h.spareGlass = 0;
  finishUpgrade(st, h, v, "glass", "strip");
  check(upgradesOf(v).glass === 0 && h.stock[pk] === 2 && h.spareGlass === 1, `stripping the glass: half its car parts (${h.stock[pk]}) and the glass whole (a spare set)`);
  finishUpgrade(st, h, v, "plating", "strip");
  check(upgradesOf(v).plating === 1 && h.stock[pk] === 5, "stripping a level of plate: half its 6 car parts");
  check(stripRefund("mesh")[pk] == null && stripRefund("scrapPlate")[pk] === 1, "grilles give nothing back; scrap plating 1 car part");
  // The spare glass goes back on with no materials.
  for (const s of atBase(st, h.id)) { s.skills.mechanics = 7; s.role = "craft"; }
  if (!h.buildings.some((b) => b.type === "garage")) addBuilding(h, "garage");
  const o = upgradeOptions(st, h, v).find((x) => x.key === "glass" && x.op === "fit");
  const parts0 = h.stock.parts || 0, scrap0 = h.stock.scrap || 0;
  queueUpgrade(st, h, v, "glass");
  check(o && o.spare && h.spareGlass === 0 && (h.stock.parts || 0) === parts0 && (h.stock.scrap || 0) === scrap0, "fitting glass with a spare set uses no materials");
  const blob = serializeState(st);
  const st2 = deserializeState(blob);
  const v2 = st2.vehicles.find((x) => x.id === v.id), h2 = hub(st2);
  check(v2 && upgradesOf(v2).plating === 1 && h2.garage && h2.garage.length === 1 && h2.garage[0].key === "glass", "save / load keeps v.upgrades and the garage queue");
  let n = 0;
  while (h2.garage.length && n < 30) { garageHour(st2); n++; }
  check(upgradesOf(v2).glass === 1, `the loaded garage finishes the job (${n}h)`);
}

// ---------------------------------------------------------------------------------------------------------------
section("Drawing (stub canvases: ui/mapsprites.js, ui/isoview.js, ui/combat.js, the base's Vehicles tab)");
{
  let nan = 0;
  const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, {
    get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((x) => typeof x === "number" && !Number.isFinite(x))) nan++; }),
    set: (o, k, x) => { if (typeof x === "number" && !Number.isFinite(x)) nan++; o[k] = x; return true; },
  });
  const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
  globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  const MS = await import("../src/ui/mapsprites.js");
  const ISO = await import("../src/ui/isoview.js");
  const UI = await import("../src/ui/combat.js");
  ISO.setIsoCanvas(cvs);
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
  const code = MS.upsCode({ plating: 2, glass: 1, turret: { gun: "m2hb" } });
  check(code === "p2s0g1m0tm2hb" && MS.upsCode({}) === "" && MS.upsCode(undefined) === "", `upsCode "${code}"`);
  let ok = true;
  try {
    for (const k of ["truck", "sedan", "miltruck"]) for (const c of [code, "p0s1g0m1t", "p1s0g0m0tlmg"]) { MS.partySpriteCanvas(k, "#4f8fd6", 3, c); MS.markerSpriteCanvas("vehicle", "#4f8fd6", { vehicle: k, ups: c }); }
  } catch (e) { ok = false; console.log(e.stack.split("\n").slice(0, 3).join(" ")); }
  check(ok, "State Map sprites with plates, glass, grilles and a turret");
  // A battle with a turreted, plated team vehicle and the motor pool's Humvee, both views.
  let st = null, tile = null;
  for (let i = 0; i < 6 && tile == null; i++) { st = createWorld({ seed: SEED * 100 + i, factionCount: 7 }); tile = (st.militaryIds || [])[0]; }
  const h = hub(st);
  const v = createVehicle(st, "hummer", { kind: "base", baseId: h.id }, { fuel: 30 });
  fitMilitary(v, "m2hb");
  const p = team(st, tile, 3, v.id);
  st.combat = inBrowser(() => createBattle(st, raidSetup(st, tile, p)));
  const b = st.combat;
  check(b.cells.some((c) => c.k === "vehicle" && c.car && c.car.up && c.car.up.t === "m2hb" && c.car.up.p === 1) && b.cells.some((c) => c.k === "truck" && c.car && c.car.up && c.car.up.t === "m2hb"), "the team's Humvee and the motor pool's carry their turret and plate on their cells");
  { const g = b.units.find((u) => u.side === "player"); b.phase = "player"; g.aboard = true; g.off = true; g.ap = 2; combatAct(st, { type: "gunner", unit: g.id }); UI.cui.sel = g.id; }
  const panel = UI.renderCombatPanel(st);
  check(/Get down/.test(panel) && /on the turret/.test(panel) && /M2 turret/.test(panel), "the panel: Get down (⇧T), the gunner on the turret with the belt");
  let err = "";
  for (const view of ["iso", "top"]) { UI.setBattleView(view); try { UI.drawCombat(st, 1e9); } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" "); } }
  check(!err && !nan, `both battle views draw them, the turret manned${err ? `: ${err}` : ""}${nan ? ` (${nan} NaN)` : ""}`);
  st.combat = null;
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(fail ? "failed" : "passed");
process.exit(fail ? 1 : 0);
