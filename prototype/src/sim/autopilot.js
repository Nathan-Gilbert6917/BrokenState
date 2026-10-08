// Autopilot: an AI governor that runs the player's holdout (a dev tool, also used headless by tools/autotest.js).
// While state.autopilot is on, the hourly tick (world.js) calls autopilotHour. The governor:
//   - resolves cards (travel events, conflicts, orders / "Done" cards, strangers, raid warnings), scavenging
//     searches (one search hour per tick), trade visits and battles (state.autoCombat is on while it runs);
//   - sets every role by need (food, threats, the injured, construction, stations, crafting), queues buildings
//     and crafts, hands out gear from the armory and treats the injured with base meds;
//   - once a day (07:00) plans a trip: scavenging the best known site for what the hub needs, checking finds,
//     recovering the dead or a vehicle, a trade visit, a rescue, or founding an outpost; and sends supply runs
//     to outposts that need materials or hands;
//   - with the Cautious style, keeps every supply at a reserve target (reserveStatus) and goes for more (trips,
//     recon, radio deals, trade visits, the bench and med station) as soon as one drops below it.
// It only uses the same calls as the UI (canBuild / queueBuild, queueCraft, treatAtBase, launchExpedition,
// startOrder, saveSupplyRun ...), plays by what the player knows of the map (knowledge snapshots, markers,
// known groups), and never draws from state.rng. Turning it off hands everything back as it is.
import { fitFromPool } from "./gunmods.js"; // the autopilot fits loose gun attachments
import { GEAR, LOCATIONS, SUPPLIES, FACTION_TYPES } from "./data.js";
import { log, day, hourOfDay, hub, alive, atBase, residents, skill, combatPower, gearEffect, factionById, snapshot, armedFactor, archerCount, ARROWS } from "./world.js";
import {
  launchExpedition, estimateTrip, startReturn, partyMembers, partyTile, tileLabel, teamName, orderOptions, orderMove,
  hoursLeft, planPath, partyCapacity, cargoLoad, cargoRoom, supplyLoad, carryCapacity, travelHours, awaitOrders, partySpeed, pruneCards, giveOrder,
  STANCES, paceOpts, modeSpeed, partyPace, poolLoad, missionProblem, carried, takeSupply, weighTeam,
} from "./parties.js";
import { startOrder, resumeQueue, besideWater, FETCH_WATER_HOURS } from "./orders.js";
import { estimatePlan } from "./plans.js";
import { searchHour, extract, engagementParty, foundLoad } from "./scavenge.js";
import { crawlAutoStep } from "./citycrawl.js";
import { tradeContext, sellPrice, buyPrice, executeTrade, endTrade, proposePact, available, maxBuyable, minSellable, giftAll, goodsWorth, demand } from "./trade.js";
import { autoCaravanTrade, launchCaravan, caravanEstimate } from "./caravans.js";
import { governorVehicles, idleDaily } from "./vehicletrade.js"; // buying and selling vehicles
import { radioDeals, pendingDeal, dealCaravanForm, matchGear, goodsWeight, cancelRadioDeal } from "./radiotrade.js"; // radio deals your caravan fetches
import { autoVisitorTrade } from "./visitors.js";
import { radioTradeIfShort, hasNetwork, canListen, radioScan, dealQuote, radioDeal, refusal, inCoverage, canRadioGroup, relayReach, RELAY_RANGE, GROUP_REACH } from "./radio.js";
import { attitude, baseDefense, strength, isAggressiveType, raidStakes } from "./factions.js";
import { holdCheck, defenceWishes, hordeThreat, DECOY_FUEL, towerHordes } from "./defences.js";
import { defaultRolePlan, plansOf } from "./defenceplan.js"; // the governor's defence plan (governorPlans, stewardSafety)
import { siteBonus, waterOutlook, foodOutlook, waterCapacity, waterProduction, waterNeed, summerWater, waterRunningShort } from "./economy.js";
import { mouthsAt, foodUse, HEAT } from "./upkeep.js"; // upkeep-per-head: the governor's days of food and water count everyone fed at a base
import { waterIn, teamWaterIn, RAW, keyWord } from "./water.js"; // purified and un-purified water: the governor counts both
import { brokenAt, jobFor } from "./breakdowns.js";
import { farmersWanted, farmOf, seasonKey, winterOutlook } from "./farming.js";
import { edibleFood, foodStore, storeCapacity } from "./storage.js";
import { conditionsOf, CONDITIONS, treatCondition, treatConditionInfo, medsToTreatAll, autoWantsCondition } from "./health.js";
import { BUILDINGS, RECIPES, canBuild, queueBuild, count, countAll, stations, baseBeds, baseWalls, farmSlots, assignStations, isShelter, plotsFree, plotCap, BEDS, queuedBeds, BARRACKS_UP, canExpandBunkhouse, queueBunkhouseExpand, benchTier } from "./buildings.js";
import { fireWanted } from "./fieldheat.js";
import { isHurt, hospitalDef, nextHospitalType, treatAtBase, treatAtBaseInfo, fieldTreatInfo, careNeed, treaters } from "./medical.js";
import { CRAFTS, canCraft, queueCraft, craftQueue, isFilterJob, filterRecipe, canAttempt, craftSkill } from "./crafting.js";
import { vehiclesAtBase, carsAtBase, bikesAtBase, parkBikes, isBike, isCar, travelMode, refuel, repair, canRepair } from "./vehicles.js";
import { LOAD_BANDS, wornLoad, poolAtBand } from "./load.js";
import { saveSupplyRun, dispatchSupplyRun, supplyRuns, jobParty, deleteSupplyRun, planSupplyRun } from "./supply.js";
import { autoPlayerTurn, runEnemyPhase, closeCombat, endBattleNow, WEAPONS } from "./combat.js";
import { allCaptives, ransomValue } from "./conflicts.js";
import { ensureInv, armorMult, itemLoad } from "./inventory.js";
import { weather as wxNow, severeSoon, season as wxSeason, thirstAhead, thirstAt, THIRST, seasonOfDay, foodNeedFactor, coldAhead } from "./weather.js";
import { teamCold } from "./needs.js"; // tune-winter: a team's food in the cold (×1.1 / ×1.2 without a lit camp fire)
import { autoRecruitPick } from "./recruits.js";
import { planStudy } from "./skills.js";
import { planBlueprintStudy, buildLock } from "./blueprints.js";
import { stationOrder, setStationOrder, orderHold } from "./production.js";
import { POWER, powerWanted } from "./power.js";
import { friendlyCrew, wantsRest, relAutopilotDaily } from "./relations.js";
import { autoDiplomacyDaily, hiveAllies, broodAfterAllies, goalsProgress, allianceMembers, ALLIANCE, isMember, inviteProblem, inviteToAlliance, landCentres, controlRadius, coalitionMask } from "./alliance.js";
import { ensureDiplo, joinProblem, joinWar } from "./diplomacy.js";
// Land claims (claims.js, the coalition / land plan): the governor claims tiles toward contested ground and digs wells on
// claims by water, through the team orders orders.js gives them ("Claim this tile" / "Dig a well": CLAIM_ORDER,
// WELL_ORDER). Read through CL and guarded, so the governor stays whole if the module is ever missing.
import * as CL from "./claims.js";
const CLAIM_ORDER = "claim", WELL_ORDER = "well";
const claimsReady = () => typeof CL.canClaim === "function" && typeof CL.playerClaims === "function";
import { jobTripCands, jobById, activeJobs } from "./jobs.js";
import { hiveAt, hiveForce, broodForce, hiveById, zombieToughness } from "./hives.js";
import { isLate } from "./eras.js";
import { BREAKOFF } from "./breakoff.js";
import { growthAt, ensureGrowths, growthForce } from "./hivetech.js";
import { gatheringCands } from "./hivebirth.js"; // hive birth you can see: culling a gathering before the hive stands
import { GROWTHS, TECH } from "./hiveconst.js";
import { typeStrength } from "./zombietypes.js";
import { assaultForce, assaultOdds, teamAssaultOdds, lostBases, occupiedAt, squadValue, nearestOtherBase } from "./conquest.js";
import { autopilotPrisoners, jailTier, cellCap, prisonersAt } from "./prisoners.js";
import { autopilotRescue, autoRescuePlan } from "./ransom.js"; // your people held by other groups: ransom first, a raid when strong
import { isManaged, healthRest } from "./work.js";
import { onWatchNow, inShift } from "./watch.js"; // the night watch (govWatch)
import { tiredLevel } from "./sleep.js";
import {
  HUNT, huntTargets, fishTargets, hunterMult, bestHuntWeapon, fisherMult, fishKit, snareLine, huntWorkWhy, fishWorkWhy, fishWorkHands, huntWorkCap,
  cabinProblem, gameLand, hasFishingGear, huntInfo, huntProblem, fishProblem, expectFish,
  hasBow, autoHuntMix, setHuntMix, huntMixOf, huntArrowsFor, huntMixText,
} from "./hunting.js";
import { landFoodOptions, forageWorkWhy, forageWorkCap, foragerMult, baseForageDay } from "./foraging.js";
import { woodNeed, woodWorkWhy, woodHandsWanted, woodCrowd, handsForDay, woodcutterMult, bestChop, baseWoodDay, woodAbundance, woodLevel, expectWood, chopCrew, chopPower, isChopTool, woodTime, WOOD } from "./woodcutting.js";
import { siteKnown } from "./discovery.js";
import { packTripKit } from "./kit.js";
import { openCasesIn } from "./gunsafes.js";
import { surveyCandidate, surveySent, SURVEY } from "./survey.js";
import { autoTreats } from "./comforts.js";
import { firstHubPending, hubSites } from "./hardcore-start.js";
import { stagingNeeds, storeOf, stagingMissing, stagingPct, depositable, provisionable, canWork, workerTeams, daysFor, establishProblem, besideWaterSource } from "./staging.js";
import { isHardcore } from "./hardcore.js";
import { WORM, baseWater, baseFilter, baseTabCount, baseCooks, armoryTabs, TABS_TRIP_DAYS, wormMeatAt, wormVegAt, wormSeen, boilerUse, cropLandBad, baseDewormers, wormOf } from "./worm.js";

// Play styles. range = max tiles from the hub for a trip, maxHoursOut = longest way out, cooldown = days between
// launches, homeFrac = share of the hub that stays home, risk = lowest success chance worth a gamble,
// lossFear / fightBias / raidBias weigh fights on conflict cards, chain = extra sites a team may hit on one trip.
// hiveFrom = first day it storms hives, hiveOdds = squad power over the brood's strength it wants (hiveCandidate),
// hiveFires = fires it may set around a mound first, hiveRest = days between hive missions.
// conquer = which groups' bases it storms (conquestCandidate: "ready" any hostile group, "provoked" hostile groups
// that raided it lately or when only hostile groups keep the coalition from winning, "last" only then), from day
// conquerFrom, with at least conquerOdds to win (lateConquer: from the late game, eras.js year 8, it goes for any
// hostile group, at these odds: the push to win); retreatBelow = the defence ratio under which it abandons an outpost
// to a raid rather than be overrun (raidWarningChoice).
// reserves = keeps every supply at a target (reserveStatus) and acts as soon as one drops below it: shortCooldown
// days between trips, shortReach = how much farther a trip may go for it, homeHorde = people kept home while
// hordes are near.
export const PERSONALITIES = {
  cautious: {
    name: "Cautious", crowdSlack: 0, desc: "One small, stealthy team at a time close to home, short searches, more guards, pays tribute, avoids fights. Keeps a reserve of every supply and goes for more as soon as one runs below it.",
    maxTeams: 1, cooldown: 4, crew: 3, homeFrac: 0.6, minHealth: 80, range: 8, maxHoursOut: 18, stance: "stealthy",
    searchHours: 3, searchHeat: 25, hurtStop: 60, risk: 0.8, riskAversion: 1.5, lossFear: 12, fightBias: -1, raidBias: -3,
    curious: 0.5, baseGuards: 2, guardMargin: 1.4, restMood: 35, chain: 0, outposts: 1, outpostPop: 12, strangerDays: 8,
    holdRatio: 1.5, raid: false, rescue: false, tradeEvery: 14,
    reserves: true, shortCooldown: 2, shortReach: 2, homeHorde: 5,
    hiveFrom: 150, hiveOdds: 1.35, hiveFires: 3, hiveRest: 10,
    conquer: "last", conquerFrom: 240, conquerOdds: 0.8, retreatBelow: 0.9,
  },
  balanced: {
    name: "Balanced", crowdSlack: 2, desc: "Up to two teams out, scavenges what the hub needs, fights only good odds, grows with an outpost or two.",
    maxTeams: 2, cooldown: 2, crew: 2, homeFrac: 0.5, minHealth: 70, range: 11, maxHoursOut: 28, stance: "normal",
    searchHours: 5, searchHeat: 45, hurtStop: 45, risk: 0.65, riskAversion: 1, lossFear: 9, fightBias: 0, raidBias: -1,
    curious: 1, baseGuards: 1, guardMargin: 1.25, restMood: 28, chain: 1, outposts: 2, outpostPop: 9, strangerDays: 4,
    holdRatio: 1.25, raid: false, rescue: true, tradeEvery: 12,
    hiveFrom: 90, hiveOdds: 1.2, hiveFires: 3, hiveRest: 6,
    conquer: "provoked", conquerFrom: 150, conquerOdds: 0.75, retreatBelow: 0.8, lateConquer: 0.7,
  },
  aggressive: {
    name: "Aggressive", crowdSlack: 8, desc: "Many long trips, loud searches, raids hostile land, ambushes camps and robbers, expands fast.",
    maxTeams: 3, cooldown: 1, crew: 3, homeFrac: 0.4, minHealth: 60, range: 15, maxHoursOut: 40, stance: "normal",
    searchHours: 7, searchHeat: 62, hurtStop: 35, risk: 0.5, riskAversion: 0.6, lossFear: 7, fightBias: 1, raidBias: 2,
    curious: 1.4, baseGuards: 1, guardMargin: 1.1, restMood: 22, chain: 2, outposts: 3, outpostPop: 8, strangerDays: 3,
    holdRatio: 1.2, raid: true, rescue: true, tradeEvery: 0,
    hiveFrom: 30, hiveOdds: 1.05, hiveFires: 3, hiveRest: 4,
    conquer: "ready", conquerFrom: 60, conquerOdds: 0.65, retreatBelow: 0.6,
  },
};

const PLAN_HOUR = 7;      // daily planning: teams leave in the morning
const STICKY = 2;         // bonus for keeping someone's current role (fewer flips)
const first = (s) => s.name.split(" ")[0];
const names = (list) => list.map(first).join(", ");
// While a base steward runs (stewardRun, steward.js) the governor's lines are not logged one by one (the steward
// writes one summary a day) and the steward's own style is used.
let stewardCtx = null;
const say = (state, text, kind = "info") => { if (!stewardCtx) log(state, `🤖 ${text}`, kind); };
const isDisabled = (state, ch) => (typeof ch.disabled === "function" ? ch.disabled(state) : !!ch.disabled);
const pctIn = (text) => { const m = /(\d+)%/.exec(text || ""); return m ? Number(m[1]) / 100 : null; };

// Governor memory (kept on the state so it travels with the world).
function gov(state) {
  if (!state.governor) {
    state.governor = {
      personality: "balanced", savedAutoCombat: null, busy: false,
      stats: { hours: 0, launched: 0, cards: 0, builds: 0, crafts: 0, treated: 0, equipped: 0, searches: 0, extractions: 0, supplyRuns: 0, outposts: 0, trades: 0, roleChanges: 0 },
      visited: {}, lastLaunch: -99, lastOutpost: -99, lastTrade: -99, lastRescue: -99, roleSummary: {}, treated: {}, farmShort: {}, threat: {},
    };
  }
  return state.governor;
}
const persona = (state) => PERSONALITIES[(stewardCtx && stewardCtx.style) || gov(state).personality] || PERSONALITIES.balanced;
export const autopilotPersonality = (state) => gov(state).personality;

// ---------- switching ----------
export function setAutopilot(state, on, personality) {
  const g = gov(state);
  if (personality && PERSONALITIES[personality]) g.personality = personality;
  if (!!on === !!state.autopilot) return;
  state.autopilot = !!on;
  if (on) {
    g.savedAutoCombat = !!state.autoCombat;
    state.autoCombat = true; // battles resolve by the numbers; scavenging uses the hour-by-hour search
    say(state, `Autopilot on (${persona(state).name}). The governor runs ${hub(state) ? hub(state).name : "the survivors"} until you take over.`);
    autopilotResolve(state);
  } else {
    state.autoCombat = !!g.savedAutoCombat;
    g.savedAutoCombat = null;
    say(state, "Autopilot off. You have control again.");
  }
}

export function setPersonality(state, key) {
  if (!PERSONALITIES[key]) return;
  const g = gov(state);
  if (g.personality === key) return;
  g.personality = key;
  if (state.autopilot) say(state, `Governor style: ${PERSONALITIES[key].name}.`);
}

// One line for the dev panel.
export function autopilotSummary(state) {
  const s = gov(state).stats;
  const out = state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy").length;
  const short = reserveShort(state); // Cautious: what is below its reserve (hover the line for the table)
  return `${persona(state).name} · ${out} team${out === 1 ? "" : "s"} out · launched ${s.launched} · cards ${s.cards} · built ${s.builds} · crafted ${s.crafts} · treated ${s.treated} · supply runs ${s.supplyRuns} · outposts ${s.outposts}${persona(state).reserves ? ` · ${short.length ? `short: ${short.join(", ")}` : "reserves full"}` : ""}`;
}
// hiveRejects: why hiveCandidate returned nothing each morning (the census prints it): unknown = no known hive,
// far = known hives all beyond CAMPAIGN.far, odds = not even the campaign's fires would bring a storm in reach,
// ammo = short of the campaign's stockpile, squad = fewer than six fit fighters, rest = before hiveFrom or resting
// between hive missions, home = too few would stay home.
const REJECT_KEYS = ["unknown", "far", "odds", "ammo", "squad", "rest", "home"];
const hiveRejects = (state) => { const s = gov(state).stats; if (!s.hiveRejects) s.hiveRejects = Object.fromEntries(REJECT_KEYS.map((k) => [k, 0])); return s.hiveRejects; };
export const autopilotStats = (state) => ({ ...gov(state).stats, hiveRejects: { ...hiveRejects(state) } });

// ---------- entry points ----------
// Hourly, from world.js tickHour (after everything else in the hour).
export function autopilotHour(state) {
  if (!state.autopilot || state.gameOver) return;
  const g = gov(state);
  if (g.busy) return; // a tick inside the governor's own work (a raid's hours, for example)
  if (!state.bases.length) { // no base (hardcore's first hub, conquest.js exiles): the teams on the road build a staging camp (roadAct) or retake a base
    g.busy = true;
    try {
      state.autoCombat = true;
      resolvePending(state);
      engagementHour(state); resolvePending(state); // they search on the way (roadAct)
      idleTeams(state);
      resolvePending(state);
      autoFires(state);
    } catch (e) { fail(state, e); } finally { g.busy = false; }
    return;
  }
  g.busy = true;
  try {
    g.stats.hours++;
    state.autoCombat = true;
    resolvePending(state);
    engagementHour(state);
    resolvePending(state);
    guardArrivals(state);
    idleTeams(state);
    trackHauls(state); // the water and food the haul teams bring home (the daily Water / Food line)
    for (const b of [...state.bases]) governBase(state, b);
    if (hourOfDay(state) === PLAN_HOUR) autopilotDaily(state);
    else if (hourOfDay(state) === EMERGENCY.hour) emergencyTrips(state); // a second look in the afternoon: thirst does not wait for the morning
    for (const b of state.bases) govWatch(state, b); // the night watch's roster (before the roles: planRoles 1a)
    for (const b of state.bases) governRoles(state, b);
    resolvePending(state);
    autoFires(state);
  } catch (e) {
    fail(state, e);
  } finally {
    g.busy = false;
  }
}

// The camp fires (fieldheat.js FIRE): the staging camp's, a shelter's and a camping team's are lit by day (cooking)
// and put out at night unless it is cold or someone there is badly hurt (the light carries).
function autoFires(state) {
  const hurt = (people) => people.some((s) => s.health < ROAD.heal);
  const camp = state.staging;
  if (camp) camp.fire = fireWanted(state, { hurt: hurt(state.parties.filter((p) => p.owner === "player" && partyTile(p) === camp.tile).flatMap((p) => partyMembers(state, p))) });
  for (const b of state.bases) if (isShelter(b)) b.fire = fireWanted(state, { hurt: hurt(atBase(state, b.id)) });
  for (const p of state.parties) if (p.owner === "player" && p.phase === "task" && p.task && p.task.type === "camp") p.campFire = fireWanted(state, { hurt: hurt(partyMembers(state, p)) });
}

// ---------- one base (the autopilot's hourly loop and base stewards, steward.js) ----------
// Areas a steward can hand over; the autopilot runs them all. A wish or a role in an area that is off is left as
// it is (the player's).
export const GOVERN_AREAS = ["roles", "building", "production", "medical", "food", "defence"];
const TREAT_HOUR = 19; // treats from the armory for the glum, once a day in the evening
const ALL_AREAS = Object.fromEntries(GOVERN_AREAS.map((k) => [k, true]));
// The per-base work of one hour: gear, treatment, construction, crafting and station orders.
export function governBase(state, base, areas = ALL_AREAS) {
  if (areas.production) equipFromArmory(state, base);
  if (areas.medical) planTreatment(state, base);
  if (areas.medical && hourOfDay(state) === TREAT_HOUR) for (const line of autoTreats(state, base)) say(state, line); // comforts.js: chocolate, coffee, smokes for the glum
  if (areas.building) planBuilds(state, base, areas);
  if (areas.production) { govOrders(state, base); planCrafts(state, base); }
}
// Roles at one base (after the day's trip is planned). Returns the number of role changes.
export function governRoles(state, base, areas = ALL_AREAS) {
  return areas.roles ? planRoles(state, base, areas) : 0;
}
// A base steward's hour (steward.js): the same per-base work for the areas handed over, in the steward's style,
// with the governor's log lines held back. Never while the dev autopilot runs (it has the whole holdout then).
export function stewardRun(state, base, areas, style = "balanced") {
  if (state.autopilot || state.gameOver) return 0;
  const g = gov(state);
  if (g.busy) return 0;
  g.busy = true;
  stewardCtx = { style: PERSONALITIES[style] ? style : "balanced" };
  try {
    governBase(state, base, areas);
    return governRoles(state, base, areas);
  } finally {
    stewardCtx = null;
    g.busy = false;
  }
}
// A base leader's safety (steward.js, Defence): the governor's night watch roster for this base (a roster of your own is
// left as it is), and each morning its defence plan by role, laid again when the buildings change (only where the
// base has no plan of yours: a plan you saved is the one that stands). Returns the plan's line, or "".
export function stewardSafety(state, base, style = "balanced") {
  if (state.autopilot || state.gameOver) return "";
  return withStyle(style, () => {
    govWatch(state, base);
    if (hourOfDay(state) !== PLAN_HOUR || state.combat || atBase(state, base.id).length < 2) return "";
    if (plansOf(base).some((p) => p.by !== "governor")) return "";
    const g = gov(state);
    g.planSig = g.planSig || {};
    const sig = base.buildings.map((x) => x.type).sort().join(",");
    if (g.planSig[base.id] === sig) return "";
    g.planSig[base.id] = sig;
    return defaultRolePlan(state, base);
  });
}
// A base leader's supplies (steward.js, Supplies): at the morning plan and the afternoon look (the autopilot's hours),
// an emergency haul from this base when its water would run out within a day or its food within two (emergencyAt:
// the governor's haul, the team leaves from and comes home to this base). Nothing else goes out: no scavenging trips,
// trades, outposts or fights. keep: who stays home whatever happens (the leader). Returns the line, or "".
export function stewardSupplies(state, base, style = "balanced", keep = new Set()) {
  if (state.autopilot || state.gameOver) return "";
  const h = hourOfDay(state);
  if (h !== PLAN_HOUR && h !== EMERGENCY.hour) return "";
  const g = gov(state);
  if (g.busy) return "";
  g.busy = true;
  try { return withStyle(style, () => emergencyAt(state, base, keep)); } finally { g.busy = false; }
}
// The rest of a base leader's day (steward.js): each wraps the governor's own judgement for this one base, in the
// leader's style, with its log lines held back; each returns the line saying what it did, or "". keep: who never
// goes out (the leader, a deputy, pinned people).
function leaderTurn(state, style, fn) {
  if (state.autopilot || state.gameOver) return "";
  const g = gov(state);
  if (g.busy) return "";
  g.busy = true;
  try { return withStyle(style, fn) || ""; } finally { g.busy = false; }
}
// Trading (steward.js): a caravan at this base's gates is traded with for what the base is short of, paid from its
// surplus (a caravan bringing a deal made by radio is paid as agreed); never attacked, whatever the style. Each
// morning, with a working radio network and nothing bought by radio for LEADER_RADIO.every days, one small deal for
// water, food or meds when the base is short of one (need 1.8+), only with a group whose caravan comes to this base,
// paid with what it has plenty of.
export const LEADER_RADIO = { every: 6, keys: ["water", "food", "meds"], cap: { water: 25, food: 25, meds: 6 } };
export function stewardTrade(state, base, style = "balanced", lead = null) {
  return leaderTurn(state, style, () => {
    const ctx = tradeContext(state);
    if (ctx && ctx.kind === "caravan" && ctx.base && ctx.base.id === base.id) {
      const veh = governorVehicles(state); // vehicletrade.js: a car when there is none, a long-idle spare sold
      if (veh) say(state, veh);
      const text = autoCaravanTrade(state, needs(state, base), style === "aggressive" ? "balanced" : style, tradeSpare(state, base));
      return `the ${ctx.f.name} caravan at the gates: ${text.replace(/\.$/, "")}`;
    }
    if (hourOfDay(state) !== PLAN_HOUR) return "";
    if (lead && lead.radioDay != null && day(state) - lead.radioDay < LEADER_RADIO.every) return "";
    const deal = radioTradeIfShort(state, needs(state, base), { base, keys: LEADER_RADIO.keys, cap: LEADER_RADIO.cap });
    if (deal && lead) lead.radioDay = day(state);
    return deal;
  });
}
// Supply runs to outposts (steward.js): from a led hub, once a morning, water to an outpost running dry and the scrap
// or parts its next building waits on (supplyRunTo without moving anyone there).
export function stewardOutposts(state, base, style = "balanced", keep = new Set()) {
  if (base.type !== "hub" || hourOfDay(state) !== PLAN_HOUR) return "";
  return leaderTurn(state, style, () => {
    const lines = [];
    for (const o of state.bases.filter((b) => b.type === "outpost")) {
      const why = supplyRunTo(state, base, o, { keep });
      if (why) lines.push(`supply run to ${o.name}: ${why}`);
    }
    return lines.join("; ");
  });
}
// Hunting, fishing and firewood (steward.js): once a morning, one team at most out on them from this base at a time,
// the governor's hunting or fishing trip when food runs short (foodTripCands: need 1.4+, the winter stores short, or
// stocking up in autumn) or its wood trip when the land around gives too little firewood (woodTripCands). Not in
// severe weather nor with raiders or a horde on the way; the style's share of the base stays home.
export function stewardLand(state, base, style = "balanced", keep = new Set()) {
  if (hourOfDay(state) !== PLAN_HOUR) return "";
  if (state.parties.some((p) => p.owner === "player" && p.leaderTrip && p.homeBaseId === base.id)) return "";
  return leaderTurn(state, style, () => {
    const P = persona(state);
    if (wxNow(state).severe || threatAt(state, base).urgent) return "";
    const home = atBase(state, base.id);
    const pool = home.filter((s) => s.health >= P.minHealth && !s.woundInfected && !s.inBed && !s.pinned && !keep.has(s.id) && !s.leader);
    const spare = Math.min(pool.length, home.length - Math.max(2, Math.ceil(home.length * P.homeFrac)));
    if (spare < 1) return "";
    const cands = [...foodTripCands(state, base, pool, needs(state, base), P), ...woodTripCands(state, base, pool, P)].sort((a, b) => b.score - a.score);
    for (const c of cands.slice(0, 4)) {
      const party = launchTrip(state, { ...c, from: base }, pool, spare);
      if (!party) continue;
      party.leaderTrip = true;
      const what = c.food === "huntTrips" ? "hunting" : c.food === "fishTrips" ? "fishing" : "cutting firewood";
      return `${names(partyMembers(state, party))} went ${what} at ${tileLabel(state, c.tile)}: ${c.why}`;
    }
    return "";
  });
}
// Raid and horde warnings (steward.js, Defence): a "Raiders heading for" or "Horde heading for" card about this base is
// answered the governor's way (raidWarningChoice: prepare, or pay a tribute that costs less than the fight; the horde:
// man the defences, or a decoy fire when the walls would not hold), never by leaving the base or a battle you would
// have to play (Defend in person). Returns the line, or "".
const WARN_RE = (base) => new RegExp(`^(Raiders|Horde) heading for ${base.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
export function stewardWarnings(state, base, style = "balanced") {
  const re = WARN_RE(base);
  const card = state.cards.find((c) => re.test(c.title) && !c.isOrders && c.choices);
  if (!card) return "";
  return leaderTurn(state, style, () => {
    const opts = card.choices.filter((c) => !c.uiAction && !c.retreat && !/^Defend in person/.test(c.label) && !isDisabled(state, c));
    if (!opts.length) return "";
    const choice = pickChoice(state, card, opts, null) || opts.find((c) => /^(Prepare|Man the defences)/.test(c.label)) || null;
    if (!choice) return "";
    const i = state.cards.indexOf(card);
    if (i < 0) return "";
    state.cards.splice(i, 1);
    const text = choice.resolve(state);
    pruneCards(state);
    return `${card.title} → ${choice.label}.${text ? ` ${clip(text)}` : ""}`;
  });
}

// Daily planning (07:00): role summary, supply runs and the day's trip.
export function autopilotDaily(state) {
  if (!state.autopilot || state.gameOver) return;
  roleSummaries(state);
  idleDaily(state); // vehicletrade.js: how long each car has stood at a base
  winterReport(state);
  tidySupplyJobs(state);
  planCampaign(state); // the war on the hives: today's target (its ammo want feeds needs, trades and the stations)
  emergencyTrips(state); // water under a day, food under two: a haul goes out whatever the style's team limit
  wormCureRuns(state); // the worm where nothing can cure it: the sick walk to a base that can, or meds come to them
  planSupplyRuns(state);
  planTrip(state);
  campaignReport(state); // one line a morning: what the campaign waits for
  supplyReport(state); // one line a morning when water or food is short: hauled, traded, made against drunk / eaten
  governorPlans(state); // defenceplan.js: a plan by role for a base whose battle map changed
  const service = relAutopilotDaily(state); // relations.js: a memorial service when people grieve or spirits are low
  if (service) say(state, service);
  // Jobs, the coalition and wars (alliance.js): deliveries fetched, qualifying groups invited, Aggressive sells
  // ammo to groups at war. Job offers and war calls are cards (their choices carry the governor's scores).
  const diplo = autoDiplomacyDaily(state, gov(state).personality);
  if (diplo) say(state, diplo);
  const war = warCouncil(state); // wars on the hostile groups in the coalition's way (by the style's appetite)
  if (war) say(state, war);
  // prisoners.js: question them, then trade back (Cautious), ransom (Balanced) or slowly recruit (Aggressive).
  const held = autopilotPrisoners(state);
  if (held) say(state, `Prisoners: ${held}`);
  // ransom.js: your people held by another group: a ransom (or a prisoner exchange) first when the hub can pay it; the
  // handover team goes at once. A rescue raid is the mission planner's (below), when autoRescuePlan says so.
  const ransom = autopilotRescue(state);
  if (ransom) say(state, `Ransom: ${ransom}`);
  // Radio deals waiting for a caravan of yours (radiotrade.js): sent when the base can spare the goods and the people.
  for (const d of [...radioDeals(state)]) {
    if (state.parties.some((p) => p.owner === "player" && p.dealId === d.id)) continue;
    if (d.autoTries >= 1) { say(state, `Radio deal: ${cancelRadioDeal(state, d)} (the caravan came back without it)`); continue; } // one try
    const sent = autoDealCaravan(state, d);
    if (sent) say(state, `Radio deal: ${sent}`);
  }
  // Cautious: scan the airwaves and make a radio deal for whatever is below its reserve (reserveRadio).
  if (persona(state).reserves && reserveRadio(state)) return;
  // Short of something and a group in radio reach has it: a radio deal (radio.js), their caravan brings it. Water and
  // food come first when the hub is short of them (needs: 2.5+), the campaign's ammo next (campaignAmmoWant).
  const deal = radioTradeIfShort(state, needs(state));
  if (deal) { noteTrade(state, deal); say(state, `Radio: ${deal}.`); }
}

// ---------- radio deals your caravan fetches (radiotrade.js) ----------
// The governor agrees to bring its side to a group that asks (radio.js bringCard, at their fee), and sends the
// caravan for any deal waiting, when the deal's base
// - can spare the goods: not short of them (needs 0.8 or less), food and ammo within what it trades away (tradeSpare),
//   the items in its armory;
// - can feed the trip (caravanEstimate's food and water, packed from the base) and still keep 3 days of food and water
//   a head for those at home;
// - has people to send: 2 (3 for a trip of more than a day and a half there and back, up to 4 when their side is heavy),
//   the healthy and willing beyond the style's share kept home (homeFrac, at least 2), never the base's leader or a
//   medic, who can carry their side home (with half the road supplies left; a car when one has the fuel);
// - is not under threat, the weather is not severe and the round trip is within twice the style's reach plus a day.
// Otherwise the deal waits (checked daily). A caravan that comes back without doing it (one try) calls the deal off.
// Returns { form } (the planner's form, crew and supplies filled in) or { why }.
function dealCaravanPlan(state, deal) {
  const base = state.bases.find((b) => b.id === deal.baseId);
  const f = factionById(state, deal.factionId);
  if (!base || !f || !f.alive || f.bases[0] == null) return { why: "the base or the group is gone" };
  const P = persona(state);
  if (threatAt(state, base).urgent) return { why: `${base.name} is under threat` };
  if (wxNow(state).severe) return { why: "severe weather" };
  const need = needs(state, base), spare = tradeSpare(state, base);
  for (const [k, q] of Object.entries(deal.give.supplies || {})) {
    if (q <= 0) continue;
    if ((need[k] ?? 0) > 0.8) return { why: `${base.name} is short of ${k}` };
    if ((k === "food" || k === "ammo") && q > spare[k]) return { why: `${base.name} cannot spare ${q} ${k}` };
    if ((base.stock[k] || 0) < q) return { why: `${base.name} has only ${Math.floor(base.stock[k] || 0)} ${k}` };
  }
  if (!matchGear(base.armory, deal.give.gear || [])) return { why: "the items are not in the armory" };
  const home = atBase(state, base.id);
  const keep = Math.max(2, Math.ceil(home.length * P.homeFrac));
  const pool = home.filter((s) => s.health >= P.minHealth && !s.woundInfected && !s.inBed && !s.pinned && s.mood >= 20 && !s.leader && s.role !== "medic" && !(base.steward && base.steward.leaderId === s.id));
  const hands = Math.min(pool.length, home.length - keep);
  const form = dealCaravanForm(state, deal);
  const fit = (s) => combatPower(s) + skill(s, "speech") * 0.5;
  const ranked = [...pool].sort((a, b) => fit(b) - fit(a) || a.id - b.id);
  if (hands < 2) return { why: `too few people to send from ${base.name}` };
  // The smallest crew (2, 3 for a long trip, up to 4) that can carry their side home with half its road supplies
  // left, by car when one has the fuel for the whole route, else on foot.
  const theirs = goodsWeight(deal.get || { supplies: {}, gear: [] });
  let est = null, why = `no road to ${f.name}`;
  for (let n = 2; n <= Math.min(4, hands) && !est; n++) {
    const crew = ranked.slice(0, n);
    for (const v of [...carsAtBase(state, base.id).filter((x) => x.condition >= 30), null]) {
      const e = caravanEstimate(state, { ...form, crew: crew.map((s) => s.id), vehicleId: v ? v.id : null });
      if (!e.ok || (v && e.fuel > v.fuel)) continue;
      if (e.hours > P.maxHoursOut * 2 + 24) { why = `${f.name} is too far for a caravan`; continue; }
      if (e.hours > 36 && n < 3 && hands >= 3) continue; // a long trip goes three strong
      if (theirs + supplyLoad({ food: e.food * 0.5, water: e.water * 0.5 }) > carryCapacity(state, crew, v)) { why = `their side is too heavy to carry home`; continue; }
      est = e; form.crew = crew.map((s) => s.id); form.vehicleId = v ? v.id : null;
      break;
    }
  }
  if (!est) return { why };
  const left = Math.max(1, home.length - form.crew.length);
  const food = (base.stock.food || 0) - (deal.give.supplies.food || 0) - est.food;
  const water = (base.stock.water || 0) - (deal.give.supplies.water || 0) - est.water;
  if (food < left * 3 || water < left * 3) return { why: `${base.name} cannot spare the food and water for the trip` };
  form.travel = { food: est.food, water: est.water, fuel: 0 };
  return { form };
}
// Sends the caravan for a waiting deal when the plan holds. Returns a log text ("" when it waits).
function autoDealCaravan(state, deal) {
  const plan = dealCaravanPlan(state, deal);
  if (!plan.form) return "";
  const res = launchCaravan(state, plan.form);
  if (res.error) return "";
  deal.autoTries = (deal.autoTries || 0) + 1;
  gov(state).lastLaunch = day(state);
  const f = factionById(state, deal.factionId);
  return `a caravan of ${plan.form.crew.length} sets out for ${f ? f.name : "them"}${plan.form.vehicleId ? " by car" : " on foot"}.`;
}

// ---------- the defence plan (defenceplan.js) ----------
// Each morning, for a base whose buildings changed since it last looked (a new battle map: walls, a bigger yard), the
// governor lays its own plan out again from the default posts, every post by role (defaultRolePlan: best shots on
// the towers, the walkway and the perches, close fighters by the gate and the doors), so the posts hold when people
// are away, hurt or new. Only on maps that turn to face the attack; never while a battle is open; it draws nothing
// from state.rng. g.planSig: the buildings each base had when it last looked.
function governorPlans(state) {
  const g = gov(state);
  if (state.combat) return;
  g.planSig = g.planSig || {};
  for (const base of state.bases) {
    if (atBase(state, base.id).length < 2) continue;
    const sig = base.buildings.map((x) => x.type).sort().join(",");
    if (g.planSig[base.id] === sig) continue;
    g.planSig[base.id] = sig;
    const line = defaultRolePlan(state, base);
    if (line) say(state, line);
  }
}

// Cautious, with a radio station: scan the airwaves once a day (groups in reach become known), then one deal for
// the supply furthest below its reserve, paid with what is well above its own (the Groups tab's radio calls:
// dealQuote / radioDeal; their caravan brings the goods). Returns true when a deal was made.
const RADIO_CAP = { scrap: 60, ammo: 200, meds: 15, food: 60, water: 40, fuel: 15, parts: 6 };
function reserveRadio(state) {
  if (canListen(state) && state.radioScanDay !== day(state)) radioScan(state); // a hand-crank radio hears new voices too
  if (!hasNetwork(state)) return false; // deals need a transmitter
  const h = hub(state);
  const rs = reserveStatus(state, h);
  const n = Math.max(1, mouthsAt(state, h).heads); // everyone fed at the hub (upkeep.js)
  const keep = (k) => (k === "food" ? n * (foodTarget(state, h) * 1.2 + 10) : rs[k] ? rs[k].target * 1.3 + 2 : Infinity);
  const spare = (k) => Math.max(0, Math.floor((h.stock[k] || 0) - keep(k)));
  const short = [...RESERVE_KEYS, "food"].filter((k) => rs[k] && rs[k].short).sort((a, b) => rs[a].have / Math.max(1, rs[a].target) - rs[b].have / Math.max(1, rs[b].target));
  const pays = Object.keys(RADIO_CAP).filter((k) => spare(k) >= 3).sort((a, b) => spare(b) * SUPPLIES[b].value - spare(a) * SUPPLIES[a].value);
  if (!short.length || !pays.length) return false;
  const groups = state.factions.filter((f) => f.known && !refusal(state, f, true));
  for (const want of short) {
    const gap = Math.ceil(rs[want].target * 1.3 - rs[want].have);
    for (const f of [...groups].sort((a, b) => available(b, want) - available(a, want))) {
      let wantQty = Math.min(RADIO_CAP[want] || 20, gap, available(f, want));
      if (wantQty < 2) continue;
      for (const pay of pays) {
        if (pay === want) continue;
        let q = dealQuote(state, f, { wantKey: want, wantQty, payKey: pay, payQty: spare(pay) });
        if (!q.ok && q.maxWant != null && q.maxWant >= 2 && q.maxWant < wantQty) { wantQty = q.maxWant; q = dealQuote(state, f, { wantKey: want, wantQty, payKey: pay, payQty: spare(pay) }); }
        if (!q.ok || q.minPay == null || q.minPay > spare(pay)) continue;
        const res = radioDeal(state, f, { wantKey: want, wantQty, payKey: pay, payQty: q.minPay });
        if (!res.ok) continue;
        gov(state).stats.trades++;
        noteTrade(state, `${wantQty} ${want}`);
        say(state, `Radio: ${want} is below the reserve (${rs[want].have} of ${rs[want].target}). ${res.text}`);
        return true;
      }
    }
  }
  return false;
}

// Cards, trades and battles that need no time: resolved right away (the browser calls this every frame while
// the autopilot is on, so nothing waits on a click). Returns true if anything was handled.
export function autopilotResolve(state) {
  if (!state.autopilot || state.gameOver) return false;
  const g = gov(state);
  if (g.busy) return false;
  if (!state.cards.length && !state.trade && !state.combat) return false;
  g.busy = true;
  try {
    return resolvePending(state);
  } catch (e) {
    fail(state, e);
    return true;
  } finally {
    g.busy = false;
  }
}

function fail(state, e) {
  if (typeof window === "undefined") throw e; // headless tools should see the crash
  console.error("Autopilot error:", e);
  state.autopilot = false;
  state.autoCombat = !!gov(state).savedAutoCombat;
  say(state, `Autopilot stopped after an error (${e.message}). You have control.`, "danger");
}

function resolvePending(state) {
  let did = false;
  for (let guard = 0; guard < 40; guard++) {
    if (state.combat) finishLiveBattle(state);
    else if (state.cards.length) resolveCard(state);
    else if (state.trade) handleTrade(state);
    else break;
    did = true;
  }
  return did;
}

// A battle already open when the autopilot took over: the AI plays both sides to the end, takes all it can carry.
// Its deploy step too (deploy.js: the default posts; autoPlayerTurn ends it), as defences.js fightNow does.
function finishLiveBattle(state) {
  for (let i = 0; i < 400 && state.combat; i++) {
    const b = state.combat;
    if (b.over) closeCombat(state, { take: true });
    else if (b.phase === "player" || b.phase === "deploy") autoPlayerTurn(state);
    else runEnemyPhase(state);
  }
  // Never hang on a battle: one still going is ended with an outcome (the handler settles the team, the base, the
  // raid), not dropped.
  const b = state.combat;
  if (b && !b.over) endBattleNow(state, b.setup && b.setup.canRetreat ? "retreat" : "defeat");
  if (state.combat) closeCombat(state, { take: true });
  if (state.combat) state.combat = null;
}

// ======================================================================================
// Cards
// ======================================================================================
function resolveCard(state) {
  const card = state.cards[0];
  const g = gov(state);
  g.stats.cards++;
  const p = card.partyId != null ? state.parties.find((x) => x.id === card.partyId) : null;
  if (card.isOrders) {
    state.cards.shift();
    if (p) teamAct(state, p);
    return;
  }
  const opts = card.choices.filter((c) => !c.uiAction && !isDisabled(state, c));
  const choice = opts.length ? pickChoice(state, card, opts, p) || fallbackChoice(opts) : null;
  state.cards.shift();
  if (!choice) return; // nothing it can pick (needs a map click): dropped, like the headless tools do
  const text = choice.resolve(state);
  pruneCards(state); // cards about a team or a person that this choice just removed (parties.js)
  if (choice.label === "OK") return;
  const where = card.where ? ` (${card.where})` : "";
  say(state, `${card.title}${where} → ${choice.label}.${text ? ` ${clip(text)}` : ""}`);
}
const clip = (t) => (t.length > 160 ? `${t.slice(0, 157)}...` : t);

// simtest.js rule: "Return home" if offered, else the first choice that can be taken.
const fallbackChoice = (opts) => opts.find((c) => c.label === "Return home") || opts[0];

function pickChoice(state, card, opts, p) {
  const P = persona(state);
  const find = (re) => opts.find((c) => re.test(c.label));
  const chance = (re) => { const c = find(re); return c ? pctIn(c.hint) ?? 0.5 : 0; };
  const t = card.title;
  if (card.kind === "conflict") return bestByUtility(state, card, opts, P);
  // Newcomers (recruits.js) by the bed / food / water rule; hub events and morale warnings (hubevents.js, morale.js)
  // by the score each choice carries.
  // Fighters who gave up a base you took (conquest.js): to the hub, not the base they lost.
  if (card.recruit && card.recruit.source === "conquest") { const h = hub(state); const n = card.recruit.candidates.filter((s) => s.pending).length || 1; return (h && roomFor(state, n) ? opts.find((c) => c.kind === "send" && c.sendTo === h.id) : null) || opts.find((c) => c.kind === "away") || null; }
  // Hardcore, on the road to the first hub: anyone who asks comes along while the team's food and water would last
  // everyone two more days and it is under six.
  if (card.recruit && p && firstHubPending(state)) {
    const k = card.recruit.candidates.filter((s) => s.pending).length || 1;
    const take = opts.find((c) => c.kind === "take");
    return (take && partyMembers(state, p).length + k <= 6 && carriedDays(state, p, k) >= 2 ? take : null) || opts.find((c) => c.kind === "away") || null;
  }
  // Room at the hub (where newcomers live), or at the outpost they would be taken in at or sent to: its own beds,
  // food and water (roomAt), so a hub that has outgrown its plots still takes people in where there is room.
  if (card.recruit) return autoRecruitPick(state, card, opts, (k, id) => { const b = id != null ? state.bases.find((x) => x.id === id) : null; return roomFor(state, k) || (!!b && b.type === "outpost" && roomAt(state, b, k)); });
  // A group asks you to storm a hive (jobs.js): yes when the war on the hives would take it on.
  if (card.jobId != null) {
    const job = jobById(state, card.jobId);
    if (job && job.type === "hive" && hiveJobOk(state, job)) return find(/^Accept/) || null;
  }
  if (opts.some((c) => typeof c.ai === "function")) return [...opts].sort((a, b) => (b.ai ? b.ai(state) : -99) - (a.ai ? a.ai(state) : -99))[0];
  // Radio offers (radio.js): agree when the hub has the goods. A trade caravan's stop (caravans.js): move on.
  // A group asking you to bring your side (radio.js bringCard): yes, at their fee, when the base can spare the goods
  // and the people (dealCaravanPlan); the caravan sets out at once.
  if (card.radioFrom != null && card.bring) {
    const yes = card.choices.find((c) => /^Agree and send/.test(c.label));
    const f = factionById(state, card.bring.factionId);
    if (yes && f && !pendingDeal(state, f) && dealCaravanPlan(state, { ...card.bring, id: -1 }).form) {
      return { label: yes.label, resolve: (st) => { const t = yes.resolve(st); const d = pendingDeal(st, f); const sent = d ? autoDealCaravan(st, d) : ""; return sent ? `${t} Then ${sent}` : t; } };
    }
    return find(/^No, thank/);
  }
  if (card.radioFrom != null) { const yes = find(/^Agree/); return yes && yes.affordable && yes.affordable(state) ? yes : find(/^No, thank/); }
  if (card.isCaravan) return find(/^Complete the radio deal/) || find(/^Go on to/) || find(/^Return home/);
  if (/^After the fight/.test(t)) {
    const fit = p && partyMembers(state, p).every((s) => s.health >= 55) && carriedDays(state, p) >= 2;
    return (fit ? find(/^Continue/) : null) || find(/^Return home/) || find(/^Continue/);
  }
  if (/^Raiders heading for /.test(t)) return raidWarningChoice(state, card, opts, P);
  if (/ asks for help$/.test(t)) {
    const h = hub(state);
    const ammo = h.stock.ammo || 0;
    const fighters = atBase(state, h.id).sort((a, b) => combatPower(b) - combatPower(a));
    if (P.raid && fighters.length >= 7 && fighters.slice(0, 3).reduce((a, s) => a + combatPower(s), 0) >= 14) return find(/^Send a squad/) || find(/^Ignore/);
    const spare = P.reserves ? Math.max(200, reserveStatus(state, h).ammo.target + 40) : P.name === "Cautious" ? 200 : 110;
    return (ammo >= spare ? find(/^Send 40 ammo/) : null) || find(/^Ignore/);
  }
  if (/^A stranger at the gate/.test(t) || /^Refugees at the gate/.test(t)) {
    const h = hub(state);
    const n = atBase(state, h.id).length;
    const days = (k) => (edibleFood(h) - 5 * k) / Math.max(1, n + k);
    // Water too (economy.js): the well has to keep up with one more, or there is a stock to live on.
    const wo = waterOutlook(state, h);
    const wet = (k) => wo.dryNet - k * wo.need.rate >= -1.5 && waterIn(h.stock) / Math.max(1, n + k) >= 3 && droughtWater(state, h, n + k);
    // Crops take weeks and winter brings none: a newcomer needs real reserves (a month's going into the cold).
    const minDays = Math.max(P.strangerDays * 2.5, seasonKey(state) === "autumn" || seasonKey(state) === "winter" ? 30 : 10);
    const ok = (k) => days(k) >= minDays && wet(k) && roomFor(state, k);
    if (/^Refugees/.test(t)) return (ok(2) ? find(/^Take them in/) : null) || (ok(1) ? find(/^Take one/) : null) || find(/^Turn them away/);
    return (ok(1) ? find(/^Let them in/) : null) || find(/^Turn them away/);
  }
  if (/^The leader is dead/.test(t)) {
    const lead = (c) => Number((/Leadership (\d+)/.exec(c.label) || [0, 0])[1]);
    return [...opts].sort((a, b) => lead(b) - lead(a))[0];
  }
  // Travel events (events.js) and the team's own finds (parties.js).
  if (/^Blocked highway/.test(t)) return (p && partyFuelOf(state, p) >= 12 ? find(/^Detour/) : null) || (chance(/^Squeeze/) >= 0.6 ? find(/^Squeeze/) : null) || find(/^Clear a path/);
  if (/^Breakdown/.test(t)) return find(/spare part/) || find(/^Repair/);
  if (/^Storm/.test(t)) return find(/^Shelter/);
  if (/^Bad footing/.test(t)) return ((p && (p.supplies.meds || 0) >= 2) || P.name === "Cautious" ? find(/^Treat it/) : null) || find(/^Keep moving/);
  if (/^The dead ahead/.test(t)) {
    const n = Number((/About (\d+)/.exec(card.text || "") || [0, 8])[1]);
    const ms = p ? partyMembers(state, p) : [];
    const power = p ? ms.reduce((a, s) => a + combatPower(s), 0) * armedFactor(ms, p.supplies.ammo || 0, p.supplies.arrows || 0, { need: (k) => (n * k) / Math.max(1, ms.length), short: 0.5 }) : 0; // events.js: the bows shoot arrows
    if (P.raid && power > n * 0.9) return find(/^Fight/);
    return (chance(/^Sneak around/) >= P.risk ? find(/^Sneak around/) : null) || find(/long way/);
  }
  // The worm (worm.js): a dewormer, surgery or a purge when there is one; in the brain stage, lock them away at a base
  // or end it on the road (nobody hurt when they turn); in the gut stage, carry on and purge it at home.
  if (/^The worm/.test(t)) return find(/^Give them the dewormer/) || find(/^Try surgery/) || find(/^Purge/) || (/reached the brain/.test(card.text || "") ? find(/^Lock them away/) || find(/^End it/) : find(/^Hope/));
  if (/^A hive/.test(t)) return find(/^Mark it/) || opts[opts.length - 1];
  // Storming a hive: only with the squad it was sent with (most of it still standing and healthy), by the odds.
  if (/^The hive: /.test(t)) return hiveChoice(state, card, opts, p, find);
  if (/^Hive growth: /.test(t)) return growthChoice(state, card, opts, p, find); // hivetech.js
  // Assaulting a group's base (conquest.js): storm when the odds the card shows are good enough for the style.
  if (card.assault) return assaultChoice(state, card, opts, p, find);
  // A horde coming for a base (defences.js): a decoy fire when the defences would not hold and no Wallbreaker
  // leads it, else man the defences.
  if (/^Horde heading for /.test(t)) {
    const decoy = /isn't fooled/.test(card.text) ? null : opts.find((c) => /decoy/i.test(c.label) && !isDisabled(state, c)) || find(/decoy/); // not on a horde a Shepherd leads
    return (/cannot hold/.test(card.text) && !/Wallbreaker at its head/.test(card.text) && decoy && !isDisabled(state, decoy) ? decoy : null) || find(/^Man the defences/);
  }
  if (/^Stranded traders/.test(t)) return find(/^Help them/);
  if (/^A survivor alone/.test(t)) {
    if (!roomFor(state, 1)) return find(/^Leave them/);
    return (p && carriedDays(state, p, 1) >= tripHoursLeft(state, p) / 24 + 0.5 ? find(/^Take them along/) : null) || find(/^Point them/);
  }
  if (/ patrol$/.test(t)) return find(/^Share news/);
  if (/^Abandoned supply truck/.test(t)) return P.name === "Cautious" ? find(/^Leave it/) : find(/^Search it/);
  if (/^Crashed military vehicle/.test(t)) return (chance(/^Search it/) >= P.risk ? find(/^Search it/) : null) || find(/^Leave it/);
  if (/^Tempers flare/.test(t)) return (chance(/^Step in/) >= 0.5 ? find(/^Step in/) : null) || find(/^Let them/);
  if (/^Cold feet/.test(t)) return find(/^Convince/);
  if (/^Horde of /.test(t)) return (p && p.vehicle && partyFuelOf(state, p) >= 8 ? find(/^Outrun/) : null) || find(/^Hide/);
  if (card.gathering != null) return find(/^Break up/) || find(/^Back off/); // hivebirth.js: sent to break up a gathering (gatheringCands)
  if (/^A horde of /.test(t)) return (P.raid && (p?.supplies.ammo || 0) >= 30 ? find(/killzone/) : null) || find(/^Back off/);
  if (/^Wrecked car/.test(t)) return find(/^Restore/) || find(/^Strip/);
  return null;
}

// Beds for k more people at the hub, where newcomers live: built, queued, or the next bunkhouse or barracks it can
// still get (nextHousing; plus the style's slack). Counting every base's beds crowded the hub (seed 5035, large: 22-29
// people in 16 beds, 216 walked away and the same deserters were taken back again and again).
const roomFor = (state, k) => roomAt(state, hub(state), k);
// The same at any base: an outpost counts only the beds it has and has queued, with no slack, and its own water; its
// food is the hub's (it keeps only about a week's and the hub tops it up over the supply line, economy.js), so the
// food and winter rules are the hub's with k more mouths.
function roomAt(state, h, k) {
  if (!h) return false; // no base left (conquest.js exiles): no room for anyone
  const isHub = h.type === "hub";
  const next = isHub ? nextHousing(state, h) : null;
  const beds = baseBeds(h) + queuedBeds(h) + (next ? next.beds : 0);
  if (residents(state, h.id).length + returning(state, h) + k > beds + (isHub ? persona(state).crowdSlack : 0)) return false;
  // Food and water for them too (economy rework): every newcomer, whatever card brings them.
  const fh = isHub ? h : hub(state);
  if (!fh) return false;
  const n = atBase(state, h.id).length, nf = atBase(state, fh.id).length;
  const foodDays = (edibleFood(fh) - 5 * k) / Math.max(1, nf + k);
  const wo = waterOutlook(state, h);
  if (!(foodDays >= Math.max(10, foodTarget(state, fh)) && wo.dryNet - k * wo.need.rate >= -1.5 && waterIn(h.stock) / Math.max(1, n + k) >= 3 && droughtWater(state, h, n + k))) return false;
  // No newcomers while the winter stores would not feed them too (farming.js winterOutlook with k more mouths).
  return !winterActive(state, fh) || winterOutlook(state, fh, { extra: k + homeMouths(state, fh), also: winterPool(state, fh) }).short <= 0;
}

// ---------- housing ----------
// For the headless tests (tools/plotstest.js): the housing plan below, read-only.
export const housingAI = {
  next: (state, base) => nextHousing(state, base), cramped: (state) => hubCramped(state), roomAt: (state, base, k) => roomAt(state, base, k),
  movers: (state, o, avail = 9) => movers(state, hub(state), o, avail), bedsFree: (state, o) => outpostBedsFree(state, o), wishes: (state, base) => buildWishes(state, base),
};
// The next beds a base can still get (buildings.js BEDS), or null: a new bunkhouse while building plots are plenty; a
// barracks (12 beds on one plot) once they are scarce (HOUSING.scarce of the base's building plots free, or fewer) or
// the bunkhouses are at their max; with no plot free, a standing bunkhouse expanded into a barracks where it stands
// (+6, no plot). A barracks takes parts: it is the plan only while the base keeps HOUSING.partsKeep after paying them
// (else a bunkhouse on a free plot). { type, beds, upgrade (the bunkhouse's id, for an expansion) }.
// (Reserving the hub's last plots for bunkhouses was tried in the census and left out: more hunger, fewer wins; a
// barracks gets twice the beds out of whatever plot is left.)
// scarce: share of the building plots; partsKeep: parts left after a barracks; scrapAhead: scrap above the cost for a
// wish that is not urgent; ahead: an outpost of a cramped hub keeps this many beds free; moveMax / headroom / moveFood:
// people moved out of a cramped hub at a time, the beds it keeps free under its ceiling, food sent along a head;
// line: the least supply-line strength (economy.js) of an outpost people move to.
const HOUSING = { scarce: 0.25, partsKeep: 1, scrapAhead: 25, ahead: 3, moveMax: 3, headroom: 2, moveFood: 4, line: 0.5 };
function nextHousing(state, base) {
  if (isShelter(base)) return null; // a shelter has no building plots: it is built up into a base first
  const st = base.stock;
  const free = plotsFree(base, "building");
  const queued = (t) => base.construction.filter((c) => c.type === t && (!c.target || BUILDINGS[t].from)).length;
  const barracksRoom = countAll(base, "barracks") + queued("barracks") < BUILDINGS.barracks.max;
  const bunkRoom = countAll(base, "bunkhouse") + queued("bunkhouse") < BUILDINGS.bunkhouse.max;
  const parts = (cost) => (st.parts || 0) - (cost.parts || 0) >= HOUSING.partsKeep;
  const scarce = free <= Math.ceil(plotCap(base, "building") * HOUSING.scarce);
  if (free > 0) {
    if (barracksRoom && (scarce || !bunkRoom) && parts(BUILDINGS.barracks.cost)) return { type: "barracks", beds: BEDS.barracks };
    if (bunkRoom) return { type: "bunkhouse", beds: BEDS.bunkhouse };
  }
  if (!barracksRoom || !parts(BARRACKS_UP.cost)) return null;
  const bunk = base.buildings.find((b) => b.type === "bunkhouse" && !b.broken && !base.construction.some((c) => c.target === b.id));
  return bunk ? { type: "barracks", upgrade: bunk.id, beds: BEDS.barracks - BEDS.bunkhouse } : null;
}
// A wish's check and cost: a new building (canBuild) or a bunkhouse expanded (canExpandBunkhouse).
const wishCheck = (state, base, w) => (w.upgrade != null ? canExpandBunkhouse(state, base, w.upgrade) : canBuild(state, base, w.type));
const wishCost = (w) => (w.upgrade != null ? BARRACKS_UP.cost : BUILDINGS[w.type].cost);
const wishQueue = (state, base, w) => (w.upgrade != null ? queueBunkhouseExpand(state, base, w.upgrade) : queueBuild(state, base, w.type));
// The housing wish (nextHousing) for buildWishes, and a bunkhouse after a barracks while a plot is free and the
// barracks waits on scrap or parts (planBuilds takes the first it can build). Empty when nothing more fits.
function housingWishes(state, base, why, save) {
  const next = nextHousing(state, base);
  if (!next) return [];
  const label = next.upgrade != null ? `${why}: expand a bunkhouse into a barracks (no building plot free)` : next.type === "barracks" ? `${why}: a barracks (12 beds on one plot; building plots are short)` : why;
  const out = [{ type: next.type, upgrade: next.upgrade, why: label, save }];
  if (next.type === "barracks" && next.upgrade == null && countAll(base, "bunkhouse") + base.construction.filter((c) => c.type === "bunkhouse").length < BUILDINGS.bunkhouse.max) out.push({ type: "bunkhouse", why, save: false });
  return out;
}

// The hub has outgrown its plots: no building plot free, nothing more it can build or expand for beds (nextHousing),
// and its people (and the teams coming home) fill the beds it has and has queued to within two. Then the
// governor grows outwards: an extra outpost (planTrip), people sent to outposts with beds and food to spare, and
// housing, food, water and storage built at the outposts ahead of them (planSupplyRuns, buildWishes).
function hubCramped(state, h = hub(state)) {
  if (!h || isShelter(h) || plotsFree(h, "building") > 0) return false;
  const next = nextHousing(state, h);
  return residents(state, h.id).length + returning(state, h) + 2 > baseBeds(h) + queuedBeds(h) + (next ? next.beds : 0);
}
// Beds an outpost has free for people sent from the hub (built and queued beds, less its residents and the teams
// coming home to it).
const outpostBedsFree = (state, o) => baseBeds(o) + queuedBeds(o) - residents(state, o.id).length - returning(state, o);
// How many people the hub sends to live at outpost o now (planSupplyRuns), out of avail it can spare: only while the
// hub has outgrown its plots (hubCramped) and is fed (10 days a head), the outpost is not running dry, has beds
// free and a good supply line (economy.js supplyLine, HOUSING.line: the hub tops up its food over it); HOUSING.moveMax
// at a time, and no more than brings the hub HOUSING.headroom under its ceiling. 0: nobody.
function movers(state, h, o, avail) {
  if (avail < 1 || isShelter(o) || !hubCramped(state, h) || outpostThirsty(state, o)) return 0;
  if (((o.supplyLine && o.supplyLine.strength) ?? 1) < HOUSING.line) return 0;
  if (edibleFood(h) / Math.max(1, atBase(state, h.id).length) < 10) return 0;
  const next = nextHousing(state, h);
  const over = residents(state, h.id).length + returning(state, h) + HOUSING.headroom - (baseBeds(h) + queuedBeds(h) + (next ? next.beds : 0));
  let n = Math.max(0, Math.min(HOUSING.moveMax, outpostBedsFree(state, o), over, avail));
  // Water for them there through a summer too (droughtWater): fewer, or nobody, until its wells and barrels are in.
  while (n > 0 && !droughtWater(state, o, atBase(state, o.id).length + n)) n--;
  return n;
}

// Water for n people through a summer (economy.summerWater: an average summer day, everyone drinking 1.3, and a
// heat-wave stretch at 1.6 with wells at 60%; filters at three quarters, as they clog up and cost scrap): the
// sources keep up on an average summer day, and the heat-wave gap fits in what the base can hold. The same rule all
// year: a hub that outgrows its summer water dies of thirst in July, so newcomers wait for wells, filters and
// cisterns (the build and craft planners work towards one more mouth than the hub has: waterPlan).
export function droughtWater(state, base, n) {
  // Everyone who drinks there (residents: trade-route escorts too), teams coming home, and the newcomers.
  const sw = summerWater(state, base, { extra: Math.max(0, n - atBase(state, base.id).length) + returning(state, base), filterShare: AP_FILTER_SHARE });
  return sw.net >= 0 && sw.reserve <= sw.cap * 0.9;
}

// ---------- water: the summer plan ----------
// What the governor plans for water at a base, once an hour (memo): the summer outlook for the people here plus a
// few more (SUMMER_HEADROOM: so the hub can grow), the filters that would close the summer gap, the stock to hold
// before and through summer (`reserve`: a heat-wave stretch, at most 90% of what the base can store), whether
// summer is close (the last SUMMER_LEAD days of spring, or summer itself), and the scrap and parts held back for
// water (`hold`: repairing a broken well or pump comes before any other repair, building or crafting; and the
// filters still wanted). planBuilds, planCrafts, the reserves, the newcomer rule and the water runs read it.
const AP_FILTER_SHARE = 0.75, SUMMER_HEADROOM = 2, SUMMER_LEAD = 21, FILTER_CAP = 18;
let waterMemo = { state: null, hour: -1, map: new Map() };
export function waterPlan(state, base) {
  if (waterMemo.state !== state || waterMemo.hour !== state.hour) waterMemo = { state, hour: state.hour, map: new Map() };
  const memo = waterMemo.map.get(base.id);
  if (memo) return memo;
  const n = atBase(state, base.id).length + returning(state, base);
  const sw = summerWater(state, base, { extra: returning(state, base) + (base.type === "hub" ? SUMMER_HEADROOM : 0) }); // residents, teams out, a few more
  const s = wxSeason(state);
  const near = s.key === "summer" || (s.key === "spring" && s.daysLeft < SUMMER_LEAD);
  // Filters: enough to close the summer heat-wave gap (or today's dry-day gap, whichever is bigger), 3 a day each.
  const p = waterProduction(state, base);
  const dryGap = n * Math.max(1, waterNeed(state, base).rate) - ((p.own + p.stream + p.wells) / (p.factor || 1)) * 0.6;
  // The summer's filters only from three weeks before it (a filter clogs in about 20 days).
  const forSummer = near ? sw.fix.filter((f) => f.type === "waterfilter").reduce((a, f) => a + f.count, 0) + Math.floor(p.filters / 3) : 0;
  const filters = Math.max(0, Math.min(FILTER_CAP, Math.max(forSummer, Math.ceil(dryGap / 3))));
  const reserve = Math.min(Math.floor(sw.cap * 0.9), Math.max(sw.reserve, n * (near ? 10 : 7)));
  // Broken water fixtures: a proper repair each (3 scrap, 1 part); filters still to make: 4 scrap each, two at a time.
  const brokenWater = brokenAt(base).filter((fx) => (fx.type === "well" || fx.type === "pump") && !jobFor(base, fx)).length;
  const have = [...base.armory, ...atBase(state, base.id).map((x) => x.gear.tool)].filter((it) => it && it.key === "waterfilter").length;
  const crafter = atBase(state, base.id).some((x) => skill(x, CRAFTS.waterfilter.skill) >= CRAFTS.waterfilter.min);
  // Scrap for filters is held only while it matters: summer near and short, or the water running low now.
  const urgent = (near && (sw.net < 0 || sw.reserve > sw.cap)) || dryGap > 0;
  // The water boiler (worm.js) burns firewood, not scrap: its wood is planned with the heating (woodcutting.js woodNeed).
  const hold = { scrap: brokenWater * 3 + (crafter && urgent ? Math.min(2, Math.max(0, filters - have)) * CRAFTS.waterfilter.in.scrap : 0), parts: brokenWater };
  const out = { sw, near, filters, reserve, hold, brokenWater, short: sw.net < 0 || sw.reserve > sw.cap };
  waterMemo.map.set(base.id, out);
  return out;
}
// Water is tight at a base: it runs out within 8 days at today's rate. The governor rations then: no water into
// the still or the preserving kitchen (visitors.js: no guests sheltered on a low stock either).
function waterTight(state, base) {
  const wo = waterOutlook(state, base);
  return wo.net < 0 && wo.daysLeft < 8;
}
// A water run is worth it: water is tight, or summer is near (or here), falls short and the stock is under half
// the summer reserve.
function waterRunWanted(state, base) {
  const wp = waterPlan(state, base);
  return waterTight(state, base) || (wp.near && wp.short && waterIn(base.stock) < wp.reserve * 0.5);
}
// Scrap (or parts) held back for water at a base: other builds, repairs and crafts leave it alone.
const WATER_BUILDS = ["well", "rain_catcher", "cistern", "boiler", "water_barrel"]; // the boiler: safe water (worm.js)
const waterHold =(state, base, k = "scrap") => (base.owner == null || base.owner === "player" ? waterPlan(state, base).hold[k] || 0 : 0);

// ---------- food and the winter (the food planner) ----------
// Days of food (fresh + preserved) a base should hold now. Crops take weeks, nothing grows outdoors in winter and
// the first spring harvest comes weeks into spring, so the governor plans the year: from mid-summer to the first
// spring harvest the target comes from the winter outlook (farming.js winterOutlook: food eaten until the first
// spring harvest, more in the cold, plus spoilage by the storage there is and seed for the spring, less what the
// crops in the ground should still bring in, plus a 15% margin for bad luck), in days for the people here. Before
// mid-summer most of the year's crops are still to be sown: 15 days, ramping up from early summer. Never under 15.
// The target drives the farmers (planRoles), how much the hub wants food (needs: trips, trades, radio deals) and
// newcomers (roomFor).
export function foodTarget(state, base = hub(state)) {
  const s = wxSeason(state);
  const seasonal = s.key === "autumn" ? 55 : s.key === "winter" ? s.daysLeft + 25 : s.key === "summer" ? 12 + Math.max(0, 28 - s.daysLeft) * 1.5 : 15;
  if (!base || !winterActive(state, base)) return seasonal;
  // The stock this base must hold now: what the pool needs (with the safety margin) less what the fields bring in
  // and what the outposts hold, in days for the people here.
  const w = winterPlan(state, base);
  const req = w.need + w.spoil + w.seed + w.margin - w.crops - Math.max(0, w.have - edibleFood(base));
  return Math.max(15, Math.min(150, req / Math.max(1, mouthsAt(state, base).heads))); // upkeep.js: everyone fed here
}
// From mid-summer until the first spring harvest the winter outlook drives the plans.
function winterActive(state, base) {
  const s = wxSeason(state);
  if (s.key === "autumn" || s.key === "winter") return true;
  if (s.key === "summer") return s.dayOfSeason >= 14;
  const gap = winterPlan(state, base).gap;
  return gap.inGap && gap.start >= 0; // early spring, before the first harvest (not the campaign's first days)
}
// The winter outlook of a base, worked out once a day (it looks ahead day by day to the first spring harvest).
// Teams out from the base eat there when they come home: they count. The hub's plan pools the outposts (they ship
// it their surplus and it feeds them when they run short).
const winterPool = (state, base) => (base.type === "hub" ? state.bases.filter((b) => b.type === "outpost") : []);
const homeMouths = (state, base) => winterPool(state, base).concat([base]).reduce((a, b) => a + returning(state, b), 0);
function winterPlan(state, base) {
  const g = gov(state);
  const memo = g.winter || (g.winter = {});
  const m = memo[base.id];
  if (m && m.day === day(state)) return m;
  return (memo[base.id] = { day: day(state), ...winterOutlook(state, base, { extra: homeMouths(state, base), also: winterPool(state, base) }) });
}
// Food short of the winter plan, as a share of what the hungry gap needs (0 = covered).
const winterShort = (state, base) => (winterActive(state, base) ? winterPlan(state, base).short / Math.max(1, winterPlan(state, base).gapNeed) : 0);
// Weekly in autumn (and on the first day of winter): the winter stores, in the log.
function winterReport(state) {
  const s = wxSeason(state);
  if (!((s.key === "autumn" && (s.dayOfSeason - 1) % 7 === 0) || (s.key === "winter" && s.dayOfSeason === 1))) return;
  const h = hub(state);
  if (!h) return;
  const w = winterPlan(state, h);
  const st = foodStore(state, h);
  const fresh = Math.floor(st.fresh), pres = Math.floor(st.preserved);
  const verdict = w.short > 0
    ? `short by about ${w.short}${w.runsOut != null ? `, out of food around day ${w.runsOut + 1}` : ""}: more farmers, food trips and preserving, and no newcomers until it is covered`
    : `enough, about ${Math.max(0, w.end)} to spare`;
  say(state, `Winter stores at ${h.name}: ${fresh + pres} food (${fresh} fresh, ${pres} preserved; cellar room ${st.cap}${st.outside >= 1 ? `, ${Math.floor(st.outside)} stored outside` : ""})${w.bases > 1 ? ` plus ${Math.max(0, w.have - fresh - pres)} at the outposts` : ""}, about ${w.crops} still to come from the fields. The ${w.people} people${w.bases > 1 ? " (outposts and teams too)" : ""} need about ${w.need + w.spoil + w.seed} (eating ${w.need}, spoilage ${w.spoil}, spring seed ${w.seed}) to reach the first spring harvest around day ${w.gap.end + 1}, plus ${w.margin} to spare for bad luck: ${verdict}.`, w.short > 0 ? "danger" : "info");
}

const partyFuelOf = (state, p) => {
  const v = p.vehicleId ? state.vehicles.find((x) => x.id === p.vehicleId) : null;
  return (v ? v.fuel : 0) + (p.supplies.fuel || 0);
};
// Rough hours until a team is home: the way left, plus (going out) the job and the same way back.
const tripHoursLeft = (state, p) => (p.phase === "back" ? hoursLeft(state, p) : 2 * hoursLeft(state, p) + 10);
// Days of food and water a team carries on the move (extra = more mouths; a loaded team eats more, load.js; food at
// today's cold, no camp fire on the move: weather.js foodNeedFactor).
function carriedDays(state, p, extra = 0) {
  const n = partyMembers(state, p).length;
  const perDay = (n ? partyPace(state, p).eatMove : 0) + extra;
  const have = (k) => (k === "water" ? teamWaterIn(p) : (p.supplies[k] || 0) + ((p.cargo && p.cargo.supplies[k]) || 0)); // water: both kinds
  return Math.min(have("food") / foodNeedFactor(state), have("water") / thirstAt(state)) / Math.max(1, perDay); // water: at today's thirst, food at today's cold (weather.js)
}

// Conflict cards (conflicts.js): every option is scored from the odds the card shows.
function bestByUtility(state, card, opts, P) {
  let best = null, bestU = -Infinity;
  for (const ch of opts) {
    const u = utility(ch, P);
    if (u > bestU) { best = ch; bestU = u; }
  }
  return best;
}

function utility(ch, P) {
  const L = ch.label, H = ch.hint || "";
  let c = pctIn(H);
  if (c == null && /let you pass/.test(H)) c = 0.95;
  const k = c == null ? 0.5 : c;
  // A fight costs blood even when it is won (breakoff.js, calibrated on the battle map): the closer, the more.
  const fight = (win) => win * k - P.lossFear * (1 - k) - P.lossFear * (BREAKOFF.WON_DOWN + BREAKOFF.WON_CLOSE * (1 - k)) - 2 + P.fightBias;
  if (/^Invoke your/.test(L)) return 6 * k - (1 - k);
  if (/toll|palms|Offer them supplies/.test(L)) return 5 * k - 7 * (1 - k) - 1.5;
  if (/^Talk|^Negotiate|^Ask them to let/.test(L)) return 5.5 * k - (1 - k);
  if (/^Run for it|^Floor it/.test(L)) return 5 * k - 5 * (1 - k);
  if (/^Hide/.test(L)) return 5 * k - 7 * (1 - k);
  if (/^Surrender|^Submit/.test(L)) return /dragged off/.test(H) ? -8 : /a fifth/.test(H) ? -1 : -4;
  if (/^Fight back|^Open fire|^Storm/.test(L)) return fight(5);
  if (/^Ambush|hit the dead|^Help /.test(L)) return fight(6.5) + P.raidBias;
  if (/^Watch them|^Follow them/.test(L)) return P.curious - 6 * k; // k: the risk they notice you
  if (/^Slip away/.test(L)) return 4 * k - 4 * (1 - k);
  if (/^Steal/.test(L)) return (6 + P.raidBias) * k - 8 * (1 - k);
  if (/^Approach openly/.test(L)) return /hostile/.test(H) ? -2 : 4;
  if (/^Join in/.test(L)) return P.raidBias - 1;
  if (/^Draw the dead/.test(L)) return 5 * k - 6 * (1 - k);
  if (/^Sneak in/.test(L)) return 8 * k - 7 * (1 - k);
  if (/^Pay (a|the) ransom|^Pay for them/.test(L)) return 5;
  if (/^Leave|^Not now/.test(L)) return 0.5;
  return 0;
}

// Raid warning: rally the guards first (roles change at once), then judge the odds with everyone on alert. Below
// the style's hold ratio it weighs the tribute against what a fight is likely to cost (factions.js raidStakes:
// stolen stock, wrecked buildings, wounds): Cautious pays when the tribute is under 1.4× that, Balanced under 1×,
// Aggressive under 0.6× (and it fights in person first when the odds are poor).
const TRIBUTE_LEAN = { Cautious: 1.4, Balanced: 1, Aggressive: 0.6 };
const RAID_BREAK = 0.8; // factions.js RAIDS.BREAK: below it a raid overruns the base
function raidWarningChoice(state, card, opts, P) {
  const find = (re) => opts.find((c) => re.test(c.label));
  const base = state.bases.find((b) => card.title === `Raiders heading for ${b.name}`);
  const raid = base && state.parties.find((q) => q.kind === "raid" && q.target && q.target.kind === "player" && q.target.baseId === base.id && !q.returning);
  if (!base || !raid) return find(/^Prepare/);
  planRoles(state, base);
  const stakes = raidStakes(state, base, raid);
  if (stakes.ratio >= P.holdRatio) return find(/^Prepare/);
  const pay = stakes.tribute < stakes.fight * (TRIBUTE_LEAN[P.name] ?? 1) ? find(/^Pay tribute/) : null;
  // Retreat (conquest.js) when the base would be overrun anyway and the tribute cannot be paid: an outpost below the
  // style's retreatBelow, the hub only when it is hopeless (a quarter of what it takes) and another base can take
  // everyone in; never the last base.
  const away = opts.find((c) => c.retreat);
  const other = nearestOtherBase(state, base);
  if (away && other && !pay && (base.type === "outpost" ? stakes.ratio < P.retreatBelow : stakes.ratio < 0.25)) return away;
  if (P.raid) return (stakes.ratio >= 0.9 ? find(/^Prepare/) : null) || find(/^Defend in person/) || pay || find(/^Prepare/);
  return pay || find(/^Prepare/);
}

// ======================================================================================
// Teams in the field
// ======================================================================================
// What a waiting team does next (the "Done: ..." / "Orders" card, or a team left holding).
function teamAct(state, p) {
  if (!state.parties.includes(p) || p.phase !== "waiting") return;
  const P = persona(state);
  const home = state.bases.find((b) => b.id === p.homeBaseId) || hub(state);
  if (!home) return firstHubPending(state) ? roadAct(state, p) : exileAct(state, p); // no base: the staging camp (staging.js)
  if (p.apCutOff && !planPath(state, partyTile(p), home.tile, false)) return; // across water: waits for you
  // Waiting at a site another team was searching (only one search runs at a time).
  if (p.apResume === "scavenge") {
    // Waiting draws attention (fieldheat.js): past Heat 60 the team gives up on the site and moves on or goes home.
    if (state.engagement && (p.heat || 0) < 60) return;
    if (state.engagement) say(state, `${teamName(state, p)} has waited too long at ${tileLabel(state, partyTile(p))} (Heat ${Math.round(p.heat)}): it moves on.`);
    delete p.apResume;
    if (!state.engagement && orderOptions(state, p).some((o) => o.mission === "scavenge" && !o.disabled)) {
      startOrder(state, p, { type: "mission", mission: "scavenge" });
      return;
    }
  }
  // A queue set up before the autopilot took over carries on (a search waits for its turn).
  if (p.orders && p.orders.length) {
    const next = p.orders[0];
    if (next.type === "mission" && next.mission === "scavenge" && state.engagement) return;
    resumeQueue(state, p);
    return;
  }
  // A hive set on fire (hiveChoice): storm it now, or set the next fire.
  if (hiveAgain(state, p)) return;
  if (growthAgain(state, p)) return; // a growth that took one fire: the next one
  if (claimAct(state, p)) return; // a claim trip at its tile: the marker post goes up, or the well is dug (claims.js)
  // The badly hurt get carried meds before a long walk home.
  const back = planPath(state, partyTile(p), home.tile, p.vehicle);
  const hoursHome = back ? travelHours(state, back.path, { vehicle: p.vehicle, ...paceOpts(p) }).hours : 0;
  const hurt = partyMembers(state, p).filter((s) => (s.woundInfected || s.health < 35) && fieldTreatInfo(state, p, s).ok);
  if (hurt.length && hoursHome > 10) {
    p.orders = [...hurt.slice(1).map((s) => ({ type: "treat", survivorId: s.id })), { type: "home" }];
    say(state, `${teamName(state, p)}: treating ${names(hurt)} before heading home.`);
    startOrder(state, p, { type: "treat", survivorId: hurt[0].id });
    return;
  }
  // Cautious recon (planTrip): the team has had its look; it searches the site if it is worth it and the team is
  // fit, fed for the search and the way home, and no other search is running.
  if (p.ap && p.ap.mission === "recon" && !p.apReconDone && partyTile(p) === p.ap.tile) {
    p.apReconDone = true;
    const s = siteScore(state, p.ap.tile, needs(state), P);
    const fit = partyMembers(state, p).every((x) => x.health >= P.hurtStop + 10 && !x.woundInfected);
    const room = cargoRoom(state, p) >= partyCapacity(state, p) * 0.5;
    if (s && s.value >= 0.3 && fit && room && !state.engagement && carriedDays(state, p) >= ((hoursHome + P.searchHours + 2) / 24) * 1.25 &&
        orderOptions(state, p).some((o) => o.mission === "scavenge" && !o.disabled)) {
      say(state, `${teamName(state, p)} had a look around ${tileLabel(state, p.ap.tile)}: worth a search.`);
      startOrder(state, p, { type: "mission", mission: "scavenge" });
      return;
    }
  }
  // Fit, fed and with room to carry: try one more site nearby.
  if ((p.apChain || 0) < P.chain && p.mission !== "outpost" && chainNext(state, p)) return;
  // Not food enough for the way home (held up on the road, food lost): food from the land first (landFoodAct).
  if (back && (p.apLandFood || 0) < LAND.tries && foodDaysOf(state, p) < (hoursHome / 24) * 1.1 + 0.25 && landFoodAct(state, p, { urgent: true })) { p.apLandFood = (p.apLandFood || 0) + 1; return; }
  startReturn(state, p);
  if (p.phase === "waiting" && !p.apCutOff) {
    p.apCutOff = true;
    say(state, `${teamName(state, p)} has no way home over land. It waits for you (a boat order from the team panel).`, "danger");
  }
}

function chainNext(state, p) {
  const members = partyMembers(state, p);
  if (!members.length || members.some((s) => s.health < 60 || s.woundInfected)) return false;
  const room = cargoRoom(state, p);
  if (room < partyCapacity(state, p) * 0.5) return false;
  const here = partyTile(p);
  const need = needs(state);
  const P = persona(state);
  let best = null;
  for (const id of state.grid.within(here, 3)) {
    if (id === here) continue;
    const s = siteScore(state, id, need, P);
    if (!s || s.value < 0.6) continue;
    const res = planPath(state, here, id, p.vehicle);
    if (!res) continue;
    const score = s.value / (1 + res.cost / 20);
    if (!best || score > best.score) best = { id, score, cost: res.cost };
  }
  if (!best) return false;
  const home = state.bases.find((b) => b.id === p.homeBaseId) || hub(state);
  const back = planPath(state, best.id, home.tile, p.vehicle);
  const hours = (best.cost + (back ? back.cost : 48)) / Math.max(0.3, partySpeed(p)) + P.searchHours + 6; // at its loaded pace
  if (carriedDays(state, p) < (hours / 24) * 1.25) return false;
  p.apChain = (p.apChain || 0) + 1;
  orderMove(state, p, best.id);
  p.orders = [{ type: "mission", mission: "scavenge" }];
  say(state, `${teamName(state, p)} moves on to ${tileLabel(state, best.id)} to search it too.`);
  return true;
}

// Only one scavenging search can run at a time (state.engagement): a second team about to start one holds at
// the site as a plain move and searches once the first is done.
function guardArrivals(state) {
  let busy = !!state.engagement;
  for (const p of state.parties) {
    if (p.owner !== "player" || p.kind === "convoy" || p.phase !== "out") continue;
    const queued = p.mission === "move" && p.orders && p.orders[0] && p.orders[0].type === "mission" && p.orders[0].mission === "scavenge";
    if (p.mission !== "scavenge" && !queued) continue;
    if (hoursLeft(state, p) > 1) continue;
    if (!busy) { busy = true; continue; }
    // In radio contact the governor redirects the team, as you could: it holds at the site as a plain move.
    // Out of contact it cannot give orders (the UI cannot either): the team arrives, finds the search slot
    // taken and waits there (parties.js). The note is the governor's own, so it sends the team in afterwards.
    if (p.radioLive) {
      if (queued) p.orders.shift();
      else p.mission = "move";
    }
    p.apResume = "scavenge";
  }
}

// Teams left waiting with no card (held, or the card was cleared), and teams stuck halted with nothing to resolve.
function idleTeams(state) {
  for (const p of [...state.parties]) {
    if (p.owner !== "player" || p.kind === "convoy" || !state.parties.includes(p)) continue;
    const hasCard = state.cards.some((c) => c.partyId === p.id);
    if (p.crawl) { if (!hasCard && !state.combat) crawlAutoStep(state, p); continue; } // a city crawl left open when the autopilot came on (citycrawl.js)
    if (p.phase === "waiting" && !hasCard) teamAct(state, p);
    const halted = p.phase === "engaged" && !hasCard && !(state.engagement && state.engagement.partyId === p.id) &&
      !(state.trade && state.trade.partyId === p.id) && !state.combat;
    p.apStuck = halted ? (p.apStuck || 0) + 1 : 0;
    if (p.apStuck >= 2) {
      p.apStuck = 0;
      delete p.conflictResume;
      awaitOrders(state, p, "The team regroups.");
    }
  }
}

// ---------- scavenging searches ----------
function engagementHour(state) {
  const e = state.engagement;
  if (!e) return;
  const p = engagementParty(state);
  if (!p || e.done || !partyMembers(state, p).length) {
    state.engagement = null;
    return;
  }
  if (p.apResume) delete p.apResume; // this team is searching now: nothing left to resume
  const g = gov(state);
  if (e.apSince == null) {
    // The team just got there: pick an approach; the search starts next hour.
    e.apSince = state.hour;
    if (!e.approach) e.approach = chooseApproach(state, p, e);
    return;
  }
  if (!e.approach) e.approach = chooseApproach(state, p, e);
  searchHour(state);
  g.stats.searches++;
  if (e.done || !state.parties.includes(p)) {
    state.engagement = null;
    return;
  }
  if (!shouldExtract(state, p, e)) return;
  const t = state.tiles[e.tile];
  g.visited[e.tile] = { day: day(state), hour: state.hour, loot: t.loot };
  g.stats.extractions++;
  say(state, `${teamName(state, p)} leaves ${tileLabel(state, e.tile)} after ${e.hours}h (Heat ${Math.round(e.heat)}, ${foundLoad(e)} kg of finds).`);
  extract(state);
}

function chooseApproach(state, p, e) {
  const P = persona(state);
  const t = state.tiles[e.tile];
  const members = partyMembers(state, p);
  const power = members.reduce((a, s) => a + combatPower(s), 0);
  if (P.name === "Cautious" || e.guarded || t.infection > 0.5) return P.raid && power >= 16 && !e.guarded ? "normal" : "sneak";
  if (P.raid && power >= 12 && (p.supplies.ammo || 0) >= members.length * 18) return "loud";
  return t.infection > 0.35 ? "sneak" : "normal";
}

function shouldExtract(state, p, e) {
  const P = persona(state);
  const members = partyMembers(state, p);
  if (!members.length) return true;
  // Cautious: while the hub is short of something, two more hours (the Heat limit stays where it is).
  if (e.hours >= P.searchHours + (reserveShort(state).length ? 2 : 0) || e.heat >= P.searchHeat) return true;
  if (members.some((s) => s.health < P.hurtStop)) return true;
  const room = cargoRoom(state, p);
  if (foundLoad(e) >= room * 0.95) return true;
  if ((p.supplies.ammo || 0) < members.length * 2 && e.heat >= 25) return true;
  const recent = e.log.slice(-2);
  return e.hours >= 2 && recent.length === 2 && recent.every((l) => /Nothing useful/.test(l));
}

// ---------- trade visits ----------
function handleTrade(state) {
  const ctx = tradeContext(state);
  if (!ctx || !hub(state)) { // no base left (conquest.js exiles): nothing to trade for
    if (ctx && ctx.p && state.trade) { try { endTrade(state); } catch (e) { /* closed below */ } }
    state.trade = null;
    return;
  }
  if (ctx.visitor) {
    // Merchants or travellers from outside (visitors.js): a manual nobody has studied, then what the hub is short of.
    say(state, `Outsiders (${ctx.f.name}) at ${ctx.base ? ctx.base.name : "the roadside"}: ${autoVisitorTrade(state, needs(state), gov(state).personality, tradeSpare(state))}.`);
    return;
  }
  if (ctx.kind === "radio") { state.trade = null; return; } // a radio trade left open by hand (radiotrade.js): closed
  if (ctx.kind === "caravan") {
    // Their caravan at one of your bases (caravans.js): only the Aggressive style ever attacks one.
    say(state, `Caravan from ${ctx.f.name} at ${ctx.base.name}: ${autoCaravanTrade(state, needs(state), gov(state).personality, tradeSpare(state)).replace(/\.$/, "")}.`);
    return;
  }
  const { p, f, speech } = ctx;
  const have = {};
  for (const k of Object.keys(SUPPLIES)) have[k] = Math.floor(p.supplies[k] || 0) + Math.floor(p.cargo.supplies[k] || 0);
  const g = gov(state);
  const need = needs(state);
  const home = state.bases.find((b) => b.id === p.homeBaseId) || hub(state);
  const back = planPath(state, partyTile(p), home.tile, p.vehicle);
  const n = partyMembers(state, p).length;
  const road = Math.ceil((n * ((back ? back.cost : 24) + 8)) / 24 * 1.3) + 1;
  // Offer what the hub has plenty of (keeping food and water for the road), ask for what it needs most.
  const spare = {};
  const keep = { food: road, water: road, meds: 2, ammo: 5 * n, fuel: p.vehicle === true && back ? Math.ceil(back.cost) : 0 };
  for (const k of Object.keys(SUPPLIES)) if (need[k] <= 0.8) spare[k] = Math.max(0, (have[k] || 0) - (keep[k] || 0));
  // Prices move with the amount (trade.js: a big sale pays less a unit, a big buy costs more), so every amount is
  // priced as a whole, the way the trade window totals it; asking at single-unit prices got deals refused.
  let budget = Object.entries(spare).reduce((a, [k, q]) => a + (q > 0 ? q * sellPrice(state, f, k, speech, q) : 0), 0);
  const ask = {};
  const caps = { meds: 10, parts: 6, food: 40, fuel: 20, ammo: 120, scrap: 40, water: 20, wood: 600 }; // wood: 60 kg of firewood
  let askValue = 0;
  // Only what they can spare and the team can carry home (trade.js refuses the whole deal otherwise).
  let room = cargoRoom(state, p);
  for (const k of Object.keys(need).sort((a, b) => need[b] - need[a])) {
    if (need[k] < 1.2 || budget <= 0 || !SUPPLIES[k]) continue;
    const q = maxBuyable(state, f, k, speech, budget, Math.min(caps[k] || 10, Math.floor(room / SUPPLIES[k].weight)));
    if (q <= 0) continue;
    const cost = q * buyPrice(state, f, k, speech, q);
    room -= q * SUPPLIES[k].weight;
    ask[k] = q;
    askValue += cost;
    budget -= cost;
  }
  const offer = {};
  let offerValue = 0;
  for (const k of Object.keys(spare).sort((a, b) => need[a] / demand(state, f, a) - need[b] / demand(state, f, b))) { // what they want most first
    if (offerValue >= askValue) break;
    if (!(spare[k] > 0)) continue;
    let q = minSellable(state, f, k, speech, askValue - offerValue, spare[k]);
    if (!Number.isFinite(q)) q = spare[k];
    offer[k] = q;
    offerValue += q * sellPrice(state, f, k, speech, q);
  }
  let text = "";
  if (askValue > 0 && offerValue >= askValue && p.apEnvoy !== f.id) { // an envoy keeps its goods for the gift
    state.trade.offer = offer;
    state.trade.ask = ask;
    const res = executeTrade(state);
    const list = (o) => Object.entries(o).map(([k, q]) => `${q} ${keyWord(k)}`).join(", ");
    if (/^Traded/.test(res)) {
      g.stats.trades++;
      text = `traded ${list(offer)} for ${list(ask)}`;
    } else text = `no deal (${res})`; // e.g. more than the team can carry
  }
  if (!f.pact) {
    const r = proposePact(state, f, f.goodwill >= 20 ? "trade" : "nonaggression");
    if (/signed/.test(r)) text += `${text ? "; " : ""}${r.toLowerCase().replace(/\.$/, "")}`;
  }
  // An envoy (envoyCandidate) gives what it brought and did not trade as a gift while their goodwill is short.
  if (p.apEnvoy === f.id && f.goodwill < ALLIANCE.GOODWILL + 10 && state.trade) {
    const gift = {};
    for (const k of ["food", "ammo", "meds"]) { const q = Math.floor((p.supplies[k] || 0) - (keep[k] || 0)); if (q > 0) gift[k] = q; }
    if (Object.keys(gift).length) {
      state.trade.offer = gift;
      state.trade.ask = {};
      const r = giftAll(state);
      if (/accepts/.test(r)) text += `${text ? "; " : ""}gave ${Object.entries(gift).map(([k, q]) => `${q} ${keyWord(k)}`).join(", ")} as a gift (goodwill ${Math.round(f.goodwill)})`;
    }
  }
  if (!f.pact && attitude(f) !== "Hostile") {
    const r2 = proposePact(state, f, f.goodwill >= 20 ? "trade" : "nonaggression");
    if (/signed/.test(r2)) text += `${text ? "; " : ""}${r2.toLowerCase().replace(/\.$/, "")}`;
  }
  // The team at their gates counts as contact (alliance.js): a group that qualifies is invited there and then.
  if (!isMember(state, f) && !inviteProblem(state, f)) text += `${text ? "; " : ""}${inviteToAlliance(state, f).replace(/\.$/, "")}`;
  say(state, `Trade visit at ${f.name}: ${text || "nothing worth swapping"}.`);
  endTrade(state);
}

// ======================================================================================
// Bases: roles, buildings, crafting, gear, medicine
// ======================================================================================
// needs-gauges: heating fuel for the winter (upkeep.js heatUse: 0.1 fuel a head a day below 0°C). The fuel a base will
// burn from today to the end of the cold (the share of freezing days by part of the year, about 30 days a year: late
// autumn 13%, winter 92%, early spring 16%; bitter days a little more), with a quarter more to spare. want: the weight
// for needs() (1.9 under half of it, 1.4 under it, 0.7 with it in store: never traded away; from the second half of
// autumn to early spring), 0 otherwise. Fuel runs (heatFuelCands) only under half.
const FREEZE_SHARE = { "autumn-late": 0.13, "winter-early": 0.92, "winter-late": 0.92, "spring-early": 0.16 };
export function heatFuelWant(state, base) {
  if (!base) return { need: 0, want: 0 };
  const today = Math.floor(state.hour / 24);
  let days = 0;
  for (let d = today; d < today + 60; d++) {
    const s = seasonOfDay(d);
    const f = FREEZE_SHARE[`${s.key}-${s.dayOfSeason > 14 ? "late" : "early"}`] || 0;
    if (!f && days > 0) break; // the cold is over (or not begun: keep looking)
    days += f;
  }
  const heads = mouthsAt(state, base).heads + returning(state, base); // teams out come home to it
  // woodcutting.js: the firewood in store covers its share first (HEAT.wood fuel a unit), so the fuel is wanted only
  // for what the wood will not cover; a base that can still cut the rest of its wood before the winter (within the
  // job's cap of woodcutters) makes no fuel runs for heating (the want stays under heatFuelCands' 1.5) until the
  // winter is here.
  const need = Math.ceil(Math.max(0, heads * HEAT.fuel * 1.05 * days * 1.25 - Math.max(0, base.stock.wood || 0) * HEAT.wood));
  const have = base.stock.fuel || 0;
  const s = wxSeason(state);
  const soon = s.key === "winter" || (s.key === "autumn" && s.dayOfSeason > 10) || (s.key === "spring" && s.dayOfSeason <= 14);
  const wn = woodNeed(state, base);
  const cutting = !gov(state).noWood && !woodWorkWhy(state, base) && !wn.cold && woodCuttersFor(state, base, wn) <= woodCrewMax(atBase(state, base.id).length, wn);
  // In the cold months the fuel is never "plenty" (0.7: not traded away) even with the winter's need in store.
  const want = !soon || need <= 0 ? 0 : have < need * 0.5 ? 1.9 : have < need ? 1.4 : 0.7;
  return { need, want: cutting ? Math.min(1.4, want) : want };
}

// The heating fuel a base holds back from cars and the generator in the cold months (what heatFuelWant says the rest
// of the cold will burn, at most what is there).
export const heatHold = (state, base) => { const hw = heatFuelWant(state, base); return hw.want ? Math.min(Math.max(0, base.stock.fuel || 0), hw.need) : 0; };
// The fuel held back from cars and the generator: the winter's heating, and the hive campaign's fires while it waits
// for them (campaignFuelHold: a trip's fires plus the 4 kept back). A hive trip's own car is refuelled past the
// campaign's hold (its fires' fuel is packed as supplies, and the drive is what gets the squad there).
const tripFuelHold = (state, base, c = null) => heatHold(state, base) + (c && c.mission === "hive" ? 0 : campaignFuelHold(state, base));
// Fills a car's tank from the base without touching `keep` of its fuel.
function refuelKeeping(state, base, v, keep) {
  const held = Math.min(Math.max(0, base.stock.fuel || 0), keep);
  base.stock.fuel -= held;
  refuel(state, base, v);
  base.stock.fuel += held;
}
// Fuel runs before and through the winter (planTrip): known sites with fuel in their loot (gas stations, truck stops,
// farms, feed stores …) that still hold something, nearest and richest first, scored above an ordinary scavenging trip
// while the heating fuel is short (heatFuelWant).
function heatFuelCands(state, h, need, P) {
  const hw = heatFuelWant(state, h);
  if (hw.want < 1.5) return [];
  const out = [];
  for (const id of state.grid.within(h.tile, P.range + 6)) {
    const t = state.tiles[id];
    const def = t.loc ? LOCATIONS[t.loc.type] : null;
    if (!def || !def.loot || !(def.loot.fuel > 0) || id === h.tile || !siteKnown(state, id)) continue;
    if (state.parties.some((p) => p.owner === "player" && (p.dest === id || (p.ap && p.ap.tile === id)))) continue;
    const s = siteScore(state, id, need, P);
    if (!s || s.loot < 0.15 || (P.reserves && s.risk > 0.8)) continue;
    const share = def.loot.fuel / Object.values(def.loot).reduce((a, v) => a + v, 0);
    out.push({ mission: "scavenge", tile: id, score: hw.want * (1 + share * 2) * s.loot * Math.max(0.3, 1 - s.risk) / (1 + state.grid.distance(id, h.tile) / 8),
      crew: s.risk > 0.45 || s.hostile ? 3 : P.crew, why: `fuel for the winter's heating (${Math.floor(h.stock.fuel || 0)} of ${hw.need} needed)`, reach: 1.3, known: !!intel(state, id), loot: s.loot });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

// What the hub can pay a trader with and still not want it back: food above 1.5 × foodTarget days a head, ammo above
// 15 a head (or the hive campaign's stockpile). Seed 5068: 80 food for a manual and 73 for ammo left 15 food in autumn
// for four people who needed 308 to reach spring; they starved by day 83.
function tradeSpare(state, h = hub(state)) {
  const heads = Math.max(1, mouthsAt(state, h).heads), n = Math.max(1, atBase(state, h.id).length);
  // A winter outlook that comes up short pays no food at all: foodTarget nets off crops that may only ripen in spring,
  // after the stores run out (seed 5062: short by the outlook, yet 66 food went to a caravan on day 72).
  const short = winterActive(state, h) && winterPlan(state, h).short > 0;
  return { food: short ? 0 : Math.max(0, Math.floor(edibleFood(h) - foodTarget(state, h) * 1.5 * heads)), ammo: Math.max(0, Math.floor((h.stock.ammo || 0) - Math.max(campaignAmmoTarget(state), n * 15))) };
}
// Hub needs per supply, 0 (plenty) .. 3 (urgent). Drives trips, trades and some buildings.
function needs(state, h = hub(state)) { // h: a base leader's own base (stewardSupplies); the hub otherwise
  const st = h.stock;
  const n = Math.max(1, atBase(state, h.id).length);
  const vehicle = state.vehicles.some((v) => isCar(v) && (v.loc.kind === "base" || v.loc.kind === "party"));
  const foodDays = edibleFood(h) / Math.max(1, mouthsAt(state, h).heads); // fresh + preserved (storage.js), a day for everyone fed there (upkeep.js)
  const pick = (v, steps) => { for (const [lim, w] of steps) if (v < lim) return w; return steps[steps.length - 1][1]; };
  const out = {
    food: (() => { const t = foodTarget(state, h); return pick(foodDays, [[Math.min(4, t * 0.3), 3], [t * 0.5, 2], [t, 1.4], [t * 2, 0.6], [Infinity, 0.2]]); })(),
    // Water by days left at the current rate (economy.waterOutlook), or by stock per person.
    // Late spring and summer: wanted too while the stock is under the summer plan's reserve (waterPlan).
    // Purified water (water.js) wanted too while the base cannot purify what it drinks (no boiler lit, too few filters)
    // and its un-purified water carries the worm's eggs (worm.js baseWater): trades ask for purified water.
    // The water filters' share (3 a day each) clogs up within weeks and is made again only from scrap: while the
    // wells, stream and rain alone fall short, the days the stock would last without the filters count too, so a hub
    // that lives on its filters never rates its water as plenty and sells it to a caravan (seed 17: 198 and then 240
    // water traded away by a 40-head hub, leaving 3 days and then 1 day in store as the filters clogged up).
    water: (() => {
      const wo = waterOutlook(state, h); const wp = waterPlan(state, h);
      const d = wo.net >= 0 ? waterIn(st) / n + 10 : wo.daysLeft;
      const steadyNet = wo.net - wo.prod.filters;
      const dSteady = steadyNet >= 0 ? Infinity : waterIn(st) / -steadyNet;
      return Math.max(pick(Math.min(d, dSteady), [[4, 2.5], [8, 1.6], [15, 0.8], [Infinity, 0.2]]), baseWater(state, h).safe ? 0 : 1.4, wp.near && wp.short && waterIn(st) < wp.reserve ? 1.4 : 0);
    })(),
    // Meds: by stock per head, and wanted hard while the sick here need more doses than there are (health.js courses).
    meds: Math.max(pick(st.meds || 0, [[2, 2.5], [n * 0.6, 1.8], [n * 1.5, 1], [Infinity, 0.3]]), medsToTreatAll(state, h) > (st.meds || 0) ? 2.2 : 0),
    scrap: pick(st.scrap || 0, [[20, 2.5], [45, 1.6], [90, 0.9], [Infinity, 0.35]]),
    parts: pick(st.parts || 0, [[2, 2], [6, 1.2], [12, 0.6], [Infinity, 0.2]]),
    // The hive campaign's stockpile (campaignAmmoWant: up to 2.4, under water's and food's 2.5+ when those are short).
    ammo: Math.max(pick(st.ammo || 0, [[n * 6, 2], [n * 15, 0.9], [n * 40, 0.35], [Infinity, 0.1]]), campaignAmmoWant(state)),
    fuel: Math.max(vehicle ? pick(st.fuel || 0, [[12, 1.6], [35, 0.8], [Infinity, 0.2]]) : 0.15, heatFuelWant(state, h).want, campaignFuelWant(state)), // needs-gauges: winter heating; the campaign's fires
    // Empty jars for the preserving kitchen (storage.js), once there is one.
    jars: count(h, "kitchen") ? pick(st.jars || 0, [[4, 1.3], [12, 0.7], [Infinity, 0.1]]) : 0,
    // Firewood (woodcutting.js): bought only when the cold is near or here and the store is low; never sold (0.9).
    wood: (() => { const w = woodNeed(state, h, returning(state, h)); return w.short && (w.cold || w.toCold <= 14 || w.boiler > 0) && w.have < w.need * 0.3 ? 1.6 : 0.9; })(), // the boiler (worm.js) burns it in every season
  };
  return persona(state).reserves ? reserveNeeds(state, h, out) : out;
}
// Cautious: a supply below its reserve target is wanted (1.6, up to 3 when it is gone); one well above it
// (1.5× the target) is surplus to trade. Food stays as the food planner rates it.
function reserveNeeds(state, h, out) {
  const rs = reserveStatus(state, h);
  for (const k of RESERVE_KEYS) {
    const r = rs[k];
    if (!r || !(r.target > 0) || out[k] == null) continue;
    if (r.short) out[k] = Math.max(out[k], 1.6 + 1.4 * Math.max(0, 1 - r.have / r.target));
    else if (r.have >= r.target * 1.5) out[k] = Math.min(out[k], 0.4);
  }
  return out;
}

// ---------- reserves (the Cautious style) ----------
// How much of each supply a base should not drop below, from what the player can see, and what is short. The
// Cautious governor acts as soon as something drops below its target (trips for it, trades, the bench or med
// station, no spending it on extras); the dev panel shows the table in the 🤖 line's tooltip.
// Threat (0..3): a horde in sight within 8 tiles (+1, +1 more if the defences would not hold it), a horde warning
// or the defences manned (+1), a hive or a hive build site known within 12 tiles (+1), two or more horde attacks
// on this base so far (+1).
export function reserveThreat(state, base) {
  const hz = hordeThreat(state, base);
  let t = 0;
  if (hz.size) t += holdCheck(state, base, hz.size, hz.bosses, hz.mix).holds ? 1 : 2;
  const warned = state.hordes.some((h) => h.warned && state.live.has(h.tile) && ((h.goal && h.goal.baseId === base.id) || h.target === base.tile));
  if (warned || (base.hordeAlert && state.hour < base.hordeAlert)) t++;
  if (state.grid.within(base.tile, 12).some((id) => { const k = state.knowledge[id]; return k && (k.hive || k.site); })) t++;
  if ((base.hordeHits || 0) >= 2) t++;
  return Math.min(3, t);
}

// Per supply { have, target, days, short, low, why }: days = how long it lasts at today's rate where that is known
// (food, water, meds), short = below target, low = below half of it. Targets:
//   food   fresh + preserved, the food planner's own target (foodTarget days × the people here, short too while
//          the winter outlook falls short);
//   water  7 days of drinking (10 in summer), at most 90% of what the base can hold; short only while the wells
//          do not keep up on a dry day or under 15 days are left;
//   meds   one treatment for everyone sick now, +1 per infected wound, plus a buffer (a third of the people + 2,
//          a quarter more in autumn and winter, when flu and pneumonia come);
//   ammo   N break-in battles: about 6 a defender (up to 8) plus the 3 a head every horde attack burns, N = 2 +
//          threat (up to 4: hordes near, a warning, a hive near, attacks so far);
//   fuel   a decoy fire (6), the floodlights (4), and 6 for the truck's next trip if there is a truck;
//   scrap  repairs and defences: 20 + 1.5 a head + 10 per threat level (at most 70);
//   parts  3, +2 with a vehicle.
let reserveMemo = { state: null, hour: -1, map: new Map() };
export function reserveStatus(state, base = hub(state)) {
  if (!base) return null;
  if (reserveMemo.state !== state || reserveMemo.hour !== state.hour) reserveMemo = { state, hour: state.hour, map: new Map() };
  const memo = reserveMemo.map.get(base.id);
  if (memo) return memo;
  const st = base.stock;
  const people = atBase(state, base.id);
  const n = Math.max(1, people.length + (base.type === "hub" ? returning(state, base) : 0));
  const threat = reserveThreat(state, base);
  const sk = wxSeason(state).key;
  const cold = sk === "autumn" || sk === "winter";
  const vehicle = base.type === "hub" ? state.vehicles.some((v) => isCar(v) && (v.loc.kind === "base" || v.loc.kind === "party")) : carsAtBase(state, base.id).length > 0;
  const row = (have, target, days, why, short = have < target) => ({ have: Math.floor(have), target: Math.round(target), days: days == null || !Number.isFinite(days) ? null : Math.round(days), short, low: have < target / 2, why });
  const out = { threat };
  // Food (fresh + preserved): the food planner's numbers (foodTarget, the winter outlook), not this table's.
  const fed = mouthsAt(state, base); // upkeep.js: the people here, prisoners, guests, a holding convoy's crew
  const eaters = Math.max(1, fed.heads);
  const fDays = foodTarget(state, base);
  const edible = edibleFood(base);
  const wShort = winterShort(state, base);
  out.food = row(edible, fDays * eaters, edible / eaters, `${Math.round(fDays)} days for ${fed.heads}${fed.heads > fed.residents ? ` (${fed.residents} living here)` : ""} (food planner${wShort > 0 ? ": the winter stores fall short" : ""})`, edible / eaters < fDays || wShort > 0);
  if (SUPPLIES.preserved) out.preserved = row(st.preserved || 0, 0, null, "part of the food above (food planner)", false);
  const wo = waterOutlook(state, base);
  const wp = waterPlan(state, base);
  const wDays = sk === "summer" ? 10 : 7;
  // Late spring and summer: the summer plan's stock (a heat-wave stretch) when that is more (waterPlan).
  const drinkers = n + fed.prisoners + fed.guests + fed.crew; // upkeep.js: everyone who drinks here
  const wTarget = Math.max(Math.min(waterCapacity(base) * 0.9, drinkers * wDays), wp.near ? wp.reserve : 0);
  out.water = row(waterIn(st), wTarget, wo.daysLeft, `${wDays} days of drinking${wp.near && wp.reserve > drinkers * wDays ? `, ${wp.reserve} for the summer's heat waves` : ""} (well ${wo.dryNet >= 0 ? "keeps up" : "falls short"} on a dry day)`,
    (waterIn(st) < wTarget && (wo.dryNet < 0 || (wp.near && wp.sw.heatNet < 0))) || wo.daysLeft < 15);
  const sick = medsToTreatAll(state, base) + people.filter((s) => s.woundInfected).length;
  const buffer = Math.ceil((n / 3 + 2) * (cold ? 1.25 : 1));
  out.meds = row(st.meds || 0, sick + buffer, sick > 0 ? (st.meds || 0) / sick : null, `${sick} to treat now + ${buffer} spare`);
  const fight = 6 * Math.min(8, n) + 3 * n;
  const battles = Math.min(4, 2 + threat);
  out.ammo = row(st.ammo || 0, fight * battles, null, `${battles} break-in battles at about ${fight} each (threat ${threat})`);
  out.ammo.battles = Math.round(((st.ammo || 0) / fight) * 10) / 10;
  const flood = count(base, "floodlights") ? 4 : 0;
  const heat = heatFuelWant(state, base); // needs-gauges: heating through the winter
  const heatFuel = heat.want ? heat.need : 0;
  out.fuel = row(st.fuel || 0, DECOY_FUEL + flood + (vehicle ? 6 : 0) + heatFuel, null, `decoy fire${flood ? ", floodlights" : ""}${vehicle ? ", the truck" : ""}${heatFuel ? `, ${heatFuel} heating for the winter` : ""}`);
  out.scrap = row(st.scrap || 0, Math.min(70, 20 + 1.5 * n + 10 * threat), null, `repairs and defences (threat ${threat})`);
  out.parts = row(st.parts || 0, 3 + (vehicle ? 2 : 0), null, vehicle ? "repairs and the truck" : "repairs");
  reserveMemo.map.set(base.id, out);
  return out;
}
const RESERVE_KEYS = ["water", "meds", "ammo", "fuel", "scrap", "parts"]; // food: the food planner's
// Supplies below target at a base (Cautious only; everyone else: none).
const reserveShort = (state, base = hub(state)) => {
  if (!persona(state).reserves || !base) return [];
  const rs = reserveStatus(state, base);
  return [...RESERVE_KEYS, "food"].filter((k) => rs[k] && rs[k].short);
};
// One line per supply for the dev panel's tooltip.
export function reserveText(state) {
  const rs = reserveStatus(state);
  if (!rs) return "";
  const lines = Object.entries(rs).filter(([, v]) => v && typeof v === "object").map(([k, v]) =>
    `${v.short ? "▼" : "·"} ${k}: ${v.have}${v.target ? ` / ${v.target}` : ""}${v.days != null ? ` (${v.days} d)` : ""}${v.battles != null ? ` (${v.battles} battles)` : ""} — ${v.why}`);
  const P = persona(state);
  return `Reserves at the hub (threat ${rs.threat})${P.reserves ? "" : ` — only the Cautious style acts on them`}:\n${lines.join("\n")}`;
}

// Who is coming back to a base (teams out from it), for beds.
const returning = (state, base) => state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && p.homeBaseId === base.id)
  .reduce((a, p) => a + partyMembers(state, p).length, 0);

// What could hit a base: urgent = a raid that has been spotted or a horde at the door; standing = known hostile
// raiders in reach and hordes in sight. Strength on the same scale as baseDefense.
// Every urgent threat at a base is a horde its walls hold (no raid on the way).
function urgentHolds(state, base) {
  if (state.parties.some((q) => q.kind === "raid" && q.target && q.target.kind === "player" && q.target.baseId === base.id && !q.returning && (q.warned || q.phase === "siege" || state.live.has(partyTile(q))))) return false;
  return state.hordes.filter((x) => state.live.has(x.tile) && state.grid.distance(x.tile, base.tile) <= 2).every((x) => holdCheck(state, base, x.size, x.bosses || 0, x.mix || null).holds);
}
function threatAt(state, base) {
  const g = state.grid;
  let urgent = 0, standing = 0;
  for (const q of state.parties) {
    if (q.kind !== "raid" || !q.target || q.target.kind !== "player" || q.target.baseId !== base.id || q.returning) continue;
    if (q.warned || q.phase === "siege" || state.live.has(partyTile(q))) urgent = Math.max(urgent, q.strength);
  }
  for (const f of state.factions) {
    if (!f.alive || !f.known || !f.bases.length || !(FACTION_TYPES[f.type] && FACTION_TYPES[f.type].raid > 0) || f.goodwill >= -30) continue;
    const d = Math.min(...f.bases.map((b) => g.distance(b, base.tile)));
    if (d <= 20) standing = Math.max(standing, strength(f) * 0.32 * 0.6);
  }
  for (const h of state.hordes) {
    if (!state.live.has(h.tile)) continue;
    const d = g.distance(h.tile, base.tile);
    if (d <= 2) urgent = Math.max(urgent, h.size * 0.14 * 1.1);
    else if (d <= 6) standing = Math.max(standing, h.size * 0.14 * 0.6);
  }
  // Remembered for a day, so guards do not stand down the moment a horde drifts out of sight.
  const mem = gov(state).threat;
  const m = mem[base.id];
  if (standing > 0 && (!m || state.hour >= m.until || standing >= m.standing)) mem[base.id] = { standing, until: state.hour + 24 };
  else if (m && state.hour < m.until) standing = Math.max(standing, m.standing);
  return { urgent, standing };
}

// The area each role belongs to (a steward leaves roles in an area it was not handed alone); rest and scavenge
// are plain Roles. Roles the governor does not plan (teaching, reading: skills.js) are always left as they are.
// teach / read (skills.js planStudy) belong to "roles": without them every reader counted as pinned and kept reading for good.
const ROLE_AREA = { hunt: "food", fish: "food", forage: "food", farm: "food", wood: "production", medic: "medical", guard: "defence", operate: "production", craft: "production", build: "building", rest: "roles", scavenge: "roles", teach: "roles", read: "roles" };

function planRoles(state, base, areas = ALL_AREAS) {
  const people = atBase(state, base.id);
  if (!people.length) return 0;
  const g = gov(state);
  const P = persona(state);
  const free = new Set(people);
  const want = new Map();
  const give = (s, role, station = null) => { want.set(s.id, { role, station }); free.delete(s); };
  // 0. Pinned people (s.pinned, the survivor screen and the base's people list) keep what they do, and so does
  // anyone in a role whose area this base's steward was not handed.
  // People on work priorities (work.js) run themselves: a steward leaves them alone (the dev autopilot only with
  // its test switch governor.priorityRoles; otherwise it sets every role, as before).
  const byPriority = (s) => (!state.autopilot || g.priorityRoles) && isManaged(state, s);
  for (const s of people) if (s.pinned || !areas[ROLE_AREA[s.role]] || byPriority(s)) give(s, s.role, s.role === "operate" ? s.station : null);
  const ranked = (role, score, filter = () => true) => [...free].filter(filter)
    .sort((a, b) => score(b) + (b.role === role ? STICKY : 0) - (score(a) + (a.role === role ? STICKY : 0)));
  const st = base.stock;
  const isHub = base.type === "hub";
  const eaters = people.length;
  const foodDays = edibleFood(base) / Math.max(1, eaters); // fresh + preserved (storage.js)
  const slots = farmSlots(base);
  const fw = farmersWanted(state, base); // farming.js: what the planted and free plots can use

  // 1. Patients in a hospital bed do not work anyway; the worn-out rest before they walk away (up to a third,
  // and only while there is food, unless someone is about to leave).
  for (const s of [...free]) if (s.inBed) give(s, "rest");
  const low = [...free].filter((s) => (s.mood < P.restMood || wantsRest(state, s)) && !s.leader).sort((a, b) => a.mood - b.mood); // wantsRest: low after a rough trip (relations.js)
  low.forEach((s, i) => { if (s.mood < 18 || (i < Math.floor(people.length / 3) && foodDays >= 3)) give(s, "rest"); });

  // 1a. The watch roster (govWatch, watch.js): whoever stands their watch now is on guard before any other work (and
  // counts among the guards posted below). s.govWatch keeps the job they had, for the day's work (watch.js
  // watchDayRoles at midnight).
  if (areas.defence && base.watch) {
    for (const s of [...free]) {
      if (!onWatchNow(state, base, s)) continue;
      if (s.role !== "guard" && !s.govWatch) s.govWatch = { role: s.role, station: s.station ?? null };
      give(s, "guard");
    }
  }
  for (const s of people) if (s.govWatch && (!base.watch || !onWatchNow(state, base, s))) delete s.govWatch;

  // 1b. Water before food: a queued water filter gets its crafter first while the water is running short
  // (thirst kills in days; a hungry base still has its stock), or while the water carries the worm's eggs and
  // nothing boils it (worm.js: a filter makes it safe while it lasts).
  if (areas.production) {
    const fj = craftQueue(base).some(isFilterJob);
    if (fj && (waterRunningShort(state, base) || wormFilterUrgent(state, base))) {
      const c = ranked("craft", (x) => craftSkill(x), (x) => !x.inBed && canAttempt(x, CRAFTS.waterfilter))[0];
      if (c) give(c, "craft");
    }
  }

  // 1c. The worm (worm.js): a water boiler queued at a base drinking un-purified water, or a cook fire at one eating
  // food with eggs uncooked, goes to the front of the queue and gets a builder before the plots and the wild food
  // (while there are two days of food): ten work-hours, and every day without it is a chance of the worm for everyone
  // here. (Huge-map census at 7353bc3, seed 5041: 27 of 33 boilers the autopilot queued were never built, paid for and
  // waiting at two- and three-person outposts whose every hand went to the plots and the wild food; their people
  // caught the worm from the water and the greens and died of it.)
  if (areas.building && base.construction.length && foodDays >= 2) {
    const i = base.construction.findIndex((c) => wormJob(state, base, c.type));
    if (i >= 0) {
      if (i > 0) base.construction.unshift(base.construction.splice(i, 1)[0]); // builders work on the first job (buildings.js constructionHour)
      const c = ranked("build", (x) => skill(x, "mechanics"), (x) => !x.inBed)[0];
      if (c) give(c, "build");
    }
  }

  // 2. Farming (farming.js): crops take days to ripen, and more and better farmers per plot give a bigger
  // harvest. Enough farmers for the plots in use (the "ideal" crew when food is short).
  let farmers = people.filter((s) => byPriority(s) && s.role === "farm").length; // farmers by priorities count too (farmShort)
  const farmTo = (target) => {
    if (!areas.food) return;
    for (const s of ranked("farm", (x) => skill(x, "farming"), (x) => !x.inBed)) {
      if (farmers >= target) break;
      farmers++;
      give(s, "farm");
    }
  };
  // 2a. Wild food (foraging.js): with food down to days a forager or two go out first: the plots take days to ripen,
  // the berries are there now (planForage).
  const foraging = planForage(state, base, people, foodDays, areas);
  if (foraging) for (const s of ranked("forage", foragerMult, foraging.fit).slice(0, foraging.critical)) give(s, "forage");
  if (foodDays < 4) farmTo(fw.ideal);
  // 2b. Food from the land (hunting.js): a hunting cabin's hunters and fishers by the water while food is not
  // plentiful. A hunter at a cabin in good game country brings in several farmers' worth (if it has a weapon), so they
  // go before the comfortable farm crew and the stations. No fixed cap (tune-jobcaps: it was two hunters at 8+ people,
  // else one, and as many fishers): as many as close the food the land must bring in (huntWorkCap / fishWorkHands:
  // the day's eating and the stores refilled, less the plots), up to a fifth of the people ahead of the farm
  // (LAND_AP.share: the governor's order of work, not the job's room; one at a base under 5).
  const landGoal = Math.max(40, foodTarget(state, base) * 1.5);
  // The hunting mix (hunting.js autoHuntMix): quiet with the dead near, bows when the ammo is short, else guns.
  if (areas.food) {
    const mix = autoHuntMix(state, base);
    const was = huntMixOf(base);
    if (mix.traps !== was.traps || mix.bows !== was.bows || mix.guns !== was.guns) {
      setHuntMix(base, mix);
      const why = mix.guns === 100 ? "" : mix.bows === 100 ? " (saving the ammo for the walls)" : mix.traps === 0 ? " (bows: fewer shots)" : " (quieter: the dead are near)";
      if (!huntWorkWhy(state, base)) say(state, `${base.name}'s hunters: ${huntMixText(base)}${why}.`);
    }
  }
  if (areas.food && !gov(state).noHunting && foodDays < landGoal) {
    const ahead = Math.max(1, Math.ceil(people.length * LAND_AP.share));
    if (!huntWorkWhy(state, base)) for (const s of ranked("hunt", (x) => hunterMult(x) * (bestHuntWeapon(x, st.ammo || 0, st.arrows || 0) ? 3 : 0.5), (x) => !x.inBed && !x.leader).slice(0, Math.min(ahead, huntWorkCap(state, base, landGoal)))) give(s, "hunt");
    if (!fishWorkWhy(state, base)) for (const s of ranked("fish", (x) => fisherMult(x), (x) => !x.inBed && !x.leader).slice(0, Math.min(ahead, fishWorkHands(state, base, landGoal)))) give(s, "fish");
  }

  // The winter stores fall short (winterShort): the plots get their tenders before builders, medics and stations,
  // but one hand stays free for a queued build (often the very farm plots and stores the winter needs: with every
  // hand on the plots they were never built).
  if (winterShort(state, base) > 0) farmTo(Math.min(fw.need, people.filter((s) => !s.inBed).length - (areas.building && base.construction.length ? 1 : 0)));

  // 3. Guards for a raid that is on its way or a horde at the door.
  const threat = threatAt(state, base);
  const guards = new Set([...want].filter(([, w]) => w.role === "guard").map(([id]) => id));
  const defense = () => {
    let d = baseWalls(base) * 2;
    const mult = (s) => (guards.has(s.id) || (want.get(s.id) || {}).role === "guard" ? 1.5 : base.alert ? 1.3 : 0.8);
    for (const s of people) d += combatPower(s) * mult(s);
    return d * armedFactor(people, st.ammo || 0, st.arrows || 0, { short: 0.7, weight: mult }); // factions.js baseDefense: the bows' arrows too
  };
  const addGuards = (target, cap) => {
    if (!areas.defence) return;
    for (const s of ranked("guard", (x) => combatPower(x) * 2, (x) => !x.inBed)) {
      if (defense() >= target || guards.size >= cap) break;
      guards.add(s.id);
      give(s, "guard");
    }
  };
  if (threat.urgent) addGuards(threat.urgent * P.guardMargin, Math.ceil(people.length * 0.7));
  // 3a. The watchtower's alarm (defences.js towerWatch: a horde near, or coming, seen from the tower): guards go on the
  // walls now, ahead of the medics, the farm and the stations, as many as a horde at the door would want (people on
  // work priorities move Guard up the same way: work.js watchPromotions), up to half the people.
  else {
    const tw = towerHordes(state, base)[0];
    if (tw) addGuards(tw.size * 0.14 * 1.1 * P.guardMargin, Math.ceil(people.length * 0.5));
  }

  // 4. Medics while anyone here is hurt (each hospital tier needs 1-3 to run).
  const hosp = hospitalDef(base);
  const staffed = people.some((s) => s.role === "medic"); // medics on duty stay until everyone is fully healed
  if (areas.medical && hosp.tier > 0 && people.some((s) => s.woundInfected || (isHurt(s) && s.health < (staffed ? 100 : 95)))) {
    for (const s of ranked("medic", (x) => skill(x, "medicine") - (isHurt(x) ? 6 : 0)).slice(0, hosp.staff)) give(s, "medic");
  }

  // 4a. Firewood (woodcutting.js, planWood): with the cold near and the woodpile under half of what it needs, a
  // woodcutter or two go before the builders and the stations.
  const wood = planWood(state, base, people, areas);
  if (wood) for (const s of ranked("wood", wood.score, wood.fit).slice(0, wood.critical)) give(s, "wood");

  // 4b. Cautious (reserves): while food is not short, the stations that refill a short supply (the ammo bench,
  // the med station: stationWorth) get their operator before the plots take every hand, and standing guards
  // come first while hordes or raiders are near.
  if (P.reserves && foodDays >= Math.max(15, foodTarget(state, base)) && winterShort(state, base) <= 0) {
    for (const station of areas.production ? stations(base) : []) {
      const recipe = BUILDINGS[station.type].station;
      if (recipe === "power" || [...want.values()].some((w) => w.station === station.id) || !stationWorth(state, base, recipe, station)) continue;
      const op = ranked("operate", (x) => skill(x, RECIPES[recipe].skill) + (x.station === station.id ? 3 : 0), (x) => !x.inBed)[0];
      if (op) give(op, "operate", station.id);
    }
    addGuards(Math.max(threat.standing, threat.urgent * P.guardMargin), Math.ceil(people.length * 0.35));
  }

  // 4c. A manual or blueprint in the armory: the best qualified free person studies it (blueprints.js; the Read role).
  if (!threat.urgent && foodDays >= 4) planBlueprintStudy(state, base, free, give);

  // 5. Builders while something is queued: more for big jobs.
  if (areas.building && base.construction.length) {
    const left = base.construction.reduce((a, j) => a + j.hours - j.progress, 0);
    const n = Math.min(3, Math.max(1, Math.ceil(left / 40)), Math.max(1, Math.floor(free.size / 2)));
    for (const s of ranked("build", (x) => skill(x, "mechanics"), (x) => !x.inBed).slice(0, n)) give(s, "build");
  }

  // 6. Farming to the comfortable level. More plots are wanted when every plot is in use and food runs low.
  farmTo(foodDays < Math.max(15, foodTarget(state)) ? fw.ideal : fw.need);
  // Before winter (no outdoor harvests for four weeks) a month's stock is the aim.
  // ...and only while there are hands to tend them (a plot nobody tends gives little).
  g.farmShort[base.id] = fw.active + fw.toSow >= slots && (foodOutlook(state, base).daysLeft < 30 || winterShort(state, base) > 0) && farmers >= slots * 0.45;

  // 7. Workshop stations that are worth running today and whose standing order wants them run (production.js);
  // then generators for what the staffed stations and the other powered buildings would draw (power.js).
  const staffedIds = () => new Set([...want.values()].filter((w) => w.station != null).map((w) => w.station));
  for (const station of areas.production ? stations(base) : []) {
    const recipe = BUILDINGS[station.type].station;
    if (recipe === "power" || !stationWorth(state, base, recipe, station) || staffedIds().has(station.id)) continue; // (4b may have staffed it)
    const key = RECIPES[recipe].skill;
    const op = ranked("operate", (x) => skill(x, key) + (x.station === station.id ? 3 : 0), (x) => !x.inBed)[0];
    if (op) give(op, "operate", station.id);
  }
  if (areas.production) {
    const ids = staffedIds();
    let gens = Math.ceil(powerWanted(state, base, (b) => ids.has(b.id)) / POWER.genOut) - stations(base).filter((x) => BUILDINGS[x.type].station === "power" && ids.has(x.id)).length;
    for (const station of stations(base)) {
      if (gens <= 0) break;
      if (BUILDINGS[station.type].station !== "power" || ids.has(station.id) || !stationWorth(state, base, "power", station)) continue;
      const op = ranked("operate", (x) => skill(x, "mechanics") + (x.station === station.id ? 3 : 0), (x) => !x.inBed)[0];
      if (op) { give(op, "operate", station.id); gens--; }
    }
  }

  // 8. One crafter while the craft queue has a job someone here can do.
  const job = areas.production && craftQueue(base).find((j) => people.some((s) => canAttempt(s, CRAFTS[j.recipe])));
  if (job) {
    const r = CRAFTS[job.recipe];
    const c = ranked("craft", (x) => craftSkill(x), (x) => !x.inBed && canAttempt(x, r))[0]; // the best at Crafting (crafting.js) who may attempt it
    if (c) give(c, "craft");
  }

  // 9. Standing guards: known raiders in reach, hordes in sight, and a lookout at the hub.
  addGuards(Math.max(threat.standing, threat.urgent * P.guardMargin), Math.ceil(people.length * (threat.urgent ? 0.7 : 0.35)));
  if (areas.defence && isHub && people.length >= 4) {
    const need = P.baseGuards - guards.size - (people.length < 7 ? Math.max(0, P.baseGuards - 1) : 0);
    for (const s of ranked("guard", (x) => combatPower(x) * 2, (x) => !x.inBed).slice(0, Math.max(0, need))) { guards.add(s.id); give(s, "guard"); }
  }

  // 10. Everyone else: more hands on the plots while food is not plentiful (bigger harvests), rest when spirits
  // are low; base scavenging rarely finds anything, so only the last few go out to pick around.
  // With food plentiful the teachers and readers have no head cap (skills.js planStudy: the learners and the copies
  // are the limit) and take the hands the firewood leaves (below); before that one or two and a reader per 6, here.
  const plenty = foodDays >= Math.max(40, foodTarget(state) * 1.5);
  if (!plenty) planStudy(state, base, free, give, { foodDays, urgent: !!threat.urgent }); // skills.js: a teacher and readers when food is comfortable
  if (!plenty) farmTo(Math.ceil(fw.ideal * 1.6));
  // ...and while food is short the hands left over forage instead of picking through the ruins (foraging.js).
  if (foraging) {
    const have = [...want.values()].filter((w) => w.role === "forage").length;
    for (const s of ranked("forage", foragerMult, (x) => foraging.fit(x) && x.mood >= 40).slice(0, Math.max(0, foraging.cap - have))) give(s, "forage");
  }
  // ...and from late summer the hands left over cut the winter's firewood until the woodpile holds it (planWood).
  if (wood && wood.stock) {
    const have = [...want.values()].filter((w) => w.role === "wood").length;
    for (const s of ranked("wood", wood.score, (x) => wood.fit(x) && x.mood >= 40).slice(0, Math.max(0, wood.cap - have))) give(s, "wood");
  }
  if (plenty) planStudy(state, base, free, give, { foodDays, urgent: !!threat.urgent, plenty });
  for (const s of [...free]) give(s, s.mood < 40 ? "rest" : "scavenge");

  let changed = 0;
  for (const s of people) {
    const w = want.get(s.id) || { role: "scavenge", station: null };
    if (s.role !== w.role) { s.role = w.role; changed++; }
    if (w.role === "operate") { if (s.station !== w.station) { s.station = w.station; changed++; } }
    else s.station = null;
  }
  if (changed) {
    g.stats.roleChanges += changed;
    assignStations(state, base);
  }
  return changed;
}

// station: the building, when known. Its standing order (production.js; the governor's own from govOrders, or the
// player's) comes first: a station it holds is never staffed, and an until / keep order replaces the stock check.
function stationWorth(state, base, recipe, station = null) {
  if (station && orderHold(state, base, station)) return false;
  const byOrder = !!station && stationOrder(base, station).mode !== "forever";
  const st = base.stock;
  const n = Math.max(1, atBase(state, base.id).length);
  // Cautious: a short supply is made from the scrap there is (down to the last day's worth when it is low).
  if (persona(state).reserves && (recipe === "ammo" || recipe === "meds")) {
    const r = reserveStatus(state, base)[recipe];
    if (r.short && (st.scrap || 0) >= (recipe === "ammo" ? (r.low ? 3 : 10) : (r.low ? 2 : 8)) && (recipe === "ammo" || (st.food || 0) >= n * 6)) return true;
  }
  if (recipe === "ammo") return (byOrder || (st.ammo || 0) < Math.max(n * 15 + 60, campaignAmmoTarget(state, base))) && (st.scrap || 0) >= 30; // the hive campaign's stockpile first
  if (recipe === "meds") return (byOrder || (st.meds || 0) < Math.max(5, n)) && (st.scrap || 0) >= 15 && (st.food || 0) >= n * 6;
  if (recipe === "parts") return (byOrder || (st.parts || 0) < 8) && (st.scrap || 0) >= 45 && atBase(state, base.id).some((s) => skill(s, "mechanics") >= 4);
  if (recipe === "preserve") return preserveWorth(state, base);
  if (recipe === "still") return stillWorth(state, base);
  if (recipe === "power") return (st.fuel || 0) >= fuelFloor(state, base) + POWER.genFuel;
  return false;
}
// Fuel the governor keeps out of the generator: a decoy fire, the floodlights and the truck (Cautious: its reserve).
const fuelFloor = (state, base) => (persona(state).reserves ? reserveStatus(state, base).fuel.target : 10 + (heatFuelWant(state, base).want ? heatFuelWant(state, base).need : 0)) + campaignFuelHold(state, base); // needs-gauges: winter heating first, and the campaign's fires
// The ethanol still (power.js): only the surplus, never while the winter stores fall short.
function stillWorth(state, base) {
  const st = base.stock;
  const n = Math.max(1, atBase(state, base.id).length);
  if (waterIn(st) < n * 2 + RECIPES.still.in.water || waterTight(state, base) || winterShort(state, base) > 0) return false;
  return foodStore(state, base).outside >= 1 || edibleFood(base) / n >= Math.max(30, foodTarget(state, base) * 1.3);
}

// Standing orders for the stations (production.js), so operators are not flipped hour by hour: make ammo, meds
// and parts until the stock target (they start again 10% below it), run the still only on the surplus and the
// generator only above the fuel the base keeps. The player's own orders (by: "player") stand.
function govOrders(state, base) {
  const P = persona(state);
  const n = Math.max(1, atBase(state, base.id).length + returning(state, base));
  const rs = P.reserves ? reserveStatus(state, base) : null;
  for (const station of stations(base)) {
    const cur = stationOrder(base, station);
    if (cur.by === "player") continue;
    const recipe = BUILDINGS[station.type].station;
    let want = null;
    if (recipe === "ammo") want = { mode: "until", n: Math.max(n * 15 + 60, rs ? Math.ceil(rs.ammo.target) + 20 : 0, campaignAmmoTarget(state, base) + 20) }; // the hive campaign's stockpile too
    else if (recipe === "meds") want = { mode: "until", n: Math.max(5, n, rs ? Math.ceil(rs.meds.target) + 2 : 0) };
    else if (recipe === "parts") want = { mode: "until", n: Math.max(8, rs ? Math.ceil(rs.parts.target) + 2 : 0) };
    else if (recipe === "still") want = { mode: "keep", key: "food", n: n * 25 };
    else if (recipe === "power") want = { mode: "keep", key: "fuel", n: Math.ceil(fuelFloor(state, base)) };
    if (!want) continue;
    if (cur.mode === want.mode && (want.key || cur.key) === cur.key && Math.abs(cur.n - want.n) <= Math.max(2, want.n * 0.1)) continue;
    setStationOrder(state, base, station.id, want, "ai");
    const g = gov(state);
    g.stats.orders = (g.stats.orders || 0) + 1;
  }
}
// The preserving kitchen (storage.js): jars fresh food that would otherwise spoil (stored outside, or the summer
// and autumn surplus going into the winter store), never the food eaten in the next two weeks, and only with
// jars, water and a little scrap to spare.
function preserveWorth(state, base) {
  const st = base.stock;
  const n = Math.max(1, atBase(state, base.id).length);
  const r = RECIPES.preserve;
  if ((st.jars || 0) < r.in.jars || waterIn(st) < n * 2 + r.in.water || waterTight(state, base) || (st.scrap || 0) < 4) return false;
  if ((st.food || 0) < n * 14 + r.in.food) return false;
  const store = foodStore(state, base);
  const sk = wxSeason(state).key;
  return store.outside >= 1 || ((sk === "summer" || sk === "autumn") && (st.food || 0) >= Math.min(store.cap * 0.6, n * 25));
}

// Daily: one log line per base when its roles changed since the last one.
function roleSummaries(state) {
  const g = gov(state);
  for (const b of state.bases) {
    const counts = {};
    for (const s of atBase(state, b.id)) counts[s.role] = (counts[s.role] || 0) + 1;
    const text = Object.entries(counts).sort((a, b2) => b2[1] - a[1]).map(([r, n]) => `${n} ${r}`).join(", ");
    if (text && g.roleSummary[b.id] !== text) {
      say(state, `${b.name} roles: ${text}${g.roleSummary[b.id] ? ` (was ${g.roleSummary[b.id]})` : ""}.`);
      g.roleSummary[b.id] = text;
    }
  }
}

// ---------- construction ----------
// The steward area each kind of building belongs to (anything else is plain Building).
const BUILD_AREA = {
  walls: "defence", barricades: "defence", spike_pits: "defence", trench: "defence", gate: "defence", floodlights: "defence", watchtower: "defence",
  infirmary: "medical", field_hosp: "medical", clinic: "medical", hospital: "medical", med_station: "medical",
  huntcabin: "food", farm_plot: "food", greenhouse: "food", cellar: "food", coldstore: "food", storehouse: "food", smoker: "food", kitchen: "food", rain_catcher: "food", well: "food", cistern: "food", water_barrel: "food", crates: "food",
  boiler: "food", cookhouse: "food",
  ammo_bench: "production", machine_shop: "production", still: "production", generator: "production",
  craftbench: "production", workbench: "production", toolbench: "production",
};
function planBuilds(state, base, areas = ALL_AREAS) {
  if (base.construction.length >= (base.type === "hub" ? 2 : 1)) return;
  const g = gov(state);
  for (const w of buildWishes(state, base)) {
    const def = BUILDINGS[w.type];
    if (!def || !areas[BUILD_AREA[w.type] || "building"]) continue;
    const chk = wishCheck(state, base, w); // a new building, or a bunkhouse expanded into a barracks
    if (!chk.ok) {
      if (w.save && /^Needs \d+ scrap/.test(chk.reason)) return; // save up for it rather than spend on less
      continue;
    }
    const cost = wishCost(w);
    // Cautious: anything not urgent is built only from what is above the reserves (reserveStatus).
    const rs = persona(state).reserves && !w.save ? reserveStatus(state, base) : null;
    const reserve = rs ? rs.scrap.target : w.save || base.type !== "hub" ? 0 : 10;
    if ((base.stock.scrap || 0) - (cost.scrap || 0) < reserve) { if (w.save) return; continue; }
    // Anything but a water building leaves the scrap and parts held for water (waterPlan); it does not save up
    // against that hold (the wishes after it, water among them, still get their turn).
    if (!WATER_BUILDS.includes(w.type) && w.type !== "hub_up" && ((base.stock.scrap || 0) - (cost.scrap || 0) < waterHold(state, base) || (cost.parts && (base.stock.parts || 0) - cost.parts < waterHold(state, base, "parts")))) continue;
    if (rs && ["meds", "parts", "fuel"].some((k) => cost[k] && (base.stock[k] || 0) - cost[k] < rs[k].target)) continue;
    if (!w.save && cost.meds && (base.stock.meds || 0) - cost.meds < 2) continue;
    if (!w.save && cost.parts && (base.stock.parts || 0) - cost.parts < 1) continue;
    const msg = wishQueue(state, base, w);
    g.stats.builds++;
    say(state, `${msg.replace(/\.$/, "")}: ${w.why}.`);
    return;
  }
}
// The scrap the next building planBuilds would queue (or saves up for) takes, with the reserve it keeps under it:
// the first wish it can afford, or the first it saves for (a wish it skips for want of scrap it does not wait for).
// Even with the construction queue full: that scrap is spent as soon as a job finishes. 0 when nothing is wanted.
function nextBuildScrap(state, base, areas = ALL_AREAS) {
  for (const w of buildWishes(state, base)) {
    const def = BUILDINGS[w.type];
    if (!def || !areas[BUILD_AREA[w.type] || "building"]) continue;
    const chk = wishCheck(state, base, w);
    const short = !chk.ok && /^Needs \d+ scrap/.test(chk.reason);
    if (!chk.ok && !(short && w.save)) continue;
    const rs = persona(state).reserves && !w.save ? reserveStatus(state, base) : null;
    const reserve = rs ? rs.scrap.target : w.save || base.type !== "hub" ? 0 : 10;
    const need = (wishCost(w).scrap || 0) + reserve;
    if (w.save || (base.stock.scrap || 0) >= need) return need;
  }
  return 0;
}

// Jails (prisoners.js JAIL, buildings.js family "jail"): makeshift cells at the hub once anyone has been taken
// prisoner (or at any base holding some), saved up for when prisoners had to be let go for want of room in the last
// 30 days; holding cells when the cage is full or overflowed; a jailhouse (Mechanics 2) when the cells are full and
// it keeps taking more (overflow lately, or 6+ taken all told).
function jailWishes(state, base, best) {
  if (isShelter(base) && jailTier(base) >= 1) return [];
  if (base.construction.some((c) => BUILDINGS[c.type] && BUILDINGS[c.type].family === "jail")) return [];
  const held = prisonersAt(state, base.id).length;
  const taken = (state.stats && state.stats.prisonersTaken) || 0;
  const recent = state.prisonOverflowDay != null && day(state) - state.prisonOverflowDay <= 30;
  const home = base.type === "hub" || held > 0;
  const full = held >= cellCap(base);
  const jt = jailTier(base);
  const wish = (type, why, save) => [{ type, why, save }];
  if (jt === 0 && home && (taken > 0 || recent)) return wish("lockup", recent ? "no room for the prisoners taken" : "somewhere to keep prisoners", recent);
  if (jt === 1 && home && ((full && held > 0) || recent) && !isShelter(base)) return wish("cells", "the makeshift cells are full", recent);
  if (jt === 2 && home && full && held > 0 && (recent || taken >= 6) && best("mechanics") >= BUILDINGS.jailhouse.req.mechanics) return wish("jailhouse", "the cells are full and more prisoners keep coming", false);
  return [];
}

function buildWishes(state, base) {
  const g = gov(state);
  const out = [];
  const add = (type, why, save = false) => out.push({ type, why, save });
  const here = atBase(state, base.id);
  const people = here.length + returning(state, base);
  const isHub = base.type === "hub";
  const queued = (t) => base.construction.filter((c) => c.type === t && !c.target).length;
  const beds = baseBeds(base) + queuedBeds(base); // bunkhouses and barracks built and queued (buildings.js BEDS)
  const cramped = !isHub && hubCramped(state); // the hub has outgrown its plots: the outposts take the growth
  const threat = threatAt(state, base);
  const st = base.stock;
  const pop = alive(state).length;
  const best = (k) => Math.max(0, ...here.map((s) => skill(s, k)));
  // Water first when it is about to run out (economy.js).
  const wo0 = waterOutlook(state, base);
  if (wo0.net < 0 && wo0.daysLeft < 8 && count(base, "rain_catcher") + base.construction.filter((c) => c.type === "rain_catcher").length < BUILDINGS.rain_catcher.max) add("rain_catcher", "water is about to run out", true);
  // A shelter (buildings.js, tier 0): build it up into a base as soon as the materials are in (a well, walls, every building).
  if (isShelter(base) && !queued("hub_up")) add("hub_up", "build the shelter up into a base (a well, walls, room for everything)", true);
  for (const w of wormWishes(state, base, queued)) out.push(w); // worm.js: a water boiler, a cook fire
  // Beds (nextHousing): a bunkhouse, or a barracks once the building plots run short, or a bunkhouse expanded.
  if (people + (isHub ? 1 : 0) > beds) out.push(...housingWishes(state, base, `${people} people for ${beds} beds`, true));
  // An outpost of a hub that has outgrown its plots gets its beds ahead of the people sent to it (planSupplyRuns).
  else if (!isHub && cramped && !isShelter(base) && people + HOUSING.ahead > beds) out.push(...housingWishes(state, base, "room for people from the crowded hub", true));
  // Water first when it runs short (economy.js): cheap rain catchers, then wells; cisterns once it overflows.
  const wo = waterOutlook(state, base);
  const wDays = wo.net >= 0 ? Infinity : wo.daysLeft;
  if (wo.dryNet < 1 || wDays < 20) {
    if (count(base, "rain_catcher") + queued("rain_catcher") < BUILDINGS.rain_catcher.max) add("rain_catcher", "water is running short", true);
    if (count(base, "well") + queued("well") < BUILDINGS.well.max) add("well", "water is running short", (st.parts || 0) >= 1);
  }
  // The summer ahead (waterPlan, economy.summerWater): what would close the summer gap goes up early, wells and
  // rain catchers first, cisterns so the heat-wave stock fits: in spring and summer, urgent (saved for) in the last
  // weeks of spring and in summer.
  const wp = waterPlan(state, base);
  const sk = wxSeason(state).key;
  for (const f of sk === "spring" || sk === "summer" ? wp.sw.fix : []) {
    if (f.type === "waterfilter" || !BUILDINGS[f.type] || out.some((w) => w.type === f.type)) continue;
    if (BUILDINGS[f.type].max <= countAll(base, f.type) + queued(f.type)) continue;
    add(f.type, `water for the summer (${wp.sw.short > 0 ? `${wp.sw.short} a day short` : `${wp.sw.reserve} to store for the heat waves`})`, wp.near && (f.type !== "well" || (st.parts || 0) >= 1));
  }
  if (waterIn(st) >= waterCapacity(base) * 0.85 && waterCapacity(base) < people * 10 && count(base, "cistern") + queued("cistern") < BUILDINGS.cistern.max) add("cistern", "room to store more water");
  // No building plot for a cistern (buildings.js PLOTS): a water barrel on a utility plot instead.
  if (waterIn(st) >= waterCapacity(base) * 0.85 && waterCapacity(base) < people * 10 && !plotsFree(base, "building") && countAll(base, "water_barrel") + queued("water_barrel") < BUILDINGS.water_barrel.max) add("water_barrel", "room to store more water (no building plot for a cistern)");
  if (g.farmShort[base.id] && count(base, "farm_plot") + queued("farm_plot") < (isHub ? BUILDINGS.farm_plot.max : 3)) add("farm_plot", "the farmers need more plots", true);
  for (const w of foodStoreWishes(state, base, people, queued)) out.push(w);
  // A hunting cabin (hunting.js) where the land around is good game country, before the winter or while food is short.
  if (BUILDINGS.huntcabin && !g.noHunting && !count(base, "huntcabin") && !queued("huntcabin") && here.length >= (isHub ? 6 : 2) && !cabinProblem(state, base) && gameLand(state, base) >= 5 &&
      (st.scrap || 0) >= 30 && (winterShort(state, base) > 0 || (winterActive(state, base) && edibleFood(base) / Math.max(1, here.length) < foodTarget(state, base))) && here.some((s) => bestHuntWeapon(s))) add("huntcabin", "hunt the game land around it for the winter");
  if (isHub && count(base, "greenhouse") + queued("greenhouse") < (pop >= 12 ? 2 : 1) && pop >= 6 && (st.parts || 0) >= 4) add("greenhouse", "something to grow through the winter", wxSeason(state).key === "autumn" || winterShort(state, base) > 0);
  if (!isHub && count(base, "farm_plot") + queued("farm_plot") < 1) add("farm_plot", "an outpost should feed itself", true);
  // An outpost's pantry holds 40 (storage.js): a root cellar once four or more live there and the food fills most of it.
  if (!isHub && here.length >= 4 && (st.food || 0) > storeCapacity(base) * 0.8 && countAll(base, "cellar") + queued("cellar") < 1) add("cellar", "room for the outpost's food");
  if (Math.max(threat.urgent, threat.standing) > baseDefense(state, base) * 0.9) add("walls", "raiders or hordes nearby", true);
  // Hordes (defences.js): walls when a horde in sight would break in, then barricades, spike pits and the rest.
  const hz = hordeThreat(state, base);
  if (hz.size && !holdCheck(state, base, hz.size, hz.bosses, hz.mix).holds && count(base, "walls") + queued("walls") < BUILDINGS.walls.max) add("walls", `a horde of ${hz.size} would break in`, true);
  if (hz.any) for (const w of defenceWishes(state, base, true)) if (!queued(w.type)) out.push(w);
  // A radio relay (radio.js) at any base (the hub too) where one would link to the network and bring a group you
  // know (not hostile) into radio reach: greetings, pacts and the coalition's invitation need it (alliance.js
  // reachVia). radio.js relayReach rules out a base with a station (it adds nothing there) and one the relay would
  // not link from (it used to be wished for anywhere within coverage + 6, where it never linked). Only when it can
  // go up here but for materials (a Mechanics 3+ builder, the Radio Engineering Handbook studied), so the supply
  // runs (planSupplyRuns) do not carry scrap and parts out for a mast nobody can raise.
  if (!count(base, "relay") && !queued("relay") && !base.radio && hasNetwork(state) && best("mechanics") >= (BUILDINGS.relay.req.mechanics || 0) && !buildLock(state, base, "relay")) {
    const gain = relayReach(state, base, state.factions.filter((f) => f.alive && f.known && attitude(f) !== "Hostile"));
    // Saved up for (the wishes after it wait) when radio reach is what keeps one of them out of the coalition.
    const blocked = gain.filter((f) => !isMember(state, f) && /out of radio reach/.test(inviteProblem(state, f)));
    if (gain.length) add("relay", `radio reach to ${gain.map((f) => f.name).join(", ")}${blocked.length ? " for the coalition" : ""}`, blocked.length > 0);
  }
  // Crafting benches (buildings.js BENCH): all but the simple field recipes need one, and crafters work faster and
  // better at one. A crafting bench where someone is on the Craft role or a job is queued, after the essentials above.
  const benchQueued = base.construction.some((c) => BUILDINGS[c.type] && BUILDINGS[c.type].family === "bench");
  if (!benchTier(base, true) && !benchQueued && (here.some((s) => s.role === "craft") || craftQueue(base).length > 0)) add("craftbench", "a bench for the crafters (faster, better gear; most recipes need one)");
  for (const w of jailWishes(state, base, best)) out.push(w);
  if (!isHub) return out;
  const hostileNear = state.factions.some((f) => f.alive && f.known && attitude(f) === "Hostile" && f.bases.some((b) => state.grid.distance(b, base.tile) <= 20));
  if (!base.watchtower && (hostileNear || state.hordes.some((h) => state.live.has(h.tile)))) add("watchtower", "earlier warning of raids and hordes");
  const next = nextHospitalType(base);
  if (next === "infirmary" && pop >= 5) add("infirmary", "somewhere to treat the injured");
  if (next === "field_hosp" && pop >= 8 && (st.parts || 0) >= 3 && (st.meds || 0) >= 8) add("field_hosp", "more beds and no infected wounds");
  if (next === "clinic" && pop >= 11 && (st.parts || 0) >= 6 && (st.meds || 0) >= 12) add("clinic", "surgery and cleaned wounds");
  if (next === "hospital" && pop >= 16 && (st.parts || 0) >= 10 && (st.meds || 0) >= 16) add("hospital", "a proper trauma hospital");
  // Ammo from scrap: an ammo bench needs a workbench here (it opens the workshop recipes too), so the crafting bench
  // goes up and is upgraded first. Saved for while the ammo is below what would set the ammo bench to work
  // (stationWorth: 15 a head + 60, or the hive campaign's stockpile); the hub used to start with an ammo bench.
  if (!countAll(base, "ammo_bench") && !queued("ammo_bench")) {
    const ammoLow = (st.ammo || 0) < Math.max(here.length * 15 + 60, campaignAmmoTarget(state, base));
    const bt = benchTier(base, true);
    if (!bt && !benchQueued) add("craftbench", "a crafting bench, the first step to an ammo bench", ammoLow);
    else if (bt === 1 && !benchQueued && best("mechanics") >= BUILDINGS.workbench.req.mechanics) add("workbench", "a workbench: workshop recipes, and an ammo bench needs one", ammoLow);
    else if (bt >= 2) add("ammo_bench", "ammo from scrap", ammoLow);
  }
  if (!count(base, "med_station") && pop >= 6 && best("medicine") >= 3 && (st.meds || 0) < pop) add("med_station", "meds are short");
  if (!count(base, "storehouse") && (hostileNear || state.stats.raidsRepelled > 0)) add("storehouse", "raiders steal less");
  if (!count(base, "machine_shop") && pop >= 7 && (st.parts || 0) < 6 && best("mechanics") >= 4) add("machine_shop", "spare parts");
  // Mood (relations.js): a common room once the hub is a real community and spirits are not sky high (saved up for
  // when they sag below 75), or as planned comfort for a big hub: at 12+ people once there is scrap for it, saved up
  // for at 15+. A hub with only beds and food settles in the 70s-80s; comfort is what takes it near 100.
  if (BUILDINGS.common_room && count(base, "common_room") + queued("common_room") < (here.length > 15 ? 2 : 1)) {
    const avgMood = here.reduce((a, s) => a + s.mood, 0) / Math.max(1, here.length);
    const none = !count(base, "common_room") && !queued("common_room");
    if (pop >= 8 && avgMood < 75) add("common_room", "spirits are low (mood)", none);
    else if (pop >= 8 && (st.scrap || 0) >= 35 && avgMood < 85) add("common_room", "somewhere to unwind (mood)");
    else if (none && here.length >= 15) add("common_room", "somewhere to unwind for a big hub", true);
    else if (none && here.length >= 12 && (st.scrap || 0) >= 35) add("common_room", "somewhere to unwind for a growing hub");
  }
  // Power (power.js): a still for the surplus once the hub is big enough, then a generator for what it powers.
  if (!count(base, "still") && !queued("still") && pop >= 9 && (st.parts || 0) >= 4 && stillWorth(state, base)) add("still", "turn the surplus food into fuel");
  if (count(base, "generator") + queued("generator") < 1 && pop >= 10 && (count(base, "still") || (st.fuel || 0) >= 40) && (count(base, "machine_shop") || count(base, "coldstore")) && (st.parts || 0) >= 8 && best("mechanics") >= 3) add("generator", "power for the machine shop and the cold store");
  if (!base.radio && pop >= 8 && (st.parts || 0) >= 9 && best("mechanics") >= 4) add("radio", "live contact with teams out in the field");
  // The coalition is made on the radio (greetings, pacts, invitations: alliance.js): from a dozen people with a
  // Mechanics 4 builder, the station is built once the parts are there (not saved up for: scrap goes to walls first).
  else if (!base.radio && pop >= 12 && day(state) >= 60 && (st.parts || 0) >= BUILDINGS.radio.cost.parts && best("mechanics") >= 4 && state.factions.some((f) => f.alive && f.known && !isMember(state, f))) add("radio", "radio contact with the groups for the coalition");
  if (!count(base, "garage") && carsAtBase(state, base.id).length && (st.parts || 0) >= 5) add("garage", "cheaper vehicle repairs");
  // Room for newcomers once the scrap is there (the housing's cost and HOUSING.scrapAhead more: 45 for a bunkhouse).
  if (people + 2 > beds) for (const w of housingWishes(state, base, "room for newcomers", false)) if ((st.scrap || 0) >= (wishCost(w).scrap || 0) + HOUSING.scrapAhead) { out.push(w); break; }
  if (count(base, "walls") < 2 && (st.scrap || 0) >= 70) add("walls", "stronger defense");
  // Cautious (reserves): a med station as soon as meds run short (the surest source), and a radio station once
  // there are parts for it: scanning finds the groups in reach, and radio deals bring what runs short without a
  // trip (reserveRadio).
  if (persona(state).reserves) {
    const rs = reserveStatus(state, base);
    if (!count(base, "med_station") && pop >= 5 && rs.meds.short) add("med_station", "meds are below the reserve", true);
    if (!base.radio && (st.parts || 0) >= 6 + rs.parts.target && best("mechanics") >= 4) add("radio", "radio deals for what runs short", true);
    // Hordes are a known danger here: a second wall tier (each holds back 54 more of a horde, a Wallbreaker's 60%).
    if (rs.threat >= 1 && count(base, "walls") + queued("walls") < 2) add("walls", "hordes are near: a stronger wall", true);
  }
  return out;
}

// The worm (worm.js): a water boiler as soon as the base drinks un-purified water (any of it can carry the worm; saved for unless a water filter
// covers it for now, or the land around gives too little firewood to keep it burning: then filters are the plan,
// planCrafts, and the boiler waits its turn), and a cook fire once game, crops or forage with eggs come in, or
// hunters, fishers, farmers and foragers work infected land.
function wormWishes(state, base, queued) {
  const out = [];
  if (isShelter(base)) return out; // its fire boils and cooks
  const w = baseWater(state, base);
  if (w.drawn && !count(base, "boiler") && !queued("boiler")) {
    const filter = baseFilter(state, base) && w.safe; // the filters purify the day's drinking (worm.js PURIFY_FILTER each)
    const woodShort = boilerWoodShort(state, base);
    const sick = residents(state, base.id).some(wormSeen);
    // Little firewood around: the boiler would burn the winter's wood for nothing, so filters are the plan (planCrafts)
    // until someone here has caught it.
    if (!woodShort || sick) out.push({ type: "boiler", why: `un-purified water can carry the worm${w.raw > 0 ? " (and the ground here is infected)" : ""}${filter ? " (the filters cover it while they last)" : ""}`, save: !filter || sick });
  }
  const working = atBase(state, base.id).some((s) => s.role === "hunt" || s.role === "fish") || count(base, "huntcabin") > 0;
  const landBad = state.grid.within(base.tile, 2).some((id) => (state.tiles[id].infection || 0) >= WORM.MEAT_AT);
  const growing = atBase(state, base.id).some((s) => s.role === "farm" || s.role === "forage");
  const cropBad = cropLandBad(state, base.tile) || state.grid.within(base.tile, 2).some((id) => cropLandBad(state, id));
  if (!baseCooks(base) && !queued("cookhouse") && (wormMeatAt(base) > 0 || base.rawWarned || (working && landBad))) out.push({ type: "cookhouse", why: "game from infected land has to be cooked through (the worm)", save: true });
  else if (!baseCooks(base) && !queued("cookhouse") && (wormVegAt(base).all > 0 || base.rawVegWarned || (growing && cropBad))) out.push({ type: "cookhouse", why: "crops and forage from infected ground have to be boiled (the worm)", save: true });
  return out;
}
// A queued job that keeps the worm out (planRoles 1c): the water boiler while the base drinks un-purified water, a
// cook fire while it eats game, crops or forage with eggs uncooked.
function wormJob(state, base, type) {
  if (type === "boiler") return !count(base, "boiler") && !baseWater(state, base).safe;
  if (type === "cookhouse") return !baseCooks(base) && (wormMeatAt(base) > 0 || wormVegAt(base).all > 0 || !!base.rawWarned || !!base.rawVegWarned);
  return false;
}
// The water carries the worm's eggs and nothing boils it today (no boiler, a cold one, or one the land cannot feed):
// a queued water filter is crafted before anything else.
export function wormFilterUrgent(state, base) {
  const ww = baseWater(state, base);
  return ww.drawn && (!ww.safe || boilerWoodShort(state, base));
}
// The land around a base gives less firewood a day (one woodcutter, woodcutting.js) than its boiler would burn, and the
// pile is short of what the base wants (the winter's wood and the boiler's days, woodNeed): the boiler would eat the
// winter's heating, so a water filter (4 scrap, 3 water a day, safe water while it lasts) is the better buy.
function boilerWoodShort(state, base) {
  const need = mouthsAt(state, base).heads * WORM.BOILER_WOOD_HEAD;
  return need > 0 && baseWoodDay(state, base) < need && woodNeed(state, base).short;
}

// Food storage and preserving (storage.js), before it is needed: room for the winter stock (the fresh food now
// and what the fields still bring in, from mid-summer), a cold store before winter, a drying rack and a
// preserving kitchen for the summer surplus. Food already stored outside makes the next store urgent.
function foodStoreWishes(state, base, people, queued) {
  const out = [];
  if (base.type !== "hub") return out;
  const st = base.stock;
  const add = (type, why, save = false) => out.push({ type, why, save });
  const can = (t) => count(base, t) + queued(t) < BUILDINGS[t].max;
  const cap = storeCapacity(base) + queued("cellar") * 200 + queued("storehouse") * 150 + queued("coldstore") * 150;
  const fresh = st.food || 0;
  const s = wxSeason(state);
  const coming = winterActive(state, base) ? winterPlan(state, base).crops : 0;
  const outside = fresh > cap;
  if (outside || fresh + coming * 0.7 > cap * 0.9) {
    const why = outside ? `${Math.floor(fresh - cap)} food is stored outside and spoiling fast` : `room for the winter stock (${Math.floor(fresh)} in store, about ${Math.floor(coming)} still to come, room for ${cap})`;
    if (can("cellar")) add("cellar", why, outside);
    else if (s.key !== "summer" && can("coldstore")) add("coldstore", why, outside);
    else if (can("storehouse")) add("storehouse", why, outside);
  }
  if (can("smoker") && !count(base, "smoker") && people >= 4 && (outside || ((s.key === "summer" || s.key === "autumn") && fresh >= people * 20))) add("smoker", "dry the surplus for the winter");
  if (can("kitchen") && !count(base, "kitchen") && people >= 5 && (st.jars || 0) >= 8 && (st.parts || 0) >= 2 && (outside || (winterActive(state, base) && fresh >= people * 20))) add("kitchen", "jar the surplus for the winter");
  return out;
}

// ---------- crafting ----------
// Water filters a base wants (waterPlan): what its wells, streams and rain catchers would leave short in summer
// (a heat wave: everyone drinking 1.6, wells at 60%; economy.summerWater) or on a dry day now, 3 a filter, up to
// FILTER_CAP: a big base outgrows its wells, and thirst kills faster than hunger. planCrafts queues them ahead of
// everything else, and keeps making them as they clog up.
const filtersWanted = (state, base) => waterPlan(state, base).filters;
const slotOf = (key) => (GEAR[key] ? GEAR[key].slot : null);
// People here work by priorities (work.js), the craft queue among their work: the player's bases with a steward, or
// the dev autopilot with its test switch governor.priorityRoles.
const byPriorityHere = (state, base) => (!state.autopilot || gov(state).priorityRoles) && atBase(state, base.id).some((s) => isManaged(state, s));
// The scrap the next building takes, kept back from crafts that can wait (scrap-hold): the governor's own roles staff a
// crafter only with hands to spare (planRoles step 8), so its queue fills with jobs waiting for them and it queues no
// more; on work priorities a queued job always keeps a hand (work.js planBase), the queue empties within hours and is
// refilled from the scrap the builds wanted. Over worktest's 10 seeds × 8 rolls priorities spent 4465 scrap on crafts
// to the governor's 2701 (filters made for the summer clog up in the armory, so more of them are made) and finished
// 2571 buildings to its 2711; with this hold 3968 and 2664, food unchanged. A water filter while the water runs short,
// a weapon for the unarmed and dressings for short meds still go first.
const buildKeep = (state, base) => (byPriorityHere(state, base) ? nextBuildScrap(state, base) : 0);
export function planCrafts(state, base) {
  const q = craftQueue(base);
  const people = atBase(state, base.id);
  if (!people.length || q.length >= 4) return;
  const st = base.stock;
  const n = people.length;
  // Water first: a filter for the summer and dry spells goes in ahead of everything else (and past a full queue of
  // three), leaving the scrap to jury-rig a broken well or pump (waterPlan); on priorities, unless the water is running
  // short now, the next building's scrap too (buildKeep).
  const fw0 = filtersWanted(state, base);
  const f0 = [...base.armory, ...people.map((s) => s.gear.tool)].filter((it) => it && it.key === "waterfilter").length + q.filter(isFilterJob).length;
  const fKeep = f0 < fw0 && !waterRunningShort(state, base) ? buildKeep(state, base) : 0;
  const fr = filterRecipe(base); // tune-jobcaps: a clogged filter kept here is re-packed for 1 scrap first
  if (f0 < fw0 && (st.scrap || 0) - fKeep >= CRAFTS[fr].in.scrap + waterPlan(state, base).brokenWater && canCraft(state, base, fr).ok) {
    queueCraft(state, base, fr);
    gov(state).stats.crafts++;
    say(state, `Queued ${fr === "waterfilter" ? GEAR.waterfilter.name : "a clogged water filter re-packed"} at ${base.name}: water for the summer and dry spells (${f0 + 1} of ${fw0} filters).`);
    return;
  }
  if (q.length >= 3) return;
  const inQueue = (slot) => q.filter((j) => CRAFTS[j.recipe].gear && slotOf(CRAFTS[j.recipe].gear) === slot).length;
  const inArmory = (slot) => base.armory.filter((it) => slotOf(it.key) === slot).length;
  const lacking = (slot) => people.filter((s) => !s.gear[slot] || (slot === "weapon" && !gearEffect(s, s.gear.weapon).usable)).length - inArmory(slot) - inQueue(slot);
  // Cautious: past the essentials (a weapon, dressings, a water filter) gear is made only from scrap above the reserve.
  const rs = persona(state).reserves ? reserveStatus(state, base) : null;
  let floor = 0, keep = 0;
  const tryCraft = (keys, why, minScrap) => {
    for (const k of keys) {
      const r = CRAFTS[k];
      if (!r || (st.scrap || 0) - (r.in.scrap || 0) - keep < Math.max(minScrap, floor, CRAFTS[k].gear === "waterfilter" ? 0 : waterHold(state, base))) continue; // leaves the scrap held for water (and for the next building: keep)
      if (r.in.parts && (st.parts || 0) - r.in.parts < 2) continue;
      if (r.in.meds && (st.meds || 0) - r.in.meds < 3) continue;
      if (r.in.water && waterIn(st) - r.in.water < 15) continue;
      if (!canCraft(state, base, k).ok) continue;
      queueCraft(state, base, k);
      gov(state).stats.crafts++;
      say(state, `Queued ${CRAFTS[k].name || GEAR[r.gear].name} at ${base.name}: ${why}.`);
      return true;
    }
    return false;
  };
  if (lacking("weapon") > 0 && tryCraft(["springmachete", "pulleybow", "crossbow", "sawmachete", "spikedbat", "pipespear"], "someone has no usable weapon", 5)) return; // the special ones first once a craft book or blueprint has opened them (blueprints.js)
  // Arrows: the bows and crossbows shoot them in every fight (and hunt with them): under half a dozen a bow, before
  // anything else (a bow with none fights with its fists; about half the arrows shot are picked up again after a win).
  const bows = people.filter((s) => hasBow([s])).length;
  const arrowsQueued = q.filter((j) => j.recipe === "arrows").length * CRAFTS.arrows.supplies.arrows;
  if (bows && (st.arrows || 0) + arrowsQueued < 6 * bows && (st.wood || 0) >= 100 && tryCraft(["arrows"], "arrows: a bow with none fights with its fists", 5)) return;
  if (((st.meds || 0) < Math.max(3, n / 2) || (rs && rs.meds.short)) && tryCraft(["dressings"], "meds are short", 5)) return;
  const filters = [...base.armory, ...people.map((s) => s.gear.tool)].filter((it) => it && it.key === "waterfilter").length + q.filter(isFilterJob).length;
  if (rs && rs.water.short && filters < (base.type === "hub" ? 2 : 1) && tryCraft([filterRecipe(base)], "water is below the reserve", 4)) return;
  // The worm (worm.js): water with eggs and no boiler burning (none built, or nothing to burn, or the land gives too
  // little firewood for one): a filter makes it safe while it lasts, and a second is kept against the first clogging.
  if (wormFilterUrgent(state, base) && filters < 2 && tryCraft([filterRecipe(base)], baseWater(state, base).safe ? "un-purified water can carry the worm and the boiler's firewood is short" : "un-purified water can carry the worm and nothing boils it", 4)) { q.unshift(q.pop()); return; } // to the front of the queue
  // Dewormers (worm.js): the sure cure in the worm's first days, kept on hand (two at a hub, one at an outpost).
  const dewormers = baseDewormers(state, base) + q.filter((j) => j.recipe === "dewormer").length;
  if (dewormers < (base.type === "hub" ? 2 : 1) && (st.meds || 0) >= 8 && tryCraft(["dewormer"], "a dewormer on hand: the worm kills within a week", 4)) return;
  if (filters < 1 && tryCraft([filterRecipe(base)], "clean water: a filter purifies 10 a day against the worm and an upset stomach (worm.js)", 8)) return;
  if (rs) floor = rs.scrap.target;
  keep = buildKeep(state, base); // on priorities: the rest only from scrap past the next building's (and the floors)
  if (lacking("armor") > 0 && tryCraft(["scrapvest", "tirevest"], "someone has no body armor", 35)) return;
  if (lacking("head") > 0 && tryCraft(["rivethelmet"], "someone has no helmet", 40)) return; // only once Backyard Blacksmithing is read (blueprints.js)
  if (waterIn(st) < n * 6 && filters < (base.type === "hub" ? 2 : 1) && tryCraft([filterRecipe(base)], "the well cannot keep up (and purified water means less of the worm)", 15)) return;
  // A base by the water with nothing to fish with (hunting.js): a makeshift rod, so the Fish job can be worked.
  if (fishWorkWhy(state, base) === "no fishing rod, net or spear here" && !q.some((j) => j.recipe === "makeshiftrod") && tryCraft(["makeshiftrod"], "a rod for fishing the water by the base: food from the land", 12)) return;
  const scav = people.filter((s) => s.role === "scavenge");
  if (scav.length >= 2 && !scav.some((s) => s.gear.tool) && !base.armory.some((it) => it.key === "crowbar") && tryCraft(["crowbar"], "better base scavenging", 45)) return;
  if (lacking("backpack") > n - 2 && tryCraft(["backpack"], "packs: more to carry on trips", 55)) return;
  // Arrows for the bows' fights and hunting (hunting.js: about half the arrows shot at game are lost): a dozen a bow
  // to pack (world.js ARROWS.PACK), a dozen more for the walls, from firewood the winter can spare.
  if (bows && (st.arrows || 0) + arrowsQueued < ARROWS.PACK * (bows + 1) && (st.wood || 0) >= 150 && tryCraft(["arrows"], "arrows: the bows shoot them in fights and on hunts", 30)) return;
  // Field kit (kit.js packs it for trips): quiet boots and a ghillie wrap against Heat, Molotovs for the walls.
  const have = (k) => base.armory.filter((it) => it.key === k).length + q.filter((j) => CRAFTS[j.recipe].gear === k).length;
  if (have("ragboots") < 2 && tryCraft(["ragboots"], "rag-wrapped boots: less Heat on searches", 50)) return;
  if (have("ghillie") + have("woodghillie") < 1 && tryCraft(["woodghillie", "ghillie"], "a ghillie wrap: less Heat in camp and on searches", 60)) return; // the woodland suit once the Bushcraft Field Guide is read
  if ((st.fuel || 0) >= 20 && base.armory.some((it) => it.key === "bottle") && have("molotov") < 3 && hordeThreat(state, base).any && tryCraft(["molotov"], "Molotovs for when the dead come", 0)) return;
  if (lacking("arms") > 0 && tryCraft(["padding"], "cheap arm guards", 65)) return;
  if (lacking("legs") > 0) tryCraft(["shinguards"], "cheap shin guards", 65);
}

// ---------- gear from the armory ----------
export function itemScore(s, item) { // also the roster's Equip best available (sim/bulk.js)
  if (!item || !GEAR[item.key]) return 0;
  const d = GEAR[item.key];
  if (d.slot === "weapon") {
    const eff = gearEffect(s, item);
    return eff.usable ? 0.5 + d.power * eff.mult * (item.quality || 1) : -1;
  }
  if (d.slot === "backpack") return d.carry || 0;
  return d.power || 0;
}

function equipFromArmory(state, base) {
  if (!base.armory.length) return;
  openCasesIn(base.armory, base.stock); // gunsafes.js: gun cases brought home are opened (free), their guns join the armory
  const people = atBase(state, base.id).filter((s) => !s.pinned).sort((a, b) => combatPower(b) - combatPower(a)); // pinned people keep their kit too
  if (!people.length) return;
  const handed = [];
  for (const slot of ["weapon", "armor", "head", "arms", "legs", "backpack"]) {
    for (const s of people) {
      ensureInv(s);
      const items = base.armory.filter((it) => slotOf(it.key) === slot);
      if (!items.length) break;
      const best = items.sort((a, b) => itemScore(s, b) - itemScore(s, a))[0];
      if (itemScore(s, best) < itemScore(s, s.gear[slot]) + (s.gear[slot] ? 0.3 : 0.05)) continue; // only real upgrades
      base.armory.splice(base.armory.indexOf(best), 1);
      if (s.gear[slot]) base.armory.push(s.gear[slot]);
      s.gear[slot] = best;
      handed.push(`${first(s)} ${best.name}`);
    }
  }
  // Loose gun attachments to the guns in hand, the best fighters first (gunmods.js: one a mount, only what helps).
  for (const x of fitFromPool(base.armory, people.map((s) => s.gear.weapon))) handed.push(`${x.mod.name} on ${x.gun.name}`);
  // Tools for the off hand: a crowbar to a scavenger, a med kit to a medic (else the best Medicine), anything
  // else to whoever has the skill for it. Water filters work from the armory and stay there.
  for (const item of [...base.armory]) {
    const d = GEAR[item.key];
    if (!d || d.slot !== "tool" || d.water) continue;
    const forScav = !!(d.bonus && d.bonus.scavenging);
    const free = people.filter((s) => !s.gear.tool && (!d.skill || gearEffect(s, item).usable) && (!forScav || s.role === "scavenge"));
    if (!free.length) continue;
    const want = forScav ? (s) => skill(s, "scavenging") : d.medKit ? (s) => (s.role === "medic" ? 20 : 0) + skill(s, "medicine") : (s) => (d.skill ? skill(s, d.skill) : 0);
    const s = free.sort((a, b) => want(b) - want(a))[0];
    base.armory.splice(base.armory.indexOf(item), 1);
    s.gear.tool = item;
    handed.push(`${first(s)} ${item.name}`);
  }
  if (handed.length) {
    gov(state).stats.equipped += handed.length;
    say(state, `Gear handed out at ${base.name}: ${handed.join(", ")}.`);
  }
}

// ---------- medicine ----------
function planTreatment(state, base) {
  const g = gov(state);
  const people = atBase(state, base.id);
  // Guests sheltering here (visitors.js): the night's care treats their worm too (worm.js "Treat prisoners and guests
  // too"): a cured guest is goodwill, a guest who turns is one of the dead among your people.
  if (!base.wormCareOthers && (state.visitors || []).some((v) => v.phase === "sheltered" && v.shelterBase === base.id)) {
    base.wormCareOthers = true;
    say(state, `${base.name}: the night's care treats the worm in prisoners and guests too (guests are sheltering here).`);
  }
  const hurt = people.filter((s) => s.woundInfected || s.health < 50)
    .sort((a, b) => careNeed(b) - careNeed(a)); // worst off first (medical.careNeed, the same order as beds and night care)
  for (const s of hurt) {
    if (g.treated[s.id] != null && state.hour - g.treated[s.id] < 12) continue;
    const info = treatAtBaseInfo(state, base, s);
    if (!info.ok) continue;
    const reserve = s.woundInfected || s.health < 30 ? 0 : Math.ceil(people.length / 4) + 1;
    if ((base.stock.meds || 0) - info.cost < reserve) continue;
    const msg = treatAtBase(state, base, s.id);
    g.treated[s.id] = state.hour;
    g.stats.treated++;
    say(state, msg, "good");
  }
  // Illness and work injuries (health.js): anything that can kill at once, the rest while meds allow.
  const reserve = Math.ceil(people.length / 4) + 1;
  base.medsReserve = reserve; // the base's own daily treatment keeps this many back too
  // A dose a day per illness (a course of 1-3 doses, health.js): courses once started are finished first, then
  // whatever can kill, then the rest from severity 35 while the reserve allows.
  const sick = [];
  for (const s of people) for (const c of conditionsOf(s)) if (autoWantsCondition(c)) sick.push({ s, c, d: CONDITIONS[c.key] });
  sick.sort((a, b) => (b.c.course != null) - (a.c.course != null) || b.d.hp * b.c.sev - a.d.hp * a.c.sev || b.c.sev - a.c.sev);
  for (const { s, c, d } of sick) {
    const urgent = c.course != null || c.key === "pneumonia" || d.hp * c.sev / 100 >= 5 || (c.key === "cut" && !s.woundInfected);
    if (!urgent && c.sev < 35) continue;
    const info = treatConditionInfo(state, base, s, c.key);
    if (!info.ok || (base.stock.meds || 0) - info.cost < (urgent ? 0 : reserve)) continue;
    say(state, treatCondition(state, base, s.id, c.key), "good");
    g.stats.treated++;
  }
}

// ======================================================================================
// Daily trips
// ======================================================================================
// What the player knows about a tile right now (live view or the last report), or null.
const intel = (state, id) => state.knowledge[id] || null;

// Tiles the player knows to hold another group's base: seen there (in view or in the last report), or the main
// base of a group you know (the Groups tab shows where that is). Never the real list of bases: the governor
// plays with the same knowledge as you.
let knownBasesMemo = { state: null, hour: -1, map: null };
function knownGroupBases(state) {
  if (knownBasesMemo.state === state && knownBasesMemo.hour === state.hour) return knownBasesMemo.map;
  const map = new Map();
  for (const f of state.factions) if (f.alive && f.known && f.bases.length) map.set(f.bases[0], f);
  for (let id = 0; id < state.knowledge.length; id++) {
    const k = state.knowledge[id];
    if (!k || k.factionBase == null) continue;
    const f = factionById(state, k.factionBase);
    if (f && f.alive) map.set(id, f);
  }
  knownBasesMemo = { state, hour: state.hour, map };
  return map;
}

// The area is picked over: fewer than EMPTY_SITES sites within the style's range believed to hold 30%+ loot.
export const EMPTY_SITES = 3, EMPTY_RING = 8, EMPTY_REACH = 1.6;

// Value of scavenging a site for what the hub needs, from what the player knows. null = do not go.
function siteScore(state, id, need, P) {
  const t = state.tiles[id];
  if (!t || t.terrain === "water" || state.bases.some((b) => b.tile === id)) return null;
  if (t.loc && !siteKnown(state, id)) return null; // a hidden site nobody has found yet (discovery.js)
  const k = intel(state, id);
  if (k && k.factionBase) return null;
  if (knownGroupBases(state).has(id)) return null;
  const owner = k && typeof k.owner === "number" ? factionById(state, k.owner) : null;
  const hostile = owner && owner.alive && attitude(owner) === "Hostile";
  if (hostile && !P.raid) return null;
  if (k && k.hordeSize > 0 && state.hour - k.hour < 72) return null;
  if (state.grid.neighbors(id).some((n) => { const s = intel(state, n); return s && s.hordeSize > 20 && state.hour - s.hour < 48; })) return null;
  const def = t.loc ? LOCATIONS[t.loc.type] : null;
  const memo = gov(state).visited[id];
  const kHour = k ? Math.max(k.hour, k.lootHour || 0) : -1; // radio news of a stripped site (aiscav.js) counts as a newer look
  let loot = memo && (!k || kHour <= memo.hour) ? memo.loot : k ? k.loot : def ? (def.richness || 0.5) * 0.9 : 0;
  if (memo && day(state) - memo.day < 6) loot *= 0.6; // just searched: the best is gone
  if (loot < 0.15) return null;
  const table = def ? def.loot : { scrap: 2, food: 1 };
  const total = Object.values(table).reduce((a, v) => a + v, 0) || 1;
  let value = 0;
  for (const [key, w] of Object.entries(table)) value += (w / total) * (need[key] || 0);
  if (def && def.gear && def.gear.some((gk) => slotOf(gk) === "weapon") && alive(state).some((s) => !s.gear.weapon)) value += 0.25;
  // The hive campaign stockpiles ammo: gun stores, police stations, armories and the like (ammo the biggest share of
  // their loot) are scored up while it is short (campaignAmmoWant).
  if (def && (def.loot.ammo || 0) >= 4 && campaignAmmoWant(state) > 0) value += 0.3 * campaignAmmoWant(state);
  const danger = def ? (t.loc.zone === "town" || t.loc.zone === "rural" ? Math.min(1, def.danger ?? 1) : def.danger ?? 1) : 0;
  const infection = k ? k.infection : 0.3;
  const risk = danger * 0.12 + infection * 0.6 + (hostile ? 0.4 : 0) + (k ? 0 : 0.1);
  return { value: value * loot * Math.max(0.1, 1 - risk * P.riskAversion), loot, risk, hostile };
}

function planTrip(state) {
  const g = gov(state);
  const P = persona(state);
  const h = hub(state);
  if (!h) return;
  const today = day(state);
  const out = state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && p.teamMission !== "sweep"); // a survey team goes on top (below)
  // Cautious: something below its reserve (reserveStatus) means trips come sooner, may go farther for it (trade
  // visits twice as far) and may take people 10 health below the style's minimum.
  const short = reserveShort(state, h);
  if (out.length >= P.maxTeams || today - g.lastLaunch < (short.length ? Math.min(P.cooldown, P.shortCooldown) : P.cooldown)) return;
  if (threatAt(state, h).urgent) return; // everyone stays to defend
  if (wxNow(state).severe) return; // no new trips into a storm or a blizzard (weather.js)
  const home = atBase(state, h.id);
  // Cautious: no trip while a horde in sight would break in, and P.homeHorde people stay home while one is in
  // sight or the defences are manned (a break-in is fought by whoever is there).
  const hz = P.reserves ? hordeThreat(state, h) : null;
  if (hz && hz.size && !holdCheck(state, h, hz.size, hz.bosses, hz.mix).holds) return;
  const hordeNear = hz && (hz.size > 0 || (h.hordeAlert && state.hour < h.hordeAlert));
  // Hardcore, a hub of four or fewer (the first weeks after founding, hardcore-start.js): one person minds it and the
  // leader goes out too, or nobody brings food in.
  const small = smallHub(state, home);
  const keep = Math.max(small ? 1 : 2, Math.ceil(home.length * (small ? 0.25 : P.homeFrac)), hordeNear ? Math.min(home.length, P.homeHorde) : 0);
  const pool = home.filter((s) => s.health >= P.minHealth - (short.length || small ? 10 : 0) && !s.woundInfected && !s.inBed && s.mood >= 20 && (!s.leader || home.length >= 9 || small));
  const spareHands = Math.min(pool.length, home.length - keep);
  if (spareHands < 1) return;
  const need = needs(state);
  const cands = [];

  // Founding an outpost now and then. In the endgame (landPush: the coalition short of land with few hives left)
  // up to LAND_OUTPOSTS more, where they add the most land to the coalition.
  const outposts = state.bases.filter((b) => b.type === "outpost" && !b.captured).length; // bases taken from groups (conquest.js) are not founded ones
  const push = landPush(state);
  // A hub that has outgrown its plots (hubCramped) founds one more than its style would, once no outpost it founded has a
  // bed free (built or queued: they build ahead of the people sent to them; taken bases get nobody, planSupplyRuns).
  const cramped = hubCramped(state, h) && state.bases.filter((b) => b.type === "outpost" && !b.captured).every((o) => outpostBedsFree(state, o) <= 0);
  if (outposts < P.outposts + (cramped ? 1 : 0) + (push ? (goalsProgress(state).alliance.allIn ? LAND_OUTPOSTS_ALL_IN : LAND_OUTPOSTS) : 0) && alive(state).length >= P.outpostPop && today - g.lastOutpost >= 15 && (h.stock.scrap || 0) >= (push ? 25 : 50) && // the land push makes do with what founding takes
      (h.stock.food || 0) >= home.length * 10 && spareHands >= 2) {
    const land = push && outposts >= P.outposts ? landOutpostSite(state) : null;
    const site = land ? land.id : outpostSite(state);
    const crowded = cramped || alive(state).length > baseBeds(h) + 2;
    if (site != null) cands.push({ mission: "outpost", tile: site, score: land ? 3 : crowded ? 3.5 : 2.2, crew: spareHands >= 4 ? 3 : 2, reach: land ? 1.6 : 1,
      why: land ? `land for the coalition (+${land.gain} tiles)` : cramped ? "the hub has outgrown its plots: a new outpost for its people" : crowded ? "the hub is crowded: a new outpost" : "a new outpost", supplies: { scrap: 23 }, min: { scrap: 15 } });
  }
  // Your people held by another group.
  const held = allCaptives(state);
  // ransom.js autoRescuePlan: only when paying is out (too dear) and the squad would beat the guards for someone worth it.
  const raidFor = held.find((s) => { const pl = autoRescuePlan(state, s); return pl && pl.kind === "raid"; });
  if (P.rescue && raidFor && today - g.lastRescue >= 8 && spareHands >= 3) {
    held.unshift(...held.splice(held.indexOf(raidFor), 1));
    const f = factionById(state, held[0].location.factionId);
    if (f && f.alive && f.bases.length) {
      const ammo = Math.min(Math.max(0, (h.stock.ammo || 0) - 60), ransomValue(f, captivesAt(state, f.id)) * 2);
      cands.push({ mission: "rescue", tile: held[0].location.tile, score: 4, crew: 3, why: `get ${first(held[0])} back from ${f.name}`, supplies: { ammo } });
    }
  }
  // Finds the teams reported, our dead's gear, a vehicle left behind.
  for (const m of state.markers) {
    if (state.grid.distance(m.tile, h.tile) > P.range) continue;
    if (state.parties.some((p) => p.owner === "player" && p.dest === m.tile)) continue;
    if ((m.type === "cache" || m.type === "camp") && !(m.info && m.info.emptied)) cands.push({ mission: "investigate", tile: m.tile, score: m.type === "cache" ? 2.6 : 1.8, crew: 2, why: `check the ${m.label.toLowerCase()}` });
    if (m.type === "car" && !(m.info && m.info.emptied)) cands.push({ mission: "investigate", tile: m.tile, score: carsAtBase(state, h.id).length ? 1 : 2.2, crew: 2, why: "a wrecked car to restore or strip", supplies: { parts: 2, fuel: 6 } });
    if (m.type === "death" && m.info && m.info.items > 0) cands.push({ mission: "recover", tile: m.tile, score: Math.min(2.5, 0.8 + m.info.items * 0.3), crew: 2, why: "recover our dead's gear" });
    const lostBikes = m.type === "vehicle" && isBike(state.vehicles.find((x) => x.id === m.info?.vehicleId));
    if (lostBikes) cands.push({ mission: "getvehicle", tile: m.tile, score: 1.6, crew: 2, why: "bring our bikes home", supplies: { scrap: 1 } });
    else if (m.type === "vehicle" && !carsAtBase(state, h.id).length) {
      const bad = m.info && m.info.condition < 15;
      // One found on a map that needs work (foundcars.js): only with a good enough mechanic at the hub, and its parts.
      const fv = state.vehicles.find((x) => x.id === m.info?.vehicleId);
      const fix = fv && fv.found && fv.found.repair;
      if (fix) {
        if (!atBase(state, h.id).some((s) => skill(s, "mechanics") >= fix.mech)) continue;
        cands.push({ mission: "getvehicle", tile: m.tile, score: 2, crew: 2, why: `repair the ${fv.name.toLowerCase()} we found`, supplies: { fuel: 12, parts: fix.parts, scrap: fix.scrap }, min: { parts: fix.parts, scrap: fix.scrap } });
        continue;
      }
      // It starts again only with 2 fuel between its tank and the team (no fuel to bring: no trip, not a wasted one).
      cands.push({ mission: "getvehicle", tile: m.tile, score: 2.4, crew: 2, why: "bring our vehicle home", supplies: { fuel: 12, parts: bad ? 1 : 0 }, min: { fuel: Math.max(0, 2 - ((m.info && m.info.fuel) || 0)) } });
    }
  }
  // A trade visit when the hub has goods to spare and a real need.
  if (P.tradeEvery && today - g.lastTrade >= (short.length ? Math.ceil(P.tradeEvery / 2) : P.tradeEvery) && !out.some((p) => p.mission === "trade")) {
    const goods = tradeGoods(state, need);
    if (goods && Object.values(need).some((v) => v >= 1.5)) {
      const f = state.factions.filter((x) => x.alive && x.known && x.bases.length && (attitude(x) === "Friendly" || attitude(x) === "Allied" || (attitude(x) === "Neutral" && !isAggressiveType(x))))
        .map((x) => ({ f: x, d: Math.min(...x.bases.map((b) => state.grid.distance(b, h.tile))) })).filter((x) => x.d <= P.range * (short.length ? 2 : 1))
        // The buyer that pays best for the load (trade.js goodsWorth: their kind and state), for the walk.
        .map((x) => ({ ...x, s: goodsWorth(state, x.f, goods) / (1 + x.d / 10) })).sort((a, b) => b.s - a.s || a.d - b.d)[0];
      if (f) cands.push({ mission: "trade", tile: f.f.bases.find((b) => state.grid.distance(b, h.tile) === f.d), score: 1.6, crew: 2, why: `trade with ${f.f.name}`, supplies: goods, reach: short.length ? P.shortReach : 1 });
    }
  }
  // An envoy (every style from day ENVOY_FROM): a known group out of radio reach that is not in the coalition gets
  // a visit with gifts every ENVOY_EVERY days (goodwill, a pact, a job at the gates, the invitation: handleTrade).
  const envoy = envoyCandidate(state, need);
  if (envoy) cands.push(envoy);
  // The war on the hives (every style once past its hiveFrom day): a squad of six against a known hive it can beat,
  // with fires first when that is what it takes (hiveCandidate). A hive mission may take more of the hub than the
  // style's homeFrac (the squad is back in days), but never leaves fewer than HIVE_KEEP at home.
  if (!out.some((p) => p.mission === "hive" || p.mission === "assault")) {
    const hc = hiveCandidate(state, home, pool);
    if (hc) cands.push(hc);
    // No hive it can storm yet: the most dangerous hive growth it knows of, burned or fought (growthCandidate).
    const gc = !hc && !out.some((p) => p.mission === "growth") ? growthCandidate(state, home, pool) : null;
    if (gc) cands.push(gc);
    // Conquest (conquest.js): take back a base of yours they hold, or a hostile group's base, with a squad that
    // has the style's odds (conquestCandidate).
    const cc = conquestCandidate(state, home, pool);
    if (cc) cands.push(cc);
  }
  // Land for the coalition (claims.js): a claim trip toward the nearest contested ground while the land is short, and
  // a well on a claim by water when the water is (claimCandidate, wellCandidate; inert until claims.js lands).
  const lc = claimCandidate(state, h, spareHands, need);
  if (lc) cands.push(lc);
  const wc = wellCandidate(state, h, spareHands);
  if (wc) cands.push(wc);
  // Scavenging: the best known sites for what the hub needs.
  // Cautious, short of something: sites that have it may be farther out (shortReach), the most dangerous (risk
  // above 0.8) are left alone, and the crew is the full three.
  // As the area empties (other groups strip sites too and nothing grows back, aiscav.js): with fewer than
  // EMPTY_SITES sites near home it believes still hold loot (30%+), it looks EMPTY_RING tiles farther out and allows
  // trips EMPTY_REACH × as long.
  const sites = [];
  const gives = (t) => { const table = t.loc ? LOCATIONS[t.loc.type].loot : {}; return short.some((k) => (table[k] || 0) >= 1); };
  const radius = P.range + 5 + (short.length ? 4 : 0);
  const scan = (r, outer) => {
    for (const id of state.grid.within(h.tile, r)) {
      const t = state.tiles[id];
      if (!t.loc || id === h.tile || (outer && state.grid.distance(id, h.tile) <= radius) || !siteKnown(state, id)) continue;
      if (state.parties.some((p) => p.owner === "player" && (p.dest === id || (p.ap && p.ap.tile === id)))) continue;
      const s = siteScore(state, id, need, P);
      if (!s || s.value <= 0.05 || (P.reserves && s.risk > 0.8)) continue;
      const far = short.length && gives(t);
      sites.push({ mission: "scavenge", tile: id, score: (s.value * 4) / (1 + state.grid.distance(id, h.tile) / 6), crew: s.risk > 0.45 || s.hostile || far || outer ? 3 : P.crew,
        why: outer ? `${needText(need, t)} (the sites nearer home are picked over)` : needText(need, t), reach: Math.max(far ? P.shortReach : 1, outer ? EMPTY_REACH : 1),
        known: !!intel(state, id), gives: far, loot: s.loot, outer });
    }
  };
  scan(radius, false);
  const stocked = sites.filter((x) => x.loot >= 0.3 && state.grid.distance(x.tile, h.tile) <= P.range).length;
  if (stocked < EMPTY_SITES) scan(radius + EMPTY_RING, true);
  sites.sort((a, b) => b.score - a.score);
  cands.push(...sites.slice(0, P.reserves ? 16 : 6)); // Cautious looks further down the list: the best may be out of reach
  // Cautious: short of something no known site offers: a recon to the nearest unknown site that should have it
  // (the team looks around first and searches it if it is worth it: teamAct).
  if (short.length && !sites.some((x) => x.known && x.gives)) {
    const target = sites.filter((x) => !x.known && x.gives).sort((a, b) => state.grid.distance(a.tile, h.tile) - state.grid.distance(b.tile, h.tile))[0];
    if (target && cands.includes(target)) cands.splice(cands.indexOf(target), 1); // a look first instead of going straight in
    if (target) cands.push({ ...target, mission: "recon", why: `look for ${short.filter((k) => gives(state.tiles[target.tile]) && (LOCATIONS[state.tiles[target.tile].loc.type].loot[k] || 0) >= 1).join(" and ")} (none known nearby)` });
  }
  cands.push(...foodTripCands(state, h, pool, need, P)); // hunting and fishing trips when food runs short (hunting.js)
  cands.push(...waterTripCands(state, h, pool, need, P)); // hauling water from a shore when the base cannot make enough (orders.js fetchWater)
  cands.push(...heatFuelCands(state, h, need, P)); // needs-gauges: fuel for the winter's heating
  cands.push(...woodTripCands(state, h, pool, P)); // woodcutting.js: firewood when the land around the hub gives little
  cands.push(...jobTripCands(state)); // jobs.js: scouting, fetching a package, a horde to cull (Aggressive)
  cands.push(...gatheringCands(state, h, pool, P, stormValue)); // hivebirth.js: break up the dead massing for a new hive
  cands.sort((a, b) => b.score - a.score);

  for (const c of cands.slice(0, P.reserves ? 20 : 8)) {
    const res = launchTrip(state, c, pool, c.mission === "hive" || c.mission === "assault" ? HIVE_SQUAD : spareHands); // hiveCandidate / conquestCandidate checked who stays home
    if (!res) continue;
    if (c.outer) g.stats.farTrips = (g.stats.farTrips || 0) + 1;
    g.lastLaunch = today;
    if (c.mission === "outpost") g.lastOutpost = today;
    if (c.mission === "rescue") g.lastRescue = today;
    if (c.mission === "trade" && !c.envoy) g.lastTrade = today;
    if (c.envoy) { (g.lastEnvoy = g.lastEnvoy || {})[c.envoy] = today; res.apEnvoy = c.envoy; }
    if (c.mission === "hive") g.lastHive = today;
    if (c.gathering != null) res.apGathering = c.gathering; // one such trip at a time
    if (c.mission === "growth") g.lastGrowth = today;
    if (c.mission === "assault") { g.lastAssault = today; const fx = state.factions.find((x) => x.alive && x.bases.includes(c.tile)); if (fx) g.conquestFocus = fx.id; }
    break; // then a survey with the hands still spare (below)
  }
  // A survey (survey.js) with the hands still spare: unexplored ground near home or a rumour's circle, on top of the
  // day's trip (it does not count toward the style's teams out). The walls come first: whatever the style, at least
  // SURVEY.auto.keep people and SURVEY.auto.keepFrac of the hub stay home (survey.js).
  const home2 = atBase(state, h.id);
  const pool2 = pool.filter((s) => home2.includes(s));
  const keep2 = Math.max(SURVEY.auto.keep, Math.ceil(home2.length * Math.max(P.homeFrac, SURVEY.auto.keepFrac)));
  const spare2 = Math.min(pool2.length, home2.length - keep2);
  const sv = surveyCandidate(state, spare2);
  if (sv) launchTrip(state, sv, pool2, spare2);
}

// ---------- envoys (alliance.js) ----------
// The coalition needs every group in it, and the radio reaches only 12 tiles from the hub (more with relays at
// your other bases: buildWishes): a group out of reach is courted in person. Two people take the hub's surplus
// (food, ammo, meds) to the nearest such group that is not hostile and not a member, at most one envoy out and one visit per group every
// ENVOY_EVERY days; at their gates the team gives what it brought as a gift while their goodwill is short (up to
// 15 goodwill a day), proposes a pact and invites them once they qualify (handleTrade). A team at their gates
// also hears of jobs (jobs.js), and a job done for them is what the invitation needs without a council.
const ENVOY_FROM = 40, ENVOY_EVERY = 20, ENVOY_REACH = 2;
function envoyGoods(state) {
  const h = hub(state);
  const n = Math.max(1, atBase(state, h.id).length);
  const goods = {};
  const spare = tradeSpare(state); // never the food the winter plan needs (seed 5062)
  if ((h.stock.food || 0) > n * 30 + 20 && spare.food > 0) goods.food = Math.min(20, Math.floor(h.stock.food - n * 30), spare.food);
  if ((h.stock.ammo || 0) > n * 15 + 100 && !campaignAmmoWant(state)) goods.ammo = Math.min(60, Math.floor(h.stock.ammo - n * 15 - 60)); // not the campaign's stockpile
  if ((h.stock.meds || 0) > n + 8) goods.meds = Math.min(4, Math.floor(h.stock.meds - n - 6));
  const value = Object.entries(goods).reduce((a, [k, q]) => a + q * SUPPLIES[k].value, 0);
  return value >= 40 ? goods : null;
}
function envoyCandidate(state, need) {
  const g = gov(state);
  const P = persona(state);
  const h = hub(state);
  const today = day(state);
  if (today < ENVOY_FROM || state.parties.some((p) => p.owner === "player" && p.apEnvoy)) return null;
  const goods = envoyGoods(state);
  const last = g.lastEnvoy || {};
  const f = state.factions
    .filter((x) => x.alive && x.known && x.bases.length && !isMember(state, x) && attitude(x) !== "Hostile" && !canRadioGroup(state, x) &&
      today - (last[x.id] ?? -99) >= ENVOY_EVERY)
    .map((x) => ({ x, d: Math.min(...x.bases.map((b) => state.grid.distance(b, h.tile))) }))
    // The war council aims the envoys: the groups nearest the campaign's hive and the coalition's land first (their
    // fighters join the storm, alliance.js hiveAllies, and their land counts), then the nearest to home.
    .filter((o) => o.d <= P.range * ENVOY_REACH).sort((a, b) => aimAt(state, a.x) - aimAt(state, b.x) || a.d - b.d)[0];
  if (!f) return null;
  // Gifts while their goodwill is short; a group that trusts you already only needs the visit (the invitation).
  const courted = f.x.goodwill >= ALLIANCE.GOODWILL && f.x.pact;
  if (!courted && !goods) return null;
  return { mission: "trade", tile: f.x.bases.find((b) => state.grid.distance(b, h.tile) === f.d), score: courted ? 3 : 2.2, crew: 2, envoy: f.x.id, reach: ENVOY_REACH,
    why: `an envoy to ${f.x.name} (goodwill ${Math.round(f.x.goodwill)}${f.x.pact ? "" : ", no pact"}): ${courted ? "the invitation to the coalition" : "gifts and talk for the coalition"}`, supplies: courted ? {} : goods };
}

// ---------- the war on the hives (hives.js) ----------
// The odds are judged as the hive card shows them: the squad (stormValue) against the brood it expects
// (hives.js broodForce from the guard last seen at the mound, HIVE_GUESS if it was never seen up close; the
// fighters coalition members and job givers send take their share, alliance.js hiveAllies). The ratio squad
// value (stormValue) / (brood × its power / 5.2) it wants is the style's hiveOdds (calibrated against the battle
// played by the AI on both sides: about 1.3 costs a fighter in three storms, 1.1 about one a storm, 0.9 two or
// three and sometimes the squad). Fires around the mound (6 fuel each, up to hiveFires) burn
// 30% of the guard first when that is what it takes. Targets: known hives, nearest first, ahead of them those
// within 12 tiles of one of your bases (their hordes hit you first), those a group asked you to storm (their
// fighters join) and those with a small guard.
const HIVE_GUESS = 100;  // guard assumed at a hive never seen up close
const HIVE_SQUAD = 6;    // a storm is six fighters
const HIVE_KEEP = 3;     // people a hive mission leaves at the hub at least
const HIVE_HEALTH = 80;  // fit to storm a hive
const FIRE_FUEL = 6;     // hives.js "Set fires around it"
const HIVE_AMMO = 12;    // ammo a fighter wants for a storm
const FIRE_CUT = 0.7;    // the guard left after a fire
const knownHive = (state, id) => (state.live.has(id) ? state.tiles[id].hive : !!(state.knowledge[id] && state.knowledge[id].hive));
// A fighter's worth in a storm, as the tactical battle plays it (combat.js playerUnit): the hit chance times the
// damage of the gun they can use (an assault rifle below its Shooting 10 misses a lot more than its combat
// power suggests), more with armor, less when hurt. Melee counts for little: the brood is deadly up close.
// About 2 for a shotgun and a vest at Shooting 6, 1 for a pistol at Shooting 4.
function stormValue(s) {
  const item = s.gear.weapon;
  const eff = gearEffect(s, item);
  const key = item && eff.usable && WEAPONS[item.key] ? item.key : "fists";
  const w = WEAPONS[key];
  const mult = key === "fists" ? 1 : eff.mult;
  const dmg = ((w.dmg[0] + w.dmg[1]) / 2) * (0.6 + 0.4 * mult) * (0.75 + 0.25 * (key === "fists" ? 1 : item.quality || 1));
  const hit = w.melee ? 0.2 : Math.max(0.05, Math.min(0.95, (40 + skill(s, "shooting") * 2.5 - (1 - mult) * 30 + (w.aim || 0) + (s.traits.includes("brave") ? 5 : 0) - (s.traits.includes("coward") ? 5 : 0)) / 100));
  return ((hit * dmg) / 10) * (0.5 + s.health / 200) * Math.sqrt(1 / Math.max(0.3, armorMult(s)));
}
const hiveSquad = (pool) => [...pool].filter((s) => s.health >= HIVE_HEALTH && !s.woundInfected).sort((a, b) => stormValue(b) - stormValue(a)).slice(0, HIVE_SQUAD);
const squadPower = (list) => list.reduce((a, s) => a + stormValue(s), 0);
// The guard you know of at a hive: what is in sight there now, else the last look (never below the 40 a hive
// rebuilds its guard to), else a guess.
function knownGuard(state, id) {
  if (state.live.has(id)) return Math.max(HIVE_GUARD_MIN, snapshot(state, id).hordeSize);
  const k = state.knowledge[id];
  return k && k.hordeSize ? Math.max(HIVE_GUARD_MIN, k.hordeSize) : HIVE_GUESS;
}
const HIVE_GUARD_MIN = 40;
// Squad power over the brood's strength after `fires` fires, with the allies' fighters off.
function stormRatio(state, hive, power, guard, fires) {
  const f = broodForce(Math.round(guard * FIRE_CUT ** fires), state);
  const count = broodAfterAllies(f.count, hiveAllies(state, hive).fighters);
  return power / (count * (f.power / 5.2));
}
// Fewest fires that bring the odds up to the style's margin (null: not even with every fire it may set).
function firesNeeded(state, hive, power, guard, maxFires) {
  const P = persona(state);
  for (let n = 0; n <= maxFires; n++) if (stormRatio(state, hive, power, guard, n) >= P.hiveOdds) return n;
  return null;
}
// planTrip's hive candidate (null: none this morning; hiveRejects counts why). The target is the campaign's hive
// (planCampaign: the nearest known, a group's job first). A storm goes when the squad, the ammo stockpile and the
// odds (with the fires this trip can set) are there. When the odds are not there yet but fires over several trips
// would bring them in reach (CAMPAIGN.fireTrips × hiveFires fires, each burning 30% of the guard), a fire trip goes
// instead: the squad with fuel, sets its fires and comes home (hiveChoice), and the next trip finds a smaller guard
// (the team's look updates what the hub knows of it). A fire trip needs no ammo stockpile.
function hiveCandidate(state, home, pool) {
  const P = persona(state);
  const g = gov(state);
  const h = hub(state);
  const today = day(state);
  const rj = hiveRejects(state);
  const c = g.campaign;
  const waits = (k) => { if (c) c.waits = k; rj[k]++; return null; };
  if (!c) return (state.hives || []).some((hv) => knownHive(state, hv.tile)) ? waits("far") : waits("unknown");
  const hive = hiveById(state, c.hiveId);
  if (!hive) return waits("unknown");
  if (today < P.hiveFrom || today - (g.lastHive ?? -99) < P.hiveRest) return waits("rest");
  if (home.length - HIVE_SQUAD < Math.max(HIVE_KEEP, Math.ceil(home.length * P.homeFrac * 0.6))) return waits("home");
  const squad = hiveSquad(pool);
  if (squad.length < HIVE_SQUAD) return waits("squad");
  const power = squadPower(squad);
  const fuel = Math.max(0, Math.floor(((h.stock.fuel || 0) - 4) / FIRE_FUEL));
  const guard = knownGuard(state, hive.tile);
  const fires = firesNeeded(state, hive, power, guard, Math.min(P.hiveFires, fuel));
  const d = state.grid.distance(hive.tile, h.tile);
  if (fires != null) {
    if ((h.stock.ammo || 0) < campaignAmmoTarget(state, h)) return waits("ammo");
    c.waits = "storm";
    const ratio = stormRatio(state, hive, power, guard, fires);
    return { mission: "hive", tile: hive.tile, score: 6, crew: HIVE_SQUAD, hive: true,
      why: `destroy ${hive.name} (squad ${power.toFixed(1)} against the brood's ${(power / ratio).toFixed(1)}${fires ? ` after ${fires} fire${fires > 1 ? "s" : ""}` : ""}; the campaign's ${c.fires} fire${c.fires === 1 ? "" : "s"} so far)`,
      supplies: { ammo: 80, meds: 4, fuel: fires * FIRE_FUEL }, min: { fuel: fires * FIRE_FUEL }, fires };
  }
  // Not this trip: a fire trip when the campaign's fires would get there (and there is fuel for one at least).
  const canFire = Math.min(P.hiveFires, fuel);
  if (canFire < 1 || firesNeeded(state, hive, power, guard, P.hiveFires * CAMPAIGN.fireTrips) == null) return waits("odds");
  c.waits = "fires";
  return { mission: "hive", tile: hive.tile, score: 5, crew: HIVE_SQUAD, hive: true, fireTrip: true,
    why: `set fires around ${hive.name} (guard about ${guard}, ${d} tiles off): the campaign's odds are not there yet (squad ${power.toFixed(1)} against the brood's ${(power / stormRatio(state, hive, power, guard, 0)).toFixed(1)})`,
    supplies: { ammo: Math.min(40, Math.max(0, (h.stock.ammo || 0) - 20)), meds: 2, fuel: canFire * FIRE_FUEL }, min: { fuel: FIRE_FUEL }, fires: canFire };
}
// The hive card (hives.js): storm when the odds are there, else set fires while that helps and the fuel lasts
// (the team then storms on its next orders: teamAct), else back off.
function hiveChoice(state, card, opts, p, find) {
  const P = persona(state);
  const hive = p ? hiveAt(state, partyTile(p)) : null;
  if (!hive) return find(/^Back off/);
  const fit = partyMembers(state, p).filter((s) => s.health >= 60);
  const power = squadPower(fit);
  const guard = hiveForce(state, hive).guard; // the card says how many are packed around it
  const fired = p.apFires || 0;
  // Guns need ammo (an assault rifle 2 a shot): no storm with less than HIVE_AMMO a fighter (fires need none).
  const ammo = (p.supplies.ammo || 0) + ((p.cargo && p.cargo.supplies && p.cargo.supplies.ammo) || 0);
  const armed = ammo >= fit.length * HIVE_AMMO;
  if (armed && fit.length >= HIVE_SQUAD - 1 && stormRatio(state, hive, power, guard, 0) >= P.hiveOdds) return find(/^Storm the hive/);
  const lit = (choice) => { p.apFires = fired + 1; p.apHiveAgain = true; campaignFire(state, hive); return choice; };
  // Molotovs (hives.js FIREBOMB) before fuel: a bigger fire, and the fuel stays for the drive.
  const bomb = find(/^Firebomb/);
  if (bomb && !isDisabled(state, bomb) && fired < P.hiveFires && fit.length >= HIVE_SQUAD - 1 && guard >= HIVE_GUARD_MIN) return lit(bomb);
  const fire = find(/^Set fires/);
  const fuelHome = p.vehicle ? p.apFuelHome || 0 : 0;
  const canFire = fire && !isDisabled(state, fire) && partyFuelOf(state, p) - FIRE_FUEL >= fuelHome && fired < P.hiveFires;
  // Fires only when the storm comes within reach with the fires the team can still set, or on a campaign fire trip
  // (hiveCandidate: the fires stack over several trips toward the storm).
  const left = Math.min(P.hiveFires - fired, Math.floor((partyFuelOf(state, p) - fuelHome) / FIRE_FUEL));
  if (canFire && fit.length >= HIVE_SQUAD - 1 && guard >= HIVE_GUARD_MIN && (p.apFireTrip || firesNeeded(state, hive, power, guard, left) != null)) return lit(fire);
  return find(/^Back off/);
}
// After the fires: the team storms (or sets the next fire) when it is still fit for it.
function hiveAgain(state, p) {
  if (!p.apHiveAgain) return false;
  delete p.apHiveAgain;
  const tile = partyTile(p);
  if (!hiveAt(state, tile) || partyMembers(state, p).filter((s) => s.health >= 60).length < HIVE_SQUAD - 1) return false;
  if (!orderOptions(state, p).some((o) => o.mission === "hive" && !o.disabled)) return false;
  startOrder(state, p, { type: "mission", mission: "hive" });
  return true;
}
// A job to storm a hive (jobs.js): taken when the governor would storm it anyway, with the givers' fighters along.
function hiveJobOk(state, job) {
  const P = persona(state);
  const h = hub(state);
  const hive = hiveAt(state, job.target);
  if (!h || !hive || day(state) < P.hiveFrom - 30) return false; // no hub left (conquest.js can take it)
  const home = atBase(state, h.id);
  const squad = hiveSquad(home);
  if (squad.length < HIVE_SQUAD) return false;
  const f = factionById(state, job.fid);
  const extra = f ? Math.max(1, Math.min(3, Math.round(f.pop / 10))) : 0; // their fighters once the job is taken
  const base = broodForce(Math.round(knownGuard(state, hive.tile) * FIRE_CUT ** Math.min(P.hiveFires, Math.floor(((h.stock.fuel || 0) - 4) / FIRE_FUEL))), state);
  const count = broodAfterAllies(base.count, hiveAllies(state, hive).fighters + extra);
  return squadPower(squad) / (count * (base.power / 5.2)) >= P.hiveOdds && state.grid.distance(h.tile, hive.tile) <= 40;
}

// ---------- the hive campaign ----------
// gov(state).campaign: the hive the governor works toward (planCampaign, each morning): the nearest known hive
// within CAMPAIGN.far of the hub, a hive a group asked it to storm (jobs.js) first, one within 12 tiles of a base
// next; it sticks to its target while that stands. Toward it the hub stockpiles ammo to campaignAmmoTarget
// (HIVE_SQUAD × HIVE_AMMO + CAMPAIGN.ammoExtra: needs() asks for ammo, so trips go to gun stores and the like,
// radio deals and trade visits ask for it, the ammo bench runs to it, and no envoy gives ammo away), sets fires
// over several trips when that brings the odds in reach (hiveCandidate fire trips), courts and invites the groups
// near the target first (aimAt: envoys, pacts; alliance.js hiveAllies counts a member's fighters at the mound) and
// storms when the odds are there. campaignLine says what it waits for (the Goals panel / the morning log).
const CAMPAIGN = { far: 60, ammoExtra: 20, fireTrips: 3, nearBase: 12 };
function campaignTarget(state) {
  const h = hub(state);
  if (!h) return null;
  const g = gov(state);
  const jobs = new Set(activeJobs(state).filter((j) => j.type === "hive").map((j) => j.target));
  let best = null;
  for (const hive of state.hives || []) {
    if (!knownHive(state, hive.tile)) continue; // the governor plays by what you know
    const d = state.grid.distance(hive.tile, h.tile);
    if (d > CAMPAIGN.far) continue;
    const nearBase = state.bases.some((b) => state.grid.distance(b.tile, hive.tile) <= CAMPAIGN.nearBase);
    const score = (jobs.has(hive.tile) ? 3 : 0) + (nearBase ? 2 : 0) + (g.campaign && g.campaign.hiveId === hive.id ? 1.5 : 0) - d / 8;
    if (!best || score > best.score) best = { hive, score };
  }
  return best ? best.hive : null;
}
function planCampaign(state) {
  const g = gov(state);
  const hive = campaignTarget(state);
  if (!hive) { g.campaign = null; return; }
  if (!g.campaign || g.campaign.hiveId !== hive.id) g.campaign = { hiveId: hive.id, tile: hive.tile, since: day(state), fires: 0, trips: 0, waits: "" };
}
// The ammo the campaign holds at the hub (0 without a campaign).
const campaignAmmoTarget = (state, base = hub(state)) => (gov(state).campaign && base && base.type === "hub" ? HIVE_SQUAD * HIVE_AMMO + CAMPAIGN.ammoExtra : 0);
// How much the campaign wants ammo, on the needs() scale: 2.4 under half the stockpile, 1.9 under it (1.8 is where
// the radio asks for it), 0 with it in store or without a campaign. Never above water's and food's 2.5+ when short.
function campaignAmmoWant(state) {
  const h = hub(state);
  const target = campaignAmmoTarget(state, h);
  if (!target) return 0;
  const have = h.stock.ammo || 0;
  return have < target * 0.5 ? 2.4 : have < target ? 1.9 : 0;
}
// Fuel for the campaign's fires (a trip's hiveFires × FIRE_FUEL, plus the 4 kept back) while the campaign waits for
// fires or odds and the hub has less: 1.6 on the needs() scale (fuel trips, trades).
function campaignFuelWant(state) {
  const c = gov(state).campaign;
  const h = hub(state);
  if (!c || !h || !(c.waits === "fires" || c.waits === "odds")) return 0;
  return (h.stock.fuel || 0) < 4 + persona(state).hiveFires * FIRE_FUEL ? 1.6 : 0;
}
// The fuel the campaign holds back from cars and the generator while it waits for fires or odds (tripFuelHold, fuelFloor).
function campaignFuelHold(state, base = hub(state)) {
  const c = gov(state).campaign;
  if (!c || !base || base.type !== "hub" || !(c.waits === "fires" || c.waits === "odds")) return 0;
  return Math.min(Math.max(0, base.stock.fuel || 0), 4 + persona(state).hiveFires * FIRE_FUEL);
}
// A fire set at the campaign's hive (hiveChoice).
function campaignFire(state, hive) { const c = gov(state).campaign; if (c && c.hiveId === hive.id) c.fires++; }
// What the campaign waits for, one line ("" without a campaign). The Goals panel can show it; the governor logs it
// each morning (campaignReport).
export function campaignLine(state) {
  const c = gov(state).campaign;
  const h = hub(state);
  if (!c || !h) return "";
  const hive = hiveById(state, c.hiveId);
  if (!hive) return "";
  const target = campaignAmmoTarget(state, h);
  const allies = hiveAllies(state, hive).names.map((n) => n.replace(/ \(\d+\)$/, ""));
  const near = state.factions.filter((f) => f.alive && f.known && !isMember(state, f) && f.bases.some((b) => state.grid.distance(b, hive.tile) <= ALLIANCE.HIVE_RANGE)).map((f) => f.name);
  const WAIT = {
    rest: "the squad to rest between hive missions", home: "enough people to keep the hub safe while the squad is out", squad: "six fit fighters", ammo: `the ammo stockpile (${Math.floor(h.stock.ammo || 0)} of ${target})`,
    odds: "better odds: a stronger squad, allies near the mound, or fuel for fires", fires: "the next fire trip", storm: "nothing: the storm goes out", far: "a hive within reach", unknown: "a known hive",
  };
  // A storm or fire trip picked this morning that could not get away (launchTrip: rations, a car, a way there) is not out.
  const out = state.parties.some((p) => p.owner === "player" && p.mission === "hive");
  const wait = (c.waits === "storm" || c.waits === "fires") && !out ? "the squad to get away (its rations, a car for the drive, or a way there over land)" : WAIT[c.waits] || "the morning's plan";
  return `Campaign on ${hive.name} (${state.grid.distance(hive.tile, h.tile)} tiles, guard about ${knownGuard(state, hive.tile)}): ${Math.floor(h.stock.ammo || 0)} of ${target} ammo, ${c.fires} fire${c.fires === 1 ? "" : "s"} set, allies: ${allies.length ? allies.join(", ") : "none yet"}${near.length ? ` (courting ${near.join(", ")})` : ""}. Waiting for ${wait}.`;
}
function campaignReport(state) {
  const line = campaignLine(state);
  const g = gov(state);
  if (g.campaign) g.campaign.line = line; // the UI reads state.governor.campaign.line
  if (line) say(state, line);
}
// How well aimed a group is for the war council: its distance to the campaign's hive (their fighters join the
// storm) plus its distance to the coalition's land (their land joins it). Lower is better.
function aimAt(state, f) {
  const g = state.grid;
  const c = gov(state).campaign;
  const toHive = c ? Math.min(...f.bases.map((b) => g.distance(b, c.tile))) : 0;
  const centres = landCentres(state);
  const toLand = centres.length ? Math.min(...f.bases.map((b) => Math.min(...centres.map((x) => g.distance(b, x.tile))))) : 0;
  return toHive + toLand;
}
// The war council (daily): the hostile groups in the coalition's way, and what the style does about them.
// A foe: a known hostile group with a base that raided you in the last 120 days, holds a base on the coalition's land
// (it raids the land it sits on), or sits between the hub and the campaign's hive. Cautious does nothing. Balanced
// joins a war another group fights against such a foe (diplomacy.js joinWar: the ally must trust you, the foe must
// not be a member), when the ally with your help is at least as strong as the foe. Aggressive joins too, and marks
// the foes for conquestCandidate (it storms their bases when the odds are there, from its conquerFrom day).
const WAR = { raidedDays: 120, between: 4 };
function warFoes(state) {
  const h = hub(state);
  if (!h) return [];
  const g = state.grid;
  const c = gov(state).campaign;
  const mask = coalitionMask(state);
  const today = day(state);
  return state.factions.filter((f) => {
    if (!f.alive || !f.known || !f.bases.length || attitude(f) !== "Hostile" || isMember(state, f)) return false;
    if (f.raidedYou != null && today - f.raidedYou <= WAR.raidedDays) return true;
    if (f.bases.some((b) => mask[b])) return true;
    return !!c && f.bases.some((b) => g.distance(h.tile, b) + g.distance(b, c.tile) <= g.distance(h.tile, c.tile) + WAR.between);
  });
}
function warCouncil(state) {
  const P = persona(state);
  const g = gov(state);
  if (P.conquer === "last" || !hub(state)) { g.warFoes = []; return ""; } // Cautious never starts or joins one
  const foes = warFoes(state);
  g.warFoes = P.conquer === "ready" ? foes.map((f) => f.id) : [];
  if (!foes.length) return "";
  const out = [];
  for (const w of ensureDiplo(state).wars) {
    if (w.playerSide != null) continue;
    for (const [sideId, foeId] of [[w.a, w.b], [w.b, w.a]]) {
      const foe = foes.find((f) => f.id === foeId);
      const ally = factionById(state, sideId);
      if (!foe || !ally || !ally.alive || joinProblem(state, w, ally)) continue;
      if (strength(ally) + baseDefense(state, hub(state)) * 0.5 < strength(foe) * (P.conquer === "ready" ? 0.8 : 1)) continue;
      const r = joinWar(state, w.id, ally.id);
      if (/at war/.test(r)) { out.push(`War council: ${r.replace(/\.$/, "")} (${foe.name} ${warWhy(state, foe)}).`); break; }
    }
    if (out.length) break; // one war a day
  }
  return out.join(" ");
}
function warWhy(state, f) {
  const today = day(state);
  if (f.raidedYou != null && today - f.raidedYou <= WAR.raidedDays) return "raided you";
  if (f.bases.some((b) => coalitionMask(state)[b])) return "holds a base on the coalition's land";
  return "sits between the hub and the campaign's hive";
}

// ---------- hive growths (hivetech.js) ----------
// While no hive can be stormed yet: the most dangerous growth it knows of (GROWTHS danger, at least GROWTH_DANGER: the
// spawners, the Wallbreaker den and the vat; the den, the crawler burrow and the vat first; one within 12 tiles of a base of yours ahead, nearer ahead), with the
// fuel for two fires (TECH.FIRE_FUEL each) or a crew of GROWTH_CREW that beats its guard by the style's hiveOdds
// (combat power against the guard it expects, with a margin for the special dead). At the growth (growthChoice):
// Molotovs, else a fire, else the fight when the odds are there, else back off; a fire that leaves it standing is
// followed by the next one (growthAgain).
const GROWTH_CREW = 4;
const GROWTH_DANGER = 2.5; // only growths at least this dangerous (GROWTHS danger: the spawners, the den, the vat; not pits and brood chambers)
function knownGrowth(state, id) {
  if (state.live.has(id)) { const g = growthAt(state, id); return g && g.withered == null ? { kind: g.kind } : null; }
  const k = state.knowledge[id];
  return k && k.growth && !k.growth.withered ? k.growth : null;
}
// The guard it expects at a growth, on the scale of stormValue (count × power / 5.2 as for a hive storm, × 1.2 for
// the special dead).
function growthGuardEstimate(state, tile, hiveTile) {
  const guard = hiveTile != null ? knownGuard(state, hiveTile) : HIVE_GUESS;
  const count = Math.min(TECH.GUARD_MAX, TECH.GUARD_BASE + Math.floor(guard / TECH.GUARD_PER));
  return count * ((2 + zombieToughness(state, tile) * 0.6) / 5.2) * 1.2;
}
const growthCrew = (pool) => [...pool].filter((s) => s.health >= 70 && !s.woundInfected).sort((a, b) => stormValue(b) - stormValue(a)).slice(0, GROWTH_CREW);
function growthCandidate(state, home, pool) {
  const P = persona(state);
  const g = gov(state);
  const h = hub(state);
  const today = day(state);
  if (!h || today < Math.min(P.hiveFrom, 120) || today - (g.lastGrowth ?? -99) < P.hiveRest) return null;
  if (home.length - GROWTH_CREW < Math.max(HIVE_KEEP, Math.ceil(home.length * P.homeFrac))) return null;
  const crew = growthCrew(pool);
  if (crew.length < 3) return null;
  const power = squadPower(crew);
  const fires = Math.floor(((h.stock.fuel || 0) - 6) / TECH.FIRE_FUEL) >= 2;
  let best = null;
  for (const gr of ensureGrowths(state)) {
    const kg = knownGrowth(state, gr.tile); // the governor plays by what you know
    if (!kg || !GROWTHS[kg.kind] || GROWTHS[kg.kind].danger < GROWTH_DANGER) continue;
    const d = state.grid.distance(h.tile, gr.tile);
    if (d > 40) continue;
    const hv = hiveById(state, gr.hive);
    const fight = power / growthGuardEstimate(state, gr.tile, hv ? hv.tile : null) >= P.hiveOdds;
    if (!fires && !fight) continue;
    const nearBase = state.bases.some((b) => state.grid.distance(b.tile, gr.tile) <= 12);
    const score = GROWTHS[kg.kind].danger + (nearBase ? 1.5 : 0) - d / 10;
    if (!best || score > best.score) best = { gr, kg, score, hv };
  }
  if (!best) return null;
  return { mission: "growth", tile: best.gr.tile, score: 3.5 + best.score * 0.5, crew: GROWTH_CREW, growth: true,
    why: `burn the ${GROWTHS[best.kg.kind].name.toLowerCase()} at ${best.hv ? best.hv.name : "a hive"}`,
    supplies: { ammo: 50, meds: 3, fuel: fires ? TECH.FIRE_FUEL * 2 : 0 } };
}
function growthChoice(state, card, opts, p, find) {
  const P = persona(state);
  const g = p ? growthAt(state, partyTile(p)) : null;
  if (!g || g.withered != null) return find(/^Back off/);
  const bomb = find(/^Firebomb/);
  const fire = find(/^Burn it/);
  const fuelHome = p.vehicle ? p.apFuelHome || 0 : 0;
  const again = () => { p.apGrowthAgain = true; };
  if (bomb && !isDisabled(state, bomb)) { if (g.hp > TECH.BOMB_DMG) again(); return bomb; }
  if (fire && !isDisabled(state, fire) && partyFuelOf(state, p) - TECH.FIRE_FUEL >= fuelHome) { if (g.hp > TECH.FIRE_DMG) again(); return fire; }
  const fit = partyMembers(state, p).filter((s) => s.health >= 60);
  const f = growthForce(state, g); // the card shows the guard
  const ratio = squadPower(fit) / (f.count * (f.power / 5.2) * typeStrength({ count: f.count, types: f.types, elite: f.elite }));
  const ammo = (p.supplies.ammo || 0) + ((p.cargo && p.cargo.supplies && p.cargo.supplies.ammo) || 0);
  if (fit.length >= 3 && ammo >= fit.length * 8 && ratio >= P.hiveOdds) return find(/^Fight its guard/);
  return find(/^Back off/);
}
// After a fire that left the growth standing: the next fire (or the fight) while the team is still fit for it.
function growthAgain(state, p) {
  if (!p.apGrowthAgain) return false;
  delete p.apGrowthAgain;
  const g = growthAt(state, partyTile(p));
  if (!g || g.withered != null || partyMembers(state, p).filter((s) => s.health >= 50).length < 2) return false;
  if (!orderOptions(state, p).some((o) => o.mission === "growth" && !o.disabled)) return false;
  startOrder(state, p, { type: "mission", mission: "growth" });
  return true;
}

// ---------- conquest (conquest.js) ----------
// The coalition wins when every group still standing is in it: the groups that will never join (hostile ones) have
// to be broken. A squad of five or six of the best fighters (health 75+) storms a base when its combat power against
// the defenders behind their walls gives the style's conquerOdds (the odds the assault card shows):
// - every style takes back a base of yours a group holds (a little lower odds accepted: its walls are still broken
//   and every day it waits they are patched up);
// - Aggressive ("ready") goes for any hostile group from day 60; Balanced ("provoked") for hostile groups that
//   raided it in the last 120 days, and for any hostile group once every other group still standing is in the
//   coalition; Cautious ("last") only then, from day 240.
// The weakest base of a group first (fewest defenders, then nearest); a group's last base is worth more (it ends
// the group). At most one assault or hive squad out at a time, ASSAULT_REST days between assaults.
const ASSAULT_MIN = 5, ASSAULT_HEALTH = 75, ASSAULT_AMMO = 10;
const ASSAULT_REST = 12;
const controlledLandPct = (state) => goalsProgress(state).alliance.land.pct;
function conquestCandidate(state, home, pool) {
  const P = persona(state);
  const g = gov(state);
  const h = hub(state);
  const today = day(state);
  const urgent = hubRetake(state, home, pool);
  if (urgent) return urgent;
  if (today - (g.lastAssault ?? -99) < ASSAULT_REST) return null;
  if (home.length - HIVE_SQUAD < Math.max(HIVE_KEEP, Math.ceil(home.length * P.homeFrac * 0.6))) return null;
  const squad = [...pool].filter((s) => s.health >= ASSAULT_HEALTH && !s.woundInfected).sort((a, b) => combatPower(b) - combatPower(a) || a.id - b.id).slice(0, HIVE_SQUAD);
  if (squad.length < ASSAULT_MIN || (h.stock.ammo || 0) < squad.length * ASSAULT_AMMO + 30) return null;
  const power = squadValue(squad);
  const outsiders = state.factions.filter((f) => f.alive && !isMember(state, f));
  const onlyFoes = outsiders.length > 0 && outsiders.every((f) => attitude(f) === "Hostile");
  const late = P.lateConquer != null && isLate(state); // eras.js: the late game, the push to win
  const want = (f) => {
    // The late push: a group that will not join (goodwill below zero, not a member) is in the coalition's way too.
    if (late && f.goodwill < 0 && !isMember(state, f)) return today >= P.conquerFrom;
    if (attitude(f) !== "Hostile") return false;
    if (P.conquer === "ready" || late) return today >= P.conquerFrom;
    // The war council's foes (warCouncil: raided you, sit on the coalition's land or between the hub and the campaign's hive).
    if ((g.warFoes || []).includes(f.id) && today >= P.conquerFrom) return true;
    if (today < P.conquerFrom) return false;
    if (onlyFoes) return true;
    // Balanced: the coalition within reach (35%+ of the land): the hostile groups in its way are next.
    if (P.conquer === "provoked" && controlledLandPct(state) >= 0.35) return true;
    return P.conquer === "provoked" && f.raidedYou != null && today - f.raidedYou <= 120;
  };
  const lost = new Set(lostBases(state).map((o) => o.tile));
  let best = null;
  for (const [tile, f] of knownGroupBases(state)) {
    if (!f.alive || !f.bases.includes(tile)) continue;
    const retake = lost.has(tile);
    if (!retake && !want(f)) continue;
    const d = state.grid.distance(tile, h.tile);
    if (d > Math.max(20, P.range * 2.5)) continue;
    const force = assaultForce(state, f, tile);
    const odds = assaultOdds(power, force, true, squad.length);
    if (odds < (late ? Math.min(P.conquerOdds, P.lateConquer) : P.conquerOdds) - (retake ? 0.1 : 0)) continue;
    // One group at a time until it breaks: its main base (the leaders fall with it), the group it went for last, the
    // group with the fewest bases.
    const score = odds * 4 + (retake ? 3 : 0) + (f.bases.length === 1 ? 1.5 : 0) + (f.bases[0] === tile ? 1.2 : 0) + (g.conquestFocus === f.id ? 1.5 : 0) + ((g.warFoes || []).includes(f.id) ? 2 : 0) + 2 / f.bases.length - d / 10; // the war council's foes first
    if (!best || score > best.score) best = { tile, f, odds, score, retake, force };
  }
  for (const o of lostBases(state)) if (!knownGroupBases(state).has(o.tile)) {
    // A base of yours they hold is always known to you.
    const f = factionById(state, o.factionId);
    const force = assaultForce(state, f, o.tile);
    const odds = assaultOdds(power, force, true, squad.length);
    const d = state.grid.distance(o.tile, h.tile);
    if (odds < P.conquerOdds - 0.1 || d > Math.max(20, P.range * 2.5)) continue;
    const score = odds * 4 + 3 - d / 10;
    if (!best || score > best.score) best = { tile: o.tile, f, odds, score, retake: true, force };
  }
  if (!best) return null;
  return { mission: "assault", tile: best.tile, score: best.retake ? 6.5 : 5.5, crew: HIVE_SQUAD, assault: true,
    why: `${best.retake ? "take back" : `take ${best.f.name}'s base at`} ${tileLabel(state, best.tile)} (${Math.round(best.odds * 100)}% against ${best.force.count} defenders${best.f.bases.length === 1 && !best.retake ? ", their last base" : ""})`,
    supplies: { ammo: 60, meds: 4 } };
}
// The old hub in their hands (every style, at once): whoever is fit enough (health 50+, at least 3, two stay home)
// goes to take it back at 35%+ odds: its walls are at their weakest now, and the stores and the fields are there.
function hubRetake(state, home, pool) {
  const occ = lostBases(state).find((o) => o.wasHub);
  if (!occ || state.parties.some((p) => p.owner === "player" && p.mission === "assault" && p.dest === occ.tile)) return null;
  const f = factionById(state, occ.factionId);
  const squad = [...pool].filter((s) => s.health >= 50 && !s.woundInfected).sort((a, b) => combatPower(b) - combatPower(a) || a.id - b.id).slice(0, Math.min(HIVE_SQUAD, Math.max(0, home.length - 2)));
  if (!f || squad.length < 3) return null;
  const odds = assaultOdds(squadValue(squad), assaultForce(state, f, occ.tile), true, squad.length);
  if (odds < 0.35) return null;
  return { mission: "assault", tile: occ.tile, score: 9, crew: squad.length, assault: true, squadMin: 3, minHealth: 50,
    why: `take back ${occ.name}, the old hub (${Math.round(odds * 100)}% against ${assaultForce(state, f, occ.tile).count} defenders)`, supplies: { ammo: 40, meds: 2 } };
}
// The assault card: storm with the squad it has, if the odds still hold; else back off.
function assaultChoice(state, card, opts, p, find) {
  const P = persona(state);
  const f = card.assault ? factionById(state, card.assault.factionId) : null;
  if (!p || !f || !f.alive || !f.bases.includes(card.assault.tile)) return find(/^Back off/);
  const fit = partyMembers(state, p).filter((s) => s.health >= 50);
  const ammo = (p.supplies.ammo || 0) + ((p.cargo && p.cargo.supplies && p.cargo.supplies.ammo) || 0);
  const odds = teamAssaultOdds(state, p, assaultForce(state, f, card.assault.tile, p));
  const retake = !!occupiedAt(state, card.assault.tile);
  const exile = !hub(state);
  const oldHub = retake && occupiedAt(state, card.assault.tile).wasHub;
  const need = exile ? 0.4 : oldHub ? 0.33 : P.conquerOdds - (retake ? 0.15 : 0.08);
  if (fit.length >= (exile || oldHub ? 1 : ASSAULT_MIN - 1) && ammo >= fit.length * 4 && odds >= need) return find(/^Storm the base/);
  return find(/^Back off/);
}
// No base left (conquest.js exiles): take back the nearest base of yours they hold if the odds are fair (and no
// staging camp is well under way), else the staging camp like hardcore's first hub (roadAct).
function exileAct(state, p) {
  const g = state.grid;
  const here = partyTile(p);
  const camp = state.staging;
  const scrap = carried(p, "scrap") + (camp ? storeOf(camp, "scrap") : 0);
  const going = camp && stagingPct(camp) >= 0.3;
  const lost = lostBases(state).map((o) => ({ o, f: factionById(state, o.factionId) })).filter((x) => x.f && x.f.alive)
    .map((x) => ({ ...x, odds: teamAssaultOdds(state, p, assaultForce(state, x.f, x.o.tile, p)), d: g.distance(here, x.o.tile) })).sort((a, b) => b.odds - a.odds || a.d - b.d)[0];
  if (lost && (lost.odds >= (going ? 0.6 : 0.45) || (!going && scrap < stagingNeeds(state).scrap)) && lost.odds >= 0.2 && planPath(state, here, lost.o.tile, p.vehicle)) {
    if (here === lost.o.tile) { giveOrder(state, p, "assault"); return; }
    orderMove(state, p, lost.o.tile);
    p.orders = [{ type: "mission", mission: "assault" }];
    say(state, `${teamName(state, p)}: no base left, so it goes to take ${lost.o.name} back (${Math.round(lost.odds * 100)}%).`);
    return;
  }
  roadAct(state, p);
}

// ---------- the road with no base: the staging camp (staging.js) ----------
// Hardcore's first hub and the exiles' new one. The team pitches a staging camp at the best spot near it (hubSites:
// water, sites around, few of the dead) once it carries a share of the scrap or after a few days, then ferries
// what the camp lacks (searching nearby, pulled toward the camp), works on it while the materials allow, and
// rests, fetches water or eats on the way like any team on the road. It fetches water at a river when short and
// one is close, rests when someone is badly hurt.
// ROAD: reach = tiles it looks for sites in (wider when nothing is near); low = days of food or water that make
// them urgent; heal = health under which it camps; fetchExtra = water it fills beyond what it lacks; huntHours /
// huntMin = a hunt or fishing trip for food, and the rations it must promise.
// CAMP: pitchShare / pitchDay = when it pitches (a share of the scrap carried, or from this day); ferryShare = share
// of the missing scrap and parts carried that sends it back to the camp within ferryReach tiles; pull = how much
// farther sites from the camp count against them; workDays = days of work it brings food and water for; range =
// tiles from the camp it searches first. Short of food or water it goes back to the camp when the stores can spare
// some (staging.js provisionable).
const ROAD = { reach: 6, wide: 11, low: 2, heal: 40, foundReach: 4, fetchExtra: 4, campHours: 8, huntHours: 8, huntMin: 4, forageLow: 1 }; // forageLow: foraging.js (landFoodAct)
const CAMP = { pitchShare: 0.3, pitchDay: 3, ferryShare: 0.5, ferryReach: 6, pull: 0.15, workDays: 3, range: 7, waterReach: 9 }; // waterReach: camp sites by water (staging.js)
const roadDays = (state, p, k) => {
  const n = Math.max(1, partyMembers(state, p).length);
  const have = (x) => (p.supplies[x] || 0) + ((p.cargo && p.cargo.supplies[x]) || 0);
  return k === "water" ? teamWaterIn(p) / (n * thirstAt(state)) : (have("food") + have("preserved")) / (n * teamCold(state, p)); // food: the cold unless by a lit camp fire (needs.js)
};
// What the team should still gather: what the camp lacks (or the whole need with no camp yet) less what it carries,
// plus food and water to live on while it works there. { key: qty }.
function roadMissing(state, p) {
  const camp = state.staging;
  const needs = stagingNeeds(state);
  const n = Math.max(1, partyMembers(state, p).length);
  const days = camp ? Math.min(CAMP.workDays, daysFor(camp, n)) + 1 : CAMP.workDays + 1;
  const out = {};
  for (const k of ["scrap", "parts", "food", "water"]) {
    const have = (k === "water" ? teamWaterIn(p) : carried(p, k)) + (k === "food" ? carried(p, "preserved") : 0) + (camp ? storeOf(camp, k) : 0);
    const own = k === "food" ? n * days : k === "water" ? n * days * thirstAt(state) : 0;
    const want = (needs[k] || 0) + own;
    if (have < want - 0.5) out[k] = Math.ceil(want - have);
  }
  return out;
}
function roadNeeds(state, p) {
  const miss = roadMissing(state, p);
  const wLow = roadDays(state, p, "water") < ROAD.low, fLow = roadDays(state, p, "food") < ROAD.low;
  return {
    water: wLow ? 3 : miss.water ? 1.4 : 0.25, food: fLow ? 3 : miss.food ? 1.4 : 0.3, preserved: fLow ? 3 : miss.food ? 1.4 : 0.3,
    scrap: miss.scrap ? (wLow || fLow ? 0.8 : 2) : 0.1, parts: miss.parts ? (wLow || fLow ? 1 : 2.6) : 0.2,
    meds: 0.6, ammo: 0.5, fuel: 0.05, jars: 0,
  };
}
// The camp's part of the decision: pitch it, go back to it, unload and work there. True when the team was given
// an order.
function campAct(state, p) {
  const here = partyTile(p);
  const members = partyMembers(state, p);
  const camp = state.staging;
  if (!camp) {
    const needs = stagingNeeds(state);
    const ready = carried(p, "scrap") >= needs.scrap * CAMP.pitchShare || day(state) >= CAMP.pitchDay || !firstHubPending(state) || members.some((s) => s.health < 60);
    if (!ready) return false;
    const ok = (s) => !establishProblem(state, s.id) && (s.id === here || planPath(state, here, s.id, p.vehicle));
    let sites = hubSites(state, here, ROAD.foundReach).filter(ok);
    // No spring at a camp: with no spot beside water close by, look farther for one (CAMP.waterReach).
    if (!sites.length || sites[0].waterDist !== 1) { const wet = hubSites(state, here, CAMP.waterReach).filter((s) => s.waterDist === 1 && ok(s)); if (wet.length) sites = wet; }
    const best = sites[0];
    const atHere = sites.find((s) => s.id === here);
    if (!best) return false;
    if (best.id === here || (atHere && atHere.sc >= best.sc - 0.5)) {
      say(state, `${teamName(state, p)} pitches a staging camp at ${tileLabel(state, here)} for the ${firstHubPending(state) ? "first" : "new"} hub.`, "good");
      giveOrder(state, p, "establish");
      return true;
    }
    if (orderMove(state, p, best.id) && p.phase === "out") {
      p.orders = [{ type: "mission", mission: "establish" }];
      say(state, `${teamName(state, p)} heads for ${tileLabel(state, best.id)} to pitch a staging camp there.`, "good");
      return true;
    }
    return false;
  }
  const dep = depositable(state, p, camp);
  const prov = provisionable(state, p, camp);
  if (here === camp.tile) {
    if (!dep.length && !canWork(camp) && !prov.length) return false; // nothing to do here: it goes for what is missing
    // No spring at a camp (staging.js): away from a river or lake, a team under a day of water with the stores dry goes
    // for water first (roadAct: a shore or a site with water) instead of working itself thirsty.
    if (!besideWaterSource(state, camp.tile) && roadDays(state, p, "water") < 1 && storeOf(camp, "water") < partyMembers(state, p).length && !dep.some(([k]) => k === "water")) return false;
    giveOrder(state, p, "establish");
    return true;
  }
  // Thirsty and the camp has no water to give (no river beside it, dry stores): water first (roadAct), not the camp.
  if (roadDays(state, p, "water") < 1 && !besideWaterSource(state, camp.tile) && storeOf(camp, "water") < partyMembers(state, p).length) return false;
  const route = planPath(state, here, camp.tile, p.vehicle) || planPath(state, here, camp.tile, false);
  if (!route) return false;
  const dist = route.path.length - 1;
  // Short of food or water and the camp can spare some: back to it (it is nearer than a search, and safe).
  const low = (k) => roadDays(state, p, k) < ROAD.low && prov.some(([x, q]) => (k === "food" ? x !== "water" : x === "water") && q >= partyMembers(state, p).length / 2);
  if ((low("water") || low("food")) && dist <= CAMP.ferryReach) {
    if (orderMove(state, p, camp.tile) && p.phase === "out") {
      p.orders = [{ type: "mission", mission: "establish" }];
      say(state, `${teamName(state, p)} heads back to the staging camp for food and water.`);
      return true;
    }
  }
  const short = stagingMissing(camp);
  const brings = (k) => (dep.find(([x]) => x === k) || [, 0])[1] + (k === "food" ? (dep.find(([x]) => x === "preserved") || [, 0])[1] : 0);
  const covers = short.length > 0 && short.every((r) => brings(r.key) >= r.short);
  const mat = short.filter((r) => r.key === "scrap" || r.key === "parts");
  const matShort = mat.reduce((a, r) => a + r.short, 0);
  const share = matShort ? mat.reduce((a, r) => a + Math.min(brings(r.key), r.short), 0) / matShort : 0;
  const full = cargoRoom(state, p) < partyCapacity(state, p) * 0.15 && dep.length;
  const idle = canWork(camp) && !workerTeams(state).length; // materials there and nobody at work
  if (covers || (share >= CAMP.ferryShare && dist <= CAMP.ferryReach) || full || (idle && dist <= CAMP.ferryReach) || (!short.length && !workerTeams(state).length)) {
    if (orderMove(state, p, camp.tile) && p.phase === "out") {
      p.orders = [{ type: "mission", mission: "establish" }];
      say(state, `${teamName(state, p)} heads back to the staging camp${dep.length ? ` with ${dep.map(([k, q]) => `${q} ${keyWord(k)}`).join(", ")}` : " to work on it"}.`);
      return true;
    }
  }
  return false;
}
// Camping on badly infested land is a daily chance of the worm (worm.js WORM.CAMP_AT): a team that needs to rest
// first moves a tile or two to cleaner ground when there is some that close.
function campAt(state, p, hours) {
  const g = state.grid, here = partyTile(p);
  if ((state.tiles[here].infection || 0) >= WORM.CAMP_AT) {
    const ok = (id) => { const t = state.tiles[id]; return id !== here && (t.infection || 0) < WORM.CAMP_AT && (t.terrain !== "water" || t.bridge) && !t.hive; };
    const near = g.within(here, 2).filter(ok).sort((a, b) => g.distance(here, a) - g.distance(here, b) || state.tiles[a].infection - state.tiles[b].infection || a - b)[0];
    if (near != null && orderMove(state, p, near) && p.phase === "out") { p.orders = [{ type: "camp", hours }]; return; }
  }
  startOrder(state, p, { type: "camp", hours });
}
function roadAct(state, p) {
  const P = persona(state);
  const g = state.grid;
  const here = partyTile(p);
  const members = partyMembers(state, p);
  if (!members.length) return;
  delete p.haulCap; // a water run's limit (below) ends with it
  roadKit(state, p);
  const wDays = roadDays(state, p, "water"), fDays = roadDays(state, p, "food");
  // Badly hurt and fed: rest a while (at the camp the workers rest at night anyway).
  if (members.some((s) => s.health < ROAD.heal) && wDays >= 1 && fDays >= 1) {
    campAt(state, p, ROAD.campHours);
    return;
  }
  // Out of food (under half a day) and nothing at the staging camp to spare: food from the land before the camp's
  // business (landFoodAct, foraging.js).
  const campSpare = state.staging ? storeOf(state.staging, "food") + storeOf(state.staging, "preserved") : 0;
  if (fDays < LAND.critical && campSpare < members.length && landFoodAct(state, p, { urgent: true })) return;
  // The staging camp: pitch it, ferry to it, work on it.
  if (campAct(state, p)) return;
  if (!state.parties.includes(p) || p.phase !== "waiting") return;
  const camp = state.staging;
  // Short of water beside a river or lake: fill up (what the camp and the work need, plus a few days).
  const n = members.length;
  const miss = roadMissing(state, p);
  const haveWater = teamWaterIn(p); // both kinds (water.js)
  const wNeed = Math.max(miss.water || 0, wDays < ROAD.low + 1 ? n * (ROAD.low + 1) * thirstAt(state) - haveWater : 0);
  if (besideWater(state, here) && wNeed >= 3) {
    p.haulCap = Math.max(0, poolLoad(p)) + (wNeed + ROAD.fetchExtra) * SUPPLIES.water.weight;
    startOrder(state, p, { type: "water" });
    return;
  }
  // Short of food (for the camp or the road): hunt, fish or forage here or close by, when that is the main thing
  // missing or it would bring in a good haul (landFoodAct: hunting.js, foraging.js).
  // Foraging is slow food: with materials still to find it waits until food is down to a day (ROAD.forageLow; in
  // hardcore's sample, foraging under 2 days of food put the founding off by about two days).
  const free = !miss.scrap && !miss.parts;
  if (miss.food && landFoodAct(state, p, { urgent: fDays < ROAD.low, ok: (got, kind) => (kind === "forage" ? free || fDays < ROAD.forageLow : free || fDays < ROAD.low || got >= ROAD.huntMin * 2) })) return;
  // The best site to search: what the team lacks, by what it knows, nearer is better (and nearer the camp);
  // wider when nothing is close.
  const need = roadNeeds(state, p);
  const urgentWater = wDays < ROAD.low;
  const wantsWater = urgentWater || (miss.water || 0) >= 3;
  let best = null;
  // With a camp: first the sites within CAMP.range of it (the ferry stays local), then anywhere within reach.
  for (const [reach, near] of camp ? [[ROAD.wide, CAMP.range], [ROAD.wide, Infinity]] : [[ROAD.reach, Infinity], [ROAD.wide, Infinity]]) {
    for (const id of g.within(here, reach)) {
      const t = state.tiles[id];
      if (camp && g.distance(id, camp.tile) > near) continue;
      if (t.hive || g.within(id, 1).some((x) => state.tiles[x].hive)) continue;
      let value = 0;
      const s = siteScore(state, id, need, P);
      if (s && orderable(state, id)) value = s.value;
      // A riverbank when water is short (the team's or the camp's): a sure refill.
      if (wantsWater && besideWater(state, id)) value = Math.max(value, wDays < 1 ? 3 : urgentWater ? 1.8 : 1.2);
      if (value <= 0.05) continue;
      const res = id === here ? { cost: 0 } : planPath(state, here, id, false);
      if (!res) continue;
      const pull = camp ? 1 + CAMP.pull * Math.max(0, g.distance(id, camp.tile) - 3) : 1;
      const score = value / (1 + res.cost / 8) / pull;
      if (!best || score > best.score) best = { id, score, value, water: wantsWater && besideWater(state, id) && (!s || s.value < value) };
    }
    if (best) break;
  }
  const wantWater = haveWater + Math.max(4, wNeed);
  if (!best) {
    // Nothing known worth it: look farther around (a survey finds hidden places), or rest a night.
    if (!p.apRoadSurvey || state.hour - p.apRoadSurvey > 48) { p.apRoadSurvey = state.hour; startOrder(state, p, { type: "sweep", radius: 3, hours: 12 }); return; }
    campAt(state, p, ROAD.campHours);
    return;
  }
  if (best.id === here) {
    if (best.water) { p.haulCap = poolLoad(p) + Math.max(4, wantWater - haveWater) * SUPPLIES.water.weight; startOrder(state, p, { type: "water" }); return; }
    if (state.engagement) { startOrder(state, p, { type: "wait", hours: 2 }); return; }
    if (!orderOptions(state, p).some((o) => o.mission === "scavenge" && !o.disabled)) {
      // Picked clean (the team sees it now): remembered, and the next best site is chosen.
      gov(state).visited[here] = { day: day(state), hour: state.hour, loot: 0 };
      if ((p.apRoadRetry = (p.apRoadRetry || 0) + 1) <= 3) return roadAct(state, p);
      p.apRoadRetry = 0;
      campAt(state, p, 4);
      return;
    }
    p.apRoadRetry = 0;
    startOrder(state, p, { type: "mission", mission: "scavenge" });
    return;
  }
  const msg = orderMove(state, p, best.id);
  if (p.phase !== "out") { say(state, `${teamName(state, p)}: ${msg}`); startOrder(state, p, { type: "camp", hours: 4 }); return; }
  p.orders = [best.water ? { type: "water" } : { type: "mission", mission: "scavenge" }];
  if (best.water) p.haulCap = poolLoad(p) + Math.max(4, wantWater - haveWater) * SUPPLIES.water.weight; // fill only what it needs
}
// Before each decision on the road: found packs and weapons go on whoever has none (a pack carries more), and what
// the team carries beyond what the camp still lacks is left behind (spare parts, scrap, ammo, fuel and heavy
// oddments), so there is room for what it still needs. Supplies only: found items it keeps unless they are heavy and
// cheap.
const ROAD_KEEP = { parts: 2, scrap: 6, ammo: 80, fuel: 2, jars: 0 };
function roadKit(state, p) {
  const members = partyMembers(state, p);
  for (const it of [...p.cargo.gear]) {
    const slot = slotOf(it.key);
    const who = (slot === "backpack" || slot === "weapon") && members.find((s) => !s.gear[slot] && (slot !== "weapon" || gearEffect(s, it).usable));
    if (!who) continue;
    who.gear[slot] = it;
    p.cargo.gear.splice(p.cargo.gear.indexOf(it), 1);
  }
  const camp = state.staging;
  const need = stagingNeeds(state);
  const left = [];
  // Exiles keep what they carried out of their base (it is all they have); hardcore's few things are the road's.
  for (const [k, extra] of firstHubPending(state) ? Object.entries(ROAD_KEEP) : []) {
    const keep = Math.max(0, (need[k] || 0) - (camp ? camp.stores[k] || 0 : 0)) + extra;
    const over = Math.floor(carried(p, k) - keep);
    if (over <= 0) continue;
    const took = takeSupply(p, k, over);
    if (took >= 1) left.push(`${took} ${k}`);
  }
  const room = partyCapacity(state, p);
  if (poolLoad(p) > room * 0.7) {
    for (const it of [...p.cargo.gear].sort((a, b) => (GEAR[a.key]?.value || 0) / itemLoad(a) - (GEAR[b.key]?.value || 0) / itemLoad(b))) {
      if (poolLoad(p) <= room * 0.7) break;
      if (itemLoad(it) < 1.5 || (GEAR[it.key]?.value || 0) / itemLoad(it) >= 8) continue;
      p.cargo.gear.splice(p.cargo.gear.indexOf(it), 1);
      left.push(it.name.toLowerCase());
    }
  }
  if (left.length) say(state, `${teamName(state, p)} leaves behind what it does not need on the road: ${left.join(", ")}.`);
  weighTeam(state, p);
}
// Hardcore's first hub while it is small (four or fewer at home): trips take more of it (planTrip, launchTrip).
const smallHub = (state, home) => isHardcore(state) && home.length <= 4;
// A site the team can be ordered to search (not water, not a place a group holds).
const orderable = (state, id) => !missionProblem(state, id, "scavenge");

const captivesAt = (state, factionId) => allCaptives(state).filter((s) => s.location.factionId === factionId).length;

function needText(need, t) {
  const table = t.loc ? LOCATIONS[t.loc.type].loot : {};
  const top = Object.keys(table).filter((k) => need[k] >= 1).sort((a, b) => need[b] * table[b] - need[a] * table[a]).slice(0, 2);
  return top.length ? `the hub needs ${top.join(" and ")}` : "supplies";
}

// What a trade team can carry to sell: hub surplus of light, valuable goods.
function tradeGoods(state, need) {
  const h = hub(state);
  const n = Math.max(1, atBase(state, h.id).length);
  const goods = {};
  if (need.ammo <= 0.35 && (h.stock.ammo || 0) > n * 40 + 100) goods.ammo = Math.floor(Math.min(300, h.stock.ammo - n * 40));
  if (need.food <= 0.6 && (h.stock.food || 0) > n * 30) goods.food = Math.floor(Math.min(16, h.stock.food - n * 30));
  if (need.meds <= 0.3 && (h.stock.meds || 0) > n * 2 + 4) goods.meds = Math.floor(Math.min(6, h.stock.meds - n * 2));
  if (persona(state).reserves) {
    // Cautious: what is well above its reserve goes to market (parts, and food beyond the food planner's target).
    const rs = reserveStatus(state, h);
    if ((h.stock.parts || 0) > rs.parts.target + 4) goods.parts = Math.floor(Math.min(10, h.stock.parts - rs.parts.target - 2));
    const keepFood = n * (foodTarget(state, h) * 1.2 + 10);
    if (need.food <= 0.6 && (h.stock.food || 0) > keepFood + 10) goods.food = Math.floor(Math.min(40, h.stock.food - keepFood));
  }
  const value = Object.entries(goods).reduce((a, [k, q]) => a + q * SUPPLIES[k].value, 0);
  return value >= 50 ? goods : null;
}

// The alliance victory (alliance.js) needs over half the land held by you and the members. Once the coalition
// is settled (every group left in it, or only hostile ones outside) or the land at 35%+, from day 150, with 12+ people and the land short, the governor founds
// up to LAND_OUTPOSTS more outposts (LAND_OUTPOSTS_ALL_IN once every group left is in) where they add the most
// uncovered land (alliance.js controlRadius around each), away from hives and other groups' bases.
const LAND_OUTPOSTS = 3, LAND_OUTPOSTS_ALL_IN = 6, LAND_MIN_GAIN = 40, LAND_REACH = 16; // LAND_OUTPOSTS_ALL_IN: once every group left is a member, only land is missing
function landPush(state) {
  const gp = goalsProgress(state);
  // The coalition is its own way to win: once it has a member or a conquered base and the land is short.
  // Outposts out in the wild draw hordes: only once the groups are settled (every group left is in the coalition, or
  // the only ones outside are hostile and being broken) or the land is close (35%+).
  const settled = gp.alliance.allIn || (gp.alliance.members > 0 && gp.alliance.outsiders.every((o) => o.hostile)) || gp.alliance.land.pct >= 0.35;
  return settled && !gp.alliance.landOk && day(state) >= 150 && alive(state).length >= 12;
}
function landOutpostSite(state) {
  const h = hub(state);
  const g = state.grid;
  const R = controlRadius(state, "outpost");
  const held = new Uint8Array(state.tiles.length);
  for (const c of landCentres(state)) for (const id of g.within(c.tile, c.r)) held[id] = 1;
  const theirs = [...knownGroupBases(state).keys()];
  const hives = (state.hives || []).filter((hv) => knownHive(state, hv.tile)).map((hv) => hv.tile);
  let best = null;
  for (const id of g.within(h.tile, LAND_REACH)) {
    const t = state.tiles[id];
    if (held[id] || t.terrain === "water" || t.terrain === "mountain") continue;
    const k = intel(state, id);
    if (!k || (k.owner != null && k.owner !== "player") || k.factionBase || k.infection > 0.4 || k.hordeSize > 0) continue;
    if (theirs.some((b) => g.distance(b, id) <= 3) || hives.some((x) => g.distance(x, id) <= 6)) continue;
    const gain = g.within(id, R).filter((x) => !held[x] && state.tiles[x].terrain !== "water").length;
    if (gain < LAND_MIN_GAIN) continue;
    const score = gain - g.distance(id, h.tile) * 3 + (t.loc && t.loc.type === "farm" ? 10 : 0);
    if ((!best || score > best.score) && planPath(state, h.tile, id, false)) best = { id, gain, score };
  }
  return best;
}
function outpostSite(state) {
  const h = hub(state);
  const g = state.grid;
  const theirs = [...knownGroupBases(state).keys()]; // only bases you know about keep an outpost away
  let best = null;
  for (const id of g.within(h.tile, 7)) {
    const d = g.distance(id, h.tile);
    const t = state.tiles[id];
    if (d < 3 || t.terrain === "water" || t.terrain === "mountain") continue;
    if (state.bases.some((b) => g.distance(b.tile, id) < 3)) continue;
    const k = intel(state, id);
    if (!k || (k.owner != null && k.owner !== "player") || k.factionBase || k.infection > 0.3 || k.hordeSize > 0) continue;
    if (theirs.some((b) => g.distance(b, id) <= 6)) continue;
    if (!planPath(state, h.tile, id, false)) continue;
    const farm = t.loc && t.loc.type === "farm" ? 1.3 : t.terrain === "plains" ? 1.3 : t.terrain === "forest" ? 0.8 : t.terrain === "hills" ? 0.7 : 1;
    // Wood land within reach (woodcutting.js): the winter's firewood cut at the door, not hauled from afar.
    const woodLand = g.within(id, WOOD.base.radius).reduce((a, x) => a + woodAbundance(state, x), 0);
    const score = farm + (t.loc ? 0.5 : 0) + (t.road ? 0.4 : 0) + Math.min(0.4, woodLand * 0.08) - d * 0.05 - k.infection;
    if (!best || score > best.score) best = { id, score };
  }
  return best ? best.id : null;
}

// Pick the crew, a vehicle if it pays, pack supplies and send the team. Returns the party or null.
function launchTrip(state, c, pool, spareHands) {
  const P = persona(state);
  const h = c.from || hub(state); // c.from: a base leader's own base (stewardSupplies); the team leaves from and comes home to it
  const g = gov(state);
  const size = Math.min(c.crew, spareHands);
  if (size < (c.mission === "rescue" || c.mission === "growth" ? 3 : c.mission === "outpost" ? 2 : c.mission === "hive" ? HIVE_SQUAD : c.mission === "assault" ? c.squadMin || ASSAULT_MIN : c.squadMin || 1)) return null;
  const fit = c.fit ? c.fit : c.mission === "assault" ? (s) => (s.health >= (c.minHealth || ASSAULT_HEALTH) && !s.woundInfected ? combatPower(s) : -99) : c.mission === "hive" ? (s) => (s.health >= HIVE_HEALTH && !s.woundInfected ? stormValue(s) * 5 + skill(s, "stealth") * 0.05 : -99) : (s) => combatPower(s) + skill(s, "scavenging") * 0.25 + skill(s, "stealth") * 0.15 + skill(s, "scouting") * 0.15 +
    (c.mission === "trade" ? skill(s, "speech") * 0.5 : 0) + (c.mission === "rescue" ? skill(s, "stealth") * 0.3 + skill(s, "speech") * 0.2 : 0) +
    (c.mission === "outpost" ? skill(s, "farming") * 0.4 : 0) + (c.mission === "sweep" ? skill(s, "scouting") * 0.6 - (s.role === "build" || (s.task && (s.task.t === "build" || s.task.t === "craft")) ? 4 : 0) : 0) - (s.role === "medic" ? 3 : 0) - (s.role === "build" ? 1.5 : 0);
  const crew = friendlyCrew(state, [...pool].sort((a, b) => fit(b) - fit(a)), size, fit); // near-equal picks: friends together, rivals apart (relations.js)
  const ids = crew.map((s) => s.id);
  const dist = state.grid.distance(h.tile, c.tile);
  // A vehicle for longer trips if it can make the round trip.
  let v = null;
  const cand = carsAtBase(state, h.id).filter((x) => x.condition > 0).sort((a, b) => b.condition - a.condition)[0];
  // The vehicle is repaired and refuelled for the estimate; if the trip is called off, the parts and the fuel
  // go back (a trip that never leaves costs nothing). Armor left home for the trip goes back on too.
  const before = cand ? { condition: cand.condition, fuel: cand.fuel, parts: h.stock.parts, hubFuel: h.stock.fuel } : null;
  const stashed = []; // [survivor, armor] left at the hub for this trip
  const off = () => {
    if (before) { cand.condition = before.condition; cand.fuel = before.fuel; h.stock.parts = before.parts; h.stock.fuel = before.hubFuel; }
    for (const [s, a] of stashed) { const i = h.armory.indexOf(a); if (i >= 0 && !s.gear.armor) { h.armory.splice(i, 1); s.gear.armor = a; } }
    stashed.length = 0;
    return null;
  };
  const n = ids.length;
  if (cand && (dist >= 3 || (c.wood && dist >= 1)) && c.mission !== "outpost" && c.mission !== "rescue" && c.mission !== "sweep") { // a survey goes on foot or bikes (a car sees little off the road)
    if (cand.condition < 50 && (h.stock.parts || 0) >= 2 && canRepair(state, h).ok) repair(state, h, cand);
    const vEst = cand.condition >= 30 && estimateTrip(state, { memberIds: ids, dest: c.tile, vehicle: true, v: cand, stance: P.stance, homeBaseId: h.id, supplies: roughSupplies(n, 2) });
    if (vEst && vEst.fuel <= cand.fuel + Math.max(0, (h.stock.fuel || 0) - 4 - tripFuelHold(state, h, c))) v = cand; // needs-gauges: not the heating fuel, nor the campaign's fires
  }
  if (v) refuelKeeping(state, h, v, tripFuelHold(state, h, c)); // needs-gauges: the winter's heating fuel stays home (and the campaign's fires')
  // No car: bikes, one each, for anything past the next couple of tiles (no fuel, faster on roads, racks for the haul).
  if (!v && dist >= 2 && c.mission !== "outpost" && c.mission !== "rescue" && bikesAtBase(state, h.id) >= n) {
    const stack = parkBikes(state, h);
    if (stack && stack.condition >= 25) v = stack;
  }
  const plannedV = isBike(v) ? { ...v, count: n } : v;
  let onSite = c.onSite != null ? c.onSite : c.mission === "scavenge" ? P.searchHours + 4 + (P.reserves ? 2 : 0) : c.mission === "outpost" ? 0 : c.mission === "recon" ? P.searchHours + 8 : 4;
  let steps = c.steps;
  // The estimate with what the team would pack (its load sets its pace and rations, load.js).
  const tripOpts = (supplies) => ({ memberIds: ids, dest: c.tile, vehicle: travelMode(v), v: plannedV, stance: P.stance, homeBaseId: h.id, fuel: isCar(v) ? v.fuel + (h.stock.fuel || 0) : 0, supplies });
  let est = estimateTrip(state, tripOpts(roughSupplies(n, 2)));
  // No trip to a place with no way home over land (parties.js estimateTrip noWayBack): the team would wait there for
  // a boat order the governor never gives, and starve; the dead's gear there would draw the next team into the same trap.
  if (!est || est.noWayBack || est.hoursOut > (c.mission === "hive" || c.mission === "assault" || c.mission === "growth" ? 96 : P.maxHoursOut * (v ? 1.3 : 1) * (c.reach || 1))) return off();
  if (est.hours > 24 && severeSoon(state, 2)) return off(); // a long trip with a storm or blizzard forecast: wait it out
  // A wood trip cuts by daylight only (woodcutting.js woodTime): its Cut wood step runs from the arrival until it has had
  // WOOD.defHours of daylight (overnight on the spot when it gets there late). An 8-hour step begun at dusk cut in the dark
  // and brought home half the haul it was sent for (fix-wood-diplo: 3–7 firewood from trips planned at ~12–14).
  if (c.wood && steps) {
    const arrive = state.hour + Math.max(0, est.hoursOut || 0);
    let hours = 0, light = 0;
    while (light < WOOD.defHours - 1e-9 && hours < WOOD.maxHours) light += woodTime(arrive + ++hours);
    onSite = Math.max(WOOD.defHours, hours);
    steps = steps.map((x) => (x.kind === "wood" ? { ...x, hours: onSite } : x));
  }
  let days = (est.hours + onSite) / 24;
  // Cautious: no trip of more than half a day with a storm or blizzard forecast while it is out.
  if (P.reserves && est.hours > 12 && severeSoon(state, Math.ceil(days) + 1)) return off();
  // Water: both kinds, purified packed first (parties.js). Food: fresh and preserved (storage.js edibleFood), fresh
  // packed first: by late autumn the kitchen has turned the fresh food into the winter's preserved stores, and a hub
  // with 0 fresh and 1700 preserved called off every trip as one that "cannot spare" the food (seed 17: no
  // scavenging, no water hauls, no wells for 20 days while the water filters clogged up, then 21 dead of thirst).
  const stock = (k) => Math.floor(k === "water" ? waterIn(h.stock) : k === "food" ? edibleFood(h) : h.stock[k] || 0);
  const homeLeft = atBase(state, h.id).length - n;
  // A long search trip without a car: heavy body armor (7 kg and up) stays home while the team would leave Heavy.
  const looting = ["scavenge", "recon", "investigate", "recover", "getvehicle"].includes(c.mission) || !!c.haul;
  const worstBand = (e) => (e && e.load ? Math.max(-1, ...e.load.people.map((x) => x.band)) : -1);
  if (looting && !isCar(v) && est.hours > 24) {
    for (const s of [...crew].sort((a, b) => wornLoad(b) - wornLoad(a))) {
      if (worstBand(estimateTrip(state, tripOpts(roughSupplies(n, days)))) < 2) break;
      const a = s.gear.armor;
      if (a && (GEAR[a.key]?.weight || 0) >= 7) { s.gear.armor = null; h.armory.push(a); stashed.push([s, a]); }
    }
  }
  // On foot the team keeps its loot to a band (parties.js cargoRoom): Medium for the cautious, Heavy otherwise, so the
  // way home is not a crawl; the rations count the way back at that load.
  const haulBand = !v && looting ? (P.reserves ? 1 : 2) : null;
  const ration = (e) => {
    const cold = coldAhead(state, (e.hours + onSite) / 24); // the time on site and the heavier way home at the cold ahead (e.food has its own)
    let r = e.food + (n * onSite * cold) / 24; // the planner's rations (more on the move under a load, the cold) and the time on site
    if (haulBand != null) {
      const b = LOAD_BANDS[haulBand];
      const haulPace = (STANCES[P.stance]?.speed || 1) * (1 - b.slow);
      r += (n * e.hoursBack * cold * Math.max(0, ((e.pace.footSpeed || 1) / haulPace) * (1 + b.eat) - e.pace.eatFoot / Math.max(1, n))) / 24;
    }
    return r;
  };
  const sup = {
    food: 0, water: 0,
    ammo: Math.min(Math.max(0, stock("ammo") - 20), 15 * n),
    meds: stock("meds") >= 4 ? Math.min(2, Math.ceil(n / 2)) : 0,
    fuel: 0,
  };
  // The bows and crossbows shoot arrows in a fight (and on a hunt): a dozen each (world.js ARROWS.PACK), what the hub has.
  const archers = archerCount(crew);
  if (archers) sup.arrows = Math.min(stock("arrows"), archers * ARROWS.PACK);
  // Weighed twice: what the team packs changes its load, and so its pace and what it eats.
  for (let pass = 0; pass < 2; pass++) {
    const r = ration(est);
    sup.food = Math.ceil(r * 1.25) + 1 + (c.mission === "outpost" ? 6 : 0);
    sup.water = Math.ceil(r * 1.25 * thirstAhead(state, (est.hours + onSite) / 24)) + 1 + (c.mission === "outpost" ? 4 : 0); // summer, heat waves (weather.js)
    sup.fuel = isCar(v) ? Math.max(0, Math.min(stock("fuel") - tripFuelHold(state, h, c), Math.ceil(est.fuel * 1.25 - v.fuel))) : 0; // needs-gauges: not the heating fuel, nor the campaign's fires
    if (pass === 0) est = estimateTrip(state, tripOpts({ ...sup, ...(c.supplies || {}) })) || est;
  }
  days = (est.hours + onSite) / 24;
  for (const [k, q] of Object.entries(c.supplies || {})) if (q > 0) sup[k] = (sup[k] || 0) + q;
  if (P.reserves) {
    // Cautious: a farther trip packs a quarter more food and water; the ammo above the hub's reserve goes along
    // (at least 6 a head, never the hub's last 20).
    if ((c.reach || 1) > 1) { sup.food = Math.ceil(sup.food * 1.25); sup.water = Math.ceil(sup.water * 1.25); }
    sup.ammo = Math.min(sup.ammo, Math.max(6 * n, stock("ammo") - reserveStatus(state, h).ammo.target));
  }
  if (smallHub(state, atBase(state, h.id))) {
    // Hardcore's small first hub: a day for each left home, the team takes the rest and lives off what it finds (a
    // hungry hub that sends nobody out starves before its first harvest).
    for (const k of ["food", "water"]) sup[k] = Math.max(0, Math.min(sup[k], stock(k) - Math.max(0, homeLeft)));
  } else if (c.emergency) {
    // An emergency haul (emergencyTrips): the hub is already short of what the team goes for, so it takes what there
    // is for the walk (the haul brings back many times that) rather than staying home to share the last of it.
    for (const k of ["food", "water"]) sup[k] = Math.max(0, Math.min(sup[k], stock(k)));
  } else if (sup.food > stock("food") - Math.max(0, homeLeft) * 2 || sup.water > stock("water") - Math.max(0, homeLeft) * 2) {
    // A hunt or a fishing trip is how a hub short of food eats (seed 5092: 38 people, one hunt in 25 days while the
    // food ran out): it takes what is left after a day for each one home, as the small first hub does.
    if (c.food !== "huntTrips" && c.food !== "fishTrips") return off(); // the hub cannot spare it
    for (const k of ["food", "water"]) sup[k] = Math.max(0, Math.min(sup[k], stock(k) - Math.max(0, homeLeft)));
  }
  for (const k of Object.keys(sup)) sup[k] = Math.max(0, Math.min(sup[k], stock(k)));
  // The rations: fresh food first, preserved food for the rest (lighter, and the team eats it the same: parties.js).
  const freshFood = Math.floor(Math.max(0, h.stock.food || 0));
  if (sup.food > freshFood) { sup.preserved = Math.min(Math.floor(Math.max(0, h.stock.preserved || 0)), (sup.preserved || 0) + sup.food - freshFood); sup.food = freshFood; }
  // Too heavy: less ammo, then drop the extras down to what the job needs (an outpost needs 15 scrap).
  const cap = carryCapacity(state, crew, plannedV);
  if (supplyLoad(sup) > cap) sup.ammo = Math.min(sup.ammo, 5 * n);
  // Not Overloaded unless it has to be: on foot, less ammo before anyone leaves Overloaded.
  if (!v && worstBand(estimateTrip(state, tripOpts(sup))) >= 3) sup.ammo = Math.min(sup.ammo, 5 * n);
  for (const [k, q] of Object.entries(c.supplies || {})) {
    const over = supplyLoad(sup) - cap;
    if (over > 0) sup[k] = Math.max((c.min && c.min[k]) || 0, sup[k] - Math.ceil(over / SUPPLIES[k].weight));
  }
  if (supplyLoad(sup) > cap) return off();
  for (const [k, q] of Object.entries(c.min || {})) if ((sup[k] || 0) < q) return off();
  const kit = packTripKit(state, h, crew, c.mission, c.tile); // kit.js: camp kit against Heat, a comfort, throwables (a drill for gun safes)
  // A tube of purification tablets (worm.js packTablets) for a water haul or a trip of more than TABS_TRIP_DAYS: river
  // water fetched or un-purified water packed is drunk safe on the way without stopping to boil it.
  const tabs = armoryTabs(h).length > 0 && ((c.steps || []).some((x) => x.kind === "water") || days > TABS_TRIP_DAYS);
  const res = launchExpedition(state, { memberIds: ids, fromBaseId: h.id, dest: c.tile, mission: c.mission, stance: P.stance, vehicleId: v ? v.id : null, supplies: sup, sweep: c.sweep, tabs,
    plan: steps ? { preset: c.preset || "custom", steps: steps.map((x) => ({ ...x })), conditions: {} } : undefined }); // hunting and fishing trips: their steps (plans.js)
  if (res.error) return off();
  if (kit.length) say(state, `Kit for the trip: ${kit.join(", ")}.`);
  if (c.wood) { // woodcutting.js: the armory's axes go along for those without one
    const without = crew.filter((x) => !bestChop(x).item).length;
    for (let i = 0; i < without; i++) { const j = (h.armory || []).findIndex(isChopTool); if (j < 0) break; res.party.cargo.gear.push(h.armory.splice(j, 1)[0]); }
  }
  if (!isCar(v) && before) { cand.condition = before.condition; cand.fuel = before.fuel; h.stock.parts = before.parts; h.stock.fuel = before.hubFuel; } // repaired or looked at, but the car stayed
  res.party.ap = { mission: c.mission, tile: c.tile, day: day(state) };
  if (c.survey) surveySent(state);
  if (haulBand != null) res.party.haulCap = Math.max(poolAtBand(crew, haulBand), supplyLoad(sup) + 6 * n);
  if (isCar(v)) res.party.apFuelHome = Math.ceil((est.fuel / 2) * 1.2); // hiveChoice: fires never burn the fuel for the drive home
  if (c.fireTrip) res.party.apFireTrip = true; // the campaign's fire trip (hiveChoice fires, then home)
  if (c.emergency) res.party.apEmergency = true; // emergencyTrips: outside the style's team limit
  if (c.claim) res.party.apClaim = true; // claimCandidate: claims the tile on arrival (teamAct)
  if (c.well) res.party.apWell = true; // wellCandidate: digs a well on arrival (teamAct)
  if (c.haul || c.emergency) res.party.apHaulWatch = true; // trackHauls: what it brings home, for the Water / Food line
  if (c.mission === "hive") { g.stats.hiveTrips = (g.stats.hiveTrips || 0) + 1; if (g.campaign && g.campaign.tile === c.tile) g.campaign.trips++; if (c.fireTrip) g.stats.fireTrips = (g.stats.fireTrips || 0) + 1; else g.stats.stormTrips = (g.stats.stormTrips || 0) + 1; }
  if (c.mission === "assault") g.stats.assaultTrips = (g.stats.assaultTrips || 0) + 1;
  if (c.food) g.stats[c.food] = (g.stats[c.food] || 0) + 1; // huntTrips, fishTrips
  g.stats.launched++;
  if (c.mission === "outpost") g.stats.outposts++;
  say(state, `Sent ${names(crew)} (${c.food === "huntTrips" ? "hunt" : c.food === "fishTrips" ? "fish" : c.food === "woodTrips" ? "cut wood" : c.mission === "scavenge" ? "scavenge" : c.mission}) to ${tileLabel(state, c.tile)}${isBike(v) ? " on bikes" : v ? ` in the ${v.name}` : " on foot"}: ${c.why}. Back in about ${Math.ceil(days)} day${Math.ceil(days) === 1 ? "" : "s"}.${stashed.length ? ` Heavy armor left home for the walk: ${stashed.map(([x, a]) => `${first(x)}'s ${a.name}`).join(", ")}.` : ""}`);
  return res.party;
}

// ---------- food from the land (hunting.js) ----------
// Hunting and fishing trips when the winter stores fall short (winterShort), food is below the season's target
// (need 1.4+), or in autumn to stock up while game is fat (below 1.3 × the target): the best game land within range
// for the hub's best hunters (8 hours; snares set, or checked when it is our line, with wire or 2 scrap), and the
// best water when the hub has a rod or a net. Scored like a site: food need × the expected haul / 12 (up to 3), by
// distance, × 1.4 when the winter is short (× 1.15 in autumn). The haul is kept to a load band on foot (haulCap) and a
// car goes for 3+ tiles, as for scavenging: fresh game is heavy and spoils.
const huntFit = (s) => hunterMult(s) * (bestHuntWeapon(s) ? 3 : 0.3) + combatPower(s) * 0.1;
const fishFit = (s) => fisherMult(s) + combatPower(s) * 0.05;
// gov.noHunting: the test switch (hunttest.js) that leaves hunting and fishing out of the governor's plans.
// A target across a river is a long walk round to a bridge (seed 5092: game land 2 tiles from the hub, 25 tiles by the
// bridge, 60+ hours out): launchTrip refused it every morning while the near bank was never tried. Keep the targets a
// team can walk to in about the straight-line distance.
const walkable = (state, from, x) => { const p = planPath(state, from, x.tile, false); return !!p && p.path.length - 1 <= x.dist * 2 + 2; };
function foodTripCands(state, h, pool, need, P) {
  if (gov(state).noHunting) return [];
  const n = Math.max(1, atBase(state, h.id).length);
  const foodDays = edibleFood(h) / n;
  const season = wxSeason(state).key;
  const short = winterShort(state, h) > 0;
  if (!(short || need.food >= 1.4 || (season === "autumn" && foodDays < foodTarget(state, h) * 1.3))) return [];
  const boost = short ? 1.4 : season === "autumn" ? 1.15 : 1;
  const size = Math.min(3, Math.max(2, P.crew));
  const ammo = Math.max(0, (h.stock.ammo || 0) - 20);
  const out = [];
  const hunters = [...pool].sort((a, b) => huntFit(b) - huntFit(a) || a.id - b.id).slice(0, size);
  const arrows = huntArrowsFor(state, h, hunters); // the bows' arrows go along (plans.js applyPlan)
  if (hunters.some((s) => bestHuntWeapon(s, ammo, arrows))) {
    const wire = (h.armory || []).some((it) => it && it.key === "snarewire");
    const snareKit = wire || (h.stock.scrap || 0) >= 25;
    for (const x of huntTargets(state, h.tile, P.range, hunters, { ammo, arrows, mix: huntMixOf(h), hours: HUNT.defHours, limit: 8 }).filter((x) => walkable(state, h.tile, x)).slice(0, 3)) {
      if (x.est.rations < 8) continue;
      const line = snareLine(state, x.tile);
      const snare = line ? state.hour - (line.check ?? line.set) >= 48 : snareKit;
      out.push({ mission: "move", tile: x.tile, crew: size, fit: huntFit, haul: true, food: "huntTrips", onSite: HUNT.defHours + (snare ? 2 : 0),
        steps: [...(snare ? [{ kind: "snare" }] : []), { kind: "hunt", hours: HUNT.defHours }, { kind: "home" }],
        supplies: snare && !line && !wire ? { scrap: 2 } : undefined,
        score: (need.food * Math.min(3, x.est.rations / 12) * boost) / (1 + x.dist / 6),
        why: `hunt for food${short ? " (the winter stores fall short)" : season === "autumn" ? " (stocking up in autumn)" : ""}: ~${Math.round(x.est.rations)} expected` });
    }
  }
  const fishers = [...pool].sort((a, b) => fishFit(b) - fishFit(a) || a.id - b.id).slice(0, 2);
  if (hasFishingGear(h.armory) || fishKit(fishers).power) {
    for (const x of fishTargets(state, h.tile, P.range, fishers, h.armory || [], { hours: HUNT.defHours, limit: 6 }).filter((x) => walkable(state, h.tile, x)).slice(0, 2)) {
      if (x.est.rations < 5) continue;
      out.push({ mission: "move", tile: x.tile, crew: 2, fit: fishFit, haul: true, food: "fishTrips", onSite: HUNT.defHours,
        steps: [{ kind: "fish", hours: HUNT.defHours }, { kind: "home" }],
        score: (need.food * Math.min(2.5, x.est.rations / 10) * boost) / (1 + x.dist / 6),
        why: `fish for food${short ? " (the winter stores fall short)" : ""}: ~${Math.round(x.est.rations)} expected` });
    }
  }
  return out;
}

// ---------- hauling water (orders.js fetchWater, plans.js "water" step) ----------
// A big hub in a dry summer drinks more than its well, wells, stream and rain catchers make (economy.js
// waterProduction: about 30 a day at best, 17 in a dry spell, against 1.3-1.6 a head), and once the cisterns run dry
// everyone there loses health daily and the whole hub can die within a week or two (economy.js thirst). When the
// stock is under WATER_HAUL.days of the day's need and production falls short, a team goes to the nearest land tile
// beside a river or lake (within reach, never the hub's own tile) and fills every container it carries (1 kg a water,
// a 2-3 person team brings 60-150), then comes home. Scored above an ordinary scavenging trip, more the drier it is.
// (The haul's hours are orders.js FETCH_WATER_HOURS, read inside waterTripCands: orders.js can still be evaluating when
// this module loads, through the claims.js import cycle, so no import is read at module top level here.)
// A shore within `reach` tiles first; with none there, one within `far` (a hub in the forest 7 tiles from the
// nearest river had no haul at all, even at a day of water: seed 17), scored a little lower for each tile past reach.
const WATER_HAUL = { days: 3, reach: 6, far: 10, inland: 16, farCost: 0.3, crewMax: 3 };
function waterTripCands(state, h, pool, need, P, { maxTeams = null } = {}) {
  const want = waterNeed(state, h).total;
  if (want <= 0) return [];
  const prod = waterProduction(state, h).total;
  const days = waterIn(h.stock) / want;
  if (!(need.water >= 1.4 || (days < WATER_HAUL.days && prod < want))) return [];
  // One hauling team at a time; two while the shortfall is severe (under a day and a half in store, or the base
  // making under 60% of what it drinks: a 40-head hub in a heat wave drinks 60-70 against 17 made); the emergency
  // path (emergencyTrips) sets its own cap.
  const hauling = state.parties.filter((p) => p.owner === "player" && p.plan && p.plan.steps && p.plan.steps.some((s) => s.kind === "water")).length;
  const severe = days < 1.5 || prod < want * 0.6;
  if (hauling >= (maxTeams ?? (severe ? 2 : 1))) return [];
  // The nearest shore within the style's range; a hub with none that near (a well-only hub inland) looks out to
  // WATER_HAUL.inland while it is short: a long haul beats a dry well in a heat wave.
  const nearestShore = (r) => {
    let best = null;
    for (const id of state.grid.within(h.tile, r)) {
      if (id === h.tile || !besideWater(state, id)) continue;
      const d = state.grid.distance(id, h.tile);
      if (!best || d < best.d) best = { id, d };
    }
    return best;
  };
  const best = nearestShore(Math.min(P.range, WATER_HAUL.far)) || (days < WATER_HAUL.days ? nearestShore(WATER_HAUL.inland) : null);
  if (!best) return [];
  const size = Math.min(WATER_HAUL.crewMax, Math.max(2, P.crew));
  const shortBy = Math.max(0, want - prod);
  const far = Math.max(0, best.d - WATER_HAUL.reach);
  return [{ mission: "move", tile: best.id, crew: size, haul: true, onSite: FETCH_WATER_HOURS, steps: [{ kind: "water" }, { kind: "home" }], reach: far ? best.d / WATER_HAUL.reach : 1,
    score: Math.min(6, 2 + shortBy / 10 + (WATER_HAUL.days - Math.min(WATER_HAUL.days, days))) - far * WATER_HAUL.farCost,
    why: `haul water from ${tileLabel(state, best.id)} (${Math.floor(waterIn(h.stock))} in store, ${Math.round(want)} a day drunk, ${Math.round(prod)} made)` }];
}

// ---------- emergencies: water and food the hub cannot make (outside the style's team limit) ----------
// The census (docs/campaign-census-2026-10-06.md) had 40-head hubs die of thirst with both of the style's teams out:
// water hauling was an ordinary trip under planTrip's maxTeams and cooldown. Now, with under EMERGENCY.waterDays of
// water in store and the base making less than it drinks (or under EMERGENCY.foodDays of food), a haul goes out at
// the morning plan and again at EMERGENCY.hour whatever the limit and the cooldown: a water haul (waterTripCands,
// the Fetch water step), a hunt or fishing trip or the nearest known food site. Up to EMERGENCY.teams such teams
// out at once, people of EMERGENCY.minHealth, and HIVE_KEEP stay home at least. The team takes what food and water
// there is for the walk (launchTrip: the hub cannot "spare" it, but the haul brings back many times that).
const EMERGENCY = { waterDays: 1, foodDays: 2, teams: 2, hour: PLAN_HOUR + 8, minHealth: 50 };
function emergencyTrips(state) {
  const h = hub(state);
  if (!h || !state.autopilot) return;
  const line = emergencyAt(state, h);
  if (line) say(state, line, "danger");
}
// One base's emergency haul: the hub's for the autopilot, a led base's for its leader (stewardSupplies; keep: people
// who stay home whatever happens, the leader). Returns the line saying what went out, or "".
function emergencyAt(state, h, keep = new Set()) {
  const P = persona(state);
  if (wxNow(state).severe) return "";
  // A horde at the door the walls hold (one beaten off lingers a tile or two out for days) does not keep a thirsty or
  // starving hub's haul at home (seed 5054, large: 31 died of thirst with the shore 1 tile away); a raid on the way or
  // a horde that would break in still does.
  if (threatAt(state, h).urgent && !urgentHolds(state, h)) return "";
  const home = atBase(state, h.id);
  const want = waterNeed(state, h).total;
  const wDays = want > 0 ? waterIn(h.stock) / want : Infinity;
  const waterShort = wDays < EMERGENCY.waterDays && waterProduction(state, h).total < want;
  const fDays = edibleFood(h) / Math.max(1, foodUse(state, h).total);
  const foodShort = fDays < EMERGENCY.foodDays;
  if (!waterShort && !foodShort) return "";
  if (state.parties.filter((p) => p.owner === "player" && p.apEmergency && (p.homeBaseId ?? h.id) === h.id).length >= EMERGENCY.teams) return "";
  const g = gov(state);
  const pool = home.filter((s) => s.health >= EMERGENCY.minHealth && !s.woundInfected && !s.inBed && !s.pinned && !keep.has(s.id) && (!s.leader || home.length >= 6));
  const spare = Math.min(pool.length, home.length - HIVE_KEEP);
  if (spare < 2) return "";
  const need = needs(state, h);
  const cands = [];
  if (waterShort) cands.push(...waterTripCands(state, h, pool, need, P, { maxTeams: EMERGENCY.teams + 2 }).map((c) => ({ ...c, score: c.score + 10 })));
  if (foodShort) {
    cands.push(...foodTripCands(state, h, pool, need, P).map((c) => ({ ...c, score: c.score + 5 })));
    cands.push(...foodSiteCands(state, h, need, P));
  }
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands.slice(0, 6)) {
    const res = launchTrip(state, { ...c, from: h, emergency: true, reach: Math.max(c.reach || 1, 1.5) }, pool, spare);
    if (!res) continue;
    g.stats.emergencyTrips = (g.stats.emergencyTrips || 0) + 1;
    const teams = state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy").length;
    return `Emergency: ${h.name} has ${waterShort ? `${wDays.toFixed(1)} day${wDays === 1 ? "" : "s"} of water` : `${fDays.toFixed(1)} days of food`}: ${names(partyMembers(state, res))} went out for ${waterShort ? "water" : "food"} whatever the style's team limit (${teams} team${teams === 1 ? "" : "s"} out now).`;
  }
  return "";
}
// Known sites whose loot is mostly food (farms, groceries, lodges …), for an emergency food trip.
function foodSiteCands(state, h, need, P) {
  const out = [];
  for (const id of state.grid.within(h.tile, P.range + 6)) {
    const t = state.tiles[id];
    const def = t.loc ? LOCATIONS[t.loc.type] : null;
    if (!def || !def.loot || !((def.loot.food || 0) >= 2) || id === h.tile || !siteKnown(state, id)) continue;
    if (state.parties.some((p) => p.owner === "player" && (p.dest === id || (p.ap && p.ap.tile === id)))) continue;
    const s = siteScore(state, id, need, P);
    if (!s || s.loot < 0.15) continue;
    out.push({ mission: "scavenge", tile: id, crew: 3, score: 3 + (s.value * 2) / (1 + state.grid.distance(id, h.tile) / 8), why: `food for the hub (${needText(need, t)})`, reach: 1.5, loot: s.loot });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}
// The Water / Food ledger behind the morning line: what the haul teams brought home since the last line (trackHauls:
// a haul team's cargo is watched hour by hour and booked when the team is home) and what the radio deals bought.
function ledger(state) {
  const g = gov(state);
  if (!g.ledger) g.ledger = { water: { hauled: 0, traded: 0 }, food: { hauled: 0, traded: 0 } };
  return g.ledger;
}
function noteTrade(state, text) {
  const m = /(\d+) (water|food)\b/.exec(String(text || "")); // the good bought comes first in a deal's text
  if (m) ledger(state)[m[2]].traded += Number(m[1]);
}
function trackHauls(state) {
  const g = gov(state);
  const w = g.hauls || (g.hauls = {});
  const seen = new Set();
  for (const p of state.parties) {
    if (p.owner !== "player" || !p.apHaulWatch) continue;
    seen.add(String(p.id));
    const cs = (p.cargo && p.cargo.supplies) || {};
    w[p.id] = { water: Math.floor(waterIn(cs)), food: Math.floor((cs.food || 0) + (cs.preserved || 0)) };
  }
  for (const id of Object.keys(w)) if (!seen.has(id)) { const L = ledger(state); L.water.hauled += w[id].water; L.food.hauled += w[id].food; delete w[id]; }
}
// One line a morning while water (or food) is short: hauled, traded, made against drunk (eaten), and the store.
function supplyReport(state) {
  const h = hub(state);
  if (!h) return;
  const L = ledger(state);
  const want = waterNeed(state, h).total, prod = waterProduction(state, h).total;
  const wDays = want > 0 ? waterIn(h.stock) / want : Infinity;
  const eat = foodUse(state, h).total;
  const fDays = edibleFood(h) / Math.max(1, eat);
  if (wDays < WATER_HAUL.days || (prod < want && waterPlan(state, h).short)) say(state, `Water: hauled ${L.water.hauled}, traded ${L.water.traded}, made ${Math.round(prod)} against ${Math.round(want)} drunk; ${Math.floor(waterIn(h.stock))} in store (${wDays.toFixed(1)} days).`, wDays < 1 ? "danger" : "info");
  if (fDays < Math.max(4, foodTarget(state, h) * 0.3)) say(state, `Food: hauled ${L.food.hauled}, traded ${L.food.traded}; ${Math.floor(edibleFood(h))} in store against ${Math.round(eat)} eaten a day (${fDays.toFixed(1)} days).`, fDays < 2 ? "danger" : "info");
  gov(state).ledger = null;
}

// ---------- land claims (claims.js) ----------
// The coalition wins on members and land (alliance.js LAND_NEEDED): while the land is short the governor sends two
// people to claim the best tile it can (claims.js canClaim: land, not a base or a hive, adjacent to a tile you own)
// toward the nearest contested ground (other groups' known bases, known hives), one claim trip at a time, with the
// 3 scrap for the marker post when the hub can spare it; while the water is short it prefers a tile beside water next
// to the hub, where a well can follow (wellCandidate: 15 scrap and a part, the "Dig a well" order, 24 hours).
const CLAIM = { reach: 12, scrap: 3, scrapKeep: 10, wellScrap: 15, wellParts: 1, score: 2.8, wellScore: 3.2 };
function contestedGround(state) {
  const tiles = [...knownGroupBases(state).keys()];
  for (const hv of state.hives || []) if (knownHive(state, hv.tile)) tiles.push(hv.tile);
  return tiles;
}
const claimTripOut = (state) => state.parties.some((p) => p.owner === "player" && (p.apClaim || p.apWell));
function claimCandidate(state, h, spareHands, need = null) {
  if (!claimsReady() || spareHands < 2 || claimTripOut(state)) return null;
  if (need && (need.food >= 2 || need.water >= 2)) return null; // land can wait while the hub is short (seeds 5059, 5099: 2 of 4 out claiming with 0-2 days of food)
  const gp = goalsProgress(state);
  if (gp.alliance.landOk) return null;
  if ((h.stock.scrap || 0) - waterHold(state, h) < CLAIM.scrap + CLAIM.scrapKeep) return null;
  const g = state.grid;
  const contested = contestedGround(state);
  const dry = waterRunWanted(state, h) || waterPlan(state, h).short;
  let best = null;
  for (const id of g.within(h.tile, CLAIM.reach)) {
    if (CL.canClaim(state, id)) continue; // "" = it can be claimed
    const d = contested.length ? Math.min(...contested.map((t) => g.distance(t, id))) : 0;
    const score = -d - g.distance(id, h.tile) * 0.3 + (dry && besideWater(state, id) && g.distance(id, h.tile) === 1 ? 4 : 0) + (state.tiles[id].terrain === "farmland" ? 0.5 : 0);
    if ((!best || score > best.score) && planPath(state, h.tile, id, false)) best = { id, score, d };
  }
  if (!best) return null;
  return { mission: "move", tile: best.id, crew: 2, claim: true, score: CLAIM.score, onSite: 2, supplies: { scrap: CLAIM.scrap }, min: { scrap: CLAIM.scrap },
    why: `claim ${tileLabel(state, best.id)} for the coalition's land (${Math.round(gp.alliance.land.pct * 100)}% held${contested.length ? `, ${best.d} tiles from contested ground` : ""})` };
}
function wellCandidate(state, h, spareHands) {
  if (!claimsReady() || typeof CL.playerClaims !== "function" || spareHands < 2 || claimTripOut(state)) return null;
  if (!(waterRunWanted(state, h) || waterPlan(state, h).short)) return null;
  if ((h.stock.scrap || 0) - waterHold(state, h) < CLAIM.wellScrap + CLAIM.scrapKeep || (h.stock.parts || 0) < CLAIM.wellParts + 1) return null;
  const claims = state.claims || {};
  const g = state.grid;
  let best = null;
  for (const id of CL.playerClaims(state)) {
    const cl = claims[id];
    if (!cl || cl.well || g.distance(id, h.tile) !== 1 || state.tiles[id].terrain === "mountain") continue;
    if (typeof CL.wellProblem === "function" && CL.wellProblem(state, null, id)) continue; // the ground, a well there already
    const score = (typeof CL.wellYield === "function" ? CL.wellYield(state, id) : besideWater(state, id) ? 3 : 1) + (state.tiles[id].terrain === "farmland" ? 1 : 0);
    if (!best || score > best.score) best = { id, score };
  }
  if (!best) return null;
  return { mission: "move", tile: best.id, crew: 2, well: true, score: CLAIM.wellScore, onSite: 24, supplies: { scrap: CLAIM.wellScrap, parts: CLAIM.wellParts }, min: { scrap: CLAIM.wellScrap, parts: CLAIM.wellParts },
    why: `dig a well on the claim at ${tileLabel(state, best.id)} (${h.name}'s water falls short)` };
}
// A claim or well trip at its tile (teamAct): the claim is made (claims.js claimTile) or the well order given; a task
// that started brings the team back to teamAct when it is done, and it goes home then. Returns true while busy.
function claimAct(state, p) {
  if (!(p.apClaim || p.apWell) || !p.ap || partyTile(p) !== p.ap.tile || p.apClaimDone) return false;
  p.apClaimDone = true;
  const tile = partyTile(p);
  const g = gov(state);
  if (p.apClaim) {
    const why = claimsReady() ? CL.canClaim(state, tile) : "claims are not in the game yet";
    if (why) { say(state, `${teamName(state, p)} cannot claim ${tileLabel(state, tile)}: ${why}`); return false; }
    const r = startOrder(state, p, { type: CLAIM_ORDER }); // 2 hours on the tile; the post goes up when the task ends (orders.js finishTask → claims.js claimTile)
    if (p.phase === "waiting") { say(state, `${teamName(state, p)}: no claim at ${tileLabel(state, tile)} (${r || "the order is not known"}).`); return false; }
    g.stats.claims = (g.stats.claims || 0) + 1;
    say(state, `${teamName(state, p)} claims ${tileLabel(state, tile)} for the coalition's land.`);
    return true;
  }
  const why = typeof CL.wellProblem === "function" ? CL.wellProblem(state, p, tile) : "";
  if (why) { say(state, `${teamName(state, p)}: no well at ${tileLabel(state, tile)}: ${why}`); return false; }
  const r = startOrder(state, p, { type: WELL_ORDER });
  if (p.phase === "waiting") { say(state, `${teamName(state, p)}: no well dug at ${tileLabel(state, tile)} (${r || "the order is not known"}).`); return false; }
  g.stats.wells = (g.stats.wells || 0) + 1;
  say(state, `${teamName(state, p)} digs a well on the claim at ${tileLabel(state, tile)} (${CL.wellYield ? `about ${CL.wellYield(state, tile)} water a day` : "24 hours"}).`);
  return true;
}

// ---------- wild food and the land when food runs low (foraging.js, hunting.js) ----------
// A base with food down to FORAGE_AP.critical days a head puts a forager or two to work before the builders and
// stations (one, two at 6+ people), and under FORAGE_AP.low days the hands left over forage instead of picking through
// the ruins (as many as the food gap wants: foraging.js forageWorkCap), while a forager would bring in at least FORAGE_AP.minDay a day (not in winter).
// gov.noForaging: the test switch (foragetest.js) that leaves foraging out of the governor's plans.
const FORAGE_AP = { low: 12, critical: 4, minDay: 0.5 };
// The land's hunters and fishers ahead of the farm (planRoles 2b): at most this share of the people (at least one).
const LAND_AP = { share: 0.2 };
function planForage(state, base, people, foodDays, areas) {
  // Days of food for everyone fed here (upkeep.js: prisoners, guests, a holding convoy's crew too).
  foodDays = Math.min(foodDays, edibleFood(base) / Math.max(1, foodUse(state, base).total));
  if (!areas.food || gov(state).noForaging || foodDays >= FORAGE_AP.low || forageWorkWhy(state, base)) return null;
  if (baseForageDay(state, base) < FORAGE_AP.minDay) return null;
  const small = people.length <= 4; // a tiny hub (hardcore's first): the leader picks berries too
  return {
    cap: forageWorkCap(state, base, FORAGE_AP.low), // tune-jobcaps: sized to the need (the food gap to FORAGE_AP.low days), no fixed cap (it was 3, 4 at 12+)
    critical: foodDays < FORAGE_AP.critical ? (people.length >= 6 ? 2 : 1) : 0,
    fit: (x) => !x.inBed && (small || !x.leader) && (x.health ?? 100) >= 40 && !x.woundInfected,
  };
}
// ---------- firewood for the winter (woodcutting.js) ----------
// From late summer (woodSeason) a base whose woodpile is short of what the coming cold needs (woodNeed: everyone fed
// there and the teams coming home, woodFor(HEAT.fuel) a head a freezing day, a fifth to spare, and the boiler's days) works out how many woodcutters it
// takes to have it in by the winter (the shortfall over what one brings in a day here × the days left, at least
// WOOD_AP.minDays): from autumn (the winter within WOOD_AP.autumn days, or here) that many go before the builders and
// stations (step 4a; at most the job's cap and a quarter of the people, one at a base of 3 or fewer), in late summer
// one; and the spare hands cut wood too (step 10, up to the cap) until it is stocked. Only where the land around gives
// a woodcutter at least WOOD.worth a day; the best woodcutters with axes first. gov.noWood: the test switch
// (woodtest.js, the balance runs) that leaves it out.
export const WOOD_AP = { autumn: 28, minDays: 5, behind: 0.5 };
// tune-jobcaps: the Cut wood job has no fixed cap (it was 2, 3 at 10+ people). The woodcutters it takes to have the pile
// in by the cold (and keep up with the boiler) go ahead of the builders and stations up to a quarter of the people
// (woodCrewMax: the governor's order of work; a third while the pile is under WOOD_AP.behind of what the cold needs:
// the quarter was set when a freezing day took 0.6 kg of firewood a head, before tune-winter (HEAT.wood) made it
// 2.5 times that and the boiler burned firewood daily, and a big hub on farmland then met the winter with its pile a
// third in: woodtest seed 42, 400 kg of 1,060); the spare hands cut toward having it in within three weeks
// (woodcutting.js woodHandsWanted), each one past the first a little less (woodCrowd).
const woodCuttersFor = (state, base, w) => woodHandsWanted(state, base, { w, days: Math.max(WOOD_AP.minDays, w.toCold) });
const woodCrewMax = (n, w = null) => (n <= 3 ? 1 : Math.ceil(n / (w && w.have < w.need * WOOD_AP.behind ? 3 : 4)));
const crewDays = (k) => Array.from({ length: Math.max(0, k) }, (_, i) => woodCrowd(i)).reduce((a, v) => a + v, 0); // k woodcutters' day in woodcutters (woodCrowd)
// The woodcutters that go ahead of the builders and stations (planWood's critical, work.js's emergency): from autumn
// (the cold within WOOD_AP.autumn days, or here, or the boiler burning wood) the crew it takes to have the pile in by
// the cold, at most woodCrewMax; in late summer what the summer must cut so that the autumn's full crew can finish it
// (at least one, at most that crew; it was one, whatever the need). n: the people here.
export function woodCritical(state, base, w, n) {
  const want = woodCuttersFor(state, base, w);
  if (n <= 3) return Math.min(1, want);
  const full = Math.min(want, woodCrewMax(n, w));
  if (w.cold || w.toCold <= WOOD_AP.autumn || w.boiler > 0) return full;
  const each = baseWoodDay(state, base);
  const left = Math.max(0, w.need - w.have - each * crewDays(full) * WOOD_AP.autumn); // what the autumn's crew will not cut
  return Math.min(full, Math.max(1, handsForDay(left / Math.max(1, w.toCold - WOOD_AP.autumn), each, woodCrowd)));
}
function planWood(state, base, people, areas) {
  if (!areas.production || gov(state).noWood || base.tier === 0 || woodWorkWhy(state, base)) return null;
  const w = woodNeed(state, base, base.type === "hub" ? returning(state, base) : 0);
  if (!w.short || !w.soon || w.need <= 0) return null;
  const cap = woodHandsWanted(state, base, { w }); // the spare hands' crew: the pile in within three weeks
  // The water boiler (worm.js) burns its firewood every day: enough woodcutters to keep up with it, on top of the winter's.
  const want = woodCuttersFor(state, base, w);
  const small = people.length <= 3; // a tiny hub (hardcore's first): the leader cuts wood too
  return {
    cap,
    critical: Math.min(want, woodCritical(state, base, w, people.length)),
    stock: true,
    fit: (x) => !x.inBed && (small || !x.leader) && (x.health ?? 100) >= 50 && !x.woundInfected,
    score: (x) => woodcutterMult(x) * bestChop(x).mult,
  };
}
// Woodcutting trips (planTrip) when the hub's woodpile is short and the cold is within a month (or here) and the
// land around the hub gives little (a woodcutter there under 75 a day): the best wood land within range that a team
// of 2–3 with the hub's axes would bring the most from in 8 hours (by a car when there is one: firewood is bulky),
// scored by the share of the shortfall it covers. The trip takes the armory's cutting tools along.
// When the Cut wood job's crew (woodCrewMax × a woodcutter's day here × the days to the cold) cannot have the
// pile in by the winter (a big hub on farmland: three cutters bring in 60 a day against 3,000+ wanted), the trips are
// the only way to stock it, and by the share alone every trip scored under routine scavenging (0.3 against 0.8) and
// none was ever sent: then the score rises with the share of the shortfall the job will leave (WOOD_TRIP.gapScore
// at most, as a cache or a trade), and they start as soon as the stocking season does.
export const WOOD_TRIP = { gapScore: 1.8, gapFloor: 1.0 };
function woodTripCands(state, h, pool, P) {
  if (gov(state).noWood || !h || h.tier === 0) return [];
  const w = woodNeed(state, h, returning(state, h));
  if (!w.short || !w.soon || w.have >= w.need * 0.7) return [];
  if (!woodWorkWhy(state, h) && baseWoodDay(state, h) >= 75) return [];
  const shortfall = Math.max(300, w.need - w.have);
  // What the base's own woodcutters (at the job's cap) will still bring in before the cold, and the gap they leave.
  // (no fixed cap since tune-jobcaps: the crew the governor puts on it ahead of other work, woodCrewMax, each past the first a little less)
  // The crew it actually fields (woodCritical): the late summer's until the cold is within WOOD_AP.autumn days, the
  // full crew after (it counted the full crew from late summer on).
  const nHere = atBase(state, h.id).length, wantHands = woodCuttersFor(state, h, w);
  const full = crewDays(nHere <= 3 ? Math.min(1, wantHands) : Math.min(wantHands, woodCrewMax(nHere, w)));
  const lone = crewDays(woodCritical(state, h, w, nHere));
  const early = Math.max(0, w.toCold - WOOD_AP.autumn), late = Math.max(0, Math.min(w.toCold, WOOD_AP.autumn));
  const own = woodWorkWhy(state, h) ? 0 : baseWoodDay(state, h) * (lone * early + full * late);
  const gap = Math.max(0, w.need - w.have - own) / shortfall; // 0: the job will manage .. 1: none of it
  if (w.toCold > WOOD_AP.autumn && gap <= 0) return [];
  const crew = [...pool].sort((a, b) => woodcutterMult(b) * bestChop(b).mult - woodcutterMult(a) * bestChop(a).mult || a.id - b.id).slice(0, 3);
  if (crew.length < 2) return [];
  const tools = (h.armory || []).filter(isChopTool);
  const power = chopPower(chopCrew(crew, tools));
  const out = [];
  for (const id of state.grid.within(h.tile, Math.min(P.range, 8))) {
    if (id === h.tile || woodAbundance(state, id) * woodLevel(state, id) < 0.45) continue;
    const t = state.tiles[id];
    if (t.hive || (state.hives && zombieToughness(state, id) >= 2)) continue;
    if (state.parties.some((p) => p.owner === "player" && (p.dest === id || (p.ap && p.ap.tile === id)))) continue;
    const e = expectWood(state, crew, id, WOOD.defHours, state.hour + 24, Infinity, power);
    if (e.all < 240) continue;
    const dist = state.grid.distance(h.tile, id);
    out.push({ mission: "move", tile: id, crew: crew.length, fit: (s) => woodcutterMult(s) * bestChop(s).mult + combatPower(s) * 0.05, haul: true, wood: true, food: "woodTrips", onSite: WOOD.defHours,
      steps: [{ kind: "wood", hours: WOOD.defHours }, { kind: "home" }],
      score: Math.max((1.2 + (w.cold ? 0.6 : 0)) * Math.min(1.5, e.all / shortfall * 2), gap > 0 ? WOOD_TRIP.gapFloor + (WOOD_TRIP.gapScore - WOOD_TRIP.gapFloor) * gap + (w.cold ? 0.6 : 0) : 0) / (1 + dist / 6),
      why: `firewood for the winter (${Math.floor(w.have)} of ${w.need}${gap > 0 ? ", more than the woodcutters here can cut by the cold" : ""}): ~${Math.round(e.all)} to cut` });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 2);
}

// A team short of food in the field: hunt, fish or forage on its tile or one close by (landFoodOptions: the haul of
// LAND.hours there, by food an hour with the walk), when the best promises LAND.min rations (a third more to be worth
// a walk). urgent (under a day or two of food): it looks two tiles out, else one. ok(rations, kind): the caller's own test.
// LAND.tries: food stops a team on its way home makes at most.
// urgentMin: with food down to a day or two any real gain will do: 1.5 × what the team eats meanwhile (at least 1.5).
// critical: days of food under which the road team (no base) goes for food from the land before the staging camp's
// business, unless the camp has food to spare.
const LAND = { hours: 8, min: 4, urgentMin: 1.5, walkMore: 1.3, tries: 4, critical: 0.5 };
const foodDaysOf = (state, p) => {
  const n = partyMembers(state, p).length;
  const have = (k) => (p.supplies[k] || 0) + ((p.cargo && p.cargo.supplies[k]) || 0);
  return (have("food") + have("preserved")) / (Math.max(1, n ? partyPace(state, p).eatMove : 1) * foodNeedFactor(state)); // on the move: today's cold (weather.js)
};
function landFoodAct(state, p, { urgent = false, ok = () => true } = {}) {
  if (gov(state).noForaging && gov(state).noHunting) return false;
  const here = partyTile(p);
  const kinds = [...(gov(state).noForaging ? [] : ["forage"]), ...(gov(state).noHunting ? [] : ["hunt", "fish"])];
  const n = partyMembers(state, p).length;
  const min = (o) => (urgent ? Math.max(LAND.urgentMin, (n * (o.hours + o.travel) / 24) * LAND.urgentMin) : LAND.min * (o.tile === here ? 1 : LAND.walkMore));
  const best = landFoodOptions(state, p, { range: urgent ? 2 : 1, hours: LAND.hours, kinds }).find((o) => o.rations >= min(o) && ok(o.rations, o.kind));
  if (!best) return false;
  const order = { type: best.kind, hours: LAND.hours };
  const what = best.kind === "forage" ? "forage" : best.kind;
  if (best.tile === here) startOrder(state, p, order);
  else {
    orderMove(state, p, best.tile);
    if (p.phase !== "out" || p.dest !== best.tile) return false;
    p.orders = [{ ...order, at: best.tile }];
  }
  const g = gov(state);
  const k = best.kind === "forage" ? "forageOrders" : best.kind === "hunt" ? "landHunts" : "landFish";
  g.stats[k] = (g.stats[k] || 0) + 1;
  say(state, `${teamName(state, p)} is short of food: it goes to ${what} ${best.tile === here ? "here" : `${best.dist === 1 ? "a tile" : `${best.dist} tiles`} to the ${best.dir}`} (${best.terrain}, about ${Math.round(best.rations)} food in ${LAND.hours}h).`);
  return true;
}

// Food and water for a first estimate: n people for `days` with a quarter more, and some ammo (load.js weighs it).
const roughSupplies = (n, days) => ({ food: Math.ceil(n * days * 1.25) + 1, water: Math.ceil(n * days * 1.25) + 1, ammo: 10 * n });

// ---------- supply runs to outposts ----------
function tidySupplyJobs(state) {
  for (const job of [...supplyRuns(state)]) {
    if (job.apMade && !jobParty(state, job) && (job.status === "done" || job.status === "disbanded")) deleteSupplyRun(state, job);
  }
}

// An outpost about to run dry: under 5 days of water at today's rate, or under 3 a head with the spring not keeping up.
// Late spring and summer too: an outpost whose spring will not carry the summer (waterPlan) is topped up to its
// summer reserve before it runs short.
function outpostThirsty(state, o) {
  const wo = waterOutlook(state, o);
  const staff = atBase(state, o.id).length;
  const wp = waterPlan(state, o);
  return (wo.net < 0.5 && (wo.daysLeft < 5 || waterIn(o.stock) < staff * 3)) || (staff > 0 && wp.near && wp.short && waterIn(o.stock) < wp.reserve * 0.6);
}
// Water runs from a river or lake (orders.js Fetch water): while the hub's water is short (waterRunWanted) and a shore
// is within WATER_RUN_HOURS on foot, two to four people walk there, fill every container (up to a Heavy load each)
// and walk home. One at a time; the shore is found once (the map does not change).
// (16 hours until seed 17's forest hub, 19 hours from the nearest shore, had no water run at all; the shores found
// are kept with the hours they were found for, so a save from before looks again.)
const WATER_RUN_HOURS = 24;
function shoreFor(state, base) {
  const g = gov(state);
  if (g.shoresHours !== WATER_RUN_HOURS) { g.shores = {}; g.shoresHours = WATER_RUN_HOURS; }
  g.shores = g.shores || {};
  if (g.shores[base.id] !== undefined) return g.shores[base.id];
  let best = null;
  for (const t of state.tiles) {
    const d = state.grid.distance(base.tile, t.id);
    if (d > 10 || (best && d > best.d + 3) || !besideWater(state, t.id)) continue;
    const r = planPath(state, base.tile, t.id, false);
    if (r && r.cost <= WATER_RUN_HOURS && (!best || r.cost < best.cost)) best = { tile: t.id, cost: r.cost, d };
  }
  g.shores[base.id] = best ? best.tile : null;
  return g.shores[base.id];
}
function planWaterRun(state) {
  const h = hub(state);
  if (!h || !waterRunWanted(state, h) || state.parties.some((p) => p.owner === "player" && p.apWater)) return;
  const shore = shoreFor(state, h);
  if (shore == null || shore === h.tile) return;
  const home = atBase(state, h.id);
  // A shelter (no well of its own) sends whoever it can spare, one at least (a lone carrier beats thirst).
  const shelter = isShelter(h);
  const spare = home.length - (shelter ? 1 : Math.max(2, Math.ceil(home.length * persona(state).homeFrac)));
  const crew = home.filter((s) => s.health >= (shelter ? 50 : 70) && (!s.leader || shelter) && !s.inBed && !s.woundInfected).sort((a, b) => a.id - b.id).slice(0, Math.min(4, spare));
  if (crew.length < (shelter ? 1 : 2)) return;
  const ids = crew.map((s) => s.id);
  const steps = [{ kind: "water" }, { kind: "home" }];
  const est = estimatePlan(state, { memberIds: ids, dest: shore, vehicle: false, stance: "normal", mission: "move", steps });
  if (!est || !est.returns || est.total > WATER_RUN_HOURS * 2 + 6) return;
  // Rations: fresh food first, preserved for the rest (storage.js).
  const eat = est.food + 1, fresh = Math.min(eat, Math.floor(h.stock.food || 0));
  const sup = { food: fresh, preserved: eat - fresh, water: est.water + 1 };
  if (edibleFood(h) < eat + home.length * 2 || (h.stock.preserved || 0) < sup.preserved || waterIn(h.stock) < sup.water) return;
  const res = launchExpedition(state, { memberIds: ids, dest: shore, mission: "move", stance: "normal", supplies: sup, plan: { preset: "custom", steps }, tabs: armoryTabs(h).length > 0 }); // tablets for the river water on the way (worm.js)
  if (res.error) return;
  res.party.apWater = true;
  res.party.haulCap = poolAtBand(crew, 2); // Heavy at most: the way home is not a crawl
  say(state, `Water run: ${names(crew)} go to the ${tileLabel(state, shore)} shore to fill every container (about ${Math.round(est.total)}h there and back): ${h.name}'s water is running short.`);
}
// ---------- the worm: the sick to a cure (worm.js) ----------
// Someone with the worm spotted in its gut stage at a base that cannot cure it (no dewormer there, and not the meds
// and someone to purge it) dies of it within days: the night's care can do nothing, and from day BRAIN_FROM only
// surgery in a Clinic saves them. Each morning they walk to the nearest base that can cure it (a dewormer there, or
// meds and someone to purge) on a one-way supply run (supply.js atDest "disband"), when they get there before the
// last night of the gut stage; failing that, the hub sends meds for two purges to a base with someone to give them.
// (Huge-map census at 7353bc3, seed 5041: the worm's dead were two- and three-person outposts' people, spotted on day
// 1 and never moved, a day's walk from a hub with dewormers in the armory.)
const WORM_CURE_MARGIN = 3; // hours of slack on the way
export const wormCureAt = (state, base) => baseDewormers(state, base) > 0 || ((base.stock.meds || 0) >= WORM.PURGE_MEDS && treaters(state, base).length > 0);
// Hours from now until the last night the gut stage can still be cured (the night's care comes after the day's step
// of the course, worm.js wormDaily): the midnight their course reaches day BRAIN_FROM − 1. 0: too late.
export function wormHoursLeft(state, w) {
  const nights = WORM.BRAIN_FROM - 1 - w.day;
  return nights >= 1 ? 24 - (state.hour % 24) + (nights - 1) * 24 : 0;
}
// The sick waiting on a run already set up for them (a walk, or meds on the way to their base).
const wormRunFor = (state, pred) => supplyRuns(state).some((j) => j.apWorm && pred(j) && (jobParty(state, j) || j.status === "waiting"));
export function wormCureRuns(state) {
  const h = hub(state);
  for (const base of [...state.bases]) {
    if (wormCureAt(state, base)) continue;
    const sick = residents(state, base.id).filter((s) => { const w = wormOf(s); return w && w.seen != null && !w.locked && w.stage === "gut" && wormHoursLeft(state, w) > WORM_CURE_MARGIN; });
    if (!sick.length) continue;
    const near = state.bases.filter((b) => b !== base && wormCureAt(state, b)).sort((a, b) => state.grid.distance(a.tile, base.tile) - state.grid.distance(b.tile, base.tile)).slice(0, 4);
    const waiting = [];
    for (const s of sick) {
      if (wormRunFor(state, (j) => j.crewIds.includes(s.id))) continue;
      const left = wormHoursLeft(state, wormOf(s)) - WORM_CURE_MARGIN;
      let best = null;
      for (const b of near) {
        const plan = planSupplyRun(state, { originId: base.id, destId: b.id, crewIds: [s.id], deliver: {}, atDest: "disband", stance: "normal" });
        if (!plan.error && plan.hoursOut <= left && roadFed(base, plan) && (!best || plan.hoursOut < best.plan.hoursOut)) best = { b, plan };
      }
      if (best && wormRun(state, { originId: base.id, destId: best.b.id, crew: [s.id], deliver: [], atDest: "disband" },
        `${first(s)} walks from ${base.name} to ${best.b.name} for the worm (day ${wormOf(s).day}: ${baseDewormers(state, best.b) ? "a dewormer there" : "a purge there"}, about ${Math.ceil(best.plan.hoursOut)}h; nothing here can cure it)`)) continue;
      waiting.push(s);
    }
    // Meds from the hub for the ones who cannot go: two purges each, to a base with someone to give them.
    if (!waiting.length || !h || h === base || !treaters(state, base).length || wormRunFor(state, (j) => j.destId === base.id)) continue;
    const meds = Math.min(WORM.PURGE_MEDS * 2 * waiting.length, Math.floor((h.stock.meds || 0) - 2));
    if (meds < WORM.PURGE_MEDS) continue;
    const home = atBase(state, h.id);
    if (home.length - Math.max(2, Math.ceil(home.length * persona(state).homeFrac)) < 1) continue; // like the other runs: the style's share stays home
    const runner = home.filter((x) => x.health >= 70 && !x.leader && !x.inBed && !x.woundInfected && !x.worm).sort((a, b) => combatPower(b) - combatPower(a))[0];
    if (!runner) continue;
    const left = Math.min(...waiting.map((s) => wormHoursLeft(state, wormOf(s)))) - WORM_CURE_MARGIN;
    const plan = planSupplyRun(state, { originId: h.id, destId: base.id, crewIds: [runner.id], deliver: { meds }, atDest: "return", stance: "normal" });
    if (plan.error || plan.hoursOut > left || !roadFed(h, plan)) continue;
    wormRun(state, { originId: h.id, destId: base.id, crew: [runner.id], deliver: [{ key: "meds", qty: meds }], atDest: "return" },
      `${meds} meds to ${base.name} for the worm (${names(waiting)}: nothing there can cure it, and the walk is too far or cannot be made)`);
  }
}
// The food and water for the way out are there (supply.js dispatchSupplyRun would refuse the run).
const roadFed = (base, plan) => (base.stock.food || 0) >= plan.need && waterIn(base.stock) >= plan.needWater;
// Sets up and sends a one-off run for the worm; true when it left.
function wormRun(state, form, why) {
  const res = saveSupplyRun(state, { jobId: null, vehicleId: null, pickup: [], schedule: "once", every: 5, stance: "normal", allowPartial: false, ...form });
  if (res.error) return false;
  res.job.apMade = true;
  res.job.apWorm = true;
  dispatchSupplyRun(state, res.job, false);
  if (!res.job.partyId) { deleteSupplyRun(state, res.job); return false; }
  gov(state).stats.supplyRuns++;
  say(state, `Supply run: ${why}.`);
  return true;
}

function planSupplyRuns(state) {
  planWaterRun(state);
  const h = hub(state);
  for (const o of state.bases.filter((b) => b.type === "outpost")) {
    const why = supplyRunTo(state, h, o, { moves: true });
    if (why) say(state, `Supply run to ${o.name}: ${why}.`);
  }
}
// One supply run from base h to outpost o, if one is wanted (returns why it went, or ""). moves: people may be sent to
// live there (the autopilot; a base leader never moves people). keep: who never goes (a base leader, their deputy,
// pinned people).
function supplyRunTo(state, h, o, { moves = false, keep = new Set() } = {}) {
  const g = gov(state);
  {
    if (supplyRuns(state).some((j) => j.apMade && j.destId === o.id && (jobParty(state, j) || j.status === "waiting"))) return "";
    const home = atBase(state, h.id);
    // Like trips, supply runs leave the style's share of the hub at home.
    const spare = home.length - Math.max(2, Math.ceil(home.length * persona(state).homeFrac));
    if (spare < 1) return "";
    const crewPool = home.filter((s) => s.health >= 70 && !s.leader && !s.inBed && !s.woundInfected && !keep.has(s.id)).sort((a, b) => combatPower(b) - combatPower(a));
    const staff = atBase(state, o.id).length;
    let form = null, why = "";
    if (moves && staff < 2 && !o.captured && home.length >= 7 && crewPool.length) { // a base taken from a group (conquest.js) is held by whoever took it
      const s = [...crewPool].sort((a, b) => skill(b, "farming") - skill(a, "farming"))[0];
      form = { crew: [s.id], deliver: [{ key: "food", qty: 6 }, { key: "scrap", qty: Math.min(8, Math.max(0, Math.floor((h.stock.scrap || 0) - 30))) }], atDest: "disband" };
      why = `${first(s)} joins the outpost (only ${staff} there)`;
    } else if (staff && outpostThirsty(state, o) && waterIn(h.stock) - home.length * 5 >= 12 && crewPool.length) {
      // An outpost's spring gives 3 a day (less in a dry spell): water from the hub before anyone goes thirsty.
      const qty = Math.min(30, Math.floor(waterIn(h.stock) - home.length * 5));
      const crew = [];
      for (const s of crewPool) if (carryCapacity(state, crew, null) < qty * SUPPLIES.water.weight && crew.length < Math.min(spare, 2)) crew.push(s);
      const load = Math.min(qty, Math.floor(carryCapacity(state, crew, null) / SUPPLIES.water.weight));
      // Purified water first, the rest un-purified (water.js: the outpost purifies it like its own).
      const pure = Math.min(load, Math.floor(Math.max(0, h.stock.water || 0)));
      if (load >= 8) form = { crew: crew.map((s) => s.id), deliver: [...(pure > 0 ? [{ key: "water", qty: pure }] : []), ...(load - pure > 0 ? [{ key: RAW, qty: load - pure }] : [])], atDest: "return" };
      why = `${load} water (it is running dry)`;
    } else if (moves && !o.captured && movers(state, h, o, Math.min(spare, crewPool.length)) > 0) {
      // Not to a base taken from a group (conquest.js): held by whoever took it, often out in the wild (census seed 5005,
      // huge, aggressive: people moved one by one to nine taken bases died of hordes and the worm: 179 deaths against 85).
      // The hub has outgrown its plots (hubCramped): people move to an outpost with beds free, food for the walk and a
      // few days more with them; the outpost builds its beds, fields and stores ahead of them (buildWishes).
      const n = movers(state, h, o, Math.min(spare, crewPool.length));
      // Farmers first (an outpost has to feed itself); the hub's medics, builders and station hands last.
      const keepHome = (s) => (s.role === "medic" || s.role === "build" || s.role === "operate" ? 6 : 0);
      const crew = [...crewPool].sort((a, b) => skill(b, "farming") - keepHome(b) - (skill(a, "farming") - keepHome(a))).slice(0, n);
      const food = Math.min(HOUSING.moveFood * n, Math.max(0, Math.floor((h.stock.food || 0) - home.length * 5)));
      form = { crew: crew.map((s) => s.id), deliver: food > 0 ? [{ key: "food", qty: food }] : [], atDest: "disband" };
      why = `${names(crew)} move${crew.length === 1 ? "s" : ""} there: ${h.name} has outgrown its building plots (${residents(state, h.id).length} people for ${baseBeds(h)} beds), ${o.name} has ${outpostBedsFree(state, o)} free`;
    } else {
      const wish = buildWishes(state, o).find((w) => { if (!BUILDINGS[w.type]) return false; const c = wishCheck(state, o, w); return !c.noPlot && !/^Limit reached/.test(c.reason || ""); }); // no plot free: no scrap run for it
      const scrap = wish ? wishCost(wish).scrap || 0 : 0;
      // A well needs a part too, a barracks two, a radio relay 3; one more when it is not saved for (planBuilds keeps 1 back then).
      const parts = wish && wishCost(wish).parts ? wishCost(wish).parts + (wish.save ? 0 : 1) : 0;
      const partsShort = parts > 0 && (o.stock.parts || 0) < parts && (h.stock.parts || 0) >= parts + 2;
      // Scrap short (the hub can spare it), or only the parts (an outpost seldom has 3 for a relay: it makes none).
      const scrapShort = (o.stock.scrap || 0) < scrap;
      if (wish && (scrapShort ? (h.stock.scrap || 0) >= scrap + 25 : partsShort) && home.length >= 5 && crewPool.length >= 1) {
        const deliver = scrapShort ? [{ key: "scrap", qty: scrap + 2 }] : [];
        if (partsShort) deliver.push({ key: "parts", qty: parts - Math.floor(o.stock.parts || 0) });
        if ((o.stock.food || 0) < staff * 3) deliver.push({ key: "food", qty: 8 });
        // Enough hands to carry it (people stay home: at most a third of the hub goes).
        const load = deliver.reduce((a, l) => a + l.qty * SUPPLIES[l.key].weight, 0);
        const crew = [];
        for (const s of crewPool) if (carryCapacity(state, crew, null) < load && crew.length < Math.min(spare, Math.max(1, Math.floor(home.length / 3)))) crew.push(s);
        if (carryCapacity(state, crew, null) >= load) form = { crew: crew.map((s) => s.id), deliver, atDest: "return" };
        why = `${scrapShort ? (partsShort ? "scrap and parts" : "scrap") : "parts"} for ${wish.upgrade != null ? "expanding a bunkhouse into a barracks" : `a ${BUILDINGS[wish.type].name.toLowerCase()}`} (${wish.why})`;
      }
    }
    if (!form) return "";
    const res = saveSupplyRun(state, { jobId: null, originId: h.id, destId: o.id, vehicleId: null, pickup: [], schedule: "once", every: 5, stance: "normal", allowPartial: true, ...form });
    if (res.error) return "";
    res.job.apMade = true;
    dispatchSupplyRun(state, res.job, false); // logs why when it cannot leave
    if (res.job.partyId) {
      g.stats.supplyRuns++;
      return why;
    }
    deleteSupplyRun(state, res.job);
    return "";
  }
}

// ---------- crew roles (crews.js, work.js) ----------
// The governor's judgement for one field team in a crew role's style, without its log lines (stewardCtx): what the
// hub needs, how good a site is, which answer a card gets, how to search and when to leave, a trade at the gates,
// an outpost running dry. The autopilot itself does not change.
function withStyle(style, fn) {
  const prev = stewardCtx;
  stewardCtx = { style: PERSONALITIES[style] ? style : "balanced" };
  try { return fn(); } finally { stewardCtx = prev; }
}
export const crewAI = {
  needs: (state, style) => withStyle(style, () => needs(state)),
  siteScore: (state, id, need, style) => withStyle(style, () => siteScore(state, id, need, persona(state))),
  needText,
  tradeGoods: (state, need, style) => withStyle(style, () => tradeGoods(state, need)),
  // The answer the governor would give (null: none it can pick; uiAction choices and disabled ones left out).
  answer: (state, card, style) => withStyle(style, () => {
    const p = card.partyId != null ? state.parties.find((x) => x.id === card.partyId) : null;
    const opts = (card.choices || []).filter((c) => !c.uiAction && !isDisabled(state, c));
    return opts.length ? pickChoice(state, card, opts, p) : null;
  }),
  approach: (state, p, e, style) => withStyle(style, () => chooseApproach(state, p, e)),
  extractNow: (state, p, e, style) => withStyle(style, () => shouldExtract(state, p, e)),
  trade: (state, style) => withStyle(style, () => handleTrade(state)),
  outpostThirsty: (state, o) => outpostThirsty(state, o),
  isDisabled,
};

// ---------- the night watch (watch.js, sleep.js) ----------
// The governor keeps a night watch at every base of GOV_WATCH.min (3) or more people, so no night finds a base asleep
// (watch.js surpriseAt: raiders over the wall, a horde at the walls before anyone woke): two short watches,
// GOV_WATCH.shifts (20–00 and 00–06), so nobody stands more than six hours past their bedtime and nobody comes off one
// Tired (sleep.js: they sleep in after it). Each watch takes 1, +1 at GOV_WATCH.big (12) people, +1 while a threat is
// known (a horde in sight or a hive near: defences.js hordeThreat; raiders in reach or on the way: threatAt), at most a
// third of the fit people. Picked every day at GOV_WATCH.hour (18:00): the best shots first, those who stood last
// night after everyone else, the Tired last (so it rotates); a watch on now whose people are all gone, hurt or away is
// given one more. planRoles 1a puts whoever is on watch now on guard ahead of any other work (they count among the
// guards it posts: the hub's standing lookouts, a threat's guards). A roster the governor did not make
// (base.watch.gov unset) is left as it is and stood all the same. Cheap: one sort a base a day, else a look at the
// watch on now.
export const GOV_WATCH = { min: 3, big: 12, hour: 18, shifts: [["First watch", 20, 0], ["Second watch", 0, 6]] };
function govWatch(state, base) {
  const W = base.watch;
  if (W && !W.gov) return; // the player's own roster
  const people = atBase(state, base.id);
  if (people.length < GOV_WATCH.min) { if (W) delete base.watch; return; }
  const fit = (s) => s.alive && !s.pinned && !s.inBed && !healthRest(s);
  const h = hourOfDay(state);
  const rank = (list, last) => list.slice().sort((a, b) => (last.has(a.id) - last.has(b.id)) || (tiredLevel(a) - tiredLevel(b)) || (skill(b, "shooting") - skill(a, "shooting")) || (a.id - b.id));
  if (W && h !== GOV_WATCH.hour) {
    for (const sh of W.shifts) {
      if (!inShift(sh, h) || sh.ids.some((id) => { const s = people.find((x) => x.id === id); return s && fit(s); })) continue;
      const taken = new Set(W.shifts.flatMap((x) => x.ids));
      const pick = rank(people.filter((s) => fit(s) && !taken.has(s.id)), new Set())[0];
      if (pick) sh.ids.push(pick.id);
    }
    return;
  }
  const ok = people.filter(fit);
  const t = threatAt(state, base);
  const threat = t.urgent > 0 || t.standing > 0 || hordeThreat(state, base).size > 0;
  const per = Math.max(1, Math.min(1 + (people.length >= GOV_WATCH.big ? 1 : 0) + (threat ? 1 : 0), Math.floor(ok.length / 3)));
  const order = rank(ok, new Set(W ? W.shifts.flatMap((sh) => sh.ids) : []));
  const shifts = GOV_WATCH.shifts.map(([name, from, to]) => ({ name, from, to, ids: [] }));
  let k = 0;
  for (let r = 0; r < per; r++) for (const sh of shifts) if (k < order.length) sh.ids.push(order[k++].id);
  base.watch = { preset: null, gov: true, shifts };
}
