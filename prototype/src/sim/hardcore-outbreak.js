// Hardcore mode, the outbreak (hardcore.js): the first year after Calder falls.
//
// The start. Mapgen places the outbreak a normal game knows (the origin's cluster of hives, a hive at each other hot
// spot, infection spread out from them). A hardcore world keeps only the first of it:
// - One hive, in a city: the first hive rises in (or at the edge of) the city nearest mapgen's outbreak origin
//   (hcOutbreakCity; on open ground among its blocks: cityHiveTile), with CITY_RES more to start with than a young
//   hive, so it has a guard from the first days. Every hive mapgen placed is taken off the map (their tiles are where
//   the first year's new hives rise). With no city on the map, the origin cluster's hive nearest the origin stays.
// - The military's base gets its hive later (the arc in hardcore-groups.js): a tile MIL_DIST tiles from the base is
//   chosen now, and on the gathering day (MIL_GATHER days after the military's strike force leaves for the city hive,
//   hcMilitary().strikeDay) a mass of the dead gathers there and builds a hive in MIL_SITE_DAYS while the garrison is
//   thin. With no military group at all a second hive starts at another hot spot half the time.
// - Infection 0% everywhere but the outbreak area around the city's hive.
// The first year. Over HC.ERA_OFFSET days (56–112: half to one 112-day game year, from the seed; the normal game's
// day 1 is this many days later; also kept as state.hardcore.eraOffset):
// - Infection spreads toward what a normal game starts with (mapgen's levels, kept per tile as t.infGoal): outward
//   from the hives (a front that grows to FRONT_MAX tiles), into the cities and towns first (each settlement turns
//   on its own day, the nearer the outbreak the sooner, the cities before the towns; the dead pack them at a level of
//   at least SETTLE_FLOOR while the year is young, then drift out into the country) and slowest in open country. By
//   the normal start every tile has its normal level; hives.js keeps radiating around every hive as always. Everything
//   that reads tile.infection (scavenging, travel encounters, battles, the map layer) follows.
// - New hives rise where a normal game has them at its start: each removed hive's tile becomes a build site on its
//   own day (the origin's cluster first), with the dead of the place already gathered there and part of the hive
//   grown (hives.js finishes it in SITE_DAYS, as with any site). They stop once the state holds a normal start's count.
// - The eras (eras.js rampDay): every ramp keyed to the year or the game day (the tech tree's tiers and special dead,
//   bigger hordes, the outbreak beyond the border and its floor, the victories' year) counts from the normal start, so
//   a hardcore run's day N ramps like a normal run's day N − offset. The hives' normal cadence of build sites and the
//   hordes from beyond the border begin later too (SITES_AFTER, BORDER_FROM).
// - The military base's hive: while its mass gathers, the dead of the base's surroundings keep drifting in (MIL_FEED
//   a day, while the mass is short of what the hive still needs: the garrison's shelling delays it, it does not stop
//   it). Once it stands it grows (MIL_INCOME more a day) and sends hordes at the base, every MIL_GAP days and bigger
//   each time (MIL_SIZE × what it takes to break the base's thinned defence: survivable at first, breaking it from
//   MIL_BREAK_AT of the way on), so that the base gives way about the overrun day (MIL_OVERRUN days from the seed, at
//   least MIL_HOLD days after the hive stands: about days 24–48). How the military fights back and what happens when
//   it falls is hardcore-groups.js's. Destroy the hive (or its mass) and the hordes stop. With no military group
//   nothing is sent.
// Everything here runs only in a hardcore world (state.mode === "hardcore"); a normal game never calls it.
import { day, log } from "./world.js";
import { ensureHives, newHive, hiveAt, deliverToSite } from "./hives.js";
import { HIVE } from "./hiveconst.js";
import { makeHorde, HORDE_MAX_SIZE } from "./hordes.js";
import { strength } from "./factions.js";
import { hiveMix, growthAt } from "./hivetech.js";
import { findPath } from "./hex.js";
import { partyTile, tileLabel } from "./parties.js";
import { chronicleNote } from "./chronicle.js";
import { worldScale } from "./worldsize.js";
import { hcMilitary } from "./hardcore-groups.js";

export const HC = {
  ERA_OFFSET: [56, 112],  // days from the fall to a normal game's day 1: half to one game year (per world, from its seed)
  START_R: 4,             // the outbreak area around a starting hive on day 1 (tiles)
  FRONT_MAX: 24,          // the front out from the hives reaches this much farther by the normal start (× √ map area)
  FRONT_SOFT: 6,          // ... fading in over this many tiles
  CATCH_UP: 0.03,         // a tile below its level rises this much more a day (on top of hives.js's 0.02)
  OPEN_POW: 1.6,          // open country: its normal level × (share of the year gone) ^ this
  SETTLE_RAMP: 0.25,      // a settlement fills up over this share of the year once its day comes
  CITY_ONSET: [0.02, 0.25], // a city's day: this share of the year, from right by the outbreak to 40+ tiles away
  TOWN_ONSET: [0.04, 0.35], // a town's
  SETTLE_FLOOR: { city: 0.55, town: 0.4 }, // the dead pack a settlement at least this thick early on (fading by the normal start)
  SETTLE_R: 2,            // town tiles: within this of its center (cities: their city and suburb tiles)
  // New hives through the first year: build sites at the normal start's hive spots, due at these shares of the year.
  ORIGIN_DUE: [0.12, 0.5], OTHER_DUE: [0.3, 0.8],
  SITE_DAYS: [12, 20],    // such a site has the dead gathered and part of the hive grown: it stands in this many days
  SITES_AFTER: 1,         // the hives' own new build sites (hives.js, every 120–180 days) begin this share of the year late
  BORDER_FROM: 0.5,       // hordes from beyond the border begin at this share of the year
  // The first hive, in the city nearest the outbreak origin.
  CITY_RES: 25,           // more resources than a young hive's to start with (a guard from the first days)
  CITY_REACH: 5,          // its tile: open ground (no site) within this of the city's centre, city and suburb blocks first
  // The military base's hive.
  MIL_DIST: [3, 6],       // tiles from the base
  MIL_GATHER: [1, 3],     // the dead mass there this many days after the strike force leaves (hcMilitary().strikeDay)
  MIL_GATHER_NOSTRIKE: [6, 12], // ... the day they mass when no strike force goes out
  MIL_SITE_DAYS: [8, 14], // ... and the hive stands in this many days
  MIL_FEED: 40,           // the dead drifting into the mass a day while it is short of what the hive still needs
  SECOND_SPOT: 0.5,       // no military at all: chance of a second hive at another hot spot
  MIL_INCOME: 3,          // more resources a day for it (the dead of the base's surroundings)
  MIL_OVERRUN: [24, 48],  // the base is meant to give way about this day (per world, from its seed)
  MIL_HOLD: 10,           // ... and at least this many days after its hive stands
  MIL_FIRST: [2, 4],      // days after the hive stands before its first horde at the base
  MIL_GAP: [6, 3],        // days between hordes at the base: at first, and by the overrun day
  MIL_SIZE: [0.3, 1.4],   // horde size × what breaks the base's defence: at first, and by the overrun day
  MIL_BREAK_AT: 0.7,      // ... it reaches 1 (a blow that breaks the base) this share of the way to the overrun day
};

const hash = (n) => { let x = (n >>> 0) ^ 0x2545f491; x = Math.imul(x ^ (x >>> 16), 0x7feb352d); x = Math.imul(x ^ (x >>> 15), 0x846ca68b); return (x ^ (x >>> 16)) >>> 0; };
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const isLand = (t) => t.terrain !== "water" || t.bridge;

// Days from the fall to the normal start, from the seed alone (anything may call it, before or after the setup).
export function hardcoreEraOffset(state) {
  if (state.hardcore && state.hardcore.eraOffset) return state.hardcore.eraOffset;
  const [a, b] = HC.ERA_OFFSET;
  return a + (hash((state.seed || 1) * 31 + 7) % (b - a + 1));
}
// Where the player is: the hub, else the team on the road (hardcore-start.js), else nowhere yet.
function playerTile(state) {
  if (state.bases.length) return state.bases[0].tile;
  const p = (state.parties || []).find((x) => x.owner === "player" && x.path);
  return p ? partyTile(p) : null;
}
const militaryOf = (state) => state.factions.find((f) => f.alive && f.type === "military" && f.bases.length) || null;
export const hcOutbreak = (state) => (state.hardcore && state.hardcore.outbreak) || null;

// The city the outbreak starts in: the one nearest mapgen's outbreak origin (its centre tile; null with no city).
// No random numbers: the start (hardcore-start.js) and the bands (hardcore-groups.js) read it before the setup here.
export function hcOutbreakCity(state) {
  const O = hcOutbreak(state);
  if (O && O.city !== undefined) return O.city;
  const cities = state.cityIds || [];
  if (!cities.length || state.originId == null) return null;
  const g = state.grid;
  return [...cities].sort((a, b) => g.distance(a, state.originId) - g.distance(b, state.originId) || a - b)[0];
}
// The city hive's tile: open ground (no site, no river crossing needed) among the city's blocks, nearest the centre;
// else open ground at the edge of the city.
export function cityHiveTile(state, center) {
  const g = state.grid;
  const ok = (id) => { const t = state.tiles[id]; return t.terrain !== "water" && t.terrain !== "mountain" && !t.loc && !t.hive; };
  const urban = (id) => state.tiles[id].terrain === "city" || state.tiles[id].terrain === "suburb";
  const cands = g.within(center, HC.CITY_REACH).filter(ok);
  if (!cands.length) return null;
  cands.sort((a, b) => (urban(b) ? 1 : 0) - (urban(a) ? 1 : 0) || g.distance(a, center) - g.distance(b, center) || a - b);
  return cands[0];
}

// ---------- the start (createWorld, after hives.js ensureHives) ----------
export function setupHardcoreOutbreak(state) {
  const g = state.grid, rng = state.rng;
  ensureHives(state);
  state.hardcore = state.hardcore || {};
  const offset = (state.hardcore.eraOffset = hardcoreEraOffset(state));
  const O = (state.hardcore.outbreak = {
    normalHives: state.hives.length, // what a normal start holds: the count the first year grows toward
    start: [], pending: [], settle: [], onset: {}, infDone: false, mil: null,
  });
  const me = playerTile(state);
  // 1. The first hive: in the city nearest the outbreak origin (else the origin cluster's hive nearest the origin).
  const byOrigin = [...state.hives].sort((a, b) => g.distance(a.tile, state.originId) - g.distance(b.tile, state.originId) || a.id - b.id);
  const city = hcOutbreakCity(state);
  const cityTile = city != null ? cityHiveTile(state, city) : null;
  O.city = cityTile != null ? city : null;
  const keep = cityTile != null ? [] : [byOrigin[0]];
  // 2. The military's base, and the tile near it where its hive will rise.
  const mf = militaryOf(state);
  const milBase = mf ? mf.bases[0] : state.militaryIds && state.militaryIds.length ? state.militaryIds[0] : null;
  // 3. Take every other hive off the map; their tiles are where the first year's new hives rise.
  const removed = [];
  for (const h of [...state.hives]) {
    if (keep.includes(h)) continue;
    state.hives.splice(state.hives.indexOf(h), 1);
    state.tiles[h.tile].hive = false;
    removed.push(h.tile);
  }
  if (cityTile != null) {
    const ch = newHive(state, cityTile, HIVE.START_RES + HC.CITY_RES);
    state.hives.push(ch);
    O.cityHive = ch.id;
  } else if (keep[0]) O.cityHive = keep[0].id;
  if (milBase == null && byOrigin.length > 1 && rng.chance(HC.SECOND_SPOT)) {
    // No military at all: half the time a second hive at another hot spot (the mapgen hive farthest from the first).
    const first = state.hives[0].tile;
    const far = [...byOrigin].sort((a, b) => g.distance(b.tile, first) - g.distance(a.tile, first) || a.id - b.id)[0];
    if (g.distance(far.tile, first) > 10 && !state.tiles[far.tile].hive) {
      state.hives.push(newHive(state, far.tile, HIVE.START_RES));
      removed.splice(removed.indexOf(far.tile), 1);
    }
  }
  for (const h of state.hives) O.start.push(h.tile);
  // The military's hive: the dead mass there a few days after the strike force leaves for the city (hardcore-groups.js).
  const milTile = milBase != null ? pickMilTile(state, milBase, me) : null;
  if (milBase != null && milTile != null) {
    const strike = mf ? hcMilitary(state) : null;
    const strikeDay = strike && strike.id === mf.id ? strike.strikeDay : null;
    const gatherDay = strikeDay != null ? strikeDay + rng.int(HC.MIL_GATHER[0], HC.MIL_GATHER[1]) : rng.int(HC.MIL_GATHER_NOSTRIKE[0], HC.MIL_GATHER_NOSTRIKE[1]);
    const standsIn = rng.int(HC.MIL_SITE_DAYS[0], HC.MIL_SITE_DAYS[1]);
    const overrun = Math.max(gatherDay + standsIn + HC.MIL_HOLD, rng.int(HC.MIL_OVERRUN[0], HC.MIL_OVERRUN[1]));
    O.mil = {
      tile: milTile, base: milBase, factionId: mf ? mf.id : null, overrun, gatherDay, standsIn, gathered: null,
      stood: null, next: null, sent: 0, dead: 0, fed: 0, done: null,
    };
  }
  // 4. The first year's new hives: the removed tiles, the origin's cluster first.
  for (const tile of removed) {
    const nearOrigin = g.distance(tile, state.originId) <= 6;
    const [a, b] = nearOrigin ? HC.ORIGIN_DUE : HC.OTHER_DUE;
    O.pending.push({ tile, due: Math.max(2, Math.round(offset * rng.range(a, b))) });
  }
  O.pending.sort((x, y) => x.due - y.due || x.tile - y.tile);
  // 5. The hives' own cadence and the border hordes begin later (hives.js).
  state.hiveInfo.nextSiteDay += Math.round(offset * HC.SITES_AFTER);
  state.hiveInfo.nextBorderDay += Math.round(offset * HC.BORDER_FROM);
  // 6. Infection: the normal start's levels are the goal; today it is 0 away from the outbreak.
  settlements(state, O, offset);
  for (const t of state.tiles) {
    t.infGoal = t.infBase ?? t.infection;
    t.infBase = 0;
    t.infection = 0;
  }
  spreadInfection(state, O, offset, true);
}

// A tile 3–6 from the military base for its hive: open land, reachable from the base over land, away from you and
// from other people; 4–5 tiles out likeliest.
function pickMilTile(state, base, me) {
  const g = state.grid;
  const people = [...state.bases.map((b) => b.tile), ...state.factions.filter((f) => f.alive).flatMap((f) => f.bases)].filter((t) => t !== base);
  const ok = (id, keepMe) => {
    const t = state.tiles[id], d = g.distance(id, base);
    if (d < HC.MIL_DIST[0] || d > HC.MIL_DIST[1] || t.terrain === "water" || t.terrain === "mountain" || t.loc || t.hive) return false;
    if (people.some((p) => g.distance(p, id) <= 3) || (keepMe && me != null && g.distance(me, id) < 8)) return false;
    return !!findPath(g, id, base, (a, b) => (isLand(state.tiles[b]) ? 1 : Infinity), 16);
  };
  const all = g.within(base, HC.MIL_DIST[1]);
  let cands = all.filter((id) => ok(id, true));
  if (!cands.length) cands = all.filter((id) => ok(id, false));
  if (!cands.length) return null;
  return state.rng.weighted(cands, (id) => { const d = g.distance(id, base); return d === 4 || d === 5 ? 3 : 1; });
}

// A build site with the dead already gathered (they build the hive at hives.js's pace: at most 40 a day go in).
// days: it stands in about this many days (some of the hive is grown already).
function gatherSite(state, tile, tag = null, days = null) {
  const biomass = days == null ? 0 : Math.max(0, HIVE.SITE_BIOMASS - HIVE.SITE_INTAKE * days);
  const site = { id: (state.hiveSeq = (state.hiveSeq || 0) + 1), tile, chosen: state.hour, score: 0, biomass, started: null, hardcore: tag || "military" };
  state.hiveSites.push(site);
  state.hiveInfo.stats.sites++;
  let left = HIVE.SITE_BIOMASS - biomass + 60;
  while (left >= 30) {
    const n = Math.min(HORDE_MAX_SIZE - 50, left);
    const h = makeHorde(state, { tile, size: n, role: "build", site: site.id, target: tile, split: true });
    deliverToSite(state, h, site);
    left -= n;
  }
  return site;
}

// Which tiles belong to a city or town, and the day each settlement fills with the dead.
function settlements(state, O, offset) {
  const g = state.grid, rng = state.rng;
  const cities = state.cityIds || [];
  const towns = state.tiles.filter((t) => t.loc && t.loc.type === "town").map((t) => t.id);
  const from = O.start.length ? O.start : [state.originId];
  const reach = 40 * Math.sqrt(worldScale(state));
  const onsetOf = (id, [a, b]) => {
    const d = Math.min(...from.map((s) => g.distance(s, id)));
    return Math.max(1, Math.round(offset * lerp(a, b, Math.min(1, d / reach)) * rng.range(0.7, 1.3)));
  };
  for (const c of cities) O.onset[c] = onsetOf(c, HC.CITY_ONSET);
  for (const t of towns) O.onset[t] = onsetOf(t, HC.TOWN_ONSET);
  for (const t of state.tiles) {
    let center = null;
    if (t.terrain === "city" || t.terrain === "suburb") {
      let bd = 99;
      for (const c of cities) { const d = g.distance(c, t.id); if (d < bd) { bd = d; center = c; } }
    } else {
      for (const tw of towns) if (g.distance(tw, t.id) <= HC.SETTLE_R) { center = tw; break; }
    }
    if (center != null) O.settle.push([t.id, center]);
  }
}

// ---------- the infection's daily spread ----------
// Each tile's base level (the level hives.js radiate() moves it toward, up 0.02 a day, down 0.01) is its normal
// start level × how far the outbreak has reached it: the front out from the hives, its settlement's day, the slow
// creep into open country; settlements packed with the dead early on. first: day 1 (the levels are set at once).
function spreadInfection(state, O, offset, first = false) {
  const g = state.grid;
  const d = day(state);
  const p = clamp01((d - 1) / offset);
  if (p >= 1) {
    for (const t of state.tiles) t.infBase = t.infGoal ?? t.infBase;
    O.infDone = true;
    return;
  }
  const centres = [...state.hives.map((h) => h.tile), ...state.hiveSites.filter((s) => s.hardcore).map((s) => s.tile)];
  const R = HC.START_R + HC.FRONT_MAX * Math.sqrt(worldScale(state)) * p;
  const town = new Map(O.settle);
  const cities = new Set(state.cityIds || []);
  const openW = p ** HC.OPEN_POW;
  for (const t of state.tiles) {
    const goal = t.infGoal ?? 0;
    let near = Infinity;
    for (const c of centres) { const k = g.distance(c, t.id); if (k < near) near = k; }
    let w = Math.max(openW, clamp01((R - near) / HC.FRONT_SOFT));
    let level = goal * w;
    const center = town.get(t.id);
    if (center != null) {
      const ws = clamp01((d - (O.onset[center] || 1)) / (offset * HC.SETTLE_RAMP));
      const floor = (cities.has(center) ? HC.SETTLE_FLOOR.city : HC.SETTLE_FLOOR.town) * (1 - p * p);
      level = Math.max(level, ws * Math.max(goal, Math.min(floor, goal + floor))); // packed early, its own level by the end
    }
    // The outbreak area right around a starting hive or a gathering mass: the dead are thick from day 1.
    if (near <= HC.START_R) level = Math.max(level, 0.85 - 0.12 * near);
    t.infBase = Math.min(1, level);
    if (first) t.infection = t.infBase;
    // A short year: the dead pour in faster than hives.js's 0.02 a day alone would bring them.
    else if (t.infection < t.infBase) t.infection = Math.min(t.infBase, t.infection + HC.CATCH_UP);
  }
}

// ---------- the first year's new hives ----------
function sitesDaily(state, O) {
  const d = day(state);
  while (O.pending.length && O.pending[0].due <= d) {
    const { tile } = O.pending.shift();
    const standing = state.hives.length + state.hiveSites.filter((s) => s.started != null || s.hardcore).length;
    if (standing >= O.normalHives) continue; // as many as a normal start already
    const at = siteTile(state, tile);
    if (at == null) continue;
    gatherSite(state, at, "spread", state.rng.int(HC.SITE_DAYS[0], HC.SITE_DAYS[1]));
    if (state.live.has(at)) log(state, `The dead are pouring out of the stricken places and gathering in a great mass nearby. Something is being built there.`, "danger");
  }
}
// The tile itself if it is still open ground away from people, else the nearest that is (within 3).
function siteTile(state, tile) {
  const g = state.grid;
  const people = [...state.bases.map((b) => b.tile), ...state.factions.filter((f) => f.alive).flatMap((f) => f.bases)];
  const me = playerTile(state);
  if (me != null) people.push(me);
  const O = hcOutbreak(state);
  const reserved = O && O.mil && O.mil.gathered == null ? O.mil.tile : null; // the military's hive's tile, before its dead mass
  const ok = (id) => {
    const t = state.tiles[id];
    if (reserved != null && g.distance(reserved, id) <= 4) return false;
    return t.terrain !== "water" && t.terrain !== "mountain" && !t.hive && !t.loc && !growthAt(state, id) &&
      !people.some((p) => g.distance(p, id) <= 3) && !state.hiveSites.some((s) => g.distance(s.tile, id) <= 4) && !state.hives.some((h) => g.distance(h.tile, id) < 2);
  };
  if (ok(tile)) return tile;
  let best = null, bd = 99;
  for (const id of g.within(tile, 3)) { const k = g.distance(tile, id); if (k < bd && ok(id)) { best = id; bd = k; } }
  return best;
}

// ---------- the military base's hive ----------
function militaryDaily(state, O) {
  const M = O.mil;
  if (!M || M.done != null || M.factionId == null) return;
  const d = day(state);
  const f = state.factions.find((x) => x.id === M.factionId);
  if (!f || !f.alive || !f.bases.includes(M.base)) { M.done = d; return; } // overrun, or moved out: its work is done
  // The gathering day (a few days after the strike force left): the dead mass near the base and start to build.
  if (M.gathered == null) {
    if (d < M.gatherDay) return;
    const t = state.tiles[M.tile];
    if (t.hive || t.loc || state.hiveSites.some((s) => state.grid.distance(s.tile, M.tile) <= 2)) {
      const again = pickMilTile(state, M.base, playerTile(state));
      if (again == null) { M.done = d; return; }
      M.tile = again;
    }
    const site = gatherSite(state, M.tile, "military", M.standsIn);
    M.gathered = d;
    M.siteId = site.id;
    const where = tileLabel(state, M.tile);
    if (f.known) log(state, `📻 ${f.name}: "The dead are massing ${dirWord(state, M.base, M.tile)} of the base, near ${where}. Thousands of them. They are building something out there."`, "danger");
    else if (state.live.has(M.tile)) log(state, `The dead are gathering in a great mass near ${where}. Something is being built there.`, "danger");
    return;
  }
  const hive = hiveAt(state, M.tile);
  if (!hive) {
    const site = state.hiveSites.find((s) => s.tile === M.tile);
    if (!site) { M.done = d; return; } // destroyed before or after it stood
    feedSite(state, M, site);
    return;
  }
  if (M.stood == null) {
    M.stood = d;
    const H = hcMilitary(state);
    const away = !!(H && H.strike && ["travel", "fight", "retreat", "holed"].includes(H.strike.phase));
    if (f.known) log(state, `📻 ${f.name}: "It is a hive. A hive just past our wire${away ? ", and half of us are still out at the city" : ""}."`, "death");
    chronicleNote(state, `A hive rose by ${tileLabel(state, M.base)}${away ? " while half its soldiers were away" : ""}.`, "danger", M.tile, true);
  }
  hive.res = Math.min(HIVE.RES_CAP, hive.res + HC.MIL_INCOME);
  if (M.next == null) M.next = M.stood + state.rng.int(HC.MIL_FIRST[0], HC.MIL_FIRST[1]);
  if (d < M.next) return;
  // How far along: 0 when it first sends, 1 by the overrun day (MIL_BREAK_AT of the way: the size that breaks it).
  const span = Math.max(HC.MIL_HOLD, M.overrun - M.stood);
  const t = clamp01((d - M.stood) / span);
  const breakAt = HC.MIL_BREAK_AT;
  const k = t <= breakAt ? lerp(HC.MIL_SIZE[0], 1, breakAt ? t / breakAt : 1) : lerp(1, HC.MIL_SIZE[1], (t - breakAt) / Math.max(0.01, 1 - breakAt));
  // What breaks the base's defence: a horde of n weighs n × 0.12 on the walls (hordes.js hordeWallPower) against
  // 8 + their strength × 0.8 (groupflight.js baseHold), and a mass of HC_MILITARY.OVERRUN_RATIO × that overruns the
  // base (hardcore-groups.js hcMilitaryHordeHit); 1.1 × here, the last hordes MIL_SIZE[1] × it.
  const need = ((8 + strength(f) * 0.8) * 1.1) / 0.12;
  let size = Math.max(30, Math.round(need * k * state.rng.range(0.85, 1.15)));
  M.sent++;
  M.dead += size;
  const { mix, elite } = hiveMix(state, hive, "large"); // a war host: the odds of a large horde (hivetech.js)
  const out = state.grid.neighbors(hive.tile).filter((id) => isLand(state.tiles[id]));
  const from = out.length ? state.rng.pick(out) : hive.tile;
  while (size >= 10) {
    const n = Math.min(HORDE_MAX_SIZE, size);
    makeHorde(state, { tile: from, size: n, hive: hive.id, role: "attack", goal: { tile: M.base, baseId: null, factionId: f.id }, target: M.base, mix, elite, split: true });
    size -= n;
  }
  M.next = d + Math.max(2, Math.round(lerp(HC.MIL_GAP[0], HC.MIL_GAP[1], t) * state.rng.range(0.8, 1.2)));
}

// The mass by the base is short of what the hive still needs (the garrison shelled it, or it was thin): the dead of
// the base's surroundings drift in, up to MIL_FEED a day.
function feedSite(state, M, site) {
  const mass = state.hordes.filter((h) => (h.role === "mass" || h.role === "build") && h.site === site.id).reduce((a, h) => a + h.size, 0);
  const short = HIVE.SITE_BIOMASS - site.biomass + 30 - mass;
  if (short <= 0) return;
  const n = Math.min(HC.MIL_FEED, short);
  const h = makeHorde(state, { tile: site.tile, size: n, role: "build", site: site.id, target: site.tile, split: true });
  deliverToSite(state, h, site);
  M.fed = (M.fed || 0) + n;
}
// "north", "south-east"...: where `to` lies from `from`, for the radio.
function dirWord(state, from, to) {
  const a = state.tiles[from], b = state.tiles[to];
  const dx = b.x - a.x, dy = b.y - a.y;
  const ns = dy < -Math.abs(dx) / 2 ? "north" : dy > Math.abs(dx) / 2 ? "south" : "";
  const ew = dx > Math.abs(dy) / 2 ? "east" : dx < -Math.abs(dy) / 2 ? "west" : "";
  return ns && ew ? `${ns}-${ew}` : ns || ew || "just outside";
}

// ---------- every day (hardcore.js) ----------
export function hardcoreOutbreakDaily(state) {
  const O = hcOutbreak(state);
  if (!O) return;
  ensureHives(state);
  sitesDaily(state, O);
  militaryDaily(state, O);
  if (!O.infDone) spreadInfection(state, O, hardcoreEraOffset(state));
}

// For the Goals panel, the threat line and the tools: how far the first year has gone.
export function outbreakProgress(state) {
  const O = hcOutbreak(state);
  if (!O) return null;
  const offset = hardcoreEraOffset(state);
  const d = day(state);
  return {
    offset, day: d, share: clamp01((d - 1) / offset), spreading: !O.infDone, normalStart: offset + 1,
    hives: state.hives.length, sites: state.hiveSites.length, normalHives: O.normalHives, pending: O.pending.length,
    city: O.city ?? null, cityHive: O.cityHive ?? null,
    military: O.mil ? { tile: O.mil.tile, base: O.mil.base, overrun: O.mil.overrun, gatherDay: O.mil.gatherDay, gathered: O.mil.gathered, stood: O.mil.stood, sent: O.mil.sent, dead: O.mil.dead, fed: O.mil.fed || 0, done: O.mil.done } : null,
  };
}
