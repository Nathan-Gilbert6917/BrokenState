// @ts-check
// Everything that travels across the State Map: your expeditions and convoys, AI raids and convoys.
// Travel drains supplies hour by hour and rolls events tile by tile. When a team finishes a job
// it waits for orders: act here, move anywhere, or go home.
/** @import { State, Survivor, Base, Party, Faction, Vehicle, Card, Horde, Item, Stock, Cargo, Order } from "./types" */
/**
 * travelHours' options: the way of travel and pace, where on the path it starts, the fuel there is, the hours to
 * step through and whether the weather counts.
 * @typedef {{ vehicle?: boolean | "bike", speed?: number, footSpeed?: number | null, fuelMult?: number, progress?: number,
 *   idx?: number, fuel?: number, offroad?: number, onroad?: number, walkers?: number, cartTer?: any, maxHours?: number, startHour?: number, weather?: boolean, known?: number, used?: number }} TravelOpts
 */
import { sendMembers } from "./members.js"; // an AI party is its people (docs/adr/0001-ai-parity.md)
import { kitParty } from "./loadouts.js"; // the launchers go with a raid
import { teamTraitFx, appetite } from "./traits.js"; // Keen Eye: the team's sight; Glutton: the food a trip takes
import { repairPaid, repairWaitHour } from "./repairwait.js"; // a breakdown repaired on the road: told when it is over
import { CARRIER } from "./hiveconst.js"; // a body's weight in the car (bodyLoad)
import { findPath } from "./hex.js";
import { roadblockOnEnter, rollRoadblock } from "./roadblocks.js";
import { partyEnter as fieldPartyEnter, teamEnter as fieldTeamEnter, fieldRaidArrive, teamActs as fieldActs } from "./fieldworks.js"; // field works: roadblocks, raids on them
import { TERRAIN, ROAD_COST, GEAR, SUPPLIES, supValue, supWeight, FACTION_TYPES } from "./data.js";
import { FOODS, foodIn, takeFood, moveFood, packPick, addFood, foodText, typedFood, addFoods, unitsOf, DAY_KG } from "./foods.js"; // food by type: packed with its lots, eaten the soonest to spoil first
import {
  newId, log, addCard, day, hub, baseById, survivorById, atBase, skill, combatPower, hurt,
  factionById, snapshot, mergeKnowledge, gearEffect, radioBasesInRange, isNight, archerCount, usesArrows, armedFactor, arrowsBack, ARROWS, localId,
} from "./world.js";
import {
  resolveRaidOnPlayer, resolveRaidOnFaction, raidWarning, maybeCallForHelp, deliverHelpCall, changeGoodwill,
  attitude, recomputeOwnership, siegePace, isAggressiveType,
} from "./factions.js";
import { rollTravelEvent, convoyLegEvent } from "./events.js";
import { startScavenge } from "./scavenge.js";
import { offerCrawl, crawlOffered } from "./citycrawl.js"; // a team moved onto a city asks whether to go in
import {
  vehicleById, partyVehicle, partyFuel, useFuel, wear, abandonVehicle, tank, createVehicle, travelMode, tileFuel, isBike, isCar,
  partyVehicles, partyVehicleIds, partyFleet, fleetOf, fleetProblem, setPartyVehicles, roadPace, MAX_VEHICLES,
  takeBikes, parkBikes, vehicleLabel, VEHICLE_TYPES, typeOffroad, isLoud, assignRaidHumvee, wreckCost, carPartsText, WRECK, stripYield, carSpares,
} from "./vehicles.js";
import { convoysHour, truckEngineNoise } from "./miltrucks.js";
import { fixableAt, runnerAt, fixOption, driveHomeOption, startFixCar, driveHome } from "./foundcars.js"; // vehicles found on a map: repair, drive home // Army trucks: the convoy event, a running Army truck's engine
import { teamLoad, burdenRecord, rationRate, personRation, wornLoad } from "./load.js";
import { packFood, packWater as personWater, aiPartyHeads, PACK } from "./eating.js"; // the packs everyone carries (wave 2 eating)
import { perceive, spot, mergeSpots, MARKER_TYPES, markAbandonedVehicle, markDeathSite, deathLabel } from "./markers.js";
import { rescueArrive, captivesOf, contactAttack } from "./conflicts.js";
import { handoverArrive } from "./ransom.js";
import { assaultArrive } from "./conquest.js";
import { occupyArrive, occupyProblem } from "./occupy.js"; // Occupy: move into an abandoned base
import { abandonedAt } from "./groupworld.js"; // a base standing empty on a tile (Occupy instead of Build outpost there)
import { BUILDINGS, CAMP } from "./buildings.js"; // a new outpost is a camp first, its step up queued (outpost_up)
import { hiveAt, hiveArrive, zombieToughness, BOSS_NAMES } from "./hives.js";
import { noteUnpack } from "./teaminv.js"; // home from a trip: what the people carry, put away or kept
import { bodiesHome } from "./carriers.js"; // bodies carried home in the car (bury or burn them at the base)
import { growthAt, growthArrive } from "./hivetech.js";
import { gatheringCull } from "./hivebirth.js"; // hive birth you can see: breaking up a gathering at a build site
import { mixWeight, mixText } from "./zombietypes.js";
import { hordeScore } from "./hordes.js";
import { supplyArrive, supplyReturned } from "./supply.js";
import { nightFalls } from "./nightmarch.js"; // night on the road: make camp or push through
import { taskHour, startTask, startOrder, continueQueue, resumeQueue, orderLabel, queueText, tasksDue } from "./orders.js";
import { applyPlan, fieldHour } from "./plans.js";
import { packSiegeKit } from "./kit.js";
import { siegeGearHome } from "./arsenal.js"; // a group's raid brings its ladders and ram home
import { packLights, unpackLights } from "./lights.js"; // a light each from the armory on the way out
import { crossingsFrom } from "./crossing.js";
import { carryBonus, itemLoad } from "./inventory.js";
import { cartSupOf, cartToArms, cartLotsIn } from "./carry.js"; // carts.js: the supplies in the carts (the weight), a cart fetched into someone's arms (call-time only)
import { isCart, cartWearStep, cartRouteWear } from "./carts.js";
import { openTrade, routeExchange } from "./trade.js";
import { caravanArrive, caravanHour, caravanStop } from "./caravans.js";
import { caravanGuarded } from "./jobs.js";
import { caravanOrderChoices, gangAmbush, wouldRaid } from "./caravanraids.js"; // any caravan on the road can be robbed
import { crashesHour, crashSurvey } from "./crashes.js";
import { breakdownsHour } from "./breakdowns.js";
import { travelFactor, travelEffects, travelHazard, thirstAt, thirstAhead, coldAt, riverFrozen, ICE } from "./weather.js";
import { thinIceStep } from "./rivers.js"; // frozen rivers: thin ice early and late in the freeze
import { hasPerk, checkBonus, gainXpAll, USE, hash01 } from "./skills.js";
import { tripDone } from "./relations.js";
import { totalRounds, spendAmmo, ROUND_KEYS, GENERIC_KEYS } from "./rounds.js"; // rounds by calibre ("ammo": any of them)
import { packRounds, addRecord, drawTeamShots, sortFind, suppliesText, findRounds, kindTheme, roundsText, settleParty } from "./ammo.js"; // a plan's "N ammo" packed as the rounds that fit
import { packLauncherRounds } from "./launchers.js"; // the rounds for the launchers the crew carries (section 13)
import { packMags, packShells } from "./carrykit.js"; // magazines as items (section 15): the spares go along; a shotgun's shells at hand
import { noteTripHome } from "./trips.js"; // order templates and repeat trips
import { prisonersHome } from "./prisoners.js";
import { scavArrived, scavSearchHour, ambushHaul, lose as loseScav } from "./aiscav.js";
import { gameSpoilHour, unloadGame } from "./hunting.js";
import { teamNeedsHour } from "./needs.js";
import { wormTeamHour, packWater, wormHome, packTablets } from "./worm.js";
import { siteKnown, siteNamed, noteLooked } from "./discovery.js";
import { lookoutsSpot, surpriseAt, watchSawText } from "./watch.js"; // the lookouts' warning; an unwatched night
import { startSweep, sweepOpts, sweeping, LOOK, quickLook } from "./survey.js";
import { poisOf } from "./pois.js"; // the tile's points of interest: a raid goes into one of them
import { scavengeProblem, pickedOverAt, poiPickWanted, poiPickCard } from "./poiraid.js"; // which POI to raid: the dialogue card, or the pick made for you
import { opticsFor } from "./optics.js";
import { withYou } from "./hardcore-start.js";
import { teamReceives, networksAt } from "./radio.js"; // a team's receiver: hears a network inside its coverage, cannot call (updateRadio)
import { establishOption, campOption, pitchArrive } from "./staging.js"; // camps: Set up camp, Establish base, Build outpost (a camp with its step up)
import { canClaim, CLAIM, claimsTaken, takeGroupClaims, claimsTakenText } from "./claims.js"; // the orders card: Claim this tile where the land borders yours; a new outpost takes the groups' claims round it
import { askBaseName } from "./basenames.js"; // the naming popup for a base you found
import { enterTarget, enterCard, enterOption, joinBase } from "./moveout.js"; // a team that ends a move on another of your bases: "Enter <base>?"
import { shedSurplusVehicles, reseat, afterVehicleLoss } from "./walkers.js"; // one person to each vehicle; walkers after a vehicle is lost
import { waterIn, drawWater, waterText, teamWaterIn, takeTeamWater, stockHas, takeStock, RAW, keyWord } from "./water.js"; // purified and un-purified water: packing takes purified first
import { partySaw } from "./groupworld.js"; // a group learns your bases its parties pass
import { lyingFor, INTEL } from "./intel.js"; // a gang that overheard a group's caravan waits for it
import { withLook, surveyErr, noteLook } from "./intelnotes.js"; // what a team sees of a group's base (the State Map's estimates, intelest.js)
import { KEY_KINDS, keyKg } from "./carry.js"; // a capped water or firewood task counts its own haul (call-time only: safe in the import cycle)
import { nomadCampAt, nomadCampArrive } from "./nomads.js"; // a nomad camp you spotted: attack it (call-time only)
import { unpackPerson } from "./supitems.js"; // supplies carried as items, unpacked at home (call-time only: safe in the import cycle)
import { fightSides, fightersOf, applySide } from "./groupfight.js"; // fights nobody watches: your rules
const AI_KIND = { raider: "raiders", expansionist: "fighters", zealot: "zealots", military: "soldiers", fortress: "soldiers", traders: "guards", commune: "militia" };

export const STANCES = {
  stealthy: { name: "Stealthy", speed: 0.75, events: 0.6, desc: "25% slower, 40% fewer events. Good for scouting dangerous ground." },
  normal:   { name: "Normal",   speed: 1.0,  events: 1.0, desc: "Standard pace and risk." },
  rushed:   { name: "Rushed",   speed: 1.3,  events: 1.4, desc: "30% faster, 40% more events. For when time matters more than safety." },
};

export const MISSIONS = {
  recon:       { name: "Recon",            desc: "Travel there and survey the area (extra-careful look for finds), then decide what to do next." },
  move:        { name: "Move here",        desc: "Travel there and wait for orders." },
  scavenge:    { name: "Scavenge / raid",  desc: "Raid the site on its own map: search containers while Heat rises and more of the dead arrive, then leave by an extraction zone." },
  trade:       { name: "Trade visit",      desc: "Visit a group's base to barter, give gifts and sign pacts." },
  outpost:     { name: "Build outpost",    desc: "Set up camp here and start establishing it as an outpost: a camp (the barest base: tarps, bedrolls and a fire, staging.js) that becomes an outpost once it is established (Establish the outpost: 20 scrap and 2 building materials brought in, then 20 work-hours by its builders). An hour to set up, no materials; what the team carries goes into the camp's stores, and so straight into the step up. The team stays as its first staff, on building." },
  camp:        { name: "Set up camp",      desc: "Stop and make camp here: the barest base (staging.js). The team's people live there while it stands, what it carries goes into the camp's stores, its vehicles park there; Strike camp packs everyone up again." },
  occupy:      { name: "Occupy abandoned base", desc: "Move into a base that stands empty (a group's that died out, gave it up or lost it, or an outpost of yours that was lost): clear out the dead or squatters inside (a fight; the planner shows who is there), and it is your outpost with the buildings still standing, their wear and damage, and the stores left there. No scrap needed. The team stays as its first staff. The group whose base it was, and any group whose claims round it you take, will not like it." },
  recover:     { name: "Recover bodies",   desc: "Collect what is left at a death site before scavengers strip it." },
  cull:        { name: "Cull horde",       desc: "Thin out or lure away a horde on or next to this tile." },
  hive:        { name: "Destroy hive",     desc: "Storm an infestation hive: a hard tactical battle against its brood and the Broodmother inside. Win and the hive is destroyed. Bring five or six well-armed fighters." },
  growth:      { name: "Burn the growth",  desc: "Attack a structure a hive has grown beside it (a pit, a brood chamber, a warren...): fight its guard in a small battle, or burn it with 4 fuel or 2 Molotovs (it may take two fires). Gone, the hive loses what it gave: income, a bigger guard, a kind of special dead, its Wallbreakers. Bring three or four fighters." },
  nomads:      { name: "Attack the nomad camp", desc: "Go to a nomad camp your people spotted (nomads.js) and attack it: a battle against the band with its tier's kit (drifters: pipe spears and scrap weapons; looters: clubs and pistols; survivalists: hunting rifles and bows; preppers: rifles and plate armour). Win and what they carry is yours. They move on every few days: the camp may be gone when you get there." },
  investigate: { name: "Investigate find", desc: "Check a cache, wrecked car or abandoned camp your teams spotted." },
  getvehicle:  { name: "Recover vehicle",  desc: "Bring fuel (and a part if it is badly damaged) to get an abandoned vehicle running. A vehicle found on a map that needs work is repaired on the spot (foundcars.js)." },
  drivehome:   { name: "Drive it home",    desc: "One of the team drives a found vehicle home on their own (foundcars.js).", hidden: true },
  rescue:      { name: "Rescue captives",  desc: "Go to the group base where your people are held: sneak in or storm the base (on its map, or by the numbers), negotiate or pay a ransom." },
  handover:    { name: "Ransom handover",  desc: "Take the ransom to the meeting point a group named and bring your people back (ransom.js).", hidden: true },
  sweep:       { name: "Sweep area",       desc: "Sweep the land around the target for hidden places (farms, cabins, lodges, camps off the roads) and finds: the team moves from spot to spot within the radius for the hours set, then ends back at the centre. Scouting, open ground, daylight and binoculars help; a car covers ground but sees little." },
  fullsurvey:  { name: "Survey",           desc: "Eight hours looking the tile over for the places it hides (pois.js): one roll at the end finds them all, or each on its own with worse odds; optics that reach (binoculars, a scope) take in the ring of tiles round the team at lower odds. It also finds a hidden site here, stamps the tile surveyed and sizes up the threat of every place known here (a word with skulls that goes stale with the days). Not in a fight or on the move. Scouting, open ground, daylight, people and optics help." },
  assault:     { name: "Assault their base", desc: "Attack a group's base (or one of yours they took): a tactical battle against its defenders behind their walls. Win and it is your outpost, with its land and part of its stores; a group that loses its last base is finished. Bring five or six fighters. Attacking a group that is not hostile costs dearly with it, its friends and every peaceful group." },
  survey:      { name: "Quick look",       desc: "Two hours looking the tile over: a chance at each place it hides (about half a Survey's odds, the kind only, no threat; optics help the odds, never the range) and better odds of spotting hidden finds nearby.", hidden: true },
  help:        { name: "Relief squad",     desc: "Help a group under attack.", hidden: true },
  route:       { name: "Convoy",           desc: "Trade-route convoy.", hidden: true },
  retreat:     { name: "Retreat",          desc: "People who left a base before it fell, on their way to another (conquest.js).", hidden: true },
  formed:      { name: "Field",            desc: "A team formed at one of your bases (Form a team…): it waits on the base's tile for orders (teamform.js).", hidden: true },
  moveout:     { name: "Moving out",       desc: "People who left a crowded base, on their way to found an outpost or to another of your bases (moveout.js).", hidden: true },
  flee:        { name: "Refugee",          desc: "Hardcore mode: the survivors who fled when Calder fell, on the road until they found their first hub (hardcore-start.js).", hidden: true },
  // With no base at all (hardcore's first hub, the exiles): a camp built up into the hub (staging.js).
  establish:   { name: "Establish base",   desc: "Set up camp here and build it up into a shelter (then, later, a base): its builders work on it as the materials it lists come in (staging.js).", hidden: true },
  enter:       { name: "Enter base",       desc: "Move into the base of yours the team stands on: its people live there from now on, what it carries goes into the stores and armory, its vehicle parks there, and the team is disbanded (moveout.js enterOption).", hidden: true },
  strikecamp:  { name: "Strike the camp",  desc: "Old saves' order: a camp is struck from its base window now (staging.js strikeCamp).", hidden: true },
  hunt:        { name: "Hunting",          desc: "A hunting trip (hunting.js): the team's name while its plan hunts.", hidden: true },
  fish:        { name: "Fishing",          desc: "A fishing trip (hunting.js): the team's name while its plan fishes.", hidden: true },
  wood:        { name: "Woodcutting",      desc: "A woodcutting trip (woodcutting.js): the team's name while its plan cuts firewood.", hidden: true },
  caravan:     { name: "Trade caravan",    desc: "Caravan stop: trade here, unload, stay a day, go on to the next destination or return home (caravans.js).", hidden: true },
};

// vehicle: false (on foot), true (a car) or "bike". Bikes: roads at BIKE_ROAD (half an hour a tile, twice walking
// pace), off-road and over mountains at walking cost (vehicles.js).
export const BIKE_ROAD = 0.5;
// The cheapest step each way of travelling: planPath's A* heuristic (hex.js findPath) uses it so it never
// overestimates (a car on the road, a bike on the road, a walker anywhere).
const MIN_STEP = { car: ROAD_COST.vehicle, bike: BIKE_ROAD, walk: Math.min(ROAD_COST.walk, ...Object.values(TERRAIN).map((t) => t.walk)) };
// A barricaded bridge: a base on a bridge tile (yours or a group's) closes the only road over the river to everyone
// but its own people and their allies (your coalition, alliance.js). Nobody passes through; the tile can still be the
// destination (a raid, an assault, a trade visit), and the river can still be crossed by boat elsewhere (crossing.js).
// who: "player", a group's id, or undefined for nobody in particular (no bridge is closed to them).
/** @param {State} state @param {number} tile */
export function bridgeHolder(state, tile) {
  const t = state.tiles[tile];
  if (!t || !t.bridge) return null;
  if (state.bases.some((b) => b.tile === tile)) return "player";
  const f = state.factions.find((x) => x.alive && x.bases.includes(tile));
  return f ? f.id : null;
}
/** @param {State} state @param {number} tile @param {string | number} who */
export function bridgeClosedTo(state, tile, who) {
  if (who === undefined) return false;
  const holder = bridgeHolder(state, tile);
  if (holder == null || holder === who) return false;
  /** @param {string | number} id */
  const allied = (id) => !!(state.alliance && state.alliance.members && state.alliance.members.includes(id));
  if (holder === "player") return !allied(who);
  if (who === "player") return !allied(holder);
  return true;
}
// hour: the hour the step is taken in (a river frozen in deep winter can be walked, never driven: weather.js ICE).
/** @param {State} state @param {number} from @param {number} to @param {boolean | "bike"} vehicle @param {string | number} who @param {number} [hour] */
export function moveCost(state, from, to, vehicle, who, hour = state.hour) {
  const t = state.tiles[to];
  const mode = vehicle === true ? "vehicle" : "walk";
  if (t.terrain === "water" && !t.bridge) return vehicle || !riverFrozen(state, to, hour) ? Infinity : ICE.walk;
  if (t.bridge && bridgeClosedTo(state, to, who)) return Infinity; // someone else's barricade across the bridge
  const f = state.tiles[from];
  // On a bridge the only way is along it: off the side is the river. (Without this a team could step off a bridge
  // onto a bank it can never leave again, since water is only crossed on the road, and starve there waiting for a boat.)
  if (f.terrain === "water" && f.bridge && !f.roadLinks.includes(to)) return Infinity;
  const onRoad = f.roadLinks.includes(to);
  if (onRoad) return vehicle === "bike" ? BIKE_ROAD : ROAD_COST[mode];
  return TERRAIN[t.terrain][mode];
}

// who: whose way it is ("player" by default): a bridge barricaded by someone else is closed to them, except as the
// destination itself.
/** @param {State} state @param {number} from @param {number} to @param {boolean | "bike"} vehicle @param {string | number} [who] */
export function planPath(state, from, to, vehicle, who = "player") {
  const h = vehicle === true ? MIN_STEP.car : vehicle === "bike" ? MIN_STEP.bike : MIN_STEP.walk;
  return findPath(state.grid, from, to, (a, b) => moveCost(state, a, b, vehicle, b === to ? undefined : who), Infinity, h);
}

// Fuel a car burns along a path (road 0.6, off-road 1.5 a tile) times its load multiplier (vehicles.js fuelMultFor).
/** @param {State} state @param {number[]} path @param {number} [mult] */
export function fuelForPath(state, path, mult = 1) {
  let fuel = 0;
  for (let i = 1; i < path.length; i++) fuel += tileFuel(true, state.tiles[path[i - 1]].roadLinks.includes(path[i]), mult);
  return fuel;
}

// Most kg of supplies and cargo these people (and their vehicle) can carry: everyone's max load less what they wear,
// plus the bikes' racks, or a car's payload up to 125% (load.js teamLoad). vehicle: an object, or true for a truck.
/** @param {State} state @param {Survivor[]} members @param {Vehicle | boolean | "bike" | { type: string } | null} vehicle */
export function carryCapacity(state, members, vehicle) {
  const v = typeof vehicle === "object" ? vehicle : vehicle ? { type: "truck" } : null;
  return Math.round(teamLoad(members, 0, v).capacity * 100) / 100;
}
/** @param {State} state @param {Party} p */
export const partyCapacity = (state, p) => carryCapacity(state, partyMembers(state, p), partyFleet(state, p)); // every vehicle of the team's (vehicles.js fleets)

/** @param {Stock} supplies */
// "food" / "preserved" in a plan (days of food, packed as what keeps and weighs least: foods.js packPick) weigh
// FOOD_PACK_KG a day, about (MREs 1.1, ration bars 0.4, jerky and peanut butter 0.4–0.5, cans 2.2).
export const FOOD_PACK_KG = DAY_KG; // foods.js
// The items a team asking for `days` of food packs at `home` (launchExpedition; the planner's estimate weighs the same).
export const packFoodPick = (state, home, days, opts = {}) => (home && days > 0 ? packPick(state, home, days, { days: opts.foodDays || 7, prefer: opts.packFood || null }) : {});
// A planned team's supplies as it would pack them: "food" (days) as the items (packFoodPick), the rest as they are.
export function packedSupplies(state, home, supplies, opts = {}) {
  const days = Number(supplies && supplies.food) || 0;
  if (!(days > 0) || !home) return supplies || {};
  const out = { ...supplies };
  delete out.food;
  for (const [k, q] of Object.entries(packFoodPick(state, home, days, opts))) out[k] = (out[k] || 0) + q;
  return out;
}
export const supplyLoad = (supplies) => Object.entries(supplies || {}).reduce((s, [k, v]) => s + (!Number.isFinite(v) || !(v > 0) ? 0 : SUPPLIES[k] ? v * supWeight(k) : k === "food" || k === "preserved" ? v * FOOD_PACK_KG : 0), 0);
// Kg of found cargo: supplies, and items by weight (a pack in the cargo also counts what is inside it, inventory.js itemLoad).
// A body brought home in the car (carriers.js stowBody / endBodies): the body itself (hiveconst.js CARRIER.BODY_KG) and its things.
export const bodyLoad = (body) => CARRIER.BODY_KG + supplyLoad(body.supplies) + (body.items || []).reduce((s, g) => s + itemLoad(g), 0);
/** @param {Cargo} cargo */
export const bodiesLoad = (cargo) => (cargo && cargo.bodies ? cargo.bodies.reduce((s, body) => s + bodyLoad(body), 0) : 0);
/** @param {Cargo} cargo */
export const cargoLoad = (cargo) => (cargo ? supplyLoad(cargo.supplies) + cargo.gear.reduce((s, g) => s + itemLoad(g), 0) + bodiesLoad(cargo) : 0);
// Everything the team shares out: packed supplies and found cargo (load.js).
/** @param {Party} p */
export const poolLoad = (p) => supplyLoad(p.supplies) + cargoLoad(p.cargo);
// Room left for more (found goods): what the team can carry less what it already does. A team the autopilot packs
// may keep its loot to a band (p.haulBand, load.js): it stops picking things up before it gets that heavy on foot.
/** @param {State} state @param {Party} p */
export function cargoRoom(state, p) {
  let cap = partyCapacity(state, p);
  if (p.haulCap != null && !p.vehicle) cap = Math.min(cap, p.haulCap);
  if (p.task && p.task.capKg != null && p.task.kind0 != null && KEY_KINDS[p.task.type]) cap = Math.min(cap, poolLoad(p) + Math.max(0, p.task.capKg - (keyKg(p, KEY_KINDS[p.task.type]) - p.task.kind0))); // carry.js capTask: water and firewood counted by themselves
  else if (p.task && p.task.capKg != null && p.task.pool0 != null) cap = Math.min(cap, p.task.pool0 + p.task.capKg); // carry.js capTask: collect only as much as asked
  return Math.max(0, cap - poolLoad(p));
}

// ---------- load and pace (load.js) ----------
// The team is weighed (p.burden) when it sets off, when it stops (each hour it waits), when its people or vehicle
// change, and when its load goes up on the move (something picked up). Eating on the way does not lighten it until
// it stops, so every estimate made when it sets off holds.
/** @param {State} state @param {Party} p */
export function weighTeam(state, p) {
  if (!p || p.owner !== "player" || p.kind === "convoy") return null;
  const members = partyMembers(state, p);
  const v = partyFleet(state, p); // all its vehicles together (vehicles.js fleetOf)
  p.burden = burdenRecord(teamLoad(members, poolLoad(p), v, cartSupOf(state, p)), members, v); // carry.js cartSupOf: the supplies in the carts (carts.js)
  return p.burden;
}
/** @param {State} state @param {Party} p */
function reweigh(state, p) {
  if (p.owner !== "player" || p.kind === "convoy") return;
  const b = p.burden;
  const members = partyMembers(state, p);
  const ids = members.map((s) => s.id).sort((a, x) => a - x).join(",");
  const total = poolLoad(p) + members.reduce((a, s) => a + wornLoad(s), 0);
  const vid = p.vehicleId || null;
  if (!b || p.phase === "waiting" || b.ids !== ids || (vid != null && vid !== b.vid) || total > b.total + 0.5) {
    weighTeam(state, p);
    // On the move nothing makes the team faster until it stops (a newcomer to share the load, food eaten): only
    // what slows it counts at once. So the hours it was told when it set off are the most it takes.
    if (b && onTheMove(p) && (vid == null || vid === b.vid)) {
      const nb = p.burden;
      nb.foot = Math.min(nb.foot, b.foot);
      if (nb.ride != null && b.ride != null) nb.ride = Math.min(nb.ride, b.ride);
      nb.fuelMult = Math.max(nb.fuelMult, b.fuelMult || 1);
      nb.total = Math.max(nb.total, b.total);
    }
  }
}
// The team's load as it is now (for the panels): people, bands, a car's fill. Not what its pace uses (p.burden).
/** @param {State} state @param {Party} p */
export const partyLoad = (state, p) => teamLoad(partyMembers(state, p), poolLoad(p), partyFleet(state, p), cartSupOf(state, p));
// How many units of a supply fit in the remaining space.
/** @param {number} room @param {string} key */
export const unitsThatFit = (room, key) => Math.max(0, Math.floor(room / supWeight(key)));
// What a team carries of one supply: packed plus found (never negative).
/** @param {Party} p @param {string} key */
// "ammo": every round the team carries, any calibre (rounds.js totalRounds); "food": days of food of every kind
// (foods.js foodIn: packed and found).
export const carried = (p, key) => (key === "ammo" ? totalRounds(p.supplies) + totalRounds(p.cargo && p.cargo.supplies) : key === "food" ? foodIn(p.supplies) + foodIn(p.cargo && p.cargo.supplies) : Math.max(0, p.supplies[key] || 0) + Math.max(0, (p.cargo && p.cargo.supplies[key]) || 0));
// A supply a team carries for a check or a cost, water counting both kinds (water.js), and taking it (water: purified
// first).
/** @param {Party} p @param {string} key */
export const carriedAny = (p, key) => (key === "water" ? teamWaterIn(p) : carried(p, key));
/** @param {Party} p @param {string} key @param {number} qty */
export const takeAny = (p, key, qty) => (key === "water" ? takeTeamWater(p, qty).got : takeSupply(p, key, qty));
// Uses up carried supplies, found cargo first, then packed. Takes what is there and never goes below zero
// (callers check `carried` first when the full amount is required). Returns the amount taken.
/** @param {Party} p @param {string} key @param {number} qty */
export function takeSupply(p, key, qty) {
  const want = Math.max(0, Number(qty) || 0);
  if (key === "ammo") { const c = p.cargo && p.cargo.supplies ? spendAmmo(p.cargo.supplies, Math.floor(want), p.ammoCals).n : 0; return c + spendAmmo(p.supplies, Math.floor(want) - c, p.ammoCals).n; } // rounds.js: any calibre, the ones its guns need last (p.ammoCals, ammo.js settleParty), the cheapest first
  if (key === "food") return takeFood([p, p.cargo].filter((h) => h && h.supplies), want, { eggs: false }).units; // days of food, the soonest to spoil first (foods.js)
  const fromCargo = Math.min(want, Math.max(0, (p.cargo && p.cargo.supplies[key]) || 0));
  if (fromCargo) p.cargo.supplies[key] -= fromCargo;
  const packed = Math.max(0, p.supplies[key] || 0);
  const fromPacked = Math.min(want - fromCargo, packed);
  p.supplies[key] = packed - fromPacked;
  return fromCargo + fromPacked;
}
// A team's shots in a fight by the numbers (events.js, the killzone): `total` rounds split by head between the bows
// and crossbows (arrows) and everyone else (ammo; world.js usesArrows), each taken as takeSupply does. With no bow
// it is all rounds. The rounds: each gun its own calibre (ammo.js drawTeamShots: cargo first, then what was packed; no
// gun, any rounds). Returns what was taken: { ammo, used: { key: q }, arrows } (used: for armedFactor by calibre).
export function takeShots(p, members, total) {
  const nb = archerCount(members);
  const bows = nb ? Math.round((total * nb) / Math.max(1, members.length)) : 0;
  const d = drawTeamShots([p.cargo && p.cargo.supplies, p.supplies], members.filter((s) => !usesArrows(s)), total - bows);
  return { ammo: d.n, used: d.used, arrows: bows ? takeSupply(p, "arrows", bows) : 0 };
}

/** @param {State} state @param {Party} p */
export function partyMembers(state, p) {
  return (p.members || []).map((id) => survivorById(state, id)).filter((s) => s && s.alive);
}

/** @param {State} state @param {Party} p @param {string} key */
export function bestSkill(state, p, key) {
  return Math.max(0, ...partyMembers(state, p).map((s) => skill(s, key) + checkBonus(s, key))); // checkBonus: Shadow (skills.js)
}

// At night (20:00–06:00) a team in the field sees only the tile it stands on (0), whatever its scouts and optics, and
// one tile round with night vision goggles or a thermal monocular in someone's off hand (NIGHT_SIGHT): it can walk
// into a horde or a war party it never saw on the map, and sharing a tile with them means a fight (conflicts.js
// contactAttack). Fog and blizzards cannot take it below its own tile.
export const NIGHT_SIGHT = { dark: 0, goggles: 1, GOGGLES: ["nvg", "thermal"] };
/** @param {Survivor[]} members */
export const nightEyesOn = (members) => members.some((s) => s.gear && s.gear.tool && NIGHT_SIGHT.GOGGLES.includes(s.gear.tool.key));
/** @param {State} state @param {Party} p */
export function sightRadius(state, p) {
  const m = partyMembers(state, p);
  const fx = travelEffects(state, state.hour, partyTile(p)); // fog or a blizzard where the team is (weather.js)
  if (isNight(state)) return Math.max(0, (nightEyesOn(m) ? NIGHT_SIGHT.goggles : NIGHT_SIGHT.dark) + Math.min(0, fx.sight));
  let r = 1;
  if (bestSkill(state, p, "scouting") >= 10) r += 1;
  r += teamTraitFx(m, "keeneye", "sight"); // Keen Eye, the team's best tier (traits.js)
  if (m.some((s) => hasPerk(s, "lookout"))) r += 1; // Lookout (skills.js)
  // Binoculars a tile more by day; a thermal at night and in fog (optics.js). A spotting scope only while it stays put.
  r += opticsFor(m, p.cargo, { still: !onTheMove(p), night: state.hour % 24 < 6 || state.hour % 24 >= 20, fog: fx.sight < 0 }).sight;
  return Math.max(1, r + fx.sight); // fog and blizzards cut sight by a tile (weather.js)
}

/** @param {State} state @param {Party} p */
function hasMilRadio(state, p) {
  return partyMembers(state, p).some((s) => s.gear.tool && s.gear.tool.key === "milradio" && gearEffect(s, s.gear.tool).usable);
}

// A team is called after the mission it left with (later orders do not rename it).
/** @param {State} state @param {Party} p */
export const teamName = (state, p) => `${MISSIONS[p.teamMission || p.mission]?.name || "Team"} team (${partyMembers(state, p).map((s) => s.name.split(" ")[0]).join(", ")})`;

// A site the player has not found yet (discovery.js) goes by its ground.
/** @param {State} state @param {number} id */
export function tileLabel(state, id) {
  const t = state.tiles[id];
  return t.loc && siteNamed(state, id) ? t.loc.name : `${TERRAIN[t.terrain].name.toLowerCase()} (${t.x},${t.y})`;
}

// A name for a new outpost: the site it stands on, else the nearest town, city or stand-alone site with the
// direction from it ("North of Dunmore Outpost"). No two bases share a name; the player can rename it on the
// base screen. Uses no random numbers.
/** @param {State} state @param {number} tile */
export function outpostName(state, tile) {
  const t = state.tiles[tile], g = state.grid;
  let place = t.loc ? t.loc.name : null;
  if (!place) {
    let best = null;
    for (const x of state.tiles) {
      if (!x.loc || (x.loc.settlement != null && x.loc.settlement !== x.id) || !siteKnown(state, x.id)) continue; // a town's own shops go by the town
      const settled = x.loc.type === "town" || x.loc.type === "city";
      const score = g.distance(tile, x.id) - (settled ? 1.5 : 0); // the names people know count as a little nearer
      if (!best || score < best.score) best = { x, score };
    }
    if (best) {
      const [ax, ay] = g.toPixel(best.x.id, 1), [bx, by] = g.toPixel(tile, 1);
      const dirs = ["East", "South-east", "South", "South-west", "West", "North-west", "North", "North-east"];
      const dir = dirs[((Math.round((Math.atan2(by - ay, bx - ax) * 180) / Math.PI / 45) % 8) + 8) % 8];
      place = `${dir} of ${best.x.loc.name}`;
    } else place = tileLabel(state, tile);
  }
  // A base on a bridge is the barricade across it: "Dunmore Bridge Barricade" (the nearest named place, not a direction).
  const kind = t.bridge ? "Bridge Barricade" : "Outpost";
  if (t.bridge && !t.loc) place = place.replace(/^(North|South|East|West|North-east|North-west|South-east|South-west) of /, "");
  let name = `${place} ${kind}`;
  for (let n = 2; state.bases.some((b) => b.name === name); n++) name = `${place} ${kind} ${n}`;
  return name;
}

// ---------- trip estimates for the planner ----------
// Travel speed per hour for a player team (trade-route convoys keep a steady pace).
// p.perkSpeed: Pathfinder's +10% on foot (set each hour by skills.js skillsHour).
// p.burden: the team's load when it was last weighed (weighTeam): its pace on foot or riding (load.js).
/** @param {Party} p @param {boolean | "bike"} [mode] */
export const loadPace = (p, mode = p.vehicle) => (!p.burden ? 1 : mode ? p.burden.ride ?? 1 : p.burden.foot ?? 1);
/** @param {Party} p */
// Walkers (walkers.js: people without a seat after a vehicle was lost): the whole team at their pace, each carrying only
// their own kit (the cargo rides in the vehicles).
export const partySpeed = (p) => (p.kind === "convoy" && p.routeKind !== "supply" ? 1 : p.walkers > 0 && p.vehicle ? (STANCES[p.stance]?.speed || 1) * (p.perkSpeed || 1) * (p.prisonSpeed || 1) : (STANCES[p.stance]?.speed || 1) * (p.perkSpeed || 1) * (p.prisonSpeed || 1) * loadPace(p)); // prisonSpeed: prisoners walking with the team (prisoners.js)
// The pace on foot (after a vehicle runs dry or is left: estimates switch to it, as the real team does).
/** @param {Party} p */
export const footSpeed = (p) => (p.kind === "convoy" && p.routeKind !== "supply" ? 1 : (STANCES[p.stance]?.speed || 1) * (p.vehicle ? 1 : (p.perkSpeed || 1) * (p.prisonSpeed || 1)) * loadPace(p, false));
// The pace in a given mode (false, true or "bike"): the team's own when it moves that way now.
/** @param {Party} p @param {boolean | "bike"} mode */
export const modeSpeed = (p, mode) => (!!mode === !!p.vehicle ? partySpeed(p) : mode ? (STANCES[p.stance]?.speed || 1) * loadPace(p, mode) : footSpeed(p));
/** @param {Party} p */
export const fuelMultOf = (p) =>(p.burden && p.vehicle === true ? p.burden.fuelMult || 1 : 1);
// The options travelHours needs for a team as it is: { speed, footSpeed, fuelMult }.
/** @param {Party} p */
export const paceOpts = (p) => ({ speed: partySpeed(p), footSpeed: footSpeed(p), fuelMult: fuelMultOf(p), offroad: offroadOf(p), onroad: onroadOf(p), walkers: p.walkers > 0 && p.vehicle ? p.walkers : 0, cartTer: cartTerOf(p) });
// How a team's steps are costed: as it travels, except that with walkers (walkers.js) the vehicles keep to their road
// but every step takes a walker's time.
/** @param {any} p */
export const stepMode = (p) => (p.walkers > 0 && p.vehicle ? false : p.vehicle);
// × the pace off-road in the vehicle (vehicles.js VEHICLE_TYPES offroad: the Army truck 0.75), from the last weighing.
/** @param {Party} p */
export const offroadOf = (p) => (p.burden && p.vehicle === true ? p.burden.offroad || 1 : 1);
// On foot with a cart (carts.js cartTerrain): the slowest cart's pace by terrain, from the last weighing; null: none.
/** @param {any} p */
export const cartTerOf = (p) => (p.cartTer !== undefined ? p.cartTer : p.burden && !p.vehicle ? p.burden.cartTer || null : null);
// × the pace on roads: bikes among a team's cars hold the convoy to the bikes' road pace (vehicles.js roadPace).
/** @param {Party} p */
export const onroadOf = (p) => (p.burden && p.vehicle === true ? p.burden.onroad || 1 : 1);
// The cost of one step for a team (or a planning copy with its own offroad): an off-road step in a slow vehicle costs more.
const offroadStep = (state, p, from, to) => (!p.vehicle ? cartStep(state, p, from, to) : p.vehicle !== true || p.walkers > 0 ? 1 : !state.tiles[from].roadLinks.includes(to) ? 1 / ((p.offroad ?? offroadOf(p)) || 1) : 1 / ((p.onroad ?? onroadOf(p)) || 1));

// On foot: a cart's pace onto that ground (carts.js cartTerrain), 1 with no cart.
/** @param {State} state @param {any} p @param {number} from @param {number} to */
function cartStep(state, p, from, to) {
  const ct = cartTerOf(p);
  if (!ct) return 1;
  const m = state.tiles[from].roadLinks.includes(to) ? ct.road : ct[state.tiles[to].terrain];
  return 1 / (m || 1);
}
// The same for a team already out, from its last weighing (p.burden).
/** @param {State} state @param {Party} p */
export function partyPace(state, p) {
  const members = partyMembers(state, p);
  return {
    mode: p.vehicle || false, speed: partySpeed(p), footSpeed: footSpeed(p), rideSpeed: p.vehicle ? partySpeed(p) : null, fuelMult: fuelMultOf(p),
    eatMove: rationRate(p.burden, members, p.vehicle, true), eatFoot: rationRate(p.burden, members, false, true),
    // Food is the rations × each one's appetite (a Glutton, traits.js), as needs.js teamNeedsHour eats it; water is not.
    foodMove: members.reduce((a, s) => a + personRation(p.burden, s, p.vehicle, true) * appetite(s), 0),
    foodFoot: members.reduce((a, s) => a + personRation(p.burden, s, false, true) * appetite(s), 0),
    foodRest: members.reduce((a, s) => a + appetite(s), 0),
  };
}

// Pace and rations a planned team would have (the planner and launch): stance × load (× Pathfinder on foot, as the
// trip gets from its first hour, skills.js skillsHour). members: survivors; supplies: what it packs; v: its vehicle.
// extraKg: more on top of the packed supplies (the planner's expected haul of fresh game, plans.js).
/** @param {State} state */
export function plannedPace(state, { members, supplies = {}, v = null, stance = "normal", extraKg = 0 }) {
  const t = teamLoad(members, supplyLoad(supplies) + Math.max(0, extraKg), v);
  const st = STANCES[stance]?.speed || 1;
  const pf = members.some((s) => hasPerk(s, "pathfinder")) ? 1.1 : 1;
  const mode = travelMode(v);
  return {
    load: t, mode,
    speed: st * (mode ? t.ride.speed : t.foot.speed * pf), footSpeed: st * pf * t.foot.speed, rideSpeed: mode ? st * t.ride.speed : null,
    fuelMult: mode === true ? t.fuelMult : 1, offroad: mode === true ? typeOffroad(v) : 1, onroad: mode === true ? roadPace(v) : 1,
    eatMove: members.reduce((a, s) => a + ((mode ? t.ride.eat : t.foot.eat)[s.id] || 1), 0),
    eatFoot: members.reduce((a, s) => a + (t.foot.eat[s.id] || 1), 0),
    // Food is the rations × each one's appetite (a Glutton, traits.js), as needs.js teamNeedsHour eats it; water is not.
    foodMove: members.reduce((a, s) => a + ((mode ? t.ride.eat : t.foot.eat)[s.id] || 1) * appetite(s), 0),
    foodFoot: members.reduce((a, s) => a + (t.foot.eat[s.id] || 1) * appetite(s), 0),
    foodRest: members.reduce((a, s) => a + appetite(s), 0),
  };
}

// Whole hours to walk/drive a path, using the same hour-by-hour stepping as the real movement
// (stepAlong): a tile is entered only once enough progress has built up, leftover progress carries
// over, a delay (negative progress) is paid first, and a vehicle that runs dry is left behind and the
// team walks the rest (at walking cost). Random events and fights can still add delays on the road.
// maxHours: stop early (idx then says how far the team got).
// Weather (weather.js) changes the cost of a step by the hour it is taken in, and every day's weather is already
// fixed in state.weather, so the estimate steps through the same hours as the trip will: startHour is the hour the
// trip starts from (now, unless it is a later leg or a queued move). weather: false gives the fair-weather time.
// vehicle: false, true (a car) or "bike"; speed: the pace in that mode; footSpeed: the pace on foot once a car runs
// dry (the team's load is no longer carried for it); fuelMult: the car's load multiplier on fuel (vehicles.js).
// rideHours: hours started in the vehicle (rations: the rest are on foot).
// known: the hour the estimate is made in (now): only the weather fronts already on the map by then count (weather.js),
// so a front that forms later can still make the trip slower than estimated.
/** @param {State} state @param {number[]} path @param {TravelOpts} [opts] */
export function travelHours(state, path, { vehicle = false, speed = 1, footSpeed = null, fuelMult = 1, offroad = 1, onroad = 1, walkers = 0, cartTer = null, progress = 0, idx = 0, fuel = Infinity, maxHours = 24 * 90, startHour = state.hour, weather = true, known = state.hour, used = 0 } = {}) {
  const sim = { path: [...path], idx, progress, vehicle: vehicle || false, offroad, onroad, walkers, cartTer }; // cartTer: carts.js
  let f = fuel, hours = 0, dryAt = null, rideHours = 0, lastSp = 0;
  while (sim.idx < sim.path.length - 1 && hours < maxHours) {
    hours += 1;
    if (sim.vehicle) rideHours += 1;
    const sp = sim.vehicle || footSpeed == null ? speed : footSpeed;
    lastSp = sp;
    // used: the share of the first hour already travelled (p.hourUsed: a new way given part-way through it).
    for (const tileId of stepAlong(state, sim, sp * (hours === 1 ? 1 - used : 1), weather ? startHour + hours : null, known)) {
      if (sim.vehicle !== true) continue;
      const prev = sim.path[sim.path.lastIndexOf(tileId, sim.idx) - 1];
      const use = tileFuel(true, state.tiles[prev].roadLinks.includes(tileId), fuelMult);
      if (f < use - 1e-9) { f = 0; sim.vehicle = false; dryAt = tileId; } // same rule as useFuel
      else f -= use;
    }
  }
  const reached = sim.path[sim.path.length - 1] === path[path.length - 1];
  // exact: the hours to the minute it gets there (a team arrives part-way through its last hour, arrivalsDue): the
  // last hour's progress left over was not needed. Whole hours when it does not get there.
  const lastPace = lastSp * (hours === 1 ? 1 - used : 1); // the progress its last hour made
  const exact = reached && sim.idx >= sim.path.length - 1 && hours > 0 && lastSp > 0 ? hours - 1 + (hours === 1 ? used : 0) + Math.max(0, Math.min(lastPace, lastPace - Math.max(0, sim.progress))) / lastSp : hours;
  return { hours, exact, rideHours, idx: sim.idx, fuelLeft: f, vehicle: sim.vehicle, dryAt, reached, progress: sim.progress };
}

// ---------- the clock's minutes ----------
// The share of the coming hour already gone on the clock: the main loop sets it every frame (main.js, from the minutes
// it shows) and puts it back to 0 while the hour ticks; the headless tools never set it. The sim moves teams by whole
// hours, the tick at the end of an hour crediting a moving team the whole hour of travel; so a move that starts part
// way through the hour starts that part behind (wayOn), and its ETA counts from the minute it was given.
let CLOCK_FRAC = 0, BY_MINUTE = false;
// clock: false for the tick's own bracketing (world.js tickHour), which is no sign of a clock with minutes.
/** @param {number} f @param {boolean} [clock] */
export function setClockFrac(f, clock = true) { if (clock) BY_MINUTE = true; CLOCK_FRAC = Number.isFinite(f) ? Math.max(0, Math.min(0.999, f)) : 0; }
// True once a clock with minutes drives the sim (the main loop: teams arrive and jobs end at their minute,
// arrivalsDue); the headless tools never set one, and there everything happens as the hour ticks.
export const byMinute = () => BY_MINUTE;
/** @param {State} [state] */
export const clockFrac = (state) => CLOCK_FRAC;
// A time on the clock to the minute: "day 3, 14:05" (t: hours since the start, a share of an hour included).
/** @param {number} t */
export function clockAt(t) {
  const m = Math.round(t * 60), hr = Math.floor(m / 60);
  return `day ${Math.floor(hr / 24) + 1}, ${String(hr % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
// Hours on the clock as the panels and the log give an ETA: "3h", "2h 05m", "45m", "2d 4h".
/** @param {number} h */
export function clockText(h) {
  const m = Math.max(0, Math.round(h * 60)), hh = Math.floor(m / 60), mm = m % 60;
  if (hh >= 48) return `${Math.floor(hh / 24)}d ${hh % 24}h`;
  return hh && mm ? `${hh}h ${String(mm).padStart(2, "0")}m` : hh ? `${hh}h` : `${mm}m`;
}
// ---------- a new way, from where the team is at this minute ----------
// On the move this hour (not yet moved for it: arrivalsDue).
/** @param {State} state @param {Party} p */
const movingNow = (state, p) => onTheMove(p) && p.movedHour !== state.hour + 1;
// A copy of a moving team stepped to `frac` of the coming hour as moveHour will step it (the glide's course): no tile
// is entered for real, nothing happens. For the estimates of a new way (moveEstimate).
/** @param {State} state @param {Party} p @param {number} frac */
function stepCopy(state, p, frac) {
  const hour = state.hour + 1;
  const q = { ...p, path: p.path, idx: p.idx, progress: p.progress || 0 };
  const share = frac - hourUsed(p, hour);
  if (share <= 1e-9) return q;
  q.progress += partySpeed(p) * share;
  while (q.idx < q.path.length - 1) {
    const cost = stepCost(state, q, q.idx, hour);
    if (!isFinite(cost)) { q.path = q.path.slice(0, q.idx + 1); break; }
    if (q.progress < cost) break;
    q.progress -= cost;
    q.idx += 1;
    if (q.idx < q.path.length - 1) q.progress -= blockDelay(state, q, q.idx - 1, hour);
  }
  return q;
}
// A team on the move given a new way: it first travels the minutes of this hour already gone, for real (moveHour up
// to the clock's minute: the tiles it has passed on the map are entered now), so it turns from where the map draws it.
// Returns true if it is still on the move (the rest of the hour is then its to travel: p.hourUsed).
/** @param {State} state @param {Party} p */
function stepToNow(state, p) {
  if (!movingNow(state, p)) return false;
  const hour = state.hour + 1, frac = clockFrac(state);
  if (frac > hourUsed(p, hour) + 1e-9) moveHour(state, p, hour, frac);
  return state.parties.includes(p) && movingNow(state, p);
}
// The way on to `tile` for a team given a new move now (orderMove, startReturn, and moveEstimate): { path, progress,
// turn } from q (the team itself, after stepToNow, or stepCopy of it), or null (no way there).
// - Not on the move: from its tile; a delay it still owes is kept, and the minutes of this hour already gone are owed
//   too (the tick credits the whole hour).
// - On the move: from the point it has reached. Part-way along a step it goes on along it when the new way starts with
//   it; else it goes on to the next tile or turns back to the one it came from, whichever gets it there sooner. Turning
//   back, it owes the walk back (turn: { to, f, d }: drawn walking back from f of the way to `to`, glideAt).
/** @param {State} state @param {Party} p @param {any} q @param {number} tile @param {boolean | "bike"} mode @param {boolean} moving */
function wayOn(state, p, q, tile, mode, moving) {
  const C = q.path[q.idx], N = q.path[q.idx + 1];
  const res = planPath(state, C, tile, mode);
  const prog = q.progress || 0;
  if (!moving) return res && { path: res.path, progress: Math.min(0, prog) - clockFrac(state) * partySpeed(p), turn: null };
  if (prog <= 0 || N == null) return res && { path: res.path, progress: prog, turn: null };
  if (res && res.path[1] === N) return { path: res.path, progress: prog, turn: null };
  const hour = state.hour + 1;
  const c = stepCost(state, q, q.idx, hour);
  const phi = c > 0 && isFinite(c) ? Math.min(1, prog / c) : 0;
  // Back to the tile it just left: it walks back along the step it is on (on it from the far end).
  if (C === tile) {
    const cb = stepCost(state, { ...q, path: [N, C], idx: 0 }, 0, hour);
    return isFinite(cb) ? { path: [N, C], progress: (1 - phi) * cb, turn: null } : null;
  }
  const fwd = N === tile ? { path: [N] } : planPath(state, N, tile, mode);
  /** @param {number[]} path */
  const cost = (path) => path.reduce((a, id, k) => (k ? a + moveCost(state, path[k - 1], id, mode, "player", hour) : a), 0);
  const ahead = fwd ? (1 - phi) * c + cost(fwd.path) : Infinity;
  const back = res && C !== tile ? phi * c + cost(res.path) : Infinity;
  if (ahead <= back) return { path: [C, ...fwd.path], progress: prog, turn: null };
  if (!res || back === Infinity) return null;
  return { path: res.path, progress: -phi * c, turn: { to: N, f: phi, d: phi * c } };
}
// Sets a team off on a way from wayOn.
/** @param {State} state @param {Party} p @param {{ path: number[], progress: number, turn: any }} w @param {boolean} moving */
function setWay(state, p, w, moving) {
  p.path = w.path;
  p.idx = 0;
  p.progress = w.progress;
  if (w.turn) p.turn = { ...w.turn, path: w.path };
  else delete p.turn;
  delete p.movedHour; // a new move: the tick moves it (it may have arrived somewhere earlier this hour)
  if (!moving) delete p.hourUsed; // the minutes gone are owed instead (wayOn)
}

// What a move order to `tile` would take, worked out exactly as the team will then move (orderMove, hoursLeft):
// { path, progress, ticks: hours the clock ticks before it is there, hours: to the minute it gets there from this
// minute on the clock (arrivalsDue), arriveAt: that time (state.hour + a share of an hour) }, or null (no way there).
/** @param {State} state @param {Party} p @param {number} tile */
export function moveEstimate(state, p, tile) {
  const frac = clockFrac(state), hour = state.hour + 1;
  const moving = movingNow(state, p);
  const q = moving ? stepCopy(state, p, frac) : p; // where the team is at this minute (as stepToNow will put it)
  const w = wayOn(state, p, q, tile, p.vehicle, moving);
  if (!w) return null;
  const used = moving ? Math.max(frac, hourUsed(p, hour)) : 0;
  const t = travelHours(state, w.path, { vehicle: p.vehicle, ...paceOpts(p), progress: w.progress, used, fuel: p.vehicle === true ? partyFuel(state, p) : 0 });
  return { path: w.path, progress: w.progress, turn: w.turn, ticks: t.hours, hours: Math.max(0, t.exact - frac), arriveAt: state.hour + t.exact, cartWear: p.vehicle ? 0 : cartRouteWear(state, w.path) }; // cartWear: carts.js
}

// The plan the hub knows about: a new move given while in contact replaces it (no way back assumed).
/** @param {State} state @param {Party} p @param {number | null} etaBack */
function setPlan(state, p, etaBack) {
  p.planPath = [...p.path];
  p.planStart = state.hour;
  p.planVehicle = p.vehicle || false;
  p.planFuel = p.vehicle === true ? partyFuel(state, p) : 0;
  p.planProgress = p.progress || 0; // a delay owed when it set off (the minutes of the hour already gone, wayOn)
  p.planUsed = hourUsed(p, state.hour + 1); // the share of this hour it travelled before the new way (stepToNow)
  p.etaOut = hoursLeft(state, p);
  p.etaBack = etaBack;
}

// Where an out-of-contact team should be by now if the plan held: same stepping as real movement along the
// planned path, then 6 hours on site, then the same path back (if a way back was planned). Delays from
// events are unknown at the hub, so this can run ahead of the real team.
// now: the hour to place it at (the map asks for the next hour too, to glide it between the two).
/** @param {State} state @param {Party} p @param {number} [now] */
export function plannedTile(state, p, now = state.hour) {
  const g = plannedPos(state, p, now - state.hour);
  return g.path[Math.min(g.path.length - 1, Math.floor(g.pos + 1e-9))];
}
// The same to the minute: where the plan has the team when frac of the coming hour is gone (the map glides its
// estimate by it, ui/render.js). { path, pos }: pos the place along that leg's way (i + the share of the step from
// path[i] to path[i + 1]). It sets off at the minute it was given the way (planProgress, planUsed), arrives at the
// minute it gets there (as the team does: arrivalsDue), stays its hours on site and starts back at that minute.
/** @param {State} state @param {Party} p @param {number} [frac] */
export function plannedPos(state, p, frac = 0) {
  const { plan, start, opts, out, go } = planLeg(state, p);
  const t = state.hour - start + frac;
  if (t < go.exact) return { path: plan, pos: legPos(state, plan, out, t) };
  const stay = p.planStay ?? 6; // hours at the target before heading back (a plan sets its own, plans.js)
  const tb = t - go.exact - stay;
  if (p.etaBack == null || tb <= 0) return { path: plan, pos: plan.length - 1 };
  // Back from the minute it set off home: that hour's minutes already gone are not travelled (as wayOn).
  const back = [...plan].reverse(), b0 = start + go.exact + stay, bh = Math.floor(b0), sp = modeSpeed(p, go.vehicle);
  const bo = { ...opts, vehicle: go.vehicle, speed: sp, fuel: go.fuelLeft, startHour: bh, progress: -(b0 - bh) * sp, used: 0 };
  return { path: back, pos: legPos(state, back, bo, t - (bh - start)) };
}
// The plan's way out as the hub knows it: the stepping options (opts; out: from its start) and the trip out (go).
/** @param {State} state @param {Party} p */
function planLeg(state, p) {
  const plan = p.planPath || p.path;
  const start = p.planStart ?? p.departed;
  const mode = p.planVehicle === true || p.planVehicle === "bike" ? p.planVehicle : false;
  const opts = { vehicle: mode, ...paceOpts(p), speed: modeSpeed(p, mode), fuel: p.planFuel ?? Infinity, startHour: start, known: start }; // the fronts the hub knew of then
  const out = { ...opts, progress: p.planProgress || 0, used: p.planUsed || 0 };
  return { plan, start, mode, opts, out, go: travelHours(state, plan, out) };
}
// When the plan has an out-of-contact team get there, to the minute (state.hour + a share of an hour).
/** @param {State} state @param {Party} p */
export function plannedArrival(state, p) {
  const { start, go } = planLeg(state, p);
  return start + go.exact;
}
// The place along `path` after `hrs` hours of the stepping travelHours does (o: its options; o.startHour the hour it
// started from): i + the share of the step it is on, the last hour's minutes included.
/** @param {State} state @param {number[]} path @param {any} o @param {number} hrs */
function legPos(state, path, o, hrs) {
  if (hrs <= 0) return 0;
  const whole = Math.floor(hrs), f = hrs - whole;
  const r = travelHours(state, path, { ...o, maxHours: whole });
  if (r.idx >= path.length - 1) return path.length - 1;
  const sp = r.vehicle || o.footSpeed == null ? o.speed : o.footSpeed;
  const q = { path, idx: r.idx, progress: r.progress, vehicle: r.vehicle, offroad: o.offroad ?? 1, onroad: o.onroad ?? 1, walkers: o.walkers ?? 0, cartTer: o.cartTer ?? null };
  const hour = o.startHour + whole + 1;
  const used = whole === 0 ? o.used || 0 : 0;
  let prog = r.progress + sp * Math.max(0, f - used), i = r.idx;
  while (i < path.length - 1) {
    const c = stepCost(state, q, i, hour, o.known ?? Infinity);
    if (!(c > 0) || !isFinite(c)) break;
    if (prog < c) return i + Math.max(0, prog) / c;
    prog -= c;
    i++;
  }
  return Math.min(i, path.length - 1);
}


// Hours left for a team on its current path, from the top of this hour: the hours the clock ticks before it is there,
// or (exact) to the minute it gets there (arrivalsDue: what the panels show, less the minutes already gone).
/** @param {State} state @param {Party} p @param {boolean} [exact] */
export function hoursLeft(state, p, exact = false) {
  if (!p.path || p.idx >= p.path.length - 1) return 0;
  const moved = p.movedHour === state.hour + 1; // moved this hour already (arrivalsDue): the rest from the next hour
  const t = travelHours(state, p.path.slice(p.idx), { vehicle: p.vehicle, ...paceOpts(p), progress: p.progress, fuel: p.vehicle === true ? partyFuel(state, p) : 0, startHour: state.hour + (moved ? 1 : 0), used: moved ? 0 : hourUsed(p, state.hour + 1) });
  return (moved ? 1 : 0) + (exact && arrivesOnTime(p) ? t.exact : t.hours);
}

// The vehicle a planner or estimate means: v (an object or an id), else `vehicle` (true: a truck, "bike": bikes
// for everyone).
/** @param {State} state @param {boolean | "bike"} vehicle @param {Vehicle | number | null} v @returns {Vehicle | { type: string, fuel: number, condition: number, count?: number } | null} */
export function plannedVehicle(state, vehicle, v, n = 1) {
  if (v != null && typeof v !== "object") v = vehicleById(state, v);
  if (v) return /** @type {Vehicle} */ (v);
  if (vehicle === "bike") return { type: "bike", count: Math.max(1, n), condition: 100, fuel: 0 };
  return vehicle ? { type: "truck", fuel: 0, condition: 100 } : null;
}
// Food and water for travelling `hours` (rideHours of them in the vehicle) and resting `rest` hours (load.js).
export const rationsFor = (pace, hours, rideHours, rest, n) => (pace.eatMove * rideHours + pace.eatFoot * (hours - rideHours) + n * rest) / 24;
// Water for stretches of a trip, one after the other from startHour: segs = [[hours, rations a day], ...]. Each hour
// is drunk at that day's thirst (weather.js thirstFactor: the season, a hot day), the hour after the clock moves on,
// as consume does. With no season or heat it equals the food rations.
/** @param {State} state @param {number} startHour */
export function waterForHours(state, startHour, segs) {
  let h = startHour, w = 0;
  for (const [hours, rate] of segs) for (let i = 0; i < hours; i++) { h += 1; w += (rate / 24) * thirstAt(state, h); }
  return w;
}
// Food the same way: each hour eaten at that day's cold (weather.js coldAt: ×1.1 below 0°C, ×1.2 below −8°C, as
// needs.js teamCold), except stretches by a lit camp fire (segs = [[hours, rations a day, warm], ...]: warm true).
// With no cold it equals rationsFor.
/** @param {State} state @param {number} startHour */
export function foodForHours(state, startHour, segs) {
  let h = startHour, f = 0;
  for (const [hours, rate, warm] of segs) for (let i = 0; i < hours; i++) { h += 1; f += (rate / 24) * (warm ? 1 : coldAt(state, h)); }
  return f;
}

// fuel: what the vehicle can burn (tank + cans); leave it out to assume enough. supplies: what the team packs (its
// load sets its pace and rations, load.js); v: the vehicle (object or id) when there is one.
/** @param {State} state */
export function estimateTrip(state, { memberIds, dest, vehicle, stance, homeBaseId, fuel, supplies = {}, v = null }) {
  const home = baseById(state, homeBaseId || (hub(state) || {}).id);
  if (!home) return null; // no base left (conquest.js exiles)
  const members = (memberIds || []).map((id) => survivorById(state, id)).filter(Boolean);
  const veh = plannedVehicle(state, vehicle, v, members.length || (memberIds || []).length);
  const mode = travelMode(veh);
  const out = planPath(state, home.tile, dest, mode);
  if (!out) return null;
  const pace = plannedPace(state, { members, supplies: packedSupplies(state, home, supplies), v: veh, stance }); // days of food weighed as packed
  const po = { speed: pace.speed, footSpeed: pace.footSpeed, fuelMult: pace.fuelMult, offroad: pace.offroad || 1, onroad: pace.onroad || 1 };
  // It sets off this minute: the part of the hour already gone is not travelled (wayOn; 0 headless).
  const start = -clockFrac(state) * pace.speed;
  const go = travelHours(state, out.path, { vehicle: mode, ...po, progress: start, fuel: mode === true ? fuel ?? Infinity : 0 });
  // The way back is planned from the destination, like startReturn does (on foot if the tank ran dry).
  const backPlan = planPath(state, dest, home.tile, go.vehicle) || planPath(state, dest, home.tile, false);
  const backMode = go.vehicle && planPath(state, dest, home.tile, go.vehicle) ? go.vehicle : false;
  const backOpts = { vehicle: backMode, ...po, speed: backMode ? pace.speed : pace.footSpeed, fuel: go.fuelLeft, startHour: state.hour + go.hours + 6 };
  const back = backPlan ? travelHours(state, backPlan.path, backOpts) : { hours: go.hours, rideHours: go.rideHours };
  const hoursOut = go.hours;
  const hoursBack = back.hours;
  const hours = hoursOut + hoursBack + 6; // out, back, plus time on site
  const n = memberIds.length;
  // Hours the weather adds (or, rarely, saves) against the same trip in fair weather: shown by the planner.
  const fairOut = travelHours(state, out.path, { vehicle: mode, ...po, progress: start, fuel: mode === true ? fuel ?? Infinity : 0, weather: false }).hours;
  const fairBack = backPlan ? travelHours(state, backPlan.path, { ...backOpts, weather: false }).hours : fairOut;
  // Rations: more on the move while loaded (load.js), the 6 hours on site at the plain rate; hour by hour (riding
  // first, then on foot if the tank runs dry; 6 hours on site), each at its day's cold (no camp fire on such a trip,
  // needs.js teamCold), as the team will eat it.
  const segs = members.length ? [[go.rideHours, pace.eatMove], [hoursOut - go.rideHours, pace.eatFoot], [6, n], [back.rideHours, pace.eatMove], [hoursBack - back.rideHours, pace.eatFoot]] : [[hours, n]];
  const fsegs = members.length ? [[go.rideHours, pace.foodMove], [hoursOut - go.rideHours, pace.foodFoot], [6, pace.foodRest], [back.rideHours, pace.foodMove], [hoursBack - back.rideHours, pace.foodFoot]] : segs;
  const eat = foodForHours(state, state.hour, fsegs);
  // Water: the same rations hour by hour, each at its day's thirst (summer, a heat wave), as the team will drink it.
  const drink = waterForHours(state, state.hour, segs);
  return {
    path: out.path,
    cartWearOut: mode ? 0 : cartRouteWear(state, out.path), cartWearBack: backMode || !backPlan ? 0 : cartRouteWear(state, backPlan.path), // carts.js: what the way wears a cart pushed on foot
    hoursOut, hoursBack, hours, noWayBack: !backPlan,
    exactOut: go.exact, // to the minute it gets there (arrivalsDue): the planner and the log say this, less the minutes gone // noWayBack: the team could get there but not home (the autopilot never sends one)
    weatherOut: hoursOut - fairOut, weatherBack: hoursBack - fairBack,
    arriveHour: state.hour + hoursOut, // the hour that ticks as it gets there
    arriveAt: state.hour + go.exact, // the clock time it gets there, to the minute (arrivalsDue)
    dryAt: go.dryAt,
    days: hours / 24,
    food: Math.ceil(eat - 1e-9),
    water: Math.ceil(drink - 1e-9), waterExact: drink,
    fuel: mode === true ? Math.ceil(fuelForPath(state, out.path, pace.fuelMult) * 2 - 1e-9) : 0,
    fuelOut: mode === true ? fuelForPath(state, out.path, pace.fuelMult) : 0,
    fuelMult: pace.fuelMult,
    tiles: out.path.length - 1,
    pace, load: pace.load, mode,
  };
}

// ---------- launching player expeditions ----------
// Missions after which the team waits at the destination (or stays for good): no way back is planned.
export const STAY_MISSIONS = ["move", "recon", "outpost", "occupy"];
// Missions after which the team lives at the base it founded or moved into: no plan after them (the planner, trips.js).
export const SETTLE_MISSIONS = ["outpost", "occupy"];
// Scrap an outpost camp needs carried to set it up. Since camps are bases (2026-10-09, "setting up a plain camp should
// be quick and cheap"): nothing; the step up takes the materials (outpost_up, 10 scrap less on ruins: buildings.js
// tierUpJobFor), brought in as it goes.
/** @param {State} state @param {number} tile */
export const outpostScrap = (state, tile) => 0;
// What a team should carry to pitch a camp and have it established without another trip: { scrap, parts }.
/** @param {State} state @param {number} tile */
export const outpostKit = (state, tile) => ({ ...BUILDINGS.outpost_up.cost, scrap: Math.max(0, (BUILDINGS.outpost_up.cost.scrap || 0) - (state.tiles[tile] && state.tiles[tile].ruin ? CAMP.ruinScrap : 0)) });
// Hours of work to set up a camp once the team is there (Set up camp, Establish base, Build outpost): the team works
// on it (orders.js task "pitch"), then the camp stands (staging.js pitchArrive).
export const PITCH_HOURS = 1; // = buildings.js CAMP.setupHours (a literal: the modules import each other)

// Why a mission cannot be sent to a tile, from what is fixed or known about it (null = fine). The planner offers
// every mission for any tile, so the sim checks too; what can change on the way is checked again on arrival.
/** @param {State} state @param {number} tile @param {string} mission */
export function missionProblem(state, tile, mission) {
  const t = state.tiles[tile];
  if (!t) return "There is no such tile.";
  if (!MISSIONS[mission]) return "Unknown mission.";
  const theirs = state.factions.find((f) => f.alive && f.known && f.bases.includes(tile));
  if (mission === "outpost") {
    if (t.terrain === "water" && !t.bridge) return "An outpost cannot be built on open water. A bridge can be barricaded with one.";
    if (state.bases.some((b) => b.tile === tile)) return "You already have a base there.";
    if (theirs) return `${theirs.name} holds that place.`;
  }
  if (mission === "camp" || mission === "establish") { // a camp (staging.js campProblem: checked again on arrival)
    if ((t.terrain === "water" && !t.bridge) || t.hive) return t.hive ? "Not on a hive." : "A camp cannot go on open water.";
    if (state.bases.some((b) => b.tile === tile)) return "You already have a base there.";
    if (theirs) return `${theirs.name} holds that place.`;
  }
  if (mission === "scavenge" && t.terrain === "water" && !t.bridge) return "There is nothing to search on the water.";
  if (mission === "assault" && !state.factions.some((f) => f.alive && f.bases.includes(tile))) return "No group holds that place.";
  if (mission === "occupy") return occupyProblem(state, tile) || null; // occupy.js
  return null;
}

// opts.fromBaseId: the base the team leaves from and comes home to (default the hub; moveout.js sends a team out
// of a crowded outpost); its people, vehicles, stores and armory are the ones used. opts.quiet: no "left for" line
// (the caller says it its own way).
/** @param {State} state */
export function launchExpedition(state, opts) {
  const { dest, mission, stance } = opts;
  const memberIds = [...new Set(opts.memberIds || [])];
  const vehicleId = opts.vehicleId || null;
  const home = opts.fromBaseId != null ? baseById(state, opts.fromBaseId) : hub(state);
  if (!home) return { error: opts.fromBaseId != null ? "That base is no longer yours." : "You have no base to send a team from." };
  const at = home.type === "hub" ? "the hub" : home.name; // "Not enough water at the hub."
  // Every supply key is present and a plain number (no missing keys, NaN or negative amounts later on).
  /** @type {Stock} */
  const supplies = {};
  for (const k of Object.keys(SUPPLIES)) if (!FOODS[k]) supplies[k] = 0;
  for (const [k, q] of Object.entries(opts.supplies || {})) if (SUPPLIES[k] && Number.isFinite(q) && q > 0) supplies[k] = q;
  // Food asked for in days ("food": N, the planners and the autopilot) is packed as items (foods.js packPick: by
  // default what keeps longest and weighs least a kcal; opts.packFood: an item to take first).
  // The crew's own packs (eating.js: everyone carries about a day and a half of food and water) count toward what was
  // asked for: the base packs that much less, so the team carries and weighs what it did. They eat the shared supplies
  // first and their packs after (needs.js teamNeedsHour).
  const crew0 = memberIds.map((id) => survivorById(state, id)).filter((m) => m && m.alive && m.location && m.location.kind === "base" && m.location.baseId === home.id);
  const packDays = crew0.reduce((a, m) => a + packFood(m), 0), packW = crew0.reduce((a, m) => a + personWater(m), 0);
  const foodDays = Math.max(0, (Number(opts.supplies && opts.supplies.food) || 0) - packDays);
  if (supplies.water > 0 && packW > 0) supplies.water = Math.max(0, supplies.water - Math.floor(packW + 1e-9));
  if (foodDays > 0) for (const [k, q] of Object.entries(packFoodPick(state, home, foodDays, opts))) supplies[k] = (supplies[k] || 0) + q;
  if (!memberIds.length) return { error: "Pick at least one survivor." };
  // The crew: alive, at the hub, and not already on a team, a trade route or held somewhere.
  const members = [];
  for (const id of memberIds) {
    const m = survivorById(state, id);
    if (!m) return { error: "Someone on the crew list does not exist." };
    if (!m.alive) return { error: `${m.name} is ${m.left ? "gone" : "dead"}.` };
    if (!m.location || m.location.kind !== "base" || m.location.baseId !== home.id) return { error: `${m.name} is not at ${home.name}.` };
    members.push(m);
  }
  if (!STANCES[stance]) return { error: "Unknown stance." };
  const why = missionProblem(state, dest, mission);
  if (why) return { error: why };
  // Several vehicles (opts.vehicleIds, up to MAX_VEHICLES: teamform.js): each at the base and running; the base's bikes
  // as one entry, a bike for each person not driving a car (vehicles.js fleets).
  const fleetIds = [...new Set(opts.vehicleIds || [])];
  /** @type {any} */
  let fleet = null;
  let bikeN = 0;
  if (fleetIds.length > 1) {
    if (fleetIds.length > MAX_VEHICLES) return { error: `At most ${MAX_VEHICLES} vehicles to a team.` };
    const list = fleetIds.map((id) => vehicleById(state, id));
    for (const x of list) {
      if (!x || x.loc.kind !== "base" || x.loc.baseId !== home.id) return { error: `That vehicle is not at ${at}.` };
      if (x.condition <= 0) return { error: `The ${vehicleLabel(x)} needs repairs first.` };
    }
    const cars = list.filter((x) => !isBike(x));
    if (list.some(isBike)) {
      bikeN = Math.max(1, members.length - cars.length);
      const have = state.vehicles.filter((x) => isBike(x) && x.loc.kind === "base" && x.loc.baseId === home.id).reduce((a, x) => a + (x.count || 1), 0);
      if (have < bikeN) return { error: `Not enough bikes: ${bikeN} needed, ${have} at ${at}.` };
    }
    const plannedList = list.filter((x) => !isBike(x) || x === list.find(isBike)).map((x) => (isBike(x) ? { ...x, count: bikeN } : x));
    const fp = fleetProblem(plannedList, members.length);
    if (fp) return { error: fp };
    fleet = { cars, bikes: list.find(isBike) || null, planned: fleetOf(plannedList) };
  }
  let v = fleet ? fleet.planned : vehicleId ? vehicleById(state, vehicleId) : null;
  if (!fleet && vehicleId && (!v || v.loc.kind !== "base" || v.loc.baseId !== home.id)) return { error: `That vehicle is not at ${at}.` };
  if (!fleet && v && v.condition <= 0) return { error: "That vehicle needs repairs first." };
  // Bikes: one each, taken from the hub's bikes (vehicles.js takeBikes).
  const bikes = !fleet && isBike(v);
  if (bikes) {
    const have = state.vehicles.filter((x) => isBike(x) && x.loc.kind === "base" && x.loc.baseId === home.id).reduce((a, x) => a + (x.count || 1), 0);
    if (have < members.length) return { error: `Not enough bikes: ${members.length} people, ${have} bike${have === 1 ? "" : "s"} at ${at} (one each).` };
  }
  const plannedV = bikes ? { ...v, count: members.length } : v;
  // Lights (lights.js): a light each from the armory, before the estimate so the pace counts their weight; put back if
  // the launch fails after all.
  const lightItems = [];
  const lights = opts.lights ? packLights(home, members, lightItems) : [];
  const fail = (error) => { unpackLights(home, members, lightItems); return { error }; };
  const est = estimateTrip(state, { memberIds, dest, vehicle: travelMode(v), stance, homeBaseId: home.id, fuel: v ? v.fuel + (supplies.fuel || 0) : 0, supplies, v: plannedV });
  if (!est) return fail(v ? (bikes ? "No route by bike (water in the way)." : "No route for a vehicle (mountains or water). Try on foot.") : "No route to that tile.");
  // Water: purified and un-purified together (water.js), purified packed first.
  // "ammo": rounds of any calibre (packed below as the rounds that fit the crew's guns: ammo.js packRounds).
  const stockFor = (k) => (k === "water" ? waterIn(home.stock) - Math.max(0, supplies[RAW] || 0) : k === "ammo" ? totalRounds(home.stock) - GENERIC_KEYS.reduce((a, x) => a + (supplies[x] || 0), 0) : home.stock[k] || 0);
  for (const [k, val] of Object.entries(supplies)) if (stockFor(k) < val) return fail(`Not enough ${k === "water" ? "water" : SUPPLIES[k].name.toLowerCase()} at ${at}.`);
  // Packed supplies have to be carried: what the people can carry on top of what they wear (load.js), plus the bikes'
  // racks or the car.
  const cap = carryCapacity(state, members, plannedV);
  const load = supplyLoad(supplies);
  if (load > cap + 1e-9) {
    return fail(`Too much to carry: the packed supplies weigh ${Math.ceil(load)} kg, the crew${v ? ` and the ${vehicleLabel(plannedV)}` : ""} can carry ${Math.floor(cap)} kg more than they wear. Pack less${v ? "" : ", or take more people, bikes or a vehicle"}.`);
  }
  // Spare car parts for a long drive (vehicles.js carSpares): packed with the rest, home again if unused.
  const spares = opts.spares && isCar(v) ? carSpares(state.grid.distance(home.tile, dest), (home.stock.carparts || 0) - supplies.carparts, supplies.carparts, cap - load) : 0;
  if (spares) supplies.carparts += spares;
  if (bikes) v = takeBikes(state, home, members.length);
  if (fleet) fleet.real = [...fleet.cars, ...(fleet.bikes ? [takeBikes(state, home, bikeN)] : [])];
  const packed = { ...supplies };
  const foodReq = Object.fromEntries(Object.entries(supplies).filter(([k, q]) => FOODS[k] && q > 0)); // moved with its lots below
  for (const [k, val] of Object.entries(supplies)) {
    if (k === "ammo") continue; // last: what is asked for by key first
    if (FOODS[k]) { packed[k] = 0; continue; } // food goes with its lots (shelf left) once the team exists
    if (k !== "water") { home.stock[k] = (home.stock[k] || 0) - val; continue; }
    const d = drawWater(home.stock, val); // purified first, then un-purified (water.js)
    packed.water = d.pure;
    if (d.raw > 0) packed[RAW] = (packed[RAW] || 0) + d.raw;
  }
  if (supplies.ammo > 0) { packed.ammo = 0; addRecord(packed, packRounds(home.stock, members, supplies.ammo)); } // ammo.js: the rounds that fit each one's gun
  addRecord(packed, packLauncherRounds(home.stock, members, Math.max(0, cap - load))); // launchers.js: 40 mm and rockets for the launchers they carry, as far as they can carry
  Object.assign(supplies, packed);
  const stays = STAY_MISSIONS.includes(mission);
  /** @type {Party} */
  const p = {
    id: newId(), owner: "player", kind: "expedition", mission, teamMission: mission, dest, homeBaseId: home.id,
    members: [...memberIds], stance, vehicle: travelMode(v), vehicleId: v ? v.id : null, supplies,
    cargo: { supplies: {}, gear: [] },
    path: est.path, idx: 0, progress: 0, phase: "out",
    seen: new Map(), spotted: new Map(), sightNow: [], radioLive: false,
    departed: state.hour, plannedHours: est.hours, eventsSeen: 0,
    orders: [], orderStart: state.hour, // queued orders (orders.js) and when the current one began
    ...(mission === "sweep" ? { sweepPlan: sweepOpts(opts.sweep || {}) } : {}), // the Survey mission's radius and hours (survey.js)
    // What the hub knows of the plan, for the estimated "?" position while out of contact (plannedTile).
    // etaBack null: a one-way trip (the team arrives and waits there, or stays for good).
    planPath: [...est.path], planStart: state.hour, planVehicle: travelMode(v), planFuel: isCar(v) ? v.fuel + (supplies.fuel || 0) : 0, etaOut: est.hoursOut, etaBack: stays ? null : est.hoursBack,
  };
  if (fleet) { setPartyVehicles(state, p, fleet.real); v = fleetOf(fleet.real); }
  else if (v) { v.loc = { kind: "party", partyId: p.id }; p.vehicleIds = [v.id]; }
  else p.vehicleIds = [];
  for (const m of members) m.location = { kind: "party", partyId: p.id };
  state.parties.push(p);
  moveFood(home, p, foodReq, { state }); // foods.js: the lots go with it (what they have left of their shelf)
  packMags(home.armory, members); // carrykit.js: spare magazines for their guns from the armory (rig pouches, pockets, then the pack)
  // Generic rounds packed from a stock not yet settled (packRounds takes them along as they are) settle in the team
  // first (ammo.js settleParty, as the hour's settleAll would): packShells reads the shells by their keys, so before
  // this a team packed from generic ammo left with every shell in its bags and none at hand.
  settleParty(state, p);
  if (opts.shells !== false) packShells(p.supplies, members); // carrykit.js: each gun's loose rounds at hand (looseWant: a pocket or a rig pouch) out of the packed rounds, so it reloads without digging in the pack
  packWater(state, p, home); // worm.js: the un-purified water packed carries the eggs of the base's
  if (opts.tabs) packTablets(state, home, p); // worm.js: a tube of purification tablets for the road (when the armory has one)
  // An assault takes the hub's siege kit along (kit.js packSiegeKit: the ram, ladders, grenades into the cargo, as
  // much as the crew can carry on top of its supplies; opts.siegeKit false: none).
  const siegeKit = mission === "assault" && opts.siegeKit !== false ? packSiegeKit(home, p.cargo, members, Math.max(0, cap - load)) : [];
  weighTeam(state, p); // its pace, rations and fuel for the trip (load.js): the same numbers as the estimate
  // Set off this minute: the part of the hour already gone on the clock is not travelled (estimateTrip did the same).
  if (clockFrac(state) > 0) p.progress = p.planProgress = -clockFrac(state) * partySpeed(p);
  // A plan from the planner (plans.js): the steps after the target become the order queue.
  if (opts.plan) applyPlan(state, p, opts.plan);
  const days = Math.ceil((opts.plan ? p.plannedHours : est.hours) / 24);
  const planHome = opts.plan && p.orders.some((o) => o.type === "home");
  const waits = opts.plan ? !planHome : stays;
  const after = mission === "outpost" ? ` The team sets up an outpost camp and stays as its first staff${v ? `, and the ${v.name} stays there` : ""}.` :
    mission === "occupy" ? ` It clears out whoever is inside and moves in as its first staff${v ? `, the ${v.name} with it` : ""}.` :
    opts.plan ? ` Plan: ${p.plan.name}${p.orders.length ? ` (${queueText(state, p)})` : ""}.${waits ? " Then it waits for orders." : ""}` : stays ? " The team waits there for orders." : "";
  if (lights.length) log(state, `${teamName(state, p)} takes lights from the armory: ${lights.join(", ")}.`, "info");
  if (spares) log(state, `${teamName(state, p)} packs ${spares} spare car part${spares === 1 ? "" : "s"} for the road (a breakdown on the way: a quick fix).`, "info");
  if (siegeKit.length) log(state, `The assault team takes siege kit from the armory: ${siegeKit.join(", ")}.`, "info");
  if (!opts.quiet) log(state, `${teamName(state, p)} left for ${tileLabel(state, dest)}${bikes ? " on bikes" : v ? ` in the ${v.name}` : " on foot"}. Arrives in about ${clockText(est.exactOut - clockFrac(state))}${waits ? "" : `; back in about ${days} day${days === 1 ? "" : "s"}`}.${after}`, "info");
  return { party: p };
}

/** @param {State} state @param {Party} raidParty @param {Faction} target */
export function sendHelpSquad(state, raidParty, target) {
  const h = hub(state);
  const fighters = atBase(state, h.id).sort((a, b) => combatPower(b) - combatPower(a)).slice(0, 3);
  if (!fighters.length) return "Nobody at the hub can go.";
  // Two days of food and water each (a short, rushed trip), within what the squad can carry.
  const n = fighters.length;
  const have = (k) => Math.max(0, Math.floor(stockHas(h.stock, k))); // water: both kinds (water.js)
  const supplies = { food: Math.min(have("food"), 2 * n), water: Math.min(Math.floor(waterIn(h.stock)), Math.ceil(2 * n * thirstAhead(state, 2))), meds: Math.min(have("meds"), Math.min(2, n)), ammo: Math.min(have("ammo"), 10 * n) };
  const archers = archerCount(fighters); // the bows' arrows (world.js ARROWS.PACK a bow)
  if (archers) supplies.arrows = Math.min(have("arrows"), archers * ARROWS.PACK);
  const res = launchExpedition(state, { memberIds: fighters.map((s) => s.id), dest: raidParty.target.tile, mission: "help", stance: "rushed", supplies });
  if (res.error) return res.error;
  res.party.helpFor = raidParty.id;
  res.party.helpFaction = target.id;
  target.lastDiplomacy = day(state);
  return `${fighters.map((s) => s.name.split(" ")[0]).join(", ")} set out to help ${target.name}.`;
}

// ---------- AI parties ----------
/** @param {State} state @param {Faction} f @param {string} kind @param {number} fromTile @param {number} toTile */
export const AI_PARTY_MEDS = { SHARE: 0.5, PER: 0.5 };
export function spawnAiParty(state, f, kind, fromTile, toTile, opts) {
  const vehicle = kind === "convoy" || !!opts.vehicle; // opts.vehicle: a scavenging party that drives out (aiscav.js)
  let res = planPath(state, fromTile, toTile, vehicle, f.id); // a bridge barricaded by someone else is closed to them (bridgeClosedTo)
  let usesVehicle = vehicle && !!res;
  if (!res) res = planPath(state, fromTile, toTile, false, f.id);
  if (!res) return null;
  const p = {
    id: newId(), owner: f.id, kind, path: res.path, idx: 0, progress: 0, vehicle: usesVehicle,
    strength: opts.strength, target: opts.target || null, targetFaction: opts.targetFaction || null,
    phase: "out", warned: false,
  };
  // AI parity (eating.js): the party carries PACK.food days of the group's food a head (its heads by strength) and eats
  // it on the road (factions.js); what is left comes home (removeParty).
  if (f.stock && foodIn(f.stock) > 0) {
    const heads = aiPartyHeads(f, opts.strength, ((FACTION_TYPES[f.type] && FACTION_TYPES[f.type].arms) || 1) * (f.gear || 1));
    const got = takeFood(f.stock, Math.min(foodIn(f.stock), heads * PACK.food), { eggs: false, state });
    if (got.units > 0) { p.rations = got.items; p.heads = heads; }
  }
  // Meds for the road, as your team packs them (docs/adr/0001-ai-parity.md): up to one for every other head, at most
  // AI_PARTY_MEDS.SHARE of the stores (what is left comes home, removeParty). Spent in a fight by their AI (combat.js aiMeds).
  if (f.stock && (f.stock.meds || 0) >= 1 && kind !== "convoy") {
    const heads = p.heads || aiPartyHeads(f, opts.strength, ((FACTION_TYPES[f.type] && FACTION_TYPES[f.type].arms) || 1) * (f.gear || 1));
    const m = Math.min(Math.floor(f.stock.meds * AI_PARTY_MEDS.SHARE), Math.ceil(heads * AI_PARTY_MEDS.PER));
    if (m >= 1) { f.stock.meds -= m; p.meds = m; }
  }
  state.parties.push(p);
  if (!f.outsider) kitParty(state, f, sendMembers(state, f, p, p.heads || aiPartyHeads(f, opts.strength, ((FACTION_TYPES[f.type] && FACTION_TYPES[f.type].arms) || 1) * (f.gear || 1))), kind, p); // members.js: the people who go, with what they carry
  if (kind === "raid" && f.vehicles) assignRaidHumvee(state, f, p); // vehicles.js: a group's turreted Humvee comes along (lost if the raid fails)
  return p;
}

// ---------- hourly movement ----------
/** @param {State} state */
export function movePartiesHour(state) {
  for (const p of [...state.parties]) {
    if (!state.parties.includes(p)) continue;
    if (p.owner === "player") { playerPartyHour(state, p); repairWaitHour(state, p); } // repairwait.js: a breakdown's repair done, the team moving on
    else aiPartyHour(state, p);
  }
  convoysHour(state); // miltrucks.js: the abandoned Army convoys (before crashesHour: their salvage parties are its own)
  crashesHour(state); // crashes.js: crash sites (new ones, the search, the race, burning out)
  breakdownsHour(state); // breakdowns.js: repair work at the bases, attack damage
  pruneCards(state);
}

// A player team with no living members is always wiped the same way (wipeParty): what it carried stays at a
// death site and the vehicle is left there, marked on the map. Called after any loss of a member, when a team
// reports in or arrives, and every hour for every team as a safety net. Returns true if the team is gone.
/** @param {State} state @param {Party} p */
export function wipeIfEmpty(state, p) {
  if (!p || !state.parties.includes(p)) return true;
  if (p.owner !== "player" || partyMembers(state, p).length) return false;
  wipeParty(state, p);
  return true;
}

// Cards about a team that no longer exists, or about someone who has died or left that team, are out of date.
/** @param {State} state @param {Card} card */
export function cardStale(state, card) {
  if (!card || card.partyId == null) return false;
  const p = state.parties.find((q) => q.id === card.partyId);
  if (!p) return true;
  if (p.owner === "player" && !partyMembers(state, p).length) return true;
  // A card about the team's vehicle (a breakdown) after the vehicle was left behind: a fast vehicle enters
  // several tiles in an hour, and can run dry on a later one in the same hour the breakdown came up.
  if (card.vehicleId != null && !partyVehicleIds(p).includes(card.vehicleId)) return true; // any of its vehicles (vehicles.js fleets)
  return (card.survivorIds || []).some((id) => {
    const s = survivorById(state, id);
    return !s || !s.alive || !p.members.includes(id);
  });
}

// Drops out-of-date cards. Runs every hour, when a team is removed, and after a card is answered (main.js,
// autopilot.js), so a stale card never reaches the front of the queue.
/** @param {State} state */
export function pruneCards(state) {
  for (let i = state.cards.length - 1; i >= 0; i--) if (cardStale(state, state.cards[i])) state.cards.splice(i, 1);
}

// hour: the hour this step is taken in (the weather of that hour sets the cost); null = fair weather.
// known: estimates count only the weather fronts on the map by then (travelHours); the real step, all of them.
// p: a team, or travelHours' stand-in for one (its path, place on it and way of travel).
/** @param {State} state @param {Pick<Party, "path" | "idx" | "progress" | "vehicle"> & Partial<Party>} p @param {number} speed @param {number | null} [hour] @param {number} [known] */
function stepAlong(state, p, speed, hour = state.hour, known = Infinity) {
  if (p.idx >= p.path.length - 1) return [];
  p.progress += speed;
  const entered = [];
  while (p.idx < p.path.length - 1) {
    const from = p.path[p.idx], to = p.path[p.idx + 1];
    const cost = stepCost(state, p, p.idx, hour, known);
    if (!isFinite(cost)) {
      p.path = p.path.slice(0, p.idx + 1);
      if (p.owner === "player" && p.phase === "out" && state.tiles[to].bridge) p.bridgeStop = to; // told on arrival (arrive)
      break;
    }
    if (p.progress < cost) break;
    p.progress -= cost;
    p.idx += 1;
    entered.push(p.path[p.idx]);
  }
  return entered;
}

// The cost of the step from p.path[i] to the next tile, in the hour it is taken (stepAlong). A bridge barricaded
// since the way was planned stops the team at its foot (bridgeClosedTo); the last tile of the way is the destination
// itself and is never closed.
/** @param {State} state @param {Pick<Party, "path" | "vehicle"> & Partial<Party>} p @param {number} i @param {number | null} [hour] @param {number} [known] */
function stepCost(state, p, i, hour = state.hour, known = Infinity) {
  const from = p.path[i], to = p.path[i + 1];
  return moveCost(state, from, to, stepMode(p), i + 1 === p.path.length - 1 ? undefined : p.owner, hour ?? state.hour) * (hour == null ? 1 : travelFactor(state, { vehicle: stepMode(p), tileId: to, from, hour, known })) * offroadStep(state, p, from, to); // stepMode: walkers set the pace (walkers.js)
}

// A road blockage met entering p.path[i + 1] (roadblocks.js): the progress it costs, or 0. The same roll as
// onEnterTile's (a vehicle on a road), so the map's glide holds the team up where the hour will.
/** @param {State} state @param {Party} p @param {number} i @param {number} hour */
function blockDelay(state, p, i, hour) {
  if (!p.vehicle || !state.tiles[p.path[i]].roadLinks.includes(p.path[i + 1])) return 0;
  const b = rollRoadblock(state, p, p.path[i + 1], hour);
  return b ? (b.mins / 60) * partySpeed(p) : 0;
}

/** @param {Party} p */
export const partyTile = (p) => p.path[p.idx];

// Where a moving team is part-way through the coming hour, frac (0–1) of it gone: the map draws it gliding between
// tiles as the minutes pass (main.js). One source of truth with the sim: the hour is stepped on a copy exactly as the
// tick will step it (hourCourse: stepAlong, the road blockages of playerPartyHour, the hour's weather, a delay paid
// off first), and the team is drawn along that course. Nothing in the sim changes. Returns { from, to, t, sit }: t of
// the way from tile `from` to `to`; sit: a wait drawn on the spot ({ kind: "road" | "repair" | "delay", mins } with the
// minutes left of it), else null.
// A team whose move ends this hour arrives at the minute the glide reaches the centre of its destination (the main
// loop's arrivalsDue: the sim marks the arrival then, so it never stands there waiting for the hour to tick). A convoy
// still arrives as the hour ticks, so its glide spreads the rest of its way over the whole hour and gets there exactly
// then. A wait owed from before (a blockage, a repair, the minutes of the hour already gone when the order was given:
// wayOn) is sat out first, as the tick pays it first.
// held: the team holds this hour (a card of its waits in the tray, ui/pacing.js holdsNextHour): it does not move on,
// so it does not glide either.
/** @param {State} state @param {Party} p @param {number} frac @param {boolean} [held] */
export function glideAt(state, p, frac, held = false) {
  const at = partyTile(p);
  if (!onTheMove(p)) return { from: at, to: at, t: 0, sit: null };
  const c = hourCourse(state, p, held);
  const f = Math.max(0, Math.min(1, frac));
  const u = c.uAt(f);
  // Turning back part-way along a step (wayOn): drawn walking back to the tile it came from while it pays that walk.
  const tb = p.turn;
  if (tb && tb.path === p.path && p.idx === 0 && (p.progress || 0) < 0 && tb.d > 0) {
    const owe = -(p.progress || 0) - u;
    if (owe > 1e-9) return { from: at, to: tb.to, t: tb.f * Math.min(1, owe / tb.d), sit: null };
  }
  const { k, pos: raw } = courseAt(c, u);
  const pts = c.pts, a = pts[k - 1], b = pts[k] || a;
  const pos = eased(state, p, c, f, raw);
  // A wait: the minutes left of it on the clock (a wait the hour does not finish goes on into the next).
  let sit = null;
  if (b.sit && b.u > a.u && u >= a.u - 1e-9 && u < b.u - 1e-9) {
    const kind = b.sit === "road" || (b.sit === "owed" && p.roadblock && state.hour - p.roadblock.hour <= 4) ? "road" : p.delayWhy && p.delayWhy.kind === "repair" ? "repair" : "delay";
    const hrs = c.fracAt(b.u) - f + (k === pts.length - 1 && !c.arrive && c.owedAfter > 0 && c.speed > 0 ? c.owedAfter / c.speed : 0);
    sit = { kind, mins: Math.max(1, Math.round(hrs * 60)) };
  }
  const last = p.path.length - 1;
  if (pos >= last - 1e-9) return { from: p.path[last - 1], to: p.path[last], t: 1, sit };
  const i = Math.floor(pos + 1e-9), t = pos - i;
  if (t <= 1e-9) return i > p.idx ? { from: p.path[i - 1], to: p.path[i], t: 1, sit } : { from: at, to: p.path[p.idx + 1], t: 0, sit };
  return { from: p.path[i], to: p.path[i + 1], t, sit };
}

// Teams of yours that get where they are going part-way through the coming hour arrive at that minute, not when the
// hour ticks: the main loop calls this every frame with the minutes gone (frac, main.js), so a team stops on the centre
// of its destination as the glide gets it there, and is waiting (or at work, or home) from then on. The hour's move is
// the one the tick would make (moveHour, the same course as hourCourse and glideAt), stepped now; the tick then leaves
// the team's move alone (p.movedHour) unless a new order sets it off again. Not for a team held by a card in the tray
// (held). Convoys likewise. The headless tools never call it: their teams arrive as the hour ticks, as before.
/** @param {State} state @param {number} frac @param {(p: Party) => boolean} [held] */
export function arrivalsDue(state, frac, held = () => false) {
  let any = false;
  for (const p of [...state.parties]) {
    if (!state.parties.includes(p) || !arrivesOnTime(p) || held(p)) continue;
    // Already on the last tile of its way (wayDone: a card met there cut the move short) arrives now, moved this hour or not.
    if (!wayDone(p)) {
      if (!onTheMove(p) || p.movedHour === state.hour + 1) continue;
      const c = hourCourse(state, p);
      if (!c.arrive || frac + 1e-9 < c.arriveFrac) continue;
    }
    p.movedHour = state.hour + 1;
    moveHour(state, p, state.hour + 1);
    any = true;
  }
  // Timed jobs started part-way through an hour end at their minute too (orders.js tasksDue).
  if (tasksDue(state, frac)) any = true;
  return any;
}
// Parties that arrive at the minute (arrivalsDue): all of yours, teams and convoys.
/** @param {Party} p */
const arrivesOnTime = (p) => p.owner === "player";
// On its way out or back with no step left, but not arrived: a card on the last tile (a surge of the dead, a fight) held
// the move up after it got there, and the team carried on ("Continue") at the end of its way. The panels say "0m left"
// (hoursLeft 0); moveHour finishes it (arrive, returnHome).
/** @param {Party} p */
const wayDone = (p) => (p.phase === "out" || p.phase === "back") && Array.isArray(p.path) && p.idx >= p.path.length - 1;

// The place on a course at progress u (pos: i + the share of the step from path[i] to path[i + 1]) and the waypoint
// the stretch ends at (k).
/** @param {ReturnType<typeof hourCourse>} c @param {number} u */
function courseAt(c, u) {
  const pts = c.pts;
  let k = 1;
  while (k < pts.length - 1 && pts[k].u < u) k++;
  const a = pts[k - 1], b = pts[k] || a;
  const pos = b.u > a.u ? a.pos + (b.pos - a.pos) * Math.max(0, Math.min(1, (u - a.u) / (b.u - a.u))) : u >= b.u ? b.pos : a.pos;
  return { k, pos };
}
// The pace changed part-way through the hour (a new stance, a card answered that held the team, a load dropped): the
// tick moves the whole hour at the new pace, so the course jumps ahead or back at once. The map eases from where it
// last drew the team onto the new course by the end of the hour instead: behind it, closing the gap; ahead of it,
// waiting where it was until the course catches up. Drawing only (one note per team, the sim never reads it).
/** @type {WeakMap<object, any>} */
const GLIDE_NOTE = new WeakMap();
/** @param {State} state @param {Party} p @param {ReturnType<typeof hourCourse>} c @param {number} f @param {number} raw */
function eased(state, p, c, f, raw) {
  let m = GLIDE_NOTE.get(p);
  if (!m || m.hour !== state.hour || m.idx !== p.idx || m.path !== p.path || m.progress !== p.progress) {
    m = { hour: state.hour, idx: p.idx, path: p.path, progress: p.progress, speed: c.speed, ease: null, f, pos: raw };
    GLIDE_NOTE.set(p, m);
  } else if (Math.abs(m.speed - c.speed) > 1e-9) {
    m.speed = c.speed;
    m.ease = m.f < 1 ? { f: m.f, pos: m.pos, off: m.pos - courseAt(c, c.uAt(m.f)).pos } : null;
  }
  let pos = raw;
  const e = m.ease;
  if (e && f >= e.f && Math.abs(e.off) > 1e-9) {
    const left = (1 - f) / (1 - e.f);
    pos = e.off < 0 ? raw + e.off * left : Math.max(e.pos, raw + e.off * left);
  }
  m.f = f;
  m.pos = pos;
  return pos;
}

// The coming hour of a moving team as the tick will step it, as waypoints along its way: pts [{ u, pos, sit }] with u
// the progress spent so far this hour (0 to what is left of its pace) and pos the place on the way; sit on a waypoint:
// the stretch up to it is a wait on the spot ("owed": a delay owed from before, "road": a blockage met this hour).
// arrive: the move ends this hour (the destination, or the foot of a bridge closed since the way was planned).
// uAt(frac): the progress at that share of the hour; fracAt(u) the other way round. A part of the hour the team
// already travelled (p.hourUsed: it was stepped to the minute it was given a new way, wayOn) is not travelled again.
// owedAfter: progress still owed when the hour ends (a wait going on into the next hour).
/** @param {State} state @param {Party} p @param {boolean} [held] */
export function hourCourse(state, p, held = false) {
  const hour = state.hour + 1; // the hour being travelled (tickHour moves the clock on, then the teams)
  const rate = held || p.movedHour === hour ? 0 : Math.max(0, partySpeed(p));
  const used = hourUsed(p, hour);
  const rem = rate * (1 - used); // the progress the rest of the hour makes
  const last = p.path.length - 1;
  // The place a team holding `prog` on the step from path[i] is drawn at (its share of the step at that hour's cost):
  // the end of one hour and the start of the next agree, as the next hour's step is costed at its own hour.
  const posAt = (i, prog, h) => {
    if (i >= last) return last;
    const cost = stepCost(state, p, i, h);
    return i + (prog > 0 && cost > 0 && isFinite(cost) ? Math.min(1, prog / cost) : 0);
  };
  const prog0 = p.progress || 0;
  const start = posAt(p.idx, prog0, hour);
  /** @type {{ u: number, pos: number, sit?: string }[]} */
  const pts = [{ u: 0, pos: start }];
  const d0 = Math.max(0, -prog0); // owed: paid before it moves
  let P = prog0 + rem, i = p.idx, arrive = false;
  if (rem > 0) {
    if (d0 > 0 && d0 < rem) pts.push({ u: d0, pos: start, sit: "owed" });
    while (i < last) {
      const cost = stepCost(state, p, i, hour);
      if (!(cost > 0) || !isFinite(cost)) { arrive = true; break; } // the sim cuts the way here (stepAlong) and the move ends
      if (P < cost) break;
      P -= cost;
      i += 1;
      const uIn = rem - P; // the progress spent when it enters path[i]
      pts.push({ u: uIn, pos: i });
      if (i >= last) break;
      const bd = blockDelay(state, p, i - 1, hour); // a road blockage holds it up on the tile (playerPartyHour)
      if (bd > 0) {
        P -= bd;
        pts.push({ u: Math.min(rem, uIn + bd), pos: i, sit: "road" });
      }
    }
  }
  if (i >= last) arrive = true;
  if (!arrive && pts[pts.length - 1].u < rem) pts.push({ u: rem, pos: posAt(i, P, hour + 1), ...(P <= 0 ? { sit: pts[pts.length - 1].sit === "road" ? "road" : "owed" } : {}) });
  if (pts.length === 1) pts.push({ u: rem, pos: start });
  const uEnd = arrive ? pts[pts.length - 1].u : rem;
  const uAt = (f) => Math.max(0, Math.min(rem, (f - used) * rate));
  const fracAt = (u) => (rate <= 0 ? 1 : used + u / rate);
  // arriveFrac: the share of the hour gone when the move ends (arrivalsDue).
  return { pts, speed: rate, used, arrive, arriveFrac: arrive ? (rate > 0 ? fracAt(uEnd) : used) : 1, uAt, fracAt, owedAfter: arrive ? 0 : Math.max(0, -P) };
}
// The share of `hour` a team already travelled (moveHour stepped it part of the way: a new way given at that minute).
/** @param {Party} p @param {number} hour */
const hourUsed = (p, hour) => (p.hourUsed && p.hourUsed.hour === hour ? p.hourUsed.f : 0);

// Live intel from your teams. TEAM_INTEL_EVERYWHERE (for now): every team of yours reports what it sees as it sees it,
// wherever it is, as orders reach it anywhere (plans.js commandable). Off: only teams in radio coverage (p.radioLive)
// report live, the rest when they get home or come into range. Everything that asks "does this team's sight reach the
// map now?" goes through reportsLive; p.radioLive itself stays "in your radio coverage" (the 📻 badge, listening in).
export const TEAM_INTEL_EVERYWHERE = true;
/** @param {Party | null | undefined} p */
export const reportsLive = (p) => !!p && (!!p.radioLive || (TEAM_INTEL_EVERYWHERE && p.owner === "player" && p.kind !== "convoy"));

/** @param {State} state @param {Party} p */
function updateRadio(state, p) {
  // Hardcore before the first hub (hardcore-start.js): you are with this team, so it is always in contact.
  p.radioLive = withYou(state, p) || radioBasesInRange(state, partyTile(p), hasMilRadio(state, p) ? 4 : 0).length > 0;
  p.sightNow = reportsLive(p) ? state.grid.within(partyTile(p), sightRadius(state, p)) : [];
  if (reportsLive(p)) mergeKnowledge(state, p.seen, p.spotted, p.owner === "player" ? p : null);
  // Listening (radio.js networks): a team carrying a receiver (a hand-crank or military radio) out of two-way reach
  // hears a radio network only while it stands inside that network's coverage (a group's, or yours: nothing beyond
  // it). It does not report live (its sightings wait until it reports); orders reach it anyway (plans.js commandable). What it picks up on the channel it tuned to (Listen
  // in, radiolisten.js) goes to p.heard each day.
  if (p.owner !== "player" || p.kind === "convoy") return;
  p.radioHear = !p.radioLive && teamReceives(state, p) && networksAt(state, partyTile(p)).length > 0;
}

// A team that lost people (dead, captured, gone home) may hold more found cargo than those left can carry:
// the excess stays on the tile, at the death site there (or as a cargo cache), and the team knows where.
/** @param {State} state @param {Party} p */
function shedOverload(state, p) {
  if (p.kind === "convoy" || poolLoad(p) <= partyCapacity(state, p) + 1e-9) return;
  const tile = partyTile(p);
  const drop = trimCargo(state, p);
  if (!drop.text) return;
  const base = state.bases.find((b) => b.tile === tile);
  if (base) {
    addStock(base, drop.supplies);
    base.armory.push(...drop.gear);
  } else {
    let site = state.deathSites.find((d) => d.tile === tile);
    if (!site) {
      site = { id: newId(), tile, items: [], day: day(state), names: [], lastConfirmed: day(state) };
      state.deathSites.push(site);
    }
    for (const [k, q] of Object.entries(drop.supplies)) {
      const cur = site.items.find((i) => i.kind === "supply" && i.key === k);
      if (cur) { cur.qty += q; cur.value = cur.qty * supValue(k); }
      else site.items.push({ kind: "supply", key: k, name: SUPPLIES[k].name, qty: q, value: q * supValue(k) });
    }
    for (const g of drop.gear) site.items.push({ kind: "gear", key: g.key, name: g.name, qty: 1, value: (GEAR[g.key]?.value || 0) * (g.quality || 1), item: g });
    spot(p, { key: `death:${tile}`, type: "death", tile, hour: state.hour, label: deathLabel(site), info: { items: site.items.length } });
  }
  log(state, `${teamName(state, p)} can no longer carry everything: ${drop.text} left ${base ? `at ${base.name}` : `behind near ${tileLabel(state, tile)}`}.`, "danger");
}

/** @param {State} state @param {Party} p */
function playerPartyHour(state, p) {
  // Hourly sweep: however the last member was lost, the team ends as a wiped team (never silently deleted).
  if (wipeIfEmpty(state, p)) return;
  shedOverload(state, p);
  shedSurplusVehicles(state, p); // walkers.js: no vehicle goes on with nobody to drive or ride it
  reseat(state, p); // walkers.js: a seat for the walkers again when one turned up
  const members = partyMembers(state, p);
  // A supply convoy parked at one of your bases eats from that base (handled daily in supply.js).
  if (p.phase === "holding") {
    p.noFood = p.noWater = false;
    updateRadio(state, p);
    return;
  }
  reweigh(state, p); // load.js: weighed again when it stops, or when it got heavier
  consume(state, p, members);
  if (!state.parties.includes(p)) return;
  gameSpoilHour(state, p); // hunting.js: fresh game in the cargo spoils by the temperature
  wormTeamHour(state, p, members); // worm.js: a camp fire boils water and cooks game; camping on infested land
  // Heat from staying put, the plan's conditions and finds, check-ins out of contact (plans.js, fieldheat.js).
  fieldHour(state, p);
  if (!state.parties.includes(p)) return;
  if (p.phase === "engaged" || p.phase === "helping" || p.phase === "waiting") {
    updateRadio(state, p);
    return;
  }
  // Timed work on the spot (camp, look around, field repair, treatment): see orders.js.
  if (p.phase === "task") {
    taskHour(state, p);
    if (state.parties.includes(p)) updateRadio(state, p);
    return;
  }
  // Moved this hour already: it got where it was going part-way through the hour (arrivalsDue). Still out at the end of
  // its way (wayDone: a card there held it up), it arrives now: moveHour has nothing left to travel.
  if (p.movedHour === state.hour && !wayDone(p)) {
    updateRadio(state, p);
    return;
  }
  // Night falls on the road (nightmarch.js): make camp until dawn or push through the night (asked once a night).
  if (nightFalls(state, p)) {
    if (state.parties.includes(p)) updateRadio(state, p);
    return;
  }
  moveHour(state, p, state.hour);
}

// A team's hour on the move: the tiles it enters (stepAlong), what it meets on them, the road's hazards, and its
// arrival. hour: the hour travelled (state.hour at the tick; the coming hour when it arrives part-way through it,
// arrivalsDue).
// upTo: step it only to that share of the hour (a new way given at that minute: stepToNow); what it already
// travelled of the hour (p.hourUsed) is not travelled again.
/** @param {State} state @param {Party} p @param {number} hour @param {number} [upTo] */
function moveHour(state, p, hour, upTo = 1) {
  const from = hourUsed(p, hour);
  if (upTo < 1) p.hourUsed = { hour, f: upTo };
  else delete p.hourUsed;
  const pace = partySpeed(p) * Math.max(0, upTo - from), rolling = p.idx < p.path.length - 1;
  let entered = stepAlong(state, p, pace, hour);
  if (rolling) repairPaid(p, pace, entered.length > 0); // repairwait.js: an hour on the road pays off a breakdown repair's wait
  for (let k = 0; k < entered.length; k++) {
    const tileId = entered[k], block = p.roadblock;
    if (!p.vehicle && p.owner === "player" && cartWearStep(state, p, k ? entered[k - 1] : p.path[p.path.lastIndexOf(tileId, p.idx) - 1], tileId)) weighTeam(state, p); // carts.js: rough ground wears a cart's wheels (a broken one drags)
    thinIceStep(state, p, tileId); // rivers.js: thin ice may give way under a team on foot
    onEnterTile(state, p, tileId, hour);
    if (!state.parties.includes(p) || p.phase === "engaged") return;
    // A road blockage (roadblocks.js) holds the team up where it met it: the tiles it would have gone on to this hour
    // are given back and stepped again on what the delay leaves of the hour (none if it takes all of it), so the
    // team never drives past the blockage and back (glideAt draws the same: blockDelay).
    if (p.roadblock !== block && k < entered.length - 1) {
      const at = p.path.lastIndexOf(tileId, p.idx);
      if (at < 0) continue;
      for (let i = at; i < p.idx; i++) p.progress += stepCost(state, p, i, hour);
      p.idx = at;
      entered = [...entered.slice(0, k + 1), ...stepAlong(state, p, 0, hour)];
    }
  }
  // Storms and blizzards: a small chance each hour on the road that someone is hurt (weather.js).
  if (upTo >= 1 && p.kind !== "convoy" && p.idx < p.path.length - 1 && travelHazard(state, p, partyMembers(state, p)) && wipeIfEmpty(state, p)) return;
  updateRadio(state, p);
  if (p.idx >= p.path.length - 1) {
    if (p.phase === "out") arrive(state, p);
    else if (p.phase === "back") returnHome(state, p);
  }
}

// True while the team is on its way somewhere (not resting, working or waiting).
/** @param {Party} p */
export const onTheMove = (p) => (p.phase === "out" || p.phase === "back") && Array.isArray(p.path) && p.idx < p.path.length - 1;
// Food the team eats an hour: one ration a person a day, more on the move under a load (load.js). Water is the
// same times the day's thirst (weather.js: the season, a hot day): waterPerHour.
/** @param {State} state @param {Party} p @param {Survivor[]} [members] */
export const rationsPerHour = (state, p, members = partyMembers(state, p)) => rationRate(p.burden, members, p.vehicle, onTheMove(p) || sweeping(p)) / 24; // a survey walks about (survey.js)
/** @param {State} state @param {Party} p @param {Survivor[]} [members] @param {number} [hour] */
export const waterPerHour = (state, p, members = partyMembers(state, p), hour = state.hour) => rationsPerHour(state, p, members) * thirstAt(state, hour);

// Eating and drinking, person by person (needs.js): each member's hunger and thirst gauges fall by their own ration
// rate (the load band on the move, load.js personRation) and they eat and drink from the team's inventory when low
// (fresh game first, packed food, packed preserved, then what was found; the team's ration and share settings). An
// empty gauge costs health (raw: armor and toughness do not help). p.noFood / p.noWater: orders.js (no camp healing)
// and health.js (illness) read them.
/** @param {State} state @param {Party} p @param {Survivor[]} members */
function consume(state, p, members) {
  teamNeedsHour(state, p, members);
  if (!wipeIfEmpty(state, p) && partyMembers(state, p).length < members.length) shedOverload(state, p);
}

// True while the team has run out of food or water.
/** @param {Party} p */
export const starving = (p) => !!(p.noFood || p.noWater);

/** @param {State} state @param {Party} p @param {number} tileId @param {number} [hour] the hour travelled */
function onEnterTile(state, p, tileId, hour = state.hour) {
  const members = partyMembers(state, p);
  if (p.vehicle) {
    const v = partyVehicle(state, p);
    // The tile before this one (a fast vehicle can enter several tiles in one hour, so not always idx - 1).
    const prev = p.path[p.path.lastIndexOf(tileId, p.idx) - 1];
    const onRoad = state.tiles[prev].roadLinks.includes(tileId);
    for (const x of partyVehicles(state, p)) wear(x, onRoad, p.burden ? p.burden.fill : 0); // every vehicle drives the tile (vehicles.js fleets)
    // Fuel by the tile, times the car's load multiplier when it set off (load.js); bikes burn none.
    if (!useFuel(state, p, tileFuel(p.vehicle, onRoad, fuelMultOf(p)))) {
      const cars = partyVehicles(state, p).filter(isCar);
      const name = cars.length > 1 ? cars.map((x) => x.name).join(" and ") : v ? v.name : "vehicle";
      const bikesLeft = partyVehicles(state, p).filter(isBike);
      const keepBikes = bikesLeft.length && bikesLeft.reduce((a, x) => a + (x.count || 1), 0) >= partyMembers(state, p).length;
      log(state, `The ${name} ran out of fuel near ${tileLabel(state, tileId)}. The team left ${cars.length > 1 ? "them" : "it"} there and continues ${keepBikes ? "on its bikes" : "on foot"}. Bring fuel to recover ${cars.length > 1 ? "them" : "it"}.`, "danger");
      if (cars.length && partyVehicles(state, p).length > cars.length && keepBikes) for (const x of cars) leaveVehicle(state, p, tileId, "out of fuel", x); // the bikes ride on
      else leaveVehicle(state, p, tileId, "out of fuel");
    } else {
      if (isLoud(v) && p.owner === "player") truckEngineNoise(state, p, tileId); // miltrucks.js: the Army truck's engine draws the dead
      if (onRoad) roadblockOnEnter(state, p, tileId, partySpeed(p), p.kind === "convoy" ? "the convoy" : teamName(state, p), tileLabel(state, tileId), hour); // roadblocks.js: stalled cars, a fallen tree
    }
  }
  if (p.owner === "player") fieldTeamEnter(state, p, tileId, p.vehicle ? partySpeed(p) : 1); // fieldworks.js: a group's roadblock or checkpoint
  // Sight and perception: what the team sees is held until they return (or reported live by radio).
  const around = state.grid.within(tileId, sightRadius(state, p));
  for (const id of around) p.seen.set(id, withLook(state, snapshot(state, id), id)); // intelnotes.js: a group's base seen in passing
  if (p.spotted) perceive(state, p, members, around);
  if (p.kind === "convoy") {
    convoyLegEvent(state, p, tileId);
    return;
  }
  // A horde or an enemy party on this tile attacks (conflicts.js contactAttack): the team stops here, however far it
  // would have got this hour (a car enters several tiles an hour).
  if (contactAttack(state, p, tileId)) {
    const i = p.path.lastIndexOf(tileId, p.idx);
    if (i >= 0) { p.idx = i; p.progress = 0; }
    p.eventHour = state.hour;
    return;
  }
  // One event card per team per hour: a vehicle enters several tiles in an hour, and a card made on the first
  // would be answered when the team is already tiles further on (or home).
  if (p.eventHour === state.hour) return;
  const card = rollTravelEvent(state, p, tileId);
  if (card) {
    p.eventsSeen += 1;
    p.eventHour = state.hour;
    addCard(state, card);
  }
}

// Brings the found cargo down to what the team can carry (after losing its vehicle, a person or a pack): the
// cheapest goods per carry unit go first, then the cheapest items. What is dropped goes into `into` (a
// { supplies, gear } store, e.g. the vehicle left behind) if given. Returns the dropped goods: { supplies, gear, text }.
/** @param {State} state @param {Party} p */
export function trimCargo(state, p, into = null) {
  const dropped = { supplies: {}, gear: [], text: "" };
  let over = poolLoad(p) - partyCapacity(state, p); // found cargo goes first; packed supplies stay with the team
  // Food goes in its place by worth per kg like anything else (raw meat and wilting greens are worth little a kilo:
  // they go after un-purified water and scrap; MREs and jerky last). Part of a kilo of meat counts.
  const keys = Object.keys(p.cargo.supplies).filter((k) => SUPPLIES[k]).sort((a, b) => supValue(a) / supWeight(a) - supValue(b) / supWeight(b));
  for (const k of keys) {
    if (over <= 1e-9) break;
    const have = FOODS[k] ? Math.max(0, p.cargo.supplies[k] || 0) : Math.floor(p.cargo.supplies[k] || 0);
    const drop = Math.min(Math.ceil(over / supWeight(k) - 1e-9), have);
    if (drop <= 0) continue;
    if (FOODS[k]) takeFood(p.cargo, (drop * FOODS[k].kcal) / 2000, { only: (x) => x === k, state });
    else p.cargo.supplies[k] -= drop;
    dropped.supplies[k] = (dropped.supplies[k] || 0) + drop;
    over -= drop * supWeight(k);
  }
  const byValue = [...p.cargo.gear].sort((a, b) => (GEAR[a.key]?.value || 0) * (a.quality || 1) - (GEAR[b.key]?.value || 0) * (b.quality || 1));
  for (const g of byValue) {
    if (over <= 1e-9) break;
    p.cargo.gear.splice(p.cargo.gear.indexOf(g), 1);
    dropped.gear.push(g);
    over -= itemLoad(g);
  }
  dropped.text = [...Object.entries(dropped.supplies).map(([k, q]) => `${Math.round(q * 10) / 10} ${SUPPLIES[k].name.toLowerCase()}`), ...dropped.gear.map((g) => g.name)].join(", ");
  if (into && dropped.text) {
    for (const [k, q] of Object.entries(dropped.supplies)) into.supplies[k] = (into.supplies[k] || 0) + q;
    into.gear.push(...dropped.gear);
  }
  return dropped;
}

// Cargo left inside an abandoned vehicle (leaveVehicle).
/** @param {Vehicle} v */
export const vehicleCargo = (v) => (v && v.cargo && (v.cargo.gear.length || Object.values(v.cargo.supplies).some((q) => q >= 1)) ? v.cargo : null);

// The team leaves its vehicle on a tile (out of fuel, broken down, no road home, a boat, a raid site). What the
// people cannot carry stays inside it, is noted on its map marker, and comes back with the vehicle when it is
// recovered (recoverVehicle). Returns what was left as text ("" if everything could be carried).
/** @param {State} state @param {Party} p @param {number} tile @param {string} reason */
// which: one of several vehicles (the others stay with the team; what fits nowhere stays in this one); left out, all
// of them (what the people cannot carry stays in the lead one).
export function leaveVehicle(state, p, tile, reason, which = null) {
  const all = partyVehicles(state, p);
  const v = which && all.includes(which) ? which : partyVehicle(state, p);
  if (!v) return "";
  abandonVehicle(state, p, tile, reason, which && all.length > 1 ? which : null);
  weighTeam(state, p);
  if (which && all.length > 1) afterVehicleLoss(state, p); // walkers.js: fewer seats than people now? those without one walk
  v.cargo = v.cargo || { supplies: {}, gear: [] };
  const left = trimCargo(state, p, v.cargo).text;
  if (!vehicleCargo(v)) delete v.cargo;
  if (left) {
    const mark = p.spotted && p.spotted.get(`vehicle:${v.id}`);
    if (mark) {
      mark.label = `${v.name} (${reason}, cargo inside)`;
      mark.info = { ...(mark.info || {}), cargo: left };
    }
    log(state, `Too much to carry on foot: ${left} stayed in the ${v.name} at ${tileLabel(state, tile)}. It is there for whoever recovers the vehicle.`, "danger");
  }
  return left;
}

/** @param {State} state @param {Party} p @param {string} key @param {number} qty */
// "food" / "preserved" (days of food: a robbers' haul, a crate, a thank-you) into a team's cargo: what such people
// carry (foods.js mixes: raider, keeps), the items that fit. Returns the days of food taken.
export function addFoodCargo(state, p, key, qty, mix = "raider") {
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  let got = 0;
  for (const [k, q] of Object.entries(typedFood(state, key === "preserved" ? "keeps" : mix, qty))) {
    const n = Math.min(q, unitsThatFit(cargoRoom(state, p), k));
    if (n > 0) { addFood(p.cargo, k, n, { state }); got += unitsOf(k, n); }
  }
  return Math.round(got * 10) / 10;
}
function addCargo(state, p, key, qty) {
  if (key === "food" || key === "preserved") return addFoodCargo(state, p, key, qty);
  const room = cargoRoom(state, p);
  const take = Math.max(0, Math.min(unitsThatFit(room, key), Math.floor(qty) || 0));
  p.cargo.supplies[key] = (p.cargo.supplies[key] || 0) + take;
  return take;
}

// Puts an item in the team's cargo if the team can carry its weight too (inventory.js itemLoad: a pack counts what is
// inside it). Returns false, and leaves the item where it is, when it does not fit: the caller says what stayed behind.
/** @param {State} state @param {Party} p @param {Item} item */
export function addGearToCargo(state, p, item) {
  if (!item) return false;
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  if (itemLoad(item) > cargoRoom(state, p) + 1e-9) return false;
  p.cargo.gear.push(item);
  return true;
}

// ---------- orders ----------
// Scavenge / raid: a site (t.loc) can be searched again and again; each search picks it over (t.loot falls to a 0.03
// floor, scavenge.js) so a stripped site yields little, but it is never closed. Open ground needs something left
// (loot above 0.05). loot: what you know of the tile (a stale report) instead of the live value.
/** @param {{ loc?: any, loot?: number } | null | undefined} t @param {number} [loot] */
export const scavengeable = (t, loot = t ? t.loot : 0) => !!t && (!!t.loc || (loot || 0) > 0.05);
export const PICKED_OVER = 0.05; // at or below: the site is picked over (searching again finds little)

// What the team can do on the tile where it stands. tile: another tile instead (the right-click menu, ui/teamctx.js,
// asks for the tile the team would move to first: the labels, and the reasons an option would fail with what it carries).
/** @param {State} state @param {Party} p @param {number} [tile] */
export function orderOptions(state, p, tile = partyTile(p)) {
  const t = state.tiles[tile];
  const out = [];
  const add = (m, why) => out.push({ mission: m, label: MISSIONS[m].name, desc: MISSIONS[m].desc, disabled: why || null });
  const enter = enterOption(state, p, tile); // on one of your bases: move in, the team disbanded (moveout.js)
  if (enter) out.push(enter);
  add("survey");
  if (t.terrain !== "water" || t.bridge) add("fullsurvey", state.combat ? "Not in a fight." : null); // the POI survey (survey.js fullSurveyDone)
  if (t.terrain !== "water") add("sweep");
  // A tile with points of interest (pois.js): the raid goes into one of them, so one has to be known (poiraid.js).
  if (scavengeable(t) || poisOf(t).length) {
    add("scavenge", scavengeProblem(state, p, tile));
    if (!out[out.length - 1].disabled && pickedOverAt(state, p, tile)) out[out.length - 1].desc += " Picked over: searching again finds little.";
  }
  const fb = state.factions.find((f) => f.alive && f.bases.includes(tile));
  if (fb) add("trade");
  if (p.caravan) add("caravan"); // a trade caravan's stop card (caravans.js)
  if (fb && captivesOf(state, fb.id).length) add("rescue");
  if (fb) add("assault");
  const ownedByOther = state.factions.some((f) => f.bases.includes(tile)) || (typeof t.owner === "number");
  // A base standing empty here (groupworld.js): Occupy it (occupy.js), with or without a base of your own.
  const left = abandonedAt(state, tile);
  if (left) add("occupy", occupyProblem(state, tile) || null);
  if (!state.bases.length) {
    // No base at all (hardcore's first hub, the exiles): Establish base, a camp built up into the hub (staging.js).
    const est = establishOption(state, p, tile);
    if (est) out.push(est);
  } else if (!left && !state.bases.some((b) => b.tile === tile) && !ownedByOther && (t.terrain !== "water" || t.bridge)) { // a bridge: the outpost barricades it (bridgeClosedTo)
    add("outpost", null);
    const taken = claimsTaken(state, tile); // claims.js: the groups' claims round it become yours
    if (taken.length) out[out.length - 1].desc += ` Building here takes claims round it and angers ${claimsTakenText(taken)}.`;
  }
  // Set up camp: any team of yours, anywhere it may stand (staging.js campOption).
  const camp = campOption(state, p, tile);
  if (camp) out.push(camp);
  const site = state.deathSites.find((d) => d.tile === tile);
  if (site && site.items.length) add("recover");
  if (state.hordes.some((h) => state.grid.distance(h.tile, tile) <= 1)) add("cull");
  if (hiveAt(state, tile)) add("hive");
  if (nomadCampAt(state, tile)) add("nomads"); // nomads.js: a camp you know of
  const gr = growthAt(state, tile);
  if (gr && gr.withered == null) add("growth"); // hivetech.js
  if (t.hidden && !t.hidden.taken && (t.hidden.known || p.spotted?.has(`${t.hidden.type}:${tile}`))) add("investigate");
  // A vehicle found on a map (foundcars.js): repair it on the spot, or send someone home in one that runs.
  const fix = fixableAt(state, tile), runner = runnerAt(state, tile);
  if (fix) out.push(fixOption(state, p, fix));
  if (runner && p.vehicle) out.push(driveHomeOption(state, p, runner));
  const v = state.vehicles.find((x) => x.loc.kind === "abandoned" && x.loc.tile === tile && !(x.found && x.found.repair));
  if (v && !p.vehicle) {
    // What is still in its tank counts: the team only has to bring what is missing (bikes need none).
    const fuel = v.fuel + carried(p, "fuel");
    add("getvehicle", !isBike(v) && fuel < RESTART_FUEL ? `Needs ${RESTART_FUEL} fuel to restart (tank ${Math.floor(v.fuel)}, carried ${Math.floor(carried(p, "fuel"))})` : null);
  } else if (v && vehicleCargo(v)) {
    out.push({ mission: "getvehicle", label: "Take the cargo left in the vehicle", desc: `Load what fits of the cargo left in the ${v.name} (the team already has a vehicle, so this one stays).`, disabled: null });
  }
  return out;
}
const RESTART_FUEL = 2; // fuel (tank plus carried) an abandoned vehicle needs to drive again

// doneLabel: the order that just finished (the card then doubles as its "done" notice).
// title: replaces the usual title (e.g. "Cannot go home").
// Choices marked order: true start timed work; the game resumes and skips the result screen.
/** @param {State} state @param {Party} p @param {string} text @param {string} doneLabel @param {string} title */
export function ordersCard(state, p, text, doneLabel, title) {
  const tile = partyTile(p);
  const opts = orderOptions(state, p);
  const queued = (p.orders || []).length;
  return {
    title: title || (doneLabel ? `Done: ${doneLabel}` : `Orders: team at ${tileLabel(state, tile)}`),
    isOrders: true,
    text: `${text ? text + " " : ""}${partyMembers(state, p).map((s) => s.name.split(" ")[0]).join(", ")} ${partyMembers(state, p).length === 1 ? "waits" : "wait"} for your call at ${tileLabel(state, tile)}. Supplies: ${Math.floor(carried(p, "food"))} days of food, ${waterText(p.supplies.water, p.supplies[RAW])}${p.vehicle ? `, ${Math.floor(partyFuel(state, p))} fuel` : ""}.${queued ? ` Queued orders on hold: ${queueText(state, p)}.` : ""}`,
    partyId: p.id,
    choices: [
      ...(queued ? [{ label: `Resume queued orders (${queued})`, hint: `Carry on with: ${queueText(state, p)}`, order: true, resolve: (st) => resumeQueue(st, p) }] : []),
      // caravanraids.js: a caravan in sight, attack it (within a tile) or go after it.
      ...caravanOrderChoices(state, p),
      ...opts.map((o) => ({
        label: o.mission === "sweep" ? `Sweep ${sweepOpts(p.sweepPlan || {}).radius} tiles around (${sweepOpts(p.sweepPlan || {}).hours}h)` : o.mission === "fullsurvey" ? `Survey this tile (${LOOK.hours}h)` : o.mission === "survey" ? `Quick look (${LOOK.quickHours}h)` : o.label, hint: o.disabled || o.desc, disabled: !!o.disabled, order: o.mission === "survey" || o.mission === "sweep" || o.mission === "fullsurvey",
        resolve: (st) => {
          // Checked again now: the card may have been open while things changed.
          const now = orderOptions(st, p).find((x) => x.mission === o.mission);
          if (!now || now.disabled) {
            awaitOrders(st, p, `${o.label}: ${now ? now.disabled : "no longer possible here"}.`, { failed: true, hold: true });
            return "";
          }
          const res = giveOrder(st, p, o.mission);
          // A raid or search that opened is its own screen: no result box on top of it.
          return st.combat || (st.engagement && st.engagement.partyId === p.id) ? "" : res;
        },
      })),
      ...(state.bases.length && !canClaim(state, tile) ? [{ label: `Claim this tile (${CLAIM.HOURS}h, ${CLAIM.SCRAP} scrap)`, hint: "Raise a marker post: the tile counts as land the coalition holds (toward the 50% the alliance victory needs). Lost if a group or a hive settles on it or a hostile band camps there.", order: true, disabled: carried(p, "scrap") < CLAIM.SCRAP, resolve: (st) => startOrder(st, p, { type: "claim" }) }] : []),
      ...fieldActs(state, p, tile).map((a) => ({ label: a.label, hint: a.hint, order: true, disabled: !!a.why, resolve: (st) => startOrder(st, p, { type: "fwork", act: a.act }) })), // fieldworks.js: a stockpile of yours, a group's structure
      ...(crossingsFrom(state, tile).length ? [{ label: "Build a boat and cross…", hint: "This team stands on a shore with land straight across the water. The team panel shows each crossing with its cost (scrap, hours) and lets you gather materials.", uiAction: { type: "expedition", partyId: p.id }, resolve: () => "" }] : []),
      { label: "Move to another tile…", hint: "Pick any tile on the map. The team travels there and waits for orders again.", uiAction: { type: "move", partyId: p.id }, resolve: () => "Pick a destination on the map (Esc to cancel)." },
      { label: "Return home", hint: "Head back to the hub with everything carried.", order: true, resolve: (st) => (startReturn(st, p) ? "" : "The team heads home.") },
      { label: "Team panel…", hint: "People, gear, supplies and vehicle; camp, scavenge, repair, treat and queue orders.", uiAction: { type: "expedition", partyId: p.id }, resolve: () => "" },
      { label: "Hold here", hint: "Wait. Give orders later from the Teams tab. Supplies keep draining.", resolve: () => "The team holds position." },
    ],
  };
}

// A plain move that got there pops up no card. "log": you can give the team its next order without one (in radio
// contact or at one of your bases): a log line instead. "tray": out of contact the card is the only way to reach it
// (plans.js commandable), so it comes, but waits in the card tray without stopping the clock (cardrules.js cardKind;
// left there it opens by itself instead of taking "Hold here", ui/pacing.js expire). null: the card as before (the
// autopilot and crews answer it themselves: autopilot.js teamAct, crews.js).
/** @param {State} state @param {Party} p @returns {"log" | "tray" | null} */
function quietArrival(state, p) {
  if (p.owner !== "player" || state.autopilot || p.crewRole != null || p.kind === "convoy") return null;
  return "log"; // orders reach a team anywhere (plans.js commandable): no radio-range limit
}

// The team stops and reports in. opts.failed: the order could not be done (the card is not titled "Done: …");
// opts.hold: queued orders stay on hold instead of carrying on; opts.title: a title for the card; opts.card: a card
// to ask instead of the orders card (moveout.js: "Enter <base>?"), made as card(state, p); opts.quiet: no card, a log
// line ("log") or the card in the tray ("tray"): a plain move that got there (arrive, quietArrival).
/** @param {State} state @param {Party} p @param {string} text */
export function awaitOrders(state, p, text, opts = {}) {
  if (!state.parties.includes(p)) return;
  if (wipeIfEmpty(state, p)) return;
  const tile = partyTile(p);
  // Finished where it was sent (not stopped on the way): the next queued order starts by itself.
  const finished = tile === p.dest;
  // "Done" only when an order was really carried out: not for a team that was already waiting, or a failure.
  const doneLabel = finished && p.phase !== "waiting" && !opts.failed ? orderLabel(state, p) : null;
  if (!finished) requeueInterrupted(state, p);
  p.task = null;
  p.phase = "waiting";
  p.path = [tile];
  p.idx = 0;
  p.progress = Math.min(0, p.progress);
  p.dest = tile;
  // One orders card per team: an older one is out of date now.
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].isOrders && state.cards[i].partyId === p.id) state.cards.splice(i, 1);
  // When it checks in for orders, the team reports what it has spotted (the full map update waits for its return).
  mergeSpots(state, p.spotted);
  if (finished && !opts.hold && continueQueue(state, p, text)) return;
  if (opts.quiet === "log") { log(state, `${teamName(state, p)} reached ${tileLabel(state, tile)} and waits for orders.`, "info"); return; }
  const card = opts.card ? opts.card(state, p) : ordersCard(state, p, text, doneLabel, opts.title);
  if (opts.quiet === "tray") card.quietArrival = true;
  addCard(state, card);
}

// A team stopped on the way while orders are queued behind the trip: the unfinished trip (and the mission it
// was on) goes back to the front of the queue, so "Resume queued orders" carries on to the right tile
// instead of running the next order where the team happens to stand.
/** @param {State} state @param {Party} p */
function requeueInterrupted(state, p) {
  if (!p.orders || !p.orders.length) return;
  if (p.phase === "task" && p.task && p.task.type === "cross" && !p.task.afloat) {
    const t = p.task;
    p.orders.unshift({ type: "cross", tile: t.tile, mode: t.mode, build: t.build, cross: t.cross, mats: t.mats });
    return;
  }
  // Only a trip toward p.dest (on the way home the path ends at the base, and the queue is empty anyway).
  if ((p.phase !== "out" && p.phase !== "engaged") || p.dest == null || p.path[p.path.length - 1] !== p.dest) return;
  /** @type {Order[]} */
  const back = [{ type: "move", tile: p.dest }];
  const m = p.mission === "recon" ? "survey" : p.mission;
  if (m !== "move" && MISSIONS[m] && (!MISSIONS[m].hidden || m === "survey")) back.push({ type: "mission", mission: m, at: p.dest });
  p.orders.unshift(...back);
}

/** @param {State} state @param {Party} p @param {string} mission */
export function giveOrder(state, p, mission) {
  p.mission = mission;
  p.dest = partyTile(p);
  p.phase = "out";
  return arrive(state, p) || "";
}

/** @param {State} state @param {Party} p @param {number} tile */
export function orderMove(state, p, tile) {
  if (tile === partyTile(p) && !(onTheMove(p) && (p.progress || 0) > 0)) return "The team is already there."; // part-way along a step: it walks back
  if (p.phase === "task" && p.task?.afloat) return "The team is out on the water. Give the order once it lands.";
  if (!planPath(state, partyTile(p), tile, p.vehicle)) return p.vehicle ? "The vehicle cannot get there. Leave it or pick another tile." : "No route there over land. Water in the way? Build a boat from the shore (team panel).";
  // On the move: first the minutes of this hour it has already travelled (it turns from where the map draws it).
  const moving = stepToNow(state, p);
  if (!state.parties.includes(p) || p.phase === "engaged") return `${teamName(state, p)} ran into trouble on the way.`;
  if (tile === partyTile(p) && !(moving && (p.progress || 0) > 0)) return "The team is already there.";
  const w = wayOn(state, p, p, tile, p.vehicle, moving);
  if (!w) return p.vehicle ? "The vehicle cannot get there. Leave it or pick another tile." : "No route there over land. Water in the way? Build a boat from the shore (team panel).";
  setWay(state, p, w, moving);
  p.mission = "move";
  p.dest = tile;
  p.phase = "out";
  p.task = null; // breaks camp or stops other work on the spot
  p.orderStart = state.hour;
  setPlan(state, p, null);
  return `${teamName(state, p)} sets off for ${tileLabel(state, tile)}.`;
}

// debit: take the two hours from the next move (recon); a timed Look around order already spent them.
// pois: the Quick look at the tile's points of interest too (survey.js quickLook; the Survey makes its own rolls).
/** @param {State} state @param {Party} p @param {number} bonus @param {boolean} [debit] @param {{ pois?: boolean }} [opts] */
export function survey(state, p, bonus, debit = true, { pois = true } = {}) {
  const tile = partyTile(p);
  const members = partyMembers(state, p);
  const opt = opticsFor(members, p.cargo, { still: true, night: state.hour % 24 < 6 || state.hour % 24 >= 20 }); // optics.js
  const around = state.grid.within(tile, sightRadius(state, p) + 1 + opt.reach);
  // A group's base close by gets a good look (intelnotes.js: a survey's look, better with optics).
  for (const id of around) p.seen.set(id, state.grid.distance(tile, id) <= 1 + opt.reach ? withLook(state, snapshot(state, id), id, "survey", surveyErr(state, opt)) : withLook(state, snapshot(state, id), id));
  const found = perceive(state, p, members, around, bonus + (opt.look - 1) * 0.3);
  noteLooked(state, p, around); // discovery.js: looked hard at (the map's Known area layer)
  const places = pois ? quickLook(state, p) : ""; // survey.js: the places the tile hides, each on its own
  gainXpAll(state, members, "scouting", USE.survey); // skills.js
  if (debit) p.progress -= 2 * partySpeed(p); // two hours spent looking around before moving on (at any pace)
  updateRadio(state, p);
  const crash = crashSurvey(state, p); // crashes.js: a downed aircraft found, or its search circle narrowed
  return `${found.length ? `Spotted: ${found.map((f) => `${MARKER_TYPES[f.type].name} at ${tileLabel(state, f.tile)}`).join("; ")}.` : "Nothing new spotted nearby."}${places ? ` ${places}` : ""}${crash ? ` ${crash}` : ""}`;
}

// The pitching is done (orders.js task "pitch"): the camp stands, checked again (the tile may have been taken meanwhile).
/** @param {State} state @param {Party} p */
export function pitchDone(state, p) {
  p.pitched = true;
  p.phase = "out"; // its mission (outpost, establish) is still on it
  return arrive(state, p) || "";
}
// Hours of pitching an order takes on arrival (the planner's and the queue's estimates).
/** @param {State} state @param {string} mission */
export const pitchHoursFor = (state, mission) => (mission === "outpost" || mission === "establish" || mission === "camp" ? CAMP.setupHours : 0);

// ---------- arriving and acting ----------
/** @param {State} state @param {Party} p */
function arrive(state, p) {
  if (wipeIfEmpty(state, p)) return "";
  // Stopped short at a bridge someone barricaded after the way was planned (stepAlong): the team waits at its foot.
  if (p.bridgeStop != null && partyTile(p) !== p.dest) {
    const bridge = p.bridgeStop;
    delete p.bridgeStop;
    const holder = bridgeHolder(state, bridge);
    const f = typeof holder === "number" ? state.factions.find((x) => x.id === holder) : null;
    const who = f ? (f.known ? f.name : "An unknown group") : "Someone";
    awaitOrders(state, p, `${who} has barricaded the bridge at ${tileLabel(state, bridge)}: the road over the river is closed. Storm the barricade, or cross the river by boat from a shore (team panel: Boat crossing).`, { failed: true });
    return "";
  }
  const t = state.tiles[p.dest];
  const members = partyMembers(state, p);
  switch (p.mission) {
    case "move": {
      // One of your bases (its home too), with nothing queued after it: "Enter <base>?" instead of the orders card (moveout.js).
      const into = !(p.orders && p.orders.length) ? enterTarget(state, p, { home: true }) : null;
      if (into) { awaitOrders(state, p, "", { card: (st, q) => enterCard(st, q, into) }); return ""; }
      // Nothing to tell (no city to go into): no card popping up (quietArrival); the team waits ("Waiting for orders").
      const quiet = crawlOffered(state, p) ? null : quietArrival(state, p);
      awaitOrders(state, p, `The team reached ${tileLabel(state, p.dest)}.`, { quiet });
      if (!quiet) offerCrawl(state, p); // a city you drive the team into: the City crawl card instead of the orders card
      return "";
    }
    case "recon":
      awaitOrders(state, p, `The team surveyed around ${tileLabel(state, p.dest)}. ${survey(state, p, 0.25)}`);
      return "";
    case "survey":
      startTask(state, p, { type: "survey", hours: 2 });
      return "The team spends two hours looking around.";
    case "fullsurvey": // the POI survey (survey.js fullSurveyDone when the hours are up): a task on the spot
      if (state.combat || (t.terrain === "water" && !t.bridge)) {
        awaitOrders(state, p, state.combat ? "No surveying in a fight." : "A survey cannot start on open water.", { failed: true });
        return "";
      }
      startTask(state, p, { type: "fullsurvey", hours: LOOK.hours });
      return `The team starts surveying ${tileLabel(state, p.dest)} (${LOOK.hours}h).`;
    case "sweep":
      return startSweep(state, p, p.sweepPlan || {}); // survey.js
    case "scavenge": {
      if (t.terrain === "water" && !t.bridge) { // a bridge is searched: the cars left on it (combat.js AREAS.roadcars)
        awaitOrders(state, p, "There is nothing to search on the water.", { failed: true });
        return "";
      }
      // A tile with points of interest (poiraid.js): one of them has to be known, and you pick which (the dialogue
      // card) unless something picks for you (the autopilot, a crew, a headless tool: the best known one).
      const why = scavengeProblem(state, p, p.dest);
      if (why) { awaitOrders(state, p, why, { failed: true }); return ""; }
      if (poiPickWanted(state, p, p.dest)) { awaitOrders(state, p, "", { card: (st, q) => poiPickCard(st, q), hold: true }); return ""; }
      p.phase = "engaged";
      // Headless searches share one slot (state.engagement): a second team waits its turn instead of replacing it.
      if (startScavenge(state, p) === false) {
        awaitOrders(state, p, "Another team is in the middle of a search. This team waits here; give the order again when that search is over.", { failed: true, hold: true });
        return "";
      }
      return "The team starts searching.";
    }
    case "trade": {
      const f = state.factions.find((f) => f.alive && f.bases.includes(p.dest));
      if (!f) {
        awaitOrders(state, p, `Nobody is at ${tileLabel(state, p.dest)} anymore.`, { failed: true });
      } else if (attitude(f) === "Hostile") {
        const victim = state.rng.pick(members);
        hurt(state, victim, state.rng.int(20, 50), p.dest, `shot at the gates of ${f.name}`);
        log(state, `${f.name} opened fire on your trade team.`, "danger");
        if (wipeIfEmpty(state, p)) return "";
        awaitOrders(state, p, `${f.name} opened fire at the gates.${victim.alive ? ` ${victim.name.split(" ")[0]} was hit.` : ` ${victim.name} was killed.`}`, { failed: true });
      } else {
        // trade.js: opens the trade screen (a ransom offer first if they hold your people), or queues the visit
        // behind one that is already open, so two teams arriving in the same hour both get their turn.
        noteLook(state, p.dest, "visit"); // intelnotes.js: inside their gates, the trade screen shows their stores
        openTrade(state, p, f);
      }
      return "";
    }
    case "establish": // no base at all: a camp with its step up (staging.js)
    case "camp": // Set up camp (staging.js)
      return pitchArrive(state, p, p.mission);
    case "strikecamp": // an old save's order: a camp is struck from its base window now
      awaitOrders(state, p, "A camp is struck from its base window now (Strike camp).", { failed: true });
      return "";
    case "enter": { // move into the base of yours the team stands on (moveout.js joinBase)
      const b = state.bases.find((x) => x.tile === partyTile(p));
      if (!b) { awaitOrders(state, p, "There is no base of yours here to enter.", { failed: true }); return ""; }
      return joinBase(state, p, b);
    }
    case "outpost": {
      // No base left (an order queued before every base was lost): Establish base instead (staging.js).
      if (!state.bases.length) { p.mission = "establish"; return pitchArrive(state, p, "establish"); }
      // A base standing empty here (it was left since the team set out, or the planner was not told): move in instead
      // of building over it (occupy.js).
      if (abandonedAt(state, p.dest)) { p.mission = "occupy"; return occupyArrive(state, p); }
      const mine = state.bases.some((b) => b.tile === p.dest);
      const blocked = mine || state.factions.some((f) => f.bases.includes(p.dest)) || (t.owner != null && t.owner !== "player");
      if ((t.terrain === "water" && !t.bridge) || blocked) {
        awaitOrders(state, p, t.terrain === "water" && !t.bridge ? "An outpost cannot be built on open water." : mine ? "You already have a base here." : `Someone else holds ${tileLabel(state, p.dest)}.`, { failed: true });
        return "";
      }
      // A camp with Establish the outpost queued (staging.js makeCamp; 2026-10-09: the camp is the barest base tier, an
      // hour to set up, the materials taken by the step up as they come in). The team moves in as its first staff.
      const pitching = !!p.pitched;
      const text = pitchArrive(state, p, "outpost");
      const base = pitching ? state.bases.find((b) => b.tile === p.dest) : null;
      if (base) {
        const took = takeGroupClaims(state, base.tile); // claims.js: the groups' claims round it are yours (as a group's new base takes yours)
        if (took.length) log(state, `${base.name}: its land takes claims of ${claimsTakenText(took)}.`, "info");
      }
      return text;
    }
    case "recover": {
      const site = state.deathSites.find((d) => d.tile === p.dest);
      let text;
      if (!site || !site.items.length) {
        // Nothing here any more: the site and its marker go (the hub hears of it when the team reports).
        if (site) state.deathSites.splice(state.deathSites.indexOf(site), 1);
        spot(p, { key: `death:${p.dest}`, type: "death", tile: p.dest, hour: state.hour, label: "Death site", info: { items: 0 }, remove: true });
        awaitOrders(state, p, "Nothing left. Someone got there first.", { failed: true });
        return "";
      }
      const got = [], left = [];
      for (const it of [...site.items]) {
        if (it.kind === "gear") {
          // The real item if kept (a pack keeps its contents, a worn weapon its condition); it needs carry space.
          const item = it.item || { key: it.key, name: GEAR[it.key]?.name || it.name, quality: 1 };
          if (isCart(item) && cartToArms(state, p, item)) { site.items.splice(site.items.indexOf(it), 1); got.push(`${it.name} (pushed home)`); continue; } // carts.js: into someone's free arms, whole
          if (!addGearToCargo(state, p, item)) { left.push(it.name); continue; }
        } else {
          const take = addCargo(state, p, it.key, it.qty);
          if (take > 0) got.push(`${take} ${it.name.toLowerCase()}`);
          it.qty -= take;
          it.value = it.qty * supValue(it.key);
          if (it.qty >= 1) { left.push(`${Math.floor(it.qty)} ${it.name.toLowerCase()}`); continue; }
          site.items.splice(site.items.indexOf(it), 1);
          continue;
        }
        site.items.splice(site.items.indexOf(it), 1);
        got.push(it.name);
      }
      if (!site.items.length) state.deathSites.splice(state.deathSites.indexOf(site), 1);
      spot(p, { key: `death:${p.dest}`, type: "death", tile: p.dest, hour: state.hour, label: deathLabel(site), info: { items: site.items.length }, remove: !site.items.length });
      text = `${site.names.length ? `Recovered from ${site.names.join(", ")}'s remains` : "Picked up the cargo left behind"}: ${got.join(", ") || "nothing"}.${left.length ? ` No room to carry ${left.join(", ")}: left there.` : ""}`;
      log(state, text, "good");
      awaitOrders(state, p, text);
      return "";
    }
    case "hive":
      return hiveArrive(state, p); // hives.js: the hive card and its battle
    case "growth":
      return growthArrive(state, p); // hivetech.js: burn a hive's growth or fight its guard
    case "cull": {
      const horde = state.hordes.find((h) => h.tile === p.dest) || state.hordes.find((h) => state.grid.distance(h.tile, p.dest) <= 1);
      if (!horde) {
        awaitOrders(state, p, "The horde had moved on.", { failed: true });
        return "";
      }
      p.phase = "engaged";
      addCard(state, gatheringCull(state, p, horde, cullCard(state, p, horde))); // hivebirth.js: at a hive build site, Break up the gathering
      return "";
    }
    case "nomads":
      return nomadCampArrive(state, p); // nomads.js: the camp, if it is still there
    case "investigate":
      return investigate(state, p);
    case "getvehicle": {
      const fix = fixableAt(state, partyTile(p)); // foundcars.js: a found vehicle that needs work comes first
      return fix ? startFixCar(state, p, fix) : recoverVehicle(state, p);
    }
    case "drivehome":
      return driveHome(state, p); // foundcars.js: one of the team takes the found vehicle home
    case "rescue":
      p.phase = "engaged";
      return rescueArrive(state, p);
    case "handover":
      return handoverArrive(state, p); // ransom.js: the exchange at the meeting point (and its betrayal)
    case "assault":
      return assaultArrive(state, p); // conquest.js: the assault card and its battle
    case "occupy":
      return occupyArrive(state, p); // occupy.js: clear an abandoned base and move in
    case "help": {
      const siege = state.parties.find((q) => q.id === p.helpFor && q.phase === "siege");
      const f = factionById(state, p.helpFaction);
      if (!siege) {
        log(state, `The squad reached ${f ? f.name : "the base"}, but the fight was already over.`, "info");
        if (f) changeGoodwill(state, f, 3, "you tried to help");
        startReturn(state, p);
      } else {
        p.phase = "helping";
        log(state, `The squad joined the defense of ${f.name}.`, "info");
      }
      return "";
    }
    case "route":
      convoyArrive(state, p);
      return "";
    case "caravan":
      return caravanStop(state, p) || ""; // caravans.js: the stop card
  }
  return "";
}

/** @param {State} state @param {Party} p */
function investigate(state, p) {
  const tile = partyTile(p);
  const t = state.tiles[tile];
  const h = t.hidden;
  if (!h || h.taken) {
    // The marker is put right when the team reports (an older sighting could put a find back on the map after another
    // team had taken it, and the governor sent a team to the same empty wreck every few days: census seed 1, balanced).
    const m = state.markers.find((x) => x.tile === tile && (x.type === "car" || x.type === "cache" || x.type === "camp") && !(x.info && x.info.emptied));
    if (m) spot(p, { key: m.key, type: m.type, tile, hour: state.hour, label: m.label, info: { emptied: true } });
    awaitOrders(state, p, "Someone has already cleaned it out.", { failed: true });
    return "";
  }
  const rng = state.rng;
  const key = `${h.type}:${tile}`;
  if (h.type === "cache" || h.type === "camp") {
    const got = [];
    const food = h.type === "cache" ? rng.int(6, 14) : rng.int(3, 8);
    const loot = h.type === "cache" ? { meds: rng.int(1, 3), ammo: rng.int(15, 40) } : { scrap: rng.int(4, 10), ammo: rng.int(10, 25) };
    Object.assign(loot, typedFood(state, h.type === "cache" ? "keeps" : "raider", food)); // foods.js: a cache's food keeps; a camp's is what raiders eat
    sortFind(loot, h.type === "cache" ? "guns" : "raider", key); // ammo.js: the rounds by calibre
    for (const [k, q] of Object.entries(loot)) {
      const took = addCargo(state, p, k, q);
      if (took) got.push(suppliesText({ [k]: took })); // rounds named by calibre
    }
    let extra = "";
    if (h.type === "camp") {
      // Notes left behind point to something.
      const f = rng.pick(state.factions.filter((x) => x.alive));
      const nest = state.tiles.find((x) => x.hive && state.grid.distance(x.id, tile) <= 10);
      if (f) for (const b of f.bases) p.seen.set(b, snapshot(state, b));
      if (nest) p.seen.set(nest.id, snapshot(state, nest.id));
      extra = ` Notes in the camp mention ${f ? f.name : "other survivors"}${nest ? " and a hive nearby" : ""}; it goes on the map when the team reports.`;
    }
    h.taken = true;
    spot(p, { key, type: h.type, tile, hour: state.hour, label: MARKER_TYPES[h.type].name, info: { emptied: true } });
    awaitOrders(state, p, `${MARKER_TYPES[h.type].name}: found ${got.join(", ") || "nothing you could carry"}.${extra}`);
    return "";
  }
  // A wrecked car: restore it, strip it, or leave it.
  p.phase = "engaged";
  const mech = bestSkill(state, p, "mechanics");
  const chance = Math.max(0.1, Math.min(0.95, (mech + 10 - 6 + 1) / 10));
  // Car parts (machine parts stand in, 2 for each: vehicles.js carPartsCost) and fuel, from what the team carries.
  const cost = () => wreckCost((k) => carried(p, k));
  const cannot = () => p.vehicle || !cost().ok;
  addCard(state, {
    title: "Wrecked car",
    text: `An old sedan sits in the ditch, tires flat, but the engine block looks intact. Your best Mechanics: ${mech}.`,
    partyId: p.id,
    choices: [
      {
        label: `Restore it (${carPartsText(WRECK.parts)}, ${WRECK.fuel} fuel)`,
        hint: p.vehicle ? "The team already has a vehicle to drive" : `Mechanics check, ${Math.round(chance * 100)}%. Success gives you a new vehicle`,
        get disabled() { return !!cannot(); }, // read when shown and checked again when chosen
        resolve: (st) => {
          if (cannot()) {
            awaitOrders(st, p, `The team does not have the ${carPartsText(WRECK.parts)} and ${WRECK.fuel} fuel (or already has a vehicle).`, { failed: true });
            return "Not possible any more.";
          }
          const pay = cost();
          if (pay.car) takeSupply(p, "carparts", pay.car);
          if (pay.parts) takeSupply(p, "parts", pay.parts);
          if (!st.rng.chance(chance)) {
            awaitOrders(st, p, "The repair failed and wasted the parts.");
            return "The parts are wasted. The car will not start.";
          }
          takeSupply(p, "fuel", WRECK.fuel);
          const car = createVehicle(st, "sedan", { kind: "party", partyId: p.id }, { fuel: 6, condition: 35 });
          setPartyVehicles(st, p, [car]);
          h.taken = true;
          spot(p, { key, type: "car", tile, hour: st.hour, label: "Wrecked car", info: { emptied: true }, remove: true });
          awaitOrders(st, p, `The ${car.name} coughs to life (condition 35%).`);
          return "It runs!";
        },
      },
      {
        label: "Strip it for parts and fuel",
        hint: "1–2 parts and a little fuel; the car is gone after",
        resolve: (st) => {
          const got = `${addCargo(st, p, "parts", st.rng.int(1, 2))} parts, ${addCargo(st, p, "fuel", st.rng.int(2, 5))} fuel`;
          h.taken = true;
          spot(p, { key, type: "car", tile, hour: st.hour, label: "Wrecked car", info: { emptied: true } });
          awaitOrders(st, p, `Stripped the car: ${got}.`);
          return `Got ${got}.`;
        },
      },
      { label: "Leave it for later", hint: "It stays marked on the map", resolve: (st) => { awaitOrders(st, p, ""); return "You leave it."; } },
    ],
  });
  return "";
}

// Moves what was left inside a vehicle (leaveVehicle) into the team's cargo, as far as it fits. Returns
// { got, left } as text lists; what does not fit stays in the vehicle.
/** @param {State} state @param {Party} p @param {Vehicle} v */
function takeVehicleCargo(state, p, v) {
  const got = [], left = [];
  const c = vehicleCargo(v);
  if (!c) return { got, left };
  for (const [k, q] of Object.entries(c.supplies)) {
    const take = addCargo(state, p, k, q);
    c.supplies[k] = q - take;
    if (take > 0) got.push(`${take} ${SUPPLIES[k].name.toLowerCase()}`);
    if (c.supplies[k] >= 1) left.push(`${Math.floor(c.supplies[k])} ${SUPPLIES[k].name.toLowerCase()}`);
  }
  c.gear = c.gear.filter((g) => {
    if (addGearToCargo(state, p, g)) { got.push(g.name); return false; }
    left.push(g.name);
    return true;
  });
  if (!vehicleCargo(v)) delete v.cargo;
  return { got, left };
}

/** @param {State} state @param {Party} p */
function recoverVehicle(state, p) {
  const tile = partyTile(p);
  const v = state.vehicles.find((x) => x.loc.kind === "abandoned" && x.loc.tile === tile && !(x.found && x.found.repair));
  if (!v) {
    // Gone: its marker goes too (the hub hears of it when the team reports).
    for (const m of [...state.markers, ...(p.spotted ? p.spotted.values() : [])]) {
      if (m.type === "vehicle" && m.tile === tile && !m.remove) spot(p, { key: m.key, type: "vehicle", tile, hour: state.hour, label: m.label, remove: true });
    }
    awaitOrders(state, p, "The vehicle is gone. Scavengers must have taken what was left.", { failed: true });
    return "";
  }
  // Salvage only: the cargo left inside, as much as the team can carry (it cannot drive two vehicles).
  const salvage = (why) => {
    const c = takeVehicleCargo(state, p, v);
    const text = `${why}${c.got.length ? ` The team took ${c.got.join(", ")} from it.` : ""}${c.left.length ? ` Still inside: ${c.left.join(", ")}.` : ""}`;
    spot(p, { key: `vehicle:${v.id}`, type: "vehicle", tile, hour: state.hour, label: vehicleCargo(v) ? `${v.name} (cargo inside)` : v.name, info: { vehicleId: v.id, fuel: Math.round(v.fuel), condition: Math.round(v.condition) } });
    awaitOrders(state, p, text, { failed: !c.got.length });
    return "";
  };
  if (v.destroyed) { // blown up (launchers.js): no restart; what is left in it, then stripped where it lies
    const c = takeVehicleCargo(state, p, v);
    const y = stripYield(v), got = [];
    for (const k of ["carparts", "scrap"]) { const q = addCargo(state, p, SUPPLIES[k] ? k : "parts", y[k] || 0); if (q > 0) got.push(`${q} ${SUPPLIES[SUPPLIES[k] ? k : "parts"].name.toLowerCase()}`); }
    if (!vehicleCargo(v)) state.vehicles.splice(state.vehicles.indexOf(v), 1);
    spot(p, { key: `vehicle:${v.id}`, type: "vehicle", tile, hour: state.hour, label: v.name, remove: !vehicleCargo(v) });
    awaitOrders(state, p, `The ${v.name} is a burnt-out wreck past repair.${c.got.length ? ` The team took ${c.got.join(", ")} out of it.` : ""} Stripped for ${got.join(" and ") || "nothing they could carry"}.${vehicleCargo(v) ? ` Still inside: ${c.left.join(", ")}.` : " Nothing is left of it."}`);
    return "";
  }
  // A team with vehicles takes a running car along when there is a driver and a seat for everyone (vehicles.js fleets,
  // up to MAX_VEHICLES); bikes only to a team without vehicles.
  const have = partyVehicles(state, p);
  const join = have.length && !isBike(v) ? fleetProblem([...have, v], partyMembers(state, p).length) || (have.length >= MAX_VEHICLES ? `The team has ${MAX_VEHICLES} vehicles already.` : "") : null;
  if (have.length && (isBike(v) || join)) return salvage(isBike(v) ? `The team already has a vehicle, so the ${vehicleLabel(v)} stay.` : `${join} The ${v.name} stays.`);
  if (isBike(v)) {
    // Bikes: no fuel; a badly damaged stack needs a bit of scrap or a part to get rolling.
    if (v.condition < 15 && carried(p, "scrap") + carried(p, "parts") < 1) return salvage(`The bikes are too damaged (${Math.round(v.condition)}%). Bring a scrap or a part to patch them.`);
    if (v.condition < 15) takeSupply(p, carried(p, "scrap") >= 1 ? "scrap" : "parts", 1);
    v.condition = Math.max(v.condition, 20);
    setPartyVehicles(state, p, [v]);
    shedSurplusVehicles(state, p); // walkers.js: a bike each, the spare ones stay
    const c = takeVehicleCargo(state, p, v);
    delete v.cargo;
    spot(p, { key: `vehicle:${v.id}`, type: "vehicle", tile, hour: state.hour, label: v.name, remove: true });
    weighTeam(state, p);
    awaitOrders(state, p, `The team is back on its ${vehicleLabel(v)} (condition ${Math.round(v.condition)}%).${c.got.length ? ` Cargo back on the racks: ${c.got.join(", ")}.` : ""}${(v.count || 1) < partyMembers(state, p).length ? " Not everyone has a bike: the others ride double or run alongside (no change to the pace)." : ""}`);
    return "";
  }
  // The tank counts: the team only pours in what it carries on top.
  const fuel = carried(p, "fuel");
  if (v.fuel + fuel < RESTART_FUEL) return salvage(`Not enough fuel to restart the ${v.name}: ${Math.floor(v.fuel)} in its tank, ${Math.floor(fuel)} carried, needs ${RESTART_FUEL}.`);
  if (v.condition < 15) {
    const parts = carried(p, "parts");
    if (parts < 1 && bestSkill(state, p, "mechanics") < 6) return salvage(`The ${v.name} is too damaged (${Math.round(v.condition)}%). Bring a part or a Mechanics 6+ survivor.`);
    if (parts >= 1) takeSupply(p, "parts", 1);
    v.condition = Math.max(v.condition, 20);
  }
  const pour = Math.max(0, Math.min(fuel, tank(v) - v.fuel));
  v.fuel += takeSupply(p, "fuel", pour);
  setPartyVehicles(state, p, [...have, v]); // one more of the team's (or its only one)
  reseat(state, p); // walkers.js: seats for those who walked
  delete v.found; // a vehicle found on a map (foundcars.js) is just the team's now
  // What was left inside it is cargo again (the vehicle carries it).
  const c = takeVehicleCargo(state, p, v);
  delete v.cargo;
  weighTeam(state, p);
  spot(p, { key: `vehicle:${v.id}`, type: "vehicle", tile, hour: state.hour, label: v.name, remove: true });
  log(state, `The ${v.name} is running again${c.got.length ? `, with the ${c.got.join(", ")} left in it` : ""}.${c.left.length ? ` No room for ${c.left.join(", ")}: left behind.` : ""}`, "good");
  awaitOrders(state, p, `The ${v.name} is running again (fuel ${Math.round(v.fuel)}, condition ${Math.round(v.condition)}%).${c.got.length ? ` Cargo back on board: ${c.got.join(", ")}.` : ""}`);
  return "";
}

/** @param {State} state @param {Party} p @param {Horde} horde */
function cullCard(state, p, horde) {
  const power0 = partyMembers(state, p).reduce((s, m) => s + combatPower(m), 0);
  // The horde may be gone by the time the card is answered (merged into another, or spent on a base).
  const gone = (st) => !st.hordes.includes(horde);
  const moved = (st) => { awaitOrders(st, p, "The horde had moved on before the team was set.", { failed: true }); return "The horde is no longer there."; };
  return {
    title: `A horde of ${horde.size}`,
    text: `The team has found the horde near ${tileLabel(state, horde.tile)} (score ${hordeScore(horde.size)}${horde.bosses ? `, a ${BOSS_NAMES.horde} among them` : ""}${zombieToughness(state, horde.tile) >= 3 ? "; this is red-skull ground by a hive, and the dead here are much tougher" : ""}).${horde.mix && mixText(horde.mix, horde.size) ? ` Among them: ${mixText(horde.mix, horde.size)}${horde.elite ? " (elite)" : ""}.` : ""} Your squad's combat power is ${Math.round(power0)}.`,
    partyId: p.id,
    choices: [
      {
        label: "Set up a killzone and fire",
        hint: "Uses up to 15 rounds per person, each of their own gun's calibre (arrows for a bow or crossbow). Best with ammo and good shooters; someone may get hurt",
        resolve: (st) => {
          if (gone(st)) return moved(st);
          const members = partyMembers(st, p);
          const power = members.reduce((s, m) => s + combatPower(m), 0);
          // Up to 15 shots a head: a bow's in arrows, everyone else's in ammo (takeShots). Over 8 a head the killzone
          // works (× 3), short of that × 1.5: for the bows and the guns each (world.js armedFactor).
          const shot = takeShots(p, members, members.length * 15);
          // Tougher dead (a hive's land, red-skull ground) fall slower; a bigger horde (its score) presses closer.
          const tough = (1 + zombieToughness(st, horde.tile) * 0.35) * mixWeight(horde.mix, "weight", horde.elite); // special dead (zombietypes.js)
          const kill = Math.min(horde.size, Math.round((power * 3 * armedFactor(members, shot.used, shot.arrows, { need: (k) => k * 8 + 1, short: 0.5 }) * st.rng.range(0.7, 1.3)) / tough));
          horde.size -= kill;
          const risk = Math.min(0.9, 0.25 + hordeScore(horde.size + kill) / 40 + (horde.bosses ? 0.2 : 0) + (tough - 1) * 0.3);
          if (members.length && st.rng.chance(risk)) hurt(st, st.rng.pick(members), st.rng.int(15, 45) * tough, horde.tile, "fighting a horde");
          const broken = horde.size <= 5;
          if (broken && st.hordes.includes(horde)) st.hordes.splice(st.hordes.indexOf(horde), 1);
          const back = st.parties.includes(p) && partyMembers(st, p).length ? arrowsBack(shot.arrows) : 0; // about half the arrows picked up again
          if (back) p.supplies.arrows = (p.supplies.arrows || 0) + back;
          if (!wipeIfEmpty(st, p)) awaitOrders(st, p, `The team cut down about ${kill} of them.`);
          return `About ${kill} of the dead fall.${broken ? " The horde is broken." : ""}${shot.arrows ? ` ${shot.arrows} arrows shot, ${back} picked up again.` : ""}`;
        },
      },
      {
        label: "Lure it away with a fire",
        hint: "Uses 3 fuel. Pushes the horde away from your bases for 3 days",
        get disabled() { return partyFuel(state, p) < 3; },
        resolve: (st) => {
          if (gone(st)) return moved(st);
          if (partyFuel(st, p) < 3) { awaitOrders(st, p, "Not enough fuel left for a fire.", { failed: true }); return "The team has less than 3 fuel."; }
          useFuel(st, p, 3);
          horde.lureUntil = st.hour + 72;
          const away = hub(st) ? hub(st).tile : partyTile(p); // away from the hub (or the team, with no base left)
          horde.target = st.grid.neighbors(horde.tile).sort((a, b) => st.grid.distance(b, away) - st.grid.distance(a, away))[0];
          awaitOrders(st, p, "The fire draws the dead away.");
          return "The fire draws the dead away from your land for a few days.";
        },
      },
      { label: "Back off", hint: "No fight", resolve: (st) => { awaitOrders(st, p, "The team slipped away from the horde."); return "The team slips away."; } },
    ],
  };
}

// Sends the team home. Returns "" when it is on its way (or already home), otherwise why it could not leave
// (the team then waits with a "Cannot go home" card, or lands first).
/** @param {State} state @param {Party} p */
export function startReturn(state, p) {
  if (wipeIfEmpty(state, p)) return "That team is gone.";
  const known = reportsLive(p) || p.phase === "waiting" || p.phase === "task"; // ordered home by you, not on its own
  const home = baseById(state, p.homeBaseId) || hub(state);
  if (!home) { // no base left at all (conquest.js): the team stays on the road until it founds or takes one
    if (p.phase !== "waiting") awaitOrders(state, p, "There is no base to go home to. Found a new one (Establish base: a camp you build up into your hub) or take one back (Assault their base).", { failed: true, hold: true });
    return "There is no base to go home to.";
  }
  if (p.phase === "task" && p.task?.afloat) return "The team is out on the water. Give the order once it lands."; // lands first
  p.homeBaseId = home.id;
  let res = planPath(state, partyTile(p), home.tile, p.vehicle);
  // Cut off by water (a crossing took them there): no walking home; they wait for a boat order.
  if (!res && p.owner === "player" && p.kind !== "convoy" && partyTile(p) !== home.tile && !planPath(state, partyTile(p), home.tile, false)) {
    const why = "No way home over land from here: water in the way. Build a boat from the shore (team panel).";
    awaitOrders(state, p, why, { failed: true, hold: true, title: "Cannot go home" });
    return why;
  }
  if (!res && p.vehicle) {
    res = planPath(state, partyTile(p), home.tile, false);
    if (res) {
      const v = partyFleet(state, p);
      log(state, `The ${v ? vehicleLabel(v) : "vehicle"} could not get home from there and ${v && v.fleet ? "were" : "was"} left behind.`, "danger");
      leaveVehicle(state, p, partyTile(p), "no road home");
    }
  }
  // On the move with its vehicle: on from the point it has reached at this minute (stepToNow, wayOn); else from its tile.
  const moving = !!res && res.path[0] === partyTile(p) && stepToNow(state, p);
  if (!state.parties.includes(p)) return "";
  const w = res ? wayOn(state, p, p, home.tile, p.vehicle, moving) || { path: res.path, progress: Math.min(0, p.progress || 0) - clockFrac(state) * partySpeed(p), turn: null } : null;
  if (w) setWay(state, p, w, moving);
  else { p.path = [partyTile(p)]; p.idx = 0; p.progress = Math.min(0, p.progress || 0); }
  p.phase = "back";
  p.task = null;
  p.orders = []; // heading home ends the queue
  p.orderStart = state.hour;
  // The orders card of a team that is leaving is out of date.
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].isOrders && state.cards[i].partyId === p.id) state.cards.splice(i, 1);
  if (known) setPlan(state, p, null);
  if (p.path.length <= 1) returnHome(state, p);
  return "";
}

// Adds carried supplies to a base's stock: whole, finite, positive amounts only (a NaN or negative figure on a
// team must never reach a base).
/** @param {Base} base @param {Stock} supplies */
function addStock(base, supplies) {
  for (const [k, v] of Object.entries(supplies || {})) {
    if (!Number.isFinite(v) || v < 1) continue;
    base.stock[k] = (Number.isFinite(base.stock[k]) ? base.stock[k] : 0) + Math.floor(v);
  }
}

// What a team brings into a base when it ends there (returnHome, settleInto): its supplies and cargo into the stores,
// its finds into the armory, game and forage, the bodies it carries, its vehicle parked (bikes stacked), prisoners to
// the cells. Its people are moved by the caller.
/** @param {State} state @param {Party} p @param {Base} base @param {Survivor[]} members */
function unloadAt(state, p, base, members) {
  cartLotsIn(state, p); // carry.js: what the carts in the cargo carry into the pool first (then the stores, food with its lots)
  wormHome(state, p, members, base); // worm.js: the hands that searched today, washed if the water here is safe
  moveFood(p, base, null, { state }); // foods.js: its food into the stores with its lots (shelf left, the worm's eggs)
  unloadGame(base, p.cargo, state); // the found food and game too
  addStock(base, p.supplies);
  addStock(base, p.cargo.supplies);
  base.armory.push(...p.cargo.gear);
  for (const m of members) unpackPerson(state, m, base); // supitems.js: the water, meds, food… they carry as items, into the stores
  bodiesHome(state, p, base); // carriers.js
  const vs = partyVehicles(state, p); // every one it has (vehicles.js fleets)
  for (const x of vs) x.loc = { kind: "base", baseId: base.id };
  if (vs.some(isBike) || base.armory.some((it) => it && it.key === "bicycle")) parkBikes(state, base); // one stack of bikes per base
  if (p.owner === "player") prisonersHome(state, p, base); // prisoners.js: prisoners taken on the trip go to the cells
}

// A team that founds a base moves in for good: what it carries goes into the stores and the armory, its vehicle is
// parked there, its people live there and the team is disbanded (Build outpost; Set up camp and Establish base,
// staging.js; a base taken by assault, conquest.js).
/** @param {State} state @param {Party} p @param {Base} base */
export function settleInto(state, p, base) {
  const members = partyMembers(state, p);
  unloadAt(state, p, base, members);
  for (const m of members) {
    m.location = { kind: "base", baseId: base.id };
    m.role = "scavenge";
    if (m.gear && m.gear.carry) { base.armory.push(m.gear.carry); m.gear.carry = null; } // carry.js: a bag carried home goes in the armory
  }
  mergeKnowledge(state, p.seen, p.spotted, p);
  removeParty(state, p);
}

// What a stock gained between two snapshots: { key: q } (supplies and food by type; at least 0.05 of each).
/** @param {Stock} before @param {Stock} after */
export function stockGain(before, after) {
  /** @type {Stock} */
  const out = {};
  for (const [k, v] of Object.entries(after || {})) {
    const d = (Number.isFinite(v) ? v : 0) - (Number.isFinite(before[k]) ? before[k] : 0);
    if (d >= 0.05 && (SUPPLIES[k] || FOODS[k])) out[k] = d;
  }
  return out;
}
// "6 days of food (30 cans of beans), 7 water, a machete": a gain in words ("" when nothing).
/** @param {Stock} gain @param {Item[]} [gear] */
export function storedText(gain, gear = []) {
  const food = Object.fromEntries(Object.entries(gain).filter(([k]) => FOODS[k]));
  const days = foodIn(food);
  const parts = days >= 0.05 ? [`${r1(days)} days of food (${foodText(food, 3)})`] : [];
  for (const [k, q] of Object.entries(gain)) if (!FOODS[k] && q >= 0.5) parts.push(`${Math.round(q)} ${keyWord(k)}`);
  if (gear.length) parts.push(gear.length <= 3 ? gear.map((g) => g.name).join(", ") : `${gear.length} items`);
  return parts.join(", ");
}
const r1 = (x) => Math.round(x * 10) / 10;

/** @param {State} state @param {Party} p */
function returnHome(state, p) {
  const home = baseById(state, p.homeBaseId) || hub(state);
  if (!home) { awaitOrders(state, p, "There is no base to go home to.", { failed: true, hold: true }); return; }
  const members = partyMembers(state, p);
  const loot = Object.entries(p.cargo.supplies).filter(([, val]) => val >= 1).map(([k, val]) => `${Math.floor(val)} ${keyWord(k)}`); // "un-purified water", not the key (before the food goes into the stores)
  const stockBefore = { ...home.stock }, armoryBefore = new Set(home.armory);
  unloadAt(state, p, home, members); // the stores, armory, vehicle, bikes, bodies and prisoners
  // What reached the stores and the armory (the stock's real change: packed leftovers and finds alike), for the log.
  const gain = stockGain(stockBefore, home.stock);
  const stored = storedText(gain, home.armory.filter((it) => !armoryBefore.has(it)));
  const caught = p.caught && p.caught.fished ? p.caught : null; // hunting.js fishSummary: the trip's fishing
  /** @type {Stock} */
  const fishGain = {};
  for (const [k, q] of Object.entries(gain)) if (FOODS[k] && FOODS[k].group === "rawfish") fishGain[k] = q;
  const fishHome = caught ? foodIn(fishGain) : 0;
  const routeActive = p.kind === "convoy" && state.routes.some((r) => r.id === p.routeId && r.active);
  for (const m of members) m.location = routeActive ? { kind: "route", routeId: p.routeId } : { kind: "base", baseId: home.id };
  if (p.owner === "player") tripDone(state, p, members, home); // relations.js: the service record, rough trips
  if (p.owner === "player" && p.kind !== "convoy") noteUnpack(state, home, members, teamName(state, p), stored); // teaminv.js: what they carry on them, put away or kept (the Home from a trip window)
  if (p.tripSpec) noteTripHome(state, p); // trips.js: a trip sent from the planner goes to the recent trips (Repeat trip)
  const before = state.knowledge.filter(Boolean).length;
  const markersBefore = state.markers.length;
  mergeKnowledge(state, p.seen, p.spotted, p.owner === "player" ? p : null);
  const revealed = state.knowledge.filter(Boolean).length - before;
  const newMarkers = state.markers.length - markersBefore;
  if (p.cargo.gear.length) loot.push(...p.cargo.gear.map((g) => g.name));
  if (p.routeKind === "supply") {
    supplyReturned(state, p, home, loot);
  } else if (p.kind === "convoy") {
    const route = state.routes.find((r) => r.id === p.routeId);
    log(state, `Convoy back from ${route ? factionById(state, route.factionId)?.name : "the route"}${loot.length ? `: ${loot.join(", ")}` : ""}.`, "good");
  } else {
    // p.movingIn: a team that moved into another of your bases (moveout.js joinBase): it lives there now.
    const searched = p.mission === "scavenge" || p.teamMission === "scavenge" || !!p.searched;
    const what = loot.length ? ` with ${loot.join(", ")}` : searched ? ": found nothing" : "";
    const fish = caught ? (caught.fish > 0.05 ? ` Caught ${r1(caught.fish)} days of food in fish, ${r1(fishHome)} brought into the stores.` : " Caught no fish.") : "";
    log(state, `${teamName(state, p)} ${p.movingIn ? `moved into ${home.name}` : "is home"}${what}.${stored ? ` Into ${home.name}'s stores: ${stored}.` : ""}${fish}${revealed > 0 ? ` ${revealed} new tiles mapped.` : " Map intel updated."}${newMarkers > 0 ? ` ${newMarkers} new marker${newMarkers === 1 ? "" : "s"} on the map.` : ""}`, "good");
  }
  removeParty(state, p);
}

/** @param {State} state @param {Party} p */
export function removeParty(state, p) {
  const i = state.parties.indexOf(p);
  if (i >= 0) state.parties.splice(i, 1);
  // A group's party home again: what is left of its rations goes back into the stock (eating.js; lost elsewhere).
  if (p.owner !== "player" && p.rations) {
    const f = state.factions.find((x) => x.id === p.owner);
    if (f && f.alive && f.stock && (f.bases || []).includes(partyTile(p))) for (const [k, q] of Object.entries(p.rations)) if (q > 0) f.stock[k] = (f.stock[k] || 0) + q;
    delete p.rations;
  }
  if (p.owner !== "player" && p.siegeGear) siegeGearHome(state, p, partyTile(p)); // arsenal.js: a raid's ladders and ram home with whoever is left, else where it ended
  if (p.owner !== "player" && p.meds > 0) { // its meds too
    const f = state.factions.find((x) => x.id === p.owner);
    if (f && f.alive && f.stock && (f.bases || []).includes(partyTile(p))) f.stock.meds = (f.stock.meds || 0) + p.meds;
    p.meds = 0;
  }
  // Nothing may outlive the team: its cards (events, orders, conflicts) and an open trade go with it.
  for (let j = state.cards.length - 1; j >= 0; j--) if (state.cards[j].partyId === p.id) state.cards.splice(j, 1);
  if (state.trade && state.trade.partyId === p.id) state.trade = null;
}

// Everyone on the team is dead (or gone): what it carried stays at a death site on its tile and the vehicle is
// left there, both marked on the map so they can be recovered. On one of your own bases the goods go into that
// base instead. Always use this (through wipeIfEmpty) rather than removeParty for a team that lost its people.
/** @param {State} state @param {Party} p */
export function wipeParty(state, p) {
  if (!state.parties.includes(p)) return;
  const tile = partyTile(p);
  const v = partyVehicle(state, p);
  const vs = partyVehicles(state, p); // every vehicle it had (vehicles.js fleets)
  const base = state.bases.find((b) => b.tile === tile);
  if (base) {
    moveFood(p, base, null, { state });
    unloadGame(base, p.cargo, state);
    addStock(base, p.supplies);
    addStock(base, p.cargo.supplies);
    base.armory.push(...p.cargo.gear);
    for (const x of vs) x.loc = { kind: "base", baseId: base.id };
    if (vs.some(isBike)) parkBikes(state, base);
    log(state, `The last of a team died at ${base.name}. What it carried went into the stores there.`, "death");
  } else {
    const items = [];
    const sup = {};
    for (const pool of [p.supplies, p.cargo.supplies]) for (const [k, q] of Object.entries(pool)) if (SUPPLIES[k] && Number.isFinite(q) && q >= 1) sup[k] = (sup[k] || 0) + Math.floor(q);
    for (const [k, q] of Object.entries(sup)) items.push({ kind: "supply", key: k, name: SUPPLIES[k].name, qty: q, value: q * supValue(k) });
    // item: the real object, so a pack keeps its contents and a worn weapon its condition when recovered.
    for (const g of p.cargo.gear) items.push({ kind: "gear", key: g.key, name: g.name, qty: 1, value: (GEAR[g.key]?.value || 0) * (g.quality || 1), item: g });
    let site = state.deathSites.find((d) => d.tile === tile);
    if (site) site.items.push(...items);
    else if (items.length) {
      site = { id: newId(), tile, items, day: day(state), names: ["the lost team"], lastConfirmed: day(state) };
      state.deathSites.push(site);
    }
    if (site && site.items.length) markDeathSite(state, site);
    for (const x of vs) {
      x.loc = { kind: "abandoned", tile, since: state.hour };
      markAbandonedVehicle(state, x, "its team was lost");
    }
    log(state, `A whole team was lost near ${tileLabel(state, tile)}. ${site && site.items.length ? "What it carried lies there" : "Nothing it carried is left"}${vs.length > 1 ? `, and its ${vs.length} vehicles stand abandoned` : v ? `, and the ${v.name} stands abandoned` : ""}: marked on the map.`, "death");
  }
  p.cargo = { supplies: {}, gear: [] };
  p.supplies = {};
  p.vehicle = false;
  p.vehicleId = null;
  p.vehicleIds = [];
  removeParty(state, p);
}

// ---------- player trade-route convoys ----------
/** @param {State} state */
export function dispatchConvoy(state, route) {
  const h = hub(state);
  const f = factionById(state, route.factionId);
  if (!f || !f.alive) return;
  const escorts = route.escortIds.map((id) => survivorById(state, id)).filter((s) => s && s.alive);
  if (!escorts.length) {
    // Nobody left to walk it: the route pauses itself, with one log line (not one every interval).
    route.active = false;
    route.paused = "no escort";
    return log(state, `The route to ${f.name} has no escort left and is paused. Set it up again with new escorts.`, "danger");
  }
  if ((route.sendKey === "ammo" ? stockHas(h.stock, "ammo") : h.stock[route.sendKey] || 0) < route.sendQty) return log(state, `Not enough ${route.sendKey} to send the convoy to ${f.name}.`, "danger");
  // A vehicle if one is parked, sound, and can be fuelled for the round trip; otherwise hand carts.
  const v = state.vehicles.find((x) => isCar(x) && x.loc.kind === "base" && x.loc.baseId === h.id && x.condition > 20);
  const truckPath = v ? planPath(state, h.tile, f.bases[0], true) : null;
  const need = truckPath ? Math.ceil(fuelForPath(state, truckPath.path) * 2.2) : 0;
  const useTruck = !!truckPath && need <= tank(v) && v.fuel + (h.stock.fuel || 0) >= need;
  const res = useTruck ? truckPath : planPath(state, h.tile, f.bases[0], false);
  if (!res) return;
  const hours = res.cost * 2 + 4;
  const food = Math.ceil((escorts.length * hours) / 24);
  if (foodIn(h.stock) < food + (route.sendKey === "food" ? route.sendQty : 0)) return log(state, `Not enough food to supply the convoy to ${f.name}.`, "danger");
  if (route.sendKey === "ammo" || route.sendKey === "food") takeStock(h.stock, route.sendKey, route.sendQty); // any rounds, the cheapest first (rounds.js); food: days of it, the soonest to spoil first
  else h.stock[route.sendKey] -= route.sendQty;
  const convoyFood = packPick(state, h, food, { days: Math.ceil(hours / 24) });
  const wantWater = Math.ceil(food * thirstAhead(state, hours / 24)); // more in summer and a heat wave (weather.js)
  const w = drawWater(h.stock, wantWater); // purified first (water.js)
  if (useTruck) {
    const top = Math.max(0, need - v.fuel);
    h.stock.fuel -= top;
    v.fuel += top;
  }
  const p = {
    id: newId(), owner: "player", kind: "convoy", mission: "route", routeId: route.id, dest: f.bases[0], homeBaseId: h.id,
    members: escorts.map((s) => s.id), stance: "normal", vehicle: useTruck, vehicleId: useTruck ? v.id : null,
    supplies: { water: Math.max(w.pure, wantWater - w.raw), [RAW]: w.raw, fuel: 0, meds: 0, ammo: route.escort === "heavy" ? 40 : route.escort === "standard" ? 20 : 8 },
    cargo: { supplies: route.sendKey === "food" ? typedFood(state, "stores", route.sendQty, { whole: false }) : { [route.sendKey]: route.sendQty }, gear: [] },
    path: res.path, idx: 0, progress: 0, phase: "out", seen: new Map(), spotted: new Map(), sightNow: [], radioLive: false,
    departed: state.hour, plannedHours: hours, eventsSeen: 0,
  };
  if (useTruck) v.loc = { kind: "party", partyId: p.id };
  for (const s of escorts) s.location = { kind: "party", partyId: p.id };
  state.parties.push(p);
  moveFood(h, p, convoyFood, { state }); // the escorts' food for the road, with its lots
  log(state, `Convoy left for ${f.name} with ${route.sendQty} ${route.sendKey} (${route.escort} escort, ${useTruck ? `in the ${v.name}` : "with hand carts"}).`, "info");
}

/** @param {State} state @param {Party} p */
function convoyArrive(state, p) {
  if (p.routeKind === "supply") return supplyArrive(state, p);
  const route = state.routes.find((r) => r.id === p.routeId);
  const f = route && factionById(state, route.factionId);
  if (f && f.alive && attitude(f) !== "Hostile") {
    routeExchange(state, p, route, f); // trade.js: paid at the day's barter prices, never more than the load is worth
    changeGoodwill(state, f, 1.5);
    f.lastDiplomacy = day(state);
  } else if (f) {
    log(state, `${f.name} refused the convoy.`, "danger");
  }
  startReturn(state, p);
}

// ---------- AI parties ----------
/** @param {State} state @param {Party} p */
function aiPartyHour(state, p) {
  // Turned back (a raid bought off with tribute, even one already at the walls): gone, nothing more to settle.
  if (p.returning) {
    removeParty(state, p);
    return;
  }
  if (p.phase === "siege") {
    if (p.helpCall && state.hour >= p.helpCall.arrivesAt && !p.helpCall.delivered) {
      p.helpCall.delivered = true;
      deliverHelpCall(state, p);
    }
    // At your walls a strong defence drives them off sooner (factions.js siegePace); the hours it lasted set the damage.
    p.siegeHours = (p.siegeHours || 0) + 1;
    p.siegeLeft -= p.target.kind === "player" ? siegePace(state, baseById(state, p.target.baseId), p.strength) : 1;
    if (p.siegeLeft <= 0) finishSiege(state, p);
    return;
  }
  if (p.kind === "caravan" && p.phase !== "out") return caravanHour(state, p); // at your gates (caravans.js)
  if (p.kind === "scav" && p.phase === "search") return scavSearchHour(state, p); // scavenging a site (aiscav.js)
  const entered = stepAlong(state, p, p.vehicle ? 1 : 0.9);
  const owner = entered.length && state.bases.length ? factionById(state, p.owner) : null;
  for (const tileId of entered) {
    if (owner) partySaw(state, owner, tileId); // groupworld.js: what they see of your bases on the way
    fieldPartyEnter(state, p, tileId); // fieldworks.js: a hostile roadblock holds them; a raid on you empties your stockpile in passing
    // Hordes chew up whoever walks into them.
    const horde = state.hordes.find((h) => h.tile === tileId);
    if (horde) {
      // groupfight.js: its people against the dead that fall on them (as on your team: a surge of the horde, its
      // count by the land's infection, its power by the hive's toughness), by your by-the-numbers rules.
      const pf = factionById(state, p.owner);
      const A = pf && !pf.outsider ? fightersOf(state, pf, { party: p }) : [];
      if (A.length) {
        const t = state.tiles[tileId];
        const n = Math.min(horde.size, Math.max(4, Math.round(5 + (t.infection || 0) * 14)));
        const fight = fightSides(state, { f: pf, people: A, kind: AI_KIND[pf.type] || "raiders" }, { f: null, people: [], kind: "zombies", count: n, power: n * (1 + zombieToughness(state, tileId)) });
        const lost = applySide(state, pf, fight.rA, A, { holder: fight.attWon ? pf : null });
        const killed = fight.rA ? Math.min(n, Math.floor(n * fight.rA.killShare + 1e-9)) : 0;
        horde.size = Math.max(0, horde.size - killed);
        p.strength *= Math.max(0, A.length - lost.dead.length) / A.length;
        if (!fight.attWon && p.kind === "scav") for (const k of Object.keys(p.scav.got)) p.scav.got[k] *= 0.75; // they ran: a share of the haul dropped
      } else {
        p.strength *= 0.75;
        if (p.kind === "scav") for (const k of Object.keys(p.scav.got)) p.scav.got[k] *= 0.75; // and drops a share of the haul
        horde.size = Math.max(0, horde.size - Math.round(p.strength * 0.6));
      }
      if (horde.size < 5) state.hordes.splice(state.hordes.indexOf(horde), 1); // too few left to be a horde
    }
    if ((p.kind === "convoy" || p.kind === "caravan") && !caravanGuarded(state, p)) { // jobs.js: raiders leave a caravan you escort alone
      for (const r of state.factions) {
        // Raider gangs (not a group they have a pact with), and aggressive groups at war with its group (caravanraids.js wouldRaid).
        if (!r.alive || r.id === p.owner || !isAggressiveType(r)) continue;
        if (!wouldRaid(state, r, { owner: p.owner, type: p.kind })) continue;
        const lying = lyingFor(state, r, p); // intel.js: they overheard this caravan on its group's channel
        if (r.bases.some((b) => state.grid.distance(b, tileId) <= 2 + (lying ? INTEL.AMBUSH.AI_RANGE : 0)) && state.rng.chance(0.12 * (lying ? INTEL.AMBUSH.MULT : 1))) {
          if (lying) r.lying = null; // the band has done what it came out for, either way
          const from = factionById(state, p.owner);
          // caravanraids.js gangAmbush: by the numbers; won, everything it carried goes into their stock and onto their shelf.
          if (!gangAmbush(state, r, p)) {
            if (state.live.has(tileId)) log(state, `A ${from && from.known ? `${from.name} ` : ""}${p.kind} beat off ${r.known ? r.name : "raiders"} near ${tileLabel(state, tileId)}.`, "info");
            continue;
          }
          // Seen from your land; a group you have not met is not named.
          if (state.live.has(tileId)) log(state, `${r.known ? r.name : "Raiders"} ambushed a ${from && from.known ? `${from.name} ` : ""}${p.kind} near ${tileLabel(state, tileId)} and took everything it carried.`, "danger");
          removeParty(state, p);
          return;
        }
      }
    }
    // Scavengers carrying a haul home: raiders near their own base take it (aiscav.js).
    if (p.kind === "scav" && p.phase === "home") {
      for (const r of state.factions) {
        if (!r.alive || r.type !== "raider" || r.id === p.owner) continue;
        if (r.bases.some((b) => state.grid.distance(b, tileId) <= 2) && hash01(state.seed, "scavamb", state.hour, tileId, state.factions.indexOf(r)) < 0.12) {
          ambushHaul(state, p, r);
          const from = factionById(state, p.owner);
          if (state.live.has(tileId)) log(state, `${r.known ? r.name : "Raiders"} ambushed ${from && from.known ? `${from.name} ` : ""}scavengers near ${tileLabel(state, tileId)} and took their haul.`, "danger");
          removeParty(state, p);
          return;
        }
      }
    }
  }
  if (p.strength < 1) {
    if (p.kind === "scav") return loseScav(state, p);
    removeParty(state, p);
    return;
  }
  // Raid warnings when lookouts can see them coming (watch.js lookoutsSpot: RAID_WARN_TILES, 2 more with someone
  // awake on watch, and nobody sees them come on an unwatched night).
  if (p.kind === "raid" && p.target.kind === "player" && !p.warned) {
    const base = baseById(state, p.target.baseId);
    if (base && lookoutsSpot(state, base, partyTile(p), RAID_WARN_TILES)) {
      p.warned = true;
      p.watchSaw = watchSawText(state, base, partyTile(p), RAID_WARN_TILES);
      raidWarning(state, p);
    }
  }
  if (p.idx >= p.path.length - 1) {
    if (p.kind === "convoy") {
      const to = factionById(state, p.targetFaction);
      if (to && to.alive) {
        addFoods(to, typedFood(state, "stores", 10));
        to.stock.scrap += 10;
      }
      removeParty(state, p);
    } else if (p.kind === "caravan") {
      caravanArrive(state, p); // caravans.js: trade at your base, or home again
    } else if (p.kind === "scav") {
      scavArrived(state, p); // aiscav.js: at the site (search) or home (the haul into their stock)
    } else if (p.kind === "fwraid") {
      fieldRaidArrive(state, p); // fieldworks.js: a raid on a field work of yours (it fights the lookouts, takes or wrecks it)
    } else if (p.kind === "raid") {
      const stillThere = p.target.kind === "player" ? baseById(state, p.target.baseId) :
        factionById(state, p.target.factionId)?.bases.includes(p.target.tile);
      if (!stillThere) return removeParty(state, p);
      p.phase = "siege";
      p.siegeLeft = p.target.kind === "player" ? p.siegeLen || 8 : 18; // siegeLen: a siege in a war on you (playerwars.js)
      if (p.target.kind === "player" && !p.warned) {
        p.warned = true;
        // Not seen coming, at night, nobody awake on watch (watch.js surpriseAt): over the wall before anyone woke.
        const sp = surpriseAt(state, baseById(state, p.target.baseId));
        if (sp) p.surprise = sp.why;
        raidWarning(state, p);
      }
      if (p.target.kind === "faction") maybeCallForHelp(state, p);
    }
  }
}

const RAID_WARN_TILES = 4; // a raid on your base is warned of this far out when the lookouts see it (watch.js lookoutsSpot)

/** @param {State} state @param {Party} p */
function finishSiege(state, p) {
  if (p.target.kind === "player") {
    resolveRaidOnPlayer(state, p);
  } else {
    const helpers = state.parties.filter((q) => q.owner === "player" && q.phase === "helping" && q.helpFor === p.id);
    const powers = helpers.map((h) => partyMembers(state, h).reduce((s, m) => s + combatPower(m), 0) * 1.4);
    const held = resolveRaidOnFaction(state, p, powers);
    const f = factionById(state, p.target.factionId);
    for (const h of helpers) {
      const members = partyMembers(state, h);
      if (members.length && state.rng.chance(0.5)) hurt(state, state.rng.pick(members), state.rng.int(10, 40), p.target.tile, `defending ${f ? f.name : "allies"}`);
      if (wipeIfEmpty(state, h)) continue;
      if (f && f.alive) {
        changeGoodwill(state, f, held ? 20 : 8, held ? "you helped them hold" : "you fought beside them");
        if (held) {
          const reward = state.rng.chance(0.5) ? { key: "meds", qty: 6 } : { key: "ammo", qty: 60 };
          const gift = reward.key === "ammo" ? findRounds(kindTheme(f.type), reward.qty, "heldthanks", localId(state, f.id), state.hour) : { [reward.key]: reward.qty }; // rounds by calibre: what their kind shoots (ammo.js)
          for (const [k, q] of Object.entries(gift)) h.cargo.supplies[k] = (h.cargo.supplies[k] || 0) + q;
          log(state, `${f.name} thanks your squad with ${reward.key === "ammo" ? roundsText(gift) : `${reward.qty} ${reward.key}`}.`, "good");
        }
      }
      if (state.parties.includes(h)) startReturn(state, h);
    }
  }
  removeParty(state, p);
}
