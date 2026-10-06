// The Carrier, its worm swarm and the human dead (src/sim/carriers.js, worm.js; hiveconst.js CARRIER, ZTYPES carrier /
// swarm, GROWTHS.cyst). Checks:
//   - the worm cyst is the first special dead a hive breeds (tier 0, after its first pit), and its hordes carry Carriers
//   - a human body near a Carrier gets up at once (no warning: at the start of the enemy turn, or on the Carrier's own
//     turn, acting at once); one of the dead never does; a body farther off does not; the map marks bodies in danger
//   - Crush skull works on any body, any time; Double tap shoots one from range (ammo, noise); the loot stays;
//     the battle AI crushes a body in danger next to one of yours
//   - fire on a body's tile destroys it and everything on it
//   - the worm swarm: a single bullet or bolt does CARRIER.SHOT, a shotgun its full damage, blows more, fire hotter;
//     its bite leaves the worm in the living CARRIER.INFEST of the time; a kill always does; one of yours bitten has
//     the worm for good (worm.js catchWorm; s.worm saves and loads) and gets up when they die, in a battle or on the
//     State Map (riseOnMap: others hurt and the body put down; alone on the road it walks off into the walking loot)
//   - the risen wear what the person wore; their things are never duplicated or lost
//   - walking loot: a risen still walking at the end takes its things into state.walkingLoot (the death site stays and
//     says so); a battle made near the pool marks one of its dead as that person and consumes the entry; put down and
//     the battle won its body has the things; still walking it goes back in; put down in a lost fight the things lie
//     at a death site; entries drift a tile a day
//   - carrying a body: slower, no shooting, put down, laid in the car (a body in the car cannot rise and comes home:
//     bury or burn it; one with the worm left unburied gets up at the base)
//   - in a raid the body's container goes with the risen; one of the walking dead leaves a body with the things in it
//   - whole battles with Carriers play out (the battle AI, the raid bot), and fights by the numbers weigh them
// Usage: node tools/carriertest.js
import { createWorld, hub, atBase, survivorById, hurt, day } from "../src/sim/world.js";
import {
  createBattle, enemyUnit, damage, endPlayerTurn, runEnemyPhase, autoPlayerTurn, registerCombatHandler, active, combatAct, endBattleNow,
  closeCombat, autoResolveCombat, canFire, ammoLeft,
} from "../src/sim/combat.js";
import { stirBodies, carrierRound, swarmArmor, crushable, tappable, endangered, imminent, wormable, walkingLoot, markWalking, walkingDaily, bodiesHome, buryBody, burnBodyHome, releaseSwarm } from "../src/sim/carriers.js";
import { catchWorm, hasWorm, clearWorm } from "../src/sim/worm.js";
import { applyZType, typeStrength, mixWeight } from "../src/sim/zombietypes.js";
import { CARRIER, ZTYPES, GROWTHS } from "../src/sim/hiveconst.js";
import { growthWish, startGrowth, hiveMix } from "../src/sim/hivetech.js";
import { newItem, allItems, armorMult } from "../src/sim/inventory.js";
import { launchExpedition, partyTile } from "../src/sim/parties.js";
import { createVehicle, carsAtBase, VEHICLE_TYPES } from "../src/sim/vehicles.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { deathLabel } from "../src/sim/markers.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
registerCombatHandler("carriertest", () => {});
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };
const logSince = (b, n) => b.log.slice(n).map((l) => l.text);
const newLogs = (st, n) => st.log.slice(0, st.log.length - n).map((l) => l.text); // the world's log is newest first
const risenFrom = (b, c) => b.units.find((u) => u.turned && u.turned.from === c.id) || null;
const first = (name) => name.split(" ")[0];
// Everything of a person's in exactly one place? Counts the places each item is in (the team's cargo, anyone's gear, a
// death site, the walking loot, a base's armory, the bodies brought home, the battle's bodies).
function places(st, it, b = null) {
  let n = 0;
  for (const p of st.parties) if (p.cargo && (p.cargo.gear.includes(it) || p.cargo.gear.some((g) => g.contents && g.contents.includes(it)))) n++;
  for (const s of st.survivors) if (allItems(s).includes(it)) n++;
  for (const d of st.deathSites) n += d.items.filter((e) => e.item === it).length;
  for (const e of walkingLoot(st)) if (e.items.includes(it)) n++;
  for (const h of st.bases) { if (h.armory.includes(it)) n++; for (const body of h.bodies || []) if (body.items.includes(it)) n++; }
  for (const p of st.parties) for (const body of (p.cargo && p.cargo.bodies) || []) if (body.items.includes(it)) n++;
  if (b && b.bodies) for (const body of b.bodies) if (body.sid == null && allItems(body).includes(it)) n++;
  return n;
}

// A battle on open ground: 3 of your people (a team away from home, or at the hub), a Carrier and 2 walkers, plus a
// raider. Everyone parked along the top row, unaware, until a check places them. opts.car: the team takes a car;
// opts.evac: keep the evac strip.
function arena(seed = 7, team = false, opts = {}) {
  const st = createWorld({ seed, factionCount: 4 });
  const h = hub(st);
  h.stock.ammo = 60;
  const people = atBase(st, h.id).slice(0, 3);
  let setup = { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id) };
  let p = null;
  if (team) {
    const tile = st.tiles.find((t) => t.loc && t.loc.type === "town" && t.id !== h.tile).id;
    const car = opts.car ? carsAtBase(st, h.id)[0] || createVehicle(st, Object.keys(VEHICLE_TYPES).find((k) => VEHICLE_TYPES[k].motor), { kind: "base", baseId: h.id }) : null;
    p = launchExpedition(st, { memberIds: people.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: car ? car.id : null, supplies: { food: 6, water: 6, ammo: 40, meds: 1 } }).party;
    p.path = [tile]; p.idx = 0; p.phase = "engaged";
    setup = { tile, partyId: p.id };
  }
  const b = inBrowser(() => createBattle(st, { ...setup, enemy: { kind: "zombies", count: 3, power: 3, types: { carrier: 1 } }, ambush: null, canRetreat: true, handler: "carriertest", context: {} }));
  st.combat = b;
  for (let i = 0; i < b.cells.length; i++) b.cells[i] = { k: "open", f: "grass" };
  b.losCache.fill(0);
  if (!opts.evac) b.evacCols = 0;
  b.infection = 0;
  b.corpses = []; // sleepers.js: no bodies lying about (their own test)
  const raider = enemyUnit(b, b.rng, "raiders", 3, 9);
  raider.armorKey = "vest"; raider.armor = 0.8;
  b.units.push(raider);
  b.units.forEach((u, i) => { u.x = 1 + i * 2; u.y = 0; u.aware = false; });
  const ps = b.units.filter((u) => u.side === "player");
  const carrier = b.units.find((u) => u.ztype === "carrier");
  const walkers = b.units.filter((u) => u.kind === "zombie" && !u.ztype);
  return { st, b, ps, carrier, walkers, raider, p, h };
}
// The start of a player turn, and of the enemy's turn after it (combat.js startPlayerTurn / endPlayerTurn), as
// far as the worm goes.
const playerTurnStarts = (st, b) => { b.turn++; b.phase = "player"; stirBodies(st, b); };
const enemyTurnStarts = (st, b) => { b.phase = "enemy"; carrierRound(st, b); };
const armed = (u, weapon = "pistol") => { u.weapon = weapon; u.weaponName = weapon; };
const kill = (b, u, by = null) => { damage(b, u, 9999, by); if (u.side === "player") u.dead = true; };
const clearField = (b, keep = []) => { for (const u of b.units) if (u.side === "enemy" && active(u) && !keep.includes(u)) damage(b, u, 9999, null, false, { how: "blast" }); for (const u of b.units) if (u.ztype === "swarm" && active(u) && !keep.includes(u)) damage(b, u, 9999, null, false, { how: "blast" }); };

section("The hive tech tree: the worm cyst comes first");
{
  check(GROWTHS.cyst && GROWTHS.cyst.tier === 0 && GROWTHS.cyst.unlocks === "carrier" && Object.values(GROWTHS).every((G) => !G.unlocks || G === GROWTHS.cyst || G.tier > GROWTHS.cyst.tier),
    `the worm cyst breeds Carriers at tier ${GROWTHS.cyst.tier}, below every other special dead (runners: tier ${GROWTHS.warren.tier})`);
  const st = createWorld({ seed: 33, factionCount: 8 });
  st.started = true;
  const hv = st.hives[0];
  st.hour = 5 * 24;
  const w1 = growthWish(st, hv, false);
  hv.res = 80;
  const pit = startGrowth(st, hv, "pit"); pit.ready = st.hour; hv.growDay = null;
  const w2 = growthWish(st, hv, false);
  check(w1 === "pit" && w2 === "cyst", `a young hive grows a biomass pit first (${w1}), then the worm cyst (${w2})`);
  check(hiveMix(st, hv).mix === null, "with only a pit its hordes are ordinary dead");
  hv.res = 80;
  const cy = startGrowth(st, hv, "cyst"); cy.ready = st.hour;
  // Each new horde brings the kinds a hive breeds at its odds (hivetech.js mixOdds): over a few hordes they come.
  let m = null;
  const h0 = st.hour;
  for (let i = 0; i < 20 && !(m && m.carrier); i++, st.hour++) m = hiveMix(st, hv, "large").mix;
  st.hour = h0;
  check(!!m && m.carrier > 0 && m.carrier <= 0.1, `a grown cyst: its hordes carry Carriers (${m ? Math.round(m.carrier * 100) : 0}%)`);
  check(typeStrength({ count: 10, types: { carrier: 2 } }) > 1.05 && mixWeight({ carrier: 0.1 }, "wall") > 1, `a fight by the numbers weighs 2 Carriers in 10 at ${typeStrength({ count: 10, types: { carrier: 2 } }).toFixed(2)}×; at the walls ${mixWeight({ carrier: 0.1 }, "wall").toFixed(2)}×`);
  check(ZTYPES.swarm.share === 0 && !Object.values(GROWTHS).some((G) => G.unlocks === "swarm"), "no hive breeds the swarm: it only comes out of a Carrier");
  check(/Single shots pass through it/.test(ZTYPES.swarm.counter) && /shotguns/.test(ZTYPES.swarm.counter), `Help explains the swarm: “${ZTYPES.swarm.counter}”`);
}

section("Bodies near a Carrier get up at once; the dead never do; the map marks bodies in danger");
{
  const { st, b, carrier, walkers, raider } = arena();
  carrier.x = 10; carrier.y = 10;
  raider.x = 12; raider.y = 11; // 2 tiles off
  walkers[0].x = 9; walkers[0].y = 10; // right next to it
  walkers[1].x = 16; walkers[1].y = 10; // far off, alive
  const far = enemyUnit(b, b.rng, "raiders", 3, 10);
  far.x = 14; far.y = 10; b.units.push(far); // 4 tiles off
  const beyond = enemyUnit(b, b.rng, "raiders", 3, 11);
  beyond.x = 25; beyond.y = 10; b.units.push(beyond); // 15 tiles off
  kill(b, raider); kill(b, walkers[0]); kill(b, far); kill(b, beyond);
  check(raider.dead && walkers[0].dead && far.dead, "a raider 2 tiles from the Carrier, a walker next to it and raiders 4 and 15 tiles off are killed");
  playerTurnStarts(st, b);
  check(!risenFrom(b, raider) && wormable(raider) && b.log.every((l) => !/stir|twitch/.test(l.text)), "in your turn nothing gets up and nothing stirs: there is no warning");
  check(imminent(b, raider) && endangered(b, raider), "the body 2 tiles off is marked: in danger, and about to get up");
  check(!imminent(b, far) && endangered(b, far), `the body 4 tiles off is in danger (a Carrier within ${CARRIER.SEEK}), not about to get up`);
  check(!endangered(b, beyond) && !endangered(b, walkers[0]), "the body 15 tiles off is not marked, nor is the dead walker");
  const n0 = b.log.length;
  enemyTurnStarts(st, b);
  const z = risenFrom(b, raider);
  check(!!z && active(z) && z.kind === "zombie" && z.name === `${raider.name} (turned)` && z.x === raider.x && z.y === raider.y && raider.off, `at the enemy's turn it gets up at once: ${z ? z.name : "nothing"} where the body lay (the body gone from the map)`);
  check(logSince(b, n0).some((t) => /gets up/.test(t) && t.includes(raider.name)), `the log: “${logSince(b, n0).find((t) => /gets up/.test(t))}”`);
  check(!!z && z.ap === CARRIER.RISE_AP && z.wild && z.reinforcement && z.weapon === "claws", `up with ${CARRIER.RISE_AP} action, teeth and nails (no gun), after anything living, not one of the enemy the battle began with`);
  check(!!z && Math.abs(z.armor - raider.armor) < 1e-9, `it wears the raider's vest: ×${z ? z.armor : "?"} of every hit`);
  check(!risenFrom(b, walkers[0]) && !risenFrom(b, far) && !risenFrom(b, beyond), "the walker never gets up again, nor the raiders out of reach");
  // Never twice: the risen killed lies still.
  kill(b, z);
  playerTurnStarts(st, b); enemyTurnStarts(st, b);
  check(z.dead && !risenFrom(b, z) && b.units.filter((u) => u.turned).length === 1, "put down, the risen stays down (one of the dead now)");
}

section("A Carrier on its own turn raises what it reaches; the risen act at once");
{
  const { st, b, ps, carrier, walkers, raider } = arena(13);
  for (const p of ps) { p.x = 1; p.y = 20 + ps.indexOf(p); }
  for (const w of walkers) { w.x = 30; w.y = 1 + walkers.indexOf(w); }
  carrier.x = 20; carrier.y = 5; carrier.aware = true;
  raider.x = 15; raider.y = 8;
  kill(b, raider);
  b.phase = "player";
  endPlayerTurn(st);
  runEnemyPhase(st);
  const z = risenFrom(b, raider);
  const near = Math.max(Math.abs(carrier.x - raider.x), Math.abs(carrier.y - raider.y));
  check(near <= CARRIER.RANGE && !!z, `it walked to the raider's body (${near} tiles off now) and the body got up in the same enemy turn`);
  check(!!z && (z.ap === 0 || z.x !== raider.x || z.y !== raider.y), "the risen acted at once, in the turn it rose");
}

section("Crush skull and Double tap work on any body, any time; the loot stays; the battle AI crushes a body in danger");
{
  const { st, b, ps, carrier, walkers, raider, h } = arena(11);
  const [A] = ps;
  carrier.x = 30; carrier.y = 20; // far off: no worm about
  for (const w of walkers) { w.x = 30; w.y = 21 + walkers.indexOf(w); }
  raider.x = 11; raider.y = 10;
  const r2 = enemyUnit(b, b.rng, "raiders", 3, 10);
  r2.x = 18; r2.y = 10; b.units.push(r2);
  kill(b, raider); kill(b, r2);
  playerTurnStarts(st, b);
  A.x = 12; A.y = 10; A.ap = 2; A.aware = true;
  armed(A, "pistol");
  check(crushable(b, A).includes(raider) && !crushable(b, A).includes(r2), "with no Carrier near, a body next to your person can still have its skull crushed (the one 6 tiles off cannot)");
  const err = combatAct(st, { type: "crush", unit: A.id, target: raider.id });
  check(err === "" && raider.crushed && A.ap === 1, `Crush skull: 1 action (${err || "done"}), the body will not get up`);
  check(tappable(b, A).includes(r2) && !tappable(b, A).includes(raider), "the body 6 tiles off in plain sight can be double tapped (the crushed one no longer counts)");
  const ammo0 = ammoLeft(b), noise0 = b.noise;
  const err2 = combatAct(st, { type: "doubletap", unit: A.id, target: r2.id });
  check(err2 === "" && r2.crushed && r2.tapped && A.ap === 0, `Double tap: 1 action (${err2 || "done"}), a round through the head`);
  check(ammoLeft(b) === ammo0 - 1 && b.noise > noise0, `it costs a round (${ammo0} → ${ammoLeft(b)}) and makes the noise of a shot (${noise0} → ${b.noise})`);
  h.stock.ammo = 0;
  A.ap = 2;
  const r3 = enemyUnit(b, b.rng, "raiders", 3, 11); r3.x = 13; r3.y = 12; b.units.push(r3); kill(b, r3);
  check(/ammo/i.test(combatAct(st, { type: "doubletap", unit: A.id, target: r3.id })), "out of ammo there is no double tap");
  armed(A, "machete");
  check(/gun/i.test(combatAct(st, { type: "doubletap", unit: A.id, target: r3.id })), "nor without a gun");
  // The Carrier comes right up to them: neither gets up.
  carrier.x = 12; carrier.y = 11;
  enemyTurnStarts(st, b);
  check(!risenFrom(b, raider) && !risenFrom(b, r2) && !!risenFrom(b, r3), "a Carrier next to them: the crushed and the shot stay down; the untouched one gets up");
  clearField(b);
  endBattleNow(st, "victory");
  const names = b.bodies.map((x) => x.name);
  check(names.includes(raider.name) && names.includes(r2.name), `both bodies are there to loot after the win (${names.filter((n) => /Raider/.test(n)).join(", ")})`);
  closeCombat(st);
}
{
  // The battle AI crushes a body in danger next to one of yours (none of the enemy next to them).
  const { st, b, ps, carrier, walkers, raider } = arena(12);
  carrier.x = 10; carrier.y = 10;
  raider.x = 14; raider.y = 10; // 4 tiles from the Carrier: in danger
  for (const w of walkers) { w.x = 30; w.y = 20 + walkers.indexOf(w); }
  kill(b, raider);
  playerTurnStarts(st, b);
  for (const p of ps) { p.x = 2; p.y = 20 + ps.indexOf(p); p.ap = 2; }
  ps[0].x = 15; ps[0].y = 11;
  st.autoRetreat = false;
  autoPlayerTurn(st);
  check(raider.crushed && !risenFrom(b, raider), "the battle AI crushes the skull of a body in danger next to one of yours");
}

section("Fire destroys a body and everything on it");
{
  const { st, b, ps, carrier, raider } = arena(14, true);
  const [A] = ps;
  const sA = survivorById(st, A.sid);
  sA.gear.armor = newItem("vest", 0.9);
  const mine = allItems(sA);
  carrier.x = 30; carrier.y = 20;
  raider.x = 11; raider.y = 10;
  A.x = 13; A.y = 10;
  kill(b, raider); kill(b, A, carrier);
  b.fires = [{ x: raider.x, y: raider.y, turns: 3 }, { x: A.x, y: A.y, turns: 3 }];
  const n0 = b.log.length;
  playerTurnStarts(st, b);
  check(raider.burnt && A.burnt && !wormable(raider), "two bodies in the flames burn: neither can get up");
  check(logSince(b, n0).some((t) => /burns with it/.test(t)), `the log says the loot goes too: “${logSince(b, n0).find((t) => /burns with it/.test(t))}”`);
  b.fires = [];
  carrier.x = 12; carrier.y = 10;
  enemyTurnStarts(st, b);
  check(!risenFrom(b, raider) && !risenFrom(b, A), "a Carrier next to the burnt bodies raises nothing");
  clearField(b);
  endBattleNow(st, "victory");
  check(!b.bodies.some((x) => x.name === raider.name) && !b.bodies.some((x) => x.sid === sA.id), "after the win there is no body to loot of either");
  check(!sA.alive && allItems(sA).length === 0 && mine.every((it) => places(st, it, b) === 0), `${first(sA.name)}'s things burned with them: nowhere now (${mine.map((it) => it.name).join(", ")})`);
  closeCombat(st);
}

section("The worm swarm: single shots pass through, shotguns do not; its bite infests");
{
  const { st, b, ps, carrier, raider } = arena(17);
  const [A, B] = ps;
  carrier.x = 10; carrier.y = 10;
  A.x = 8; A.y = 10;
  armed(A, "pistol");
  let n0 = b.log.length;
  damage(b, carrier, 999, A, false, { how: "shot", weapon: "pistol" });
  const w = b.units.find((u) => u.ztype === "swarm");
  check(carrier.dead && !!w && active(w) && w.x === 10 && w.y === 10 && w.name === "Worm swarm", `a Carrier killed bursts: ${w ? w.name : "nothing"} where it fell`);
  check(logSince(b, n0).some((t) => /bursts open/.test(t)), `the log: “${logSince(b, n0).find((t) => /bursts open/.test(t))}”`);
  check(!!w && w.mob > 3 && w.maxHp < carrier.maxHp && w.wild && w.reinforcement, `quick (${w.mob} tiles an action), weak (${w.maxHp} hp), after anything living`);
  const hitFor = (hit, by = null) => { const hp = w.hp; damage(b, w, 10, by, false, hit); const d = hp - w.hp; w.hp = w.maxHp; return d; };
  const pistol = hitFor({ how: "shot", weapon: "pistol" }), rifle = hitFor({ how: "shot", weapon: "huntrifle" }), bow = hitFor({ how: "shot", weapon: "compbow" });
  const shotgun = hitFor({ how: "shot", weapon: "shotgun" }), pipegun = hitFor({ how: "shot", weapon: "pipegun" });
  const blow = hitFor({ how: "bash" }), blade = hitFor({ how: "melee" }), blast = hitFor({ how: "blast" });
  check([pistol, rifle, bow].every((d) => Math.abs(d - 10 * CARRIER.SHOT) < 1e-6), `a pistol round, a rifle round and an arrow pass through it: 10 → ${pistol}, ${rifle}, ${bow}`);
  check(Math.abs(shotgun - 10 * CARRIER.SHOTGUN) < 1e-6 && Math.abs(pipegun - 10 * CARRIER.SHOTGUN) < 1e-6, `a shotgun's spread catches it: 10 → ${shotgun} (a pipe shotgun ${pipegun})`);
  check(Math.abs(blow - 10 * CARRIER.BASH) < 1e-6 && Math.abs(blade - 10 * CARRIER.MELEE) < 1e-6 && Math.abs(blast - 10 * CARRIER.BLAST) < 1e-6 && swarmArmor({ how: "fire" }) === 1 && ZTYPES.swarm.burn > 1, `a blow does more (10 → ${blow}), a blade ${blade}, a blast ${blast}; fire burns it ${ZTYPES.swarm.burn}× as hot`);
  armed(A, "shotgun");
  const byUnit = hitFor({ how: "shot" }, A);
  check(Math.abs(byUnit - 10 * CARRIER.SHOTGUN) < 1e-6, `the shooter's own weapon counts when the hit does not say (a shotgun in hand: 10 → ${byUnit})`);
  // Its bite: CARRIER.INFEST of the time the worm is in the living.
  let bit = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) { const t = enemyUnit(b, b.rng, "raiders", 3, 50); t.hp = 1e6; damage(b, t, 1, w, false, { how: "melee" }); if (t.wormed) bit++; }
  check(Math.abs(bit / N - CARRIER.INFEST) < 0.04, `the swarm's bite leaves the worm in the living about ${Math.round(CARRIER.INFEST * 100)}% of the time (${Math.round((bit / N) * 100)}% of ${N})`);
  const r4 = enemyUnit(b, b.rng, "raiders", 3, 51); r4.x = 20; r4.y = 20; b.units.push(r4);
  for (let i = 0; i < 200 && !r4.wormed; i++) damage(b, r4, 0.01, w, false, { how: "melee" });
  check(r4.wormed && !r4.dead, "a raider bitten and still standing has the worm");
  kill(b, r4);
  enemyTurnStarts(st, b);
  check(!!risenFrom(b, r4), "killed later by anyone else, the bitten raider gets up");
  // Someone it kills always has it: a raider at once (next turn), one of yours only once they bleed out.
  raider.x = 11; raider.y = 10;
  damage(b, raider, 999, w);
  B.x = 9; B.y = 11;
  damage(b, B, 999, w);
  check(raider.dead && raider.wormed && B.down && !B.dead && B.wormed, "the swarm kills a raider and brings one of yours down: the worm is in both");
  enemyTurnStarts(st, b);
  check(!!risenFrom(b, raider) && !risenFrom(b, B), "the raider gets up; yours, only down, does not");
  B.dead = true;
  enemyTurnStarts(st, b);
  const zb = risenFrom(b, B);
  check(!!zb && zb.name === `${first(B.name)} (turned)` && B.off, `${B.name} bleeds out and gets up as ${zb ? zb.name : "nothing"}`);
  // With no one to kill it sinks.
  let turns = 0;
  for (let i = 0; i < 20 && active(w); i++) { playerTurnStarts(st, b); enemyTurnStarts(st, b); turns++; }
  check(!active(w) && w.sank && w.off, `left alone it sinks into the ground after ${turns} more turns (${CARRIER.SWARM_TURNS} in all)`);
}

section("The worm in the living: caught in battle, saved and loaded, shown; whoever has it gets up when they die");
{
  const { st, b, ps, carrier, walkers, h } = arena(21);
  const [A, , C] = ps;
  const sA = survivorById(st, A.sid), sC = survivorById(st, C.sid);
  // A bitten and standing: wormed on the unit; the battle won, the worm stays with them.
  carrier.x = 30; carrier.y = 20; for (const w of walkers) { w.x = 30; w.y = 21 + walkers.indexOf(w); }
  const sw = releaseSwarm(b, 20, 20, 3);
  A.x = 21; A.y = 20;
  for (let i = 0; i < 200 && !A.wormed; i++) damage(b, A, 0.01, sw, false, { how: "melee" });
  check(A.wormed && A.wormBit && !A.down, `${A.name} is bitten and stands: the worm is in them`);
  clearField(b);
  const n0 = st.log.length;
  endBattleNow(st, "victory");
  check(hasWorm(sA) && sA.worm.from === "a worm swarm's bite" && sA.worm.day === day(st), `the battle over, ${first(sA.name)} has the worm for good (worm.js catchWorm: ${JSON.stringify(sA.worm)})`);
  check(newLogs(st, n0).some((t) => /has the worm/.test(t)), `the log: “${newLogs(st, n0).find((t) => /has the worm/.test(t))}”`);
  check(!catchWorm(st, sA, "again") && hasWorm(sA), "catching it twice changes nothing");
  closeCombat(st);
  // Save and load keep it.
  const L = loadFromString(saveToString(st));
  const lA = L.survivors.find((s) => s.id === sA.id);
  check(!!lA && hasWorm(lA) && lA.worm.day === sA.worm.day && lA.worm.from === sA.worm.from, "s.worm survives a save and a load");
  // In a later battle their unit starts wormed, and if they die they get up.
  const b2 = inBrowser(() => createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: [sA.id, sC.id], enemy: { kind: "zombies", count: 2, power: 3 }, ambush: null, canRetreat: true, handler: "carriertest", context: {} }));
  st.combat = b2;
  b2.corpses = [];
  const uA = b2.units.find((u) => u.sid === sA.id), uC = b2.units.find((u) => u.sid === sC.id);
  check(uA.wormed && !uC.wormed, `${first(sA.name)} takes the field with the worm in them; ${first(sC.name)} does not`);
  kill(b2, uA);
  enemyTurnStarts(st, b2);
  const zA = risenFrom(b2, uA);
  check(!!zA && zA.name === `${first(sA.name)} (turned)`, `killed with no Carrier near, ${first(sA.name)} gets up as ${zA ? zA.name : "nothing"}`);
  endBattleNow(st, "defeat");
  closeCombat(st);
  // clearWorm: gone.
  catchWorm(st, sC, "a test");
  check(hasWorm(sC) && clearWorm(sC) && !hasWorm(sC) && !clearWorm(sC), "clearWorm takes it away");
}
{
  // On the State Map: with others there they tear at someone and are put down; alone on the road they walk off.
  const st = createWorld({ seed: 25, factionCount: 4 });
  const h = hub(st);
  const people = atBase(st, h.id);
  const sB = people[1];
  catchWorm(st, sB, "a test");
  const before = people.filter((s) => s !== sB).map((s) => s.health);
  const n0 = st.log.length;
  hurt(st, sB, 9999, h.tile, "a test");
  const hurtOne = people.filter((s) => s !== sB).some((s, i) => s.health < before[i]);
  check(!sB.alive && hurtOne && newLogs(st, n0).some((t) => /got up again.*tore at/.test(t)), `dying at the hub with the worm, ${first(sB.name)} gets up and tears at someone before they are put down (${newLogs(st, n0).find((t) => /tore at/.test(t))})`);
  check(walkingLoot(st).length === 0, "their things stay in the armory: nothing walks off from inside the walls");
  const sD = atBase(st, h.id)[0];
  sD.gear.armor = newItem("vest", 0.8);
  const mine = allItems(sD);
  const tile = st.tiles.find((t) => t.loc && t.loc.type === "town" && t.id !== h.tile).id;
  const p = launchExpedition(st, { memberIds: [sD.id], dest: tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2, ammo: 5, meds: 0 } }).party;
  p.path = [tile]; p.idx = 0;
  catchWorm(st, sD, "a test");
  const n1 = st.log.length;
  hurt(st, sD, 9999, partyTile(p), "a test");
  const e = walkingLoot(st).find((x) => x.sid === sD.id);
  check(!sD.alive && !!e && e.tile === tile && e.name === `${first(sD.name)} (turned)` && mine.every((it) => e.items.includes(it)), `alone on the road, ${first(sD.name)} gets up and walks off with their things (${e ? e.items.map((g) => g.name).join(", ") : "none"})`);
  check(allItems(sD).length === 0 && mine.every((it) => places(st, it) === 1), "each thing is in exactly one place: the walking loot");
  const site = st.deathSites.find((d) => d.tile === tile);
  check(!!site && site.walked && site.walked.includes(sD.name) && !site.items.length && /body is gone: they rose and walked/.test(deathLabel(site)), `the death site stays and says so: “${site ? deathLabel(site) : "no site"}”`);
  check(newLogs(st, n1).some((t) => /walked off/.test(t)), `the log: “${newLogs(st, n1).find((t) => /walked off/.test(t))}”`);
}

section("The risen wear what the person wore; their things are never duplicated or lost");
{
  // A team away from home: the fallen's things are at their death site until their body is looted.
  const { st, b, ps, carrier, raider, p } = arena(19, true);
  const [A] = ps;
  const sA = survivorById(st, A.sid);
  sA.gear.armor = newItem("plate", 0.9);
  sA.gear.head = newItem("milhelmet", 0.8);
  const mine = allItems(sA);
  carrier.x = 10; carrier.y = 10;
  A.x = 11; A.y = 10;
  kill(b, A, carrier);
  raider.x = 9; raider.y = 10;
  kill(b, raider);
  enemyTurnStarts(st, b);
  const zA = risenFrom(b, A), zR = risenFrom(b, raider);
  check(!!zA && zA.name === `${first(sA.name)} (turned)` && !!zR, `${sA.name} gets up as ${zA ? zA.name : "nothing"}; the raider too`);
  check(!!zA && Math.abs(zA.armor - armorMult(sA)) < 1e-9 && zA.armor < 0.8, `in the plate carrier and helmet: ×${zA ? zA.armor.toFixed(2) : "?"} of every hit`);
  const hp = zA.hp;
  damage(b, zA, 20, null, false, { how: "melee" });
  check(Math.abs(hp - zA.hp - 20 * zA.armor) < 1e-6, `a 20-point blow does ${(hp - zA.hp).toFixed(1)}`);
  clearField(b);
  check(b.units.every((u) => u.side !== "enemy" || !active(u)), "every one of the enemy is down");
  endBattleNow(st, "victory");
  const names = b.bodies.map((x) => x.name);
  check(names.includes(`${first(sA.name)} (turned)`) && !names.includes(sA.name), `the loot has "${first(sA.name)} (turned)" (their own body), no second one`);
  check(names.filter((n) => n.startsWith(raider.name)).length === 1 && names.includes(`${raider.name} (turned)`), `the raider is one body, "${raider.name} (turned)"`);
  const counts = mine.map((it) => places(st, it));
  check(mine.length >= 2 && counts.every((n) => n === 1), `each of ${first(sA.name)}'s ${mine.length} things is in exactly one place after the loot (${counts.join(", ")}): ${mine.map((it) => it.name).join(", ")}`);
  const back = mine.filter((it) => p.cargo.gear.includes(it) || st.survivors.some((s) => s.alive && allItems(s).includes(it)));
  check(back.length >= 1, `put down and looted, the team has their things back (${back.map((it) => it.name).join(", ") || "none"}; what did not fit stays at the death site)`);
  const raiderBody = b.bodies.find((x) => x.name === `${raider.name} (turned)`);
  check(!!raiderBody && (b.result.loot.gear.some((g) => g.key === "vest") || (raiderBody.gear && raiderBody.gear.armor && raiderBody.gear.armor.key === "vest")), "the raider's vest came off the risen body");
  closeCombat(st);
}

section("Walking loot: a risen still walking takes its things with it; met again later, in their gear");
{
  const { st, b, ps, carrier, raider, p } = arena(23, true);
  const [A] = ps;
  const sA = survivorById(st, A.sid);
  sA.gear.armor = newItem("vest", 0.9);
  sA.gear.head = newItem("bikehelmet", 0.7);
  const mine = allItems(sA);
  const arm0 = armorMult(sA);
  carrier.x = 10; carrier.y = 10;
  A.x = 11; A.y = 10;
  kill(b, A, carrier);
  raider.x = 9; raider.y = 10;
  kill(b, raider);
  enemyTurnStarts(st, b);
  const zA = risenFrom(b, A), zR = risenFrom(b, raider);
  clearField(b, [zA, zR]);
  const n0 = st.log.length;
  endBattleNow(st, "victory");
  const tile = b.tileId;
  const site = st.deathSites.find((d) => d.tile === tile);
  check(!!zA && active(zA) && !b.bodies.some((x) => x.sid === sA.id), `${zA ? zA.name : "?"} still walks when it ends: no body of theirs to loot`);
  const eA = walkingLoot(st).find((e) => e.sid === sA.id), eR = walkingLoot(st).find((e) => e.who === raider.name);
  check(!!eA && eA.tile === tile && eA.name === `${first(sA.name)} (turned)` && mine.every((it) => eA.items.includes(it)) && Math.abs(eA.armor - arm0) < 1e-9, `their things went with them into the walking loot (${eA ? eA.items.map((g) => g.name).join(", ") : "nothing"}), with their armour`);
  check(mine.every((it) => places(st, it) === 1) && allItems(sA).length === 0, "each thing is in exactly one place (the pool), none left on them or at the death site");
  check(!!site && site.walked && site.walked.includes(sA.name) && /rose and walked/.test(deathLabel(site)), `the death site stays for your people and says the body walked: “${site ? deathLabel(site) : "no site"}”`);
  check(!!eR && eR.sid == null && eR.kit === "raiders" && eR.armorKey === "vest" && eR.items.some((g) => g.key === "vest"), `the raider who got up walked off too, with their kit (${eR ? eR.items.map((g) => g.name).join(", ") : "nothing"})`);
  check(/still walking/.test(b.summary.join(" ")) && newLogs(st, n0).some((t) => /walked off/.test(t)), `the summary and the log say so: “${b.summary.find((l) => /still walking/.test(l))}”`);
  closeCombat(st);
  // Drift: a tile a day at most, always a real tile.
  const t0 = eA.tile;
  let steps = 0, moved = 0, ok = true;
  for (let i = 0; i < 12; i++) {
    const was = eA.tile;
    walkingDaily(st);
    steps++;
    if (eA.tile !== was) moved++;
    if (!(eA.tile >= 0 && eA.tile < st.tiles.length && st.grid.distance(was, eA.tile) <= 1)) ok = false;
  }
  check(ok && moved > 0 && moved < steps, `over ${steps} days the entry drifted ${moved} tiles, a step at a time (${t0} → ${eA.tile})`);
  eA.tile = tile; eR.tile = tile;
  // A battle made on the tile: within a few tries the walking dead are among the ordinary dead there.
  let b2 = null, marked = null;
  for (let i = 0; i < 12 && !marked; i++) {
    b2 = inBrowser(() => createBattle(st, { tile, partyId: p.id, enemy: { kind: "zombies", count: 5, power: 3 }, ambush: null, canRetreat: true, handler: "carriertest", context: {} }));
    st.combat = b2;
    marked = b2.units.find((u) => u.walking && u.walking.sid === sA.id) || null;
    if (!marked) { for (const z of b2.units) if (z.walking) { walkingLoot(st).push(z.walking); z.walking.tile = tile; z.walking = null; } b2.over = true; st.combat = null; }
  }
  check(!!marked && marked.name === `${first(sA.name)} (turned)` && marked.turned.sid === sA.id && Math.abs(marked.armor - eA.armor) < 1e-9 && !walkingLoot(st).includes(eA), `a battle near the pool: ${marked ? marked.name : "nobody"} is among the dead, in their armour, and the entry is out of the pool`);
  check(b2.log.some((l) => /among the dead here/.test(l.text)) && st.log.some((l) => /walks among the dead at/.test(l.text)), `the battle and the Diary note the meeting: “${st.log.find((l) => /walks among the dead/.test(l.text))?.text}”`);
  // Put down and the battle won: their things are on the body.
  for (let i = 0; i < b2.cells.length; i++) b2.cells[i] = { k: "open", f: "grass" };
  b2.losCache.fill(0);
  for (const z of b2.units) if (z.walking && z !== marked) { walkingLoot(st).push(z.walking); z.walking.tile = tile; z.walking = null; z.turned = null; }
  kill(b2, marked);
  clearField(b2);
  endBattleNow(st, "victory");
  const body = b2.bodies.find((x) => x.name === `${first(sA.name)} (turned)`);
  const got = mine.filter((it) => b2.result.loot.gear.includes(it) || (body && allItems(body).includes(it)));
  check(!!body && body.sid == null && got.length === mine.length, `the body "${body ? body.name : "?"}" had their things (taken as it ended: ${got.map((g) => g.name).join(", ")})`);
  check(mine.every((it) => places(st, it, b2) === 1), "each thing is in exactly one place (the body)");
  closeCombat(st);
  check(mine.every((it) => places(st, it) === 1) && mine.some((it) => p.cargo.gear.includes(it) || st.survivors.some((s) => s.alive && allItems(s).includes(it))), `looted: the team has ${first(sA.name)}'s things back, once each`);
  // Still walking at the end of the next battle: back into the pool. Put down in a lost fight: the things on the tile.
  const b3 = inBrowser(() => createBattle(st, { tile, partyId: p.id, enemy: { kind: "zombies", count: 3, power: 3 }, ambush: null, canRetreat: true, handler: "carriertest", context: {} }));
  st.combat = b3;
  for (const z of b3.units) if (z.walking) { walkingLoot(st).push(z.walking); z.walking.tile = tile; z.walking = null; z.turned = null; }
  const z3 = b3.units.find((u) => u.kind === "zombie" && !u.walking && !u.ztype);
  const z4 = b3.units.find((u) => u.kind === "zombie" && !u.walking && !u.ztype && u !== z3);
  const eX = { id: 9001, name: "Stranger (turned)", who: "Stranger", sid: null, side: "enemy", kit: "raiders", weapon: "pistol", armorKey: null, armor: 1, tile, day: day(st), items: [newItem("machete", 0.8)], supplies: { ammo: 4 }, met: 0 };
  walkingLoot(st).push(eX);
  markWalking(st, b3, z3, eX);
  markWalking(st, b3, z4, eR);
  check(!walkingLoot(st).includes(eX) && !walkingLoot(st).includes(eR) && z3.name === "Stranger (turned)", "an entry marked onto one of the dead leaves the pool");
  kill(b3, z4);
  endBattleNow(st, "retreat");
  check(walkingLoot(st).includes(eX) && eX.tile === tile && eX.items.length === 1 && !walkingLoot(st).includes(eR), "the one still walking at the end is back in the pool with its things; the one put down in a lost fight is not");
  const site2 = st.deathSites.find((d) => d.tile === tile);
  check(!!site2 && eR.items.length === 0 && site2.items.some((e) => /vest/i.test(e.name) && /Raider/.test(e.name)), `the raider put down in the retreat left their things on the tile (${site2 ? site2.items.map((e) => e.name).join(", ") : "no site"})`);
  closeCombat(st);
}

section("Carrying a body: slower, no shooting; into the car; home to bury or burn");
{
  const { st, b, ps, carrier, walkers, raider, p, h } = arena(27, true, { car: true, evac: true });
  const [A, B] = ps;
  const sB = survivorById(st, B.sid);
  sB.gear.armor = newItem("vest", 0.85);
  const mineB = allItems(sB);
  check(b.evacCols > 0 && !!p.vehicleId, "the team came by car and the battle has an evac strip");
  carrier.x = 30; carrier.y = 20; for (const w of walkers) { w.x = 30; w.y = 21 + walkers.indexOf(w); }
  raider.x = 5; raider.y = 10;
  A.x = 4; A.y = 10; A.ap = 2; A.aware = true; armed(A, "pistol");
  kill(b, raider);
  const mob0 = A.mob;
  const err = combatAct(st, { type: "pickup", unit: A.id, target: raider.id });
  check(err === "" && A.carrying === raider.id && raider.off && raider.carriedBy === A.id && A.ap === 1, `Pick up body: 1 action (${err || "done"}); the body is off the ground, on ${first(A.name)}'s shoulder`);
  check(A.mob === CARRIER.CARRY_MOB && A.mob < mob0 && !canFire(b, A), `carrying: ${A.mob} tiles an action instead of ${mob0}, and no shooting`);
  check(combatAct(st, { type: "shoot", unit: A.id, target: carrier.id }) !== "", "a shot is refused while carrying");
  // A Carrier right next to them: the carried body does not get up.
  carrier.x = 5; carrier.y = 11;
  enemyTurnStarts(st, b);
  check(!risenFrom(b, raider) && raider.off, "a Carrier next to the carrier: the body on their shoulder does not get up");
  carrier.x = 30; carrier.y = 20;
  // Put it down, pick it up again, onto the strip and into the car.
  playerTurnStarts(st, b);
  A.ap = 2;
  check(combatAct(st, { type: "dropbody", unit: A.id }) === "" && A.carrying == null && !raider.off && Math.max(Math.abs(raider.x - A.x), Math.abs(raider.y - A.y)) <= 1 && A.mob === mob0, "put down: the body lies next to them again, their pace is back");
  check(combatAct(st, { type: "stowbody", unit: A.id }) !== "", "nothing to put in the car with empty hands");
  combatAct(st, { type: "pickup", unit: A.id, target: raider.id });
  playerTurnStarts(st, b); A.ap = 2;
  check(/strip/.test(combatAct(st, { type: "stowbody", unit: A.id })), "away from the strip the car is out of reach");
  const mv = combatAct(st, { type: "move", unit: A.id, x: 1, y: 10 });
  check(mv === "" && A.x === 1, `carried onto the evac strip (${mv || "moved"})`);
  const n0 = b.log.length;
  const sw = combatAct(st, { type: "stowbody", unit: A.id });
  check(sw === "" && raider.inVehicle && raider.off && A.carrying == null, `laid in the car (${sw || "done"}): “${logSince(b, n0)[0]}”`);
  // One of yours: B dies; A carries them to the car too.
  B.x = 2; B.y = 10;
  kill(b, B, carrier);
  playerTurnStarts(st, b); A.ap = 2;
  check(combatAct(st, { type: "pickup", unit: A.id, target: B.id }) === "" && A.carrying === B.id, `${first(A.name)} picks up ${first(B.name)}'s body`);
  check(combatAct(st, { type: "stowbody", unit: A.id }) === "" && B.inVehicle, "and lays it in the car");
  // A raider burnt on the field for good measure.
  const r2 = enemyUnit(b, b.rng, "raiders", 3, 12); r2.x = 8; r2.y = 8; b.units.push(r2); kill(b, r2);
  b.fires = [{ x: 8, y: 8, turns: 2 }];
  playerTurnStarts(st, b);
  b.fires = [];
  clearField(b);
  endBattleNow(st, "victory");
  check(!b.bodies.some((x) => x.name === raider.name || x.sid === sB.id || x.name === r2.name), "after the win neither body in the car (nor the burnt one) is on the loot screen");
  const cb = p.cargo.bodies || [];
  const cR = cb.find((x) => x.name === raider.name), cB = cb.find((x) => x.sid === sB.id);
  check(cb.length === 2 && !!cR && !!cB && cR.items.length > 0 && mineB.every((it) => cB.items.includes(it)), `two bodies ride home in the car: ${cb.map((x) => `${x.name} (${x.items.map((g) => g.name).join(", ") || "nothing"})`).join("; ")}`);
  check(!sB.alive && allItems(sB).length === 0 && mineB.every((it) => places(st, it) === 1) && !st.deathSites.some((d) => d.tile === b.tileId && d.items.some((e) => mineB.includes(e.item))), `${first(sB.name)}'s things are on the body in the car, nowhere else`);
  closeCombat(st);
  // Home: bury one (things to the armory), burn the other (nothing kept).
  const armory0 = h.armory.length;
  const n1 = st.log.length;
  bodiesHome(st, p, h);
  check((h.bodies || []).length === 2 && !(p.cargo.bodies || []).length && newLogs(st, n1).some((t) => /brought home/.test(t)), `at the base the bodies are laid out: “${newLogs(st, n1).find((t) => /brought home/.test(t))}”`);
  const hB = h.bodies.find((x) => x.sid === sB.id), hR = h.bodies.find((x) => x.name === raider.name);
  const msg = buryBody(st, h, hB.id);
  check(/buried/.test(msg) && h.bodies.length === 1 && mineB.every((it) => h.armory.includes(it)) && h.armory.length === armory0 + mineB.length, `bury: ${msg}`);
  const msg2 = burnBodyHome(st, h, hR.id);
  check(/burned/.test(msg2) && h.bodies.length === 0 && h.armory.length === armory0 + mineB.length, `burn: ${msg2} (the armory unchanged)`);
  // A body with the worm left unburied gets up at the base after a night.
  h.bodies.push({ id: 7777, name: "Stranger", sid: null, items: [newItem("knife", 1)], supplies: {}, worm: true, safe: false, armor: 1, day: day(st), arrived: day(st) - CARRIER.BASE_RISE });
  const people = atBase(st, h.id);
  const hp0 = people.map((s) => s.health);
  const n2 = st.log.length;
  walkingDaily(st);
  const body = h.bodies.find((x) => x.id === 7777);
  check(!!body && body.safe && people.some((s, i) => s.health < hp0[i]) && newLogs(st, n2).some((t) => /got up in the night/.test(t)), `left unburied with the worm in it, it gets up in the night and hurts someone before it is put down: “${newLogs(st, n2).find((t) => /got up in the night/.test(t))}”`);
  walkingDaily(st);
  check(h.bodies.length === 1 && /buried/.test(buryBody(st, h, 7777)) && h.armory.some((g) => g.key === "knife"), "put down, it lies still; buried, its knife goes to the armory");
}

section("In a raid: the body's container goes with the risen; the walking dead leave a body with the things in it");
{
  const st = createWorld({ seed: 7, factionCount: 4 });
  const h = hub(st);
  const tile = st.tiles.find((t) => t.loc && t.loc.type === "town" && t.id !== h.tile).id;
  const crew = atBase(st, h.id).slice(0, 3);
  const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 20, meds: 1 } }).party;
  p.path = [tile]; p.idx = 0; p.phase = "engaged";
  st.combat = createBattle(st, { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "carriertest", enemy: { kind: "zombies", count: 4, power: 3 }, raid: { heat0: 0 }, context: {} });
  const b = st.combat;
  const zs = b.units.filter((u) => u.kind === "zombie" && active(u) && !u.walking);
  applyZType(zs[0], "carrier", false, 3);
  const raider = enemyUnit(b, b.rng, "raiders", 3, 9);
  // Next to the Carrier, on a free tile.
  const cells = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]].map(([dx, dy]) => [zs[0].x + dx, zs[0].y + dy]).filter(([x, y]) => x >= 0 && y >= 0 && x < b.w && y < b.h && !b.units.some((u) => !u.dead && u.x === x && u.y === y));
  raider.x = cells[0][0]; raider.y = cells[0][1];
  b.units.push(raider);
  kill(b, raider);
  const box = b.raid.containers.find((c) => c.kind === "body" && c.uid === raider.id);
  check(!!box, "a raider killed in a raid leaves a body to search");
  enemyTurnStarts(st, b);
  const z = risenFrom(b, raider);
  check(!!z && z.bodyBox === box && !b.raid.containers.includes(box), "it gets up and its body (the container) goes with it");
  z.x = Math.min(b.w - 1, z.x + 1);
  kill(b, z);
  check(b.raid.containers.filter((c) => c === box).length === 1 && box.x === z.x && box.uid === z.id && !b.raid.containers.some((c) => c.uid === z.id && c !== box), `put down, the one body lies where it fell: “${box.label}”`);
  // One of the walking dead in a raid: put down, its body holds the things.
  const vest = newItem("vest", 0.8);
  const e = { id: 9002, name: "Stranger (turned)", who: "Stranger", sid: null, side: "enemy", kit: "raiders", weapon: null, armorKey: "vest", armor: 0.88, tile, day: day(st), items: [vest], supplies: { ammo: 3 }, met: 0 };
  walkingLoot(st).push(e);
  const zw = zs[1];
  markWalking(st, b, zw, e);
  kill(b, zw);
  const wbox = b.raid.containers.find((c) => c.uid === zw.id);
  check(!!wbox && wbox.contents && wbox.contents.gear.includes(vest) && wbox.contents.sup.ammo === 3 && !wbox.botSkip && e.items.length === 0, `put down, "${wbox ? wbox.label : "?"}" holds the vest and the rounds (the raid bot searches it)`);
  // Searched by hand: the vest is on the team now, nowhere else.
  const u = b.units.find((x) => x.side === "player" && active(x));
  playerTurnStarts(st, b);
  u.x = wbox.x; u.y = wbox.y; u.ap = 2;
  const se = combatAct(st, { type: "search", unit: u.id, box: wbox.id });
  const onTeam = b.units.some((x) => x.side === "player" && x.haul && x.haul.gear.includes(vest)) || st.survivors.some((s) => allItems(s).includes(vest));
  check(se === "" && !wbox.contents.gear.includes(vest) && onTeam, `searched (${se || "done"}): the vest is on the team, out of the body`);
  // Burnt in a raid: the container goes.
  const r3 = enemyUnit(b, b.rng, "raiders", 3, 10); r3.x = u.x; r3.y = Math.max(0, u.y - 1); b.units.push(r3); kill(b, r3);
  b.fires = [{ x: r3.x, y: r3.y, turns: 2 }];
  playerTurnStarts(st, b);
  b.fires = [];
  check(r3.burnt && !b.raid.containers.some((c) => c.uid === r3.id), "a body burnt in a raid is no container to search");
}

section("Whole battles with Carriers play out");
{
  let ended = 0, rose = 0, swarms = 0, crushed = 0, n = 0;
  for (const seed of [3, 5, 8, 21, 34]) {
    const st = createWorld({ seed, factionCount: 4 });
    const h = hub(st);
    const people = atBase(st, h.id).slice(0, 6);
    st.autoRetreat = false; // a test switch: fight it out
    st.combat = inBrowser(() => createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id), enemy: { kind: "mixed", count: 10, power: 3, types: { carrier: 3 } }, ambush: null, canRetreat: true, handler: "carriertest", context: {} }));
    const b = st.combat;
    for (let i = 0; i < 60 && !b.over; i++) { autoPlayerTurn(st); if (!b.over) runEnemyPhase(st); }
    n++;
    if (b.over) ended++;
    rose += b.units.filter((u) => u.turned).length;
    swarms += b.units.filter((u) => u.ztype === "swarm").length;
    crushed += b.units.filter((u) => u.crushed).length;
    if (b.over) closeCombat(st);
  }
  check(ended === n && swarms > 0 && rose > 0, `${ended} of ${n} battles (raiders and the dead, 3 Carriers among them) ended: ${rose} bodies got up, ${swarms} swarms burst out, ${crushed} skulls crushed by the battle AI`);
  // The raid bot with a Carrier about.
  const st = createWorld({ seed: 9, factionCount: 4 });
  const h = hub(st);
  const tile = st.tiles.find((t) => t.loc && t.loc.type === "town" && t.id !== h.tile).id;
  const crew = atBase(st, h.id).slice(0, 3);
  const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 20, meds: 1 } }).party;
  p.path = [tile]; p.idx = 0; p.phase = "engaged";
  st.combat = createBattle(st, { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "carriertest", enemy: { kind: "zombies", count: 6, power: 3 }, raid: { heat0: 30 }, context: {} });
  const b = st.combat;
  for (const z of b.units.filter((u) => u.kind === "zombie").slice(0, 2)) applyZType(z, "carrier", false, 3);
  for (let i = 0; i < 80 && !b.over; i++) { autoPlayerTurn(st); if (!b.over) runEnemyPhase(st); }
  check(b.over, `a raid with 2 Carriers ends (${b.result ? b.result.outcome : "still going"} after ${b.turn} turns)`);
  // A fight by the numbers with Carriers among the dead.
  const s2 = createWorld({ seed: 4, factionCount: 4 });
  const h2 = hub(s2);
  const ppl = atBase(s2, h2.id).slice(0, 4);
  const r = autoResolveCombat(s2, { tile: h2.tile, baseId: h2.id, fighterIds: ppl.map((s) => s.id), enemy: { kind: "zombies", count: 8, power: 3, types: { carrier: 2 } }, ambush: null, canRetreat: true, handler: "carriertest", context: {} });
  check(!!r && ["victory", "defeat", "retreat"].includes(r.outcome), `a fight by the numbers with 2 Carriers in 8 resolves (${r && r.outcome})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
