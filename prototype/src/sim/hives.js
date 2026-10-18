// @ts-check
// Infestation hives: where the hordes come from, and what the survivors have to destroy to win.
//
// Every hive gains resources each day, more when other hives stand within 5 tiles of it (a cluster):
// alone 1 a day, two together 3 each, three 6 each, then +2 for every further hive up to 12 (hiveIncome).
// A Normal map starts with 5–6 hives (four around the outbreak origin, one at each other hot spot: mapgen.js; other
// world sizes keep about the same hives per tile, worldsize.js), each
// with 5. A hive spends them on hordes (small 10–25 of the dead for 3, medium 50–80 for 8, large 100–200 for 15:
// hordes.js HORDE_SIZES) and, for 40, on a Wallbreaker (only with a Wallbreaker den grown, from day 200, then at
// most one every 90 days per hive): a hive boss that joins a horde and smashes defences when it attacks a base
// (defences.js). Inside every hive is a den of chambers (hivecrawl.js): a team crawls it from the mouth to the core room,
// where the Broodmother guards the Hivemind; killing the Hivemind destroys the hive.
// Hives also spend on growths around them (hivetech.js, the tech tree): more income, a bigger guard, and the
// special dead their hordes carry (runners, brutes, spitters, screamers, crawlers: zombietypes.js).
//
// Each hive keeps a guard horde at home. Now and then a site for a new hive is picked near the current ones (a curve:
// about a year to the first, then every 4–5 months, at most HIVE.NEW_CAP new hives in three years on a big map:
// newHiveCap / siteDue); hives within 10 tiles of it send hordes there, the rest defend: they send hordes out to roam and to attack
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
import { partyMembers, partyTile, tileLabel, awaitOrders } from "./parties.js";
import { registerBattleLayout, registerBattleSize, HIVE_W, HIVE_H } from "./combat.js";
import { bossUnit, placeUnitRight } from "./defences.js";
import { startHiveCrawl, denOf, crawlEstimate, crawlRecText, mouthsOf, mouthSide, mouthNote } from "./hivecrawl.js"; // the hive crawl: from one of its four mouths to the Hivemind in the core
export { assaultHive } from "./hivecrawl.js"; // the core fight (the old storm's entry point: the tools call it)
import { HIVE, BOSS_NAMES, GROWTHS, ZTYPES } from "./hiveconst.js";
import { broodGrowth, hiveCap, hordePaceOpen, noteHorde, rampDay, hiveStarve } from "./eras.js";
import { worldScale } from "./worldsize.js";
import { findPath } from "./hex.js";
import { isPublicSite, knownLoc } from "./discovery.js";
import { clearPois } from "./pois.js"; // a hive tile holds no points of interest: gone when it rises, still gone when it falls
import {
  growthIncome, growthStep, growthsDaily, guardMin, extraOut, attackRange, canRaiseBoss, hiveMix, borderMix, markThreat, witherGrowths, assaultTypes, hiveMods,
  savingFor, growthsOf, growthCounts,
} from "./hivetech.js"; // the hives' tech tree: growths around a hive and the special dead they breed

// Bigger maps (worldsize.js): border hordes come as often per tile of land as on a Normal map (days between them
// divided by the area), with more build sites at a time. A Normal map is untouched. New build sites are not paced
// by the land: a bigger map gets a bigger cap on new hives (newHiveCap) and the same curve.
const paced = (state, days) => { const a = worldScale(state); return a === 1 ? days : Math.max(1, Math.round(days / a)); };
const siteMax = (state) => Math.max(HIVE.SITE_MAX, Math.round(HIVE.SITE_MAX * worldScale(state)));

// ---------- the pace of new hives (HIVE.NEW_*, SITE_*) ----------
// How many new hives the hives may found in a span of NEW_SPAN days: NEW_CAP[0]–NEW_CAP[1] by the dice (the seed) on a
// Large or Huge map, fewer on a smaller one by its land against a Large map's, never under NEW_MIN.
export function newHiveCap(state) {
  const [lo, hi] = HIVE.NEW_CAP;
  const pick = lo + (hash((state.seed || 1) ^ 0x5151) % (hi - lo + 1));
  return Math.max(HIVE.NEW_MIN, Math.round(pick * Math.min(1, worldScale(state) / HIVE.NEW_SCALE)));
}
// New hives so far: the ones the hives' own sites grew (stats.grown; older saves: every hive built) plus the sites
// under way (hardcore-outbreak.js's first-year sites are the normal start's hives coming back, not growth).
export function newHiveCount(state) {
  ensureHives(state);
  const stats = state.hiveInfo.stats;
  return (stats.grown ?? stats.built) + state.hiveSites.filter((s) => !s.hardcore).length;
}
// The ramp day (eras.js rampDay: hardcore counts from the normal start) the n-th new hive's site is due: the n-th site
// of its span falls NEW_SPAN × (its number in the span / cap) ^ SITE_CURVE days into it, each gap ± SITE_JITTER by
// the dice (the jitter is on the gaps, so the days stay in order). Slow at first (the first site about a year in),
// then faster; never more than the cap's worth of sites in a span.
export function siteDue(state, n) {
  const cap = newHiveCap(state), seed = state.seed || 1;
  const at = (i) => { const k = Math.floor((i - 1) / cap); return HIVE.NEW_SPAN * (k + ((i - k * cap) / cap) ** HIVE.SITE_CURVE); };
  let d = 0;
  for (let i = 1; i <= n; i++) d += (at(i) - at(i - 1)) * (1 + HIVE.SITE_JITTER * ((hash(seed * 31 + i) % 2001) / 1000 - 1));
  return Math.round(d);
}
import { hiveAllies, broodAfterAllies } from "./alliance.js";
import { overwriteClaims } from "./claims.js"; // claims.js: a hive risen wipes the claims around it (agent A's hook)

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
    nextSiteDay: siteDue(state, 1), // the first new hive's site, about a year in (the curve above; checked again then)
    nextBorderDay: HIVE.BORDER_DAYS[0] + ((h0 >>> 8) % (HIVE.BORDER_DAYS[1] - HIVE.BORDER_DAYS[0] + 1)),
    // grown: new hives from the hives' own sites (the cap counts these); groupStorms / groupKills: the AI groups' war
    // parties against the hives and the hives they destroyed (factions.js groupHiveWar).
    stats: { hordes: 0, zombies: 0, bosses: 0, sites: 0, built: 0, grown: 0, destroyed: 0, border: 0, breakIns: 0, held: 0, repelled: 0, overrun: 0, warnings: 0, groupStorms: 0, groupKills: 0 },
  };
  for (const t of state.tiles) {
    if (t.infBase == null) t.infBase = t.infection;
    if (t.hive) state.hives.push(newHive(state, t.id, HIVE.START_RES));
  }
  return state.hives;
}
export const hiveStats = (state) => (ensureHives(state), state.hiveInfo.stats);

export function newHive(state, tile, res) {
  state.tiles[tile].hive = true;
  clearPois(state.tiles[tile]); // pois.js: the hive replaces the tile's points of interest
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
// A gathering your team broke up (hivebirth.js breakGathering): the hives do not feed it until brokenUntil.
export const siteResting = (state, site) => site.brokenUntil != null && state.hour < site.brokenUntil;

// ---------- the daily tick (called from hordes.js hordesDaily) ----------
export function hivesDaily(state) {
  ensureHives(state);
  const d = day(state);
  const rd = rampDay(state); // the day the ramps below count by (eras.js: hardcore counts from the normal start)
  const info = state.hiveInfo;
  for (const hive of [...state.hives]) {
    const n = clusterSize(state, hive);
    hive.income = Math.round(growthIncome(state, hive, hiveIncome(n)) * hiveStarve(state) * 10) / 10; // biomass pits, feeding grounds (hivetech.js); the outbreak burned out: starving (eras.js)
    hive.res = Math.min(HIVE.RES_CAP, hive.res + hive.income);
    growthStep(state, hive); // its guard first, then a growth it wants (or saves for)
    produce(state, hive, n, rd);
  }
  growthsDaily(state); // growths finishing, regrowing, rotting at dead hives; a screamer spire calling the dead
  for (const site of [...state.hiveSites]) siteDaily(state, site);
  if (d >= info.nextSiteDay) {
    // The next new hive's site is due by the curve (siteDue); picked, the next one is looked at SITE_GAP days on
    // (its own due day is usually later). Not due yet: wait for its day.
    const due = d + Math.max(0, siteDue(state, newHiveCount(state) + 1) - rd);
    if (d >= due) { pickSite(state); info.nextSiteDay = d + HIVE.SITE_GAP; }
    else info.nextSiteDay = due;
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
  const { mix, elite } = hiveMix(state, hive, o.role === "guard" ? "guard" : kind); // the special dead its growths breed, by the horde's size (hivetech.js)
  return makeHorde(state, { size, hive: hive.id, mix, elite, ...o });
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
  if (!guard || guard.size < guardMin(state, hive)) buy(state, hive, hive.res >= HORDE_SIZES.medium.cost ? "medium" : "small", { tile: hive.tile, role: "guard", target: hive.tile });
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
    // A brood chamber lets one more out; a growth being saved for keeps new ones home (hivetech.js).
    if (out.length < roamCap(n) + extraOut(state, hive) && hive.res >= HORDE_SIZES.medium.cost && !(hive.res < BOSS_SAVE && hive.saving) && !(hive.res < savingFor(state, hive)) && freeNear(state, hive.tile) < FREE_MAX && freeAll(state) < freeBudget(state)) {
      // Large ones only from LARGE_DAY: the first hordes at your gates are ones the starting walls can hold.
      const h = buy(state, hive, rng.chance(0.55) && d >= HIVE.LARGE_DAY ? biggest(hive.res) : "medium", { tile: outside(state, hive), role: "roam" });
      // Attacks grow more likely over the first two months: 20% of new hordes at the start, 65% from about day 70 (HIVE.ATTACK_*).
      if (h && (hive.bossReady || rng.chance(Math.min(HIVE.ATTACK_MAX, HIVE.ATTACK_START + d / HIVE.ATTACK_RAMP)))) sendAttack(state, hive, h);
    }
  }
  // 4. A Wallbreaker for 40, once there is something to break (one at a time per hive, BOSS_GAP days apart), and
  // only from a hive with a Wallbreaker den (hivetech.js, HIVE.BOSS_DEN).
  const bossOut = hive.bossHorde != null && state.hordes.some((h) => h.id === hive.bossHorde && h.bosses > 0);
  if (!bossOut) hive.bossHorde = null;
  const due = Math.max(HIVE.BOSS_DAY, (hive.bossDay ?? -Infinity) + HIVE.BOSS_GAP);
  const den = canRaiseBoss(state, hive);
  hive.saving = den && !hive.bossReady && !bossOut && d >= due - 10;
  if (den && !hive.bossReady && !bossOut && d >= due && hive.res >= HIVE.BOSS_COST) {
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
  const range = attackRange(state, hive); // farther with a screamer spire (hivetech.js)
  // eras.js: your bases only while the pace of horde attacks on you allows a new one (the hives' hordes go for the
  // groups or roam in between).
  if (hordePaceOpen(state)) for (const b of state.bases) {
    const dist = g.distance(hive.tile, b.tile);
    if (dist > range) continue;
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
  if (c.baseId != null) noteHorde(state); // eras.js: the pace of horde attacks on you
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
    if (d <= HIVE.SUPPORT && needsDead(s) && !siteResting(state, s) && d < bd && !(s.noPath && s.noPath.includes(hive.id))) { best = s; bd = d; }
  }
  return best;
}

// ---------- build sites ----------
function pickSite(state) {
  const g = state.grid, rng = state.rng;
  if (!state.hives.length || state.hiveSites.length >= siteMax(state)) return null;
  // eras.js: the late game's cap on the hives standing (year 8: 11 on a Normal map), by the land on the other sizes
  // (a Huge map starts with 14: unscaled, it would never grow a hive past year 7). New hives are paced by siteDue.
  if (state.hives.length + state.hiveSites.length >= Math.round(hiveCap(state) * worldScale(state))) return null;
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
  // A site the nearest hive's hordes can walk to over land (as hordes.js nextStep paths, bridges included): a tile
  // across a river or on an island would gather nothing and stand in the way of the next site (SITE_MAX) for months.
  let pick = null;
  for (let tries = 0; tries < 6 && cands.length && !pick; tries++) {
    const c = rng.weighted(cands, (x) => x.w);
    const from = state.hives.reduce((best, hv) => (!best || g.distance(hv.tile, c.t.id) < g.distance(best.tile, c.t.id) ? hv : best), null);
    const res = findPath(g, from.tile, c.t.id, (a, b) => (state.tiles[b].terrain !== "water" || state.tiles[b].bridge ? 1 : Infinity), 120);
    if (res && res.path.length >= 2) pick = c.t;
    else cands.splice(cands.indexOf(c), 1);
  }
  if (!pick) return null;
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
    if (!needsDead(s) || siteResting(state, s) || state.grid.distance(s.tile, h.tile) > HIVE.DRAW) continue;
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
  // Nobody left to build it and nothing gathered: the site is given up after 90 days. A hive whose hordes found no
  // way there (noPath: water, mountains) does not count as building it (as supportSite), else such a site would stand
  // for ever and block the next (SITE_MAX sites at a time).
  const supported = state.hives.some((hv) => state.grid.distance(hv.tile, site.tile) <= HIVE.SUPPORT && !(site.noPath && site.noPath.includes(hv.id)));
  if (!supported && !mass && state.hour - site.chosen > 90 * 24) state.hiveSites.splice(state.hiveSites.indexOf(site), 1);
}

function completeSite(state, site) {
  state.hiveSites.splice(state.hiveSites.indexOf(site), 1);
  if (state.tiles[site.tile].hive) return null;
  const hive = newHive(state, site.tile, 0);
  state.hives.push(hive);
  overwriteClaims(state, site.tile, 2, null, "a hive has risen there"); // claims.js (agent A's hook: keep it)
  state.hiveInfo.stats.built++;
  if (!site.hardcore) state.hiveInfo.stats.grown = (state.hiveInfo.stats.grown ?? 0) + 1; // the cap on new hives counts these (newHiveCount)
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
  const grow = 1 + Math.min(0.5, rampDay(state) / 730); // a little bigger as the year goes on
  // Late in the game they carry the special dead of the era (hivetech.js borderMix, from TECH.BORDER_DAY).
  const h = makeHorde(state, { tile: t.id, size: Math.round(rng.int(k.min, k.max) * grow), role: "border", mix: borderMix(state) });
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
// The hives still on the tiles a cache was made for, in the same order (compared one by one, not as a joined string:
// hiveDistance asks it for every tile looked at).
function sameTiles(tiles, hives) {
  if (tiles.length !== hives.length) return false;
  for (let i = 0; i < tiles.length; i++) if (tiles[i] !== hives[i].tile) return false;
  return true;
}
// Distance to the nearest hive (Infinity with none). hives: a list of tile ids (what the player knows, for the map)
// or nothing (the real hives).
export function hiveDistance(state, tileId, hiveTiles = null) {
  if (!hiveTiles) {
    // The real hives: cached per tile until the set of hives changes (zombieToughness asks for every tile the
    // governor and the woodcutters look at, every hour: 5% of a huge map's hour without the cache).
    ensureHives(state);
    let c = state.hiveDistCache;
    if (!c || !sameTiles(c.tiles, state.hives)) {
      c = { tiles: state.hives.map((h) => h.tile), dist: new Float32Array(state.tiles.length).fill(-1) };
      Object.defineProperty(state, "hiveDistCache", { value: c, writable: true, configurable: true, enumerable: false }); // not saved
    }
    if (c.dist[tileId] < 0) {
      let best = Infinity;
      for (const h of state.hives) best = Math.min(best, state.grid.distance(h.tile, tileId));
      c.dist[tileId] = best;
    }
    return c.dist[tileId];
  }
  let best = Infinity;
  for (const t of hiveTiles) best = Math.min(best, state.grid.distance(t, tileId));
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
    newCap: newHiveCap(state), newCount: newHiveCount(state), // the cap on new hives in a span of HIVE.NEW_SPAN days, and how many so far
    stats: { ...state.hiveInfo.stats },
    growths: growthCounts(state), // hivetech.js
  };
}

// ---------- destroying a hive ----------
// The infection it radiated fades: the land within 7 tiles settles toward a low level (0.06 at the hive, +0.07 a
// tile), 0.01 a day. Its guard is gone; its other hordes wander on without a home. opts.quiet: no log line (a hive
// destroyed out of your sight and reach by an AI group's war party, factions.js groupHiveWar, which writes its own).
export function destroyHive(state, hive, how = "", opts = {}) {
  ensureHives(state);
  const i = state.hives.indexOf(hive);
  if (i < 0) return false;
  state.hives.splice(i, 1);
  state.tiles[hive.tile].hive = false;
  clearPois(state.tiles[hive.tile]); // pois.js: whatever stood there is destroyed with it; the tile stays empty
  for (const id of state.grid.within(hive.tile, 7)) {
    const t = state.tiles[id];
    // A ruin full of its own dead (t.ruin.dead: hardcore-groups.js, the fallen military's base) keeps them: the hive
    // only takes back what it radiated.
    const keep = (v) => (t.ruin && t.ruin.dead ? Math.min(v, t.ruin.dead) : 0);
    const was = t.infBase ?? t.infection;
    t.infBase = Math.max(keep(was), Math.min(was, 0.06 + 0.07 * state.grid.distance(hive.tile, id)));
    if (t.infGoal != null) t.infGoal = Math.max(keep(t.infGoal), Math.min(t.infGoal, t.infBase)); // hardcore-outbreak.js: the level the first year spreads toward
  }
  for (const h of [...state.hordes]) {
    if (h.hive !== hive.id) continue;
    if (h.role === "guard") state.hordes.splice(state.hordes.indexOf(h), 1);
    else { h.hive = null; if (h.role !== "attack") h.role = "roam"; }
  }
  witherGrowths(state, hive); // its growths wither and rot away (hivetech.js)
  state.hiveInfo.stats.destroyed++;
  if (!opts.quiet) log(state, `${hive.name[0].toUpperCase() + hive.name.slice(1)} was destroyed${how ? ` ${how}` : ""}. ${hivesLeftText(state)}`, "good");
  checkGameOver(state); // destroying the last hive wins (world.js)
  return true;
}
// "3 hives still stand in the state." / "No hive is left standing."
export function hivesLeftText(state) {
  const left = state.hives.length;
  return left ? `${left} hive${left === 1 ? "" : "s"} still stand${left === 1 ? "s" : ""} in the state.` : "No hive is left standing.";
}
// Your team fought this hive (a crawl: hivecrawl.js sets hive.playerDay): an AI group that fights it within
// GROUP_HIVE.PLAYER_DAYS days warms to you (factions.js groupHiveWar). Nothing from outside the hive kills it or burns
// it down any more (the fires and the firebombing are gone, 2026-10): only the death of its Hivemind does.

// Is every hive gone, with no new one being built? (world.js checkGameOver: the survivors win.)
export function hivesSecured(state) {
  return !!state.hives && !state.hives.length && !(state.hiveSites || []).some((s) => s.started != null);
}

// ---------- the Destroy hive mission (parties.js arrive) ----------
const guardOf = (state, hive) => state.hordes.find((h) => h.role === "guard" && h.hive === hive.id) || null;
export const hiveGuard = guardOf;

// The fight inside a hive: the guard's dead (tougher on red-skull ground), the special dead among them (its
// growths, hivetech.js: at least one of every kind it breeds, assaultTypes) and the Broodmother.
export function hiveForce(state, hive) {
  const guard = guardOf(state, hive);
  const f = broodForce(guard ? guard.size : 0, state);
  f.mix = (guard && guard.mix) || null;
  f.elite = !!(guard && guard.elite) || hiveMods(state, hive).elite;
  const a = assaultTypes(state, hive, f.count, f.mix);
  f.count = a.count;
  f.types = a.types;
  return f;
}
// The brood a hive with a guard of this size fields (also the autopilot's estimate from a guard it has seen).
// It fights on red-skull ground: power 1 + 3 (zombieToughness), plus a little for a big guard. state (optional):
// the eras' growth of the brood (eras.js broodGrowth: tougher every year from year 4).
export function broodForce(guardSize, state = null) {
  const s = guardSize ? hordeScore(guardSize) : 0;
  const grow = state ? broodGrowth(state) : 1;
  return { count: Math.max(10, Math.min(18, Math.round(8 + s * 0.6))), power: Math.round((5 + s / 30) * grow * 10) / 10, guard: guardSize || 0 };
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
  p.hiveVisit = tile; // conflicts.js contactOn: the hive's guard does not ambush the team on this tile after the card
  addCard(state, hiveCard(state, p, hive));
  return "";
}

function hiveCard(state, p, hive) {
  const force = hiveForce(state, hive);
  const den = denOf(state, hive);
  const est = crawlEstimate(state, hive);
  const power = Math.round(partyMembers(state, p).reduce((a, m) => a + combatPower(m), 0));
  const gone = (st) => !st.hives.includes(hive);
  const moved = (st) => { awaitOrders(st, p, "The hive is already gone.", { failed: true }); return "Nothing is left to fight."; };
  const been = (hive.denMem && hive.denMem.visits ? ` Teams have been inside ${hive.denMem.visits} time${hive.denMem.visits === 1 ? "" : "s"}: the chambers cleared lately stay clear for a while.` : "") + (hive.crawlRec ? ` Your crawls so far: ${crawlRecText(state, hive)}.` : ""); // hivecrawl.js: the crawl's record
  return {
    title: `The hive: ${hive.name}`,
    where: tileLabel(state, hive.tile),
    partyId: p.id,
    text: `A mound of fused bodies, pulsing and warm, and the dead packed around it${force.guard ? ` (about ${force.guard})` : ""}. The hive is a den of chambers with four mouths, one on each side: its core, where the ${BOSS_NAMES.hivemind} sits guarded by the ${BOSS_NAMES.hive}, lies ${den.depth} chamber${den.depth === 1 ? "" : "s"} in from the nearest mouth by the shortest way (there are other ways, and walls to go round). ` +
      `Your squad's combat power is ${power}. Expect about ${est.fights} fight${est.fights === 1 ? "" : "s"} on the way in, each tougher than the last, then the core. Bring five or six well-armed fighters, armor, ammunition and meds, a light each, Molotovs and flashbangs for the core (fire burns the Hivemind and stops its brood, a bang stops its pulse), and fuel for the egg chambers. Nothing from outside kills a hive: only its Hivemind's death does.${been}` +
      alliesText(state, hive, force.count) + // alliance.js: fighters from coalition members and job givers
      growthsText(state, hive, force), // hivetech.js: what has grown around it, the special dead in its brood
    // One way in for each of its mouths (hivecrawl.js: north, east, south, west), with what your crawls know of it; the
    // autopilot takes the one its estimate picks (autopilot.js hiveChoice: the choice's mouth).
    choices: [
      ...mouthsOf(den).map((id) => {
        const side = mouthSide(den, id);
        return {
          label: side ? `Enter the hive from the ${side}` : "Enter the hive (crawl to the core)",
          mouth: id,
          hint: `${mouthNote(state, hive, id)} Crawl it chamber by chamber: follow the warmth to the core (${den.depth} chambers deep from the nearest mouth) and kill the ${BOSS_NAMES.hivemind}. Leaving is a walk back out to any of the four mouths`,
          resolve: (st) => {
            if (gone(st)) return moved(st);
            startHiveCrawl(st, p, hive, id);
            return "";
          },
        };
      }),
      { label: "Back off", hint: "No fight", resolve: (st) => { awaitOrders(st, p, "The team pulled back from the hive."); return "The team pulls back."; } },
    ],
  };
}

// The Molotovs a team has: on its people (pockets, hands, packs) and in its cargo. [{ item, take() }]
export function molotovsOf(state, p) {
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

// The growths around the hive (hivetech.js) and the special dead in its brood, for the hive card.
function growthsText(state, hive, force) {
  const grown = growthsOf(state, hive, false).map((g) => `${GROWTHS[g.kind].name.toLowerCase()}${state.hour < g.ready ? " (still growing)" : ""}`);
  const kinds = force.types ? Object.entries(force.types).map(([k, n]) => `${n} ${(ZTYPES[k] ? ZTYPES[k].name : k).toLowerCase()}${n > 1 ? "s" : ""}`).join(", ") : "";
  return (grown.length ? ` Around it the dead have grown: ${grown.join(", ")} (burn them with the Burn the growth mission).` : "") +
    (kinds ? ` Among the brood: ${kinds}${force.elite ? ", elite" : ""}.` : "");
}

// Allied fighters at the mound (alliance.js hiveAllies): each keeps one of the brood off your squad.
function alliesText(state, hive, count) {
  const a = hiveAllies(state, hive);
  return a.fighters ? ` Fighters from ${a.names.join(", ")} will storm it with you: about ${count - broodAfterAllies(count, a.fighters)} of the brood fewer reach your squad.` : "";
}

// A hive assault is fought on a Large map (combat.js HIVE_W × HIVE_H, battlesize.js SIZES.HIVE).
registerBattleSize("hive", () => [HIVE_W, HIVE_H]);
// The mound: its middle at most HIVE_REACH columns in from the west edge (on a Large map the fight is not a walk:
// there is more of the hive's land behind it), its height growing with the map's up to 13 rows.
const HIVE_REACH = 28;
function moundAt(ctx) {
  const r = Math.max(3, Math.min(6, Math.round((3 * ctx.H) / 13))), half = r > 3 ? 2 : 1;
  return { r, half, cx: Math.min(ctx.W - 2 - half, HIVE_REACH), cy: Math.floor(ctx.H / 2) };
}
registerBattleLayout("hive", (b, ctx) => {
  const { r, half, cx, cy } = moundAt(ctx);
  if (ctx.phase === "map") {
    // The hive itself: a mound of flesh on the right, with gaps the brood comes through. Drawn for 18 × 13: the
    // mound and the lumps of flesh around it grow with the map.
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - half; x <= cx + half; x++) {
      if (Math.abs(y - cy) === 1 && x < cx) continue; // openings
      if (Math.abs(x - cx) * (r / (half + 1)) + Math.abs(y - cy) <= r && ctx.inside(x, y)) ctx.put(x, y, "hivewall");
    }
    const lumps = Math.round((4 * ctx.W * ctx.H) / (18 * 13));
    for (let i = 0; i < lumps; i++) { const x = ctx.rng.int(8, ctx.W - 6), y = ctx.rng.int(0, ctx.H - 1); if (ctx.free(x, y)) ctx.put(x, y, "hivewall"); }
    return;
  }
  // Units: the Broodmother deep in the hive, just behind the mound.
  const boss = bossUnit(b, "broodmother");
  if (placeUnitRight(b, ctx, boss, Math.min(ctx.W - 5, cx - 1), cx + half + 2)) b.units.push(boss);
});

// The core fight's handler ("hiveAssault": the old storm's key, kept for the autosave, the service records and old
// saves made mid-storm) is in hivecrawl.js.
