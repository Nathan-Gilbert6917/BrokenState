// The melee overhaul (docs/weapons-overhaul-plan.md section 4; combat.js melee section): quick strikes (one strike a turn
// for 1 action, then a move), stagger (an action lost next turn, brutes immune), bleeding (5 a turn for two turns, people
// only, armour no help), reach 2 for spears (straight line, nobody between; the AI uses it too), a spear thrown (it lies
// where it lands, the thrower draws a pocket pistol or fights bare-handed, walks onto it or picks it up next to it; after
// a won fight it comes back, after a loss it is gone), zealots throwing spears and fetching them, the thrown spear on a
// dead zealot's body, the takedown bonus from WEAPONS (stealth.js CLUB fallback).
// Usage: node tools/meleetest.js [seed]
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import {
  WEAPONS, KITS, createBattle, combatAct, registerCombatHandler, enemyStep, endPlayerTurn, endBattleNow, inMelee, magIn, MELEE, enemyUnit,
} from "../src/sim/combat.js";
import { subdueOdds } from "../src/sim/stealth.js";
import { newItem } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { refitPerson } from "../src/sim/fighters.js";

const seed = Number(process.argv[2] || 11);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
registerCombatHandler("meleetest", () => {});

function fighter(state, weapon = "knife", shooting = 9) {
  const s = makeSurvivor(state);
  s.skills.shooting = shooting;
  s.skills.melee = 5; // the Melee skill at its middle (world.js MELEE_SKILL): everyone strikes alike here
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
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy, ambush: null, canRetreat: true, handler: "meleetest", context: {} }));
  for (const c of b.cells) c.k = "open";
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
const place = (u, x, y) => { u.x = x; u.y = y; u.dead = false; u.down = false; };
const toughen = (u) => { u.hp = u.maxHp = 100000; };
const fresh = (b) => { b.phase = "player"; for (const u of b.units) if (u.side === "player" && !u.dead) u.ap = 2; };

// ---------- quick strikes ----------
console.log("Quick strikes");
{
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st, "knife"), c = fighter(st, "machete");
  const b = openBattle(st, [a, c]);
  const ua = by(b, a), uc = by(b, c), [e1, e2] = foes(b);
  place(ua, 5, 5); place(uc, 5, 9); place(e1, 6, 5); place(e2, 6, 9); toughen(e1); toughen(e2);
  check(WEAPONS.knife.quick && WEAPONS.combatknife.quick && WEAPONS.hatchet.quick && !WEAPONS.machete.quick, "knives, the hatchet are quick; the machete is not");
  check(combatAct(st, { type: "melee", unit: ua.id, target: e1.id }) === "" && ua.ap === 1, "a knife strike costs 1 action");
  const again = combatAct(st, { type: "melee", unit: ua.id, target: e1.id });
  check(/One strike a turn/.test(again) && ua.ap === 1, `one strike a turn: the second is refused (${again})`);
  check(combatAct(st, { type: "move", unit: ua.id, x: 3, y: 5 }) === "" && ua.x === 3 && ua.ap === 0, "then a step away with the action left");
  check(combatAct(st, { type: "melee", unit: uc.id, target: e2.id }) === "" && uc.ap === 0, "a machete strike ends the turn");
}

// ---------- stagger ----------
console.log("Stagger");
{
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st, "sledge", 12), idle = fighter(st, "knife");
  const b = openBattle(st, [a, idle], { kind: "raiders", count: 2, power: 3 }); // idle: keeps the turn open between strikes
  const u = by(b, a), [e, z] = foes(b);
  place(u, 5, 5); place(by(b, idle), 15, 15); place(e, 6, 5); toughen(e);
  let n = 0;
  for (let i = 0; i < 40 && !e.staggered; i++) { fresh(b); u.struck = null; combatAct(st, { type: "melee", unit: u.id, target: e.id }); n++; }
  check(e.staggered === 1, `a sledgehammer staggers (after ${n} strikes)`);
  b.phase = "player"; for (const x of b.units) if (x.side === "player") x.ap = 0;
  endPlayerTurn(st);
  check(e.ap === 1 && !e.staggered, `the staggered enemy starts its turn with one action (${e.ap})`);
  check(b.log.some((l) => /still reeling/.test(l.text)), "the log says so");
  // A brute is immune.
  b.phase = "player"; place(z, 4, 5); toughen(z); z.ztype = "brute";
  let got = false;
  for (let i = 0; i < 60; i++) { fresh(b); combatAct(st, { type: "melee", unit: u.id, target: z.id }); if (z.staggered) got = true; }
  check(!got, "a brute is never staggered");
}

// ---------- bleeding ----------
console.log("Bleeding");
{
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st, "kukri", 12), idle = fighter(st, "knife");
  const b = openBattle(st, [a, idle], { kind: "raiders", count: 2, power: 3 });
  const u = by(b, a), [e, z] = foes(b);
  place(u, 5, 5); place(by(b, idle), 15, 15); place(e, 6, 5); toughen(e); e.armor = 0.5;
  for (let i = 0; i < 40 && !e.bleeding; i++) { fresh(b); combatAct(st, { type: "melee", unit: u.id, target: e.id }); }
  check(e.bleeding === MELEE.BLEED_TURNS, "a kukri cut bleeds (2 turns)");
  const hp0 = e.hp;
  b.phase = "player"; for (const x of b.units) if (x.side === "player") x.ap = 0;
  endPlayerTurn(st);
  check(Math.abs(hp0 - e.hp - MELEE.BLEED) < 1e-9 && e.bleeding === 1, `it bleeds ${MELEE.BLEED} at the start of its turn, through armour (${hp0 - e.hp})`);
  // The dead do not bleed.
  b.phase = "player"; b.queue = []; place(z, 4, 5); toughen(z); z.kind = "zombie";
  let got = false;
  for (let i = 0; i < 40; i++) { fresh(b); combatAct(st, { type: "melee", unit: u.id, target: z.id }); if (z.bleeding) got = true; }
  check(!got, "one of the dead never bleeds");
}

// ---------- reach 2 ----------
console.log("Reach");
{
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st, "spear", 12), k = fighter(st, "knife", 12);
  const b = openBattle(st, [a, k], { kind: "raiders", count: 3, power: 3 });
  const u = by(b, a), uk = by(b, k), [e, f, g] = foes(b);
  place(u, 5, 5); place(uk, 15, 15); place(e, 7, 5); toughen(e); toughen(f);
  check(inMelee(b, u, e), "a spear reaches 2 tiles in a straight line");
  e.x = 7; e.y = 7; check(inMelee(b, u, e), "and on the diagonal");
  e.x = 7; e.y = 6; check(!inMelee(b, u, e) && /2 tiles off/.test(combatAct(st, { type: "melee", unit: u.id, target: e.id })), "not a knight's move off");
  e.x = 7; e.y = 5; place(f, 6, 5);
  check(!inMelee(b, u, e), "not with someone standing between");
  f.x = -10; f.dead = true;
  // Wall corners (combat.js cornerBlocked): a diagonal reach past a corner at either step is blocked, as a blow is.
  {
    const cellAt = (x, y) => b.cells[y * b.w + x];
    const keep = [[6, 5], [5, 6], [7, 6], [6, 7]].map(([x, y]) => [x, y, { ...cellAt(x, y) }]);
    e.x = 7; e.y = 7;
    cellAt(6, 5).k = "wall"; cellAt(5, 6).k = "wall";
    check(!inMelee(b, u, e), "a spear's diagonal reach: not past a wall's corner at the first step");
    cellAt(6, 5).k = "open"; cellAt(5, 6).k = "open"; cellAt(7, 6).k = "wall"; cellAt(6, 7).k = "wall";
    check(!inMelee(b, u, e), "nor at the second");
    for (const [x, y, c] of keep) b.cells[y * b.w + x] = c;
    if (b.losCache) b.losCache.fill(0);
    check(inMelee(b, u, e), "the corners clear: it reaches again");
    e.x = 7; e.y = 5;
  }
  place(g, 17, 15); toughen(g);
  check(!inMelee(b, uk, g) && combatAct(st, { type: "melee", unit: uk.id, target: g.id }) === "Must be next to the target.", "a knife does not reach 2");
  fresh(b);
  const hp0 = e.hp;
  check(combatAct(st, { type: "melee", unit: u.id, target: e.id }) === "", "the spear strikes from 2 tiles off");
  check(b.log.some((l) => /strikes|lunges/.test(l.text)) && (e.hp < hp0 || b.log.some((l) => /misses/.test(l.text))), "a strike or a miss is logged");
  // The AI: an enemy with a spear strikes from 2 tiles.
  const st2 = createWorld({ seed: seed + 1, factionCount: 4 });
  const p = fighter(st2, "knife");
  const b2 = openBattle(st2, [p], { kind: "militia", count: 1, power: 3 });
  const up = by(b2, p), [m] = foes(b2);
  place(up, 5, 5); place(m, 7, 5); m.weapon = "spear"; m.weaponName = "Steel spear"; m.mag = 0; toughen(up);
  b2.phase = "player"; up.ap = 0; endPlayerTurn(st2);
  b2.queue = [m.id];
  enemyStep(st2);
  check(m.x === 7 && m.y === 5 && b2.log.some((l) => new RegExp(`${m.name} (strikes|lunges)`).test(l.text)), "the AI strikes from 2 tiles off with a spear (no step in)");
}

// ---------- a thrown spear ----------
console.log("Thrown spear");
{
  let hitSeen = false, done = false;
  for (let k = 0; k < 12 && !done; k++) {
    const st = createWorld({ seed: seed + 10 + k, factionCount: 4 });
    const a = fighter(st, "spear", 12);
    a.pockets[0] = newItem("pistol");
    const b = openBattle(st, [a], { kind: "raiders", count: 2, power: 3 });
    const u = by(b, a), [e, e2] = foes(b);
    place(u, 5, 5); place(e, 9, 5); toughen(e); place(e2, 20, 20); toughen(e2);
    const aim0 = u.aim, dm0 = u.dmgMult, hp0 = e.hp;
    if (k === 0) {
      check(/Too far/.test(combatAct(st, { type: "throwspear", unit: u.id, x: 12, y: 5 })), "a spear carries 5 tiles, no more");
      check(/Too close/.test(combatAct(st, { type: "throwspear", unit: u.id, x: 6, y: 5 })), "next to it: strike instead");
      check(/Too far/.test(combatAct(st, { type: "throwspear", unit: u.id, x: 10, y: 5 })) === false, "5 tiles is in range");
      b.spears = []; // undo the test throw above if it went
      if (u.spearOut) { u.weapon = "spear"; delete u.spearOut; }
    }
    fresh(b); place(u, 5, 5); u.aim = aim0; u.dmgMult = dm0;
    const err = combatAct(st, { type: "throwspear", unit: u.id, target: e.id });
    if (k === 0) check(err === "" && u.ap === 1, "Throw spear costs 1 action");
    const sp = (b.spears || [])[0];
    if (k === 0) {
      check(!!sp && sp.owner === u.id && sp.key === "spear", "the spear lies on the map");
      check(u.weapon === "pistol" && magIn(u) > 0 && u.spearOut, "the thrower draws the pistol from a pocket, loaded");
      check(/Only a spear/.test(combatAct(st, { type: "throwspear", unit: u.id, target: e.id })), "nothing left to throw");
    }
    if (sp && sp.x === e.x && sp.y === e.y) { hitSeen = hitSeen || e.hp < hp0; }
    if (k === 0) {
      // Walk onto it: picked up.
      fresh(b);
      if (sp.x === e.x && sp.y === e.y) { e.x = 20; e.y = 2; }
      const mv = combatAct(st, { type: "move", unit: u.id, x: sp.x, y: sp.y });
      check(mv === "" && u.weapon === "spear" && !u.spearOut && !b.spears.length, `walking onto it picks it up (${mv})`);
      check(Math.abs(u.aim - aim0) < 1e-9 && Math.abs(u.dmgMult - dm0) < 1e-9, "aim and damage are as before");
      // Next to it: 1 action.
      fresh(b); place(u, 5, 5); place(e, 9, 5);
      combatAct(st, { type: "throwspear", unit: u.id, target: e.id });
      const sp2 = b.spears[0];
      fresh(b); place(u, sp2.x - 1, sp2.y);
      check(combatAct(st, { type: "pickspear", unit: u.id }) === "" && u.ap === 1 && u.weapon === "spear", "or picked up from next to it for 1 action");
      // A save in the middle keeps it on the ground.
      fresh(b); place(u, 5, 5);
      combatAct(st, { type: "throwspear", unit: u.id, target: e.id });
      const st2 = loadFromString(saveToString(st));
      const b2 = st2.combat;
      check(b2 && b2.spears && b2.spears.length === 1 && b2.units.find((x) => x.id === u.id).spearOut, "a save keeps the spear on the ground and the thrower without it");
      // A win: picked up.
      for (const x of foes(b)) { x.dead = true; x.hp = 0; }
      endBattleNow(st, "victory");
      check(a.gear.weapon && a.gear.weapon.key === "spear" && !b.spears.length, "after a won fight the spear is picked up");
      done = false;
    }
  }
  check(hitSeen, "a spear that lands on the target hurts it");
  // A loss: gone.
  const st = createWorld({ seed: seed + 40, factionCount: 4 });
  const a = fighter(st, "spear", 12);
  const b = openBattle(st, [a], { kind: "raiders", count: 1, power: 3 });
  const u = by(b, a), [e] = foes(b);
  place(u, 5, 5); place(e, 9, 5); toughen(e);
  combatAct(st, { type: "throwspear", unit: u.id, target: e.id });
  check(u.weapon === "fists", "with no pistol on them: bare hands");
  u.left = true;
  endBattleNow(st, "retreat");
  check(!a.gear.weapon && b.summary.some((l) => /left where it fell/.test(l)), "after a retreat the spear is lost");
}

// ---------- zealots ----------
console.log("Zealots");
{
  check(KITS.zealots.spearThrow && KITS.zealots.weapons.includes("spear"), "zealots carry spears and throw them");
  let threw = 0, fetched = 0, body = 0;
  for (let k = 0; k < 10; k++) {
    const st = createWorld({ seed: seed + 100 + k, factionCount: 4 });
    const p = fighter(st, "pistol");
    const b = openBattle(st, [p], { kind: "zealots", count: 1, power: 3 });
    const up = by(b, p), [z] = foes(b);
    place(up, 5, 5); place(z, 9, 5); toughen(up);
    if (z.who) { z.who.gear.weapon = newItem("spear"); refitPerson(b, z); z.kit = "zealots"; place(z, 9, 5); } // a person (fighters.js): the very spear in their hands
    else { z.weapon = "spear"; z.weaponName = "Steel spear"; z.kit = "zealots"; z.mag = 0; }
    b.phase = "player"; up.ap = 0; endPlayerTurn(st);
    b.queue = [z.id]; const L0 = b.log.length; enemyStep(st);
    if (!b.log.slice(L0).some((l) => /throws the .*spear/.test(l.text))) continue;
    threw++; // (a wide miss next to it: picked up again with the turn's other action)
    if (!b.spears || !b.spears.length) continue;
    check(z.weapon === "fists" && z.spearOut, "the zealot's spear left its hands");
    // Next enemy turn, with the spear in reach and nobody next to it: back for it.
    const sp = b.spears[0];
    place(up, 1, 15);
    z.x = sp.x - 2; z.y = sp.y;
    b.phase = "player"; up.ap = 0; endPlayerTurn(st);
    b.queue = [z.id]; enemyStep(st);
    if (z.weapon === "spear") fetched++;
    // Killed with its spear on the ground: the spear is on its body after the win.
    if (z.weapon === "fists" || body === 0) {
      // Fetched: set up the throw again until it throws (the AI throws 60% of turns, on the battle's dice).
      for (let t = 0; t < 8 && z.weapon === "spear" && !z.spearOut; t++) { b.phase = "player"; place(up, 5, 5); place(z, 9, 5); up.ap = 0; endPlayerTurn(st); b.queue = [z.id]; enemyStep(st); }
      if (z.spearOut) {
        z.dead = true; z.hp = 0;
        endBattleNow(st, "victory");
        if (b.bodies.some((bd) => bd.gear && bd.gear.weapon && bd.gear.weapon.key === "spear")) body++;
        else if (b.result) body += 0; // taken already (headless takes all): check the loot
        if (b.result && b.result.loot && b.result.loot.gear && b.result.loot.gear.some((g) => g.key === "spear")) body++;
      }
    }
  }
  check(threw >= 3, `zealots throw spears at someone 4 tiles off (${threw} of 10)`);
  check(fetched >= 1, `and go back for them (${fetched})`);
  check(body >= 1, `a dead zealot's thrown spear is on its body (${body})`);
}

// ---------- takedowns ----------
console.log("Takedowns");
{
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st, "golfclub"), c = fighter(st, "spear");
  const b = openBattle(st, [a, c]);
  const ua = by(b, a), uc = by(b, c), [e] = foes(b);
  place(ua, 5, 5); place(uc, 5, 7); place(e, 6, 6); e.aware = false; e.face = [1, 0]; ua.stealth = uc.stealth = 0;
  const club = subdueOdds(b, ua, e).chance, spear = subdueOdds(b, uc, e).chance;
  check(club - spear === WEAPONS.golfclub.takedown - WEAPONS.spear.takedown, `a golf club's takedown bonus (+${WEAPONS.golfclub.takedown}) comes from WEAPONS (${club}% vs ${spear}%)`);
  check(Object.values(WEAPONS).filter((w) => w.melee && w.mclass).every((w) => ["blade", "pierce", "chop", "blunt", "heavy"].includes(w.mclass)), "every melee class is one of five");
  check(["knife", "machete", "spear", "pipespear", "bat", "sledge", "springmachete", "hatchet", "katana", "golfclub"].every((k) => WEAPONS[k].mclass && WEAPONS[k].takedown), "old and new melee weapons have a class and a takedown");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
