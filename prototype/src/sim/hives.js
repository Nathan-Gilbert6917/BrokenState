// Infestation hives: where the hordes come from, and what the survivors have to destroy to win.
//
// Every hive gains resources each day, more when other hives stand within 5 tiles of it (a cluster):
// alone 1 a day, two together 3 each, three 6 each, then +2 for every further hive up to 12 (hiveIncome).
// A Normal map starts with 5–6 hives (four around the outbreak origin, one at each other hot spot: mapgen.js; other
// world sizes keep about the same hives per tile, worldsize.js), each
// with 5. A hive spends them on hordes (small 10–25 of the dead for 3, medium 50–80 for 8, large 100–200 for 15:
// hordes.js HORDE_SIZES) and, for 40, on a Wallbreaker (from day 200, then at most one every 90 days per hive):
// a hive boss that joins a horde and smashes defences when it attacks a base (defences.js). Inside every hive
// waits the Broodmother, the boss a team fights when it storms the hive.
//
// Each hive keeps a guard horde at home. Every 120–180 days a site for a new hive is picked near the current ones;
// hives within 10 tiles of it send hordes there, the rest defend: they send hordes out to roam and to attack
// bases (medium hordes only before day 60; 20% of new roamers attack at first, 40% on day 30, 65% from about day
// 70; your bases weigh 2.5× a group's and are attacked from up to 45 tiles). Hordes reaching the site gather into one mass; once the hordes delivered add up
// to a score of 30 the mass starts turning into a hive, at most 40 of the dead a day, and the hive stands when
// 1,000 have gone into it: about four weeks from the first gathering. Wandering hordes that come within 6 tiles
// of a site that still needs the dead are drawn to it. The numbers are in hiveconst.js (tools/hordecensus.js
// measures the pacing they make).
//
// A hive holds the land within 4 tiles (sites there show at least 3 danger skulls) and the ring 1 tile around it
// is red-skull ground where every encounter with the dead is much tougher (zombieToughness). It radiates infection
// over its land, and when it is destroyed the infection there fades over the following weeks. Destroying every
// hive (with no new one under way) wins the game (world.js checkGameOver). Every 5–9 days a horde of random size
// also comes in from off the map, along the border, so a state without hives is safer but never safe.
// Everything here draws from state.rng only inside the daily tick, so a seed always plays out the same.
import { log, day, addCard, snapshot, combatPower, checkGameOver, hurt } from "./world.js";
import { makeHorde, hordeScore, HORDE_SIZES, reduceHorde } from "./hordes.js";
import { partyMembers, partyTile, tileLabel, awaitOrders, wipeIfEmpty } from "./parties.js";
import { partyFuel, useFuel } from "./vehicles.js";
import { registerCombatHandler, registerBattleLayout } from "./combat.js";
import { fightNow, bossUnit, placeUnitRight } from "./defences.js";
import { HIVE, BOSS_NAMES } from "./hiveconst.js";
import { worldScale } from "./worldsize.js";
import { isPublicSite, knownLoc } from "./discovery.js";

// Bigger maps (worldsize.js): border hordes and new build sites come as often per tile of land as on a Normal map
// (days between them divided by the area), with more build sites at a time. A Normal map is untouched.
const paced = (state, days) => { const a = worldScale(state); return a === 1 ? days : Math.max(1, Math.round(days / a)); };
const siteMax = (state) => Math.max(HIVE.SITE_MAX, Math.round(HIVE.SITE_MAX * worldScale(state)));
import { hiveAllies, broodAfterAllies } from "./alliance.js";

// HIVE and BOSS_NAMES live in hiveconst.js (no imports, so any module can read them at load time).
export { HIVE, BOSS_NAMES };

// Resources a day for a hive with n hives (itself included) within CLUSTER tiles: 1, 3, 6, 8, 10, 12.
export const hiveIncome = (n) => (n <= 1 ? 1 : n <= 3 ? (n * (n + 1)) / 2 : Math.min(12, 6 + (n - 3) * 2));
// Free dead (roaming, attacking, from the border) within 10 tiles of a tile.
const FREE_MAX = 600;
const freeNear = (state, tile) => state.hordes.reduce((a, h) => a + (isFree(h) && state.grid.distance(h.tile, tile) <= 10 ? h.size : 0), 0);
// Free dead in the whole state, and how many the hives keep out at most: 1,000 plus 250 per hive.
const isFree = (h) => h.role === "roam" || h.role === "attack" || h.role === "border" || !h.role;
const freeAll = (state) => state.hordes.reduce((a, h) => a + (isFree(h) ? h.size : 0), 0);
export const freeBudget = (state) => 1000 + 250 * state.hives.length;
// Roaming / attacking hordes a hive keeps out at once.
const roamCap = (n) => 1 + Math.floor(n / 2);

const hash = (n) => { let x = (n >>> 0) ^ 0x9e3779b9; x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return (x ^ (x >>> 16)) >>> 0; };

// The hive state, made on first use from the hive tiles mapgen.js placed (no random numbers: the timelapse and
// the tools can call this at any time). t.infBase: the infection a tile settles back to without a hive near.
export function ensureHives(state) {
  if (state.hives) return state.hives;
  const h0 = hash(state.seed || 1);
  state.hives = [];
  state.hiveSites = [];
  state.hiveInfo = {
    nextSiteDay: HIVE.SITE_DAYS[0] + (h0 % (HIVE.SITE_DAYS[1] - HIVE.SITE_DAYS[0] + 1)),
    nextBorderDay: HIVE.BORDER_DAYS[0] + ((h0 >>> 8) % (HIVE.BORDER_DAYS[1] - HIVE.BORDER_DAYS[0] + 1)),
    stats: { hordes: 0, zombies: 0, bosses: 0, sites: 0, built: 0, destroyed: 0, border: 0, breakIns: 0, held: 0, repelled: 0, overrun: 0, warnings: 0 },
  };
  for (const t of state.tiles) {
    if (t.infBase == null) t.infBase = t.infection;
    if (t.hive) state.hives.push(newHive(state, t.id, HIVE.START_RES));
  }
  return state.hives;
}
export const hiveStats = (state) => (ensureHives(state), state.hiveInfo.stats);

function newHive(state, tile, res) {
  state.tiles[tile].hive = true;
  return { id: (state.hiveSeq = (state.hiveSeq || 0) + 1), tile, res, born: state.hour, income: 0, bossReady: false, bossHorde: null, name: hiveName(state, tile) };
}

// Named after a place everyone knows (discovery.js: not a hidden site, so the name gives nothing away).
export function hiveName(state, tile) {
  const t = state.tiles[tile];
  if (t.loc && isPublicSite(state, tile)) return `the hive at ${t.loc.name}`;
  let best = null, bd = 99;
  for (const id of state.grid.within(tile, 5)) {
    const loc = isPublicSite(state, id) ? state.tiles[id].loc : null, d = state.grid.distance(tile, id);
    if (loc && d < bd) { best = loc; bd = d; }
  }
  return best ? `the hive near ${best.name}` : `the hive in the wilds (${t.x},${t.y})`;
}

export const hiveById = (state, id) => (ensureHives(state), state.hives.find((h) => h.id === id) || null);
export const hiveAt = (state, tile) => (ensureHives(state), state.hives.find((h) => h.tile === tile) || null);
export const siteById = (state, id) => (ensureHives(state), state.hiveSites.find((s) => s.id === id) || null);
export const clusterSize = (state, hive) => state.hives.filter((o) => state.grid.distance(o.tile, hive.tile) <= HIVE.CLUSTER).length;
const ownedBy = (state, hive) => state.hordes.filter((h) => h.hive === hive.id);
const needsDead = (site) => site.biomass < HIVE.SITE_BIOMASS;

// ---------- the daily tick (called from hordes.js hordesDaily) ----------
export function hivesDaily(state) {
  ensureHives(state);
  const d = day(state);
  const info = state.hiveInfo;
  for (const hive of [...state.hives]) {
    const n = clusterSize(state, hive);
    hive.income = hiveIncome(n);
    hive.res = Math.min(HIVE.RES_CAP, hive.res + hive.income);
    produce(state, hive, n, d);
  }
  for (const site of [...state.hiveSites]) siteDaily(state, site);
  if (d >= info.nextSiteDay) {
    pickSite(state);
    info.nextSiteDay = d + paced(state, state.rng.int(HIVE.SITE_DAYS[0], HIVE.SITE_DAYS[1]));
  }
  if (d >= info.nextBorderDay) {
    borderSpawn(state);
    info.nextBorderDay = d + paced(state, state.rng.int(HIVE.BORDER_DAYS[0], HIVE.BORDER_DAYS[1]));
  }
  radiate(state);
}

function buy(state, hive, kind, o) {
  const k = HORDE_SIZES[kind];
  if (hive.res < k.cost) return null;
  hive.res -= k.cost;
  const size = state.rng.int(k.min, k.max);
  const stats = state.hiveInfo.stats;
  stats.hordes++;
  stats.zombies += size;
  return makeHorde(state, { size, hive: hive.id, ...o });
}
const biggest = (res) => (res >= HORDE_SIZES.large.cost ? "large" : res >= HORDE_SIZES.medium.cost ? "medium" : "small");
// Hordes leave from the edge of the hive, so they do not merge with its guard on the way out.
function outside(state, hive) {
  const opts = state.grid.neighbors(hive.tile).filter((id) => state.tiles[id].terrain !== "water" || state.tiles[id].bridge);
  return opts.length ? state.rng.pick(opts) : hive.tile;
}

function produce(state, hive, n, d) {
  const rng = state.rng;
  const owned = ownedBy(state, hive);
  // 1. Defend the hive: a guard horde at home.
  const guard = owned.find((h) => h.role === "guard");
  if (!guard || guard.size < HIVE.GUARD_MIN) buy(state, hive, hive.res >= HORDE_SIZES.medium.cost ? "medium" : "small", { tile: hive.tile, role: "guard", target: hive.tile });
  // 2. Support a new hive within reach.
  const site = supportSite(state, hive);
  if (site) {
    // Up to 2 hordes on the way from each hive, until what is gathered and on its way covers what is missing.
    let builders = owned.filter((h) => h.role === "build" && h.site === site.id).length;
    let coming = incoming(state, site);
    while (builders < 2 && hive.res >= HORDE_SIZES.small.cost && site.biomass + coming < HIVE.SITE_BIOMASS * 1.1) {
      const h = buy(state, hive, biggest(hive.res), { tile: outside(state, hive), role: "build", site: site.id, target: site.tile });
      builders++;
      coming += h ? h.size : 0;
    }
  } else {
    // 3. Too far from any build site: a defender. It sends hordes out to roam, and now and then at a base.
    // Not while the land around is already crawling with free dead (over 600 within 10 tiles), nor while the
    // whole state holds more free dead than the hives can drive (FREE_BUDGET).
    const out = owned.filter((h) => h.role === "roam" || h.role === "attack");
    if (out.length < roamCap(n) && hive.res >= HORDE_SIZES.medium.cost && !(hive.res < BOSS_SAVE && hive.saving) && freeNear(state, hive.tile) < FREE_MAX && freeAll(state) < freeBudget(state)) {
      // Large ones only from LARGE_DAY: the first hordes at your gates are ones the starting walls can hold.
      const h = buy(state, hive, rng.chance(0.55) && d >= HIVE.LARGE_DAY ? biggest(hive.res) : "medium", { tile: outside(state, hive), role: "roam" });
      // Attacks grow more likely over the first two months: 20% of new hordes at the start, 65% from about day 70 (HIVE.ATTACK_*).
      if (h && (hive.bossReady || rng.chance(Math.min(HIVE.ATTACK_MAX, HIVE.ATTACK_START + d / HIVE.ATTACK_RAMP)))) sendAttack(state, hive, h);
    }
  }
  // 4. A Wallbreaker for 40, once there is something to break (one at a time per hive, BOSS_GAP days apart).
  const bossOut = hive.bossHorde != null && state.hordes.some((h) => h.id === hive.bossHorde && h.bosses > 0);
  if (!bossOut) hive.bossHorde = null;
  const due = Math.max(HIVE.BOSS_DAY, (hive.bossDay ?? -Infinity) + HIVE.BOSS_GAP);
  hive.saving = !hive.bossReady && !bossOut && d >= due - 10;
  if (!hive.bossReady && !bossOut && d >= due && hive.res >= HIVE.BOSS_COST) {
    hive.res -= HIVE.BOSS_COST;
    hive.bossReady = true;
    hive.bossDay = d;
    state.hiveInfo.stats.bosses++;
  }
  // A Wallbreaker waiting at home leads the next horde the hive sends out (roamers count against the cap, so a
  // hive at its cap builds one more horde for it).
  if (hive.bossReady && !site && hive.res >= HORDE_SIZES.medium.cost && attackTarget(state, hive)) {
    const h = buy(state, hive, biggest(hive.res), { tile: outside(state, hive), role: "roam" });
    if (h) sendAttack(state, hive, h);
  }
}
const BOSS_SAVE = 48; // a Wallbreaker plus a medium horde

// The base a hive's horde goes for: yours by your numbers and distance, or a group's by its size. null: none in reach.
function attackTarget(state, hive) {
  const g = state.grid;
  const cands = [];
  for (const b of state.bases) {
    const dist = g.distance(hive.tile, b.tile);
    if (dist > HIVE.ATTACK_RANGE) continue;
    const people = state.survivors.filter((s) => s.alive && s.location.kind === "base" && s.location.baseId === b.id).length;
    cands.push({ tile: b.tile, baseId: b.id, w: (HIVE.PLAYER_PULL * (people * 0.5 + 3 + (b.type === "hub" ? 3 : 0))) / (1 + dist / 6) });
  }
  for (const f of state.factions) {
    if (!f.alive) continue;
    for (const fb of f.bases) {
      const dist = g.distance(hive.tile, fb);
      if (dist > 22) continue;
      cands.push({ tile: fb, factionId: f.id, w: (f.pop * 0.3 + 2) / (1 + dist / 6) });
    }
  }
  return cands.length ? state.rng.weighted(cands, (x) => x.w) : null;
}

function sendAttack(state, hive, h) {
  const c = attackTarget(state, hive);
  if (!c) return false;
  h.role = "attack";
  h.goal = { tile: c.tile, baseId: c.baseId ?? null, factionId: c.factionId ?? null };
  h.target = c.tile;
  if (hive.bossReady) {
    hive.bossReady = false;
    h.bosses = (h.bosses || 0) + 1;
    hive.bossHorde = h.id;
  }
  return true;
}

// The dead gathered at a site or on their way to it.
const incoming = (state, site) => state.hordes.filter((h) => (h.role === "build" || h.role === "mass") && h.site === site.id).reduce((a, h) => a + h.size, 0);

// The nearest build site within SUPPORT tiles that still needs the dead.
function supportSite(state, hive) {
  let best = null, bd = Infinity;
  for (const s of state.hiveSites) {
    const d = state.grid.distance(s.tile, hive.tile);
    if (d <= HIVE.SUPPORT && needsDead(s) && d < bd && !(s.noPath && s.noPath.includes(hive.id))) { best = s; bd = d; }
  }
  return best;
}

// ---------- build sites ----------
function pickSite(state) {
  const g = state.grid, rng = state.rng;
  if (!state.hives.length || state.hiveSites.length >= siteMax(state)) return null;
  const people = [...state.bases.map((b) => b.tile), ...state.factions.filter((f) => f.alive).flatMap((f) => f.bases)];
  const cands = [];
  for (const t of state.tiles) {
    if (t.terrain === "water" || t.terrain === "mountain" || t.hive || t.loc) continue; // open ground, like the first hives
    let nearest = Infinity, supporters = 0;
    for (const hv of state.hives) {
      const d = g.distance(hv.tile, t.id);
      nearest = Math.min(nearest, d);
      if (d <= HIVE.SUPPORT) supporters++;
    }
    if (nearest < 4 || nearest > 9) continue;
    if (people.some((p) => g.distance(p, t.id) <= 3)) continue;
    if (state.hiveSites.some((s) => g.distance(s.tile, t.id) <= 4)) continue;
    cands.push({ t, w: supporters ** 1.5 * (0.4 + t.infection) });
  }
  if (!cands.length) return null;
  const pick = rng.weighted(cands, (c) => c.w).t;
  const site = { id: (state.hiveSeq = (state.hiveSeq || 0) + 1), tile: pick.id, chosen: state.hour, score: 0, biomass: 0, started: null };
  state.hiveSites.push(site);
  state.hiveInfo.stats.sites++;
  if (state.live.has(pick.id)) log(state, `The dead are gathering ${placeOf(state, pick.id)}. Something is being built there.`, "danger");
  return site;
}

const placeOf = (state, tile) => (knownLoc(state, tile) ? `at ${state.tiles[tile].loc.name}` : `near ${tileLabel(state, tile)}`);

// A horde that reaches its build site joins the mass gathered there (hordes.js merges them).
export function deliverToSite(state, h, site) {
  site.score = Math.round((site.score + hordeScore(h.size)) * 10) / 10;
  h.role = "mass";
  h.site = site.id;
  h.target = site.tile;
}

// A wandering horde within DRAW tiles of a site that needs the dead turns toward it (half the days it is near).
export function drawnToSite(state, h) {
  ensureHives(state);
  for (const s of state.hiveSites) {
    if (!needsDead(s) || state.grid.distance(s.tile, h.tile) > HIVE.DRAW) continue;
    if (s.biomass + incoming(state, s) >= HIVE.SITE_BIOMASS * 1.1) continue; // enough of the dead already on the way
    if (!state.rng.chance(0.5)) return false;
    h.role = "build";
    h.site = s.id;
    h.target = s.tile;
    return true;
  }
  return false;
}

function siteDaily(state, site) {
  const masses = state.hordes.filter((h) => h.role === "mass" && h.site === site.id);
  const mass = masses[0] || null;
  if (site.started == null && site.score >= HIVE.SITE_SCORE) {
    site.started = state.hour;
    if (state.live.has(site.tile)) log(state, `The gathered dead ${placeOf(state, site.tile)} have started to build a hive.`, "danger");
  }
  if (site.started != null && masses.length) {
    // A quarter of the gathered mass (at least 25, at most SITE_INTAKE) a day goes into the growing hive.
    const total = masses.reduce((a, h) => a + h.size, 0);
    let take = Math.min(total, Math.max(25, Math.round(total * 0.25)), HIVE.SITE_INTAKE, HIVE.SITE_BIOMASS - site.biomass);
    for (const m of masses) {
      if (take <= 0) break;
      const t = m.size - Math.min(m.size, take) < 5 ? m.size : Math.min(m.size, take);
      site.biomass += t;
      take -= t;
      reduceHorde(state, m, t);
    }
  }
  if (site.biomass >= HIVE.SITE_BIOMASS) return completeSite(state, site);
  // Nobody left to build it and nothing gathered: the site is given up after 90 days.
  const supported = state.hives.some((hv) => state.grid.distance(hv.tile, site.tile) <= HIVE.SUPPORT);
  if (!supported && !mass && state.hour - site.chosen > 90 * 24) state.hiveSites.splice(state.hiveSites.indexOf(site), 1);
}

function completeSite(state, site) {
  state.hiveSites.splice(state.hiveSites.indexOf(site), 1);
  if (state.tiles[site.tile].hive) return null;
  const hive = newHive(state, site.tile, 0);
  state.hives.push(hive);
  state.hiveInfo.stats.built++;
  // What was left of the mass: up to 150 stay as the new hive's guard, the rest wander off from it.
  let kept = 0;
  for (const h of state.hordes) {
    if (h.role !== "mass" || h.site !== site.id) continue;
    h.hive = hive.id; h.site = null; h.target = site.tile;
    if (kept < 150) { h.role = "guard"; kept += h.size; } else h.role = "roam";
  }
  for (const h of state.hordes) if (h.role === "build" && h.site === site.id) { h.role = "roam"; h.site = null; }
  if (state.live.has(site.tile)) log(state, `A new hive has risen ${placeOf(state, site.tile)}.`, "death");
  return hive;
}

// ---------- off-map hordes along the border ----------
// Land tiles on the map's edge at least `keep` + 1 tiles from your bases: where border hordes (and outsiders,
// visitors.js) come in.
export function borderTiles(state, keep = 6) {
  const g = state.grid;
  return state.tiles.filter((t) => (t.x === 0 || t.y === 0 || t.x === g.width - 1 || t.y === g.height - 1) && t.terrain !== "water" &&
    !state.bases.some((b) => g.distance(b.tile, t.id) <= keep));
}
function borderSpawn(state) {
  const rng = state.rng;
  const edge = borderTiles(state, 6);
  if (!edge.length) return null;
  const t = rng.pick(edge);
  const r = rng.next();
  const kind = r < 0.5 ? "small" : r < 0.85 ? "medium" : "large";
  const k = HORDE_SIZES[kind];
  const grow = 1 + Math.min(0.5, day(state) / 730); // a little bigger as the year goes on
  const h = makeHorde(state, { tile: t.id, size: Math.round(rng.int(k.min, k.max) * grow), role: "border" });
  state.hiveInfo.stats.border++;
  return h;
}

// ---------- infection ----------
// Each hive radiates infection: 1 on its tile, 0.1 less per tile out to RADIATE (0.6 at the edge of its land).
// Every tile moves toward the higher of that and its own base level: up by 0.02 a day, down by 0.01.
function radiate(state) {
  const g = state.grid;
  const rad = new Float32Array(state.tiles.length);
  for (const hv of state.hives) {
    for (const id of g.within(hv.tile, HIVE.RADIATE)) {
      const v = 1 - g.distance(hv.tile, id) * 0.1;
      if (v > rad[id]) rad[id] = v;
    }
  }
  for (const t of state.tiles) {
    const target = Math.max(t.infBase ?? t.infection, rad[t.id]);
    if (t.infection < target) t.infection = Math.min(target, t.infection + 0.02);
    else if (t.infection > target) t.infection = Math.max(target, t.infection - 0.01);
  }
}

// ---------- territory, danger and toughness ----------
// Distance to the nearest hive (Infinity with none). hives: a list of tile ids (what the player knows, for the map)
// or nothing (the real hives).
export function hiveDistance(state, tileId, hiveTiles = null) {
  const list = hiveTiles || (ensureHives(state), state.hives.map((h) => h.tile));
  let best = Infinity;
  for (const t of list) best = Math.min(best, state.grid.distance(t, tileId));
  return best;
}
// Danger a site shows on the map: at least 3 skulls inside a hive's land; red skulls in the ring around it.
export function hiveDanger(state, tileId, hiveTiles = null) {
  const d = hiveDistance(state, tileId, hiveTiles);
  return { territory: d <= HIVE.TERRITORY, red: d <= HIVE.RING, dist: d };
}
// Extra power for every one of the dead met on this tile: +3 on red-skull ground, +1 elsewhere in a hive's land.
export function zombieToughness(state, tileId) {
  if (!state.hives) return 0;
  const d = hiveDistance(state, tileId);
  return d <= HIVE.RING ? 3 : d <= HIVE.TERRITORY ? 1 : 0;
}

// For the dev panel and the tools.
export function hiveTracker(state) {
  ensureHives(state);
  const site = state.hiveSites.map((s) => ({ tile: s.tile, name: tileLabel(state, s.tile), score: s.score, biomass: s.biomass, started: s.started != null,
    mass: state.hordes.filter((h) => h.role === "mass" && h.site === s.id).reduce((a, h) => a + h.size, 0) }));
  return {
    hives: state.hives.length, res: state.hives.reduce((a, h) => a + h.res, 0), income: state.hives.reduce((a, h) => a + (h.income || 0), 0),
    bossesReady: state.hives.filter((h) => h.bossReady).length, sites: site, nextSiteDay: state.hiveInfo.nextSiteDay, nextBorderDay: state.hiveInfo.nextBorderDay,
    stats: { ...state.hiveInfo.stats },
  };
}

// ---------- destroying a hive ----------
// The infection it radiated fades: the land within 7 tiles settles toward a low level (0.06 at the hive, +0.07 a
// tile), 0.01 a day. Its guard is gone; its other hordes wander on without a home.
export function destroyHive(state, hive, how = "") {
  ensureHives(state);
  const i = state.hives.indexOf(hive);
  if (i < 0) return false;
  state.hives.splice(i, 1);
  state.tiles[hive.tile].hive = false;
  for (const id of state.grid.within(hive.tile, 7)) {
    const t = state.tiles[id];
    t.infBase = Math.min(t.infBase ?? t.infection, 0.06 + 0.07 * state.grid.distance(hive.tile, id));
  }
  for (const h of [...state.hordes]) {
    if (h.hive !== hive.id) continue;
    if (h.role === "guard") state.hordes.splice(state.hordes.indexOf(h), 1);
    else { h.hive = null; if (h.role !== "attack") h.role = "roam"; }
  }
  state.hiveInfo.stats.destroyed++;
  const left = state.hives.length;
  log(state, `${hive.name[0].toUpperCase() + hive.name.slice(1)} was destroyed${how ? ` ${how}` : ""}. ${left ? `${left} hive${left === 1 ? "" : "s"} still stand${left === 1 ? "s" : ""} in the state.` : "No hive is left standing."}`, "good");
  checkGameOver(state); // destroying the last hive wins (world.js)
  return true;
}

// Is every hive gone, with no new one being built? (world.js checkGameOver: the survivors win.)
export function hivesSecured(state) {
  return !!state.hives && !state.hives.length && !(state.hiveSites || []).some((s) => s.started != null);
}

// ---------- the Destroy hive mission (parties.js arrive) ----------
const guardOf = (state, hive) => state.hordes.find((h) => h.role === "guard" && h.hive === hive.id) || null;

// The fight inside a hive: the guard's dead (tougher on red-skull ground) and the Broodmother.
export function hiveForce(state, hive) {
  const guard = guardOf(state, hive);
  return broodForce(guard ? guard.size : 0);
}
// The brood a hive with a guard of this size fields (also the autopilot's estimate from a guard it has seen).
// It fights on red-skull ground: power 1 + 3 (zombieToughness), plus a little for a big guard.
export function broodForce(guardSize) {
  const s = guardSize ? hordeScore(guardSize) : 0;
  return { count: Math.max(10, Math.min(18, Math.round(8 + s * 0.6))), power: Math.round((5 + s / 30) * 10) / 10, guard: guardSize || 0 };
}

export function hiveArrive(state, p) {
  const tile = p.dest;
  const hive = hiveAt(state, tile);
  if (!hive) {
    p.seen.set(tile, snapshot(state, tile));
    awaitOrders(state, p, "There is no hive here any more.", { failed: true });
    return "";
  }
  p.seen.set(tile, snapshot(state, tile));
  p.phase = "engaged";
  addCard(state, hiveCard(state, p, hive));
  return "";
}

function hiveCard(state, p, hive) {
  const force = hiveForce(state, hive);
  const power = Math.round(partyMembers(state, p).reduce((a, m) => a + combatPower(m), 0));
  const gone = (st) => !st.hives.includes(hive);
  const moved = (st) => { awaitOrders(st, p, "The hive is already gone.", { failed: true }); return "Nothing is left to fight."; };
  return {
    title: `The hive: ${hive.name}`,
    where: tileLabel(state, hive.tile),
    partyId: p.id,
    text: `A mound of fused bodies, pulsing and warm, and the dead packed around it${force.guard ? ` (about ${force.guard})` : ""}. Deep inside waits the ${BOSS_NAMES.hive}. ` +
      `Your squad's combat power is ${power}. Storming it means fighting about ${force.count} of the hive's brood, tougher than any dead outside, and the ${BOSS_NAMES.hive} herself. Bring five or six well-armed fighters, armor and meds.` +
      alliesText(state, hive, force.count), // alliance.js: fighters from coalition members and job givers
    choices: [
      {
        label: "Storm the hive (tactical battle)",
        hint: `About ${force.count} of the brood and the ${BOSS_NAMES.hive}. Win and the hive is destroyed; you can fall back from the left edge, or sound the retreat to pull everyone out at once`,
        resolve: (st) => {
          if (gone(st)) return moved(st);
          assaultHive(st, p, hive);
          return "";
        },
      },
      {
        label: "Set fires around it (6 fuel)",
        hint: "Burns away part of its guard and its stores; the team pulls back after. Stealth decides whether the brood notices",
        get disabled() { return partyFuel(state, p) < 6; },
        resolve: (st) => {
          if (gone(st)) return moved(st);
          if (partyFuel(st, p) < 6) { awaitOrders(st, p, "Not enough fuel for the fires.", { failed: true }); return "The team has less than 6 fuel."; }
          useFuel(st, p, 6);
          const guard = guardOf(st, hive);
          if (guard) reduceHorde(st, guard, Math.round(guard.size * 0.3));
          hive.res = Math.max(0, hive.res - 15);
          const best = Math.max(0, ...partyMembers(st, p).map((m) => m.skills.stealth || 0));
          let text = "The fires take hold. Part of the brood burns and the hive's stores with it.";
          if (!st.rng.chance(Math.min(0.9, 0.35 + best * 0.05))) {
            const m = partyMembers(st, p);
            const v = st.rng.pick(m);
            if (v) { hurt(st, v, st.rng.int(15, 40), hive.tile, "setting fire to a hive"); text += v.alive ? ` The brood noticed: ${v.name.split(" ")[0]} was hurt getting away.` : ` The brood noticed: ${v.name} was killed getting away.`; }
          }
          if (!wipeIfEmpty(st, p)) awaitOrders(st, p, text);
          return text;
        },
      },
      {
        // Molotovs (data.js, throwables.js) thrown from cover: more of it burns, and from farther away.
        label: `Firebomb it (${FIREBOMB.molotovs} Molotovs)`,
        hint: `Burns more of its guard and stores than the fuel fires, thrown from a distance (the brood is less likely to notice). The team carries ${molotovsOf(state, p).length}`,
        get disabled() { return molotovsOf(state, p).length < FIREBOMB.molotovs; },
        resolve: (st) => {
          if (gone(st)) return moved(st);
          const bombs = molotovsOf(st, p);
          if (bombs.length < FIREBOMB.molotovs) { awaitOrders(st, p, "Not enough Molotovs.", { failed: true }); return `The team has fewer than ${FIREBOMB.molotovs} Molotovs.`; }
          for (const b of bombs.slice(0, FIREBOMB.molotovs)) b.take();
          const guard = guardOf(st, hive);
          if (guard) reduceHorde(st, guard, Math.round(guard.size * FIREBOMB.guard));
          hive.res = Math.max(0, hive.res - FIREBOMB.res);
          const best = Math.max(0, ...partyMembers(st, p).map((m) => m.skills.stealth || 0));
          let text = "Bottles arc into the mound and burst. The flesh crackles; part of the brood burns and the hive's stores with it.";
          if (!st.rng.chance(Math.min(0.95, 0.5 + best * 0.05))) {
            const v = st.rng.pick(partyMembers(st, p));
            if (v) { hurt(st, v, st.rng.int(10, 30), hive.tile, "firebombing a hive"); text += v.alive ? ` The brood came boiling out: ${v.name.split(" ")[0]} was hurt getting away.` : ` The brood came boiling out: ${v.name} was killed getting away.`; }
          }
          if (!wipeIfEmpty(st, p)) awaitOrders(st, p, text);
          return text;
        },
      },
      { label: "Back off", hint: "No fight", resolve: (st) => { awaitOrders(st, p, "The team pulled back from the hive."); return "The team pulls back."; } },
    ],
  };
}

// Firebombing a hive: Molotovs instead of 6 fuel, a bigger fire (40% of its guard, 20 stores) from farther away.
export const FIREBOMB = { molotovs: 3, guard: 0.4, res: 20 };
// The Molotovs a team has: on its people (pockets, hands, packs) and in its cargo. [{ item, take() }]
function molotovsOf(state, p) {
  const out = [];
  for (const s of partyMembers(state, p)) {
    (s.pockets || []).forEach((it, i) => { if (it && it.key === "molotov") out.push({ item: it, take: () => { s.pockets[i] = null; } }); });
    const pk = s.gear && s.gear.backpack && s.gear.backpack.contents;
    (pk || []).forEach((it, i) => { if (it && it.key === "molotov") out.push({ item: it, take: () => { pk[i] = null; } }); });
  }
  const cargo = (p.cargo && p.cargo.gear) || [];
  for (const it of cargo) if (it && it.key === "molotov") out.push({ item: it, take: () => { const i = cargo.indexOf(it); if (i >= 0) cargo.splice(i, 1); } });
  return out;
}

// Allied fighters at the mound (alliance.js hiveAllies): each keeps one of the brood off your squad.
function alliesText(state, hive, count) {
  const a = hiveAllies(state, hive);
  return a.fighters ? ` Fighters from ${a.names.join(", ")} will storm it with you: about ${count - broodAfterAllies(count, a.fighters)} of the brood fewer reach your squad.` : "";
}

export function assaultHive(state, p, hive) {
  const force = hiveForce(state, hive);
  const allies = hiveAllies(state, hive);
  const count = broodAfterAllies(force.count, allies.fighters);
  if (allies.fighters) log(state, `Fighters from ${allies.names.join(", ")} storm ${hive.name} beside your squad.`, "good");
  return fightNow(state, {
    tile: hive.tile, partyId: p.id,
    enemy: { kind: "zombies", count, power: force.power, name: `the brood of ${hive.name}` },
    ambush: null, canRetreat: true, handler: "hiveAssault", layout: "hive",
    context: { hiveId: hive.id, partyId: p.id },
  });
}

registerBattleLayout("hive", (b, ctx) => {
  if (ctx.phase === "map") {
    // The hive itself: a mound of flesh on the right, with gaps the brood comes through.
    const cx = ctx.W - 3, cy = Math.floor(ctx.H / 2);
    for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 1; x <= cx + 1; x++) {
      if (Math.abs(y - cy) === 1 && x === cx - 1) continue; // openings
      if (Math.abs(x - cx) + Math.abs(y - cy) <= 3 && ctx.inside(x, y)) ctx.put(x, y, "hivewall");
    }
    for (let i = 0; i < 4; i++) { const x = ctx.rng.int(8, ctx.W - 6), y = ctx.rng.int(0, ctx.H - 1); if (ctx.free(x, y)) ctx.put(x, y, "hivewall"); }
    return;
  }
  // Units: the Broodmother deep in the hive.
  const boss = bossUnit(b, "broodmother");
  if (placeUnitRight(b, ctx, boss, ctx.W - 5)) b.units.push(boss);
});

registerCombatHandler("hiveAssault", (state, result, setup) => {
  const c = setup.context;
  const hive = hiveById(state, c.hiveId);
  const p = state.parties.find((x) => x.id === c.partyId);
  const guard = hive ? guardOf(state, hive) : null;
  if (guard && result.enemiesKilled) reduceHorde(state, guard, Math.round((guard.size * result.enemiesKilled) / Math.max(1, setup.enemy.count + 1)));
  let text;
  if (result.outcome === "victory" && hive) {
    destroyHive(state, hive, "by your team");
    text = `The ${BOSS_NAMES.hive} is dead and the hive burns. The infection around it will fade over the coming weeks.`;
    if (p && state.parties.includes(p)) p.seen.set(hive.tile, snapshot(state, hive.tile));
  } else if (result.outcome === "retreat") text = "The team fell back from the hive. The brood is still there.";
  else text = "The hive's brood drove the team off.";
  if (!p || !state.parties.includes(p)) return;
  if (wipeIfEmpty(state, p)) { log(state, "The whole team was lost storming a hive.", "death"); return; }
  if (result.outcome !== "victory") log(state, `${text} (${tileLabel(state, partyTile(p))})`, "danger");
  awaitOrders(state, p, text);
});
