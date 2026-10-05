// A spitter's acid burst (src/sim/acid.js; combat.js damage, moveAlong, reachable, the turn flow). Checks:
//   - a dying spitter leaves a pool on its tile and the 8 around it: floor only, not walls, not round a walled corner
//   - everyone living within the pool is splashed at once (your people, hostile people); the dead are not; the log says so
//   - stepping into the pool burns once a round however many pool cells are crossed; again the next round
//   - standing in it when your side's turn starts burns (your people at the player turn, hostile people at theirs)
//   - the pools dry up after ACID.turns rounds, fading (battleOverlays)
//   - people's paths go round it when there is another way (the dead walk straight through); a corridor through it
//     stays open; the raid bot's careful move goes round it
//   - a battle saved mid-pool keeps its pools and plays on the same
//   - a spitter killed in a raid bursts too (and leaves its body to search); a whole battle with spitters plays out
//   - a fight by the numbers weighs a spitter a little more for it
// Usage: node tools/acidtest.js
import { createWorld, hub, atBase } from "../src/sim/world.js";
import {
  createBattle, enemyUnit, damage, moveAlong, reachable, pathTo, distField, endPlayerTurn, runEnemyPhase, autoPlayerTurn,
  registerCombatHandler, closeCombat, active, combatAct,
} from "../src/sim/combat.js";
import { ACID, acidAt, burstCells } from "../src/sim/acid.js";
import { applyZType, typeStrength } from "../src/sim/zombietypes.js";
import { ZTYPES } from "../src/sim/hiveconst.js";
import { battleOverlays } from "../src/sim/siege.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { launchExpedition } from "../src/sim/parties.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
registerCombatHandler("acidtest", () => {});
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };
const key = (x, y) => `${x},${y}`;
const logSince = (b, n) => b.log.slice(n).map((l) => l.text);

// A battle at the hub on a cleared map (all open ground): 3 of your people, 2 spitters and a walker, plus a raider.
// Everyone parked along the top row until a check places them.
function arena(seed = 7) {
  const st = createWorld({ seed, factionCount: 4 });
  const h = hub(st);
  const people = atBase(st, h.id).slice(0, 3);
  const b = inBrowser(() => createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind: "zombies", count: 3, power: 3, types: { spitter: 2 } }, ambush: null, canRetreat: true, handler: "acidtest", context: {} }));
  st.combat = b;
  for (let i = 0; i < b.cells.length; i++) b.cells[i] = { k: "open", f: "grass" };
  b.losCache.fill(0);
  b.evacCols = 0;
  b.infection = 0;
  const raider = enemyUnit(b, b.rng, "raiders", 3, 9);
  raider.aware = false;
  b.units.push(raider);
  b.units.forEach((u, i) => { u.x = 1 + i * 2; u.y = 0; });
  const ps = b.units.filter((u) => u.side === "player");
  const sp = b.units.filter((u) => u.ztype === "spitter");
  const walker = b.units.find((u) => u.kind === "zombie" && !u.ztype);
  return { st, b, ps, sp, walker, raider };
}
const wall = (b, x, y) => { b.cells[y * b.w + x] = { k: "wall", f: "grass" }; b.losCache.fill(0); };

section("The burst (acid.js spitterBurst, from combat.js damage)");
{
  const { b, ps, sp, walker, raider } = arena();
  const [A, B, C] = ps;
  const S = sp[0];
  S.x = 10; S.y = 8;
  wall(b, 11, 8); wall(b, 10, 9); // (11, 9) is round a walled corner
  A.x = 9; A.y = 8; // next to it
  B.x = 11; B.y = 9; // diagonal, but behind the corner
  C.x = 12; C.y = 7; // two tiles off
  raider.x = 10; raider.y = 7; // hostile people are caught too
  walker.x = 9; walker.y = 7; // the dead are not
  const hp = new Map(b.units.map((u) => [u.id, u.hp]));
  const n0 = b.log.length;
  damage(b, S, 999, A, false, { how: "shot" });
  const cells = (b.acid || []).map((p) => key(p.x, p.y)).sort();
  const want = ["9,7", "10,7", "11,7", "9,8", "10,8", "9,9"].sort();
  check(S.dead && JSON.stringify(cells) === JSON.stringify(want), `the pool covers its tile and the open ground round it, not the walls nor round the walled corner: ${cells.join(" ")}`);
  check(b.acid.every((p) => p.turns === ACID.turns), `each pool cell lasts ${ACID.turns} rounds`);
  const lost = (u) => hp.get(u.id) - u.hp;
  check(lost(A) >= ACID.burst[0] * 0.9 && lost(A) <= ACID.burst[1], `your person next to it is splashed: ${A.name} −${Math.round(lost(A))} (${ACID.burst.join("–")}, armour half counts)`);
  check(lost(raider) > 0, `a raider next to it is splashed too: −${Math.round(lost(raider))}`);
  check(lost(B) === 0 && lost(C) === 0, "nobody behind the walled corner or two tiles off is hurt");
  check(lost(walker) === 0, "the dead next to it are unharmed");
  const lines = logSince(b, n0);
  check(lines.some((t) => /bursts, spraying acid!/.test(t) && t.includes(A.name)), `the log: “${lines.find((t) => /bursts/.test(t))}”`);
  // A second death on a dead spitter (damage again) does not burst twice.
  const hpA = A.hp;
  damage(b, S, 10, A);
  check(A.hp === hpA, "a spitter bursts only once");
  // Burst cells on their own: a spitter in the open gets all 9; next to the map's edge only what is on the map.
  check(burstCells(b, 5, 12).length === 9 && burstCells(b, 0, 0).length === 4, "in the open: 9 cells; in a map corner: 4");
}

section("Stepping in, standing in it, drying up");
{
  const { st, b, ps, sp, walker, raider } = arena(11);
  const [A, B, C] = ps;
  sp[0].x = 10; sp[0].y = 8;
  damage(b, sp[0], 999, null);
  check(b.acid.length === 9, "a spitter dying in the open: 9 pool cells");
  // A walks straight through three pool cells: burned once.
  A.x = 8; A.y = 8;
  let n0 = b.log.length, hp0 = A.hp;
  moveAlong(b, A, [[9, 8], [10, 8], [11, 8], [12, 8]]);
  let steps = logSince(b, n0).filter((t) => t.startsWith(A.name) && /steps into the acid/.test(t));
  check(steps.length === 1 && A.hp < hp0 && hp0 - A.hp <= ACID.pool[1], `walking through three pool cells burns once: “${steps[0]}”`);
  // Back in the same round: nothing more.
  hp0 = A.hp;
  moveAlong(b, A, [[11, 8]]);
  check(A.hp === hp0, "stepping in again the same round does nothing more");
  // The dead walk through unharmed.
  walker.x = 8; walker.y = 9; const wh = walker.hp;
  moveAlong(b, walker, [[9, 9], [10, 9], [11, 9], [12, 9]]);
  check(walker.hp === wh, "the dead walk through it unharmed");
  // The turn flow: B and the raider stand in it; the round turns over.
  walker.x = 20; walker.y = 16; walker.aware = false;
  B.x = 9; B.y = 7;
  raider.x = 11; raider.y = 7; raider.aware = false; raider.hp = raider.maxHp = 200;
  for (const s of sp.slice(1)) { s.x = 24; s.y = 16; s.aware = false; }
  C.x = 2; C.y = 2;
  A.x = 14; A.y = 12; // out of it for the turn over
  b.phase = "player";
  const turn0 = b.turn, bHp = B.hp, rHp = raider.hp;
  n0 = b.log.length;
  endPlayerTurn(st);
  const rLine = logSince(b, n0).find((t) => t.startsWith(raider.name) && /stands in the acid/.test(t));
  check(!!rLine && raider.hp < rHp, `a hostile standing in it when their turn starts is burned: “${rLine}”`);
  runEnemyPhase(st);
  const bLine = logSince(b, n0).find((t) => t.startsWith(B.name) && /stands in the acid/.test(t));
  check(b.turn === turn0 + 1 && !!bLine && B.hp < bHp, `your person standing in it when your turn starts is burned: “${bLine}”`);
  check(b.acid.length === 9 && b.acid.every((p) => p.turns === ACID.turns - 1), `the pools dry up a round (${b.acid[0].turns} left)`);
  const f1 = battleOverlays(b).acid[0].fade;
  // A fresh round: stepping in burns again.
  A.x = 13; A.y = 8; hp0 = A.hp;
  moveAlong(b, A, [[12, 8], [11, 8]]);
  check(A.hp < hp0, "a new round: stepping in burns again");
  B.x = 2; B.y = 4; A.x = 2; A.y = 6; raider.x = 25; raider.y = 0;
  for (let i = 0; i < ACID.turns - 1 && !b.over; i++) {
    b.phase = "player";
    endPlayerTurn(st); runEnemyPhase(st);
    if (i === 0) { const ov = battleOverlays(b).acid; check(ov.length === 9 && ov[0].fade < f1, `the pool fades as it dries (${f1.toFixed(2)} → ${ov[0].fade.toFixed(2)})`); }
  }
  check(!b.acid.length && !battleOverlays(b).acid.length, `after ${ACID.turns} rounds the pool is gone`);
}

section("Pathing round it (combat.js reachable, distField; the raid bot)");
{
  const { b, ps, sp, walker } = arena(5);
  const [A] = ps;
  sp[0].x = 10; sp[0].y = 8;
  damage(b, sp[0], 999, null);
  A.x = 6; A.y = 8;
  const inPool = (path) => path.filter(([x, y]) => acidAt(b, x, y)).length;
  const r = reachable(b, A, 40);
  const p = pathTo(r, 14, 8);
  check(p.length && !inPool(p) && r.dist[8 * b.w + 14] > 8, `your people's AI goes round the pool when it can (${p.length} steps, cost ${r.dist[8 * b.w + 14]} against 8 straight through)`);
  walker.x = 6; walker.y = 9; walker.aware = true;
  const rz = reachable(b, walker, 40);
  const pz = pathTo(rz, 14, 9);
  check(inPool(pz) > 0 && rz.dist[9 * b.w + 14] === 8, `the dead walk straight through (${inPool(pz)} pool cells, cost ${rz.dist[9 * b.w + 14]})`);
  // An order by hand: a way round of the same length is taken, a longer one is not forced on you.
  const rm = reachable(b, A, 10, { manual: true });
  const pm = pathTo(rm, 14, 8);
  check(rm.dist[8 * b.w + 14] === 8 && inPool(pm) > 0, "an order by hand still goes the short way through (the preview shows it)");
  check(isFinite(rm.dist[8 * b.w + 14]) && isFinite(r.dist[8 * b.w + 14]), "the pool is never closed: a move into or across it is always possible");
  const fh = distField(b, [[14, 8]], A), fz = distField(b, [[14, 8]], walker);
  check(fh[8 * b.w + 6] > fz[8 * b.w + 6], `a person's distance field counts the pool dearer (${fh[8 * b.w + 6]} against the dead's ${fz[8 * b.w + 6]})`);
  // A corridor through the pool, walls on both sides: the only way, so people still take it.
  for (let x = 3; x <= 18; x++) { wall(b, x, 7); wall(b, x, 9); }
  b.acid = [];
  sp[1].x = 10; sp[1].y = 8; sp[1].dead = false; sp[1].hp = 5;
  damage(b, sp[1], 999, null);
  A.x = 4; A.y = 8;
  const rc = reachable(b, A, 20);
  check(b.acid.length === 3 && isFinite(rc.dist[8 * b.w + 16]) && inPool(pathTo(rc, 16, 8)) === 3, `in a corridor the pool is 3 cells and the way through stays open (cost ${rc.dist[8 * b.w + 16]})`);
  // The careful move the raid bot makes (combatAct move with wary).
  const { st: st2, b: b2, ps: ps2, sp: sp2 } = arena(5);
  sp2[0].x = 10; sp2[0].y = 8;
  damage(b2, sp2[0], 999, null);
  const W2 = ps2[0];
  W2.x = 7; W2.y = 8; W2.ap = 2; b2.phase = "player";
  const hp0 = W2.hp;
  combatAct(st2, { type: "move", unit: W2.id, x: 13, y: 8, wary: true });
  check(W2.x === 13 && W2.y === 8 && W2.hp === hp0, `a careful move (the raid bot) gets there round the pool, unburned`);
}

section("Saved mid-pool (src/sim/save.js)");
{
  const { st, b, ps, sp } = arena(13);
  sp[0].x = 10; sp[0].y = 8;
  damage(b, sp[0], 999, null);
  ps[0].x = 10; ps[0].y = 9; // will stand in it at the next turn
  b.phase = "player";
  const B = loadFromString(saveToString(st));
  check(B.combat && JSON.stringify(B.combat.acid) === JSON.stringify(b.acid) && B.combat.acid.length === 9, "the loaded battle has the same pools");
  const play = (w) => { for (let i = 0; i < 4 && w.combat && !w.combat.over; i++) { autoPlayerTurn(w); if (w.combat && !w.combat.over) runEnemyPhase(w); } return JSON.stringify([w.combat && w.combat.acid, w.combat && w.combat.units.map((u) => [u.id, u.x, u.y, Math.round(u.hp * 100)]), w.combat && w.combat.log.map((l) => l.text)]); };
  const a = play(st), c = play(B);
  check(a === c, "both play on the same (4 rounds)");
}

section("In a raid; a whole battle with spitters");
{
  const st = createWorld({ seed: 7, factionCount: 4 });
  const h = hub(st);
  const tile = st.tiles.find((t) => t.loc && t.loc.type === "town" && t.id !== h.tile).id;
  const crew = atBase(st, h.id).slice(0, 3);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 20, meds: 1 } });
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.phase = "engaged";
  st.combat = createBattle(st, { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "acidtest", enemy: { kind: "zombies", count: 3, power: 3 }, raid: { heat0: 0 }, context: {} });
  const b = st.combat;
  const z = b.units.find((u) => u.kind === "zombie" && active(u));
  applyZType(z, "spitter", false, 3);
  const me = b.units.find((u) => u.side === "player" && active(u));
  const n0 = b.log.length;
  damage(b, z, 999, me, false, { how: "shot" });
  check(b.acid && b.acid.length >= 1 && b.acid.some((q) => q.x === z.x && q.y === z.y), `a spitter killed in a raid bursts (${b.acid.length} pool cells on the ${b.w}×${b.h} map)`);
  check(b.raid.containers.some((c) => c.kind === "body" && c.ztype === "spitter"), "and leaves its body to search (the acid still dripping)");
  check(logSince(b, n0).some((t) => /bursts, spraying acid/.test(t)), "the raid log has the burst");
  // A whole field battle: 3 against 10 with 4 spitters, the AI on both sides, to the end.
  const st2 = createWorld({ seed: 21, factionCount: 4 });
  const h2 = hub(st2);
  st2.combat = inBrowser(() => createBattle(st2, { tile: h2.tile, baseId: h2.id, fighterIds: atBase(st2, h2.id).slice(0, 4).map((s) => s.id), enemy: { kind: "zombies", count: 10, power: 3, types: { spitter: 4 } }, ambush: null, canRetreat: true, handler: "acidtest", context: {} }));
  const b2 = st2.combat;
  let rounds = 0, pools = 0;
  for (; rounds < 60 && st2.combat && !st2.combat.over; rounds++) { autoPlayerTurn(st2); if (st2.combat && !st2.combat.over) runEnemyPhase(st2); pools = Math.max(pools, (b2.acid || []).length); }
  const bursts = b2.log.filter((l) => /bursts, spraying acid/.test(l.text)).length;
  const all = JSON.stringify(b2.log);
  check(b2.over && pools > 0, `a field battle with 4 spitters plays to the end (${rounds} rounds, ${b2.outcome || b2.result && b2.result.outcome || "over"}; up to ${pools} pool cells at once; bursts in the last 80 log lines: ${bursts})`);
  check(!/NaN|undefined/.test(all), "no NaN or undefined in its log");
  closeCombat(st2);
}

section("A fight by the numbers (zombietypes.js typeStrength)");
{
  const s = typeStrength({ count: 10, types: { spitter: 2 } });
  check(ZTYPES.spitter.weight === 1.6 && Math.abs(s - 1.12) < 1e-9, `a spitter weighs ×${ZTYPES.spitter.weight} (its burst too): 2 among 10 make the horde ×${s.toFixed(2)}`);
  check(/bursts/.test(ZTYPES.spitter.special), "its description says it bursts");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
