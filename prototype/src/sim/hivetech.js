// The hives' tech tree: structures ("growths") a hive grows on the land around it, and what they give it.
// Numbers in hiveconst.js (TECH, GROWTHS, ZTYPES); the special dead themselves in zombietypes.js.
//
// Growths: a hive grows them on land tiles within TECH.RANGE (2) of itself: not on water or a bridge, a site, a
// ruin, a base (yours or a group's), a hive or a hive build site, nor where another growth stands. Each costs
// resources when it is started and takes days to grow (GROWTHS: a biomass pit 12 for 10 days ... a mutation vat 60
// for 60), one at a time, at least TECH.GAP days apart, TECH.MAX per hive. A grown one gives its hive: income (pits
// +1 a day, feeding grounds ×1.5), a bigger guard and one more horde out (the brood chamber), a kind of special dead
// in its hordes (worm cyst, runner warren, brute pit, spitter sac, screamer spire, crawler burrow, Shepherd's fold), Wallbreakers (the den:
// with HIVE.BOSS_DEN they come from nowhere else), elite special dead (the mutation vat). A screamer spire also
// lets its hive attack bases TECH.SPIRE_RANGE farther away and calls wandering dead within TECH.SPIRE_CALL into its
// guard.
//
// The hive's mind (growthWish, every day after its income): what it may grow is set by its tier (hiveTier: the game
// day and the hive's own age, TECH.TIER_DAY / TIER_AGE, stretched per hive by up to TECH.JITTER), so a 10–15 year
// game sees Carriers from the first months (the worm cyst is tier 0: the first special dead, after the hive's first
// pit), runners in the first year, brutes and spitters in the second, screamers, crawlers and Wallbreakers
// from about the third and elite dead late. Among those it weighs: income first while it is young or poor, the
// brood chamber when it was attacked within TECH.THREAT_DAYS (a crawl, a growth burned), a kind of dead its
// cluster-mates do not breed yet over one they do, the den and the vat above the rest once open. Its guard comes
// first; a growth it cannot afford yet it saves for (no new roaming hordes) for up to TECH.SAVE_DAYS.
//
// The player: growths show on the map around a hive you know of (live or reported), in the tile panel with what they
// do, and in reports: one finished in sight is in the log, one out of sight at a hive you know of reaches you as a
// rumour (TECH.RUMOUR) and goes on the map. The Burn the growth mission: fight its guard (a small battle against
// the dead around it, with the hive's special dead and the growth's own kind), or burn it with fuel (TECH.FIRE_FUEL,
// FIRE_DMG of its TECH.HP flesh) or Molotovs (TECH.BOMBS, BOMB_DMG): flesh regrows TECH.REGROW a day. Gone, its
// hive loses what it gave (a kind of dead it no longer breeds, income). Destroying the hive withers every growth it
// had: husks that do nothing and rot away in TECH.DECAY_DAYS.
// The hives' own choices (what to grow, where, the mix of a horde, the spire calling, rumours) roll their own dice
// (roll: a hash of the seed, the hour and what is rolled for), so they never shift the world's random numbers
// (state.rng) that everything else draws from; a team's fire at a growth uses state.rng. A seed plays out the same.
import { TECH, GROWTHS, ZTYPES, HIVE, HORDEMIX } from "./hiveconst.js";
import { log, day, addCard, snapshot, combatPower, hurt, hub, localId } from "./world.js";
import { ensureHives, hiveById, zombieToughness, hiveGuard, molotovsOf, clusterSize } from "./hives.js";
import { reduceHorde } from "./hordes.js";
import { partyMembers, partyTile, tileLabel, awaitOrders, wipeIfEmpty } from "./parties.js";
import { partyFuel, useFuel } from "./vehicles.js";
import { registerCombatHandler, registerBattleLayout } from "./combat.js";
import { fightNow } from "./defences.js";
import { battleTypes, mixText, ambientMix } from "./zombietypes.js";
import { rampDay } from "./eras.js"; // the game day the eras' ramps count by (hardcore: from the normal start)

const hash = (n) => { let x = (n >>> 0) ^ 0x85ebca6b; x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return (x ^ (x >>> 16)) >>> 0; };
const r1 = (v) => Math.round(v * 10) / 10;
// A number in [0, 1) from the seed, the hour and the keys: the tech tree's own dice.
export function roll(state, ...keys) {
  let x = hash((state.seed || 1) ^ Math.imul(state.hour + 1, 0x27d4eb2d));
  for (const k of keys) x = hash(x ^ (typeof k === "number" ? Math.imul(k + 7, 0x165667b1) : [...String(k)].reduce((a, c) => Math.imul(a ^ c.charCodeAt(0), 16777619), 2166136261)));
  return x / 4294967296;
}
const rollRange = (state, lo, hi, ...keys) => lo + (hi - lo) * roll(state, ...keys);

export function ensureGrowths(state) {
  return state.hiveGrowths || (state.hiveGrowths = []);
}
export const growthAt = (state, tile) => ensureGrowths(state).find((g) => g.tile === tile) || null;
export const growthById = (state, id) => ensureGrowths(state).find((g) => g.id === id) || null;
export const isGrowing = (state, g) => !g.withered && state.hour < g.ready;
// A hive's growths: grown ones (readyOnly), or every living one, growing too.
export function growthsOf(state, hive, readyOnly = true) {
  return ensureGrowths(state).filter((g) => g.hive === hive.id && !g.withered && (!readyOnly || state.hour >= g.ready));
}

// ---------- tiers ----------
// The tier a hive may grow up to: tier t needs the game past TIER_DAY[t] (× 1 to 1 + JITTER for this hive) and the
// hive TIER_AGE[t] days old.
export function hiveTier(state, hive) {
  const d = rampDay(state), age = (state.hour - (hive.born || 0)) / 24;
  const j = 1 + TECH.JITTER * ((hash((hive.id || 0) * 7919 + (state.seed || 1)) % 1000) / 1000);
  let t = 0;
  for (let i = 1; i < TECH.TIER_DAY.length; i++) {
    if (d >= TECH.TIER_DAY[i] * j && age >= TECH.TIER_AGE[i]) t = i;
    else break;
  }
  return t;
}
// The era by the calendar alone (border hordes).
export function eraTier(state) {
  const d = rampDay(state);
  let t = 0;
  for (let i = 1; i < TECH.TIER_DAY.length; i++) if (d >= TECH.TIER_DAY[i]) t = i;
  return t;
}

// ---------- what a hive's growths give it ----------
export function hiveMods(state, hive) {
  const out = { income: 0, mult: 1, guard: 0, out: 0, unlocks: [], boss: false, elite: false, spire: false };
  let tier = null;
  for (const g of growthsOf(state, hive)) {
    const G = GROWTHS[g.kind];
    if (!G) continue;
    out.income += G.income || 0;
    if (G.incomeMult) out.mult *= G.incomeMult;
    out.guard += G.guard || 0;
    if (G.out && (tier ??= hiveTier(state, hive)) >= (G.outTier || 0)) out.out += G.out; // outTier: only once the hive has evolved that far
    if (G.unlocks && !out.unlocks.includes(G.unlocks)) out.unlocks.push(G.unlocks);
    if (G.boss) out.boss = true;
    if (G.elite) out.elite = true;
    if (G.spire) out.spire = true;
  }
  return out;
}
export const growthIncome = (state, hive, base) => { const m = hiveMods(state, hive); return r1((base + m.income) * m.mult); };
export const guardMin = (state, hive) => HIVE.GUARD_MIN + hiveMods(state, hive).guard;
export const extraOut = (state, hive) => hiveMods(state, hive).out;
export const attackRange = (state, hive) => HIVE.ATTACK_RANGE + (hiveMods(state, hive).spire ? TECH.SPIRE_RANGE : 0);
// May this hive raise a Wallbreaker? With HIVE.BOSS_DEN only once it has grown a den.
export const canRaiseBoss = (state, hive) => !HIVE.BOSS_DEN || hiveMods(state, hive).boss;

// The tier a kind of special dead is bred from (its growth's).
const kindTier = (k) => { for (const G of Object.values(GROWTHS)) if (G.unlocks === k) return G.tier; return 0; };
// The odds that a new horde of this size (HORDE_SIZES key: "small" | "medium" | "large", or "guard") brings each kind
// the hive breeds (HORDEMIX): by the horde's size, + TIER a tier the hive is past the kind's own, + BROOD with a brood
// chamber, at most MAX; a guard GUARD. { kinds: { runner: 0.62, ... }, most: kinds at most }.
export function mixOdds(state, hive, size = "medium") {
  const m = hiveMods(state, hive);
  const tier = hiveTier(state, hive);
  const brood = growthsOf(state, hive).some((g) => GROWTHS[g.kind] && GROWTHS[g.kind].guard);
  const H = HORDEMIX;
  const kinds = {};
  for (const k of m.unlocks) {
    kinds[k] = size === "guard" ? H.GUARD : Math.min(H.MAX, (H.ODDS[size] ?? H.ODDS.medium) + H.TIER * Math.max(0, tier - kindTier(k)) + (brood ? H.BROOD : 0));
  }
  const most = size === "guard" ? m.unlocks.length : (H.KINDS[size] ?? H.KINDS.medium) + (tier >= 3 ? 1 : 0) + (tier >= 4 ? 1 : 0);
  return { kinds, most };
}
// The special dead in a new horde from this hive: each kind it breeds comes along at its odds (mixOdds: the horde's
// size, the hive's tier and growths), at most `most` kinds (the likeliest win a tie for a place), then at about its
// share (× 0.6–1.4), together at most TECH.MIX_MAX. The hive's own dice (roll). { mix: { runner: 0.14, ... } | null,
// elite }.
export function hiveMix(state, hive, size = "medium") {
  const m = hiveMods(state, hive);
  if (!m.unlocks.length) return { mix: null, elite: false };
  const { kinds, most } = mixOdds(state, hive, size);
  const seq = state.hordes.length;
  const came = m.unlocks.filter((k) => roll(state, "come", hive.id, k, seq) < kinds[k])
    .sort((a, b) => kinds[b] - kinds[a] || roll(state, "order", hive.id, a, seq) - roll(state, "order", hive.id, b, seq)).slice(0, most);
  if (!came.length) return { mix: null, elite: m.elite };
  const mix = {};
  let total = 0;
  for (const k of came) { const v = ZTYPES[k].share * rollRange(state, 0.6, 1.4, "mix", hive.id, k, seq); mix[k] = v; total += v; }
  const f = total > TECH.MIX_MAX ? TECH.MIX_MAX / total : 1;
  for (const k in mix) mix[k] = Math.round(mix[k] * f * 1000) / 1000;
  return { mix, elite: m.elite };
}
// The kinds a hive's brood fights an assault with (hives.js hiveForce): the guard's mix, and at least HORDEMIX.ASSAULT
// of every kind the hive breeds, the special dead together at most ASSAULT_SHARE of the brood (the brood grows to
// make room, up to `cap`). { count, types, mix } (types: unit counts).
export function assaultTypes(state, hive, count, mix, cap = 20) {
  const kinds = hiveMods(state, hive).unlocks;
  const H = HORDEMIX;
  count = Math.min(cap, Math.max(count, Math.ceil((kinds.length * H.ASSAULT) / H.ASSAULT_SHARE)));
  const types = { ...(battleTypes(mix, count) || {}) };
  for (const k of kinds) types[k] = Math.max(types[k] || 0, H.ASSAULT);
  // Too many for the brood: the kinds with the most give one up first (never below ASSAULT).
  const room = Math.floor(count * H.ASSAULT_SHARE);
  let n = Object.values(types).reduce((a, v) => a + v, 0);
  while (n > room) {
    const k = Object.keys(types).sort((a, b) => types[b] - types[a])[0];
    if (!k || types[k] <= H.ASSAULT) break;
    types[k]--; n--;
  }
  // Still more kinds than room (the cap): the newest kinds of the hive stay, the oldest give way.
  if (n > count) for (const k of Object.keys(types).sort((a, b) => kindTier(a) - kindTier(b))) { if (n <= count) break; n -= types[k]; delete types[k]; }
  return { count, types: Object.keys(types).length ? types : null };
}
// A border horde late in the game: the kinds of the era (by the calendar) at TECH.BORDER_SHARE of their share.
export function borderMix(state) {
  if (rampDay(state) < TECH.BORDER_DAY) return null;
  const era = eraTier(state);
  const mix = {};
  for (const G of Object.values(GROWTHS)) if (G.unlocks && G.tier <= era) mix[G.unlocks] = Math.round(ZTYPES[G.unlocks].share * TECH.BORDER_SHARE * rollRange(state, 0.5, 1.5, "border", G.unlocks) * 1000) / 1000;
  return Object.keys(mix).length ? mix : null;
}

// The special dead met exploring a tile away from a hive's hordes (zombietypes.js ambientMix): more in towns and
// cities every game year, of the kinds of the era; on a hive's land more, and on its red-skull ring the kinds the
// nearest hive breeds. Shares ({ climber: 0.04, ... }) or null.
export function siteSpecials(state, tileId) {
  const t = state.tiles[tileId];
  if (!t) return null;
  const tough = state.hives && state.hives.length ? zombieToughness(state, tileId) : 0;
  let hiveKinds = null;
  if (tough >= 3) {
    const hv = state.hives.reduce((a, h) => (!a || state.grid.distance(h.tile, tileId) < state.grid.distance(a.tile, tileId) ? h : a), null);
    if (hv) { hiveKinds = {}; for (const k of hiveMods(state, hv).unlocks) hiveKinds[k] = ZTYPES[k].share; }
  }
  return ambientMix(t, { years: rampDay(state) / 112, era: eraTier(state), toughness: tough, hiveKinds });
}

// ---------- threat ----------
export function markThreat(state, hive) {
  if (hive) hive.threatDay = day(state);
}
export const hiveThreatened = (state, hive) => hive.threatDay != null && day(state) - hive.threatDay <= TECH.THREAT_DAYS;

// ---------- placing and choosing ----------
const okGround = (t) => t.terrain !== "water" && !t.bridge && !t.hive && !t.loc && !t.ruin;
// Free tiles a hive can grow on (within TECH.RANGE).
export function growthTiles(state, hive) {
  const g = state.grid;
  const taken = new Set(ensureGrowths(state).map((x) => x.tile));
  const people = new Set([...state.bases.map((b) => b.tile), ...state.factions.filter((f) => f.alive).flatMap((f) => f.bases)]);
  const sites = new Set((state.hiveSites || []).map((s) => s.tile));
  return g.within(hive.tile, TECH.RANGE).filter((id) => id !== hive.tile && g.distance(id, hive.tile) <= TECH.RANGE && !taken.has(id) && !people.has(id) && !sites.has(id) && okGround(state.tiles[id]));
}

// What the hive would grow next (null: nothing now). rand: a little noise (the daily tick); tools may pass false.
export function growthWish(state, hive, rand = true) {
  ensureHives(state);
  const d = day(state);
  const mine = growthsOf(state, hive, false);
  if (mine.some((g) => isGrowing(state, g)) || mine.length >= TECH.MAX) return null;
  if (hive.growDay != null && d - hive.growDay < TECH.GAP) return null;
  if (!growthTiles(state, hive).length) return null;
  const tier = hiveTier(state, hive);
  const threat = hiveThreatened(state, hive);
  const age = (state.hour - (hive.born || 0)) / 24;
  const mates = state.hives.filter((o) => o !== hive && state.grid.distance(o.tile, hive.tile) <= HIVE.CLUSTER);
  const mateHas = (k) => mates.some((o) => growthsOf(state, o, false).some((g) => g.kind === k));
  const spawners = mine.filter((g) => GROWTHS[g.kind].unlocks).length;
  let best = null;
  for (const k of Object.keys(GROWTHS)) {
    const G = GROWTHS[k];
    const have = mine.filter((g) => g.kind === k).length;
    if (G.tier > tier || have >= G.max || (G.boss && !HIVE.BOSS_DEN)) continue;
    let s = 1;
    if (G.income) s = (age < 180 || (hive.income || 0) <= 3 ? 3 : 1.2) / (1 + have);
    else if (G.guard) s = 1.5 + (threat ? 4 : 0);
    else if (G.incomeMult) s = 1.5 + (clusterSize(state, hive) <= 2 ? 1.5 : 0);
    else if (G.unlocks) s = 2.5 + (mateHas(k) ? -1 : 1) + (G.tier >= 2 ? 0.5 : 0) - (G.tier === 0 ? 1 : 0); // the worm cyst (tier 0): after the first pit
    else if (G.boss) s = 3.5;
    else if (G.elite) s = 3 + (spawners >= 2 ? 1 : 0);
    if (rand) s *= rollRange(state, 0.8, 1.2, "wish", hive.id, k);
    if (!best || s > best.s) best = { k, s };
  }
  return best ? best.k : null;
}

const pickWeighted = (items, w, u) => { const tot = items.reduce((a, x) => a + w(x), 0); let r = u * tot; for (const x of items) { r -= w(x); if (r < 0) return x; } return items[items.length - 1]; };
// Starts a growth (paid now). tile: a given tile (tools), else one of the free tiles (next to the hive likelier).
export function startGrowth(state, hive, kind, tile = null) {
  const G = GROWTHS[kind];
  const tiles = growthTiles(state, hive);
  if (!G || !tiles.length || (tile != null && !tiles.includes(tile))) return null;
  const t = tile ?? pickWeighted(tiles, (id) => (state.grid.distance(id, hive.tile) === 1 ? 2 : 1), roll(state, "tile", hive.id, kind));
  hive.res -= G.cost;
  const g = { id: (state.hiveSeq = (state.hiveSeq || 0) + 1), hive: hive.id, kind, tile: t, start: state.hour, ready: state.hour + G.days * 24, hp: TECH.HP, withered: null, done: false };
  ensureGrowths(state).push(g);
  hive.growDay = day(state);
  const st = state.hiveInfo.stats;
  st.growths = (st.growths || 0) + 1;
  if (state.live.has(t)) log(state, `The dead at ${hive.name} have begun to grow something new beside it.`, "danger");
  return g;
}

// The hive's daily step (hives.js hivesDaily, after its income, before it buys hordes): its guard first, then the
// growth it wants, now or saved for.
export function growthStep(state, hive) {
  const d = day(state);
  const guard = hiveGuard(state, hive);
  if (!guard || guard.size < guardMin(state, hive)) return null;
  if (hive.growSave && (d > hive.growSave.until || !GROWTHS[hive.growSave.kind])) hive.growSave = null;
  const kind = hive.growSave ? hive.growSave.kind : growthWish(state, hive);
  if (!kind) return null;
  if (hive.res >= GROWTHS[kind].cost) {
    hive.growSave = null;
    return startGrowth(state, hive, kind);
  }
  if (!hive.growSave) hive.growSave = { kind, until: d + TECH.SAVE_DAYS };
  return null;
}
// Is the hive saving for a growth (hives.js: no new roaming hordes until it has the resources)?
export const savingFor = (state, hive) => (hive.growSave && GROWTHS[hive.growSave.kind] ? GROWTHS[hive.growSave.kind].cost : 0);

// ---------- every day: growing, regrowing, rotting, the spire calling ----------
export function growthsDaily(state) {
  const list = ensureGrowths(state);
  for (const g of [...list]) {
    if (g.withered != null) {
      if (state.hour - g.withered >= TECH.DECAY_DAYS * 24) list.splice(list.indexOf(g), 1);
      continue;
    }
    if (!g.done && state.hour >= g.ready) { g.done = true; completeGrowth(state, g); }
    g.hp = Math.min(TECH.HP, (g.hp ?? TECH.HP) + TECH.REGROW);
  }
  // A screamer spire calls the wandering dead near it into its hive's guard.
  for (const hive of state.hives) {
    if (!hiveMods(state, hive).spire) continue;
    const guard = hiveGuard(state, hive);
    if (guard && guard.size >= guardMin(state, hive) * 3) continue;
    for (const h of state.hordes) {
      if (h.hive != null || (h.role !== "roam" && h.role !== "border") || state.grid.distance(h.tile, hive.tile) > TECH.SPIRE_CALL) continue;
      if (roll(state, "spire", hive.id, localId(state, h.id)) >= TECH.SPIRE_ODDS) continue;
      h.role = "guard"; h.hive = hive.id; h.target = hive.tile; h.goal = null;
    }
  }
}

const COMPASS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
function compass(state, from, to) {
  const a = state.tiles[from], b = state.tiles[to];
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  return COMPASS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
}
const knownHiveAt = (state, tile) => (state.live.has(tile) ? !!state.tiles[tile].hive : !!(state.knowledge[tile] && state.knowledge[tile].hive));
const article = (s) => (/^[aeiou]/i.test(s) ? "an" : "a");

function completeGrowth(state, g) {
  const hive = hiveById(state, g.hive);
  const G = GROWTHS[g.kind];
  if (!hive || !G) return;
  const what = `${article(G.name)} ${G.name.toLowerCase()}`;
  if (state.live.has(g.tile)) {
    log(state, `The dead at ${hive.name} have grown ${what}. ${G.desc}`, "danger");
    return;
  }
  if (!knownHiveAt(state, hive.tile) || roll(state, "rumour", g.id) >= TECH.RUMOUR) return;
  const h = hub(state);
  const where = h ? `the hive ${compass(state, h.tile, hive.tile)} of ${h.name}` : hive.name;
  log(state, `Rumours from the road: the dead at ${where} are growing something new. ${what[0].toUpperCase()}${what.slice(1)}, by the sound of it. It is on the map.`, "danger");
  const k = state.knowledge[g.tile];
  state.knowledge[g.tile] = k ? { ...k, growth: growthInfo(state, g) } : { ...snapshot(state, g.tile), hordeSize: 0, hordeBoss: 0, via: "rumour" };
}

// What a snapshot keeps of a growth (world.js snapshot, the map and the tile panel).
export function growthInfo(state, g) {
  if (!g) return null;
  return { kind: g.kind, name: GROWTHS[g.kind] ? GROWTHS[g.kind].name : g.kind, growing: isGrowing(state, g), withered: g.withered != null, hp: Math.round(g.hp ?? TECH.HP), hive: (hiveById(state, g.hive) || {}).tile ?? null };
}

// The hive is destroyed: its growths wither (no effect) and rot away over TECH.DECAY_DAYS.
export function witherGrowths(state, hive) {
  for (const g of ensureGrowths(state)) if (g.hive === hive.id && g.withered == null) { g.withered = state.hour; g.hp = 0; }
}

export function destroyGrowth(state, g, how = "") {
  const list = ensureGrowths(state);
  const i = list.indexOf(g);
  if (i < 0) return false;
  list.splice(i, 1);
  const hive = hiveById(state, g.hive);
  markThreat(state, hive);
  const st = state.hiveInfo.stats;
  st.burned = (st.burned || 0) + 1;
  const G = GROWTHS[g.kind];
  const lost = G.unlocks && hive && !hiveMods(state, hive).unlocks.includes(G.unlocks) ? ` It breeds no more ${ZTYPES[G.unlocks].name.toLowerCase()}s.` : "";
  log(state, `The ${G.name.toLowerCase()} at ${hive ? hive.name : "a dead hive"} was destroyed${how ? ` ${how}` : ""}.${lost}`, "good");
  if (state.knowledge[g.tile] || state.live.has(g.tile)) state.knowledge[g.tile] = snapshot(state, g.tile);
  return true;
}

// ---------- the Burn the growth mission (parties.js arrive) ----------
// The dead guarding a growth: TECH.GUARD_BASE + 1 per GUARD_PER in its hive's guard (at most GUARD_MAX), tougher by
// the hive's ground; the hive's special dead among them, and more of the growth's own kind once it is grown.
export function growthForce(state, g) {
  const hive = hiveById(state, g.hive);
  const guard = hive ? hiveGuard(state, hive) : null;
  const count = Math.min(TECH.GUARD_MAX, TECH.GUARD_BASE + Math.floor((guard ? guard.size : 0) / TECH.GUARD_PER));
  const power = r1(2 + zombieToughness(state, g.tile) * 0.6);
  const mix = { ...((guard && guard.mix) || {}) };
  const own = GROWTHS[g.kind].unlocks;
  if (own && !isGrowing(state, g)) mix[own] = Math.min(0.6, (mix[own] || 0) + 0.25);
  return { count, power, types: battleTypes(mix, count), elite: !!(guard && guard.elite), guard: guard ? guard.size : 0 };
}
const typesWords = (types) => (types ? Object.entries(types).map(([k, n]) => `${n} ${ZTYPES[k].name.toLowerCase()}${n > 1 ? "s" : ""}`).join(", ") : "");

export function growthArrive(state, p) {
  const g = growthAt(state, p.dest);
  p.seen.set(p.dest, snapshot(state, p.dest));
  if (!g || g.withered != null) {
    awaitOrders(state, p, g ? "Only a withered husk is left here: its hive is gone." : "There is no hive growth here any more.", { failed: true });
    return "";
  }
  p.phase = "engaged";
  addCard(state, growthCard(state, p, g));
  return "";
}

function growthCard(state, p, g) {
  const G = GROWTHS[g.kind];
  const hive = hiveById(state, g.hive);
  const force = growthForce(state, g);
  const power = Math.round(partyMembers(state, p).reduce((a, m) => a + combatPower(m), 0));
  const gone = (st) => !ensureGrowths(st).includes(g) || g.withered != null;
  const moved = (st) => { awaitOrders(st, p, "The growth is already gone.", { failed: true }); return "Nothing is left to burn."; };
  const bombs = molotovsOf(state, p).length;
  const kinds = typesWords(force.types);
  return {
    title: `Hive growth: ${G.name}`,
    where: tileLabel(state, g.tile),
    partyId: p.id,
    text: `${G.desc}${isGrowing(state, g) ? " It is still growing." : ""} It belongs to ${hive ? hive.name : "a hive"}. About ${force.count} of the dead guard it${kinds ? `, among them ${kinds}` : ""}${force.elite ? " (elite)" : ""}. Its flesh is at ${Math.round(g.hp)}%: a fire burns ${TECH.FIRE_DMG}, Molotovs ${TECH.BOMB_DMG}, and it grows back ${TECH.REGROW} a day. Your squad's combat power is ${power}.`,
    choices: [
      {
        label: "Fight its guard (tactical battle)",
        hint: `About ${force.count} of the dead at power ${force.power}${kinds ? ` (${kinds})` : ""}. Win and the growth is torn down and burned; you can fall back from the left edge`,
        resolve: (st) => {
          if (gone(st)) return moved(st);
          fightNow(st, {
            tile: g.tile, partyId: p.id,
            enemy: { kind: "zombies", count: force.count, power: force.power, types: force.types, elite: force.elite, name: `the dead guarding the ${G.name.toLowerCase()}` },
            ambush: null, canRetreat: true, handler: "growthAssault", layout: "growth",
            context: { growthId: g.id, partyId: p.id },
          });
          return "";
        },
      },
      {
        label: `Burn it (${TECH.FIRE_FUEL} fuel)`,
        hint: `${TECH.FIRE_DMG} of its flesh burns (${Math.round(g.hp)} left: ${g.hp <= TECH.FIRE_DMG ? "enough to destroy it" : "it takes another fire"}). Stealth decides whether its guard notices`,
        get disabled() { return partyFuel(state, p) < TECH.FIRE_FUEL; },
        resolve: (st) => {
          if (gone(st)) return moved(st);
          if (partyFuel(st, p) < TECH.FIRE_FUEL) { awaitOrders(st, p, "Not enough fuel for the fire.", { failed: true }); return `The team has less than ${TECH.FIRE_FUEL} fuel.`; }
          useFuel(st, p, TECH.FIRE_FUEL);
          return burnGrowth(st, p, g, TECH.FIRE_DMG, 0.4, "setting fire to a hive growth");
        },
      },
      {
        label: `Firebomb it (${TECH.BOMBS} Molotovs)`,
        hint: `${TECH.BOMB_DMG} of its flesh burns, thrown from a distance (less likely to be noticed). The team carries ${bombs}`,
        get disabled() { return molotovsOf(state, p).length < TECH.BOMBS; },
        resolve: (st) => {
          if (gone(st)) return moved(st);
          const list = molotovsOf(st, p);
          if (list.length < TECH.BOMBS) { awaitOrders(st, p, "Not enough Molotovs.", { failed: true }); return `The team has fewer than ${TECH.BOMBS} Molotovs.`; }
          for (const x of list.slice(0, TECH.BOMBS)) x.take();
          return burnGrowth(st, p, g, TECH.BOMB_DMG, 0.55, "firebombing a hive growth");
        },
      },
      { label: "Back off", hint: "No fight", resolve: (st) => { awaitOrders(st, p, "The team pulled back from the growth."); return "The team pulls back."; } },
    ],
  };
}

// A fire at a growth: dmg of its flesh; at 0 it is destroyed. The guard notices unless the team's best stealth
// beats the odds (base + 5% a point, at most 90%): someone is hurt getting away.
export function burnGrowth(state, p, g, dmg, base, cause) {
  const G = GROWTHS[g.kind];
  const hive = hiveById(state, g.hive);
  markThreat(state, hive);
  g.hp = Math.max(0, (g.hp ?? TECH.HP) - dmg);
  let text;
  if (g.hp <= 0) {
    destroyGrowth(state, g, "by fire");
    text = `The ${G.name.toLowerCase()} burns down to blackened bone.`;
  } else text = `The ${G.name.toLowerCase()} burns, but the flesh is thick: ${Math.round(g.hp)}% is left, and it grows back.`;
  const best = Math.max(0, ...partyMembers(state, p).map((m) => m.skills.stealth || 0));
  if (!state.rng.chance(Math.min(0.9, base + best * 0.05))) {
    const v = state.rng.pick(partyMembers(state, p));
    if (v) { hurt(state, v, state.rng.int(10, 35), g.tile, cause); text += v.alive ? ` Its guard noticed: ${v.name.split(" ")[0]} was hurt getting away.` : ` Its guard noticed: ${v.name} was killed getting away.`; }
  }
  p.seen.set(g.tile, snapshot(state, g.tile));
  if (!wipeIfEmpty(state, p)) awaitOrders(state, p, text);
  return text;
}

registerBattleLayout("growth", (b, ctx) => {
  if (ctx.phase !== "map") return;
  // The growth: a knot of flesh on the right with a way in from the left, and a few lumps of it about.
  const cx = ctx.W - 4, cy = Math.floor(ctx.H / 2);
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) if (!(x === cx - 1 && y === cy) && !(x === cx && y === cy) && ctx.inside(x, y)) ctx.put(x, y, "hivewall");
  for (let i = 0; i < 3; i++) { const x = ctx.rng.int(8, ctx.W - 6), y = ctx.rng.int(0, ctx.H - 1); if (ctx.free(x, y)) ctx.put(x, y, "hivewall"); }
});

registerCombatHandler("growthAssault", (state, result, setup) => {
  const c = setup.context;
  const g = growthById(state, c.growthId);
  const p = state.parties.find((x) => x.id === c.partyId);
  const hive = g ? hiveById(state, g.hive) : null;
  const guard = hive ? hiveGuard(state, hive) : null;
  if (guard && result.enemiesKilled) reduceHorde(state, guard, result.enemiesKilled);
  let text;
  if (result.outcome === "victory" && g && g.withered == null) {
    destroyGrowth(state, g, "by your team");
    text = `The guard is down and the ${GROWTHS[g.kind].name.toLowerCase()} is torn apart and burned.`;
  } else {
    markThreat(state, hive);
    text = result.outcome === "retreat" ? "The team fell back from the growth. It still stands." : "The dead around the growth drove the team off.";
  }
  if (!p || !state.parties.includes(p)) return;
  if (g) p.seen.set(g.tile, snapshot(state, g.tile));
  if (wipeIfEmpty(state, p)) { log(state, "The whole team was lost attacking a hive growth.", "death"); return; }
  if (result.outcome !== "victory") log(state, `${text} (${tileLabel(state, partyTile(p))})`, "danger");
  awaitOrders(state, p, text);
});

// ---------- for the dev panel, the tools and the autopilot ----------
export function growthCounts(state) {
  const out = { total: 0, growing: 0, withered: 0, kinds: {} };
  for (const g of ensureGrowths(state)) {
    out.total++;
    if (g.withered != null) { out.withered++; continue; }
    if (isGrowing(state, g)) out.growing++;
    out.kinds[g.kind] = (out.kinds[g.kind] || 0) + 1;
  }
  return out;
}
export { mixText };
