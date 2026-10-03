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
import { perceive, spot, mergeSpots, MARKER_TYPES } from "./markers.js";
import { rescueArrive, captivesOf, ransomOnTradeCard } from "./conflicts.js";
import { supplyArrive, supplyReturned } from "./supply.js";
import { taskHour, startTask, startOrder, continueQueue, resumeQueue, orderLabel, queueText } from "./orders.js";
import { crossingsFrom } from "./crossing.js";
import { carryBonus, itemLoad } from "./inventory.js";

export const STANCES = {
  stealthy: { name: "Stealthy", speed: 0.75, events: 0.6, desc: "25% slower, 40% fewer events. Good for scouting dangerous ground." },
  normal:   { name: "Normal",   speed: 1.0,  events: 1.0, desc: "Standard pace and risk." },
  rushed:   { name: "Rushed",   speed: 1.3,  events: 1.4, desc: "30% faster, 40% more events. For when time matters more than safety." },
};

export const MISSIONS = {
  recon:       { name: "Recon",            desc: "Travel there and survey the area (extra-careful look for finds), then decide what to do next." },
  move:        { name: "Move here",        desc: "Travel there and wait for orders." },
  scavenge:    { name: "Scavenge / raid",  desc: "Search a location hour by hour. More loot the longer you stay, while Heat rises." },
  trade:       { name: "Trade visit",      desc: "Visit a group's base to barter, give gifts and sign pacts." },
  outpost:     { name: "Build outpost",    desc: "Found a satellite base here. Needs 15 scrap carried. The team stays as its first staff." },
  recover:     { name: "Recover bodies",   desc: "Collect what is left at a death site before scavengers strip it." },
  cull:        { name: "Cull horde",       desc: "Thin out or lure away a horde on or next to this tile." },
  investigate: { name: "Investigate find", desc: "Check a cache, wrecked car or abandoned camp your teams spotted." },
  getvehicle:  { name: "Recover vehicle",  desc: "Bring fuel (and a part if it is badly damaged) to get an abandoned vehicle running." },
  rescue:      { name: "Rescue captives",  desc: "Go to the group base where your people are held: sneak them out, storm the base, negotiate or pay a ransom." },
  survey:      { name: "Look around",      desc: "Spend 2 hours surveying nearby tiles. Better odds of spotting hidden finds.", hidden: true },
  help:        { name: "Relief squad",     desc: "Help a group under attack.", hidden: true },
  route:       { name: "Convoy",           desc: "Trade-route convoy.", hidden: true },
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
  return members.reduce((s, m) => s + (m.traits.includes("badback") ? 8 : 15) + carryBonus(m), 0) + vCap;
}
export const partyCapacity = (state, p) => carryCapacity(state, partyMembers(state, p), partyVehicle(state, p));

export const supplyLoad = (supplies) => Object.entries(supplies).reduce((s, [k, v]) => s + v * SUPPLIES[k].weight, 0);
// Each item takes 3; a pack in the cargo also counts what is inside it (inventory.js itemLoad).
export const cargoLoad = (cargo) => supplyLoad(cargo.supplies) + cargo.gear.reduce((s, g) => s + itemLoad(g), 0);
// How many units of a supply fit in the remaining space.
export const unitsThatFit = (room, key) => Math.max(0, Math.floor(room / SUPPLIES[key].weight));

export function partyMembers(state, p) {
  return (p.members || []).map((id) => survivorById(state, id)).filter((s) => s && s.alive);
}

export function bestSkill(state, p, key) {
  return Math.max(0, ...partyMembers(state, p).map((s) => skill(s, key)));
}

export function sightRadius(state, p) {
  const m = partyMembers(state, p);
  let r = 1;
  if (bestSkill(state, p, "scouting") >= 10) r += 1;
  if (m.some((s) => s.traits.includes("keeneye"))) r += 1;
  return r;
}

function hasMilRadio(state, p) {
  return partyMembers(state, p).some((s) => s.gear.tool && s.gear.tool.key === "milradio" && gearEffect(s, s.gear.tool).usable);
}

export const teamName = (state, p) => `${MISSIONS[p.mission]?.name || "Team"} team (${partyMembers(state, p).map((s) => s.name.split(" ")[0]).join(", ")})`;

export function tileLabel(state, id) {
  const t = state.tiles[id];
  return t.loc ? t.loc.name : `${TERRAIN[t.terrain].name.toLowerCase()} (${t.x},${t.y})`;
}

// ---------- trip estimates for the planner ----------
// Travel speed per hour for a player team (trade-route convoys keep a steady pace).
export const partySpeed = (p) => (p.kind === "convoy" && p.routeKind !== "supply" ? 1 : STANCES[p.stance]?.speed || 1);

// Whole hours to walk/drive a path, using the same hour-by-hour stepping as the real movement
// (stepAlong): a tile is entered only once enough progress has built up, leftover progress carries
// over, a delay (negative progress) is paid first, and a vehicle that runs dry is left behind and the
// team walks the rest (at walking cost). Random events and fights can still add delays on the road.
// maxHours: stop early (idx then says how far the team got).
export function travelHours(state, path, { vehicle = false, speed = 1, progress = 0, idx = 0, fuel = Infinity, maxHours = 24 * 90 } = {}) {
  const sim = { path: [...path], idx, progress, vehicle: !!vehicle };
  let f = fuel, hours = 0, dryAt = null;
  while (sim.idx < sim.path.length - 1 && hours < maxHours) {
    hours += 1;
    for (const tileId of stepAlong(state, sim, speed)) {
      if (!sim.vehicle) continue;
      const prev = sim.path[sim.path.lastIndexOf(tileId, sim.idx) - 1];
      const use = state.tiles[prev].roadLinks.includes(tileId) ? 0.6 : 1.5;
      if (f < use - 1e-9) { f = 0; sim.vehicle = false; dryAt = tileId; } // same rule as useFuel
      else f -= use;
    }
  }
  return { hours, idx: sim.idx, fuelLeft: f, vehicle: sim.vehicle, dryAt, reached: sim.path[sim.path.length - 1] === path[path.length - 1] };
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
  const t = state.hour - (p.planStart ?? p.departed);
  const opts = { vehicle: !!p.planVehicle, speed: partySpeed(p), fuel: p.planFuel ?? Infinity };
  if (t < p.etaOut) return plan[travelHours(state, plan, { ...opts, maxHours: t }).idx];
  const tb = t - p.etaOut - 6;
  if (p.etaBack == null || tb <= 0) return plan[plan.length - 1];
  const go = travelHours(state, plan, opts);
  return plan[plan.length - 1 - travelHours(state, [...plan].reverse(), { ...opts, vehicle: go.vehicle, fuel: go.fuelLeft, maxHours: tb }).idx];
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
  const back = backPlan ? travelHours(state, backPlan.path, { vehicle: go.vehicle && !!planPath(state, dest, home.tile, true), speed: sp, fuel: go.fuelLeft }) : { hours: go.hours };
  const hoursOut = go.hours;
  const hoursBack = back.hours;
  const hours = hoursOut + hoursBack + 6; // out, back, plus time on site
  const n = memberIds.length;
  return {
    path: out.path,
    hoursOut, hoursBack, hours,
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
export function launchExpedition(state, opts) {
  const { memberIds, dest, mission, stance, supplies } = opts;
  const vehicleId = opts.vehicleId || null;
  const home = hub(state);
  const v = vehicleId ? vehicleById(state, vehicleId) : null;
  if (vehicleId && (!v || v.loc.kind !== "base" || v.loc.baseId !== home.id)) return { error: "That vehicle is not at the hub." };
  if (v && v.condition <= 0) return { error: "That vehicle needs repairs first." };
  const est = estimateTrip(state, { memberIds, dest, vehicle: !!v, stance, fuel: v ? v.fuel + (supplies.fuel || 0) : 0 });
  if (!est) return { error: v ? "No route for a vehicle (mountains or water). Try on foot." : "No route to that tile." };
  if (!memberIds.length) return { error: "Pick at least one survivor." };
  for (const [k, val] of Object.entries(supplies)) if ((home.stock[k] || 0) < val) return { error: `Not enough ${SUPPLIES[k].name.toLowerCase()} at the hub.` };
  for (const [k, val] of Object.entries(supplies)) home.stock[k] -= val;
  const p = {
    id: newId(), owner: "player", kind: "expedition", mission, dest, homeBaseId: home.id,
    members: [...memberIds], stance, vehicle: !!v, vehicleId: v ? v.id : null, supplies: { ...supplies },
    cargo: { supplies: {}, gear: [] },
    path: est.path, idx: 0, progress: 0, phase: "out",
    seen: new Map(), spotted: new Map(), sightNow: [], radioLive: false,
    departed: state.hour, plannedHours: est.hours, eventsSeen: 0,
    orders: [], orderStart: state.hour, // queued orders (orders.js) and when the current one began
    // What the hub knows of the plan, for the estimated "?" position while out of contact (plannedTile).
    planPath: [...est.path], planStart: state.hour, planVehicle: !!v, planFuel: v ? v.fuel + (supplies.fuel || 0) : 0, etaOut: est.hoursOut, etaBack: est.hoursBack,
  };
  if (v) v.loc = { kind: "party", partyId: p.id };
  for (const id of memberIds) survivorById(state, id).location = { kind: "party", partyId: p.id };
  state.parties.push(p);
  log(state, `${teamName(state, p)} left for ${tileLabel(state, dest)}${v ? ` in the ${v.name}` : " on foot"}. Arrives in about ${est.hoursOut}h; back in about ${Math.ceil(est.days)} days.`, "info");
  return { party: p };
}

export function sendHelpSquad(state, raidParty, target) {
  const h = hub(state);
  const fighters = atBase(state, h.id).sort((a, b) => combatPower(b) - combatPower(a)).slice(0, 3);
  if (!fighters.length) return "Nobody at the hub can go.";
  const supplies = { food: Math.min(h.stock.food, 6), water: Math.min(h.stock.water, 6), meds: Math.min(h.stock.meds, 2), ammo: Math.min(h.stock.ammo, 30) };
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
}

function stepAlong(state, p, speed) {
  if (p.idx >= p.path.length - 1) return [];
  p.progress += speed;
  const entered = [];
  while (p.idx < p.path.length - 1) {
    const cost = moveCost(state, p.path[p.idx], p.path[p.idx + 1], p.vehicle);
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

function playerPartyHour(state, p) {
  const members = partyMembers(state, p);
  if (!members.length) {
    removeParty(state, p);
    return;
  }
  // A supply convoy parked at one of your bases eats from that base (handled daily in supply.js).
  if (p.phase === "holding") {
    updateRadio(state, p);
    return;
  }
  consume(state, p, members);
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
  // Found food and water in the cargo is used once packed supplies run out.
  for (const k of ["food", "water"]) {
    if (s[k] < 0 && (p.cargo.supplies[k] || 0) > 0) {
      const take = Math.min(-s[k], p.cargo.supplies[k]);
      p.cargo.supplies[k] -= take;
      s[k] += take;
    }
  }
  if (s.food < 0) {
    s.food = 0;
    for (const m of members) hurt(state, m, 0.6, partyTile(p), "of starvation on the road");
    if (state.hour % 24 === 0) log(state, `${teamName(state, p)} is out of food.`, "danger");
  }
  if (s.water < 0) {
    s.water = 0;
    for (const m of members) hurt(state, m, 1.0, partyTile(p), "of thirst on the road");
    if (state.hour % 24 === 0) log(state, `${teamName(state, p)} is out of water.`, "danger");
  }
  if (!partyMembers(state, p).length) wipeParty(state, p);
}

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
      abandonVehicle(state, p, tileId, "out of fuel");
      log(state, `The ${name} ran out of fuel near ${tileLabel(state, tileId)}. The team left it there and continues on foot. Bring fuel to recover it.`, "danger");
      trimCargo(state, p);
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
  const card = rollTravelEvent(state, p, tileId);
  if (card) {
    p.eventsSeen += 1;
    addCard(state, card);
  }
}

export function trimCargo(state, p) {
  const cap = partyCapacity(state, p);
  let over = cargoLoad(p.cargo) - cap;
  const keys = Object.keys(p.cargo.supplies).sort((a, b) => SUPPLIES[a].value / SUPPLIES[a].weight - SUPPLIES[b].value / SUPPLIES[b].weight);
  for (const k of keys) {
    if (over <= 0) break;
    const drop = Math.min(Math.ceil(over / SUPPLIES[k].weight), p.cargo.supplies[k]);
    p.cargo.supplies[k] -= drop;
    over -= drop * SUPPLIES[k].weight;
  }
}

function addCargo(state, p, key, qty) {
  const room = Math.max(0, partyCapacity(state, p) - cargoLoad(p.cargo));
  const take = Math.min(unitsThatFit(room, key), qty);
  p.cargo.supplies[key] = (p.cargo.supplies[key] || 0) + take;
  return take;
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
  if (fb && captivesOf(state, fb.id).length) add("rescue");
  const ownedByOther = state.factions.some((f) => f.bases.includes(tile)) || (typeof t.owner === "number");
  if (!state.bases.some((b) => b.tile === tile) && !ownedByOther && t.terrain !== "water") {
    const scrap = (p.supplies.scrap || 0) + (p.cargo.supplies.scrap || 0);
    add("outpost", scrap < 15 ? `Needs 15 scrap carried (have ${Math.floor(scrap)})` : null);
  }
  const site = state.deathSites.find((d) => d.tile === tile);
  if (site && site.items.length) add("recover");
  if (state.hordes.some((h) => state.grid.distance(h.tile, tile) <= 1)) add("cull");
  if (t.hidden && !t.hidden.taken && (t.hidden.known || p.spotted?.has(`${t.hidden.type}:${tile}`))) add("investigate");
  const v = state.vehicles.find((x) => x.loc.kind === "abandoned" && x.loc.tile === tile);
  if (v && !p.vehicle) {
    const fuel = (p.supplies.fuel || 0) + (p.cargo.supplies.fuel || 0);
    add("getvehicle", fuel < 2 ? "Bring at least 2 fuel" : null);
  }
  return out;
}

// doneLabel: the order that just finished (the card then doubles as its "done" notice).
// Choices marked order: true start timed work; the game resumes and skips the result screen.
export function ordersCard(state, p, text, doneLabel) {
  const tile = partyTile(p);
  const opts = orderOptions(state, p);
  const queued = (p.orders || []).length;
  return {
    title: doneLabel ? `Done: ${doneLabel}` : `Orders: team at ${tileLabel(state, tile)}`,
    isOrders: true,
    text: `${text ? text + " " : ""}${partyMembers(state, p).map((s) => s.name.split(" ")[0]).join(", ")} ${partyMembers(state, p).length === 1 ? "waits" : "wait"} for your call at ${tileLabel(state, tile)}. Supplies: ${Math.floor(p.supplies.food)} food, ${Math.floor(p.supplies.water)} water${p.vehicle ? `, ${Math.floor(partyFuel(state, p))} fuel` : ""}.${queued ? ` Queued orders on hold: ${queueText(state, p)}.` : ""}`,
    partyId: p.id,
    choices: [
      ...(queued ? [{ label: `Resume queued orders (${queued})`, hint: `Carry on with: ${queueText(state, p)}`, order: true, resolve: (st) => resumeQueue(st, p) }] : []),
      ...opts.map((o) => ({
        label: o.label, hint: o.disabled || o.desc, disabled: !!o.disabled, order: o.mission === "survey",
        resolve: (st) => giveOrder(st, p, o.mission),
      })),
      { label: "Set up camp (8h)", hint: "Stop and rest here for 8 hours: the hurt recover a little, nobody travels. Break camp early from the team panel.", order: true, resolve: (st) => startOrder(st, p, { type: "camp", hours: 8 }) },
      ...(crossingsFrom(state, tile).length ? [{ label: "Build a boat and cross…", hint: "This team stands on a shore with land straight across the water. The team panel shows each crossing with its cost (scrap, hours) and lets you gather materials.", uiAction: { type: "expedition", partyId: p.id }, resolve: () => "" }] : []),
      { label: "Move to another tile…", hint: "Pick any tile on the map. The team travels there and waits for orders again.", uiAction: { type: "move", partyId: p.id }, resolve: () => "Pick a destination on the map (Esc to cancel)." },
      { label: "Return home", hint: "Head back to the hub with everything carried.", order: true, resolve: (st) => { startReturn(st, p); return "The team heads home."; } },
      { label: "Team panel…", hint: "People, gear, supplies and vehicle; camp, scavenge, repair, treat and queue orders.", uiAction: { type: "expedition", partyId: p.id }, resolve: () => "" },
      { label: "Hold here", hint: "Wait. Give orders later from the Teams tab. Supplies keep draining.", resolve: () => "The team holds position." },
    ],
  };
}

export function awaitOrders(state, p, text) {
  if (!state.parties.includes(p)) return;
  const tile = partyTile(p);
  // Finished where it was sent (not stopped on the way): the next queued order starts by itself.
  const finished = tile === p.dest;
  const doneLabel = finished ? orderLabel(state, p) : null;
  p.task = null;
  p.phase = "waiting";
  p.path = [tile];
  p.idx = 0;
  p.progress = Math.min(0, p.progress);
  p.dest = tile;
  // When it checks in for orders, the team reports what it has spotted (the full map update waits for its return).
  mergeSpots(state, p.spotted);
  if (finished && continueQueue(state, p, text)) return;
  addCard(state, ordersCard(state, p, text, doneLabel));
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
  if (debit) p.progress -= 2; // two hours spent looking around before moving on
  updateRadio(state, p);
  return found.length ? `Spotted: ${found.map((f) => `${MARKER_TYPES[f.type].name} at ${tileLabel(state, f.tile)}`).join("; ")}.` : "Nothing new spotted nearby.";
}

// ---------- arriving and acting ----------
function arrive(state, p) {
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
      p.phase = "engaged";
      startScavenge(state, p);
      return "The team starts searching.";
    case "trade": {
      const f = state.factions.find((f) => f.alive && f.bases.includes(p.dest));
      if (!f) {
        awaitOrders(state, p, `Nobody is at ${tileLabel(state, p.dest)} anymore.`);
      } else if (attitude(f) === "Hostile") {
        const victim = state.rng.pick(members);
        hurt(state, victim, state.rng.int(20, 50), p.dest, `shot at the gates of ${f.name}`);
        log(state, `${f.name} opened fire on your trade team.`, "danger");
        awaitOrders(state, p, `${f.name} opened fire at the gates.`);
      } else {
        f.known = true;
        p.phase = "engaged";
        state.trade = { partyId: p.id, factionId: f.id, offer: {}, ask: {} };
        // Your people held here: offer a ransom before the barter starts.
        const ransom = ransomOnTradeCard(state, p, f);
        if (ransom) addCard(state, ransom);
      }
      return "";
    }
    case "outpost": {
      const blocked = state.bases.some((b) => b.tile === p.dest) || state.factions.some((f) => f.bases.includes(p.dest)) ||
        (t.owner != null && t.owner !== "player");
      const scrap = (p.supplies.scrap || 0) + (p.cargo.supplies.scrap || 0);
      if (blocked || scrap < 15) {
        awaitOrders(state, p, blocked ? `Someone else holds ${tileLabel(state, p.dest)}.` : "The team does not have the 15 scrap needed to build.");
        return "";
      }
      const base = {
        id: newId(), tile: p.dest, type: "outpost", name: `${t.loc ? t.loc.name : tileLabel(state, p.dest)} Outpost`,
        stock: { food: 0, water: 0, fuel: 0, meds: 0, ammo: 0, parts: 0, scrap: 0 },
        radio: false, watchtower: false, buildings: [], construction: [], armory: [],
      };
      for (const [k, v] of Object.entries(p.supplies)) base.stock[k] = Math.floor(v);
      for (const [k, v] of Object.entries(p.cargo.supplies)) base.stock[k] = (base.stock[k] || 0) + Math.floor(v);
      base.stock.scrap -= 15;
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
      if (!site || !site.items.length) text = "Nothing left. Someone got there first.";
      else {
        const got = [];
        for (const it of [...site.items]) {
          if (it.kind === "gear") p.cargo.gear.push(it.item || { key: it.key, name: it.name, quality: 1 }); // the real item if kept (a pack keeps its contents)
          else {
            const take = addCargo(state, p, it.key, it.qty);
            if (take <= 0) continue;
            it.qty -= take;
            if (it.qty > 0) continue;
          }
          site.items.splice(site.items.indexOf(it), 1);
          got.push(it.name);
        }
        if (!site.items.length) state.deathSites.splice(state.deathSites.indexOf(site), 1);
        spot(p, { key: `death:${p.dest}`, type: "death", tile: p.dest, hour: state.hour, label: "Death site", info: { items: site.items.length }, remove: !site.items.length });
        text = `Recovered from ${site.names.join(", ")}'s remains: ${got.join(", ") || "nothing"}.`;
        log(state, text, "good");
      }
      awaitOrders(state, p, text);
      return "";
    }
    case "cull": {
      const horde = state.hordes.find((h) => h.tile === p.dest) || state.hordes.find((h) => state.grid.distance(h.tile, p.dest) <= 1);
      if (!horde) {
        awaitOrders(state, p, "The horde had moved on.");
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
  }
  return "";
}

function investigate(state, p) {
  const tile = partyTile(p);
  const t = state.tiles[tile];
  const h = t.hidden;
  if (!h || h.taken) {
    awaitOrders(state, p, "Someone has already cleaned it out.");
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
      const nest = state.tiles.find((x) => x.nest && state.grid.distance(x.id, tile) <= 10);
      if (f) for (const b of f.bases) p.seen.set(b, snapshot(state, b));
      if (nest) p.seen.set(nest.id, snapshot(state, nest.id));
      extra = ` Notes in the camp mention ${f ? f.name : "other survivors"}${nest ? " and a nest nearby" : ""}; it goes on the map when the team reports.`;
    }
    h.taken = true;
    spot(p, { key, type: h.type, tile, hour: state.hour, label: MARKER_TYPES[h.type].name, info: { emptied: true } });
    awaitOrders(state, p, `${MARKER_TYPES[h.type].name}: found ${got.join(", ") || "nothing you could carry"}.${extra}`);
    return "";
  }
  // A wrecked car: restore it, strip it, or leave it.
  p.phase = "engaged";
  const parts = (p.supplies.parts || 0) + (p.cargo.supplies.parts || 0);
  const fuel = (p.supplies.fuel || 0) + (p.cargo.supplies.fuel || 0);
  const mech = bestSkill(state, p, "mechanics");
  const chance = Math.max(0.1, Math.min(0.95, (mech + 10 - 6 + 1) / 10));
  addCard(state, {
    title: "Wrecked car",
    text: `An old sedan sits in the ditch, tires flat, but the engine block looks intact. Your best Mechanics: ${mech}.`,
    partyId: p.id,
    choices: [
      {
        label: "Restore it (2 parts, 6 fuel)",
        hint: p.vehicle ? "The team already has a vehicle to drive" : `Mechanics check, ${Math.round(chance * 100)}%. Success gives you a new vehicle`,
        disabled: p.vehicle || parts < 2 || fuel < 6,
        resolve: (st) => {
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

function takeSupply(p, key, qty) {
  const fromCargo = Math.min(qty, p.cargo.supplies[key] || 0);
  p.cargo.supplies[key] = (p.cargo.supplies[key] || 0) - fromCargo;
  p.supplies[key] = (p.supplies[key] || 0) - (qty - fromCargo);
}

function recoverVehicle(state, p) {
  const tile = partyTile(p);
  const v = state.vehicles.find((x) => x.loc.kind === "abandoned" && x.loc.tile === tile);
  if (!v) {
    awaitOrders(state, p, "The vehicle is gone. Scavengers must have taken what was left.");
    return "";
  }
  const fuel = (p.supplies.fuel || 0) + (p.cargo.supplies.fuel || 0);
  if (fuel < 2) {
    awaitOrders(state, p, "The team has no fuel to put in it.");
    return "";
  }
  if (v.condition < 15) {
    const parts = (p.supplies.parts || 0) + (p.cargo.supplies.parts || 0);
    if (parts < 1 && bestSkill(state, p, "mechanics") < 6) {
      awaitOrders(state, p, `The ${v.name} is too damaged (${Math.round(v.condition)}%). Bring a part or a Mechanics 6+ survivor.`);
      return "";
    }
    if (parts >= 1) takeSupply(p, "parts", 1);
    v.condition = Math.max(v.condition, 20);
  }
  const pour = Math.min(fuel, tank(v) - v.fuel);
  takeSupply(p, "fuel", pour);
  v.fuel += pour;
  v.loc = { kind: "party", partyId: p.id };
  p.vehicle = true;
  p.vehicleId = v.id;
  spot(p, { key: `vehicle:${v.id}`, type: "vehicle", tile, hour: state.hour, label: v.name, remove: true });
  log(state, `The ${v.name} is running again.`, "good");
  awaitOrders(state, p, `The ${v.name} is running again (fuel ${Math.round(v.fuel)}, condition ${Math.round(v.condition)}%).`);
  return "";
}

function cullCard(state, p, horde) {
  const members = partyMembers(state, p);
  const power = members.reduce((s, m) => s + combatPower(m), 0);
  return {
    title: `A horde of ${horde.size}`,
    text: `The team has found the horde near ${tileLabel(state, horde.tile)}. Your squad's combat power is ${Math.round(power)}.`,
    partyId: p.id,
    choices: [
      {
        label: "Set up a killzone and fire",
        hint: "Uses up to 15 ammo per person. Best with ammo and good shooters; someone may get hurt",
        resolve: (st) => {
          const ammoUse = Math.min(p.supplies.ammo || 0, members.length * 15);
          p.supplies.ammo -= ammoUse;
          const kill = Math.round(power * (ammoUse > members.length * 8 ? 3 : 1.5) * st.rng.range(0.7, 1.3));
          horde.size -= kill;
          if (st.rng.chance(0.4)) hurt(st, st.rng.pick(members), st.rng.int(15, 45), horde.tile, "fighting a horde");
          if (horde.size <= 5) st.hordes.splice(st.hordes.indexOf(horde), 1);
          awaitOrders(st, p, `The team cut down about ${kill} of them.`);
          return `About ${kill} of the dead fall.${horde.size <= 5 ? " The horde is broken." : ""}`;
        },
      },
      {
        label: "Lure it away with a fire",
        hint: "Uses 3 fuel. Pushes the horde away from your bases for 3 days",
        disabled: partyFuel(state, p) < 3,
        resolve: (st) => {
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

export function startReturn(state, p) {
  const known = p.radioLive || p.phase === "waiting" || p.phase === "task"; // ordered home by you, not on its own
  const home = baseById(state, p.homeBaseId) || hub(state);
  if (p.phase === "task" && p.task?.afloat) return; // out on the water: lands first
  p.homeBaseId = home.id;
  let res = planPath(state, partyTile(p), home.tile, p.vehicle);
  // Cut off by water (a crossing took them there): no walking home; they wait for a boat order.
  if (!res && p.owner === "player" && p.kind !== "convoy" && partyTile(p) !== home.tile && !planPath(state, partyTile(p), home.tile, false)) {
    awaitOrders(state, p, "No way home over land from here: water in the way. Build a boat from the shore (team panel).");
    return;
  }
  if (!res && p.vehicle) {
    res = planPath(state, partyTile(p), home.tile, false);
    if (res) {
      const v = partyVehicle(state, p);
      abandonVehicle(state, p, partyTile(p), "no road home");
      log(state, `The ${v ? v.name : "vehicle"} could not get home from there and was left behind.`, "danger");
      trimCargo(state, p);
    }
  }
  p.path = res ? res.path : [partyTile(p)];
  p.idx = 0;
  p.progress = Math.min(0, p.progress);
  p.phase = "back";
  p.task = null;
  p.orders = []; // heading home ends the queue
  p.orderStart = state.hour;
  if (known) setPlan(state, p, null);
  if (p.path.length <= 1) returnHome(state, p);
}

function returnHome(state, p) {
  const home = baseById(state, p.homeBaseId) || hub(state);
  const members = partyMembers(state, p);
  for (const [k, v] of Object.entries(p.supplies)) home.stock[k] = (home.stock[k] || 0) + Math.max(0, Math.floor(v));
  for (const [k, v] of Object.entries(p.cargo.supplies)) home.stock[k] = (home.stock[k] || 0) + Math.max(0, Math.floor(v));
  home.armory.push(...p.cargo.gear);
  const v = partyVehicle(state, p);
  if (v) v.loc = { kind: "base", baseId: home.id };
  const routeActive = p.kind === "convoy" && state.routes.some((r) => r.id === p.routeId && r.active);
  for (const m of members) m.location = routeActive ? { kind: "route", routeId: p.routeId } : { kind: "base", baseId: home.id };
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
}

export function wipeParty(state, p) {
  // Everyone is dead: the cargo stays at the death site, the vehicle where it stopped.
  const tile = partyTile(p);
  const items = [];
  for (const [k, v] of Object.entries({ ...p.supplies })) if (v >= 1) items.push({ kind: "supply", key: k, name: SUPPLIES[k].name, qty: Math.floor(v), value: Math.floor(v) * SUPPLIES[k].value });
  for (const [k, v] of Object.entries(p.cargo.supplies)) if (v >= 1) items.push({ kind: "supply", key: k, name: SUPPLIES[k].name, qty: Math.floor(v), value: Math.floor(v) * SUPPLIES[k].value });
  for (const g of p.cargo.gear) items.push({ kind: "gear", key: g.key, name: g.name, qty: 1, value: GEAR[g.key].value });
  const site = state.deathSites.find((d) => d.tile === tile);
  if (site) site.items.push(...items);
  else if (items.length) state.deathSites.push({ id: newId(), tile, items, day: day(state), names: ["the lost team"], lastConfirmed: day(state) });
  const v = partyVehicle(state, p);
  if (v) v.loc = { kind: "abandoned", tile, since: state.hour };
  removeParty(state, p);
}

// ---------- player trade-route convoys ----------
export function dispatchConvoy(state, route) {
  const h = hub(state);
  const f = factionById(state, route.factionId);
  if (!f || !f.alive) return;
  const escorts = route.escortIds.map((id) => survivorById(state, id)).filter((s) => s && s.alive);
  if (!escorts.length) return log(state, `The route to ${f.name} has no escort left. End the route and set it up again with new escorts.`, "danger");
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
    const sent = p.cargo.supplies[route.sendKey] || 0;
    f.stock[route.sendKey] = (f.stock[route.sendKey] || 0) + sent;
    p.cargo.supplies[route.sendKey] = 0;
    const scale = route.sendQty ? sent / route.sendQty : 0;
    const give = Math.min(Math.floor(route.recvQty * scale), Math.floor(f.stock[route.recvKey] || 0));
    f.stock[route.recvKey] -= give;
    p.cargo.supplies[route.recvKey] = (p.cargo.supplies[route.recvKey] || 0) + give;
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
  const entered = stepAlong(state, p, p.vehicle ? 1 : 0.9);
  for (const tileId of entered) {
    // Hordes chew up whoever walks into them.
    const horde = state.hordes.find((h) => h.tile === tileId);
    if (horde) {
      p.strength *= 0.75;
      horde.size = Math.max(0, horde.size - Math.round(p.strength * 0.6));
    }
    if (p.kind === "convoy") {
      for (const r of state.factions) {
        if (!r.alive || r.type !== "raider") continue;
        if (r.bases.some((b) => state.grid.distance(b, tileId) <= 2) && state.rng.chance(0.12)) {
          r.stock.food += 15;
          r.stock.ammo += 20;
          if (state.live.has(tileId)) log(state, `${r.name} ambushed a ${factionById(state, p.owner).name} convoy near ${tileLabel(state, tileId)}.`, "danger");
          removeParty(state, p);
          return;
        }
      }
    }
  }
  if (p.strength < 1) {
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
