// The raid's Humvee in the fight (sim/combat.js raidCarTurn, placeRaidHumvee, carSteps / driveTo shared with your vehicle).
// Checks:
//   - a raid with a Humvee fought in person: the M2 gunner rides it, a driver and riders are inside (off the map)
//   - it drives forward with the attack over turns (same driveTo as yours: open ground, DRIVE.RANGE a turn) and stops
//     where the gunner has your people in range and in sight (hold); the riders get out near the line
//   - a gunner down: a rider takes the gun over; nobody to take it, it pulls back
//   - worn by blasts (vehicleBlast: the same wear as your vehicle) past RAID_CAR.BACK_WEAR it pulls back to the edge they
//     came from and drives off with everyone inside (fled), the cells open again; the field waits for it (carHolds)
//   - worn past RAID_CAR.STALL_WEAR it stalls: it stays, the others bail out
//   - the driver down: it stays where it is
//   - the raid report: driven off, the group keeps it (worn by what it took); stopped, it is left at your base
//   - your own vehicle still drives as before (driveTo); a save mid-battle keeps it all
// Usage: node tools/raidhumveetest.js [seed = 7]
import { createWorld, hub } from "../src/sim/world.js";
import { spawnAiParty } from "../src/sim/parties.js";
import { defendInPerson } from "../src/sim/conflicts.js";
import { raidHumvee } from "../src/sim/vehicles.js";
import { combatAct, runEnemyPhase, autoPlayerTurn, active, gunnerOf, damage, vehicleBlast, raidCarTurn, parkRaidCar, RAID_CAR, DRIVE, canSee, WEAPONS, finishCombat } from "../src/sim/combat.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createVehicle, fitMilitary, loseRaidHumvee } from "../src/sim/vehicles.js";
import { createBattle, registerCombatHandler, fire, fireCab, cabTarget, hullWear, fleeToCar, ramGate, breachOk, BREACH, BREACH_THROUGH, carSteps, syncGunner, driveTo } from "../src/sim/combat.js";

const SEED = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };

// A military group's raid on your hub with its Humvee, fought in person. strength: enough of them for a crew.
function battle(k = 0, strength = 40) {
  let st = null, f = null;
  for (let i = 0; i < 40 && !f; i++) { st = createWorld({ seed: SEED + 5 + i * 17 + k * 101, factionCount: 3 }); f = st.factions.find((x) => x.type === "military"); }
  const h = hub(st);
  const raid = spawnAiParty(st, f, "raid", f.bases[0], h.tile, { strength, target: { kind: "player", baseId: h.id, tile: h.tile } });
  inBrowser(() => defendInPerson(st, raid));
  const b = st.combat;
  if (b) { b.phase === "deploy" && autoPlayerTurn(st); }
  return { st, b, f, raid };
}
const car = (b) => b.raidHumvee;
const riders = (b) => b.units.filter((u) => u.side === "enemy" && u.aboard && !u.dead);
const mine = (b) => b.units.filter((u) => u.side === "player" && active(u));
const nearestMine = (b) => { const v = car(b); return Math.min(...mine(b).map((u) => Math.min(...[0, 1, 2].flatMap((i) => [0, 1].map((j) => Math.hypot(u.x - (v.x + (v.ax === "x" ? i : j)), u.y - (v.y + (v.ax === "x" ? j : i)))))))); };
// One enemy turn: your people stand (no actions), they move.
function enemyTurn(st) { const b = st.combat; for (const u of b.units) if (u.side === "player") u.ap = 0; combatAct(st, { type: "end" }); runEnemyPhase(st); }
// Hide your people from the gunner (no one in range and sight): the Humvee has to come on.
const hold = (b) => { const g = gunnerOf(b, "enemy"); const v = car(b); const r = g ? WEAPONS[g.weapon].opt : 14; return !!g && mine(b).some((f) => Math.hypot(g.x - f.x, g.y - f.y) <= r && canSee(b, g, f)); };

section("On the map: the gunner rides it, a driver and riders inside");
const A = battle();
{
  const { b } = A;
  const v = b && car(b);
  check(!!v && v.ai === "advance" && v.cell === "truck" && v.up && v.up.plating === 1 && v.up.turret.gun === "m2hb", "their Humvee is a vehicle on the map (truck cells, plated, glassed, the M2)");
  const g = b && gunnerOf(b, "enemy");
  check(!!g && g.aboard && !g.off && active(g), "the gunner rides it, on the roof (on the map, the one you can shoot)");
  const d = b && b.units.find((u) => u.id === v.driver);
  check(!!d && d.aboard && d.off && !active(d), `${d ? d.name : "nobody"} is at the wheel, inside (off the map)`);
  check(riders(b).length >= 3 && riders(b).length <= RAID_CAR.SEATS, `${riders(b).length} of them ride it (gunner, driver, ${riders(b).length - 2} riders; seats ${RAID_CAR.SEATS})`);
}

section("It comes on with the attack and stops at range");
{
  const { st, b } = A;
  const v = car(b);
  const at0 = [v.x, v.y], d0 = nearestMine(b), wear0 = v.wear || 0;
  let moved = 0, maxStep = 0, held = false, turns = 0, dropped = false, rodeIn = riders(b).length;
  let last = [v.x, v.y], heldOk = false;
  for (; turns < 10 && st.combat === b && !b.over; turns++) {
    const hits0 = mine(b).length;
    enemyTurn(st);
    const step = Math.abs(v.x - last[0]) + Math.abs(v.y - last[1]);
    if (step) moved++;
    maxStep = Math.max(maxStep, step);
    last = [v.x, v.y];
    if (riders(b).length < rodeIn) dropped = true;
    if (v.ai === "hold") { held = true; heldOk = hold(b) || mine(b).length < hits0; break; } // in sight, or the gunner just shot the one it saw
  }
  const d1 = nearestMine(b);
  check(moved > 0 && d1 < d0, `it drove forward over ${moved} turn(s): ${d0.toFixed(1)} → ${d1.toFixed(1)} cells from your nearest person (from ${at0} to ${v.x},${v.y})`);
  check(!b.log.some((l) => /drives the Humvee.*running down/.test(l.text || l)) && wear0 === (v.wear || 0), "over open ground: it ran nobody down and rammed nothing (no wear)");
  check(maxStep <= DRIVE.RANGE, `no more than DRIVE.RANGE (${DRIVE.RANGE}) cells a turn (most: ${maxStep})`);
  check(held && heldOk, `it stops once the gunner has your people in range and in sight (turn ${turns + 1})`);
  check(d1 >= RAID_CAR.NEAR - 1e-9 || !held, `and not nearer than RAID_CAR.NEAR (${RAID_CAR.NEAR}) to them (${d1.toFixed(1)})`);
  check(dropped && riders(b).every((u) => u.id === v.driver || u.gunner || u.down), "its riders got out near the line and fight on foot");
  const cells = b.cells.filter((c) => c.car && c.car.mil && c.car.mil.enemy);
  check(cells.length === 6 && cells.every((c) => c.k === "truck") && b.cells[b.units.find((u) => u.gunner && u.side === "enemy").y * b.w + b.units.find((u) => u.gunner && u.side === "enemy").x].h === 1, "its cells moved with it: still their Humvee (6 truck cells), the gunner a level up on its roof");
  // A save mid-battle.
  st.cards = [];
  const st2 = deserializeState(serializeState(st));
  const v2 = st2.combat.raidHumvee;
  check(v2 && v2.x === v.x && v2.y === v.y && v2.ai === v.ai && v2.driver === v.driver && st2.combat.units.filter((u) => u.side === "enemy" && u.aboard && !u.dead).length === riders(b).length, "a save mid-battle keeps the Humvee where it is, its state, its driver and riders");
  // It goes on after loading.
  const ok = (() => { try { enemyTurn(st2); return true; } catch (e) { console.log(e); return false; } })();
  check(ok, "and the battle goes on after loading");
}

section("Pulled back: badly battered, it drives off with everyone inside");
{
  const B = battle(1);
  const { st, b, raid, f } = B;
  const v = car(b);
  for (let i = 0; i < 2 && !b.over; i++) enemyTurn(st); // it comes on first
  const y0 = v.y, x0 = v.x;
  // Two blasts next to it (the plate takes 0.6 of the wear).
  const t1 = vehicleBlast(b, v.x, v.y, 1.5, [10, 20], "blast");
  vehicleBlast(b, v.x, v.y, 1.5, [10, 20], "blast");
  vehicleBlast(b, v.x, v.y, 1.5, [10, 20], "frag");
  check(/Humvee takes the blast/.test(t1) && v.wear >= RAID_CAR.BACK_WEAR && v.wear < RAID_CAR.STALL_WEAR, `blasts next to it wear it as yours (${v.wear}; the plating took most of it)`);
  check(riders(b).every((u) => u.hp > 0 && !u.down), "the riders inside are hurt, never dropped (as yours)");
  const in0 = riders(b).map((u) => u.id);
  let gone = false, turns = 0;
  const L0 = b.log.length;
  for (; turns < 8 && st.combat === b && !b.over && !gone; turns++) { enemyTurn(st); gone = !!v.gone; }
  check(b.log.slice(L0).some((l) => /pulls back \(badly battered\)/.test(l.text || l)), `it pulls back (badly battered) from ${x0},${y0}`);
  check(gone && in0.every((id) => b.units.find((u) => u.id === id).fled), `it drove off the map in ${turns} turn(s) with everyone inside (${in0.length}: they got away)`);
  check(!b.cells.some((c) => c.car && c.car.mil && c.car.mil.enemy), "its cells are open ground again");
  // The field waits for it while it can still drive off; once it is gone, beating the rest is a win.
  const c0 = raidHumvee(st, raid).condition;
  // Beat the rest (and any of the dead the noise draws in during that turn: combat.js reinforcements).
  for (let i = 0; i < 4 && !b.over; i++) {
    for (const u of b.units) if (u.side === "enemy" && !u.dead && !u.fled) { u.dead = true; }
    enemyTurn(st);
  }
  check(b.over && b.result && b.result.outcome === "victory" && b.result.humveeOut && b.result.humveeWear === v.wear, "won: the result says it got away, with the wear it took");
  inBrowser(() => finishCombat(st, b.setup, b.result));
  const hv = f.vehicles.find((x) => x.id === raid.humvee) || (f.vehicles || []).find((x) => x.type === "hummer");
  check(hv && hv.condition < c0 && !st.vehicles.some((x) => x.taken && x.taken.from === f.id), `the group keeps it (condition ${c0} → ${hv ? hv.condition : "?"}); nothing left at your base`);
}

section("The field waits while it can drive off (carHolds)");
{
  const { st, b } = battle(2);
  const v = car(b);
  for (const u of b.units) if (u.side === "enemy" && !u.aboard) u.dead = true;
  const g = gunnerOf(b, "enemy");
  damage(b, g, 9999, null);
  enemyTurn(st);
  check(!b.over && (v.ai === "back" || v.gone || riders(b).some((u) => u.gunner)), `with only the Humvee left the fight goes on (${v.gone ? "it drove off" : v.ai})`);
}

section("A gunner down: a rider takes the gun; nobody left to: it pulls back");
{
  const { st, b } = battle(3);
  const v = car(b);
  const g = gunnerOf(b, "enemy");
  damage(b, g, 9999, null);
  check(g.dead || (g.down && g.off && g.aboard && !g.gunner), "the gunner is down (inside, as yours) or dead");
  const spare = riders(b).filter((u) => u.id !== v.driver && !u.down).length;
  raidCarTurn(b);
  const g2 = gunnerOf(b, "enemy");
  check(spare ? !!g2 && g2 !== g && g2.aboard && !g2.off : !g2, spare ? `${g2 ? g2.name : "nobody"} climbs up to the gun` : "no rider to take it");
  // Down them all: nobody to man it, it pulls back.
  for (const u of riders(b)) if (u.id !== v.driver) damage(b, u, 9999, null);
  raidCarTurn(b);
  check(!gunnerOf(b, "enemy") && (v.ai === "back" || v.gone), "the gun unmanned and nobody to take it: it pulls back");
}

section("Stalled: worn out, it stays and the rest bail out");
{
  const { st, b } = battle(4);
  const v = car(b);
  const at = [v.x, v.y];
  v.wear = RAID_CAR.STALL_WEAR;
  const inside = riders(b).filter((u) => !u.gunner).length;
  raidCarTurn(b);
  check(v.ai === "stalled" && riders(b).filter((u) => !u.gunner).length === 0 && inside > 0, `the engine dies: ${inside} bail out`);
  enemyTurn(st);
  check(v.x === at[0] && v.y === at[1] && !v.gone, "it stays where it stands (a gun, nothing more)");
}

section("The driver down: it stays where it is");
{
  const { st, b } = battle(5);
  const v = car(b);
  const d = b.units.find((u) => u.id === v.driver);
  d.down = true;
  for (const u of b.units) if (u.side === "player") { u.x = Math.max(0, u.x); }
  const at = [v.x, v.y];
  for (let i = 0; i < 3 && !b.over; i++) enemyTurn(st);
  check(v.x === at[0] && v.y === at[1], "nobody at the wheel: it does not move");
}

section("A small raid: too few for a crew, it is a gun where it stands");
{
  const { st, b } = battle(6, 9);
  const v = b && car(b);
  if (!v || !gunnerOf(b, "enemy")) check(true, "(no Humvee on this small raid)");
  else {
    const n = b.units.filter((u) => u.side === "enemy").length;
    if (n - 1 < 1 + RAID_CAR.FOOT) {
      const at = [v.x, v.y];
      enemyTurn(st);
      check(v.driver == null && v.x === at[0] && v.y === at[1], `${n} of them: no driver, it stays put`);
    } else check(v.driver != null, `${n} of them: a driver`);
  }
}

section("Off the walls (interior.js toInterior → parkRaidCar): the Humvee stays outside, its people get out");
{
  // The hub fights on one fort map; a smaller walled base moves to the yard map when the wall falls (toInterior), which
  // parks their Humvee outside first.
  const { st, b } = battle(7);
  const v = car(b);
  const inside = riders(b).length;
  parkRaidCar(b);
  check(inside > 0 && v.parked && !riders(b).length && !gunnerOf(b, "enemy") && !b.units.some((u) => u.side === "enemy" && u.gunner), `their Humvee parked: the ${inside} in it out (the gunner off the gun), to come through the openings with the rest`);
  const L0 = b.log.length;
  let ok = true;
  try { enemyTurn(st); } catch (e) { ok = false; console.log(e); }
  check(ok && !b.log.slice(L0).some((l) => /drives the Humvee/.test(l.text || l)), "it drives no more");
}

// ---------------------------------------------------------------------------------------------------------------
// A road fight: your team in a turreted Humvee against a caravan's guards with their armoured escort (escorts.js).
registerCombatHandler("hvt", () => {});
function team(st, tile, n, vehicleId) {
  const h = hub(st);
  const res = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, n).map((s) => s.id), dest: tile, mission: "move", stance: "normal", vehicleId, supplies: { food: 6, water: 6, fuel: 4 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.phase = "waiting"; p.dest = tile;
  return p;
}
function roadFight(k = 0, body = "humvee", n = 5) {
  const st = createWorld({ seed: SEED + 31 + k * 7, factionCount: 3 });
  const h = hub(st);
  const pv = createVehicle(st, "hummer", { kind: "base", baseId: h.id }, { fuel: 30, condition: 80 });
  fitMilitary(pv, "m2hb");
  const tile = st.tiles.find((t) => t.terrain === "plains" && !t.loc && !st.bases.some((x) => x.tile === t.id));
  const p = team(st, tile.id, n, pv.id);
  p.supplies.a_50bmg_ball = 200;
  for (const s of p.members ? p.members : []) void s;
  const enemy = { kind: "guards", count: 7, power: 3, name: "caravan guards", vehicle: "truck", vehicleBody: body, vehicleName: body === "mrap" ? "MRAP" : "Humvee", escort: true, turret: "m2hb" };
  const b = inBrowser(() => createBattle(st, { tile: tile.id, partyId: p.id, enemy, ambush: null, canRetreat: true, handler: "hvt", context: {} }));
  st.combat = b;
  st.autoRetreat = false; // the battle AI fights it out (a test switch)
  return { st, b, p, pv };
}
// Test only: put a vehicle's rect at (px, py) (the cells follow it); false when there is no room.
function moveCar(b, v, px, py) {
  const kind = v.cell || "vehicle";
  const fits = (x, y) => { const q = b.cells[y * b.w + x]; return q.k === "open" || (q.k === kind && x >= v.x && x < v.x + v.w && y >= v.y && y < v.y + v.h); };
  if (px < 0 || py < 0 || px + v.w > b.w || py + v.h > b.h) return false;
  for (let y = py; y < py + v.h; y++) for (let x = px; x < px + v.w; x++) if (!fits(x, y) || b.units.some((o) => !o.dead && !o.off && !o.aboard && o.x === x && o.y === y)) return false;
  const carObj = b.cells[v.y * b.w + v.x].car;
  for (let y = v.y; y < v.y + v.h; y++) for (let x = v.x; x < v.x + v.w; x++) { const q = b.cells[y * b.w + x]; q.k = "open"; delete q.car; delete q.h; }
  v.x = px; v.y = py;
  for (let y = v.y; y < v.y + v.h; y++) for (let x = v.x; x < v.x + v.w; x++) { const q = b.cells[y * b.w + x]; q.k = kind; q.car = { ...carObj }; }
  for (const u of b.units) if (u.aboard && !u.dead && (u.side === "enemy") === (v === b.raidHumvee)) { u.x = v.x; u.y = v.y; }
  syncGunner(b, v);
  return true;
}

section("Hull wear by the round (HULL): heavy and armour-piercing rounds wear it, light ones do not");
{
  const plated = { up: { plating: 1 } }, bare = { up: {} };
  check(hullWear(plated, 70) === 2.1 && hullWear(bare, 70) === 3.5, `the .50 ball (pen 70): ${hullWear(bare, 70)} a round bare, ${hullWear(plated, 70)} plated`);
  check(hullWear(plated, 55) === 1.2 && hullWear(plated, 45) === 0.6, `.308 AP ${hullWear(plated, 55)}, 5.56 / 7.62×39 AP ${hullWear(plated, 45)} (plated)`);
  check(hullWear(bare, 38) <= 0.3 && hullWear(bare, 30) === 0 && hullWear(bare, 15) === 0, `.308 ball ${hullWear(bare, 38)}, 5.56 ball and pistols nothing`);
}

section("Their escort on the road (AI groups' caravans you attack): manned and driven as a raid's Humvee");
const R = roadFight(0);
{
  const { b } = R;
  const v = car(b);
  check(!!v && v.escort && v.cell === "truck" && v.up.turret.gun === "m2hb" && v.ai === "advance", "the escort Humvee is their vehicle on the map (truck cells, plated, the M2)");
  check(!!gunnerOf(b, "enemy") && v.driver != null && riders(b).length >= 2, `manned (${gunnerOf(b, "enemy") ? gunnerOf(b, "enemy").name : "nobody"} on the M2) and driven (${riders(b).length} in it)`);
  const R2 = roadFight(1, "mrap");
  check(car(R2.b) && car(R2.b).name === "MRAP" && car(R2.b).seats === RAID_CAR.MRAP_SEATS && gunnerOf(R2.b, "enemy"), `an MRAP escort the same (${RAID_CAR.MRAP_SEATS} seats)`);
}

section("Your turreted vehicle when the battle AI plays your side (botCar): a crew in, then driven");
{
  const { st, b } = R;
  const v = b.vehicle;
  for (let i = 0; i < 4 && !b.over && !(gunnerOf(b, "player") && v.driver != null && b.units.some((u) => u.id === v.driver && u.aboard)); i++) {
    if (b.phase === "player") autoPlayerTurn(st);
    if (!b.over && b.phase === "enemy") runEnemyPhase(st);
  }
  const g = gunnerOf(b, "player"), d = b.units.find((u) => u.id === v.driver);
  check(!!g && g.aboard && g.weapon === "turret_m2", `one of yours mans the M2 (${g ? g.name : "nobody"})`);
  check(!!d && d.aboard && d.side === "player" && !d.gunner, `one at the wheel (${d ? d.name : "nobody"})`);
  check(v.ai === "advance" || v.ai === "hold" || v.ai === "back", `and it is driven by the same AI (${v.ai})`);
}

section("Shooting the cab (fireCab): heavy rounds wear it, a round through the windscreen hits the driver, a driver down stops it");
{
  const { st, b } = roadFight(2);
  const v = car(b);
  // Your gunner on the M2, in sight of their Humvee.
  const g = b.units.find((u) => u.side === "player" && active(u));
  g.aboard = true; g.off = true; g.ap = 2; g.x = b.vehicle.x; g.y = b.vehicle.y;
  b.phase = "player";
  combatAct(st, { type: "gunner", unit: g.id });
  let tgt = cabTarget(b, g);
  // Bring their Humvee into the gunner's sight, 5 to 9 cells off (test only).
  for (let y = 0; y < b.h && !tgt; y++) for (let x = 0; x < b.w && !tgt; x++) {
    const d = Math.hypot(x - g.x, y - g.y);
    if (d < 5 || d > 9) continue;
    const ox = v.x, oy = v.y;
    if (!moveCar(b, v, x, y)) continue;
    tgt = cabTarget(b, g);
    if (!tgt) moveCar(b, v, ox, oy);
  }
  const d = b.units.find((u) => u.id === v.driver);
  const hp0 = d.hp, w0 = v.wear || 0;
  g.aim = 400; // every round on target (the dice still decide the windscreen)
  let shots = 0, err = "";
  for (; shots < 40 && !d.down && !d.dead && cabTarget(b, g); shots++) { g.ap = 2; g.mag = Math.max(g.mag, 10); err = combatAct(st, { type: "cab", unit: g.id }) || err; }
  tgt = cabTarget(b, g);
  if (shots === 0) check(false, "their Humvee in the gunner's sight to shoot at");
  else {
    check(!err && v.wear > w0, `${shots} burst(s) of .50 at the cab: the hull takes −${Math.round((v.wear - w0) * 10) / 10}${err ? ` [${err}]` : ""}`);
    check(d.hp < hp0 && (d.down || d.dead), `the driver is hit through the windscreen and goes down (${hp0} → ${Math.round(d.hp)}${d.dead ? ", dead" : ""})`);
    const at = [v.x, v.y];
    v.wear = 0; // not worn out: only the driver stops it
    raidCarTurn(b);
    check(v.x === at[0] && v.y === at[1] && !v.gone, "nobody at the wheel: it stays where it is");
  }
  // The AI shoots at your vehicle's cab when it has nobody in sight: your people inside it but one, out of its sight;
  // one of theirs near it.
  const R3 = roadFight(3);
  const b3 = R3.b, st3 = R3.st;
  const mineAll = b3.units.filter((u) => u.side === "player" && !u.dead);
  const walker = mineAll.pop();
  for (const u of mineAll) { u.aboard = true; u.off = true; u.x = b3.vehicle.x; u.y = b3.vehicle.y; }
  b3.vehicle.driver = mineAll[0].id;
  const pv = b3.vehicle;
  const raider = b3.units.filter((u) => u.side === "enemy" && active(u) && !u.gunner && u.kind === "human" && WEAPONS[u.weapon] && WEAPONS[u.weapon].cal).sort((p, q) => WEAPONS[q.weapon].opt - WEAPONS[p.weapon].opt)[0];
  let put = false;
  for (let y = 0; y < b3.h && !put; y++) for (let x = 0; x < b3.w && !put; x++) {
    const dd = Math.hypot(x - pv.x, y - pv.y);
    if (dd < 2 || dd > Math.min(5, WEAPONS[raider.weapon].opt - 1) || b3.cells[y * b3.w + x].k !== "open" || b3.units.some((o) => !o.dead && !o.off && o.x === x && o.y === y)) continue;
    const ox = raider.x, oy = raider.y; raider.x = x; raider.y = y;
    if (cabTarget(b3, raider)) put = true; else { raider.x = ox; raider.y = oy; }
  }
  raider.aware = true; raider.aim = 400;
  let far = null; // the one on foot: well out of the raider's sight
  for (let y = 0; y < b3.h; y++) for (let x = 0; x < b3.w; x++) {
    if (b3.cells[y * b3.w + x].k !== "open" || b3.units.some((o) => !o.dead && !o.off && o.x === x && o.y === y)) continue;
    const dd = Math.hypot(x - raider.x, y - raider.y);
    if (!far || dd > far.d) far = { x, y, d: dd };
  }
  walker.x = far.x; walker.y = far.y;
  const L0 = b3.log.length;
  enemyTurn(st3);
  check(put && b3.log.slice(L0).some((l) => /cab/.test(l.text || l)), "with nobody of yours in sight they shoot at your vehicle's cab");
}

section("The gunners' duel: a miss at a turret's gunner hits the vehicle under them (HULL.MISS)");
{
  const { st, b } = roadFight(4);
  const g = b.units.find((u) => u.side === "player" && active(u));
  g.aboard = true; g.off = true; g.ap = 2; g.x = b.vehicle.x; g.y = b.vehicle.y;
  b.phase = "player";
  combatAct(st, { type: "gunner", unit: g.id });
  const eg = gunnerOf(b, "enemy");
  const w0 = b.vehicle.wear || 0;
  eg.aim = -400; // every round a miss
  let n = 0;
  for (; n < 12; n++) { eg.mag = 100; eg.jam = null; fire(b, eg, g); }
  check(b.vehicle.wear > w0, `${n} bursts of .50 that miss your gunner: your Humvee takes −${Math.round((b.vehicle.wear - w0) * 10) / 10} (settled on its condition after)`);
  const v = car(b), w1 = v.wear || 0;
  g.aim = -400; g.ap = 2;
  for (let i = 0; i < 12; i++) { g.mag = 100; g.jam = null; fire(b, g, eg); }
  check(v.wear > w1, `and yours at theirs: their Humvee takes −${Math.round((v.wear - w1) * 10) / 10}: enough and it pulls back (${RAID_CAR.BACK_WEAR})`);
  b.vehicle.wear = RAID_CAR.STALL_WEAR;
  g.ap = 2;
  const e = driveTo(b, g, b.vehicle.x + 3, b.vehicle.y);
  check(/engine is dead/.test(e), `worn to ${RAID_CAR.STALL_WEAR}, yours will not drive either (${e.slice(0, 40)}…)`);
}

section("Pulling back, it waits for their people running and they climb in (fleeToCar)");
{
  const { st, b } = battle(2);
  const v = car(b);
  v.ai = "back";
  const runner = b.units.find((u) => u.side === "enemy" && active(u) && !u.aboard);
  // Next to it.
  let spot = null;
  for (let y = v.y - 1; y <= v.y + v.h && !spot; y++) for (let x = v.x - 1; x <= v.x + v.w && !spot; x++) {
    if (x < 0 || y < 0 || x >= b.w || y >= b.h || (x >= v.x && x < v.x + v.w && y >= v.y && y < v.y + v.h)) continue;
    if (b.cells[y * b.w + x].k === "open" && !b.units.some((o) => !o.dead && !o.off && o.x === x && o.y === y)) spot = [x, y];
  }
  runner.x = spot[0]; runner.y = spot[1]; runner.fleeing = true;
  for (const u of riders(b)) if (u.id !== v.driver && !u.gunner) u.aboard = false; // seats free
  const at = [v.x, v.y], L0 = b.log.length;
  raidCarTurn(b);
  check(v.x === at[0] && v.y === at[1] && b.log.slice(L0).some((l) => /waits for/.test(l.text || l)), "it waits for one of them running for it");
  runner.ap = 2;
  const took = fleeToCar(b, runner);
  check(took && runner.aboard && runner.off, `${runner.name} climbs in`);
  // Waited long enough: it goes.
  v.waited = RAID_CAR.WAIT;
  raidCarTurn(b);
  check(v.gone || v.x !== at[0] || v.y !== at[1], "then it drives off with them");
}

section("Plated breach (BREACH): no ram with them, it rams a weak gate; not a strong one, never walls or people");
{
  // The hub with walls: their Humvee lined up on a gate.
  let st = null, f = null;
  for (let i = 0; i < 40 && !f; i++) { st = createWorld({ seed: SEED + 5 + i * 17, factionCount: 3 }); f = st.factions.find((x) => x.type === "military"); }
  const h = hub(st);
  h.buildings.push({ id: 90001, type: "walls", progress: 1, done: true });
  const raid = spawnAiParty(st, f, "raid", f.bases[0], h.tile, { strength: 40, target: { kind: "player", baseId: h.id, tile: h.tile } });
  inBrowser(() => defendInPerson(st, raid));
  const b = st.combat;
  const v = car(b);
  const driver = b.units.find((u) => u.id === v.driver);
  // A gate cell with open ground for the Humvee beside it.
  let G = null, spot = null;
  for (let i = 0; i < b.cells.length && !spot; i++) {
    const c = b.cells[i];
    if (c.k !== "gate" || !c.bar) continue;
    const gx = i % b.w, gy = (i / b.w) | 0;
    for (const [px, py] of [[gx + 1, gy - Math.floor((v.h - 1) / 2)], [gx - v.w, gy - Math.floor((v.h - 1) / 2)], [gx - Math.floor((v.w - 1) / 2), gy + 1], [gx - Math.floor((v.w - 1) / 2), gy - v.h]]) {
      let ok = px >= 0 && py >= 0 && px + v.w <= b.w && py + v.h <= b.h;
      for (let y = py; ok && y < py + v.h; y++) for (let x = px; ok && x < px + v.w; x++) { const q = b.cells[y * b.w + x]; if (!(q.k === "open" || (q.k === "truck" && x >= v.x && x < v.x + v.w && y >= v.y && y < v.y + v.h)) || b.units.some((o) => !o.dead && !o.off && o.x === x && o.y === y && !o.aboard)) ok = false; }
      if (ok) { G = c; spot = [px, py]; break; }
    }
  }
  if (!spot) check(true, "(no gate with room beside it on this map)");
  else {
    // Move it there (test only: the cells follow the car).
    const carObj = b.cells[v.y * b.w + v.x].car;
    for (let y = v.y; y < v.y + v.h; y++) for (let x = v.x; x < v.x + v.w; x++) { const q = b.cells[y * b.w + x]; q.k = "open"; delete q.car; delete q.h; }
    v.x = spot[0]; v.y = spot[1];
    for (let y = v.y; y < v.y + v.h; y++) for (let x = v.x; x < v.x + v.w; x++) { const q = b.cells[y * b.w + x]; q.k = "truck"; q.car = { ...carObj }; }
    for (const u of riders(b)) { u.x = v.x; u.y = v.y; }
    syncGunner(b, v);
    b.rams = (b.rams || []).filter((r) => r.side !== "enemy");
    check(breachOk(b, v), "plated, and no ram of theirs: it may breach");
    for (const c of b.cells) if (c.k === "gate" && c.bar) c.hp = 150; // every gate strong
    const w0 = v.wear || 0;
    const strong = ramGate(b, v, driver);
    check(G.hp === 150 && !(strong && v.wear !== w0 && G.hp < 150), "a strong gate (150 hp, over BREACH.WEAK): it does not ram it");
    G.hp = 90;
    const ok = ramGate(b, v, driver);
    check(ok && G.hp < 90 && G.hp >= 90 - BREACH.DMG[1] && v.wear > w0, `a weak gate (90 hp): rammed −${90 - G.hp}, the Humvee −${Math.round((v.wear - w0) * 10) / 10}`);
    b.rams = [{ side: "enemy", dropped: false }];
    check(!breachOk(b, v), "with a ram of their own along, it leaves the gate to the ram");
    b.rams = [];
    // Through a barricade only with the breach set, and never through people.
    const ring = [];
    for (let y = v.y - 1; y <= v.y + v.h; y++) for (let x = v.x - 1; x <= v.x + v.w; x++) if (x >= 0 && y >= 0 && x < b.w && y < b.h && !(x >= v.x && x < v.x + v.w && y >= v.y && y < v.y + v.h) && b.cells[y * b.w + x].k === "open" && !b.units.some((o) => !o.dead && !o.off && o.x === x && o.y === y)) ring.push([x, y]);
    const [bx, by] = ring[0];
    b.cells[by * b.w + bx].k = "barricade";
    const covers = (seen) => [...seen.keys()].some((k) => { const px = k % b.w, py = (k / b.w) | 0; return bx >= px && bx < px + v.w && by >= py && by < py + v.h; });
    check(!covers(carSteps(b, v, driver, true).seen) && covers(carSteps(b, v, driver, BREACH_THROUGH).seen), "a barricade: only in breach mode can it drive through");
    b.cells[by * b.w + bx].k = "open";
    const stand = b.units.find((u) => u.side === "player" && active(u));
    const ox = stand.x, oy = stand.y; stand.x = bx; stand.y = by;
    check(!covers(carSteps(b, v, driver, BREACH_THROUGH).seen), "never through people");
    stand.x = ox; stand.y = oy;
  }
}

section("Driven off, an escort is not yours to take (result.humveeOut)");
{
  const { st, b } = roadFight(5);
  const v = car(b);
  v.wear = RAID_CAR.BACK_WEAR;
  for (let i = 0; i < 8 && !v.gone; i++) { v.waited = RAID_CAR.WAIT; raidCarTurn(b); }
  for (const u of b.units) if (u.side === "enemy" && !u.dead && !u.fled) u.dead = true;
  enemyTurn(st);
  check(v.gone && b.over && b.result.outcome === "victory" && b.result.humveeOut && !b.result.enemyVehicle, "it got away: won, but no vehicle left on the field");
}

section("A raid's several vehicles lost at once (vehicles.js loseRaidHumvee)");
{
  // Two vehicles with one id (a save from before the ids were unique: two taken by a group in one hour) used to loop
  // for ever; now each is lost by itself, and the ones a group takes get ids of their own.
  const st = createWorld({ seed: 11, factionCount: 6 });
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const g = st.factions.find((x) => x.alive && x.bases.length && x !== f);
  const mk = () => fitMilitary({ id: `f${f.id}-dup`, type: "hummer", name: "Humvee", fuel: 10, condition: 80, owner: f.id }, "m2hb");
  f.vehicles = [mk(), mk()];
  const p = { owner: f.id, humvee: `f${f.id}-dup`, humvees: [`f${f.id}-dup`, `f${f.id}-dup`] };
  let got = null, err = "";
  try { got = loseRaidHumvee(st, p, { faction: g }); } catch (e) { err = e.message; }
  const taken = (g.vehicles || []).filter((x) => x.owner === g.id && x.type === "hummer");
  check(!err && !!got && !f.vehicles.length && p.humvee == null, `both lost, no loop (${err || "no error"})`);
  check(taken.length >= 2 && new Set(taken.map((x) => x.id)).size === taken.length, `the group that took them has ${taken.length} with ids of their own (${taken.map((x) => x.id).join(", ")})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(fail ? "failed" : "passed");
process.exit(fail ? 1 : 0);
