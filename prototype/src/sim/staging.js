// Camps: the lowest, barest base tier (2026-10-09, user requests: "Make camps a pseudo temp base that can be upgraded
// to bases with time and supplies but is the most barebones", and "The camp change should be for when anyone at any
// time makes a camp: remove the camp for x hours, just set up camp, and if you don't want it, strike the camp and
// leave"). The rules a camp lives by are in buildings.js (CAMP, isCamp: a tier-0 base with camp: true, so everything a
// shelter is and a little less); this file is setting one up, striking it, neglect, the hub's place among your camps,
// the panels' views, and the old staging camp's save migration.
// - Set up camp (team order, any land tile you could build on, any time): CAMP.setupHours of work, no materials. The
//   camp is a base on that tile: the team's people live there (base healing and needs, beds round the fire), its
//   vehicles are parked there, everything it carries (supplies and cargo) goes into the camp's stores and armory (the
//   people keep what they wear). The base window opens (state.campOpen, main.js). Teams come and go as at any base:
//   Enter base, Form a team, the team inventory at the base (drop off, load), Return home.
// - Establish base (no base at all: hardcore's first home, the exiles): the same camp, with its step up queued at
//   once (buildings.js camp_up: the old staging camp's 20 scrap, 2 building materials, 20 work-hours; 10 scrap less on
//   ruins) and the naming popup. Done, the camp is a shelter (tier 0); later its builders build it up into a base
//   (hub_up). Hardcore's first shelter is the founding (hardcore-start.js hubFounded).
// - Build outpost (with a hub): the same camp beside your hub with Establish the outpost (outpost_up) queued.
// - The hub: the camp that is your only home is the hub (type "hub", its step up camp_up); a camp set up while you have
//   a hub is an outpost camp (outpost_up). A base you get back some other way (retaking one: conquest.js) takes the
//   hub's place and the camp becomes an outpost camp (settleHub); a plain camp is struck by hand.
// - Strike camp (the base window, the tile panel): its people form a team on the tile (teamform.js formTeam: all of
//   them, the vehicles that run as far as drivers and seats allow, the stores and armory packed by what they can
//   carry: water and food first); what cannot be carried is left as a cache ("Cargo left behind": recover it later)
//   and the vehicles left behind are abandoned there. The camp is gone: no base left behind.
// - Neglect: a camp with nobody there (no residents, no team of yours on its tile) for ABANDON days may be looted
//   (a share of the stores and of the step up's work lost each time); empty, bare and unworked for GONE days it is
//   gone (struck, what is left a cache).
// - Water: a camp has no spring (a shelter's rules, economy.js): beside a river or lake its people haul SHELTER.river
//   a day; anywhere else only what is carried in. The fire (fieldheat.js FIRE, base.fire): warmth, hot food, boiled
//   water, spirits; its light and smoke raise the camp's Heat (fieldheat.js shelterHeat), most at night.
// AI parity: the groups' camps stay their own coarse things (groupworks.js outpost camps, hardcore-groups.js bands
// camping on the road): nothing here is on their path.
import { foodIn, packPick } from "./foods.js"; // the food packed when a camp is struck
import { SUPPLIES, GEAR, supValue } from "./data.js";
import { ROUND_SUPPLIES } from "./data-ammo.js"; // rounds by calibre: packed with the ammo when a camp is struck
import { newId, log, addCard, day, hub, atBase } from "./world.js";
import { recomputeOwnership } from "./factions.js";
import { markDeathSite, markAbandonedVehicle } from "./markers.js";
import { startTask } from "./orders.js";
import { BUILDINGS, SHELTER, CAMP, isShelter, isCamp, tierUpJob, tierUpJobFor, retypeCampJob, tierUpType, gatherRows, gatherShort, underAttack } from "./buildings.js";
import { fireLit, FIRE, shelterHeat } from "./fieldheat.js";
import { fireDayBurn } from "./woodcutting.js"; // the fire's burn a day (fire-nights): the base window's Fire row
import * as Weather from "./weather.js";
import { partyMembers, partyTile, tileLabel, teamName, awaitOrders, outpostName, settleInto, carryCapacity } from "./parties.js";
import { firstHubPending, hubFounded } from "./hardcore-start.js";
import { askBaseName } from "./basenames.js"; // the naming popup for a camp meant to grow
import { keyWord, RAW } from "./water.js";
import { formTeam, fleetPlan } from "./teamform.js";
import { isBike, isCar, MAX_VEHICLES } from "./vehicles.js";
import { itemLoad } from "./inventory.js";

export const STAGING = {
  // The step up of the camp that is your hub (buildings.js camp_up): hardcore's first and the exiles' (user numbers
  // 2026-10-09: "upgrading to shelter 20 hours 20 scrap 2 building materials"). Kept here for the panels and the
  // governor (autopilot.js roadMissing).
  // (getters: buildings.js and this file import each other)
  get HARDCORE() { return { needs: { ...BUILDINGS.camp_up.cost }, work: BUILDINGS.camp_up.hours }; },
  get EXILE() { return { needs: { ...BUILDINGS.camp_up.cost }, work: BUILDINGS.camp_up.hours }; },
  // Setting up a camp: CAMP.setupHours of work, nothing carried (the old 8 scrap and 2 hours went with the staging camp).
  get PITCH() { return { scrap: 0, hours: CAMP.setupHours }; },
  get RUIN_SCRAP() { return CAMP.ruinScrap; }, // on the ruins of a burned base: less scrap for the step up (salvage)
  ABANDON: 10,                   // days with nobody there before looters may come
  LOOT_CHANCE: 0.35,             // a day, once abandoned
  LOOT_SHARE: [0.3, 0.6],        // of each store taken
  LOOT_WORK: 0.1,                // of the step up's work torn down
  GONE: 20,                      // days empty, bare and unworked before the camp is gone
};
// Water near a camp: how far the tile panel looks for a river or lake.
export const CAMP_WATER = { get river() { return SHELTER.river; }, reach: 3 };
// The stages in order (the panels' "Camp → Shelter → Base").
export const STAGES = ["Camp", "Shelter", "Base"];
export const ESTABLISH_LABEL = "Establish base";
export const SETUP_LABEL = "Set up camp";
export const STRIKE_LABEL = "Strike camp";
const NEED_KEYS = ["scrap", "parts", "buildmat", "food", "water"];
const needWord = (k) => (k === "buildmat" ? "building materials" : k);
const r1 = (v) => Math.round(v * 10) / 10;
const n0 = (v) => Math.floor((v || 0) + 1e-9);

// ---------- what a camp takes ----------
// No base at all: hardcore before the first camp, or the exiles (conquest.js).
export const noBase = (state) => !state.bases.length;
// What the hub's step up takes on this tile (less scrap on ruins).
export function stagingNeeds(state, tile = null) {
  const needs = { ...BUILDINGS.camp_up.cost };
  if (tile != null && state.tiles[tile] && state.tiles[tile].ruin) needs.scrap = Math.max(0, needs.scrap - CAMP.ruinScrap);
  return needs;
}
export const needText = (needs) => NEED_KEYS.filter((k) => needs[k]).map((k) => `${needs[k]} ${needWord(k)}`).join(", ");

// ---------- water ----------
// The nearest river or lake to a tile within CAMP_WATER.reach: { dist, kind: "river" | "lake", tile } or null. dist 1:
// beside it (a camp or shelter there hauls SHELTER.river a day).
export function waterSource(state, tile, reach = CAMP_WATER.reach) {
  const g = state.grid;
  let best = null;
  for (const id of g.within(tile, reach)) {
    const t = state.tiles[id];
    if (!t || t.terrain !== "water" || id === tile) continue;
    const d = g.distance(tile, id);
    if (!best || d < best.dist || (d === best.dist && t.river && best.kind !== "river")) best = { dist: d, kind: t.river ? "river" : "lake", tile: id };
  }
  return best;
}
export const besideWaterSource = (state, tile) => { const w = waterSource(state, tile, 1); return !!w && w.dist <= 1; };
// "river 1 tile away" / "No water source nearby" (the tile panel, the camp's rows, the order's text).
export function waterText(state, tile) {
  const w = waterSource(state, tile);
  if (!w) return "No water source nearby";
  return `${w.kind} ${w.dist} tile${w.dist === 1 ? "" : "s"} away${w.dist <= 1 ? "" : " (fetch it from the shore)"}`;
}

// ---------- the orders ----------
// Why a camp cannot go on this tile (null: it can).
export function campProblem(state, tile) {
  const t = state.tiles[tile];
  if (!t || (t.terrain === "water" && !t.bridge)) return "Not on open water.";
  if (t.hive) return "Not on a hive.";
  if (state.bases.some((b) => b.tile === tile)) return "You already have a base here.";
  if (state.factions.some((f) => f.alive && f.bases.includes(tile)) || (t.owner != null && t.owner !== "player")) return "Another group holds this land.";
  return null;
}
export const establishProblem = campProblem;
const busyTeam = (state, p) => p.phase === "engaged" || (state.engagement && state.engagement.partyId === p.id) || (state.combat && state.combat.setup && state.combat.setup.partyId === p.id);
// Set up camp (the orders card, the team panel, the right-click menu): any team of yours that is not a convoy, caravan
// or crew. Null when it does not apply.
export function campOption(state, p, tile = partyTile(p)) {
  if (!p || p.owner !== "player" || p.kind !== "expedition" || p.caravan || p.crewRole != null) return null;
  const t = state.tiles[tile];
  if (!t || (t.terrain === "water" && !t.bridge) || state.bases.some((b) => b.tile === tile)) return null;
  const w = waterSource(state, tile);
  return {
    mission: "camp", label: SETUP_LABEL, disabled: campProblem(state, tile),
    desc: `Stop and make camp here (${CAMP.setupHours} hour, no materials): a camp is the barest base, tarps, bedrolls and a fire. The team's people live there while it stands (the hurt heal twice as fast as at a base without a hospital, they eat and drink from the camp's stores), what the team carries goes into the stores and its vehicles park there. Manage it in its base window; ${STRIKE_LABEL} there packs everyone up again as a team. It can be built up with time and materials (Construction: into ${hub(state) ? "an outpost" : "a shelter, then a base"}). Water: ${w ? waterText(state, tile) : "no river or lake nearby, only what is carried in"}. Its fire, its people and vehicles parked there draw the dead and raiders.`,
  };
}
// Establish base (no base at all: hardcore's first home, the exiles): a camp with its step up queued.
export function establishOption(state, p, tile = partyTile(p)) {
  if (!noBase(state) || !p || p.owner !== "player") return null;
  const t = state.tiles[tile];
  if (!t || t.terrain === "water") return null;
  return { mission: "establish", label: ESTABLISH_LABEL, desc: establishDesc(state, tile), disabled: establishProblem(state, tile) };
}
function establishDesc(state, tile) {
  const needs = stagingNeeds(state, tile);
  const w = waterSource(state, tile);
  return `Set up camp here for your ${firstHubPending(state) ? "first" : "new"} home (${CAMP.setupHours} hour, no materials) and start building it up: Camp → Shelter → Base. The camp is a base from the start (its people live there, the team's load goes into its stores); to become a shelter it needs ${needText(needs)} brought in and ${BUILDINGS.camp_up.hours} work-hours by its builders (Construction), and later the shelter is built up into a base (${needText(BUILDINGS.hub_up.cost)}). There is no spring: water: ${w ? `${waterText(state, tile)}${w.dist <= 1 ? ", its people haul it" : ""}` : "no water source nearby, every drop carried in"}. Pick a place beside a river or lake, with sites to scavenge around and few of the dead.${state.tiles[tile] && state.tiles[tile].ruin ? ` On these ruins: ${CAMP.ruinScrap} scrap less (salvage).` : ""}`;
}

// The orders' arrival (parties.js arrive, missions "camp", "establish", "outpost"): an hour's pitching (orders.js
// task "pitch"), then the camp stands. up: queue the step up (Establish base, Build outpost).
export function pitchArrive(state, p, mission) {
  const tile = partyTile(p);
  const why = campProblem(state, tile);
  const label = mission === "outpost" ? "Build outpost" : mission === "establish" ? ESTABLISH_LABEL : SETUP_LABEL;
  if (why) { delete p.pitched; awaitOrders(state, p, `${label}: ${why}`, { failed: true }); return ""; }
  if (!p.pitched) {
    startTask(state, p, { type: "pitch", hours: CAMP.setupHours, mission });
    return `Setting up camp (${CAMP.setupHours} hour).`;
  }
  delete p.pitched;
  const base = makeCamp(state, p, tile, { up: mission !== "camp" });
  return `${base.name}: camp set up.`;
}
// Back-compat names (tools, older callers).
export const establishArrive = (state, p) => pitchArrive(state, p, "establish");

// The camp: a tier-0 base with camp: true on the team's tile; the team moves in (parties.js settleInto: its people
// residents, its vehicles parked, its supplies and cargo in the stores and armory) and is disbanded. up: its step up
// queued (camp_up for your hub's camp, outpost_up beside a hub) and the naming popup. Returns the base.
export function makeCamp(state, p, tile, { up = false } = {}) {
  const t = state.tiles[tile];
  const hubNow = hub(state);
  const people = partyMembers(state, p);
  const base = {
    id: newId(), tile, type: hubNow ? "outpost" : "hub", name: campName(state, tile),
    stock: { water: 0, fuel: 0, meds: 0, ammo: 0, arrows: 0, parts: 0, scrap: 0, jars: 0, wood: 0, buildmat: 0, [RAW]: 0 }, // arrows, wood: every base keeps the count (a camp read arrows = undefined: farmtest 43)
    radio: false, watchtower: false, buildings: [], construction: [], armory: [],
    tier: 0, camp: true, fire: true, campDay: day(state), lastPresent: state.hour, first: firstHubPending(state) && !hubNow,
  };
  if (t.ruin) { base.ruinSalvage = true; log(state, `The camp went up on the ruins of ${t.ruin.name}.`, "info"); delete t.ruin; }
  if (up) base.construction.push(tierUpJobFor(base));
  state.bases.push(base);
  if (up) askBaseName(state, base);
  const name = teamName(state, p);
  settleInto(state, p, base);
  for (const s of people) s.role = up ? "build" : "scavenge"; // a camp meant to grow: its first job is its own step up
  recomputeOwnership(state);
  if (p.owner === "player") state.campOpen = base.id; // main.js opens its base window (once)
  const w = waterSource(state, tile);
  const job = tierUpJob(base);
  log(state, `${name} set up camp ${tileLabel(state, tile)}: ${base.name}, ${people.length} ${people.length === 1 ? "person" : "people"}.${job ? ` To build it up into ${base.type === "outpost" ? "an outpost" : "a shelter"}: ${gatherShort({ ...job, paid: {} })} brought in, then ${job.hours} work-hours by its builders (Construction).` : ""} Water: ${w ? waterText(state, tile) : "none nearby"}.`, "good");
  return base;
}
// "Calder Woods Camp" (outpostName's place, a camp's word).
function campName(state, tile) {
  if (state.tiles[tile] && state.tiles[tile].bridge) return outpostName(state, tile); // a camp on a bridge is its barricade (parties.js bridgeClosedTo)
  const base = outpostName(state, tile).replace(/ (Outpost|Bridge Barricade)( \d+)?$/, "");
  let name = `${base} Camp`;
  for (let n = 2; state.bases.some((b) => b.name === name); n++) name = `${base} Camp ${n}`;
  return name;
}

// ---------- striking a camp ----------
// Why this camp cannot be struck now ("" when it can).
export function strikeProblem(state, base) {
  if (!base || !state.bases.includes(base)) return "That camp is gone.";
  if (!isCamp(base)) return "Only a camp can be struck.";
  if (state.combat) return "Not during a battle.";
  if (underAttack(state, base)) return "Not while the camp is under attack.";
  if (state.parties.some((q) => q.owner !== "player" && q.phase === "siege" && q.target && q.target.baseId === base.id)) return "Not while the camp is besieged.";
  return "";
}
// What the team packs, best first: water and food, meds, ammo, fuel, then the rest.
const PACK_ORDER = ["water", RAW, "food", "preserved", "meds", "ammo", "fuel", "parts", "buildmat", "scrap", "jars"];
// Strike camp: its people form a team on the tile with what they can carry; the rest is a cache; the camp is gone.
// Returns { party (or null: nobody there), text } or { error }.
export function strikeCamp(state, base) {
  const why = strikeProblem(state, base);
  if (why) return { error: why };
  // What the step up has taken so far comes back into the stores (it is packed with the rest).
  for (const job of base.construction) for (const [k, q] of Object.entries(job.paid || {})) base.stock[k] = (base.stock[k] || 0) + q;
  base.construction = [];
  const people = atBase(state, base.id);
  let party = null;
  const packed = [];
  if (people.length) {
    // Vehicles: the running cars (best first) and the bikes as far as drivers and seats allow (teamform.js fleetPlan).
    const parked = state.vehicles.filter((v) => v.loc.kind === "base" && v.loc.baseId === base.id);
    const cars = parked.filter((v) => isCar(v) && v.condition > 0 && (v.fuel || 0) >= 1).sort((a, b) => b.condition - a.condition || a.id - b.id);
    const bikes = parked.filter((v) => isBike(v) && v.condition > 0);
    let ids = [...cars.slice(0, MAX_VEHICLES), ...(bikes.length ? [bikes[0]] : [])].map((v) => v.id);
    while (ids.length && fleetPlan(state, base, null, ids, people.length).problem) ids = ids.slice(0, -1);
    if (ids.length > MAX_VEHICLES) ids = ids.slice(0, MAX_VEHICLES);
    const plan = fleetPlan(state, base, null, ids, people.length);
    let room = carryCapacity(state, people, plan.fleet || null);
    const supplies = {};
    const rounds = Object.keys(base.stock).filter((k) => ROUND_SUPPLIES[k] && !PACK_ORDER.includes(k)).sort((a, b) => (base.stock[b] || 0) - (base.stock[a] || 0) || (a < b ? -1 : 1)); // rounds by calibre (ammo.js) where "ammo" stands, most first
    const foodOrder = Object.keys(packPick(state, base, foodIn(base.stock), { days: 7 })); // foods.js: what keeps and weighs least first
    const order = PACK_ORDER.flatMap((k) => (k === "ammo" ? [k, ...rounds] : k === "food" ? foodOrder : k === "preserved" ? [] : [k]));
    for (const k of [...order, ...Object.keys(base.stock).filter((k) => !order.includes(k))]) {
      const w = SUPPLIES[k] ? SUPPLIES[k].weight : 0;
      const have = n0(base.stock[k]);
      if (have < 1 || !SUPPLIES[k]) continue;
      const q = w > 0 ? Math.min(have, Math.floor((room + 1e-9) / w)) : have;
      if (q < 1) continue;
      supplies[k] = q;
      room -= q * w;
    }
    const items = [];
    for (const it of [...base.armory].sort((a, b) => ((GEAR[b.key] && GEAR[b.key].value) || 0) - ((GEAR[a.key] && GEAR[a.key].value) || 0))) {
      const kg = itemLoad(it);
      if (kg > room + 1e-9) continue;
      items.push(it);
      room -= kg;
    }
    const res = formTeam(state, { baseId: base.id, memberIds: people.map((s) => s.id), vehicleIds: ids, supplies, cargo: items });
    if (res.error) return { error: `${STRIKE_LABEL}: ${res.error}` };
    party = res.party;
    packed.push(...Object.entries(supplies).map(([k, q]) => `${q} ${keyWord(k)}`), ...(items.length ? [`${items.length} item${items.length === 1 ? "" : "s"}`] : []));
  }
  const left = removeCamp(state, base, "struck");
  const text = `${base.name} is struck.${party ? ` ${teamName(state, party)} packed ${packed.join(", ") || "nothing"} and waits on the tile for orders.` : ""}${left ? ` Left as a cache here: ${left}.` : ""}`;
  log(state, text, "info");
  if (party) awaitOrders(state, party, text, { quiet: "log" });
  return { party, text };
}
// Removes a camp: what is left in its stores and armory becomes a cache on its tile, vehicles still parked there are
// abandoned on it, teams based there go to the hub. Returns the cache's text.
export function removeCamp(state, base, why) {
  const i = state.bases.indexOf(base);
  if (i < 0) return "";
  const items = [];
  for (const [k, v] of Object.entries(base.stock)) {
    const q = n0(v);
    if (q >= 1 && SUPPLIES[k]) items.push({ kind: "supply", key: k, name: SUPPLIES[k].name, qty: q, value: q * supValue(k) });
  }
  for (const it of base.armory) if (it) items.push({ kind: "gear", key: it.key, name: it.name, item: it, value: (GEAR[it.key] && GEAR[it.key].value) || 0 });
  for (const v of state.vehicles) {
    if (v.loc.kind !== "base" || v.loc.baseId !== base.id) continue;
    v.loc = { kind: "abandoned", tile: base.tile, since: state.hour };
    markAbandonedVehicle(state, v, `left at ${base.name}`);
  }
  state.bases.splice(i, 1);
  for (const job of state.supplyRuns || []) if ((job.originId === base.id || job.destId === base.id) && job.status !== "done" && job.status !== "disbanded") { job.paused = true; job.lastResult = `Day ${day(state)}: ${base.name} was ${why}`; }
  settleHub(state);
  for (const p of state.parties) if (p.owner === "player" && p.homeBaseId === base.id) p.homeBaseId = hub(state) ? hub(state).id : null;
  if (Array.isArray(state.nameAsk)) state.nameAsk = state.nameAsk.filter((x) => x !== base.id);
  if (state.campOpen === base.id) delete state.campOpen;
  recomputeOwnership(state);
  if (!items.length) return "";
  let site = state.deathSites.find((d) => d.tile === base.tile);
  if (!site) { site = { id: newId(), tile: base.tile, items: [], day: day(state), names: [], lastConfirmed: day(state) }; state.deathSites.push(site); }
  for (const it of items) {
    const cur = it.kind === "supply" ? site.items.find((x) => x.kind === "supply" && x.key === it.key) : null;
    if (cur) { cur.qty += it.qty; cur.value = cur.qty * supValue(it.key); } else site.items.push(it);
  }
  markDeathSite(state, site);
  const sup = items.filter((x) => x.kind === "supply").map((x) => `${x.qty} ${keyWord(x.key)}`);
  const gear = items.filter((x) => x.kind === "gear").length;
  return [...sup, ...(gear ? [`${gear} item${gear === 1 ? "" : "s"}`] : [])].join(", ");
}

// ---------- the hub among your camps ----------
// The camp that is your hub gives the hub's place to a real base of yours (a base retaken or occupied: conquest.js,
// occupy.js) and becomes an outpost camp; with no hub left, the nearest base (a camp only when nothing else is) is.
export function settleHub(state) {
  const h = hub(state);
  if (h && isCamp(h)) {
    const real = state.bases.find((b) => !isCamp(b));
    if (!real) return;
    real.type = "hub";
    h.type = "outpost";
    retypeCampJob(h);
    log(state, `${real.name} is your hub now; ${h.name} is an outpost camp.`, "info");
    recomputeOwnership(state);
    return;
  }
  if (h || !state.bases.length) return;
  const b = [...state.bases].sort((x, y) => isCamp(x) - isCamp(y) || x.id - y.id)[0];
  b.type = "hub";
  if (isCamp(b)) retypeCampJob(b);
  log(state, `${b.name} is your hub now.`, "info");
  recomputeOwnership(state);
}

// ---------- every hour (world.js tickHour) ----------
// Someone at the camp: a resident, or a team of yours on its tile.
export const campPresent = (state, base) => atBase(state, base.id).length > 0 || state.parties.some((p) => p.owner === "player" && partyTile(p) === base.tile && partyMembers(state, p).length);
export function campsHour(state) {
  if (state.hour % 24 === 0) for (const b of state.bases) if (isShelter(b)) shelterDaily(state, b);
  settleHub(state);
  for (const base of [...state.bases]) {
    if (!isCamp(base)) continue;
    if (campPresent(state, base)) base.lastPresent = state.hour;
    else if (base.lastPresent == null) base.lastPresent = state.hour;
    if (state.hour % 24 === 0) campDaily(state, base);
  }
}
// A camp left alone: looted after ABANDON days, gone after GONE days empty, bare and unworked.
function campDaily(state, base) {
  const away = (state.hour - base.lastPresent) / 24;
  const job = tierUpJob(base);
  const worked = job && job.progress > 0.05 * job.hours;
  const stocked = Object.entries(base.stock).some(([k, v]) => k !== "water" && k !== RAW && n0(v) >= 1) || base.armory.length > 0;
  if (away >= STAGING.GONE && !worked && !stocked && !base.buildings.length) {
    const left = removeCamp(state, base, "gone");
    log(state, `${base.name} ${tileLabel(state, base.tile)} is gone: nothing left of it after ${Math.floor(away)} days alone.${left ? ` (${left} left lying there.)` : ""}`, "danger");
    return;
  }
  if (away < STAGING.ABANDON || !state.rng.chance(STAGING.LOOT_CHANCE)) return;
  const lost = [];
  for (const k of Object.keys(base.stock)) {
    const q = n0((base.stock[k] || 0) * state.rng.range(STAGING.LOOT_SHARE[0], STAGING.LOOT_SHARE[1]));
    if (q >= 1) { base.stock[k] -= q; lost.push(`${q} ${keyWord(k)}`); }
  }
  if (base.armory.length && state.rng.chance(0.5)) { const it = base.armory.splice(state.rng.int(0, base.armory.length - 1), 1)[0]; if (it) lost.push(it.name.toLowerCase()); }
  const torn = job ? Math.min(job.progress, job.hours * STAGING.LOOT_WORK) : 0;
  if (job) job.progress -= torn;
  base.looted = (base.looted || 0) + 1;
  if (lost.length || torn > 0) log(state, `${base.name} ${tileLabel(state, base.tile)} was left alone too long: ${lost.length ? `scavengers took ${lost.join(", ")}` : "scavengers picked through it"}${torn > 0 ? " and pulled down part of the work" : ""}.`, "danger");
}

// ---------- the shelter, once a day ----------
// Its fire (fieldheat.js FIRE): everyone living there +FIRE.shelterMood a day with it lit; with it out in the cold,
// FIRE.coldMood. (Its warmth and boiled water: health.js baseOnsets; its light and smoke: base Heat, hordes.js.)
function shelterDaily(state, base) {
  const w = Weather.weather ? Weather.weather(state) : null;
  const cold = !!w && w.lo <= FIRE.coldAt;
  const d = fireLit(base) ? FIRE.shelterMood : cold ? FIRE.coldMood : 0;
  if (!d) return;
  for (const s of state.survivors) if (s.alive && s.location.kind === "base" && s.location.baseId === base.id) s.mood = Math.max(0, Math.min(100, (s.mood || 0) + d));
}

// ---------- the step up into a shelter: the founding ----------
// buildings.js upgradeShelter calls this when the camp that is your hub becomes a shelter: hardcore's first home is
// founded (hardcore-start.js hubFounded); anyone else's "A new home" card.
export function campBecameShelter(state, base) {
  const days = day(state) - (base.campDay || day(state));
  const when = `${days} day${days === 1 ? "" : "s"} after the camp went up`;
  if (firstHubPending(state)) { hubFounded(state, base, when); return; }
  const people = atBase(state, base.id).length;
  const text = `Day ${day(state)}: ${base.name} is your new shelter, ${when}. ${people} ${people === 1 ? "person lives" : "people live"} there. ${shelterText()}`;
  addCard(state, { title: "A new home", text, choices: [{ label: "OK", resolve: () => "" }] });
}

// What a new shelter is (the founding cards).
export const shelterText = () => `A shelter (tier 0): tarps and a shack behind a scrap barricade, the camp's stores, beds for ${SHELTER.beds}. No well: water from a river or lake beside it, rain catchers, or what you bring. Only a few buildings fit (a rain catcher, a drying rack, a barricade, a farm plot) until your builders build it up into a base (Construction: ${BUILDINGS.hub_up.name}, ${needText(BUILDINGS.hub_up.cost)} and ${BUILDINGS.hub_up.hours} work-hours) for a well, walls and everything else.`;

// ---------- for the panels ----------
// The stage a base is at and what the next one takes: { stage (0 camp, 1 shelter, 2 base), name, next, needs, queued }.
// No base at all: stage -1.
export function tierInfo(state, base = null) {
  base = base || hub(state) || state.bases[0] || null;
  if (!base) return { stage: -1, name: "None", next: "Camp", needs: `${ESTABLISH_LABEL} (or ${SETUP_LABEL}) on a good spot` };
  if (isShelter(base)) {
    const type = tierUpType(base), up = BUILDINGS[type];
    const queued = tierUpJob(base);
    const camp = isCamp(base);
    const cost = queued ? Object.fromEntries(gatherRows(queued).map((r) => [r.key, r.need])) : (base.ruinSalvage ? tierUpJobFor(base).cost : null) || up.cost;
    const short = Object.entries(cost).filter(([k, v]) => (base.stock[k] || 0) < v).map(([k, v]) => `${v - n0(base.stock[k])} ${k}`);
    return {
      stage: camp ? 0 : 1, name: camp ? (base.type === "outpost" ? "Outpost camp" : "Camp") : "Shelter", next: base.type === "outpost" ? "Outpost" : camp ? "Shelter" : "Base", queued,
      needs: queued ? `${Math.round((queued.progress / queued.hours) * 100)}% built by the builders${gatherShort(queued) ? `; still ${gatherShort(queued)} to come in` : ""}` : `${needText(cost)} and ${up.hours} work-hours by the builders here (Construction: ${up.name})${short.length ? `; short ${short.join(", ")}` : "; you have the materials"}`,
    };
  }
  return { stage: 2, name: base.type === "hub" ? "Base" : "Outpost", next: null, needs: "" };
}
export const stagesText = (stage) => STAGES.map((s, i) => (i === stage ? `[${s}]` : s)).join(" → ");
// The road with no base at all (ui/hardcore.js: the Bases tab, the Goals line, the top bar, the alerts): null with a base.
export function stagingView(state) {
  if (!noBase(state)) return null;
  const teams = state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && partyMembers(state, p).length);
  return { camp: null, needs: stagingNeeds(state), teams, first: firstHubPending(state) };
}
// A tier-0 base's rows for the base window (ui/ui.js): its fire, Heat, water and stage; with a camp, who is there, how
// long it has been alone and the strike button's state.
export function shelterView(state, base) {
  if (!isShelter(base)) return null;
  const h = shelterHeat(state, base);
  const v = { fire: fireLit(base), burn: fireDayBurn(state, base), heat: h, water: waterText(state, base.tile), riverside: besideWaterSource(state, base.tile), tier: tierInfo(state, base), camp: isCamp(base) };
  if (v.camp) {
    v.people = atBase(state, base.id);
    v.teams = state.parties.filter((p) => p.owner === "player" && partyTile(p) === base.tile && partyMembers(state, p).length);
    v.away = (state.hour - (base.lastPresent ?? state.hour)) / 24;
    v.strike = strikeProblem(state, base);
    v.looted = base.looted || 0;
  }
  return v;
}
// The camp on a tile (or null).
export const campAt = (state, tile) => state.bases.find((b) => b.tile === tile && isCamp(b)) || null;
// The map's tooltip line for a camp.
export function stagingTip(state, id) {
  const b = campAt(state, id);
  if (!b) return "";
  const job = tierUpJob(b);
  return `${b.name} (camp): ${atBase(state, b.id).length} there${job ? ` · building up ${Math.round((job.progress / job.hours) * 100)}%${gatherShort(job) ? `, needs ${gatherShort(job)}` : ""}` : ""} · fire ${fireLit(b) ? "lit" : "out"} · water: ${waterText(state, b.tile)}`;
}

// ---------- saves from before camps were bases ----------
// state.staging (the old staging camp, not a base) becomes the camp that is your hub: its stores its stock, its work
// and the scrap and building materials it took the step up's (camp_up, scaled to its hours), its fire; teams working
// or waiting on its tile move in. Tier-0 outposts (outpost camps) are camps. Called by save.js on load.
export function migrateStaging(state) {
  for (const b of state.bases || []) if (b.tier === 0 && b.type === "outpost" && b.camp == null) b.camp = true;
  const old = state.staging;
  if (old === undefined) return;
  delete state.staging;
  if (!old || old.tile == null || !state.tiles[old.tile]) return;
  if (state.bases.some((b) => b.tile === old.tile)) return;
  const hubNow = hub(state);
  const base = {
    id: old.id || newId(), tile: old.tile, type: hubNow ? "outpost" : "hub", name: campName(state, old.tile),
    stock: { water: 0, fuel: 0, meds: 0, ammo: 0, arrows: 0, parts: 0, scrap: 0, jars: 0, wood: 0, buildmat: 0, [RAW]: 0 }, // arrows, wood: every base keeps the count (a camp read arrows = undefined: farmtest 43)
    radio: false, watchtower: false, buildings: [], construction: [], armory: [],
    tier: 0, camp: true, fire: old.fire !== false, campDay: old.started || day(state), lastPresent: old.lastPresent ?? state.hour, first: !!old.first,
  };
  for (const [k, v] of Object.entries(old.stores || {})) if (Number.isFinite(v) && v > 0) base.stock[k] = (base.stock[k] || 0) + v;
  if (old.to === 0 || old.to == null) {
    const job = tierUpJobFor(base);
    const cost = job.cost || BUILDINGS[job.type].cost;
    for (const [k, need] of Object.entries(cost)) { const take = Math.min(need, n0(base.stock[k])); if (take > 0) { base.stock[k] -= take; job.paid[k] = take; } }
    if (old.work > 0) job.progress = Math.min(job.hours, (old.progress / old.work) * job.hours);
    base.construction.push(job);
  }
  if (state.bases.some((b) => b.id === base.id)) base.id = newId();
  state.bases.push(base);
  for (const p of [...state.parties]) {
    if (p.owner !== "player" || p.kind === "convoy" || partyTile(p) !== old.tile || !partyMembers(state, p).length) continue;
    if (p.phase === "task" && p.task && p.task.type === "stage") p.task = null;
    if (p.phase === "task" || p.phase === "waiting") { const ppl = partyMembers(state, p); settleInto(state, p, base); for (const s of ppl) s.role = "build"; continue; } // they were working on it
  }
  for (const p of state.parties) if (p.phase === "task" && p.task && p.task.type === "stage") { p.task = null; p.phase = "waiting"; }
  recomputeOwnership(state);
}
