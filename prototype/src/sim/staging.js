// Camps: the lowest, barest base tier (2026-10-09, user requests: "Make camps a pseudo temp base that can be upgraded
// to bases with time and supplies but is the most barebones", and "The camp change should be for when anyone at any
// time makes a camp: remove the camp for x hours, just set up camp, and if you don't want it, strike the camp and
// leave"). The rules a camp lives by are in buildings.js (CAMP, isCamp: a tier-0 base with camp: true, so everything a
// shelter is and a little less); this file is setting one up, striking it, neglect, the hub's place among your camps,
// the panels' views, and the old staging camp's save migration.
// - Tents (tents.js): every bag the team brought is pitched (beds under cover, storage out of the weather); Strike camp
//   packs them back into bags first, a camp removed any other way leaves them in its cache; bags in its armory go up
//   daily while someone sleeps rough.
// - Set up camp (team order, any land tile you could build on, any time): its camp fire takes CAMP.fireCost (wood and stone) carried (fireCostProblem; the user's request 2026-10-23). Where on the tile's 250 × 250
//   map it goes is picked when the team gets there (the user's requests 2026-10-22: "choose where in the 250 x 250
//   with a highlighted 10x10 to start ... set up camp with a camp fire", then "reduce to 5x5 with camp site in the
//   middle"; askSite, ui/campsite.js; the game's own spot for the governor: basemap.js defaultSite). The work is the
//   camp fire (CAMP.fireHours) and clearing the 5 × 5 round it (basescatter.js SITE, CLEAR), shared by the team
//   (siteSetup: "the time to set up camp is based on build time for campfire and clearing all in the 5x5 zone"); what
//   the land there gives (wood from the trees, scrap from the crates and wrecks) comes into the camp's stores when it
//   stands (basemap.js clearCampSite). All of that on a scouted tile (a Survey's stamp); on one never scouted the
//   order says so and the camp goes up blind, or the team scouts first (the user's request 2026-10-23: campscout.js).
//   The camp is a base on
//   that tile: the team's people live there (base healing and needs, beds round the fire), its vehicles are parked there, everything it carries (supplies and cargo) goes into the camp's stores and armory (the
//   people keep what they wear). The base window opens (state.campOpen, main.js). Teams come and go as at any base:
//   Enter base, Form a team, the team inventory at the base (drop off, load), Return home.
// - Establish base (no base at all: hardcore's first home, the exiles): the same camp, meant to grow (base.grow), and
//   the naming popup; its step up (buildings.js camp_up: the old staging camp's 20 scrap, 2 building materials, 20
//   work-hours; 10 scrap less on ruins) is picked from its Build list and placed by the player (the user's request
//   2026-10-23; the governor's is queued at once). Done, the camp is a shelter (tier 0); later its builders build it up into a base
//   (hub_up). Hardcore's first shelter is the founding (hardcore-start.js hubFounded).
// - Build outpost (with a hub): the same camp beside your hub, its Outpost house (outpost_up) placed from the Build list.
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
import { partyMembers, partyTile, tileLabel, teamName, awaitOrders, outpostName, settleInto, carryCapacity, carried, takeSupply } from "./parties.js";
import { firstHubPending, hubFounded } from "./hardcore-start.js";
import { CRAWL_WHY } from "./startpick.js"; // a town's or a city's crawl tile: no base there
import { crawlTile } from "./citycrawl.js"; // (call-time only)
import { askBaseName } from "./basenames.js"; // the naming popup for a camp meant to grow
import { keyWord, RAW } from "./water.js";
import { formTeam, fleetPlan } from "./teamform.js";
import { isBike, isCar, MAX_VEHICLES } from "./vehicles.js";
import { itemLoad } from "./inventory.js";
import { defaultSite, siteProblem, siteYield, clearCampSite, BASE_GRID } from "./basemap.js"; // the camp's own spot on its 250 × 250 map, its 5 × 5 cleared (call-time only)
import { SITE } from "./basescatter.js";
import { siteInfo, pickWords } from "./siteinfo.js"; // the spot's facts: why the game picked its own (call-time only)
import { clearSiteFirst, threatWords } from "./siteclear.js"; // the dead at a town's, a city's or an infected tile's camp spot cleared first
import { tileScouted, scoutOrBlind, blindCamp, groundsHour, blindSite } from "./campscout.js"; // scouted first, or set up blind: the dead on the grounds (2026-10-23)
import { isChopTool, bestChop } from "./woodcutting.js"; // a cutting tool on the team fells the spot's trees quicker (call-time only)
import { pitchArmoryBags, strikeTents, campTentsDaily, isTentBag, tentsText, tentBeds } from "./tents.js"; // tent bags: a quicker camp, beds under cover, struck back into bags

export const STAGING = {
  // The step up of the camp that is your hub (buildings.js camp_up): hardcore's first and the exiles' (user numbers
  // 2026-10-09: "upgrading to shelter 20 hours 20 scrap 2 building materials"). Kept here for the panels and the
  // governor (autopilot.js roadMissing).
  // (getters: buildings.js and this file import each other)
  get HARDCORE() { return { needs: { ...BUILDINGS.camp_up.cost }, work: BUILDINGS.camp_up.hours }; },
  get EXILE() { return { needs: { ...BUILDINGS.camp_up.cost }, work: BUILDINGS.camp_up.hours }; },
  // Setting up a camp: nothing carried; at least the camp fire's work (siteSetup: the clearing of the spot on top).
  get PITCH() { return { scrap: 0, hours: CAMP.fireHours }; },
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
const NEED_KEYS = ["scrap", "parts", "buildmat", "wood", "stone", "food", "water"]; // wood, stone: the step up's wood and the camp fire's (CAMP.fireCost)
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
  if (crawlTile(t)) return CRAWL_WHY; // citycrawl.js: no base on a town's or a city's crawl tile (2026-10-23; elsewhere in a town the dead are cleared first: siteclear.js)
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
    mission: "camp", label: SETUP_LABEL, disabled: campProblem(state, tile) || fireCostProblem(state, p),
    desc: `Stop and make camp here (its camp fire takes ${needText(CAMP.fireCost)} carried; on getting there you pick its spot on the tile's ${BASE_GRID} × ${BASE_GRID} map; the team builds its camp fire and clears the ${SITE.SIZE} × ${SITE.SIZE} round it, about ${durText(campPitchHours(state, p, tile))} on the middle of this tile, and what the land there gives goes into its stores): a camp is the barest base, tarps, bedrolls and a fire, and the tents the team carries (beds under cover, storage out of the weather).${threatWords(state, tile) && tileScouted(state, tile, p) ? ` The dead: ${threatWords(state, tile)}.` : ""} The team's people live there while it stands (the hurt heal twice as fast as at a base without a hospital, they eat and drink from the camp's stores), what the team carries goes into the stores and its vehicles park there. Manage it in its base window; ${STRIKE_LABEL} there packs everyone up again as a team. It can be built up with time and materials (Construction: into ${hub(state) ? "an outpost" : "a shelter, then a base"}). Water: ${w ? waterText(state, tile) : "no river or lake nearby, only what is carried in"}. Its fire, its people and vehicles parked there draw the dead and raiders.`,
  };
}
// Establish base (no base at all: hardcore's first home, the exiles): a camp meant to grow (its step up placed by hand).
export function establishOption(state, p, tile = partyTile(p)) {
  if (!noBase(state) || !p || p.owner !== "player") return null;
  const t = state.tiles[tile];
  if (!t || t.terrain === "water") return null;
  return { mission: "establish", label: ESTABLISH_LABEL, desc: establishDesc(state, tile, p), disabled: establishProblem(state, tile) || fireCostProblem(state, p) };
}
function establishDesc(state, tile, p = null) {
  const needs = stagingNeeds(state, tile);
  const w = waterSource(state, tile);
  return `Set up camp here for your ${firstHubPending(state) ? "first" : "new"} home (its camp fire takes ${needText(CAMP.fireCost)} carried; you pick its spot on the tile's map; the team builds the camp fire and clears the ${SITE.SIZE} × ${SITE.SIZE} round it, its wood and scrap into the stores, the time by what stands there) and start building it up: Camp → Shelter → Base. The camp is a base from the start (its people live there, the team's load goes into its stores); to become a shelter it needs its ${BUILDINGS.camp_up.name.toLowerCase()} (pick it from the Build list and place it on the build map), ${needText(needs)} brought in and ${BUILDINGS.camp_up.hours} work-hours by its builders (Construction), and later the shelter is built up into a base (${needText(BUILDINGS.hub_up.cost)}). There is no spring: water: ${w ? `${waterText(state, tile)}${w.dist <= 1 ? ", its people haul it" : ""}` : "no water source nearby, every drop carried in"}. Pick a place beside a river or lake, with sites to scavenge around and few of the dead.${threatWords(state, tile) && tileScouted(state, tile, p) ? ` Here: ${threatWords(state, tile)}.` : ""}${state.tiles[tile] && state.tiles[tile].ruin ? ` On these ruins: ${CAMP.ruinScrap} scrap less (salvage).` : ""}`;
}

// The orders' arrival (parties.js arrive, missions "camp", "establish", "outpost"): the camp's spot asked for (askSite:
// the window holds the clock), the pitching (orders.js task "pitch": siteSetup's hours, set again when the spot is
// picked), then the camp stands. up: a camp meant to grow (Establish base, Build outpost: its step up placed by hand).
export function pitchArrive(state, p, mission) {
  const tile = partyTile(p);
  const why = campProblem(state, tile);
  const label = mission === "outpost" ? "Build outpost" : mission === "establish" ? ESTABLISH_LABEL : SETUP_LABEL;
  if (why) { delete p.pitched; awaitOrders(state, p, `${label}: ${why}`, { failed: true }); return ""; }
  const fire = !p.pitched && fireCostProblem(state, p);
  if (fire) { awaitOrders(state, p, `${label}: ${fire}.`, { failed: true }); return ""; }
  if (!p.pitched) {
    // campscout.js (the user's request 2026-10-23): an unscouted tile is surveyed first (Scout first) or the camp goes
    // up blind (the game's dice for its spot, nobody asked, nothing fought first: the dead stay out on its grounds).
    const how = scoutOrBlind(state, p, tile, mission);
    if (how === "scouting") { const text = p.scoutText; delete p.scoutText; return text; }
    const blind = how === "blind";
    const hours = campPitchHours(state, p, tile);
    if (!blind) askSite(state, p);
    startTask(state, p, { type: "pitch", hours, mission });
    // Nobody to ask (the autopilot, a spot already picked): the dead at the spot cleared first (siteclear.js).
    const fight = !blind && !(state.siteAsk || []).includes(p.id) && clearSiteFirst(state, p, campSiteFor(state, p, tile));
    return fight && !(p.task && p.task.type === "pitch" && p.phase === "task") ? "" : `Setting up camp${blind ? " blind" : ""} (${durText(hours)}: the camp fire and clearing the ${SITE.SIZE} × ${SITE.SIZE} round it).`;
  }
  delete p.pitched;
  const blind = p.campBlind === tile;
  delete p.campBlind;
  const base = makeCamp(state, p, tile, { up: mission !== "camp" });
  if (blind) blindCamp(state, base); // campscout.js: the dead on its grounds, the map past the camp unknown
  return `${base.name}: camp set up.`;
}
// Back-compat names (tools, older callers).
export const establishArrive = (state, p) => pitchArrive(state, p, "establish");

// ---------- the camp's spot (the user's request 2026-10-22) ----------
// A team of yours about to set up camp asks where on the tile's 250 × 250 map (state.siteAsk: party ids, the window
// ui/campsite.js; it holds the clock). The answer is p.campAt ([x, y] from the map's middle: the fire in the middle of
// the 5 × 5; the pitching's hours set again for it: setHours); a team with nobody to ask (the governor's, a pick put off, a spot that no longer takes the camp) gets the
// game's own (basemap.js defaultSite).
export function askSite(state, p) {
  if (!p || p.owner !== "player" || state.autopilot || (p.campAt && !siteProblem(state, partyTile(p), p.campAt))) return;
  if (!Array.isArray(state.siteAsk)) state.siteAsk = [];
  if (!state.siteAsk.includes(p.id)) state.siteAsk.push(p.id);
}
// The team waiting for its spot (the first still pitching on its tile), or null; stale asks are dropped.
export function pendingSite(state) {
  if (!Array.isArray(state.siteAsk) || !state.siteAsk.length) return null;
  state.siteAsk = state.siteAsk.filter((id) => { const p = state.parties.find((q) => q.id === id); return !!p && !!p.task && p.task.type === "pitch"; });
  const id = state.siteAsk[0];
  return id == null ? null : state.parties.find((q) => q.id === id) || null;
}
/** The spot picked (map coordinates of the fire): "" or why not. @param {any} state @param {any} p @param {number[]} at */
export function pickSite(state, p, at) {
  if (!p) return "That team is gone.";
  const why = siteProblem(state, partyTile(p), at);
  if (why) return why;
  p.campAt = [at[0], at[1]];
  siteDone(state, p);
  setHours(state, p);
  clearSiteFirst(state, p, p.campAt); // siteclear.js: the dead there cleared first
  return "";
}
// Put off: the game's own spot (defaultSite), its hours, and why it was picked in the log (siteinfo.js pickWords).
export function autoSite(state, p) {
  if (!p) return;
  delete p.campAt;
  siteDone(state, p);
  setHours(state, p);
  const tile = partyTile(p), info = siteInfo(state, p, tile, campSiteFor(state, p, tile));
  if (info.ok) log(state, `${teamName(state, p)} at ${tileLabel(state, tile)}: ${pickWords(info)}`, "info");
  clearSiteFirst(state, p, campSiteFor(state, p, partyTile(p)));
}
// The pitching under way takes the hours of the spot it is for.
function setHours(state, p) {
  if (p.task && p.task.type === "pitch") p.task.hours = campPitchHours(state, p, partyTile(p));
}

// ---------- the setup's work (the user's request 2026-10-22) ----------
// "The time to set up camp is based on build time for campfire and clearing all in the 5x5 zone": the camp fire's
// CAMP.fireHours and the clearing of every piece of the land with a cell in the SITE square (basescatter.js CLEAR: a
// tree 4 work-hours, a bush half an hour; a tree, a log or a stump CLEAR.NO_TOOL as long with no cutting tool on the
// team, and a quarter of its wood: basescatter.js SITE.NO_TOOL_WOOD), shared by the team's people, a work-hour an hour
// each. { at, work (work-hours), workers, hours (the time, to the quarter hour), clear (the clearing's work-hours), get
// (what it gives), n (pieces cleared), tool }. withTool: true / false to ask what it would be with or without one.
export function siteSetup(state, p, tile, at = null, withTool = null) {
  const spot = at || campSiteFor(state, p, tile);
  const tool = withTool == null ? teamChopTool(state, p) : !!withTool;
  const y = siteYield(state, tile, spot, tool);
  const workers = Math.max(1, p ? partyMembers(state, p).length : 1);
  const work = CAMP.fireHours + y.hours;
  return { at: spot, work: r1(work), workers, hours: Math.max(0.25, Math.ceil((work / workers) * 4 - 1e-9) / 4), clear: y.hours, get: y.get, n: y.n, tool };
}
// Hours the team takes to set up camp on its tile (its spot picked, else the game's own). The planner's estimates
// (parties.js pitchHoursFor) read it for the tile the team is going to.
export const campPitchHours = (state, p, tile = p ? (p.dest != null ? p.dest : partyTile(p)) : null) => (tile == null ? CAMP.fireHours : siteSetup(state, p, tile).hours);
// An axe, a saw or a machete on the team: carried by someone or in its cargo (woodcutting.js).
export const teamChopTool = (state, p) => !!p && (partyMembers(state, p).some((s) => !!bestChop(s).item) || ((p.cargo && p.cargo.gear) || []).some((it) => it && isChopTool(it)));
// "45 minutes", "2 h", "3 h 15 min".
export function durText(h) {
  const m = Math.round(h * 60);
  if (m < 60) return `${m} minutes`;
  const hh = Math.floor(m / 60), mm = m % 60;
  return `${hh} h${mm ? ` ${mm} min` : ""}`;
}
// Done asking (picked, or put off: the game's own spot then).
export function siteDone(state, p) {
  if (Array.isArray(state.siteAsk)) state.siteAsk = state.siteAsk.filter((id) => id !== (p && p.id));
}
// Where the camp goes: the spot picked while it still takes the camp, else the game's own.
// An unscouted tile (campscout.js): the blind spot the camp will go on, so the estimates and the setup agree.
export const campSiteFor = (state, p, tile) => (p && p.campAt && !siteProblem(state, tile, p.campAt) ? p.campAt.slice(0, 2) : p && p.owner === "player" && !tileScouted(state, tile, p) ? blindSite(state, tile) : defaultSite(state, tile));

// The camp fire's cost (CAMP.fireCost: wood and stone; the user's request 2026-10-23): what a team of yours setting up a
// camp (Set up camp, Establish base, Build outpost; hardcore's first home too) must carry, or why not ("" when it does).
// The governor's teams (state.autopilot) pay it if they carry it and are never held up by it.
export function fireCostProblem(state, p) {
  if (!p || p.owner !== "player" || state.autopilot) return "";
  const short = Object.entries(CAMP.fireCost).filter(([k, n]) => carried(p, k) < n);
  return short.length ? `The camp fire needs ${needText(CAMP.fireCost)} carried (short ${short.map(([k, n]) => `${Math.ceil(n - carried(p, k))} ${k}`).join(", ")}): Cut wood and Gather stone, or bring some` : "";
}
// The camp: a tier-0 base with camp: true on the team's tile, on its spot (campSiteFor: base.plan.origin, fresh: the
// land all round is the tile's own, basemap.js freshBase); the team moves in (parties.js settleInto: its people
// residents, its vehicles parked, its supplies and cargo in the stores and armory) and is disbanded; the 5 × 5 round
// the fire is cleared and what it gave goes into the stores (basemap.js clearCampSite). up: a camp meant to grow
// (Establish base, Build outpost: base.grow) and the naming popup. Its step up (camp_up for your hub's camp, outpost_up
// beside a hub) is not queued for you (the user's request 2026-10-23: "do not have the shelter pending build show yet.
// The player needs to select it from the build menu and select where to put it and then it can be built"): pick it
// from the Build list and click where it goes (ui/basemap.js; the Camp tab's button opens the map with it picked).
// The governor's camps (state.autopilot) and any not set up by you have it queued at once, placed by the game. Returns the base.
export function makeCamp(state, p, tile, { up = false } = {}) {
  const t = state.tiles[tile];
  const hubNow = hub(state);
  const people = partyMembers(state, p);
  const base = {
    id: newId(), tile, type: hubNow ? "outpost" : "hub", name: campName(state, tile),
    stock: { water: 0, fuel: 0, meds: 0, ammo: 0, arrows: 0, parts: 0, scrap: 0, jars: 0, wood: 0, buildmat: 0, metalsheet: 0, [RAW]: 0 }, // arrows, wood: every base keeps the count (a camp read arrows = undefined: farmtest 43)
    radio: false, watchtower: false, buildings: [], construction: [], armory: [],
    tier: 0, camp: true, fire: true, campDay: day(state), lastPresent: state.hour, first: firstHubPending(state) && !hubNow, tentsSet: true, // tentsSet: a new camp has no tents (no beds) until one is put up (buildings.js TENTS)
    plan: { plots: [], origin: campSiteFor(state, p, tile), fresh: true }, // its spot on the tile's 250 × 250 map (basemap.js originOf, freshBase)
    land: { v: 2, n: 1, cleared: {}, looted: {} }, // the land read from the start (basemap.js ensureLand would clear the ground under what the game places)
  };
  delete p.campAt;
  siteDone(state, p);
  if (t.ruin) { base.ruinSalvage = true; log(state, `The camp went up on the ruins of ${t.ruin.name}.`, "info"); delete t.ruin; }
  if (up) base.grow = true; // Build outpost's camp is on the supply network before its house is placed (economy.js shipFromOutposts)
  if (up && (state.autopilot || p.owner !== "player")) base.construction.push(tierUpJobFor(base));
  state.bases.push(base);
  if (up) askBaseName(state, base);
  const name = teamName(state, p);
  for (const [k, n] of Object.entries(CAMP.fireCost)) takeSupply(p, k, n); // the camp fire's ring of stones and its first wood (fireCostProblem)
  settleInto(state, p, base);
  const site = clearCampSite(state, base); // basemap.js: the 5 × 5 round the fire, what it gave into the stores
  const tents = pitchArmoryBags(state, base); // tents.js: every tent bag the team brought goes up (beds under cover, storage out of the weather)
  for (const s of people) s.role = up ? "build" : "scavenge"; // a camp meant to grow: its first job is its own step up, once it is placed
  recomputeOwnership(state);
  if (p.owner === "player") state.campOpen = base.id; // main.js opens its base window (once)
  const w = waterSource(state, tile);
  const job = tierUpJob(base);
  const gave = Object.entries(site.got).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k === "carparts" ? `car part${v === 1 ? "" : "s"}` : k === "metalsheet" ? `metal sheet${v === 1 ? "" : "s"}` : keyWord(k)}`);
  log(state, `${name} set up camp ${tileLabel(state, tile)}: ${base.name}, ${people.length} ${people.length === 1 ? "person" : "people"}. Clearing its ${SITE.SIZE} × ${SITE.SIZE} round the camp fire gave ${gave.length ? gave.join(", ") : "nothing worth keeping"}.${tents.length ? ` Up went ${tentsText(tents.map((t) => t.type))}: ${Math.min(people.length, tentBeds(base))} of ${people.length} sleep under cover.` : ""}${job ? ` To build it up into ${base.type === "outpost" ? "an outpost" : "a shelter"}: ${gatherShort({ ...job, paid: {} })} brought in, then ${job.hours} work-hours by its builders (Construction).` : up ? ` To build it up into ${base.type === "outpost" ? "an outpost" : "a shelter"}: pick the ${BUILDINGS[tierUpType(base)].name.toLowerCase()} from its Build list and place it on the build map.` : ""} Water: ${w ? waterText(state, tile) : "none nearby"}.`, "good");
  if (p.owner === "player") askLayout(state, base, "camp"); // Open the build map: the alert (ui/buildmap.js)
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
const PACK_ORDER = ["water", RAW, "food", "preserved", "meds", "ammo", "fuel", "parts", "buildmat", "metalsheet", "scrap", "jars"];
// Strike camp: its people form a team on the tile with what they can carry; the rest is a cache; the camp is gone.
// Returns { party (or null: nobody there), text } or { error }.
export function strikeCamp(state, base) {
  const why = strikeProblem(state, base);
  if (why) return { error: why };
  // What the step up has taken so far comes back into the stores (it is packed with the rest).
  for (const job of base.construction) for (const [k, q] of Object.entries(job.paid || {})) base.stock[k] = (base.stock[k] || 0) + q;
  base.armory.push(...strikeTents(state, base)); // tents.js: the tents come down into their bags (packed first, below)
  if (base.fire !== undefined || isCamp(base)) base.stock.stone = (base.stock.stone || 0) + CAMP.fireCost.stone; // the camp fire's ring of stones picked up again (its wood is burnt)
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
    // The camp fire's wood and stone first (CAMP.fireCost, 2026-10-23): the team can set up camp again wherever it goes.
    for (const [k, n] of Object.entries(CAMP.fireCost)) {
      const q = Math.min(n, n0(base.stock[k]), Math.floor((room + 1e-9) / SUPPLIES[k].weight));
      if (q >= 1) { supplies[k] = q; room -= q * SUPPLIES[k].weight; }
    }
    const rounds = Object.keys(base.stock).filter((k) => ROUND_SUPPLIES[k] && !PACK_ORDER.includes(k)).sort((a, b) => (base.stock[b] || 0) - (base.stock[a] || 0) || (a < b ? -1 : 1)); // rounds by calibre (ammo.js) where "ammo" stands, most first
    const foodOrder = Object.keys(packPick(state, base, foodIn(base.stock), { days: 7 })); // foods.js: what keeps and weighs least first
    const order = PACK_ORDER.flatMap((k) => (k === "ammo" ? [k, ...rounds] : k === "food" ? foodOrder : k === "preserved" ? [] : [k]));
    for (const k of [...order, ...Object.keys(base.stock).filter((k) => !order.includes(k))]) {
      const w = SUPPLIES[k] ? SUPPLIES[k].weight : 0;
      const have = n0(base.stock[k]) - (supplies[k] || 0); // less the camp fire's, packed first
      if (have < 1 || !SUPPLIES[k]) continue;
      const q = w > 0 ? Math.min(have, Math.floor((room + 1e-9) / w)) : have;
      if (q < 1) continue;
      if (q === have) base.stock[k] = Math.max(base.stock[k], q + (supplies[k] || 0)); // n0 counts 0.9999… as 1: the stores hold it whole (launchExpedition checks to the last digit)
      supplies[k] = (supplies[k] || 0) + q;
      room -= q * w;
    }
    const items = [];
    for (const it of [...base.armory].sort((a, b) => (isTentBag(b) ? 1 : 0) - (isTentBag(a) ? 1 : 0) || ((GEAR[b.key] && GEAR[b.key].value) || 0) - ((GEAR[a.key] && GEAR[a.key].value) || 0))) { // the tent bags first
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
  base.armory.push(...strikeTents(state, base)); // tents.js: a tent left pitched stays at the camp site: in the cache, as its bag
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
  groundsHour(state); // campscout.js: the dead out on a blind camp's grounds come at it now and then
  if (state.hour % 24 === 0) for (const b of state.bases) if (isShelter(b)) shelterDaily(state, b);
  settleHub(state);
  for (const b of state.bases) if (b.layoutAsk && state.hour - b.layoutAsk.hour >= LAYOUT_ASK.HOURS) delete b.layoutAsk; // Open the build map: asked long enough
  for (const base of [...state.bases]) {
    if (!isCamp(base)) continue;
    if (campPresent(state, base)) base.lastPresent = state.hour;
    else if (base.lastPresent == null) base.lastPresent = state.hour;
    if (state.hour % 24 === 0) { campTentsDaily(state, base); campDaily(state, base); } // tents.js: bags go up while someone sleeps rough; rough sleepers' mood
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
  askLayout(state, base, "shelter"); // Open the build map: the alert too (the card below carries the button)
  const days = day(state) - (base.campDay || day(state));
  const when = `${days} day${days === 1 ? "" : "s"} after the camp went up`;
  if (firstHubPending(state)) { hubFounded(state, base, when); return; }
  const people = atBase(state, base.id).length;
  const text = `Day ${day(state)}: ${base.name} is your new shelter, ${when}. ${people} ${people === 1 ? "person lives" : "people live"} there. ${shelterText()}`;
  addCard(state, { title: "A new home", text, mapBase: base.id, choices: [{ label: "OK", default: true, resolve: () => "" }, buildMapChoice(base)] }); // a rename while it waits rewrites its text (basenames.js renameBase)
}
// buildings.js upgradeShelter: a shelter built up into a base, or an outpost camp into an established outpost.
export function baseUpgraded(state, base) {
  askLayout(state, base, base.type === "outpost" ? "outpost" : "base");
}

// ---------- Open the build map (the user's requests 2026-10-20) ----------
// "When a camp/base is established add an option to open up the build map to set up things like tents etc.": a base
// that is new to you, or has just gone up a tier, asks to be laid out (base.layoutAsk { why, hour }). Nothing here
// stops the clock or blocks a save: ui/buildmap.js shows it as an alert ("<name>: camp set up. Open the build map",
// its name read as it is drawn, so a rename shows), the camp's Camp tab has the button, and the key (keymap.js
// base.buildmap) opens the selected base's map any time. The ask goes when the base's map is opened
// (layoutDone: ui/basemap.js openBuildMap, main.js tidyUi) or after LAYOUT_ASK.HOURS (campsHour). The founding cards
// that already were ("A new home", hardcore's "A place of your own") carry the button as an extra choice: OK is the
// default, and a uiAction choice is never an auto-answer nor the governor's pick (cardrules.js usableChoices); a card
// whose base is gone is dropped from the tray (cardrules.js trayStale: mapBase), and the button then opens nothing.
// Not under the governor (it opens no windows either). UI only: the AI groups have no map to lay out by hand.
export const BUILD_MAP_LABEL = "Open the build map";
export const LAYOUT_ASK = { HOURS: 72 };
// Why it asks, as said after the base's name.
export const LAYOUT_WHY = {
  camp: "camp set up", shelter: "a shelter now", outpost: "an established outpost now", base: "a real base now",
  occupied: "yours: you moved in", conquered: "yours: taken", returned: "yours again", handed: "handed over to you",
};
export function askLayout(state, base, why) {
  if (!base || state.autopilot || !LAYOUT_WHY[why]) return;
  base.layoutAsk = { why, hour: state.hour };
}
export const layoutAsks = (state) => (state.bases || []).filter((b) => b.layoutAsk && state.hour - b.layoutAsk.hour < LAYOUT_ASK.HOURS);
export function layoutDone(state, baseId) {
  const b = (state.bases || []).find((x) => x.id === Number(baseId));
  if (b) delete b.layoutAsk;
}
// "Sutter Camp: camp set up. Open the build map" (read as it is drawn: the base's name now).
export const layoutAskLine = (base) => `${base.name}: ${LAYOUT_WHY[base.layoutAsk && base.layoutAsk.why] || "new"}. ${BUILD_MAP_LABEL}`;
export const buildMapChoice = (base) => ({
  label: BUILD_MAP_LABEL, hint: "This base's map: pick something from its Build list and click where it goes, or move what stands there.",
  uiAction: { type: "basemap", baseId: base.id }, resolve: () => "",
});

// What a new shelter is (the founding cards).
export const shelterText = () => `A shelter (tier 0): tarps and a shack behind a scrap barricade, the camp's stores (beds are what you build or pitch on its map). No well: water from a river or lake beside it, rain catchers, or what you bring. Only a few buildings fit (a rain catcher, a drying rack, a barricade, a farm plot) until your builders build it up into a base (Construction: ${BUILDINGS.hub_up.name}, ${needText(BUILDINGS.hub_up.cost)} and ${BUILDINGS.hub_up.hours} work-hours) for a well, walls and everything else.`;

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
    stock: { water: 0, fuel: 0, meds: 0, ammo: 0, arrows: 0, parts: 0, scrap: 0, jars: 0, wood: 0, buildmat: 0, metalsheet: 0, [RAW]: 0 }, // arrows, wood: every base keeps the count (a camp read arrows = undefined: farmtest 43)
    radio: false, watchtower: false, buildings: [], construction: [], armory: [],
    tier: 0, camp: true, fire: old.fire !== false, campDay: old.started || day(state), lastPresent: old.lastPresent ?? state.hour, first: !!old.first,
  };
  for (const [k, v] of Object.entries(old.stores || {})) if (Number.isFinite(v) && v > 0) base.stock[k] = (base.stock[k] || 0) + v;
  if (old.to === 0 || old.to == null) {
    const job = tierUpJobFor(base);
    if (old.needs && typeof old.needs === "object") job.cost = { ...old.needs }; // the old staging camp's needs: what it was started at (no wood, from before the user's pick of 2026-10-20)
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
