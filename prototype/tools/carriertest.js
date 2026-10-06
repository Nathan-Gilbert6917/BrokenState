// The Carrier and its worm swarm (src/sim/carriers.js; hiveconst.js CARRIER, ZTYPES carrier / swarm, GROWTHS.cyst).
// Checks:
//   - the worm cyst is the first special dead a hive breeds (tier 0, after its first pit), and its hordes carry Carriers
//   - a human body near a Carrier stirs and gets up after one player turn; one of the dead never does; a body farther
//     off does not; burning it or crushing its skull stops it
//   - an aware Carrier walks to a body and stirs it on its own turn; the full turn flow raises it
//   - a Carrier that dies bursts into a worm swarm; most bullets go through the swarm, blows and fire do not; with no
//     one to kill it sinks into the ground
//   - someone the swarm kills gets up (a raider at once, one of yours only if they bleed out)
//   - the risen wears what the person wore: one of yours in a plate carrier takes a share of every hit
//   - their things, never duplicated or lost: a team's fallen who got up and was put down is looted back ("Dana
//     (turned)"); still walking at the end, the things stay at the death site; a raider who got up is one body with
//     their kit; in a raid the body's container goes with the risen and lies where they fall
//   - whole battles with Carriers play out (the battle AI, the raid bot), and fights by the numbers weigh them
// Usage: node tools/carriertest.js
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import {
  createBattle, enemyUnit, damage, endPlayerTurn, runEnemyPhase, autoPlayerTurn, registerCombatHandler, active, combatAct, endBattleNow,
  closeCombat, autoResolveCombat,
} from "../src/sim/combat.js";
import { stirBodies, carrierRound, swarmArmor, crushable } from "../src/sim/carriers.js";
import { applyZType, typeStrength, mixWeight } from "../src/sim/zombietypes.js";
import { CARRIER, ZTYPES, GROWTHS } from "../src/sim/hiveconst.js";
import { growthWish, startGrowth, hiveMix } from "../src/sim/hivetech.js";
import { newItem, allItems, armorMult } from "../src/sim/inventory.js";
import { launchExpedition } from "../src/sim/parties.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); };
const section = (s) => console.log(`\n${s}`);
registerCombatHandler("carriertest", () => {});
const inBrowser = (fn) => { const had = "window" in globalThis; if (!had) globalThis.window = {}; try { return fn(); } finally { if (!had) delete globalThis.window; } };
const logSince = (b, n) => b.log.slice(n).map((l) => l.text);
const risenFrom = (b, c) => b.units.find((u) => u.turned && u.turned.from === c.id) || null;

// A battle on open ground: 3 of your people (a team away from home, or at the hub), a Carrier and 2 walkers, plus a
// raider. Everyone parked along the top row, unaware, until a check places them.
function arena(seed = 7, team = false) {
  const st = createWorld({ seed, factionCount: 4 });
  const h = hub(st);
  const people = atBase(st, h.id).slice(0, 3);
  let setup = { tile: h.tile, baseId: h.id, fighterIds: people.map((s) => s.id) };
  if (team) {
    const tile = st.tiles.find((t) => t.loc && t.loc.type === "town" && t.id !== h.tile).id;
    const p = launchExpedition(st, { memberIds: people.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 40, meds: 1 } }).party;
    p.path = [tile]; p.idx = 0; p.phase = "engaged";
    setup = { tile, partyId: p.id };
  }
  const b = inBrowser(() => createBattle(st, { ...setup, enemy: { kind: "zombies", count: 3, power: 3, types: { carrier: 1 } }, ambush: null, canRetreat: true, handler: "carriertest", context: {} }));
  st.combat = b;
  for (let i = 0; i < b.cells.length; i++) b.cells[i] = { k: "open", f: "grass" };
  b.losCache.fill(0);
  b.evacCols = 0;
  b.infection = 0;
  const raider = enemyUnit(b, b.rng, "raiders", 3, 9);
  raider.armorKey = "vest"; raider.armor = 0.8;
  b.units.push(raider);
  b.units.forEach((u, i) => { u.x = 1 + i * 2; u.y = 0; u.aware = false; });
  const ps = b.units.filter((u) => u.side === "player");
  const carrier = b.units.find((u) => u.ztype === "carrier");
  const walkers = b.units.filter((u) => u.kind === "zombie" && !u.ztype);
  return { st, b, ps, carrier, walkers, raider };
}
// The start of a player turn, and of the enemy's turn after it (combat.js startPlayerTurn / endPlayerTurn), as
// far as the worm goes.
const playerTurnStarts = (b) => { b.turn++; b.phase = "player"; stirBodies(b); };
const enemyTurnStarts = (st, b) => { b.phase = "enemy"; carrierRound(st, b); };

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
}

section("Bodies near a Carrier stir and get up; the dead never do");
{
  const { st, b, carrier, walkers, raider } = arena();
  carrier.x = 10; carrier.y = 10;
  raider.x = 12; raider.y = 11; // 2 tiles off
  walkers[0].x = 9; walkers[0].y = 10; // right next to it
  walkers[1].x = 16; walkers[1].y = 10; // far off, alive
  const far = enemyUnit(b, b.rng, "raiders", 3, 10);
  far.x = 14; far.y = 10; b.units.push(far); // 4 tiles off
  damage(b, raider, 999, null);
  damage(b, walkers[0], 999, null);
  damage(b, far, 999, null);
  check(raider.dead && walkers[0].dead && far.dead, "a raider 2 tiles from the Carrier, a walker next to it and a raider 4 tiles off are killed");
  let n0 = b.log.length;
  playerTurnStarts(b);
  check(raider.stir === b.turn && walkers[0].stir == null && far.stir == null, `the raider's body stirs (to rise after turn ${raider.stir}); the walker's and the far raider's do not`);
  check(logSince(b, n0).some((t) => /twitches/.test(t) && t.includes(raider.name)), `the log warns: “${logSince(b, n0).find((t) => /twitches/.test(t))}”`);
  n0 = b.log.length;
  enemyTurnStarts(st, b);
  const z = risenFrom(b, raider);
  check(!!z && active(z) && z.kind === "zombie" && z.name === `${raider.name} (turned)` && z.x === raider.x && z.y === raider.y && raider.off, `at the enemy's turn it gets up: ${z ? z.name : "nothing"} where the body lay (the body gone from the map)`);
  check(!!z && z.ap === CARRIER.RISE_AP && z.wild && z.reinforcement && z.weapon === "claws", `up with ${CARRIER.RISE_AP} action, teeth and nails (no gun), after anything living, not one of the enemy the battle began with`);
  check(!!z && Math.abs(z.armor - raider.armor) < 1e-9, `it wears the raider's vest: ×${z ? z.armor : "?"} of every hit`);
  check(!risenFrom(b, walkers[0]) && !risenFrom(b, far), "the walker never gets up again, nor the raider 4 tiles off");
  // Never twice: the risen killed lies still.
  damage(b, z, 999, null);
  playerTurnStarts(b); enemyTurnStarts(st, b);
  check(z.dead && !risenFrom(b, z) && b.units.filter((u) => u.turned).length === 1, "put down, the risen stays down (one of the dead now)");
}

section("Fire and a crushed skull stop it; the stirring is a turn's warning");
{
  const { st, b, ps, carrier, raider } = arena(11);
  const [A] = ps;
  carrier.x = 10; carrier.y = 10;
  raider.x = 11; raider.y = 10;
  const r2 = enemyUnit(b, b.rng, "raiders", 3, 10);
  r2.x = 10; r2.y = 11; b.units.push(r2);
  damage(b, raider, 999, null);
  damage(b, r2, 999, null);
  playerTurnStarts(b);
  check(raider.stir != null && r2.stir != null, "two raiders' bodies next to the Carrier stir");
  // Crush one (your person next to it, 1 action).
  A.x = 12; A.y = 10; A.ap = 2; A.aware = true;
  check(crushable(b, A).includes(raider), "your person next to a stirring body can crush its skull");
  const err = combatAct(st, { type: "crush", unit: A.id, target: raider.id });
  check(err === "" && raider.crushed && A.ap === 1, `Crush skull: 1 action (${err || "done"}), the body will not get up`);
  check(combatAct(st, { type: "crush", unit: A.id, target: r2.id }) !== "", "a body not next to them cannot be crushed");
  // The other one burns.
  b.fires = [{ x: r2.x, y: r2.y, turns: 3 }];
  b.phase = "player";
  enemyTurnStarts(st, b);
  check(!risenFrom(b, raider) && !risenFrom(b, r2) && r2.burnt, "the crushed body stays down; the burning one is cooked (no worms left)");
  b.fires = [];
}
{
  // The battle AI crushes a stirring body next to one of yours (none of the enemy next to them).
  const { st, b, ps, carrier, walkers, raider } = arena(12);
  carrier.x = 10; carrier.y = 10;
  raider.x = 12; raider.y = 10;
  for (const w of walkers) { w.x = 30; w.y = 20 + walkers.indexOf(w); }
  damage(b, raider, 999, null);
  playerTurnStarts(b);
  for (const p of ps) { p.x = 2; p.y = 20 + ps.indexOf(p); p.ap = 2; }
  ps[0].x = 13; ps[0].y = 11;
  st.autoRetreat = false;
  autoPlayerTurn(st);
  check(raider.crushed && !risenFrom(b, raider), "the battle AI crushes the skull of a stirring body next to one of yours");
}

section("A Carrier on its own turn walks to a body; the whole turn flow raises it");
{
  const { st, b, ps, carrier, walkers, raider } = arena(13);
  for (const p of ps) { p.x = 1; p.y = 20 + ps.indexOf(p); }
  for (const w of walkers) { w.x = 30; w.y = 1 + walkers.indexOf(w); }
  carrier.x = 20; carrier.y = 5; carrier.aware = true;
  raider.x = 15; raider.y = 8;
  damage(b, raider, 999, null);
  b.phase = "player";
  const t0 = b.turn;
  endPlayerTurn(st);
  runEnemyPhase(st);
  const near = Math.max(Math.abs(carrier.x - raider.x), Math.abs(carrier.y - raider.y));
  check(near <= CARRIER.RANGE && raider.stir === t0 + 1, `it walked to the raider's body (${near} tiles off now) and the body stirs, to get up after your turn ${raider.stir}`);
  check(!risenFrom(b, raider), "it has not got up yet: you get your turn first");
  for (const p of ps) p.ap = 0;
  endPlayerTurn(st);
  check(!!risenFrom(b, raider) && b.queue.includes(risenFrom(b, raider).id), "after your turn it gets up and acts in the enemy's turn");
  runEnemyPhase(st);
}

section("The worm swarm");
{
  const { st, b, ps, carrier, raider } = arena(17);
  const [A, B] = ps;
  carrier.x = 10; carrier.y = 10;
  A.x = 8; A.y = 10;
  let n0 = b.log.length;
  damage(b, carrier, 999, A, false, { how: "shot" });
  const w = b.units.find((u) => u.ztype === "swarm");
  check(carrier.dead && !!w && active(w) && w.x === 10 && w.y === 10 && w.name === "Worm swarm", `a Carrier killed bursts: ${w ? w.name : "nothing"} where it fell`);
  check(logSince(b, n0).some((t) => /bursts open/.test(t)), `the log: “${logSince(b, n0).find((t) => /bursts open/.test(t))}”`);
  check(!!w && w.mob > 3 && w.maxHp < carrier.maxHp && w.wild && w.reinforcement, `quick (${w.mob} tiles an action), weak (${w.maxHp} hp), after anything living`);
  let hp = w.hp;
  damage(b, w, 10, A, false, { how: "shot" });
  const shot = hp - w.hp;
  hp = w.hp;
  damage(b, w, 10, A, false, { how: "bash" });
  const blow = hp - w.hp;
  check(Math.abs(shot - 10 * CARRIER.SHOT) < 1e-6 && Math.abs(blow - 10 * CARRIER.BASH) < 1e-6 && swarmArmor({ how: "fire" }) === 1 && ZTYPES.swarm.burn > 1, `most of a bullet goes through it (10 → ${shot}), a blow does more (10 → ${blow}); fire burns it ${ZTYPES.swarm.burn}× as hot`);
  // Someone it kills gets up: a raider at once (next turn), one of yours only once they bleed out.
  raider.x = 11; raider.y = 10;
  damage(b, raider, 999, w);
  B.x = 9; B.y = 11;
  damage(b, B, 999, w);
  check(raider.dead && raider.wormed && B.down && !B.dead && B.wormed, "the swarm kills a raider and brings one of yours down: the worm is in both");
  carrier.x = 40; // (dead anyway)
  playerTurnStarts(b);
  check(raider.stir === b.turn && B.stir == null, "the raider's body stirs with no Carrier near; yours, only down, does not");
  enemyTurnStarts(st, b);
  check(!!risenFrom(b, raider), "the raider gets up");
  B.dead = true; B.down = true;
  playerTurnStarts(b);
  check(B.stir === b.turn, `${B.name} bleeds out: now the body stirs`);
  enemyTurnStarts(st, b);
  const zb = risenFrom(b, B);
  check(!!zb && zb.name === `${B.name.split(" ")[0]} (turned)` && B.off, `and gets up as ${zb ? zb.name : "nothing"}`);
  // With no one to kill it sinks.
  let turns = 0;
  for (let i = 0; i < 20 && active(w); i++) { playerTurnStarts(b); enemyTurnStarts(st, b); turns++; }
  check(!active(w) && w.sank && w.off, `left alone it sinks into the ground after ${turns} more turns (${CARRIER.SWARM_TURNS} in all)`);
}

section("The risen wear what the person wore; their things are never duplicated or lost");
{
  // A team away from home: the fallen's things are at their death site until their body is looted.
  const { st, b, ps, carrier, walkers, raider } = arena(19, true);
  const [A] = ps;
  const sA = survivorById(st, A.sid);
  sA.gear.armor = newItem("plate", 0.9);
  sA.gear.head = newItem("milhelmet", 0.8);
  const mine = allItems(sA);
  carrier.x = 10; carrier.y = 10;
  A.x = 11; A.y = 10;
  damage(b, A, 999, carrier);
  A.dead = true; // bled out
  raider.x = 9; raider.y = 10;
  damage(b, raider, 999, null);
  playerTurnStarts(b);
  enemyTurnStarts(st, b);
  const zA = risenFrom(b, A), zR = risenFrom(b, raider);
  const first = sA.name.split(" ")[0];
  check(!!zA && zA.name === `${first} (turned)` && !!zR, `${sA.name} gets up as ${zA ? zA.name : "nothing"}; the raider too`);
  check(!!zA && Math.abs(zA.armor - armorMult(sA)) < 1e-9 && zA.armor < 0.8, `in the plate carrier and helmet: ×${zA ? zA.armor.toFixed(2) : "?"} of every hit`);
  const hp = zA.hp;
  damage(b, zA, 20, null, false, { how: "melee" });
  check(Math.abs(hp - zA.hp - 20 * zA.armor) < 1e-6, `a 20-point blow does ${(hp - zA.hp).toFixed(1)}`);
  // Everything else dead; the battle won.
  for (const u of b.units) if (u.side === "enemy" && active(u) && u !== zA) { damage(b, u, 9999, null); }
  for (const u of b.units) if (u.ztype === "swarm" && active(u)) damage(b, u, 9999, null, false, { how: "blast" });
  damage(b, zA, 9999, null);
  check(b.units.every((u) => u.side !== "enemy" || !active(u)), "every one of the enemy is down");
  endBattleNow(st, "victory");
  const names = b.bodies.map((x) => x.name);
  check(names.includes(`${first} (turned)`) && !names.includes(sA.name), `the loot has "${first} (turned)" (their own body), no second one`);
  check(names.filter((n) => n.startsWith(raider.name)).length === 1 && names.includes(`${raider.name} (turned)`), `the raider is one body, "${raider.name} (turned)"`);
  const p = st.parties.find((x) => x.id === b.setup.partyId);
  // Each of the fallen's things is in exactly one place: on the team (cargo or someone's gear), still on them, or at
  // their death site.
  const where = (it) => {
    let n = 0;
    if (p.cargo && p.cargo.gear.includes(it)) n++;
    for (const s of st.survivors) if (allItems(s).includes(it)) n++;
    for (const d of st.deathSites) n += d.items.filter((e) => e.item === it).length;
    if (p.cargo && p.cargo.gear.some((g) => g.contents && g.contents.includes(it))) n++;
    return n;
  };
  const counts = mine.map(where);
  check(mine.length >= 2 && counts.every((n) => n === 1), `each of ${first}'s ${mine.length} things is in exactly one place after the loot (${counts.join(", ")}): ${mine.map((it) => it.name).join(", ")}`);
  const back = mine.filter((it) => p.cargo.gear.includes(it) || st.survivors.some((s) => s.alive && allItems(s).includes(it)));
  check(back.length >= 1, `put down and looted, the team has their things back (${back.map((it) => it.name).join(", ") || "none"}; what did not fit stays at the death site)`);
  const raiderBody = b.bodies.find((x) => x.name === `${raider.name} (turned)`);
  check(!!raiderBody && (b.result.loot.gear.some((g) => g.key === "vest") || (raiderBody.gear && raiderBody.gear.armor && raiderBody.gear.armor.key === "vest")), "the raider's vest came off the risen body");
  closeCombat(st);
}
{
  // Still walking when the battle ends: no body to loot; the things stay at the death site.
  const { st, b, ps, carrier } = arena(23, true);
  const [A] = ps;
  const sA = survivorById(st, A.sid);
  sA.gear.armor = newItem("vest", 0.9);
  const mine = allItems(sA);
  carrier.x = 10; carrier.y = 10;
  A.x = 11; A.y = 10;
  damage(b, A, 999, carrier);
  A.dead = true;
  playerTurnStarts(b);
  enemyTurnStarts(st, b);
  const zA = risenFrom(b, A);
  for (const u of b.units) if (u.side === "enemy" && active(u) && u !== zA) damage(b, u, 9999, null);
  for (const u of b.units) if (u.ztype === "swarm" && active(u)) damage(b, u, 9999, null, false, { how: "blast" });
  endBattleNow(st, "victory");
  const site = st.deathSites.find((d) => d.tile === b.tileId);
  check(!!zA && active(zA) && !b.bodies.some((x) => x.sid === A.sid), `${zA ? zA.name : "?"} still walks when it ends: no body of theirs to loot`);
  check(!!site && mine.every((it) => site.items.filter((e) => e.item === it).length === 1), `their things are at the death site, once each (${mine.map((it) => it.name).join(", ")})`);
  check(/still walking/.test(b.summary.join(" ")), `the summary: “${b.summary.find((l) => /still walking/.test(l))}”`);
  closeCombat(st);
}

section("In a raid: the body's container goes with the risen");
{
  const st = createWorld({ seed: 7, factionCount: 4 });
  const h = hub(st);
  const tile = st.tiles.find((t) => t.loc && t.loc.type === "town" && t.id !== h.tile).id;
  const crew = atBase(st, h.id).slice(0, 3);
  const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 20, meds: 1 } }).party;
  p.path = [tile]; p.idx = 0; p.phase = "engaged";
  st.combat = createBattle(st, { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "carriertest", enemy: { kind: "zombies", count: 3, power: 3 }, raid: { heat0: 0 }, context: {} });
  const b = st.combat;
  const zs = b.units.filter((u) => u.kind === "zombie" && active(u));
  applyZType(zs[0], "carrier", false, 3);
  const raider = enemyUnit(b, b.rng, "raiders", 3, 9);
  // Next to the Carrier, on a free tile.
  const cells = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]].map(([dx, dy]) => [zs[0].x + dx, zs[0].y + dy]).filter(([x, y]) => x >= 0 && y >= 0 && x < b.w && y < b.h && !b.units.some((u) => !u.dead && u.x === x && u.y === y));
  raider.x = cells[0][0]; raider.y = cells[0][1];
  b.units.push(raider);
  damage(b, raider, 999, null);
  const box = b.raid.containers.find((c) => c.kind === "body" && c.uid === raider.id);
  check(!!box, "a raider killed in a raid leaves a body to search");
  playerTurnStarts(b);
  enemyTurnStarts(st, b);
  const z = risenFrom(b, raider);
  check(!!z && z.bodyBox === box && !b.raid.containers.includes(box), "it gets up and its body (the container) goes with it");
  z.x = Math.min(b.w - 1, z.x + 1);
  damage(b, z, 999, null);
  check(b.raid.containers.filter((c) => c === box).length === 1 && box.x === z.x && box.uid === z.id && !b.raid.containers.some((c) => c.uid === z.id && c !== box), `put down, the one body lies where it fell: “${box.label}”`);
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
