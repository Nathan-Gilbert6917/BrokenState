// Jams and misfires (src/sim/gunfire.js, combat.js fire / combatAct "unjam" / aiUnit / the raid bot; plan section 14 with
// the section 20 and 25 decisions). Checks: the per-round jam chance by configuration (the gun's rel, its quality and
// its durability, the ammo's condition and type, attachments, weather, fouling, the 12% cap) against a Monte Carlo of
// 100k trigger pulls each (within ±10% relative), a burst's chance, the kinds (70 / 25 / 5), misfire platforms never
// jam, Unjam's costs (1 action, 2 actions, over two turns), a double feed cleared by a Reload, a hard jam's quality,
// no shot or overwatch while jammed, enemies jam and clear their jams, your side's AI and the raid bot clear theirs, a
// save in the middle of a jam.
// Usage: node tools/jamtest.js [seed]
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { WEAPONS, createBattle, combatAct, registerCombatHandler, runEnemyPhase, autoPlayerTurn, canFire, fireRefusal, fire, magIn, loadMag } from "../src/sim/combat.js";
import { jamChance, rollTrigger, JAM, misfires, jamGun, unjam, gunQ, gunCond, enemyGunQ, enemyGunCond, MISFIRE_KEYS } from "../src/sim/gunfire.js";
import { COND_SOURCES, kitSource } from "../src/sim/itemcond.js";
import { launchExpedition } from "../src/sim/parties.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { newItem } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { GEAR } from "../src/sim/data.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
registerCombatHandler("jamtest", () => {});
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };
const pct = (v) => `${Math.round(v * 10000) / 100}%`;

function fighter(state, weapon = "pistol", shooting = 9) {
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
function openBattle(state, crew, enemy = { kind: "raiders", count: 2, power: 3 }, ammo = 300) {
  const h = hub(state);
  h.stock.ammo = ammo; h.stock.meds = 0;
  const b = (state.combat = createBattle(state, { tile: h.tile, baseId: h.id, fighterIds: crew.map((s) => s.id), enemy, ambush: null, canRetreat: true, handler: "jamtest", context: {} }));
  for (const c of b.cells) c.k = "open";
  b.losCache.fill(0);
  b.reach.fill(1);
  b.dark = false; b.night = false; b.jamWx = 1;
  b.phase = "player";
  for (const u of b.units) if (u.side === "enemy") { u.aware = true; u.x = -10; u.y = -10; u.dead = true; }
  return b;
}
const by = (b, s) => b.units.find((u) => u.sid === s.id);
const foes = (b) => b.units.filter((u) => u.side === "enemy");
const place = (u, x, y) => { u.x = x; u.y = y; u.dead = false; u.down = false; };
const toughen = (u) => { u.hp = u.maxHp = 100000; };
const logHas = (b, re) => b.log.some((l) => re.test(l.text));

// 1. The jam chance by configuration, and a Monte Carlo of it.
{
  console.log("Jam chance by configuration (100k trigger pulls each)");
  const gun = (key, q = 1, extra = {}) => { const it = newItem(key, q); Object.assign(it, extra); return it; };
  const configs = [
    { name: "new assault rifle, factory ammo", u: { weapon: "ar", item: gun("ar") }, want: 0.005 },
    { name: "9mm pistol at quality 0.7", u: { weapon: "pistol", item: gun("pistol", 0.7) }, want: 0.0035 * 1.6 },
    { name: "assault rifle worn to 20% of its durability", u: { weapon: "ar", item: gun("ar", 1, { dur: Math.round(GEAR.ar.dur * 0.2) }) }, want: 0.005 * (1 + (1 - Math.round(GEAR.ar.dur * 0.2) / GEAR.ar.dur)) },
    { name: "pipe shotgun, poor handloads (hq 0)", u: { weapon: "pipegun", item: gun("pipegun"), loadCond: "hand", loadHq: 0 }, want: 0.012 * 2.5 },
    { name: "assault rifle, old rounds, drum, storm", u: { weapon: "ar", item: gun("ar", 1, { mods: { mag: newItem("drum") } }), loadCond: "old" }, wx: 1.5, want: 0.005 * 3 * 1.5 * 1.5 },
    { name: "carbine fouled by 400 rounds, rain", u: { weapon: "carbine", item: gun("carbine", 1, { fouled: 400 }) }, wx: 1.3, want: 0.005 * 1.5 * 1.3 },
    { name: "a wreck: capped at 12%", u: { weapon: "pipegun", item: gun("pipegun", 0.4, { dur: 1 }), loadCond: "old" }, wx: 1.5, want: JAM.CAP },
    { name: "enemy assault rifle (u.q 0.5, cond 0.5)", u: { weapon: "ar", q: 0.5, cond: 0.5 }, want: 0.005 * 2 * 1.5 },
  ];
  for (const c of configs) {
    const b = { dseed: 1000 + configs.indexOf(c), diceN: 0, jamWx: c.wx || 1 };
    const p = jamChance(b, c.u);
    check(Math.abs(p - c.want) < 1e-9, `${c.name}: ${pct(p)} a round (want ${pct(c.want)})`);
    const N = 100000;
    let n = 0;
    for (let i = 0; i < N; i++) { const r = rollTrigger(b, c.u, 1); if (r.jam || r.misfire) n++; }
    check(Math.abs(n / N - p) / p <= 0.1, `  Monte Carlo ${pct(n / N)} within ±10% of ${pct(p)}`);
  }
  // A burst of n rounds: 1 − (1 − p)^n.
  const u = { weapon: "ar", item: newItem("ar", 0.4), loadCond: "old" };
  const b = { dseed: 77, diceN: 0, jamWx: 1 };
  const p = jamChance(b, u), want = 1 - Math.pow(1 - p, 10);
  let n = 0, fired = 0, spent = 0;
  const N = 100000;
  for (let i = 0; i < N; i++) { const r = rollTrigger(b, u, 10); if (r.jam) { n++; fired += r.fired; spent += r.spent; } }
  check(Math.abs(n / N - want) / want <= 0.1, `a 10-round stream jams ${pct(n / N)} (1 − (1 − ${pct(p)})^10 = ${pct(want)})`);
  check(n > 0 && spent === fired + n && fired / n > 3 && fired / n < 6, `a jam stops the stream part-way (${(fired / n).toFixed(2)} rounds fired before it on average), the jammed round lost`);
  // Kinds: stovepipe 70%, double feed 25%, hard 5%.
  const kinds = { stovepipe: 0, double: 0, hard: 0 };
  const wreck = { weapon: "ar", item: newItem("ar", 0.4), loadCond: "old" };
  const bk = { dseed: 5, diceN: 0, jamWx: 1.5 };
  let jams = 0;
  for (let i = 0; i < 200000; i++) { const r = rollTrigger(bk, wreck, 1); if (r.jam) { kinds[r.jam]++; jams++; } }
  const share = (k) => kinds[k] / jams;
  check(Math.abs(share("stovepipe") - 0.7) / 0.7 <= 0.1 && Math.abs(share("double") - 0.25) / 0.25 <= 0.1 && Math.abs(share("hard") - 0.05) / 0.05 <= 0.1,
    `kinds of ${jams} jams: stovepipe ${pct(share("stovepipe"))}, double feed ${pct(share("double"))}, hard ${pct(share("hard"))} (70 / 25 / 5)`);
  // Misfire platforms: revolvers, double-barrels, bolt, lever, pump guns never jam.
  const bm = { dseed: 9, diceN: 0, jamWx: 1.5 };
  for (const k of ["revolver", "shotgun", "huntrifle", "leverrifle", "pipegun"]) {
    const mu = { weapon: k, item: newItem(k, 0.4), loadCond: "old" };
    let mis = 0, jam = 0;
    for (let i = 0; i < 20000; i++) { const r = rollTrigger(bm, mu, 1); if (r.misfire) mis++; if (r.jam) jam++; }
    check(misfires(k) && jam === 0 && mis > 0, `${WEAPONS[k].name} misfires (${mis} of 20000) and never jams`);
  }
  check(!misfires("ar") && !misfires("pistol") && !misfires("carbine") && MISFIRE_KEYS.has("revolver"), "the assault rifle, the pistol and the carbine jam rather than misfire");
  check(jamChance({}, { weapon: "compbow" }) === 0 && jamChance({}, { weapon: "knife" }) === 0, "bows and blades never jam");
  // Enemy guns: quality 0.4–0.85 on their own dice.
  const qs = Array.from({ length: 500 }, (_, i) => enemyGunQ(seed, i));
  check(qs.every((q) => q >= 0.4 && q <= 0.85) && Math.max(...qs) - Math.min(...qs) > 0.3, `an enemy's gun quality is rolled 0.4–0.85 (${Math.min(...qs)}–${Math.max(...qs)})`);
  // With their kit: the ranges of the bodies that kit leaves (itemcond.js kitSource), a soldier's rifle better kept.
  const byKit = (kit) => { const q = Array.from({ length: 500 }, (_, i) => enemyGunQ(seed, i, kit)), c = Array.from({ length: 500 }, (_, i) => enemyGunCond(seed, i, kit)); return { q, c, mq: q.reduce((a, v) => a + v, 0) / q.length }; };
  const sol = byKit("soldiers"), rai = byKit("raiders"), S = COND_SOURCES[kitSource("soldiers")], R = COND_SOURCES[kitSource("raiders")];
  check(sol.q.every((q) => q >= S.q[0] && q <= S.q[1]) && sol.c.every((c) => c >= S.d[0] && c <= S.d[1]) && rai.q.every((q) => q >= R.q[0] && q <= R.q[1]) && sol.mq > rai.mq + 0.05, `by kit, as itemcond's bodies: soldiers ${S.q.join("–")} (mean ${sol.mq.toFixed(2)}), raiders ${R.q.join("–")} (mean ${rai.mq.toFixed(2)})`);
  check(gunQ({ item: newItem("pistol", 0.6) }) === 0.6 && gunCond({ item: Object.assign(newItem("pistol"), { dur: GEAR.pistol.dur / 2 }) }) === 0.5, "a gun's quality and its durability both count");
}

// 2. In a battle: a jam stops the gun; Unjam's costs; Reload clears a double feed; a hard jam costs quality.
{
  console.log("Jammed in battle");
  const st = createWorld({ seed, factionCount: 4 });
  const a = fighter(st, "ar"), c = fighter(st, "pistol");
  const b = openBattle(st, [a, c], { kind: "raiders", count: 2, power: 3 });
  const p = by(b, a), q = by(b, c), e = foes(b).find((x) => x.kind === "human");
  place(p, 5, 5); place(q, 5, 7); place(e, 11, 6); toughen(e);
  jamGun(b, p, "stovepipe");
  check(p.jam && p.jam.kind === "stovepipe" && p.jam.ap === 1 && !canFire(b, p), "a stovepipe: jammed, 1 action to clear, no shot");
  check(/Jammed \(stovepipe\): Unjam \(J\)/.test(fireRefusal(b, p)) && /Jammed/.test(combatAct(st, { type: "shoot", unit: p.id, target: e.id })), `Shoot is refused: "${fireRefusal(b, p)}"`);
  check(/Jammed/.test(combatAct(st, { type: "overwatch", unit: p.id })) && !p.ow, "Overwatch is refused while jammed");
  check(/not jammed/.test(combatAct(st, { type: "unjam", unit: q.id })), "Unjam on a gun that is fine is refused");
  check(combatAct(st, { type: "unjam", unit: p.id }) === "" && !p.jam && p.ap === 1 && canFire(b, p), "Unjam: 1 action, the gun fires again");
  check(combatAct(st, { type: "shoot", unit: p.id, target: e.id }) === "", "and shoots with the other action");
  // Double feed: 2 actions (over two turns with 1), or a Reload.
  const st2 = createWorld({ seed: seed + 1, factionCount: 4 });
  const a2 = fighter(st2, "pistol"), c2 = fighter(st2, "pistol");
  const b2 = openBattle(st2, [a2, c2], { kind: "raiders", count: 1, power: 3 });
  const p2 = by(b2, a2), q2 = by(b2, c2);
  place(p2, 5, 5); place(q2, 6, 9); place(foes(b2)[0], 14, 6); toughen(foes(b2)[0]);
  jamGun(b2, p2, "double");
  check(p2.jam.ap === 2 && combatAct(st2, { type: "unjam", unit: p2.id }) === "" && !p2.jam && p2.ap === 0, "a double feed: Unjam takes both actions");
  jamGun(b2, q2, "double");
  q2.ap = 1;
  combatAct(st2, { type: "unjam", unit: q2.id });
  check(q2.jam && q2.jam.ap === 1, "with 1 action left it is worked at (1 more next turn)");
  const st3 = createWorld({ seed: seed + 2, factionCount: 4 });
  const a3 = fighter(st3, "pistol");
  const b3 = openBattle(st3, [a3], { kind: "raiders", count: 1, power: 3 });
  const p3 = by(b3, a3);
  place(p3, 5, 5); place(foes(b3)[0], 14, 6); toughen(foes(b3)[0]);
  jamGun(b3, p3, "double");
  check(magIn(p3) === 15 && combatAct(st3, { type: "reload", unit: p3.id }) === "" && !p3.jam && p3.ap === 1 && magIn(p3) === 15 && logHas(b3, /double feed/), "a Reload clears a double feed (1 action: the magazine dropped, a fresh one in)");
  jamGun(b3, p3, "stovepipe");
  loadMag(p3, 3);
  combatAct(st3, { type: "reload", unit: p3.id });
  check(p3.jam && p3.jam.kind === "stovepipe", "a Reload does not clear a stovepipe");
  // Hard jam: 2 actions and −0.05 quality.
  const st4 = createWorld({ seed: seed + 3, factionCount: 4 });
  const a4 = fighter(st4, "pistol");
  a4.gear.weapon.quality = 0.9;
  const b4 = openBattle(st4, [a4], { kind: "raiders", count: 1, power: 3 });
  const p4 = by(b4, a4);
  jamGun(b4, p4, "hard");
  check(p4.jam.ap === 2 && Math.abs(a4.gear.weapon.quality - 0.85) < 1e-9, `a hard jam: 2 actions and −0.05 quality (${a4.gear.weapon.quality})`);
  // Jams from fire(): a gun made to jam every time.
  const st5 = createWorld({ seed: seed + 4, factionCount: 4 });
  const a5 = fighter(st5, "pistol"), c5 = fighter(st5, "revolver");
  const b5 = openBattle(st5, [a5, c5], { kind: "raiders", count: 1, power: 3 });
  const p5 = by(b5, a5), q5 = by(b5, c5), e5 = foes(b5)[0];
  place(p5, 5, 5); place(q5, 5, 7); place(e5, 10, 6); toughen(e5);
  const realRel = { pistol: WEAPONS.pistol.rel, revolver: WEAPONS.revolver.rel };
  WEAPONS.pistol.rel = 1e6; WEAPONS.revolver.rel = 1e6; // capped at 12% a round: forced below by many tries
  let pj = false, rm = false;
  for (let i = 0; i < 200 && !(pj && rm); i++) {
    p5.jam = null; q5.jam = null; loadMag(p5); loadMag(q5);
    fire(b5, p5, e5); if (p5.jam) pj = true;
    fire(b5, q5, e5); if (q5.jam) check(false, "the revolver entered a jam state");
    if (logHas(b5, /misfires/)) rm = true;
  }
  WEAPONS.pistol.rel = realRel.pistol; WEAPONS.revolver.rel = realRel.revolver;
  check(pj && logHas(b5, /jams/), "fire() jams a pistol (logged)");
  check(rm && !q5.jam, "a revolver misfires instead (\"click\"), never jammed");
}

// 3. The AI clears jams: enemies, your side's AI, the raid bot.
{
  console.log("The AI clears its jams");
  const st = createWorld({ seed: seed + 5, factionCount: 4 });
  const a = fighter(st, "pistol");
  const b = openBattle(st, [a], { kind: "raiders", count: 1, power: 3 });
  const p = by(b, a), e = foes(b).find((x) => x.kind === "human");
  place(p, 5, 5); place(e, 12, 6); toughen(p);
  e.weapon = "pistol"; loadMag(e);
  jamGun(b, e, "stovepipe");
  combatAct(st, { type: "end" });
  runEnemyPhase(st);
  check(!e.jam && logHas(b, new RegExp(`${e.name} clears the stovepipe`)), "an enemy clears its stovepipe in its turn");
  jamGun(b, e, "double");
  b.phase = "player";
  combatAct(st, { type: "end" });
  runEnemyPhase(st);
  check(!e.jam && logHas(b, new RegExp(`${e.name} rips the magazine out`)), "and a double feed with a reload (1 action)");
  const st2 = createWorld({ seed: seed + 6, factionCount: 4 });
  const a2 = fighter(st2, "pistol"), c2 = fighter(st2, "pistol");
  const b2 = openBattle(st2, [a2, c2], { kind: "raiders", count: 1, power: 3 });
  const p2 = by(b2, a2), q2 = by(b2, c2), e2 = foes(b2)[0];
  place(p2, 5, 5); place(q2, 5, 7); place(e2, 11, 6); toughen(e2);
  jamGun(b2, p2, "stovepipe"); jamGun(b2, q2, "hard");
  autoPlayerTurn(st2, { retreat: false });
  check(!p2.jam && logHas(b2, new RegExp(`${p2.name} clears the stovepipe`)), "your side's AI clears a stovepipe (and goes on)");
  check(!q2.jam && logHas(b2, new RegExp(`${q2.name} clears the hard jam`)), "and a hard jam with both actions");
  // The raid bot.
  const st4 = createWorld({ seed: seed + 9, factionCount: 4 });
  const h4 = hub(st4);
  const team = [fighter(st4, "pistol"), fighter(st4, "pistol")];
  const tile = st4.tiles.find((t) => t.loc && t.id !== h4.tile && st4.grid.distance(t.id, h4.tile) > 1);
  const res = launchExpedition(st4, { memberIds: team.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 1 } });
  if (res.error) check(false, `raid team launched (${res.error})`);
  else {
    const pt = res.party;
    pt.path = [tile.id]; pt.idx = 0; pt.phase = "engaged";
    const rb = inBrowser(() => (st4.combat = createBattle(st4, { mode: "raid", tile: tile.id, partyId: pt.id, canRetreat: true, ambush: null, handler: "jamtest", enemy: { kind: "mixed", count: 1, power: 3, groups: raidEnemies(st4, tile.id) }, raid: { heat0: 5 }, context: {} })));
    if (rb.raid && rb.raid.choose) rb.raid.choose = null;
    const ru = rb.units.find((u) => u.side === "player");
    jamGun(rb, ru, "stovepipe");
    for (const u of rb.units) if (u.side !== "player") u.aware = false;
    autoPlayerTurn(st4);
    check(!ru.jam && logHas(rb, new RegExp(`${ru.name} clears the stovepipe`)), "the raid bot clears a jam");
  }
}

// 4. A save in the middle of a jam keeps it.
{
  console.log("Saves");
  const st = createWorld({ seed: seed + 10, factionCount: 4 });
  const a = fighter(st, "ar");
  const b = openBattle(st, [a], { kind: "raiders", count: 1, power: 3 });
  const p = by(b, a);
  jamGun(b, p, "double");
  p.jam.ap = 1;
  const st2 = loadFromString(saveToString(st));
  const p2 = st2.combat.units.find((u) => u.id === p.id);
  check(p2.jam && p2.jam.kind === "double" && p2.jam.ap === 1 && p2.mode === "burst" && JSON.stringify(p2.modes) === JSON.stringify(["single", "burst", "auto"]), "a saved battle keeps the jam (and the fire mode)");
  check(unjam(st2.combat, p2) && !p2.jam, "and it can be cleared after loading");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
