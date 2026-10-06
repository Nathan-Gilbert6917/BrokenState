// The Carrier, the worm swarm and the human dead on the battle map (every number in hiveconst.js CARRIER; their stats
// as special dead in ZTYPES carrier / swarm). Any battle: a field fight, a raid or a building's interior, a base battle.
//   The worm: the dead carry it, and a Carrier is one of them so full of it that it is swollen. A human body (anyone
//     killed: your people, raiders, soldiers, the third side; never one of the dead, never someone only down or
//     knocked out) within CARRIER.RANGE tiles of a Carrier gets up at once, with no warning: on the Carrier's own turn
//     as it ends its move (carrierTurn), and at the start of the enemy turn for a body killed near one during yours
//     (carrierRound). A body with the worm already in it (wormed: the swarm's dead, someone infested who dies) gets up
//     at the start of the next enemy turn wherever it lies. The map marks a body in danger (endangered: wormed, or a
//     Carrier within CARRIER.SEEK; imminent: within RANGE) so the player can answer first:
//       - Crush skull (combatAct "crush", 1 action, silent, from next to it): any human body, any time; the loot stays.
//       - Double tap (combatAct "doubletap", 1 action, ammo, the noise of a shot, line of sight): the same from range.
//       - Fire on its tile (as it would rise, and at each turn's change): the body and everything on it are gone.
//       - Pick up the body (combatAct "pickup", 1 action; carrying: CARRIER.CARRY × the move distance, half of it,
//         and no shooting; "dropbody" puts it down, "stowbody" puts it in the team's car: a raid's vehicle zone, a
//         field battle's evac strip, and only if the car has room: a body weighs CARRIER.BODY_KG plus its things
//         (parties.js bodyLoad) and counts in the team's load and capacity like any cargo until it is buried or
//         burned). A body carried or in the car cannot rise. Bodies in the car come home (endBodies, bodiesHome):
//         bury (its things to the armory) or burn it on the Armory tab; one with the worm left unburied gets up after
//         CARRIER.BASE_RISE nights (walkingDaily).
//     The battle AI and the raid bot crush a body next to them when it is endangered and no enemy is next to them
//     (botCrush). Where a body lay something else now stands, it gets up on a free tile next to it.
//   The risen (turn): an ordinary zombie (enemyUnit at the battle's power), named after the person ("Dana (turned)"
//     for one of yours or the third side, "Raider 3 (turned)" for the others), up with CARRIER.RISE_AP actions (at
//     once, in the enemy turn it rose in). It keeps what the person wore: armour still takes its share of every hit
//     (your people: inventory.js armorMult of what they wear; others: their armour piece), no guns. It goes for every
//     living thing (wild), and does not count among the enemy the battle began with (reinforcement). The body it rose
//     from is gone from the map (off).
//   Their things, never duplicated or lost (combat.js endBattle / endRaid, endBodies here; inventory.js bodies):
//     - Put down and the battle won: one of yours is their own body to loot ("Dana (turned)", allyBody); anyone else
//       is one body with the person's kit (turnedBody). In a raid the body's container goes with the risen (bodyBox)
//       and lies where they are put down.
//     - Still walking when the battle ends (any side, any outcome): its things leave the death site (or the armory)
//       and go into state.walkingLoot (walkOff): { name, who, sid, kit, armour, tile, day, items, supplies }. The
//       death site stays and says the body walked (site.walked, markers.js deathLabel). Each day an entry drifts a
//       tile (walkingDaily: DRIFT; DRIFT_HIVE toward the nearest hive, else at random). A battle made within
//       WALK_RADIUS tiles of an entry (placeWalking: WALK_CHANCE on the tile, less with distance, at most WALK_MAX)
//       marks one of its ordinary dead as that person (markWalking: "Dana (turned)", in their armour) and takes the
//       entry out of the pool; the log notes the meeting. Put down and the battle won, its body (walkingBody) is
//       looted as usual; still walking at the end it goes back in the pool; put down in a lost fight its things lie
//       at a death site on the tile. A raid's walking dead leaves a body container with the things in it (walkingBox).
//     - Burnt: your fallen's things leave the death site and are gone (claimFallen); an enemy's body is no body.
//   The swarm (releaseSwarm): a Carrier that dies bursts (burst): a worm swarm (ZTYPES.swarm) comes out on its tile;
//     a Sleeper splitting and a Flinger's throw (sleepers.js, middead.js) release the same swarm, so everything here
//     holds for all three. Quick and weak; a single bullet or bolt does CARRIER.SHOT of its damage, a shotgun's spread
//     CARRIER.SHOTGUN (swarmArmor, by the weapon's data.js cat), blades 0.9, blows 1.25, blasts 1.5, fire ZTYPES burn.
//     Each hit on someone living leaves the worm in them CARRIER.INFEST of the time (swarmBite: the unit is wormed;
//     one of yours who lives through the battle has caught it for good: worm.js catchWorm with the cause "swarm" at
//     the end, the normal incubation from there, and since everyone saw the bite it counts as spotted); anyone it
//     kills has it (swarmHit). Whoever has the worm (worm.js hasWorm: any stage) and dies gets up: in a battle as
//     above; on the State Map or at a base (riseOnMap, from world.js killSurvivor): they tear at someone before they
//     are put down, or, alone on the road, walk off with their things into the walking loot. Someone the worm module
//     itself turns, or who is put down by their own people, has the worm cleared before they die and never rises
//     twice; a rise handled here clears it too. With no one to kill the swarm sinks into the ground after
//     CARRIER.SWARM_TURNS enemy turns (sinkSwarms). It leaves no body.
//   The AI: an aware Carrier with none of the living next to it walks to the nearest body within CARRIER.SEEK
//     (carrierTurn); the rest of the time it claws like the others. Your people shoot it first (ZTYPES priority).
// Battles without Carriers, swarms or walking loot nearby play exactly as before (no dice are drawn here otherwise).
import { CARRIER } from "./hiveconst.js";
import { CELL, KITS, say, fx, active, adjacent, enemyUnit, reachable, pathTo, moveAlong, unitAt, canSeeAt, isRanged, canFire, inEvac } from "./combat.js";
import { applyZType } from "./zombietypes.js";
import { fireAt } from "./throwables.js";
import { survivorById, log, day, hurt, atBase, newId, baseById } from "./world.js";
import { armorMult, enemyBody, allItems, stripAll, ensureInv, stow, unlistFromSites, EQUIP_SLOTS } from "./inventory.js";
import { GEAR, SUPPLIES } from "./data.js";
import { partyMembers, cargoRoom, bodyLoad } from "./parties.js";
import { partyVehicle, isCar } from "./vehicles.js";
import { atVehicle, raidVehicle } from "./raidloot.js";
import { hasWorm, catchWorm, clearWorm, wormRise, wormOf, dayHp } from "./worm.js";

const cheb = (a, x, y) => Math.max(Math.abs(a.x - x), Math.abs(a.y - y));
const first = (name) => String(name || "").split(" ")[0];
export const isCarrier = (u) => u.ztype === "carrier";
const carriers = (b) => b.units.filter((u) => isCarrier(u) && active(u));
// The world, for the risen's armour and the pool, where only the battle is at hand (set at every turn's change).
let world = null;
const bind = (state) => { if (state) world = state; return world; };

// ---------- bodies ----------
// A human body lying on the map: one of the living killed, not risen, not carried off or in the car.
export const isBody = (c) => !!c.dead && c.kind === "human" && !c.off && !c.left && !c.fled && c.roseAs == null;
// One that can still get up: not burnt, its skull whole.
export const wormable = (c) => isBody(c) && !c.burnt && !c.crushed;
// In danger: the worm is in it, or a Carrier close enough to reach it. Imminent: within a Carrier's reach now (it
// gets up at the end of this turn unless something is done).
export const endangered = (b, c) => wormable(c) && (!!c.wormed || carriers(b).some((u) => cheb(u, c.x, c.y) <= CARRIER.SEEK));
export const imminent = (b, c) => wormable(c) && (!!c.wormed || carriers(b).some((u) => cheb(u, c.x, c.y) <= CARRIER.RANGE));
// Is the worm about on this map (a Carrier or a swarm alive, or a body with the worm in it)?
export const wormsAbout = (b) => b.units.some((u) => (u.ztype === "carrier" || u.ztype === "swarm") && !u.dead) || b.units.some((c) => wormable(c) && c.wormed);
// The body (if any) lying on a tile.
export const bodyAt = (b, x, y) => b.units.find((c) => isBody(c) && c.x === x && c.y === y && (c.f || 0) === (b.floor || 0)) || null; // on this storey (buildingmaps.js)
// "Dana" for one of yours, "Raider 3's body" for the rest.
export const bodyName = (c) => (c.side === "player" ? c.name : `${c.name}'s body`);

// × the damage a hit does to a worm swarm (deadsoldiers.js armorVs asks, for every swarm on the map): a single
// bullet or bolt goes through it; a shotgun's spread (data.js GEAR cat "shotgun") catches it.
export function swarmArmor(hit, by = null) {
  if (!hit) return CARRIER.BASH; // a trap, a spike pit
  if (hit.how === "shot") {
    const w = hit.weapon || (by && by.weapon);
    return w && GEAR[w] && GEAR[w].cat === "shotgun" ? CARRIER.SHOTGUN : CARRIER.SHOT;
  }
  if (hit.how === "melee") return CARRIER.MELEE;
  if (hit.how === "bash") return CARRIER.BASH;
  if (hit.how === "blast") return CARRIER.BLAST;
  return 1; // fire (ZTYPES.swarm.burn makes it hotter), acid
}

// ---------- fire ----------
// A body on a burning tile burns: it will not get up, and everything on it is gone (claimFallen at the end for one
// of yours; an enemy's leaves no body; a raid's container goes). Returns true if it burnt now.
export function burnBody(b, c) {
  if (!isBody(c) || c.burnt) return false;
  c.burnt = true;
  if (b.raid) { const i = b.raid.containers.findIndex((k) => k.kind === "body" && k.uid === c.id); if (i >= 0) b.raid.containers.splice(i, 1); }
  say(b, `The fire takes ${bodyName(c)}: the worms in it cook, and whatever was on it burns with it.`, c.side === "player" ? "death" : "good");
  return true;
}
function burnUnderFire(b) {
  if (!b.fires || !b.fires.length) return;
  for (const c of b.units) if (isBody(c) && !c.burnt && fireAt(b, c.x, c.y)) burnBody(b, c);
}
// A carrier who is down, dead or gone puts the body down where they are.
function dropIfDown(b) {
  for (const u of b.units) if (u.carrying != null && !active(u)) putDown(b, u, true);
}

// ---------- the dead get up ----------
// A free tile to stand on: the body's own, else one next to it (null: nowhere).
function standAt(b, x, y) {
  const ok = (cx, cy) => cx >= 0 && cy >= 0 && cx < b.w && cy < b.h && CELL[b.cells[cy * b.w + cx].k].walk && !unitAt(b, cx, cy);
  if (ok(x, y)) return [x, y];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && ok(x + dx, y + dy)) return [x + dx, y + dy];
  return null;
}
// The battle's own dead are this strong (the risen and the swarm of a Carrier with no power on record).
const battlePower = (b) => (b.setup && b.setup.enemy && b.setup.enemy.kind === "zombies" && b.setup.enemy.power) || 2 + (b.infection || 0) * 3;
const zombieCount = (b) => b.units.filter((o) => o.kind === "zombie").length + 1;

// One body gets up as one of the dead. Under fire it burns instead. Returns the risen, or null.
export function turn(state, b, c) {
  bind(state);
  if (!wormable(c)) return null;
  if (fireAt(b, c.x, c.y)) { burnBody(b, c); return null; }
  const at = standAt(b, c.x, c.y);
  if (!at) return null; // hemmed in: it gets up when there is room
  const z = enemyUnit(b, b.rng, "zombies", battlePower(b), zombieCount(b));
  const named = c.side === "player" || c.side === "third" ? first(c.name) : c.name;
  z.name = `${named} (turned)`;
  z.x = at[0]; z.y = at[1];
  z.f = c.f ?? z.f; // on the body's own storey (buildingmaps.js), not the one being looked at
  z.face = c.face;
  // What they wore: armour still takes its share; one of yours by what they have on (not the Tough trait).
  const s = c.sid != null && world ? survivorById(world, c.sid) : null;
  z.armor = s ? armorMult(s) : c.wornArmor ?? c.armor ?? 1;
  z.turned = { from: c.id, sid: c.sid ?? null, side: c.side, name: c.name, kit: c.kit || null, weapon: c.weapon || null, armorKey: c.armorKey || null, app: c.app || null };
  z.aware = true;
  z.wild = true; // the dead go for every living thing
  z.reinforcement = true; // not one of the enemy the battle began with
  z.ap = CARRIER.RISE_AP;
  c.roseAs = z.id;
  c.off = true; // the body is gone from where it lay
  // A raid: the body's container (what it carries) goes with it.
  if (b.raid) {
    const box = b.raid.containers.find((k) => k.kind === "body" && k.uid === c.id);
    if (box) { b.raid.containers.splice(b.raid.containers.indexOf(box), 1); z.bodyBox = box; }
  }
  b.units.push(z);
  if (b.phase === "enemy" && b.queue) b.queue.push(z.id); // up in the enemy's turn: it acts at once
  const yours = c.side === "player";
  say(b, yours ? `${c.name} gets up again, the worm in their eyes. ${z.name} is one of the dead now${z.armor < 1 ? ", still in their armour" : ""}.` : `${c.name}'s body gets up: ${z.name} is one of the dead now.`, yours ? "death" : "danger");
  fx(b, { type: "loot", to: [z.x, z.y], text: "RISES" });
  return z;
}
// Every body within reach of one Carrier gets up now.
function raiseNear(b, u) {
  for (const c of [...b.units]) if (wormable(c) && cheb(u, c.x, c.y) <= CARRIER.RANGE) turn(world, b, c);
}

// The start of each player turn (combat.js startPlayerTurn): bodies in the flames burn; a carrier who went down
// puts their load down. Nothing gets up in your turn.
export function stirBodies(state, b) {
  bind(state);
  burnUnderFire(b);
  dropIfDown(b);
}
// The start of each enemy turn (combat.js endPlayerTurn, before the enemy's queue is made: the risen act at once):
// the worm's hour for your infected people (wormBattleRound), bodies with the worm in them and bodies within a
// Carrier's reach get up (or burn), and the swarms sink a turn closer to the ground.
export function carrierRound(state, b) {
  bind(state);
  wormBattleRound(state, b);
  burnUnderFire(b);
  dropIfDown(b);
  for (const c of [...b.units]) if (wormable(c) && c.wormed) turn(state, b, c);
  for (const u of carriers(b)) raiseNear(b, u);
  sinkSwarms(b);
}
function sinkSwarms(b) {
  for (const u of b.units) {
    if (u.ztype !== "swarm" || !active(u)) continue;
    u.life = (u.life ?? CARRIER.SWARM_TURNS) - 1;
    if (u.life > 0) continue;
    u.dead = true; u.off = true; u.sank = true;
    say(b, `${u.name} sinks into the ground: with no one to go to, the worms are gone.`, "good");
  }
}

// ---------- a Carrier bursts; the swarm ----------
// combat.js damage, as a Carrier dies: the worm swarm comes out where it fell.
export function burst(b, t) {
  const w = releaseSwarm(b, t.x, t.y, t.power || battlePower(b));
  if (w) say(b, `${t.name} bursts open: a swarm of worms pours out of it. Its bite leaves the worm in people, and whoever it kills gets up as one of the dead. Shotguns, fire and blows hurt it; a single bullet goes straight through.`, "danger");
  return w;
}
// A worm swarm comes out at (x, y), or on a free tile next to it (null: nowhere): a Carrier bursting, a Sleeper
// splitting open, a Flinger's throw (sleepers.js, middead.js). It acts from the next enemy turn.
export function releaseSwarm(b, x, y, power = battlePower(b)) {
  const at = standAt(b, x, y);
  if (!at) return null;
  const w = applyZType(enemyUnit(b, b.rng, "zombies", power, zombieCount(b)), "swarm", false, power);
  w.name = "Worm swarm";
  w.x = at[0]; w.y = at[1];
  w.aware = true;
  w.wild = true;
  w.reinforcement = true;
  w.life = CARRIER.SWARM_TURNS;
  w.ap = 0;
  b.units.push(w);
  fx(b, { type: "loot", to: [w.x, w.y], text: "WORMS" });
  return w;
}
// combat.js damage: a hit from the swarm that brings someone living to 0 leaves the worm in them.
export function swarmHit(t, by) {
  if (by && by.ztype === "swarm" && t.kind === "human") t.wormed = true;
}
// combat.js damage: a hit from the swarm that someone living takes and stands: CARRIER.INFEST of the time the worm
// is in them now (wormed; wormBit: one of yours carries it home, endBodies).
export function swarmBite(b, t, by) {
  if (!by || by.ztype !== "swarm" || t.kind !== "human" || t.wormed || !b.rng.chance(CARRIER.INFEST)) return false;
  t.wormed = true;
  t.wormBit = true;
  say(b, `The worms get into ${first(t.name)}'s wound. The worm is in them now: if they die, they get up.`, t.side === "player" ? "death" : "info");
  return true;
}

// ---------- a Carrier's turn (zombietypes.js zombieTurn) ----------
// The bodies within reach get up. None of the living next to it: it walks to the nearest body within CARRIER.SEEK
// and raises what it reaches.
export function carrierTurn(b, u) {
  raiseNear(b, u);
  if (b.units.some((f) => f.side !== u.side && f.kind !== "zombie" && active(f) && adjacent(u, f))) return false;
  const bodies = b.units.filter((c) => wormable(c) && cheb(u, c.x, c.y) > CARRIER.RANGE && cheb(u, c.x, c.y) <= CARRIER.SEEK);
  if (!bodies.length) return false;
  const r = reachable(b, u, u.mob * Math.max(1, u.ap));
  let best = null;
  for (let i = 0; i < b.w * b.h; i++) {
    if (!isFinite(r.dist[i])) continue;
    const x = i % b.w, y = (i / b.w) | 0;
    const d = Math.min(...bodies.map((c) => Math.max(Math.abs(c.x - x), Math.abs(c.y - y))));
    const sc = Math.max(0, d - CARRIER.RANGE) * 10 + r.dist[i] * 0.05;
    if (!best || sc < best.sc) best = { x, y, sc, cost: r.dist[i] };
  }
  if (!best || best.cost === 0) return false;
  moveAlong(b, u, pathTo(r, best.x, best.y));
  if (active(u)) raiseNear(b, u);
  u.ap = 0;
  return true;
}

// ---------- crushing the skull, the double tap (combat.js combatAct "crush" / "doubletap") ----------
// The bodies next to the unit whose skull can still be crushed (any human body, any time).
export function crushable(b, u) {
  return b.units.filter((c) => wormable(c) && cheb(u, c.x, c.y) <= 1);
}
export function crush(b, u, c) {
  if (!c || !wormable(c) || cheb(u, c.x, c.y) > 1) return "Stand next to a body to crush its skull.";
  c.crushed = true;
  u.face = [Math.sign(c.x - u.x), Math.sign(c.y - u.y)];
  say(b, c.side === "player" ? `${u.name} does what has to be done: ${first(c.name)} will not get up again.` : `${u.name} crushes the skull of ${c.name}'s body. It will not get up.`, "good");
  fx(b, { type: "melee", from: [u.x, u.y], to: [c.x, c.y], hit: true, crit: false, dmg: 0, side: u.side, text: "CRUSHED" });
  return "";
}
// The bodies this unit could shoot from where it stands (a gun with ammo, line of sight).
export function tappable(b, u) {
  if (!isRanged(u) || !canFire(b, u)) return [];
  return b.units.filter((c) => wormable(c) && canSeeAt(b, u, c.x, c.y));
}
// Why the body cannot be double tapped ("" when it can). The shot itself (ammo, noise) is combat.js's.
export function tapRefusal(b, u, c) {
  if (!c || !wormable(c)) return "Pick a body that could still get up.";
  if (!isRanged(u)) return "No gun: crush the skull from next to it instead.";
  if (!canFire(b, u)) return "Out of ammo.";
  if (!canSeeAt(b, u, c.x, c.y)) return "No line of sight to the body.";
  return "";
}
export function tap(b, u, c) {
  c.crushed = true;
  c.tapped = true;
  u.face = [Math.sign(c.x - u.x), Math.sign(c.y - u.y)];
  say(b, c.side === "player" ? `${u.name} puts a round through ${first(c.name)}'s head. They will not get up again.` : `${u.name} puts a round through the head of ${c.name}'s body. It will not get up.`, "good");
  fx(b, { type: "shot", from: [u.x, u.y], to: [c.x, c.y], hit: true, crit: false, dmg: 0, side: u.side });
  return "";
}
// The battle AI (combat.js autoPlayerTurn, the raid bot): a body in danger next to one of yours, with none of the
// enemy next to them, is crushed (1 action). Returns the act or null.
export function botCrush(b, u) {
  if (!active(u) || u.ap < 1) return null;
  if (b.units.some((f) => f.side === "enemy" && active(f) && adjacent(u, f))) return null;
  const c = b.units.find((o) => endangered(b, o) && cheb(u, o.x, o.y) <= 1);
  return c ? { type: "crush", unit: u.id, target: c.id } : null;
}

// ---------- carrying a body (combat.js combatAct "pickup" / "dropbody" / "stowbody") ----------
// The bodies next to the unit it could pick up (any human body, even one that cannot rise: to bring it home).
export const liftable = (b, u) => (u.carrying != null ? [] : b.units.filter((c) => isBody(c) && cheb(u, c.x, c.y) <= 1));
export const carriedBy = (b, u) => (u.carrying != null ? b.units.find((c) => c.id === u.carrying) || null : null);
export function pickUp(b, u, c) {
  if (u.carrying != null) return "Already carrying a body: put it down first (P).";
  if (!c || !isBody(c) || cheb(u, c.x, c.y) > 1) return "Stand next to a body to pick it up.";
  c.off = true; // gone from the map while carried
  c.carriedBy = u.id;
  u.carrying = c.id;
  u.mob0 = u.mob;
  u.mob = u.mob * CARRIER.CARRY;
  u.ow = false;
  if (b.raid) { const i = b.raid.containers.findIndex((k) => k.kind === "body" && k.uid === c.id); if (i >= 0) c.box = b.raid.containers.splice(i, 1)[0]; }
  u.face = [Math.sign(c.x - u.x), Math.sign(c.y - u.y)];
  say(b, `${u.name} heaves ${bodyName(c)} over their shoulder (half their move distance, no shooting).`, "info");
  return "";
}
// Put the body down: on the tile in front of the carrier if the ground allows, else where they stand.
export function putDown(b, u, quiet = false) {
  const c = carriedBy(b, u);
  if (!c) return "Not carrying a body.";
  const f = u.face || [1, 0];
  const ok = (x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h && CELL[b.cells[y * b.w + x].k].walk;
  const [x, y] = ok(u.x + f[0], u.y + f[1]) && !unitAt(b, u.x + f[0], u.y + f[1]) ? [u.x + f[0], u.y + f[1]] : [u.x, u.y];
  c.x = x; c.y = y;
  c.off = false;
  c.carriedBy = null;
  u.carrying = null;
  if (u.mob0 != null) { u.mob = u.mob0; u.mob0 = null; }
  if (b.raid && c.box) { c.box.x = x; c.box.y = y; b.raid.containers.push(c.box); c.box = null; }
  if (!quiet) say(b, `${u.name} puts ${bodyName(c)} down.`, "info");
  return "";
}
// Is there a car to put a body in, and is the unit at it: a raid's vehicle zone, a field battle's evac strip with
// the team's car waiting beyond it.
export function carHere(state, b, u) {
  if (b.raid) return !!(raidVehicle(state, b) && isCar(raidVehicle(state, b)) && atVehicle(b, u));
  const p = b.setup && b.setup.partyId != null ? state.parties.find((x) => x.id === b.setup.partyId) : null;
  const v = p ? partyVehicle(state, p) : null;
  return !!(v && isCar(v) && b.evacCols && inEvac(b, u.x, u.y));
}
// What a body would weigh in the car (parties.js bodyLoad): the body and what is known to be on it (one of yours: their
// things; a raid's body: its container; an enemy's kit in a field battle is made when the battle ends and is not counted).
export function unitBodyLoad(state, b, c) {
  if (c.side === "player") { const s = survivorById(state, c.sid); return bodyLoad({ items: s ? allItems(s) : [], supplies: {} }); }
  if (c.box && c.box.contents) return bodyLoad({ items: c.box.contents.gear, supplies: c.box.contents.sup });
  return bodyLoad({ items: [], supplies: {} });
}
// Room left in the car for a body: the team's room (parties.js cargoRoom) less the bodies already laid in it this battle.
export function carRoom(state, b) {
  const p = b.setup && b.setup.partyId != null ? state.parties.find((x) => x.id === b.setup.partyId) : null;
  if (!p) return Infinity;
  return cargoRoom(state, p) - b.units.filter((c) => c.inVehicle && isBody(c)).reduce((s, c) => s + unitBodyLoad(state, b, c), 0);
}
export function stowBody(state, b, u) {
  const c = carriedBy(b, u);
  if (!c) return "Pick up a body first (P).";
  if (!carHere(state, b, u)) return b.raid ? "Walk to the vehicle (its zone, or next to it) to put the body in." : "Carry the body onto the green evac strip, where the team's car waits.";
  const need = unitBodyLoad(state, b, c), room = carRoom(state, b);
  if (need > room + 0.01) return `No room in the car for ${bodyName(c)}: it weighs ${Math.round(need)} kg and ${Math.max(0, Math.round(room))} kg is free. Unload something, or leave it.`;
  c.carriedBy = null;
  c.inVehicle = true; // stays off the map; comes home (endBodies)
  u.carrying = null;
  if (u.mob0 != null) { u.mob = u.mob0; u.mob0 = null; }
  say(b, `${u.name} lays ${bodyName(c)} in the car (${Math.round(need)} kg of the load). It will come home with the team.`, "good");
  return "";
}

// ---------- their bodies (combat.js endBattle) ----------
// The risen who was not one of yours, killed: a body with the person's kit (their weapon, armour, pockets).
export function turnedBody(rng, z) {
  const t = z.turned;
  const kit = KITS[t.kit] || KITS.raiders;
  return enemyBody(rng, { id: z.id, name: z.name, kind: "human", kit: t.kit, weapon: t.weapon, armorKey: t.armorKey }, kit);
}
// Is the body of one of your fallen walking about as one of the dead (no body to loot: the things walk with it)?
export const walksOn = (b, u) => u.roseAs != null && b.units.some((z) => z.id === u.roseAs && !z.dead);
// Put down: the name its body goes by ("Dana (turned)").
export const turnedName = (b, u) => { const z = u.roseAs != null ? b.units.find((o) => o.id === u.roseAs) : null; return z ? z.name : u.name; };
// A line for the battle's summary: one of yours got up as one of the dead.
export function turnedLine(b, u) {
  const z = b.units.find((o) => o.id === u.roseAs);
  return `${u.name} got up again as one of the dead${z && z.dead ? " and had to be put down" : " and was still walking when it ended, in what they wore"}.`;
}

// ---------- a raid's bodies (combat.js damage, endRaid) ----------
// The risen, put down in a raid: the body it carried along lies where it fell.
export function dropBodyBox(b, z) {
  const box = z.bodyBox;
  if (!b.raid || !box) return false;
  box.x = z.x; box.y = z.y; box.uid = z.id;
  box.label = `${z.name}'s body`;
  b.raid.containers.push(box);
  z.bodyBox = null;
  return true;
}
// One of the walking dead (markWalking) put down in a raid: its body container holds the person's things.
export function walkingBox(b, z, box) {
  const e = z.walking;
  if (!e) return;
  box.contents = { sup: { ...(e.supplies || {}) }, gear: e.items.slice() };
  box.walking = e;
  box.botSkip = false;
  e.items = []; e.supplies = {};
  z.walking = null;
}

// ---------- walking loot: the pool ----------
export const walkingLoot = (state) => state.walkingLoot || (state.walkingLoot = []);
// One of your fallen's things, wherever killSurvivor put them (their death site, a base's armory), back off them:
// the real item objects, listed nowhere else now.
function claimFallen(state, s) {
  const items = allItems(s);
  for (const it of items) {
    unlistFromSites(state, it);
    for (const h of state.bases) { const i = h.armory.indexOf(it); if (i >= 0) h.armory.splice(i, 1); }
  }
  stripAll(s);
  return items;
}
// The death site of one of yours on this tile says the body walked off (markers.js deathLabel). The site stays even
// with nothing left on it (markers.js clearEmptyDeathSites, economy.js, inventory.js), so the grave is on the map.
function markWalked(state, tile, name) {
  if (tile == null) return;
  let site = state.deathSites.find((d) => d.tile === tile);
  if (!site) { site = { id: newId(), tile, items: [], day: day(state), names: [], lastConfirmed: day(state) }; state.deathSites.push(site); }
  if (!site.names.includes(name)) site.names.push(name);
  (site.walked || (site.walked = [])).push(name);
}
// A pile of things at a death site on a tile (what a walking body put down in a lost fight leaves; what did not fit
// on a body).
function siteDrop(state, tile, items, supplies, who) {
  const list = [];
  for (const it of items) list.push({ kind: "gear", key: it.key, name: `${first(who)}'s ${it.name}`, qty: 1, value: Math.round((GEAR[it.key] ? GEAR[it.key].value : 0) * (it.quality || 1)), item: it });
  for (const [k, v] of Object.entries(supplies || {})) if (v >= 1 && SUPPLIES[k]) list.push({ kind: "supply", key: k, name: SUPPLIES[k].name, qty: Math.floor(v), value: Math.floor(v) * SUPPLIES[k].value });
  if (!list.length || tile == null) return;
  let site = state.deathSites.find((d) => d.tile === tile);
  if (site) { site.items.push(...list); if (!site.names.includes(who)) site.names.push(who); }
  else state.deathSites.push({ id: newId(), tile, items: list, day: day(state), names: [who], lastConfirmed: day(state) });
}
// The things of a risen still walking at the end of a battle (or one of the walking dead met again and not put
// down) go into the pool at the battle's tile. z.walking: back in as it was; z.turned: from the person.
export function walkOff(state, b, z, tile) {
  bind(state);
  if (z.walking) {
    const e = z.walking;
    z.walking = null;
    e.tile = tile; e.day = day(state);
    walkingLoot(state).push(e);
    return e;
  }
  const t = z.turned;
  if (!t) return null;
  let items = [], supplies = {};
  const s = t.sid != null ? survivorById(state, t.sid) : null;
  if (s) {
    items = claimFallen(state, s);
    markWalked(state, tile, s.name);
    if (items.length) log(state, `${s.name}'s body walked off from ${tileName(state, tile)}, still in what they wore (${items.map((g) => g.name).join(", ")}). It is out there among the dead now.`, "death");
  } else if (z.bodyBox && z.bodyBox.contents) {
    // A raid: the things found on the body go with it (and are not counted as found).
    const R = b.raid;
    items = z.bodyBox.contents.gear.splice(0);
    supplies = { ...z.bodyBox.contents.sup };
    for (const [k, v] of Object.entries(supplies)) if (v > 0 && R && R.found[k]) { R.found[k] = Math.max(0, R.found[k] - v); if (!R.found[k]) delete R.found[k]; }
    if (R) for (const g of items) { const i = R.foundGear.indexOf(g); if (i >= 0) R.foundGear.splice(i, 1); }
    z.bodyBox = null;
  } else {
    const body = turnedBody(b.rng, z);
    items = allItems(body);
    supplies = { ...body.supplies };
    stripAll(body);
    z.bodyBox = null;
  }
  const e = { id: newId(), name: z.name, who: t.name, sid: t.sid ?? null, side: t.side, kit: t.kit || null, weapon: t.weapon || null, armorKey: t.armorKey || null, armor: z.armor ?? 1, tile, day: day(state), items, supplies, met: 0 };
  walkingLoot(state).push(e);
  return e;
}
const tileName = (state, tile) => { const t = tile != null ? state.tiles[tile] : null; return t ? (t.loc ? t.loc.name : t.terrain) : "the field"; };

// A battle made near the pool (combat.js createBattle, createRaid): the walking dead within CARRIER.WALK_RADIUS of
// its tile may be among the ordinary dead on the map (nearer = likelier, at most WALK_MAX). Returns those placed.
export function placeWalking(state, b) {
  bind(state);
  const pool = walkingLoot(state);
  if (!pool.length || b.tileId == null) return [];
  const zs = b.units.filter((u) => u.side === "enemy" && u.kind === "zombie" && !u.ztype && !u.boss && !u.turned && !u.walking && !u.dead);
  if (!zs.length) return [];
  const near = pool.map((e) => ({ e, d: state.grid.distance(e.tile, b.tileId) })).filter((x) => x.d <= CARRIER.WALK_RADIUS).sort((a, c) => a.d - c.d);
  const placed = [];
  for (const { e, d } of near) {
    if (placed.length >= CARRIER.WALK_MAX || !zs.length) break;
    if (!b.rng.chance(CARRIER.WALK_CHANCE * (1 - d / (CARRIER.WALK_RADIUS + 1)))) continue;
    placed.push(markWalking(state, b, zs.shift(), e));
  }
  return placed;
}
// One of the ordinary dead is that person: their name, their armour, their things on it (walkingBody when put down).
export function markWalking(state, b, z, e) {
  const pool = walkingLoot(state);
  const i = pool.indexOf(e);
  if (i >= 0) pool.splice(i, 1);
  e.met = (e.met || 0) + 1;
  z.name = e.name;
  z.armor = e.armor ?? 1;
  z.turned = { from: null, sid: e.sid, side: e.side || (e.sid != null ? "player" : "enemy"), name: e.who, kit: e.kit, weapon: e.weapon, armorKey: e.armorKey, app: null };
  z.walking = e;
  const ago = Math.max(0, day(state) - (e.day || day(state)));
  const yours = e.sid != null;
  const when = ago === 0 ? "today" : ago === 1 ? "yesterday" : `${ago} days ago`;
  say(b, `${e.name} is among the dead here: ${e.who} fell ${when} and got up again, still in what they died in${e.armor < 1 ? " (their armour still takes its share)" : ""}. Put them down and their things are on the body.`, yours ? "death" : "danger");
  log(state, `${e.name} walks among the dead at ${tileName(state, b.tileId)}: ${e.who} rose ${when} and has wandered here, their things still on them.`, yours ? "death" : "danger");
  return z;
}
// The body of one of the walking dead put down and the battle won (combat.js endBattle): a body with their things on
// it. What has nowhere to go on a body (a ram, a ladder) lies at a death site on the tile.
export function walkingBody(state, b, z) {
  const e = z.walking;
  const body = ensureInv({ name: z.name, kind: "human", uid: z.id, kit: e ? e.kit || null : null, supplies: e ? { ...(e.supplies || {}) } : {} });
  if (e) {
    const left = [];
    for (const it of e.items) if (!putOn(body, it)) left.push(it);
    if (left.length) siteDrop(state, b.tileId, left, {}, e.who);
    e.items = []; e.supplies = {};
  }
  z.walking = null;
  return body;
}
function putOn(body, it) {
  const slot = GEAR[it.key] ? GEAR[it.key].slot : null;
  if (slot && EQUIP_SLOTS.includes(slot) && !body.gear[slot]) { body.gear[slot] = it; return true; }
  return stow(body, it, "") !== "";
}

// ---------- the end of a battle (combat.js endBattle / endRaid, after your deaths are settled) ----------
// Carried bodies are put down; the risen and the walking dead still up walk off with their things; the walking dead
// put down in a lost fight leave their things on the tile; the burnt leave nothing; the bodies in the car come home
// (p.cargo.bodies) when the team keeps it; one of yours bitten by the swarm has the worm for good.
export function endBodies(state, b, outcome, keepsCar) {
  bind(state);
  const tile = b.tileId;
  const p = b.setup && b.setup.partyId != null ? state.parties.find((x) => x.id === b.setup.partyId) : null;
  for (const u of b.units) if (u.carrying != null) putDown(b, u, true);
  for (const z of b.units) {
    if (z.kind !== "zombie" || !(z.turned || z.walking)) continue;
    if (!z.dead) { walkOff(state, b, z, tile); continue; }
    if (z.walking && outcome !== "victory") { const e = z.walking; z.walking = null; siteDrop(state, tile, e.items, e.supplies, e.who); e.items = []; e.supplies = {}; }
  }
  for (const u of b.units) {
    if (u.side !== "player") continue;
    const s = survivorById(state, u.sid);
    if (!s) continue;
    if (s.alive && u.wormBit && catchWorm(state, s, "swarm")) {
      if (s.worm && s.worm.seen == null) s.worm.seen = day(state); // everyone saw the bite: no hiding it
      log(state, `${s.name} was bitten by the worm swarm: the worm is in them now. Treat it before it reaches the brain (Medical tab); if they die, they will get up.`, "danger");
    }
    if (s.alive || !u.dead) continue;
    clearWorm(s); // dead in the battle: the battle raised them or did not; they do not rise again
    if (u.burnt) { const gone = claimFallen(state, s); if (gone.length) log(state, `${first(s.name)}'s things burned with their body (${gone.map((g) => g.name).join(", ")}).`, "death"); }
    else if (u.inVehicle) {
      const armor = armorMult(s);
      const items = claimFallen(state, s);
      if (p && keepsCar) cargoBody(state, p, { name: s.name, sid: s.id, items, supplies: {}, worm: !!u.wormed, safe: !!u.crushed, armor });
      else siteDrop(state, tile, items, {}, s.name);
    }
  }
  for (const e of b.units) {
    if (e.side === "player" || !e.dead || !e.inVehicle || e.kind !== "human") continue;
    let items, supplies;
    if (e.box && e.box.contents) {
      items = e.box.contents.gear.splice(0); supplies = { ...e.box.contents.sup };
      unfound(b, items, supplies);
    } else { const body = enemyBody(state.rng, e, KITS[e.kit] || KITS.raiders); items = allItems(body); supplies = { ...body.supplies }; stripAll(body); }
    e.box = null;
    if (p && keepsCar) cargoBody(state, p, { name: e.name, sid: null, items, supplies, worm: !!e.wormed, safe: !!e.crushed, armor: e.armor ?? 1 });
    else siteDrop(state, tile, items, supplies, e.name);
  }
  // A raid: a walking body put down and not searched out leaves its things on the tile, never lost.
  if (b.raid) for (const box of b.raid.containers) {
    if (!box.walking || !box.contents) continue;
    const gear = box.contents.gear.splice(0), sup = { ...box.contents.sup };
    box.contents.sup = {};
    unfound(b, gear, sup);
    siteDrop(state, tile, gear, sup, box.walking.who);
    box.walking = null;
  }
}
// A raid counted these as found; they are not coming home that way.
function unfound(b, gear, sup) {
  const R = b.raid;
  if (!R) return;
  for (const g of gear) { const i = R.foundGear.indexOf(g); if (i >= 0) R.foundGear.splice(i, 1); }
  for (const [k, v] of Object.entries(sup)) if (v > 0 && R.found[k]) { R.found[k] = Math.max(0, R.found[k] - v); if (!R.found[k]) delete R.found[k]; }
}
function cargoBody(state, p, body) {
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  (p.cargo.bodies || (p.cargo.bodies = [])).push({ id: newId(), ...body, day: day(state) });
}
// The team gets home (parties.js returnHome, settleInto): the bodies in its car are laid out at the base.
export function bodiesHome(state, p, base) {
  const list = p.cargo && p.cargo.bodies;
  if (!list || !list.length) return;
  for (const body of list) (base.bodies || (base.bodies = [])).push({ ...body, arrived: day(state) });
  log(state, `${list.map((x) => `${first(x.name)}'s body`).join(", ")} ${list.length === 1 ? "was" : "were"} brought home to ${base.name}. Bury or burn ${list.length === 1 ? "it" : "them"} (Armory tab)${list.some((x) => x.worm && !x.safe) ? "; the worm is in one of them" : ""}.`, "info");
  p.cargo.bodies = [];
}
// The Armory tab: bury a body (its things to the armory) or burn it (nothing kept). Returns a message.
export function buryBody(state, base, id) {
  const list = base.bodies || [];
  const body = list.find((x) => x.id === id);
  if (!body) return "That body is gone.";
  list.splice(list.indexOf(body), 1);
  base.armory.push(...body.items);
  for (const [k, v] of Object.entries(body.supplies || {})) if (v > 0) base.stock[k] = (base.stock[k] || 0) + v;
  const what = body.items.map((g) => g.name).join(", ");
  log(state, `${body.name} was buried at ${base.name}${body.safe ? "" : ", the skull crushed first"}.${what ? ` Their things (${what}) were put in the armory.` : ""}`, "info");
  return `${first(body.name)} is buried.${what ? " Their things are in the armory." : ""}`;
}
export function burnBodyHome(state, base, id) {
  const list = base.bodies || [];
  const body = list.find((x) => x.id === id);
  if (!body) return "That body is gone.";
  list.splice(list.indexOf(body), 1);
  log(state, `${body.name} was burned at ${base.name}, with everything on them${body.items.length ? ` (${body.items.map((g) => g.name).join(", ")})` : ""}.`, "info");
  return `${first(body.name)} is burned. Nothing was kept.`;
}

// ---------- each day (world.js) ----------
// The walking dead drift a tile (toward the nearest hive, else at random); a body with the worm left unburied at a
// base gets up: it tears at someone before it is put down.
export function walkingDaily(state) {
  const rng = state.rng;
  for (const e of walkingLoot(state)) {
    if (!rng.chance(CARRIER.DRIFT)) continue;
    const ns = state.grid.neighbors(e.tile);
    if (!ns.length) continue;
    let to = rng.pick(ns);
    const hives = (state.hives || []).filter((h) => !h.dead && !h.destroyed);
    if (hives.length && rng.chance(CARRIER.DRIFT_HIVE)) {
      let best = null, bd = Infinity;
      for (const h of hives) { const d = state.grid.distance(h.tile, e.tile); if (d < bd) { bd = d; best = h; } }
      if (best && bd > 0) to = ns.slice().sort((a, c) => state.grid.distance(a, best.tile) - state.grid.distance(c, best.tile))[0];
    }
    e.tile = to;
  }
  for (const base of state.bases) {
    for (const body of [...(base.bodies || [])]) {
      if (body.safe || !body.worm || day(state) - (body.arrived ?? day(state)) < CARRIER.BASE_RISE) continue;
      body.safe = true;
      const people = atBase(state, base.id);
      const v = people.length ? rng.pick(people) : null;
      if (v) { hurt(state, v, rng.int(8, 25), base.tile, `when ${first(body.name)}'s body got up at ${base.name}`); log(state, `${body.name}'s body got up in the night at ${base.name}, the worm in its eyes, and tore at ${v.name} before it was put down. Bury or burn it.`, "death"); }
      else log(state, `${body.name}'s body got up in the night at ${base.name} and was put down at the gate. Bury or burn it.`, "death");
    }
  }
}

// ---------- the worm in your people during a battle ----------
// Each battle hour (6 turns: combat.js raid hours) an infected unit loses a 24th of the coming day's damage (worm.js
// dayHp; kept on w.paid and taken off that day's damage at midnight). The worm that kills them gets them up at once
// (riseInBattle).
export function wormBattleRound(state, b) {
  if (!b || !b.turn || b.turn % 6 !== 0 || b.wormTurn === b.turn) return;
  b.wormTurn = b.turn;
  for (const u of [...b.units]) {
    if (u.side !== "player" || u.dead || u.off || u.left || u.fled || u.away || u.sid == null) continue;
    const s = survivorById(state, u.sid);
    const w = wormOf(s);
    if (!w) continue;
    const dmg = dayHp(w.day + 1) / 24;
    w.paid = (w.paid || 0) + dmg;
    u.hp -= dmg;
    if (u.hp <= 0) riseInBattle(state, b, u);
  }
}
// One of your people dies of the worm in the middle of a battle: the unit dies, and one of the dead takes its place on
// the same cell and floor, aware and up at once (the enemy phase it rises in). Returns the risen.
export function riseInBattle(state, b, u) {
  bind(state);
  u.hp = 0;
  u.dead = true;
  u.down = false;
  u.wormed = true;
  u.wormDeath = true; // combat.js endBattle: "of the worm"
  if (u.carrying != null) putDown(b, u, true);
  say(b, `${u.name} collapses: the worm has eaten the last of them.`, "death");
  const z = turn(state, b, u);
  if (z) { z.f = u.f ?? z.f; z.aware = true; }
  return z;
}

// ---------- someone with the worm dies on the State Map or at a base (world.js killSurvivor) ----------
// Not in a battle (the battle raises them itself). worm.js wormRise handles it by where they are (your base, the road's
// card, a city block, another group's base, an errand); alone on the road, they walk off with their things into the
// walking loot (here).
export function riseOnMap(state, s, tileId) {
  if (!hasWorm(s)) return false;
  if (state.combat && state.combat.units && state.combat.units.some((u) => u.sid === s.id)) return false;
  if (wormRise(state, s, tileId)) return true;
  const rng = state.rng;
  const party = s.location && s.location.kind === "party" ? state.parties.find((p) => p.id === s.location.partyId) : null;
  const base = s.location && s.location.kind === "base" ? baseById(state, s.location.baseId) : null;
  const others = (party ? partyMembers(state, party) : base ? atBase(state, base.id) : []).filter((x) => x !== s && x.alive);
  clearWorm(s); // handled here: they rise once
  if (others.length) {
    const v = rng.pick(others);
    hurt(state, v, rng.int(8, 25), tileId, `when ${first(s.name)} got up again`);
    log(state, `${s.name} got up again, the worm in their eyes, and tore at ${v.name} before the others put them down.`, "death");
    return true;
  }
  if (party && tileId != null) {
    const armor = armorMult(s);
    const items = claimFallen(state, s);
    markWalked(state, tileId, s.name);
    walkingLoot(state).push({ id: newId(), name: `${first(s.name)} (turned)`, who: s.name, sid: s.id, side: "player", kit: null, weapon: null, armorKey: null, armor, tile: tileId, day: day(state), items, supplies: {}, met: 0 });
    log(state, `${s.name} got up again, the worm in their eyes. Nobody was there to put them down: they walked off in what they wore${items.length ? ` (${items.map((g) => g.name).join(", ")})` : ""}.`, "death");
    return true;
  }
  log(state, `${s.name} got up again, the worm in their eyes, and was put down at the gate.`, "death");
  return true;
}
