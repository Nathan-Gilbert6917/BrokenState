// Tactical combat entry point. This is the shared contract between the conflict system and the
// XCOM-style combat engine. The engine may change everything inside this file except the
// exported API described below.
//
// setup = {
//   tile,                       // State Map tile where the fight happens
//   partyId?,                   // player team fighting (members = partyMembers)
//   baseId?,                    // or: player base being defended (fighters = people at the base)
//   fighterIds?,                // optional: only these survivors take part
//   enemy: {
//     kind: "raiders" | "soldiers" | "zealots" | "zombies" | "mixed",
//     count,                    // number of enemy units
//     power,                    // rough per-unit strength, same scale as world.combatPower (2–10)
//     factionId?,               // AI group they belong to, if any
//     name?,                    // display name, e.g. "Red Hand raiders"
//   },
//   ambush: "player" | "enemy" | null,  // who has the drop on whom
//   canRetreat: true,           // whether the player may leave the map
//   handler: "key",             // registered handler that applies the outcome
//   context: {},                // free data passed back to the handler
// }
//
// result = {
//   outcome: "victory" | "defeat" | "retreat",
//   enemiesKilled, enemiesLeft,
//   survivorsHurt: [ids], survivorsDead: [ids],
//   ammoUsed,
//   loot: { supplies: {}, gear: [] },  // dropped by dead enemies, already added to the party cargo / base stock
//   turns?, medsUsed?, extraKilled?    // optional extras from the tactical engine
// }
import { survivorById, alive, atBase, combatPower, hurt, log, skill, gearEffect, isNight } from "./world.js";
import { partyMembers, partyTile, partyCapacity, cargoLoad, cargoRoom, unitsThatFit, wipeParty } from "./parties.js";
import { noteGunfire } from "./fieldheat.js";
import { GEAR, SUPPLIES } from "./data.js";
import { wearAfterFight, wearSlot, itemDur, medKitBonus } from "./crafting.js";
import { armorMult, enemyBody, allyBody, bodyEmpty, takeAllBodies, leaveBodies, ARMOR_SLOTS, itemLoad, newItem, deadBodyFinds } from "./inventory.js";
import { rollAreaFind } from "./loot.js";
import { buzzAim } from "./comforts.js";
import { needsAim } from "./needs.js";
import { illnessAim } from "./health.js";
import { smokeAt, flareLit, fireStep, fireAt, burnRound, smokeBlocks, SMOKE, FLARE } from "./throwables.js";
import { siegeSetup, siegeAct, siegeAI, botSiege, afterMove, checkRams, isCrew, CLIMB_AIM, CREW_AIM } from "./siege.js"; // ladders, the ram, rocks from the walls
import { lureTurn, herded, shepherdTurn, botDecoy, lureEdge } from "./decoys.js"; // decoys, fire and the senses of the dead; the Shepherd
import { battlePerks, battleXp, rollBook, fightXp, hash01 } from "./skills.js";
import { battleRecord, friendAim, teamSpirit } from "./relations.js";
import { refitSenses } from "./stealth.js";
import { stealthSetup, stealthAct, stealthTurn, stealthAI, spotBodies, detectRange, shotNoise, searchCost, knockOut, battleCaptives, botStealth, botAttackThrow, botRetreatSmoke } from "./stealth.js";
import { deployAct, endDeploy } from "./deploy.js";
import { fallBack, tierEnemyTurn, tierPlayerTurn, tierAI, baseTiers } from "./interior.js";
import { capturePrisoners, captiveRecords } from "./prisoners.js";
import { fightByNumbers } from "./breakoff.js";
import { lockRaid, openLock, lockedLoot, raidLocksEnd, autoLock, lockTargets, lockedMsg, botDone } from "./locks.js";
import { applyZType, typeList, typeStrength, zRevealed, strikeBonus, zTick, zombieTurn, nextOfMix, mixList, siteList } from "./zombietypes.js"; // a hive's special dead
import { ZTYPES, MIDDEAD } from "./hiveconst.js";
import { ACID, acidAt, acidArmor, acidWeights, acidStep, acidRound, spitterBurst } from "./acid.js"; // a spitter's acid sac bursts when it dies
import { armorVs, stabsGap, ARMORED, armoredOf } from "./deadsoldiers.js"; // the armoured dead: soldiers, riot police
import { MEDS } from "./medfinds.js"; // how rare meds are
import { bonebackMult, afterHit, onDeath, climbOver, sowerRound, terrorRuns } from "./middead.js"; // the mid game's special dead
import { placeBodies, spotCheck, wakeNear, sleeperDies, burnBodies } from "./sleepers.js"; // bodies on the ground, the Sleepers among them
import { stirBodies, carrierRound, burst, swarmHit, swarmBite, crush, tapRefusal, tap, pickUp, putDown, stowBody, botCrush, turnedBody, walkingBody, walkingBox, walksOn, turnedName, turnedLine, dropBodyBox, endBodies, placeWalking } from "./carriers.js"; // the Carrier raises the human dead; its worm swarm; bodies carried, shot, burnt; the walking loot
import { hasWorm } from "./worm.js"; // the worm in a living person
import { fieldDims, raidDims, densify, coverTarget, spawnRules, clearEnough, fledFarEnough, raidAreaTypes, raidDeadScale, roomBoxes, RAID as RAID_SIZE, CONTACT } from "./battlesize.js"; // map sizes by context, cover, spawns, the anti-slog ends
// The third side (neutral survivors, military squads: wanderers.js brings them, thirdside.js runs them). Every hook
// below is marked "thirdside.js"; a battle without a third side takes exactly the old paths.
import { thirdFoes, enemyTargetsThird, hostilePair, thirdPlan, thirdSideHit, thirdSideUnit, placeThird, thirdResult } from "./thirdside.js";
import { folkTick, resolveBattleCards, dropBattleCards } from "./floorfolk.js"; // who holds the upper floors of a city building (the crawl)
import { isHardcore } from "./hardcore.js";
import { raidCarrySetup, autoTake, stashAll, raidHome, personalRoom, trunkSpace, atVehicle, setRefit, haulLoad, dropHaul, dropHeld } from "./raidloot.js"; // loot by hand: each survivor carries their own, the vehicle has a trunk
import { SEARCH, hideSome, revealHidden, quickRefusal, quickNoise, quickHurt, quickable, botPressed, takeFree } from "./search.js"; // full search (1 action) and the quick rummage
import { raidBuilding, buildingMap, buildingOptions, placeInterior, windowsNear, interiorIntro, BMAP, doorNoise, doorBroken, doorAct, peekSees, rewardMult, botEscape } from "./buildingmaps.js";

// Result handlers by key. Other modules register theirs while they load (conflicts.js, scavenge.js), which can be
// before this module's own body has run (the imports are circular), so the map is made on first use: a `var`
// with no initialiser is already usable then and is not reset when this line runs later.
var handlers; // eslint-disable-line no-var

export function registerCombatHandler(key, fn) {
  (handlers = handlers || new Map()).set(key, fn);
}

// Battle layouts by key (setup.layout): fn(b, ctx) is called twice while a battle is set up, with ctx.phase "map"
// (after the map is made, before anyone is placed: put defences, hive flesh) and "units" (after both sides are
// placed: add bosses, adjust units). Registered like the handlers (defences.js, hives.js).
var layouts; // eslint-disable-line no-var
export function registerBattleLayout(key, fn) {
  (layouts = layouts || new Map()).set(key, fn);
}

// People met inside a building (buildingmaps.js placeInterior, from wanderers.js interiorOccupants) by side. "hostile"
// groups are placed as the raid's guards (enemy units). A side with no handler ("neutral" survivors, "military"
// squads: TODO for the encounters work, which needs a side of their own that is neither yours nor the enemy's) is not
// placed; the raid lists it in b.raid.occupants.waiting. fn(state, b, group, place): group { side, people: [{ kit,
// weapon, power, name }], room, aware }, place { room (the raid area they hold), cells() (free cells there), pod() (a
// new alert group number) }; it adds its own units to b.units.
var occupantSides; // eslint-disable-line no-var
export function registerOccupantSide(side, fn) {
  (occupantSides = occupantSides || new Map()).set(side, fn);
}
export const occupantSide = (side) => (occupantSides ? occupantSides.get(side) || null : null);

// Turns the battle being set up so the attack comes from `side` (deploy.js, a break-in): base layouts are built
// with the attackers on the east edge; "west" mirrors the map, "north" / "south" turn it a quarter (13 wide × 18
// tall). Moves the cells and every unit; returns the cell mapping (x, y) → [x, y] for anything else to move.
export function transformBattle(b, side) {
  bindDims(b);
  b.side = side || "east";
  if (!side || side === "east") return (x, y) => [x, y];
  const W0 = W, H0 = H;
  const tf = side === "west" ? (x, y) => [W0 - 1 - x, y] : side === "north" ? (x, y) => [y, W0 - 1 - x] : (x, y) => [H0 - 1 - y, x];
  const nw = side === "west" ? W0 : H0, nh = side === "west" ? H0 : W0;
  const cells = new Array(nw * nh);
  for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) { const [nx, ny] = tf(x, y); cells[ny * nw + nx] = b.cells[y * W0 + x]; }
  W = nw; H = nh;
  b.w = nw; b.h = nh; b.cells = cells;
  b.losCache = new Int8Array(W * H * W * H);
  for (const u of b.units) { const [nx, ny] = tf(u.x, u.y); u.x = nx; u.y = ny; }
  const p = b.units.find((u) => u.side === "player");
  b.reach = flood(cells, p ? p.x : 0, p ? p.y : 0);
  return tf;
}

// Puts a new map (cells, w × h) under the battle being played (interior.js: the yard and buildings map). The units
// keep their coordinates; the caller moves them. b.reach is flooded from (rx, ry).
export function resizeBattle(b, w, h, cells, rx = 0, ry = 0) {
  W = w; H = h;
  b.w = w; b.h = h; b.cells = cells;
  b.losCache = new Int8Array(W * H * W * H);
  b.reach = flood(cells, rx, ry);
  b.acid = []; // acid pools (acid.js) stay on the old map
  b.corpses = []; // and the bodies lying about (sleepers.js)
  return b;
}
// The cells the player side can stand on, flooded from (x, y) (after the map changed).
export function floodReach(b, x, y) { bindDims(b); b.reach = flood(b.cells, x, y); syncFloor(b); return b.reach; }

// ---------- storeys (buildingmaps.js multi-storey buildings) ----------
// b.floors[f] = { cells, reach, losCache, name } for f = 0 (the ground) … b.raid.storeys − 1, every floor the same w × h
// as the ground map (an upper floor is "void" outside the building's footprint). b.floor is the active floor: b.cells,
// b.reach and b.losCache always alias its arrays, so everything that indexes the grid works on the floor being looked
// at. Units carry u.f; a unit on another floor is "away" (active / onMap are false for it). Containers carry c.f.
// Swaps the active floor; returns false when there is no such floor.
export function setFloor(b, f) {
  if (!b || !b.floors || !b.floors[f]) return false;
  bindDims(b);
  b.floor = f;
  const F = b.floors[f];
  if (!F.losCache) F.losCache = new Int8Array(W * H * W * H); // made when a floor is first looked at (saves stay smaller)
  b.cells = F.cells; b.reach = F.reach; b.losCache = F.losCache;
  for (const u of b.units) u.away = (u.f || 0) !== f;
  return true;
}
// After b.cells / b.reach / b.losCache were replaced on the active floor: the floor record keeps them.
function syncFloor(b) {
  if (!b || !b.floors) return;
  const F = b.floors[b.floor || 0];
  if (!F) return;
  F.cells = b.cells; F.reach = b.reach; F.losCache = b.losCache;
}
// Puts a unit on floor f at the same x, y (the stairs, a drift down the stairwell). The away flag follows.
export function moveToFloor(b, u, f) {
  u.f = f;
  u.away = !!b.floors && f !== (b.floor || 0);
  delete u.brace; // a braced door is let go of
}
// Which way the stairs lead from where a unit stands: { up, down }. Only on a stairwell cell ("stairs") of a building
// with storeys; the top floor's stairwell only leads down, the ground floor's only up; a stairwell cell that is taken
// on the other floor (someone standing or lying on it) is no way through.
export function stairOptions(b, u) {
  const none = { up: false, down: false };
  if (!b || !b.floors || !u) return none;
  const f = u.f || 0, F = b.floors[f];
  if (!F || F.cells[u.y * b.w + u.x].k !== "stairs") return none;
  const free = (g) => !!b.floors[g] && b.floors[g].cells[u.y * b.w + u.x].k === "stairs" && !b.units.some((o) => o !== u && (o.f || 0) === g && !o.dead && !o.left && !o.fled && !o.off && o.x === u.x && o.y === u.y);
  return { up: f + 1 < b.floors.length && free(f + 1), down: f > 0 && free(f - 1) };
}
// Players standing on floor f (anywhere in the building when f is null).
const playersOn = (b, f) => b.units.filter((u) => u.side === "player" && activeAny(u) && (f == null || (u.f || 0) === f));
// Once a turn, a floor with aware dead and no players sends one of them to the stairwell toward the nearest floor with
// players (down on a tie: the fight upstairs draws them up): it is marked (u.drift) and arrives on that floor's
// stairwell at the start of the next enemy phase (floorArrivals), if the cell is free. Heat is one number for the
// building, so the noise upstairs is what brings them.
function floorDrift(b) {
  if (!b.floors || !b.raid || !b.raid.stairs || !b.raid.stairs.length) return;
  const withPlayers = [];
  for (let f = 0; f < b.floors.length; f++) if (playersOn(b, f).length) withPlayers.push(f);
  if (!withPlayers.length) return;
  for (let f = 0; f < b.floors.length; f++) {
    if (withPlayers.includes(f)) continue;
    const dead = b.units.filter((u) => u.side === "enemy" && u.kind === "zombie" && u.aware && activeAny(u) && !u.drift && (u.f || 0) === f && !u.dormant);
    if (!dead.length) continue;
    let target = withPlayers[0];
    for (const g of withPlayers) if (Math.abs(g - f) < Math.abs(target - f) || (Math.abs(g - f) === Math.abs(target - f) && g > target)) target = g;
    const to = target > f ? f + 1 : f - 1;
    // The one nearest a stairwell goes.
    let best = null;
    for (const u of dead) for (const [sx, sy] of b.raid.stairs) { const d = Math.hypot(u.x - sx, u.y - sy); if (!best || d < best.d) best = { u, sx, sy, d }; }
    if (best) best.u.drift = { to, from: f, x: best.sx, y: best.sy, turn: b.turn };
  }
}
// The dead marked last turn step off the stairs on their new floor (if the stairwell there is free), paying the climb.
function floorArrivals(b) {
  if (!b.floors) return;
  for (const u of b.units) {
    if (!u.drift || !activeAny(u)) { if (u.drift && !activeAny(u)) delete u.drift; continue; }
    const d = u.drift;
    if (d.turn >= b.turn) continue; // marked this very phase: it arrives next turn
    const taken = b.units.some((o) => o !== u && (o.f || 0) === d.to && !o.dead && !o.left && !o.fled && !o.off && o.x === d.x && o.y === d.y);
    if (taken) {
      // The stairwell on the other floor is taken (someone standing on it): give the drift up for now and step off
      // the stairwell on this floor, so whoever stands there can come through; floorDrift may send it again next turn.
      if (u.x === d.x && u.y === d.y) stepAside(b, u);
      delete u.drift;
      continue;
    }
    u.x = d.x; u.y = d.y;
    moveToFloor(b, u, d.to);
    u.ap = Math.max(0, (u.ap ?? 2) - siegeRule(u).climb); // the dead pay CLIMB_DEAD: the stairs take their turn
    u.wp = null;
    delete u.drift;
    say(b, `${u.name} comes ${d.to > d.from ? "up" : "down"} the stairs.`, "danger");
  }
}
// A unit on its own floor steps to a free walkable cell next to it (off a stairwell), if there is one.
function stepAside(b, u) {
  const f = u.f || 0, F = b.floors ? b.floors[f] : null;
  const cells = F ? F.cells : b.cells;
  for (const [dx, dy] of DIRS8) {
    const x = u.x + dx, y = u.y + dy;
    if (!inside(x, y)) continue;
    const c = cells[idx(x, y)];
    if (!CELL[c.k].walk || c.k === "stairs" || barredCell(c)) continue;
    if (b.units.some((o) => o !== u && (o.f || 0) === f && !o.dead && !o.left && !o.fled && !o.off && o.x === x && o.y === y)) continue;
    u.x = x; u.y = y;
    return true;
  }
  return false;
}

export function combatants(state, setup) {
  let list = [];
  if (setup.partyId) {
    const p = state.parties.find((x) => x.id === setup.partyId);
    list = p ? partyMembers(state, p) : [];
  } else if (setup.baseId) list = atBase(state, setup.baseId);
  if (setup.fighterIds) list = list.filter((s) => setup.fighterIds.includes(s.id));
  return list;
}

// Opens a fight. With no browser (headless tools) or state.autoCombat, it resolves instantly.
// In the browser it sets state.combat to a live battle; the combat screen plays it out.
export function startCombat(state, setup) {
  // Nobody left to fight it (the team died or went home while the battle waited its turn): no battle, no result.
  if (!combatants(state, setup).length) {
    dropSetup(state, setup);
    return state.combat || null;
  }
  if (state.autoCombat || typeof window === "undefined") {
    const result = autoResolveCombat(state, setup);
    finishCombat(state, setup, result);
    return null;
  }
  if (state.combat) {
    (state.combatQueue = state.combatQueue || []).push(setup);
    return state.combat;
  }
  state.combat = createBattle(state, setup);
  return state.combat;
}

// A battle that cannot happen is dropped without a result. A team that still exists with nobody alive is closed
// properly (what it carried stays at a death site, parties.js wipeParty).
function dropSetup(state, setup) {
  const p = setup.partyId ? state.parties.find((x) => x.id === setup.partyId) : null;
  if (p && p.owner === "player" && !partyMembers(state, p).length) wipeParty(state, p);
}

export function finishCombat(state, setup, result) {
  const battle = state.combat && state.combat.setup === setup ? state.combat : null; // played on a map
  state.combat = null;
  dropBattleCards(state); // floorfolk.js: a card raised over this fight has nothing to ask any more
  // The shots fired go on the map (fieldheat.js noteGunfire: a camp near the fight is more dangerous for a day or
  // two): a played battle's count, else the rounds the people used and as many again from armed enemies.
  {
    const party = setup.partyId ? state.parties.find((x) => x.id === setup.partyId) : null;
    const base = setup.baseId ? state.bases.find((x) => x.id === setup.baseId) : null;
    const tile = battle ? battle.tileId : party ? partyTile(party) : base ? base.tile : tileIdOf(setup);
    const armed = setup.enemy && setup.enemy.kind !== "zombies" ? Math.min(30, (setup.enemy.count || 0) * 2) : 0;
    noteGunfire(state, tile, battle ? battle.gunshots || 0 : ((result && result.ammoUsed) || 0) + armed);
  }
  // Makeshift gear loses durability with every fight (a raid only if someone was killed). A battle played on the
  // map has already worn what its units took the field with (wearFielded, when the battle ended); one resolved by
  // the numbers wears everyone who was counted in it.
  if (!(result && result.worn) && (setup.mode !== "raid" || (result && result.enemiesKilled))) wearAfterFight(state, combatants(state, setup));
  battleRecord(state, setup, result, battle, combatants(state, setup)); // relations.js: kills, downed, rescues, shared hardship
  capturePrisoners(state, setup, result, battle); // prisoners.js: the knocked out go with the team or into the cells
  const fn = handlers && handlers.get(setup.handler);
  // While the handler runs, the team is between a battle and its aftermath (conflicts.js releaseStranded skips it).
  state.resolving = (state.resolving || 0) + 1;
  try {
    if (fn) fn(state, result, setup, battle); // battle: the map it was played on, or null (citycrawl.js keeps a building as it was left)
  } finally {
    state.resolving -= 1;
  }
  while (!state.combat && state.combatQueue && state.combatQueue.length) startCombat(state, state.combatQueue.shift());
}

// Is a battle for this team open or waiting its turn?
export function battlePending(state, partyId) {
  return !!(state.combat && state.combat.setup.partyId === partyId) || (state.combatQueue || []).some((s) => s.partyId === partyId);
}

// The odds of a fight by the numbers: { mine, theirs, ratio, win }. mine: the people's combat power (× 0.6 short of
// ammo, × their team spirit, × 1.4 when they struck first), theirs: the enemy's count × power (× walls, × special dead,
// × 1.4 when they struck first). win: winOdds(ratio, enemy) (the chance to win it fought out).
export function byNumbersOdds(state, setup, people = combatants(state, setup), ammoOk = true) {
  let mine = people.reduce((a, s) => a + combatPower(s), 0) * (ammoOk ? 1 : 0.6) * teamSpirit(state, people); // friends and rivals (relations.js)
  mine *= 1 + lureEdge(setup.enemy, carriedKeys(state, setup, people)); // decoys.js: decoys and Molotovs against the dead (not a Shepherd's pack)
  let theirs = setup.enemy.count * setup.enemy.power * (setup.enemy.fortified || 1) * typeStrength(setup.enemy); // fortified: behind their walls (conquest.js); types: a hive's special dead (zombietypes.js)
  if (setup.ambush === "player") mine *= 1.4;
  if (setup.ambush === "enemy") theirs *= 1.4;
  if (setup.allyPower) mine += setup.allyPower; // thirdside.js: soldiers or survivors fighting the same enemy (wanderers.js)
  const ratio = mine / Math.max(0.1, theirs);
  return { mine, theirs, ratio, win: winOdds(ratio, { ...setup.enemy, people: people.length, ambush: setup.ambush, hive: setup.layout === "hive" }) };
}
// The keys of everything a fight's people carry, and their team's cargo (decoys.js lureEdge).
function carriedKeys(state, setup, people) {
  const out = [];
  for (const s of people) {
    for (const it of Object.values(s.gear || {})) if (it) { out.push(it.key); for (const c of it.contents || []) if (c) out.push(c.key); }
    for (const it of s.pockets || []) if (it) out.push(it.key);
  }
  const p = setup.partyId ? state.parties.find((x) => x.id === setup.partyId) : null;
  for (const it of (p && p.cargo && p.cargo.gear) || []) if (it) out.push(it.key);
  return out;
}
// The chance to win a fight by the numbers, calibrated on the tactical map (tools/calibrate.js: the AI playing both
// sides, fought out): a logistic of the power ratio (squad over enemy, the 1.4 for striking first included), with
// how many fight on each side for people (numbers tell more than power in a gunfight: 3 against 5 weak raiders is
// a coin flip), the dead weaker per point of power than people (they come at you in the open), a mixed crowd in
// between, and a little for the brood in a hive (it comes through the gaps of the mound). enemy: { kind, count,
// people (how many fight for you), ambush ("player" / "enemy"), hive }. Clamped to 3–97%.
export const ODDS = { RATIO: 3.77, NUMBERS: 1.85, ZOMBIES: 2.52, MIXED: 1.74, HIVE: 0.25, THEY_AMBUSH: 0.33, YOU_AMBUSH: -0.23, MIN: 0.03, MAX: 0.97 };
export function winOdds(ratio, enemy = null) {
  const e = enemy || {};
  const dead = e.kind === "zombies";
  let z = ODDS.RATIO * Math.log(Math.max(0.01, ratio));
  if (!dead && e.people > 0 && e.count > 0) z += ODDS.NUMBERS * Math.log(e.people / e.count);
  if (dead) z += ODDS.ZOMBIES;
  else if (e.kind === "mixed") z += ODDS.MIXED;
  if (e.hive) z += ODDS.HIVE;
  if (e.ambush === "enemy") z += ODDS.THEY_AMBUSH;
  if (e.ambush === "player") z += ODDS.YOU_AMBUSH;
  return Math.max(ODDS.MIN, Math.min(ODDS.MAX, 1 / (1 + Math.exp(-z))));
}

// Quick statistical resolution, used headless and as a fallback.
export function autoResolveCombat(state, setup) {
  const people = combatants(state, setup);
  const party = setup.partyId ? state.parties.find((x) => x.id === setup.partyId) : null;
  const base = setup.baseId ? state.bases.find((b) => b.id === setup.baseId) : null;
  if (!people.length) {
    // Nobody to fight: no dice, no losses on either side.
    return { outcome: "defeat", enemiesKilled: 0, enemiesLeft: setup.enemy.count, survivorsHurt: [], survivorsDead: [], ammoUsed: 0, loot: { supplies: {}, gear: [] } };
  }
  // A team shoots from what it packed and from ammo it found on the way (the same two pools as a tactical battle).
  const pools = party ? [party.supplies, party.cargo ? party.cargo.supplies : {}] : base ? [base.stock] : [{}];
  const have = pools.reduce((a, o) => a + Math.max(0, Math.floor(o.ammo || 0)), 0);
  const ammoUsed = Math.min(have, people.length * 6);
  let owed = ammoUsed;
  for (const o of pools) {
    const t = Math.min(owed, Math.max(0, Math.floor(o.ammo || 0)));
    if (t > 0) o.ammo -= t;
    owed -= t;
  }
  const odds = byNumbersOdds(state, setup, people, ammoUsed >= people.length * 3);
  const ratio = odds.ratio;
  const tile = party ? partyTile(party) : tileIdOf(setup);
  // Defending a base (interior.js baseTiers): the walls, the yard and the buildings each multiply what the defenders
  // are worth; the battle is won at the tier where they first match the attackers, or lost (overrun). Base defences
  // have no break-off: falling back is the tiers themselves.
  const tiers = setup.layout === "baseDefence" && base ? baseTiers(state, base, setup, ratio) : null;
  if (!tiers) {
    // breakoff.js: the fight plays out in rounds, and a team in the field breaks it off by its retreat policy.
    const refund = (n) => { if (pools[0]) pools[0].ammo = (pools[0].ammo || 0) + n; };
    return fightByNumbers(state, setup, people, { win: odds.win, ammoUsed, refund, tile });
  }
  const rng = state.rng;
  const win = rng.chance(winOdds(tiers ? tiers.last : ratio, { ...setup.enemy, people: people.length }));
  const tier = tiers ? (win ? tiers.tier : "overrun") : null;
  const hurtIds = [], deadIds = [];
  // A base held at the wall costs less blood than one held in the yard, and a last stand in the buildings costs most.
  const half = Math.ceil(people.length / 2);
  const hits = !win ? rng.int(1, people.length) : tier === "wall" ? rng.int(0, Math.ceil(people.length / 3)) : tier === "buildings" ? rng.int(1, half + 1) : rng.int(0, half);
  const [lo, hi] = !win ? [25, 75] : tier === "buildings" ? [15, 50] : [10, 40];
  for (let i = 0; i < hits && people.length; i++) {
    const s = rng.pick(people);
    if (!s.alive) continue;
    hurt(state, s, rng.int(lo, hi), tile, `in a fight with ${setup.enemy.name || setup.enemy.kind}`);
    (s.alive ? hurtIds : deadIds).push(s.id);
  }
  const killed = win ? setup.enemy.count : Math.floor(setup.enemy.count * rng.range(0.1, 0.5));
  fightXp(state, people, win); // skills.js: Shooting XP for everyone who fought
  return {
    outcome: win ? "victory" : "defeat",
    enemiesKilled: killed, enemiesLeft: setup.enemy.count - killed,
    survivorsHurt: hurtIds, survivorsDead: deadIds, ammoUsed,
    loot: { supplies: {}, gear: [] },
    ...(tiers ? { tier, tiers: { wall: tiers.wall, yard: tiers.yard, last: tiers.last } } : {}),
  };
}

const tileIdOf = (setup) => (setup.tile && typeof setup.tile === "object" ? setup.tile.id : setup.tile);

// ======================================================================================
// Tactical engine
// ======================================================================================

export const MAP_W = 18, MAP_H = 13; // a base's wall map (deploy.js), and the scale the field layouts were drawn at
// Battle map sizes (battlesize.js SIZES, by context): an encounter in the field is Medium (FIELD_W × FIELD_H) growing to
// Large with the people and the dead on it (genMap scales its layout from 18 × 13 to the map), a hive assault Large
// (HIVE_W × HIVE_H). A layout can set its own (registerBattleSize: a base's wall map, sized to its buildings).
export const FIELD_W = 32, FIELD_H = 24, HIVE_W = 40, HIVE_H = 30; // battlesize.js SIZE_CLASSES Medium and Large
var sizes; // eslint-disable-line no-var
export function registerBattleSize(key, fn) {
  (sizes = sizes || new Map()).set(key, fn);
}
export function battleSize(state, setup) {
  const fn = setup && setup.layout && sizes ? sizes.get(setup.layout) : null;
  const s = fn ? fn(state, setup) : null;
  return s && s[0] > 0 && s[1] > 0 ? s : fieldDims(state, setup || {});
}
// Current battle size. Only one battle runs at a time; createBattle / createRaid set these.
let W = MAP_W, H = MAP_H;
// The grid helpers below read W and H: every entry point that takes a battle points them at that battle's own size
// first, so a battle made in between (another world, a raid, a turned deploy map) never leaves the wrong ones.
const bindDims = (b) => { if (b && b.w && b.h) { W = b.w; H = b.h; } };
export const MOVE = 5, ZOMBIE_MOVE = 3, ZOMBIE_FAST = 4; // tiles per action point (zombies: the middle ground between the old 4/5 and the halved 2/3, review C-10)
const SIGHT = 13, ZOMBIE_SIGHT = 9;
export const COVER_DEF = [0, 20, 40];     // aim penalty for no / half / full cover
export const HUNKER_DEF = 20;
// A critical hit (shots and melee, both sides; the chances are in shotOdds / meleeOdds): × this damage, and through a
// dead soldier's or riot cop's armour (deadsoldiers.js armorVs).
export const CRIT_MULT = 2;
// The critical chances (%): a shot at someone with no cover (EXPOSED), at one of the dead in the open (DEAD), at
// anyone in cover (COVER), a melee blow (MELEE); an overwatch reaction never. Deadeye adds 15 to a shot (skills.js),
// the Assassin perk makes a blow on the unaware always critical. Lowered from 40 / 15 / 5 / 10 (a crit is ×2).
export const CRIT = { EXPOSED: 25, DEAD: 10, COVER: 5, MELEE: 8 };
const BLEED_TURNS = 3;
const MAX_PLAYERS = 8, MAX_ENEMIES = 20;

// walk: can stand there. cover: 0 none, 1 half, 2 full. los: blocks line of sight (up to tall, 1 by default: a
// viewer high enough sees over it, verticality below). h: the height a unit standing there is raised to (a cell can
// set its own c.h). climb: a ladder or stairs, the only way from one height to the next. bar: closed to the attackers
// until it is broken (its hit points are on the cell: c.hp / c.mhp; c.bar does the same for one cell, a base's gate).
// A cell can also block sight on its own with c.t (a base's wall: the defenders shoot over it from the walkway).
export const CELL = {
  open:    { walk: true,  cover: 0, los: false, name: "Open ground" },
  tree:    { walk: false, cover: 2, los: true,  name: "Tree", tall: 2 },
  boulder: { walk: false, cover: 2, los: true,  name: "Boulder" },
  wall:    { walk: false, cover: 2, los: true,  name: "Wall" },
  truck:   { walk: false, cover: 2, los: true,  name: "Burnt-out truck" },
  window:  { walk: false, cover: 1, los: false, name: "Window" },
  rock:    { walk: false, cover: 1, los: false, name: "Rock" },
  car:     { walk: false, cover: 1, los: false, name: "Car" },
  fence:   { walk: false, cover: 1, los: false, name: "Fence" },
  hay:     { walk: false, cover: 1, los: false, name: "Hay bales" },
  crate:   { walk: false, cover: 1, los: false, name: "Crates" },
  sandbag: { walk: false, cover: 1, los: false, name: "Sandbags" },
  pump:    { walk: false, cover: 1, los: false, name: "Fuel pump" },
  water:   { walk: false, cover: 0, los: false, name: "Water" },
  // Raid containers and props.
  shelf:   { walk: false, cover: 1, los: false, name: "Shelves" },
  locker:  { walk: false, cover: 2, los: true,  name: "Lockers" },
  cabinet: { walk: false, cover: 1, los: false, name: "Cabinet" },
  counter: { walk: false, cover: 1, los: false, name: "Counter" },
  vehicle: { walk: false, cover: 2, los: true,  name: "Your vehicle" },
  // Base defences against hordes and the inside of a hive (defences.js, hives.js). trap: what happens to one of
  // the dead that steps in (spikes hurt, a trench stops it for the turn).
  barricade: { walk: false, cover: 2, los: false, name: "Barricade" },
  spikes:    { walk: true,  cover: 0, los: false, name: "Spike pit", trap: "spikes" },
  trench:    { walk: true,  cover: 0, los: false, name: "Trench", trap: "trench" },
  // From the armory's defence kit (defences.js armoryDefence): wire stops the dead like the trench, a bear trap
  // hurts and holds the first one to step in (then it is sprung).
  wire:      { walk: true,  cover: 0, los: false, name: "Barbed wire", trap: "wire" },
  beartrap:  { walk: true,  cover: 0, los: false, name: "Bear trap", trap: "beartrap" },
  hivewall:  { walk: false, cover: 2, los: true,  name: "Hive flesh", tall: 2 },
  // A locked door in a raid (locks.js): blocks movement and sight until it is opened (then it is open floor).
  door:      { walk: false, cover: 2, los: true,  name: "Locked door" },
  // The base's wall line on a break-in map (deploy.js): the defenders shoot over it from the walkway behind it (the
  // wall's cells block sight from the ground, c.t) and the attackers batter it (c.hp) or come in through the gate
  // and the breaches. A tower (a watchtower, height 2) is full cover from anything not right next to it.
  palisade:  { walk: false, cover: 2, los: false, name: "Wall" },
  gate:      { walk: true,  cover: 0, los: false, name: "Gate" },
  breach:    { walk: true,  cover: 0, los: false, name: "Breach in the wall" },
  tower:     { walk: true,  cover: 0, los: false, name: "Watchtower", perch: 2, h: 2, climb: true },
  // Verticality and the base's buildings (deploy.js, interior.js).
  walkway:   { walk: true,  cover: 0, los: false, name: "Wall walkway", h: 1 },
  ladder:    { walk: true,  cover: 0, los: false, name: "Ladder", climb: true },
  stairs:    { walk: true,  cover: 0, los: false, name: "Stairs", climb: true },
  roof:      { walk: true,  cover: 0, los: false, name: "Flat roof", h: 1 },
  loft:      { walk: true,  cover: 0, los: false, name: "Upper floor", h: 1 },
  // An upper storey's cells outside the building's footprint (buildingmaps.js multi-storey floors): open air. Nothing
  // stands there, nothing hides behind it, and sight passes (you look out of the windows).
  void:      { walk: false, cover: 0, los: false, name: "Open air" },
  bdoor:     { walk: true,  cover: 0, los: true,  name: "Barred door", bar: true },
  doorway:   { walk: true,  cover: 0, los: false, name: "Broken door" },
  smashed:   { walk: true,  cover: 0, los: false, name: "Smashed window" },
  rubble:    { walk: true,  cover: 0, los: false, name: "Rubble" },
  well:      { walk: false, cover: 1, los: false, name: "Well" },
  barrel:    { walk: false, cover: 1, los: false, name: "Rain barrels" },
  // Building interiors (buildingmaps.js): a closed door blocks sight until someone walks through it (moveAlong opens
  // it: odoor; a roller door is loud to haul up), tall shelving blocks sight (sneak down the aisles), tables, beds and
  // cell bars are half cover you see over or through.
  // A closed door is barred to the dead (they batter it: its hit points) and to people while someone braces it;
  // people otherwise open it (doorOpens), which ends their move.
  idoor:     { walk: true,  cover: 0, los: true,  name: "Closed door", bar: true },
  odoor:     { walk: true,  cover: 0, los: false, name: "Open door" },
  rack:      { walk: false, cover: 2, los: true,  name: "Shelving" },
  table:     { walk: false, cover: 1, los: false, name: "Table" },
  bed:       { walk: false, cover: 1, los: false, name: "Bed" },
  bars:      { walk: false, cover: 1, los: false, name: "Cell bars" },
  // A siege ladder set against a wall section (siege.js): the wall cell becomes a climb up to height 1, onto the
  // walkway behind it; whoever is on it stands exposed. Its wall stays a wall for sight from the ground (c.t).
  siegeladder: { walk: true, cover: 0, los: false, name: "Siege ladder", h: 1, climb: true },
};

// Verticality (base battles): a unit on higher ground sees SIGHT tiles further a level, aims AIM better a level at
// anything lower (at most MAX_AIM) and has at least half cover against shooters below it that are not right next to
// it. Climbing a level (only on a ladder, stairs or a tower's own ladder, never diagonally) costs CLIMB moves, the
// dead CLIMB_DEAD. A blow struck up at someone higher is MELEE_UP harder. EYE: eye height over the floor (sight lines).
export const HEIGHT = { SIGHT: 2, AIM: 5, MAX_AIM: 10, COVER: 1, CLIMB: 1, CLIMB_DEAD: 2, MELEE_UP: 10, EYE: 0.6 };
// Battering a door, a window, the gate or a wall section (base battles): the cost in tiles the AI weighs it at.
export const SIEGE = { COST: 2, PER_HP: 0.4 };
// Battering and climbing by the kind of unit (base battles): bash multiplies its blows against a structure, climb is
// the moves a level up or down. Looked up by its kind, then its variant (more kinds of the dead slot in here: a
// "variant" or "zkind" key on the unit), then its boss; anything not listed takes its kind's.
export const UNIT_SIEGE = {
  human: { bash: 1, climb: HEIGHT.CLIMB }, zombie: { bash: 1, climb: HEIGHT.CLIMB_DEAD },
  wallbreaker: { bash: 3, climb: 3 }, broodmother: { bash: 2, climb: 3 },
};
export const siegeRule = (u) => ({ bash: 1, climb: HEIGHT.CLIMB, ...(u && UNIT_SIEGE[u.kind]), ...(u && UNIT_SIEGE[u.variant || u.zkind]), ...(u && UNIT_SIEGE[u.boss]) });

// Weapon stats in battle, keyed like GEAR. opt = best range; fall = aim lost per tile beyond it.
export const WEAPONS = {
  fists:     { name: "Fists",          melee: true, dmg: [6, 10] },
  knife:     { name: "Kitchen knife",  melee: true, dmg: [14, 22] },
  machete:   { name: "Machete",        melee: true, dmg: [20, 30] },
  claws:     { name: "Teeth and nails", melee: true, dmg: [12, 20] },
  // The 9mm: 15–22 and +4 aim. A walker in the open (29 hit points at power 2) falls to any two hits (bar two 15s)
  // or a critical (×2), so against the dead the aim is what counts: damage alone barely moves three pistols against 16
  // of them (14–21: 68%, 18–27: 69%), +4 aim takes them to about 72%. Against people the damage counts, and raiders
  // carry pistols too (KITS), so every gun's odds against them move with it: at 14–21 +0 three pistols beat 4 raiders
  // 24% to the revolver's 40%; at 15–22 +4 about 30% to its 35% (3000–4000 battles a matchup, crits 25 / 10 / 5 / 8);
  // 16–24 +4 overtook the revolver (33% to 32%).
  pistol:    { name: "9mm pistol",     dmg: [15, 22], opt: 6,  fall: 4, aim: 4,  ammo: 1, noise: 2 },
  shotgun:   { name: "Pump shotgun",   dmg: [24, 36], opt: 4,  fall: 7, aim: 10, ammo: 1, noise: 3, close: 10 },
  huntrifle: { name: "Hunting rifle",  dmg: [24, 34], opt: 12, fall: 2, aim: 5,  ammo: 1, noise: 3, close: -10 },
  ar:        { name: "Assault rifle",  dmg: [22, 32], opt: 9,  fall: 3, aim: 8,  ammo: 2, noise: 3 },
  // Makeshift weapons (crafting.js). The crossbow reuses its bolts (no ammo) and is silent.
  spikedbat:  { name: "Spiked bat",        melee: true, dmg: [16, 25] },
  pipespear:  { name: "Pipe spear",        melee: true, dmg: [15, 23] },
  sawmachete: { name: "Saw-blade machete", melee: true, dmg: [17, 27] },
  crossbow:   { name: "Scrap crossbow",    dmg: [18, 26], opt: 7, fall: 4, aim: -4, ammo: 0, noise: 0 },
  pipegun:    { name: "Pipe shotgun",      dmg: [20, 32], opt: 3, fall: 8, aim: -6, ammo: 1, noise: 3, close: 8 },
  // Found weapons with a role each: clubs for takedowns (stealth.js CLUB), the heavy hitters, quiet bows that need no
  // ammo, a loud hard-hitting revolver, a handy ranch rifle, the police carbine. meleeAim: to hit in melee (sledge).
  bat:        { name: "Baseball bat",      melee: true, dmg: [15, 24] },
  nailbat:    { name: "Nail bat",          melee: true, dmg: [20, 31] },
  prybar:     { name: "Crowbar",           melee: true, dmg: [16, 25] },
  fireaxe:    { name: "Fire axe",          melee: true, dmg: [21, 32] },
  sledge:     { name: "Sledgehammer",      melee: true, dmg: [25, 38], meleeAim: -10 },
  baton:      { name: "Police baton",      melee: true, dmg: [12, 19] },
  compbow:    { name: "Compound bow",      dmg: [17, 26], opt: 7, fall: 5, aim: -2, ammo: 0, noise: 0, close: -5 },
  xbow:       { name: "Hunting crossbow",  dmg: [20, 29], opt: 6, fall: 5, aim: 0, ammo: 0, noise: 0, close: -5 },
  revolver:   { name: ".357 revolver",     dmg: [20, 30], opt: 5, fall: 5, aim: -2, ammo: 1, noise: 3 },
  leverrifle: { name: "Lever-action rifle", dmg: [20, 30], opt: 10, fall: 2.5, aim: 4, ammo: 1, noise: 3 },
  carbine:    { name: "Police carbine",    dmg: [20, 29], opt: 9, fall: 3, aim: 7, ammo: 1, noise: 3 },
  // A spitter's acid (zombietypes.js): silent, every `cooldown` turns, cover counts `pierce` steps less against it.
  acid:       { name: "Acid spit",         dmg: [16, 22], opt: 4, fall: 8, aim: 0, ammo: 0, noise: 0, acid: true, cooldown: ZTYPES.spitter.cooldown, pierce: ZTYPES.spitter.pierce },
};
const BASH = [8, 12]; // hitting someone with a gun
export const BODY_FINDS = 0.2; // a person's body: the chance of one small thing in their pockets (KITS finds)

// loot = spare gear a body may carry; pack = [pack key, chance] a body wears one; finds = the small things in their
// pockets (valuables, smokes, a throwable; 20% a body) (inventory.js enemyBody).
export const KITS = {
  raiders:  { label: "Raider",  aim: 3, hp: 5,  weapons: ["pistol", "pistol", "shotgun", "huntrifle", "machete", "revolver"], strong: ["shotgun", "ar", "huntrifle"], armor: [null, null, "vest"], loot: ["pistol", "shotgun", "machete", "huntrifle", "vest", "spikedbat", "tirevest", "bikehelmet", "kneeguards", "revolver", "nailbat", "slingbag", "molotov", "pipebomb"], pack: ["backpack", 0.15],
              finds: ["cigarettes", "cigarettes", "smokes", "smokes", "vodka", "whiskey", "goldchain", "goldring", "watch", "lighters", "molotov", "tobacco"] },
  soldiers: { label: "Soldier", aim: -6, hp: -10, weapons: ["ar", "ar", "huntrifle", "shotgun", "carbine"], strong: ["ar"], armor: ["vest", "plate"], loot: ["ar", "plate", "vest", "nvg", "milradio", "riothelmet", "smokegren", "frag", "rucksack", "camonet", "binoculars", "thermal"], pack: ["assaultpack", 0.3],
              finds: ["cigarettes", "chocolate", "chocolate", "instcoffee", "smokegren", "flare", "frag", "heatpack", "batteries", "cards", "photos"] },
  zealots:  { label: "Zealot",  aim: 0, hp: 5,  weapons: ["shotgun", "pistol", "machete", "fireaxe", "huntrifle"], strong: ["shotgun", "huntrifle"], armor: [null], loot: ["machete", "shotgun", "pistol", "knife", "fireaxe", "molotov", "compbow"], fearless: true,
              finds: ["candles", "candles", "molotov", "photos", "tea", "honey"] },
  // People of the other group types (conflicts.js KIND_OF). All human: "mixed" is only for humans plus the dead.
  fighters: { label: "Fighter", aim: 3, hp: 5,  weapons: ["pistol", "shotgun", "huntrifle", "huntrifle", "machete", "leverrifle"], strong: ["ar", "shotgun", "huntrifle"], armor: [null, null, "vest"], loot: ["pistol", "shotgun", "huntrifle", "machete", "vest", "kneeguards", "leverrifle", "prybar", "hikingpack"], pack: ["backpack", 0.15],
              finds: ["smokes", "chocolate", "batteries", "lighters", "photos", "cards", "flare"] },
  guards:   { label: "Guard",   aim: 2, hp: 0,  weapons: ["pistol", "pistol", "shotgun", "huntrifle", "revolver"], strong: ["shotgun", "huntrifle"], armor: [null, null, "vest"], loot: ["pistol", "shotgun", "knife", "vest", "bikehelmet", "baton", "cuffs", "riotarms"], pack: ["backpack", 0.3],
              finds: ["smokes", "instcoffee", "cards", "cuffs", "flare", "watch"] },
  militia:  { label: "Militia", aim: 0, hp: 0,  weapons: ["huntrifle", "shotgun", "pistol", "machete", "pipespear", "leverrifle", "bat"], strong: ["huntrifle", "shotgun"], armor: [null], loot: ["huntrifle", "machete", "knife", "pipespear", "padding", "leverrifle", "bat"],
              finds: ["smokes", "tobacco", "photos", "harmonica", "chocolate", "honey"] },
  // Loose survivors on their own (wanderers.js): the aggressive ones who rob like raiders, and neutrals on the map.
  survivors: { label: "Survivor", aim: -4, hp: -5, weapons: ["knife", "bat", "prybar", "pistol", "pistol", "revolver", "huntrifle", "shotgun"], strong: ["shotgun", "huntrifle"], armor: [null, null, null, "vest"], loot: ["knife", "bat", "prybar", "pistol", "revolver", "slingbag", "flashlight", "bikehelmet", "tirevest"], pack: ["backpack", 0.25],
              finds: ["photos", "photos", "cigarettes", "lighters", "chocolate", "candy", "watch", "goldring", "batteries"] },
};

const idx = (x, y) => y * W + x;
const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const cellAt = (b, x, y) => CELL[b.cells[idx(x, y)].k];
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
// off: an attacker still outside, waiting to come in through a breach (interior.js): not on the map yet.
// away: on another storey than the active one (a multi-storey building, b.floors: setFloor keeps the flag): off this
// floor's map, so it is neither seen, shot, bumped into nor moved by this floor's turn. Every unit has u.f (its floor,
// 0 by default); u.away is exactly (u.f !== b.floor), kept by setFloor and the floor changes (goup / godown).
export const active = (u) => !u.dead && !u.down && !u.left && !u.fled && !u.off && !u.away;
const onMap = (u) => !u.dead && !u.left && !u.fled && !u.off && !u.away;
// Standing somewhere in the building, whatever its floor (the turn flow, the end of a raid; the renderer's unit strip).
export const activeAny = (u) => !u.dead && !u.down && !u.left && !u.fled && !u.off;
// The floor a unit stands on, and whether it is on another floor than the one being looked at (the renderer's markers).
export const unitFloor = (u) => u.f || 0;
export const onOtherFloor = (b, u) => !!(b && b.floors) && (u.f || 0) !== (b.floor || 0);
// Height of a cell (verticality), whether it is closed to the attackers, a ladder, and something that can be battered.
export const heightAt = (b, x, y) => { const c = b.cells[y * b.w + x]; return c.h ?? CELL[c.k].h ?? 0; };
const hAt = (b, x, y) => { const c = b.cells[idx(x, y)]; return c.h ?? CELL[c.k].h ?? 0; };
export const barredCell = (c) => !!(c.bar || CELL[c.k].bar) && !(c.hp <= 0);
// A building's closed door (buildingmaps.js): people open it unless someone braces it from the other side; the dead
// never do (they batter it down). Is someone bracing this door cell?
export function doorHeld(b, c) {
  if (c.held == null) return false;
  const h = b.units.find((o) => o.id === c.held);
  return !!(h && active(h) && h.brace && b.cells[h.brace[1] * b.w + h.brace[0]] === c);
}
const doorOpens = (b, u, c) => c.k === "idoor" && !!u && u.kind === "human" && !doorHeld(b, c);
const climbAt = (b, x, y) => !!CELL[b.cells[idx(x, y)].k].climb;
export const breakable = (c) => c.hp > 0;
export const unitAt = (b, x, y) => b.units.find((u) => onMap(u) && u.x === x && u.y === y);
export const unitById = (b, id) => b.units.find((u) => u.id === id);
// The evac strip: the left evacCols columns, or b.evacMask (a cell mask, deploy.js: base battles turned to face the
// attack get theirs on the side away from it, b.evacSide) when there is one; then the cell's y is needed.
export const inEvac = (b, x, y) => b.evacCols > 0 && (b.evacMask ? y != null && !!b.evacMask[y * b.w + x] : x < b.evacCols);
const bump = (b) => { b.rev++; if (b.rams && b.rams.length) checkRams(b); trackGhosts(b); };

export function say(b, text, k = "info") {
  b.log.push({ turn: b.turn, text, k });
  if (b.log.length > 80) b.log.shift();
}
export function fx(b, e) {
  e.seq = ++b.fxSeq;
  if (b.floors) e.f = b.floor || 0; // the floor it happened on (the renderer shows the active floor's)
  b.fx.push(e);
  if (b.fx.length > 40) b.fx.shift();
}

// ---------- supplies (party or base) ----------
const pool = (b, k) => b.pools.reduce((s, o) => s + Math.max(0, Math.floor(o[k] || 0)), 0);
function take(b, k, n) {
  for (const o of b.pools) {
    const t = Math.min(n, Math.max(0, Math.floor(o[k] || 0)));
    o[k] = (o[k] || 0) - t;
    n -= t;
    if (n <= 0) break;
  }
}
export const ammoLeft = (b) => pool(b, "ammo");
export const medsLeft = (b) => pool(b, "meds");

/// ---------- battle map ----------
// The field map. Its layouts were drawn for 18 × 13 and are scaled to the battle's size (FIELD_W × FIELD_H): fixed
// columns and rows by the width and height, how many things are scattered by the area, and on a bigger map a few
// more buildings where there are buildings.
function genMap(rng, tile, opts = {}) {
  const t = tile || { terrain: "plains" };
  const floor = { plains: "grass", forest: "grass", hills: "dirt", mountain: "gravel", suburb: "grass", city: "rubble", water: "grass" }[t.terrain] || "grass";
  const cells = Array.from({ length: W * H }, () => ({ k: "open", f: floor }));
  const at = (x, y) => (inside(x, y) ? cells[idx(x, y)] : null);
  const free = (x, y) => { const c = at(x, y); return c && c.k === "open"; };
  const put = (x, y, k, f) => { const c = at(x, y); if (c) { c.k = k; if (f) c.f = f; } };
  const fx = W / MAP_W, fy = H / MAP_H, area = fx * fy;
  const X = (v) => Math.round(v * fx), Y = (v) => Math.round(v * fy), N = (n) => Math.round(n * area);
  const rx = (lo = 3, hi = W - 4) => rng.int(lo, hi);
  const scatter = (k, n, lo = 3, hi = W - 4) => {
    // Crates may go indoors; everything else stays outside.
    for (let i = 0; i < N(n); i++) { const x = rx(lo, hi), y = rng.int(0, H - 1); if (free(x, y) && at(x, y).f !== "road" && (k === "crate" || at(x, y).f !== "floor")) put(x, y, k); }
  };
  // Sparse cover inside the deployment zones so nobody starts in the open.
  const edgeCover = (k, n) => { scatter(k, n, 1, X(3)); scatter(k, n, W - 1 - X(3), W - 2); };
  const rectFree = (x0, y0, w, h) => {
    for (let y = y0 - 1; y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++) if (inside(x, y) && (at(x, y).k !== "open" || at(x, y).f === "road")) return false;
    return x0 >= 0 && y0 >= 0 && x0 + w <= W && y0 + h <= H;
  };
  let built = 0;
  const building = (w, h, lo = X(4), hi = W - X(5) - w) => {
    for (let tries = 0; tries < 25; tries++) {
      const x0 = rng.int(lo, Math.max(lo, hi)), y0 = rng.int(0, H - h);
      if (!rectFree(x0, y0, w, h)) continue;
      const edge = [];
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        const border = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
        put(x, y, border ? "wall" : "open", "floor");
        const corner = (x === x0 || x === x0 + w - 1) && (y === y0 || y === y0 + h - 1);
        if (border && !corner && inside(x + (x === x0 ? -1 : x === x0 + w - 1 ? 1 : 0), y + (y === y0 ? -1 : y === y0 + h - 1 ? 1 : 0))) edge.push([x, y]);
      }
      rng.shuffle(edge);
      const doors = w * h > 30 ? 3 : 2;
      edge.slice(0, doors).forEach(([x, y]) => put(x, y, "open", "floor"));
      edge.slice(doors, doors + rng.int(1, 3)).forEach(([x, y]) => put(x, y, "window"));
      built++;
      return true;
    }
    return false;
  };
  const fenceLine = (x0, y0, len, horiz, k = "fence") => {
    for (let i = 0; i < len; i++) {
      const x = horiz ? x0 + i : x0, y = horiz ? y0 : y0 + i;
      if (free(x, y) && at(x, y).f !== "road" && at(x, y).f !== "floor" && !rng.chance(0.18)) put(x, y, k);
    }
  };

  // Road strip with wrecks.
  if (t.road) {
    const r = rng.int(Y(5), Y(7));
    for (let x = 0; x < W; x++) for (const y of [r, r + 1]) put(x, y, "open", "road");
    for (let i = 0; i < Math.round(rng.int(2, 4) * fx); i++) { const x = rx(X(4), W - X(5)), y = rng.pick([r, r + 1]); put(x, y, rng.chance(0.3) ? "truck" : "car"); }
  }
  // River for water tiles: a band with a couple of fords.
  if (t.terrain === "water") {
    const c = rng.int(X(8), X(9));
    const fords = [rng.int(Y(1), Y(4)), rng.int(Y(8), Y(11))];
    for (let y = 0; y < H; y++) for (const x of [c, c + 1]) if (!fords.some((f) => Math.abs(f - y) <= 0) && at(x, y).f !== "road") put(x, y, "water");
  }

  const type = t.loc ? t.loc.type : null;
  switch (type) {
    case "town": building(5, 4); building(4, 4); scatter("car", 3); fenceLine(rx(), rng.int(1, H - 2), X(4), true); break;
    case "farm": building(6, 4); fenceLine(rx(X(3), X(6)), rng.int(1, Y(3)), X(8), true); fenceLine(rx(X(3), X(6)), rng.int(Y(9), Y(11)), X(8), true); scatter("hay", 6); break;
    case "gas": building(4, 3); scatter("pump", 3, X(6), X(11)); scatter("car", 2); break;
    case "mall": building(8, 5); scatter("car", 6); break;
    case "hospital": case "univ": case "factory": building(7, 5); scatter("crate", 4); scatter("car", 2); break;
    case "police": building(5, 4); scatter("car", 4); scatter("crate", 2); break;
    case "military": building(5, 4); fenceLine(rx(X(5), X(7)), rng.int(1, Y(4)), X(6), true, "sandbag"); fenceLine(rx(X(5), X(7)), rng.int(Y(8), Y(11)), X(6), true, "sandbag"); scatter("truck", 2); scatter("crate", 3); break;
    case "prison": building(6, 5); fenceLine(X(5), 0, Y(9), false); fenceLine(X(12), Y(2), Y(9), false); break;
    case "airport": scatter("truck", 3); scatter("crate", 4); scatter("car", 2); break;
    case "dam": for (let x = 0; x < W; x++) if (free(x, 0)) put(x, 0, "water"); building(5, 3); break;
    case "quarry": scatter("boulder", 6); scatter("rock", 8); for (const c of cells) if (c.f === floor) c.f = "dirt"; break;
    // Map site types (mapgen.js): big city blocks, small shops, garages, farms, cabins, open-air sites.
    case "apartments": case "office": case "supermarket": case "school": case "warehouse": case "hardware": building(7, 5); scatter("car", 3); scatter("crate", 3); break;
    case "pharmacy": case "gunstore": case "grocery": case "diner": case "motel": case "church": case "clinic": case "feedstore":
      building(5, 4); building(4, 3); scatter("car", 2); fenceLine(rx(), rng.int(1, H - 2), X(4), true); break;
    case "autoshop": case "firestation": case "truckstop": building(5, 4); scatter("truck", 2); scatter("car", 3); scatter("crate", 2); break;
    case "ranch": case "barn": building(6, 4); fenceLine(rx(X(3), X(6)), rng.int(1, Y(3)), X(8), true); fenceLine(rx(X(3), X(6)), rng.int(Y(9), Y(11)), X(8), true); scatter("hay", 5); break;
    case "cabin": case "lodge": case "ranger": building(4, 3); scatter("crate", 2); break;
    case "campground": case "crashsite": scatter("crate", 4); scatter(type === "crashsite" ? "truck" : "car", 2); break;
    case "radiotower": building(3, 3); fenceLine(rx(X(4), X(8)), rng.int(Y(2), Y(10)), X(6), true); scatter("crate", 2); break;
    default: break;
  }
  // A bigger map has room for a few more buildings around a site that has them (a shed, a house, an outbuilding).
  const sited = built;
  for (let i = 0; i < Math.round(sited * (area - 1) * 0.5); i++) building(rng.int(4, 5), rng.int(3, 4));
  const blocks = fieldBlocks(area); // a bigger map: more blocks of houses in a suburb or a city
  switch (t.terrain) {
    case "forest": scatter("tree", 30); scatter("rock", 5); edgeCover("tree", 3); break;
    case "hills": scatter("rock", 14); scatter("boulder", 5); edgeCover("rock", 3); break;
    case "mountain": scatter("boulder", 12); scatter("rock", 10); edgeCover("boulder", 2); break;
    case "suburb": for (let i = 0; i < blocks; i++) { building(5, 4); building(4, 3); if (area > 1.6) building(5, 4); fenceLine(rx(), rng.int(0, H - 1), X(5), rng.chance(0.5)); } scatter("car", 3); scatter("tree", 5); edgeCover("car", 1); edgeCover("tree", 2); break;
    case "city": for (let i = 0; i < blocks; i++) { building(6, 4); building(5, 4); building(4, 3); if (area > 1.6) { building(6, 5); building(4, 4); } } scatter("car", 4); scatter("truck", 2); scatter("crate", 4); edgeCover("crate", 2); break;
    default: scatter("rock", 5); scatter("tree", 6); edgeCover("rock", 2); edgeCover("tree", 1); break;
  }
  if (type === "farm" || type === "ranch") for (const c of cells) if (c.f === "grass") c.f = "field";
  // Most open ground with cover within a few tiles, whatever the map's size (battlesize.js densify).
  if (opts.densify !== false) densify(cells, W, H, rng, { target: coverTarget(t.terrain) }); // not on a base's wall map (its own ground)

  // Every open cell must connect to both deployment zones; carve a lane if not.
  const mid = Math.floor(H / 2);
  for (let tries = 0; tries < 3; tries++) {
    const r = flood(cells, 0, mid);
    if (r[idx(W - 1, mid)]) return { cells, reach: r };
    for (let x = 0; x < W; x++) if (cells[idx(x, mid + tries - 1)].k !== "open") cells[idx(x, mid + tries - 1)].k = "open";
  }
  return { cells, reach: flood(cells, 0, mid) };
}

// Blocks of houses in a suburb or a city: one on the old 26 × 18 map (area 2 at the 18 × 13 scale), more on bigger ones.
const fieldBlocks = (area) => Math.max(1, Math.round(area / 2.2));

function flood(cells, sx, sy) {
  const seen = new Uint8Array(W * H);
  if (!CELL[cells[idx(sx, sy)].k].walk) cells[idx(sx, sy)].k = "open";
  const q = [idx(sx, sy)];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop(), x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny)) continue;
      const j = idx(nx, ny);
      if (!seen[j] && CELL[cells[j].k].walk) { seen[j] = 1; q.push(j); }
    }
  }
  return seen;
}

// ---------- geometry ----------
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Line of sight between cell centers. Full-cover cells block it; grazing a corner does not. With heights (base
// battles) the line runs from eye to eye (the cell's height + EYE at each end) and a cell only blocks it where the
// line passes below its top: a blocking cell's top is its tall (1 by default; a base's wall c.t), a raised floor's
// its height (a walkway, a roof). So someone on a walkway or a roof sees over a wall near them, but not into the
// dead ground right behind a wall near the target; a watchtower sees over almost everything one storey high.
export function los(b, x0, y0, x1, y1) {
  bindDims(b);
  const a = idx(x0, y0), c = idx(x1, y1);
  const v = b.losCache[a * W * H + c];
  if (v) return v === 1;
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 4);
  const e0 = hAt(b, x0, y0) + HEIGHT.EYE, e1 = hAt(b, x1, y1) + HEIGHT.EYE;
  let clear = true;
  for (let i = 1; i < n && clear; i++) {
    const px = x0 + 0.5 + (dx * i) / n, py = y0 + 0.5 + (dy * i) / n;
    const cx = Math.floor(px), cy = Math.floor(py);
    if ((cx === x0 && cy === y0) || (cx === x1 && cy === y1)) continue;
    const cell = b.cells[idx(cx, cy)], C = CELL[cell.k];
    const top = cell.t || (C.los ? C.tall || 1 : C.walk ? cell.h ?? C.h ?? 0 : 0);
    if (!top || e0 + ((e1 - e0) * i) / n > top) continue;
    const fx = px - cx, fy = py - cy;
    if (fx > 0.12 && fx < 0.88 && fy > 0.12 && fy < 0.88) clear = false;
  }
  b.losCache[a * W * H + c] = b.losCache[c * W * H + a] = clear ? 1 : 2;
  return clear;
}

// How far a unit sees from where it stands: its sight (night, a flashlight, night vision: stealth.js), +HEIGHT.SIGHT
// a level up, + optics (binoculars, a thermal at night: u.optic, stealth.js).
export const sightRange = (b, a, x = a.x, y = a.y) => a.sight + HEIGHT.SIGHT * hAt(b, x, y) + (a.optic || 0);
// Can a unit see a cell? Light shows your people what stands in it out to the full daylight range, however dark: a
// flare (throwables.js) and, at night, a floodlit cell (deploy.js).
export function canSeeAt(b, a, x, y) {
  bindDims(b);
  const d = dist(a.x, a.y, x, y);
  if (d > sightRange(b, a)) {
    if (a.side !== "player") return false;
    const lit = (b.flares && b.flares.length && flareLit(b, x, y)) || (b.night && b.floodAim && b.lit && b.lit[idx(x, y)]);
    if (!lit || d > SIGHT + HEIGHT.SIGHT * hAt(b, a.x, a.y) + (a.optic || 0)) return false;
  }
  return los(b, a.x, a.y, x, y) && !(b.smoke && b.smoke.length && smokeBlocks(b, a.x, a.y, x, y)); // a fire's thick smoke (throwables.js)
}
// A crawler low in the grass is hidden from your people until it is close, lit or has struck (zombietypes.js).
export const canSee = (b, a, t) => !(t.low && a.side === "player" && !zRevealed(b, t)) && canSeeAt(b, a, t.x, t.y);

// Cover a unit at (x, y) has against an attacker at (ax, ay). Cover sits on the 4 sides; it only
// counts when the attacker is roughly in front of it. Some cover nearby but none facing = flanked.
// The cover a neighbouring cell gives someone at (x, y): its own (a wall, a barricade), or full cover from a raised
// floor higher than they stand (the side of a roof, the walkway or a tower seen from below).
function sideCover(b, x, y, nx, ny) {
  const c = b.cells[idx(nx, ny)], C = CELL[c.k];
  if (C.walk && hAt(b, nx, ny) > hAt(b, x, y)) return 2;
  return C.cover;
}

export function coverAgainst(b, x, y, ax, ay) {
  bindDims(b);
  // On a siege ladder or carrying a ram (siege.js): no cover at all.
  if (inside(x, y) && (b.cells[idx(x, y)].k === "siegeladder" || (b.rams && b.rams.length && b.units.some((o) => o.x === x && o.y === y && active(o) && isCrew(b, o))))) return { level: 0, any: false, flanked: false };
  let level = 0, any = false;
  const d = dist(x, y, ax, ay) || 1;
  for (const [dx, dy] of DIRS4) {
    if (!inside(x + dx, y + dy)) continue;
    const c = sideCover(b, x, y, x + dx, y + dy);
    if (!c) continue;
    any = true;
    if (((ax - x) * dx + (ay - y) * dy) / d > 0.35) level = Math.max(level, c);
  }
  // Up on a watchtower (deploy.js): full cover from anyone not right next to it.
  const perch = inside(x, y) ? cellAt(b, x, y).perch : 0;
  if (perch && d > 1.5) { level = Math.max(level, perch); any = true; }
  // Higher ground: at least half cover against a shooter below who is not right next to them.
  if (d > 1.5 && inside(x, y) && inside(ax, ay) && hAt(b, x, y) > hAt(b, ax, ay)) { level = Math.max(level, HEIGHT.COVER); any = true; }
  return { level, any, flanked: any && level === 0 };
}

// Cover on each side of a cell, for the shield icons: [east, west, south, north].
export function coverSides(b, x, y) {
  bindDims(b);
  return DIRS4.map(([dx, dy]) => (inside(x + dx, y + dy) ? sideCover(b, x, y, x + dx, y + dy) : 0));
}

// The cost of a step from (x, y) to the next cell (verticality): 0 on the level, Infinity where the height changes
// without a ladder or stairs at either end (or diagonally), else the climb. h: the heights to use (a siege field
// counts a walkway as ground where the wall in front of it can still be battered down: it comes down with it).
function climbCost(b, x, y, nx, ny, diag, per, h = hAt) {
  const dh = Math.abs(h(b, nx, ny) - h(b, x, y));
  if (!dh) return 0;
  if (diag || !(climbAt(b, x, y) || climbAt(b, nx, ny))) return Infinity;
  return dh * per;
}

// Dijkstra over 8 directions (diagonals 1.5, no corner cutting). Units block cells. Heights only change on a ladder
// or stairs (climbCost); the attackers cannot walk through a barred door or a closed gate (they batter it: siegeTarget and bash).
// opts.manual: a move ordered by hand (it may walk through fire); otherwise people and the Shepherd keep out of the
// flames (throwables.js): burning cells are closed to them (they can still step out of one).
// A spitter's acid pool (acid.js) is not closed, only dearer for people: the path is the cheapest by that weight
// (ACID.cost a pool cell; an order by hand ACID.manual, or ACID.cost with opts.wary), within maxCost real steps; dist
// is what the steps of that path really cost.
export function reachable(b, u, maxCost, opts = {}) {
  bindDims(b);
  const avoid = !opts.manual && b.fires && b.fires.length && (u.kind === "human" || u.ztype === "shepherd") ? new Set(b.fires.map((f) => idx(f.x, f.y))) : null;
  const aw = acidWeights(b, u, opts.manual && !opts.wary);
  const d = new Float32Array(W * H).fill(Infinity), prev = new Int16Array(W * H).fill(-1);
  const real = aw ? new Float32Array(W * H).fill(Infinity) : d; // without pools the weight is the cost
  const occ = new Uint8Array(W * H);
  for (const o of b.units) if (o !== u && onMap(o)) occ[idx(o.x, o.y)] = active(o) ? 1 : 2;
  const foe = u.side !== (b.holders || "player"), per = siegeRule(u).climb; // b.holders: whose walls and gates (an assault on a group's base: theirs)
  // A Climber (middead.js climbOver) goes over walls, fences and the like, a level up or down anywhere, never
  // stopping on one of them.
  const climber = u.ztype === "climber";
  const passes = (x, y) => cellAt(b, x, y).walk || (climber && climbOver(u, b.cells[idx(x, y)].k));
  const start = idx(u.x, u.y);
  d[start] = 0;
  real[start] = 0;
  const open = [start];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (d[open[i]] < d[open[bi]]) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    const x = cur % W, y = (cur / W) | 0;
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny) || !passes(nx, ny)) continue;
      const diag = dx && dy;
      if (diag && (!passes(x + dx, y) || !passes(x, y + dy))) continue;
      const j = idx(nx, ny);
      if (occ[j] === 1) continue;
      if (foe && barredCell(b.cells[j]) && !doorOpens(b, u, b.cells[j]) && !(climber && climbOver(u, b.cells[j].k))) continue;
      if (avoid && avoid.has(j)) continue;
      const climb = climber ? Math.abs(hAt(b, nx, ny) - hAt(b, x, y)) + (cellAt(b, nx, ny).walk && !barredCell(b.cells[j]) ? 0 : MIDDEAD.CLIMBER.COST) : climbCost(b, x, y, nx, ny, diag, per);
      if (climb === Infinity) continue;
      const step = (diag ? 1.5 : 1) + climb;
      const nr = real[cur] + step, nd = aw ? d[cur] + step + aw[j] : nr;
      if (nr <= maxCost + 1e-6 && nd < d[j]) {
        if (d[j] === Infinity) open.push(j);
        d[j] = nd;
        if (aw) real[j] = nr;
        prev[j] = cur;
      }
    }
  }
  // Downed bodies can be stepped over but not stood on.
  const stop = real.slice();
  for (let j = 0; j < W * H; j++) if (occ[j] === 2 || (climber && (!CELL[b.cells[j].k].walk || barredCell(b.cells[j])))) stop[j] = Infinity;
  return { dist: stop, prev };
}

export function pathTo(r, x, y) {
  const path = [];
  let i = idx(x, y);
  while (i >= 0 && r.prev[i] >= 0) {
    path.unshift([i % W, (i / W) | 0]);
    i = r.prev[i];
  }
  return path;
}

// Walking distance from a set of cells to everywhere (ignores units). Used by AI to find a way around walls.
// walker: the unit that will walk it (the climb costs the dead more). An attacker's field is a siege field: a barred
// door, a closed gate, a wall section or a window with hit points left counts as a way through at the cost of
// battering it down (SIEGE: 2 + 0.4 a hit point), so the dead pile onto the weakest point when no opening is nearer.
export function distField(b, sources, walker = null) {
  bindDims(b);
  const siege = !!walker && walker.side !== (b.holders || "player");
  const per = siegeRule(walker).climb;
  const burning = walker && b.fires && b.fires.length && (walker.kind === "human" || walker.ztype === "shepherd") ? new Set(b.fires.map((f) => idx(f.x, f.y))) : null;
  // The same field asked again with the map unchanged (every one of the dead in a turn heads for the same people):
  // the one worked out before (fieldCache). Callers only read it.
  const climber = !!walker && walker.ztype === "climber"; // middead.js: over walls and fences, up a level anywhere
  const key = `${siege ? 1 : 0}${climber ? "c" : ""}${per}|${burning ? [...burning].join(".") : ""}|${sources.map((s) => s[0] + s[1] * W).join(",")}`;
  const cache = fieldCache(b);
  const hit = cache.get(key);
  if (hit) return hit;
  const d = new Float32Array(W * H).fill(Infinity);
  if (cache.size >= 8) cache.delete(cache.keys().next().value);
  cache.set(key, d);
  const over = (x, y) => climber && climbOver(walker, b.cells[idx(x, y)].k);
  const pass = (x, y) => { const c = b.cells[idx(x, y)]; return (CELL[c.k].walk || (siege && breakable(c)) || over(x, y)) && !(burning && burning.has(idx(x, y))); };
  const aw = walker ? acidWeights(b, walker) : null; // people go round a spitter's acid when they can (acid.js)
  const wallAt = (x, y) => inside(x, y) && b.cells[idx(x, y)].k === "palisade" && breakable(b.cells[idx(x, y)]);
  const hSiege = (bb, x, y) => (b.cells[idx(x, y)].k === "walkway" && DIRS4.some(([dx, dy]) => wallAt(x + dx, y + dy)) ? 0 : hAt(bb, x, y));
  // A binary heap of (distance, cell), stale entries skipped: the same field as scanning for the nearest open cell,
  // in a fraction of the time on the bigger maps (battlesize.js).
  const heap = new MinHeap();
  for (const [x, y] of sources) { d[idx(x, y)] = 0; heap.push(0, idx(x, y)); }
  while (heap.size) {
    const key = heap.topKey(), cur = heap.pop();
    if (key > d[cur]) continue;
    const x = cur % W, y = (cur / W) | 0;
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny) || !pass(nx, ny)) continue;
      const diag = dx && dy;
      if (diag && (!(cellAt(b, x + dx, y).walk || over(x + dx, y)) || !(cellAt(b, x, y + dy).walk || over(x, y + dy)))) continue; // no corner cutting (as reachable)
      const climb = climber ? Math.abs(hAt(b, nx, ny) - hAt(b, x, y)) + (over(nx, ny) ? MIDDEAD.CLIMBER.COST : 0) : climbCost(b, x, y, nx, ny, diag, per, siege ? hSiege : hAt);
      if (climb === Infinity) continue;
      const c = b.cells[idx(nx, ny)];
      const bash = !over(nx, ny) && siege && (breakable(c) && (!CELL[c.k].walk || (barredCell(c) && !doorOpens(b, walker, c)))) ? SIEGE.COST + c.hp * SIEGE.PER_HP : 0;
      const j = idx(nx, ny), nd = d[cur] + (diag ? 1.5 : 1) + climb + bash + (aw ? aw[j] : 0); // aw: acid.js
      if (nd < d[j]) { d[j] = nd; heap.push(d[j], j); }
    }
  }
  return d;
}
// distField's cache for a battle: emptied whenever any cell's kind, hit points, height or bar changed (a door broken,
// a wall breached, a lock opened, the map turned or swapped), checked against a copy of those on every call.
function fieldCache(b) {
  let fc = b._fields;
  const cells = b.cells, n = cells.length;
  let same = !!fc && fc.cells === cells && fc.k.length === n;
  if (same) {
    const k = fc.k, hp = fc.hp, h = fc.h, bar = fc.bar;
    for (let i = 0; i < n; i++) { const c = cells[i]; if (c.k !== k[i] || c.hp !== hp[i] || c.h !== h[i] || c.bar !== bar[i]) { same = false; break; } }
  }
  if (!same) {
    fc = { cells, k: cells.map((c) => c.k), hp: cells.map((c) => c.hp), h: cells.map((c) => c.h), bar: cells.map((c) => c.bar), map: new Map() };
    Object.defineProperty(b, "_fields", { value: fc, writable: true, configurable: true, enumerable: false }); // not saved with the battle
  }
  return fc.map;
}
// A binary min-heap of numbers (keys) with an int payload each (distField).
class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  topKey() { return this.k[0]; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

// ---------- odds ----------
export function shotOdds(b, a, t, ax = a.x, ay = a.y, opts = {}) {
  bindDims(b);
  const w = WEAPONS[a.weapon];
  const d = dist(ax, ay, t.x, t.y);
  let aim = a.aim + (w.aim || 0);
  if (d > w.opt && !a.noFall) aim -= (d - w.opt) * w.fall; // noFall: the Sniper perk (skills.js)
  if (d <= 2.5 && w.close) aim += w.close;
  const flat = t.surprised || (!t.aware && t.side === "enemy");
  const cov = t.kind === "zombie" || flat ? { level: 0, any: false, flanked: false } : coverAgainst(b, t.x, t.y, ax, ay);
  aim -= COVER_DEF[Math.max(0, cov.level - (w.pierce || 0))]; // pierce: a spitter's acid (zombietypes.js)
  if (t.hunker && cov.level) aim -= HUNKER_DEF;
  if (flat) aim += 15;
  if (opts.reaction && !a.owSure) aim -= 15; // owSure: the Suppressor perk (skills.js)
  if (opts.volley) aim += 15; // caught before they could take cover
  // A break-in map (deploy.js): the floodlit area, and shooting from a watchtower.
  if (b.lit && b.floodAim && inside(t.x, t.y) && b.lit[idx(t.x, t.y)]) aim += b.floodAim;
  // Smoke and flares (throwables.js): a shot into or out of a cloud, your people at a target in a flare's light at night.
  if (b.smoke && b.smoke.length && (smokeAt(b, t.x, t.y) || smokeAt(b, ax, ay))) aim -= SMOKE.aim;
  if (b.flares && b.flares.length && a.side === "player" && (b.night || b.dark) && flareLit(b, t.x, t.y)) aim += FLARE.aim;
  // Shooting down from higher ground (a walkway, a roof, a watchtower: verticality).
  const up = inside(ax, ay) ? hAt(b, ax, ay) - hAt(b, t.x, t.y) : 0;
  if (up > 0) aim += Math.min(HEIGHT.MAX_AIM, up * HEIGHT.AIM);
  // Clinging to a siege ladder, or hauling a ram (siege.js): easy to hit.
  if (inside(t.x, t.y) && b.cells[idx(t.x, t.y)].k === "siegeladder") aim += CLIMB_AIM;
  else if (t.ram != null && b.rams && isCrew(b, t)) aim += CREW_AIM;
  const chance = Math.max(5, Math.min(95, Math.round(aim)));
  const crit = opts.reaction ? 0 : (cov.level === 0 ? (t.kind === "zombie" ? CRIT.DEAD : CRIT.EXPOSED) : CRIT.COVER) + (a.critBonus || 0); // critBonus: Deadeye
  return { chance, crit, dmg: [Math.round(w.dmg[0] * a.dmgMult), Math.round(w.dmg[1] * a.dmgMult)], cover: cov.level, flanked: cov.flanked, exposed: !cov.any && t.kind !== "zombie", dist: d, height: up };
}

export function meleeOdds(b, a, t) {
  bindDims(b);
  const w = WEAPONS[a.weapon];
  const up = hAt(b, t.x, t.y) > hAt(b, a.x, a.y) ? HEIGHT.MELEE_UP : 0; // striking up at someone on higher ground
  const chance = Math.max(10, Math.min(95, Math.round(a.meleeAim + (w.meleeAim || 0) - (t.hunker ? 10 : 0) - up)));
  const base = w.melee ? w.dmg : BASH;
  const mult = w.melee ? a.dmgMult : 1;
  return { chance, crit: CRIT.MELEE, dmg: [Math.round(base[0] * mult), Math.round(base[1] * mult)], cover: 0, flanked: false, dist: 1 };
}

export const isRanged = (u) => !WEAPONS[u.weapon].melee;
export const adjacent = (a, t) => Math.max(Math.abs(a.x - t.x), Math.abs(a.y - t.y)) === 1;
// Can this unit fire its gun right now (ranged weapon and, for the player, ammo)?
export const canFire = (b, u) => isRanged(u) && !(u.cd > 0) && !(u.ram != null && b.rams && isCrew(b, u)) && u.carrying == null && (u.side !== "player" || ammoLeft(b) >= WEAPONS[u.weapon].ammo); // a ram's crew has its hands full (siege.js); so does someone carrying a body (carriers.js)
// Enemies the player side can currently see.
export function playerSees(b, t) {
  bindDims(b);
  if (t.off || (b.floors && (t.f || 0) !== (b.floor || 0))) return false; // another storey: out of sight whatever the x, y
  return b.units.some((u) => u.side === "player" && active(u) && (canSee(b, u, t) || adjacent(u, t))) || (!!b.peeks && peekSees(b, t.x, t.y));
}

// ---------- fog of war ----------
// Every cell your people can see now (1) or not (0): the union of what each one standing sees (canSeeAt: sight by
// height, night, light, night vision, optics; walls and buildings block it). Everything after the battle is over.
export function playerVision(b) {
  bindDims(b);
  const vis = new Uint8Array(W * H).fill(b.over ? 1 : 0);
  if (b.over) return vis;
  const eyes = b.units.filter((u) => u.side === "player" && active(u));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    for (const e of eyes) if ((e.x === x && e.y === y) || canSeeAt(b, e, x, y)) { vis[y * W + x] = 1; break; }
    if (!vis[y * W + x] && b.peeks && peekSees(b, x, y)) vis[y * W + x] = 2; // a peek through a door this turn (buildingmaps.js)
  }
  return vis;
}
// Last-seen ghosts: where each enemy was when your people last saw it ({ id: [x, y, turn] }); forgotten once it is
// seen dead, flees or a new map starts (interior.js). The battle screen draws them faded where nobody sees now.
function trackGhosts(b) {
  if (!b || !b.units || !b.losCache) return;
  const g = b.ghosts || (b.ghosts = {});
  for (const e of b.units) {
    if (e.side !== "enemy") continue;
    if (e.dead || e.fled || e.left || e.off) { if (g[e.id] && (e.fled || e.left || e.off || playerSeesCell(b, e.x, e.y))) delete g[e.id]; continue; }
    if (playerSees(b, e)) g[e.id] = [e.x, e.y, b.turn, e.f || 0]; // [x, y, turn, floor]
  }
}
const playerSeesCell = (b, x, y) => b.units.some((u) => u.side === "player" && active(u) && canSeeAt(b, u, x, y));
// The ghosts to draw: enemies not seen now with a last-seen spot.
export function enemyGhosts(b) {
  if (!b.ghosts) return [];
  const out = [];
  for (const e of b.units) {
    const g = b.ghosts[e.id];
    if (!g || e.side !== "enemy" || e.dead || e.left || e.fled || e.off || playerSees(b, e)) continue;
    if (b.floors && (g[3] || 0) !== (b.floor || 0)) continue; // last seen on another floor: not drawn on this one
    out.push({ id: e.id, x: g[0], y: g[1], turn: g[2], f: g[3] || 0, kind: e.kind, name: e.name, unit: e });
  }
  return out;
}

// ---------- units ----------
// Medicine bonus from the off-hand kit in battle: the one rule shared with treating at a base and in the field
// (crafting.medKitBonus: bandage kit +2, surgical kit +4 scaled by the usual skill-gap rule, nothing when the
// medic is not skilled enough to use it).
const battleKitBonus = (s) => medKitBonus(s);

function playerUnit(b, s) {
  const item = s.gear.weapon;
  const eff = gearEffect(s, item);
  const key = item && eff.usable && WEAPONS[item.key] ? item.key : "fists";
  const mult = key === "fists" ? 1 : eff.mult;
  const q = item && key !== "fists" ? item.quality || 1 : 1;
  const bravery = (s.traits.includes("brave") ? 5 : 0) - (s.traits.includes("coward") ? 5 : 0);
  const armor = (s.traits.includes("tough") ? 0.75 : 1) * armorMult(s); // every worn piece (inventory.js)
  // What this unit takes the field with: exactly these item objects wear when the battle ends (wearFielded).
  const fielded = [];
  if (item && key !== "fists") fielded.push(["weapon", item]);
  for (const slot of ARMOR_SLOTS) if (s.gear[slot]) fielded.push([slot, s.gear[slot]]);
  // A bandage kit in the off hand loses a use with every treatment in battle; when it runs out its bonus is gone.
  const tool = s.gear.tool;
  const medKit = tool && GEAR[tool.key] && GEAR[tool.key].medKit ? tool : null;
  return {
    fielded, medKit, kitBonus: medKit ? medKitBonus(s) : 0, kitLeft: medKit ? itemDur(medKit) ?? Infinity : 0, kitUses: 0,
    id: b.nextId++, side: "player", kind: "human", sid: s.id, name: s.name, short: initials(s.name),
    weapon: key, weaponName: key === "fists" ? (item ? `${item.name} (unusable)` : "Fists") : item.name,
    aim: 40 + skill(s, "shooting") * 2.5 - (1 - mult) * 30 + bravery + ((b.setup && b.setup.relAim && b.setup.relAim[s.id]) || 0) + buzzAim(s) + needsAim(s) + illnessAim(s), // friends alongside, rivals, revenge (relations.js); a hangover (comforts.js); hunger, thirst (needs.js); illness (health.js)
    nerve: (s.traits.includes("brave") ? MIDDEAD.NIGHTMARE.BRAVE : 0) + (s.traits.includes("coward") ? MIDDEAD.NIGHTMARE.COWARD : 0), // middead.js: a Nightmare's scream
    meleeAim: 75 + bravery, dmgMult: (0.6 + 0.4 * mult) * (0.75 + 0.25 * q),
    armor, hp: s.health, maxHp: 100, startHp: s.health, mob: MOVE, sight: SIGHT,
    stealth: skill(s, "stealth"), medicine: skill(s, "medicine") + battleKitBonus(s),
    scouting: skill(s, "scouting"), load: fielded.reduce((a, [slot, it]) => a + (slot !== "weapon" && GEAR[it.key] ? GEAR[it.key].power || 0 : 0), 0), // escape checks (soundRetreat)
    gearRisk: key === "fists" ? 0 : eff.damageChance, item: key === "fists" ? null : item,
    wormed: hasWorm(s), wornArmor: armorMult(s), // carriers.js: the worm in them gets them up if they die; the risen wear what they wore
    ap: 2, aware: true, x: 0, y: 0, f: 0,
  };
}

// A weapon or armor put on or taken off in the middle of a raid (the search window, raidloot.js) counts at once.
// u.fit is what playerUnit gave when the raid started; perks and the rest added since stay on top.
function refitUnit(b, u, s) {
  if (!u.fit) return;
  const id = b.nextId;
  const f = playerUnit(b, s);
  b.nextId = id;
  u.aim += f.aim - u.fit.aim;
  u.dmgMult *= f.dmgMult / (u.fit.dmgMult || 1);
  u.armor *= f.armor / (u.fit.armor || 1);
  u.medicine += f.medicine - (u.fit.medicine ?? f.medicine); // a med kit in the off hand (crafting.js medKitBonus)
  if (f.medKit !== u.medKit) { u.medKit = f.medKit; u.kitBonus = f.kitBonus; u.kitLeft = f.kitLeft; }
  u.fit = { aim: f.aim, dmgMult: f.dmgMult, armor: f.armor, medicine: f.medicine };
  for (const k of ["weapon", "weaponName", "item", "gearRisk", "fielded", "load"]) u[k] = f[k];
  refitSenses(b, u, s); // stealth.js: a flashlight, night vision, scope or suppressor counts at once
}
setRefit(refitUnit);

export function enemyUnit(b, rng, kind, power, n) {
  const p = Math.max(1, power);
  if (kind === "zombies") {
    return {
      id: b.nextId++, side: "enemy", kind: "zombie", name: `Zombie ${n}`, short: "Z", weapon: "claws", weaponName: "Teeth and nails",
      aim: 0, meleeAim: 55 + p * 3, dmgMult: 0.6 + p * 0.1, armor: 1, hp: Math.round(15 + p * 7), maxHp: Math.round(15 + p * 7),
      mob: p >= 5 ? ZOMBIE_FAST : ZOMBIE_MOVE, sight: ZOMBIE_SIGHT, ap: 2, aware: true, x: 0, y: 0, f: b.floor || 0, // f: the floor being built or played
    };
  }
  const kit = KITS[kind] || KITS.raiders;
  const weapon = p >= 7 && rng.chance(0.5) ? rng.pick(kit.strong) : rng.pick(kit.weapons);
  const armorKey = rng.pick(kit.armor);
  const hp = Math.round(55 + p * 5 + kit.hp);
  return {
    id: b.nextId++, side: "enemy", kind: "human", name: `${kit.label} ${n}`, short: kit.label[0] + n, weapon, weaponName: WEAPONS[weapon].name,
    aim: 39 + p * 4 + kit.aim, meleeAim: 65 + p * 2, dmgMult: 0.7 + p * 0.05, armor: armorKey ? 1 - GEAR[armorKey].power * 0.06 : 1, armorKey,
    hp, maxHp: hp, mob: MOVE, sight: SIGHT, ap: 2, aware: true, x: 0, y: 0, f: b.floor || 0, fearless: !!kit.fearless, kit: kind,
  };
}

const initials = (name) => name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

// ---------- setup ----------
export function createBattle(state, setup) {
  setup.relAim = friendAim(state, combatants(state, setup), setup); // relations.js: aim per survivor id
  if (setup.mode === "raid") return createRaid(state, setup);
  [W, H] = battleSize(state, setup);
  const rng = state.rng;
  const tileId = tileIdOf(setup);
  const tile = state.tiles[tileId];
  const party = setup.partyId ? state.parties.find((x) => x.id === setup.partyId) : null;
  const base = setup.baseId ? state.bases.find((x) => x.id === setup.baseId) : null;
  const map = genMap(rng, tile, { densify: setup.layout !== "baseDefence" });
  const b = {
    setup, tileId: party ? partyTile(party) : tileId, w: W, h: H, cells: map.cells, reach: map.reach,
    place: tile ? (tile.loc ? tile.loc.name : (tile.terrain[0].toUpperCase() + tile.terrain.slice(1))) : "Open ground",
    units: [], turn: 1, phase: "player", log: [], fx: [], fxSeq: 0, rev: 1, nextId: 1,
    pools: party ? [party.supplies, party.cargo ? party.cargo.supplies : {}] : base ? [base.stock] : [{}],
    ammoUsed: 0, medsUsed: 0, noise: 0, reinf: 0, infection: tile ? tile.infection || 0 : 0,
    evacCols: setup.canRetreat ? 2 : 0, over: false, result: null, acted: false, queue: [],
    losCache: new Int8Array(W * H * W * H), rng, dark: isNight(state), // dark: escapes are easier (escapeOdds)
  };
  b.reinfMax = Math.round(b.infection * 5);
  b.zmix = armoredOf(setup.enemy && setup.enemy.mix); // the dead drawn in later: soldiers among them at a military site
  const layout = setup.layout && layouts ? layouts.get(setup.layout) : null;
  const layoutCtx = (phase) => ({
    phase, state, rng, W, H, inside, cellAt: (x, y) => b.cells[idx(x, y)],
    free: (x, y) => inside(x, y) && b.cells[idx(x, y)].k === "open" && !unitAt(b, x, y),
    put: (x, y, k) => { if (inside(x, y)) b.cells[idx(x, y)].k = k; },
    standable: (x, y) => inside(x, y) && b.reach[idx(x, y)] && cellAt(b, x, y).walk && !unitAt(b, x, y),
  });
  if (layout) {
    layout(b, layoutCtx("map"));
    b.reach = flood(b.cells, 0, Math.floor(H / 2));
  }
  const occupied = (x, y) => !!unitAt(b, x, y);
  const spot = (x, y) => inside(x, y) && b.reach[idx(x, y)] && cellAt(b, x, y).walk && !occupied(x, y);
  const coverScore = (x, y) => coverSides(b, x, y).reduce((s, c) => s + c, 0);
  const pickCells = (n, test, score) => {
    const list = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (spot(x, y) && test(x, y)) list.push([x, y, score(x, y) + rng.next() * 2]);
    list.sort((a, c) => c[2] - a[2]);
    return list.slice(0, n);
  };

  // Player side.
  const people = combatants(state, setup).slice().sort((a, c) => combatPower(c) - combatPower(a)).slice(0, MAX_PLAYERS);
  const mid = H / 2;
  // Where each side starts (battlesize.js spawnRules): your people by the west edge, the enemy a set distance off
  // whatever the map's size, so the shooting starts in a turn or two.
  let rules = spawnRules([2, mid]);
  const pcells = pickCells(people.length, rules.player, (x, y) => coverScore(x, y) * 1.5 - Math.abs(y - mid) * 0.6);
  people.forEach((s, i) => {
    const u = playerUnit(b, s);
    const c = pcells[i] || pickCells(1, () => true, (x) => -x)[0];
    u.x = c[0]; u.y = c[1];
    b.units.push(u);
  });
  battlePerks(state, b); // skills.js: perks on the player's units (aim, crits, stealth, Rally, Commander...)

  // Enemy side.
  const e = setup.enemy;
  const count = Math.max(1, Math.min(MAX_ENEMIES, Math.round(e.count || 1)));
  const kinds = [];
  for (let i = 0; i < count; i++) kinds.push(e.kind === "mixed" ? (i % 2 ? "zombies" : "raiders") : e.kind);
  const pc = b.units.reduce((a, u) => [a[0] + u.x / b.units.length, a[1] + u.y / b.units.length], [0, 0]);
  rules = spawnRules(pc);
  let pods = [];
  if (setup.ambush === "player") {
    // Unaware and clustered around a couple of spots.
    const nPods = Math.max(1, Math.min(3, Math.ceil(count / 4)));
    pods = pickCells(nPods, (x, y) => rules.pod(x, y) && x <= W - 3, () => rng.next() * 3);
  }
  const flankTop = pc[1] >= mid; // flankers come from the side farther from your people
  let zn = 0, hn = 0;
  // A hive's special dead among them (e.types: { runner: 3, ... }, zombietypes.js), spread through the zombies.
  // e.mix (shares, no types): the armoured dead of a military site met on the road (deadsoldiers.js).
  const nz = kinds.filter((k) => k === "zombies").length;
  const ztypes = e.types ? typeList(e.types, nz) : mixList(e.mix, nz);
  kinds.forEach((k, i) => {
    const u = enemyUnit(b, rng, k, e.power, k === "zombies" ? ++zn : ++hn);
    if (k === "zombies" && ztypes[zn - 1]) applyZType(u, ztypes[zn - 1], !!e.elite, e.power);
    let c;
    if (setup.ambush === "player") {
      const pod = pods[i % pods.length] || [W - 3, Math.floor(mid)];
      u.aware = false;
      u.pod = i % Math.max(1, pods.length);
      c = pickCells(1, (x, y) => dist(x, y, pod[0], pod[1]) <= 3.2, (x, y) => -dist(x, y, pod[0], pod[1]) + coverScore(x, y) * 0.5)[0];
    } else if (setup.ambush === "enemy") {
      if (u.kind === "zombie") c = pickCells(1, (x, y) => { const d = dist(x, y, pc[0], pc[1]); return d >= 3.5 && d <= 7 && x > 1; }, () => 0)[0];
      else if (i % 2) c = pickCells(1, rules.flank(flankTop), (x, y) => coverScore(x, y))[0];
      else c = pickCells(1, rules.ambushFront, (x, y) => coverScore(x, y))[0];
    } else {
      c = pickCells(1, rules.front(u.kind === "zombie"), (x, y) => (u.kind === "zombie" ? 0 : coverScore(x, y)))[0];
    }
    // No room where they belong: the nearest free cell to the usual distance, ahead of your people.
    c = c || pickCells(1, (x) => x >= pc[0] + 6, (x, y) => -Math.abs(dist(x, y, pc[0], pc[1]) - CONTACT.HUMANS[0]))[0] || pickCells(1, (x) => x >= pc[0] + 3, (x) => x)[0];
    if (!c) return;
    u.x = c[0]; u.y = c[1];
    if (e.factionId != null && u.kind === "human") u.factionId = e.factionId; // prisoners.js: whose people they are
    b.units.push(u);
  });
  if (setup.third && setup.third.length) placeThird(b, setup.third, rng, pickCells, W); // thirdside.js: soldiers or survivors in the middle
  if (layout) layout(b, layoutCtx("units"));
  if (!setup.layout) placeBodies(b, state.seed); // sleepers.js: bodies lie about a fight in the open, Sleepers among them
  placeWalking(state, b); // carriers.js: the walking dead that drifted near this tile, among the ordinary dead
  stealthSetup(state, b); // stealth.js: lights, suppressors, which way the enemy faces
  siegeSetup(state, b); // siege.js: the raiders' ladders, ram and grenades; a team's ladders and ram
  b.enemyStart = b.units.filter((u) => u.side === "enemy").length;

  const foeName = e.name || e.kind;
  say(b, `Battle at ${b.place} against ${foeName}.`, "info");
  if (setup.ambush === "player") say(b, "You have the drop on them. They have not seen you yet. Gunfire will alert them; melee is silent.", "good");
  if (setup.ambush === "enemy") {
    say(b, "Ambush! They saw you first. Your people are pinned: 1 action each this turn.", "danger");
    for (const u of b.units) if (u.side === "player") u.ap = 1;
    for (const u of b.units) {
      if (u.side !== "enemy" || !isRanged(u)) continue;
      const shot = bestShot(b, u, foesOf(b, u), { volley: true });
      if (shot) fire(b, u, shot.t, { volley: true });
    }
  }
  if (b.evacCols) say(b, `The green strip on the ${b.evacSide || "left"} edge is your way out. Units standing there can retreat, or sound the retreat to pull everyone out at once.`, "info");
  checkEnd(state, b);
  return b;
}

// Who a unit fights. Zombies drawn in by noise attack anyone alive, and raiders shoot back.
// thirdside.js: the third side fights its own foes; enemy people go after it by enemyTargetsThird; the dead go for
// anyone; your people never go after it on their own (only an order to shoot one does: damage turns it hostile).
function foesOf(b, u) {
  if (u.side === "third") return thirdFoes(b, u);
  if (u.wild) return b.units.filter((o) => active(o) && o.kind !== "zombie");
  if (u.side === "enemy" && u.kind === "human") return b.units.filter((o) => active(o) && (o.side === "player" || o.wild || (o.side === "third" && enemyTargetsThird(o, u))));
  // A Sleeper lying where it is (sleepers.js) is shot only by order: the AI keeps clear of it.
  return b.units.filter((o) => o.side !== u.side && active(o) && !(u.side === "player" && (o.side === "third" || o.dormant)));
}

// ---------- actions ----------
// nonLethal (Subdue, stealth.js): a person brought to 0 is knocked out, not killed.
// hit: { how: "shot" | "melee" | "bash" | "fire" | "blast", crit, sneak } for the armoured dead (deadsoldiers.js
// armorVs: their armour by the weapon that struck); everyone else takes raw × their armor ("acid": half of it, acid.js).
// A spitter that dies bursts (acid.js spitterBurst); a Carrier bursts into a worm swarm, and whoever the swarm kills
// carries the worm (carriers.js; deadsoldiers.js armorVs: most bullets go through the swarm).
// A Boneback's plates take most of a hit from the front (middead.js bonebackMult); a Flinger winding up drops its
// mass when hit hard (afterHit); a spotted Sleeper splits where it lies (sleepers.js).
export function hitMult(t, by, hit) {
  if (hit && hit.how === "acid") return acidArmor(t);
  if (t.ztype === "boneback") return bonebackMult(t, by, hit) * t.armor;
  if (t.ztype && (ARMORED.includes(t.ztype) || t.ztype === "swarm")) return armorVs(t, by, hit);
  return t.armor;
}
export function damage(b, t, raw, by, nonLethal = false, hit = null) {
  if (t.side === "third") thirdSideHit(b, t, by); // thirdside.js: your people hit them, so they (or all the soldiers) turn on you
  const eff = raw * hitMult(t, by, hit);
  t.hp = Math.max(0, t.hp - eff);
  if (t.hp > 0) {
    if (t.ztype === "boneback" || t.ztype === "flinger") afterHit(b, t, by, hit, eff); // middead.js
    swarmBite(b, t, by); // carriers.js: a worm swarm's bite can leave the worm in the living
    return eff;
  }
  if (nonLethal && t.side === "enemy" && t.kind === "human") { knockOut(b, t, by); return eff; }
  swarmHit(t, by); // carriers.js: brought down by the worms, they are in them
  if (t.side === "player") {
    t.down = true;
    (b.downedIds || (b.downedIds = [])).push(t.sid); // service record (relations.js)
    t.bleed = BLEED_TURNS;
    t.ow = t.hunker = false;
    say(b, `${t.name} is down and bleeding. Use meds on them within ${BLEED_TURNS} turns${b.raid ? "; once stabilized they are carried out when a teammate extracts" : ""}.`, "death");
  } else {
    t.dead = true;
    t.killedBy = by ? by.side : null;
    if (by && by.sid != null) { const k = (b.killsBy || (b.killsBy = {}))[by.sid] || (b.killsBy[by.sid] = { z: 0, h: 0 }); k[t.kind === "zombie" ? "z" : "h"]++; } // service record (relations.js)
    if (b.raid && t.kind === "human") b.raid.containers.push({ id: b.nextId++, x: t.x, y: t.y, f: t.f || 0, kind: "body", area: null, searched: false, kit: t.kit, weapon: t.weapon, label: `${t.name}'s body`, uid: t.id }); // uid: dragged along with the body (stealth.js)
    else if (b.raid && t.bodyBox) dropBodyBox(b, t); // carriers.js: one of the risen, put down: the body it got up from (what was on it)
    // One of the dead: a body to search too (what the person had on them; a dead soldier's kit). The raid bot walks
    // over only for the armoured ones (botSkip: it searches an ordinary one when it is next to it anyway). A worm
    // swarm leaves nothing.
    else if (b.raid && t.kind === "zombie" && !t.boss && t.ztype !== "swarm" && t.ztype !== "sleeper") b.raid.containers.push({ id: b.nextId++, x: t.x, y: t.y, f: t.f || 0, kind: "body", zombie: true, ztype: t.ztype || null, area: null, searched: false, label: `${t.name}'s body`, uid: t.id, botSkip: !(t.ztype && ARMORED.includes(t.ztype)) });
    if (b.raid && t.walking) walkingBox(b, t, b.raid.containers.find((k) => k.kind === "body" && k.uid === t.id)); // carriers.js: one of the walking dead put down: its things are in the body
    say(b, t.ztype === "swarm" ? `${t.name} is crushed and scattered.` : `${t.name} is dead.`, t.side === "third" ? "danger" : "good"); // thirdside.js: one of the third side fell
    if (t.ztype === "spitter") spitterBurst(b, t); // acid.js: its sac bursts over the tiles around it
    if (t.ztype === "carrier") burst(b, t); // carriers.js: the worm swarm comes out
    if (t.ztype === "swarm") t.off = true; // no body: gone from the map
    if (t.ztype === "flinger") onDeath(b, t); // middead.js: the mass it was winding up to throw spills out
    if (t.ztype === "sleeper") sleeperDies(b, t, hit); // sleepers.js: it splits where it lies, or the fire cooks it
  }
  return eff;
}

// Gunfire wakes everyone. Caught by your own opening shots, they stay flat-footed until their turn.
function alertAll(b, why) {
  const sleepers = b.units.filter((u) => u.side === "enemy" && !u.aware && active(u));
  if (!sleepers.length) return;
  for (const u of sleepers) { u.aware = true; if (b.phase === "player") u.surprised = true; }
  say(b, b.phase === "player" ? "Your shots catch them by surprise. They scramble but cannot react this turn." : why, "good");
}

export function alertPod(b, pod, why) {
  const sleepers = b.units.filter((u) => u.side === "enemy" && !u.aware && active(u) && u.pod === pod);
  if (!sleepers.length) return;
  for (const u of sleepers) u.aware = true;
  say(b, why, "danger");
  if (b.phase === "player") for (const u of sleepers) scramble(b, u);
}

// Freshly alerted humans dash for cover (XCOM-style), without spending their turn.
function scramble(b, u) {
  if (u.kind === "zombie" || !active(u)) return;
  const mv = bestMove(b, u, foesOf(b, u));
  if (mv) moveAlong(b, u, mv.path);
}

// An unaware enemy notices a player unit that comes close enough in its sight.
function detect(b, mover) {
  for (const e of b.units) {
    if (e.side !== "enemy" || e.aware || !active(e)) continue;
    // Light Step and Ghost (skills.js), night and a flashlight (stealth.js).
    const r = detectRange(b, e, mover);
    if (dist(e.x, e.y, mover.x, mover.y) <= r && los(b, e.x, e.y, mover.x, mover.y)) {
      alertPod(b, e.pod, `${e.name} spotted ${mover.name}!`);
    }
  }
}

export function moveAlong(b, u, path) {
  bindDims(b);
  if (!path.length) return;
  if (u.brace) delete u.brace; // stepping away lets go of a braced door (buildingmaps.js)
  const from = [u.x, u.y];
  const walked = [];
  let burned = false;
  for (const [x, y] of path) {
    const there = unitAt(b, x, y);
    if (there && (active(there) || (x === path[path.length - 1][0] && y === path[path.length - 1][1]))) break;
    u.face = [Math.sign(x - u.x), Math.sign(y - u.y)]; // which way it faces (stealth.js: takedowns from behind)
    u.x = x; u.y = y;
    walked.push([x, y]);
    // A building's closed door swings open (buildingmaps.js); anyone but your people stops in the doorway to open it.
    const stopAtDoor = b.cells[idx(x, y)].k === "idoor" && openDoor(b, x, y, u) && u.side !== "player";
    // Traps on a base's battle map (defences.js): spikes hurt the dead, a trench stops them for the turn.
    const trap = CELL[b.cells[idx(x, y)].k].trap;
    if (trap && u.kind === "zombie") {
      if (trap === "spikes") { const eff = Math.round(damage(b, u, b.rng.int(18, 28), null)); say(b, `${u.name} is impaled in a spike pit (${eff}).`, "good"); }
      else if (trap === "beartrap") {
        const eff = Math.round(damage(b, u, b.rng.int(14, 22), null));
        u.ap = 0;
        b.cells[idx(x, y)].k = "open"; // sprung
        say(b, `${u.name} is caught in a bear trap (${eff}).`, "good");
      } else { u.ap = 0; say(b, trap === "wire" ? `${u.name} is snagged on the barbed wire.` : `${u.name} flounders in the trench.`, "good"); }
      if (!active(u) || trap !== "spikes") break;
    }
    if (!burned && fireStep(b, u, x, y)) { burned = true; if (!active(u)) break; } // into a Molotov's flames (throwables.js): once a move
    if (acidStep(b, u, x, y) && !active(u)) break; // into a spitter's acid (acid.js): once a round
    // Overwatch: the first enemy that moves in sight draws a reaction shot.
    for (const o of b.units) {
      if (!o.ow || o.side === u.side || !active(o) || !active(u) || !hostilePair(b, o, u)) continue; // thirdside.js: not at the third side unless at odds
      if (!canSee(b, o, u) || !canFire(b, o)) continue;
      o.ow = false;
      say(b, `${o.name} reacts on overwatch.`, "info");
      fire(b, o, u, { reaction: true });
    }
    if (u.side === "player" && active(u)) detect(b, u);
    if (b.corpses && b.corpses.length && u.kind !== "zombie" && active(u)) { wakeNear(b, u); spotCheck(b, u); } // sleepers.js: a Sleeper next to them splits open
    if (!active(u) || stopAtDoor) break;
  }
  if (walked.length) fx(b, { type: "move", unit: u.id, from, path: walked });
  if (walked.length && u.ram != null) afterMove(b, u); // siege.js: the ram's crew keeps up with its lead
}

export function fire(b, a, t, opts = {}) {
  const w = WEAPONS[a.weapon];
  const rng = b.rng;
  if (w.cooldown) a.cd = w.cooldown; // a spitter spits every other turn (zombietypes.js zTick)
  if (a.side === "player") {
    take(b, "ammo", w.ammo);
    b.ammoUsed += w.ammo;
    if (a.gearRisk && a.item && rng.chance(a.gearRisk)) {
      a.item.quality = Math.max(0.4, Math.round(((a.item.quality || 1) - 0.15) * 100) / 100);
      say(b, `${a.name}'s ${a.item.name} was damaged (it is above their skill).`, "danger");
    }
  }
  const noise = shotNoise(b, a, w); // stealth.js: a suppressor halves it (and wears a shot)
  b.noise += noise;
  if (noise) b.gunshots = (b.gunshots || 0) + noise / w.noise; // camp danger (fieldheat.js noteGunfire): a muffled shot counts half
  a.face = [Math.sign(t.x - a.x), Math.sign(t.y - a.y)];
  if (a.xpT) a.xpT.shots++;
  const o = shotOdds(b, a, t, a.x, a.y, opts);
  const hit = rng.chance(o.chance / 100);
  let text;
  if (hit) {
    const crit = rng.chance(o.crit / 100);
    const raw = rng.int(o.dmg[0], o.dmg[1]) * (crit ? CRIT_MULT : 1);
    const eff = Math.round(damage(b, t, raw, a, false, { how: "shot", crit, weapon: a.weapon })); // weapon: a shotgun's spread catches a worm swarm (carriers.js swarmArmor)
    if (a.xpT) { a.xpT.hits++; if (t.dead) a.xpT.kills++; } // skills.js: Shooting XP when the battle ends
    text = w.acid ? `${a.name} spits acid at ${t.name}: ${crit ? "critical hit" : "hit"} for ${eff} (${o.chance}%).` : `${a.name} shoots ${t.name}: ${crit ? "critical hit" : "hit"} for ${eff} (${o.chance}%).`;
    fx(b, { type: "shot", from: [a.x, a.y], to: [t.x, t.y], hit: true, crit, dmg: eff, side: a.side, acid: !!w.acid });
  } else {
    text = w.acid ? `${a.name} spits acid at ${t.name} and misses (${o.chance}%).` : `${a.name} shoots at ${t.name} and misses (${o.chance}%).`;
    fx(b, { type: "shot", from: [a.x, a.y], to: [t.x, t.y], hit: false, side: a.side, acid: !!w.acid });
  }
  say(b, text, a.side === "player" ? (hit ? "good" : "info") : hit ? "danger" : "info");
  if (noise && b.raid) alertNear(b, a.x, a.y, (9 + w.noise * 2) * (noise / w.noise), noise < w.noise ? "The muffled shots still carry." : "The gunshots alert everything nearby.");
  else if (noise && noise < w.noise) alertNear(b, a.x, a.y, (9 + w.noise * 2) * (noise / w.noise), "The muffled shots still carry.");
  else if (noise) alertAll(b, "The gunshots alert everyone nearby.");
  // Any hit that leaves a sleeper alive wakes its group, however quiet the weapon (a crossbow bolt, a shot from
  // beyond earshot in a raid).
  if (hit && t.side === "enemy" && !t.dead && !t.aware) alertPod(b, t.pod, `${t.name} cries out!`);
}

function strike(b, a, t) {
  const o = meleeOdds(b, a, t);
  const rng = b.rng;
  const sure = !!a.assassin && t.side === "enemy" && !t.aware; // Assassin (skills.js): sure, critical hit on the unaware
  a.face = [Math.sign(t.x - a.x), Math.sign(t.y - a.y)];
  const amb = a.low ? strikeBonus(b, a) : 1; // a crawler out of hiding (zombietypes.js)
  const gap = t.ztype ? stabsGap(a, t) : false; // a blade from behind or on the unaware finds a dead soldier's gap (deadsoldiers.js)
  const hit = rng.chance(o.chance / 100) || sure;
  if (hit) {
    const crit = rng.chance(o.crit / 100) || sure;
    const eff = Math.round(damage(b, t, rng.int(o.dmg[0], o.dmg[1]) * (crit ? CRIT_MULT : 1) * (a.meleeMult || 1) * amb, a, false, { how: WEAPONS[a.weapon].melee ? "melee" : "bash", crit, sneak: gap })); // meleeMult: Brawler
    if (gap && t.dead) say(b, `${a.name} drives the blade in under ${t.name}'s helmet.`, "good");
    if (a.xpT) { a.xpT.melee++; if (t.dead) a.xpT.kills++; }
    say(b, `${a.name} ${a.kind === "zombie" ? "tears into" : "strikes"} ${t.name} for ${eff}.`, a.side === "player" ? "good" : "danger");
    fx(b, { type: "melee", from: [a.x, a.y], to: [t.x, t.y], hit: true, crit, dmg: eff, side: a.side });
  } else {
    say(b, `${a.name} lunges at ${t.name} and misses.`, "info");
    fx(b, { type: "melee", from: [a.x, a.y], to: [t.x, t.y], hit: false, side: a.side });
  }
  // A struck sleeper that survives wakes its group.
  if (t.side === "enemy" && !t.dead && !t.aware) alertPod(b, t.pod, `${t.name} cries out!`);
}

function heal(b, u, t) {
  take(b, "meds", 1);
  b.medsUsed++;
  if (u.xpT) u.xpT.heals++; // skills.js: Medicine XP when the battle ends
  if (u !== t && u.sid != null && t.sid != null) { // service record (relations.js): rescues and people treated
    if (t.down) ((b.rescuesBy || (b.rescuesBy = {}))[u.sid] || (b.rescuesBy[u.sid] = [])).push(t.sid);
    else (b.healsBy || (b.healsBy = {}))[u.sid] = (b.healsBy[u.sid] || 0) + 1;
  }
  if (t.down) {
    t.stab = true;
    if (u.miracle) t.stabSure = true; // Miracle Worker: always pulls through
    say(b, `${u.name} stabilizes ${t.name}. ${b.raid ? "They will be carried out if a teammate extracts" : "They will live if you hold the field"}.`, "good");
  } else {
    const amt = Math.round((15 + u.medicine * 1.5) * (u.healMult || 1)); // healMult: Steady Hands
    t.hp = Math.min(t.maxHp, t.hp + amt);
    say(b, `${u.name} patches up ${t === u ? "their own wounds" : t.name} (+${amt}).`, "good");
  }
  fx(b, { type: "heal", to: [t.x, t.y] });
  // Each treatment uses the healer's bandage kit a little (the wear is applied when the battle ends); a kit that
  // is used up stops helping.
  if (u.medKit && u.kitBonus) {
    u.kitUses += 1;
    if (u.kitUses >= u.kitLeft) {
      u.medicine -= u.kitBonus;
      u.kitBonus = 0;
      say(b, `${u.name}'s ${u.medKit.name} is used up.`, "info");
    }
  }
}

// Player commands. Returns an error message, or "" when the action happened.
export function combatAct(state, act) {
  const b = state.combat;
  bindDims(b);
  if (!b || b.over) return "";
  if (act.type === "end") {
    if (b.raid && b.raid.choose) b.raid.choose = null; // the street it is (buildingmaps.js)
    if (b.phase === "player") endPlayerTurn(state);
    return "";
  }
  if (act.type === "building") return chooseBuilding(state, act.id);
  // The whole team runs for it (soundRetreat): act.leave lists the downed not to carry. On a base's wall map that is
  // falling back to the yard and the buildings instead (interior.js), as is act "fallBack".
  if (act.type === "soundRetreat") return soundRetreat(state, { leave: act.leave || [] });
  if (act.type === "fallBack") return fallBack(state, { by: "player" });
  if (act.type === "callClear") return callClear(state, b);
  if (b.phase === "deploy") { // deploy.js: placing the defenders before a break-in (or after falling back, interior.js)
    const err = deployAct(state, b, act);
    if (!err) { afterDeploy(state, b); bump(b); }
    return err;
  }
  if (b.phase !== "player") return "Wait for the enemy turn to finish.";
  const u = unitById(b, act.unit);
  // A unit on another storey than the one being looked at (buildingmaps.js storeys): acting with it looks at its floor.
  if (u && u.side === "player" && b.floors && (u.f || 0) !== (b.floor || 0) && activeAny(u)) setFloor(b, u.f || 0);
  if (!u || u.side !== "player" || !active(u) || u.ap < 1) return "That unit cannot act.";
  const t = act.target != null ? unitById(b, act.target) : null;
  switch (act.type) {
    case "move": {
      if (!inside(act.x, act.y)) return "Cannot move there.";
      const r = reachable(b, u, u.mob * u.ap, { manual: true, wary: !!act.wary }); // wary: the raid bot goes round acid (acid.js)
      const c = r.dist[idx(act.x, act.y)];
      if (!isFinite(c) || c === 0) return "Cannot move there.";
      u.ap -= c <= u.mob ? 1 : 2;
      u.hunker = false;
      moveAlong(b, u, pathTo(r, act.x, act.y));
      // skills.js: Stealth XP for moving while enemies still have not noticed anyone.
      if (u.xpT && active(u) && b.units.some((e) => e.side === "enemy" && !e.aware && active(e))) u.xpT.sneak++;
      break;
    }
    case "shoot": {
      if (!t || t.side === "player" || !active(t)) return "No target.";
      if (!isRanged(u)) return "No gun.";
      if (!canFire(b, u)) return "Out of ammo.";
      if (!canSee(b, u, t)) return "No line of sight.";
      fire(b, u, t);
      u.ap = 0;
      break;
    }
    case "melee": {
      if (!t || t.side === "player" || !active(t) || !adjacent(u, t)) return "Must be next to the target.";
      strike(b, u, t);
      u.ap = 0;
      break;
    }
    case "overwatch":
      if (!canFire(b, u)) return "Needs a gun with ammo.";
      u.ow = true; u.ap = 0;
      say(b, `${u.name} is on overwatch.`, "info");
      break;
    case "hunker":
      u.hunker = true; u.ap = 0;
      say(b, `${u.name} hunkers down.`, "info");
      break;
    case "meds": {
      const target = t || u;
      if (target.side !== "player" || target.dead || target.left) return "No one to treat.";
      if (target !== u && !adjacent(u, target)) return "Must be next to them.";
      if (medsLeft(b) < 1) return "No meds left.";
      if (target.stab) return "Already stabilized.";
      if (!target.down && target.hp >= target.maxHp) return "Not hurt.";
      heal(b, u, target);
      u.ap -= 1;
      break;
    }
    case "search": {
      if (!b.raid) return "Nothing to search.";
      const box = act.box != null ? b.raid.containers.find((c) => c.id === act.box) : searchableNear(b, u)[0];
      if (!box || !nearBox(u, box) || (box.searched && !(act.open && box.contents))) return "Move next to something to search first.";
      if (box.lock && !box.lock.open) return lockedMsg(box); // locks.js
      // quick: a rummage (search.js): no action, a share of what is inside, noise. Else a full search: 1 action
      // (by day or in the dark), everything shows, a rummaged container's hidden rest too.
      if (act.quick) {
        const why = quickRefusal(b, u, box);
        if (why) return why;
        searchBox(state, b, u, box, !!act.open, true);
        break;
      }
      // open: the player's search window (ui/inventory.js) moves things by hand. A container already gone through
      // opens again for free.
      const fresh = !box.contents || box.quick;
      if (act.open && !fresh) return "";
      // Bots and tests: a container already opened is a free look; what they take costs hauling time (raidloot.js).
      if (fresh) {
        if (u.ap < searchCost(b, u)) return "No actions left this turn.";
        u.ap -= searchCost(b, u);
      }
      searchBox(state, b, u, box, !!act.open);
      break;
    }
    case "stash": { // raidloot.js: everything carried loose into the vehicle (free; the window does it item by item)
      if (!b.raid || !atVehicle(b, u)) return "Move to the vehicle first.";
      const r = stashAll(state, u.id);
      if (!r.put.length) return r.left ? (u.ap > 0 ? "The vehicle is full." : "No time left this turn to load the vehicle.") : "Nothing carried to put in.";
      say(b, `${u.name} loads ${r.put.join(", ")} into the vehicle.${r.left ? " The rest does not fit." : ""}`, "info");
      return "";
    }
    case "goup": case "godown": { // buildingmaps.js storeys: the stairs (1 action), to the same cell a floor up or down
      if (!b.floors) return "There are no stairs to take here.";
      const so = stairOptions(b, u), up = act.type === "goup";
      if (!(up ? so.up : so.down)) {
        const onStairs = b.cells[idx(u.x, u.y)].k === "stairs";
        return !onStairs ? "Stand on a stairwell first." : up ? (u.f + 1 >= b.floors.length ? "This is the top floor." : "Someone is on the stairs above.") : (!u.f ? "This is the ground floor." : "Someone is on the stairs below.");
      }
      u.ap -= 1;
      u.hunker = false; u.ow = false;
      const from = u.f || 0;
      fx(b, { type: "move", unit: u.id, from: [u.x, u.y], path: [[u.x, u.y]] });
      moveToFloor(b, u, from + (up ? 1 : -1));
      say(b, `${u.name} goes ${up ? "up" : "down"} the stairs to ${/^floor/i.test(b.floors[u.f].name) ? "" : "the "}${b.floors[u.f].name.toLowerCase()}.`, "info");
      setFloor(b, u.f); // the view follows
      detect(b, u);
      break;
    }
    case "extract": {
      if (!b.raid) return "Use Retreat.";
      if (u.f) return "Go down to the ground floor to extract.";
      const z = zoneAt(b, u.x, u.y);
      if (z < 0) return "Move into an extraction zone first.";
      u.left = true; u.exitZone = z; u.ap = 0; u.ow = u.hunker = false;
      say(b, `${u.name} extracts${b.raid.zones[z].vehicle ? " at the vehicle" : ""}.`, "good");
      break;
    }
    case "retreat":
      if (!evacAt(b, u.x, u.y)) return "Move into the evacuation zone first.";
      u.left = true; u.ap = 0; u.ow = u.hunker = false;
      say(b, `${u.name} slips away from the fight.`, "info");
      break;
    case "open": { // locks.js: a locked container or door next to the unit, by key, lockpicks or force
      if (!b.raid) return "Nothing to open.";
      const err = openLock(state, b, u, act, { say, alertNear, fx });
      if (err) return err;
      break;
    }
    case "close": case "brace": case "peek": { // buildingmaps.js: a building's doors (close one, brace one, peek through one)
      if (!b.raid) return "No doors here.";
      const err = doorAct(state, b, u, act, { say, alertNear, fx });
      if (err) return err;
      break;
    }
    case "climb": { // buildingmaps.js: through a window next to the unit (not diagonally); the glass breaks
      if (!b.raid) return "Nothing to climb.";
      const opts = windowsNear(b, u);
      const w = act.x != null ? opts.find((o) => o.x === act.x && o.y === act.y) : opts[0];
      if (!w) return "Stand right next to a window (not diagonally) with room on the far side.";
      if (u.ap < BMAP.CLIMB.ap) return "Not enough actions.";
      const c = b.cells[idx(w.x, w.y)];
      c.k = "smashed";
      b.losCache.fill(0);
      u.ap -= BMAP.CLIMB.ap;
      u.hunker = false;
      const from = [u.x, u.y];
      u.face = [Math.sign(w.to[0] - u.x), Math.sign(w.to[1] - u.y)];
      u.x = w.to[0]; u.y = w.to[1];
      fx(b, { type: "move", unit: u.id, from, path: [[w.x, w.y], [u.x, u.y]] });
      b.raid.heat = Math.min(100, b.raid.heat + BMAP.CLIMB.heat);
      b.noise = (b.noise || 0) + 1;
      say(b, `${u.name} smashes the window and climbs through (Heat +${BMAP.CLIMB.heat}).`, "info");
      alertNear(b, w.x, w.y, BMAP.CLIMB.radius, "Breaking glass carries through the building.");
      b.reach = flood(b.cells, u.x, u.y);
      syncFloor(b);
      detect(b, u);
      break;
    }
    // stealth.js: Subdue (takedowns, knock-outs), Tie up, Throw (bottles, noise makers, firecrackers), Drag.
    case "subdue": case "tie": case "throw": case "drag": {
      const err = stealthAct(state, b, u, t, act);
      if (err) return err;
      break;
    }
    // siege.js: set a ladder up, push one off, swing the ram, set it down or take it up, drop rocks from the walls.
    case "ladder": case "push": case "ram": case "dropRam": case "takeRam": case "drop": {
      const err = siegeAct(state, b, u, t, act);
      if (err) return err;
      break;
    }
    case "crush": { // carriers.js: crush the skull of a body next to the unit, so the worm cannot raise it (1 action, silent)
      const err = crush(b, u, t);
      if (err) return err;
      u.ap -= 1;
      u.hunker = false;
      break;
    }
    case "doubletap": { // carriers.js: a round through a body's head from range (1 action, ammo, the noise of a shot)
      const why = tapRefusal(b, u, t);
      if (why) return why;
      const w = WEAPONS[u.weapon];
      take(b, "ammo", w.ammo);
      b.ammoUsed += w.ammo;
      const noise = shotNoise(b, u, w); // stealth.js: a suppressor halves it
      b.noise += noise;
      if (noise) b.gunshots = (b.gunshots || 0) + noise / w.noise;
      tap(b, u, t);
      if (noise && b.raid) alertNear(b, u.x, u.y, (9 + w.noise * 2) * (noise / w.noise), noise < w.noise ? "The muffled shot still carries." : "The gunshot alerts everything nearby.");
      else if (noise && noise < w.noise) alertNear(b, u.x, u.y, (9 + w.noise * 2) * (noise / w.noise), "The muffled shot still carries.");
      else if (noise) alertAll(b, "The gunshot alerts everyone nearby.");
      u.ap -= 1;
      u.hunker = false;
      break;
    }
    case "pickup": { // carriers.js: pick up a body next to the unit (1 action; slower, no shooting while carrying)
      const err = pickUp(b, u, t);
      if (err) return err;
      u.ap -= 1;
      u.hunker = false;
      break;
    }
    case "dropbody": { // carriers.js: put the carried body down (1 action)
      const err = putDown(b, u);
      if (err) return err;
      u.ap -= 1;
      break;
    }
    case "stowbody": { // carriers.js: the carried body into the team's car (1 action): it cannot rise, and comes home
      const err = stowBody(state, b, u);
      if (err) return err;
      u.ap -= 1;
      break;
    }
    default:
      return "Unknown action.";
  }
  b.acted = true;
  if (b.raid && b.raid.choose) b.raid.choose = null; // acting on the street map: the street it is (buildingmaps.js)
  bump(b);
  if (b.raid && b.raid.folk) folkTick(state, b); // floorfolk.js: the barricaded survivors' door reached, the nest stirring
  checkEnd(state, b);
  if (!b.over && b.phase === "player" && !b.units.some((x) => x.side === "player" && activeAny(x) && x.ap > 0)) endPlayerTurn(state);
  return "";
}

// ---------- turn flow ----------
export function endPlayerTurn(state) {
  const b = state.combat;
  bindDims(b);
  if (!b || b.over || b.phase !== "player") return;
  for (const u of b.units) if (u.side === "player") u.ap = 0;
  b.phase = "enemy";
  for (const u of b.units) if ((u.side === "enemy" || u.side === "third") && activeAny(u)) { u.ap = u.surprised ? 0 : 2; u.ow = false; u.hunker = false; u.surprised = false; } // thirdside.js: the third side moves in the enemy phase too
  // Storeys (buildingmaps.js): the floor the player looks at is kept and restored; the dead drifting between floors
  // arrive, then the next ones are sent; the Heat's waves come in on the ground floor.
  if (b.floors) { b.viewFloor = b.floor || 0; floorArrivals(b); floorDrift(b); }
  zTick(b); // zombietypes.js: spitters and screamers get ready again
  sowerRound(b); // middead.js: Sowers thicken the ground with eggs
  burnBodies(b); // sleepers.js: bodies in the flames burn, a Sleeper's worms with them
  carrierRound(state, b); // carriers.js: bodies near a Carrier and bodies with the worm in them get up (and act this turn); bodies in the flames burn; worm swarms sink
  acidRound(b, ["enemy", "third"]); // acid.js: hostile people and the third side starting their turn in a spitter's acid
  shepherdTurn(b); // decoys.js: an aware Shepherd wakes its pack
  if (b.raid && b.floors && b.floor) { setFloor(b, 0); raidTurn(b); setFloor(b, b.viewFloor); } // the waves come in at the ground floor
  else if (b.raid) raidTurn(b);
  else reinforcements(b);
  if (b.tier) tierEnemyTurn(state, b); // interior.js: the attackers still outside come in through the breaches
  stealthTurn(b); // stealth.js: noise makers still ringing, the knocked out coming to, night eyes for newcomers
  // Sleepers look around at the start of their turn.
  for (const u of b.units) if (u.side === "player" && active(u)) detect(b, u);
  // Every floor that holds an enemy gets its turn (enemyStep swaps to the unit's floor): floor by floor, people first.
  b.queue = b.units.filter((u) => u.side === "enemy" && activeAny(u)).sort((a, c) => ((a.f || 0) - (c.f || 0)) || ((a.kind === "zombie") - (c.kind === "zombie"))).map((u) => u.id);
  for (const u of b.units) if (u.side === "third" && activeAny(u)) b.queue.push(u.id); // thirdside.js: after the enemy
  bump(b);
}

// Processes one enemy unit. Returns the unit that acted, or null when the enemy phase is over.
export function enemyStep(state) {
  const b = state.combat;
  bindDims(b);
  if (!b || b.over || b.phase !== "enemy") return null;
  let u = null;
  while (b.queue.length && !u) {
    const c = unitById(b, b.queue.shift());
    if (c && activeAny(c)) u = c;
  }
  if (u) {
    // Storeys (buildingmaps.js): the AI runs on the unit's own floor, and the player's view floor comes back after.
    const view = b.floors ? b.floor || 0 : null;
    if (b.floors && (u.f || 0) !== view) setFloor(b, u.f || 0);
    aiUnit(b, u);
    if (b.floors && (b.floor || 0) !== view) setFloor(b, view);
  }
  checkEnd(state, b);
  if (!b.over && !b.queue.length) startPlayerTurn(state, b);
  bump(b);
  return u;
}

export function runEnemyPhase(state) {
  for (let i = 0; i < 200 && state.combat && state.combat.phase === "enemy" && !state.combat.over; i++) enemyStep(state);
}

function startPlayerTurn(state, b) {
  b.turn++;
  b.phase = "player";
  if (b.floors && b.viewFloor != null && b.viewFloor !== (b.floor || 0)) setFloor(b, b.viewFloor); // the floor the player was looking at
  burnRound(b); // throwables.js: the flames burn whoever stands in them; fires, smoke and flares burn down
  acidRound(b, ["player"], true); // acid.js: your people standing in a spitter's acid; the pools dry up a round
  for (const u of b.units) {
    if (u.side !== "player") continue;
    u.ow = false; u.hunker = false;
    u.ap = activeAny(u) ? 2 : 0;
    if (u.down && !u.stab && !u.dead && !u.left) {
      u.bleed--;
      if (u.bleed <= 0) {
        u.dead = true;
        const pile = dropHaul(b, u); // raidloot.js: their body, with what they carried loose on it for the others to pick up
        say(b, `${u.name} bled out.${dropHeld(pile) ? " What they carried lies where they fell." : ""}`, "death");
      }
      else say(b, `${u.name} is bleeding out (${u.bleed} turn${u.bleed > 1 ? "s" : ""} left).`, "danger");
    }
  }
  stirBodies(state, b); // carriers.js: bodies in the flames burn; a carrier who went down puts the body down
  burnBodies(b); // sleepers.js: bodies in the flames burn, a Sleeper's worms with them
  terrorRuns(b); // middead.js: whoever a Nightmare's scream panicked spends the turn running
  for (const u of b.units) if (u.side === "player" && active(u)) spotCheck(b, u); // sleepers.js: a body twitches
  // A base battle (interior.js): the wall breached (on to the yard map), the yard lost (the last stand).
  if (b.tier && !b.over) tierPlayerTurn(state, b);
  if (b.raid && b.raid.folk && !b.over) folkTick(state, b); // floorfolk.js: the nest woken by the Heat or the noise of the enemy phase
  offerClear(b);
}

// ---------- the area is clear enough (battlesize.js clearEnough) ----------
// Only a couple of enemies left, far off and unaware (or running): the player is told once and may end the fight
// there (act "callClear", the panel's button) or hunt them down; the battle AI ends it.
function offerClear(b) {
  if (b.over || b.clearOffered || !clearEnough(b)) return;
  b.clearOffered = b.turn;
  const n = b.units.filter((u) => u.side === "enemy" && active(u)).length;
  say(b, `Only ${n === 1 ? "one straggler is" : `${n} stragglers are`} left, far off and unaware. The area is clear enough: finish the fight (Shift+C), or hunt ${n === 1 ? "it" : "them"} down.`, "good");
}
export function callClear(state, b = state.combat) {
  if (!b || b.over) return "The battle is over.";
  if (!clearEnough(b)) return "There are still enemies close by.";
  bindDims(b);
  b.clearedEarly = true;
  say(b, "You call it: the area is clear enough.", "good");
  endBattle(state, b, "victory");
  return "";
}

// Gunfire on infected ground draws more of the dead from the map edge.
function reinforcements(b) {
  const rng = b.rng;
  const noise = b.noise;
  b.noise = 0;
  if (b.infection < 0.1 || !noise || b.reinf >= b.reinfMax) return;
  if (!rng.chance(Math.min(0.5, (b.infection * noise) / 18))) return;
  const edge = rng.pick(["north", "south", "east"]);
  let cells = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const on = edge === "north" ? y === 0 && x >= 5 : edge === "south" ? y === H - 1 && x >= 5 : x === W - 1;
    if (on && b.reach[idx(x, y)] && cellAt(b, x, y).walk && !unitAt(b, x, y)) cells.push([x, y]);
  }
  // On a big map they come in where the fight is, not across an empty field (battlesize.js CONTACT.NEAR).
  const near = spawnRules([0, 0], b.units.filter((u) => u.side === "player" && active(u))).near;
  if (cells.some(([x, y]) => near(x, y))) cells = cells.filter(([x, y]) => near(x, y));
  rng.shuffle(cells);
  const n = Math.min(b.reinfMax - b.reinf, 1 + rng.int(0, Math.round(b.infection)), cells.length);
  if (n <= 0) return;
  for (let i = 0; i < n; i++) {
    const z = enemyUnit(b, rng, "zombies", 2 + b.infection * 3, b.units.filter((u) => u.kind === "zombie").length + 1);
    const zk = nextOfMix(b); // the armoured dead of a military site come in among them (deadsoldiers.js)
    if (zk) applyZType(z, zk, false, 2 + b.infection * 3);
    z.x = cells[i][0]; z.y = cells[i][1];
    z.reinforcement = z.wild = true;
    z.ap = 2;
    b.units.push(z);
  }
  b.reinf += n;
  say(b, `The noise draws more of the dead: ${n} shambling in from the ${edge} edge.`, "danger");
}

// ---------- AI (works for either side) ----------
// Who the AI shoots first (× the worth of a shot): a Shepherd, a screamer, a spitter (zombietypes.js ZTYPES priority),
// the ram's crew (siege.js) and anyone coming over the wall on a ladder.
export const SHOT_PRIORITY = { crew: 1.8, climber: 1.5, windup: 1.5 };
export function shotPriority(b, t) {
  let v = t.ztype && ZTYPES[t.ztype] && ZTYPES[t.ztype].priority ? ZTYPES[t.ztype].priority : 1;
  if (t.ram != null && b.rams && isCrew(b, t)) v *= SHOT_PRIORITY.crew;
  else if (b.cells[t.y * b.w + t.x].k === "siegeladder") v *= SHOT_PRIORITY.climber;
  if (t.windup != null) v *= SHOT_PRIORITY.windup; // a Flinger about to throw (middead.js)
  return v;
}
function bestShot(b, u, foes, opts = {}) {
  if (!canFire(b, u)) return null;
  let best = null;
  for (const t of foes) {
    if (!canSee(b, u, t)) continue;
    const o = shotOdds(b, u, t, u.x, u.y, opts);
    // The expected damage: a dead soldier's plates by this gun (armorVs), a critical hit × CRIT_MULT and through them.
    // A Boneback's plates by where the shooter stands (hitMult).
    const p = o.crit / 100, m = hitMult(t, u, { how: "shot" });
    const avg = (o.dmg[0] + o.dmg[1]) / 2 * ((1 - p) * m + p * CRIT_MULT * hitMult(t, u, { how: "shot", crit: true }));
    let v = (o.chance / 100) * avg;
    if (t.hp <= avg) v *= 1.5;
    v *= shotPriority(b, t);
    if (!best || v > best.v) best = { t, o, v };
  }
  return best;
}

function scoreCell(b, u, x, y, foes, cost, field) {
  let s = -cost * 0.4, best = 0, nearest = 99;
  for (const f of foes) {
    const d = dist(x, y, f.x, f.y);
    nearest = Math.min(nearest, d);
    if (!isRanged(f)) { if (d < 2.5) s -= 10; else if (d < 5) s -= (5 - d) * 2; continue; }
    if (d > sightRange(b, f) || !los(b, x, y, f.x, f.y)) continue;
    const c = coverAgainst(b, x, y, f.x, f.y).level;
    s += c === 2 ? 0 : c === 1 ? -5 : -14;
  }
  if (canFire(b, u)) {
    for (const f of foes) {
      if (dist(x, y, f.x, f.y) > sightRange(b, u, x, y) || !los(b, x, y, f.x, f.y)) continue;
      const o = shotOdds(b, u, f, x, y);
      best = Math.max(best, o.chance + (o.crit - (u.critBonus || 0) >= CRIT.EXPOSED ? 12 : 0)); // a target with no cover
    }
  }
  s += best * 0.3;
  if (!best) s -= 8 + (field ? Math.min(40, field[idx(x, y)]) : nearest);
  if (u.kind !== "zombie" && b.acid && b.acid.length && acidAt(b, x, y)) s -= ACID.stand; // a spitter's acid (acid.js)
  // The last stand (interior.js): once the yard is lost your people keep to the buildings.
  if (u.side === "player" && b.tier && b.tier.stage === "buildings" && b.tier.indoor) s += b.tier.indoor[idx(x, y)] ? 6 : -15;
  return s;
}

// A base battle (deploy.js, interior.js): your people do not go out past the wall line to chase the attackers (the
// gate and the breaches themselves are held from where they are).
const WALL_LINE = new Set(["gate", "breach", "palisade"]);
function outsideBase(b, u, i) {
  return u.side === "player" && !!b.tier && !!b.tier.interior && !b.tier.interior[i] && !WALL_LINE.has(b.cells[i].k);
}

function bestMove(b, u, foes, field = null) {
  const r = reachable(b, u, u.mob);
  field = field || distField(b, foes.map((f) => [f.x, f.y]), u);
  let best = null;
  for (let i = 0; i < W * H; i++) {
    if (!isFinite(r.dist[i]) || r.dist[i] === 0 || outsideBase(b, u, i)) continue;
    const x = i % W, y = (i / W) | 0;
    const sc = scoreCell(b, u, x, y, foes, r.dist[i], field) + b.rng.next() * 1.5;
    if (!best || sc > best.sc) best = { x, y, sc };
  }
  if (best) best.path = pathTo(r, best.x, best.y);
  return best;
}

function aiUnit(b, u) {
  if (!active(u)) return;
  if (u.dormant) { u.ap = 0; return; } // a Sleeper lies where it is (sleepers.js)
  if (u.side === "third") { // thirdside.js: neutrals stay put, defend themselves or run; soldiers fight the dead
    const plan = thirdPlan(b, u);
    if (plan === "hold") { u.ap = 0; return; }
    if (plan === "flee") return flee(b, u);
  }
  const rng = b.rng;
  if (!u.aware && stealthAI(b, u)) return; // stealth.js: finding bodies, going to look where a bottle landed
  if (!u.aware && b.raid) {
    patrol(b, u);
    return;
  }
  if (u.kind === "zombie" && u.side === "enemy" && lureTurn(b, u)) return; // decoys.js: a decoy or a fire it senses
  if (!u.aware) {
    // Sleeping zombies shuffle about (not a Shepherd's pack: it keeps together); sleeping humans hold position.
    if (u.kind === "zombie" && !herded(b, u) && rng.chance(0.4)) {
      const r = reachable(b, u, 1.5);
      const opts = [];
      for (let i = 0; i < W * H; i++) if (r.dist[i] > 0 && isFinite(r.dist[i])) opts.push(i);
      if (opts.length) { const i = rng.pick(opts); moveAlong(b, u, pathTo(r, i % W, (i / W) | 0)); }
    }
    u.ap = 0;
    return;
  }
  if (u.side === "enemy" && u.kind === "human" && !u.fearless && shouldFlee(b)) return flee(b, u);
  if (u.side === "enemy" && u.kind === "human" && siegeAI(b, u)) return; // siege.js: the ram, a ladder, storming, a grenade
  if (u.side === "player" && aiMeds(b, u)) { if (u.ap < 1) return; }
  if (u.post && holdPost(b, u)) return; // deploy.js: a defender posted at the gate or on a tower stays there
  if (u.ztype && zombieTurn(b, u)) return; // zombietypes.js: a screamer shrieks or hangs back, a brute smashes through
  if (!canFire(b, u)) return aiMelee(b, u);
  for (let step = 0; step < 3 && u.ap > 0 && active(u); step++) {
    const foes = foesOf(b, u);
    if (!foes.length) return;
    const shot = bestShot(b, u, foes);
    const field = distField(b, foes.map((f) => [f.x, f.y]), u);
    const here = scoreCell(b, u, u.x, u.y, foes, 0, field);
    if (shot && (u.ap === 1 || (shot.o.chance >= 55 && here > -6))) { fire(b, u, shot.t); u.ap = 0; return; }
    const mv = bestMove(b, u, foes, field);
    if (mv && mv.sc > here + 1) { u.ap -= 1; moveAlong(b, u, mv.path); continue; }
    if (shot) { fire(b, u, shot.t); u.ap = 0; return; }
    // Nothing to shoot and nowhere better to stand: an attacker at a wall, a door or the gate batters it.
    const wall = siegeTarget(b, u);
    if (wall) { bash(b, u, wall[0], wall[1]); u.ap = 0; return; }
    if (u.side === "player" || rng.chance(0.6)) u.ow = true;
    else if (coverSides(b, u.x, u.y).some((c) => c)) u.hunker = true;
    u.ap = 0;
  }
}

// A defender posted at the gate (or a breach) or on a watchtower by the deploy step (deploy.js) holds it: shoots
// what it can see (point blank at the gate), strikes what is next to it, else watches. With nothing in sight or
// within 6 tiles (the dead got past), the post is given up and the usual AI takes over.
// Posts on the yard map (interior.js) kept with nobody in sight: the towers, upper floors and roofs, inside a
// building at a window, by a door.
const STICKY = new Set(["tower", "perch", "inside", "door"]);
// On the wall map (deploy.js) the walkway and the towers ("wall", "tower") are kept while the dead are still outside,
// even with nobody in sight (night); inside a building ("inside", interior.js) the same as a post.
function holdPost(b, u) {
  const foes = foesOf(b, u);
  if (!foes.some((f) => canSee(b, u, f) || dist(u.x, u.y, f.x, f.y) <= 6)) {
    const walls = b.tier && b.tier.map === "wall" && (u.post === "wall" || u.post === "tower") && !foes.some((f) => b.tier.interior && b.tier.interior[idx(f.x, f.y)]);
    const inside = b.tier && b.tier.map === "interior" && STICKY.has(u.post);
    if (!walls && !inside) { u.post = null; return false; }
    if (canFire(b, u)) u.ow = true;
    u.ap = 0;
    return true;
  }
  const adj = foes.filter((f) => adjacent(u, f)).sort((a, c) => a.hp - c.hp);
  const shot = bestShot(b, u, adj.length && u.post === "gate" ? adj : foes);
  if (shot) fire(b, u, shot.t);
  else if (adj.length) strike(b, u, adj[0]);
  else if (canFire(b, u)) u.ow = true;
  else if (coverSides(b, u.x, u.y).some((c) => c)) u.hunker = true;
  u.ap = 0;
  return true;
}

function aiMeds(b, u) {
  if (medsLeft(b) < 1) return false;
  const hurtAlly = b.units.find((o) => o.side === "player" && o.down && !o.stab && !o.dead && !o.left && (o === u || adjacent(u, o)));
  const target = hurtAlly || (u.hp < 40 ? u : null);
  if (!target) return false;
  heal(b, u, target);
  u.ap -= 1;
  return true;
}

function aiMelee(b, u) {
  for (let step = 0; step < 3 && u.ap > 0 && active(u); step++) {
    const foes = foesOf(b, u);
    if (!foes.length) return;
    // Someone holding a barred gate (or door) is behind it: an attacker has to batter it down first.
    const adj = foes.filter((f) => adjacent(u, f) && !(u.side !== (b.holders || "player") && barredCell(b.cells[idx(f.x, f.y)]))).sort((a, c) => a.hp - c.hp);
    if (adj.length) { strike(b, u, adj[0]); u.ap = 0; return; }
    const r = reachable(b, u, u.mob * u.ap);
    const field = distField(b, foes.map((f) => [f.x, f.y]), u);
    let best = null;
    for (let i = 0; i < W * H; i++) {
      if (!isFinite(r.dist[i]) || (r.dist[i] > 0 && outsideBase(b, u, i))) continue;
      const x = i % W, y = (i / W) | 0;
      const nextTo = foes.some((f) => Math.max(Math.abs(f.x - x), Math.abs(f.y - y)) === 1 && !(u.side !== (b.holders || "player") && barredCell(b.cells[idx(f.x, f.y)])));
      const sc = (nextTo ? -100 : field[i]) + r.dist[i] * 0.05 + (u.kind !== "zombie" && b.acid && b.acid.length && acidAt(b, x, y) ? ACID.stand / 3 : 0); // people: not into a spitter's acid (acid.js)
      if (!best || sc < best.sc) best = { x, y, sc, cost: r.dist[i], nextTo };
    }
    if (!best || best.cost === 0) {
      // Nowhere closer to go: a barred door, the gate, a wall section or a window on the way is battered instead.
      const wall = siegeTarget(b, u, field);
      if (wall) { bash(b, u, wall[0], wall[1]); u.ap = 0; return; }
      // Stuck for three turns with someone of yours lying down next to it (the only way through, often): the dead
      // tear into them. No endless standoff behind a downed body.
      u.stuck = (u.stuck || 0) + 1;
      const prey = u.kind === "zombie" && u.stuck >= 3 ? b.units.find((o) => o.side === "player" && o.down && !o.dead && !o.left && adjacent(u, o)) : null;
      if (prey) {
        prey.dead = true;
        dropHaul(b, prey); // raidloot.js: a body like anyone killed in a raid, what they carried loose on it
        u.stuck = 0;
        say(b, `${u.name} tears into ${prey.name}, lying in the way.`, "death");
        fx(b, { type: "melee", from: [u.x, u.y], to: [prey.x, prey.y], hit: true, crit: false, dmg: 0, side: u.side, text: "KILLED" });
      }
      u.ap = 0;
      return;
    }
    u.stuck = 0;
    u.ap -= best.cost <= u.mob ? 1 : 2;
    moveAlong(b, u, pathTo(r, best.x, best.y));
  }
}

// ---------- battering through (base battles) ----------
// An attacker with nowhere closer to go batters a barred door, the gate, a wall section or a window next to it that
// lies on its siege field's way to the defenders (distField with a walker). Returns [x, y] or null.
export function siegeTarget(b, u, field) {
  // The holders never batter their own doors; nor does the third side (thirdside.js: it opens doors, it doesn't break in).
  if (u.side === (b.holders || "player") || u.side === "third") return null;
  field = field || distField(b, foesOf(b, u).map((f) => [f.x, f.y]), u);
  const here = field[idx(u.x, u.y)];
  let best = null;
  for (const [dx, dy] of DIRS8) {
    const x = u.x + dx, y = u.y + dy;
    if (!inside(x, y)) continue;
    const c = b.cells[idx(x, y)];
    if (!breakable(c) || (CELL[c.k].walk && !barredCell(c))) continue;
    if (dx && dy && c.k !== "palisade") continue; // doors, windows and the gate are battered head on
    if (!(field[idx(x, y)] < here) || (best && field[idx(x, y)] >= best.f)) continue;
    best = { x, y, f: field[idx(x, y)] };
  }
  return best ? [best.x, best.y] : null;
}

// One blow (or a burst at the lock) at a structure: always lands. The dead tear with their claws, people with what they
// carry (a gun at a lock costs them no ammo); a Wallbreaker hits three times as hard. At 0 it gives way (breakCell).
export function bash(b, u, x, y) {
  bindDims(b);
  const c = b.cells[idx(x, y)];
  if (!breakable(c)) return 0;
  const w = WEAPONS[u.weapon];
  const base = (w && w.dmg) || BASH;
  // A building's door someone braces from the other side gives way at half the rate (buildingmaps.js).
  const held = (c.k === "idoor" || c.k === "door") && doorHeld(b, c) ? BMAP.BRACE : 1;
  const dmg = Math.max(1, Math.round(b.rng.int(base[0], base[1]) * (u.dmgMult || 1) * siegeRule(u).bash * held));
  const was = c.hp;
  if (b.raid && (c.k === "idoor" || c.k === "door")) doorNoise(b, x, y); // the battering carries: Heat, the dead nearby come too
  c.hp = Math.max(0, c.hp - dmg);
  u.face = [Math.sign(x - u.x), Math.sign(y - u.y)];
  const name = structureName(c).toLowerCase();
  fx(b, { type: "melee", from: [u.x, u.y], to: [x, y], hit: true, crit: false, dmg, side: u.side, text: c.hp > 0 ? `-${dmg}` : "BROKEN" });
  if (c.hp <= 0) breakCell(b, x, y, u);
  else if (was > c.mhp / 2 && c.hp <= c.mhp / 2) say(b, `The ${name} is giving way (${c.hp}/${c.mhp}).`, "danger");
  bump(b);
  return dmg;
}
// A closed door in a building (buildingmaps.js) opens when someone walks into it: it no longer blocks sight. A roller
// door goes up whole (every cell of it) with a racket: Heat and noise in a raid (BMAP.ROLLER).
export function openDoor(b, x, y, u = null) {
  bindDims(b);
  const c = b.cells[idx(x, y)];
  if (!c || c.k !== "idoor") return false;
  const list = [[x, y]];
  if (c.roll) {
    for (let i = 0; i < list.length; i++) for (const [dx, dy] of DIRS4) {
      const nx = list[i][0] + dx, ny = list[i][1] + dy;
      if (inside(nx, ny) && b.cells[idx(nx, ny)].k === "idoor" && b.cells[idx(nx, ny)].roll && !list.some(([px, py]) => px === nx && py === ny)) list.push([nx, ny]);
    }
  }
  for (const [px, py] of list) { const d = b.cells[idx(px, py)]; d.k = "odoor"; if (d.t) d.tOpen = d.t; delete d.t; }
  b.losCache.fill(0);
  if (c.roll && b.raid) {
    b.raid.heat = Math.min(100, b.raid.heat + BMAP.ROLLER.heat);
    b.noise = (b.noise || 0) + 1;
    if (u && u.side === "player") say(b, `${u.name} hauls a roller door up. It rattles loudly (Heat +${BMAP.ROLLER.heat}).`, "danger");
    alertNear(b, x, y, BMAP.ROLLER.radius, "The rattle of the roller door carries.");
  }
  return true;
}

export function structureName(c) {
  return c.k === "gate" ? "Gate" : c.k === "palisade" ? "Wall section" : c.k === "bdoor" || c.k === "idoor" || c.k === "door" ? (c.roll ? "Roller door" : "Door") : c.k === "window" ? "Window" : CELL[c.k].name;
}

// A structure gives way: a wall section becomes a breach (and the walkway behind it comes down), the gate hangs open,
// a door is broken in, a window smashed. Sight lines change, so the line-of-sight cache is cleared.
export function breakCell(b, x, y, by = null) {
  bindDims(b);
  const c = b.cells[idx(x, y)];
  const name = structureName(c).toLowerCase();
  c.hp = 0;
  if (c.k === "palisade") {
    c.k = "breach"; delete c.t; c.h = 0;
    for (const [dx, dy] of DIRS4) {
      if (!inside(x + dx, y + dy)) continue;
      const w = b.cells[idx(x + dx, y + dy)];
      if (w.k === "walkway") { w.k = "rubble"; w.h = 0; }
    }
  } else if (c.k === "gate") c.bar = false;
  else if (c.k === "bdoor") c.k = "doorway";
  else if (c.k === "idoor" || c.k === "door") doorBroken(b, x, y); // a building's door stays broken (buildingmaps.js)
  else if (c.k === "window") c.k = "smashed";
  b.losCache.fill(0);
  if (b.tier) b.tier.broken = (b.tier.broken || 0) + 1;
  say(b, by && by.side === "enemy" ? `${by.kind === "zombie" ? "The dead" : by.name} break${by.kind === "zombie" ? "" : "s"} through the ${name}!` : `The ${name} gives way!`, "danger");
}

function shouldFlee(b) {
  const humans = b.units.filter((u) => u.side === "enemy" && u.kind === "human" && active(u)).length;
  const mine = b.units.filter((u) => u.side === "player" && active(u)).length;
  return humans * 3 <= b.enemyStart && mine >= humans * 2;
}

// The edge enemies run for: east, or the side a base was attacked from (deploy.js, transformBattle).
const exitEdge = (b, x, y) => (b.side === "west" ? x === 0 : b.side === "north" ? y === 0 : b.side === "south" ? y === H - 1 : x === W - 1);
function flee(b, u) {
  if (exitEdge(b, u.x, u.y)) { u.fled = true; u.ap = 0; say(b, `${u.name} runs off.`, "good"); return; }
  // Out of everyone's sight and well clear of them: gone, not a long run to the map's edge (battlesize.js).
  if (u.fleeing && fledFarEnough(b, u)) { u.fled = true; u.ap = 0; say(b, `${u.name} gets away.`, "good"); return; }
  const r = reachable(b, u, u.mob * u.ap);
  const exits = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (exitEdge(b, x, y) && cellAt(b, x, y).walk) exits.push([x, y]);
  const field = distField(b, exits);
  let best = null;
  for (let i = 0; i < W * H; i++) if (isFinite(r.dist[i]) && (best == null || field[i] < field[best])) best = i;
  if (best != null && r.dist[best] > 0) moveAlong(b, u, pathTo(r, best % W, (best / W) | 0));
  if (active(u) && exitEdge(b, u.x, u.y)) { u.fled = true; say(b, `${u.name} breaks and runs.`, "good"); }
  else if (active(u) && !u.fleeing) { u.fleeing = true; say(b, `${u.name} falls back.`, "good"); }
  u.ap = 0;
}

// ---------- sounding the retreat ----------
// The evac strip. Everything that asks "is this cell on the way out?" goes through here (and inEvac), so a strip on
// another map edge (a base battle: deploy.js sets b.evacMask and b.evacSide, away from the attack) goes through inEvac.
export const evacAt = (b, x, y) => inEvac(b, x, y);
function evacCells(b) {
  const out = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (evacAt(b, x, y) && cellAt(b, x, y).walk) out.push([x, y]);
  return out;
}

// The escape check when the retreat is sounded (in percent): 100 − 3 a tile to the strip (walking) − 25 for each
// enemy right next to them − 6 for each shooter that sees them and 4 for each of the dead (or a brawler) within two
// moves (together at most 35) − up to 30 for wounds − 2 a point of armor worn + 1 a point of Scouting + 10 at night;
// carrying a downed teammate −10 and 4.5 a tile instead of 3; 5–95. Safe (100) on the strip with nobody next to
// them, or anywhere with no enemy next to them, in sight or close and nobody to carry. Caught: one blow for each
// enemy next to them (one from the pursuers if none), 18–32 each before armor; at 0 health they are down and left
// behind, otherwise they tear free and get out hurt. A carrier who is caught drops whoever they carried.
export const RETREAT = {
  PER_TILE: 3, CARRY_TILE: 4.5, MAX_TILES: 20, PINNED: 25, SHOOTER: 6, CHASER: 4, THREAT_MAX: 35,
  WOUNDS: 30, ARMOR: 2, SCOUTING: 1, NIGHT: 10, CARRY: 10, MIN: 5, MAX: 95, BLOW: [18, 32],
};

// Why the retreat cannot be sounded now ("" when it can).
export function retreatRefusal(b) {
  if (!b || b.over) return "The battle is over.";
  if (b.raid) return "In a raid you leave by extracting: move into a green extraction zone and press X.";
  // A base's wall map (deploy.js): the retreat is falling back to the yard and the buildings (interior.js).
  if (b.tier && b.tier.map === "wall") return b.phase !== "player" ? (b.phase === "deploy" ? "The fight has not started yet." : "Wait for the enemy turn to finish.") : !b.units.some((u) => u.side === "player" && active(u)) ? "Nobody is left standing to fall back." : "";
  if (!b.evacCols) return "There is no way out of this fight: it has to be won or lost here.";
  if (b.phase !== "player") return b.phase === "deploy" ? "The fight has not started yet." : "Wait for the enemy turn to finish.";
  if (!b.units.some((u) => u.side === "player" && active(u))) return "Nobody is left standing to run.";
  return "";
}

const pursuers = (b) => b.units.filter((e) => e.side === "enemy" && active(e) && e.aware && !e.fleeing);

// One unit's escape odds. carrying: the downed teammate it would carry out. field: walking distance to the strip.
export function escapeOdds(b, u, carrying = null, field = null) {
  bindDims(b);
  field = field || distField(b, evacCells(b));
  const foes = pursuers(b);
  const pinned = foes.filter((e) => adjacent(u, e)).length;
  let shooters = 0, chasers = 0;
  for (const e of foes) {
    if (adjacent(u, e)) continue;
    if (e.kind === "human" && canFire(b, e) && canSee(b, e, u)) shooters++;
    else if ((e.kind === "zombie" || !canFire(b, e)) && dist(e.x, e.y, u.x, u.y) <= e.mob * 2) chasers++;
  }
  const onStrip = evacAt(b, u.x, u.y);
  const raw = onStrip ? 0 : field[idx(u.x, u.y)];
  const tiles = Math.round(Math.min(RETREAT.MAX_TILES, isFinite(raw) ? raw : RETREAT.MAX_TILES));
  const threat = Math.min(RETREAT.THREAT_MAX, shooters * RETREAT.SHOOTER + chasers * RETREAT.CHASER);
  const parts = [];
  const add = (label, v) => { if (Math.round(v)) parts.push([label, Math.round(v)]); };
  add(`${tiles} tile${tiles === 1 ? "" : "s"} to the strip`, -tiles * (carrying ? RETREAT.CARRY_TILE : RETREAT.PER_TILE));
  add(`${pinned} enem${pinned === 1 ? "y" : "ies"} next to them`, -pinned * RETREAT.PINNED);
  add([shooters ? `${shooters} shooter${shooters === 1 ? "" : "s"} in sight` : "", chasers ? `${chasers} close behind` : ""].filter(Boolean).join(", "), -threat);
  add("wounds", -RETREAT.WOUNDS * Math.max(0, 1 - u.hp / u.maxHp));
  add("armor worn", -RETREAT.ARMOR * (u.load || 0));
  add(`Scouting ${u.scouting || 0}`, RETREAT.SCOUTING * (u.scouting || 0));
  add("night", b.night || b.dark ? RETREAT.NIGHT : 0);
  add("smoke cover", b.smoke && b.smoke.length && smokeAt(b, u.x, u.y, SMOKE.near) ? SMOKE.retreat : 0); // a smoke grenade (throwables.js)
  add(carrying ? `carrying ${carrying.name}` : "", carrying ? -RETREAT.CARRY : 0);
  const safe = !pinned && (onStrip ? !carrying : !threat && !carrying);
  const chance = safe ? 100 : Math.max(RETREAT.MIN, Math.min(RETREAT.MAX, 100 + parts.reduce((a, p) => a + p[1], 0)));
  // If caught: the chance the blows put them down (and so leave them behind).
  const lostIfCaught = safe ? 0 : downChance(Math.max(1, pinned), u.hp / Math.max(0.05, u.armor));
  return { chance, safe, parts, pinned, shooters, chasers, tiles, onStrip, lostIfCaught };
}

// Chance that n blows of BLOW[0]..BLOW[1] each add up to at least hp.
export function downChance(n, hp) {
  const [lo, hi] = RETREAT.BLOW;
  let sums = new Map([[0, 1]]);
  for (let i = 0; i < n; i++) {
    const next = new Map();
    for (const [s, p] of sums) for (let v = lo; v <= hi; v++) next.set(s + v, (next.get(s + v) || 0) + p / (hi - lo + 1));
    sums = next;
  }
  let pr = 0;
  for (const [s, p] of sums) if (s >= hp) pr += p;
  return pr;
}

// A downed teammate who could be carried out (one already lying on the strip is carried out at the end anyway).
const carryable = (b, t) => t.side === "player" && t.down && !t.dead && !t.left && !evacAt(b, t.x, t.y);

// The plan if the retreat is sounded now: every standing unit's odds and who carries whom. leave: ids of downed
// teammates not to carry (the confirm's checkboxes). Each downed teammate next to someone standing is carried by the
// one with the best odds (each carries one).
export function retreatPlan(b, leave = []) {
  bindDims(b);
  const field = distField(b, evacCells(b));
  const standing = b.units.filter((u) => u.side === "player" && active(u));
  const carrier = new Map(); // downed unit id → carrier
  const busy = new Set();
  for (const t of b.units.filter((x) => carryable(b, x) && !leave.includes(x.id))) {
    let best = null;
    for (const u of standing) {
      if (busy.has(u.id) || !adjacent(u, t)) continue;
      const o = escapeOdds(b, u, t, field);
      if (!best || o.chance > best.o.chance) best = { u, o };
    }
    if (best) { carrier.set(t.id, best.u); busy.add(best.u.id); }
  }
  const units = standing.map((u) => {
    const tid = [...carrier.keys()].find((k) => carrier.get(k) === u);
    const t = tid != null ? unitById(b, tid) : null;
    return { id: u.id, sid: u.sid, name: u.name, carrying: t ? t.id : null, carryingName: t ? t.name : null, ...escapeOdds(b, u, t, field) };
  });
  const downed = b.units.filter((t) => t.side === "player" && t.down && !t.dead && !t.left).map((t) => ({
    id: t.id, name: t.name, onStrip: evacAt(b, t.x, t.y), stab: !!t.stab, left: leave.includes(t.id),
    by: carrier.has(t.id) ? carrier.get(t.id).name : null, canCarry: carryable(b, t) && standing.some((u) => adjacent(u, t)),
  }));
  const expected = units.reduce((a, p) => a + p.chance / 100, 0);
  const lost = units.reduce((a, p) => a + (1 - p.chance / 100) * p.lostIfCaught, 0);
  return { units, downed, expected, lost };
}

// Sounds the retreat: every unit still standing tries to get out now (escapeOdds), carrying the downed next to
// them. The battle ends as a retreat (a defeat if nobody got out). Returns an error, or "" when it happened.
// opts.leave: downed teammates not to carry; opts.by "ai" (with opts.why) when the AI gives the order.
export function soundRetreat(state, opts = {}) {
  const b = state.combat;
  bindDims(b);
  const err = retreatRefusal(b);
  if (err) return err;
  if (b.tier && b.tier.map === "wall") return fallBack(state, opts); // off the walls, into the yard (interior.js)
  const rng = b.rng;
  const plan = retreatPlan(b, opts.leave || []);
  const rec = b.retreatOrder = { turn: b.turn, by: opts.by || "player", escaped: [], caught: [], carried: [], dropped: [], lines: [] };
  say(b, opts.by === "ai" ? `Your people sound the retreat: ${opts.why || "the fight is lost"}. Everyone runs for the evac strip.` : "You sound the retreat. Everyone runs for the evac strip.", "danger");
  for (const p of plan.units) {
    const u = unitById(b, p.id);
    if (!u || !active(u)) continue;
    const t = p.carrying != null ? unitById(b, p.carrying) : null;
    u.ap = 0; u.ow = u.hunker = false;
    if (p.safe || rng.chance(p.chance / 100)) {
      u.left = true;
      rec.escaped.push(u.sid);
      if (t) { t.left = true; t.carried = true; rec.carried.push(t.sid); }
      const line = `${u.name} ${p.safe ? "gets out" : `makes it out (${p.chance}%)`}${t ? `, carrying ${t.name}` : ""}.`;
      say(b, line, "good");
      rec.lines.push(line);
      continue;
    }
    // Caught: a blow from each enemy next to them (one from the pursuers if none).
    let rawDmg = 0;
    for (let i = 0; i < Math.max(1, p.pinned); i++) rawDmg += rng.int(RETREAT.BLOW[0], RETREAT.BLOW[1]);
    const eff = Math.round(rawDmg * u.armor);
    u.hp = Math.max(0, u.hp - eff);
    rec.caught.push(u.sid);
    fx(b, { type: "melee", from: [u.x, u.y], to: [u.x, u.y], hit: true, crit: false, dmg: eff, side: "enemy" });
    let line;
    if (u.hp <= 0) {
      u.down = true;
      u.bleed = BLEED_TURNS;
      (b.downedIds || (b.downedIds = [])).push(u.sid); // service record (relations.js)
      line = `${u.name} is caught (${p.chance}% to get away) and dragged down (${eff}): left behind.`;
    } else {
      u.left = true;
      rec.escaped.push(u.sid);
      line = `${u.name} is caught (${p.chance}% to get away) but tears free (${eff} damage) and gets out.`;
    }
    if (t) { rec.dropped.push(t.sid); line += ` ${t.name} has to be dropped.`; }
    say(b, line, "death");
    rec.lines.push(line);
  }
  b.acted = true;
  bump(b);
  checkEnd(state, b);
  return "";
}

// ---------- the AI's sense of a lost fight ----------
// Rough fighting strength of each side, Lanchester-style: total firepower × total health (health ÷ armor). A gun
// counts its hit chance (−20 against people, for cover) × its damage; melee and the dead count 40% (they have to
// close in first, through overwatch). Returns the ratio yours ÷ theirs and the share of your team that is down.
function firepower(b, u, vsPeople) {
  const w = WEAPONS[u.weapon];
  if (canFire(b, u)) {
    const ch = Math.max(10, Math.min(95, u.aim + (w.aim || 0) - (vsPeople ? COVER_DEF[1] : 0)));
    return (ch / 100) * ((w.dmg[0] + w.dmg[1]) / 2) * u.dmgMult;
  }
  const d = w.melee ? w.dmg : BASH;
  return (Math.max(10, Math.min(95, u.meleeAim)) / 100) * ((d[0] + d[1]) / 2) * (w.melee ? u.dmgMult : 1) * 0.4;
}
export function fightOutlook(b) {
  bindDims(b);
  const mine = b.units.filter((u) => u.side === "player" && active(u));
  const theirs = b.units.filter((u) => u.side === "enemy" && active(u) && !u.fleeing);
  const team = b.units.filter((u) => u.side === "player" && !(u.left && !u.carried));
  const people = theirs.filter((u) => u.kind === "human").length / Math.max(1, theirs.length);
  const fire = (list, vsPeople) => list.reduce((a, u) => a + firepower(b, u, vsPeople), 0);
  const life = (list) => list.reduce((a, u) => a + u.hp / Math.max(0.05, u.armor), 0);
  const ours = fire(mine, people >= 0.5) * life(mine), them = fire(theirs, true) * life(theirs);
  return {
    ratio: them > 0 ? ours / them : Infinity, mine: mine.length, theirs: theirs.length,
    down: team.filter((u) => u.down || u.dead).length / Math.max(1, team.length),
  };
}

// When the AI sounds the retreat, by style: below this strength ratio, or with this share of the team down and the
// ratio under 1. Cautious pulls out earlier, Aggressive later.
export const RETREAT_AI = {
  cautious: { ratio: 0.45, down: 0.34 },
  balanced: { ratio: 0.3, down: 0.5 },
  aggressive: { ratio: 0.18, down: 0.67 },
};
// The style the AI fights in: the caller's, the battle's (setup.aiStyle), the autopilot's, else Balanced.
const aiStyle = (state, b, opts) => opts.style || b.setup.aiStyle || (state.autopilot && state.governor && state.governor.personality) || "balanced";
// On a base's wall map: off the walls (to the yard and the buildings, interior.js) below this ratio once some of them
// are inside the wall, or with this share of the team down and the ratio under 1.
export const FALL_BACK_AI = { ratio: 0.5, down: 0.34 };
export function retreatAdvice(b, style = "balanced") {
  if (retreatRefusal(b)) return null;
  const o = fightOutlook(b);
  if (b.tier && b.tier.map === "wall") {
    // The wall is worth holding while it stands: outgunned, they leave it only once some are already inside.
    const inside = b.units.some((u) => u.side === "enemy" && active(u) && b.tier.interior[idx(u.x, u.y)]);
    if (inside && o.ratio < FALL_BACK_AI.ratio) return { why: "the walls cannot be held", fallBack: true, ...o };
    if (o.down >= FALL_BACK_AI.down && o.ratio < 1) return { why: "too many are down on the walls", fallBack: true, ...o };
    return null;
  }
  // Defending a base (a break-in map with a way out): giving up means abandoning it, so every style holds on as
  // long as Aggressive does.
  const home = b.setup.layout === "baseDefence" || b.setup.deploy;
  const T = home ? RETREAT_AI.aggressive : RETREAT_AI[style] || RETREAT_AI.balanced;
  if (o.ratio < T.ratio) return { why: "they are outgunned", ...o };
  if (o.down >= T.down && o.ratio < 1) return { why: "too many of them are down", ...o };
  return null;
}

// Runs a whole player turn with the AI (used by headless tests).
// opts.style: the style it fights in (aiStyle); opts.retreat === false: it never sounds the retreat (tools measuring it).
export function autoPlayerTurn(state, opts = {}) {
  const b = state.combat;
  bindDims(b);
  if (b && !b.over && b.phase === "deploy") { endDeploy(b); return void afterDeploy(state, b); } // deploy.js: default positions, then fight
  if (!b || b.over || b.phase !== "player") return;
  // A site with several buildings (buildingmaps.js): the AI picks one by its own dice (or the street), then plays it.
  if (b.raid && b.raid.choose) {
    const list = b.raid.choose;
    const pick = list[Math.floor(hash01(state.seed, "autobuilding", b.tileId, state.hour) * list.length) % list.length];
    chooseBuilding(state, pick.id);
    if (state.combat !== b) return autoPlayerTurn(state, opts);
    b.raid.choose = null;
  }
  if (b.raid) return autoRaidTurn(state);
  if (clearEnough(b)) return void callClear(state, b); // battlesize.js: a couple of far-off stragglers left
  // A fight that is clearly lost: everyone runs for it (soundRetreat), carrying the downed next to them. On a base's
  // wall map: everyone falls back to the yard and the buildings instead (interior.js).
  const giveUp = opts.retreat === false || state.autoRetreat === false ? null : retreatAdvice(b, aiStyle(state, b, opts)); // state.autoRetreat: a test switch
  if (giveUp && giveUp.fallBack) return void fallBack(state, { by: "ai", why: giveUp.why });
  if (giveUp) {
    botRetreatSmoke(state, b, inEvac); // stealth.js: a smoke grenade over the team first, if anyone has one
    return void soundRetreat(state, { by: "ai", why: giveUp.why });
  }
  for (const u of b.units.filter((x) => x.side === "player")) {
    if (b.over) return;
    if (active(u) && u.ap > 0) botSiege(state, b, u); // siege.js: push a ladder, rocks on the ram, lead the ram, set a ladder
    if (active(u) && u.ap > 0) botDecoy(state, b, u); // decoys.js: a decoy to pull the dead off your people
    if (active(u) && u.ap > 0) botAttackThrow(state, b, u); // stealth.js: a grenade, a pipe bomb or a Molotov on a crowd
    if (active(u) && u.ap > 0 && b.tier) tierAI(b, u); // interior.js: into the buildings once the yard is lost
    const skull = botCrush(b, u); // carriers.js: a body in danger next to them (a Carrier near, the worm in it), crushed before it gets up
    if (skull) combatAct(state, skull);
    if (active(u) && u.ap > 0) aiUnit(b, u);
    checkEnd(state, b);
  }
  bump(b);
  if (!b.over) endPlayerTurn(state);
}

// After the deploy step: a fall back ordered in the player's turn (interior.js) gives the enemy the next turn.
export function afterDeploy(state, b) {
  if (!b || b.over || b.phase !== "player" || !b.tier || !b.tier.enemyNext) return;
  b.tier.enemyNext = false;
  for (const u of b.units) if (u.side === "player") u.ap = 0;
  endPlayerTurn(state);
}

// ---------- ending ----------
function checkEnd(state, b) {
  if (b.over) return;
  if (b.raid) {
    if (!b.units.some((u) => u.side === "player" && activeAny(u))) endRaid(state, b); // on any floor (buildingmaps.js storeys)
    return;
  }
  // Attackers still outside a base's wall waiting to come in (interior.js) count as not beaten.
  // A spotted Sleeper lying where it is (sleepers.js) does not hold the field.
  if (!b.units.some((u) => u.side === "enemy" && !u.dormant && (active(u) || (u.off && !u.dead)))) return endBattle(state, b, "victory");
  if (!b.units.some((u) => u.side === "player" && active(u))) endBattle(state, b, b.units.some((u) => u.side === "player" && u.left) ? "retreat" : "defeat");
}

// Ends the open battle now (a battle played out headless that ran too long: defences.js fightNow).
export function endBattleNow(state, outcome) {
  if (state.combat && !state.combat.over) endBattle(state, state.combat, outcome);
}

function endBattle(state, b, outcome) {
  const rng = state.rng;
  b.over = true;
  b.phase = "over";
  const setup = b.setup;
  const cause = `in a fight with ${setup.enemy.name || setup.enemy.kind}`;
  const zombies = setup.enemy.kind === "zombies";
  const hurtIds = [], deadIds = [];
  const lines = [];
  const medic = Math.max(0, ...b.units.filter((u) => u.side === "player" && active(u)).map((u) => u.medicine));
  // A retreat: the downed carried out by the sounded retreat (soundRetreat) or dragged onto the evac strip go with
  // the others, and pull through like the downed after a win (the medic among those who got out).
  const outMedic = Math.max(0, ...b.units.filter((u) => u.side === "player" && u.left && !u.down && !u.dead).map((u) => u.medicine));
  const carriedIds = [];
  for (const u of b.units) {
    if (u.side !== "player") continue;
    const s = survivorById(state, u.sid);
    if (!s || !s.alive) continue;
    let dies = u.dead;
    const carried = outcome === "retreat" && !u.dead && u.down && (u.carried || evacAt(b, u.x, u.y));
    if (carried) {
      dies = !rng.chance(u.stab || u.stabSure ? 1 : 0.5 + outMedic * 0.02);
      if (!dies) carriedIds.push(s.id);
    } else if (!dies && u.down) {
      let live;
      if (outcome === "victory") live = u.stab ? 1 : 0.5 + medic * 0.02;
      else if (outcome === "retreat") live = 0;
      else live = (setup.downedLive ?? (zombies ? 0.1 : 0.35)) + (u.stab ? 0.3 : 0); // setup.downedLive: at your own base the downed can be dragged inside (defences.js)
      if (u.stabSure && outcome !== "retreat") live = 1; // stabilized by a Miracle Worker (skills.js)
      dies = !rng.chance(live);
      if (outcome === "retreat") { lines.push(`${u.name} was left behind and is lost.`); u.lostBehind = true; }
    }
    if (dies) {
      hurt(state, s, 9999, b.tileId, u.wormDeath ? `of the worm, in a fight with ${setup.enemy.name || setup.enemy.kind}` : cause); // carriers.js riseInBattle
      deadIds.push(s.id);
      if (!u.lostBehind) lines.push(u.roseAs != null ? turnedLine(b, u) : carried ? `${u.name} was carried out but did not pull through.` : `${u.name} died.`); // carriers.js: got up as one of the dead
      continue;
    }
    const hp = u.down ? rng.int(5, 15) : u.hp;
    if (hp < s.health - 0.01) hurt(state, s, (s.health - hp) / u.armor, b.tileId, cause);
    else s.health = Math.min(100, Math.max(s.health, hp));
    if (!s.alive) { deadIds.push(s.id); continue; }
    if (s.health < u.startHp - 0.5) hurtIds.push(s.id);
    if (u.down) lines.push(carried ? `${u.name} was carried out, barely alive (health ${Math.round(s.health)}).` : `${u.name} pulled through, barely (health ${Math.round(s.health)}).`);
  }
  if (b.retreatOrder) lines.unshift(...b.retreatOrder.lines);
  wearFielded(state, b, true);
  // carriers.js: the risen still walking take their things into the walking loot; bodies in the car come home (the
  // team keeps its car unless it was beaten); the burnt leave nothing; the swarm's bites leave the worm in the living.
  endBodies(state, b, outcome, outcome !== "defeat");

  const enemies = b.units.filter((u) => u.side === "enemy");
  const original = enemies.filter((u) => !u.reinforcement);
  const killed = original.filter((u) => u.dead).length;
  // The knocked out after a win are prisoners (stealth.js, prisoners.js), stripped of what they carried.
  const captives = battleCaptives(b, outcome);
  // Loot: after a win the dead are bodies to search (inventory.js): enemies carry what they fought with plus
  // some ammo, food, meds and scrap; zombies now and then a pocket item; your fallen keep their own things.
  // result.loot fills up as things are taken (the loot screen, "Take all", or straight away when headless).
  const loot = { supplies: {}, gear: [] };
  b.bodies = [];
  if (outcome === "victory") {
    // carriers.js: a body that got up is one body, the risen one's (with the person's kit); one of yours who got up is
    // their own body as below; a worm swarm leaves none.
    // A burnt body or one laid in the car is no body here (carriers.js); one of the walking dead put down has the
    // person's things on it (walkingBody).
    for (const e of enemies) {
      if (!e.dead || e.roseAs != null || e.ztype === "swarm" || e.ztype === "sleeper" || e.burnt || e.inVehicle) continue;
      if (e.walking) { b.bodies.push(walkingBody(state, b, e)); continue; }
      if (e.turned && e.turned.sid != null) continue;
      b.bodies.push(e.turned ? turnedBody(rng, e) : enemyBody(rng, e, KITS[e.kit] || (e.kind === "zombie" ? null : KITS.raiders)));
    }
    for (const e of captives) { const body = enemyBody(rng, e, KITS[e.kit] || KITS.raiders); body.name = `${e.name} (prisoner)`; b.bodies.push(body); }
    for (const u of b.units) {
      const s = u.side === "player" && deadIds.includes(u.sid) ? survivorById(state, u.sid) : null;
      // carriers.js: still walking as one of the dead, there is no body here (their things stay at the death site
      // or in the armory, world.js killSurvivor); put down, the body is "Dana (turned)".
      if (s && !walksOn(b, u) && !u.burnt && !u.inVehicle) { const body = allyBody(s, u); body.name = turnedName(b, u); b.bodies.push(body); }
    }
    b.bodies = b.bodies.filter((body) => !bodyEmpty(state, body));
  }
  b.result = {
    outcome, enemiesKilled: killed, enemiesLeft: original.length - killed - captives.length,
    survivorsHurt: hurtIds, survivorsDead: deadIds, ammoUsed: b.ammoUsed, loot,
    turns: b.turn, medsUsed: b.medsUsed, extraKilled: enemies.filter((u) => u.reinforcement && u.dead).length,
    // Played on the map: gear wear is done, and the dead were there to search (so handlers add no "loot from the bodies").
    tactical: true, worn: true, bodies: b.bodies.length,
    knockedOut: captives.length, prisoners: captiveRecords(state, b, captives), // prisoners.js: taken home by finishCombat
    carriedIds, // the downed taken out in a retreat
    third: thirdResult(b), // thirdside.js: the survivors or soldiers who were there (null: none)
    // A base battle (interior.js): where it was decided: held at the wall, in the yard, in the buildings; or lost.
    ...(b.tier ? { tier: outcome === "victory" ? b.tier.stage : outcome === "retreat" ? "abandoned" : "overrun", fellBack: b.tier.map === "interior" } : {}),
    // The retreat was sounded (soundRetreat): who got out, who was caught, who was carried or had to be dropped.
    retreatOrder: b.retreatOrder ? { by: b.retreatOrder.by, turn: b.retreatOrder.turn, escaped: b.retreatOrder.escaped.slice(), caught: b.retreatOrder.caught.slice(), carried: b.retreatOrder.carried.slice(), dropped: b.retreatOrder.dropped.slice() } : null,
  };
  b.summary = lines;
  say(b, outcome === "victory" ? "Victory. The area is clear." : outcome === "retreat" ? "You pulled out of the fight." : "Defeat. Your team is down.", outcome === "victory" ? "good" : "death");
  // No one to pick through the bodies by hand (headless tools, auto-combat): take all that fits now.
  if (b.bodies.length && (state.autoCombat || typeof window === "undefined")) takeAllBodies(state);
  bump(b);
}

// When a battle on the map ends, before anything is looted or moved: makeshift gear loses a use, but only on the
// units that took the field and only the item objects they took it with (weapon in hand, every worn armor
// piece). A bandage kit loses one use per treatment its carrier gave. A broken item is gone.
function wearFielded(state, b, fought) {
  battleXp(state, b); // skills.js: XP for what each unit did in this battle (once, as it ends)
  for (const u of b.units) {
    if (u.side !== "player") continue;
    const s = survivorById(state, u.sid);
    if (!s || !s.alive) continue;
    if (fought) for (const [slot, item] of u.fielded || []) if (s.gear[slot] === item) wearSlot(state, s, slot);
    if (u.kitUses && u.medKit && s.gear.tool === u.medKit) wearSlot(state, s, "tool", u.kitUses);
  }
}

// Closes a finished battle: hands the result to the registered handler. take: first take everything that fits
// from the bodies (the default, as before looting existed); either way the rest stays where they fell.
export function closeCombat(state, { take = true } = {}) {
  const b = state.combat;
  if (!b || !b.over) return;
  if (b.bodies && b.bodies.length) {
    if (take) takeAllBodies(state);
    leaveBodies(state, b);
  }
  finishCombat(state, b.setup, b.result);
}

// ======================================================================================
// Raid mode: interactive scavenging. A bigger map with buildings and containers to search,
// roaming enemies that have not seen you yet, Heat that rises every turn, and set extraction
// zones. A vehicle you bring is parked in its own zone: extract there to keep it.
// ======================================================================================

// A raid map's size is the site's (battlesize.js raidDims: Small–Medium for a gas station up to Large for a hospital);
// RAID_W × RAID_H is the Medium one (the terrain scattered over it scales with the area).
export const RAID_W = 32, RAID_H = 24;
export const HEAT_NAMES = ["Quiet", "Stirring", "Swarming", "Overrun"];
// Richness by storey (buildingmaps.js): × perFloor a floor up (the dead and earlier looters stayed low), at most × cap.
export const FLOOR_RICH = { perFloor: 1.1, cap: 1.5 };

// Loot per area type: supplies [chance, min, max] and gear [key, chance] (equipment; every entry its own roll per
// container). The small finds per container (valuables, comforts, throwables) are in loot.js AREA_FINDS.
export const AREAS = {
  house:     { name: "House",          boxes: ["cabinet", "shelf", "locker"],  loot: { food: [0.6, 2, 6], water: [0.35, 2, 4], meds: [0.07, 1, 1], scrap: [0.4, 1, 4], ammo: [0.15, 4, 12] }, gear: [["knife", 0.06], ["pistol", 0.04], ["sportspads", 0.03], ["backpack", 0.03], ["bottle", 0.08], ["flashlight", 0.03], ["bat", 0.03], ["revolver", 0.015], ["slingbag", 0.03], ["binoculars", 0.012], ["telescope", 0.003]] },
  farmhouse: { name: "Farmhouse",      boxes: ["cabinet", "shelf", "locker"],  loot: { food: [0.75, 3, 8], water: [0.4, 2, 5], rawwater: [0.2, 2, 6], ammo: [0.25, 4, 12], meds: [0.05, 1, 1] }, gear: [["huntrifle", 0.06], ["machete", 0.05], ["leverrifle", 0.04], ["shotgun", 0.03], ["revolver", 0.02], ["binoculars", 0.03]] },
  store:     { name: "Store",          boxes: ["shelf", "shelf", "counter"],   loot: { food: [0.85, 4, 10], water: [0.6, 3, 8], meds: [0.06, 1, 1] }, gear: [["firecracker", 0.05], ["flashlight", 0.03], ["slingbag", 0.02], ["hikingpack", 0.01]] },
  kitchen:   { name: "Kitchen",        boxes: ["shelf", "counter", "cabinet"], loot: { food: [0.85, 4, 12], water: [0.6, 3, 6] }, gear: [["knife", 0.08], ["bottle", 0.12]] },
  pharmacy:  { name: "Pharmacy",       boxes: ["shelf", "cabinet", "counter"], loot: { meds: [0.9, 2, 6], food: [0.2, 1, 3] }, gear: [["surgkit", 0.05], ["bandagekit", 0.05]] },
  clinic:    { name: "Clinic",         boxes: ["cabinet", "locker", "shelf"],  loot: { meds: [0.85, 2, 5], water: [0.3, 1, 3] }, gear: [["surgkit", 0.08], ["bandagekit", 0.06]] },
  garage:    { name: "Garage",         boxes: ["locker", "crate", "shelf"],    loot: { fuel: [0.35, 1, 4], parts: [0.45, 1, 2], scrap: [0.7, 3, 8] }, gear: [["machete", 0.05], ["crowbar", 0.06], ["spikedbat", 0.03], ["flashlight", 0.05], ["prybar", 0.05], ["sledge", 0.03]] },
  workshop:  { name: "Workshop",       boxes: ["crate", "locker", "shelf"],    loot: { scrap: [0.8, 4, 10], parts: [0.5, 1, 3], fuel: [0.1, 1, 2] }, gear: [["prybar", 0.05], ["sledge", 0.04], ["crowbar", 0.03], ["kneeguards", 0.02]] },
  warehouse: { name: "Warehouse",      boxes: ["crate", "crate", "shelf"],     loot: { scrap: [0.7, 4, 10], food: [0.35, 3, 8], parts: [0.3, 1, 2], fuel: [0.1, 1, 3] }, gear: [["prybar", 0.03], ["sandbags", 0.03], ["barbedwire", 0.02]] },
  office:    { name: "Offices",        boxes: ["cabinet", "cabinet", "counter"], loot: { scrap: [0.5, 1, 4], parts: [0.15, 1, 1], meds: [0.05, 1, 1], water: [0.3, 1, 3] }, gear: [["fireaxe", 0.03], ["slingbag", 0.03]] },
  armory:    { name: "Armory",         boxes: ["locker", "locker", "crate"],   loot: { ammo: [0.85, 15, 40] }, gear: [["pistol", 0.12], ["shotgun", 0.1], ["vest", 0.1], ["ar", 0.04], ["carbine", 0.05], ["baton", 0.06], ["riotarms", 0.04], ["riotlegs", 0.04], ["revolver", 0.03], ["binoculars", 0.04]] },
  barracks:  { name: "Barracks",       boxes: ["locker", "locker", "cabinet"], loot: { ammo: [0.6, 10, 25], food: [0.4, 3, 6], meds: [0.15, 1, 2] }, gear: [["vest", 0.08], ["plate", 0.04], ["nvg", 0.03], ["milradio", 0.03], ["flashlight", 0.06], ["rucksack", 0.04], ["camonet", 0.03], ["stove", 0.03], ["binoculars", 0.05], ["spotscope", 0.02], ["thermal", 0.02]] },
  motorpool: { name: "Motor pool",     boxes: ["crate", "locker", "shelf"],    loot: { fuel: [0.75, 4, 10], parts: [0.55, 1, 3] }, gear: [["prybar", 0.04], ["sandbags", 0.04], ["barbedwire", 0.03]] },
  barn:      { name: "Barn",           boxes: ["crate", "shelf"],              loot: { food: [0.7, 4, 10], fuel: [0.15, 1, 3], scrap: [0.3, 2, 4] }, gear: [["huntrifle", 0.05], ["sledge", 0.03], ["barbedwire", 0.03], ["beartrap", 0.03], ["prybar", 0.02]] },
  lab:       { name: "Lab",            boxes: ["cabinet", "counter", "shelf"], loot: { meds: [0.3, 1, 2], parts: [0.4, 1, 2], scrap: [0.3, 1, 3] }, gear: [["surgkit", 0.05], ["bandagekit", 0.03], ["telescope", 0.03]] },
  cabin:     { name: "Hunting cabin",  boxes: ["locker", "shelf"],             loot: { food: [0.5, 2, 6], ammo: [0.5, 6, 18], meds: [0.07, 1, 1] }, gear: [["huntrifle", 0.08], ["machete", 0.06], ["leverrifle", 0.04], ["compbow", 0.02], ["beartrap", 0.03], ["stove", 0.03], ["ghillie", 0.02], ["fireaxe", 0.02], ["binoculars", 0.05], ["monocular", 0.03], ["spotscope", 0.02]] },
  hangar:    { name: "Hangar",         boxes: ["crate", "locker", "shelf"],    loot: { fuel: [0.6, 4, 10], parts: [0.5, 1, 3], scrap: [0.5, 3, 6] }, gear: [["prybar", 0.03], ["hikingpack", 0.02]] },
  cellblock: { name: "Cell block",     boxes: ["locker", "cabinet"],           loot: { food: [0.3, 1, 4], scrap: [0.3, 1, 3], ammo: [0.15, 4, 10] }, gear: [["knife", 0.08], ["baton", 0.03]] },
  control:   { name: "Control room",   boxes: ["cabinet", "counter"],          loot: { parts: [0.6, 1, 3], scrap: [0.4, 2, 5] }, gear: [["flashlight", 0.04]] },
  campsite:  { name: "Campsite",       outdoor: true, boxes: ["crate", "crate"], loot: { food: [0.5, 2, 5], water: [0.5, 2, 4], rawwater: [0.25, 2, 5], ammo: [0.25, 4, 10] }, gear: [["knife", 0.05], ["pipespear", 0.05], ["waterfilter", 0.04], ["padding", 0.04], ["hikingpack", 0.03], ["stove", 0.03], ["backpack", 0.02]] },
  wreck:     { name: "Wrecked cars",   outdoor: true, boxes: ["car", "car", "car"], loot: { fuel: [0.25, 1, 3], scrap: [0.5, 1, 4], parts: [0.2, 1, 1], food: [0.15, 1, 3] }, gear: [["pistol", 0.03], ["prybar", 0.02], ["slingbag", 0.02]], alarm: 0.15 },
  pumps:     { name: "Fuel pumps",     outdoor: true, boxes: ["pump", "pump"], loot: { fuel: [0.7, 3, 8] }, gear: [] },
  gunshop:   { name: "Gun counter",    boxes: ["locker", "counter", "shelf"],  loot: { ammo: [0.85, 12, 35], scrap: [0.2, 1, 2] }, gear: [["pistol", 0.12], ["shotgun", 0.1], ["huntrifle", 0.1], ["vest", 0.05], ["kneeguards", 0.05], ["revolver", 0.08], ["leverrifle", 0.06], ["compbow", 0.04], ["xbow", 0.04], ["ghillie", 0.03], ["camonet", 0.03], ["binoculars", 0.06], ["spotscope", 0.03], ["monocular", 0.04]] },
  lockers:   { name: "Locker room",    boxes: ["locker", "locker", "shelf"],   loot: { water: [0.4, 1, 3], meds: [0.06, 1, 1], scrap: [0.3, 1, 3] }, gear: [["sportspads", 0.1], ["footballhelmet", 0.08], ["backpack", 0.06], ["kneeguards", 0.04], ["bat", 0.1]] },
  chapel:    { name: "Chapel",         boxes: ["cabinet", "shelf", "counter"], loot: { food: [0.5, 2, 6], water: [0.5, 2, 5], meds: [0.07, 1, 1] }, gear: [["bandagekit", 0.05]] },
  // First aid on hand: a school nurse, a fire station's first-aid room, a barracks' medical store (medfinds.js).
  nurse:     { name: "First-aid room",  boxes: ["cabinet", "shelf"],             loot: { meds: [0.3, 1, 2], water: [0.3, 1, 2] }, gear: [["bandagekit", 0.06]] },
  // Crash sites (crashes.js): wreckage and cargo cases in the open (locks.js names them and locks some cases).
  milwreck:  { name: "Helicopter wreck", outdoor: true, boxes: ["crate", "crate", "car"], loot: { ammo: [0.7, 10, 30], meds: [0.3, 1, 2], parts: [0.5, 1, 3], scrap: [0.6, 2, 6] }, gear: [["ar", 0.06], ["vest", 0.08], ["plate", 0.04], ["riothelmet", 0.06], ["milradio", 0.04], ["nvg", 0.03], ["assaultpack", 0.05], ["carbine", 0.03], ["rucksack", 0.04], ["camonet", 0.04], ["thermal", 0.03], ["binoculars", 0.04]] },
  medwreck:  { name: "Medevac wreck",    outdoor: true, boxes: ["crate", "crate", "car"], loot: { meds: [0.9, 2, 6], water: [0.4, 1, 4], scrap: [0.4, 1, 4] }, gear: [["surgkit", 0.08], ["bandagekit", 0.12]] },
  newswreck: { name: "News chopper wreck", outdoor: true, boxes: ["crate", "car"], loot: { parts: [0.6, 1, 3], scrap: [0.7, 2, 6], water: [0.3, 1, 3] }, gear: [["hikingpack", 0.04], ["slingbag", 0.06]] },
  fuselage:  { name: "Broken fuselage",  boxes: ["crate", "locker", "crate"], loot: { food: [0.6, 3, 8], water: [0.5, 2, 6], meds: [0.15, 1, 2], ammo: [0.3, 6, 15], parts: [0.3, 1, 2] }, gear: [["assaultpack", 0.05], ["vest", 0.05], ["hikingpack", 0.04], ["slingbag", 0.04]] },
  cargodrop: { name: "Scattered cargo",  outdoor: true, boxes: ["crate", "crate", "crate"], loot: { food: [0.6, 3, 8], water: [0.5, 2, 6], meds: [0.25, 1, 2], preserved: [0.35, 2, 6], ammo: [0.25, 5, 15] }, gear: [["assaultpack", 0.03], ["bandagekit", 0.05], ["rucksack", 0.03], ["stove", 0.03]] },
};
export const AREA_SETS = {
  town: ["house", "house", "store", "garage", "kitchen", "wreck"], city: ["store", "office", "office", "house", "warehouse", "wreck"],
  farm: ["farmhouse", "barn", "barn", "campsite"], gas: ["store", "garage", "pumps", "wreck"], mall: ["store", "store", "lockers", "kitchen", "warehouse"],
  hospital: ["clinic", "clinic", "pharmacy", "office", "kitchen"], police: ["armory", "office", "garage", "cellblock"],
  military: ["armory", "barracks", "motorpool", "warehouse"], prison: ["cellblock", "cellblock", "kitchen", "armory", "clinic"],
  univ: ["lab", "lab", "office", "kitchen"], dam: ["control", "workshop", "warehouse"], airport: ["hangar", "warehouse", "store", "office"],
  factory: ["workshop", "warehouse", "office", "garage"], quarry: ["workshop", "garage", "campsite"],
  forest: ["cabin", "campsite", "wreck"], hills: ["cabin", "campsite"], mountain: ["campsite", "cabin"], plains: ["farmhouse", "barn", "wreck"],
  suburb: ["house", "house", "house", "garage"], water: ["campsite", "wreck"],
  // City blocks.
  autoshop: ["garage", "garage", "workshop", "wreck"], pharmacy: ["pharmacy", "pharmacy", "store", "office"],
  supermarket: ["store", "store", "kitchen", "warehouse", "wreck"], gunstore: ["gunshop", "store", "office", "wreck"],
  hardware: ["workshop", "store", "garage", "warehouse"], apartments: ["house", "house", "house", "kitchen", "garage"],
  office: ["office", "office", "office", "kitchen"], school: ["lockers", "office", "kitchen", "nurse", "lockers"],
  firestation: ["garage", "nurse", "kitchen", "motorpool"], warehouse: ["warehouse", "warehouse", "warehouse", "office", "wreck"],
  // Small-town shops.
  grocery: ["store", "store", "kitchen", "garage"], diner: ["kitchen", "kitchen", "store", "wreck"], motel: ["house", "house", "house", "office", "wreck"],
  church: ["chapel", "kitchen", "house", "campsite"], clinic: ["clinic", "clinic", "pharmacy", "office"], feedstore: ["barn", "store", "warehouse", "garage"],
  // Countryside.
  barn: ["barn", "barn", "campsite"], ranch: ["farmhouse", "barn", "barn", "garage"], cabin: ["cabin", "campsite"],
  lodge: ["cabin", "cabin", "kitchen", "campsite"], campground: ["campsite", "campsite", "campsite", "wreck"], ranger: ["cabin", "office", "garage"],
  radiotower: ["control", "workshop"], truckstop: ["store", "kitchen", "garage", "pumps", "wreck"], crashsite: ["wreck", "wreck", "campsite"],
  // Crash events (crashes.js).
  crash_mil: ["milwreck", "milwreck", "cargodrop", "campsite"], crash_cargo: ["fuselage", "cargodrop", "cargodrop", "wreck"],
  crash_med: ["medwreck", "medwreck", "cargodrop", "wreck"], crash_news: ["newswreck", "wreck", "campsite"], airdrop: ["cargodrop", "cargodrop", "cargodrop", "campsite"],
};

export function raidAreasFor(tile) {
  const t = tile || { terrain: "plains" };
  return (t.loc && AREA_SETS[t.loc.type]) || AREA_SETS[t.terrain] || AREA_SETS.plains;
}

// What an area tends to hold, for tooltips.
export function areaHint(type) {
  const a = AREAS[type];
  if (!a) return "";
  const sup = Object.entries(a.loot).sort((x, y) => y[1][0] - x[1][0]).map(([k]) => k);
  return `Likely: ${sup.join(", ")}${a.gear.length ? ", maybe gear" : ""}`;
}

export const zoneAt = (b, x, y) => (b.raid ? b.raid.zones.findIndex((z) => x >= z.x0 && x < z.x0 + z.w && y >= z.y0 && y < z.y0 + z.h) : -1);
// Containers carry c.f (their floor, buildingmaps.js storeys): the search helpers see the active floor's only.
export const nearBox = (u, c) => (c.f || 0) === (u.f || 0) && Math.max(Math.abs(u.x - c.x), Math.abs(u.y - c.y)) <= 1;
const onFloor = (b, c) => (c.f || 0) === (b.floor || 0);
export const boxAt = (b, x, y) => (b.raid ? b.raid.containers.find((c) => c.x === x && c.y === y && onFloor(b, c) && !c.searched) || b.raid.containers.find((c) => c.x === x && c.y === y && onFloor(b, c)) : null);
export const floorContainers = (b, f = b.floor || 0) => (b.raid ? b.raid.containers.filter((c) => (c.f || 0) === f) : []);
export function searchableNear(b, u) {
  bindDims(b);
  return b.raid ? b.raid.containers.filter((c) => !c.searched && nearBox(u, c) && !(c.lock && !c.lock.open)).sort((a, c) => (a.kind === "body") - (c.kind === "body")) : []; // locked: open it first (locks.js)
}

function genRaidMap(rng, tile, areaTypes, withVehicle) {
  const t = tile || { terrain: "plains" };
  const floor = { plains: "grass", forest: "grass", hills: "dirt", mountain: "gravel", suburb: "grass", city: "rubble", water: "grass" }[t.terrain] || "grass";
  const cells = Array.from({ length: W * H }, () => ({ k: "open", f: floor }));
  const reserved = new Uint8Array(W * H);
  const at = (x, y) => (inside(x, y) ? cells[idx(x, y)] : null);
  const put = (x, y, k, f) => { const c = at(x, y); if (c) { c.k = k; if (f) c.f = f; } };
  const free = (x, y) => { const c = at(x, y); return c && c.k === "open" && !reserved[idx(x, y)] && c.f !== "road" && c.f !== "floor"; };

  // Extraction zones: 3×3 at the edges. The first is where the team comes in.
  const zones = [];
  const zoneSpots = rng.shuffle([
    { side: "west", x0: 0, y0: rng.int(2, H - 5) },
    { side: "east", x0: W - 3, y0: rng.int(2, H - 5) },
    { side: rng.chance(0.5) ? "north" : "south", x0: rng.int(8, W - 11), y0: 0 },
  ]);
  zoneSpots.sort((a, c) => (a.side === "west" ? -1 : c.side === "west" ? 1 : 0));
  for (const zs of zoneSpots) {
    const y0 = zs.side === "south" ? H - 3 : zs.y0;
    zones.push({ x0: zs.x0, y0, w: 3, h: 3, side: zs.side, vehicle: false });
    for (let y = y0 - 1; y <= y0 + 3; y++) for (let x = zs.x0 - 1; x <= zs.x0 + 3; x++) if (inside(x, y)) reserved[idx(x, y)] = 1;
  }
  if (withVehicle) {
    const z = zones[0];
    z.vehicle = true;
    put(z.x0 + 1, z.y0 + 1, "vehicle", "road");
  }

  // Road across the map.
  if (t.road) {
    const r = rng.int(3, H - 5);
    for (let x = 0; x < W; x++) for (const y of [r, r + 1]) if (!reserved[idx(x, y)]) put(x, y, "open", "road");
    for (let i = 0; i < rng.int(2, 4); i++) { const x = rng.int(5, W - 6), y = rng.pick([r, r + 1]); if (!reserved[idx(x, y)]) put(x, y, rng.chance(0.3) ? "truck" : "car"); }
  }

  const rectFree = (x0, y0, w, h) => {
    if (x0 < 1 || y0 < 1 || x0 + w > W - 1 || y0 + h > H - 1) return false;
    for (let y = y0 - 1; y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++) if (!free(x, y)) return false;
    return true;
  };
  const areas = [], containers = [];
  let cid = 1;
  for (const type of areaTypes) {
    const def = AREAS[type];
    if (!def) continue;
    const area = { id: areas.length, type, name: def.name };
    if (def.outdoor) {
      // A cluster of objects around a free spot.
      let cx = 0, cy = 0, ok = false;
      for (let tries = 0; tries < 40 && !ok; tries++) {
        cx = rng.int(5, W - 6); cy = rng.int(2, H - 3);
        ok = free(cx, cy) && free(cx - 1, cy) && free(cx + 1, cy);
      }
      if (!ok) continue;
      const n = rng.int(2, 4);
      let placed = 0;
      for (let tries = 0; tries < 30 && placed < n; tries++) {
        const x = cx + rng.int(-3, 3), y = cy + rng.int(-2, 2);
        if (!free(x, y)) continue;
        const kind = rng.pick(def.boxes);
        put(x, y, kind === "pump" ? "pump" : kind === "car" ? "car" : "crate");
        containers.push({ id: cid++, x, y, area: area.id, kind, searched: false, label: `${def.name}: ${kind === "car" ? "car" : kind === "pump" ? "fuel pump" : "crate"}` });
        placed++;
      }
      Object.assign(area, { x0: cx - 3, y0: cy - 2, w: 7, h: 5, outdoor: true });
      areas.push(area);
      continue;
    }
    // A building with doors, windows and containers against the inside walls.
    let built = false;
    const big = W * H > 900 ? 2 : W * H > 700 ? 1 : 0; // bigger rooms on a bigger map (battlesize.js)
    for (let tries = 0; tries < 40 && !built; tries++) {
      const w = rng.int(5, 8 + big), h = rng.int(4, 6 + Math.min(1, big));
      const x0 = rng.int(4, W - 5 - w), y0 = rng.int(1, H - 1 - h);
      if (!rectFree(x0, y0, w, h)) continue;
      const edge = [];
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        const border = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
        put(x, y, border ? "wall" : "open", "floor");
        const corner = (x === x0 || x === x0 + w - 1) && (y === y0 || y === y0 + h - 1);
        if (border && !corner) edge.push([x, y]);
      }
      rng.shuffle(edge);
      const doors = edge.slice(0, 2);
      doors.forEach(([x, y]) => put(x, y, "open", "floor"));
      edge.slice(2, 2 + rng.int(1, 2)).forEach(([x, y]) => put(x, y, "window"));
      // Inside cells touching a wall, away from doors.
      const spots = [];
      for (let y = y0 + 1; y < y0 + h - 1; y++) for (let x = x0 + 1; x < x0 + w - 1; x++) {
        const byWall = x === x0 + 1 || x === x0 + w - 2 || y === y0 + 1 || y === y0 + h - 2;
        const byDoor = doors.some(([dx, dy]) => Math.abs(dx - x) + Math.abs(dy - y) <= 1);
        if (byWall && !byDoor) spots.push([x, y]);
      }
      rng.shuffle(spots);
      const n = Math.min(spots.length, 5, roomBoxes(rng, w, h)); // a bigger room holds more (battlesize.js)
      for (let i = 0; i < n; i++) {
        const [x, y] = spots[i];
        const kind = rng.pick(def.boxes);
        put(x, y, kind, "floor");
        containers.push({ id: cid++, x, y, area: area.id, kind, searched: false, label: `${def.name}: ${kind}` });
      }
      for (let y = y0 - 1; y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++) if (inside(x, y)) reserved[idx(x, y)] = 1;
      Object.assign(area, { x0, y0, w, h, doors });
      areas.push(area);
      built = true;
    }
  }

  // Terrain cover.
  const scatter = (k, n) => { for (let i = 0; i < Math.round((n * W * H) / (28 * 18)); i++) { const x = rng.int(1, W - 2), y = rng.int(0, H - 1); if (free(x, y)) put(x, y, k); } };
  switch (t.terrain) {
    case "forest": scatter("tree", 70); scatter("rock", 10); break;
    case "hills": scatter("rock", 30); scatter("boulder", 12); scatter("tree", 10); break;
    case "mountain": scatter("boulder", 25); scatter("rock", 20); break;
    case "suburb": scatter("tree", 18); scatter("car", 6); scatter("fence", 8); break;
    case "city": scatter("car", 10); scatter("truck", 3); scatter("crate", 8); break;
    default: scatter("tree", 14); scatter("rock", 10); scatter("fence", 6); break;
  }
  if (t.loc && (t.loc.type === "farm" || t.loc.type === "ranch")) { scatter("hay", 10); for (const c of cells) if (c.f === "grass") c.f = "field"; }
  // Cover over the open ground between the buildings, whatever the map's size (battlesize.js densify).
  densify(cells, W, H, rng, { target: coverTarget(t.terrain), keep: (x, y) => !!reserved[idx(x, y)] || cells[idx(x, y)].f === "floor" });

  // Make sure every zone and every container can be reached from the entry zone.
  const entry = zones[0];
  const start = [entry.x0 + (entry.vehicle ? 0 : 1), entry.y0 + 1];
  const carve = (x0, y0, x1, y1) => {
    let x = x0, y = y0;
    const step = () => { const c = at(x, y); if (c && !CELL[c.k].walk && c.k !== "vehicle") { c.k = "open"; if (c.f === "floor") c.f = "floor"; } };
    while (x !== x1) { x += Math.sign(x1 - x); step(); }
    while (y !== y1) { y += Math.sign(y1 - y); step(); }
  };
  let reach = flood(cells, start[0], start[1]);
  const reachableNear = (c) => DIRS8.some(([dx, dy]) => inside(c.x + dx, c.y + dy) && reach[idx(c.x + dx, c.y + dy)]);
  for (const z of zones.slice(1)) {
    if (!reach[idx(z.x0 + 1, z.y0 + 1)]) { carve(start[0], start[1], z.x0 + 1, z.y0 + 1); reach = flood(cells, start[0], start[1]); }
  }
  for (const c of containers) {
    if (reachableNear(c)) continue;
    const door = areas[c.area]?.doors?.[0];
    if (door) carve(start[0], start[1], door[0], door[1]);
    reach = flood(cells, start[0], start[1]);
    if (!reachableNear(c)) { carve(start[0], start[1], c.x, c.y + (c.y > 0 ? -1 : 1)); reach = flood(cells, start[0], start[1]); }
  }
  const kept = containers.filter((c) => reachableNear(c));
  return { cells, reach, areas, containers: kept, zones };
}

export function createRaid(state, setup) {
  const rng = state.rng;
  const tileId = tileIdOf(setup);
  const tile = state.tiles[tileId];
  const party = state.parties.find((x) => x.id === setup.partyId);
  const withVehicle = !!(party && party.vehicle);
  // A building's own map (buildingmaps.js): a single-building site, or the building picked at a site with several;
  // else the street map as before (at a site with several, the panel offers the buildings first: R.choose).
  const pick = raidBuilding(state, tile, setup);
  let map;
  if (pick) {
    map = buildingMap(state, tileId, pick, withVehicle);
    W = map.w; H = map.h;
    const z = map.zones[0];
    map.reach = flood(map.cells, z.x0 + 1, z.y0 + (withVehicle ? 0 : 1));
    map.areas = map.rooms;
  } else {
    [W, H] = raidDims(tile); // the street map: by the site (battlesize.js: a city center Large, a campground Medium)
    // setup.raid.areas: a street map with these areas (citycrawl.js street events: a crashed ambulance, a checkpoint).
    const types = setup.raid && setup.raid.areas ? setup.raid.areas.slice() : raidAreaTypes(rng, raidAreasFor(tile), W, H); // more rooms and areas on a bigger map
    map = genRaidMap(rng, tile, types, withVehicle);
  }
  const b = {
    setup, tileId: party ? partyTile(party) : tileId, w: W, h: H, cells: map.cells, reach: map.reach,
    place: tile ? (tile.loc ? tile.loc.name : tile.terrain[0].toUpperCase() + tile.terrain.slice(1)) : "Open ground",
    units: [], turn: 1, phase: "player", log: [], fx: [], fxSeq: 0, rev: 1, nextId: 1000,
    pools: party ? [party.supplies, party.cargo ? party.cargo.supplies : {}] : [{}],
    ammoUsed: 0, medsUsed: 0, noise: 0, reinf: 0, infection: tile ? tile.infection || 0 : 0,
    evacCols: 0, over: false, result: null, acted: true, queue: [],
    losCache: new Int8Array(W * H * W * H), rng,
    raid: {
      areas: map.areas, containers: map.containers, zones: map.zones,
      vehicleZone: map.zones.findIndex((z) => z.vehicle), heat: setup.raid?.heat0 || 0, stage: 0, spawned: 0, spawnCap: Math.round(RAID_SIZE.SPAWN_CAP * raidDeadScale(W, H)),
      // Hardcore (hardcore-loot.js): sites hold about twice a normal start's loot, so the cap is higher there.
      found: {}, foundGear: [], richness: Math.max(0.35, Math.min(isHardcore(state) ? 2 : 1.2, (tile ? tile.loot : 0.5) * 1.3)),
      reward: rewardMult(tile), // buildingmaps.js: risk pays (city blocks most, the countryside least)
      // A building's map: which one, its plan (rooms, exits: wanderers.js reads it), its locked doors (locks.js).
      interior: pick ? { id: pick.id, key: pick.key, name: pick.name } : null, plan: pick ? map.plan : null,
      doors: pick ? map.lockedDoors.map((d, i) => ({ id: i + 1, x: d.x, y: d.y, f: d.f || 0, area: d.area, exit: !!d.exit, botSkip: !!d.exit, lock: { kind: d.kind, open: false, tries: 0 } })) : undefined,
      // Several buildings here and the raid started from the State Map: the choice is offered until anyone acts.
      choose: !pick && setup.raid && setup.raid.choose && !setup.raid.building ? buildingOptions(tile) : null,
    },
  };
  // Storeys (buildingmaps.js): every floor its own grid of the same size, the ground floor active; the upper floors'
  // reach floods from the first stairwell. b.cells / b.reach / b.losCache alias the active floor's (setFloor).
  if (pick && map.floors && map.floors.length > 1) {
    const [sx, sy] = map.stairs[0];
    b.floors = map.floors.map((F, i) => ({ cells: F.cells, reach: i === 0 ? map.reach : flood(F.cells, sx, sy), losCache: i === 0 ? b.losCache : null, name: F.name }));
    b.floor = 0;
    b.raid.storeys = map.floors.length;
    b.raid.stairs = map.stairs.map((s) => s.slice());
  } else if (pick) { b.raid.storeys = 1; b.raid.stairs = []; }
  b.reinfMax = 0;
  b.zmix = armoredOf(((setup.enemy.groups || []).find((g) => g.kind === "zombies") || setup.enemy).mix); // the dead drawn in by the Heat
  const occupied = (x, y) => !!unitAt(b, x, y);
  const ok = (x, y) => inside(x, y) && b.reach[idx(x, y)] && cellAt(b, x, y).walk && !occupied(x, y);
  const entry = map.zones[0];

  // Your team starts in the entry zone (next to the vehicle if you brought one).
  const people = combatants(state, setup).slice(0, MAX_PLAYERS);
  const entryCells = [];
  for (let y = entry.y0 - 1; y <= entry.y0 + entry.h; y++) for (let x = entry.x0; x <= entry.x0 + entry.w; x++) entryCells.push([x, y]);
  entryCells.sort((a, c) => (zoneAt(b, c[0], c[1]) === 0) - (zoneAt(b, a[0], a[1]) === 0));
  for (const s of people) {
    const u = playerUnit(b, s);
    const c = entryCells.find(([x, y]) => ok(x, y)) || [entry.x0, entry.y0];
    u.x = c[0]; u.y = c[1];
    b.units.push(u);
  }
  for (const u of b.units) if (u.side === "player") u.fit = { aim: u.aim, dmgMult: u.dmgMult, armor: u.armor, medicine: u.medicine }; // refitUnit
  battlePerks(state, b); // skills.js: perks on the player's units
  raidCarrySetup(state, b); // raidloot.js: each survivor's share of the load, an empty pair of arms for finds

  // Enemies: guards around buildings, the dead scattered about. Nobody has seen you yet.
  const center = [entry.x0 + 1, entry.y0 + 1];
  const groups = setup.enemy.groups || [{ kind: setup.enemy.kind, count: setup.enemy.count, power: setup.enemy.power }];
  let pod = 0, zn = 0, hn = 0;
  const buildings = map.areas.filter((a) => !a.outdoor);
  // thirdside.js: the people on the move (wanderers.js groups with a side, or its armed survivors) come into a building through interiorOccupants instead.
  if (pick) placeInterior(state, b, map, groups.filter((g) => !g.side && !g.wanderer).map((g) => ({ ...g, count: Math.max(0, Math.min(MAX_ENEMIES, Math.round(g.count || 0))) }))); // buildingmaps.js: in the rooms
  for (const g of pick ? [] : groups) {
    // The dead scale with the street map's size (battlesize.js raidDeadScale: more of them over a city center).
    const count = Math.max(0, Math.min(MAX_ENEMIES, Math.round((g.count || 0) * (g.kind === "zombies" ? raidDeadScale(W, H) : 1))));
    if (!count) continue;
    if (g.kind === "zombies") {
      const zl = siteList(rng, g.mix, count); // the armoured dead of a military site or a police station (deadsoldiers.js); the bred kinds met exploring (hivetech.js siteSpecials)
      for (let i = 0; i < count; i++) {
        const u = enemyUnit(b, rng, "zombies", g.power, ++zn);
        if (zl[i]) applyZType(u, zl[i], false, g.power);
        const cells = [];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ok(x, y) && dist(x, y, center[0], center[1]) >= 8 && zoneAt(b, x, y) < 0) cells.push([x, y]);
        const c = rng.pick(cells);
        if (!c) continue;
        u.x = c[0]; u.y = c[1]; u.aware = false; u.pod = pod++; u.home = [c[0], c[1]];
        b.units.push(u);
      }
    } else {
      const home = buildings.length ? rng.pick(buildings) : null;
      const hx = home ? home.x0 + Math.floor(home.w / 2) : rng.int(W / 2, W - 4), hy = home ? home.y0 + Math.floor(home.h / 2) : rng.int(3, H - 4);
      for (let i = 0; i < count; i++) {
        const u = enemyUnit(b, rng, g.kind, g.power, ++hn);
        const cells = [];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ok(x, y) && dist(x, y, hx, hy) <= 5 && dist(x, y, center[0], center[1]) >= 9) cells.push([x, y]);
        const c = rng.pick(cells);
        if (!c) continue;
        u.x = c[0]; u.y = c[1]; u.aware = false; u.pod = pod; u.home = [hx, hy];
        if (g.factionId != null) u.factionId = g.factionId; // prisoners.js: whose people they are
        if (g.side === "neutral" || g.side === "military") thirdSideUnit(b, u, g, i); // thirdside.js: survivors hiding here, a squad clearing it
        b.units.push(u);
      }
      pod++;
    }
  }
  placeBodies(b, state.seed); // sleepers.js: bodies lie about, Sleepers among them
  placeWalking(state, b); // carriers.js: the walking dead that drifted near this tile, among the ordinary dead
  stealthSetup(state, b); // stealth.js: night, flashlights, suppressors, which way the guards face
  b.enemyStart = b.units.filter((u) => u.side === "enemy").length;
  lockRaid(state, b); // locks.js: locked containers and a locked room
  if (pick) {
    const rooms = map.areas.filter((a) => !a.outdoor).length;
    const st = b.raid.storeys > 1 ? ` on ${b.raid.storeys} storeys (the stairs are marked; Go up / Go down takes an action)` : "";
    say(b, `You reach the ${pick.name.toLowerCase()} at ${b.place}. ${map.containers.length} places to search in ${rooms} rooms${st}.`, "info");
    say(b, interiorIntro(b), "info");
  } else say(b, `You slip into ${b.place}. ${map.containers.length} places to search across ${map.areas.length} areas.`, "info");
  if (b.raid.choose) say(b, `Several buildings stand here: pick one to explore from the panel (${b.raid.choose.filter((o) => o.id !== "street").map((o) => o.name).join(", ")}), or search the street.`, "good");
  say(b, "Search next to a container (S). Heat rises every turn and with gunfire; more of the dead arrive as it climbs. Reach a green zone and Extract (X).", "info");
  if (withVehicle) say(b, "Your vehicle waits in the entry zone. Extract there to keep it; leave from another zone and it stays behind.", "info");
  return b;
}

// Picks the building to explore at a site with several (the raid's opening choice, R.choose): its own map replaces the
// street map (a new battle on the same setup); "street" keeps the street map. Only before anyone has acted.
export function chooseBuilding(state, id) {
  const b = state.combat;
  if (!b || !b.raid || !b.raid.choose || b.over) return "Nothing to choose now.";
  if (id === "street") {
    b.raid.choose = null;
    say(b, "You search the street.", "info");
    bump(b);
    return "";
  }
  const opt = b.raid.choose.find((o) => o.id === id);
  if (!opt) return "No such building here.";
  const setup = b.setup;
  setup.raid = { ...(setup.raid || {}), building: id, choose: false };
  state.combat = createRaid(state, setup);
  return "";
}

// Unaware enemies wander: guards walk a beat around their building, the dead shuffle.
function patrol(b, u) {
  const rng = b.rng;
  // floorfolk.js: the nest's dead keep still around their knot; a raider watcher stands his post by the stairwell (both still notice you).
  if (u.nesting || u.watcher) { notice(b, u); if (!u.aware && u.kind === "human") spotBodies(b, u); u.ap = 0; return; }
  if (u.kind === "zombie" && !rng.chance(0.5)) { u.ap = 0; return; }
  const home = u.home || [u.x, u.y];
  if (!u.wp || (u.x === u.wp[0] && u.y === u.wp[1]) || rng.chance(0.15)) {
    const opts = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b.reach[idx(x, y)] && cellAt(b, x, y).walk && dist(x, y, home[0], home[1]) <= (u.kind === "zombie" ? 4 : 6)) opts.push([x, y]);
    u.wp = rng.pick(opts) || home;
  }
  const r = reachable(b, u, u.kind === "zombie" ? 2 : u.mob * 0.6);
  let best = null;
  for (let i = 0; i < W * H; i++) {
    if (!isFinite(r.dist[i]) || r.dist[i] === 0) continue;
    const d = dist(i % W, (i / W) | 0, u.wp[0], u.wp[1]);
    if (!best || d < best.d) best = { i, d };
  }
  if (best && best.d < dist(u.x, u.y, u.wp[0], u.wp[1])) moveAlong(b, u, pathTo(r, best.i % W, (best.i / W) | 0));
  notice(b, u);
  if (!u.aware) spotBodies(b, u); // stealth.js: a guard who walks past a body raises the alarm
  u.ap = 0;
}

// A wandering enemy that walks into view of your people raises the alarm for its group.
export function notice(b, e) {
  if (e.aware || !active(e)) return;
  for (const p of b.units) {
    if (p.side !== "player" || !active(p)) continue;
    const r = detectRange(b, e, p, false); // stealth.js: shorter at night, longer for a flashlight
    if (dist(e.x, e.y, p.x, p.y) <= r && los(b, e.x, e.y, p.x, p.y)) {
      alertPod(b, e.pod, `${e.name} spotted ${p.name}!`);
      return;
    }
  }
}

// Noise wakes everything within earshot (raids, and suppressed shots in ordinary battles; else everyone wakes).
export function alertNear(b, x, y, radius, why) {
  bindDims(b);
  const near = b.units.filter((u) => u.side === "enemy" && !u.aware && active(u) && dist(u.x, u.y, x, y) <= radius);
  if (!near.length && !b.floors) return;
  const pods = new Set(near.map((u) => u.pod));
  for (const u of b.units) if (u.side === "enemy" && !u.aware && active(u) && pods.has(u.pod)) { u.aware = true; if (b.phase === "player") u.surprised = true; }
  // Through the floors (buildingmaps.js storeys): the dead on other storeys hear it too, FLOOR_DAMP tiles further off a
  // storey; they wake (no surprise: they are not in the fight) and drift to the stairs (floorDrift).
  let other = 0;
  if (b.floors) for (const u of b.units) {
    if (u.side !== "enemy" || u.aware || !activeAny(u) || (u.f || 0) === (b.floor || 0) || u.kind !== "zombie") continue;
    if (dist(u.x, u.y, x, y) + FLOOR_DAMP * Math.abs((u.f || 0) - (b.floor || 0)) <= radius) { u.aware = true; other++; }
  }
  if (!near.length && !other) return;
  say(b, why, "danger");
}
const FLOOR_DAMP = 5; // a storey between a noise and a listener counts as this many tiles more

// Heat climbs every turn and with noise. Each new stage brings a wave of the dead.
function raidTurn(b) {
  const R = b.raid;
  const rng = b.rng;
  const noise = b.noise;
  b.noise = 0;
  R.heat = Math.min(100, R.heat + 1.2 + noise * 1.0 + b.infection * 0.6);
  const stage = Math.min(3, Math.floor(R.heat / 25));
  if (stage > R.stage) {
    R.stage = stage;
    say(b, `Heat is now ${HEAT_NAMES[stage]}.`, "danger");
    spawnWave(b, stage + Math.round(b.infection * 2));
  } else if (R.stage >= 2 && rng.chance(0.2 + 0.1 * R.stage)) spawnWave(b, 1 + (R.stage === 3 ? 1 : 0));
}

function spawnWave(b, n) {
  const R = b.raid;
  const rng = b.rng;
  n = Math.min(n, R.spawnCap - R.spawned);
  if (n <= 0) return;
  const players = b.units.filter((u) => u.side === "player" && active(u));
  const cells = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    if (!edge || !b.reach[idx(x, y)] || !cellAt(b, x, y).walk || unitAt(b, x, y) || zoneAt(b, x, y) >= 0) continue;
    if (players.some((p) => dist(p.x, p.y, x, y) < 9)) continue;
    cells.push([x, y]);
  }
  rng.shuffle(cells);
  const made = Math.min(n, cells.length);
  for (let i = 0; i < made; i++) {
    const z = enemyUnit(b, rng, "zombies", 2 + b.infection * 3, b.units.filter((u) => u.kind === "zombie").length + 1);
    const zk = nextOfMix(b); // the armoured dead of a military site come in among them (deadsoldiers.js)
    if (zk) applyZType(z, zk, false, 2 + b.infection * 3);
    z.x = cells[i][0]; z.y = cells[i][1];
    z.reinforcement = z.wild = true;
    z.aware = true;
    b.units.push(z);
  }
  R.spawned += made;
  if (made) say(b, `${made} more of the dead shamble in, drawn by the commotion.`, "danger");
}

// open: the player looks inside (the search window does the taking); else what fits is taken at once (bots, tests).
// quick: a rummage (search.js): part of what is inside shows, the rest stays hidden, and it is heard.
function searchBox(state, b, u, box, open = false, quick = false) {
  const rng = state.rng;
  const R = b.raid;
  const s = survivorById(state, u.sid);
  const scav = (s ? skill(s, "scavenging") : 0) + (u.scavBonus || 0); // scavBonus: Treasure Hunter (skills.js)
  const party = state.parties.find((x) => x.id === b.setup.partyId);
  if (u.xpT && !box.contents) u.xpT.boxes++; // skills.js: Scavenging XP for each container opened
  const rich = box.kind === "body" ? 1 : R.richness * Math.min(FLOOR_RICH.cap, Math.pow(FLOOR_RICH.perFloor, box.f || 0)) * (box.rich || 1); // upper storeys are less picked over (buildingmaps.js); a nest's floor richer still (floorfolk.js)
  const reward = box.kind === "body" ? 1 : R.reward ?? 1; // buildingmaps.js rewardMult: city sites pay more, the countryside less
  // Roll what is inside (once); anything that does not fit stays in the container.
  if (!box.contents) {
    const sup = {}, gear = [];
    if (box.kind === "body" && box.zombie) {
      // One of the dead (inventory.js deadBodyFinds): pockets, now and then a pistol; a dead soldier's kit.
      const f = deadBodyFinds(rng, box.ztype);
      Object.assign(sup, f.sup);
      gear.push(...f.gear);
      if (box.ztype === "spitter") { // the burst acid sac is still dripping
        const eff = Math.round(damage(b, u, rng.int(4, 8), null));
        say(b, `${u.name} gets acid on their hands from the burst sac (${eff}).`, "danger");
      }
    } else if (box.kind === "body") {
      sup.ammo = rng.int(3, 10);
      if (rng.chance(0.25)) sup.food = rng.int(1, 3);
      if (rng.chance(MEDS.BODY_HUMAN)) sup.meds = 1; // medfinds.js
      const kit = KITS[box.kit] || KITS.raiders;
      if (rng.chance(0.3)) {
        const key = rng.chance(0.5) && GEAR[box.weapon] ? box.weapon : rng.pick(kit.loot);
        gear.push(newItem(key, rng.pick([0.7, 0.85, 1])));
      }
      if (kit.finds && rng.chance(BODY_FINDS)) gear.push(newItem(rng.pick(kit.finds), 1)); // what was in their pockets
    } else {
      const def = AREAS[R.areas[box.area].type];
      for (const [k, [p, lo, hi]] of Object.entries(def.loot)) {
        if (!rng.chance(Math.min(0.95, p * (0.6 + 0.4 * rich) * (1 + scav / 40)))) continue;
        sup[k] = Math.max(1, Math.round(rng.int(lo, hi) * (0.6 + 0.5 * rich) * (1 + scav / 25) * reward));
      }
      for (const [key, p] of def.gear) if (rng.chance(p * (0.5 + rich) * (1 + scav / 30) * reward)) gear.push(newItem(key, 1));
      const small = rollAreaFind(rng, R.areas[box.area].type, rich, scav); // loot.js: valuables, comforts, throwables
      if (small) gear.push(small);
      // A book on the shelves (skills.js; its own dice, so nothing else in the raid changes).
      const book = rollBook(state, b.tileId, 0.5 * (u.scavBonus ? 2 : 1), `box${box.id}`);
      if (book) gear.push(book);
      if (def.alarm && box.kind === "car" && rng.chance(def.alarm) && !u.quiet) { // quiet: Quiet Hands never sets one off
        R.heat = Math.min(100, R.heat + 12);
        say(b, "A car alarm goes off! Heat jumps.", "danger");
        alertNear(b, box.x, box.y, 12, "The alarm wakes everything nearby.");
      }
    }
    lockedLoot(state, b, u, box, sup, gear); // locks.js: more in locked things, keys, blueprints (its own dice)
    box.contents = { sup, gear };
  }
  // search.js: a rummage hides part of it (and is heard); a full search brings out what a rummage missed.
  const name = box.kind === "body" ? box.label : box.label.toLowerCase();
  let more = 0;
  if (quick) {
    hideSome(rng, box);
    const came = quickNoise(b, u, box);
    say(b, `${u.name} rummages through the ${name} in a hurry (Heat +${SEARCH.quick.heat})${came ? `: ${came} nearby hear${came === 1 ? "s" : ""} it` : ""}.`, came ? "danger" : "info");
    const cut = quickHurt(state, b, u); // search.js: going fast, a hand on something sharp
    if (cut) {
      say(b, `${u.name} cuts a hand on ${cut.what}${cut.hp ? ` (−${cut.hp} health)` : ""}: it needs dressing.`, "danger");
      fx(b, { type: "loot", to: [box.x, box.y], text: "cut!" });
    }
  } else if (box.hidden || box.quick) more = revealHidden(box);
  if (open) {
    const n = box.contents.gear.length + Object.values(box.contents.sup).filter((v) => v >= 1).length;
    if (!n && !box.quick) { box.searched = true; box.partial = false; }
    if (quick) say(b, `${n ? `${n} thing${n === 1 ? "" : "s"} turn${n === 1 ? "s" : ""} up` : "Nothing turns up"}; a full search may find more.`, n ? "good" : "info");
    else say(b, `${u.name} searches the ${name}: ${n ? `${n} thing${n === 1 ? "" : "s"} inside${more ? ` (${more} the rummage missed)` : ""}` : "nothing useful"}.`, n ? "good" : "info");
    if (!n) fx(b, { type: "loot", to: [box.x, box.y], text: quick ? "nothing yet" : "empty" });
    return;
  }
  // raidloot.js: onto the survivor (pockets, pack, carried) as far as they can carry. After a rummage the bot takes
  // only what the free hauling allows (it rummaged to save its actions).
  const r = party ? (quick ? takeFree(u, () => autoTake(state, b, u, box)) : autoTake(state, b, u, box)) : { got: [], left: box.contents.gear.length };
  const got = r.got;
  const what = got.length ? got.join(", ") : "nothing useful";
  say(b, `${u.name} ${quick ? "grabs" : `searches the ${name}:`} ${what}.${r.left ? (r.outOfTime || quick ? " Out of time for the rest this turn." : " No room for the rest (left inside).") : ""}`, got.length ? "good" : "info");
  if (r.left && !r.outOfTime && !quick && !(box.skipBy || []).includes(u.id)) (box.skipBy || (box.skipBy = [])).push(u.id); // bots: the rest does not fit on them
  fx(b, { type: "loot", to: [box.x, box.y], text: got.length ? `+${got.length > 1 ? got.length + " items" : got[0]}` : "empty" });
}

function endRaid(state, b) {
  const rng = state.rng;
  const R = b.raid;
  b.over = true;
  b.phase = "over";
  const hurtIds = [], deadIds = [], extractedIds = [], carriedIds = [];
  const home = new Set(); // units who come home with what they carry (raidloot.js)
  const lines = [];
  // Someone walked out: the downed can be carried. A stabilized teammate lives; one still bleeding takes the
  // same chance as the downed in a lost battle. With nobody out, everyone still on the map is lost.
  const anyOut = b.units.some((u) => u.side === "player" && u.left && !u.dead);
  const zombies = b.setup.enemy.kind === "zombies";
  for (const u of b.units) {
    if (u.side !== "player") continue;
    const s = survivorById(state, u.sid);
    if (!s || !s.alive) continue;
    const carried = !u.dead && !u.left && u.down && anyOut && (u.stab || rng.chance(zombies ? 0.1 : 0.35));
    if (carried) {
      const hp = rng.int(5, 15);
      if (hp < s.health - 0.01) hurt(state, s, (s.health - hp) / u.armor, b.tileId, `while scavenging ${b.place}`);
      if (!s.alive) { deadIds.push(s.id); lines.push(`${u.name} died.`); continue; }
      carriedIds.push(s.id);
      home.add(u.id);
      hurtIds.push(s.id);
      lines.push(`${u.name} was carried out, barely alive (health ${Math.round(s.health)}).`);
      continue;
    }
    if (u.dead || !u.left) {
      hurt(state, s, 9999, b.tileId, u.dead ? `while scavenging ${b.place}` : `left behind while scavenging ${b.place}`);
      deadIds.push(s.id);
      lines.push(u.roseAs != null ? turnedLine(b, u) : u.dead ? `${u.name} died.` : u.down && anyOut ? `${u.name} bled out before the others could carry them clear.` : `${u.name} was left behind.`);
      continue;
    }
    extractedIds.push(s.id);
    home.add(u.id);
    if (u.hp < s.health - 0.01) hurt(state, s, (s.health - u.hp) / u.armor, b.tileId, `while scavenging ${b.place}`);
    if (!s.alive) { deadIds.push(s.id); continue; }
    if (s.health < u.startHp - 0.5) hurtIds.push(s.id);
  }
  const vehicleKept = R.vehicleZone >= 0 && b.units.some((u) => u.side === "player" && u.left && !u.dead && u.exitZone === R.vehicleZone);
  endBodies(state, b, extractedIds.length ? "extracted" : "defeat", vehicleKept); // carriers.js: the risen still walking take their things into the walking loot; bodies in the car come home with it
  raidHome(state, b, home); // raidloot.js: what the ones who made it carry goes in the team's cargo; the rest is lost
  if (R.vehicleZone >= 0 && extractedIds.length && !vehicleKept) lines.push("Nobody went back to the vehicle. It stays behind at the site.");
  const enemies = b.units.filter((u) => u.side === "enemy");
  const original = enemies.filter((u) => !u.reinforcement);
  const killed = original.filter((u) => u.dead).length;
  const outcome = extractedIds.length ? "extracted" : "defeat";
  const captives = battleCaptives(b, outcome); // stealth.js: tied prisoners dragged into a zone someone left from
  if (captives.length) lines.push(`${captives.map((u) => u.name).join(", ")} ${captives.length === 1 ? "was" : "were"} taken out tied up.`);
  wearFielded(state, b, killed > 0); // makeshift gear wears in a raid only if someone was killed; a med kit by its use
  b.result = {
    knockedOut: captives.length, prisoners: captiveRecords(state, b, captives), // prisoners.js
    outcome, enemiesKilled: killed, enemiesLeft: original.length - killed - captives.length,
    survivorsHurt: hurtIds, survivorsDead: deadIds, ammoUsed: b.ammoUsed,
    loot: { supplies: { ...R.found }, gear: R.foundGear.slice() },
    turns: b.turn, medsUsed: b.medsUsed, extraKilled: enemies.filter((u) => u.reinforcement && u.dead).length,
    tactical: true, worn: true,
    third: thirdResult(b), // thirdside.js: the survivors or soldiers who were there (null: none)
    raid: {
      extractedIds, carriedIds, vehicleKept, hadVehicle: R.vehicleZone >= 0, heat: Math.round(R.heat),
      searched: R.containers.filter((c) => c.searched && c.kind !== "body").length, total: R.containers.filter((c) => c.kind !== "body").length,
      hours: Math.max(1, Math.ceil(b.turn / 6)),
      alerted: original.some((u) => u.kind === "human" && (u.aware || u.dead)),
    },
  };
  b.summary = lines;
  raidLocksEnd(state, b); // locks.js: keys found go on the key ring
  say(b, outcome === "extracted" ? "You made it out." : "Nobody made it out.", outcome === "extracted" ? "good" : "death");
  bump(b);
}

// The raid bot's call to leave (autoRaidTurn; 2026-10-06, the census's testing item 6: a player-style bot that leaves
// earlier and by the odds, so building and crawl balance can be measured without hand play). Made once a turn for the
// whole squad and kept once made (R.botOut = { turn, why }):
//   heat        Heat at HEAT or more (was 55);
//   hurt        at least HURT_SHARE of those standing are under HURT_HP health;
//   down        someone is down and stabilised (carried out if the others get out), or down with no meds left;
//   outnumbered more aware enemies in sight (any floor's, seen by anyone standing on it) than the squad has standing;
//   cut off     a fighter's safe way to the exit (round the aware enemies, botExitDetour) has grown longer than the
//               plain way two turns running, or there has been no safe way for two turns: things are getting between
//               them and the door.
// Per person, as before: badly hurt (HP), a full load, nothing left to search; on a floor with nothing left and Heat at
// FLOOR_HEAT or more, down rather than on to another floor. Tuned against tools/interiortest.js, storeytest.js and
// citycrawltest.js ("the bot gets out of N").
export const BOT_LEAVE = { HEAT: 40, HURT_HP: 60, HURT_SHARE: 0.5, HP: 45, FLOOR_HEAT: 30, DETOUR_TURNS: 2 };
// Walking distance (8-way, walkable cells of the floor shown, no heights) from a unit to the nearest of the target
// cells, keeping clear of the cells the aware enemies on this floor stand on and the ones next to them (avoid = true),
// or plain. Infinity: no such way.
function botExitDetour(b, u, targets, avoid) {
  bindDims(b);
  const goal = new Uint8Array(W * H);
  for (const [x, y] of targets) if (inside(x, y)) goal[idx(x, y)] = 1;
  const block = new Uint8Array(W * H);
  if (avoid) for (const o of b.units) {
    if (o.side === "player" || o.side === "third" || !active(o) || !o.aware || o.dormant || (o.f || 0) !== (u.f || 0)) continue;
    for (const [dx, dy] of [[0, 0], ...DIRS8]) if (inside(o.x + dx, o.y + dy)) block[idx(o.x + dx, o.y + dy)] = 1;
  }
  const d = new Int32Array(W * H).fill(-1);
  const q = [idx(u.x, u.y)];
  d[q[0]] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi], x = i % W, y = (i / W) | 0;
    if (goal[i]) return d[i];
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny)) continue;
      const j = idx(nx, ny);
      if (d[j] >= 0 || !cellAt(b, nx, ny).walk || (block[j] && !goal[j])) continue;
      d[j] = d[i] + 1;
      q.push(j);
    }
  }
  return Infinity;
}

// Headless auto-player for raids: loot what is near, extract when Heat or wounds get bad (BOT_LEAVE).
function autoRaidTurn(state) {
  const b = state.combat;
  const R = b.raid;
  const party = state.parties.find((x) => x.id === b.setup.partyId);
  const stairCells = () => (R.stairs || []).filter(([x, y]) => cellAt(b, x, y).walk);
  const exitCells = () => { const out = []; for (const zz of R.zones) for (let y = zz.y0; y < zz.y0 + zz.h; y++) for (let x = zz.x0; x < zz.x0 + zz.w; x++) if (cellAt(b, x, y).walk) out.push([x, y]); return out; };
  if (R.folk) resolveBattleCards(state); // floorfolk.js: a card raised over the fight (the survivors upstairs) answered by its weights
  // The squad's call to leave, once a turn (BOT_LEAVE above).
  const squad = b.units.filter((x) => x.side === "player" && !x.left && !x.dead);
  const standing = squad.filter(activeAny);
  if (!R.botOut && standing.length) {
    let why = "";
    if (R.heat >= BOT_LEAVE.HEAT) why = "heat";
    else if (standing.filter((x) => x.hp < BOT_LEAVE.HURT_HP).length >= standing.length * BOT_LEAVE.HURT_SHARE) why = "hurt";
    else if (squad.some((x) => x.down && (x.stab || medsLeft(b) <= 0))) why = "down";
    else {
      let seen = 0;
      for (const o of b.units) {
        if (o.side === "player" || o.side === "third" || !active(o) || !o.aware || o.dormant) continue;
        const f = o.f || 0;
        if (standing.some((x) => (x.f || 0) === f && ((b.floor || 0) === f ? canSee(b, x, o) : dist(x.x, x.y, o.x, o.y) <= x.sight))) seen++;
      }
      if (seen > standing.length) why = "outnumbered";
    }
    if (why) R.botOut = { turn: b.turn, why };
  }
  for (const u of b.units.filter((x) => x.side === "player")) {
    if (b.floors && activeAny(u) && (u.f || 0) !== (b.floor || 0)) setFloor(b, u.f || 0); // storeys: each one acts on its own floor
    // Cut off: the safe way to the exit (down the stairs first, upstairs) against the plain one, two turns running.
    if (!R.botOut && active(u) && u.exitTurn !== b.turn) {
      u.exitTurn = b.turn;
      const targets = (u.f || 0) ? stairCells() : exitCells();
      const plain = botExitDetour(b, u, targets, false), safe = botExitDetour(b, u, targets, true);
      const detour = isFinite(plain) ? safe - plain : 0; // Infinity: no safe way at all
      const h = u.exitHist || []; // the last DETOUR_TURNS detours
      const n = BOT_LEAVE.DETOUR_TURNS;
      const grew = h.length >= n && detour > 0 && h.every((v, i) => (v === Infinity ? detour === Infinity && i >= n - 1 : v < (i + 1 < h.length ? h[i + 1] : detour)));
      if (grew) R.botOut = { turn: b.turn, why: "cut off" };
      u.exitHist = [...h.slice(-(n - 1)), detour];
    }
    for (let step = 0; step < 3 && active(u) && u.ap > 0 && !b.over; step++) {
      // raidloot.js: each survivor carries their own finds; with a vehicle, a full one walks back to load it.
      const mine = party ? personalRoom(state, u) : 0, space = party ? trunkSpace(state, b) : null;
      const unload = mine < 2 && space != null && space >= 2 && haulLoad(u) > 0.5 && R.heat < BOT_LEAVE.HEAT && u.noStash !== b.turn;
      if (unload && atVehicle(b, u)) { if (combatAct(state, { type: "stash", unit: u.id })) u.noStash = b.turn; continue; }
      const full = !!party && mine < 2 && !unload;
      const todo = (c) => !botDone(c) && !(c.skipBy && c.skipBy.includes(u.id)); // skipBy: nothing in it fits on this one
      const here = (c) => (c.f || 0) === (u.f || 0); // storeys (buildingmaps.js): this floor's containers
      const hereTodo = R.containers.some((c) => todo(c) && here(c));
      const leave = !!R.botOut || u.hp < BOT_LEAVE.HP || full || !R.containers.some(todo) || (!!b.floors && !hereTodo && R.heat >= BOT_LEAVE.FLOOR_HEAT); // botDone: searched, or a lock it gave up on (locks.js)
      // Storeys: on the way out, down the stairs; with this floor done and more above or below (Heat still low), the
      // stairs toward the nearest floor with something left. On a stairwell: take it.
      const otherFloor = !leave && b.floors && !hereTodo ? nearestFloorWith(b, u, todo) : -1;
      const stairsTo = leave && (u.f || 0) > 0 ? (u.f || 0) - 1 : otherFloor >= 0 ? otherFloor : -1;
      if (stairsTo >= 0 && b.cells[idx(u.x, u.y)].k === "stairs" && u.stairTurn !== b.turn) {
        u.stairTurn = b.turn;
        if (!combatAct(state, { type: stairsTo > (u.f || 0) ? "goup" : "godown", unit: u.id })) continue;
      }
      const z = (u.f || 0) ? -1 : zoneAt(b, u.x, u.y);
      if (leave && z >= 0 && (R.vehicleZone < 0 || z === R.vehicleZone || R.heat > 80)) { combatAct(state, { type: "extract", unit: u.id }); break; }
      // stealth.js: tie up the knocked out, take down an unaware guard next to it, throw a bottle to pull guards away.
      if (!leave && botStealth(state, b, u, combatAct)) continue;
      // buildingmaps.js: on the way out of a building, shut a door on whatever follows, or throw a lure to pull it off.
      const esc = leave && R.interior ? botEscape(state, b, u, (u.f || 0) ? stairCells() : R.zones.map((zz) => [zz.x0 + 1, zz.y0 + 1])) : null;
      if (esc && !combatAct(state, esc)) continue;
      const skull = botCrush(b, u); // carriers.js: a body in danger next to them, crushed before it gets up
      if (skull && !combatAct(state, skull)) continue;
      // Fight only what is close; otherwise keep moving (shooting raises Heat).
      const foes = foesOf(b, u).filter((f) => f.aware && canSee(b, u, f) && dist(u.x, u.y, f.x, f.y) <= (leave ? 1.5 : 4));
      const adj = foes.find((f) => adjacent(u, f));
      const shot = foes.length ? bestShot(b, u, foes) : null;
      const fair = shot && shot.o.chance >= 45;
      // Something next to them and no fair shot (no gun, nothing left to fire, a poor shooter): strike it, as the
      // field AI does (aiMelee), instead of standing in a doorway being chewed on with a dry or a shaky pistol.
      if (adj && !fair) { combatAct(state, { type: "melee", unit: u.id, target: adj.id }); break; }
      if (fair) { combatAct(state, { type: "shoot", unit: u.id, target: shot.t.id }); break; }
      const fallen = medsLeft(b) > 0 ? b.units.find((o) => o.side === "player" && o.down && !o.stab && !o.dead && !o.left && adjacent(u, o)) : null;
      if (fallen) { combatAct(state, { type: "meds", unit: u.id, target: fallen.id }); continue; }
      if (u.hp < 50 && medsLeft(b) > 0 && u.ap > 0) { combatAct(state, { type: "meds", unit: u.id, target: u.id }); continue; }
      const lockAct = !leave ? autoLock(state, b, u) : null; // locks.js: key, picks or force, by the odds and the Heat
      if (lockAct && !combatAct(state, lockAct)) continue;
      // search.js: pressed for time (Heat up, an aware enemy close, on the way out), rummage through what is right
      // here (no action, loud, part of it), grab what is free to haul and move on; else search in full.
      const pressed = botPressed(b, u, leave);
      if (pressed && !full && !unload && u.quickTurn !== b.turn) {
        const q = quickable(searchableNear(b, u).filter(todo))[0];
        if (q && !combatAct(state, { type: "search", unit: u.id, box: q.id, quick: true })) continue;
      }
      // Pressed: leave the rummaged ones for a calmer moment (a full search there costs the action it saved), unless
      // nothing else is left to go to.
      const skipQuick = pressed && R.containers.some((c) => todo(c) && here(c) && !c.quick);
      const nearBoxes = searchableNear(b, u).filter(todo).filter((c) => !skipQuick || !c.quick);
      if (!leave && !unload && nearBoxes.length && (nearBoxes[0].contents || u.ap >= searchCost(b, u))) {
        if (combatAct(state, { type: "search", unit: u.id, box: nearBoxes[0].id })) u.ap = 0;
        continue;
      }
      let targets;
      if (stairsTo >= 0) targets = stairCells(); // storeys: to the stairwell (down to leave, up or down to the next floor worth searching)
      else if (unload) {
        const zz = R.zones[R.vehicleZone];
        targets = [];
        for (let y = zz.y0; y < zz.y0 + zz.h; y++) for (let x = zz.x0; x < zz.x0 + zz.w; x++) if (cellAt(b, x, y).walk) targets.push([x, y]);
      } else if (leave) {
        const zs = R.vehicleZone >= 0 && R.heat <= 80 ? [R.zones[R.vehicleZone]] : R.zones;
        targets = [];
        for (const zz of zs) for (let y = zz.y0; y < zz.y0 + zz.h; y++) for (let x = zz.x0; x < zz.x0 + zz.w; x++) if (cellAt(b, x, y).walk) targets.push([x, y]);
      } else {
        targets = [];
        for (const c of R.containers) if (todo(c) && here(c) && !(skipQuick && c.quick)) for (const [dx, dy] of DIRS8) if (inside(c.x + dx, c.y + dy) && cellAt(b, c.x + dx, c.y + dy).walk) targets.push([c.x + dx, c.y + dy]);
        targets.push(...lockTargets(b)); // locks.js: the doors of a locked room (this floor's)
      }
      if (!targets.length) { u.ap = 0; break; }
      const field = distField(b, targets);
      const r = reachable(b, u, u.mob * u.ap);
      // A spitter's acid (acid.js): not to stop in, and the way there goes round it when it can.
      const pools = b.acid && b.acid.length ? (i) => (acidAt(b, i % W, (i / W) | 0) ? ACID.cost : 0) : null;
      const score = pools ? (i) => field[i] + pools(i) : (i) => field[i];
      let best = null;
      for (let i = 0; i < W * H; i++) if (isFinite(r.dist[i]) && r.dist[i] > 0 && (!best || score(i) < score(best))) best = i;
      if (best == null || field[best] >= field[idx(u.x, u.y)]) {
        // Nowhere better to go (the way is blocked, often by what is coming at them): a shot at anything aware and
        // close rather than waiting with the action unused.
        if (shot) { combatAct(state, { type: "shoot", unit: u.id, target: shot.t.id }); break; }
        u.ap = 0; break;
      }
      const err = combatAct(state, pools ? { type: "move", unit: u.id, x: best % W, y: (best / W) | 0, wary: true } : { type: "move", unit: u.id, x: best % W, y: (best / W) | 0 });
      if (err) { u.ap = 0; break; }
    }
  }
  // Storeys: the view ends on the floor of the first of your people still standing.
  if (b.floors && !b.over) { const first = b.units.find((x) => x.side === "player" && activeAny(x)); if (first && (first.f || 0) !== (b.floor || 0)) setFloor(b, first.f || 0); }
  if (R.folk) resolveBattleCards(state); // a card its moves raised this turn
  bump(b);
  if (!b.over && b.phase === "player") endPlayerTurn(state);
}
// The nearest floor (up first on a tie) with a container the bot still wants (todo), or -1 (storeys, buildingmaps.js).
function nearestFloorWith(b, u, todo) {
  const f = u.f || 0;
  let best = -1;
  for (const c of b.raid.containers) {
    if (!todo(c) || (c.f || 0) === f) continue;
    const g = c.f || 0;
    if (best < 0 || Math.abs(g - f) < Math.abs(best - f) || (Math.abs(g - f) === Math.abs(best - f) && g > best)) best = g;
  }
  return best;
}

export { survivorById, alive, log };
