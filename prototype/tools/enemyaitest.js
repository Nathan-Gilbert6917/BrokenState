// The enemy's nerve and its retreat (src/sim/nonlethal.js SURRENDER, surrenderCheck, numbersSurrenders, raidPrisoners;
// src/sim/siege.js coverSmoke; src/sim/throwables.js FLASH_KIT; src/sim/arsenal.js ARSENAL.NONLETHAL):
//   1. giving up: only a broken side outnumbered two to one; militia hold out longer than guards; by the numbers (a
//      decisive win of yours) and in AI raids between groups the same will by kit;
//   2. the rates measured: auto-played battles (the AI on both sides) against militia, guards, raiders and soldiers,
//      surrenders per battle and battles with one, next to what they were before (65a3ff1);
//   3. smoke in their kit: soldiers usually, militia sometimes, raiders rarely, and in the groups' arsenals;
//   4. smoke over a retreat: the turn the enemy breaks, one of them throws it between them and your people (a log
//      line), once; not while they fight on; a third-side group running from the dead does the same; your side under
//      the AI pops smoke before it sounds the retreat; a battle saved after the throw does not throw again;
//   5. three-way fights (thirdside.js): a beaten third-side group gives up to the enemy's people, an enemy gives up to
//      the soldiers fighting it, and who keeps them at the end (thirdResult, wanderers.js thirdPrisoners);
//   6. smoke helps them get away (battlesize.js fledFarEnough, throwables.js smokeScreens);
//   7. smoke between groups: none from nowhere (only finds, trade and loot bring it), and a beaten side by the numbers
//      spares a few under its smoke (smokeCover: factions.js AI raids, diplomacy.js war raids).
// Usage: node tools/enemyaitest.js [battles per setup=20] [seed=7]
import { createWorld, makeSurvivor, hub, atBase, combatPower } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import {
  createBattle, autoPlayerTurn, runEnemyPhase, endPlayerTurn, closeCombat, registerCombatHandler, enemyUnit, active,
} from "../src/sim/combat.js";
import { SURRENDER, surrenderCheck, thirdSurrenderCheck, numbersSurrenders, raidPrisoners } from "../src/sim/nonlethal.js";
import { COVER_SMOKE } from "../src/sim/siege.js";
import { FLASH_KIT, SMOKE } from "../src/sim/throwables.js";
import { ARSENAL, starterKit, ensureArsenal, kitOf, arsenalDaily, smokeCover } from "../src/sim/arsenal.js";
import { thirdSideUnit, thirdResult } from "../src/sim/thirdside.js";
import { fledFarEnough } from "../src/sim/battlesize.js";
import { thirdPrisoners } from "../src/sim/wanderers.js";
import { groupPrisoners } from "../src/sim/groupjails.js";
import { newItem, stow } from "../src/sim/inventory.js";
import { setRounds } from "../src/sim/ammo.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { Rng } from "../src/sim/rng.js";

const N = Number(process.argv[2] || 20);
const seed = Number(process.argv[3] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const t0 = Date.now();
let last = null;
registerCombatHandler("eai", (st, r) => { last = r; });
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; return st; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (list) => ({ x: list.reduce((a, u) => a + u.x, 0) / list.length, y: list.reduce((a, u) => a + u.y, 0) / list.length });

function fighter(st, weapon = "huntrifle", shooting = 9) {
  const s = makeSurvivor(st);
  s.skills.shooting = shooting;
  s.traits = [];
  s.health = 100;
  s.gear.weapon = newItem(weapon);
  for (const slot of ["head", "armor", "arms", "legs"]) s.gear[slot] = null;
  s.location = { kind: "base", baseId: hub(st).id };
  st.survivors.push(s);
  return s;
}
// A battle on an open map (every cell open, nobody unaware), your crew on the west, them placed by hand.
function openBattle(st, crew, enemy, { canRetreat = false } = {}) {
  const h = hub(st);
  setRounds(h.stock, 200, crew.map((s) => s.gear.weapon && s.gear.weapon.key).filter(Boolean));
  const b = (st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy, ambush: null, canRetreat, handler: "eai", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0);
  b.reach.fill(1);
  b.dark = false;
  for (const u of b.units) u.aware = true;
  return b;
}
const mine = (b) => b.units.filter((u) => u.side === "player");
const theirs = (b) => b.units.filter((u) => u.side === "enemy");
const kill = (u) => { u.dead = true; u.down = true; u.hp = 0; u.x = -20; u.y = -20; };
const smokeLines = (b) => b.log.filter((l) => /pops smoke to cover the retreat/.test(l.text)).length;
const clouds = (b) => (b.smoke || []).filter((c) => !c.thick);

// ---------- 1. giving up ----------
{
  console.log("1. Giving up: a broken side, outnumbered two to one");
  check(SURRENDER.outnumbered >= 2 && SURRENDER.lost >= 0.5, `the gate: lost ${SURRENDER.lost * 100}% of their people and outnumbered ${SURRENDER.outnumbered} to 1`);
  check(SURRENDER.kit.militia < SURRENDER.kit.guards && SURRENDER.kit.militia > SURRENDER.kit.raiders && SURRENDER.kit.zealots === 0, `militia hold out longer than guards (${SURRENDER.kit.militia} vs ${SURRENDER.kit.guards}), raiders longer still, zealots never`);
  // 6 militia, 4 dead, the 2 left badly hurt and in the open; 3 of yours standing (not two to one), then 4.
  const st = world();
  const crew = [fighter(st), fighter(st), fighter(st), fighter(st)];
  const b = openBattle(st, crew, { kind: "militia", count: 6, power: 3 });
  const [a, c, ...rest] = theirs(b);
  rest.forEach(kill);
  a.x = 12; a.y = 5; c.x = 12; c.y = 9; a.hp = c.hp = 10;
  mine(b).forEach((u, i) => { u.x = 4; u.y = 3 + i * 2; });
  const four = mine(b)[3];
  four.x = -20; four.y = -20; four.left = true; // only 3 of yours on the field
  let gave = 0;
  for (let t = 0; t < 40; t++) { b.turn = 100 + t; gave += surrenderCheck(b); }
  check(gave === 0, `2 of them left against 3 of yours: nobody gives up in 40 turns (${gave})`);
  four.left = false; four.x = 4; four.y = 11;
  for (let t = 0; t < 40 && !gave; t++) { b.turn = 200 + t; gave += surrenderCheck(b); }
  check(gave > 0, "against 4 of yours (two to one) the badly hurt may give up");
  closeCombat(st);
}
{
  console.log("   By the numbers and between groups: the same will");
  const st = world(seed + 1);
  const mean = (kind, n = 600) => { let s = 0; for (let i = 0; i < n; i++) { st.hour = i; s += numbersSurrenders(st, { enemy: { kind, count: 6, name: `x${i}` } }, { outcome: "victory", survivorsDead: [] }); } return s / n; };
  const mM = mean("militia"), mG = mean("guards"), mR = mean("raiders"), mZ = mean("zealots");
  const before = 6 * 0.15; // the old rate for 6 militia or guards (SURRENDER.numbers 0.15, will 1)
  check(mM > 0 && mM < mG && mR < mG && mZ === 0, `a decisive win over 6: militia give up ${mM.toFixed(2)} a win, guards ${mG.toFixed(2)}, raiders ${mR.toFixed(2)}, zealots ${mZ}`);
  check(mM <= before / 2 && mM >= before / 5, `militia by the numbers about a third of before (${mM.toFixed(2)} vs ${before.toFixed(2)})`);
  const share = (ttype) => { let taken = 0, lost = 0; for (let i = 0; i < 400; i++) { st.hour = i; const loss = 3 + (i % 4); taken += raidPrisoners(st, { id: 900 + i, type: "traders" }, { id: 1900 + i, type: ttype }, loss); lost += loss; } return taken / lost; };
  const sC = share("commune"), sT = share("traders"), sZ = share("zealot"), sN = share(undefined);
  check(sC < sT && sZ < sC && Math.abs(sN - sT) < 0.05, `AI raids: traders take ${Math.round(sC * 100)}% of beaten communes alive, ${Math.round(sT * 100)}% of traders, ${Math.round(sZ * 100)}% of zealots (no type: ${Math.round(sN * 100)}%, as before)`);
}

// ---------- 2. the rates, measured ----------
{
  console.log(`2. Auto-played battles (${N} per setup; 3 vs 4 even, 4 vs 4 at 0.8, 4 vs 6 even)`);
  const st = world(seed + 2);
  const base = hub(st);
  const TERRAINS = ["plains", "forest", "hills", "suburb", "city"];
  const team = (n) => Array.from({ length: n }, () => { const s = fighter(st, st.rng.pick(["pistol", "pistol", "huntrifle", "shotgun"]), st.rng.int(5, 11)); return s; });
  const battle = (kind, players, count, ratio) => {
    const tile = st.rng.pick(st.tiles.filter((t) => t.terrain !== "water"));
    st.tiles[tile.id] = { ...tile, terrain: st.rng.pick(TERRAINS), road: st.rng.chance(0.4), infection: 0, loc: null };
    const people = team(players);
    const power = (people.reduce((a, s) => a + combatPower(s), 0) / count) * ratio;
    base.stock.ammo = 200; base.stock.meds = 3; base.armory.length = 0;
    st.combat = createBattle(st, { tile: tile.id, baseId: base.id, fighterIds: people.map((s) => s.id), enemy: { kind, count, power }, ambush: null, canRetreat: false, handler: "eai", context: {} });
    for (let g = 0; g < 60 && !st.combat.over; g++) { autoPlayerTurn(st); runEnemyPhase(st); }
    const b = st.combat;
    const surr = theirs(b).filter((u) => u.surrTurn != null).length, smoke = smokeLines(b), fled = b.log.some((l) => /falls back|breaks and runs/.test(l.text));
    last = null;
    if (b.over) closeCombat(st); else st.combat = null;
    const won = !!last && last.outcome === "victory";
    st.tiles[tile.id] = tile;
    st.survivors = st.survivors.filter((s) => !people.includes(s));
    st.deathSites = []; st.cards = []; st.gameOver = false;
    return { surr, smoke, fled, won };
  };
  // Measured on 65a3ff1 with the same setups (2 seeds × 300 battles a kit): surrenders a battle, battles with one.
  const BEFORE = { militia: [0.6, 0.47], guards: [0.43, 0.35], survivors: [0.78, 0.61], fighters: [0.32, 0.27], raiders: [0.41, 0.38], soldiers: [0.055, 0.055] };
  const row = {};
  for (const kind of ["militia", "guards", "raiders", "soldiers"]) {
    let surr = 0, withS = 0, n = 0, wins = 0, smoke = 0, fled = 0;
    for (const [p, c, r] of [[3, 4, 1], [4, 4, 0.8], [4, 6, 1]]) for (let i = 0; i < N; i++) {
      const x = battle(kind, p, c, r);
      n++; surr += x.surr; if (x.surr) withS++; if (x.won) wins++; smoke += x.smoke; if (x.fled) fled++;
    }
    row[kind] = { s: surr / n, w: withS / n };
    console.log(`    ${kind.padEnd(9)} win ${Math.round((100 * wins) / n)}%  surrenders/battle ${(surr / n).toFixed(2)} (before ${BEFORE[kind][0]})  battles with one ${Math.round((100 * withS) / n)}% (before ${Math.round(BEFORE[kind][1] * 100)}%)  broke and ran ${fled}  smoke over the retreat ${smoke}`);
  }
  check(row.militia.s <= BEFORE.militia[0] * 0.55 && row.militia.w <= BEFORE.militia[1] * 0.6, `militia give up clearly less often (${row.militia.s.toFixed(2)} a battle, was ${BEFORE.militia[0]})`);
  // Guards and raiders: 60 battles a kit leave about ±0.07 of sampling noise on each rate, so the cut to 0.7 of before is
  // measured on the two kits together (120 battles), each kit on its own within 0.8 of before. (After the long-gun
  // rules, bal-guns, your teams win a little more often and guards give up about 0.23 a battle over seeds 1, 2, 3 and 7,
  // 0.32 on seed 7 alone: a single kit's 0.7 line flipped on noise.)
  const pooled = (row.guards.s + row.raiders.s) / (BEFORE.guards[0] + BEFORE.raiders[0]);
  check(pooled <= 0.7 && row.guards.s <= BEFORE.guards[0] * 0.8 && row.raiders.s <= BEFORE.raiders[0] * 0.8, `guards and raiders cut in proportion (together ${pooled.toFixed(2)} of before)`);
}

// ---------- 3. smoke in their kit ----------
{
  console.log("3. Smoke grenades in their kit");
  const st = world(seed + 3);
  const b = openBattle(st, [fighter(st)], { kind: "raiders", count: 1, power: 3 });
  const M = 3000, got = {};
  for (const kind of ["soldiers", "contractors", "guards", "militia", "fighters", "raiders", "zealots"]) {
    let n = 0;
    for (let i = 0; i < M; i++) { const u = enemyUnit(b, new Rng(i * 29 + 5), kind, 4, i); if (u.throwables && u.throwables.smokegren) n++; }
    got[kind] = n / M;
  }
  const want = (k) => (FLASH_KIT[k] && FLASH_KIT[k].smokegren ? FLASH_KIT[k].smokegren[0] : 0);
  // fighters.js: a person carries what their body would yield, a pocket find among it (now and then a smoke grenade
  // too): the kit's share at least, a little over.
  check(Object.keys(got).every((k) => got[k] > want(k) - 0.03 && got[k] - want(k) < 0.06), `carried: ${Object.entries(got).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(", ")}`);
  check(got.soldiers > got.militia && got.militia > got.raiders && got.raiders > 0 && got.zealots === 0, "soldiers usually, militia sometimes, raiders rarely, zealots never");
  const count = (type) => starterKit(seed, "eai", type, 20).filter((it) => it.key === "smokegren").length;
  check(count("military") === Math.round(20 * ARSENAL.NONLETHAL.soldiers.smokegren) && count("commune") === Math.round(20 * ARSENAL.NONLETHAL.militia.smokegren) && count("raider") === Math.round(20 * ARSENAL.NONLETHAL.raiders.smokegren),
    `a group's starting arsenal for 20 people: military ${count("military")}, commune ${count("commune")}, raiders ${count("raider")} smoke grenades`);
  // An arsenal from an older save (dealt before smoke was in the kits): topped up once when next read.
  const f = st.factions.find((x) => x.alive && !x.outsider && ARSENAL.NONLETHAL[kitOf(x)] && ARSENAL.NONLETHAL[kitOf(x)].smokegren * x.pop >= 1);
  if (check(!!f, "a group whose kit carries smoke")) {
    const A = ensureArsenal(st, f);
    A.items = A.items.filter((it) => it.key !== "smokegren");
    delete A.smoke;
    const want = Math.round(f.pop * ARSENAL.NONLETHAL[kitOf(f)].smokegren);
    const n1 = ensureArsenal(st, f).items.filter((it) => it.key === "smokegren").length;
    const n2 = ensureArsenal(st, f).items.filter((it) => it.key === "smokegren").length;
    check(n1 === want && n2 === want && A.smoke, `an older save's ${f.type} arsenal gets its ${want} smoke grenades once (${n1}, then ${n2})`);
  }
  closeCombat(st);
}

// ---------- 4. smoke over a retreat ----------
{
  console.log("4. Smoke over a retreat");
  // 6 soldiers, 4 already dead; the 2 left (both with a smoke grenade) against 4 of yours: they break and run.
  const st = world(seed + 4);
  const crew = [fighter(st), fighter(st), fighter(st), fighter(st)];
  const b = openBattle(st, crew, { kind: "soldiers", count: 6, power: 4 });
  const [a, c, ...rest] = theirs(b);
  rest.forEach(kill);
  a.x = 14; a.y = 6; c.x = 14; c.y = 9;
  for (const u of [a, c]) { u.throwables = { smokegren: 1 }; u.fearless = false; }
  mine(b).forEach((u, i) => { u.x = 7; u.y = 4 + i * 2; });
  const group0 = mid([a, c]), foes0 = mid(mine(b));
  endPlayerTurn(st);
  runEnemyPhase(st);
  const cl = clouds(b);
  const threw = [a, c].filter((u) => u.throwables.smokegren === 0);
  check(smokeLines(b) === 1 && cl.length === 1 && threw.length === 1, `the turn they break, one of them pops smoke (${b.log.find((l) => /pops smoke/.test(l.text))?.text || "none"})`);
  if (cl.length) {
    const s = cl[0];
    const toward = (s.x - group0.x) * (foes0.x - group0.x) + (s.y - group0.y) * (foes0.y - group0.y) >= 0;
    check(toward && dist(s, group0) <= COVER_SMOKE.AHEAD + 2.5 && dist(s, foes0) < dist(group0, foes0), `the cloud (${s.x}, ${s.y}) lies between them (${group0.x.toFixed(1)}, ${group0.y.toFixed(1)}) and your people (${foes0.x.toFixed(1)}, ${foes0.y.toFixed(1)}), ${SMOKE.r} tiles around`);
  }
  check([a, c].some((u) => u.fleeing || u.fled), "and they fall back");
  // Saved after the throw: the next enemy turn throws no more, in the saved game or the live one.
  const text = saveToString(st);
  const B = loadFromString(text);
  check(B.combat && B.combat.coverSmoke && B.combat.coverSmoke.enemy && B.combat.coverSmoke.enemy.done, "a saved battle remembers the smoke was thrown");
  for (const w of [st, B]) {
    const bb = w.combat;
    for (const u of theirs(bb)) if (active(u)) u.throwables = { smokegren: 1 };
    bb.phase = "player";
    endPlayerTurn(w);
    runEnemyPhase(w);
  }
  check(smokeLines(b) === 1 && smokeLines(B.combat) === 1, "once: the next turn nobody throws another, even with smoke to hand");
  closeCombat(st);
}
{
  // The same 6 soldiers all standing: they fight on, nobody throws smoke.
  const st = world(seed + 5);
  const crew = [fighter(st), fighter(st), fighter(st)];
  const b = openBattle(st, crew, { kind: "soldiers", count: 6, power: 4 });
  theirs(b).forEach((u, i) => { u.x = 14; u.y = 2 + i * 2; u.throwables = { smokegren: 1 }; });
  mine(b).forEach((u, i) => { u.x = 7; u.y = 4 + i * 2; });
  endPlayerTurn(st);
  runEnemyPhase(st);
  check(smokeLines(b) === 0, "while they fight on (not beaten), nobody throws smoke to retreat");
  closeCombat(st);
}
{
  // A third-side group (unarmed survivors) running from the dead: one pops smoke behind them.
  const st = world(seed + 6);
  const b = openBattle(st, [fighter(st)], { kind: "zombies", count: 3, power: 2 });
  mine(b)[0].x = 1; mine(b)[0].y = 1;
  theirs(b).forEach((z, i) => { z.x = 8; z.y = 6 + i; z.aware = true; });
  const g = { side: "neutral", name: "the campers", people: [{ name: "Ada Lowe", weapon: "fists" }, { name: "Ben Lowe", weapon: "fists" }] };
  const units = [0, 1].map((k) => { const u = enemyUnit(b, st.rng, "survivors", 3, k + 1); b.units.push(u); thirdSideUnit(b, u, g, k); u.x = 13; u.y = 6 + k; u.aware = true; return u; });
  units[1].throwables = { smokegren: 1 };
  endPlayerTurn(st);
  runEnemyPhase(st);
  const line = b.log.find((l) => /pops smoke to cover the retreat/.test(l.text));
  check(!!line && /Ben Lowe/.test(line.text) && clouds(b).length === 1 && units[1].throwables.smokegren === 0, `a third-side group running from the dead: ${line ? line.text : "no smoke"}`);
  closeCombat(st);
}
{
  // Your side under "AI plays my side": smoke over the team before it sounds the retreat (stealth.js botRetreatSmoke).
  const st = world(seed + 7);
  const crew = [fighter(st, "pistol", 4), fighter(st, "pistol", 4)];
  stow(crew[0], newItem("smokegren"));
  const b = openBattle(st, crew, { kind: "soldiers", count: 6, power: 8 }, { canRetreat: true });
  theirs(b).forEach((e, i) => { e.x = 15; e.y = 2 + i; });
  mine(b)[0].x = 3; mine(b)[0].y = 4; mine(b)[1].x = 3; mine(b)[1].y = 8;
  autoPlayerTurn(st);
  check(b.over && b.result && b.result.outcome === "retreat" && b.log.some((l) => /throws a smoke grenade/.test(l.text)), "your AI, hopelessly outgunned, pops smoke and sounds the retreat");
  closeCombat(st);
}

// ---------- 5. three-way fights ----------
// A battle with you far off, the enemy's raiders and a third-side group (survivors or soldiers) at each other.
function threeWay(st, kind, team, { enemies = 4, thirdN = 4, armed = "pistol" } = {}) {
  const b = openBattle(st, [fighter(st)], { kind, count: enemies, power: 3, name: "the Red Hand" });
  mine(b)[0].x = 1; mine(b)[0].y = 1;
  const g = { side: team, name: team === "military" ? "the soldiers" : "the travellers", factionId: null, people: Array.from({ length: thirdN }, (_, k) => ({ name: `Third ${k + 1}`, weapon: armed })) };
  const units = Array.from({ length: thirdN }, (_, k) => { const u = enemyUnit(b, st.rng, team === "military" ? "soldiers" : "survivors", 3, k + 1); b.units.push(u); thirdSideUnit(b, u, g, k); u.aware = true; u.x = 14; u.y = 4 + k * 2; return u; });
  theirs(b).forEach((e, i) => { e.x = 17; e.y = 4 + i * 2; e.aware = true; });
  return { b, units };
}
{
  console.log("5. Three-way fights: who gives up to whom, who keeps them");
  // The travellers beaten: 2 of 4 dead, the 2 left hurt, 4 raiders after them.
  const st = world(seed + 20);
  const { b, units } = threeWay(st, "raiders", "neutral");
  units.slice(2).forEach(kill);
  units.slice(0, 2).forEach((u) => { u.hp = 8; });
  let gave = 0;
  for (let t = 0; t < 40 && !gave; t++) { b.turn = 300 + t; gave += thirdSurrenderCheck(b); }
  const sur = units.find((u) => u.surr);
  const line = b.log.find((l) => /gives up to/.test(l.text));
  check(gave > 0 && !!sur && sur.surrTo === "enemy" && sur.weapon === "fists" && !!sur.nlWeapon && !!line && /the Red Hand/.test(line.text), `beaten and outnumbered two to one, the travellers give up to the raiders (${line ? line.text : "none"})`);
  let r = thirdResult(b)[0];
  check(r.gaveUp === gave && r.taken === gave && r.freed === 0, `with the raiders still standing they lead them off (gave up ${r.gaveUp}, taken ${r.taken})`);
  theirs(b).forEach(kill);
  r = thirdResult(b)[0];
  check(r.taken === 0 && r.freed === gave, `with the raiders beaten, your win frees them (freed ${r.freed})`);
  if (sur) {
    b.phase = "player"; endPlayerTurn(st);
    check(!sur.surr && sur.weapon !== "fists", "once their captors are gone they lower their hands and take up their weapon");
  }
  closeCombat(st);
  // 3 raiders against 4 travellers who all stand: nobody gives up (not beaten); 2 dead against 3: not two to one.
  const st2 = world(seed + 21);
  const t2 = threeWay(st2, "raiders", "neutral", { enemies: 3 });
  let none = 0;
  for (let t = 0; t < 40; t++) { t2.b.turn = 400 + t; none += thirdSurrenderCheck(t2.b); }
  t2.units.slice(2).forEach(kill); t2.units.slice(0, 2).forEach((u) => { u.hp = 8; });
  for (let t = 0; t < 40; t++) { t2.b.turn = 500 + t; none += thirdSurrenderCheck(t2.b); }
  check(none === 0, "not while they stand, nor 2 against 3 raiders (not two to one)");
  closeCombat(st2);
  // An enemy gives up to the soldiers fighting it: 4 raiders, 2 dead, 2 hurt; a squad of 3 next to them, you far off.
  const st3 = world(seed + 22);
  const t3 = threeWay(st3, "raiders", "military", { thirdN: 3, armed: "ar" });
  const foes = theirs(t3.b);
  foes.slice(2).forEach(kill);
  foes.slice(0, 2).forEach((e, i) => { e.hp = 10; e.x = 15; e.y = 4 + i * 2; });
  let gave3 = 0;
  for (let t = 0; t < 40 && !gave3; t++) { t3.b.turn = 600 + t; gave3 += surrenderCheck(t3.b); }
  const es = foes.find((e) => e.surr);
  const line3 = t3.b.log.find((l) => /gives up to the soldiers/.test(l.text));
  check(gave3 > 0 && !!es && es.surrTo === 0 && !!line3, `an enemy beaten by you and the soldiers together gives up to the soldiers, the nearest (${line3 ? line3.text : "none"})`);
  const r3 = thirdResult(t3.b)[0];
  check(r3.held === gave3, `the soldiers keep the ones they hold (held ${r3.held})`);
  if (es) { es.tied = true; check(thirdResult(t3.b)[0].held === gave3 - 1, "tied up by your people first, they are yours instead"); }
  closeCombat(st3);
  // Settled after the fight (wanderers.js thirdPrisoners): the soldiers' group and the enemy's group.
  const st4 = world(seed + 23);
  const [sf, ef] = st4.factions.filter((f) => f.alive && f.bases.length);
  sf.jails = { [sf.bases[0]]: 1 }; ef.jails = { [ef.bases[0]]: 1 }; sf.prisoners = []; ef.prisoners = [];
  const pop0 = sf.pop, epop0 = ef.pop, gw0 = sf.goodwill;
  const lines = thirdPrisoners(st4, { name: "the soldiers", taken: 2, freed: 0, held: 0 }, sf, null, { name: "the Red Hand", factionId: ef.id });
  check(sf.pop === pop0 - 2 && groupPrisoners(ef).filter((p) => p.from === sf.id).length === 2 && /led off by the Red Hand/.test(lines[0]), `taken: 2 soldiers into the enemy group's jail (${lines[0]})`);
  thirdPrisoners(st4, { name: "the soldiers", taken: 0, freed: 2, held: 1, hostile: false }, sf, null, { name: "the Red Hand", factionId: ef.id });
  check(sf.goodwill > gw0 && ef.pop === epop0 - 1 && groupPrisoners(sf).filter((p) => p.from === ef.id).length === 1, `freed: goodwill with their group (${gw0} → ${sf.goodwill}); held: 1 of the enemy into the soldiers' jail`);
  const wg = { people: [{ name: "A" }, { name: "B" }, { name: "C" }] };
  thirdPrisoners(st4, { name: "the travellers", taken: 2, freed: 0, held: 0 }, null, wg, { name: "raiders" });
  check(wg.people.length === 1, "travellers taken are gone from their group");
}

// ---------- 6. smoke helps them get away ----------
{
  console.log("6. Behind the smoke they get away");
  const st = world(seed + 30);
  const b = openBattle(st, [fighter(st)], { kind: "raiders", count: 1, power: 3 });
  const [p] = mine(b), [e] = theirs(b);
  p.x = 5; p.y = 6; e.x = 11; e.y = 6; e.fleeing = true;
  check(!fledFarEnough(b, e), "6 tiles off in plain sight: not gone");
  b.smoke = [{ x: 8, y: 6, r: SMOKE.r, turns: 3 }];
  check(fledFarEnough(b, e), `6 tiles off behind a cloud: gone (${SMOKE.gone} tiles is enough behind smoke)`);
  p.x = 8; p.y = 6;
  check(!fledFarEnough(b, e), "chase into the cloud, 3 tiles off: still there to shoot at (−30 from inside it)");
  closeCombat(st);
}

// ---------- 7. smoke between groups ----------
{
  console.log("7. Smoke between groups: never from nowhere, thrown over a retreat by the numbers");
  const st = world(seed + 40);
  const days = (f, n) => { for (let d = 0; d < n; d++) { f.careTick = (f.careTick || 0) + 1; st.hour += 24; arsenalDaily(st, f); } return ensureArsenal(st, f).items.filter((it) => it.key === "smokegren").length; };
  const mil = st.factions.find((f) => f.alive && kitOf(f) === "soldiers" && f.pop >= 3);
  if (check(!!mil, "a group with the military kit")) {
    const want = Math.round(mil.pop * ARSENAL.NONLETHAL.soldiers.smokegren);
    const A = ensureArsenal(st, mil);
    A.items = A.items.filter((it) => it.key !== "smokegren"); A.rev++;
    const n30 = days(mil, 60);
    check(n30 === 0, `${mil.type} (${mil.pop} people, ${want} smoke their kit's share): none from nowhere in 60 days with none found or bought (${n30}; docs/adr/0001-ai-parity.md)`);
  }
  const f = st.factions.find((x) => x.alive && !x.outsider);
  const A = ensureArsenal(st, f);
  A.items = A.items.filter((it) => it.key !== "smokegren");
  check(smokeCover(st, f, 5) === 0, "no smoke: nothing spared");
  for (let i = 0; i < 3; i++) A.items.push(newItem("smokegren"));
  const c5 = smokeCover(st, f, 5), left = A.items.filter((it) => it.key === "smokegren").length, c1 = smokeCover(st, f, 1);
  check(c5 === ARSENAL.SMOKE_COVER.MAX && left === 3 - ARSENAL.SMOKE_COVER.MAX && c1 === 0, `5 to lose and 3 grenades: ${c5} spared, ${left} grenade left; 1 to lose: none spared`);
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
