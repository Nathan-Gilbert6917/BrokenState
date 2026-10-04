// Everything that travels across the State Map: your expeditions and convoys, AI raids and convoys.
// Travel drains supplies hour by hour and rolls events tile by tile. When a team finishes a job
// it waits for orders: act here, move anywhere, or go home.
import { findPath } from "./hex.js";
import { TERRAIN, ROAD_COST, GEAR, SUPPLIES } from "./data.js";
import {
  newId, log, addCard, day, hub, baseById, survivorById, atBase, skill, combatPower, hurt,
  factionById, snapshot, mergeKnowledge, gearEffect, radioBasesInRange,
} from "./world.js";
import {
  resolveRaidOnPlayer, resolveRaidOnFaction, raidWarning, maybeCallForHelp, deliverHelpCall, changeGoodwill,
  attitude, recomputeOwnership,
} from "./factions.js";
import { rollTravelEvent, convoyLegEvent } from "./events.js";
import { startScavenge } from "./scavenge.js";
import {
  vehicleById, partyVehicle, partyFuel, useFuel, wear, abandonVehicle, tank, vehicleCapacity, createVehicle,
} from "./vehicles.js";
import { perceive, spot, mergeSpots, MARKER_TYPES, markAbandonedVehicle, markDeathSite, deathLabel } from "./markers.js";
import { rescueArrive, captivesOf } from "./conflicts.js";
import { hiveAt, hiveArrive, zombieToughness, BOSS_NAMES } from "./hives.js";
import { hordeScore } from "./hordes.js";
import { supplyArrive, supplyReturned } from "./supply.js";
import { taskHour, startTask, startOrder, continueQueue, resumeQueue, orderLabel, queueText } from "./orders.js";
import { applyPlan, fieldHour } from "./plans.js";
import { crossingsFrom } from "./crossing.js";
import { carryBonus, itemLoad } from "./inventory.js";
import { openTrade, routeExchange } from "./trade.js";
import { caravanArrive, caravanHour, caravanStop } from "./caravans.js";
import { caravanGuarded } from "./jobs.js";
import { crashesHour, crashSurvey } from "./crashes.js";
import { breakdownsHour } from "./breakdowns.js";
import { travelFactor, travelEffects, travelHazard } from "./weather.js";
import { hasPerk, checkBonus, gainXpAll, USE, hash01 } from "./skills.js";
import { tripDone } from "./relations.js";
import { prisonersHome } from "./prisoners.js";
import { scavArrived, scavSearchHour, ambushHaul, lose as loseScav } from "./aiscav.js";

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
  outpost:     { name: "Build outpost",    desc: "Found a satellite base here. Needs 15 scrap carried. The team stays as its first staff." },
  recover:     { name: "Recover bodies",   desc: "Collect what is left at a death site before scavengers strip it." },
  cull:        { name: "Cull horde",       desc: "Thin out or lure away a horde on or next to this tile." },
  hive:        { name: "Destroy hive",     desc: "Storm an infestation hive: a hard tactical battle against its brood and the Broodmother inside. Win and the hive is destroyed. Bring five or six well-armed fighters." },
  investigate: { name: "Investigate find", desc: "Check a cache, wrecked car or abandoned camp your teams spotted." },
  getvehicle:  { name: "Recover vehicle",  desc: "Bring fuel (and a part if it is badly damaged) to get an abandoned vehicle running." },
  rescue:      { name: "Rescue captives",  desc: "Go to the group base where your people are held: sneak them out, storm the base, negotiate or pay a ransom." },
  survey:      { name: "Look around",      desc: "Spend 2 hours surveying nearby tiles. Better odds of spotting hidden finds.", hidden: true },
  help:        { name: "Relief squad",     desc: "Help a group under attack.", hidden: true },
  route:       { name: "Convoy",           desc: "Trade-route convoy.", hidden: true },
  caravan:     { name: "Trade caravan",    desc: "Caravan stop: trade here, unload, stay a day, go on to the next destination or return home (caravans.js).", hidden: true },
};

export function moveCost(state, from, to, vehicle) {
  const t = state.tiles[to];
  const mode = vehicle ? "vehicle" : "walk";
  if (t.terrain === "water" && !t.bridge) return Infinity;
  const onRoad = state.tiles[from].roadLinks.includes(to);
  if (onRoad) return ROAD_COST[mode];
  return TERRAIN[t.terrain][mode];
}

export function planPath(state, from, to, vehicle) {
  return findPath(state.grid, from, to, (a, b) => moveCost(state, a, b, vehicle));
}

export function fuelForPath(state, path) {
  let fuel = 0;
  for (let i = 1; i < path.length; i++) fuel += state.tiles[path[i - 1]].roadLinks.includes(path[i]) ? 0.6 : 1.5;
  return fuel;
}

export function carryCapacity(state, members, vehicle) {
  const vCap = typeof vehicle === "object" && vehicle ? vehicleCapacity(vehicle) : vehicle ? 120 : 0;
  // A worn pack (improvised backpack, assault pack) adds to what a person can take (inventory.js carryBonus).
  return members.reduce((s, m) => s + (m.traits.includes("badback") ? 8 : 15) + carryBonus(m) + (hasPerk(m, "packrat") ? 8 : 0), 0) + vCap; // Packrat (skills.js)
}
export const partyCapacity = (state, p) => carryCapacity(state, partyMembers(state, p), partyVehicle(state, p));

export const supplyLoad = (supplies) => Object.entries(supplies).reduce((s, [k, v]) => s + v * SUPPLIES[k].weight, 0);
// Each item takes 3; a pack in the cargo also counts what is inside it (inventory.js itemLoad).
export const cargoLoad = (cargo) => supplyLoad(cargo.supplies) + cargo.gear.reduce((s, g) => s + itemLoad(g), 0);
// How many units of a supply fit in the remaining space.
export const unitsThatFit = (room, key) => Math.max(0, Math.floor(room / SUPPLIES[key].weight));
// What a team carries of one supply: packed plus found (never negative).
export const carried = (p, key) => Math.max(0, p.supplies[key] || 0) + Math.max(0, (p.cargo && p.cargo.supplies[key]) || 0);
// Uses up carried supplies, found cargo first, then packed. Takes what is there and never goes below zero
// (callers check `carried` first when the full amount is required). Returns the amount taken.
export function takeSupply(p, key, qty) {
  const want = Math.max(0, Number(qty) || 0);
  const fromCargo = Math.min(want, Math.max(0, (p.cargo && p.cargo.supplies[key]) || 0));
  if (fromCargo) p.cargo.supplies[key] -= fromCargo;
  const packed = Math.max(0, p.supplies[key] || 0);
  const fromPacked = Math.min(want - fromCargo, packed);
  p.supplies[key] = packed - fromPacked;
  return fromCargo + fromPacked;
}

export function partyMembers(state, p) {
  return (p.members || []).map((id) => survivorById(state, id)).filter((s) => s && s.alive);
}

export function bestSkill(state, p, key) {
  return Math.max(0, ...partyMembers(state, p).map((s) => skill(s, key) + checkBonus(s, key))); // checkBonus: Shadow (skills.js)
}

export function sightRadius(state, p) {
  const m = partyMembers(state, p);
  let r = 1;
  if (bestSkill(state, p, "scouting") >= 10) r += 1;
  if (m.some((s) => s.traits.includes("keeneye"))) r += 1;
  if (m.some((s) => hasPerk(s, "lookout"))) r += 1; // Lookout (skills.js)
  return Math.max(1, r + travelEffects(state).sight); // fog and blizzards cut sight by a tile (weather.js)
}

function hasMilRadio(state, p) {
  return partyMembers(state, p).some((s) => s.gear.tool && s.gear.tool.key === "milradio" && gearEffect(s, s.gear.tool).usable);
}

// A team is called after the mission it left with (later orders do not rename it).
export const teamName = (state, p) => `${MISSIONS[p.teamMission || p.mission]?.name || "Team"} team (${partyMembers(state, p).map((s) => s.name.split(" ")[0]).join(", ")})`;

export function tileLabel(state, id) {
  const t = state.tiles[id];
  return t.loc ? t.loc.name : `${TERRAIN[t.terrain].name.toLowerCase()} (${t.x},${t.y})`;
}

// A name for a new outpost: the site it stands on, else the nearest town, city or stand-alone site with the
// direction from it ("North of Dunmore Outpost"). No two bases share a name; the player can rename it on the
// base screen. Uses no random numbers.
export function outpostName(state, tile) {
  const t = state.tiles[tile], g = state.grid;
  let place = t.loc ? t.loc.name : null;
  if (!place) {
    let best = null;
    for (const x of state.tiles) {
      if (!x.loc || (x.loc.settlement != null && x.loc.settlement !== x.id)) continue; // a town's own shops go by the town
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
  let name = `${place} Outpost`;
  for (let n = 2; state.bases.some((b) => b.name === name); n++) name = `${place} Outpost ${n}`;
  return name;
}

// ---------- trip estimates for the planner ----------
// Travel speed per hour for a player team (trade-route convoys keep a steady pace).
// p.perkSpeed: Pathfinder's +10% on foot (set each hour by skills.js skillsHour).
export const partySpeed = (p) => (p.kind === "convoy" && p.routeKind !== "supply" ? 1 : (STANCES[p.stance]?.speed || 1) * (p.perkSpeed || 1) * (p.prisonSpeed || 1)); // prisonSpeed: prisoners walking with the team (prisoners.js)

// Whole hours to walk/drive a path, using the same hour-by-hour stepping as the real movement
// (stepAlong): a tile is entered only once enough progress has built up, leftover progress carries
// over, a delay (negative progress) is paid first, and a vehicle that runs dry is left behind and the
// team walks the rest (at walking cost). Random events and fights can still add delays on the road.
// maxHours: stop early (idx then says how far the team got).
// Weather (weather.js) changes the cost of a step by the hour it is taken in, and every day's weather is already
// fixed in state.weather, so the estimate steps through the same hours as the trip will: startHour is the hour the
// trip starts from (now, unless it is a later leg or a queued move). weather: false gives the fair-weather time.
export function travelHours(state, path, { vehicle = false, speed = 1, progress = 0, idx = 0, fuel = Infinity, maxHours = 24 * 90, startHour = state.hour, weather = true } = {}) {
  const sim = { path: [...path], idx, progress, vehicle: !!vehicle };
  let f = fuel, hours = 0, dryAt = null;
  while (sim.idx < sim.path.length - 1 && hours < maxHours) {
    hours += 1;
    for (const tileId of stepAlong(state, sim, speed, weather ? startHour + hours : null)) {
      if (!sim.vehicle) continue;
      const prev = sim.path[sim.path.lastIndexOf(tileId, sim.idx) - 1];
      const use = state.tiles[prev].roadLinks.includes(tileId) ? 0.6 : 1.5;
      if (f < use - 1e-9) { f = 0; sim.vehicle = false; dryAt = tileId; } // same rule as useFuel
      else f -= use;
    }
  }
  return { hours, idx: sim.idx, fuelLeft: f, vehicle: sim.vehicle, dryAt, reached: sim.path[sim.path.length - 1] === path[path.length - 1], progress: sim.progress };
}

// The plan the hub knows about: a new move given while in contact replaces it (no way back assumed).
function setPlan(state, p, etaBack) {
  p.planPath = [...p.path];
  p.planStart = state.hour;
  p.planVehicle = !!p.vehicle;
  p.planFuel = p.vehicle ? partyFuel(state, p) : 0;
  p.etaOut = hoursLeft(state, p);
  p.etaBack = etaBack;
}

// Where an out-of-contact team should be by now if the plan held: same stepping as real movement along the
// planned path, then 6 hours on site, then the same path back (if a way back was planned). Delays from
// events are unknown at the hub, so this can run ahead of the real team.
export function plannedTile(state, p) {
  const plan = p.planPath || p.path;
  const start = p.planStart ?? p.departed;
  const t = state.hour - start;
  const opts = { vehicle: !!p.planVehicle, speed: partySpeed(p), fuel: p.planFuel ?? Infinity, startHour: start };
  if (t < p.etaOut) return plan[travelHours(state, plan, { ...opts, maxHours: t }).idx];
  const stay = p.planStay ?? 6; // hours at the target before heading back (a plan sets its own, plans.js)
  const tb = t - p.etaOut - stay;
  if (p.etaBack == null || tb <= 0) return plan[plan.length - 1];
  const go = travelHours(state, plan, opts);
  return plan[plan.length - 1 - travelHours(state, [...plan].reverse(), { ...opts, vehicle: go.vehicle, fuel: go.fuelLeft, maxHours: tb, startHour: start + p.etaOut + stay }).idx];
}

// Hours left for a team on its current path (what the order queue and the panels show).
export function hoursLeft(state, p) {
  if (!p.path || p.idx >= p.path.length - 1) return 0;
  return travelHours(state, p.path.slice(p.idx), { vehicle: p.vehicle, speed: partySpeed(p), progress: p.progress, fuel: p.vehicle ? partyFuel(state, p) : 0 }).hours;
}

// fuel: what the vehicle can burn (tank + cans); leave it out to assume enough.
export function estimateTrip(state, { memberIds, dest, vehicle, stance, homeBaseId, fuel }) {
  const home = baseById(state, homeBaseId || hub(state).id);
  const out = planPath(state, home.tile, dest, vehicle);
  if (!out) return null;
  const sp = STANCES[stance].speed;
  const go = travelHours(state, out.path, { vehicle, speed: sp, fuel: vehicle ? fuel ?? Infinity : 0 });
  // The way back is planned from the destination, like startReturn does (on foot if the tank ran dry).
  const backPlan = planPath(state, dest, home.tile, go.vehicle) || planPath(state, dest, home.tile, false);
  const backOpts = { vehicle: go.vehicle && !!planPath(state, dest, home.tile, true), speed: sp, fuel: go.fuelLeft, startHour: state.hour + go.hours + 6 };
  const back = backPlan ? travelHours(state, backPlan.path, backOpts) : { hours: go.hours };
  const hoursOut = go.hours;
  const hoursBack = back.hours;
  const hours = hoursOut + hoursBack + 6; // out, back, plus time on site
  const n = memberIds.length;
  // Hours the weather adds (or, rarely, saves) against the same trip in fair weather: shown by the planner.
  const fairOut = travelHours(state, out.path, { vehicle, speed: sp, fuel: vehicle ? fuel ?? Infinity : 0, weather: false }).hours;
  const fairBack = backPlan ? travelHours(state, backPlan.path, { ...backOpts, weather: false }).hours : fairOut;
  return {
    path: out.path,
    hoursOut, hoursBack, hours,
    weatherOut: hoursOut - fairOut, weatherBack: hoursBack - fairBack,
    arriveHour: state.hour + hoursOut,
    dryAt: go.dryAt,
    days: hours / 24,
    food: Math.ceil((n * hours) / 24),
    water: Math.ceil((n * hours) / 24),
    fuel: vehicle ? Math.ceil(fuelForPath(state, out.path) * 2) : 0,
    tiles: out.path.length - 1,
  };
}

// ---------- launching player expeditions ----------
// Missions after which the team waits at the destination (or stays for good): no way back is planned.
export const STAY_MISSIONS = ["move", "recon", "outpost"];

// Why a mission cannot be sent to a tile, from what is fixed or known about it (null = fine). The planner offers
// every mission for any tile, so the sim checks too; what can change on the way is checked again on arrival.
export function missionProblem(state, tile, mission) {
  const t = state.tiles[tile];
  if (!t) return "There is no such tile.";
  if (!MISSIONS[mission]) return "Unknown mission.";
  const theirs = state.factions.find((f) => f.alive && f.known && f.bases.includes(tile));
  if (mission === "outpost") {
    if (t.terrain === "water") return "An outpost cannot be built on water or on a bridge.";
    if (state.bases.some((b) => b.tile === tile)) return "You already have a base there.";
    if (theirs) return `${theirs.name} holds that place.`;
  }
  if (mission === "scavenge" && t.terrain === "water") return "There is nothing to search on the water.";
  return null;
}

export function launchExpedition(state, opts) {
  const { dest, mission, stance } = opts;
  const memberIds = [...new Set(opts.memberIds || [])];
  const vehicleId = opts.vehicleId || null;
  const home = hub(state);
  // Every supply key is present and a plain number (no missing keys, NaN or negative amounts later on).
  const supplies = {};
  for (const k of Object.keys(SUPPLIES)) supplies[k] = 0;
  for (const [k, q] of Object.entries(opts.supplies || {})) if (SUPPLIES[k] && Number.isFinite(q) && q > 0) supplies[k] = q;
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
  const v = vehicleId ? vehicleById(state, vehicleId) : null;
  if (vehicleId && (!v || v.loc.kind !== "base" || v.loc.baseId !== home.id)) return { error: "That vehicle is not at the hub." };
  if (v && v.condition <= 0) return { error: "That vehicle needs repairs first." };
  const est = estimateTrip(state, { memberIds, dest, vehicle: !!v, stance, fuel: v ? v.fuel + (supplies.fuel || 0) : 0 });
  if (!est) return { error: v ? "No route for a vehicle (mountains or water). Try on foot." : "No route to that tile." };
  for (const [k, val] of Object.entries(supplies)) if ((home.stock[k] || 0) < val) return { error: `Not enough ${SUPPLIES[k].name.toLowerCase()} at the hub.` };
  // Packed supplies have to be carried: the same limit as found cargo (people, worn packs, the vehicle).
  const cap = carryCapacity(state, members, v);
  const load = supplyLoad(supplies);
  if (load > cap + 1e-9) {
    return { error: `Too much to carry: the packed supplies weigh ${Math.ceil(load)}, the crew${v ? ` and the ${v.name}` : ""} can carry ${cap}. Pack less${v ? "" : ", or take more people or a vehicle"}.` };
  }
  for (const [k, val] of Object.entries(supplies)) home.stock[k] -= val;
  const stays = STAY_MISSIONS.includes(mission);
  const p = {
    id: newId(), owner: "player", kind: "expedition", mission, teamMission: mission, dest, homeBaseId: home.id,
    members: [...memberIds], stance, vehicle: !!v, vehicleId: v ? v.id : null, supplies,
    cargo: { supplies: {}, gear: [] },
    path: est.path, idx: 0, progress: 0, phase: "out",
    seen: new Map(), spotted: new Map(), sightNow: [], radioLive: false,
    departed: state.hour, plannedHours: est.hours, eventsSeen: 0,
    orders: [], orderStart: state.hour, // queued orders (orders.js) and when the current one began
    // What the hub knows of the plan, for the estimated "?" position while out of contact (plannedTile).
    // etaBack null: a one-way trip (the team arrives and waits there, or stays for good).
    planPath: [...est.path], planStart: state.hour, planVehicle: !!v, planFuel: v ? v.fuel + (supplies.fuel || 0) : 0, etaOut: est.hoursOut, etaBack: stays ? null : est.hoursBack,
  };
  if (v) v.loc = { kind: "party", partyId: p.id };
  for (const m of members) m.location = { kind: "party", partyId: p.id };
  state.parties.push(p);
  // A plan from the planner (plans.js): the steps after the target become the order queue.
  if (opts.plan) applyPlan(state, p, opts.plan);
  const days = Math.ceil((opts.plan ? p.plannedHours : est.hours) / 24);
  const planHome = opts.plan && p.orders.some((o) => o.type === "home");
  const waits = opts.plan ? !planHome : stays;
  const after = mission === "outpost" ? ` The team stays there as its first staff${v ? `, and the ${v.name} stays at the outpost` : ""}.` :
    opts.plan ? ` Plan: ${p.plan.name}${p.orders.length ? ` (${queueText(state, p)})` : ""}.${waits ? " Then it waits for orders." : ""}` : stays ? " The team waits there for orders." : "";
  log(state, `${teamName(state, p)} left for ${tileLabel(state, dest)}${v ? ` in the ${v.name}` : " on foot"}. Arrives in about ${est.hoursOut}h${waits ? "" : `; back in about ${days} day${days === 1 ? "" : "s"}`}.${after}`, "info");
  return { party: p };
}

export function sendHelpSquad(state, raidParty, target) {
  const h = hub(state);
  const fighters = atBase(state, h.id).sort((a, b) => combatPower(b) - combatPower(a)).slice(0, 3);
  if (!fighters.length) return "Nobody at the hub can go.";
  // Two days of food and water each (a short, rushed trip), within what the squad can carry.
  const n = fighters.length;
  const have = (k) => Math.max(0, Math.floor(h.stock[k] || 0));
  const supplies = { food: Math.min(have("food"), 2 * n), water: Math.min(have("water"), 2 * n), meds: Math.min(have("meds"), Math.min(2, n)), ammo: Math.min(have("ammo"), 10 * n) };
  const res = launchExpedition(state, { memberIds: fighters.map((s) => s.id), dest: raidParty.target.tile, mission: "help", stance: "rushed", supplies });
  if (res.error) return res.error;
  res.party.helpFor = raidParty.id;
  res.party.helpFaction = target.id;
  target.lastDiplomacy = day(state);
  return `${fighters.map((s) => s.name.split(" ")[0]).join(", ")} set out to help ${target.name}.`;
}

// ---------- AI parties ----------
export function spawnAiParty(state, f, kind, fromTile, toTile, opts) {
  const vehicle = kind === "convoy";
  let res = planPath(state, fromTile, toTile, vehicle);
  let usesVehicle = vehicle && !!res;
  if (!res) res = planPath(state, fromTile, toTile, false);
  if (!res) return null;
  const p = {
    id: newId(), owner: f.id, kind, path: res.path, idx: 0, progress: 0, vehicle: usesVehicle,
    strength: opts.strength, target: opts.target || null, targetFaction: opts.targetFaction || null,
    phase: "out", warned: false,
  };
  state.parties.push(p);
  return p;
}

// ---------- hourly movement ----------
export function movePartiesHour(state) {
  for (const p of [...state.parties]) {
    if (!state.parties.includes(p)) continue;
    if (p.owner === "player") playerPartyHour(state, p);
    else aiPartyHour(state, p);
  }
  crashesHour(state); // crashes.js: crash sites (new ones, the search, the race, burning out)
  breakdownsHour(state); // breakdowns.js: repair work at the bases, attack damage
  pruneCards(state);
}

// A player team with no living members is always wiped the same way (wipeParty): what it carried stays at a
// death site and the vehicle is left there, marked on the map. Called after any loss of a member, when a team
// reports in or arrives, and every hour for every team as a safety net. Returns true if the team is gone.
export function wipeIfEmpty(state, p) {
  if (!p || !state.parties.includes(p)) return true;
  if (p.owner !== "player" || partyMembers(state, p).length) return false;
  wipeParty(state, p);
  return true;
}

// Cards about a team that no longer exists, or about someone who has died or left that team, are out of date.
export function cardStale(state, card) {
  if (!card || card.partyId == null) return false;
  const p = state.parties.find((q) => q.id === card.partyId);
  if (!p) return true;
  if (p.owner === "player" && !partyMembers(state, p).length) return true;
  return (card.survivorIds || []).some((id) => {
    const s = survivorById(state, id);
    return !s || !s.alive || !p.members.includes(id);
  });
}

// Drops out-of-date cards. Runs every hour, when a team is removed, and after a card is answered (main.js,
// autopilot.js), so a stale card never reaches the front of the queue.
export function pruneCards(state) {
  for (let i = state.cards.length - 1; i >= 0; i--) if (cardStale(state, state.cards[i])) state.cards.splice(i, 1);
}

// hour: the hour this step is taken in (the weather of that hour sets the cost); null = fair weather.
function stepAlong(state, p, speed, hour = state.hour) {
  if (p.idx >= p.path.length - 1) return [];
  p.progress += speed;
  const entered = [];
  while (p.idx < p.path.length - 1) {
    const from = p.path[p.idx], to = p.path[p.idx + 1];
    const cost = moveCost(state, from, to, p.vehicle) * (hour == null ? 1 : travelFactor(state, { vehicle: p.vehicle, tileId: to, from, hour }));
    if (!isFinite(cost)) {
      p.path = p.path.slice(0, p.idx + 1);
      break;
    }
    if (p.progress < cost) break;
    p.progress -= cost;
    p.idx += 1;
    entered.push(p.path[p.idx]);
  }
  return entered;
}

export const partyTile = (p) => p.path[p.idx];

function updateRadio(state, p) {
  p.radioLive = radioBasesInRange(state, partyTile(p), hasMilRadio(state, p) ? 4 : 0).length > 0;
  p.sightNow = p.radioLive ? state.grid.within(partyTile(p), sightRadius(state, p)) : [];
  if (p.radioLive) mergeKnowledge(state, p.seen, p.spotted);
}

// A team that lost people (dead, captured, gone home) may hold more found cargo than those left can carry:
// the excess stays on the tile, at the death site there (or as a cargo cache), and the team knows where.
function shedOverload(state, p) {
  if (p.kind === "convoy" || cargoLoad(p.cargo) <= partyCapacity(state, p) + 1e-9) return;
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
      if (cur) { cur.qty += q; cur.value = cur.qty * SUPPLIES[k].value; }
      else site.items.push({ kind: "supply", key: k, name: SUPPLIES[k].name, qty: q, value: q * SUPPLIES[k].value });
    }
    for (const g of drop.gear) site.items.push({ kind: "gear", key: g.key, name: g.name, qty: 1, value: (GEAR[g.key]?.value || 0) * (g.quality || 1), item: g });
    spot(p, { key: `death:${tile}`, type: "death", tile, hour: state.hour, label: deathLabel(site), info: { items: site.items.length } });
  }
  log(state, `${teamName(state, p)} can no longer carry everything: ${drop.text} left ${base ? `at ${base.name}` : `behind near ${tileLabel(state, tile)}`}.`, "danger");
}

function playerPartyHour(state, p) {
  // Hourly sweep: however the last member was lost, the team ends as a wiped team (never silently deleted).
  if (wipeIfEmpty(state, p)) return;
  shedOverload(state, p);
  const members = partyMembers(state, p);
  // A supply convoy parked at one of your bases eats from that base (handled daily in supply.js).
  if (p.phase === "holding") {
    p.noFood = p.noWater = false;
    updateRadio(state, p);
    return;
  }
  consume(state, p, members);
  if (!state.parties.includes(p)) return;
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
  const entered = stepAlong(state, p, partySpeed(p));
  for (const tileId of entered) {
    onEnterTile(state, p, tileId);
    if (!state.parties.includes(p) || p.phase === "engaged") return;
  }
  // Storms and blizzards: a small chance each hour on the road that someone is hurt (weather.js).
  if (p.kind !== "convoy" && p.idx < p.path.length - 1 && travelHazard(state, p, partyMembers(state, p)) && wipeIfEmpty(state, p)) return;
  updateRadio(state, p);
  if (p.idx >= p.path.length - 1) {
    if (p.phase === "out") arrive(state, p);
    else if (p.phase === "back") returnHome(state, p);
  }
}

function consume(state, p, members) {
  const n = members.length;
  const s = p.supplies;
  s.food = (s.food || 0) - n / 24;
  s.water = (s.water || 0) - n / 24;
  // Found food and water in the cargo is used once packed supplies run out. Preserved food (storage.js: jarred,
  // dried, canned) is a ration like food: packed preserved food after the packed food, then found food and found
  // preserved food.
  if (s.food < 0 && (s.preserved || 0) > 0) {
    const take = Math.min(-s.food, s.preserved);
    s.preserved -= take;
    s.food += take;
  }
  for (const k of ["food", "water"]) {
    if (s[k] < 0 && (p.cargo.supplies[k] || 0) > 0) {
      const take = Math.min(-s[k], p.cargo.supplies[k]);
      p.cargo.supplies[k] -= take;
      s[k] += take;
    }
  }
  if (s.food < 0 && (p.cargo.supplies.preserved || 0) > 0) {
    const take = Math.min(-s.food, p.cargo.supplies.preserved);
    p.cargo.supplies.preserved -= take;
    s.food += take;
  }
  // Out of food or water this hour (orders.js: no camp healing while it lasts). Hunger and thirst are not
  // softened by armor or toughness (world.js hurt, raw).
  p.noFood = s.food < 0;
  p.noWater = s.water < 0;
  const name = teamName(state, p);
  if (p.noFood) {
    s.food = 0;
    for (const m of members) hurt(state, m, 0.6, partyTile(p), "of starvation on the road", { raw: true });
    if (state.hour % 24 === 0) log(state, `${name} is out of food.`, "danger");
  }
  if (p.noWater) {
    s.water = 0;
    for (const m of members) hurt(state, m, 1.0, partyTile(p), "of thirst on the road", { raw: true });
    if (state.hour % 24 === 0) log(state, `${name} is out of water.`, "danger");
  }
  if (!wipeIfEmpty(state, p) && partyMembers(state, p).length < members.length) shedOverload(state, p);
}

// True while the team has run out of food or water.
export const starving = (p) => !!(p.noFood || p.noWater);

function onEnterTile(state, p, tileId) {
  const members = partyMembers(state, p);
  if (p.vehicle) {
    const v = partyVehicle(state, p);
    // The tile before this one (a fast vehicle can enter several tiles in one hour, so not always idx - 1).
    const prev = p.path[p.path.lastIndexOf(tileId, p.idx) - 1];
    const onRoad = state.tiles[prev].roadLinks.includes(tileId);
    if (v) wear(v, onRoad);
    if (!useFuel(state, p, onRoad ? 0.6 : 1.5)) {
      const name = v ? v.name : "vehicle";
      log(state, `The ${name} ran out of fuel near ${tileLabel(state, tileId)}. The team left it there and continues on foot. Bring fuel to recover it.`, "danger");
      leaveVehicle(state, p, tileId, "out of fuel");
    }
  }
  // Sight and perception: what the team sees is held until they return (or reported live by radio).
  const around = state.grid.within(tileId, sightRadius(state, p));
  for (const id of around) p.seen.set(id, snapshot(state, id));
  if (p.spotted) perceive(state, p, members, around);
  if (p.kind === "convoy") {
    convoyLegEvent(state, p, tileId);
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

// Brings the found cargo down to what the team can carry (after losing its vehicle or a pack carrier): the
// cheapest goods per carry unit go first, then the cheapest items. What is dropped goes into `into` (a
// { supplies, gear } store, e.g. the vehicle left behind) if given. Returns the dropped goods: { supplies, gear, text }.
export function trimCargo(state, p, into = null) {
  const dropped = { supplies: {}, gear: [], text: "" };
  let over = cargoLoad(p.cargo) - partyCapacity(state, p);
  const keys = Object.keys(p.cargo.supplies).sort((a, b) => SUPPLIES[a].value / SUPPLIES[a].weight - SUPPLIES[b].value / SUPPLIES[b].weight);
  for (const k of keys) {
    if (over <= 1e-9) break;
    const drop = Math.min(Math.ceil(over / SUPPLIES[k].weight - 1e-9), Math.floor(p.cargo.supplies[k] || 0));
    if (drop <= 0) continue;
    p.cargo.supplies[k] -= drop;
    dropped.supplies[k] = drop;
    over -= drop * SUPPLIES[k].weight;
  }
  const byValue = [...p.cargo.gear].sort((a, b) => (GEAR[a.key]?.value || 0) * (a.quality || 1) - (GEAR[b.key]?.value || 0) * (b.quality || 1));
  for (const g of byValue) {
    if (over <= 1e-9) break;
    p.cargo.gear.splice(p.cargo.gear.indexOf(g), 1);
    dropped.gear.push(g);
    over -= itemLoad(g);
  }
  dropped.text = [...Object.entries(dropped.supplies).map(([k, q]) => `${q} ${SUPPLIES[k].name.toLowerCase()}`), ...dropped.gear.map((g) => g.name)].join(", ");
  if (into && dropped.text) {
    for (const [k, q] of Object.entries(dropped.supplies)) into.supplies[k] = (into.supplies[k] || 0) + q;
    into.gear.push(...dropped.gear);
  }
  return dropped;
}

// Cargo left inside an abandoned vehicle (leaveVehicle).
export const vehicleCargo = (v) => (v && v.cargo && (v.cargo.gear.length || Object.values(v.cargo.supplies).some((q) => q >= 1)) ? v.cargo : null);

// The team leaves its vehicle on a tile (out of fuel, broken down, no road home, a boat, a raid site). What the
// people cannot carry stays inside it, is noted on its map marker, and comes back with the vehicle when it is
// recovered (recoverVehicle). Returns what was left as text ("" if everything could be carried).
export function leaveVehicle(state, p, tile, reason) {
  const v = partyVehicle(state, p);
  if (!v) return "";
  abandonVehicle(state, p, tile, reason);
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

function addCargo(state, p, key, qty) {
  const room = Math.max(0, partyCapacity(state, p) - cargoLoad(p.cargo));
  const take = Math.max(0, Math.min(unitsThatFit(room, key), Math.floor(qty) || 0));
  p.cargo.supplies[key] = (p.cargo.supplies[key] || 0) + take;
  return take;
}

// Puts an item in the team's cargo if there is carry space for it (inventory.js itemLoad: a pack counts what is
// inside it). Returns false, and leaves the item where it is, when it does not fit: the caller says what stayed behind.
export function addGearToCargo(state, p, item) {
  if (!item) return false;
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  if (cargoLoad(p.cargo) + itemLoad(item) > partyCapacity(state, p) + 1e-9) return false;
  p.cargo.gear.push(item);
  return true;
}

// ---------- orders ----------
// What the team can do on the tile where it stands.
export function orderOptions(state, p) {
  const tile = partyTile(p);
  const t = state.tiles[tile];
  const out = [];
  const add = (m, why) => out.push({ mission: m, label: MISSIONS[m].name, desc: MISSIONS[m].desc, disabled: why || null });
  add("survey");
  if (t.loot > 0.05) add("scavenge");
  const fb = state.factions.find((f) => f.alive && f.bases.includes(tile));
  if (fb) add("trade");
  if (p.caravan) add("caravan"); // a trade caravan's stop card (caravans.js)
  if (fb && captivesOf(state, fb.id).length) add("rescue");
  const ownedByOther = state.factions.some((f) => f.bases.includes(tile)) || (typeof t.owner === "number");
  if (!state.bases.some((b) => b.tile === tile) && !ownedByOther && t.terrain !== "water") {
    const scrap = (p.supplies.scrap || 0) + (p.cargo.supplies.scrap || 0);
    add("outpost", scrap < 15 ? `Needs 15 scrap carried (have ${Math.floor(scrap)})` : null);
  }
  const site = state.deathSites.find((d) => d.tile === tile);
  if (site && site.items.length) add("recover");
  if (state.hordes.some((h) => state.grid.distance(h.tile, tile) <= 1)) add("cull");
  if (hiveAt(state, tile)) add("hive");
  if (t.hidden && !t.hidden.taken && (t.hidden.known || p.spotted?.has(`${t.hidden.type}:${tile}`))) add("investigate");
  const v = state.vehicles.find((x) => x.loc.kind === "abandoned" && x.loc.tile === tile);
  if (v && !p.vehicle) {
    // What is still in its tank counts: the team only has to bring what is missing.
    const fuel = v.fuel + carried(p, "fuel");
    add("getvehicle", fuel < RESTART_FUEL ? `Needs ${RESTART_FUEL} fuel to restart (tank ${Math.floor(v.fuel)}, carried ${Math.floor(carried(p, "fuel"))})` : null);
  } else if (v && vehicleCargo(v)) {
    out.push({ mission: "getvehicle", label: "Take the cargo left in the vehicle", desc: `Load what fits of the cargo left in the ${v.name} (the team already has a vehicle, so this one stays).`, disabled: null });
  }
  return out;
}
const RESTART_FUEL = 2; // fuel (tank plus carried) an abandoned vehicle needs to drive again

// doneLabel: the order that just finished (the card then doubles as its "done" notice).
// title: replaces the usual title (e.g. "Cannot go home").
// Choices marked order: true start timed work; the game resumes and skips the result screen.
export function ordersCard(state, p, text, doneLabel, title) {
  const tile = partyTile(p);
  const opts = orderOptions(state, p);
  const queued = (p.orders || []).length;
  return {
    title: title || (doneLabel ? `Done: ${doneLabel}` : `Orders: team at ${tileLabel(state, tile)}`),
    isOrders: true,
    text: `${text ? text + " " : ""}${partyMembers(state, p).map((s) => s.name.split(" ")[0]).join(", ")} ${partyMembers(state, p).length === 1 ? "waits" : "wait"} for your call at ${tileLabel(state, tile)}. Supplies: ${Math.floor(p.supplies.food || 0)} food, ${Math.floor(p.supplies.water || 0)} water${p.vehicle ? `, ${Math.floor(partyFuel(state, p))} fuel` : ""}.${queued ? ` Queued orders on hold: ${queueText(state, p)}.` : ""}`,
    partyId: p.id,
    choices: [
      ...(queued ? [{ label: `Resume queued orders (${queued})`, hint: `Carry on with: ${queueText(state, p)}`, order: true, resolve: (st) => resumeQueue(st, p) }] : []),
      ...opts.map((o) => ({
        label: o.label, hint: o.disabled || o.desc, disabled: !!o.disabled, order: o.mission === "survey",
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
      { label: "Set up camp (8h)", hint: "Stop and rest here for 8 hours: the hurt recover a little, nobody travels. Break camp early from the team panel.", order: true, resolve: (st) => startOrder(st, p, { type: "camp", hours: 8 }) },
      ...(crossingsFrom(state, tile).length ? [{ label: "Build a boat and cross…", hint: "This team stands on a shore with land straight across the water. The team panel shows each crossing with its cost (scrap, hours) and lets you gather materials.", uiAction: { type: "expedition", partyId: p.id }, resolve: () => "" }] : []),
      { label: "Move to another tile…", hint: "Pick any tile on the map. The team travels there and waits for orders again.", uiAction: { type: "move", partyId: p.id }, resolve: () => "Pick a destination on the map (Esc to cancel)." },
      { label: "Return home", hint: "Head back to the hub with everything carried.", order: true, resolve: (st) => (startReturn(st, p) ? "" : "The team heads home.") },
      { label: "Team panel…", hint: "People, gear, supplies and vehicle; camp, scavenge, repair, treat and queue orders.", uiAction: { type: "expedition", partyId: p.id }, resolve: () => "" },
      { label: "Hold here", hint: "Wait. Give orders later from the Teams tab. Supplies keep draining.", resolve: () => "The team holds position." },
    ],
  };
}

// The team stops and reports in. opts.failed: the order could not be done (the card is not titled "Done: …");
// opts.hold: queued orders stay on hold instead of carrying on; opts.title: a title for the card.
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
  addCard(state, ordersCard(state, p, text, doneLabel, opts.title));
}

// A team stopped on the way while orders are queued behind the trip: the unfinished trip (and the mission it
// was on) goes back to the front of the queue, so "Resume queued orders" carries on to the right tile
// instead of running the next order where the team happens to stand.
function requeueInterrupted(state, p) {
  if (!p.orders || !p.orders.length) return;
  if (p.phase === "task" && p.task && p.task.type === "cross" && !p.task.afloat) {
    const t = p.task;
    p.orders.unshift({ type: "cross", tile: t.tile, mode: t.mode, build: t.build, cross: t.cross, mats: t.mats });
    return;
  }
  // Only a trip toward p.dest (on the way home the path ends at the base, and the queue is empty anyway).
  if ((p.phase !== "out" && p.phase !== "engaged") || p.dest == null || p.path[p.path.length - 1] !== p.dest) return;
  const back = [{ type: "move", tile: p.dest }];
  const m = p.mission === "recon" ? "survey" : p.mission;
  if (m !== "move" && MISSIONS[m] && (!MISSIONS[m].hidden || m === "survey")) back.push({ type: "mission", mission: m, at: p.dest });
  p.orders.unshift(...back);
}

export function giveOrder(state, p, mission) {
  p.mission = mission;
  p.dest = partyTile(p);
  p.phase = "out";
  return arrive(state, p) || "";
}

export function orderMove(state, p, tile) {
  if (tile === partyTile(p)) return "The team is already there.";
  if (p.phase === "task" && p.task?.afloat) return "The team is out on the water. Give the order once it lands.";
  const res = planPath(state, partyTile(p), tile, p.vehicle);
  if (!res) return p.vehicle ? "The vehicle cannot get there. Leave it or pick another tile." : "No route there over land. Water in the way? Build a boat from the shore (team panel).";
  p.mission = "move";
  p.dest = tile;
  p.path = res.path;
  p.idx = 0;
  p.progress = Math.min(0, p.progress);
  p.phase = "out";
  p.task = null; // breaks camp or stops other work on the spot
  p.orderStart = state.hour;
  setPlan(state, p, null);
  return `${teamName(state, p)} sets off for ${tileLabel(state, tile)}.`;
}

// debit: take the two hours from the next move (recon); a timed Look around order already spent them.
export function survey(state, p, bonus, debit = true) {
  const tile = partyTile(p);
  const members = partyMembers(state, p);
  const around = state.grid.within(tile, sightRadius(state, p) + 1);
  for (const id of around) p.seen.set(id, snapshot(state, id));
  const found = perceive(state, p, members, around, bonus);
  gainXpAll(state, members, "scouting", USE.survey); // skills.js
  if (debit) p.progress -= 2 * partySpeed(p); // two hours spent looking around before moving on (at any pace)
  updateRadio(state, p);
  const crash = crashSurvey(state, p); // crashes.js: a downed aircraft found, or its search circle narrowed
  return `${found.length ? `Spotted: ${found.map((f) => `${MARKER_TYPES[f.type].name} at ${tileLabel(state, f.tile)}`).join("; ")}.` : "Nothing new spotted nearby."}${crash ? ` ${crash}` : ""}`;
}

// ---------- arriving and acting ----------
function arrive(state, p) {
  if (wipeIfEmpty(state, p)) return "";
  const t = state.tiles[p.dest];
  const members = partyMembers(state, p);
  switch (p.mission) {
    case "move":
      awaitOrders(state, p, `The team reached ${tileLabel(state, p.dest)}.`);
      return "";
    case "recon":
      awaitOrders(state, p, `The team surveyed around ${tileLabel(state, p.dest)}. ${survey(state, p, 0.25)}`);
      return "";
    case "survey":
      startTask(state, p, { type: "survey", hours: 2 });
      return "The team spends two hours looking around.";
    case "scavenge":
      if (t.terrain === "water") {
        awaitOrders(state, p, "There is nothing to search on the water.", { failed: true });
        return "";
      }
      p.phase = "engaged";
      // Headless searches share one slot (state.engagement): a second team waits its turn instead of replacing it.
      if (startScavenge(state, p) === false) {
        awaitOrders(state, p, "Another team is in the middle of a search. This team waits here; give the order again when that search is over.", { failed: true, hold: true });
        return "";
      }
      return "The team starts searching.";
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
        openTrade(state, p, f);
      }
      return "";
    }
    case "outpost": {
      const mine = state.bases.some((b) => b.tile === p.dest);
      const blocked = mine || state.factions.some((f) => f.bases.includes(p.dest)) || (t.owner != null && t.owner !== "player");
      const scrap = carried(p, "scrap");
      if (t.terrain === "water" || blocked || scrap < 15) {
        awaitOrders(state, p, t.terrain === "water" ? "An outpost cannot be built on water or on a bridge." : mine ? "You already have a base here." :
          blocked ? `Someone else holds ${tileLabel(state, p.dest)}.` : `The team does not have the 15 scrap needed to build (it carries ${Math.floor(scrap)}).`, { failed: true });
        return "";
      }
      const base = {
        id: newId(), tile: p.dest, type: "outpost", name: outpostName(state, p.dest),
        stock: { food: 0, water: 0, fuel: 0, meds: 0, ammo: 0, parts: 0, scrap: 0, preserved: 0, jars: 0 },
        radio: false, watchtower: false, buildings: [], construction: [], armory: [],
      };
      takeSupply(p, "scrap", 15);
      addStock(base, p.supplies);
      addStock(base, p.cargo.supplies);
      base.armory.push(...p.cargo.gear);
      const v = partyVehicle(state, p);
      if (v) v.loc = { kind: "base", baseId: base.id };
      state.bases.push(base);
      for (const m of members) {
        m.location = { kind: "base", baseId: base.id };
        m.role = "scavenge";
      }
      mergeKnowledge(state, p.seen, p.spotted);
      removeParty(state, p);
      recomputeOwnership(state);
      log(state, `${base.name} founded with ${members.length} staff.`, "good");
      return `${base.name} founded.`;
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
          if (!addGearToCargo(state, p, item)) { left.push(it.name); continue; }
        } else {
          const take = addCargo(state, p, it.key, it.qty);
          if (take > 0) got.push(`${take} ${it.name.toLowerCase()}`);
          it.qty -= take;
          it.value = it.qty * SUPPLIES[it.key].value;
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
    case "cull": {
      const horde = state.hordes.find((h) => h.tile === p.dest) || state.hordes.find((h) => state.grid.distance(h.tile, p.dest) <= 1);
      if (!horde) {
        awaitOrders(state, p, "The horde had moved on.", { failed: true });
        return "";
      }
      p.phase = "engaged";
      addCard(state, cullCard(state, p, horde));
      return "";
    }
    case "investigate":
      return investigate(state, p);
    case "getvehicle":
      return recoverVehicle(state, p);
    case "rescue":
      p.phase = "engaged";
      return rescueArrive(state, p);
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

function investigate(state, p) {
  const tile = partyTile(p);
  const t = state.tiles[tile];
  const h = t.hidden;
  if (!h || h.taken) {
    awaitOrders(state, p, "Someone has already cleaned it out.", { failed: true });
    return "";
  }
  const rng = state.rng;
  const key = `${h.type}:${tile}`;
  if (h.type === "cache" || h.type === "camp") {
    const got = [];
    const loot = h.type === "cache" ? { food: rng.int(6, 14), meds: rng.int(1, 3), ammo: rng.int(15, 40) } : { food: rng.int(3, 8), scrap: rng.int(4, 10), ammo: rng.int(10, 25) };
    for (const [k, q] of Object.entries(loot)) {
      const took = addCargo(state, p, k, q);
      if (took) got.push(`${took} ${k}`);
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
  const cannot = () => p.vehicle || carried(p, "parts") < 2 || carried(p, "fuel") < 6;
  addCard(state, {
    title: "Wrecked car",
    text: `An old sedan sits in the ditch, tires flat, but the engine block looks intact. Your best Mechanics: ${mech}.`,
    partyId: p.id,
    choices: [
      {
        label: "Restore it (2 parts, 6 fuel)",
        hint: p.vehicle ? "The team already has a vehicle to drive" : `Mechanics check, ${Math.round(chance * 100)}%. Success gives you a new vehicle`,
        get disabled() { return !!cannot(); }, // read when shown and checked again when chosen
        resolve: (st) => {
          if (cannot()) {
            awaitOrders(st, p, "The team does not have the 2 parts and 6 fuel (or already has a vehicle).", { failed: true });
            return "Not possible any more.";
          }
          takeSupply(p, "parts", 2);
          if (!st.rng.chance(chance)) {
            awaitOrders(st, p, "The repair failed and wasted the parts.");
            return "Two parts wasted. The car will not start.";
          }
          takeSupply(p, "fuel", 6);
          const car = createVehicle(st, "sedan", { kind: "party", partyId: p.id }, { fuel: 6, condition: 35 });
          p.vehicle = true;
          p.vehicleId = car.id;
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

function recoverVehicle(state, p) {
  const tile = partyTile(p);
  const v = state.vehicles.find((x) => x.loc.kind === "abandoned" && x.loc.tile === tile);
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
  if (p.vehicle) return salvage(`The team already has a vehicle, so the ${v.name} stays.`);
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
  v.loc = { kind: "party", partyId: p.id };
  p.vehicle = true;
  p.vehicleId = v.id;
  // What was left inside it is cargo again (the vehicle carries it).
  const c = takeVehicleCargo(state, p, v);
  delete v.cargo;
  spot(p, { key: `vehicle:${v.id}`, type: "vehicle", tile, hour: state.hour, label: v.name, remove: true });
  log(state, `The ${v.name} is running again${c.got.length ? `, with the ${c.got.join(", ")} left in it` : ""}.${c.left.length ? ` No room for ${c.left.join(", ")}: left behind.` : ""}`, "good");
  awaitOrders(state, p, `The ${v.name} is running again (fuel ${Math.round(v.fuel)}, condition ${Math.round(v.condition)}%).${c.got.length ? ` Cargo back on board: ${c.got.join(", ")}.` : ""}`);
  return "";
}

function cullCard(state, p, horde) {
  const power0 = partyMembers(state, p).reduce((s, m) => s + combatPower(m), 0);
  // The horde may be gone by the time the card is answered (merged into another, or spent on a base).
  const gone = (st) => !st.hordes.includes(horde);
  const moved = (st) => { awaitOrders(st, p, "The horde had moved on before the team was set.", { failed: true }); return "The horde is no longer there."; };
  return {
    title: `A horde of ${horde.size}`,
    text: `The team has found the horde near ${tileLabel(state, horde.tile)} (score ${hordeScore(horde.size)}${horde.bosses ? `, a ${BOSS_NAMES.horde} among them` : ""}${zombieToughness(state, horde.tile) >= 3 ? "; this is red-skull ground by a hive, and the dead here are much tougher" : ""}). Your squad's combat power is ${Math.round(power0)}.`,
    partyId: p.id,
    choices: [
      {
        label: "Set up a killzone and fire",
        hint: "Uses up to 15 ammo per person. Best with ammo and good shooters; someone may get hurt",
        resolve: (st) => {
          if (gone(st)) return moved(st);
          const members = partyMembers(st, p);
          const power = members.reduce((s, m) => s + combatPower(m), 0);
          const ammoUse = takeSupply(p, "ammo", members.length * 15);
          // Tougher dead (a hive's land, red-skull ground) fall slower; a bigger horde (its score) presses closer.
          const tough = 1 + zombieToughness(st, horde.tile) * 0.35;
          const kill = Math.min(horde.size, Math.round((power * (ammoUse > members.length * 8 ? 3 : 1.5) * st.rng.range(0.7, 1.3)) / tough));
          horde.size -= kill;
          const risk = Math.min(0.9, 0.25 + hordeScore(horde.size + kill) / 40 + (horde.bosses ? 0.2 : 0) + (tough - 1) * 0.3);
          if (members.length && st.rng.chance(risk)) hurt(st, st.rng.pick(members), st.rng.int(15, 45) * tough, horde.tile, "fighting a horde");
          const broken = horde.size <= 5;
          if (broken && st.hordes.includes(horde)) st.hordes.splice(st.hordes.indexOf(horde), 1);
          if (!wipeIfEmpty(st, p)) awaitOrders(st, p, `The team cut down about ${kill} of them.`);
          return `About ${kill} of the dead fall.${broken ? " The horde is broken." : ""}`;
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
          horde.target = st.grid.neighbors(horde.tile).sort((a, b) => st.grid.distance(b, hub(st).tile) - st.grid.distance(a, hub(st).tile))[0];
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
export function startReturn(state, p) {
  if (wipeIfEmpty(state, p)) return "That team is gone.";
  const known = p.radioLive || p.phase === "waiting" || p.phase === "task"; // ordered home by you, not on its own
  const home = baseById(state, p.homeBaseId) || hub(state);
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
      const v = partyVehicle(state, p);
      log(state, `The ${v ? v.name : "vehicle"} could not get home from there and was left behind.`, "danger");
      leaveVehicle(state, p, partyTile(p), "no road home");
    }
  }
  p.path = res ? res.path : [partyTile(p)];
  p.idx = 0;
  p.progress = Math.min(0, p.progress);
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
function addStock(base, supplies) {
  for (const [k, v] of Object.entries(supplies || {})) {
    if (!Number.isFinite(v) || v < 1) continue;
    base.stock[k] = (Number.isFinite(base.stock[k]) ? base.stock[k] : 0) + Math.floor(v);
  }
}

function returnHome(state, p) {
  const home = baseById(state, p.homeBaseId) || hub(state);
  const members = partyMembers(state, p);
  addStock(home, p.supplies);
  addStock(home, p.cargo.supplies);
  home.armory.push(...p.cargo.gear);
  const v = partyVehicle(state, p);
  if (v) v.loc = { kind: "base", baseId: home.id };
  const routeActive = p.kind === "convoy" && state.routes.some((r) => r.id === p.routeId && r.active);
  for (const m of members) m.location = routeActive ? { kind: "route", routeId: p.routeId } : { kind: "base", baseId: home.id };
  if (p.owner === "player") tripDone(state, p, members, home); // relations.js: the service record, rough trips
  if (p.owner === "player") prisonersHome(state, p, home); // prisoners.js: prisoners taken on the trip go to the cells
  const before = state.knowledge.filter(Boolean).length;
  const markersBefore = state.markers.length;
  mergeKnowledge(state, p.seen, p.spotted);
  const revealed = state.knowledge.filter(Boolean).length - before;
  const newMarkers = state.markers.length - markersBefore;
  const loot = Object.entries(p.cargo.supplies).filter(([, val]) => val >= 1).map(([k, val]) => `${Math.floor(val)} ${k}`);
  if (p.cargo.gear.length) loot.push(...p.cargo.gear.map((g) => g.name));
  if (p.routeKind === "supply") {
    supplyReturned(state, p, home, loot);
  } else if (p.kind === "convoy") {
    const route = state.routes.find((r) => r.id === p.routeId);
    log(state, `Convoy back from ${route ? factionById(state, route.factionId)?.name : "the route"}${loot.length ? `: ${loot.join(", ")}` : ""}.`, "good");
  } else {
    log(state, `${teamName(state, p)} is home${loot.length ? ` with ${loot.join(", ")}` : ""}.${revealed > 0 ? ` ${revealed} new tiles mapped.` : " Map intel updated."}${newMarkers > 0 ? ` ${newMarkers} new marker${newMarkers === 1 ? "" : "s"} on the map.` : ""}`, "good");
  }
  removeParty(state, p);
}

export function removeParty(state, p) {
  const i = state.parties.indexOf(p);
  if (i >= 0) state.parties.splice(i, 1);
  // Nothing may outlive the team: its cards (events, orders, conflicts) and an open trade go with it.
  for (let j = state.cards.length - 1; j >= 0; j--) if (state.cards[j].partyId === p.id) state.cards.splice(j, 1);
  if (state.trade && state.trade.partyId === p.id) state.trade = null;
}

// Everyone on the team is dead (or gone): what it carried stays at a death site on its tile and the vehicle is
// left there, both marked on the map so they can be recovered. On one of your own bases the goods go into that
// base instead. Always use this (through wipeIfEmpty) rather than removeParty for a team that lost its people.
export function wipeParty(state, p) {
  if (!state.parties.includes(p)) return;
  const tile = partyTile(p);
  const v = partyVehicle(state, p);
  const base = state.bases.find((b) => b.tile === tile);
  if (base) {
    addStock(base, p.supplies);
    addStock(base, p.cargo.supplies);
    base.armory.push(...p.cargo.gear);
    if (v) v.loc = { kind: "base", baseId: base.id };
    log(state, `The last of a team died at ${base.name}. What it carried went into the stores there.`, "death");
  } else {
    const items = [];
    const sup = {};
    for (const pool of [p.supplies, p.cargo.supplies]) for (const [k, q] of Object.entries(pool)) if (SUPPLIES[k] && Number.isFinite(q) && q >= 1) sup[k] = (sup[k] || 0) + Math.floor(q);
    for (const [k, q] of Object.entries(sup)) items.push({ kind: "supply", key: k, name: SUPPLIES[k].name, qty: q, value: q * SUPPLIES[k].value });
    // item: the real object, so a pack keeps its contents and a worn weapon its condition when recovered.
    for (const g of p.cargo.gear) items.push({ kind: "gear", key: g.key, name: g.name, qty: 1, value: (GEAR[g.key]?.value || 0) * (g.quality || 1), item: g });
    let site = state.deathSites.find((d) => d.tile === tile);
    if (site) site.items.push(...items);
    else if (items.length) {
      site = { id: newId(), tile, items, day: day(state), names: ["the lost team"], lastConfirmed: day(state) };
      state.deathSites.push(site);
    }
    if (site && site.items.length) markDeathSite(state, site);
    if (v) {
      v.loc = { kind: "abandoned", tile, since: state.hour };
      markAbandonedVehicle(state, v, "its team was lost");
    }
    log(state, `A whole team was lost near ${tileLabel(state, tile)}. ${site && site.items.length ? "What it carried lies there" : "Nothing it carried is left"}${v ? `, and the ${v.name} stands abandoned` : ""}: marked on the map.`, "death");
  }
  p.cargo = { supplies: {}, gear: [] };
  p.supplies = {};
  p.vehicle = false;
  p.vehicleId = null;
  removeParty(state, p);
}

// ---------- player trade-route convoys ----------
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
  if ((h.stock[route.sendKey] || 0) < route.sendQty) return log(state, `Not enough ${route.sendKey} to send the convoy to ${f.name}.`, "danger");
  // A vehicle if one is parked, sound, and can be fuelled for the round trip; otherwise hand carts.
  const v = state.vehicles.find((x) => x.loc.kind === "base" && x.loc.baseId === h.id && x.condition > 20);
  const truckPath = v ? planPath(state, h.tile, f.bases[0], true) : null;
  const need = truckPath ? Math.ceil(fuelForPath(state, truckPath.path) * 2.2) : 0;
  const useTruck = !!truckPath && need <= tank(v) && v.fuel + (h.stock.fuel || 0) >= need;
  const res = useTruck ? truckPath : planPath(state, h.tile, f.bases[0], false);
  if (!res) return;
  const hours = res.cost * 2 + 4;
  const food = Math.ceil((escorts.length * hours) / 24);
  if (h.stock.food < food) return log(state, `Not enough food to supply the convoy to ${f.name}.`, "danger");
  h.stock[route.sendKey] -= route.sendQty;
  h.stock.food -= food;
  const water = Math.min(h.stock.water || 0, food);
  h.stock.water -= water;
  if (useTruck) {
    const top = Math.max(0, need - v.fuel);
    h.stock.fuel -= top;
    v.fuel += top;
  }
  const p = {
    id: newId(), owner: "player", kind: "convoy", mission: "route", routeId: route.id, dest: f.bases[0], homeBaseId: h.id,
    members: escorts.map((s) => s.id), stance: "normal", vehicle: useTruck, vehicleId: useTruck ? v.id : null,
    supplies: { food, water: Math.max(water, food), fuel: 0, meds: 0, ammo: route.escort === "heavy" ? 40 : route.escort === "standard" ? 20 : 8 },
    cargo: { supplies: { [route.sendKey]: route.sendQty }, gear: [] },
    path: res.path, idx: 0, progress: 0, phase: "out", seen: new Map(), spotted: new Map(), sightNow: [], radioLive: false,
    departed: state.hour, plannedHours: hours, eventsSeen: 0,
  };
  if (useTruck) v.loc = { kind: "party", partyId: p.id };
  for (const s of escorts) s.location = { kind: "party", partyId: p.id };
  state.parties.push(p);
  log(state, `Convoy left for ${f.name} with ${route.sendQty} ${route.sendKey} (${route.escort} escort, ${useTruck ? `in the ${v.name}` : "with hand carts"}).`, "info");
}

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
function aiPartyHour(state, p) {
  if (p.phase === "siege") {
    if (p.helpCall && state.hour >= p.helpCall.arrivesAt && !p.helpCall.delivered) {
      p.helpCall.delivered = true;
      deliverHelpCall(state, p);
    }
    p.siegeLeft -= 1;
    if (p.siegeLeft <= 0) finishSiege(state, p);
    return;
  }
  if (p.returning) {
    removeParty(state, p);
    return;
  }
  if (p.kind === "caravan" && p.phase !== "out") return caravanHour(state, p); // at your gates (caravans.js)
  if (p.kind === "scav" && p.phase === "search") return scavSearchHour(state, p); // scavenging a site (aiscav.js)
  const entered = stepAlong(state, p, p.vehicle ? 1 : 0.9);
  for (const tileId of entered) {
    // Hordes chew up whoever walks into them.
    const horde = state.hordes.find((h) => h.tile === tileId);
    if (horde) {
      p.strength *= 0.75;
      if (p.kind === "scav") for (const k of Object.keys(p.scav.got)) p.scav.got[k] *= 0.75; // and drops a share of the haul
      horde.size = Math.max(0, horde.size - Math.round(p.strength * 0.6));
      if (horde.size < 5) state.hordes.splice(state.hordes.indexOf(horde), 1); // too few left to be a horde
    }
    if ((p.kind === "convoy" || p.kind === "caravan") && !caravanGuarded(state, p)) { // jobs.js: raiders leave a caravan you escort alone
      for (const r of state.factions) {
        if (!r.alive || r.type !== "raider" || r.id === p.owner) continue;
        if (r.bases.some((b) => state.grid.distance(b, tileId) <= 2) && state.rng.chance(0.12)) {
          r.stock.food += 15;
          r.stock.ammo += 20;
          // Seen from your land; a group you have not met is not named.
          const from = factionById(state, p.owner);
          if (state.live.has(tileId)) log(state, `${r.known ? r.name : "Raiders"} ambushed a ${from && from.known ? `${from.name} ` : ""}convoy near ${tileLabel(state, tileId)}.`, "danger");
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
  // Raid warnings when lookouts can see them coming.
  if (p.kind === "raid" && p.target.kind === "player" && !p.warned) {
    const base = baseById(state, p.target.baseId);
    if (base && state.live.has(partyTile(p)) && state.grid.distance(partyTile(p), base.tile) <= 4) {
      p.warned = true;
      raidWarning(state, p);
    }
  }
  if (p.idx >= p.path.length - 1) {
    if (p.kind === "convoy") {
      const to = factionById(state, p.targetFaction);
      if (to && to.alive) {
        to.stock.food += 10;
        to.stock.scrap += 10;
      }
      removeParty(state, p);
    } else if (p.kind === "caravan") {
      caravanArrive(state, p); // caravans.js: trade at your base, or home again
    } else if (p.kind === "scav") {
      scavArrived(state, p); // aiscav.js: at the site (search) or home (the haul into their stock)
    } else if (p.kind === "raid") {
      const stillThere = p.target.kind === "player" ? baseById(state, p.target.baseId) :
        factionById(state, p.target.factionId)?.bases.includes(p.target.tile);
      if (!stillThere) return removeParty(state, p);
      p.phase = "siege";
      p.siegeLeft = p.target.kind === "player" ? 8 : 18;
      if (p.target.kind === "player" && !p.warned) {
        p.warned = true;
        raidWarning(state, p);
      }
      if (p.target.kind === "faction") maybeCallForHelp(state, p);
    }
  }
}

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
          h.cargo.supplies[reward.key] = (h.cargo.supplies[reward.key] || 0) + reward.qty;
          log(state, `${f.name} thanks your squad with ${reward.qty} ${reward.key}.`, "good");
        }
      }
      if (state.parties.includes(h)) startReturn(state, h);
    }
  }
  removeParty(state, p);
}
