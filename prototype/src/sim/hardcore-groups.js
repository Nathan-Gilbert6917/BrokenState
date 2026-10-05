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
// The military (HC_MILITARY)
// - Always there: its base on one of the map's military sites (state.militaryIds, at least MIN_FROM_YOU tiles from
//   you when it can), POP soldiers with plenty of ammo, known from the start. It neither expands nor grows: the base
//   is closed to civilians and cut off.
// - The outbreak work (hardcore-outbreak.js) puts a hive near it whose hordes grind it down (factions.js
//   resolveRaidOnFaction). It fights back: sorties (SORTIE_CHANCE a day against a horde within SORTIE_RANGE: kills
//   SORTIE_KILL × its strength, sometimes a soldier lost) and culls (every CULL_GAP days against a hive within
//   CULL_RANGE: CULL_RES of the hive's stores and CULL_GUARD of its guard). Destroy the hive and the hordes stop.
// - With HELP_AT of its soldiers left it asks you for help (a card, with a hub): 40 ammo (harder sorties for
//   SUPPLY_DAYS days) or 6 meds (MEDS_POP wounded back on the walls). At EVAC_AT it sends its civilians to you.
// - It falls when it is ground down to BREAK_POP soldiers, its base is lost or the group is broken: the base is a ruin
//   full of the dead (a horde of the fallen, infection, the armory's loot left behind), DEAD of the last defenders
//   die, 1–3 reach you as recruits, the rest (REMNANT) flee as a remnant band: a small one (under JOIN_SMALL) makes
//   for the nearest peaceful group to be taken in, or comes to you when there is none (under FOUND_MIN); a bigger one
//   joins a group (JOIN_CHANCE) or founds a small military or fortress group. A last radio message, a card and a
//   timelapse caption.
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
import { worldScale } from "./worldsize.js";
import { chronicleNote } from "./chronicle.js";
import { makeCandidate, offerRecruits } from "./recruits.js";
import { changeRelation } from "./diplomacy.js";
import { isMember } from "./alliance.js";

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
  GOAL_REACH: 22, GOAL_FROM_YOU: 10, GOAL_APART: 8, GOAL_HIVE: 6,
  FOUND_DAYS: [8, 29], FORCE_AFTER: 10, FORCE_RADIUS: 3,
  SPEED: 0.6, DAY_FROM: 6, DAY_TO: 20,
  EAT: 0.7, FORAGE: 0.5, STARVE: 0.3, ROAD_DEATH: 0.015,
  SCAV_TAKE: 0.05, SCAV_EFF: 0.8, SCAV_DAYS: 2, STOP_DETOUR: 4, STOP_LOOT: 0.2,
  HORDE_KILL: 1.5, HORDE_BITE: 30, MEET_GW: 5, GIFT_GW: 12, ASK_GW: -2,
  QUIET_GRACE: 10, QUIET_MAX: 60,
  // The raiders' day: RAIDERS_FROM × the era offset (the day the normal game would start, state.hardcore.eraOffset
  // from the outbreak work; ERA_OFFSET by the seed when it is not there).
  RAIDERS_FROM: [0.6, 1.0], ERA_OFFSET: [56, 112], TURN_BASE: 0.004, TURN_BY: 14, TURN_MAX: 2,
};
export const HC_MILITARY = {
  POP: [30, 40], MIN_FROM_YOU: 12, HIVE_RANGE: 10, BREAK_POP: 10,
  SORTIE_RANGE: 6, SORTIE_CHANCE: 0.3, SORTIE_MIN_POP: 12, SORTIE_KILL: [0.6, 1.2], SORTIE_LOSS: 0.35,
  CULL_GAP: [12, 20], CULL_RANGE: 12, CULL_RES: [2, 5], CULL_GUARD: [0.1, 0.2], CULL_LOSS: 0.4,
  HELP_AT: 0.65, EVAC_AT: 0.45, SUPPLY_DAYS: 14, MEDS_POP: 2,
  DEAD: [0.3, 0.5], REMNANT: [3, 10], FOUND_MIN: 4, JOIN_SMALL: 6, JOIN_CHANCE: 0.5, JOIN_RANGE: 20, RUIN_LOOT: 0.7, FALLEN_HORDE: [0.6, 1.0],
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
  const hiveR = strict ? B.GOAL_HIVE : 3;
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
function setPath(state, b, stops) {
  b.stops = stops;
  return nextLeg(state, b);
}
function nextLeg(state, b) {
  while (b.stops.length) {
    const s = b.stops[0];
    if (s.tile === b.tile) { arriveAt(state, b); return true; }
    const res = planPath(state, b.tile, s.tile, false);
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
  const lost = Math.min(b.pop, Math.max(0, Math.round((hz.size / B.HORDE_BITE) * rng.range(0.4, 1.2))));
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
  const share = Math.max(0, f.pop) / Math.max(1, m.startPop);
  const word = share > 0.75 ? "holding" : share > 0.55 ? "under pressure" : share > 0.4 ? "wavering" : "breaking";
  return { word, share, fell: false };
}

// The military's day: it fights back (sorties, culls) and calls for help; the outbreak work's hordes are what wear it
// down (hardcore-outbreak.js, through factions.js resolveRaidOnFaction). Its fall is detected here: the faction gone,
// its base lost, or too few left to hold the walls (BREAK_POP).
function militaryDaily(state) {
  const m = hcMilitary(state);
  if (!m || m.fell) return;
  const f = factionById(state, m.id);
  if (!f) return;
  if (!f.alive || !f.bases.includes(m.tile)) return militaryFalls(state, f, f.alive ? "overrun" : "broken");
  const rng = grng(state), g = state.grid, d = day(state);
  const base = m.tile;
  const boosted = d < (m.suppliedUntil || 0);
  // Sorties against the dead near the base.
  const targets = state.hordes.filter((h) => g.distance(h.tile, base) <= M.SORTIE_RANGE);
  if (targets.length && f.pop >= M.SORTIE_MIN_POP && rng.chance(M.SORTIE_CHANCE * (boosted ? 1.5 : 1))) {
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
    if (hv && f.pop >= M.SORTIE_MIN_POP) {
      hv.res = Math.max(0, hv.res - rng.int(M.CULL_RES[0], M.CULL_RES[1]));
      const guard = state.hordes.find((h) => h.hive === hv.id && h.role === "guard");
      if (guard) reduceHorde(state, guard, guard.size * rng.range(M.CULL_GUARD[0], M.CULL_GUARD[1]));
      const dead = rng.chance(M.CULL_LOSS) ? 1 : 0;
      f.pop -= dead;
      m.culls++; m.lost += dead;
      if (f.known) log(state, `Explosions toward ${hv.name || tileLabel(state, hv.tile)}: ${f.name} shelled the hive${dead ? " and lost a soldier doing it" : ""}.`, "info");
    }
  }
  if (m.hiveSince == null && (state.hives || []).some((h) => g.distance(h.tile, base) <= M.HIVE_RANGE)) m.hiveSince = d;
  m.lastPop = f.pop;
  // Calls to you, as the soldiers are ground down.
  const share = f.pop / Math.max(1, m.startPop);
  if (!m.helpAsked && share <= M.HELP_AT) { m.helpAsked = true; helpCall(state, f, m); }
  if (!m.evacSent && share <= M.EVAC_AT) { m.evacSent = true; evacuation(state, f, m); }
  // Too few left to hold the walls: the base is overrun.
  if (f.pop <= M.BREAK_POP) militaryFalls(state, f, "overrun");
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
  const wasAlive = f.alive;
  f.alive = false; f.bases = []; f.pact = null; f.pop = 0;
  for (const q of [...state.parties]) if (q.owner === f.id) removeParty(state, q);
  const taken = state.bases.some((b) => b.tile === tile) || state.factions.some((o) => o.alive && o.bases.includes(tile));
  const t = state.tiles[tile];
  const place = tileLabel(state, tile);
  const dead = Math.round(pop * rng.range(M.DEAD[0], M.DEAD[1])); // in the last fight
  const fallenAll = Math.max(dead, m.startPop - (pop - dead)); // all the soldiers the base cost
  if (!taken) {
    t.ruin = { name: place, day: d, by: "the dead", from: f.name };
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
    makeHorde(state, { tile, size: fallen, role: "roam" });
  }
  recomputeOwnership(state);
  clearStaleAlerts(state);
  // Who got out.
  const h = hub(state);
  const team = !h ? state.parties.find((p) => p.owner === "player" && p.kind !== "convoy" && partyMembers(state, p).length) : null;
  let toYou = (h || team) && pop - dead >= 2 ? Math.min(pop - dead, rng.int(1, 3)) : 0;
  const left = Math.max(0, pop - dead - toYou);
  let remnant = left >= M.REMNANT[0] ? Math.min(M.REMNANT[1], left) : 0; // too few: they scatter and are lost
  // A small remnant looks for people to take it in: a peaceful group near, else you; a bigger one may found its own.
  const dist = (o) => Math.min(...o.bases.map((x) => g.distance(x, tile)));
  const peaceful = state.factions.filter((o) => o.alive && o.bases.length && !isAggressiveType(o) && dist(o) <= M.JOIN_RANGE);
  const join = remnant && peaceful.length && (remnant < M.JOIN_SMALL || rng.chance(M.JOIN_CHANCE)) ? peaceful.sort((a, b) => dist(a) - dist(b) || a.id - b.id)[0] : null;
  if (remnant && remnant < M.FOUND_MIN && !join) { if (h || team) toYou += remnant; remnant = 0; }
  const last = ["the perimeter is gone", "they are inside the wire", "fall back to the armory"][rng.int(0, 2)];
  if (wasAlive || how === "overrun") {
    log(state, `📻 Last transmission from ${place}: "...${last}... to anyone listening, stay away from ${place}. God help you." Then nothing.`, "death");
  }
  log(state, `${place} has fallen to the dead. ${f.name} is gone${remnant ? `; a few of them got out` : ""}.`, "death");
  chronicleNote(state, `${place} fell to the dead: ${f.name} is gone.`, "death", tile, true);
  addCard(state, {
    title: `${place} has fallen`,
    text: `The Guard held ${place} for ${d} days. ${how === "overrun" ? "In the end the hive's dead came over the walls faster than they could be shot." : "There were too few of them left to hold the walls."} About ${fallenAll} soldiers died there and walk with the dead now.${remnant ? ` ${remnant} got away on the road${join ? `, making for ${join.known ? join.name : "another group"}` : ""}.` : ""}${toYou ? ` ${toYou} made it to your people.` : ""} What was left in the armory is still in there, among the dead.`,
    choices: [{ label: "OK", resolve: () => "" }],
  });
  if (toYou) {
    const list = Array.from({ length: toYou }, () => makeCandidate(state, { quality: 1.05, minHealth: 35, gearChance: 0.9 }));
    offerRecruits(state, list, {
      source: "refugees", baseId: h ? h.id : null, partyId: team ? team.id : undefined, title: "Soldiers at the gate",
      intro: `${toYou === 1 ? "A soldier" : `${toYou} soldiers`} from ${place} reached ${h ? h.name : "your people"}, armed and exhausted. They ask to join you.`,
    });
  }
  if (remnant) {
    const start = g.within(tile, 3).filter((id) => g.distance(id, tile) >= 2 && !blocked(state.tiles[id]) && !state.tiles[id].hive);
    const type = rng.chance(0.5) ? "military" : "fortress";
    makeBand(state, type, {
      name: `${f.name} remnant`, color: f.color, tile: start.length ? rng.pick(start) : tile, pop: remnant, remnant: true, joinId: join ? join.id : null,
      stock: { food: remnant * 3, water: remnant * 2, ammo: remnant * 12, meds: 3, fuel: 0, parts: 1, scrap: 5, preserved: remnant, jars: 0 },
      goodwill: f.goodwill, foundAt: d + rng.int(10, 30),
    });
    const b = bandsOf(state)[bandsOf(state).length - 1];
    if (b) b.known = f.known;
  }
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
  const desperation = (f) => (f.stock.food < f.pop * 3 ? 1 : 0) + (f.pop < 12 ? 0.5 : 0) + (isAggressiveType(f) ? 1 : 0) + (f.bases.length === 1 ? 0.3 : 0);
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
  return out;
}
// For the Groups tab: one line about a band you know.
export function bandInfo(state, b) {
  const label = FACTION_TYPES[b.type] ? FACTION_TYPES[b.type].label : "Group";
  const seen = b.lastSeen ? `last seen near ${tileLabel(state, b.lastSeen.tile)} (day ${Math.floor(b.lastSeen.hour / 24) + 1})` : "not seen lately";
  const dest = b.destKnown && b.goal != null && !b.joinId ? `heading for ${tileLabel(state, b.goal)}` : "";
  return { label: `${label} (on the road)`, pop: roundPop(b.pop), attitude: attitude(b), seen, dest, tile: b.lastSeen ? b.lastSeen.tile : b.tile };
}
