// @ts-check
// Daily economy for every base (hub and outposts share the same rules): water, base scavenging, farming
// (farming.js), eating, food storage and spoiling (storage.js), illness (health.js), supply lines, trade routes and
// death-site looting.
/** @import { State, Base, Survivor } from "./types" */
import { TERRAIN, LOCATIONS, SUPPLIES, supplyFew, GEAR, supValue } from "./data.js";
import { isCart, cartWorth, ROAD_CARTS } from "./carts.js"; // a cart left on a tile: stripped a thing at a time (deathSitesDaily)
import { itemLoad } from "./inventory.js";
import { sortParts, rollBuildmat, rollSheets } from "./loot.js"; // parts found by kind; building materials (their own dice)
import {
  log, addCard, day, hub, atBase, alive, skill, hurt, survivorById, factionById, makeSurvivor, residents, checkGameOver, localId,
} from "./world.js";
import { planPath, dispatchConvoy } from "./parties.js";
import { attitude } from "./factions.js";
import { count, countAll, baseBeds, runStations, assignStations, stations, stationStatus, RECIPES, BUILDINGS, isShelter, SHELTER, barrelRoom, isCamp, tierUpJob, gatherRows } from "./buildings.js";
import { pumpWater } from "./electric.js"; // an electric pump down a well (call-time only)
import { supplyReserve } from "./supply.js";
import { medicalDaily, fieldInfectionDaily } from "./medical.js";
import { toolBonus } from "./crafting.js";
import { farmingDaily, farmFoodPerDay, cropWaterNeed, nextHarvests, farmOf, econStats, CROPS } from "./farming.js";
import { healthDaily, workFactor, conditionsOf, CONDITIONS } from "./health.js";
import * as Weather from "./weather.js";
import { foodStore, storageDaily, eatFromStore, edibleFood, rackPlan, cookDaily } from "./storage.js";
import { FOODS, foodIn, payFood, moveFoodUnits, packPick, takeItem, addFood, addFoodFind, shopFood, foodWord } from "./foods.js"; // food by type (days of food here)
import { baseMoraleDaily } from "./morale.js";
import { makeCandidate, offerRecruits, recruitsDaily } from "./recruits.js";
import { hubEventsDaily } from "./hubevents.js";
import { hasPerk, hash01 } from "./skills.js";
import { relationsDaily, noteMeals } from "./relations.js";
import { mentalBreaksDaily } from "./mentalbreaks.js";
import { huntingDaily, snaresDaily } from "./hunting.js";
import { foodUse, mouthsAt, prisonersAt, guestsAt, crewAt } from "./upkeep.js";
import { takeEatAcc } from "./eating.js"; // people eat by the hour (meal breaks): the day's eating counted here
import { rationKey, RATION_LEVELS } from "./meals.js"; // the ration levels (lean, a feast day)
import { heatDaily, starvingDaily, takeDrinkAcc } from "./needs.js";
import { rawDrinkOf } from "./rawdrink.js"; // un-purified water: the base's rule (Never: purified water only)
import { stoneDaily } from "./stone.js"; // the Gather stone job (the user's request 2026-10-23)
import { woodDaily, fireDayBurn, WOOD } from "./woodcutting.js"; // fireDayBurn, WOOD: a camp's fire's pile kept (shipFromOutposts)
import { prisonWater } from "./prisoners.js"; // prisoners-tab: water hauled by prisoners (waterProduction)
import { fieldWellWater, drawFieldWells } from "./fieldworks.js"; // field wells on the base's land (waterProduction field)
import { hauledWells, drawWells } from "./claims.js"; // wells dug on claims next to the base (waterProduction hauled)
import { wormDaily, boilerUse, purifyDaily } from "./worm.js";
import { waterIn, drawWater, RAW, keyWord } from "./water.js"; // purified and un-purified water
import { flowMark, markAll } from "./history.js"; // the Ledger's in and out (marks between the day's steps)
import { foodMark, foodMarkAll, foodSpoiled } from "./foodlog.js"; // the base's food ledger (the Food tab): marks between the day's steps
import { addFind, chooseRounds, baseCals, roundsText } from "./ammo.js"; // rounds by calibre
import { ROUND_SUPPLIES } from "./data-ammo.js"; // round keys (a scavenging find named by calibre in the log)
import { noteOutput } from "./output.js"; // the base's Work now panel: what each job brought in a day (activity.js)
import { workLand, distFactor, waterSources, walkHours, TRIP_JOBS, NO_WATER, waterTripsADay, walkMult, tileFactor, onTileHours } from "./tripland.js"; // the Scavenge and Fetch water jobs in trips (jobtrips.js)
import { haulCovers } from "./hauling.js"; // haulers carry the directions their orders cover (call-time only)
import { tripEventsDaily } from "./tripevents.js"; // trouble on job trips: the day's shots (trips-plus #2)
import { kitchenDaily, kitchenFireDaily } from "./kitchen.js"; // the Kitchen's day: meals served, food saved
import { keepItem } from "./arsenal.js"; // a group that loots a death site keeps the very item
import { lootQty } from "./worldcfg.js"; // the run's dials: the loot by kind (the base's scavengers)
import { winterScavFood } from "./winter.js"; // winter: less food in a find (call-time only)
import { note, goodsRounds } from "./ledger.js"; // the conservation test's ledger (off in play): rounds off the ground
import { personKey } from "./members.js"; // a person's id for the dice: a member who joined keeps their own (call-time only)
import { cutOffWhy } from "./poirooms.js"; // a camp inside a POI cut off: nobody leaves its map (issue #71; call-time only)

export const ROLES = {
  farm:     { name: "Farm",     desc: "Tends, plants and harvests the crop plots (Farming tab). Crops take days to ripen; more farmers per plot and better Farming give a bigger harvest from the same days. Ripe crops left unharvested rot." },
  scavenge: { name: "Scavenge", desc: "Picks through the ruins right around this base: about 1.5 supplies a day each on average at Scavenging 0 (scrap, food, water, now and then ammo, meds, fuel or parts, by what the ground around holds; more in a town or at a site, less in open country), up to 4 with good Scavenging (+8% a point; a crowbar helps). The area is picked over for good as they work it. Expeditions to real sites bring in far more." },
  operate:  { name: "Operate",  desc: "Runs a workshop station (ammo, meds, parts or the preserving room). Loud: raises Heat." },
  build:    { name: "Build",    desc: "Works on the construction queue. More builders finish faster; Mechanics helps." },
  guard:    { name: "Guard",    desc: "Defends the base. Guards count 1.5× in fights." },
  rest:     { name: "Rest",     desc: "Recovers mood, and the sick get better faster. Injured people heal either way." },
  trainee:  { name: "Trainee",  desc: "A medic trainee: works on the ward of this base's infirmary or hospital and learns Medicine from the doctor (the best medic here, Medicine 6+) every day, up to 1 below the doctor's Medicine (in a trauma hospital up to the doctor's own); faster with a better doctor and a better hospital (Help: Training medics). Counts as half a medic toward the staff the hospital needs. Places: 1 (infirmary, field hospital), 2 (clinic), 3 (trauma hospital)." },
  medic:    { name: "Medic",    desc: "Staffs the infirmary or hospital (each tier needs 1–3 medics to run; unstaffed it works like no hospital). The best medic's Medicine speeds up healing for patients in beds; with no medic only slow natural healing and weak meds. Medics are never admitted as patients, and catch contagious illness more easily." },
  craft:    { name: "Craft",    desc: "Makes makeshift gear and supplies by hand from the craft queue (base Crafting tab). No station needed; Mechanics (or Medicine for kits) sets what they can make and how fast." },
  teach:    { name: "Teach",    desc: "Teaches one skill to up to 2 people at this base whose skill is at least 4 below theirs (pick the skill and learners on their survivor screen, or leave it to them). Learners gain 4 + 0.4 × the teacher's skill + 0.15 × the teacher's Leadership and Speech XP a day and keep their own jobs; the teacher does no other work." },
  hunt:     { name: "Hunt",     desc: "Hunts the base's hunting grounds at dawn and dusk (its own tile and the tiles next to it; with a Hunting cabin the land within 2 tiles), walking out to the best ground and home with the catch, by the base's hunting mix (Farming tab): traps (silent, small game), bows (silent, the base's arrows) or guns (the base's ammo; shots add Heat and can draw the dead); no weapon: snares. Brings in fresh game, which spoils fast unless it is eaten, dried or smoked. Hunted hard, the land runs out of game for weeks." },
  fish:     { name: "Fish",     desc: "Fishes the river or lake by a base 3 hours a day, with a fishing rod, a net or a spear (carried, or in the armory: one each, a net for two). Brings in fresh fish, which spoils fast. The tools wear a use a day." },
  forage:   { name: "Forage",   desc: "Gathers wild food within 2 tiles of the base 6 hours a day (foraging.js): berries, nuts, mushrooms, greens, roots, apples, now and then herbs (meds) or honey. About a ration a day each in summer, more in autumn, little in spring, next to nothing in winter; Farming and Scouting help. The land picked hard grows back over weeks." },
  wood:     { name: "Cut wood", desc: "Cuts wood within 2 tiles of the base 6 hours a day (woodcutting.js): the heating (a base burns wood before fuel: 15, 1.5 kg, a head a day below freezing, 4.5 for the night's fire on a cool night under 8°C) and a camp's fire (its people's warmth, the water boiled and the pot). Forest gives most (about 175 a day each with a fire axe, 60 by hand), hills fair, farmland and suburbs little, a city next to nothing. An axe (their own or one from the armory) cuts about three times as much as bare hands (a felling axe ×2.2, a fire axe ×2, a hatchet ×1.6, bare hands ×0.7); a bow saw, a machete or a sledgehammer helps less; Farming and Mechanics help. Loud (base Heat), and axes slip. The land cut hard grows back over seasons." },
  stone:    { name: "Gather stone", desc: "Gathers field stone round the base 6 hours a day (stone.js): a camp's fire ring, a cook fire, a water boiler, a kitchen's hearth, a well's or a cistern's lining, a root cellar's walls. Mountains and hills give most (about 20 a day each by hand on hills), a town's rubble fair, farmland, plains and forest some; by a river more. A pickaxe ×2 or a sledgehammer ×1.8 (their own or the armory's) helps most; a crowbar, a shovel less. Clearing rocks and boulders on the build map gives stone too." },
  water:    { name: "Fetch water", desc: "Carries water from the nearest water in the base's own land (a river or lake tile the base holds, or one right next to it that nobody holds: a camp's river bank) in two buckets: out, filling them, back, a few trips a day (fewer the further the water). River and lake water is un-purified: it goes into the base's un-purified water (the worm's eggs; a water boiler or filters make it safe), up to the barrels' room. Needs a water tile in the base's land." },
  // kitchen.js: the Kitchen's cooks (one per 12 people living here).
  cook:     { name: "Cook",     desc: "Cooks the base's meals in the Kitchen (Construction: a building plot), one cook for every 12 people living here: cooks only in the cooking hours (05:00–06:00, 16:00–20:00) with a second job the rest of the day (Cook + Farm …), or the kitchen all day (plain Cook). Hot meals stretch the food (everyone fed at the kitchen eats 10% less a day, up to 13% with a good cook: Cooking 5+), lift spirits (+1 mood a day, +1.5 with Cooking 6+) and boil a quarter of the day's drinking water; the stove burns wood (28 a day for 12 people). Trains Cooking. Without a kitchen there is nothing to cook." },
  // hauling.js: standing haul orders between your bases, else local hauling (stockpiles, salvage, the ruins).
  haul:     { name: "Haul",     desc: "Moves goods between your bases by the standing haul orders (Supply runs tab: Hauling): what to send, which way and how much to keep at home, or a base kept stocked. A round trip by the map's route at the teams' pace, carrying what their weight limit, pack and rig allow (a cart from the armory multiplies it; a vehicle set to hauling takes its payload), out from 06:00 and home by 21:00; the road's trouble can hit them. The goods go into the other base's storage as far as it has room (the woodpile does not count). With nothing to move they haul near the base: a stockpile's goods in, salvage on the base map (wrecks stripped for scrap and a car part, crates and drums, rocks broken for building materials), scrap from the ruins." },
  read:     { name: "Read",     desc: "Reads a book from this base's armory 6 hours a day (pick it on their survivor screen, or leave it to them): skill books give 4 XP an hour up to the book's level, comics and novels give mood. One reader per copy at a time; a reader does no other work." },
};

// Farming and scavenging bonuses from where the base sits.
/** @param {State} state @param {Base} base */
export function siteBonus(state, base, tile = base.tile) {
  const t = state.tiles[tile];
  const loc = t.loc ? t.loc.type : null;
  return {
    farm: loc === "farm" || t.terrain === "plains" ? 1.3 : t.terrain === "forest" ? 0.8 : t.terrain === "hills" ? 0.7 : 1,
    scav: loc ? 1.2 : t.terrain === "city" || t.terrain === "suburb" ? 1.2 : 0.8,
    table: loc ? LOCATIONS[loc].loot : { scrap: 3, food: 1 },
  };
}

// Expected food per day from the plots over the next 30 days (what is in the ground, by when it ripens).
/** @param {State} state @param {Base} base */
export function farmOutput(state, base) {
  return farmFoodPerDay(state, base);
}

// ---------- base scavenging ----------
// WORLD-01 (2026-10-12, user request; was a 7% chance a day of one small find, about 0.2 supplies a day): a scavenger
// picking through the ruins round a base turns up BASE_SCAV_YIELD (1.5) supplies a day on average at Scavenging 0 in
// ruins (a site, a town or the suburbs: siteBonus scav SCAV_REF, 1.2; open country 0.8 gives two-thirds of it), the
// surroundings fresh and a full day out. More with Scavenging (+SCAV_SKILL a point, a crowbar's bonus counts as points), Greedy and
// Scrounger; less as the surroundings are picked over (base.scavLeft, 1 → 0.2, 0.004 per scavenger a day; it never
// comes back: nothing out there grows back, aiscav.js) and for someone hurt or worn out (health.js workFactor). At most
// SCAV_YIELD_CAP a scavenger a day. scavYield is that expectation; the trips (scavTrip) and the Work panel's average
// (scavengeOutput) both read it, so what is rolled, logged and shown agree.
// A day's supplies come as finds: finds = the expected supplies / the average find of the tile's table (SCAV_FIND),
// the whole part for sure and the rest as a chance, each find a whole number of its units (rng.int over its range), so
// the long-run average is the expectation exactly.
export const GREEDY_SCAV = 1.15; // the Greedy trait: finds more when scavenging around a base
export const BASE_SCAV_YIELD = 1.5; // supplies a scavenger a day at Scavenging 0 in ruins, fresh surroundings
export const SCAV_REF = 1.2;        // the ruins' siteBonus scav: the ground the baseline is for
export const SCAV_SKILL = 0.08;     // + this share of the yield a point of Scavenging (Scavenging 10: × 1.8)
export const SCAV_YIELD_CAP = 4;    // the most a scavenger turns up a day, on average
export const SCAV_FIND = { scrap: [2, 5], food: [1, 3], water: [2, 4], rawwater: [2, 4], ammo: [3, 8], meds: [1, 1], fuel: [1, 2], parts: [1, 1], preserved: [1, 3], jars: [2, 6] };
export const SCAV_DEPLETE = 0.004, SCAV_FLOOR = 0.2;
/** @param {Base} base */
export const scavLeft = (base) => (base.scavLeft == null ? 1 : base.scavLeft);

// Expected supplies a day from this scavenger on `tile` (a full day: the trips scale it by their share).
/** @param {State} state @param {Base} base @param {Survivor} s */
export function scavYield(state, base, s, tile = base.tile) {
  const b = siteBonus(state, base, tile);
  const y = BASE_SCAV_YIELD * (1 + (skill(s, "scavenging") + toolBonus(s, "scavenging")) * SCAV_SKILL) * (b.scav / SCAV_REF) * (s.traits.includes("greedy") ? GREEDY_SCAV : 1) * scavLeft(base) * workFactor(s) * (hasPerk(s, "scrounger") ? 1.3 : 1); // Scrounger (skills.js)
  return Math.min(SCAV_YIELD_CAP, y);
}
// What a find is drawn from: the site's own table, with scrap always likely; fuel and parts are rare.
/** @param {State} state @param {Base} base */
function scavTable(state, base, tile = base.tile) {
  const t = { ...siteBonus(state, base, tile).table };
  t.scrap = (t.scrap || 0) + 2;
  if (t.fuel) t.fuel *= 0.4;
  if (t.parts) t.parts *= 0.5;
  for (const k of Object.keys(t)) if (!SCAV_FIND[k]) delete t[k]; // only what a find can be (SCAV_FIND)
  return t;
}
const findMid = (k) => (SCAV_FIND[k][0] + SCAV_FIND[k][1]) / 2;
// Lunch (meals.js: the lunch hour, 11:00–15:00, always inside the scavengers' 08–18 window) is an hour off their day
// (jobtrips.js tripHours). SCAV_LUNCH scales a trip's share so that a full day on the job's reference ground, less that
// hour, still finds the yield; scavDayShare is the shares a day really adds up to on the trips' tile (the walk and the
// lunch hour out of it), so the panel shows what the trips bring in.
const scavRefHours = () => onTileHours("scavenge", TRIP_JOBS.scavenge.ref);
const SCAV_LUNCH_OFF = 1;
export const scavLunch = () => scavRefHours() / Math.max(0.1, scavRefHours() - SCAV_LUNCH_OFF);
/** @param {State} state @param {Base} base */
export function scavDayShare(state, base, st = scavTripTile(state, base)) {
  if (!st) return 1;
  const h = onTileHours("scavenge", st.d, walkMult(state));
  return st.f * (h > SCAV_LUNCH_OFF ? (h - SCAV_LUNCH_OFF) / h : 0);
}
// The average find (supplies) of a table, by its weights.
function meanFind(table) {
  const w = Object.values(table).reduce((a, v) => a + v, 0) || 1;
  return Object.entries(table).reduce((a, [k, v]) => a + (v / w) * findMid(k), 0) || 1;
}
// Expected supplies per day by kind (the Work panel, the base window and the tests): each scavenger's scavYield on
// the tile the trips go to, by the share of the day the walk and lunch leave (scavDayShare × scavLunch: 1 on the
// reference ground), split by the tile's table.
/** @param {State} state @param {Base} base */
export function scavengeOutput(state, base) {
  const people = atBase(state, base.id).filter((s) => s.role === "scavenge" && !s.inBed);
  const st = scavTripTile(state, base), tile = st ? st.id : base.tile, f = scavDayShare(state, base, st) * scavLunch();
  const table = scavTable(state, base, tile);
  const w = Object.values(table).reduce((a, v) => a + v, 0) || 1;
  const finds = people.reduce((a, s) => a + scavYield(state, base, s, tile) * f, 0) / meanFind(table); // finds a day
  const out = {};
  for (const [k, v] of Object.entries(table)) out[k] = (finds * v / w) * findMid(k);
  return out;
}

// The tile the base's scavengers go to (jobtrips.js): the ruins around it, the best of its land by its scavenging
// (siteBonus: a site, a town or the suburbs better) and the walk (tripland.js distFactor): { id, v, d, f }.
export function scavTripTile(state, base) {
  let best = null;
  for (const id of workLand(state, base.tile)) {
    const t = state.tiles[id];
    if (!t || t.terrain === "water" || (id !== base.tile && !t.loc && t.terrain !== "city" && t.terrain !== "suburb")) continue;
    const d = state.grid.distance(base.tile, id), f = tileFactor(state, base, "scavenge", id, d, walkMult(state)), v = siteBonus(state, base, id).scav;
    if (!best || v * f > best.v * best.f + 1e-12 || (Math.abs(v * f - best.v * best.f) <= 1e-12 && id < best.id)) best = { id, v, d, f };
  }
  return best;
}
// One scavenger's trip (jobtrips.js): `share` of a day's scavenging (the walk already out of it: a day one tile out is
// 1; the lunch hour already off it) on `tile`: scavYield × share (× scavLunch) as finds drawn from that tile's site.
// Returns { finds, got: { key: n }, ammo? }.
export function scavTrip(state, base, s, tile, share, k = 0) {
  const rng = state.rng;
  const out = { finds: 0, got: {} };
  const table = scavTable(state, base, tile);
  const lambda = (scavYield(state, base, s, tile) * share * scavLunch()) / meanFind(table);
  const n = Math.floor(lambda) + (rng.chance(lambda - Math.floor(lambda)) ? 1 : 0);
  if (n <= 0) return out;
  const keys = Object.keys(table);
  const t = state.tiles[tile];
  const type = (t && t.loc && t.loc.type) || "";
  const got = {};
  for (let i = 0; i < n; i++) {
    const key0 = rng.weighted(keys, (x) => table[x]);
    let q = lootQty(state, key0, rng.int(SCAV_FIND[key0][0], SCAV_FIND[key0][1])); // worldcfg.js: the run's loot dial for this kind
    if (key0 === "food") q = winterScavFood(state, q); // winter.js
    if (!(q > 0)) continue;
    const tag = `scav${personKey(state, s.id)}${k ? `:${k}` : ""}${i ? `/${i}` : ""}`; // (a world-local id: tools/sameseedtest.js; a member who joined keeps theirs, members.js personKey)
    if (key0 === "ammo") out.ammo = { type, q: (out.ammo ? out.ammo.q : 0) + q, tile };
    else if (key0 === "food" || key0 === "preserved") addFoodFind(state, got, type, q, { tile, preserved: key0 === "preserved" }); // foods.js: the food a place like this holds, as its shelves have it left
    else if (key0 === "parts" && t && t.loc) for (const [pk, pq] of Object.entries(sortParts(state, t.loc.type, q, tag))) got[pk] = (got[pk] || 0) + pq; // loot.js: parts by kind (their own dice)
    else got[key0] = (got[key0] || 0) + q;
  }
  if (out.ammo) out.ammoQ = out.ammo.q;
  const bm = rollBuildmat(state, tile, 0.5, `bscav${personKey(state, s.id)}${k ? `:${k}` : ""}`); // building materials around the base too (half a search hour's chance, once a trip)
  if (bm > 0) got.buildmat = (got.buildmat || 0) + bm;
  const ms = rollSheets(state, tile, 0.5, `bscav${personKey(state, s.id)}${k ? `:${k}` : ""}`); // metal sheets too (loot.js SHEET_FINDS; half a search hour's chance)
  if (ms > 0) got.metalsheet = (got.metalsheet || 0) + ms;
  out.got = got;
  out.finds = n;
  return out;
}
// A scavenger's find brought home (jobtrips.js, on arrival): into the stock, the stats and the log.
export function scavCredit(state, base, s, find, stock = base.stock) {
  if (!find || !find.finds) return;
  // ammo.js: rounds by calibre, as the place it came from holds them; the log names them ("6 9mm FMJ", not "6 ammo")
  const rounds = find.ammo ? { ...addFind(stock, find.ammo.type, find.ammo.q, false, "basescav", find.ammo.tile, state.hour, s.name) } : {};
  for (const [key, n] of Object.entries(find.got)) { if (FOODS[key] && stock === base.stock) addFood(base, key, n, { state }); else stock[key] = (stock[key] || 0) + n; } // foods.js: a food item with a fresh lot
  econStats(state).scavFinds += find.finds;
  const all = { ...find.got, ...(find.ammo ? { ammo: find.ammo.q } : {}) };
  for (const [key, n] of Object.entries(all)) noteOutput(state, base, "scavenge", n, key);
  noteOutput(state, base, "scavenge", find.finds, "finds");
  const named = { ...find.got, ...rounds };
  log(state, `${s.name.split(" ")[0]} turned up ${Object.entries(named).map(([key, n]) => (ROUND_SUPPLIES[key] ? roundsText({ [key]: n }) : FOODS[key] ? foodWord(key, n) : `${n} ${key === "buildmat" ? "building materials" : key === "metalsheet" ? (n === 1 ? "metal sheet" : "metal sheets") : keyWord(key)}`)).join(", ")} around ${base.name}.`, "good");
}
// Daily: the Scavenge job's day is in (its trips brought any finds home, jobtrips.js); the ground round the base is
// picked over for good by the people on it.
/** @param {State} state @param {Base} base */
function baseScavenging(state, base, people) {
  const scav = people.filter((s) => s.role === "scavenge" && !s.inBed);
  if (scav.length) noteOutput(state, base, "scavenge", 0, "finds");
  if (scav.length) base.scavLeft = Math.max(SCAV_FLOOR, scavLeft(base) - SCAV_DEPLETE * scav.length); // no recovery when nobody scavenges
}

// ---------- Fetch water (jobtrips.js) ----------
// The water the base's water carriers go to: its nearest water tile (tripland.js waterSources) { id, d } or null.
export const fetchWaterTile = (state, base) => waterSources(state, base, "water")[0] || null;
// Why nobody here can fetch water ("" = they can).
export function fetchWaterWhy(state, base) {
  const co = cutOffWhy(state, base); // poirooms.js (#71): a cut-off camp's people cannot leave its map
  if (co) return co;
  if (!fetchWaterTile(state, base)) return NO_WATER;
  if (rawRoom(base) < 1) return "the un-purified barrels are full";
  return "";
}
// Water a carrier brings in a day (trips that fit × two buckets).
export function fetchWaterDay(state, base) {
  const w = fetchWaterTile(state, base);
  return w ? waterTripsADay(w.d, walkMult(state)) * TRIP_JOBS.water.perTrip : 0;
}

// ---------- water ----------
// Purified and un-purified water (water.js): everything below is made un-purified (stock.rawwater); each day the
// boiler, the water filters and a shelter's fire purify it (worm.js purifyDaily) before people drink, purified water
// first. The capacity and the outlook count both kinds together.
// The hub has a well; an outpost a spring or a hand pump; a base by a river or lake draws from it too. Well
// buildings add more, rain catchers fill on wet days (weather.rainWater), cisterns hold more. Production only
// fills the base up to its capacity (water brought home on top of that is kept, though in summer a little of it
// evaporates: WATER.evaporate a day of what is above the capacity). Everyone living at a base drinks 1 a day times
// the season's thirst (weather.js THIRST: spring and autumn 1, summer 1.3, winter 0.9; at least 1.6 on a hot day),
// the sick with dysentery 1 more, prisoners in the cells the same as anyone (prisoners.js), and so do guests you
// shelter (visitors.js) and a supply convoy's crew holding there (supply.js) (upkeep.js: per head × heads); growing
// crops are watered by the farmers as their gauges need it (farming.js farmWaterHour; farming.cropWaterNeed is the
// day's estimate, more in summer). Water filters (crafting.js) add their water
// on top.
export const WATER = { hubWell: 12, spring: 3, stream: 3, well: 6, rainPerCatcher: 2, hubCap: 80, outpostCap: 40, cistern: 150, drink: 1, filter: 3, evaporate: 0.05 };
// The tanks and cisterns hold both kinds; water barrels (buildings.js WATER_BARREL) keep room for one kind each.
/** @param {Base} base */
export const tankCapacity = (base) => (isShelter(base) ? SHELTER.waterCap : base.type === "hub" ? WATER.hubCap : WATER.outpostCap) + count(base, "cistern") * WATER.cistern;
/** @param {Base} base */
export const waterCapacity = (base) => tankCapacity(base) + barrelRoom(base, "water") + barrelRoom(base, RAW);
// Where the water stands: each kind fills its own barrels first, then the shared tanks (purified water first); what
// is left over stands outside. { pure, raw, tanks, pureOut, rawOut, outside }.
/** @param {Base} base */
export function waterLayout(base) {
  const st = base.stock;
  const pure = Math.max(0, st.water || 0), raw = Math.max(0, st[RAW] || 0);
  const pureOver = Math.max(0, pure - barrelRoom(base, "water")), rawOver = Math.max(0, raw - barrelRoom(base, RAW));
  const tanks = tankCapacity(base);
  const pureOut = Math.max(0, pureOver - tanks);
  const rawOut = Math.max(0, rawOver - Math.max(0, tanks - pureOver));
  return { pure, raw, tanks, pureOut, rawOut, outside: pureOut + rawOut };
}
// Room for un-purified water coming in (the well, springs, rain, the river haul): its barrels and the tanks, not the
// purified barrels.
/** @param {Base} base */
export function rawRoom(base) {
  const st = base.stock;
  const pureOver = Math.max(0, (st.water || 0) - barrelRoom(base, "water"));
  return Math.max(0, tankCapacity(base) + barrelRoom(base, RAW) - pureOver - Math.max(0, st[RAW] || 0));
}
// camp-tier0: a shelter (buildings.js SHELTER, tier 0) has no well or spring of its own; beside a river or lake its
// people haul SHELTER.river a day instead of the stream's 3.
/** @param {Base} base */
const ownWell = (base) => (isShelter(base) ? 0 : base.type === "hub" ? WATER.hubWell : WATER.spring);
/** @param {Base} base */
const streamWater = (base) => (isShelter(base) ? SHELTER.river : WATER.stream);
/** @param {State} state @param {Base} base */
const byWater = (state, base) => state.grid.neighbors(base.tile).some((id) => state.tiles[id] && state.tiles[id].terrain === "water");
// Water one person drinks on a campaign day (day index; today by default): the season's thirst, a hot day's at least.
/** @param {State} state @param {number} [dayIdx] */
export const drinkRate = (state, dayIdx) => WATER.drink * (Weather.thirstFactor ? Weather.thirstFactor(state, dayIdx) : 1);
/** @param {Base} base */
const filtersAt = (base) => base.armory.filter((it) => it && it.key === "waterfilter").length;
/** @param {State} state @param {Base} base */
const prisonersHere = (state, base) => prisonersAt(state, base);

/** @param {State} state @param {Base} base */
export function waterProduction(state, base) {
  const factor = Weather.wellFactor ? Weather.wellFactor(state) : 1;
  const own = ownWell(base) * factor;
  const stream = byWater(state, base) ? streamWater(base) : 0;
  const wells = (count(base, "well") * WATER.well + pumpWater(base)) * factor; // electric.js: a powered pump down a well
  const rain = count(base, "rain_catcher") * WATER.rainPerCatcher * (Weather.rainWater ? Weather.rainWater(state) : 0);
  const filters = filtersAt(base) * WATER.filter;
  // hauled: prisoners set to Fetch water (prisoners.js labour), and the wells on your claims next to the base
  // (claims.js hauledWells: at most one well per 4 people at the base; claimWells lists them for the base card).
  const cw = hauledWells(state, base);
  const hauled = prisonWater(state, base) + cw.total;
  // field: the field wells planned from the base (fieldworks.js), hauled by the people left after the claim wells.
  const fw = fieldWellWater(state, base);
  const field = fw.total;
  const total = own + stream + wells + rain + hauled + field;
  return { own, stream, wells, rain, filters, hauled, field, fieldWells: fw.wells, claimWells: cw.wells, claimWellCap: cw.cap, factor, total: Math.round(total * 10) / 10 };
}

/** @param {State} state @param {Base} base */
export function waterNeed(state, base) {
  const mouths = residents(state, base.id);
  const rate = drinkRate(state);
  const w = Weather.weather ? Weather.weather(state) : null;
  const hot = !!w && (w.key === "heat" || w.hi >= 30);
  const sick = mouths.reduce((a, s) => a + conditionsOf(s).reduce((b, c) => b + (CONDITIONS[c.key].thirst || 0), 0), 0);
  const people = mouths.length * rate + sick;
  const nPris = prisonersHere(state, base), nGuests = guestsAt(state, base), nCrew = crewAt(state, base);
  const prisoners = nPris * rate; // drunk in prisoners.js, at the same rate
  const guests = (nGuests + nCrew) * rate; // drunk in visitors.js (shelter) and supply.js (a convoy holding here)
  const crops = cropWaterNeed(state, base);
  // The animal pens standing here (farming.js PEN): their water a day (the livestock station's), so the water plan
  // (wells, rain catchers, cisterns; the governor's waterPlan and waterTight) sees it before the pens run dry.
  const animals = stations(base).filter((b) => b.type === "animal_pen" && !b.broken).length * ((RECIPES.livestock && RECIPES.livestock.in.water) || 0);
  const season = Weather.season ? Weather.season(state).key : "spring";
  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    people: r1(people), prisoners: r1(prisoners), guests: r1(guests), crops, animals, total: r1(people + prisoners + guests + crops + animals), hot, rate: Math.round(rate * 100) / 100, season,
    n: mouths.length, sick: r1(sick), nPrisoners: nPris, nGuests, nCrew, heads: mouths.length + nPris + nGuests + nCrew,
  };
}

// Water per day and days left, for the top bar and the base panel.
/** @param {State} state @param {Base} base */
export function waterOutlook(state, base) {
  const prod = waterProduction(state, base);
  const need = waterNeed(state, base);
  const stock = waterIn(base.stock); // both kinds (water.js)
  const cap = waterCapacity(base);
  const inflow = prod.total + prod.filters;
  const net = inflow - need.total;
  // On a dry day: no rain in the catchers, and the crops need watering (for planning: is the supply enough?).
  const dryNet = inflow - prod.rain - need.people - need.prisoners - need.guests - need.animals - cropWaterNeed(state, base, { dry: true });
  return { stock, pure: Math.max(0, base.stock.water || 0), raw: Math.max(0, base.stock[RAW] || 0), cap, prod, need, inflow: Math.round(inflow * 10) / 10, net: Math.round(net * 10) / 10, dryNet: Math.round(dryNet * 10) / 10, daysLeft: net >= 0 ? Infinity : stock / -net };
}
// Water running short now: more drunk than made, and it runs out within 6 days or is under 3 a head. The governor
// puts a crafter on a queued water filter only then (autopilot planRoles), and so do work priorities (work.js).
/** @param {State} state @param {Base} base */
export function waterRunningShort(state, base) {
  const wo = waterOutlook(state, base);
  return wo.net < 0 && (wo.daysLeft < 6 || waterIn(base.stock) < wo.need.heads * 3);
}

// ---------- the summer water outlook ----------
// A planning figure for summer, by the usual summer weather rather than today's: wells and springs give about 90% on
// an average summer day (dry spells), a rain catcher about 0.7 a day, everyone drinks THIRST.summer and the crops on
// dry days SUMMER.crops more. A heat-wave stretch (wells and springs at 60%, no rain, everyone drinking THIRST.heat,
// the crops half again) lasts up to about SUMMER.heatStretch days, and the stock has to carry that gap.
// extra: more mouths (a newcomer check); people: count these instead of who lives here now; filterShare: count the
// water filters at this share (they clog up and cost scrap: the autopilot plans on three quarters). Returns the balances,
// the stock a summer needs (`reserve`: a heat stretch, plus ten days of any average-day shortfall), the shortfall on
// an average summer day (`short`, 0 when the sources keep up) and what would close it (`fix`).
export const SUMMER = { well: 0.9, rain: 0.7, heatWell: 0.6, crops: 1.2, heatCrops: 1.5, heatStretch: 9 };
/** @param {State} state @param {Base} base */
export function summerWater(state, base, { extra = 0, people = null, filterShare = 1 } = {}) {
  const T = Weather.THIRST || { summer: 1.3, heat: 1.6 };
  const r1 = (v) => Math.round(v * 10) / 10;
  const n = (people ?? residents(state, base.id).length) + prisonersHere(state, base) + extra;
  const springs = ownWell(base) + countAll(base, "well") * WATER.well; // broken wells count: they get repaired
  const stream = byWater(state, base) ? streamWater(base) : 0;
  const catchers = count(base, "rain_catcher");
  const filters = filtersAt(base) * WATER.filter * filterShare;
  // Crops: what the plots in the ground need on a dry day, an average crop (0.25) for a plot not growing now.
  const plots = farmOf(state, base).plots;
  const dryCrops = plots.reduce((a, p) => a + (p.stage === "growing" && CROPS[p.crop] ? CROPS[p.crop].water : 0.25), 0);
  const crops = dryCrops * SUMMER.crops;
  const inflow = springs * SUMMER.well + stream + catchers * SUMMER.rain + filters;
  const need = n * T.summer * WATER.drink + crops;
  const heatIn = springs * SUMMER.heatWell + stream + filters;
  const heatNeed = n * T.heat * WATER.drink + dryCrops * SUMMER.heatCrops;
  const net = inflow - need, heatNet = heatIn - heatNeed;
  const reserve = Math.ceil(Math.max(0, -heatNet) * SUMMER.heatStretch + Math.max(0, -net) * 10);
  const cap = waterCapacity(base);
  const short = Math.max(0, -net);
  // What would close the gap: wells first (steady), then filters (3 a day each), rain catchers (cheap, but nothing
  // in a dry spell), and cisterns so the reserve fits.
  const fix = [];
  const queued = (t) => base.construction.filter((c) => c.type === t).length;
  let gap = Math.max(short, -heatNet);
  const wellsLeft = Math.max(0, BUILDINGS.well.max - countAll(base, "well") - queued("well"));
  if (gap > 0 && wellsLeft) { const k = Math.min(wellsLeft, Math.ceil(gap / (WATER.well * SUMMER.heatWell))); fix.push({ type: "well", count: k }); gap -= k * WATER.well * SUMMER.heatWell; }
  if (gap > 0) fix.push({ type: "waterfilter", count: Math.ceil(gap / WATER.filter) });
  const catchersLeft = Math.max(0, BUILDINGS.rain_catcher.max - catchers - queued("rain_catcher"));
  if (short > 0 && catchersLeft) fix.push({ type: "rain_catcher", count: catchersLeft });
  const cisternsLeft = Math.max(0, BUILDINGS.cistern.max - countAll(base, "cistern") - queued("cistern"));
  if (reserve > cap && cisternsLeft) fix.push({ type: "cistern", count: Math.min(cisternsLeft, Math.ceil((reserve - cap) / WATER.cistern)) });
  return {
    n, rate: T.summer, heatRate: T.heat, inflow: r1(inflow), need: r1(need), net: r1(net), heatIn: r1(heatIn), heatNeed: r1(heatNeed), heatNet: r1(heatNet),
    crops: r1(crops), stock: Math.floor(waterIn(base.stock)), cap, reserve, short: r1(short), fix,
  };
}
const FIX_NAMES = { well: ["a well", "wells"], waterfilter: ["a water filter", "water filters"], rain_catcher: ["a rain catcher", "rain catchers"], cistern: ["a cistern", "cisterns"] };
export const summerFixText = (fix) => fix.map((f) => (f.count === 1 ? FIX_NAMES[f.type][0] : `${f.count} ${FIX_NAMES[f.type][1]}`)).join(", ");
// True when a base's summer water holds: the sources keep up on an average summer day, and a heat stretch's gap fits
// in what it can store.
export const summerWaterOk = (sw) => sw.net >= 0 && sw.reserve <= sw.cap;

// End of spring: SUMMER_WARN_DAYS before summer, a base whose summer water would not hold says so (a log line per
// base and one card), with the shortfall and what to build. Once a year per base.
export const SUMMER_WARN_DAYS = 7;
/** @param {State} state */
export function summerWarningDaily(state) {
  if (!Weather.season) return;
  const s = Weather.season(state);
  if (s.key !== "spring" || s.daysLeft !== SUMMER_WARN_DAYS) return;
  const T = Weather.THIRST || { summer: 1.3, heat: 1.6 };
  const pct = (f) => Math.round((f - 1) * 100);
  const lines = [];
  for (const base of state.bases) {
    if (base.owner != null && base.owner !== "player") continue;
    if (!residents(state, base.id).length || base.summerWarned === s.year) continue;
    const sw = summerWater(state, base);
    if (summerWaterOk(sw)) continue;
    base.summerWarned = s.year;
    const fixText = summerFixText(sw.fix);
    const line = sw.net < 0
      ? `${base.name}: ${sw.n} people drink ${sw.rate} each a day and the crops about ${sw.crops}, ${sw.need} in all against about ${sw.inflow} coming in: ${sw.short} a day short on an average summer day, ${-sw.heatNet} in a heat wave.`
      : `${base.name}: the water keeps up on an average summer day (+${sw.net}), but a heat wave (everyone drinks ${sw.heatRate}, wells at 60%) leaves it ${-sw.heatNet} a day short, and riding out ${SUMMER.heatStretch} days of that takes ${sw.reserve} water in store (room for ${sw.cap}).`;
    log(state, `☀️ Summer in ${SUMMER_WARN_DAYS} days. ${line}${fixText ? ` Build ${fixText}.` : ""}`, "danger");
    lines.push(`${line}${fixText ? ` To close it: ${fixText}.` : ""}`);
  }
  if (lines.length) addCard(state, {
    title: "Summer water",
    text: `Summer starts in ${SUMMER_WARN_DAYS} days: everyone drinks ${pct(T.summer)}% more water (${pct(T.heat)}% more in a heat wave), crops need more on dry days and wells give less in dry spells. ${lines.join(" ")} Wells and water filters keep up through a dry spell; rain catchers help on wet days; cisterns store water ahead of it. Thirst kills faster than hunger.`,
    summerWater: true,
    choices: [{ label: "OK", resolve: () => "" }],
  });
}

// Thirst: health lost per day by everyone at a base that ran dry (10, 14, 18 … up to 25), scaled by how short they
// were (at least 35%). Like hunger, armor does not help and nobody heals; it kills faster than hunger.
/** @param {number} days */
export const thirstDamage = (days) => Math.min(25, 6 + 4 * Math.max(1, days));
/** @param {State} state @param {Base} base */
function thirst(state, base, mouths, short, note = "") {
  base.thirstDays = (base.thirstDays || 0) + 1;
  econStats(state).thirstDays++;
  const dmg = Math.round(thirstDamage(base.thirstDays) * Math.max(0.35, short) * 10) / 10;
  for (const s of mouths) hurt(state, s, dmg, base.tile, `of thirst at ${base.name}`, { raw: true }); // mood: needs.js starvingDaily (parched, worse each day)
  log(state, `${base.name} is out of water (${Math.round(short * 100)}% short${base.thirstDays > 1 ? `, day ${base.thirstDays}` : ""}): everyone there loses ${dmg} health and nobody heals.${note}`, "danger");
}

// ---------- food ----------
// Food is by type (foods.js) and is counted here in days of food (2000 kcal). Storage and spoilage are in storage.js:
// every item keeps its own time, fresh food fills the base's food rooms (the hub's cellar, root cellars, a storehouse,
// a cold store, a walk-in freezer) coldest first and the rest is stored outside; spoiled food is thrown out.
// spoilRate = the share of the food that will spoil before it is eaten a day, foodSpoilage = days of food a day.
/** @param {State} state @param {Base} base */
export const spoilRate = (state, base) => foodStore(state, base).rate;
/** @param {State} state @param {Base} base */
export const foodSpoilage = (state, base) => foodStore(state, base).spoil;
export const RATION = 0.6, RATION_DAYS = 7; // short rations: share eaten, below this many days of food
// A base is out of food for the day (economy starve, an outpost's call on the hub) when its people missed more than this
// many days of food a head (eating.js: a meal or two not had; a crumb short is not starving).
export const EAT_SHORT = 0.15;
// What the people living here eat a day (per head × heads; upkeep.js: the cold, a Quartermaster). Prisoners, guests,
// a holding convoy's crew and the dog eat on top (foodUse(...).total; each in its own module).
/** @param {State} state @param {Base} base */
export const eatPerDay = (state, base) => foodUse(state, base).residents;

// Food outlook for the base panel: stock (days of food: fresh needs a room, the rest keeps), expected farm food (next
// 30 days), eaten (everyone fed from these stores, per head × heads: upkeep.js foodUse, in `use`), spoiled (what will
// spoil before it is eaten, storage.js spoilForecast) and used per day (workshops; the preserving room and drying
// racks turn fresh food into food that keeps, so only what they lose counts), days of food left without harvests, the
// next harvests and the storage.
/** @param {State} state @param {Base} base */
export function foodOutlook(state, base) {
  const farm = farmFoodPerDay(state, base);
  const so = scavengeOutput(state, base);
  const scav = ((so.food || 0) + (so.preserved || 0)) * shopFood(state, state.tiles[base.tile]);
  let used = 0;
  for (const st of stations(base)) {
    const ss = stationStatus(state, base, st);
    const inp = ss.in || RECIPES[ss.recipe].in;
    if (ss.running) used += (inp.food || 0) + (inp.fresh || 0) - foodIn(ss.out || {}); // the still (power.js) turns food into fuel; the kitchen jars it; the pen makes it
  }
  const rack = rackPlan(state, base);
  used += rack.take - rack.out;
  const use = foodUse(state, base);
  const eat = use.total;
  const store = foodStore(state, base);
  const spoil = store.spoil;
  const stock = edibleFood(base);
  const burn = eat + spoil + used - scav;
  return { stock, fresh: store.fresh, preserved: store.stable, stable: store.stable, store, farm, scav, used, eat, use, perHead: use.rate, heads: use.heads, spoil, net: farm + scav - eat - spoil - used, daysLeft: burn > 0 ? stock / burn : Infinity, harvests: nextHarvests(state, base) };
}

// Expected food a day from the plots less what everyone fed here eats (per head × heads).
/** @param {State} state @param {Base} base */
export function foodForecast(state, base) {
  return farmOutput(state, base) - foodUse(state, base).total;
}

// Hunger: health lost per day by everyone at a base that ran out of food, by consecutive days without
// (6, 8, 10 … up to 20). Armor and toughness do not help, and nobody heals while a base starves (medical.js),
// so a week or so without food kills.
/** @param {number} days */
export const hungerDamage = (days) => Math.min(20, 4 + 2 * Math.max(1, days));
/** @param {State} state @param {Base} base */
function starve(state, base, mouths) {
  base.hungerDays = (base.hungerDays || 0) + 1;
  econStats(state).hungerDays++;
  const dmg = hungerDamage(base.hungerDays);
  for (const s of mouths) hurt(state, s, dmg, base.tile, `of hunger at ${base.name}`, { raw: true }); // mood: needs.js starvingDaily (starving, worse each day)
  log(state, `${base.name} is out of food${base.hungerDays > 1 ? ` (day ${base.hungerDays}: everyone there loses ${dmg} health and nobody heals)` : ""}.`, "danger");
}

/** @param {State} state */
export function basesDaily(state) {
  for (const base of [...state.bases]) baseDaily(state, base);
  summerWarningDaily(state); // the end of spring: bases whose water would not hold through the summer
  healthDaily(state);
  wormDaily(state); // worm.js: catching the worm (water, raw meat), its stages, spotting, care, turning; infested herds
  fieldInfectionDaily(state);
  snaresDaily(state); // hunting.js: snare lines nobody came back for
  markAll(state); // history.js: the outposts' surplus run is stock moved, not made or used
  foodMarkAll(state); // foodlog.js: likewise
  shipFromOutposts(state);
  markAll(state, "move");
  foodMarkAll(state, "ship");
  maybeStranger(state);
  recruitsDaily(state); // recruits.js: people walking to a base arrive, deserters may come back
  hubEventsDaily(state); // hubevents.js: a decision for the days at home, and the lasting effects of past ones
  starvingDaily(state); // needs.js: each morning starving or parched in a row costs more mood (−2, −4, −6 …)
  relationsDaily(state); // relations.js: opinions, grief, the new mood factors and breaks
  mentalBreaksDaily(state); // mentalbreaks.js: days at rock bottom end in a break that changes the colony
}

/** @param {State} state @param {Base} base */
function baseDaily(state, base) {
  const rng = state.rng;
  const people = atBase(state, base.id);
  // Everyone who eats and sleeps here: the staff plus (hub) trade-route escorts waiting between trips.
  const mouths = residents(state, base.id);
  const st = base.stock;
  for (const s of people) if (s.role === "work") s.role = "scavenge";
  farmOf(state, base); // plots follow the buildings
  foodMark(state, base); // foodlog.js: the hours before midnight; then each step of the day below

  // Water in: the well, streams, wells and rain catchers fill the base up to its capacity (both kinds count), as
  // un-purified water (water.js).
  const prod = waterProduction(state, base);
  const room = rawRoom(base); // the un-purified barrels and the tanks (the purified barrels stay for safe water)
  st[RAW] = Math.max(0, st[RAW] || 0) + Math.min(room, prod.total);
  drawWells(state, base); // claims.js: the wells hauled from today lose what was drawn; one at 0 is dry
  drawFieldWells(state, base); // fieldworks.js: the field wells likewise
  // Summer: some of the water kept outside the tanks and cisterns (above the capacity) evaporates (un-purified first).
  const over = waterLayout(base).outside;
  if (over > 0 && Weather.season && Weather.season(state).key === "summer") drawWater(st, Math.round(over * WATER.evaporate * 10) / 10, { rawFirst: true });

  baseScavenging(state, base, people);
  foodMark(state, base, "scav");
  huntingDaily(state, base); // hunting.js: the Hunt and Fish jobs
  foodMark(state, base, "hunt");
  tripEventsDaily(state, base); // tripevents.js: the day's gunshots out on the land (base.tripNoise, hordes drawn)
  kitchenFireDaily(state, base); // kitchen.js: the stove's day of wood (after the boiler's and the heating's), or cold meals
  woodDaily(state, base); // woodcutting.js: the Cut wood job
  stoneDaily(state, base); // stone.js: the Gather stone job
  for (const s of people) if (s.role === "rest" || s.inBed) s.mood = Math.min(100, s.mood + (s.role === "rest" ? 6 : 3));
  assignStations(state, base);
  runStations(state, base);
  foodMark(state, base, "station");
  flowMark(state, base); // history.js: the day's production so far is in (before anyone drinks or eats)

  // Purifying (worm.js purifyDaily): the boiler (it burns its wood now), the water filters and a shelter's fire
  // turn un-purified water into purified water before anyone drinks.
  purifyDaily(state, base);
  // Drinking: people first (purified water first, then un-purified: worm.js rolls the share drunk un-purified), then the
  // crops get what is left (un-purified first). Thirst counts both kinds. People drink from the stores by the hour as
  // their thirst gauges drop (needs.js baseHour: the stock goes down through the day, as with food); here the day is
  // settled against its need: what the hours did not drink (the sick's extra water, a day nobody's gauge was due) is
  // drawn now. A day they drank more than its need leaves a credit for the next (at most a day's need): the gauges'
  // drinks come every half day or so, not on the midnight, so a day's drinking runs over or under its need.
  const need = waterNeed(state, base);
  const sipped = takeDrinkAcc(base);
  const paid = sipped.units + (base.drinkCredit || 0);
  const owed = Math.max(0, need.people - paid);
  base.drinkCredit = Math.round(Math.min(need.people, Math.max(0, paid - need.people)) * 100) / 100;
  // A base that never drinks un-purified water (rawdrink.js) pays with purified water only: short of it, it is out
  // of water however much un-purified water it holds. A question still waiting holds back only the hours' drinks.
  const pureOnly = rawDrinkOf(base) === "no";
  const have = pureOnly ? Math.max(0, st.water || 0) : waterIn(st);
  let drank;
  if (mouths.length && have + 1e-9 < owed) {
    const short = (owed - have) / need.people;
    drank = drawWater(st, have, { pureOnly });
    const raw = pureOnly ? Math.floor(st[RAW] || 0) : 0;
    thirst(state, base, mouths, short, raw > 0 ? ` ${raw} un-purified water is in store, but un-purified water is set to Never (the Overview).` : "");
  } else {
    drank = drawWater(st, owed, { pureOnly });
    base.thirstDays = 0;
  }
  base.drank = { day: day(state), pure: drank.pure + sipped.pure, raw: drank.raw + sipped.raw }; // worm.js baseWormDaily: the share drunk un-purified
  // The crops are watered by the hour as the farmers tend them (farming.js farmWaterHour), not here: the day counts
  // the hours each plot spent under its crop's line.
  farmingDaily(state, base);
  foodMark(state, base, "farm");
  flowMark(state, base); // history.js: drinking out, the harvest in (before the eating)

  // Eating: the people living here eat by the hour, each to their own target at the mealtimes (eating.js baseEatHour:
  // the cooked meals first, then the food nearest to spoiling); here the day that ended is counted (eatAcc: what they
  // ate from the stores, and what they wanted and could not get). The cook fire first makes the day's meals of the raw
  // food (storage.js cookDaily). An outpost that ran short is covered from the hub afterwards (shipFromOutposts:
  // base.foodShort); the hub starves. Under a week of food left, everyone goes on short rations (60%: eating.js eats to
  // 48 then): it stretches the stock and costs mood, not health. The week counts everyone fed from these stores
  // (prisoners, guests, a holding convoy's crew and the dog eat in their own modules; upkeep.js), but only the people
  // living here ration. A lean base (meals.js RATION_LEVELS, the player's or the governor's) costs −1 mood a day.
  const use = foodUse(state, base);
  const day0 = takeEatAcc(base);
  cookDaily(state, base, use.total); // the cook fire: a day's meals of raw meat, fish, greens and roots
  foodMark(state, base, "cook");
  const edible = edibleFood(base);
  const rationing = mouths.length > 0 && edible > 0 && edible < use.total * RATION_DAYS;
  if (rationing && !base.rationing) log(state, `${base.name} is on short rations: under ${RATION_DAYS} days of food left.`, "danger");
  base.rationing = rationing;
  if (rationing) for (const s of mouths) s.mood = Math.max(0, s.mood - 3);
  else if (mouths.length && rationKey(state, base) === "lean") for (const s of mouths) s.mood = Math.max(0, s.mood + RATION_LEVELS.lean.mood);
  const eaten = day0.units;
  // Wanted and not had: at most the day's need (the hungry ask again at every meal).
  const missing = mouths.length ? Math.min(day0.missed, use.residents) : 0;
  base.foodShort = missing > EAT_SHORT * mouths.length ? missing : 0; // the hub starves; an outpost asks the hub (shipFromOutposts)
  base.eatDay = { day: day(state) - 1, eaten: Math.round(eaten * 100) / 100, missed: Math.round(missing * 100) / 100, meals: day0.meals, min: day0.min };
  if (mouths.length) noteMeals(state, base); // relations.js: weeks of nothing fresh are grim; good meals lift the mood
  kitchenDaily(state, base, eaten); // kitchen.js: the hot meals served and the food they saved
  econStats(state).eaten += eaten;
  if (base.foodShort > 0 && base.type === "hub") {
    base.foodShort = 0;
    starve(state, base, mouths);
  } else if (!(base.foodShort > 0)) {
    base.hungerDays = 0;
    for (const s of mouths) s.mood = Math.min(100, s.mood + 1);
  }
  // Drying racks and the smokehouse, then every lot of food ages by where it sits (storage.js); spoiled food is gone.
  {
    foodMark(state, base);
    const out = storageDaily(state, base);
    foodSpoiled(state, base, out.items); // foodlog.js: the lots thrown out; the racks and the smokehouse below
    foodMark(state, base, "storage");
    const es = econStats(state);
    es.spoiled += out.spoiled;
    es.dried = (es.dried || 0) + out.dried;
  }
  // Healing: passive healing runs hourly (medical.js); here the daily meds use and infected wounds.
  medicalDaily(state, base);
  // Heating: below 0°C fuel per head (upkeep.js heatUse); without it everyone there is cold (needs.js heatDaily).
  heatDaily(state, base);
  // Beds (crowding scales with how far over capacity), the leader's lift (capped below crowding), warnings before
  // desertion and desertion itself (deserters keep their gear and may take supplies; checkGameOver): morale.js.
  baseMoraleDaily(state, base, people, mouths);
  // Stocks never go below zero here (an outpost's food shortfall is settled in shipFromOutposts).
  for (const k of Object.keys(st)) if (!FOODS[k]) st[k] = Math.round(st[k] * 10) / 10; // food: its lots keep the exact amounts (foods.js)
  for (const k of Object.keys(st)) if (st[k] < 0) st[k] = 0;
}

// A stranger at the gate: a recruit card (recruits.js) with the hub's beds, food and water. Taking them in costs
// 5 food on arrival (what the hub has then, never below zero).
/** @param {State} state */
function maybeStranger(state) {
  const h = hub(state);
  if (!state.rng.chance(0.06) || !h) return; // no base left (conquest.js exiles): nobody to come to
  const s = makeCandidate(state, { quality: 0.85 });
  offerRecruits(state, [s], { source: "stranger", baseId: h.id, title: "A stranger at the gate", intro: `${s.name} has been surviving alone and asks to join ${h.name}.` });
}

// ---------- outposts and supply lines ----------
/** @param {State} state @param {Base} base */
export function supplyLine(state, base) {
  const h = hub(state);
  const res = planPath(state, base.tile, h.tile, true) || planPath(state, base.tile, h.tile, false);
  if (!res) return { hours: Infinity, strength: 0, path: [] };
  let strength = Math.max(0.25, Math.min(1, 1 - res.cost / 40));
  const hostile = res.path.some((id) => {
    const o = state.tiles[id].owner;
    return typeof o === "number" && attitude(factionById(state, o)) === "Hostile";
  });
  const horde = res.path.some((id) => state.hordes.some((hh) => state.grid.distance(hh.tile, id) <= 1));
  if (hostile) strength *= 0.7;
  if (horde) strength *= 0.7;
  return { hours: Math.round(res.cost), strength, path: res.path, hostile, horde };
}

// What an outpost keeps of each supply when the midnight shipping sends its surplus to the hub (and what a "surplus"
// haul order leaves, hauling.js): food past RATION_DAYS + 1 days and 6, a week of water, rounds, a little scrap,
// parts, fuel and meds, the boiler's and a camp fire's wood, what its supply runs take, what its paid jobs still
// wait for (the step up: pt-int round 2).
export function outpostKeep(state, base) {
  const staff = atBase(state, base.id);
  const fed = mouthsAt(state, base).heads;
  const boil = boilerUse(state, base);
  const lineDays = RATION_DAYS + 1;
  // A camp's fire (tier 0, woodcutting.js shelterFire, 8f76998) burns from its own pile and nothing sends it back:
  // its WOOD.fire.keepDays stay (woodNeed's fire).
  const fireKeep = base.tier === 0 ? Math.ceil(fireDayBurn(state, base).total * WOOD.fire.keepDays) : 0;
  const keep = { food: Math.ceil(foodUse(state, base).total * lineDays) + 6, water: fed * 7 + 5, ammo: staff.length * 6, scrap: 30, parts: base.construction.length ? 3 : 0, fuel: 10, meds: 2, wood: (boil.active ? Math.ceil(boil.wood * 3) : 0) + fireKeep };
  // Supply runs: keep what a run from here will send, and what a run to here will pick up.
  for (const [k, v] of Object.entries(supplyReserve(state, base))) keep[k] = (keep[k] || 0) + v;
  // What its gathered jobs still wait for (the step up: its scrap, building materials and, since the user's pick of
  // 2026-10-20, its wood) stays: shipped every midnight, an outpost camp's wood went to the hub before its step up
  // took it, and it was never established (pt-int round 2, outpostcamptest).
  for (const job of base.construction || []) if (job.paid) for (const r of gatherRows(job)) if (!r.ok) keep[r.key] = (keep[r.key] || 0) + Math.ceil(r.need - r.have);
  for (const [k, v] of Object.entries(chooseRounds(base.stock, keep.ammo, baseCals(state, base)))) keep[k] = (keep[k] || 0) + v; // ammo.js: the rounds kept are the ones its guns shoot
  keep[RAW] = (keep[RAW] || 0) + Math.max(0, keep.water - Math.max(0, base.stock.water || 0)); // the water kept counts both kinds (water.js): purified first
  return keep;
}

/** @param {State} state */
function shipFromOutposts(state) {
  const h = hub(state);
  for (const base of state.bases) {
    if (base.type !== "outpost") continue;
    if (isCamp(base) && !tierUpJob(base) && !base.grow) continue; // a plain camp (staging.js) is off the supply network: it lives on what it holds; Build outpost's (base.grow) is on it before its house is placed
    const staff = atBase(state, base.id);
    const line = supplyLine(state, base);
    base.supplyLine = { hours: line.hours, strength: line.strength, hostile: line.hostile, horde: line.horde };
    // No land route to the hub: nothing moves either way. The outpost keeps its stock and lives off it.
    const cutOff = !(line.strength > 0);
    if (cutOff) log(state, `${base.name} is cut off: there is no land route to ${h.name}. No food came in and nothing was shipped out.`, "danger");
    if (base.foodShort > 0) {
      let short = base.foodShort;
      if (!cutOff && h) {
        // The hub sends food (the soonest to spoil first), but the supply line loses some on the way; what arrives is
        // eaten today.
        // eating.js: the people there eat it as they get it (by the hour), so it goes into the outpost's stores.
        const send = Math.max(0, Math.min(edibleFood(h), short / line.strength));
        short -= moveFoodUnits(h, base, send, { scale: line.strength, state }).units * line.strength;
      }
      base.foodShort = 0;
      if (short > 1e-9) starve(state, base, staff);
      else base.hungerDays = 0;
    } else base.hungerDays = 0;
    // hauling.js: haulers carry the directions their orders cover (an order that way and a hauler at either end); the
    // midnight shipping in that direction stops. With no hauler it stays the default.
    const hauled = haulCovers(state, base, h);
    if (!cutOff) {
      // Ship surplus to the hub, keeping a reserve: enough scrap to save up for a building (and parts once a job is queued).
      // Water and seed: an outpost keeps a week of water (its own well is small) and food to sow its plots.
      // Food and water by everyone fed here (per head × heads, upkeep.js: prisoners and guests too); ammo by the staff.
      // Wood: a few days of the water boiler's (worm.js boilerUse) stays here; the rest pools at the hub, which sends
      // heating and boiler wood back over the line as the outpost runs short (needs.js heatDaily, worm.js boilerDaily).
      // Food: past RATION_DAYS, so a staffed outpost is not on short rations while the hub's cellar is full (huge census:
      // outposts rationed on 61-95% of their days with 900-6,400 food at the hub); the hub tops it up to that line.
      const lineDays = RATION_DAYS + 1;
      if (staff.length && !hauled.down) {
        const want = foodUse(state, base).total * lineDays - edibleFood(base);
        const spare = edibleFood(h) - foodUse(state, h).total * lineDays;
        if (want > 0 && spare > 0) moveFoodUnits(h, base, Math.min(spare, want / line.strength), { scale: line.strength, state }); // foods.js: the soonest to spoil first, with its lots
      }
      // A camp's fire (tier 0, woodcutting.js shelterFire, 8f76998) burns from its own pile and nothing sends it back:
      // its WOOD.fire.keepDays stay (woodNeed's fire). Shipped every midnight, the pile its woodcutter had cut was gone,
      // the governor kept the cutter on it for good (planWood) and a two-person outpost camp had nobody to establish it.
      const keep = outpostKeep(state, base);
      // Food: days of food over the keep go to the hub, the food that keeps first (the outpost eats its fresh food).
      const foodSurplus = hauled.up ? 0 : edibleFood(base) - keep.food;
      if (foodSurplus > 1) {
        const pick = packPick(state, base, foodSurplus, { days: 30 });
        for (const [k, q] of Object.entries(pick)) { const t = takeItem(base, k, q, { state }); for (const l of t.lots) addFood(h, k, l.q * line.strength, { left: l.left, egg: l.egg, state }); }
      }
      for (const k of hauled.up ? [] : Object.keys(base.stock)) {
        if (FOODS[k]) continue;
        const surplus = base.stock[k] - (keep[k] || 0);
        if (surplus > supplyFew(k, 1)) {
          base.stock[k] -= surplus;
          h.stock[k] = (h.stock[k] || 0) + surplus * line.strength;
        }
      }
    }
    for (const k of Object.keys(base.stock)) base.stock[k] = Math.max(0, FOODS[k] ? base.stock[k] : Math.round(base.stock[k] * 10) / 10);
  }
}

// ---------- trade routes ----------
export const ESCORTS = {
  light:    { name: "Light",    people: 1, desc: "Quiet: fewer zombie events, but raiders see an easy target" },
  standard: { name: "Standard", people: 3, desc: "Balanced" },
  heavy:    { name: "Heavy",    people: 5, desc: "Loud: deters small raids, draws zombies and big raids near aggressive groups" },
};

/** @param {State} state */
export function routesDaily(state) {
  const d = day(state);
  for (const r of state.routes) {
    if (!r.active) continue;
    const f = factionById(state, r.factionId);
    if (!f || !f.alive) {
      r.active = false;
      releaseEscorts(state, r);
      log(state, "A trade route ended: the partner group is gone.", "danger");
      continue;
    }
    const out = state.parties.some((p) => p.routeId === r.id);
    if (!out && d >= r.nextDay) {
      dispatchConvoy(state, r);
      r.nextDay = d + r.interval;
    }
  }
}

/** @param {State} state */
export function releaseEscorts(state, r) {
  for (const id of r.escortIds) {
    const s = survivorById(state, id);
    if (s && s.alive && s.location.kind === "route" && hub(state)) s.location = { kind: "base", baseId: hub(state).id };
  }
}

// ---------- death sites ----------
// A cart on the ground with something in it loses the most valuable thing (an item, else a lot of supplies). Returns
// true when it did (the cart stays, worth less).
function stripCart(e) {
  const c = e && e.kind === "gear" && isCart(e.item) ? e.item : null;
  if (!c) return false;
  const items = (c.contents || []).map((it, i) => ({ it, i })).filter((x) => x.it);
  if (items.length) {
    const best = items.sort((a, b) => ((GEAR[b.it.key] && GEAR[b.it.key].value) || 0) - ((GEAR[a.it.key] && GEAR[a.it.key].value) || 0))[0];
    c.contents[best.i] = null;
  } else if (c.held && c.held.length) {
    c.held.sort((a, b) => b.q * supValue(b.k) - a.q * supValue(a.k));
    c.held.shift();
    if (!c.held.length) delete c.held;
  } else return false;
  e.value = cartWorth(c);
  e.cartKg = Math.round(itemLoad(c) * 10) / 10;
  return true;
}
/** @param {State} state */
export function deathSitesDaily(state) {
  const rng = state.rng;
  const d = day(state);
  for (const site of [...state.deathSites]) {
    const t = state.tiles[site.tile];
    let traffic = TERRAIN[t.terrain].traffic || 0.02;
    if (t.road) traffic += 0.2;
    if (typeof t.owner === "number") traffic += 0.2;
    if (t.loc && (t.loc.type === "town" || t.loc.type === "city")) traffic += 0.1;
    const age = d - site.day;
    const chance = site.abandoned ? Math.min(0.9, traffic + 0.02) * ROAD_CARTS.scav : Math.min(0.9, traffic * (1 + age / 8) + 0.02); // carts.js: a cart abandoned on a road is found slowly
    if ((site.abandoned ? hash01(state.seed, "roadcart", site.tile, d) >= chance : !rng.chance(chance)) || !site.items.length) continue; // carts.js: an abandoned cart rolls its own dice (the world's draws stay as they were)
    // Scavengers take the most valuable item first. A cart (carts.js) is stripped first, the best thing in it at a time;
    // empty, the cart itself goes (the nearest group keeps it: f.carts).
    site.items.sort((a, b) => b.value - a.value);
    if (stripCart(site.items[0])) { if (state.live.has(site.tile)) log(state, `Someone has been at the ${site.items[0].name.toLowerCase()} left at ${t.loc ? t.loc.name : "the death site"}.`, "danger"); continue; }
    const taken = site.items.shift();
    if (taken.kind === "gear") {
      const f = state.factions.filter((f) => f.alive).sort((a, b) =>
        Math.min(...a.bases.map((x) => state.grid.distance(x, site.tile))) - Math.min(...b.bases.map((x) => state.grid.distance(x, site.tile))))[0];
      if (f) { f.lootedGear.push(taken.name); if (taken.item && !isCart(taken.item)) { note(state, "found", goodsRounds([taken.item])); keepItem(state, f, taken.item, "found"); } } // arsenal.js: the very item (docs/adr/0001-ai-parity.md), the rounds loaded in it from outside the AI side (ledger.js)
      if (f && isCart(taken.item)) f.carts = (f.carts || 0) + 1; // carts.js: a group's carts (AI parity, coarse)
    }
    if (state.live.has(site.tile)) log(state, `Someone looted ${taken.name} from the bodies at ${t.loc ? t.loc.name : "the death site"}.`, "danger");
    if (!site.items.length && !(site.walked && site.walked.length)) state.deathSites.splice(state.deathSites.indexOf(site), 1); // walked: the grave stays (carriers.js)
  }
}

export { alive };
