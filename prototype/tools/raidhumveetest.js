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
  for (const u of b.units) if (u.side === "enemy" && !u.dead && !u.fled) { u.dead = true; }
  enemyTurn(st);
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

console.log(`\n${pass} passed, ${fail} failed`);
console.log(fail ? "failed" : "passed");
process.exit(fail ? 1 : 0);
