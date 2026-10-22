// Headless checks for the Evac order and its companions (sim/combat.js evacTurn, leaveAboard, placeVehicle; fort.js
// horde sides; aiscav.js / conflicts.js their vehicles):
//   - a bike is a 2 × 1 vehicle with one seat, and does not ride through people
//   - in the vehicle counts as out: everyone left aboard when nobody is on foot drives off with it (a raid keeps the
//     vehicle; a battle ends in a retreat with them safe)
//   - Evac: a raid team and a battle team make it out on their own over a few turns (the order stands); Stop evac
//   - a horde comes at a fort from 1 to 4 sides (bigger hordes from more), people from one
//   - a scavenging party drives out when its group has the fuel; its vehicle stands on the battle map; win and it is
//     left for you to recover
// Usage: node tools/evactest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, spawnAiParty, planPath } from "../src/sim/parties.js";
import { createBattle, registerCombatHandler, combatAct, runEnemyPhase, CELL, aboardCount, zoneAt, vehicleExit } from "../src/sim/combat.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { createVehicle } from "../src/sim/vehicles.js";
import { addBuilding } from "../src/sim/buildings.js";
import { sideOf } from "../src/sim/fort.js";
import { sendParty } from "../src/sim/aiscav.js";
import { triggerConflict } from "../src/sim/conflicts.js";

const seed0 = Number(process.argv[2] || 21);
registerCombatHandler("evactest", () => {});
let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) fails++; };
const idx = (b, x, y) => y * b.w + x;
const team = (state, n) => atBase(state, hub(state).id).slice(0, n).map((s) => s.id);
const raidOn = (state, tile, vehicleId, n = 3) => {
  const res = launchExpedition(state, { memberIds: team(state, n), dest: tile, mission: "scavenge", stance: "normal", vehicleId, supplies: { food: 6, water: 6, ammo: 30, meds: 1 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.phase = "engaged";
  state.combat = createBattle(state, { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "evactest", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(state, tile) }, raid: { heat0: 5 }, context: {} });
  return state.combat;
};
const fieldOn = (state, tile, vehicleId, enemy, n = 3) => {
  const res = launchExpedition(state, { memberIds: team(state, n), dest: tile, mission: "move", stance: "normal", vehicleId, supplies: { food: 6, water: 6, ammo: 30, meds: 1 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.phase = "engaged";
  state.combat = createBattle(state, { tile, partyId: p.id, enemy, ambush: null, canRetreat: true, handler: "evactest", context: {} });
  return state.combat;
};
const landTile = (state) => { const h = hub(state); return state.tiles.find((t) => t.id !== h.tile && !t.loc && t.road && !t.bridge && t.terrain !== "water" && state.grid.distance(t.id, h.tile) > 1); };
// Plays turns: the enemy phase, then the player's turn (where the Evac order moves people), ending it each time.
const play = (state, b, turns) => { for (let i = 0; i < turns && !b.over; i++) { if (b.phase === "player") combatAct(state, { type: "end" }); runEnemyPhase(state); } };

console.log("A bike is 2 × 1");
{
  const state = createWorld({ seed: seed0, factionCount: 6 });
  const h = hub(state);
  const bike = createVehicle(state, "bike", { kind: "base", baseId: h.id }, { count: 3 });
  const b = raidOn(state, landTile(state).id, bike.id);
  const v = b.vehicle;
  check(!!v && v.kind === "bike" && v.w * v.h === 2 && Math.min(v.w, v.h) === 1, `the team's bike covers 2 × 1 cells (${v ? `${v.w} × ${v.h}` : "none"})`);
  check(v && v.seats === 1, `one seat (${v && v.seats})`);
  const cells = b.cells.filter((c) => c.k === "vehicle");
  check(cells.length === 2 && cells.every((c) => c.car && c.car.body === "bike"), "both cells are the one bike");
  state.combat = null;
}

console.log("In the vehicle counts as out");
{
  const state = createWorld({ seed: seed0 + 1, factionCount: 6 });
  const b = raidOn(state, landTile(state).id, state.vehicles[0].id, 3);
  const v = b.vehicle, mine = b.units.filter((u) => u.side === "player");
  // Everyone next to it and in: the last one boarding ends the raid, all of them out with the vehicle.
  const ring = [];
  for (let y = v.y - 1; y <= v.y + v.h; y++) for (let x = v.x - 1; x <= v.x + v.w; x++) if (x >= 0 && y >= 0 && x < b.w && y < b.h && !(x >= v.x && y >= v.y && x < v.x + v.w && y < v.y + v.h) && CELL[b.cells[idx(b, x, y)].k].walk) ring.push([x, y]);
  mine.forEach((u, i) => { u.x = ring[i][0]; u.y = ring[i][1]; u.ap = 2; });
  for (const u of mine) combatAct(state, { type: "board", unit: u.id });
  check(b.over && b.result && b.result.raid.extractedIds.length === mine.length && b.result.raid.vehicleKept, `boarding the last one ends the raid: ${b.result ? b.result.raid.extractedIds.length : 0} of ${mine.length} out, the vehicle kept`);
  state.combat = null;
}
{
  const state = createWorld({ seed: seed0 + 2, factionCount: 6 });
  const b = fieldOn(state, landTile(state).id, state.vehicles[0].id, { kind: "raiders", count: 4, power: 3 }, 3);
  const v = b.vehicle, mine = b.units.filter((u) => u.side === "player");
  check(!!v, "the team's vehicle on the field");
  if (v) {
    const ring = [];
    for (let y = v.y - 1; y <= v.y + v.h; y++) for (let x = v.x - 1; x <= v.x + v.w; x++) if (x >= 0 && y >= 0 && x < b.w && y < b.h && !(x >= v.x && y >= v.y && x < v.x + v.w && y < v.y + v.h) && CELL[b.cells[idx(b, x, y)].k].walk && !b.units.some((o) => o.x === x && o.y === y)) ring.push([x, y]);
    mine.forEach((u, i) => { u.x = ring[i][0]; u.y = ring[i][1]; u.ap = 2; });
    for (const u of mine) combatAct(state, { type: "board", unit: u.id });
    check(b.over && b.result.outcome === "retreat" && !b.result.survivorsDead.length && mine.every((u) => u.left), `everyone in it with the enemy still there: a retreat, all of them out (${b.result && b.result.outcome})`);
  }
  state.combat = null;
}

console.log("Extracting by the vehicle: every cell around it (TEAM-06)");
{
  const state = createWorld({ seed: seed0 + 5, factionCount: 6 });
  const b = raidOn(state, landTile(state).id, state.vehicles[0].id, 3);
  const v = b.vehicle, mine = b.units.filter((u) => u.side === "player");
  const free = (x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h && CELL[b.cells[idx(b, x, y)].k].walk && !b.units.some((o) => !o.left && o.x === x && o.y === y);
  const inCar = (x, y) => x >= v.x && y >= v.y && x < v.x + v.w && y < v.y + v.h;
  // The ring: the 8 cells around each of its cells (Chebyshev 1, as boarding and the trunk: raidloot.js atVehicle).
  const ring = [];
  for (let y = v.y - 1; y <= v.y + v.h; y++) for (let x = v.x - 1; x <= v.x + v.w; x++) if (!inCar(x, y) && free(x, y)) ring.push([x, y]);
  const corner = ring.find(([x, y]) => (x === v.x - 1 || x === v.x + v.w) && (y === v.y - 1 || y === v.y + v.h));
  const u = mine[0];
  const probe = (x, y) => { u.x = x; u.y = y; return vehicleExit(b, u); };
  check(ring.length > 0 && ring.every(([x, y]) => probe(x, y)), `every free cell around the vehicle is a way out in it (${ring.length} cells)`);
  check(!corner || probe(corner[0], corner[1]), "a diagonal corner cell counts too");
  // Two cells off: not.
  const far = [];
  for (let y = v.y - 2; y <= v.y + v.h + 1; y++) for (let x = v.x - 2; x <= v.x + v.w + 1; x++) if (!inCar(x, y) && free(x, y) && (x < v.x - 1 || x > v.x + v.w || y < v.y - 1 || y > v.y + v.h)) far.push([x, y]);
  check(far.length > 0 && far.every(([x, y]) => !probe(x, y)), "two cells away is not");
  // Extract from a ring cell outside every extraction zone: out, at the vehicle.
  const out = ring.find(([x, y]) => zoneAt(b, x, y) < 0);
  check(!!out, "a cell beside the vehicle outside every extraction zone");
  if (out) {
    u.x = out[0]; u.y = out[1]; u.ap = 2;
    const why = combatAct(state, { type: "extract", unit: u.id });
    check(!why && u.left && u.exitVehicle, `extracting there leaves in the vehicle (${why || "ok"})`);
  }
  // A cell off the ring and outside every zone: refused with the reason.
  const off = far.find(([x, y]) => zoneAt(b, x, y) < 0);
  if (off) {
    const w = mine[1]; w.x = off[0]; w.y = off[1]; w.ap = 2;
    check(/next to the vehicle/.test(combatAct(state, { type: "extract", unit: w.id }) || "") && !w.left, "two cells off and outside a zone: refused (move next to the vehicle)");
  }
  // The rest extract beside the vehicle too: the raid ends with the vehicle kept.
  for (const w of mine.filter((o) => !o.left)) {
    const c = ring.find(([x, y]) => free(x, y));
    w.x = c[0]; w.y = c[1]; w.ap = 2;
    combatAct(state, { type: "extract", unit: w.id });
  }
  check(b.over && b.result && b.result.raid.vehicleKept && b.result.raid.extractedIds.length === mine.length, `everyone out beside the vehicle: the raid ends, the vehicle kept (${b.result ? b.result.raid.extractedIds.length : 0} of ${mine.length})`);
  state.combat = null;
}

console.log("Evac");
{
  const state = createWorld({ seed: seed0 + 3, factionCount: 6 });
  const b = raidOn(state, landTile(state).id, null, 3);
  const mine = b.units.filter((u) => u.side === "player");
  // Walk them away from the zones first (as if they had been searching).
  const z = b.raid.zones[0];
  const far = [];
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (b.reach[idx(b, x, y)] && CELL[b.cells[idx(b, x, y)].k].walk && Math.hypot(x - z.x0, y - z.y0) > 10 && Math.hypot(x - z.x0, y - z.y0) < 16 && !b.units.some((o) => o.x === x && o.y === y)) far.push([x, y]);
  mine.forEach((u, i) => { u.x = far[i * 3][0]; u.y = far[i * 3][1]; });
  for (const e of b.units.filter((u) => u.side === "enemy")) { e.dead = true; e.hp = 0; } // nobody to stop them: the Evac's moves alone
  const err = combatAct(state, { type: "evac" });
  check(!err && b.evacOrder, `the Evac order is given (${err || "ok"})`);
  play(state, b, 12);
  check(b.over && b.result && b.result.raid.extractedIds.length === mine.length, `the team makes it out on its own: ${b.result ? b.result.raid.extractedIds.length : 0} of ${mine.length} extracted in ${b.turn} turns`);
  state.combat = null;
}
{
  const state = createWorld({ seed: seed0 + 4, factionCount: 6 });
  const b = fieldOn(state, landTile(state).id, null, { kind: "zombies", count: 4, power: 2 }, 3);
  const mine = b.units.filter((u) => u.side === "player");
  for (const e of b.units.filter((u) => u.side === "enemy")) { e.x = b.w - 1; e.aware = false; }
  mine.forEach((u, i) => { u.x = 10 + i; });
  const err = combatAct(state, { type: "evac" });
  check(!err, `Evac in a battle (${err || "ok"})`);
  play(state, b, 10);
  check(b.over && b.result.outcome === "retreat" && mine.every((u) => u.left || u.dead || u.down), `the team slips away by the evac strip (${b.over ? b.result.outcome : "still on"} after ${b.turn} turns)`);
  state.combat = null;
}
{
  const state = createWorld({ seed: seed0 + 5, factionCount: 6 });
  const b = raidOn(state, landTile(state).id, null, 2);
  b.evacOrder = true; // (given: the team stands in its entry zone, so a real Evac would extract them at once)
  const e2 = combatAct(state, { type: "evacStop" });
  check(!e2 && !b.evacOrder, "Stop evac calls it off");
  state.combat = null;
}

console.log("A horde from 1 to 4 sides");
{
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 }, small = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (let i = 0; i < 12; i++) {
    for (const [n, tally] of [[22, counts], [3, small]]) {
      const state = createWorld({ seed: seed0 + 100 + i, factionCount: 6 });
      const h = hub(state);
      for (const t of ["walls", "walls", "bunkhouse"]) addBuilding(h, t);
      globalThis.window = {};
      let b;
      try { b = state.combat = createBattle(state, { tile: h.tile, baseId: h.id, enemy: { kind: "zombies", count: n, power: 3 }, ambush: null, canRetreat: true, handler: "evactest", layout: "baseDefence", deploy: true, context: { through: 0 } }); } finally { delete globalThis.window; }
      const F = b.deployPlan.fort;
      const sides = new Set(b.units.filter((u) => u.side === "enemy" && !u.boss).map((u) => sideOf(F, u.x, u.y)));
      tally[Math.min(4, sides.size)]++;
      state.combat = null;
    }
  }
  check(counts[1] + counts[2] + counts[3] + counts[4] === 12 && counts[3] + counts[4] > 0 && counts[1] + counts[2] > 0, `a horde of 22: from 1/2/3/4 sides ${counts[1]}/${counts[2]}/${counts[3]}/${counts[4]} times in 12`);
  check(small[1] === 12, `three of the dead: always one side (${small[1]} of 12)`);
  const state = createWorld({ seed: seed0 + 200, factionCount: 6 });
  const h = hub(state);
  for (const t of ["walls", "walls"]) addBuilding(h, t);
  globalThis.window = {};
  let b;
  try { b = state.combat = createBattle(state, { tile: h.tile, baseId: h.id, enemy: { kind: "raiders", count: 12, power: 3 }, ambush: null, canRetreat: true, handler: "evactest", layout: "baseDefence", deploy: true, context: {} }); } finally { delete globalThis.window; }
  const F = b.deployPlan.fort, side = F.side;
  const raiders = b.units.filter((u) => u.side === "enemy");
  const main = raiders.filter((u) => sideOf(F, u.x, u.y) === side).length;
  check(main >= raiders.length * 0.6, `raiders come from their own side (${main} of ${raiders.length} on the ${side})`);
  state.combat = null;
}

console.log("Their vehicles");
{
  const state = createWorld({ seed: seed0 + 300, factionCount: 6 });
  // A site their party can walk to: groups are placed without a check that their base is joined to the rest by land, and
  // since the hub moved off the towns (2026-10-22) this seed's first group sits on a small island (no site in reach).
  const reachable = (g, t) => t.loc && t.terrain !== "water" && state.grid.distance(t.id, g.bases[0]) <= 8 && t.id !== g.bases[0] && !!planPath(state, g.bases[0], t.id, false, g.id);
  const f = state.factions.find((x) => x.alive && x.bases.length && state.tiles.some((t) => reachable(x, t)));
  let drove = 0, walked = 0;
  for (let i = 0; i < 20; i++) {
    f.stock.fuel = 30;
    const site = state.tiles.find((t, j) => j > i * 37 && reachable(f, t));
    if (!site) continue;
    const q = sendParty(state, f, f.bases[0], site.id);
    if (!q) continue;
    if (q.vehicle && q.vehicleType) drove++; else walked++;
    state.parties.splice(state.parties.indexOf(q), 1);
  }
  check(drove > 0 && walked > 0, `with fuel in stock some parties drive out, some walk (${drove} drove, ${walked} walked)`);
  f.stock.fuel = 0;
  let dry = 0;
  for (let i = 0; i < 6; i++) { const site = state.tiles.find((t) => reachable(f, t)); const q = site && sendParty(state, f, f.bases[0], site.id); if (q) { if (q.vehicleType) dry++; state.parties.splice(state.parties.indexOf(q), 1); } }
  check(dry === 0, "without fuel nobody drives");
  // Their vehicle on the battle map; beat them and it is left on the field.
  const b = fieldOn(state, landTile(state).id, null, { kind: "raiders", count: 4, power: 3, factionId: f.id, vehicle: "truck", vehiclePartyId: null }, 3);
  const ev = b.enemyVehicle, evCells = ev ? b.cells.filter((c, i) => (i % b.w) >= ev.x && (i % b.w) < ev.x + ev.w && Math.floor(i / b.w) >= ev.y && Math.floor(i / b.w) < ev.y + ev.h && c.k === "truck" && c.car) : [];
  check(!!ev && evCells.length === 8 && ev.w * ev.h === 8, `their truck stands on the map, 2 × 4 cells (${b.enemyVehicle ? `${b.enemyVehicle.w} × ${b.enemyVehicle.h}` : "none"})`);
  for (const e of b.units.filter((u) => u.side === "enemy")) { e.dead = true; e.hp = 0; }
  const u = b.units.find((x) => x.side === "player");
  combatAct(state, { type: "hunker", unit: u.id });
  if (!b.over) combatAct(state, { type: "end" });
  check(b.over && b.result.outcome === "victory" && b.result.enemyVehicle && b.result.enemyVehicle.type === "truck", `won: their vehicle is in the result (${b.over ? b.result.outcome : "on"}, ${b.result && b.result.enemyVehicle ? b.result.enemyVehicle.type : "none"})`);
  state.combat = null;
}

// The whole way: their party drives out, you fight them at a contested site (resolved by the numbers), win, and their
// vehicle is left on the State Map, marked, for any team to recover.
{
  let won = 0, left = 0, tried = 0;
  for (let seed = seed0 + 400; seed < seed0 + 412 && won < 2; seed++) {
    const state = createWorld({ seed, factionCount: 6 }); state.autoCombat = true;
    const h = hub(state); h.stock.ammo = 500;
    const f = state.factions.find((x) => x.alive && x.bases.length);
    f.stock.fuel = 40;
    let q = null;
    for (let i = 0; i < 20 && !(q && q.vehicleType); i++) { const site = state.tiles.find((t, j) => j > i * 41 && t.loc && t.terrain !== "water" && state.grid.distance(t.id, f.bases[0]) <= 8 && t.id !== f.bases[0]); const n = site ? sendParty(state, f, f.bases[0], site.id) : null; if (n) q = n; }
    const tile = state.tiles.find((t) => t.id !== h.tile && !t.loc && t.terrain === "plains" && state.grid.distance(t.id, h.tile) === 2);
    if (!q || !q.vehicleType || !tile) continue;
    const res = launchExpedition(state, { memberIds: team(state, 6), dest: tile.id, mission: "move", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 120, meds: 3 } });
    if (res.error) continue;
    const p = res.party; p.path = [tile.id]; p.idx = 0; p.phase = "out";
    const card = triggerConflict(state, p, "contest", f.id, { scavPartyId: q.id, site: tile.id });
    const fight = card && card.choices.find((c) => c.fight);
    if (!fight) continue;
    tried++;
    const before = state.vehicles.length;
    fight.resolve(state);
    const v = state.vehicles.length > before ? state.vehicles[state.vehicles.length - 1] : null;
    if (v) { won++; if (v.loc.kind === "abandoned" && v.loc.tile === tile.id && state.markers.some((m) => m.type === "vehicle" && m.tile === tile.id)) left++; }
  }
  check(won > 0 && left === won, `beat a party that drove: its vehicle is left where you fought, marked for recovery (${left} of ${won} wins, ${tried} fights)`);
}

console.log(fails ? `\n${fails} check(s) FAILED` : "\nevactest: all checks passed");
process.exit(fails ? 1 : 0);
