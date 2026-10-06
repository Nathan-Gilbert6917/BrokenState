// Hardcore mode, the other groups (hardcore.js): bands that found their hubs, the military's stand against the hives,
// and no raiders for the first months. Nothing here runs in a normal game.
//
// Bands (HC_GROUPS.BAND)
// - Every group but the military starts the way you do: a band of survivors on the road with no base. A band already
//   is what it will become (traders, a commune, a fortress, zealots or expansionists; never raiders at the start) and
//   carries more than you do, by type: traders fuel, meds, parts and preserved food to trade; a commune food, tools
//   (parts, scrap) and jars; a fortress people and ammo; zealots numbers; expansionists ammo. 8–22 people.
// - It starts START_MIN–START_MAX tiles from you (by the square root of the map's area on other sizes), near a site its
//   type likes, and walks (SPEED a turn of the clock, from DAY_FROM to DAY_TO) to the site it means to settle: one of
//   its type's preferred sites (factions.js PREFERRED_SITES), not in a city, away from you, other groups and the hives.
//   With time to spare it scavenges a site on the way (SCAV_DAYS days). At its site it camps and strips the place until
//   its founding day (FOUND_DAYS after the fall, by the seed), then founds its hub: it becomes one of the map's groups
//   (state.factions, the same id, name, colour, people, stores and goodwill) and lives like any group from then on.
//   A band whose site is taken (by you, another group, the hives) picks another; one still on the road FORCE_AFTER days
//   after its founding day settles the nearest free site where it stands.
// - On the road: it eats EAT a head a day and forages FORAGE; out of food it loses people (STARVE a day). A horde on
//   its way costs it people (a horde of HORDE_BITE about one) and loses HORDE_KILL × its strength.
// - Not in state.factions until it has a base, so nothing that reads the groups (diplomacy, radio, trade, wars, the
//   coalition's land, conquest, jobs) ever meets a group without a base. It lives in state.hardcore.groups.bands and is
//   drawn on the map as a party when you can see it (ui/render.js), listed in the Groups tab once met (ui/diplomacy.js).
// - Meeting one: a team of yours within a tile of a band gets a card: trade news (goodwill, what they saw on your map,
//   where they are heading), give them food, ask a friendly band for help (a little of what its type carries), or go on.
//   What they think of you then is what the group thinks of you when it has its hub.
//
// The military (HC_MILITARY): how the Guard fell, the first weeks of the hardcore era
// - Always there: its base on one of the map's military sites (state.militaryIds, at least MIN_FROM_YOU tiles from
//   you when it can), POP soldiers with plenty of ammo, known from the start. It neither expands nor grows: the base
//   is closed to civilians and cut off.
// - The strike. On its strike day (STRIKE_DAY, from the seed) it sends STRIKE_SHARE of its soldiers against the first
//   hive, in the city where the outbreak began (hardcore-outbreak.js hcOutbreakCity): a column of trucks on the map
//   (state.hardcore.groups.military.strike, drawn like a group's convoy where you can see it) that drives there by day
//   (STRIKE_SPEED). At the city it fights FIGHT_DAYS days by the numbers: its guns cut down FIGHT_KILL of the dead a
//   soldier a day, the city's dead first (CITY_DEAD, more where the city is thick with them, CITY_REFILL more pouring
//   in each day) and then the hive's guard (at most HIVE_HURT of it) and HIVE_RES of its stores a day; it loses
//   FIGHT_LOSS of its soldiers in all (more the more of the dead there were against its guns). The hive survives,
//   weakened. The survivors break off and fall back to a site CUT_OFF_R tiles from the hive, and the road home is
//   cut: they hold out there while the base's hive stands (HOLD_MAX days at most), and go home when it is gone.
//   Radio lines, a timelapse caption, a card when you are in contact (a radio at your hub, a friendly Guard) or see it.
// - Meanwhile the dead mass near the base and build a hive while the garrison is thin (hardcore-outbreak.js), whose
//   hordes grind the garrison down (factions.js resolveRaidOnFaction). It fights back: sorties (SORTIE_CHANCE a day
//   against a free horde within SORTIE_RANGE: kills SORTIE_KILL × its strength, sometimes a soldier lost) and culls
//   (every CULL_GAP days against a hive within CULL_RANGE: CULL_RES of the hive's stores and CULL_GUARD of its guard;
//   before the hive stands, CULL_MASS of the gathering mass). Destroy the hive and the hordes stop.
// - With HELP_AT of the garrison left it asks you for help (a card, with a hub): 40 ammo (harder sorties for
//   SUPPLY_DAYS days) or 6 meds (MEDS_POP wounded back on the walls). At EVAC_AT it sends its civilians to you.
// - It falls when the garrison is ground down to GARRISON_BREAK of what stayed (BREAK_MIN at least), its base is lost
//   or the group is broken: the base is a ruin full of the dead (a horde of the fallen, infection, the armory's loot
//   left behind), DEAD of the last defenders die, 1–3 reach you as recruits. The military is gone, and what is left of
//   it becomes groups of its own: the garrison's survivors (the "Holdouts" of the base, a fortress) and the strike
//   force's stragglers ("Remnant of the 3rd Battalion", military), each a band on the road (as the first bands) that
//   founds its hub somewhere defensible SPLINTER_FOUND days later; too few for one (under FOUND_MIN) join the other,
//   and too few in all make for a peaceful group or come to you. The fortress one may turn to raiding once the
//   raiders' day comes (raidersDaily: a splinter counts as desperate). A last radio message, a card and a timelapse
//   caption.
//
// Raiders (HC_GROUPS.RAIDERS_FROM)
// - No raider groups at the start, no outsider raider bands (visitors.js) and no new gangs (factions.js newGangs)
//   until state.hardcore.raidersFrom (RAIDERS_FROM × the era offset, the day the normal game would start: about days
//   35–112 by the seed). From then a struggling group may turn to raiding (TURN_BASE a day, more when hungry, small or aggressive; the most desperate one by TURN_BY days at the latest; at
//   most TURN_MAX this way), and outsider bands and gangs come as in a normal game.
// - The aggressive groups (zealots, expansionists) do not raid and nobody declares war while the bands are still
//   founding: until QUIET_GRACE days after the last band has its hub (QUIET_MAX at the latest).
// Decisions draw from their own generator (state.hardcore.groups.rng), so they never shift the world's dice.
import { Rng } from "./rng.js";
import { FACTION_TYPES, FACTION_COLORS } from "./data.js";
import { newId, log, addCard, day, hub, factionById, snapshot, hourOfDay } from "./world.js";
import { PREFERRED_SITES, attitude, strength, isAggressiveType, recomputeOwnership, clearStaleAlerts, changeGoodwill } from "./factions.js";
import { planPath, moveCost, partyMembers, partyTile, tileLabel, removeParty, carried, takeSupply } from "./parties.js";
import { isHardcore } from "./hardcore.js";
import { hash01 } from "./skills.js";
import { haulFor, AISCAV } from "./aiscav.js";
import { reduceHorde, makeHorde } from "./hordes.js";
import { mergeMix } from "./zombietypes.js";
import { worldScale } from "./worldsize.js";
import { chronicleNote } from "./chronicle.js";
import { makeCandidate, offerRecruits } from "./recruits.js";
import { changeRelation } from "./diplomacy.js";
import { isMember } from "./alliance.js";
import { hiveById } from "./hives.js";
import { findPath } from "./hex.js";
import { hcOutbreak, hcOutbreakCity } from "./hardcore-outbreak.js";

export const HC_GROUPS = {
  // What a band starts with, by the type it will become (you: 3 people, about 10 food, 10 water, 6 ammo).
  BAND: {
    traders:      { pop: [8, 12],  stock: { food: 45, water: 30, fuel: 35, ammo: 50, meds: 10, parts: 6, scrap: 30, preserved: 15, jars: 6 } },
    commune:      { pop: [10, 15], stock: { food: 110, water: 40, fuel: 6, ammo: 25, meds: 6, parts: 8, scrap: 35, preserved: 25, jars: 12 } },
    fortress:     { pop: [12, 17], stock: { food: 60, water: 30, fuel: 10, ammo: 150, meds: 8, parts: 4, scrap: 40, preserved: 15, jars: 0 } },
    zealot:       { pop: [16, 22], stock: { food: 50, water: 30, fuel: 4, ammo: 60, meds: 4, parts: 1, scrap: 20, preserved: 8, jars: 0 } },
    expansionist: { pop: [10, 14], stock: { food: 45, water: 25, fuel: 15, ammo: 170, meds: 6, parts: 3, scrap: 25, preserved: 8, jars: 0 } },
  },
  TYPES: ["traders", "commune", "fortress", "zealot", "expansionist"],
  START_MIN: 14, START_MAX: 34, START_APART: 7, START_NEAR_PREF: 6, HIVE_CLEAR: 5,
  GOAL_REACH: 22, GOAL_FROM_YOU: 10, GOAL_APART: 8, GOAL_HIVE: 6, SPLINTER_HIVE: 10, SPLINTER_BITE: 0.3,
  FOUND_DAYS: [8, 29], FORCE_AFTER: 10, FORCE_RADIUS: 3,
  SPEED: 0.6, DAY_FROM: 6, DAY_TO: 20,
  EAT: 0.7, FORAGE: 0.5, STARVE: 0.3, ROAD_DEATH: 0.015,
  SCAV_TAKE: 0.05, SCAV_EFF: 0.8, SCAV_DAYS: 2, STOP_DETOUR: 4, STOP_LOOT: 0.2, STOP_INF: 0.6,
  HORDE_KILL: 1.5, HORDE_BITE: 30, MEET_GW: 5, GIFT_GW: 12, ASK_GW: -2,
  QUIET_GRACE: 10, QUIET_MAX: 60,
  // The raiders' day: RAIDERS_FROM × the era offset (the day the normal game would start, state.hardcore.eraOffset
  // from the outbreak work; ERA_OFFSET by the seed when it is not there).
  RAIDERS_FROM: [0.6, 1.0], ERA_OFFSET: [56, 112], TURN_BASE: 0.004, TURN_BY: 14, TURN_MAX: 2,
};
export const HC_MILITARY = {
  POP: [36, 46], MIN_FROM_YOU: 12, HIVE_RANGE: 10, BREAK_POP: 10,
  // The strike on the city hive.
  STRIKE_DAY: [3, 12], STRIKE_SHARE: [0.5, 0.65], STRIKE_SPEED: 1.0, STRIKE_KEEP: 13,
  FIGHT_DAYS: [2, 4], FIGHT_KILL: [5, 9], FIGHT_LOSS: [0.5, 0.7], CITY_DEAD: [500, 900], CITY_REFILL: [60, 140],
  HIVE_HURT: 0.6, HIVE_RES: [2, 5], CUT_OFF_R: [3, 8], HOLD_MAX: 60, HOLD_DEATH: 0.02, SEE_R: 8,
  // The garrison that stayed.
  GARRISON_BREAK: 0.65, BREAK_MIN: 8,
  SORTIE_RANGE: 6, SORTIE_CHANCE: 0.3, SORTIE_KILL: [0.6, 1.2], SORTIE_LOSS: 0.25,
  CULL_GAP: [10, 16], CULL_RANGE: 12, CULL_RES: [2, 5], CULL_GUARD: [0.1, 0.2], CULL_MASS: [0.08, 0.16], CULL_LOSS: 0.4,
  HELP_AT: 0.85, EVAC_AT: 0.7, SUPPLY_DAYS: 14, MEDS_POP: 2,
  // The fall, and the groups it leaves.
  DEAD: [0.1, 0.25], FOUND_MIN: 4, HOLD_MIN: 5, SPLINTER_GRAB: 0.2, SPLINTER_TURN: 0.5, JOIN_RANGE: 20, RUIN_LOOT: 0.7, FALLEN_HORDE: [0.6, 1.0], FALLEN_SOLDIER: 0.6, SPLINTER_FOUND: [8, 20],
};
const B = HC_GROUPS, M = HC_MILITARY;
const STOCK_KEYS = ["food", "water", "fuel", "ammo", "meds", "parts", "scrap", "preserved", "jars"];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
// How a band looks on the road (cards, the tile panel).
const LOOK = {
  traders: "a convoy of handcarts and a pickup piled with crates",
  commune: "farm families with carts of seed, tools and jars",
  fortress: "a column of armed men and women keeping good order",
  zealot: "a crowd of the faithful singing as they walk",
  expansionist: "hard-faced people with good rifles and a flag",
  military: "soldiers in torn uniforms, carrying their wounded",
};
// Who settled, as travellers tell it.
const WHO = {
  traders: "traders", commune: "farm families", fortress: "an armed band digging in", zealot: "a crowd of zealots",
  expansionist: "an armed band raising a flag", military: "soldiers", raider: "desperate people with guns",
};

// ---------- state ----------
export function hcGroups(state) {
  if (!state.hardcore) state.hardcore = {};
  const hc = state.hardcore;
  if (!hc.groups) {
    hc.groups = {
      rng: new Rng(Math.floor(hash01(state.seed, "hc-groups") * 4294967296) >>> 0),
      bands: [], military: null, quietUntil: null, turned: 0, raidersOut: false, founded: 0,
    };
  }
  return hc.groups;
}
// The day the normal game would start (the outbreak work's state.hardcore.eraOffset; ours by the seed without it).
export function hcEraOffset(state) {
  const hc = state.hardcore || {};
  if (Number.isFinite(hc.eraOffset)) return hc.eraOffset;
  const H = hcGroups(state);
  if (H.eraOffset == null) H.eraOffset = B.ERA_OFFSET[0] + Math.floor(hash01(state.seed, "hc-era") * (B.ERA_OFFSET[1] - B.ERA_OFFSET[0] + 1));
  return H.eraOffset;
}
// state.hardcore.raidersFrom: RAIDERS_FROM × the era offset, set once (after the outbreak's setup: hardcore.js).
export function hcRaidersFrom(state) {
  hcGroups(state);
  const hc = state.hardcore;
  if (hc.raidersFrom == null) hc.raidersFrom = Math.round((B.RAIDERS_FROM[0] + (B.RAIDERS_FROM[1] - B.RAIDERS_FROM[0]) * hash01(state.seed, "hc-raiders")) * hcEraOffset(state));
  return hc.raidersFrom;
}
// createWorld, after the outbreak's setup (hardcore.js hardcoreAfterHives): the raiders' day, from its era offset.
export function hardcoreGroupsAfterOutbreak(state) {
  if (isHardcore(state)) hcRaidersFrom(state);
}
const grng = (state) => hcGroups(state).rng;
export const bandsOf = (state) => (state.hardcore && state.hardcore.groups ? state.hardcore.groups.bands : []);
export const knownBands = (state) => bandsOf(state).filter((b) => b.known);
export const bandById = (state, id) => bandsOf(state).find((b) => b.id === id) || null;

// Where you are: your hub (or any base), else your team on the road (the hubless start, hardcore-start.js).
export function hcPlayerTile(state) {
  const h = hub(state) || state.bases[0];
  if (h) return h.tile;
  const p = state.parties.find((q) => q.owner === "player" && q.path && q.path.length && partyMembers(state, q).length);
  return p ? partyTile(p) : null;
}

// ---------- the switches other modules read ----------
// No raider groups, outsider raider bands or new gangs yet (factions.js, visitors.js).
export function hcNoRaiders(state) {
  if (!isHardcore(state)) return false;
  return day(state) < hcRaidersFrom(state);
}
// The aggressive groups' raids and new wars wait while the bands are still founding (factions.js, diplomacy.js).
export function hcGroupRaidsQuiet(state) {
  if (!isHardcore(state)) return false;
  const H = hcGroups(state), d = day(state);
  if (d >= B.QUIET_MAX) return false;
  return H.quietUntil == null || d < H.quietUntil;
}

// ---------- setup (createWorld) ----------
export function setupHardcoreGroups(state, factionCount) {
  const H = hcGroups(state);
  const rng = H.rng;
  const n = Math.max(1, factionCount || 1);
  const rest = [rng.pick(["fortress", "expansionist"]), rng.pick(["traders", "commune"])];
  while (rest.length < n - 1) rest.push(rng.pick(B.TYPES));
  rng.shuffle(rest);
  const used = new Set();
  const nameFor = (type) => {
    const def = FACTION_TYPES[type];
    const free = def.names.filter((x) => !used.has(x));
    const name = free.length ? rng.pick(free) : ["II", "III", "IV", "V", "VI", "VII"].map((r) => `${def.names[0]} ${r}`).find((x) => !used.has(x)) || `${def.names[0]} ${used.size}`;
    used.add(name);
    return name;
  };
  createMilitary(state, nameFor("military"), FACTION_COLORS[0]);
  rest.slice(0, n - 1).forEach((type, i) => makeBand(state, type, { name: nameFor(type), color: FACTION_COLORS[(i + 1) % FACTION_COLORS.length] }));
  recomputeOwnership(state);
}

function createMilitary(state, name, color) {
  const H = hcGroups(state), rng = H.rng, g = state.grid;
  const pt = hcPlayerTile(state);
  const dist = (id) => (pt == null ? 99 : g.distance(id, pt));
  let sites = (state.militaryIds || []).filter((id) => state.tiles[id]);
  if (!sites.length) sites = state.tiles.filter((t) => t.loc && PREFERRED_SITES.military.includes(t.loc.type)).map((t) => t.id);
  if (!sites.length) sites = state.tiles.filter((t) => t.loc && t.loc.type !== "city").map((t) => t.id);
  const far = sites.filter((id) => dist(id) >= M.MIN_FROM_YOU);
  const tile = far.length ? rng.pick(far) : [...sites].sort((a, b) => dist(b) - dist(a) || a - b)[0];
  const def = FACTION_TYPES.military;
  const pop = rng.int(M.POP[0], M.POP[1]);
  const f = {
    id: newId(), name, type: "military", color, bases: [tile], pop, alive: true, known: true,
    goodwill: def.goodwill + rng.int(-5, 10), lastDiplomacy: 0, pact: null,
    stock: { food: pop * 8, ammo: pop * 25, fuel: pop * 2, meds: Math.round(pop * 1.5), parts: 6, scrap: pop * 3, preserved: pop, jars: 0, water: pop * 6 },
    lootedGear: [], raidCooldown: rng.int(8, 16), hcMilitary: true, hcNoExpand: true, hcNoGrow: true,
  };
  state.factions.push(f);
  if (state.tiles[tile].ruin) delete state.tiles[tile].ruin;
  H.military = {
    id: f.id, tile, startPop: pop, lastPop: pop, fell: false, fellDay: null, how: null, nextCull: rng.int(M.CULL_GAP[0], M.CULL_GAP[1]),
    sorties: 0, culls: 0, killed: 0, lost: 0, helpAsked: false, evacSent: false, suppliedUntil: 0, hiveSince: null, lastSortieLog: -99,
    // The strike on the city hive (hardcore-outbreak.js reads the day for when the dead mass by the base).
    strikeDay: M.STRIKE_DAY[0] + Math.floor(hash01(state.seed, "hc-strike") * (M.STRIKE_DAY[1] - M.STRIKE_DAY[0] + 1)),
    strike: null, garrison: null, breakPop: M.BREAK_POP, splinters: [],
  };
  log(state, `The National Guard still holds ${tileLabel(state, tile)}: ${name}, about ${Math.round(pop / 5) * 5} soldiers. Their radio says the base is closed to civilians.`, "info");
  return f;
}

// A band on the road. opts: { name, color, tile (start), pop, stock, remnant, joinId, foundAt }. Returns the band or null.
export function makeBand(state, type, opts = {}) {
  const H = hcGroups(state), rng = H.rng, g = state.grid;
  const def = FACTION_TYPES[type];
  const cfg = B.BAND[type] || B.BAND.fortress;
  const tile = opts.tile != null ? opts.tile : bandStart(state, type);
  if (tile == null) return null;
  const pop = opts.pop || rng.int(cfg.pop[0], cfg.pop[1]);
  const stock = {};
  for (const k of STOCK_KEYS) stock[k] = 0;
  const src = opts.stock || cfg.stock;
  for (const [k, q] of Object.entries(src)) stock[k] = Math.max(0, Math.round(q * (opts.stock ? 1 : rng.range(0.85, 1.15))));
  const d = day(state);
  const foundAt = opts.foundAt != null ? opts.foundAt : d - 1 + B.FOUND_DAYS[0] + Math.floor(hash01(state.seed, "hc-found", H.bands.length, type) * (B.FOUND_DAYS[1] - B.FOUND_DAYS[0] + 1));
  const b = {
    id: newId(), name: opts.name || def.names[0], type, color: opts.color || FACTION_COLORS[(state.factions.length + H.bands.length) % FACTION_COLORS.length],
    pop, stock, goodwill: opts.goodwill != null ? opts.goodwill : def.goodwill + rng.int(-8, 8), known: false, met: false, metTeams: [], destKnown: false,
    tile, path: [tile], idx: 0, progress: 0, phase: "camp", stops: [], goal: null, joinId: opts.joinId ?? null,
    foundAt, forceAt: foundAt + B.FORCE_AFTER, campUntil: 0, started: d, remnant: !!opts.remnant, helped: false, lastSeen: null, act: "on the road",
  };
  if (opts.splinter) { b.splinter = true; b.splinterOf = opts.splinter; } // what was left of the military (militaryFalls)
  H.bands.push(b);
  planRoute(state, b);
  return b;
}

function scaled(state, n) { return Math.round(n * Math.sqrt(worldScale(state))); }
const blocked = (t) => t.terrain === "water" || t.terrain === "mountain";

// Where a band is when the state falls: away from you, from the other bands and the hives, near a site its type likes.
function bandStart(state, type) {
  const H = hcGroups(state), rng = H.rng, g = state.grid;
  const pt = hcPlayerTile(state);
  const lo = scaled(state, B.START_MIN), hi = scaled(state, B.START_MAX);
  const hives = state.tiles.filter((t) => t.hive).map((t) => t.id);
  const city = hcOutbreakCity(state); // the first hive rises there (hardcore-outbreak.js, set up after the bands)
  if (city != null) hives.push(city);
  const pref = new Set(PREFERRED_SITES[type] || []);
  const others = [...H.bands.map((b) => b.tile), ...state.factions.flatMap((f) => f.bases)];
  const cands = [];
  for (const t of state.tiles) {
    if (blocked(t) || t.hive || (t.loc && (t.loc.type === "city" || t.loc.zone === "urban"))) continue;
    const d = pt == null ? lo : g.distance(t.id, pt);
    if (d < lo || d > hi) continue;
    if (hives.some((h) => g.distance(h, t.id) < B.HIVE_CLEAR)) continue;
    if (others.some((o) => g.distance(o, t.id) < B.START_APART)) continue;
    cands.push(t);
  }
  if (!cands.length) {
    // A small map or a crowded one: anywhere on land away from you.
    const any = state.tiles.filter((t) => !blocked(t) && !t.hive && (pt == null || g.distance(t.id, pt) >= Math.min(lo, 8)));
    return any.length ? rng.pick(any).id : null;
  }
  const near = (t) => g.within(t.id, B.START_NEAR_PREF).some((id) => { const s = state.tiles[id]; return s.loc && pref.has(s.loc.type); });
  return rng.weighted(cands, (t) => (near(t) ? 3 : 1) * (t.road ? 1.5 : 1)).id;
}

// Can this tile still be a band's hub? (Nobody holds it or stands too close, no hive near.)
function goalOk(state, b, id, strict = true) {
  const g = state.grid, t = state.tiles[id];
  if (!t || !t.loc || blocked(t) || t.hive || t.loc.type === "city") return false;
  if (strict && t.loc.zone === "urban") return false;
  if (t.owner != null) return false;
  if (state.bases.some((x) => g.distance(x.tile, id) < (strict ? B.GOAL_FROM_YOU : 3))) return false;
  const apart = strict ? B.GOAL_APART : 4;
  if (state.factions.some((f) => f.alive && f.bases.some((x) => g.distance(x, id) < apart))) return false;
  if (bandsOf(state).some((o) => o !== b && o.goal != null && !o.joinId && g.distance(o.goal, id) < apart)) return false;
  const hiveR = strict ? (b.splinter ? B.SPLINTER_HIVE : B.GOAL_HIVE) : 3; // the military's splinters know what a hive does
  if ((state.hives || []).some((h) => g.distance(h.tile, id) < hiveR) || (state.hiveSites || []).some((s) => g.distance(s.tile, id) < hiveR)) return false;
  if (!state.hives && state.tiles.some((x) => x.hive && g.distance(x.id, id) < hiveR)) return false;
  return true;
}

function pickGoal(state, b) {
  const g = state.grid, rng = grng(state);
  const pt = hcPlayerTile(state);
  const reach = scaled(state, B.GOAL_REACH);
  const pref = PREFERRED_SITES[b.type] || PREFERRED_SITES.fortress;
  const cands = [];
  for (const id of g.within(b.tile, reach)) {
    if (!goalOk(state, b, id)) continue;
    if (pt != null && g.distance(pt, id) < B.GOAL_FROM_YOU) continue;
    const t = state.tiles[id];
    const i = pref.indexOf(t.loc.type);
    const w = i < 0 ? 0.25 : Math.max(0.6, 1.6 - i * 0.25);
    cands.push({ id, w: (w * (0.4 + (t.loot || 0))) / (1 + g.distance(b.tile, id) / 10) });
  }
  if (!cands.length) return null;
  const goodOnes = cands.filter((c) => c.w >= 0.2);
  return rng.weighted(goodOnes.length ? goodOnes : cands, (c) => c.w).id;
}

// The way to the hub site, through a site to scavenge when there is time for it.
function planRoute(state, b) {
  const g = state.grid;
  if (b.joinId != null) {
    const f = factionById(state, b.joinId);
    if (f && f.alive && f.bases.length) { b.goal = f.bases[0]; return setPath(state, b, [{ tile: b.goal, kind: "join" }]); }
    b.joinId = null;
  }
  const goal = pickGoal(state, b);
  b.goal = goal;
  if (goal == null) { b.stops = []; b.path = [b.tile]; b.idx = 0; b.phase = "camp"; b.act = "looking for a place to settle"; return false; }
  const stops = [];
  const spare = b.foundAt - day(state) - Math.ceil(g.distance(b.tile, goal) / 6);
  if (spare >= B.SCAV_DAYS + 3) {
    const direct = g.distance(b.tile, goal);
    let best = null;
    for (const id of g.within(b.tile, Math.max(4, direct))) {
      const t = state.tiles[id];
      if (!t.loc || blocked(t) || t.hive || t.owner != null || (t.loot || 0) < B.STOP_LOOT || id === goal || t.loc.type === "city") continue;
      if (t.ruin || (t.infection || 0) >= B.STOP_INF) continue; // not where the dead are thick (a fallen base, a hive's city)
      if (g.distance(b.tile, id) + g.distance(id, goal) - direct > B.STOP_DETOUR) continue;
      if (state.bases.some((x) => g.distance(x.tile, id) < 4)) continue;
      const s = (t.loot || 0) / (1 + g.distance(b.tile, id) / 8);
      if (!best || s > best.s) best = { id, s };
    }
    if (best) stops.push({ tile: best.id, kind: "scav" });
  }
  stops.push({ tile: goal, kind: "settle" });
  return setPath(state, b, stops);
}
// A way on the road that goes around the hives (their guards would eat a band alive); vehicle: by truck.
function bandPath(state, from, to, vehicle = false) {
  const hives = new Set((state.hives || []).map((h) => h.tile));
  if (!hives.size) return planPath(state, from, to, vehicle);
  return findPath(state.grid, from, to, (a, c) => (hives.has(c) && c !== to ? Infinity : moveCost(state, a, c, vehicle)));
}
function setPath(state, b, stops) {
  b.stops = stops;
  return nextLeg(state, b);
}
function nextLeg(state, b) {
  while (b.stops.length) {
    const s = b.stops[0];
    if (s.tile === b.tile) { arriveAt(state, b); return true; }
    const res = bandPath(state, b.tile, s.tile);
    if (res) {
      b.path = res.path; b.idx = 0; b.progress = 0; b.phase = "travel";
      b.act = s.kind === "scav" ? `heading for ${tileLabel(state, s.tile)} to scavenge` : s.kind === "join" ? "looking for people to take them in" : "heading for a place to settle";
      return true;
    }
    b.stops.shift();
  }
  b.path = [b.tile]; b.idx = 0; b.phase = "camp";
  return false;
}
function arriveAt(state, b) {
  const s = b.stops[0];
  b.path = [b.tile]; b.idx = 0; b.progress = 0; b.phase = "camp";
  if (!s) return;
  if (s.kind === "scav") { b.campUntil = state.hour + 24 * B.SCAV_DAYS; b.act = `scavenging ${tileLabel(state, b.tile)}`; }
  else if (s.kind === "settle") b.act = `camped at ${tileLabel(state, b.tile)}, making it their own`;
  else b.act = "at the gates of another group";
}

// ---------- the hour (hardcore.js) ----------
export function hardcoreGroupsHour(state) {
  if (!isHardcore(state) || !state.hardcore || !state.hardcore.groups) return;
  const live = state.live || new Set();
  for (const b of [...bandsOf(state)]) {
    if (!bandsOf(state).includes(b)) continue;
    moveBand(state, b);
    if (!bandsOf(state).includes(b)) continue;
    if (live.has(b.tile)) {
      if (!b.known) {
        b.known = true;
        log(state, `Your people spotted a band on the road near ${tileLabel(state, b.tile)}: ${LOOK[b.type] || "survivors"}, about ${roundPop(b.pop)} of them.`, "info");
      }
      b.lastSeen = { tile: b.tile, hour: state.hour };
    }
    meetTeams(state, b);
  }
  moveStrike(state);
}
const roundPop = (n) => (n >= 10 ? Math.round(n / 5) * 5 : n);

function moveBand(state, b) {
  if (b.phase !== "travel" || !b.path || b.idx >= b.path.length - 1) return;
  const h = hourOfDay(state);
  if (h < B.DAY_FROM || h >= B.DAY_TO) return;
  b.progress += B.SPEED;
  while (b.idx < b.path.length - 1) {
    const from = b.path[b.idx], to = b.path[b.idx + 1];
    const cost = moveCost(state, from, to, false);
    if (!Number.isFinite(cost)) { b.path = b.path.slice(0, b.idx + 1); break; }
    if (b.progress < cost) break;
    b.progress -= cost;
    b.idx += 1;
    b.tile = to;
    if (hordeBite(state, b) && !bandsOf(state).includes(b)) return;
  }
  if (b.idx >= b.path.length - 1) {
    arriveAt(state, b);
  }
}

// A horde on the band's tile: people die, the dead thin out.
function hordeBite(state, b) {
  const hz = state.hordes.find((x) => x.tile === b.tile);
  if (!hz) return false;
  const rng = grng(state);
  const power = b.pop * (FACTION_TYPES[b.type] ? FACTION_TYPES[b.type].arms : 1);
  let lost = Math.min(b.pop, Math.max(0, Math.round((hz.size / B.HORDE_BITE) * rng.range(0.4, 1.2))));
  // Soldiers (the military's splinters) fight their way through: fewer lost, and never most of them at once.
  // They scatter before the dead and regroup: a bite does not leave them too few to found their hub.
  if (b.splinter) lost = Math.max(0, Math.min(Math.round(lost / (FACTION_TYPES[b.type] ? FACTION_TYPES[b.type].arms : 1)), Math.ceil(b.pop * B.SPLINTER_BITE), b.pop - M.FOUND_MIN));
  reduceHorde(state, hz, power * B.HORDE_KILL);
  if (lost) loseBandPeople(state, b, lost, `to the dead near ${tileLabel(state, b.tile)}`);
  return true;
}

function loseBandPeople(state, b, n, why) {
  b.pop = Math.max(0, b.pop - n);
  if ((b.known && state.live.has(b.tile)) || (b.known && n >= 3)) log(state, `${b.name} lost ${n === 1 ? "one of their people" : `${n} people`} ${why}.`, "danger");
  if (b.pop <= 2) breakBand(state, b);
}
function breakBand(state, b) {
  const list = bandsOf(state);
  const i = list.indexOf(b);
  if (i < 0) return;
  list.splice(i, 1);
  if (b.known) log(state, `${b.name} are no more: the last of them scattered on the road.`, "danger");
  chronicleNote(state, `${b.name} broke up on the road.`, "danger", b.tile);
  noteFounding(state);
}

// ---------- meeting your teams ----------
function meetTeams(state, b) {
  if (state.cards.some((c) => c.hcBand === b.id)) return;
  const g = state.grid;
  for (const p of state.parties) {
    if (p.owner !== "player" || p.kind === "convoy" || !p.path || !p.path.length) continue;
    if (b.metTeams.includes(p.id) || g.distance(partyTile(p), b.tile) > 1 || !partyMembers(state, p).length) continue;
    b.metTeams.push(p.id);
    if (b.metTeams.length > 30) b.metTeams.shift();
    b.known = true;
    b.met = true;
    addCard(state, meetCard(state, b, p));
    return;
  }
}

// What a friendly band can spare a team that asks: by its type.
const SPARE = { traders: ["meds", 3], commune: ["food", 12], fortress: ["ammo", 15], expansionist: ["ammo", 12], zealot: ["food", 6], military: ["ammo", 10] };

function meetCard(state, b, p) {
  const a = attitude(b);
  const hostile = a === "Hostile";
  const where = tileLabel(state, b.tile);
  const goal = b.goal != null && !b.joinId ? ` They mean to settle at ${tileLabel(state, b.goal)}.` : b.joinId ? " They hope another group will take them in." : "";
  const mood = hostile ? "They keep their weapons on your people the whole time." : a === "Neutral" ? "They are wary, but they talk." : "They are glad to see living faces.";
  const label = FACTION_TYPES[b.type] ? FACTION_TYPES[b.type].label.toLowerCase() : "group";
  const [sk, sq] = SPARE[b.type] || ["food", 6];
  const choices = [
    {
      label: "Trade news",
      hint: `Goodwill +${hostile ? 2 : B.MEET_GW}. They tell you what they have seen around here and where they are going (on your map).`,
      ai: () => 2,
      resolve: (st) => {
        b.goodwill = clamp(b.goodwill + (hostile ? 2 : B.MEET_GW), -100, 100);
        b.destKnown = true;
        let n = 0;
        for (const id of st.grid.within(b.tile, 3).concat(b.goal != null ? st.grid.within(b.goal, 1) : [])) { st.knowledge[id] = snapshot(st, id); n++; }
        return `${b.name} pass on what they have seen: ${n} tiles on your map.${b.goal != null && !b.joinId ? ` They are making for ${tileLabel(st, b.goal)}.` : ""}`;
      },
    },
  ];
  if (!hostile) choices.push({
    label: "Give them 5 food",
    hint: `Goodwill +${B.GIFT_GW}: they will remember it when they have their hub`,
    ai: () => -1,
    disabled: (st) => !st.parties.includes(p) || carried(p, "food") < 5,
    resolve: (st) => {
      if (!st.parties.includes(p) || carried(p, "food") < 5) return "Your team has no food to spare.";
      takeSupply(p, "food", 5);
      b.goodwill = clamp(b.goodwill + B.GIFT_GW, -100, 100);
      return `${b.name} take the food gratefully.`;
    },
  });
  if (a === "Friendly" || a === "Allied") choices.push({
    label: `Ask them for help (${sq} ${sk})`,
    hint: `They can spare a little: ${sq} ${sk} for your team. Goodwill ${B.ASK_GW}. Once only.`,
    ai: () => 3,
    disabled: (st) => b.helped || !st.parties.includes(p) || (b.stock[sk] || 0) < sq * 3,
    resolve: (st) => {
      if (b.helped || !st.parties.includes(p)) return "";
      b.helped = true;
      b.stock[sk] = Math.max(0, (b.stock[sk] || 0) - sq);
      p.cargo = p.cargo || { supplies: {}, gear: [] };
      p.cargo.supplies[sk] = (p.cargo.supplies[sk] || 0) + sq;
      b.goodwill = clamp(b.goodwill + B.ASK_GW, -100, 100);
      return `${b.name} share ${sq} ${sk} with your team.`;
    },
  });
  choices.push({ label: hostile ? "Back away" : "Go on your way", ai: () => 0, resolve: () => "" });
  return {
    title: `${b.name} on the road`, where, partyId: p.id, hcBand: b.id,
    text: `Your team meets ${LOOK[b.type] || "a band of survivors"} near ${where}: ${b.name}, about ${roundPop(b.pop)} people. By the look of them they will be a ${label}.${goal} ${mood}`,
    choices,
  };
}

// ---------- the day (hardcore.js, after the groups' and the hordes' day) ----------
export function hardcoreGroupsDaily(state) {
  if (!isHardcore(state)) return;
  hcGroups(state);
  for (const b of [...bandsOf(state)]) if (bandsOf(state).includes(b)) bandDay(state, b);
  militaryDaily(state);
  raidersDaily(state);
}

function bandDay(state, b) {
  const rng = grng(state), d = day(state), g = state.grid;
  // Food: they eat on the road and forage a little; the jars and tins go last.
  b.stock.food += b.pop * (B.FORAGE - B.EAT);
  if (b.stock.food < 0 && b.stock.preserved > 0) { const x = Math.min(b.stock.preserved, -b.stock.food); b.stock.preserved -= x; b.stock.food += x; }
  if (b.stock.food < 0) {
    b.stock.food = 0;
    if (rng.chance(B.STARVE)) { loseBandPeople(state, b, 1, "to hunger"); if (!bandsOf(state).includes(b)) return; }
  }
  if (rng.chance(B.ROAD_DEATH)) { loseBandPeople(state, b, 1, "on the road"); if (!bandsOf(state).includes(b)) return; }
  // A horde camped on top of them.
  if (b.phase === "camp" && hordeBite(state, b) && !bandsOf(state).includes(b)) return;
  // Scavenging where they camp.
  const t = state.tiles[b.tile];
  if (b.phase === "camp" && t.loc && (t.loot || 0) > AISCAV.floor && !t.hive) {
    const take = Math.min(B.SCAV_TAKE, t.loot - AISCAV.floor);
    const got = haulFor(t, take, t.loot, B.SCAV_EFF);
    t.loot -= take;
    for (const [k, q] of Object.entries(got)) if (k in b.stock || STOCK_KEYS.includes(k)) b.stock[k] = (b.stock[k] || 0) + q;
  }
  const stop = b.stops[0];
  // Joining another group (a remnant): at its gates they are taken in.
  if (b.joinId != null) {
    const f = factionById(state, b.joinId);
    if (!f || !f.alive || !f.bases.length) { b.joinId = null; planRoute(state, b); return; }
    if (stop && b.tile !== stop.tile && stop.tile !== f.bases[0]) { setPath(state, b, [{ tile: f.bases[0], kind: "join" }]); return; }
    if (b.phase === "camp" && g.distance(b.tile, f.bases[0]) <= 1) return joinGroup(state, b, f);
    if (b.phase === "camp") setPath(state, b, [{ tile: f.bases[0], kind: "join" }]);
    if (d >= b.forceAt) { b.joinId = null; planRoute(state, b); }
    return;
  }
  // Done scavenging on the way: on to the hub site.
  if (b.phase === "camp" && stop && stop.kind === "scav" && state.hour >= b.campUntil) { b.stops.shift(); nextLeg(state, b); return; }
  // Their site taken from under them (you, another group, the hives): another one.
  if (b.goal != null && !goalOk(state, b, b.goal, false)) { b.goal = null; planRoute(state, b); }
  if (b.goal == null && b.phase === "camp" && d < b.forceAt) { planRoute(state, b); }
  // The founding day at their site.
  if (b.phase === "camp" && b.goal != null && b.tile === b.goal && d >= b.foundAt) return foundHub(state, b, b.tile);
  // Too long on the road: they settle where they stand.
  if (d >= b.forceAt) {
    const here = [b.tile, ...g.within(b.tile, B.FORCE_RADIUS), ...g.within(b.tile, B.FORCE_RADIUS * 3)].find((id) => goalOk(state, b, id, false));
    const any = here != null ? here : state.tiles.filter((x) => goalOk(state, b, x.id, false)).sort((x, y) => g.distance(b.tile, x.id) - g.distance(b.tile, y.id) || x.id - y.id)[0]?.id;
    if (any != null) return foundHub(state, b, any);
  }
}

// The band becomes one of the map's groups, with its hub on this tile.
function foundHub(state, b, tile) {
  const H = hcGroups(state), rng = H.rng, d = day(state);
  if (b.pop < M.FOUND_MIN) return breakBand(state, b); // too few to hold a hub of their own
  const desperate = d >= hcRaidersFrom(state) && !b.remnant && b.type !== "military" && b.stock.food < b.pop * 2;
  const type = desperate ? "raider" : b.type;
  const f = {
    id: b.id, name: b.name, type, color: b.color, bases: [tile], pop: b.pop, alive: true, known: b.known,
    goodwill: desperate ? Math.min(b.goodwill, -50) : b.goodwill, lastDiplomacy: 0, pact: null,
    stock: Object.fromEntries(STOCK_KEYS.map((k) => [k, Math.round(b.stock[k] || 0)])),
    lootedGear: [], raidCooldown: rng.int(8, 16), founded: d, hcBand: true,
  };
  if (b.remnant) f.hcRemnant = true;
  if (b.splinter) f.hcSplinter = true; // what was left of the military (militaryFalls)
  if (desperate) f.prevType = b.type;
  const t = state.tiles[tile];
  if (t.ruin) delete t.ruin; // they built on the ruins
  state.factions.push(f);
  const list = bandsOf(state);
  list.splice(list.indexOf(b), 1);
  recomputeOwnership(state);
  H.founded++;
  const place = tileLabel(state, tile);
  const label = FACTION_TYPES[type].label.toLowerCase();
  if (f.known || state.live.has(tile)) log(state, `${b.name} have founded their hub at ${place}: a new ${label}${desperate ? ", hungry and dangerous" : ""}.`, desperate ? "danger" : "info");
  else log(state, `Travellers speak of ${WHO[type] || "a new group"} settling ${dirFrom(state, tile)}.`, desperate ? "danger" : "info");
  chronicleNote(state, `${b.name} founded their hub at ${place} (${label}).`, desperate ? "danger" : "world", tile);
  noteFounding(state);
  return f;
}

// The aggressive groups keep quiet until the last of the first bands has its hub (+ QUIET_GRACE days).
function noteFounding(state) {
  const H = hcGroups(state);
  if (H.quietUntil == null && !bandsOf(state).some((x) => !x.remnant)) H.quietUntil = day(state) + B.QUIET_GRACE;
}

function joinGroup(state, b, f) {
  f.pop += b.pop;
  for (const k of STOCK_KEYS) f.stock[k] = (f.stock[k] || 0) + Math.round(b.stock[k] || 0);
  const list = bandsOf(state);
  list.splice(list.indexOf(b), 1);
  if (b.known || f.known) log(state, `${b.name} reached ${f.known ? f.name : "another group"} and were taken in (${b.pop} people).`, "info");
  chronicleNote(state, `${b.name} joined ${f.name}.`, "world", f.bases[0]);
  noteFounding(state);
}

function dirFrom(state, tile) {
  const pt = hcPlayerTile(state);
  if (pt == null) return "out in the state";
  const a = state.tiles[pt], c = state.tiles[tile];
  const dx = c.x - a.x, dy = c.y - a.y;
  return Math.abs(dx) > Math.abs(dy) * 2 ? (dx > 0 ? "to the east" : "to the west") : Math.abs(dy) > Math.abs(dx) * 2 ? (dy > 0 ? "to the south" : "to the north") : `to the ${dy > 0 ? "south" : "north"}${dx > 0 ? "east" : "west"}`;
}

// ---------- the military ----------
export const hcMilitary = (state) => (state.hardcore && state.hardcore.groups ? state.hardcore.groups.military : null);

// How the military stands, for the Groups tab: { word, share (of the soldiers it started with), fell }.
export function militaryStatus(state, f) {
  const m = hcMilitary(state);
  if (!m || !f || m.id !== f.id) return null;
  if (m.fell) return { word: `overrun on day ${m.fellDay}`, share: 0, fell: true };
  // Of the soldiers who stayed at the base (all of them before the strike force left).
  const share = Math.max(0, f.pop) / Math.max(1, m.garrison || m.startPop);
  let word = share > 0.85 ? "holding" : share > 0.7 ? "under pressure" : share > 0.55 ? "wavering" : "breaking";
  const s = m.strike;
  if (s && s.phase === "travel") word += `; its strike force is on the road to ${tileLabel(state, s.city)}`;
  else if (s && s.phase === "fight") word += `; its strike force is fighting at ${tileLabel(state, s.city)}`;
  else if (s && (s.phase === "retreat" || s.phase === "holed")) word += `; its strike force is cut off near ${tileLabel(state, s.hold ?? s.tile)}`;
  else if (s && s.phase === "home") word += "; its strike force is coming home";
  return { word, share, fell: false };
}

// The military's day: the strike on the city hive, then the garrison fights back (sorties, culls) and calls for
// help; the outbreak work's hordes are what wear it down (hardcore-outbreak.js, through factions.js
// resolveRaidOnFaction). Its fall is detected here: the faction gone, its base lost, or too few left to hold the
// walls (m.breakPop: BREAK_POP, then GARRISON_BREAK of the garrison once the strike force has gone).
function militaryDaily(state) {
  const m = hcMilitary(state);
  if (!m || m.fell) return;
  const f = factionById(state, m.id);
  if (!f) return;
  if (!f.alive || !f.bases.includes(m.tile)) return militaryFalls(state, f, f.alive ? "overrun" : "broken");
  const rng = grng(state), g = state.grid, d = day(state);
  const base = m.tile;
  strikeDaily(state, f, m);
  const breakPop = m.breakPop ?? M.BREAK_POP;
  const boosted = d < (m.suppliedUntil || 0);
  // Sorties against the free dead near the base (not a hive's guard, nor a mass building a hive: the culls are for those).
  const targets = state.hordes.filter((h) => g.distance(h.tile, base) <= M.SORTIE_RANGE && h.role !== "guard" && h.role !== "mass" && h.role !== "build");
  if (targets.length && f.pop > breakPop && rng.chance(M.SORTIE_CHANCE * (boosted ? 1.5 : 1))) {
    const h = targets.sort((a, b) => g.distance(a.tile, base) - g.distance(b.tile, base) || a.id - b.id)[0];
    const kill = Math.round(strength(f) * rng.range(M.SORTIE_KILL[0], M.SORTIE_KILL[1]) * (boosted ? 1.5 : 1));
    const before = h.size;
    reduceHorde(state, h, kill);
    const dead = (rng.chance(M.SORTIE_LOSS) ? 1 : 0) + (rng.chance(M.SORTIE_LOSS / 4) ? 1 : 0);
    f.pop -= dead;
    m.sorties++; m.killed += Math.min(before, kill); m.lost += dead;
    if (d - m.lastSortieLog >= 10 && f.known) {
      m.lastSortieLog = d;
      log(state, `Gunfire from ${tileLabel(state, base)}: ${f.name} went out against the dead and cut down about ${Math.min(before, kill)}${dead ? `, losing ${dead === 1 ? "a soldier" : `${dead} soldiers`}` : ""}.`, "info");
    }
  }
  // Culls: the guns turned on the hive itself.
  if (d >= m.nextCull) {
    m.nextCull = d + rng.int(M.CULL_GAP[0], M.CULL_GAP[1]);
    const hv = (state.hives || []).filter((h) => g.distance(h.tile, base) <= M.CULL_RANGE).sort((a, b) => g.distance(a.tile, base) - g.distance(b.tile, base) || a.id - b.id)[0];
    // Before a hive stands: the mass of the dead gathered to build one (hardcore-outbreak.js), shelled where it waits.
    const site = !hv ? (state.hiveSites || []).filter((s) => s.hardcore && g.distance(s.tile, base) <= M.CULL_RANGE).sort((a, b) => g.distance(a.tile, base) - g.distance(b.tile, base) || a.id - b.id)[0] : null;
    const masses = site ? state.hordes.filter((h) => h.role === "mass" && h.site === site.id) : [];
    if ((hv || masses.length) && f.pop > breakPop + 1) {
      if (hv) {
        hv.res = Math.max(0, hv.res - rng.int(M.CULL_RES[0], M.CULL_RES[1]));
        const guard = state.hordes.find((h) => h.hive === hv.id && h.role === "guard");
        if (guard) reduceHorde(state, guard, guard.size * rng.range(M.CULL_GUARD[0], M.CULL_GUARD[1]));
      } else {
        const share = rng.range(M.CULL_MASS[0], M.CULL_MASS[1]);
        for (const h of masses) reduceHorde(state, h, Math.round(h.size * share));
      }
      const dead = rng.chance(M.CULL_LOSS) ? 1 : 0;
      f.pop -= dead;
      m.culls++; m.lost += dead;
      if (f.known) log(state, `Explosions toward ${hv ? hv.name || tileLabel(state, hv.tile) : tileLabel(state, site.tile)}: ${f.name} shelled ${hv ? "the hive" : "the dead massing there"}${dead ? " and lost a soldier doing it" : ""}.`, "info");
    }
  }
  if (m.hiveSince == null && (state.hives || []).some((h) => g.distance(h.tile, base) <= M.HIVE_RANGE)) m.hiveSince = d;
  m.lastPop = f.pop;
  // Calls to you, as the soldiers who stayed are ground down.
  const share = f.pop / Math.max(1, m.garrison || m.startPop);
  if (!m.helpAsked && share <= M.HELP_AT) { m.helpAsked = true; helpCall(state, f, m); }
  if (!m.evacSent && share <= M.EVAC_AT) { m.evacSent = true; evacuation(state, f, m); }
  // Too few left to hold the walls: the base is overrun.
  if (f.pop <= breakPop) militaryFalls(state, f, "overrun");
}

// ---------- the strike on the city hive ----------
const STRIKE_OUT = ["travel", "fight", "retreat", "holed", "home"]; // phases while the strike force is out (not back, not gone)
export const hcStrike = (state) => { const m = hcMilitary(state); return m && m.strike && STRIKE_OUT.includes(m.strike.phase) ? m.strike : null; };

// "the 3rd Battalion" / "Bravo Company": the unit sent out (not the group's own name).
function strikeName(state, f) {
  const r = hash01(state.seed, "hc-strike-name");
  if (/Battalion/.test(f.name)) { const n = `${["Alpha", "Bravo", "Charlie", "Delta"][Math.floor(r * 4)]} Company`; return { name: n, the: n }; }
  const n = `${["1st", "2nd", "3rd", "4th", "5th", "7th"][Math.floor(r * 6)]} Battalion`;
  return { name: n, the: `the ${n}` };
}
// Are you in touch with what the strike force does (cards)? A radio at your hub, a Guard that likes you, or your
// people near enough to see it.
function inContact(state, f, s) {
  if (s.seen) return true;
  const h = hub(state);
  if (h && h.radio) return true;
  if (f.known && (attitude(f) === "Friendly" || attitude(f) === "Allied")) return true;
  const pt = hcPlayerTile(state);
  return pt != null && (state.grid.distance(pt, s.tile) <= M.SEE_R || state.grid.distance(pt, s.hiveTile) <= M.SEE_R);
}

function strikeDaily(state, f, m) {
  const d = day(state);
  if (!m.strike) {
    if (m.strikeDay != null && d >= m.strikeDay) launchStrike(state, f, m);
    return;
  }
  const s = m.strike;
  if (s.phase === "fight") return fightDay(state, f, m, s);
  if (s.phase === "holed") {
    const rng = grng(state);
    if (s.pop > 1 && rng.chance(M.HOLD_DEATH)) { s.pop--; s.lost++; }
    // The way home opens when the base's hive is gone (you, or the Guard, destroyed it), or after HOLD_MAX days.
    const O = hcOutbreak(state);
    const hiveGone = O && O.mil && O.mil.done != null;
    if (hiveGone || d >= s.failed + M.HOLD_MAX) goHome(state, f, m, s, hiveGone ? "the hive by the base is gone" : "the roads have thinned");
  }
}

function launchStrike(state, f, m) {
  const g = state.grid, rng = grng(state), d = day(state);
  m.strikeDay = null; // once
  const O = hcOutbreak(state);
  let hive = O && O.cityHive != null ? hiveById(state, O.cityHive) : null;
  if (!hive) hive = (state.hives || []).filter((h) => g.distance(h.tile, m.tile) > M.HIVE_RANGE).sort((a, b) => g.distance(a.tile, m.tile) - g.distance(b.tile, m.tile) || a.id - b.id)[0] || null;
  if (!hive) return;
  // Where they deploy: beside the hive, the side nearest the base.
  const stage = g.neighbors(hive.tile).filter((id) => !blocked(state.tiles[id]) && !state.tiles[id].hive).sort((a, b) => g.distance(a, m.tile) - g.distance(b, m.tile) || a - b)[0];
  if (stage == null) return;
  let vehicle = true;
  let res = bandPath(state, m.tile, stage, true);
  if (!res) { vehicle = false; res = bandPath(state, m.tile, stage, false); }
  if (!res) return;
  const n = Math.round(f.pop * rng.range(M.STRIKE_SHARE[0], M.STRIKE_SHARE[1]));
  const sent = Math.max(0, Math.min(n, f.pop - M.STRIKE_KEEP));
  if (sent < 4) return;
  f.pop -= sent;
  m.garrison = f.pop;
  m.breakPop = Math.max(M.BREAK_MIN, Math.round(m.garrison * M.GARRISON_BREAK));
  const ammo = Math.round((f.stock.ammo || 0) * (sent / (sent + f.pop)));
  f.stock.ammo = (f.stock.ammo || 0) - ammo;
  const { name, the } = strikeName(state, f);
  const city = O && O.city != null ? O.city : hive.tile;
  m.strike = {
    name, the, pop: sent, start: sent, tile: m.tile, path: res.path, idx: 0, progress: 0, vehicle, phase: "travel",
    hiveId: hive.id, hiveTile: hive.tile, city, left: d, arrived: null, fightDays: rng.int(M.FIGHT_DAYS[0], M.FIGHT_DAYS[1]),
    fought: 0, lossGoal: null, killed: 0, lost: 0, cityDead: 0, guard0: 0, failed: null, hold: null, home: null, seen: false, ammo, color: f.color,
  };
  const s = m.strike;
  const place = tileLabel(state, city);
  log(state, `📻 ${f.name}: "${cap1(the)} is moving on ${place}. We burn the hive out at the source. Everyone else, stay off the roads."`, "info");
  log(state, `${f.name} sent ${sent} soldiers in trucks against the hive in ${place}. ${f.pop} stayed to hold ${tileLabel(state, m.tile)}.`, "info");
  chronicleNote(state, `${f.name} sent ${the} (${sent} soldiers) against the hive in ${place}.`, "world", m.tile, true);
  if (inContact(state, f, s)) addCard(state, {
    title: `${f.name} goes on the attack`,
    text: `The radio crackles with orders: ${f.name} is sending ${the}, ${sent} soldiers in a column of trucks, to burn out the hive in ${place} where it all began. ${f.pop} stay behind to hold ${tileLabel(state, m.tile)}. If they win, the state has a chance.`,
    choices: [{ label: "Good luck to them", resolve: () => "" }],
  });
}

// The column on the road (every hour, by day): to the city, to its holdout when it is beaten, home when the way opens.
function moveStrike(state) {
  const m = hcMilitary(state);
  const s = m && m.strike;
  if (!s || !["travel", "retreat", "home"].includes(s.phase)) return;
  const live = state.live || new Set();
  const h = hourOfDay(state);
  if (h >= B.DAY_FROM && h < B.DAY_TO && s.idx < s.path.length - 1) {
    s.progress += M.STRIKE_SPEED;
    while (s.idx < s.path.length - 1) {
      const from = s.path[s.idx], to = s.path[s.idx + 1];
      let cost = moveCost(state, from, to, s.vehicle);
      if (!Number.isFinite(cost)) cost = moveCost(state, from, to, false);
      if (!Number.isFinite(cost)) { s.path = s.path.slice(0, s.idx + 1); break; }
      if (s.progress < cost) break;
      s.progress -= cost;
      s.idx += 1;
      s.tile = to;
    }
  }
  if (live.has(s.tile) && !s.seen) {
    s.seen = true;
    const f = factionById(state, m.id);
    log(state, `Your people watch ${s.vehicle ? "a column of military trucks" : "soldiers on foot"} near ${tileLabel(state, s.tile)}: ${s.the} of ${f ? f.name : "the Guard"}, about ${roundPop(s.pop)} soldiers, ${s.phase === "travel" ? `heading for ${tileLabel(state, s.city)}` : s.phase === "home" ? "heading home" : "falling back, carrying their wounded"}.`, "info");
  }
  if (s.idx >= s.path.length - 1) strikeArrives(state, m, s);
}

function strikeArrives(state, m, s) {
  const f = factionById(state, m.id);
  const rng = grng(state), d = day(state);
  s.progress = 0;
  if (s.phase === "travel") {
    s.phase = "fight";
    s.arrived = d;
    const hive = hiveById(state, s.hiveId);
    const guard = hive ? state.hordes.find((h) => h.hive === hive.id && h.role === "guard") : null;
    s.guard0 = guard ? guard.size : 0;
    // The city's dead: more where the city is thick with them.
    s.cityDead = Math.round(rng.int(M.CITY_DEAD[0], M.CITY_DEAD[1]) * (0.6 + (state.tiles[s.city].infection || 0)));
    // What it will cost: FIGHT_LOSS of them, more the more of the dead there are against their guns.
    const fire = s.start * FACTION_TYPES.military.arms * ((M.FIGHT_KILL[0] + M.FIGHT_KILL[1]) / 2) * s.fightDays;
    const pressure = s.cityDead + s.guard0;
    s.lossGoal = clamp(rng.range(M.FIGHT_LOSS[0], M.FIGHT_LOSS[1]) * (0.8 + 0.4 * (pressure / (pressure + fire))), 0.45, 0.8);
    if (f) log(state, `📻 ${s.name}: "In position at ${tileLabel(state, s.city)}. Contact everywhere. Engaging."`, "danger");
  } else if (s.phase === "retreat") {
    s.phase = "holed";
    if (f) log(state, `📻 ${s.name}: "Dug in at ${tileLabel(state, s.tile)}. ${s.pop} of us. The road to the base is crawling with them; we cannot get through."`, "danger");
  } else if (s.phase === "home") {
    s.phase = "back";
    if (f && f.alive && f.bases.includes(m.tile)) {
      f.pop += s.pop;
      f.stock.ammo = (f.stock.ammo || 0) + s.ammo;
      m.garrison = Math.max(m.garrison || 0, f.pop);
      log(state, `📻 ${f.name}: "${cap1(s.the)} is home. ${s.pop} of the ${s.start} who went out."`, "info");
      chronicleNote(state, `The last of ${s.the} made it back to ${tileLabel(state, m.tile)}.`, "world", m.tile);
    }
  }
}

// A day of the fight in the city: the guns against the city's dead and the hive's guard, by the numbers.
function fightDay(state, f, m, s) {
  const rng = grng(state), d = day(state);
  const hive = hiveById(state, s.hiveId);
  if (!hive) {
    log(state, `📻 ${s.name}: "The hive at ${tileLabel(state, s.city)} is already dead. Streets are clear enough. Coming home."`, "good");
    return goHome(state, f, m, s, null);
  }
  const guard = state.hordes.find((h) => h.hive === hive.id && h.role === "guard");
  const fire = Math.round(s.pop * FACTION_TYPES.military.arms * rng.range(M.FIGHT_KILL[0], M.FIGHT_KILL[1]));
  const fromCity = Math.min(s.cityDead, Math.round(fire * 0.6));
  s.cityDead -= fromCity;
  let fromGuard = 0;
  if (guard) {
    const floor = Math.round(Math.max(s.guard0, guard.size) * (1 - M.HIVE_HURT)); // the hive is hurt, never destroyed
    fromGuard = Math.max(0, Math.min(fire - fromCity, guard.size - floor));
    if (fromGuard) reduceHorde(state, guard, fromGuard);
  }
  hive.res = Math.max(0, hive.res - rng.int(M.HIVE_RES[0], M.HIVE_RES[1]));
  s.cityDead += rng.int(M.CITY_REFILL[0], M.CITY_REFILL[1]); // the city's dead keep pouring in
  s.killed += fromCity + fromGuard;
  s.fought++;
  const goal = Math.round(s.start * s.lossGoal);
  const last = s.fought >= s.fightDays;
  let lost = last ? goal - s.lost : Math.round((goal / s.fightDays) * rng.range(0.8, 1.2));
  lost = clamp(lost, 1, Math.max(1, s.pop - 2));
  s.pop -= lost;
  s.lost += lost;
  s.ammo = Math.max(0, s.ammo - Math.round(fire / 3));
  // The soldiers who fell rise in their body armour and join the hive's guard (zombietypes.js "soldier" dead).
  const g2 = state.hordes.find((h) => h.hive === hive.id && h.role === "guard");
  if (g2) { g2.mix = mergeMix(g2.mix, g2.size, { soldier: 1 }, lost); g2.size += lost; }
  if (!last) {
    log(state, `📻 ${s.name} at ${tileLabel(state, s.city)}: "...${["they just keep coming", "need ammunition at the north block", "we are losing the street", "pull the wounded back"][rng.int(0, 3)]}..." (${lost} soldiers lost today, about ${fromCity + fromGuard} of the dead cut down)`, "danger");
    return;
  }
  failStrike(state, f, m, s, hive);
}

// The strike fails: the survivors break off and fall back to a site near the city; the road home is cut.
function failStrike(state, f, m, s, hive) {
  const g = state.grid, rng = grng(state), d = day(state);
  s.failed = d;
  const taken = (id) => state.bases.some((b) => g.distance(b.tile, id) < 2) || state.factions.some((o) => o.alive && o.bases.includes(id));
  const cands = [];
  for (const id of g.within(hive.tile, M.CUT_OFF_R[1])) {
    const t = state.tiles[id], k = g.distance(hive.tile, id);
    if (k < M.CUT_OFF_R[0] || blocked(t) || t.hive || taken(id)) continue;
    if (t.loc && t.loc.type !== "city") cands.push({ id, w: (PREFERRED_SITES.fortress.includes(t.loc.type) || PREFERRED_SITES.military.includes(t.loc.type) ? 3 : 1) * (t.terrain === "city" || t.terrain === "suburb" ? 0.5 : 1) });
  }
  const open = cands.length ? null : g.within(hive.tile, M.CUT_OFF_R[1]).filter((id) => g.distance(hive.tile, id) >= M.CUT_OFF_R[0] && !blocked(state.tiles[id]) && !state.tiles[id].hive);
  const hold = cands.length ? rng.weighted(cands, (c) => c.w).id : open && open.length ? rng.pick(open) : s.tile;
  s.hold = hold;
  s.vehicle = false; // the trucks are lost in the streets
  const res = hold !== s.tile ? bandPath(state, s.tile, hold, false) : null;
  if (res) { s.path = res.path; s.idx = 0; s.progress = 0; s.phase = "retreat"; }
  else { s.path = [s.tile]; s.idx = 0; s.phase = "holed"; }
  const city = tileLabel(state, s.city), at = tileLabel(state, hold);
  const guardLeft = state.hordes.find((h) => h.hive === hive.id && h.role === "guard");
  log(state, `📻 ${s.name}: "We cannot take it. There are too many of them. ${s.lost} dead... falling back to ${at}. The road to the base is cut."`, "death");
  log(state, `The strike on the hive in ${city} has failed: ${cap1(s.the)} lost ${s.lost} of ${s.start} soldiers and cut down about ${s.killed} of the dead. The hive still stands${guardLeft && s.guard0 && guardLeft.size < s.guard0 ? ", its guard thinned" : ""}.`, "death");
  chronicleNote(state, `The strike on the hive in ${city} failed: ${s.lost} of ${s.start} soldiers lost; the rest are cut off near ${at}.`, "death", s.city, true);
  if (inContact(state, f, s)) addCard(state, {
    title: `The strike on ${city} has failed`,
    text: `${cap1(s.the)} of ${f.name} fought ${s.fought} days in ${city}. They cut down about ${s.killed} of the dead, but the city's dead kept pouring in around the hive. ${s.lost} of the ${s.start} soldiers are dead. The ${s.pop} left have fallen back to ${at}, cut off: the road to their base is full of the dead. ${f.pop} soldiers hold ${tileLabel(state, m.tile)} alone.`,
    choices: [{ label: "OK", resolve: () => "" }],
  });
}

function goHome(state, f, m, s, why) {
  const res = bandPath(state, s.tile, m.tile, s.vehicle);
  s.home = day(state);
  if (!res) { s.phase = "holed"; s.failed = day(state); return; } // try again later
  s.path = res.path; s.idx = 0; s.progress = 0; s.phase = "home";
  if (why) log(state, `📻 ${s.name}: "${cap1(why)}. We are coming home."`, "info");
}

function helpCall(state, f, m) {
  const h = hub(state);
  const name = f.name;
  if (!h) { log(state, `📻 ${name} on every channel: "The hive is bleeding us. Anyone out there with ammunition or medicine, bring it to ${tileLabel(state, m.tile)}."`, "danger"); return; }
  addCard(state, {
    title: `${name} asks for help`,
    text: `${name} at ${tileLabel(state, m.tile)} is losing soldiers to the hive's dead. Their radio operator asks for ammunition or medicine: "We are the only thing standing between that hive and the rest of you."`,
    choices: [
      {
        label: "Send 40 ammo", hint: `Two weeks of harder sorties against the dead at their walls; goodwill +8`,
        ai: (st) => ((hub(st)?.stock.ammo || 0) >= 160 ? 2 : -1),
        disabled: (st) => !hub(st) || (hub(st).stock.ammo || 0) < 40,
        resolve: (st) => { const hb = hub(st); if (!hb || (hb.stock.ammo || 0) < 40) return "You no longer have 40 ammo to spare."; hb.stock.ammo -= 40; f.stock.ammo = (f.stock.ammo || 0) + 40; m.suppliedUntil = day(st) + M.SUPPLY_DAYS; changeGoodwill(st, f, 8, "you sent ammo"); return `Ammo on its way to ${name}.`; },
      },
      {
        label: "Send 6 meds", hint: `${M.MEDS_POP} of their wounded go back on the walls; goodwill +6`,
        ai: (st) => ((hub(st)?.stock.meds || 0) >= 25 ? 1 : -1),
        disabled: (st) => !hub(st) || (hub(st).stock.meds || 0) < 6,
        resolve: (st) => { const hb = hub(st); if (!hb || (hb.stock.meds || 0) < 6) return "You no longer have 6 meds to spare."; hb.stock.meds -= 6; if (f.alive) f.pop += M.MEDS_POP; changeGoodwill(st, f, 6, "you sent meds"); return `Meds on their way to ${name}.`; },
      },
      { label: "Nothing to spare", hint: "Goodwill −3", ai: () => 0, resolve: (st) => { changeGoodwill(st, f, -3, "you would not help"); return `You told ${name} you have nothing to spare.`; } },
    ],
  });
}

function evacuation(state, f, m) {
  const h = hub(state);
  const team = !h ? state.parties.find((p) => p.owner === "player" && p.kind !== "convoy" && partyMembers(state, p).length) : null;
  log(state, `📻 ${f.name}: "We are sending the civilians out while the road is still open."`, "danger");
  if (!h && !team) return;
  const n = 2 + (grng(state).chance(0.5) ? 1 : 0);
  const list = Array.from({ length: n }, () => makeCandidate(state, { quality: 0.85, minHealth: 50 }));
  offerRecruits(state, list, {
    source: "refugees", baseId: h ? h.id : null, partyId: team ? team.id : undefined, title: "Evacuees from the base",
    intro: `${f.name} cannot protect its civilians any more. A truck brought ${n} of them${h ? ` to ${h.name}` : " to your people"}: they ask to join you.`,
  });
}

// The base falls: a ruin full of the dead, most of the soldiers gone, a few to you, a remnant on the road.
function militaryFalls(state, f, how) {
  const m = hcMilitary(state);
  if (!m || m.fell) return;
  const rng = grng(state), g = state.grid, d = day(state);
  m.fell = true; m.fellDay = d; m.how = how;
  const tile = m.tile;
  const pop = Math.max(0, f.pop);
  m.fallPop = pop;
  const wasAlive = f.alive;
  f.alive = false; f.bases = []; f.pact = null; f.pop = 0;
  for (const q of [...state.parties]) if (q.owner === f.id) removeParty(state, q);
  const taken = state.bases.some((b) => b.tile === tile) || state.factions.some((o) => o.alive && o.bases.includes(tile));
  const t = state.tiles[tile];
  const place = tileLabel(state, tile);
  const dead = Math.round(pop * rng.range(M.DEAD[0], M.DEAD[1])); // in the last fight
  const fallenAll = Math.max(dead, m.startPop - (pop - dead)); // all the soldiers the base cost
  if (!taken) {
    // dead: the garrison's own dead fill it; a hive burned out nearby (hives.js destroyHive) fades only what the
    // hive radiated, never below this, until someone builds on the ruin.
    t.ruin = { name: place, day: d, by: "the dead", from: f.name, dead: 0.85 };
    t.loot = Math.max(t.loot || 0, M.RUIN_LOOT);
    t.infection = Math.max(t.infection || 0, 0.85);
    // The first year's spread (hardcore-outbreak.js) steers every tile toward its infGoal: raise that too, or it
    // would thin the dead out of the ruin again.
    t.infBase = Math.max(t.infBase || 0, 0.6);
    t.infGoal = Math.max(t.infGoal || 0, 0.85);
    for (const id of g.within(tile, 1)) if (id !== tile) {
      const n = state.tiles[id];
      n.infection = Math.max(n.infection || 0, 0.6);
      n.infGoal = Math.max(n.infGoal || 0, 0.6);
    }
    const fallen = Math.round(fallenAll * rng.range(M.FALLEN_HORDE[0], M.FALLEN_HORDE[1])) + 20;
    makeHorde(state, { tile, size: fallen, role: "roam", mix: { soldier: M.FALLEN_SOLDIER } }); // the garrison's dead in their armour (zombietypes.js)
  }
  recomputeOwnership(state);
  clearStaleAlerts(state);
  // Who got out: a few to you, the garrison's survivors, and the strike force cut off out in the state.
  const h = hub(state);
  const team = !h ? state.parties.find((p) => p.owner === "player" && p.kind !== "convoy" && partyMembers(state, p).length) : null;
  // 1–3 make it to you; enough of them stay together to be a group of their own when they can.
  const out = Math.max(0, pop - dead);
  let toYou = (h || team) && out >= 2 ? Math.min(out, rng.int(1, 3)) : 0;
  if (toYou && out - toYou < M.HOLD_MIN && out > M.HOLD_MIN) toYou = out - M.HOLD_MIN;
  let held = Math.max(0, out - toYou);
  const s = hcStrike(state);
  let cut = s ? s.pop : 0;
  if (s) s.phase = "gone";
  // Too few for a group of their own (HOLD_MIN): they make for the others.
  if (held && held < M.HOLD_MIN && cut >= M.HOLD_MIN) { cut += held; held = 0; }
  else if (cut && cut < M.HOLD_MIN && held >= M.HOLD_MIN) { held += cut; cut = 0; }
  else if (held && cut && held < M.HOLD_MIN && cut < M.HOLD_MIN && held + cut >= M.HOLD_MIN) { cut += held; held = 0; }
  const splinters = [];
  const holdName = holdoutsName(state, tile, f);
  if (held >= M.HOLD_MIN) splinters.push(makeSplinter(state, f, "fortress", holdName, held, nearTile(state, tile), freeColor(state, f.color), "the garrison"));
  if (cut >= M.HOLD_MIN) splinters.push(makeSplinter(state, f, "military", `Remnant of ${s.the}`, cut, s.tile, f.color, s.the, s));
  for (let i = splinters.length - 1; i >= 0; i--) if (!splinters[i]) splinters.splice(i, 1);
  // A handful in all: a peaceful group near takes them in, else they come to you; with neither they scatter.
  let rest = (held < M.HOLD_MIN ? held : 0) + (cut < M.HOLD_MIN ? cut : 0);
  let join = null;
  if (rest) {
    const dist = (o) => Math.min(...o.bases.map((x) => g.distance(x, tile)));
    const peaceful = state.factions.filter((o) => o.alive && o.bases.length && !isAggressiveType(o) && dist(o) <= M.JOIN_RANGE);
    join = peaceful.sort((a, b) => dist(a) - dist(b) || a.id - b.id)[0] || null;
    if (join) {
      const b = makeBand(state, "fortress", {
        name: `${f.name} stragglers`, color: f.color, tile: nearTile(state, tile), pop: rest, remnant: true, joinId: join.id,
        stock: { food: rest * 3, water: rest * 2, ammo: rest * 12, meds: 1, fuel: 0, parts: 0, scrap: 2, preserved: rest, jars: 0 },
        goodwill: f.goodwill, foundAt: d + 20,
      });
      if (b) b.known = f.known;
    } else if (h || team) { toYou += rest; rest = 0; }
  }
  m.splinters = splinters.map((b) => b.id);
  m.toYou = toYou;
  const last = ["the perimeter is gone", "they are inside the wire", "fall back to the armory"][rng.int(0, 2)];
  if (wasAlive || how === "overrun") {
    log(state, `📻 Last transmission from ${place}: "...${last}... to anyone listening, stay away from ${place}. God help you." Then nothing.`, "death");
  }
  const names = splinters.map((b) => b.name);
  log(state, `${place} has fallen to the dead. ${f.name} is gone${names.length ? `; what is left of it goes its own way as ${names.join(" and ")}` : ""}.`, "death");
  chronicleNote(state, `${place} fell to the dead: ${f.name} is gone${names.length ? `. What was left of it split into ${names.join(" and ")}` : ""}.`, "death", tile, true);
  const away = s ? ` ${cap1(s.the)}, cut off since the strike on ${tileLabel(state, s.city)}, never made it back.` : "";
  const parts = splinters.map((b) => `${b.name} (${b.pop}, ${b.splinterOf})`);
  addCard(state, {
    title: `${place} has fallen`,
    text: `The Guard held ${place} for ${d} days${s ? ", with half its soldiers gone to the city" : ""}. ${how === "overrun" ? "In the end the hive's dead came over the walls faster than they could be shot." : "There were too few of them left to hold the walls."} About ${fallenAll} soldiers died there and walk with the dead now.${away}${parts.length ? ` The military is finished; what is left of it has split into ${parts.join(" and ")}, each looking for a place of its own.` : ""}${join && rest ? ` A few stragglers are making for ${join.known ? join.name : "another group"}.` : ""}${toYou ? ` ${toYou} made it to your people.` : ""} What was left in the armory is still in there, among the dead.`,
    choices: [{ label: "OK", resolve: () => "" }],
  });
  if (toYou) {
    const list = Array.from({ length: toYou }, () => makeCandidate(state, { quality: 1.05, minHealth: 35, gearChance: 0.9 }));
    offerRecruits(state, list, {
      source: "refugees", baseId: h ? h.id : null, partyId: team ? team.id : undefined, title: "Soldiers at the gate",
      intro: `${toYou === 1 ? "A soldier" : `${toYou} soldiers`} from ${place} reached ${h ? h.name : "your people"}, armed and exhausted. They ask to join you.`,
    });
  }
}

// A group of what was left of the military: a band on the road that founds its hub somewhere defensible.
// The garrison's survivors carry out a share of the base's stores (SPLINTER_GRAB); the strike force what it has left.
function makeSplinter(state, f, type, name, pop, tile, color, of, strike = null) {
  const rng = grng(state), d = day(state);
  const st = f.stock || {}, k = strike ? 0 : M.SPLINTER_GRAB;
  const grab = (key, min) => Math.max(min, Math.round((st[key] || 0) * k));
  const b = makeBand(state, type, {
    name, color, tile, pop, remnant: true, splinter: of,
    stock: {
      food: grab("food", pop * 4), water: grab("water", pop * 2), ammo: strike ? Math.max(pop * 10, strike.ammo) : grab("ammo", pop * 14), meds: grab("meds", 3),
      fuel: type === "military" ? 4 : grab("fuel", 0), parts: grab("parts", 1), scrap: grab("scrap", 6), preserved: grab("preserved", pop), jars: 0,
    },
    goodwill: f.goodwill, foundAt: d + rng.int(M.SPLINTER_FOUND[0], M.SPLINTER_FOUND[1]),
  });
  if (!b) return null;
  b.known = f.known;
  log(state, `${name} (${pop} ${of === "the garrison" ? "of the garrison" : `of ${of}`}) ${type === "military" ? "keep their ranks and their flag" : "dig in for themselves"}: they mean to find a place of their own.`, "info");
  return b;
}
// "Marrow Guard Holdouts", "Cedar Falls Depot Holdouts": the garrison's survivors, by the base's name.
function holdoutsName(state, tile, f) {
  const t = state.tiles[tile];
  const n = t.loc && t.loc.name ? t.loc.name : f.name;
  const short = n.replace(/ National Guard base$/i, " Guard").replace(/ Army depot$/i, " Depot").replace(/ (base|depot)$/i, "");
  return `${short} Holdouts`;
}
// A tile 3–4 out from the fallen base to start from, away from the hive and the dead (else 2–3 out, else the base's).
function nearTile(state, tile) {
  const g = state.grid;
  const hives = (state.hives || []).map((h) => h.tile);
  const free = (id) => !blocked(state.tiles[id]) && !state.tiles[id].hive && !state.hordes.some((h) => h.tile === id);
  let c = g.within(tile, 4).filter((id) => g.distance(id, tile) >= 3 && free(id) && hives.every((h) => g.distance(h, id) >= 3));
  if (!c.length) c = g.within(tile, 3).filter((id) => g.distance(id, tile) >= 2 && free(id));
  return c.length ? grng(state).pick(c) : tile;
}
// A colour no living group or band wears (else the fallen military's).
function freeColor(state, fallback) {
  const used = new Set([fallback, ...state.factions.filter((o) => o.alive).map((o) => o.color), ...bandsOf(state).map((b) => b.color)]);
  return FACTION_COLORS.find((c) => !used.has(c)) || fallback;
}

// ---------- raiders ----------
function raidersDaily(state) {
  const H = hcGroups(state), rng = H.rng, d = day(state);
  const from = hcRaidersFrom(state);
  if (d < from) return;
  if (!H.raidersOut) {
    H.raidersOut = true;
    log(state, "Word on the roads: people have started preying on each other. Raiders are out there now.", "danger");
    chronicleNote(state, "The first raiders: survivors have started preying on each other.", "danger", -1, true);
  }
  if (H.turned >= B.TURN_MAX) return;
  const elig = state.factions.filter((f) => f.alive && f.bases.length && f.type !== "raider" && f.type !== "military" && !f.pact && !isMember(state, f) && f.goodwill < 40);
  if (!elig.length) return;
  // A splinter of the fallen military (militaryFalls) has guns, grievances and nobody to answer to.
  const desperation = (f) => (f.stock.food < f.pop * 3 ? 1 : 0) + (f.pop < 12 ? 0.5 : 0) + (isAggressiveType(f) ? 1 : 0) + (f.bases.length === 1 ? 0.3 : 0) + (f.hcSplinter ? M.SPLINTER_TURN : 0);
  for (const f of elig) {
    if (rng.chance(B.TURN_BASE * (1 + 3 * desperation(f)))) { turnRaider(state, f); if (H.turned >= B.TURN_MAX) return; }
  }
  if (d >= from + B.TURN_BY && !state.factions.some((f) => f.alive && f.type === "raider")) {
    const pick = [...elig].sort((a, b) => desperation(b) - desperation(a) || a.pop - b.pop || a.id - b.id)[0];
    if (pick && pick.alive && pick.type !== "raider") turnRaider(state, pick);
  }
}

export function turnRaider(state, f) {
  const H = hcGroups(state);
  f.prevType = f.type;
  f.type = "raider";
  f.raidCooldown = H.rng.int(4, 10);
  f.hcNoExpand = false;
  H.turned++;
  for (const o of state.factions) if (o.alive && o !== f) changeRelation(state, f, o, -25);
  log(state, `${f.known ? f.name : "A group out in the state"} ${f.known ? "have" : "has"} turned to raiding.`, "danger");
  chronicleNote(state, `${f.name} turned to raiding.`, "danger", f.bases[0] ?? -1);
  if (f.goodwill > -50) changeGoodwill(state, f, -50 - f.goodwill, "they have turned to raiding");
}

// ---------- what the map and the tile panel show ----------
// Tile panel lines for bands you can see on this tile (or saw here last).
export function bandTipLines(state, tile, live = state.live) {
  const out = [];
  for (const b of bandsOf(state)) {
    if (b.tile !== tile || !live.has(tile)) continue;
    const label = FACTION_TYPES[b.type] ? FACTION_TYPES[b.type].label.toLowerCase() : "group";
    out.push({ color: b.color, text: b.known ? `${b.name}: a band of about ${roundPop(b.pop)} on the road (will be a ${label}), ${b.act}` : `A band of about ${roundPop(b.pop)} survivors on the road` });
  }
  const s = hcStrike(state);
  if (s && s.tile === tile && live.has(tile)) {
    const act = s.phase === "travel" ? `on the way to the hive in ${tileLabel(state, s.city)}` : s.phase === "fight" ? `fighting the dead around the hive in ${tileLabel(state, s.city)}` : s.phase === "home" ? "on the way home" : "cut off, holding out";
    out.push({ color: s.color, text: `${cap1(s.the)} (the military): about ${roundPop(s.pop)} soldiers, ${act}` });
  }
  return out;
}
// The map (ui/render.js): the bands, and the military's strike force while it is out (drawn like a group's convoy).
export function hcMapBands(state) {
  const list = bandsOf(state);
  const s = hcStrike(state);
  if (!s) return list;
  return [...list, { id: "strike", name: s.the, type: "military", tile: s.tile, pop: s.pop, color: s.color, path: s.path, idx: s.idx, convoy: !!s.vehicle, strike: true }];
}
// For the Groups tab: one line about a band you know.
export function bandInfo(state, b) {
  const label = FACTION_TYPES[b.type] ? FACTION_TYPES[b.type].label : "Group";
  const seen = b.lastSeen ? `last seen near ${tileLabel(state, b.lastSeen.tile)} (day ${Math.floor(b.lastSeen.hour / 24) + 1})` : "not seen lately";
  const dest = b.destKnown && b.goal != null && !b.joinId ? `heading for ${tileLabel(state, b.goal)}` : "";
  return { label: `${label} (on the road)`, pop: roundPop(b.pop), attitude: attitude(b), seen, dest, tile: b.lastSeen ? b.lastSeen.tile : b.tile };
}
