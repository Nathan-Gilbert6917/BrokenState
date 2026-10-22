// Autopilot: an AI governor that runs the player's holdout (a dev tool, also used headless by tools/autotest.js).
// While state.autopilot is on, the hourly tick (world.js) calls autopilotHour. The governor:
//   - resolves cards (travel events, conflicts, orders / "Done" cards, strangers, raid warnings), scavenging
//     searches (one search hour per tick), trade visits and battles (state.autoCombat is on while it runs);
//   - sets every role by need (food, threats, the injured, construction, stations, crafting), queues buildings
//     (storage among them when a base's goods lie outside: storageWish, basestorage.js) and crafts, hands out gear from the armory and treats the injured with base meds;
//   - once a day (07:00) plans a trip: scavenging the best known site for what the hub needs, checking finds,
//     recovering the dead or a vehicle, a trade visit, a rescue, or founding an outpost; and sends supply runs
//     to outposts that need materials or hands;
//   - with the Cautious style, keeps every supply at a reserve target (reserveStatus) and goes for more (trips,
//     recon, radio deals, trade visits, the bench and med station) as soon as one drops below it.
// It only uses the same calls as the UI (canBuild / queueBuild, queueCraft, treatAtBase, launchExpedition,
// startOrder, saveSupplyRun ...), plays by what the player knows of the map (knowledge snapshots, markers,
// known groups), and never draws from state.rng. Turning it off hands everything back as it is.
import { basicToolWanted, isBasicToolJob, TOOL_KINDS } from "./toolreqs.js"; // the tools a base keeps for building and crafting (planCrafts)
import { HAUL, govHauling, haulersWanted, haulScore, onHaulTrip } from "./hauling.js"; // hauling: haul orders and haulers (call-time only)
import { isChopJob } from "./woodwork.js"; // noidle: the felling in the queue
import { fellCrew, fellUrgent, fellScore, fellFit, noWorkFor, planNoIdle } from "./noidle.js"; // noidle: a woodcutter on the felling, nobody in a role with no work (call-time only)
import { FOODS, FOOD_KEYS, foodIn, foodSplit, unitsOf, qtyOf, sellPick, foodNeeds, foodUnits } from "./foods.js"; // food by type (foods.js)
import { gearOutdoorWorkers, outReady, tripKit } from "./tripgear.js"; // the outdoor workers' kit for their trips (trips-plus #2)
import { govFieldWorks, fieldJobs, govSnares, snareLinesWanted, playerWorks, gatheredScrap } from "./fieldworks.js"; // field works: the governor's and a base leader's share
import { BUILDMAT_FINDS } from "./loot.js"; // building materials: where they are found
import { traitAim } from "./traits.js"; // Brave, Coward: to hit
import { fitFromPool } from "./gunmods.js";
import { itemScore, equipPeople, equipTools } from "./equip.js"; // the one hand-out rule (the AI groups use it too: loadouts.js)
import { planRepairs, benchWanted, repairCrafterWanted, repairHold, autoFieldRepairs, partNeeds, partDeficit, partPlan, kitWants, spareGun, queueRepair } from "./repair.js"; // the autopilot's repairs of worn gear // the autopilot fits loose gun attachments
import { equipKit, governPlates } from "./carrykit.js"; // carry kit: rigs, plates in the carriers, spare magazines; spare plates kept // the autopilot's repairs of worn gear // the autopilot fits loose gun attachments
import { GEAR, LOCATIONS, SUPPLIES, FACTION_TYPES, supValue, supWeight } from "./data.js";
import { log, day, hourOfDay, hub, alive, atBase, residents, skill, combatPower, gearEffect, factionById, survivorById, snapshot, armedFactor, archerCount, ARROWS, meleeAimBonus, meleeDmgMult } from "./world.js";
import {
  launchExpedition, estimateTrip, startReturn, partyMembers, partyTile, tileLabel, teamName, orderOptions, orderMove,
  hoursLeft, planPath, partyCapacity, cargoLoad, cargoRoom, supplyLoad, carryCapacity, travelHours, awaitOrders, partySpeed, pruneCards, giveOrder,
  STANCES, paceOpts, modeSpeed, partyPace, poolLoad, missionProblem, carried, takeSupply, weighTeam,
} from "./parties.js";
import { startOrder, resumeQueue, besideWater, FETCH_WATER_HOURS } from "./orders.js";
import { estimatePlan, commandable } from "./plans.js";
import { searchHour, extract, engagementParty, foundLoad } from "./scavenge.js";
import { engScout, engScoutChoices, SCOUT } from "./raidplan.js"; // a scout before the search
import { crawlAutoStep } from "./citycrawl.js";
import { tradeContext, sellPrice, buyPrice, executeTrade, endTrade, proposePact, available, maxBuyable, minSellable, giftAll, goodsWorth, demand, gearBuyPrice, balanceWith, tradeVerdict, ensureWares } from "./trade.js";
import { autoCaravanTrade, launchCaravan, caravanEstimate, caravanEnRoute } from "./caravans.js";
import { governorVehicles, idleDaily } from "./vehicletrade.js"; // buying and selling vehicles
import { radioDeals, pendingDeal, dealCaravanForm, matchGear, goodsWeight, cancelRadioDeal, deliveryRefusal, openRadioTrade } from "./radiotrade.js"; // radio deals your caravan fetches
import { autoVisitorTrade } from "./visitors.js";
import { radioTradeIfShort, hasNetwork, canListen, radioScan, dealQuote, radioDeal, refusal, inCoverage, canRadioGroup, relayReach, RELAY_RANGE, GROUP_REACH, tradeBase, hubSpare, radioSpeech } from "./radio.js";
import { attitude, baseDefense, strength, isAggressiveType, raidStakes } from "./factions.js";
import { holdCheck, defenceWishes, hordeThreat, DECOY_FUEL, towerHordes } from "./defences.js";
import { autoFillTunnels } from "./tunnels.js"; // the dead's tunnels under the walls: Fill tunnel queued first
import { defaultRolePlan, plansOf } from "./defenceplan.js"; // the governor's defence plan (governorPlans, stewardSafety)
import { siteBonus, waterOutlook, foodOutlook, waterCapacity, waterProduction, waterNeed, summerWater, waterRunningShort, supplyLine, WATER, fetchWaterWhy, fetchWaterDay } from "./economy.js";
import { mouthsAt, foodUse, HEAT, payoutSpare, payoutBreaks } from "./upkeep.js"; // upkeep-per-head: the governor's days of food and water count everyone fed at a base
import { waterIn, teamWaterIn, RAW, keyWord } from "./water.js"; // purified and un-purified water: the governor counts both
import { brokenAt, jobFor, fixtures, isWaterFixture, repairPlan } from "./breakdowns.js";
import { farmersWanted, farmOf, seasonKey, winterOutlook } from "./farming.js";
import { edibleFood, foodStore, storeCapacity } from "./storage.js";
import { KITCHEN, hasKitchen, cooksWanted, kitchenCold, kitchenCanLight, kitchenWood, isCookHour, cookedLately } from "./kitchen.js"; // the Kitchen: built at 8+ people, its cooks staffed (planRoles 5c)
import { conditionsOf, CONDITIONS, treatCondition, treatConditionInfo, medsToTreatAll, autoWantsCondition } from "./health.js";
import { govCookBills } from "./cooking.js"; // wave 2 cooking: the governor's and the stewards' bills
import { canUpgradeKitchen, queueCannerUpgrade, canUpgradeGenerator, queueGenUpgrade, stationOperator, hasWall } from "./buildings.js"; // machines-2: the pressure canner; gen-tiers: a generator upgraded
import { siteCost } from "./buildmats.js"; // a wish's cost as the stores pay it (building materials and sheets made on site from scrap)
import { nextWallTier, wallTier, underAttack, campMaterialsWork } from "./buildings.js"; // WALL_TIERS: one wall, built up a tier at a time
import { WOODWORK, queueChop, queuedChopWood, clearAhead } from "./woodwork.js"; // woodwork: felling for wood, clearing the next sites ahead (govWoodwork)
import { fittingRoom } from "./basemap.js"; // base building: a general building with floor for a fitting (bedWishes, storageWish, stoveWish)
import { governBeds } from "./beds.js"; // beds as furniture: set from the stores, crafted when beds are short (call-time only)
import { autoStore } from "./containers.js"; // the stores tidied daily (tidyStores)
import { BUILDINGS, RECIPES, canDemolish, demolish, canBuild, queueBuild, count, countAll, stations, baseBeds, baseWalls, farmSlots, assignStations, isShelter, plotsFree, plotCap, BEDS, queuedBeds, BARRACKS_UP, canExpandBunkhouse, queueBunkhouseExpand, benchTier, tierUpType, tierUpJob, gatherRows, gatherStalled, isCamp, CAMP as CAMP_TIER, WATER_BARREL, canUpgradeBarrel, queueBarrelUpgrade, barrelTier, barrels, barrelName } from "./buildings.js";
import { fireWanted } from "./fieldheat.js";
import { storageOf, isStoreBuilding } from "./basestorage.js"; // base storage limits: storage when goods lie outside (storageWish)
import { isHurt, hospitalDef, nextHospitalType, treatAtBase, treatAtBaseInfo, fieldTreatInfo, careNeed, treaters } from "./medical.js";
import { planTrainees, planDoctor } from "./training.js"; // a Medic trainee for a base short of skilled medics, the doctor on duty
import { CRAFTS, canCraft, queueCraft, craftQueue, isFilterJob, filterRecipe, canAttempt, craftSkill, fieldCraftOptions } from "./crafting.js";
import { vehiclesAtBase, carsAtBase, bikesAtBase, parkBikes, isBike, isCar, travelMode, refuel, repair, canRepair, wreckSupplies, partyFuel, CARPART_SUB, stripVehicle } from "./vehicles.js";
import { LOAD_BANDS, wornLoad, poolAtBand } from "./load.js";
import { saveSupplyRun, dispatchSupplyRun, supplyRuns, jobParty, deleteSupplyRun, planSupplyRun, linesText } from "./supply.js";
import { autoPlayerTurn, runEnemyPhase, closeCombat, endBattleNow, WEAPONS } from "./combat.js";
import { allCaptives, ransomValue, isCaptive } from "./conflicts.js";
import { ensureInv, armorMult, itemLoad, salvageAt, allCarried } from "./inventory.js";
import { weather as wxNow, severeSoon, season as wxSeason, thirstAhead, thirstAt, THIRST, seasonOfDay, foodNeedFactor, coldAhead } from "./weather.js";
import { teamCold } from "./needs.js"; // tune-winter: a team's food in the cold (×1.1 / ×1.2 without a lit camp fire)
import { autoRecruitPick } from "./recruits.js";
import { planStudy } from "./skills.js";
import { planBlueprintStudy, buildLock } from "./blueprints.js";
import { stationOrder, setStationOrder, orderHold } from "./production.js";
import { generators, setGenReserve, powerStatus, powerWanted, genCapacity, genToUpgrade, genUpgradeFuelOk, GEN_UP } from "./power.js"; // machines-2: the generators' fuel reserve (govOrders); gen-tiers: the upgrade (autoGenUpgrade)
import { column } from "./history.js"; // gen-tiers: the base's fuel in and out over the last weeks
import { friendlyCrew, wantsRest, relAutopilotDaily } from "./relations.js";
import { autoDiplomacyDaily, hiveAllies, broodAfterAllies, goalsProgress, allianceMembers, ALLIANCE, isMember, inviteProblem, inviteToAlliance, landCentres, controlRadius, coalitionMask } from "./alliance.js";
import { ensureDiplo, joinProblem, joinWar } from "./diplomacy.js";
// Land claims (claims.js, the coalition / land plan): the governor claims tiles toward contested ground and digs wells on
// claims by water, through the team orders orders.js gives them ("Claim this tile" / "Dig a well": CLAIM_ORDER,
// WELL_ORDER). Read through CL and guarded, so the governor stays whole if the module is ever missing.
import * as CL from "./claims.js";
import { baseAmmo, teamAmmo, partyCals, wantedKey, spareRounds } from "./ammo.js"; // rounds by calibre: what fits the guns there
import { supplyAmt } from "./rounds.js"; // "ammo": every round there, any calibre
import { autoReloadOrders, autoReloadBench, reloadNeeds, reloadCaps, reloadWanted } from "./reloading.js"; // the reloading bench: its orders, the upgrade, powder and primers to buy
const CLAIM_ORDER = "claim", WELL_ORDER = "well";
const claimsReady = () => typeof CL.canClaim === "function" && typeof CL.playerClaims === "function";
import { jobTripCands, jobById, activeJobs } from "./jobs.js";
import { hiveAt, hiveForce, hiveById, zombieToughness } from "./hives.js";
import { crawlEstimate, hiveCrawlAutoStep, coreGate } from "./hivecrawl.js"; // the hive crawl: the odds of the way to the core and of the core, a crawl step an hour
import { LIGHTS } from "./lights.js"; // the lights the armory would give a hive squad (the core's odds)
import { isLate } from "./eras.js";
import { BREAKOFF } from "./breakoff.js";
import { growthAt, ensureGrowths, growthForce } from "./hivetech.js";
import { gatheringCands } from "./hivebirth.js"; // hive birth you can see: culling a gathering before the hive stands
import { GROWTHS, TECH } from "./hiveconst.js";
import { typeStrength } from "./zombietypes.js";
import { assaultForce, assaultOdds, teamAssaultOdds, lostBases, occupiedAt, squadValue, nearestOtherBase } from "./conquest.js";
import { OCCUPY, occupyProblem, occupyOdds, teamOccupyOdds, standingAt, occupyGrievance, abandonProblem, abandonOutpost } from "./occupy.js"; // moving into an abandoned base instead of founding an outpost; giving up a doomed one
import { abandonedThreat } from "./groupworld.js";
import { autopilotPrisoners, jailTier, cellCap, prisonersAt, planJailGuards } from "./prisoners.js";
import { autopilotRescue, autoRescuePlan, teamPayOk } from "./ransom.js"; // your people held by other groups: ransom first, a raid when strong
import { isManaged, healthRest } from "./work.js";
import { sickRestWhy } from "./sickrest.js"; // sick people rest: planRoles step 1, and no trips, errands or runs (tripFit)
import { onWatchNow, inShift } from "./watch.js"; // the night watch (govWatch)
import { tiredLevel } from "./sleep.js";
import {
  HUNT, huntTargets, fishTargets, hunterMult, bestHuntWeapon, fisherMult, fishKit, snareLine, huntWorkWhy, fishWorkWhy, fishWorkHands, huntWorkCap,
  cabinProblem, cabinGain, CABIN_GAIN, hasFishingGear, huntInfo, huntProblem, fishProblem, expectFish,
  hasBow, autoHuntMix, setHuntMix, huntMixOf, huntArrowsFor, huntMixText, huntYield,
} from "./hunting.js";
import { landFoodOptions, forageWorkWhy, forageWorkCap, foragerMult, baseForageDay } from "./foraging.js";
import { woodNeed, woodWorkWhy, woodHandsWanted, woodCrowd, handsForDay, woodcutterMult, bestChop, baseWoodDay, woodAbundance, woodLevel, expectWood, chopCrew, chopPower, isChopTool, woodTime, canLight, WOOD } from "./woodcutting.js";
import { siteKnown } from "./discovery.js";
import { packTripKit, HIVE_KIT } from "./kit.js";
import { openCasesIn } from "./gunsafes.js";
import { surveyCandidate, surveySent, SURVEY, poiSurveyCandidate, poiSurveySent } from "./survey.js";
import { autoTreats } from "./comforts.js";
import { firstHubPending, hubSites } from "./hardcore-start.js";
import { stagingNeeds, establishProblem, STAGING, besideWaterSource } from "./staging.js"; // no base: Establish base (a camp with its step up)
import { isHardcore } from "./hardcore.js";
import { WORM, baseWater, baseFilter, baseTabCount, baseCooks, armoryTabs, TABS_TRIP_DAYS, wormMeatAt, wormVegAt, wormSeen, boilerUse, cropLandBad, baseDewormers, wormOf } from "./worm.js";
import { gunWant, pickGunToBuy, noteGunBought, radioGunDeal } from "./govguns.js"; // the governor buys guns for the unarmed
import { carriedRec } from "./ammo.js"; // the loose rounds people carry
import { sumRecs } from "./rounds.js"; // a team's rounds: its bags and what its people carry

// Play styles. range = max tiles from the hub for a trip, maxHoursOut = longest way out, cooldown = days between
// launches, homeFrac = share of the hub that stays home, risk = lowest success chance worth a gamble,
// lossFear / fightBias / raidBias weigh fights on conflict cards, chain = extra sites a team may hit on one trip.
// hiveFrom = first day it storms hives, hiveOdds = squad power over the brood's strength it wants (hiveCandidate),
// hiveRest = days between hive missions.
// conquer = which groups' bases it storms (conquestCandidate: "ready" any hostile group, "provoked" hostile groups
// that raided it lately or when only hostile groups keep the coalition from winning, "last" only then), from day
// conquerFrom, with at least conquerOdds to win (lateConquer: from the late game, eras.js year 10, it goes for any
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
    curious: 0.5, baseGuards: 2, guardMargin: 1.4, restMood: 35, chain: 0, outposts: 1, outpostPop: 12, strangerDays: 8, strictWinter: true, // strictWinter: roomAt
    holdRatio: 1.5, raid: false, rescue: false, tradeEvery: 14,
    reserves: true, shortCooldown: 2, shortReach: 2, homeHorde: 5,
    hiveFrom: 150, hiveOdds: 1.35, hiveRest: 10,
    conquer: "last", conquerFrom: 240, conquerOdds: 0.8, retreatBelow: 0.9,
  },
  balanced: {
    name: "Balanced", crowdSlack: 2, desc: "Up to two teams out, scavenges what the hub needs, fights only good odds, grows with an outpost or two.",
    maxTeams: 2, cooldown: 2, crew: 2, homeFrac: 0.5, minHealth: 70, range: 11, maxHoursOut: 28, stance: "normal",
    searchHours: 5, searchHeat: 45, hurtStop: 45, risk: 0.65, riskAversion: 1, lossFear: 9, fightBias: 0, raidBias: -1,
    curious: 1, baseGuards: 1, guardMargin: 1.25, restMood: 28, chain: 1, outposts: 2, outpostPop: 9, strangerDays: 4,
    holdRatio: 1.25, raid: false, rescue: true, tradeEvery: 12,
    hiveFrom: 90, hiveOdds: 1.2, hiveRest: 6,
    conquer: "provoked", conquerFrom: 150, conquerOdds: 0.75, retreatBelow: 0.8, lateConquer: 0.7,
  },
  aggressive: {
    name: "Aggressive", crowdSlack: 8, desc: "Many long trips, loud searches, raids hostile land, ambushes camps and robbers, expands fast.",
    maxTeams: 3, cooldown: 1, crew: 3, homeFrac: 0.4, minHealth: 60, range: 15, maxHoursOut: 40, stance: "normal",
    searchHours: 7, searchHeat: 62, hurtStop: 35, risk: 0.5, riskAversion: 0.6, lossFear: 7, fightBias: 1, raidBias: 2,
    curious: 1.4, baseGuards: 1, guardMargin: 1.1, restMood: 22, chain: 2, outposts: 3, outpostPop: 8, strangerDays: 3,
    holdRatio: 1.2, raid: true, rescue: true, tradeEvery: 0,
    hiveFrom: 30, hiveOdds: 1.05, hiveRest: 4,
    conquer: "ready", conquerFrom: 60, conquerOdds: 0.65, retreatBelow: 0.6,
  },
  // The play styles below (2026-10-09, the progression census) lean on one of the three above: `base` is the style
  // the rest of the game reads for them (state.governor.personality: diplomacy, road and war cards, prisoners, the
  // retreat policy, perks), while the governor's own decisions use every knob here. New knobs: envoyEvery /
  // envoyReach (days between envoys to a group, how far they go: × range), landEarly (founds land outposts for the
  // coalition as soon as it has a member, without waiting for the groups to settle: landPush), tributeLean (how
  // readily it pays a tribute rather than fight: raidWarningChoice), envoyBare (an envoy goes to talk even when the hub
// has no surplus to send as gifts: envoyCandidate), homeFood (lives on its own land: walls early, animal pens and
// greenhouses saved for, spare beds, the chapel sooner and a bigger winter margin: buildWishes, farmCrewLimits),
// minOut (a small hub still sends this many for scrap: planTrip; a lone scavenger left most of the scrap behind).
  diplomat: {
    name: "Diplomat", base: "cautious", crowdSlack: 2, desc: "Builds the coalition: envoys with gifts to every group it knows, trade visits, land outposts as soon as it has a member; pays tribute, never starts a war, storms hives only at good odds.",
    maxTeams: 2, cooldown: 2, crew: 2, homeFrac: 0.5, minHealth: 70, range: 11, maxHoursOut: 30, stance: "normal",
    searchHours: 4, searchHeat: 40, hurtStop: 50, risk: 0.7, riskAversion: 1.2, lossFear: 10, fightBias: -0.5, raidBias: -3,
    curious: 1, baseGuards: 1, guardMargin: 1.3, restMood: 30, chain: 1, outposts: 2, outpostPop: 9, strangerDays: 3,
    holdRatio: 1.3, raid: false, rescue: true, tradeEvery: 6,
    hiveFrom: 120, hiveOdds: 1.25, hiveRest: 8,
    conquer: "last", conquerFrom: 240, conquerOdds: 0.8, retreatBelow: 0.85,
    envoyEvery: 8, envoyReach: 3.5, envoyBare: true, landEarly: true, tributeLean: 1.8,
  },
  hunter: {
    name: "Hive hunter", base: "aggressive", crowdSlack: 4, desc: "Hunts hives from the first month: a squad out to the nearest mound whenever it is fit, fires first, short rests between storms; fights groups only when they raid it.",
    maxTeams: 2, cooldown: 2, crew: 2, homeFrac: 0.45, minHealth: 65, range: 13, maxHoursOut: 34, stance: "normal",
    searchHours: 5, searchHeat: 50, hurtStop: 40, risk: 0.6, riskAversion: 0.9, lossFear: 8, fightBias: 0.5, raidBias: 0,
    curious: 1.2, baseGuards: 1, guardMargin: 1.2, restMood: 25, chain: 1, outposts: 1, outpostPop: 10, strangerDays: 4,
    holdRatio: 1.25, raid: false, rescue: true, tradeEvery: 10,
    hiveFrom: 20, hiveOdds: 1.0, hiveRest: 3,
    conquer: "provoked", conquerFrom: 200, conquerOdds: 0.75, retreatBelow: 0.75, lateConquer: 0.75,
  },
  turtle: {
    name: "Turtle", base: "cautious", crowdSlack: 0, desc: "Fortifies and stays home: walls first, then lives on its own land (animal pens, greenhouses, spare beds, a chapel), one short trip at a time, three guards on the walls, a single outpost only once the hub is big, keeps a reserve of everything, storms a hive only late and at great odds, never goes to war.",
    maxTeams: 1, cooldown: 5, crew: 3, homeFrac: 0.7, minHealth: 85, range: 7, maxHoursOut: 16, stance: "stealthy",
    searchHours: 3, searchHeat: 20, hurtStop: 65, risk: 0.85, riskAversion: 1.8, lossFear: 14, fightBias: -1.5, raidBias: -4,
    curious: 0.3, baseGuards: 3, guardMargin: 1.6, restMood: 38, chain: 0, outposts: 1, outpostPop: 20, strangerDays: 10, strictWinter: true,
    holdRatio: 1.6, raid: false, rescue: false, tradeEvery: 14,
    reserves: true, shortCooldown: 3, shortReach: 1.5, homeHorde: 6,
    hiveFrom: 400, hiveOdds: 1.5, hiveRest: 14,
    conquer: "last", conquerFrom: 400, conquerOdds: 0.85, retreatBelow: 0.95,
    homeFood: true, minOut: 2,
  },
  expander: {
    name: "Expansionist", base: "aggressive", crowdSlack: 6, desc: "Spreads out: outposts early and many, land for the coalition from the first member, takes hostile groups' bases from the first months, ranges far.",
    maxTeams: 3, cooldown: 1, crew: 3, homeFrac: 0.4, minHealth: 65, range: 16, maxHoursOut: 40, stance: "normal",
    searchHours: 6, searchHeat: 55, hurtStop: 40, risk: 0.55, riskAversion: 0.7, lossFear: 8, fightBias: 0.5, raidBias: 1,
    curious: 1.3, baseGuards: 1, guardMargin: 1.15, restMood: 24, chain: 2, outposts: 5, outpostPop: 6, strangerDays: 3,
    holdRatio: 1.2, raid: true, rescue: true, tradeEvery: 0,
    hiveFrom: 60, hiveOdds: 1.15, hiveRest: 6,
    conquer: "ready", conquerFrom: 90, conquerOdds: 0.7, retreatBelow: 0.65, lateConquer: 0.6,
    envoyEvery: 15, landEarly: true,
  },
};
// The style the rest of the game reads (state.governor.personality): a style's base, or the style itself.
export const baseStyleOf = (key) => (PERSONALITIES[key] && PERSONALITIES[key].base) || (PERSONALITIES[key] ? key : "balanced");
// The Cautious style's careful habits (sneaking, leaving a truck alone, treating a sprain, a bigger ammo reserve), shared by the styles based on it.
const careful = (P) => P.name === "Cautious" || P.base === "cautious";

const PLAN_HOUR = 7;      // daily planning: teams leave in the morning
const STICKY = 2;         // bonus for keeping someone's current role (fewer flips)
// Fit for a trip, an errand or a run (the governor's and the leaders'): not resting sick at home (sickrest.js: any
// illness, by the Work tab's "Sick people rest").
const tripFit = (state, s) => !sickRestWhy(state, s);
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
// g.personality: the base style the rest of the game reads; g.style: the full style when it is one of the newer ones.
const styleKey = (g) => (g.style && PERSONALITIES[g.style] ? g.style : g.personality);
const setStyle = (g, key) => { g.personality = baseStyleOf(key); g.style = PERSONALITIES[key].base ? key : null; };
const persona = (state) => PERSONALITIES[(stewardCtx && stewardCtx.style) || styleKey(gov(state))] || PERSONALITIES.balanced;
export const autopilotPersonality = (state) => styleKey(gov(state));

// ---------- switching ----------
export function setAutopilot(state, on, personality) {
  const g = gov(state);
  if (personality && PERSONALITIES[personality]) setStyle(g, personality);
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
  if (styleKey(g) === key) return;
  setStyle(g, key);
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
const REJECT_KEYS = ["unknown", "far", "odds", "ammo", "squad", "early", "rest", "home"];
const hiveRejects = (state) => { const s = gov(state).stats; if (!s.hiveRejects) s.hiveRejects = {}; for (const k of REJECT_KEYS) s.hiveRejects[k] ??= 0; return s.hiveRejects; }; // an older save's count gains the new keys
export const autopilotStats = (state) => ({ ...gov(state).stats, hiveRejects: { ...hiveRejects(state) } });

// ---------- entry points ----------
// Hourly, from world.js tickHour (after everything else in the hour).
export function autopilotHour(state) {
  if (!state.autopilot || state.gameOver) return;
  const g = gov(state);
  if (g.busy) return; // a tick inside the governor's own work (a raid's hours, for example)
  if (!state.bases.length) { // no base (hardcore's first hub, conquest.js exiles): the teams on the road set up the camp that becomes the hub (roadAct) or retake a base
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
    trackHuntTrips(state); // the hunting trips' catch against what they were sent for (huntTripYield)
    for (const b of state.bases) if (b.owner == null || b.owner === "player") b.filterFill = filterFill(state, b); // crafting.js filtersInUse
    for (const b of [...state.bases]) governBase(state, b);
    if (state.hour % HAUL.govEvery === 0) govHauling(state); // hauling.js: its standing haul orders between its bases
    if (hourOfDay(state) === PLAN_HOUR) autopilotDaily(state);
    else if (hourOfDay(state) === EMERGENCY.hour) emergencyTrips(state); // a second look in the afternoon: thirst does not wait for the morning
    for (const b of state.bases) govWatch(state, b); // the night watch's roster (before the roles: planRoles 1a)
    for (const b of state.bases) governRoles(state, b);
    if (hourOfDay(state) === PLAN_HOUR) autoFieldRepairs(state); // repair.js: a team's urgent gear mended with a field kit
    resolvePending(state);
    autoFires(state);
  } catch (e) {
    fail(state, e);
  } finally {
    g.busy = false;
  }
}

// The camp fires (fieldheat.js FIRE): a camp's or shelter's (tier 0) and a resting team's are lit by day (cooking)
// and put out at night unless it is cold or someone there is badly hurt (the light carries).
function autoFires(state) {
  const hurt = (people) => people.some((s) => s.health < ROAD.heal);
  // A fire burns wood (woodcutting.js shelterFire / campFireHour): with none to burn it is not lit.
  for (const b of state.bases) if (isShelter(b)) b.fire = fireWanted(state, { hurt: hurt(atBase(state, b.id)) }) && canLight(state, b);
  for (const p of state.parties) if (p.owner === "player" && p.phase === "task" && p.task && p.task.type === "camp") p.campFire = fireWanted(state, { hurt: hurt(partyMembers(state, p)) }) && canLight(state, p);
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
  if (areas.building && hourOfDay(state) === WATER_WAIT.hour) waterSalvage(state, base);
  if (areas.building && hourOfDay(state) === PLAN_HOUR) tidyStores(state, base); // containers.js: the goods into the containers, before the day's builds
  if (areas.building && hourOfDay(state) === PLAN_HOUR) for (const line of governBeds(state, base)) say(state, line); // beds.js: furniture set from the stores, a bunk bed or a cot crafted when beds are short
  if (areas.building && base.tunnels && base.tunnels.length) { const line = autoFillTunnels(state, base); if (line) say(state, line); } // tunnels.js: the dead's tunnels under the walls filled first
  if (areas.building) planBuilds(state, base, areas);
  if (areas.building && state.hour % WOODWORK.govEvery === 0) govWoodwork(state, base, areas); // woodwork: felling for wood when short, the next sites cleared ahead
  if (areas.building && hourOfDay(state) === PLAN_HOUR + 2) { const msg = cookFireDown(state, base); if (msg) say(state, msg); } // kitchen.js: a lit kitchen does the cook fire's job
  if (areas.production && hourOfDay(state) === 23) stoveSave(state, base); // kitchen.js: the winter's wood before the stove
  if (areas.production && hourOfDay(state) === PLAN_HOUR) govCookBills(state, base); // cooking.js (wave 2 cooking): their bills at the Kitchen and the cook fire (the player's bills left alone)
  if (areas.building && hourOfDay(state) === PLAN_HOUR + 1) for (const line of govFieldWorks(state, base, { threatened: fieldThreat(state, base), waterShort: waterRunningShort(state, base), foodShort: snareFoodLevel(state, base) })) say(state, line); // fieldworks.js: snare lines, a well, a tower and its lookouts, repairs
  // Hardcore: a snare line wanted and not set at the morning's look (a camp's scrap comes in with a delivery and goes
  // into its building materials within hours) is looked at again every hour while the base has fewer than it wants
  // and has the scrap or the snare wire (else not before the next delivery).
  else if (areas.building && state.mode === "hardcore" && hourlySnares(state, base)) { const line = govSnares(state, base, snareFoodLevel(state, base)); if (line) say(state, line); }
  if (areas.production) { govOrders(state, base); autoReloadOrders(state, base); planCrafts(state, base); planRepairs(state, base); } // repair.js: worn gear to the bench; reloading.js: HP, slugs, AP to keep
  if (areas.building) { const up = autoReloadBench(state, base); if (up) say(state, up); } // reloading.js: an ammo bench upgraded once there are inputs to load with
  if (areas.building) { const up = autoCanner(state, base); if (up) say(state, up); } // machines-2: a pressure canner fitted to a working preserving room
  if (areas.building && hourOfDay(state) === PLAN_HOUR + 3) { const up = autoGenUpgrade(state, base); if (up) say(state, up); } // gen-tiers: a generator upgraded when the power is short and the fuel can carry it
  if (areas.production && hourOfDay(state) === PLAN_HOUR) stripDeadCars(state, base); // a car worth less than its parts
}
// The cook fire comes down once the Kitchen does its job (kitchen-plus pick 5): a kitchen here with its stove lit (it
// cooks the worm's game and greens through, worm.js baseCooks), and the wood to keep it lit: KITCHEN.wood.keepDays
// of the stove beyond the day's boiler and heating in store, and wood land around the base (woodcutting.js
// woodWorkWhy) or no shortfall for the cold ahead (woodNeed). Short of wood the cook fire stays (it burns
// nothing: it is the fallback for a cold stove). Its utility plot is free again; half its scrap comes back.
// Never while the stove is let go cold for the winter's wood (stoveSave) or has been cold in the last
// KITCHEN.coldKeep days (ap-food, 2026-10-11: a stove cold for want of wood left the game and greens from infected
// land raw at a base whose cook fire had come down, until a new one was saved for and built).
export function cookFireRedundant(state, base) {
  if (!count(base, "cookhouse") || !hasKitchen(base) || kitchenCold(base) || !kitchenCanLight(state, base)) return false;
  if (base.stoveSave || (base.kitchenColdDay != null && day(state) - base.kitchenColdDay < KITCHEN.coldKeep)) return false;
  const kw = kitchenWood(state, base);
  if (Math.max(0, base.stock.wood || 0) < kw.need * KITCHEN.wood.keepDays) return false;
  return !woodWorkWhy(state, base) || !woodNeed(state, base).short;
}
// The stove kept cold for the winter's wood (kitchen.js kitchenFireDaily reads base.stoveSave): in the run-up to the cold
// (WOOD_AP.autumn days) while the woodpile is under WOOD_AP.behind of what the cold needs, the Kitchen's daily wood
// (20-40 a day) goes to the winter instead (woodtest seed 42: 28% of the cold's need with the stove lit all autumn).
// In the cold itself (ap-food) the stove goes cold while the woodpile is under what the heating alone needs for the rest
// of it (woodNeed heat, without its fifth to spare): it burned the heating's wood until the pile was down to a day of
// heat (kitchen.js kitchenCanLight), then the base froze (the census at ac1c1c6: 7.4 base-days without heat a game).
// Only with a cook fire standing, or no infected land around: the stove is what cooks the worm's game and greens.
// Land within 2 tiles infected enough that its game carries the worm's eggs (worm.js WORM.MEAT_AT).
const wormLandNear = (state, base) => state.grid.within(base.tile, 2).some((id) => (state.tiles[id].infection || 0) >= WORM.MEAT_AT);
function stoveSave(state, base) {
  if (!hasKitchen(base) || gov(state).noWood) { delete base.stoveSave; return; }
  const w = woodNeed(state, base);
  if (w.toCold > 0 && w.toCold <= WOOD_AP.autumn && w.need > 0 && w.have < w.need * WOOD_AP.behind) base.stoveSave = w.need;
  else if (w.cold && w.heat > 0 && w.have < w.heat / WOOD.spare && (count(base, "cookhouse") > 0 || !wormLandNear(state, base))) base.stoveSave = Math.ceil(w.heat / WOOD.spare); // a cook fire does the worm's cooking meanwhile
  else delete base.stoveSave;
}
function cookFireDown(state, base) {
  if (!cookFireRedundant(state, base)) return "";
  const cf = base.buildings.find((b) => b.type === "cookhouse");
  if (!cf || !canDemolish(state, base, cf.id).ok) return "";
  demolish(state, base, cf.id);
  return `The cook fire at ${base.name} came down: the kitchen's stove cooks everything through now, and its utility plot is free.`;
}
// The hourly look (hardcore): fewer lines than it would want short of food, no field job queued, and 2 scrap there
// (or gathered for the step up, or a coil of snare wire): govSnares decides.
const hourlySnares = (state, base) => playerWorks(state, base).filter((x) => x.kind === "snares").length < snareLinesWanted(state, base, 2) && !fieldJobs(state, base).length
  && ((base.stock.scrap || 0) + gatheredScrap(base) >= 2 || (base.armory || []).some((it) => it && it.key === "snarewire"));
// The food level for the snare lines (fieldworks.js govSnares, hc-food 2026-10-11): 0 fed, 1 under the base's food
// target in days a head (foodTarget, everyone fed here: upkeep.js mouthsAt), 2 under half of it.
function snareFoodLevel(state, base) {
  const days = edibleFood(base) / Math.max(1, mouthsAt(state, base).heads);
  const t = foodTarget(state, base);
  return days < t / 2 ? 2 : days < t ? 1 : 0;
}
// A base threatened enough for a watch tower out on its land (fieldworks.js govFieldWorks): the dead within 6 tiles, a
// hive within 10, a hostile group (or a raid on its way) within 12.
function fieldThreat(state, base) {
  const g = state.grid;
  if (state.hordes.some((h) => g.distance(h.tile, base.tile) <= 6 && h.size >= 10)) return true;
  if ((state.hives || []).some((h) => g.distance(h.tile, base.tile) <= 10)) return true;
  if (state.parties.some((q) => q.kind === "raid" && q.target && q.target.kind === "player" && q.target.baseId === base.id)) return true;
  return state.factions.some((f) => f.alive && attitude(f) === "Hostile" && f.bases.some((b) => g.distance(b, base.tile) <= 12));
}
// ---------- a broken well waiting for scrap ----------
// A broken well or pump the repairs cannot start for want of scrap (breakdowns.js: a proper repair 3 scrap and a part,
// a jury-rig 1 scrap, short scrap paid in parts; no scrap and no part left = nothing at all): the hour before the
// repairs start (WATER_WAIT.hour; breakdowns.js starts them at 08:00) a spare gun (repair.js spareGun: one with a
// twin here, the cheapest) is taken apart for its scrap and gun parts (inventory.js salvageAt: a scrap each), up to
// WATER_WAIT.salvage a day, until the jury-rig can be paid. While it still waits, scrap is wanted hard at this base
// and at the hub that supplies it (needs: WATER_WAIT.need, trips and trades go for it) until the repair is paid.
const WATER_WAIT = { hour: PLAN_HOUR, salvage: 2, need: 2.4 };
// Broken water fixtures at a base waiting for scrap: no repair started, someone here could do it, and neither a
// repair nor a jury-rig can be paid.
export function waterWaitsScrap(state, base) {
  return brokenAt(base).filter((fx) => {
    if (!isWaterFixture(fx) || jobFor(base, fx)) return false;
    const rig = repairPlan(state, base, fx, "rig");
    return !rig.ok && !!rig.who && /^Needs /.test(rig.why);
  }).length;
}
function waterSalvage(state, base) {
  for (let i = 0; i < WATER_WAIT.salvage && waterWaitsScrap(state, base); i++) {
    const gun = spareGun(state, base);
    if (!gun) return;
    const msg = salvageAt(state, `armory:${base.id}:list:${base.armory.indexOf(gun)}`);
    say(state, `${msg.replace(/\.$/, "")}: ${base.name}'s broken well waits for scrap.`);
  }
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
// Hunting, fishing and wood (steward.js): once a morning, one team at most out on them from this base at a time,
// the governor's hunting or fishing trip when food runs short (foodTripCands: need 1.4+, the winter stores short, or
// stocking up in autumn) or its wood trip when the land around gives too little wood (woodTripCands). Not in
// severe weather nor with raiders or a horde on the way; the style's share of the base stays home.
export function stewardLand(state, base, style = "balanced", keep = new Set()) {
  if (hourOfDay(state) !== PLAN_HOUR) return "";
  if (state.parties.some((p) => p.owner === "player" && p.leaderTrip && p.homeBaseId === base.id)) return "";
  return leaderTurn(state, style, () => {
    const P = persona(state);
    if (wxNow(state).severe || threatAt(state, base).urgent) return "";
    const home = atBase(state, base.id);
    const pool = home.filter((s) => s.health >= P.minHealth && !s.woundInfected && !s.inBed && !s.pinned && !keep.has(s.id) && !s.leader && tripFit(state, s));
    const spare = Math.min(pool.length, home.length - Math.max(2, Math.ceil(home.length * P.homeFrac)));
    if (spare < 1) return "";
    const cands = [...foodTripCands(state, base, pool, needs(state, base), P), ...woodTripCands(state, base, pool, P)].sort((a, b) => b.score - a.score);
    for (const c of cands.slice(0, 4)) {
      const party = launchTrip(state, { ...c, from: base }, pool, spare);
      if (!party) continue;
      party.leaderTrip = true;
      const what = c.food === "huntTrips" ? "hunting" : c.food === "fishTrips" ? "fishing" : "cutting wood";
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
  abandonDoomed(state); // occupy.js: an outpost that cannot be fed through the winter is given up, its people home
  planCampaign(state); // the war on the hives: today's target (its ammo want feeds needs, trades and the stations)
  emergencyTrips(state); // water under a day, food under two: a haul goes out whatever the style's team limit
  wormCureRuns(state); // the worm where nothing can cure it: the sick walk to a base that can, or meds come to them
  planSupplyRuns(state);
  planTrip(state);
  hubFoodRun(state); // a hunting or fishing trip when the food is short, outside the style's trip cadence
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
  if (!hub(state)) return; // no base left (conquest.js: the exiles): no hub to stock (needs read its stores)
  const deal = radioTradeIfShort(state, needs(state));
  if (deal) { noteTrade(state, deal); say(state, `Radio: ${deal}.`); }
  // govguns.js: a gun by radio when people at the hub go unarmed (every RADIO_EVERY days at most).
  const gunDeal = radioGunDeal(state, hub(state), needs(state), radioGunDeps(state));
  if (gunDeal) say(state, `Radio: ${gunDeal}.`);
}
// What govguns.js radioGunDeal trades with (radio.js and trade.js: passed in, they import much of the game).
const radioGunDeps = (state) => ({ hasNetwork, refusal, caravanEnRoute, tradeBase, deliveryRefusal, openRadioTrade, tradeContext, balanceWith, tradeVerdict, executeTrade, endTrade, gearBuyPrice, pendingDeal, ensureWares,
  spareValue: (f, k) => { const q = hubSpare(state, k); return q > 0 ? q * sellPrice(state, f, k, radioSpeech(state), q) : 0; } });

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
    const kk = SUPPLIES[k] && SUPPLIES[k].round ? "ammo" : FOODS[k] ? "food" : k; // rounds by calibre count as ammo here (ammo.js); a food item as food (foods.js)
    const qd = FOODS[k] ? unitsOf(k, q) : q; // food: days of it
    if ((need[kk] ?? 0) > 0.8) return { why: `${base.name} is short of ${kk}` };
    if ((kk === "food" || kk === "ammo" || kk === "water") && qd > spare[kk]) return { why: `${base.name} cannot spare ${q} ${keyWord(k)}` };
    if (payoutBreaks(state, base, { [k]: q })) return { why: `${base.name} cannot spare ${q} ${keyWord(k)} (its reserve)` }; // preserved, un-purified water
    if (supplyAmt(base.stock, k) < q) return { why: `${base.name} has only ${Math.floor(supplyAmt(base.stock, k))} ${keyWord(k)}` };
  }
  if (!matchGear(base.armory, deal.give.gear || [])) return { why: "the items are not in the armory" };
  const home = atBase(state, base.id);
  const keep = Math.max(2, Math.ceil(home.length * P.homeFrac));
  const pool = home.filter((s) => s.health >= P.minHealth && !s.woundInfected && !s.inBed && !s.pinned && s.mood >= 20 && !s.leader && s.role !== "medic" && !(base.steward && base.steward.leaderId === s.id) && tripFit(state, s));
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
      if (theirs + supplyLoad({ water: e.water * 0.5 }) + e.food * 0.5 > carryCapacity(state, crew, v)) { why = `their side is too heavy to carry home`; continue; } // the road's food: about half a kilo a day of what keeps
      est = e; form.crew = crew.map((s) => s.id); form.vehicleId = v ? v.id : null;
      break;
    }
  }
  if (!est) return { why };
  const left = Math.max(1, home.length - form.crew.length);
  const food = foodIn(base.stock) - foodIn(deal.give.supplies) - est.food;
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
  const spare = (k) => Math.max(0, Math.floor(supplyAmt(h.stock, k) - keep(k)));
  const short = [...RESERVE_KEYS, "food"].filter((k) => rs[k] && rs[k].short).sort((a, b) => rs[a].have / Math.max(1, rs[a].target) - rs[b].have / Math.max(1, rs[b].target));
  const pays = Object.keys(RADIO_CAP).filter((k) => spare(k) >= 3).sort((a, b) => spare(b) * supValue(b) - spare(a) * supValue(a));
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
  // The run's opening blurb (hardcore-start.js introCard): read and closed; the team's first order comes from the waiting
  // state (idleTeams, this same hour).
  if (card.intro) {
    state.cards.shift();
    const c = card.choices && card.choices[0];
    if (c) c.resolve(state);
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
    const ammo = baseAmmo(state, h); // ammo.js: the rounds that fit its guns
    const fighters = atBase(state, h.id).sort((a, b) => combatPower(b) - combatPower(a));
    if (P.raid && fighters.length >= 7 && fighters.slice(0, 3).reduce((a, s) => a + combatPower(s), 0) >= 14) return find(/^Send a squad/) || find(/^Ignore/);
    const spare = P.reserves ? Math.max(200, reserveStatus(state, h).ammo.target + 40) : careful(P) ? 200 : 110;
    return (ammo >= spare ? find(/^Send 40 (ammo|rounds)/) : null) || find(/^Ignore/);
  }
  if (/^A stranger at the gate/.test(t) || /^Refugees at the gate/.test(t)) {
    const h = hub(state);
    const n = atBase(state, h.id).length;
    const days = (k) => (edibleFood(h) - 5 * k) / Math.max(1, n + k);
    // Water too (economy.js): the well has to keep up with one more, or there is a stock to live on.
    const wo = waterOutlook(state, h);
    const wet = (k) => wo.dryNet - k * wo.need.rate >= -1.5 && waterIn(h.stock) / Math.max(1, n + k) >= 3 && droughtWater(state, h, n + k);
    // Crops take weeks and winter brings none: a newcomer needs real reserves (a month's going into the cold).
    // A small hub (GROW) asks GROW.foodDays a head and a half: the newcomer is a pair of hands it needs.
    const minDays = (k) => (smallColony(state, h, k) ? GROW.foodDays * 1.5 : Math.max(P.strangerDays * 2.5, seasonKey(state) === "autumn" || seasonKey(state) === "winter" ? 30 : 10));
    const ok = (k) => days(k) >= minDays(k) && wet(k) && roomFor(state, k);
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
  if (/^Bad footing/.test(t)) return ((p && (p.supplies.meds || 0) >= 2) || careful(P) ? find(/^Treat it/) : null) || find(/^Keep moving/);
  if (/^The dead ahead/.test(t)) {
    const n = Number((/About (\d+)/.exec(card.text || "") || [0, 8])[1]);
    const ms = p ? partyMembers(state, p) : [];
    const power = p ? ms.reduce((a, s) => a + combatPower(s), 0) * armedFactor(ms, sumRecs(p.supplies, carriedRec(ms)), p.supplies.arrows || 0, { need: (k) => (n * k) / Math.max(1, ms.length), short: 0.5 }) : 0; // events.js: the bows shoot arrows
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
  if (/^Abandoned supply truck/.test(t)) return careful(P) ? find(/^Leave it/) : find(/^Search it/);
  if (/^Crashed military vehicle/.test(t)) return (chance(/^Search it/) >= P.risk ? find(/^Search it/) : null) || find(/^Leave it/);
  if (/^A swollen creek/.test(t)) return (chance(/^Wade/) >= P.risk ? find(/^Wade/) : null) || find(/^Walk upstream/);
  if (/^(Wolves|Feral dogs)$/.test(t)) return (chance(/^Back away/) >= P.risk ? find(/^Back away/) : null) || find(/^Throw them/) || find(/^Drive them off/) || find(/^Back away/);
  if (/^A warning on the road/.test(t)) return (!careful(P) && chance(/^Scout ahead/) >= 0.7 ? find(/^Scout ahead/) : null) || find(/^Mark it/);
  if (/^A lonely farmhouse/.test(t)) return careful(P) ? find(/^Leave it/) : find(/^Search it/);
  if (/^(A gone-wild orchard|Brambles in fruit)/.test(t)) return find(/^Pick/);
  if (/^A roadside gas station/.test(t)) return (p && p.vehicle && !careful(P) ? find(/^Hand-pump/) : null) || find(/^Pick through/);
  if (/^An overrun camp/.test(t)) return careful(P) ? find(/^Bury/) : find(/^Search the camp/);
  if (/^A stranger with the worm/.test(t)) return find(/^Leave them food/) || find(/^Move on/);
  // Hardcore's year Calder falls (events.js HC_EVENTS).
  if (/^Gridlock$/.test(t)) return (p && p.vehicle ? find(/^Siphon/) : null) || find(/^Go through the luggage/);
  if (/^An abandoned checkpoint/.test(t)) return careful(P) ? find(/^Leave it/) : find(/^Search the crates/);
  if (/^The emergency broadcast/.test(t)) return find(/^Listen/) || find(/^Note it/);
  if (/^They would not leave/.test(t)) return (chance(/^Tell them/) >= 0.4 ? find(/^Tell them/) : null) || find(/^Move on/);
  if (/^An? .+ being looted$/.test(t)) return (!careful(P) && chance(/^Slip in/) >= 0.75 ? find(/^Slip in/) : null) || find(/^Wait for them/);
  if (/^Still in uniform/.test(t)) return find(/^Put them down/);
  if (/^A relief drop/.test(t)) return careful(P) ? find(/^Grab/) : find(/^Take it all/);
  if (/^Tempers flare/.test(t)) return (chance(/^Step in/) >= 0.5 ? find(/^Step in/) : null) || find(/^Let them/);
  if (/^Cold feet/.test(t)) return find(/^Convince/);
  if (/^Horde of /.test(t)) return (p && p.vehicle && partyFuelOf(state, p) >= 8 ? find(/^Outrun/) : null) || find(/^Hide/);
  if (card.gathering != null) return find(/^Break up/) || find(/^Back off/); // hivebirth.js: sent to break up a gathering (gatheringCands)
  if (/^A horde of /.test(t)) return (P.raid && teamAmmo(state, p, false) >= 30 ? find(/killzone/) : null) || find(/^Back off/);
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
// A small hub (GROW, ap-food 2026-10-12, user request "make them want to farm and get food more"): at most GROW.heads
// living there with the newcomers, a newcomer is hands before a mouth (they farm in season, hunt and fish in the
// winter), so the food rule asks GROW.foodDays a head (not the planner's target, which a hub of three can never reach
// for the winter) and neither winter rule turns them away. The beds still count, only those built or queued (not the
// next bunkhouse it could still save for: seed 6006's hub of four took in three more on the bunkhouse it never built,
// and crowding costs every sleeper's mood a day, morale.js: a third rested and five walked away within a month). The
// census at 27096bf lost four colonies of 1-7 people in their first hungry gap (both Turtles, seeds 6005 and 6011) that
// had turned away every stranger, refugee and recruit for months (6011: 85 days on the beds, 45 on the food target, the
// rest on the winter rules) and starved with their few hands on the plots.
export const GROW = { heads: 8, foodDays: 10 };
const smallColony = (state, h, k) => h.type === "hub" && residents(state, h.id).length + returning(state, h) + k <= GROW.heads;
function roomAt(state, h, k) {
  if (!h) return false; // no base left (conquest.js exiles): no room for anyone
  const isHub = h.type === "hub";
  const small = smallColony(state, h, k);
  const next = isHub && !small ? nextHousing(state, h) : null; // GROW: a small hub counts the beds it has and has queued
  const beds = baseBeds(h) + queuedBeds(h) + (next ? next.beds : 0);
  if (residents(state, h.id).length + returning(state, h) + k > beds + (isHub ? persona(state).crowdSlack : 0)) return false;
  // Food and water for them too (economy rework): every newcomer, whatever card brings them.
  const fh = isHub ? h : hub(state);
  if (!fh) return false;
  const n = atBase(state, h.id).length, nf = atBase(state, fh.id).length;
  const foodDays = (edibleFood(fh) - 5 * k) / Math.max(1, nf + k);
  const wo = waterOutlook(state, h);
  const foodMin = small ? GROW.foodDays : Math.max(10, foodTarget(state, fh));
  if (!(foodDays >= foodMin && wo.dryNet - k * wo.need.rate >= -1.5 && waterIn(h.stock) / Math.max(1, n + k) >= 3 && droughtWater(state, h, n + k))) return false;
  // A hub with no river or lake within a water run's reach grows only as far as its wells and rain carry it through a
  // summer (GROWTH_WATER): filters clog and cost scrap, so they do not count towards newcomers.
  if (isHub && !GROWTH_WATER.ok(state, h, k)) return false;
  if (small) return true; // GROW: hands before mouths
  // No newcomers while the winter stores would not feed them too (farming.js winterOutlook with k more mouths).
  if (winterActive(state, fh) && winterOutlook(state, fh, { extra: k + homeMouths(state, fh), also: winterPool(state, fh) }).short > 0) return false;
  // Cautious and Turtle (strictWinter; user pick 2026-10-11, ap-food): none either while the winter-stores check itself
  // comes up short (winterPlan, the people there now, as the weekly Winter stores line reads it): the census at ac1c1c6
  // lost four cautious and turtle colonies to whole-colony starvation in their second winter. Only while the winter
  // plan runs (winterActive: mid-summer to the first spring harvest; ap-food 2026-10-12): in spring and early summer a
  // newcomer still has the season to sow and tend the food they will eat (the outlook only counts the plots' crops, at
  // today's crew), and in any season it held, the colonies that refused everyone never grew and died small.
  if (persona(state).strictWinter && winterActive(state, fh) && winterPlan(state, fh).short > 0) { noteWinterRefusal(state); return false; }
  return true;
}
// The joins the strict winter rule turned away (gov stats.winterRefused: the hours it said no; the census reads it).
function noteWinterRefusal(state) {
  const g = gov(state);
  if (g.stats.winterRefusedHour === state.hour) return;
  g.stats.winterRefusedHour = state.hour;
  g.stats.winterRefused = (g.stats.winterRefused || 0) + 1;
}

// For the headless tests (tools/autosafetytest.js): the pay-out reserve, a broken well waiting for scrap, the upkeep
// hands and the newcomer rule, read-only but for salvage (it takes a spare gun apart).
export const safetyAI = {
  tradeSpare: (state, base) => tradeSpare(state, base), needs: (state, base) => needs(state, base), tributeSpared: (state, base) => tributeSpared(state, base),
  waterWaitsScrap: (state, base) => waterWaitsScrap(state, base), salvage: (state, base) => waterSalvage(state, base), upkeepCrew: (state, base, n) => upkeepCrew(state, base, n),
  roomAt: (state, base, k) => roomAt(state, base, k), planRoles: (state, base) => planRoles(state, base),
  buildWishes: (state, base) => buildWishes(state, base), // tools/kitchentest.js: the Kitchen's slot
  // tools/turtlefoodtest.js: the winter plan, the hub's food run and the game glut (FOOD_RUN)
  winterPlan: (state, base) => winterPlan(state, base), winterActive: (state, base) => winterActive(state, base), rawGlut: (state, base) => rawGlut(state, base),
  foodTripCands: (state, base) => foodTripCands(state, base, atBase(state, base.id), needs(state, base), persona(state)), hubFoodRun: (state) => hubFoodRun(state),
};

// ---------- growth and the wells ----------
// A hub with no river or lake (no stream beside it and no shore within a water run's reach, shoreFor) takes no newcomer
// past what its wells, its spring, the claimed wells hauled and its rain catchers give on an average summer day
// (economy.js summerWater with no filters: everyone drinking 1.3, the crops in the ground their share), times
// `margin` of headroom kept. (2026-10-08 thirst diagnosis: hubs of 40-50 on two wells lived on 15+ water filters; when
// the scrap for new ones ran short or the wells broke, the water ran out within days.)
export const GROWTH_WATER = {
  margin: 1.1,
  // Has the hub a river: a stream beside it, or a shore a water run can reach.
  river: (state, base) => waterProduction(state, base).stream > 0 || shoreFor(state, base) != null,
  // { river, heads }: the people its wells and rain can carry (Infinity by a river).
  cap(state, base) {
    if (GROWTH_WATER.river(state, base)) return { river: true, heads: Infinity };
    const sw = summerWater(state, base, { people: 0, filterShare: 0 }); // need: the crops and any prisoners
    return { river: false, heads: Math.max(0, Math.floor((sw.inflow / GROWTH_WATER.margin - sw.need) / (sw.rate * WATER.drink))) };
  },
  ok: (state, base, k) => residents(state, base.id).length + returning(state, base) + k <= GROWTH_WATER.cap(state, base).heads,
};

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
  if (isCamp(base)) return null; // a camp has no building plot: it is built up first (a shelter has one, for a bunkhouse)
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
// A water barrel upgraded (w.barrel: its id; buildings.js WATER_BARREL tiers): the summer store's room (waterPlan).
const wishCheck = (state, base, w) => { const c = w.barrel != null ? canUpgradeBarrel(state, base, w.barrel) : w.upgrade != null ? canExpandBunkhouse(state, base, w.upgrade) : canBuild(state, base, w.type); if (w.type === "walls") w.wallCost = c.cost || {}; return c; }; // the Ring wall: what its pieces cost (buildings.js canBuildWall)
// What a build leaves of the coming cold's wood out of the stocking season: none WOOD_BUILD_KEEP days or more before
// the cold, rising to all of it at the cold (woodtest: the pile two-fifths in by the winter with the builds taking wood;
// barestarttest: the first bunkhouse on day one, 2026-10-20).
const WOOD_BUILD_KEEP = 150, WOOD_BUILD_SMALL = 150; // KEEP: days before the cold over which the share kept rises from none to all; SMALL: a tent, a box, crates, shelves (150 since the fittings took more wood, the user's pick 2026-10-20)
// The wood a big build leaves in store (planBuilds): the fires' days, and the coming cold's need by the share above
// (once the stocking for the cold is on, all of it). woodNeed result in. govWoodwork fells toward it.
const buildWoodKeep = (wn) => (wn.soon ? wn.need : Math.max(wn.dailyKeep, wn.need * Math.max(0, Math.min(1, 1 - wn.toCold / WOOD_BUILD_KEEP))));
// Does a build of this wood keep the woodpile's reserve back (a small one, beds and the general buildings go ahead)?
// The food builds (the Kitchen, the animal pen: pt-int round 2, kitchentest) keep only the fires' days (woodNeed dailyKeep),
// not the coming cold's share: a hub of 8 needs its Kitchen before its first winter's woodpile is in, and the governor
// fells for them (govWoodwork: their wood with the fires' days as the reserve). Their wood cost stays.
const WOOD_FOOD = new Set(["canteen", "animal_pen"]);
const keepsWood = (type, wood) => wood > WOOD_BUILD_SMALL && !BEDS[type] && !GENERAL.includes(type) && !WOOD_FOOD.has(type);
// With a base: the cost as its stores pay it (buildmats.js siteCost: building materials and metal sheets they lack are
// made on site from scrap, so the scrap to save up counts them).
const wishCost = (w, base = null) => { const c = w.barrel != null ? w.cost : w.upgrade != null ? BARRACKS_UP.cost : w.wallCost || BUILDINGS[w.type].cost; return base ? siteCost(base.stock, c).take : c; };
const wishQueue = (state, base, w) => (w.barrel != null ? queueBarrelUpgrade(state, base, w.barrel) : w.upgrade != null ? queueBunkhouseExpand(state, base, w.upgrade) : queueBuild(state, base, w.type));
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
// Base building (docs/base-building/plan.md Part D; buildings.js BUILDINGS general / fit, basemap.js fittingRoom): the
// general buildings, biggest first (a barn at the hub, a hall or a lodge at an outpost, a cabin at a shelter, a hut at
// a camp: their `size`), and what the governor puts inside them.
const GENERAL = ["gen_barn", "gen_hall", "gen_lodge", "gen_cabin", "gen_hut"];
// The biggest general building this base can put up now (canBuild ok), or is only short of scrap for (saved for, like
// the bunkhouse or barracks it stands in for), or null. A building this kind of base never takes, one at its limit,
// one short of parts: the next size down.
function generalWish(state, base) {
  for (const t of GENERAL) {
    const c = canBuild(state, base, t);
    if (c.ok || /^Needs \d+ scrap/.test(c.reason || "")) return t;
  }
  return null;
}
// Beds when no bunkhouse or barracks can be queued (nextHousing: no building plot free, their limits reached, a camp
// with no building plot, a shelter whose one plot is taken): bunk beds (BEDS.bunks each) while a standing hut, cabin,
// lodge, hall or barn has floor for a pair (fittingRoom), else the biggest general building the base can put up, with
// the bunks to follow once it stands. Saved for, as the beds always are. One general building going up at a time.
function bedWishes(state, base, why, queued) {
  if (GENERAL.some((t) => queued(t))) return [];
  if (countAll(base, "bunks") + queued("bunks") < BUILDINGS.bunks.max && fittingRoom(state, base, "bunks")) return [{ type: "bunks", why: `${why}: bunk beds inside a building`, save: true }];
  const gb = generalWish(state, base);
  return gb ? [{ type: gb, why: `${why}: a ${BUILDINGS[gb].name.toLowerCase()} with bunks inside`, save: true }] : [];
}
// The housing wish can be queued, or is only short of scrap (it is saved for): the beds come from it, not from a
// general building.
const housingOpen = (state, base, hw) => hw.some((w) => { const c = wishCheck(state, base, w); return c.ok || /^Needs \d+ scrap/.test(c.reason || ""); });

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
// The summer store (summer-water, 2026-10-10). The wells, rain and filters only fill a base up to its water room
// (economy.js baseDaily, crafting.js filtersInUse), so a crowd at a hub with the bare 80 of room started each summer
// day with at most ~80 and a hot day's drinking (40 people at 1.6, the crops half again) took nearly all of it: a
// day without water whenever a heat wave came on the wrong day (farmtest: 1 dry day on 2-3 of 8 seeds, the stock
// hovering 30-60 all summer). From SUMMER_STORE.lead days before summer (the last three weeks of the 4-week
// spring, as the filters) and through it, the governor wants `days` average summer days of drinking and the crops'
// dry-day watering in store, for everyone it plans water for (residents, teams out, the hub's headroom:
// summerWater's n), and room for it at `fill` of the capacity (buildWishes: a cistern, else water barrels, else
// barrels upgraded; saved up for, and ahead of a full build queue). Under `runBelow` of that store, water is wanted
// (needs: trades and trips go for it at `want`), a water run goes out (waterRunWanted) and an outpost is topped up
// (outpostThirsty). Shelters and camps (no plots, a step up first) are left out.
// Over 32 seeds of farmtest's 35-person hub (its summer-plan setup, 40 days from 18 days before summer; dev at
// 3d71cdf vs this): 6 dry days on 6 seeds before, none after; the lowest summer stock median 53 → 136; dead or
// walked away 207 → 227 (collapses 8 → 7). Over 8 Balanced and 8 Cautious 365-day games: thirst days 3 → 0,
// harvests and builds level.
export const SUMMER_STORE = { lead: 21, days: 3, fill: 0.9, runBelow: 0.6, want: 1.6 };
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
  // The summer store and the room it takes (SUMMER_STORE): the cisterns and barrels queued count as room.
  const lead = !isShelter(base) && (s.key === "summer" || (s.key === "spring" && s.daysLeft < SUMMER_STORE.lead));
  const store = lead ? Math.ceil((sw.n * sw.rate * WATER.drink + sw.crops) * SUMMER_STORE.days) : 0;
  const tierCap = (t) => (WATER_BARREL.tiers[t] ? WATER_BARREL.tiers[t].cap : 0);
  const queuedRoom = base.construction.reduce((a, c) => a + (c.type === "cistern" && !c.target ? WATER.cistern : c.type === "water_barrel" ? (c.target ? tierCap(c.tier) - tierCap(c.tier - 1) : tierCap(1)) : 0), 0);
  const roomShort = Math.max(0, Math.ceil(store / SUMMER_STORE.fill) - sw.cap - queuedRoom);
  const reserve = Math.min(Math.floor(sw.cap * 0.9), Math.max(sw.reserve, n * (near ? 10 : 7), store));
  const low = lead && waterIn(base.stock) < Math.min(store, reserve) * SUMMER_STORE.runBelow;
  // Broken water fixtures: a proper repair each (3 scrap, 1 part); filters still to make: 4 scrap each, two at a time.
  const brokenWater = brokenAt(base).filter((fx) => (fx.type === "well" || fx.type === "pump") && !jobFor(base, fx)).length;
  const have = [...base.armory, ...atBase(state, base.id).map((x) => x.gear.tool)].filter((it) => it && it.key === "waterfilter").length;
  const crafter = atBase(state, base.id).some((x) => skill(x, CRAFTS.waterfilter.skill) >= CRAFTS.waterfilter.min);
  // Scrap for filters is held only while it matters: summer near and short, or the water running low now.
  const urgent = (near && (sw.net < 0 || sw.reserve > sw.cap)) || dryGap > 0;
  // The water boiler (worm.js) burns wood, not scrap: its wood is planned with the heating (woodcutting.js woodNeed).
  const hold = { scrap: brokenWater * 3 + (crafter && urgent ? Math.min(2, Math.max(0, filters - have)) * CRAFTS.waterfilter.in.scrap : 0), parts: brokenWater };
  // The wells the summer wants with the filters left out (summerWater's fix: wells first, steady; the filters are the
  // stopgap that clogs in about 20 days and costs scrap): sw.fix counts the filters made, and the filters crafted in
  // the weeks before summer (no build slot needed) closed the gap ahead of the wells still waiting behind the beds in
  // the queue, so the well wishes went and the summer ran on filters alone (farmtest's big hub: 2 wells at 80faa5e,
  // 1 at 3e7a7e5, none since).
  const steady = summerWater(state, base, { extra: returning(state, base) + (base.type === "hub" ? SUMMER_HEADROOM : 0), filterShare: 0 }).fix.find((f) => f.type === "well");
  const out = { sw, near, filters, reserve, hold, brokenWater, short: sw.net < 0 || sw.reserve > sw.cap, lead, store, roomShort, low, wells: steady ? steady.count : 0 };
  waterMemo.map.set(base.id, out);
  return out;
}
// How full the water filters keep a base's tanks under the governor (crafting.js filtersInUse, base.filterFill):
// SUMMER_STORE.days of today's drinking and watering, or the summer store when that is more, never past the room.
// The room built for the summer store is not filled to the brim by filters that clog as they run (the re-pack
// crafts it cost: worktest's craft check); the wells, rain and hauls still fill it.
function filterFill(state, base) {
  return Math.max(waterPlan(state, base).store, Math.ceil(waterNeed(state, base).total * SUMMER_STORE.days));
}
// Water is tight at a base: it runs out within 8 days at today's rate. The governor rations then: no water into
// the still or the preserving room (visitors.js: no guests sheltered on a low stock either).
function waterTight(state, base) {
  const wo = waterOutlook(state, base);
  return wo.net < 0 && wo.daysLeft < 8;
}
// A water run is worth it: water is tight, or summer is near (or here), falls short and the stock is under half
// the summer reserve, or the stock is under the summer store's floor (SUMMER_STORE.runBelow: waterPlan low).
function waterRunWanted(state, base) {
  const wp = waterPlan(state, base);
  return waterTight(state, base) || (wp.near && wp.short && waterIn(base.stock) < wp.reserve * 0.5) || wp.low;
}
// Scrap (or parts) held back for water at a base: other builds, repairs and crafts leave it alone.
const WATER_BUILDS = ["well", "rain_catcher", "cistern", "boiler", "water_barrel"]; // the boiler: safe water (worm.js)
// Also what an urgent gear repair waits for (repair.js repairHold): the stores keep it for the repair.
// The radio station's parts while the governor wants one for the groups out of reach (buildWishes, g.radioWant in the
// last 3 days): other builds leave them, trips and trades go for them (needs).
const radioHold = (state, base) => { const g = state.governor; return g && base.type === "hub" && !base.radio && g.radioWant != null && day(state) - g.radioWant <= 3 ? BUILDINGS.radio.cost.parts : 0; };
// What this base's own step up still lacks of a material (not counting its stores).
function ownShort(base, k) {
  const job = tierUpJob(base);
  return job && job.paid ? gatherRows(job).filter((r) => r.key === k).reduce((a, r) => a + Math.max(0, r.need - r.have), 0) : 0;
}
// What the step ups of the hub's own shelter and its outpost camps still lack of a material, past their own stores.
function matShort(state, h, k) {
  let n = 0;
  for (const o of state.bases) {
    if (o !== h && o.type !== "outpost") continue;
    const job = tierUpJob(o);
    if (!job || !job.paid) continue;
    for (const r of gatherRows(job)) if (r.key === k) n += Math.max(0, r.need - r.have - (o === h ? 0 : Math.floor(o.stock[k] || 0)));
  }
  return n;
}
// The hub's scrap and parts held for its outpost camps (buildings.js outpost_up): what their step ups still lack past
// their own stores, so the hub's own builds do not eat what a supply run should carry there (campShort).
const campHold = (state, base, k = "scrap") => {
  if (base.type !== "hub") return 0;
  let n = 0;
  for (const o of state.bases) {
    const job = o.type === "outpost" ? tierUpJob(o) : null;
    if (!job || !job.paid) continue;
    for (const r of gatherRows(job)) if (r.key === k) n += Math.max(0, r.need - r.have - Math.floor(o.stock[k] || 0));
  }
  return n;
};
const waterHold =(state, base, k = "scrap") => (base.owner == null || base.owner === "player" ? (waterPlan(state, base).hold[k] || 0) + repairHold(state, base, k) : 0);

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
// Without a governor (the work priorities read it too: farmCrewLimits) the day's plan is kept per world, and no
// governor record is made for it.
const PLAN_MEMO = new WeakMap();
function winterPlan(state, base) {
  let memo;
  if (state.governor) { const g = state.governor; memo = g.winter || (g.winter = {}); }
  else { memo = PLAN_MEMO.get(state); if (!memo) PLAN_MEMO.set(state, (memo = {})); }
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
  const fresh = Math.floor(st.fresh), pres = Math.floor(st.stable); // storage.js: days of fresh food (needs a room) and of food that keeps
  const verdict = w.short > 0
    ? `short by about ${w.short}${w.runsOut != null ? `, out of food around day ${w.runsOut + 1}` : ""}: more farmers, food trips and preserving, and no newcomers until it is covered`
    : `enough, about ${Math.max(0, w.end)} to spare`;
  say(state, `Winter stores at ${h.name}: ${fresh + pres} days of food (${fresh} fresh, ${pres} that keeps; food rooms ${st.cap}${st.outside >= 1 ? `, ${Math.floor(st.outside)} stored outside` : ""})${w.bases > 1 ? ` plus ${Math.max(0, w.have - fresh - pres)} at the outposts` : ""}, about ${w.crops} still to come from the fields. The ${w.people} people${w.bases > 1 ? " (outposts and teams too)" : ""} need about ${w.need + w.spoil + w.seed} (eating ${w.need}, spoilage ${w.spoil}, spring seed ${w.seed}) to reach the first spring harvest around day ${w.gap.end + 1}, plus ${w.margin} to spare for bad luck: ${verdict}.`, w.short > 0 ? "danger" : "info");
}

const partyFuelOf = (state, p) => partyFuel(state, p); // every car's tank and the cans (vehicles.js fleets)
// Rough hours until a team is home: the way left, plus (going out) the job and the same way back.
const tripHoursLeft = (state, p) => (p.phase === "back" ? hoursLeft(state, p) : 2 * hoursLeft(state, p) + 10);
// Days of food and water a team carries on the move (extra = more mouths; a loaded team eats more, load.js; food at
// today's cold, no camp fire on the move: weather.js foodNeedFactor).
function carriedDays(state, p, extra = 0) {
  const n = partyMembers(state, p).length;
  const perDay = (n ? partyPace(state, p).eatMove : 0) + extra;
  const have = (k) => (k === "water" ? teamWaterIn(p) : k === "food" ? foodIn(p.supplies || {}) + foodIn((p.cargo && p.cargo.supplies) || {}) : (p.supplies[k] || 0) + ((p.cargo && p.cargo.supplies[k]) || 0)); // water: both kinds; food: days of it (foods.js)
  return Math.min(have("food") / foodNeedFactor(state), have("water") / thirstAt(state)) / Math.max(1, perDay); // water: at today's thirst, food at today's cold (weather.js)
}

// Conflict cards (conflicts.js): every option is scored from the odds the card shows.
function bestByUtility(state, card, opts, P) {
  let best = null, bestU = -Infinity;
  for (const ch of opts) {
    const u = PAY_RANSOM.test(ch.label) ? payUtility(state, card) : utility(ch, P);
    if (u > bestU) { best = ch; bestU = u; }
  }
  return best;
}

// A ransom paid from what the team carries (conflicts.js rescue, trade-visit and road cards): by the value rule
// (ransom.js teamPayOk: your people worth the price, the team's food and water for the road home kept), not always.
const PAY_RANSOM = /^Pay (a|the) ransom|^Pay for them/;
function payUtility(state, card) {
  const c = card.conflict || {};
  const p = state.parties.find((x) => x.id === card.partyId);
  const f = factionById(state, c.factionId);
  const held = (c.held || []).map((id) => survivorById(state, id)).filter((s) => s && isCaptive(s));
  if (!p || !f || !held.length) return 0.4; // strangers only: no better than leaving
  return teamPayOk(state, p, f, held, ransomValue(f, held.length + (c.strangers || 0))) ? 5 : -1;
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
  if (/^Leave|^Not now/.test(L)) return 0.5;
  return 0;
}

// Raid warning: rally the guards first (roles change at once), then judge the odds with everyone on alert. Below
// the style's hold ratio it weighs the tribute against what a fight is likely to cost (factions.js raidStakes:
// stolen stock, wrecked buildings, wounds): Cautious pays when the tribute is under 1.4× that, Balanced under 1×,
// Aggressive under 0.6× (and it fights in person first when the odds are poor).
const TRIBUTE_LEAN = { Cautious: 1.4, Balanced: 1, Aggressive: 0.6 };
const RAID_BREAK = 0.8; // factions.js RAIDS.BREAK: below it a raid overruns the base
// Never out of the food reserve (upkeep.js PAYOUT): a group's tribute (factions.js tributeNow: 30% of the fresh food)
// that would leave the base under PAYOUT.days of food is not paid.
function tributeSpared(state, base) {
  const food = Math.min(Math.floor(foodIn(base.stock)), Math.ceil(foodIn(base.stock) * 0.3));
  return !payoutBreaks(state, base, { food });
}
function raidWarningChoice(state, card, opts, P) {
  const find = (re) => opts.find((c) => re.test(c.label));
  const base = state.bases.find((b) => card.title === `Raiders heading for ${b.name}`);
  const raid = base && state.parties.find((q) => q.kind === "raid" && q.target && q.target.kind === "player" && q.target.baseId === base.id && !q.returning);
  if (!base || !raid) return find(/^Prepare/);
  planRoles(state, base);
  const stakes = raidStakes(state, base, raid);
  if (stakes.ratio >= P.holdRatio) return find(/^Prepare/);
  const pay = stakes.tribute < stakes.fight * (P.tributeLean ?? TRIBUTE_LEAN[P.name] ?? 1) && tributeSpared(state, base) ? find(/^Pay tribute/) : null;
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
  if (!home) return firstHubPending(state) ? roadAct(state, p) : exileAct(state, p); // no base: Establish base (staging.js)
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
  // A hive or growth squad (fires set, or backed off) goes home: no searching on the hive's land on the way.
  if ((p.apChain || 0) < P.chain && !["outpost", "hive", "growth"].includes(p.mission) && chainNext(state, p)) return;
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
    // The governor redirects the team, as you could (orders reach a team anywhere, plans.js commandable): it holds at
    // the site as a plain move. The note is the governor's own, so it sends the team in afterwards.
    if (commandable(state, p)) {
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
    if (p.hiveCrawl) { if (!hasCard && !state.combat) hiveCrawlAutoStep(state, p); continue; } // a hive crawl: follow the warmth to the core (hivecrawl.js)
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
    // A guarded or badly infested site: a good scout looks it over first, in the arrival hour (raidplan.js).
    const sc = !e.approach && !e.scout ? engScoutChoices(state, p, e)[0] : null;
    if (sc && sc.odds >= SCOUT.BOT_ODDS && (e.guarded || state.tiles[e.tile].infection > 0.35)) engScout(state, p, sc.id);
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
  if (careful(P) || e.guarded || t.infection > 0.5) return P.raid && power >= 16 && !e.guarded ? "normal" : "sneak";
  if (P.raid && power >= 12 && teamAmmo(state, p, false) >= members.length * 18) return "loud";
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
  if (teamAmmo(state, p, false) < members.length * 2 && e.heat >= 25) return true;
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
    // The base they stopped at pays: its own needs and what it can spare (an outpost's, not the hub's).
    const at = ctx.base || hub(state);
    say(state, `Outsiders (${ctx.f.name}) at ${ctx.base ? ctx.base.name : "the roadside"}: ${autoVisitorTrade(state, needs(state, at), gov(state).personality, tradeSpare(state, at))}.`);
    return;
  }
  if (ctx.kind === "radio") { state.trade = null; return; } // a radio trade left open by hand (radiotrade.js): closed
  if (ctx.kind === "meet") { // a group's caravan met at a tile (trademeet.js): the deal agreed over the radio, nothing else
    const v = tradeVerdict(state);
    say(state, `Caravan from ${ctx.f.name} met at ${tileLabel(state, ctx.center)}: ${v.ok && v.honoured ? executeTrade(state).replace(/\.$/, "") : "nothing was agreed beforehand"}.`);
    endTrade(state);
    return;
  }
  if (ctx.kind === "caravan") {
    // Their caravan at one of your bases (caravans.js): only the Aggressive style ever attacks one.
    say(state, `Caravan from ${ctx.f.name} at ${ctx.base.name}: ${autoCaravanTrade(state, needs(state, ctx.base), gov(state).personality, tradeSpare(state, ctx.base)).replace(/\.$/, "")}.`);
    return;
  }
  const { p, f, speech } = ctx;
  const have = {};
  for (const k of Object.keys(SUPPLIES)) have[k] = Math.floor(p.supplies[k] || 0) + Math.floor(p.cargo.supplies[k] || 0);
  const g = gov(state);
  const need = foodNeeds(needs(state), ctx.theirHave, have); // foods.js: food bought and sold as items
  const home = state.bases.find((b) => b.id === p.homeBaseId) || hub(state);
  const back = planPath(state, partyTile(p), home.tile, p.vehicle);
  const n = partyMembers(state, p).length;
  const road = Math.ceil((n * ((back ? back.cost : 24) + 8)) / 24 * 1.3) + 1;
  // Offer what the hub has plenty of (keeping food and water for the road), ask for what it needs most.
  const spare = {};
  const keep = { food: road, water: road, meds: 2, ammo: 5 * n, fuel: p.vehicle === true && back ? Math.ceil(back.cost) : 0 };
  for (const k of Object.keys(SUPPLIES)) if (need[k] <= 0.8) spare[k] = Math.max(0, (have[k] || 0) - (keep[k] || (FOODS[k] ? Math.ceil(qtyOf(k, keep.food)) : 0))); // a food item keeps the road's days of it
  // Prices move with the amount (trade.js: a big sale pays less a unit, a big buy costs more), so every amount is
  // priced as a whole, the way the trade window totals it; asking at single-unit prices got deals refused.
  let budget = Object.entries(spare).reduce((a, [k, q]) => a + (q > 0 ? q * sellPrice(state, f, k, speech, q) : 0), 0);
  const ask = {};
  const caps = { meds: 10, parts: 6, food: 40, fuel: 20, ammo: 120, scrap: 40, water: 20, wood: 600 }; // wood: 60 kg of wood
  for (const k of ["gunparts", "carparts", "electronics"]) caps[k] = Math.max(1, Math.min(6, partDeficit(state, home, k))); // repair.js: up to the reorder level
  for (const [k, v] of Object.entries(reloadCaps(state, home))) caps[k] = Math.max(1, v); // reloading.js: powder and primers up to the bench's stock
  let askValue = 0;
  // Only what they can spare and the team can carry home (trade.js refuses the whole deal otherwise).
  let room = cargoRoom(state, p);
  // A Kevlar kit or a field repair kit from their wares while the base is short of one (repair.js kitWants).
  const askGear = [];
  for (const k of kitWants(state, home)) {
    const it = (f.wares || []).find((x) => x && x.key === k);
    if (!it || budget <= 0) continue;
    const cost = gearBuyPrice(state, f, it, speech);
    if (cost > budget || (GEAR[k].weight || 1) > room) continue;
    askGear.push(it); askValue += cost; budget -= cost; room -= GEAR[k].weight || 1;
  }
  // A gun for the unarmed at home (govguns.js: its guards and scavengers with only a club too), from their shelf.
  const gun = pickGunToBuy(state, home, (f.wares || []).filter((x) => !askGear.includes(x)), (it) => gearBuyPrice(state, f, it, speech), budget, room);
  const gunCost = gun ? gearBuyPrice(state, f, gun, speech) : 0;
  if (gun) { askGear.push(gun); askValue += gunCost; budget -= gunCost; room -= GEAR[gun.key].weight || 1; }
  for (const k of Object.keys(need).sort((a, b) => need[b] - need[a])) {
    if (need[k] < 1.2 || budget <= 0 || !SUPPLIES[k]) continue;
    const kk = k === "ammo" ? wantedKey(partyCals(state, p), ctx.theirHave) : k; // ammo.js: generic ammo asked for as the rounds that fit the team's guns
    if (!kk) continue;
    const q = maxBuyable(state, f, kk, speech, budget, Math.min(caps[k] || (FOODS[k] ? Math.ceil(qtyOf(k, caps.food)) : 10), Math.floor(room / supWeight(kk))));
    if (q <= 0) continue;
    const cost = q * buyPrice(state, f, kk, speech, q);
    room -= q * supWeight(kk);
    ask[kk] = q;
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
    state.trade.askGear = askGear;
    const res = executeTrade(state);
    const list = (o) => Object.entries(o).map(([k, q]) => `${q} ${keyWord(k)}`).join(", ");
    if (/^Traded/.test(res)) {
      g.stats.trades++;
      if (gun) noteGunBought(state, gun, gunCost, "visit"); // govguns.js: the tally
      text = `traded ${list(offer)} for ${[list(ask), ...askGear.map((x) => x.name)].filter(Boolean).join(", ")}`;
    } else text = `no deal (${res})`; // e.g. more than the team can carry
  }
  if (ctx.nomad) { say(state, `Trade with nomads (${f.name}): ${text || "nothing worth swapping"}.`); endTrade(state); return; } // nomads.js: no pacts, no envoy's gifts, no coalition
  if (!f.pact) {
    const r = proposePact(state, f, f.goodwill >= 20 ? "trade" : "nonaggression");
    if (/signed/.test(r)) text += `${text ? "; " : ""}${r.toLowerCase().replace(/\.$/, "")}`;
  }
  // An envoy (envoyCandidate) gives what it brought and did not trade as a gift while their goodwill is short.
  if (p.apEnvoy === f.id && f.goodwill < ALLIANCE.GOODWILL + 10 && state.trade) {
    const gift = {};
    { const q = Math.floor(foodIn(p.supplies) - (keep.food || 0)); if (q > 0) Object.assign(gift, sellPick({ supplies: p.supplies }, q)); } // foods.js: days of food as the items it holds most of
    { const q = Math.floor((p.supplies.meds || 0) - (keep.meds || 0)); if (q > 0) gift.meds = q; }
    Object.assign(gift, spareRounds(p.supplies, keep.ammo, partyCals(state, p))); // ammo.js: rounds above the keep, the ones its guns need least
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
  // woodcutting.js: the wood in store covers its share first (HEAT.wood fuel a unit), so the fuel is wanted only
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
  // Water and food never below the pay-out reserve (upkeep.js payoutSpare: PAYOUT.days of everyone's need), whatever
  // the needs table rates them (a hub whose wells keep up rates its water plenty and sold it all).
  return { food: short ? 0 : Math.min(payoutSpare(state, h, "food"), Math.max(0, Math.floor(edibleFood(h) - foodTarget(state, h) * 1.5 * heads))), water: payoutSpare(state, h, "water"), ammo: Math.max(0, Math.floor(baseAmmo(state, h) - Math.max(campaignAmmoTarget(state), n * 15))) };
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
      return Math.max(pick(Math.min(d, dSteady), [[4, 2.5], [8, 1.6], [15, 0.8], [Infinity, 0.2]]), baseWater(state, h).safe ? 0 : 1.4, wp.near && wp.short && waterIn(st) < wp.reserve ? 1.4 : 0, wp.low ? SUMMER_STORE.want : 0);
    })(),
    // Meds: by stock per head, and wanted hard while the sick here need more doses than there are (health.js courses).
    meds: Math.max(pick(st.meds || 0, [[2, 2.5], [n * 0.6, 1.8], [n * 1.5, 1], [Infinity, 0.3]]), medsToTreatAll(state, h) > (st.meds || 0) ? 2.2 : 0),
    scrap: pick(st.scrap || 0, [[20, 2.5], [45, 1.6], [90, 0.9], [Infinity, 0.35]]),
    parts: pick(st.parts || 0, [[2, 2], [6, 1.2], [12, 0.6], [Infinity, 0.2]]),
    // The hive campaign's stockpile (campaignAmmoWant: up to 2.4, under water's and food's 2.5+ when those are short).
    ammo: Math.max(pick(baseAmmo(state, h), [[n * 6, 2], [n * 15, 0.9], [n * 40, 0.35], [Infinity, 0.1]]), campaignAmmoWant(state)),
    fuel: Math.max(vehicle ? pick(st.fuel || 0, [[12, 1.6], [35, 0.8], [Infinity, 0.2]]) : 0.15, heatFuelWant(state, h).want, campaignFuelWant(state)), // needs-gauges: winter heating; the campaign's fires
    // Empty jars for the preserving room (storage.js), once there is one.
    jars: count(h, "kitchen") ? pick(st.jars || 0, [[4, 1.3], [12, 0.7], [Infinity, 0.1]]) : 0,
    // Building materials (data.js buildmat): wanted hard while a camp or shelter waits for them, else hardly (picked up
    // along the way; a standing want took teams off the winter's wood trips: woodtest).
    buildmat: matShort(state, h, "buildmat") > (st.buildmat || 0) ? 2.2 : 0.1,
    // Wood (woodcutting.js): bought only when the cold is near or here and the store is low; never sold (0.9).
    wood: (() => { const w = woodNeed(state, h, returning(state, h)); return w.short && (w.cold || w.toCold <= 14 || w.pressing) && w.have < w.need * 0.3 ? 1.6 : 0.9; })(), // the boiler (worm.js) burns it in every season
  };
  // A broken well or pump here (or, at the hub, at an outpost it supplies) waiting for scrap (waterWaitsScrap): scrap
  // is wanted hard until the repair can be paid.
  const waits = waterWaitsScrap(state, h) + (h.type === "hub" ? state.bases.filter((o) => o.type === "outpost").reduce((a, o) => a + waterWaitsScrap(state, o), 0) : 0);
  if (waits && (st.scrap || 0) < 3 * waits + 1) out.scrap = Math.max(out.scrap, WATER_WAIT.need);
  // Parts by kind (repair.js partNeeds): bought below their reorder levels, never sold; machine parts gain the urgency.
  const pn = partNeeds(state, h);
  for (const k of ["gunparts", "carparts", "electronics"]) out[k] = pn[k];
  out.parts = Math.max(out.parts, pn.parts > 1.5 ? pn.parts : 0);
  if (radioHold(state, h) && (st.parts || 0) < BUILDINGS.radio.cost.parts + 2) out.parts = Math.max(out.parts, 1.6); // the radio station's parts (buildWishes)
  if (h) Object.assign(out, reloadNeeds(state, h)); // reloading.js: powder and primers bought for a reloading bench, kept for one
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
  const rounds = baseAmmo(state, base); // ammo.js: the rounds that fit the guns here
  out.ammo = row(rounds, fight * battles, null, `${battles} break-in battles at about ${fight} each (threat ${threat}): rounds that fit the guns here`);
  out.ammo.battles = Math.round((rounds / fight) * 10) / 10;
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
// The farm crew (planRoles): extra = the ideal crew's multiple put on the plots while food is short (it was every
// day food was not plentiful); share = the most of the people here on the plots while the food is comfortable;
// winterMargin = the winter outlook's safety margin (15% of the hungry gap's food) times this left over to count as
// comfortable.
export const FARM_AP = { extra: 1.6, share: 0.35, winterMargin: 2, plotHands: 1.0 }; // plotHands: planRoles farmShort
// The farmers short of plots (planRoles g.farmShort) is held this many hours once seen; plotsShort reads it.
const FARM_SHORT_HOLD = 72;
const plotsShort = (state, base) => !!(state.governor && state.governor.farmShort && state.governor.farmShort[base.id]);
// The farm crew's limits by the food, one rule for the governor (planRoles, and so the base leaders' stewards) and the
// work priorities (work.js Farm): hungry = the food below its target (at least 15 days) or the winter stores short:
// the extra crew (FARM_AP.extra × the ideal) may go out; comfy = the food at its target and the winter outlook left
// with FARM_AP.winterMargin × its safety margin: the crew is capped at FARM_AP.share of the people here (cap; Infinity
// otherwise). foodDays: edible food a head here; heads: the people here.
export function farmCrewLimits(state, base, foodDays, heads) {
  const target = Math.max(15, foodTarget(state, base));
  const wp = winterPlan(state, base);
  const P = state.governor || stewardCtx ? persona(state) : null; // homeFood (Turtle): half as much margin again before the crew is capped
  const comfy = foodDays >= target && wp.short <= 0 && wp.end >= wp.margin * FARM_AP.winterMargin * (P && P.homeFood ? 1.5 : 1);
  return { hungry: foodDays < target || winterShort(state, base) > 0, comfy, cap: comfy ? Math.max(1, Math.ceil(heads * FARM_AP.share)) : Infinity };
}
export const ROLE_AREA = { water: "food", cook: "food", hunt: "food", fish: "food", forage: "food", farm: "food", wood: "production", medic: "medical", trainee: "medical", guard: "defence", operate: "production", craft: "production", build: "building", rest: "roles", scavenge: "roles", teach: "roles", read: "roles", haul: "production" };

function planRoles(state, base, areas = ALL_AREAS) {
  const people = atBase(state, base.id);
  if (!people.length) return 0;
  const g = gov(state);
  const P = persona(state);
  const free = new Set(people);
  const want = new Map();
  const give = (s, role, station = null, upkeep = false) => { want.set(s.id, { role, station, upkeep }); free.delete(s); };
  // 0. Pinned people (s.pinned, the survivor screen and the base's people list) keep what they do, and so does
  // anyone in a role whose area this base's steward was not handed.
  // People on work priorities (work.js) run themselves: a steward leaves them alone (the dev autopilot only with
  // its test switch governor.priorityRoles; otherwise it sets every role, as before).
  const byPriority = (s) => (!state.autopilot || g.priorityRoles) && isManaged(state, s);
  for (const s of people) if (s.pinned || !areas[ROLE_AREA[s.role]] || byPriority(s)) give(s, s.role, s.role === "operate" ? s.station : null);
  for (const s of [...free]) if (onHaulTrip(state, s)) give(s, "haul"); // hauling.js: out on the road with a load, a hauler till home
  const kept = new Set(want.keys()); // a Manual "Cook + second job" (kitchen.js s.cookPlus) keeps it only while kept here
  // ...and anyone the leader or the governor moved off a stalled job this morning (idlework.js leaderIdleHour), for the day.
  for (const s of [...free]) if (s.govIdle && state.hour < s.govIdle.until && !s.inBed && areas[ROLE_AREA[s.govIdle.role]]) give(s, s.govIdle.role, s.govIdle.station);
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
  // 1'. Sick people rest (sickrest.js: any illness, by the Work tab's "Sick people rest"): set aside here and given
  // Rest after the guards for a raid or a horde at the door (step 3), which may take them to the walls as before.
  const sick = [...free].filter((s) => sickRestWhy(state, s));
  for (const s of sick) free.delete(s);
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

  // (1d, the generator's steady keeper, is gone: machines-2, generators run with no operator, power.js; the refuelling
  // is a chore of the least busy hand, power.js refuelChore.)

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
  // 1b''. A basic tool queued (planCrafts: a makeshift hammer, saw, shovel or axe nothing here covers) gets its crafter
  // ahead of the food: a few hours' work that the builds and recipes needing it wait on (hcstarttest: a shelter's
  // makeshift hammer sat 27 days behind the fields with 150 scrap in store, its step up into a base never queued).
  if (areas.production && ![...want.values()].some((w) => w.role === "craft")) {
    const tj = craftQueue(base).find(isBasicToolJob);
    const c = tj && ranked("craft", (x) => craftSkill(x), (x) => !x.inBed && canAttempt(x, CRAFTS[tj.recipe]))[0];
    if (c) give(c, "craft");
  }

  // 1b'. Fetch water (economy.js, jobtrips.js): the water running short, a river or lake tile in the base's own land and a
  // water boiler or a water filter here to make it safe: water carriers bring it in by the bucket (un-purified) until the
  // wells and catchers catch up, as many as close the day's shortfall (at most a quarter of the people, one at a small base).
  if (areas.food && waterRunningShort(state, base) && !fetchWaterWhy(state, base) && (count(base, "boiler") > 0 || base.armory.some((it) => it && it.key === "waterfilter"))) {
    const wo = waterOutlook(state, base), each = Math.max(0.5, fetchWaterDay(state, base));
    const n = Math.min(Math.max(1, Math.floor(people.length / 4)), Math.max(1, Math.ceil(Math.max(0, -wo.net) / each)));
    for (const s of ranked("water", (x) => (x.health ?? 100) / 10, (x) => !x.inBed && !x.leader).slice(0, n)) give(s, "water");
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

  // 1e. The Kitchen's cooks (kitchen.js): one per KITCHEN.perCook people living here, the best at Cooking, ahead of the
  // farms, the hunters and the stations (it was 5c, after them, and a small base on short food had no cook at all): a
  // cook feeding twelve saves about a ration and a quarter a day (−10% of what they eat) and lifts everyone's mood.
  // Part-time (kitchen-plus pick 2): on Cook only in the cooking hours (it plans
  // every hour; the rest of the day they are planned like anyone else, and the kitchen counts them by s.cookHour), the
  // same people each day (whoever cooked last comes first; hunters and fishers last: dusk is their hour), and nobody while
  // the stove has no wood to light it. Cheap: the farms and the other daily jobs count people at their midnight job,
  // so the cooking hours cost only the hourly work (building, crafting, a trip cut short).
  if (areas.food && hasKitchen(base) && isCookHour(hourOfDay(state)) && kitchenCanLight(state, base)) {
    const have = people.filter((s) => (want.get(s.id) || {}).role === "cook").length;
    for (const s of ranked("cook", (x) => skill(x, KITCHEN.skill) + (cookedLately(state, x) ? 4 : 0) - (x.role === "hunt" || x.role === "fish" ? 6 : 0), (x) => !x.inBed).slice(0, Math.max(0, cooksWanted(state, base) - have))) give(s, "cook");
  }

  // 2. Farming (farming.js): crops take days to ripen, and more and better farmers per plot give a bigger
  // harvest. Enough farmers for the plots in use (the "ideal" crew when food is short).
  let farmers = people.filter((s) => byPriority(s) && s.role === "farm").length; // farmers by priorities count too (farmShort)
  // While the food is comfortable the crew is capped at FARM_AP.share of the people here, however many plots there
  // are: the plots' own "need" crew (0.6 a plot) took every hand once the farm plots had grown past the people
  // (2026-10-08: 30 plots for 10-14 people, 85% of the colonist-days on Farm with 130+ days of food in store). A plot
  // nobody tends still gives 55% (farming.js tendMult), so the plots are all sown anyway; short of food the cap is off
  // and the crew grows as before. Comfortable: the food at its target and, in every season (spring too, while next
  // winter's crops are still to be sown), the winter outlook (farming.js winterOutlook, its crops at today's care:
  // fewer farmers, smaller harvests) left with FARM_AP.winterMargin times its safety margin at the first spring harvest.
  const farmLim = farmCrewLimits(state, base, foodDays, people.length); // one rule with the work priorities (work.js Farm)
  const farmCap = farmLim.cap;
  const farmTo = (want) => {
    if (!areas.food) return;
    const target = Math.min(want, farmCap);
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
  // 2a'. The animal pens (farming.js PEN): a keeper on each before the rest of the food work (ahead of the
  // hungry crew too: a kept pen is the surest food there is), the best at Farming (a pen nobody keeps gives nothing).
  if (areas.food) for (const station of stations(base)) {
    if (BUILDINGS[station.type].station !== "livestock" || [...want.values()].some((w) => w.station === station.id) || !stationWorth(state, base, "livestock", station)) continue;
    const op = ranked("operate", (x) => skill(x, "farming") + (x.station === station.id ? 3 : 0), (x) => !x.inBed)[0];
    if (op) give(op, "operate", station.id);
  }
  if (foodDays < 4) farmTo(fw.ideal);
  // 2b. Food from the land (hunting.js): a hunting cabin's hunters and fishers by the water while food is not
  // plentiful. A hunter at a cabin in good game country brings in several farmers' worth (if it has a weapon), so they
  // go before the comfortable farm crew and the stations. No fixed cap (tune-jobcaps: it was two hunters at 8+ people,
  // else one, and as many fishers): as many as close the food the land must bring in (huntWorkCap / fishWorkHands:
  // the day's eating and the stores refilled, less the plots), up to a fifth of the people ahead of the farm
  // (LAND_AP.share: the governor's order of work, not the job's room; one at a base under 5).
  // 2a''. Wood before the food from the land and the winter's extra farm hands while the food holds (WOOD_AP.foodFirst
  // days a head) in the two months before the cold: the crew it takes to have the woodpile in by the cold (planWood's critical). Job trips (2026-10-10)
  // let any base hunt, and the hunters and a short winter outlook's farm crew took every hand of a small hub ahead of
  // step 4a: woodtest seed 43 met the winter with no wood at all (30 woodcutter-days from late summer).
  const wood = planWood(state, base, people, areas, foodDays);
  const woodFirst = !!wood && foodDays >= WOOD_AP.foodFirst && wood.w.toCold > 0 && wood.w.toCold <= WOOD_AP.autumn * 2; // the run-up to the coming cold (not the tail of the last one: a spring start builds first)
  if (woodFirst) for (const s of ranked("wood", wood.score, wood.fit).slice(0, wood.critical)) give(s, "wood");
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
  // The winter stores fall short (winterShort): the plots get their tenders before builders, medics and stations,
  // but one hand stays free for a queued build (often the very farm plots and stores the winter needs: with every
  // hand on the plots they were never built).
  const wShort = winterShort(state, base) > 0;
  const winterCrew = (most = Infinity) => farmTo(Math.min(fw.need, most, people.filter((s) => !s.inBed).length - (areas.building && base.construction.length ? 1 : 0)));
  // A base without a hunting cabin (ap-food, 2026-10-11): its hunters work the tiles next to it (hunting.js
  // HUNT_GROUND.bare) for a few food a day each, under half of that in practice (huntYield), so they never come out of
  // the farm crew while the winter stores fall short or the farmers are short of plots (farmShort): the census at
  // ac1c1c6 kept 2-3 hunters all year, mostly off the plots (farming 54% → 33% of the person-days), the farm crew fell
  // under the "more plots" bar and the plots were never wished for (seed 5021: 0-1 plots until day 250, starved on day
  // 326). Then at most one hunter per LAND_AP.bareHead people (one from LAND_AP.smallFrom), and none while the recent hunts brought in under
  // HUNT_YIELD.low of what was expected (a cabin's crew is cut to one then): they farm, and try again once those days
  // have passed (HUNT_YIELD.days).
  const cabin = count(base, "huntcabin") > 0;
  // A farm plot queued while the farmers are short of plots (or the winter stores fall short) gets its builder here,
  // ahead of the winter's farm crew, the hunters and the woodcutters, and goes to the front of the queue (behind a worm
  // job: 1c): the hand "left free for a queued build" was taken by whatever came next, and seed 5021's plots stood
  // queued for 18 days and more with 5 of 6 people on the plots there were.
  if (areas.building && (wShort || plotsShort(state, base)) && foodDays >= 2) {
    const i = base.construction.findIndex((c) => c.type === "farm_plot");
    if (i >= 0) {
      const first = base.construction[0].type; // not ahead of water, beds or the worm's jobs (the builder works on those first then)
      if (i > 0 && !wormJob(state, base, first) && !WATER_BUILDS.includes(first) && !BEDS[first]) base.construction.unshift(base.construction.splice(i, 1)[0]);
      if (!people.some((s) => (want.get(s.id) || {}).role === "build")) { const c = ranked("build", (x) => skill(x, "mechanics"), (x) => !x.inBed)[0]; if (c) give(c, "build"); }
    }
  }
  // (the land's share of the people, LAND_AP.share, is left out of it: with more plots than hands every hand went to the
  // plots, nobody hunted and the farmers kept the plots "short": seed 5024 built 26 crop plots for 11 people and starved)
  if (!cabin && (wShort || plotsShort(state, base))) winterCrew(people.length - Math.max(1, Math.ceil(people.length * LAND_AP.share)));
  // Game and fish from infected land carry the worm's eggs (worm.js wormKill) and are eaten raw where nothing cooks them
  // through (worm.js baseCooks: a cook fire, the kitchen's stove while it is lit): no hunters or fishers on the job then
  // (ap-food: the census at ac1c1c6 had worm deaths up 45%; seed 5004's three-person outpost with no cook fire and no
  // scrap for one kept a hunter on infected ground for weeks and caught it from the meat). A cabin's hunters go on (its
  // smoke house dries their meat). The cook fire is wished for meanwhile (wormWishes), and with the food under
  // FORAGE_AP.low days they go anyway: raw game beats none (seed 5040, hardcore: no cook fire, no hunter, starved). Not at a
  // shelter: its own fire is its cooking (worm.js baseCooks), out now and then, and a cook fire cannot go up there.
  const rawGame = !cabin && !isShelter(base) && !baseCooks(base) && wormLandNear(state, base) && foodDays >= FORAGE_AP.low; // short of food, raw game beats none
  const huntScore = (x) => hunterMult(x) * (bestHuntWeapon(x, st, st.arrows || 0) ? 3 : 0.5);
  if (areas.food && !gov(state).noHunting && foodDays < landGoal && !rawGame) {
    const ahead = Math.max(1, Math.ceil(people.length * LAND_AP.share));
    // In winter neither the cap nor poor hunts hold them back: the crops in the ground hardly grow and a farmer more adds
    // next to nothing, while a hunter bringing in a third of the estimate still brings food (seed 5021 starved in its
    // second winter with its hunters taken off for poor hunts, 9 of 17 resting; seed 5000 with 12 and no hunter).
    const winter = wxSeason(state).key === "winter";
    // Nor with the food down to FORAGE_AP.low days: the plots take weeks, the hunt brings food today (seed 5024: 12 people
    // on 2 days of food in autumn, the hunters sent to the new plots for poor hunts, starved in the first winter).
    const poor = huntYield(state, base).poor && !winter && foodDays >= FORAGE_AP.low;
    // (one at a base of LAND_AP.smallFrom to bareHead people, as at a bigger one; under that, only while the food is down to
    // FORAGE_AP.low days: food now, while the crops take weeks. Hardcore's small turtles that kept a hunter lived where the
    // census before the cabinless hunting lost them: seeds 5042, 5049.)
    const hunters = cabin || winter ? (poor ? Math.min(ahead, 1) : ahead) : poor ? 0 : Math.min(ahead, Math.max(foodDays < FORAGE_AP.low || people.length >= LAND_AP.smallFrom ? 1 : 0, Math.floor(people.length / LAND_AP.bareHead)));
    if (!huntWorkWhy(state, base)) for (const s of ranked("hunt", huntScore, (x) => !x.inBed && !x.leader).slice(0, Math.min(hunters, huntWorkCap(state, base, landGoal)))) give(s, "hunt");
    if (!fishWorkWhy(state, base)) for (const s of ranked("fish", (x) => fisherMult(x), (x) => !x.inBed && !x.leader).slice(0, Math.min(ahead, fishWorkHands(state, base, landGoal)))) give(s, "fish");
  }
  if (wShort) winterCrew();

  // 1d. The jail's guards (prisoners.js JAIL_GUARD): with anyone held here the roster is the governor's (a leader's
  // with Defence): one per 4 held, enough to watch the work detail, at most a quarter of the people, the sharpest
  // (Scouting) and the ones already on it first. They guard all day while anyone is held; an empty jail frees them.
  if (areas.defence) for (const s of planJailGuards(state, base, [...free])) give(s, "guard");

  // 3. Guards for a raid that is on its way or a horde at the door.
  const threat = threatAt(state, base);
  const guards = new Set([...want].filter(([, w]) => w.role === "guard").map(([id]) => id));
  const defense = () => {
    let d = baseWalls(base) * 2;
    const mult = (s) => (guards.has(s.id) || (want.get(s.id) || {}).role === "guard" ? 1.5 : base.alert ? 1.3 : 0.8);
    for (const s of people) d += combatPower(s) * mult(s);
    return d * armedFactor(people, st, st.arrows || 0, { short: 0.7, weight: mult }); // factions.js baseDefense: the bows' arrows too
  };
  const addGuards = (target, cap) => {
    if (!areas.defence) return;
    for (const s of ranked("guard", (x) => combatPower(x) * 2, (x) => !x.inBed)) {
      if (defense() >= target || guards.size >= cap) break;
      guards.add(s.id);
      give(s, "guard");
    }
  };
  if (threat.urgent) {
    for (const s of sick) free.add(s); // the ill go to the walls too, as on priorities (sickrest.js): the best fighters first
    addGuards(threat.urgent * P.guardMargin, Math.ceil(people.length * 0.7));
  }
  // 3a. The watchtower's alarm (defences.js towerWatch: a horde near, or coming, seen from the tower): guards go on the
  // walls now, ahead of the medics, the farm and the stations, as many as a horde at the door would want (people on
  // work priorities move Guard up the same way: work.js watchPromotions), up to half the people.
  else {
    const tw = towerHordes(state, base)[0];
    if (tw) addGuards(tw.size * 0.14 * 1.1 * P.guardMargin, Math.ceil(people.length * 0.5));
  }
  for (const s of sick) if (!want.has(s.id)) give(s, "rest"); // 1': the sick not taken to the walls rest

  // 4. Medics while anyone here is hurt (each hospital tier needs 1-3 to run).
  const hosp = hospitalDef(base);
  const staffed = people.some((s) => s.role === "medic"); // medics on duty stay until everyone is fully healed
  if (areas.medical && hosp.tier > 0 && people.some((s) => s.woundInfected || (isHurt(s) && s.health < (staffed ? 100 : 95)))) {
    for (const s of ranked("medic", (x) => skill(x, "medicine") - (isHurt(x) ? 6 : 0)).slice(0, hosp.staff)) give(s, "medic");
  }

  // 4a. Wood (woodcutting.js, planWood): with the cold near and the woodpile under half of what it needs, a
  // woodcutter or two go before the builders and the stations.
  if (wood && !woodFirst) for (const s of ranked("wood", wood.score, wood.fit).slice(0, wood.critical)) give(s, "wood");

  // 4a'. The felling (noidle.js fellCrew, the user's request 2026-10-20: "put a woodcutter on its own felling, not just
  // idle builders"): while felling or wood-giving clearing is queued here (its own for wood, the sites, the player's
  // marks), woodcutters work it before their trips: one, more while the woodpile is low, the best first (fellScore:
  // skill, the tool they carry, traits, health). Off again once the felling is done and the woodpile needs nobody (4a).
  // Here, ahead of the builders, while the woodpile is under the fires' days and three days' burn (heat first, as
  // govWoodwork puts that felling at the front of the queue) or the felling is all there is to build; otherwise after
  // the builders (5'), from the hands left.
  const fellNow = (urgentOnly) => {
    const fc = areas.production ? fellCrew(state, base, people.length) : 0;
    if (!fc || (urgentOnly && !fellUrgent(state, base) && base.construction.some((c) => !isChopJob(c)))) return;
    const have = [...want.values()].filter((w) => w.role === "wood").length;
    for (const s of ranked("wood", fellScore, fellFit(people.length <= 3)).slice(0, Math.max(0, fc - have))) give(s, "wood");
  };
  fellNow(true);

  // 4b. Cautious (reserves): while food is not short, the stations that refill a short supply (the ammo bench,
  // the med station: stationWorth) get their operator before the plots take every hand, and standing guards
  // come first while hordes or raiders are near.
  if (P.reserves && foodDays >= Math.max(15, foodTarget(state, base)) && winterShort(state, base) <= 0) {
    for (const station of areas.production ? stations(base) : []) {
      const recipe = BUILDINGS[station.type].station;
      if ([...want.values()].some((w) => w.station === station.id) || !stationWorth(state, base, recipe, station)) continue;
      const op = ranked("operate", (x) => skill(x, RECIPES[recipe].skill) + (x.station === station.id ? 3 : 0), (x) => !x.inBed)[0];
      if (op) give(op, "operate", station.id);
    }
    addGuards(Math.max(threat.standing, threat.urgent * P.guardMargin), Math.ceil(people.length * 0.35));
  }

  // 4c. A manual or blueprint in the armory: the best qualified free person studies it (blueprints.js; the Read role).
  if (!threat.urgent && foodDays >= 4) planBlueprintStudy(state, base, free, give);

  // 5. Builders while something is queued: more for big jobs. The field works planned from here (fieldworks.js: a
  // tower, a well …) are built by the same builders (buildings.js constructionHour → fieldBuildHour), so they count.
  // Only work builders can do now (noidle.js): a build waiting for its materials (gatherStalled; a camp's step up while
  // its builders can make the building materials) or the base on alert has nothing for them. Its felling for wood is
  // builder work too (a builder clears all day, a woodcutter by daylight): the woodcutters on it (4a', 5') come on top.
  const fieldLeft = fieldJobs(state, base).reduce((a, j) => a + Math.max(0, j.hours - j.progress), 0);
  const buildable = underAttack(state, base) ? [] : base.construction.filter((j) => !gatherStalled(j) || j === campMaterialsWork(base)); // a camp's builders make the step up's building materials
  if (areas.building && (buildable.length || fieldLeft > 0)) {
    const left = buildable.reduce((a, j) => a + j.hours - j.progress, 0) + fieldLeft;
    const n = Math.min(3, Math.max(1, Math.ceil(left / 40)), Math.max(1, Math.floor(free.size / 2)));
    for (const s of ranked("build", (x) => skill(x, "mechanics"), (x) => !x.inBed).slice(0, n)) give(s, "build");
  }
  // 5'. The felling's woodcutters when the woodpile is not short (4a').
  fellNow(false);
  // 5a. Upkeep at a big hub (UPKEEP_CREW): one or two builders kept on upkeep, build queue or not, while anything is
  // worn, so the wells and pumps are mended before they break (breakdowns.js: only builders with nothing to build did
  // upkeep, and a big hub always has something queued: its wells broke over and over).
  const mend = areas.building ? upkeepCrew(state, base, people.length) : 0;
  if (mend) for (const s of ranked("build", (x) => skill(x, "mechanics") + (x.upkeep ? STICKY : 0), (x) => !x.inBed).slice(0, mend)) give(s, "build", null, true);

  // 5c. Haulers (hauling.js haulersWanted): one for each pair of bases this base is the hauling end of (the end with
  // more people) while a standing haul order there has goods to move, at most two; the best by health, a strong back
  // and Scouting. Its orders are set by govHauling (autopilotHour). With nothing to move a hauler hauls locally.
  if (areas.production) {
    const have = [...want.values()].filter((w) => w.role === "haul").length;
    const hw = haulersWanted(state, base) - have;
    if (hw > 0) for (const s of ranked("haul", haulScore, (x) => !x.inBed && !x.leader && (x.health ?? 100) >= 50).slice(0, hw)) give(s, "haul");
  }

  // 5b. A Medic trainee (training.js planTrainees) while the base has too few skilled medics for its hospital and food
  // for TRAINING.foodDays days: ahead of the comfortable farm crew (at the step of the teachers and readers, the farm
  // had every hand of a small base and nobody ever trained), as an investment: a trainee learns from the doctor every
  // day and counts as half a medic.
  // A graduate (Medicine 6) goes to Medic while the hospital is short of medics, and while anyone trains the doctor
  // stays on Medic duty, quiet ward or not (training.js planDoctor: off duty the lessons are halved).
  if (areas.medical) {
    const onMedic = () => people.filter((s) => (want.get(s.id) || {}).role === "medic");
    planTrainees(state, base, free, give, { foodDays, urgent: !!threat.urgent, medics: onMedic().length });
    planDoctor(state, base, free, give, { trainees: people.filter((s) => (want.get(s.id) || {}).role === "trainee").length, medics: onMedic() });
  }

  // 6. Farming to the comfortable level. More plots are wanted when every plot is in use and food runs low.
  farmTo(foodDays < Math.max(15, foodTarget(state)) ? fw.ideal : fw.need);
  // Before winter (no outdoor harvests for four weeks) a month's stock is the aim.
  // ...and only while there are hands to tend them (a plot nobody tends gives little).
  // Held for FARM_SHORT_HOLD hours once set (ap-food): the farmers on a trip that day, or a hand taken for a build, flipped
  // it off for hours at a time, and the plot wished for (saved up for: buildWishes) let the scrap go to barricades and
  // crafts in between (seed 5021: wanted on day 30, built on day 104). Off at once when the food is comfortable.
  // ...and only while the plots there are want under FARM_AP.plotHands of the people here for their crew (ap-food: plots
  // past the hands to tend them took the hunters too and were "short" for ever).
  const fsNow = fw.active + fw.toSow >= slots && (foodOutlook(state, base).daysLeft < 30 || winterShort(state, base) > 0) && farmers >= slots * 0.45 && fw.need < people.length * FARM_AP.plotHands;
  const fsTill = g.farmShortTill || (g.farmShortTill = {});
  if (fsNow) fsTill[base.id] = state.hour + FARM_SHORT_HOLD;
  else if (farmLim.comfy) delete fsTill[base.id];
  g.farmShort[base.id] = fsNow || state.hour < (fsTill[base.id] ?? -1);

  // 7. Workshop stations that are worth running today and whose standing order wants them run (production.js). The
  // generators need nobody (machines-2: power.js runs them for what draws power).
  const staffedIds = () => new Set([...want.values()].filter((w) => w.station != null).map((w) => w.station));
  for (const station of areas.production ? stations(base) : []) {
    const recipe = BUILDINGS[station.type].station;
    if (!stationWorth(state, base, recipe, station) || staffedIds().has(station.id)) continue; // (4b may have staffed it)
    const key = RECIPES[recipe].skill;
    const op = ranked("operate", (x) => skill(x, key) + (x.station === station.id ? 3 : 0), (x) => !x.inBed)[0];
    if (op) give(op, "operate", station.id);
  }

  // 8. One crafter while the craft queue has a job someone here can do; a repair waiting for one (repair.js) first.
  const rep = areas.production && repairCrafterWanted(state, base);
  const repper = rep && ranked("craft", (x) => skill(x, rep.skill), (x) => !x.inBed && skill(x, rep.skill) >= rep.min)[0];
  if (repper) give(repper, "craft");
  const job = !repper && areas.production && craftQueue(base).find((j) => people.some((s) => canAttempt(s, CRAFTS[j.recipe])));
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
  // are the limit) and take the hands the wood leaves (below); before that one or two and a reader per 6, here.
  const plenty = foodDays >= Math.max(40, foodTarget(state) * 1.5);
  if (!plenty) planStudy(state, base, free, give, { foodDays, urgent: !!threat.urgent }); // skills.js: a teacher and readers when food is comfortable
  // The extra hands on the plots (FARM_AP.extra × the ideal crew) only while the food is below its target or the
  // winter stores fall short: past the ideal crew a farmer adds little (farming.js tendMult: 1.2 a plot 1.29, 1.9 a
  // plot 1.39), and "until food is plentiful" kept two thirds of every colony on the plots with months of food in
  // store (2026-10-08: 65-85% of the colonist-days at a base on Farm, 100+ days of food at the hub). The rest scavenge
  // around the base, cut wood, study and teach: the other skills rise.
  // The hands the farm crew does not need hunt before the extra farm hands go out (ap-food): past the ideal crew a farmer
  // adds little (farming.js tendMult) and in winter next to nothing, and the cautious hubs of the census that kept their
  // hunters lived through second winters the capped ones starved in (seeds 5000 and 5021: 12-17 people, every plot
  // tended, no hunter). While the food is below its target or the winter stores fall short the base's hunters are topped
  // up to its share (LAND_AP.share, as before the cap) from the hands left here, unless the recent hunts brought in under
  // LAND_AP.spareYield of their estimates (hunting.js huntYield). Only once the plots have their ideal crew (in winter
  // the share goes out ahead of the farm: 2b).
  if (farmLim.hungry && farmers >= fw.ideal && areas.food && !gov(state).noHunting && !rawGame && foodDays < landGoal && !huntWorkWhy(state, base)) {
    const have = [...want.values()].filter((w) => w.role === "hunt").length;
    const ratio = huntYield(state, base).ratio;
    const room = Math.min(Math.max(1, Math.ceil(people.length * LAND_AP.share)), huntWorkCap(state, base, landGoal)) - have;
    if (room > 0 && !(ratio != null && ratio < LAND_AP.spareYield)) for (const s of ranked("hunt", huntScore, (x) => !x.inBed && !x.leader).slice(0, room)) give(s, "hunt");
  }
  if (farmLim.hungry) farmTo(Math.ceil(fw.ideal * FARM_AP.extra));
  // ...and while food is short the hands left over forage instead of picking through the ruins (foraging.js).
  if (foraging) {
    const have = [...want.values()].filter((w) => w.role === "forage").length;
    for (const s of ranked("forage", foragerMult, (x) => foraging.fit(x) && x.mood >= 40).slice(0, Math.max(0, foraging.cap - have))) give(s, "forage");
  }
  // ...and from late summer the hands left over cut the winter's wood until the woodpile holds it (planWood).
  if (wood && wood.stock) {
    const have = [...want.values()].filter((w) => w.role === "wood").length;
    for (const s of ranked("wood", wood.score, (x) => wood.fit(x) && x.mood >= 40).slice(0, Math.max(0, wood.cap - have))) give(s, "wood");
  }
  if (plenty) planStudy(state, base, free, give, { foodDays, urgent: !!threat.urgent, plenty });
  for (const s of [...free]) give(s, s.mood < 40 ? "rest" : "scavenge");

  // 11. Nobody left in a role with no work (noidle.js, the user's request 2026-10-20: "There should never be idle
  // workers for any profession"): whoever the steps above gave a job that has no work (by the job: activity.js
  // jobCheck: nothing to build, no crops, a cold kitchen, a quiet ward, the ruins picked clean …) goes to the most
  // useful job that has work (planNoIdle: the base's needs, wood, a lookout). Not the people kept above (pinned, on
  // priorities, an area not handed over) or held by this morning's move (s.govIdle).
  const planned = (x) => (want.get(x.id) || { role: "scavenge" }).role;
  const noWork = people.filter((s) => !kept.has(s.id) && !(s.govIdle && state.hour < s.govIdle.until) && noWorkFor(state, base, s, planned(s), (want.get(s.id) || {}).station ?? null));
  if (noWork.length) for (const p of planNoIdle(state, base, noWork, planned, areas)) want.set(p.s.id, { role: p.job, station: p.station ?? null, upkeep: false });

  let changed = 0;
  for (const s of people) {
    const w = want.get(s.id) || { role: "scavenge", station: null };
    if (s.cookPlus && !kept.has(s.id)) delete s.cookPlus; // the governor plans their hours itself now (5c)
    if (s.role !== w.role) { s.role = w.role; changed++; }
    if (w.upkeep) s.upkeep = true; else if (s.upkeep) delete s.upkeep; // 5a: kept on upkeep (buildings.js onUpkeep)
    if (w.role === "operate") { if (s.station !== w.station) { s.station = w.station; changed++; } }
    else s.station = null;
  }
  if (changed) {
    g.stats.roleChanges += changed;
    assignStations(state, base);
  }
  return changed;
}

// Upkeep hands at a hub of UPKEEP_CREW.from people or more (two from UPKEEP_CREW.two), while any fixture there is worn
// past UPKEEP_CREW.wear or broken (breakdowns.js; each hand takes WEAR.upkeep, 1.5 wear, off the most worn a day).
export const UPKEEP_CREW = { from: 12, two: 24, wear: 20 };
function upkeepCrew(state, base, n) {
  if (base.type !== "hub" || n < UPKEEP_CREW.from) return 0;
  if (!fixtures(base).some((fx) => fx.broken || (fx.wear || 0) >= UPKEEP_CREW.wear)) return 0;
  return n >= UPKEEP_CREW.two ? 2 : 1;
}

// station: the building, when known. Its standing order (production.js; the governor's own from govOrders, or the
// player's) comes first: a station it holds is never staffed, and an until / keep order replaces the stock check.
function stationWorth(state, base, recipe, station = null) {
  if (station && station.type === "reload_bench" && reloadWanted(state, base)) return true; // reloading.js: a reloading order short and makeable (its station order holds only the common rounds)
  if (station && orderHold(state, base, station)) return false;
  const byOrder = !!station && stationOrder(base, station).mode !== "forever";
  const st = base.stock;
  const n = Math.max(1, atBase(state, base.id).length);
  // Cautious: a short supply is made from the scrap there is (down to the last day's worth when it is low).
  if (persona(state).reserves && (recipe === "ammo" || recipe === "meds")) {
    const r = reserveStatus(state, base)[recipe];
    if (r.short && (st.scrap || 0) >= (recipe === "ammo" ? (r.low ? 3 : 10) : (r.low ? 2 : 8)) && (recipe === "ammo" || foodIn(st) >= n * 6)) return true;
  }
  if (recipe === "ammo") return (byOrder || baseAmmo(state, base) < Math.max(n * 15 + 60, campaignAmmoTarget(state, base))) && (st.scrap || 0) >= 30; // the hive campaign's stockpile first
  if (recipe === "meds") return (byOrder || (st.meds || 0) < Math.max(5, n)) && (st.scrap || 0) >= 15 && foodIn(st) >= n * 6;
  if (recipe === "parts") return (byOrder || (st.parts || 0) < 8) && (st.scrap || 0) >= 45 && atBase(state, base.id).some((s) => skill(s, "mechanics") >= 4);
  if (recipe === "preserve") return preserveWorth(state, base);
  if (recipe === "still") return stillWorth(state, base);
  // The animal pen: always, but for the last days of water (its water is in the water plan, economy.js waterNeed, so
  // the wells and catchers are built for it; 2026-10-09: pens left unkept for a fortnight of tight water starved a hub
  // of 43 in its winter: three food for one water is worth it until the water is all but gone).
  if (recipe === "livestock") { const wo = waterOutlook(state, base); return waterIn(st) >= RECIPES.livestock.in.water + 2 && !(wo.net < 0 && wo.daysLeft < 3); }
  return false;
}
// The pressure canner (machines-2, buildings.js BUILDINGS.canner): fitted to a preserving room that has worked
// lately (someone on it), once the parts are there with CANNER_SPARE to spare (or a canner waits in the armory) and
// nothing is queued at the base that it would hold up.
const CANNER_SPARE = 6;
function autoCanner(state, base) {
  if (base.construction.some((c) => c.type === "canner")) return "";
  const k = base.buildings.find((b) => b.type === "kitchen" && !b.canner && !b.broken && atBase(state, base.id).some((s) => s.role === "operate" && s.station === b.id));
  if (!k) return "";
  const chk = canUpgradeKitchen(state, base, k.id);
  if (!chk.ok || (!chk.item && ((base.stock.parts || 0) < BUILDINGS.canner.cost.parts + CANNER_SPARE || (base.stock.scrap || 0) < 40))) return "";
  return queueCannerUpgrade(state, base, k.id);
}
// A generator upgraded a tier (gen-tiers, power.js GEN_TIERS; once a day, PLAN_HOUR + 3, for the governor and a steward
// with Building on). Only when:
//   the power is short: what the base would draw (powerWanted: every powered building not switched off, a workshop
//     station only while someone operates it; or what draws now, if more) is more than all its generators give at their
//     tiers (genCapacity, broken ones counted: they are repaired); the lowest tier is upgraded first (genToUpgrade);
//   it can be done (buildings.js canUpgradeGenerator: the materials, the Mechanics 4 / 5 hand, the Industrial Power
//     Manual for tier 3), with GEN_SPARE parts and 30 scrap left over (repairs and spares come first), nothing else for
//     a generator queued;
//   never into a fuel deficit (power.js genUpgradeFuelOk): the base's fuel in and out a day over the last 28 days
//     (genFuelFlows: history.js; the cars' refuelling, the heating, the generators, the outposts' runs are in it) less
//     the extra burn at that demand stays at 0 or more, and the fuel above the floor covers 30 days of the extra; the
//     floor is the governor's fuel floor (fuelFloor: 10, the hive campaign's fires, the winter's heating once it is
//     near) plus the heating the next 60 days' cold will burn (heatFuelWant) even before it is near. The hub's fuel is
//     drained by the cars often (2026-10-10 finding): the 28-day out counts them, so a hub whose cars eat its fuel does
//     not upgrade.
// It never builds a second generator (the build wishes do the first; the second is the player's call). Returns the
// log line or "". base.genUp records the last look ({ day, need, cap, ok, why }: the Power card shows it).
const GEN_SPARE = 4;
export function genFuelFlows(state, base, days = GEN_UP.window) {
  const today = day(state);
  const sum = (name) => column(state, base.id, name).filter((x) => x.day > today - 1 - days).reduce((a, x) => ({ v: a.v + x.v * x.span, n: a.n + x.span }), { v: 0, n: 0 });
  const i = sum("i_fuel"), o = sum("o_fuel"), m = sum("m_fuel");
  if (i.n < GEN_UP.minDays) return null; // too little history (a new base, an old save): no upgrade on a guess
  const moved = m.v / Math.max(1, m.n);
  return { income: i.v / i.n + Math.max(0, moved), out: o.v / o.n + Math.max(0, -moved), days: i.n };
}
export function autoGenUpgrade(state, base) {
  const gens = generators(base);
  if (!gens.length || base.construction.some((c) => c.type === "generator")) return "";
  const staffed = (b) => !!stationOperator(state, base, b);
  const need = Math.max(powerStatus(state, base).demand, powerWanted(state, base, staffed));
  const cap = genCapacity(base);
  const note = (ok, why) => { base.genUp = { day: day(state), need, cap, ok, why }; return ""; };
  if (need <= cap) return note(false, `the generators give ${cap} power for ${need} wanted`);
  const up = genToUpgrade(base);
  if (!up) return note(false, "no generator to upgrade (top tier, broken or queued)");
  const chk = canUpgradeGenerator(state, base, up.id);
  if (!chk.ok) return note(false, chk.reason);
  if ((base.stock.parts || 0) < chk.next.cost.parts + GEN_SPARE || (base.stock.scrap || 0) < chk.next.cost.scrap + 30) return note(false, `saving the parts and scrap (${chk.next.cost.parts} + ${GEN_SPARE} parts, ${chk.next.cost.scrap} + 30 scrap)`);
  const flows = genFuelFlows(state, base);
  if (!flows) return note(false, "too little fuel history yet");
  const hw = heatFuelWant(state, base);
  const floor = fuelFloor(state, base) + (hw.want ? 0 : hw.need);
  const fc = genUpgradeFuelOk(base, need, up, floor, flows);
  if (!fc.ok) return note(false, fc.why);
  base.genUp = { day: day(state), need, cap, ok: true, why: "" };
  const g = gov(state);
  g.stats.genUps = (g.stats.genUps || 0) + 1;
  return `${queueGenUpgrade(state, base, up.id)} (${need} power wanted, ${cap} from the generators; fuel ${Math.round(fc.income * 10) / 10} in and ${Math.round(fc.out * 10) / 10} out a day, ${Math.round(fc.extra * 100) / 100} more for it)`;
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
// and parts until the stock target (they start again 10% below it), run the still only on the surplus; and the
// generators' fuel reserve (power.js base.genReserve: the tanks are filled only above the fuel the base keeps; it was
// the generator's Keep-at-least order). The player's own orders and reserve (by: "player") stand.
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
    else if (recipe === "still") want = { mode: "keep", key: "fresh", n: n * 25 }; // days of fresh food (foods.js)
    if (!want) continue;
    if (cur.mode === want.mode && (want.key || cur.key) === cur.key && Math.abs(cur.n - want.n) <= Math.max(2, want.n * 0.1)) continue;
    setStationOrder(state, base, station.id, want, "ai");
    const g = gov(state);
    g.stats.orders = (g.stats.orders || 0) + 1;
  }
  if (generators(base).length && !(base.genReserve && base.genReserve.by === "player")) {
    const n = Math.ceil(fuelFloor(state, base));
    if (!base.genReserve || Math.abs(base.genReserve.n - n) > Math.max(2, n * 0.1)) setGenReserve(base, n, "ai");
  }
}
// The preserving room (storage.js): jars fresh food that would otherwise spoil (stored outside, or the summer
// and autumn surplus going into the winter store), never the food eaten in the next two weeks, and only with
// jars, water and a little scrap to spare.
function preserveWorth(state, base) {
  const st = base.stock;
  const n = Math.max(1, atBase(state, base.id).length);
  const r = RECIPES.preserve;
  if ((st.jars || 0) < r.in.jars || waterIn(st) < n * 2 + r.in.water || waterTight(state, base) || (st.scrap || 0) < 4) return false;
  const fresh = foodSplit(st).fresh; // days of the food that needs a cold room (foods.js): what the kitchen jars
  if (fresh < n * 14 + r.in.fresh) return false;
  const store = foodStore(state, base);
  const sk = wxSeason(state).key;
  return store.outside >= 1 || ((sk === "summer" || sk === "autumn") && fresh >= Math.min(store.cap * 0.6, n * 25));
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
  walls: "defence", wall1: "defence", wall2: "defence", wall4: "defence", gate4: "defence", stand1: "defence", stand2: "defence", stand4: "defence", barricades: "defence", spike_pits: "defence", trench: "defence", gate: "defence", floodlights: "defence", watchtower: "defence", armory: "defence",
  infirmary: "medical", field_hosp: "medical", clinic: "medical", hospital: "medical", med_station: "medical",
  huntcabin: "food", farm_plot: "food", greenhouse: "food", animal_pen: "food", cellar: "food", coldstore: "food", freezer: "food", storehouse: "food", smoker: "food", kitchen: "food", rain_catcher: "food", well: "food", cistern: "food", water_barrel: "food", crates: "food",
  boiler: "food", cookhouse: "food", canteen: "food", grainmill: "food", meatgrinder: "food", stove: "food", // base building: a wood stove indoors is a cook fire (the general buildings, bunks, shelves and lockers are "building")
  ammo_bench: "production", machine_shop: "production", still: "production", generator: "production", sealer: "production",
  craftbench: "production", workbench: "production", toolbench: "production",
};
// A full queue still takes the summer store's room (buildWishes `room`: the last weeks of spring and summer) as one
// more job, put at its front (the builders work on the first job: buildings.js constructionHour); a hub whose beds
// were behind kept its queue full of bunkhouses and a barracks for two weeks and met the first heat wave with 80
// of room (farmtest seeds 54 and 60).
function planBuilds(state, base, areas = ALL_AREAS) {
  const slots = base.type === "hub" ? 2 : 1;
  // A camp's or a shelter's step up waiting for its materials (gatherStalled) holds no builder: it does not fill the queue.
  const jobs = base.construction.filter((c) => c.type !== "clear" && !(BUILDINGS[c.type] && BUILDINGS[c.type].tierUp && gatherStalled(c))).length; // woodwork: the clearing jobs (felling, sites) take no build slot
  if (jobs >= slots + 1) return;
  const full = jobs >= slots;
  const g = gov(state);
  for (const w of buildWishes(state, base)) {
    if (full && !w.room) continue;
    const def = BUILDINGS[w.type];
    if (!def || !areas[BUILD_AREA[w.type] || "building"]) continue;
    const chk = wishCheck(state, base, w); // a new building, or a bunkhouse expanded into a barracks
    if (!chk.ok) {
      if (w.save && /^Needs \d+ scrap/.test(chk.reason)) return; // save up for it rather than spend on less
      continue;
    }
    // A step up that gathers its materials as they come in (buildings.js gather: Build up into a base, Establish the
    // outpost): queued at once, nothing to save up for (it takes what its next hours of work need).
    if (def.gather) { const msg = wishQueue(state, base, w); g.stats.builds++; say(state, `${msg.replace(/\.$/, "")}: ${w.why}.`); return; }
    const cost = wishCost(w, base);
    // Cautious: anything not urgent is built only from what is above the reserves (reserveStatus).
    const rs = persona(state).reserves && !w.save ? reserveStatus(state, base) : null;
    const reserve = rs ? rs.scrap.target : w.save || base.type !== "hub" ? 0 : 10;
    if ((base.stock.scrap || 0) - (cost.scrap || 0) < reserve) { if (w.save) return; continue; }
    // Anything but a water building leaves the scrap and parts held for water (waterPlan); it does not save up
    // against that hold (the wishes after it, water among them, still get their turn).
    if (!WATER_BUILDS.includes(w.type) && w.type !== "hub_up" && ((base.stock.scrap || 0) - (cost.scrap || 0) < waterHold(state, base) + campHold(state, base) || (cost.parts && (base.stock.parts || 0) - cost.parts < waterHold(state, base, "parts") + campHold(state, base, "parts") + (w.type === "radio" ? 0 : radioHold(state, base))))) continue; // campHold: its outpost camps' materials
    if (rs && ["meds", "parts", "fuel"].some((k) => cost[k] && (base.stock[k] || 0) - cost[k] < rs[k].target)) continue;
    if (!w.save && cost.meds && (base.stock.meds || 0) - cost.meds < 2) continue;
    if (!w.save && cost.parts && (base.stock.parts || 0) - cost.parts < 1) continue;
    // Wood is fuel and a building material (2026-10-20): a build leaves the fires their days in store (woodcutting.js
    // woodNeed dailyKeep, and a share of the coming cold's need rising as it nears: WOOD_BUILD_KEEP) and, once the stocking for the
    // cold is on (soon), the cold's whole need; a small one (WOOD_BUILD_SMALL wood or less: a tent, a box, crates,
    // shelves, bunks) goes ahead, and so do beds (a bunkhouse, a hut for bunks); the woodcutters make up the rest (planWood).
    // Short of it the governor fells trees for it (govWoodwork).
    if (keepsWood(w.type, cost.wood || 0)) { const wn = woodNeed(state, base); if ((base.stock.wood || 0) - cost.wood < buildWoodKeep(wn)) continue; }
    else if (WOOD_FOOD.has(w.type) && cost.wood) { const wn = woodNeed(state, base); if ((base.stock.wood || 0) - cost.wood < wn.dailyKeep) continue; } // the fires' days stay
    const n0 = base.construction.length;
    const msg = wishQueue(state, base, w);
    if (w.room && full && base.construction.length > n0) base.construction.unshift(base.construction.pop()); // ahead of the queue
    else if (base.construction.length > n0) { const i = base.construction.findIndex((c) => c.gov === "wood"); if (i >= 0 && i < base.construction.length - 1) base.construction.splice(i, 0, base.construction.pop()); } // woodwork: ahead of its own felling for wood (the builders fell when there is nothing else)
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
    const need = (wishCost(w, base).scrap || 0) + reserve;
    if (w.save || (base.stock.scrap || 0) >= need) return need;
  }
  return 0;
}

// ---------- woodwork: felling for wood, the next sites cleared ahead (woodwork.js) ----------
// The next build's wood (the first wish planBuilds would queue, or is short of only wood, or saves up for) and the
// wood the queued gather jobs (the Ring wall) still wait for: { wood, type (that wish's), keep (it keeps the woodpile's
// reserve back: keepsWood) }.
function nextBuildWood(state, base, areas = ALL_AREAS) {
  let wood = 0;
  for (const c of base.construction) if (c.paid) { const r = gatherRows(c).find((x) => x.key === "wood"); if (r && !r.ok) wood += r.need - r.have; } // the Ring wall, and a step up's wood (its cost is the building's: gatherRows)
  for (const w of buildWishes(state, base)) {
    const def = BUILDINGS[w.type];
    if (!def || def.gather || !areas[BUILD_AREA[w.type] || "building"]) continue;
    const chk = wishCheck(state, base, w);
    if (!chk.ok && !/^Needs \d+ wood/.test(chk.reason || "") && !(w.save && /^Needs \d+ scrap/.test(chk.reason || ""))) continue;
    const cw = wishCost(w).wood || 0;
    return { wood: wood + cw, type: w.type, keep: keepsWood(w.type, cw) };
  }
  return { wood, type: null, keep: false };
}
// Every WOODWORK.govEvery hours at a base of yours with land on its map (basemap.js landFor): when the woodpile and
// the felling already queued come to less than the fires' reserve (woodNeed dailyKeep: the fires' days in store, or the
// share of the coming cold's need the next build leaves back, buildWoodKeep: all of it in the stocking season) plus the next
// builds' wood (nextBuildWood), the nearest trees beyond the walls are felled for it, a job a tree, at most
// WOODWORK.govMax of them waiting (woodwork.js queueChop; the builders fell when they have nothing else to build, the
// woodcutters before their trips). And the sites of the builds queued and of the next one are cleared ahead
// (woodwork.js clearAhead), only where the auto layout found no open ground for them.
function govWoodwork(state, base, areas = ALL_AREAS) {
  if (gov(state).noWood || base.group || (base.owner != null && base.owner !== "player")) return;
  const next = nextBuildWood(state, base, areas);
  const wn = woodNeed(state, base);
  const reserve = Math.max(wn.dailyKeep, next.keep ? buildWoodKeep(wn) : 0); // the fires' days; the cold's share a big wooden build leaves (the winter's own pile is the woodcutters': planWood)
  const want = Math.ceil(reserve + next.wood - Math.max(0, base.stock.wood || 0) - queuedChopWood(base));
  if (want > 0) { const jobs = queueChop(state, base, want); if (jobs.length) gov(state).stats.chops = (gov(state).stats.chops || 0) + jobs.length; }
  // Under the fires' own days and three more (the opening, after a bunkhouse took the pile): its felling goes to the front of the queue,
  // ahead of the builds (the builders work the first job they can).
  if ((base.stock.wood || 0) < wn.dailyKeep + 3 * (wn.daily || 0)) { // and three days more of the daily burn
    const mine = base.construction.filter((c) => c.gov === "wood");
    if (mine.length && base.construction[0] !== mine[0]) { const rest = base.construction.filter((c) => c.gov !== "wood"); base.construction.splice(0, base.construction.length, ...mine, ...rest); }
  }
  const ahead = clearAhead(state, base, next.type);
  if (ahead.length) gov(state).stats.clearAhead = (gov(state).stats.clearAhead || 0) + ahead.length;
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

// A camp's or a shelter's yard (tier 0, 2026-10-12, user request "fix autopilot to build things at camp"): its step
// up gathers every scrap that comes in (buildings.js gather), so nothing else was ever built there. What it is to have
// meanwhile, in order of need, on its plots (a camp 2 utility plots, a shelter 3 and a building plot: buildings.js
// PLOTS): a rain catcher away from a river or lake, a cook fire (the camp fire is out on mild nights, so the meals
// would be raw), a drying rack for the fresh food it cannot eat in time, a crafting bench for mending and the
// crafters; a shelter crowded past its beds a bunkhouse on its building plot. A camp's step up is cheap and quick
// (camp_up, outpost_up): its yard is built from the scrap the step up does not need. A shelter's (hub_up, 100 scrap)
// is a long way off: it waits until its yard stands (pending: what is still to go up and has a plot for it).
// { wishes (those it can pay for now), pending }.
function campYard(state, base, here, queued) {
  const wishes = [], pending = [];
  if (!isShelter(base) || !here.length) return { wishes, pending };
  const st = base.stock;
  const job = tierUpJob(base), up = BUILDINGS[tierUpType(base)];
  // (a camp's building materials are made from scrap: buildings.js CAMP.matScrap each, less what is in store)
  const left = (k) => (job ? gatherRows(job).filter((r) => r.key === k).reduce((a, r) => a + Math.max(0, r.need - r.have), 0) : up.cost[k] || 0);
  const upScrap = isCamp(base) ? left("scrap") + Math.max(0, left("buildmat") - (st.buildmat || 0)) * CAMP_TIER.matScrap : 0;
  const spare = (st.scrap || 0) - upScrap;
  const add = (type, why) => {
    if (count(base, type) + queued(type) >= (type === "cots" ? BUILDINGS.cots.max : 1)) return; // the cots twice, the rest once
    const chk = canBuild(state, base, type);
    if (chk.where || chk.noPlot || chk.locked || /Limit reached|has room for/.test(chk.reason || "")) return; // no room for it at this stage
    pending.push(type);
    const cost = BUILDINGS[type].cost;
    if ((cost.scrap || 0) <= spare && (cost.parts || 0) <= Math.max(0, (st.parts || 0) - 1)) wishes.push({ type, why });
  };
  if (!besideWaterSource(state, base.tile)) add("rain_catcher", "rain water (no river or lake beside it)");
  add("cookhouse", "the meals cooked through, the camp fire lit or not");
  if (here.length >= 3) add("smoker", "dry the fresh food it cannot eat in time");
  if (!benchTier(base, true)) add("craftbench", "a bench for mending and the crafters");
  // Crowded past its beds: the makeshift cots first (6 scrap, no plot, +2 each), then a bunkhouse on its building plot.
  // (everyone whose home it is: someone out on a job trip still sleeps here)
  const living = state.survivors.filter((x) => x.alive && x.location && x.location.kind === "base" && x.location.baseId === base.id).length;
  const crowded = () => living + returning(state, base) > baseBeds(base) + queuedBeds(base) + (pending.includes("cots") ? BEDS.cots : 0);
  if (!isCamp(base) && crowded()) add("cots", `${living} people for ${baseBeds(base)} beds`);
  if (!isCamp(base) && crowded()) add("bunkhouse", `${living} people for ${baseBeds(base)} beds`);
  // Storage for the goods lying outside (storageWish): last in the yard, from the scrap the step up does not need; never
  // in `pending` (a shelter's step up does not wait for it).
  const sw = storageWish(state, base);
  if (sw && (BUILDINGS[sw.type].cost.scrap || 0) <= spare && !BUILDINGS[sw.type].cost.parts) wishes.push(sw);
  return { wishes, pending };
}
// Base storage limits (basestorage.js, 2026-10-19): when a base's goods lie outside (STORE_WISH.minKg or more, or an
// item that wears out there), one storage building at a time, from the ladder for its size, cheapest first: a storage
// box at a camp, a box or storage crates at a shelter, crates or a storage shed at an outpost, crates, a shed, the
// storehouse or a warehouse at the main base. The smallest it can build now that takes what lies outside, else the
// biggest it can build now (canBuild: the materials, a plot, the skills). Never saved up for: the wishes ahead of it
// (water, beds, food, defence, benches) keep their scrap, and planBuilds' reserves still apply.
// Base building (merged with it, 2026-10-19): while a standing general building has floor for them (basemap.js
// fittingRoom), storage shelves (150 kg, 4 scrap) and then lockers (100 kg) on its floor come first: cheap, no plot;
// and when nothing on the ladder can go up (no plot free), the biggest general building the base can put up, to hold
// shelves and lockers (generalWish). One at a time: a storage building, a fitting or a general building going up.
export const STORE_WISH = { minKg: 5, ladder: { camp: ["storebox"], shelter: ["storebox", "crates"], outpost: ["crates", "shed"], hub: ["crates", "shed", "storehouse", "warehouse"] }, fittings: ["shelves", "lockers"] };
export function storageWish(state, base) {
  if (base.construction.some((c) => (isStoreBuilding(c.type) || GENERAL.includes(c.type)) && !c.target)) return null; // one at a time
  const st = storageOf(state, base);
  if (st.outsideKg < STORE_WISH.minKg && !st.outside.gear.length) return null;
  const why = (t) => `${Math.round(st.outsideKg)} kg of the base's goods lie outside, weathering (room for ${BUILDINGS[t].storeKg} kg)`;
  for (const t of STORE_WISH.fittings) if (BUILDINGS[t] && countAll(base, t) < BUILDINGS[t].max && fittingRoom(state, base, t) && canBuild(state, base, t).ok) return { type: t, why: `${why(t)}: ${BUILDINGS[t].name.toLowerCase()} inside a general building`, save: false };
  const size = isCamp(base) ? "camp" : isShelter(base) ? "shelter" : base.type === "hub" ? "hub" : "outpost";
  const ok = STORE_WISH.ladder[size].filter((t) => BUILDINGS[t] && canBuild(state, base, t).ok);
  if (ok.length) {
    const type = ok.find((t) => BUILDINGS[t].storeKg >= st.outsideKg) || ok[ok.length - 1];
    return { type, why: why(type), save: false };
  }
  const gb = generalWish(state, base);
  if (gb && canBuild(state, base, gb).ok) return { type: gb, why: `${Math.round(st.outsideKg)} kg of the base's goods lie outside, weathering: a ${BUILDINGS[gb].name.toLowerCase()} for shelves and lockers`, save: false };
  return null;
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
  // A camp or a shelter short of beds (a new camp has none: 2026-10-20) puts up makeshift tents first, one a sleeper
  // (buildings.js TENTS): cheap, quick, a poor bed but a bed.
  if (isShelter(base) && people > beds && countAll(base, "tent") + queued("tent") < BUILDINGS.tent.max) add("tent", `${people} people for ${beds} beds: a makeshift tent`, true);
  const yard = campYard(state, base, here, queued); // a camp's or a shelter's yard, ahead of its step up
  for (const w of yard.wishes) out.push(w);
  // A shelter (buildings.js, tier 0): build it up into a base as soon as the materials are in (a well, walls, every
  // building), once its yard stands (campYard). An outpost camp's step up (outpost_up) is queued when it is pitched;
  // queued again if it was called off.
  if (isShelter(base) && !queued(tierUpType(base)) && (isCamp(base) || !yard.pending.length)) add(tierUpType(base), base.type === "outpost" ? "establish the outpost camp (a spring, a fence, room to build)" : isCamp(base) ? "build the camp up into a shelter (a roof, beds, more plots)" : "build the shelter up into a base (a well, walls, room for everything)", true);
  for (const w of wormWishes(state, base, queued)) out.push(w); // worm.js: a water boiler, a cook fire
  const stove = stoveWish(state, base, out, queued); // base building: a wood stove indoors where no cook fire can go up in the yard
  if (stove) out.push(stove);
  // Beds (nextHousing): a bunkhouse, or a barracks once the building plots run short, or a bunkhouse expanded; with
  // none of those left (the plots used up), bunk beds inside a general building, or the building first (bedWishes).
  if (people + (isHub ? 1 : 0) > beds) {
    const why = `${people} people for ${beds} beds`;
    const hw = housingWishes(state, base, why, true);
    out.push(...(hw.length && housingOpen(state, base, hw) ? hw : bedWishes(state, base, why, queued)));
  }
  // An outpost of a hub that has outgrown its plots gets its beds ahead of the people sent to it (planSupplyRuns).
  else if (!isHub && cramped && !isShelter(base) && people + HOUSING.ahead > beds) out.push(...housingWishes(state, base, "room for people from the crowded hub", true));
  // A hub with no river near (GROWTH_WATER): its wells are what it can grow to, so both go up right after the first
  // beds, from a bare start on (saved for once there is the part), and again whenever one is lost.
  if (isHub && !isShelter(base) && !GROWTH_WATER.river(state, base) && countAll(base, "well") + queued("well") < BUILDINGS.well.max) add("well", "no river near: the hub grows only as far as its wells carry it", (st.parts || 0) >= (BUILDINGS.well.cost.parts || 0));
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
  const fixes = wp.wells && !wp.sw.fix.some((f) => f.type === "well") ? [{ type: "well", count: wp.wells }, ...wp.sw.fix] : wp.sw.fix; // the wells ahead of the filters (waterPlan wells)
  for (const f of sk === "spring" || sk === "summer" ? fixes : []) {
    if (f.type === "waterfilter" || !BUILDINGS[f.type] || out.some((w) => w.type === f.type)) continue;
    if (BUILDINGS[f.type].max <= countAll(base, f.type) + queued(f.type)) continue;
    add(f.type, `water for the summer (${wp.sw.short > 0 ? `${wp.sw.short} a day short` : `${wp.sw.reserve} to store for the heat waves`})`, wp.near && (f.type !== "well" || (st.parts || 0) >= 1));
  }
  // The summer store (waterPlan, SUMMER_STORE): room for it ahead of summer, saved up for: a cistern (150, a building
  // plot, the Water Treatment Schematics), else a water barrel (25, a utility plot; never the plot a well still
  // wanted here needs), else a barrel upgraded (a rack 50, a tank 100; the tank's part only with one to spare).
  // `room`: in the last weeks of spring and in summer it may take a place in a full queue, at its front (planBuilds),
  // unless the beds are short: then a quick water barrel (6 hours, not a cistern's 30) waits its turn behind the beds
  // (farmtest's 36-person hub with 22 beds: the cisterns ahead of the bunkhouses tipped more hubs into walk-aways).
  if (wp.roomShort > 0 && !out.some((w) => w.type === "cistern" || w.type === "water_barrel")) {
    const why = `room for the summer's water (${wp.store} to keep in store, room for ${waterCapacity(base)})`;
    const can = (t) => { const c = canBuild(state, base, t); return c.ok || (/^Needs \d+ scrap/.test(c.reason || "") && !buildLock(state, base, t)); };
    const wellsLeft = Math.max(0, BUILDINGS.well.max - countAll(base, "well") - queued("well"));
    const bar = barrels(base).filter((b) => !b.broken && barrelTier(b) + 1 < WATER_BARREL.tiers.length && !base.construction.some((c) => c.target === b.id)).sort((a, b) => barrelTier(a) - barrelTier(b) || a.id - b.id)[0];
    const next = bar ? WATER_BARREL.tiers[barrelTier(bar) + 1] : null;
    const bedsShort = people + (isHub ? 1 : 0) > baseBeds(base); // beds built: queued ones are not slept in yet
    const room = (w) => out.push({ ...w, why: w.why || why, save: true, room: wp.near && !bedsShort });
    const barrelOk = countAll(base, "water_barrel") + queued("water_barrel") < BUILDINGS.water_barrel.max && plotsFree(base, "utility") > wellsLeft && can("water_barrel");
    if (bedsShort && barrelOk) room({ type: "water_barrel" });
    else if (countAll(base, "cistern") + queued("cistern") < BUILDINGS.cistern.max && can("cistern")) room({ type: "cistern" });
    else if (barrelOk) room({ type: "water_barrel" });
    else if (next && (st.parts || 0) - (next.cost.parts || 0) >= 1) room({ type: "water_barrel", barrel: bar.id, cost: next.cost, why: `${why}: a ${barrelName(bar).toLowerCase()} upgraded to a ${next.name.toLowerCase()}` });
  }
  if (waterIn(st) >= waterCapacity(base) * 0.85 && waterCapacity(base) < people * 10 && count(base, "cistern") + queued("cistern") < BUILDINGS.cistern.max) add("cistern", "room to store more water");
  // No building plot for a cistern (buildings.js PLOTS): a water barrel on a utility plot instead.
  if (waterIn(st) >= waterCapacity(base) * 0.85 && waterCapacity(base) < people * 10 && !plotsFree(base, "building") && countAll(base, "water_barrel") + queued("water_barrel") < BUILDINGS.water_barrel.max) add("water_barrel", "room to store more water (no building plot for a cistern)");
  if (g.farmShort[base.id] && count(base, "farm_plot") + queued("farm_plot") < (isHub ? BUILDINGS.farm_plot.max : 3)) add("farm_plot", "the farmers need more plots", true);
  for (const w of foodStoreWishes(state, base, people, queued)) out.push(w);
  // A hunting cabin (hunting.js) where its wider grounds pay (cabinGain: the best hunt 2 tiles out against the tiles
  // next to the base, walking counted; trips-plus #5), before the winter or while food is short.
  if (BUILDINGS.huntcabin && !g.noHunting && !count(base, "huntcabin") && !queued("huntcabin") && here.length >= (isHub ? 6 : 2) && !cabinProblem(state, base) && cabinGain(state, base) >= CABIN_GAIN &&
      (st.scrap || 0) >= 30 && (winterShort(state, base) > 0 || (winterActive(state, base) && edibleFood(base) / Math.max(1, here.length) < foodTarget(state, base))) && here.some((s) => bestHuntWeapon(s))) add("huntcabin", "hunt the game land around it for the winter");
  // homeFood (Turtle): a base that lives on its own land saves up for its greenhouses from 6 people (the second at 10)
  // and builds them with the three parts they take; the others when the parts are spare, saved for in autumn.
  const homeFood = !!persona(state).homeFood;
  if (isHub && count(base, "greenhouse") + queued("greenhouse") < (pop >= (homeFood ? 10 : 12) ? 2 : 1) && pop >= 6 && (st.parts || 0) >= (homeFood ? BUILDINGS.greenhouse.cost.parts : 4)) add("greenhouse", "something to grow through the winter", homeFood || wxSeason(state).key === "autumn" || winterShort(state, base) > 0);
  // The animal pens (farming.js PEN): eggs and milk every day, winter too, at a walled hub (half without walls), with
  // a building plot to spare after it (the next beds) and two outdoor crop plots given to pasture. homeFood: the
  // first from 5 people (saved for), the second from 9; the other styles one from 8 people while the winter stores
  // fall short or the farmers are short of plots.
  if (homeFood && isHub && pop >= 5 && (hasWall(base) ? 1 : 0) + queued("walls") < 1) add("walls", "a fortress lives behind its walls (and its animals too)", true);
  if (isHub && BUILDINGS.animal_pen && hasWall(base) && plotsFree(base, "building") >= 2) {
    const pens = countAll(base, "animal_pen") + queued("animal_pen");
    const wantPens = homeFood ? (pop >= 9 ? 2 : pop >= 5 ? 1 : 0) : here.length >= 8 && (winterShort(state, base) > 0 || g.farmShort[base.id]) ? 1 : 0;
    if (pens < wantPens) add("animal_pen", homeFood ? "food from its own land, winter too (eggs and milk)" : "food every day through the winter (eggs and milk)", homeFood);
  }
  if (!isHub && count(base, "farm_plot") + queued("farm_plot") < 1) add("farm_plot", "an outpost should feed itself", true);
  // An outpost's pantry holds 40 (storage.js): a root cellar once four or more live there and the food fills most of it.
  if (!isHub && here.length >= 4 && foodSplit(st).fresh > storeCapacity(base) * 0.8 && countAll(base, "cellar") + queued("cellar") < 1) add("cellar", "room for the outpost's food");
  if (Math.max(threat.urgent, threat.standing) > baseDefense(state, base) * 0.9) add("walls", "raiders or hordes nearby", true);
  // Hordes (defences.js): walls when a horde in sight would break in, then barricades, spike pits and the rest.
  const hz = hordeThreat(state, base);
  if (hz.size && !holdCheck(state, base, hz.size, hz.bosses, hz.mix).holds && !queued("walls") && nextWallTier(base)) add("walls", `a horde of ${hz.size} would break in`, true);
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
  // The Kitchen (kitchen.js): hot meals at a base of KITCHEN.govFrom+ people (a hub keeps a building plot free after it
  // for the next beds), saved up for from the start (its 20 scrap and a part held: kitchen-plus pick 6; behind the
  // infirmary and the general wishes it waited until day 150-190 on scrap-tight maps, or for ever); it supersedes the
  // cook fire (cookFireDown). Its cooks: planRoles 5c. After the water, the beds, the food stores, the walls a threat
  // calls for and the defences, before the relay, the benches, the jails, the infirmary and the workshops.
  // eaters: the people who live here, teams out included (at the hub everyone not living at an outpost).
  const eaters = isHub ? Math.max(people, alive(state).filter((s) => s.location.kind !== "base" || s.location.baseId === base.id).length) : people;
  if (BUILDINGS.canteen && !countAll(base, "canteen") && !queued("canteen") && eaters >= KITCHEN.govFrom && plotsFree(base, "building") >= (isHub ? 2 : 1)) add("canteen", `hot meals for ${eaters} people (−10% food a day, mood)`, !plotsShort(state, base)); // ap-food: not saved for (nor its scrap held: kitchenKeep) ahead of the farm plot the farmers are short of (seed 5058, hardcore: the Kitchen took the scrap, 2 plots for 13 people, starved)
  // Crafting benches (buildings.js BENCH): all but the simple field recipes need one, and crafters work faster and
  // better at one. A crafting bench where someone is on the Craft role or a job is queued, after the essentials above.
  const benchQueued = base.construction.some((c) => BUILDINGS[c.type] && BUILDINGS[c.type].family === "bench");
  // Fighters' gear worn past an urgent repair (repair.js benchWanted): the bench it needs, saved for.
  const bw = !benchQueued ? benchWanted(state, base) : 0;
  if (bw && !benchTier(base, true)) add("craftbench", "a bench to mend the fighters' worn gear", true);
  else if (bw >= 2 && benchTier(base, true) === 1 && best("mechanics") >= BUILDINGS.workbench.req.mechanics) add("workbench", "a workbench to mend the fighters' guns and armour", true);
  if (!benchTier(base, true) && !benchQueued && (here.some((s) => s.role === "craft") || craftQueue(base).length > 0)) add("craftbench", "a bench for the crafters (faster, better gear; most recipes need one)");
  if (!isShelter(base)) { const sw = storageWish(state, base); if (sw) out.push(sw); } // goods outside: storage (a camp's and a shelter's: campYard)
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
  if (!countAll(base, "ammo_bench") && !countAll(base, "reload_bench") && !queued("ammo_bench")) { // a reloading bench is an ammo bench upgraded (reloading.js)
    const ammoLow = baseAmmo(state, base) < Math.max(here.length * 15 + 60, campaignAmmoTarget(state, base));
    const bt = benchTier(base, true);
    if (!bt && !benchQueued) add("craftbench", "a crafting bench, the first step to an ammo bench", ammoLow);
    else if (bt === 1 && !benchQueued && best("mechanics") >= BUILDINGS.workbench.req.mechanics) add("workbench", "a workbench: workshop recipes, and an ammo bench needs one", ammoLow);
    else if (bt >= 2) add("ammo_bench", "ammo from scrap", ammoLow);
  }
  // The master workbench (buildings.js BENCH.toolbench: crafters 60% faster than by hand, +12% condition; it upgrades
  // the workbench in place, Mechanics 5): once crafting is in use here (a crafter at work, a craft job queued, or an
  // ammo or reloading bench standing on the workbench) with a Mechanics 5 builder, 10+ people and the parts to spare
  // (its 3 and 3 more). Never built in the 200 games of the progression census (2026-10-09).
  if (benchTier(base, true) === 2 && !benchQueued && best("mechanics") >= BUILDINGS.toolbench.req.mechanics && pop >= 10 && (st.parts || 0) >= BUILDINGS.toolbench.cost.parts + 3 &&
      (here.some((s) => s.role === "craft") || craftQueue(base).length > 0 || countAll(base, "ammo_bench") + countAll(base, "reload_bench") > 0)) add("toolbench", "a master workbench: the crafters work faster and better");
  if (!count(base, "med_station") && pop >= 6 && best("medicine") >= 3 && (st.meds || 0) < pop) add("med_station", "meds are short");
  if (!count(base, "storehouse") && (hostileNear || state.stats.raidsRepelled > 0)) add("storehouse", "raiders steal less");
  if (!count(base, "armory") && count(base, "storehouse") && (base.armory || []).length >= 8 && (hostileNear || state.stats.raidsRepelled > 0)) add("armory", "the guns and rounds under lock from raiders");
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
  // The chapel (relations.js: +1 mood a day for everyone here, grief weighs half, a memorial service lifts everyone 2
  // more): with a building plot to spare after it, at 8+ people while spirits sag below 70 with a common room standing
  // or queued (the chapel is the next step), or while two or more grieve (saved for from three, or a mood under 50);
  // a big hub (14+) once the scrap is there. homeFood (Turtle: a fortress that stays home lives on its morale) from 6.
  if (BUILDINGS.chapel && !countAll(base, "chapel") && !queued("chapel") && plotsFree(base, "building") >= 2) {
    const mood = here.reduce((a, s) => a + s.mood, 0) / Math.max(1, here.length);
    const grieving = here.filter((s) => s.grief).length;
    const commons = count(base, "common_room") + queued("common_room") > 0;
    if (pop >= (homeFood ? 6 : 8) && ((mood < 70 && commons) || grieving >= 2)) add("chapel", grieving >= 2 ? `${grieving} grieving (mood, grief weighs half)` : "spirits are low and a common room is not enough (mood)", mood < 50 || grieving >= 3);
    else if (here.length >= 14 && (st.scrap || 0) >= 40) add("chapel", "a quiet room for a big hub (mood)");
  }
  // Power (power.js): a still for the surplus once the hub is big enough, then a generator for what it powers.
  if (!count(base, "still") && !queued("still") && pop >= 9 && (st.parts || 0) >= 4 && stillWorth(state, base)) add("still", "turn the surplus food into fuel");
  if (countAll(base, "generator") + queued("generator") < 1 && pop >= 10 && (count(base, "still") || (st.fuel || 0) >= 40) && (count(base, "machine_shop") || countAll(base, "freezer") + queued("freezer") || (!buildLock(state, base, "freezer") && edibleFood(base) >= pop * 15)) && (st.parts || 0) >= 8 && best("mechanics") >= 3) add("generator", "power for the machine shop and a walk-in freezer"); // machines-2: the cold store needs no power; the freezer waits for the Refrigeration Schematics. gen-tiers: countAll (a broken generator is repaired, not replaced by a second one)
  if (!base.radio && pop >= 8 && (st.parts || 0) >= 9 && best("mechanics") >= 4) add("radio", "live contact with teams out in the field");
  // The coalition is made on the radio (greetings, pacts, invitations: alliance.js): from a dozen people with a
  // Mechanics 4 builder, the station is built once the parts are there (not saved up for: scrap goes to walls first).
  else if (!base.radio && pop >= 12 && day(state) >= 60 && (st.parts || 0) >= BUILDINGS.radio.cost.parts && best("mechanics") >= 4 && state.factions.some((f) => f.alive && f.known && !isMember(state, f))) add("radio", "radio contact with the groups for the coalition");
  // Radio reach limits the coalition and the trade (alliance.js reachVia: invitations, greetings and pacts, radio.js
  // radio deals go over the air): with two or more known groups that are not hostile out of call reach, from 10 people
  // and day 60 with the parts and a Mechanics 4 builder, the station is saved up for (the census, 2026-10-09: built in
  // a third of the games, so the radio relays that chain it never went up). The relays then go up at the outposts
  // (the relay wish above, saved for while reach keeps a group out of the coalition).
  // Its six parts are wanted (needs: trips and trades bring them) and held from other builds (radioHold) meanwhile:
  // the parts went to repairs and benches first and the station waited for good.
  if (!base.radio && !out.some((w) => w.type === "radio") && pop >= 10 && day(state) >= 60 && best("mechanics") >= BUILDINGS.radio.req.mechanics) {
    const far = state.factions.filter((f) => f.alive && f.known && attitude(f) !== "Hostile" && !isMember(state, f) && !canRadioGroup(state, f));
    if (far.length >= 2) {
      g.radioWant = day(state);
      if ((st.parts || 0) >= BUILDINGS.radio.cost.parts) add("radio", `${far.length} groups out of radio reach (the coalition and radio deals)`, true);
    }
  }
  if (!count(base, "garage") && carsAtBase(state, base.id).length && (st.parts || 0) >= 5) add("garage", "cheaper vehicle repairs");
  // Room for newcomers once the scrap is there (the housing's cost and HOUSING.scrapAhead more: 45 for a bunkhouse).
  if (people + (homeFood ? 6 : 2) > beds) for (const w of housingWishes(state, base, homeFood ? "spare beds (a fire in the bunkhouse must not crowd the fortress)" : "room for newcomers", false)) if ((st.scrap || 0) >= (wishCost(w, base).scrap || 0) + HOUSING.scrapAhead) { out.push(w); break; }
  if (wallTier(base) < 3 && !queued("walls") && (st.scrap || 0) >= 70) add("walls", "stronger defense"); // buildings.js WALL_TIERS: up to a scrap-metal wall when rich
  // Cautious (reserves): a med station as soon as meds run short (the surest source), and a radio station once
  // there are parts for it: scanning finds the groups in reach, and radio deals bring what runs short without a
  // trip (reserveRadio).
  if (persona(state).reserves) {
    const rs = reserveStatus(state, base);
    if (!count(base, "med_station") && pop >= 5 && rs.meds.short) add("med_station", "meds are below the reserve", true);
    if (!base.radio && (st.parts || 0) >= 6 + rs.parts.target && best("mechanics") >= 4) add("radio", "radio deals for what runs short", true);
    // Hordes are a known danger here: a second wall tier (each holds back 54 more of a horde, a Wallbreaker's 60%).
    if (rs.threat >= 1 && wallTier(base) + queued("walls") < 3) add("walls", "hordes are near: a stronger wall", true);
  }
  return out;
}

// The worm (worm.js): a water boiler as soon as the base drinks un-purified water (any of it can carry the worm; saved for unless a water filter
// covers it for now, or the land around gives too little wood to keep it burning: then filters are the plan,
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
    // Little wood around: the boiler would burn the winter's wood for nothing, so filters are the plan (planCrafts)
    // until someone here has caught it.
    if (!woodShort || sick) out.push({ type: "boiler", why: `un-purified water can carry the worm${w.raw > 0 ? " (and the ground here is infected)" : ""}${filter ? " (the filters cover it while they last)" : ""}`, save: !filter || sick });
  }
  // ...or would, but for the raw game (ap-food: planRoles keeps its hunters and fishers home while nothing here cooks
  // the game from infected land, so the cook fire is wished for wherever they could work, or the two wait on each other).
  const working = atBase(state, base.id).some((s) => s.role === "hunt" || s.role === "fish") || count(base, "huntcabin") > 0 || (!gov(state).noHunting && (!huntWorkWhy(state, base) || !fishWorkWhy(state, base)));
  const landBad = state.grid.within(base.tile, 2).some((id) => (state.tiles[id].infection || 0) >= WORM.MEAT_AT);
  const growing = atBase(state, base.id).some((s) => s.role === "farm" || s.role === "forage");
  const cropBad = cropLandBad(state, base.tile) || state.grid.within(base.tile, 2).some((id) => cropLandBad(state, id));
  if (!baseCooks(base) && !queued("cookhouse") && (wormMeatAt(base) > 0 || base.rawWarned || (working && landBad))) out.push({ type: "cookhouse", why: "game from infected land has to be cooked through (the worm)", save: true });
  else if (!baseCooks(base) && !queued("cookhouse") && (wormVegAt(base).all > 0 || base.rawVegWarned || (growing && cropBad))) out.push({ type: "cookhouse", why: "crops and forage from infected ground have to be boiled (the worm)", save: true });
  // Wave 2 cooking (cooking.js POISON.raw): raw meat and fish eaten uncooked give food poisoning, so a base whose
  // hunters or fishers bring it in gets a cook fire (6 scrap) too.
  else if (!baseCooks(base) && !queued("cookhouse") && (working || foodUnits(base, (k, f) => !!f.raw) >= 1)) out.push({ type: "cookhouse", why: "raw meat and fish eaten uncooked give food poisoning", save: false });
  // Camp fires (2026-10-12): days without hot food sour the mood (eating.js THOUGHTS.cold), so a base with nothing to
  // cook on (no Kitchen, no cook fire) wants a cook fire anyway.
  else if (!baseCooks(base) && !queued("cookhouse") && !hasKitchen(base) && atBase(state, base.id).length) out.push({ type: "cookhouse", why: "hot meals: days of cold food sour the mood", save: false });
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
// The land around a base gives less wood a day (one woodcutter, woodcutting.js) than its boiler would burn, and the
// pile is short of what the base wants (the winter's wood and the boiler's days, woodNeed): the boiler would eat the
// winter's heating, so a water filter (4 scrap, 3 water a day, safe water while it lasts) is the better buy.
function boilerWoodShort(state, base) {
  const need = mouthsAt(state, base).heads * WORM.BOILER_WOOD_HEAD;
  return need > 0 && baseWoodDay(state, base) < need && woodNeed(state, base).short;
}

const FREEZER_SPARE = 4; // the freezer's parts kept back for its spares and first repair (foodStoreWishes)
// Food storage and preserving (storage.js), before it is needed: room for the winter stock (the fresh food now
// and what the fields still bring in, from mid-summer), a cold store before winter, a drying rack and a
// preserving room for the summer surplus. Food already stored outside makes the next store urgent.
function foodStoreWishes(state, base, people, queued) {
  const out = [];
  if (base.type !== "hub") return out;
  const st = base.stock;
  const add = (type, why, save = false) => out.push({ type, why, save });
  const can = (t) => count(base, t) + queued(t) < BUILDINGS[t].max;
  const cap = storeCapacity(base) + queued("cellar") * 200 + queued("storehouse") * 150 + queued("coldstore") * 150;
  const fresh = foodSplit(st).fresh; // days of the food that needs a room (foods.js)
  const s = wxSeason(state);
  const coming = winterActive(state, base) ? winterPlan(state, base).crops : 0;
  const outside = fresh > cap;
  if (outside || fresh + coming * 0.7 > cap * 0.9) {
    const why = outside ? `${Math.floor(fresh - cap)} days of fresh food are stored outside and spoiling fast` : `room for the winter stock (${Math.floor(fresh)} days of fresh food in store, about ${Math.floor(coming)} still to come, room for ${cap})`;
    if (can("cellar")) add("cellar", why, outside);
    else if (s.key !== "summer" && can("coldstore")) add("coldstore", why, outside);
    else if (can("storehouse")) add("storehouse", why, outside);
  }
  // Storage crates (storage.js STORE.crates: +30 dry room each, a utility plot, 4 scrap, 5 work-hours): when the food
  // overflows and nothing bigger can go up (no building plot free, or the cellars, cold store and storehouse at their
  // limit), and as the quick stopgap while food already spoils outside (one, while the bigger store is built).
  if (can("crates") && plotsFree(base, "utility") >= 2 && (outside || fresh + coming * 0.7 > cap * 0.9)) {
    const bigger = plotsFree(base, "building") > 0 && ["cellar", "coldstore", "storehouse"].some((t) => can(t));
    if (!bigger) add("crates", outside ? `${Math.floor(fresh - cap)} days of fresh food spoiling outside and no room for a bigger store` : "room for the winter stock (no plot for a bigger store)", outside);
    else if (outside && !count(base, "crates") && !queued("crates")) add("crates", "a quick stopgap for the food spoiling outside");
  }
  if (can("smoker") && !count(base, "smoker") && people >= 4 && (outside || ((s.key === "summer" || s.key === "autumn") && fresh >= people * 20))) add("smoker", "dry the surplus for the winter");
  else if (can("smoker") && !count(base, "smoker") && rawGlut(state, base)) add("smoker", "dry the game before it rots"); // FOOD_RUN
  // The walk-in freezer (freezer-parts; buildings.js freezer): once a generator stands and there is fuel to keep it
  // running (a still, or 30 fuel), at 10+ people with a big fresh stock (15 days of eating, or food outside), and its
  // parts (5) with FREEZER_SPARE more for its spares and repairs, and its 2 electronics. One at the hub: the second
  // freezer is left to the player. The vacuum sealer waits for the cooking wave (it has no work yet). machines-2: once
  // the Refrigeration Schematics are studied (blueprints.js).
  if (!countAll(base, "freezer") && !queued("freezer") && !buildLock(state, base, "freezer") && count(base, "generator") && people >= 10 && (count(base, "still") || (st.fuel || 0) >= 30) &&
      (outside || fresh >= people * 15) && (st.parts || 0) >= BUILDINGS.freezer.cost.parts + FREEZER_SPARE && (st.electronics || 0) >= BUILDINGS.freezer.cost.electronics) add("freezer", "a walk-in freezer: the fresh food keeps twenty times longer");
  if (can("kitchen") && !count(base, "kitchen") && people >= 5 && (st.jars || 0) >= 8 && (st.parts || 0) >= 2 && (outside || (winterActive(state, base) && fresh >= people * 20))) add("kitchen", "jar the surplus for the winter");
  // Wave 2 cooking (cooking.js): by a Kitchen, a grain mill once there is grain to mill (flour and bread) and a meat
  // grinder once the hunters bring in more game than the meals take (sausage keeps months); a machine part each, kept
  // only while the parts stock has 2 more.
  if (count(base, "canteen") && (st.parts || 0) >= 3 && plotsFree(base, "utility") >= 2) {
    if (can("grainmill") && !countAll(base, "grainmill") && (st.f_grain || 0) >= 15) add("grainmill", "a grain mill: the grain into flour and bread");
    else if (can("meatgrinder") && !countAll(base, "meatgrinder") && (count(base, "huntcabin") || atBase(state, base.id).some((x) => x.role === "hunt")) && foodUnits(base, (k, f) => !!f.raw) >= people) add("meatgrinder", "a meat grinder: surplus game into sausage that keeps");
  }
  return out;
}

// ---------- the stores (base building, containers.js) ----------
// The stores tidied once a day, at the morning's plan before the day's builds (governBase; the AI groups' bases the
// same way, factions.js): the unassigned goods (what came in since yesterday) put in the containers with room, by
// autoStore's rules (the most valuable for their weight first, as basestorage.js fills the room; food where it keeps,
// rounds and guns in the armory, the dear things behind the best door, gear to the lockers). It only writes the
// assignments: what is inside and what lies outside is basestorage.js's to say, and the storage wish (storageWish)
// builds room when goods lie outside. What is assigned by hand stays where the player put it (a car is never loaded by
// the game). g.stats.stored: the kg put away all told.
function tidyStores(state, base) {
  const put = autoStore(state, base);
  const g = gov(state);
  g.stats.stored = Math.round(((g.stats.stored || 0) + put.kg) * 10) / 10;
}
// A wood stove (buildings.js stove, as: "cookhouse": it counts as the cook fire wherever one is read) on a general
// building's floor when the base wants a cook fire (wormWishes) and none can go up in the yard (no utility plot left,
// a camp's or a shelter's count used up): the cook fire's own why and urgency, right behind its wish (planBuilds
// takes the first it can queue; the cook fire's wish is passed over for want of a plot, not of scrap).
function stoveWish(state, base, out, queued) {
  const cf = out.find((w) => w.type === "cookhouse");
  if (!cf || count(base, "cookhouse") || queued("stove") || countAll(base, "stove") >= BUILDINGS.stove.max) return null;
  const c = canBuild(state, base, "cookhouse");
  if (c.ok || /^Needs \d+ scrap/.test(c.reason || "")) return null; // the cook fire itself goes up (or is saved for)
  if (!fittingRoom(state, base, "stove")) return null;
  return { type: "stove", why: `${cf.why} (a wood stove indoors: no plot for a cook fire)`, save: cf.save };
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
// The Kitchen saved for (buildWishes, kitchen-plus pick 6): its scrap is held from the crafts that are not urgent (armour,
// packs, tools and the rest below a filter, a dewormer and the hive kit), so a scrap-tight hub still gets it built.
function kitchenKeep(state, base) {
  if (!BUILDINGS.canteen || countAll(base, "canteen") || base.construction.some((c) => c.type === "canteen")) return 0;
  return buildWishes(state, base).some((w) => w.type === "canteen" && w.save) ? BUILDINGS.canteen.cost.scrap : 0;
}
// The farm plot the farmers are short of (buildWishes, saved for): its scrap held the same way (ap-food: seed 5021 wished
// for one from day 30 and built it on day 104, its scrap gone to whatever came first each time a run brought some in).
const plotKeep = (state, base) => (plotsShort(state, base) && !base.construction.some((c) => c.type === "farm_plot") && count(base, "farm_plot") < (base.type === "hub" ? BUILDINGS.farm_plot.max : 3) ? BUILDINGS.farm_plot.cost.scrap || 0 : 0);
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
  // The basic tools (toolreqs.js BASIC_KINDS: a hammer, a saw, a shovel, an axe): one nothing here covers is made from
  // scrap (a makeshift one) before the rest, or the builds and recipes that need it never go up. Not at a camp: its
  // essentials need none, and its scrap is for the step up into a shelter.
  const tw = isCamp(base) ? null : basicToolWanted(state, base);
  if (tw && canCraft(state, base, tw.recipe).ok) {
    queueCraft(state, base, tw.recipe);
    q.unshift(q.pop()); // first in the queue: the crafters work the first job they can (crafting.js craftingHour)
    gov(state).stats.crafts++;
    say(state, `Queued a ${GEAR[CRAFTS[tw.recipe].gear].name.toLowerCase()} at ${base.name}: nothing there serves as ${TOOL_KINDS[tw.kind].name} for building and crafting.`);
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
      if (!r || (st.scrap || 0) - (r.in.scrap || 0) - keep < Math.max(minScrap, floor, CRAFTS[k].gear === "waterfilter" ? 0 : waterHold(state, base) + campHold(state, base))) continue; // leaves the scrap held for water (and for the next building: keep)
      if (r.in.parts && (st.parts || 0) - r.in.parts < 2) continue;
      if (r.in.meds && (st.meds || 0) - r.in.meds < 3) continue;
      if (r.in.water && waterIn(st) - r.in.water < 15) continue;
      // Metal sheets it lacks (crafting.js metalsheet, 4 scrap each at a workshop): one flattened first, the gear after.
      const sheetsLack = Math.max(0, (r.in.metalsheet || 0) - (st.metalsheet || 0) - q.filter((j) => j.recipe === "metalsheet").length);
      if (sheetsLack > 0) {
        if ((st.scrap || 0) - (r.in.scrap || 0) - CRAFTS.metalsheet.in.scrap * sheetsLack - keep < Math.max(minScrap, floor, waterHold(state, base) + campHold(state, base))) continue;
        if (!canCraft(state, base, "metalsheet").ok) continue;
        queueCraft(state, base, "metalsheet");
        gov(state).stats.crafts++;
        say(state, `Queued a metal sheet at ${base.name}: for the ${(CRAFTS[k].name || GEAR[r.gear].name).toLowerCase()} (${why}).`);
        return true;
      }
      if (!canCraft(state, base, k).ok) continue;
      queueCraft(state, base, k);
      gov(state).stats.crafts++;
      say(state, `Queued ${CRAFTS[k].name || GEAR[r.gear].name} at ${base.name}: ${why}.`);
      return true;
    }
    return false;
  };
  // Building materials (crafting.js buildmat, 3 scrap each) while this base's step up, or one of the hub's outpost
  // camps, waits for them (matShort): ahead of the gear, from the scrap the camps are held (campHold is theirs).
  const bmQueued = q.filter((j) => j.recipe === "buildmat").length;
  const bmShort = (base.type === "hub" ? matShort(state, base, "buildmat") : ownShort(base, "buildmat")) - (st.buildmat || 0) - bmQueued;
  if (bmShort > 0 && (st.scrap || 0) - CRAFTS.buildmat.in.scrap >= waterHold(state, base) && canCraft(state, base, "buildmat").ok) {
    queueCraft(state, base, "buildmat");
    gov(state).stats.crafts++;
    say(state, `Queued building materials at ${base.name}: ${bmShort} still wanted for ${base.type === "hub" && !isShelter(base) ? "an outpost camp" : isShelter(base) ? (base.type === "outpost" ? "establishing the camp" : "building the shelter up into a base") : "a camp"}.`);
    return;
  }
  if (lacking("weapon") > 0 && tryCraft(["springmachete", "pulleybow", "crossbow", "sawmachete", "sheetmachete", "sheethatchet", "spikedbat", "pipespear"], "someone has no usable weapon", 5)) return; // the special ones first once a craft book or blueprint has opened them (blueprints.js)
  // Arrows: the bows and crossbows shoot them in every fight (and hunt with them): under half a dozen a bow, before
  // anything else (a bow with none fights with its fists; about half the arrows shot are picked up again after a win).
  const bows = people.filter((s) => hasBow([s])).length;
  const arrowsQueued = q.filter((j) => j.recipe === "arrows").length * CRAFTS.arrows.supplies.arrows;
  if (bows && (st.arrows || 0) + arrowsQueued < 6 * bows && (st.wood || 0) >= 100 && tryCraft(["arrows"], "arrows: a bow with none fights with its fists", 5)) return;
  if (((st.meds || 0) < Math.max(3, n / 2) || (rs && rs.meds.short)) && tryCraft(["dressings"], "meds are short", 5)) return;
  const filters = [...base.armory, ...people.map((s) => s.gear.tool)].filter((it) => it && it.key === "waterfilter").length + q.filter(isFilterJob).length;
  if (rs && rs.water.short && filters < (base.type === "hub" ? 2 : 1) && tryCraft([filterRecipe(base)], "water is below the reserve", 4)) return;
  // The worm (worm.js): water with eggs and no boiler burning (none built, or nothing to burn, or the land gives too
  // little wood for one): a filter makes it safe while it lasts, and a second is kept against the first clogging.
  if (wormFilterUrgent(state, base) && filters < 2 && tryCraft([filterRecipe(base)], baseWater(state, base).safe ? "un-purified water can carry the worm and the boiler's wood is short" : "un-purified water can carry the worm and nothing boils it", 4)) { q.unshift(q.pop()); return; } // to the front of the queue
  // Dewormers (worm.js): the sure cure in the worm's first days, kept on hand (two at a hub, one at an outpost).
  const dewormers = baseDewormers(state, base) + q.filter((j) => j.recipe === "dewormer").length;
  if (dewormers < (base.type === "hub" ? 2 : 1) && (st.meds || 0) >= 8 && tryCraft(["dewormer"], "a dewormer on hand: the worm kills within a week", 4)) return;
  if (filters < 1 && tryCraft([filterRecipe(base)], "clean water: a filter purifies 10 a day against the worm and an upset stomach (worm.js)", 8)) return;
  // The hive campaign's kit for the core (hivecrawl.js HIVEMIND.WEAK; kit.js HIVE_KIT): Molotovs (a bottle and fuel) and
  // road flares at the hub while the armory is short, from a few days before the campaign's first storm.
  const camp = gov(state).campaign;
  if (camp && base.type === "hub" && day(state) >= persona(state).hiveFrom - 10) {
    const kitHave = (k) => base.armory.filter((it) => it && it.key === k).length + q.filter((j) => CRAFTS[j.recipe].gear === k).length + atBase(state, base.id).reduce((a, s) => a + allCarried(s).filter((it) => it && it.key === k).length, 0);
    if (kitHave("molotov") < HIVE_KIT.molotov && (st.fuel || 0) >= 6 && base.armory.some((it) => it && it.key === "bottle") && tryCraft(["molotov"], "Molotovs for the Hivemind in the core (fire burns it and keeps its brood in the walls)", 3)) return;
    if (kitHave("flare") < HIVE_KIT.flare && (st.fuel || 0) >= 6 && baseAmmo(state, base) >= 40 && tryCraft(["flare"], "road flares to light the hive's passages", 5)) return;
  }
  if (rs) floor = rs.scrap.target;
  keep = Math.max(buildKeep(state, base), kitchenKeep(state, base) + plotKeep(state, base)); // on priorities: the rest only from scrap past the next building's (and the floors); the kitchen's scrap held while it is saved for
  if (lacking("armor") > 0 && tryCraft(["sheetvest", "scrapvest", "tirevest"], "someone has no body armor", 35)) return;
  if (lacking("head") > 0 && tryCraft(["rivethelmet"], "someone has no helmet", 40)) return; // only once Backyard Blacksmithing is read (blueprints.js)
  if (waterIn(st) < n * 6 && filters < (base.type === "hub" ? 2 : 1) && tryCraft([filterRecipe(base)], "the well cannot keep up (and purified water means less of the worm)", 15)) return;
  // A base by the water with nothing to fish with (hunting.js): a makeshift rod, so the Fish job can be worked.
  if (fishWorkWhy(state, base) === "no fishing rod, net or spear here" && !q.some((j) => j.recipe === "makeshiftrod") && tryCraft(["makeshiftrod"], "a rod for fishing the water by the base: food from the land", 12)) return;
  const scav = people.filter((s) => s.role === "scavenge");
  if (scav.length >= 2 && !scav.some((s) => s.gear.tool) && !base.armory.some((it) => it.key === "crowbar") && tryCraft(["crowbar"], "better base scavenging", 45)) return;
  if (lacking("backpack") > n - 2 && tryCraft(["backpack"], "packs: more to carry on trips", 55)) return;
  // Arrows for the bows' fights and hunting (hunting.js: about half the arrows shot at game are lost): a dozen a bow
  // to pack (world.js ARROWS.PACK), a dozen more for the walls, from wood the winter can spare.
  if (bows && (st.arrows || 0) + arrowsQueued < ARROWS.PACK * (bows + 1) && (st.wood || 0) >= 150 && tryCraft(["arrows"], "arrows: the bows shoot them in fights and on hunts", 30)) return;
  // Field kit (kit.js packs it for trips): quiet boots and a ghillie wrap against Heat, Molotovs for the walls.
  const have = (k) => base.armory.filter((it) => it.key === k).length + q.filter((j) => CRAFTS[j.recipe].gear === k).length;
  if (have("ragboots") < 2 && tryCraft(["ragboots"], "rag-wrapped boots: less Heat on searches", 50)) return;
  if (have("ghillie") + have("woodghillie") < 1 && tryCraft(["woodghillie", "ghillie"], "a ghillie wrap: less Heat in camp and on searches", 60)) return; // the woodland suit once the Bushcraft Field Guide is read
  if ((st.fuel || 0) >= 20 && base.armory.some((it) => it.key === "bottle") && have("molotov") < 3 && hordeThreat(state, base).any && tryCraft(["molotov"], "Molotovs for when the dead come", 0)) return;
  // Field repair kits (repair.js): kept on hand for the teams, made at a workshop from spare gun and machine parts.
  if (have("repairkit") < (base.type === "hub" ? 2 : 1) && (st.gunparts || 0) >= 3 && tryCraft(["repairkit"], "a field repair kit for the teams", 30)) return;
  if (lacking("arms") > 0 && tryCraft(["sheetarms", "padding"], "cheap arm guards", 65)) return;
  if (lacking("legs") > 0) tryCraft(["sheetlegs", "shinguards"], "cheap shin guards", 65);
}

// ---------- gear from the armory ----------
export { itemScore }; // equip.js (the governor's and the AI groups' one rule; sim/bulk.js reads it here)

function equipFromArmory(state, base) {
  if (!base.armory.length) return;
  openCasesIn(base.armory, base.stock); // gunsafes.js: gun cases brought home are opened (free), their guns join the armory
  const people = atBase(state, base.id).filter((s) => !s.pinned).sort((a, b) => combatPower(b) - combatPower(a)); // pinned people keep their kit too
  if (!people.length) return;
  const handed = [];
  // equip.js: the slots best fighters first (only real upgrades; a gun with nothing to shoot here is not handed to
  // someone whose working weapon suits their trips: tripgear.js outReady), loose gun parts, the carry kit.
  for (const x of equipPeople(base.armory, people, { weaponOk: (s, best) => outReady(base, s, best) || !tripKit(state, base, s).ready })) handed.push(x.gun ? `${x.item.name} on ${x.gun.name}` : x.s ? `${first(x.s)} ${x.item.name}` : x.item.name);
  for (const m of governPlates(state, base, people, { queue: queueRepair, craft: queueCraft })) handed.push(m);
  // Tools for the off hand: a crowbar to a scavenger, a med kit to a medic (else the best Medicine), anything
  // else to whoever has the skill for it. Water filters work from the armory and stay there.
  for (const x of equipTools(base.armory, people, { medic: (s) => s.role === "medic", scavenger: (s) => s.role === "scavenge" })) handed.push(`${first(x.s)} ${x.item.name}`);
  // tripgear.js (trips-plus #2): the outdoor workers out on the land alone get what the fighters left: a weapon for the
  // job, a light for the dusk hunt, light armour, a tourniquet or a kit.
  for (const x of gearOutdoorWorkers(state, base)) handed.push(`${first(x.s)} ${x.item.name}`);
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
  const bmf = t.loc ? BUILDMAT_FINDS[t.loc.type] : null; // building materials: a find of their own (loot.js)
  if (bmf && need.buildmat > 1) value += bmf[0] * 2 * need.buildmat;
  if (def && def.gear && def.gear.some((gk) => slotOf(gk) === "weapon") && alive(state).some((s) => !s.gear.weapon)) value += 0.25;
  // The hive campaign stockpiles ammo: gun stores, police stations, armories and the like (ammo the biggest share of
  // their loot) are scored up while it is short (campaignAmmoWant).
  if (def && (def.loot.ammo || 0) >= 4 && campaignAmmoWant(state) > 0) value += 0.3 * campaignAmmoWant(state);
  const danger = def ? (t.loc.zone === "town" || t.loc.zone === "rural" ? Math.min(1, def.danger ?? 1) : def.danger ?? 1) : 0;
  const infection = k ? k.infection : 0.3;
  const risk = danger * 0.12 + infection * 0.6 + (hostile ? 0.4 : 0) + (k ? 0 : 0.1);
  return { value: value * loot * Math.max(0.1, 1 - risk * P.riskAversion), loot, risk, hostile };
}

// A find (a cache, a camp, a wrecked car) the governor sent a team to waits this many days before another try: a wreck
// left for later or a restore that failed stays on the map, and a team went back to it every two to four days.
const FIND_COOLDOWN = 20;
function planTrip(state) {
  const g = gov(state);
  const P = persona(state);
  const h = hub(state);
  if (!h) return;
  const today = day(state);
  const out = state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && p.teamMission !== "sweep" && !p.apFoodRun); // a survey team goes on top (below); the hub's food run too (hubFoodRun)
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
  // minOut (Turtle): the style's share at home leaves a hub of 5–9 one pair of hands, and one scavenger carries home
  // a fraction of the scrap (2026-10-09: "No room to carry 6 scrap" trip after trip, no scrap for walls or beds): at
  // least minOut may go while three stay home.
  const keepFrac = Math.ceil(home.length * (small ? 0.25 : P.homeFrac));
  const keep = Math.max(small ? 1 : 2, P.minOut && !small ? Math.min(keepFrac, Math.max(3, home.length - P.minOut)) : keepFrac, hordeNear ? Math.min(home.length, P.homeHorde) : 0);
  const pool = home.filter((s) => s.health >= P.minHealth - (short.length || small ? 10 : 0) && !s.woundInfected && !s.inBed && !s.pinned && s.mood >= 20 && (!s.leader || home.length >= 9 || small) && tripFit(state, s)); // pinned people stay (never moved: the steward's rule)
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
  const wantsOutpost = outposts < P.outposts + (cramped ? 1 : 0) + (push ? (goalsProgress(state).alliance.allIn ? LAND_OUTPOSTS_ALL_IN : LAND_OUTPOSTS) : 0) && alive(state).length >= P.outpostPop && today - g.lastOutpost >= 15 &&
    foodIn(h.stock) >= home.length * 10 && spareHands >= 2;
  // occupy.js: a base standing empty nearby that the crew can clear comes first (no scrap, and it is built already).
  const oc = wantsOutpost ? occupyCandidate(state, h, pool, spareHands) : null;
  if (oc) cands.push(oc);
  else if (wantsOutpost && (h.stock.scrap || 0) >= (push ? 25 : 50)) { // the land push makes do with what founding takes
    const land = push && outposts >= P.outposts ? landOutpostSite(state) : null;
    const site = land ? land.id : outpostSite(state);
    const crowded = cramped || alive(state).length > baseBeds(h) + 2;
    if (site != null) cands.push({ mission: "outpost", tile: site, score: land ? 3 : crowded ? 3.5 : 2.2, crew: spareHands >= 4 ? 3 : 2, reach: land ? 1.6 : 1,
      why: land ? `land for the coalition (+${land.gain} tiles)` : cramped ? "the hub has outgrown its plots: a new outpost for its people" : crowded ? "the hub is crowded: a new outpost" : "a new outpost", supplies: { scrap: 32, buildmat: 2 }, min: { scrap: 12 } }); // parties.js outpostKit: the camp's 12 scrap and its step up's 20 scrap, 2 building materials
  }
  // Your people held by another group.
  const held = allCaptives(state);
  // ransom.js autoRescuePlan: only when paying is out (too dear) and the squad would beat the guards for someone worth it.
  const raidFor = held.find((s) => { const pl = autoRescuePlan(state, s); return pl && pl.kind === "raid"; });
  if (P.rescue && raidFor && today - g.lastRescue >= 8 && spareHands >= 3) {
    held.unshift(...held.splice(held.indexOf(raidFor), 1));
    const f = factionById(state, held[0].location.factionId);
    if (f && f.alive && f.bases.length) {
      const ammo = Math.min(Math.max(0, baseAmmo(state, h) - 60), ransomValue(f, captivesAt(state, f.id)) * 2);
      cands.push({ mission: "rescue", tile: held[0].location.tile, score: 4, crew: 3, why: `get ${first(held[0])} back from ${f.name}`, supplies: { ammo } });
    }
  }
  // Finds the teams reported, our dead's gear, a vehicle left behind.
  for (const m of state.markers) {
    if (state.grid.distance(m.tile, h.tile) > P.range) continue;
    if (state.parties.some((p) => p.owner === "player" && p.dest === m.tile)) continue;
    // A find tried lately waits FIND_COOLDOWN days (a wreck left, a restore that failed, a find already gone).
    const tried = (g.findTried || {})[m.key];
    if ((m.type === "cache" || m.type === "camp" || m.type === "car") && tried != null && today - tried < FIND_COOLDOWN) continue;
    if ((m.type === "cache" || m.type === "camp") && !(m.info && m.info.emptied)) cands.push({ mission: "investigate", tile: m.tile, score: m.type === "cache" ? 2.6 : 1.8, crew: 2, why: `check the ${m.label.toLowerCase()}`, findKey: m.key });
    if (m.type === "car" && !(m.info && m.info.emptied)) {
      // Restored with the car parts and fuel the hub can pay (vehicles.js wreckSupplies), else stripped for its parts.
      const kit = carsAtBase(state, h.id).length ? null : wreckSupplies(h.stock);
      cands.push(kit
        ? { mission: "investigate", tile: m.tile, score: 2.2, crew: 2, why: "a wrecked car to restore", supplies: kit, findKey: m.key }
        : { mission: "investigate", tile: m.tile, score: 1, crew: 2, why: "a wrecked car to strip for parts", findKey: m.key });
    }
    if (m.type === "death" && m.info && m.info.items > 0) cands.push({ mission: "recover", tile: m.tile, score: Math.min(2.5, 0.8 + m.info.items * 0.3), crew: 2, why: "recover our dead's gear" });
    const lostBikes = m.type === "vehicle" && isBike(state.vehicles.find((x) => x.id === m.info?.vehicleId));
    if (lostBikes) cands.push({ mission: "getvehicle", tile: m.tile, score: 1.6, crew: 2, why: "bring our bikes home", supplies: { scrap: 1 } });
    else if (m.type === "vehicle" && !carsAtBase(state, h.id).length) {
      const bad = m.info && m.info.condition < 15;
      // One found on a map that needs work (foundcars.js): only with a good enough mechanic at the hub, and its parts.
      const fv = state.vehicles.find((x) => x.id === m.info?.vehicleId);
      const fix = fv && fv.found && fv.found.repair;
      if (fv && fv.destroyed) { cands.push({ mission: "getvehicle", tile: m.tile, score: 0.8, crew: 2, why: `strip the wreck of our ${fv.name.toLowerCase()}`, supplies: {} }); continue; } // launchers.js: blown up, past repair
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
  cands.push(...woodTripCands(state, h, pool, P)); // woodcutting.js: wood when the land around the hub gives little
  cands.push(...jobTripCands(state)); // jobs.js: scouting, fetching a package, a horde to cull (Aggressive)
  cands.push(...gatheringCands(state, h, pool, P, stormValue)); // hivebirth.js: break up the dead massing for a new hive
  cands.sort((a, b) => b.score - a.score);

  for (const c of cands.slice(0, P.reserves ? 20 : 8)) {
    const res = launchTrip(state, c, pool, c.mission === "hive" ? Math.max(HIVE_SQUAD, c.crew || 0) : c.mission === "assault" ? HIVE_SQUAD : spareHands); // hiveCandidate / conquestCandidate checked who stays home
    if (!res) continue;
    if (c.outer) g.stats.farTrips = (g.stats.farTrips || 0) + 1;
    g.lastLaunch = today;
    if (c.mission === "outpost" || c.mission === "occupy") g.lastOutpost = today;
    if (c.mission === "rescue") g.lastRescue = today;
    if (c.findKey) (g.findTried = g.findTried || {})[c.findKey] = today; // FIND_COOLDOWN
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
  const sv = surveyCandidate(state, spare2) || poiSurveyCandidate(state, spare2); // a sweep, else a POI survey of a tile (survey.js)
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
  if (foodIn(h.stock) > n * 30 + 20 && spare.food > 0) Object.assign(goods, sellPick(h, Math.min(20, Math.floor(foodIn(h.stock) - n * 30), spare.food))); // foods.js: as the items the hub holds most of
  if (baseAmmo(state, h) > n * 15 + 100 && !campaignAmmoWant(state)) goods.ammo = Math.min(60, Math.floor(baseAmmo(state, h) - n * 15 - 60)); // not the campaign's stockpile
  if ((h.stock.meds || 0) > n + 8) goods.meds = Math.min(4, Math.floor(h.stock.meds - n - 6));
  const value = Object.entries(goods).reduce((a, [k, q]) => a + q * supValue(k), 0);
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
      today - (last[x.id] ?? -99) >= (P.envoyEvery ?? ENVOY_EVERY))
    .map((x) => ({ x, d: Math.min(...x.bases.map((b) => state.grid.distance(b, h.tile))) }))
    // The war council aims the envoys: the groups nearest the campaign's hive and the coalition's land first (their
    // fighters join the storm, alliance.js hiveAllies, and their land counts), then the nearest to home.
    .filter((o) => o.d <= P.range * (P.envoyReach ?? ENVOY_REACH)).sort((a, b) => aimAt(state, a.x) - aimAt(state, b.x) || a.d - b.d)[0];
  if (!f) return null;
  // Gifts while their goodwill is short; a group that trusts you already only needs the visit (the invitation).
  const courted = f.x.goodwill >= ALLIANCE.GOODWILL && f.x.pact;
  if (!courted && !goods && !P.envoyBare) return null; // envoyBare (Diplomat): it goes to talk even with nothing to give
  return { mission: "trade", tile: f.x.bases.find((b) => state.grid.distance(b, h.tile) === f.d), score: courted ? 3 : 2.2, crew: 2, envoy: f.x.id, reach: P.envoyReach ?? ENVOY_REACH,
    why: `an envoy to ${f.x.name} (goodwill ${Math.round(f.x.goodwill)}${f.x.pact ? "" : ", no pact"}): ${courted ? "the invitation to the coalition" : "gifts and talk for the coalition"}`, supplies: courted ? {} : goods || {} };
}

// ---------- the war on the hives (hives.js) ----------
// The odds are judged as the hive card shows them: the squad (stormValue) against the brood it expects
// (hives.js broodForce from the guard last seen at the mound, HIVE_GUESS if it was never seen up close; the
// fighters coalition members and job givers send take their share, alliance.js hiveAllies). The ratio squad
// value (stormValue) / (brood × its power / 5.2) it wants is the style's hiveOdds (calibrated against the battle
// played by the AI on both sides: about 1.3 costs a fighter in three storms, 1.1 about one a storm, 0.9 two or
// three and sometimes the squad). Nothing from outside burns a hive any more (2026-10): the storm is the crawl to the
// core, and the gate for it is the core's odds by the numbers (hivecrawl.js coreGate, fitted to the map: the squad's
// lights and the Molotovs and bangs it carries or the armory would give it, the wear of the way in), at least the
// style's stormNeed. Targets: known hives, nearest first, ahead of them those
// within 12 tiles of one of your bases (their hordes hit you first), those a group asked you to storm (their
// fighters join) and those with a small guard.
const HIVE_GUESS = 100;  // guard assumed at a hive never seen up close
const HIVE_SQUAD = 6;    // a storm is six fighters
const HIVE_KEEP = 3;     // people a hive mission leaves at the hub at least
const HIVE_HEALTH = 80;  // fit to storm a hive
const HIVE_AMMO = 12;    // ammo a fighter wants for a storm
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
  const hit = w.melee ? 0.2 * (75 + meleeAimBonus(s)) / 75 * meleeDmgMult(s) : Math.max(0.05, Math.min(0.95, (40 + skill(s, "shooting") * 2.5 - (1 - mult) * 30 + (w.aim || 0) + traitAim(s)) / 100)); // Brave, Coward (traits.js); melee by the Melee skill (world.js MELEE_SKILL)
  return ((hit * dmg) / 10) * (0.5 + s.health / 200) * Math.sqrt(1 / Math.max(0.3, armorMult(s)));
}
const hiveSquad = (pool, size = HIVE_SQUAD) => [...pool].filter((s) => s.health >= HIVE_HEALTH && !s.woundInfected).sort((a, b) => stormValue(b) - stormValue(a)).slice(0, size);
// A bigger hub sends a bigger squad into a hive (progression census 2026-10-09: the core room of a tier-1 hive beat
// six of the autopilot's fighters three times in four on the battle map; a player with forty people would not send
// six): 24 or more at the hub send eight, 36 or more ten. [people at home, squad]
const HIVE_SQUAD_BIG = [[36, 10], [24, 8]];
const hiveSquadSize = (n) => { for (const [k, size] of HIVE_SQUAD_BIG) if (n >= k) return size; return HIVE_SQUAD; };
const squadPower = (list) => list.reduce((a, s) => a + stormValue(s), 0);
// The guard you know of at a hive: what is in sight there now, else the last look (never below the 40 a hive
// rebuilds its guard to), else a guess.
function knownGuard(state, id) {
  if (state.live.has(id)) return Math.max(HIVE_GUARD_MIN, snapshot(state, id).hordeSize);
  const k = state.knowledge[id];
  return k && k.hordeSize ? Math.max(HIVE_GUARD_MIN, k.hordeSize) : HIVE_GUESS;
}
const HIVE_GUARD_MIN = 40;
// The core's odds the style wants before the squad goes straight for it (a storm trip): 0.5 + 0.25 × its hiveOdds,
// 0.7–0.9 (Aggressive 0.75, Balanced 0.8, Cautious about 0.84): the crawl's own gate for the core is AUTO.coreOdds
// (0.75) on the team as it stands when it gets there.
const stormNeed = (P) => Math.max(0.7, Math.min(0.9, 0.5 + 0.25 * P.hiveOdds));
// What the armory would give a hive squad on the way out (kit.js packTripKit, packHiveKit): a light each for those
// without, the Molotovs and the bangs (flashbangs, frag grenades, pipe bombs) up to HIVE_KIT.
const HIVE_PREP = { fire: ["molotov"], stun: ["flashbang", "frag", "pipebomb"], kit: 4 };
function armoryPrep(base, squad) {
  const arm = (base && base.armory) || [];
  const count = (keys) => Math.min(HIVE_PREP.kit, arm.filter((it) => it && keys.includes(it.key)).length);
  const lights = arm.filter((it) => it && LIGHTS[it.key]).length;
  return { lights: Math.min(lights, squad.length), fire: count(HIVE_PREP.fire), stun: count(HIVE_PREP.stun) };
}
// The core's odds for this squad at a guard of `guard` (hivecrawl.js coreGate), with what the armory would give it.
function stormOdds(state, hive, squad, guard, base = null) {
  return coreGate(state, hive, squad, guard, base ? armoryPrep(base, squad) : {}).win;
}
// What a crawl takes: ammo and meds by the den's depth, hours inside (launchTrip's time on site).
const crawlKit = (state, hive) => { const e = crawlEstimate(state, hive); return { ammo: 60 + 15 * e.depth, meds: 3 + Math.ceil(e.depth / 2), hours: e.hours }; };
// planTrip's hive candidate (null: none this morning; hiveRejects counts why). The target is the campaign's hive
// (planCampaign: the nearest known, a group's job first). A storm trip goes when the squad, the ammo stockpile and the
// core's odds (stormOdds at least stormNeed) are there. Else a crawl trip (hivecrawl.js): the squad crawls as deep as
// it can, killing brood (each one thins the guard) and burning egg chambers, and comes home when hurt; the chambers it
// cleared stay clear for a while and the next trip gets further: only when the squad is well over the worst chamber
// on the way (crawlRatio). Else it waits for better odds.
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
  if (today < P.hiveFrom) return waits("early"); // this style starts on the hives from its hiveFrom day
  if (today - (g.lastHive ?? -99) < P.hiveRest) return waits("rest");
  const size = hiveSquadSize(home.length);
  if (home.length - size < Math.max(HIVE_KEEP, Math.ceil(home.length * P.homeFrac * 0.6))) return waits("home");
  const squad = hiveSquad(pool, size);
  if (squad.length < size) return waits("squad");
  const power = squadPower(squad);
  const guard = knownGuard(state, hive.tile);
  const odds = stormOdds(state, hive, squad, guard, h);
  const kit = crawlKit(state, hive); // deeper hives: more ammo and meds, longer inside
  if (odds >= stormNeed(P)) {
    if (baseAmmo(state, h) < campaignAmmoTarget(state, h)) return waits("ammo");
    c.waits = "storm";
    return { mission: "hive", tile: hive.tile, score: 6, crew: size, hive: true, onSite: kit.hours,
      why: `destroy ${hive.name} (its core about ${Math.round(odds * 100)}% for the squad, ${crawlEstimate(state, hive).depth} chambers in)`,
      supplies: { ammo: kit.ammo, meds: kit.meds, fuel: 3 }, min: {} };
  }
  if (crawlRatio(state, hive, power, guard) >= P.hiveOdds * CAMPAIGN.crawlOdds) {
    if (baseAmmo(state, h) < campaignAmmoTarget(state, h)) return waits("ammo");
    c.waits = "crawl";
    return { mission: "hive", tile: hive.tile, score: 5, crew: size, hive: true, crawlTrip: true, onSite: kit.hours,
      why: `crawl into ${hive.name} (its core ${crawlEstimate(state, hive).depth} chambers in): clear the way and thin its brood for the storm (the core about ${Math.round(odds * 100)}% for the squad, ${Math.round(stormNeed(P) * 100)}% wanted)`,
      supplies: { ammo: kit.ammo, meds: kit.meds, fuel: 3 }, min: {} };
  }
  return waits("odds");
}
// The hive card (hives.js): in when the core's odds are there (or on a crawl trip), else back off.
function hiveChoice(state, card, opts, p, find) {
  const P = persona(state);
  const hive = p ? hiveAt(state, partyTile(p)) : null;
  if (!hive) return find(/^Back off/);
  const fit = partyMembers(state, p).filter((s) => s.health >= 60);
  const guard = hiveForce(state, hive).guard; // the card says how many are packed around it
  // Guns need ammo (an assault rifle 2 a shot): no storm with less than HIVE_AMMO a fighter.
  const ammo = teamAmmo(state, p); // ammo.js: rounds that fit their guns
  const armed = ammo >= fit.length * HIVE_AMMO;
  // In by the mouth with the least brood on its way in (hivecrawl.js crawlEstimate: one choice for each of the four).
  const way = crawlEstimate(state, hive, guard).mouth;
  const enter = opts.find((c) => c.mouth != null && c.mouth === way) || find(/^Enter the hive/);
  if (armed && fit.length >= HIVE_SQUAD - 1 && coreGate(state, hive, fit, guard).win >= stormNeed(P)) return enter; // hivecrawl.js: the crawl to the core (hiveCrawlAutoStep)
  if (armed && p.apCrawlTrip && fit.length >= HIVE_SQUAD - 1) return enter; // a crawl trip: as deep as it can, then home
  return find(/^Back off/);
}
// An old save's team told to storm again after its fires (p.apHiveAgain, before the fires were taken out): it does,
// when it is still fit for it.
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
  const thin = 1 - Math.min(0.3, extra * 0.05); // their fighters thin the brood in every chamber (alliance.js)
  return stormOdds(state, hive, squad, Math.round(knownGuard(state, hive.tile) * thin), h) >= stormNeed(P) && state.grid.distance(h.tile, hive.tile) <= 40;
}

// ---------- the hive campaign ----------
// gov(state).campaign: the hive the governor works toward (planCampaign, each morning): the nearest known hive
// within CAMPAIGN.far of the hub, a hive a group asked it to storm (jobs.js) first, one within 12 tiles of a base
// next; it sticks to its target while that stands. Toward it the hub stockpiles ammo to campaignAmmoTarget
// (HIVE_SQUAD × HIVE_AMMO + CAMPAIGN.ammoExtra: needs() asks for ammo, so trips go to gun stores and the like,
// radio deals and trade visits ask for it, the ammo bench runs to it, and no envoy gives ammo away), sends crawl trips
// while the core is beyond the squad (hiveCandidate), courts and invites the groups
// near the target first (aimAt: envoys, pacts; alliance.js hiveAllies counts a member's fighters at the mound) and
// storms when the odds are there. campaignLine says what it waits for (the Goals panel / the morning log).
const CAMPAIGN = { far: 60, ammoExtra: 20, nearBase: 12, crawlOdds: 1.4 }; // crawlOdds: × hiveOdds over the worst chamber for a crawl trip
// The squad over the worst chamber on the shortest way in (its brood × power / 5.2, at a guard of `guard`).
function crawlRatio(state, hive, power, guard) {
  const est = crawlEstimate(state, hive, guard);
  return power / Math.max(1, est.worst);
}
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
  const have = baseAmmo(state, h);
  return have < target * 0.5 ? 2.4 : have < target ? 1.9 : 0;
}
// The campaign's fuel: none held or asked for any more (the fires around the mound are gone, 2026-10); kept as the
// hooks the trips and the needs read (0).
const campaignFuelWant = () => 0;
const campaignFuelHold = () => 0;
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
    early: `day ${persona(state).hiveFrom}, when this style starts on the hives`, rest: "the squad to rest between hive missions", home: "enough people to keep the hub safe while the squad is out", squad: "six fit fighters", ammo: `the ammo stockpile (${baseAmmo(state, h)} of ${target})`,
    odds: "better odds: a stronger squad, lights, Molotovs and flashbangs for the core, or allies near the mound", fires: "better odds", crawl: "the next crawl trip into the hive", storm: "nothing: the storm goes out", far: "a hive within reach", unknown: "a known hive",
  };
  // A storm or crawl trip picked this morning that could not get away (launchTrip: rations, a car, a way there) is not out.
  const out = state.parties.some((p) => p.owner === "player" && p.mission === "hive");
  const wait = (c.waits === "storm" || c.waits === "crawl") && !out ? "the squad to get away (its rations, a car for the drive, or a way there over land)" : WAIT[c.waits] || "the morning's plan";
  return `Campaign on ${hive.name} (${state.grid.distance(hive.tile, h.tile)} tiles, guard about ${knownGuard(state, hive.tile)}): ${baseAmmo(state, h)} of ${target} rounds that fit the guns, allies: ${allies.length ? allies.join(", ") : "none yet"}${near.length ? ` (courting ${near.join(", ")})` : ""}. Waiting for ${wait}.`;
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
  const centres = landCentres(state, true);
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
  const mask = coalitionMask(state, true);
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
  if (f.bases.some((b) => coalitionMask(state, true)[b])) return "holds a base on the coalition's land";
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
  const ammo = teamAmmo(state, p); // ammo.js: rounds that fit their guns
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
  if (squad.length < ASSAULT_MIN || baseAmmo(state, h) < squad.length * ASSAULT_AMMO + 30) return null;
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
    const odds = assaultOdds(power, force, true, squad.length, state);
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
    const odds = assaultOdds(power, force, true, squad.length, state);
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
  const odds = assaultOdds(squadValue(squad), assaultForce(state, f, occ.tile), true, squad.length, state);
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
  const ammo = teamAmmo(state, p); // ammo.js: rounds that fit their guns
  const odds = teamAssaultOdds(state, p, assaultForce(state, f, card.assault.tile, p));
  const retake = !!occupiedAt(state, card.assault.tile);
  const exile = !hub(state);
  const oldHub = retake && occupiedAt(state, card.assault.tile).wasHub;
  const need = exile ? 0.4 : oldHub ? 0.33 : P.conquerOdds - (retake ? 0.15 : 0.08);
  if (fit.length >= (exile || oldHub ? 1 : ASSAULT_MIN - 1) && ammo >= fit.length * 4 && odds >= need) return find(/^Storm the base/);
  return find(/^Back off/);
}
// No base left (conquest.js exiles): take back the nearest base of yours they hold if the odds are fair, else set up
// the camp that becomes the hub like hardcore's first (roadAct).
function exileAct(state, p) {
  const g = state.grid;
  const here = partyTile(p);
  const scrap = carried(p, "scrap");
  const going = false; // (a camp under way is a base: the team has a home and is not here)
  const lost = lostBases(state).map((o) => ({ o, f: factionById(state, o.factionId) })).filter((x) => x.f && x.f.alive)
    .map((x) => ({ ...x, odds: teamAssaultOdds(state, p, assaultForce(state, x.f, x.o.tile, p)), d: g.distance(here, x.o.tile) })).sort((a, b) => b.odds - a.odds || a.d - b.d)[0];
  if (lost && (lost.odds >= (going ? 0.6 : 0.45) || (!going && scrap < stagingNeeds(state).scrap)) && lost.odds >= 0.2 && planPath(state, here, lost.o.tile, p.vehicle)) {
    if (here === lost.o.tile) { giveOrder(state, p, "assault"); return; }
    orderMove(state, p, lost.o.tile);
    p.orders = [{ type: "mission", mission: "assault" }];
    say(state, `${teamName(state, p)}: no base left, so it goes to take ${lost.o.name} back (${Math.round(lost.odds * 100)}%).`);
    return;
  }
  // occupy.js: a base standing empty within reach that the team can clear: a home already built.
  const empty = going ? null : (state.abandoned || []).filter((r) => g.distance(here, r.tile) <= OCCUPY.GOV_RANGE && !occupyProblem(state, r.tile) && planPath(state, here, r.tile, p.vehicle))
    .map((r) => ({ r, odds: teamOccupyOdds(state, p, abandonedThreat(state, r.tile)), d: g.distance(here, r.tile) })).filter((x) => x.odds >= OCCUPY.AI_ODDS).sort((a, b) => a.d - b.d || b.odds - a.odds)[0];
  if (empty) {
    if (here === empty.r.tile) { giveOrder(state, p, "occupy"); return; }
    orderMove(state, p, empty.r.tile);
    p.orders = [{ type: "mission", mission: "occupy" }];
    say(state, `${teamName(state, p)}: no base left, so it goes to move into the empty base at ${tileLabel(state, empty.r.tile)} (${Math.round(empty.odds * 100)}%).`);
    return;
  }
  roadAct(state, p);
}

// ---------- the road with no base: the camp that becomes the hub (staging.js) ----------
// Hardcore's first hub and the exiles' new one. The team sets up camp (Establish base) at the best spot near it (hubSites:
// water, sites around, few of the dead) once it carries a share of the scrap or after a few days, then ferries
// what the camp lacks (searching nearby, pulled toward the camp), and from then on the camp is a base the governor
// runs like any other; on the road the team rests, fetches water or eats like any team. It fetches water at a river when short and
// one is close, rests when someone is badly hurt.
// ROAD: reach = tiles it looks for sites in (wider when nothing is near); low = days of food or water that make
// them urgent; heal = health under which it camps; fetchExtra = water it fills beyond what it lacks; huntHours /
// huntMin = a hunt or fishing trip for food, and the rations it must promise.
// CAMP: pitchShare / pitchDay = when it pitches (a share of the scrap carried, or from this day); ferryShare = share
// of the missing scrap and parts carried that sends it back to the camp within ferryReach tiles; pull = how much
// farther sites from the camp count against them; workDays = days of work it brings food and water for; range =
// tiles from the camp it searches first. Short of food or water it goes back to the camp when the stores can spare
// some.
const ROAD = { reach: 6, wide: 11, low: 2, heal: 40, foundReach: 4, fetchExtra: 4, campHours: 8, huntHours: 8, huntMin: 4, forageLow: 1 }; // forageLow: foraging.js (landFoodAct)
const CAMP = { pitchShare: 0.3, pitchDay: 3, ferryShare: 0.5, ferryReach: 6, pull: 0.15, workDays: 3, range: 7, waterReach: 9 }; // waterReach: camp sites by water (staging.js)
const roadDays = (state, p, k) => {
  const n = Math.max(1, partyMembers(state, p).length);
  return k === "water" ? teamWaterIn(p) / (n * thirstAt(state)) : carried(p, "food") / (n * teamCold(state, p)); // food: days of it (foods.js); the cold unless by a lit camp fire (needs.js)
};
// What the team should still gather: what the camp lacks (or the whole need with no camp yet) less what it carries,
// plus food and water to live on while it works there. { key: qty }.
function roadMissing(state, p) {
  const camp = null; // a camp is a base (staging.js): on the road there is none yet
  const needs = stagingNeeds(state);
  const n = Math.max(1, partyMembers(state, p).length);
  const days = CAMP.workDays + 1;
  const out = {};
  // Building materials the camp still lacks are made from scrap (crafting.js buildmat): that much more scrap (setting
  // up camp itself takes none: staging.js STAGING.PITCH).
  const bmLack = Math.max(0, (needs.buildmat || 0) - carried(p, "buildmat") - 0);
  for (const k of ["scrap", "parts", "food", "water"]) {
    const have = k === "water" ? teamWaterIn(p) : carried(p, k); // food: days of it (parties.js carried)
    const own = k === "food" ? n * days : k === "water" ? n * days * thirstAt(state) : k === "scrap" ? bmLack * CRAFTS.buildmat.in.scrap + (camp ? 0 : STAGING.PITCH.scrap) : 0;
    const want = (needs[k] || 0) + own;
    if (have < want - 0.5) out[k] = Math.ceil(want - have);
  }
  return out;
}
function roadNeeds(state, p) {
  const miss = roadMissing(state, p);
  const wLow = roadDays(state, p, "water") < ROAD.low, fLow = roadDays(state, p, "food") < ROAD.low;
  const out = {
    water: wLow ? 3 : miss.water ? 1.4 : 0.25, food: fLow ? 3 : miss.food ? 1.4 : 0.3,
    scrap: miss.scrap ? (wLow || fLow ? 0.8 : 2) : 0.1, parts: miss.parts ? (wLow || fLow ? 1 : 2.6) : 0.2,
    meds: 0.6, ammo: 0.5, fuel: 0.05, jars: 0,
  };
  for (const k of FOOD_KEYS) out[k] = out.food; // every food item (foods.js) as food
  return out;
}
// The camp: with no base at all the team sets up camp with its step up queued (Establish base, staging.js) at the best
// spot near it (hubSites: water beside, sites around, few of the dead). From then on the camp is a base and the
// governor runs it like any other (its builders, its trips out for scrap and building materials, crafting
// building materials from scrap). Before it, the team makes building materials from scrap it carries beyond the step
// up's scrap (crafting.js buildmat, a field craft: 3 hours). True when the team was given an order.
function campAct(state, p) {
  const here = partyTile(p);
  const needs = stagingNeeds(state);
  {
    const bmLack = (needs.buildmat || 0) - carried(p, "buildmat");
    const scrapSpare = carried(p, "scrap") - (needs.scrap || 0);
    const opt = bmLack > 0 && scrapSpare >= CRAFTS.buildmat.in.scrap ? fieldCraftOptions(state, p).find((x) => x.key === "buildmat") : null;
    if (opt && opt.ok) {
      startOrder(state, p, { type: "craft", recipe: "buildmat" });
      say(state, `${teamName(state, p)} makes building materials from scrap for the camp (${bmLack} still wanted).`);
      return true;
    }
  }
  const ok = (s) => !establishProblem(state, s.id) && (s.id === here || planPath(state, here, s.id, p.vehicle));
  let sites = hubSites(state, here, ROAD.foundReach).filter(ok);
  // No spring at a camp: with no spot beside water close by, look farther for one (CAMP.waterReach).
  if (!sites.length || sites[0].waterDist !== 1) { const wet = hubSites(state, here, CAMP.waterReach).filter((s) => s.waterDist === 1 && ok(s)); if (wet.length) sites = wet; }
  const best = sites[0];
  const atHere = sites.find((s) => s.id === here);
  if (!best) return false;
  if (best.id === here || (atHere && atHere.sc >= best.sc - 0.5)) {
    say(state, `${teamName(state, p)} sets up camp at ${tileLabel(state, here)} for the ${firstHubPending(state) ? "first" : "new"} home.`, "good");
    giveOrder(state, p, "establish");
    return true;
  }
  if (orderMove(state, p, best.id) && p.phase === "out") {
    p.orders = [{ type: "mission", mission: "establish" }];
    say(state, `${teamName(state, p)} heads for ${tileLabel(state, best.id)} to set up camp there.`, "good");
    return true;
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
  // Out of food (under half a day) and no camp's stores to spare: food from the land before the camp's
  // business (landFoodAct, foraging.js).
  const campSpare = 0; // (no camp yet: a camp is a base)
  if (fDays < LAND.critical && campSpare < members.length && landFoodAct(state, p, { urgent: true })) return;
  // The camp: set it up (Establish base) at a good spot.
  if (campAct(state, p)) return;
  if (!state.parties.includes(p) || p.phase !== "waiting") return;
  const camp = null;
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
  const need = stagingNeeds(state);
  const left = [];
  // Exiles keep what they carried out of their base (it is all they have); hardcore's few things are the road's.
  for (const [k, extra] of firstHubPending(state) ? Object.entries(ROAD_KEEP) : []) {
    const keep = Math.max(0, need[k] || 0) + extra;
    const over = Math.floor(carried(p, k) - keep);
    if (over <= 0) continue;
    const took = takeSupply(p, k, over);
    if (took >= 1) left.push(`${took} ${keyWord(k)}`);
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
  if (need.ammo <= 0.35 && baseAmmo(state, h) > n * 40 + 100) goods.ammo = Math.floor(Math.min(300, baseAmmo(state, h) - n * 40));
  if (need.food <= 0.6 && foodIn(h.stock) > n * 30) Object.assign(goods, sellPick(h, Math.floor(Math.min(16, foodIn(h.stock) - n * 30)))); // foods.js: the items the hub holds most of
  if (need.meds <= 0.3 && (h.stock.meds || 0) > n * 2 + 4) goods.meds = Math.floor(Math.min(6, h.stock.meds - n * 2));
  if (persona(state).reserves) {
    // Cautious: what is well above its reserve goes to market (parts, and food beyond the food planner's target).
    const rs = reserveStatus(state, h);
    if ((h.stock.parts || 0) > rs.parts.target + 4) goods.parts = Math.floor(Math.min(10, h.stock.parts - rs.parts.target - 2));
    const keepFood = n * (foodTarget(state, h) * 1.2 + 10);
    if (need.food <= 0.6 && foodIn(h.stock) > keepFood + 10) { for (const k of Object.keys(goods)) if (FOODS[k]) delete goods[k]; Object.assign(goods, sellPick(h, Math.floor(Math.min(40, foodIn(h.stock) - keepFood)))); }
  }
  const value = Object.entries(goods).reduce((a, [k, q]) => a + q * supValue(k), 0);
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
  // landEarly (Diplomat, Expansionist): as soon as the coalition has a member.
  const settled = gp.alliance.allIn || (gp.alliance.members > 0 && (persona(state).landEarly || gp.alliance.outsiders.every((o) => o.hostile))) || gp.alliance.land.pct >= 0.35;
  // Land that will count once the new members have their year (alliance.js landSoon) is land enough: no more outposts for it.
  return settled && !gp.alliance.landOk && !(gp.alliance.landSoon.pct > ALLIANCE.LAND_NEEDED) && day(state) >= 150 && alive(state).length >= 12;
}
function landOutpostSite(state) {
  const h = hub(state);
  const g = state.grid;
  // The members that will count by time alone count here (alliance.js landCentres soon): no outpost over a new member's land.
  const R = controlRadius(state, "outpost");
  const held = new Uint8Array(state.tiles.length);
  for (const c of landCentres(state, true)) for (const id of g.within(c.tile, c.r)) held[id] = 1;
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
    // Wood land within reach (woodcutting.js): the winter's wood cut at the door, not hauled from afar.
    const woodLand = g.within(id, WOOD.base.radius).reduce((a, x) => a + woodAbundance(state, x), 0);
    const score = farm + (t.loc ? 0.5 : 0) + (t.road ? 0.4 : 0) + Math.min(0.4, woodLand * 0.08) - d * 0.05 - k.infection;
    if (!best || score > best.score) best = { id, score };
  }
  return best ? best.id : null;
}

// ---------- giving up a doomed outpost (occupy.js abandonOutpost) ----------
// Conservative (OCCUPY.DOOM_*): only in autumn or winter, an outpost whose own stores and fields run out within
// DOOM_DAYS, whose supply line to the hub is weak or cut, while the hub's own winter plan (counting every outpost) is
// short too, so nothing can be sent; its people must have a way home. One every DOOM_EVERY days. Its buildings stay
// as an empty base (Reoccupy it in spring).
export function doomedOutpost(state, o) {
  const h = hub(state);
  if (!h || o.type !== "outpost" || !atBase(state, o.id).length || abandonProblem(state, o)) return null;
  if (!winterActive(state, h) || (wxSeason(state).key !== "autumn" && wxSeason(state).key !== "winter")) return null;
  const own = winterOutlook(state, o);
  const today = Math.floor(state.hour / 24);
  if (own.runsOut == null || own.runsOut - today > OCCUPY.DOOM_DAYS) return null;
  const line = supplyLine(state, o);
  if (line.strength >= OCCUPY.DOOM_LINE) return null;
  if (winterPlan(state, h).short <= 0) return null;
  return { runsIn: Math.max(0, own.runsOut - today), line: line.strength };
}
function abandonDoomed(state) {
  const g = gov(state);
  if (day(state) - (g.lastAbandon ?? -999) < OCCUPY.DOOM_EVERY) return;
  for (const o of state.bases.filter((b) => b.type === "outpost")) {
    const d = doomedOutpost(state, o);
    if (!d) continue;
    const name = o.name;
    const text = abandonOutpost(state, o, "it cannot be fed through the winter");
    g.lastAbandon = day(state);
    g.stats.abandoned = (g.stats.abandoned || 0) + 1;
    say(state, `Gave up ${name}: its food runs out in about ${d.runsIn} day${d.runsIn === 1 ? "" : "s"}, its supply line is ${d.line > 0 ? `weak (${Math.round(d.line * 100)}%)` : "cut"} and the hub's winter stores are short too. ${text}`);
    return;
  }
}

// ---------- moving into an abandoned base (occupy.js) ----------
// When the governor wants an outpost, a base standing empty within OCCUPY.GOV_RANGE tiles of the hub that the map shows
// (live, or a report) and that the fittest of the pool can clear at OCCUPY.AI_ODDS (OCCUPY.GOV_CREW of them, up to
// GOV_CREW_MAX when the dead or squatters inside ask for more) comes first: it costs no scrap and what stands there
// is weeks of building. Not where moving in would anger a coalition member or a pact partner. More standing, nearer:
// better.
// Fit for the crew: healthy, by combat power counted as the fight will (a gun with no rounds of its calibre in the
// base's stores fights at armedFactor's short share: two shotguns and no shells are not a squad).
const occFit = (h) => (s) => (s.health >= 60 && !s.woundInfected ? combatPower(s) * armedFactor([s], h.stock, h.stock.arrows || 0) : -99);
export function occupyCandidate(state, h, pool, spareHands) {
  const g = state.grid;
  const OCC_FIT = occFit(h);
  const squad = [...pool].filter((s) => OCC_FIT(s) > -99).sort((a, b) => OCC_FIT(b) - OCC_FIT(a) || a.id - b.id);
  const most = Math.min(spareHands, OCCUPY.GOV_CREW_MAX, squad.length);
  let best = null;
  for (const rec of state.abandoned || []) {
    const d = g.distance(rec.tile, h.tile);
    if (d > OCCUPY.GOV_RANGE || occupyProblem(state, rec.tile)) continue;
    const known = state.live.has(rec.tile) || !!(state.knowledge[rec.tile] && state.knowledge[rec.tile].abandoned);
    if (!known || state.parties.some((p) => p.owner === "player" && p.dest === rec.tile)) continue;
    if (occupyGrievance(state, rec.tile).some((x) => isMember(state, x.f) || x.f.pact)) continue;
    const stand = standingAt(state, rec).filter((b) => !b.broken).length;
    if (stand < OCCUPY.GOV_MIN_STANDING) continue; // a bare group base: no better than new ground
    const threat = abandonedThreat(state, rec.tile);
    let n = Math.min(OCCUPY.GOV_CREW, most), odds = 0;
    for (; n <= most; n++) { odds = occupyOdds(squad.slice(0, n), threat, h.stock, h.stock.arrows || 0); if (odds >= OCCUPY.AI_ODDS) break; } // the rounds at home for their guns
    if (n > most || n < 2 || odds < OCCUPY.AI_ODDS) continue;
    const score = 3.6 + Math.min(1.5, stand * 0.2) - d * 0.05;
    if (!best || score > best.score) best = { rec, n, odds, stand, score, threat };
  }
  if (!best) return null;
  const { rec, n } = best;
  return { mission: "occupy", tile: rec.tile, score: best.score, crew: n, squadMin: 2, fit: OCC_FIT,
    why: `move into ${rec.from === "player" ? `${rec.fromName}, our old outpost` : `the base ${rec.fromName} left`} (${best.stand} building${best.stand === 1 ? "" : "s"} standing; ${best.threat.count ? `${Math.round(best.odds * 100)}% against ${best.threat.count} inside` : "nobody inside"}) instead of building an outpost`,
    supplies: { ammo: 10 * n, meds: 1 } };
}

// ---------- the trip's car, mended before it leaves (vehicle-wear pass, 2026-10-10) ----------
// launchTrip takes the best-kept car at the base for a drive of 3+ tiles (none under 30%). Under VEH_REPAIR.below%
// condition the governor mends it first, up to VEH_REPAIR.most repairs until it is back to VEH_REPAIR.below% (vehicles.js
// repair: +25 at a garage, +12 with a Mechanics 4+ hand, a car part a time): one +12 repair of a car at 10% left it
// under the 30% a drive needs, so it stayed home, the repair was undone, and the same repair was made and undone on
// every trip after (a Cautious run: 564 of them in two years, the car at about 10% and 4 trips by car). Car parts pay first; machine parts stand in (vehicles.js CARPART_SUB, 2 for one) only for a car under
// VEH_REPAIR.machineBelow% (where it breaks down every few tiles) and only out of what the base keeps past its machines'
// reorder level (repair.js partPlan: generators, wells, benches, the machine shop): machine parts are what keeps the
// water and the power going, and car parts are found at auto shops, gas stations and wrecks and sold by most traders.
// Before this pass every repair under 50% took machine parts whenever the hub held 2 (a third of the autopilot's machine
// parts went on cars over two years: tools/vehiclewear.js census).
// A trip called off after the repair (or the car left home) gives back exactly what the repair and the refuelling took
// (tripUndo): before, the hub's machine parts and fuel were set back to what they were, which lost the car part a repair
// paid and gave back twice what the trip had packed of them (a well-digging team's parts, a hive trip's fire fuel).
export const VEH_REPAIR = {
  below: 50, machineBelow: 35, most: 4,
  machineKeep: (state, base) => partPlan(state, base).targets.parts || 0,
};
/** @returns {{ cond: number, carparts: number, parts: number, fuel: number }} */
export const tripTook = () => ({ cond: 0, carparts: 0, parts: 0, fuel: 0 });
// Mends the trip's car when it needs it and the base can pay (see above); `took` adds what it took. True when it did.
export function tripRepair(state, base, v, took = tripTook()) {
  if (!v || !canRepair(state, base).ok) return false;
  let did = false;
  for (let i = 0; i < VEH_REPAIR.most && v.condition < VEH_REPAIR.below; i++) {
    const car = Math.floor(Math.max(0, base.stock.carparts || 0) + 1e-9);
    if (car < 1) {
      if (v.condition >= VEH_REPAIR.machineBelow) break;
      if ((base.stock.parts || 0) - CARPART_SUB < VEH_REPAIR.machineKeep(state, base) - 1e-9) break;
    }
    const c0 = v.condition, k0 = base.stock.carparts || 0, p0 = base.stock.parts || 0;
    repair(state, base, v);
    if (v.condition <= c0) break;
    took.cond += v.condition - c0;
    took.carparts += k0 - (base.stock.carparts || 0);
    took.parts += p0 - (base.stock.parts || 0);
    did = true;
  }
  return did;
}
// Gives back what tripRepair and the refuelling took (the trip is off, or the car stays home).
export function tripUndo(base, v, took) {
  if (!v || !took) return;
  v.condition -= took.cond;
  v.fuel -= took.fuel;
  if (took.carparts) base.stock.carparts = (base.stock.carparts || 0) + took.carparts;
  if (took.parts) base.stock.parts = (base.stock.parts || 0) + took.parts;
  if (took.fuel) base.stock.fuel = (base.stock.fuel || 0) + took.fuel;
  took.cond = took.carparts = took.parts = took.fuel = 0;
}

// ---------- a car worth less than its parts (vehicle-wear picks, 2026-10-10) ----------
// Once a day the governor (and a steward with Production on) strips a car parked at a base for its parts (vehicles.js
// stripVehicle: 3–8 car parts by its condition, 20 scrap and its fuel) when it is a burnt-out wreck, or when it is under
// STRIP_AT.below% and nobody there could mend it (no garage, no Mechanics 4+ hand: vehicles.js canRepair). It never
// strips the base's last car that runs (a mechanic or a garage may come; the next trip needs it once it is mended).
// A car under 30% does not drive (launchTrip), so such a spare only stood in the frost losing what its parts are worth.
export const STRIP_AT = { below: 20 };
export function stripDeadCars(state, base) {
  const cars = carsAtBase(state, base.id);
  const out = [];
  const strip = (v, why) => { say(state, `Stripping the ${v.name} at ${base.name} for parts: ${why}.`); out.push(stripVehicle(state, base, v)); }; // stripVehicle logs what it gave
  for (const v of cars.filter((x) => x.destroyed)) strip(v, "a burnt-out wreck");
  if (!canRepair(state, base).ok) {
    const running = () => carsAtBase(state, base.id).filter((x) => !x.destroyed);
    for (const v of running().filter((x) => x.condition < STRIP_AT.below && !(base.garage || []).some((j) => j.vehicleId === x.id)).sort((a, b) => a.condition - b.condition)) {
      if (running().length <= 1) break;
      strip(v, `${Math.round(v.condition)}% and nobody here can mend it (no garage, no Mechanics 4+)`);
    }
  }
  return out;
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
    (c.mission === "outpost" ? skill(s, "farming") * 0.4 : 0) + (c.mission === "sweep" || c.mission === "fullsurvey" ? skill(s, "scouting") * 0.6 - (s.role === "build" || (s.task && (s.task.t === "build" || s.task.t === "craft")) ? 4 : 0) : 0) - (s.role === "medic" ? 3 : 0) - (s.role === "build" ? 1.5 : 0);
  const crew = friendlyCrew(state, [...pool].sort((a, b) => fit(b) - fit(a)), size, fit); // near-equal picks: friends together, rivals apart (relations.js)
  const ids = crew.map((s) => s.id);
  const dist = state.grid.distance(h.tile, c.tile);
  // A vehicle for longer trips if it can make the round trip.
  let v = null;
  const cand = carsAtBase(state, h.id).filter((x) => x.condition > 0).sort((a, b) => b.condition - a.condition)[0];
  // The vehicle is repaired and refuelled for the estimate; if the trip is called off, the parts and the fuel
  // go back (a trip that never leaves costs nothing). Armor left home for the trip goes back on too.
  const took = tripTook(); // what the repair and the refuelling took (tripUndo gives back exactly that)
  const stashed = []; // [survivor, armor] left at the hub for this trip
  const off = () => {
    if (cand) tripUndo(h, cand, took);
    for (const [s, a] of stashed) { const i = h.armory.indexOf(a); if (i >= 0 && !s.gear.armor) { h.armory.splice(i, 1); s.gear.armor = a; } }
    stashed.length = 0;
    return null;
  };
  const n = ids.length;
  if (cand && (dist >= 3 || (c.wood && dist >= 1)) && c.mission !== "outpost" && c.mission !== "occupy" && c.mission !== "rescue" && c.mission !== "sweep") { // a survey goes on foot or bikes (a car sees little off the road)
    tripRepair(state, h, cand, took);
    const vEst = cand.condition >= 30 && estimateTrip(state, { memberIds: ids, dest: c.tile, vehicle: true, v: cand, stance: P.stance, homeBaseId: h.id, supplies: roughSupplies(n, 2) });
    if (vEst && vEst.fuel <= cand.fuel + Math.max(0, (h.stock.fuel || 0) - 4 - tripFuelHold(state, h, c))) v = cand; // needs-gauges: not the heating fuel, nor the campaign's fires
  }
  if (v) { const f0 = v.fuel; refuelKeeping(state, h, v, tripFuelHold(state, h, c)); took.fuel += v.fuel - f0; } // needs-gauges: the winter's heating fuel stays home (and the campaign's fires')
  // No car: bikes, one each, for anything past the next couple of tiles (no fuel, faster on roads, racks for the haul).
  if (!v && dist >= 2 && c.mission !== "outpost" && c.mission !== "occupy" && c.mission !== "rescue" && bikesAtBase(state, h.id) >= n) {
    const stack = parkBikes(state, h);
    if (stack && stack.condition >= 25) v = stack;
  }
  const plannedV = isBike(v) ? { ...v, count: n } : v;
  let onSite = c.onSite != null ? c.onSite : c.mission === "scavenge" ? P.searchHours + 4 + (P.reserves ? 2 : 0) : c.mission === "outpost" ? 0 : c.mission === "occupy" ? 2 : c.mission === "recon" ? P.searchHours + 8 : 4;
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
  // and brought home half the haul it was sent for (fix-wood-diplo: 3–7 wood from trips planned at ~12–14).
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
  const stock = (k) => Math.floor(k === "water" ? waterIn(h.stock) : k === "food" ? edibleFood(h) : k === "ammo" ? baseAmmo(state, h) : h.stock[k] || 0);
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
    const settles = c.mission === "outpost" || c.mission === "occupy"; // the team lives there after: a few days' stores
    sup.food = Math.ceil(r * 1.25) + 1 + (settles ? 6 : 0);
    sup.water = Math.ceil(r * 1.25 * thirstAhead(state, (est.hours + onSite) / 24)) + 1 + (settles ? 4 : 0); // summer, heat waves (weather.js)
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
  // sup.food: days of food, packed as the items that keep and weigh least (parties.js launchExpedition, foods.js packPick).
  // Too heavy: less ammo, then drop the extras down to what the job needs (an outpost needs 15 scrap).
  const cap = carryCapacity(state, crew, plannedV);
  if (supplyLoad(sup) > cap) sup.ammo = Math.min(sup.ammo, 5 * n);
  // Not Overloaded unless it has to be: on foot, less ammo before anyone leaves Overloaded.
  if (!v && worstBand(estimateTrip(state, tripOpts(sup))) >= 3) sup.ammo = Math.min(sup.ammo, 5 * n);
  for (const [k, q] of Object.entries(c.supplies || {})) {
    const over = supplyLoad(sup) - cap;
    if (over > 0) sup[k] = Math.max((c.min && c.min[k]) || 0, sup[k] - Math.ceil(over / supWeight(k)));
  }
  if (supplyLoad(sup) > cap) return off();
  for (const [k, q] of Object.entries(c.min || {})) if ((sup[k] || 0) < q) return off();
  const kit = packTripKit(state, h, crew, c.mission, c.tile); // kit.js: camp kit against Heat, a comfort, throwables (a drill for gun safes)
  // A tube of purification tablets (worm.js packTablets) for a water haul or a trip of more than TABS_TRIP_DAYS: river
  // water fetched or un-purified water packed is drunk safe on the way without stopping to boil it.
  const tabs = armoryTabs(h).length > 0 && ((c.steps || []).some((x) => x.kind === "water") || days > TABS_TRIP_DAYS);
  const res = launchExpedition(state, { memberIds: ids, fromBaseId: h.id, dest: c.tile, mission: c.mission, stance: P.stance, vehicleId: v ? v.id : null, supplies: sup, sweep: c.sweep, tabs, spares: true, // vehicles.js carSpares: a car part or two for a long drive
    plan: steps ? { preset: c.preset || "custom", steps: steps.map((x) => ({ ...x })), conditions: {} } : undefined }); // hunting and fishing trips: their steps (plans.js)
  if (res.error) return off();
  if (kit.length) say(state, `Kit for the trip: ${kit.join(", ")}.`);
  if (c.wood) { // woodcutting.js: the armory's axes go along for those without one
    const without = crew.filter((x) => !bestChop(x).item).length;
    for (let i = 0; i < without; i++) { const j = (h.armory || []).findIndex(isChopTool); if (j < 0) break; res.party.cargo.gear.push(h.armory.splice(j, 1)[0]); }
  }
  if (!isCar(v) && cand) tripUndo(h, cand, took); // repaired or looked at, but the car stayed
  res.party.ap = { mission: c.mission, tile: c.tile, day: day(state) };
  if (c.food === "huntTrips" && c.est > 0) res.party.ap.huntEst = c.est; // huntTripYield: what it brings back against this
  if (c.survey) surveySent(state);
  if (c.poiSurvey) poiSurveySent(state); // survey.js: the next POI survey waits its days
  if (haulBand != null) res.party.haulCap = Math.max(poolAtBand(crew, haulBand), supplyLoad(sup) + 6 * n);
  if (isCar(v)) res.party.apFuelHome = Math.ceil((est.fuel / 2) * 1.2); // hiveChoice: fires never burn the fuel for the drive home
  if (c.crawlTrip) res.party.apCrawlTrip = true; // the campaign's crawl trip (hiveChoice: in, as deep as it can)
  if (c.emergency) res.party.apEmergency = true; // emergencyTrips: outside the style's team limit
  if (c.claim) res.party.apClaim = true; // claimCandidate: claims the tile on arrival (teamAct)
  if (c.well) res.party.apWell = true; // wellCandidate: digs a well on arrival (teamAct)
  if (c.haul || c.emergency) res.party.apHaulWatch = true; // trackHauls: what it brings home, for the Water / Food line
  if (c.mission === "hive") { g.stats.hiveTrips = (g.stats.hiveTrips || 0) + 1; if (g.campaign && g.campaign.tile === c.tile) g.campaign.trips++; if (c.crawlTrip) g.stats.crawlTrips = (g.stats.crawlTrips || 0) + 1; else g.stats.stormTrips = (g.stats.stormTrips || 0) + 1; }
  if (c.mission === "assault") g.stats.assaultTrips = (g.stats.assaultTrips || 0) + 1;
  if (c.food) { g.stats[c.food] = (g.stats[c.food] || 0) + 1; res.party.apFood = c.food; } // huntTrips, fishTrips, woodTrips (hubFoodRun reads it)
  g.stats.launched++;
  if (c.mission === "outpost") g.stats.outposts++;
  if (c.mission === "occupy") g.stats.occupyTrips = (g.stats.occupyTrips || 0) + 1;
  say(state, `Sent ${names(crew)} (${c.food === "huntTrips" ? "hunt" : c.food === "fishTrips" ? "fish" : c.food === "woodTrips" ? "cut wood" : c.mission === "scavenge" ? "scavenge" : c.mission}) to ${tileLabel(state, c.tile)}${isBike(v) ? " on bikes" : v ? ` in the ${v.name}` : " on foot"}: ${c.why}. Back in about ${Math.ceil(days)} day${Math.ceil(days) === 1 ? "" : "s"}.${stashed.length ? ` Heavy armor left home for the walk: ${stashed.map(([x, a]) => `${first(x)}'s ${a.name}`).join(", ")}.` : ""}`);
  return res.party;
}

// The hub's food run (ap-food 2026-10-12, user request "make them want to farm and get food more"): every morning,
// when the food is short by foodTripCands' own reckoning (the winter stores short, the food under its target, or
// autumn's stocking up) and no hunting or fishing team from the hub is out, the best hunting or fishing trip goes,
// outside the style's trip cadence and team limit (planTrip: a Turtle sends one team every five days, and its few
// trips went scavenging: seed 6005 hunted for the first time on day 82, eleven days into the winter its stores fell
// short for, when a day's hunt by two brought in 26-27 days of food). FOOD_RUN.keepFrac of the hub stays home at most (the style's share if
// smaller; at least two, one at hardcore's small first hub); not in severe weather, with raiders or a horde on the
// way, nor for a careful style while a horde in sight would break in.
// rawDays / rack (foodTripCands, buildWishes): raw game and fish keep days (foods.js shelf; eating.js eats them last
// where nothing cooks), so no hunting or fishing trip goes while the store holds more of them than everyone fed here
// eats in rawDays, plus `rack` days of food for each drying rack (storage.js: it dries 4 a day of the fresh surplus);
// and the rack is wished for once that much lies in store (seed 6006, hardcore Cautious: 856 days of food spoiled
// against 608 eaten in 200 days, most of it raw game and fish from hunts on top of hunts).
export const FOOD_RUN = { keepFrac: 0.5, rawDays: 3, rack: 8 };
const rawFoodIn = (st) => Object.keys(st || {}).reduce((a, k) => a + (FOODS[k] && FOODS[k].raw && st[k] > 0 ? unitsOf(k, st[k]) : 0), 0);
const rawGlut = (state, base) => rawFoodIn(base.stock) > Math.max(1, mouthsAt(state, base).heads) * FOOD_RUN.rawDays + count(base, "smoker") * FOOD_RUN.rack;
function hubFoodRun(state) {
  const h = hub(state);
  if (!h || gov(state).noHunting) return null;
  if (state.parties.some((p) => p.owner === "player" && (p.apFood === "huntTrips" || p.apFood === "fishTrips") && (p.homeBaseId ?? h.id) === h.id)) return null;
  if (wxNow(state).severe || threatAt(state, h).urgent) return null;
  const P = persona(state);
  const hz = P.reserves ? hordeThreat(state, h) : null;
  if (hz && hz.size && !holdCheck(state, h, hz.size, hz.bosses, hz.mix).holds) return null;
  const home = atBase(state, h.id);
  const small = smallHub(state, home);
  const keep = Math.max(small ? 1 : 2, Math.ceil(home.length * (small ? 0.25 : Math.min(P.homeFrac, FOOD_RUN.keepFrac))));
  const pool = home.filter((s) => s.health >= P.minHealth - 10 && !s.woundInfected && !s.inBed && !s.pinned && s.mood >= 20 && (!s.leader || small) && tripFit(state, s));
  const spare = Math.min(pool.length, home.length - keep);
  if (spare < 1) return null;
  const cands = foodTripCands(state, h, pool, needs(state, h), P).sort((a, b) => b.score - a.score);
  for (const c of cands.slice(0, 4)) {
    const party = launchTrip(state, c, pool, spare);
    if (!party) continue;
    party.apFoodRun = true;
    gov(state).stats.foodRuns = (gov(state).stats.foodRuns || 0) + 1;
    return party;
  }
  return null;
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
  if (gov(state).noHunting || rawGlut(state, h)) return []; // FOOD_RUN.rawDays: the game in store would rot first
  const n = Math.max(1, atBase(state, h.id).length);
  const foodDays = edibleFood(h) / n;
  const season = wxSeason(state).key;
  const short = winterShort(state, h) > 0;
  if (!(short || need.food >= 1.4 || (season === "autumn" && foodDays < foodTarget(state, h) * 1.3))) return [];
  const boost = short ? 1.4 : season === "autumn" ? 1.15 : 1;
  const size = Math.min(3, Math.max(2, P.crew));
  const ammo = Math.max(0, baseAmmo(state, h) - 20);
  const out = [];
  const hunters = [...pool].sort((a, b) => huntFit(b) - huntFit(a) || a.id - b.id).slice(0, size);
  const arrows = huntArrowsFor(state, h, hunters); // the bows' arrows go along (plans.js applyPlan)
  if (hunters.some((s) => bestHuntWeapon(s, ammo, arrows))) {
    const wire = (h.armory || []).some((it) => it && it.key === "snarewire");
    const snareKit = wire || (h.stock.scrap || 0) >= 25;
    const yieldShare = huntTripYield(state); // the recent trips' catch against their estimates
    for (const x of huntTargets(state, h.tile, P.range, hunters, { ammo, arrows, mix: huntMixOf(h), hours: HUNT.defHours, limit: 8 }).filter((x) => walkable(state, h.tile, x)).slice(0, 3)) {
      const est = x.est.rations * yieldShare;
      if (est < 8) continue;
      const line = snareLine(state, x.tile);
      const snare = line ? state.hour - (line.check ?? line.set) >= 48 : snareKit;
      out.push({ mission: "move", tile: x.tile, crew: size, fit: huntFit, haul: true, food: "huntTrips", onSite: HUNT.defHours + (snare ? 2 : 0),
        steps: [...(snare ? [{ kind: "snare" }] : []), { kind: "hunt", hours: HUNT.defHours }, { kind: "home" }],
        supplies: snare && !line && !wire ? { scrap: 2 } : undefined,
        score: (need.food * Math.min(3, est / 12) * boost) / (1 + x.dist / 6), est: x.est.rations,
        why: `hunt for food${short ? " (the winter stores fall short)" : season === "autumn" ? " (stocking up in autumn)" : ""}: ~${Math.round(est)} expected${yieldShare < 1 ? ` (the recent hunts brought ${Math.round(yieldShare * 100)}% of their estimates)` : ""}` });
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
// the Fetch water step), a hunt or fishing trip or the nearest known food site; and with the beds lost and no scrap to
// put them back (bedsLost), two people to a known site with scrap (scrapSiteCands). Up to EMERGENCY.teams such teams
// out at once, people of EMERGENCY.minHealth, and HIVE_KEEP stay home at least. The team takes what food and water
// there is for the walk (launchTrip: the hub cannot "spare" it, but the haul brings back many times that).
const EMERGENCY = { waterDays: 1, foodDays: 2, teams: 2, hour: PLAN_HOUR + 8, minHealth: 50, bedsOver: 3 };
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
  const bedShort = !waterShort && !foodShort && bedsLost(state, h);
  if (!waterShort && !foodShort && !bedShort) return "";
  if (state.parties.filter((p) => p.owner === "player" && p.apEmergency && (p.homeBaseId ?? h.id) === h.id).length >= EMERGENCY.teams) return "";
  const g = gov(state);
  const pool = home.filter((s) => s.health >= EMERGENCY.minHealth && !s.woundInfected && !s.inBed && !s.pinned && !keep.has(s.id) && (!s.leader || home.length >= 6) && tripFit(state, s));
  const spare = Math.min(pool.length, home.length - HIVE_KEEP);
  if (spare < 2) return "";
  const need = needs(state, h);
  const cands = [];
  if (waterShort) cands.push(...waterTripCands(state, h, pool, need, P, { maxTeams: EMERGENCY.teams + 2 }).map((c) => ({ ...c, score: c.score + 10 })));
  if (foodShort) {
    cands.push(...foodTripCands(state, h, pool, need, P).map((c) => ({ ...c, score: c.score + 5 })));
    cands.push(...foodSiteCands(state, h, need, P));
  }
  if (bedShort) cands.push(...scrapSiteCands(state, h, need, P));
  cands.sort((a, b) => b.score - a.score);
  for (const c of cands.slice(0, 6)) {
    const res = launchTrip(state, { ...c, from: h, emergency: true, reach: Math.max(c.reach || 1, 1.5) }, pool, spare);
    if (!res) continue;
    g.stats.emergencyTrips = (g.stats.emergencyTrips || 0) + 1;
    const teams = state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy").length;
    if (bedShort) return `Emergency: ${h.name} has ${residents(state, h.id).length} people for ${baseBeds(h)} beds and no scrap to build more: ${names(partyMembers(state, res))} went out for scrap whatever the style's team limit (${teams} team${teams === 1 ? "" : "s"} out now).`;
    return `Emergency: ${h.name} has ${waterShort ? `${wDays.toFixed(1)} day${wDays === 1 ? "" : "s"} of water` : `${fDays.toFixed(1)} days of food`}: ${names(partyMembers(state, res))} went out for ${waterShort ? "water" : "food"} whatever the style's team limit (${teams} team${teams === 1 ? "" : "s"} out now).`;
  }
  return "";
}
// Beds lost and no scrap to put them back (a fire in the bunkhouse, a raid): EMERGENCY.bedsOver or more people over the
// beds (built and queued) and the next housing not paid for. Crowding takes 2–16 mood a day (morale.js): people walk
// away within a week or two (2026-10-09: a Turtle hub of 9 in 4 beds after its bunkhouse burned lost 5 to desertion
// in two weeks, scrap 0 for 100 days after).
function bedsLost(state, h) {
  if (residents(state, h.id).length - baseBeds(h) - queuedBeds(h) < EMERGENCY.bedsOver) return false;
  const next = nextHousing(state, h);
  return !!next && (h.stock.scrap || 0) < (wishCost(next, h).scrap || 0);
}
// Known sites near home with scrap in them (siteScore with scrap wanted hard), for an emergency scrap trip: two go.
function scrapSiteCands(state, h, need, P) {
  const want = { ...need, scrap: 3 };
  const out = [];
  for (const id of state.grid.within(h.tile, P.range + 4)) {
    const t = state.tiles[id];
    if (!t.loc || id === h.tile || !siteKnown(state, id) || (LOCATIONS[t.loc.type].loot.scrap || 0) < 1) continue;
    if (state.parties.some((p) => p.owner === "player" && p.dest === id)) continue;
    const sc = siteScore(state, id, want, P);
    if (!sc || sc.value <= 0.05 || sc.risk > 0.8) continue;
    out.push({ mission: "scavenge", tile: id, crew: 2, squadMin: 2, score: (sc.value * 4) / (1 + state.grid.distance(id, h.tile) / 6), why: "scrap for beds", loot: sc.loot });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 4);
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
// The hunting trips' catch against the haul they were sent for (ap-food, 2026-10-11): the trip planner's estimate
// (hunting.js expectHunt) is the average of a lottery (a deer or nothing), and the census's winter hunts brought in
// 4-10 against ~25 (seed 5021 at f77236e: 34 trips, about 13 a trip against ~20). foodTripCands counts a trip at the
// recent trips' share of their estimates (HUNT_TRIPS: the last `days` days, from `min` trips; never under `floor` of it).
// g.huntTrips: [day, got, est] a trip, when its hunt is done (hunting.js huntSummary: p.lastHaul).
const HUNT_TRIPS = { days: 40, min: 3, floor: 0.25 };
function trackHuntTrips(state) {
  const g = gov(state);
  for (const p of state.parties) {
    if (p.owner !== "player" || !p.ap || !(p.ap.huntEst > 0) || p.ap.huntSeen || !p.lastHaul || p.lastHaul.kind !== "hunt") continue;
    p.ap.huntSeen = true;
    (g.huntTrips || (g.huntTrips = [])).push([day(state), Math.round((p.lastHaul.rations || 0) * 10) / 10, Math.round(p.ap.huntEst * 10) / 10]);
  }
  if (g.huntTrips) g.huntTrips = g.huntTrips.filter((x) => day(state) - x[0] < HUNT_TRIPS.days);
}
function huntTripYield(state) {
  const rec = (gov(state).huntTrips || []).filter((x) => day(state) - x[0] < HUNT_TRIPS.days);
  const got = rec.reduce((a, x) => a + x[1], 0), est = rec.reduce((a, x) => a + x[2], 0);
  return rec.length >= HUNT_TRIPS.min && est > 0 ? Math.max(HUNT_TRIPS.floor, Math.min(1, got / est)) : 1;
}
function trackHauls(state) {
  const g = gov(state);
  const w = g.hauls || (g.hauls = {});
  const seen = new Set();
  for (const p of state.parties) {
    if (p.owner !== "player" || !p.apHaulWatch) continue;
    seen.add(String(p.id));
    const cs = (p.cargo && p.cargo.supplies) || {};
    w[p.id] = { water: Math.floor(waterIn(cs)), food: Math.floor(foodIn(cs)) };
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
// stations (one, two at 6+ people), and under FORAGE_AP.low days (or the food planner's target, if higher) the hands
// left over forage instead of picking through the ruins (as many as the food gap wants: foraging.js forageWorkCap),
// while a forager would bring in at least FORAGE_AP.minDay a day (not in winter).
// gov.noForaging: the test switch (foragetest.js) that leaves foraging out of the governor's plans.
const FORAGE_AP = { low: 12, critical: 4, minDay: 0.5 };
// The land's hunters and fishers ahead of the farm (planRoles 2b): at most this share of the people (at least one).
// bareHead: a base without a hunting cabin keeps at most one hunter per this many people (planRoles, ap-food).
// spareYield: the hands the farm does not need hunt unless the recent hunts brought in under this share of their estimates.
// smallFrom: from this many people a base without a cabin keeps one hunter (below bareHead).
const LAND_AP = { share: 0.2, bareHead: 8, smallFrom: 4, spareYield: 0.25 };
function planForage(state, base, people, foodDays, areas) {
  // Days of food for everyone fed here (upkeep.js: prisoners, guests, a holding convoy's crew too).
  foodDays = Math.min(foodDays, edibleFood(base) / Math.max(1, foodUse(state, base).total));
  // The goal: FORAGE_AP.low days, or the food planner's target when it is higher (ap-food 2026-10-12: the hands left over
  // after the farm, the hunters and the stations picked through the ruins with the food under its target and the
  // winter short; they forage now while the land gives a forager FORAGE_AP.minDay a day).
  const goal = Math.max(FORAGE_AP.low, foodTarget(state, base));
  if (!areas.food || gov(state).noForaging || foodDays >= goal || forageWorkWhy(state, base)) return null;
  if (baseForageDay(state, base) < FORAGE_AP.minDay) return null;
  const small = people.length <= 4; // a tiny hub (hardcore's first): the leader picks berries too
  return {
    cap: forageWorkCap(state, base, goal), // tune-jobcaps: sized to the need (the food gap to the goal), no fixed cap (it was 3, 4 at 12+)
    critical: foodDays < FORAGE_AP.critical ? (people.length >= 6 ? 2 : 1) : 0,
    fit: (x) => !x.inBed && (small || !x.leader) && (x.health ?? 100) >= 40 && !x.woundInfected,
  };
}
// ---------- wood for the winter (woodcutting.js) ----------
// From late summer (woodSeason) a base whose woodpile is short of what the coming cold needs (woodNeed: everyone fed
// there and the teams coming home, woodFor(HEAT.fuel) a head a freezing day, a fifth to spare, and the boiler's days) works out how many woodcutters it
// takes to have it in by the winter (the shortfall over what one brings in a day here × the days left, at least
// WOOD_AP.minDays): from autumn (the winter within WOOD_AP.autumn days, or here) that many go before the builders and
// stations (step 4a; at most the job's cap and a quarter of the people, one at a base of 3 or fewer), in late summer
// one; and the spare hands cut wood too (step 10, up to the cap) until it is stocked. Only where the land around gives
// a woodcutter at least WOOD.worth a day; the best woodcutters with axes first. gov.noWood: the test switch
// (woodtest.js, the balance runs) that leaves it out.
export const WOOD_AP = { autumn: 28, minDays: 5, behind: 0.5, foodFirst: 10 };
// tune-jobcaps: the Cut wood job has no fixed cap (it was 2, 3 at 10+ people). The woodcutters it takes to have the pile
// in by the cold (and keep up with the boiler) go ahead of the builders and stations up to a quarter of the people
// (woodCrewMax: the governor's order of work; a third while the pile is under WOOD_AP.behind of what the cold needs:
// the quarter was set when a freezing day took 0.6 kg of wood a head, before tune-winter (HEAT.wood) made it
// 2.5 times that and the boiler burned wood daily, and a big hub on farmland then met the winter with its pile a
// third in: woodtest seed 42, 400 kg of 1,060); the spare hands cut toward having it in within three weeks
// (woodcutting.js woodHandsWanted), each one past the first a little less (woodCrowd).
const woodCuttersFor = (state, base, w) => woodHandsWanted(state, base, { w, days: Math.max(WOOD_AP.minDays, w.toCold) });
// A Kitchen's stove (kitchen.js) burns wood every day of the stocking season too: one woodcutter more may go ahead
// (kitchen-plus; woodtest seed 42 met the winter at 28% of the cold's need with a kitchen burning 20 a day, 43% without).
const woodCrewMax = (n, w = null) => (n <= 3 ? 1 : Math.ceil(n / (w && w.have < w.need * WOOD_AP.behind ? 3 : 4)) + (w && w.kitchen > 0 ? 1 : 0));
const crewDays = (k) => Array.from({ length: Math.max(0, k) }, (_, i) => woodCrowd(i)).reduce((a, v) => a + v, 0); // k woodcutters' day in woodcutters (woodCrowd)
// The woodcutters that go ahead of the builders and stations (planWood's critical, work.js's emergency): from autumn
// (the cold within WOOD_AP.autumn days, or here, or the boiler burning wood) the crew it takes to have the pile in by
// the cold, at most woodCrewMax; in late summer what the summer must cut so that the autumn's full crew can finish it
// (at least one, at most that crew; it was one, whatever the need). n: the people here.
// Out of the stocking season with no boiler, the daily draws (a kitchen under its days of wood, kitchen.js
// KITCHEN.wood.keepDays; a camp's fire and the nights' fires under theirs, woodcutting.js woodNeed: fire-nights) want
// only the hands to keep them going and fill those days within a week (dailyWoodHands), not the winter's.
// A medium priority, behind the food and the water (fire-nights, the user's rule): out of season the crew is at most
// half the stocking season's (dailyCrewMax: one at a base of 3 or fewer, 3 of 20), fills the days over WOOD.nightDays,
// and is one woodcutter while food is short (planWood lean: under WOOD_AP.foodFirst days a head), the fires taking what
// the pile holds (a cool night without it costs HEAT.night of a freezing day's: needs.js heatDaily).
const dailyOnly = (w) => !w.season && !(w.boiler > 0) && w.pressing && w.daily > 0;
const dailyCrewMax = (n, w) => (n <= 3 ? 1 : Math.max(1, Math.ceil(woodCrewMax(n, w) / 2)));
const dailyWoodHands = (state, base, w) => Math.max(1, handsForDay(w.daily + Math.max(0, w.dailyKeep - w.have) / WOOD.nightDays, baseWoodDay(state, base), woodCrowd));
export function woodCritical(state, base, w, n, foodDays = null) {
  if (dailyOnly(w)) {
    // Food first: with the food under its target (farmCrewLimits hungry, the farm's own rule) a woodcutter goes ahead of
    // the farm only with under two days of the fires in the pile (worktest 2b: the farm's extra hands were pulled to
    // the nights' wood; foragetest: a hardcore camp of three sent one to the woods while its forager was its food).
    const fd = foodDays ?? edibleFood(base) / Math.max(1, mouthsAt(state, base).heads);
    if (farmCrewLimits(state, base, fd, n).hungry) return w.have < w.daily * 2 ? 1 : 0;
    return Math.min(dailyCrewMax(n, w), dailyWoodHands(state, base, w));
  }
  const want = woodCuttersFor(state, base, w);
  if (n <= 3) return Math.min(1, want);
  const full = Math.min(want, woodCrewMax(n, w));
  if (w.cold || w.toCold <= WOOD_AP.autumn || w.boiler > 0 || w.fire > 0 || w.night > 0) return full; // the boiler, a camp's fire and the nights' fires burn wood every day
  const each = baseWoodDay(state, base);
  // What the autumn's crew will not cut, and what the Kitchen's stove (kitchen.js) burns every day until the cold.
  const left = Math.max(0, w.need - w.have + (w.kitchen || 0) * w.toCold - each * crewDays(full) * WOOD_AP.autumn);
  return Math.min(full, Math.max(1, handsForDay(left / Math.max(1, w.toCold - WOOD_AP.autumn), each, woodCrowd)));
}
function planWood(state, base, people, areas, foodDays = Infinity) {
  // A shelter (tier 0) too (ap-food 2026-10-12): its fire is its only cooking (worm.js baseCooks) and burns wood
  // from its store (woodcutting.js shelterFire, woodNeed's fire days); with none cut it was out most days, the raw game
  // and fish were eaten last (eating.js) and rotted (seed 6011, hardcore Turtle: 133 days of food thrown out against 337
  // eaten before it starved on day 139, most of it snared fowl and venison, while the shelter was on short rations).
  if (!areas.production || gov(state).noWood || woodWorkWhy(state, base)) return null;
  const w = woodNeed(state, base, base.type === "hub" ? returning(state, base) : 0);
  if (!w.short || !w.soon || w.need <= 0) return null;
  const cap = dailyOnly(w) ? woodCritical(state, base, w, people.length) : woodHandsWanted(state, base, { w }); // the spare hands' crew: the pile in within three weeks (only the daily draws' days out of season)
  // The water boiler (worm.js) burns its wood every day: enough woodcutters to keep up with it, on top of the winter's.
  const want = woodCuttersFor(state, base, w);
  const small = people.length <= 3; // a tiny hub (hardcore's first): the leader cuts wood too
  // Food under its target out of season (fire-nights, woodCritical): the hands feed the base; one woodcutter at most.
  const lean = dailyOnly(w) && farmCrewLimits(state, base, foodDays, people.length).hungry;
  return {
    cap: lean ? Math.min(1, cap) : cap,
    w,
    critical: Math.min(want, woodCritical(state, base, w, people.length, foodDays)),
    stock: true,
    fit: (x) => !x.inBed && (small || !x.leader) && (x.health ?? 100) >= 50 && !x.woundInfected,
    score: (x) => woodcutterMult(x) * bestChop(x).mult,
  };
}
// Woodcutting trips (planTrip) when the hub's woodpile is short and the cold is within a month (or here) and the
// land around the hub gives little (a woodcutter there under 75 a day): the best wood land within range that a team
// of 2–3 with the hub's axes would bring the most from in 8 hours (by a car when there is one: wood is bulky),
// scored by the share of the shortfall it covers. The trip takes the armory's cutting tools along.
// When the Cut wood job's crew (woodCrewMax × a woodcutter's day here × the days to the cold) cannot have the
// pile in by the winter (a big hub on farmland: three cutters bring in 60 a day against 3,000+ wanted), the trips are
// the only way to stock it, and by the share alone every trip scored under routine scavenging (0.3 against 0.8) and
// none was ever sent: then the score rises with the share of the shortfall the job will leave (WOOD_TRIP.gapScore
// at most, as a cache or a trade), and they start as soon as the stocking season does.
// crunch (2026-10-12): within WOOD_AP.autumn days of the cold with half or more of the shortfall beyond what the
// woodcutters here will cut, the trip is worth crunch × that share wherever it goes (no discount for the distance):
// a hub grown to a dozen on farmland (woodtest seed 42 with 8 crop plots) always had site visits and trades at 1.8–2.8
// against its wood trips' 1.2, sent none, and met the winter at 30% of the cold's need.
export const WOOD_TRIP = { gapScore: 1.8, gapFloor: 1.0, crunch: 2.8, crunchGap: 0.5 };
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
      score: Math.max(Math.max((1.2 + (w.cold ? 0.6 : 0)) * Math.min(1.5, e.all / shortfall * 2), gap > 0 ? WOOD_TRIP.gapFloor + (WOOD_TRIP.gapScore - WOOD_TRIP.gapFloor) * gap + (w.cold ? 0.6 : 0) : 0) / (1 + dist / 6),
        w.toCold <= WOOD_AP.autumn && gap >= WOOD_TRIP.crunchGap ? WOOD_TRIP.crunch * gap - dist * 0.01 : 0), // the crunch (the nearest first among equals)
      why: `wood for the winter (${Math.floor(w.have)} of ${w.need}${gap > 0 ? ", more than the woodcutters here can cut by the cold" : ""}): ~${Math.round(e.all)} to cut` });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 2);
}

// A team short of food in the field: hunt, fish or forage on its tile or one close by (landFoodOptions: the haul of
// LAND.hours there, by food an hour with the walk), when the best promises LAND.min rations (a third more to be worth
// a walk). urgent (under a day or two of food): it looks two tiles out, else one. ok(rations, kind): the caller's own test.
// LAND.tries: food stops a team on its way home makes at most.
// urgentMin: with food down to a day or two any real gain will do: 1.5 × what the team eats meanwhile (at least 1.5).
// critical: days of food under which the road team (no base) goes for food from the land before the camp's
// business (Establish base).
const LAND = { hours: 8, min: 4, urgentMin: 1.5, walkMore: 1.3, tries: 4, critical: 0.5 };
const foodDaysOf = (state, p) => {
  const n = partyMembers(state, p).length;
  return carried(p, "food") / (Math.max(1, n ? partyPace(state, p).eatMove : 1) * foodNeedFactor(state)); // days of food (foods.js); on the move: today's cold (weather.js)
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
  say(state, `${teamName(state, p)} is short of food: it goes to ${what} ${best.tile === here ? "here" : `${best.dist === 1 ? "a tile" : `${best.dist} tiles`} to the ${best.dir}`} (${best.terrain}, about ${Math.round(best.rations)} days of food in ${LAND.hours}h).`);
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
// summer reserve before it runs short, and kept above the floor of its summer store (waterPlan low).
function outpostThirsty(state, o) {
  const wo = waterOutlook(state, o);
  const staff = atBase(state, o.id).length;
  const wp = waterPlan(state, o);
  return (wo.net < 0.5 && (wo.daysLeft < 5 || waterIn(o.stock) < staff * 3)) || (staff > 0 && ((wp.near && wp.short && waterIn(o.stock) < wp.reserve * 0.6) || wp.low));
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
  const able = home.filter((s) => s.health >= (shelter ? 50 : 70) && (!s.leader || shelter) && !s.inBed && !s.woundInfected);
  const well = able.filter((s) => tripFit(state, s)); // the sick rest; a shelter with nobody else still sends one (thirst first)
  const crew = (well.length || !shelter ? well : able).sort((a, b) => a.id - b.id).slice(0, Math.min(4, spare));
  if (crew.length < (shelter ? 1 : 2)) return;
  const ids = crew.map((s) => s.id);
  const steps = [{ kind: "water" }, { kind: "home" }];
  const est = estimatePlan(state, { memberIds: ids, dest: shore, vehicle: false, stance: "normal", mission: "move", steps });
  if (!est || !est.returns || est.total > WATER_RUN_HOURS * 2 + 6) return;
  // Rations: fresh food first, preserved for the rest (storage.js).
  const eat = est.food + 1;
  const sup = { food: eat, water: est.water + 1 }; // food: days of it (packed as what keeps: parties.js)
  const archers = archerCount(crew); // the bows' arrows go along, as on every other trip (a dozen each, what the hub has)
  if (archers) sup.arrows = Math.min(Math.max(0, h.stock.arrows || 0), archers * ARROWS.PACK);
  if (edibleFood(h) < eat + home.length * 2 || waterIn(h.stock) < sup.water) return;
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
    const runner = home.filter((x) => x.health >= 70 && !x.leader && !x.inBed && !x.woundInfected && !x.worm && tripFit(state, x)).sort((a, b) => combatPower(b) - combatPower(a))[0];
    if (!runner) continue;
    const left = Math.min(...waiting.map((s) => wormHoursLeft(state, wormOf(s)))) - WORM_CURE_MARGIN;
    const plan = planSupplyRun(state, { originId: h.id, destId: base.id, crewIds: [runner.id], deliver: { meds }, atDest: "return", stance: "normal" });
    if (plan.error || plan.hoursOut > left || !roadFed(h, plan)) continue;
    wormRun(state, { originId: h.id, destId: base.id, crew: [runner.id], deliver: [{ key: "meds", qty: meds }], atDest: "return" },
      `${meds} meds to ${base.name} for the worm (${names(waiting)}: nothing there can cure it, and the walk is too far or cannot be made)`);
  }
}
// The food and water for the way out are there (supply.js dispatchSupplyRun would refuse the run).
const roadFed = (base, plan) => foodIn(base.stock) >= plan.need && waterIn(base.stock) >= plan.needWater;
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
    const crewPool = home.filter((s) => s.health >= 70 && !s.leader && !s.inBed && !s.woundInfected && !keep.has(s.id) && tripFit(state, s)).sort((a, b) => combatPower(b) - combatPower(a));
    const staff = atBase(state, o.id).length;
    let form = null, why = "";
    const fix = staff ? waterRepairLoad(state, h, o) : null; // scrap and parts for its broken well or pump
    const camp = staff ? campShort(o, h) : null; // an outpost camp's materials (buildings.js outpost_up): they ride along with its water
    if (moves && staff < 2 && !o.captured && home.length >= 7 && crewPool.length) { // a base taken from a group (conquest.js) is held by whoever took it
      const s = [...crewPool].sort((a, b) => skill(b, "farming") - skill(a, "farming"))[0];
      form = { crew: [s.id], deliver: [{ key: "food", qty: Math.min(6, payoutSpare(state, h, "food")) }, { key: "scrap", qty: Math.min(8, Math.max(0, Math.floor((h.stock.scrap || 0) - 30))) }].filter((l) => l.qty > 0), atDest: "disband" };
      why = `${first(s)} joins the outpost (only ${staff} there)`;
    } else if (staff && outpostThirsty(state, o) && Math.min(waterIn(h.stock) - home.length * 5, payoutSpare(state, h, "water")) >= 12 && crewPool.length) {
      // An outpost's spring gives 3 a day (less in a dry spell): water from the hub before anyone goes thirsty (never
      // out of the hub's own pay-out reserve, upkeep.js PAYOUT).
      const qty = Math.min(30, Math.floor(waterIn(h.stock) - home.length * 5), payoutSpare(state, h, "water"));
      const crew = [];
      const along = [...(fix || []), ...(camp || [])];
      const fixKg = along.reduce((a, l) => a + l.qty * supWeight(l.key), 0); // the repair's scrap and parts (and a camp's) ride along
      for (const s of crewPool) if (carryCapacity(state, crew, null) < qty * SUPPLIES.water.weight + fixKg && crew.length < Math.min(spare, 2)) crew.push(s);
      const load = Math.min(qty, Math.floor((carryCapacity(state, crew, null) - fixKg) / SUPPLIES.water.weight));
      // Purified water first, the rest un-purified (water.js: the outpost purifies it like its own).
      const pure = Math.min(load, Math.floor(Math.max(0, h.stock.water || 0)));
      if (load >= 8) form = { crew: crew.map((s) => s.id), deliver: [...(pure > 0 ? [{ key: "water", qty: pure }] : []), ...(load - pure > 0 ? [{ key: RAW, qty: load - pure }] : []), ...along], atDest: "return" };
      why = `${load} water (it is running dry)${fix ? `, and ${linesText(fix)} to mend its water` : ""}${camp ? `, and ${linesText(camp)} to establish the camp` : ""}`;
    } else if (camp && crewPool.length) {
      // An outpost camp waiting for the materials of its step up (buildings.js outpost_up): what it lacks, from the hub.
      const deliver = camp;
      const load = deliver.reduce((a, l) => a + l.qty * supWeight(l.key), 0);
      const crew = [];
      for (const s of crewPool) if (carryCapacity(state, crew, null) < load && crew.length < Math.min(spare, 2)) crew.push(s);
      if (carryCapacity(state, crew, null) >= load) form = { crew: crew.map((s) => s.id), deliver, atDest: "return" };
      why = `${linesText(deliver)} to establish the camp`;
    } else if (fix && crewPool.length) {
      // Its well or pump is broken and waits for scrap or parts the outpost does not have (an outpost makes none):
      // without them it lives on the hub's water runs for good (census seed 3, aggressive: the old holdout's two wells
      // stood broken from day 303 with 0 scrap there and 101 at the hub, and 8 people went thirsty).
      form = { crew: [crewPool[0].id], deliver: fix, atDest: "return" };
      why = `${linesText(fix)} to mend its water (a broken well or pump waits for them)`;
    } else if (moves && !o.captured && movers(state, h, o, Math.min(spare, crewPool.length)) > 0) {
      // Not to a base taken from a group (conquest.js): held by whoever took it, often out in the wild (census seed 5005,
      // huge, aggressive: people moved one by one to nine taken bases died of hordes and the worm: 179 deaths against 85).
      // The hub has outgrown its plots (hubCramped): people move to an outpost with beds free, food for the walk and a
      // few days more with them; the outpost builds its beds, fields and stores ahead of them (buildWishes).
      const n = movers(state, h, o, Math.min(spare, crewPool.length));
      // Farmers first (an outpost has to feed itself); the hub's medics, builders and station hands last.
      const keepHome = (s) => (s.role === "medic" || s.role === "build" || s.role === "operate" ? 6 : 0);
      const crew = [...crewPool].sort((a, b) => skill(b, "farming") - keepHome(b) - (skill(a, "farming") - keepHome(a))).slice(0, n);
      const food = Math.min(HOUSING.moveFood * n, Math.max(0, Math.floor(foodIn(h.stock) - home.length * 5)), payoutSpare(state, h, "food"));
      form = { crew: crew.map((s) => s.id), deliver: food > 0 ? [{ key: "food", qty: food }] : [], atDest: "disband" };
      why = `${names(crew)} move${crew.length === 1 ? "s" : ""} there: ${h.name} has outgrown its building plots (${residents(state, h.id).length} people for ${baseBeds(h)} beds), ${o.name} has ${outpostBedsFree(state, o)} free`;
    } else {
      const wish = buildWishes(state, o).find((w) => { if (!BUILDINGS[w.type]) return false; const c = wishCheck(state, o, w); return !c.noPlot && !/^Limit reached/.test(c.reason || ""); }); // no plot free: no scrap run for it
      const scrap = wish ? wishCost(wish, o).scrap || 0 : 0;
      // A well needs a part too, a barracks two, a radio relay 3; one more when it is not saved for (planBuilds keeps 1 back then).
      const parts = wish && wishCost(wish).parts ? wishCost(wish).parts + (wish.save ? 0 : 1) : 0;
      const partsShort = parts > 0 && (o.stock.parts || 0) < parts && (h.stock.parts || 0) >= parts + 2;
      // Scrap short (the hub can spare it), or only the parts (an outpost seldom has 3 for a relay: it makes none).
      const scrapShort = (o.stock.scrap || 0) < scrap;
      if (wish && (scrapShort ? (h.stock.scrap || 0) >= scrap + 25 : partsShort) && home.length >= 5 && crewPool.length >= 1) {
        const deliver = scrapShort ? [{ key: "scrap", qty: scrap + 2 }] : [];
        if (partsShort) deliver.push({ key: "parts", qty: parts - Math.floor(o.stock.parts || 0) });
        if (foodIn(o.stock) < staff * 3 && payoutSpare(state, h, "food") >= 8) deliver.push({ key: "food", qty: 8 });
        // Enough hands to carry it (people stay home: at most a third of the hub goes).
        const load = deliver.reduce((a, l) => a + l.qty * supWeight(l.key), 0);
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

// What an outpost camp's step up still lacks past its own stores, as supply-run lines from what the hub has (its builds
// and crafts hold that much back for the camp: campHold), or null.
function campShort(o, h) {
  const job = tierUpJob(o);
  if (!job || !job.paid) return null;
  const out = [];
  for (const r of gatherRows(job)) {
    const want = Math.ceil(r.need - r.have - Math.floor(o.stock[r.key] || 0));
    const qty = Math.min(want, Math.floor(h.stock[r.key] || 0)); // what campHold kept back for it
    if (want > 0 && qty > 0) out.push({ key: r.key, qty });
  }
  return out.length ? out : null;
}

// Scrap and parts an outpost's broken well or pump waits for (breakdowns.js: a repair is 3 scrap and a part, a
// jury-rig 1 scrap), as supply-run lines, for what it lacks of a repair each and the hub can spare past its own water
// hold (waterPlan: the hub's own broken wells and filters first); null when nothing waits or the hub cannot spare it.
function waterRepairLoad(state, h, o) {
  const k = waterPlan(state, o).brokenWater;
  if (!k) return null;
  const scrap = Math.min(Math.max(0, 3 * k - Math.floor(o.stock.scrap || 0)), Math.floor((h.stock.scrap || 0) - waterHold(state, h, "scrap")));
  const parts = Math.min(Math.max(0, k - Math.floor(o.stock.parts || 0)), Math.floor((h.stock.parts || 0) - waterHold(state, h, "parts") - 1));
  const out = [...(scrap > 0 ? [{ key: "scrap", qty: scrap }] : []), ...(parts > 0 ? [{ key: "parts", qty: parts }] : [])];
  return out.length ? out : null;
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
  const fit = (s) => s.alive && !s.pinned && !s.inBed && !healthRest(s, state); // the ill rest (sickrest.js)
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
