// Headless tactical combat test: AI plays both sides through the real engine.
// Catches crashes and endless battles, and reports win rates per matchup.
// Usage: node tools/combattest.js [battles per matchup] [seed] [weapons]
// "weapons": instead of the usual matchups, each team of three carries one weapon (Shooting 5–11) against 4 raiders
// (power 5) and 12 of the dead (power 2), and pistols with 2 throwables each against 16 of the dead: weapon balance.
// First, always: checks that guns use ammo and bows arrows on the battle map (a bow with none falls back to melee,
// about half the arrows are picked up again after a win, none after a retreat or a loss).
import { createWorld, makeSurvivor, combatPower, hub } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { newItem, stow } from "../src/sim/inventory.js";
import { active, createBattle, autoPlayerTurn, runEnemyPhase, closeCombat, registerCombatHandler, fire, canFire, combatAct, endBattleNow, ammoLeft, arrowsLeft, WEAPONS } from "../src/sim/combat.js";

const N = Number(process.argv[2] || 150);
const seed = Number(process.argv[3] || 7);
const state = createWorld({ seed, factionCount: 6 });
const base = hub(state);
let last = null;
registerCombatHandler("test", (st, result) => { last = result; });

const TERRAINS = ["plains", "forest", "hills", "suburb", "city", "mountain", "water"];
const LOCS = [null, null, "town", "farm", "gas", "police", "military", "mall", "prison", "quarry",
  "apartments", "pharmacy", "autoshop", "ranch", "cabin", "campground", "radiotower", "crashsite"];

function team(n, weapon = null, kit = []) {
  const rng = state.rng;
  const list = [];
  for (let i = 0; i < n; i++) {
    const s = makeSurvivor(state);
    s.skills.shooting = rng.int(5, 11);
    const w = weapon || rng.pick(["pistol", "pistol", "huntrifle", "shotgun"]);
    s.gear.weapon = { key: w, name: GEAR[w].name, quality: 1 };
    for (const k of kit || []) stow(s, newItem(k, 1));
    s.location = { kind: "base", baseId: base.id };
    state.survivors.push(s);
    list.push(s);
  }
  return list;
}

// One battle on a random tile. Returns { outcome, turns, ... }.
function battle(m) {
  const rng = state.rng;
  const tile = rng.pick(state.tiles.filter((t) => t.terrain !== "water" || rng.chance(0.2)));
  // Vary the battle map without touching the real world map.
  const fake = { ...tile, terrain: rng.pick(TERRAINS), road: rng.chance(0.4), infection: m.infection ?? 0 };
  const lt = rng.pick(LOCS);
  fake.loc = lt ? { type: lt, name: lt } : null;
  state.tiles[tile.id] = fake;
  const people = team(m.players, m.weapon, m.kit);
  const power = m.power === "match" ? people.reduce((a, s) => a + combatPower(s), 0) / m.enemy.count * (m.ratio || 1) : m.power;
  base.stock.ammo = 200;
  base.stock.arrows = 200; // the bows and crossbows shoot arrows (world.js usesArrows)
  base.stock.meds = 3;
  base.armory.length = 0; // what earlier battles left there (Molotovs, pipe bombs off the bodies) stays out of this one
  const setup = {
    tile: tile.id, baseId: base.id, fighterIds: people.map((s) => s.id),
    enemy: { ...m.enemy, power }, ambush: m.ambush || null, canRetreat: false, handler: "test", context: {},
  };
  state.combat = createBattle(state, setup);
  let guard = 0;
  while (!state.combat.over && guard++ < 60) {
    autoPlayerTurn(state);
    runEnemyPhase(state);
  }
  const b = state.combat;
  const timedOut = !b.over;
  if (timedOut && process.env.DEBUG) console.log(b.place, b.units.map((u) => `${u.side[0]}${u.kind[0]} ${u.x},${u.y} hp${Math.round(u.hp)} ${active(u) ? "A" : "-"}${u.aware ? "" : " unaware"}${u.fleeing ? " fleeing" : ""}`).join(" | "));
  if (timedOut) state.combat = null;
  else closeCombat(state);
  state.tiles[tile.id] = tile;
  const out = { outcome: timedOut ? "timeout" : last.outcome, turns: b.turn, dead: timedOut ? 0 : last.survivorsDead.length, ammo: b.ammoUsed, arrows: b.arrowsUsed || 0, reinf: b.reinf };
  // Clean up the test team so the world stays small.
  state.survivors = state.survivors.filter((s) => !people.includes(s));
  state.deathSites = [];
  state.cards = [];
  state.gameOver = false;
  return out;
}

const matchups = [
  { name: "3 vs 3 raiders, even power", players: 3, enemy: { kind: "raiders", count: 3 }, power: "match" },
  { name: "3 vs 3 raiders, even, you ambush", players: 3, enemy: { kind: "raiders", count: 3 }, power: "match", ambush: "player" },
  { name: "3 vs 3 raiders, even, they ambush", players: 3, enemy: { kind: "raiders", count: 3 }, power: "match", ambush: "enemy" },
  { name: "3 vs 4 raiders (power 5)", players: 3, enemy: { kind: "raiders", count: 4 }, power: 5 },
  { name: "3 vs 4 raiders (power 5), you ambush", players: 3, enemy: { kind: "raiders", count: 4 }, power: 5, ambush: "player" },
  { name: "3 vs 4 soldiers (power 7)", players: 3, enemy: { kind: "soldiers", count: 4 }, power: 7 },
  { name: "3 vs 4 zealots (power 5)", players: 3, enemy: { kind: "zealots", count: 4 }, power: 5 },
  { name: "3 vs 12 zombies (power 2)", players: 3, enemy: { kind: "zombies", count: 12 }, power: 2 },
  { name: "3 vs 12 zombies (power 2), they ambush", players: 3, enemy: { kind: "zombies", count: 12 }, power: 2, ambush: "enemy" },
  { name: "3 vs 12 zombies (power 2), you ambush", players: 3, enemy: { kind: "zombies", count: 12 }, power: 2, ambush: "player" },
  { name: "4 vs 6 mixed (power 4)", players: 4, enemy: { kind: "mixed", count: 6 }, power: 4 },
  { name: "3 vs 4 raiders (power 5), infected ground", players: 3, enemy: { kind: "raiders", count: 4 }, power: 5, infection: 0.8 },
  // A hive's special dead (zombietypes.js, hiveconst.js ZTYPES): the same 12 of the dead with some of each kind.
  { name: "3 vs 12 zombies (power 2), 4 runners", players: 3, enemy: { kind: "zombies", count: 12, types: { runner: 4 } }, power: 2 },
  { name: "3 vs 12 zombies (power 2), 2 brutes", players: 3, enemy: { kind: "zombies", count: 12, types: { brute: 2 } }, power: 2 },
  { name: "3 vs 12 zombies (power 2), 3 spitters", players: 3, enemy: { kind: "zombies", count: 12, types: { spitter: 3 } }, power: 2 },
  { name: "3 vs 12 zombies (power 2), 1 screamer", players: 3, enemy: { kind: "zombies", count: 12, types: { screamer: 1 } }, power: 2 },
  { name: "3 vs 12 zombies (power 2), 3 crawlers", players: 3, enemy: { kind: "zombies", count: 12, types: { crawler: 3 } }, power: 2 },
  // The armoured dead (deadsoldiers.js): soldiers at a National Guard base, riot police at a police station.
  { name: "3 vs 12 zombies (power 2), 5 dead soldiers", players: 3, enemy: { kind: "zombies", count: 12, types: { soldier: 5 } }, power: 2 },
  { name: "3 vs 12 zombies (power 2), 4 riot cops", players: 3, enemy: { kind: "zombies", count: 12, types: { riot: 4 } }, power: 2 },
  { name: "3 vs 12 zombies (power 2), 1 of each, elite", players: 3, enemy: { kind: "zombies", count: 12, types: { runner: 1, brute: 1, spitter: 1, screamer: 1, crawler: 1 }, elite: true }, power: 2 },
];

if (process.argv[4] === "weapons") {
  const W = ["knife", "baton", "bat", "prybar", "machete", "nailbat", "fireaxe", "sledge", "crossbow", "pistol", "revolver", "compbow", "xbow", "shotgun", "huntrifle", "leverrifle", "carbine", "ar"];
  matchups.length = 0;
  for (const w of W) {
    matchups.push({ name: `${w}: 3 vs 4 raiders (power 5)`, players: 3, enemy: { kind: "raiders", count: 4 }, power: 5, weapon: w });
    matchups.push({ name: `${w}: 3 vs 12 zombies (power 2)`, players: 3, enemy: { kind: "zombies", count: 12 }, power: 2, weapon: w });
  }
  matchups.push({ name: "pistol: 3 vs 16 zombies (power 2)", players: 3, enemy: { kind: "zombies", count: 16 }, power: 2, weapon: "pistol" });
  for (const k of ["molotov", "pipebomb", "flare", "smokegren"]) matchups.push({ name: `pistol + 2 ${k}: 3 vs 16 zombies`, players: 3, enemy: { kind: "zombies", count: 16 }, power: 2, weapon: "pistol", kit: [k, k] });
}

// ---------- guns use ammo, bows use arrows ----------
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
{
  // A compound bow and a 9mm against two raiders, fought from the base's stock: 10 rounds, 3 arrows.
  const arrowBattle = (arrows) => {
    const people = team(1, "compbow").concat(team(1, "pistol"));
    for (const s of people) s.skills.shooting = 9;
    base.stock.ammo = 10; base.stock.arrows = arrows; base.armory.length = 0;
    const setup = { tile: base.tile, baseId: base.id, fighterIds: people.map((s) => s.id), enemy: { kind: "raiders", count: 2, power: 3 }, ambush: null, canRetreat: true, handler: "test", context: {} };
    state.combat = createBattle(state, setup);
    const b = state.combat;
    const archer = b.units.find((u) => u.side === "player" && u.weapon === "compbow");
    const gunner = b.units.find((u) => u.side === "player" && u.weapon === "pistol");
    const foe = b.units.find((u) => u.side === "enemy");
    return { b, people, archer, gunner, foe };
  };
  const cleanUp = (people) => { state.combat = null; state.survivors = state.survivors.filter((s) => !people.includes(s)); state.deathSites = []; state.cards = []; state.gameOver = false; };
  check(WEAPONS.compbow.arrows === 1 && WEAPONS.xbow.arrows === 1 && WEAPONS.crossbow.arrows === 1 && !WEAPONS.compbow.ammo && !WEAPONS.pistol.arrows, "bows and crossbows shoot an arrow a shot, never ammo; guns never arrows");
  {
    const { b, people, archer, gunner, foe } = arrowBattle(3);
    check(archer && gunner && foe && canFire(b, archer) && canFire(b, gunner), "the archer and the gunner can shoot");
    const ammo0 = ammoLeft(b); // the base's 10 and the rounds the people carry (ammo.js: their starter boxes)
    fire(b, archer, foe);
    check(arrowsLeft(b) === 2 && ammoLeft(b) === ammo0 && b.arrowsUsed === 1 && b.ammoUsed === 0, `a bow shot spends an arrow and no ammo (arrows ${arrowsLeft(b)}, ammo ${ammoLeft(b)} of ${ammo0})`);
    fire(b, gunner, foe);
    check(ammoLeft(b) === ammo0 - 1 && arrowsLeft(b) === 2 && b.ammoUsed === 1, `a gunshot spends a round and no arrow (ammo ${ammoLeft(b)} of ${ammo0}, arrows ${arrowsLeft(b)})`);
    fire(b, archer, foe); fire(b, archer, foe);
    check(arrowsLeft(b) === 0 && !canFire(b, archer) && canFire(b, gunner), "out of arrows the bow cannot shoot; the gun still can");
    archer.ap = 2; b.phase = "player";
    const err = combatAct(state, { type: "shoot", unit: archer.id, target: foe.id });
    check(err === "Out of arrows." && arrowsLeft(b) === 0, `a shot ordered with no arrows is refused (${err})`);
    check(combatAct(state, { type: "overwatch", unit: archer.id }) !== "", "no overwatch with an empty quiver");
    const used = b.arrowsUsed;
    endBattleNow(state, "victory");
    check(b.result.arrowsUsed === used && b.result.arrowsBack === Math.round(used / 2) && base.stock.arrows === b.result.arrowsBack, `after a win about half the arrows shot are picked up again (${b.result.arrowsBack} of ${used}, stock ${base.stock.arrows})`);
    cleanUp(people);
  }
  {
    // With no arrows from the start the archer falls back to melee: the bots never loose one, and the gun keeps shooting.
    const { b, people, archer } = arrowBattle(0);
    let guard = 0;
    while (!b.over && guard++ < 40) { autoPlayerTurn(state); runEnemyPhase(state); }
    check(b.arrowsUsed === 0 && base.stock.arrows === 0, `a bow with no arrows never shoots (${b.arrowsUsed} arrows used)`);
    check(!b.log.some((l) => l.text.startsWith(`${archer.name} shoots`)), "the archer never shoots without arrows (melee, or nothing)");
    cleanUp(people);
  }
  for (const outcome of ["retreat", "defeat"]) {
    const { b, people, archer, foe } = arrowBattle(5);
    fire(b, archer, foe); fire(b, archer, foe);
    endBattleNow(state, outcome);
    check(b.result.arrowsUsed === 2 && b.result.arrowsBack === 0 && base.stock.arrows === 3, `after a ${outcome} no arrows are picked up (stock ${base.stock.arrows})`);
    cleanUp(people);
  }
  console.log(`Arrows on the battle map: ${fails ? `${fails} failed` : "all passed"}.`);
}

const t0 = performance.now();
let crashes = 0;
for (const m of matchups) {
  const tally = { victory: 0, defeat: 0, retreat: 0, timeout: 0 };
  let turns = 0, dead = 0, ammo = 0, arrows = 0, reinf = 0;
  for (let i = 0; i < N; i++) {
    try {
      const r = battle(m);
      tally[r.outcome]++;
      turns += r.turns; dead += r.dead; ammo += r.ammo; arrows += r.arrows; reinf += r.reinf;
    } catch (e) {
      crashes++;
      if (crashes < 4) console.error(`CRASH in "${m.name}":`, e.stack);
      state.combat = null;
    }
  }
  const pct = (k) => `${Math.round((tally[k] / N) * 100)}%`.padStart(4);
  console.log(`${m.name.padEnd(42)} win ${pct("victory")}  loss ${pct("defeat")}  timeout ${tally.timeout}  avg turns ${(turns / N).toFixed(1)}  deaths/battle ${(dead / N).toFixed(2)}  ammo ${(ammo / N).toFixed(0)}${arrows ? `  arrows ${(arrows / N).toFixed(0)}` : ""}  extra zombies ${(reinf / N).toFixed(1)}`);
}
console.log(`\n${matchups.length * N} battles in ${((performance.now() - t0) / 1000).toFixed(1)}s, ${crashes} crashes.`);
if (crashes || fails) process.exit(1);
