// World state, shared helpers and the hourly/daily tick.
// Pure simulation: no DOM or canvas code lives here.
import { Rng } from "./rng.js";
import { generateMap } from "./mapgen.js";
import { FIRST_NAMES, LAST_NAMES, SKILLS, TRAITS, GEAR, SUPPLIES, SUPPLY_KEYS } from "./data.js";
import { appearanceFor } from "./appearance.js";
export { radioBasesInRange };

// Bases with a radio station whose range covers a tile.
function radioBasesInRange(state, tileId, extra = 0) {
  return state.bases.filter((b) => b.radio && state.grid.distance(b.tile, tileId) <= RADIO_RANGE + extra);
}
import { createFactions, factionsDaily, recomputeOwnership } from "./factions.js";
import { movePartiesHour } from "./parties.js";
import { hordesHour, hordesDaily } from "./hordes.js";
import { basesDaily, routesDaily, deathSitesDaily } from "./economy.js";
import { addBuilding, constructionHour, assignStations } from "./buildings.js";
import { createVehicle, vehiclesDaily } from "./vehicles.js";
import { updateLiveMarkers, mergeSpots } from "./markers.js";
import { captivesDaily } from "./conflicts.js";
import { supplyDaily } from "./supply.js";
import { medicalHour } from "./medical.js";
import { craftingHour, craftingDaily } from "./crafting.js";
import { armorPower, armorMult, allItems } from "./inventory.js";
import { startChronicle, recordChronicle } from "./chronicle.js";
import { autopilotHour } from "./autopilot.js";

export const HUB_VISION = 3;
export const OUTPOST_VISION = 2;
export const RADIO_RANGE = 8;

let nextId = 1;
export const newId = () => nextId++;

// crew (optional): starting-colonist overrides from the new-run screen, by index:
// [{ name?, skills?, appearance?, leader? }]. Headless tools leave it out.
export function createWorld({ seed, factionCount, crew = null }) {
  const rng = new Rng(seed);
  const map = generateMap(rng);
  const state = {
    seed, rng,
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

  // Player hub: a small town far from the outbreak origin, the cities and the National Guard bases, but not off in a
  // corner of the state: within 30 tiles of a city and a few tiles from the map edge.
  const g = state.grid;
  const towns = state.tiles.filter((t) => t.loc && t.loc.type === "town");
  const farFrom = (t, origin, city, mil) => g.distance(t.id, state.originId) >= origin &&
    state.cityIds.every((c) => g.distance(t.id, c) >= city) && state.militaryIds.every((m) => g.distance(t.id, m) >= mil);
  const central = (t) => t.x >= 4 && t.y >= 3 && t.x < g.width - 4 && t.y < g.height - 3 && state.cityIds.some((c) => g.distance(t.id, c) <= 30);
  const hubCandidates = towns.filter((t) => farFrom(t, 16, 12, 12) && central(t));
  const nearCandidates = towns.filter((t) => farFrom(t, 12, 8, 8));
  const hubTile = rng.pick(hubCandidates.length ? hubCandidates : nearCandidates.length ? nearCandidates : towns);
  state.bases.push({
    id: newId(), tile: hubTile.id, type: "hub", name: `${hubTile.loc.name} Holdout`,
    stock: { food: 45, water: 40, fuel: 24, meds: 6, ammo: 80, parts: 2, scrap: 25 },
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
  const roles = ["farm", "farm", "scavenge", "operate", "guard", "build"];
  state.survivors.forEach((s, i) => (s.role = roles[i]));
  state.survivors[0].leader = true;
  if (crew) applyCrew(state, crew);
  assignStations(state, hubBase);

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
    name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
    skills, traits, health: 100, mood: 60, alive: true, leader: false,
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

// Starting-colonist overrides (new-run screen). Never touches state.rng.
export function applyCrew(state, crew) {
  if (crew.some((c) => c && c.leader)) state.survivors.forEach((s) => (s.leader = false));
  state.survivors.forEach((s, i) => {
    const c = crew[i];
    if (!c) return;
    if (c.name && String(c.name).trim()) s.name = String(c.name).trim();
    if (c.skills) for (const k of SKILLS) if (c.skills[k] != null) s.skills[k] = Math.max(0, Math.min(20, Math.round(c.skills[k])));
    if (c.appearance) s.appearance = { ...c.appearance };
    if (c.leader) s.leader = true;
  });
}

// ---------- shared helpers ----------
export const day = (state) => Math.floor(state.hour / 24) + 1;
export const hourOfDay = (state) => state.hour % 24;
export const isNight = (state) => hourOfDay(state) < 6 || hourOfDay(state) >= 20;

export function log(state, text, kind = "info") {
  state.log.unshift({ hour: state.hour, text, kind });
  if (state.log.length > 200) state.log.pop();
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
  if (s.traits.includes("coward")) p -= 1;
  return Math.max(0.5, p * (0.5 + s.health / 200));
}

export function playerStrength(state) {
  return alive(state).reduce((sum, s) => sum + combatPower(s), 0);
}

export function hurt(state, s, amount, tileId, cause) {
  if (s.traits.includes("tough")) amount *= 0.75;
  amount *= armorMult(s);
  s.health -= amount;
  if (s.health <= 0) killSurvivor(state, s, tileId, cause);
}

export function killSurvivor(state, s, tileId, cause, extraItems = []) {
  if (!s.alive) return;
  s.alive = false;
  s.health = 0;
  log(state, `${s.name} died ${cause}.`, "death");
  // Death site: the body and everything carried stays where they fell. item = the real item (a pack keeps its
  // contents), so looting the body after a battle can take it off the site (inventory.js).
  const items = [];
  for (const g of allItems(s)) items.push({ kind: "gear", key: g.key, name: `${s.name.split(" ")[0]}'s ${g.name}`, qty: 1, value: GEAR[g.key].value * (g.quality || 1), item: g });
  items.push(...extraItems);
  if (tileId != null) {
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
  if (s.leader) {
    s.leader = false;
    const next = alive(state).sort((a, b) => skill(b, "leadership") - skill(a, "leadership"))[0];
    if (next) {
      addCard(state, {
        title: "The leader is dead",
        text: `${s.name} is gone. The group needs someone to lead. Morale drops across the hub.`,
        choices: alive(state).slice(0, 6).map((c) => ({
          label: `${c.name} (Leadership ${skill(c, "leadership")})`,
          resolve: (st) => {
            c.leader = true;
            alive(st).forEach((o) => (o.mood = Math.max(0, o.mood - 15)));
            return `${c.name} now leads the group.`;
          },
        })),
      });
    }
  }
  if (!alive(state).length) {
    state.gameOver = true;
    log(state, "Every survivor is dead. The holdout has fallen.", "death");
  }
}

export function supplyValue(stock) {
  return SUPPLY_KEYS.reduce((s, k) => s + (stock[k] || 0) * SUPPLIES[k].value, 0);
}

// ---------- vision and knowledge ----------
export function baseVision(base) {
  return (base.type === "hub" ? HUB_VISION : OUTPOST_VISION) + (base.watchtower ? 2 : 0);
}

export function snapshot(state, tileId) {
  const t = state.tiles[tileId];
  const hordeSize = state.hordes.filter((h) => h.tile === tileId).reduce((s, h) => s + h.size, 0);
  const factionBase = state.factions.find((f) => f.alive && f.bases.includes(tileId));
  return {
    hour: state.hour,
    owner: t.owner,
    factionBase: factionBase ? factionBase.id : null,
    hordeSize,
    infection: t.infection,
    loot: t.loot,
    nest: t.nest,
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
  updateLiveMarkers(state);
}

export function mergeKnowledge(state, seen, spotted) {
  if (spotted) mergeSpots(state, spotted);
  // seen: Map tileId -> snapshot recorded by a party. Keep the newest per tile.
  for (const [id, snap] of seen) {
    const cur = state.knowledge[id];
    if (!cur || cur.hour <= snap.hour) state.knowledge[id] = snap;
    if (snap.factionBase) {
      const f = factionById(state, snap.factionBase);
      if (f) f.known = true;
    }
  }
}

// ---------- tick ----------
export function tickHour(state) {
  if (state.gameOver) return;
  state.hour += 1;
  movePartiesHour(state);
  hordesHour(state);
  constructionHour(state);
  craftingHour(state);
  medicalHour(state);
  if (state.hour % 24 === 0) {
    basesDaily(state);
    craftingDaily(state);
    vehiclesDaily(state);
    factionsDaily(state);
    hordesDaily(state);
    routesDaily(state);
    supplyDaily(state);
    deathSitesDaily(state);
    captivesDaily(state);
    recomputeOwnership(state);
    if (day(state) % 5 === 0) log(state, `Day ${day(state)}. ${alive(state).length} survivors.`, "info");
  }
  updateVision(state);
  if (state.autopilot) autopilotHour(state); // dev tool: the AI governor runs the holdout (autopilot.js)
  recordChronicle(state); // a timelapse frame once a day (cheap check otherwise)
}
