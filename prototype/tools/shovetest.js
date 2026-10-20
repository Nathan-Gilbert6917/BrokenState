// Shoving people and the dead (sim/shoving.js): a shove next to them (1 action) pushes the target back a tile or puts
// it flat on its back; with a wall behind it always floors it; the floored get up at the start of their side's turn (an
// action), take blows more easily and keep no overwatch; brutes and bosses are not shoved; arms full shove nobody;
// enemy people shove too (aiPush: the gun's room made before the shot).
// Usage: node tools/shovetest.js [seed]
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { createBattle, combatAct, registerCombatHandler, endPlayerTurn, meleeOdds, runEnemyPhase } from "../src/sim/combat.js";
import { PUSH, pushOdds, pushRefusal, pushTargets } from "../src/sim/shoving.js";
import { newItem } from "../src/sim/inventory.js";

const seed = Number(process.argv[2] || 11);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
registerCombatHandler("shovetest", () => {});

function fighter(state, weapon = "knife") {
  const s = makeSurvivor(state);
  s.skills.melee = 5;
  s.traits = [];
  s.health = 100;
  s.gear.weapon = weapon ? newItem(weapon) : null;
  for (const slot of ["head", "armor", "arms", "legs", "tool"]) s.gear[slot] = null;
  s.pockets = [null, null, null, null];
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
function openBattle(state, crew, enemy = { kind: "raiders", count: 2, power: 3 }) {
  const h = hub(state);
  h.stock.ammo = 200; h.stock.meds = 0;
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy, ambush: null, canRetreat: true, handler: "shovetest", context: {} }));
  for (const c of b.cells) { c.k = "open"; delete c.h; }
  b.losCache.fill(0);
  b.reach.fill(1);
  b.dark = false; b.night = false;
  b.phase = "player";
  for (const u of b.units) if (u.side === "enemy") { u.aware = true; u.x = -10; u.y = -10; u.dead = true; }
  for (const u of b.units) if (u.side === "player") { u.x = -20; u.y = -20; }
  return b;
}
const by = (b, s) => b.units.find((u) => u.sid === s.id);
const foes = (b) => b.units.filter((u) => u.side === "enemy");
const place = (u, x, y) => { u.x = x; u.y = y; u.dead = false; u.down = false; u.floored = 0; };
const toughen = (u) => { u.hp = u.maxHp = 100000; };
const fresh = (b) => { b.phase = "player"; for (const u of b.units) if (u.side === "player" && !u.dead) u.ap = 2; };
// Shoves until one lands (each try on a fresh turn's actions, the target put back where it stood).
function landOne(st, b, u, t, x, y) {
  for (let i = 0; i < 60; i++) {
    fresh(b); place(t, x, y);
    const n = b.log.length;
    const err = combatAct(st, { type: "shoveFoe", unit: u.id, target: t.id });
    if (err) return { err };
    if (b.log.slice(n).some((l) => / shoves .* (back|flat)/.test(l.text))) return { tries: i + 1 };
  }
  return { tries: Infinity };
}

console.log("Shove: pushed back or floored");
{
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st), idle = fighter(st);
  const b = openBattle(st, [a, idle]);
  const u = by(b, a), [e] = foes(b);
  place(u, 5, 5); place(by(b, idle), 20, 20); place(e, 6, 5); toughen(e);
  check(pushTargets(b, u).includes(e) && pushRefusal(b, u) === "", "a raider right next to them can be shoved");
  const o = pushOdds(b, u, e);
  check(o.chance >= PUSH.MIN && o.chance <= PUSH.MAX, `odds within bounds (${o.chance}%)`);
  let back = 0, floored = 0;
  for (let k = 0; k < 30; k++) {
    const r = landOne(st, b, u, e, 6, 5);
    if (r.tries === Infinity) { check(false, "a shove lands"); break; }
    if (k === 0) check(u.ap === 2 - PUSH.AP, `a shove costs ${PUSH.AP} action`);
    if (e.x === 7 && e.y === 5 && !e.floored) back++;
    else if (e.floored) floored++;
  }
  check(back > 0, `pushed back a tile, straight away (${back} of 30)`);
  check(floored > 0, `flat on their back (${floored} of 30)`);
  // Diagonal: pushed on along the diagonal.
  place(e, 6, 6);
  let diag = false;
  for (let k = 0; k < 30 && !diag; k++) { landOne(st, b, u, e, 6, 6); diag = e.x === 7 && e.y === 7; }
  check(diag, "a diagonal shove pushes them on along the diagonal");
}

console.log("A wall behind: always floored");
{
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st), idle = fighter(st);
  const b = openBattle(st, [a, idle]);
  const u = by(b, a), [e] = foes(b);
  place(u, 5, 5); place(by(b, idle), 20, 20); toughen(e);
  b.cells[5 * b.w + 7].k = "wall";
  b.losCache.fill(0);
  let ok = true;
  for (let k = 0; k < 10; k++) { landOne(st, b, u, e, 6, 5); ok = ok && e.floored === 1 && e.x === 6 && e.y === 5; }
  check(ok, "with a wall behind them they go down where they stand");
  // Floored: easier to strike, no overwatch.
  fresh(b); place(e, 6, 5);
  const before = meleeOdds(b, u, e).chance;
  e.floored = 1;
  const after = meleeOdds(b, u, e).chance;
  check(after > before || after === 95, `blows at the floored land more easily (${before}% → ${after}%)`);
  // Getting up: an action at the start of their turn.
  e.ow = true;
  landOne(st, b, u, e, 6, 5);
  check(e.floored === 1 && !e.ow, "floored: overwatch dropped");
  for (const o of b.units) if (o.side === "player") o.ap = 0;
  endPlayerTurn(st);
  check(!e.floored && e.ap === 1, `the enemy turn: gets up for an action (ap ${e.ap})`);
}

console.log("Who is not shoved, who cannot shove");
{
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st), idle = fighter(st);
  const b = openBattle(st, [a, idle], { kind: "zombies", count: 2, power: 3 });
  const u = by(b, a), [z, z2] = foes(b);
  place(u, 5, 5); place(by(b, idle), 20, 20); place(z, 6, 5); toughen(z);
  check(pushRefusal(b, u, z) === "", "one of the dead can be shoved");
  z.ztype = "brute";
  check(/too big/.test(pushRefusal(b, u, z)), `a brute is not (${pushRefusal(b, u, z)})`);
  z.ztype = null; z.boss = "wallbreaker";
  check(/too big/.test(pushRefusal(b, u, z)), "nor a boss");
  z.boss = null;
  place(z2, 8, 8);
  check(/Must be right next/.test(pushRefusal(b, u, z2)), "not from 3 tiles off");
  u.carrying = z2.id;
  check(/arms must be free/.test(pushRefusal(b, u, z)), "arms full: no shove");
  u.carrying = null;
  z.ztype = "crawler";
  check(pushOdds(b, u, z).knock === 0, "a crawler is only pushed, never floored");
  z.ztype = null;
  check(combatAct(st, { type: "shoveFoe", unit: u.id }) === "" && u.ap === 2 - PUSH.AP, "no target given: the one next to them");
}

console.log("Enemy people shove too");
{
  let shoves = 0, turns = 0;
  for (let k = 0; k < 20; k++) {
    const st = createWorld({ seed: seed + k, factionCount: 4 });
    const a = fighter(st, "machete"); // hand to hand: worth shoving off (a gunman is not)
    const b = openBattle(st, [a], { kind: "raiders", count: 1, power: 5 });
    const u = by(b, a), [e] = foes(b);
    if (!e.weapon || e.weapon === "fists") continue;
    place(u, 5, 5); place(e, 6, 5); toughen(u); toughen(e);
    for (const o of b.units) if (o.side === "player") o.ap = 0;
    const n = b.log.length;
    endPlayerTurn(st);
    runEnemyPhase(st);
    turns++;
    if (b.log.slice(n).some((l) => l.text.startsWith(`${e.name} shoves`))) shoves++;
  }
  check(turns > 0 && shoves > 0, `a raider with a gun and someone with a machete in their face shoves them off first (${shoves} of ${turns} turns)`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
