// Daily economy for every base (hub and outposts share the same rules): water, base scavenging, farming
// (farming.js), eating, food storage and spoiling (storage.js), illness (health.js), supply lines, trade routes and
// death-site looting.
import { TERRAIN, LOCATIONS, SUPPLIES } from "./data.js";
import {
  log, addCard, day, hub, atBase, alive, skill, hurt, survivorById, factionById, makeSurvivor, residents, checkGameOver,
} from "./world.js";
import { planPath, dispatchConvoy } from "./parties.js";
import { attitude } from "./factions.js";
import { count, baseBeds, runStations, assignStations, stations, stationStatus, RECIPES } from "./buildings.js";
import { supplyReserve } from "./supply.js";
import { medicalDaily, fieldInfectionDaily } from "./medical.js";
import { toolBonus } from "./crafting.js";
import { farmingDaily, farmFoodPerDay, cropWaterNeed, nextHarvests, farmOf, econStats } from "./farming.js";
import { healthDaily, workFactor, conditionsOf, CONDITIONS } from "./health.js";
import * as Weather from "./weather.js";
import { foodStore, storageDaily, eatFromStore, edibleFood, rackPlan } from "./storage.js";
import { baseMoraleDaily } from "./morale.js";
import { makeCandidate, offerRecruits, recruitsDaily } from "./recruits.js";
import { hubEventsDaily } from "./hubevents.js";
import { hasPerk, eatMult } from "./skills.js";
import { relationsDaily, noteMeals } from "./relations.js";

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
export const SCAV_FIND = { scrap: [2, 5], food: [1, 3], water: [2, 4], ammo: [3, 8], meds: [1, 1], fuel: [1, 2], parts: [1, 1], preserved: [1, 3], jars: [2, 6] };
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
// The hub has a well; an outpost a spring or a hand pump; a base by a river or lake draws from it too. Well
// buildings add more, rain catchers fill on wet days (weather.rainWater), cisterns hold more. Production only
// fills the base up to its capacity (water brought home on top of that is kept). Everyone living at a base drinks
// 1 a day (1.5 in a heat wave), the sick with dysentery 1 more; growing crops are watered on dry days
// (farming.cropWaterNeed). Water filters (crafting.js) add their water on top.
export const WATER = { hubWell: 12, spring: 3, stream: 3, well: 6, rainPerCatcher: 2, hubCap: 80, outpostCap: 40, cistern: 150, drink: 1, hotDrink: 1.5 };
export const waterCapacity = (base) => (base.type === "hub" ? WATER.hubCap : WATER.outpostCap) + count(base, "cistern") * WATER.cistern;
const byWater = (state, base) => state.grid.neighbors(base.tile).some((id) => state.tiles[id] && state.tiles[id].terrain === "water");

export function waterProduction(state, base) {
  const factor = Weather.wellFactor ? Weather.wellFactor(state) : 1;
  const own = (base.type === "hub" ? WATER.hubWell : WATER.spring) * factor;
  const stream = byWater(state, base) ? WATER.stream : 0;
  const wells = count(base, "well") * WATER.well * factor;
  const rain = count(base, "rain_catcher") * WATER.rainPerCatcher * (Weather.rainWater ? Weather.rainWater(state) : 0);
  const filters = base.armory.filter((it) => it && it.key === "waterfilter").length * 3;
  const total = own + stream + wells + rain;
  return { own, stream, wells, rain, filters, factor, total: Math.round(total * 10) / 10 };
}

const hotToday = (state) => {
  const w = Weather.weather ? Weather.weather(state) : null;
  return !!w && (w.key === "heat" || w.hi >= 30);
};
export function waterNeed(state, base) {
  const mouths = residents(state, base.id);
  const hot = hotToday(state);
  const sick = mouths.reduce((a, s) => a + conditionsOf(s).reduce((b, c) => b + (CONDITIONS[c.key].thirst || 0), 0), 0);
  const people = mouths.length * (hot ? WATER.hotDrink : WATER.drink) + sick;
  const crops = cropWaterNeed(state, base);
  return { people: Math.round(people * 10) / 10, crops, total: Math.round((people + crops) * 10) / 10, hot };
}

// Water per day and days left, for the top bar and the base panel.
export function waterOutlook(state, base) {
  const prod = waterProduction(state, base);
  const need = waterNeed(state, base);
  const stock = base.stock.water || 0;
  const cap = waterCapacity(base);
  const inflow = prod.total + prod.filters;
  const net = inflow - need.total;
  // On a dry day: no rain in the catchers, and the crops need watering (for planning: is the supply enough?).
  const dryNet = inflow - prod.rain - need.people - cropWaterNeed(state, base, { dry: true });
  return { stock, cap, prod, need, inflow: Math.round(inflow * 10) / 10, net: Math.round(net * 10) / 10, dryNet: Math.round(dryNet * 10) / 10, daysLeft: net >= 0 ? Infinity : stock / -net };
}

// Thirst: health lost per day by everyone at a base that ran dry (10, 14, 18 … up to 25), scaled by how short they
// were (at least 35%). Like hunger, armor does not help and nobody heals; it kills faster than hunger.
export const thirstDamage = (days) => Math.min(25, 6 + 4 * Math.max(1, days));
function thirst(state, base, mouths, short) {
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
export const eatPerDay = (state, base) => residents(state, base.id).length * (Weather.foodNeedFactor ? Weather.foodNeedFactor(state) : 1) * eatMult(state, base); // eatMult: Quartermaster (skills.js)

// Food outlook for the base panel: stock (fresh + preserved), expected farm food (next 30 days), eaten, spoiled and
// used per day (workshops; the preserving kitchen and drying racks turn fresh food into preserved, so only what
// they lose counts), days of food left without harvests, the next harvests and the storage.
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
  const eat = eatPerDay(state, base);
  const store = foodStore(state, base);
  const spoil = store.spoil;
  const stock = edibleFood(base);
  const burn = eat + spoil + used - scav;
  return { stock, fresh: store.fresh, preserved: store.preserved, store, farm, scav, used, eat, spoil, net: farm + scav - eat - spoil - used, daysLeft: burn > 0 ? stock / burn : Infinity, harvests: nextHarvests(state, base) };
}

export function foodForecast(state, base) {
  return farmOutput(state, base) - residents(state, base.id).length;
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
  healthDaily(state);
  fieldInfectionDaily(state);
  shipFromOutposts(state);
  maybeStranger(state);
  recruitsDaily(state); // recruits.js: people walking to a base arrive, deserters may come back
  hubEventsDaily(state); // hubevents.js: a decision for the days at home, and the lasting effects of past ones
  relationsDaily(state); // relations.js: opinions, grief, the new mood factors and breaks
}

function baseDaily(state, base) {
  const rng = state.rng;
  const people = atBase(state, base.id);
  // Everyone who eats and sleeps here: the staff plus (hub) trade-route escorts waiting between trips.
  const mouths = residents(state, base.id);
  const st = base.stock;
  for (const s of people) if (s.role === "work") s.role = "scavenge";
  farmOf(state, base); // plots follow the buildings

  // Water in: the well, streams, wells and rain catchers fill the base up to its capacity.
  const prod = waterProduction(state, base);
  const room = Math.max(0, waterCapacity(base) - (st.water || 0));
  st.water = (st.water || 0) + Math.min(room, prod.total);

  baseScavenging(state, base, people);
  for (const s of people) if (s.role === "rest" || s.inBed) s.mood = Math.min(100, s.mood + (s.role === "rest" ? 6 : 3));
  assignStations(state, base);
  runStations(state, base);

  // Drinking: people first, then the crops get what is left.
  const need = waterNeed(state, base);
  if (mouths.length && (st.water || 0) + 1e-9 < need.people) {
    const short = 1 - (st.water || 0) / need.people;
    st.water = 0;
    thirst(state, base, mouths, short);
  } else {
    st.water = (st.water || 0) - need.people;
    base.thirstDays = 0;
  }
  const give = Math.min(Math.max(0, st.water || 0), need.crops);
  st.water = (st.water || 0) - give;
  farmingDaily(state, base, need.crops > 0 ? give / need.crops : 1);

  // Eating: fresh food first, then preserved (storage.js). An outpost that runs short is covered from the hub
  // afterwards (shipFromOutposts). Under a week of food left, everyone goes on short rations (60%): it stretches
  // the stock and costs mood, not health.
  const full = eatPerDay(state, base);
  const edible = edibleFood(base);
  const rationing = mouths.length > 0 && edible > 0 && edible < full * RATION_DAYS;
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
  if (!state.rng.chance(0.06)) return;
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
      const keep = { food: staff.length * 3 + 6, water: staff.length * 7 + 5, ammo: staff.length * 6, scrap: 30, parts: base.construction.length ? 3 : 0, fuel: 10, meds: 2 };
      // Supply runs: keep what a run from here will send, and what a run to here will pick up.
      for (const [k, v] of Object.entries(supplyReserve(state, base))) keep[k] = (keep[k] || 0) + v;
      for (const k of Object.keys(base.stock)) {
        const surplus = base.stock[k] - (keep[k] || 0);
        if (surplus > 1) {
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
    if (s && s.alive && s.location.kind === "route") s.location = { kind: "base", baseId: hub(state).id };
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
    if (!site.items.length) state.deathSites.splice(state.deathSites.indexOf(site), 1);
  }
}

export { alive };
