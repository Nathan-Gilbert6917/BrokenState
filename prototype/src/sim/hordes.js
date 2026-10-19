// @ts-check
// Hordes: crowds of the dead on the State Map. Hives (hives.js) build them with resources and give each one a
// job (role): "guard" stays on its hive, "build" walks to a new hive's build site and becomes part of its "mass",
// "roam" wanders near home, "attack" marches on a base, and "border" hordes come in from off the map. A horde
// moves at most 2 tiles a day (12 hours a tile, slower in deep cold or snow: weather.js), merges with hordes it
// meets that are on the same errand, and can split while each part keeps at least 10 of the dead. Its score
// (hordeScore, from its size) is how tough it is when met and how much it adds to a new hive.
import { newId, atBase, day } from "./world.js";
import { bridgeHolder } from "./parties.js"; // a bridge barricaded with a base (nextStep)
import { findPath } from "./hex.js";
import { mannedStations } from "./buildings.js";
import { generatorHeat } from "./power.js";
import { resolveRaidOnFaction } from "./factions.js";
import { hordeSpeedAt, riverFrozen } from "./weather.js";
import { hivesDaily, hiveById, siteById, deliverToSite, drawnToSite } from "./hives.js";
import { hordeAttackBase, hordeWarnings, towerWatch, breakInForce, DEFENCE } from "./defences.js";
import { hordeGrowth, rampDay } from "./eras.js";
import { mergeMix, mixWeight } from "./zombietypes.js";
import { ZTYPES } from "./hiveconst.js";
import { sowTile } from "./middead.js"; // Sowers
import { hordeMilitaryPickup } from "./deadsoldiers.js";
import { hordeBeastPickup } from "./deadbeasts.js"; // the dead beasts of the hills, the woods and the farmland
import { shelterHeat } from "./fieldheat.js";
import { hordeOverrun, baseHold } from "./groupflight.js"; // a group whose base the dead overran may leave it
import { SILENT } from "./hiding.js"; // a base running silent makes less noise
import { hordeEnter as fieldHordeEnter } from "./fieldworks.js"; // field works in the dead's way
import { cfgOf } from "./worldcfg.js"; // the run's dials: Horde size
// A horde may carry special dead from its hive's growths (hivetech.js): h.mix is the share of each kind
// ({ runner: 0.15, brute: 0.08 }), kept through merges (weighted) and splits; h.elite from a mutation vat. Many
// runners move it a quarter faster; screamers in it pull wandering hordes within 3 tiles along with it.

export const HOURS_PER_TILE = 12;  // at most 2 tiles a day
export const HORDE_MAX_SIZE = 600; // merging stops here
export const HORDE_MIN_SIZE = 5;   // fewer than this is no longer a horde: it is removed
export const SPLIT_MIN = 10;       // a split leaves at least this many in each part
// What a hive pays for a horde, and how big it comes out (hives.js).
export const HORDE_SIZES = {
  small:  { name: "small",  min: 10,  max: 25,  cost: 3 },
  medium: { name: "medium", min: 50,  max: 80,  cost: 8 },
  large:  { name: "large",  min: 100, max: 200, cost: 15 },
};
const WANDER = new Set(["roam", "border", undefined, null]);

// A horde's score from its size: about 3 for a small horde, 8 for a medium one, 16 for a large one (20 at 200,
// 33 at 400). It sets the horde's toughness in a fight and what it adds to a new hive (hives.js).
export const hordeScore = (size) => Math.round((Math.max(0, size || 0) ** 0.8 / 3.4) * 10) / 10;
// A horde's weight on a group's walls (onHordeEnter; groupflight.js judges a base it cannot hold by it): a
// Wallbreaker at its head makes it half again as dangerous, special dead weigh more (zombietypes.js mixWeight).
export const hordeWallPower = (h) => h.size * 0.12 * (h.bosses ? 1.6 : 1) * mixWeight(h.mix, "wall");
export const hordeClass = (size) => (size < 40 ? "small" : size < 95 ? "medium" : size <= 220 ? "large" : "huge");

// Eras (eras.js): from year 3 a new roaming, attacking or border horde comes bigger every year (+4% a year, at most
// +40%). A part split off a horde (o.split) keeps its size.
const GROWS = new Set(["roam", "attack", "border"]);
export function makeHorde(state, o) {
  const grow = !o.split && GROWS.has(o.role || "roam") ? hordeGrowth(state) : 1;
  const hm = o.split ? 1 : cfgOf(state, "hordes"); // worldcfg.js: the run's Horde size dial (a part split off keeps its size; at 1 the size is as it always was)
  const h = {
    id: newId(), tile: o.tile, size: hm === 1 ? Math.round(o.size * grow) : Math.max(1, Math.round(o.size * grow * hm)), target: o.target ?? null, move: 0,
    role: o.role || "roam", hive: o.hive ?? null, site: o.site ?? null, bosses: o.bosses || 0, goal: o.goal || null, born: state.hour,
    mix: o.mix || null, elite: !!o.elite,
  };
  state.hordes.push(h);
  return h;
}

// Takes n of the dead off a horde. A horde below HORDE_MIN_SIZE is removed from the map at once (a Wallbreaker
// with it dies with it); returns true then. Every place that shrinks a horde goes through here (or is caught by
// pruneHordes within the hour).
export function reduceHorde(state, h, n) {
  h.size = Math.max(0, Math.round(h.size - Math.max(0, n)));
  if (h.size >= HORDE_MIN_SIZE) return false;
  const i = state.hordes.indexOf(h);
  if (i >= 0) state.hordes.splice(i, 1);
  return true;
}

// Safety net, every hour: no horde of fewer than HORDE_MIN_SIZE stays on the map, whoever shrank it.
export function pruneHordes(state) {
  for (let i = state.hordes.length - 1; i >= 0; i--) if (!(state.hordes[i].size >= HORDE_MIN_SIZE)) state.hordes.splice(i, 1);
}

// Splits n of the dead off into a new horde on the same tile, doing the same job. Refused (null) unless both
// parts keep at least SPLIT_MIN.
export function splitHorde(state, h, n) {
  n = Math.round(n);
  if (n < SPLIT_MIN || h.size - n < SPLIT_MIN) return null;
  h.size -= n;
  const part = makeHorde(state, { tile: h.tile, size: n, role: h.role, hive: h.hive, site: h.site, goal: h.goal, target: h.target, mix: h.mix ? { ...h.mix } : null, elite: h.elite, split: true });
  part.move = h.move;
  return part;
}

export function baseHeat(state, base) {
  const people = atBase(state, base.id);
  const workshop = mannedStations(state, base); // stations with an operator at work; idle "Operate" people make no noise
  // A shelter (tier 0, buildings.js): its fire, vehicles parked and shooting nearby (fieldheat.js shelterHeat) instead of the hub's flat 3.
  const own = base.type !== "hub" ? 0 : base.tier === 0 ? Math.round(shelterHeat(state, base).total * 10) / 10 : 3;
  // Running silent (hiding.js): quiet workshops, small fires, the radio off, the generator muffled: × SILENT.HEAT.
  const q = base.silent ? SILENT.HEAT : 1;
  return people.length + (workshop * 3 + (base.radio && !base.silent ? 2 : 0) + own + generatorHeat(base)) * q + (base.huntNoise || 0) + (base.woodNoise || 0) + (base.tripNoise || 0); // a running generator is loud (power.js); hunters' gunshots (hunting.js); axes (woodcutting.js)
}

// Hordes that meet merge when they are on the same errand: wandering ones (roaming or from the border), or
// the same hive's guard, the same build site, the same attack.
function intent(h) {
  if (WANDER.has(h.role)) return "wander";
  if (h.role === "guard") return `guard:${h.hive}`;
  if (h.role === "build") return `build:${h.site}`;
  if (h.role === "mass") return `mass:${h.site}`;
  if (h.role === "attack") return `attack:${h.goal ? h.goal.tile : h.target}`;
  return `other:${h.id}`;
}

export function mergeHordes(state) {
  const at = new Map();
  for (const h of state.hordes) {
    const k = `${h.tile}|${intent(h)}`;
    const first = at.get(k);
    if (!first) { at.set(k, h); continue; }
    // Up to the cap; a remainder too small to stand alone goes along anyway.
    const room = HORDE_MAX_SIZE - first.size;
    if (room < SPLIT_MIN) { at.set(k, h); continue; } // that one is full: the next ones gather on this one
    const take = h.size - room < SPLIT_MIN ? h.size : room;
    if (first.mix || h.mix) first.mix = mergeMix(first.mix, first.size, h.mix, take);
    if (h.elite && take >= first.size) first.elite = true; // the elite dead lead when they are the most
    first.size += take;
    h.size -= take;
    first.bosses = (first.bosses || 0) + (h.size ? 0 : h.bosses || 0);
    if (!h.size) h.bosses = 0;
  }
  for (let i = state.hordes.length - 1; i >= 0; i--) if (!state.hordes[i].size) state.hordes.splice(i, 1);
}

const isLand = (state, id) => { const t = state.tiles[id]; return t.terrain !== "water" || t.bridge; };
// Where the dead can walk: land, and a river frozen in deep winter (weather.js ICE; never a place to stop and roam).
const walkable = (state, id) => isLand(state, id) || riverFrozen(state, id);

// The next tile toward a horde's target over land (rivers are crossed at bridges, or on the ice in deep winter). The
// way is planned once per
// target and kept on the horde; a target it cannot reach is dropped (its job then falls back to wandering).
// A bridge barricaded with a base (parties.js bridgeHolder: yours or a group's) is no way over for a horde unless the
// base is where it is going: a horde whose way needs that bridge turns on the barricade instead (role attack, the base
// its goal) and attacks it when it gets there (onHordeEnter), like any base.
const barricaded = (state, id) => !!state.tiles[id].bridge && bridgeHolder(state, id) != null;
function nextStep(state, h) {
  const g = state.grid;
  if (h.path && h.path.length > 1 && !walkable(state, h.path[1])) h.path = null; // the ice it meant to cross has gone
  if (!h.path || h.pathTo !== h.target || h.path[0] !== h.tile) {
    const res = findPath(g, h.tile, h.target, (a, b) => (walkable(state, b) && (b === h.target || !barricaded(state, b)) ? 1 : Infinity), 120);
    if (!res || res.path.length < 2) {
      const over = findPath(g, h.tile, h.target, (a, b) => (walkable(state, b) ? 1 : Infinity), 120);
      const stop = over && over.path.length >= 2 ? over.path.findIndex((id, i) => i > 0 && barricaded(state, id)) : -1;
      if (stop > 0) { // only a barricade in the way: the horde goes for it
        const tile = over.path[stop];
        const base = state.bases.find((x) => x.tile === tile);
        const f = base ? null : state.factions.find((x) => x.alive && x.bases.includes(tile));
        h.role = "attack"; h.site = null;
        h.goal = base ? { baseId: base.id, tile } : { factionId: f ? f.id : null, tile };
        h.target = tile; h.pathTo = tile; h.path = over.path.slice(0, stop + 1);
        h.path.shift();
        return h.path[0] ?? null;
      }
      h.path = null;
      h.target = null;
      // A build site its hive cannot reach by land: that hive stops sending hordes there (hives.js supportSite).
      const site = h.role === "build" ? siteById(state, h.site) : null;
      if (site && h.hive != null) (site.noPath = site.noPath || []).push(h.hive);
      if (h.role === "build" || h.role === "attack") { h.role = "roam"; h.site = null; h.goal = null; }
      return null;
    }
    h.path = res.path;
    h.pathTo = h.target;
  }
  h.path.shift();
  return h.path[0] ?? null;
}

export function hordesHour(state) {
  const g = state.grid;
  pruneHordes(state);
  for (const h of [...state.hordes]) {
    if (!state.hordes.includes(h)) continue;
    if (h.target == null || h.target === h.tile) { h.move = Math.min(HOURS_PER_TILE, h.move || 0); continue; }
    let speed = 1;
    try { speed = hordeSpeedAt(state, h.tile); } catch { speed = 1; } // the cold and a blizzard where it is (weather.js)
    h.move = (h.move || 0) + speed * hordePace(h); // runners set the pace
    if (h.move < HOURS_PER_TILE) continue;
    h.move -= HOURS_PER_TILE;
    const next = nextStep(state, h);
    if (next == null) continue;
    h.from = h.tile; // the side a break-in comes from (deploy.js)
    h.tile = next;
    onHordeEnter(state, h);
  }
  mergeHordes(state);
  hordeWarnings(state); // defences.js: lookouts see a horde coming for a base
  towerWatch(state); // defences.js: a watchtower sees a horde near: its alarm (work.js moves backup guards up)
}

function onHordeEnter(state, h) {
  if (!state.hordes.includes(h)) return;
  hordeMilitaryPickup(state, h); // deadsoldiers.js: crossing a military site, some of its dead soldiers fall in
  sowTile(state, h); // middead.js: Sowers seed the land they cross with the worm's eggs
  hordeBeastPickup(state, h); // deadbeasts.js: crossing bad land in the hills, the woods or the farms, some of its dead beasts fall in
  fieldHordeEnter(state, h); // fieldworks.js: a field work on the tile is battered (a roadblock holds the horde)
  const base = state.bases.find((b) => b.tile === h.tile);
  if (base) return hordeAttackBase(state, h, base);
  const f = state.factions.find((x) => x.alive && x.bases.includes(h.tile));
  if (f) {
    // Your base's way (defences.js hordeAttackBase; docs/adr/0001-ai-parity.md): the walls hold back the dead up to
    // their limit (the base's defence against the horde's weight on them); the rest break in and are fought inside,
    // a break-in force of yours (breakInForce), by the numbers on both sides' people (factions.js, groupfight.js).
    const att = hordeWallPower(h), def = baseHold(state, f, h.tile);
    let held;
    if (att <= def) {
      held = true; // the walls held
      f.hitDay = f.hordeHitDay = day(state);
    } else {
      const lim = (h.size * def) / Math.max(0.01, att); // the dead the walls stop
      const through = Math.min(h.size, Math.max(Math.round(h.size * 0.3), Math.round(h.size - lim * DEFENCE.HELD_BACK)));
      const force = breakInForce(state, { tile: h.tile }, through, Math.min(2, h.bosses || 0), h);
      held = !!resolveRaidOnFaction(state, { strength: att, owner: null, horde: { count: force.count, power: force.count * force.power }, target: { factionId: f.id, tile: h.tile } }, []);
    }
    if (h.role === "attack") { h.role = "roam"; h.goal = null; }
    h.target = null;
    reduceHorde(state, h, h.size - h.size * (held ? 0.45 : 0.7));
    hordeOverrun(state, f, h.tile, att, def, !!held); // groupflight.js: overrun and no hope of holding it, they leave
    return;
  }
  if (h.role === "build") {
    const site = siteById(state, h.site);
    if (site && site.tile === h.tile) deliverToSite(state, h, site);
  }
}

// Somewhere to wander: a tile up to 4 away, kept near home for a hive's roamers and pulled toward the middle of
// the map for hordes that came in from the border.
function wanderTarget(state, h) {
  const g = state.grid, rng = state.rng;
  const home = h.hive != null ? hiveById(state, h.hive) : null;
  let opts = g.within(h.tile, 4).filter((id) => isLand(state, id));
  if (home) {
    const near = opts.filter((id) => g.distance(id, home.tile) <= 7);
    if (near.length) opts = near;
  } else if (h.role === "border") {
    const [x, y] = g.xy(h.tile);
    const cx = g.width / 2, cy = g.height / 2;
    const inward = opts.filter((id) => { const [ox, oy] = g.xy(id); return Math.hypot(ox - cx, oy - cy) <= Math.hypot(x - cx, y - cy); });
    if (inward.length && (x < 8 || y < 6 || x >= g.width - 8 || y >= g.height - 6)) opts = inward;
  }
  return opts.length ? rng.pick(opts) : h.tile;
}

export function hordesDaily(state) {
  const rng = state.rng;
  const g = state.grid;
  hivesDaily(state); // income, new hordes, build sites, border spawns, infection (hives.js)
  // Screamers in a horde call the wandering dead near it along (hivetech.js, zombietypes.js).
  const Z = ZTYPES.screamer;
  for (const h of state.hordes) {
    if (!h.mix || !(h.mix.screamer > 0) || (h.role !== "attack" && h.role !== "roam")) continue;
    for (const w of state.hordes) {
      if (w === h || w.hive != null || !WANDER.has(w.role) || g.distance(w.tile, h.tile) > Z.pull || !rng.chance(Z.pullOdds)) continue;
      w.role = h.role; w.goal = h.goal ? { ...h.goal } : null; w.target = h.role === "attack" ? h.target : h.tile;
    }
  }
  for (const h of [...state.hordes]) {
    if (!state.hordes.includes(h)) continue;
    // Wandering hordes rot away (1.2% a day, at least 1); the ones with a job are kept up by their hive.
    if (WANDER.has(h.role) && reduceHorde(state, h, Math.max(1, Math.round(h.size * 0.012)))) continue;
    if (h.lureUntil && state.hour < h.lureUntil) continue;
    switch (h.role) {
      case "guard": {
        const hv = hiveById(state, h.hive);
        if (hv) { h.target = hv.tile; continue; }
        h.role = "roam"; h.hive = null;
        break;
      }
      case "build": case "mass": {
        const site = siteById(state, h.site);
        if (site) { h.target = site.tile; continue; }
        h.role = "roam"; h.site = null;
        break;
      }
      case "attack": {
        const goal = h.goal;
        const still = goal && (goal.baseId != null ? state.bases.some((b) => b.id === goal.baseId && b.tile === goal.tile)
          : state.factions.some((f) => f.alive && f.id === goal.factionId && f.bases.includes(goal.tile)));
        if (still) { h.target = goal.tile; continue; }
        h.role = "roam"; h.goal = null;
        break;
      }
    }
    // Wanderers: a build site that needs the dead draws them in (hives.js).
    if (drawnToSite(state, h)) continue;
    // Drift toward the loudest, closest people (driftTarget), on a share of days (driftPull).
    const best = driftTarget(state, h);
    if (best && rng.chance(driftPull(state))) h.target = best.tile;
    else h.target = wanderTarget(state, h);
    // Very big wandering hordes break apart now and then.
    if (h.size > 300 && rng.chance(0.1)) splitHorde(state, h, Math.floor(h.size / 2));
  }
}

// The people a wandering horde drifts toward on the days it is pulled (hordesDaily): of the bases (yours and the
// groups') within 8 tiles, the loudest for its distance (baseHeat for yours, half the group's people for theirs); a
// base it was beaten off lately is left alone. { tile, score } or null. No dice: the threat forecast reads it too
// (sim/forecast.js).
export function driftTarget(state, h) {
  const g = state.grid;
  let best = null;
  for (const b of state.bases) {
    const dist = g.distance(h.tile, b.tile);
    if (dist > 8 || (h.shun && h.shun.tile === b.tile && state.hour < h.shun.until)) continue; // beaten off there lately (defences.js retreat)
    const score = baseHeat(state, b) / (1 + dist * 0.35);
    if (!best || score > best.score) best = { tile: b.tile, score };
  }
  for (const f of state.factions) {
    if (!f.alive) continue;
    for (const fb of f.bases) {
      const dist = g.distance(h.tile, fb);
      if (dist > 8) continue;
      const score = (f.pop * 0.5) / (1 + dist * 0.35);
      if (!best || score > best.score) best = { tile: fb, score };
    }
  }
  return best;
}
// The share of days a wandering horde turns toward driftTarget: the pull of people grows over the year, 15% of days at
// the start, 45% from about day 180 (eras.js rampDay: hardcore counts from the normal start).
export const driftPull = (state) => Math.min(0.45, 0.15 + rampDay(state) / 600);
// A horde's pace against the plain dead's (hordesHour): many runners move it a quarter faster.
export const hordePace = (h) => (h.mix && h.mix.runner >= 0.1 ? ZTYPES.runner.speed : 1);

// For the dev tools and the timelapse: the dead on the map by job.
export function hordeCounts(state) {
  const out = { hordes: state.hordes.length, zombies: 0, bosses: 0, roles: {} };
  for (const h of state.hordes) {
    out.zombies += h.size;
    out.bosses += h.bosses || 0;
    const r = h.role || "roam";
    out.roles[r] = (out.roles[r] || 0) + 1;
  }
  return out;
}
