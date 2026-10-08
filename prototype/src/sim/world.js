// @ts-check
// World state, shared helpers and the hourly/daily tick.
// Pure simulation: no DOM or canvas code lives here.
/** @import { State, Survivor, Base, Item, Card, Stock, TileSnapshot, Marker } from "./types" */
import { keyWord } from "./water.js"; // supply names in log lines (call-time only: safe in the import cycle)
import { Rng } from "./rng.js";
import { generateMap } from "./mapgen.js";
import { DEFAULT_SIZE, sizeDef, customDef, isCustom, clampHives } from "./worldsize.js";
import { FIRST_NAMES, LAST_NAMES, SKILLS, ROLLED_SKILLS, TRAITS, GEAR, SUPPLIES, SUPPLY_KEYS } from "./data.js";
import { sanitizeLibrary } from "./custombg.js";
import { appearanceFor, craftingStart, CRAFT_START } from "./appearance.js";
export { radioBasesInRange };

// Bases with a radio station, or a linked relay, whose range covers a tile (the network is in radio.js).
/** @param {State} state @param {number} tileId @returns {Base[]} */
function radioBasesInRange(state, tileId, extra = 0) {
  return coverNodes(state, tileId, extra).map((n) => n.base);
}
import { createFactions, factionsDaily, recomputeOwnership } from "./factions.js";
import { movePartiesHour } from "./parties.js";
import { hordesHour, hordesDaily } from "./hordes.js";
import { ensureHives, hivesSecured } from "./hives.js";
import { growthAt, growthInfo } from "./hivetech.js";
import { mergeMix } from "./zombietypes.js";
import { basesDaily, routesDaily, deathSitesDaily } from "./economy.js";
import { addBuilding, constructionHour, assignStations } from "./buildings.js";
import { createVehicle, vehiclesDaily, garageHour, factionVehiclesDaily } from "./vehicles.js";
import { updateLiveMarkers, mergeSpots } from "./markers.js";
import { captivesDaily, releaseStranded, contactHour } from "./conflicts.js";
import { aiCaptivesDaily } from "./nonlethal.js"; // people the groups took from each other in raids
import { supplyDaily } from "./supply.js";
import { medicalHour } from "./medical.js";
import { craftingHour, craftingDaily } from "./crafting.js";
import { repairHour } from "./repair.js"; // gear repairs at the bench
import { armorPower, armorMult, allItems, stripAll, newItem, START_DUR } from "./inventory.js";
import { randomStarterMods } from "./gunmods.js"; // starting guns may carry a cheap attachment
import { settleAll, starterLoad, pocketBox, gunsArmed, drawShots } from "./ammo.js"; // rounds by calibre
import { startChronicle, recordChronicle } from "./chronicle.js";
import { historyHour } from "./history.js"; // the Ledger's daily rows (ui/ledger.js)
import { autopilotHour } from "./autopilot.js";
import { productionHour } from "./production.js";
import { stewardHour } from "./steward.js";
import { workHour, workDayRoles } from "./work.js";
import { watchHour, watchDayRoles } from "./watch.js";
import { tiredHour } from "./sleep.js";
import { crewHour } from "./crews.js";
import { woundTrauma } from "./health.js";
import { weatherHour, weatherDaily } from "./weather.js";
import { riversHour } from "./rivers.js"; // frozen rivers: freeze and thaw (who is on the ice, ways over it)
import { coverNodes, radioDaily } from "./radio.js";
import { diaryRecord } from "./diary.js";
import { onDeath } from "./relations.js";
import { noteDeath, noteBaseLoss, lossHow, causesDaily } from "./causes.js"; // "Why?": the chain of causes of a death or a lost base
import { skillsHour, skillsDaily, hasPerk, hash01 } from "./skills.js";
import { diplomacyHour } from "./diplomacy.js";
import { allianceVictory, accordHolds, controlledLand } from "./alliance.js";
import { claimsDaily } from "./claims.js"; // land claims: lost under a base founded or taken, a hive, a hostile camp
import { conquestDaily } from "./conquest.js";
import { prisonersHour, prisonersDaily } from "./prisoners.js";
import { visitorsHour, visitorsDaily } from "./visitors.js";
import { caravanRaidsHour } from "./caravanraids.js";
import { noteFinds, discoveryHour, mergeLooked } from "./discovery.js";
import { hiveBirthHour } from "./hivebirth.js"; // hive birth you can see: rumours, the massing card, a hive risen
import { festivalHour } from "./festival.js"; // the yearly harvest festival at the hub
import { baseOpticsSight } from "./optics.js";
import { surveyDaily } from "./survey.js";
import { riseOnMap, walkingDaily } from "./carriers.js"; // the worm: someone who has it gets up when they die; the walking dead drift
import { erasVictoryDaily, accordReady, containReady } from "./eras.js";
import { outbreakDaily } from "./outbreak.js";
import { hardcoreCreate, hardcoreAfterHives, hardcoreDaily, hardcoreHour } from "./hardcore.js";
import { countWord, normalStartBackgrounds, normalStartKit } from "./hardcore-start.js";
import { stagingHour } from "./staging.js";
import { needsHour } from "./needs.js";
import { wanderersDaily } from "./wanderers.js";
import { crowdCardsHour } from "./moveout.js"; // the Overcrowded card (and moving people between your bases)
import { familyDaily } from "./family.js"; // children and generations

export const HUB_VISION = 3;
// A normal start's hub is bare (barestart): no buildings, every construction plot free. Its stores carry the first
// builds instead, the player's choice (or the governor's, autopilot.js buildWishes): 50 scrap is a bunkhouse (20), a
// crafting bench (12 and a part: buildings.js BUILDINGS.craftbench), a farm plot (8) and a rain catcher (5) with a
// little over; 3 parts are the bench's, a well's and one spare. It used to be 25 scrap and 2 parts with two farm plots,
// a crafting bench, a bunkhouse and a wall section already standing (69 scrap of buildings). tools/barestarttest.js.
export const HUB_START = { scrap: 50, parts: 3 };
export const OUTPOST_VISION = 2;
export const RADIO_RANGE = 12; // a radio station's reach; a base with a Military encrypted radio in its armory reaches radio.js MIL_RADIO_RANGE (24)

let nextId = 1;
export const newId = () => nextId++;
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

// crew (optional): starting-colonist overrides from the new-run screen, by index:
// [{ name?, skills?, traits?, budget?, appearance?, gear?, leader? }]. Headless tools leave it out.
// size: a worldsize.js key (small / normal / large / huge; Normal when left out, the original 64 × 42 map), or
// "custom" with customW × customH hexes (experimental: worldsize.js customDef).
// hives (optional): how many hives the map starts with, 0–10 (null: what the size makes; mapgen.js).
// mode: "normal" (6–12 months after the outbreak, with a hub) or "hardcore" (the day Calder falls: hardcore.js).
// crewRoll (optional, Hardcore): a seed of its own for the three's backgrounds, what they grabbed and the car (the
// new-run screen's Randomize all); left out, the world's seed decides them.
// startPeople (optional, Hardcore): how many flee together on day 1, 1–4 (hardcore.js START_PEOPLE; 3 when left out),
// kept as state.startPeople. A normal start is a full hub of six and ignores it.
/**
 * @param {{ seed: number, factionCount: number, crew?: any[] | null, size?: string, mode?: string, customW?: number | null,
 *   customH?: number | null, hives?: number | null, crewRoll?: number | null, startPeople?: number | null, customBackgrounds?: any }} opts
 * @returns {State}
 */
export function createWorld({ seed, factionCount, crew = null, size = DEFAULT_SIZE, mode = "normal", customW = null, customH = null, hives = null, crewRoll = null, startPeople = null, customBackgrounds = null }) {
  const rng = new Rng(seed);
  const sdef = isCustom(size) ? customDef(customW, customH) : sizeDef(size);
  const worldSize = sdef.key;
  const map = generateMap(rng, sdef, { hives: clampHives(hives) });
  /** @type {State} */
  const state = {
    seed, rng, worldSize, mode: mode === "hardcore" ? "hardcore" : "normal",
    idBase: nextId - 1, // localId: this world's ids counted from its own start
    woodcutting: 2, // a world with firewood, 0.1 kg a unit (save.js: older saves are given it, or scaled to it, on load)
    rawWater: 1, // a world with purified and un-purified water (water.js; save.js: older saves are given it on load)
    groupWorks: 1, // barestart: the AI groups' bases start bare and they build (groupworks.js); an older save has them built up
    gunSlots: 1, // a world with gun attachment slots (gunmods.js; save.js: older saves have their guns' parts moved on load)
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
  if (state.mode === "hardcore") {
    hardcoreCreate(state, { factionCount, crew, crewRoll, ...(startPeople != null ? { startPeople } : {}) });
    ensureHives(state);
    hardcoreAfterHives(state);
    state.ammoCal = 1; // rounds by calibre from the start (save.js migrates older saves)
    updateVision(state);
    log(state, `Day 1. Calder is falling. ${state.startPeople === 1 ? "You got out alone" : `${countWord(state.startPeople).replace(/^./, (c) => c.toUpperCase())} of you got out`} with what you could carry. ${state.factions.length + (state.hardcore?.groups?.bands?.length || 0)} other groups are out there somewhere.`, "info");
    startChronicle(state);
    return state;
  }

  // Player hub: a small town far from the outbreak origin, the cities and the National Guard bases, but not off in a
  // corner of the state: within 30 tiles of a city and a few tiles from the map edge.
  const g = state.grid;
  const towns = state.tiles.filter((t) => t.loc && t.loc.type === "town");
  // The extra hot spots of Large and Huge maps (mapgen.js spotIds) count as the origin does.
  const farFrom = (t, origin, city, mil) => g.distance(t.id, state.originId) >= origin && map.spotIds.every((s) => g.distance(t.id, s) >= origin - 4) &&
    state.cityIds.every((c) => g.distance(t.id, c) >= city) && state.militaryIds.every((m) => g.distance(t.id, m) >= mil);
  const central = (t) => t.x >= 4 && t.y >= 3 && t.x < g.width - 4 && t.y < g.height - 3 && state.cityIds.some((c) => g.distance(t.id, c) <= 30);
  // Large and Huge maps (worldsize.js hiveClear): farther from the hives at first, so the early game is no harsher
  // than a Normal map's.
  const clear = sdef.hiveClear;
  const clearCandidates = clear ? towns.filter((t) => farFrom(t, clear, 12, 12) && central(t)) : [];
  const hubCandidates = clearCandidates.length ? clearCandidates : towns.filter((t) => farFrom(t, 16, 12, 12) && central(t));
  const nearCandidates = towns.filter((t) => farFrom(t, 12, 8, 8));
  const hubTile = rng.pick(hubCandidates.length ? hubCandidates : nearCandidates.length ? nearCandidates : towns);
  state.bases.push({
    id: newId(), tile: hubTile.id, type: "hub", name: `${hubTile.loc.name} Holdout`,
    // Fuel is scarce (economy rework). Food: two weeks for six plus a few shelves of canned and jarred food, in the
    // town hall's cellar (storage.js); water for the first dry days while the sown fields get going; a woodpile
    // (woodcutting.js: the winter's heating is cut later).
    // Bare start (HUB_START): no buildings and every plot free; what the town hall gives (4 beds, 6 crop plots, the well,
    // the cellar, 3 wall strength: buildings.js) is all there is. The scrap and parts are for the first builds, the
    // player's (or the governor's) pick: a bunkhouse, a crafting bench, a farm plot and a rain catcher come to 45.
    stock: { food: 80, water: 50, rawwater: 0, fuel: 12, meds: 6, ammo: 80, arrows: 0, parts: HUB_START.parts, scrap: HUB_START.scrap, preserved: 10, jars: 12, wood: 300 },
    radio: false, watchtower: false, buildings: [], construction: [], armory: [],
  });
  const hubBase = state.bases[0];
  // Six people in the town hall's four beds from the first hour: the new-run screen and the first-week guide say so,
  // so the Overcrowded card (moveout.js) waits its usual days before it asks (and is not shown at all once beds are up).
  hubBase.crowdNote = { hour: state.hour, over: 2 };
  createVehicle(state, "truck", { kind: "base", baseId: hubBase.id }, { fuel: 20, condition: 75 });

  createFactions(state, factionCount);
  recomputeOwnership(state);

  for (let i = 0; i < 6; i++) state.survivors.push(makeSurvivor(state, i === 0 ? 1.3 : 1));
  // Starting gear: a few basics spread among the colonists.
  const starts = ["pistol", "machete", "huntrifle", "knife", "knife", "pistol"];
  state.survivors.forEach((s, i) => (s.gear.weapon = newItem(starts[i], 1, hash01(state.seed, "startdur", i), START_DUR))); // part-worn (inventory.js START_DUR)
  state.survivors.forEach((s, i) => randomStarterMods(state.rng, s.gear.weapon, i)); // gunmods.js: a cheap part or two on some guns
  state.survivors.forEach((s, i) => { const box = starterLoad(state.rng, s.gear.weapon, i); if (box && !pocketBox(s, box)) state.bases[0].stock[box.key] = (state.bases[0].stock[box.key] || 0) + box.dur; }); // ammo.js: now and then a typed load and a box of it
  state.survivors[0].gear.armor = newItem("vest", 1, hash01(state.seed, "startdur", "vest"), START_DUR);
  state.survivors.forEach((s) => (s.location = { kind: "base", baseId: state.bases[0].id }));
  state.survivors[0].leader = true;
  // Who they were (hardcore-start.js normalStartBackgrounds, 2026-10-07): a background each, with dice of their own,
  // before the new-run screen's edits; a custom background's kit after them.
  normalStartBackgrounds(state, crew);
  if (crew) applyCrew(state, crew);
  normalStartKit(state, hubBase);
  assignStartingRoles(state);
  settleAll(state); // ammo.js: the hub's 80 rounds by the calibres of the guns it starts with
  state.ammoCal = 1; // rounds by calibre from the start (save.js migrates older saves)

  ensureHives(state); // the hives mapgen.js placed, with their starting resources (hives.js)
  // Pre-war maps: geography is known, current conditions are not.
  updateVision(state);
  log(state, `Day 1. ${state.bases[0].name} is all that is left. ${state.factions.length} other groups are out there somewhere.`, "info");
  startChronicle(state); // timelapse recording (sim/chronicle.js)
  return state;
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
  const traits = rollTraits(rng);
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
  // Own rng keyed by seed + how many people this world has made: same seed, same faces,
  // and the world's rng sequence is untouched.
  state.peopleMade = (state.peopleMade || 0) + 1;
  s.appearance = appearanceFor(state.seed, state.peopleMade);
  return s;
}

// One or two traits, never Brave with Coward (makeSurvivor; the new-run screen's Randomize all).
/** @param {import("./rng.js").Rng} rng @returns {string[]} */
export function rollTraits(rng) {
  const traitKeys = Object.keys(TRAITS);
  const traits = [];
  const count = rng.chance(0.6) ? 1 : 2;
  while (traits.length < count) {
    const t = rng.pick(traitKeys);
    if (!traits.includes(t) && !(t === "brave" && traits.includes("coward")) && !(t === "coward" && traits.includes("brave"))) traits.push(t);
  }
  return traits;
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
  const n = String(name ?? "").trim().replace(/\s+/g, " ");
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
    if (c.name && String(c.name).trim()) s.name = String(c.name).trim();
    if (c.skills) for (const k of SKILLS) if (c.skills[k] != null) s.skills[k] = Math.max(0, Math.min(20, Math.round(c.skills[k])));
    // Traits and the skill-point budget belong to the edited colonist, not to the seed.
    if (Array.isArray(c.traits)) s.traits = [...new Set(c.traits.filter((t) => TRAITS[t]))];
    if (Number.isFinite(c.budget)) s.skillBudget = c.budget;
    if (c.appearance) s.appearance = { ...c.appearance };
    // A normal start's weapon and armor (Randomize all hands the kit out again). Hardcore's come from what they grabbed.
    if (c.gear && state.mode !== "hardcore") for (const k of ["weapon", "armor"]) if (k in c.gear) s.gear[k] = c.gear[k] && GEAR[c.gear[k].key] ? { ...c.gear[k] } : null;
    if (c.leader) s.leader = true;
    // Customized past the dice on the new-run screen (free skills, traits, a picked background: ui/newgame.js), which an
    // Ironman run may not start with.
    if (c.custom) s.startCustom = true;
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
export const survivorById = (state, id) => state.survivors.find((s) => s.id === id);
/** @type {(state: State) => Survivor[]} */
export const alive = (state) => state.survivors.filter((s) => s.alive);
/** @type {(state: State, baseId: number) => Survivor[]} */
export const atBase = (state, baseId) => alive(state).filter((s) => s.location.kind === "base" && s.location.baseId === baseId);
/** @type {(state: State, id: any) => import("./types").Faction | undefined} */
export const factionById = (state, id) => state.factions.find((f) => f.id === id);
// Everyone who lives at a base: the people there, plus (at the hub) trade-route escorts waiting between trips.
// Waiting escorts eat, heal and can be treated at the hub; they do no base work (atBase leaves them out).
/** @param {State} state @param {number} baseId @returns {Survivor[]} */
export function residents(state, baseId) {
  const h = hub(state);
  const hubId = h ? h.id : null;
  return alive(state).filter((s) => (s.location.kind === "base" && s.location.baseId === baseId) || (s.location.kind === "route" && baseId === hubId));
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
/** @param {Survivor} s @param {string} key @returns {number} */
export function skill(s, key) {
  let v = s.skills[key] || 0;
  if (key === "crafting" && s.skills.crafting == null) v = Math.round(CRAFT_START.oldSave * (s.skills.mechanics || 0)); // people from before the skill (save.js fills it in)
  if (key === "medicine" && s.traits.includes("medic")) v += 4;
  if (key === "stealth" && s.traits.includes("loud")) v -= 3;
  if (s.traits.includes("lucky")) v += 1;
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
  let p = 1 + skill(s, "shooting") * 0.25 + (w && eff.usable ? w.power * eff.mult * (s.gear.weapon.quality || 1) : 0);
  p += armorPower(s) * 0.5; // every worn piece (body, head, arms, legs)
  if (s.traits.includes("brave")) p += 1;
  if (hasPerk(s, "gunslinger")) p += 1.5; // skills.js perk
  if (s.traits.includes("coward")) p -= 1;
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
  const d = drawShots(stock, people.filter((s) => !usesArrows(s)), perHead);
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

// opts.raw: damage that armor and toughness do nothing against (hunger, thirst, infection).
/** @param {State} state @param {Survivor} s @param {number} amount @param {number | null} tileId @param {string} cause @param {{ raw?: boolean }} [opts] */
export function hurt(state, s, amount, tileId, cause, opts = {}) {
  if (!opts || !opts.raw) {
    if (s.traits.includes("tough")) amount *= 0.75;
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
  log(state, `${s.name} died ${cause}.`, "death");
  const entry = onDeath(state, s, tileId, cause); // relations.js: grief for friends and a partner, a line on the memorial wall
  noteDeath(state, s, tileId, cause, entry); // causes.js: why it happened, on the memorial entry
  // Died on the tile of one of your bases (hunger, an infected wound, a scavenging accident, a raid or horde at
  // the walls, a convoy starving while it holds there): their things go to that base's armory. No death site
  // inside the walls: no team could be sent to recover it, and passers-by cannot loot it. The one exception is
  // a team's own battle on that tile: its fallen stay bodies to loot on the result screen (inventory.js).
  const here = tileId != null ? state.bases.find((b) => b.tile === tileId) : null;
  const fight = state.combat;
  const teamBattle = !!(fight && fight.tileId === tileId && fight.setup && fight.setup.partyId != null
    && s.location && s.location.kind === "party" && s.location.partyId === fight.setup.partyId);
  const home = here && !teamBattle ? here : null;
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
    if (party && party.spotted) {
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
      return coalitionWins(state);
    }
    if (!hivesDone && hivesSecured(state) && (state.erasOff || containReady(state))) {
      state.gameOver = true;
      state.victory = true;
      state.hivesWon = true;
      state.victoryReason = "hives";
      // Keep the opening words: the timelapse (chronicle.js) recognises this line by them.
      log(state, `Every hive is destroyed. The State of Calder is not safe, but it is yours to win back. ${alive(state).length} survivors made it to day ${day(state)}.`, "good");
      return true;
    }
    return false;
  }
  if (!state.survivors.length) return false;
  state.gameOver = true;
  // Keep the opening words: the timelapse (chronicle.js) recognises this line by them.
  const allDead = state.survivors.every((s) => !s.left);
  log(state, `${allDead ? "Every survivor is dead." : "Every survivor is dead or gone."} The holdout has fallen.`, "death");
  return true;
}

/** @param {State} state */
function coalitionWins(state) {
  state.victoryReason = "alliance";
  state.allianceWon = true;
  const members = state.alliance ? state.alliance.members.length : 0;
  const pct = Math.round(controlledLand(state).pct * 100);
  // Keep the opening words: the timelapse (chronicle.js) recognises this line by them.
  log(state, members ? `The Calder Coalition holds the State of Calder: ${pct}% of the land, and ${members} member${members === 1 ? "" : "s"} beside you (the groups outside do not count: conquest). ${alive(state).length} survivors made it to day ${day(state)}.` : `The Calder Coalition holds the State of Calder: ${pct}% of the land, and no other group left standing to join it or oppose it. ${alive(state).length} survivors made it to day ${day(state)}.`, "good");
  return true;
}

// A base is lost (overrun by a horde, taken in a raid). One place for everything that has to follow: the
// people still there flee to the hub, vehicles parked there are left on the tile (abandoned, with a map
// marker), supply runs to or from it are paused, and the log says what was lost.
/** @param {State} state @param {Base} base @param {string} [cause] @returns {boolean} */
export function removeBase(state, base, cause = "was lost") {
  const i = state.bases.indexOf(base);
  if (i < 0 || base.type === "hub") return false;
  noteBaseLoss(state, base, lossHow(cause)); // causes.js: why it was lost (before the people leave)
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
  assignStations(state, h);
  const stock = SUPPLY_KEYS.filter((k) => (base.stock[k] || 0) >= 1).map((k) => `${Math.floor(base.stock[k])} ${keyWord(k)}`); // water.js keyWord: "un-purified water", not the key
  const bits = [];
  if (base.buildings.length) bits.push(`${base.buildings.length} building${base.buildings.length === 1 ? "" : "s"}`);
  if (stock.length) bits.push(`its stock (${stock.join(", ")})`);
  if (base.armory.length) bits.push(`${base.armory.length} item${base.armory.length === 1 ? "" : "s"} in the armory`);
  const parts = [`${base.name} ${cause}.`, bits.length ? `Lost with it: ${bits.join(", ")}.` : "Nothing of value was left there."];
  if (left.length) parts.push(`${left.length === 1 ? `The ${left[0]} was` : `${left.join(" and ")} were`} left behind there (marked on the map).`);
  if (fled.length) parts.push(`${fled.map((s) => firstOf(s.name)).join(", ")} fled to ${h.name}.`);
  if (paused) parts.push(`${paused} supply run${paused === 1 ? "" : "s"} to or from it ${paused === 1 ? "is" : "are"} paused.`);
  log(state, parts.join(" "), "death");
  return true;
}

/** @param {Stock} stock @returns {number} */
export function supplyValue(stock) {
  return SUPPLY_KEYS.reduce((s, k) => s + (stock[k] || 0) * SUPPLIES[k].value, 0);
}

// ---------- vision and knowledge ----------
// How far a base sees on the map. state given: at night (20:00–06:00) only NIGHT_BASE_VISION tiles round, whatever its
// watchtower or telescope (a team in the field sees only its own tile: parties.js sightRadius).
export const NIGHT_BASE_VISION = 1;
/** @param {Base} base @param {State | null} [state] @returns {number} */
export function baseVision(base, state = null) {
  if (state && isNight(state)) return NIGHT_BASE_VISION;
  return (base.tier === 0 ? 1 : base.type === "hub" ? HUB_VISION : OUTPOST_VISION) + (base.watchtower ? 2 : 0) + baseOpticsSight(base); // a telescope in the armory (optics.js); a shelter (buildings.js SHELTER, tier 0) sees 1 tile
}

/** @param {State} state @param {number} tileId @returns {TileSnapshot} */
export function snapshot(state, tileId) {
  const t = state.tiles[tileId];
  const here = state.hordes.filter((h) => h.tile === tileId);
  const hordeSize = here.reduce((s, h) => s + h.size, 0);
  const site = state.hiveSites ? state.hiveSites.find((x) => x.tile === tileId) : null;
  const factionBase = state.factions.find((f) => f.alive && f.bases.includes(tileId));
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
    deathSite: state.deathSites.find((d) => d.tile === tileId) ? state.deathSites.find((d) => d.tile === tileId).items.length : 0,
  };
}

/** @type {(state: State) => Base[]} */
export const radioBases = (state) => state.bases.filter((b) => b.radio);

/** @param {State} state @returns {Set<number>} */
export function liveTiles(state) {
  const set = new Set();
  for (const b of state.bases) for (const id of state.grid.within(b.tile, baseVision(b, state))) set.add(id);
  // Radio: parties in range report what they see right now.
  for (const p of state.parties) {
    if (p.owner === "player" && p.radioLive) for (const id of p.sightNow || []) set.add(id);
  }
  return set;
}

/** @param {State} state */
export function updateVision(state) {
  const live = liveTiles(state);
  state.live = live;
  for (const id of live) {
    state.knowledge[id] = snapshot(state, id);
    for (const f of state.factions) if (f.bases.includes(id)) f.known = true;
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
    if (snap.factionBase) {
      const f = factionById(state, snap.factionBase);
      if (f) f.known = true;
    }
  }
  noteFinds(state, seen.keys(), who ? { party: who } : null);
  if (who) mergeLooked(state, who); // discovery.js: where the team looked hard (the map's Known area layer)
}

// ---------- tick ----------
/** One hour of the world. @param {State} state */
export function tickHour(state) {
  if (state.gameOver) return;
  state.hour += 1;
  weatherHour(state); // weather.js: seasons and the day's weather (fixed ahead, so ETAs hold)
  riversHour(state); // rivers.js: rivers freezing over or thawing (before anyone moves this hour)
  skillsHour(state); // skills.js: travel XP, Pathfinder's pace
  movePartiesHour(state);
  stagingHour(state); // staging.js: the staging camp with no base (work, stores, looters; done: the hub)
  needsHour(state); // needs.js: hunger and thirst at bases and on errands (teams eat in movePartiesHour), teams' treats
  releaseStranded(state); // conflicts.js: a halted team with nothing left to resolve it checks in for orders
  hordesHour(state);
  visitorsHour(state); // visitors.js: raiders, merchants and explorers from outside the state
  caravanRaidsHour(state); // caravanraids.js: caravans met on the road, chased, robbed (by you or by the groups)
  if (state.mode === "hardcore") hardcoreHour(state); // hardcore.js: bands on the road (hardcore mode only)
  contactHour(state); // conflicts.js: a horde or an enemy party that came onto a team's tile attacks it
  constructionHour(state);
  repairHour(state); // repair.js: the base repair queue (before crafting: the crafters' hour goes to a repair first)
  craftingHour(state);
  garageHour(state); // vehicles.js: vehicle upgrades in the garage (glass, plating)
  productionHour(state); // production.js: station orders and their fallbacks, power, repeating craft orders
  medicalHour(state);
  diplomacyHour(state); // diplomacy.js: jobs for other groups checked every hour (jobs.js)
  prisonersHour(state); // prisoners.js: rescue raids arriving, prisoners whose team or base is gone
  if (state.hour % 24 === 0) {
    workDayRoles(state); // work.js: people asleep or off at midnight count at their day's work (set again below)
    watchDayRoles(state); // watch.js: Manual people on watch likewise
    weatherDaily(state); // first, so the day's farming, water and sickness read today's weather
    basesDaily(state);
    craftingDaily(state);
    vehiclesDaily(state);
    factionVehiclesDaily(state); // vehicles.js: a military group replaces a lost Humvee, slowly
    factionsDaily(state);
    hordesDaily(state);
    outbreakDaily(state); // outbreak.js: new hives from beyond the border while the outbreak there burns
    hardcoreDaily(state); // hardcore.js: the first year after the fall (hardcore mode only)
    routesDaily(state);
    supplyDaily(state);
    deathSitesDaily(state);
    walkingDaily(state); // carriers.js: the walking dead drift a tile; a body with the worm left unburied at a base gets up
    captivesDaily(state);
    aiCaptivesDaily(state); // nonlethal.js: people the groups took from each other: recruited, ransomed, escaped
    prisonersDaily(state); // prisoners.js: food, escapes, ransoms, recruiting, rescue raids
    conquestDaily(state); // conquest.js: infamy fades, bases taken from you are patched up by their holders
    radioDaily(state); // radio.js: relay upkeep, groups' water and wares, grudge raids, groups calling you
    visitorsDaily(state); // visitors.js: outsiders crossing the border, guests sheltering at your bases
    skillsDaily(state); // skills.js: XP from the day's work, teaching, reading, decay, perk effects
    familyDaily(state); // family.js: couples, expecting, births, children eating, growing up and joining the work
    surveyDaily(state); // survey.js: rumours of hidden places (radio, travellers, merchants), found ones struck off
    wanderersDaily(state); // wanderers.js: the survivors you met and left live on (or not); no dice of the world's
    recomputeOwnership(state);
    claimsDaily(state); // claims.js: claims under a new base, a hive or a hostile camp are lost
    // eras.js: the Accord's and the containment's clocks (the victories need them to have run: checkGameOver).
    if (!state.gameOver) erasVictoryDaily(state, !state.allianceWon && accordHolds(state), hivesSecured(state));
    causesDaily(state); // causes.js: the day each base's water, food, scrap, meds, ammo or firewood ran out
    ensureLeader(state);
    if (day(state) % 5 === 0) log(state, `Day ${day(state)}. ${alive(state).length} survivors.`, "info");
  }
  settleAll(state); // ammo.js: generic ammo that came in or went out this hour sorted into (or out of) rounds by calibre
  // Safety net: no stock below zero, whatever subtracted from it.
  for (const b of state.bases) for (const k of Object.keys(b.stock)) if (b.stock[k] < 0) b.stock[k] = 0;
  checkGameOver(state);
  updateVision(state);
  discoveryHour(state); // discovery.js: hidden sites reported this hour (radio, maps, intel, prisoners, the coalition)
  hiveBirthHour(state); // hivebirth.js: a new hive site heard of, the dead seen massing, a hive you knew of risen
  festivalHour(state); // festival.js: the morning of the harvest festival
  crowdCardsHour(state); // moveout.js: a base of yours with more people than beds says so (once, then after a while or when worse)
  workHour(state); // work.js: people on work priorities get this hour's job (before stewards, which skip them)
  crewHour(state); // crews.js: crew roles run their own trips and answer their teams' small cards
  if (state.autopilot) autopilotHour(state); // dev tool: the AI governor runs the holdout (autopilot.js)
  else stewardHour(state); // steward.js: bases handed to a steward
  watchHour(state); // watch.js: Manual people on the watch roster stand guard on their shift (after the stewards)
  tiredHour(state); // sleep.js: the hour's sleep owed or slept off (a watch in someone's sleep hours keeps them up)
  recordChronicle(state); // a timelapse frame once a day (cheap check otherwise)
  historyHour(state); // history.js: stock flows marked, a row a day for the Ledger and the run summary
}
