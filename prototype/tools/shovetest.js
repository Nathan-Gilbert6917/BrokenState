// Shoving people and the dead (sim/shoving.js): a shove next to them (1 action) pushes the target back a tile or puts
// it flat on its back; with a wall behind it always floors it; the floored get up at the start of their side's turn (an
// action), take blows more easily and keep no overwatch; brutes and bosses are not shoved; arms full shove nobody;
// enemy people shove too (aiPush: the gun's room made before the shot).
// Usage: node tools/shovetest.js [seed]
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { createBattle, combatAct, registerCombatHandler, endPlayerTurn, meleeOdds, runEnemyPhase, hAt } from "../src/sim/combat.js";
import { PUSH, pushOdds, pushRefusal, pushTargets, pushDest, pushHazard } from "../src/sim/shoving.js";
import { TRAITS, PICK_ONLY_TRAITS, SWAP_TRAITS } from "../src/sim/data.js";
import { TRAIT_TIERS } from "../src/sim/traits.js";
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
    if (b.log.slice(n).some((l) => / shoves .* (back|flat|off the edge|window)/.test(l.text))) return { tries: i + 1 };
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

const cellAt = (b, x, y) => b.cells[y * b.w + x];
const setCell = (b, x, y, k) => { cellAt(b, x, y).k = k; b.losCache.fill(0); };
const logHas = (b, n, re) => b.log.slice(n).some((l) => re.test(l.text));

console.log("Enemy people shove too");
{
  // A raider with a gun shoots rather than shoves (the shot is worth more); a trench behind them makes the shove worth it.
  let plain = 0, hazard = 0, turns = 0;
  for (const trench of [false, true]) for (let k = 0; k < 20; k++) {
    const st = createWorld({ seed: seed + k, factionCount: 4 });
    const a = fighter(st, "machete");
    const b = openBattle(st, [a], { kind: "raiders", count: 1, power: 5 });
    const u = by(b, a), [e] = foes(b);
    if (!e.weapon || e.weapon === "fists") continue;
    place(u, 5, 5); place(e, 6, 5); toughen(u); toughen(e);
    if (trench) setCell(b, 4, 5, "trench");
    for (const o of b.units) if (o.side === "player") o.ap = 0;
    const n = b.log.length;
    endPlayerTurn(st); runEnemyPhase(st);
    turns++;
    if (logHas(b, n, new RegExp(`${e.name} shoves`))) trench ? hazard++ : plain++;
  }
  check(turns > 0 && plain === 0 && hazard > 0, `a raider with a gun shoots rather than shoves, unless a trench waits behind (${plain} without, ${hazard} with, of ${turns / 2} each)`);
}

console.log("Hazards behind them");
{
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st), idle = fighter(st);
  const b = openBattle(st, [a, idle]);
  const u = by(b, a), [e] = foes(b);
  place(u, 5, 5); place(by(b, idle), 20, 20); place(e, 6, 5); toughen(e);
  check(pushHazard(b, u, e) === "", "open ground behind them: no hazard");
  setCell(b, 7, 5, "trench");
  check(/trench/.test(pushHazard(b, u, e)), `a trench behind them is named (${pushHazard(b, u, e)})`);
  const r = landOne(st, b, u, e, 6, 5);
  check(r.tries < Infinity && e.x === 7 && e.y === 5, "shoved into the trench: they are in it");
  setCell(b, 7, 5, "spikes");
  const hp0 = e.hp; place(e, 6, 5);
  check(/spike/.test(pushHazard(b, u, e)), "a spike pit is named for the enemy");
  landOne(st, b, u, e, 6, 5);
  check(e.x === 7 && e.hp < hp0, `shoved into the spike pit: hurt (${hp0 - e.hp})`);
  // Your own are not hurt by the pits they know, nor named.
  const t2 = { ...e, side: "player", kind: "human" };
  check(!/spike/.test(pushHazard(b, u, t2)), "a spike pit is not named for one of yours");
  setCell(b, 7, 5, "open");
  b.fires = [{ x: 7, y: 5, turns: 5 }];
  place(e, 6, 5);
  check(/flames/.test(pushHazard(b, u, e)), "flames behind them are named");
  b.fires = [];
}

console.log("Heights: a fall");
{
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st), idle = fighter(st);
  const b = openBattle(st, [a, idle]);
  const u = by(b, a), [e] = foes(b);
  place(u, 5, 5); place(by(b, idle), 20, 20); toughen(e);
  setCell(b, 5, 5, "walkway"); setCell(b, 6, 5, "walkway");
  const d = pushDest(b, u, place(e, 6, 5) || e);
  check(d && d.drop === 1 && hAt(b, 6, 5) === 1 && /fall/.test(pushHazard(b, u, e)), `the walkway's edge: a ${d && d.drop}-level drop named (${pushHazard(b, u, e)})`);
  const hp0 = e.hp;
  landOne(st, b, u, e, 6, 5);
  check(e.x === 7 && e.floored === 1 && hp0 - e.hp >= PUSH.FALL[0], `off the edge: down flat on their back, hurt (${hp0 - e.hp})`);
  // A higher cell behind is no room.
  setCell(b, 5, 5, "open"); setCell(b, 6, 5, "open"); setCell(b, 7, 5, "walkway");
  check(pushDest(b, u, place(e, 6, 5) || e) === null, "a higher cell behind them: nowhere to go");
  setCell(b, 7, 5, "open");
}

console.log("Through a window");
{
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st), idle = fighter(st);
  const b = openBattle(st, [a, idle]);
  const u = by(b, a), [e] = foes(b);
  place(u, 5, 5); place(by(b, idle), 20, 20); place(e, 6, 5); toughen(e);
  setCell(b, 7, 5, "window");
  const d = pushDest(b, u, e);
  check(d && d.x === 8 && d.window && d.window.closed && /window/.test(pushHazard(b, u, e)), "a closed window behind them: they go through to the cell beyond");
  const hp0 = e.hp, n = b.log.length;
  landOne(st, b, u, e, 6, 5);
  check(e.x === 8 && e.floored === 1 && cellAt(b, 7, 5).k === "smashed" && e.hp < hp0, `through the glass: the pane gone, flat on the far side, cut (${hp0 - e.hp})`);
  check(logHas(b, n, /through the window: the glass goes with a crash/) && b.noise > 0, "a crash, heard");
  // Open or broken: through without glass.
  place(e, 6, 5); fresh(b);
  const hp1 = e.hp;
  landOne(st, b, u, e, 6, 5);
  check(e.x === 8 && hp1 === e.hp, "an open (broken) window: through, no cuts");
  // Nothing free beyond a window: just slammed against it.
  setCell(b, 7, 5, "window"); setCell(b, 8, 5, "wall");
  check(pushDest(b, u, place(e, 6, 5) || e) === null, "a wall beyond the window: no room");
}

console.log("Chain: the one behind goes down too");
{
  // Direct, with the dice: shove until the blocker goes down at least once; the target never moves.
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st), mate = fighter(st);
  const b = openBattle(st, [a, mate]);
  const u = by(b, a), m = by(b, mate), [e] = foes(b);
  place(u, 5, 5); place(m, 7, 5); place(e, 6, 5); toughen(e);
  let hit = 0, n = 0;
  for (let k = 0; k < 60; k++) {
    fresh(b); place(e, 6, 5); place(m, 7, 5); m.hp = m.maxHp = 100000;
    const before = b.log.length;
    combatAct(st, { type: "shoveFoe", unit: u.id, target: e.id });
    if (logHas(b, before, /flat on their back/) && !logHas(b, before, /keeps their feet/)) { n++; if (m.floored || m.ap < 2) hit++; } // a friend shoved in their own phase loses the action now
  }
  check(n > 0 && e.x === 6, `a landed shove with someone right behind: the target stays and goes flat (${n} landed)`);
  check(hit > 0 && hit < n, `the friend behind is taken down with them some of the time (${hit} of ${n}), not every time`);
}

console.log("Bracing, hunkering, Bulldozer");
{
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st), idle = fighter(st);
  const b = openBattle(st, [a, idle]);
  const u = by(b, a), [e] = foes(b);
  place(u, 5, 5); place(by(b, idle), 20, 20); place(e, 6, 5); toughen(e);
  const base = pushOdds(b, u, e);
  e.hunker = true;
  check(pushOdds(b, u, e).chance === base.chance - PUSH.HUNKER, `hunkered down: −${PUSH.HUNKER} (${base.chance}% → ${pushOdds(b, u, e).chance}%)`);
  e.hunker = false; e.brace = { x: 7, y: 5 };
  check(pushOdds(b, u, e).chance === base.chance - PUSH.BRACE, `bracing a door: −${PUSH.BRACE}`);
  e.brace = null;
  u.bulldozer = { shove: 20, knock: 0.35 };
  const d = pushOdds(b, u, e);
  check(d.chance === base.chance + 20 && Math.abs(d.knock - base.knock - 0.35) < 1e-9, `a Bulldozer III: +20% to land (${d.chance}%), +35% to floor (${Math.round(d.knock * 100)}%)`);
  check(!!TRAITS.bulldozer && !!TRAIT_TIERS.bulldozer && TRAIT_TIERS.bulldozer.pts.length === 3 && PICK_ONLY_TRAITS.includes("bulldozer") && !SWAP_TRAITS.includes("bulldozer"), "the trait is in the tables and never rolled at birth");
  // A survivor with the trait carries it into the battle.
  const st2 = createWorld({ seed, factionCount: 4 });
  const s = fighter(st2); s.traits = ["bulldozer"]; s.traitTier = { bulldozer: 2 };
  const b2 = openBattle(st2, [s, fighter(st2)]);
  const du = by(b2, s).bulldozer;
  check(du && du.shove === 15 && du.knock === 0.25, `Bulldozer II in the unit: ${JSON.stringify(du)}`);
}

console.log("AI: melee fighters, hazards, breaking out");
{
  let shoved = 0, struck = 0, turns = 0;
  for (let k = 0; k < 20; k++) {
    const st = createWorld({ seed: seed + k, factionCount: 4 });
    const a = fighter(st, "machete");
    const b = openBattle(st, [a], { kind: "raiders", count: 1, power: 5 });
    const u = by(b, a), [e] = foes(b);
    e.weapon = "machete"; e.ammo = 0;
    place(u, 5, 5); place(e, 6, 5); toughen(u); toughen(e);
    if (k % 2) setCell(b, 4, 5, "wall"); // backed against a wall: stays put to be hit
    for (const o of b.units) if (o.side === "player") o.ap = 0;
    const n = b.log.length;
    endPlayerTurn(st); runEnemyPhase(st);
    turns++;
    if (logHas(b, n, new RegExp(`${e.name} shoves`))) { shoved++; if (logHas(b, n, new RegExp(`${e.name} (strikes|lunges|pulls the blow|swings to subdue)`))) struck++; }
  }
  check(shoved > 0 && struck >= shoved - 2, `a raider with a machete shoves someone backed against a wall, then hits them flat (${shoved} shoves, ${struck} followed by a blow, of ${turns} turns)`);

  // Running with two foes right round them: one is shoved aside first.
  let broke = 0;
  for (let k = 0; k < 20; k++) {
    const st = createWorld({ seed: seed + k, factionCount: 4 });
    const a = fighter(st, "bat"), c = fighter(st, "bat"), d = fighter(st, "bat");
    const b = openBattle(st, [a, c, d], { kind: "raiders", count: 1, power: 5 });
    const [e] = foes(b);
    e.weapon = "machete"; b.enemyStart = 12;
    place(by(b, a), 5, 5); place(by(b, c), 5, 6); place(by(b, d), 20, 20); place(e, 6, 5); toughen(e); toughen(by(b, a)); toughen(by(b, c));
    for (const o of b.units) if (o.side === "player") o.ap = 0;
    const n = b.log.length;
    endPlayerTurn(st); runEnemyPhase(st);
    if (logHas(b, n, new RegExp(`${e.name} shoves`))) broke++;
  }
  check(broke > 0, `a raider running with two foes round them shoves one aside (${broke} of 20)`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
