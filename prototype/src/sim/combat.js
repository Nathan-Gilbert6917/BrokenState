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
//   ammoUsed, arrowsUsed?, arrowsBack?, // rounds fired; arrows loosed and picked up again after a win (world.js ARROWS)
//   loot: { supplies: {}, gear: [] },  // dropped by dead enemies, already added to the party cargo / base stock
//   turns?, medsUsed?, extraKilled?    // optional extras from the tactical engine
// }
import { typeFind, AREA_MIX } from "./foods.js"; // the food in a container as items
import { survivorById, alive, atBase, homeAt, combatPower, hurt, log, skill, gearEffect, isNight, usesArrows, armedFactor, arrowsBack, meleeAimBonus, meleeDmgMult } from "./world.js";
import { partyMembers, partyTile, partyCapacity, cargoLoad, cargoRoom, unitsThatFit, wipeParty, leaveVehicle } from "./parties.js";
import { noteGunfire } from "./fieldheat.js";
import { GEAR, SUPPLIES, TERRAIN } from "./data.js";
import { partyVehicle, partyVehicles, isBike, upgradesOf, armourOf, riderMult, vehicleOdds, UPGRADE_FX, technicalPlated, SEATS } from "./vehicles.js"; // the team's car or truck on the map (placeVehicle); its upgrades (glass, plating)
import { wearAfterFight, wearSlot, itemDur, medKitBonus } from "./crafting.js";
import { armorMult, enemyBody, allyBody, bodyEmpty, takeAllBodies, leaveBodies, ARMOR_SLOTS, itemLoad, lootItem, deadBodyFinds, carryMods, carriedThrowables } from "./inventory.js";
import { areaSource, kitSource, spend } from "./itemcond.js";
import { foundFill } from "./gunrounds.js"; // a found gun's few rounds
import { rollAreaGuns } from "./gunfinds.js"; // the arsenal of 2026-10-10 in a raid container (its own dice)
import { rollAreaFind, rollAreaWood, rollAreaArrows, rollAreaGunmod, splitParts, rollAreaGrenades, rollAreaLaunchers, rollAreaReload } from "./loot.js";
import { buzzAim } from "./comforts.js";
import { needsAim } from "./needs.js";
import { tiredAim } from "./sleep.js"; // Tired or Exhausted from the watch
import { illnessAim } from "./health.js";
import { smokeAt, flareLit, fireStep, fireAt, burnRound, smokeBlocks, SMOKE, FLARE, stunTurnStart, stunTurnEnd, kitFlashbangs } from "./throwables.js";
import { siegeSetup, siegeAct, siegeAI, botSiege, afterMove, checkRams, isCrew, CLIMB_AIM, CREW_AIM, coverSmoke } from "./siege.js"; // ladders, the ram, rocks from the walls; smoke over a retreat
import { lureTurn, herded, shepherdTurn, botDecoy, lureEdge } from "./decoys.js"; // decoys, fire and the senses of the dead; the Shepherd
import { battlePerks, battleXp, rollBook, fightXp, hash01 } from "./skills.js";
import { battleRecord, friendAim, teamSpirit } from "./relations.js";
import { refitSenses, senses } from "./stealth.js";
import { LIGHTS } from "./lights.js"; // a light's name (switchAct)
import { gunMods, unitMods, modRange, modLabel, enemyMods, fittedSuppressor, NO_MODS, situationalAim, roundReach } from "./gunmods.js"; // gun attachments; a fitted magazine changes a gun's capacity (magCap)
import { stealthSetup, stealthAct, stealthTurn, stealthAI, spotBodies, detectRange, shotNoise, searchCost, knockOut, battleCaptives, botStealth, botAttackThrow, botRetreatSmoke, botFlash, noiseAt } from "./stealth.js";
import { deployAct, endDeploy } from "./deploy.js";
import { drillAct } from "./defenceplan.js"; // a defence drill on the base's battle map
import { fallBack, tierEnemyTurn, tierPlayerTurn, tierAI, baseTiers } from "./interior.js";
import { capturePrisoners, captiveRecords } from "./prisoners.js";
import { fightByNumbers } from "./breakoff.js";
import { battleUse, battleMod } from "./itemacts.js"; // the item menu's orders in a fight (useItem, modPart)
import { lockRaid, openLock, lockedLoot, raidLocksEnd, autoLock, lockTargets, lockedMsg, botDone } from "./locks.js";
import { safeTurn } from "./locks.js"; // gun safes: a charge set on one goes off at the start of the next turn
import { applyZType, typeList, typeStrength, zRevealed, strikeBonus, zTick, zombieTurn, nextOfMix, mixList, siteList } from "./zombietypes.js"; // a hive's special dead
import { ZTYPES, MIDDEAD } from "./hiveconst.js";
import { ACID, acidAt, acidArmor, acidWeights, acidStep, acidRound, spitterBurst } from "./acid.js"; // a spitter's acid sac bursts when it dies
import { armorVs, stabsGap, ARMORED, armoredOf, wearPlate } from "./deadsoldiers.js"; // the armoured dead: soldiers, riot police
import { traitAim, meleeTraitAim, woundMult, fleetEscape, tactOf, TACT_RANGE } from "./traits.js"; // Brave, Coward, Clumsy, Tough, Frail, Fleet-Footed, Tactical
import { armourHit, armourExpect, locatedHit, enemyPieces, fitArmour, wearByNumbers, absorbOffscreen, battleArmor, battleDice, roundOf, armourSpec, dropBroken } from "./armour.js"; // per-hit armour: pieces, locations, penetration, wear
import { noteBrass, pickUpBrass } from "./reloading.js"; // the reloading bench: brass back after a won fight
import { syncModes, modeOf, modeRounds, modeRolls, modeAim, modeRefusal, FIRE_MODES, rollTrigger, jamGun, jamRefusal, jamLabel, foul, unjam, unjamRefusal, jamReload, aiUnjam, aiMode, noteJamWeather, enemyGunQ, enemyGunCond, SUPPRESS, suppressRounds, suppressRefusal, coneTargets, bestCone, nextInLine, overpenChance, piercesCover, OVERPEN, braceAim, sniperCell, isSniper, gunModes } from "./gunfire.js"; // fire modes, jams, suppressing fire, over-penetration
import { MEDS } from "./medfinds.js"; // how rare meds are
import { bonebackMult, afterHit, onDeath, climbOver, sowerRound, terrorRuns } from "./middead.js"; // the mid game's special dead
import { placeBodies, spotCheck, wakeNear, sleeperDies, burnBodies } from "./sleepers.js"; // bodies on the ground, the Sleepers among them
import { stirBodies, carrierRound, burst, swarmHit, swarmBite, crush, tapRefusal, tap, pickUp, putDown, stowBody, botCrush, turnedBody, walkingBody, walkingBox, walksOn, turnedName, turnedLine, dropBodyBox, endBodies, placeWalking } from "./carriers.js"; // the Carrier raises the human dead; its worm swarm; bodies carried, shot, burnt; the walking loot
import { hasWorm, WORM } from "./worm.js"; // the worm in a living person (half the healing while it is in them)
import { fieldDims, raidDims, densify, coverTarget, spawnRules, clearEnough, fledFarEnough, raidAreaTypes, raidDeadScale, roomBoxes, RAID as RAID_SIZE, CONTACT } from "./battlesize.js"; // map sizes by context, cover, spawns, the anti-slog ends
// The third side (neutral survivors, military squads: wanderers.js brings them, thirdside.js runs them). Every hook
// below is marked "thirdside.js"; a battle without a third side takes exactly the old paths.
import { volFought } from "./volunteers.js"; // volunteers: an allied group's people with your team, moved by their AI (volunteerTurn below)
import { thirdFoes, enemyTargetsThird, hostilePair, thirdPlan, thirdSideHit, thirdSideUnit, placeThird, thirdResult } from "./thirdside.js";
import { crossFoes, crossTurn, crossDraw, crossHit, noteShot, crossRound } from "./crossfire.js"; // a raid's raiders and dead fight on contact; their noise draws the dead to them while you are unseen; shots heard, not seen
import { folkTick, resolveBattleCards, dropBattleCards } from "./floorfolk.js"; // who holds the upper floors of a city building (the crawl)
import { isHardcore } from "./hardcore.js";
import { raidCarrySetup, autoTake, stashAll, raidHome, personalRoom, trunkSpace, atVehicle, setRefit, haulLoad, dropHaul, dropHeld } from "./raidloot.js"; // loot by hand: each survivor carries their own, the vehicle has a trunk
import { SEARCH, hideSome, revealHidden, quickRefusal, quickNoise, quickHurt, quickable, botPressed, takeFree } from "./search.js"; // full search (1 action) and the quick rummage
import { GUN_WEAPONS, KIT_PATCH, WEAPON_PATCH } from "./data-guns.js"; // the weapons overhaul's guns, melee and launchers (merged below)
import { withFactory } from "./factoryfit.js"; // a sniper rifle carried with its scope and bipod (section 22)
import { throwLanding } from "./throwables.js"; // a thrown spear lands like any throw
import { BLADE_WEAPONS, BLADE_KIT_PATCH } from "./data-blades.js"; // knives and swords (merged below)
import { SURV_MELEE, SURV_KIT_PATCH } from "./data-survival.js"; // survival gear: the Halligan bar and the pipe wrench (merged below)
import { NL_WEAPONS, NL_KIT_PATCH } from "./data-nonlethal.js"; // the stun baton; tasers and spray on guards (merged below)
import { nlHit, nlDown, nlAfterHit, nlAimPen, nlNoOw, nlStrike, nlAct, nlSetup, nlEnemyPhase, nlTurnStart, nlAI, nlBreak, nlBattleEnd, nlRaidEnd, nlDropPiles, nlSpared, blinded, setTakeAlive } from "./nonlethal.js"; // non-lethal weapons, taking people alive, surrender
import { ammoPen, spreadMult } from "./data-ammo.js"; // a round's penetration: what bulletproof glass stops (riderHitMult); shot spreading with range
import { noteFight } from "./causes.js"; // "Why?": the odds of a fight by the numbers
import { calOf, calName, roundsOf, takeBattleRounds, sideRounds, chooseLoad, enemyLoad, pickLoad, boxesOf, sweepBoxes, formFinds, typeFx, typeFor, roundName, settleBase, settleParty, drawTeamShots, ammoEdge, refundShots, softMult, bodyRounds, sortFind, raidTheme } from "./ammo.js"; // rounds by calibre and type
import { loadFx, unitRound, loadRefusal } from "./ammo.js"; // calibre compatibility (2026-10-10): the round loaded, a 5.56 gun's .223
import { trucksAt, TRUCK_KINDS, truckLoot, truckRng, markOpened, truckName, MILTRUCK, CONVOY_GUARD, guardedTrucks } from "./miltrucks.js"; // Army trucks on the map, their cargo and crews (a convoy's guard)
import { carAct, settleClaims } from "./foundcars.js"; // any car on a map: get in, keys or hotwire, inspect, claim
import { armFromArsenal, settleArsenal } from "./arsenal.js"; // group arsenals: their units armed from what the group holds
// Grenade launchers and rockets (section 13) and what explosions do to gear (section 24): a unit's second weapon (u.gl).
import { fitLauncher, refitLauncher, kitLauncher, launchRefusal, launch, glReloadRefusal, glReload, aiLaunch, launcherBody, launcherLoot, blastLoot, launcherBattleEnd, blownUpCargo, blastHit, blastBox, blastPiles } from "./launchers.js";
import { fitMags, tracksMags, gunEntry, reloadPlan, doReload, fittedMag, getShells, getShellsRefusal, isShellGun, isMag, magEntryAt, loadMagPlan, loadMagFrom, fillUnit, isStacked, syncMags, unloadMagPlan, unloadMagFrom } from "./mags.js";
import { stackN, takeTop } from "./roundstack.js"; // physical rounds in a gun (loadMag) // magazines as items (section 15): spares, reload sources (a pocket or the rig 1 action, the pack both), top-up, internal magazines
import { weighPlayer, kitEnemy, unitMagItems, withMags, plateSwapPlan, swapPlate, packShells as handOutShells } from "./carrykit.js"; // the kit's weight: battle mob by load band (R17); enemies' rigs and magazines; a base's shotgunners' shells out of its stock (handOutShells: packShells is the AI's Get shells check below)
import { allCarried, carriedSpots, stow } from "./inventory.js";
import { parseLoc, itemAt, moveItem, slotKind, fitReason, splitAt, openAt, boxAt as boxRoundsAt, rigOf, pouchesOf } from "./inventory.js"; // the survivor's inventory in a fight (combatAct "inv"; boxAt here is a raid's container)
import { amountOf, canStack, isRoundItem } from "./itemstack.js";
import { deepShift } from "./deeploot.js";
import { typesOf, withHand } from "./rounds.js"; // shells and rounds at hand (takeHandRounds)
import { ammoKey } from "./data-ammo.js";
import { rescueAct, rescueRefusal, guardTurn, rescueRound, rescueBot, rescueDone, captiveStays, captiveHitMult } from "./rescueraid.js"; // a rescue raid on a group's base: captives on the map
import { raidBuilding, buildingMap, buildingOptions, placeInterior, windowsNear, interiorIntro, BMAP, doorNoise, doorBroken, doorAct, peekSees, rewardMult, botEscape, DOOR_KINDS, doorSees } from "./buildingmaps.js";
import { WINDOW, windowOpen, windowAct, smashWindow, glassNoise, rollWin, winMixOf } from "./windows.js"; // the map's windows: open, locked, fixed or broken (the user's request 2026-10-17)
import { wireStep, cutAct, kitCutter, cutterKeyOf, WIRE } from "./wire.js";
import { mineStep, settleMines } from "./mines.js"; // land mines: set off underfoot, the rest kept by the base when it is over // barbed wire snags the living unless they cut it (the user's request 2026-10-19)
import { CRAWL, FURNITURE, crawlable, overCost, shoveAct, boardAct, tearAct, breakBoarded, breakPiece, boardedName, aiBarricade, kitBoards } from "./barricade.js"; // furniture shoved in the way, doors and windows boarded up, the dead crawling over half cover (the user's request 2026-10-18)
import { poiFull } from "./pois.js"; // a raid on a point of interest: what that place held untouched (setup.raid.poi)
import { poiRaidStart, poiMapRng, boxRng } from "./poicont.js"; // its containers as the ledger keeps them, their own dice
// Medics (a med kit makes one: Heal, Revive), dragging the downed, enemies going down and finishing the downed.
import * as MED from "./medics.js";
import { deafen, bangOf, tickEars, heardGhosts, dazedAim, linkAim, linkEscape, fitHeadgear, settleEars } from "./hearing.js"; // ears: bangs, deafness, what your people hear, the team headset
import { cartAct, cartKnocked, oneHandOk, CART_FIGHT, cartMoved, enemyCartsLetGo, enemyCarts, placeMapCarts, cartHelpStart } from "./carts.js"; // a wheelbarrow, a hand cart: let go (free), take it back (1 action)
import { fitHands, handsRefusal, handsWord, handsBusy, carriedAct, pickCarried, autoDrop, settleCarried, armsDropsEnd, stageAtStart } from "./carry.js"; // supplies or a bag carried in the arms: no weapon until set down (Drop carried: free)
import { kitHeadgear, visorAim, toggleVisor } from "./helmets.js"; // helmets: the face shield, an enemy's helmet and ear protection by kit
import { groundAct, groundEnd, groundLeftovers, fieldFinds, searchedInBattle, aiGrabGun } from "./ground.js";
import { gunOut, gunIn, enemyGunLoaded, carriedWithBag } from "./gunload.js";
import { aiLights, aiFlashlight, aiRoomLights, wakeLights } from "./ailights.js"; // the AI's flashlights and room lights (the user's request 2026-10-12)
import { indoorSetup, lightAt, indoorSees, lightsAct } from "./indoorlight.js"; // light inside a raid's buildings: dark rooms, lit rooms, switches (the user's request 2026-10-12)
import { VISION, hasFront, inArc, coned, nightSees, nightEyes, faceToward, setFacing, sneakMob, stepNoise, glance, facesBox, faceRefusal, turnToBox, activeLight, nvgOn, nvgSight } from "./vision.js"; // facing, view cones, sneaking (the user's request 2026-10-12) // the rounds in a gun kept on the item when it changes hands // bodies searched where they fell, things on the ground
import { swapGun, kitGunSource, bodyGunSource, areaSourceName } from "./gundist.js"; // the gun distribution: which gun a kit, a body or a room yields
import { planStart, closePlan } from "./raidplan.js"; // choices before a raid: the side, a scout, the night (docs/suggestions-5.md #23)

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

// Bosses with a mind of their own on the battle map (u.boss): fn.turn(b, u) runs instead of the usual AI in the enemy
// phase (an immobile organ that pulses and spawns, hivecrawl.js's Hivemind), fn.death(b, u) as it dies (its brood
// collapses with it). Registered like the layouts (by the module that makes the boss).
var bossAIs; // eslint-disable-line no-var
export function registerBossAI(kind, fn) {
  (bossAIs = bossAIs || new Map()).set(kind, fn);
}
const bossAI = (u) => (u && u.boss && bossAIs ? bossAIs.get(u.boss) || null : null);
// A boss with a weak spot (fn.throwAt(b, boss, thrower, have): { item, x, y } or null) asks the battle AI to throw at
// it (stealth.js botAttackThrow, before a crowd): the Hivemind and its fire and bangs (hivecrawl.js).
// A throw landed (throwables.js landEffect): bosses that react to it at once (fn.onLand(b, boss, { fx, x, y, side }):
// the Broodmother dazed by a bang, the Hivemind counting what was spent on it: hivecrawl.js).
export function bossOnLand(b, L) {
  if (!bossAIs) return;
  for (const o of b.units) { if (o.dead) continue; const ai = bossAI(o); if (ai && ai.onLand) ai.onLand(b, o, L); }
}
export function bossThrowTarget(b, u, have) {
  if (!bossAIs) return null;
  for (const o of b.units) {
    if (o.dead || o.side === u.side) continue;
    const ai = bossAI(o);
    const t = ai && ai.throwAt ? ai.throwAt(b, o, u, have) : null;
    if (t) return t;
  }
  return null;
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
  b.losCache = makeLosCache(W, H);
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
  b.losCache = makeLosCache(W, H);
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
  if (!F.losCache) F.losCache = makeLosCache(W, H); // made when a floor is first looked at (saves stay smaller)
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
  // A teammate lying wounded on the landing is no wall: whoever comes through moves them aside (landingClear).
  const free = (g) => !!b.floors[g] && b.floors[g].cells[u.y * b.w + u.x].k === "stairs" && !b.units.some((o) => o !== u && (o.f || 0) === g && !o.dead && !o.left && !o.fled && !o.off && o.x === u.x && o.y === u.y && !(o.down && o.side === u.side && asideCell(b, o, g)));
  return { up: f + 1 < b.floors.length && free(f + 1), down: f > 0 && free(f - 1) };
}
// A free walkable cell next to a unit on floor g (null: none), for a wounded teammate moved off a landing.
function asideCell(b, o, g) {
  const F = b.floors && b.floors[g];
  if (!F) return null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x = o.x + dx, y = o.y + dy;
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
    const c = F.cells[y * b.w + x];
    if (!CELL[c.k] || !CELL[c.k].walk || c.k === "stairs" || barredCell(c)) continue;
    if (b.units.some((q) => (q.f || 0) === g && !q.dead && !q.left && !q.fled && !q.off && q.x === x && q.y === y)) continue;
    return [x, y];
  }
  return null;
}
// Before taking the stairs to floor g: a wounded teammate lying on that landing is moved to the cell beside it.
function landingClear(b, u, g) {
  for (const o of b.units) {
    if (o === u || !o.down || o.dead || o.side !== u.side || (o.f || 0) !== g || o.x !== u.x || o.y !== u.y) continue;
    const c = asideCell(b, o, g);
    if (c) { o.x = c[0]; o.y = c[1]; }
  }
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
  } else if (setup.baseId) list = homeAt(state, setup.baseId); // world.js: not those out of the walls on a job trip (jobtrips.js)
  else if (setup.lentIds) list = setup.lentIds.map((id) => survivorById(state, id)).filter((s) => s && s.alive); // volunteers.js: your people lent out, in their group's fight you watch
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
  if (state.autoCombat || typeof window === "undefined" || setup.quick) { // setup.quick: a fight chosen "by the numbers" (conflicts.js rescue card)
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
  if (!(result && result.worn) && (setup.mode !== "raid" || (result && result.enemiesKilled))) wearByNumbers(state, combatants(state, setup)); // armour.js: armour pieces wear by their hits (absorbOffscreen), the rest a use a fight
  battleRecord(state, setup, result, battle, combatants(state, setup)); // relations.js: kills, downed, rescues, shared hardship
  volFought(state, combatants(state, setup)); // volunteers.js: they fought beside you (goodwill when they get home)
  capturePrisoners(state, setup, result, battle); // prisoners.js: the knocked out go with the team or into the cells
  if (battle) settleClaims(state, battle, result); // foundcars.js: the cars claimed on the map join the team or stay parked there
  settleCarried(state, setup, result, battle); // carry.js: won, the loads set down are picked up again; else they stay on the ground
  settleArsenal(state, setup, result, battle); // arsenal.js: a group's dead lose their kit (or it is picked up), the rest wears, rounds spent
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
// ammoOk: true / false for the whole team, or the shots it has { ammo, arrows } (world.js armedFactor: the bows short
// of arrows and the guns short of ammo each count 0.6 under 3 a head).
export function byNumbersOdds(state, setup, people = combatants(state, setup), ammoOk = true) {
  const armed = typeof ammoOk === "object" && ammoOk ? armedFactor(people, ammoOk.ammo, ammoOk.arrows) : ammoOk ? 1 : 0.6;
  let mine = people.reduce((a, s) => a + combatPower(s), 0) * armed * teamSpirit(state, people); // friends and rivals (relations.js)
  if (typeof ammoOk === "object" && ammoOk && ammoOk.ammo && typeof ammoOk.ammo === "object") mine *= ammoEdge(ammoOk.ammo, setup.enemy); // R8: the types of round drawn (ammo.js: AP against armour, hollow points against the rest)
  mine *= 1 + lureEdge(setup.enemy, carriedKeys(state, setup, people)); // decoys.js: decoys and Molotovs against the dead (not a Shepherd's pack)
  let theirs = setup.enemy.count * setup.enemy.power * (setup.enemy.fortified || 1) * typeStrength(setup.enemy); // fortified: behind their walls (conquest.js); types: a hive's special dead (zombietypes.js)
  const vo = vehicleOdds(state, setup); // vehicles.js: bulletproof glass blunts an ambush on the road; their turret (a military group's Humvee)
  if (setup.ambush === "player") mine *= 1.4;
  if (setup.ambush === "enemy") theirs *= 1.4 * vo.theirsAmbush;
  theirs += vo.theirsAdd;
  mine += vo.mineAdd; // the team's own turret (a Humvee's M2)
  if (setup.allyPower) mine += setup.allyPower; // thirdside.js: soldiers or survivors fighting the same enemy (wanderers.js)
  if (setup.mineMult > 0) mine *= setup.mineMult; // hivecrawl.js coreFire: the team's fire at the core (range, reloads)
  const ratio = mine / Math.max(0.1, theirs);
  return { mine, theirs, ratio, win: winOdds(ratio, { ...setup.enemy, people: people.length, ambush: setup.ambush, hive: /^hive/.test(setup.layout || "") }) }; // hive, hivechamber, hivecore (hivecrawl.js)
}
// The keys of everything a fight's people carry, and their team's cargo (decoys.js lureEdge).
function carriedKeys(state, setup, people) {
  const out = [];
  for (const s of people) for (const it of allCarried(s)) out.push(it.key); // inventory.js: worn, pockets, rig pouches, the pack
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
// Refitted after the weapons wave (per-hit armour, bursts, jams: tools/calibrate.js seeds 5, 6, 8, 1944 fights; was
// RATIO 3.77, NUMBERS 1.85, ZOMBIES 2.52, MIXED 1.74, HIVE 0.25, THEY_AMBUSH 0.33, YOU_AMBUSH -0.23): soldiers in plate
// now win most even fights on the map (13-32% for you where the numbers said 50-88%), and against raiders and the dead
// the map's odds rise faster with the power ratio.
export const ODDS = { RATIO: 6.15, NUMBERS: -0.23, ZOMBIES: 4.45, MIXED: 1.23, SOLDIERS: -2.68, HIVE: -0.79, THEY_AMBUSH: 1.41, YOU_AMBUSH: -0.6, MIN: 0.03, MAX: 0.97 };
export function winOdds(ratio, enemy = null) {
  const e = enemy || {};
  const dead = e.kind === "zombies";
  let z = ODDS.RATIO * Math.log(Math.max(0.01, ratio));
  if (!dead && e.people > 0 && e.count > 0) z += ODDS.NUMBERS * Math.log(e.people / e.count);
  if (dead) z += ODDS.ZOMBIES;
  else if (e.kind === "mixed") z += ODDS.MIXED;
  else if (e.kind === "soldiers") z += ODDS.SOLDIERS;
  if (e.hive) z += ODDS.HIVE;
  if (e.ambush === "enemy") z += ODDS.THEY_AMBUSH;
  if (e.ambush === "player") z += ODDS.YOU_AMBUSH;
  return Math.max(ODDS.MIN, Math.min(ODDS.MAX, 1 / (1 + Math.exp(-z))));
}

// Quick statistical resolution, used headless and as a fallback.
// Rounds a shooter has on them (pockets and rig pouches: the shells a trip packs, carrykit.js packShells) fire when the
// team's packed supplies fall short of the 6 a head a fight by the numbers draws (2026-10-13: a shotgun team whose
// shells all sat in pockets fought with none, at 60%, while the odds shown assumed them: tools/crawlbalance.js).
// Adds what was taken to `drawn` ({ n, used }) and removes it from the stacks.
function takeHandRounds(drawn, gunners, total) {
  let short = total - drawn.n;
  for (const s of gunners) {
    if (short <= 0) break;
    const w = s && s.gear && s.gear.weapon;
    const cal = w ? calOf(w.key) : null;
    if (!cal) continue;
    const keys = typesOf(cal).flatMap((t) => withHand(ammoKey(cal, t)));
    let want = Math.min(short, Math.ceil(total / Math.max(1, gunners.length)));
    for (const x of carriedSpots(s)) {
      if (want <= 0) break;
      if ((x.where !== "pocket" && x.where !== "rig") || !x.item || !keys.includes(x.item.key)) continue;
      const have = Math.max(0, Math.floor(Number(x.item.dur) || 0));
      const q = Math.min(want, have);
      if (q <= 0) continue;
      x.item.dur = have - q;
      if (x.item.dur < 1) x.take();
      drawn.n += q; drawn.used[x.item.key] = (drawn.used[x.item.key] || 0) + q;
      want -= q; short -= q;
    }
  }
}
export function autoResolveCombat(state, setup) {
  const people = combatants(state, setup);
  const party = setup.partyId ? state.parties.find((x) => x.id === setup.partyId) : null;
  const base = setup.baseId ? state.bases.find((b) => b.id === setup.baseId) : null;
  if (!people.length) {
    // Nobody to fight: no dice, no losses on either side.
    return { outcome: "defeat", enemiesKilled: 0, enemiesLeft: setup.enemy.count, survivorsHurt: [], survivorsDead: [], ammoUsed: 0, loot: { supplies: {}, gear: [] } };
  }
  // A team shoots from what it packed and from ammo it found on the way (the same two pools as a tactical battle): up
  // to 6 rounds a head, a bow's in arrows (world.js usesArrows), everyone else's in rounds of their gun's calibre
  // (ammo.js drawTeamShots: a team can only shoot the rounds that fit its guns; no gun, any rounds).
  if (party) settleParty(state, party); else if (base) settleBase(state, base);
  const pools = party ? [party.supplies, party.cargo ? party.cargo.supplies : {}] : base ? [base.stock] : [{}];
  const archers = people.filter(usesArrows).length;
  const draw = (k, want) => {
    const have = pools.reduce((a, o) => a + Math.max(0, Math.floor(o[k] || 0)), 0);
    const used = Math.min(have, want);
    let owed = used;
    for (const o of pools) {
      const t = Math.min(owed, Math.max(0, Math.floor(o[k] || 0)));
      if (t > 0) o[k] -= t;
      owed -= t;
    }
    return used;
  };
  const drawn = drawTeamShots(pools, people.filter((s) => !usesArrows(s)), (people.length - archers) * 6);
  takeHandRounds(drawn, people.filter((s) => !usesArrows(s)), (people.length - archers) * 6);
  const ammoUsed = drawn.n;
  const arrowsUsed = archers ? draw("arrows", archers * 6) : 0;
  const shots = { ammo: drawn.used, arrows: arrowsUsed }; // by key: each calibre's guns judged by their own rounds (world.js armedFactor)
  const odds = byNumbersOdds(state, setup, people, shots);
  // causes.js: the odds, for a death's "Why?" (short of ammo: false, as always; with bows, which of them was short).
  const gunsShort = ammoUsed < (people.length - archers) * 3, bowsShort = arrowsUsed < archers * 3;
  noteFight(state, setup, odds, people.length, !gunsShort && !bowsShort ? true : !archers ? false
    : gunsShort && bowsShort ? "Ammo and arrows were short: everyone fought at 60%." : gunsShort ? "Ammo was short: the guns fought at 60%." : "Arrows were short: the bows fought at 60%.");
  const ratio = odds.ratio;
  const tile = party ? partyTile(party) : tileIdOf(setup);
  // Defending a base (interior.js baseTiers): the walls, the yard and the buildings each multiply what the defenders
  // are worth; the battle is won at the tier where they first match the attackers, or lost (overrun). Base defences
  // have no break-off: falling back is the tiers themselves.
  const tiers = setup.layout === "baseDefence" && base ? baseTiers(state, base, setup, ratio) : null;
  if (!tiers) {
    // breakoff.js: the fight plays out in rounds, and a team in the field breaks it off by its retreat policy.
    const refund = (n, k = "ammo") => { if (!pools[0]) return; if (k === "ammo") refundShots(pools[0], drawn.used, n); else pools[0][k] = (pools[0][k] || 0) + n; }; // ammo.js: the rounds drawn go back by key
    const r = fightByNumbers(state, setup, people, { win: odds.win, ammoUsed, arrowsUsed, refund, tile });
    // Won: about half the arrows loosed are picked up again (world.js ARROWS.BACK); lost or broken off, none.
    r.arrowsBack = r.outcome === "victory" ? arrowsBack(r.arrowsUsed || 0) : 0;
    if (r.arrowsBack) refund(r.arrowsBack, "arrows");
    return r;
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
    const amt = rng.int(lo, hi);
    hurt(state, s, amt, tile, `in a fight with ${setup.enemy.name || setup.enemy.kind}`);
    if (s.alive) absorbOffscreen(s, amt, setup.enemy.kind, state); // armour.js: the armour they wore took its share
    (s.alive ? hurtIds : deadIds).push(s.id);
  }
  const killed = win ? setup.enemy.count : Math.floor(setup.enemy.count * rng.range(0.1, 0.5));
  fightXp(state, people, win); // skills.js: Shooting XP for everyone who fought
  // Held: the arrows shot from the walls are picked up again, about half (world.js ARROWS.BACK); overrun, none.
  const back = win ? arrowsBack(arrowsUsed) : 0;
  if (back && pools[0]) pools[0].arrows = (pools[0].arrows || 0) + back;
  return {
    outcome: win ? "victory" : "defeat",
    enemiesKilled: killed, enemiesLeft: setup.enemy.count - killed,
    survivorsHurt: hurtIds, survivorsDead: deadIds, ammoUsed, arrowsUsed, arrowsBack: back,
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
// Vaulting half cover (the user's request 2026-10-17): a person goes over a waist-high cell (a fence, crates, a car,
// sandbags, a table: CELL cover 1 and walk false; vaultable) instead of round it, at COST tiles more than a plain step
// (reachable, distField), never stopping on it, and lands winded: COST tiles less of movement for the rest of the turn
// (u.vaulted, read by moveMob; the next turn clears it). A scuff is heard nearby and the raid's noise (b.noise) rises
// by NOISE a vault, no alert. The dead never vault (the Climber has climbOver; a walker crawls over the same cells at
// the dearer CRAWL.COST: barricade.js), nor anyone with their arms full.
export const VAULT = { COST: 2, NOISE: 1 };
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
  rail:    { walk: false, cover: 1, los: false, name: "Bridge railing" }, // a bridge's railing over the river (layRoad)
  // In front of a bridge barricade (deploy.js, conquest.js): steel hedgehogs people walk between but no vehicle can
  // drive through (driveTo wants open ground); battered down from next to them (c.hp, bash).
  tanktrap: { walk: true,  cover: 1, los: false, name: "Tank trap" },
  // Raid containers and props.
  shelf:   { walk: false, cover: 1, los: false, name: "Shelves" },
  locker:  { walk: false, cover: 2, los: true,  name: "Lockers" },
  cabinet: { walk: false, cover: 1, los: false, name: "Cabinet" },
  counter: { walk: false, cover: 1, los: false, name: "Counter" },
  gunsafe: { walk: false, cover: 2, los: false, name: "Gun safe" }, // locks.js / gunsafes.js: a steel safe, waist to head high
  vehicle: { walk: false, cover: 2, los: true,  name: "Your vehicle" },
  // A cart let go (carts.js): a mini barricade on its cell, half cover: the living never vault it (NO_VAULT: they
  // shove it, barricade.js, or go round), the dead crawl over it (barricade.js crawlable), a brute smashes it.
  cart:    { walk: false, cover: 1, los: false, name: "Cart" },
  // Base defences against hordes and the inside of a hive (defences.js, hives.js). trap: what happens to one of
  // the dead that steps in (spikes hurt, a trench stops it for the turn).
  barricade: { walk: false, cover: 2, los: false, name: "Barricade" },
  spikes:    { walk: true,  cover: 0, los: false, name: "Spike pit", trap: "spikes" }, // the living too, but never your own people (SPIKES, moveAlong)
  trench:    { walk: true,  cover: 0, los: false, name: "Trench", trap: "trench" },
  // From the armory's defence kit (defences.js armoryDefence) and the base's wire fences (buildings.js barbed_wire,
  // razor_wire; c.razor): wire stops the dead like the trench (razor wire cuts them too) and snags the living unless
  // they cut it (wire.js wireStep); a bear trap hurts and holds the first one to step in (then it is sprung).
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
  smashed:   { walk: false, cover: 1, los: false, name: "Broken window" }, // the sill is half cover like a window's; vaulted through (windows.js), nobody stands in it
  // A door, a doorway or a window with boards nailed across it (barricade.js): a wall for sight and movement, full
  // cover, battered through by the dead and the human enemy (its hit points), torn down again from either side.
  boarded:   { walk: false, cover: 2, los: true,  name: "Boards" },
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
// A field map's houses (genMap building): real doors, never a gap in the wall. The first door of a house is closed
// (walked through it opens: openDoor), each other one locked LOCKED of the time (locks.js: key, lockpicks or force; the
// dead and the enemy batter it, BMAP.DOOR) or left open OPEN of the time. hash01 dice: the map's own rolls are as before.
export const FIELD_DOOR = { LOCKED: 0.4, OPEN: 0.2 };
const DOORS = new Set(["door", "idoor", "odoor"]);
// Battering and climbing by the kind of unit (base battles): bash multiplies its blows against a structure, climb is
// the moves a level up or down. Looked up by its kind, then its variant (more kinds of the dead slot in here: a
// "variant" or "zkind" key on the unit), then its boss; anything not listed takes its kind's.
export const UNIT_SIEGE = {
  human: { bash: 1, climb: HEIGHT.CLIMB }, zombie: { bash: 1, climb: HEIGHT.CLIMB_DEAD },
  wallbreaker: { bash: 3, climb: 3 }, broodmother: { bash: 2, climb: 3 },
};
export const siegeRule = (u) => ({ bash: 1, climb: HEIGHT.CLIMB, ...(u && UNIT_SIEGE[u.kind]), ...(u && UNIT_SIEGE[u.variant || u.zkind]), ...(u && UNIT_SIEGE[u.boss]) });

// Weapon stats in battle, keyed like GEAR. opt = best range; fall = aim lost per tile beyond it. ammo = rounds a shot
// uses; cap = the rounds its magazine (tube, cylinder) holds (magCap; Reload fills it). No cap: no magazine (melee, the
// bows and crossbows draw their arrow or bolt as part of the shot, a spitter's acid).
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
  // Every gun's dmg keeps within 15% of its calibre's reference (data-ammo.js CAL_DMG, the balance ladder of 2026-10-10:
  // .22 < 9mm < .45 < .357 < 20 ga < 5.56 < 7.62×39 < 12 ga < .30-30 < .308 < 12 ga slug < .50): the hunting rifle went
  // 24–34 to 31–43, the lever-action 20–30 to 25–35, the police carbine 20–29 to 21–30 (tools/arsenalbalancetest.js).
  pistol:    { name: "9mm pistol",     dmg: [15, 22], opt: 6,  fall: 4, aim: 4,  ammo: 1, noise: 2, cap: 15, cal: "9mm", rel: 0.35 }, // a double-stack 9mm magazine
  shotgun:   { name: "Pump shotgun",   dmg: [24, 36], opt: 4,  fall: 7, aim: 10, ammo: 1, noise: 3, close: 10, cap: 6, cal: "12ga", rel: 0.3 }, // a pump: five in the tube and one in the chamber
  huntrifle: { name: "Hunting rifle",  dmg: [31, 43], opt: 8, fall: 2.6, aim: 4,  ammo: 1, noise: 3, close: -3, cap: 5, cal: "308", rel: 0.15 }, // a bolt-action's internal magazine
  ar:        { name: "Assault rifle",  dmg: [22, 32], opt: 9,  fall: 3, aim: 8,  ammo: 2, noise: 3, cap: 30, cal: "556", rel: 0.5, modes: { single: { rounds: 1, aim: 0 }, burst: { rounds: 2, aim: -10 }, auto: { rounds: 10, aim: -20 } } }, // a 30-round magazine: 15 bursts of 2 (its burst mode; gunfire.js fire modes)
  // Makeshift weapons (crafting.js). The crossbow is silent and shoots bolts (arrows: 1 a shot, data.js SUPPLIES.arrows).
  spikedbat:  { name: "Spiked bat",        melee: true, dmg: [16, 25] },
  pipespear:  { name: "Pipe spear",        melee: true, dmg: [15, 23] },
  sawmachete: { name: "Saw-blade machete", melee: true, dmg: [17, 27] },
  crossbow:   { name: "Scrap crossbow",    dmg: [18, 26], opt: 7, fall: 4, aim: -4, ammo: 0, arrows: 1, noise: 0 },
  pipegun:    { name: "Pipe shotgun",      dmg: [20, 32], opt: 3, fall: 8, aim: -6, ammo: 1, noise: 3, close: 8, cap: 1, cal: "12ga", rel: 1.2 }, // a single-shot zip gun: reloaded after every shot
  // Special crafted weapons (craft books and blueprints, blueprints.js): better than the makeshift ones above.
  springmachete: { name: "Leaf-spring machete", melee: true, dmg: [21, 31] },
  pulleybow:  { name: "Pulley-limb bow",   dmg: [16, 25], opt: 7, fall: 5, aim: -2, ammo: 0, arrows: 1, noise: 0, close: -5 },
  // Found weapons with a role each: clubs for takedowns (stealth.js CLUB), the heavy hitters, quiet bows that shoot
  // arrows (1 a shot, never ammo), a loud hard-hitting revolver, a handy ranch rifle, the police carbine. meleeAim: to hit in melee (sledge).
  bat:        { name: "Baseball bat",      melee: true, dmg: [15, 24] },
  nailbat:    { name: "Nail bat",          melee: true, dmg: [20, 31] },
  prybar:     { name: "Crowbar",           melee: true, dmg: [16, 25] },
  fireaxe:    { name: "Fire axe",          melee: true, dmg: [21, 32] },
  sledge:     { name: "Sledgehammer",      melee: true, dmg: [25, 38], meleeAim: -10 },
  baton:      { name: "Police baton",      melee: true, dmg: [12, 19] },
  spear:      { name: "Steel spear",       melee: true, dmg: [18, 28] }, // a long reach: between the machete and the fire axe
  compbow:    { name: "Compound bow",      dmg: [17, 26], opt: 7, fall: 5, aim: -2, ammo: 0, arrows: 1, noise: 0, close: -5 },
  xbow:       { name: "Hunting crossbow",  dmg: [20, 29], opt: 6, fall: 5, aim: 0, ammo: 0, arrows: 1, noise: 0, close: -5 },
  revolver:   { name: ".357 revolver",     dmg: [20, 30], opt: 5, fall: 5, aim: -2, ammo: 1, noise: 3, cap: 6, cal: "357", rel: 0.05 }, // a six-shot cylinder
  leverrifle: { name: "Lever-action rifle", dmg: [25, 35], opt: 10, fall: 2.5, aim: 4, ammo: 1, noise: 3, cap: 8, cal: "3030", rel: 0.3 }, // a tube under the barrel
  carbine:    { name: "Police carbine",    dmg: [21, 30], opt: 9, fall: 3, aim: 7, ammo: 1, noise: 3, cap: 30, cal: "556", rel: 0.5 }, // a patrol carbine's 30-round magazine (semi-automatic: single only, no modes: data-guns.js)
  // A spitter's acid (zombietypes.js): silent, every `cooldown` turns, cover counts `pierce` steps less against it.
  acid:       { name: "Acid spit",         dmg: [16, 22], opt: 4, fall: 8, aim: 0, ammo: 0, noise: 0, acid: true, cooldown: ZTYPES.spitter.cooldown, pierce: ZTYPES.spitter.pierce },
};
const BASH = [8, 12]; // hitting someone with a gun
export const BODY_FINDS = 0.2; // a person's body: the chance of one small thing in their pockets (KITS finds)

// loot = spare gear a body may carry (a loose gun attachment among it: gunmods.js; the parts on their gun: ENEMY_MODS); pack = [pack key, chance] a body wears one; finds = the small things in their
// pockets (valuables, smokes, a throwable; 20% a body) (inventory.js enemyBody).
export const KITS = {
  raiders:  { label: "Raider",  aim: 3, hp: 5,  weapons: ["pistol", "pistol", "shotgun", "huntrifle", "machete", "revolver"], strong: ["shotgun", "ar", "huntrifle"], armor: [null, null, "vest"], loot: ["pistol", "shotgun", "machete", "huntrifle", "vest", "spikedbat", "tirevest", "bikehelmet", "kneeguards", "revolver", "nailbat", "slingbag", "molotov", "pipebomb", "comp"], pack: ["backpack", 0.15],
              finds: ["cigarettes", "cigarettes", "smokes", "smokes", "vodka", "whiskey", "goldchain", "goldring", "watch", "lighters", "molotov", "tobacco"] },
  soldiers: { label: "Soldier", aim: -6, hp: -10, weapons: ["ar", "ar", "huntrifle", "shotgun", "carbine"], strong: ["ar"], armor: ["vest", "plate"], loot: ["ar", "plate", "vest", "nvg", "milradio", "riothelmet", "smokegren", "frag", "rucksack", "camonet", "binoculars", "thermal", "reddot", "holo"], pack: ["assaultpack", 0.3],
              finds: ["cigarettes", "chocolate", "chocolate", "instcoffee", "smokegren", "flare", "frag", "heatpack", "batteries", "cards", "photos", "toothpaste", "wetwipes"] },
  zealots:  { label: "Zealot",  aim: 0, hp: 5,  weapons: ["shotgun", "pistol", "machete", "fireaxe", "huntrifle"], strong: ["shotgun", "huntrifle"], armor: [null], loot: ["machete", "shotgun", "pistol", "knife", "fireaxe", "molotov", "compbow"], fearless: true,
              finds: ["candles", "candles", "molotov", "photos", "tea", "honey"] },
  // People of the other group types (conflicts.js KIND_OF). All human: "mixed" is only for humans plus the dead.
  fighters: { label: "Fighter", aim: 3, hp: 5,  weapons: ["pistol", "shotgun", "huntrifle", "huntrifle", "machete", "leverrifle"], strong: ["ar", "shotgun", "huntrifle"], armor: [null, null, "vest"], loot: ["pistol", "shotgun", "huntrifle", "machete", "vest", "kneeguards", "leverrifle", "prybar", "hikingpack"], pack: ["backpack", 0.15],
              finds: ["smokes", "chocolate", "batteries", "lighters", "photos", "cards", "flare", "deodorant"] },
  guards:   { label: "Guard",   aim: 2, hp: 0,  weapons: ["pistol", "pistol", "shotgun", "huntrifle", "revolver"], strong: ["shotgun", "huntrifle"], armor: [null, null, "vest"], loot: ["pistol", "shotgun", "knife", "vest", "bikehelmet", "baton", "cuffs", "riotarms", "laser"], pack: ["backpack", 0.3],
              finds: ["smokes", "instcoffee", "cards", "cuffs", "flare", "watch"] },
  militia:  { label: "Militia", aim: 0, hp: 0,  weapons: ["huntrifle", "shotgun", "pistol", "machete", "pipespear", "leverrifle", "bat"], strong: ["huntrifle", "shotgun"], armor: [null], loot: ["huntrifle", "machete", "knife", "pipespear", "padding", "leverrifle", "bat"],
              finds: ["smokes", "tobacco", "photos", "harmonica", "chocolate", "honey", "toothpaste"] },
  // Merchant caravans' escorts from outside the state (escorts.js, by their company's gear): the riflemen, and the
  // armoured tier's hired guns in vests and plates with automatic rifles.
  escorts:  { label: "Escort",  aim: 2, hp: 3,  weapons: ["huntrifle", "huntrifle", "leverrifle", "shotgun", "carbine", "pistol"], strong: ["carbine", "huntrifle", "ar"], armor: [null, "vest", "vest"], loot: ["huntrifle", "leverrifle", "shotgun", "pistol", "vest", "bikehelmet", "binoculars", "flashlight", "handradio"], pack: ["backpack", 0.3],
              finds: ["smokes", "instcoffee", "cards", "watch", "lighters", "chocolate", "batteries"] },
  contractors: { label: "Contractor", aim: -2, hp: -5, weapons: ["ar", "ar", "carbine", "carbine", "huntrifle"], strong: ["ar"], armor: ["vest", "plate", "plate"], loot: ["ar", "carbine", "plate", "vest", "riothelmet", "milhelmet", "nvg", "milradio", "smokegren", "frag", "binoculars", "reddot", "holo"], pack: ["assaultpack", 0.35],
              finds: ["cigarettes", "chocolate", "instcoffee", "smokegren", "frag", "batteries", "watch", "goldchain", "photos"] },
  // Nomad bands (nomads.js), by tier: looters (melee and a few pistols, no armour), survivalists (hunting rifles,
  // bows and shotguns, light armour), preppers (rifles and carbines, plate carriers and scrap-steel vests: AC 3 and up).
  looters: { label: "Looter", aim: -2, hp: 0, weapons: ["machete", "bat", "nailbat", "knife", "prybar", "pistol", "pipespear", "revolver"], strong: ["pistol", "revolver", "shotgun"], armor: [null], loot: ["machete", "knife", "bat", "nailbat", "prybar", "pistol", "slingbag", "flashlight", "molotov"], pack: ["slingbag", 0.3],
              finds: ["cigarettes", "lighters", "watch", "goldring", "goldchain", "candy", "photos", "batteries"] },
  survivalists: { label: "Survivalist", aim: 3, hp: 3, weapons: ["huntrifle", "huntrifle", "leverrifle", "shotgun", "compbow", "xbow", "machete"], strong: ["huntrifle", "leverrifle"], armor: [null, "tirevest", "vest"], loot: ["huntrifle", "leverrifle", "compbow", "machete", "knife", "snarewire", "binoculars", "hikingpack", "bandagekit", "waterfilter"], pack: ["hikingpack", 0.4],
              finds: ["lighters", "candles", "honey", "tea", "photos", "harmonica", "flare", "cigarettes"] },
  preppers: { label: "Prepper",  aim: 4, hp: 5, weapons: ["ar", "carbine", "carbine", "huntrifle", "shotgun"], strong: ["ar", "carbine"], armor: ["plate", "plate", "scrapvest"], loot: ["ar", "carbine", "plate", "milhelmet", "binoculars", "handradio", "rucksack", "bandagekit", "nvg", "smokegren"], pack: ["rucksack", 0.4],
              finds: ["chocolate", "instcoffee", "batteries", "heatpack", "lighters", "watch", "flare", "toothpaste"] },
  // Loose survivors on their own (wanderers.js): the aggressive ones who rob like raiders, and neutrals on the map.
  survivors: { label: "Survivor", aim: -4, hp: -5, weapons: ["knife", "bat", "prybar", "pistol", "pistol", "revolver", "huntrifle", "shotgun"], strong: ["shotgun", "huntrifle"], armor: [null, null, null, "vest"], loot: ["knife", "bat", "prybar", "pistol", "revolver", "slingbag", "flashlight", "bikehelmet", "tirevest"], pack: ["backpack", 0.25],
              finds: ["photos", "photos", "cigarettes", "lighters", "chocolate", "candy", "watch", "goldring", "batteries", "deodorant", "lipbalm", "wetwipes"] },
};
// The weapons overhaul (data-guns.js): new weapons, and each kit's lists extended (KIT_PATCH appends to them).
Object.assign(WEAPONS, GUN_WEAPONS);
for (const [kind, patch] of Object.entries(KIT_PATCH)) {
  const kit = KITS[kind];
  if (!kit) continue;
  for (const [k, list] of Object.entries(patch)) kit[k] = Array.isArray(kit[k]) ? [...kit[k], ...list] : list;
}
for (const [k, p] of Object.entries(WEAPON_PATCH)) if (WEAPONS[k]) Object.assign(WEAPONS[k], p); // melee traits, the lever-action's six
// Non-lethal weapons (data-nonlethal.js): the stun baton, and the lists of the kits that carry it and tasers and spray.
Object.assign(WEAPONS, NL_WEAPONS);
for (const [kind, patch] of Object.entries(NL_KIT_PATCH)) for (const [k, list] of Object.entries(patch)) if (KITS[kind]) KITS[kind][k] = [...(KITS[kind][k] || []), ...list];
// Knives and swords (data-blades.js): their battle numbers, and the kits whose bodies carry them (loot lists only).
Object.assign(WEAPONS, BLADE_WEAPONS);
for (const [kind, patch] of Object.entries(BLADE_KIT_PATCH)) for (const [k, list] of Object.entries(patch)) if (KITS[kind]) KITS[kind][k] = [...(KITS[kind][k] || []), ...list];
// Survival gear (data-survival.js): the two tool weapons' battle numbers, and what the kits' bodies carry (loot lists only).
Object.assign(WEAPONS, SURV_MELEE);
for (const [kind, patch] of Object.entries(SURV_KIT_PATCH)) for (const [k, list] of Object.entries(patch)) if (KITS[kind]) KITS[kind][k] = [...(KITS[kind][k] || []), ...list];

const idx = (x, y) => y * W + x;
const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
const cellAt = (b, x, y) => CELL[b.cells[idx(x, y)].k];
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
// off: an attacker still outside, waiting to come in through a breach (interior.js): not on the map yet.
// away: on another storey than the active one (a multi-storey building, b.floors: setFloor keeps the flag): off this
// floor's map, so it is neither seen, shot, bumped into nor moved by this floor's turn. Every unit has u.f (its floor,
// 0 by default); u.away is exactly (u.f !== b.floor), kept by setFloor and the floor changes (goup / godown).
// tied: one flag for everyone tied up, either side: an enemy knocked out and tied (stealth.js Tie up), one who gave up
// and was tied (nonlethal), and a captive of yours tied up on a rescue raid's map (rescueraid.js). Tied, nobody acts as a
// fighter or is anyone's target; the knocked out and surrendered are also down. A captive who is only tied (not down) can
// still work at the ropes or the lock (combatAct "rescue"), and anyone tied of yours can be cut loose (rescueraid.js).
export const isTied = (u) => !!(u && u.tied);
export const active = (u) => !u.dead && !u.down && !u.left && !u.fled && !u.off && !u.away && !isTied(u);
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
// Half cover a person vaults (VAULT): waist high and not walkable, a window too (windows.js: an open or broken one
// at the vault's cost, a closed one crashed through: vaultBreaks), never cell bars, a bridge railing or a well,
// nothing tall, no trap, not a plated vehicle (full cover, sideCover). Who vaults (canVault): people on their feet
// with their arms free (carry.js handsBusy), not carrying or dragging a body, not on a ram's crew (siege.js); never
// the dead (one of the dead clambers through an open or broken window: clambers, at the same cost).
const NO_VAULT = new Set(["bars", "rail", "well", "cart"]); // cart: the living shove a parked cart or go round (carts.js); the dead crawl over it (barricade.js crawlable)
export function vaultable(b, c) {
  const C = c && CELL[c.k];
  if (!C || C.walk || C.cover !== 1 || C.tall || C.trap || NO_VAULT.has(c.k)) return false;
  if (c.car && c.car.up && (c.car.up.p || c.car.up.s)) return false;
  return true;
}
export const canVault = (u) => !!u && u.kind === "human" && !u.ztype && !u.dead && !u.down && !u.aboard && !u.gunner && !handsBusy(u) && u.carrying == null && u.dragging == null && u.ram == null;
// A vault through this cell crashes through a closed window (loud, cuts: windows.js WINDOW.BREAK / HURT).
export const vaultBreaks = (c) => !!c && c.k === "window" && !windowOpen(c);
// The tiles a vault over this cell costs beyond the step: VAULT.COST, and a closed window SMASH_COST more (the path
// takes an open way of the same length first).
export const vaultCost = (b, c) => VAULT.COST + (vaultBreaks(c) ? WINDOW.SMASH_COST : 0);
// One of the dead clambers through an open or broken window (never a closed one: on a base's map it batters it);
// a Climber goes over walls its own way (middead.js), a 2 × 2 boss never fits.
export const clambers = (u) => !!u && u.kind === "zombie" && u.ztype !== "climber" && unitSize(u) === 1 && !u.dead;
// A unit's footprint: one cell, or size × size cells from its (x, y) corner (the Broodmother and the Hivemind, 2 × 2:
// defences.js BOSSES size). Distance, reach and sight go by the nearest of its cells; its figure stands on the centre.
export const unitSize = (u) => u.size || 1;
export const coversCell = (u, x, y) => x >= u.x && y >= u.y && x < u.x + unitSize(u) && y < u.y + unitSize(u);
export function unitCells(u, x0 = u.x, y0 = u.y) { const s = unitSize(u), out = []; for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) out.push([x0 + dx, y0 + dy]); return out; }
export const nearCell = (u, x, y) => { const s = unitSize(u); return [Math.max(u.x, Math.min(u.x + s - 1, x)), Math.max(u.y, Math.min(u.y + s - 1, y))]; };
export const unitCenter = (u) => [u.x + unitSize(u) / 2, u.y + unitSize(u) / 2];
export const unitAt = (b, x, y) => b.units.find((u) => onMap(u) && (u.size > 1 ? coversCell(u, x, y) : u.x === x && u.y === y));
// unitAt for every cell of a w × h map at once: 1 where someone stands. For the set-up scans that ask it of every cell
// (combat.js pickCells, deploy.js): made fresh for each scan, as nobody moves while one runs.
export function occupancy(b, w, h) {
  const occ = new Uint8Array(w * h);
  for (const u of b.units) {
    if (!onMap(u)) continue;
    const s = u.size > 1 ? u.size : 1;
    for (let y = u.y; y < u.y + s; y++) for (let x = u.x; x < u.x + s; x++) if (x >= 0 && y >= 0 && x < w && y < h) occ[y * w + x] = 1;
  }
  return occ;
}
export const unitById = (b, id) => b.units.find((u) => u.id === id);
// The evac strip: the left evacCols columns, or b.evacMask (a cell mask, deploy.js: base battles turned to face the
// attack get theirs on the side away from it, b.evacSide) when there is one; then the cell's y is needed.
export const inEvac = (b, x, y) => b.evacCols > 0 && (b.evacMask ? y != null && !!b.evacMask[y * b.w + x] : x < b.evacCols);
const bump = (b) => { b.rev++; if (b.rams && b.rams.length) checkRams(b); MED.dragSweep(b); trackGhosts(b); }; // medics.js: a dragger who fell lets go

export function say(b, text, k = "info") {
  b.log.push({ turn: b.turn, text, k });
  if (b.log.length > 80) b.log.shift();
}
// A line kept in its place for text known only later: a shot or a blow is logged before the "is dead" its damage says.
function sayFirst(b) {
  const line = { turn: b.turn, text: "", k: "info" };
  b.log.push(line);
  if (b.log.length > 80) b.log.shift();
  return line;
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
// Every round your side has, any calibre (the battle screen's figure; ammo.js sideRounds: the pools and the boxes the
// fighters carry). A gun fires only its own calibre and loaded type: ammo.js roundsOf(b, u).
export const ammoLeft = (b) => sideRounds(b);
// Arrows (and crossbow bolts) to hand: the team's packed and found ones, or the base's stock, like the ammo.
export const arrowsLeft = (b) => pool(b, "arrows");
// Has the player's side what this weapon shoots (rounds of its calibre and loaded type for a gun, with u the shooter;
// arrows for a bow or crossbow)? Without u, any rounds.
export const hasShot = (b, w, u = null) => (!w.ammo || (u && isStacked(u) ? magIn(u) : u ? roundsOf(b, u) : ammoLeft(b)) >= (w.mounted ? 1 : w.ammo)) && (!w.arrows || arrowsLeft(b) >= w.arrows); // a turret: a short last burst (magEmpty); physical rounds (mags.js): what is in the gun
// A shot by one of your people: its rounds (its calibre and loaded type: its own boxes, the team's, the pools) or its
// arrow from the pools (b.arrowsUsed: picked up again after a win).
function spendShot(b, w, u) {
  if (w.ammo) { const n = takeBattleRounds(b, u, w.ammo); b.ammoUsed += n; noteBrass(b, u, n); } // reloading.js: its brass, picked up after a win
  if (w.arrows) { take(b, "arrows", w.arrows); b.arrowsUsed = (b.arrowsUsed || 0) + w.arrows; }
}
// After the fight: about half the arrows loosed are picked up again when the field is yours (world.js ARROWS.BACK),
// into the team's packed supplies (or the base's stock). None after a loss or a retreat. Returns how many.
function pickUpArrows(b, won) {
  const n = won ? arrowsBack(b.arrowsUsed || 0) : 0;
  if (n > 0 && b.pools[0]) b.pools[0].arrows = (b.pools[0].arrows || 0) + n;
  return n;
}
export const medsLeft = (b) => pool(b, "meds");
// The empty magazines thrown as lures (stealth.js THROWABLES.emptymag, b.thrown): picked up again when the field is
// yours, back onto whoever threw them (else the team's cargo list is not reachable here: lost). Returns the summary lines.
function thrownBack(state, b, won) {
  const list = b.thrown || [];
  b.thrown = [];
  if (!list.length) return [];
  let back = 0;
  if (won) for (const t of list) { const s = survivorById(state, t.sid); if (s && s.alive && stow(s, t.item)) back++; }
  return [back ? `Picked up ${back} of the ${list.length} magazine${list.length === 1 ? "" : "s"} thrown.` : `The ${list.length} magazine${list.length === 1 ? "" : "s"} thrown ${list.length === 1 ? "is" : "are"} lost.`];
}

/// ---------- battle map ----------
// Roads, bridges and the cars on them (the battle maps). A road tile's map has the road across it, ROAD.WIDTH (8) cells
// wide (6 on a small field map), with the cars people fled in scattered along it: cover, and on a raid map the
// searchable ones (AREAS.roadcars). A bridge tile (a road over a water tile, mapgen.js) has the river across the map
// too, bridgeSpan wide (12–24 cells: about half the map), and the road crosses it on a concrete deck between two
// railings ("rail" cells: half cover you see over): the only way from one bank to the other, so a fight funnels onto
// it. c.deck marks the deck's cells (ui/isoview.js draws the concrete).
// Cars are 2 cells across and 3 (a sedan) or 4 (a van, a pickup, a truck) long. Every cell of one is a "car" (or
// "truck") cell sharing c.car = { id, i, j, L, ax, kind, v }: i along the length (0 the front), j across, ax the world
// axis the length runs along ("x" | "y"), v the paint dice; the views draw each cell's piece so the pieces make one
// body (ui/isoview.js carPieces, ui/combat.js). A car keeps a free ring of cells around it (never against another car,
// a railing or a wall), so the way along a road is never closed; layRoad checks the road still runs end to end and
// takes cars back out if it does not.
export const ROAD = { WIDTH: 8, WIDTH_SMALL: 6, SMALL_H: 18, SPAN_MIN: 12, SPAN_MAX: 24, SPAN_SHARE: 0.5, BANKS: 10 };
export const roadWidth = (h) => (h >= ROAD.SMALL_H ? ROAD.WIDTH : ROAD.WIDTH_SMALL);
export const bridgeSpan = (w) => Math.max(4, Math.min(ROAD.SPAN_MAX, Math.max(ROAD.SPAN_MIN, Math.round(w * ROAD.SPAN_SHARE)), w - ROAD.BANKS));
export const CAR_LEN = { car: [3, 3, 4], truck: [4] };
// What a battle is called by its tile: the site, else a bridge, a road or the terrain.
export const placeName = (tile) => (!tile ? "Open ground" : tile.loc ? tile.loc.name : tile.bridge ? "Bridge" : tile.road ? `Road (${TERRAIN[tile.terrain] ? TERRAIN[tile.terrain].name.toLowerCase() : tile.terrain})` : tile.terrain[0].toUpperCase() + tile.terrain.slice(1));
// The rect a car at (x, y) covers: its length along ax.
export const carRect = (x, y, ax, L, wide = 2) => (ax === "x" ? { x0: x, y0: y, w: L, h: wide } : { x0: x, y0: y, w: wide, h: L }); // wide: 2 for a car, 1 for a bike
// Put a car down if its cells pass `ok` and the ring around them is open ground (or off the map). Returns the rect.
// opts.ring: false skips the free ring (a car in a garage bay, the team's own vehicle); opts.body: what a "vehicle" cell
// is drawn as ("car" | "truck").
export function placeCar(cells, W, H, x, y, ax, L, kind, ok, v = 0, opts = {}) {
  const r = carRect(x, y, ax, L, opts.wide || 2);
  if (r.x0 < 0 || r.y0 < 0 || r.x0 + r.w > W || r.y0 + r.h > H) return null;
  for (let yy = r.y0 - 1; yy <= r.y0 + r.h; yy++) for (let xx = r.x0 - 1; xx <= r.x0 + r.w; xx++) {
    if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
    const inRect = xx >= r.x0 && yy >= r.y0 && xx < r.x0 + r.w && yy < r.y0 + r.h;
    if (!inRect && opts.ring === false) continue;
    if (inRect ? !ok(xx, yy) : cells[yy * W + xx].k !== "open" && cells[yy * W + xx].k !== "rail") return null; // the ring may touch a bridge's railing (parked at the kerb)
  }
  const id = r.y0 * W + r.x0 + 1;
  for (let yy = r.y0; yy < r.y0 + r.h; yy++) for (let xx = r.x0; xx < r.x0 + r.w; xx++) {
    const c = cells[yy * W + xx];
    c.k = kind;
    c.car = { id, i: ax === "x" ? xx - r.x0 : yy - r.y0, j: ax === "x" ? yy - r.y0 : xx - r.x0, L, ax, kind, v, body: opts.body || kind };
  }
  return { id, ...r, ax, L, kind };
}
export function removeCar(cells, W, r) {
  for (let yy = r.y0; yy < r.y0 + r.h; yy++) for (let xx = r.x0; xx < r.x0 + r.w; xx++) { const c = cells[yy * W + xx]; c.k = "open"; delete c.car; }
}
// ---------- the team's vehicle on the map ----------
// b.vehicle = { x, y, w, h, ax, kind }: the cells it covers are "vehicle" cells sharing c.car (drawn as the team's car,
// blue; a truck 2 × 4, a car 2 × 3). It waits in the entry zone of a raid (or by the west edge of a field battle) and
// can be driven from next to it (combatAct "drive": DRIVE.AP actions, up to DRIVE.RANGE cells over open ground, loud:
// Heat +DRIVE.HEAT and the unaware within DRIVE.RADIUS hear the engine). What is found rides in it wherever it stands
// (raidloot.js stash, atVehicle) and so does the siege ram (siege.js loadRam / unloadRam); extracting from a zone it
// touches keeps it (R.vehicleZone follows it: syncVehicleZone).
export const DRIVE = { RANGE: 8, AP: 2, HEAT: 5, RADIUS: 10, MIL: 1.6 }; // MIL: × Heat and radius for an Army truck (vehicles.js miltruck)
export const nearRect = (r, x, y) => Math.max(r.x - x, x - (r.x + r.w - 1), r.y - y, y - (r.y + r.h - 1), 0) <= 1;
export function placeVehicle(cells, W, H, zone, kind, ok) {
  const mil = kind === "miltruck"; // an Army truck (vehicles.js miltruck): 2 × 5, drawn as the loot trucks are (body "m35")
  const L = mil ? 5 : kind === "truck" ? 4 : kind === "bike" ? 2 : 3; // a bike or a motorcycle: 2 x 1 cells
  const z = zone;
  const [x, y, ax] = z.side === "east" ? [z.x0 + 1, z.y0, "y"] : z.side === "north" ? [z.x0, z.y0, "x"] : z.side === "south" ? [z.x0, z.y0 + 1, "x"] : [z.x0, z.y0, "y"];
  const rect = placeCar(cells, W, H, x, y, ax, L, "vehicle", ok, 0, { ring: false, body: mil ? "m35" : kind, wide: kind === "bike" ? 1 : 2 });
  if (!rect) return null;
  for (let yy = rect.y0; yy < rect.y0 + rect.h; yy++) for (let xx = rect.x0; xx < rect.x0 + rect.w; xx++) cells[yy * W + xx].f = "road";
  return { x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, ax, kind: mil ? "truck" : kind, ...(mil ? { mil: true } : {}) };
}
// The team's other vehicles on a field map (b.convoy: [{ vid, x, y, w, h, ax, kind, cond0, up, wear, blownUp }]): by the
// west edge near the lead one, nearest rows first, never cutting anyone off from the map (b.reach).
function placeConvoy(b, party, others, W, H, inside) {
  b.convoy = [];
  const lead = b.vehicle;
  for (const x of others) {
    const kind = vehicleBody(party, x);
    const rows = [];
    for (let y = 1; y < H - 2; y++) rows.push(y);
    rows.sort((a, c) => Math.abs(a - lead.y) - Math.abs(c - lead.y));
    for (const y of rows) {
      let vr = null;
      for (const x0 of [1, 4, 7]) {
        vr = placeVehicle(b.cells, W, H, { x0, y0: y, side: "north" }, kind, (xx, yy) => inside(xx, yy) && b.cells[idx(xx, yy)].k === "open" && b.reach[idx(xx, yy)] && !unitAt(b, xx, yy));
        if (vr) break;
      }
      if (!vr) continue;
      const reach = flood(b.cells, 0, Math.floor(H / 2));
      b.reach = reach;
      const u = upgradesOf(x);
      b.convoy.push({ ...vr, vid: x.id, name: x.name, cond0: x.condition, wear: 0, up: isBike(x) ? null : { glass: u.glass, mesh: u.mesh, plating: u.plating, scrapPlate: u.scrapPlate, turret: u.turret ? { gun: u.turret.gun } : null } });
      const tag = isBike(x) ? null : carUpTag(u);
      if (tag) for (let cy = vr.y; cy < vr.y + vr.h; cy++) for (let cx = vr.x; cx < vr.x + vr.w; cx++) { const c = b.cells[idx(cx, cy)]; if (c && c.car) c.car.up = tag; }
      break;
    }
  }
}
// What stands for a team's vehicle on a map (placeVehicle): "bike", "miltruck", "truck" (a pickup) or "car".
export const vehicleBody = (party, pv) => (party.vehicle === "bike" || (pv && isBike(pv)) ? "bike" : pv && pv.type === "miltruck" ? "miltruck" : pv && pv.type === "truck" ? "truck" : "car");
export function syncVehicleZone(b) {
  const R = b.raid;
  if (!R || !b.vehicle) return;
  const v = b.vehicle;
  R.vehicleZone = R.zones.findIndex((z) => v.x <= z.x0 + z.w && z.x0 <= v.x + v.w && v.y <= z.y0 + z.h && z.y0 <= v.y + v.h); // touching (a cell apart at most)
  for (let i = 0; i < R.zones.length; i++) R.zones[i].vehicle = i === R.vehicleZone;
}
// Seats: who can ride in the team's vehicle (board / disembark), by its model (vehicles.js VEHICLE_TYPES).
export { SEATS }; // vehicles.js (a fleet's seats on the road use them too)
// Ramming (driveTo): the vehicle drives through people (any side, RAMMING.HIT damage, the dead ZOMBIE_HIT) and light
// obstacles (WEAR: what each costs the vehicle's condition, settled when the battle ends: settleVehicle). Walls, trees,
// other cars, water, railings and trenches stop it.
export const RAMMING = {
  HIT: [14, 28], ZOMBIE_HIT: [20, 40], SHOVE: 3,
  WEAR: { unit: 1, zombie: 2, cart: 3, tanktrap: 12, fence: 2, wire: 1, sandbag: 4, crate: 2, hay: 1, barrel: 3, barricade: 8, rock: 6, pump: 10, well: 10, spikes: 6, beartrap: 2 },
  LEFT: { tanktrap: "rubble", pump: "rubble", well: "rubble" }, // what a rammed obstacle becomes (else open ground)
};
const rammable = (c) => RAMMING.WEAR[c.k] != null;
const vehicleCells = (v) => { const out = []; for (let cy = v.y; cy < v.y + v.h; cy++) for (let cx = v.x; cx < v.x + v.w; cx++) out.push([cx, cy]); return out; };
const inVehicle = (v, x, y) => x >= v.x && y >= v.y && x < v.x + v.w && y < v.y + v.h;
// Whose vehicle a unit drives, rides or mans: the team's (b.vehicle), or for the attackers the Humvee a raid brought
// (b.raidHumvee: placeRaidHumvee; raidCarTurn drives it) while it is still on this map. Riding in one: aboard, on its side.
export const carOf = (b, u) => { const v = u && u.side === "enemy" ? b.raidHumvee : b.vehicle; return v && !v.gone && !v.parked ? v : null; };
const ridesIn = (b, o, v) => !!v && !!o.aboard && !o.dead && (o.side === "enemy") === (v === b.raidHumvee);
const GUNNER_ACTS = new Set(["shoot", "cab", "turret", "reload", "unjam", "overwatch", "gunner", "drive", "turn", "disembark", "extract"]);
export const aboardCount = (b) => b.units.filter((u) => ridesIn(b, u, b.vehicle)).length;
// Board from next to it (1 action): the unit rides, off the map (not a target, not drawn), until it gets out.
export function boardVehicle(b, u) {
  const v = carOf(b, u); // yours, or for one of them their own (fleeToCar)
  if (!v) return "There is no vehicle here.";
  if (!(v === b.vehicle ? atVehicle(b, u) : nearRect(v, u.x, u.y))) return "Stand next to the vehicle to get in.";
  const n = () => b.units.filter((o) => ridesIn(b, o, v)).length;
  if (n() >= (v.seats || 4)) return `The ${v.kind} is full (${v.seats || 4} seats).`;
  u.aboard = true; u.off = true; u.ow = u.hunker = false; u.ap = Math.max(0, u.ap - 1);
  u.x = v.x; u.y = v.y;
  say(b, `${u.name} gets into the ${v.kind} (${n()} of ${v.seats || 4} seats).`, u.side === "enemy" ? "danger" : "info");
  bump(b);
  return "";
}
// Out, onto a free cell round it (1 action; force: at the end of a battle, anywhere near).
export function disembark(b, u, force = false) {
  bindDims(b);
  const v = carOf(b, u);
  if (!v || !u.aboard) return "Not in the vehicle.";
  if (u.gunner) leaveTurret(b, u, true); // off the turret on the way out
  const ring = [];
  const scan = (r) => {
    for (let cy = v.y - r; cy <= v.y + v.h + r - 1; cy++) for (let cx = v.x - r; cx <= v.x + v.w + r - 1; cx++) {
      if (!inside(cx, cy) || inVehicle(v, cx, cy)) continue;
      const c = b.cells[idx(cx, cy)];
      if (CELL[c.k].walk && c.k !== "vehicle" && !unitAt(b, cx, cy)) ring.push([cx, cy]);
    }
  };
  scan(1);
  if (!ring.length && force) for (let r = 2; r <= 6 && !ring.length; r++) scan(r);
  if (!ring.length) return "No room to get out here.";
  if (v === b.raidHumvee) { const mine = b.units.filter((o) => o.side === "player" && onMap(o)); const near = (c) => Math.min(99, ...mine.map((o) => dist(c[0], c[1], o.x, o.y))); ring.sort((p, q) => near(q) - near(p)); } // theirs get out on the far side of it, away from your people
  u.aboard = false; u.off = false;
  u.x = ring[0][0]; u.y = ring[0][1];
  if (!force) { u.ap = Math.max(0, u.ap - 1); say(b, `${u.name} gets out of the ${v.kind}.`, "info"); detect(b, u); }
  bump(b);
  return "";
}
export function landAll(b) { if (b.vehicle) for (const u of b.units) if (ridesIn(b, u, b.vehicle)) disembark(b, u, true); }
// Being in the vehicle counts as getting out: everyone aboard drives off with it (left, exitVehicle; a raid keeps the
// vehicle). Returns how many.
export function leaveAboard(b) {
  const riders = b.units.filter((u) => ridesIn(b, u, b.vehicle));
  if (!riders.length) return 0;
  for (const u of riders) if (u.gunner) leaveTurret(b, u, true);
  for (const u of riders) { u.aboard = false; u.off = false; u.left = true; u.exitVehicle = true; u.exitZone = b.raid ? b.raid.vehicleZone : undefined; u.ap = 0; u.ow = u.hunker = false; if (b.vehicle) { u.x = b.vehicle.x; u.y = b.vehicle.y; } }
  say(b, `${riders.map((u) => u.name).join(", ")} ${riders.length === 1 ? "drives" : "drive"} off in the ${b.vehicle ? b.vehicle.kind : "vehicle"}.`, "good");
  return riders.length;
}
// Turn the vehicle a quarter (1 action, from inside or next to it): its rect swaps sides at the same corner; the cells
// it turns onto must be open with nobody on them.
export function turnVehicle(b, u) {
  bindDims(b);
  const v = b.vehicle;
  if (!v) return "There is no vehicle here.";
  const nw = v.h, nh = v.w;
  const tx = Math.min(v.x, W - nw), ty = Math.min(v.y, H - nh);
  if (tx < 0 || ty < 0) return "No room to turn here.";
  for (let cy = ty; cy < ty + nh; cy++) for (let cx = tx; cx < tx + nw; cx++) {
    const c = b.cells[idx(cx, cy)];
    const o = unitAt(b, cx, cy); // the turret's gunner up on the roof turns with it (aboard: it refused every turn while manned)
    if (!(c.k === "open" || (c.k === "vehicle" && inVehicle(v, cx, cy))) || (o && !o.aboard)) return "No room to turn here: open ground with nobody on it on all its cells.";
  }
  const car = b.cells[idx(v.x, v.y)].car;
  for (const [cx, cy] of vehicleCells(v)) { const c = b.cells[idx(cx, cy)]; c.k = "open"; delete c.car; }
  v.x = tx; v.y = ty; v.w = nw; v.h = nh; v.ax = v.ax === "x" ? "y" : "x";
  for (const [cx, cy] of vehicleCells(v)) { const c = b.cells[idx(cx, cy)]; c.k = "vehicle"; c.car = { ...car, ax: v.ax, i: v.ax === "x" ? cx - v.x : cy - v.y, j: v.ax === "x" ? cy - v.y : cx - v.x }; }
  for (const o of b.units) if (ridesIn(b, o, v)) { o.x = v.x; o.y = v.y; }
  syncGunner(b); // the gunner stays up on the roof
  u.ap = Math.max(0, u.ap - 1);
  v.movedK = u.droveK = strikeMark(b); // moved this turn: shots from it (rideAim)
  b.losCache.fill(0);
  const at = u.aboard ? (v.x > 0 ? [v.x - 1, v.y] : [v.x + v.w, v.y]) : [u.x, u.y];
  b.reach = flood(b.cells, at[0], at[1]);
  syncFloor(b);
  if (b.raid) syncVehicleZone(b);
  say(b, `${u.name} turns the ${v.kind} ${v.ax === "x" ? "along" : "across"}.`, "info");
  bump(b);
  return "";
}
// Where a vehicle can get to this turn: every position of its rect (top-left x, y) within DRIVE.RANGE 4-way steps over
// open ground, through people and light obstacles when it can ram (RAMMING; not a bike, not noRam: the attackers' Humvee
// keeps to open ground, carTurn; a Set: only those obstacles). Returns { seen: Map(key → steps), parent: Map(key → key), key }.
export function carSteps(b, v, u, noRam = false) {
  bindDims(b);
  const canRam = v.kind !== "bike" && !noRam; // a bike rides round people and obstacles, it does not run them down
  const only = noRam instanceof Set ? noRam : null; // noRam a Set: only these obstacles (a breach, BREACH_THROUGH), never people
  const own = v.cell || "vehicle"; // the cells it stands on: "vehicle" (yours) or "truck" (their Humvee)
  const passable = (px, py) => {
    if (px < 0 || py < 0 || px + v.w > W || py + v.h > H) return false;
    for (let cy = py; cy < py + v.h; cy++) for (let cx = px; cx < px + v.w; cx++) {
      const c = b.cells[idx(cx, cy)];
      if (!(c.k === "open" || (c.k === own && inVehicle(v, cx, cy)) || ((canRam || (only && only.has(c.k))) && rammable(c)))) return false;
      if (!canRam && b.units.some((o) => o !== u && !o.aboard && onMap(o) && o.x === cx && o.y === cy)) return false;
    }
    return true;
  };
  const key = (px, py) => py * W + px;
  const seen = new Map([[key(v.x, v.y), 0]]), parent = new Map();
  const q = [[v.x, v.y]];
  while (q.length) {
    const [px, py] = q.shift();
    const d = seen.get(key(px, py));
    if (d >= DRIVE.RANGE) continue;
    for (const [dx, dy] of DIRS4) {
      const nx = px + dx, ny = py + dy;
      if (seen.has(key(nx, ny)) || !passable(nx, ny)) continue;
      seen.set(key(nx, ny), d + 1); parent.set(key(nx, ny), key(px, py));
      q.push([nx, ny]);
    }
  }
  return { seen, parent, key };
}
// Drive: the vehicle's rect to the position whose middle is nearest (x, y), by 4-way steps over open ground, through
// people and light obstacles (ramming: RAMMING); the driver rides along (aboard, or steps off next to it). The same for
// the attackers' Humvee (carOf; raidCarTurn, opts.noRam: open ground only). Returns an error, or "" when it drove.
export function driveTo(b, u, x, y, opts = {}) {
  bindDims(b);
  const v = carOf(b, u);
  if (!v) return "You came on foot: there is no vehicle here.";
  const tx = Math.max(0, Math.min(W - v.w, x - Math.floor((v.w - 1) / 2))), ty = Math.max(0, Math.min(H - v.h, y - Math.floor((v.h - 1) / 2)));
  if (tx === v.x && ty === v.y) return "It is already there.";
  if ((v.wear || 0) >= RAID_CAR.STALL_WEAR) return `The engine is dead: the ${v.name || v.kind} took too much in this fight (−${v.wear}). It still gives cover, and its gun still fires.`; // either side (carTurn: theirs stalls)
  const { seen, parent, key } = carSteps(b, v, u, opts.noRam || false);
  if (u.aboard) v.driver = u.id; // at the wheel: the one a shot through the windscreen hits (cabSeat)
  if (!seen.has(key(tx, ty))) return `The vehicle cannot get there: open ground, people and light obstacles only, within ${DRIVE.RANGE} cells.`;
  // The way: every position from the first step to the last; the cells swept are rammed.
  const way = [];
  for (let k = key(tx, ty); k !== key(v.x, v.y); k = parent.get(k)) way.unshift([k % W, Math.floor(k / W)]);
  const swept = new Set();
  for (const [px, py] of way) for (let cy = py; cy < py + v.h; cy++) for (let cx = px; cx < px + v.w; cx++) swept.add(idx(cx, cy));
  // Where the driver steps off (not aboard): the same side of it as now, else the nearest free cell round it.
  const ox = u.x - v.x, oy = u.y - v.y;
  const ringOf = (not) => {
    const ring = [];
    for (let cy = ty - 1; cy <= ty + v.h; cy++) for (let cx = tx - 1; cx <= tx + v.w; cx++) {
      if (!inside(cx, cy) || (cx >= tx && cy >= ty && cx < tx + v.w && cy < ty + v.h)) continue;
      const c = b.cells[idx(cx, cy)];
      const o = unitAt(b, cx, cy);
      if (!CELL[c.k].walk || c.k === "vehicle" || rammable(c) || (o && o !== not)) continue;
      ring.push([cx, cy, Math.abs(cx - (tx + ox)) + Math.abs(cy - (ty + oy))]);
    }
    return ring.sort((a, c) => a[2] - c[2]);
  };
  if (!u.aboard && !ringOf(u).length) return "There is nowhere to step off there.";
  // Ram: obstacles swept are broken (the vehicle wears), people swept are hit and shoved aside.
  const rng = b.rng;
  let wear = 0;
  const hits = [];
  for (const i of swept) {
    const c = b.cells[i];
    if (c.k === "cart") { wear += RAMMING.WEAR.cart; cartKnocked(b, i % W, (i / W) | 0, "ram"); continue; } // carts.js: driven through, wrecked; it and its load stay there
    if (rammable(c)) { wear += RAMMING.WEAR[c.k]; c.k = RAMMING.LEFT[c.k] || "open"; c.hp = 0; }
  }
  for (const o of b.units) {
    if (!onMap(o) || o === u || o.aboard || !swept.has(idx(o.x, o.y))) continue;
    const z = o.kind === "zombie";
    const eff = Math.round(damage(b, o, rng.int(...(z ? RAMMING.ZOMBIE_HIT : RAMMING.HIT)), u));
    wear += z ? RAMMING.WEAR.zombie * (v.up && v.up.mesh ? UPGRADE_FX.meshRam : 1) : RAMMING.WEAR.unit; // mesh grilles on the front (vehicles.js)
    hits.push(`${o.name} (${eff})`);
    fx(b, { type: "melee", from: [o.x, o.y], to: [o.x, o.y], hit: true, crit: false, dmg: eff, side: u.side, text: "RAMMED" });
    if (o.dead) continue;
    let best = null;
    for (let r = 1; r <= RAMMING.SHOVE && !best; r++) for (let cy = o.y - r; cy <= o.y + r && !best; cy++) for (let cx = o.x - r; cx <= o.x + r && !best; cx++) {
      if (!inside(cx, cy) || (cx >= tx && cy >= ty && cx < tx + v.w && cy < ty + v.h)) continue;
      const c = b.cells[idx(cx, cy)];
      if (CELL[c.k].walk && c.k !== "vehicle" && !unitAt(b, cx, cy)) best = [cx, cy];
    }
    if (best) { o.x = best[0]; o.y = best[1]; o.hunker = false; o.ow = false; }
    else { const e2 = Math.round(damage(b, o, rng.int(...RAMMING.HIT), u)); hits.push(`${o.name} again (${e2}, crushed)`); }
  }
  wear = Math.round(wear * mapWearMult(v) * 10) / 10; // armour plate: ×0.6 a level (vehicles.js wearMult)
  v.wear = Math.round(((v.wear || 0) + wear) * 10) / 10;
  const car = b.cells[idx(v.x, v.y)].car;
  const left = vehicleCells(v).map(([cx, cy]) => idx(cx, cy));
  for (const [cx, cy] of vehicleCells(v)) { const c = b.cells[idx(cx, cy)]; c.k = "open"; delete c.car; }
  const from = [u.x, u.y], steps = seen.get(key(tx, ty));
  v.x = tx; v.y = ty;
  for (const [cx, cy] of vehicleCells(v)) { const c = b.cells[idx(cx, cy)]; c.k = v.cell || "vehicle"; c.car = { ...car, i: v.ax === "x" ? cx - v.x : cy - v.y, j: v.ax === "x" ? cy - v.y : cx - v.x }; }
  for (const o of b.units) if (ridesIn(b, o, v)) { o.x = v.x; o.y = v.y; }
  syncGunner(b, v); // the gunner stays up on the roof
  if (!u.aboard) {
    const ring = ringOf(u);
    u.x = ring[0][0]; u.y = ring[0][1];
    fx(b, { type: "move", unit: u.id, from, path: [[u.x, u.y]] });
  }
  u.ap = Math.max(0, u.ap - DRIVE.AP); u.hunker = false; u.ow = false;
  v.movedK = u.droveK = strikeMark(b); // moved this turn: shots from it (rideAim)
  b.losCache.fill(0);
  const yours = v === b.vehicle;
  if (yours) {
    const at = u.aboard ? (ringOf(null)[0] || [v.x, v.y]) : [u.x, u.y];
    b.reach = flood(b.cells, at[0], at[1]);
  } else if (b.reach) for (const i of left) { const x0 = i % W, y0 = (i / W) | 0; if (b.cells[i].k === "open" && DIRS4.some(([dx, dy]) => inside(x0 + dx, y0 + dy) && b.reach[idx(x0 + dx, y0 + dy)])) b.reach[i] = 1; } // theirs: the ground it left is open again (your reach is not flooded from their side)
  syncFloor(b);
  const loud = v.mil ? DRIVE.MIL : 1; // an Army truck (miltrucks.js): a big diesel, heard further
  const heat = Math.round(DRIVE.HEAT * loud);
  const heated = !!b.raid && yours;
  if (heated) { b.raid.heat = Math.min(100, b.raid.heat + heat); syncVehicleZone(b); }
  b.noise = (b.noise || 0) + 2 * loud;
  say(b, `${u.name} drives the ${v.name || (v.mil ? "Army truck" : v.kind === "truck" ? "truck" : "car")} ${steps} cell${steps === 1 ? "" : "s"}${heated ? ` (Heat +${heat})` : ""}${hits.length ? `, running down ${hits.join(", ")}` : ""}${wear ? ` (the ${v.kind} takes a beating: condition −${wear})` : ""}.`, hits.length ? "danger" : "info");
  alertNear(b, tx + Math.floor(v.w / 2), ty + Math.floor(v.h / 2), Math.round(DRIVE.RADIUS * loud), "The engine carries: the unaware nearby turn toward it.");
  if (!u.aboard) detect(b, u);
  bump(b);
  return "";
}
// When a battle ends: everyone aboard back on the ground, and what ramming cost the party's vehicle (vehicles.js condition).
export function settleVehicle(state, b, outcome = null) {
  if (outcome === "victory") landAll(b); else leaveAboard(b); // won: they get out on the field; else the vehicle is their way out
  const v = b.vehicle;
  const party = b.setup && b.setup.partyId != null ? state.parties.find((x) => x.id === b.setup.partyId) : null;
  settleConvoy(state, b, party);
  if (!v || !v.wear) return;
  const pv = party ? partyVehicle(state, party) : null;
  if (!pv) return;
  pv.condition = Math.max(1, Math.round((pv.condition - v.wear) * 10) / 10);
  if (v.blownUp) { pv.condition = 0; pv.destroyed = true; } // launchers.js: a wreck for good (nothing repairs it; strip it for parts)
  log(state, v.blownUp ? `The ${pv.name} was blown up at ${b.place}: a burnt-out wreck now, past repair.` : `The ${pv.name} took a beating at ${b.place}: condition ${Math.round(pv.condition)}%.`, "danger");
  const blown = blownUpCargo(state, b, party); // launchers.js (section 24): blown up, its cargo went with it; shaken, worn
  if (blown) log(state, blown, "danger");
  if (v.blownUp && party.vehicleId === pv.id) leaveVehicle(state, party, b.tileId ?? partyTile(party), "blown up", pv); // the team goes on on foot; what it cannot carry stays in the wreck
  v.wear = 0;
}
// The team's other vehicles after the fight (b.convoy): what blasts cost them; one blown up is a wreck, left where it
// burns (the team goes on in the others: parties.js leaveVehicle with that one).
function settleConvoy(state, b, party) {
  for (const c of b.convoy || []) {
    if (!c.wear) continue;
    const x = state.vehicles.find((y) => y.id === c.vid);
    if (!x) continue;
    x.condition = Math.max(1, Math.round((x.condition - c.wear) * 10) / 10);
    if (c.blownUp) { x.condition = 0; x.destroyed = true; }
    log(state, c.blownUp ? `The ${x.name} was blown up at ${b.place}: a burnt-out wreck now, past repair.` : `The ${x.name} took a beating at ${b.place}: condition ${Math.round(x.condition)}%.`, "danger");
    if (c.blownUp && party && partyVehicles(state, party).includes(x)) leaveVehicle(state, party, b.tileId ?? partyTile(party), "blown up", x);
    c.wear = 0;
  }
}
// ---------- the team's vehicle's upgrades on the map (vehicles.js: glass, mesh grilles, plating, a turret) ----------
// b.vehicle.up: its upgrades; its cells' c.car.up { p: plating, s: scrap plating, g: glass, m: mesh, t: turret gun } for
// the views and for cover (sideCover: a plated vehicle is full cover; platedCell: what stops a round through light cover).
const carUpTag = (u) => (u.plating || u.scrapPlate || u.glass || u.mesh || u.turret ? { p: u.plating || 0, s: u.scrapPlate || 0, g: u.glass || 0, m: u.mesh || 0, t: u.turret ? u.turret.gun : null } : null);
export function fitMapVehicle(b, pv) {
  const v = b.vehicle;
  if (v && pv && Number.isFinite(pv.condition)) v.cond0 = pv.condition; // the condition it came in with: blasts that wear it past this blow it up (vehicleBlast)
  if (!v || !pv || isBike(pv)) return;
  const u = upgradesOf(pv);
  v.up = { glass: u.glass, mesh: u.mesh, plating: u.plating, scrapPlate: u.scrapPlate, turret: u.turret ? { gun: u.turret.gun } : null };
  const tag = carUpTag(u);
  if (!tag) return;
  for (let cy = v.y; cy < v.y + v.h; cy++) for (let cx = v.x; cx < v.x + v.w; cx++) { const c = b.cells[cy * b.w + cx]; if (c && c.car) c.car.up = tag; }
}
const mapWearMult = (v) => UPGRADE_FX.wear ** armourOf({ upgrades: v.up });
// The real armour plate on a cell (0: none): a plated vehicle stops what goes through light cover (over-penetration).
export const platedCell = (b, x, y) => { const c = b.cells[y * b.w + x]; return c && c.car && c.car.up ? c.car.up.p || 0 : 0; };
// × the damage a rider in the team's vehicle takes from a hit (bulletproof glass): hit { pen } or { cal, ammo } (typed
// rounds) or { weapon } (its calibre's FMJ), else RIDER_PEN; hit.how "blast" for fragments.
export const RIDER_PEN = 25;
export function riderHitMult(b, hit = {}, v = b && b.vehicle) {
  if (!v || !v.up) return 1;
  const W = hit.weapon ? WEAPONS[hit.weapon] : null;
  const pen = hit.pen != null ? hit.pen : hit.cal ? ammoPen(hit.cal, hit.ammo) : W && W.cal ? ammoPen(W.cal) : hit.how === "blast" ? UPGRADE_FX.blastPen : RIDER_PEN;
  return riderMult({ upgrades: v.up }, pen, hit.how || "shot");
}
// A blast next to the team's vehicle (throwables.js landEffect): it wears the vehicle (BLAST_WEAR × 0.6 a plating level)
// and its fragments come in at the windows: the riders aboard take UPGRADE_FX.riderBlast of it (× the glass or the
// grilles: riderHitMult), never more than leaves them on their feet (they get down below the doors). The same for the
// attackers' Humvee and its riders (raidCarTurn: worn enough, it pulls back or stalls). Returns log text.
// gl: a 40 mm HE grenade, rocket: a rocket (launchers.js GL_HE / ROCKET: section 13's +70). A vehicle whose blast wear
// this fight reaches the condition it came in with (v.cond0) is blown up: its riders take the blast in full and after
// the fight its cargo is mostly gone (launchers.js blownUpCargo, settleVehicle).
export const BLAST_WEAR = { frag: 4, blast: 8, gl: 6, rocket: 70 };
export function vehicleBlast(b, x, y, r, dmg, kind = "blast") {
  const theirs = carOf(b, { side: "enemy" });
  return [b.vehicle, theirs && theirs.up ? theirs : null].map((v) => carBlast(b, v, x, y, r, dmg, kind)).join("") + convoyBlast(b, x, y, r, kind);
}
// The team's other vehicles (b.convoy, vehicles.js fleets): parked, nobody aboard; worn and blown up the same way.
function convoyBlast(b, x, y, r, kind) {
  let out = "";
  for (const v of b.convoy || []) {
    if (v.kind === "bike" || v.blownUp) continue;
    let near = false;
    for (let cy = v.y; cy < v.y + v.h && !near; cy++) for (let cx = v.x; cx < v.x + v.w && !near; cx++) if (Math.hypot(cx - x, cy - y) <= r + 0.5 + 1e-6) near = true;
    if (!near) continue;
    const wear = Math.round((BLAST_WEAR[kind] || BLAST_WEAR.blast) * mapWearMult(v) * 10) / 10;
    v.wear = Math.round(((v.wear || 0) + wear) * 10) / 10;
    v.blastWear = Math.round(((v.blastWear || 0) + wear) * 10) / 10;
    if (v.cond0 != null && v.blastWear >= v.cond0) {
      v.blownUp = true;
      for (const [cx, cy] of vehicleCells(v)) { const c = b.cells[cy * b.w + cx]; if (c && c.car) c.car = { ...c.car, wrecked: true }; }
      out += ` The ${v.name || v.kind} is blown up.`;
    } else out += ` The ${v.name || v.kind} takes the blast (condition −${wear}).`;
  }
  return out;
}
function carBlast(b, v, x, y, r, [lo, hi], kind) {
  if (!v || v.kind === "bike") return "";
  let near = false;
  for (let cy = v.y; cy < v.y + v.h && !near; cy++) for (let cx = v.x; cx < v.x + v.w && !near; cx++) if (Math.hypot(cx - x, cy - y) <= r + 0.5 + 1e-6) near = true;
  if (!near) return "";
  const wear = Math.round((BLAST_WEAR[kind] || BLAST_WEAR.blast) * mapWearMult(v) * 10) / 10;
  v.wear = Math.round(((v.wear || 0) + wear) * 10) / 10;
  v.blastWear = Math.round(((v.blastWear || 0) + wear) * 10) / 10;
  const blown = !v.blownUp && v.cond0 != null && v.blastWear >= v.cond0;
  if (blown) v.blownUp = true;
  const m = UPGRADE_FX.riderBlast * riderHitMult(b, { how: "blast" }, v);
  const hurt = [];
  for (const u of b.units) {
    if (!ridesIn(b, u, v) || u.gunner) continue; // the gunner is out in the open (caught by the blast itself)
    // The glass (or grilles) first, then what the rider wears (hitMult: a blast is not a located hit, armour.js: the flat multiplier).
    // Blown up: the blast in full, through everything (and it can bring them down).
    if (blown) { const eff = Math.round(damage(b, u, b.rng.int(lo, hi), null, false, { how: "blast" })); blastHit(b, u, eff); hurt.push(`${u.name} ${eff}${u.dead ? " (dead)" : u.down ? " (down)" : ""}`); if (!u.dead) disembark(b, u, true); continue; } // thrown clear of the wreck
    const eff = Math.max(0, Math.min(u.hp - 1, Math.round(b.rng.int(lo, hi) * m * hitMult(u, null, { how: "blast" }))));
    if (eff > 0) { u.hp -= eff; hurt.push(`${u.name} ${eff}`); }
  }
  if (blown) for (const [cx, cy] of vehicleCells(v)) { const c = b.cells[cy * b.w + cx]; if (c && c.car) c.car = { ...c.car, wrecked: true }; } // drawn burnt out
  if (blown) return ` The ${v.mil ? "Army truck" : v.kind} is blown up (condition −${wear})${hurt.length ? `: the blast tears through ${hurt.join(", ")}` : ""}. Its cargo goes up with it.`;
  return ` The ${v.mil ? "Army truck" : v.kind} takes the blast (condition −${wear}${v.up && (v.up.plating || v.up.scrapPlate) ? ", the plating took most of it" : ""})${hurt.length ? `; fragments through the windows catch ${hurt.join(", ")}${v.up && v.up.glass ? " (the bulletproof glass stopped most)" : ""}` : ""}.`;
}


// The Humvee a raid on your base brought (vehicles.js raidHumvee; conflicts.js defendInPerson sets setup.enemy.turret):
// parked behind the attackers on the defence map, olive with the gun on its roof, full cover (plated), theirs until the
// fight is won (foundcars.js: no claiming it now; beaten off, it is left at the base: vehicles.js loseRaidHumvee).
// No dice: the nearest open spot behind them. Returns the rect or null.
export function placeRaidHumvee(b, gun = "m2hb") {
  bindDims(b);
  const foes = b.units.filter((u) => u.side === "enemy" && !u.dead);
  if (!foes.length) return null;
  // Behind the attacker nearest your people (the front of their attack), a little back from it.
  const mine = b.units.filter((u) => u.side === "player" && !u.dead);
  const px = mine.length ? mine.reduce((a, u) => a + u.x, 0) / mine.length : W / 2, py = mine.length ? mine.reduce((a, u) => a + u.y, 0) / mine.length : H / 2;
  const lead = foes.slice().sort((p, q) => Math.hypot(p.x - px, p.y - py) - Math.hypot(q.x - px, q.y - py) || p.id - q.id)[0];
  const cx = lead.x, cy = lead.y, back = Math.hypot(cx - px, cy - py) + 2;
  const spots = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) spots.push([x, y, Math.hypot(x - cx, y - cy) + 2 * Math.max(0, back - Math.hypot(x - px, y - py))]); // not nearer your people than the front
  spots.sort((a, c) => a[2] - c[2] || a[1] - c[1] || a[0] - c[0]);
  for (const [x, y] of spots.slice(0, 400)) for (const ax of ["x", "y"]) {
    const r = placeCar(b.cells, W, H, x, y, ax, TRUCK_KINDS.humvee.L, "truck", (xx, yy) => inside(xx, yy) && b.cells[idx(xx, yy)].k === "open" && !unitAt(b, xx, yy), 0, { body: TRUCK_KINDS.humvee.body });
    if (!r) continue;
    for (let yy = r.y0; yy < r.y0 + r.h; yy++) for (let xx = r.x0; xx < r.x0 + r.w; xx++) {
      const c = b.cells[idx(xx, yy)];
      c.car.mil = { kind: "humvee", cond: "intact", enemy: true };
      c.car.up = { p: 1, s: 0, g: 1, m: 0, t: gun };
    }
    if (b.losCache) b.losCache.fill(0);
    // A vehicle like yours on the map (b.vehicle's shape: carOf, driveTo, vehicleBlast): its cells are "truck" cells,
    // plated and glassed (vehicles.js fitMilitary), wear on the condition scale; ai: raidCarTurn's state.
    b.raidHumvee = { x: r.x0, y: r.y0, w: r.w, h: r.h, ax: r.ax, kind: "Humvee", name: "Humvee", cell: "truck", seats: RAID_CAR.SEATS, up: { plating: 1, scrapPlate: 0, glass: 1, mesh: 0, turret: { gun } }, wear: 0, ai: "advance", driver: null };
    say(b, `They brought their Humvee, a heavy machine gun on its roof: it stands behind them. Beat them off and it is yours.`, "danger");
    return r;
  }
  return null;
}


// ---------- the mounted machine gun (plan section 11: the turret; vehicles.js upgrades.turret) ----------
// A rider in the team's vehicle mans its turret (act "gunner", 1 action; act again or get out to leave it): they become
// the gunner (u.gunner), the only rider on the map (off: false): seen and shot at on the vehicle's middle cell, a level up
// (c.h 1: they see over the cab, +2 sight, +5 aim downhill), at half cover (full with plate x2: gunnerCover), the one the
// enemy aims at. They fire the mounted gun (TURRET_WEAPONS: turret_m2 / turret_lmg; act "turret", or Shoot) from its own
// belt (b.vehicle.belt, shown as u.turretMag; a reload is both actions), 3 rounds a burst from the team's rounds of its
// calibre (turretRounds; ammo.js: the M2 .50 BMG ball, the LMG 5.56 FMJ, the gunner's u.load while on it). It is very loud (the
// noise 6 wakes the whole map; Heat +TURRET.HEAT a burst on a raid) and pins: everyone within TURRET.PIN_R of where a
// burst lands shoots at -TURRET.PIN their next turn. Overwatch from the turret works as anyone's. Downed, the gunner drops
// back inside; their own gun is back in their hands when they leave the turret (u.gunSave).
// The enemy's turret: the Humvee a raid brings to your base (placeRaidHumvee) is manned by one of them (gunnerAI: the
// M2 at the best target, the ones in the open first; a reload when the belt is out). The gunner rides it (aboard) and
// goes where its driver takes it (raidCarTurn); downed, they drop back inside and a rider takes the gun over.
// The LMG turret fires the roster's hand-held LMG (the very item: vehicles.js TURRET_FIT) with the mount's +MOUNT_AIM and
// a 200-round belt; the M2's numbers are its own (data-guns.js m2hb: bolted to a military vehicle, never an item).
export const MOUNT_AIM = 6;
const mountedOf = (k, extra) => { const w = WEAPONS[k]; return { dmg: w.dmg.slice(), opt: w.opt, fall: w.fall, aim: (w.aim || 0) + MOUNT_AIM, noise: w.noise, cal: w.cal, ...extra, mounted: true }; };
export const TURRET_WEAPONS = {
  turret_m2:  { name: "M2 turret", ...mountedOf("m2hb", { aim: 6, ammo: 3, cap: 100, pierce: 1, rel: 0.1 }) },
  turret_lmg: { name: "LMG turret", ...mountedOf("lmg", { ammo: 3, cap: 200, rel: 0.4 }) },
};
Object.assign(WEAPONS, TURRET_WEAPONS);
export const TURRET_WEAPON = { m2hb: "turret_m2", lmg: "turret_lmg" };
export const TURRET = { PIN: 10, PIN_R: 1, RELOAD_AP: 2, HEAT: 4 };
// The rounds the turret can draw on (your side): the team's rounds of its calibre and common type (ammo.js roundsOf:
// a_50bmg_ball for the M2, a_556_fmj for the LMG; the gunner's own load while on it). Fired through spendShot.
export function turretRounds(b) {
  const k = TURRET_WEAPON[vehicleTurret(b)];
  if (!k) return 0;
  const g = gunnerOf(b);
  return roundsOf(b, g && g.weapon === k ? g : { side: "player", weapon: k, load: null });
}
export const vehicleTurret = (b) => (b && b.vehicle && b.vehicle.up && b.vehicle.up.turret ? b.vehicle.up.turret.gun : null);
export const gunnerOf = (b, side = "player") => b.units.find((u) => u.gunner && u.side === side && !u.dead && !u.down) || null;
// Where the gunner stands: the middle of the vehicle (its roof).
const roofCell = (r) => [r.x + Math.floor((r.w - 1) / 2), r.y + Math.floor((r.h - 1) / 2)];
// The gunner's cover: half, full behind plate x2 (an enemy Humvee: its own plate).
export function gunnerCover(b, u) {
  const plate = u.side === "player" ? (b.vehicle && b.vehicle.up ? b.vehicle.up.plating || 0 : 0) : 1;
  return { level: plate >= 2 ? 2 : 1, any: true, flanked: false };
}
// The gunner's cell a level up, the vehicle's cells drawn manned; after manning, leaving, driving or turning (v: the
// team's vehicle, or the attackers' Humvee: its gunner is theirs).
export function syncGunner(b, v = b.vehicle) {
  bindDims(b);
  if (!v) return;
  if (v.gunAt != null && b.cells[v.gunAt]) delete b.cells[v.gunAt].h;
  v.gunAt = null;
  const g = gunnerOf(b, v === b.raidHumvee ? "enemy" : "player");
  if (g) {
    const [x, y] = roofCell(v);
    g.x = x; g.y = y;
    v.gunAt = idx(x, y);
    b.cells[v.gunAt].h = 1;
  }
  for (const [cx, cy] of vehicleCells(v)) { const c = b.cells[idx(cx, cy)]; if (c.car && c.car.up) c.car.up = { ...c.car.up, manned: !!g }; }
  if (b.losCache) b.losCache.fill(0);
}
function takeGun(u, key, belt) {
  u.gunSave = { weapon: u.weapon, weaponName: u.weaponName ?? null, item: u.item ?? null, mag: u.mag ?? null, magW: u.magW ?? null, magMax: u.magMax ?? null, load: u.load ?? null };
  u.weapon = key; u.weaponName = WEAPONS[key].name; u.item = null;
  u.load = typeFor(WEAPONS[key].cal, null); // ammo.js: the belt's common round (.50 BMG ball, 5.56 FMJ)
  u.magW = key; u.magMax = WEAPONS[key].cap; u.mag = Math.max(0, Math.min(u.magMax, belt ?? u.magMax));
  u.turretMag = u.mag;
  u.gunner = true;
}
function giveGunBack(u) {
  const g = u.gunSave || {};
  u.weapon = g.weapon || "fists"; u.item = g.item ?? null;
  if (g.weaponName == null) delete u.weaponName; else u.weaponName = g.weaponName;
  for (const k of ["mag", "magW", "magMax", "load"]) { if (g[k] == null) delete u[k]; else u[k] = g[k]; }
  delete u.gunSave; delete u.turretMag;
  u.gunner = false;
}
// Man the turret (1 action); a gunner who does it again gets down. Returns an error or "".
export function manTurret(b, u) {
  const gun = vehicleTurret(b);
  if (!gun) return "This vehicle has no turret.";
  if (!u.aboard) return "Get in the vehicle first.";
  if (u.gunner) return leaveTurret(b, u);
  const was = gunnerOf(b);
  if (was) leaveTurret(b, was, true);
  const key = TURRET_WEAPON[gun] || "turret_m2";
  takeGun(u, key, b.vehicle.belt ?? WEAPONS[key].cap);
  u.off = false; u.ow = u.hunker = false;
  u.ap = Math.max(0, u.ap - 1);
  syncGunner(b);
  say(b, `${u.name} ${was ? `takes over the ${WEAPONS[key].name} from ${was.name}` : `stands up behind the ${WEAPONS[key].name}`} (belt ${Math.min(u.mag, turretRounds(b))}/${u.magMax}): exposed, the one they will shoot at.`, "info");
  bump(b);
  return "";
}
// Off the turret, back down inside (quiet: no line in the log, no action spent).
export function leaveTurret(b, u, quiet = false) {
  if (!u || !u.gunner) return "";
  const v = carOf(b, u);
  if (v) v.belt = magIn(u); // the belt stays in the gun for whoever takes it over
  giveGunBack(u);
  if (u.aboard) { u.off = true; u.ow = false; if (v) { u.x = v.x; u.y = v.y; } }
  if (v) syncGunner(b, v);
  if (!quiet) { u.ap = Math.max(0, u.ap - 1); say(b, `${u.name} gets down off the turret.`, "info"); bump(b); }
  return "";
}
// A burst from a turret: the belt synced, Heat, the pin round where it landed (fired: false when it jammed before a
// round left it, gunfire.js: the belt is synced, nothing else).
function afterTurretBurst(b, a, t, fired = true) {
  if (a.side === "player" && b.vehicle) b.vehicle.belt = magIn(a);
  a.turretMag = magIn(a);
  if (!fired) return;
  if (b.raid) b.raid.heat = Math.min(100, b.raid.heat + TURRET.HEAT);
  const when = a.side === "player" ? b.turn : b.turn + 1; // their next turn (the enemy phase is the rest of this one)
  for (const o of b.units) if (o.side === t.side && active(o) && Math.max(Math.abs(o.x - t.x), Math.abs(o.y - t.y)) <= TURRET.PIN_R) o.pinT = when;
}
function afterTurretReload(b, u) { if (u.side === "player" && b.vehicle) b.vehicle.belt = magIn(u); u.turretMag = magIn(u); }
// The enemy's gunner: one of the raiders up on the Humvee placeRaidHumvee put on the map.
export function manEnemyTurret(b, gun = "m2hb") {
  bindDims(b);
  const r = b.raidHumvee;
  if (!r) return null;
  const [x, y] = roofCell(r);
  const u = b.units.filter((o) => o.side === "enemy" && o.kind === "human" && active(o)).sort((p, q) => dist(p.x, p.y, x, y) - dist(q.x, q.y, x, y) || p.id - q.id)[0];
  if (!u) return null;
  takeGun(u, TURRET_WEAPON[gun] || "turret_m2", null);
  u.post = null; u.aboard = true; u.off = false;
  syncGunner(b, r); // up on the roof, a level up, the Humvee drawn manned
  say(b, `${u.name} climbs up behind the M2 on their ${r.name || "Humvee"}.`, "danger");
  crewRaidCar(b);
  return u;
}

// ---------- an armed vehicle drives itself in the fight (their Humvee or escort; yours when the battle AI plays) ----------
// The Humvee a raid brought (or the Humvee / MRAP escorting a caravan you attack) is driven like yours (carSteps /
// driveTo: DRIVE.RANGE cells a turn for both of the driver's actions, the same wear from blasts, ramming and heavy
// rounds: vehicleBlast, mapWearMult, hullWear), by one of them inside (v.driver, aboard, off the map like your riders)
// at the start of each enemy turn (endPlayerTurn → raidCarTurn → carTurn), before the rest act. Your own turreted
// vehicle the same when the battle AI plays your side (autoPlayerTurn → botCar: a crew walks over and gets in first):
//   - advance: toward the spot within reach where the gunner would see the most of the other side within the gun's
//     range (WEAPONS opt: the M2 14 cells), the nearest of them as a tiebreak, over open ground and roads only (it does
//     not ram walls, gates, barricades or people: noRam), never nearer the other side's nearest person than
//     RAID_CAR.NEAR (grenade reach) and never more than RAID_CAR.LEAD cells ahead of its own side's front on foot;
//   - breach (theirs, plated, no ram with them: BREACH): nowhere to shoot from, it rams a weak barred gate (BREACH.WEAK
//     hp or less: BREACH.DMG a blow, BREACH.WEAR to it × the plate) or drives through a barricade (RAMMING), never
//     walls or people;
//   - hold: it stops where the gunner already has someone in range and in sight;
//   - its riders (RAID_CAR.RIDERS, only while RAID_CAR.FOOT or more of them come on foot) get out on the far side of it
//     once it holds or stands within RAID_CAR.DROP of the other side, and fight on foot (the getting out costs an action);
//   - a gunner down: a rider still inside climbs up to the gun; nobody to take it, theirs pulls back;
//   - back: badly worn (RAID_CAR.BACK_WEAR), its gun unmanned, or the raid running (shouldFlee): toward the edge they
//     came from, the gunner still firing, waiting up to RAID_CAR.WAIT turns for their people running within
//     RAID_CAR.PICKUP (flee: they climb in); at the edge (within RAID_CAR.OUT), or when it could get no nearer
//     RAID_CAR.STUCK turns running (round the back), it drives off the map with everyone inside, the downed too (they
//     got away; the group keeps it: result.humveeOut). Yours only backs off, badly worn, toward your edge: it never
//     leaves the map on its own;
//   - stalled: worn to RAID_CAR.STALL_WEAR the engine dies: it stands where it is, the gunner stays on the gun, the
//     others bail out;
//   - nobody at the wheel (the driver down or dead: a shot through the windscreen, fireCab): it stays where it stands.
// While theirs can still drive off, the field is not yet yours (checkEnd: carHolds).
export const RAID_CAR = { MRAP_SEATS: 6, SEATS: 4, RIDERS: 2, FOOT: 3, NEAR: 6, LEAD: 2, DROP: 10, BACK_WEAR: 10, STALL_WEAR: 20, OUT: 1, STUCK: 2, ROAD: 0.25, PICKUP: 8, WAIT: 2 };
// A plated vehicle of theirs with no ram in the raid breaks in itself: a barred gate at WEAK hp or less takes DMG a
// blow (a crew's ram does 16–24 a swing a man: siege.js RAM) and the vehicle WEAR × 0.6 a plating level; the blow is
// loud (NOISE, the unaware within WAKE turn toward it). A barricade it drives through (RAMMING.WEAR).
export const BREACH = { WEAK: 100, DMG: [30, 45], WEAR: 4, NOISE: 3, WAKE: 12 };
const carSide = (b, v) => (v === b.raidHumvee ? "enemy" : "player");
const carLabel = (b, v) => `${carSide(b, v) === "enemy" ? "Their" : "Your"} ${v.name || v.kind}`;
const carFoes = (b, v) => b.units.filter((o) => (carSide(b, v) === "enemy" ? o.side === "player" : o.side === "enemy") && active(o));
const seatsLeft = (b, v) => (v.seats || RAID_CAR.SEATS) - b.units.filter((o) => ridesIn(b, o, v)).length;
// The driver and riders: the raiders nearest it get in (the gunner already on it).
function crewRaidCar(b) {
  const v = b.raidHumvee;
  if (!v) return;
  const [x, y] = roofCell(v);
  const near = b.units.filter((o) => o.side === "enemy" && o.kind === "human" && active(o) && !o.gunner).sort((p, q) => dist(p.x, p.y, x, y) - dist(q.x, q.y, x, y) || p.id - q.id);
  if (near.length < 1 + RAID_CAR.FOOT) return; // too few of them: it stays a gun where it stands
  const n = 1 + Math.min(RAID_CAR.RIDERS, near.length - 1 - RAID_CAR.FOOT, (v.seats || RAID_CAR.SEATS) - 2);
  const crew = near.slice(0, n);
  for (const o of crew) { o.aboard = true; o.off = true; o.post = null; o.ow = o.hunker = false; o.x = v.x; o.y = v.y; }
  v.driver = crew[0].id;
  say(b, `${crew[0].name} is at the wheel${crew.length > 1 ? `, ${crew.length - 1} more of them inside` : ""}: it comes on with them, and drives off if it has to. Stop the driver (shoot the cab) or wreck it before it gets away and it is yours.`, "danger");
}
// A caravan's armoured escort (escorts.js: a Humvee or an MRAP with the M2, plated and glassed) on the road map: theirs
// to drive as a raid's Humvee (carTurn), manned (manEnemyTurret) and crewed (crewRaidCar). Driven off, they keep it
// (result.humveeOut: caravanraids.js / visitors.js take no vehicle).
function escortCar(b, r, body, gun) {
  const name = body === "mrap" ? "MRAP" : "Humvee";
  b.raidHumvee = { x: r.x0, y: r.y0, w: r.w, h: r.h, ax: r.ax, kind: name, name, cell: "truck", seats: body === "mrap" ? RAID_CAR.MRAP_SEATS : RAID_CAR.SEATS, up: { plating: 1, scrapPlate: 0, glass: 1, mesh: 0, turret: { gun } }, wear: 0, ai: "advance", driver: null, escort: true };
  manEnemyTurret(b, gun);
}
// Their vehicle can still drive off with its people: it holds the field for them (checkEnd).
const carHolds = (b) => { const v = carOf(b, { side: "enemy" }); const d = v && v.ai && v.ai !== "stalled" ? unitById(b, v.driver) : null; return !!(d && ridesIn(b, d, v) && !d.down); };
export function raidCarTurn(b) { const v = carOf(b, { side: "enemy" }); if (v) carTurn(b, v); }
export function carTurn(b, v) {
  bindDims(b);
  if (!v || !v.ai) return; // none, gone, or a save from before it could drive
  const side = carSide(b, v), theirs = side === "enemy";
  const crew = () => b.units.filter((o) => ridesIn(b, o, v));
  const driver = unitById(b, v.driver);
  const able = (o) => o && ridesIn(b, o, v) && !o.down && !isTied(o);
  // The gun unmanned: a rider (not the driver) climbs up to it (1 action, as manTurret).
  let g = gunnerOf(b, side);
  if (!g && v.up && v.up.turret) {
    const r = crew().find((o) => able(o) && o !== driver);
    if (r) {
      takeGun(r, TURRET_WEAPON[v.up.turret.gun] || "turret_m2", v.belt);
      r.off = false; r.ow = r.hunker = false; r.ap = theirs ? 1 : Math.max(0, r.ap - 1);
      syncGunner(b, v);
      say(b, `${r.name} climbs up behind ${theirs ? "their" : "your"} ${v.name || v.kind}'s gun.`, theirs ? "danger" : "info");
      g = r;
    }
  }
  if (v.ai === "stalled") return;
  if ((v.wear || 0) >= RAID_CAR.STALL_WEAR) {
    v.ai = "stalled";
    const out = crew().filter((o) => able(o) && !o.gunner);
    for (const o of out) { o.ap = 2; disembark(b, o); }
    say(b, `${carLabel(b, v)}'s engine dies: it stands where it is${out.length ? `, ${out.map((o) => o.name).join(", ")} bail${out.length === 1 ? "s" : ""} out` : ""}.`, theirs ? "good" : "danger");
    return;
  }
  if (!able(driver) || driver.gunner) return; // nobody at the wheel: it stays where it stands
  if (!theirs && driver.ap < DRIVE.AP) return; // yours: the driver's own actions (got in this turn: next turn)
  const foes = carFoes(b, v);
  const why = (v.wear || 0) >= RAID_CAR.BACK_WEAR ? "badly battered" : !theirs ? null : !g && v.up && v.up.turret ? "its gun unmanned" : shouldFlee(b) ? "their attack broken" : null;
  if (v.ai === "back" || why) {
    if (v.ai !== "back") say(b, `${carLabel(b, v)} pulls back (${why}).`, theirs ? "good" : "danger");
    v.ai = "back";
    return carBack(b, v, driver, foes);
  }
  if (!foes.length) return;
  driver.ap = DRIVE.AP;
  const W0 = g ? WEAPONS[g.weapon] : null, range = W0 ? W0.opt : WEAPONS.turret_m2.opt;
  const nearest = (x, y) => Math.min(...foes.map((f) => dist(x, y, f.x, f.y)));
  const sees = (x, y) => foes.filter((f) => dist(x, y, f.x, f.y) <= range && los(b, x, y, f.x, f.y)).length;
  // Holding: the gunner has someone in range and in sight.
  const [gx, gy] = roofCell(v);
  if (g && foes.some((f) => dist(gx, gy, f.x, f.y) <= range && canSee(b, g, f))) { v.ai = "hold"; dropRiders(b, v, foes); if (!theirs) driver.ap = 0; return; }
  // The front: how near their own nearest one on foot is to the other side; it keeps no more than LEAD ahead of it.
  const walkers = b.units.filter((o) => o.side === side && o.kind === "human" && active(o) && !o.aboard);
  const front = walkers.length ? Math.min(...walkers.map((o) => nearest(o.x, o.y))) : 0;
  const floor = Math.max(RAID_CAR.NEAR, front - RAID_CAR.LEAD);
  const pick = (seen, key) => {
    let best = null;
    for (const [k, steps] of seen) {
      const px = k % W, py = (k / W) | 0;
      const [rx, ry] = roofCell({ x: px, y: py, w: v.w, h: v.h });
      const d = nearest(rx, ry);
      if (d < floor && k !== key(v.x, v.y)) continue;
      let road = 0;
      for (let cy = py; cy < py + v.h; cy++) for (let cx = px; cx < px + v.w; cx++) if (b.cells[idx(cx, cy)].f === "road") road++;
      const n = sees(rx, ry);
      const sc = n * 100 - d + road * RAID_CAR.ROAD - steps * 0.01;
      if (!best || sc > best.sc) best = { px, py, sc, n };
    }
    return best;
  };
  const { seen, key } = carSteps(b, v, driver, true);
  let best = pick(seen, key), ram = true;
  // Nowhere to shoot from: a plated one of theirs with no ram along breaks in (a weak gate, a barricade).
  if (theirs && (!best || !best.n) && breachOk(b, v)) {
    if (ramGate(b, v, driver)) { driver.ap = 0; return; }
    const bs = carSteps(b, v, driver, BREACH_THROUGH);
    const bb = pick(bs.seen, bs.key);
    if (bb && bb.n && bb.sc > (best ? best.sc : -Infinity)) { best = bb; ram = BREACH_THROUGH; }
  }
  v.ai = "advance";
  if (best && (best.px !== v.x || best.py !== v.y)) driveTo(b, driver, best.px + Math.floor((v.w - 1) / 2), best.py + Math.floor((v.h - 1) / 2), { noRam: ram });
  driver.ap = 0;
  if (Math.min(...vehicleCells(v).map(([cx, cy]) => nearest(cx, cy))) <= RAID_CAR.DROP) dropRiders(b, v, foes);
}
// Breaching (BREACH): theirs, plated, and no ram of theirs on the map.
export const BREACH_THROUGH = new Set(["barricade"]);
export const breachOk = (b, v) => !!(v.up && (v.up.plating || v.up.scrapPlate)) && !(b.rams || []).some((r) => r.side === "enemy" && !r.dropped);
// A weak barred gate cell next to it, rammed (true), or false. Damage to both.
export function ramGate(b, v, driver) {
  for (let y = v.y - 1; y <= v.y + v.h; y++) for (let x = v.x - 1; x <= v.x + v.w; x++) {
    if (!inside(x, y) || inVehicle(v, x, y) || ((x < v.x || x >= v.x + v.w) && (y < v.y || y >= v.y + v.h))) continue; // the 4 sides, not the corners
    const c = b.cells[idx(x, y)];
    if (c.k !== "gate" || !barredCell(c) || !(c.hp <= BREACH.WEAK)) continue;
    const dmg = b.rng.int(BREACH.DMG[0], BREACH.DMG[1]);
    const wear = Math.round(BREACH.WEAR * mapWearMult(v) * 10) / 10;
    c.hp = Math.max(0, c.hp - dmg);
    v.wear = Math.round(((v.wear || 0) + wear) * 10) / 10;
    b.noise = (b.noise || 0) + BREACH.NOISE;
    alertNear(b, x, y, BREACH.WAKE, "The crash of steel on the gate carries.");
    fx(b, { type: "melee", from: [x, y], to: [x, y], hit: true, crit: false, dmg, side: "enemy", text: c.hp > 0 ? `RAMMED −${dmg}` : "SMASHED" });
    say(b, `${driver.name} rams ${carLabel(b, v).toLowerCase()} into the gate: −${dmg}${c.hp > 0 ? ` (${c.hp}/${c.mhp} left)` : ""}; the ${v.name || v.kind} takes −${wear}.`, "danger");
    if (c.hp <= 0) breakCell(b, x, y, driver);
    bump(b);
    return true;
  }
  // None next to it: drive up to one (a free spot touching a weak gate, over open ground).
  const { seen } = carSteps(b, v, driver, true);
  const weak = [];
  for (let i = 0; i < b.cells.length; i++) { const c = b.cells[i]; if (c.k === "gate" && barredCell(c) && c.hp <= BREACH.WEAK) weak.push([i % W, (i / W) | 0]); }
  if (!weak.length) return false;
  let best = null;
  for (const [k, steps] of seen) {
    const px = k % W, py = (k / W) | 0;
    const r = { x: px, y: py, w: v.w, h: v.h };
    if (!weak.some(([x, y]) => (x >= px && x < px + v.w && (y === py - 1 || y === py + v.h)) || (y >= py && y < py + v.h && (x === px - 1 || x === px + v.w)))) continue;
    if (!best || steps < best.steps) best = { ...r, steps };
  }
  if (!best || (best.x === v.x && best.y === v.y)) return false;
  driver.ap = DRIVE.AP;
  driveTo(b, driver, best.x + Math.floor((v.w - 1) / 2), best.y + Math.floor((v.h - 1) / 2), { noRam: true });
  say(b, `${carLabel(b, v)} lines up on the gate.`, "danger");
  return true;
}
// The riders get out (not the driver, the gunner or the downed) and go on on foot: one action left this turn.
function dropRiders(b, v, foes) {
  const out = b.units.filter((o) => ridesIn(b, o, v) && o.id !== v.driver && !o.gunner && !o.down && !isTied(o));
  for (const o of out) { o.ap = 2; if (!disembark(b, o)) o.aware = true; }
  if (out.length && foes.length) say(b, `${carSide(b, v) === "enemy" ? "Their" : "Your"} riders jump out of the ${v.name || v.kind}.`, carSide(b, v) === "enemy" ? "danger" : "info");
}
// Their people running (flee) within PICKUP of it, while it has seats: it waits for them (WAIT turns at most).
const waitingFor = (b, v) => (seatsLeft(b, v) > 0 ? b.units.filter((o) => o.side === "enemy" && o.kind === "human" && active(o) && !o.aboard && (o.fleeing || shouldFlee(b)) && dist(o.x, o.y, ...roofCell(v)) <= RAID_CAR.PICKUP) : []);
// Pulling back: toward the edge they came from (exitEdge; yours toward the other edge); theirs, there or stuck, off the
// map with everyone inside.
function carBack(b, v, driver, foes) {
  const theirs = carSide(b, v) === "enemy";
  const edgeOf = (cx, cy) => { const e = b.side === "west" ? cx : b.side === "north" ? cy : b.side === "south" ? H - 1 - cy : W - 1 - cx; return theirs ? e : (b.side === "north" || b.side === "south" ? H - 1 : W - 1) - e; };
  const edge = (px, py) => { let m = Infinity; for (let cy = py; cy < py + v.h; cy++) for (let cx = px; cx < px + v.w; cx++) m = Math.min(m, edgeOf(cx, cy)); return m; };
  // Theirs waits for their people running for it (they climb in on their turn: flee).
  if (theirs && (v.waited || 0) < RAID_CAR.WAIT && waitingFor(b, v).length) {
    v.waited = (v.waited || 0) + 1;
    const n = waitingFor(b, v).length;
    say(b, `${carLabel(b, v)} waits for ${n === 1 ? "one of them" : `${n} of them`} running for it.`, "danger");
    return;
  }
  const here = edge(v.x, v.y);
  if (here > RAID_CAR.OUT) {
    const { seen } = carSteps(b, v, driver, true);
    let best = null;
    for (const [k] of seen) {
      const px = k % W, py = (k / W) | 0;
      const sc = -edge(px, py) * 10 + (foes.length ? Math.min(...foes.map((f) => dist(px, py, f.x, f.y))) * 0.1 : 0);
      if (!best || sc > best.sc) best = { px, py, sc, e: edge(px, py) };
    }
    if (best && best.e < here) {
      driver.ap = DRIVE.AP;
      driveTo(b, driver, best.px + Math.floor((v.w - 1) / 2), best.py + Math.floor((v.h - 1) / 2), { noRam: true });
      driver.ap = 0;
      v.stuck = 0;
      if (best.e > RAID_CAR.OUT) return;
    } else if ((v.stuck = (v.stuck || 0) + 1) < RAID_CAR.STUCK) return;
  }
  if (!theirs) return; // yours stays on the map
  // Off the map: the cells it stood on are open ground again; everyone inside got away with it.
  const riders = b.units.filter((o) => ridesIn(b, o, v));
  for (const o of riders) if (o.gunner) leaveTurret(b, o, true);
  for (const [cx, cy] of vehicleCells(v)) { const c = b.cells[idx(cx, cy)]; c.k = "open"; delete c.car; delete c.h; }
  for (const o of riders) { o.aboard = false; o.off = false; o.fled = true; o.ap = 0; o.ow = o.hunker = false; }
  v.gone = true; v.ai = null;
  if (b.losCache) b.losCache.fill(0);
  say(b, `${carLabel(b, v)} drives off${riders.length ? ` with ${riders.map((o) => o.name).join(", ")}` : ""}.`, "good");
  bump(b);
}
// A raider running (flee) for their vehicle that is pulling back: in when next to it (1 action), else toward it.
// Returns true when that took the turn.
export function fleeToCar(b, u) {
  const v = carOf(b, u);
  if (!v || v.ai !== "back" || u.kind !== "human" || seatsLeft(b, v) <= 0 || dist(u.x, u.y, ...roofCell(v)) > RAID_CAR.PICKUP) return false;
  if (!nearRect(v, u.x, u.y)) {
    const r = reachable(b, u, u.mob * Math.max(1, u.ap));
    let best = null;
    for (let y = v.y - 1; y <= v.y + v.h; y++) for (let x = v.x - 1; x <= v.x + v.w; x++) {
      if (!inside(x, y) || inVehicle(v, x, y) || !isFinite(r.dist[idx(x, y)])) continue;
      if (!best || r.dist[idx(x, y)] < best.d) best = { x, y, d: r.dist[idx(x, y)] };
    }
    if (!best) return false;
    if (best.d > 0) moveAlong(b, u, pathTo(r, best.x, best.y));
    if (!active(u) || !nearRect(v, u.x, u.y)) { u.fleeing = true; u.ap = 0; return true; }
  }
  u.ap = Math.max(1, u.ap);
  boardVehicle(b, u);
  u.ap = 0;
  return true;
}
// A base battle moves off the wall map (interior.js toInterior): the Humvee stays outside the wall, its people get out
// and come on with the others still outside.
export function parkRaidCar(b) {
  const v = carOf(b, { side: "enemy" });
  if (!v) return;
  for (const o of b.units) if (ridesIn(b, o, v)) { if (o.gunner) leaveTurret(b, o, true); o.aboard = false; }
  v.parked = true;
}
// Your side played by the battle AI (autoPlayerTurn): a turreted vehicle of yours gets a crew (the nearest able one
// walks over, gets in and mans the gun; a second at the wheel while RAID_CAR.FOOT − 1 or more stay on foot) and is then
// driven by carTurn as theirs is. Without a turret it stays where it is (the AI does not drive a plain car into a fight).
export function botCar(state, b) {
  const v = b.vehicle;
  if (!v || !v.up || !v.up.turret || v.kind === "bike" || b.raid) return;
  if (!v.ai) v.ai = "advance";
  const team = b.units.filter((o) => o.side === "player" && active(o) && o.kind !== "zombie" && !o.captive);
  const [rx, ry] = roofCell(v);
  // Over to it (a move, or a dash: in next turn) and in (1 action). True when they got in.
  const walkIn = (o) => {
    if (!atVehicle(b, o) && o.ap > 0) {
      const r = reachable(b, o, o.mob * o.ap);
      let best = null;
      for (let y = v.y - 1; y <= v.y + v.h; y++) for (let x = v.x - 1; x <= v.x + v.w; x++) {
        if (!inside(x, y) || inVehicle(v, x, y) || !isFinite(r.dist[idx(x, y)]) || unitAt(b, x, y)) continue;
        if (!best || r.dist[idx(x, y)] < best.d) best = { x, y, d: r.dist[idx(x, y)] };
      }
      // Not there this turn: as near as they can get.
      if (!best) for (let i = 0; i < W * H; i++) if (isFinite(r.dist[i]) && r.dist[i] > 0 && !unitAt(b, i % W, (i / W) | 0)) { const g = dist(i % W, (i / W) | 0, rx, ry); if (!best || g < best.g) best = { x: i % W, y: (i / W) | 0, d: r.dist[i], g }; }
      if (!best) return false;
      moveAlong(b, o, pathTo(r, best.x, best.y));
      o.ap -= best.d > o.mob ? 2 : 1;
    }
    return active(o) && atVehicle(b, o) && o.ap > 0 && !boardVehicle(b, o);
  };
  const byNear = (list) => list.slice().sort((p, q) => dist(p.x, p.y, rx, ry) - dist(q.x, q.y, rx, ry) || p.id - q.id);
  const reach = (x) => dist(x.x, x.y, rx, ry) <= x.mob * 2 + 3; // within a dash of it
  for (const o of b.units) if (o.botCar && (o.side !== "player" || !active(o) || o.aboard)) delete o.botCar; // down, gone or in
  const coming = team.filter((x) => !x.aboard && x.botCar && x.ap > 0); // on their way to it from an earlier turn
  for (const o of coming) if (walkIn(o)) delete o.botCar;
  const riders = b.units.filter((o) => ridesIn(b, o, v));
  // The gun first (one inside who is not at the wheel, if there is one).
  if (!gunnerOf(b, "player")) {
    const inside = riders.find((o) => !o.down && o.ap > 0 && o.id !== v.driver) || riders.find((o) => !o.down && o.ap > 0);
    const o = inside || (team.length >= 2 && !b.units.some((x) => x.botCar) ? byNear(team.filter((x) => !x.aboard)).find(reach) : null);
    if (o && !inside) { if (walkIn(o)) delete o.botCar; else o.botCar = "gun"; }
    if (o && o.aboard && o.ap > 0) { manTurret(b, o); if (v.driver === o.id) v.driver = null; }
  }
  // Then the wheel.
  const d = unitById(b, v.driver);
  if (!(d && ridesIn(b, d, v) && !d.down && !d.gunner)) {
    const inside = b.units.find((o) => ridesIn(b, o, v) && !o.gunner && !o.down);
    if (inside) v.driver = inside.id;
    else if (team.filter((o) => !o.aboard && !o.botCar).length >= RAID_CAR.FOOT) {
      const o = byNear(team.filter((x) => !x.aboard && !x.botCar)).find(reach);
      if (o) { if (walkIn(o)) { v.driver = o.id; say(b, `${o.name} takes the wheel.`, "info"); } else o.botCar = "wheel"; }
    }
  }
  carTurn(b, v);
}
// ---------- shooting at a vehicle: the cab and the hull (either side) ----------
// The other side's vehicle (yours to them; their Humvee or escort to you) can be shot at itself (act "cab"; the AI when it
// has nothing better: aiCab, gunnerAI), with the gun's mode, rounds, jams and belt as any shot (fire with an onHit),
// at the odds of a shot at a turret's gunner (half cover, full behind plate x2: the windscreen in its frame). Each round
// that hits:
//   - strikes the hull: wear (as blasts and ramming: settled on your vehicle's condition; theirs pulls back or stalls,
//     carTurn) by its penetration past HULL.PEN, HULL.PER a point, × 0.6 a plating level (mapWearMult): the .50 ball
//     (pen 70) 3.5 bare, 2.1 plated a round (a turret's burst hits as one roll: × its 3 rounds, 6.3 plated: two
//     such hits and their Humvee pulls back, four and it stalls); a .308 AP 2, a 5.56 or 7.62×39 AP 1; rifle ball
//     next to none, pistols and shot none;
//   - goes in at the windscreen CAB.REACH of the time (× CAB.PLATE a plating level: plate round the windows) and hits
//     whoever is at the wheel (v.driver; else the first one inside, not the gunner), × the glass (riderHitMult:
//     bulletproof glass stops most of a light round) and what they wear. A driver down stops it (carTurn).
// A round that misses a turret's gunner hits the vehicle under them HULL.MISS of the time (the gunners' duel): the
// same hull wear (fire).
export const CAB = { REACH: 0.5, PLATE: 0.6, AI_MIN: 25 };
export const HULL = { PEN: 35, PER: 0.1, MISS: 0.35 };
export const hullWear = (v, pen) => Math.round(Math.max(0, pen - HULL.PEN) * HULL.PER * mapWearMult(v) * 10) / 10;
const roundPen = (info) => (info && info.cal ? ammoPen(info.cal, info.ammo) : 0);
// A round into the hull: the wear it does (0 for a light round).
function strikeHull(v, info) {
  const W1 = info && WEAPONS[info.weapon];
  const w = v ? Math.round(hullWear(v, roundPen(info)) * (W1 && W1.mounted ? W1.ammo : 1) * 10) / 10 : 0; // a turret's burst is one roll for its rounds
  if (w) v.wear = Math.round(((v.wear || 0) + w) * 10) / 10;
  return w;
}
// Whoever sits at the wheel of v (the cab): the driver, else the first one inside who is not on the gun; or null.
export function cabSeat(b, v) {
  const d = v ? unitById(b, v.driver) : null;
  if (d && ridesIn(b, d, v) && !d.gunner) return d;
  return v ? b.units.find((o) => ridesIn(b, o, v) && !o.gunner) || null : null;
}
// The other side's vehicle the shooter can see: { v, x, y } (its cell nearest them in sight), or null.
export function cabTarget(b, a) {
  bindDims(b);
  const v = a.side === "player" ? carOf(b, { side: "enemy" }) : a.side === "enemy" ? b.vehicle : null;
  if (!v || v.kind === "bike" || a.aboard && !a.gunner) return null;
  let best = null;
  for (const [cx, cy] of vehicleCells(v)) { const d = dist(a.x, a.y, cx, cy); if ((!best || d < best.d) && canSeeAt(b, a, cx, cy)) best = { v, x: cx, y: cy, d }; }
  return best;
}
// The stand-in target a cab shot is aimed at (shotOdds: as a turret's gunner of that side).
const cabProxy = (b, v, x, y) => ({ id: -1, x, y, side: v === b.raidHumvee ? "enemy" : "player", kind: "human", aware: true, gunner: true, hp: 1, name: `the ${v.name || (v.mil ? "Army truck" : v.kind)}'s cab` });
export const cabOdds = (b, a, tgt) => shotOdds(b, a, cabProxy(b, tgt.v, tgt.x, tgt.y));
// Fire at the cab (the shooter's turn: the caller spends the actions).
export function fireCab(b, a, tgt) {
  const { v } = tgt;
  const t = cabProxy(b, v, tgt.x, tgt.y);
  let wear = 0;
  const hurt = [];
  const plate = (v.up && v.up.plating) || 0;
  fire(b, a, t, {
    onHit: (raw, info) => {
      wear += strikeHull(v, info);
      const occ = cabSeat(b, v);
      if (!occ || battleDice(b, "cab") >= CAB.REACH * CAB.PLATE ** plate) return 0;
      const eff = Math.round(damage(b, occ, raw * riderHitMult(b, info, v), a, false, info));
      hurt.push(`${occ.name} ${eff}${occ.dead ? " (killed)" : occ.down ? " (down)" : ""}`);
      return eff;
    },
  });
  const name = v.name || (v.mil ? "Army truck" : v.kind);
  const mine = a.side === "player";
  if (wear || hurt.length) say(b, `${wear ? `The ${name} takes −${Math.round(wear * 10) / 10}${v.up && v.up.plating ? " (the plate took most)" : ""}` : `The ${name} shrugs the rounds off`}${hurt.length ? `; through the windscreen: ${hurt.join(", ")}${v.up && v.up.glass ? " (the bulletproof glass took some)" : ""}` : ""}.`, mine ? "good" : "danger");
  bump(b);
}
// The AI's cab shot: worth it when the round wears the hull or someone sits in the cab, at fair odds (CAB.AI_MIN), and
// within the gun's range. Returns the target or null.
function aiCab(b, a) {
  const tgt = cabTarget(b, a);
  if (!tgt || !isRanged(a) || !canFire(b, a)) return null;
  const w = WEAPONS[a.weapon];
  if (tgt.d > modRange(w, unitMods(a)).opt) return null;
  const ur = unitRound(a); // (the round loaded: a 5.56 gun's .223 goes through as .223)
  const pen = ur ? ammoPen(ur.cal, ur.type) : w.cal ? ammoPen(w.cal, typeFor(w.cal, a.load)) : 0;
  if (!hullWear(tgt.v, pen) && !cabSeat(b, tgt.v)) return null;
  return cabOdds(b, a, tgt).chance >= CAB.AI_MIN ? tgt : null;
}
// The gunner's turn (either side, the AI): never moves; reloads an empty belt (both actions); fires at the best target,
// the ones in the open first; otherwise watches.
function gunnerAI(b, u) {
  if (u.jam) { unjam(b, u); if (u.jam || u.ap < 1) { u.ap = 0; return; } } // gunfire.js: the turret jammed (its rel), cleared first (never by a new belt)
  if (magEmpty(b, u) && !reloadRefusal(b, u)) { reload(b, u); afterTurretReload(b, u); u.ap = 0; return; }
  const foes = foesOf(b, u).filter((f) => canSee(b, u, f));
  const open = foes.filter((f) => shotOdds(b, u, f).cover === 0);
  const cab = open.length ? null : aiCab(b, u); // nobody in the open: the other side's vehicle in range (the .50 wears it, the driver)
  if (cab) { fireCab(b, u, cab); u.ap = 0; return; }
  const shot = bestShot(b, u, open.length ? open : foes);
  if (shot) fire(b, u, shot.t);
  else if (canFire(b, u)) u.ow = true;
  u.ap = 0;
}


// Cars parked or left off the road: n of them, each at a free spot in `ok` cells, turned as their dice say.
export function scatterCars(rng, cells, W, H, n, ok, kind = "car", lo = 1, hi = W - 2) {
  let placed = 0;
  for (let tries = 0; tries < n * 12 && placed < n; tries++) {
    const k = kind === "mixed" ? (rng.chance(0.25) ? "truck" : "car") : kind;
    const L = rng.pick(CAR_LEN[k]), ax = rng.chance(0.5) ? "x" : "y";
    if (placeCar(cells, W, H, rng.int(lo, hi), rng.int(0, H - 1), ax, L, k, ok, rng.int(0, 1e6))) placed++;
  }
  return placed;
}
// Army trucks (miltrucks.js trucksAt): each a car of kind "truck" (full cover, blocks sight) with c.car.mil { i, kind,
// cond } and body m35 / humvee / mrap (the views draw it olive, burned out black), TRUCK_KINDS L cells long. Along the
// road when there is one (a convoy, a road tile: nose to tail in the lanes, the road still open end to end), else
// parked in a row on open ground (a base's motor pool). ok(x, y, onRoad): a cell it may stand on. Returns [{ truck, rect }].
export function placeMilTrucks(rng, cells, W, H, trucks, road, ok) {
  const out = [];
  const mark = (rect, x) => {
    for (let yy = rect.y0; yy < rect.y0 + rect.h; yy++) for (let xx = rect.x0; xx < rect.x0 + rect.w; xx++) {
      const c = cells[yy * W + xx];
      c.car.mil = { i: x.i, kind: x.kind, cond: x.cond, key: x.key, ...(x.runs ? { runs: true } : {}), ...(x.turret ? { turret: x.turret } : {}) }; // key, i: the truck's record (miltrucks.js markTaken); runs / turret: a motor pool's ready vehicles
      if (x.turret) c.car.up = { p: 0, s: 0, g: 0, m: 0, t: x.turret }; // drawn with the gun on its roof
    }
    out.push({ truck: x, rect });
  };
  let row = null; // the motor pool's row: the last truck parked
  for (const x of trucks) {
    const K = TRUCK_KINDS[x.kind] || TRUCK_KINDS.cargo, L = K.L, opt = { body: K.body };
    let rect = null;
    if (road && x.src !== "base") {
      const onRoad = (xx, yy) => road.onRoad(xx, yy) && ok(xx, yy, true);
      for (let tries = 0; tries < 60 && !rect; tries++) {
        const lane = rng.int(0, road.lanes - 1);
        rect = placeCar(cells, W, H, rng.int(3, Math.max(3, W - 4 - L)), road.r + lane * 2, "x", L, "truck", onRoad, rng.int(0, 1e6), opt);
        if (rect && !road.through()) { removeCar(cells, W, rect); rect = null; }
      }
    }
    for (let tries = 0; tries < 80 && !rect; tries++) {
      if (row && tries < 6) { // next to the last one parked, side by side
        const r = row, step = 3 * (tries + 1);
        rect = placeCar(cells, W, H, r.ax === "x" ? r.x0 : r.x0 + step, r.ax === "x" ? r.y0 + step : r.y0, r.ax, L, "truck", ok, rng.int(0, 1e6), opt);
      } else {
        const ax = rng.chance(0.5) ? "x" : "y";
        rect = placeCar(cells, W, H, rng.int(3, Math.max(3, W - 4 - (ax === "x" ? L : 2))), rng.int(1, Math.max(1, H - 2 - (ax === "y" ? L : 2))), ax, L, "truck", ok, rng.int(0, 1e6), opt);
      }
    }
    if (rect) { row = rect; mark(rect, x); }
  }
  return out;
}

function layRoad(rng, cells, W, H, t, r0, opts = {}) {
  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const reserved = opts.reserved || null;
  const isRes = (x, y) => !!(reserved && reserved[idx(x, y)]);
  const width = roadWidth(H);
  const r = Math.max(1, Math.min(H - width - 1, r0));
  const rows = [];
  for (let i = 0; i < width; i++) rows.push(r + i);
  // The road's floor, under the ways in and out too (their cells stay open ground for the zones).
  for (let x = 0; x < W; x++) for (const y of rows) { const c = cells[idx(x, y)]; if (c.k === "open" || c.k === "vehicle") c.f = "road"; }
  let deck = null;
  if (t.bridge) {
    const span = bridgeSpan(W);
    const c0 = Math.max(2, Math.min(W - span - 2, opts.c0 != null ? opts.c0 : Math.floor((W - span) / 2) + rng.int(-1, 1))); // c0: a base's wall map puts the river where its wall stands on the deck (createBattle)
    deck = { c0, c1: c0 + span - 1, span };
    for (let x = c0; x <= deck.c1; x++) for (let y = 0; y < H; y++) {
      if (isRes(x, y)) continue;
      const c = cells[idx(x, y)];
      if (rows.includes(y)) { c.deck = true; continue; }       // the deck: road over the water
      if (y === r - 1 || y === r + width) { c.k = "rail"; c.f = "road"; c.deck = true; continue; } // the railings
      c.k = "water"; c.f = "grass"; delete c.deck;
    }
  }
  // The cars left along the road: in lanes two rows wide, lengthwise, a ring of free cells around each (a railing may
  // be part of the ring: parked at the kerb of the bridge).
  const lanes = Math.floor(width / 2);
  const onRoad = (x, y) => inside(x, y) && !isRes(x, y) && cells[idx(x, y)].k === "open" && cells[idx(x, y)].f === "road";
  const placed = [];
  const putCar = (x, lane, kind, L, v) => {
    const rect = placeCar(cells, W, H, x, r + lane * 2, "x", L, kind, onRoad, v);
    if (rect) placed.push(rect);
    return rect;
  };
  const n = Math.max(2, Math.round(opts.carsPer ?? W / 6));
  const lo = opts.lo ?? 2, hi = opts.hi ?? W - 3;
  for (let i = 0, tries = 0; i < n && tries < n * 10; tries++) {
    const kind = rng.chance(0.25) ? "truck" : "car", L = rng.pick(CAR_LEN[kind]);
    if (putCar(rng.int(lo, Math.max(lo, hi - L)), rng.int(0, lanes - 1), kind, L, rng.int(0, 1e6))) i++;
  }
  // The road must still run from one edge to the other through its own rows (8-way steps, as units move): else the
  // last cars go back until it does.
  const through = () => {
    const seen = new Uint8Array(W * H), q = [];
    for (const y of rows) if (CELL[cells[idx(0, y)].k].walk) { seen[idx(0, y)] = 1; q.push([0, y]); }
    while (q.length) {
      const [x, y] = q.pop();
      if (x === W - 1) return true;
      for (const [dx, dy] of DIRS8) {
        const nx = x + dx, ny = y + dy;
        if (!inside(nx, ny) || !rows.includes(ny) || seen[idx(nx, ny)] || !CELL[cells[idx(nx, ny)].k].walk) continue;
        seen[idx(nx, ny)] = 1; q.push([nx, ny]);
      }
    }
    return false;
  };
  while (placed.length && !through()) removeCar(cells, W, placed.pop());
  return { r, rows, width, lanes, deck, putCar, onRoad, through };
}


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
    // Cars and trucks are 2 × 3–4 cells (placeCar): half as many of them, parked off the road and outside.
    if (k === "car" || k === "truck") { scatterCars(rng, cells, W, H, Math.max(1, Math.round(N(n) / 2)), (x, y) => free(x, y) && at(x, y).f !== "road" && at(x, y).f !== "floor", k, lo, hi); return; }
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
  const houses = [], locked = []; // houses: { x0, y0, w, h, doors } (a locked one cut off is unlocked at the end)
  // The door's kind (buildingmaps.js DOOR_KINDS): the first door a house's front door; the others a screen door, a
  // patio's glass door or another solid one, a locked one always solid. Its hit points follow the kind.
  const fieldDoor = (x, y, i) => {
    const c = at(x, y), roll = hash01(rng.state, "fdoor", x, y), kr = hash01(rng.state, "fdkind", x, y);
    c.f = "floor";
    if (i && opts.locks !== false && roll < FIELD_DOOR.LOCKED) { c.k = "door"; c.dk = "front"; c.hp = c.mhp = BMAP.DOOR.locked; locked.push([x, y]); }
    else {
      c.k = i && roll >= FIELD_DOOR.LOCKED && roll < FIELD_DOOR.LOCKED + FIELD_DOOR.OPEN ? "odoor" : "idoor";
      c.dk = !i ? "front" : kr < 0.5 ? "screen" : kr < 0.75 ? "glass" : "front";
      c.hp = c.mhp = DOOR_KINDS[c.dk].hp;
    }
  };
  // A window's state (windows.js): a house's mix, from the map's own dice.
  const fieldWindow = (x, y) => { put(x, y, "window"); at(x, y).win = rollWin(rng.state, winMixOf("field"), x, y); };
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
      edge.slice(0, doors).forEach(([x, y], i) => fieldDoor(x, y, i));
      edge.slice(doors, doors + rng.int(1, 3)).forEach(([x, y]) => fieldWindow(x, y));
      houses.push({ x0, y0, w, h, doors: edge.slice(0, doors) });
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

  // Road strip (ROAD.width rows) with the cars left on it: a bridge tile puts the river across the map and the road
  // over it on a deck between railings (layRoad).
  // On a bridge the road is centred, so a base's gate rows (deploy.js, conquest.js: the middle rows) lie on the deck.
  const road = t.road ? layRoad(rng, cells, W, H, t, t.bridge ? Math.floor(H / 2) - Math.floor(roadWidth(H) / 2) : rng.int(Y(5), Y(7)), { carsPer: Math.round(W / 5), c0: opts.bridgeC0 }) : null;
  // River for water tiles: a band with a couple of fords (on a bridge tile the river is the bridge's, laid above).
  if (!road && t.terrain === "water") {
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
    case "military": building(5, 4); fenceLine(rx(X(5), X(7)), rng.int(1, Y(4)), X(6), true, "sandbag"); fenceLine(rx(X(5), X(7)), rng.int(Y(8), Y(11)), X(6), true, "sandbag"); if (!(opts.trucks && opts.trucks.length)) scatter("truck", 2); scatter("crate", 3); break;
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
  // Army trucks on this tile (miltrucks.js trucksAt): on the road, or parked in a row (a base's motor pool).
  if (opts.trucks && opts.trucks.length) placeMilTrucks(rng, cells, W, H, opts.trucks, road, (x, y, onRoad) => free(x, y) && (onRoad || (at(x, y).f !== "road" && at(x, y).f !== "floor")));
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
  if (opts.densify !== false) densify(cells, W, H, rng, { target: coverTarget(t.terrain), keep: (x, y) => !!cells[idx(x, y)].deck }); // not on a base's wall map (its own ground); nothing extra on a bridge's deck

  // Every open cell must connect to both deployment zones; carve a lane if not. On a bridge tile the lane is the
  // deck (the river is never carved): clear whatever blocks it.
  const mid = Math.floor(H / 2);
  const rowsToTry = road ? [road.rows[Math.floor(road.width / 2)], road.rows[1], road.rows[road.width - 2]] : [mid - 1, mid, mid + 1];
  const KEEP = new Set(["open", "water", "rail", "car", "truck"]); // never through the river, a railing or a car (cars leave the road open: layRoad)
  const done = (reach) => ({ cells, reach: unlockCut(reach), locked: locked.filter(([x, y]) => cells[idx(x, y)].k === "door") });
  // A house the lane or the clutter outside left with only locked ways in: its locked doors become closed doors.
  const unlockCut = (reach) => {
    for (const hs of houses) {
      const ins = [];
      for (let y = hs.y0 + 1; y < hs.y0 + hs.h - 1; y++) for (let x = hs.x0 + 1; x < hs.x0 + hs.w - 1; x++) if (CELL[cells[idx(x, y)].k].walk) ins.push(idx(x, y));
      if (!ins.length || ins.some((j) => reach[j]) || !hs.doors.some(([x, y]) => cells[idx(x, y)].k === "door")) continue;
      for (const [x, y] of hs.doors) if (cells[idx(x, y)].k === "door") { cells[idx(x, y)].k = "idoor"; cells[idx(x, y)].hp = cells[idx(x, y)].mhp = BMAP.DOOR.outer; }
      reach = flood(cells, 0, mid);
    }
    return reach;
  };
  for (let tries = 0; tries < 3; tries++) {
    const r = flood(cells, 0, mid);
    if (r[idx(W - 1, mid)]) return done(r);
    const row = Array.from({ length: W }, (_, x) => cells[idx(x, rowsToTry[tries])].k), run = (x) => ["wall", "window", ...DOORS].includes(row[x]); // a house's wall across the lane, not along it
    for (let x = 0; x < W; x++) { const c = cells[idx(x, rowsToTry[tries])]; if (c.k === "door" || (c.k === "wall" && c.f === "floor" && !run(x - 1) && !run(x + 1))) { c.k = "idoor"; c.hp = c.mhp = BMAP.DOOR.outer; } else if (!KEEP.has(c.k) && c.k !== "idoor" && c.k !== "odoor") c.k = "open"; } // through a house: a door in its wall, never a gap
  }
  return done(flood(cells, 0, mid));
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
// The line-of-sight cache: (W·H)² entries, 0 unknown, 1 clear, 2 blocked. A typed array up to LOS_DENSE cells; a
// bigger map (the main hub's yard, up to 100 × 100: battlesize.js BASE_TIER) gets a sparse one with the same fill().
export const LOS_DENSE = 5000;
// The sparse one is a Map with the typed array's fill() (every `losCache.fill(0)` clears it). A save writes it as a
// plain Map; save.js makes a fresh one on load (it is only a cache).
export class SparseLos extends Map { fill() { this.clear(); } }
export function makeLosCache(w, h) {
  const n = w * h;
  return n <= LOS_DENSE ? new Int8Array(n * n) : new SparseLos();
}
const losGet = (cache, i) => (cache instanceof Map ? cache.get(i) || 0 : cache[i]);
const losSet = (cache, i, v) => { if (cache instanceof Map) cache.set(i, v); else cache[i] = v; };
export function los(b, x0, y0, x1, y1) {
  bindDims(b);
  const a = idx(x0, y0), c = idx(x1, y1);
  const v = losGet(b.losCache, a * W * H + c);
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
    const top = cell.t || (C.los && !doorSees(cell) ? C.tall || 1 : C.walk ? cell.h ?? C.h ?? 0 : 0); // doorSees: a closed glass or screen door is seen through (buildingmaps.js DOOR_KINDS)
    const eye = e0 + ((e1 - e0) * i) / n;
    if (!top || eye > top) continue;
    const fx = px - cx, fy = py - cy;
    if (fx > 0.12 && fx < 0.88 && fy > 0.12 && fy < 0.88) { clear = false; continue; }
    // Grazing this cell's edge: a corner glimpsed past, unless the cell across that edge blocks too (a sight line
    // squeezed along the seam between two cells of the same wall sees nothing).
    const nx = fx <= 0.12 ? cx - 1 : fx >= 0.88 ? cx + 1 : cx, ny = fy <= 0.12 ? cy - 1 : fy >= 0.88 ? cy + 1 : cy;
    const across = (x, y) => {
      if ((x === cx && y === cy) || !inside(x, y) || (x === x0 && y === y0) || (x === x1 && y === y1)) return false;
      const c2 = b.cells[idx(x, y)], C2 = CELL[c2.k];
      const t2 = c2.t || (C2.los && !doorSees(c2) ? C2.tall || 1 : C2.walk ? c2.h ?? C2.h ?? 0 : 0);
      return !!t2 && eye <= t2;
    };
    if ((nx !== cx && ny === cy && across(nx, cy)) || (ny !== cy && nx === cx && across(cx, ny))) clear = false;
  }
  losSet(b.losCache, a * W * H + c, clear ? 1 : 2);
  losSet(b.losCache, c * W * H + a, clear ? 1 : 2);
  return clear;
}

// How far a unit sees from where it stands: its sight (night, a flashlight, night vision: stealth.js), +HEIGHT.SIGHT
// a level up, + optics (binoculars, a thermal at night: u.optic, stealth.js).
export const sightRange = (b, a, x = a.x, y = a.y) => a.sight + HEIGHT.SIGHT * hAt(b, x, y) + (a.optic || 0) + (a.vsight || 0); // vsight: a ballistic visor down (helmets.js)
// Can a unit see a cell? Light shows your people what stands in it out to the full daylight range, however dark: a
// flare (throwables.js) and, at night, a floodlit cell (deploy.js). Inside a raid's building the room's own light
// (indoorlight.js): a lit room is seen as by day (at night too, by either side), a dark one (a barn, a storeroom, any
// room at night with its lights off) only as at night: down the cone, a light's beam, night vision.
export function canSeeAt(b, a, x, y) {
  bindDims(b);
  const d = dist(a.x, a.y, x, y);
  const lt = b.indoor ? lightAt(b, x, y) : 0;
  // At night a person on foot sees down cones (vision.js): the dark ahead, a light's beam, the cells around them.
  if (lt ? !indoorSees(b, a, x, y, d, lt, sightRange(b, a), (a.daySight ?? SIGHT) + HEIGHT.SIGHT * hAt(b, a.x, a.y) + (a.optic || 0) + (a.vsight || 0)) : coned(b, a) ? !nightSees(b, a, x, y, d, sightRange(b, a) - a.sight) : d > sightRange(b, a)) {
    if (a.side !== "player") return false;
    const lit = (b.flares && b.flares.length && flareLit(b, x, y)) || (b.night && b.floodAim && b.lit && b.lit[idx(x, y)]);
    if (!lit || d > SIGHT + HEIGHT.SIGHT * hAt(b, a.x, a.y) + (a.optic || 0)) return false;
  }
  return los(b, a.x, a.y, x, y) && !(b.smoke && b.smoke.length && smokeBlocks(b, a.x, a.y, x, y)); // a fire's thick smoke (throwables.js)
}
// A crawler low in the grass is hidden from your people until it is close, lit or has struck (zombietypes.js).
// Someone of yours sneaking (vision.js) is not seen by the other side behind half or full cover facing them (from
// further than a tile), unless they have a light switched on at night: it shows over the cover. A light switched on at
// night (vision.js activeLight) is seen from the daylight range by anyone facing it; night vision shows nothing.
export const canSee = (b, a, t) => !(t.low && a.side === "player" && !zRevealed(b, t)) && !sneakHidden(b, a, t) && ((t.size > 1 ? unitCells(t).some(([x, y]) => canSeeAt(b, a, x, y)) : canSeeAt(b, a, t.x, t.y)) || litFrom(b, a, t));
export function sneakHidden(b, a, t) {
  if (!t.sneaking || t.side !== "player" || a.side === "player") return false;
  if (b.night && activeLight(t)) return false; // the light gives them away
  if (dist(a.x, a.y, t.x, t.y) < 1.5) return false;
  return coverAgainst(b, t.x, t.y, a.x, a.y).level >= 1;
}
function litFrom(b, a, t) {
  if (!b.night || !activeLight(t) || t.side === a.side || t.down || t.dead) return false;
  if (dist(a.x, a.y, t.x, t.y) > SIGHT + HEIGHT.SIGHT * hAt(b, a.x, a.y) || !inArc(a, t.x, t.y, VISION.HALF)) return false;
  return los(b, a.x, a.y, t.x, t.y) && !(b.smoke && b.smoke.length && smokeBlocks(b, a.x, a.y, t.x, t.y));
}

// Cover a unit at (x, y) has against an attacker at (ax, ay). Cover sits on the 4 sides; it only
// counts when the attacker is roughly in front of it. Some cover nearby but none facing = flanked.
// The cover a neighbouring cell gives someone at (x, y): its own (a wall, a barricade), or full cover from a raised
// floor higher than they stand (the side of a roof, the walkway or a tower seen from below).
function sideCover(b, x, y, nx, ny) {
  const c = b.cells[idx(nx, ny)], C = CELL[c.k];
  if (C.walk && hAt(b, nx, ny) > hAt(b, x, y)) return 2;
  if (c.car && c.car.up && (c.car.up.p || c.car.up.s)) return 2; // a plated vehicle (vehicles.js upgrades): full cover
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
  // thirdside.js: your people squeeze past the survivors and soldiers who are not fighting them (as over the downed:
  // through, not stopping there), so a squad that stopped in a corridor never shuts your team in (the raid that never
  // ended, wanderertest.js).
  const pastThird = u.side === "player";
  for (const o of b.units) if (o !== u && onMap(o)) occ[idx(o.x, o.y)] = active(o) && !(pastThird && o.side === "third") ? 1 : 2;
  const foe = u.side !== (b.holders || "player"), per = siegeRule(u).climb; // b.holders: whose walls and gates (an assault on a group's base: theirs)
  // A Climber (middead.js climbOver) goes over walls, fences and the like, a level up or down anywhere, never
  // stopping on one of them.
  const climber = u.ztype === "climber";
  const passes = (x, y) => cellAt(b, x, y).walk || (climber && climbOver(u, b.cells[idx(x, y)].k));
  // A person vaults half cover (VAULT, vaultable): over it at vaultCost more (a closed window crashed through dearer
  // still), never stopping on it, and never round a corner of it (the corner rule below reads passes, not vaults).
  // One of the dead clambers through an open or broken window the same way (clambers, windows.js), and crawls over
  // half cover at CRAWL.COST (barricade.js crawlable: never a closed window).
  const vaulter = canVault(u), clamber = !vaulter && !climber && clambers(u);
  const vaults = (x, y) => { const c = b.cells[idx(x, y)]; return vaulter ? vaultable(b, c) : clamber && (windowOpen(c) || crawlable(b, c)); };
  const start = idx(u.x, u.y);
  d[start] = 0;
  real[start] = 0;
  const open = [start], reached = [start]; // reached: every cell the search got to (the others stay Infinity)
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (d[open[i]] < d[open[bi]]) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    const x = cur % W, y = (cur / W) | 0;
    for (const [dx, dy] of DIRS8) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny)) continue;
      const vault = !passes(nx, ny) && vaults(nx, ny);
      if (!passes(nx, ny) && !vault) continue;
      const diag = dx && dy;
      if (diag && (!passes(x + dx, y) || !passes(x, y + dy))) continue;
      const j = idx(nx, ny);
      if (occ[j] === 1) continue;
      if (foe && barredCell(b.cells[j]) && !doorOpens(b, u, b.cells[j]) && !(climber && climbOver(u, b.cells[j].k))) continue;
      if (avoid && avoid.has(j)) continue;
      const climb = climber ? Math.abs(hAt(b, nx, ny) - hAt(b, x, y)) + (cellAt(b, nx, ny).walk && !barredCell(b.cells[j]) ? 0 : MIDDEAD.CLIMBER.COST) : climbCost(b, x, y, nx, ny, diag, per);
      if (climb === Infinity) continue;
      const step = (diag ? 1.5 : 1) + climb + (vault ? overCost(b, u, b.cells[j]) : 0); // a vault, a clamber through a window, the dead's crawl (barricade.js)
      const nr = real[cur] + step, nd = aw ? d[cur] + step + aw[j] : nr;
      if (nr <= maxCost + 1e-6 && nd < d[j]) {
        if (d[j] === Infinity) { open.push(j); reached.push(j); }
        d[j] = nd;
        if (aw) real[j] = nr;
        prev[j] = cur;
      }
    }
  }
  // Downed bodies can be stepped over but not stood on; nor is half cover vaulted, a window gone through or a
  // Climber's wall stood on: no cell nobody can walk on ends a move. Only a cell reached can be anything but Infinity,
  // and the search's own arrays are this call's: real becomes the answer in place.
  for (const j of reached) if (occ[j] === 2 || (j !== start && !CELL[b.cells[j].k].walk) || (climber && barredCell(b.cells[j]))) real[j] = Infinity;
  return { dist: real, prev, reached };
}
// The cells a search reached (reachable's r.reached) in ascending index order: the order a scan of the whole map meets
// them, for the loops that draw a die per cell or keep the first of equals. Sorted once per search, kept on it.
const reachedInOrder = (r) => r.order || (r.order = Int32Array.from(r.reached).sort());

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
  const vaulter = !climber && canVault(walker); // a person: over half cover at vaultCost (vaultable)
  const clamber = !climber && !vaulter && (!walker || clambers(walker)); // the dead, or nobody in particular: through an open or broken window (windows.js)
  const crawl = clamber && !!walker; // one of the dead (not the field of nobody in particular): over half cover at CRAWL.COST (barricade.js)
  const key = `${siege ? 1 : 0}${climber ? "c" : ""}${vaulter ? "v" : ""}${clamber ? "t" : ""}${crawl ? "w" : ""}${per}|${burning ? [...burning].join(".") : ""}|${sources.map((s) => s[0] + s[1] * W).join(",")}`;
  const cache = fieldCache(b);
  const hit = cache.get(key);
  if (hit) return hit;
  const d = new Float32Array(W * H).fill(Infinity);
  if (cache.size >= 8) cache.delete(cache.keys().next().value);
  cache.set(key, d);
  const over = (x, y) => climber && climbOver(walker, b.cells[idx(x, y)].k);
  const vault = (x, y) => { const c = b.cells[idx(x, y)]; return vaulter ? vaultable(b, c) : clamber && (windowOpen(c) || (crawl && crawlable(b, c))); };
  const pass = (x, y) => { const c = b.cells[idx(x, y)]; return (CELL[c.k].walk || (siege && breakable(c)) || over(x, y) || vault(x, y)) && !(burning && burning.has(idx(x, y))); };
  const aw = walker ? acidWeights(b, walker) : null; // people go round a spitter's acid when they can (acid.js)
  const wallAt = (x, y) => inside(x, y) && b.cells[idx(x, y)].k === "palisade" && breakable(b.cells[idx(x, y)]);
  const hSiege = (bb, x, y) => (b.cells[idx(x, y)].k === "walkway" && DIRS4.some(([dx, dy]) => wallAt(x + dx, y + dy)) ? 0 : hAt(bb, x, y));
  // What each cell is for this walker, worked out once (the cells do not change while the field is made): passable,
  // walkable for the corner rule, its height (climbCost's h), a ladder or stairs, the cost of battering it. The same
  // sums as asking each cell again for each of its eight neighbours, which was most of a siege's enemy turn (sizetest).
  const N = W * H, h = climber ? hAt : siege ? hSiege : hAt;
  const okA = new Uint8Array(N), sideA = new Uint8Array(N), climbA = new Uint8Array(N), hA = new Float64Array(N), overA = new Float64Array(N), bashA = new Float64Array(N);
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
    const c = b.cells[i], ov = over(x, y), vl = !CELL[c.k].walk && vault(x, y);
    okA[i] = pass(x, y) ? 1 : 0;
    sideA[i] = cellAt(b, x, y).walk || ov ? 1 : 0; // a vaulted cell is no corner to cut either (as reachable)
    climbA[i] = climbAt(b, x, y) ? 1 : 0;
    hA[i] = h(b, x, y);
    overA[i] = ov ? MIDDEAD.CLIMBER.COST : vl ? (vaulter ? vaultCost(b, c) : windowOpen(c) ? VAULT.COST : CRAWL.COST) : 0; // a Climber's wall, a person's vault (a window crashed through dearer), the dead through a window, the dead's crawl over half cover
    bashA[i] = !ov && !vl && siege && (breakable(c) && (!CELL[c.k].walk || (barredCell(c) && !doorOpens(b, walker, c)))) ? SIEGE.COST + c.hp * SIEGE.PER_HP : 0;
  }
  // A binary heap of (distance, cell), stale entries skipped: the same field as scanning for the nearest open cell,
  // in a fraction of the time on the bigger maps (battlesize.js).
  const heap = new MinHeap();
  for (const [x, y] of sources) { d[idx(x, y)] = 0; heap.push(0, idx(x, y)); }
  while (heap.size) {
    const key = heap.topKey(), cur = heap.pop();
    if (key > d[cur]) continue;
    const x = cur % W, y = (cur / W) | 0;
    for (let k = 0; k < 8; k++) {
      const dx = DIRS8[k][0], dy = DIRS8[k][1], nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!okA[j]) continue;
      const diag = dx && dy;
      if (diag && (!sideA[cur + dx] || !sideA[cur + dy * W])) continue; // no corner cutting (as reachable)
      // climbCost (a Climber: the height either way, and its cost over a wall)
      const dh = Math.abs(hA[j] - hA[cur]);
      const climb = climber ? dh + overA[j] : !dh ? 0 : diag || !(climbA[cur] || climbA[j]) ? Infinity : dh * per;
      if (climb === Infinity) continue;
      const nd = d[cur] + (diag ? 1.5 : 1) + climb + (climber ? 0 : overA[j]) + bashA[j] + (aw ? aw[j] : 0); // aw: acid.js; overA here: a vault
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
// A bipod's rest (user request 2026-10-08): the cell next to the shooter at (x0, y0) that the shot's line to (x1, y1)
// crosses and that is half cover (CELL cover 1: sandbags, crates, a car, a fence, a window, a counter...) standing at
// least as high as the shooter (not a crate down below a walkway), or a full-cover wall people shoot over (cover 2 that
// does not block sight: the palisade from its walkway, a barricade; user pick G1) whose top, REST.WALL_RISE levels over
// its foot, reaches the shooter: the gun rests on it. [x, y] or null.
export const REST = { WALL_RISE: 1 };
export function restCell(b, x0, y0, x1, y1) {
  bindDims(b);
  if (!inside(x0, y0) || (x0 === x1 && y0 === y1)) return null;
  const dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 4), h0 = hAt(b, x0, y0);
  for (let i = 1; i < n; i++) {
    const cx = Math.floor(x0 + 0.5 + (dx * i) / n), cy = Math.floor(y0 + 0.5 + (dy * i) / n);
    if (Math.max(Math.abs(cx - x0), Math.abs(cy - y0)) > 1 || !inside(cx, cy)) break;
    if (cx === x0 && cy === y0) continue;
    const c = b.cells[idx(cx, cy)], C = CELL[c.k];
    if (C && C.cover === 1 && hAt(b, cx, cy) >= h0) return [cx, cy];
    if (C && C.cover === 2 && !C.los && !C.walk && hAt(b, cx, cy) + REST.WALL_RISE >= h0) return [cx, cy];
  }
  return null;
}
// Firing from a vehicle that moved this side's turn (driveTo and turnVehicle mark it: v.movedK; user request
// 2026-10-08): the one who drove or turned it this turn (a gunner who turned it from the turret, say) RIDE.DRIVER, the
// turret's gunner RIDE.TURRET (the ring mount steadies the gun), anyone else aboard RIDE.RIDER. Either side: whichever
// vehicle the shooter's side has (carOf: yours, or the raid's Humvee or a caravan's escort vehicle in b.raidHumvee,
// which raidCarTurn drives in and pulls back) the same. Overwatch shots in the other side's
// turn right after are the turret's too (user pick G2: the gunner's overwatch still sways, RIDE.TURRET); the turn
// after that, nothing. Today only the gunner can fire after a drive (driving takes both actions, riders sit inside);
// the rider and driver numbers are there for whatever lets them shoot.
export const RIDE = { DRIVER: 25, RIDER: 15, TURRET: 10 };
export function rideAim(b, a) {
  if (!b || !a || !(a.aboard || a.gunner)) return 0;
  const v = carOf(b, a);
  const k = strikeMark(b);
  if (!v || v.movedK == null) return 0;
  if (v.movedK === k - 1) return a.gunner ? -RIDE.TURRET : 0; // the other side's turn right after: the turret's overwatch
  if (v.movedK !== k) return 0;
  return -(a.droveK === k ? RIDE.DRIVER : a.gunner ? RIDE.TURRET : RIDE.RIDER);
}
// opts.parts (the battle HUD's hit breakdown, ui/battlehud.js): also returns parts, [[label, aim]] in the order they are
// added up, every step of the aim below that changed it; they sum to the aim before the 5–95 clamp. The numbers are
// the same with or without it (each step is the same addition, only noted).
export function shotOdds(b, a, t, ax = a.x, ay = a.y, opts = {}) {
  bindDims(b);
  const P = opts.parts ? [] : null;
  let last = 0;
  const mark = P ? (label) => { const v = aim - last; if (v) P.push([label, v]); last = aim; } : null; // called only with P
  const w = WEAPONS[a.weapon];
  const [tx, ty] = nearCell(t, ax, ay); // a 2 × 2 boss: its nearest cell
  const d = dist(ax, ay, tx, ty);
  const gm = unitMods(a); // gunmods.js: the gun's sight, muzzle, magazine and grip (neutral without any)
  const rg = gm === NO_MODS ? w : modRange(w, gm);
  const aty = calOf(a.weapon) ? typeFor(calOf(a.weapon), a.load) : null; // the load ("sp", a shotgun's "buck"; another calibre's "223:sp")
  const af = calOf(a.weapon) ? loadFx(a) : {}; // ammo.js: the loaded type (match, slugs, birdshot…; a common round: nothing), and a round of another calibre the gun takes (.223 in a 5.56 gun: its damage, +3 aim)
  const opt = rg.opt + (af.opt || 0), fall = rg.fall * (af.fallMult ?? 1);
  const notes = []; // what the moment adds or takes (the UI's odds line): a bipod rested, a moving vehicle, a light round's drop
  let aim = a.aim; // (step by step, as one sum: a.aim + w.aim + gm.aim + af.aim - nlAimPen - loadAim)
  P && mark("Aim (skill, traits, wounds)");
  aim += (w.aim || 0); P && mark("The weapon");
  aim += gm.aim; P && mark("Its attachments");
  aim += (af.aim || 0); P && mark("The round loaded");
  aim -= nlAimPen(a); P && mark("Tasered or pepper-sprayed"); // nonlethal.js: a taser's daze, pepper spray
  aim -= (a.loadAim || 0); P && mark("Handloads"); // reloading.js: handloads loaded below Mechanics 8
  if (handsBusy(a) && oneHandOk(a)) { aim -= CART_FIGHT.oneHandAim; P && mark("One-handed (a hand on the cart)"); } // carts.js: a pistol fired one-handed
  if (a.loadAim) notes.push(`handloads −${Math.round(a.loadAim)}`); // reloading.js
  if (d > opt && !a.noFall) aim -= (d - opt) * fall; // noFall: the Sniper perk (skills.js)
  P && mark(`Range (${Math.round(d)} tiles, best within ${Math.round(opt)})`);
  // An intermediate or rimfire round past its reach (gunmods.js ROUND_REACH): it drops, scope or not.
  const rr = roundReach(w), reach = rr ? rr.reach + (af.opt || 0) : Infinity;
  const slow = d > reach ? rr.dmg ?? 1 : 1; // and a hit there does less (it has slowed)
  if (d > reach) { const drop = (d - reach) * rr.drop; aim -= drop; notes.push(`round drops past ${reach} tiles −${Math.round(drop)}${slow !== 1 ? `, damage ×${slow}` : ""}`); }
  // Buckshot and birdshot spread with range (data-ammo.js spreadMult, user 2026-10-10): past spreadFull tiles a hit does
  // less, down to spreadMin; a slug keeps its damage. The same rule as ladder.js hitDamage (the balance sheet).
  const spread = spreadMult(aty, d, { cal: calOf(a.weapon), extra: gm.spread || 0 }); // gm.spread: a choke's tiles
  if (spread < 1) notes.push(`shot spreads past ${af.spreadFull + (gm.spread || 0)} tiles, damage ×${Math.round(spread * 100) / 100}`);
  P && mark("The round drops at this range");
  if (d <= 2.5 && (w.close || gm.close || af.close)) aim += (w.close || 0) + gm.close + (af.close || 0);
  P && mark("Up close");
  // A bipod (fitted, or built into the machine gun and the .50) counts only rested on half cover next to the shooter in
  // the shot's line (restCell); the AI's posts (scoreCell) score it the same way, so a bipod gunner seeks sandbags.
  const rest = (gm.brace || (w.heavy && w.heavy.brace)) && restCell(b, ax, ay, tx, ty) ? 1 : 0;
  if (rest) notes.push(`bipod rested +${Math.max(gm.brace || 0, (w.heavy && w.heavy.brace) || 0)}`);
  if (gm !== NO_MODS) aim += situationalAim(b, a, d, gm, !!rest); // gunmods.js: a bipod rested, a sling on the move, night sights and lights
  P && mark(rest ? "Bipod rested (attachments now)" : "Attachments now (moved, night)");
  const flat = t.surprised || (!t.aware && t.side === "enemy");
  const cov = t.kind === "zombie" || flat ? { level: 0, any: false, flanked: false } : t.gunner ? gunnerCover(b, t) : coverAgainst(b, tx, ty, ax, ay); // a turret's gunner: half cover (full behind plate x2)
  aim -= COVER_DEF[Math.max(0, cov.level - (w.pierce || 0) - (opts.pierce || 0))]; // pierce: a spitter's acid (zombietypes.js); opts.pierce: an over-penetrating round through light cover (gunfire.js)
  P && mark(cov.level === 2 ? "Target in full cover" : "Target in half cover");
  if (t.hunker && cov.level) aim -= HUNKER_DEF;
  P && mark("Target hunkered down");
  if (b.tact) aim += tactAim(b, a, t, ax, ay, cov, notes); // Tactical (traits.js): a flank, cover used well, an ally's eye
  P && mark("Tactical (a flank, cover used well, an ally near)");
  if (flat) aim += 15;
  P && mark("Target unaware or surprised");
  if (opts.reaction && !a.owSure) aim -= 15; // owSure: the Suppressor perk (skills.js)
  P && mark("Reaction shot");
  if (opts.volley) aim += 15; // caught before they could take cover
  P && mark("Volley");
  if (a.pinT === b.turn) aim -= TURRET.PIN; // pinned by a machine-gun burst (the turret)
  P && mark("Pinned by a machine gun");
  // gunfire.js: the fire mode (round k of a burst or a stream: opts.modeAim; else the first round of the unit's mode),
  // pinned by suppressing fire, a heavy weapon braced or fired on the move.
  if (!w.melee) aim += opts.modeAim ?? modeAim(modeOf(a), 0, w);
  P && mark(`Fire mode (${a.mode || "single"})`);
  if (a.suppressed) aim -= SUPPRESS.AIM;
  P && mark("Suppressed");
  aim += braceAim(b, a, !!rest);
  P && mark("Heavy weapon (braced or moved)");
  // Firing from a vehicle that moved this turn (rideAim): the driver, the turret's gunner, a rider.
  const ride = rideAim(b, a);
  if (ride) { aim += ride; notes.push(`vehicle moving ${ride}`); }
  P && mark("Firing from a moving vehicle");
  // A break-in map (deploy.js): the floodlit area, and shooting from a watchtower.
  if (b.lit && b.floodAim && inside(tx, ty) && b.lit[idx(tx, ty)]) aim += b.floodAim;
  P && mark("Target floodlit");
  // Smoke and flares (throwables.js): a shot into or out of a cloud, your people at a target in a flare's light at night.
  if (b.smoke && b.smoke.length && (smokeAt(b, tx, ty) || smokeAt(b, ax, ay))) aim -= SMOKE.aim;
  P && mark("Smoke");
  if (b.flares && b.flares.length && a.side === "player" && (b.night || b.dark) && flareLit(b, tx, ty)) aim += FLARE.aim;
  P && mark("Target lit by a flare");
  if (a.stun) aim -= a.stun.aim; // still seeing spots from a flashbang (throwables.js FLASH)
  P && mark("Stunned");
  // helmets.js: a visor down (fogged, cracked); hearing.js: a team headset's callout, dazed by a bang (each on the odds line)
  const visor = visorAim(a, b), link = linkAim(b, a, t), dazed = dazedAim(a);
  aim += visor + link - dazed;
  P && mark("Visor, headset, dazed");
  if (visor) notes.push(`visor ${visor > 0 ? "+" : ""}${Math.round(visor)}`);
  if (link) notes.push(`headset callout ${link > 0 ? "+" : ""}${Math.round(link)}`);
  if (dazed) notes.push(`dazed by a bang −${Math.round(dazed)}`);
  // Shooting down from higher ground (a walkway, a roof, a watchtower: verticality).
  const up = inside(ax, ay) ? hAt(b, ax, ay) - hAt(b, tx, ty) : 0;
  if (up > 0) aim += Math.min(HEIGHT.MAX_AIM, up * HEIGHT.AIM);
  P && mark("Higher ground");
  // Clinging to a siege ladder, or hauling a ram (siege.js): easy to hit.
  if (inside(tx, ty) && b.cells[idx(tx, ty)].k === "siegeladder") aim += CLIMB_AIM;
  else if (t.ram != null && b.rams && isCrew(b, t)) aim += CREW_AIM;
  P && mark("Target on a ladder or a ram");
  const chance = Math.max(5, Math.min(95, Math.round(aim)));
  const crit = opts.reaction ? 0 : (cov.level === 0 ? (t.kind === "zombie" ? CRIT.DEAD : CRIT.EXPOSED) : CRIT.COVER) + (a.critBonus || 0); // critBonus: Deadeye
  const ad = (af.dmg ?? 1) * slow * spread; // the loaded type's damage, buckshot's spread at range, a light round's past its reach (ROUND_REACH dmg) (hollow points' soft-target bonus: damage, ammo.js softMult)
  return { chance, crit, dmg: [Math.round(w.dmg[0] * a.dmgMult * gm.dmg * ad), Math.round(w.dmg[1] * a.dmgMult * gm.dmg * ad)], cover: cov.level, flanked: cov.flanked, exposed: !cov.any && t.kind !== "zombie", dist: d, height: up, notes, ...(P ? { parts: P, aim } : {}) };
}

// Tactical (traits.js, u.tact from playerUnit): a Tactical shooter's bonus on a flanked target, a Tactical target in
// cover harder to hit, and the best Tactical ally within TACT_RANGE tiles of the shooter (not themselves) adding to
// their aim. b.tact: someone on the field has it (else nothing is looked at). Each on the odds line.
function tactAim(b, a, t, ax, ay, cov, notes) {
  let v = 0;
  if (a.tact && cov.flanked) { v += a.tact.flank; if (notes) notes.push(`Tactical, a flank +${a.tact.flank}`); }
  if (t.tact && cov.level) { v -= t.tact.cover; if (notes) notes.push(`${t.short || "they"} use cover well (Tactical) −${t.tact.cover}`); }
  const ally = tactAura(b, a, ax, ay);
  if (ally) { v += ally; if (notes) notes.push(`a Tactical ally near +${ally}`); }
  return v;
}
// The best Tactical ally's bonus near (x, y) for a: on their side, up and about, on the same floor, within TACT_RANGE.
export function tactAura(b, a, x = a.x, y = a.y) {
  if (!b.tact) return 0;
  let best = 0;
  for (const o of b.units) {
    if (o === a || !o.tact || o.side !== a.side || !active(o) || (o.f || 0) !== (a.f || 0)) continue;
    if (Math.max(Math.abs(o.x - x), Math.abs(o.y - y)) <= TACT_RANGE) best = Math.max(best, o.tact.aura);
  }
  return best;
}

// opts.parts: also the breakdown (as shotOdds), [[label, aim]] summing to the aim before the 10–95 clamp.
export function meleeOdds(b, a, t, opts = {}) {
  bindDims(b);
  const w = WEAPONS[a.weapon];
  const up = hAt(b, t.x, t.y) > hAt(b, a.x, a.y) ? HEIGHT.MELEE_UP : 0; // striking up at someone on higher ground
  // a.meleeSk: the Melee skill's part of a.meleeAim (world.js MELEE_SKILL, playerUnit), its own step; tactAura: a Tactical ally
  // near (traits.js); a stun (a flashbang, a taser: throwables.js) and pepper spray (nonlethal.js): half their aim penalty
  // up close; Parry (skills.js)
  const steps = [["Base, nerve and traits", a.meleeAim - (a.meleeSk || 0)], ["Melee skill", a.meleeSk || 0], ["The weapon", w.meleeAim || 0], ["A Tactical ally near", tactAura(b, a)], ["Target hunkered down", -(t.hunker ? 10 : 0)], ["Striking up at higher ground", -up], ["Stunned", -(a.stun ? a.stun.aim / 2 : 0)], ["Tasered or pepper-sprayed", -nlAimPen(a) / 2], ["Target parries", -(t.parry || 0)]];
  let aim = 0;
  for (const [, v] of steps) aim += v; // the same sum, left to right
  const chance = Math.max(10, Math.min(95, Math.round(aim)));
  const parts = opts.parts ? steps.filter(([, v]) => v) : null;
  const base = w.melee ? w.dmg : BASH;
  // a.meleeDmg: the Melee skill (world.js MELEE_SKILL; your people and volunteers, playerUnit); Butcher on the dead (skills.js)
  const mult = (w.melee ? a.dmgMult : 1) * (a.meleeDmg || 1) * (a.butcher && t.kind === "zombie" ? a.butcher : 1);
  return { chance, crit: CRIT.MELEE + (a.bonebreaker ? 10 : 0), dmg: [Math.round(base[0] * mult), Math.round(base[1] * mult)], cover: 0, flanked: false, dist: 1, ...(parts ? { parts, aim } : {}) }; // Bonebreaker: +10 crit
}

export const isRanged = (u) => !WEAPONS[u.weapon].melee;
export const adjacent = (a, t) => { const [tx, ty] = nearCell(t, a.x, a.y), [ax, ay] = nearCell(a, tx, ty); return Math.max(Math.abs(ax - tx), Math.abs(ay - ty)) === 1; };
// A blow struck diagonally past a corner: blocked when both cells between the two (the orthogonal pair) are walls or
// closed doors (MELEE_SOLID; a gate or door only while barred or locked). Low cover (crates, sandbags) does not block it.
export const MELEE_SOLID = new Set(["wall", "palisade", "door", "idoor", "bdoor", "boarded", "hivewall", "window", "bars", "fence", "rack", "locker", "tree", "boulder", "truck", "void"]);
const solidForMelee = (b, x, y) => {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return true;
  const c = b.cells[y * b.w + x];
  return !!c && (MELEE_SOLID.has(c.k) || (c.k === "gate" && barredCell(c)));
};
export const cornerBlocked = (b, ax, ay, tx, ty) => ax !== tx && ay !== ty && !!b && !!b.cells && solidForMelee(b, tx, ay) && solidForMelee(b, ax, ty);
// Next to each other for a blow: adjacent, and not across a wall's corner.
export const meleeReach = (b, a, t) => { if (!adjacent(a, t)) return false; const [tx, ty] = nearCell(t, a.x, a.y), [ax, ay] = nearCell(a, tx, ty); return !cornerBlocked(b, ax, ay, tx, ty); };
// ---------- melee: reach, quick strikes, stagger, bleeding, thrown spears (weapons overhaul section 4) ----------
// WEAPONS fields (data-guns.js): reach 2 = strikes 2 tiles off in a straight line (orthogonal or diagonal) with a clear
// line and nobody standing between; quick = a strike costs 1 action, one strike a turn (strike and step away);
// stagger = chance a hit (twice on a critical) costs the target an action on its next turn (not brutes, wall-breakers,
// brood mothers or bosses); bleed = chance a hit on a living person bleeds them MELEE.BLEED at the start of each of their
// next MELEE.BLEED_TURNS turns (armour does not help); throw = tiles a spear is thrown ("throwspear": throwables.js aim
// and scatter, the spear's melee damage on whoever is where it lands; it lies there (b.spears) and the thrower fights
// with a pistol from a pocket or the off hand, or bare hands, until they walk onto it or pick it up next to it, 1
// action; after a won fight it is picked up, after a loss it is gone). Stagger and bleed roll on dice of their own
// (hash01 of the battle's rng position), so no other roll in the battle changes. Zealots throw spears too (KITS
// spearThrow).
export const MELEE = { BLEED: 5, BLEED_TURNS: 2, SPEAR_SCATTER: -10, SPEAR_AI: 0.6, SPEAR_AI_MIN: 3 };
const STAGGER_IMMUNE = new Set(["brute", "wallbreaker", "broodmother"]);
// Can u strike t from where it stands (next to it, or 2 tiles off with a reach weapon)?
// Not across a wall's corner either way (cornerBlocked: dev's rescue branch): a diagonal blow past a corner, or a
// spear's reach-2 thrust with a corner at either step, is blocked like any blow; walls in its line block it (los).
export function inMelee(b, u, t) {
  const [tx, ty] = nearCell(t, u.x, u.y), [ux, uy] = nearCell(u, tx, ty); // the nearest cells of each (a 2 × 2 boss)
  const dx = tx - ux, dy = ty - uy, d = Math.max(Math.abs(dx), Math.abs(dy));
  if (d === 1) return !cornerBlocked(b, ux, uy, tx, ty);
  const w = WEAPONS[u.weapon];
  if (d !== 2 || !w || !(w.reach >= 2) || dx % 2 || dy % 2) return false;
  const mx = ux + dx / 2, my = uy + dy / 2;
  const mid = unitAt(b, mx, my);
  if (mid && active(mid)) return false;
  if (cornerBlocked(b, ux, uy, mx, my) || cornerBlocked(b, mx, my, tx, ty)) return false;
  return los(b, ux, uy, tx, ty);
}
const strikeMark = (b) => (b.turn || 0) * 2 + (b.phase === "player" ? 0 : 1);
export const struckThisTurn = (b, u) => u.struck === strikeMark(b);
// Why u cannot strike t ("" when it can).
export function meleeRefusal(b, u, t) {
  const w = WEAPONS[u.weapon];
  if (t && t.side !== "player" && active(t) && adjacent(u, t) && !meleeReach(b, u, t)) return "A wall's corner is in the way: step round it first.";
  if (!t || t.side === "player" || !active(t) || !inMelee(b, u, t)) return w && w.reach >= 2 ? "Must be next to the target, or 2 tiles off in a straight line with nobody between." : "Must be next to the target.";
  if (w && w.quick && struckThisTurn(b, u)) return "One strike a turn with a quick weapon: step away, or end the turn.";
  return "";
}
// What a melee hit does besides damage: a stagger, a bleeding wound. Returns words for the log line.
function meleeAfter(b, a, t, w, crit) {
  if (!w || !w.melee || !active(t)) return "";
  let out = "";
  const seed = b.rng.state;
  const immune = t.boss || STAGGER_IMMUNE.has(t.ztype) || STAGGER_IMMUNE.has(t.variant) || STAGGER_IMMUNE.has(t.zkind);
  const stag = (w.stagger || 0) + (a.heavyHands || 0); // Heavy Hands (skills.js): a chance with any weapon
  if (!immune && ((crit && a.bonebreaker) || (stag > 0 && hash01(seed, "stagger", a.id, t.id) < Math.min(1, stag * (crit ? 2 : 1))))) { t.staggered = 1; out += " Staggered."; } // Bonebreaker: a critical always staggers
  if (w.bleed && t.kind === "human" && hash01(seed, "bleed", a.id, t.id) < w.bleed) { t.bleeding = MELEE.BLEED_TURNS; out += " Bleeding."; }
  return out;
}
// The start of a side's turn: the staggered lose an action (the downed: nothing), the bleeding bleed (the downed: their
// bleed-out comes a turn closer). sides: the sides whose turn it is.
function meleeRound(b, sides) {
  for (const u of b.units) {
    if (!sides.includes(u.side)) continue;
    if (u.staggered) {
      if (active(u) && u.ap > 0) { u.ap -= 1; say(b, `${u.name} is still reeling from the blow (one action this turn).`, u.side === "player" ? "danger" : "good"); }
      u.staggered = 0;
    }
    if (u.bleeding > 0) {
      u.bleeding--;
      // Down (medics.js: bleeding out on its own count, u.bleed): the wound brings that count a turn closer instead
      // (never past the last turn: the bleed-out itself is medics.js's); stabilized, or dead, gone: it stops.
      if (u.down && !u.dead && !u.stab && !u.ko && !u.surr) { if (u.bleed > 1) u.bleed -= 1; continue; }
      if (!active(u)) { u.bleeding = 0; continue; }
      const eff = Math.round(damage(b, u, MELEE.BLEED / (hitMult(u, null, { how: "bleed" }) || 1), null, false, { how: "bleed" }));
      say(b, `${u.name} bleeds (${eff})${u.dead ? " and dies" : u.down ? " and goes down" : ""}.`, u.side === "player" ? "danger" : "good");
    }
  }
  spearBodies(b);
}

// A survivor's weapon-dependent numbers for an item in the hands (playerUnit's): null or unusable = fists.
export function heldTerms(s, item) {
  const eff = gearEffect(s, item);
  const key = item && eff.usable && WEAPONS[item.key] ? item.key : "fists";
  const mult = key === "fists" ? 1 : eff.mult;
  const q = item && key !== "fists" ? item.quality || 1 : 1;
  return { key, item: key === "fists" ? null : item, aim: -(1 - mult) * 30, dmg: (0.6 + 0.4 * mult) * (0.75 + 0.25 * q), risk: key === "fists" ? 0 : eff.damageChance };
}
// A gun to draw when the spear is gone: one in the off hand or a pocket that the survivor can use.
export const sidearmOf = (s) => (s ? [s.gear && s.gear.tool, ...(s.pockets || [])].find((it) => it && WEAPONS[it.key] && !WEAPONS[it.key].melee && !WEAPONS[it.key].launcher && !WEAPONS[it.key].mount && gearEffect(s, it).usable) || null : null);
// The spear has left u's hands: a sidearm (yours) or bare hands. s: the survivor (your people), else null.
function unarm(b, u, s) {
  const was = { key: u.weapon, name: u.weaponName, gm: u.gm, gmWeapon: u.gmWeapon, item: u.item, gearRisk: u.gearRisk, aimD: 0, dmgF: 1 };
  const side = s ? sidearmOf(s) : null;
  if (s) {
    const from = heldTerms(s, u.item), to = heldTerms(s, side);
    was.aimD = to.aim - from.aim; was.dmgF = to.dmg / (from.dmg || 1);
    u.aim += was.aimD; u.dmgMult *= was.dmgF;
    u.weapon = to.key; u.item = to.item; u.gearRisk = to.risk;
  } else { u.weapon = "fists"; if (u.item !== undefined) u.item = null; }
  u.weaponName = u.weapon === "fists" ? "Fists" : modLabel(side);
  u.gm = u.weapon === "fists" ? NO_MODS : gunMods(side); u.gmWeapon = u.weapon;
  if (u.weapon !== "fists") loadMag(u); // a pistol carried loaded
  u.spearOut = was;
  if (u.side === "player") say(b, u.weapon === "fists" ? `${u.name} fights bare-handed until the spear is back.` : `${u.name} draws the ${u.weaponName}.`, "info");
}
// u has its spear back (sp: the one on the ground, or null).
function rearm(b, u, sp, quiet = false) {
  const o = u.spearOut;
  if (!o) return;
  u.aim -= o.aimD || 0; u.dmgMult /= o.dmgF || 1;
  u.weapon = o.key; u.weaponName = o.name; u.gm = o.gm; u.gmWeapon = o.gmWeapon; u.item = o.item; u.gearRisk = o.gearRisk;
  delete u.spearOut;
  if (sp && b.spears) b.spears = b.spears.filter((x) => x !== sp);
  if (!quiet) say(b, `${u.name} picks up the ${(sp ? sp.name : WEAPONS[o.key].name).toLowerCase()}.`, "info");
}
const ownSpear = (b, u) => (b.spears || []).find((x) => x.owner === u.id) || null;
// Walking onto the cell where your spear lies picks it up (moveAlong).
function stepOnSpear(b, u) {
  const sp = ownSpear(b, u);
  if (sp && sp.x === u.x && sp.y === u.y && (sp.f || 0) === (u.f || 0)) rearm(b, u, sp);
}
// Why u cannot pick up its spear for an action now ("" when it can).
export function pickSpearRefusal(b, u) {
  const sp = u.spearOut ? ownSpear(b, u) : null;
  if (!sp) return "No spear of theirs lies on the ground.";
  if ((sp.f || 0) !== (u.f || 0) || Math.max(Math.abs(sp.x - u.x), Math.abs(sp.y - u.y)) > 1) return "Walk onto the spear (or next to it) to pick it up.";
  return "";
}
// Why u cannot throw its spear at (x, y) ("" when it can).
export function spearThrowRefusal(b, u, x, y) {
  const w = WEAPONS[u.weapon];
  if (!w || !w.throw) return "Only a spear can be thrown.";
  if (!inside(x, y)) return "Throw it where?";
  if (Math.max(Math.abs(x - u.x), Math.abs(y - u.y)) < 2) return "Too close to throw: strike instead.";
  if (dist(u.x, u.y, x, y) > w.throw + 0.01) return `Too far: a ${w.name.toLowerCase()} carries ${w.throw} tiles.`;
  if (!cellAt(b, x, y).walk) return "Throw it at open ground or at someone.";
  if (!canSeeAt(b, u, x, y)) return "No line of sight.";
  return "";
}
// The throw (allowed: spearThrowRefusal; the action is the caller's). s: the survivor (your people), else null.
export function throwSpear(b, u, x, y, s = null) {
  const key = u.weapon, w = WEAPONS[key], rng = b.rng;
  faceToward(u, x, y);
  u.hunker = false;
  let [lx, ly, off] = throwLanding(b, u, { scatter: MELEE.SPEAR_SCATTER }, x, y, false);
  let glance = false;
  if (off && !(inside(lx, ly) && cellAt(b, lx, ly).walk && los(b, u.x, u.y, lx, ly))) { lx = x; ly = y; glance = true; } // off into a wall: it clatters down short
  const t = glance ? null : unitAt(b, lx, ly);
  fx(b, { type: "throw", from: [u.x, u.y], to: [lx, ly], item: key });
  const line = sayFirst(b);
  if (t && t !== u && active(t)) {
    const o = meleeOdds(b, u, t);
    const crit = rng.chance(o.crit / 100);
    const eff = Math.round(damage(b, t, rng.int(o.dmg[0], o.dmg[1]) * (crit ? CRIT_MULT : 1) * (u.meleeMult || 1), u, false, { how: "melee", crit, thrown: true, mclass: w.mclass || "pierce" }));
    if (u.xpT) { u.xpT.melee++; if (t.dead) u.xpT.mkills++; } // skills.js: Melee XP when the battle ends
    line.text = `${u.name} throws the ${w.name.toLowerCase()}${off ? " (it flies wide)" : ""}: ${crit ? "critical hit on" : "it hits"} ${t.name} for ${eff}.${meleeAfter(b, u, t, w, crit)}`;
    line.k = u.side === "player" ? (t.side === "player" ? "danger" : "good") : "danger";
    fx(b, { type: "melee", from: [u.x, u.y], to: [t.x, t.y], hit: true, crit, dmg: eff, side: u.side });
    if (t.side === "enemy" && !t.dead && !t.aware && !crossHit(b, u, t)) alertPod(b, t.pod, `${t.name} cries out!`); // crossfire.js
  } else line.text = `${u.name} throws the ${w.name.toLowerCase()}${off || glance ? " and it flies wide" : ""}: a miss.`;
  (b.spears || (b.spears = [])).push({ id: b.nextId++, x: lx, y: ly, f: u.f || 0, key, owner: u.id, side: u.side, name: w.name });
  unarm(b, u, s);
}
// The enemy AI: a zealot with a spear and a foe 3–5 tiles off in sight (nobody in reach) throws it now and then.
function aiThrowSpear(b, u, foes) {
  const w = WEAPONS[u.weapon];
  if (!w || !w.throw || u.side !== "enemy" || !(KITS[u.kit] && KITS[u.kit].spearThrow) || u.ap < 1) return false;
  if (foes.some((f) => inMelee(b, u, f))) return false;
  const cands = foes.filter((f) => dist(u.x, u.y, f.x, f.y) >= MELEE.SPEAR_AI_MIN && !spearThrowRefusal(b, u, f.x, f.y) && canSee(b, u, f)).sort((a, c) => a.hp - c.hp);
  if (!cands.length || hash01(b.rng.state, "spearthrow", u.id, b.turn) >= MELEE.SPEAR_AI) return false;
  throwSpear(b, u, cands[0].x, cands[0].y, null);
  u.ap -= 1;
  return true;
}
// The AI without its spear: back to it when it lies within a move and nobody is in reach. true: it acted.
function aiFetchSpear(b, u, foes) {
  const sp = u.spearOut ? ownSpear(b, u) : null;
  if (!sp || u.ap < 1 || (sp.f || 0) !== (u.f || 0) || foes.some((f) => inMelee(b, u, f))) return false;
  if (!pickSpearRefusal(b, u)) { u.ap -= 1; rearm(b, u, sp); return true; }
  const r = reachable(b, u, u.mob);
  const c = r.dist[idx(sp.x, sp.y)];
  if (!isFinite(c) || c === 0) return false;
  u.ap -= 1;
  moveAlong(b, u, pathTo(r, sp.x, sp.y));
  return true;
}
// The end of a fight: your spears come back after a win and are lost otherwise (taken off the survivor); an enemy's
// goes back on them, so it is on their body. won: the field is yours.
function settleSpears(state, b, won, lines) {
  if (!b.spears || !b.spears.length) return;
  for (const sp of b.spears.slice()) {
    const u = unitById(b, sp.owner);
    if (!u) continue;
    if (u.side !== "player" || won) { rearm(b, u, sp, true); continue; }
    const s = survivorById(state, u.sid);
    if (s && s.alive && s.gear && s.gear.weapon && s.gear.weapon.key === sp.key) { s.gear.weapon = null; lines.push(`${u.name}'s ${sp.name.toLowerCase()} was left where it fell.`); }
  }
  b.spears = [];
}
// A raid: an enemy killed with its spear on the ground: the spear counts among the things on its body.
function spearBodies(b) {
  if (!b.raid || !b.spears || !b.spears.length) return;
  for (const sp of b.spears.slice()) {
    const o = sp.side !== "player" ? unitById(b, sp.owner) : null;
    if (!o || !o.dead) continue;
    const box = b.raid.containers.find((c) => c.kind === "body" && c.uid === o.id);
    if (box && !box.searched && (!box.weapon || box.weapon === "fists")) { box.weapon = sp.key; rearm(b, o, sp, true); }
  }
}
// ---------- magazines ----------
// A gun holds WEAPONS[k].cap rounds (gunmods.js: a fitted magazine changes that); each shot takes w.ammo of them and
// a gun fires only with that many loaded. Reload (1 action) fills it; the bows, crossbows, melee weapons and a
// spitter's acid have no magazine. Guns start a battle loaded.
// Ammo accounting, your side: the team's pools stay the one count of rounds. A shot still takes its rounds from the
// pools when it is fired (b.ammoUsed, finishCombat, the raid's pools, autoResolveCombat and saves see exactly what they
// did before magazines), and u.mag is only a counter of what is loaded: nothing moves pool → magazine at a reload,
// so nothing has to go back when the battle ends. A loaded round counts (is shown, can be fired) only while the pool
// still has it (magShown = min(mag, pool)), and a reload fills the magazine only as far as the pool goes. Every other
// side's guns have endless reserve ammo, as before: only the magazine limits them.
// u.magW: the weapon the magazine belongs to. A unit whose u.weapon was set some other way (an old save, a weapon handed
// out after enemyUnit) counts as fully loaded until its magazine is next touched (loadMag).
const magItem = (u) => (u.item ? gunMods(u.item) : u.gm && u.gmWeapon === u.weapon ? u.gm : NO_MODS); // an enemy's fitted parts (enemyUnit u.gm): a drum on their gun too
export const hasMag = (u) => !!(WEAPONS[u.weapon] && WEAPONS[u.weapon].cap > 0);
export function magCap(u) {
  if (!hasMag(u)) return 0;
  const g = gunEntry(u); // mags.js: the magazine in the gun now (a spare of another size after a reload)
  if (g) return g.cap;
  const m = magItem(u);
  const fit = fittedMag(u.item || u.arsItem || (u.modItems && u.gmWeapon === u.weapon ? { mods: u.modItems } : null)); // a magazine item fitted: its rounds (data-kit.js)
  return Math.max(1, Math.round((fit ? MAG_CAP(fit.key) : WEAPONS[u.weapon].cap) * (m.capMult ?? 1)) + (m.cap || 0));
}
const MAG_CAP = (k) => (GEAR[k] && GEAR[k].mag ? GEAR[k].mag.cap : 1);
// Actions a Reload takes now (mags.js: a magazine or rounds from a pouch or a pocket 1, from the pack 2, a top-up from a
// teammate's rounds or the team's bags 2, an internal magazine's Reload from any of those 2; 1 for a unit with no magazines tracked).
export const reloadCost = (b, u, type = null) => (tracksMags(u) ? reloadPlan(b, u, type).cost : 1);
export const magMaxOf = (u) => (u.magW === u.weapon && u.magMax != null ? u.magMax : magCap(u));
export const magIn = (u) => (u.magW === u.weapon && u.mag != null ? u.mag : magCap(u));
// Set the magazine (n rounds, clamped; full when n is null) for the weapon the unit holds now.
export function loadMag(u, n = null) {
  u.magW = u.weapon;
  u.magMax = magCap(u);
  u.mag = n == null ? u.magMax : Math.max(0, Math.min(u.magMax, n));
  if (isStacked(u)) { // physical rounds (mags.js): the counter is the stack; fewer asked for come off the top (spent), more cannot be conjured
    const have = stackN(u.stack);
    if (u.mag < have) takeTop(u.stack, have - u.mag);
    u.mag = Math.min(u.magMax, stackN(u.stack));
    syncMags(u);
  }
}
// The rounds loaded as the player sees them: never more than the team's rounds of that calibre and type.
export const magShown = (b, u) => (u.side === "player" && !isStacked(u) ? Math.min(magIn(u), roundsOf(b, u)) : magIn(u)); // physical rounds (mags.js): the gun's own
// A gun whose magazine has too few rounds for a shot (whatever the team's ammo). A turret's belt (100 or 200, 3 a
// burst) fires its last burst with whatever is left: empty only at none (fire: the burst is the rounds there are).
const shotRounds = (w) => (w.mounted ? 1 : w.ammo);
export const magEmpty = (b, u) => hasMag(u) && magIn(u) < shotRounds(WEAPONS[u.weapon]);
// "9mm pistol 7/15" (nothing for a weapon with no magazine).
export const magLabel = (b, u) => (hasMag(u) ? `${magShown(b, u)}/${magMaxOf(u)}` : "");
const gunWord = (u) => { const n = u.weaponName || WEAPONS[u.weapon].name; return /^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n; };
// Why this unit cannot reload now ("" when it can). type: an ammo type of the gun's calibre to load instead (the
// Reload act's act.ammo, ammo.js): a switch reloads even a full magazine.
export function reloadRefusal(b, u, type = null) {
  if (!isRanged(u)) return "No gun to reload.";
  if (!hasMag(u)) return `The ${gunWord(u)} needs no reloading.`;
  if (handsBusy(u)) return handsWord(u); // carry.js
  if (u.carrying != null) return "Hands full: put the body down first.";
  const cal = calOf(u.weapon);
  const ammo = typeof type === "string" ? type : null; // (a pick object: mags.js reloadPlan checks it)
  if (ammo && (!cal || typeFor(cal, ammo) !== ammo)) return `The ${gunWord(u)} takes no such rounds.`;
  if (ammo && loadRefusal(u.weapon, ammo)) return loadRefusal(u.weapon, ammo); // ammo.js: a calibre its chamber refuses (.300 BLK in a 5.56 gun)
  const sw = !!(ammo && typeFor(cal, ammo) !== typeFor(cal, u.load));
  const m = magIn(u), max = magMaxOf(u);
  if (isStacked(u)) { // physical rounds (mags.js): the plan says what can go in and from where
    const p = reloadPlan(b, u, type);
    if (p.why) return p.why;
    if (u.ap > 0 && u.ap < p.cost) {
      if (p.mode === "swap" || p.mode === "clip") return `The ${p.mode === "clip" ? "clip" : "spare magazine"} is in the pack: ${p.cost} actions.`;
      return isShellGun(u) ? "The shells are in the pack: both actions to reload from the pack (the Inventory window moves a box to a pocket for 1)." : "The rounds are in the pack: both actions to reload from the pack (the Inventory window moves a box to a pocket for 1)."; // mags.js SOURCE_AP
    }
    return "";
  }
  if (!sw && m >= max) return `The ${gunWord(u)} is full (${max}/${max}).`;
  if (tracksMags(u)) { // mags.js: a spare, a top-up, an internal magazine
    const p = reloadPlan(b, u, ammo);
    if (p.why) return p.why;
    if (u.ap > 0 && u.ap < p.cost) {
      if (p.from === "pack" && p.mode !== "swap" && p.mode !== "clip") return isShellGun(u) ? "The shells are in the pack: both actions to reload from the pack (or Get shells, 1 action, brings a handful to hand)." : "The rounds are in the pack: both actions to reload from the pack."; // mags.js SOURCE_AP
      return p.mode === "topup" ? `No loaded spare magazine: a top-up takes ${p.cost} actions (from ${p.from === "mate" ? "a teammate's rounds" : "the team's ammo"}).` : `The ${p.mode === "clip" ? "clip" : "spare magazine"} is in the pack: ${p.cost} actions.`;
    }
    return "";
  }
  if (u.side === "player") {
    const pool = roundsOf(b, u, sw ? type : undefined);
    const what = cal ? roundName(cal, sw ? type : u.load) : "ammo";
    if (pool < 1) return `No ammo left to load (no ${what}).`;
    if (!sw && pool <= m) return `No spare ammo (${what}): every round left is already loaded.`;
  }
  return "";
}
// The type an empty or spent gun is best reloaded with: its loaded type while there are rounds of it, else the best
// other type of its calibre to hand (ammo.js pickLoad against these foes), or null when nothing can be loaded.
export function reloadType(b, u, foes = []) {
  if (!reloadRefusal(b, u)) return typeFor(calOf(u.weapon), u.load);
  const t = calOf(u.weapon) && u.side === "player" ? pickLoad(b, u, foes) : null;
  return t && t !== typeFor(calOf(u.weapon), u.load) && !reloadRefusal(b, u, t) ? t : null;
}
// Reload: 1 action, the magazine full (your side: as far as the team's rounds of that type go). type: load another
// type of the calibre (act.ammo): u.load becomes it and the magazine is filled with it (rounds are counted only when
// fired, so nothing goes back). Check reloadRefusal(b, u, type) first.
export function reload(b, u, type = null) {
  if (tracksMags(u)) { // mags.js: the next loaded magazine (1 action from a pouch or a pocket, 2 from the pack), else rounds by hand (type: a round, a { mag }, a { clip } or { rounds } pick)
    const p = reloadPlan(b, u, type);
    if (p.why && isStacked(u)) { say(b, p.why, "info"); return; } // (combatAct checks reloadRefusal first; a direct caller spends nothing on a refused plan)
    const line = doReload(b, u, p);
    u.ap = Math.max(0, u.ap - p.cost);
    u.hunker = false;
    say(b, line, "info");
    return;
  }
  const cal = calOf(u.weapon);
  if (typeof type !== "string") type = null;
  const sw = !!(type && cal && typeFor(cal, type) !== typeFor(cal, u.load));
  if (sw) u.load = typeFor(cal, type);
  const max = magMaxOf(u);
  loadMag(u, u.side === "player" ? Math.min(max, roundsOf(b, u)) : max);
  u.ap -= 1;
  u.hunker = false;
  say(b, sw && u.side === "player" ? `${u.name} loads the ${gunWord(u)} with ${roundName(cal, u.load)} (${magShown(b, u)}/${u.magMax}).` : `${u.name} reloads the ${gunWord(u)} (${magShown(b, u)}/${u.magMax}).`, "info");
}
// Rounds out of the gun for a shot (fire, a double tap): the magazine, and your side's rounds of its calibre and type.
function spendRounds(b, u, w) {
  if (hasMag(u) && !isStacked(u)) loadMag(u, magIn(u) - w.ammo); // (physical rounds: spendShot takes them off the gun's stack and counts them, ammo.js takeBattleRounds)
  if (u.side === "player") spendShot(b, w, u); // rounds of its calibre and loaded type (a turret's belt: .50 BMG or 5.56, turretRounds), or a bow's arrow
}
// Can this unit fire its gun right now (ranged weapon, loaded and, for the player, the rounds of its calibre and
// loaded type there; a bow or crossbow, arrows)? One that cannot fights in melee (a gun or a bow swung as a club: BASH).
export const canFire = (b, u) => isRanged(u) && !(u.cd > 0) && !(u.ram != null && b.rams && isCrew(b, u)) && u.carrying == null && u.dragging == null && (!handsBusy(u) || oneHandOk(u)) && (u.side !== "player" || hasShot(b, WEAPONS[u.weapon], u)) && !magEmpty(b, u) && !u.jam; // a ram's crew has its hands full (siege.js); so does someone carrying a body (carriers.js) or dragging a downed ally (medics.js); a jammed gun (gunfire.js)
// A gun that can shoot now or after a reload (the AI's sense of a side's firepower, the threat preview): a reload of
// its type, or of another type of its calibre when its own has run out.
export const hasShots = (b, u) => canFire(b, u) || (isRanged(u) && (magEmpty(b, u) || (u.side === "player" && !!WEAPONS[u.weapon].ammo && !hasShot(b, WEAPONS[u.weapon], u))) && reloadType(b, u) != null && !(u.cd > 0) && !(u.ram != null && b.rams && isCrew(b, u)));
// Why this unit cannot shoot ("" when it can): empty, out of ammo, no gun.
export function fireRefusal(b, u) {
  if (!isRanged(u)) return "No gun.";
  if (canFire(b, u)) return "";
  if (u.jam) return jamRefusal(u); // gunfire.js: "Jammed (stovepipe): Unjam (J), 1 action."
  if (handsBusy(u)) return handsWord(u); // carry.js
  if (u.carrying != null) return "Hands full: put the body down first.";
  if (u.dragging != null) return "Hands full: dragging someone (put them down first, Shift+D).";
  if (u.side === "player" && !hasShot(b, WEAPONS[u.weapon], u)) {
    const cal = calOf(u.weapon);
    if (WEAPONS[u.weapon].arrows) return "Out of arrows.";
    if (!cal) return "Out of ammo.";
    if (isStacked(u)) { const why = reloadRefusal(b, u); return why ? `Out of ammo: the ${gunWord(u)} is empty and ${why[0].toLowerCase()}${why.slice(1)}` : `The ${gunWord(u)} is empty: reload first (I).`; } // physical rounds (mags.js): nothing in the gun
    return roundsOf(b, u, "*") > 0 ? `Out of ${roundName(cal, u.load)}: reload with another type (1 action).` : `Out of ammo (no ${calName(cal)} rounds).`;
  }
  if (magEmpty(b, u)) return `The ${gunWord(u)} is empty: reload first (1 action).`;
  return "Cannot shoot right now.";
}
// Enemies the player side can currently see.
export function playerSees(b, t) {
  bindDims(b);
  if (t.off || (b.floors && (t.f || 0) !== (b.floor || 0))) return false; // another storey: out of sight whatever the x, y
  return b.units.some((u) => u.side === "player" && active(u) && (canSee(b, u, t) || adjacent(u, t))) || (!!b.peeks && peekSees(b, t.x, t.y));
}

// ---------- fog of war ----------
// Every cell your people can see now (1) or not (0): the union of what each one standing sees (canSeeAt: sight by
// height, night, light, night vision, optics; walls and buildings block it). Everything after the battle is over.
// Each eye asks only the cells within its furthest sight (sightBound), the eyes in order, a cell an earlier one sees not
// asked again: the same cells seen, and the same lines of sight asked, as asking every eye of every cell.
export function playerVision(b) {
  bindDims(b);
  const vis = new Uint8Array(W * H).fill(b.over ? 1 : 0);
  if (b.over) return vis;
  const eyes = b.units.filter((u) => u.side === "player" && active(u));
  for (const e of eyes) {
    const r = Math.ceil(sightBound(b, e)) + 1, R = r >= 0 ? r : Infinity; // NaN: the whole map
    const x0 = Math.max(0, e.x - R), x1 = Math.min(W - 1, e.x + R), y0 = Math.max(0, e.y - R), y1 = Math.min(H - 1, e.y + R);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!vis[y * W + x] && ((e.x === x && e.y === y) || canSeeAt(b, e, x, y))) vis[y * W + x] = 1;
  }
  if (b.peeks) for (let i = 0; i < W * H; i++) if (!vis[i] && peekSees(b, i % W, (i / W) | 0)) vis[i] = 2; // a peek through a door this turn (buildingmaps.js)
  return vis;
}
// The furthest a player's eye e can see a cell (canSeeAt is false past it): the longest of every reach canSeeAt and
// indoorSees can use, from the same terms: its range (height, optics, a visor); a lit room at night, its daylight
// range; a dark room with night vision, its daylight sight; the night cones, a beam and a lamp's pool (vision.js
// nightEyes: a dark room's are no longer); a cell lit by a flare or a floodlight, SIGHT from where it stands.
function sightBound(b, e) {
  const range = sightRange(b, e), extra = range - e.sight, hh = HEIGHT.SIGHT * hAt(b, e.x, e.y);
  const ne = nightEyes(b, e, extra);
  let r = Math.max(range, (e.daySight ?? SIGHT) + hh + (e.optic || 0) + (e.vsight || 0), (e.daySight ?? e.sight) + extra, SIGHT + hh + (e.optic || 0), ne.near);
  for (const c of ne.cones) r = Math.max(r, c.r);
  return r;
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
export const playerSeesCell = (b, x, y) => b.units.some((u) => u.side === "player" && active(u) && canSeeAt(b, u, x, y));
// The ghosts to draw: enemies not seen now with a last-seen spot.
export function enemyGhosts(b) {
  if (!b.ghosts) return [];
  const out = [];
  for (const e of b.units) {
    const g = b.ghosts[e.id];
    if (!g || e.side !== "enemy" || e.dead || e.left || e.fled || e.off || playerSees(b, e)) continue;
    if (b.floors && (g[3] || 0) !== (b.floor || 0)) continue; // last seen on another floor: not drawn on this one
    out.push({ id: e.id, x: g[0], y: g[1], turn: g[2], f: g[3] || 0, kind: e.kind, name: e.name, unit: e, heard: !!g[4] }); // heard: heard, not seen (hearing.js heardGhosts)
  }
  return out;
}

// ---------- units ----------
// Medicine bonus from the off-hand kit in battle: the one rule shared with treating at a base and in the field
// (crafting.medKitBonus: bandage kit +2, surgical kit +4 scaled by the usual skill-gap rule, nothing when the
// medic is not skilled enough to use it).
const battleKitBonus = (s) => medKitBonus(s);

export function playerUnit(b, s) {
  const item = s.gear.weapon;
  const eff = gearEffect(s, item);
  const key = item && eff.usable && WEAPONS[item.key] ? item.key : "fists";
  const mult = key === "fists" ? 1 : eff.mult;
  const q = item && key !== "fists" ? item.quality || 1 : 1;
  const bravery = traitAim(s); // Brave +5, Coward −5 (traits.js)
  const armor = woundMult(s) * armorMult(s); // Tough, Frail (traits.js); every worn piece (inventory.js)
  // What this unit takes the field with: exactly these item objects wear when the battle ends (wearFielded).
  const fielded = [];
  if (item && key !== "fists") fielded.push(["weapon", item]);
  for (const slot of ARMOR_SLOTS) if (s.gear[slot]) fielded.push([slot, s.gear[slot]]);
  // A bandage kit in the off hand loses a use with every treatment in battle; when it runs out its bonus is gone.
  const tool = s.gear.tool;
  const medKit = tool && GEAR[tool.key] && GEAR[tool.key].medKit ? tool : null;
  const u = {
    fielded, medKit, kitBonus: medKit ? medKitBonus(s) : 0, kitLeft: medKit ? itemDur(medKit) ?? Infinity : 0, kitUses: 0,
    id: b.nextId++, side: "player", kind: "human", sid: s.id, name: s.name, short: initials(s.name), cutter: cutterKeyOf(s), // wire.js: what they cut wire with, if anything
    weapon: key, weaponName: key === "fists" ? (item ? `${item.name} (unusable)` : "Fists") : modLabel(item), // "9mm pistol (red dot, suppressor)"
    gm: key === "fists" ? NO_MODS : gunMods(item), gmWeapon: key, // gunmods.js: what its attachments add (shotOdds, shotNoise)
    aim: 40 + skill(s, "shooting") * 2.5 - (1 - mult) * 30 + bravery + ((b.setup && b.setup.relAim && b.setup.relAim[s.id]) || 0) + buzzAim(s) + needsAim(s) + illnessAim(s) + tiredAim(s), // friends alongside, rivals, revenge (relations.js); a hangover (comforts.js); hunger, thirst (needs.js); illness (health.js); tiredness (sleep.js)
    nerve: (s.traits.includes("brave") ? MIDDEAD.NIGHTMARE.BRAVE : 0) + (s.traits.includes("coward") ? MIDDEAD.NIGHTMARE.COWARD : 0), // middead.js: a Nightmare's scream
    meleeAim: 75 + meleeAimBonus(s) + bravery + meleeTraitAim(s), dmgMult: (0.6 + 0.4 * mult) * (0.75 + 0.25 * q), // Melee (world.js MELEE_SKILL): 75 at Melee 5, ±2 a point
    meleeDmg: meleeDmgMult(s), melee: skill(s, "melee"), meleeSk: meleeAimBonus(s), // meleeSk: Melee's own step in meleeOdds' breakdown; melee damage × 1 at Melee 5, ±3% a point; takedowns (stealth.js subdueOdds)
    armor, hp: s.health, maxHp: 100, startHp: s.health, mob: MOVE, sight: SIGHT,
    stealth: skill(s, "stealth"), medicine: skill(s, "medicine") + battleKitBonus(s),
    scouting: skill(s, "scouting"), armLoad: fielded.reduce((a, [slot, it]) => a + (slot !== "weapon" && GEAR[it.key] ? GEAR[it.key].power || 0 : 0), 0), // escape checks (soundRetreat)
    boxes: boxesOf(s), // ammo.js: the boxes of rounds they carry (pockets, rig, pack): their gun draws on them first, the ones at hand reload in 1 action (mags.js roundSource)
    gearRisk: key === "fists" ? 0 : eff.damageChance, item: key === "fists" ? null : item,
    startGuns: carriedWithBag(s).filter((it) => WEAPONS[it.key] && calOf(it.key)), // gunload.js: every gun carried starts the fight loaded (one in a bag in the arms too)
    wormed: hasWorm(s), wornArmor: armorMult(s), // carriers.js: the worm in them gets them up if they die; the risen wear what they wore
    ap: 2, aware: true, x: 0, y: 0, f: 0,
    fleet: fleetEscape(s), // Fleet-Footed (traits.js): the escape check's bonus (its extra tile a move: carrykit.js weighPlayer)
    tact: tactOf(s), // Tactical (traits.js): flanks, cover, allies near (shotOdds tactAim, meleeOdds)
  };
  if (u.tact) b.tact = true;
  u.load = chooseLoad(b, u, item && key !== "fists" ? item.load : null); // ammo.js: the gun's own load (item.load), else its common round
  MED.fitMedic(u, s); // medics.js: a med kit in a pocket or the pack counts too
  fitMags(b, u, carriedSpots(s), magCap(u), s); // mags.js: the gun's magazine and the spares they carry (pouches, pockets, pack); fillUnit loads them as the fight starts (createBattle)
  weighPlayer(u, s); // carrykit.js: kg worn and carried → mob by load band (R17), u.armLoad (kg)
  loadMag(u); // the gun starts the battle loaded
  fitArmour(u, s); // armour.js: the worn pieces (per-hit armour) and the Tough trait
  fitHeadgear(u, s); // hearing.js: ear protection, the helmet's muffle, the team headset, the visor
  syncModes(u); // gunfire.js: the gun's fire modes
  fitLauncher(b, u, s); // launchers.js: a grenade launcher or rocket in hand (a sidearm besides), an M203 under the rifle, one carried
  if (s.vol) { u.vol = s.vol.fid; u.volGroup = s.vol.group; } // volunteers.js: on your side, moved by their group's AI (volunteerTurn), never by your orders
  return u;
}

// A weapon or armor put on or taken off in the middle of a raid (the search window, raidloot.js) counts at once.
// u.fit is what playerUnit gave when the raid started; perks and the rest added since stay on top.
export function refitUnit(b, u, s) {
  if (!u.fit) return;
  const id = b.nextId;
  const f = playerUnit(b, s);
  b.nextId = id;
  u.aim += f.aim - u.fit.aim;
  u.dmgMult *= f.dmgMult / (u.fit.dmgMult || 1);
  u.armor *= f.armor / (u.fit.armor || 1);
  u.medicine += f.medicine - (u.fit.medicine ?? f.medicine); // a med kit in the off hand (crafting.js medKitBonus)
  if (f.medKit !== u.medKit) { u.medKit = f.medKit; u.kitBonus = f.kitBonus; u.kitLeft = f.kitLeft; }
  MED.refitSelfAid(u, s); // medics.js: a tourniquet or a trauma kit within reach now
  u.fit = { aim: f.aim, dmgMult: f.dmgMult, armor: f.armor, medicine: f.medicine };
  u.cutter = f.cutter; // wire.js: a cutter picked up, handed over or put down
  const held = u.weapon, rounds = magIn(u), heldLoad = u.load, heldItem = u.item;
  const swapped = (heldItem || null) !== (f.item || null); // another gun in the hands (gunload.js): what was in the old one goes with it
  if (swapped && heldItem) gunOut(b, u, heldItem);
  const keepMags = u.weapon === f.weapon && tracksMags(u) && !swapped;
  const wasStack = Array.isArray(u.stack) ? u.stack : null; // physical rounds (mags.js): the same gun keeps them; another gun's come with it (gunIn) or are loaded now (fillUnit)
  for (const k of ["weapon", "weaponName", "item", "gearRisk", "fielded", "armLoad", "gm", "gmWeapon", "load", "boxes", "handBoxes", "pocketBoxes", "loadBand", "dash"]) u[k] = f[k]; // handBoxes, pocketBoxes: the boxes of rounds at hand, in the pockets and the rig (mags.js shellsAt, roundSource)
  if (!keepMags) for (const k of ["mags", "magsW", "clips", "magMode", "hand"]) u[k] = f[k]; // another gun: its own magazines (mags.js)
  if (keepMags) u.stack = wasStack; else u.stack = tracksMags(u) ? [] : null;
  u.bag = (s.gear && s.gear.carry) || null; // carry.js: a bag taken into the arms (or put down) in the search window
  if (u.mob0 == null && u.dragMob == null) u.mob = f.mob; // the load band's mob (not while carrying or dragging someone)
  if (u.weapon === held && heldLoad && !swapped) u.load = heldLoad; // the same gun keeps the rounds it has loaded
  // The magazine: the same gun keeps what was loaded (up to its capacity now, a magazine attachment may have changed);
  // another gun has what is in it (gunload.js gunIn: what it held when it was put down, loaded if it was carried into
  // the fight, else empty: Reload), so swapping guns never hands out a free full one.
  const came = swapped ? gunIn(b, u, u.item) : null; // gunload.js: what was in it (a record), null for a gun carried into the fight (loaded), 0 for one found empty
  loadMag(u, swapped ? came : u.weapon === held ? rounds : 0);
  if (swapped && isStacked(u)) { // physical rounds: the record's rounds into the gun (fillUnit reads item.loaded), a carried gun filled now, an empty one empty
    if (came === null || u.item.loaded) { fillUnit(b, u, { gun: came === null, pools: false }); sweepBoxes(s); u.boxes = boxesOf(s); fitMags(b, u, carriedSpots(s), magCap(u), s); syncMags(u); } else { u.stack = []; syncMags(u); } // a carried gun: filled now out of what they carry (it was loaded from the start); one with a record: exactly that; never the team's bags in the middle of a fight
    loadMag(u, u.mag);
  }
  if (u.spearOut && u.weapon === u.spearOut.key) { delete u.spearOut; unarm(b, u, s); } // its spear still lies where it was thrown
  if (u.weapon !== held) u.jam = null; // another gun: the jammed one is put away
  fitArmour(u, s); // armour.js: the pieces worn now
  fitHeadgear(u, s); // hearing.js: the ears and the visor as worn now
  syncModes(u);
  refitLauncher(b, u, f, s); // launchers.js: the same launcher keeps its round, another is taken up empty
  refitSenses(b, u, s); // stealth.js: a flashlight, night vision, scope or suppressor counts at once
}
setRefit(refitUnit);

// ---------- the survivor's inventory in a fight (2026-10-17 user request: "move items from your pocket to pack or
// pack to pocket same with rigs and this uses some action") ----------
// combatAct "inv" { type: "inv", unit, from, to, op? }: the acting unit's own kit moved about for INV_AP (one action)
// on its turn: between a pocket, a pack slot, a rig pouch, the hands, the off hand and the arms, any direction (a full
// target swaps, the stacks of a thing merge, loose rounds and boxes of the same load go onto each other: inventory.js
// moveItem); op "split", "open" or "box" on `from` (a stack halved, boxes opened into loose rounds, loose rounds
// boxed) costs the same. Armour, a helmet, the rig and the pack stay as worn (a plate: "plate", carrykit.js PLATE_AP).
// What changed counts at once (refitKit: the weapon in the hands, the boxes of rounds, where each magazine sits).
// Sessions D and E build on this (reloads from pockets and rigs; a hand-over to the survivor next to you).
// Loose rounds moved onto one of the gun's spare magazines (op "load", or a plain move whose target is a magazine) load
// it instead (mags.js loadMagPlan / loadMagFrom, 2026-10-18 user request): 1 action with the rounds in a pocket or a
// rig pouch, both with them in the pack (mags.js LOAD_AP); nothing changes place, so no refit.
export const INV_AP = 1;
const INV_SLOTS = ["pocket", "pack", "pouch", "weapon", "tool", "carry"]; // inventory.js slotKind: a rig pouch is "pouch", the rig itself "rig"
const INV_WORN = "Armour, a helmet, the rig and the pack stay as they are in a fight: only the pockets, the pack's slots, the rig's pouches and the hands change.";
// u.fit (what playerUnit gave at the start: refitUnit's baseline) for a unit that has none yet (a field battle).
export function ensureFit(b, u, s) {
  if (u.fit || !s) return;
  const id = b.nextId;
  const f0 = playerUnit(b, s);
  b.nextId = id;
  u.fit = { aim: f0.aim, dmgMult: f0.dmgMult, armor: f0.armor, medicine: f0.medicine };
}
// The unit's battle caches after its kit moved about: the weapon-derived fields when the hands changed and the boxes
// of rounds (refitUnit: ammo.js boxesOf, the rig's at hand by mags.js fitHandBoxes), then, with the same gun, where
// each magazine and clip sits now (a spare moved from the pack to a pocket reloads in 1 action), each keeping the
// rounds and the load it had. Another gun in the hands gets its own magazines (refitUnit).
export function refitKit(b, u, s) {
  ensureFit(b, u, s);
  const wasMags = u.mags, wasClips = u.clips, wasW = u.magsW, wasMode = u.magMode, hand = u.hand;
  refitUnit(b, u, s);
  if (!tracksMags(u) || u.magsW !== wasW || u.magMode !== wasMode || u.mags !== wasMags) return;
  const t = { weapon: u.weapon, item: u.item, load: u.load, side: u.side, boxes: Array.isArray(u.boxes) ? u.boxes.slice() : u.boxes, gm: u.gm, gmWeapon: u.gmWeapon, hand: null, stack: [] };
  fitMags(b, t, carriedSpots(s), magCap(u), s); // a scratch unit: the spares as they lie now (nothing of the world's is touched)
  if (isStacked(u)) { // physical rounds: each magazine's are on the item (mags.js), so the entries are simply rebuilt where they lie now
    const gun = (wasMags || []).find((m) => m.where === "gun") || (t.mags || []).find((m) => m.where === "gun");
    u.mags = [...(gun ? [gun] : []), ...(t.mags || []).filter((m) => m.where !== "gun")];
    if (Array.isArray(t.clips)) u.clips = t.clips.map((c) => ({ ...c, used: (wasClips || []).some((o) => o.key === c.key && o.used) }));
    for (const m of u.mags) if (m.where !== "gun" && m.item && !Array.isArray(m.item.stack)) m.item.stack = []; // a magazine that came to them in the fight (a hand-over, a find): empty until loaded
    syncMags(u);
    return;
  }
  const old = (wasMags || []).filter((m) => m.where !== "gun");
  const used = new Set();
  const same = (m) => { // the old entry of this magazine: the same key in the same place first, else anywhere
    let i = old.findIndex((o, j) => !used.has(j) && o.key === m.key && o.where === m.where);
    if (i < 0) i = old.findIndex((o, j) => !used.has(j) && o.key === m.key);
    if (i < 0) return m;
    used.add(i);
    return { ...m, n: old[i].n, load: old[i].load };
  };
  const gun = (wasMags || []).find((m) => m.where === "gun") || (t.mags || []).find((m) => m.where === "gun");
  u.mags = [...(gun ? [gun] : []), ...(t.mags || []).filter((m) => m.where !== "gun").map(same)];
  if (Array.isArray(t.clips)) u.clips = t.clips.map((c) => ({ ...c, used: (wasClips || []).some((o) => o.key === c.key && o.used) }));
  if (hand) u.hand = hand; // the shells loose at hand stay as they were
}
// The fight's start (createBattle, createRaid): the gun and the spares loaded physically (mags.js fillUnit), the stacks
// it emptied thrown away (ammo.js sweepBoxes) and the unit's round caches rebuilt (the entries read the items' stacks).
function fillBattleUnit(b, u, s) {
  fillUnit(b, u);
  sweepBoxes(s);
  u.boxes = boxesOf(s);
  fitMags(b, u, carriedSpots(s), magCap(u), s);
  syncMags(u);
  loadMag(u, u.mag);
}
// After rounds left a survivor's items physically (a Reload, a magazine loaded by hand: mags.js): the emptied stacks
// are thrown away (ammo.js sweepBoxes) and the unit's caches refit (u.boxes, the magazine entries).
export function tidyRounds(b, u, s) {
  if (!s || !u || u.side !== "player") return;
  sweepBoxes(s);
  refitKit(b, u, s);
}
// combatAct "inv": the move checked and done (the error, or "" when it happened and INV_AP was spent).
function invAct(state, b, u, act) {
  const s = u.sid != null ? survivorById(state, u.sid) : null;
  if (!s) return "Only one of yours sorts their kit.";
  if (u.ap < INV_AP) return "No action left.";
  const from = parseLoc(act.from);
  if (from.o !== "s" || from.id !== s.id) return "Only their own kit moves in a fight.";
  const fk = slotKind(from);
  if (!INV_SLOTS.includes(fk)) return INV_WORN;
  const item = itemAt(state, act.from);
  if (!item) return "Nothing there.";
  const op = act.op || "move";
  let msg;
  if (op === "unload") { // a spare magazine emptied by hand (mags.js unloadMagFrom): its rounds loose onto them, each kind its own stack
    if (!isMag(item)) return "Only a magazine is unloaded.";
    const m = magEntryAt(u, carriedSpots(s), act.from);
    if (!m) return tracksMags(u) && u.magMode === "box" ? `The ${item.name} is not one of the ${gunWord(u)}'s: only its magazines are unloaded in a fight.` : `The ${gunWord(u)} takes no magazines.`;
    const p = unloadMagPlan(b, u, m);
    if (p.why) return p.why;
    const line = unloadMagFrom(b, u, m, s);
    if (!line) return "No room for the rounds: a free pocket or pack slot is needed (or loose rounds of the same kind with room).";
    say(b, line, "info");
    u.ap -= INV_AP;
    u.hunker = false;
    refitKit(b, u, s);
    return "";
  }
  if (op === "split" || op === "open" || op === "box") {
    msg = op === "split" ? splitAt(state, act.from) : op === "open" ? openAt(state, act.from) : boxRoundsAt(state, act.from);
    const ok = op === "split" ? /split:/.test(msg) : op === "open" ? /^Opened|out of the/.test(msg) : /^Boxed/.test(msg);
    if (!ok) return msg;
  } else {
    const to = parseLoc(act.to);
    if (to.o !== "s" || to.id !== s.id) return "Only their own kit moves in a fight.";
    if (!INV_SLOTS.includes(slotKind(to))) return INV_WORN;
    if (act.from === act.to) return "";
    const cur = itemAt(state, act.to);
    if (op === "load" || (isRoundItem(item) && isMag(cur))) { // rounds onto a magazine: loaded, not swapped (mags.js)
      if (!isMag(cur)) return "Only a magazine is loaded with rounds.";
      const m = magEntryAt(u, carriedSpots(s), act.to);
      if (!m) return tracksMags(u) && u.magMode === "box" ? `The ${cur.name} is not one of the ${gunWord(u)}'s: only its magazines are loaded in a fight.` : `The ${gunWord(u)} takes no magazines to load.`;
      const src = fk === "pouch" ? "rig" : fk === "pack" ? "pack" : "pocket";
      const p = loadMagPlan(b, u, m, item, src);
      if (p.why) return p.why;
      if (u.ap < p.cost) return "The rounds are in the pack: both actions to load a magazine from the pack (a pocket's or the rig's load it in 1).";
      say(b, loadMagFrom(b, u, m, item, src, p), "info");
      u.ap -= p.cost;
      u.hunker = false;
      tidyRounds(b, u, s); // the rounds left the stack physically (mags.js): an emptied one is thrown away, the caches refit
      return "";
    }
    const kindAt = (L) => (slotKind(L) === "pouch" ? (pouchesOf(rigOf(s)) || [])[L.i] : null);
    const back = cur && !canStack(cur, item) && !(isRoundItem(cur) && isRoundItem(item) && cur.key === item.key) ? fitReason(cur, fk, s, kindAt(from)) : "";
    if (back) return `No room: the ${cur.name} there has nowhere to go (${back.replace(/\.$/, "")}).`; // (out of a fight it would go to the team's cargo)
    const before = amountOf(item);
    msg = moveItem(state, act.from, act.to);
    if (itemAt(state, act.from) === item && amountOf(item) === before) return msg || "Nothing moved.";
  }
  say(b, msg, "info");
  u.ap -= INV_AP;
  u.hunker = false;
  refitKit(b, u, s);
  return "";
}

// ---------- a hand-over to the survivor next to you (2026-10-17 user request: "trade items with adjacent survivors
// when facing them with in your cone") ----------
// combatAct "handover" { type: "handover", unit, to, from, toLoc }: the acting unit and a teammate right next to it
// (Chebyshev 1, the same floor) in its view cone (vision.js inArc, VISION.HALF) trade: `from` and `toLoc` are
// locations on the two survivors, one each (either way: a thing given, or taken from the mate), among the slots the
// inventory act allows (INV_SLOTS: pockets, pack slots, rig pouches, the hands, the off hand, the arms); a full target
// swaps as moveItem does when the thing there fits back. The acting unit spends HANDOVER_AP (one action) a move, the
// mate nothing. Both units refit at once (refitKit: a gun handed over is in the other's hands, the boxes of rounds and
// the magazines placed where they are now). A mate next to them but out of the cone: the free Face act first
// (handoverUnfaced lists them for the UI's "Face <name>"). The search window's hand-over on a raid (raidloot.js
// matesOf) stays free: that is part of searching.
export const HANDOVER_AP = 1;
const handMate = (b, u, t) => t && t !== u && t.side === "player" && t.sid != null && t.vol == null && !t.dead && !t.left && !t.fled && !t.off && (t.f || 0) === (u.f || 0) && adjacent(u, t);
// The player units the acting unit can hand things to now (the same floor, right next to it, in its cone, up).
export function handoverTargets(b, u) {
  if (!u || u.side !== "player" || u.sid == null || u.aboard) return [];
  return b.units.filter((t) => handMate(b, u, t) && active(t) && !t.aboard && inArc(u, t.x, t.y));
}
// The mates right next to the unit that only the cone keeps from a hand-over (a free Face toward them fixes it).
export function handoverUnfaced(b, u) {
  if (!u || u.side !== "player" || u.sid == null || u.aboard) return [];
  return b.units.filter((t) => handMate(b, u, t) && active(t) && !t.aboard && !inArc(u, t.x, t.y));
}
// Why the acting unit cannot hand things to t now ("" when it can).
export function handoverRefusal(b, u, t) {
  if (!t || t.side !== "player" || t.sid == null || t.vol != null) return "Only one of your own people takes things in a fight.";
  if (t === u) return "Their own kit: the Inventory window moves it (1 action a move).";
  const who = t.name.split(" ")[0];
  if (t.dead || t.left || t.fled || t.off) return `${who} is out of the fight.`;
  if (t.down) return `${who} is down: nothing changes hands until they are on their feet.`;
  if (isTied(t) || t.away) return `${who} cannot take anything now.`;
  if (u.aboard || t.aboard) return "Not from inside the vehicle: get out first.";
  if ((t.f || 0) !== (u.f || 0) || !adjacent(u, t)) return `${who} is not right next to them.`;
  if (!inArc(u, t.x, t.y)) return `Face ${who} first (Face, free): a hand-over needs them in the view cone.`;
  return "";
}
// combatAct "handover": the move checked and done (the error, or "" when it happened and HANDOVER_AP was spent).
function handoverAct(state, b, u, act) {
  const s = u.sid != null ? survivorById(state, u.sid) : null;
  if (!s) return "Only one of yours hands things over.";
  if (u.ap < HANDOVER_AP) return "No action left.";
  const t = act.to != null ? unitById(b, act.to) : null;
  const why = handoverRefusal(b, u, t);
  if (why) return why;
  const m = survivorById(state, t.sid);
  if (!m) return `${t.name} is not here.`;
  const from = parseLoc(act.from), to = parseLoc(act.toLoc);
  const theirs = (L) => L.o === "s" && (L.id === s.id || L.id === m.id);
  if (!theirs(from) || !theirs(to)) return "Only what the two of them carry changes hands.";
  if (from.id === to.id) return from.id === s.id ? "Their own kit: the Inventory window moves it (1 action a move)." : `${m.name.split(" ")[0]}'s own kit stays as it is: only what changes hands between them moves.`;
  const fk = slotKind(from);
  if (!INV_SLOTS.includes(fk) || !INV_SLOTS.includes(slotKind(to))) return INV_WORN;
  const item = itemAt(state, act.from);
  if (!item) return "Nothing there.";
  const giver = from.id === s.id ? s : m;
  const cur = itemAt(state, act.toLoc);
  const kindAt = (L, who) => (slotKind(L) === "pouch" ? (pouchesOf(rigOf(who)) || [])[L.i] : null);
  const back = cur && !canStack(cur, item) && !(isRoundItem(cur) && isRoundItem(item) && cur.key === item.key) ? fitReason(cur, fk, giver, kindAt(from, giver)) : "";
  if (back) return `No room: the ${cur.name} there has nowhere to go (${back.replace(/\.$/, "")}).`; // (out of a fight it would go to the team's cargo)
  const before = amountOf(item);
  const msg = moveItem(state, act.from, act.toLoc, { across: true });
  if (itemAt(state, act.from) === item && amountOf(item) === before) return msg || "Nothing moved.";
  say(b, `${u.name} ${from.id === s.id ? `hands ${t.name.split(" ")[0]}` : `takes from ${t.name.split(" ")[0]}`}: ${msg}`, "info");
  u.ap -= HANDOVER_AP;
  u.hunker = false;
  refitKit(b, u, s);
  refitKit(b, t, m);
  return "";
}

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
  const kitPick = p >= 7 && rng.chance(0.5) ? rng.pick(kit.strong) : rng.pick(kit.weapons);
  const weapon = swapGun(kitGunSource(KITS[kind] ? kind : "raiders"), kitPick, rng); // gundist.js: a gun of their kind in the power band of their list's (a hash of the draw)
  const armorKey = rng.pick(kit.armor);
  const hp = Math.round(55 + p * 5 + kit.hp);
  // gunmods.js ENEMY_MODS: the attachments on their gun by their kit (dice of their own: the battle's are not used up).
  const id = b.nextId++;
  const mods = withFactory(weapon, enemyMods(kind, weapon, rng && Number.isFinite(rng.state) ? rng.state : b.turn || 0, id), rng && Number.isFinite(rng.state) ? rng.state : b.turn || 0, id); // factoryfit.js
  const gun = { key: weapon, name: WEAPONS[weapon].name, mods };
  const u = {
    id, side: "enemy", kind: "human", name: `${kit.label} ${n}`, short: kit.label[0] + n, weapon, weaponName: modLabel(gun),
    modItems: mods, gm: gunMods(gun), gmWeapon: weapon, suppressor: fittedSuppressor(gun), supFitted: true, // looted with the gun (inventory.js carryMods)
    load: enemyLoad(kind, weapon, rng && Number.isFinite(rng.state) ? rng.state : b.turn || 0, id), // ammo.js: their round by kit (KIT_AMMO, own dice); never shown (R10)
    aim: 39 + p * 4 + kit.aim, meleeAim: 65 + p * 2, dmgMult: 0.7 + p * 0.05, armor: armorKey ? 1 - GEAR[armorKey].power * 0.06 : 1, armorKey,
    hp, maxHp: hp, mob: MOVE, sight: SIGHT, ap: 2, aware: true, x: 0, y: 0, f: b.floor || 0, fearless: !!kit.fearless, kit: kind,
    kitPick, // the gun their kit's list gave (floorfolk.js reads the list's, so its dice stay put)
  };
  MED.enemyMedic(b, rng, u, kind); // medics.js: about one group in five of soldiers, guards, militia, fighters has a medic
  loadMag(u); // loaded; their reserve ammo is endless (only the magazine stops them)
  u.q = enemyGunQ(rng && Number.isFinite(rng.state) ? rng.state : b.turn || 0, id, kind); // gunfire.js: their gun's condition by their kit (itemcond.js kitSource; jams; the looted gun keeps it), own dice
  u.cond = enemyGunCond(rng && Number.isFinite(rng.state) ? rng.state : b.turn || 0, id, kind); // its durability share (a worn gun jams more)
  syncModes(u);
  kitHeadgear(u, kind, rng && Number.isFinite(rng.state) ? rng.state : b.turn || 0); // helmets.js: a helmet and ear protection by kit (own dice)
  kitFlashbangs(u, kind, rng && Number.isFinite(rng.state) ? rng.state : b.turn || 0); // throwables.js FLASH_KIT: a soldier's or a guard's flashbang (its own dice)
  u.cutter = kitCutter(kind, rng && Number.isFinite(rng.state) ? rng.state : b.turn || 0, id); // wire.js WIRE.KIT: snips for the wire (own dice)
  u.boards = kitBoards(kind, rng && Number.isFinite(rng.state) ? rng.state : b.turn || 0, id); // barricade.js BOARD.KIT: a bundle of boards to nail over a window while nothing is in sight (own dice)
  MED.kitSelfAid(u, kind, rng && Number.isFinite(rng.state) ? rng.state : b.turn || 0); // medics.js SELF.KIT: a tourniquet to stabilize themselves (its own dice)
  kitLauncher(b, u, kind, p, n, rng && Number.isFinite(rng.state) ? rng.state : b.turn || 0); // launchers.js: an M203 on a soldier's rifle, now and then an RPG (its own dice)
  kitEnemy(b, u, kind, rng && Number.isFinite(rng.state) ? rng.state : b.turn || 0); // carrykit.js: a rig (a guard's tactical vest), spare magazines, the kit's weight → mob (own dice; after the helmet and the launcher: their kg)
  enemyPieces(b, u); // armour.js: their body armour as a piece that wears (the loot keeps what is left; after kitEnemy's tactical vest, with kitHeadgear's helmet)
  return u;
}

const initials = (name) => name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

// ---------- setup ----------
export function createBattle(state, setup) {
  setup.relAim = friendAim(state, combatants(state, setup), setup); // relations.js: aim per survivor id
  if (setup.mode === "raid") return createRaid(state, setup);
  const rs = state.rng.state; // raidplan.js: the dice the map is made from (the same map again)
  [W, H] = battleSize(state, setup);
  const rng = state.rng;
  const tileId = tileIdOf(setup);
  const tile = state.tiles[tileId];
  const party = setup.partyId ? state.parties.find((x) => x.id === setup.partyId) : null;
  const base = setup.baseId ? state.bases.find((x) => x.id === setup.baseId) : null;
  if (party) settleParty(state, party); else if (base) settleBase(state, base); // ammo.js: rounds by calibre in the pools (generic ammo sorted, boxes in the cargo or armory opened)
  // A shotgun loads only from the shells on the person (mags.js SHELLS), so a base's defenders grab theirs out of its
  // stock as the fight starts, as a team packing for a trip does (carrykit.js packShells: a pocket or a rig pouch).
  const shellLines = base && !party ? handOutShells(base.stock, combatants(state, setup)) : [];
  // A base's wall map (deploy.js: the wall at column 12 of an 18-wide map): on a bridge the river starts 3 columns before
  // it, so the wall, its walkway and ladders and the tank traps in front all stand on the deck.
  const map = genMap(rng, tile, { densify: setup.layout !== "baseDefence", bridgeC0: setup.layout === "baseDefence" ? 9 : undefined, trucks: setup.layout ? [] : trucksAt(state, tileId), locks: !setup.layout }); // Army trucks (miltrucks.js), not on a base's wall map; locked doors only on an open field
  const b = {
    setup, tileId: party ? partyTile(party) : tileId, w: W, h: H, cells: map.cells, reach: map.reach,
    place: placeName(tile),
    units: [], turn: 1, phase: "player", log: [], fx: [], fxSeq: 0, rev: 1, nextId: 1,
    pools: party ? [party.supplies, party.cargo ? party.cargo.supplies : {}] : base ? [base.stock] : [setup.pool || {}], // setup.pool: the rounds and meds a group hands your people lent out (volunteers.js watchSetup)
    ammoUsed: 0, arrowsUsed: 0, medsUsed: 0, noise: 0, reinf: 0, infection: tile ? tile.infection || 0 : 0,
    evacCols: setup.canRetreat ? 2 : 0, over: false, result: null, acted: false, queue: [],
    losCache: makeLosCache(W, H), rng, dark: isNight(state), // dark: escapes are easier (escapeOdds)
  };
  // The houses' locked doors (genMap FIELD_DOOR): opened like a raid's (locks.js openLock, combatAct "open").
  if (map.locked.length) b.doors = map.locked.map(([x, y], i) => ({ id: i + 1, x, y, lock: { kind: "door", open: false, tries: 0, ...(map.cells[idx(x, y)].dk ? { dk: map.cells[idx(x, y)].dk } : {}) } })); // dk: the door's kind (locks.js openOdds: its lock's difficulty, whether it can be kicked)
  if (shellLines.length) say(b, `Shells out of the stock: ${shellLines.join(", ")}.`, "info");
  b.reinfMax = Math.round(b.infection * 5);
  b.zmix = armoredOf(setup.enemy && setup.enemy.mix); // the dead drawn in later: soldiers among them at a military site
  const layout = setup.layout && layouts ? layouts.get(setup.layout) : null;
  const layoutCtx = (phase) => ({
    phase, state, rng, W, H, inside, cellAt: (x, y) => b.cells[idx(x, y)],
    free: (x, y) => inside(x, y) && b.cells[idx(x, y)].k === "open" && !unitAt(b, x, y),
    put: (x, y, k) => { if (!inside(x, y)) return; const c = b.cells[idx(x, y)]; if (DOORS.has(c.k)) { delete c.hp; delete c.mhp; } c.k = k; }, // a house's door built over: not a door's strength
    standable: (x, y) => inside(x, y) && b.reach[idx(x, y)] && cellAt(b, x, y).walk && !unitAt(b, x, y),
  });
  if (layout) {
    layout(b, layoutCtx("map"));
    b.reach = flood(b.cells, 0, Math.floor(H / 2));
  }
  if (b.doors) b.doors = b.doors.filter((d) => b.cells[idx(d.x, d.y)].k === "door");
  // The team's car or truck on the field (placeVehicle): by the west edge, on the road when there is one. It can be
  // driven (DRIVE) and the siege ram rides in it (siege.js), so nobody has to carry it to the wall.
  if (party && party.vehicle && setup.layout !== "baseDefence") {
    const pv = partyVehicle(state, party);
    {
      const kind = vehicleBody(party, pv); // a bike: 2 x 1; an Army truck: 2 x 5
      const roadRows = [];
      for (let y = 0; y < H; y++) if (b.cells[idx(1, y)].f === "road") roadRows.push(y);
      const ys = roadRows.length ? [roadRows[Math.floor(roadRows.length / 2) - 1] ?? roadRows[0], roadRows[0], roadRows[roadRows.length - 2] ?? roadRows[0]] : [Math.floor(H / 2) - 1, Math.floor(H / 2) + 1, 2, H - 4];
      for (const y of ys) {
        const vr = placeVehicle(b.cells, W, H, { x0: 1, y0: y, side: "north" }, kind, (x, yy) => inside(x, yy) && b.cells[idx(x, yy)].k === "open" && b.reach[idx(x, yy)]);
        if (vr) { b.vehicle = vr; break; }
      }
      if (b.vehicle) { b.vehicle.seats = SEATS[kind === "bike" ? "bike" : (pv && pv.type) || "sedan"] ?? 4; b.reach = flood(b.cells, 0, Math.floor(H / 2)); fitMapVehicle(b, pv); }
    }
    // The team's other vehicles (vehicles.js fleets): parked beside the lead one, the team's own (blue). Cover, and
    // theirs to lose: a blast wears them and can blow them up (vehicleBlast), settled after the fight (settleVehicle).
    // Only the lead one is driven.
    if (b.vehicle) placeConvoy(b, party, partyVehicles(state, party).filter((x) => x !== pv), W, H, inside);
  }
  const coverScore = (x, y) => coverSides(b, x, y).reduce((s, c) => s + c, 0);
  // A free cell your people can reach: the cells taken worked out once a scan (occupancy), the dice drawn for the same
  // cells in the same order as asking unitAt of each.
  const pickCells = (n, test, score) => {
    const list = [], occ = occupancy(b, W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b.reach[idx(x, y)] && cellAt(b, x, y).walk && !occ[idx(x, y)] && test(x, y)) list.push([x, y, score(x, y) + rng.next() * 2]);
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
    if (!setup.drill) fillBattleUnit(b, u, s); // mags.js: the gun and the spares loaded physically (the gun's own rounds, then what they carry, then the team's bags); not for a drill's throw-away battle (defenceplan.js)
  });
  battlePerks(state, b); // skills.js: perks on the player's units (aim, crits, stealth, Rally, Commander...)
  fitHands(state, b); // carry.js: who starts with their hands full of the team's supplies

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
    if (u.factionId != null) armFromArsenal(state, b, u, hn); // arsenal.js: a group's people fight with what the group holds
    b.units.push(u);
  });
  if (setup.third && setup.third.length) placeThird(b, setup.third, rng, pickCells, W); // thirdside.js: soldiers or survivors in the middle
  if (layout) layout(b, layoutCtx("units"));
  if (setup.enemy && setup.enemy.turret && setup.layout === "baseDefence" && placeRaidHumvee(b, setup.enemy.turret)) manEnemyTurret(b, setup.enemy.turret); // the Humvee a raid brought (vehicles.js raidTurret), one of them on its gun
  // Their vehicle (conflicts.js: a scavenging party that drove here, aiscav.js): parked behind their people, cover for them
  // and theirs to lose (endBattle: won, it is left for you: result.enemyVehicle).
  if (setup.enemy && setup.enemy.vehicle && !setup.layout) {
    const foes = b.units.filter((u) => u.side === "enemy");
    if (foes.length) {
      const cx = Math.round(foes.reduce((a, u) => a + u.x, 0) / foes.length), cy = Math.round(foes.reduce((a, u) => a + u.y, 0) / foes.length);
      // A merchant caravan's escort vehicle (escorts.js): vehicleBody "humvee" | "mrap" draws it as the Army's (olive),
      // a pickup as a truck; it is not one of the map's found cars (foundcars.js: c.car.escort), it is settled after.
      const mil = setup.enemy.vehicleBody === "humvee" || setup.enemy.vehicleBody === "mrap" ? setup.enemy.vehicleBody : null;
      const big = setup.enemy.vehicle === "truck" || setup.enemy.vehicle === "van" || !!mil;
      const L = mil === "humvee" ? 3 : big ? 4 : 3;
      const spots = [];
      for (let y = 0; y < H; y++) for (let x = Math.max(0, cx - 2); x < W; x++) spots.push([x, y, Math.hypot(x - (cx + 2), y - cy)]);
      spots.sort((a, c) => a[2] - c[2]);
      for (const [x, y] of spots.slice(0, 300)) {
        const r = placeCar(b.cells, W, H, x, y, rng.chance(0.5) ? "x" : "y", L, big ? "truck" : "car", (xx, yy) => inside(xx, yy) && b.cells[idx(xx, yy)].k === "open" && !!b.reach[idx(xx, yy)] && !unitAt(b, xx, yy), rng.int(0, 1e6), { ring: false, ...(mil ? { body: mil } : {}) });
        if (!r) continue;
        if (setup.enemy.escort) for (let yy = r.y0; yy < r.y0 + r.h; yy++) for (let xx = r.x0; xx < r.x0 + r.w; xx++) { const c = b.cells[idx(xx, yy)]; if (c.car) { c.car.escort = true; if (mil) { c.car.mil = { kind: mil, cond: "intact" }; c.car.up = { p: 1, s: 0, g: 1, m: 0, t: setup.enemy.turret || null }; } } } // plated, glassed, the turret drawn
        const reach = flood(b.cells, 0, Math.floor(H / 2));
        if (!b.units.every((u) => reach[idx(u.x, u.y)] || u.side !== "player")) { removeCar(b.cells, W, r); continue; }
        b.reach = reach;
        b.enemyVehicle = { type: setup.enemy.vehicle, partyId: setup.enemy.vehiclePartyId ?? null, x: r.x0, y: r.y0, w: r.w, h: r.h };
        if (technicalPlated(state, setup.enemy)) for (let yy = r.y0; yy < r.y0 + r.h; yy++) for (let xx = r.x0; xx < r.x0 + r.w; xx++) b.cells[idx(xx, yy)].car.up = { p: 0, s: 1, g: 0, m: 0, t: null }; // a raider technical (vehicles.js): scrap plating, full cover
        if (mil && setup.enemy.escort && setup.enemy.turret) escortCar(b, r, mil, setup.enemy.turret); // an armoured escort: manned and driven (carTurn)
        say(b, `They came in ${setup.enemy.vehicleName ? `${/^[aeiou]/i.test(setup.enemy.vehicleName) ? "an" : "a"} ${setup.enemy.vehicleName}` : `a ${setup.enemy.vehicle === "sedan" ? "car" : setup.enemy.vehicle}`}: it stands behind them. Win and it is yours to take.`, "info");
        break;
      }
    }
  }
  if (!setup.layout) placeBodies(b, state.seed); // sleepers.js: bodies lie about a fight in the open, Sleepers among them
  placeWalking(state, b); // carriers.js: the walking dead that drifted near this tile, among the ordinary dead
  stealthSetup(state, b); // stealth.js: lights, suppressors, which way the enemy faces
  nlSetup(state, b); // nonlethal.js: tasers and spray on both sides
  siegeSetup(state, b); // siege.js: the raiders' ladders, ram and grenades; a team's ladders and ram
  b.enemyStart = b.units.filter((u) => u.side === "enemy").length;

  const foeName = e.name || e.kind;
  say(b, `Battle at ${b.place} against ${foeName}.`, "info");
  if (setup.ambush === "player") say(b, "You have the drop on them. They have not seen you yet. Gunfire will alert them; melee is silent.", "good");
  // A base battle has its own start for a surprise (defenceplan.js openStart: an unwatched night finds everyone in
  // the buildings and the attackers move first), so no volley on top of it.
  if (setup.ambush === "enemy" && setup.layout !== "baseDefence") {
    say(b, "Ambush! They saw you first. Your people are pinned: 1 action each this turn.", "danger");
    for (const u of b.units) if (u.side === "player") u.ap = 1;
    for (const u of b.units) {
      if (u.side !== "enemy" || !isRanged(u)) continue;
      const shot = bestShot(b, u, foesOf(b, u), { volley: true });
      if (shot) fire(b, u, shot.t, { volley: true });
    }
  }
  // volunteers.js: a fight of your people lent out that you watch: theirs are the group's orders, so everyone on your
  // side is moved by the AI (volunteerTurn) and you only watch.
  if (setup.watch) { for (const u of b.units) if (u.side === "player") { u.vol = setup.watch.fid; u.volGroup = setup.watch.group; u.watched = true; } say(b, `You watch your people fight beside ${setup.watch.group}: their orders, not yours.`, "info"); }
  if (b.evacCols) say(b, `The green strip on the ${b.evacSide || "left"} edge is your way out. Units standing there can retreat, or sound the retreat to pull everyone out at once.`, "info");
  stageAtStart(state, b); // carry.js: a fight the team starts: the loads into the vehicle, the rest set down where they start
  planStart(state, b, rs); // raidplan.js: a base stormed or a rescue: a scout first, or the night
  enemyCarts(state, b); placeMapCarts(state, b); cartHelpStart(state, b); // carts.js: the scavengers' carts, an abandoned cart by the road, two on a hand cart
  checkEnd(state, b);
  return b;
}

// Who a unit fights. Zombies drawn in by noise attack anyone alive, and raiders shoot back.
// thirdside.js: the third side fights its own foes; enemy people go after it by enemyTargetsThird; the dead go for
// anyone; your people never go after it on their own (only an order to shoot one does: damage turns it hostile).
// crossfire.js: in a raid the dead add the raiders they are in contact with, and the raiders the dead coming at them.
function foesOf(b, u) {
  if (u.side === "third") return thirdFoes(b, u);
  if (u.wild) return b.units.filter((o) => active(o) && o.kind !== "zombie");
  if (u.side === "enemy" && u.kind === "human") return crossFoes(b, u, b.units.filter((o) => active(o) && (o.side === "player" || o.wild || (o.side === "third" && enemyTargetsThird(o, u)))));
  // A Sleeper lying where it is (sleepers.js) is shot only by order: the AI keeps clear of it.
  return crossFoes(b, u, b.units.filter((o) => o.side !== u.side && active(o) && !(u.side === "player" && (o.side === "third" || o.dormant))));
}

// ---------- actions ----------
// nonLethal (Subdue, stealth.js): a person brought to 0 is knocked out, not killed.
// hit: { how: "shot" | "melee" | "bash" | "fire" | "blast", crit, sneak } for the armoured dead (deadsoldiers.js
// armorVs: their armour by the weapon that struck); everyone else takes raw × their armor ("acid": half of it, acid.js).
// A spitter that dies bursts (acid.js spitterBurst); a Carrier bursts into a worm swarm, and whoever the swarm kills
// carries the worm (carriers.js; deadsoldiers.js armorVs: most bullets go through the swarm).
// A Boneback's plates take most of a hit from the front (middead.js bonebackMult); a Flinger winding up drops its
// mass when hit hard (afterHit); a spotted Sleeper splits where it lies (sleepers.js).
// People (armour.js): a shot, a blow or a bite lands on a location and its piece (pieces: your people's worn items,
// everyone else's made on first use); hitMult is the expected × over the locations (the AI's sense of a shot), damage
// rolls it. Fire, blasts, acid and traps keep the flat t.armor.
const personHit = (t, hit) => t.kind === "human" && !t.ztype && locatedHit(hit);
export function hitMult(t, by, hit) {
  if (hit && hit.how === "acid") return acidArmor(t);
  if (hit && hit.how === "glass") return 1; // the cuts of a vault through a closed window (windows.js): no armour against them
  if (t.ztype === "boneback") return bonebackMult(t, by, hit) * t.armor;
  if (t.ztype && (ARMORED.includes(t.ztype) || t.ztype === "swarm")) return armorVs(t, by, hit);
  if (personHit(t, hit) && t.pieces) return armourExpect(t, by, hit);
  return t.armor;
}
export function damage(b, t, raw, by, nonLethal = false, hit = null) {
  if (t.side === "third" && !(hit && hit.overpen)) thirdSideHit(b, t, by); // thirdside.js: your people hit them, so they (or all the soldiers) turn on you (not a round that went through someone else: an accident, like a friend hit that way)
  if (!nonLethal) nonLethal = nlHit(t, by, hit); // nonlethal.js: a stun baton, beanbag and rubber rounds
  let eff;
  if (personHit(t, hit) && (t.pieces || (t.side !== "player" && t.pieces === undefined))) {
    if (t.pieces === undefined) enemyPieces(b, t);
    const A = armourHit(b, t, raw, by, hit); // armour.js: location, penetration, wear, shatter, spall; a hollow or soft point's bonus on a bare location (roundOf soft)
    eff = raw * A.mult + A.extra;
    hit.loc = A.loc; hit.through = A.through;
    if (A.piece) hit.piece = A.piece; // the piece that took it (ui/sfx-melee.js: a blow on a plate or a helmet is heard)
    for (const [text, k] of A.msgs) say(b, text, k);
  } else {
    eff = raw * hitMult(t, by, hit) * softMult(t, hit); // ammo.js: hollow and soft points on a target with no armour (people without pieces, the dead)
    if (t.ztype && ARMORED.includes(t.ztype)) wearPlate(t, by, hit, raw); // deadsoldiers.js: their plates wear (plateDur)
  }
  if (b.rescue) eff *= captiveHitMult(b, t, by); // rescueraid.js: guards shoot to wound captives
  t.hp = Math.max(0, t.hp - eff);
  if (t.hp > 0) {
    if (t.ztype === "boneback" || t.ztype === "flinger") afterHit(b, t, by, hit, eff); // middead.js
    swarmBite(b, t, by); // carriers.js: a worm swarm's bite can leave the worm in the living
    nlAfterHit(b, t, by, hit); // nonlethal.js: a stun baton's shock
    return eff;
  }
  if (nonLethal && nlDown(b, t, by)) return eff; // knocked out, either side (nonlethal.js; the dead die as usual)
  swarmHit(t, by); // carriers.js: brought down by the worms, they are in them
  if (t.gunner) leaveTurret(b, t, true); // a turret's gunner drops back inside (theirs: their own gun on their body)
  if (MED.downedHit(b, t, by, eff)) return eff; // medics.js: a downed survivor hit again is finished; an enemy person goes down first
  if (t.side === "player") {
    t.down = true;
    (b.downedIds || (b.downedIds = [])).push(t.sid); // service record (relations.js)
    t.bleed = BLEED_TURNS;
    t.ow = t.hunker = false;
    if (b.rescue && t.captive && by && by.side === "enemy" && captiveHitMult(b, t, by) < 1) { t.stab = true; say(b, `${t.name} is beaten down: they want ${t.name.split(" ")[0]} alive.`, "death"); return eff; } // rescueraid.js: to be taken back
    say(b, `${t.name} is down and bleeding. Use meds on them within ${BLEED_TURNS} turns${b.raid ? "; once stabilized they are carried out when a teammate extracts" : ""}.`, "death");
  } else {
    t.dead = true;
    t.killedBy = by ? by.side : null;
    if (by && by.sid != null) { const k = (b.killsBy || (b.killsBy = {}))[by.sid] || (b.killsBy[by.sid] = { z: 0, h: 0 }); k[t.kind === "zombie" ? "z" : "h"]++; } // service record (relations.js)
    if (b.raid && t.kind === "human" && !searchedInBattle(b, t)) b.raid.containers.push({ id: b.nextId++, x: t.x, y: t.y, f: t.f || 0, kind: "body", area: null, searched: false, kit: t.kit, weapon: t.weapon, label: `${t.name}'s body`, uid: t.id }); // uid: dragged along with the body (stealth.js)
    else if (b.raid && t.bodyBox) dropBodyBox(b, t); // carriers.js: one of the risen, put down: the body it got up from (what was on it)
    // One of the dead: a body to search too (what the person had on them; a dead soldier's kit). The raid bot walks
    // over only for the armoured ones (botSkip: it searches an ordinary one when it is next to it anyway). A worm
    // swarm leaves nothing.
    else if (b.raid && t.kind === "zombie" && !t.boss && t.ztype !== "swarm" && t.ztype !== "sleeper") b.raid.containers.push({ id: b.nextId++, x: t.x, y: t.y, f: t.f || 0, kind: "body", zombie: true, ztype: t.ztype || null, area: null, searched: false, label: `${t.name}'s body`, uid: t.id, botSkip: !(t.ztype && ARMORED.includes(t.ztype)), plateDur: t.plateDur ?? null }); // plateDur: their plates' wear (deadsoldiers.js)
    if (b.raid && t.walking) walkingBox(b, t, b.raid.containers.find((k) => k.kind === "body" && k.uid === t.id)); // carriers.js: one of the walking dead put down: its things are in the body
    say(b, t.ztype === "swarm" ? `${t.name} is crushed and scattered.` : `${t.name} is dead.`, t.side === "third" ? "danger" : "good"); // thirdside.js: one of the third side fell
    if (t.ztype === "spitter") spitterBurst(b, t); // acid.js: its sac bursts over the tiles around it
    if (t.ztype === "carrier") burst(b, t); // carriers.js: the worm swarm comes out
    if (t.ztype === "swarm") t.off = true; // no body: gone from the map
    if (t.ztype === "flinger") onDeath(b, t); // middead.js: the mass it was winding up to throw spills out
    if (t.ztype === "sleeper") sleeperDies(b, t, hit); // sleepers.js: it splits where it lies, or the fire cooks it
    const own = bossAI(t);
    if (own && own.death) own.death(b, t); // registerBossAI: the Hivemind's brood collapses with it (hivecrawl.js)
  }
  return eff;
}

// Gunfire wakes everyone. Caught by your own opening shots, they stay flat-footed until their turn.
function alertAll(b, why) {
  const sleepers = b.units.filter((u) => u.side === "enemy" && !u.aware && active(u));
  if (!sleepers.length) return;
  for (const u of sleepers) { u.aware = true; if (b.phase === "player") u.surprised = true; }
  wakeLights(b, sleepers); // ailights.js: their flashlights on in the dark
  say(b, b.phase === "player" ? "Your shots catch them by surprise. They scramble but cannot react this turn." : why, "good");
}

export function alertPod(b, pod, why) {
  const sleepers = b.units.filter((u) => u.side === "enemy" && !u.aware && active(u) && u.pod === pod);
  if (!sleepers.length) return;
  for (const u of sleepers) u.aware = true;
  wakeLights(b, sleepers); // ailights.js: their flashlights on in the dark
  say(b, why, "danger");
  if (b.phase === "player") for (const u of sleepers) scramble(b, u);
}

// Freshly alerted humans dash for cover (XCOM-style), without spending their turn.
function scramble(b, u) {
  if (u.kind === "zombie" || !active(u)) return;
  const mv = bestMove(b, u, foesOf(b, u));
  if (mv) moveAlong(b, u, mv.path);
}

// An unaware enemy notices a player unit that comes close enough in its sight, or (a person) sees its light.
function detect(b, mover) {
  for (const e of b.units) {
    if (e.side !== "enemy" || e.aware || !active(e)) continue;
    // Light Step and Ghost (skills.js), night and a flashlight (stealth.js).
    const r = detectRange(b, e, mover);
    if (dist(e.x, e.y, mover.x, mover.y) <= r && los(b, e.x, e.y, mover.x, mover.y)) {
      alertPod(b, e.pod, `${e.name} spotted ${mover.name}!`);
    } else if (lightSpotted(b, e, mover)) alertPod(b, e.pod, `${e.name} sees ${mover.name}'s light!`);
  }
}
// A raider, a soldier, any enemy person (not the dead: they keep their own senses, decoys.js) who sees a light one of
// yours has switched on at night knows you are there (the user's request): canSee counts the light from the daylight
// range in its view cone (litFrom), past its noticing range. Night vision gives off no light: nothing to see.
export function lightSpotted(b, e, p) {
  if (!b.night || p.side !== "player" || !activeLight(p) || !active(p) || e.side !== "enemy" || e.kind !== "human" || e.ztype || !hasFront(e) || !active(e)) return false;
  if (b.floors && (e.f || 0) !== (p.f || 0)) return false;
  return canSee(b, e, p);
}

// A spike pit's stakes: the dead blunder on through it (hurt, the turn lost: moveAlong), the living are hurt and
// stopped in it (never your own people, who know where the pits are).
export const SPIKES = { DEAD: [18, 28], LIVING: [12, 20] };
export function moveAlong(b, u, path) {
  bindDims(b);
  if (!path.length) return;
  if (u.brace) delete u.brace; // stepping away lets go of a braced door (buildingmaps.js)
  u.movedT = b.turn; // moved this turn: a sniper rifle or the .50 on the move (gunfire.js braceAim), a sling's aim (gunmods.js situationalAim)
  const from = [u.x, u.y];
  const walked = [];
  let burned = false;
  let reacted = null; // overwatchers that have fired at this mover already (once each per move)
  const vaulted = []; // the half cover gone over on the way (VAULT): winded after it, a scuff, the raid's noise
  let stepI = -1; // the step's index in the path (a trench: the cell before it)
  for (const [x, y] of path) {
    stepI++;
    const there = unitAt(b, x, y);
    const last = x === path[path.length - 1][0] && y === path[path.length - 1][1];
    // Your people squeeze past the third side on the way (reachable: through, never stopping there); stopping at the
    // first of them left a man between two soldiers holding a corridor spending his actions where he stood, and the
    // raid never ended (tools/wanderertest.js seed 904, once the enemy guns' condition came by kit).
    if (there && (active(there) || last) && !(u.side === "player" && there.side === "third" && !last)) break;
    faceToward(u, x, y); // which way it faces (stealth.js: takedowns from behind)
    u.x = x; u.y = y;
    walked.push([x, y]);
    const over = b.cells[idx(x, y)];
    if (!CELL[over.k].walk && (vaultable(b, over) || windowOpen(over))) { // over half cover, through a window (windows.js)
      // A closed window crashed through: the glass goes with a crash (loud: WINDOW.BREAK) and cuts the vaulter.
      if (vaultBreaks(over)) {
        smashWindow(b, over);
        const cut = WINDOW.HURT[0] + Math.floor(hash01(b.rng.state, "glass", b.turn, x, y, u.id) * (WINDOW.HURT[1] - WINDOW.HURT[0] + 1));
        const eff = Math.round(damage(b, u, cut, null, false, { how: "glass" }));
        fx(b, { type: "melee", from: [x, y], to: [x, y], hit: true, crit: false, dmg: eff, side: u.side, text: `-${eff}` });
        say(b, `${u.name} crashes through the window: the glass goes with a crash${b.raid ? ` (Heat +${WINDOW.BREAK.heat})` : ""}, and cuts ${u.name.split(" ")[0]} (${eff}).`, "danger");
        glassNoise(b, x, y, { say, alertNear });
        vaulted.push("through the window");
      } else {
        vaulted.push(over.k === "window" ? "through the open window" : over.k === "smashed" ? "through the broken window" : `the ${CELL[over.k].name.toLowerCase()}`);
        if (u.kind === "zombie" && playerSees(b, u)) fx(b, { type: "melee", from: [x, y], to: [x, y], hit: true, crit: false, dmg: 0, side: u.side, text: "CRAWL" }); // barricade.js: the crawl seen
      }
      if (!active(u)) break; // cut down on the sill (the glass, overwatch): it falls back below
    }
    // A building's closed door swings open (buildingmaps.js); anyone but your people stops in the doorway to open it.
    const stopAtDoor = b.cells[idx(x, y)].k === "idoor" && openDoor(b, x, y, u) && u.side !== "player";
    // Traps on a base's battle map (defences.js): spikes hurt the dead, a trench stops them for the turn.
    const trap = CELL[b.cells[idx(x, y)].k].trap;
    if (trap && u.kind === "zombie") {
      if (trap === "spikes") { const eff = Math.round(damage(b, u, b.rng.int(SPIKES.DEAD[0], SPIKES.DEAD[1]), null)); say(b, `${u.name} is impaled in a spike pit (${eff}).`, "good"); }
      else if (trap === "beartrap") {
        const eff = Math.round(damage(b, u, b.rng.int(14, 22), null));
        u.ap = 0;
        b.cells[idx(x, y)].k = "open"; // sprung
        say(b, `${u.name} is caught in a bear trap (${eff}).`, "good");
      } else if (trap === "wire" && b.cells[idx(x, y)].razor) {
        const eff = Math.round(damage(b, u, b.rng.int(WIRE.RAZOR_DEAD[0], WIRE.RAZOR_DEAD[1]), null));
        u.ap = 0; say(b, `${u.name} is caught in the razor wire (${eff}).`, "good");
      } else { u.ap = 0; say(b, trap === "wire" ? `${u.name} is snagged on the barbed wire.` : `${u.name} flounders in the trench.`, "good"); }
      if (!active(u) || trap !== "spikes") break;
    }
    if (trap === "wire" && u.kind !== "zombie" && wireStep(null, b, u, x, y, { say, damage, fx })) break; // wire.js: the living snagged, or cutting through
    if (b.cells[idx(x, y)].mine && mineStep(b, u, x, y, { say })) break; // mines.js: a mine underfoot (never one of yours)
    // A spike pit (buildings.js spike_pits, the user's request 2026-10-19: they hurt raiders too): anyone not of yours
    // drops through the cover onto the stakes (SPIKES.LIVING) and the move ends there; yours know where the pits are.
    if (trap === "spikes" && u.kind !== "zombie" && u.side !== "player") {
      const eff = Math.round(damage(b, u, b.rng.int(SPIKES.LIVING[0], SPIKES.LIVING[1]), null, false, { how: "spikes" }));
      fx(b, { type: "melee", from: [x, y], to: [x, y], hit: true, crit: false, dmg: eff, side: "player", text: "SPIKES" });
      say(b, `${u.name} falls into a spike pit (${eff}).`, "good");
      break;
    }
    // A trench (buildings.js trench, the user's request 2026-10-19: it slows the dead more than the living): the dead
    // lose the rest of their turn (above); the living drop in and the move ends there, their next action kept to climb
    // out. Once a trench: moving along it from a cell of it costs nothing more.
    if (trap === "trench" && u.kind !== "zombie") {
      const [px, py] = stepI > 0 ? path[stepI - 1] : from;
      if (b.cells[idx(px, py)].k !== "trench") {
        if (playerSees(b, u) || u.side === "player") say(b, `${u.name} drops into the trench.`, u.side === "player" ? "info" : "good");
        break;
      }
    }
    if (!burned && fireStep(b, u, x, y)) { burned = true; if (!active(u)) break; } // into a Molotov's flames (throwables.js): once a move
    if (acidStep(b, u, x, y) && !active(u)) break; // into a spitter's acid (acid.js): once a round
    // Overwatch (sustained, section 20): every enemy that moves within range and in sight draws a reaction (once per
    // move), at the reaction penalty and in the watcher's fire mode, until the watcher's own next turn or until its
    // magazine runs dry or it jams. Pinned by suppressing fire: no overwatch.
    for (const o of b.units) {
      if (!o.ow || o.stun || nlNoOw(o) || o.side === u.side || !active(o) || !active(u) || !hostilePair(b, o, u)) continue; // thirdside.js: not at the third side unless at odds; stun: a flashbang or a taser (throwables.js); nlNoOw: pepper spray (nonlethal.js)
      if (o.suppressed) { o.ow = false; continue; }
      if (reacted && reacted.has(o.id)) continue;
      if (!canSee(b, o, u) || !canFire(b, o) || dist(o.x, o.y, u.x, u.y) > owRange(o)) continue;
      if (!inArc(o, u.x, u.y, VISION.HALF)) continue; // vision.js: an overwatch covers only the watcher's view cone
      (reacted || (reacted = new Set())).add(o.id);
      say(b, `${o.name} reacts on overwatch.`, "info");
      fire(b, o, u, { reaction: true });
      if (!canFire(b, o)) o.ow = false; // empty or jammed: the watch is over
    }
    if (u.side === "player" && active(u)) detect(b, u);
    if (b.corpses && b.corpses.length && u.kind !== "zombie" && active(u)) { wakeNear(b, u); spotCheck(b, u); } // sleepers.js: a Sleeper next to them splits open
    if (!active(u) || stopAtDoor) break;
  }
  // Dropped on the cover it was going over (an overwatch shot, the flames, the glass): it falls back off it, to the
  // cell before (nobody stands on a cell nobody can walk on).
  if (walked.length && !CELL[b.cells[idx(u.x, u.y)].k].walk) { walked.pop(); const back = walked.length ? walked[walked.length - 1] : from; u.x = back[0]; u.y = back[1]; }
  if (vaulted.length) {
    u.vaulted = (u.vaulted || 0) + (u.kind === "zombie" ? CRAWL.COST : VAULT.COST) * vaulted.length; // winded: moveMob for the rest of the turn (the dead crawled: barricade.js)
    if (u.side === "player") { b.noise = (b.noise || 0) + VAULT.NOISE * vaulted.length; say(b, `${u.name} vaults ${[...new Set(vaulted)].join(" and ")}.`, "info"); }
    else if (u.kind === "zombie" && playerSees(b, u)) say(b, `${u.name} crawls ${[...new Set(vaulted)].map((w) => (w.startsWith("through") ? w : `over ${w}`)).join(" and ")}.`, "info"); // barricade.js CRAWL: seen by one of yours
  }
  if (walked.length) fx(b, { type: "move", unit: u.id, from, path: walked });
  if (walked.length && u.dragging != null) MED.dragFollow(b, u, from, walked); // medics.js: the downed ally comes along behind
  if (walked.length && u.ram != null) afterMove(b, u); // siege.js: the ram's crew keeps up with its lead
  if (walked.length) u.movedT = b.turn; // moved this turn: a heavy or big gun's brace (data-guns.js heavy / brace)
  if (walked.length && u.spearOut && active(u)) stepOnSpear(b, u); // walked onto the spear it threw: picked up
}

// Sneaking on or off (vision.js; free). Not on while an aware enemy has eyes on them (counting the cover it would give).
function sneakAct(b, u, act) {
  const on = act.on != null ? !!act.on : !u.sneaking;
  if (on === !!u.sneaking) return "";
  if (on && u.ap < 1) return "No actions left: sneak from the next turn.";
  if (on && (u.aboard || u.gunner)) return "Get out of the vehicle first.";
  if (on) {
    const eyes = b.units.find((e) => e.side !== "player" && e.aware && active(e) && !e.ko && canSee(b, e, { ...u, sneaking: true }));
    if (eyes) return `${eyes.name} has eyes on ${u.name}: get out of sight first.`;
  }
  u.sneaking = on;
  say(b, on ? `${u.name} keeps low and moves quietly.` : `${u.name} stops sneaking.`, "info");
  bump(b);
  return "";
}
// A light or night vision switched on or off (vision.js activeLight / nvgOn; free, even with no actions left). act.on:
// true or false, or left out to flip it. What they see follows at once (stealth.js senses); a light switched on at
// night can be seen at once by an enemy facing it (detect: lightSpotted).
function switchAct(state, b, u, act) {
  const nv = act.type === "nvg", key = nv ? "nvgOff" : "lightOff";
  if (nv ? !u.nvg : !u.light) return nv ? `${u.name} has no night vision (goggles, or a thermal).` : `${u.name} has no light.`;
  if (u.aboard || u.gunner) return "Get out of the vehicle first.";
  const on = act.on != null ? !!act.on : !!u[key];
  if (on === !u[key]) return "";
  u[key] = !on;
  senses(b, u, u.sid != null ? survivorById(state, u.sid) : undefined);
  const first = u.name.split(" ")[0], lamp = (LIGHTS[u.light] && LIGHTS[u.light].name) || "light";
  if (nv) say(b, on ? `${u.name} switches on the night vision${b.night ? `: ${nvgSight(u)} tiles down the cone, and no light to give them away` : ""}.` : `${u.name} flips the night vision up${b.night ? (activeLight(u) ? `: the ${lamp} is what ${first} sees by now` : `: ${first} sees only what the dark lets them`) : ""}.`, "info");
  else say(b, on ? `${u.name} switches on the ${lamp}${b.night ? `. It gives ${first} away: anyone facing it sees it from far off${u.sneaking ? ", sneaking or not" : ""}` : ""}.` : `${u.name} switches off the ${lamp}.`, on && b.night ? "danger" : "info");
  if (on && !nv && b.night) detect(b, u);
  bump(b);
  return "";
}
// The way a unit ends up facing after an order (vision.js): act.face (radians), or act.faceX / act.faceY (a cell to
// look at). Returns true when it was given one.
function faceAfterMove(u, act) {
  if (act && Number.isFinite(Number(act.face)) && act.face !== null && act.face !== "") { setFacing(u, Number(act.face)); return true; }
  if (act && act.faceX != null && act.faceY != null && Number.isFinite(Number(act.faceX)) && Number.isFinite(Number(act.faceY))) {
    const x = Number(act.faceX), y = Number(act.faceY);
    if (x === u.x && y === u.y) return false;
    faceToward(u, x, y);
    return true;
  }
  return false;
}
// Feet heard (vision.js stepNoise): a dash far off, a scuff close by. The unaware within earshot (and the dead that
// hear) come to look where the noise was (stealth.js noiseAt).
function footsteps(b, u, kind) {
  if (!kind) return;
  const r = kind === "dash" ? VISION.DASH_NOISE : VISION.STEP_NOISE.r;
  fx(b, { type: "noise", x: u.x, y: u.y, r, side: u.side, kind });
  const n = noiseAt(b, u.x, u.y, r, "footsteps");
  if (n) say(b, kind === "dash" ? `${u.name}'s running feet are heard: ${n} of them turn toward the noise.` : `${u.name} scuffs a foot: ${n} of them turn toward the noise.`, "danger");
}

// What a shot's hit carries into damage() / hitMult (ammo.js; section 1): the weapon, its calibre and the type loaded
// (cal, ammo: the armour code reads them; ammo also the soft-target bonus), and whether it spreads (buckshot,
// birdshot: a worm swarm, carriers.js swarmArmor; swarm: birdshot's extra against it).
export function shotHit(a, crit = false) {
  const r = unitRound(a); // the round loaded (a 5.56 gun's .223: cal "223"; ammo is the bare type)
  const cal = r ? r.cal : null;
  const ammo = r ? r.type : null;
  const fx = typeFx(ammo);
  return { how: "shot", crit, weapon: a.weapon, cal, ammo, spread: cal ? !!fx.spread : undefined, swarm: fx.swarm || 1, ...(fx.nonlethal ? { nonLethal: true } : {}) }; // nonLethal: beanbags, rubber (the non-lethal branch's damage hook)
}

// How far an overwatcher reacts: its gun's best range and 8 tiles more (the reaction's own odds do the rest).
const owRange = (o) => { const w = WEAPONS[o.weapon]; return modRange(w, unitMods(o)).opt + 8; };
// One trigger pull (gunfire.js): the fire mode's rounds (a gun without modes: its rounds, one roll), the jam or misfire
// roll, each round's own hit at the mode's aim (the first round on the battle's rng as a single shot always was, the
// rest on the battle's own dice), a round that gets through carrying on to the next unit in line (over-penetration).
export function fire(b, a, t, opts = {}) {
  const w = WEAPONS[a.weapon];
  const rng = b.rng;
  if (w.cooldown) a.cd = w.cooldown; // a spitter spits every other turn (zombietypes.js zTick)
  if (a.side !== "player") aiMode(b, a, t, opts); // gunfire.js: enemies pick a mode (yours keep the one you set)
  const mode = modeOf(a), moded = !!gunModes(w);
  let rounds = modeRounds(a, mode);
  if (moded || w.mounted) { // a turret's last burst: the rounds left on the belt (magEmpty)
    if (hasMag(a)) rounds = Math.min(rounds, magIn(a));
    if (a.side === "player") rounds = Math.min(rounds, roundsOf(b, a)); // ammo.js: its calibre and loaded type
    rounds = Math.max(1, rounds);
  }
  const trig = w.rel ? rollTrigger(b, a, rounds) : { fired: rounds, spent: rounds, jam: null, misfire: false };
  spendRounds(b, a, trig.spent === w.ammo ? w : { ...w, ammo: trig.spent }); // the magazine; your side's pools (the magazines section above)
  if (w.cal) foul(a, trig.spent); // gunfire.js: rounds through it since it was cleaned
  if (a.side === "player") {
    if (a.gearRisk && a.item && rng.chance(a.gearRisk)) {
      a.item.quality = Math.max(0.4, Math.round(((a.item.quality || 1) - 0.15) * 100) / 100);
      say(b, `${a.name}'s ${a.item.name} was damaged (it is above their skill).`, "danger");
    }
  }
  faceToward(a, t.x, t.y);
  if (trig.misfire) { // a dud: no shot, no bang, the action lost
    say(b, `${a.name}'s ${gunWord(a)} misfires: click.`, a.side === "player" ? "danger" : "info");
    fx(b, { type: "shot", from: [a.x, a.y], to: [t.x, t.y], hit: false, side: a.side, misfire: true });
    return;
  }
  const noise = shotNoise(b, a, w); // stealth.js: a suppressor halves it (and wears a shot)
  b.noise += noise;
  if (noise) b.gunshots = (b.gunshots || 0) + noise / w.noise; // camp danger (fieldheat.js noteGunfire): a muffled shot counts half
  if (a.sneaking && noise && noise >= w.noise) { a.sneaking = false; say(b, `${a.name}'s shot gives them away: no longer sneaking.`, "info"); } // vision.js: a suppressed shot or a bow keeps it
  deafen(b, a.x, a.y, bangOf(b, a, w, noise, mode), a); // hearing.js: the bang (one an action; a stream louder)
  if (a.xpT) a.xpT.shots++;
  const rolls = moded ? trig.fired : trig.jam ? 0 : 1; // a gun without modes (or a bow: no rounds at all) makes one roll unless it jammed
  const line = sayFirst(b);
  let hits = 0, crits = 0, total = 0, first = null, hull = 0;
  for (let k = 0; k < rolls; k++) {
    if (k > 0 && !active(t)) break; // the rest of the burst goes past where they stood
    const o = shotOdds(b, a, t, a.x, a.y, moded ? { ...opts, modeAim: modeAim(mode, k, w) } : opts);
    if (!first) first = o;
    const hit = k === 0 ? rng.chance(o.chance / 100) : battleDice(b, "burst") < o.chance / 100;
    if (!hit) { if (t.gunner && !opts.onHit && battleDice(b, "hull") < HULL.MISS) hull += strikeHull(carOf(b, t), shotHit(a, false)); continue; } // the gunners' duel: a miss into the vehicle under them

    const crit = k === 0 ? rng.chance(o.crit / 100) : battleDice(b, "burstcrit") < o.crit / 100;
    const raw = (k === 0 ? rng.int(o.dmg[0], o.dmg[1]) : o.dmg[0] + Math.floor(battleDice(b, "burstdmg") * (o.dmg[1] - o.dmg[0] + 1))) * (crit ? CRIT_MULT : 1);
    const info = shotHit(a, crit); // ammo.js: weapon, spread (a shotgun's buckshot catches a worm swarm, carriers.js swarmArmor); cal, ammo: the round loaded (armour.js, over-penetration)
    total += opts.onHit ? opts.onHit(raw, info) : damage(b, t, raw, a, false, info); // onHit: a shot at a vehicle's cab (fireCab)
    hits++;
    if (crit) crits++;
    if (a.xpT) { a.xpT.hits++; if (t.dead) a.xpT.kills++; } // skills.js: Shooting XP when the battle ends
    if (w.cal && !opts.onHit) overpenetrate(b, a, t, raw, info, moded ? modeAim(mode, k, w) : 0, opts);
  }
  const eff = Math.round(total);
  const pct = first ? first.chance : 0;
  let text;
  if (!rolls) text = `${a.name}'s ${gunWord(a)} jams before it fires.`;
  else if (moded && mode !== "single") {
    const how = mode === "auto" ? "a stream" : "a burst";
    text = hits ? `${a.name} fires ${how} at ${t.name}: ${hits} of ${rolls} hit${crits ? ` (${crits} critical)` : ""} for ${eff} (${pct}%).` : `${a.name} fires ${how} at ${t.name} and misses (${pct}%).`;
  } else if (hits) text = w.acid ? `${a.name} spits acid at ${t.name}: ${crits ? "critical hit" : "hit"} for ${eff} (${pct}%).` : `${a.name} shoots ${t.name}: ${crits ? "critical hit" : "hit"} for ${eff} (${pct}%).`;
  else text = w.acid ? `${a.name} spits acid at ${t.name} and misses (${pct}%).` : `${a.name} shoots at ${t.name} and misses (${pct}%).`;
  if (rolls) fx(b, hits ? { type: "shot", from: [a.x, a.y], to: [t.x, t.y], hit: true, crit: crits > 0, dmg: eff, side: a.side, acid: !!w.acid, rounds: rolls, hits } : { type: "shot", from: [a.x, a.y], to: [t.x, t.y], hit: false, side: a.side, acid: !!w.acid, rounds: rolls });
  if (hull) { const hv = carOf(b, t); text += ` The ${hv ? hv.name || hv.kind : "vehicle"} under ${t.name} takes −${Math.round(hull * 10) / 10}.`; }
  line.text = text;
  line.k = a.side === "player" ? (hits ? "good" : "info") : hits ? "danger" : "info";
  if (trig.jam) { jamGun(b, a, trig.jam); say(b, `${a.name}'s ${gunWord(a)} jams: ${jamLabel(a).toLowerCase()}!`, a.side === "player" ? "danger" : "good"); }
  gunfireAlert(b, a, w, noise, "The muffled shots still carry.", "The gunshots alert everything nearby.", "The gunshots alert everyone nearby.");
  noteShot(b, a, w, noise, moded && mode !== "single"); // crossfire.js: a shot of theirs your people hear but do not see: a marker in the fog with a guess of the gun
  // Any hit that leaves a sleeper alive wakes its group, however quiet the weapon (a crossbow bolt, a shot from
  // beyond earshot in a raid). crossfire.js: one of the dead hit by a raider goes for the shooter instead.
  if (hits && t.side === "enemy" && !t.dead && !t.aware && !crossHit(b, a, t)) alertPod(b, t.pod, `${t.name} cries out!`);
  if (w.mounted) afterTurretBurst(b, a, t, rolls > 0); // the turret: its belt, Heat, the pin (none when it jammed before firing)
}
// Who hears a shot (fire, suppressing fire): in a raid those near it, a muffled one near it, else everyone.
function gunfireAlert(b, a, w, noise, muffled, raid, all) {
  if (noise && b.raid) alertNear(b, a.x, a.y, (9 + w.noise * 2) * (noise / w.noise), noise < w.noise ? muffled : raid, a);
  else if (noise && noise < w.noise) alertNear(b, a.x, a.y, (9 + w.noise * 2) * (noise / w.noise), muffled, a);
  else if (noise) alertAll(b, all);
}
// Over-penetration (section 20, R6): a hit that got through the armour (or killed) carries on, by the round's chance
// (data-ammo.js AMMO_TYPES overpen: .50 always), along the line to the next unit of either side, at × 0.6 with its own
// roll; .50 and AP rounds go through light cover on the way.
function overpenetrate(b, a, t, raw, info, aimK, opts) {
  const r = roundOf(a, info);
  const p = overpenChance(r.cal, r.type);
  if (!(p > 0) || (info.through === false && !t.dead)) return;
  if (p < 1 && battleDice(b, "overpen") >= p) return;
  const nx = nextInLine(b, a, t, piercesCover(r.cal, r.type));
  if (!nx) return;
  const n2 = nx.unit;
  const o = shotOdds(b, a, n2, a.x, a.y, { ...opts, modeAim: aimK, pierce: nx.pierced ? 1 : 0 });
  if (battleDice(b, "overpenhit") >= o.chance / 100) return;
  const eff = Math.round(damage(b, n2, raw * OVERPEN.MULT, a, false, { ...info, crit: false, overpen: true }));
  say(b, `The round goes through ${t.name}${nx.pierced ? " and the cover behind" : ""} and hits ${n2.name} for ${eff}.`, n2.side === a.side ? "danger" : a.side === "player" ? "good" : "danger");
  fx(b, { type: "shot", from: [t.x, t.y], to: [n2.x, n2.y], hit: true, crit: false, dmg: eff, side: a.side, overpen: true });
  if (a.xpT && n2.dead && n2.side !== a.side) a.xpT.kills++;
}

// Suppressing fire (act "suppress", section 20): a stream (full auto, else two bursts) into a cone toward a person or a
// spot. No hit roll worth the name (a third of the shot's chance each, for whoever is in the cone); everyone living in
// the cone is pinned until their own turn ends: −20 aim, no overwatch, the AI keeps to cover. Nothing to the dead.
export function suppress(b, a, x, y) {
  const w = WEAPONS[a.weapon];
  const rounds = Math.max(1, Math.min(suppressRounds(a), hasMag(a) ? magIn(a) : Infinity, a.side === "player" ? roundsOf(b, a) : Infinity)); // ammo.js: its calibre and loaded type
  const trig = w.rel ? rollTrigger(b, a, rounds) : { fired: rounds, spent: rounds, jam: null, misfire: false };
  spendRounds(b, a, { ...w, ammo: trig.spent });
  foul(a, trig.spent);
  faceToward(a, x, y);
  a.hunker = false;
  const noise = shotNoise(b, a, w);
  b.noise += noise;
  if (noise) b.gunshots = (b.gunshots || 0) + noise / w.noise;
  if (a.xpT) a.xpT.shots++;
  if (trig.fired > 0) deafen(b, a.x, a.y, bangOf(b, a, w, noise, gunModes(w) && gunModes(w).auto ? "auto" : "burst"), a); // hearing.js
  const pinned = trig.fired > 0 ? coneTargets(b, a, x, y, foesOf(b, a)) : [];
  for (const t of pinned) {
    t.suppressed = SUPPRESS.TURNS;
    t.ow = false;
    const o = shotOdds(b, a, t, a.x, a.y, { modeAim: modeAim("auto", 0, w) });
    if (battleDice(b, "suppresshit") < (o.chance / 100) * SUPPRESS.HIT) {
      const raw = o.dmg[0] + Math.floor(battleDice(b, "suppressdmg") * (o.dmg[1] - o.dmg[0] + 1));
      const eff = Math.round(damage(b, t, raw, a, false, shotHit(a, false))); // ammo.js: the round loaded
      say(b, `${t.name} is hit by the suppressing fire for ${eff}.`, a.side === "player" ? "good" : "danger");
      if (a.xpT) { a.xpT.hits++; if (t.dead) a.xpT.kills++; }
    }
  }
  const names = pinned.filter((t) => !t.dead && !t.down).map((t) => t.name);
  say(b, trig.fired ? `${a.name} lays down suppressing fire (${trig.fired} rounds)${names.length ? `: ${names.join(", ")} ${names.length === 1 ? "is" : "are"} pinned (−${SUPPRESS.AIM} aim, no overwatch).` : ", pinning no one."}` : `${a.name}'s ${gunWord(a)} jams before it fires.`, a.side === "player" ? "info" : "danger");
  fx(b, { type: "shot", from: [a.x, a.y], to: [x, y], hit: false, side: a.side, suppress: true, rounds: trig.fired });
  if (trig.jam) { jamGun(b, a, trig.jam); say(b, `${a.name}'s ${gunWord(a)} jams: ${jamLabel(a).toLowerCase()}!`, a.side === "player" ? "danger" : "good"); }
  if (trig.fired) gunfireAlert(b, a, w, noise, "The muffled shots still carry.", "The gunfire alerts everything nearby.", "The gunfire alerts everyone nearby.");
  if (trig.fired) noteShot(b, a, w, noise, true); // crossfire.js: heard, not seen
}

// Where a blow landed and what took it, for its sound (ui/sfx-melee.js): loc, the armour's material (armour.js mat:
// soft, padding, hard, steel, ceramic) and whether the blow went through it.
const blowFx = (h) => (h.piece ? { loc: h.loc, mat: (armourSpec(h.piece.key) || {}).mat || "hard", through: !!h.through } : h.loc ? { loc: h.loc } : {});
export function strike(b, a, t) {
  if (nlStrike(b, a, t)) return; // nonlethal.js: pulling the blows on a living person
  const o = meleeOdds(b, a, t);
  const rng = b.rng;
  const sure = !!a.assassin && t.side === "enemy" && !t.aware; // Assassin (skills.js): sure, critical hit on the unaware
  faceToward(a, t.x, t.y);
  const amb = a.low ? strikeBonus(b, a) : 1; // a crawler out of hiding (zombietypes.js)
  const w = WEAPONS[a.weapon];
  const gap = t.ztype ? stabsGap(a, t) || (!!w.stab && stabsGap({ x: a.x, y: a.y, weapon: "knife" }, t)) : false; // a blade from behind or on the unaware finds a dead soldier's gap (deadsoldiers.js; w.stab: a combat knife)
  const hit = rng.chance(o.chance / 100) || sure;
  const line = sayFirst(b);
  if (a.xpT) a.xpT.swings++; // skills.js: Melee XP when the battle ends (a swing, a blow landed, a kill)
  if (hit) {
    const crit = rng.chance(o.crit / 100) || sure;
    const h = { how: WEAPONS[a.weapon].melee ? "melee" : "bash", crit, sneak: gap };
    const eff = Math.round(damage(b, t, rng.int(o.dmg[0], o.dmg[1]) * (crit ? CRIT_MULT : 1) * (a.meleeMult || 1) * amb, a, false, h)); // meleeMult: Brawler
    if (gap && t.dead) say(b, `${a.name} drives the blade in under ${t.name}'s helmet.`, "good");
    if (a.xpT) { a.xpT.melee++; if (t.dead) a.xpT.mkills++; }
    line.text = `${a.name} ${a.kind === "zombie" ? "tears into" : "strikes"} ${t.name} for ${eff}.${meleeAfter(b, a, t, w, crit)}`; // stagger, bleeding (the melee section above)
    line.k = a.side === "player" ? "good" : "danger";
    fx(b, { type: "melee", from: [a.x, a.y], to: [t.x, t.y], hit: true, crit, dmg: eff, side: a.side, ...blowFx(h) });
  } else {
    line.text = `${a.name} lunges at ${t.name} and misses.`;
    fx(b, { type: "melee", from: [a.x, a.y], to: [t.x, t.y], hit: false, side: a.side });
  }
  // A struck sleeper that survives wakes its group.
  if (t.side === "enemy" && !t.dead && !t.aware && !crossHit(b, a, t)) alertPod(b, t.pod, `${t.name} cries out!`); // crossfire.js: one of theirs struck by the other half of their side: no wake to you
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
    const amt = Math.round((15 + u.medicine * 1.5) * (u.healMult || 1) * (t.wormed ? WORM.HEAL : 1)); // healMult: Steady Hands; the worm (worm.js): half
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
  noteJamWeather(state, b); // gunfire.js: rain, mud or a storm make guns jam more (once a battle)
  if (act.type === "end") {
    if (b.raid && b.raid.choose) b.raid.choose = null; // the street it is (buildingmaps.js)
    closePlan(b); // raidplan.js: in as they are
    if (b.phase === "player") endPlayerTurn(state);
    return "";
  }
  if (b.setup.drill) { const err = drillAct(state, b, act); if (!err && state.combat === b) bump(b); return err; } // defenceplan.js: a defence drill, nothing is fought
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
  if (act.type === "takeAlive") { setTakeAlive(b, act.on); bump(b); return ""; } // nonlethal.js: the AI playing your side prefers non-lethal
  if (act.type === "evac") { const why = evacRefusal(b); if (why) return why; b.evacOrder = true; say(b, "Evac! Everyone heads for the way out.", "danger"); evacTurn(state, b); return ""; } // evacTurn: everyone to the exits or the vehicle
  if (act.type === "evacStop") { b.evacOrder = false; say(b, "The evac is called off.", "info"); bump(b); return ""; }
  if (act.type === "dropCarried" || act.type === "dropAllCarried") { const err = carriedAct(state, b, act); if (!err) bump(b); return err; } // carry.js: free, even with no actions left
  if (act.type === "letGoCart") { const err = cartAct(state, b, act); if (!err) bump(b); return err; } // carts.js: let go of a cart (free)
  const u = unitById(b, act.unit);
  if (u && u.vol != null && u.side === "player" && act.type === "volOrder") return volOrder(b, u, act); // volunteers.js: a simple order they follow in their own way
  if (u && u.vol != null && u.side === "player" && !aiDrive) return volRefusal(u); // volunteers.js: their group's orders, not yours
  // A unit on another storey than the one being looked at (buildingmaps.js storeys): acting with it looks at its floor.
  if (u && u.side === "player" && b.floors && (u.f || 0) !== (b.floor || 0) && activeAny(u)) setFloor(b, u.f || 0);
  // Aboard the team's vehicle (boardVehicle): off the map, but they can drive it, turn it, get out, or extract with it.
  const aboardAct = u && u.aboard && !u.dead && ["drive", "turn", "disembark", "extract", "gunner"].includes(act.type);
  // A captive still tied up or locked in (rescueraid.js): only the rescue actions (work the ropes, pick the lock...).
  const boundAct = u && isTied(u) && !u.dead && !u.down && act.type === "rescue";
  if (u && isTied(u) && !u.down && !boundAct && u.side === "player") return rescueRefusal(b, u);
  if (u && u.side === "player" && act.type === "selfStab") { const why = MED.selfStabilize(b, u); if (why) return why; b.acted = true; bump(b); return ""; } // medics.js: a downed survivor's tourniquet or trauma kit
  if (u && u.side === "player" && act.type === "sneak" && active(u)) return sneakAct(b, u, act); // vision.js: free, even with no actions left to stop
  if (u && u.side === "player" && (act.type === "light" || act.type === "nvg") && active(u)) return switchAct(state, b, u, act); // vision.js: a light, night vision on or off (free, even with no actions left)
  if (u && u.side === "player" && (act.type === "inv" || act.type === "handover") && active(u) && u.ap < INV_AP) return "No action left."; // the inventory window says why (invAct, handoverAct)
  if (u && u.side === "player" && act.type === "checkwindow" && active(u)) { const err = windowAct(state, b, u, act, { say, alertNear, fx }); if (!err) bump(b); return err; } // windows.js: trying a window is free, even with no actions left
  if (!u || u.side !== "player" || !(active(u) || aboardAct || boundAct) || u.ap < 1) return "That unit cannot act.";
  // On the turret (manTurret): fire it, reload the belt, watch, drive, or get down.
  if (b.vehicle && b.vehicle.blownUp && ["board", "drive", "turn", "gunner"].includes(act.type)) return "The vehicle is a burnt-out wreck."; // launchers.js: blown up
  if (u.gunner && !GUNNER_ACTS.has(act.type)) return "On the turret: fire, reload the belt, overwatch, drive, or get down (Man the turret again).";
  if (act.type === "turret") { if (!u.gunner) return vehicleTurret(b) ? "Man the turret first." : "No turret here."; act = { ...act, type: "shoot" }; }
  const t = act.target != null ? unitById(b, act.target) : null;
  { const why = handsRefusal(u, act.type); if (why) return why; } // carry.js: hands full of supplies (or a body): no weapon, no throw, no treating
  switch (act.type) {
    case "takeCart": case "parkCart": { const err = cartAct(state, b, act); if (err) return err; break; } // carts.js: a cart within reach back in the arms; park the one pushed on a side cell (1 action each)
    case "pickCarried": { const err = pickCarried(state, b, u); if (err) return err; u.ap -= 1; u.hunker = false; break; } // carry.js: a load set down within reach, back in the arms (1 action)
    case "move": {
      if (!inside(act.x, act.y)) return "Cannot move there.";
      const r = reachable(b, u, dashRange(u), { manual: true, wary: !!act.wary }); // wary: the raid bot goes round acid (acid.js)
      const c = r.dist[idx(act.x, act.y)];
      if (!isFinite(c) || c === 0) return "Cannot move there.";
      const mob = moveMob(u);
      u.ap -= c <= mob ? 1 : 2;
      u.hunker = false;
      const v0 = u.vaulted || 0;
      moveAlong(b, u, pathTo(r, act.x, act.y));
      // vision.js: where they end up facing (the player's pick), and the noise of their feet (a vault: a scuff at least).
      if (active(u)) faceAfterMove(u, act);
      if (active(u)) footsteps(b, u, stepNoise(b, u, c, mob) || ((u.vaulted || 0) > v0 && !u.sneaking ? "scuff" : ""));
      cartMoved(state, b, u); // carts.js: a helper follows the pusher (or lets go), a cart pushed rattles
      // skills.js: Stealth XP for moving while enemies still have not noticed anyone.
      if (u.xpT && active(u) && b.units.some((e) => e.side === "enemy" && !e.aware && active(e))) u.xpT.sneak++;
      break;
    }
    case "face": { // vision.js: turn where they stand (free: it needs an action left, it does not use one)
      if (!faceAfterMove(u, act)) return "Face which way?";
      bump(b);
      return "";
    }
    case "cab": { // fire at the other side's vehicle: its hull, whoever is at the wheel (fireCab)
      if (!isRanged(u)) return "No gun.";
      if (!canFire(b, u)) return fireRefusal(b, u);
      const tgt = cabTarget(b, u);
      if (!tgt) return "No vehicle of theirs in sight.";
      fireCab(b, u, tgt);
      u.ap = 0;
      break;
    }
    case "shoot": {
      if (t && t.side === "enemy" && t.down && !t.dead) return `${t.name} is down: Finish them (Shift+K) to kill them for good, or leave them${t.ko ? "" : " to bleed"}.`; // medics.js: never by default
      if (!t || t.side === "player" || !active(t)) return "No target.";
      if (!isRanged(u)) return "No gun.";
      if (!canFire(b, u)) return fireRefusal(b, u);
      if (!canSee(b, u, t)) return "No line of sight.";
      fire(b, u, t);
      u.ap = 0;
      break;
    }
    case "melee": {
      // No one there but something to batter next to you (a tank trap, a wall section): a blow at it (bash).
      if (!t && act.x != null && inside(Number(act.x), Number(act.y)) && breakable(b.cells[idx(Number(act.x), Number(act.y))]) && Math.max(Math.abs(u.x - act.x), Math.abs(u.y - act.y)) <= 1 && !unitAt(b, Number(act.x), Number(act.y))) {
        bash(b, u, Number(act.x), Number(act.y));
        u.ap = 0;
        break;
      }
      if (t && t.side === "enemy" && t.down && !t.dead) return `${t.name} is down: Finish them (Shift+K) to kill them for good.`; // medics.js
      const why = meleeRefusal(b, u, t); // next to it (not across a wall's corner), or 2 tiles off with a spear; one strike a turn with a quick weapon
      if (why) return why;
      strike(b, u, t);
      if (WEAPONS[u.weapon].quick) { u.struck = strikeMark(b); u.ap -= 1; } else u.ap = 0; // quick: strike, then step away
      break;
    }
    case "throwspear": { // a spear thrown at a cell (act.x, act.y) or at someone (act.target): 1 action
      const x = t ? t.x : Number(act.x), y = t ? t.y : Number(act.y);
      const why = spearThrowRefusal(b, u, x, y);
      if (why) return why;
      throwSpear(b, u, x, y, survivorById(state, u.sid));
      u.ap -= 1;
      break;
    }
    case "pickspear": { // your thrown spear, from the cell next to it (walking onto it picks it up for free)
      const why = pickSpearRefusal(b, u);
      if (why) return why;
      u.ap -= 1;
      rearm(b, u, ownSpear(b, u));
      break;
    }
    case "drive": { // the team's vehicle (DRIVE, driveTo): from inside or next to it, both actions, loud; through people and light obstacles (RAMMING)
      if (!b.vehicle) return "You came on foot: there is no vehicle here.";
      if (!u.aboard && !atVehicle(b, u)) return "Stand next to the vehicle (or get in) to drive it.";
      if (u.ap < DRIVE.AP) return "Driving takes both actions.";
      const err = driveTo(b, u, Number(act.x), Number(act.y));
      if (err) return err;
      break;
    }
    case "board": { const err = boardVehicle(b, u); if (err) return err; break; } // in (1 action, SEATS)
    case "gunner": { const err = manTurret(b, u); if (err) return err; break; } // up behind the turret, or back down (1 action)
    case "disembark": { const err = disembark(b, u); if (err) return err; break; } // out onto a free cell round it (1 action)
    case "turn": { // a quarter turn (1 action, from inside or next to it)
      if (!b.vehicle) return "You came on foot: there is no vehicle here.";
      if (!u.aboard && !atVehicle(b, u)) return "Stand next to the vehicle (or get in) to turn it.";
      const err = turnVehicle(b, u);
      if (err) return err;
      break;
    }
    case "reload": { // the magazines section: the plan's cost (mags.js reloadPlan: a magazine or rounds from a pocket or the rig 1 action, from the pack both), the magazine full (as far as the team's ammo goes); act.ammo: a type to load instead (ammo.js)
      // The pick (mags.js reloadPlan): act.ammo (a round), act.mag (a spare's index in u.mags), act.clip, act.rounds ([{ i, n }] in firing order: the picker, ui/combat.js)
      const pick = Array.isArray(act.rounds) ? { rounds: act.rounds } : act.mag != null ? { mag: act.mag } : act.clip != null ? { clip: act.clip, load: act.ammo || null } : act.ammo || null;
      if (u.gunner && u.ap < TURRET.RELOAD_AP) return "A new belt takes both actions."; // (before a double feed is cleared by it)
      if (u.ap < reloadCost(b, u, pick) && !u.jam) return reloadRefusal(b, u, pick) || "Not enough actions left to reload."; // mags.js: from the pack: 2 actions
      const dbl = u.jam && u.jam.kind === "double" ? u.jam : null;
      jamReload(b, u); // gunfire.js: a double feed is cleared by dropping the magazine (then this reload fills a fresh one)
      // Physical rounds (mags.js): the plan must still see the double feed (a fresh magazine goes in over the jammed
      // one, full or not), so the jam is cleared once the reload is made, not before it is planned.
      const held = dbl && !u.jam && isStacked(u);
      if (held) u.jam = dbl;
      const why = reloadRefusal(b, u, pick);
      if (why) return why;
      if (u.ap < reloadCost(b, u, pick)) return "Not enough actions left to reload.";
      reload(b, u, pick);
      if (held) u.jam = null;
      if (u.gunner) { u.ap = 0; afterTurretReload(b, u); }
      if (isStacked(u) && u.sid != null) { const s = survivorById(state, u.sid); if (s) tidyRounds(b, u, s); } // the rounds left their stacks (mags.js): emptied ones thrown away, the caches refit
      break;
    }
    case "getshells": { // mags.js SHELLS: a shotgun's shells out of the pack, loose at hand (1 action)
      if (u.ap < 1) return "No actions left.";
      if (handsBusy(u)) return handsWord(u);
      if (u.carrying != null) return "Hands full: put the body down first.";
      const why = getShellsRefusal(b, u, act.ammo || null);
      if (why) return why;
      say(b, getShells(b, u, act.ammo || null), "info");
      u.ap -= 1;
      u.hunker = false;
      break;
    }
    case "inv": { // their own kit moved about (invAct: pockets, pack, rig pouches, the hands; split, open, box): INV_AP
      const err = invAct(state, b, u, act);
      if (err) return err;
      break;
    }
    case "handover": { // a thing given to, or taken from, the teammate next to them in their cone (handoverAct): HANDOVER_AP
      const err = handoverAct(state, b, u, act);
      if (err) return err;
      break;
    }
    case "plate": { // carrykit.js: a broken or missing plate replaced from the pack (2 actions)
      const s = u.sid != null ? survivorById(state, u.sid) : null;
      const p = plateSwapPlan(s);
      if (p.why) return p.why;
      if (u.ap < p.cost) return `Swapping a plate takes ${p.cost} actions.`;
      say(b, swapPlate(s, p), "info");
      u.ap -= p.cost;
      u.hunker = false;
      break;
    }
    case "overwatch":
      if (u.jam) return jamRefusal(u);
      if (u.suppressed) return "Pinned down by suppressing fire: no overwatch this turn.";
      if (u.stun) return "Still seeing spots from the flash: no overwatch until it wears off.";
      if (blinded(u)) return "Blinded by pepper spray: no overwatch until it wears off.";
      if (!canFire(b, u)) return isRanged(u) && magEmpty(b, u) && !reloadRefusal(b, u) ? "Overwatch needs a loaded gun: reload first." : WEAPONS[u.weapon].arrows ? "Needs arrows for the bow." : "Needs a gun with ammo.";
      faceAfterMove(u, act); // vision.js: the way it covers (act.face / faceX, faceY), else as they face now
      u.ow = true; u.ap = 0;
      say(b, `${u.name} is on overwatch.`, "info");
      break;
    // gunfire.js: clear a jam (its actions, as many as the unit has); set the fire mode (free); suppressing fire.
    case "unjam": {
      const why = unjamRefusal(u);
      if (why) return why;
      unjam(b, u);
      break;
    }
    case "visor": { // helmets.js: raise or lower the visor (free)
      const why = toggleVisor(b, u);
      if (why) return why;
      say(b, `${u.name} ${u.visorUp ? "raises" : "lowers"} the visor.`, "info");
      bump(b);
      return "";
    }
    case "firemode": {
      syncModes(u);
      const mode = act.mode || u.modes[(u.modes.indexOf(u.mode) + 1) % Math.max(1, u.modes.length)]; // no mode given: the next one
      const why = modeRefusal(u, mode);
      if (why) return why;
      if (u.mode !== mode) { u.mode = mode; say(b, `${u.name}: ${FIRE_MODES[mode].name.toLowerCase()} (${modeRounds(u, mode)} round${modeRounds(u, mode) === 1 ? "" : "s"} a shot).`, "info"); }
      bump(b);
      return "";
    }
    case "suppress": {
      const why = suppressRefusal(b, u, canFire(b, u) ? "" : fireRefusal(b, u));
      if (why) return why;
      const x = t ? t.x : Number(act.x), y = t ? t.y : Number(act.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !inside(x, y) || (x === u.x && y === u.y)) return "Pick an enemy or a spot to suppress.";
      if (t && (t.side === "player" || !active(t))) return "No target.";
      if (t && !canSee(b, u, t)) return "No line of sight.";
      suppress(b, u, x, y);
      u.ap = 0;
      break;
    }
    // launchers.js: a grenade launcher or a rocket at a cell (act.x / act.y, or act.target's), and its reload (act.ammo:
    // a type of 40 mm to load instead). The turn's attack, like a shot.
    case "launch": {
      const x = t ? t.x : Number(act.x), y = t ? t.y : Number(act.y);
      const why = launchRefusal(b, u, x, y);
      if (why) return why;
      launch(b, u, x, y);
      break;
    }
    case "glreload": {
      const why = glReloadRefusal(b, u, act.ammo || null);
      if (why) return why;
      glReload(b, u, act.ammo || null);
      break;
    }
    // itemacts.js: the item menu's orders (ui/itemmenu.js). A treat, a bite or a drink (1 action to hand, 2 from the
    // pack); a gun part fitted or taken off in the gun builder over the battle (1 action). Refitted at once: a buzz's aim,
    // hunger's and thirst's, the gun's new numbers.
    case "useItem": case "modPart": {
      const s = u.sid != null ? survivorById(state, u.sid) : null;
      if (s && !u.fit) { const id = b.nextId; const f0 = playerUnit(b, s); b.nextId = id; u.fit = { aim: f0.aim, dmgMult: f0.dmgMult, armor: f0.armor, medicine: f0.medicine }; } // refitUnit's baseline (as ground.js fieldReady)
      const why = handsRefusal(u, act.type === "modPart" ? "reload" : "meds") || (act.type === "modPart" ? battleMod : battleUse)(state, b, u, act, say);
      if (why) return why;
      if (s) refitUnit(b, u, s);
      break;
    }
    case "hunker":
      u.hunker = true; u.ap = 0;
      say(b, `${u.name} hunkers down.`, "info");
      break;
    case "meds": {
      const target = t || u;
      if (target.side !== "player" || target.dead || target.left) return "No one to treat.";
      if (target !== u && !adjacent(u, target)) return "Must be next to them.";
      if (target.down && medsLeft(b) < 1) { const err = MED.stabilizeByHand(b, u, target); if (err) return err; break; } // medics.js: no meds, bare hands
      if (medsLeft(b) < 1) return "No meds left.";
      if (target.stab) return "Already stabilized.";
      if (!target.down && target.hp >= target.maxHp) return "Not hurt.";
      heal(b, u, target);
      u.ap -= 1;
      break;
    }
    // medics.js: a medic's Heal and Revive, dragging a downed ally (and putting them down, or into the vehicle),
    // finishing a downed enemy.
    case "heal": { const tt = t || u; const why = MED.healRefusal(b, u, tt); if (why) return why; MED.medicHeal(b, u, tt); break; }
    case "revive": { const why = MED.reviveRefusal(b, u, t); if (why) return why; MED.revive(b, u, t); break; }
    case "dragAlly": { const why = MED.liftRefusal(b, u, t); if (why) return why; MED.lift(b, u, t); break; }
    case "dropAlly": { const why = MED.dropRefusal(b, u, act.into); if (why) return why; MED.dropAlly(b, u, act.into || null); break; }
    case "finish": { const why = MED.finishOff(b, u, t); if (why) return why; break; }
    case "pullOut": { const why = MED.pullOut(b, u, t || MED.pullTargets(b, u)[0] || null); if (why) return why; break; } // a downed rider out of a vehicle
    case "search": {
      if (!b.raid) return "Nothing to search.";
      const box = act.box != null ? b.raid.containers.find((c) => c.id === act.box) : searchableNear(b, u)[0];
      if (!box || !nearBox(u, box) || (box.searched && !(act.open && box.contents))) return "Move next to something to search first.";
      if (!facesBox(u, box)) return faceRefusal(box.label ? `the ${box.label.toLowerCase()}` : "it"); // vision.js: next to it and facing it
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
    case "searchBody": case "pickUp": case "drop": { const why = groundAct(state, b, u, act); if (why) return why; break; } // ground.js
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
      landingClear(b, u, from + (up ? 1 : -1)); // a wounded teammate on the landing is moved aside
      fx(b, { type: "move", unit: u.id, from: [u.x, u.y], path: [[u.x, u.y]] });
      moveToFloor(b, u, from + (up ? 1 : -1));
      say(b, `${u.name} goes ${up ? "up" : "down"} the stairs to ${/^floor/i.test(b.floors[u.f].name) ? "" : "the "}${b.floors[u.f].name.toLowerCase()}.`, "info");
      setFloor(b, u.f); // the view follows
      detect(b, u);
      break;
    }
    case "extract": {
      if (!b.raid) return "Use Retreat.";
      if (u.aboard) { // everyone in the vehicle leaves with it, from the zone it stands at
        const riders = b.units.filter((o) => o.aboard && !o.dead);
        for (const o of riders) if (o.gunner) leaveTurret(b, o, true);
        for (const o of riders) { o.aboard = false; o.off = false; o.left = true; o.exitZone = b.raid.vehicleZone; o.exitVehicle = true; o.ap = 0; o.ow = o.hunker = false; }
        say(b, `${riders.map((o) => o.name).join(", ")} extract in the ${b.vehicle.kind}.`, "good");
        break;
      }
      if (u.f) return "Go down to the ground floor to extract.";
      const z = zoneAt(b, u.x, u.y);
      const byCar = vehicleExit(b, u); // any cell next to the vehicle is a way out in it, wherever it stands
      if (z < 0 && !byCar) return "Move into an extraction zone, or next to the vehicle, first.";
      u.left = true; u.exitZone = z >= 0 ? z : b.raid.vehicleZone; u.ap = 0; u.ow = u.hunker = false;
      u.exitVehicle = byCar || !!((b.raid.hasVehicle ?? b.raid.vehicleZone >= 0) && b.raid.vehicleZone === z); // the vehicle stands at this zone (it may have been driven: syncVehicleZone)
      say(b, `${u.name} extracts${u.exitVehicle ? " at the vehicle" : ""}.`, "good");
      break;
    }
    case "retreat":
      if (!evacAt(b, u.x, u.y)) return "Move into the evacuation zone first.";
      u.left = true; u.ap = 0; u.ow = u.hunker = false;
      say(b, `${u.name} slips away from the fight.`, "info");
      break;
    case "car": { // foundcars.js: a car or truck next to the unit: get in, look for the keys, hotwire it, inspect it, claim it
      const err = carAct(state, b, u, act, { say, alertNear, fx });
      if (err) return err;
      break;
    }
    case "open": { // locks.js: a locked container or door next to the unit, by key, lockpicks or force
      if (!b.raid && !b.doors) return "Nothing to open."; // a field map's houses' locked doors (genMap FIELD_DOOR)
      const err = openLock(state, b, u, act, { say, alertNear, fx });
      if (err) return err;
      break;
    }
    case "close": case "brace": case "peek": { // buildingmaps.js: a building's doors (close one, brace one, peek through one); a field map's houses too
      const err = doorAct(state, b, u, act, { say, alertNear, fx });
      if (err) return err;
      break;
    }
    case "lights": { // indoorlight.js: the light switch next to the unit (1 action, quiet): the room lit or dark
      const r = lightsAct(b, u, act);
      if (r.err) return r.err;
      u.ap -= 1;
      u.hunker = false;
      say(b, `${u.name} switches the lights ${r.room.on ? "on" : "off"} in the ${r.room.name.toLowerCase()}.`, "info");
      // A guard in a room whose lights come on sees it as by day: whoever of yours stands in it may be noticed now.
      for (const p of b.units) if (p.side === "player" && active(p)) detect(b, p);
      break;
    }
    case "climb": { // buildingmaps.js: through a window next to the unit (not diagonally); a closed one is smashed (loud), an open or broken one is quiet (windows.js)
      if (!b.raid) return "Nothing to climb.";
      const opts = windowsNear(b, u);
      const w = act.x != null ? opts.find((o) => o.x === act.x && o.y === act.y) : opts[0];
      if (!w) return "Stand right next to a window (not diagonally) with room on the far side.";
      if (u.ap < BMAP.CLIMB.ap) return "Not enough actions.";
      const c = b.cells[idx(w.x, w.y)];
      const quiet = windowOpen(c);
      if (!quiet) smashWindow(b, c);
      u.ap -= BMAP.CLIMB.ap;
      u.hunker = false;
      const from = [u.x, u.y];
      faceToward(u, w.to[0], w.to[1]);
      u.x = w.to[0]; u.y = w.to[1];
      fx(b, { type: "move", unit: u.id, from, path: [[w.x, w.y], [u.x, u.y]] });
      if (quiet) say(b, `${u.name} climbs through the ${c.k === "smashed" ? "broken" : "open"} window: quiet.`, "info");
      else {
        b.raid.heat = Math.min(100, b.raid.heat + BMAP.CLIMB.heat);
        b.noise = (b.noise || 0) + 1;
        say(b, `${u.name} smashes the window and climbs through (Heat +${BMAP.CLIMB.heat}).`, "info");
        alertNear(b, w.x, w.y, BMAP.CLIMB.radius, "Breaking glass carries through the building.");
      }
      b.reach = flood(b.cells, u.x, u.y);
      syncFloor(b);
      detect(b, u);
      break;
    }
    case "openwindow": case "closewindow": case "breakwindow": { // windows.js: the window next to the unit: open or close it (1 action, quiet), break it (1 action, loud); checkwindow (free) is handled above the actions guard
      const err = windowAct(state, b, u, act, { say, alertNear, fx });
      if (err) return err;
      b.reach = flood(b.cells, u.x, u.y); // what is in reach on foot changes with an opening
      syncFloor(b);
      break;
    }
    case "cutwire": { // wire.js: a cell of wire next to them cut away (1 action, a cutter carried)
      const err = cutAct(state, b, u, act, { say, alertNear });
      if (err) return err;
      break;
    }
    case "shove": case "boardup": case "teardown": { // barricade.js: furniture shoved a tile (both actions), boards nailed over a door or window, the boards torn down again
      const err = act.type === "shove" ? shoveAct(state, b, u, act, { say, alertNear, fx }) : act.type === "boardup" ? boardAct(state, b, u, act, { say, alertNear, fx }) : tearAct(state, b, u, act, { say, alertNear, fx });
      if (err) return err;
      b.reach = flood(b.cells, u.x, u.y); // what is in reach on foot changes with a way blocked or opened
      syncFloor(b);
      break;
    }
    // stealth.js: Subdue (takedowns, knock-outs), Tie up, Throw (bottles, noise makers, firecrackers), Drag.
    case "subdue": case "tie": case "throw": case "drag": {
      const err = stealthAct(state, b, u, t, act);
      if (err) return err;
      break;
    }
    // nonlethal.js: the taser (and its reload), pepper spray, pulled blows, executing someone who gave up, surrendering.
    case "taser": case "reloadTaser": case "pepper": case "pull": case "execute": case "surrender": {
      const err = nlAct(state, b, u, t, act);
      if (err) return err;
      break;
    }
    // siege.js: set a ladder up, push one off, swing the ram, set it down or take it up, drop rocks from the walls.
    case "ladder": case "push": case "ram": case "dropRam": case "takeRam": case "loadRam": case "unloadRam": case "drop": { // loadRam / unloadRam: the ram into or out of the team's vehicle
      const err = siegeAct(state, b, u, t, act);
      if (err) return err;
      break;
    }
    case "rescue": { // rescueraid.js: free a captive, the ropes, the cell door, the keys, a weapon off a body, the armory
      const err = rescueAct(state, b, u, act);
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
      spendRounds(b, u, w);
      const noise = shotNoise(b, u, w); // stealth.js: a suppressor halves it
      b.noise += noise;
      if (noise) b.gunshots = (b.gunshots || 0) + noise / w.noise;
      deafen(b, u.x, u.y, bangOf(b, u, w, noise, "single"), u); // hearing.js
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
  closePlan(b); // raidplan.js: anyone acted: the team went in as it was
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
  volunteerTurn(state, b); // volunteers.js: the volunteers with the team act on their own at the end of your turn
  if (b.over) return;
  MED.selfStabTurn(b, "player"); // medics.js: your downed who have a tourniquet or a trauma kit in reach and did not try yet
  for (const u of b.units) if (u.side === "player") { u.ap = 0; u.suppressed = 0; } // pinned (suppressing fire) until their own turn ends
  stunTurnEnd(b, ["player"]); // throwables.js: a flashbang's stun served this turn wears off
  b.phase = "enemy";
  for (const u of b.units) if ((u.side === "enemy" || u.side === "third") && activeAny(u)) { u.ap = u.surprised ? 0 : 2; u.ow = false; u.hunker = false; u.surprised = false; if (u.vaulted) u.vaulted = 0; } // thirdside.js: the third side moves in the enemy phase too
  for (const u of enemyCartsLetGo(state, b)) u.ap = Math.max(0, u.ap - CART_FIGHT.park); // carts.js: theirs park their carts as cover first (an action, as yours)
  stunTurnStart(b, ["enemy", "third"]); // throwables.js: the ones a flashbang caught lose their actions
  tickEars(b, ["enemy", "third"]); // hearing.js: their deafness and daze wear off a turn
  nlEnemyPhase(b); // nonlethal.js: the stunned lose actions, the blinded stay blind, the beaten may surrender
  meleeRound(b, ["enemy", "third"]); // the staggered lose an action, the bleeding bleed (melee section)
  // Storeys (buildingmaps.js): the floor the player looks at is kept and restored; the dead drifting between floors
  // arrive, then the next ones are sent; the Heat's waves come in on the ground floor.
  if (b.floors) { b.viewFloor = b.floor || 0; floorArrivals(b); floorDrift(b); }
  MED.foesBleed(b); // medics.js: the enemy's downed bleed out unless their people stabilized them
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
  raidCarTurn(b); // their Humvee drives up, holds, drops its riders or pulls back (the riders out get their turn)
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
  noteJamWeather(state, b);
  let u = null;
  while (b.queue.length && !u) {
    const c = unitById(b, b.queue.shift());
    if (c && activeAny(c)) u = c;
  }
  if (u) {
    // Storeys (buildingmaps.js): the AI runs on the unit's own floor, and the player's view floor comes back after.
    const view = b.floors ? b.floor || 0 : null;
    if (b.floors && (u.f || 0) !== view) setFloor(b, u.f || 0);
    if (!(b.rescue && u.side === "enemy" && guardTurn(state, b, u))) aiUnit(b, u); // rescueraid.js: the alarm, the armory, recapturing captives
    if (b.floors && (b.floor || 0) !== view) setFloor(b, view);
  }
  checkEnd(state, b);
  if (!b.over && !b.queue.length) MED.selfStabTurn(b, "enemy"); // medics.js: their downed with a tourniquet or a trauma kit, no ally coming
  if (!b.over && !b.queue.length) startPlayerTurn(state, b);
  bump(b);
  return u;
}

export function runEnemyPhase(state) {
  for (let i = 0; i < 200 && state.combat && state.combat.phase === "enemy" && !state.combat.over; i++) enemyStep(state);
}

function startPlayerTurn(state, b) {
  heardGhosts(b); // hearing.js: the enemies your people heard move or fire unseen ("?" markers), before the ears tick
  crossRound(b); // crossfire.js: the heard-noise markers fade
  tickEars(b, ["player"]); // hearing.js: deafness and a daze wear off a turn
  stunTurnEnd(b, ["enemy", "third"]); // throwables.js: their stun wears off with the enemy turn
  b.turn++;
  b.phase = "player";
  if (b.rescue) rescueRound(state, b); // rescueraid.js: the downed and the cornered captives taken back, the alarm
  if (b.floors && b.viewFloor != null && b.viewFloor !== (b.floor || 0)) setFloor(b, b.viewFloor); // the floor the player was looking at
  burnRound(b); // throwables.js: the flames burn whoever stands in them; fires, smoke and flares burn down
  acidRound(b, ["player"], true); // acid.js: your people standing in a spitter's acid; the pools dry up a round
  for (const u of b.units) if (u.side !== "player" && u.suppressed) u.suppressed = 0; // their turn is over: no longer pinned
  if (b.raid) safeTurn(state, b); // locks.js: a charge set on a gun safe last turn goes off
  for (const u of b.units) {
    if (u.side !== "player") continue;
    u.ow = false; u.hunker = false;
    if (u.vaulted) u.vaulted = 0; // a fresh turn: no longer winded from a vault (VAULT)
    u.ap = activeAny(u) || (u.aboard && !u.dead && !u.down && !u.left) ? 2 : 0; // aboard (off the map): still theirs to drive, turn, get out (it was 0: stuck inside after the turn they got in)
    if (u.down && !u.stab && !u.dead && !u.left && !nlSpared(u)) { // nonlethal.js: knocked out or surrendered, not bleeding
      u.bleed--;
      if (u.bleed <= 0) {
        u.dead = true;
        const pile = dropHaul(b, u); // raidloot.js: their body, with what they carried loose on it for the others to pick up
        say(b, `${u.name} bled out.${dropHeld(pile) ? " What they carried lies where they fell." : ""}`, "death");
      }
      else say(b, `${u.name} is bleeding out (${u.bleed} turn${u.bleed > 1 ? "s" : ""} left).`, "danger");
    }
  }
  stunTurnStart(b, ["player"]); // throwables.js: whoever a flashbang caught loses an action or two
  nlTurnStart(b, ["player"]); // nonlethal.js: stuns and blindness on your people, the knocked out coming to
  meleeRound(b, ["player"]); // the staggered lose an action, the bleeding bleed (melee section)
  stirBodies(state, b); // carriers.js: bodies in the flames burn; a carrier who went down puts the body down
  burnBodies(b); // sleepers.js: bodies in the flames burn, a Sleeper's worms with them
  terrorRuns(b); // middead.js: whoever a Nightmare's scream panicked spends the turn running
  for (const u of b.units) if (u.side === "player" && active(u)) spotCheck(b, u); // sleepers.js: a body twitches
  // A base battle (interior.js): the wall breached (on to the yard map), the yard lost (the last stand).
  if (b.tier && !b.over) tierPlayerTurn(state, b);
  if (b.raid && b.raid.folk && !b.over) folkTick(state, b); // floorfolk.js: the nest woken by the Heat or the noise of the enemy phase
  offerClear(b);
  if (b.evacOrder && !b.over) evacTurn(state, b); // the Evac order stands: the next leg toward the way out
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
  if (t.treating != null) v *= MED.treatingMult(b, t); // medics.js: a medic seen treating someone (or dragging them)
  if (t.shotPri) v *= t.shotPri; // a unit marked as the one to kill (hivecrawl.js: the Hivemind, its brood dies with it)
  return v;
}
export function bestShot(b, u, foes, opts = {}) {
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

// A shotgunner's pull toward the foes a tile past its shot's full-damage range (scoreCell; buckshot spreads, data-ammo.js).
const SPREAD_CLOSE = 1.5;
// What scoreCell reads of the mover and its foes that is the same on every cell: nothing moves, fires or reloads while
// one move is weighed, so bestMove works it out once for all its cells (the gun's state, its round and attachments,
// each foe's reach).
function scoreFacts(b, u, foes) {
  const fire = canFire(b, u), cal = calOf(u.weapon), spread = unitMods(u).spread || 0;
  const sf0 = fire && cal ? typeFx(typeFor(cal, u.load)).spreadFull : null;
  const ranged = foes.map((f) => isRanged(f));
  return { fire, cal, sty: cal ? typeFor(cal, u.load) : null, spread, sfull: sf0 != null ? sf0 + spread : null, sniper: isSniper(u), ranged, range: foes.map((f, k) => (ranged[k] ? sightRange(b, f) : 0)) };
}
function scoreCell(b, u, x, y, foes, cost, field, facts = scoreFacts(b, u, foes)) {
  let s = -cost * 0.4, best = 0, nearest = 99;
  for (let k = 0; k < foes.length; k++) {
    const f = foes[k], d = dist(x, y, f.x, f.y);
    nearest = Math.min(nearest, d);
    if (!facts.ranged[k]) { if (d < 2.5) s -= 10; else if (d < 5) s -= (5 - d) * 2; continue; }
    if (d > facts.range[k] || !los(b, x, y, f.x, f.y)) continue;
    const c = coverAgainst(b, x, y, f.x, f.y).level;
    s += c === 2 ? 0 : c === 1 ? -5 : -14;
  }
  if (facts.fire) {
    // Buckshot and birdshot do less the further off (data-ammo.js spreadMult): a shotgunner's spot is worth what its
    // shot keeps there, so both sides' shotguns close in rather than plink from afar (1 for any other round).
    const range = sightRange(b, u, x, y);
    for (const f of foes) {
      if (dist(x, y, f.x, f.y) > range || !los(b, x, y, f.x, f.y)) continue;
      const o = shotOdds(b, u, f, x, y);
      best = Math.max(best, (o.chance + (o.crit - (u.critBonus || 0) >= CRIT.EXPOSED ? 12 : 0)) * spreadMult(facts.sty, dist(x, y, f.x, f.y), { cal: facts.cal, extra: facts.spread })); // a target with no cover
    }
  }
  s += best * 0.3;
  // A shotgunner with buckshot loaded also wants to close to where it hits full (spreadFull): a slope toward the foes.
  const sfull = facts.sfull; // a choke: more tiles at full damage
  if (sfull != null && nearest > sfull) s -= (Math.min(nearest, 16) - sfull) * SPREAD_CLOSE;
  if (facts.sniper) s += sniperCell(nearest); // gunfire.js: a sniper keeps its distance (10–15 tiles)
  // Nothing to shoot: closer to the foes is better, the walking distance up to 40 tiles. A unit standing farther off than
  // that still gets a slope toward them (a team left 40+ tiles off on a big fort map stood still for good:
  // conquertest's stalled assault).
  if (!best) s -= 8 + (field ? Math.min(field[idx(u.x, u.y)] > 40 ? 120 : 40, field[idx(x, y)]) : nearest);
  if (u.kind !== "zombie" && b.acid && b.acid.length && acidAt(b, x, y)) s -= ACID.stand; // a spitter's acid (acid.js)
  // The last stand (interior.js): once the yard is lost your people keep to the buildings.
  if (u.side === "player" && b.tier && b.tier.stage === "buildings" && b.tier.indoor) s += b.tier.indoor[idx(x, y)] ? 6 : -15;
  return s;
}

// A base battle (deploy.js, interior.js): your people do not go out past the wall line to chase the attackers (the
// gate and the breaches themselves are held from where they are). Only when the base is yours: storming a group's
// base (conquest.js, holders "enemy") your people start outside its wall and have to get in.
const WALL_LINE = new Set(["gate", "breach", "palisade"]);
function outsideBase(b, u, i) {
  return u.side === "player" && (b.holders || "player") === "player" && !!b.tier && !!b.tier.interior && !b.tier.interior[i] && !WALL_LINE.has(b.cells[i].k);
}

function bestMove(b, u, foes, field = null) {
  const r = reachable(b, u, moveMob(u)); // moveMob: a tile short while winded from a vault (VAULT)
  field = field || distField(b, foes.map((f) => [f.x, f.y]), u);
  let best = null, facts = null;
  for (const i of reachedInOrder(r)) { // a die for each cell it can stand on, in the map's order
    if (!isFinite(r.dist[i]) || r.dist[i] === 0 || outsideBase(b, u, i)) continue;
    const x = i % W, y = (i / W) | 0;
    const sc = scoreCell(b, u, x, y, foes, r.dist[i], field, facts || (facts = scoreFacts(b, u, foes))) + b.rng.next() * 1.5;
    if (!best || sc > best.sc) best = { x, y, sc };
  }
  if (best) best.path = pathTo(r, best.x, best.y);
  return best;
}

function aiUnit(b, u) {
  if (!active(u)) return;
  if (u.gunner) return gunnerAI(b, u); // a turret's gunner (either side): stays on the gun
  if (u.dormant) { u.ap = 0; return; } // a Sleeper lies where it is (sleepers.js)
  const own = bossAI(u);
  if (own && own.turn) { own.turn(b, u); u.ap = 0; return; } // registerBossAI: a boss that plays its own turn (hivecrawl.js's Hivemind)
  if (u.side === "third") { // thirdside.js: neutrals stay put, defend themselves or run; soldiers fight the dead
    const plan = thirdPlan(b, u);
    if (plan === "hold") { u.ap = 0; return; }
    if (plan === "flee") return flee(b, u);
  }
  const rng = b.rng;
  if (u.kind === "human") aiFlashlight(b, u, true); // ailights.js: a flashlight on once they know the fight is on, in the dark
  if (crossTurn(b, u)) return; // crossfire.js: an unaware raider with the dead on them, or one of the dead with raiders in reach: they fight each other
  if (!u.aware && stealthAI(b, u)) return; // stealth.js: finding bodies, going to look where a bottle landed
  if (!u.aware && b.raid) {
    patrol(b, u);
    return;
  }
  if (u.kind === "zombie" && u.side === "enemy" && lureTurn(b, u)) return; // decoys.js: a decoy or a fire it senses
  if (!u.aware) {
    // Sleeping zombies shuffle about (not a Shepherd's pack: it keeps together); sleeping humans hold position (and
    // look about now and then: vision.js glance).
    glance(b, u);
    if (u.kind === "zombie" && !herded(b, u) && rng.chance(0.4)) {
      const r = reachable(b, u, 1.5);
      const opts = [];
      for (const i of reachedInOrder(r)) if (r.dist[i] > 0 && isFinite(r.dist[i])) opts.push(i);
      if (opts.length) { const i = rng.pick(opts); moveAlong(b, u, pathTo(r, i % W, (i / W) | 0)); }
    }
    u.ap = 0;
    return;
  }
  aiLook(b, u); // vision.js: an aware person turns to the nearest foe it can make out
  if (u.kind === "human" && aiRoomLights(b, u, true) && (u.ap < 1 || !active(u))) return; // ailights.js: a dark room's switch flipped on (walked to first when it is near and quiet)
  const flees = u.side === "enemy" && u.kind === "human" && !u.fearless && shouldFlee(b);
  // medics.js: a downed ally to drag out of the line of fire, stabilize or revive; a medic healing the badly hurt;
  // raiders finishing (or taking) your downed. The rest of the turn goes on as usual.
  if (u.kind === "human" && MED.rescueTurn(b, u, flees) && (u.ap < 1 || !active(u))) return;
  if (flees) return flee(b, u);
  if (u.kind === "human" && (u.side === "enemy" || (u.side === "player" && b.takeAlive)) && nlAI(b, u)) return; // nonlethal.js: tie up, spray, tase, club down the weak
  if (u.side === "enemy" && u.kind === "human" && siegeAI(b, u)) return; // siege.js: the ram, a ladder, storming, a grenade
  if (u.side === "player" && aiMeds(b, u)) { if (u.ap < 1) return; }
  // A jammed gun is cleared first (gunfire.js: a double feed by a reload when it can).
  if (u.jam && aiUnjam(b, u) && u.ap < 1) return;
  // An empty gun is reloaded first (1 action), then the turn goes on with the other (a shot, often). Your side's gun
  // out of its loaded type, or empty, takes the best type to hand against the foes in sight (ammo.js pickLoad).
  if (aiReload(b, u)) { if (u.ap < 1) return; }
  if (u.suppressed && u.kind === "human" && !u.post) return aiPinned(b, u); // pinned by suppressing fire: to cover
  if (u.post && holdPost(b, u)) return; // deploy.js: a defender posted at the gate or on a tower stays there
  if (u.ztype && zombieTurn(b, u)) return; // zombietypes.js: a screamer shrieks or hangs back, a brute smashes through
  if (!canFire(b, u) && aiGrabGun(b, u) && u.ap < 1) return; // ground.js: a gun lying right there, taken up
  if (!canFire(b, u)) return aiMelee(b, u);
  for (let step = 0; step < 3 && u.ap > 0 && active(u); step++) {
    const foes = foesOf(b, u);
    if (!foes.length) { const cab = aiCab(b, u); if (cab) { fireCab(b, u, cab); u.ap = 0; } return; } // nobody on foot: the other side's vehicle with them inside
    const shot = bestShot(b, u, foes);
    const cab = shot ? null : aiCab(b, u); // nobody in sight to shoot: the other side's vehicle (its cab, its hull)
    if (cab) { fireCab(b, u, cab); u.ap = 0; return; }
    // Nothing to shoot and the magazine low: top it up while nobody is in reach.
    if (!shot && magLow(u) && !foes.some((f) => adjacent(u, f)) && !reloadRefusal(b, u)) { reload(b, u); continue; }
    // Suppressing fire (gunfire.js): an automatic gun on people pins them down when a fair shot is not there.
    const pin = step === 0 && u.side !== "player" ? aiSuppressAt(b, u, foes, shot) : null;
    if (pin) { suppress(b, u, pin.x, pin.y); u.ap = 0; return; }
    const field = distField(b, foes.map((f) => [f.x, f.y]), u);
    const here = scoreCell(b, u, u.x, u.y, foes, 0, field);
    if (shot && (u.ap === 1 || (shot.o.chance >= 55 && here > -6))) { fire(b, u, shot.t); u.ap = 0; return; }
    const mv = bestMove(b, u, foes, field);
    if (mv && mv.sc > here + 1) { u.ap -= 1; moveAlong(b, u, mv.path); if (u.kind === "human" && active(u) && u.ap > 0) aiRoomLights(b, u, true); continue; } // ailights.js: a dark room walked into: its switch, when it is right there
    // An attacker outside a fort's wall with no fair shot: on toward the nearest opening, or batter the gate (fortApproach).
    if (!shot || shot.o.chance < 45) { const fa = fortApproach(b, u, field); if (fa === "bash") return; if (fa === "moved") continue; }
    if (shot) { fire(b, u, shot.t); u.ap = 0; return; }
    // Nothing to shoot and nowhere better to stand: one holding a building barricades it (barricade.js aiBarricade: a
    // piece into a door frame, boards over an outer window); an attacker at a wall, a door or the gate batters it.
    if (u.kind === "human" && u.ap >= 2 && aiBarricade(b, u, { say, alertNear, fx })) return;
    const wall = siegeTarget(b, u);
    if (wall) { bash(b, u, wall[0], wall[1]); u.ap = 0; return; }
    const bi = breakIn(b, u, field); // no way to them but through a locked door: on to it (breakIn)
    if (bi === "moved") continue;
    if (!u.stun && (u.side === "player" || isSniper(u) || rng.chance(0.6) || MED.coveringRescue(b, u))) { u.ow = true; aiLook(b, u); } // a sniper always watches; stun: no overwatch through a flashbang's glare; medics.js: covering a rescue; vision.js: watching the nearest foe's way
    else if (coverSides(b, u.x, u.y).some((c) => c)) u.hunker = true;
    u.ap = 0;
  }
}

// An aware person (vision.js) turns toward the nearest foe it can make out: in its daylight range, a clear line, not
// hidden sneaking behind cover. With a front only (the dead see all round).
function aiLook(b, u) {
  if (!u.aware || !hasFront(u)) return;
  let best = null, bd = Infinity;
  const far = (u.daySight ?? u.sight) + HEIGHT.SIGHT * hAt(b, u.x, u.y);
  for (const f of foesOf(b, u)) {
    const d = dist(u.x, u.y, f.x, f.y);
    if (d >= bd || d > far || (b.floors && (f.f || 0) !== (u.f || 0))) continue;
    if (sneakHidden(b, u, f) || !los(b, u.x, u.y, ...nearCell(f, u.x, u.y))) continue;
    best = f; bd = d;
  }
  if (best) faceToward(u, best.x, best.y);
}

// Pinned by suppressing fire (gunfire.js): out of the open if it can (bestMove weighs cover), a shot only when it is a
// good one, else head down.
function aiPinned(b, u) {
  const foes = foesOf(b, u);
  if (!foes.length) { u.ap = 0; return; }
  const exposed = foes.some((f) => isRanged(f) && canSee(b, f, u) && coverAgainst(b, u.x, u.y, f.x, f.y).level === 0);
  if (exposed && u.ap > 0) {
    const field = distField(b, foes.map((f) => [f.x, f.y]), u);
    const mv = bestMove(b, u, foes, field);
    if (mv && mv.sc > scoreCell(b, u, u.x, u.y, foes, 0, field)) { u.ap -= 1; moveAlong(b, u, mv.path); }
  }
  if (!active(u)) return;
  const shot = u.ap > 0 ? bestShot(b, u, foesOf(b, u)) : null;
  if (shot && shot.o.chance >= 50) { fire(b, u, shot.t); u.ap = 0; return; }
  if (coverSides(b, u.x, u.y).some((c) => c)) u.hunker = true;
  u.ap = 0;
}
// Where an enemy with an automatic gun lays down suppressing fire, or null: two or more people in the cone with no
// fair shot (under 50%), or a machine gun (a 60-round magazine or more) on anyone with no good shot (under 40%).
function aiSuppressAt(b, u, foes, shot) {
  if (u.kind !== "human" || (shot && shot.o.chance >= 50) || !suppressRounds(u) || !canFire(b, u) || suppressRefusal(b, u, "")) return null;
  const people = foes.filter((f) => f.kind === "human" && !f.ztype);
  if (!people.length) return null;
  const c = bestCone(b, u, people);
  if (!c) return null;
  const mg = magCap(u) >= 60;
  if (c.n >= 2 && (!shot || shot.o.chance < 50)) return c;
  if (mg && (!shot || shot.o.chance < 40)) return c;
  return null;
}

// A defender posted at the gate (or a breach) or on a watchtower by the deploy step (deploy.js) holds it: shoots
// what it can see (point blank at the gate), strikes what is next to it, else watches. With nothing in sight or
// within 6 tiles (the dead got past), the post is given up and the usual AI takes over.
// Posts on the yard map (interior.js) kept with nobody in sight: the towers, upper floors and roofs, inside a
// building at a window, by a door.
const STICKY = new Set(["tower", "perch", "inside", "door"]);
// On the wall map (deploy.js) the walkway and the towers ("wall", "tower") are kept while the dead are still outside,
// even with nobody in sight (night); inside a building ("inside", interior.js) the same as a post.
// A magazine under half full (the AI tops it up when nothing is in reach).
const magLow = (u) => hasMag(u) && magIn(u) * 2 < magMaxOf(u);
// The AI's reload (both sides): an empty magazine; for your side also a gun whose loaded type has run out (another type
// of its calibre), and a soft load (hollow or soft points) in a magazine at half or less with armour in sight: then
// the best type to hand (ammo.js pickLoad). Returns true when it reloaded.
function aiReload(b, u) {
  if (!isRanged(u) || !hasMag(u)) return false;
  const w = WEAPONS[u.weapon];
  const mine = u.side === "player" && !!calOf(u.weapon);
  const spent = mine && !hasShot(b, w, u);
  if (!magEmpty(b, u) && !spent) {
    if (!mine || magIn(u) * 2 > magMaxOf(u) || !((typeFx(typeFor(calOf(u.weapon), u.load)).soft || 1) > 1)) return false;
    const seen = foesOf(b, u).filter((f) => playerSees(b, f));
    const t = seen.some(armoredFoe) ? pickLoad(b, u, seen) : null;
    if (!t || t === typeFor(calOf(u.weapon), u.load) || reloadRefusal(b, u, t)) return false;
    reload(b, u, t);
    return true;
  }
  if (!mine) { if (aiReloadRefusal(b, u)) return false; aiLoad(b, u); return true; }
  const seen = foesOf(b, u).filter((f) => playerSees(b, f));
  const best = pickLoad(b, u, seen);
  const t = best && !aiReloadRefusal(b, u, best) ? best : reloadType(b, u, seen);
  if (t == null) return false;
  const cur = typeFor(calOf(u.weapon), u.load);
  if (t === cur && aiReloadRefusal(b, u)) return false;
  aiLoad(b, u, t === cur ? null : t);
  return true;
}
// A shotgun whose next Reload would dig straight in the pack (mags.js: no shells of the type at hand, both actions) and
// can Get shells instead (1 action: a handful to hand, then 1-action Reloads).
const packShells = (b, u, type = null) => isShellGun(u) && tracksMags(u) && reloadPlan(b, u, type).from === "pack" && !getShellsRefusal(b, u, type);
// Why the AI cannot reload now: reloadRefusal's reason, except that a shotgun with its shells in the pack and one action
// left can still Get shells.
const aiReloadRefusal = (b, u, type = null) => { const why = reloadRefusal(b, u, type); return why && u.ap >= 1 && packShells(b, u, type) ? "" : why; };
// The AI's Reload of an empty gun. A shotgun with no shells at hand gets a handful out of the pack first (Get shells, 1
// action: no dearer than a Reload straight from the pack, both actions, and the rest of the handful stays at hand for
// the next Reloads), then loads from them with the next action when it has one.
function aiLoad(b, u, type = null) {
  if (packShells(b, u, type)) {
    say(b, getShells(b, u, type), "info");
    u.ap -= 1;
    u.hunker = false;
    if (u.ap < 1 || reloadRefusal(b, u, type)) return;
  }
  reload(b, u, type);
}
const armoredFoe = (f) => !!f && ((f.kind === "human" && (!!f.armorKey || (f.wornArmor ?? 1) < 1)) || ["soldier", "riot", "boneback", "brute"].includes(f.ztype));
function holdPost(b, u) {
  const foes = foesOf(b, u);
  if (!foes.some((f) => canSee(b, u, f) || dist(u.x, u.y, f.x, f.y) <= 6)) {
    const onWalls = b.tier && (b.tier.map === "wall" || (b.tier.map === "fort" && b.tier.stage === "wall")); // fort.js: one map, the same posts
    const walls = onWalls && (u.post === "wall" || u.post === "tower") && !foes.some((f) => b.tier.interior && b.tier.interior[idx(f.x, f.y)]);
    const inside = b.tier && (b.tier.map === "interior" || b.tier.map === "fort") && STICKY.has(u.post);
    if (!walls && !inside) { u.post = null; return false; }
    if (magLow(u) && !reloadRefusal(b, u)) reload(b, u); // a quiet moment: the magazine topped up
    if (canFire(b, u) && !u.stun) u.ow = true;
    u.ap = 0;
    return true;
  }
  const adj = foes.filter((f) => inMelee(b, u, f)).sort((a, c) => a.hp - c.hp);
  const shot = bestShot(b, u, adj.length && u.post === "gate" ? adj : foes);
  if (shot) fire(b, u, shot.t);
  else if (adj.length) strike(b, u, adj[0]);
  else if (canFire(b, u) && !u.stun) u.ow = true;
  else if (coverSides(b, u.x, u.y).some((c) => c)) u.hunker = true;
  u.ap = 0;
  return true;
}

function aiMeds(b, u) {
  if (medsLeft(b) < 1) return false;
  const hurtAlly = b.units.find((o) => o.side === "player" && o.down && !o.stab && !o.dead && !o.left && (o === u || adjacent(u, o)));
  const target = hurtAlly || (u.hp < 40 && MED.spareMeds(b, u) >= 1 ? u : null); // medics.js: the meds reserve kept for a revive
  if (!target) return false;
  heal(b, u, target);
  u.ap -= 1;
  return true;
}

// A field map's houses (genMap FIELD_DOOR): an attacker with nobody to shoot and no way to them on foot but through a
// locked door goes on along its siege field (distField: the door at its battering cost) toward that door, as
// the dead do (aiMelee); next to it siegeTarget batters it. Not in a raid (its guards keep to their own rules) nor on a
// base's map (fortApproach, the tiers). "moved" (one action spent) or null.
function breakIn(b, u, field) {
  if (b.raid || b.tier || u.side === (b.holders || "player") || u.side === "third" || u.ap < 1) return null;
  const foes = foesOf(b, u);
  if (!foes.length || isFinite(distField(b, foes.map((f) => [f.x, f.y]))[idx(u.x, u.y)])) return null; // a way round on foot (closed doors open)
  const r = reachable(b, u, moveMob(u));
  let best = -1, bestV = field[idx(u.x, u.y)];
  for (let i = 0; i < W * H; i++) if (isFinite(r.dist[i]) && r.dist[i] > 0 && field[i] < bestV && !unitAt(b, i % W, (i / W) | 0)) { bestV = field[i]; best = i; }
  if (best < 0) return null;
  u.ap -= 1;
  moveAlong(b, u, pathTo(r, best % W, (best / W) | 0));
  return "moved";
}
// An attacker outside a fort's wall (fort.js): on toward the nearest opening (a gate, a breach) rather than trading long
// shots with whoever stands on the wall, or waiting in the margin; at the gate (or a wall section), batter it. Also once
// the fight is in the yard (the wall fell with only some of them through): the ones still outside follow them in.
// "bash" (the turn is over), "moved" (one action spent), or null (nothing to do here). aiUnit (no fair shot), aiMelee.
function fortApproach(b, u, field) {
  if (!(b.tier && b.tier.map === "fort" && (b.tier.stage === "wall" || b.tier.stage === "yard") && u.side !== (b.holders || "player") && !b.tier.interior[idx(u.x, u.y)] && b.tier.openings && b.tier.openings.length)) return null;
  const gate = siegeTarget(b, u, field);
  if (gate) { bash(b, u, gate[0], gate[1]); u.ap = 0; return "bash"; }
  // Right at a shut gate (an opening that is not open ground): batter it, wherever the foes are.
  for (const [ox, oy] of b.tier.openings) {
    if (Math.abs(ox - u.x) + Math.abs(oy - u.y) !== 1) continue;
    const c = b.cells[idx(ox, oy)];
    if (c && breakable(c) && (!CELL[c.k].walk || barredCell(c))) { bash(b, u, ox, oy); u.ap = 0; return "bash"; }
  }
  const fo = distField(b, b.tier.openings, u);
  const r = reachable(b, u, u.mob);
  const hereD = fo[idx(u.x, u.y)];
  let best = -1, bestV = Infinity;
  for (let i = 0; i < W * H; i++) {
    if (!isFinite(r.dist[i]) || r.dist[i] <= 0 || !isFinite(fo[i]) || unitAt(b, i % W, (i / W) | 0)) continue;
    const v = fo[i] - (coverSides(b, i % W, (i / W) | 0).some((c) => c) ? 0.5 : 0);
    if (v < bestV) { bestV = v; best = i; }
  }
  if (best >= 0 && fo[best] < hereD) { u.ap -= 1; moveAlong(b, u, pathTo(r, best % W, (best / W) | 0)); return "moved"; }
  return null;
}
function aiMelee(b, u) {
  for (let step = 0; step < 3 && u.ap > 0 && active(u); step++) {
    const foes = foesOf(b, u);
    if (!foes.length) return;
    // Someone holding a barred gate (or door) is behind it: an attacker has to batter it down first.
    const adj = foes.filter((f) => inMelee(b, u, f) && !(u.side !== (b.holders || "player") && barredCell(b.cells[idx(f.x, f.y)]))).sort((a, c) => a.hp - c.hp); // inMelee: a spear reaches 2
    if (adj.length) { strike(b, u, adj[0]); u.ap = 0; return; }
    if (aiFetchSpear(b, u, foes) || aiThrowSpear(b, u, foes)) continue; // a thrown spear: back for it; a zealot's throw
    const r = reachable(b, u, dashRange(u));
    const field = distField(b, foes.map((f) => [f.x, f.y]), u);
    let best = null;
    for (const i of reachedInOrder(r)) { // the first of equals kept: the map's order
      if (!isFinite(r.dist[i]) || (r.dist[i] > 0 && outsideBase(b, u, i))) continue;
      const x = i % W, y = (i / W) | 0;
      const nextTo = foes.some((f) => Math.max(Math.abs(f.x - x), Math.abs(f.y - y)) === 1 && !cornerBlocked(b, x, y, f.x, f.y) && !(u.side !== (b.holders || "player") && barredCell(b.cells[idx(f.x, f.y)])));
      const sc = (nextTo ? -100 : field[i]) + r.dist[i] * 0.05 + (u.kind !== "zombie" && b.acid && b.acid.length && acidAt(b, x, y) ? ACID.stand / 3 : 0); // people: not into a spitter's acid (acid.js)
      if (!best || sc < best.sc) best = { x, y, sc, cost: r.dist[i], nextTo };
    }
    if (!best || best.cost === 0) {
      const fa = fortApproach(b, u, field); // outside a fort's wall: on to an opening, or batter the gate
      if (fa === "bash") return;
      if (fa === "moved") continue;
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
  faceToward(u, x, y);
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
  return c.k === "gate" ? "Gate" : c.k === "palisade" ? "Wall section" : c.k === "boarded" ? boardedName(c) : c.k === "bdoor" || c.k === "idoor" || c.k === "door" ? (c.roll ? "Roller door" : c.dk && DOOR_KINDS[c.dk] ? DOOR_KINDS[c.dk].name : "Door") : c.k === "window" ? "Window" : CELL[c.k].name;
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
  else if (c.k === "window") smashWindow(b, c); // windows.js: broken, half cover still, vaulted through
  else if (c.k === "boarded") breakBoarded(b, c, x, y); // barricade.js: the boards go, and the door or window with them
  else if (FURNITURE[c.k]) breakPiece(b, c); // a shoved piece of furniture (barricade.js): smashed to splinters, open floor again (or the door frame it stood in)
  else if (c.k === "tanktrap") c.k = "rubble"; // a bridge barricade's trap, broken up: open ground again (a vehicle can pass)
  else if (c.k === "cart") cartKnocked(b, x, y); // carts.js: shoved over, its cell open again (the cart and its load stay there)
  b.losCache.fill(0);
  if (b.tier) b.tier.broken = (b.tier.broken || 0) + 1;
  say(b, by && by.side === "enemy" ? `${by.kind === "zombie" ? "The dead" : by.name} break${by.kind === "zombie" ? "" : "s"} through the ${name}!` : `The ${name} gives way!`, "danger");
  // Glass going (a window, a glass door): the crash carries (windows.js WINDOW.BREAK: the raid's noise, Heat, the unaware wake).
  if (c.k === "smashed" || (c.dk === "glass" && c.k === "doorway")) glassNoise(b, x, y, { say, alertNear });
}

function shouldFlee(b) {
  if (nlBreak(b)) return true; // nonlethal.js: several of them gave up at once
  const humans = b.units.filter((u) => u.side === "enemy" && u.kind === "human" && (active(u) || (u.aboard && !u.down && !u.dead && !u.fled))).length; // riding in their Humvee: still in the fight
  const mine = b.units.filter((u) => u.side === "player" && active(u)).length;
  return humans * 3 <= b.enemyStart && mine >= humans * 2;
}

// The edge enemies run for: east, or the side a base was attacked from (deploy.js, transformBattle).
const exitEdge = (b, x, y) => (b.side === "west" ? x === 0 : b.side === "north" ? y === 0 : b.side === "south" ? y === H - 1 : x === W - 1);
function flee(b, u) {
  if (u.side === "enemy" && fleeToCar(b, u)) return; // their vehicle pulling back: in with it (carBack waits)
  if (exitEdge(b, u.x, u.y)) { u.fled = true; u.ap = 0; say(b, `${u.name} runs off.`, "good"); return; }
  // Out of everyone's sight and well clear of them: gone, not a long run to the map's edge (battlesize.js).
  if (u.fleeing && fledFarEnough(b, u)) { u.fled = true; u.ap = 0; say(b, `${u.name} gets away.`, "good"); return; }
  coverSmoke(b, u, foesOf(b, u)); // siege.js: the turn the retreat starts, one of them throws smoke behind them (an action)
  const r = reachable(b, u, dashRange(u));
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
  KG: 0.5, FREE_KG: 8, // the load carried (u.armLoad, kg: carrykit.js): −0.5 a kg over 8 (a vest and a rifle about −3, full kit about −10)
};
// The escape check's penalty for the kit carried (kg) (escapeOdds and breakoff.js by the numbers).
export const loadPenalty = (kg) => RETREAT.KG * Math.max(0, (Number.isFinite(kg) ? kg : 0) - RETREAT.FREE_KG);
// How far a unit can go with the actions it has: mob a tile an action, a Medium load's dash (both actions) a tile less
// (carrykit.js weighPlayer / weighEnemy: u.dash).
export const dashRange = (u) => moveMob(u) * u.ap + (u.ap >= 2 && !u.sneaking ? u.dash || 0 : 0);
// The tiles one action's move covers: sneaking (vision.js) is slower.
export const moveMob = (u) => Math.max(1, (u.sneaking ? sneakMob(u) : u.mob) - (u.vaulted || 0)); // vaulted: winded from a vault this turn (VAULT)

// ---------- Evac (the Evac button: combatAct "evac") ----------
// Everyone still standing heads for the way out with the actions they have: the extraction zones of a raid or the
// evac strip of a battle, or a free seat in the team's vehicle, whichever is nearer. Whoever reaches a zone extracts,
// whoever reaches the strip slips away, whoever reaches the vehicle gets in (and in it counts as out: leaveAboard).
// Upstairs (buildingmaps.js storeys) they make for the stairs first. The order stands (b.evacOrder): every turn
// starts with the next leg (startPlayerTurn) until everyone is out or it is called off ("evacStop"). The downed are
// not carried (Sound the retreat carries them).
export function evacRefusal(b) {
  const exits = b.raid ? b.raid.zones.length > 0 : !!(b.evacCols || b.evacMask);
  if (!exits && !b.vehicle) return "There is no way out of this fight: no exit and no vehicle.";
  if (!b.units.some((u) => u.side === "player" && activeAny(u))) return "Nobody left on foot to get out.";
  return "";
}
// Evacuating by the vehicle in a raid: a unit on the ground floor standing on any cell around the team's vehicle (the
// 8 cells round each of its cells: atVehicle, the same reach as boarding, loading the trunk and driving) can extract
// in it, wherever the vehicle has been driven; an extraction zone the vehicle touches works as before.
export function vehicleExit(b, u) {
  return !!(b && b.raid && u && !u.aboard && !(u.f || 0) && carOf(b, u) && atVehicle(b, u));
}
function evacTargets(b, u) {
  const out = [];
  if ((u.f || 0) > 0) return (b.raid && b.raid.stairs ? b.raid.stairs : []).filter(([x, y]) => cellAt(b, x, y).walk);
  if (b.raid) for (const z of b.raid.zones) for (let y = z.y0; y < z.y0 + z.h; y++) for (let x = z.x0; x < z.x0 + z.w; x++) { if (inside(x, y) && cellAt(b, x, y).walk) out.push([x, y]); }
  else out.push(...evacCells(b));
  const v = b.vehicle;
  if (v && (b.raid ? !!carOf(b, u) : aboardCount(b) < (v.seats || 4))) { // a raid: extract from beside it (vehicleExit); a battle: a free seat
    for (let y = v.y - 1; y <= v.y + v.h; y++) for (let x = v.x - 1; x <= v.x + v.w; x++) {
      if (!inside(x, y) || (x >= v.x && y >= v.y && x < v.x + v.w && y < v.y + v.h)) continue;
      if (cellAt(b, x, y).walk && b.cells[idx(x, y)].k !== "vehicle") out.push([x, y]);
    }
  }
  return out;
}
export function evacTurn(state, b) {
  aiDrive++; // the volunteers follow the Evac too
  try { return evacTurnNow(state, b); } finally { aiDrive--; }
}
function evacTurnNow(state, b) {
  bindDims(b);
  let moved = 0;
  const seatsLeft = () => (b.vehicle ? (b.vehicle.seats || 4) - aboardCount(b) : 0);
  const order = b.units.filter((u) => u.side === "player" && activeAny(u) && u.ap > 0);
  // The nearest to a way out go first (they clear the way for the others).
  const rough = (u) => { const t = evacTargets(b, u); return t.length ? Math.min(...t.map(([x, y]) => dist(u.x, u.y, x, y))) : 99; };
  order.sort((a, c) => rough(a) - rough(c));
  for (const u of order) {
    for (let step = 0; step < 4 && !b.over && activeAny(u) && u.ap > 0; step++) {
      if (b.floors && (u.f || 0) !== (b.floor || 0)) setFloor(b, u.f || 0);
      bindDims(b);
      if ((u.f || 0) > 0) {
        if (b.cells[idx(u.x, u.y)].k === "stairs") { if (combatAct(state, { type: "godown", unit: u.id })) break; moved++; continue; }
      } else if (b.raid && (zoneAt(b, u.x, u.y) >= 0 || vehicleExit(b, u))) { if (!combatAct(state, { type: "extract", unit: u.id })) moved++; break; }
      else if (!b.raid && evacAt(b, u.x, u.y)) { if (!combatAct(state, { type: "retreat", unit: u.id })) moved++; break; }
      else if (b.vehicle && seatsLeft() > 0 && atVehicle(b, u)) { if (!combatAct(state, { type: "board", unit: u.id })) moved++; break; }
      const targets = evacTargets(b, u);
      if (!targets.length) break;
      const field = distField(b, targets, u);
      const r = reachable(b, u, dashRange(u), { manual: true });
      const here = field[idx(u.x, u.y)];
      let best = -1;
      for (let i = 0; i < W * H; i++) {
        if (!isFinite(r.dist[i]) || r.dist[i] <= 0 || !isFinite(field[i]) || unitAt(b, i % W, (i / W) | 0)) continue;
        if (best < 0 || field[i] < field[best] || (field[i] === field[best] && r.dist[i] < r.dist[best])) best = i;
      }
      if (best < 0 || !(field[best] < here)) break;
      // Only as far as one action takes them when that already reaches the way out (the second action then extracts,
      // slips away or gets in).
      if (u.ap >= 2 && r.dist[best] > u.mob) {
        let near = -1;
        for (let i = 0; i < W * H; i++) if (isFinite(r.dist[i]) && r.dist[i] > 0 && r.dist[i] <= u.mob && field[i] === 0 && !unitAt(b, i % W, (i / W) | 0)) { near = i; break; }
        if (near >= 0) best = near;
      }
      if (combatAct(state, { type: "move", unit: u.id, x: best % W, y: (best / W) | 0 })) break;
      moved++;
    }
  }
  bump(b);
  return moved;
}

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
    if (e.kind === "human" && hasShots(b, e) && canSee(b, e, u)) shooters++;
    else if ((e.kind === "zombie" || !hasShots(b, e)) && dist(e.x, e.y, u.x, u.y) <= e.mob * 2) chasers++;
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
  add("load carried", -loadPenalty(u.armLoad));
  add(`Scouting ${u.scouting || 0}`, RETREAT.SCOUTING * (u.scouting || 0));
  add((u.fleet || 0) < 0 ? "Slow" : "Fleet-Footed", u.fleet || 0); // traits.js (Slow: below 0)
  add("night", b.night || b.dark ? RETREAT.NIGHT : 0);
  add("team headset", linkEscape(b, u)); // hearing.js: a linked teammate calls the way out
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
  const standing = b.units.filter((u) => u.side === "player" && active(u) && !u.captive); // a captive on a rescue raid gets out on foot (rescueraid.js)
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
  if (hasShots(b, u)) { // an empty magazine is one action away from firing again
    const ch = Math.max(10, Math.min(95, u.aim + (w.aim || 0) - (vsPeople ? COVER_DEF[1] : 0)));
    return (ch / 100) * ((w.dmg[0] + w.dmg[1]) / 2) * u.dmgMult;
  }
  const d = w.melee ? w.dmg : BASH;
  return (Math.max(10, Math.min(95, u.meleeAim)) / 100) * ((d[0] + d[1]) / 2) * (w.melee ? u.dmgMult : 1) * (u.meleeDmg || 1) * 0.4;
}
export function fightOutlook(b) {
  bindDims(b);
  const mine = b.units.filter((u) => (u.side === "player" || (b.setup.watch && u.side === "third")) && active(u)); // volunteers.js: a fight you watch: the group's own fighters stand with your people
  const theirs = b.units.filter((u) => u.side === "enemy" && active(u) && !u.fleeing);
  const team = b.units.filter((u) => u.side === "player" && !(u.left && !u.carried));
  const people = theirs.filter((u) => u.kind === "human").length / Math.max(1, theirs.length);
  // A rooted boss (hivecrawl.js's Hivemind) reaches only those who come close: a quarter of its blows, half its flesh.
  // A boss with an outlook of its own (registerBossAI fn.outlook(b, u): { fire, life, ours }): the Hivemind burning
  // or reeling counts for less, and fire and bangs still in hand count for your side (hivecrawl.js).
  const adj = new Map();
  for (const u of theirs) { const ai = bossAI(u); const j = ai && ai.outlook ? ai.outlook(b, u) : null; if (j) adj.set(u, j); }
  const fire = (list, vsPeople) => list.reduce((a, u) => a + firepower(b, u, vsPeople) * (u.rooted ? 0.25 : 1) * (adj.get(u)?.fire ?? 1), 0);
  const life = (list) => list.reduce((a, u) => a + (u.hp / Math.max(0.05, u.armor)) * (u.rooted ? 0.5 : 1) * (adj.get(u)?.life ?? 1), 0);
  const edge = [...adj.values()].reduce((a, j) => a * (j.ours ?? 1), 1);
  const ours = fire(mine, people >= 0.5) * life(mine) * edge, them = fire(theirs, true) * life(theirs);
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
  aiDrive++;
  try { return autoPlayerTurnNow(state, opts); } finally { aiDrive--; }
}
function autoPlayerTurnNow(state, opts) {
  const b = state.combat;
  bindDims(b);
  if (b) noteJamWeather(state, b);
  if (b && !b.over && b.phase === "deploy") { endDeploy(b); return void afterDeploy(state, b); } // deploy.js: default positions, then fight
  if (!b || b.over || b.phase !== "player") return;
  // Before going in (raidplan.js): the battle AI goes in as things are (the battle screen's AI playing your side plans
  // first: ui/combat.js combatTick → raidplan.js botPlan).
  closePlan(b);
  // A site with several buildings (buildingmaps.js): the AI picks one by its own dice (or the street), then plays it.
  if (b.raid && b.raid.choose) {
    const list = b.raid.choose;
    const pick = list[Math.floor(hash01(state.seed, "autobuilding", b.tileId, state.hour) * list.length) % list.length];
    chooseBuilding(state, pick.id);
    if (state.combat !== b) return autoPlayerTurnNow(state, opts);
    b.raid.choose = null;
  }
  if (b.raid) return autoRaidTurn(state);
  if (b.rescue && !rescueDone(b) && clearEnough(b)) { /* the captives first (rescueraid.js) */ } else if (clearEnough(b)) return void callClear(state, b); // battlesize.js: a couple of far-off stragglers left
  // A fight that is clearly lost: everyone runs for it (soundRetreat), carrying the downed next to them. On a base's
  // wall map: everyone falls back to the yard and the buildings instead (interior.js).
  const teamLeft = !b.rescue || b.units.some((u) => u.side === "player" && active(u) && !u.captive); // rescueraid.js: freed captives on their own make for the strip themselves
  const giveUp = opts.retreat === false || state.autoRetreat === false || !teamLeft ? null : retreatAdvice(b, aiStyle(state, b, opts)); // state.autoRetreat: a test switch
  if (giveUp && giveUp.fallBack) return void fallBack(state, { by: "ai", why: giveUp.why });
  if (giveUp) {
    botRetreatSmoke(state, b, inEvac); // stealth.js: a smoke grenade over the team first, if anyone has one
    return void soundRetreat(state, { by: "ai", why: giveUp.why });
  }
  autoDrop(state, b); // carry.js: the AI sets down what it carries by hand before it fights (free)
  if (b.rescue) rescueBot(state, b); // rescueraid.js: to the cell, the door, the ropes, the keys; captives escape; then the way out
  botCar(state, b); // your turreted vehicle: a crew in, then driven as theirs is (carTurn)
  for (const u of b.units.filter((x) => x.side === "player" && x.vol == null)) { // volunteers act in volunteerTurn
    if (b.over) return;
    if (active(u) && u.ap > 0) botSiege(state, b, u); // siege.js: push a ladder, rocks on the ram, lead the ram, set a ladder
    if (active(u) && u.ap > 0) botDecoy(state, b, u); // decoys.js: a decoy to pull the dead off your people
    if (active(u) && u.ap > 0) botAttackThrow(state, b, u); // stealth.js: a grenade, a pipe bomb or a Molotov on a crowd
    if (active(u) && u.ap > 0 && u.gl) aiLaunch(b, u); // launchers.js: HE on a crowd, a rocket at their ram, their Humvee, their gate
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

// ---------- volunteers (volunteers.js) ----------
// An allied group's people with your team: side "player" (the enemy fights them, they count in the outlook and the
// end of the fight), u.vol their group's id. They take no orders from you (combatAct refuses them unless the AI is
// driving: aiDrive); they act on their own at the end of your turn (volunteerTurn): while the enemy has not noticed
// anyone they keep near your people and hold their fire (they follow your lead when you sneak), else they fight as the
// battle AI fights your side (aiUnit: cover, shots, reloads, meds and dragging the downed). In a raid they fight what
// is aware and near (VOL_RAID tiles), else stay with the team. The Evac and the retreat take them along; when your
// people are all out they go too (volunteersFollow); with your people down and none out they fight on.
let aiDrive = 0;
export const VOL_RAID = 10;
export const volRefusal = (u) => `${u.name} is a volunteer from ${u.volGroup || "another group"}: they follow their own group's orders, not yours.`;
export const isVolUnit = (u) => !!(u && u.vol != null && u.side === "player");
export function volunteerTurn(state, b) {
  const vols = b.units.filter((u) => u.side === "player" && u.vol != null && active(u) && u.ap > 0);
  if (!vols.length || b.over) return;
  aiDrive++;
  try {
    for (const u of vols) {
      if (b.over) break;
      if (!active(u) || u.ap < 1) continue;
      const view = b.floors ? b.floor || 0 : null;
      if (b.floors && (u.f || 0) !== view) setFloor(b, u.f || 0);
      bindDims(b);
      const hot = b.units.some((e) => e.side === "enemy" && active(e) && e.aware && (u.f || 0) === (e.f || 0) && (!b.raid || dist(u.x, u.y, e.x, e.y) <= VOL_RAID));
      aiFlashlight(b, u, true); // ailights.js: their light on once the team is found, in the dark
      const order = u.volOrder || "free";
      const lead = order === "follow" ? unitById(b, u.volLead) : null;
      if (order === "hold") volHold(b, u, hot);
      else if (order === "follow" && lead && activeAny(lead)) { if (!(hot && volShotHere(b, u))) volFollow(b, u, lead); }
      else if (hot) aiUnit(b, u);
      else volFollow(b, u);
      if (b.floors && (b.floor || 0) !== view) setFloor(b, view);
      bindDims(b);
      checkEnd(state, b);
    }
  } finally { aiDrive--; }
  bump(b);
}
// The orders you can give a volunteer (combatAct "volOrder"): "free" (their own judgement, the default), "hold" (stay
// where they are: shoot from there, reload, else watch), "follow" (keep with one of your people: shoot from where they
// stand when there is a fair shot, else move up to them). Never in a fight you only watch.
export const VOL_ORDERS = { free: "Free", hold: "Hold here", follow: "Follow" };
function volOrder(b, u, act) {
  if (u.watched) return volRefusal(u);
  if (!VOL_ORDERS[act.order]) return "No such order.";
  if (act.order === "follow") {
    const t = unitById(b, act.target);
    if (!t || t.side !== "player" || t.vol != null || !activeAny(t)) return "Pick one of your people for them to follow.";
    u.volLead = t.id;
  }
  u.volOrder = act.order;
  say(b, `${u.name}: ${act.order === "follow" ? `following ${unitById(b, u.volLead).name}` : VOL_ORDERS[act.order].toLowerCase()}.`, "info");
  bump(b);
  return "";
}
function volShotHere(b, u) {
  if (aiReload(b, u) && u.ap < 1) return true;
  if (!canFire(b, u)) return false;
  const shot = bestShot(b, u, foesOf(b, u));
  if (!shot || shot.o.chance < 40) return false;
  fire(b, u, shot.t);
  u.ap = 0;
  return true;
}
function volHold(b, u, hot) {
  if (hot && !volShotHere(b, u) && u.ap > 0) { const adj = foesOf(b, u).find((f) => meleeReach(b, u, f)); if (adj) { aiMelee(b, u); return; } u.ow = !u.stun; }
  u.ap = 0;
}
// Nobody to fight: stay within 2 tiles of the nearest of your own people (on their floor), else hold. lead: the one
// they were told to follow.
function volFollow(b, u, lead = null) {
  const own = b.units.filter((o) => o.side === "player" && o.vol == null && activeAny(o) && (o.f || 0) === (u.f || 0));
  if (!own.length && !lead) { u.ap = 0; return; }
  lead = lead || own.sort((a, c) => dist(u.x, u.y, a.x, a.y) - dist(u.x, u.y, c.x, c.y))[0];
  if (dist(u.x, u.y, lead.x, lead.y) <= 2.5) { u.ap = 0; return; }
  const r = reachable(b, u, u.mob * Math.min(2, u.ap));
  let best = -1, bd = dist(u.x, u.y, lead.x, lead.y);
  for (let i = 0; i < W * H; i++) {
    if (!isFinite(r.dist[i]) || r.dist[i] <= 0 || unitAt(b, i % W, (i / W) | 0)) continue;
    const d = dist(i % W, (i / W) | 0, lead.x, lead.y);
    if (d < bd - 0.01 && d >= 1) { bd = d; best = i; }
  }
  if (best >= 0) moveAlong(b, u, pathTo(r, best % W, (best / W) | 0));
  u.ap = 0;
}
function volunteersFollow(b) {
  if (b.setup && b.setup.watch) return; // a fight you watch: there are none of yours to follow
  const vols = b.units.filter((u) => u.side === "player" && u.vol != null && activeAny(u));
  if (!vols.length) return;
  const own = b.units.filter((u) => u.side === "player" && u.vol == null);
  if (own.some((u) => (b.raid ? activeAny(u) : active(u)))) return;
  if (!b.raid && own.length && !own.some((u) => u.left && !u.dead)) return; // your people down, nobody out: they fight on
  for (const u of vols) { u.left = true; u.ap = 0; }
  say(b, `${vols.map((u) => u.name.split(" ")[0]).join(", ")} pull${vols.length === 1 ? "s" : ""} out with your people.`, "info");
}

// ---------- ending ----------
function checkEnd(state, b) {
  if (b.over) return;
  volunteersFollow(b); // volunteers.js: your people all out (or, in a raid, none of them standing): they pull out with them
  if (b.raid) {
    if (!b.units.some((u) => u.side === "player" && activeAny(u))) { leaveAboard(b); endRaid(state, b); } // nobody on foot on any floor (buildingmaps.js storeys): whoever is in the vehicle drives off with it
    return;
  }
  // Attackers still outside a base's wall waiting to come in (interior.js) count as not beaten.
  // A spotted Sleeper lying where it is (sleepers.js) does not hold the field.
  if (!b.units.some((u) => u.side === "enemy" && !u.dormant && (active(u) || (u.off && !u.dead && !u.aboard))) && !carHolds(b)) return endBattle(state, b, "victory"); // their Humvee still able to drive off: not yet
  if (!b.units.some((u) => u.side === "player" && active(u))) { leaveAboard(b); endBattle(state, b, b.units.some((u) => u.side === "player" && u.left) ? "retreat" : "defeat"); } // in the vehicle counts as out
}

// Ends the open battle now (a battle played out headless that ran too long: defences.js fightNow).
export function endBattleNow(state, outcome) {
  if (state.combat && !state.combat.over) endBattle(state, state.combat, outcome);
}
// raidplan.js callOff: the team turns back before going in (every one of yours marked left, b.calledOff set): the battle
// ends now, a raid as one nobody searched (endRaid: 0 hours, result.raid.calledOff), anything else as a retreat with
// everyone out (endBattle: no gear worn, result.calledOff).
export function endCalledOff(state) {
  const b = state.combat;
  if (!b || b.over) return;
  bindDims(b);
  if (b.raid) { leaveAboard(b); endRaid(state, b); } else endBattle(state, b, "retreat");
}

function endBattle(state, b, outcome) {
  const rng = state.rng;
  b.over = true;
  settleVehicle(state, b, outcome); // won: everyone out of the vehicle on the field; else they drive off in it. What ramming cost it
  b.phase = "over";
  const setup = b.setup;
  const cause = `in a fight with ${setup.enemy.name || setup.enemy.kind}`;
  const zombies = setup.enemy.kind === "zombies";
  const hurtIds = [], deadIds = [];
  const lines = [];
  MED.settleFoes(b, outcome); // medics.js: the enemy's downed: prisoners if stabilized or tied after a win, else dead
  // medics.js medicLevel: Medicine (with the kit), and more for a medic with kit uses left.
  const medic = MED.medicLevel(b.units.filter((u) => u.side === "player" && active(u)));
  // A retreat: the downed carried out by the sounded retreat (soundRetreat) or dragged onto the evac strip go with
  // the others, and pull through like the downed after a win (the medic among those who got out).
  const outMedic = MED.medicLevel(b.units.filter((u) => u.side === "player" && u.left && !u.down && !u.dead));
  const carriedIds = [];
  lines.push(...nlBattleEnd(state, b, outcome)); // nonlethal.js: the enemy holding the field takes your knocked out and surrendered
  for (const u of b.units) {
    if (u.side !== "player" || u.nlTaken) continue; // nlTaken: a captive now (conflicts.js)
    const s = survivorById(state, u.sid);
    if (!s || !s.alive) continue;
    if (u.captive && captiveStays(state, b, u, s, outcome)) continue; // rescueraid.js: still held: hurt, not lost
    const gone = MED.takenAway(state, b, u, s, outcome); // medics.js: dragged off by raiders: their prisoner
    if (gone) { lines.push(gone.line); if (gone.dead) deadIds.push(s.id); continue; }
    let dies = u.dead;
    const carried = outcome === "retreat" && !u.dead && u.down && (u.carried || evacAt(b, u.x, u.y));
    if (carried) {
      dies = !rng.chance(u.stab || u.stabSure ? 1 : 0.5 + outMedic * 0.02);
      if (!dies) carriedIds.push(s.id);
    } else if (!dies && u.down && !nlSpared(u)) { // nonlethal.js: the knocked out and surrendered do not bleed out
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
    const hp = u.down && !u.surr ? rng.int(5, 15) : u.hp; // surr: gave up, not hurt by it (nonlethal.js)
    if (hp < s.health - 0.01) hurt(state, s, (s.health - hp) / battleArmor(s), b.tileId, cause); // hurt() takes Tough and the armour worn now off again (armour.js: per-hit armour did the work in battle)
    else s.health = Math.min(100, Math.max(s.health, hp));
    if (!s.alive) { deadIds.push(s.id); continue; }
    if (s.health < u.startHp - 0.5) hurtIds.push(s.id);
    if (u.down) lines.push(carried ? `${u.name} was carried out, barely alive (health ${Math.round(s.health)}).` : `${u.name} pulled through, barely (health ${Math.round(s.health)}).`);
  }
  if (b.retreatOrder) lines.unshift(...b.retreatOrder.lines);
  wearFielded(state, b, !b.calledOff); // called off before anyone went in (raidplan.js callOff): nothing fought with, nothing worn
  armsDropsEnd(state, b, outcome); // carry.js: won, the loads set down from the arms are picked up again (before the piles become loot)
  groundEnd(state, b, outcome); // ground.js: what your people carry loose comes home; a body searched in the battle keeps what is left on it
  // carriers.js: the risen still walking take their things into the walking loot; bodies in the car come home (the
  // team keeps its car unless it was beaten); the burnt leave nothing; the swarm's bites leave the worm in the living.
  endBodies(state, b, outcome, outcome !== "defeat");

  settleSpears(state, b, outcome === "victory", lines); // thrown spears: picked up after a win (an enemy's is on its body), lost otherwise
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
  const piles = groundLeftovers(state, b, outcome); // ground.js: what lies on the ground or was left on a body searched in the battle (a win: to loot; else left there)
  fieldFinds(b, loot);
  if (outcome === "victory") {
    // carriers.js: a body that got up is one body, the risen one's (with the person's kit); one of yours who got up is
    // their own body as below; a worm swarm leaves none.
    // A burnt body or one laid in the car is no body here (carriers.js); one of the walking dead put down has the
    // person's things on it (walkingBody).
    for (const e of enemies) {
      if (!e.dead || e.roseAs != null || e.ztype === "swarm" || e.ztype === "sleeper" || e.burnt || e.inVehicle || searchedInBattle(b, e)) continue; // searched in the battle: its leftovers are in piles
      if (e.walking) { b.bodies.push(walkingBody(state, b, e)); continue; }
      if (e.turned && e.turned.sid != null) continue;
      b.bodies.push(e.turned ? turnedBody(rng, e) : launcherBody(b, e, enemyBody(rng, e, KITS[e.kit] || (e.kind === "zombie" ? null : KITS.raiders)))); // launchers.js: their launcher and rounds; a blast's wear (section 24)
    }
    for (const e of captives) { if (searchedInBattle(b, e)) continue; const body = launcherBody(b, e, enemyBody(rng, e, KITS[e.kit] || KITS.raiders)); body.name = `${e.name} (prisoner)`; b.bodies.push(body); }
    b.bodies.push(...piles);
    b.bodies.push(...blastPiles(b, nlDropPiles(state, b))); // nonlethal.js: the weapons the surrendered threw down (launchers.js: worn by a blast that reached them)
    for (const u of b.units) {
      const s = u.side === "player" && deadIds.includes(u.sid) ? survivorById(state, u.sid) : null;
      // carriers.js: still walking as one of the dead, there is no body here (their things stay at the death site
      // or in the armory, world.js killSurvivor); put down, the body is "Dana (turned)".
      if (s && !walksOn(b, u) && !u.burnt && !u.inVehicle) { const body = allyBody(s, u); body.name = turnedName(b, u); b.bodies.push(body); }
    }
    b.bodies = b.bodies.filter((body) => !bodyEmpty(state, body));
  }
  // The arrows loosed: about half picked up again when the field is yours (world.js ARROWS.BACK), none otherwise.
  const arrowsBackN = pickUpArrows(b, outcome === "victory");
  lines.push(...thrownBack(state, b, outcome === "victory")); // stealth.js: the empty magazines thrown as lures, picked up when the field is yours
  lines.push(...pickUpBrass(state, b, outcome === "victory")); // reloading.js: the brass fired, picked up when the field is yours
  if (b.arrowsUsed) lines.push(arrowsBackN ? `Picked up ${arrowsBackN} of the ${b.arrowsUsed} arrow${b.arrowsUsed === 1 ? "" : "s"} shot.` : `The ${b.arrowsUsed} arrow${b.arrowsUsed === 1 ? "" : "s"} shot ${b.arrowsUsed === 1 ? "is" : "are"} lost.`);
  if (setup.watch) b.bodies = []; // volunteers.js: a fight you watched: the field is the group's (your people get their share)
  b.result = {
    outcome, enemiesKilled: killed, enemiesLeft: original.length - killed - captives.length,
    survivorsHurt: hurtIds, survivorsDead: deadIds, ammoUsed: b.ammoUsed, arrowsUsed: b.arrowsUsed || 0, arrowsBack: arrowsBackN, loot,
    enemyVehicle: outcome === "victory" && b.enemyVehicle && !(b.raidHumvee && b.raidHumvee.gone) ? { ...b.enemyVehicle } : null, // their vehicle left on the field (conflicts.js)
    ...(b.raidHumvee ? { humveeOut: !!b.raidHumvee.gone, humveeWear: b.raidHumvee.wear || 0 } : {}), // a raid's Humvee drove off with them (raidCarTurn), and what it took (conflicts.js)
    turns: b.turn, medsUsed: b.medsUsed, extraKilled: enemies.filter((u) => u.reinforcement && u.dead).length,
    // Played on the map: gear wear is done, and the dead were there to search (so handlers add no "loot from the bodies").
    tactical: true, worn: true, bodies: b.bodies.length,
    calledOff: !!b.calledOff, // raidplan.js callOff: turned back before going in (conquest.js, rescueraid.js say so)
    knockedOut: captives.length, prisoners: captiveRecords(state, b, captives), // prisoners.js: taken home by finishCombat
    carriedIds, // the downed taken out in a retreat
    third: thirdResult(b), // thirdside.js: the survivors or soldiers who were there (null: none)
    // A base battle (interior.js): where it was decided: held at the wall, in the yard, in the buildings; or lost.
    ...(b.tier ? { tier: outcome === "victory" ? b.tier.stage : outcome === "retreat" ? "abandoned" : "overrun", fellBack: b.tier.map === "interior" } : {}),
    // The retreat was sounded (soundRetreat): who got out, who was caught, who was carried or had to be dropped.
    retreatOrder: b.retreatOrder ? { by: b.retreatOrder.by, turn: b.retreatOrder.turn, escaped: b.retreatOrder.escaped.slice(), caught: b.retreatOrder.caught.slice(), carried: b.retreatOrder.carried.slice(), dropped: b.retreatOrder.dropped.slice() } : null,
  };
  b.summary = lines;
  say(b, outcome === "victory" ? "Victory. The area is clear." : b.calledOff ? "Called off. The team turns back." : outcome === "retreat" ? "You pulled out of the fight." : "Defeat. Your team is down.", outcome === "victory" ? "good" : b.calledOff ? "info" : "death");
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
    sweepBoxes(s); // ammo.js: empty boxes of rounds thrown away
    if (fought) for (const [slot, item] of u.fielded || []) if (s.gear[slot] === item && !(slot !== "weapon" && armourSpec(item.key))) wearSlot(state, s, slot); // armour pieces wore by their hits (armour.js)
    dropBroken(state, s); // armour.js: a piece broken or shattered in the fight is gone
    if (u.kitUses && u.medKit && s.gear.tool === u.medKit) wearSlot(state, s, "tool", u.kitUses);
    MED.wearPackKit(state, u, s); // medics.js: a kit in a pocket or the pack
    settleEars(u, s, fought); // hearing.js: a pair of earplugs used
  }
  launcherBattleEnd(state, b); // launchers.js: the rocket tubes fired are gone; the blasts' wear on what your people carry
}

// Closes a finished battle: hands the result to the registered handler. take: first take everything that fits
// from the bodies (the default, as before looting existed); either way the rest stays where they fell.
export function closeCombat(state, { take = true } = {}) {
  const b = state.combat;
  if (!b || !b.over) return;
  settleMines(state, b); // mines.js: the base's fields keep the mines that did not go off
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
  house:     { name: "House",          boxes: ["cabinet", "shelf", "locker"],  loot: { food: [0.6, 2, 6], water: [0.35, 2, 4], meds: [0.07, 1, 1], scrap: [0.4, 1, 4], ammo: [0.15, 4, 12] }, gear: [["knife", 0.06], ["pistol", 0.04], ["sportspads", 0.03], ["backpack", 0.03], ["bottle", 0.08], ["flashlight", 0.03], ["bat", 0.03], ["revolver", 0.015], ["slingbag", 0.03], ["binoculars", 0.012], ["telescope", 0.003], ["compact9", 0.02], ["pistol22", 0.01], ["hammer", 0.04], ["golfclub", 0.02], ["kukri", 0.002], ["katana", 0.005]] },
  farmhouse: { name: "Farmhouse",      boxes: ["cabinet", "shelf", "locker"],  loot: { food: [0.75, 3, 8], water: [0.4, 2, 5], rawwater: [0.2, 2, 6], ammo: [0.25, 4, 12], meds: [0.05, 1, 1] }, gear: [["huntrifle", 0.06], ["machete", 0.05], ["leverrifle", 0.04], ["shotgun", 0.03], ["revolver", 0.02], ["binoculars", 0.03], ["dbshotgun", 0.04], ["rifle22", 0.05], ["pistol22", 0.01]] },
  store:     { name: "Store",          boxes: ["shelf", "shelf", "counter"],   loot: { food: [0.85, 4, 10], water: [0.6, 3, 8], meds: [0.06, 1, 1] }, gear: [["firecracker", 0.05], ["flashlight", 0.03], ["slingbag", 0.02], ["hikingpack", 0.01], ["golfclub", 0.01], ["katana", 0.003]] },
  kitchen:   { name: "Kitchen",        boxes: ["shelf", "counter", "cabinet"], loot: { food: [0.85, 4, 12], water: [0.6, 3, 6] }, gear: [["knife", 0.08], ["bottle", 0.12]] },
  pharmacy:  { name: "Pharmacy",       boxes: ["shelf", "cabinet", "counter"], loot: { meds: [0.9, 2, 6], food: [0.2, 1, 3] }, gear: [["surgkit", 0.05], ["bandagekit", 0.05]] },
  clinic:    { name: "Clinic",         boxes: ["cabinet", "locker", "shelf"],  loot: { meds: [0.85, 2, 5], water: [0.3, 1, 3] }, gear: [["surgkit", 0.08], ["bandagekit", 0.06]] },
  garage:    { name: "Garage",         boxes: ["locker", "crate", "shelf"],    loot: { fuel: [0.35, 1, 4], parts: [0.45, 1, 2], scrap: [0.7, 3, 8] }, gear: [["machete", 0.05], ["crowbar", 0.06], ["spikedbat", 0.03], ["flashlight", 0.05], ["prybar", 0.05], ["sledge", 0.03], ["hammer", 0.05], ["hatchet", 0.02], ["golfclub", 0.02]] },
  workshop:  { name: "Workshop",       boxes: ["crate", "locker", "shelf"],    loot: { scrap: [0.8, 4, 10], parts: [0.5, 1, 3], fuel: [0.1, 1, 2] }, gear: [["prybar", 0.05], ["sledge", 0.04], ["crowbar", 0.03], ["kneeguards", 0.02], ["hammer", 0.05], ["pickaxe", 0.02], ["hatchet", 0.02]] },
  warehouse: { name: "Warehouse",      boxes: ["crate", "crate", "shelf"],     loot: { scrap: [0.7, 4, 10], food: [0.35, 3, 8], parts: [0.3, 1, 2], fuel: [0.1, 1, 3] }, gear: [["prybar", 0.03], ["sandbags", 0.03], ["barbedwire", 0.02], ["pickaxe", 0.01], ["hammer", 0.02]] },
  office:    { name: "Offices",        boxes: ["cabinet", "cabinet", "counter"], loot: { scrap: [0.5, 1, 4], parts: [0.15, 1, 1], meds: [0.05, 1, 1], water: [0.3, 1, 3] }, gear: [["fireaxe", 0.03], ["slingbag", 0.03]] },
  armory:    { name: "Armory",         boxes: ["locker", "locker", "crate"],   loot: { ammo: [0.85, 15, 40] }, gear: [["pistol", 0.12], ["shotgun", 0.1], ["vest", 0.1], ["ar", 0.04], ["carbine", 0.05], ["baton", 0.06], ["riotarms", 0.04], ["riotlegs", 0.04], ["revolver", 0.03], ["binoculars", 0.04], ["smg", 0.03], ["semishotgun", 0.04], ["pistol45", 0.04], ["combatknife", 0.02], ["sniper", 0.005]] },
  barracks:  { name: "Barracks",       boxes: ["locker", "locker", "cabinet"], loot: { ammo: [0.6, 10, 25], food: [0.4, 3, 6], meds: [0.15, 1, 2] }, gear: [["vest", 0.08], ["plate", 0.04], ["nvg", 0.03], ["milradio", 0.03], ["flashlight", 0.06], ["rucksack", 0.04], ["camonet", 0.03], ["stove", 0.03], ["binoculars", 0.05], ["spotscope", 0.02], ["thermal", 0.02], ["combatknife", 0.04], ["etool", 0.04], ["tomahawk", 0.01], ["smg", 0.03], ["dmr", 0.02], ["sniper", 0.01], ["lmg", 0.008], ["amr", 0.006]] },
  motorpool: { name: "Motor pool",     boxes: ["crate", "locker", "shelf"],    loot: { fuel: [0.75, 4, 10], parts: [0.55, 1, 3] }, gear: [["prybar", 0.04], ["sandbags", 0.04], ["barbedwire", 0.03], ["etool", 0.03]] },
  barn:      { name: "Barn",           boxes: ["crate", "shelf"],              loot: { food: [0.7, 4, 10], fuel: [0.15, 1, 3], scrap: [0.3, 2, 4] }, gear: [["huntrifle", 0.05], ["sledge", 0.03], ["barbedwire", 0.03], ["beartrap", 0.03], ["prybar", 0.02], ["pickaxe", 0.03], ["dbshotgun", 0.02], ["hatchet", 0.02]] },
  lab:       { name: "Lab",            boxes: ["cabinet", "counter", "shelf"], loot: { meds: [0.3, 1, 2], parts: [0.4, 1, 2], scrap: [0.3, 1, 3] }, gear: [["surgkit", 0.05], ["bandagekit", 0.03], ["telescope", 0.03]] },
  cabin:     { name: "Hunting cabin",  boxes: ["locker", "shelf"],             loot: { food: [0.5, 2, 6], ammo: [0.5, 6, 18], meds: [0.07, 1, 1] }, gear: [["huntrifle", 0.08], ["machete", 0.06], ["leverrifle", 0.04], ["compbow", 0.02], ["beartrap", 0.03], ["stove", 0.03], ["ghillie", 0.02], ["fireaxe", 0.02], ["binoculars", 0.05], ["monocular", 0.03], ["spotscope", 0.02], ["rifle22", 0.05], ["hatchet", 0.05], ["dbshotgun", 0.02], ["spear", 0.01]] },
  hangar:    { name: "Hangar",         boxes: ["crate", "locker", "shelf"],    loot: { fuel: [0.6, 4, 10], parts: [0.5, 1, 3], scrap: [0.5, 3, 6] }, gear: [["prybar", 0.03], ["hikingpack", 0.02]] },
  cellblock: { name: "Cell block",     boxes: ["locker", "cabinet"],           loot: { food: [0.3, 1, 4], scrap: [0.3, 1, 3], ammo: [0.15, 4, 10] }, gear: [["knife", 0.08], ["baton", 0.03]] },
  control:   { name: "Control room",   boxes: ["cabinet", "counter"],          loot: { parts: [0.6, 1, 3], scrap: [0.4, 2, 5] }, gear: [["flashlight", 0.04]] },
  campsite:  { name: "Campsite",       outdoor: true, boxes: ["crate", "crate"], loot: { food: [0.5, 2, 5], water: [0.5, 2, 4], rawwater: [0.25, 2, 5], ammo: [0.25, 4, 10] }, gear: [["knife", 0.05], ["pipespear", 0.05], ["waterfilter", 0.04], ["padding", 0.04], ["hikingpack", 0.03], ["stove", 0.03], ["backpack", 0.02], ["hatchet", 0.04], ["etool", 0.02]] },
  wreck:     { name: "Wrecked cars",   outdoor: true, boxes: ["car", "car", "car"], loot: { fuel: [0.25, 1, 3], scrap: [0.5, 1, 4], parts: [0.2, 1, 1], food: [0.15, 1, 3] }, gear: [["pistol", 0.03], ["prybar", 0.02], ["slingbag", 0.02], ["compact9", 0.02]], alarm: 0.15 },
  // The cars left along a road or on a bridge (layRoad): placed on the road itself, not in a cluster. What people
  // fled with: fuel in the tanks, a bag of food and bottles, the odd gun in the glovebox. Some are locked (locks.js
  // "car": pick it, pry it with a crowbar, or shatter the glass, which wakes everything nearby).
  roadcars:  { name: "Cars on the road", outdoor: true, road: true, boxes: ["car", "car", "car"], loot: { fuel: [0.35, 1, 3], food: [0.3, 1, 3], water: [0.3, 1, 2], scrap: [0.35, 1, 3], ammo: [0.12, 4, 10], meds: [0.06, 1, 1] }, gear: [["pistol", 0.03], ["flashlight", 0.04], ["bottle", 0.06], ["slingbag", 0.03], ["backpack", 0.02], ["prybar", 0.02], ["binoculars", 0.01], ["compact9", 0.02]], alarm: 0.15 },
  pumps:     { name: "Fuel pumps",     outdoor: true, boxes: ["pump", "pump"], loot: { fuel: [0.7, 3, 8] }, gear: [] },
  gunshop:   { name: "Gun counter",    boxes: ["locker", "counter", "shelf"],  loot: { ammo: [0.85, 12, 35], scrap: [0.2, 1, 2] }, gear: [["pistol", 0.12], ["shotgun", 0.1], ["huntrifle", 0.1], ["vest", 0.05], ["kneeguards", 0.05], ["revolver", 0.08], ["leverrifle", 0.06], ["compbow", 0.04], ["xbow", 0.04], ["ghillie", 0.03], ["camonet", 0.03], ["binoculars", 0.06], ["spotscope", 0.03], ["monocular", 0.04], ["pistol22", 0.06], ["pistol45", 0.06], ["compact9", 0.06], ["rifle22", 0.06], ["dbshotgun", 0.05], ["semishotgun", 0.02], ["combatknife", 0.04], ["tomahawk", 0.03], ["kukri", 0.03], ["ak", 0.01]] },
  lockers:   { name: "Locker room",    boxes: ["locker", "locker", "shelf"],   loot: { water: [0.4, 1, 3], meds: [0.06, 1, 1], scrap: [0.3, 1, 3] }, gear: [["sportspads", 0.1], ["footballhelmet", 0.08], ["backpack", 0.06], ["kneeguards", 0.04], ["bat", 0.1], ["golfclub", 0.04]] },
  chapel:    { name: "Chapel",         boxes: ["cabinet", "shelf", "counter"], loot: { food: [0.5, 2, 6], water: [0.5, 2, 5], meds: [0.07, 1, 1] }, gear: [["bandagekit", 0.05]] },
  // First aid on hand: a school nurse, a fire station's first-aid room, a barracks' medical store (medfinds.js).
  nurse:     { name: "First-aid room",  boxes: ["cabinet", "shelf"],             loot: { meds: [0.3, 1, 2], water: [0.3, 1, 2] }, gear: [["bandagekit", 0.06]] },
  // Crash sites (crashes.js): wreckage and cargo cases in the open (locks.js names them and locks some cases).
  milwreck:  { name: "Helicopter wreck", outdoor: true, boxes: ["crate", "crate", "car"], loot: { ammo: [0.7, 10, 30], meds: [0.3, 1, 2], parts: [0.5, 1, 3], scrap: [0.6, 2, 6] }, gear: [["ar", 0.06], ["vest", 0.08], ["plate", 0.04], ["riothelmet", 0.06], ["milradio", 0.04], ["nvg", 0.03], ["assaultpack", 0.05], ["carbine", 0.03], ["rucksack", 0.04], ["camonet", 0.04], ["thermal", 0.03], ["binoculars", 0.04], ["combatknife", 0.03], ["dmr", 0.02], ["amr", 0.01]] },
  medwreck:  { name: "Medevac wreck",    outdoor: true, boxes: ["crate", "crate", "car"], loot: { meds: [0.9, 2, 6], water: [0.4, 1, 4], scrap: [0.4, 1, 4] }, gear: [["surgkit", 0.08], ["bandagekit", 0.12]] },
  newswreck: { name: "News chopper wreck", outdoor: true, boxes: ["crate", "car"], loot: { parts: [0.6, 1, 3], scrap: [0.7, 2, 6], water: [0.3, 1, 3] }, gear: [["hikingpack", 0.04], ["slingbag", 0.06]] },
  fuselage:  { name: "Broken fuselage",  boxes: ["crate", "locker", "crate"], loot: { food: [0.6, 3, 8], water: [0.5, 2, 6], meds: [0.15, 1, 2], ammo: [0.3, 6, 15], parts: [0.3, 1, 2] }, gear: [["assaultpack", 0.05], ["vest", 0.05], ["hikingpack", 0.04], ["slingbag", 0.04]] },
  // Army trucks (miltrucks.js): every truck is one container (kind "miltruck", its cargo is truckLoot, not this
  // table), placed by placeMilTrucks; its crew stands round it and some are still strapped in (truckCrewRises).
  miltrucks: { name: "Army trucks", outdoor: true, trucks: true, boxes: ["miltruck"], loot: {}, gear: [] },
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
  // A road with no site on it, and a bridge: the cars people left on the road (roadcars, placed on the road itself).
  road: ["roadcars", "roadcars", "wreck", "campsite"], bridge: ["roadcars", "roadcars", "roadcars", "campsite"],
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
  // The abandoned Army convoy (miltrucks.js): its trucks (the "miltrucks" area, added by createRaid), the cars that
  // were stuck behind it and the crews' last camp.
  convoy: ["roadcars", "campsite", "wreck"],
  // Points of interest (pois.js): the small places a tile holds besides its site. A campsite, a hiker camp and a
  // hunting blind have no building of their own (buildingmaps.js SITES): the open map with these areas.
  house: ["house", "house", "garage", "wreck"], neighbourhood: ["house", "house", "house", "garage", "wreck"], garage: ["garage", "garage", "workshop", "wreck"],
  corner: ["store", "store", "kitchen", "office"], pizza: ["kitchen", "kitchen", "store", "wreck"], farmstand: ["store", "barn", "campsite"],
  shed: ["barn", "workshop", "campsite"], blind: ["cabin", "campsite", "campsite"], campsite: ["campsite", "campsite", "wreck"],
  hikercamp: ["campsite", "campsite", "campsite"], mineshack: ["workshop", "cabin", "campsite"],
};

// kind: the point of interest raided (pois.js; a campsite, a hunting blind: no building of its own, its areas on the street map).
export function raidAreasFor(tile, kind = null) {
  const t = tile || { terrain: "plains" };
  if (kind && AREA_SETS[kind]) return AREA_SETS[kind];
  if (t.loc && AREA_SETS[t.loc.type]) return AREA_SETS[t.loc.type];
  if (t.road && !t.loc) return t.bridge ? AREA_SETS.bridge : AREA_SETS.road; // a bare road or a bridge: the cars on it
  return AREA_SETS[t.terrain] || AREA_SETS.plains;
}

// What an area tends to hold, for tooltips.
export function areaHint(type) {
  const a = AREAS[type];
  if (!a) return "";
  if (a.trucks) return "Likely: ammunition, rifles, armour, grenades, rations; maybe night vision or a radio. Opening one wakes the crew strapped in the cab";
  const sup = Object.entries(a.loot).sort((x, y) => y[1][0] - x[1][0]).map(([k]) => k);
  return `Likely: ${sup.join(", ")}${a.gear.length ? ", maybe gear" : ""}`;
}

export const zoneAt = (b, x, y) => (b.raid ? b.raid.zones.findIndex((z) => x >= z.x0 && x < z.x0 + z.w && y >= z.y0 && y < z.y0 + z.h) : -1);
// Containers carry c.f (their floor, buildingmaps.js storeys): the search helpers see the active floor's only.
// A container may cover several cells (a car: c.w × c.h cells from c.x, c.y; everything else one): next to it is next
// to any of them, its marker sits over its middle, and the ring of cells around it is where a searcher stands.
export const boxW = (c) => c.w || 1, boxH = (c) => c.h || 1;
export const inBox = (c, x, y) => x >= c.x && y >= c.y && x < c.x + boxW(c) && y < c.y + boxH(c);
export const boxCenter = (c) => [c.x + (boxW(c) - 1) / 2, c.y + (boxH(c) - 1) / 2];
const boxGap = (c, x, y) => Math.max(c.x - x, x - (c.x + boxW(c) - 1), c.y - y, y - (c.y + boxH(c) - 1), 0);
export const nearBox = (u, c) => (c.f || 0) === (u.f || 0) && boxGap(c, u.x, u.y) <= 1;
export function boxRing(b, c) {
  const out = [];
  for (let y = c.y - 1; y <= c.y + boxH(c); y++) for (let x = c.x - 1; x <= c.x + boxW(c); x++) if (!inBox(c, x, y) && x >= 0 && y >= 0 && x < b.w && y < b.h) out.push([x, y]);
  return out;
}
const onFloor = (b, c) => (c.f || 0) === (b.floor || 0);
export const boxAt = (b, x, y) => (b.raid ? b.raid.containers.find((c) => inBox(c, x, y) && onFloor(b, c) && !c.searched) || b.raid.containers.find((c) => inBox(c, x, y) && onFloor(b, c)) : null);
export const floorContainers = (b, f = b.floor || 0) => (b.raid ? b.raid.containers.filter((c) => (c.f || 0) === f) : []);
export function searchableNear(b, u) {
  bindDims(b);
  return b.raid ? b.raid.containers.filter((c) => !c.searched && nearBox(u, c) && !(c.lock && !c.lock.open)).sort((a, c) => (a.kind === "body") - (c.kind === "body")) : []; // locked: open it first (locks.js)
}

function genRaidMap(rng, tile, areaTypes, withVehicle, extra = {}) {
  const t = tile || { terrain: "plains" };
  const floor = { plains: "grass", forest: "grass", hills: "dirt", mountain: "gravel", suburb: "grass", city: "rubble", water: "grass" }[t.terrain] || "grass";
  const cells = Array.from({ length: W * H }, () => ({ k: "open", f: floor }));
  const reserved = new Uint8Array(W * H);
  const at = (x, y) => (inside(x, y) ? cells[idx(x, y)] : null);
  const put = (x, y, k, f) => { const c = at(x, y); if (c) { c.k = k; if (f) c.f = f; } };
  const free = (x, y) => { const c = at(x, y); return c && c.k === "open" && !reserved[idx(x, y)] && c.f !== "road" && c.f !== "floor"; };

  // Extraction zones: 3×3 at the edges. The first is where the team comes in.
  const zones = [];
  // On a bridge tile the river runs across the middle: the ways in and out are the two ends of the bridge.
  const zoneSpots = rng.shuffle([
    { side: "west", x0: 0, y0: rng.int(2, H - 5) },
    { side: "east", x0: W - 3, y0: rng.int(2, H - 5) },
    ...(t.bridge ? [] : [{ side: rng.chance(0.5) ? "north" : "south", x0: rng.int(8, W - 11), y0: 0 }]),
  ]);
  zoneSpots.sort((a, c) => (a.side === "west" ? -1 : c.side === "west" ? 1 : 0));
  for (const zs of zoneSpots) {
    const y0 = zs.side === "south" ? H - 3 : zs.y0;
    zones.push({ x0: zs.x0, y0, w: 3, h: 3, side: zs.side, vehicle: false });
    for (let y = y0 - 1; y <= y0 + 3; y++) for (let x = zs.x0 - 1; x <= zs.x0 + 3; x++) if (inside(x, y)) reserved[idx(x, y)] = 1;
  }
  let vehicle = null;
  if (withVehicle) { // "car" | "truck" | "bike": the team's vehicle in the entry zone (placeVehicle: 2 × 3 or 2 × 4 cells)
    const z = zones[0];
    z.vehicle = true;
    vehicle = placeVehicle(cells, W, H, z, withVehicle, (x, y) => inside(x, y) && cells[idx(x, y)].k === "open"); // a bike: 2 x 1
    if (!vehicle) put(z.x0 + 1, z.y0 + 1, "vehicle", "road"); // no room: the old single cell
  }

  // Road across the map (layRoad: ROAD.WIDTH wide, the cars left on it; on a bridge tile the river and the deck).
  const road = t.road ? layRoad(rng, cells, W, H, t, rng.int(3, H - roadWidth(H) - 3), { reserved, carsPer: Math.round(W / 5), lo: 5, hi: W - 6 }) : null;

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
    if (def.trucks) {
      // Army trucks (miltrucks.js trucksAt, extra.trucks): one container each, its cargo bed; an intact one often
      // padlocked (locks.js cargobed). One already opened is still there as cover, with nothing in it.
      const placed = placeMilTrucks(rng, cells, W, H, extra.trucks || [], road, (x, y, onRoad) => (onRoad ? inside(x, y) && cells[idx(x, y)].k === "open" && !reserved[idx(x, y)] : free(x, y)));
      if (!placed.length) continue;
      for (const { truck: x, rect } of placed) {
        if (x.opened) continue;
        const lock = x.cond === "burnt" ? 0 : x.cond === "intact" ? 0.5 : 0.25;
        containers.push({
          id: cid++, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, area: area.id, kind: "miltruck", searched: false, crew: x.crew,
          truck: { i: x.i, kind: x.kind, cond: x.cond, src: x.src, key: x.key, rich: x.rich }, label: `${truckName(x)}: cargo bed`,
          ...(rng.chance(lock) ? { lockKind: "cargobed" } : {}),
        });
      }
      const xs = placed.flatMap(({ rect }) => [rect.x0, rect.x0 + rect.w - 1]), ys = placed.flatMap(({ rect }) => [rect.y0, rect.y0 + rect.h - 1]);
      Object.assign(area, { x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, w: Math.max(...xs) - Math.min(...xs) + 3, h: Math.max(...ys) - Math.min(...ys) + 3, outdoor: true, trucks: placed.map(({ truck: x, rect }) => ({ i: x.i, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, crew: x.opened ? 0 : x.crew, ...(x.guard ? { guard: true } : {}), ...(x.src === "convoy" && !x.opened ? { convoy: true } : {}) })) }); // guard: a motor pool's ready vehicles; convoy: an unopened convoy truck (its guard: truckCrews)
      areas.push(area);
      continue;
    }
    if (def.road) {
      // Cars on the road itself (AREAS.roadcars), 2 × 3–4 cells each, lengthwise in the lanes (layRoad putCar: a free ring
      // round each, the road still open end to end); on a bridge the first such area's cars stand on the deck.
      if (!road) continue;
      const onDeck = road.deck && !areas.some((a) => a.type === type);
      const lo = onDeck ? road.deck.c0 : 3, hi = onDeck ? road.deck.c1 : W - 4;
      const n = rng.int(4, 6);
      const rects = [];
      for (let tries = 0; tries < 120 && rects.length < n; tries++) {
        const L = rng.pick(CAR_LEN.car);
        const rect = road.putCar(rng.int(lo, Math.max(lo, hi - L + 1)), rng.int(0, road.lanes - 1), "car", L, rng.int(0, 1e6));
        if (!rect) continue;
        if (!road.through()) { removeCar(cells, W, rect); continue; }
        rects.push(rect);
        containers.push({ id: cid++, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, area: area.id, kind: "car", searched: false, label: `${def.name}: ${onDeck ? "car on the bridge" : "car"}` });
      }
      // A crowded road: the cars already standing on it (layRoad's) are searchable too, up to the n wanted.
      if (rects.length < n) {
        const seen = new Set(containers.filter((c) => c.kind === "car").map((c) => `${c.x},${c.y}`));
        for (let i = 0; i < W * H && rects.length < n; i++) {
          const c = cells[i];
          if (!c.car || c.k !== "car" || c.car.i !== 0 || c.car.j !== 0 || c.f !== "road") continue;
          const x0 = i % W, y0 = (i / W) | 0, w = c.car.ax === "x" ? c.car.L : 2, h = c.car.ax === "x" ? 2 : c.car.L;
          if (seen.has(`${x0},${y0}`) || (onDeck && (x0 + w - 1 < road.deck.c0 || x0 > road.deck.c1))) continue;
          seen.add(`${x0},${y0}`);
          rects.push({ x0, y0, w, h });
          containers.push({ id: cid++, x: x0, y: y0, w, h, area: area.id, kind: "car", searched: false, label: `${def.name}: ${onDeck ? "car on the bridge" : "car"}` });
        }
      }
      if (!rects.length) continue;
      const xs = rects.flatMap((q) => [q.x0, q.x0 + q.w - 1]);
      Object.assign(area, { x0: Math.min(...xs) - 1, y0: road.rows[0], w: Math.max(...xs) - Math.min(...xs) + 3, h: road.rows.length, outdoor: true, onRoad: true, bridge: !!onDeck });
      areas.push(area);
      continue;
    }
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
        let rect = null;
        if (kind === "car") { rect = placeCar(cells, W, H, x, y, rng.chance(0.5) ? "x" : "y", rng.pick(CAR_LEN.car), "car", free, rng.int(0, 1e6)); if (!rect) continue; } // a wrecked car is 2 × 3–4 cells
        else put(x, y, kind === "pump" ? "pump" : "crate");
        containers.push({ id: cid++, x, y, ...(rect ? { w: rect.w, h: rect.h } : {}), area: area.id, kind, searched: false, label: `${def.name}: ${kind === "car" ? "car" : kind === "pump" ? "fuel pump" : "crate"}` });
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
      // A closed door, not a gap in the wall (as a building's map: buildingmaps.js); its kind (DOOR_KINDS): the first the
      // front door, the second a screen or a glass door half the time (hit points by the kind).
      doors.forEach(([x, y], i) => { put(x, y, "idoor", "floor"); const c = at(x, y), kr = hash01(rng.state, "sdkind", x, y); c.dk = !i ? "front" : kr < 0.3 ? "screen" : kr < 0.5 ? "glass" : "front"; c.hp = c.mhp = DOOR_KINDS[c.dk].hp; });
      edge.slice(2, 2 + rng.int(1, 2)).forEach(([x, y]) => { put(x, y, "window"); at(x, y).win = rollWin(rng.state, winMixOf(type === "house" || type === "farmhouse" || type === "cabin" ? "house" : "shop"), x, y); }); // windows.js: the state mix by the building
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
  const scatter = (k, n) => {
    if (k === "car" || k === "truck") { scatterCars(rng, cells, W, H, Math.max(1, Math.round((n * W * H) / (28 * 18) / 2)), free, k); return; } // 2 × 3–4 cells each (placeCar): half as many
    for (let i = 0; i < Math.round((n * W * H) / (28 * 18)); i++) { const x = rng.int(1, W - 2), y = rng.int(0, H - 1); if (free(x, y)) put(x, y, k); }
  };
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
  const start = (() => { for (let y = entry.y0; y < entry.y0 + entry.h; y++) for (let x = entry.x0; x < entry.x0 + entry.w; x++) if (cells[idx(x, y)].k === "open") return [x, y]; return [entry.x0 + 1, entry.y0 + 1]; })(); // an open cell of the zone (beside the vehicle)
  const carve = (x0, y0, x1, y1) => {
    let x = x0, y = y0;
    const step = () => { const c = at(x, y); if (c && !CELL[c.k].walk && c.k !== "vehicle" && c.k !== "water" && c.k !== "rail" && !c.car) { c.k = "open"; if (c.f === "floor") c.f = "floor"; } }; // never through the river, a bridge's railing or a car (half a car is no car)
    while (x !== x1) { x += Math.sign(x1 - x); step(); }
    while (y !== y1) { y += Math.sign(y1 - y); step(); }
  };
  let reach = flood(cells, start[0], start[1]);
  const reachableNear = (c) => boxRing({ w: W, h: H }, c).some(([x, y]) => reach[idx(x, y)]);
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
  return { cells, reach, areas, containers: kept, zones, vehicle };
}

// Another way in picked before the raid (raidplan.js setEntry): the map as it was made, its zone on that side made the
// entry (zones[0]: the team starts there) and the team's vehicle moved to it (the building's exits' zones renumbered).
// Returns true when it moved.
export function entryFrom(map, side, withVehicle) {
  const i = side ? map.zones.findIndex((z) => z.side === side) : -1;
  if (i <= 0) return false;
  const cells = map.cells, w = map.w || W, h = map.h || H;
  const old = map.zones[0];
  if (map.vehicle) {
    const v = map.vehicle;
    removeCar(cells, w, { x0: v.x, y0: v.y, w: v.w, h: v.h });
  } else for (let y = old.y0; y < old.y0 + old.h; y++) for (let x = old.x0; x < old.x0 + old.w; x++) if (cells[y * w + x] && cells[y * w + x].k === "vehicle") cells[y * w + x].k = "open";
  map.zones.unshift(map.zones.splice(i, 1)[0]);
  for (const ex of [...(map.exits || []), ...((map.plan && map.plan.exits) || [])]) if (ex.zone >= 0) ex.zone = ex.zone === i ? 0 : ex.zone < i ? ex.zone + 1 : ex.zone;
  for (const z of map.zones) z.vehicle = false;
  map.vehicle = null;
  if (withVehicle) {
    const z = map.zones[0];
    z.vehicle = true;
    map.vehicle = placeVehicle(cells, w, h, z, withVehicle, (x, y) => x >= 0 && y >= 0 && x < w && y < h && cells[y * w + x].k === "open");
    if (!map.vehicle) { const c = cells[(z.y0 + 1) * w + z.x0 + 1]; c.k = "vehicle"; c.f = "road"; }
  }
  return true;
}

export function createRaid(state, setup) {
  const rng = state.rng;
  const rs = rng.state; // raidplan.js: the dice the map is made from (the same map again from another side)
  const entrySide = setup.plan && typeof setup.plan === "object" ? setup.plan.side : null; // raidplan.js: the side the team comes in from
  const tileId = tileIdOf(setup);
  const tile = state.tiles[tileId];
  const party = state.parties.find((x) => x.id === setup.partyId);
  if (party) settleParty(state, party); // ammo.js: rounds by calibre in the pools
  const pv = party && party.vehicle ? partyVehicle(state, party) : null;
  const withVehicle = party && party.vehicle ? vehicleBody(party, pv) : false; // what stands in the entry zone (placeVehicle)
  // A building's own map (buildingmaps.js): a single-building site, or the building picked at a site with several;
  // else the street map as before (at a site with several, the panel offers the buildings first: R.choose).
  const pick = raidBuilding(state, tile, setup);
  const poiI = setup.raid && setup.raid.poi != null ? setup.raid.poi : null; // a raid on a point of interest (pois.js, poiraid.js)
  let map;
  if (pick) {
    map = buildingMap(state, tileId, pick, withVehicle);
    entryFrom(map, entrySide, withVehicle);
    W = map.w; H = map.h;
    const z = map.zones[0];
    // Flooded from beside the vehicle (a zone at the west end of a street of houses has it across x0 + 1: the first open cell of the zone then).
    let from = [z.x0 + 1, z.y0 + (withVehicle ? 0 : 1)];
    if (!CELL[map.cells[from[1] * W + from[0]].k].walk) {
      const open = [];
      for (let y = z.y0; y < z.y0 + z.h; y++) for (let x = z.x0; x < z.x0 + z.w; x++) if (map.cells[y * W + x].k === "open") open.push([x, y]);
      if (open.length) from = open[0];
    }
    map.reach = flood(map.cells, from[0], from[1]);
    map.areas = map.rooms;
  } else {
    [W, H] = raidDims(tile); // the street map: by the site (battlesize.js: a city center Large, a campground Medium)
    // setup.raid.areas: a street map with these areas (citycrawl.js street events: a crashed ambulance, a checkpoint).
    // A point of interest's street map (pois.js) is built from dice of its own (poicont.js poiMapRng), so it is the
    // same map with the same containers every visit; Army trucks that come and go are laid last there.
    const mrng = poiI != null ? poiMapRng(state, tileId, poiI) : rng;
    const types = setup.raid && setup.raid.areas ? setup.raid.areas.slice() : raidAreaTypes(mrng, raidAreasFor(tile, setup.raid && setup.raid.kind), W, H); // more rooms and areas on a bigger map (setup.raid.kind: a point of interest's, pois.js)
    if (tile && tile.road && !types.includes("roadcars")) types.push("roadcars"); // a site on a road: the cars left on the road outside it too (AREAS.roadcars)
    const trucks = trucksAt(state, tileId); // miltrucks.js: Army trucks here (a road, a convoy, a base's motor pool, an army wreck)
    if (trucks.length && !types.includes("miltrucks")) { if (poiI != null) types.push("miltrucks"); else types.unshift("miltrucks"); } // first: they want the room (a POI's map: last)
    map = genRaidMap(mrng, tile, types, withVehicle, { trucks });
    if (entryFrom(map, entrySide, withVehicle)) { const z = map.zones[0]; map.reach = flood(map.cells, z.x0 + 1, z.y0 + 1); }
  }
  const b = {
    setup, tileId: party ? partyTile(party) : tileId, w: W, h: H, cells: map.cells, reach: map.reach,
    place: placeName(tile),
    units: [], turn: 1, phase: "player", log: [], fx: [], fxSeq: 0, rev: 1, nextId: 1000, vehicle: map.vehicle || null, // the team's car or truck (placeVehicle, driveTo)
    pools: party ? [party.supplies, party.cargo ? party.cargo.supplies : {}] : [{}],
    ammoUsed: 0, arrowsUsed: 0, medsUsed: 0, noise: 0, reinf: 0, infection: tile ? tile.infection || 0 : 0,
    evacCols: 0, over: false, result: null, acted: true, queue: [],
    losCache: makeLosCache(W, H), rng,
    raid: {
      areas: map.areas, containers: map.containers, zones: map.zones,
      hasVehicle: !!withVehicle, vehicleZone: map.zones.findIndex((z) => z.vehicle), heat: setup.raid?.heat0 || 0, stage: 0, spawned: 0, spawnCap: Math.round(RAID_SIZE.SPAWN_CAP * raidDeadScale(W, H)), // vehicleZone: the zone the vehicle touches now (syncVehicleZone), -1 when driven off
      // Hardcore (hardcore-loot.js): sites hold about twice a normal start's loot, so the cap is higher there.
      // A point of interest's containers hold what they held untouched (pois.js poiFull: how picked over it is shows
      // as containers already ransacked, poicont.js), else the site's loot.
      found: {}, foundGear: [], richness: Math.max(0.35, Math.min(isHardcore(state) ? 2 : 1.2, (tile ? (poiI != null ? poiFull(tile, poiI) : tile.loot) : 0.5) * 1.3)),
      // A point of interest's dice key (poicont.js): its containers' contents (boxRng), its locks (locks.js) are the
      // same on every visit. Unset for any other raid (their dice as before).
      poiDice: poiI != null ? `poi${poiI}:${pick ? pick.id : "street"}` : undefined,
      reward: rewardMult(tile), // buildingmaps.js: risk pays (city blocks most, the countryside least)
      // A building's map: which one, its plan (rooms, exits: wanderers.js reads it), its locked doors (locks.js).
      interior: pick ? { id: pick.id, key: pick.key, name: pick.name } : null, plan: pick ? map.plan : null,
      doors: pick ? map.lockedDoors.map((d, i) => ({ id: i + 1, x: d.x, y: d.y, f: d.f || 0, area: d.area, exit: !!d.exit, botSkip: !!d.exit, lock: { kind: d.kind, open: false, tries: 0, ...(d.dk ? { dk: d.dk } : {}) } })) : undefined, // dk: the door's kind (locks.js openOdds)
      // Several buildings here and the raid started from the State Map: the choice is offered until anyone acts.
      choose: !pick && setup.raid && setup.raid.choose && !setup.raid.building ? buildingOptions(tile) : null,
    },
  };
  // Storeys (buildingmaps.js): every floor its own grid of the same size, the ground floor active; the upper floors'
  // reach floods from the first stairwell (a street of houses: from every one). b.cells / b.reach / b.losCache alias
  // the active floor's (setFloor).
  if (pick && map.floors && map.floors.length > 1) {
    // Each house's upper floor on a street is its own, void between them.
    const upReach = (F) => { const r = new Uint8Array(W * H); for (const [sx, sy] of map.stairs) if (CELL[F.cells[sy * W + sx].k].walk && !r[sy * W + sx]) { const f = flood(F.cells, sx, sy); for (let j = 0; j < r.length; j++) r[j] |= f[j]; } return r; };
    b.floors = map.floors.map((F, i) => ({ cells: F.cells, reach: i === 0 ? map.reach : map.street ? upReach(F) : flood(F.cells, map.stairs[0][0], map.stairs[0][1]), losCache: i === 0 ? b.losCache : null, name: F.name }));
    b.floor = 0;
    b.raid.storeys = map.floors.length;
    b.raid.stairs = map.stairs.map((s) => s.slice());
  } else if (pick) { b.raid.storeys = 1; b.raid.stairs = []; }
  if (b.vehicle) { b.vehicle.seats = SEATS[b.vehicle.kind === "bike" ? "bike" : (pv && pv.type) || "sedan"] ?? 4; fitMapVehicle(b, pv); } // who can ride in it (boardVehicle); its upgrades
  b.reinfMax = 0;
  b.zmix = armoredOf(((setup.enemy.groups || []).find((g) => g.kind === "zombies") || setup.enemy).mix); // the dead drawn in by the Heat
  const occupied = (x, y) => !!unitAt(b, x, y);
  const ok = (x, y) => inside(x, y) && b.reach[idx(x, y)] && cellAt(b, x, y).walk && !occupied(x, y);
  const okIn = (occ, x, y) => b.reach[idx(x, y)] && cellAt(b, x, y).walk && !occ[idx(x, y)]; // ok over the whole map: the cells taken worked out once a scan (occupancy)
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
    if (!setup.drill) fillBattleUnit(b, u, s); // mags.js: the gun and the spares loaded physically
  }
  for (const u of b.units) if (u.side === "player") u.fit = { aim: u.aim, dmgMult: u.dmgMult, armor: u.armor, medicine: u.medicine }; // refitUnit
  battlePerks(state, b); // skills.js: perks on the player's units
  fitHands(state, b); // carry.js: a bag carried in the arms (the team's supplies start set down in a raid)
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
        const cells = [], occ = occupancy(b, W, H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (okIn(occ, x, y) && dist(x, y, center[0], center[1]) >= 8 && zoneAt(b, x, y) < 0) cells.push([x, y]);
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
        const cells = [], occ = occupancy(b, W, H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (okIn(occ, x, y) && dist(x, y, hx, hy) <= 5 && dist(x, y, center[0], center[1]) >= 9) cells.push([x, y]);
        const c = rng.pick(cells);
        if (!c) continue;
        u.x = c[0]; u.y = c[1]; u.aware = false; u.pod = pod; u.home = [hx, hy];
        if (g.factionId != null) u.factionId = g.factionId; // prisoners.js: whose people they are
        if (u.factionId != null) armFromArsenal(state, b, u, hn); // arsenal.js
        if (g.side === "neutral" || g.side === "military") thirdSideUnit(b, u, g, i); // thirdside.js: survivors hiding here, a squad clearing it
        b.units.push(u);
      }
      pod++;
    }
  }
  truckCrews(state, b); // miltrucks.js: the turned crews standing round the Army trucks
  placeBodies(b, state.seed); // sleepers.js: bodies lie about, Sleepers among them
  placeWalking(state, b); // carriers.js: the walking dead that drifted near this tile, among the ordinary dead
  stealthSetup(state, b); // stealth.js: night, flashlights, suppressors, which way the guards face
  indoorSetup(b); // indoorlight.js: which rooms are dark (a barn, a storeroom; every room at night), their light switches
  nlSetup(state, b); // nonlethal.js: tasers and spray on both sides
  b.enemyStart = b.units.filter((u) => u.side === "enemy").length;
  lockRaid(state, b); // locks.js: locked containers and a locked room
  poiRaidStart(state, b); // poicont.js: a point of interest's containers as its ledger keeps them (ransacked, as you left them, fresh)
  if (pick) {
    const rooms = map.areas.filter((a) => !a.outdoor).length;
    const st = b.raid.storeys > 1 ? ` on ${b.raid.storeys} storeys (the stairs are marked; Go up / Go down takes an action)` : "";
    if (map.street) say(b, `You reach the street at ${b.place}: ${map.plan.houses.length} houses. ${map.containers.length} places to search in ${rooms} rooms${st}.`, "info"); // buildingmaps.js streetMap: a neighbourhood
    else say(b, `You reach the ${pick.name.toLowerCase()} at ${b.place}. ${map.containers.length} places to search in ${rooms} rooms${st}.`, "info");
    say(b, interiorIntro(b), "info");
  } else say(b, `You slip into ${b.place}. ${map.containers.length} places to search across ${map.areas.length} areas.`, "info");
  if (b.raid.choose) say(b, `Several buildings stand here: pick one to explore from the panel (${b.raid.choose.filter((o) => o.id !== "street").map((o) => o.name).join(", ")}), or search the street.`, "good");
  say(b, "Search next to a container (S). Heat rises every turn and with gunfire; more of the dead arrive as it climbs. Reach a green zone and Extract (X).", "info");
  if (withVehicle) say(b, "Your vehicle waits in the entry zone. Extract there to keep it; leave from another zone and it stays behind.", "info");
  stageAtStart(state, b); // carry.js: the loads into the vehicle, the rest set down in the entry zone
  planStart(state, b, rs); // raidplan.js: before going in, the side, a scout, the night
  placeMapCarts(state, b); cartHelpStart(state, b); // carts.js: carts standing in the barns and garages; two on a hand cart
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
  armsDropsEnd(state, b, "victory"); // carry.js: the loads set down on the street map back to the team first
  state.combat = createRaid(state, setup);
  return "";
}

// Unaware enemies wander: guards walk a beat around their building, the dead shuffle.
function patrol(b, u) {
  const rng = b.rng;
  // floorfolk.js: the nest's dead keep still around their knot; a raider watcher stands his post by the stairwell (both still notice you).
  if (u.nesting || u.watcher) { glance(b, u); notice(b, u); if (!u.aware && u.kind === "human") spotBodies(b, u); u.ap = 0; return; }
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
  else glance(b, u); // vision.js: standing about, they look another way now and then
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
    if (lightSpotted(b, e, p)) { alertPod(b, e.pod, `${e.name} sees ${p.name}'s light!`); return; } // a light at night, from far off
  }
}

// Noise wakes everything within earshot (raids, and suppressed shots in ordinary battles; else everyone wakes).
// src: who made it (crossfire.js: one of theirs while you are still unseen draws the unaware to the spot, nobody wakes).
export function alertNear(b, x, y, radius, why, src = null) {
  bindDims(b);
  if (src && crossDraw(b, x, y, radius, src, why)) return;
  const near = b.units.filter((u) => u.side === "enemy" && !u.aware && active(u) && dist(u.x, u.y, x, y) <= radius);
  if (!near.length && !b.floors) return;
  const pods = new Set(near.map((u) => u.pod));
  for (const u of b.units) if (u.side === "enemy" && !u.aware && active(u) && pods.has(u.pod)) { u.aware = true; if (b.phase === "player") u.surprised = true; wakeLights(b, [u]); } // ailights.js: flashlights on
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

// ---------- Army trucks' crews (miltrucks.js) ----------
// The turned crew round each truck on a raid map: MILTRUCK.AROUND dead soldiers standing near it, unaware. An
// unopened truck of a convoy nobody has stripped has its guard too (CONVOY_GUARD.PER_TRUCK more), and the line of
// trucks starts the raid hotter (HEAT_PRESENT a truck: miltrucks.js guardedTrucks).
function truckCrews(state, b) {
  const R = b.raid;
  if (!R) return;
  const rng = b.rng;
  const power = 2 + b.infection * 3;
  const guarded = guardedTrucks(state, b.tileId).length;
  if (guarded) R.heat = Math.min(100, R.heat + guarded * CONVOY_GUARD.HEAT_PRESENT);
  for (const a of R.areas) {
    for (const t of a.trucks || []) {
      if (!t.crew && !t.guard && !t.convoy && !rng.chance(0.5)) continue; // an opened truck: now and then one still about it
      const n = rng.int(MILTRUCK.AROUND[0], MILTRUCK.AROUND[1]) + (t.guard ? MILTRUCK.GUARD : 0) + (t.convoy && guarded ? rng.int(CONVOY_GUARD.PER_TRUCK[0], CONVOY_GUARD.PER_TRUCK[1]) : 0); // a motor pool's ready vehicles are guarded, and a convoy's trucks
      const cells = [];
      for (let y = t.y - 3; y <= t.y + t.h + 2; y++) for (let x = t.x - 3; x <= t.x + t.w + 2; x++) if (inside(x, y) && b.reach[idx(x, y)] && cellAt(b, x, y).walk && !unitAt(b, x, y) && zoneAt(b, x, y) < 0) cells.push([x, y]);
      rng.shuffle(cells);
      for (let i = 0; i < n && i < cells.length; i++) {
        const z = enemyUnit(b, rng, "zombies", power, b.units.filter((o) => o.kind === "zombie").length + 1);
        applyZType(z, "soldier", false, power);
        z.x = cells[i][0]; z.y = cells[i][1]; z.aware = false; z.home = [z.x, z.y];
        b.units.push(z);
      }
    }
  }
}
// The cargo bed is opened: the crew still strapped in the cab tear free (box.crew dead soldiers next to the truck,
// aware), and the noise carries (Heat +RISE_HEAT, everything within RISE_RADIUS turns toward it).
function truckCrewRises(state, b, u, box) {
  const n = box.crew || 0;
  box.crew = 0;
  if (!n) return;
  const rng = b.rng;
  const power = 2 + b.infection * 3;
  const ring = boxRing(b, box).filter(([x, y]) => b.reach[idx(x, y)] && cellAt(b, x, y).walk && !unitAt(b, x, y)).sort((p, q) => dist(q[0], q[1], u.x, u.y) - dist(p[0], p[1], u.x, u.y)); // the cab's side, away from the searcher first
  let made = 0;
  for (let i = 0; i < n && i < ring.length; i++) {
    const z = enemyUnit(b, rng, "zombies", power, b.units.filter((o) => o.kind === "zombie").length + 1);
    applyZType(z, "soldier", false, power);
    z.x = ring[i][0]; z.y = ring[i][1]; z.aware = true; z.home = [z.x, z.y];
    b.units.push(z);
    made++;
  }
  if (b.raid) b.raid.heat = Math.min(100, b.raid.heat + MILTRUCK.RISE_HEAT);
  b.noise = (b.noise || 0) + 1;
  if (made) say(b, `Something thrashes in the cab of the ${box.label.split(":")[0].toLowerCase()}: ${made === 1 ? "a dead soldier tears" : `${made} dead soldiers tear`} free of the seat belts and come${made === 1 ? "s" : ""} for ${u.name}! (Heat +${MILTRUCK.RISE_HEAT})`, "danger");
  alertNear(b, box.x, box.y, MILTRUCK.RISE_RADIUS, "The banging in the cab carries.");
}

// open: the player looks inside (the search window does the taking); else what fits is taken at once (bots, tests).
// quick: a rummage (search.js): part of what is inside shows, the rest stays hidden, and it is heard.
// A point of interest's container (R.poiDice, poicont.js) rolls its contents from dice of its own (boxRng: the seed,
// the tile, the POI, the map, the container), with its salts and its locks' dice keyed by it too, so it holds the
// same things on any visit; the place's kind is the POI's. Every other container rolls as before.
export function searchBox(state, b, u, box, open = false, quick = false) {
  const rng = state.rng;
  const R = b.raid;
  const pd = R.poiDice && box.kind !== "body" && !box.truck ? R.poiDice : null;
  const drng = pd ? boxRng(state, b.tileId, pd, box.id) : rng; // the contents' dice
  const bid = pd ? `${pd}#${box.id}` : box.id; // the salt of the finds' own dice
  const poiKind = pd && b.setup && b.setup.raid ? b.setup.raid.kind || null : null;
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
      const f = deadBodyFinds(rng, box.ztype, box.plateDur ?? null); // a dead soldier's plates as worn as they were shot (deadsoldiers.js)
      Object.assign(sup, f.sup);
      gear.push(...f.gear);
      if (box.ztype === "spitter") { // the burst acid sac is still dripping
        const eff = Math.round(damage(b, u, rng.int(4, 8), null));
        say(b, `${u.name} gets acid on their hands from the burst sac (${eff}).`, "danger");
      }
    } else if (box.kind === "body") {
      Object.assign(sup, bodyRounds(unitById(b, box.uid) || { weapon: box.weapon, kit: box.kit, id: box.uid }, rng.int(3, 10))); // ammo.js: their gun's calibre and load
      if (rng.chance(0.25)) sup.food = rng.int(1, 3);
      if (rng.chance(MEDS.BODY_HUMAN)) sup.meds = 1; // medfinds.js
      const kit = KITS[box.kit] || KITS.raiders;
      if (rng.chance(0.3)) {
        const key = rng.chance(0.5) && GEAR[box.weapon] ? box.weapon : swapGun(bodyGunSource(box.kit), rng.pick(kit.loot), rng); // gundist.js: a spare gun of their kind
        const it = lootItem(key, kitSource(box.kit), spend(rng)); // itemcond.js: a soldier's rifle looked after, a raider's not
        if (key === box.weapon && box.uid != null) { carryMods(unitById(b, box.uid), it); enemyGunLoaded(unitById(b, box.uid), it); } // gunmods.js: their gun's attachments come with it; gunload.js: the rounds left in it
        gear.push(it);
      }
      if (kit.finds && rng.chance(BODY_FINDS)) gear.push(lootItem(rng.pick(kit.finds), kitSource(box.kit), rng)); // what was in their pockets
      gear.push(...carriedThrowables(box.uid != null ? unitById(b, box.uid) : null, kitSource(box.kit))); // inventory.js: a flashbang they never threw
      const bu = box.uid != null ? unitById(b, box.uid) : null;
      if (bu) { const L = launcherLoot(bu, kitSource(box.kit)); gear.push(...L.gear); for (const [k, n] of Object.entries(L.sup)) sup[k] = (sup[k] || 0) + n; blastLoot(b, bu, { gear, sup }); } // launchers.js: their launcher, its rounds; a blast's wear
    } else if (box.truck) {
      // An Army truck's cargo bed (miltrucks.js truckLoot: its own dice, the same truck holds the same things); the
      // tile remembers it was opened. The crew strapped in the cab rise at the noise.
      const x = box.truck;
      const got = truckLoot(truckRng(state, x), x.kind, x.cond, { rich: x.rich, src: x.src });
      Object.assign(sup, got.sup);
      gear.push(...got.gear);
      const guarded = x.src === "convoy" && guardedTrucks(state, b.tileId).some((y) => y.i === x.i); // before it is marked opened
      markOpened(state, x);
      truckCrewRises(state, b, u, box);
      if (guarded && b.raid) { // a convoy truck forced open: the whole line of the dead hears it (miltrucks.js CONVOY_GUARD)
        b.raid.heat = Math.min(100, b.raid.heat + CONVOY_GUARD.HEAT_OPEN);
        say(b, `The tailgate bangs down the line of trucks (Heat +${CONVOY_GUARD.HEAT_OPEN}).`, "danger");
      }
    } else {
      const def = AREAS[R.areas[box.area].type];
      const site = poiKind || (state.tiles[b.tileId] && state.tiles[b.tileId].loc ? state.tiles[b.tileId].loc.type : null);
      const src = areaSource(R.areas[box.area].type, site); // itemcond.js: a house's things used, a shop's picked over, a wreck's scorched
      const gunSite = (b.setup && b.setup.raid && b.setup.raid.gunSite) || site; // gundist.js: the building a city crawl's map is (a police station, an Army checkpoint), else the site
      for (const [k, [p, lo, hi]] of Object.entries(def.loot)) {
        if (!drng.chance(Math.min(0.95, p * (0.6 + 0.4 * rich) * (1 + scav / 40)))) continue;
        sup[k] = Math.max(1, Math.round(drng.int(lo, hi) * (0.6 + 0.5 * rich) * (1 + scav / 25) * reward));
      }
      splitParts(state, sup, R.areas[box.area].type, `box${bid}`); // loot.js: parts by kind (a garage's are car parts; their own dice)
      if (R.deep) deepShift(sup, R.deep); // deeploot.js: a city crawl's deeper blocks hold what is dear by the kilo
      for (const [key, p] of def.gear) if (drng.chance(p * (0.5 + rich) * (1 + scav / 30) * reward)) gear.push(foundFill(lootItem(swapGun(areaSourceName(R.areas[box.area].type, gunSite), key, drng), src, drng), b.tileId, bid, key)); // gundist.js: which gun, by the room's draws; gunrounds.js: a few rounds in a gun now and then (its own dice)
      const small = rollAreaFind(drng, R.areas[box.area].type, rich, scav, site); // loot.js: valuables, comforts, throwables
      if (small) gear.push(small);
      // A book on the shelves (skills.js; its own dice, so nothing else in the raid changes).
      const book = rollBook(state, b.tileId, 0.5 * (u.scavBonus ? 2 : 1), `box${bid}`, pd ? { hour: pd, loot: R.richness / 1.3, kind: poiKind } : undefined);
      if (book) gear.push(book);
      // A gun attachment in an armoury, a gun shop, barracks (loot.js AREA_GUNMODS; its own dice too).
      const part = rollAreaGunmod(state, b.tileId, R.areas[box.area].type, `box${bid}`);
      if (part) gear.push(part);
      const rel = rollAreaReload(state, b.tileId, R.areas[box.area].type, `box${bid}`); // brass, powder, primers in a gun shop, an armoury (loot.js AREA_RELOAD; its own dice)
      if (rel) gear.push(rel);
      // A crate of flashbangs or smoke grenades in an armoury, a few in barracks lockers (loot.js AREA_GRENADES; its own dice too).
      gear.push(...rollAreaGrenades(state, b.tileId, R.areas[box.area].type, site, `box${bid}`));
      // A grenade launcher, a rocket tube, a crate of 40 mm in army stock (loot.js AREA_LAUNCHERS; its own dice too).
      gear.push(...rollAreaLaunchers(state, b.tileId, R.areas[box.area].type, site, `box${bid}`));
      // One of the newer guns (gunfinds.js GUN_FINDS.area; its own dice too).
      gear.push(...rollAreaGuns(state, b.tileId, R.areas[box.area].type, gunSite, `box${bid}`));
      // Firewood: a log basket, a shed's kindling, a broken chair (loot.js AREA_WOOD; its own dice too).
      const wood = rollAreaWood(state, b.tileId, R.areas[box.area].type, box.kind, `box${bid}`);
      if (wood > 0) sup.wood = (sup.wood || 0) + wood;
      // Arrows: a quiver in a cabin's locker, bolts on a shop shelf (loot.js AREA_ARROWS; its own dice too).
      const arrows = rollAreaArrows(state, b.tileId, R.areas[box.area].type, box.kind, `box${bid}`);
      if (arrows > 0) sup.arrows = (sup.arrows || 0) + arrows;
      if (def.alarm && box.kind === "car" && drng.chance(def.alarm) && !u.quiet) { // quiet: Quiet Hands never sets one off
        R.heat = Math.min(100, R.heat + 12);
        say(b, "A car alarm goes off! Heat jumps.", "danger");
        alertNear(b, box.x, box.y, 12, "The alarm wakes everything nearby.");
      }
    }
    if (box.kind === "body" && !box.zombie) gear.push(...unitMagItems(box.uid != null ? unitById(b, box.uid) : null, kitSource(box.kit))); // carrykit.js: their spare magazines
    else if (box.kind !== "body") withMags(gear, box.truck ? "military" : areaSource(R.areas[box.area] ? R.areas[box.area].type : "house", null), "box", b.tileId, bid); // carrykit.js: a gun found keeps 0-2 spare magazines (own dice)
    lockedLoot(state, b, u, box, sup, gear); // locks.js: more in locked things, keys, blueprints (its own dice)
    const site = poiKind || (state.tiles[b.tileId] && state.tiles[b.tileId].loc ? state.tiles[b.tileId].loc.type : null);
    const rTheme = box.kind === "body" ? "home" : box.truck ? "military" : raidTheme(site, box.area != null && R.areas[box.area] ? R.areas[box.area].type : "house");
    typeFind(state, sup, box.kind === "body" ? "raider" : box.kind === "zombie" ? "travel" : box.truck ? "military" : box.area != null && R && R.areas[box.area] ? AREA_MIX[R.areas[box.area].type] || "house" : "house", box.kind === "body" || box.kind === "zombie" ? null : b.tileId, pd ? drng : undefined); // foods.js: the food as the items a place like this holds (a site's shelves run down)
    sortFind(sup, rTheme, "box", b.tileId, bid); // ammo.js: what turns up there, by calibre
    if (box.kind !== "body") formFinds(sup, gear, rTheme, "box", b.tileId, bid); // ammo.js: some of it boxed (stacks of boxes), now and then a bulk ammo container; the rest loose
    box.contents = { sup, gear };
    blastBox(b, box); // launchers.js: a blast reached it before anyone looked inside
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
  settleVehicle(state, b); // everyone out of the vehicle; what ramming cost it
  b.phase = "over";
  MED.settleFoes(b, "raid"); // medics.js: the downed guards (tied ones can still be taken out as prisoners)
  const hurtIds = [], deadIds = [], extractedIds = [], carriedIds = [];
  const home = new Set(); // units who come home with what they carry (raidloot.js)
  const lines = [];
  // Someone walked out: the downed can be carried. A stabilized teammate lives; one still bleeding takes the
  // same chance as the downed in a lost battle. With nobody out, everyone still on the map is lost.
  const anyOut = b.units.some((u) => u.side === "player" && u.left && !u.dead);
  const zombies = b.setup.enemy.kind === "zombies";
  nlRaidEnd(state, b, anyOut); // nonlethal.js: the knocked out are carried out, or taken when nobody got out
  for (const u of b.units) {
    if (u.side !== "player" || u.nlTaken) continue;
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
  const hadVehicle = R.hasVehicle ?? R.vehicleZone >= 0;
  const vehicleKept = hadVehicle && b.units.some((u) => u.side === "player" && u.left && !u.dead && (u.exitVehicle ?? u.exitZone === R.vehicleZone)); // left from the zone the vehicle stood at
  endBodies(state, b, extractedIds.length ? "extracted" : "defeat", vehicleKept); // carriers.js: the risen still walking take their things into the walking loot; bodies in the car come home with it
  raidHome(state, b, home); // raidloot.js: what the ones who made it carry goes in the team's cargo; the rest is lost
  if (hadVehicle && extractedIds.length && !vehicleKept) lines.push("Nobody went back to the vehicle. It stays behind at the site.");
  const enemies = b.units.filter((u) => u.side === "enemy");
  const original = enemies.filter((u) => !u.reinforcement);
  const killed = original.filter((u) => u.dead).length;
  const outcome = extractedIds.length ? "extracted" : "defeat";
  const captives = battleCaptives(b, outcome); // stealth.js: tied prisoners dragged into a zone someone left from
  if (captives.length) lines.push(`${captives.map((u) => u.name).join(", ")} ${captives.length === 1 ? "was" : "were"} taken out tied up.`);
  wearFielded(state, b, killed > 0); // makeshift gear wears in a raid only if someone was killed; a med kit by its use
  // The arrows loosed in the raid: about half picked up on the way out when someone got out and nothing that knows
  // they are there is still standing (a cleared site); none when they had to run for it (world.js ARROWS.BACK).
  const cleared = !enemies.some((u) => activeAny(u) && u.aware);
  settleSpears(state, b, outcome === "extracted" && cleared, lines); // thrown spears: picked up on the way out of a cleared site, else lost
  const arrowsBackN = pickUpArrows(b, outcome === "extracted" && cleared);
  lines.push(...thrownBack(state, b, outcome === "extracted" && cleared)); // stealth.js: the empty magazines thrown as lures
  lines.push(...pickUpBrass(state, b, outcome === "extracted" && cleared)); // reloading.js: brass, as the arrows
  if (b.arrowsUsed) lines.push(arrowsBackN ? `Picked up ${arrowsBackN} of the ${b.arrowsUsed} arrow${b.arrowsUsed === 1 ? "" : "s"} shot.` : `The ${b.arrowsUsed} arrow${b.arrowsUsed === 1 ? "" : "s"} shot ${b.arrowsUsed === 1 ? "is" : "are"} lost.`);
  b.result = {
    knockedOut: captives.length, prisoners: captiveRecords(state, b, captives), // prisoners.js
    outcome, enemiesKilled: killed, enemiesLeft: original.length - killed - captives.length,
    survivorsHurt: hurtIds, survivorsDead: deadIds, ammoUsed: b.ammoUsed, arrowsUsed: b.arrowsUsed || 0, arrowsBack: arrowsBackN,
    loot: { supplies: { ...R.found }, gear: R.foundGear.slice() },
    turns: b.turn, medsUsed: b.medsUsed, extraKilled: enemies.filter((u) => u.reinforcement && u.dead).length,
    tactical: true, worn: true,
    third: thirdResult(b), // thirdside.js: the survivors or soldiers who were there (null: none)
    raid: {
      extractedIds, carriedIds, vehicleKept, hadVehicle, heat: Math.round(R.heat),
      searched: R.containers.filter((c) => c.searched && c.kind !== "body" && c.kind !== "ground").length, total: R.containers.filter((c) => c.kind !== "body" && c.kind !== "ground").length, // ground.js piles are not places to search
      hours: b.calledOff ? 0 : Math.max(1, Math.ceil(b.turn / 6)), // called off before going in (raidplan.js callOff): no time on the site
      alerted: original.some((u) => u.kind === "human" && (u.aware || u.dead)),
      calledOff: !!b.calledOff, // scavenge.js afterRaid: the team turned back
    },
  };
  b.summary = lines;
  raidLocksEnd(state, b); // locks.js: keys found go on the key ring
  say(b, b.calledOff ? "Called off. The team turns back." : outcome === "extracted" ? "You made it out." : "Nobody made it out.", b.calledOff ? "info" : outcome === "extracted" ? "good" : "death");
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
// Would a reload clear this double feed (a fresh magazine to put in)?
function botReloadClears(b, u) {
  const keep = magIn(u);
  loadMag(u, 0);
  const ok = !reloadRefusal(b, u);
  loadMag(u, keep);
  return ok;
}
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
  for (const u of b.units.filter((x) => x.side === "player" && x.vol == null)) { // volunteers act in volunteerTurn
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
    if (active(u)) aiLights(b, u, true); // ailights.js: the bot's lights on once the team is found, a dark room's switch
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
      // stealth.js: a flashbang into a room (or a knot) of two or more people who know the team is there, then the rest
      // of the turn (the stunned cannot watch the doorway).
      if (!leave && botFlash(state, b, u, true)) continue;
      if (!leave && u.gl && aiLaunch(b, u)) break; // launchers.js: HE or a rocket on three or more bunched up (the turn's attack)
      // Fight only what is close; otherwise keep moving (shooting raises Heat).
      const foes = foesOf(b, u).filter((f) => f.aware && canSee(b, u, f) && dist(u.x, u.y, f.x, f.y) <= (leave ? 1.5 : 4));
      // A jammed gun: cleared (gunfire.js: a double feed by a reload when it can, else Unjam), then on.
      if (u.jam && !combatAct(state, { type: u.jam.kind === "double" && botReloadClears(b, u) ? "reload" : "unjam", unit: u.id })) continue;
      // An empty gun: reloaded (1 action) when something is close or there is time (not on the way out), then on.
      if ((magEmpty(b, u) || (calOf(u.weapon) && !hasShot(b, WEAPONS[u.weapon], u))) && (foes.length || !leave)) { const rt = reloadType(b, u, foes); if (rt != null) { const am = rt === typeFor(calOf(u.weapon), u.load) ? null : rt; if (packShells(b, u, am) && !combatAct(state, { type: "getshells", unit: u.id, ammo: am })) continue; if (!combatAct(state, { type: "reload", unit: u.id, ammo: am })) continue; } } // ammo.js: another type when its own has run out; mags.js: a shotgun's shells all in the pack: a handful to hand first (1 action), not both actions on the pack
      const adj = foes.find((f) => inMelee(b, u, f)); // a spear reaches 2
      const shot = foes.length ? bestShot(b, u, foes) : null;
      const fair = shot && shot.o.chance >= 45;
      // Something next to them and no fair shot (no gun, nothing left to fire, a poor shooter): strike it, as the
      // field AI does (aiMelee), instead of standing in a doorway being chewed on with a dry or a shaky pistol.
      if (adj && !fair) { combatAct(state, { type: "melee", unit: u.id, target: adj.id }); break; }
      if (fair) { combatAct(state, { type: "shoot", unit: u.id, target: shot.t.id }); break; }
      if (MED.rescueStep(b, u)) { if (u.dragging != null && !leave) u.ap = 0; continue; } // medics.js: a downed teammate dragged to cover, stabilized, revived; a medic heals
      const fallen = medsLeft(b) > 0 ? b.units.find((o) => o.side === "player" && o.down && !o.stab && !o.dead && !o.left && adjacent(u, o)) : null;
      if (fallen) { combatAct(state, { type: "meds", unit: u.id, target: fallen.id }); continue; }
      if (u.hp < 50 && MED.spareMeds(b, u) >= 1 && u.ap > 0) { combatAct(state, { type: "meds", unit: u.id, target: u.id }); continue; }
      const lockAct = !leave ? autoLock(state, b, u) : null; // locks.js: key, picks or force, by the odds and the Heat
      if (lockAct && !combatAct(state, lockAct)) continue;
      // search.js: pressed for time (Heat up, an aware enemy close, on the way out), rummage through what is right
      // here (no action, loud, part of it), grab what is free to haul and move on; else search in full.
      const pressed = botPressed(b, u, leave);
      if (pressed && !full && !unload && u.quickTurn !== b.turn) {
        const q = quickable(searchableNear(b, u).filter(todo))[0];
        if (q) turnToBox(u, q); // vision.js: facing it (a free Face)
        if (q && !combatAct(state, { type: "search", unit: u.id, box: q.id, quick: true })) continue;
      }
      // Pressed: leave the rummaged ones for a calmer moment (a full search there costs the action it saved), unless
      // nothing else is left to go to.
      const skipQuick = pressed && R.containers.some((c) => todo(c) && here(c) && !c.quick);
      const nearBoxes = searchableNear(b, u).filter(todo).filter((c) => !skipQuick || !c.quick);
      if (!leave && !unload && nearBoxes.length && (nearBoxes[0].contents || u.ap >= searchCost(b, u))) {
        turnToBox(u, nearBoxes[0]); // vision.js: facing it (a free Face)
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
        for (const c of R.containers) if (todo(c) && here(c) && !(skipQuick && c.quick)) for (const [x, y] of boxRing(b, c)) if (cellAt(b, x, y).walk) targets.push([x, y]); // the ring round it (a car covers several cells)
        targets.push(...lockTargets(b)); // locks.js: the doors of a locked room (this floor's)
      }
      if (!targets.length) { u.ap = 0; break; }
      const field = distField(b, targets);
      const r = reachable(b, u, dashRange(u));
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

// medics.js: the internals it needs (the meds pool, a round out of the gun, the alarm, whom a unit fights, plain meds).
MED.setMedicHooks({ take, spendRounds, alertAll, foesOf, heal, fireRefusal, evacAt: (b, x, y) => evacAt(b, x, y) });
