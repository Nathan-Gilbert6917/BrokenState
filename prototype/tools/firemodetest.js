// Fire modes, sustained overwatch, suppressing fire and over-penetration (src/sim/gunfire.js, combat.js fire / suppress /
// moveAlong / aiUnit; plan section 20). Checks: each gun's modes and its default (the assault rifle's old 2-round shot
// is its burst), act "firemode" (free, refused for a mode the gun lacks), the rounds a trigger pull takes, each round
// rolling its own hit at the mode's aim with recoil, sustained overwatch (every mover once, until the magazine runs dry
// or the gun jams, over at the watcher's next turn, in its fire mode), suppressing fire (who is pinned, −20 aim, no
// overwatch, nothing to the dead, ends with their turn, the refusals, enemies use it on you), over-penetration (the
// next unit in line, × 0.6, either side, light cover only for AP and the .50, a wall stops it), the sniper's AI sense.
// Usage: node tools/firemodetest.js [seed]
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { WEAPONS, CELL, createBattle, combatAct, registerCombatHandler, runEnemyPhase, endPlayerTurn, shotOdds, fire, magIn, loadMag, moveAlong, canFire } from "../src/sim/combat.js";
import { FIRE_MODES, modesOf, modeRounds, modeAim, syncModes, coneTargets, nextInLine, sniperCell, SUPPRESS, jamGun, gunModes } from "../src/sim/gunfire.js";
import { AMMO_TYPES } from "../src/sim/data-ammo.js";
import { newItem } from "../src/sim/inventory.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
registerCombatHandler("fmtest", () => {});

function fighter(state, weapon = "ar", shooting = 9) {
  const s = makeSurvivor(state);
  s.skills.shooting = shooting;
  s.traits = [];
  s.health = 100;
  s.gear.weapon = weapon ? newItem(weapon) : null;
  for (const slot of ["head", "armor", "arms", "legs", "tool"]) s.gear[slot] = null;
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
function openBattle(state, crew, enemy = { kind: "raiders", count: 3, power: 3 }, ammo = 500) {
  const h = hub(state);
  h.stock.ammo = ammo; h.stock.meds = 0;
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy, ambush: null, canRetreat: true, handler: "fmtest", context: {} }));
  for (const c of b.cells) { c.k = "open"; delete c.h; delete c.t; }
  b.losCache.fill(0);
  b.reach.fill(1);
  b.dark = false; b.night = false; b.jamWx = 1;
  b.phase = "player";
  for (const u of b.units) if (u.side === "enemy") { u.aware = true; u.x = -10; u.y = -10; u.dead = true; }
  return b;
}
const by = (b, s) => b.units.find((u) => u.sid === s.id);
const foes = (b) => b.units.filter((u) => u.side === "enemy");
const place = (u, x, y) => { u.x = x; u.y = y; u.dead = false; u.down = false; u.hp = u.maxHp; };
const toughen = (u) => { u.hp = u.maxHp = 100000; };
const logHas = (b, re) => b.log.some((l) => re.test(l.text));
const logCount = (b, re) => b.log.filter((l) => re.test(l.text)).length;
const noJams = () => { const keep = {}; for (const k of Object.keys(WEAPONS)) { keep[k] = WEAPONS[k].rel; if (WEAPONS[k].rel) WEAPONS[k].rel = 0; } return () => { for (const k of Object.keys(keep)) WEAPONS[k].rel = keep[k]; }; };

// 1. Modes.
{
  console.log("Fire modes");
  check(JSON.stringify(gunModes(WEAPONS.ar)) === JSON.stringify({ single: 1, burst: 2, auto: 10 }), "the assault rifle: single 1, burst 2, full auto 10 rounds");
  check(JSON.stringify(gunModes(WEAPONS.carbine)) === JSON.stringify({ single: 1 }), "the police carbine is semi-automatic: single only");
  check(gunModes({ modes: ["single", "burst", "auto"], burst: 3, auto: 15 }).burst === 3 && gunModes({ modes: ["single", "auto"] }).auto === FIRE_MODES.auto.rounds, "modes as a list of names also work (rounds from w.burst / w.auto or the defaults)");
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st, "ar"), c = fighter(st, "pistol");
  const b = openBattle(st, [a, c]);
  const p = by(b, a), q = by(b, c), e = foes(b).find((x) => x.kind === "human");
  place(p, 5, 5); place(q, 5, 8); place(e, 12, 5); toughen(e);
  check(p.mode === "burst" && JSON.stringify(p.modes) === JSON.stringify(["single", "burst", "auto"]), "an assault rifle starts in burst (what its old 2-round shot was)");
  check(q.mode === "single" && JSON.stringify(q.modes) === JSON.stringify(["single"]) && JSON.stringify(modesOf({ weapon: "knife" })) === "[]", "a pistol: single only; a knife: no modes");
  const single = shotOdds(b, { ...p, mode: "single" }, e).chance, burst = shotOdds(b, p, e).chance;
  check(single - burst === -FIRE_MODES.burst.aim || single === 95, `a burst's first round aims ${FIRE_MODES.burst.aim} (${single}% → ${burst}%), each round after ${FIRE_MODES.burst.recoil} more; full auto ${FIRE_MODES.auto.aim} and ${FIRE_MODES.auto.recoil} a round`);
  check(modeAim("burst", 1) === FIRE_MODES.burst.aim + FIRE_MODES.burst.recoil && modeAim("auto", 4) === FIRE_MODES.auto.aim + 4 * FIRE_MODES.auto.recoil && modeAim("single", 3) === 0, "recoil grows with every round");
  const ap = p.ap;
  check(combatAct(st, { type: "firemode", unit: p.id, mode: "auto" }) === "" && p.mode === "auto" && p.ap === ap, "act firemode: full auto, free (no action spent)");
  check(/no burst mode/i.test(combatAct(st, { type: "firemode", unit: q.id, mode: "burst" })) && q.mode === "single", "a mode the gun lacks is refused");
  check(combatAct(st, { type: "firemode", unit: p.id }) === "" && p.mode === "single", "no mode given: the next one (auto → single)");
  // Rounds per trigger pull, each rolling its own hit.
  const restore = noJams();
  const m0 = magIn(p);
  combatAct(st, { type: "firemode", unit: p.id, mode: "single" });
  fire(b, p, e);
  check(magIn(p) === m0 - 1, `single: 1 round (${m0} → ${magIn(p)})`);
  combatAct(st, { type: "firemode", unit: p.id, mode: "burst" });
  fire(b, p, e);
  check(magIn(p) === m0 - 3 && logHas(b, /fires a burst at/), "burst: 2 rounds, one line for the burst");
  combatAct(st, { type: "firemode", unit: p.id, mode: "auto" });
  loadMag(p);
  fire(b, p, e);
  check(magIn(p) === magIn({ ...p, mag: null }) - 10 && logHas(b, /fires a stream at/), "full auto: 10 rounds");
  loadMag(p, 4);
  fire(b, p, e);
  check(magIn(p) === 0, "a stream with 4 rounds left fires the 4");
  // Each round its own roll: at about 50% a burst of 2 lands 0, 1 or 2.
  combatAct(st, { type: "firemode", unit: p.id, mode: "burst" });
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    loadMag(p);
    b.log.length = 0;
    fire(b, p, e);
    const l = b.log.find((x) => /fires a burst/.test(x.text));
    if (!l) continue;
    const m = /: (\d) of 2 hit/.exec(l.text);
    seen.add(m ? Number(m[1]) : 0);
  }
  check(seen.has(0) && seen.has(1) && seen.has(2), `bursts of 2 land 0, 1 and 2 hits (${[...seen].sort().join(", ")})`);
  restore();
  // The AI's mode: enemies burst at a target in reach, a sniper single.
  check(modeRounds({ weapon: "ar", mode: "auto", modesW: "ar" }, "auto") === 10 && modeRounds({ weapon: "pistol" }) === 1, "rounds by mode (a gun without modes: its rounds a shot)");
}

// 2. Sustained overwatch.
{
  console.log("Sustained overwatch");
  const restore = noJams();
  const st = createWorld({ seed: seed + 1, factionCount: 4 });
  const a = fighter(st, "ar");
  const b = openBattle(st, [a], { kind: "raiders", count: 3, power: 3 });
  const p = by(b, a);
  const [e1, e2, e3] = foes(b).filter((x) => x.kind === "human");
  place(p, 3, 6); toughen(p);
  place(e1, 12, 3); place(e2, 12, 9); place(e3, 25, 20); toughen(e1); toughen(e2);
  combatAct(st, { type: "firemode", unit: p.id, mode: "single" });
  combatAct(st, { type: "overwatch", unit: p.id });
  check(p.ow, "on overwatch");
  b.phase = "enemy";
  moveAlong(b, e1, [[11, 3], [10, 3], [9, 3]]);
  moveAlong(b, e2, [[11, 9], [10, 9]]);
  check(logCount(b, new RegExp(`${p.name} reacts on overwatch`)) === 2 && p.ow, "it reacts to every enemy that moves in range (two movers: two reactions) and stays on watch");
  moveAlong(b, e1, [[8, 3], [7, 3]]);
  check(logCount(b, new RegExp(`${p.name} reacts on overwatch`)) === 3, "the same one moving again draws another (once a move, not once a step)");
  moveAlong(b, e3, [[24, 20]]);
  check(logCount(b, new RegExp(`${p.name} reacts on overwatch`)) === 3, "one moving out of range draws nothing");
  p.mode = "auto"; // (set in the player's turn; the act is refused while the enemy moves)
  loadMag(p, 10);
  moveAlong(b, e2, [[9, 9]]);
  check(!p.ow && magIn(p) === 0 && logHas(b, /fires a stream at/), "in full auto the stream empties the magazine and the watch is over");
  p.ow = true; loadMag(p);
  jamGun(b, p, "stovepipe");
  moveAlong(b, e1, [[6, 3]]);
  check(!p.ow || !canFire(b, p), "a jammed gun does not react");
  p.jam = null; p.ow = true;
  b.phase = "player";
  endPlayerTurn(st);
  runEnemyPhase(st);
  check(!p.ow, "the watch ends when its own turn comes round");
  // Pinned watchers do not react.
  const st2 = createWorld({ seed: seed + 2, factionCount: 4 });
  const a2 = fighter(st2, "pistol");
  const b2 = openBattle(st2, [a2]);
  const p2 = by(b2, a2), f2 = foes(b2).find((x) => x.kind === "human");
  place(p2, 3, 6); place(f2, 12, 6); toughen(f2);
  combatAct(st2, { type: "overwatch", unit: p2.id });
  p2.suppressed = 1;
  b2.phase = "enemy";
  moveAlong(b2, f2, [[11, 6]]);
  check(!logHas(b2, /reacts on overwatch/) && !p2.ow, "pinned by suppressing fire: no reaction, the watch is lost");
  restore();
}

// 3. Suppressing fire.
{
  console.log("Suppressing fire");
  const restore = noJams();
  const st = createWorld({ seed: seed + 3, factionCount: 4 });
  const a = fighter(st, "ar"), c = fighter(st, "pistol");
  const b = openBattle(st, [a, c], { kind: "mixed", count: 5, power: 3 });
  const p = by(b, a), q = by(b, c);
  const people = foes(b).filter((x) => x.kind === "human"), dead = foes(b).filter((x) => x.kind === "zombie");
  check(people.length >= 2 && dead.length >= 1, `a mixed group to pin (${people.length} people, ${dead.length} dead)`);
  place(p, 3, 6); place(q, 3, 10);
  place(people[0], 12, 6); place(people[1], 12, 7); place(dead[0], 12, 5);
  if (people[2]) place(people[2], 12, 16);
  for (const u of [...people, ...dead]) toughen(u);
  people[0].ow = true;
  const inCone = coneTargets(b, p, 12, 6, foes(b).filter((x) => !x.dead));
  check(inCone.includes(people[0]) && inCone.includes(people[1]) && !inCone.includes(dead[0]) && !inCone.includes(people[2]), "the cone: the two people ahead, not the dead among them, not one off to the side");
  check(/bursts or full auto/.test(combatAct(st, { type: "suppress", unit: q.id, target: people[0].id })), "a pistol cannot lay down suppressing fire");
  const m0 = magIn(p);
  const before = shotOdds(b, people[0], p).chance;
  check(combatAct(st, { type: "suppress", unit: p.id, target: people[0].id }) === "" && p.ap === 0, "the assault rifle suppresses (the turn's actions)");
  check(magIn(p) === m0 - 10, `mag-hungry: a 10-round stream (${m0} → ${magIn(p)})`);
  check(people[0].suppressed && people[1].suppressed && !dead[0].suppressed && !(people[2] && people[2].suppressed), "both people in the cone are pinned; the dead are not");
  check(!people[0].ow, "the pinned lose their overwatch");
  const after = shotOdds(b, people[0], p).chance;
  check(before - after === SUPPRESS.AIM || after === 5, `pinned: −${SUPPRESS.AIM} aim (${before}% → ${after}%)`);
  check(logHas(b, /lays down suppressing fire/) && logHas(b, /pinned/), "logged");
  // Pinned humans keep their heads down (the AI), and it ends with their turn.
  combatAct(st, { type: "end" });
  runEnemyPhase(st);
  check(!people[0].suppressed && !people[1].suppressed, "pinned until their own turn ends");
  // Enemies with automatic guns suppress you.
  const st2 = createWorld({ seed: seed + 4, factionCount: 4 });
  const a2 = fighter(st2, "pistol"), c2 = fighter(st2, "pistol");
  const b2 = openBattle(st2, [a2, c2], { kind: "soldiers", count: 1, power: 3 });
  const p2 = by(b2, a2), q2 = by(b2, c2), s2 = foes(b2)[0];
  place(p2, 12, 6); place(q2, 12, 7); place(s2, 3, 6); toughen(p2); toughen(q2); toughen(s2);
  s2.weapon = "ar"; s2.modesW = null; syncModes(s2); loadMag(s2); s2.aim = 0; // a poor shot: no fair shot to take
  combatAct(st2, { type: "end" });
  runEnemyPhase(st2);
  check(logHas(b2, new RegExp(`${s2.name} lays down suppressing fire`)) && (p2.suppressed || q2.suppressed), "an enemy with an assault rifle pins two of yours");
  check(/Pinned down/.test(combatAct(st2, { type: "overwatch", unit: (p2.suppressed ? p2 : q2).id })), "your pinned people cannot overwatch");
  restore();
}

// 4. Over-penetration.
{
  console.log("Over-penetration");
  const restore = noJams();
  const keep = AMMO_TYPES.fmj.overpen["308"];
  AMMO_TYPES.fmj.overpen["308"] = 1; // every hit carries on (the real chance: 15%)
  const st = createWorld({ seed: seed + 5, factionCount: 4 });
  const a = fighter(st, "huntrifle", 20), c = fighter(st, "pistol");
  const b = openBattle(st, [a, c], { kind: "zombies", count: 3, power: 2 });
  const p = by(b, a), q = by(b, c);
  const [z1, z2, z3] = foes(b);
  place(p, 3, 6); place(q, 3, 12); place(z1, 6, 6); place(z2, 8, 6); place(z3, 20, 20);
  toughen(z1); toughen(z2);
  p.aim = 400;
  check(nextInLine(b, p, z1, false) && nextInLine(b, p, z1, false).unit === z2, "the next unit in line behind the target");
  const h2 = z2.hp;
  fire(b, p, z1);
  check(z2.hp < h2 && logHas(b, /goes through/), `the round carries on into the one behind (${Math.round(h2 - z2.hp)} at × 0.6)`);
  const raw = WEAPONS.huntrifle.dmg[1] * 2 * p.dmgMult;
  check(h2 - z2.hp <= raw * 0.6 + 1e-9, "at × 0.6 or less");
  // Your own people too.
  place(q, 8, 6); q.hp = q.maxHp = 100000; place(z2, 20, 21);
  const hq = q.hp;
  for (let i = 0; i < 5 && q.hp === hq; i++) { loadMag(p); fire(b, p, z1); }
  check(q.hp < hq, "either side: a round through one of the dead can hit your own person behind it");
  place(q, 3, 12);
  // Cover: a crate stops an FMJ round, not an AP one; a wall stops both.
  place(z2, 8, 6); z2.hp = h2;
  b.cells[6 * b.w + 7].k = "crate";
  b.losCache.fill(0);
  check(!nextInLine(b, p, z1, false), "a crate between them stops a common round");
  check(nextInLine(b, p, z1, true) && nextInLine(b, p, z1, true).pierced, "an AP or .50 round goes through it");
  b.cells[6 * b.w + 7].k = "wall";
  b.losCache.fill(0);
  check(!nextInLine(b, p, z1, true), "a wall stops even those");
  AMMO_TYPES.fmj.overpen["308"] = keep;
  check(AMMO_TYPES.ball.overpen["50bmg"] === 1 && AMMO_TYPES.fmj.overpen["308"] === 0.15 && !AMMO_TYPES.fmj.overpen["9mm"], "the chances: .50 always, .308 FMJ 15%, 9mm FMJ never");
  restore();
}

// 5. The sniper's sense of a cell.
{
  console.log("Snipers");
  check(sniperCell(12) > sniperCell(16) && sniperCell(16) > sniperCell(8) && sniperCell(3) < 0, "a sniper wants 10–15 tiles from the nearest foe, never close");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
