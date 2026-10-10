// @ts-check
// The hive crawl: destroying a hive is not one battle at its mound but a crawl through it, chamber by chamber, from
// its mouth to the core room where the Hivemind sits, the organ that thinks for the hive. Kill the Hivemind and the
// hive dies (hives.js destroyHive). The mid-to-late game's content: a young hive is two chambers deep, a hive of the
// late game nine (DEPTH by hivetech.js hiveTier; a screamer spire grows it one deeper).
//
// The den (hive.den, made on first look from the world's seed and the hive: the same chambers every visit; regrown when
// the hive's tier deepens it) is a layered graph: the mouth, 2–4 chambers a layer, the core. Two routes that share no
// chamber run from the mouth to the core, with side branches, dead ends, pockets and lateral passages that make loops,
// so there is a real choice of which way to go round. Every chamber has a kind (tunnels, galleries, nurseries, egg
// chambers, bone pits, worm pools, the roots of the hive's growths, collapses) and a warmth from its distance to the
// core: the core is the hottest place in the hive, and each passage carries a draft that says whether it leads warmer
// or colder (a team with poor Scouting misreads one now and then: the visit's own dice, hash01, never the world's).
// The brood in a chamber grows with its depth (more of them, tougher, the special dead and the elite deeper; the
// chambers next to the core are the worst) and with the hive's guard horde (hives.js hiveGuard): the guard is the brood
// spread through the den, so each one killed inside takes its share of the guard (cutGuard), and a guard thinned by a
// war party's crawl means emptier chambers (nothing from outside the hive hurts it any more: no fires, no bombs). Cleared chambers stay clear for REFILL_DAYS (longer once its eggs are burned),
// then the brood flows back from the guard. The memory is the hive's (hive.denMem), so it is the same for your teams
// and the AI groups' war parties (groupHiveCrawl): the AI groups crawl the same den with the same depth, coarsely.
//
// The team's crawl is plain data on the team (p.hiveCrawl), saved and loaded mid-crawl like the city crawl's p.crawl:
//   { v, hiveId, tile, name, at (the chamber), from, trail (the way back to the mouth), visited, seen, slipped (crept
//     past this visit), alert, enc (what is in front of the team), leaving, kills, lost, log, tally, deepest, started }
// The hive's Alert (0–100) rises with noise (fights, fire, a failed sneak) and fades lying still; from CONVERGE the
// brood converges on the team (a swarm in the chamber, cleared chambers behind it filling again), from BLOCK the
// mouth packs up behind it.
//
// Hooks elsewhere (small): hives.js hiveCard (Enter the hive), parties.js arrive; conflicts.js engagedWith (the crawl
// holds the team); combat.js registerBossAI (the Hivemind's own turn and death), shotPri; defences.js BOSSES.hivemind;
// worm.js (one of the team turning inside); autopilot.js (hiveChoice, idleTeams: hiveCrawlAutoStep, the campaign's
// estimates: crawlEstimate); factions.js groupHiveWar (groupHiveCrawl); ui/hivecrawl.js (the window), ui/hivecrawlsfx.js
// (the pulse and the drone that grow with the warmth), ui/ui.js and main.js.
import { keyWord } from "./water.js"; // supplies as words: "9mm FMJ", "rounds"
import { Rng } from "./rng.js";
import { hash01, gainXpAll, USE } from "./skills.js";
import { SUPPLIES, GEAR } from "./data.js";
import { log, hurt, tickHour, day, snapshot, survivorById } from "./world.js";
import { partyMembers, partyTile, bestSkill, awaitOrders, wipeParty, tileLabel, teamName, cargoRoom, unitsThatFit } from "./parties.js";
import {
  registerCombatHandler, registerBattleLayout, registerBattleSize, registerBossAI, startCombat, autoResolveCombat, finishCombat, byNumbersOdds,
  say, fx, damage, enemyUnit, active, reachable, pathTo, moveAlong, los,
} from "./combat.js";
import { fightNow, bossUnit, placeUnitRight } from "./defences.js";
import { hiveById, hiveGuard, broodForce, destroyHive, molotovsOf } from "./hives.js";
import { hiveTier, hiveMods, markThreat, growthsOf, growthById, destroyGrowth } from "./hivetech.js";
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
import { SHELLS, usesInternal } from "./mags.js";
import { gunMods } from "./gunmods.js";
import { calOf } from "./ammo.js";
import { typeFor, keyFor, withHand } from "./rounds.js";

// ---------- tuning ----------
export const HCRAWL = {
  DEPTH: [2, 3, 5, 7, 9],       // chambers from the mouth to the core room on the shortest way (moves), by hive tier 0–4
  SPIRE_DEPTH: 1,               // a screamer spire grown at the hive makes it one deeper
  WIDTH: [[2, 2], [2, 3], [2, 3], [2, 4], [3, 4]], // chambers in each layer between the mouth and the core, by tier
  FORWARD: 0.5, LATERAL: 0.3, CROSS: 0.2, POCKET: 0.4, CORE_EXTRA: 0.35, // the den's extra passages and side pockets
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
  // block the mouth packs up behind you.
  ALERT: { start: 10, visit: 6, move: 2, fight: 10, mapFight: 6, burn: 12, search: 3, sneakFail: 8, decay: 3, lie: 15, converge: 60, swarm: 0.3, refill: 0.25, block: 85,
    names: ["Dormant", "Stirring", "Restless", "Roused", "Swarming"] },
  // Creeping past a chamber's brood: best Stealth + d10 against dc + perLayer × layer + Alert × perAlert (+ big a
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
// P2: its second phase, below `at` of its health (once): the pulse reaches further and hits harder (pulse, pulseDmg,
// stun), the walls give up brood every spawnEvery turns (spawn), cap more of them, and the cave quakes (quake: pillars
// of flesh and bone come down in the open, everyone of yours caught under one hurt quakeDmg at quakeHit odds).
export const HIVEMIND = { hp: 480, perTier: 60, pulse: 3, pulseDmg: [4, 10], stun: 0.35, lash: [16, 30], spawnEvery: 2, spawn: [2, 3], cap: 8, capTier: 1, power: 13, powerTier: 20, broodPower: 9, numbersK: 0.6,
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
HIVEMIND.NUMBERS = { lit: 0.425, fire: 0.55, stun: 0.15, kit: 2 };
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
  collapse: { short: "C", name: "Collapsed tunnel", brood: 0, power: 1, special: false, size: [24, 14], text: "The roof has come down. Rubble and flesh seal the far end: nothing lives here, and there is no way on." },
  core:     { short: "★", name: "The core", brood: 0, power: 1, special: false, size: [34, 22], text: "The heart of the hive." },
};
const DRAFT_WORD = { warmer: "warmer", colder: "colder", level: "no draft" };

// ---------- helpers ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const seedOf = (...parts) => Math.floor(hash01(...parts) * 4294967296);
const partyById = (state, id) => state.parties.find((x) => x.id === id) || null;
export const alertName = (a) => HCRAWL.ALERT.names[clamp(Math.floor(a / 20), 0, 4)];
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
  return HCRAWL.DEPTH[t] + (hiveMods(state, hive).spire ? HCRAWL.SPIRE_DEPTH : 0);
}
// The hive's den, made on first use (and again, keeping what it remembers, when the hive has grown deeper).
export function denOf(state, hive) {
  const depth = denDepth(state, hive);
  if (hive.den && hive.den.v === 1 && hive.den.depth === depth) return hive.den;
  // Not while a team is inside: its chamber, trail and the chambers it has seen are this den's (the progression census
  // of 2026-10-09, seed 6002: a hive reached tier 1 with a team in a side pocket that the deeper den does not have,
  // and the crawl crashed on the missing chamber). It deepens once the team is out.
  if (hive.den && hive.den.v === 1 && state.parties.some((p) => p.hiveCrawl && p.hiveCrawl.hiveId === hive.id)) return hive.den;
  const grew = !!hive.den;
  hive.den = genDen(state, hive, depth, clamp(hiveTier(state, hive), 0, 4));
  if (grew) {
    hive.den.grew = state.hour;
    if (hive.crawlRec) { hive.crawlRec.mapped = {}; hive.crawlRec.core = false; hive.crawlRec.coreHeard = false; hive.crawlRec.grew = day(state); } // its chambers are new: the map starts again
  }
  return hive.den;
}
export const roomById = (den, id) => den.rooms.find((r) => r.id === id) || null;
// The den's chambers and passages, by the world's seed and the hive (no state dice): the same den every visit.
export function genDen(state, hive, depth, tier) {
  const rng = new Rng(seedOf(state.seed, "hiveden", hive.id, hive.tile, depth));
  const rooms = [];
  const add = (id, layer, slot, kind = null, pocket = false) => { const r = { id, layer, slot, kind, links: [], dist: 0, pocket }; rooms.push(r); return r; };
  const link = (a, b) => { if (!a || !b || a === b || a.links.includes(b.id)) return; a.links.push(b.id); b.links.push(a.id); };
  const mouth = add("m", 0, 0, "mouth");
  const layers = [[mouth]];
  const [wlo, whi] = HCRAWL.WIDTH[tier];
  for (let L = 1; L < depth; L++) {
    const w = rng.int(wlo, whi), row = [];
    for (let s = 0; s < w; s++) row.push(add(`r${L}-${s}`, L, s));
    layers.push(row);
  }
  const core = add("core", depth, 0, "core");
  layers.push([core]);
  // Two routes from the mouth to the core that share no chamber.
  let a = mouth, b2 = mouth;
  const spine = new Set();
  for (let L = 1; L < depth; L++) {
    const row = layers[L];
    const ia = rng.int(0, row.length - 1), ib = (ia + 1 + rng.int(0, row.length - 2)) % row.length;
    link(a, row[ia]); link(b2, row[ib]);
    a = row[ia]; b2 = row[ib];
    spine.add(a.id); spine.add(b2.id);
  }
  link(a, core); link(b2, core);
  // The rest: each chamber reached from the layer before, a way on now and then (else a dead end).
  for (let L = 1; L < depth; L++) {
    for (const r of layers[L]) {
      if (spine.has(r.id)) continue;
      link(r, rng.pick(layers[L - 1]));
      if (rng.chance(HCRAWL.FORWARD)) link(r, L + 1 < depth ? rng.pick(layers[L + 1]) : rng.chance(HCRAWL.CORE_EXTRA) ? core : null);
    }
  }
  // Passages within a layer (loops) and across the routes.
  for (let L = 1; L < depth; L++) {
    const row = layers[L];
    for (let s = 0; s + 1 < row.length; s++) if (rng.chance(HCRAWL.LATERAL)) link(row[s], row[s + 1]);
    if (L + 1 < depth && rng.chance(HCRAWL.CROSS)) link(rng.pick(row), rng.pick(layers[L + 1]));
  }
  // Side pockets: a dead-end chamber off one of the layer's.
  for (let L = 1; L < depth; L++) if (rng.chance(HCRAWL.POCKET)) link(add(`p${L}`, L, layers[L].length, null, true), rng.pick(layers[L]));
  // Distances to the core (the warmth), the way on (dead ends), and the kinds.
  const byId = new Map(rooms.map((r) => [r.id, r]));
  for (const r of rooms) r.dist = Infinity;
  core.dist = 0;
  const q = [core];
  while (q.length) { const r = q.shift(); for (const id of r.links) { const n = byId.get(id); if (n.dist > r.dist + 1) { n.dist = r.dist + 1; q.push(n); } } }
  const growths = growthsOf(state, hive);
  let gi = 0;
  for (const r of rooms) {
    if (r.kind) continue;
    const on = r.links.some((id) => byId.get(id).layer > r.layer);
    r.dead = !on;
    const w = on
      ? { tunnel: 3, gallery: 2.5, nursery: r.layer >= 2 ? 1.5 : 0.4, pool: r.layer >= 2 ? 1 : 0.3, eggs: 1, growth: growths.length ? 1.2 : 0, bones: 0.6 }
      : { bones: 2, eggs: 1.5, collapse: 1.5, pool: 1, nursery: 0.5, growth: growths.length ? 0.8 : 0 };
    r.kind = rng.weighted(Object.keys(w), (k) => w[k]);
    if (r.kind === "growth") { const g = growths[gi++ % growths.length]; r.gid = g.id; r.gkind = g.kind; }
  }
  return { v: 1, depth, tier, mouth: mouth.id, core: core.id, width: Math.max(...layers.map((l) => l.length)) + 1, rooms };
}
// The chamber next to the core (its brood is the worst).
const nearCore = (den, room) => room.links.includes(den.core);
// The shortest way from a chamber to the core, by the distances (ids, the core last).
export function shortestPath(den, fromId = den.mouth) {
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
// Warmth 0–100: the core 100, falling with the distance to it (the mouth 100 / (depth + 1)).
export const warmthOf = (den, room) => (room ? clamp(Math.round(100 * (1 - room.dist / (den.depth + 1))), 0, 100) : 0);
export function warmthText(w) {
  return w >= 90 ? "the walls sweat and the air is hot and thick; something vast beats close by" : w >= 70 ? "hot: the walls pulse under your hand" : w >= 50 ? "warm as breath" : w >= 30 ? "close and clammy" : "cool and damp";
}
export const roomName = (room, state = null) => {
  if (!room) return "?";
  if (room.kind === "growth" && room.gkind && GROWTHS[room.gkind]) return `Root of the ${GROWTHS[room.gkind].name.toLowerCase()}`;
  return ROOM_KINDS[room.kind] ? ROOM_KINDS[room.kind].name : room.kind;
};

// "the tunnel", "the mouth", "the root of the brood chamber".
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
function broodTypes(state, hive, n, layer) {
  const kinds = hiveMods(state, hive).unlocks;
  if (!kinds.length || n < 2) return null;
  const S = HCRAWL.SPECIAL;
  const k = Math.round(n * Math.min(S.max, S.base + S.perLayer * layer));
  if (k <= 0) return null;
  const out = {};
  for (let i = 0; i < k; i++) { const kind = kinds[(i + layer) % kinds.length]; out[kind] = (out[kind] || 0) + 1; }
  return out;
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
// Every brood of the den when full (the core's too): the guard spread through it (cutGuard).
export function denBroodTotal(state, hive, G = guardSize(state, hive)) {
  const den = denOf(state, hive);
  return den.rooms.reduce((a, r) => a + roomFull(state, hive, den, r, G), 0) + coreForce(state, hive, G).count;
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

// Into the hive (the hive card's Enter the hive): at its mouth, the brood of the mouth in front.
export function startHiveCrawl(state, p, hive) {
  const den = denOf(state, hive);
  const mem = memOf(hive);
  mem.visits += 1;
  const left = Math.max(0, (mem.lastAlert || 0) - (state.hour - (mem.lastHour || 0)));
  p.phase = "engaged";
  p.hiveCrawl = {
    v: 1, hiveId: hive.id, tile: hive.tile, name: hive.name, visit: mem.visits, started: state.hour,
    at: den.mouth, from: null, trail: [den.mouth], visited: { [den.mouth]: true }, seen: {}, slipped: {},
    alert: clamp(Math.round(Math.max(HCRAWL.ALERT.start, left)), 0, 100), enc: null, leaving: false, deepest: 0,
    kills: 0, lost: [], log: [], tally: { supplies: {}, gear: [] }, hadVehicle: !!p.vehicle,
    lit: true, heard: {}, warned: {},
  };
  const c = p.hiveCrawl;
  const rec = crawlRecOf(state, hive);
  rec.visits += 1;
  markSeen(den, c, den.mouth);
  markThreat(state, hive); // hivetech.js: it builds for defence
  hive.playerDay = day(state); // hives.js notePlayerFight: a group fighting it warms to you
  const mouth = roomById(den, den.mouth);
  const lights = teamLights(state, p);
  say2(c, `${teamName(state, p)} ${partyMembers(state, p).length === 1 ? "goes" : "go"} into ${hive.name}. ${den.grew ? "It has grown deeper since anyone was last inside. " : ""}The air is ${warmthText(warmthOf(den, mouth))}. ${lights ? `${lights} light${lights === 1 ? "" : "s"} on.` : "Nobody has a light: you feel your way in the dark."}`, "info", state.hour);
  log(state, `${teamName(state, p)} crawls into ${hive.name}.`, "info");
  enterRoom(state, p, c, mouth, null);
  return true;
}
const markSeen = (den, c, id) => { const r = roomById(den, id); if (r) for (const n of r.links) c.seen[n] = true; };

// The team walks into a chamber: what waits there.
function enterRoom(state, p, c, room, from) {
  const hive = crawlHive(state, c);
  if (!hive) { crawlGone(state, p); return; }
  const den = denOf(state, hive);
  c.from = from;
  c.at = room.id;
  const i = c.trail.indexOf(room.id);
  if (i >= 0) c.trail.length = i + 1; else c.trail.push(room.id);
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
  const look = `${roomName(room)}: ${fresh ? K.text + " " : ""}The air is ${warmthText(warmthOf(den, room))}.`;
  if (n > 0 && !c.slipped[room.id]) {
    const spotted = (c.warned && c.warned[room.id]) || (c.alert >= 50 && hash01(state.seed, "hcspot", c.hiveId, room.id, c.visit, state.hour) < (c.alert - 40) / 100); // warned: a listener they heard

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
    converge(state, p, c);
  }
  return true;
}
const addAlert = (c, v) => { c.alert = clamp(c.alert + v, 0, 100); };
// From ALERT.converge the brood comes for the team (an hour's roll): a swarm into its chamber, cleared chambers on the
// way back filling again; from ALERT.block the mouth packs up.
function converge(state, p, c) {
  const A = HCRAWL.ALERT;
  if (c.alert < A.converge || c.enc || state.combat) return;
  const hive = crawlHive(state, c);
  if (!hive) return;
  const den = denOf(state, hive);
  const rng = state.rng;
  const over = (c.alert - A.converge) / (100 - A.converge);
  if (rng.chance(A.refill * (0.5 + over))) {
    const back = c.trail.slice(0, -1).map((id) => roomById(den, id)).filter((r) => r && broodLeft(state, hive, r) === 0 && roomFull(state, hive, den, r) > 0);
    if (back.length) {
      const r = rng.pick(back);
      setLeft(state, hive, r, Math.ceil(roomFull(state, hive, den, r) / 2));
      say2(c, `Behind you the brood is flowing back into ${roomThe(r)}.`, "danger", state.hour);
    }
  }
  if (c.alert >= A.block) {
    const m = roomById(den, den.mouth);
    if (broodLeft(state, hive, m) === 0 && roomFull(state, hive, den, m) > 0 && c.at !== den.mouth) { setLeft(state, hive, m, roomFull(state, hive, den, m)); say2(c, "The hive is roused: the brood has packed the mouth behind you.", "danger", state.hour); }
  }
  if (rng.chance(A.swarm * over)) {
    const room = roomById(den, c.at);
    const n = clamp(Math.round(2 + room.layer * 0.5 + (c.alert - A.converge) / 10), 2, 12);
    c.enc = { kind: "swarm", room: room.id, back: c.from, spotted: true, enemy: { kind: "zombies", count: n, power: roomPower(state, hive, den, room), types: broodTypes(state, hive, n, room.layer + 1), elite: false, name: "the brood converging on you" } };
    say2(c, `The hive is roused: ${n} of the brood pour into ${roomThe(room)} from the dark.`, "danger", state.hour);
  }
}

// The passages out of the team's chamber: { id, room (null: not been there), draft (as the team reads it), visited,
// dist (the real one, for the tools) }.
export function exitsOf(state, p) {
  const c = hiveCrawlOf(state, p);
  if (!c) return [];
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const here = roomById(den, c.at);
  return here.links.map((id) => {
    const r = roomById(den, id);
    return { id, room: c.visited[id] ? r : null, kind: c.visited[id] ? r.kind : null, draft: draftOf(state, p, c, den, here, r), visited: !!c.visited[id], back: id === c.from, core: id === den.core && !!c.visited[id], heard: (c.heard && c.heard[id]) || null };
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
    if (take > 0) { p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + take; tally.supplies[k] = (tally.supplies[k] || 0) + take; room -= take * SUPPLIES[k].weight; got.push(`${take} ${SUPPLIES[k].name.toLowerCase()}`); }
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

// Move to a chamber next to this one (an hour).
export function moveTo(state, p, id) {
  const c = hiveCrawlOf(state, p);
  if (!c) return "The team is not in a hive.";
  if (c.enc) return "Deal with what is in front of you first.";
  if (c.leaving) return "The team is on its way out.";
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const here = roomById(den, c.at);
  const to = roomById(den, id);
  if (!to || !here.links.includes(id)) return "No passage leads there.";
  if (!canMoveOn(state, c) && id !== c.from) return "The brood is still in this chamber: fight it, creep past, or go back the way you came.";
  addAlert(c, HCRAWL.ALERT.move + (lightsOn(state, p, c) ? HCRAWL.LIGHT.move : 0)); // lights: the brood sees them coming
  if (!passHours(state, p, HCRAWL.MOVE_HOURS)) return goneText(state, p);
  if (!p.hiveCrawl) return "";
  if (c.enc) return ""; // the brood came for you on the way (converge)
  if (to.kind === "pool") wormSearch(state, p, c.tile, HCRAWL.POOL_WORM); // worm.js: wading through it
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
  if (e.back || e.kind === "core") out.push({ id: "back", label: "Fall back", tip: `Back to the chamber you came from (an hour): each of you about ${Math.round(backHurt(room) * 100)}% to be hurt getting away.`, odds: 1 });
  else out.push({ id: "out", label: "Get out of the hive", tip: `Back out through the mouth: each of you about ${Math.round(backHurt(room) * 100)}% to be hurt getting away.`, odds: 1 });
  return out;
}
const backHurt = (room) => Math.min(0.9, HCRAWL.BACK.hurt + HCRAWL.BACK.perLayer * (room ? room.layer : 0));
export function sneakOdds(state, p, c, room, e = c.enc) {
  const S = HCRAWL.SNEAK;
  const n = partyMembers(state, p).length;
  const dc = Math.ceil(S.dc + S.perLayer * room.layer + c.alert * S.perAlert + Math.max(0, n - 3) * S.big + (e && e.spotted ? S.spotted : 0) + (lightsOn(state, p, c) ? HCRAWL.LIGHT.sneak : 0));
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
    if (choice === "out" || !e.back) return finishHiveCrawl(state, p, "The team fell back out of the hive.");
    const to = roomById(den, e.back);
    c.trail = c.trail.filter((id) => id !== room.id);
    c.from = c.trail.length > 1 ? c.trail[c.trail.length - 2] : null;
    c.at = to.id;
    if (c.trail[c.trail.length - 1] !== to.id) c.trail.push(to.id);
    if (broodLeft(state, hive, to) > 0 && !c.slipped[to.id]) enterRoom(state, p, c, to, c.from); // it filled again behind you
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
  // Broken off or beaten back: to the chamber the team came from, or out of the hive from the mouth.
  if (!e.back) { finishHiveCrawl(state, p, "Beaten back, the team stumbled out of the hive."); return; }
  const den = denOf(state, hive);
  c.trail = c.trail.filter((id) => id !== e.room);
  c.at = e.back;
  if (c.trail[c.trail.length - 1] !== e.back) c.trail.push(e.back);
  c.from = c.trail.length > 1 ? c.trail[c.trail.length - 2] : null;
  say2(c, `You fall back to ${roomThe(roomById(den, e.back))}.`, "danger", state.hour);
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
  const risk = c.alert >= 40 ? 0.05 + c.alert / 500 : 0;
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
    if (take > 0) { p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + take; c.tally.supplies[k] = (c.tally.supplies[k] || 0) + take; room -= take * SUPPLIES[k].weight; got.push(`${take} ${keyWord(k)}`); }
    if (q - take > 0) left.push(`${q - take} ${keyWord(k)}`);
  }
  for (const g of gear) {
    if (!g) continue;
    if (room >= itemLoad(g)) { p.cargo.gear.push(g); c.tally.gear.push(g.name); room -= itemLoad(g); got.push(g.name); } else left.push(g.name);
  }
  return `${got.length ? got.join(", ") : "nothing useful"}${left.length ? ` (no room for ${left.join(", ")})` : ""}`;
}

// ---------- leaving ----------
// Back out the way the team came, a chamber an hour; a chamber that filled again (or one it crept past) is in the way.
export function leaveHive(state, p) {
  const c = hiveCrawlOf(state, p);
  if (!c) return "The team is not in a hive.";
  if (c.enc) return "Deal with what is in front of you first.";
  c.leaving = true;
  say2(c, "You turn back for the mouth.", "info", state.hour);
  return stepOut(state, p);
}
export function stepOut(state, p) {
  const c = hiveCrawlOf(state, p);
  if (!c || c.enc) return "";
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  for (let guard = 0; guard < 40 && p.hiveCrawl && !c.enc; guard++) {
    const here = roomById(den, c.at);
    if (here.id === den.mouth && (broodLeft(state, hive, here) === 0 || c.slipped[here.id] || c.trail.length <= 1)) return finishHiveCrawl(state, p, "");
    const back = c.trail.length > 1 ? c.trail[c.trail.length - 2] : den.mouth;
    const to = roomById(den, back);
    if (!passHours(state, p, HCRAWL.BACK_HOURS)) return goneText(state, p);
    if (!p.hiveCrawl || c.enc) return "";
    c.trail.pop();
    c.from = here.id; // fall back = deeper again
    c.at = to.id;
    if (broodLeft(state, hive, to) > 0) {
      c.enc = { kind: "brood", room: to.id, back: here.id, spotted: c.alert >= 50 };
      say2(c, `On the way out: ${roomThe(to)} is full of the brood again (${broodLeft(state, hive, to)}).`, "danger", state.hour);
      return "";
    }
    if (to.id === den.mouth) return finishHiveCrawl(state, p, "");
  }
  return "";
}
// opts.orders false: the team's orders wait (crawlGone, while its battle is on).
export function finishHiveCrawl(state, p, extra = "", opts = {}) {
  const c = p.hiveCrawl;
  if (!c) return "";
  const hive = crawlHive(state, c);
  if (hive) { const mem = memOf(hive); mem.lastAlert = c.alert; mem.lastHour = state.hour; }
  delete p.hiveCrawl;
  const got = [...Object.entries(c.tally.supplies).map(([k, v]) => `${v} ${SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : k}`), ...c.tally.gear];
  const den = hive ? denOf(state, hive) : null;
  const text = `${extra ? extra + " " : ""}Out of ${c.name} after ${state.hour - c.started} h, ${c.deepest ? `${c.deepest} chamber${c.deepest === 1 ? "" : "s"} deep${den ? ` of ${den.depth}` : ""}` : "no deeper than the mouth"}, ${c.kills} of the brood killed${got.length ? `, with ${got.join(", ")}` : ""}.${c.lost.length ? ` Lost: ${c.lost.join(", ")}.` : ""}`;
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
//     swap takes one for a magazine's worth, an internal magazine one for its Reload's worth (data-kit.js INTERNAL),
//     a shotgun one for the shells a Reload thumbs in (mags.js SHELLS: a pump 2–3, +1 steady hands at Shooting 6,
//     +1 a side-saddle; a double barrel both barrels) and one Get shells for every GRAB beyond the gun and what is at
//     hand (the shells in the pockets and the rig, the loose handful, a side-saddle's).
// A pump at Shooting 7 with the trip's shells at hand: reach 0.62 (14 aim lost of 67, buckshot × 0.8) × sustain 0.86;
// a hunting rifle 1 × 0.82; an assault rifle 1 × 1. The bosses' power (numbersK) is fitted against it.
HIVEMIND.REACH = { range: 6, melee: 0.35, shots: 14 };
// What coreFire needs to know of a fighter (also the fit's: tools/hivecorecalib.js): { p (combat power), melee, aim,
// opt, fall, type (the load: its spread), sustain }. packed: a squad not yet packed for the trip (the autopilot's gate):
// a shotgunner will carry SHELLS.CARRY at hand (carrykit.js packShells).
export function fireOf(s, packed = false) {
  const it = s.gear && s.gear.weapon, g = it ? GEAR[it.key] : null, W = it ? WEAPONS[it.key] : null;
  const p = combatPower(s);
  if (!g || g.cat === "melee" || !W || W.melee) return { p, melee: true };
  const cal = calOf(it.key), type = cal ? typeFor(cal, it.load) : null;
  const shoot = skill(s, "shooting"), aim = 40 + 2.5 * shoot + (W.aim || 0);
  const shots = HIVEMIND.REACH.shots, need = shots * (W.ammo || 1), cap = Math.max(1, W.cap || 1);
  let per = cap, fetch = 0;
  const shell = SHELLS.on && SHELLS.GUNS[it.key] && usesInternal(it.key, it) ? SHELLS.GUNS[it.key] : null;
  if (shell) {
    const saddle = shell === "tube" ? Math.max(0, gunMods(it).reload || 0) : 0;
    const steady = 40 + 2.5 * shoot >= SHELLS.STEADY_AIM ? 1 : 0;
    per = shell === "break" ? SHELLS.BREAK : shell === "single" ? 1 : Math.max(SHELLS.MIN, Math.min(SHELLS.MAX + saddle, (SHELLS.BASE[0] + SHELLS.BASE[1]) / 2 + steady + saddle));
    const keys = cal ? withHand(keyFor(cal, type)) : [];
    let box = 0;
    for (const x of carriedSpots(s)) if ((x.where === "pocket" || x.where === "rig") && x.item && keys.includes(x.item.key)) box += Math.max(0, Math.floor(x.item.dur || 0));
    const boxN = Math.max(packed ? SHELLS.CARRY : 0, box); // the gun loads out of the box first (mags.js shellsAt), the loose handful tops up to START_HAND
    const at = Math.max(0, boxN - cap) + Math.max(0, SHELLS.START_HAND - Math.max(0, boxN - cap)) + (saddle > 0 ? SHELLS.SADDLE : 0);
    fetch = Math.max(0, need - cap - at) / SHELLS.GRAB;
  } else if (INTERNAL[it.key] && usesInternal(it.key, it)) per = INTERNAL[it.key];
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
    const back = c.from || (den ? shortestPath(den).slice(-2)[0] : null);
    if (back && den) { c.trail = c.trail.filter((id) => id !== den.core); c.at = back; if (c.trail[c.trail.length - 1] !== back) c.trail.push(back); c.from = c.trail.length > 1 ? c.trail[c.trail.length - 2] : null; }
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
  const taken = b.units.find((u) => u.x === hx && u.y === cy);
  if (taken) { if (!placeUnitRight(b, ctx, taken, Math.max(0, hx - 10), hx - 2)) taken.x = Math.max(0, hx - 6); }
  hm.x = hx; hm.y = cy;
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
// The Hivemind's weak spots at the start of its turn (HIVEMIND.WEAK): what landed near it since its last turn
// (throwables.js b.landed) and the flames around it. Returns { burning, stunned } for this turn.
function weakSpots(b, u, st) {
  const W = HIVEMIND.WEAK, rng = b.rng;
  const cheb = (x, y) => Math.max(Math.abs(x - u.x), Math.abs(y - u.y));
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
  const d = Math.hypot(t.x - u.x, t.y - u.y);
  const clear = (r) => !b.units.some((o) => o.side === t.side && active(o) && Math.max(Math.abs(o.x - u.x), Math.abs(o.y - u.y)) <= r);
  const burning = (st.burnLeft || 0) > 0 || (b.fires || []).some((c) => Math.max(Math.abs(c.x - u.x), Math.abs(c.y - u.y)) <= W.near);
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
      const dd = Math.hypot(x - u.x, y - u.y), ch = Math.max(Math.abs(x - u.x), Math.abs(y - u.y));
      if (dd > range || ch <= pulse || !los(b, x, y, u.x, u.y)) continue;
      if (!best || c < best.c) best = { x, y, c };
    }
    if (!best) return null;
    t.ap -= 1;
    moveAlong(b, t, pathTo(r, best.x, best.y));
    if (!active(t) || t.ap < 1) return null;
  }
  if (throwBlind(b, t, u.x, u.y) === null) return null;
  return { item: key, x: u.x, y: u.y };
}
// The Hivemind's turn (combat.js registerBossAI): the pulse, a lash, the brood out of the walls.
// The battle AI's outlook on it (combat.js fightOutlook): burning or reeling it counts for less, and the fire and bangs
// your side still has for it count for you (HIVEMIND.WEAK outlook).
function hivemindOutlook(b, u) {
  const W = HIVEMIND.WEAK, st = b.hivemind || {};
  const burning = (st.burnLeft || 0) > 0 || (b.fires || []).some((c) => Math.max(Math.abs(c.x - u.x), Math.abs(c.y - u.y)) <= W.near);
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
  const near = (z) => (at ? cheb(z, at.x, at.y) <= W.panic + 1 : cheb(z, u.x, u.y) <= W.panicNear) || (b.fires || []).some((c) => cheb(z, c.x, c.y) <= W.panic);
  const shy = b.units.filter((z) => z.called && z.side === "enemy" && active(z) && !z.reel && near(z));
  for (const z of shy) z.reel = { next: nextTurnOf(b, z), why: "the flames around the Hivemind" };
  if (shy.length) { st.panicked = (st.panicked || 0) + shy.length; say(b, `${shy.length} of the brood it called shy away from the flames.`, "good"); }
}
// The Broodmother dazed by a bang next to her (HIVEMIND.WEAK daze): actions lost on her next turn.
registerBossAI("broodmother", {
  onLand(b, u, L) {
    const W = HIVEMIND.WEAK;
    if (L.side !== "player" || !active(u)) return;
    const d = Math.max(Math.abs(L.x - u.x), Math.abs(L.y - u.y));
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
    const cheb = (o) => Math.max(Math.abs(o.x - u.x), Math.abs(o.y - u.y));
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
    const lash = weak.stunned ? [] : foes.filter((o) => active(o) && cheb(o) <= 1);
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
      for (let y = u.y - 6; y <= u.y + 6; y++) for (let x = u.x - 8; x <= u.x + 1; x++) {
        if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
        const c = b.cells[y * b.w + x];
        if (c.k !== "open" || !b.reach[y * b.w + x] || b.units.some((o) => o.x === x && o.y === y && !o.dead && !o.left)) continue;
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
      if (!ok && p.hiveCrawl && !p.hiveCrawl.enc) { p.hiveCrawl.leaving = true; say2(p.hiveCrawl, "The core is too much for the team as it is: it turns back, to come again.", "danger", state.hour); }
      return;
    }
    const num = get("numbers"), sneak = get("sneak");
    const pick = num && num.odds >= A.sureOdds ? "numbers" : sneak && sneak.odds >= A.sneakOdds && !c.enc.spotted && !c.leaving ? "sneak" : num && num.odds >= A.fightOdds ? "numbers" : get("back") ? "back" : "out";
    resolveHiveEnc(state, p, pick, { map: false });
    if (pick !== "numbers" && pick !== "sneak") { const cc = p.hiveCrawl; if (cc && !cc.enc) cc.leaving = true; }
    return;
  }
  if (c.leaving) { stepOut(state, p); return; }
  const acts = roomActions(state, p);
  if (members.some((s) => s.health < A.treat) && acts.some((a) => a.id === "treat" && !a.disabled)) { roomAct(state, p, "treat"); return; }
  if (hurtBad >= 2 || fit < Math.max(2, Math.ceil(members.length / 2))) { say2(c, "Too many hurt: the team turns back.", "danger", state.hour); leaveHive(state, p); return; }
  if (c.alert >= A.lie) { roomAct(state, p, "lie"); return; }
  const burn = acts.find((a) => a.id === "burn" && !a.disabled);
  if (burn && c.alert < 50) { roomAct(state, p, "burn"); return; }
  const search = acts.find((a) => a.id === "search" && !a.disabled);
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  if (search && crawlRoom(state, c).kind === "bones") { roomAct(state, p, "search"); return; }
  if (!canMoveOn(state, c)) { leaveHive(state, p); return; }
  // Two or more ways on that do not read colder and that it knows nothing of: a good listener listens at the first
  // (an hour), else a flare goes down it while the hive is quiet (the window's Listen and Flare).
  const unknown = exitsOf(state, p).filter((x) => !x.visited && !x.heard && x.draft !== "colder").sort((a, b) => a.id.localeCompare(b.id));
  if (unknown.length >= 2 && c.alert < A.lie - 10) {
    if (listener(state, p).v >= HCRAWL.LISTEN.auto) { listenAt(state, p, unknown[0].id); return; }
    if (c.alert < 40 && flaresOf(state, p).length) { throwFlare(state, p, unknown[0].id); return; }
  }
  const next = autoNext(state, p, c, den);
  if (!next) { leaveHive(state, p); return; }
  moveTo(state, p, next);
}
// The next chamber on the autopilot's way: a passage with a warmer draft it has not taken, else any it has not taken
// (not back), else the first step toward the nearest chamber it knows of and has not been in.
function autoNext(state, p, c, den) {
  const ex = exitsOf(state, p).filter((x) => !(x.visited && x.room && (x.room.kind === "collapse" || x.room.dead && !ROOM_KINDS[x.room.kind].burn && !ROOM_KINDS[x.room.kind].search)));
  const fresh = ex.filter((x) => !x.visited && !(x.heard && x.heard.q !== "vague" && x.heard.kind === "collapse")); // heard or lit: a dead end
  // What it knows of a way on (listening, a flare): the core first, then the fewest of the brood; unknown ones as 6.
  const est = (x) => (!x.heard ? 6 : x.heard.kind === "core" && x.heard.q !== "vague" ? -1 : x.heard.q === "exact" ? x.heard.n : (x.heard.lo + x.heard.hi) / 2);
  const warm = fresh.filter((x) => x.draft === "warmer");
  if (warm.length) return warm.sort((a, b) => est(a) - est(b) || a.id.localeCompare(b.id))[0].id;
  const level = fresh.filter((x) => x.draft === "level");
  if (level.length) return level[0].id;
  // Known chambers: a breadth-first walk over the chambers the team has been in to the nearest unexplored passage.
  const start = c.at, prev = new Map([[start, null]]), q = [start];
  let goal = null;
  const hive = crawlHive(state, c);
  while (q.length && !goal) {
    const id = q.shift();
    for (const n of roomById(den, id).links) {
      if (prev.has(n)) continue;
      prev.set(n, id);
      if (!c.visited[n]) { goal = n; break; }
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
export function crawlEstimate(state, hive, G = guardSize(state, hive)) {
  const den = denOf(state, hive);
  const path = shortestPath(den);
  let fights = 0, brood = 0, worst = 0;
  for (const id of path) {
    const r = roomById(den, id);
    if (r.kind === "core") continue;
    const n = Math.min(roomFull(state, hive, den, r, G), broodLeft(state, hive, r, G));
    const v = (n * roomPower(state, hive, den, r, G)) / 5.2;
    if (n > 0) { fights++; brood += v; worst = Math.max(worst, v); }
  }
  const core = coreForce(state, hive, G);
  const allies = hiveAllies(state, hive).fighters;
  const count = core.count ? broodAfterAllies(core.count, allies) : 0;
  const coreStrength = (count * core.power + core.bossPower) / 5.2;
  return { depth: den.depth, fights, brood, worst, coreStrength, wear: 1 + HCRAWL.AUTO.wear * fights, strength: coreStrength * (1 + HCRAWL.AUTO.wear * fights), hours: den.depth * (HCRAWL.MOVE_HOURS + HCRAWL.FIGHT_HOURS) + 6 };
}

// ---------- the AI groups' crawl ----------
// A war party of an AI group (factions.js groupHiveWar) crawls the same den, coarsely: its strength is a budget in the
// guard's units (its fighters' power × GROUP_HIVE.FIGHT, as before); the whole way in costs the guard × (depth + 1) /
// GROUP.depthDiv, spread over the brood on the shortest way and in the core (each chamber costs its brood left), and
// the core the Hivemind and the Broodmother on top (GROUP.boss + bossTier × tier). The guard it kills: the brood it
// killed × the guard each stands for (as your teams', cutGuard). It clears
// what it pays for (the hive remembers: the chambers stay clear for a while, for your teams too), stops where the
// budget runs out (driven off partway; a later party starts from what is still clear), and kills the Hivemind (the hive dies) when it
// reaches and pays for the core. Returns { burned, cut (the guard killed), met (all it ran into), reached (chambers
// deep), depth }.
export function groupHiveCrawl(state, hive, budget, fid = null) {
  budget *= 1 + HCRAWL.GROUP.light; // torches and flares, listening at the passages: the party's strength goes further (coarse)
  const den = denOf(state, hive);
  const g = hiveGuard(state, hive);
  const G = g ? g.size : 0;
  const path = shortestPath(den);
  const core = coreForce(state, hive, G);
  // What a brood costs a war party: the whole way in (the brood on the shortest way and in the core, full) is worth
  // the guard × (depth + 1) / depthDiv of its strength: a young hive about its guard, a deep one three times it.
  const full = path.reduce((a, id) => { const r = roomById(den, id); return a + (r.kind === "core" ? core.count : roomFull(state, hive, den, r, G)); }, 0);
  const unit = full > 0 ? (G * (den.depth + 1)) / (HCRAWL.GROUP.depthDiv * full) : 0;
  const share = G / Math.max(1, denBroodTotal(state, hive, G)); // the guard each brood stands for (cutGuard)
  let left = budget, met = 0, reached = 0, burned = false, killed = 0;
  for (const id of path) {
    const r = roomById(den, id);
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
  const cut = Math.min(G, Math.round(killed * share));
  if (g && cut > 0) reduceHorde(state, g, cut);
  noteGroupCrawl(hive, fid, reached); // how deep its parties got (the State Map's hive panel)
  return { burned, cut, met: Math.round(met), reached, depth: den.depth, spent: Math.round(budget - left) };
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
export const HIVE_CRAWL_HELP = `A hive is destroyed from the inside. Send a team with the <b>Destroy hive</b> mission and choose <b>Enter the hive</b> on its card: the team crawls through the hive chamber by chamber, from the mouth to the <b>core room</b>, where the <b>${BOSS_NAMES.hivemind}</b> sits, the organ that thinks for the hive. Kill it and the hive dies, its brood with it. A young hive is shallow (${HCRAWL.DEPTH[0]} chambers from the mouth to the core); every tier it grows makes it deeper (${HCRAWL.DEPTH.join(", ")} by tier, one more with a screamer spire): the crawl is the mid and late game's work.<br>
<b>Finding the way.</b> The chambers form a web: at least two routes run to the core, with side branches, dead ends and loops. You see the passages out of every chamber you have been in; what lies beyond is dark until you go. The core is the hottest place in the hive: every chamber has a <b>warmth</b> (the gauge, and the air: <i>cool and damp</i>, <i>close and clammy</i>, <i>warm as breath</i>, <i>hot</i>, <i>the walls sweat</i>), and every passage a draft, <i>warmer</i> or <i>colder</i>. A team without a good scout misreads a draft now and then (${Math.round(HCRAWL.DRAFT.miss * 100)}% less ${Math.round(HCRAWL.DRAFT.perScout * 1000) / 10} a point of the best Scouting). The deeper, the louder and faster the hive's pulse and the warmer its drone (the mixer's <i>Hive crawl pulse</i>), and the redder the window.<br>
<b>The brood.</b> Every chamber holds some of the hive's brood: more and tougher the deeper you go, the special dead the hive breeds among them, the elite deeper still, and the chambers next to the core the worst. A hive's guard horde is its brood: every one killed inside thins the guard, and a war party's crawl means emptier chambers. Nothing from outside the hive hurts it: no fires, no bombs; the crawl is the only way to kill a hive. Fight them (on a cave map or by the numbers), creep past (Stealth; they stay there and you meet them again on the way back), or fall back. Cleared chambers stay clear for about ${HCRAWL.REFILL_DAYS} days, then the brood flows back: you can crawl part of the way, come home to heal and come back. Kinds of chamber: tunnels, galleries, <i>nurseries</i> (many and weak), <i>egg chambers</i> (burn them with ${HCRAWL.BURN.fuel} fuel or a Molotov: the hive loses stores and some of its guard, and fills its chambers more slowly), <i>bone pits</i> (the remains of teams that came before: their worn guns, armour, packs, ammunition and meds), <i>worm pools</i> (the worm's eggs: wading through is a risk, feeling through the water more), the <i>roots</i> of the hive's growths (burn one to hurt the growth above), and collapses that lead nowhere.<br>
<b>The hive's Alert.</b> Moving, fighting, fire and a failed sneak make noise; lying still lets it fade. From ${HCRAWL.ALERT.converge} the brood converges on you: it pours into your chamber and fills the chambers behind you again; from ${HCRAWL.ALERT.block} it packs the mouth. Leaving means going back the way you came.<br>
<b>The ${BOSS_NAMES.hivemind}.</b> In the core the ${BOSS_NAMES.hive} and the last of the brood guard it. It never moves, but every turn it pulses (everyone within ${HIVEMIND.pulse} tiles hurt and sometimes stunned), lashes at anyone next to it, and every other turn tears more brood out of the walls. It has ${HIVEMIND.hp} health (+${HIVEMIND.perTier} a tier) and thick flesh. Below ${Math.round(HIVEMIND.P2.at * 100)}% it tears open in a <b>second phase</b>: the cave quakes and pillars of flesh come down, its pulse reaches ${HIVEMIND.P2.pulse} tiles and hits harder, and the walls give up ${HIVEMIND.P2.spawn[0]}–${HIVEMIND.P2.spawn[1]} brood at a time. Its death kills the brood around it.<br>
<b>Its weak spots.</b> Fire: a Molotov on it or next to it burns it ${HIVEMIND.WEAK.burnDmg[0]}–${HIVEMIND.WEAK.burnDmg[1]} a turn (through its thick flesh) for ${HIVEMIND.WEAK.burnTurns} of its turns after the last flames touch it, and while it burns the walls give up no brood. A bang: a flashbang within ${HIVEMIND.WEAK.flash} tiles stuns it for ${HIVEMIND.WEAK.stunFlash} of its turns, a frag grenade or a pipe bomb within ${HIVEMIND.WEAK.blast} for ${HIVEMIND.WEAK.stunBlast}: no pulse, no lash, no brood called, and its flesh lies open to your shots; a bang next to the ${BOSS_NAMES.hive} dazes her too (a flashbang costs her ${HIVEMIND.WEAK.dazeFlash} actions, a grenade ${HIVEMIND.WEAK.dazeBlast}). Fire panics the brood it calls: those near the flames (or near it while it burns) shy away and lose an action. The battle AI (and <i>AI plays my side</i>) steps into reach and throws them at it first, never with one of yours in the fire or the flash, and it holds on in a core it is winning with fire (its retreat counts the Hivemind burning or reeling and the Molotovs and bangs still in hand). By the numbers, Molotovs and bangs (up to ${HIVEMIND.NUMBERS.kit} of each) and lights count against its power. Bring them: preparation beats headcount. The autopilot packs lights, Molotovs, flashbangs, a grenade and road flares for its hive squads when the armory has them. The other groups crawl hives too (their war parties clear chambers on the shortest way and come back, and take the hoard of a hive they burn), and allied fighters thin the brood in every chamber.<br>
<b>The hoard.</b> In the dead core lies what the hive dragged in from the dead: guns, armour, rounds, meds, gun parts and scrap, now and then something rare (night vision, a thermal sight, a military radio, a surgical kit), all worn as the dead left it; more the higher the hive's tier and the fuller its stores. The team takes what fits (the best first); the rest stays at the hive, marked on the map: Recover it.<br>
<b>Lights, flares and listening.</b> The hive is dark. With the team's lights on (the default when anyone carries one: headlamp, flashlight, torch, lantern) the drafts out of your chamber are misread half as often, but the brood sees you coming (Alert +${HCRAWL.LIGHT.move} a move, creeping past a little harder); douse them in the window. In a fight in the hive someone without a light sees ${HCRAWL.LIGHT.dark} tiles, with one their light's reach + ${HCRAWL.LIGHT.lit}; by the numbers the brood in a chamber counts up to ${Math.round(HCRAWL.LIGHT.numbers * 100)}% more for the share of the team in the dark. A <b>road flare</b> thrown down a passage lights the chamber beyond: its kind, its brood exactly and the true draft (Alert +${HCRAWL.FLARE.alert}; found at gas stations, police and fire stations and campgrounds, made from scrap, fuel and a few rounds). <b>Listen</b> at a passage (${HCRAWL.LISTEN.hours} h): your best listener's (Scouting + Stealth) / 2 + d10 against ${HCRAWL.LISTEN.dc} (+${HCRAWL.LISTEN.perLayer} a chamber deep): well, the kind and the brood exactly; enough, the kind and roughly how many; poorly, a guess that can be wrong; badly, a noise that warns them (Alert +${HCRAWL.LISTEN.alert}, they wait for you). The autopilot listens with a good listener and throws flares without one.<br>
<b>Your record.</b> Every hive keeps what your teams learned of it: how deep they got, the chambers mapped, whether they found the core (the State Map's hive tile and its ⛏ label, the Goals card). When the hive grows deeper its chambers are new and the map starts again.`;
