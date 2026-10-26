// @ts-check
// World state, shared helpers and the hourly/daily tick.
// Pure simulation: no DOM or canvas code lives here.
/** @import { State, Survivor, Base, Item, Card, Stock, TileSnapshot, Marker } from "./types" */
import { achievementsDaily, achievementsEnd } from "./achievements.js"; // achievements per run: the daily pass and the endings (recording only)
import { syncAllMembers } from "./members.js"; // the AI groups' people (docs/adr/0001-ai-parity.md)
import { typedFood, addFoodsTo, FOODS, foodIn } from "./foods.js"; // the hub's first food, by type
import { keyWord } from "./water.js"; // supply names in log lines (call-time only: safe in the import cycle)
import { Rng } from "./rng.js";
import { pickStart, chosenStart, startNear, isSettlementTile } from "./startpick.js"; // the new-run screen's New start position and Pick start on map
import { generateMap, mapCached } from "./mapgen.js";
import { DEFAULT_SIZE, sizeDef, customDef, isCustom, clampHives, presetKeyFor, clampCustomW, clampCustomH } from "./worldsize.js";
import { cleanCustom, customSizeDef } from "./custommode.js"; // Custom mode's counts and Start with a vehicle (2026-10-24)
import { CRASH } from "./crashmode.js"; // Crashlanding (2026-10-24): the forced map size
import { prepareCrash, setupCrashStart, crashHour } from "./crashstart.js"; // Crashlanding: the crash, the kit, the unit's base and its chain (call-time only)
import { cleanFleet, fitFleet, seatDrivers, START_FLEET } from "./startfleet.js"; // the starting vehicles, their kinds, point limits and loads (2026-10-24)
import { FIRST_NAMES, LAST_NAMES, SKILLS, ROLLED_SKILLS, TRAITS, BIRTH_TRAITS, clashIn, GEAR, SUPPLIES, SUPPLY_KEYS, supValue } from "./data.js";
import { traitDice, swapNewTraits, noteBornTraits, woundMult, traitSkill, traitPower, rollTiers, tidyTiers, cleanTier } from "./traits.js"; // the newer traits: own dice at birth, their rules
import { sanitizeLibrary } from "./custombg.js";
import { loadUpAll } from "./itemacts.js"; // physical rounds out of a fight (2026-10-20): the crew's guns loaded at the start
import { sanitizeStartGear, hasPicks, normalStartGear } from "./startgear.js"; // gear picked on the new-run screen (Customize)
import { appearanceFor, craftingStart, CRAFT_START, meleeStart, meleeOldSave, cookingStart, cookingOldSave } from "./appearance.js";
export { radioBasesInRange };

// Bases with a radio station, or a linked relay, whose range covers a tile (the network is in radio.js).
/** @param {State} state @param {number} tileId @returns {Base[]} */
function radioBasesInRange(state, tileId, extra = 0) {
  return coverNodes(state, tileId, extra).map((n) => n.base);
}
import { createFactions, factionsDaily, recomputeOwnership } from "./factions.js";
import { movePartiesHour, clockFrac, setClockFrac, reportsLive, unheardEnvoy } from "./parties.js";
import { detachHour } from "./detach.js"; // some of a team out on jobs of their own
import { envoyLostQuiet } from "./envoys.js"; // an envoy dying out of radio coverage: heard of only when overdue (call-time only)
import { fieldSight, fieldworksHour, fieldworksDaily } from "./fieldworks.js"; // field works outside the bases
import { hordesHour, hordesDaily } from "./hordes.js";
import { ensureHives, hivesSecured } from "./hives.js";
import { growthAt, growthInfo } from "./hivetech.js";
import { mergeMix } from "./zombietypes.js";
import { basesDaily, routesDaily, deathSitesDaily } from "./economy.js";
import { storageDaily } from "./basestorage.js"; // base storage: the things left outside weather (call-time only)
import { groundDaily } from "./carry.js"; // food left on the ground spoils
import { addBuilding, constructionHour, assignStations, baseBeds } from "./buildings.js";
import { setFurniture } from "./beds.js"; // the start's beds set in its Lodge (call-time only)
import { pitchTentAtBase } from "./tents.js"; // the start's tent pitched from its bag (call-time only)
import { createVehicle, vehiclesDaily, garageHour, factionVehiclesDaily, VEHICLE_TYPES } from "./vehicles.js";
import { updateLiveMarkers, mergeSpots } from "./markers.js";
import { captivesDaily, releaseStranded, contactHour } from "./conflicts.js";
import { supplyDaily } from "./supply.js";
import { medicalHour } from "./medical.js";
import { craftingHour, craftingDaily } from "./crafting.js";
import { repairHour, rezeroHour } from "./repair.js"; // gear repairs at the bench; budget sights re-zeroed
import { armorPower, armorMult, allItems, stripAll, newItem, START_DUR } from "./inventory.js";
import { randomStarterMods } from "./gunmods.js"; // starting guns may carry a cheap attachment
import { settleAll, starterLoad, pocketBox, gunsArmed, drawShots, carriedRec, spendCarried } from "./ammo.js"; // rounds by calibre
import { startChronicle, recordChronicle } from "./chronicle.js";
import { historyHour } from "./history.js"; // the Ledger's daily rows (ui/ledger.js)
import { foodMarkAll } from "./foodlog.js"; // the bases' food ledger (the Food tab): marks between the hour's steps
import { autopilotHour, autopilotResolve } from "./autopilot.js";
import { productionHour } from "./production.js";
import { stewardHour } from "./steward.js";
import { helpRestore, helpHour, helpDayRoles } from "./noidle.js"; // no idle workers: help elsewhere for the hour
import { cookShiftHour, cooksHour } from "./kitchen.js"; // part-time cooks: the cooking hours (kitchen-plus)
import { workHour, workDayRoles } from "./work.js";
import { stallDaily } from "./activity.js";
import { leaderIdleHour } from "./idlework.js";
import { isMealHour, isLunchHour } from "./meals.js"; // the leader and the governor move people off stalled jobs once a day // the day each job at a base was first found unable to work (the stalled-job alert)
import { packOnDeath } from "./eating.js"; // a death: their pack of food and water
import { watchHour, watchDayRoles } from "./watch.js";
import { sickRestHour } from "./sickrest.js"; // sick people rest: Manual and pinned people's jobs kept and given back
import { tiredHour } from "./sleep.js";
import { crewHour } from "./crews.js";
import { woundTrauma } from "./health.js";
import { weatherHour, weatherDaily, sightCut } from "./weather.js"; // sightCut: fog and blizzards cut a base's view
import { riversHour } from "./rivers.js"; // frozen rivers: freeze and thaw (who is on the ice, ways over it)
import { pondsDaily } from "./ponds.js"; // the hollows round your bases: ponds, mud, ice by the weather
import { coverNodes, radioDaily } from "./radio.js";
import { diaryRecord } from "./diary.js";
import { onDeath } from "./relations.js";
import { noteDeath, noteBaseLoss, lossHow, causesDaily } from "./causes.js"; // "Why?": the chain of causes of a death or a lost base
import { skillsHour, skillsDaily, hasPerk, hash01 } from "./skills.js";
import { trainingDaily } from "./training.js"; // the hospital trains medics
import { diplomacyHour } from "./diplomacy.js";
import { allianceVictory, accordHolds, controlledLand } from "./alliance.js";
import { claimsDaily } from "./claims.js"; // land claims: lost under a base founded or taken, a hive, a hostile camp
import { conquestDaily } from "./conquest.js";
import { prisonersHour, prisonersDaily, jailGuardHour } from "./prisoners.js";
import { groupJailsDaily, groupJailsHour } from "./groupjails.js"; // jailhouse: the groups' jails, prisoner labour and trades
import { ransomHour } from "./ransom.js";
import { visitorsHour, visitorsDaily } from "./visitors.js";
import { nomadsHour, nomadsDaily } from "./nomads.js"; // baseless bands that camp, raid the places round them and move on
import { caravanRaidsHour } from "./caravanraids.js";
import { noteFinds, discoveryHour, mergeLooked } from "./discovery.js";
import { ensurePois, poiSnapshot, learnPois, mergePoiFinds, tileHeatDaily } from "./pois.js"; // points of interest on the tiles: their lists, and what a report says of them
import { hiveBirthHour } from "./hivebirth.js"; // hive birth you can see: rumours, the massing card, a hive risen
import { festivalHour } from "./festival.js"; // the yearly harvest festival at the hub
import { baseOpticsSight } from "./optics.js";
import { surveyDaily } from "./survey.js";
import { riseOnMap, walkingDaily } from "./carriers.js"; // the worm: someone who has it gets up when they die; the walking dead drift
import { erasVictoryDaily, accordReady, containReady } from "./eras.js";
import { outbreakDaily } from "./outbreak.js";
import { hardcoreCreate, hardcoreAfterHives, hardcoreDaily, hardcoreHour, clampStartPeople, NORMAL_PEOPLE } from "./hardcore.js";
import { countWord, normalStartBackgrounds, normalStartKit, rollHubFleet } from "./hardcore-start.js";
import { campsHour } from "./staging.js";
import { needsHour } from "./needs.js";
import { wanderersDaily } from "./wanderers.js";
import { crowdCardsHour } from "./moveout.js"; // the Overcrowded card (and moving people between your bases)
import { familyDaily } from "./family.js"; // children and generations
import { leavePlayerBase, abandonedAt } from "./groupworld.js"; // a lost outpost stands empty for a group to move into (or for your Occupy order)
import { noteLootAge } from "./itemcond.js"; // the years since the fall: shops and homes keep getting worse (COND_AGE)
import { starterMags } from "./carrykit.js"; // a starting gun's spare magazines
import { volunteersHour, volunteerFell } from "./volunteers.js"; // people lent between groups, both ways
import { loanFell } from "./loans.js"; // people on loan to your bases
import { noteLook, keepLook } from "./intelnotes.js"; // what your people learned of the groups' bases (the State Map's estimates, intelest.js)
import { jobTripsHour } from "./jobtrips.js"; // the outdoor jobs in trips: out to the base's land and home with the load
import { seedRoadCarts } from "./carts.js"; // abandoned carts on the roads near towns (a new world)
import { setWorldCfg } from "./worldcfg.js"; // the run's dials (World… on the new-run screen)

export const HUB_VISION = 3;
// A normal start's hub is bare (barestart): no buildings, every construction plot free. Its stores carry the first
// builds instead, the player's choice (or the governor's, autopilot.js buildWishes): 50 scrap is a bunkhouse (20), a
// crafting bench (12 and a part: buildings.js BUILDINGS.craftbench), a farm plot (8) and a rain catcher (5) with a
// little over; 3 parts are the bench's, a well's and one spare. It used to be 25 scrap and 2 parts with two farm plots,
// a crafting bench, a bunkhouse and a wall section already standing (69 scrap of buildings). tools/barestarttest.js.
export const HUB_START = { scrap: 50, parts: 3 };
// The main house's tool shelf (the tools, 2026-10-21: builds and recipes need tools at the base, toolreqs.js): a tool kit
// (a hammer, a saw, wrenches, pliers), a shovel and a hatchet in the hub's armory, so the first builds, the fields and
// the first woodcutter go ahead; the drill, the welder, the sewing kit and the better axes are found or traded for.
export const HUB_TOOLS = ["toolkit", "shovel", "hatchet"];
export const OUTPOST_VISION = 2;
export const RADIO_RANGE = 12; // a radio station's reach; a base with a Military encrypted radio in its armory reaches radio.js MIL_RADIO_RANGE (24)

let nextId = 1;
export const newId = () => nextId++;
// The crew's own dice (2026-10-24, the user: "Dice for survivors should not be reliant on the map these two should be
// separate so make the survivors have their own dice"): the starting survivors, their kit and what they grabbed are
// rolled on a Rng of their own (crewRoll, else crewRollOf the seed), their faces and names counted from the first
// person of the world, so neither the map, its size nor the groups change who they are, and they change nothing of
// the world's (its dice go on after them as if they were not there). The new-run screen shows them before the map is
// built (createWorld preview) and they come into the world built at Start as shown. crewDice returns the end of it:
// the world's dice, people count and names back, the crew's counted in.
export const crewRollOf = (seed) => 1 + ((Math.abs(Math.trunc(Number(seed) || 0)) * 48271) % 2147483646);
/** @param {State} state @param {number | null} [crewRoll] @returns {() => void} */
export function crewDice(state, crewRoll = null) {
  const rng = state.rng, made = state.peopleMade || 0, names = state.namesGiven;
  state.rng = new Rng(crewRoll ?? crewRollOf(state.seed));
  state.peopleMade = 0;
  state.namesGiven = [];
  return () => {
    const crewMade = state.peopleMade || 0, crewNames = state.namesGiven || [];
    state.rng = rng;
    state.peopleMade = made + crewMade;
    state.namesGiven = [...(names || []), ...crewNames];
  };
}
// Saves (save.js): the next id is part of a save, so a loaded world hands out the same ids it would have.
export const peekNextId = () => nextId;
/** @param {number} n */
export function setNextId(n) {
  if (Number.isInteger(n) && n >= 1) nextId = n;
}
// Ids are process-wide, so a world made after another one hands out higher ids. Anything that feeds an id (from
// newId) into the world's dice (hash01, a seed) or into arithmetic (id % n) must use localId instead: the id counted
// from the world's own start (state.idBase, set in createWorld and saved with the world), the same in every world
// made from the same seed. Never use it on ids that are already world-local counters (war ids, battle unit ids...).
/** @type {(state: State, id: any) => any} */
export const localId = (state, id) => (typeof id === "number" ? id - (state.idBase || 0) : id);

// A normal start's weapons, handed out in this order (the crew card's Everything draws one again: ui/newgame.js randomizeOne).
export const START_WEAPONS = ["pistol", "machete", "huntrifle", "knife", "knife", "pistol", "knife", "machete"];

// The size def a world's map is built from (createWorld's options after Crashlanding's are fixed). cust: Custom mode's
// counts (a normal start with them); mapDef: the size def with them (the map's cities, towns and military sites).
function worldMapDef({ size = DEFAULT_SIZE, customW = null, customH = null, mode = "normal", custom = null }) {
  const cust = mode !== "hardcore" && custom ? cleanCustom(custom) : null; // Custom mode: a normal start with these counts
  // A custom grid that is exactly a preset's is that preset (2026-10-24: Crashlanding's 300 × 200 is the Large preset,
  // so its groups' default is Large's, not customDef's).
  const sdef = isCustom(size) ? (presetKeyFor(clampCustomW(customW), clampCustomH(customH)) ? sizeDef(presetKeyFor(clampCustomW(customW), clampCustomH(customH))) : customDef(customW, customH)) : sizeDef(size);
  return { sdef, cust, mapDef: cust ? customSizeDef(sdef, cust) : sdef };
}
// Whether createWorld with these options builds its map from the land kept from an earlier build (mapgen.js MAP_CACHE):
// the same seed, size and Custom counts. main.js shows no "Generating map…" box for it.
export function worldMapCached({ seed, crash = false, ...opts }) {
  if (crash) Object.assign(opts, { mode: "normal", custom: null, size: "custom", customW: CRASH.W, customH: CRASH.H });
  return mapCached(new Rng(seed).state, worldMapDef(opts).mapDef, seed);
}

// The new-run screen's world before its map is built (2026-10-24, the user: "Do not start the map generation until you
// start the game, or want to select a tile or view the map prior to starting"): createWorld with `preview` builds the
// settings' world on a tiny map, for the crew cards, their gear and the starting vehicles (the crew's own dice, crewDice,
// make it the very crew the real map gets), with state.preview = { groups: how many were asked for }. Its map, start,
// groups and hives are only stand-ins (ui/newgame.js says they are decided when the map is built); main.js builds the
// real world (the same crew) for Start, View map, Pick start on map and New start position.
export const PREVIEW_MAP = { W: 32, H: 24 };
export const isPreview = (state) => !!(state && state.preview);

// crew (optional): starting-colonist overrides from the new-run screen, by index:
// [{ name?, skills?, traits?, budget?, appearance?, gear?, leader? }]. Headless tools leave it out.
// size: a worldsize.js key (small / normal / large / huge; Normal when left out, the original 64 × 42 map), or
// "custom" with customW × customH hexes (experimental: worldsize.js customDef).
// hives (optional): how many hives the map starts with, 0–20 (null: what the size makes; mapgen.js).
// mode: "normal" (6–12 months after the outbreak, with a hub) or "hardcore" (the day Calder falls: hardcore.js).
// crewRoll (optional, every mode): the crew's own dice (crewDice; Hardcore: their backgrounds, what they grabbed and
// the car; the new-run screen's Randomize all rolls a new one); left out, crewRollOf the seed.
// startPeople (optional): Hardcore, how many flee together on day 1, 1–4 (hardcore.js START_PEOPLE; 3 when left out); a
// normal start, how many hold the hub, 1–8 (NORMAL_PEOPLE; 6 when left out). Kept as state.startPeople.
// start (optional): { roll, not } where you start drawn with dice of their own on the same map (the new-run screen's
// New start position; startpick.js): the hub's town, or the Hardcore roadside tile. Kept as state.startRoll. Or
// { tile }: the start picked on the map (Pick start on map), used when it can be one (startpick.js startWhyNot); kept as state.startTile.
// vehicle (optional, 2026-10-24, user request: "a toggle for start with a vehicle or not"): false, no starting vehicle
// (no pickup at the hub, no custom background's car; Hardcore flees on foot). Kept as state.startVehicles (custommode.js).
// custom (optional, Custom mode: custommode.js): { people, groups, hives, cities, towns, military }, each 1 or more, on a
// normal start (not with mode "hardcore"): they stand in for startPeople, factionCount and hives, and the map gets
// those cities, towns and military sites (customSizeDef). Kept as state.custom (isCustomRun).
// fleet (optional, 2026-10-24, user request: startfleet.js): the starting vehicles' slots [{ type, limit, load, empty }],
// one a starting survivor (fitFleet; Normal and Custom: at the hub; Hardcore: the car fled in and any kinds set, with
// the team), each back's load set on the new-run screen (null: as rolled). Kept as state.fleet (each with vid: its
// vehicle, null for an empty slot) until Start.
// crash (optional, 2026-10-24, the user's request "Crashlanding": crashmode.js, crashstart.js): true makes a Crashlanding
// run: a normal-mode world forced to a CRASH.W × CRASH.H map (300 × 200 since 2026-10-24: the Large preset's grid, so its
// size def is Large's; custom, vehicle, fleet and startPeople ignored:
// one survivor, no vehicle, no base), the crash tile drawn with `start` as a Hardcore start is, the wreck, the kit, the
// unit's base across the map and the calendar at year 4. Kept as state.crash (isCrashRun).
/**
 * @param {{ seed: number, factionCount: number, crew?: any[] | null, size?: string, mode?: string, customW?: number | null,
 *   customH?: number | null, hives?: number | null, crewRoll?: number | null, startPeople?: number | null, customBackgrounds?: any,
 *   start?: { roll?: number | null, not?: number | null, tile?: number | null } | null, worldCfg?: any, vehicle?: boolean, custom?: any, fleet?: any[] | null, crash?: boolean, preview?: boolean }} opts
 * @returns {State}
 */
export function createWorld({ seed, factionCount, crew = null, size = DEFAULT_SIZE, mode = "normal", customW = null, customH = null, hives = null, crewRoll = null, startPeople = null, customBackgrounds = null, start = null, worldCfg = null, vehicle = true, custom = null, fleet = null, crash = false, preview = false }) {
  const rng = new Rng(seed);
  if (crash) { mode = "normal"; custom = null; size = "custom"; customW = CRASH.W; customH = CRASH.H; vehicle = false; fleet = []; startPeople = 1; } // Crashlanding (crashmode.js): the map and the start are fixed
  const wantGroups = custom && mode !== "hardcore" ? cleanCustom(custom).groups : factionCount;
  if (preview) { size = "custom"; customW = PREVIEW_MAP.W; customH = PREVIEW_MAP.H; start = null; } // the new-run screen's world before its map (PREVIEW_MAP)
  const { sdef, cust, mapDef } = worldMapDef({ size, customW, customH, mode, custom });
  const worldSize = sdef.key;
  const map = generateMap(rng, mapDef, { hives: cust ? cust.hives : clampHives(hives), seed });
  /** @type {State} */
  const state = {
    seed, rng, worldSize, mode: mode === "hardcore" ? "hardcore" : "normal",
    startVehicles: vehicle !== false, // Start with a vehicle (custommode.js startsWithVehicle)
    ...(cust ? { custom: cust } : {}), // Custom mode's counts (custommode.js isCustomRun)
    fleet: cleanFleet(fleet, cust ? "custom" : mode === "hardcore" ? "hardcore" : "normal").map((f) => ({ ...f, vid: null })), // the starting vehicles (startfleet.js): vid set as each is made
    idBase: nextId - 1, // localId: this world's ids counted from its own start
    fleetV: 1, // several vehicles to a team (vehicles.js fleets: p.vehicleIds); save.js gives older saves the list
    kitV: 2, magFitV: 1, // carry kit (w2-kit): a new world in either mode is born with it (carrykit.js migrateKit is for older saves only; a hardcore world never set it and gained magazines on every load)
    woodcutting: 2, // a world with wood, 0.1 kg a unit (save.js: older saves are given it, or scaled to it, on load)
    rawWater: 1, // a world with purified and un-purified water (water.js; save.js: older saves are given it on load)
    foodTypes: 1, // a world with food by type (foods.js; save.js migrateFood: older saves are typed on load)
    sickRest: "all", // sickrest.js: the Work tab's "Sick people rest" (all, serious, off; save.js: older saves get "all")
    groupWorks: 1, // barestart: the AI groups' bases start bare and they build (groupworks.js); an older save has them built up
    worldPonds: 1, // ponds on the land (mapgen.js tile.pond, laid by generateMap); save.js: an older save gets them from its seed
    gunSlots: 1, attachV: 2, // (attachV: gunmods.js migrateParts, save.js) // a world with gun attachment slots (gunmods.js; save.js: older saves have their guns' parts moved on load)
    machinesV: 1, // machines-2: generators with no operator, the pressure canner fitted to a kitchen (save.js migrates older saves)
    genTiersV: 1, // gen-tiers: generators have tiers (power.js GEN_TIERS; save.js makes older saves' generators tier 1)
    cropV: 1, // placeable crop plots and built beds (buildings.js migrateCropPlots is for older saves only)
    toolsV: 1, // the tools: a new world in either mode is born with them (toolreqs.js migrateTools is for older saves only)
    raidMaps: 1, // raid maps by the World… dials (worldcfg.js RAID_MAPS; save.js: an older save keeps its old raid map sizes)
    prisonV: 1, // prisons and county jails as complexes of buildings (prison.js; save.js: an older save keeps its prison's one building)
    roomsV: 1, // homes furnished room by room (roomlayout.js; save.js: an older save keeps its buildings' old layouts)
    shapesV: 1, // buildings that are not boxes (buildingmaps.js spec.shape, issue #23; save.js: an older save keeps its rectangles)
    scaleV: 1, // buildings at real size (data-buildingsize.js; save.js: an older save keeps its buildings' old footprints and storeys)
    officesV: 1, // the office buildings of every kind and their firms (data-offices.js; save.js: an older save gets none)
    groupJails: 1, // jailhouse: the AI groups keep prisoners in jails they build, work them and trade them (groupjails.js); older saves: no limit
    grid: map.grid, tiles: map.tiles, cityId: map.cityId, originId: map.originId,
    cityIds: map.cityIds, militaryIds: map.militaryIds,
    hour: 6, // campaign starts at 06:00 on day 1
    survivors: [], bases: [], factions: [], parties: [], hordes: [], deathSites: [], routes: [], supplyRuns: [],
    knowledge: map.tiles.map(() => null), // per tile: last snapshot the player has
    log: [], cards: [], vehicles: [], markers: [],
    engagement: null, trade: null, live: new Set(),
    gameOver: false, started: false,
    stats: { peopleSaved: 0, raidsRepelled: 0 },
  };

  // Custom backgrounds (custombg.js) the new-run screen passes in: the world keeps its own copy (saved with it), so a
  // hardcore crew's picks resolve whatever the browser's list holds later. Not in a world without any.
  const bgs = customBackgrounds ? sanitizeLibrary(customBackgrounds) : {};
  if (Object.keys(bgs).length) state.customBackgrounds = bgs;
  if (preview) state.preview = { groups: wantGroups }; // PREVIEW_MAP: the groups asked for (the tiny map may not hold them all)
  if (start && start.roll != null) state.startRoll = start.roll; // startpick.js: a start of its own on this map
  if (start && start.tile != null) state.startTile = start.tile; // startpick.js: the start picked on the map
  setWorldCfg(state, worldCfg); // worldcfg.js: the run's dials (the new-run screen's World… window), before the groups and hives are made
  if (crash) {
    // Crashlanding (crashstart.js): the calendar at year 4, the crash tile and the unit's base before the points of
    // interest (the base's site gets its own), then the groups, the survivor and the kit, the wreck, the hives and the loot.
    prepareCrash(state, start);
    noteLootAge(state); // itemcond.js: the loot rolled from here on is three years old
    setupCrashStart(state, { factionCount, crew });
    return state;
  }
  noteLootAge(state); // itemcond.js: the loot rolled from here on is as old as this world (a new world: year 1)
  ensurePois(state); // pois.js: every tile's points of interest (hash dice from the seed: the map's dice are untouched)
  if (state.mode === "hardcore") {
    hardcoreCreate(state, { factionCount, crew, crewRoll, start, ...(startPeople != null ? { startPeople } : {}) });
    ensureHives(state);
    hardcoreAfterHives(state);
    state.ammoCal = 2; // rounds by calibre from the start (save.js migrates older saves)
    state.stacks = 1; // stacks in a slot from the start (itemstack.js; save.js tidies older saves)
    state.physOutV = 1; // guns and magazines hold physical rounds out of a fight from the start (itemacts.js; save.js loads up older saves)
    loadUpAll(state, { stores: false }); // itemacts.js: the guns and magazines they got out with loaded from the rounds they carry (the team's supplies too at Start: main.js)
    updateVision(state);
    log(state, `Day 1. Calder is falling. ${state.startPeople === 1 ? "You got out alone" : `${countWord(state.startPeople).replace(/^./, (c) => c.toUpperCase())} of you got out`} with what you could carry. ${state.factions.length + (state.hardcore?.groups?.bands?.length || 0)} other groups are out there somewhere.`, "info");
    startChronicle(state);
    return state;
  }

  // Player hub: open land far from the outbreak origin, the cities and the National Guard bases, but not off in a
  // corner of the state: within 30 tiles of a city and a few tiles from the map edge. Never in a town or a city, and
  // START_CLEAR tiles or more from them and the hives (the user's requests 2026-10-22: startpick.js startNear; it was a
  // town until then); bare land first (no site on the tile), then any.
  const g = state.grid;
  const near = startNear(state);
  const open = state.tiles.filter((t) => t.terrain !== "water" && t.terrain !== "mountain" && !t.hive && !isSettlementTile(t) && !near.has(t.id) && !state.militaryIds.includes(t.id));
  const bare = open.filter((t) => !t.loc);
  const land = bare.length ? bare : open;
  // The extra hot spots of Large and Huge maps (mapgen.js spotIds) count as the origin does.
  const farFrom = (t, origin, city, mil) => g.distance(t.id, state.originId) >= origin && map.spotIds.every((s) => g.distance(t.id, s) >= origin - 4) &&
    state.cityIds.every((c) => g.distance(t.id, c) >= city) && state.militaryIds.every((m) => g.distance(t.id, m) >= mil);
  const central = (t) => t.x >= 4 && t.y >= 3 && t.x < g.width - 4 && t.y < g.height - 3 && state.cityIds.some((c) => g.distance(t.id, c) <= 30);
  // Large and Huge maps (worldsize.js hiveClear): farther from the hives at first, so the early game is no harsher
  // than a Normal map's.
  const clear = sdef.hiveClear;
  const clearCandidates = clear ? land.filter((t) => farFrom(t, clear, 12, 12) && central(t)) : [];
  const hubCandidates = clearCandidates.length ? clearCandidates : land.filter((t) => farFrom(t, 16, 12, 12) && central(t));
  const nearCandidates = land.filter((t) => farFrom(t, 12, 8, 8));
  const anyLand = () => state.tiles.filter((t) => t.terrain !== "water" && t.terrain !== "mountain" && !t.hive && !isSettlementTile(t));
  // On a road first (the truck's way out, as the towns' roads were), then anywhere that fits.
  const rolled = pickStart(rng, [() => hubCandidates.filter((t) => t.road && !t.bridge), () => hubCandidates, () => nearCandidates, () => land, anyLand], start); // startpick.js
  const hubTile = chosenStart(state, start) || rolled; // a tile picked on the map (the die above is cast all the same)
  state.bases.push({
    id: newId(), tile: hubTile.id, type: "hub", name: `${nearestTownName(state, hubTile.id)} Holdout`, // named for the nearest town
    // Fuel is scarce (economy rework). Food: two weeks for six plus a few shelves of canned and jarred food, in the
    // main house's cellar (storage.js); water for the first dry days while the sown fields get going; a woodpile
    // (woodcutting.js: the winter's heating is cut later).
    // Bare start (HUB_START): every building plot free; the main house gives the well and the cellar (buildings.js; no
    // wall, which is built on the Defenses tab) and no beds or crop plots of its own: the start's are built on the base
    // map (HUB_LAYOUT, below). The scrap and parts are for the first builds, the player's (or the governor's) pick: a
    // bunkhouse, a crafting bench, a farm plot and a rain catcher.
    // Food by type (foods.js): 80 days of a town's stores (cans, rice, pasta, oats, a few sacks of potatoes and onions)
    // and 10 of food that keeps (jars, jerky, peanut butter).
    stock: { water: 50, rawwater: 0, fuel: 12, meds: 6, ammo: 80, arrows: 0, parts: HUB_START.parts, scrap: HUB_START.scrap, jars: 12, wood: 1000, stone: 60, buildmat: 0, metalsheet: 0, propane: 0, // stone (stone.js, 2026-10-23): a first outpost's camp fire and a cook fire or a boiler
      // wood: 300 for the fires and 700 more since it builds too (woodwork 2026-10-20: a bunkhouse 600 and a bench 200 or a farm plot 300; the governor fells trees for the rest)
    ...addFoodsTo(typedFood(state, "stores", 80), typedFood(state, "keeps", 10)) },
    radio: false, watchtower: false, buildings: [], construction: [], armory: [],
  });
  const hubBase = state.bases[0];
  hubLayout(state, hubBase);
  // Six people (by default) in the hub's six beds from the first hour (more sleep rough): the new-run screen and the
  // first-week guide say so, so the Overcrowded card (moveout.js) waits its usual days before it asks (and is not shown
  // at all once beds are up).
  const people = cust ? clampStartPeople(cust.people, "custom") : clampStartPeople(startPeople ?? NORMAL_PEOPLE.DEF, "normal"); // Custom mode: 1–30
  state.startPeople = people;
  const startBeds = baseBeds(hubBase);
  if (people > startBeds) hubBase.crowdNote = { hour: state.hour, over: people - startBeds };
  // The starting vehicles at the hub (startfleet.js): a slot a survivor, each with its kind or empty; made once who they
  // were is known (hardcore-start.js rollHubFleet, below). Start with a vehicle off: none.
  state.fleet = fitFleet(state.fleet, people, cust ? "custom" : "normal").map((f) => ({ ...f, vid: null }));

  createFactions(state, cust ? cust.groups : factionCount);
  recomputeOwnership(state);

  const endCrew = crewDice(state, crewRoll); // the crew's own dice, to loadUpAll below
  for (let i = 0; i < people; i++) state.survivors.push(makeSurvivor(state, i === 0 ? 1.3 : 1));
  // Starting gear: a few basics spread among the colonists (a seventh and eighth start with a knife and a machete; Custom
  // mode's ninth and on go round the list again).
  state.survivors.forEach((s, i) => (s.gear.weapon = newItem(START_WEAPONS[i % START_WEAPONS.length], 1, hash01(state.seed, "startdur", i), START_DUR))); // part-worn (inventory.js START_DUR)
  state.survivors.forEach((s, i) => randomStarterMods(state.rng, s.gear.weapon, i)); // gunmods.js: a cheap part or two on some guns
  // Built on Customize's points (crew[i].points): what the dice hand them is theirs only as picks, so none of it
  // overflows to the hub (the dice are drawn all the same).
  const onPoints = (i) => !!(crew && crew[i] && crew[i].points);
  state.survivors.forEach((s, i) => { const box = starterLoad(state.rng, s.gear.weapon, i); if (box && !pocketBox(s, box) && !onPoints(i)) state.bases[0].stock[box.key] = (state.bases[0].stock[box.key] || 0) + box.dur; }); // ammo.js: now and then a typed load and a box of it
  state.survivors.forEach((s, i) => starterMags(s, onPoints(i) ? null : state.bases[0].armory)); // carrykit.js: two spare magazines with a starting gun (section 15)
  state.kitV = 2; // carry kit: rigs, magazines as items, carriers with plates (carrykit.js migrateKit for older saves)
  state.survivors[0].gear.armor = newItem("vest", 1, hash01(state.seed, "startdur", "vest"), START_DUR);
  for (const k of HUB_TOOLS) state.bases[0].armory.push(newItem(k, 1, hash01(state.seed, "startdur", `tool:${k}`), START_DUR)); // hashed dice: the world's are untouched
  state.survivors.forEach((s) => (s.location = { kind: "base", baseId: state.bases[0].id }));
  state.survivors[0].leader = true;
  // Who they were (hardcore-start.js normalStartBackgrounds, 2026-10-07): a background each, with dice of their own,
  // before the new-run screen's edits; a custom background's kit after them.
  normalStartBackgrounds(state, crew);
  if (crew) applyCrew(state, crew);
  normalStartKit(state, hubBase);
  rollHubFleet(state, hubBase); // hardcore-start.js: the starting vehicles rolled by whose they are, their backs into the stores (2026-10-25)
  seatDrivers(state); // startfleet.js: one of them at each vehicle's wheel (the new-run screen's pick, else its owner, else in order)
  normalStartGear(state, hubBase); // startgear.js: the gear picked on the new-run screen (what it replaces to the armory)
  assignStartingRoles(state);
  settleAll(state); // ammo.js: the hub's 80 rounds by the calibres of the guns it starts with
  state.ammoCal = 2; // rounds by calibre from the start (save.js migrates older saves)
  state.stacks = 1; // stacks in a slot from the start (itemstack.js; save.js tidies older saves)
  state.physOutV = 1; // guns and magazines hold physical rounds out of a fight from the start (save.js loads up older saves)
  loadUpAll(state, { stores: false }); // itemacts.js: every gun and magazine the crew carries loaded from the rounds each carries; at Start (main.js) out of the hub's stores too, after the new-run screen's edits (the world's stock stays whole until the run starts)
  endCrew();

  seedRoadCarts(state); // carts.js: now and then a cart abandoned on a road near a town (its own dice)
  ensureHives(state); // the hives mapgen.js placed, with their starting resources (hives.js)
  // Pre-war maps: geography is known, current conditions are not.
  updateVision(state);
  log(state, `Day 1. ${state.bases[0].name} is all that is left. ${state.factions.length} other groups are out there somewhere.`, "info");
  startChronicle(state); // timelapse recording (sim/chronicle.js)
  return state;
}

// What the normal start's hub has built on its map (the user's request 2026-10-22: "Beds for hubs/bases are determined
// by built beds in the base map so the normal mode base map should start with 6 beds in a building or some tents and
// beds in a building"): a Lodge with HUB_LAYOUT.beds beds set in it and a two-person tent pitched from its bag (6 beds
// in all), and HUB_LAYOUT.plots crop plots dug (sown before the fall: farming.js farmOf). Placed by the game (the auto
// layout: the beds on the Lodge's floor, the plots on soil); moved, picked up and struck like any built thing.
export const HUB_LAYOUT = { beds: 4, tents: ["tent2"], plots: 8 };
function hubLayout(state, base) {
  const startdur = (k, i) => hash01(state.seed, "startdur", `layout:${k}:${i}`); // hashed dice: the world's are untouched
  addBuilding(base, "gen_lodge");
  for (let i = 0; i < HUB_LAYOUT.beds; i++) { base.armory.push(newItem("bed", 1, startdur("bed", i), START_DUR)); setFurniture(state, base, "bed"); }
  HUB_LAYOUT.tents.forEach((k, i) => pitchTentAtBase(state, base, k, newItem(k, 1, startdur(k, i), START_DUR)));
  for (let i = 0; i < HUB_LAYOUT.plots; i++) addBuilding(base, "farm_plot");
}

// The town or city nearest a tile (the hub's name: "<town> Holdout"), by its centre.
function nearestTownName(state, id) {
  let best = null, bd = Infinity;
  for (const t of state.tiles) if (t.loc && (t.loc.type === "town" || t.loc.type === "city")) { const d = state.grid.distance(id, t.id); if (d < bd) { bd = d; best = t; } }
  return best ? best.loc.name : "Calder";
}

/** @param {State} state @returns {Survivor} */
export function makeSurvivor(state, quality = 1) {
  const rng = state.rng;
  /** @type {Survivor["skills"]} */
  const skills = {};
  for (const k of ROLLED_SKILLS) skills[k] = Math.max(0, Math.min(20, Math.round(rng.range(0, 9) * quality)));
  // Each survivor gets one or two specialties.
  for (let i = 0; i < 2; i++) skills[rng.pick(ROLLED_SKILLS)] += rng.int(3, 7);
  for (const k of ROLLED_SKILLS) skills[k] = Math.min(20, skills[k]);
  skills.crafting = craftingStart(state.seed, (state.peopleMade || 0) + 1, skills.mechanics, quality); // its own dice (appearance.js)
  skills.melee = meleeStart(state.seed, (state.peopleMade || 0) + 1, quality); // its own dice too (appearance.js)
  skills.cooking = cookingStart(state.seed, (state.peopleMade || 0) + 1, skills.farming, quality); // and Cooking (appearance.js)
  // The world's dice draw the traits as ever; the newer ones come in with dice of their own (traits.js), keyed like the
  // looks below by the seed and how many people this world has made.
  const born = rollTraits(rng, null);
  const traits = swapNewTraits([...born], traitDice(state.seed, (state.peopleMade || 0) + 1));
  /** @type {Survivor} */
  const s = {
    id: newId(),
    name: freshName(state),
    skills, traits, health: 100, mood: 60, alive: true, leader: false,
    // Hunger and thirst gauges (needs.js NEEDS.max) start full here, not at the next hourly needs pass: a survivor
    // made in the tick before a save would otherwise come back from it with them added (save.js) and differ.
    hunger: 100, thirst: 100,
    // Worn and held gear (inventory.js): hands, off hand, body, head, arms, legs, pack; plus 4 pockets.
    gear: { weapon: null, armor: null, tool: null, head: null, arms: null, legs: null, backpack: null },
    pockets: [null, null, null, null],
    location: null, role: "farm",
  };
  // A tier for each trait (traits.js rollTiers): dice of its own, keyed like the swap, so the world's are untouched.
  rollTiers(s, state.seed, (state.peopleMade || 0) + 1);
  // Own rng keyed by seed + how many people this world has made: same seed, same faces,
  // and the world's rng sequence is untouched.
  state.peopleMade = (state.peopleMade || 0) + 1;
  s.appearance = appearanceFor(state.seed, state.peopleMade);
  noteBornTraits(s, born); // what the world's dice rolled (a start's backgrounds weigh their trait by it)
  return s;
}

// One or two traits, never two that clash (data.js TRAIT_CLASH) (makeSurvivor; the new-run screen's Randomize all; a
// child's own). Drawn from BIRTH_TRAITS with rng, as they always were; then the newer traits come in with `dice`
// (traits.js swapNewTraits; null: not here, the caller does it with dice of its own).
/** @param {import("./rng.js").Rng} rng @param {{ next: () => number } | null} [dice] @returns {string[]} */
export function rollTraits(rng, dice = rng) {
  const traits = [];
  const count = rng.chance(0.6) ? 1 : 2;
  while (traits.length < count) {
    const t = rng.pick(BIRTH_TRAITS);
    if (!traits.includes(t) && !clashIn(traits, t)) traits.push(t);
  }
  return dice ? swapNewTraits(traits, dice) : traits;
}

// A name nobody in this world has had: no first name twice while one is free (messages use first names), and
// never a full name twice. Two rng picks, as before, unless a full name has to be re-rolled.
const firstOf = (name) => String(name).split(" ")[0];
/** @param {State} state @returns {string} */
function freshName(state) {
  const rng = state.rng;
  const given = state.namesGiven || (state.namesGiven = []);
  const names = [...state.survivors.map((s) => s.name), ...given];
  const firsts = new Set(names.map(firstOf));
  let pool = FIRST_NAMES.filter((f) => !firsts.has(f));
  if (!pool.length) {
    // Every first name has been used: at least keep clear of the living.
    const living = new Set(state.survivors.filter((s) => s.alive).map((s) => firstOf(s.name)));
    pool = FIRST_NAMES.filter((f) => !living.has(f));
  }
  const first = rng.pick(pool.length ? pool : FIRST_NAMES);
  let name = `${first} ${rng.pick(LAST_NAMES)}`;
  for (let i = 0; i < 8 && names.includes(name); i++) name = `${first} ${rng.pick(LAST_NAMES)}`;
  given.push(name);
  return name;
}

// Renames a survivor. An empty name, or a full name someone else alive already has, is refused.
// Returns "" when the name is set (or unchanged), else the reason.
/** @param {State} state @param {Survivor} s @param {string} name @returns {string} */
export function renameSurvivor(state, s, name) {
  if (!s) return "Nobody to rename.";
  const n = String(name ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().replace(/\s+/g, " "); // no control characters or < > (as basenames.js cleanName): names go into the UI's HTML
  if (!n) return "A name cannot be empty.";
  if (n === s.name) return "";
  if (state.survivors.some((o) => o !== s && o.alive && o.name.toLowerCase() === n.toLowerCase())) return `There is already a ${n} in the group.`;
  s.name = n;
  return "";
}

// Starting-colonist overrides (new-run screen). Never touches state.rng.
/** @param {State} state @param {any[]} crew */
export function applyCrew(state, crew) {
  if (crew.some((c) => c && c.leader)) state.survivors.forEach((s) => (s.leader = false));
  state.survivors.forEach((s, i) => {
    const c = crew[i];
    if (!c) return;
    // What the dice made of them, before any edit (the new-run screen's "Start from the dice" loads it; not saved:
    // startgear.js clearStartGear takes it off at Start).
    s.diceRoll = { skills: { ...s.skills }, traits: [...s.traits], traitTier: { ...(s.traitTier || {}) } };
    if (c.name && String(c.name).trim()) s.name = String(c.name).trim();
    if (c.skills) for (const k of SKILLS) if (c.skills[k] != null) s.skills[k] = Math.max(0, Math.min(20, Math.round(c.skills[k])));
    // Traits and the skill-point budget belong to the edited colonist, not to the seed.
    if (Array.isArray(c.traits)) s.traits = [...new Set(c.traits.filter((t) => TRAITS[t]))].filter((t, i, all) => !clashIn(all.slice(0, i), t)); // none that clash (data.js TRAIT_CLASH): the first stays
    // Their tiers go with them (traits.js; a trait kept from the dice without one keeps the dice's tier).
    if (Array.isArray(c.traits)) tidyTiers(s, c.traitTier && typeof c.traitTier === "object" ? Object.fromEntries(Object.entries(c.traitTier).map(([t, n]) => [t, cleanTier(t, n)])) : s.traitTier || {});
    if (Number.isFinite(c.budget)) s.skillBudget = c.budget;
    if (c.appearance) s.appearance = { ...c.appearance };
    // A normal start's weapon and armor (Randomize all hands the kit out again). Hardcore's come from what they grabbed.
    if (c.gear && state.mode !== "hardcore") for (const k of ["weapon", "armor"]) if (k in c.gear) s.gear[k] = c.gear[k] && GEAR[c.gear[k].key] ? { ...c.gear[k] } : null;
    // Gear picked on the new-run screen (startgear.js: put on after the dice and any custom background's kit, both modes).
    const sg = sanitizeStartGear(c.startGear);
    if (sg) s.startGear = sg; else delete s.startGear;
    if (hasPicks(sg)) s.startCustom = true;
    if (c.leader) s.leader = true;
    // Customized past the dice on the new-run screen (free skills, traits, a picked background: ui/newgame.js), which an
    // Ironman run may not start with.
    if (c.custom) s.startCustom = true;
    // Built on customization points (custompoints.js): their picks are what they have, the dice's kit is not handed out
    // on top (startgear.js). (The starting vehicles' backs are no longer theirs: startfleet.js, createWorld's fleet.)
    if (c.points) { s.startPoints = true; s.startCustom = true; }
    // Their own points max, set on their card (custompoints.js maxFor; else the crew's Points each).
    if (Number.isFinite(c.ownMax)) s.ownMax = c.ownMax; else delete s.ownMax;
  });
}

// Starting jobs by skill instead of list order: the two best farmers farm, then the best scavenger scavenges,
// the best shot guards and the best two mechanics build; anyone left (a bigger crew) farms too. Nobody starts on the ammo
// bench (the hub opens with plenty of ammo and little food). Also called when the run begins, so skills
// edited on the new-run screen count.
// Two builders (the best two at Mechanics): the hub starts bare, and the first beds, bench and fields are theirs to put up.
const START_ROLES = [["farm", "farming"], ["farm", "farming"], ["scavenge", "scavenging"], ["guard", "shooting"], ["build", "mechanics"], ["build", "mechanics"]];
/** @param {State} state */
export function assignStartingRoles(state) {
  const h = hub(state);
  if (!h) return; // hardcore: no hub yet (hardcore-start.js), the survivors are a team on the road
  const pool = atBase(state, h.id);
  for (const s of pool) { s.role = "farm"; s.station = null; }
  for (const [role, key] of START_ROLES) {
    if (!pool.length) break;
    const best = pool.reduce((a, s) => (skill(s, key) > skill(a, key) ? s : a), pool[0]);
    best.role = role;
    pool.splice(pool.indexOf(best), 1);
  }
  assignStations(state, h);
}

// ---------- shared helpers ----------
/** @type {(state: State) => number} */
export const day = (state) => Math.floor(state.hour / 24) + 1;
/** @type {(state: State) => number} */
export const hourOfDay = (state) => state.hour % 24;
/** @type {(state: State) => boolean} */
export const isNight = (state) => hourOfDay(state) < 6 || hourOfDay(state) >= 20;

/** @param {State} state @param {string} text @param {string} [kind] */
export function log(state, text, kind = "info") {
  text = text.replace(/(\w)\.\.(?=\s|$)/g, "$1."); // a name ending in a full stop at the end of a sentence ("Long Haul Co.."); "..." stays
  const line = { hour: state.hour, text, kind };
  state.log.unshift(line);
  if (state.log.length > 200) state.log.pop();
  diaryRecord(state, line); // every line of the run, day by day (diary.js)
}

/** @param {State} state @param {Card} card */
export function addCard(state, card) {
  state.cards.push(card);
}

/** @type {(state: State) => Base | undefined} */
export const hub = (state) => state.bases.find((b) => b.type === "hub");
/** @type {(state: State, id: number) => Base | undefined} */
export const baseById = (state, id) => state.bases.find((b) => b.id === id);
/** @type {(state: State, id: number) => Survivor | undefined} */
export const survivorById = (state, id) => state.survivors.find((s) => s.id === id) || (state.vols ? state.vols.people.find((s) => s.id === id) : undefined); // volunteers.js: an allied group's people with your teams
/** @type {(state: State) => Survivor[]} */
export const alive = (state) => state.survivors.filter((s) => s.alive);
/** @type {(state: State, baseId: number) => Survivor[]} */
export const atBase = (state, baseId) => alive(state).filter((s) => s.location.kind === "base" && s.location.baseId === baseId);
// Out of the walls on a job trip (jobtrips.js s.trip: from leaving the gate to coming back in) at time t (hours): not
// at hand for a fight at the base. THE "who is home" check: battles at the base (combat.js combatants), the defence by
// the numbers (factions.js baseDefense, defences.js), outsiders' raids (visitors.js) all read it. Other things that
// take people away from the walls (sim/fieldworks: a watch tower, a stockpile) can mark s.away = { until } for the same.
export const outOnTrip = (state, s, t = state.hour) => !!(s && ((s.trip && s.trip.leave <= t && t < s.trip.home) || (s.away && s.away.until > t)));
export const isHome = (state, s, t = state.hour) => !!s && s.alive && s.location.kind === "base" && !outOnTrip(state, s, t);
// The people at a base who are inside the walls now (atBase less those out on a trip).
export const homeAt = (state, baseId, t = state.hour) => atBase(state, baseId).filter((s) => !outOnTrip(state, s, t));
/** @type {(state: State, id: any) => import("./types").Faction | undefined} */
export const factionById = (state, id) => state.factions.find((f) => f.id === id);
// Everyone who lives at a base: the people there, plus (at the hub) trade-route escorts waiting between trips, and the
// lookouts posted at the base's field works (fieldworks.js). They eat, heal and can be treated there; they do no base
// work and are not in a base battle (atBase leaves them out).
/** @param {State} state @param {number} baseId @returns {Survivor[]} */
export function residents(state, baseId) {
  const h = hub(state);
  const hubId = h ? h.id : null;
  return alive(state).filter((s) => (s.location.kind === "base" && s.location.baseId === baseId) || (s.location.kind === "route" && baseId === hubId) || (s.location.kind === "post" && s.location.baseId === baseId)); // fieldworks.js: lookouts posted at a field work, fed from their base
}
/** @param {Survivor} s */
const isFree = (s) => s.alive && !(s.location && s.location.kind === "captive");

// Crafting for someone from before the skill (save.js, skills.js ensureSkills): 0.7 × Mechanics, the floor too.
/** @param {Survivor} s */
export function fillCrafting(s) {
  if (!s || !s.skills || Number.isFinite(s.skills.crafting)) return;
  s.skills.crafting = Math.round(CRAFT_START.oldSave * (s.skills.mechanics || 0));
  if (s.skillFloor && !Number.isFinite(s.skillFloor.crafting)) s.skillFloor.crafting = s.skills.crafting;
}
// Melee (data.js SKILLS, 2026-10-09): people from before the skill (a save, prisoners, visitors, anyone carrying skills)
// get half their Shooting plus 0-6 by a hash of their name (appearance.js meleeOldSave), their skill floor too, and no perk
// point for the milestones that already puts them past (skills.js: the next milestone is the first that gives one).
export function fillMelee(s) {
  if (!s || !s.skills || Number.isFinite(s.skills.melee)) return;
  s.skills.melee = meleeOldSave(s.name, s.skills.shooting);
  if (s.skillFloor && !Number.isFinite(s.skillFloor.melee)) s.skillFloor.melee = s.skills.melee;
  if (s.perkMs && s.perkMs.melee == null) { let ms = 0; for (const m of [5, 10, 15]) if (s.skills.melee >= m) ms = m; if (ms) s.perkMs.melee = ms; }
}
// Cooking (data.js SKILLS, 2026-10-10; kitchen.js): people from before the skill get half their Farming plus 0-4 by a
// hash of their name (appearance.js cookingOldSave), their skill floor too, and no perk point for milestones passed.
export function fillCooking(s) {
  if (!s || !s.skills || Number.isFinite(s.skills.cooking)) return;
  s.skills.cooking = cookingOldSave(s.name, s.skills.farming);
  if (s.skillFloor && !Number.isFinite(s.skillFloor.cooking)) s.skillFloor.cooking = s.skills.cooking;
  if (s.perkMs && s.perkMs.cooking == null) { let ms = 0; for (const m of [5, 10, 15]) if (s.skills.cooking >= m) ms = m; if (ms) s.perkMs.cooking = ms; }
}
// What the Melee skill does (combat.js playerUnit, meleeOdds; stealth.js subdueOdds; combatPower below). MID: the level
// that fights as everyone did before the skill (the average rolled colonist is about 5.5); each point above or below it
// is AIM to hit in melee (75 at MID, 65 at 0, 85 at 10, 95 at 15: the cap) and DMG of melee damage (× 0.85 at 0, × 1.15
// at 10, × 1.3 at 15); TAKEDOWN to a takedown's chance; POWER: a melee wielder's fighting strength by the numbers counts
// Melee where a gunman's counts Shooting (1 + 0.25 × the skill).
export const MELEE_SKILL = { MID: 5, AIM: 2, DMG: 0.03, TAKEDOWN: 1, POWER: 0.25 };
/** @param {Survivor} s */
export const meleeAimBonus = (s) => (skill(s, "melee") - MELEE_SKILL.MID) * MELEE_SKILL.AIM;
/** @param {Survivor} s */
export const meleeDmgMult = (s) => Math.max(0.5, 1 + (skill(s, "melee") - MELEE_SKILL.MID) * MELEE_SKILL.DMG);
// Holds a melee weapon (data.js cat "melee") they can use.
/** @param {Survivor} s */
export function meleeArmed(s) {
  const it = s && s.gear ? s.gear.weapon : null;
  const d = it ? GEAR[it.key] : null;
  return !!d && d.cat === "melee";
}
/** @param {Survivor} s @param {string} key @returns {number} */
export function skill(s, key) {
  let v = s.skills[key] || 0;
  if (key === "crafting" && s.skills.crafting == null) v = Math.round(CRAFT_START.oldSave * (s.skills.mechanics || 0)); // people from before the skill (save.js fills it in)
  if (key === "melee" && s.skills.melee == null) v = meleeOldSave(s.name, s.skills.shooting); // the same (fillMelee)
  if (key === "cooking" && s.skills.cooking == null) v = cookingOldSave(s.name, s.skills.farming); // the same (fillCooking)
  v += traitSkill(s, key); // Former Medic, Loud, Farm-Raised, Persuasive, Lucky, Unlucky, Nearsighted, Squeamish, by tier (traits.js)
  return Math.max(0, v);
}

// Skill gap rule from the design doc: slightly below = weaker, below = weaker + damage risk, really below = unusable.
/** @param {Survivor} s @param {Item | null} item @returns {{ mult: number, damageChance: number, usable: boolean, gap: number }} */
export function gearEffect(s, item) {
  if (!item) return { mult: 0, damageChance: 0, usable: false, gap: 0 };
  const def = GEAR[item.key];
  const have = def.skill ? skill(s, def.skill) : 99;
  const gap = def.req - have;
  if (gap <= 0) return { mult: 1, damageChance: 0, usable: true, gap };
  if (gap <= 3) return { mult: 0.85, damageChance: 0, usable: true, gap };
  if (gap <= 7) return { mult: 0.65, damageChance: 0.05, usable: true, gap };
  return { mult: 0, damageChance: 0, usable: false, gap };
}

/** @param {Survivor} s @returns {number} */
export function combatPower(s) {
  const w = s.gear.weapon ? GEAR[s.gear.weapon.key] : null;
  const eff = gearEffect(s, s.gear.weapon);
  let p = 1 + skill(s, w && w.cat === "melee" ? "melee" : "shooting") * MELEE_SKILL.POWER + (w && eff.usable ? w.power * eff.mult * (s.gear.weapon.quality || 1) : 0); // a melee weapon: Melee (MELEE_SKILL)
  p += armorPower(s) * 0.5; // every worn piece (body, head, arms, legs)
  p += traitPower(s); // Brave +, Coward − by tier (traits.js)
  if (hasPerk(s, "gunslinger")) p += 1.5; // skills.js perk
  if (w && w.cat === "melee" && hasPerk(s, "pitfighter")) p += 1.5; // skills.js perk (Melee 15)
  return Math.max(0.5, p * (0.5 + s.health / 200));
}

// ---------- what people shoot: bows arrows, guns ammo ----------
// A bow or crossbow (data.js cat "bow") shoots arrows (SUPPLIES.arrows: crafted, found, picked up again after a won
// fight); every other weapon shoots ammo. By the numbers everyone without a bow counts with the guns, as they always
// did (fists and blades too: a dropped gun is picked up). BACK: the share of the arrows shot that are picked up again
// after a win (none after a loss or a retreat); PACK: the arrows a trip packs for each bow (the planner's Auto-fill,
// the autopilot), a hunting team's dozen (hunting.js ARROW.pack).
export const ARROWS = { BACK: 0.5, PACK: 12 };
/** @param {Survivor} s @returns {boolean} */
export function usesArrows(s) {
  const it = s && s.gear ? s.gear.weapon : null;
  const d = it ? GEAR[it.key] : null;
  return !!(d && d.cat === "bow" && gearEffect(s, it).usable);
}
/** @param {Survivor[]} people @returns {number} */
export const archerCount = (people) => people.filter(usesArrows).length;
// The arrows picked up again after a won fight in which `shot` were loosed.
/** @param {number} shot @returns {number} */
export const arrowsBack = (shot) => Math.round(Math.max(0, shot || 0) * ARROWS.BACK);
// What having enough to shoot is worth by the numbers: the archers' combat power at `short` while the arrows are under
// need(archers), everyone else's while the ammo is under need(the rest); the power-weighted mean of the two (1 with
// enough of both). weight(s): a person's share (a guard counts more). With no bows it is exactly the old rule (ammo
// under need(everyone): short).
// ammo: a number (any rounds for anyone, the old rule) or a stock record (rounds by calibre, ammo.js): then each gun
// counts by the rounds of its own calibre (generic ammo, other groups' abstract stores, fits any), need(how many guns
// of that calibre); people with no gun by every round there, need(how many of them).
/** @param {Survivor[]} people @param {number | Record<string, number>} ammo @param {number} arrows @param {{ need?: (n: number) => number, short?: number, weight?: ((s: Survivor) => number) | null }} [opts] @returns {number} */
export function armedFactor(people, ammo, arrows, { need = (n) => n * 3, short = 0.6, weight = null } = {}) {
  let gun = 0, bow = 0, ng = 0, nb = 0;
  const gunners = [];
  for (const s of people) {
    const p = combatPower(s) * (weight ? weight(s) : 1);
    if (usesArrows(s)) { bow += p; nb++; } else { gun += p; ng++; gunners.push(s); }
  }
  const per = typeof ammo === "object" && ammo ? gunsArmed(gunners, ammo, need, (s) => combatPower(s) * (weight ? weight(s) : 1)) : null;
  const fg = per ? (per.tot > 0 ? (per.ok + (per.tot - per.ok) * short) / per.tot : 1) : (typeof ammo === "number" ? ammo : 0) >= need(ng) ? 1 : short, fb = (arrows || 0) >= need(nb) ? 1 : short;
  if (!nb) return fg;
  if (!ng) return fb;
  return gun + bow > 0 ? (gun * fg + bow * fb) / (gun + bow) : 1;
}
// Shots by the numbers taken from a stock (a base's, a team's supplies): perHead a head, the archers' in arrows, the
// rest's in rounds of their own gun's calibre (ammo.js drawShots: no gun, any rounds), as far as there are any.
// Returns what was taken: { ammo, used: { key: q }, arrows }.
/** @param {Record<string, number>} stock @param {Survivor[]} people @param {number} perHead @returns {{ ammo: number, used: Record<string, number>, arrows: number }} */
export function spendShots(stock, people, perHead) {
  const nb = archerCount(people);
  // The stores (a team's bags, a base's stock) first, then the loose rounds the shooters carry (ammo.js carriedRec:
  // their rounds at hand, carrykit.js packShells), as a fight's Reload draws on them.
  const gunners = people.filter((s) => !usesArrows(s));
  const onThem = carriedRec(gunners);
  const both = { ...stock };
  for (const [k, q] of Object.entries(onThem)) both[k] = (Number.isFinite(both[k]) ? both[k] : 0) + q;
  const before = { ...both };
  const d = drawShots(both, gunners, perHead);
  for (const [k, q0] of Object.entries(before)) {
    const used = q0 - (Number.isFinite(both[k]) ? both[k] : 0);
    if (!(used > 0)) continue;
    const fromStock = Math.min(used, Math.max(0, Number.isFinite(stock[k]) ? stock[k] : 0));
    if (fromStock > 0) stock[k] -= fromStock;
    if (used - fromStock > 0) spendCarried(gunners, k, used - fromStock);
  }
  let arrows = 0;
  if (nb) {
    const b0 = stock.arrows || 0;
    stock.arrows = Math.max(0, b0 - nb * perHead);
    arrows = Math.max(0, b0 - stock.arrows);
  }
  return { ammo: d.n, used: d.used, arrows };
}

/** @param {State} state @returns {number} */
export function playerStrength(state) {
  return alive(state).reduce((sum, s) => sum + combatPower(s), 0);
}

// opts.raw: damage that armor and toughness (Tough, Frail) do nothing against (hunger, thirst, infection).
/** @param {State} state @param {Survivor} s @param {number} amount @param {number | null} tileId @param {string} cause @param {{ raw?: boolean }} [opts] */
export function hurt(state, s, amount, tileId, cause, opts = {}) {
  if (!opts || !opts.raw) {
    amount *= woundMult(s); // Tough × 0.75, Frail × 1.25 (traits.js)
    amount *= armorMult(s);
  }
  s.health -= amount;
  if (s.health <= 0) killSurvivor(state, s, tileId, cause);
  else if (!opts || !opts.raw) woundTrauma(state, s, amount); // a real wound may need dressing (health.js)
}

/** @param {State} state @param {Survivor} s @param {number | null} tileId @param {string} cause @param {any[]} [extraItems] */
export function killSurvivor(state, s, tileId, cause, extraItems = []) {
  if (!s.alive) return;
  s.alive = false;
  s.health = 0;
  s.station = null;
  s.inBed = false;
  // envoys.js: on an envoy out of your radio coverage (and not in a fight you watch on the battle map), nobody hears it.
  const onParty = s.location && s.location.kind === "party" ? state.parties.find((p) => p.id === s.location.partyId) : null;
  const unheard = unheardEnvoy(onParty) && !(state.combat && state.combat.setup && state.combat.setup.partyId === onParty.id);
  if (unheard) envoyLostQuiet(state, onParty, s);
  else log(state, `${s.name} died ${cause}.`, "death");
  if (s.vol) volunteerFell(state, s, tileId, cause); // volunteers.js: another group's person: their group mourns, not your memorial wall
  else if (s.loan) loanFell(state, s, tileId, cause); // loans.js: on loan to you: their group mourns (standing), not your memorial wall
  else {
    const entry = onDeath(state, s, tileId, cause); // relations.js: grief for friends and a partner, a line on the memorial wall
    noteDeath(state, s, tileId, cause, entry); // causes.js: why it happened, on the memorial entry
  }
  // Died on the tile of one of your bases (hunger, an infected wound, a scavenging accident, a raid or horde at
  // the walls, a convoy starving while it holds there): their things go to that base's armory. No death site
  // inside the walls: no team could be sent to recover it, and passers-by cannot loot it. The one exception is
  // a team's own battle on that tile: its fallen stay bodies to loot on the result screen (inventory.js).
  const here = tileId != null ? state.bases.find((b) => b.tile === tileId) : null;
  const fight = state.combat;
  const teamBattle = !!(fight && fight.tileId === tileId && fight.setup && fight.setup.partyId != null
    && s.location && s.location.kind === "party" && s.location.partyId === fight.setup.partyId);
  const home = here && !teamBattle ? here : null;
  packOnDeath(state, s, home); // eating.js: their pack of food and water to the stores at a base, else lost with them
  if (home) {
    const kept = stripAll(s);
    home.armory.push(...kept);
    for (const e of extraItems) {
      if (e.kind === "gear" && e.item) home.armory.push(e.item);
      else if (e.kind === "supply" && e.qty > 0) home.stock[e.key] = (home.stock[e.key] || 0) + e.qty;
    }
    if (kept.length) log(state, `${firstOf(s.name)}'s things (${kept.map((g) => g.name).join(", ")}) were put in ${home.name}'s armory.`, "info");
  } else if (tileId != null) {
    // Death site: the body and everything carried stays where they fell. item = the real item (a pack keeps its
    // contents), so looting the body after a battle can take it off the site (inventory.js).
    const items = [];
    for (const g of allItems(s)) items.push({ kind: "gear", key: g.key, name: `${s.name.split(" ")[0]}'s ${g.name}`, qty: 1, value: GEAR[g.key].value * (g.quality || 1), item: g });
    items.push(...extraItems);
    let site = state.deathSites.find((d) => d.tile === tileId);
    if (site) {
      site.items.push(...items);
      if (!site.names.includes(s.name)) site.names.push(s.name);
    } else {
      site = { id: newId(), tile: tileId, items, day: day(state), names: [s.name], lastConfirmed: day(state) };
      state.deathSites.push(site);
    }
    // Teammates know where their friend fell.
    const party = s.location.kind === "party" && state.parties.find((p) => p.id === s.location.partyId);
    if (party && party.spotted && !unheard) {
      const key = `death:${tileId}`;
      party.spotted.set(key, { key, type: "death", tile: tileId, hour: state.hour, label: `Death site: ${site.names.join(", ")}`, info: { items: site.items.length } });
    }
  }
  riseOnMap(state, s, tileId); // carriers.js: the worm in them (worm.js): they get up again, here on the map or at the base
  if (s.leader) {
    s.leader = false;
    leaderCard(state, `${s.name} is gone. The group needs someone to lead. Morale drops across the hub.`);
  }
  checkGameOver(state);
}

// "The leader is dead": the six best living, free (not captive) people by Leadership. Checked again when the
// player picks, since a candidate can die or be captured while the card waits: the pick then falls back to the
// best one left.
const LEADER_CARD = "The leader is dead";
/** @param {State} state */
const leaderCandidates = (state) => state.survivors.filter(isFree).sort((a, b) => skill(b, "leadership") - skill(a, "leadership"));
/** @param {State} state @param {string} text @returns {boolean} */
function leaderCard(state, text) {
  const list = leaderCandidates(state).slice(0, 6);
  if (!list.length) return false; // nobody free right now: ensureLeader asks again once someone is
  addCard(state, {
    title: LEADER_CARD,
    text,
    choices: list.map((c) => ({
      label: `${c.name} (Leadership ${skill(c, "leadership")})`,
      disabled: () => !isFree(c),
      resolve: (st) => {
        if (st.survivors.some((o) => o.alive && o.leader)) return "The group already has a leader.";
        const pick = isFree(c) ? c : leaderCandidates(st)[0];
        if (!pick) return "Nobody is left to lead.";
        st.survivors.forEach((o) => (o.leader = false));
        pick.leader = true;
        alive(st).forEach((o) => (o.mood = Math.max(0, o.mood - 15)));
        return pick === c ? `${pick.name} now leads the group.` : `${c.name} is gone too. ${pick.name} now leads the group.`;
      },
    })),
  });
  return true;
}

// Daily safety net: a group with no living leader and no card waiting is asked again (every candidate on the
// last card was lost, or the only people left were captives who have since come home).
/** @param {State} state */
export function ensureLeader(state) {
  if (state.gameOver || state.survivors.some((s) => s.alive && s.leader)) return;
  if (state.cards.some((c) => c.title === LEADER_CARD)) return;
  leaderCard(state, "The group has no leader. Someone has to step up. Morale drops across the hub.");
}

// The run ends when nobody is left alive: deaths, desertion and a captive changing sides all count (captives
// still count as alive). Called after every way of losing someone, and once at the end of each hour.
// Two ways to win, each once: the hive victory (every hive destroyed and no new one being built: hives.js
// hivesSecured) and the coalition's victory (alliance.js allianceVictory: over half the land, every group still
// standing in the coalition). The first one ends the run with its screen; after "Keep playing" (state.victoryKept)
// the other can still come, with its own screen. Both at once: the coalition's is named.
/** @param {State} state @returns {boolean} */
export function checkGameOver(state) {
  if (state.gameOver) return true;
  if (alive(state).length) {
    // Older saves: a hive victory kept playing before the flags existed; the old coalition victory included the hives.
    const hivesDone = state.hivesWon || (state.victoryKept && state.hivesWon === undefined && (state.victoryReason === "hives" || state.allianceWon));
    if (!state.allianceWon && (state.erasOff ? allianceVictory(state) : accordHolds(state) && accordReady(state))) {
      state.gameOver = true;
      state.victory = true;
      state.hivesWon = !!(hivesDone || (hivesSecured(state) && (state.erasOff || containReady(state)))); // both at once: one screen, the coalition's
      coalitionWins(state);
      achievementsEnd(state); // achievements.js: the victory's, before the end screen reads them
      return true;
    }
    if (!hivesDone && hivesSecured(state) && (state.erasOff || containReady(state))) {
      state.gameOver = true;
      state.victory = true;
      state.hivesWon = true;
      state.victoryReason = "hives";
      // Keep the opening words: the timelapse (chronicle.js) recognises this line by them.
      log(state, `Every hive is destroyed. The State of Calder is not safe, but it is yours to win back. ${alive(state).length} survivors made it to day ${day(state)}.`, "good");
      achievementsEnd(state); // achievements.js: the victory's, before the end screen reads them
      return true;
    }
    return false;
  }
  if (!state.survivors.length) return false;
  state.gameOver = true;
  // Keep the opening words: the timelapse (chronicle.js) recognises this line by them.
  const allDead = state.survivors.every((s) => !s.left);
  log(state, `${allDead ? "Every survivor is dead." : "Every survivor is dead or gone."} The holdout has fallen.`, "death");
  achievementsEnd(state); // achievements.js: what the last day brought, for the end screen
  return true;
}

/** @param {State} state */
function coalitionWins(state) {
  state.victoryReason = "alliance";
  state.allianceWon = true;
  const members = state.alliance ? state.alliance.members.length : 0;
  const pct = Math.round(controlledLand(state).pct * 100);
  // Keep the opening words: the timelapse (chronicle.js) recognises this line by them.
  log(state, members ? `The Calder Coalition holds the State of Calder: ${pct}% of the land, and ${members} member${members === 1 ? "" : "s"} beside you (no hive left, no group outside the coalition). ${alive(state).length} survivors made it to day ${day(state)}.` : `The Calder Coalition holds the State of Calder: ${pct}% of the land, and no other group left standing to join it or oppose it. ${alive(state).length} survivors made it to day ${day(state)}.`, "good");
  return true;
}

// A base is lost (overrun by a horde, taken in a raid). One place for everything that has to follow: the
// people still there flee to the hub, vehicles parked there are left on the tile (abandoned, with a map
// marker), supply runs to or from it are paused, and the log says what was lost.
// opts.voluntary: you abandoned it (occupy.js abandonOutpost: its people already left as a team): no "why was it lost".
/** @param {State} state @param {Base} base @param {string} [cause] @param {{ voluntary?: boolean }} [opts] @returns {boolean} */
export function removeBase(state, base, cause = "was lost", opts = {}) {
  const i = state.bases.indexOf(base);
  if (i < 0 || base.type === "hub") return false;
  if (!opts.voluntary) noteBaseLoss(state, base, lossHow(cause)); // causes.js: why it was lost (before the people leave)
  const h = hub(state);
  const fled = [];
  for (const s of state.survivors) {
    if (!s.location || s.location.kind !== "base" || s.location.baseId !== base.id) continue;
    s.station = null;
    s.inBed = false;
    if (!s.alive) continue;
    s.location = { kind: "base", baseId: h.id };
    fled.push(s);
  }
  const left = [];
  for (const v of state.vehicles) {
    if (v.loc.kind !== "base" || v.loc.baseId !== base.id) continue;
    v.loc = { kind: "abandoned", tile: base.tile, since: state.hour };
    left.push(v.name);
    // The people who fled know where it stands.
    const key = `vehicle:${v.id}`;
    const m = { key, type: "vehicle", tile: base.tile, hour: state.hour, label: `${v.name} (left at ${base.name})`, info: { vehicleId: v.id, fuel: Math.round(v.fuel), condition: Math.round(v.condition) } };
    const cur = state.markers.find((x) => x.key === key);
    if (cur) Object.assign(cur, m);
    else state.markers.push(m);
  }
  let paused = 0;
  for (const job of state.supplyRuns || []) {
    if (job.originId !== base.id && job.destId !== base.id) continue;
    if (job.status === "done" || job.status === "disbanded") continue;
    if (!job.paused) paused++;
    job.paused = true;
    job.lastResult = `Day ${day(state)}: ${base.name} ${cause}`;
  }
  for (const p of state.parties) if (p.owner === "player" && p.homeBaseId === base.id) p.homeBaseId = h.id;
  state.bases.splice(i, 1);
  leavePlayerBase(state, base); // groupworld.js: it stands empty, its buildings there for a group to move into
  state.knowledge[base.tile] = snapshot(state, base.tile); // the people who fled know it stands empty (the map's Occupy, occupy.js)
  assignStations(state, h);
  const stock = SUPPLY_KEYS.filter((k) => !FOODS[k] && (base.stock[k] || 0) >= 1).map((k) => `${Math.floor(base.stock[k])} ${keyWord(k)}`); // water.js keyWord: "un-purified water", not the key
  if (foodIn(base.stock) >= 1) stock.unshift(`${Math.floor(foodIn(base.stock))} days of food`); // foods.js: every kind together
  const bits = [];
  if (base.buildings.length) bits.push(`${base.buildings.length} building${base.buildings.length === 1 ? "" : "s"}`);
  if (stock.length) bits.push(`its stock (${stock.join(", ")})`);
  if (base.armory.length) bits.push(`${base.armory.length} item${base.armory.length === 1 ? "" : "s"} in the armory`);
  const parts = [`${base.name} ${cause}.`, bits.length ? `${opts.voluntary ? "Left behind there" : "Lost with it"}: ${bits.join(", ")}.` : "Nothing of value was left there."];
  if (abandonedAt(state, base.tile)) parts.push(opts.voluntary ? "Its buildings stand empty with half of the stores left: Reoccupy it later, before someone else moves in." : "Its buildings still stand there with some of its stores: send a team to Occupy it before someone else moves in.");
  if (left.length) parts.push(`${left.length === 1 ? `The ${left[0]} was` : `${left.join(" and ")} were`} left behind there (marked on the map).`);
  if (fled.length) parts.push(`${fled.map((s) => firstOf(s.name)).join(", ")} fled to ${h.name}.`);
  if (paused) parts.push(`${paused} supply run${paused === 1 ? "" : "s"} to or from it ${paused === 1 ? "is" : "are"} paused.`);
  log(state, parts.join(" "), opts.voluntary ? "info" : "death");
  return true;
}

/** @param {Stock} stock @returns {number} */
export function supplyValue(stock) {
  return SUPPLY_KEYS.reduce((s, k) => s + (stock[k] || 0) * supValue(k), 0);
}

// ---------- vision and knowledge ----------
// How far a base sees on the map. state given: at night (20:00–06:00) only NIGHT_BASE_VISION tiles round, whatever its
// watchtower or telescope (a team in the field sees only its own tile: parties.js sightRadius); by day fog or a
// blizzard over the base takes a tile off (weather.js sightCut), never below 1. Without state: its clear-day view.
export const NIGHT_BASE_VISION = 1;
/** @param {Base} base @param {State | null} [state] @returns {number} */
export function baseVision(base, state = null) {
  if (state && isNight(state)) return NIGHT_BASE_VISION;
  const r = (base.tier === 0 ? 1 : base.type === "hub" ? HUB_VISION : OUTPOST_VISION) + (base.watchtower ? 2 : 0) + baseOpticsSight(base); // a telescope in the armory (optics.js); a shelter (buildings.js SHELTER, tier 0) sees 1 tile
  return state ? Math.max(1, r + sightCut(state, base.tile)) : r;
}

// ix: tileIndex(state), when many tiles are looked at in a row (updateVision); without it each list is searched.
/** @param {State} state @param {number} tileId @param {ReturnType<typeof tileIndex> | null} [ix] @returns {TileSnapshot} */
export function snapshot(state, tileId, ix = null) {
  const t = state.tiles[tileId];
  const here = ix ? ix.hordes.get(tileId) || [] : state.hordes.filter((h) => h.tile === tileId);
  const hordeSize = here.reduce((s, h) => s + h.size, 0);
  const site = ix ? ix.sites.get(tileId) : state.hiveSites ? state.hiveSites.find((x) => x.tile === tileId) : null;
  const death = ix ? ix.deaths.get(tileId) : state.deathSites.find((d) => d.tile === tileId);
  // hiding.js: a group's hidden outpost you have not found is bare ground on your map (state.intel.unseen).
  const factionBase = state.intel && state.intel.unseen && state.intel.unseen[tileId] != null ? null : ix ? ix.groupBase.get(tileId) : state.factions.find((f) => f.alive && f.bases.includes(tileId));
  return {
    hour: state.hour,
    owner: t.owner,
    factionBase: factionBase ? factionBase.id : null,
    hordeSize,
    hordeBoss: here.reduce((s, h) => s + (h.bosses || 0), 0),
    hordeMix: here.reduce((m, h) => ({ mix: mergeMix(m.mix, m.n, h.mix, h.size), n: m.n + h.size }), { mix: null, n: 0 }).mix, // a hive's special dead (zombietypes.js)
    growth: growthInfo(state, growthAt(state, tileId)), // a hive growth here (hivetech.js)
    infection: t.infection,
    loot: t.loot,
    hive: !!t.hive,
    site: site ? { biomass: site.biomass, started: site.started != null } : null,
    deathSite: death ? death.items.length : 0,
    abandoned: abandonedSnap(state, tileId), // groupworld.js: a base standing empty here (occupy.js: the Occupy order)
    ...(poiSnapshot(state, tileId) || {}), // pois.js: the points of interest the player knows here, and when it was surveyed or looked at
  };
}
// What snapshot reads, by tile, built once for a pass over many tiles: the hordes on each (in state.hordes order), and
// the first hive site, living group's base and death site there (what each list's find would return). Valid while the
// lists do not change: updateVision builds it, then only reads.
/** @param {State} state */
export function tileIndex(state) {
  const hordes = new Map(), sites = new Map(), groupBase = new Map(), deaths = new Map();
  for (const h of state.hordes) { const a = hordes.get(h.tile); if (a) a.push(h); else hordes.set(h.tile, [h]); }
  for (const x of state.hiveSites || []) if (!sites.has(x.tile)) sites.set(x.tile, x);
  for (const f of state.factions) if (f.alive) for (const b of f.bases) if (!groupBase.has(b)) groupBase.set(b, f);
  for (const d of state.deathSites) if (!deaths.has(d.tile)) deaths.set(d.tile, d);
  return { hordes, sites, groupBase, deaths };
}
// What a look at an abandoned base tells you: whose it was, since when, and how much stands there.
/** @param {State} state @param {number} tileId */
function abandonedSnap(state, tileId) {
  const rec = abandonedAt(state, tileId);
  if (!rec) return null;
  const standing = rec.buildings ? rec.buildings.filter((b) => !b.broken).length : Object.values(rec.works || {}).reduce((a, q) => a + Math.max(0, q), 0);
  return { from: rec.from, fromName: rec.fromName, day: rec.day, standing };
}

/** @type {(state: State) => Base[]} */
export const radioBases = (state) => state.bases.filter((b) => b.radio);

/** @param {State} state @returns {Set<number>} */
export function liveTiles(state) {
  const set = new Set();
  for (const b of state.bases) for (const id of state.grid.within(b.tile, baseVision(b, state))) set.add(id);
  for (const id of fieldSight(state)) set.add(id); // fieldworks.js: your manned watch towers
  // Radio: parties in range report what they see right now.
  for (const p of state.parties) {
    if (p.owner === "player" && reportsLive(p)) for (const id of p.sightNow || []) set.add(id); // parties.js: live intel
  }
  return set;
}

/** @param {State} state */
export function updateVision(state) {
  const live = liveTiles(state);
  state.live = live;
  const ix = tileIndex(state);
  const unseen = state.intel && state.intel.unseen; // hiding.js: a hidden outpost not found yet is bare ground (as snapshot has it): no contact, no look
  for (const id of live) {
    state.knowledge[id] = snapshot(state, id, ix);
    if (unseen && unseen[id] != null) continue;
    for (const f of state.factions) if (f.bases.includes(id)) { f.known = true; if (f.alive) noteLook(state, id, "sight"); } // intelnotes.js: what the base looks like
  }
  // Hidden sites (discovery.js) the bases and watchtowers see for the first time: a log line.
  for (const b of state.bases) noteFinds(state, state.grid.within(b.tile, baseVision(b, state)), { base: b });
  updateLiveMarkers(state);
}

// who: the team whose report it is (a hidden site it found gets a log line naming it, discovery.js).
/** @param {State} state @param {Map<number, TileSnapshot>} seen @param {Map<string, Marker> | null} spotted @param {import("./types").Party | null} [who] */
export function mergeKnowledge(state, seen, spotted, who = null) {
  if (spotted) mergeSpots(state, spotted);
  // seen: Map tileId -> snapshot recorded by a party. Keep the newest per tile.
  for (const [id, snap] of seen) {
    const cur = state.knowledge[id];
    // Radio news of a stripped site (aiscav.js) newer than the team's look keeps its loot.
    if (!cur || cur.hour <= snap.hour) state.knowledge[id] = cur && cur.lootHour > snap.hour ? { ...snap, loot: cur.loot, lootHour: cur.lootHour, lootSrc: cur.lootSrc } : snap;
    if (snap.gb) keepLook(state, id, snap.gb); // intelnotes.js: what the team saw of a group's base
    if (snap.pois) learnPois(state, id, snap); // pois.js: the points of interest the report knows there
    if (snap.factionBase) {
      const f = factionById(state, snap.factionBase);
      if (f) f.known = true;
    }
  }
  noteFinds(state, seen.keys(), who ? { party: who } : null);
  if (who) mergeLooked(state, who); // discovery.js: where the team looked hard (the map's Known area layer)
  if (who) mergePoiFinds(state, who); // pois.js: the hidden points of interest its surveys found
}

// ---------- tick ----------
/** One hour of the world. @param {State} state */
export function tickHour(state) {
  // The tick is the hour's end: anything it sets moving starts on the hour, whatever the clock's minutes showed
  // (parties.js wayOn).
  const frac = clockFrac(state);
  setClockFrac(0, false);
  try { hourOfWorld(state); } finally { setClockFrac(frac, false); }
}
/** @param {State} state */
function hourOfWorld(state) {
  if (state.gameOver) return;
  state.hour += 1;
  noteLootAge(state); // itemcond.js: the years since the fall, for every piece of loot rolled this hour
  syncAllMembers(state); // members.js: the groups' head counts and their people made to agree (cheap when nothing changed)
  weatherHour(state); // weather.js: seasons and the day's weather (fixed ahead, so ETAs hold)
  riversHour(state); // rivers.js: rivers freezing over or thawing (before anyone moves this hour)
  skillsHour(state); // skills.js: travel XP, Pathfinder's pace
  foodMarkAll(state, "player"); // foodlog.js: what was traded, packed or unloaded between the hours
  movePartiesHour(state);
  detachHour(state); // detach.js: some of a team back from a job rejoin it
  foodMarkAll(state, "team"); // teams home and setting out
  campsHour(state); // staging.js: camps (neglect, the hub among them) and the shelters' fires
  needsHour(state); // needs.js: hunger and thirst at bases and on errands (teams eat in movePartiesHour), teams' treats
  foodMarkAll(state, "pack"); // the eating is booked as it happens; packs topped up and emptied
  releaseStranded(state); // conflicts.js: a halted team with nothing left to resolve it checks in for orders
  hordesHour(state);
  visitorsHour(state); // visitors.js: raiders, merchants and explorers from outside the state
  nomadsHour(state); // nomads.js: nomad bands on the move, their camps seen, meeting your teams
  caravanRaidsHour(state); // caravanraids.js: caravans met on the road, chased, robbed (by you or by the groups)
  if (state.mode === "hardcore") hardcoreHour(state); // hardcore.js: bands on the road (hardcore mode only)
  contactHour(state); // conflicts.js: a horde or an enemy party that came onto a team's tile attacks it
  fieldworksHour(state); // fieldworks.js: the lookouts posted at field works (gone, moved, enemies there)
  const meal = isMealHour(state.hour, state); // meals.js: breakfast, lunch and dinner, the builders, crafters and the bench stop for them
  if (!meal) constructionHour(state);
  if (!meal) repairHour(state); // repair.js: the base repair queue (before crafting: the crafters' hour goes to a repair first)
  rezeroHour(state); // repair.js: budget sights re-zeroed at a workbench every morning (gunmods.js driftOf)
  if (!meal) craftingHour(state);
  if (!isLunchHour(state.hour, state)) garageHour(state); // vehicles.js: vehicle upgrades in the garage (glass, plating); the fitters stop for lunch
  productionHour(state); // production.js: station orders and their fallbacks, power, repeating craft orders
  medicalHour(state);
  diplomacyHour(state); // diplomacy.js: jobs for other groups checked every hour (jobs.js)
  prisonersHour(state); // prisoners.js: rescue raids arriving, prisoners whose team or base is gone
  groupJailsHour(state); // groupjails.js: your people just taken: jailed, or sold, ransomed, let go or killed when there is no room
  ransomHour(state); // ransom.js: captives brought home, envoys back with their price, handovers nobody came to
  volunteersHour(state); // volunteers.js: volunteers joining and leaving your teams, your people lent out, the groups' asks
  foodMarkAll(state); // foodlog.js: building, crafting, the stations, visitors
  if (state.hour % 24 === 0) {
    workDayRoles(state); // work.js: people asleep or off at midnight count at their day's work (set again below)
    watchDayRoles(state); // watch.js: Manual people on watch likewise
    helpDayRoles(state); // noidle.js: a Manual person whose job had no work counts at the job they helped with
    weatherDaily(state); // first, so the day's farming, water and sickness read today's weather
    pondsDaily(state); // ponds.js: your bases' hollows a day on (filled by the rain, drained, dried, frozen)
    basesDaily(state);
    storageDaily(state); // basestorage.js: items left outside past a base's storage wear (rain and snow double it)
    craftingDaily(state);
    stallDaily(state); // activity.js: read-only but for base.stall (no dice)
    vehiclesDaily(state);
    factionVehiclesDaily(state); // vehicles.js: a military group replaces a lost Humvee, slowly
    factionsDaily(state);
    hordesDaily(state);
    outbreakDaily(state); // outbreak.js: new hives from beyond the border while the outbreak there burns
    hardcoreDaily(state); // hardcore.js: the first year after the fall (hardcore mode only)
    routesDaily(state);
    supplyDaily(state);
    deathSitesDaily(state);
    groundDaily(state); // carry.js: food on the ground (dropped cargo, the dead's rations) spoils
    walkingDaily(state); // carriers.js: the walking dead drift a tile; a body with the worm left unburied at a base gets up
    groupJailsDaily(state); // groupjails.js: the groups' prisoners work, escape, are ransomed, swapped, sold or turned
    captivesDaily(state);
    prisonersDaily(state); // prisoners.js: food, escapes, ransoms, recruiting, rescue raids
    conquestDaily(state); // conquest.js: infamy fades, bases taken from you are patched up by their holders
    radioDaily(state); // radio.js: relay upkeep, groups' water and wares, grudge raids, groups calling you
    visitorsDaily(state); // visitors.js: outsiders crossing the border, guests sheltering at your bases
    nomadsDaily(state); // nomads.js: nomad bands camp, survey, raid, forage, eat, recruit, move on; a slow respawn
    skillsDaily(state); // skills.js: XP from the day's work, teaching, reading, decay, perk effects
    trainingDaily(state); // training.js: medics' ward rounds, the doctor's lessons to Medic trainees
    familyDaily(state); // family.js: couples, expecting, births, children eating, growing up and joining the work
    surveyDaily(state); // survey.js: rumours of hidden places (radio, travellers, merchants), found ones struck off
    wanderersDaily(state); // wanderers.js: the survivors you met and left live on (or not); no dice of the world's
    tileHeatDaily(state); // pois.js: the heat raids left on the tiles falls 10% a day
    recomputeOwnership(state);
    claimsDaily(state); // claims.js: claims under a new base, a hive or a hostile camp are lost
    fieldworksDaily(state); // fieldworks.js: relay masts' parts, raids on your field works, the groups' own, towers drawing the dead
    // eras.js: the Accord's and the containment's clocks (the victories need them to have run: checkGameOver).
    if (!state.gameOver) erasVictoryDaily(state, !state.allianceWon && accordHolds(state), hivesSecured(state));
    causesDaily(state); // causes.js: the day each base's water, food, scrap, meds, ammo or wood ran out
    ensureLeader(state);
    achievementsDaily(state); // achievements.js: the day's pass (reads only; no dice)
    if (day(state) % 5 === 0) log(state, `Day ${day(state)}. ${alive(state).length} survivors.`, "info");
    foodMarkAll(state, "player"); // foodlog.js: supply runs and trade routes
  }
  settleAll(state); // ammo.js: generic ammo that came in or went out this hour sorted into (or out of) rounds by calibre
  // Safety net: no stock below zero, whatever subtracted from it.
  for (const b of state.bases) for (const k of Object.keys(b.stock)) if (b.stock[k] < 0) b.stock[k] = 0;
  checkGameOver(state);
  updateVision(state);
  discoveryHour(state); // discovery.js: hidden sites reported this hour (radio, maps, intel, prisoners, the coalition)
  hiveBirthHour(state); // hivebirth.js: a new hive site heard of, the dead seen massing, a hive you knew of risen
  crashHour(state); // crashstart.js: Crashlanding's chain (the wreck's lure, the base's reveal, the hive born there, the bunker found); nothing in other runs
  festivalHour(state); // festival.js: the morning of the harvest festival
  crowdCardsHour(state); // moveout.js: a base of yours with more people than beds says so (once, then after a while or when worse)
  helpRestore(state); // noidle.js: last hour's helpers back on their own job before anyone sets roles
  workHour(state); // work.js: people on work priorities get this hour's job (before stewards, which skip them)
  cookShiftHour(state); // kitchen.js: a Manual "Cook + second job" cooks in the cooking hours, the second job otherwise
  crewHour(state); // crews.js: crew roles run their own trips and answer their teams' small cards
  if (state.autopilot) autopilotHour(state); // dev tool: the AI governor runs the holdout (autopilot.js)
  else stewardHour(state); // steward.js: bases handed to a steward
  leaderIdleHour(state); // idlework.js: at 07:00, people on a job stalled since a day moved to what the base needs
  watchHour(state); // watch.js: Manual people on the watch roster stand guard on their shift (after the stewards)
  jailGuardHour(state); // prisoners.js: Manual people on a jail's roster guard it while anyone is held there
  sickRestHour(state); // sickrest.js: the ill at a base rest (Manual and pinned: their job back when well); a log line each way
  helpHour(state); // noidle.js: a Manual person whose job has no work this hour helps with one that has (their role kept)
  cooksHour(state); // kitchen.js: whoever is on Cook in a cooking hour counts as one of the day's cooks (s.cookHour)
  foodMarkAll(state, "player"); // the governor, the stewards and the crews: trades, teams packed
  jobTripsHour(state); // jobtrips.js: the outdoor jobs' trips (out to the base's land, the work, home with the load)
  helpHour(state); // noidle.js: again, for anyone whose work the trips just finished (the last tree felled: the builders on it)
  foodMarkAll(state, "job"); // the hunters', fishers' and foragers' loads home
  tiredHour(state); // sleep.js: the hour's sleep owed or slept off (a watch in someone's sleep hours keeps them up)
  settleAll(state); // ammo.js: again, for what the work, the crews and the governor moved after the first settle (no generic ammo is left in a holder of yours between hours)
  recordChronicle(state); // a timelapse frame once a day (cheap check otherwise)
  historyHour(state); // history.js: stock flows marked, a row a day for the Ledger and the run summary
  foodMarkAll(state); // foodlog.js: the rest of the hour
  if (state.autopilot) autopilotResolve(state); // cards the hour raised after the governor's turn (a job trip's perk milestone): answered now, as the browser does every frame
}
