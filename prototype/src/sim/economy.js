// Daily economy for every base (hub and outposts share the same rules): water, base scavenging, farming
// (farming.js), eating, food storage and spoiling (storage.js), illness (health.js), supply lines, trade routes and
// death-site looting.
import { TERRAIN, LOCATIONS, SUPPLIES, supplyFew } from "./data.js";
import {
  log, addCard, day, hub, atBase, alive, skill, hurt, survivorById, factionById, makeSurvivor, residents, checkGameOver,
} from "./world.js";
import { planPath, dispatchConvoy } from "./parties.js";
import { attitude } from "./factions.js";
import { count, countAll, baseBeds, runStations, assignStations, stations, stationStatus, RECIPES, BUILDINGS, isShelter, SHELTER, barrelRoom } from "./buildings.js";
import { supplyReserve } from "./supply.js";
import { medicalDaily, fieldInfectionDaily } from "./medical.js";
import { toolBonus } from "./crafting.js";
import { farmingDaily, farmFoodPerDay, cropWaterNeed, nextHarvests, farmOf, econStats, CROPS } from "./farming.js";
import { healthDaily, workFactor, conditionsOf, CONDITIONS } from "./health.js";
import * as Weather from "./weather.js";
import { foodStore, storageDaily, eatFromStore, edibleFood, rackPlan } from "./storage.js";
import { baseMoraleDaily } from "./morale.js";
import { makeCandidate, offerRecruits, recruitsDaily } from "./recruits.js";
import { hubEventsDaily } from "./hubevents.js";
import { hasPerk } from "./skills.js";
import { relationsDaily, noteMeals } from "./relations.js";
import { mentalBreaksDaily } from "./mentalbreaks.js";
import { huntingDaily, snaresDaily } from "./hunting.js";
import { foodUse, mouthsAt, prisonersAt, guestsAt, crewAt } from "./upkeep.js";
import { heatDaily } from "./needs.js";
import { woodDaily } from "./woodcutting.js";
import { prisonWater } from "./prisoners.js"; // prisoners-tab: water hauled by prisoners (waterProduction)
import { hauledWells, drawWells } from "./claims.js"; // wells dug on claims next to the base (waterProduction hauled)
import { cookAtBase, wormDaily, boilerUse, purifyDaily } from "./worm.js";
import { waterIn, drawWater, RAW } from "./water.js"; // purified and un-purified water

export const ROLES = {
  farm:     { name: "Farm",     desc: "Tends, plants and harvests the crop plots (Farming tab). Crops take days to ripen; more farmers per plot and better Farming give a bigger harvest from the same days. Ripe crops left unharvested rot." },
  scavenge: { name: "Scavenge", desc: "Picks through the ruins right around this base. Usually finds nothing: a small chance a day of a small find (better with Scavenging, worse as the area is picked over). Expeditions to real sites are where supplies come from." },
  operate:  { name: "Operate",  desc: "Runs a workshop station (ammo, meds, parts or the preserving kitchen). Loud: raises Heat." },
  build:    { name: "Build",    desc: "Works on the construction queue. More builders finish faster; Mechanics helps." },
  guard:    { name: "Guard",    desc: "Defends the base. Guards count 1.5× in fights." },
  rest:     { name: "Rest",     desc: "Recovers mood, and the sick get better faster. Injured people heal either way." },
  medic:    { name: "Medic",    desc: "Staffs the infirmary or hospital (each tier needs 1–3 medics to run; unstaffed it works like no hospital). The best medic's Medicine speeds up healing for patients in beds; with no medic only slow natural healing and weak meds. Medics are never admitted as patients, and catch contagious illness more easily." },
  craft:    { name: "Craft",    desc: "Makes makeshift gear and supplies by hand from the craft queue (base Crafting tab). No station needed; Mechanics (or Medicine for kits) sets what they can make and how fast." },
  teach:    { name: "Teach",    desc: "Teaches one skill to up to 2 people at this base whose skill is at least 4 below theirs (pick the skill and learners on their survivor screen, or leave it to them). Learners gain 4 + 0.4 × the teacher's skill + 0.15 × the teacher's Leadership and Speech XP a day and keep their own jobs; the teacher does no other work." },
  hunt:     { name: "Hunt",     desc: "Hunts the land within 2 tiles of a base with a Hunting cabin, 3 hours a day at dawn and dusk, by the base's hunting mix (Farming tab): traps (silent, small game), bows (silent, the base's arrows) or guns (the base's ammo; shots add Heat and can draw the dead); no weapon: snares. Brings in fresh game, which spoils fast unless it is eaten, dried or smoked. Hunted hard, the land runs out of game for weeks." },
  fish:     { name: "Fish",     desc: "Fishes the river or lake by a base 3 hours a day, with a fishing rod or net (carried, or in the armory: one each). Brings in fresh fish, which spoils fast." },
  forage:   { name: "Forage",   desc: "Gathers wild food within 2 tiles of the base 6 hours a day (foraging.js): berries, nuts, mushrooms, greens, roots, apples, now and then herbs (meds) or honey. About a ration a day each in summer, more in autumn, little in spring, next to nothing in winter; Farming and Scouting help. The land picked hard grows back over weeks." },
  wood:     { name: "Cut wood", desc: "Cuts firewood within 2 tiles of the base 6 hours a day (woodcutting.js): the winter's heating (a base burns firewood before fuel: 15, 1.5 kg, a head a day below freezing). Forest gives most (about 140 a day each with an axe), hills fair, farmland and suburbs little, a city next to nothing. An axe (their own or one from the armory), a machete or a sledgehammer cuts much faster than bare hands; Farming and Mechanics help. Loud (base Heat), and axes slip. The land cut hard grows back over seasons." },
  read:     { name: "Read",     desc: "Reads a book from this base's armory 6 hours a day (pick it on their survivor screen, or leave it to them): skill books give 4 XP an hour up to the book's level, comics and novels give mood. One reader per copy at a time; a reader does no other work." },
};

// Farming and scavenging bonuses from where the base sits.
export function siteBonus(state, base) {
  const t = state.tiles[base.tile];
  const loc = t.loc ? t.loc.type : null;
  return {
    farm: loc === "farm" || t.terrain === "plains" ? 1.3 : t.terrain === "forest" ? 0.8 : t.terrain === "hills" ? 0.7 : 1,
    scav: loc ? 1.2 : t.terrain === "city" || t.terrain === "suburb" ? 1.2 : 0.8,
    table: loc ? LOCATIONS[loc].loot : { scrap: 3, food: 1 },
  };
}

// Expected food per day from the plots over the next 30 days (what is in the ground, by when it ripens).
export function farmOutput(state, base) {
  return farmFoodPerDay(state, base);
}

// ---------- base scavenging ----------
// Rare by design: each scavenger has a small chance a day of a small find. The chance grows with Scavenging (and a
// crowbar), Greedy, and the site; it drops as the surroundings get picked over (base.scavLeft, 1 → 0.2, 0.004 per
// scavenger a day; it never comes back: nothing out there grows back, aiscav.js). Expeditions to real sites are where
// supplies come from.
export const GREEDY_SCAV = 1.15; // the Greedy trait: finds more when scavenging around a base
export const BASE_SCAV_CHANCE = 0.07;   // per scavenger per day at Scavenging 0, fresh surroundings
export const SCAV_FIND = { scrap: [2, 5], food: [1, 3], water: [2, 4], rawwater: [2, 4], ammo: [3, 8], meds: [1, 1], fuel: [1, 2], parts: [1, 1], preserved: [1, 3], jars: [2, 6] };
export const SCAV_DEPLETE = 0.004, SCAV_FLOOR = 0.2;
export const scavLeft = (base) => (base.scavLeft == null ? 1 : base.scavLeft);

export function scavChance(state, base, s) {
  const b = siteBonus(state, base);
  const p = BASE_SCAV_CHANCE * (1 + (skill(s, "scavenging") + toolBonus(s, "scavenging")) * 0.04) * b.scav * (s.traits.includes("greedy") ? GREEDY_SCAV : 1) * scavLeft(base) * workFactor(s) * (hasPerk(s, "scrounger") ? 1.3 : 1); // Scrounger (skills.js)
  return Math.min(0.5, p);
}
// What a find is drawn from: the site's own table, with scrap always likely; fuel and parts are rare.
function scavTable(state, base) {
  const t = { ...siteBonus(state, base).table };
  t.scrap = (t.scrap || 0) + 2;
  if (t.fuel) t.fuel *= 0.4;
  if (t.parts) t.parts *= 0.5;
  return t;
}
// Expected supplies per day (for the UI and tests).
export function scavengeOutput(state, base) {
  const people = atBase(state, base.id).filter((s) => s.role === "scavenge" && !s.inBed);
  const table = scavTable(state, base);
  const w = Object.values(table).reduce((a, v) => a + v, 0) || 1;
  const p = people.reduce((a, s) => a + scavChance(state, base, s), 0);
  const out = {};
  for (const [k, v] of Object.entries(table)) out[k] = (p * v / w) * (SCAV_FIND[k][0] + SCAV_FIND[k][1]) / 2;
  return out;
}

function baseScavenging(state, base, people) {
  const rng = state.rng;
  const scav = people.filter((s) => s.role === "scavenge" && !s.inBed);
  const table = scavTable(state, base);
  const keys = Object.keys(table);
  for (const s of scav) {
    if (!rng.chance(scavChance(state, base, s))) continue;
    const k = rng.weighted(keys, (x) => table[x]);
    const q = rng.int(SCAV_FIND[k][0], SCAV_FIND[k][1]);
    base.stock[k] = (base.stock[k] || 0) + q;
    econStats(state).scavFinds++;
    log(state, `${s.name.split(" ")[0]} turned up ${q} ${k} around ${base.name}.`, "good");
  }
  if (scav.length) base.scavLeft = Math.max(SCAV_FLOOR, scavLeft(base) - SCAV_DEPLETE * scav.length); // no recovery when nobody scavenges
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
// crops are watered on dry days (farming.cropWaterNeed, more in summer). Water filters (crafting.js) add their water
// on top.
export const WATER = { hubWell: 12, spring: 3, stream: 3, well: 6, rainPerCatcher: 2, hubCap: 80, outpostCap: 40, cistern: 150, drink: 1, filter: 3, evaporate: 0.05 };
// The tanks and cisterns hold both kinds; water barrels (buildings.js WATER_BARREL) keep room for one kind each.
export const tankCapacity = (base) => (isShelter(base) ? SHELTER.waterCap : base.type === "hub" ? WATER.hubCap : WATER.outpostCap) + count(base, "cistern") * WATER.cistern;
export const waterCapacity = (base) => tankCapacity(base) + barrelRoom(base, "water") + barrelRoom(base, RAW);
// Where the water stands: each kind fills its own barrels first, then the shared tanks (purified water first); what
// is left over stands outside. { pure, raw, tanks, pureOut, rawOut, outside }.
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
export function rawRoom(base) {
  const st = base.stock;
  const pureOver = Math.max(0, (st.water || 0) - barrelRoom(base, "water"));
  return Math.max(0, tankCapacity(base) + barrelRoom(base, RAW) - pureOver - Math.max(0, st[RAW] || 0));
}
// camp-tier0: a shelter (buildings.js SHELTER, tier 0) has no well or spring of its own; beside a river or lake its
// people haul SHELTER.river a day instead of the stream's 3.
const ownWell = (base) => (isShelter(base) ? 0 : base.type === "hub" ? WATER.hubWell : WATER.spring);
const streamWater = (base) => (isShelter(base) ? SHELTER.river : WATER.stream);
const byWater = (state, base) => state.grid.neighbors(base.tile).some((id) => state.tiles[id] && state.tiles[id].terrain === "water");
// Water one person drinks on a campaign day (day index; today by default): the season's thirst, a hot day's at least.
export const drinkRate = (state, dayIdx) => WATER.drink * (Weather.thirstFactor ? Weather.thirstFactor(state, dayIdx) : 1);
const filtersAt = (base) => base.armory.filter((it) => it && it.key === "waterfilter").length;
const prisonersHere = (state, base) => prisonersAt(state, base);

export function waterProduction(state, base) {
  const factor = Weather.wellFactor ? Weather.wellFactor(state) : 1;
  const own = ownWell(base) * factor;
  const stream = byWater(state, base) ? streamWater(base) : 0;
  const wells = count(base, "well") * WATER.well * factor;
  const rain = count(base, "rain_catcher") * WATER.rainPerCatcher * (Weather.rainWater ? Weather.rainWater(state) : 0);
  const filters = filtersAt(base) * WATER.filter;
  // hauled: prisoners set to Fetch water (prisoners.js labour), and the wells on your claims next to the base
  // (claims.js hauledWells: at most one well per 4 people at the base; claimWells lists them for the base card).
  const cw = hauledWells(state, base);
  const hauled = prisonWater(state, base) + cw.total;
  const total = own + stream + wells + rain + hauled;
  return { own, stream, wells, rain, filters, hauled, claimWells: cw.wells, claimWellCap: cw.cap, factor, total: Math.round(total * 10) / 10 };
}

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
  const season = Weather.season ? Weather.season(state).key : "spring";
  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    people: r1(people), prisoners: r1(prisoners), guests: r1(guests), crops, total: r1(people + prisoners + guests + crops), hot, rate: Math.round(rate * 100) / 100, season,
    n: mouths.length, sick: r1(sick), nPrisoners: nPris, nGuests, nCrew, heads: mouths.length + nPris + nGuests + nCrew,
  };
}

// Water per day and days left, for the top bar and the base panel.
export function waterOutlook(state, base) {
  const prod = waterProduction(state, base);
  const need = waterNeed(state, base);
  const stock = waterIn(base.stock); // both kinds (water.js)
  const cap = waterCapacity(base);
  const inflow = prod.total + prod.filters;
  const net = inflow - need.total;
  // On a dry day: no rain in the catchers, and the crops need watering (for planning: is the supply enough?).
  const dryNet = inflow - prod.rain - need.people - need.prisoners - need.guests - cropWaterNeed(state, base, { dry: true });
  return { stock, pure: Math.max(0, base.stock.water || 0), raw: Math.max(0, base.stock[RAW] || 0), cap, prod, need, inflow: Math.round(inflow * 10) / 10, net: Math.round(net * 10) / 10, dryNet: Math.round(dryNet * 10) / 10, daysLeft: net >= 0 ? Infinity : stock / -net };
}
// Water running short now: more drunk than made, and it runs out within 6 days or is under 3 a head. The governor
// puts a crafter on a queued water filter only then (autopilot planRoles), and so do work priorities (work.js).
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
export const thirstDamage = (days) => Math.min(25, 6 + 4 * Math.max(1, days));
function thirst(state, base, mouths, short) {
  base.waterFed = Math.round((1 - short) * 100) / 100; // needs.js: the share of a day's water everyone got (thirst gauges)
  base.thirstDays = (base.thirstDays || 0) + 1;
  econStats(state).thirstDays++;
  const dmg = Math.round(thirstDamage(base.thirstDays) * Math.max(0.35, short) * 10) / 10;
  for (const s of mouths) {
    s.mood = Math.max(0, s.mood - 8);
    hurt(state, s, dmg, base.tile, `of thirst at ${base.name}`, { raw: true });
  }
  log(state, `${base.name} is out of water (${Math.round(short * 100)}% short${base.thirstDays > 1 ? `, day ${base.thirstDays}` : ""}): everyone there loses ${dmg} health and nobody heals.`, "danger");
}

// ---------- food ----------
// Food storage and spoilage are in storage.js: fresh food fills the base's storage room (the hub's cellar, root
// cellars, a storehouse, a cold store) and spoils slowly there; food above the room is stored outside and spoils
// fast; preserved food barely spoils. spoilRate = today's average rate of the fresh food, foodSpoilage = food
// (fresh and preserved) lost a day.
export const spoilRate = (state, base) => foodStore(state, base).rate;
export const foodSpoilage = (state, base) => foodStore(state, base).spoil;
export const RATION = 0.6, RATION_DAYS = 7; // short rations: share eaten, below this many days of food
// What the people living here eat a day (per head × heads; upkeep.js: the cold, a Quartermaster). Prisoners, guests,
// a holding convoy's crew and the dog eat on top (foodUse(...).total; each in its own module).
export const eatPerDay = (state, base) => foodUse(state, base).residents;

// Food outlook for the base panel: stock (fresh + preserved), expected farm food (next 30 days), eaten (everyone fed
// from these stores, per head × heads: upkeep.js foodUse, in `use`), spoiled and used per day (workshops; the
// preserving kitchen and drying racks turn fresh food into preserved, so only what they lose counts), days of food
// left without harvests, the next harvests and the storage.
export function foodOutlook(state, base) {
  const farm = farmFoodPerDay(state, base);
  const scav = (scavengeOutput(state, base).food || 0) + (scavengeOutput(state, base).preserved || 0);
  let used = 0;
  for (const st of stations(base)) {
    const ss = stationStatus(state, base, st);
    if (ss.running) used += ((ss.in || RECIPES[ss.recipe].in).food || 0) - (ss.out.preserved || 0); // the still (power.js) turns food into fuel
  }
  const rack = rackPlan(state, base);
  used += rack.take - rack.out;
  const use = foodUse(state, base);
  const eat = use.total;
  const store = foodStore(state, base);
  const spoil = store.spoil;
  const stock = edibleFood(base);
  const burn = eat + spoil + used - scav;
  return { stock, fresh: store.fresh, preserved: store.preserved, store, farm, scav, used, eat, use, perHead: use.rate, heads: use.heads, spoil, net: farm + scav - eat - spoil - used, daysLeft: burn > 0 ? stock / burn : Infinity, harvests: nextHarvests(state, base) };
}

// Expected food a day from the plots less what everyone fed here eats (per head × heads).
export function foodForecast(state, base) {
  return farmOutput(state, base) - foodUse(state, base).total;
}

// Hunger: health lost per day by everyone at a base that ran out of food, by consecutive days without
// (6, 8, 10 … up to 20). Armor and toughness do not help, and nobody heals while a base starves (medical.js),
// so a week or so without food kills.
export const hungerDamage = (days) => Math.min(20, 4 + 2 * Math.max(1, days));
function starve(state, base, mouths) {
  base.hungerDays = (base.hungerDays || 0) + 1;
  econStats(state).hungerDays++;
  const dmg = hungerDamage(base.hungerDays);
  for (const s of mouths) {
    s.mood = Math.max(0, s.mood - 10);
    hurt(state, s, dmg, base.tile, `of hunger at ${base.name}`, { raw: true });
  }
  log(state, `${base.name} is out of food${base.hungerDays > 1 ? ` (day ${base.hungerDays}: everyone there loses ${dmg} health and nobody heals)` : ""}.`, "danger");
}

export function basesDaily(state) {
  for (const base of [...state.bases]) baseDaily(state, base);
  summerWarningDaily(state); // the end of spring: bases whose water would not hold through the summer
  healthDaily(state);
  wormDaily(state); // worm.js: catching the worm (water, raw meat), its stages, spotting, care, turning; infested herds
  fieldInfectionDaily(state);
  snaresDaily(state); // hunting.js: snare lines nobody came back for
  shipFromOutposts(state);
  maybeStranger(state);
  recruitsDaily(state); // recruits.js: people walking to a base arrive, deserters may come back
  hubEventsDaily(state); // hubevents.js: a decision for the days at home, and the lasting effects of past ones
  relationsDaily(state); // relations.js: opinions, grief, the new mood factors and breaks
  mentalBreaksDaily(state); // mentalbreaks.js: days at rock bottom end in a break that changes the colony
}

function baseDaily(state, base) {
  const rng = state.rng;
  const people = atBase(state, base.id);
  // Everyone who eats and sleeps here: the staff plus (hub) trade-route escorts waiting between trips.
  const mouths = residents(state, base.id);
  const st = base.stock;
  for (const s of people) if (s.role === "work") s.role = "scavenge";
  farmOf(state, base); // plots follow the buildings

  // Water in: the well, streams, wells and rain catchers fill the base up to its capacity (both kinds count), as
  // un-purified water (water.js).
  const prod = waterProduction(state, base);
  const room = rawRoom(base); // the un-purified barrels and the tanks (the purified barrels stay for safe water)
  st[RAW] = Math.max(0, st[RAW] || 0) + Math.min(room, prod.total);
  drawWells(state, base); // claims.js: the wells hauled from today lose what was drawn; one at 0 is dry
  // Summer: some of the water kept outside the tanks and cisterns (above the capacity) evaporates (un-purified first).
  const over = waterLayout(base).outside;
  if (over > 0 && Weather.season && Weather.season(state).key === "summer") drawWater(st, Math.round(over * WATER.evaporate * 10) / 10, { rawFirst: true });

  baseScavenging(state, base, people);
  huntingDaily(state, base); // hunting.js: the Hunt and Fish jobs
  cookAtBase(state, base); // worm.js: a cook fire or kitchen cooks the game with the worm's eggs (else it is eaten last, raw)
  woodDaily(state, base); // woodcutting.js: the Cut wood job
  for (const s of people) if (s.role === "rest" || s.inBed) s.mood = Math.min(100, s.mood + (s.role === "rest" ? 6 : 3));
  assignStations(state, base);
  runStations(state, base);

  // Purifying (worm.js purifyDaily): the boiler (it burns its firewood now), the water filters and a shelter's fire
  // turn un-purified water into purified water before anyone drinks.
  purifyDaily(state, base);
  // Drinking: people first (purified water first, then un-purified: worm.js rolls the share drunk un-purified), then the
  // crops get what is left (un-purified first). Thirst counts both kinds.
  const need = waterNeed(state, base);
  const have = waterIn(st);
  let drank;
  if (mouths.length && have + 1e-9 < need.people) {
    const short = 1 - have / need.people;
    drank = drawWater(st, have);
    thirst(state, base, mouths, short);
  } else {
    drank = drawWater(st, need.people);
    base.thirstDays = 0;
  }
  base.drank = { day: day(state), pure: drank.pure, raw: drank.raw }; // worm.js baseWormDaily: the share drunk un-purified
  const give = drawWater(st, need.crops, { rawFirst: true }).got;
  farmingDaily(state, base, need.crops > 0 ? give / need.crops : 1);

  // Eating: fresh food first, then preserved (storage.js). An outpost that runs short is covered from the hub
  // afterwards (shipFromOutposts). Under a week of food left, everyone goes on short rations (60%): it stretches
  // the stock and costs mood, not health. The week counts everyone fed from these stores (prisoners, guests, a
  // holding convoy's crew and the dog eat in their own modules; upkeep.js), but only the people living here ration.
  const use = foodUse(state, base);
  const full = use.residents;
  const edible = edibleFood(base);
  const rationing = mouths.length > 0 && edible > 0 && edible < use.total * RATION_DAYS;
  if (rationing && !base.rationing) log(state, `${base.name} is on short rations: under ${RATION_DAYS} days of food left.`, "danger");
  base.rationing = rationing;
  if (rationing) for (const s of mouths) s.mood = Math.max(0, s.mood - 3);
  const eaten = full * (rationing ? RATION : 1);
  const missing = eatFromStore(base, eaten);
  if (missing > 0) st.food = (st.food || 0) - missing; // below zero: the hub starves, an outpost asks the hub
  if (mouths.length) noteMeals(state, base); // relations.js: weeks of nothing but preserved food are grim
  econStats(state).eaten += eaten - missing;
  if (st.food < 0 && base.type === "hub") {
    st.food = 0;
    starve(state, base, mouths);
  } else if (st.food >= 0) {
    base.hungerDays = 0;
    for (const s of mouths) s.mood = Math.min(100, s.mood + 1);
  }
  // Drying racks, then stored food spoils (storage.js: by the storage it sits in, fast outside).
  if (st.food >= 0) {
    const out = storageDaily(state, base);
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
  for (const k of Object.keys(st)) st[k] = Math.round(st[k] * 10) / 10;
  for (const k of Object.keys(st)) if (st[k] < 0 && !(k === "food" && base.type === "outpost")) st[k] = 0;
}

// A stranger at the gate: a recruit card (recruits.js) with the hub's beds, food and water. Taking them in costs
// 5 food on arrival (what the hub has then, never below zero).
function maybeStranger(state) {
  const h = hub(state);
  if (!state.rng.chance(0.06) || !h) return; // no base left (conquest.js exiles): nobody to come to
  const s = makeCandidate(state, { quality: 0.85 });
  offerRecruits(state, [s], { source: "stranger", baseId: h.id, title: "A stranger at the gate", intro: `${s.name} has been surviving alone and asks to join ${h.name}.` });
}

// ---------- outposts and supply lines ----------
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

function shipFromOutposts(state) {
  const h = hub(state);
  for (const base of state.bases) {
    if (base.type !== "outpost") continue;
    const staff = atBase(state, base.id);
    const line = supplyLine(state, base);
    base.supplyLine = { hours: line.hours, strength: line.strength, hostile: line.hostile, horde: line.horde };
    // No land route to the hub: nothing moves either way. The outpost keeps its stock and lives off it.
    const cutOff = !(line.strength > 0);
    if (cutOff) log(state, `${base.name} is cut off: there is no land route to ${h.name}. No food came in and nothing was shipped out.`, "danger");
    if (base.stock.food < 0) {
      if (!cutOff) {
        // The hub sends food, but the supply line loses some on the way.
        // Fresh food first, then preserved (storage.js).
        const need = -base.stock.food;
        const send = Math.max(0, Math.min(edibleFood(h), need / line.strength));
        const fresh = Math.min(Math.max(0, h.stock.food || 0), send);
        h.stock.food = Math.max(0, (h.stock.food || 0) - fresh);
        h.stock.preserved = Math.max(0, (h.stock.preserved || 0) - (send - fresh));
        base.stock.food += send * line.strength;
      }
      if (base.stock.food < -1e-9) {
        base.stock.food = 0;
        starve(state, base, staff);
      } else {
        base.stock.food = Math.max(0, base.stock.food);
        base.hungerDays = 0;
      }
    } else base.hungerDays = 0;
    if (!cutOff) {
      // Ship surplus to the hub, keeping a reserve: enough scrap to save up for a building (and parts once a job is queued).
      // Water and seed: an outpost keeps a week of water (its own well is small) and food to sow its plots.
      // Food and water by everyone fed here (per head × heads, upkeep.js: prisoners and guests too); ammo by the staff.
      const fed = mouthsAt(state, base).heads;
      // Firewood: a few days of the water boiler's (worm.js boilerUse) stays here; the rest pools at the hub, which sends
      // heating and boiler wood back over the line as the outpost runs short (needs.js heatDaily, worm.js boilerDaily).
      const boil = boilerUse(state, base);
      // Food: past RATION_DAYS, so a staffed outpost is not on short rations while the hub's cellar is full (huge census:
      // outposts rationed on 61-95% of their days with 900-6,400 food at the hub); the hub tops it up to that line.
      const lineDays = RATION_DAYS + 1;
      if (staff.length) {
        const want = foodUse(state, base).total * lineDays - edibleFood(base);
        const spare = edibleFood(h) - foodUse(state, h).total * lineDays;
        if (want > 0 && spare > 0) {
          const send = Math.min(spare, want / line.strength);
          const fresh = Math.min(Math.max(0, h.stock.food || 0), send);
          h.stock.food = Math.max(0, (h.stock.food || 0) - fresh);
          h.stock.preserved = Math.max(0, (h.stock.preserved || 0) - (send - fresh));
          base.stock.food = (base.stock.food || 0) + send * line.strength;
        }
      }
      const keep = { food: Math.ceil(foodUse(state, base).total * lineDays) + 6, water: fed * 7 + 5, ammo: staff.length * 6, scrap: 30, parts: base.construction.length ? 3 : 0, fuel: 10, meds: 2, wood: boil.active ? Math.ceil(boil.wood * 3) : 0 };
      // Supply runs: keep what a run from here will send, and what a run to here will pick up.
      for (const [k, v] of Object.entries(supplyReserve(state, base))) keep[k] = (keep[k] || 0) + v;
      keep[RAW] = (keep[RAW] || 0) + Math.max(0, keep.water - Math.max(0, base.stock.water || 0)); // the water kept counts both kinds (water.js): purified first
      for (const k of Object.keys(base.stock)) {
        const surplus = base.stock[k] - (keep[k] || 0);
        if (surplus > supplyFew(k, 1)) {
          base.stock[k] -= surplus;
          h.stock[k] = (h.stock[k] || 0) + surplus * line.strength;
        }
      }
    }
    for (const k of Object.keys(base.stock)) base.stock[k] = Math.max(0, Math.round(base.stock[k] * 10) / 10);
  }
}

// ---------- trade routes ----------
export const ESCORTS = {
  light:    { name: "Light",    people: 1, desc: "Quiet: fewer zombie events, but raiders see an easy target" },
  standard: { name: "Standard", people: 3, desc: "Balanced" },
  heavy:    { name: "Heavy",    people: 5, desc: "Loud: deters small raids, draws zombies and big raids near aggressive groups" },
};

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

export function releaseEscorts(state, r) {
  for (const id of r.escortIds) {
    const s = survivorById(state, id);
    if (s && s.alive && s.location.kind === "route" && hub(state)) s.location = { kind: "base", baseId: hub(state).id };
  }
}

// ---------- death sites ----------
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
    const chance = Math.min(0.9, traffic * (1 + age / 8) + 0.02);
    if (!rng.chance(chance) || !site.items.length) continue;
    // Scavengers take the most valuable item first.
    site.items.sort((a, b) => b.value - a.value);
    const taken = site.items.shift();
    if (taken.kind === "gear") {
      const f = state.factions.filter((f) => f.alive).sort((a, b) =>
        Math.min(...a.bases.map((x) => state.grid.distance(x, site.tile))) - Math.min(...b.bases.map((x) => state.grid.distance(x, site.tile))))[0];
      if (f) f.lootedGear.push(taken.name);
    }
    if (state.live.has(site.tile)) log(state, `Someone looted ${taken.name} from the bodies at ${t.loc ? t.loc.name : "the death site"}.`, "danger");
    if (!site.items.length && !(site.walked && site.walked.length)) state.deathSites.splice(state.deathSites.indexOf(site), 1); // walked: the grave stays (carriers.js)
  }
}

export { alive };
