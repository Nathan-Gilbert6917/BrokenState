// Shotgun reloads (src/sim/mags.js SHELLS, the user's calls 2026-10-09: "loose rounds in your pocket is what reloads your
// gun ... it reloads 2-4 shells for one reload action"; "Shotguns reload from shells in your pocket, rig or anything that
// holds them that is not your backpack that needs an additional action"). Checks, on paired seeds:
//   - a tube's Reload puts 2–4 shells in (the dice, steady hands, shaken), capped by the room in the tube and the shells
//     at hand; the same seed gives the same shells;
//   - at hand: boxes in pockets and rig pouches, and the loose handful out of the team's bags (START_HAND at the start);
//     the pack (a box in a backpack, a teammate's, the team's bags) loads straight in for both actions (2026-10-17:
//     "only reload from pack uses double action"; refused with one action left), or Get shells (1 action) takes some
//     out to hand, then Reload is 1 action;
//   - a double barrel takes both barrels (2), the sawn-off too, the pipe gun its one; the semi-auto is a tube;
//   - the AI's shotguns: the same rule, a handful out of the pack first when only the pack has shells (AI-played fights);
//   - no shells at all: refused; the Reload button and the log say how many, at hand and in the pack.
//   - a team packed for a trip carries SHELLS.CARRY shells a shotgunner at hand (a pocket or a rig pouch: carrykit.js
//     packShells, parties.js launchExpedition), out of what it packed; a side-saddle holds SADDLE more at hand;
// Then the sustained fire of a pump before (SHELLS.on = false: 4 a Reload from anywhere) and after, shots over N turns.
// Usage: node tools/shotgunreloadtest.js [seed]
import { setRounds, giveRounds, newBox } from "../src/sim/ammo.js";
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { createBattle, combatAct, registerCombatHandler, runEnemyPhase, autoPlayerTurn, canFire, loadMag, reload, reloadRefusal, endPlayerTurn, enemyStep } from "../src/sim/combat.js";
import { newItem, packOf, rigPouches } from "../src/sim/inventory.js";
import { SHELLS, shellsAt, shellRange, reloadText, reloadPlan, enemyMags } from "../src/sim/mags.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import { fitMod } from "../src/sim/gunmods.js";
import { totalRounds } from "../src/sim/ammo.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
registerCombatHandler("shotguntest", () => {});

function fighter(state, weapon, shooting = 9) {
  const s = makeSurvivor(state);
  s.skills.shooting = shooting;
  s.traits = [];
  s.health = 100;
  s.gear.weapon = newItem(weapon);
  for (const slot of ["head", "armor", "arms", "legs", "tool", "rig", "backpack"]) s.gear[slot] = null;
  s.pockets = s.pockets.map(() => null);
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
function openBattle(state, crew, ammo = 200, enemy = { kind: "raiders", count: 1, power: 3 }) {
  const h = hub(state);
  setRounds(h.stock, 0);
  if (ammo > 0) for (const s of crew) giveRounds(h.stock, ammo, [s.gear.weapon.key]);
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy, ambush: null, canRetreat: true, handler: "shotguntest", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0); b.reach.fill(1);
  b.dark = false; b.night = false;
  b.phase = "player";
  for (const u of b.units) if (u.side === "enemy") { u.aware = true; u.x = -10; u.y = -10; u.dead = true; }
  const far = b.units.find((u) => u.side === "enemy"); // one left standing far off, so the fight is not over
  if (far) { far.dead = false; far.x = b.w - 1; far.y = b.h - 1; far.hp = far.maxHp = 1e9; }
  return b;
}
const by = (b, s) => b.units.find((u) => u.sid === s.id);
const foes = (b) => b.units.filter((u) => u.side === "enemy");
const place = (u, x, y) => { u.x = x; u.y = y; u.dead = false; u.down = false; };
const logHas = (b, re) => b.log.some((l) => re.test(l.text));
// Reloads from empty with plenty at hand: the shells each puts in.
function counts(b, u, n = 40) {
  const out = [];
  for (let i = 0; i < n; i++) { loadMag(u, 0); u.ap = 2; u.hand = { buck: 1000 }; reload(b, u); out.push(u.mag); }
  return out;
}
const range = (xs) => `${Math.min(...xs)}–${Math.max(...xs)}`;

// 1. A pump with the team's shells: the handful at hand, 2–4 a Reload, the room and the shells cap it.
{
  console.log("Pump: shells a Reload");
  const st = createWorld({ seed, factionCount: 4 });
  const good = fighter(st, "shotgun", 9), poor = fighter(st, "shotgun", 0);
  const b = openBattle(st, [good, poor]);
  const g = by(b, good), p = by(b, poor);
  check(g.magMode === "internal" && g.magMax === 6 && g.mag === 6, "the pump is a tube (an internal magazine, 6), loaded at the start");
  const s0 = shellsAt(b, g);
  check(s0.box === 0 && s0.hand === SHELLS.START_HAND && s0.pack > 100, `the team's shells: a handful of ${SHELLS.START_HAND} loose at hand, the rest in the bags (${s0.at} at hand, ${s0.pack} in the pack)`);
  const cg = counts(b, g), cp = counts(b, p);
  check(cg.every((n) => n >= 3 && n <= 4) && cg.includes(3) && cg.includes(4), `Shooting 9 (aim ${Math.round(g.aim)}): 3–4 shells a Reload (${range(cg)})`);
  check(cp.every((n) => n >= 2 && n <= 3) && cp.includes(2) && cp.includes(3), `Shooting 0 (aim ${Math.round(p.aim)}): 2–3 shells a Reload (${range(cp)})`);
  check(g.ap === 1, "a Reload is 1 action");
  check(logHas(b, /racks in [34] shells \([34]\/6, \d+ left at hand\)/), "the log: \"… racks in 3 shells (3/6, 997 left at hand).\"");
  const st2 = createWorld({ seed, factionCount: 4 });
  const good2 = fighter(st2, "shotgun", 9);
  fighter(st2, "shotgun", 0);
  const b2 = openBattle(st2, [good2, st2.survivors[st2.survivors.length - 1]]);
  check(counts(b2, by(b2, good2)).join() === cg.join(), "paired: the same seed, the same shells Reload by Reload");
  g.hand = { buck: 1000 };
  loadMag(g, 5); g.ap = 2; reload(b, g);
  check(g.mag === 6, "5/6: one shell goes in (the tube's room)");
  loadMag(g, 4); g.ap = 2; reload(b, g);
  check(g.mag === 6, "4/6: two go in (6/6)");
  g.hand = { buck: 2 };
  loadMag(g, 0); g.ap = 2; reload(b, g);
  check(g.mag === 2 && shellsAt(b, g).hand === 0, `2 loose at hand: 2 go in, none left at hand (${g.mag})`);
  for (const o of b.pools) setRounds(o, 0);
  loadMag(g, 0); g.ap = 2; g.hand = { buck: 5 };
  check(/no ammo/i.test(reloadRefusal(b, g)) && /no ammo/i.test(combatAct(st, { type: "reload", unit: g.id })) && g.ap === 2, "no shells at all (the hand's 5 were the team's, all gone): Reload refused, no action spent");
  b.pools[0].a_12ga_buck = 50;
  loadMag(g, 0); loadMag(p, 0); g.hand = { buck: 8 }; p.hand = { buck: 8 };
  check(/1 action: 3–4 shells thumbed into the tube \(steady hands \+1\), from the shells at hand\. 8 shells at hand, 42 in the pack/.test(reloadText(b, g)), `the Reload button: "${reloadText(b, g)}"`);
  check(/1 action: 2–3 shells/.test(reloadText(b, p)), "the Reload button (unsteady): 2–3 shells");
  g.hp = 30;
  const ch = counts(b, g, 20);
  check(ch.every((n) => n >= 2 && n <= 3), `hurt below half: one fewer (${range(ch)})`);
  check(/shaken −1/.test(reloadText(b, g)), "the button says shaken −1");
  g.hp = 100; g.suppressed = 1; g.hand = { buck: 8 };
  check(shellRange(b, g).hi === 3, "pinned by suppressing fire: one fewer too");
  g.suppressed = 0;
}

// 2. The pack takes both actions (refused with one), or Get shells (1 action), then Reload (1 action).
{
  console.log("The pack: both actions, or Get shells first");
  const st = createWorld({ seed: seed + 1, factionCount: 4 });
  const a = fighter(st, "shotgun", 9);
  const b = openBattle(st, [a]);
  const u = by(b, a);
  u.hand = { buck: 0 }; loadMag(u, 0); u.ap = 2;
  const pl = reloadPlan(b, u);
  check(pl.mode === "tube" && pl.from === "pack" && pl.cost === 2 && reloadRefusal(b, u) === "", `nothing at hand, shells in the bags: the plan is a Reload straight out of the pack, both actions (${pl.mode} from ${pl.from}, ${pl.cost})`);
  u.ap = 1;
  const r1 = reloadRefusal(b, u);
  check(/both actions to reload from the pack/.test(r1) && combatAct(st, { type: "reload", unit: u.id }) === r1 && u.ap === 1 && u.mag === 0, `with one action left it is refused: "${r1}"`);
  check(/^Both actions: 3–4 shells thumbed into the tube .*dug out of the pack/.test(reloadText(b, u)) && /0 shells at hand, \d+ in the pack/.test(reloadText(b, u)), `the Reload button says so, with what is at hand and in the pack ("${reloadText(b, u)}")`);
  u.ap = 2;
  check(combatAct(st, { type: "getshells", unit: u.id }) === "" && u.ap === 1 && shellsAt(b, u).hand === SHELLS.GRAB, `Get shells: 1 action, ${SHELLS.GRAB} out of the pack loose at hand`);
  check(logHas(b, new RegExp(`${a.name} takes ${SHELLS.GRAB} shells of 12 gauge .*buckshot out of the pack \\(${SHELLS.GRAB} at hand\\)`)), "the log: \"… takes 8 shells of 12 gauge buckshot out of the pack (8 at hand).\"");
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.mag >= 3 && u.ap === 0, `then Reload: ${u.mag} in, the turn's two actions spent`);
  b.phase = "player"; u.ap = 2; u.hand = { buck: SHELLS.HAND_MAX };
  const rf = combatAct(st, { type: "getshells", unit: u.id });
  check(/room for no more/.test(rf) && u.ap === 2, `${SHELLS.HAND_MAX} loose at hand already: Get shells refused ("${rf}")`);
  // A box in the backpack only (the team has none): the same.
  const st2 = createWorld({ seed: seed + 2, factionCount: 4 });
  const c = fighter(st2, "shotgun", 9);
  c.gear.backpack = newItem("backpack");
  packOf(c)[0] = newBox("a_12ga_buck", 25);
  const b2 = openBattle(st2, [c], 0);
  const v = by(b2, c);
  const sv = shellsAt(b2, v);
  check(sv.at === 0 && sv.pack === 19, `a box in the backpack only: none at hand, 19 in the pack (6 loaded) (${sv.at} / ${sv.pack})`);
  loadMag(v, 0); v.ap = 2;
  check(combatAct(st2, { type: "reload", unit: v.id }) === "" && v.ap === 0 && v.mag >= 3 && logHas(b2, /racks in [34] shells out of the pack \([34]\/6, 0 left at hand(, shaky hands)?, both actions\)/), `a Reload straight from the pack: both actions, ${v.mag} in ("… racks in 3 shells out of the pack (3/6, 0 left at hand, both actions).")`);
  b2.phase = "player"; loadMag(v, 0); v.ap = 2;
  check(combatAct(st2, { type: "getshells", unit: v.id }) === "" && combatAct(st2, { type: "reload", unit: v.id }) === "" && v.mag >= 3 && v.ap === 0, `or Get shells, then Reload (1 action each): ${v.mag} in`);
}

// 3. At hand: a box in a pocket, a box in a rig pouch (no Get shells needed); shots spend them first.
{
  console.log("Pockets and rig");
  const st = createWorld({ seed: seed + 3, factionCount: 4 });
  const pk = fighter(st, "shotgun", 9), rg = fighter(st, "shotgun", 9);
  pk.pockets[0] = newBox("a_12ga_buck", 25);
  rg.gear.rig = newItem("chestrig");
  rigPouches(rg)[0] = newBox("a_12ga_buck", 25);
  rg.gear.backpack = newItem("backpack");
  packOf(rg)[0] = newBox("a_12ga_buck", 25);
  const b = openBattle(st, [pk, rg], 0, { kind: "raiders", count: 1, power: 3 });
  const u = by(b, pk), w = by(b, rg), t = foes(b)[0];
  check(u.handBoxes === 1 && w.handBoxes === 1 && w.boxes.length === 2 && w.boxes[0] === rigPouches(rg)[0], "the pocket's box and the rig pouch's box are at hand (the rig's ahead of the pack's in u.boxes)");
  check(shellsAt(b, u).at === 19 && shellsAt(b, w).at === 19 && shellsAt(b, w).pack === 50 && shellsAt(b, u).hand === 0, `25 in the box, 6 loaded: 19 at hand (no handful needed); the pack: its own box and the teammate's (${JSON.stringify(shellsAt(b, u))} ${JSON.stringify(shellsAt(b, w))})`);
  place(w, 5, 5); place(t, 7, 5); t.hp = t.maxHp = 1e9;
  let fired = 0;
  for (let i = 0; i < 30 && fired < 20; i++) { b.phase = "player"; w.ap = 2; w.jam = null; if (canFire(b, w)) { if (combatAct(st, { type: "shoot", unit: w.id, target: t.id }) === "") fired++; } else combatAct(st, { type: "reload", unit: w.id }); }
  check(rigPouches(rg)[0].dur === 5 && packOf(rg)[0].dur === 25, `20 shots: out of the rig's box first (rig ${rigPouches(rg)[0].dur}, pack ${packOf(rg)[0].dur})`);
  loadMag(u, 0); u.ap = 2;
  check(combatAct(st, { type: "reload", unit: u.id }) === "" && u.mag >= 3, `the pocket's box reloads straight away (${u.mag})`);
}

// 4. The double barrel: both barrels, 2; the semi-auto shotgun is a tube; the pipe gun one shell.
{
  console.log("Double barrel, semi-auto, pipe gun");
  const st = createWorld({ seed: seed + 4, factionCount: 4 });
  const d = fighter(st, "dbshotgun", 0), so = fighter(st, "sawnoff", 9), se = fighter(st, "semishotgun", 9), pg = fighter(st, "pipegun", 9);
  const b = openBattle(st, [d, so, se, pg]);
  const ud = by(b, d), us = by(b, so), ue = by(b, se), upg = by(b, pg);
  check(counts(b, ud, 10).every((n) => n === 2) && ud.ap === 1, "the double barrel: one Reload, both barrels (2/2), 1 action");
  check(counts(b, us, 10).every((n) => n === 2), "the sawn-off too");
  loadMag(ud, 1); ud.ap = 2; reload(b, ud);
  check(ud.mag === 2, "one barrel fired: 1 in (2/2)");
  check(logHas(b, /breaks open the double-barrel shotgun and drops in 2 shells \(2\/2, \d+ left at hand\)/), "the log: \"… breaks open the double-barrel shotgun and drops in 2 shells (2/2, … left at hand).\"");
  loadMag(ud, 0);
  check(/both barrels/.test(reloadText(b, ud)), `the Reload button says both barrels ("${reloadText(b, ud)}")`);
  ud.hand = { buck: 0 }; loadMag(ud, 0); ud.ap = 2;
  check(reloadPlan(b, ud).mode === "break" && reloadPlan(b, ud).from === "pack" && combatAct(st, { type: "reload", unit: ud.id }) === "" && ud.mag === 2 && ud.ap === 0 && logHas(b, /drops in 2 shells out of the pack \(2\/2, 0 left at hand, both actions\)/), "the double barrel with none at hand: both barrels straight out of the pack, both actions");
  const ce = counts(b, ue, 20);
  check(ue.magMode === "internal" && ce.every((n) => n >= 3 && n <= 4), `the semi-auto shotgun: a tube, 3–4 (${range(ce)})`);
  check(counts(b, upg, 5).every((n) => n === 1), "the pipe gun: its one shell");
}

// 5. The AI's shotguns: the same rule, the extra action spent when the pack is all there is.
{
  console.log("AI parity");
  const st = createWorld({ seed: seed + 5, factionCount: 4 });
  const a = fighter(st, "pistol");
  const b = openBattle(st, [a], 200, { kind: "raiders", count: 2, power: 3 });
  const e = foes(b)[0];
  e.weapon = "shotgun"; e.weaponName = "Pump shotgun"; e.item = null; e.arsItem = null; e.modItems = null;
  enemyMags(e, 6, 0, false);
  loadMag(e);
  check(e.magMode === "internal" && e.hand && e.hand.buck === SHELLS.START_HAND, `an enemy's pump: a tube, ${SHELLS.START_HAND} loose shells at hand`);
  const steady = e.aim >= SHELLS.STEADY_AIM;
  const ce = counts(b, e, 30);
  check(ce.every((n) => n >= (steady ? 3 : 2) && n <= (steady ? 4 : 3)), `an enemy (aim ${Math.round(e.aim)}): ${steady ? "3–4" : "2–3"} shells a Reload (${range(ce)})`);
  e.hand = { buck: 0 }; loadMag(e, 0); e.ap = 2;
  reload(b, e);
  check(e.mag >= 2 && e.ap === 0 && logHas(b, /racks in \d shells out of a bag \(\d\/6, both actions\)/), `none at hand: the enemy's own Reload digs shells straight out of a bag, both actions (${e.mag})`);
  // The enemy AI prefers a handful out of the bag (1 action) and a Reload from it (1 action): more at hand for the next.
  e.hand = { buck: 0 }; loadMag(e, 0);
  endPlayerTurn(st);
  let n = 0;
  while (b.phase === "enemy" && n++ < 20) enemyStep(st);
  check(logHas(b, /digs 8 shells out of a bag \(8 at hand\)/) && e.mag >= 2, `the enemy AI with none at hand: digs a handful out of a bag (1 action), then loads from it (${e.mag}/6)`);
  b.phase = "player";
  // Fights played by the AI: your side's shotguns with only the team's bags behind the handful, theirs too.
  const st2 = createWorld({ seed: seed + 6, factionCount: 4 });
  const crew = [fighter(st2, "shotgun", 5), fighter(st2, "shotgun", 7), fighter(st2, "dbshotgun", 4)];
  const h = hub(st2);
  setRounds(h.stock, 0); giveRounds(h.stock, 120, ["shotgun"]);
  const b2 = (st2.combat = createBattle(st2, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy: { kind: "raiders", count: 5, power: 4 }, ambush: null, canRetreat: true, handler: "shotguntest", context: {} }));
  for (const u of b2.units) if (u.side === "player" && u.hand) u.hand = { buck: 2 }; // a small handful: the pack is soon needed
  for (let t = 0; t < 80 && !b2.over; t++) { autoPlayerTurn(st2, { retreat: false }); runEnemyPhase(st2); }
  check(b2.over, `an AI-played fight with pumps and a double barrel ends (turn ${b2.turn})`);
  check(logHas(b2, /racks in \d shells?|breaks open the double-barrel/), "with shotgun reloads by the new rule");
  // Your side's AI with an empty pump and nothing at hand: the extra action, then the Reload.
  const st3 = createWorld({ seed: seed + 7, factionCount: 4 });
  const c3 = fighter(st3, "shotgun", 7);
  const b3 = openBattle(st3, [c3], 100, { kind: "raiders", count: 1, power: 3 });
  const u3 = by(b3, c3), t3 = foes(b3)[0];
  place(u3, 5, 5); place(t3, 9, 5); t3.hp = t3.maxHp = 1e9;
  u3.hand = { buck: 0 }; loadMag(u3, 0); u3.ap = 2;
  autoPlayerTurn(st3, { retreat: false });
  check(logHas(b3, new RegExp(`${c3.name} takes \\d+ shells of .* out of the pack`)) && u3.mag >= 2, `your side's AI, nothing at hand: takes shells out of the pack (1 action), then reloads (${u3.mag}/6)`);
}

// 6. Sustained fire: a pump shooting whenever it can (a shot ends the turn), reloading when empty, from full, 30 turns,
// before (SHELLS.on = false: 4 shells a Reload from anywhere) and after. "stand": 2 actions a turn; "move": 1 action a
// turn (the other spent moving). Shells: the team's bags (the handful, then Get shells) or 3 boxes in the pockets.
{
  console.log("Sustained fire (shots in 10 / 30 turns, a pump from full, 8 seeds)");
  const run = (shooting, pocket, on, s0, apTurn) => {
    SHELLS.on = on;
    try {
      const st = createWorld({ seed: s0, factionCount: 4 });
      const f = fighter(st, "shotgun", shooting);
      if (pocket) for (let i = 0; i < 3; i++) f.pockets[i] = newBox("a_12ga_buck", 25);
      const b = openBattle(st, [f], pocket ? 0 : 400, { kind: "raiders", count: 1, power: 3 });
      const u = by(b, f), t = foes(b)[0];
      place(u, 5, 5); place(t, 7, 5); t.hp = t.maxHp = 1e9;
      const shots = [];
      let n = 0;
      for (let turn = 1; turn <= 30; turn++) {
        b.phase = "player"; u.ap = apTurn; u.cd = 0;
        for (let guard = 0; u.ap > 0 && guard < 4; guard++) {
          u.jam = null;
          if (canFire(b, u)) { if (combatAct(st, { type: "shoot", unit: u.id, target: t.id }) === "") n++; break; }
          if (combatAct(st, { type: "reload", unit: u.id }) === "") continue;
          if (combatAct(st, { type: "getshells", unit: u.id }) !== "") break;
        }
        shots.push(n);
      }
      return { s10: shots[9], s30: shots[29] };
    } finally { SHELLS.on = true; }
  };
  const avg = (shooting, pocket, on, apTurn) => { let a = 0, c = 0; for (let i = 0; i < 8; i++) { const r = run(shooting, pocket, on, seed + 100 + i, apTurn); a += r.s10; c += r.s30; } return { s10: a / 8, s30: c / 8 }; };
  for (const apTurn of [2, 1]) for (const [label, sh, pk] of [["Shooting 3, team's bags", 3, false], ["Shooting 9, team's bags", 9, false], ["Shooting 3, boxes in pockets", 3, true], ["Shooting 9, boxes in pockets", 9, true]]) {
    const before = avg(sh, pk, false, apTurn), after = avg(sh, pk, true, apTurn);
    console.log(`    ${apTurn === 2 ? "stand" : "move "} ${label.padEnd(30)} before ${before.s10.toFixed(1)} / ${before.s30.toFixed(1)}   after ${after.s10.toFixed(1)} / ${after.s30.toFixed(1)}  (${Math.round((after.s30 / before.s30 - 1) * 100)}% over 30 turns)`);
    // Standing, the shells model is about as fast as a plain internal magazine (a seed's worth of noise); moving (one action
    // a turn) a plain pump can never reload out of the team's bags (both actions), so Get shells and 1-action Reloads are
    // the way a moving shotgunner keeps firing: faster than that baseline by design, never crippled.
    check(after.s30 >= before.s30 * 0.5 && (apTurn === 1 || after.s30 <= before.s30 * 1.1 + 1e-9), `${apTurn === 2 ? "standing" : "moving"}, ${label}: ${apTurn === 2 ? "about as fast as before" : "no slower than before"}, not crippled`);
  }
}

// 7. Packed for a trip: shells at hand out of the packed rounds; a side-saddle's.
{
  console.log("Shells at hand for a trip");
  const st = createWorld({ seed: seed + 9, factionCount: 4 });
  st.started = true;
  const h = hub(st);
  const sg = fighter(st, "shotgun", 7), db = fighter(st, "dbshotgun", 5), pi = fighter(st, "pistol", 5);
  sg.pockets[0] = newItem("headlamp");
  setRounds(h.stock, 0); giveRounds(h.stock, 300, ["shotgun", "pistol"]);
  const dest = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 2).id;
  const res = launchExpedition(st, { memberIds: [sg.id, db.id, pi.id], dest, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { ammo: 150, food: 3, water: 3 } });
  const p = res.party;
  check(!!p, `a team of a pump, a double barrel and a pistol sets out (${res.error || "ok"})`);
  if (p) {
    const shellsOn = (s) => s.pockets.filter((x) => x && /^a_12ga_/.test(x.key)).reduce((a, x) => a + x.dur, 0);
    const packed = totalRounds(p.supplies) + partyMembers(st, p).reduce((a, s) => a + shellsOn(s), 0);
    check(shellsOn(sg) === SHELLS.CARRY && shellsOn(db) === SHELLS.CARRY && shellsOn(pi) === 0, `each shotgunner carries ${SHELLS.CARRY} shells in a pocket (${shellsOn(sg)}, ${shellsOn(db)}; the pistol none)`);
    check(packed === 150, `out of what the team packed: ${totalRounds(p.supplies)} in the pack + ${shellsOn(sg) + shellsOn(db)} at hand = ${packed} of 150`);
    const b = (st.combat = createBattle(st, { tile: dest, partyId: p.id, enemy: { kind: "raiders", count: 1, power: 3 }, ambush: null, canRetreat: true, handler: "shotguntest", context: {} }));
    const u = by(b, sg), s0 = shellsAt(b, u);
    check(u.mag === 6 && s0.box === SHELLS.CARRY - 6 && s0.at === SHELLS.CARRY - 6 && s0.hand === 0, `in the fight: 6 in the tube and ${s0.at} at hand out of the pocket's ${SHELLS.CARRY} (no loose handful needed), ${s0.pack} in the pack`);
    const d = by(b, db), sd = shellsAt(b, d);
    check(sd.at === SHELLS.CARRY - 2, `the double barrel: 2 in the barrels, ${sd.at} at hand`);
    st.combat = null;
  }
  // Packed again with shells already at hand: topped up to CARRY, not more.
  const st2 = createWorld({ seed: seed + 10, factionCount: 4 });
  st2.started = true;
  const h2 = hub(st2);
  const sg2 = fighter(st2, "shotgun", 7);
  sg2.pockets[1] = newBox("a_12ga_buck", 10);
  setRounds(h2.stock, 0); giveRounds(h2.stock, 200, ["shotgun"]);
  const dest2 = st2.tiles.find((t) => t.terrain !== "water" && st2.grid.distance(t.id, h2.tile) === 2).id;
  const r2 = launchExpedition(st2, { memberIds: [sg2.id], dest: dest2, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { ammo: 60, food: 2, water: 2 } });
  const at2 = sg2.pockets.filter((x) => x && /^a_12ga_/.test(x.key)).reduce((a, x) => a + x.dur, 0);
  check(!!r2.party && at2 === SHELLS.CARRY && sg2.pockets.filter((x) => x && /^a_12ga_/.test(x.key)).length === 1, `a pocket box of 10 is topped up to ${SHELLS.CARRY} (${at2}, one stack)`);
  // A small box in a pocket: the gun loads out of it, the loose handful tops up to START_HAND beyond the gun's load.
  {
    const st4 = createWorld({ seed: seed + 12, factionCount: 4 });
    const f4 = fighter(st4, "shotgun", 7);
    f4.pockets[0] = newBox("a_12ga_buck", 8);
    const b4 = openBattle(st4, [f4], 200);
    const s4 = shellsAt(b4, by(b4, f4));
    check(s4.at === SHELLS.START_HAND && s4.box === 2 && s4.hand === SHELLS.START_HAND - 2, `a box of 8 in a pocket: 6 of it in the tube, ${s4.at} at hand (2 boxed + ${s4.hand} loose), as many as with none`);
    st4.combat = null;
  }
  // A side-saddle: SADDLE more at hand, the handful and the most kept loose.
  const st3 = createWorld({ seed: seed + 11, factionCount: 4 });
  const a3 = fighter(st3, "shotgun", 7), b3f = fighter(st3, "shotgun", 7);
  fitMod(a3.gear.weapon, newItem("sidesaddle"));
  const b3 = openBattle(st3, [a3, b3f], 200);
  const ua = by(b3, a3), ub = by(b3, b3f);
  check(shellsAt(b3, ua).hand === SHELLS.START_HAND + SHELLS.SADDLE && shellsAt(b3, ub).hand === SHELLS.START_HAND, `a side-saddle holds ${SHELLS.SADDLE} more at hand (${shellsAt(b3, ua).hand} against ${shellsAt(b3, ub).hand})`);
  ua.hand = { buck: SHELLS.HAND_MAX }; ub.hand = { buck: SHELLS.HAND_MAX }; ua.ap = 2; ub.ap = 2;
  check(combatAct(st3, { type: "getshells", unit: ua.id }) === "" && combatAct(st3, { type: "getshells", unit: ub.id }) !== "", `with ${SHELLS.HAND_MAX} loose, Get shells still has room on the saddled pump, not on the bare one`);
  st3.combat = null;
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
