// @ts-check
// The hive crawl: destroying a hive is not one battle at its mound but a crawl through it, chamber by chamber, from
// its mouth to the core room where the Hivemind sits, the organ that thinks for the hive. Kill the Hivemind and the
// hive dies (hives.js destroyHive). The mid-to-late game's content: a young hive is two chambers deep, a hive of the
// late game nine (DEPTH by hivetech.js hiveTier; a screamer spire grows it one deeper).
//
// The den (hive.den, made on first look from the world's seed and the hive: the same chambers every visit; regrown when
// the hive's tier deepens it) is a round grid, as the city crawl's (2026-10-13): rings of chambers in from the rim.
// 3 open, 1 wall (2026-10-13): every chamber is a T, a hallway through it and a room off the side, so it opens on 3 of
// its 4 sides; the wall between two chambers is the one wall of both, so the inner walls pair the chambers off (the
// hive's dice). A rim chamber's outside is its wall (where the rim steps, two sides outside: a bend, open on 2). Four
// entrances, one on each side of the den (north, east, south, west, at a spot along it by the hive's dice), each a
// rim chamber open to its own mouth outside the rim, the mouth's own brood in it: the team picks one going in and
// walks out by any of them. One chamber of the innermost rings is the core, and it opens on only 1 or 2 of its sides
// (a shut side is the wall of the chamber beside it). Every chamber has a kind (tunnels, galleries, nurseries, egg chambers, bone pits,
// worm pools, the roots of the hive's growths, collapses), a warmth from its distance to the core along the passages
// and a sound, the Hivemind's beat, from its distance through the walls: the beat says how near the core is, the
// warmth which way leads into it. Each passage carries a draft that says whether it leads warmer or colder (a team
// with poor Scouting misreads one now and then: the visit's own dice, hash01, never the world's) and the beat louder
// or fainter.
// The brood in a chamber grows with its depth (more of them, tougher, the special dead and the elite deeper; the
// chambers next to the core are the worst) and with the hive's guard horde (hives.js hiveGuard): the guard is the brood
// spread through the den, so each one killed inside takes its share of the guard (cutGuard), and a guard thinned by a
// war party's crawl means emptier chambers (nothing from outside the hive hurts it any more: no fires, no bombs). Cleared chambers stay clear for REFILL_DAYS (longer once its eggs are burned),
// then the brood flows back from the guard. The memory is the hive's (hive.denMem), so it is the same for your teams
// and the AI groups' war parties (groupHiveCrawl): the AI groups crawl the same den with the same depth, coarsely.
//
// The team's crawl is plain data on the team (p.hiveCrawl), saved and loaded mid-crawl like the city crawl's p.crawl:
//   { v, hiveId, tile, name, mouth (the one it came in by), at (the chamber), from, trail (the walk from that mouth,
//     loops cut: a record), visited, seen, slipped (crept past: met again walking back in), alert, enc (what is in
//     front of the team), headOut (the autopilot's: making for a mouth), kills, lost, log, tally, deepest, started }
// Leaving is a walk (2026-10-13): chamber by chamber to any of the four entrances and out through its mouth (its brood
// in the way if it is there); nothing walks the team out on its own. A cleared chamber walked back into may have
// filled again with the noise made in it (HCRAWL.HEAT refillPerHeat), so the way back stays dangerous.
// The hive's Alert (0–100) rises with noise (fights, fire, a failed sneak) and fades lying still; from CONVERGE the
// brood converges on the team (a swarm in the chamber, cleared chambers behind it filling again), from BLOCK the
// mouths pack up behind it.
//
// Hooks elsewhere (small): hives.js hiveCard (Enter the hive), parties.js arrive; conflicts.js engagedWith (the crawl
// holds the team); combat.js registerBossAI (the Hivemind's own turn and death), shotPri; defences.js BOSSES.hivemind;
// worm.js (one of the team turning inside); autopilot.js (hiveChoice, idleTeams: hiveCrawlAutoStep, the campaign's
// estimates: crawlEstimate); factions.js groupHiveWar (groupHiveCrawl); ui/hivecrawl.js (the window), ui/hivecrawlsfx.js
// (the pulse and the drone that grow with the warmth), ui/ui.js and main.js.
import { keyWord } from "./water.js"; // supplies as words: "9mm FMJ", "rounds"
import { Rng } from "./rng.js";
import { hash01, gainXpAll, USE } from "./skills.js";
import { SUPPLIES, GEAR, supWeight } from "./data.js";
import { log, hurt, tickHour, day, snapshot, survivorById } from "./world.js";
import { partyMembers, partyTile, bestSkill, awaitOrders, wipeParty, tileLabel, teamName, cargoRoom, unitsThatFit } from "./parties.js";
import { coversCell, nearCell, unitCells,
  registerCombatHandler, registerBattleLayout, registerBattleSize, registerBossAI, startCombat, autoResolveCombat, finishCombat, byNumbersOdds,
  say, fx, damage, enemyUnit, active, reachable, pathTo, moveAlong, los,
} from "./combat.js";
import { fightNow, bossUnit, placeUnitRight } from "./defences.js";
import { hiveById, hiveGuard, broodForce, destroyHive, molotovsOf } from "./hives.js";
import { hiveTier, hiveMods, markThreat, growthsOf, growthById, destroyGrowth, eraTier } from "./hivetech.js";
import { broodWiden } from "./deadpool.js"; // the era's kinds the hive does not breed, by the years
import { BOSS_NAMES, GROWTHS, ZTYPES, HIVE } from "./hiveconst.js";
import { applyZType } from "./zombietypes.js";
import { reduceHorde } from "./hordes.js";
import { partyFuel, useFuel } from "./vehicles.js";
import { hiveAllies, broodAfterAllies } from "./alliance.js";
import { lootItem, itemLoad } from "./inventory.js";
import { spend } from "./itemcond.js";
import { wormSearch } from "./worm.js";
import { tacticalStyleFor } from "./breakoff.js";
import { sortFind } from "./ammo.js";
import { nextTurnOf } from "./throwables.js";
import { settleParty, drawTeamShots } from "./ammo.js";
import { fightXp } from "./skills.js";
import { fieldTreatInfo, fieldTreat } from "./medical.js"; // tending the wounded in a quiet chamber
import { absorbOffscreen } from "./armour.js";
import { LIGHTS, lightOf } from "./lights.js"; // lights in the dark of the hive: the drafts, the cave battles
import { carriedSpots } from "./inventory.js"; // road flares carried (worn, pockets, rig pouches, the pack)
import { leaveCache } from "./caravanraids.js"; // the core's hoard: what the team cannot carry stays on the hive's tile
import { addToArsenal, addArsenalRounds, removeFromArsenal } from "./arsenal.js"; // AI parity: a war party's share of the hoard, its fire and bangs for the core
import { THROWABLES } from "./stealth.js"; // the throws' reach (the Hivemind's weak spots)
import { throwBlind } from "./throwables.js";
import { swapGun, drawGun } from "./gundist.js"; // the gun distribution: the bones' guns, the hoard's, the deep rooms' rare ones
import { HIVE_GUNS } from "./data-guns.js";
import { WEAPONS } from "./combat.js"; // the core's fire by the numbers (coreFire): a gun's best range, fall-off, magazine
import { combatPower, skill } from "./world.js";
import { INTERNAL } from "./data-kit.js";
import { spreadMult } from "./data-ammo.js";
import { SHELLS, usesInternal, MAGS } from "./mags.js";
import { gunMods } from "./gunmods.js";
import { calOf } from "./ammo.js";
import { cellsOf, ringOf, inGrid, headingToward, DIRS, DIR_NAMES } from "./citygrid.js"; // the den's round grid, as the city's
import { typeFor, keyFor, withHand } from "./rounds.js";
import { looseWant } from "./carrykit.js"; // the loose rounds a trip packs at hand
import { cfgOf } from "./worldcfg.js"; // the run's dials: Hive crawl shallowest / deepest

// ---------- tuning ----------
export const HCRAWL = {
  DEPTH: [2, 3, 5, 7, 9],       // rings from the den's rim to its heart, where the core lies (genDen), by hive tier 0–4
  SPIRE_DEPTH: 1,               // a screamer spire grown at the hive makes it one deeper
  // The round grid (genDen, 2026-10-13): rings × the depth rings from rim to heart, at least 2 (a young hive 3 chambers
  // across, the oldest 11: the shortest way in from the nearest of the four mouths about as long as `depth`, with the
  // core's walls to go round). Every chamber opens on 3 of its sides, the fourth its one wall (3 open, 1 wall: the
  // walls pair the chambers off by the hive's dice); the core opens on 2 of its sides at `doors` (by tier: a young
  // hive's always on 2), else on 1. tries: dice for the pairs before a cut-off chamber gets a wall knocked through.
  GRID: { rings: 0.65, doors: [1, 0.75, 0.5, 0.5, 0.5], tries: 12 },
  MOVE_HOURS: 1, TREAT_HOURS: 1, FIGHT_HOURS: 1, SNEAK_HOURS: 1, SEARCH_HOURS: 1, BURN_HOURS: 1, LIE_HOURS: 2, BACK_HOURS: 1,
  // The brood in a chamber: (base + perLayer × its layer) × its kind's share × the guard's scale (√(guard / guardRef),
  // within scale), between min and max; × nearCore next to the core. Their power: the hive's brood (hives.js
  // broodForce of the guard, eras.js broodGrowth in it) × (1 + powerPerLayer × layer) × the kind's.
  BROOD: { base: 3, perLayer: 0.9, min: 2, max: 14, powerPerLayer: 0.06, nearCore: 1.3, guardRef: 80, scale: [0.35, 1.8] },
  SPECIAL: { base: 0.08, perLayer: 0.06, max: 0.6 }, // the share of the special dead (the kinds its growths breed) by layer
  ELITE_FROM: 0.6,              // elite brood (a mutation vat) from this share of the depth; always next to the core from tier 3
  REFILL_DAYS: 14, EGG_REFILL: 2, // a cleared chamber fills again after this many days (× EGG_REFILL once its eggs burned)
  // The hive's Alert: start + per visit made lately; noise: move, a fight by the numbers, a fight on the map (+ the
  // shots fired / 20), fire, searching, a failed sneak; decay an hour; lie (lying still). From converge the brood comes
  // (swarm: the chance an hour at 100, rising from converge; refill: a cleared chamber behind you fills again); from
  // block every mouth packs up behind you.
  ALERT: { start: 10, visit: 6, move: 2, fight: 10, mapFight: 6, burn: 12, search: 3, sneakFail: 8, decay: 3, lie: 15, converge: 60, swarm: 0.3, refill: 0.25, block: 85,
    names: ["Dormant", "Stirring", "Restless", "Roused", "Swarming"] },
  // Brood activity (2026-10-13, as the city crawl's zombie activity, citycrawl.js CRAWL.THREAT): each chamber of a den
  // has its own level, 1-5, by the hive's dice (the same every visit; known once you stand in it). Its mult multiplies
  // the heat there (roomHeat: the hive's Alert and the chamber's own heat): the chance its brood has seen you, creeping
  // past them, a swarm pouring in, a patrol finding you lying still. A little noise in a seething chamber is worse than
  // a lot in a torpid one. Levels by weight.
  THREAT: { names: ["", "Torpid", "Stirring", "Active", "Teeming", "Seething"], mult: [0, 0.6, 0.8, 1, 1.35, 1.8], weights: [0, 0.2, 0.25, 0.25, 0.18, 0.12] },
  // A chamber's own heat (2026-10-13, as the city crawl's trail): the noise made in it (whatever raises the Alert there:
  // walking in, fights and shots, fire, searching, a failed sneak) stays in it, × (1 + perPerson for each of the team
  // over 3), × stealthy for a team travelling stealthily, at most 100; it fades decay an hour (as fast as the Alert),
  // and lying still in it cools it as it does the Alert. perPerson 0 and decay 3: the crawl harness's hive rows
  // (tools/crawlbalance.js) stay where they were (docs/crawl-balance.md); 0.15 and 1 made every row harder.
  // refillPerHeat (2026-10-13, the round-grid branch): walking back into a cleared chamber you made noise in (on the
  // way out, or round again; leaving is a walk now), it may have filled again: its heat × its activity ×
  // refillPerHeat, at most refillMax.
  HEAT: { perPerson: 0, stealthy: 0.6, decay: 3, refillPerHeat: 0.003, refillMax: 0.3 },
  // Creeping past a chamber's brood: best Stealth + d10 against dc + perLayer × layer + its heat × perAlert (+ big a
  // person over three, + spotted when they have seen you).
  SNEAK: { dc: 7, perLayer: 0.7, perAlert: 0.05, big: 1, spotted: 4 },
  BACK: { hurt: 0.15, perLayer: 0.03, dmg: [8, 20] }, // falling back from a chamber's brood: each person's risk and wound
  DRAFT: { miss: 0.4, perScout: 0.045, min: 0.03 }, // misreading a draft: miss − perScout × best Scouting, at least min
  BURN: { fuel: 3, molotovs: 1, res: 8, guard: 0.05, growth: 70, wake: 0.3 }, // burning eggs or a growth's root
  BONES: { items: [1, 3], ammo: [6, 20], meds: [0, 3], keys: ["pistol", "revolver", "shotgun", "huntrifle", "machete", "vest", "hikingpack", "bikehelmet", "knife", "ar", "hatchet", "plate", "bat"] },
  POOL_WORM: 2,                 // hours of the worm's exposure (worm.js wormSearch) wading through a worm pool; ×2 searching it
  CORE: { base: 6, perDepth: 0.3, min: 3, max: 14, powerPerDepth: 0.025 }, // the brood around the Hivemind (× the guard's scale; its power + powerPerDepth a chamber of depth)
  // A fight in the hive by the numbers (crawlByNumbers), fitted to the same fights played on the cave map by the AI on
  // both sides (6 fighters against 3–16 brood; the team's health lost ≈ k × (their strength / yours)^exp, at most cap;
  // lost: at least lost): the blows spread over the team as on the map (small fights rarely kill; the generic model
  // costs a life in a third of even the smallest fights).
  NUMBERS: { k: 135, exp: 1.9, cap: 340, lost: 260, ambush: 1.3, blow: [8, 30], shots: 3 },
  AUTO: { coreOdds: 0.75, hurt: 45, treat: 70, fit: 60, sureOdds: 0.8, fightOdds: 0.6, sneakOdds: 0.7, coreFit: 4, wear: 0.04, lie: 70 },
  // The AI groups' crawl (groupHiveCrawl), in the guard's units: the Hivemind and the Broodmother cost boss + bossTier ×
  // tier of a war party's strength on top of the brood on the way and in the core.
  GROUP: { boss: 6, bossTier: 6, depthDiv: 3, phase2: 2, light: 0.08, prep: 0.25, prepKit: 4, makeKit: 2, molotovFuel: 1 },
  // Lights (lights.js) in the hive. The team's lights on (c.lit, the default when anyone has one): the drafts out of the
  // chamber it stands in are read in the light (the misreading × draft), but the brood sees it (Alert + move a move,
  // creeping past + sneak to the roll's DC). On a cave map the dark is the hive's own (b.dark): someone without a light
  // sees dark tiles, with one their light's sight + lit (lights.js LIGHTS); by the numbers the brood counts numbers
  // more for the share of the team without a light.
  LIGHT: { draft: 0.5, move: 1, sneak: 1, numbers: 0.15, dark: 9, lit: 4 },
  // A road flare (data.js flare) thrown down a passage: the chamber beyond is lit for a moment, its kind and its brood
  // seen as they are and the draft from it read true; the brood sees the glare (Alert + alert). No time.
  FLARE: { alert: 5 },
  // Listening at a passage (hours): the best listener's (Scouting + Stealth) / 2 + d10 (the visit's own dice) against dc
  // + perLayer × the layer beyond. By exact or more: its kind and the brood exactly; by rough or more: its kind and
  // roughly how many; less: a guess (the kind may be wrong, the count off); by fumble or worse: Alert + alert and the
  // brood beyond is waiting (spotted). The autopilot listens with a listener of auto or better.
  LISTEN: { hours: 1, dc: 9, perLayer: 0.4, exact: 3, rough: 0, fumble: -4, alert: 6, auto: 5 },
  // The core's hoard (hiveHoard): what the hive took from the dead it dragged in, searched once the Hivemind is dead.
  // guns 1 + tier × perTier + stores / perRes; armour (base + tier × perTier + stores / perRes); a rare piece at
  // rare[0] + rare[1] a tier (two from tier 3); rounds, meds, gun parts and scrap by the tier and the stores; flares.
  // Each piece worn as the dead left it (itemcond.js: a survivor's kit, a soldier's now and then).
  HOARD: {
    guns: { base: 1, perTier: 0.8, perRes: 30 }, armour: { base: 0.5, perTier: 0.5, perRes: 60 }, rare: [0.15, 0.12],
    ammo: [20, 18, 0.8], meds: [2, 1.5, 1 / 12], gunparts: [0, 1], scrap: [3, 2], flares: [0, 0.5], soldier: 0.3,
    guns1: ["pistol", "revolver", "shotgun", "huntrifle", "leverrifle", "dbshotgun", "compact9", "pistol45"],
    guns2: ["carbine", "ar", "ak", "smg", "semishotgun", "huntrifle"], guns3: ["dmr", "lmg", "sniper", "ar", "ak"],
    armourKeys: ["vest", "plate", "tacvest", "milhelmet", "riothelmet", "highcut", "ceramicplate", "kneeguards", "riotarms"],
    rareKeys: ["nvg", "thermal", "milradio", "surgkit", "traumakit", "m79", "helmetlight", "commset"],
  },
};
// The Hivemind on the battle map (defences.js BOSSES.hivemind, its turn here): hp + perTier × the hive's tier; every
// turn a pulse within pulse tiles (pulseDmg, stun: the chance to cost the next turn an action) and a lash at someone
// next to it; every spawnEvery turns spawn of the brood from the walls near it, at most cap + capTier × tier in all.
// power: what it counts for by the numbers (with the Broodmother's broodPower).
// numbersK: the bosses' power by the numbers is × this (progression census 2026-10-09: over 56 core rooms the
// autopilot's real teams met in its games, each played out on the map 8 times, the played fight was won 25% of the
// time where the numbers said 80%, a fresh rifle team of six at 97% lost 8 of 8 (the Hivemind's hit points, its pulse
// and lash and the brood it keeps calling grind a team down on the map far more than a flat power says); × 2.75 fits
// them (Brier 0.42 → 0.09), so the odds the core room shows, the fight by the numbers and the autopilot's choice
// match what the map gives; 2.5 so an ideal squad (plate, Shooting 7, full health) is not shown far less than it wins.
// Refitted 2026-10-10 with the dark, lights and the weak spots (tools/hivecorecalib.js --fit: 96 configurations, four
// squads from a rifle team in plate to a scrappy one of shotguns and pistols at Shooting 5, tiers 1/2/4, guards 60/120,
// lit or not, with and without 2 Molotovs and 2 flashbangs, 12 battles each): numbersK 2 for a team in the dark with
// nothing for the Hivemind (the best fit is 1.7, RMS 0.180; 2 costs little, 0.188, and leans careful where the numbers
// overrate weak teams), × (1 − 0.325 × the share lit) × (1 − 0.4 × the Molotovs − 0.15 × the bangs, up to 2 of each).
// Refitted 2026-10-10 again with the team's fire at the core (coreFire: range and reloads; the shotgun's reload from the
// shells at hand and buckshot's spread had made the numbers rate shotgun squads far above the map: tools/hiveplustest.js
// 31% by the numbers against 0% on the map at tier 2) and shells packed at hand for trips (carrykit.js packShells):
// tools/hivecorecalib.js --fit 16, 144 configurations of six squads (rifles in plate, hunting rifles, pumps, a scrappy
// one of pumps and pistols at Shooting 5, hunting rifles beside pumps, axes), FIT_CAREFUL=2 (the numbers above the map
// count twice: the autopilot's gate goes on 70–90%). numbersK 0.6, powerTier 20 (the bosses grow faster with the tier:
// a rifle squad without fire wins a tier-2 core and loses a tier-4 one), lit 0.425, fire 0.55, stun 0.15, REACH range
// 6, melee 0.35. RMS 0.258 → 0.192; where the numbers say 70% or more the map won 94% (43 configurations). Mean gap
// (points, map against numbers) before → after: rifle squads 21 → 13, shotgun 16 → 13, mixed 14 → 16, melee 22 → 3.
// Refitted 2026-10-19 after physical rounds (mags.js 2026-10-18: a Reload draws only on what the person carries; the
// fit's squads kitted for the core, tools/hivecorecalib.js coreTrial: spare magazines, shells at hand, carrykit.js
// packShells, and a hunting rifle's rounds at hand too) and the by-numbers odds refitted for AI parity (combat.js
// ODDS): the same fit (--fit 16, 144 configurations of the six squads, FIT_CAREFUL=2; one process a squad, FIT_SAVE,
// --refit).
// numbersK 0.4, powerTier 23, lit 0.4, fire 0.65, stun 0.3, floor 0.05, REACH range 6, melee 0.3. RMS 0.239 → 0.212
// (numbersK 0.6 alone: 0.368); where the numbers say 70% or more the map won 97% (45 configurations, at worst 69%).
// Mean gap before → after: rifle squads 20 → 15, shotgun 22 → 17, mixed 19 → 18, melee 3 → 3.
// P2: its second phase, below `at` of its health (once): the pulse reaches further and hits harder (pulse, pulseDmg,
// stun), the walls give up brood every spawnEvery turns (spawn), cap more of them, and the cave quakes (quake: pillars
// of flesh and bone come down in the open, everyone of yours caught under one hurt quakeDmg at quakeHit odds).
export const HIVEMIND = { hp: 480, perTier: 60, pulse: 3, pulseDmg: [4, 10], stun: 0.35, lash: [16, 30], spawnEvery: 2, spawn: [2, 3], cap: 8, capTier: 1, power: 13, powerTier: 23, broodPower: 9, numbersK: 0.4,
  P2: { on: true, at: 0.5, pulse: 4, pulseDmg: [6, 12], stun: 0.45, spawnEvery: 2, spawn: [3, 4], cap: 1, quake: [3, 5], quakeDmg: [3, 8], quakeHit: 0.35 } };
// Its weak spots (WEAK): fire on it or next to it (a Molotov, flames spreading to it) burns it burnDmg a turn for
// burnTurns of its turns after the last flames touched it, and while it burns the walls give up no brood; a bang next
// to it stuns it (a flashbang within flash tiles: stunFlash of its turns; a frag grenade or a pipe bomb within blast:
// stunBlast): no pulse, no lash and no brood called while it reels, and its flesh lies open until its next turn (it
// takes stunArmor of each hit instead of its armour's share). The battle AI (and AI plays my side) throws them at it first
// (throwAt: combat.js bossThrowTarget, stealth.js botAttackThrow), never with one of yours in the fire or the flash.
HIVEMIND.WEAK = { burnDmg: [30, 45], burnTurns: 2, near: 1, flash: 3, blast: 2, stunFlash: 3, stunBlast: 2, safe: 2, stunArmor: 1,
  // panic: while it burns (and as a Molotov bursts), the brood it called within panic tiles of the flames, or within
  // panicNear of it, shy away: each loses an action on its next turn. daze: a bang within flash (a flashbang) or blast (a grenade) tiles of the Broodmother
  // costs her dazeFlash or dazeBlast actions on her next turn. outlook (combat.js fightOutlook, the AI's retreat): the
  // Hivemind burning counts burnLife of its flesh and burnFire of its blows, reeling stunLife and none of its blows,
  // and each Molotov or bang your side still has for it (up to 4) adds prepEdge to your side's strength.
  panic: 2, panicNear: 4, dazeFlash: 2, dazeBlast: 1, burnLife: 0.5, burnFire: 0.5, stunLife: 0.7, prepEdge: 0.12 };
// The core by the numbers (coreSetup, coreGate): the bosses' power (× numbersK, fitted to the map on the autopilot's
// teams, most of them without lights) × (1 − lit × the share of the team with a light) × (1 − fire × the Molotovs it
// brings, up to kit, − stun × the flashbangs, grenades and pipe bombs, up to kit). Fitted to the map with
// tools/hivecorecalib.js (--fit): six squads, tiers 1, 2 and 4, guards 60 and 120, lit or not, with and without two
// Molotovs and two flashbangs; the team's power × coreFire (below). A fight by the numbers spends what it counts.
HIVEMIND.NUMBERS = { lit: 0.4, fire: 0.65, stun: 0.3, kit: 2, floor: 0.05 }; // floor: the bosses × at least this for all a team brings (refit 2026-10-19; 0.3 before)
// What the core battles did (the tools' calibration): battles fought on the map, how many saw the second phase, how
// many saw the Hivemind burn or reel.
export const HM_STATS = { battles: 0, phase2: 0, burned: 0, stunned: 0, dazed: 0, panicked: 0 };

// The kinds of chamber: short (its letter on the crawl window's map), name, share of the brood (brood) and its power, the special dead among them (special), what
// can be done there (burn: eggs or a growth's root; search: what lies in it), its battle map size, how it reads.
export const ROOM_KINDS = {
  mouth:    { short: "M", name: "The mouth", brood: 0.8, power: 1, special: false, size: [28, 16], text: "A wet throat of flesh where the hive swallows the light. The guard shuffles in and out." },
  tunnel:   { short: "T", name: "Tunnel", brood: 0.7, power: 1, special: true, size: [28, 13], text: "A low, ribbed passage you have to stoop in. It sweats." },
  gallery:  { short: "G", name: "Gallery", brood: 1, power: 1, special: true, size: [30, 18], text: "A long hall of fused bodies, columns of flesh holding up the roof. The brood rests along the walls." },
  nursery:  { short: "N", name: "Nursery", brood: 1.4, power: 0.55, special: false, size: [28, 18], text: "Cradles of membrane, and the newly turned crawling out of them: many, but weak." },
  eggs:     { short: "E", name: "Egg chamber", brood: 0.6, power: 1, special: false, burn: true, size: [26, 16], text: "Amber sacs heaped to the ceiling, something turning inside each. Fire would take them." },
  bones:    { short: "B", name: "Bone pit", brood: 0.5, power: 1, special: false, search: true, size: [26, 16], text: "Bones picked clean, and among them the packs and guns of the teams that came before you." },
  pool:     { short: "W", name: "Worm pool", brood: 0.8, power: 1, special: true, search: true, size: [26, 16], text: "Black water to the knee, and it moves. The worm breeds here: every step is a risk." },
  growth:   { short: "R", name: "Growth root", brood: 1, power: 1, special: true, burn: true, size: [28, 16], text: "The roots of one of the hive's growths reach down here, thick as a man and beating." },
  collapse: { short: "C", name: "Collapsed tunnel", brood: 0, power: 1, special: false, size: [24, 14], text: "The roof has come down over most of it: rubble and flesh to crawl over on your belly. Nothing lives here, and the air goes nowhere." },
  core:     { short: "★", name: "The core", brood: 0, power: 1, special: false, size: [34, 22], text: "The heart of the hive." },
};
const DRAFT_WORD = { warmer: "warmer", colder: "colder", level: "no draft" };

// ---------- helpers ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const seedOf = (...parts) => Math.floor(hash01(...parts) * 4294967296);
const partyById = (state, id) => state.parties.find((x) => x.id === id) || null;
export const alertName = (a) => HCRAWL.ALERT.names[clamp(Math.floor(a / 20), 0, 4)];
// A chamber's brood activity: { level 1-5, name, mult } by the hive's dice (HCRAWL.THREAT).
export function chamberThreat(state, hiveId, roomId) {
  const T = HCRAWL.THREAT;
  let r = hash01(state.seed, "hc-threat", hiveId, roomId), level = 1;
  for (let i = 1; i < T.weights.length; i++) { if (r < T.weights[i]) { level = i; break; } r -= T.weights[i]; level = i; }
  return { level, name: T.names[level], mult: T.mult[level] };
}
// The heat in a chamber: the hive's Alert and the chamber's own heat, × its activity.
export const roomHeat = (state, c, room, mult = chamberThreat(state, c.hiveId, room.id).mult) => (c.alert + ((c.heat || {})[room.id] || 0)) * mult;
// How much heat the team leaves in a chamber for each point of Alert it raises there (HCRAWL.HEAT).
export function heatMultOf(state, p) {
  const H = HCRAWL.HEAT;
  return (1 + H.perPerson * Math.max(0, partyMembers(state, p).length - 3)) * (p.stance === "stealthy" ? H.stealthy : 1);
}
const guardSize = (state, hive) => { const g = hiveGuard(state, hive); return g ? g.size : 0; };
function say2(c, text, k = "info", hour = null) {
  c.log.push({ text, k, hour });
  if (c.log.length > 60) c.log.splice(0, c.log.length - 60);
}
const first = (s) => s.name.split(" ")[0];

// ---------- the den ----------
// Its depth: DEPTH by the hive's tier, one more with a screamer spire.
export function denDepth(state, hive) {
  const t = clamp(hiveTier(state, hive), 0, HCRAWL.DEPTH.length - 1);
  // worldcfg.js: the run's Hive crawl shallowest / deepest: the tier's depth stretched or squeezed between them (the
  // usual 2–9 is the usual DEPTH), the spire still on top.
  const lo = cfgOf(state, "hiveMin"), hi = cfgOf(state, "hiveMax");
  const D0 = HCRAWL.DEPTH[0], D1 = HCRAWL.DEPTH[HCRAWL.DEPTH.length - 1];
  const depth = lo === D0 && hi === D1 ? HCRAWL.DEPTH[t] : Math.round(lo + (hi - lo) * ((HCRAWL.DEPTH[t] - D0) / (D1 - D0)));
  return Math.max(1, depth) + (hiveMods(state, hive).spire ? HCRAWL.SPIRE_DEPTH : 0);
}
const DEN_V = 3; // 3: 3 open, 1 wall, four mouths (2026-10-13); 2: the grid's first cut (one mouth, passages open at random); 1: the layered web before it (an old save's den is made again once no team is inside)
// The hive's den, made on first use (and again, keeping what it remembers, when the hive has grown deeper).
export function denOf(state, hive) {
  const depth = denDepth(state, hive);
  if (hive.den && hive.den.v === DEN_V && hive.den.depth === depth) return hive.den;
  // Not while a team is inside: its chamber, trail and the chambers it has seen are this den's (the progression census
  // of 2026-10-09, seed 6002: a hive reached tier 1 with a team in a side pocket that the deeper den does not have,
  // and the crawl crashed on the missing chamber). It deepens once the team is out.
  // A den of an older make (v 1, v 2: one mouth) is the same: the team walks it out (mouthsOf), then it is made again.
  if (hive.den && state.parties.some((p) => p.hiveCrawl && p.hiveCrawl.hiveId === hive.id)) return hive.den;
  const old = hive.den, grew = !!old && old.depth !== depth;
  hive.den = genDen(state, hive, depth, clamp(hiveTier(state, hive), 0, 4));
  if (old) {
    if (grew) hive.den.grew = state.hour;
    if (hive.crawlRec) { hive.crawlRec.mapped = {}; hive.crawlRec.mouths = {}; hive.crawlRec.core = false; hive.crawlRec.coreHeard = false; if (grew) hive.crawlRec.grew = day(state); } // its chambers are new: the map starts again
  }
  return hive.den;
}
export const roomById = (den, id) => den.rooms.find((r) => r.id === id) || null;
// The den's mouths: ids, north, east, south, west. A den of the old make (v 2) with a team still inside: its one mouth.
export const mouthsOf = (den) => (!den ? [] : den.mouths || (den.mouth != null ? [den.mouth] : []));
export const isMouth = (den, id) => mouthsOf(den).includes(id);
// The side of the den a mouth opens on ("north"), or "" (the old make's one mouth).
export const mouthSide = (den, id) => { const r = roomById(den, id); return r && r.side != null ? DIR_NAMES[r.side] : ""; };
// The mouth an entrance chamber opens to, or null.
export const mouthBy = (den, room) => (room ? room.links.find((id) => isMouth(den, id)) || null : null);
// The den's chambers and passages, by the world's seed and the hive (no state dice): the same den every visit.
// A round grid (2026-10-13, as the city crawl's, citygrid.js): a square with its corners cut away in a curve, GRID.rings
// × depth rings from its rim to its heart. A chamber's layer is its ring scaled to the depth (1 on the rim, `depth` at
// the heart): what the brood reads. One chamber of the innermost rings is the core, and only 1 or 2 of its sides open
// (GRID.doors); the rest is wall. Its sound carries through the walls (soundOf: the grid distance), its warmth only
// along the passages (warmthOf: the walking distance), so a team beside the wrong wall hears the Hivemind beat right
// there and has to find the way round to a door.
// Four entrances (2026-10-13): on each side, north, east, south and west, a rim chamber facing out that way (the side
// of the centre it lies on), at a spot along that side of the hive's dice, opens to its own mouth outside the rim.
// 3 open, 1 wall (2026-10-13): every chamber is a T, a hallway through it and a room off the side, so it opens on 3 of
// its 4 sides. Its one wall is: its outside, on the rim (where the rim steps and two sides lie outside, both: a bend,
// open on 2; where the rim meets a shut side of the core in the smallest dens, the same); a shut side of the core; or,
// for every other chamber (an entrance's outside is its mouth, so an entrance is one of them), a wall shared with a
// chamber beside it, the one wall of both: the inner walls pair those chambers off, the most pairs the grid allows,
// by the hive's dice. A chamber the pairs leave over (the grid's parity) has no wall: open on 4. The pairs are dealt
// again (GRID.tries) while a chamber is cut off from the mouths (never through the core); failing that a wall is
// knocked through.
export function genDen(state, hive, depth, tier) {
  const G = HCRAWL.GRID;
  const rng = new Rng(seedOf(state.seed, "hiveden", hive.id, hive.tile, depth));
  const rings = Math.max(2, Math.round(depth * G.rings)), size = 2 * rings - 1;
  const g = { size, r: size / 2 };
  /** @type {any[]} */
  const rooms = [];
  const at = new Map();
  const key = (x, y) => `${x}_${y}`;
  const add = (id, layer, x, y, kind = null) => { const r = { id, layer, slot: x, x, y, kind, links: [], dist: 0, gd: 0, pocket: false }; rooms.push(r); at.set(key(x, y), r); return r; };
  const link = (a, b) => { if (!a || !b || a === b || a.links.includes(b.id)) return; a.links.push(b.id); b.links.push(a.id); };
  const cell = (x, y) => at.get(key(x, y)) || null;
  // The core: in the innermost rings (the heart alone in a small den), not beside a bend of the rim (two sides outside
  // and a shut side of the core would leave it a dead end).
  const cells = cellsOf(g);
  const inner = Math.max(...cells.map(([x, y]) => ringOf(g, x, y)));
  const bend = (x, y) => DIRS.filter(([dx, dy]) => !inGrid(g, x + dx, y + dy)).length >= 2;
  const ringed = cells.filter(([x, y]) => ringOf(g, x, y) >= Math.max(Math.min(2, inner), inner - 1));
  const clear = ringed.filter(([x, y]) => !DIRS.some(([dx, dy]) => inGrid(g, x + dx, y + dy) && bend(x + dx, y + dy)));
  const deep = clear.length ? clear : ringed;
  const [cx, cy] = deep[rng.int(0, deep.length - 1)];
  // A chamber's layer (the brood's depth): its ring, scaled so the heart is `depth` deep.
  const layerOf = (x, y) => clamp(Math.round((ringOf(g, x, y) * depth) / inner), 1, depth);
  for (const [x, y] of cells) add(x === cx && y === cy ? "core" : `h${x}_${y}`, layerOf(x, y), x, y, x === cx && y === cy ? "core" : null);
  const core = cell(cx, cy);
  const grid = rooms.filter((r) => r !== core);
  // The core's doors: 1 or 2 of its sides. A young hive (tier 0) is still being dug: its first door faces a side of
  // the den of the hive's dice, the side of one of its entrances.
  const sides = DIRS.map(([dx, dy]) => cell(cx + dx, cy + dy)).filter(Boolean);
  const doors = Math.min(sides.length, rng.chance(G.doors[clamp(tier, 0, G.doors.length - 1)]) ? 2 : 1);
  const d0 = tier === 0 ? rng.int(0, 3) : -1, toward = d0 >= 0 ? cell(cx + DIRS[d0][0], cy + DIRS[d0][1]) : null;
  for (let i = 0; i < doors; i++) link(core, sides.splice(i === 0 && toward && sides.includes(toward) ? sides.indexOf(toward) : rng.int(0, sides.length - 1), 1)[0]);
  // Each chamber's walls it cannot help: its sides outside the rim (not the side to its own mouth) and a shut side of
  // the core.
  const fixed = (r) => DIRS.filter(([dx, dy]) => { const o = cell(r.x + dx, r.y + dy); return !o || (o.kind === "mouth" && !o.links.includes(r.id)) || (o === core && !core.links.includes(r.id)); }).length;
  // The four entrances and their mouths, north, east, south, west: on each side a rim chamber facing out that way, at a
  // spot of the hive's dice. An entrance with one side outside has its wall to deal (it opens to its mouth there), so
  // the dice pick among the spots that keep the chambers to be paired off even on the grid's checkerboard (fewer left
  // over with no wall).
  const odd = (r) => ((r.x + r.y) % 2 === 0 ? 1 : -1);
  let tilt = grid.reduce((a, r) => a + (fixed(r) === 0 ? odd(r) : 0), 0);
  const mouths = [];
  for (let d = 0; d < 4; d++) {
    const [dx, dy] = DIRS[d];
    const out = grid.filter((r) => !inGrid(g, r.x + dx, r.y + dy) && r.gate == null && !cell(r.x + dx, r.y + dy));
    const facing = out.filter((r) => (headingToward(g, r.x, r.y) + 2) % 4 === d);
    const can = facing.length ? facing : out;
    const shift = (r) => (fixed(r) === 1 ? odd(r) : 0);
    const best = Math.min(...can.map((r) => Math.abs(tilt + shift(r))));
    const gate = rng.pick(can.filter((r) => Math.abs(tilt + shift(r)) === best));
    tilt += shift(gate);
    gate.gate = d;
    const m = add(`m${"nesw"[d]}`, 0, gate.x + dx, gate.y + dy, "mouth");
    m.side = d;
    link(m, gate);
    mouths.push(m);
  }
  // The sides between two chambers of the grid (not the core's: its doors are made), and the chambers with no wall
  // yet: the ones the pairs are dealt from.
  const sideBy = [];
  for (const r of grid) for (const o of [cell(r.x + 1, r.y), cell(r.x, r.y + 1)]) if (o && o !== core && o.kind !== "mouth") sideBy.push([r, o]);
  const free = new Set(grid.filter((r) => fixed(r) === 0));
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const wk = (a, b) => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);
  // The most pairs (a matching on the grid's checkerboard, by augmenting paths), the hive's dice in the order.
  const deal = () => {
    const adj = new Map([...free].map((r) => [r, []]));
    for (const [a, b] of sideBy) if (free.has(a) && free.has(b)) { adj.get(a).push(b); adj.get(b).push(a); }
    for (const l of adj.values()) rng.shuffle(l);
    const mate = new Map();
    const aug = (u, seen) => {
      for (const v of adj.get(u)) {
        if (seen.has(v)) continue;
        seen.add(v);
        const w = mate.get(v);
        if (!w || aug(w, seen)) { mate.set(v, u); mate.set(u, v); return true; }
      }
      return false;
    };
    for (const u of rng.shuffle([...free].filter((r) => (r.x + r.y) % 2 === 0))) aug(u, new Set());
    const walls = new Set();
    for (const [u, v] of mate) if ((u.x + u.y) % 2 === 0) walls.add(wk(u, v));
    return walls;
  };
  // The chambers reached from the mouths along the passages (the open sides, the mouths' own), never through the core.
  const reached = (walls) => {
    const open = new Map(grid.map((r) => [r, []]));
    for (const [a, b] of sideBy) if (!walls.has(wk(a, b))) { open.get(a).push(b); open.get(b).push(a); }
    const seen = new Set(mouths), q = [...mouths];
    while (q.length) {
      const r = q.shift();
      const next = [...(open.get(r) || []), ...r.links.map((id) => byId.get(id)).filter((o) => o !== core)];
      for (const o of next) if (!seen.has(o)) { seen.add(o); q.push(o); }
    }
    return seen;
  };
  let walls = deal();
  for (let t = 1; t < G.tries && grid.some((r) => !reached(walls).has(r)); t++) walls = deal();
  for (let seen = reached(walls); grid.some((r) => !seen.has(r)); seen = reached(walls)) { // a wall knocked through to a chamber cut off
    const [a, b] = sideBy.find(([x, y]) => walls.has(wk(x, y)) && seen.has(x) !== seen.has(y));
    walls.delete(wk(a, b));
  }
  for (const [a, b] of sideBy) if (!walls.has(wk(a, b))) link(a, b);
  // Distances to the core: along the passages (the warmth) and through the walls (the sound).
  for (const r of rooms) { r.dist = Infinity; r.gd = Math.abs(r.x - cx) + Math.abs(r.y - cy); }
  core.dist = 0;
  const q = [core];
  while (q.length) { const r = q.shift(); for (const id of r.links) { const n = byId.get(id); if (n.dist > r.dist + 1) { n.dist = r.dist + 1; q.push(n); } } }
  // The kinds. No chamber is a dead end any more (3 open, 1 wall); where the den runs out the dead-end kinds come up
  // more (bone pits, eggs, collapses): a bend of the rim (open on 2), and the far end of a way, a chamber with no
  // passage out of it that leads colder.
  const growths = growthsOf(state, hive);
  let gi = 0;
  for (const r of rooms) {
    if (r.kind) continue;
    r.dead = r.links.length <= 2 || r.links.every((id) => byId.get(id).dist <= r.dist);
    const w = !r.dead
      ? { tunnel: 3, gallery: 2.5, nursery: r.layer >= 2 ? 1.5 : 0.4, pool: r.layer >= 2 ? 1 : 0.3, eggs: 1, growth: growths.length ? 1.2 : 0, bones: 0.6 }
      : { bones: 2, eggs: 1.5, collapse: 1.5, pool: 1, nursery: 0.5, growth: growths.length ? 0.8 : 0 };
    r.kind = rng.weighted(Object.keys(w), (k) => w[k]);
    if (r.kind === "growth") { const gr = growths[gi++ % growths.length]; r.gid = gr.id; r.gkind = gr.kind; }
  }
  const far = Math.max(...rooms.map((r) => r.dist)), farGd = Math.max(...rooms.map((r) => r.gd));
  return { v: DEN_V, grid: true, depth, tier, size, rings: inner, coreRing: ringOf(g, cx, cy), far, farGd, coreAt: { x: cx, y: cy }, doors, mouths: mouths.map((m) => m.id), core: core.id, width: size, rows: size, rooms };
}
// The chamber next to the core (its brood is the worst).
const nearCore = (den, room) => room.links.includes(den.core);
// The mouth nearest the core along the passages (the shortest way in; north first on a tie).
export function nearestMouth(den) {
  let best = null;
  for (const id of mouthsOf(den)) { const r = roomById(den, id); if (r && (!best || r.dist < best.dist)) best = r; }
  return best ? best.id : null;
}
// The shortest way from a chamber (the nearest mouth) to the core, by the distances (ids, the core last).
export function shortestPath(den, fromId = nearestMouth(den)) {
  const out = [];
  let r = roomById(den, fromId);
  while (r) {
    out.push(r.id);
    if (r.id === den.core) break;
    const next = r.links.map((id) => roomById(den, id)).filter((n) => n.dist < r.dist).sort((a, b) => a.dist - b.dist || a.id.localeCompare(b.id))[0];
    r = next || null;
  }
  return out;
}
// The cheapest way from a chamber to one that `goal` picks, never through the core: the price of stepping into a
// chamber is cost(room) (null: not that way). [the ids after fromId, the goal last], or null.
export function cheapestWay(den, fromId, goal, cost = (r) => 1) {
  const byId = new Map(den.rooms.map((r) => [r.id, r]));
  const best = new Map([[fromId, 0]]), prev = new Map(), done = new Set();
  for (;;) {
    let u = null, du = Infinity;
    for (const [id, d] of best) if (!done.has(id) && d < du) { u = id; du = d; }
    if (u == null) return null;
    done.add(u);
    if (u !== fromId && goal(byId.get(u))) { const out = []; for (let x = u; x !== fromId; x = prev.get(x)) out.unshift(x); return out; }
    for (const id of byId.get(u).links) {
      const r = byId.get(id);
      if (!r || r.kind === "core" || done.has(id)) continue;
      const k = cost(r);
      if (k == null) continue;
      if (du + k < (best.get(id) ?? Infinity)) { best.set(id, du + k); prev.set(id, u); }
    }
  }
}
// Warmth 0–100: the core 100, falling with the distance to it along the passages.
// On the grid the scale is the farthest chamber's distance (den.far), so every step toward the core is warmer.
export const warmthOf = (den, room) => (room ? clamp(Math.round(100 * (1 - room.dist / ((den.far ?? den.depth) + 1))), 0, 100) : 0);
// Sound 0–100: the Hivemind's beat through the flesh, by the grid distance to the core (through the walls: a chamber
// beside the core's wall hears it loud whether or not a door is on its side). A den from before the grid: the warmth.
export const soundOf = (den, room) => (room ? clamp(Math.round(100 * (1 - (room.gd ?? room.dist) / ((den.farGd ?? den.far ?? den.depth) + 1))), 0, 100) : 0);
export function soundText(v) {
  return v >= 90 ? "the beat is all around you, so close the walls shake with it" : v >= 70 ? "a heavy beat, loud through the wall" : v >= 50 ? "a slow beat you feel in your teeth" : v >= 30 ? "a dull beat somewhere ahead" : "a faint, slow beat, far off";
}
// Which way a passage goes on the grid: "north", "east", "south" or "west" (citygrid.js DIR_NAMES); "" off the grid.
export function passageDir(den, from, to) {
  if (!den.grid || !from || !to) return "";
  const i = DIRS.findIndex(([dx, dy]) => to.x - from.x === dx && to.y - from.y === dy);
  return i >= 0 ? DIR_NAMES[i] : "";
}
export function warmthText(w) {
  return w >= 90 ? "the walls sweat and the air is hot and thick; something vast beats close by" : w >= 70 ? "hot: the walls pulse under your hand" : w >= 50 ? "warm as breath" : w >= 30 ? "close and clammy" : "cool and damp";
}
export const roomName = (room, state = null) => {
  if (!room) return "?";
  if (room.kind === "growth" && room.gkind && GROWTHS[room.gkind]) return `Root of the ${GROWTHS[room.gkind].name.toLowerCase()}`;
  if (room.kind === "mouth" && room.side != null) return `The ${DIR_NAMES[room.side]} mouth`; // one of the four (2026-10-13)
  return ROOM_KINDS[room.kind] ? ROOM_KINDS[room.kind].name : room.kind;
};

// "the tunnel", "the north mouth", "the root of the brood chamber".
export const roomThe = (room) => { const n = roomName(room); return /^The /.test(n) ? n.toLowerCase() : `the ${n.toLowerCase()}`; };

// ---------- the brood ----------
const memOf = (hive) => hive.denMem || (hive.denMem = { rooms: {}, searched: {}, visits: 0, lastAlert: 0, lastHour: 0 });
export const guardScale = (G) => (G > 0 ? clamp(Math.sqrt(G / HCRAWL.BROOD.guardRef), HCRAWL.BROOD.scale[0], HCRAWL.BROOD.scale[1]) : 0);
// A chamber's brood when it is full, with a guard of G.
export function roomFull(state, hive, den, room, G = guardSize(state, hive)) {
  const K = ROOM_KINDS[room.kind];
  if (!K || !K.brood) return 0;
  const s = guardScale(G);
  if (!s) return 0;
  const B = HCRAWL.BROOD;
  let n = (B.base + B.perLayer * room.layer) * K.brood * s;
  if (nearCore(den, room)) n *= B.nearCore;
  return clamp(Math.round(n), B.min, B.max);
}
// Their power, with a guard of G.
export function roomPower(state, hive, den, room, G = guardSize(state, hive)) {
  const K = ROOM_KINDS[room.kind] || ROOM_KINDS.tunnel;
  return Math.round(broodForce(Math.max(HIVE.GUARD_MIN, G), state).power * (1 + HCRAWL.BROOD.powerPerLayer * room.layer) * (K.power || 1) * (nearCore(den, room) ? 1.1 : 1) * 10) / 10;
}
// The brood in a chamber now: full, or what was left the last time anyone fought there (it refills after REFILL_DAYS).
export function broodLeft(state, hive, room, G = guardSize(state, hive)) {
  const den = denOf(state, hive);
  const full = roomFull(state, hive, den, room, G);
  const mem = memOf(hive);
  const m = mem.rooms[room.id];
  if (!m) return full;
  const eggs = mem.eggsBurned != null && state.hour - mem.eggsBurned < HCRAWL.REFILL_DAYS * 48 ? 1.5 : 1; // its eggs burned lately: slower everywhere
  const refill = HCRAWL.REFILL_DAYS * 24 * (m.burned ? HCRAWL.EGG_REFILL : 1) * eggs;
  if (state.hour - m.at >= refill && G >= HIVE.GUARD_MIN * 0.5) { delete mem.rooms[room.id]; return full; }
  return Math.min(full, m.left);
}
function setLeft(state, hive, room, n) {
  const mem = memOf(hive);
  const was = mem.rooms[room.id];
  mem.rooms[room.id] = { left: Math.max(0, Math.round(n)), at: state.hour, burned: !!(was && was.burned) };
}
// The special dead among n brood at a layer: the kinds the hive's growths breed, a share rising with the depth.
// And, as the years go by, a few of the era's kinds it does not breed (deadpool.js broodWiden), whatever it has grown.
function broodTypes(state, hive, n, layer) {
  const kinds = hiveMods(state, hive).unlocks;
  const extra = broodWiden(state, eraTier(state), kinds, n, layer);
  if ((!kinds.length && !extra) || n < 2) return null;
  const S = HCRAWL.SPECIAL;
  const k = kinds.length ? Math.round(n * Math.min(S.max, S.base + S.perLayer * layer)) : 0;
  if (k <= 0 && !extra) return null;
  const out = {};
  for (let i = 0; i < k; i++) { const kind = kinds[(i + layer) % kinds.length]; out[kind] = (out[kind] || 0) + 1; }
  let room = Math.max(0, n - 1 - k);
  if (extra) for (const [kind, m] of Object.entries(extra)) { const add = Math.min(m, room); if (add > 0) { out[kind] = (out[kind] || 0) + add; room -= add; } }
  return Object.keys(out).length ? out : null;
}
// What fights in a chamber: { count, power, types, elite, name } (count: what is left in it now, or `count`).
export function roomForce(state, hive, room, count = null) {
  const den = denOf(state, hive);
  const n = count ?? broodLeft(state, hive, room);
  const K = ROOM_KINDS[room.kind] || ROOM_KINDS.tunnel;
  const mods = hiveMods(state, hive);
  const elite = (mods.elite && room.layer >= den.depth * HCRAWL.ELITE_FROM) || (nearCore(den, room) && den.tier >= 3);
  return { count: n, power: roomPower(state, hive, den, room), types: K.special ? broodTypes(state, hive, n, room.layer) : null, elite, name: `the brood in ${roomThe(room)}` };
}
// The core room: the brood around the Hivemind (× the guard's scale), the Hivemind (hp by the tier) and the Broodmother.
// bossPower: what the two count for by the numbers.
export function coreForce(state, hive, G = guardSize(state, hive)) {
  const den = denOf(state, hive);
  const C = HCRAWL.CORE, s = guardScale(G);
  const count = s ? clamp(Math.round((C.base + C.perDepth * den.depth) * s), C.min, C.max) : 0;
  const power = Math.round(broodForce(Math.max(HIVE.GUARD_MIN, G), state).power * (1 + C.powerPerDepth * den.depth) * 10) / 10;
  return {
    count, power, types: broodTypes(state, hive, count, den.depth), elite: hiveMods(state, hive).elite, tier: den.tier, depth: den.depth,
    hp: HIVEMIND.hp + HIVEMIND.perTier * den.tier, bossPower: (HIVEMIND.power + HIVEMIND.powerTier * den.tier + HIVEMIND.broodPower) * HIVEMIND.numbersK,
  };
}
// Every brood of the den when full (the core's too): the guard spread through it (cutGuard). The four mouths count
// as one (their mean, 2026-10-13: the guard shuffles in and out by all of them), so a brood killed is worth the share of
// the guard it was with one mouth (four whole mouths made every kill, yours and the groups', thin the guard a quarter
// less in a young hive: tools/grouphivetest.js, a fortress's war no longer burned its hive in 400 days).
export function denBroodTotal(state, hive, G = guardSize(state, hive)) {
  const den = denOf(state, hive);
  const ms = mouthsOf(den);
  const inner = den.rooms.reduce((a, r) => a + (isMouth(den, r.id) ? 0 : roomFull(state, hive, den, r, G)), 0);
  const mouths = ms.length ? ms.reduce((a, id) => a + roomFull(state, hive, den, roomById(den, id), G), 0) / ms.length : 0;
  return inner + mouths + coreForce(state, hive, G).count;
}
// Brood killed in the den: each takes its share of the guard horde. Returns the guard lost.
export function cutGuard(state, hive, killed) {
  const g = hiveGuard(state, hive);
  if (!g || !(killed > 0)) return 0;
  const per = g.size / Math.max(1, denBroodTotal(state, hive, g.size));
  const n = Math.min(g.size, Math.round(killed * per));
  if (n > 0) reduceHorde(state, g, n);
  return n;
}
// Allied fighters at the hive (alliance.js hiveAllies): in a chamber each keeps one off your squad (at most 40%).
const alliedThin = (count, fighters) => count - Math.min(fighters, Math.floor(count * 0.4));

// ---------- the team's crawl ----------
// The team's crawl, checked: a team gone, dead or away from the hive's tile loses it; a hive gone ends it.
export function hiveCrawlOf(state, p) {
  if (!p || !p.hiveCrawl) return null;
  const c = p.hiveCrawl;
  if (!state.parties.includes(p) || !partyMembers(state, p).length || partyTile(p) !== c.tile) { delete p.hiveCrawl; return null; }
  if (!hiveById(state, c.hiveId)) { crawlGone(state, p); return null; }
  if (p.phase !== "engaged") p.phase = "engaged";
  if (!(c.v >= 2)) { // a save from before leaving was a walk (2026-10-13): its walk out is the autopilot's to make now
    c.v = 2;
    if (c.leaving) c.headOut = true;
    delete c.leaving;
    if (c.mouth == null) c.mouth = c.trail[0];
  }
  broodBack(state, c);
  return c;
}
// The hive is gone with the team inside (its Hivemind killed by an AI group's war party, or taken off the map some
// other way): the crawl ends where the team stands, back on the map with what it carries and a line in the log. Its
// orders wait while its own battle is on (the battle's end gives them).
const GONE_TEXT = "The hive died around the team: it walked out through still flesh.";
function crawlGone(state, p) {
  const fighting = !!(state.combat && state.combat.setup && state.combat.setup.partyId === p.id);
  return finishHiveCrawl(state, p, GONE_TEXT, { orders: !fighting });
}
// The crawl the window shows: the first of your teams in one, not while its battle is on.
export function activeHiveCrawl(state) {
  for (const p of state.parties) {
    if (p.owner !== "player" || !p.hiveCrawl) continue;
    if (state.combat && state.combat.setup && state.combat.setup.partyId === p.id) continue;
    if (hiveCrawlOf(state, p)) return p;
  }
  return null;
}
export const crawlHive = (state, c) => hiveById(state, c.hiveId);
export const crawlRoom = (state, c) => { const h = crawlHive(state, c); return h ? roomById(denOf(state, h), c.at) : null; };

// Into the hive (the hive card's Enter the hive from the north, east, south or west): at that mouth, its brood in
// front. mouthId: one of the den's mouths (mouthsOf); none, the one the autopilot would pick (crawlEstimate).
export function startHiveCrawl(state, p, hive, mouthId = null) {
  const den = denOf(state, hive);
  const at = isMouth(den, mouthId) ? mouthId : crawlEstimate(state, hive).mouth || mouthsOf(den)[0];
  const mem = memOf(hive);
  mem.visits += 1;
  const left = Math.max(0, (mem.lastAlert || 0) - (state.hour - (mem.lastHour || 0)));
  p.phase = "engaged";
  p.hiveCrawl = {
    v: 2, hiveId: hive.id, tile: hive.tile, name: hive.name, visit: mem.visits, started: state.hour, mouth: at,
    at, from: null, trail: [at], visited: { [at]: true }, seen: {}, slipped: {},
    alert: clamp(Math.round(Math.max(HCRAWL.ALERT.start, left)), 0, 100), enc: null, headOut: false, deepest: 0,
    kills: 0, lost: [], log: [], tally: { supplies: {}, gear: [] }, hadVehicle: !!p.vehicle,
    lit: true, heard: {}, warned: {}, heat: {}, heatMult: heatMultOf(state, p),
  };
  const c = p.hiveCrawl;
  const rec = crawlRecOf(state, hive);
  rec.visits += 1;
  const used = rec.mouths || (rec.mouths = {});
  (used[at] || (used[at] = { in: 0, out: 0 })).in++;
  markSeen(den, c, at);
  markThreat(state, hive); // hivetech.js: it builds for defence
  hive.playerDay = day(state); // hives.js notePlayerFight: a group fighting it warms to you
  const mouth = roomById(den, at);
  const lights = teamLights(state, p);
  const side = mouthSide(den, at);
  say2(c, `${teamName(state, p)} ${partyMembers(state, p).length === 1 ? "goes" : "go"} into ${hive.name}${side ? ` by its ${side} mouth` : ""}. ${den.grew ? "It has grown deeper since anyone was last inside. " : ""}The air is ${warmthText(warmthOf(den, mouth))}. ${lights ? `${lights} light${lights === 1 ? "" : "s"} on.` : "Nobody has a light: you feel your way in the dark."}`, "info", state.hour);
  log(state, `${teamName(state, p)} crawls into ${hive.name}${side ? ` from the ${side}` : ""}.`, "info");
  enterRoom(state, p, c, mouth, null);
  return true;
}
const markSeen = (den, c, id) => { const r = roomById(den, id); if (r) for (const n of r.links) c.seen[n] = true; };
// The walk the team has made from its mouth (c.trail, loops cut): a step to a chamber already on it cuts it there.
function stepTrail(c, id) {
  const i = c.trail.indexOf(id);
  if (i >= 0) c.trail.length = i + 1; else c.trail.push(id);
}
// Where the team falls back to from a chamber: the way it came (back, or the chamber before it on its walk), else a
// chamber beside it it has been in (not the core). null: nowhere (at the mouth it came in by: out is the way).
function backOf(c, den, room, back = null) {
  const ok = (id) => id != null && id !== den.core && room.links.includes(id) && !!c.visited[id] && !!roomById(den, id);
  if (ok(back)) return back;
  const i = c.trail.lastIndexOf(room.id);
  if (i > 0 && ok(c.trail[i - 1])) return c.trail[i - 1];
  return room.links.find(ok) || null;
}
// Back into a chamber the team cleared (HCRAWL.HEAT): the noise it made there drew the brood back, and it may have
// filled again. True: it has.
function refillOnReturn(state, c, hive, den, to) {
  const H = HCRAWL.HEAT, heat = (c.heat || {})[to.id] || 0;
  if (!(heat > 0) || broodLeft(state, hive, to) > 0 || roomFull(state, hive, den, to) <= 0) return false;
  if (!state.rng.chance(Math.min(H.refillMax, heat * chamberThreat(state, c.hiveId, to.id).mult * H.refillPerHeat))) return false;
  setLeft(state, hive, to, Math.ceil(roomFull(state, hive, den, to) / 2));
  say2(c, `The noise you made in ${roomThe(to)} drew the brood back into it.`, "danger", state.hour);
  return true;
}
// The team falls back from a chamber (`from`) into one it has been in: its walk and the way it came from there (never
// the chamber it fled), and a chance the chamber it falls into filled again (refillOnReturn).
function fallBackTo(state, c, hive, den, to, from) {
  stepTrail(c, to.id);
  c.at = to.id;
  const prev = c.trail.length > 1 ? c.trail[c.trail.length - 2] : null;
  c.from = prev !== from ? prev : null;
  refillOnReturn(state, c, hive, den, to);
}
// Out of the hive through the mouth the team stands in: the crawl ends.
function outOf(state, p, c, den, room, text = "") {
  const hive = crawlHive(state, c);
  if (hive) { const rec = crawlRecOf(state, hive), used = rec.mouths || (rec.mouths = {}); (used[room.id] || (used[room.id] = { in: 0, out: 0 })).out++; }
  return finishHiveCrawl(state, p, text, { side: mouthSide(den, room.id) });
}

// The team walks into a chamber: what waits there.
function enterRoom(state, p, c, room, from) {
  const hive = crawlHive(state, c);
  if (!hive) { crawlGone(state, p); return; }
  const den = denOf(state, hive);
  c.from = from;
  c.at = room.id;
  stepTrail(c, room.id);
  const fresh = !c.visited[room.id];
  c.visited[room.id] = true;
  markSeen(den, c, room.id);
  c.deepest = Math.max(c.deepest, room.layer);
  noteRoom(state, hive, room);
  if (room.kind === "core") {
    const f = coreForce(state, hive);
    c.enc = { kind: "core", room: room.id, back: from, spotted: true };
    say2(c, `The core. ${f.count ? `${f.count} of the brood stand` : "Nothing stands"} between you and the ${BOSS_NAMES.hivemind}: a hill of flesh that fills the end of the chamber and beats like a heart, the ${BOSS_NAMES.hive} at its foot.`, "danger", state.hour);
    return;
  }
  const n = broodLeft(state, hive, room);
  const K = ROOM_KINDS[room.kind];
  // The core's wall beside you with no door on this side (the grid): the beat through the flesh, and no way through.
  const wall = den.grid && room.gd === 1 && !room.links.includes(den.core) ? " The beat comes through the wall right beside you, but there is no way through on this side." : "";
  // An entrance: a mouth opens off it, a way out.
  const gate = !isMouth(den, room.id) && mouthBy(den, room);
  const out = gate ? ` Cold air from outside: the ${mouthSide(den, gate) || "hive's"} mouth opens off it, a way out.` : "";
  const look = `${roomName(room)}: ${fresh ? K.text + " " : ""}The air is ${warmthText(warmthOf(den, room))}; ${soundText(soundOf(den, room))}.${wall}${out}`;
  if (n > 0 && !c.slipped[room.id]) {
    const heat = roomHeat(state, c, room); // HCRAWL.THREAT: the chamber's activity × its heat
    const spotted = (c.warned && c.warned[room.id]) || (heat >= 50 && hash01(state.seed, "hcspot", c.hiveId, room.id, c.visit, state.hour) < (heat - 40) / 100); // warned: a listener they heard

    c.enc = { kind: "brood", room: room.id, back: from, spotted };
    say2(c, `${look} ${n} of the brood${spotted ? " have seen you and turn" : " are here"}.`, spotted ? "danger" : "info", state.hour);
  } else say2(c, `${look}${n > 0 ? ` The brood you crept past are still here (${n}).` : ""}`, "info", state.hour);
}

// Hours pass on the shared clock: the Alert fades, and a roused hive comes for the team. False: the team is gone.
function passHours(state, p, hours) {
  const c = p.hiveCrawl;
  for (let i = 0; i < hours; i++) {
    tickHour(state);
    if (!state.parties.includes(p) || !partyMembers(state, p).length) return false;
    if (!p.hiveCrawl) return true;
    if (!crawlHive(state, c)) { crawlGone(state, p); return true; } // the hive died meanwhile (an AI group's war party): the callers see no crawl
    c.alert = Math.max(0, c.alert - HCRAWL.ALERT.decay);
    coolHeat(c, null, HCRAWL.HEAT.decay);
    converge(state, p, c);
  }
  return true;
}
// The guard back at the hive (it was away when the team came in, the chamber empty): its brood fills the chamber the
// team stands in again, and they are in front of it (checked whenever the crawl is looked at,
// hiveCrawlOf); else the team stood stuck in a chamber with brood and no answer to them.
function broodBack(state, c) {
  if (c.enc || state.combat) return;
  const hive = crawlHive(state, c);
  const room = hive && roomById(denOf(state, hive), c.at);
  if (!room || room.kind === "core" || c.slipped[room.id]) return;
  const n = broodLeft(state, hive, room);
  if (n <= 0) return;
  c.enc = { kind: "brood", room: room.id, back: c.from, spotted: false };
  say2(c, `The brood comes back into ${roomThe(room)} around you: ${n} of them.`, "danger", state.hour);
}
// Noise: the hive's Alert, and the chamber it was made in (at) keeps its own heat (HCRAWL.HEAT).
const addAlert = (c, v, at = c.at) => {
  c.alert = clamp(c.alert + v, 0, 100);
  if (v > 0 && at) { const h = c.heat || (c.heat = {}); h[at] = clamp((h[at] || 0) + v * (c.heatMult ?? 1), 0, 100); }
};
// A chamber's heat fades (at null: every chamber's).
function coolHeat(c, at, v) {
  const h = c.heat || {};
  for (const k of at ? [at] : Object.keys(h)) if (h[k] != null) h[k] = Math.max(0, h[k] - v);
}
// From ALERT.converge the brood comes for the team (an hour's roll): a swarm into its chamber, cleared chambers on the
// way back filling again; from ALERT.block every mouth packs up (the one the team stands in aside).
function converge(state, p, c) {
  const A = HCRAWL.ALERT;
  if (c.enc || state.combat) return;
  const hive = crawlHive(state, c);
  if (!hive) return;
  const den = denOf(state, hive);
  const here = roomById(den, c.at);
  const heat = Math.min(100, here ? roomHeat(state, c, here) : c.alert); // HCRAWL.THREAT: the swarm comes by the heat in the team's chamber (at most as a hive at Alert 100)
  if (c.alert < A.converge && heat < A.converge) return;
  const rng = state.rng;
  const over = (c.alert - A.converge) / (100 - A.converge);
  if (c.alert >= A.converge && rng.chance(A.refill * (0.5 + over))) {
    const back = c.trail.slice(0, -1).map((id) => roomById(den, id)).filter((r) => r && broodLeft(state, hive, r) === 0 && roomFull(state, hive, den, r) > 0);
    if (back.length) {
      const r = rng.pick(back);
      setLeft(state, hive, r, Math.ceil(roomFull(state, hive, den, r) / 2));
      say2(c, `Behind you the brood is flowing back into ${roomThe(r)}.`, "danger", state.hour);
    }
  }
  if (c.alert >= A.block) {
    const packed = mouthsOf(den).map((id) => roomById(den, id)).filter((m) => m && m.id !== c.at && broodLeft(state, hive, m) === 0 && roomFull(state, hive, den, m) > 0);
    for (const m of packed) setLeft(state, hive, m, roomFull(state, hive, den, m));
    if (packed.length) say2(c, `The hive is roused: the brood has packed ${packed.length === mouthsOf(den).length || packed.length > 1 ? "its mouths" : roomThe(packed[0])} behind you.`, "danger", state.hour);
  }
  const overHere = clamp((heat - A.converge) / (100 - A.converge), 0, 1);
  if (overHere > 0 && rng.chance(A.swarm * overHere)) {
    const room = here;
    const n = clamp(Math.round(2 + room.layer * 0.5 + (heat - A.converge) / 10), 2, 12);
    c.enc = { kind: "swarm", room: room.id, back: c.from, spotted: true, enemy: { kind: "zombies", count: n, power: roomPower(state, hive, den, room), types: broodTypes(state, hive, n, room.layer + 1), elite: false, name: "the brood converging on you" } };
    say2(c, `The hive is roused: ${n} of the brood pour into ${roomThe(room)} from the dark.`, "danger", state.hour);
  }
}

// The passages out of the team's chamber: { id, room (null: not been there; a mouth is always known), draft (as the
// team reads it), sound (the beat louder, fainter or the same that way), dir (north, east, south, west on the grid),
// visited, back, core, heard, mouth (it leads to a mouth: a way out), side (the mouth's: "north") }.
export function exitsOf(state, p) {
  const c = hiveCrawlOf(state, p);
  if (!c) return [];
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const here = roomById(den, c.at);
  return here.links.map((id) => {
    const r = roomById(den, id);
    const ds = soundOf(den, r) - soundOf(den, here); // the beat that way: louder, fainter or the same (heard true)
    const m = isMouth(den, id); // the mouths are known from outside: the way out
    return { id, room: c.visited[id] || m ? r : null, kind: c.visited[id] || m ? r.kind : null, draft: draftOf(state, p, c, den, here, r), sound: ds > 0 ? "louder" : ds < 0 ? "fainter" : "same", dir: passageDir(den, here, r), visited: !!c.visited[id], back: id === c.from, core: id === den.core && !!c.visited[id], heard: (c.heard && c.heard[id]) || null, mouth: m, side: m ? mouthSide(den, id) : "" };
  });
}
// The draft from a passage as the team reads it: warmer, colder or level; misread now and then by a team without a
// good scout (the visit's own dice: the same reading every time this visit).
export function draftOf(state, p, c, den, from, to) {
  const d = warmthOf(den, to) - warmthOf(den, from);
  let w = d > 0 ? "warmer" : d < 0 ? "colder" : "level";
  if (c.visited[to.id]) return w; // been there: no guessing
  if (c.heard && c.heard[to.id] && c.heard[to.id].by === "flare") return w; // a flare lit it: the draft reads true
  if (hash01(state.seed, "hcdraft", c.hiveId, from.id, to.id, c.visit) < draftMissHere(state, p, c)) w = w === "warmer" ? "colder" : "warmer";
  return w;
}
export const draftMiss = (state, p) => Math.max(HCRAWL.DRAFT.min, HCRAWL.DRAFT.miss - HCRAWL.DRAFT.perScout * bestSkill(state, p, "scouting"));
// ... in the team's chamber now: in the light of its lights (lights on) the misreading × LIGHT.draft.
export const draftMissHere = (state, p, c) => draftMiss(state, p) * (lightsOn(state, p, c) ? HCRAWL.LIGHT.draft : 1);
export const draftWord = (w) => DRAFT_WORD[w] || w;
// Can the team move on from its chamber (no brood in it, or it crept past)?
export function canMoveOn(state, c) {
  if (c.enc) return false;
  const hive = crawlHive(state, c);
  if (!hive) return false;
  const room = roomById(denOf(state, hive), c.at);
  return broodLeft(state, hive, room) === 0 || !!c.slipped[room.id];
}

// ---------- lights, flares and listening ----------
// How many of the team have a working light (lights.js lightOf: the off hand, a headlamp, a weapon or helmet light).
export const teamLights = (state, p) => partyMembers(state, p).filter((s) => !!lightOf(s)).length;
// The team's lights are on (the default; c.lit false: doused) and someone has one.
export const lightsOn = (state, p, c) => !!c && c.lit !== false && teamLights(state, p) > 0;
// Lights on or off (no time).
export function setLights(state, p, on) {
  const c = hiveCrawlOf(state, p);
  if (!c) return "The team is not in a hive.";
  const n = teamLights(state, p);
  if (!n) return "Nobody in the team has a light.";
  c.lit = !!on;
  const text = on ? `${n} light${n === 1 ? "" : "s"} on: the drafts are easier to read, but the brood sees you coming.` : "Lights off: you feel your way in the dark, and the drafts are harder to read.";
  say2(c, text, "info", state.hour);
  return text;
}
// Items of a kind the team carries (worn, pockets, rig pouches, the pack; then the cargo): [{ item, take }].
export function teamKit(state, p, key) {
  const out = [];
  for (const s of partyMembers(state, p)) for (const x of carriedSpots(s)) if (x.item && x.item.key === key) out.push({ item: x.item, take: x.take });
  const cargo = (p.cargo && p.cargo.gear) || [];
  for (const it of cargo) if (it && it.key === key) out.push({ item: it, take: () => { const i = cargo.indexOf(it); if (i >= 0) cargo.splice(i, 1); } });
  return out;
}
export const flaresOf = (state, p) => teamKit(state, p, "flare");
// What the team learns of the chamber beyond a passage: { by, q (exact, rough, vague), kind, n, lo, hi, who, hour }.
const heardOf = (c) => c.heard || (c.heard = {});
const chamberTruth = (state, hive, room) => (room.kind === "core" ? coreForce(state, hive).count : broodLeft(state, hive, room));
// The best listener: (Scouting + Stealth) / 2 of whoever is best at it.
export function listener(state, p) {
  let best = null, v = -1;
  for (const s of partyMembers(state, p)) { const x = ((s.skills.scouting || 0) + (s.skills.stealth || 0)) / 2; if (x > v) { v = x; best = s; } }
  return { who: best, v: Math.max(0, v) };
}
// The odds of a listen at a passage: { dc, skill, exact, rough, fumble }.
export function listenOdds(state, p, c, to) {
  const L = HCRAWL.LISTEN, { v } = listener(state, p);
  const dc = L.dc + L.perLayer * (to ? to.layer : 0);
  const atLeast = (m) => clamp(Math.floor(v + 10 - dc - m + 1e-9) / 10, 0, 1); // P(v + d10 − dc ≥ m), d10 = 1..10
  return { dc: Math.round(dc * 10) / 10, skill: v, exact: atLeast(L.exact), rough: atLeast(L.rough), fumble: 1 - atLeast(L.fumble + 0.001) };
}
const KIND_GUESS = ["tunnel", "gallery", "nursery", "eggs", "bones", "pool"];
// Listening at a passage (LISTEN.hours): the visit's own dice (the same listen every time this visit).
export function listenAt(state, p, id) {
  const c = hiveCrawlOf(state, p);
  if (!c) return "The team is not in a hive.";
  if (c.enc) return "Deal with what is in front of you first.";
  const hive = crawlHive(state, c), den = denOf(state, hive);
  const here = roomById(den, c.at), to = roomById(den, id);
  if (!to || !here.links.includes(id)) return "No passage leads there.";
  if (c.visited[id]) return "You have been there.";
  const H = heardOf(c);
  if (H[id] && (H[id].by === "listen" || H[id].q === "exact")) return "You have listened there already.";
  const L = HCRAWL.LISTEN, { who, v } = listener(state, p);
  const d10 = 1 + Math.floor(hash01(state.seed, "hclisten", c.hiveId, here.id, id, c.visit) * 10);
  const m = v + d10 - (L.dc + L.perLayer * to.layer);
  const n = chamberTruth(state, hive, to);
  const name = who ? first(who) : "Someone";
  /** @type {any} */
  let rec;
  let text, k = "info";
  if (m >= L.exact) {
    rec = { by: "listen", q: "exact", kind: to.kind, n };
    text = `${name} listens at the passage: ${heardText(rec)}. Sure of it.`;
    k = "good";
  } else if (m >= L.rough) {
    const lo = n ? Math.max(1, Math.floor(n * 0.6)) : 0, hi = n ? Math.ceil(n * 1.5) + 1 : 0;
    rec = { by: "listen", q: "rough", kind: to.kind, n: null, lo, hi };
    text = `${name} listens at the passage: ${heardText(rec)}.`;
  } else {
    const h1 = hash01(state.seed, "hclisten", c.hiveId, here.id, id, c.visit, "kind"), h2 = hash01(state.seed, "hclisten", c.hiveId, here.id, id, c.visit, "n");
    const others = KIND_GUESS.filter((x) => x !== to.kind);
    const wrong = to.kind !== "core" && h1 < 0.5;
    const guessKind = wrong ? others[Math.floor(h1 * 2 * others.length) % others.length] : to.kind;
    const g = Math.max(0, Math.round(n * (0.3 + 1.4 * h2) + (h2 > 0.7 ? 2 : 0)));
    rec = { by: "listen", q: "vague", kind: guessKind, n: null, lo: g, hi: g };
    text = `${name} listens, but the hive's own noise drowns it: ${heardText(rec)}, maybe.`;
    if (m <= L.fumble) {
      addAlert(c, L.alert);
      (c.warned || (c.warned = {}))[id] = true;
      text += ` A bone cracks under ${name}'s knee, and on the other side something goes quiet (Alert +${L.alert}).`;
      k = "danger";
    }
  }
  rec.who = who ? who.name : null;
  rec.hour = state.hour;
  H[id] = rec;
  if (to.kind === "core" && rec.kind === "core") crawlRecOf(state, hive).coreHeard = true;
  if (who) gainXpAll(state, [who], "scouting", USE.sneakSearch);
  say2(c, text, k, state.hour);
  if (!passHours(state, p, L.hours)) return goneText(state, p);
  return text;
}
// A road flare down a passage: the chamber beyond lit, its kind and brood seen as they are (Alert + FLARE.alert).
export function throwFlare(state, p, id) {
  const c = hiveCrawlOf(state, p);
  if (!c) return "The team is not in a hive.";
  if (c.enc) return "Deal with what is in front of you first.";
  const hive = crawlHive(state, c), den = denOf(state, hive);
  const here = roomById(den, c.at), to = roomById(den, id);
  if (!to || !here.links.includes(id)) return "No passage leads there.";
  const fl = flaresOf(state, p);
  if (!fl.length) return "The team has no road flares.";
  fl[0].take();
  addAlert(c, HCRAWL.FLARE.alert);
  const rec = { by: "flare", q: "exact", kind: to.kind, n: chamberTruth(state, hive, to), hour: state.hour, who: null };
  heardOf(c)[id] = rec;
  if (to.kind === "core") crawlRecOf(state, hive).coreHeard = true;
  const text = `You strike a flare and throw it down the passage. Red light: ${heardText(rec)}. The brood stirs at the glare (Alert +${HCRAWL.FLARE.alert}).`;
  say2(c, text, "info", state.hour);
  return text;
}
// "a gallery, 4 of the brood" / "a nursery, about 3–7 of the brood" / "a tunnel, 5 of the brood or so".
export function heardText(h) {
  if (!h) return "";
  const nm = ROOM_KINDS[h.kind] ? ROOM_KINDS[h.kind].name.toLowerCase() : String(h.kind);
  if (h.kind === "collapse") return "no draft and no sound: a dead end";
  const kind = h.kind === "core" ? `a vast slow beat: the core, the ${BOSS_NAMES.hivemind}` : `${/^[aeiou]/.test(nm) ? "an" : "a"} ${nm}`;
  const n = h.q === "exact" ? (h.n ? `${h.n} of the brood` : "nothing moving") : h.q === "rough" ? (h.hi ? `about ${h.lo}–${h.hi} of the brood` : "silence") : h.lo ? `${h.lo} of the brood or so` : "nothing moving";
  return `${kind}, ${n}`;
}

// ---------- the crawl's record (the State Map, the Goals card) ----------
// What your teams have learned of a hive's den over every visit: hive.crawlRec = { v, deepest (the deepest layer
// reached), mapped ({ room id: 1 }), core (been in it), coreHeard (heard or lit it from a passage), visits, first,
// last (days), grew (the day the den grew deeper and the map started again) }. Old saves: none until a team goes in.
export function crawlRecOf(state, hive) {
  return hive.crawlRec || (hive.crawlRec = { v: 1, deepest: 0, mapped: {}, core: false, coreHeard: false, visits: 0, first: day(state), last: day(state) });
}
function noteRoom(state, hive, room) {
  const r = crawlRecOf(state, hive);
  r.deepest = Math.max(r.deepest, room.layer);
  r.mapped[room.id] = 1;
  if (room.kind === "core") r.core = true;
  r.last = day(state);
}
// The record as the UI shows it, or null: { deepest, depth, mapped, rooms, core, coreHeard, visits, last, grew }.
export function crawlRecord(state, hive) {
  const r = hive && hive.crawlRec;
  if (!r) return null;
  const den = denOf(state, hive);
  const mapped = den.rooms.filter((x) => r.mapped && r.mapped[x.id]).length;
  return { deepest: Math.min(r.deepest || 0, den.depth), depth: den.depth, mapped, rooms: den.rooms.length, core: !!r.core, coreHeard: !!r.coreHeard, visits: r.visits || 0, last: r.last, grew: r.grew ?? null };
}
// "4 of 7 chambers deep · 9 of 23 chambers mapped · core found".
export function crawlRecText(state, hive) {
  const r = crawlRecord(state, hive);
  if (!r) return "";
  return `${r.deepest ? `${r.deepest} of ${r.depth} chambers deep` : `no further than the mouth (${r.depth} deep)`} · ${r.mapped} of ${r.rooms} chambers mapped · ${r.core ? "core found" : r.coreHeard ? "core located" : "core not found"}${r.grew != null && r.mapped <= 1 ? " (it has grown deeper since)" : ""}`;
}
// The Goals card's line: the hives your teams have been inside, deepest first ("Hive name: 4/7 ★").
export function crawlProgressLine(state) {
  const rows = (state.hives || []).map((h) => ({ h, r: crawlRecord(state, h) })).filter((x) => x.r).sort((a, b) => b.r.deepest / b.r.depth - a.r.deepest / a.r.depth);
  if (!rows.length) return "";
  return rows.slice(0, 4).map(({ h, r }) => `${h.name}: ${r.deepest}/${r.depth}${r.core ? " ★" : r.coreHeard ? " ☆" : ""}`).join(" · ") + (rows.length > 4 ? ` · ${rows.length - 4} more` : "");
}
// The AI groups' war parties (groupHiveCrawl): how deep each got, by group id (hive.groupCrawl).
function noteGroupCrawl(hive, fid, reached) {
  if (fid == null) return;
  const g = hive.groupCrawl || (hive.groupCrawl = {});
  g[fid] = Math.max(g[fid] || 0, reached);
}

// A rare gun from the hive's deep (data-guns.js HIVE_GUNS, GUN_SOURCES hive:deep) at chance p, on dice of its own (tag:
// the parts of a hash). Returns a key or null.
/** @param {number} p @param {any[]} tag */
export function hiveDeepGun(p, tag) {
  if (!(p > 0) || hash01(...tag, "deep") >= p) return null;
  return drawGun("hive:deep", hash01(...tag, "deeppick"));
}

// ---------- the core's hoard ----------
// What the hive dragged into its core from the dead (HCRAWL.HOARD), from the world's seed and the hive (its own dice:
// the world's untouched): richer with the tier and the hive's stores. { gear: [items], supplies: { key: qty } }.
export function hiveHoard(state, hive) {
  const H = HCRAWL.HOARD;
  const tier = clamp(hiveTier(state, hive), 0, 4), res = Math.max(0, hive.res || 0);
  const rng = new Rng(seedOf(state.seed, "hoard", hive.id, hive.tile));
  const gear = [];
  let i = 0;
  const add = (key) => { if (!GEAR[key]) return; const src = rng.chance(H.soldier) ? "soldier" : "survivor"; gear.push(lootItem(key, src, [state.seed, "hoard", hive.id, i++])); };
  const nGuns = Math.floor(H.guns.base + H.guns.perTier * tier + res / H.guns.perRes);
  for (let k = 0; k < nGuns; k++) {
    const pool = tier >= 3 && rng.chance(0.3) ? H.guns3 : tier >= 1 && rng.chance(0.35 + 0.15 * tier) ? H.guns2 : H.guns1;
    add(swapGun(pool === H.guns3 ? "hive:hoard3" : pool === H.guns2 ? "hive:hoard2" : "hive:hoard1", rng.pick(pool), rng)); // gundist.js: any gun of the pool's power, by rarity (a hash of the draw)
  }
  // A rare gun the hive dragged in (data-guns.js HIVE_GUNS: hive:deep), more often the older the hive; its own dice.
  const deep = hiveDeepGun(Math.min(0.9, HIVE_GUNS.hoard + HIVE_GUNS.hoardTier * tier), [state.seed, "hoardgun", hive.id, hive.tile]);
  if (deep) add(deep);
  const nArm = Math.floor(H.armour.base + H.armour.perTier * tier + res / H.armour.perRes);
  for (let k = 0; k < nArm; k++) add(rng.pick(H.armourKeys));
  const rare = Math.min(0.9, H.rare[0] + H.rare[1] * tier);
  for (let k = 0; k < (tier >= 3 ? 2 : 1); k++) if (rng.chance(rare)) add(rng.pick(H.rareKeys));
  const nFl = Math.floor(H.flares[0] + H.flares[1] * tier + rng.next());
  for (let k = 0; k < nFl; k++) add("flare");
  const supplies = {
    ammo: Math.round(H.ammo[0] + H.ammo[1] * tier + H.ammo[2] * res), meds: Math.round(H.meds[0] + H.meds[1] * tier + H.meds[2] * res),
    gunparts: Math.round(H.gunparts[0] + H.gunparts[1] * tier), scrap: Math.round(H.scrap[0] + H.scrap[1] * tier),
  };
  for (const k of Object.keys(supplies)) if (!(supplies[k] > 0)) delete supplies[k];
  sortFind(supplies, "home", "hivehoard", hive.tile, hive.id); // ammo.js: the rounds by calibre
  return { gear, supplies };
}
const gearValue = (it) => (it && GEAR[it.key] ? (GEAR[it.key].value || 0) * (it.quality || 1) : 0);
export const HOARD_LAST = { gear: 0, taken: 0, left: 0 }; // the last hoard searched (the tools)
// The team searches the hoard once the Hivemind is dead: what fits goes in its cargo (the most valuable first), the
// rest stays on the hive's tile (a cache on the map: Recover it, like any cargo left behind). Returns the text.
function takeHoard(state, p, hive, c) {
  const h = hiveHoard(state, hive);
  const tally = c ? c.tally : { supplies: {}, gear: [] };
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  let room = cargoRoom(state, p);
  const got = [], leftSup = {}, leftGear = [];
  const takeSup = (k, q) => {
    if (!(q > 0) || !SUPPLIES[k]) return;
    const take = Math.min(q, unitsThatFit(room, k));
    if (take > 0) { p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + take; tally.supplies[k] = (tally.supplies[k] || 0) + take; room -= take * supWeight(k); got.push(`${take} ${SUPPLIES[k].name.toLowerCase()}`); }
    if (q - take > 0) leftSup[k] = q - take;
  };
  takeSup("meds", h.supplies.meds); // the meds first, then the best of the gear, then the rest
  for (const g of [...h.gear].sort((a, b) => gearValue(b) - gearValue(a))) {
    if (room >= itemLoad(g)) { p.cargo.gear.push(g); tally.gear.push(g.name); room -= itemLoad(g); got.push(g.name); } else leftGear.push(g);
  }
  for (const [k, q] of Object.entries(h.supplies)) if (k !== "meds") takeSup(k, q);
  const left = [...Object.entries(leftSup).map(([k, q]) => `${q} ${SUPPLIES[k].name.toLowerCase()}`), ...leftGear.map((g) => g.name)];
  if (left.length) leaveCache(state, hive.tile, leftSup, leftGear);
  HOARD_LAST.gear = h.gear.length; HOARD_LAST.taken = got.length; HOARD_LAST.left = left.length;
  return `In the dead core lies the hive's hoard, what it dragged in from the dead: ${got.length ? `the team takes ${got.join(", ")}` : "the team has no room for any of it"}${left.length ? `; the rest (${left.slice(0, 6).join(", ")}${left.length > 6 ? ` and ${left.length - 6} more` : ""}) is left at the hive, marked on the map (Recover it)` : ""}.`;
}
// AI parity: a group whose war party burned a hive out takes the hoard into its stores (coarse: the rounds into its
// one count, meds, scrap and gun parts into f.stock, its guns and armour into the group's arsenal, arsenal.js).
// Returns { items, rounds }.
export function groupTakeHoard(state, f, hive) {
  const h = hiveHoard(state, hive);
  let rounds = 0;
  f.stock = f.stock || {};
  for (const [k, q] of Object.entries(h.supplies)) {
    if (!(q > 0)) continue;
    if (k === "meds" || k === "scrap" || k === "gunparts") f.stock[k] = (f.stock[k] || 0) + q;
    else if (/^a_/.test(k)) rounds += q;
  }
  addArsenalRounds(f, rounds);
  let items = 0;
  for (const it of h.gear) if (addToArsenal(state, f, it, "hive hoard")) items++;
  return { items, rounds };
}

// Move to a chamber next to this one (an hour): deeper, round, or back toward a mouth (into a mouth: then Leave by
// this mouth). A chamber the team has been in: one it cleared may have filled again with the noise it made there
// (refillOnReturn), and the brood it crept past is in front of it again.
export function moveTo(state, p, id) {
  const c = hiveCrawlOf(state, p);
  if (!c) return "The team is not in a hive.";
  if (c.enc) return "Deal with what is in front of you first.";
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const here = roomById(den, c.at);
  const to = roomById(den, id);
  if (!to || !here.links.includes(id)) return "No passage leads there.";
  if (!canMoveOn(state, c) && id !== c.from) return "The brood is still in this chamber: fight it, creep past, or go back the way you came.";
  // Into a chamber it has not been in: noise (lights: the brood sees them coming; the noise is the chamber walked
  // into's). Back through ones it has (2026-10-13): quiet, as the walk out always was before leaving became a walk (a
  // noisy walk back roused the deep hives on the way out: tools/crawlbalance.js, a rifle squad at tier 4 wiped 2 in 8).
  if (!c.visited[to.id]) addAlert(c, HCRAWL.ALERT.move + (lightsOn(state, p, c) ? HCRAWL.LIGHT.move : 0), to.id);
  if (!passHours(state, p, HCRAWL.MOVE_HOURS)) return goneText(state, p);
  if (!p.hiveCrawl) return "";
  if (c.enc) return ""; // the brood came for you on the way (converge)
  if (to.kind === "pool") wormSearch(state, p, c.tile, HCRAWL.POOL_WORM); // worm.js: wading through it
  if (c.visited[to.id]) { refillOnReturn(state, c, hive, den, to); delete c.slipped[to.id]; }
  enterRoom(state, p, c, to, here.id);
  return "";
}

// ---------- in front of the team ----------
// The fight's setup for an encounter: a chamber's brood, a swarm, the turned, or the core.
function encSetup(state, p, c, e) {
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const room = roomById(den, e.room) || roomById(den, c.at);
  if (e.kind === "core") return coreSetup(state, p, hive, true);
  const f = e.enemy || roomForce(state, hive, room);
  const count = e.kind === "brood" ? alliedThin(f.count, hiveAllies(state, hive).fighters) : f.count;
  const K = ROOM_KINDS[room.kind] || ROOM_KINDS.tunnel;
  return {
    tile: hive.tile, partyId: p.id, ambush: e.spotted ? "enemy" : null, canRetreat: true, handler: "hiveChamber", layout: "hivechamber",
    enemy: { kind: "zombies", count: Math.max(1, count), power: Math.round(f.power * darkMult(state, p) * 10) / 10, types: f.types && count !== f.count ? broodTypes(state, hive, count, room.layer) : f.types, elite: !!f.elite, name: f.name },
    aiStyle: tacticalStyleFor(state, p), // played headless: the team's retreat policy (breakoff.js)
    context: { hiveCrawl: { hiveId: hive.id, room: room.id, kind: e.kind, size: K.size, layer: room.layer, warmth: warmthOf(den, room), met: count } },
  };
}
// By the numbers the dark counts for the brood in a chamber: its power × (1 + LIGHT.numbers × the share of the team
// without a light). Not in the core: its fight by the numbers is fitted to the map (HIVEMIND.numbersK) as the
// autopilot's real teams fought it, and the autopilot's gate for it (AUTO.coreOdds) sits right at that fit.
export function darkMult(state, p) {
  const m = partyMembers(state, p);
  return m.length ? 1 + HCRAWL.LIGHT.numbers * (1 - teamLights(state, p) / m.length) : 1;
}
// The odds and the answers to what is in front of the team (the window and the autopilot).
export function encounterOptions(state, p) {
  const c = hiveCrawlOf(state, p);
  const e = c && c.enc;
  if (!e || e.fighting) return [];
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const room = roomById(den, e.room) || roomById(den, c.at);
  const setup = encSetup(state, p, c, e);
  const odds = byNumbersOdds(state, setup);
  const out = [];
  if (e.kind === "core") {
    const prep = corePrep(state, partyMembers(state, p), p);
    const weak = ` Its weak spots: fire (a Molotov on it burns it ${HIVEMIND.WEAK.burnDmg[0]}–${HIVEMIND.WEAK.burnDmg[1]} a turn and the walls give up no brood while it burns) and a bang (a flashbang or a grenade next to it: no pulse, no lash, no brood and its flesh open for a turn or more). You carry ${prep.fire} Molotov${prep.fire === 1 ? "" : "s"} and ${prep.stun} flashbang${prep.stun === 1 ? "" : "s"} or grenade${prep.stun === 1 ? "" : "s"}${prep.lit < 1 ? `; ${Math.round((1 - prep.lit) * partyMembers(state, p).length)} of you without a light in its dark` : ""}.`;
    out.push({ id: "fight", label: `Fight the ${BOSS_NAMES.hivemind} (battle map)`, tip: `The core room: ${setup.enemy.count} of the brood, the ${BOSS_NAMES.hive} and the ${BOSS_NAMES.hivemind} (it never moves: it pulses, lashes out and calls brood out of the walls). Kill it and the hive dies, its brood with it. By the numbers about ${Math.round(odds.win * 100)}%.${weak}`, odds: odds.win });
    out.push({ id: "numbers", label: "Fight it by the numbers", tip: `Quick: about ${Math.round(odds.win * 100)}% to win. A lost fight here can cost everyone.`, odds: odds.win });
  } else {
    out.push({ id: "fight", label: "Fight (battle map)", tip: `Fight the brood in ${roomThe(room)}. By the numbers you would win about ${Math.round(odds.win * 100)}%. Noise: Alert +${HCRAWL.ALERT.mapFight} and more with every shot.`, odds: odds.win });
    out.push({ id: "numbers", label: "Fight by the numbers", tip: `Quick: about ${Math.round(odds.win * 100)}% to win (Alert +${HCRAWL.ALERT.fight}).`, odds: odds.win });
    if (e.kind !== "turned") { const s = sneakOdds(state, p, c, room, e); out.push({ id: "sneak", label: e.kind === "swarm" ? "Hide from them" : "Creep past", tip: `Stealth ${bestSkill(state, p, "stealth")} + d10 against ${s.dc}: about ${Math.round(s.p * 100)}%. An hour. Fail and they fall on you first (Alert +${HCRAWL.ALERT.sneakFail}).${e.kind === "brood" ? " Past them you can go on, but they stay: on the way back you meet them again." : ""}`, odds: s.p }); }
  }
  // Fall back: one chamber back, the way you came. Get out: only at a mouth (leaving is a walk to one).
  if (backOf(c, den, room, e.back)) out.push({ id: "back", label: "Fall back", tip: `Back to the chamber you came from (an hour): each of you about ${Math.round(backHurt(room) * 100)}% to be hurt getting away.`, odds: 1 });
  if (isMouth(den, room.id)) out.push({ id: "out", label: "Get out of the hive", tip: `Back out through ${roomThe(room)}: each of you about ${Math.round(backHurt(room) * 100)}% to be hurt getting away.`, odds: 1 });
  return out;
}
const backHurt = (room) => Math.min(0.9, HCRAWL.BACK.hurt + HCRAWL.BACK.perLayer * (room ? room.layer : 0));
export function sneakOdds(state, p, c, room, e = c.enc) {
  const S = HCRAWL.SNEAK;
  const n = partyMembers(state, p).length;
  const dc = Math.ceil(S.dc + S.perLayer * room.layer + roomHeat(state, c, room) * S.perAlert + Math.max(0, n - 3) * S.big + (e && e.spotted ? S.spotted : 0) + (lightsOn(state, p, c) ? HCRAWL.LIGHT.sneak : 0));
  return { dc, p: clamp((bestSkill(state, p, "stealth") + 10 - dc + 1) / 10, 0, 1) };
}
// The answer. opts.map: a fight on the battle map (the browser), else by the numbers.
export function resolveHiveEnc(state, p, choice, opts = {}) {
  const c = hiveCrawlOf(state, p);
  if (!c || !c.enc) return "Nothing to answer.";
  const e = c.enc;
  if (e.fighting) return "The fight is on.";
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const room = roomById(den, e.room) || roomById(den, c.at);
  const rng = state.rng;
  if (choice === "fight" || choice === "numbers") {
    if (e.kind === "core") { c.enc = { ...e, fighting: true }; assaultHive(state, p, hive, { map: choice === "fight" && opts.map, quick: choice === "numbers" }); return ""; }
    const setup = encSetup(state, p, c, e);
    c.enc = { ...e, fighting: true };
    if (choice === "fight" && opts.map && typeof window !== "undefined" && !state.autoCombat && !state.combat) { onFoot(p, () => startCombat(state, setup)); return ""; }
    const res = crawlByNumbers(state, setup);
    finishCombat(state, setup, res);
    return res.outcome === "victory" ? "The chamber is yours." : res.outcome === "retreat" ? "You broke off and fell back." : "It went badly.";
  }
  if (choice === "sneak") {
    const s = sneakOdds(state, p, c, room, e);
    if (!passHours(state, p, HCRAWL.SNEAK_HOURS)) return goneText(state, p);
    if (!p.hiveCrawl) return "";
    if (rng.chance(s.p)) {
      gainXpAll(state, partyMembers(state, p), "stealth", USE.sneakSearch);
      c.enc = null;
      if (e.kind === "brood") { c.slipped[room.id] = true; say2(c, `You creep along the wall of ${roomThe(room)} past the brood. They never turn.`, "good", state.hour); }
      else say2(c, "You press into a fold of the wall and they flow past you.", "good", state.hour);
      return "You got past.";
    }
    addAlert(c, HCRAWL.ALERT.sneakFail);
    c.enc = { ...e, spotted: true };
    say2(c, "They have seen you! No slipping away now.", "danger", state.hour);
    return "They saw you.";
  }
  if (choice === "back" || choice === "out") {
    const to = choice === "back" ? backOf(c, den, room, e.back) : null;
    if (choice === "out" ? !isMouth(den, room.id) : !to) return choice === "out" ? "No way out from here: the mouths are the way out." : "Nowhere to fall back to.";
    const hit = [];
    for (const s of partyMembers(state, p)) {
      if (!rng.chance(backHurt(room))) continue;
      hurt(state, s, rng.int(HCRAWL.BACK.dmg[0], HCRAWL.BACK.dmg[1]) + room.layer, c.tile, `falling back through ${hive.name}`);
      hit.push(s.alive ? first(s) : `${s.name} (killed)`);
      if (!s.alive) c.lost.push(s.name);
    }
    say2(c, `You fall back.${hit.length ? ` Hurt on the way: ${hit.join(", ")}.` : " Everyone gets clear."}`, hit.length ? "danger" : "info", state.hour);
    if (!partyMembers(state, p).length) { crawlWiped(state, p, ""); return "Nobody got away."; }
    c.enc = null;
    if (!passHours(state, p, HCRAWL.BACK_HOURS)) return goneText(state, p);
    if (!p.hiveCrawl) return "";
    if (choice === "out") return outOf(state, p, c, den, room, "The team fell back out of the hive.");
    const back = roomById(den, to);
    fallBackTo(state, c, hive, den, back, room.id);
    if (broodLeft(state, hive, back) > 0 && !c.slipped[back.id]) enterRoom(state, p, c, back, c.from); // it filled again behind you
    return "You fell back.";
  }
  return "Unknown choice.";
}
// A fight in the hive by the numbers (a chamber's brood, a swarm, the core): the odds as byNumbersOdds gives them, the
// blood fitted to the cave map (NUMBERS). A lost fight: the team breaks off and gets out of the chamber (retreat) with
// what it costs. Returns a result for combat.js finishCombat.
export function crawlByNumbers(state, setup) {
  const N = HCRAWL.NUMBERS, rng = state.rng;
  const p = partyById(state, setup.partyId);
  const people = p ? partyMembers(state, p).filter((s) => s.alive) : [];
  if (!people.length) return autoResolveCombat(state, setup);
  settleParty(state, p); // ammo.js: rounds by calibre
  const pools = [p.supplies, p.cargo ? p.cargo.supplies : {}];
  const drawn = drawTeamShots(pools, people, Math.min(people.length * 6, Math.ceil(setup.enemy.count * N.shots)));
  const odds = byNumbersOdds(state, setup, people, /** @type {any} */ ({ ammo: drawn.used, arrows: 0 })); // the rounds drawn, by calibre (as autoResolveCombat)
  const win = rng.chance(odds.win);
  let dmg = Math.min(N.cap, N.k * Math.max(0.05, odds.ratio) ** -N.exp) * rng.range(0.6, 1.4);
  if (!win) dmg = Math.max(dmg, N.lost * clamp(1 / Math.max(0.05, odds.ratio), 0.6, 1.3)) * rng.range(0.9, 1.2);
  if (setup.ambush === "enemy") dmg *= N.ambush;
  const tile = partyTile(p);
  const cause = `in a fight with ${setup.enemy.name}`;
  const hurtIds = new Set(), deadIds = [];
  while (dmg >= 1) {
    const left = people.filter((s) => s.alive);
    if (!left.length) break;
    const s = rng.pick(left);
    const blow = Math.min(Math.round(dmg), rng.int(N.blow[0], N.blow[1]));
    dmg -= blow;
    hurt(state, s, blow, tile, cause);
    if (s.alive) { absorbOffscreen(s, blow, "zombies", state); hurtIds.add(s.id); } else if (!deadIds.includes(s.id)) deadIds.push(s.id);
  }
  fightXp(state, people, win);
  const count = setup.enemy.count;
  const killed = win ? count : Math.floor(count * rng.range(0.2, 0.6));
  const standing = people.some((s) => s.alive);
  return {
    outcome: win ? "victory" : standing ? "retreat" : "defeat", enemiesKilled: killed, enemiesLeft: count - killed,
    survivorsHurt: [...hurtIds].filter((id) => !deadIds.includes(id)), survivorsDead: deadIds, ammoUsed: drawn.n, arrowsUsed: 0, loot: { supplies: {}, gear: [] }, odds: odds.win,
  };
}
// A battle with the team's vehicle left at the mouth (none on a cave map).
function onFoot(p, fn) { const v = p.vehicle; p.vehicle = null; try { return fn(); } finally { p.vehicle = v; } }

// A chamber fight is over (combat.js finishCombat): on the map or by the numbers.
registerCombatHandler("hiveChamber", (state, result, setup, battle) => {
  const p = partyById(state, setup.partyId);
  const ctx = (setup.context && setup.context.hiveCrawl) || {};
  const hive = hiveById(state, ctx.hiveId);
  const killed = Math.min(result.enemiesKilled || 0, ctx.met || setup.enemy.count);
  if (hive) {
    const den = denOf(state, hive);
    const room = roomById(den, ctx.room);
    if (room && ctx.kind === "brood") {
      const left = broodLeft(state, hive, room);
      setLeft(state, hive, room, result.outcome === "victory" ? 0 : Math.max(0, left - killed));
    }
    cutGuard(state, hive, killed);
    hive.playerDay = day(state);
    markThreat(state, hive);
  }
  if (!p || !state.parties.includes(p)) return;
  if (!partyMembers(state, p).length) { crawlWiped(state, p, `Killed by ${setup.enemy.name}.`); return; }
  const c = p.hiveCrawl;
  if (!c) { awaitOrders(state, p, "The team is out of the fight."); return; }
  c.kills += killed;
  for (const id of result.survivorsDead || []) { const s = survivorById(state, id); if (s) c.lost.push(s.name); }
  addAlert(c, battle ? HCRAWL.ALERT.mapFight + (result.ammoUsed || battle.gunshots || 0) / 20 : HCRAWL.ALERT.fight);
  const dead = (result.survivorsDead || []).map((id) => survivorById(state, id)?.name).filter(Boolean);
  const won = result.outcome === "victory";
  say2(c, `Fight with ${setup.enemy.name}${result.odds != null ? ` (${Math.round(result.odds * 100)}% odds)` : ""}: ${won ? "won" : result.outcome === "retreat" ? "broke off" : "lost"} (${killed} killed).${dead.length ? ` Killed: ${dead.join(", ")}.` : ""}`, won ? "good" : "danger", state.hour);
  const e = c.enc || { kind: ctx.kind, room: ctx.room, back: c.from };
  c.enc = null;
  if (!hive) { finishHiveCrawl(state, p, GONE_TEXT); return; } // gone while the team fought
  if (!passHours(state, p, HCRAWL.FIGHT_HOURS)) { goneText(state, p); return; }
  if (!p.hiveCrawl) return;
  if (won) return;
  // Broken off or beaten back: to the chamber the team came from, or out of the hive at a mouth.
  const den = denOf(state, hive);
  const room = roomById(den, e.room) || roomById(den, c.at);
  const back = room && backOf(c, den, room, e.back);
  if (!back) { if (room && isMouth(den, room.id)) outOf(state, p, c, den, room, "Beaten back, the team stumbled out of the hive."); return; } // else it stands its ground where it is
  fallBackTo(state, c, hive, den, roomById(den, back), room.id);
  say2(c, `You fall back to ${roomThe(roomById(den, back))}.`, "danger", state.hour);
});

// ---------- in a chamber ----------
// What the team can do in its chamber besides moving: [{ id, label, tip, disabled }].
export function roomActions(state, p) {
  const c = hiveCrawlOf(state, p);
  if (!c || c.enc) return [];
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const room = roomById(den, c.at);
  const K = ROOM_KINDS[room.kind] || {};
  const clear = broodLeft(state, hive, room) === 0;
  const mem = memOf(hive);
  const out = [];
  if (K.burn) {
    const burned = mem.rooms[room.id] && mem.rooms[room.id].burned;
    const fuel = partyFuel(state, p), bombs = molotovsOf(state, p).length;
    const g = room.kind === "growth" ? growthById(state, room.gid) : null;
    const what = room.kind === "eggs" ? "the eggs" : g ? `the root of the ${GROWTHS[g.kind].name.toLowerCase()}` : "the withered root";
    const can = clear && !burned && (bombs >= HCRAWL.BURN.molotovs || fuel >= HCRAWL.BURN.fuel) && (room.kind === "eggs" || !!g);
    out.push({ id: "burn", label: `Burn ${what}`, disabled: !can,
      tip: !clear ? "Not with the brood still in the chamber." : burned ? "Burned already." : room.kind === "growth" && !g ? "The growth it fed is gone." : `${bombs >= HCRAWL.BURN.molotovs ? `${HCRAWL.BURN.molotovs} Molotov` : `${HCRAWL.BURN.fuel} fuel`} (the team has ${fuel} fuel, ${bombs} Molotovs). ${room.kind === "eggs" ? `The hive loses ${HCRAWL.BURN.res} of its stores and some of its guard, and its chambers fill again more slowly.` : `${HCRAWL.BURN.growth} damage to the growth above (it has ${Math.round(g ? g.hp ?? 100 : 0)}).`} Loud: Alert +${HCRAWL.ALERT.burn}, and the brood nearby may come.` });
  }
  if (K.search) {
    const done = !!mem.searched[`${room.id}:${c.visit}`] || (room.kind === "bones" && !!mem.searched[room.id]);
    out.push({ id: "search", label: room.kind === "bones" ? "Search the bones" : "Feel through the pool", disabled: !clear || done,
      tip: !clear ? "Not with the brood still in the chamber." : done ? "Searched." : room.kind === "bones" ? "An hour among the remains of the teams that came before: their guns, armour and packs (worn), ammunition and meds." : "An hour up to the elbows in the black water: now and then something someone dropped. The worm's eggs are thick here." });
  }
  const tend = partyMembers(state, p).filter((s) => fieldTreatInfo(state, p, s).ok);
  out.push({ id: "treat", label: `Tend the wounded (${HCRAWL.TREAT_HOURS} h)`, disabled: !tend.length,
    tip: tend.length ? `Field treatment with the team's meds for ${tend.map(first).join(", ")} (each once a day: medical.js, as on the road).` : "Nobody the team can treat here now (not hurt, treated today, or no meds)." });
  out.push({ id: "lie", label: `Lie still (${HCRAWL.LIE_HOURS} h)`, disabled: false, tip: `Wait in the dark: the Alert falls by ${HCRAWL.ALERT.lie + HCRAWL.ALERT.decay * HCRAWL.LIE_HOURS}. ${c.alert >= 40 ? "Something may still find you." : ""}` });
  // At a mouth: out of the hive (leaving is a walk to any of the four; nothing walks the team out on its own).
  if (isMouth(den, room.id)) out.push({ id: "out", label: "Leave by this mouth", disabled: !canMoveOn(state, c), tip: canMoveOn(state, c) ? `Step out of ${roomThe(room)} into the daylight: the crawl ends here.` : "The brood is still in the mouth." });
  return out;
}
export function roomAct(state, p, id) {
  const c = hiveCrawlOf(state, p);
  if (!c) return "The team is not in a hive.";
  if (c.enc) return "Deal with what is in front of you first.";
  const act = roomActions(state, p).find((a) => a.id === id);
  if (!act || act.disabled) return act ? act.tip : "Not here.";
  if (id === "burn") return burnRoom(state, p, c);
  if (id === "search") return searchRoom(state, p, c);
  if (id === "lie") return lieStill(state, p, c);
  if (id === "treat") return tendWounded(state, p, c);
  if (id === "out") return outOf(state, p, c, denOf(state, crawlHive(state, c)), crawlRoom(state, c));
  return "";
}
function burnRoom(state, p, c) {
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const room = roomById(den, c.at);
  const bombs = molotovsOf(state, p);
  if (bombs.length >= HCRAWL.BURN.molotovs) for (const b of bombs.slice(0, HCRAWL.BURN.molotovs)) b.take();
  else useFuel(state, p, HCRAWL.BURN.fuel);
  const mem = memOf(hive);
  mem.rooms[room.id] = { ...(mem.rooms[room.id] || { left: 0, at: state.hour }), burned: true };
  let text;
  if (room.kind === "eggs") {
    hive.res = Math.max(0, hive.res - HCRAWL.BURN.res);
    const g = hiveGuard(state, hive);
    if (g) reduceHorde(state, g, Math.round(g.size * HCRAWL.BURN.guard));
    mem.eggsBurned = state.hour;
    text = "The sacs blister and burst. The stink of burning brood fills the tunnels; the hive will be slower to fill its chambers.";
  } else {
    const g = growthById(state, room.gid);
    if (g) {
      g.hp = Math.max(0, (g.hp ?? 100) - HCRAWL.BURN.growth);
      if (g.hp <= 0) { destroyGrowth(state, g, "from inside its hive"); text = `The root chars and splits. Above you the ${GROWTHS[g.kind].name.toLowerCase()} shrivels.`; }
      else text = `The root blackens: the ${GROWTHS[g.kind].name.toLowerCase()} above is hurt (${Math.round(g.hp)}% left) and will grow back.`;
    } else text = "Nothing left to burn.";
  }
  markThreat(state, hive);
  hive.playerDay = day(state);
  addAlert(c, HCRAWL.ALERT.burn);
  say2(c, text, "good", state.hour);
  if (!passHours(state, p, HCRAWL.BURN_HOURS)) return goneText(state, p);
  if (!p.hiveCrawl || c.enc) return text;
  if (state.rng.chance(HCRAWL.BURN.wake)) {
    const n = clamp(Math.round(2 + room.layer * 0.6), 2, 10);
    c.enc = { kind: "swarm", room: room.id, back: c.from, spotted: true, enemy: { kind: "zombies", count: n, power: roomPower(state, hive, den, room), types: broodTypes(state, hive, n, room.layer), elite: false, name: "the brood the fire woke" } };
    say2(c, `The fire draws them: ${n} of the brood come through the smoke.`, "danger", state.hour);
  }
  return text;
}
function searchRoom(state, p, c) {
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const room = roomById(den, c.at);
  const rng = state.rng;
  const mem = memOf(hive);
  const B = HCRAWL.BONES;
  let text;
  if (room.kind === "bones") {
    mem.searched[room.id] = true;
    const gear = [];
    const n = rng.int(B.items[0], B.items[1]) + (room.layer >= 4 ? 1 : 0);
    for (let i = 0; i < n; i++) gear.push(lootItem(swapGun("hive:bones", rng.pick(B.keys), rng), "survivor", spend(rng))); // itemcond.js: worn, as the dead left it; gundist.js: which gun
    // Deeper in, now and then a rare gun among the bones (data-guns.js HIVE_GUNS: hive:deep; its own dice).
    const L = room.layer || 0, deep = L >= HIVE_GUNS.from ? hiveDeepGun(Math.min(HIVE_GUNS.max, HIVE_GUNS.p + HIVE_GUNS.perLayer * (L - HIVE_GUNS.from)), [state.seed, "hivedeep", hive.id, room.id]) : null;
    if (deep) gear.push(lootItem(deep, "soldier", [state.seed, "hivedeepq", hive.id, room.id]));
    const sup = sortFind({ ammo: rng.int(B.ammo[0], B.ammo[1]), meds: rng.int(B.meds[0], B.meds[1]) }, "home", "hivebones", c.tile, state.hour); // ammo.js: rounds by calibre
    text = `Among the bones: ${give(state, p, c, sup, gear)}.`;
  } else {
    mem.searched[`${room.id}:${c.visit}`] = true;
    wormSearch(state, p, c.tile, HCRAWL.POOL_WORM * 2); // worm.js: hands in the black water
    text = rng.chance(0.4) ? `Something under the water: ${give(state, p, c, {}, [lootItem(swapGun("hive:bones", rng.pick(B.keys), rng), "survivor", spend(rng))])}.` : "Nothing but slime and worms.";
  }
  addAlert(c, HCRAWL.ALERT.search);
  gainXpAll(state, partyMembers(state, p), "scavenging", USE.searchHour);
  say2(c, text, "good", state.hour);
  if (!passHours(state, p, HCRAWL.SEARCH_HOURS)) return goneText(state, p);
  return text;
}
function tendWounded(state, p, c) {
  const done = [];
  for (const s of [...partyMembers(state, p)].sort((a, b) => a.health - b.health)) {
    if (!fieldTreatInfo(state, p, s).ok) continue;
    const before = s.health;
    fieldTreat(state, p, s.id);
    if (s.health > before) done.push(`${first(s)} +${Math.round(s.health - before)}`);
  }
  const text = done.length ? `You tend the wounded in the dark: ${done.join(", ")}.` : "Nobody could be treated.";
  say2(c, text, done.length ? "good" : "info", state.hour);
  if (!passHours(state, p, HCRAWL.TREAT_HOURS)) return goneText(state, p);
  return text;
}
function lieStill(state, p, c) {
  addAlert(c, -HCRAWL.ALERT.lie);
  coolHeat(c, c.at, HCRAWL.ALERT.lie); // the chamber settles too
  const here = crawlRoom(state, c);
  const heat = here ? roomHeat(state, c, here) : c.alert; // HCRAWL.THREAT: a patrol by the heat in the chamber
  const risk = heat >= 40 ? Math.min(0.5, 0.05 + heat / 500) : 0;
  if (!passHours(state, p, HCRAWL.LIE_HOURS)) return goneText(state, p);
  if (!p.hiveCrawl || c.enc) return "";
  if (state.rng.chance(risk)) {
    const hive = crawlHive(state, c);
    const den = denOf(state, hive);
    const room = roomById(den, c.at);
    const n = clamp(Math.round(2 + room.layer * 0.5), 2, 8);
    c.enc = { kind: "swarm", room: room.id, back: c.from, spotted: true, enemy: { kind: "zombies", count: n, power: roomPower(state, hive, den, room), types: broodTypes(state, hive, n, room.layer), elite: false, name: "a brood patrol" } };
    say2(c, `A brood patrol stumbles onto you in the dark: ${n} of them.`, "danger", state.hour);
    return "";
  }
  const text = `You lie still in the dark for ${HCRAWL.LIE_HOURS} hours. Alert ${alertName(c.alert)} (${Math.round(c.alert)}).`;
  say2(c, text, "info", state.hour);
  return text;
}
// Things found go into the team's cargo while there is room (as the city crawl's).
function give(state, p, c, sup = {}, gear = []) {
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  let room = cargoRoom(state, p);
  const got = [], left = [];
  for (const [k, q] of Object.entries(sup)) {
    if (!(q > 0) || !SUPPLIES[k]) continue;
    const take = Math.min(q, unitsThatFit(room, k));
    if (take > 0) { p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + take; c.tally.supplies[k] = (c.tally.supplies[k] || 0) + take; room -= take * supWeight(k); got.push(`${take} ${keyWord(k)}`); }
    if (q - take > 0) left.push(`${q - take} ${keyWord(k)}`);
  }
  for (const g of gear) {
    if (!g) continue;
    if (room >= itemLoad(g)) { p.cargo.gear.push(g); c.tally.gear.push(g.name); room -= itemLoad(g); got.push(g.name); } else left.push(g.name);
  }
  return `${got.length ? got.join(", ") : "nothing useful"}${left.length ? ` (no room for ${left.join(", ")})` : ""}`;
}

// ---------- the crawl's end ----------
// opts.orders false: the team's orders wait (crawlGone, while its battle is on); opts.side: the mouth it came out by.
/** @param {any} state @param {any} p @param {string} [extra] @param {{ orders?: boolean, side?: string }} [opts] */
export function finishHiveCrawl(state, p, extra = "", opts = {}) {
  const c = p.hiveCrawl;
  if (!c) return "";
  const hive = crawlHive(state, c);
  if (hive) { const mem = memOf(hive); mem.lastAlert = c.alert; mem.lastHour = state.hour; }
  delete p.hiveCrawl;
  const got = [...Object.entries(c.tally.supplies).map(([k, v]) => `${v} ${SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : k}`), ...c.tally.gear];
  const den = hive ? denOf(state, hive) : null;
  const text = `${extra ? extra + " " : ""}Out of ${c.name}${opts.side ? ` by its ${opts.side} mouth` : ""} after ${state.hour - c.started} h, ${c.deepest ? `${c.deepest} chamber${c.deepest === 1 ? "" : "s"} deep${den ? ` of ${den.depth}` : ""}` : "no deeper than the mouth"}, ${c.kills} of the brood killed${got.length ? `, with ${got.join(", ")}` : ""}.${c.lost.length ? ` Lost: ${c.lost.join(", ")}.` : ""}`;
  log(state, `${teamName(state, p)}: ${text}`, c.lost.length ? "danger" : "info");
  if (state.parties.includes(p)) { p.seen.set(c.tile, snapshot(state, c.tile)); if (opts.orders !== false) awaitOrders(state, p, text); }
  return text;
}
function crawlWiped(state, p, line) {
  const c = p.hiveCrawl;
  delete p.hiveCrawl;
  if (c) log(state, `${line ? line + " " : ""}The team died in ${c.name}, ${c.deepest ? `${c.deepest} chamber${c.deepest === 1 ? "" : "s"} deep` : "at its mouth"}. What they carried lies in the hive.`, "death");
  wipeParty(state, p);
}
function goneText(state, p) {
  if (state.parties.includes(p) && !partyMembers(state, p).length) crawlWiped(state, p, "");
  return "The team is gone.";
}
// One of the team died with the worm in them inside (worm.js): one more of the dead in front of the team.
export function hiveCrawlTurned(state, p, s) {
  const c = hiveCrawlOf(state, p);
  if (!c) return false;
  if (c.enc && !c.enc.fighting && c.enc.kind !== "core") {
    const e = c.enc;
    const base = e.enemy || roomForce(state, crawlHive(state, c), crawlRoom(state, c));
    c.enc = { ...e, kind: e.kind === "brood" ? "swarm" : e.kind, enemy: { ...base, count: (base.count || 0) + 1 } };
  } else if (!c.enc) c.enc = { kind: "turned", room: c.at, back: c.from, spotted: true, enemy: { kind: "zombies", count: 1, power: 3, types: null, elite: false, name: `${first(s)} (turned)` } };
  addAlert(c, 6);
  say2(c, `${s.name} died with the worm in them and got up again among you.`, "danger", state.hour);
  return true;
}

// ---------- the core: the Hivemind ----------
// The fight in the core room (also the old storm's entry point, for the tools): the brood left there, the Broodmother
// and the Hivemind. opts.map: on the battle map in the browser; opts.quick: by the numbers; else fightNow (headless:
// played out by the AI on both sides, as the old storm was).
// numbers: the setup for a fight by the numbers (the bosses folded into the brood's power: byNumbersOdds counts
// count × power); on the map the brood keeps its own power and the bosses are units (the layout).
// By the numbers the bosses count × coreBossMult: the team's lights and what it brings for the Hivemind's weak spots.
export function coreSetup(state, p, hive, numbers = false) {
  const f = coreForce(state, hive);
  const allies = hiveAllies(state, hive);
  const count = f.count ? broodAfterAllies(f.count, allies.fighters) : 0;
  const n = Math.max(1, count);
  const boss = numbers ? f.bossPower * coreBossMult(corePrep(state, partyMembers(state, p), p)) : 0;
  return {
    tile: hive.tile, partyId: p.id, ambush: null, canRetreat: true, handler: "hiveAssault", layout: "hivecore",
    enemy: { kind: "zombies", count: n, power: numbers ? Math.round(((count * f.power + boss) / n) * 10) / 10 : f.power, types: f.types, elite: !!f.elite, name: `the core of ${hive.name}`, brood: count, broodPower: f.power, hp: f.hp },
    ...(numbers ? { mineMult: coreFire(partyMembers(state, p)).mult } : {}), // by the numbers: the team's fire at the core (coreFire)
    aiStyle: coreStyle(state, p), // the core's brood keeps coming out of the walls: no Aggressive last stand there
    context: { hiveId: hive.id, partyId: p.id, crawl: !!p.hiveCrawl, tier: f.tier, warmth: 100, met: count, allies: allies.fighters },
  };
}
// The style the AI fights the core in, played headless: the team's own retreat policy, else the autopilot's style but
// never Aggressive (it holds on until two thirds are down, and the Hivemind's brood never stops coming).
function coreStyle(state, p) {
  const own = tacticalStyleFor(state, p);
  if (own) return own;
  const gov = state.autopilot && state.governor ? state.governor.personality : null;
  return gov === "aggressive" ? "balanced" : gov || undefined;
}
// What a team brings to the core for the Hivemind: { lit (share of the people with a light), fire (Molotovs), stun
// (flashbangs, frag grenades, pipe bombs) }. people: who fights; p: their team (its cargo), or null. extra: { lights,
// fire, stun } the autopilot would pack from the armory (coreGate).
const FIRE_KEYS = ["molotov"], STUN_KEYS = ["flashbang", "frag", "pipebomb"];
export function corePrep(state, people, p = null, extra = {}) {
  const n = people.length || 1;
  const lit = Math.min(n, people.filter((s) => !!lightOf(s)).length + (extra.lights || 0));
  let fire = extra.fire || 0, stun = extra.stun || 0;
  for (const s of people) for (const x of carriedSpots(s)) { const k = x.item && x.item.key; if (FIRE_KEYS.includes(k)) fire++; else if (STUN_KEYS.includes(k)) stun++; }
  for (const it of (p && p.cargo && p.cargo.gear) || []) { if (!it) continue; if (FIRE_KEYS.includes(it.key)) fire++; else if (STUN_KEYS.includes(it.key)) stun++; }
  return { lit: lit / n, fire, stun };
}
// The bosses' power by the numbers × this (HIVEMIND.NUMBERS).
export function coreBossMult(prep) {
  const N = HIVEMIND.NUMBERS;
  return (1 - N.lit * prep.lit) * Math.max(N.floor ?? 0.3, 1 - N.fire * Math.min(1, prep.fire / N.kit) - N.stun * Math.min(1, prep.stun / N.kit));
}
// The core's fire by the numbers (coreSetup, coreGate: × the team's power; tools/hivecorecalib.js --fit, 2026-10-10).
// The core is a long fight at range: on the map six hunting rifles beat a tier-2 core where six pump shotguns of the
// same combat power lost nearly every time, and axes never won. So by the numbers each fighter counts × coreFire:
//   reach: at the core's range (REACH.range tiles: the Hivemind sits back in its chamber and its pulse keeps a team off)
//     the aim a gun loses past its best range (combat.js shotOdds: (range − opt) × fall, out of the shooter's own aim
//     40 + 2.5 × Shooting + the gun's), × its load's spread there (data-ammo.js spreadMult: 00 buckshot 0.8 at 6
//     tiles); a melee weapon (or none) REACH.melee: it has to cross the pulse and the brood to strike;
//   sustain: of a long fight's REACH.shots shots, the share of the actions spent shooting, not reloading: a magazine
//     swap takes one for a magazine's worth; an internal magazine (data-kit.js INTERNAL: a tube, a cylinder, a bolt's
//     box) one for each MAGS.LOOSE loose rounds a Reload puts in by hand (physical rounds, mags.js 2026-10-18; a break
//     action or a single shot bounded by its room), out of a pocket or the rig, and both actions (one more) for a
//     Reload out of the pack once the rounds at hand are gone (MAGS.SOURCE_AP; Get shells is gone for your people).
// A pump at Shooting 7 with the trip's shells at hand: reach 0.62 (14 aim lost of 67, buckshot × 0.8) × sustain 0.91;
// a hunting rifle 1 × 0.80 (its rounds in the pack), 1 × 0.89 with them at hand; an assault rifle 1 × 1. The bosses'
// power (numbersK) is fitted against it.
HIVEMIND.REACH = { range: 6, melee: 0.3, shots: 14 };
// What coreFire needs to know of a fighter (also the fit's: tools/hivecorecalib.js): { p (combat power), melee, aim,
// opt, fall, type (the load: its spread), sustain }. packed: a squad not yet packed for the trip (the autopilot's gate):
// every gun will carry its loose rounds at hand (carrykit.js packShells and looseWant).
export function fireOf(s, packed = false) {
  const it = s.gear && s.gear.weapon, g = it ? GEAR[it.key] : null, W = it ? WEAPONS[it.key] : null;
  const p = combatPower(s);
  if (!g || g.cat === "melee" || !W || W.melee) return { p, melee: true };
  const cal = calOf(it.key), type = cal ? typeFor(cal, it.load) : null;
  const shoot = skill(s, "shooting"), aim = 40 + 2.5 * shoot + (W.aim || 0);
  const shots = HIVEMIND.REACH.shots, need = shots * (W.ammo || 1), cap = Math.max(1, W.cap || 1);
  let per = cap, fetch = 0;
  // Your people load by hand up to MAGS.LOOSE a Reload, whatever the gun (mags.js, 2026-10-18: physical rounds), out of
  // what they carry: the rounds at hand (pockets, rig) in 1 action, the pack's in both.
  if (INTERNAL[it.key] && usesInternal(it.key, it)) {
    per = Math.min(cap, MAGS.LOOSE);
    const keys = cal ? withHand(keyFor(cal, type)) : [];
    let hand = 0;
    for (const x of carriedSpots(s)) if ((x.where === "pocket" || x.where === "rig") && x.item && keys.includes(x.item.key)) hand += Math.max(0, Math.floor(x.item.dur || 0));
    if (packed) hand = Math.max(hand, looseWant(it)); // the trip packs every gun's loose rounds at hand (carrykit.js packShells)
    fetch = (Math.max(0, need - cap - hand) / per) * (MAGS.SOURCE_AP.pack - MAGS.SOURCE_AP.hand);
  }
  const reloads = Math.max(0, need - cap) / per;
  return { p, melee: false, aim, opt: W.opt || 0, fall: W.fall || 0, type, sustain: shots / (shots + reloads + fetch) };
}
// One fighter's fire at the core (fireOf's record) at range R, a melee weapon counting m.
export function fireAt(d, R = HIVEMIND.REACH.range, m = HIVEMIND.REACH.melee) {
  if (d.melee) return m;
  const reach = Math.max(0.1, (d.aim - Math.max(0, R - d.opt) * d.fall) / Math.max(1, d.aim)) * spreadMult(d.type, R);
  return reach * d.sustain;
}
// The team's power at the core × this: the power-weighted mean of its fighters' fire. { mult, fire: fireOf's records }.
export function coreFire(people, packed = false) {
  const fire = people.map((s) => fireOf(s, packed));
  const tot = fire.reduce((a, d) => a + d.p, 0);
  return { mult: tot > 0 ? fire.reduce((a, d) => a + d.p * fireAt(d), 0) / tot : 1, fire };
}
// The core's odds by the numbers for a squad not yet in the hive (the autopilot's gate, autopilot.js hiveCandidate):
// the core at a guard of G, its bosses × coreBossMult for what the squad carries and would pack (extra), the brood and
// bosses × the wear of the fights on the shortest way in (crawlEstimate). { win, ratio }.
export function coreGate(state, hive, people, G = guardSize(state, hive), extra = {}) {
  const f = coreForce(state, hive, G);
  const est = crawlEstimate(state, hive, G);
  const allies = hiveAllies(state, hive);
  const count = f.count ? broodAfterAllies(f.count, allies.fighters) : 0;
  const n = Math.max(1, count);
  const boss = f.bossPower * coreBossMult(corePrep(state, people, null, extra));
  const setup = { tile: hive.tile, ambush: null, layout: "hivecore", mineMult: coreFire(people, true).mult, enemy: { kind: "zombies", count: n, power: Math.round((((count * f.power + boss) / n) * est.wear) * 10) / 10, types: f.types, elite: !!f.elite } };
  const o = byNumbersOdds(state, /** @type {any} */ (setup), people);
  return { win: o.win, ratio: o.ratio };
}
// A fight in the core by the numbers spends what it counted for the Hivemind (up to NUMBERS.kit of each).
function spendPrep(state, p) {
  const K = HIVEMIND.NUMBERS.kit;
  for (const keys of [FIRE_KEYS, STUN_KEYS]) {
    let left = K;
    for (const key of keys) for (const x of teamKit(state, p, key)) { if (left <= 0) break; x.take(); left--; }
  }
}
export function assaultHive(state, p, hive, opts = {}) {
  const setup = coreSetup(state, p, hive, !!opts.quick);
  const allies = hiveAllies(state, hive);
  if (allies.fighters) log(state, `Fighters from ${allies.names.join(", ")} fight beside your squad in ${hive.name}.`, "good");
  if (opts.quick) { const res = crawlByNumbers(state, setup); spendPrep(state, p); finishCombat(state, setup, res); return null; }
  if (opts.map && typeof window !== "undefined" && !state.autoCombat) return onFoot(p, () => startCombat(state, setup));
  return onFoot(p, () => fightNow(state, setup));
}
// The core fight is over (combat.js finishCombat): the Hivemind dead destroys the hive.
registerCombatHandler("hiveAssault", (state, result, setup, battle) => {
  const c0 = setup.context || {};
  const hive = hiveById(state, c0.hiveId);
  const p = partyById(state, c0.partyId);
  const killed = Math.min(result.enemiesKilled || 0, c0.met ?? setup.enemy.count);
  if (hive && killed) cutGuard(state, hive, killed);
  if (hive) { hive.playerDay = day(state); }
  let text;
  const won = result.outcome === "victory" && !!hive;
  let hoard = "";
  if (won && p && state.parties.includes(p) && partyMembers(state, p).length) hoard = takeHoard(state, p, hive, p.hiveCrawl || null); // before the hive goes: its tier and stores
  if (battle) { HM_STATS.battles++; const hm = battle.hivemind || {}; if (hm.phase2) HM_STATS.phase2++; if (hm.burned) HM_STATS.burned++; if (hm.stunned) HM_STATS.stunned++; if (hm.dazed) HM_STATS.dazed++; if (hm.panicked) HM_STATS.panicked++; }
  if (won) {
    destroyHive(state, hive, "by your team");
    text = `The ${BOSS_NAMES.hivemind} bursts and the hive dies around you: the brood falls where it stands and the walls go still and cold. The infection around it will fade over the coming weeks.`;
    if (p && state.parties.includes(p)) p.seen.set(hive.tile, snapshot(state, hive.tile));
  } else if (result.outcome === "retreat") text = `The team fell back from the core. The ${BOSS_NAMES.hivemind} still beats.`;
  else text = "The brood drove the team back from the core.";
  if (!won && hive) markThreat(state, hive); // hivetech.js: it builds for defence
  if (!p || !state.parties.includes(p)) return;
  const c = p.hiveCrawl;
  if (!partyMembers(state, p).length) { if (c) crawlWiped(state, p, "Killed in the core."); else if (state.parties.includes(p)) { log(state, "The whole team was lost storming a hive.", "death"); wipeParty(state, p); } return; }
  if (c) {
    c.kills += killed;
    for (const id of result.survivorsDead || []) { const s = survivorById(state, id); if (s) c.lost.push(s.name); }
    c.enc = null;
    if (won) { say2(c, text, "good", state.hour); if (hoard) say2(c, hoard, "good", state.hour); finishHiveCrawl(state, p, text); if (hoard) log(state, hoard, "good"); return; }
    if (!hive) { finishHiveCrawl(state, p, GONE_TEXT); return; } // gone while the team fought
    addAlert(c, HCRAWL.ALERT.fight);
    say2(c, text, "danger", state.hour);
    const den = hive ? denOf(state, hive) : null;
    const core = den && roomById(den, den.core);
    const back = core && (backOf(c, den, core, c.from) || core.links[0]);
    if (back) { stepTrail(c, back); c.at = back; const prev = c.trail.length > 1 ? c.trail[c.trail.length - 2] : null; c.from = prev !== den.core ? prev : null; }
    log(state, `${text} (${tileLabel(state, partyTile(p))})`, "danger");
    return;
  }
  if (!won) log(state, `${text} (${tileLabel(state, partyTile(p))})`, "danger");
  if (hoard) log(state, hoard, "good");
  awaitOrders(state, p, text);
});

// ---------- the battle maps ----------
// A chamber: hive flesh everywhere but a winding passage from the west edge (where the team comes in, its way back)
// to the east, with one to three chambers along it and pillars of flesh for cover. The core: one great chamber, the
// Hivemind in a pocket at its east end with an opening toward the team.
registerBattleSize("hivechamber", (state, setup) => (setup.context && setup.context.hiveCrawl && setup.context.hiveCrawl.size) || [28, 16]);
registerBattleSize("hivecore", () => ROOM_KINDS.core.size);
function resetCell(c, k) { for (const key of Object.keys(c)) delete c[key]; c.k = k; c.f = "dirt"; }
function carveCave(ctx, kind) {
  const { W, H, rng } = ctx;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) resetCell(ctx.cellAt(x, y), "hivewall");
  const dig = (x, y) => { if (ctx.inside(x, y)) resetCell(ctx.cellAt(x, y), "open"); };
  const cy0 = Math.floor(H / 2);
  for (let x = 0; x < 6; x++) for (let y = cy0 - 3; y <= cy0 + 3; y++) dig(x, y); // the way in
  const half = kind === "tunnel" ? 1 : 2;
  const ty = [];
  let y = cy0;
  for (let x = 0; x < W; x++) {
    if (x > 5 && rng.chance(0.35)) y += rng.chance(0.5) ? 1 : -1;
    y = clamp(y, 1 + half, H - 2 - half);
    ty[x] = y;
    for (let d = -half; d <= half; d++) dig(x, y + d);
  }
  const blobs = kind === "tunnel" ? 1 : kind === "gallery" || kind === "nursery" || kind === "core" ? 3 : 2;
  for (let i = 0; i < blobs; i++) {
    const bx = clamp(Math.round(W * (0.3 + (0.55 * (i + rng.next())) / blobs)), 7, W - 3);
    const rx = rng.int(3, 5), ry = rng.int(2, Math.max(3, Math.floor(H / 3)));
    const by = clamp(ty[bx] + rng.int(-2, 2), 1, H - 2);
    for (let yy = by - ry; yy <= by + ry; yy++) for (let xx = bx - rx; xx <= bx + rx; xx++) if (((xx - bx) / rx) ** 2 + ((yy - by) / ry) ** 2 <= 1 + rng.next() * 0.25) dig(xx, yy);
  }
  if (kind !== "tunnel") { // a side passage
    const sx = rng.int(8, W - 6), up = rng.chance(0.5);
    for (let yy = ty[sx]; up ? yy >= 1 : yy <= H - 2; yy += up ? -1 : 1) { dig(sx, yy); dig(sx + 1, yy); }
  }
  // Pillars of flesh in the open (cover), never closing a passage: only where all eight neighbours are open.
  const n = Math.round((W * H) / 80);
  for (let i = 0; i < n; i++) {
    const x = rng.int(8, W - 3), yy = rng.int(1, H - 2);
    let open = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && ctx.inside(x + dx, yy + dy) && ctx.cellAt(x + dx, yy + dy).k === "open") open++;
    if (open === 8) ctx.put(x, yy, "hivewall");
  }
  return ty;
}
// The dark of the hive (both cave maps, once both sides are placed): b.dark (the battle's lights and beams, a flare's
// light and aim, the retreat), and each of yours sees LIGHT.dark tiles without a light (night-vision goggles see as by
// day), with one its sight + LIGHT.lit. The brood lives in the dark: its sight is its own.
export function caveDark(state, b) {
  b.dark = true;
  b.hiveDark = true;
  for (const u of b.units) {
    if (u.side !== "player" || u.sid == null) continue;
    const s = survivorById(state, u.sid); // volunteers.js: an allied group's volunteers see by their own lights too
    if (!s) continue;
    const tool = s.gear && s.gear.tool;
    if (tool && (tool.key === "nvg" || tool.key === "thermal")) continue;
    const L = lightOf(s);
    u.sight = Math.min(u.sight, L && LIGHTS[L] ? LIGHTS[L].sight + HCRAWL.LIGHT.lit : HCRAWL.LIGHT.dark);
  }
}
registerBattleLayout("hivechamber", (b, ctx) => {
  if (ctx.phase === "units") { if (ctx.state) caveDark(ctx.state, b); return; }
  if (ctx.phase !== "map") return;
  const c = (b.setup.context && b.setup.context.hiveCrawl) || {};
  const room = c.kind === "swarm" || c.kind === "turned" ? "tunnel" : null;
  carveCave(ctx, room || kindOfSize(c.size));
  b.infection = 1;
  b.reinfMax = 0; // no dead drawn in from the edges: the brood is what is in the chamber
  b.hiveWarmth = c.warmth ?? 50; // ui: the pulse and the warm tint (ui/hivecrawlsfx.js)
});
const kindOfSize = (size) => (size && size[1] <= 13 ? "tunnel" : size && size[1] >= 18 ? "gallery" : "chamber");
registerBattleLayout("hivecore", (b, ctx) => {
  const { W, H } = ctx;
  const hx = W - 4, cy = Math.floor(H / 2);
  if (ctx.phase === "map") {
    const ty = carveCave(ctx, "core");
    // The great chamber, then the Hivemind's pocket: open round it, a ring of flesh, an opening toward the team.
    const cx = Math.round(W * 0.55), rx = Math.round(W * 0.38), ry = Math.round(H * 0.4);
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 && ctx.inside(x, y)) resetCell(ctx.cellAt(x, y), "open");
    for (let x = cx; x <= hx; x++) for (let y = cy - 1; y <= cy + 1; y++) if (ctx.inside(x, y)) resetCell(ctx.cellAt(x, y), "open");
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = hx - 2; x <= Math.min(W - 1, hx + 2); x++) {
      if (!ctx.inside(x, y)) continue;
      const ring = Math.max(Math.abs(x - hx), Math.abs(y - cy)) === 2;
      const gap = x === hx - 2 && Math.abs(y - cy) <= 1;
      resetCell(ctx.cellAt(x, y), ring && !gap ? "hivewall" : "open");
    }
    for (let i = 0; i < 6; i++) { const x = ctx.rng.int(cx - rx + 4, hx - 4), y = ctx.rng.int(cy - ry + 1, cy + ry - 1); if (ctx.free(x, y) && Math.abs(y - cy) > 1) ctx.put(x, y, "hivewall"); }
    void ty;
    b.infection = 1;
    b.reinfMax = 0;
    b.hiveWarmth = 100;
    return;
  }
  // Units: the Hivemind in its pocket, the Broodmother in front of it; the dark.
  if (ctx.state) caveDark(ctx.state, b);
  const setup = b.setup;
  const hm = bossUnit(b, "hivemind");
  const hp = (setup.enemy && setup.enemy.hp) || HIVEMIND.hp;
  hm.hp = hm.maxHp = hp;
  // Its 2 × 2 footprint round the pocket's cell: the first corner whose four cells stand; whoever stood there moves off.
  const corner = [[hx - 1, cy - 1], [hx - 1, cy], [hx, cy - 1], [hx, cy]].find(([x, y]) => unitCells(hm, x, y).every(([cx2, cy2]) => cx2 >= 0 && cy2 >= 0 && cx2 < ctx.W && cy2 < ctx.H && ctx.standable(cx2, cy2))) || [hx, cy];
  for (const taken of b.units.filter((u) => unitCells(hm, corner[0], corner[1]).some(([x, y]) => u.x === x && u.y === y))) { if (!placeUnitRight(b, ctx, taken, Math.max(0, hx - 10), hx - 2)) taken.x = Math.max(0, hx - 6); }
  hm.x = corner[0]; hm.y = corner[1];
  b.units.push(hm);
  b.hivemind = { id: hm.id, tier: (setup.context && setup.context.tier) || 0, spawned: 0, turns: 0 };
  if (ctx.state) { // what your side brought for its weak spots (the AI's retreat counts what is still in hand: fightOutlook)
    const people = b.units.filter((u) => u.side === "player" && u.sid != null).map((u) => survivorById(ctx.state, u.sid)).filter(Boolean);
    const pr = corePrep(ctx.state, people, ctx.state.parties.find((x) => x.id === setup.partyId) || null);
    b.hivemind.prep = pr.fire + pr.stun;
    b.hivemind.used = 0;
  }
  const bm = bossUnit(b, "broodmother");
  bm.shotPri = 1.3;
  if (placeUnitRight(b, ctx, bm, Math.max(0, hx - 9), hx - 2)) b.units.push(bm);
  say(b, `The core of the hive. At its far end the ${BOSS_NAMES.hivemind} beats in a pocket of flesh: it never moves, but it pulses, lashes out and calls the brood out of the walls. Kill it and the hive dies with it.`, "danger");
});
// The Hivemind's second phase (HIVEMIND.P2), once, below half its health: it convulses (u.phase2: its sprite, the hive's
// pulse sound), the cave quakes (pillars of flesh and bone come down in the open, never closing a passage: only where
// all eight neighbours are open and nobody stands; those of yours next to one may be hurt), and from now on it pulses
// further and harder and tears more brood out of the walls (st.phase2: the turn it began).
function phaseTwo(b, u, st) {
  const P = HIVEMIND.P2, rng = b.rng;
  st.phase2 = st.turns;
  u.phase2 = true;
  b.hivePhase2 = b.turn || 1;
  say(b, `The ${BOSS_NAMES.hivemind} tears open and bleeds light: it is dying, and it pulls the whole hive in with it. The cave shakes.`, "danger");
  fx(b, { type: "melee", from: [u.x, u.y], to: [u.x, u.y], hit: true, crit: false, dmg: 0, side: "enemy", text: "ENRAGED" });
  const free = (x, y) => x >= 0 && y >= 0 && x < b.w && y < b.h && b.cells[y * b.w + x].k === "open" && !b.units.some((o) => o.x === x && o.y === y && !o.dead && !o.left);
  const n = rng.int(P.quake[0], P.quake[1]);
  const fell = [];
  for (let tries = 0; tries < 80 && fell.length < n; tries++) {
    const x = rng.int(2, b.w - 3), y = rng.int(1, b.h - 2);
    if (!free(x, y) || Math.max(Math.abs(x - u.x), Math.abs(y - u.y)) <= 2) continue;
    let ok = true;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) { if (!(dx || dy)) continue; const xx = x + dx, yy = y + dy; if (!(xx >= 0 && yy >= 0 && xx < b.w && yy < b.h) || b.cells[yy * b.w + xx].k !== "open") { ok = false; break; } }
    if (!ok) continue;
    const c = b.cells[y * b.w + x];
    for (const key of Object.keys(c)) delete c[key];
    c.k = "hivewall"; c.f = "dirt";
    fell.push([x, y]);
  }
  if (b.losCache) b.losCache.fill(0);
  b.rev = (b.rev || 0) + 1;
  const hurt = [];
  for (const t of b.units) {
    if (t.side !== "player" || !active(t)) continue;
    const close = fell.some(([x, y]) => Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) <= 1);
    if (!rng.chance(close ? Math.min(0.9, P.quakeHit * 2) : P.quakeHit * 0.3)) continue;
    damage(b, t, rng.int(P.quakeDmg[0], P.quakeDmg[1]), null, false, null);
    hurt.push(t.name);
  }
  say(b, `${fell.length} pillar${fell.length === 1 ? "" : "s"} of flesh and bone come down${hurt.length ? `: ${hurt.join(", ")} caught under the falling flesh` : ""}.`, "danger");
}
// The centre cell of a boss's 2 × 2 body (its one cell when it has one): what its own reach and the throws at it go by.
const heart = (u) => [u.x + (u.size > 1 ? 1 : 0), u.y + (u.size > 1 ? 1 : 0)];
// The Hivemind's weak spots at the start of its turn (HIVEMIND.WEAK): what landed near it since its last turn
// (throwables.js b.landed) and the flames around it. Returns { burning, stunned } for this turn.
function weakSpots(b, u, st) {
  const W = HIVEMIND.WEAK, rng = b.rng;
  const cheb = (x, y) => { const [cx, cy] = nearCell(u, x, y); return Math.max(Math.abs(x - cx), Math.abs(y - cy)); }; // from the nearest cell of its 2 × 2 body: what lands on it or burns next to it
  for (const L of b.landed || []) {
    if (L.side === "enemy") continue;
    if (L.fx === "fire" && cheb(L.x, L.y) <= W.near + 1) st.burnLeft = W.burnTurns;
    else if (L.fx === "flash" && cheb(L.x, L.y) <= W.flash) st.stunLeft = Math.max(st.stunLeft || 0, W.stunFlash);
    else if ((L.fx === "frag" || L.fx === "blast") && cheb(L.x, L.y) <= W.blast) st.stunLeft = Math.max(st.stunLeft || 0, W.stunBlast);
  }
  if (b.landed) b.landed.length = 0;
  if ((b.fires || []).some((c) => cheb(c.x, c.y) <= W.near)) st.burnLeft = W.burnTurns; // the flames are on it
  const out = { burning: false, stunned: false };
  if ((st.burnLeft || 0) > 0) {
    st.burnLeft--;
    st.burned = (st.burned || 0) + 1;
    out.burning = true;
    const eff = Math.round(damage(b, u, rng.int(W.burnDmg[0], W.burnDmg[1]), null, false, { how: "fire" }));
    fx(b, { type: "melee", from: [u.x, u.y], to: [u.x, u.y], hit: true, crit: false, dmg: eff, side: "fire", text: "BURNS" });
    say(b, `The ${BOSS_NAMES.hivemind} burns (${eff}): it shrieks through the flesh, and no brood comes out of the burning walls.`, "good");
    // The brood it called shy from the flames: each one near them (or near it) loses an action on its next turn.
    panicBrood(b, u, st);
  }
  if (u.armorBase == null) u.armorBase = u.armor;
  u.armor = u.armorBase;
  if (!u.dead && (st.stunLeft || 0) > 0) {
    st.stunLeft--;
    u.armor = Math.max(u.armorBase, W.stunArmor); // open to your shots until its next turn
    st.stunned = (st.stunned || 0) + 1;
    out.stunned = true;
    fx(b, { type: "melee", from: [u.x, u.y], to: [u.x, u.y], hit: true, crit: false, dmg: 0, side: "player", text: "STUNNED" });
    say(b, `The ${BOSS_NAMES.hivemind} reels from the bang: its pulse falters, its tendrils hang slack and the walls stay shut.`, "good");
  }
  return out;
}
// Where the battle AI throws at it (combat.js bossThrowTarget): a Molotov while it does not burn, else a flashbang, a
// frag grenade or a pipe bomb while it is not reeling; in range, somewhere the thrower's side can see or knows of, and
// none of the thrower's side within WEAK.safe (+1 for the flash) of it. null: nothing to throw.
function hivemindThrowAt(b, u, t, have) {
  if (!have || u.dead || !active(t)) return null;
  const W = HIVEMIND.WEAK, st = b.hivemind || {};
  const [hx0, hy0] = heart(u), chebU = (x, y) => Math.max(Math.abs(x - hx0), Math.abs(y - hy0)); // from its heart (the centre cell of its 2 × 2 body): where to stand and throw, as for its one cell before
  const touch = (x, y) => { const [cx, cy] = nearCell(u, x, y); return Math.max(Math.abs(x - cx), Math.abs(y - cy)); }; // from the edge of it: the flames on it
  const [nx0, ny0] = nearCell(u, t.x, t.y), d = Math.hypot(t.x - nx0, t.y - ny0); // to the nearest part of its body
  const clear = (r) => !b.units.some((o) => o.side === t.side && active(o) && chebU(o.x, o.y) <= r);
  const burning = (st.burnLeft || 0) > 0 || (b.fires || []).some((c) => touch(c.x, c.y) <= W.near);
  const want = [];
  if (have.molotov && !burning && clear(W.safe)) want.push("molotov");
  if (!((st.stunLeft || 0) > 0)) {
    if (have.flashbang && clear(W.safe + 1)) want.push("flashbang");
    for (const key of ["frag", "pipebomb"]) if (have[key] && clear(W.safe)) want.push(key);
  }
  if (!want.length) return null;
  const key = want[0], range = THROWABLES[key].range;
  // Out of reach: a step closer first (an action), to a cell in reach that sees it and is outside its pulse.
  if (d > range) {
    if (t.ap < 2 || d > range + (t.mob || 3) + 1) return null;
    const pulse = (st.phase2 ? HIVEMIND.P2.pulse : HIVEMIND.pulse) + 1;
    const r = reachable(b, t, t.mob || 3);
    let best = null;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      const c = r.dist[y * b.w + x];
      if (!(c < Infinity)) continue;
      const [nx, ny] = nearCell(u, x, y), dd = Math.hypot(x - nx, y - ny), ch = chebU(x, y);
      if (dd > range || ch <= pulse || !los(b, x, y, nx, ny)) continue;
      if (!best || c < best.c) best = { x, y, c };
    }
    if (!best) return null;
    t.ap -= 1;
    moveAlong(b, t, pathTo(r, best.x, best.y));
    if (!active(t) || t.ap < 1) return null;
  }
  const [lx, ly] = nearCell(u, t.x, t.y); // onto the nearest part of its body
  if (throwBlind(b, t, lx, ly) === null) return null;
  return { item: key, x: lx, y: ly };
}
// The Hivemind's turn (combat.js registerBossAI): the pulse, a lash, the brood out of the walls.
// The battle AI's outlook on it (combat.js fightOutlook): burning or reeling it counts for less, and the fire and bangs
// your side still has for it count for you (HIVEMIND.WEAK outlook).
function hivemindOutlook(b, u) {
  const W = HIVEMIND.WEAK, st = b.hivemind || {};
  const burning = (st.burnLeft || 0) > 0 || (b.fires || []).some((c) => { const [cx, cy] = nearCell(u, c.x, c.y); return Math.max(Math.abs(c.x - cx), Math.abs(c.y - cy)) <= W.near; }); // the flames next to its body
  const reeling = (st.stunLeft || 0) > 0;
  const left = Math.max(0, Math.min(4, (st.prep || 0) - (st.used || 0)));
  return { life: (burning ? W.burnLife : 1) * (reeling ? W.stunLife : 1), fire: reeling ? 0 : burning ? W.burnFire : 1, ours: 1 + W.prepEdge * left };
}
// A throw of your side's landed: what was spent on it (the outlook's fire and bangs still in hand); a Molotov bursting
// near it panics its brood at once.
function hivemindOnLand(b, u, L) {
  if (L.side !== "player" || !["fire", "flash", "frag", "blast"].includes(L.fx)) return;
  const st = b.hivemind || (b.hivemind = { id: u.id, tier: 0, spawned: 0, turns: 0 });
  st.used = (st.used || 0) + 1;
  if (L.fx === "fire") panicBrood(b, u, st, L);
}
// The brood it called near the flames (a Molotov bursting at `at`, the fires burning, or near it while it burns) shy
// away: an action lost on their next turn.
function panicBrood(b, u, st, at = null) {
  const W = HIVEMIND.WEAK;
  const cheb = (z, x, y) => Math.max(Math.abs(z.x - x), Math.abs(z.y - y));
  const near = (z) => (at ? cheb(z, at.x, at.y) <= W.panic + 1 : cheb(z, ...heart(u)) <= W.panicNear) || (b.fires || []).some((c) => cheb(z, c.x, c.y) <= W.panic);
  const shy = b.units.filter((z) => z.called && z.side === "enemy" && active(z) && !z.reel && near(z));
  for (const z of shy) z.reel = { next: nextTurnOf(b, z), why: "the flames around the Hivemind" };
  if (shy.length) { st.panicked = (st.panicked || 0) + shy.length; say(b, `${shy.length} of the brood it called shy away from the flames.`, "good"); }
}
// The Broodmother dazed by a bang next to her (HIVEMIND.WEAK daze): actions lost on her next turn.
registerBossAI("broodmother", {
  onLand(b, u, L) {
    const W = HIVEMIND.WEAK;
    if (L.side !== "player" || !active(u)) return;
    const [cx, cy] = nearCell(u, L.x, L.y), d = Math.max(Math.abs(L.x - cx), Math.abs(L.y - cy)); // to the nearest cell of her 2 × 2 body
    const ap = L.fx === "flash" && d <= W.flash ? W.dazeFlash : (L.fx === "frag" || L.fx === "blast") && d <= W.blast ? W.dazeBlast : 0;
    if (!ap) return;
    const next = nextTurnOf(b, u);
    u.stun = { aim: 0, ap: Math.max(ap, u.stun && !u.stun.applied && u.stun.next === next ? u.stun.ap : 0), next, dazed: false };
    if (b.hivemind) b.hivemind.dazed = (b.hivemind.dazed || 0) + 1;
    fx(b, { type: "melee", from: [u.x, u.y], to: [u.x, u.y], hit: true, crit: false, dmg: 0, side: "player", text: "DAZED" });
    say(b, `The ${BOSS_NAMES.hive} is dazed by the bang (−${u.stun.ap} action${u.stun.ap === 1 ? "" : "s"} on her next turn).`, "good");
  },
});
registerBossAI("hivemind", {
  throwAt: hivemindThrowAt,
  outlook: hivemindOutlook,
  onLand: hivemindOnLand,
  turn(b, u) {
    const M = HIVEMIND, rng = b.rng;
    const st = b.hivemind || (b.hivemind = { id: u.id, tier: 0, spawned: 0, turns: 0 });
    st.turns++;
    const weak = weakSpots(b, u, st);
    if (u.dead) return;
    if (M.P2.on && !st.phase2 && u.hp < u.maxHp * M.P2.at) phaseTwo(b, u, st);
    const P = st.phase2 ? M.P2 : M;
    const [hx0, hy0] = heart(u), cheb = (o) => Math.max(Math.abs(o.x - hx0), Math.abs(o.y - hy0)); // the pulse from its heart (the centre cell of its 2 × 2 body)
    const touch = (o) => { const [cx, cy] = nearCell(u, o.x, o.y); return Math.max(Math.abs(o.x - cx), Math.abs(o.y - cy)); }; // a lash from the edge of it
    const foes = b.units.filter((o) => o.side === "player" && active(o));
    const near = weak.stunned ? [] : foes.filter((o) => cheb(o) <= P.pulse); // reeling from a bang: no pulse, no lash
    if (near.length) {
      say(b, st.phase2 ? `The ${BOSS_NAMES.hivemind} convulses: a scalding wave through the flesh.` : `The ${BOSS_NAMES.hivemind} pulses: a wave of heat and pressure through the flesh.`, "danger");
      for (const t of near) {
        damage(b, t, rng.int(P.pulseDmg[0], P.pulseDmg[1]), u, false, null);
        fx(b, { type: "melee", from: [u.x, u.y], to: [t.x, t.y], hit: true, crit: false, dmg: 0, side: "enemy", text: "PULSE" });
        if (active(t) && rng.chance(P.stun) && !(t.stun && !t.stun.applied && t.stun.next >= nextTurnOf(b, t))) t.stun = { aim: 15, ap: 1, next: nextTurnOf(b, t), dazed: false };
      }
    }
    const lash = weak.stunned ? [] : foes.filter((o) => active(o) && touch(o) <= 1);
    if (lash.length) {
      const t = rng.pick(lash);
      const eff = Math.round(damage(b, t, rng.int(M.lash[0], M.lash[1]), u, false, { how: "melee", crit: false }));
      say(b, `A tendril lashes out of the ${BOSS_NAMES.hivemind} at ${t.name} for ${eff}.`, "danger");
      fx(b, { type: "melee", from: [u.x, u.y], to: [t.x, t.y], hit: true, crit: false, dmg: eff, side: "enemy" });
    }
    const cap = M.cap + M.capTier * (st.tier || 0) + (st.phase2 ? M.P2.cap : 0);
    const due = st.phase2 ? (st.turns - st.phase2) % M.P2.spawnEvery === 0 : st.turns % M.spawnEvery === 1;
    if (due && st.spawned < cap && !weak.burning && !weak.stunned) { // burning or reeling: the walls give up nothing
      const cells = [];
      for (let y = hy0 - 6; y <= hy0 + 6; y++) for (let x = hx0 - 8; x <= hx0 + 1; x++) { // round its heart (the old one cell), as before its 2 × 2 body
        if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
        const c = b.cells[y * b.w + x];
        if (c.k !== "open" || !b.reach[y * b.w + x] || b.units.some((o) => coversCell(o, x, y) && !o.dead && !o.left)) continue;
        let wall = false;
        for (let dy = -1; dy <= 1 && !wall; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < b.w && yy < b.h && b.cells[yy * b.w + xx].k === "hivewall") { wall = true; break; } }
        if (wall) cells.push([x, y]);
      }
      rng.shuffle(cells);
      const n = Math.min(cap - st.spawned, rng.int(P.spawn[0], P.spawn[1]), cells.length);
      const power = (b.setup.enemy && b.setup.enemy.broodPower) || 5;
      for (let i = 0; i < n; i++) {
        const z = enemyUnit(b, rng, "zombies", power, b.units.filter((o) => o.kind === "zombie").length + 1);
        const kinds = Object.keys((b.setup.enemy && b.setup.enemy.types) || {});
        if (kinds.length && rng.chance(0.3)) applyZType(z, rng.pick(kinds), !!(b.setup.enemy && b.setup.enemy.elite), power);
        z.x = cells[i][0]; z.y = cells[i][1];
        z.aware = true; z.ap = 0; z.reinforcement = true; z.called = true; // called: the brood the fire panics (weakSpots)
        b.units.push(z);
      }
      st.spawned += n;
      if (n) say(b, `The walls split: ${n} of the brood tear themselves out of the flesh.`, "danger");
    }
  },
  death(b, u) {
    let n = 0;
    for (const o of b.units) if (o !== u && o.side === "enemy" && o.kind === "zombie" && !o.dead) { o.dead = true; o.hp = 0; o.killedBy = "player"; n++; fx(b, { type: "melee", from: [o.x, o.y], to: [o.x, o.y], hit: true, crit: false, dmg: 0, side: "player", text: "COLLAPSES" }); }
    say(b, `The ${BOSS_NAMES.hivemind} bursts like a rotten fruit.${n ? ` Its brood drops where it stands: ${n} of them, the ${BOSS_NAMES.hive} among them if she still stood.` : ""} The hive is dying.`, "good");
  },
});

// ---------- the autopilot ----------
// One step of a crawl a team of yours is on while the autopilot plays (autopilot.js idleTeams, once an hour): follow the
// warmth (the drafts as the team reads them; unexplored chambers before known ones), fight by the numbers what it
// should win, creep past what it can, burn eggs when it has the fuel or a Molotov, search bone pits, lie still when the
// hive is roused, and turn back when the team is badly hurt or the core is beyond it (it comes back on a later trip:
// the chambers it cleared stay clear for a while). The core: played out on the map headless, as the old storm was.
// Turned back (c.headOut, 2026-10-13: leaving is a walk), it makes for the nearest, safest mouth a chamber a step
// (wayOut) and leaves by it.
export function hiveCrawlAutoStep(state, p) {
  const c = hiveCrawlOf(state, p);
  if (!c) return;
  if (state.combat) return;
  const A = HCRAWL.AUTO;
  const members = partyMembers(state, p);
  const fit = members.filter((s) => s.health >= A.fit).length;
  const hurtBad = members.filter((s) => s.health < A.hurt).length;
  if (c.enc) {
    const opts = encounterOptions(state, p);
    const get = (id) => opts.find((o) => o.id === id);
    if (c.enc.kind === "core") {
      const ok = fit >= Math.min(A.coreFit, members.length) && fit === members.length && get("numbers").odds >= A.coreOdds; // only the whole team fit, at good odds
      resolveHiveEnc(state, p, ok ? "fight" : "back", { map: false });
      if (!ok && p.hiveCrawl && !p.hiveCrawl.enc) { p.hiveCrawl.headOut = true; say2(p.hiveCrawl, "The core is too much for the team as it is: it turns back, to come again.", "danger", state.hour); }
      return;
    }
    const num = get("numbers"), sneak = get("sneak"), out = get("out");
    // Too many hurt to fight again (a swarm on the heels of a fight in a hot chamber: HCRAWL.THREAT): fall back and out.
    const spent = hurtBad >= 2 || fit < Math.max(2, Math.ceil(members.length / 2));
    // At a mouth on the way out (or spent): out past them.
    if (out && (c.headOut || spent)) { resolveHiveEnc(state, p, "out", { map: false }); return; }
    // On the way out, falling back means away from the mouth and the same brood in the way (a loop that killed a hurt
    // team one by one, the round grid's young-hive runs, seed 165): it creeps past or fights its way on when the odds
    // are fair; fallen back, its way out goes round them (wayOut).
    const outFight = c.headOut && num && num.odds >= A.fightOdds;
    const retreat = get("back") ? "back" : out ? "out" : "numbers";
    const creep = sneak && sneak.odds >= A.sneakOdds && !c.enc.spotted;
    const pick = spent && !outFight ? retreat : spent ? "numbers" : num && num.odds >= A.sureOdds ? "numbers" : creep ? "sneak" : num && num.odds >= A.fightOdds ? "numbers" : retreat;
    resolveHiveEnc(state, p, pick, { map: false });
    if (pick !== "numbers" && pick !== "sneak") { const cc = p.hiveCrawl; if (cc && !cc.enc) { if (!cc.headOut) say2(cc, spent ? "Too many hurt: the team turns back." : "Too many in the way: the team turns back.", "danger", state.hour); cc.headOut = true; } } // fallen back, it makes for a mouth, as turnBack says
    return;
  }
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  if (c.headOut) { autoOut(state, p, c, den); return; }
  const acts = roomActions(state, p);
  if (members.some((s) => s.health < A.treat) && acts.some((a) => a.id === "treat" && !a.disabled)) { roomAct(state, p, "treat"); return; }
  if (hurtBad >= 2 || fit < Math.max(2, Math.ceil(members.length / 2))) { turnBack(state, p, c, den, "Too many hurt: the team turns back."); return; }
  const heat = roomHeat(state, c, crawlRoom(state, c)); // HCRAWL.THREAT: the chamber's activity × its heat
  if (heat >= A.lie) { roomAct(state, p, "lie"); return; }
  const burn = acts.find((a) => a.id === "burn" && !a.disabled);
  if (burn && heat < 50) { roomAct(state, p, "burn"); return; }
  const search = acts.find((a) => a.id === "search" && !a.disabled);
  if (search && crawlRoom(state, c).kind === "bones") { roomAct(state, p, "search"); return; }
  if (!canMoveOn(state, c)) { turnBack(state, p, c, den, ""); return; }
  // Two or more ways on that do not read colder (or where the beat is louder) and that it knows nothing of: a good
  // listener listens at the first (an hour), else a flare goes down it while the hive is quiet (Listen and Flare).
  const unknown = exitsOf(state, p).filter((x) => !x.visited && !x.mouth && !x.heard && (x.draft !== "colder" || x.sound === "louder")).sort((a, b) => a.id.localeCompare(b.id));
  if (unknown.length >= 2 && heat < A.lie - 10) {
    if (listener(state, p).v >= HCRAWL.LISTEN.auto) { listenAt(state, p, unknown[0].id); return; }
    if (heat < 40 && flaresOf(state, p).length) { throwFlare(state, p, unknown[0].id); return; }
  }
  const next = autoNext(state, p, c, den);
  if (!next) { turnBack(state, p, c, den, "Nowhere left to look: the team turns back."); return; }
  moveTo(state, p, next);
}
// The autopilot turns back: it makes for a mouth from now on, starting this hour.
function turnBack(state, p, c, den, text) {
  c.headOut = true;
  if (text) say2(c, text, "danger", state.hour);
  autoOut(state, p, c, den);
}
// A step on the autopilot's way out: out by the mouth it stands in, else a chamber along wayOut (one it can walk into
// from here: with the brood still in its chamber, only back the way it came).
function autoOut(state, p, c, den) {
  const here = roomById(den, c.at);
  if (isMouth(den, here.id) && canMoveOn(state, c)) { roomAct(state, p, "out"); return; }
  if (!canMoveOn(state, c)) { const b = backOf(c, den, here, c.from); if (b) moveTo(state, p, b); else if (isMouth(den, here.id)) outOf(state, p, c, den, here, ""); return; }
  const way = wayOut(state, c);
  const next = way && way.length ? way[0] : backOf(c, den, here, null);
  if (next) moveTo(state, p, next);
}
// The way out (the autopilot's, and the window's hint): the cheapest walk to any mouth over the chambers the team
// knows (been in, or seen from one), never through the core. A step costs 1, a chamber it has not been in +3, one it
// has been in with the brood in it now (not crept past: filled again, or never cleared) +6 and its heat / 20.
// [ids from the next chamber to the mouth], or null.
export function wayOut(state, c) {
  const hive = crawlHive(state, c);
  if (!hive) return null;
  const den = denOf(state, hive);
  return cheapestWay(den, c.at, (r) => isMouth(den, r.id), (r) => {
    if (!c.visited[r.id] && !c.seen[r.id]) return null;
    const known = !!c.visited[r.id];
    const brood = known ? broodLeft(state, hive, r) : 0;
    return 1 + (known ? 0 : 3) + (brood > 0 && !c.slipped[r.id] ? 6 + ((c.heat || {})[r.id] || 0) / 20 : 0);
  });
}
// The next chamber on the autopilot's way: a passage it has not taken with a warmer draft or a louder beat (both
// first), else a level one, else the first step toward the nearest chamber it knows of and has not been in.
function autoNext(state, p, c, den) {
  const ex = exitsOf(state, p).filter((x) => !(x.visited && x.room && (x.room.kind === "collapse" || x.room.dead && !ROOM_KINDS[x.room.kind].burn && !ROOM_KINDS[x.room.kind].search)));
  const fresh = ex.filter((x) => !x.visited && !x.mouth); // a mouth is the way out, not on
  // What it knows of a way on (listening, a flare): the core first, then the fewest of the brood; unknown ones as 6.
  const est = (x) => (!x.heard ? 6 : x.heard.kind === "core" && x.heard.q !== "vague" ? -1 : x.heard.q === "exact" ? x.heard.n : (x.heard.lo + x.heard.hi) / 2);
  // A way on that reads warmer, level, or where the beat is louder (heard true, through the walls: a draft that reads
  // colder may be misread): warmer and louder first, then warmer, then louder against the draft, then level.
  const score = (x) => (x.draft === "warmer" ? 0 : x.draft === "level" ? 0.6 : 1) + (x.sound === "louder" ? 0 : x.sound === "same" ? 0.5 : 1);
  const on = fresh.filter((x) => x.draft !== "colder" || x.sound === "louder").sort((a, b) => (est(a) < 0 ? -1 : score(a)) - (est(b) < 0 ? -1 : score(b)) || est(a) - est(b) || a.id.localeCompare(b.id));
  if (on.length) return on[0].id;
  // Known chambers: a breadth-first walk over the chambers the team has been in to the nearest unexplored passage.
  const start = c.at, prev = new Map([[start, null]]), q = [start];
  let goal = null;
  const hive = crawlHive(state, c);
  while (q.length && !goal) {
    const id = q.shift();
    for (const n of roomById(den, id).links) {
      if (prev.has(n)) continue;
      prev.set(n, id);
      if (!c.visited[n] && !isMouth(den, n)) { goal = n; break; }
      const r = roomById(den, n);
      if (r.kind === "core" || (broodLeft(state, hive, r) > 0 && !c.slipped[n])) continue; // not through the core, nor a chamber full of brood
      q.push(n);
    }
  }
  if (!goal) return null;
  let step = goal;
  while (prev.get(step) !== start && prev.get(step) != null) step = prev.get(step);
  return step;
}

// The autopilot's estimate of a crawl (autopilot.js hiveCandidate, hiveChoice, hiveJobOk): with a guard of G, the den's
// depth, the fights on the shortest way (brood × power / 5.2 of each), the core (its brood and the bosses as one
// strength), the hours inside and the wear (each fight on the way costs the squad a little: wear per fight).
// The way in by each of the four mouths (2026-10-13): the one with the least brood on its shortest way (then the
// shortest) is the autopilot's (mouth: its id; ways: each mouth's { mouth, fights, brood, worst, steps }).
export function crawlEstimate(state, hive, G = guardSize(state, hive)) {
  const den = denOf(state, hive);
  const ways = mouthsOf(den).map((m) => wayIn(state, hive, den, m, G));
  const best = ways.reduce((a, w) => (!a || w.brood < a.brood - 1e-9 || (Math.abs(w.brood - a.brood) <= 1e-9 && w.steps < a.steps) ? w : a), null) || { mouth: null, fights: 0, brood: 0, worst: 0, steps: 0 };
  const { fights, brood, worst } = best;
  const core = coreForce(state, hive, G);
  const allies = hiveAllies(state, hive).fighters;
  const count = core.count ? broodAfterAllies(core.count, allies) : 0;
  const coreStrength = (count * core.power + core.bossPower) / 5.2;
  return { depth: den.depth, fights, brood, worst, coreStrength, wear: 1 + HCRAWL.AUTO.wear * fights, strength: coreStrength * (1 + HCRAWL.AUTO.wear * fights), hours: den.depth * (HCRAWL.MOVE_HOURS + HCRAWL.FIGHT_HOURS) + 6, mouth: best.mouth, ways };
}
// The fights on the shortest way in from a mouth, with a guard of G (crawlEstimate).
function wayIn(state, hive, den, mouth, G) {
  const path = shortestPath(den, mouth);
  let fights = 0, brood = 0, worst = 0;
  for (const id of path) {
    const r = roomById(den, id);
    if (r.kind === "core") continue;
    const n = Math.min(roomFull(state, hive, den, r, G), broodLeft(state, hive, r, G));
    const v = (n * roomPower(state, hive, den, r, G)) / 5.2;
    if (n > 0) { fights++; brood += v; worst = Math.max(worst, v); }
  }
  return { mouth, fights, brood, worst, steps: path.length - 1 };
}
// What your teams know of a mouth from their crawls (the hive card's Enter from the north): how often they went in and
// came out by it, its brood when they last stood in it, and the way to the core from it over the chambers they mapped.
export function mouthNote(state, hive, id) {
  const den = denOf(state, hive);
  const rec = hive.crawlRec;
  const used = (rec && rec.mouths && rec.mouths[id]) || { in: 0, out: 0 };
  const m = roomById(den, id);
  if (!m || !rec || !(rec.mapped && rec.mapped[id]) && !used.in && !used.out) return "Nobody of yours has been in by it.";
  const bits = [];
  if (used.in || used.out) bits.push(`your teams went in by it ${used.in} time${used.in === 1 ? "" : "s"} and came out by it ${used.out}`);
  if (rec.mapped && rec.mapped[id]) { const n = broodLeft(state, hive, m); bits.push(n ? `its brood back (about ${n})` : "its brood cleared lately"); }
  const mapped = (r) => !!(rec.mapped && rec.mapped[r.id]);
  const way = rec.core && mapped(m) ? cheapestWay(den, id, (r) => r.links.includes(den.core) && mapped(r), (r) => (mapped(r) ? 1 : null)) : null; // to a door of the core, over mapped chambers
  if (way) bits.push(`the core ${way.length + 1} chambers in by the way you mapped`);
  const t = bits.join("; ");
  return t ? t[0].toUpperCase() + t.slice(1) + "." : "";
}

// ---------- the AI groups' crawl ----------
// A war party of an AI group (factions.js groupHiveWar) crawls the same den, coarsely: its strength is a budget in the
// guard's units (its fighters' power × GROUP_HIVE.FIGHT, as before); the whole way in costs the guard × (depth + 1) /
// GROUP.depthDiv, spread over the brood on the shortest way and in the core (each chamber costs its brood left), and
// the core the Hivemind and the Broodmother on top (GROUP.boss + bossTier × tier). The guard it kills: the brood it
// killed × the guard each stands for (the guard over the brood on its way in, so the whole way in is the guard). It clears
// what it pays for (the hive remembers: the chambers stay clear for a while, for your teams too), stops where the
// budget runs out (driven off partway; a later party starts from what is still clear), and kills the Hivemind (the hive dies) when it
// reaches and pays for the core. Four mouths (2026-10-13): it goes in by one of the hive's dice (its group's), and a party driven
// off walks back out the shortest way to the nearest mouth. Returns { burned, cut (the guard killed), met (all it ran
// into), reached (chambers deep), depth, mouth, path (its way in), out (its way out) }.
export function groupHiveCrawl(state, hive, budget, fid = null) {
  budget *= 1 + HCRAWL.GROUP.light; // torches and flares, listening at the passages: the party's strength goes further (coarse)
  const den = denOf(state, hive);
  const g = hiveGuard(state, hive);
  const G = g ? g.size : 0;
  // In by one of the four mouths, the hive's dice for the group (the world's untouched): a group comes at a hive from
  // its own side every time, so a later party goes on from what the last one cleared on the way (with a mouth of each
  // party's own dice the war wore a hive down far slower: tools/grouphivetest.js, a fortress's 200 days became 278).
  // The group by its place among the groups (its id comes from a counter that runs on across worlds in one process).
  const ms = mouthsOf(den), gi = fid == null ? -1 : state.factions.findIndex((x) => x.id === fid);
  const mouth = ms[Math.floor(hash01(state.seed, "grpmouth", hive.id, gi) * ms.length) % ms.length];
  const path = shortestPath(den, mouth);
  const core = coreForce(state, hive, G);
  // What a brood costs a war party: the whole way in (the brood on the shortest way and in the core, full) is worth
  // the guard × (depth + 1) / depthDiv of its strength: a young hive about its guard, a deep one three times it.
  const full = path.reduce((a, id) => { const r = roomById(den, id); return a + (r.kind === "core" ? core.count : roomFull(state, hive, den, r, G)); }, 0);
  const unit = full > 0 ? (G * (den.depth + 1)) / (HCRAWL.GROUP.depthDiv * full) : 0;
  // The guard each brood it kills stands for: the guard spread over the brood on its way in (the den's brood comes to
  // the party along its way). Over the whole den's brood, as your teams' cutGuard, the round grid's side chambers
  // (2026-10-13: 13 chambers, under half the brood on the shortest way, where the old den's way held most of it)
  // made each kill worth a third of the guard it was: tools/grouphivetest.js, a fortress's 133 days became 334.
  const share = G / Math.max(1, full);
  let left = budget, met = 0, reached = 0, burned = false, killed = 0, stop = mouth;
  for (const id of path) {
    const r = roomById(den, id);
    stop = id;
    if (r.kind === "core") {
      const prep = groupPrep(state, fid);
      const cost = core.count * unit + (HCRAWL.GROUP.boss + HCRAWL.GROUP.bossTier * den.tier + (HIVEMIND.P2.on ? HCRAWL.GROUP.phase2 : 0)) * (1 - HCRAWL.GROUP.prep * prep.share); // its second phase too; their fire and bangs on it
      met += cost;
      reached = den.depth;
      prep.spend();
      if (left >= cost) { burned = true; killed += core.count; left -= cost; } else { killed += unit > 0 ? Math.min(core.count, Math.floor(left / unit)) : 0; left = 0; }
      break;
    }
    const n = broodLeft(state, hive, r, G);
    const cost = n * unit;
    met += cost;
    if (left >= cost) { left -= cost; killed += n; if (n) setLeft(state, hive, r, 0); reached = r.layer + 1; continue; }
    const k = unit > 0 ? Math.floor(left / unit) : n;
    killed += k;
    setLeft(state, hive, r, n - k);
    left = 0;
    break;
  }
  // Driven off: back out the shortest way to the nearest mouth (not always the one it came in by); the brood on it
  // that its way in did not clear is met again (it gets past them, at a cost: met).
  const out = burned ? [] : cheapestWay(den, stop, (x) => isMouth(den, x.id)) || [];
  for (const id of out) met += broodLeft(state, hive, roomById(den, id), G) * unit;
  const cut = Math.min(G, Math.round(killed * share));
  if (g && cut > 0) reduceHorde(state, g, cut);
  noteGroupCrawl(hive, fid, reached); // how deep its parties got (the State Map's hive panel)
  return { burned, cut, met: Math.round(met), reached, depth: den.depth, spent: Math.round(budget - left), mouth, path, out };
}

// A group about to send a war party makes Molotovs for the core first (coarse, AI parity with the autopilot's kit):
// up to GROUP.makeKit in its arsenal, each from GROUP.molotovFuel of its fuel (a bottle is always to be had). Returns
// how many it made.
export function groupMakeKit(state, f) {
  if (!f || !f.stock) return 0;
  const A = f.arsenal || null;
  const have = A ? A.items.filter((it) => it && it.key === "molotov").length : 0;
  let made = 0;
  for (let i = have; i < HCRAWL.GROUP.makeKit && (f.stock.fuel || 0) >= HCRAWL.GROUP.molotovFuel + 2; i++) {
    if (!addToArsenal(state, f, lootItem("molotov", "survivor", [state.seed, "grpmolotov", f.id, day(state), i]), "made for the hive")) break;
    f.stock.fuel -= HCRAWL.GROUP.molotovFuel;
    made++;
  }
  return made;
}
// What a group's war party brings for the Hivemind (coarse, AI parity): the Molotovs, flashbangs, frag grenades and
// pipe bombs in its arsenal (arsenal.js), up to GROUP.prepKit; share: what they bring of it; spend(): used at the core.
function groupPrep(state, fid) {
  const f = fid != null ? state.factions.find((x) => x.id === fid) : null;
  const items = f && f.arsenal ? f.arsenal.items.filter((it) => it && (FIRE_KEYS.includes(it.key) || STUN_KEYS.includes(it.key))).slice(0, HCRAWL.GROUP.prepKit) : [];
  return { share: items.length / HCRAWL.GROUP.prepKit, spend: () => { for (const it of items) removeFromArsenal(f, it, "the hive's core"); } };
}

// ---------- help ----------
export const HIVE_CRAWL_HELP = `A hive is destroyed from the inside. Send a team with the <b>Destroy hive</b> mission and choose <b>Enter the hive</b> on its card: the team crawls through the hive chamber by chamber, from one of its four mouths to the <b>core room</b>, where the <b>${BOSS_NAMES.hivemind}</b> sits, the organ that thinks for the hive. Kill it and the hive dies, its brood with it. A young hive is shallow (${HCRAWL.DEPTH[0]} chambers from the nearest mouth to the core); every tier it grows makes it deeper (${HCRAWL.DEPTH.join(", ")} by tier, one more with a screamer spire): the crawl is the mid and late game's work.<br>
<b>Four ways in.</b> The den has four entrances, one on each side (north, east, south and west), each with its own mouth and the brood in it. Choose one on the hive's card (it says what your teams know of each from earlier crawls); the autopilot picks the one with the least brood on its way in, the other groups' war parties any of them.<br>
<b>Finding the way.</b> The den is a round grid of chambers, as a city is of blocks: every chamber is a T, a hallway through it and a room off the side, so it opens on three of its sides (north, east, south, west) and the fourth is wall, shared with the chamber beside it (on the rim the outside is the wall; where the rim steps a chamber opens on only two). The core lies deep in the middle, and its walls open on only one or two sides. You see the passages out of every chamber you have been in; what lies beyond is dark until you go. Two things lead you to it. The <b>sound</b>: the Hivemind's beat, louder the nearer the core, carried through the walls (the gauge, the window's pulse, and each passage <i>louder</i> or <i>fainter</i>), so it tells you where the core is, but not where its door is: beside the wrong wall it beats loud, and there is no way through. The <b>warmth</b>: the air from the core runs only along the passages (the gauge, and the air: <i>cool and damp</i>, <i>close and clammy</i>, <i>warm as breath</i>, <i>hot</i>, <i>the walls sweat</i>), and every passage has a draft, <i>warmer</i> or <i>colder</i>, that leads round to a door. A team without a good scout misreads a draft now and then (${Math.round(HCRAWL.DRAFT.miss * 100)}% less ${Math.round(HCRAWL.DRAFT.perScout * 1000) / 10} a point of the best Scouting); the beat never lies. The warmer, the warmer the drone and the redder the window; the nearer, the louder and faster the beat (the mixer's <i>Hive crawl pulse</i>).<br>
<b>The brood.</b> Every chamber holds some of the hive's brood: more and tougher the deeper you go, the special dead the hive breeds among them, the elite deeper still, and the chambers next to the core the worst. A hive's guard horde is its brood: every one killed inside thins the guard, and a war party's crawl means emptier chambers. Nothing from outside the hive hurts it: no fires, no bombs; the crawl is the only way to kill a hive. Fight them (on a cave map or by the numbers), creep past (Stealth; they stay there and you meet them again on the way back), or fall back. Cleared chambers stay clear for about ${HCRAWL.REFILL_DAYS} days, then the brood flows back: you can crawl part of the way, come home to heal and come back. Kinds of chamber: tunnels, galleries, <i>nurseries</i> (many and weak), <i>egg chambers</i> (burn them with ${HCRAWL.BURN.fuel} fuel or a Molotov: the hive loses stores and some of its guard, and fills its chambers more slowly), <i>bone pits</i> (the remains of teams that came before: their worn guns, armour, packs, ammunition and meds), <i>worm pools</i> (the worm's eggs: wading through is a risk, feeling through the water more), the <i>roots</i> of the hive's growths (burn one to hurt the growth above), and collapses that lead nowhere.<br>
<b>The hive's Alert.</b> Moving, fighting, fire and a failed sneak make noise; lying still lets it fade. From ${HCRAWL.ALERT.converge} the brood converges on you: it pours into your chamber and fills the chambers behind you again; from ${HCRAWL.ALERT.block} it packs the mouths.<br>
<b>Getting out.</b> Leaving is a walk: chamber by chamber to any of the four entrances, into its mouth (its brood in the way if it is there), then <i>Leave by this mouth</i>. Back through chambers you have been in you go quietly (no Alert). A chamber you cleared and made noise in may have filled again when you walk back into it, and the brood you crept past is still there. <i>Fall back</i> takes you one chamber back the way you came; <i>Get out of the hive</i> only from a mouth.<br>
<b>Brood activity and heat.</b> Every chamber has its own brood activity, the hive's own (the same every visit; you learn it when you stand in it): ${HCRAWL.THREAT.names.slice(1).map((n, i) => `${n} ×${HCRAWL.THREAT.mult[i + 1]}`).join(", ")}. The noise you make in a chamber also stays there as its heat (less travelling stealthily), fading ${HCRAWL.HEAT.decay} an hour. The hive's Alert and the chamber's heat, × its activity, decide whether its brood has seen you, how hard it is to creep past, whether the brood pours in and how many, and whether a patrol finds you lying still: a little noise in a seething chamber is worse than a lot in a torpid one.<br>
<b>The ${BOSS_NAMES.hivemind}.</b> In the core the ${BOSS_NAMES.hive} and the last of the brood guard it. It never moves, but every turn it pulses (everyone within ${HIVEMIND.pulse} tiles hurt and sometimes stunned), lashes at anyone next to it, and every other turn tears more brood out of the walls. It has ${HIVEMIND.hp} health (+${HIVEMIND.perTier} a tier) and thick flesh. Below ${Math.round(HIVEMIND.P2.at * 100)}% it tears open in a <b>second phase</b>: the cave quakes and pillars of flesh come down, its pulse reaches ${HIVEMIND.P2.pulse} tiles and hits harder, and the walls give up ${HIVEMIND.P2.spawn[0]}–${HIVEMIND.P2.spawn[1]} brood at a time. Its death kills the brood around it.<br>
<b>Its weak spots.</b> Fire: a Molotov on it or next to it burns it ${HIVEMIND.WEAK.burnDmg[0]}–${HIVEMIND.WEAK.burnDmg[1]} a turn (through its thick flesh) for ${HIVEMIND.WEAK.burnTurns} of its turns after the last flames touch it, and while it burns the walls give up no brood. A bang: a flashbang within ${HIVEMIND.WEAK.flash} tiles stuns it for ${HIVEMIND.WEAK.stunFlash} of its turns, a frag grenade or a pipe bomb within ${HIVEMIND.WEAK.blast} for ${HIVEMIND.WEAK.stunBlast}: no pulse, no lash, no brood called, and its flesh lies open to your shots; a bang next to the ${BOSS_NAMES.hive} dazes her too (a flashbang costs her ${HIVEMIND.WEAK.dazeFlash} actions, a grenade ${HIVEMIND.WEAK.dazeBlast}). Fire panics the brood it calls: those near the flames (or near it while it burns) shy away and lose an action. The battle AI (and <i>AI plays my side</i>) steps into reach and throws them at it first, never with one of yours in the fire or the flash, and it holds on in a core it is winning with fire (its retreat counts the Hivemind burning or reeling and the Molotovs and bangs still in hand). By the numbers, Molotovs and bangs (up to ${HIVEMIND.NUMBERS.kit} of each) and lights count against its power. Bring them: preparation beats headcount. The autopilot packs lights, Molotovs, flashbangs, a grenade and road flares for its hive squads when the armory has them. The other groups crawl hives too (their war parties clear chambers on the shortest way and come back, and take the hoard of a hive they burn), and allied fighters thin the brood in every chamber.<br>
<b>The hoard.</b> In the dead core lies what the hive dragged in from the dead: guns, armour, rounds, meds, gun parts and scrap, now and then something rare (night vision, a thermal sight, a military radio, a surgical kit), all worn as the dead left it; more the higher the hive's tier and the fuller its stores. The team takes what fits (the best first); the rest stays at the hive, marked on the map: Recover it.<br>
<b>Lights, flares and listening.</b> The hive is dark. With the team's lights on (the default when anyone carries one: headlamp, flashlight, torch, lantern) the drafts out of your chamber are misread half as often, but the brood sees you coming (Alert +${HCRAWL.LIGHT.move} a move, creeping past a little harder); douse them in the window. In a fight in the hive someone without a light sees ${HCRAWL.LIGHT.dark} tiles, with one their light's reach + ${HCRAWL.LIGHT.lit}; by the numbers the brood in a chamber counts up to ${Math.round(HCRAWL.LIGHT.numbers * 100)}% more for the share of the team in the dark. A <b>road flare</b> thrown down a passage lights the chamber beyond: its kind, its brood exactly and the true draft (Alert +${HCRAWL.FLARE.alert}; found at gas stations, police and fire stations and campgrounds, made from scrap, fuel and a few rounds). <b>Listen</b> at a passage (${HCRAWL.LISTEN.hours} h): your best listener's (Scouting + Stealth) / 2 + d10 against ${HCRAWL.LISTEN.dc} (+${HCRAWL.LISTEN.perLayer} a chamber deep): well, the kind and the brood exactly; enough, the kind and roughly how many; poorly, a guess that can be wrong; badly, a noise that warns them (Alert +${HCRAWL.LISTEN.alert}, they wait for you). The autopilot listens with a good listener and throws flares without one.<br>
<b>Your record.</b> Every hive keeps what your teams learned of it: how deep they got, the chambers mapped, whether they found the core (the State Map's hive tile and its ⛏ label, the Goals card). When the hive grows deeper its chambers are new and the map starts again.`;
