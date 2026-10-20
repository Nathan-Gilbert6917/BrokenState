// Soft cover (src/sim/softcover.js; the user's picks 2026-10-20): bushes and tents hide whoever is in them or right
// next to them, and stop no bullets.
// 1. A person in or next to a bush is harder to see (canSee: a share of the viewer's sight), to notice (noticeRange)
//    and to hit (shotOdds: −CONCEAL.*.aim, a line of the hit breakdown); sneaking there they are not seen at all; a loud
//    shot gives them away; a tent hides whoever is in it or behind it, not in front of it.
// 2. Bullets are not reduced: a bush and a tent are no cover (CELL cover 0), the shot's damage is the open ground's.
// 3. A tent can be slashed (an AI raider with nobody in sight; the dead walking through it) and burned (a Molotov:
//    the AI's, the flames burning it to rubble).
// 4. Tent damage persists on the base after the fight (base.plan.tentHp), the next fight and the view start from it,
//    save and load keep it, the campers mend it.
// 5. An AI shooter gets the same penalty and the same blindness at someone in a bush; an AI person in a bush gets the
//    same concealment from your shots, and its cell scoring counts it.
// Usage: node tools/softcovertest.js [seed]
import { createWorld, hub, atBase, makeSurvivor } from "../src/sim/world.js";
import {
  createBattle, registerCombatHandler, CELL, shotOdds, canSee, coverAgainst, reachable, sightRange, bestShot, foesOf, finishCombat,
} from "../src/sim/combat.js";
import { noticeRange, detectRange } from "../src/sim/stealth.js";
import { burnRound, FIRE } from "../src/sim/throwables.js";
import * as SOFT from "../src/sim/softcover.js";
import * as BM from "../src/sim/basemap.js";
import { newItem } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 11);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("soft", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.hour = 24 * 3 + 12; return st; };
const idx = (b, x, y) => y * b.w + x;
const place = (u, x, y) => { u.x = x; u.y = y; };
// An open battle map by day (every cell open ground), your people in the player phase.
function battle(st, { count = 2, kind = "raiders", fighters = 2 } = {}) {
  const h = hub(st);
  const ids = atBase(st, h.id).slice(0, fighters).map((s) => s.id);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: ids, enemy: { kind, count, power: 3, name: "Test" }, ambush: null, canRetreat: false, handler: "soft", context: {} });
  const b = st.combat;
  for (const c of b.cells) { c.k = "open"; delete c.h; delete c.t; delete c.hp; delete c.mhp; }
  b.lit = null; b.floodAim = null; b.flares = []; b.smoke = []; b.fires = []; b.night = false;
  b.losCache.fill(0); b.reach.fill(1);
  b.phase = "player";
  for (const u of b.units) { u.aware = true; u.surprised = false; u.sneaking = false; u.hunker = false; place(u, 0, b.h - 1 - b.units.indexOf(u)); }
  b.soft = undefined;
  return b;
}
const put = (b, x, y, k) => { b.cells[idx(b, x, y)].k = k; b.soft = undefined; b.losCache.fill(0); };
const so = (b, a, t) => shotOdds(b, a, t, a.x, a.y, { parts: true }); // with the breakdown: .aim before the clamp
const hasPart = (o, re) => (o.parts || []).some(([l]) => re.test(l));

// ---------- 1. Hidden in and by the bushes ----------
section("Bushes hide whoever stands in or next to them");
{
  const st = world();
  const b = battle(st);
  const [u] = b.units.filter((x) => x.side === "player");
  const [e] = b.units.filter((x) => x.side === "enemy");
  check(CELL.bush.walk && CELL.bush.cover === 0 && !CELL.bush.los && CELL.tent.walk && CELL.tent.cover === 0 && !CELL.tent.los, "a bush and a tent: walked into, no cover, sight passes");
  const sr = sightRange(b, u);
  const far = Math.floor(sr * SOFT.CONCEAL.IN.see) + 2, close = Math.max(2, Math.floor(sr * SOFT.CONCEAL.IN.see) - 1);
  place(u, 5, 10);
  place(e, 5 + far, 10);
  const open = so(b, u, e, u.x, u.y, { parts: true });
  check(canSee(b, u, e), `in the open the raider is seen at ${far} tiles (sight ${sr})`);
  put(b, 5 + far, 10, "bush");
  const inB = so(b, u, e, u.x, u.y, { parts: true });
  check(!canSee(b, u, e), `standing in a bush they are not seen at ${far} tiles (within ${Math.round(sr * SOFT.CONCEAL.IN.see * 10) / 10} only)`);
  place(e, 5 + close, 10); put(b, 5 + far, 10, "open"); put(b, 5 + close, 10, "bush");
  check(canSee(b, u, e), `seen in the bush at ${close} tiles`);
  check(inB.aim === open.aim - SOFT.CONCEAL.IN.aim && inB.conceal === "in the bushes" && hasPart(inB, /concealed \(in the bushes\)/), `a shot at someone in a bush: −${SOFT.CONCEAL.IN.aim} aim (${Math.round(open.aim)} → ${Math.round(inB.aim)}), a line of the breakdown, "${inB.conceal}"`);
  check(inB.notes.some((n) => /concealed in the bushes/.test(n)), `the odds line says why (${inB.notes.join("; ")})`);
  // Next to a bush (any side): a smaller penalty, seen a bit further.
  put(b, 5 + close, 10, "open");
  place(e, 5 + far, 10); put(b, 5 + far + 1, 10, "bush"); // the bush behind them
  const next = so(b, u, e, u.x, u.y);
  check(next.aim === open.aim - SOFT.CONCEAL.NEXT.aim && next.conceal === "beside the bushes", `right next to a bush (even behind them): −${SOFT.CONCEAL.NEXT.aim} (${Math.round(next.aim)})`);
  check(canSee(b, u, e) === (far <= sr * SOFT.CONCEAL.NEXT.see), `beside a bush seen within ${Math.round(sr * SOFT.CONCEAL.NEXT.see * 10) / 10} tiles (${far} off: ${canSee(b, u, e) ? "seen" : "not seen"})`);
  // Up close they are seen clearly: no penalty from a tile away.
  put(b, 5 + far + 1, 10, "open"); put(b, 6, 10, "bush"); place(e, 6, 10);
  const adj = so(b, u, e, u.x, u.y);
  check(canSee(b, u, e) && !adj.conceal, "from right next to them: seen clearly, no penalty");
  // Sneaking in a bush: not seen at all from further than a tile.
  put(b, 6, 10, "open"); put(b, 5 + close, 10, "bush"); place(e, 5 + close, 10);
  e.sneaking = true;
  check(!canSee(b, u, e), `sneaking in a bush: not seen even at ${close} tiles`);
  e.sneaking = false;
  // A loud shot gives them away (this turn and the next); the aim penalty stays.
  place(e, 5 + far, 10); put(b, 5 + close, 10, "open"); put(b, 5 + far, 10, "bush");
  check(!canSee(b, u, e), "hidden again in the far bush");
  SOFT.markShot(b, e);
  check(canSee(b, u, e) && so(b, u, e).conceal === "in the bushes", "after a loud shot the shooter in the bush is seen (the leaves still cost the aim)");
  b.turn += 2;
  check(!canSee(b, u, e), "two turns on, hidden again");
  // At night a light switched on shows them.
  b.night = true; e.light = "flashlight"; e.lightOff = false;
  check(SOFT.revealed(b, e), "a light switched on at night gives them away");
  b.night = false; delete e.light;
  // Walking in costs a little more.
  put(b, 5 + far, 10, "open");
  place(u, 2, 2); put(b, 3, 2, "bush");
  const r = reachable(b, u, 10);
  check(Math.abs(r.dist[idx(b, 3, 2)] - (1 + SOFT.CONCEAL.MOVE)) < 1e-6 && Math.abs(r.dist[idx(b, 4, 2)] - (2 + SOFT.CONCEAL.MOVE)) < 1e-6, `a step into a bush costs ${1 + SOFT.CONCEAL.MOVE} tiles; through it beats round it (${r.dist[idx(b, 3, 2)]}, ${r.dist[idx(b, 4, 2)]})`);
}

section("Noticed later by the unaware, the dead too");
{
  const st = world();
  const b = battle(st, { kind: "zombies" });
  const [u] = b.units.filter((x) => x.side === "player");
  const z = b.units.find((x) => x.side === "enemy");
  place(u, 10, 10); place(z, 14, 10); z.aware = false;
  u.stealth = 0;
  const openR = noticeRange(b, z, u);
  put(b, 10, 10, "bush");
  const inR = noticeRange(b, z, u);
  check(inR < openR && inR === Math.max(1, Math.round(openR * SOFT.CONCEAL.IN.notice)), `one of the dead notices someone in a bush at ${inR} tiles, not ${openR}`);
  u.sneaking = true;
  check(detectRange(b, z, u) === 0, "sneaking in the bush: not seen, not heard (as behind cover)");
  u.sneaking = false;
  put(b, 10, 10, "open"); put(b, 10, 11, "bush");
  check(noticeRange(b, z, u) === Math.max(1, Math.round(openR * SOFT.CONCEAL.NEXT.notice)), "beside a bush: × NEXT");
  const b2 = battle(world(seed + 1));
  const [p] = b2.units.filter((x) => x.side === "player");
  const g = b2.units.find((x) => x.side === "enemy");
  place(p, 10, 10); place(g, 15, 10); g.aware = false; g.face = [-1, 0];
  const r0 = noticeRange(b2, g, p);
  put(b2, 10, 10, "bush");
  check(noticeRange(b2, g, p) < r0, `an unaware raider notices them later too (${noticeRange(b2, g, p)} < ${r0})`);
}

section("A tent hides whoever is in it or behind it");
{
  const st = world();
  const b = battle(st);
  const [u] = b.units.filter((x) => x.side === "player");
  const [e] = b.units.filter((x) => x.side === "enemy");
  place(u, 4, 10); place(e, 12, 10);
  const open = so(b, u, e);
  put(b, 12, 10, "tent"); put(b, 13, 10, "tent");
  check(so(b, u, e).aim === open.aim - SOFT.CONCEAL.IN.aim && so(b, u, e).conceal === "in a tent", "inside a tent: as in a bush");
  put(b, 12, 10, "open"); put(b, 13, 10, "open");
  put(b, 11, 10, "tent"); put(b, 11, 9, "tent"); // the tent between them
  check(so(b, u, e).aim === open.aim - SOFT.CONCEAL.NEXT.aim && so(b, u, e).conceal === "behind a tent", "behind a tent (the tent between them): −" + SOFT.CONCEAL.NEXT.aim);
  put(b, 11, 10, "open"); put(b, 11, 9, "open");
  put(b, 13, 10, "tent"); put(b, 13, 9, "tent"); // the tent on their far side
  check(so(b, u, e).aim === open.aim && !so(b, u, e).conceal, "in front of a tent (it behind them): nothing");
}

// ---------- 2. No protection ----------
section("Bullets are not reduced by bushes or tents");
{
  const st = world();
  const b = battle(st);
  const [u] = b.units.filter((x) => x.side === "player");
  const [e] = b.units.filter((x) => x.side === "enemy");
  place(u, 4, 10); place(e, 9, 10);
  const open = so(b, u, e);
  for (const k of ["bush", "tent"]) {
    put(b, 9, 10, k); put(b, 8, 10, k); put(b, 9, 9, k);
    const o = so(b, u, e);
    check(o.cover === 0 && coverAgainst(b, 9, 10, 4, 10).level === 0 && o.dmg[0] === open.dmg[0] && o.dmg[1] === open.dmg[1] && o.crit === open.crit, `${k}: no cover, the same damage (${o.dmg.join("–")}) and crit chance (${o.crit}%) as in the open`);
    put(b, 9, 10, "open"); put(b, 8, 10, "open"); put(b, 9, 9, "open");
  }
  // A sure shot (the aim far past 95 either way): the same chance, damage and crit in the open, in a bush, in a tent;
  // only the leaves' aim (concealment) ever differs, never what a hit does.
  u.aim = 400;
  const sure = [so(b, u, e)];
  put(b, 9, 10, "bush"); sure.push(so(b, u, e));
  put(b, 9, 10, "tent"); sure.push(so(b, u, e));
  put(b, 9, 10, "open");
  check(sure.every((o) => o.chance === 95 && o.cover === 0 && o.dmg.join() === sure[0].dmg.join() && o.crit === sure[0].crit), `a sure shot: ${sure.map((o) => `${o.chance}% ${o.dmg.join("–")}`).join(", ")} (open, bush, tent)`);
}

// ---------- 5. AI parity ----------
section("The AI: the same penalty and the same blindness");
{
  const st = world();
  const b = battle(st);
  const [u, w] = b.units.filter((x) => x.side === "player");
  const [e] = b.units.filter((x) => x.side === "enemy");
  const sr = sightRange(b, e);
  const far = Math.floor(sr * SOFT.CONCEAL.IN.see) + 2;
  place(e, 5, 10); place(u, 5 + 6, 12); place(w, 5 + far, 10);
  const open = so(b, e, u);
  put(b, u.x, u.y, "bush");
  check(so(b, e, u).aim === open.aim - SOFT.CONCEAL.IN.aim, `a raider shooting at your person in a bush: the same −${SOFT.CONCEAL.IN.aim}`);
  put(b, w.x, w.y, "bush");
  check(!canSee(b, e, w), `the raider does not see the one in the far bush (${far} tiles)`);
  const pick = bestShot(b, e, foesOf(b, e));
  check(!!pick && pick.t === u, "its best shot is never at someone it cannot make out");
  // Your shot at a raider in a bush: the same rule (one table both ways).
  put(b, u.x, u.y, "open");
  const mine = so(b, u, e);
  put(b, e.x, e.y, "bush");
  check(so(b, u, e).aim === mine.aim - SOFT.CONCEAL.IN.aim, "and your shot at a raider in a bush loses the same");
  check(SOFT.concealScore(b, e.x, e.y, u.x, u.y) > 0 && SOFT.concealScore(b, e.x + 3, e.y + 3, u.x, u.y) === 0, "the AI's cell scoring counts a concealed spot (scoreCell)");
}

// ---------- 3. Slash and burn ----------
section("A tent is slashed and burned");
{
  const st = world();
  const b = battle(st);
  const [u, w] = b.units.filter((x) => x.side === "player");
  const [e, e2] = b.units.filter((x) => x.side === "enemy");
  put(b, 20, 10, "tent"); put(b, 21, 10, "tent");
  place(u, 1, 1); place(w, 1, 3); // far off, out of their sight
  for (let x = 0; x < 6; x++) put(b, x + 3, 0, "wall"), put(b, x + 3, 1, "wall"), put(b, x + 3, 2, "wall"), put(b, x + 3, 3, "wall"), put(b, 4, x, "wall");
  for (let y = 0; y < 8; y++) put(b, 4, y, "wall");
  b.holders = "player";
  place(e, 19, 10); e.ap = 2; delete e.throwables;
  check(!foesOf(b, e).some((f) => canSee(b, e, f)), "the raider sees none of the defenders");
  const keep = { ...SOFT.TENT_FIGHT };
  SOFT.TENT_FIGHT.AI_SLASH = 1; SOFT.TENT_FIGHT.AI_BURN = 1;
  const c = b.cells[idx(b, 20, 10)];
  check(SOFT.tentAI(b, e) && e.ap === 1 && c.hp < SOFT.TENT_FIGHT.HP && c.mhp === SOFT.TENT_FIGHT.HP, `a raider with nobody in sight slashes the tent next to them: one action (${c.hp}/${c.mhp})`);
  check(!SOFT.tentAI(b, e), "once a turn");
  for (let t = 0; t < 6 && c.k === "tent"; t++) { b.turn++; e.ap = 2; SOFT.tentAI(b, e); }
  check(c.k === "torn" && c.hp === 0 && CELL.torn.walk && CELL.torn.cover === 0, `slashed to nothing it is a torn tent (${c.k})`);
  check(SOFT.concealAt(b, 20, 10).level === 1, "a torn cell hides nobody in it (its other half, next to it, still does)");
  // In sight of a defender: no slashing.
  b.turn++; e.ap = 2; place(w, 16, 10);
  check(!SOFT.tentAI(b, e), "a defender in sight: the raider fights instead");
  place(w, 1, 3);
  // The dead tear a tent they walk through.
  const z = { ...e2, kind: "zombie", name: "a walker", id: 999 };
  const d = b.cells[idx(b, 21, 10)];
  const before = d.hp ?? SOFT.TENT_FIGHT.HP;
  SOFT.tentStep(b, z, 21, 10);
  check(d.hp < before, `one of the dead walking through tears it (${before} → ${d.hp})`);
  // A Molotov onto a tent (the AI's: u.throwables), the flames burn it to rubble.
  put(b, 10, 16, "tent"); put(b, 11, 16, "tent");
  place(e2, 10, 12); e2.ap = 2; e2.throwables = { molotov: 1 }; b.enemyThrowTurn = null;
  b.turn++;
  check(SOFT.tentAI(b, e2) && e2.throwables.molotov === 0 && e2.ap === 0, "a raider with a Molotov and nobody in sight throws it at a tent (its whole turn)");
  const burning = (b.fires || []).filter((f) => (f.x === 10 || f.x === 11) && f.y === 16).length;
  check(burning >= 1, `the tent catches (${burning} of its cells burning; tent fuel ${FIRE.fuel.tent})`);
  for (let i = 0; i < 8; i++) { b.rng.state = 77 + i; burnRound(b); }
  check(b.cells[idx(b, 10, 16)].k === "rubble" || b.cells[idx(b, 11, 16)].k === "rubble", `it burns down to rubble (${b.cells[idx(b, 10, 16)].k}, ${b.cells[idx(b, 11, 16)].k})`);
  Object.assign(SOFT.TENT_FIGHT, keep);
}

// ---------- 4. The wear stays with the camp ----------
section("Tent damage persists on the base after the fight");
{
  const st = world(seed + 5);
  const h0 = hub(st);
  const tiles = Object.keys(st.tiles).map(Number).filter((t) => st.tiles[t].terrain !== "water" && !st.tiles[t].bridge && !st.bases.some((x) => x.tile === t));
  const camp = { id: 9000 + st.bases.length, tile: tiles.sort((a, c) => a - c)[0] ?? st.grid.neighbors(h0.tile)[0], type: "outpost", name: "Test Camp", stock: { water: 0, fuel: 0, meds: 0, ammo: 0, arrows: 0, parts: 0, scrap: 0, jars: 0, wood: 0, buildmat: 0, rawwater: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [], tier: 0, camp: true, fire: true };
  st.bases.push(camp);
  for (let i = 0; i < 3; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: camp.id }; s.health = 100; s.gear.weapon = newItem("pistol"); st.survivors.push(s); }
  const raid = () => {
    globalThis.window = {};
    try { st.combat = createBattle(st, { tile: camp.tile, baseId: camp.id, enemy: { kind: "raiders", count: 4, power: 3, name: "raiders" }, ambush: null, canRetreat: true, handler: "soft", layout: "baseDefence", deploy: true, context: { night: false, ready: { manned: true } } }); }
    finally { delete globalThis.window; }
    return st.combat;
  };
  const n = BM.tentCount(camp);
  let b = raid();
  const tagged = b.cells.filter((c) => c.tent);
  check(b.soft && tagged.length === 2 * n && tagged.every((c) => c.k === "tent" && c.hp === SOFT.TENT_FIGHT.HP), `a raid on the camp: its ${n} tents tagged with their map items, ${SOFT.TENT_FIGHT.HP} hp a cell (${tagged.length} cells)`);
  const keys = [...new Set(tagged.map((c) => c.tent))].sort();
  // Tent 1 slashed open, tent 2 burned, tent 3 slashed a little.
  const of = (k) => b.cells.filter((c) => c.tent === k);
  for (const c of of(keys[0])) SOFT.tearTent(b, c);
  for (const c of of(keys[1])) { c.k = "rubble"; c.hp = 0; }
  of(keys[2])[0].hp = SOFT.TENT_FIGHT.HP / 2;
  b.phase = "player";
  finishCombat(st, b.setup, { outcome: "win", enemiesKilled: 0, worn: true });
  const P = camp.plan || {};
  const i = (k) => k.slice(2);
  check(P.tentHp && P.tentHp[i(keys[0])] === 0 && P.tentHp[i(keys[1])] === 0 && P.tentHp[i(keys[2])] === 75, `kept on the camp's record after the fight (plan.tentHp ${JSON.stringify(P.tentHp)})`);
  check(st.log.some((l) => /burned in the fight/.test(l.text)) && st.log.some((l) => /slashed/.test(l.text)), "the log says which were slashed and which burned");
  // Save and load keep it; the next fight starts from it.
  const st2 = loadFromString(saveToString(st));
  check(JSON.stringify(st2.bases.find((x) => x.id === camp.id).plan.tentHp) === JSON.stringify(P.tentHp), "save and load keep it");
  b = raid();
  const torn = b.cells.filter((c) => c.tent === keys[0] || c.tent === keys[1]);
  const worn = b.cells.filter((c) => c.tent === keys[2]);
  check(torn.length === 4 && torn.every((c) => c.k === "torn" && c.hp === 0), "the next fight: the wrecked tents lie torn (they hide nobody)");
  check(worn.length === 2 && worn.every((c) => c.k === "tent" && c.hp === Math.round(SOFT.TENT_FIGHT.HP * 0.75)), `the worn one starts at 75% (${worn.map((c) => c.hp).join(", ")})`);
  st.combat = null;
  // The Base map view shows them as they are.
  BM.openBaseMap(st, camp.id);
  check(st.combat.cells.filter((c) => c.k === "torn").length === 4, "the Base map view shows the torn tents");
  st.combat = null;
  // The campers mend them a day at a time.
  SOFT.mendTents(st);
  check(P.tentHp[i(keys[0])] === SOFT.TENT_FIGHT.MEND && P.tentHp[i(keys[2])] === undefined, `a day's mending: +${SOFT.TENT_FIGHT.MEND}, the one at 75% whole again (${JSON.stringify(P.tentHp)})`);
  for (let d = 0; d < 4; d++) SOFT.mendTents(st);
  check(!P.tentHp, "mended whole in a few days: the record forgets them");
  // A fight with no wear leaves the record alone.
  b = raid();
  check(b.cells.filter((c) => c.tent).every((c) => c.k === "tent" && c.hp === SOFT.TENT_FIGHT.HP), "pitched again: the next fight's tents are whole");
  b.phase = "player";
  finishCombat(st, b.setup, { outcome: "win", enemiesKilled: 0, worn: true });
  check(!camp.plan.tentHp, "an untouched fight records nothing");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
