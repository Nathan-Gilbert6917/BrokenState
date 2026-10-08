// Flashbangs (src/sim/throwables.js FLASH, flashReach, stunUnit, flashSpot; stealth.js THROWABLES.flashbang, botFlash;
// siege.js enemyThrow; loot in loot.js SITE_GRENADES / AREA_GRENADES, locks.js, gunsafes.js, miltrucks.js,
// deadsoldiers.js, inventory.js carriedThrowables):
//   1. the stun by range (2 actions within a tile, 1 out to 2 tiles), the aim penalty and no overwatch, facing away
//      (dazed), the thrower dazed at most, a visor and ear protection, the actions taken off at the start of the
//      unit's next turn and the stun gone when that turn ends (your side and theirs);
//   2. line of sight from the burst: nothing through a wall, 1 tile through a doorway, a flashbang tossed through a
//      doorway into a room nobody sees into;
//   3. the dead: lured (the unaware go to look, the aware turn to it for a turn), never stunned; the bang wakes people;
//   4. the AI: soldiers and guards carry them (FLASH_KIT), throw at two or more of yours in cover and never where their
//      own would be caught; the autopilot and the raid bot throw theirs the same way;
//   5. loot: every source exists and goes through itemcond.js;
//   6. a save mid-battle keeps the stun (and it still bites after loading); 7. the UI shows it.
// Usage: node tools/flashtest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import {
  createBattle, combatAct, registerCombatHandler, endPlayerTurn, enemyStep, autoPlayerTurn, runEnemyPhase, shotOdds, active, unitAt, enemyUnit, WEAPONS,
} from "../src/sim/combat.js";
import { THROWABLES, throwAt, throwablesOf, DECOY_KEYS, stealthAct, botFlash } from "../src/sim/stealth.js";
import { FLASH, FLASH_KIT, flashReach, flashCells, stunUnit, landEffect, flashSpot, doorToss, throwBlind, kitFlashbangs } from "../src/sim/throwables.js";
import { enemyThrow } from "../src/sim/siege.js";
import { stimuli, pullOf } from "../src/sim/decoys.js";
import { newItem, stow, enemyBody, allItems, allCarried, carriedThrowables } from "../src/sim/inventory.js";
import { condRolled } from "../src/sim/itemcond.js";
import { SITE_GRENADES, AREA_GRENADES, ITEM_TAGS, rollSiteGrenades, rollAreaGrenades } from "../src/sim/loot.js";
import { rollGunStash } from "../src/sim/gunsafes.js";
import { truckLoot, TRUCK_FLASH } from "../src/sim/miltrucks.js";
import { MILDEAD, bodyLoot } from "../src/sim/deadsoldiers.js";
import { armouredItem } from "../src/sim/inventory.js";
import { hash01 } from "../src/sim/skills.js";
import { Rng } from "../src/sim/rng.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("fb", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; return st; };
const cellAt = (b, x, y) => b.cells[y * b.w + x];
const setCell = (b, x, y, k) => { cellAt(b, x, y).k = k; b.losCache.fill(0); };

// An open field at the hub: every cell open grass, the units placed by hand (the rest parked out of the way, dead).
function openBattle(st, enemy = { kind: "raiders", count: 4, power: 3 }, n = 3) {
  const h = hub(st);
  const ids = atBase(st, h.id).slice(0, n).map((s) => s.id);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: ids, enemy, ambush: null, canRetreat: false, handler: "fb", context: {} });
  const b = st.combat;
  for (const c of b.cells) { c.k = "open"; c.f = "grass"; delete c.h; delete c.t; delete c.hp; delete c.mhp; }
  b.losCache.fill(0); b.reach.fill(1);
  b.phase = "player";
  b.fires = []; b.smoke = []; b.lures = [];
  let i = 0;
  for (const u of b.units) { u.x = u.side === "player" ? 1 : 30 - (i % 4); u.y = u.side === "player" ? 1 + 2 * (u.id % 6) : 2 + 2 * (i++ >> 2); u.aware = true; u.face = [0, 0]; delete u.stun; u.ow = false; }
  return b;
}
const P = (b) => b.units.filter((u) => u.side === "player");
const E = (b) => b.units.filter((u) => u.side === "enemy");
const place = (u, x, y, face = [0, 0]) => { u.x = x; u.y = y; u.face = face; };

// ---------- 1. the stun ----------
section("1. The stun: by range, facing, the thrower, a visor, ear protection; served on the unit's next turn");
{
  const st = world();
  const b = openBattle(st, { kind: "raiders", count: 6, power: 3 });
  const [me] = P(b);
  const [e0, e1, e2, e3, e4, e5] = E(b);
  place(me, 4, 6, [1, 0]);
  place(e0, 10, 6, [-1, 0]); // on the burst cell
  place(e1, 11, 6, [-1, 0]); // a tile off, facing it
  place(e2, 12, 7, [-1, 0]); // 2 tiles off, facing it
  place(e3, 13, 6, [-1, 0]); // 3 tiles off
  place(e4, 10, 8, [0, 1]); // 2 tiles off, facing away (south)
  place(e5, 9, 5, [0, 0]); // a tile off, no facing yet (caught full)
  for (const p of P(b).slice(1)) place(p, 1, 1 + P(b).indexOf(p) * 2);
  const ap0 = b.units.map((u) => u.ap);
  const text = landEffect(b, me, THROWABLES.flashbang, 10, 6);
  check(e0.stun && e0.stun.ap === FLASH.apNear && e0.stun.aim === FLASH.aim && e1.stun && e1.stun.ap === FLASH.apNear, `on the spot and a tile off: −${FLASH.apNear} actions, aim −${FLASH.aim} (${JSON.stringify(e1.stun)})`);
  check(e2.stun && e2.stun.ap === FLASH.ap && e2.stun.aim === FLASH.aim, `2 tiles off: −${FLASH.ap} action, aim −${FLASH.aim}`);
  check(!e3.stun, "3 tiles off: nothing");
  check(e4.stun && e4.stun.dazed && e4.stun.ap === 0 && e4.stun.aim === FLASH.daze, `facing away: only dazed (aim −${FLASH.daze}, no action lost)`);
  check(e5.stun && e5.stun.ap === FLASH.apNear, "no facing yet (just arrived): caught full");
  check(!me.stun && b.units.every((u, i) => u.ap === ap0[i]), "nobody loses an action in the turn it goes off; the thrower 6 tiles off is untouched");
  check(/BANG!/.test(text) && /stunned/.test(text) && /dazed/.test(text), `the log line: ${text.slice(0, 140)}`);
  check([e0, e1, e5].every((e) => e.hp > 0) && b.cells.every((c) => c.k === "open"), "barely a scratch, and no cover is broken");
  // The aim penalty and no overwatch.
  const tgt = me;
  const stunned = shotOdds(b, e2, tgt).chance;
  const s2 = e2.stun; delete e2.stun;
  const clear = shotOdds(b, e2, tgt).chance;
  e2.stun = s2;
  check(clear - stunned === FLASH.aim || (stunned === 5 && clear < 5 + FLASH.aim), `a stunned shooter: ${clear}% → ${stunned}%`);
  // Served at the start of the enemy turn, gone when it ends.
  e1.ow = true; e2.ow = true;
  endPlayerTurn(st);
  check(e0.ap === 0 && e1.ap === 0 && e2.ap === 1 && e4.ap === 2 && e3.ap === 2, `their turn: ${e1.ap} / ${e2.ap} / ${e4.ap} actions (stunned near / stunned / dazed)`);
  check(e0.stun && e0.stun.applied && b.log.some((l) => /still reeling from the flash/.test(l.text)), "the log says who is still reeling");
  check(!e1.ow && !e2.ow, "no overwatch for the stunned");
  for (const e of E(b)) e.ap = 0;
  b.queue = [];
  enemyStep(st);
  check(b.phase === "player" && E(b).every((e) => !e.stun), "the enemy turn over: their stun has worn off");
  // The thrower too close: dazed at most; a visor; ear protection.
  const [p0, p1, p2] = P(b);
  place(p0, 10, 10, [1, 0]); place(p1, 11, 10, [-1, 0]); place(p2, 12, 11, [-1, 0]);
  p1.fielded = [["head", newItem("riothelmet", 1)]];
  p2.earCut = 0.5;
  for (const e of E(b)) place(e, 30, e.y);
  landEffect(b, p0, THROWABLES.flashbang, 11, 11);
  check(p0.stun && p0.stun.dazed, "the thrower, caught by their own throw, is only dazed (they turned away)");
  check(p1.stun && p1.stun.ap === FLASH.apNear - 1 && p1.stun.aim === Math.round(FLASH.aim * (1 - FLASH.visor)), `a riot helmet's visor: −${p1.stun && p1.stun.ap} action, aim −${p1.stun && p1.stun.aim}`);
  check(p2.stun && p2.stun.ap === 0 && p2.stun.aim === 15, `ear protection (earCut 0.5): no action lost, aim −${p2.stun && p2.stun.aim}`);
  // Your people stunned in your own turn: it bites next turn, not this one; overwatch is refused.
  const ap1 = p1.ap;
  check(p1.ap === ap1 && /Still seeing spots/.test(combatAct(st, { type: "overwatch", unit: p1.id })), "your stunned can still act this turn, but cannot overwatch");
  check(shotOdds(b, p1, E(b)[0]).chance <= Math.max(5, shotOdds(b, { ...p1, stun: null }, E(b)[0]).chance - p1.stun.aim + 1), "their aim is down already");
  endPlayerTurn(st);
  check(p1.stun && p1.stun.next === b.turn + 1, "still on through the enemy turn");
  for (const e of E(b)) e.ap = 0;
  b.queue = [];
  enemyStep(st);
  check(p1.ap === 2 - p1.stun.ap && p0.ap === 2, `the next turn: ${p1.ap} action${p1.ap === 1 ? "" : "s"} for the stunned, 2 for the dazed thrower`);
  combatAct(st, { type: "end" });
  check(!p1.stun && !p0.stun, "and gone at the end of it");
  // An enemy flashbang in their turn: yours lose the actions at the start of yours.
  b.phase = "enemy";
  const [q0] = P(b);
  place(q0, 20, 20, [1, 0]);
  const thr = E(b)[0];
  place(thr, 26, 20, [-1, 0]);
  landEffect(b, thr, THROWABLES.flashbang, 21, 20);
  check(q0.stun && q0.stun.next === b.turn + 1, "caught in the enemy's turn: it bites at the start of your next");
  for (const e of E(b)) e.ap = 0;
  b.queue = [];
  enemyStep(st);
  check(q0.ap === 0, `your next turn: ${q0.ap} actions left`);
}

// ---------- 2. line of sight ----------
section("2. Line of sight from the burst: walls stop it, a doorway cuts it to a tile");
{
  const st = world();
  const b = openBattle(st, { kind: "raiders", count: 4, power: 3 });
  // A wall at x = 12 with a doorway at (12, 6).
  for (let y = 0; y < b.h; y++) setCell(b, 12, y, "wall");
  setCell(b, 12, 6, "doorway");
  check(!flashReach(b, 11, 4, 13, 4), "through a wall (no line of sight): nothing");
  check(flashReach(b, 11, 6, 12, 6) === "sight" && flashReach(b, 12, 6, 13, 6) === "sight", "in the doorway and a tile past it from the doorway: caught");
  check(flashReach(b, 11, 6, 13, 6) === null, "2 tiles off through the doorway: nothing (a doorway cuts it to a tile)");
  check(flashReach(b, 11, 6, 9, 5) === "sight", "2 tiles off in the open: caught");
  const [e0, e1, e2] = E(b);
  const [me] = P(b);
  place(me, 5, 6, [1, 0]);
  place(e0, 13, 4, [-1, 0]); place(e1, 13, 7, [-1, 0]); place(e2, 14, 6, [-1, 0]);
  landEffect(b, me, THROWABLES.flashbang, 11, 5);
  check(!e0.stun && !e1.stun && !e2.stun, "the people behind the wall are untouched");
  const cells = flashCells(b, 11, 5);
  check(cells.every(([x]) => x <= 12) && cells.length > 8, `the preview's cells stop at the wall (${cells.length} cells)`);
  // Tossed through the doorway into a room nobody sees into.
  place(me, 8, 6, [1, 0]);
  for (const p of P(b).slice(1)) place(p, 1, 20);
  place(e0, 14, 6, [-1, 0]); place(e1, 14, 5, [-1, 0]); place(e2, 30, 20);
  b.ghosts = {};
  check(throwBlind(b, me, 14, 4) === null && doorToss(b, me, 14, 6), "a cell nobody sees past the doorway: not a blind throw, but it can be tossed through the doorway");
  const s = st.survivors.find((x) => x.id === me.sid);
  stow(s, newItem("flashbang"));
  me.ap = 2;
  const err = combatAct(st, { type: "throw", unit: me.id, item: "flashbang", x: 14, y: 6 });
  const caught = [e0, e1].filter((e) => e.stun).length;
  check(!err && me.ap === 1 && caught >= 1, `tossed through the doorway into the room: ${caught} of 2 caught (${err || b.log.slice(-1)[0].text.slice(0, 110)})`);
}

// ---------- 3. the dead ----------
section("3. The dead: lured to the bang, never stunned; the bang wakes people");
{
  const st = world();
  const b = openBattle(st, { kind: "zombies", count: 4, power: 3 });
  for (let i = 0; i < 2; i++) { const g = enemyUnit(b, new Rng(i + 1), "guards", 3, i + 1); g.pod = 90 + i; b.units.push(g); }
  const dead = E(b).filter((u) => u.kind === "zombie"), live = E(b).filter((u) => u.kind === "human");
  const [me] = P(b);
  place(me, 4, 6, [1, 0]);
  for (const p of P(b).slice(1)) place(p, 1, 20);
  place(dead[0], 10, 7, [-1, 0]); dead[0].aware = false; // a tile off, unaware
  place(dead[1], 16, 6, [-1, 0]); dead[1].aware = false; // 6 off, unaware
  place(dead[2], 18, 12, [-1, 0]); dead[2].aware = true; // aware, 8 off, none of yours near
  place(dead[3], 30, 22); dead[3].aware = false; // out of earshot
  place(live[0], 20, 6, [-1, 0]); live[0].aware = false; // asleep, 10 off
  place(live[1], 31, 2, [-1, 0]); live[1].aware = false; // 21 off
  const s = st.survivors.find((x) => x.id === me.sid);
  stow(s, newItem("flashbang"));
  me.ap = 2;
  const err = combatAct(st, { type: "throw", unit: me.id, item: "flashbang", x: 10, y: 6 });
  if (err || !b.lures.length) console.log(`    (throw: ${err || "no lure"}; ${b.w}x${b.h}, units at ${b.units.map((u) => `${u.name}@${u.x},${u.y}`).join(" ")})`);
  const [lx] = b.lures.length ? [b.lures[0].x, b.lures[0].y] : [-1, -1];
  check(!err && dead.every((z) => !z.stun), `no stun on the dead, even right next to it (${err || "thrown"})`);
  check(dead[0].investigate && dead[1].investigate && dead[0].investigate.x === lx && dead[1].investigate.x === lx, "the unaware dead within earshot go to look where it went off");
  check(!dead[3].investigate, "the dead out of earshot (12 tiles) do not");
  check(stimuli(b).some((m) => m.key === "flashbang") && pullOf(b, dead[2]) && pullOf(b, dead[2]).key === "flashbang", "the aware dead turn to it too (a decoy for the enemy turn after it)");
  check(live[0].aware && !live[1].aware, "the people within 12 tiles wake; those further off sleep on");
  check(b.raid ? true : b.noise >= FLASH.noise, `as loud as gunfire (noise ${b.noise})`);
  check(!DECOY_KEYS.includes("flashbang"), "not a decoy the AI throws to pull the dead (a lure only by the way)");
}

// ---------- 4. the AI ----------
section("4. The AI: soldiers and guards carry them, throw at two or more of yours in cover, never on their own side");
{
  // The kit (their own dice).
  const st = world();
  const b = openBattle(st);
  let gF = 0, gS = 0, sF = 0, rF = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const g = enemyUnit(b, new Rng(i * 31 + 7), "guards", 4, i), so = enemyUnit(b, new Rng(i * 17 + 3), "soldiers", 4, i), r = enemyUnit(b, new Rng(i * 13 + 1), "raiders", 4, i);
    if (g.throwables && g.throwables.flashbang) gF++;
    if (g.throwables && g.throwables.smokegren) gS++;
    if (so.throwables && so.throwables.flashbang) sF++;
    if (r.throwables && r.throwables.flashbang) rF++;
  }
  check(Math.abs(gF / N - FLASH_KIT.guards.flashbang[0]) < 0.04 && Math.abs(sF / N - FLASH_KIT.soldiers.flashbang[0]) < 0.04 && Math.abs(gS / N - FLASH_KIT.guards.smokegren[0]) < 0.03 && rF === 0,
    `guards carry a flashbang ${Math.round((100 * gF) / N)}% (a smoke grenade ${Math.round((100 * gS) / N)}%), soldiers ${Math.round((100 * sF) / N)}%, raiders never`);
  const ra = new Rng(99), rb = new Rng(99);
  const ua = enemyUnit(b, ra, "soldiers", 4, 1);
  const sa = ra.state;
  delete ua.throwables;
  kitFlashbangs(ua, "soldiers", sa);
  check(ra.state === sa && rb.next() !== undefined, "the kit roll moves no dice of the battle (a hash of their position)");
}
{
  // The enemy's throw: two of yours bunched in cover 5 tiles off.
  const st = world();
  const b = openBattle(st, { kind: "soldiers", count: 4, power: 4 });
  const [p0, p1, p2] = P(b);
  const [thr, mate, far, far2] = E(b);
  place(p0, 8, 6, [1, 0]); place(p1, 8, 7, [1, 0]); place(p2, 2, 20, [1, 0]);
  setCell(b, 9, 6, "sandbag"); setCell(b, 9, 7, "sandbag");
  place(thr, 13, 6, [-1, 0]); place(mate, 14, 10, [-1, 0]); place(far, 30, 20); place(far2, 31, 21);
  thr.throwables = { flashbang: 1 }; thr.ap = 2;
  b.phase = "enemy";
  const spot = flashSpot(b, thr, THROWABLES.flashbang.range, { need: 2, cover: true });
  check(spot && spot.n >= 2, `a spot that catches both of yours (${spot ? `${spot.x},${spot.y}: ${spot.n}` : "none"})`);
  const ended = enemyThrow(b, thr);
  check(thr.throwables.flashbang === 0 && b.enemyThrowTurn === b.turn && thr.ap === 1 && !ended, "thrown: one action, and the rest of the turn to rush (or shoot)");
  check([p0, p1].filter((p) => p.stun).length >= 1 || /lands a tile off/.test(b.log.map((l) => l.text).join(" ")), `yours stunned (${[p0, p1].filter((p) => p.stun).length} of 2)`);
  check(!mate.stun && !far.stun && !(thr.stun && !thr.stun.dazed), "none of their own caught");
  // Their own close to yours: no throw.
  const st2 = world();
  const b2 = openBattle(st2, { kind: "soldiers", count: 3, power: 4 });
  const [a0, a1] = P(b2);
  const [t2, m2] = E(b2);
  place(a0, 8, 6, [1, 0]); place(a1, 8, 7, [1, 0]);
  setCell(b2, 9, 6, "sandbag"); setCell(b2, 9, 7, "sandbag");
  place(t2, 13, 6, [-1, 0]); place(m2, 7, 8, [1, 0]); // a soldier right on top of your people
  t2.throwables = { flashbang: 1 }; t2.ap = 2;
  b2.phase = "enemy";
  check(!flashSpot(b2, t2, 7, { need: 2, cover: true }) && !enemyThrow(b2, t2) && t2.throwables.flashbang === 1, "one of their own in the way: no throw");
  // In the open (no cover): they shoot instead.
  setCell(b2, 9, 6, "open"); setCell(b2, 9, 7, "open");
  place(m2, 30, 20);
  check(!flashSpot(b2, t2, 7, { need: 2, cover: true }), "yours in the open: no flashbang (they just shoot)");
  // A whole enemy phase: soldiers with flashbangs against a team in cover, many seeds; never their own stunned.
  let thrown = 0, own = 0, games = 0;
  for (let sd = 1; sd <= 30; sd++) {
    const w = world(sd);
    const bb = openBattle(w, { kind: "soldiers", count: 4, power: 4 });
    const ps = P(bb), es = E(bb);
    ps.forEach((p, i) => place(p, 8, 4 + i, [1, 0]));
    for (let y = 3; y < 4 + ps.length + 1; y++) setCell(bb, 9, y, "sandbag");
    es.forEach((e, i) => { place(e, 14 + (i % 2) * 2, 2 + i * 3, [-1, 0]); e.throwables = { flashbang: 1 }; });
    endPlayerTurn(w);
    for (let k = 0; k < 40 && bb.phase === "enemy" && !bb.over; k++) {
      enemyStep(w);
      if (es.some((e) => e.stun && !e.stun.dazed)) own++;
    }
    games++;
    if (bb.log.some((l) => /throws a flashbang/.test(l.text))) thrown++;
  }
  check(thrown >= games * 0.5 && own === 0, `played out: they threw in ${thrown} of ${games} enemy turns, their own never stunned (${own})`);
}
{
  // Your AI: the autopilot's fight and the raid bot.
  const st = world();
  const b = openBattle(st, { kind: "raiders", count: 4, power: 3 });
  const [me, p1, p2] = P(b);
  const [e0, e1, e2, e3] = E(b);
  place(me, 6, 6, [1, 0]); place(p1, 4, 2, [1, 0]); place(p2, 4, 10, [1, 0]);
  place(e0, 12, 6, [-1, 0]); place(e1, 12, 7, [-1, 0]); place(e2, 30, 20); place(e3, 31, 21);
  const s = st.survivors.find((x) => x.id === me.sid);
  stow(s, newItem("flashbang"));
  me.ap = 2;
  const ok = botFlash(st, b, me);
  check(ok && !throwablesOf(st, b, me).flashbang && [e0, e1].some((e) => e.stun), `the autopilot throws its flashbang at two raiders bunched up (${[e0, e1].filter((e) => e.stun).length} stunned)`);
  check(P(b).every((p) => !p.stun || p.stun.dazed), "none of yours caught");
  // Raid bot: only people who know you are there.
  const st2 = world();
  const b2 = openBattle(st2, { kind: "raiders", count: 4, power: 3 });
  const [r0] = P(b2);
  const [f0, f1] = E(b2);
  for (const p of P(b2).slice(1)) place(p, 1, 20);
  place(r0, 6, 6, [1, 0]); place(f0, 12, 6, [-1, 0]); place(f1, 12, 7, [-1, 0]);
  f0.aware = false; f1.aware = false;
  stow(st2.survivors.find((x) => x.id === r0.sid), newItem("flashbang"));
  r0.ap = 2;
  check(!botFlash(st2, b2, r0, true), "the raid bot does not flash a room of sleepers");
  f0.aware = true; f1.aware = true;
  check(botFlash(st2, b2, r0, true) && [f0, f1].some((e) => e.stun), "it does once they know the team is there");
  // A full autopilot fight with flashbangs on both sides: no NaN, it ends.
  let nanHp = 0, ended = 0;
  for (let sd = 1; sd <= 8; sd++) {
    const w = world(100 + sd), h = hub(w);
    for (const sv of atBase(w, h.id).slice(0, 4)) stow(sv, newItem("flashbang"));
    w.combat = createBattle(w, { tile: h.tile, baseId: h.id, fighterIds: atBase(w, h.id).slice(0, 4).map((x) => x.id), enemy: { kind: "soldiers", count: 5, power: 4 }, ambush: null, canRetreat: true, handler: "fb", context: {} });
    for (const e of E(w.combat)) e.throwables = { ...(e.throwables || {}), flashbang: 1 };
    for (let g = 0; g < 80 && w.combat && !w.combat.over; g++) { autoPlayerTurn(w); if (w.combat && !w.combat.over) runEnemyPhase(w); }
    if (w.combat && w.combat.over) ended++;
    if (w.combat && w.combat.units.some((u) => !Number.isFinite(u.hp) || !Number.isFinite(u.ap))) nanHp++;
  }
  check(ended === 8 && !nanHp, `8 autopilot fights against soldiers with flashbangs, both sides armed: all end, no NaN (${ended})`);
}

// ---------- 5. loot ----------
section("5. Loot: every source exists and goes through itemcond.js");
{
  const st = world();
  const tileOf = (type) => { const t = st.tiles.find((x) => x.loc && x.loc.type === type); if (t) return t.id; const any = st.tiles.find((x) => !x.loc); any.loc = { type, name: type }; any.loot = 1; return any.id; };
  const rolled = [];
  // The hour-by-hour search at police, prison, military, Army wrecks and convoys.
  for (const type of Object.keys(SITE_GRENADES)) {
    const id = tileOf(type);
    st.tiles[id].loot = 1;
    let n = 0, items = 0;
    for (let h = 0; h < 600; h++) { st.hour = h; const got = rollSiteGrenades(st, id, 1, "t"); if (got.length) n++; items += got.length; rolled.push(...got); }
    check(n > 0 && Math.abs(n / 600 - SITE_GRENADES[type].p) < 0.03, `${type}: a find in ${n} of 600 search hours (${items} grenades; p ${SITE_GRENADES[type].p})`);
  }
  // Raid containers: an armoury's crate (2–4 flashbangs or 1–3 smoke).
  let crates = 0, fb = [], sm = [];
  const pol = tileOf("police");
  for (let i = 0; i < 2000; i++) {
    const got = rollAreaGrenades(st, pol, "armory", "police", `box${i}`);
    if (!got.length) continue;
    crates++;
    rolled.push(...got);
    (got[0].key === "flashbang" ? fb : sm).push(got.length);
  }
  check(Math.abs(crates / 2000 - AREA_GRENADES.armory.p) < 0.03 && Math.min(...fb) === 2 && Math.max(...fb) === 4 && Math.min(...sm) === 1 && Math.max(...sm) === 3,
    `an armoury container: a crate ${Math.round((100 * crates) / 2000)}% of the time, 2–4 flashbangs (${fb.length}) or 1–3 smoke grenades (${sm.length})`);
  check(["barracks", "milwreck", "cellblock"].every((a) => { let n = 0; for (let i = 0; i < 2000; i++) { const g = rollAreaGrenades(st, pol, a, "military", `b${a}${i}`); if (g.length) { n++; rolled.push(...g); } } return n > 0; }), "barracks (and police locker rooms), Army helicopter wrecks and cell blocks: now and then");
  // Gun safes: an armoury safe.
  let safeN = 0, safeItems = 0;
  for (let i = 0; i < 1000; i++) {
    const out = rollGunStash((...k) => hash01(seed, "fbsafe", i, ...k), "high", i % 2 ? "police" : "military");
    const g = out.gear.filter((it) => it.key === "flashbang" || it.key === "smokegren");
    safeItems += g.length; if (g.length) safeN++;
    rolled.push(...g);
  }
  check(Math.abs(safeItems / 1000 - 1) < 0.1, `an armoury safe: 0–2 flashbangs or smoke grenades (${(safeItems / 1000).toFixed(2)} a safe, ${Math.round(safeN / 10)}% have some)`);
  // Army trucks, the armoured dead, bodies.
  let tf = 0;
  for (let i = 0; i < 600; i++) { const g = truckLoot(new Rng(i + 1), ["cargo", "humvee", "mrap"][i % 3], "intact").gear.filter((it) => it.key === "flashbang"); tf += g.length; rolled.push(...g); }
  check(tf > 0 && truckLoot(new Rng(7), "cargo", "burnt").gear.every((it) => it.key !== "flashbang"), `Army trucks: ${tf} flashbangs in 600 trucks (none in a burned-out one)`);
  let df = 0, rs = 0;
  for (let i = 0; i < 4000; i++) {
    const s = bodyLoot(new Rng(i + 11), "soldier", armouredItem), r = bodyLoot(new Rng(i + 13), "riot", armouredItem);
    const g = [...s.gear.filter((it) => it.key === "flashbang"), ...r.gear.filter((it) => it.key === "smokegren" || it.key === "flashbang")];
    df += s.gear.filter((it) => it.key === "flashbang").length; rs += r.gear.filter((it) => it.key === "smokegren" || it.key === "flashbang").length;
    rolled.push(...g);
  }
  check(Math.abs(df / 4000 - MILDEAD.BODY_EXTRA.soldier[0][1]) < 0.015 && rs > 0, `the armoured dead: a dead soldier's flashbang ${(100 * df / 4000).toFixed(1)}%, a riot cop's smoke or flashbang now and then (${rs})`);
  const b = openBattle(st, { kind: "guards", count: 2, power: 3 });
  const g0 = E(b)[0];
  g0.throwables = { flashbang: 1, smokegren: 1 };
  const body = enemyBody(new Rng(3), g0, null);
  const carried = allCarried(body).filter((it) => it && (it.key === "flashbang" || it.key === "smokegren")); // inventory.js: a rig's grenade pouch too
  rolled.push(...carried, ...carriedThrowables(g0, "guard"));
  check(carried.length === 2, "a guard's unthrown flashbang and smoke grenade are on the body");
  check(rolled.length > 100 && rolled.every((it) => condRolled(it) && GEAR[it.key]), `every one of them (${rolled.length}) through itemcond.js`);
  check(GEAR.flashbang && GEAR.flashbang.throw === "flashbang" && GEAR.flashbang.cat === "explosive" && GEAR.flashbang.weight === 0.4 && GEAR.flashbang.value === 20 && ITEM_TAGS.flashbang.includes("police") && ITEM_TAGS.flashbang.includes("military"), "the item: 0.4 kg, value 20, an explosive, police and military tags");
  check(Object.keys(TRUCK_FLASH).length === 3, "trucks: the cargo truck, the Humvee, the MRAP");
}

// ---------- 6. saved mid-battle ----------
section("6. A save mid-battle keeps the stun");
{
  const st = world();
  const b = openBattle(st, { kind: "raiders", count: 3, power: 3 });
  const [me] = P(b);
  const [e0, e1] = E(b);
  place(me, 4, 6, [1, 0]); place(e0, 10, 6, [-1, 0]); place(e1, 11, 7, [-1, 0]);
  throwAt(b, me, "flashbang", 10, 6); // as thrown: the stun and the bang's lure (a tile off now and then)
  const was = JSON.stringify([e0.stun, e1.stun]);
  const L = loadFromString(saveToString(st));
  const lb = L.combat;
  const l0 = lb.units.find((u) => u.id === e0.id), l1 = lb.units.find((u) => u.id === e1.id);
  check(JSON.stringify([l0.stun, l1.stun]) === was, `the stuns come back as they were (${was})`);
  endPlayerTurn(L);
  check(l0.stun && l0.ap === 2 - l0.stun.ap && l1.ap === 2 - (l1.stun ? l1.stun.ap : 0), `and still bite: their next turn, ${l0.ap} and ${l1.ap} actions`);
  check(lb.lures.some((l) => l.key === "flashbang"), "the bang's lure is in the save too");
}

// ---------- 7. the UI ----------
section("7. The UI: the throw preview, STN / DZ, the lines");
{
  const UI = await import("../src/ui/combat.js");
  const ISO = await import("../src/ui/isoview.js");
  const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }), createRadialGradient: () => ({ addColorStop() {} }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
  globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  ISO.setIsoCanvas(cvs);
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
  const st = world();
  const b = openBattle(st, { kind: "raiders", count: 3, power: 3 });
  const [me] = P(b);
  const [e0, e1] = E(b);
  place(me, 4, 6, [1, 0]); place(e0, 10, 6, [-1, 0]); place(e1, 11, 7, [-1, 0]);
  stow(st.survivors.find((x) => x.id === me.sid), newItem("flashbang"));
  UI.cui.sel = me.id;
  const panel0 = UI.renderCombatPanel(st);
  check(/Throw flashbang \(1\)/.test(panel0), "the throw button names the flashbang and the count");
  UI.combatAction(st, "cb-act", { v: "throw", k: "flashbang" });
  check(UI.cui.mode === "throw" && UI.cui.throwKey === "flashbang" && /flash reaches/.test(UI.cui.msg), `G picks it: ${UI.cui.msg}`);
  UI.cui.hover = { x: 10, y: 6, px: 100, py: 100 };
  let err = "";
  for (const view of ["top", "iso"]) { UI.setBattleView(view); try { UI.drawCombat(st, 1e9); } catch (e) { err += `${view}: ${e.message} `; } }
  check(!err, `the preview draws in both views (top and isometric)${err ? `: ${err}` : ""}`);
  combatAct(st, { type: "throw", unit: me.id, item: "flashbang", x: 10, y: 6 });
  UI.cui.mode = "move"; UI.cui.hover = { x: 10, y: 6, px: 100, py: 100 };
  for (const view of ["top", "iso"]) { UI.setBattleView(view); try { UI.drawCombat(st, 1e9); UI.drawCombat(st, 1e9 + 700); } catch (e) { err += `${view}: ${e.message} `; } }
  check(!err, `the flash and the STN / DZ tags draw${err ? `: ${err}` : ""}`);
  const panel = UI.renderCombatPanel(st);
  check(/\(stunned\)|\(dazed\)/.test(panel) && /BANG!/.test(panel), "the enemy lines say who is stunned; the log has the bang");
  check(/stunned \(−\d action|dazed \(aim/.test(panel), "the hovered enemy's line says how badly");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
