// World state, shared helpers and the hourly/daily tick.
// Pure simulation: no DOM or canvas code lives here.
import { Rng } from "./rng.js";
import { generateMap } from "./mapgen.js";
import { DEFAULT_SIZE, sizeDef, customDef, isCustom, clampHives } from "./worldsize.js";
import { FIRST_NAMES, LAST_NAMES, SKILLS, TRAITS, GEAR, SUPPLIES, SUPPLY_KEYS } from "./data.js";
import { appearanceFor } from "./appearance.js";
export { radioBasesInRange };

// Bases with a radio station, or a linked relay, whose range covers a tile (the network is in radio.js).
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
import { createVehicle, vehiclesDaily } from "./vehicles.js";
import { updateLiveMarkers, mergeSpots } from "./markers.js";
import { captivesDaily, releaseStranded } from "./conflicts.js";
import { supplyDaily } from "./supply.js";
import { medicalHour } from "./medical.js";
import { craftingHour, craftingDaily } from "./crafting.js";
import { armorPower, armorMult, allItems, stripAll } from "./inventory.js";
import { startChronicle, recordChronicle } from "./chronicle.js";
import { autopilotHour } from "./autopilot.js";
import { productionHour } from "./production.js";
import { stewardHour } from "./steward.js";
import { workHour, workDayRoles } from "./work.js";
import { crewHour } from "./crews.js";
import { woundTrauma } from "./health.js";
import { weatherHour, weatherDaily } from "./weather.js";
import { coverNodes, radioDaily } from "./radio.js";
import { diaryRecord } from "./diary.js";
import { onDeath } from "./relations.js";
import { skillsHour, skillsDaily, hasPerk } from "./skills.js";
import { diplomacyHour } from "./diplomacy.js";
import { allianceVictory, accordHolds, controlledLand } from "./alliance.js";
import { claimsDaily } from "./claims.js"; // land claims: lost under a base founded or taken, a hive, a hostile camp
import { conquestDaily } from "./conquest.js";
import { prisonersHour, prisonersDaily } from "./prisoners.js";
import { visitorsHour, visitorsDaily } from "./visitors.js";
import { noteFinds, discoveryHour, mergeLooked } from "./discovery.js";
import { baseOpticsSight } from "./optics.js";
import { surveyDaily } from "./survey.js";
import { riseOnMap, walkingDaily } from "./carriers.js"; // the worm: someone who has it gets up when they die; the walking dead drift
import { erasVictoryDaily, accordReady, containReady } from "./eras.js";
import { outbreakDaily } from "./outbreak.js";
import { hardcoreCreate, hardcoreAfterHives, hardcoreDaily, hardcoreHour } from "./hardcore.js";
import { stagingHour } from "./staging.js";
import { needsHour } from "./needs.js";
import { wanderersDaily } from "./wanderers.js";

export const HUB_VISION = 3;
export const OUTPOST_VISION = 2;
export const RADIO_RANGE = 12; // a radio station's reach; a base with a Military encrypted radio in its armory reaches radio.js MIL_RADIO_RANGE (24)

let nextId = 1;
export const newId = () => nextId++;
// Saves (save.js): the next id is part of a save, so a loaded world hands out the same ids it would have.
export const peekNextId = () => nextId;
export function setNextId(n) {
  if (Number.isInteger(n) && n >= 1) nextId = n;
}

// crew (optional): starting-colonist overrides from the new-run screen, by index:
// [{ name?, skills?, traits?, budget?, appearance?, leader? }]. Headless tools leave it out.
// size: a worldsize.js key (small / normal / large / huge; Normal when left out, the original 64 × 42 map), or
// "custom" with customW × customH hexes (experimental: worldsize.js customDef).
// hives (optional): how many hives the map starts with, 0–10 (null: what the size makes; mapgen.js).
// mode: "normal" (6–12 months after the outbreak, with a hub) or "hardcore" (the day Calder falls: hardcore.js).
export function createWorld({ seed, factionCount, crew = null, size = DEFAULT_SIZE, mode = "normal", customW = null, customH = null, hives = null }) {
  const rng = new Rng(seed);
  const sdef = isCustom(size) ? customDef(customW, customH) : sizeDef(size);
  const worldSize = sdef.key;
  const map = generateMap(rng, sdef, { hives: clampHives(hives) });
  const state = {
    seed, rng, worldSize, mode: mode === "hardcore" ? "hardcore" : "normal",
    woodcutting: 1, // a world with firewood (save.js: older saves are given it on load)
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

  if (state.mode === "hardcore") {
    hardcoreCreate(state, { factionCount, crew });
    ensureHives(state);
    hardcoreAfterHives(state);
    updateVision(state);
    log(state, `Day 1. Calder is falling. Three of you got out with what you could carry. ${state.factions.length + (state.hardcore?.groups?.bands?.length || 0)} other groups are out there somewhere.`, "info");
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
    stock: { food: 80, water: 50, fuel: 12, meds: 6, ammo: 80, parts: 2, scrap: 25, preserved: 10, jars: 12, wood: 10 },
    radio: false, watchtower: false, buildings: [], construction: [], armory: [],
  });
  const hubBase = state.bases[0];
  for (const t of ["farm_plot", "farm_plot", "ammo_bench", "bunkhouse", "walls"]) addBuilding(hubBase, t);
  createVehicle(state, "truck", { kind: "base", baseId: hubBase.id }, { fuel: 20, condition: 75 });

  createFactions(state, factionCount);
  recomputeOwnership(state);

  for (let i = 0; i < 6; i++) state.survivors.push(makeSurvivor(state, i === 0 ? 1.3 : 1));
  // Starting gear: a few basics spread among the colonists.
  const starts = ["pistol", "machete", "huntrifle", "knife", "knife", "pistol"];
  state.survivors.forEach((s, i) => (s.gear.weapon = { key: starts[i], name: GEAR[starts[i]].name, quality: 1 }));
  state.survivors[0].gear.armor = { key: "vest", name: GEAR.vest.name, quality: 1 };
  state.survivors.forEach((s) => (s.location = { kind: "base", baseId: state.bases[0].id }));
  state.survivors[0].leader = true;
  if (crew) applyCrew(state, crew);
  assignStartingRoles(state);

  ensureHives(state); // the hives mapgen.js placed, with their starting resources (hives.js)
  // Pre-war maps: geography is known, current conditions are not.
  updateVision(state);
  log(state, `Day 1. ${state.bases[0].name} is all that is left. ${state.factions.length} other groups are out there somewhere.`, "info");
  startChronicle(state); // timelapse recording (sim/chronicle.js)
  return state;
}

export function makeSurvivor(state, quality = 1) {
  const rng = state.rng;
  const skills = {};
  for (const k of SKILLS) skills[k] = Math.max(0, Math.min(20, Math.round(rng.range(0, 9) * quality)));
  // Each survivor gets one or two specialties.
  for (let i = 0; i < 2; i++) skills[rng.pick(SKILLS)] += rng.int(3, 7);
  for (const k of SKILLS) skills[k] = Math.min(20, skills[k]);
  const traitKeys = Object.keys(TRAITS);
  const traits = [];
  const count = rng.chance(0.6) ? 1 : 2;
  while (traits.length < count) {
    const t = rng.pick(traitKeys);
    if (!traits.includes(t) && !(t === "brave" && traits.includes("coward")) && !(t === "coward" && traits.includes("brave"))) traits.push(t);
  }
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

// A name nobody in this world has had: no first name twice while one is free (messages use first names), and
// never a full name twice. Two rng picks, as before, unless a full name has to be re-rolled.
const firstOf = (name) => String(name).split(" ")[0];
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
    if (c.leader) s.leader = true;
  });
}

// Starting jobs by skill instead of list order: the two best farmers farm, then the best scavenger scavenges,
// the best shot guards and the best mechanic builds; whoever is left farms too. Nobody starts on the ammo
// bench (the hub opens with plenty of ammo and little food). Also called when the run begins, so skills
// edited on the new-run screen count.
const START_ROLES = [["farm", "farming"], ["farm", "farming"], ["scavenge", "scavenging"], ["guard", "shooting"], ["build", "mechanics"]];
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
export const day = (state) => Math.floor(state.hour / 24) + 1;
export const hourOfDay = (state) => state.hour % 24;
export const isNight = (state) => hourOfDay(state) < 6 || hourOfDay(state) >= 20;

export function log(state, text, kind = "info") {
  const line = { hour: state.hour, text, kind };
  state.log.unshift(line);
  if (state.log.length > 200) state.log.pop();
  diaryRecord(state, line); // every line of the run, day by day (diary.js)
}

export function addCard(state, card) {
  state.cards.push(card);
}

export const hub = (state) => state.bases.find((b) => b.type === "hub");
export const baseById = (state, id) => state.bases.find((b) => b.id === id);
export const survivorById = (state, id) => state.survivors.find((s) => s.id === id);
export const alive = (state) => state.survivors.filter((s) => s.alive);
export const atBase = (state, baseId) => alive(state).filter((s) => s.location.kind === "base" && s.location.baseId === baseId);
export const factionById = (state, id) => state.factions.find((f) => f.id === id);
// Everyone who lives at a base: the people there, plus (at the hub) trade-route escorts waiting between trips.
// Waiting escorts eat, heal and can be treated at the hub; they do no base work (atBase leaves them out).
export function residents(state, baseId) {
  const h = hub(state);
  const hubId = h ? h.id : null;
  return alive(state).filter((s) => (s.location.kind === "base" && s.location.baseId === baseId) || (s.location.kind === "route" && baseId === hubId));
}
const isFree = (s) => s.alive && !(s.location && s.location.kind === "captive");

export function skill(s, key) {
  let v = s.skills[key] || 0;
  if (key === "medicine" && s.traits.includes("medic")) v += 4;
  if (key === "stealth" && s.traits.includes("loud")) v -= 3;
  if (s.traits.includes("lucky")) v += 1;
  return Math.max(0, v);
}

// Skill gap rule from the design doc: slightly below = weaker, below = weaker + damage risk, really below = unusable.
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

export function playerStrength(state) {
  return alive(state).reduce((sum, s) => sum + combatPower(s), 0);
}

// opts.raw: damage that armor and toughness do nothing against (hunger, thirst, infection).
export function hurt(state, s, amount, tileId, cause, opts = {}) {
  if (!opts || !opts.raw) {
    if (s.traits.includes("tough")) amount *= 0.75;
    amount *= armorMult(s);
  }
  s.health -= amount;
  if (s.health <= 0) killSurvivor(state, s, tileId, cause);
  else if (!opts || !opts.raw) woundTrauma(state, s, amount); // a real wound may need dressing (health.js)
}

export function killSurvivor(state, s, tileId, cause, extraItems = []) {
  if (!s.alive) return;
  s.alive = false;
  s.health = 0;
  s.station = null;
  s.inBed = false;
  log(state, `${s.name} died ${cause}.`, "death");
  onDeath(state, s, tileId, cause); // relations.js: grief for friends and a partner, a line on the memorial wall
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
const leaderCandidates = (state) => state.survivors.filter(isFree).sort((a, b) => skill(b, "leadership") - skill(a, "leadership"));
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

function coalitionWins(state) {
  state.victoryReason = "alliance";
  state.allianceWon = true;
  const members = state.alliance ? state.alliance.members.length : 0;
  const pct = Math.round(controlledLand(state).pct * 100);
  // Keep the opening words: the timelapse (chronicle.js) recognises this line by them.
  log(state, `The Calder Coalition holds the State of Calder: ${pct}% of the land, and ${members} member${members === 1 ? "" : "s"} beside you (the groups outside do not count: conquest). ${alive(state).length} survivors made it to day ${day(state)}.`, "good");
  return true;
}

// A base is lost (overrun by a horde, taken in a raid). One place for everything that has to follow: the
// people still there flee to the hub, vehicles parked there are left on the tile (abandoned, with a map
// marker), supply runs to or from it are paused, and the log says what was lost.
export function removeBase(state, base, cause = "was lost") {
  const i = state.bases.indexOf(base);
  if (i < 0 || base.type === "hub") return false;
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
  const stock = SUPPLY_KEYS.filter((k) => (base.stock[k] || 0) >= 1).map((k) => `${Math.floor(base.stock[k])} ${k}`);
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

export function supplyValue(stock) {
  return SUPPLY_KEYS.reduce((s, k) => s + (stock[k] || 0) * SUPPLIES[k].value, 0);
}

// ---------- vision and knowledge ----------
export function baseVision(base) {
  return (base.tier === 0 ? 1 : base.type === "hub" ? HUB_VISION : OUTPOST_VISION) + (base.watchtower ? 2 : 0) + baseOpticsSight(base); // a telescope in the armory (optics.js); a shelter (buildings.js SHELTER, tier 0) sees 1 tile
}

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

export const radioBases = (state) => state.bases.filter((b) => b.radio);

export function liveTiles(state) {
  const set = new Set();
  for (const b of state.bases) for (const id of state.grid.within(b.tile, baseVision(b))) set.add(id);
  // Radio: parties in range report what they see right now.
  for (const p of state.parties) {
    if (p.owner === "player" && p.radioLive) for (const id of p.sightNow || []) set.add(id);
  }
  return set;
}

export function updateVision(state) {
  const live = liveTiles(state);
  state.live = live;
  for (const id of live) {
    state.knowledge[id] = snapshot(state, id);
    for (const f of state.factions) if (f.bases.includes(id)) f.known = true;
  }
  // Hidden sites (discovery.js) the bases and watchtowers see for the first time: a log line.
  for (const b of state.bases) noteFinds(state, state.grid.within(b.tile, baseVision(b)), { base: b });
  updateLiveMarkers(state);
}

// who: the team whose report it is (a hidden site it found gets a log line naming it, discovery.js).
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
export function tickHour(state) {
  if (state.gameOver) return;
  state.hour += 1;
  weatherHour(state); // weather.js: seasons and the day's weather (fixed ahead, so ETAs hold)
  skillsHour(state); // skills.js: travel XP, Pathfinder's pace
  movePartiesHour(state);
  stagingHour(state); // staging.js: the staging camp with no base (work, stores, looters; done: the hub)
  needsHour(state); // needs.js: hunger and thirst at bases and on errands (teams eat in movePartiesHour), teams' treats
  releaseStranded(state); // conflicts.js: a halted team with nothing left to resolve it checks in for orders
  hordesHour(state);
  visitorsHour(state); // visitors.js: raiders, merchants and explorers from outside the state
  if (state.mode === "hardcore") hardcoreHour(state); // hardcore.js: bands on the road (hardcore mode only)
  constructionHour(state);
  craftingHour(state);
  productionHour(state); // production.js: station orders and their fallbacks, power, repeating craft orders
  medicalHour(state);
  diplomacyHour(state); // diplomacy.js: jobs for other groups checked every hour (jobs.js)
  prisonersHour(state); // prisoners.js: rescue raids arriving, prisoners whose team or base is gone
  if (state.hour % 24 === 0) {
    workDayRoles(state); // work.js: people asleep or off at midnight count at their day's work (set again below)
    weatherDaily(state); // first, so the day's farming, water and sickness read today's weather
    basesDaily(state);
    craftingDaily(state);
    vehiclesDaily(state);
    factionsDaily(state);
    hordesDaily(state);
    outbreakDaily(state); // outbreak.js: new hives from beyond the border while the outbreak there burns
    hardcoreDaily(state); // hardcore.js: the first year after the fall (hardcore mode only)
    routesDaily(state);
    supplyDaily(state);
    deathSitesDaily(state);
    walkingDaily(state); // carriers.js: the walking dead drift a tile; a body with the worm left unburied at a base gets up
    captivesDaily(state);
    prisonersDaily(state); // prisoners.js: food, escapes, ransoms, recruiting, rescue raids
    conquestDaily(state); // conquest.js: infamy fades, bases taken from you are patched up by their holders
    radioDaily(state); // radio.js: relay upkeep, groups' water and wares, grudge raids, groups calling you
    visitorsDaily(state); // visitors.js: outsiders crossing the border, guests sheltering at your bases
    skillsDaily(state); // skills.js: XP from the day's work, teaching, reading, decay, perk effects
    surveyDaily(state); // survey.js: rumours of hidden places (radio, travellers, merchants), found ones struck off
    wanderersDaily(state); // wanderers.js: the survivors you met and left live on (or not); no dice of the world's
    recomputeOwnership(state);
    claimsDaily(state); // claims.js: claims under a new base, a hive or a hostile camp are lost
    // eras.js: the Accord's and the containment's clocks (the victories need them to have run: checkGameOver).
    if (!state.gameOver) erasVictoryDaily(state, !state.allianceWon && accordHolds(state), hivesSecured(state));
    ensureLeader(state);
    if (day(state) % 5 === 0) log(state, `Day ${day(state)}. ${alive(state).length} survivors.`, "info");
  }
  // Safety net: no stock below zero, whatever subtracted from it.
  for (const b of state.bases) for (const k of Object.keys(b.stock)) if (b.stock[k] < 0) b.stock[k] = 0;
  checkGameOver(state);
  updateVision(state);
  discoveryHour(state); // discovery.js: hidden sites reported this hour (radio, maps, intel, prisoners, the coalition)
  workHour(state); // work.js: people on work priorities get this hour's job (before stewards, which skip them)
  crewHour(state); // crews.js: crew roles run their own trips and answer their teams' small cards
  if (state.autopilot) autopilotHour(state); // dev tool: the AI governor runs the holdout (autopilot.js)
  else stewardHour(state); // steward.js: bases handed to a steward
  recordChronicle(state); // a timelapse frame once a day (cheap check otherwise)
}
