// The new special dead (src/sim/middead.js, sleepers.js; hiveconst.js MIDDEAD, SLEEPER, HORDEMIX, AMBIENT, GROWTHS
// ossuary / scaffold / wormpit / cistern / hollow) and where the special dead come from (hivetech.js hiveMix,
// mixOdds, assaultTypes, siteSpecials; zombietypes.js ambientMix, siteList).
// Checks:
//   - the five mid-game growths are tier 2 and each breeds its kind
//   - a hive's new hordes bring each kind it breeds at odds by the horde's size, its tier and a brood chamber, no more
//     kinds than the size allows; a guard brings nearly all; the odds hold over many hordes
//   - a hive fights its assault with at least one of every kind it breeds, never more than 60% special
//   - the special dead met exploring: none at the start, more every year, cities > towns > the countryside; on a
//     hive's land more, on the red-skull ring the kinds that hive breeds; raids and fights on the road meet them
//   - Boneback: a hit from the front does 30%, from the side or behind all of it; hit, it turns on its attacker
//   - Climber: over fences and a base's wall, never stopping on one, up onto the walkway without a ladder; at the walls
//     some get over a held horde, fewer with a watchtower and manned defences
//   - Flinger: winds up, then throws a worm swarm next to its mark; a hard hit while it winds up drops it at its feet;
//     a cooldown and a limit a battle
//   - Sower: the battle's infection rises while one stands; on the State Map the land it crosses gets Infection
//   - Nightmare: its scream raises the Heat and panics the faint-hearted, who run for the way out; the brave hold
//   - Sleepers: bodies lie about fights and raids, none near your people's start, the same map the same bodies; one
//     splits open next to the living (a swarm and a bite), not next to the dead; spotted it is a unit that can be
//     shot (it splits where it lies) and does not hold the field; fire cooks it
//   - whole battles and raids with all of them play out
// Usage: node tools/specialtest.js
import { createWorld, hub, atBase } from "../src/sim/world.js";
import {
  createBattle, enemyUnit, damage, endPlayerTurn, runEnemyPhase, autoPlayerTurn, registerCombatHandler, active, reachable, closeCombat, autoResolveCombat, hitMult, los,
} from "../src/sim/combat.js";
import { applyZType, ambientMix, siteList, zombieTurn } from "../src/sim/zombietypes.js";
import { MIDDEAD, SLEEPER, HORDEMIX, AMBIENT, ZTYPES, GROWTHS, TECH } from "../src/sim/hiveconst.js";
import { startGrowth, hiveMix, mixOdds, siteSpecials, hiveTier } from "../src/sim/hivetech.js";
import { hiveForce, zombieToughness } from "../src/sim/hives.js";
import { makeHorde } from "../src/sim/hordes.js";
import { raidEnemies } from "../src/sim/scavenge.js";
import { sowerRound, sowTile, terrorRuns, climberSlip, flingerTurn, nightmareTurn } from "../src/sim/middead.js";
import { placeBodies, wakeNear, spotCheck, burnBodies } from "../src/sim/sleepers.js";
import { ignite } from "../src/sim/throwables.js";
import { launchExpedition } from "../src/sim/parties.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
registerCombatHandler("specialtest", () => {});
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };
const pct = (v) => `${Math.round(v * 100)}%`;
const MID = { ossuary: "boneback", scaffold: "climber", wormpit: "flinger", cistern: "sower", hollow: "nightmare" };

// A battle on open ground (every cell open, no bodies), your 3 people and the given dead, all parked on the top row.
function arena(seed = 7, types = {}, count = 3) {
  const st = createWorld({ seed, factionCount: 4 });
  const h = hub(st);
  const people = atBase(st, h.id).slice(0, 3);
  const b = inBrowser(() => createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind: "zombies", count, power: 3, types }, ambush: null, canRetreat: true, handler: "specialtest", context: {} }));
  st.combat = b;
  for (let i = 0; i < b.cells.length; i++) b.cells[i] = { k: "open", f: "grass" };
  b.losCache.fill(0);
  b.evacCols = 0;
  b.infection = 0;
  b.corpses = [];
  b.units.forEach((u, i) => { u.x = 1 + i * 2; u.y = 0; u.aware = false; });
  const ps = b.units.filter((u) => u.side === "player");
  return { st, b, ps };
}
const at = (u, x, y) => { u.x = x; u.y = y; };
const swarmsOf = (b) => b.units.filter((u) => u.ztype === "swarm" && !u.dead);
// A world with one hive of the given tier's growths grown.
function hiveWorld(seed, growths, day = 700) {
  const st = createWorld({ seed, factionCount: 8 });
  st.started = true;
  st.hour = day * 24;
  const hv = st.hives[0];
  hv.born = 0;
  for (const k of growths) { hv.res = 80; const g = startGrowth(st, hv, k); if (g) g.ready = st.hour; }
  return { st, hv };
}

section("The mid game's growths");
{
  for (const [g, k] of Object.entries(MID)) check(GROWTHS[g] && GROWTHS[g].tier === 2 && GROWTHS[g].unlocks === k && ZTYPES[k] && ZTYPES[k].share > 0, `${GROWTHS[g].name}: tier ${GROWTHS[g].tier}, breeds ${ZTYPES[k].name}s (${pct(ZTYPES[k].share)} of a horde when they come)`);
  check(ZTYPES.sleeper && ZTYPES.sleeper.share === 0 && !Object.values(GROWTHS).some((G) => G.unlocks === "sleeper"), "no hive breeds Sleepers: they lie among the bodies");
}

section("A hive's new hordes: odds by size, tier and brood");
{
  const { st, hv } = hiveWorld(11, ["warren", "ossuary", "scaffold"]);
  const t = hiveTier(st, hv);
  const sm = mixOdds(st, hv, "small"), md = mixOdds(st, hv, "medium"), lg = mixOdds(st, hv, "large"), gd = mixOdds(st, hv, "guard");
  check(sm.kinds.climber < md.kinds.climber && md.kinds.climber < lg.kinds.climber && lg.kinds.climber <= gd.kinds.climber,
    `the odds of Climbers grow with the horde (tier ${t}): small ${pct(sm.kinds.climber)}, medium ${pct(md.kinds.climber)}, large ${pct(lg.kinds.climber)}, guard ${pct(gd.kinds.climber)}`);
  check(lg.kinds.runner > lg.kinds.climber, `runners (tier 1) are likelier than Climbers (tier 2) in a tier-${t} hive's hordes: ${pct(lg.kinds.runner)} against ${pct(lg.kinds.climber)}`);
  check(sm.most === HORDEMIX.KINDS.small + (t >= 3 ? 1 : 0) + (t >= 4 ? 1 : 0) && lg.most > sm.most, `a small horde brings at most ${sm.most} kinds, a large one ${lg.most}`);
  hv.res = 80; const br = startGrowth(st, hv, "brood"); br.ready = st.hour;
  check(Math.abs(mixOdds(st, hv, "medium").kinds.climber - md.kinds.climber - HORDEMIX.BROOD) < 1e-9, `a brood chamber: +${pct(HORDEMIX.BROOD)}`);
  // Over many hordes.
  const counts = { small: {}, large: {} };
  const N = 400;
  const h0 = st.hour;
  let tooMany = 0;
  for (const size of ["small", "large"]) for (let i = 0; i < N; i++) {
    st.hour = h0 + i;
    const m = hiveMix(st, hv, size).mix || {};
    for (const k in m) counts[size][k] = (counts[size][k] || 0) + 1;
    if (Object.keys(m).length > mixOdds(st, hv, size).most) tooMany++;
  }
  st.hour = h0;
  const o = mixOdds(st, hv, "large");
  const seen = counts.large.climber / N;
  check(Math.abs(seen - Math.min(o.kinds.climber, 1)) < 0.12, `over ${N} large hordes Climbers came in ${pct(seen)} (odds ${pct(o.kinds.climber)})`);
  check((counts.small.climber || 0) < counts.large.climber, `fewer small hordes bring them (${counts.small.climber || 0} of ${N} against ${counts.large.climber})`);
  check(tooMany === 0, "never more kinds than the size allows");
}

section("A hive's assault: at least one of every kind it breeds");
{
  const { st, hv } = hiveWorld(12, ["warren", "brutepit", "sac", "ossuary", "scaffold", "wormpit", "cistern", "hollow"], 900);
  for (const h of [...st.hordes]) if (h.hive === hv.id && h.role === "guard") st.hordes.splice(st.hordes.indexOf(h), 1);
  makeHorde(st, { tile: hv.tile, size: 120, role: "guard", hive: hv.id, target: hv.tile, mix: { runner: 0.1 } });
  const f = hiveForce(st, hv);
  const kinds = ["runner", "brute", "spitter", "boneback", "climber", "flinger", "sower", "nightmare"];
  const n = Object.values(f.types || {}).reduce((a, v) => a + v, 0);
  check(kinds.every((k) => (f.types[k] || 0) >= 1), `the brood (${f.count}) has every kind it breeds: ${Object.entries(f.types).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  check(n <= Math.ceil(f.count * HORDEMIX.ASSAULT_SHARE), `${n} special dead of ${f.count}: at most ${pct(HORDEMIX.ASSAULT_SHARE)}`);
}

section("The special dead met exploring");
{
  const st = createWorld({ seed: 21, factionCount: 6 });
  const far = (t) => zombieToughness(st, t.id) === 0;
  const city = st.tiles.find((t) => t.loc && ["city", "office", "pharmacy", "apartments", "hospital"].includes(t.loc.type) && far(t));
  const town = st.tiles.find((t) => t.loc && ["town", "grocery", "diner", "church", "motel"].includes(t.loc.type) && far(t));
  const farm = st.tiles.find((t) => t.loc && ["farm", "barn", "ranch"].includes(t.loc.type) && far(t));
  const share = (m) => Object.values(m || {}).reduce((a, v) => a + v, 0);
  st.hour = 0;
  check(share(siteSpecials(st, city.id)) === 0, `day 1: none in a city (${pct(share(siteSpecials(st, city.id)))})`);
  st.hour = 112 * 6 * 24;
  const c6 = share(siteSpecials(st, city.id)), t6 = share(siteSpecials(st, town.id)), f6 = share(siteSpecials(st, farm.id));
  check(c6 > t6 && t6 > f6 && f6 > 0, `year 6: a city ${pct(c6)}, a town ${pct(t6)}, a farm ${pct(f6)}`);
  const kinds6 = Object.keys(siteSpecials(st, city.id));
  check(kinds6.includes("boneback") && kinds6.includes("runner") && !kinds6.includes("shepherd"), `of the era's kinds: ${kinds6.join(", ")}`);
  st.hour = 112 * 2 * 24;
  check(share(siteSpecials(st, city.id)) < c6, `fewer in year 2 (${pct(share(siteSpecials(st, city.id)))})`);
  st.hour = 112 * 30 * 24;
  check(share(siteSpecials(st, city.id)) <= AMBIENT.MAX.city + 0.005, `never past ${pct(AMBIENT.MAX.city)} in a city (year 30: ${pct(share(siteSpecials(st, city.id)))})`);
  // The red skull.
  st.hour = 112 * 3 * 24;
  const hv = st.hives[0];
  hv.res = 80; const g = startGrowth(st, hv, "scaffold"); if (g) g.ready = st.hour;
  const ring = st.grid.neighbors(hv.tile).find((id) => zombieToughness(st, id) >= 3);
  const rm = siteSpecials(st, ring);
  check(!!rm && rm.climber >= AMBIENT.RED * 0.5 && share(rm) <= AMBIENT.CAP + 1e-9, `on the red-skull ring by a hive with a sinew scaffold: Climbers ${pct(rm.climber || 0)} (all ${pct(share(rm))})`);
  const terr = st.grid.within(hv.tile, 4).find((id) => zombieToughness(st, id) === 1);
  check(share(siteSpecials(st, terr)) > share(siteSpecials(st, farm.id)), `on its land more than in the countryside (${pct(share(siteSpecials(st, terr)))})`);
  // In a raid.
  st.hour = 112 * 6 * 24;
  const g6 = raidEnemies(st, city.id).find((x) => x.kind === "zombies");
  check(!!g6 && share(g6.mix) > 0, `a city raid's dead carry them (${Object.entries(g6.mix).map(([k, v]) => `${k} ${pct(v)}`).join(", ")})`);
  let made = 0, tot = 0;
  const rng = st.rng;
  for (let i = 0; i < 200; i++) { const l = siteList(rng, g6.mix, 10); made += l.filter(Boolean).length; tot += 10; }
  check(Math.abs(made / tot - share(g6.mix)) < 0.05, `rolled one by one: ${pct(made / tot)} of the dead are special`);
  check(ambientMix({ terrain: "plains" }, { years: 0, era: 0, toughness: 0 }) === null, "nothing in year 0 away from a hive");
}

section("Boneback: plates in front");
{
  const { b, ps } = arena(7, { boneback: 1 }, 1);
  const bb = b.units.find((u) => u.ztype === "boneback");
  at(bb, 10, 10); bb.face = [-1, 0]; bb.aware = true;
  at(ps[0], 6, 10); at(ps[1], 10, 14);
  const front = hitMult(bb, ps[0], { how: "shot" }), side = hitMult(bb, ps[1], { how: "shot" });
  check(Math.abs(front - MIDDEAD.BONEBACK.FRONT) < 1e-9 && side === 1, `a shot from the front ×${front}, from the side ×${side}`);
  check(hitMult(bb, ps[0], { how: "fire" }) === 1 && hitMult(bb, ps[0], { how: "blast" }) === MIDDEAD.BONEBACK.BLAST, "fire gets round the plates, a blast does 70%");
  const hp = bb.hp;
  damage(b, bb, 10, ps[1], false, { how: "shot" });
  check(hp - bb.hp === 10 && bb.face[0] === 0 && bb.face[1] === 1, `hit from the side for 10: it turns to face its attacker (facing ${bb.face})`);
  check(hitMult(bb, ps[0], { how: "shot" }) === 1, "now the first shooter has its flank");
}

section("Climber: over walls and fences");
{
  const { b } = arena(8, { climber: 1 }, 2);
  const cl = b.units.find((u) => u.ztype === "climber"), z = b.units.find((u) => u.kind === "zombie" && !u.ztype);
  for (let y = 0; y < b.h; y++) b.cells[y * b.w + 12] = { k: "fence", f: "grass" };
  b.losCache.fill(0);
  at(cl, 10, 8); at(z, 10, 10);
  const rc = reachable(b, cl, 6), rz = reachable(b, z, 6);
  check(isFinite(rc.dist[8 * b.w + 13]) && !isFinite(rz.dist[10 * b.w + 13]), "a Climber gets to the far side of a fence line; an ordinary one cannot");
  check(!isFinite(rc.dist[8 * b.w + 12]), "it never stops on the fence");
  // A wall section with the walkway behind it.
  for (let y = 0; y < b.h; y++) { b.cells[y * b.w + 12] = { k: "palisade", f: "grass", hp: 60, mhp: 60 }; b.cells[y * b.w + 13] = { k: "walkway", f: "grass" }; }
  b.losCache.fill(0);
  const r2 = reachable(b, cl, 10);
  check(isFinite(r2.dist[8 * b.w + 13]) && isFinite(r2.dist[8 * b.w + 14]), "over a base's wall onto the walkway (no ladder) and down the other side");
  const h = { size: 100, mix: { climber: 0.1 } };
  const s0 = climberSlip(h, false, false), s1 = climberSlip(h, true, false), s2 = climberSlip(h, true, true);
  check(s0 > s1 && s1 > s2 && s0 === Math.round(100 * 0.1 * MIDDEAD.CLIMBER.SLIP), `at a held wall ${s0} of 10 Climbers get over, ${s1} with a watchtower, ${s2} with the defences manned too`);
}

section("Flinger: wind-up, throw, drop");
{
  const { b, ps } = arena(9, { flinger: 1 }, 1);
  const fl = b.units.find((u) => u.ztype === "flinger");
  at(fl, 12, 10); fl.aware = true; fl.ap = 2;
  at(ps[0], 7, 10); at(ps[1], 1, 20); at(ps[2], 2, 20);
  check(zombieTurn(b, fl) && fl.windup === ps[0].id && !swarmsOf(b).length, "it sees someone within 7 tiles and winds up (nothing thrown yet)");
  fl.ap = 2;
  zombieTurn(b, fl);
  const w = swarmsOf(b)[0];
  check(!!w && Math.max(Math.abs(w.x - ps[0].x), Math.abs(w.y - ps[0].y)) <= 1 && fl.windup == null && fl.cd === MIDDEAD.FLINGER.COOLDOWN, `next turn it throws: a worm swarm lands next to ${ps[0].name.split(" ")[0]} (cooldown ${fl.cd})`);
  fl.ap = 2;
  zombieTurn(b, fl);
  check(fl.windup == null && swarmsOf(b).length === 1, "during the cooldown it does not wind up again");
  fl.cd = 0; fl.ap = 2;
  zombieTurn(b, fl);
  check(fl.windup != null, "ready again: it winds up");
  damage(b, fl, MIDDEAD.FLINGER.DROP, ps[1], false, { how: "shot" });
  const drop = swarmsOf(b).find((x) => x !== w);
  check(fl.windup == null && !!drop && Math.max(Math.abs(drop.x - fl.x), Math.abs(drop.y - fl.y)) <= 1, `hit for ${MIDDEAD.FLINGER.DROP} while winding up: it drops the mass at its own feet`);
  fl.throws = MIDDEAD.FLINGER.THROWS; fl.cd = 0; fl.ap = 2;
  zombieTurn(b, fl);
  check(fl.windup == null, `after ${MIDDEAD.FLINGER.THROWS} throws it has no more`);
}

section("Sower: eggs in battle and on the State Map");
{
  const { b } = arena(10, { sower: 2 }, 3);
  for (const u of b.units) if (u.ztype === "sower") u.aware = true;
  b.infection = 0.1;
  b.reinfMax = 0;
  sowerRound(b);
  check(Math.abs(b.infection - (0.1 + 2 * MIDDEAD.SOWER.BATTLE)) < 1e-9 && b.reinfMax >= 1, `2 Sowers: the battle's infection 10% → ${pct(b.infection)} (the dead drawn by noise: up to ${b.reinfMax})`);
  for (let i = 0; i < 20; i++) sowerRound(b);
  check(Math.abs(b.infection - (0.1 + MIDDEAD.SOWER.BATTLE_MAX)) < 1e-9, `never more than +${pct(MIDDEAD.SOWER.BATTLE_MAX)} (${pct(b.infection)})`);
  const st = createWorld({ seed: 13, factionCount: 4 });
  const base = hub(st);
  const near = st.grid.neighbors(base.tile).find((id) => st.tiles[id].terrain !== "water");
  st.tiles[near].infection = 0.1;
  const add = sowTile(st, { tile: near, size: 100, mix: { sower: 0.06 } });
  check(Math.abs(add - Math.min(MIDDEAD.SOWER.PASS, MIDDEAD.SOWER.PER * 6)) < 1e-9 && Math.abs(st.tiles[near].infection - (0.1 + add)) < 1e-6, `a horde of 100 with 6 Sowers crosses a tile: Infection 10% → ${pct(st.tiles[near].infection)}`);
  check(/Sowers/.test(st.log[0].text), `next to a base: its people hear of it (“${st.log[0].text}”)`);
  check(sowTile(st, { tile: near, size: 100, mix: { runner: 0.1 } }) === 0, "no Sowers: nothing sown");
}

section("Nightmare: the scream");
{
  let ran = 0, toExit = 0, braveHeld = 0, faintHeld = 0, trials = 40;
  for (let i = 0; i < trials; i++) {
    const { b, ps } = arena(100 + i, { nightmare: 1 }, 1);
    const nm = b.units.find((u) => u.ztype === "nightmare");
    at(nm, 14, 10); nm.aware = true; nm.ap = 2;
    at(ps[0], 10, 10); at(ps[1], 10, 12); at(ps[2], 11, 8);
    ps[0].nerve = MIDDEAD.NIGHTMARE.BRAVE; ps[1].nerve = MIDDEAD.NIGHTMARE.COWARD; ps[2].nerve = 0;
    b.evacCols = 2;
    const n0 = b.noise;
    nightmareTurn(b, nm);
    if (i === 0) check(b.noise === n0 + MIDDEAD.NIGHTMARE.NOISE && nm.screamCd === MIDDEAD.NIGHTMARE.EVERY, `it screams (noise +${MIDDEAD.NIGHTMARE.NOISE}) and will again in ${nm.screamCd} turns`);
    if (!ps[0].terror) braveHeld++;
    if (!ps[1].terror) faintHeld++;
    const x0 = ps.map((u) => u.x);
    const scared = ps.filter((u) => u.terror);
    for (const u of ps) u.ap = 2;
    terrorRuns(b);
    for (const u of scared) { ran++; if (u.x < x0[ps.indexOf(u)] && u.ap === 0) toExit++; }
  }
  check(braveHeld > faintHeld, `the brave held their nerve ${braveHeld} of ${trials} times, the cowardly ${faintHeld}`);
  check(ran > 0 && toExit === ran, `${ran} panicked and spent their turn running for the evac strip (${toExit})`);
  // In a raid: Heat.
  const st = createWorld({ seed: 7, factionCount: 4 });
  const h = hub(st);
  const tile = st.tiles.find((t) => t.loc && t.loc.type === "town" && t.id !== h.tile).id;
  const crew = atBase(st, h.id).slice(0, 3);
  const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 20, meds: 1 } }).party;
  p.path = [tile]; p.idx = 0; p.phase = "engaged";
  const b = createBattle(st, { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "specialtest", enemy: { kind: "zombies", count: 3, power: 3 }, raid: { heat0: 0 }, context: {} });
  const nm = applyZType(b.units.find((u) => u.kind === "zombie"), "nightmare", false, 3);
  const me = b.units.find((u) => u.side === "player");
  const cells = [];
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = me.x + dx, y = me.y + dy; if (Math.max(Math.abs(dx), Math.abs(dy)) >= 2 && x >= 0 && y >= 0 && x < b.w && y < b.h && b.reach[y * b.w + x] && !b.units.some((u) => !u.dead && u.x === x && u.y === y) && los(b, x, y, me.x, me.y)) cells.push([x, y]); }
  const cell = cells[0];
  at(nm, cell[0], cell[1]); nm.aware = true; nm.ap = 2;
  b.losCache.fill(0);
  const heat = b.raid.heat;
  nightmareTurn(b, nm);
  check(b.raid.heat >= heat + MIDDEAD.NIGHTMARE.HEAT - 1e-9 && nm.screamCd === MIDDEAD.NIGHTMARE.EVERY, `in a raid the scream raises the Heat ${Math.round(heat)} → ${Math.round(b.raid.heat)}`);
}

section("Sleepers among the bodies");
{
  // Placing: by area and infection, none near your people, the same map the same bodies.
  const mk = () => {
    const st = createWorld({ seed: 7, factionCount: 4 });
    const h = hub(st);
    const people = atBase(st, h.id).slice(0, 3);
    return inBrowser(() => createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind: "zombies", count: 4, power: 3 }, ambush: null, canRetreat: true, handler: "specialtest", context: {} }));
  };
  const b1 = mk(), b2 = mk();
  const ps1 = b1.units.filter((u) => u.side === "player");
  check(b1.corpses.length > 0 && b1.corpses.every((c) => ps1.every((u) => Math.max(Math.abs(u.x - c.x), Math.abs(u.y - c.y)) >= SLEEPER.AWAY)), `${b1.corpses.length} bodies on a fight in the open, none within ${SLEEPER.AWAY} tiles of your people`);
  check(JSON.stringify(b1.corpses.map((c) => [c.x, c.y, c.sleeper])) === JSON.stringify(b2.corpses.map((c) => [c.x, c.y, c.sleeper])), "the same fight lays out the same bodies");
  let total = 0, sleepers = 0;
  for (let s = 1; s <= 60; s++) { const bb = { w: 32, h: 24, tileId: s, infection: 0.4, units: [], cells: b1.cells.slice(0, 32 * 24).map(() => ({ k: "open" })), reach: new Uint8Array(32 * 24).fill(1), evacCols: 0 }; placeBodies(bb, s); total += bb.corpses.length; sleepers += bb.corpses.filter((c) => c.sleeper).length; }
  const odds = Math.min(SLEEPER.ODDS_MAX, SLEEPER.ODDS + SLEEPER.ODDS_INF * 0.4);
  check(Math.abs(sleepers / total - odds) < 0.07, `at 40% Infection ${total} bodies over 60 maps, ${pct(sleepers / total)} Sleepers (odds ${pct(odds)})`);

  // Splitting open.
  const { b, ps } = arena(14, {}, 2);
  const zs = b.units.filter((u) => u.kind === "zombie");
  b.corpses = [{ id: 1, x: 10, y: 10, seed: 1, sleeper: true }, { id: 2, x: 20, y: 10, seed: 2, sleeper: false }];
  at(zs[0], 11, 11);
  wakeNear(b, zs[0]);
  check(!b.corpses[0].burst, "one of the dead walking by does not wake it");
  at(ps[0], 9, 9); ps[0].hp = 100;
  wakeNear(b, ps[0]);
  const w = swarmsOf(b);
  check(b.corpses[0].burst && w.length === SLEEPER.SWARMS && b.log.some((l) => /splits open/.test(l.text)), "someone living next to it: it splits open and a worm swarm pours out");
  check(ps[0].hp < 100 || b.log.some((l) => /jerks back/.test(l.text)), `the first bite comes at once (${ps[0].name.split(" ")[0]} at ${Math.round(ps[0].hp)})`);
  at(ps[1], 21, 11);
  wakeNear(b, ps[1]);
  check(!b.corpses[1].burst && swarmsOf(b).length === w.length, "an ordinary body is only a body");

  // Spotted: a unit to shoot; it does not hold the field.
  const a2 = arena(15, {}, 1);
  const B = a2.b;
  B.corpses = [{ id: 1, x: 10, y: 10, seed: 1, sleeper: true }];
  const scout = a2.ps[0];
  scout.scouting = 20;
  at(scout, 8, 10);
  let tries = 0;
  while (!B.corpses[0].spotted && tries < 30) { B.turn++; spotCheck(B, scout); tries++; }
  const sl = B.units.find((u) => u.ztype === "sleeper");
  check(!!sl && sl.dormant && sl.x === 10 && sl.y === 10, `a scout 2 tiles off spots it (${tries} turn${tries === 1 ? "" : "s"}): it shows as a Sleeper`);
  B.turn++;
  spotCheck(B, scout);
  check(B.units.filter((u) => u.ztype === "sleeper").length === 1, "spotted once is enough");
  for (const u of B.units) if (u.side === "enemy" && u !== sl) { u.dead = true; }
  B.phase = "player";
  B.over = false;
  damage(B, B.units.find((u) => u.side === "player" && u !== scout), 0, null); // nudge nothing
  check(!B.units.some((u) => u.side === "enemy" && active(u) && !u.dormant), "with only a spotted Sleeper left, nothing awake holds the field");
  const n0 = swarmsOf(B).length;
  damage(B, sl, 999, scout, false, { how: "shot" });
  check(sl.dead && swarmsOf(B).length === n0 + 1 && B.corpses[0].burst && scout.hp === scout.maxHp - (scout.maxHp - scout.hp), "shot from afar it splits where it lies: the swarm comes out over there");
  // Fire.
  const a3 = arena(16, {}, 1);
  a3.b.corpses = [{ id: 1, x: 10, y: 10, seed: 1, sleeper: true }];
  ignite(a3.b, 10, 10, 3);
  burnBodies(a3.b);
  at(a3.ps[0], 9, 9);
  wakeNear(a3.b, a3.ps[0]);
  check(a3.b.corpses[0].burnt && !swarmsOf(a3.b).length, "a fire on it cooks the worms: nothing comes out");
}

section("Whole battles and raids with the new dead");
{
  let ended = 0, n = 0, thrown = 0, panics = 0, split = 0;
  for (const seed of [3, 5, 8, 21, 34, 55]) {
    const st = createWorld({ seed, factionCount: 4 });
    const h = hub(st);
    const people = atBase(st, h.id).slice(0, 6);
    st.autoRetreat = false;
    st.combat = inBrowser(() => createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind: "zombies", count: 12, power: 3, types: { boneback: 2, climber: 2, flinger: 1, sower: 1, nightmare: 1 } }, ambush: null, canRetreat: true, handler: "specialtest", context: {} }));
    const b = st.combat;
    for (let i = 0; i < 80 && !b.over; i++) { autoPlayerTurn(st); if (!b.over) runEnemyPhase(st); }
    n++;
    if (b.over) ended++;
    thrown += b.log.filter((l) => /hurls its mass/.test(l.text)).length;
    panics += b.log.filter((l) => /panics and/.test(l.text)).length;
    split += (b.corpses || []).filter((c) => c.burst).length;
    if (b.over) closeCombat(st);
  }
  check(ended === n, `${ended} of ${n} battles against Bonebacks, Climbers, a Flinger, a Sower and a Nightmare ended (${thrown} throws, ${panics} panics, ${split} Sleepers split)`);
  // Raids.
  let rEnded = 0, rN = 0;
  for (const seed of [9, 10, 11]) {
    const st = createWorld({ seed, factionCount: 4 });
    st.hour = 112 * 6 * 24;
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && t.loc.type === "town" && t.id !== h.tile).id;
    st.tiles[tile].infection = 0.6;
    const crew = atBase(st, h.id).slice(0, 3);
    const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 30, meds: 2 } }).party;
    p.path = [tile]; p.idx = 0; p.phase = "engaged";
    st.combat = createBattle(st, { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "specialtest", enemy: { kind: "zombies", count: 6, power: 3 }, raid: { heat0: 20 }, context: {} });
    const b = st.combat;
    const zs = b.units.filter((u) => u.kind === "zombie");
    ["nightmare", "flinger", "climber"].forEach((k, i) => zs[i] && applyZType(zs[i], k, false, 3));
    for (let i = 0; i < 90 && !b.over; i++) { autoPlayerTurn(st); if (!b.over) runEnemyPhase(st); }
    rN++;
    if (b.over) rEnded++;
  }
  check(rEnded === rN, `${rEnded} of ${rN} raids with a Nightmare, a Flinger and a Climber (and the bodies) ended`);
  const s2 = createWorld({ seed: 4, factionCount: 4 });
  const h2 = hub(s2);
  const ppl = atBase(s2, h2.id).slice(0, 4);
  const r = autoResolveCombat(s2, { tile: h2.tile, baseId: h2.id, fighterIds: ppl.map((s) => s.id), enemy: { kind: "zombies", count: 8, power: 3, types: { boneback: 1, nightmare: 1 } }, ambush: null, canRetreat: true, handler: "specialtest", context: {} });
  check(!!r && ["victory", "defeat", "retreat"].includes(r.outcome), `a fight by the numbers with them resolves (${r && r.outcome})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
