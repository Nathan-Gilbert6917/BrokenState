// The staging camp: how a base is founded when you have none (hardcore's first hub, hardcore-start.js; the exiles
// after losing every base, conquest.js). Like a hive build site (hives.js hiveSites), it is a place on the map that
// is built up over time.
// - Establish base (team order, any land tile you could build on): the team pitches a camp there (state.staging).
//   It lists the materials the hub takes (NEEDS); the team unloads what it carries (the same order at the camp:
//   "Unload and work on the camp"), and can leave to scavenge and come back as often as it likes.
// Three stages: the camp → a shelter (tier 0, buildings.js SHELTER: a small base you can live at) → a base (the hub,
// tier 1: the shelter's builders build it up, buildings.js hub_up). This file is the first step.
// - The stores: scrap, parts, food, water (and preserved food, which counts as food) sit at the camp. Scrap and
//   parts are used up by the building; food and water become the shelter's first stock. The workers eat their own
//   rations, and from the camp's stores only once theirs run out; a team at the camp takes food and water for the
//   road from what the stores hold beyond the needs.
// - Water must be found: the camp has no spring. Beside a river or lake (waterSource) the people there drink from it
//   and haul CAMP_WATER.river a day into the stores; anywhere else it is only what teams bring (Fetch water at a
//   shore, water found searching). The tile panel says how far the nearest water is.
// - The fire (fieldheat.js FIRE, a toggle on the camp's card): warmth, hot food and boiled water, spirits; its light
//   and smoke raise the camp's danger, most at night.
// - The work: WORK person-hours of daylight work (07:00-19:00; at night they rest and the hurt heal as in a camp).
//   Each worker adds 1 + 3% a Mechanics point an hour (× health and the Handy / Master Builder perks: buildings.js
//   buildRate); 3 workers finish the hardcore camp in about 3 days, one alone in about 9. Work goes on with what has
//   been delivered: the share of the scrap and parts in the stores caps the progress, and the hub only stands once
//   the work is done and the stores hold every need. Nobody at the camp, no progress.
// - Staying put is dangerous: everyone at the camp shares its danger (fieldheat.js campSite / CAMP_HEAT: the fire,
//   the people, vehicles parked, shooting nearby lately, the building work), one roll for trouble an hour; road
//   meetings and hordes as for any team.
// - Abandoned: nobody there for ABANDON days and the camp may be looted (a share of the stores and of the barricade
//   lost each time); empty and untouched for GONE days it is gone. A team that dies there leaves the camp standing
//   for the next one.
// - Done: the camp becomes your shelter (type "hub", tier 0: buildings.js SHELTER), bare (no buildings, no vehicle),
//   the stores its stock, the teams there its people. A camp from a save made before the tiers (no camp.to) was
//   promised the full hub and becomes one. Later outposts keep the old Build outpost order (parties.js).
// - A base you get back some other way (retaking one: conquest.js) makes the camp pointless: it is struck and what
//   was in it is left as a cache (a "Cargo left behind" site) for a team to recover.
import { SUPPLIES } from "./data.js";
import { newId, log, addCard, day, hub, skill } from "./world.js";
import { workFactor } from "./health.js";
import { buildMult } from "./skills.js";
import { recomputeOwnership } from "./factions.js";
import { markDeathSite } from "./markers.js";
import { campHealPerHour, startTask } from "./orders.js";
import { thirstAt } from "./weather.js";
import { BUILDINGS, SHELTER, isShelter } from "./buildings.js";
import { fireLit, FIRE, stagingDanger, shelterHeat } from "./fieldheat.js";
import * as Weather from "./weather.js";
import {
  partyMembers, partyTile, carried, takeSupply, tileLabel, teamName, awaitOrders, outpostName, settleInto, cargoRoom,
} from "./parties.js";
import { firstHubPending, hubFounded } from "./hardcore-start.js";
import { askBaseName } from "./basenames.js"; // the naming popup for the new shelter
import { sourceEggs, addWormWater } from "./worm.js";
import { teamWaterIn, takeTeamWater, moveWater, drawWater, keyWord, RAW } from "./water.js"; // purified and un-purified water (the camp's river water is un-purified)

export const STAGING = {
  // What the shelter (tier 0) takes, by who founds it. Hardcore's first: the camp's old cost (30 scrap, 4 parts, 15
  // food, 15 water, 108 person-hours for the full hub) split in two: the shelter here, the rest (buildings.js hub_up:
  // 18 scrap, 2 parts, 96 work-hours by the shelter's builders) to build it up into a base later. Exiles in a normal
  // game (and a hardcore hub lost later): a little less, they usually carry a base's evacuated stores.
  HARDCORE: { needs: { scrap: 15, parts: 2, food: 10, water: 10 }, work: 60 },
  EXILE: { needs: { scrap: 10, parts: 1, food: 8, water: 8 }, work: 40 },
  USED: ["scrap", "parts"],      // consumed by the building; the rest becomes the shelter's stock
  RUIN_SCRAP: 10,                // on the ruins of a burned base: 10 scrap less (salvage, as Build outpost's 15 → 5)
  DAY: [7, 19],                  // working hours (hour of day, from..to)
  CREW_CAP: 6,                   // more workers than this add nothing (they get in each other's way)
  ABANDON: 10,                   // days with nobody there before looters may come
  LOOT_CHANCE: 0.35,             // a day, once abandoned
  LOOT_SHARE: [0.3, 0.6],        // of each store taken
  LOOT_WORK: 0.1,                // of the work torn down
  GONE: 20,                      // days empty, unworked and unvisited before the camp is gone
  KEEP_DAYS: 2,                  // food and water a team keeps for the road when it unloads
  STORE_MAX: 2,                  // food and water unloaded up to this many times the need
};
// Water at the camp (no spring): beside a river or lake the people there drink from it and haul `river` a day into
// the stores (nothing while nobody is there). REACH: how far the tile panel looks for water.
export const CAMP_WATER = { river: 10, reach: 3 };
// The stages in order (the panels' "Camp → Shelter → Base").
export const STAGES = ["Camp", "Shelter", "Base"];
export const ESTABLISH_LABEL = "Establish base";
export const STORE_KEYS = ["scrap", "parts", "food", "preserved", "water", RAW];
const NEED_KEYS = ["scrap", "parts", "food", "water"];

const r1 = (v) => Math.round(v * 10) / 10;
const n0 = (v) => Math.floor((v || 0) + 1e-9);

// ---------- what the hub takes ----------
// No base at all: hardcore before the first hub, or the exiles (conquest.js).
export const noBase = (state) => !state.bases.length;
const plan = (state) => (firstHubPending(state) ? STAGING.HARDCORE : STAGING.EXILE);
// The needs for a camp on this tile (the camp's own once pitched: they do not change under it).
export function stagingNeeds(state, tile = null) {
  const camp = state.staging;
  if (camp && (tile == null || tile === camp.tile)) return camp.needs;
  const needs = { ...plan(state).needs };
  if (tile != null && state.tiles[tile] && state.tiles[tile].ruin) needs.scrap = Math.max(0, needs.scrap - STAGING.RUIN_SCRAP);
  return needs;
}
export const needText = (needs) => NEED_KEYS.filter((k) => needs[k]).map((k) => `${needs[k]} ${k}`).join(", ");
// What the stores hold toward a need (preserved food counts as food).
// Food counts the preserved food, water both kinds (water.js).
export const storeOf = (camp, k) => n0((camp.stores[k] || 0) + (k === "food" ? camp.stores.preserved || 0 : k === "water" ? camp.stores[RAW] || 0 : 0));
// Each need: { key, need, have, short, ok }.
export function stagingRows(camp) {
  return NEED_KEYS.filter((k) => camp.needs[k]).map((k) => {
    const have = storeOf(camp, k);
    return { key: k, need: camp.needs[k], have, short: Math.max(0, camp.needs[k] - have), ok: have >= camp.needs[k] };
  });
}
export const stagingMissing = (camp) => stagingRows(camp).filter((r) => !r.ok);
export const missingText = (rows) => rows.map((r) => `${r.short} ${r.key}`).join(", ");
// The share of the work the materials in the stores allow (scrap and parts, each half).
export function workCap(camp) {
  const used = STAGING.USED.filter((k) => camp.needs[k] > 0);
  if (!used.length) return camp.work;
  const f = used.reduce((a, k) => a + Math.min(1, (camp.stores[k] || 0) / camp.needs[k]), 0) / used.length;
  return camp.work * f;
}
export const stagingPct = (camp) => (camp.work > 0 ? Math.max(0, Math.min(1, camp.progress / camp.work)) : 1);
// Sprite stage on the map: 0 tarps and crates, 1 the first stakes, 2 a frame and half a barricade, 3 nearly done.
export const stagingStage = (camp) => { const f = stagingPct(camp); return f >= 0.85 ? 3 : f >= 0.5 ? 2 : f >= 0.2 ? 1 : 0; };
export const workDone = (camp) => camp.progress >= camp.work - 1e-9;
// Can the work go on right now (materials permitting)?
export const canWork = (camp) => !workDone(camp) && camp.progress < workCap(camp) - 1e-6;

// ---------- water ----------
// The nearest river or lake to a tile within CAMP_WATER.reach: { dist, kind: "river" | "lake", tile } or null. dist 1:
// beside it (a camp there drinks from it and fills its stores; a shelter there hauls SHELTER.river a day).
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
// "Water: river 1 tile away" / "No water source nearby" (the tile panel, the camp's card, the order's text).
export function waterText(state, tile) {
  const w = waterSource(state, tile);
  if (!w) return "No water source nearby";
  return `${w.kind} ${w.dist} tile${w.dist === 1 ? "" : "s"} away${w.dist <= 1 ? "" : " (fetch it from the shore)"}`;
}

// ---------- the workers ----------
export const isWorking = (state, p) => !!state.staging && p.owner === "player" && p.phase === "task" && p.task && p.task.type === "stage" && partyTile(p) === state.staging.tile;
export const campTeams = (state, camp = state.staging) => (camp ? state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && partyTile(p) === camp.tile && partyMembers(state, p).length) : []);
export const workerTeams = (state) => state.parties.filter((p) => isWorking(state, p));
const workerRate = (s) => (1 + skill(s, "mechanics") * 0.03) * workFactor(s) * buildMult(s);
// Person-hours an hour of daylight from these people (the best CREW_CAP of them).
export function crewRate(people) {
  return people.map(workerRate).sort((a, b) => b - a).slice(0, STAGING.CREW_CAP).reduce((a, v) => a + v, 0);
}
const workHours = () => STAGING.DAY[1] - STAGING.DAY[0];
const isWorkHour = (state) => { const h = state.hour % 24; return h >= STAGING.DAY[0] && h < STAGING.DAY[1]; };
// Days of work left for this many people of average skill (or the given ones), from what is left of the work.
export function daysLeft(camp, rate) {
  const left = Math.max(0, camp.work - camp.progress);
  return rate > 0 ? left / (rate * workHours()) : Infinity;
}
export const daysFor = (camp, n) => daysLeft(camp, n);

// ---------- the order ----------
// The team panel's and the orders card's option on this tile (null when none applies: you have a base).
export function establishOption(state, p, tile = partyTile(p)) {
  if (!noBase(state)) return null;
  const t = state.tiles[tile];
  if (!t || t.terrain === "water") return null;
  const camp = state.staging;
  if (camp && camp.tile === tile) {
    const deposit = depositable(state, p, camp);
    const why = deposit.length || canWork(camp) || readyToFinish(camp) || provisionable(state, p, camp).length ? null :
      workDone(camp) ? `The building is done; the stores still need ${missingText(stagingMissing(camp))}. Bring them here.` :
      `Nothing to unload, and the work waits on materials: still missing ${missingText(stagingMissing(camp))}.`;
    return { mission: "establish", label: deposit.length ? "Unload and work on the camp" : "Work on the camp", desc: workDesc(state, camp, deposit), disabled: why };
  }
  return { mission: "establish", label: ESTABLISH_LABEL, desc: establishDesc(state, tile), disabled: establishProblem(state, tile) };
}
// Why a camp cannot go on this tile (null: it can).
export function establishProblem(state, tile) {
  const t = state.tiles[tile];
  if (!t || t.terrain === "water") return "Not on water or a bridge.";
  if (t.hive) return "Not on a hive.";
  if (state.factions.some((f) => f.alive && f.bases.includes(tile)) || (t.owner != null && t.owner !== "player")) return "Another group holds this land.";
  const camp = state.staging;
  if (camp && camp.tile !== tile) return `Your staging camp is at ${tileLabel(state, camp.tile)}. Work on it there, or strike it first (Strike the camp, at the camp).`;
  return null;
}
function establishDesc(state, tile) {
  const needs = stagingNeeds(state, tile);
  const P = plan(state);
  const w = waterSource(state, tile);
  return `Pitch a staging camp here for your ${firstHubPending(state) ? "first" : "new"} home: tarps, crates and the first stakes of a barricade. Camp → Shelter → Base: it needs ${needText(needs)} brought in (as many trips as it takes; the team unloads what it carries now), then about ${r1(P.work / (3 * workHours()))} days of work for three (faster with more hands and Mechanics, nothing while nobody is there), and becomes a shelter you can live at; later your builders build it up into a base (${needText(BUILDINGS.hub_up.cost)}). The scrap and parts go into the building; the food and water become the shelter's stores. There is no spring: water: ${w ? `${waterText(state, tile)}${w.dist <= 1 ? ", the camp drinks from it" : ""}` : "no water source nearby, every drop carried in"}. The camp's fire, its people, vehicles parked there and any shooting draw the dead and raiders. Pick a place beside a river or lake, with sites to scavenge around and few of the dead.${state.tiles[tile] && state.tiles[tile].ruin ? ` On these ruins: ${STAGING.RUIN_SCRAP} scrap less (salvage).` : ""}`;
}
function workDesc(state, camp, deposit) {
  const miss = stagingMissing(camp);
  return `${deposit.length ? `Unload ${deposit.map(([k, q]) => `${q} ${k}`).join(", ")} into the camp's stores, then w` : "W"}ork on the camp until it is done or the materials run out (daylight hours; the team rests at night). A team short of food or water takes what the stores hold beyond the hub's needs (up to ${STAGING.KEEP_DAYS} days). ${miss.length ? `Still missing: ${missingText(miss)}.` : "Everything is in."} Built: ${Math.round(stagingPct(camp) * 100)}%.`;
}
// What the team would unload: all its scrap and parts, and the food and water beyond STAGING.KEEP_DAYS of rations for
// the road; while the stores are short of one, down to a single day's. Preserved food goes in first (it keeps).
// [[key, qty]].
export function depositable(state, p, camp = state.staging) {
  if (!camp) return [];
  const n = Math.max(1, partyMembers(state, p).length), th = thirstAt(state);
  // Food and water go in up to STORE_MAX × the need (the rest stays with the team; it comes into the hub's stock
  // anyway when the camp is done and the team moves in).
  const room = (k) => Math.max(0, (camp.needs[k] || 0) * STAGING.STORE_MAX - storeOf(camp, k));
  const spare = (have, keep, keepMin, short, k) => Math.min(room(k), n0(Math.max(0, have - keep, Math.min(short, have - keepMin))));
  const out = [];
  for (const k of STAGING.USED) if (n0(carried(p, k)) >= 1) out.push([k, n0(carried(p, k))]);
  const pres = carried(p, "preserved"), fresh = carried(p, "food");
  const food = spare(pres + fresh, n * STAGING.KEEP_DAYS, n, Math.max(0, (camp.needs.food || 0) - storeOf(camp, "food")), "food");
  const fromPres = Math.min(n0(pres), food);
  if (fromPres >= 1) out.push(["preserved", fromPres]);
  if (food - fromPres >= 1) out.push(["food", n0(Math.min(fresh, food - fromPres))]);
  const water = spare(teamWaterIn(p), n * STAGING.KEEP_DAYS * th, n * th, Math.max(0, (camp.needs.water || 0) - storeOf(camp, "water")), "water");
  if (water >= 1) out.push(["water", water]);
  return out.filter(([, q]) => q >= 1);
}

// What a team at the camp takes from the stores for the road: food and water up to STAGING.KEEP_DAYS of rations,
// from what the stores hold beyond the hub's needs. [[key, qty]].
export function provisionable(state, p, camp = state.staging) {
  if (!camp) return [];
  const n = Math.max(1, partyMembers(state, p).length), th = thirstAt(state);
  const out = [];
  let wantFood = n0(n * STAGING.KEEP_DAYS - carried(p, "food") - carried(p, "preserved"));
  let spareFood = Math.max(0, storeOf(camp, "food") - (camp.needs.food || 0));
  for (const k of ["food", "preserved"]) {
    const q = Math.min(wantFood, spareFood, n0(camp.stores[k]));
    if (q >= 1) { out.push([k, q]); wantFood -= q; spareFood -= q; }
  }
  const w = Math.min(n0(n * STAGING.KEEP_DAYS * th - teamWaterIn(p)), Math.max(0, storeOf(camp, "water") - (camp.needs.water || 0)));
  if (w >= 1) out.push(["water", w]);
  return out;
}
function provision(state, p, camp) {
  const got = [];
  for (const [k, q] of provisionable(state, p, camp)) {
    if (k === "water") { const d = moveWater(camp.stores, p.supplies, q); if (d.raw > 0) addWormWater(state, p, d.raw, sourceEggs(state, camp.tile)); got.push(`${q} water`); continue; } // purified first
    camp.stores[k] -= q;
    p.supplies[k] = (p.supplies[k] || 0) + q;
    got.push(`${q} ${k === "preserved" ? "preserved food" : k}`);
  }
  return got.join(", ");
}

// The order (parties.js arrive, mission "establish"): pitch the camp here or work on the one here.
export function establishArrive(state, p) {
  const tile = partyTile(p);
  let camp = state.staging;
  if (!camp || camp.tile !== tile) {
    const why = !noBase(state) ? "You have a base: found more with Build outpost." : establishProblem(state, tile);
    if (why) { awaitOrders(state, p, `${ESTABLISH_LABEL}: ${why}`, { failed: true }); return ""; }
    camp = pitchCamp(state, p, tile);
  }
  const got = deposit(state, p, camp);
  if (tryFinish(state, camp)) return "";
  const took = provision(state, p, camp);
  const done = `${got ? `Unloaded ${got}. ` : ""}${took ? `Took ${took} for the road from what the stores can spare. ` : ""}`;
  if (canWork(camp)) {
    startTask(state, p, { type: "stage", hours: null, tile });
    const left = daysLeft(camp, crewRate(partyMembers(state, p)));
    const text = `${done}${teamName(state, p)} works on the camp: ${Math.round(stagingPct(camp) * 100)}% built, about ${r1(left)} days of work left for ${partyMembers(state, p).length}.`;
    log(state, text, "info");
    return text;
  }
  const miss = stagingMissing(camp);
  awaitOrders(state, p, `${done}${workDone(camp) ? "The building is done, but" : `The camp is ${Math.round(stagingPct(camp) * 100)}% built and the work waits on materials:`} the stores still need ${missingText(miss)}.`, { failed: !done });
  return "";
}
function pitchCamp(state, p, tile) {
  const needs = stagingNeeds(state, tile);
  const P = plan(state);
  const camp = state.staging = {
    id: newId(), tile, started: day(state), startedHour: state.hour, needs, work: P.work, progress: 0,
    stores: Object.fromEntries(STORE_KEYS.map((k) => [k, 0])), first: firstHubPending(state),
    lastPresent: state.hour, lastWorked: null, workers: 0, looted: 0, name: null,
    to: 0, fire: true, // becomes a shelter (tier 0); the camp fire lit (fieldheat.js)
  };
  const text = `${teamName(state, p)} pitched a staging camp ${tileLabel(state, tile)}. ${camp.first ? "Your first shelter" : "Your new shelter"} needs ${needText(needs)} brought in, then the work. Water: ${waterText(state, tile)}.`;
  log(state, text, "good");
  return camp;
}
// Unloads what the team can spare into the stores. Returns the text ("12 scrap, 2 parts") or "".
function deposit(state, p, camp) {
  const got = [];
  for (const [k, q] of depositable(state, p, camp)) {
    if (k === "water") { // un-purified first: the team keeps its purified water for the road
      const d = takeTeamWater(p, q, { rawFirst: true });
      if (d.pure > 0) camp.stores.water = (camp.stores.water || 0) + d.pure;
      if (d.raw > 0) camp.stores[RAW] = (camp.stores[RAW] || 0) + d.raw;
      if (d.got >= 1) got.push(`${Math.floor(d.got)} water`);
      continue;
    }
    const took = Math.floor(takeSupply(p, k, q));
    if (took < 1) continue;
    camp.stores[k] = (camp.stores[k] || 0) + took;
    got.push(`${took} ${k === "preserved" ? "preserved food" : k}`);
  }
  if (got.length) log(state, `${teamName(state, p)} unloaded ${got.join(", ")} at the staging camp.`, "info");
  return got.join(", ");
}
const readyToFinish = (camp) => workDone(camp) && !stagingMissing(camp).length;

// Strike the camp (team order at the camp): the team loads what it can carry of the stores; the rest stays as a cache.
export function strikeOption(state, p, tile = partyTile(p)) {
  const camp = state.staging;
  if (!camp || camp.tile !== tile) return null;
  return { mission: "strikecamp", label: "Strike the camp", desc: `Give up on this camp: the team packs what it can carry of the stores (${storesText(camp) || "nothing in them"}); the rest is left as a cache here. The work done (${Math.round(stagingPct(camp) * 100)}%) is lost. Then you can establish a base somewhere else.`, disabled: null };
}
export function strikeArrive(state, p) {
  const camp = state.staging;
  if (!camp || camp.tile !== partyTile(p)) { awaitOrders(state, p, "There is no camp here to strike.", { failed: true }); return ""; }
  const took = [];
  for (const k of STORE_KEYS) {
    const q = n0(camp.stores[k]);
    if (q < 1) continue;
    const fit = Math.min(q, Math.floor(cargoRoom(state, p) / (SUPPLIES[k].weight || 1)));
    if (fit < 1) continue;
    p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + fit;
    camp.stores[k] -= fit;
    took.push(`${fit} ${k}`);
  }
  const left = strike(state, "struck");
  awaitOrders(state, p, `The camp is struck.${took.length ? ` The team packed ${took.join(", ")}.` : ""}${left ? ` Left as a cache here: ${left}.` : ""}`);
  return "";
}
// Removes the camp; what is left in its stores becomes a cache on its tile. Returns the cache's text.
function strike(state, why) {
  const camp = state.staging;
  if (!camp) return "";
  state.staging = null;
  const items = [];
  for (const k of STORE_KEYS) {
    const q = n0(camp.stores[k]);
    if (q >= 1) items.push({ kind: "supply", key: k, name: SUPPLIES[k].name, qty: q, value: q * SUPPLIES[k].value });
  }
  if (!items.length) return "";
  let site = state.deathSites.find((d) => d.tile === camp.tile);
  if (!site) { site = { id: newId(), tile: camp.tile, items: [], day: day(state), names: [], lastConfirmed: day(state) }; state.deathSites.push(site); }
  for (const it of items) {
    const cur = site.items.find((i) => i.kind === "supply" && i.key === it.key);
    if (cur) { cur.qty += it.qty; cur.value = cur.qty * SUPPLIES[it.key].value; } else site.items.push(it);
  }
  markDeathSite(state, site);
  if (why !== "struck") log(state, `The staging camp ${tileLabel(state, camp.tile)} is ${why}. What was in it is left there as a cache.`, "info");
  return items.map((i) => `${i.qty} ${i.key}`).join(", ");
}
export const storesText = (camp) => STORE_KEYS.filter((k) => n0(camp.stores[k]) >= 1).map((k) => `${n0(camp.stores[k])} ${keyWord(k)}`).join(", ");

// ---------- every hour (world.js tickHour, after the teams move) ----------
export function stagingHour(state) {
  if (state.hour % 24 === 0) for (const b of state.bases) if (isShelter(b)) shelterDaily(state, b);
  const camp = state.staging;
  if (!camp) return;
  if (!noBase(state)) { strike(state, "no longer needed: you have a base again"); return; }
  if (state.factions.some((f) => f.alive && f.bases.includes(camp.tile))) { strike(state, `lost: ${state.factions.find((f) => f.alive && f.bases.includes(camp.tile)).name} built on it`); return; }
  const here = campTeams(state, camp);
  if (here.length) camp.lastPresent = state.hour;
  const workers = here.filter((p) => isWorking(state, p));
  camp.workers = workers.reduce((a, p) => a + partyMembers(state, p).length, 0);
  for (const p of workers) feed(state, p, camp);
  // No water carried and none in the stores (a camp away from a river or lake): the team stops to go and find some.
  for (const p of workers) if (teamWaterIn(p) < 0.5 && storeOf(camp, "water") < 1) {
    awaitOrders(state, p, `Out of water, and the camp's stores are dry: ${waterSource(state, camp.tile) ? `fetch it from the ${waterSource(state, camp.tile).kind} (${waterText(state, camp.tile)})` : "no water source nearby: search for water (shops, diners, churches, campgrounds)"} and bring some back.`, { failed: true });
  }
  const working = workers.filter((p) => isWorking(state, p));
  workers.length = 0;
  workers.push(...working);
  if (workers.length) {
    if (isWorkHour(state)) {
      const rate = crewRate(workers.flatMap((p) => partyMembers(state, p)));
      camp.progress = Math.min(workCap(camp), camp.progress + rate);
      camp.lastWorked = state.hour;
    } else for (const p of workers) for (const s of partyMembers(state, p)) { // resting at night, by the fire if it is lit
      s.health = Math.min(100, s.health + campHealPerHour(state, p, s));
      s.mood = Math.min(100, (s.mood || 0) + (fireLit(camp) ? FIRE.campMood : FIRE.campMoodOut));
    }
    if (tryFinish(state, camp)) return;
    // Out of materials (or the building done, the stores short): the workers stop and report.
    if (!canWork(camp)) {
      const miss = stagingMissing(camp);
      for (const p of workers) {
        const took = provision(state, p, camp); // food and water for the road from what the stores can spare
        awaitOrders(state, p, `${workDone(camp) ? "The building is done, but the stores still need" : `The camp is ${Math.round(stagingPct(camp) * 100)}% built; the work waits on materials: still missing`} ${missingText(miss)}.${took ? ` The team took ${took} for the road.` : ""}`, { failed: true });
      }
    }
  }
  if (state.hour % 24 === 0) stagingDaily(state, camp);
}
// A worker team out of food or water eats from the camp's stores (a day's worth at a time). Beside a river or lake
// it drinks from it first (a day's worth when it runs low).
function feed(state, p, camp) {
  const n = partyMembers(state, p).length;
  if (besideWaterSource(state, camp.tile) && teamWaterIn(p) < (n * thirstAt(state)) / 12) {
    const q = Math.ceil(n * thirstAt(state));
    p.supplies[RAW] = (p.supplies[RAW] || 0) + q; // un-purified river water (water.js)
    addWormWater(state, p, q, sourceEggs(state, camp.tile)); // worm.js: river water on infected land (the camp fire boils it)
  }
  const food = carried(p, "food") + carried(p, "preserved"), water = teamWaterIn(p);
  if (food < n / 12) {
    for (const k of ["food", "preserved"]) {
      const q = Math.min(n0(camp.stores[k]), n);
      if (q >= 1) { camp.stores[k] -= q; p.supplies.food = (p.supplies.food || 0) + q; break; }
    }
  }
  if (water < (n * thirstAt(state)) / 12) {
    const q = Math.min(storeOf(camp, "water"), Math.ceil(n * thirstAt(state)));
    if (q >= 1) { const d = moveWater(camp.stores, p.supplies, q); if (d.raw > 0) addWormWater(state, p, d.raw, sourceEggs(state, camp.tile)); } // purified first
  }
}
// The camp's own water a day: none (no spring). Beside a river or lake, CAMP_WATER.river hauled into the stores by the
// people there (nothing while nobody is), up to STORE_MAX × the need.
export function campWater(state, camp) {
  if (!besideWaterSource(state, camp.tile) || !campTeams(state, camp).length) return 0;
  return Math.max(0, Math.min(CAMP_WATER.river, (camp.needs.water || 0) * STAGING.STORE_MAX - storeOf(camp, "water")));
}
function stagingDaily(state, camp) {
  camp.stores[RAW] = (camp.stores[RAW] || 0) + campWater(state, camp); // hauled from the river: un-purified (water.js)
  const away = (state.hour - camp.lastPresent) / 24;
  if (away >= STAGING.GONE && camp.progress <= 0.05 * camp.work && !STORE_KEYS.some((k) => k !== "water" && k !== RAW && n0(camp.stores[k]) >= 1)) {
    state.staging = null;
    log(state, `The staging camp ${tileLabel(state, camp.tile)} is gone: nothing left of it after ${Math.floor(away)} days alone.`, "danger");
    return;
  }
  if (away < STAGING.ABANDON || !state.rng.chance(STAGING.LOOT_CHANCE)) return;
  const lost = [];
  for (const k of STORE_KEYS) {
    const q = n0(camp.stores[k] * state.rng.range(STAGING.LOOT_SHARE[0], STAGING.LOOT_SHARE[1]));
    if (q >= 1) { camp.stores[k] -= q; lost.push(`${q} ${k}`); }
  }
  const torn = Math.min(camp.progress, camp.work * STAGING.LOOT_WORK);
  camp.progress -= torn;
  camp.looted = (camp.looted || 0) + 1;
  if (lost.length || torn > 0) log(state, `The staging camp ${tileLabel(state, camp.tile)} was left alone too long: ${lost.length ? `scavengers took ${lost.join(", ")}` : "scavengers picked through it"}${torn > 0 ? " and pulled down part of the barricade" : ""}.`, "danger");
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

// ---------- done: the camp becomes the shelter ----------
function tryFinish(state, camp) {
  if (!readyToFinish(camp) || !noBase(state)) return false;
  const t = state.tiles[camp.tile];
  const here = campTeams(state, camp);
  if (!here.length) return false; // nobody to move in (a finished camp waits for its people)
  const shelter = camp.to === 0; // a camp from before the tiers (no `to`) was promised the full hub
  const base = {
    id: newId(), tile: camp.tile, type: "hub", name: outpostName(state, camp.tile),
    stock: { food: 0, water: 0, fuel: 0, meds: 0, ammo: 0, parts: 0, scrap: 0, preserved: 0, jars: 0 },
    radio: false, watchtower: false, buildings: [], construction: [], armory: [],
    ...(shelter ? { tier: 0, fire: fireLit(camp) } : {}),
  };
  // The stores: scrap and parts used up by the building, the rest the hub's stock.
  for (const k of STORE_KEYS) base.stock[k] = Math.max(0, n0(camp.stores[k]) - (STAGING.USED.includes(k) ? camp.needs[k] || 0 : 0));
  if (t.ruin) { log(state, `The camp was built on the ruins of ${t.ruin.name}.`, "info"); delete t.ruin; }
  state.bases.push(base);
  askBaseName(state, base);
  state.staging = null;
  const people = here.reduce((a, p) => a + partyMembers(state, p).length, 0);
  for (const p of here) settleInto(state, p, base);
  recomputeOwnership(state);
  const days = day(state) - camp.started;
  if (camp.first && firstHubPending(state)) {
    hubFounded(state, base, `${days} day${days === 1 ? "" : "s"} after the camp went up`);
    return true;
  }
  const text = shelter
    ? `Day ${day(state)}: the staging camp is done. ${base.name} is your new shelter, ${days} day${days === 1 ? "" : "s"} after the camp went up. ${people} ${people === 1 ? "person lives" : "people live"} there. ${shelterText()}`
    : `Day ${day(state)}: the staging camp is done. ${base.name} is founded, your new hub, ${days} day${days === 1 ? "" : "s"} after the camp went up. ${people} ${people === 1 ? "person lives" : "people live"} there. It is bare: no buildings yet, a barricade of scrap and the camp's stores.`;
  log(state, text, "good");
  addCard(state, { title: "A new home", text, choices: [{ label: "OK", resolve: () => "" }] });
  return true;
}

// What a new shelter is (the founding cards).
export const shelterText = () => `A shelter (tier 0): tarps and a shack behind a scrap barricade, the camp's stores, beds for ${SHELTER.beds}. No well: water from a river or lake beside it, rain catchers, or what you bring. Only a few buildings fit (a rain catcher, a drying rack, a barricade, a farm plot) until your builders build it up into a base (Construction: ${BUILDINGS.hub_up.name}, ${needText(BUILDINGS.hub_up.cost)} and ${BUILDINGS.hub_up.hours} work-hours) for a well, walls and everything else.`;

// ---------- for the panels ----------
// The stage you are at and what the next one takes: { stage (0 camp, 1 shelter, 2 base), name, next, needs }.
// No camp and no base: stage -1.
export function tierInfo(state, base = null) {
  base = base || state.bases.find((b) => b.type === "hub") || null;
  if (base && isShelter(base)) {
    const up = BUILDINGS.hub_up;
    const queued = base.construction.find((c) => c.type === "hub_up");
    const short = Object.entries(up.cost).filter(([k, v]) => (base.stock[k] || 0) < v).map(([k, v]) => `${v - n0(base.stock[k])} ${k}`);
    return {
      stage: 1, name: "Shelter", next: "Base", queued,
      needs: queued ? `${Math.round((queued.progress / queued.hours) * 100)}% built by the builders` : `${needText(up.cost)} and ${up.hours} work-hours by the builders here (Construction: ${up.name})${short.length ? `; short ${short.join(", ")}` : "; you have the materials"}`,
    };
  }
  if (base) return { stage: 2, name: "Base", next: null, needs: "" };
  const camp = state.staging;
  if (camp) return { stage: 0, name: "Camp", next: camp.to === 0 ? "Shelter" : "Base", needs: stagingMissing(camp).length ? `still ${missingText(stagingMissing(camp))}, then the work` : workDone(camp) ? "people there to move in" : `the work (${Math.round(stagingPct(camp) * 100)}% done)` };
  return { stage: -1, name: "None", next: "Camp", needs: `${ESTABLISH_LABEL} on a good spot` };
}
export const stagesText = (stage) => STAGES.map((s, i) => (i === stage ? `[${s}]` : s)).join(" → ");
// One object for the Bases tab, the Goals line, the top bar, the alerts and the tile panel (null with a base).
export function stagingView(state) {
  if (!noBase(state)) return null;
  const camp = state.staging;
  const teams = state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && partyMembers(state, p).length);
  if (!camp) return { camp: null, needs: stagingNeeds(state), teams, first: firstHubPending(state) };
  const rows = stagingRows(camp);
  const workers = workerTeams(state);
  const crew = workers.flatMap((p) => partyMembers(state, p));
  const rate = crewRate(crew);
  const threats = campThreats(state, camp);
  return {
    camp, needs: camp.needs, teams, first: camp.first, rows, miss: rows.filter((r) => !r.ok), pct: stagingPct(camp), stage: stagingStage(camp),
    workers: crew.length, rate, left: crew.length ? daysLeft(camp, rate) : null, leftFor3: daysLeft(camp, 3), canWork: canWork(camp), done: workDone(camp),
    away: (state.hour - camp.lastPresent) / 24, present: campTeams(state, camp).length > 0, threats, capPct: camp.work > 0 ? workCap(camp) / camp.work : 1,
    danger: stagingDanger(state, camp), fire: fireLit(camp), water: waterText(state, camp.tile), riverside: besideWaterSource(state, camp.tile), tier: tierInfo(state),
  };
}
// The shelter's danger (its share of base Heat) and fire, for the base panel.
export function shelterView(state, base) {
  if (!isShelter(base)) return null;
  const h = shelterHeat(state, base);
  return { fire: fireLit(base), heat: h, water: waterText(state, base.tile), riverside: besideWaterSource(state, base.tile), tier: tierInfo(state, base) };
}
// Dangers at the camp: hordes within 2 tiles, a worker team's Heat (fieldheat.js), raiders' or outsiders' parties close.
export function campThreats(state, camp = state.staging) {
  if (!camp) return [];
  const g = state.grid, out = [];
  const seen = (tile) => !state.live || state.live.has(tile); // what your people can see (world.js updateVision)
  const hordes = state.hordes.filter((h) => g.distance(h.tile, camp.tile) <= 2 && seen(h.tile));
  if (hordes.length) out.push(`a horde of ${Math.round(hordes.reduce((a, h) => a + h.size, 0))} within ${Math.min(...hordes.map((h) => g.distance(h.tile, camp.tile)))} tile${hordes.some((h) => g.distance(h.tile, camp.tile) === 1) ? "" : "s"}`);
  const hot = campTeams(state, camp).filter((p) => (p.heat || 0) >= 60);
  if (hot.length) out.push(`Heat ${Math.round(Math.max(...hot.map((p) => p.heat)))} (staying put draws attention)`);
  if (state.parties.some((q) => q.owner !== "player" && q.kind === "raid" && q.path && g.distance(partyTile(q), camp.tile) <= 2 && seen(partyTile(q)))) out.push("raiders close by");
  if ((state.visitors || []).some((v) => v.kind === "raiders" && v.tile != null && g.distance(v.tile, camp.tile) <= 2 && seen(v.tile))) out.push("outside raiders close by");
  return out;
}
// The map's and tooltip's line for the camp.
export function stagingTip(state, id) {
  const camp = state.staging;
  if (!camp || camp.tile !== id) return "";
  const miss = stagingMissing(camp);
  if (!camp.needs) return `Staging camp: ${Math.round(stagingPct(camp) * 100)}% built`; // a timelapse frame's camp (chronicle.js)
  const d = stagingDanger(state, camp);
  return `Staging camp: ${Math.round(stagingPct(camp) * 100)}% built${miss.length ? `, needs ${missingText(miss)}` : ", everything in"}${camp.workers ? ` · ${camp.workers} at work` : ""} · fire ${fireLit(camp) ? "lit" : "out"} · water: ${waterText(state, camp.tile)}${d && !d.empty ? ` · danger +${r1(d.gain)} Heat/h (${d.text})` : ""}`;
}
