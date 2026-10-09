// @ts-check
// The hive crawl: destroying a hive is not one battle at its mound but a crawl through it, chamber by chamber, from
// its mouth to the core room where the Hivemind sits, the organ that thinks for the hive. Kill the Hivemind and the
// hive dies (hives.js destroyHive). The mid-to-late game's content: a young hive is two chambers deep, a hive of the
// late game nine (DEPTH by hivetech.js hiveTier; a screamer spire grows it one deeper).
//
// The den (hive.den, made on first look from the world's seed and the hive: the same chambers every visit; regrown when
// the hive's tier deepens it) is a layered graph: the mouth, 2–4 chambers a layer, the core. Two routes that share no
// chamber run from the mouth to the core, with side branches, dead ends, pockets and lateral passages that make loops,
// so there is a real choice of which way to go round. Every chamber has a kind (tunnels, galleries, nurseries, egg
// chambers, bone pits, worm pools, the roots of the hive's growths, collapses) and a warmth from its distance to the
// core: the core is the hottest place in the hive, and each passage carries a draft that says whether it leads warmer
// or colder (a team with poor Scouting misreads one now and then: the visit's own dice, hash01, never the world's).
// The brood in a chamber grows with its depth (more of them, tougher, the special dead and the elite deeper; the
// chambers next to the core are the worst) and with the hive's guard horde (hives.js hiveGuard): the guard is the brood
// spread through the den, so each one killed inside takes its share of the guard (cutGuard), and a guard thinned by
// fires outside means emptier chambers. Cleared chambers stay clear for REFILL_DAYS (longer once its eggs are burned),
// then the brood flows back from the guard. The memory is the hive's (hive.denMem), so it is the same for your teams
// and the AI groups' war parties (groupHiveCrawl): the AI groups crawl the same den with the same depth, coarsely.
//
// The team's crawl is plain data on the team (p.hiveCrawl), saved and loaded mid-crawl like the city crawl's p.crawl:
//   { v, hiveId, tile, name, at (the chamber), from, trail (the way back to the mouth), visited, seen, slipped (crept
//     past this visit), alert, enc (what is in front of the team), leaving, kills, lost, log, tally, deepest, started }
// The hive's Alert (0–100) rises with noise (fights, fire, a failed sneak) and fades lying still; from CONVERGE the
// brood converges on the team (a swarm in the chamber, cleared chambers behind it filling again), from BLOCK the
// mouth packs up behind it.
//
// Hooks elsewhere (small): hives.js hiveCard (Enter the hive), parties.js arrive; conflicts.js engagedWith (the crawl
// holds the team); combat.js registerBossAI (the Hivemind's own turn and death), shotPri; defences.js BOSSES.hivemind;
// worm.js (one of the team turning inside); autopilot.js (hiveChoice, idleTeams: hiveCrawlAutoStep, the campaign's
// estimates: crawlEstimate); factions.js groupHiveWar (groupHiveCrawl); ui/hivecrawl.js (the window), ui/hivecrawlsfx.js
// (the pulse and the drone that grow with the warmth), ui/ui.js and main.js.
import { Rng } from "./rng.js";
import { hash01, gainXpAll, USE } from "./skills.js";
import { SUPPLIES } from "./data.js";
import { log, hurt, tickHour, day, snapshot } from "./world.js";
import { partyMembers, partyTile, bestSkill, awaitOrders, wipeParty, tileLabel, teamName, cargoRoom, unitsThatFit } from "./parties.js";
import {
  registerCombatHandler, registerBattleLayout, registerBattleSize, registerBossAI, startCombat, autoResolveCombat, finishCombat, byNumbersOdds,
  say, fx, damage, enemyUnit, active,
} from "./combat.js";
import { fightNow, bossUnit, placeUnitRight } from "./defences.js";
import { hiveById, hiveGuard, broodForce, destroyHive, molotovsOf } from "./hives.js";
import { hiveTier, hiveMods, markThreat, growthsOf, growthById, destroyGrowth } from "./hivetech.js";
import { BOSS_NAMES, GROWTHS, ZTYPES, HIVE } from "./hiveconst.js";
import { applyZType } from "./zombietypes.js";
import { reduceHorde } from "./hordes.js";
import { partyFuel, useFuel } from "./vehicles.js";
import { hiveAllies, broodAfterAllies } from "./alliance.js";
import { lootItem, itemLoad } from "./inventory.js";
import { spend } from "./itemcond.js";
import { wormSearch } from "./worm.js";
import { tacticalStyleFor } from "./breakoff.js";
import { sortFind } from "./ammo.js";
import { nextTurnOf } from "./throwables.js";
import { settleParty, drawTeamShots } from "./ammo.js";
import { fightXp } from "./skills.js";
import { fieldTreatInfo, fieldTreat } from "./medical.js"; // tending the wounded in a quiet chamber
import { absorbOffscreen } from "./armour.js";

// ---------- tuning ----------
export const HCRAWL = {
  DEPTH: [2, 3, 5, 7, 9],       // chambers from the mouth to the core room on the shortest way (moves), by hive tier 0–4
  SPIRE_DEPTH: 1,               // a screamer spire grown at the hive makes it one deeper
  WIDTH: [[2, 2], [2, 3], [2, 3], [2, 4], [3, 4]], // chambers in each layer between the mouth and the core, by tier
  FORWARD: 0.5, LATERAL: 0.3, CROSS: 0.2, POCKET: 0.4, CORE_EXTRA: 0.35, // the den's extra passages and side pockets
  MOVE_HOURS: 1, TREAT_HOURS: 1, FIGHT_HOURS: 1, SNEAK_HOURS: 1, SEARCH_HOURS: 1, BURN_HOURS: 1, LIE_HOURS: 2, BACK_HOURS: 1,
  // The brood in a chamber: (base + perLayer × its layer) × its kind's share × the guard's scale (√(guard / guardRef),
  // within scale), between min and max; × nearCore next to the core. Their power: the hive's brood (hives.js
  // broodForce of the guard, eras.js broodGrowth in it) × (1 + powerPerLayer × layer) × the kind's.
  BROOD: { base: 3, perLayer: 0.9, min: 2, max: 14, powerPerLayer: 0.06, nearCore: 1.3, guardRef: 80, scale: [0.5, 1.8] },
  SPECIAL: { base: 0.08, perLayer: 0.06, max: 0.6 }, // the share of the special dead (the kinds its growths breed) by layer
  ELITE_FROM: 0.6,              // elite brood (a mutation vat) from this share of the depth; always next to the core from tier 3
  REFILL_DAYS: 14, EGG_REFILL: 2, // a cleared chamber fills again after this many days (× EGG_REFILL once its eggs burned)
  // The hive's Alert: start + per visit made lately; noise: move, a fight by the numbers, a fight on the map (+ the
  // shots fired / 20), fire, searching, a failed sneak; decay an hour; lie (lying still). From converge the brood comes
  // (swarm: the chance an hour at 100, rising from converge; refill: a cleared chamber behind you fills again); from
  // block the mouth packs up behind you.
  ALERT: { start: 10, visit: 6, move: 2, fight: 10, mapFight: 6, burn: 12, search: 3, sneakFail: 8, decay: 3, lie: 15, converge: 60, swarm: 0.3, refill: 0.25, block: 85,
    names: ["Dormant", "Stirring", "Restless", "Roused", "Swarming"] },
  // Creeping past a chamber's brood: best Stealth + d10 against dc + perLayer × layer + Alert × perAlert (+ big a
  // person over three, + spotted when they have seen you).
  SNEAK: { dc: 7, perLayer: 0.7, perAlert: 0.05, big: 1, spotted: 4 },
  BACK: { hurt: 0.15, perLayer: 0.03, dmg: [8, 20] }, // falling back from a chamber's brood: each person's risk and wound
  DRAFT: { miss: 0.4, perScout: 0.045, min: 0.03 }, // misreading a draft: miss − perScout × best Scouting, at least min
  BURN: { fuel: 3, molotovs: 1, res: 8, guard: 0.05, growth: 70, wake: 0.3 }, // burning eggs or a growth's root
  BONES: { items: [1, 3], ammo: [6, 20], meds: [0, 3], keys: ["pistol", "revolver", "shotgun", "huntrifle", "machete", "vest", "hikingpack", "bikehelmet", "knife", "ar", "hatchet", "plate", "bat"] },
  POOL_WORM: 2,                 // hours of the worm's exposure (worm.js wormSearch) wading through a worm pool; ×2 searching it
  CORE: { base: 6, perDepth: 0.5, min: 3, max: 16 }, // the brood around the Hivemind (× the guard's scale)
  // A fight in the hive by the numbers (crawlByNumbers), fitted to the same fights played on the cave map by the AI on
  // both sides (6 fighters against 3–16 brood; the team's health lost ≈ k × (their strength / yours)^exp, at most cap;
  // lost: at least lost): the blows spread over the team as on the map (small fights rarely kill; the generic model
  // costs a life in a third of even the smallest fights).
  NUMBERS: { k: 135, exp: 1.9, cap: 340, lost: 260, ambush: 1.3, blow: [8, 30], shots: 3 },
  AUTO: { hurt: 45, treat: 70, fit: 60, sureOdds: 0.8, fightOdds: 0.6, sneakOdds: 0.7, coreFit: 4, wear: 0.04, lie: 70 },
  // The AI groups' crawl (groupHiveCrawl), in the guard's units: the Hivemind and the Broodmother cost boss + bossTier ×
  // tier of a war party's strength on top of the brood on the way and in the core.
  GROUP: { boss: 6, bossTier: 6, depthDiv: 3 },
};
// The Hivemind on the battle map (defences.js BOSSES.hivemind, its turn here): hp + perTier × the hive's tier; every
// turn a pulse within pulse tiles (pulseDmg, stun: the chance to cost the next turn an action) and a lash at someone
// next to it; every spawnEvery turns spawn of the brood from the walls near it, at most cap + capTier × tier in all.
// power: what it counts for by the numbers (with the Broodmother's broodPower).
export const HIVEMIND = { hp: 480, perTier: 60, pulse: 3, pulseDmg: [4, 10], stun: 0.35, lash: [16, 30], spawnEvery: 2, spawn: [2, 3], cap: 8, capTier: 2, power: 18, powerTier: 8, broodPower: 10 };

// The kinds of chamber: name, share of the brood (brood) and its power, the special dead among them (special), what
// can be done there (burn: eggs or a growth's root; search: what lies in it), its battle map size, how it reads.
export const ROOM_KINDS = {
  mouth:    { name: "The mouth", brood: 0.8, power: 1, special: false, size: [28, 16], text: "A wet throat of flesh where the hive swallows the light. The guard shuffles in and out." },
  tunnel:   { name: "Tunnel", brood: 0.7, power: 1, special: true, size: [28, 13], text: "A low, ribbed passage you have to stoop in. It sweats." },
  gallery:  { name: "Gallery", brood: 1, power: 1, special: true, size: [30, 18], text: "A long hall of fused bodies, columns of flesh holding up the roof. The brood rests along the walls." },
  nursery:  { name: "Nursery", brood: 1.4, power: 0.55, special: false, size: [28, 18], text: "Cradles of membrane, and the newly turned crawling out of them: many, but weak." },
  eggs:     { name: "Egg chamber", brood: 0.6, power: 1, special: false, burn: true, size: [26, 16], text: "Amber sacs heaped to the ceiling, something turning inside each. Fire would take them." },
  bones:    { name: "Bone pit", brood: 0.5, power: 1, special: false, search: true, size: [26, 16], text: "Bones picked clean, and among them the packs and guns of the teams that came before you." },
  pool:     { name: "Worm pool", brood: 0.8, power: 1, special: true, search: true, size: [26, 16], text: "Black water to the knee, and it moves. The worm breeds here: every step is a risk." },
  growth:   { name: "Growth root", brood: 1, power: 1, special: true, burn: true, size: [28, 16], text: "The roots of one of the hive's growths reach down here, thick as a man and beating." },
  collapse: { name: "Collapsed tunnel", brood: 0, power: 1, special: false, size: [24, 14], text: "The roof has come down. Rubble and flesh seal the far end: nothing lives here, and there is no way on." },
  core:     { name: "The core", brood: 0, power: 1, special: false, size: [34, 22], text: "The heart of the hive." },
};
const DRAFT_WORD = { warmer: "warmer", colder: "colder", level: "no draft" };

// ---------- helpers ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const seedOf = (...parts) => Math.floor(hash01(...parts) * 4294967296);
const partyById = (state, id) => state.parties.find((x) => x.id === id) || null;
export const alertName = (a) => HCRAWL.ALERT.names[clamp(Math.floor(a / 20), 0, 4)];
const guardSize = (state, hive) => { const g = hiveGuard(state, hive); return g ? g.size : 0; };
function say2(c, text, k = "info", hour = null) {
  c.log.push({ text, k, hour });
  if (c.log.length > 60) c.log.splice(0, c.log.length - 60);
}
const first = (s) => s.name.split(" ")[0];

// ---------- the den ----------
// Its depth: DEPTH by the hive's tier, one more with a screamer spire.
export function denDepth(state, hive) {
  const t = clamp(hiveTier(state, hive), 0, HCRAWL.DEPTH.length - 1);
  return HCRAWL.DEPTH[t] + (hiveMods(state, hive).spire ? HCRAWL.SPIRE_DEPTH : 0);
}
// The hive's den, made on first use (and again, keeping what it remembers, when the hive has grown deeper).
export function denOf(state, hive) {
  const depth = denDepth(state, hive);
  if (hive.den && hive.den.v === 1 && hive.den.depth === depth) return hive.den;
  const grew = !!hive.den;
  hive.den = genDen(state, hive, depth, clamp(hiveTier(state, hive), 0, 4));
  if (grew) hive.den.grew = state.hour;
  return hive.den;
}
export const roomById = (den, id) => den.rooms.find((r) => r.id === id) || null;
// The den's chambers and passages, by the world's seed and the hive (no state dice): the same den every visit.
export function genDen(state, hive, depth, tier) {
  const rng = new Rng(seedOf(state.seed, "hiveden", hive.id, hive.tile, depth));
  const rooms = [];
  const add = (id, layer, slot, kind = null, pocket = false) => { const r = { id, layer, slot, kind, links: [], dist: 0, pocket }; rooms.push(r); return r; };
  const link = (a, b) => { if (!a || !b || a === b || a.links.includes(b.id)) return; a.links.push(b.id); b.links.push(a.id); };
  const mouth = add("m", 0, 0, "mouth");
  const layers = [[mouth]];
  const [wlo, whi] = HCRAWL.WIDTH[tier];
  for (let L = 1; L < depth; L++) {
    const w = rng.int(wlo, whi), row = [];
    for (let s = 0; s < w; s++) row.push(add(`r${L}-${s}`, L, s));
    layers.push(row);
  }
  const core = add("core", depth, 0, "core");
  layers.push([core]);
  // Two routes from the mouth to the core that share no chamber.
  let a = mouth, b2 = mouth;
  const spine = new Set();
  for (let L = 1; L < depth; L++) {
    const row = layers[L];
    const ia = rng.int(0, row.length - 1), ib = (ia + 1 + rng.int(0, row.length - 2)) % row.length;
    link(a, row[ia]); link(b2, row[ib]);
    a = row[ia]; b2 = row[ib];
    spine.add(a.id); spine.add(b2.id);
  }
  link(a, core); link(b2, core);
  // The rest: each chamber reached from the layer before, a way on now and then (else a dead end).
  for (let L = 1; L < depth; L++) {
    for (const r of layers[L]) {
      if (spine.has(r.id)) continue;
      link(r, rng.pick(layers[L - 1]));
      if (rng.chance(HCRAWL.FORWARD)) link(r, L + 1 < depth ? rng.pick(layers[L + 1]) : rng.chance(HCRAWL.CORE_EXTRA) ? core : null);
    }
  }
  // Passages within a layer (loops) and across the routes.
  for (let L = 1; L < depth; L++) {
    const row = layers[L];
    for (let s = 0; s + 1 < row.length; s++) if (rng.chance(HCRAWL.LATERAL)) link(row[s], row[s + 1]);
    if (L + 1 < depth && rng.chance(HCRAWL.CROSS)) link(rng.pick(row), rng.pick(layers[L + 1]));
  }
  // Side pockets: a dead-end chamber off one of the layer's.
  for (let L = 1; L < depth; L++) if (rng.chance(HCRAWL.POCKET)) link(add(`p${L}`, L, layers[L].length, null, true), rng.pick(layers[L]));
  // Distances to the core (the warmth), the way on (dead ends), and the kinds.
  const byId = new Map(rooms.map((r) => [r.id, r]));
  for (const r of rooms) r.dist = Infinity;
  core.dist = 0;
  const q = [core];
  while (q.length) { const r = q.shift(); for (const id of r.links) { const n = byId.get(id); if (n.dist > r.dist + 1) { n.dist = r.dist + 1; q.push(n); } } }
  const growths = growthsOf(state, hive);
  let gi = 0;
  for (const r of rooms) {
    if (r.kind) continue;
    const on = r.links.some((id) => byId.get(id).layer > r.layer);
    r.dead = !on;
    const w = on
      ? { tunnel: 3, gallery: 2.5, nursery: r.layer >= 2 ? 1.5 : 0.4, pool: r.layer >= 2 ? 1 : 0.3, eggs: 1, growth: growths.length ? 1.2 : 0, bones: 0.6 }
      : { bones: 2, eggs: 1.5, collapse: 1.5, pool: 1, nursery: 0.5, growth: growths.length ? 0.8 : 0 };
    r.kind = rng.weighted(Object.keys(w), (k) => w[k]);
    if (r.kind === "growth") { const g = growths[gi++ % growths.length]; r.gid = g.id; r.gkind = g.kind; }
  }
  return { v: 1, depth, tier, mouth: mouth.id, core: core.id, width: Math.max(...layers.map((l) => l.length)) + 1, rooms };
}
// The chamber next to the core (its brood is the worst).
const nearCore = (den, room) => room.links.includes(den.core);
// The shortest way from a chamber to the core, by the distances (ids, the core last).
export function shortestPath(den, fromId = den.mouth) {
  const out = [];
  let r = roomById(den, fromId);
  while (r) {
    out.push(r.id);
    if (r.id === den.core) break;
    const next = r.links.map((id) => roomById(den, id)).filter((n) => n.dist < r.dist).sort((a, b) => a.dist - b.dist || a.id.localeCompare(b.id))[0];
    r = next || null;
  }
  return out;
}
// Warmth 0–100: the core 100, falling with the distance to it (the mouth 100 / (depth + 1)).
export const warmthOf = (den, room) => (room ? clamp(Math.round(100 * (1 - room.dist / (den.depth + 1))), 0, 100) : 0);
export function warmthText(w) {
  return w >= 90 ? "the walls sweat and the air is hot and thick; something vast beats close by" : w >= 70 ? "hot: the walls pulse under your hand" : w >= 50 ? "warm as breath" : w >= 30 ? "close and clammy" : "cool and damp";
}
export const roomName = (room, state = null) => {
  if (!room) return "?";
  if (room.kind === "growth" && room.gkind && GROWTHS[room.gkind]) return `Root of the ${GROWTHS[room.gkind].name.toLowerCase()}`;
  return ROOM_KINDS[room.kind] ? ROOM_KINDS[room.kind].name : room.kind;
};

// "the tunnel", "the mouth", "the root of the brood chamber".
export const roomThe = (room) => { const n = roomName(room); return /^The /.test(n) ? n.toLowerCase() : `the ${n.toLowerCase()}`; };

// ---------- the brood ----------
const memOf = (hive) => hive.denMem || (hive.denMem = { rooms: {}, searched: {}, visits: 0, lastAlert: 0, lastHour: 0 });
export const guardScale = (G) => (G > 0 ? clamp(Math.sqrt(G / HCRAWL.BROOD.guardRef), HCRAWL.BROOD.scale[0], HCRAWL.BROOD.scale[1]) : 0);
// A chamber's brood when it is full, with a guard of G.
export function roomFull(state, hive, den, room, G = guardSize(state, hive)) {
  const K = ROOM_KINDS[room.kind];
  if (!K || !K.brood) return 0;
  const s = guardScale(G);
  if (!s) return 0;
  const B = HCRAWL.BROOD;
  let n = (B.base + B.perLayer * room.layer) * K.brood * s;
  if (nearCore(den, room)) n *= B.nearCore;
  return clamp(Math.round(n), B.min, B.max);
}
// Their power, with a guard of G.
export function roomPower(state, hive, den, room, G = guardSize(state, hive)) {
  const K = ROOM_KINDS[room.kind] || ROOM_KINDS.tunnel;
  return Math.round(broodForce(Math.max(HIVE.GUARD_MIN, G), state).power * (1 + HCRAWL.BROOD.powerPerLayer * room.layer) * (K.power || 1) * (nearCore(den, room) ? 1.1 : 1) * 10) / 10;
}
// The brood in a chamber now: full, or what was left the last time anyone fought there (it refills after REFILL_DAYS).
export function broodLeft(state, hive, room, G = guardSize(state, hive)) {
  const den = denOf(state, hive);
  const full = roomFull(state, hive, den, room, G);
  const mem = memOf(hive);
  const m = mem.rooms[room.id];
  if (!m) return full;
  const eggs = mem.eggsBurned != null && state.hour - mem.eggsBurned < HCRAWL.REFILL_DAYS * 48 ? 1.5 : 1; // its eggs burned lately: slower everywhere
  const refill = HCRAWL.REFILL_DAYS * 24 * (m.burned ? HCRAWL.EGG_REFILL : 1) * eggs;
  if (state.hour - m.at >= refill && G >= HIVE.GUARD_MIN * 0.5) { delete mem.rooms[room.id]; return full; }
  return Math.min(full, m.left);
}
function setLeft(state, hive, room, n) {
  const mem = memOf(hive);
  const was = mem.rooms[room.id];
  mem.rooms[room.id] = { left: Math.max(0, Math.round(n)), at: state.hour, burned: !!(was && was.burned) };
}
// The special dead among n brood at a layer: the kinds the hive's growths breed, a share rising with the depth.
function broodTypes(state, hive, n, layer) {
  const kinds = hiveMods(state, hive).unlocks;
  if (!kinds.length || n < 2) return null;
  const S = HCRAWL.SPECIAL;
  const k = Math.round(n * Math.min(S.max, S.base + S.perLayer * layer));
  if (k <= 0) return null;
  const out = {};
  for (let i = 0; i < k; i++) { const kind = kinds[(i + layer) % kinds.length]; out[kind] = (out[kind] || 0) + 1; }
  return out;
}
// What fights in a chamber: { count, power, types, elite, name } (count: what is left in it now, or `count`).
export function roomForce(state, hive, room, count = null) {
  const den = denOf(state, hive);
  const n = count ?? broodLeft(state, hive, room);
  const K = ROOM_KINDS[room.kind] || ROOM_KINDS.tunnel;
  const mods = hiveMods(state, hive);
  const elite = (mods.elite && room.layer >= den.depth * HCRAWL.ELITE_FROM) || (nearCore(den, room) && den.tier >= 3);
  return { count: n, power: roomPower(state, hive, den, room), types: K.special ? broodTypes(state, hive, n, room.layer) : null, elite, name: `the brood in ${roomThe(room)}` };
}
// The core room: the brood around the Hivemind (× the guard's scale), the Hivemind (hp by the tier) and the Broodmother.
// bossPower: what the two count for by the numbers.
export function coreForce(state, hive, G = guardSize(state, hive)) {
  const den = denOf(state, hive);
  const C = HCRAWL.CORE, s = guardScale(G);
  const count = s ? clamp(Math.round((C.base + C.perDepth * den.depth) * s), C.min, C.max) : 0;
  const power = Math.round(broodForce(Math.max(HIVE.GUARD_MIN, G), state).power * (1 + HCRAWL.BROOD.powerPerLayer * den.depth) * 10) / 10;
  return {
    count, power, types: broodTypes(state, hive, count, den.depth), elite: hiveMods(state, hive).elite, tier: den.tier, depth: den.depth,
    hp: HIVEMIND.hp + HIVEMIND.perTier * den.tier, bossPower: HIVEMIND.power + HIVEMIND.powerTier * den.tier + HIVEMIND.broodPower,
  };
}
// Every brood of the den when full (the core's too): the guard spread through it (cutGuard).
export function denBroodTotal(state, hive, G = guardSize(state, hive)) {
  const den = denOf(state, hive);
  return den.rooms.reduce((a, r) => a + roomFull(state, hive, den, r, G), 0) + coreForce(state, hive, G).count;
}
// Brood killed in the den: each takes its share of the guard horde. Returns the guard lost.
export function cutGuard(state, hive, killed) {
  const g = hiveGuard(state, hive);
  if (!g || !(killed > 0)) return 0;
  const per = g.size / Math.max(1, denBroodTotal(state, hive, g.size));
  const n = Math.min(g.size, Math.round(killed * per));
  if (n > 0) reduceHorde(state, g, n);
  return n;
}
// Allied fighters at the hive (alliance.js hiveAllies): in a chamber each keeps one off your squad (at most 40%).
const alliedThin = (count, fighters) => count - Math.min(fighters, Math.floor(count * 0.4));

// ---------- the team's crawl ----------
// The team's crawl, checked: a team gone, dead or away from the hive's tile loses it; a hive gone ends it.
export function hiveCrawlOf(state, p) {
  if (!p || !p.hiveCrawl) return null;
  const c = p.hiveCrawl;
  if (!state.parties.includes(p) || !partyMembers(state, p).length || partyTile(p) !== c.tile) { delete p.hiveCrawl; return null; }
  const hive = hiveById(state, c.hiveId);
  if (!hive) {
    delete p.hiveCrawl;
    if (!(state.combat && state.combat.setup && state.combat.setup.partyId === p.id)) awaitOrders(state, p, "The hive is dead around the team: it walks out through still flesh.");
    return null;
  }
  if (p.phase !== "engaged") p.phase = "engaged";
  return c;
}
// The crawl the window shows: the first of your teams in one, not while its battle is on.
export function activeHiveCrawl(state) {
  for (const p of state.parties) {
    if (p.owner !== "player" || !p.hiveCrawl) continue;
    if (state.combat && state.combat.setup && state.combat.setup.partyId === p.id) continue;
    if (hiveCrawlOf(state, p)) return p;
  }
  return null;
}
export const crawlHive = (state, c) => hiveById(state, c.hiveId);
export const crawlRoom = (state, c) => { const h = crawlHive(state, c); return h ? roomById(denOf(state, h), c.at) : null; };

// Into the hive (the hive card's Enter the hive): at its mouth, the brood of the mouth in front.
export function startHiveCrawl(state, p, hive) {
  const den = denOf(state, hive);
  const mem = memOf(hive);
  mem.visits += 1;
  const left = Math.max(0, (mem.lastAlert || 0) - (state.hour - (mem.lastHour || 0)));
  p.phase = "engaged";
  p.hiveCrawl = {
    v: 1, hiveId: hive.id, tile: hive.tile, name: hive.name, visit: mem.visits, started: state.hour,
    at: den.mouth, from: null, trail: [den.mouth], visited: { [den.mouth]: true }, seen: {}, slipped: {},
    alert: clamp(Math.round(Math.max(HCRAWL.ALERT.start, left)), 0, 100), enc: null, leaving: false, deepest: 0,
    kills: 0, lost: [], log: [], tally: { supplies: {}, gear: [] }, hadVehicle: !!p.vehicle,
  };
  const c = p.hiveCrawl;
  markSeen(den, c, den.mouth);
  markThreat(state, hive); // hivetech.js: it builds for defence
  hive.playerDay = day(state); // hives.js notePlayerFight: a group fighting it warms to you
  const mouth = roomById(den, den.mouth);
  say2(c, `${teamName(state, p)} ${partyMembers(state, p).length === 1 ? "goes" : "go"} into ${hive.name}. ${den.grew ? "It has grown deeper since anyone was last inside. " : ""}The air is ${warmthText(warmthOf(den, mouth))}.`, "info", state.hour);
  log(state, `${teamName(state, p)} crawls into ${hive.name}.`, "info");
  enterRoom(state, p, c, mouth, null);
  return true;
}
const markSeen = (den, c, id) => { const r = roomById(den, id); if (r) for (const n of r.links) c.seen[n] = true; };

// The team walks into a chamber: what waits there.
function enterRoom(state, p, c, room, from) {
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  c.from = from;
  c.at = room.id;
  const i = c.trail.indexOf(room.id);
  if (i >= 0) c.trail.length = i + 1; else c.trail.push(room.id);
  const fresh = !c.visited[room.id];
  c.visited[room.id] = true;
  markSeen(den, c, room.id);
  c.deepest = Math.max(c.deepest, room.layer);
  if (room.kind === "core") {
    const f = coreForce(state, hive);
    c.enc = { kind: "core", room: room.id, back: from, spotted: true };
    say2(c, `The core. ${f.count ? `${f.count} of the brood stand` : "Nothing stands"} between you and the ${BOSS_NAMES.hivemind}: a hill of flesh that fills the end of the chamber and beats like a heart, the ${BOSS_NAMES.hive} at its foot.`, "danger", state.hour);
    return;
  }
  const n = broodLeft(state, hive, room);
  const K = ROOM_KINDS[room.kind];
  const look = `${roomName(room)}: ${fresh ? K.text + " " : ""}The air is ${warmthText(warmthOf(den, room))}.`;
  if (n > 0 && !c.slipped[room.id]) {
    const spotted = c.alert >= 50 && hash01(state.seed, "hcspot", c.hiveId, room.id, c.visit, state.hour) < (c.alert - 40) / 100;
    c.enc = { kind: "brood", room: room.id, back: from, spotted };
    say2(c, `${look} ${n} of the brood${spotted ? " have seen you and turn" : " are here"}.`, spotted ? "danger" : "info", state.hour);
  } else say2(c, `${look}${n > 0 ? ` The brood you crept past are still here (${n}).` : ""}`, "info", state.hour);
}

// Hours pass on the shared clock: the Alert fades, and a roused hive comes for the team. False: the team is gone.
function passHours(state, p, hours) {
  const c = p.hiveCrawl;
  for (let i = 0; i < hours; i++) {
    tickHour(state);
    if (!state.parties.includes(p) || !partyMembers(state, p).length) return false;
    if (!p.hiveCrawl) return true; // the hive died meanwhile (an AI group's war party): hiveCrawlOf ends it
    c.alert = Math.max(0, c.alert - HCRAWL.ALERT.decay);
    converge(state, p, c);
  }
  return true;
}
const addAlert = (c, v) => { c.alert = clamp(c.alert + v, 0, 100); };
// From ALERT.converge the brood comes for the team (an hour's roll): a swarm into its chamber, cleared chambers on the
// way back filling again; from ALERT.block the mouth packs up.
function converge(state, p, c) {
  const A = HCRAWL.ALERT;
  if (c.alert < A.converge || c.enc || state.combat) return;
  const hive = crawlHive(state, c);
  if (!hive) return;
  const den = denOf(state, hive);
  const rng = state.rng;
  const over = (c.alert - A.converge) / (100 - A.converge);
  if (rng.chance(A.refill * (0.5 + over))) {
    const back = c.trail.slice(0, -1).map((id) => roomById(den, id)).filter((r) => r && broodLeft(state, hive, r) === 0 && roomFull(state, hive, den, r) > 0);
    if (back.length) {
      const r = rng.pick(back);
      setLeft(state, hive, r, Math.ceil(roomFull(state, hive, den, r) / 2));
      say2(c, `Behind you the brood is flowing back into ${roomThe(r)}.`, "danger", state.hour);
    }
  }
  if (c.alert >= A.block) {
    const m = roomById(den, den.mouth);
    if (broodLeft(state, hive, m) === 0 && roomFull(state, hive, den, m) > 0 && c.at !== den.mouth) { setLeft(state, hive, m, roomFull(state, hive, den, m)); say2(c, "The hive is roused: the brood has packed the mouth behind you.", "danger", state.hour); }
  }
  if (rng.chance(A.swarm * over)) {
    const room = roomById(den, c.at);
    const n = clamp(Math.round(2 + room.layer * 0.5 + (c.alert - A.converge) / 10), 2, 12);
    c.enc = { kind: "swarm", room: room.id, back: c.from, spotted: true, enemy: { kind: "zombies", count: n, power: roomPower(state, hive, den, room), types: broodTypes(state, hive, n, room.layer + 1), elite: false, name: "the brood converging on you" } };
    say2(c, `The hive is roused: ${n} of the brood pour into ${roomThe(room)} from the dark.`, "danger", state.hour);
  }
}

// The passages out of the team's chamber: { id, room (null: not been there), draft (as the team reads it), visited,
// dist (the real one, for the tools) }.
export function exitsOf(state, p) {
  const c = hiveCrawlOf(state, p);
  if (!c) return [];
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const here = roomById(den, c.at);
  return here.links.map((id) => {
    const r = roomById(den, id);
    return { id, room: c.visited[id] ? r : null, kind: c.visited[id] ? r.kind : null, draft: draftOf(state, p, c, den, here, r), visited: !!c.visited[id], back: id === c.from, core: id === den.core && !!c.visited[id] };
  });
}
// The draft from a passage as the team reads it: warmer, colder or level; misread now and then by a team without a
// good scout (the visit's own dice: the same reading every time this visit).
export function draftOf(state, p, c, den, from, to) {
  const d = warmthOf(den, to) - warmthOf(den, from);
  let w = d > 0 ? "warmer" : d < 0 ? "colder" : "level";
  if (c.visited[to.id]) return w; // been there: no guessing
  if (hash01(state.seed, "hcdraft", c.hiveId, from.id, to.id, c.visit) < draftMiss(state, p)) w = w === "warmer" ? "colder" : "warmer";
  return w;
}
export const draftMiss = (state, p) => Math.max(HCRAWL.DRAFT.min, HCRAWL.DRAFT.miss - HCRAWL.DRAFT.perScout * bestSkill(state, p, "scouting"));
export const draftWord = (w) => DRAFT_WORD[w] || w;
// Can the team move on from its chamber (no brood in it, or it crept past)?
export function canMoveOn(state, c) {
  if (c.enc) return false;
  const hive = crawlHive(state, c);
  const room = roomById(denOf(state, hive), c.at);
  return broodLeft(state, hive, room) === 0 || !!c.slipped[room.id];
}

// Move to a chamber next to this one (an hour).
export function moveTo(state, p, id) {
  const c = hiveCrawlOf(state, p);
  if (!c) return "The team is not in a hive.";
  if (c.enc) return "Deal with what is in front of you first.";
  if (c.leaving) return "The team is on its way out.";
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const here = roomById(den, c.at);
  const to = roomById(den, id);
  if (!to || !here.links.includes(id)) return "No passage leads there.";
  if (!canMoveOn(state, c) && id !== c.from) return "The brood is still in this chamber: fight it, creep past, or go back the way you came.";
  addAlert(c, HCRAWL.ALERT.move);
  if (!passHours(state, p, HCRAWL.MOVE_HOURS)) return goneText(state, p);
  if (!p.hiveCrawl) return "";
  if (c.enc) return ""; // the brood came for you on the way (converge)
  if (to.kind === "pool") wormSearch(state, p, c.tile, HCRAWL.POOL_WORM); // worm.js: wading through it
  enterRoom(state, p, c, to, here.id);
  return "";
}

// ---------- in front of the team ----------
// The fight's setup for an encounter: a chamber's brood, a swarm, the turned, or the core.
function encSetup(state, p, c, e) {
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const room = roomById(den, e.room) || roomById(den, c.at);
  if (e.kind === "core") return coreSetup(state, p, hive, true);
  const f = e.enemy || roomForce(state, hive, room);
  const count = e.kind === "brood" ? alliedThin(f.count, hiveAllies(state, hive).fighters) : f.count;
  const K = ROOM_KINDS[room.kind] || ROOM_KINDS.tunnel;
  return {
    tile: hive.tile, partyId: p.id, ambush: e.spotted ? "enemy" : null, canRetreat: true, handler: "hiveChamber", layout: "hivechamber",
    enemy: { kind: "zombies", count: Math.max(1, count), power: f.power, types: f.types && count !== f.count ? broodTypes(state, hive, count, room.layer) : f.types, elite: !!f.elite, name: f.name },
    aiStyle: tacticalStyleFor(state, p), // played headless: the team's retreat policy (breakoff.js)
    context: { hiveCrawl: { hiveId: hive.id, room: room.id, kind: e.kind, size: K.size, layer: room.layer, warmth: warmthOf(den, room), met: count } },
  };
}
// The odds and the answers to what is in front of the team (the window and the autopilot).
export function encounterOptions(state, p) {
  const c = hiveCrawlOf(state, p);
  const e = c && c.enc;
  if (!e || e.fighting) return [];
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const room = roomById(den, e.room) || roomById(den, c.at);
  const setup = encSetup(state, p, c, e);
  const odds = byNumbersOdds(state, setup);
  const out = [];
  if (e.kind === "core") {
    out.push({ id: "fight", label: `Fight the ${BOSS_NAMES.hivemind} (battle map)`, tip: `The core room: ${setup.enemy.count} of the brood, the ${BOSS_NAMES.hive} and the ${BOSS_NAMES.hivemind} (it never moves: it pulses, lashes out and calls brood out of the walls). Kill it and the hive dies, its brood with it. By the numbers about ${Math.round(odds.win * 100)}%.`, odds: odds.win });
    out.push({ id: "numbers", label: "Fight it by the numbers", tip: `Quick: about ${Math.round(odds.win * 100)}% to win. A lost fight here can cost everyone.`, odds: odds.win });
  } else {
    out.push({ id: "fight", label: "Fight (battle map)", tip: `Fight the brood in ${roomThe(room)}. By the numbers you would win about ${Math.round(odds.win * 100)}%. Noise: Alert +${HCRAWL.ALERT.mapFight} and more with every shot.`, odds: odds.win });
    out.push({ id: "numbers", label: "Fight by the numbers", tip: `Quick: about ${Math.round(odds.win * 100)}% to win (Alert +${HCRAWL.ALERT.fight}).`, odds: odds.win });
    if (e.kind !== "turned") { const s = sneakOdds(state, p, c, room, e); out.push({ id: "sneak", label: e.kind === "swarm" ? "Hide from them" : "Creep past", tip: `Stealth ${bestSkill(state, p, "stealth")} + d10 against ${s.dc}: about ${Math.round(s.p * 100)}%. An hour. Fail and they fall on you first (Alert +${HCRAWL.ALERT.sneakFail}).${e.kind === "brood" ? " Past them you can go on, but they stay: on the way back you meet them again." : ""}`, odds: s.p }); }
  }
  if (e.back || e.kind === "core") out.push({ id: "back", label: "Fall back", tip: `Back to the chamber you came from (an hour): each of you about ${Math.round(backHurt(room) * 100)}% to be hurt getting away.`, odds: 1 });
  else out.push({ id: "out", label: "Get out of the hive", tip: `Back out through the mouth: each of you about ${Math.round(backHurt(room) * 100)}% to be hurt getting away.`, odds: 1 });
  return out;
}
const backHurt = (room) => Math.min(0.9, HCRAWL.BACK.hurt + HCRAWL.BACK.perLayer * (room ? room.layer : 0));
export function sneakOdds(state, p, c, room, e = c.enc) {
  const S = HCRAWL.SNEAK;
  const n = partyMembers(state, p).length;
  const dc = Math.ceil(S.dc + S.perLayer * room.layer + c.alert * S.perAlert + Math.max(0, n - 3) * S.big + (e && e.spotted ? S.spotted : 0));
  return { dc, p: clamp((bestSkill(state, p, "stealth") + 10 - dc + 1) / 10, 0, 1) };
}
// The answer. opts.map: a fight on the battle map (the browser), else by the numbers.
export function resolveHiveEnc(state, p, choice, opts = {}) {
  const c = hiveCrawlOf(state, p);
  if (!c || !c.enc) return "Nothing to answer.";
  const e = c.enc;
  if (e.fighting) return "The fight is on.";
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const room = roomById(den, e.room) || roomById(den, c.at);
  const rng = state.rng;
  if (choice === "fight" || choice === "numbers") {
    if (e.kind === "core") { c.enc = { ...e, fighting: true }; assaultHive(state, p, hive, { map: choice === "fight" && opts.map, quick: choice === "numbers" }); return ""; }
    const setup = encSetup(state, p, c, e);
    c.enc = { ...e, fighting: true };
    if (choice === "fight" && opts.map && typeof window !== "undefined" && !state.autoCombat && !state.combat) { onFoot(p, () => startCombat(state, setup)); return ""; }
    const res = crawlByNumbers(state, setup);
    finishCombat(state, setup, res);
    return res.outcome === "victory" ? "The chamber is yours." : res.outcome === "retreat" ? "You broke off and fell back." : "It went badly.";
  }
  if (choice === "sneak") {
    const s = sneakOdds(state, p, c, room, e);
    if (!passHours(state, p, HCRAWL.SNEAK_HOURS)) return goneText(state, p);
    if (!p.hiveCrawl) return "";
    if (rng.chance(s.p)) {
      gainXpAll(state, partyMembers(state, p), "stealth", USE.sneakSearch);
      c.enc = null;
      if (e.kind === "brood") { c.slipped[room.id] = true; say2(c, `You creep along the wall of ${roomThe(room)} past the brood. They never turn.`, "good", state.hour); }
      else say2(c, "You press into a fold of the wall and they flow past you.", "good", state.hour);
      return "You got past.";
    }
    addAlert(c, HCRAWL.ALERT.sneakFail);
    c.enc = { ...e, spotted: true };
    say2(c, "They have seen you! No slipping away now.", "danger", state.hour);
    return "They saw you.";
  }
  if (choice === "back" || choice === "out") {
    const hit = [];
    for (const s of partyMembers(state, p)) {
      if (!rng.chance(backHurt(room))) continue;
      hurt(state, s, rng.int(HCRAWL.BACK.dmg[0], HCRAWL.BACK.dmg[1]) + room.layer, c.tile, `falling back through ${hive.name}`);
      hit.push(s.alive ? first(s) : `${s.name} (killed)`);
      if (!s.alive) c.lost.push(s.name);
    }
    say2(c, `You fall back.${hit.length ? ` Hurt on the way: ${hit.join(", ")}.` : " Everyone gets clear."}`, hit.length ? "danger" : "info", state.hour);
    if (!partyMembers(state, p).length) { crawlWiped(state, p, ""); return "Nobody got away."; }
    c.enc = null;
    if (!passHours(state, p, HCRAWL.BACK_HOURS)) return goneText(state, p);
    if (!p.hiveCrawl) return "";
    if (choice === "out" || !e.back) return finishHiveCrawl(state, p, "The team fell back out of the hive.");
    const to = roomById(den, e.back);
    c.trail = c.trail.filter((id) => id !== room.id);
    c.from = c.trail.length > 1 ? c.trail[c.trail.length - 2] : null;
    c.at = to.id;
    if (c.trail[c.trail.length - 1] !== to.id) c.trail.push(to.id);
    if (broodLeft(state, hive, to) > 0 && !c.slipped[to.id]) enterRoom(state, p, c, to, c.from); // it filled again behind you
    return "You fell back.";
  }
  return "Unknown choice.";
}
// A fight in the hive by the numbers (a chamber's brood, a swarm, the core): the odds as byNumbersOdds gives them, the
// blood fitted to the cave map (NUMBERS). A lost fight: the team breaks off and gets out of the chamber (retreat) with
// what it costs. Returns a result for combat.js finishCombat.
export function crawlByNumbers(state, setup) {
  const N = HCRAWL.NUMBERS, rng = state.rng;
  const p = partyById(state, setup.partyId);
  const people = p ? partyMembers(state, p).filter((s) => s.alive) : [];
  if (!people.length) return autoResolveCombat(state, setup);
  settleParty(state, p); // ammo.js: rounds by calibre
  const pools = [p.supplies, p.cargo ? p.cargo.supplies : {}];
  const drawn = drawTeamShots(pools, people, Math.min(people.length * 6, Math.ceil(setup.enemy.count * N.shots)));
  const odds = byNumbersOdds(state, setup, people, /** @type {any} */ ({ ammo: drawn.used, arrows: 0 })); // the rounds drawn, by calibre (as autoResolveCombat)
  const win = rng.chance(odds.win);
  let dmg = Math.min(N.cap, N.k * Math.max(0.05, odds.ratio) ** -N.exp) * rng.range(0.6, 1.4);
  if (!win) dmg = Math.max(dmg, N.lost * clamp(1 / Math.max(0.05, odds.ratio), 0.6, 1.3)) * rng.range(0.9, 1.2);
  if (setup.ambush === "enemy") dmg *= N.ambush;
  const tile = partyTile(p);
  const cause = `in a fight with ${setup.enemy.name}`;
  const hurtIds = new Set(), deadIds = [];
  while (dmg >= 1) {
    const left = people.filter((s) => s.alive);
    if (!left.length) break;
    const s = rng.pick(left);
    const blow = Math.min(Math.round(dmg), rng.int(N.blow[0], N.blow[1]));
    dmg -= blow;
    hurt(state, s, blow, tile, cause);
    if (s.alive) { absorbOffscreen(s, blow, "zombies", state); hurtIds.add(s.id); } else if (!deadIds.includes(s.id)) deadIds.push(s.id);
  }
  fightXp(state, people, win);
  const count = setup.enemy.count;
  const killed = win ? count : Math.floor(count * rng.range(0.2, 0.6));
  const standing = people.some((s) => s.alive);
  return {
    outcome: win ? "victory" : standing ? "retreat" : "defeat", enemiesKilled: killed, enemiesLeft: count - killed,
    survivorsHurt: [...hurtIds].filter((id) => !deadIds.includes(id)), survivorsDead: deadIds, ammoUsed: drawn.n, arrowsUsed: 0, loot: { supplies: {}, gear: [] }, odds: odds.win,
  };
}
// A battle with the team's vehicle left at the mouth (none on a cave map).
function onFoot(p, fn) { const v = p.vehicle; p.vehicle = null; try { return fn(); } finally { p.vehicle = v; } }

// A chamber fight is over (combat.js finishCombat): on the map or by the numbers.
registerCombatHandler("hiveChamber", (state, result, setup, battle) => {
  const p = partyById(state, setup.partyId);
  const ctx = (setup.context && setup.context.hiveCrawl) || {};
  const hive = hiveById(state, ctx.hiveId);
  const killed = Math.min(result.enemiesKilled || 0, ctx.met || setup.enemy.count);
  if (hive) {
    const den = denOf(state, hive);
    const room = roomById(den, ctx.room);
    if (room && ctx.kind === "brood") {
      const left = broodLeft(state, hive, room);
      setLeft(state, hive, room, result.outcome === "victory" ? 0 : Math.max(0, left - killed));
    }
    cutGuard(state, hive, killed);
    hive.playerDay = day(state);
    markThreat(state, hive);
  }
  if (!p || !state.parties.includes(p)) return;
  if (!partyMembers(state, p).length) { crawlWiped(state, p, `Killed by ${setup.enemy.name}.`); return; }
  const c = p.hiveCrawl;
  if (!c) { awaitOrders(state, p, "The team is out of the fight."); return; }
  c.kills += killed;
  for (const id of result.survivorsDead || []) { const s = state.survivors.find((x) => x.id === id); if (s) c.lost.push(s.name); }
  addAlert(c, battle ? HCRAWL.ALERT.mapFight + (result.ammoUsed || battle.gunshots || 0) / 20 : HCRAWL.ALERT.fight);
  const dead = (result.survivorsDead || []).map((id) => state.survivors.find((x) => x.id === id)?.name).filter(Boolean);
  const won = result.outcome === "victory";
  say2(c, `Fight with ${setup.enemy.name}${result.odds != null ? ` (${Math.round(result.odds * 100)}% odds)` : ""}: ${won ? "won" : result.outcome === "retreat" ? "broke off" : "lost"} (${killed} killed).${dead.length ? ` Killed: ${dead.join(", ")}.` : ""}`, won ? "good" : "danger", state.hour);
  const e = c.enc || { kind: ctx.kind, room: ctx.room, back: c.from };
  c.enc = null;
  if (!passHours(state, p, HCRAWL.FIGHT_HOURS)) { goneText(state, p); return; }
  if (!p.hiveCrawl) return;
  if (won) return;
  // Broken off or beaten back: to the chamber the team came from, or out of the hive from the mouth.
  if (!e.back) { finishHiveCrawl(state, p, "Beaten back, the team stumbled out of the hive."); return; }
  const den = denOf(state, hive);
  c.trail = c.trail.filter((id) => id !== e.room);
  c.at = e.back;
  if (c.trail[c.trail.length - 1] !== e.back) c.trail.push(e.back);
  c.from = c.trail.length > 1 ? c.trail[c.trail.length - 2] : null;
  say2(c, `You fall back to ${roomThe(roomById(den, e.back))}.`, "danger", state.hour);
});

// ---------- in a chamber ----------
// What the team can do in its chamber besides moving: [{ id, label, tip, disabled }].
export function roomActions(state, p) {
  const c = hiveCrawlOf(state, p);
  if (!c || c.enc) return [];
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const room = roomById(den, c.at);
  const K = ROOM_KINDS[room.kind] || {};
  const clear = broodLeft(state, hive, room) === 0;
  const mem = memOf(hive);
  const out = [];
  if (K.burn) {
    const burned = mem.rooms[room.id] && mem.rooms[room.id].burned;
    const fuel = partyFuel(state, p), bombs = molotovsOf(state, p).length;
    const g = room.kind === "growth" ? growthById(state, room.gid) : null;
    const what = room.kind === "eggs" ? "the eggs" : g ? `the root of the ${GROWTHS[g.kind].name.toLowerCase()}` : "the withered root";
    const can = clear && !burned && (bombs >= HCRAWL.BURN.molotovs || fuel >= HCRAWL.BURN.fuel) && (room.kind === "eggs" || !!g);
    out.push({ id: "burn", label: `Burn ${what}`, disabled: !can,
      tip: !clear ? "Not with the brood still in the chamber." : burned ? "Burned already." : room.kind === "growth" && !g ? "The growth it fed is gone." : `${bombs >= HCRAWL.BURN.molotovs ? `${HCRAWL.BURN.molotovs} Molotov` : `${HCRAWL.BURN.fuel} fuel`} (the team has ${fuel} fuel, ${bombs} Molotovs). ${room.kind === "eggs" ? `The hive loses ${HCRAWL.BURN.res} of its stores and some of its guard, and its chambers fill again more slowly.` : `${HCRAWL.BURN.growth} damage to the growth above (it has ${Math.round(g ? g.hp ?? 100 : 0)}).`} Loud: Alert +${HCRAWL.ALERT.burn}, and the brood nearby may come.` });
  }
  if (K.search) {
    const done = !!mem.searched[`${room.id}:${c.visit}`] || (room.kind === "bones" && !!mem.searched[room.id]);
    out.push({ id: "search", label: room.kind === "bones" ? "Search the bones" : "Feel through the pool", disabled: !clear || done,
      tip: !clear ? "Not with the brood still in the chamber." : done ? "Searched." : room.kind === "bones" ? "An hour among the remains of the teams that came before: their guns, armour and packs (worn), ammunition and meds." : "An hour up to the elbows in the black water: now and then something someone dropped. The worm's eggs are thick here." });
  }
  const tend = partyMembers(state, p).filter((s) => fieldTreatInfo(state, p, s).ok);
  out.push({ id: "treat", label: `Tend the wounded (${HCRAWL.TREAT_HOURS} h)`, disabled: !tend.length,
    tip: tend.length ? `Field treatment with the team's meds for ${tend.map(first).join(", ")} (each once a day: medical.js, as on the road).` : "Nobody the team can treat here now (not hurt, treated today, or no meds)." });
  out.push({ id: "lie", label: `Lie still (${HCRAWL.LIE_HOURS} h)`, disabled: false, tip: `Wait in the dark: the Alert falls by ${HCRAWL.ALERT.lie + HCRAWL.ALERT.decay * HCRAWL.LIE_HOURS}. ${c.alert >= 40 ? "Something may still find you." : ""}` });
  return out;
}
export function roomAct(state, p, id) {
  const c = hiveCrawlOf(state, p);
  if (!c) return "The team is not in a hive.";
  if (c.enc) return "Deal with what is in front of you first.";
  const act = roomActions(state, p).find((a) => a.id === id);
  if (!act || act.disabled) return act ? act.tip : "Not here.";
  if (id === "burn") return burnRoom(state, p, c);
  if (id === "search") return searchRoom(state, p, c);
  if (id === "lie") return lieStill(state, p, c);
  if (id === "treat") return tendWounded(state, p, c);
  return "";
}
function burnRoom(state, p, c) {
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const room = roomById(den, c.at);
  const bombs = molotovsOf(state, p);
  if (bombs.length >= HCRAWL.BURN.molotovs) for (const b of bombs.slice(0, HCRAWL.BURN.molotovs)) b.take();
  else useFuel(state, p, HCRAWL.BURN.fuel);
  const mem = memOf(hive);
  mem.rooms[room.id] = { ...(mem.rooms[room.id] || { left: 0, at: state.hour }), burned: true };
  let text;
  if (room.kind === "eggs") {
    hive.res = Math.max(0, hive.res - HCRAWL.BURN.res);
    const g = hiveGuard(state, hive);
    if (g) reduceHorde(state, g, Math.round(g.size * HCRAWL.BURN.guard));
    mem.eggsBurned = state.hour;
    text = "The sacs blister and burst. The stink of burning brood fills the tunnels; the hive will be slower to fill its chambers.";
  } else {
    const g = growthById(state, room.gid);
    if (g) {
      g.hp = Math.max(0, (g.hp ?? 100) - HCRAWL.BURN.growth);
      if (g.hp <= 0) { destroyGrowth(state, g, "from inside its hive"); text = `The root chars and splits. Above you the ${GROWTHS[g.kind].name.toLowerCase()} shrivels.`; }
      else text = `The root blackens: the ${GROWTHS[g.kind].name.toLowerCase()} above is hurt (${Math.round(g.hp)}% left) and will grow back.`;
    } else text = "Nothing left to burn.";
  }
  markThreat(state, hive);
  hive.playerDay = day(state);
  addAlert(c, HCRAWL.ALERT.burn);
  say2(c, text, "good", state.hour);
  if (!passHours(state, p, HCRAWL.BURN_HOURS)) return goneText(state, p);
  if (!p.hiveCrawl || c.enc) return text;
  if (state.rng.chance(HCRAWL.BURN.wake)) {
    const n = clamp(Math.round(2 + room.layer * 0.6), 2, 10);
    c.enc = { kind: "swarm", room: room.id, back: c.from, spotted: true, enemy: { kind: "zombies", count: n, power: roomPower(state, hive, den, room), types: broodTypes(state, hive, n, room.layer), elite: false, name: "the brood the fire woke" } };
    say2(c, `The fire draws them: ${n} of the brood come through the smoke.`, "danger", state.hour);
  }
  return text;
}
function searchRoom(state, p, c) {
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const room = roomById(den, c.at);
  const rng = state.rng;
  const mem = memOf(hive);
  const B = HCRAWL.BONES;
  let text;
  if (room.kind === "bones") {
    mem.searched[room.id] = true;
    const gear = [];
    const n = rng.int(B.items[0], B.items[1]) + (room.layer >= 4 ? 1 : 0);
    for (let i = 0; i < n; i++) gear.push(lootItem(rng.pick(B.keys), "survivor", spend(rng))); // itemcond.js: worn, as the dead left it
    const sup = sortFind({ ammo: rng.int(B.ammo[0], B.ammo[1]), meds: rng.int(B.meds[0], B.meds[1]) }, "home", "hivebones", c.tile, state.hour); // ammo.js: rounds by calibre
    text = `Among the bones: ${give(state, p, c, sup, gear)}.`;
  } else {
    mem.searched[`${room.id}:${c.visit}`] = true;
    wormSearch(state, p, c.tile, HCRAWL.POOL_WORM * 2); // worm.js: hands in the black water
    text = rng.chance(0.4) ? `Something under the water: ${give(state, p, c, {}, [lootItem(rng.pick(B.keys), "survivor", spend(rng))])}.` : "Nothing but slime and worms.";
  }
  addAlert(c, HCRAWL.ALERT.search);
  gainXpAll(state, partyMembers(state, p), "scavenging", USE.searchHour);
  say2(c, text, "good", state.hour);
  if (!passHours(state, p, HCRAWL.SEARCH_HOURS)) return goneText(state, p);
  return text;
}
function tendWounded(state, p, c) {
  const done = [];
  for (const s of [...partyMembers(state, p)].sort((a, b) => a.health - b.health)) {
    if (!fieldTreatInfo(state, p, s).ok) continue;
    const before = s.health;
    fieldTreat(state, p, s.id);
    if (s.health > before) done.push(`${first(s)} +${Math.round(s.health - before)}`);
  }
  const text = done.length ? `You tend the wounded in the dark: ${done.join(", ")}.` : "Nobody could be treated.";
  say2(c, text, done.length ? "good" : "info", state.hour);
  if (!passHours(state, p, HCRAWL.TREAT_HOURS)) return goneText(state, p);
  return text;
}
function lieStill(state, p, c) {
  addAlert(c, -HCRAWL.ALERT.lie);
  const risk = c.alert >= 40 ? 0.05 + c.alert / 500 : 0;
  if (!passHours(state, p, HCRAWL.LIE_HOURS)) return goneText(state, p);
  if (!p.hiveCrawl || c.enc) return "";
  if (state.rng.chance(risk)) {
    const hive = crawlHive(state, c);
    const den = denOf(state, hive);
    const room = roomById(den, c.at);
    const n = clamp(Math.round(2 + room.layer * 0.5), 2, 8);
    c.enc = { kind: "swarm", room: room.id, back: c.from, spotted: true, enemy: { kind: "zombies", count: n, power: roomPower(state, hive, den, room), types: broodTypes(state, hive, n, room.layer), elite: false, name: "a brood patrol" } };
    say2(c, `A brood patrol stumbles onto you in the dark: ${n} of them.`, "danger", state.hour);
    return "";
  }
  const text = `You lie still in the dark for ${HCRAWL.LIE_HOURS} hours. Alert ${alertName(c.alert)} (${Math.round(c.alert)}).`;
  say2(c, text, "info", state.hour);
  return text;
}
// Things found go into the team's cargo while there is room (as the city crawl's).
function give(state, p, c, sup = {}, gear = []) {
  p.cargo = p.cargo || { supplies: {}, gear: [] };
  let room = cargoRoom(state, p);
  const got = [], left = [];
  for (const [k, q] of Object.entries(sup)) {
    if (!(q > 0) || !SUPPLIES[k]) continue;
    const take = Math.min(q, unitsThatFit(room, k));
    if (take > 0) { p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + take; c.tally.supplies[k] = (c.tally.supplies[k] || 0) + take; room -= take * SUPPLIES[k].weight; got.push(`${take} ${k}`); }
    if (q - take > 0) left.push(`${q - take} ${k}`);
  }
  for (const g of gear) {
    if (!g) continue;
    if (room >= itemLoad(g)) { p.cargo.gear.push(g); c.tally.gear.push(g.name); room -= itemLoad(g); got.push(g.name); } else left.push(g.name);
  }
  return `${got.length ? got.join(", ") : "nothing useful"}${left.length ? ` (no room for ${left.join(", ")})` : ""}`;
}

// ---------- leaving ----------
// Back out the way the team came, a chamber an hour; a chamber that filled again (or one it crept past) is in the way.
export function leaveHive(state, p) {
  const c = hiveCrawlOf(state, p);
  if (!c) return "The team is not in a hive.";
  if (c.enc) return "Deal with what is in front of you first.";
  c.leaving = true;
  say2(c, "You turn back for the mouth.", "info", state.hour);
  return stepOut(state, p);
}
export function stepOut(state, p) {
  const c = hiveCrawlOf(state, p);
  if (!c || c.enc) return "";
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  for (let guard = 0; guard < 40 && p.hiveCrawl && !c.enc; guard++) {
    const here = roomById(den, c.at);
    if (here.id === den.mouth && (broodLeft(state, hive, here) === 0 || c.slipped[here.id] || c.trail.length <= 1)) return finishHiveCrawl(state, p, "");
    const back = c.trail.length > 1 ? c.trail[c.trail.length - 2] : den.mouth;
    const to = roomById(den, back);
    if (!passHours(state, p, HCRAWL.BACK_HOURS)) return goneText(state, p);
    if (!p.hiveCrawl || c.enc) return "";
    c.trail.pop();
    c.from = here.id; // fall back = deeper again
    c.at = to.id;
    if (broodLeft(state, hive, to) > 0) {
      c.enc = { kind: "brood", room: to.id, back: here.id, spotted: c.alert >= 50 };
      say2(c, `On the way out: ${roomThe(to)} is full of the brood again (${broodLeft(state, hive, to)}).`, "danger", state.hour);
      return "";
    }
    if (to.id === den.mouth) return finishHiveCrawl(state, p, "");
  }
  return "";
}
export function finishHiveCrawl(state, p, extra = "") {
  const c = p.hiveCrawl;
  if (!c) return "";
  const hive = crawlHive(state, c);
  if (hive) { const mem = memOf(hive); mem.lastAlert = c.alert; mem.lastHour = state.hour; }
  delete p.hiveCrawl;
  const got = [...Object.entries(c.tally.supplies).map(([k, v]) => `${v} ${k}`), ...c.tally.gear];
  const den = hive ? denOf(state, hive) : null;
  const text = `${extra ? extra + " " : ""}Out of ${c.name} after ${state.hour - c.started} h, ${c.deepest ? `${c.deepest} chamber${c.deepest === 1 ? "" : "s"} deep${den ? ` of ${den.depth}` : ""}` : "no deeper than the mouth"}, ${c.kills} of the brood killed${got.length ? `, with ${got.join(", ")}` : ""}.${c.lost.length ? ` Lost: ${c.lost.join(", ")}.` : ""}`;
  log(state, `${teamName(state, p)}: ${text}`, c.lost.length ? "danger" : "info");
  if (state.parties.includes(p)) { p.seen.set(c.tile, snapshot(state, c.tile)); awaitOrders(state, p, text); }
  return text;
}
function crawlWiped(state, p, line) {
  const c = p.hiveCrawl;
  delete p.hiveCrawl;
  if (c) log(state, `${line ? line + " " : ""}The team died in ${c.name}, ${c.deepest ? `${c.deepest} chamber${c.deepest === 1 ? "" : "s"} deep` : "at its mouth"}. What they carried lies in the hive.`, "death");
  wipeParty(state, p);
}
function goneText(state, p) {
  if (state.parties.includes(p) && !partyMembers(state, p).length) crawlWiped(state, p, "");
  return "The team is gone.";
}
// One of the team died with the worm in them inside (worm.js): one more of the dead in front of the team.
export function hiveCrawlTurned(state, p, s) {
  const c = hiveCrawlOf(state, p);
  if (!c) return false;
  if (c.enc && !c.enc.fighting && c.enc.kind !== "core") {
    const e = c.enc;
    const base = e.enemy || roomForce(state, crawlHive(state, c), crawlRoom(state, c));
    c.enc = { ...e, kind: e.kind === "brood" ? "swarm" : e.kind, enemy: { ...base, count: (base.count || 0) + 1 } };
  } else if (!c.enc) c.enc = { kind: "turned", room: c.at, back: c.from, spotted: true, enemy: { kind: "zombies", count: 1, power: 3, types: null, elite: false, name: `${first(s)} (turned)` } };
  addAlert(c, 6);
  say2(c, `${s.name} died with the worm in them and got up again among you.`, "danger", state.hour);
  return true;
}

// ---------- the core: the Hivemind ----------
// The fight in the core room (also the old storm's entry point, for the tools): the brood left there, the Broodmother
// and the Hivemind. opts.map: on the battle map in the browser; opts.quick: by the numbers; else fightNow (headless:
// played out by the AI on both sides, as the old storm was).
// numbers: the setup for a fight by the numbers (the bosses folded into the brood's power: byNumbersOdds counts
// count × power); on the map the brood keeps its own power and the bosses are units (the layout).
export function coreSetup(state, p, hive, numbers = false) {
  const f = coreForce(state, hive);
  const allies = hiveAllies(state, hive);
  const count = f.count ? broodAfterAllies(f.count, allies.fighters) : 0;
  const n = Math.max(1, count);
  return {
    tile: hive.tile, partyId: p.id, ambush: null, canRetreat: true, handler: "hiveAssault", layout: "hivecore",
    enemy: { kind: "zombies", count: n, power: numbers ? Math.round(((count * f.power + f.bossPower) / n) * 10) / 10 : f.power, types: f.types, elite: !!f.elite, name: `the core of ${hive.name}`, brood: count, broodPower: f.power, hp: f.hp },
    aiStyle: tacticalStyleFor(state, p),
    context: { hiveId: hive.id, partyId: p.id, crawl: !!p.hiveCrawl, tier: f.tier, warmth: 100, met: count, allies: allies.fighters },
  };
}
export function assaultHive(state, p, hive, opts = {}) {
  const setup = coreSetup(state, p, hive, !!opts.quick);
  const allies = hiveAllies(state, hive);
  if (allies.fighters) log(state, `Fighters from ${allies.names.join(", ")} fight beside your squad in ${hive.name}.`, "good");
  if (opts.quick) { const res = crawlByNumbers(state, setup); finishCombat(state, setup, res); return null; }
  if (opts.map && typeof window !== "undefined" && !state.autoCombat) return onFoot(p, () => startCombat(state, setup));
  return onFoot(p, () => fightNow(state, setup));
}
// The core fight is over (combat.js finishCombat): the Hivemind dead destroys the hive.
registerCombatHandler("hiveAssault", (state, result, setup) => {
  const c0 = setup.context || {};
  const hive = hiveById(state, c0.hiveId);
  const p = partyById(state, c0.partyId);
  const killed = Math.min(result.enemiesKilled || 0, c0.met ?? setup.enemy.count);
  if (hive && killed) cutGuard(state, hive, killed);
  if (hive) { hive.playerDay = day(state); }
  let text;
  const won = result.outcome === "victory" && !!hive;
  if (won) {
    destroyHive(state, hive, "by your team");
    text = `The ${BOSS_NAMES.hivemind} bursts and the hive dies around you: the brood falls where it stands and the walls go still and cold. The infection around it will fade over the coming weeks.`;
    if (p && state.parties.includes(p)) p.seen.set(hive.tile, snapshot(state, hive.tile));
  } else if (result.outcome === "retreat") text = `The team fell back from the core. The ${BOSS_NAMES.hivemind} still beats.`;
  else text = "The brood drove the team back from the core.";
  if (!won && hive) markThreat(state, hive); // hivetech.js: it builds for defence
  if (!p || !state.parties.includes(p)) return;
  const c = p.hiveCrawl;
  if (!partyMembers(state, p).length) { if (c) crawlWiped(state, p, "Killed in the core."); else if (state.parties.includes(p)) { log(state, "The whole team was lost storming a hive.", "death"); wipeParty(state, p); } return; }
  if (c) {
    c.kills += killed;
    for (const id of result.survivorsDead || []) { const s = state.survivors.find((x) => x.id === id); if (s) c.lost.push(s.name); }
    c.enc = null;
    if (won) { say2(c, text, "good", state.hour); finishHiveCrawl(state, p, text); return; }
    addAlert(c, HCRAWL.ALERT.fight);
    say2(c, text, "danger", state.hour);
    const den = hive ? denOf(state, hive) : null;
    const back = c.from || (den ? shortestPath(den).slice(-2)[0] : null);
    if (back && den) { c.trail = c.trail.filter((id) => id !== den.core); c.at = back; if (c.trail[c.trail.length - 1] !== back) c.trail.push(back); c.from = c.trail.length > 1 ? c.trail[c.trail.length - 2] : null; }
    log(state, `${text} (${tileLabel(state, partyTile(p))})`, "danger");
    return;
  }
  if (!won) log(state, `${text} (${tileLabel(state, partyTile(p))})`, "danger");
  awaitOrders(state, p, text);
});

// ---------- the battle maps ----------
// A chamber: hive flesh everywhere but a winding passage from the west edge (where the team comes in, its way back)
// to the east, with one to three chambers along it and pillars of flesh for cover. The core: one great chamber, the
// Hivemind in a pocket at its east end with an opening toward the team.
registerBattleSize("hivechamber", (state, setup) => (setup.context && setup.context.hiveCrawl && setup.context.hiveCrawl.size) || [28, 16]);
registerBattleSize("hivecore", () => ROOM_KINDS.core.size);
function resetCell(c, k) { for (const key of Object.keys(c)) delete c[key]; c.k = k; c.f = "dirt"; }
function carveCave(ctx, kind) {
  const { W, H, rng } = ctx;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) resetCell(ctx.cellAt(x, y), "hivewall");
  const dig = (x, y) => { if (ctx.inside(x, y)) resetCell(ctx.cellAt(x, y), "open"); };
  const cy0 = Math.floor(H / 2);
  for (let x = 0; x < 6; x++) for (let y = cy0 - 3; y <= cy0 + 3; y++) dig(x, y); // the way in
  const half = kind === "tunnel" ? 1 : 2;
  const ty = [];
  let y = cy0;
  for (let x = 0; x < W; x++) {
    if (x > 5 && rng.chance(0.35)) y += rng.chance(0.5) ? 1 : -1;
    y = clamp(y, 1 + half, H - 2 - half);
    ty[x] = y;
    for (let d = -half; d <= half; d++) dig(x, y + d);
  }
  const blobs = kind === "tunnel" ? 1 : kind === "gallery" || kind === "nursery" || kind === "core" ? 3 : 2;
  for (let i = 0; i < blobs; i++) {
    const bx = clamp(Math.round(W * (0.3 + (0.55 * (i + rng.next())) / blobs)), 7, W - 3);
    const rx = rng.int(3, 5), ry = rng.int(2, Math.max(3, Math.floor(H / 3)));
    const by = clamp(ty[bx] + rng.int(-2, 2), 1, H - 2);
    for (let yy = by - ry; yy <= by + ry; yy++) for (let xx = bx - rx; xx <= bx + rx; xx++) if (((xx - bx) / rx) ** 2 + ((yy - by) / ry) ** 2 <= 1 + rng.next() * 0.25) dig(xx, yy);
  }
  if (kind !== "tunnel") { // a side passage
    const sx = rng.int(8, W - 6), up = rng.chance(0.5);
    for (let yy = ty[sx]; up ? yy >= 1 : yy <= H - 2; yy += up ? -1 : 1) { dig(sx, yy); dig(sx + 1, yy); }
  }
  // Pillars of flesh in the open (cover), never closing a passage: only where all eight neighbours are open.
  const n = Math.round((W * H) / 80);
  for (let i = 0; i < n; i++) {
    const x = rng.int(8, W - 3), yy = rng.int(1, H - 2);
    let open = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && ctx.inside(x + dx, yy + dy) && ctx.cellAt(x + dx, yy + dy).k === "open") open++;
    if (open === 8) ctx.put(x, yy, "hivewall");
  }
  return ty;
}
registerBattleLayout("hivechamber", (b, ctx) => {
  if (ctx.phase !== "map") return;
  const c = (b.setup.context && b.setup.context.hiveCrawl) || {};
  const room = c.kind === "swarm" || c.kind === "turned" ? "tunnel" : null;
  carveCave(ctx, room || kindOfSize(c.size));
  b.infection = 1;
  b.reinfMax = 0; // no dead drawn in from the edges: the brood is what is in the chamber
  b.hiveWarmth = c.warmth ?? 50; // ui: the pulse and the warm tint (ui/hivecrawlsfx.js)
});
const kindOfSize = (size) => (size && size[1] <= 13 ? "tunnel" : size && size[1] >= 18 ? "gallery" : "chamber");
registerBattleLayout("hivecore", (b, ctx) => {
  const { W, H } = ctx;
  const hx = W - 4, cy = Math.floor(H / 2);
  if (ctx.phase === "map") {
    const ty = carveCave(ctx, "core");
    // The great chamber, then the Hivemind's pocket: open round it, a ring of flesh, an opening toward the team.
    const cx = Math.round(W * 0.55), rx = Math.round(W * 0.38), ry = Math.round(H * 0.4);
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 && ctx.inside(x, y)) resetCell(ctx.cellAt(x, y), "open");
    for (let x = cx; x <= hx; x++) for (let y = cy - 1; y <= cy + 1; y++) if (ctx.inside(x, y)) resetCell(ctx.cellAt(x, y), "open");
    for (let y = cy - 2; y <= cy + 2; y++) for (let x = hx - 2; x <= Math.min(W - 1, hx + 2); x++) {
      if (!ctx.inside(x, y)) continue;
      const ring = Math.max(Math.abs(x - hx), Math.abs(y - cy)) === 2;
      const gap = x === hx - 2 && Math.abs(y - cy) <= 1;
      resetCell(ctx.cellAt(x, y), ring && !gap ? "hivewall" : "open");
    }
    for (let i = 0; i < 6; i++) { const x = ctx.rng.int(cx - rx + 4, hx - 4), y = ctx.rng.int(cy - ry + 1, cy + ry - 1); if (ctx.free(x, y) && Math.abs(y - cy) > 1) ctx.put(x, y, "hivewall"); }
    void ty;
    b.infection = 1;
    b.reinfMax = 0;
    b.hiveWarmth = 100;
    return;
  }
  // Units: the Hivemind in its pocket, the Broodmother in front of it.
  const setup = b.setup;
  const hm = bossUnit(b, "hivemind");
  const hp = (setup.enemy && setup.enemy.hp) || HIVEMIND.hp;
  hm.hp = hm.maxHp = hp;
  const taken = b.units.find((u) => u.x === hx && u.y === cy);
  if (taken) { if (!placeUnitRight(b, ctx, taken, Math.max(0, hx - 10), hx - 2)) taken.x = Math.max(0, hx - 6); }
  hm.x = hx; hm.y = cy;
  b.units.push(hm);
  b.hivemind = { id: hm.id, tier: (setup.context && setup.context.tier) || 0, spawned: 0, turns: 0 };
  const bm = bossUnit(b, "broodmother");
  bm.shotPri = 1.3;
  if (placeUnitRight(b, ctx, bm, Math.max(0, hx - 9), hx - 2)) b.units.push(bm);
  say(b, `The core of the hive. At its far end the ${BOSS_NAMES.hivemind} beats in a pocket of flesh: it never moves, but it pulses, lashes out and calls the brood out of the walls. Kill it and the hive dies with it.`, "danger");
});
// The Hivemind's turn (combat.js registerBossAI): the pulse, a lash, the brood out of the walls.
registerBossAI("hivemind", {
  turn(b, u) {
    const M = HIVEMIND, rng = b.rng;
    const st = b.hivemind || (b.hivemind = { id: u.id, tier: 0, spawned: 0, turns: 0 });
    st.turns++;
    const cheb = (o) => Math.max(Math.abs(o.x - u.x), Math.abs(o.y - u.y));
    const foes = b.units.filter((o) => o.side === "player" && active(o));
    const near = foes.filter((o) => cheb(o) <= M.pulse);
    if (near.length) {
      say(b, `The ${BOSS_NAMES.hivemind} pulses: a wave of heat and pressure through the flesh.`, "danger");
      for (const t of near) {
        damage(b, t, rng.int(M.pulseDmg[0], M.pulseDmg[1]), u, false, null);
        fx(b, { type: "melee", from: [u.x, u.y], to: [t.x, t.y], hit: true, crit: false, dmg: 0, side: "enemy", text: "PULSE" });
        if (active(t) && rng.chance(M.stun) && !(t.stun && !t.stun.applied && t.stun.next >= nextTurnOf(b, t))) t.stun = { aim: 15, ap: 1, next: nextTurnOf(b, t), dazed: false };
      }
    }
    const lash = foes.filter((o) => active(o) && cheb(o) <= 1);
    if (lash.length) {
      const t = rng.pick(lash);
      const eff = Math.round(damage(b, t, rng.int(M.lash[0], M.lash[1]), u, false, { how: "melee", crit: false }));
      say(b, `A tendril lashes out of the ${BOSS_NAMES.hivemind} at ${t.name} for ${eff}.`, "danger");
      fx(b, { type: "melee", from: [u.x, u.y], to: [t.x, t.y], hit: true, crit: false, dmg: eff, side: "enemy" });
    }
    const cap = M.cap + M.capTier * (st.tier || 0);
    if (st.turns % M.spawnEvery === 1 && st.spawned < cap) {
      const cells = [];
      for (let y = u.y - 6; y <= u.y + 6; y++) for (let x = u.x - 8; x <= u.x + 1; x++) {
        if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
        const c = b.cells[y * b.w + x];
        if (c.k !== "open" || !b.reach[y * b.w + x] || b.units.some((o) => o.x === x && o.y === y && !o.dead && !o.left)) continue;
        let wall = false;
        for (let dy = -1; dy <= 1 && !wall; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < b.w && yy < b.h && b.cells[yy * b.w + xx].k === "hivewall") { wall = true; break; } }
        if (wall) cells.push([x, y]);
      }
      rng.shuffle(cells);
      const n = Math.min(cap - st.spawned, rng.int(M.spawn[0], M.spawn[1]), cells.length);
      const power = (b.setup.enemy && b.setup.enemy.broodPower) || 5;
      for (let i = 0; i < n; i++) {
        const z = enemyUnit(b, rng, "zombies", power, b.units.filter((o) => o.kind === "zombie").length + 1);
        const kinds = Object.keys((b.setup.enemy && b.setup.enemy.types) || {});
        if (kinds.length && rng.chance(0.3)) applyZType(z, rng.pick(kinds), !!(b.setup.enemy && b.setup.enemy.elite), power);
        z.x = cells[i][0]; z.y = cells[i][1];
        z.aware = true; z.ap = 0; z.reinforcement = true;
        b.units.push(z);
      }
      st.spawned += n;
      if (n) say(b, `The walls split: ${n} of the brood tear themselves out of the flesh.`, "danger");
    }
  },
  death(b, u) {
    let n = 0;
    for (const o of b.units) if (o !== u && o.side === "enemy" && o.kind === "zombie" && !o.dead) { o.dead = true; o.hp = 0; o.killedBy = "player"; n++; fx(b, { type: "melee", from: [o.x, o.y], to: [o.x, o.y], hit: true, crit: false, dmg: 0, side: "player", text: "COLLAPSES" }); }
    say(b, `The ${BOSS_NAMES.hivemind} bursts like a rotten fruit.${n ? ` Its brood drops where it stands: ${n} of them, the ${BOSS_NAMES.hive} among them if she still stood.` : ""} The hive is dying.`, "good");
  },
});

// ---------- the autopilot ----------
// One step of a crawl a team of yours is on while the autopilot plays (autopilot.js idleTeams, once an hour): follow the
// warmth (the drafts as the team reads them; unexplored chambers before known ones), fight by the numbers what it
// should win, creep past what it can, burn eggs when it has the fuel or a Molotov, search bone pits, lie still when the
// hive is roused, and turn back when the team is badly hurt or the core is beyond it (it comes back on a later trip:
// the chambers it cleared stay clear for a while). The core: played out on the map headless, as the old storm was.
export function hiveCrawlAutoStep(state, p) {
  const c = hiveCrawlOf(state, p);
  if (!c) return;
  if (state.combat) return;
  const A = HCRAWL.AUTO;
  const members = partyMembers(state, p);
  const fit = members.filter((s) => s.health >= A.fit).length;
  const hurtBad = members.filter((s) => s.health < A.hurt).length;
  if (c.enc) {
    const opts = encounterOptions(state, p);
    const get = (id) => opts.find((o) => o.id === id);
    if (c.enc.kind === "core") {
      const ok = fit >= Math.min(A.coreFit, members.length) && hurtBad <= 1 && get("numbers").odds >= A.fightOdds;
      resolveHiveEnc(state, p, ok ? "fight" : "back", { map: false });
      if (!ok && p.hiveCrawl && !p.hiveCrawl.enc) { p.hiveCrawl.leaving = true; say2(p.hiveCrawl, "The core is too much for the team as it is: it turns back, to come again.", "danger", state.hour); }
      return;
    }
    const num = get("numbers"), sneak = get("sneak");
    const pick = num && num.odds >= A.sureOdds ? "numbers" : sneak && sneak.odds >= A.sneakOdds && !c.enc.spotted && !c.leaving ? "sneak" : num && num.odds >= A.fightOdds ? "numbers" : get("back") ? "back" : "out";
    resolveHiveEnc(state, p, pick, { map: false });
    if (pick !== "numbers" && pick !== "sneak") { const cc = p.hiveCrawl; if (cc && !cc.enc) cc.leaving = true; }
    return;
  }
  if (c.leaving) { stepOut(state, p); return; }
  const acts = roomActions(state, p);
  if (members.some((s) => s.health < A.treat) && acts.some((a) => a.id === "treat" && !a.disabled)) { roomAct(state, p, "treat"); return; }
  if (hurtBad >= 2 || fit < Math.max(2, Math.ceil(members.length / 2))) { say2(c, "Too many hurt: the team turns back.", "danger", state.hour); leaveHive(state, p); return; }
  if (c.alert >= A.lie) { roomAct(state, p, "lie"); return; }
  const burn = acts.find((a) => a.id === "burn" && !a.disabled);
  if (burn && c.alert < 50) { roomAct(state, p, "burn"); return; }
  const search = acts.find((a) => a.id === "search" && !a.disabled);
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  if (search && crawlRoom(state, c).kind === "bones") { roomAct(state, p, "search"); return; }
  if (!canMoveOn(state, c)) { leaveHive(state, p); return; }
  const next = autoNext(state, p, c, den);
  if (!next) { leaveHive(state, p); return; }
  moveTo(state, p, next);
}
// The next chamber on the autopilot's way: a passage with a warmer draft it has not taken, else any it has not taken
// (not back), else the first step toward the nearest chamber it knows of and has not been in.
function autoNext(state, p, c, den) {
  const ex = exitsOf(state, p).filter((x) => !(x.visited && x.room && (x.room.kind === "collapse" || x.room.dead && !ROOM_KINDS[x.room.kind].burn && !ROOM_KINDS[x.room.kind].search)));
  const fresh = ex.filter((x) => !x.visited);
  const warm = fresh.filter((x) => x.draft === "warmer");
  if (warm.length) return warm.sort((a, b) => a.id.localeCompare(b.id))[0].id;
  const level = fresh.filter((x) => x.draft === "level");
  if (level.length) return level[0].id;
  // Known chambers: a breadth-first walk over the chambers the team has been in to the nearest unexplored passage.
  const start = c.at, prev = new Map([[start, null]]), q = [start];
  let goal = null;
  const hive = crawlHive(state, c);
  while (q.length && !goal) {
    const id = q.shift();
    for (const n of roomById(den, id).links) {
      if (prev.has(n)) continue;
      prev.set(n, id);
      if (!c.visited[n]) { goal = n; break; }
      const r = roomById(den, n);
      if (r.kind === "core" || (broodLeft(state, hive, r) > 0 && !c.slipped[n])) continue; // not through the core, nor a chamber full of brood
      q.push(n);
    }
  }
  if (!goal) return null;
  let step = goal;
  while (prev.get(step) !== start && prev.get(step) != null) step = prev.get(step);
  return step;
}

// The autopilot's estimate of a crawl (autopilot.js hiveCandidate, hiveChoice, hiveJobOk): with a guard of G, the den's
// depth, the fights on the shortest way (brood × power / 5.2 of each), the core (its brood and the bosses as one
// strength), the hours inside and the wear (each fight on the way costs the squad a little: wear per fight).
export function crawlEstimate(state, hive, G = guardSize(state, hive)) {
  const den = denOf(state, hive);
  const path = shortestPath(den);
  let fights = 0, brood = 0;
  for (const id of path) {
    const r = roomById(den, id);
    if (r.kind === "core") continue;
    const n = Math.min(roomFull(state, hive, den, r, G), broodLeft(state, hive, r, G));
    if (n > 0) { fights++; brood += (n * roomPower(state, hive, den, r, G)) / 5.2; }
  }
  const core = coreForce(state, hive, G);
  const allies = hiveAllies(state, hive).fighters;
  const count = core.count ? broodAfterAllies(core.count, allies) : 0;
  const coreStrength = (count * core.power + core.bossPower) / 5.2;
  return { depth: den.depth, fights, brood, coreStrength, wear: 1 + HCRAWL.AUTO.wear * fights, strength: coreStrength * (1 + HCRAWL.AUTO.wear * fights), hours: den.depth * (HCRAWL.MOVE_HOURS + HCRAWL.FIGHT_HOURS) + 6 };
}

// ---------- the AI groups' crawl ----------
// A war party of an AI group (factions.js groupHiveWar) crawls the same den, coarsely: its strength is a budget in the
// guard's units (its fighters' power × GROUP_HIVE.FIGHT, as before); the whole way in costs the guard × (depth + 1) /
// GROUP.depthDiv, spread over the brood on the shortest way and in the core (each chamber costs its brood left), and
// the core the Hivemind and the Broodmother on top (GROUP.boss + bossTier × tier). The guard it kills: the brood it
// killed × the guard each stands for (as your teams', cutGuard). It clears
// what it pays for (the hive remembers: the chambers stay clear for a while, for your teams too), stops where the
// budget runs out (driven off partway; a later party starts from what is still clear), and burns the hive out when it
// reaches and pays for the core. Returns { burned, cut (the guard killed), met (all it ran into), reached (chambers
// deep), depth }.
export function groupHiveCrawl(state, hive, budget) {
  const den = denOf(state, hive);
  const g = hiveGuard(state, hive);
  const G = g ? g.size : 0;
  const path = shortestPath(den);
  const core = coreForce(state, hive, G);
  // What a brood costs a war party: the whole way in (the brood on the shortest way and in the core, full) is worth
  // the guard × (depth + 1) / depthDiv of its strength: a young hive about its guard, a deep one three times it.
  const full = path.reduce((a, id) => { const r = roomById(den, id); return a + (r.kind === "core" ? core.count : roomFull(state, hive, den, r, G)); }, 0);
  const unit = full > 0 ? (G * (den.depth + 1)) / (HCRAWL.GROUP.depthDiv * full) : 0;
  const share = G / Math.max(1, denBroodTotal(state, hive, G)); // the guard each brood stands for (cutGuard)
  let left = budget, met = 0, reached = 0, burned = false, killed = 0;
  for (const id of path) {
    const r = roomById(den, id);
    if (r.kind === "core") {
      const cost = core.count * unit + HCRAWL.GROUP.boss + HCRAWL.GROUP.bossTier * den.tier;
      met += cost;
      reached = den.depth;
      if (left >= cost) { burned = true; killed += core.count; left -= cost; } else { killed += unit > 0 ? Math.min(core.count, Math.floor(left / unit)) : 0; left = 0; }
      break;
    }
    const n = broodLeft(state, hive, r, G);
    const cost = n * unit;
    met += cost;
    if (left >= cost) { left -= cost; killed += n; if (n) setLeft(state, hive, r, 0); reached = r.layer + 1; continue; }
    const k = unit > 0 ? Math.floor(left / unit) : n;
    killed += k;
    setLeft(state, hive, r, n - k);
    left = 0;
    break;
  }
  const cut = Math.min(G, Math.round(killed * share));
  if (g && cut > 0) reduceHorde(state, g, cut);
  return { burned, cut, met: Math.round(met), reached, depth: den.depth, spent: Math.round(budget - left) };
}

// ---------- help ----------
export const HIVE_CRAWL_HELP = `A hive is destroyed from the inside. Send a team with the <b>Destroy hive</b> mission and choose <b>Enter the hive</b> on its card: the team crawls through the hive chamber by chamber, from the mouth to the <b>core room</b>, where the <b>${BOSS_NAMES.hivemind}</b> sits, the organ that thinks for the hive. Kill it and the hive dies, its brood with it. A young hive is shallow (${HCRAWL.DEPTH[0]} chambers from the mouth to the core); every tier it grows makes it deeper (${HCRAWL.DEPTH.join(", ")} by tier, one more with a screamer spire): the crawl is the mid and late game's work.<br>
<b>Finding the way.</b> The chambers form a web: at least two routes run to the core, with side branches, dead ends and loops. You see the passages out of every chamber you have been in; what lies beyond is dark until you go. The core is the hottest place in the hive: every chamber has a <b>warmth</b> (the gauge, and the air: <i>cool and damp</i>, <i>close and clammy</i>, <i>warm as breath</i>, <i>hot</i>, <i>the walls sweat</i>), and every passage a draft, <i>warmer</i> or <i>colder</i>. A team without a good scout misreads a draft now and then (${Math.round(HCRAWL.DRAFT.miss * 100)}% less ${Math.round(HCRAWL.DRAFT.perScout * 1000) / 10} a point of the best Scouting). The deeper, the louder and faster the hive's pulse and the warmer its drone (the mixer's <i>Hive crawl pulse</i>), and the redder the window.<br>
<b>The brood.</b> Every chamber holds some of the hive's brood: more and tougher the deeper you go, the special dead the hive breeds among them, the elite deeper still, and the chambers next to the core the worst. A hive's guard horde is its brood: every one killed inside thins the guard, and fires set outside (or a war party) mean emptier chambers. Fight them (on a cave map or by the numbers), creep past (Stealth; they stay there and you meet them again on the way back), or fall back. Cleared chambers stay clear for about ${HCRAWL.REFILL_DAYS} days, then the brood flows back: you can crawl part of the way, come home to heal and come back. Kinds of chamber: tunnels, galleries, <i>nurseries</i> (many and weak), <i>egg chambers</i> (burn them with ${HCRAWL.BURN.fuel} fuel or a Molotov: the hive loses stores and some of its guard, and fills its chambers more slowly), <i>bone pits</i> (the remains of teams that came before: their worn guns, armour, packs, ammunition and meds), <i>worm pools</i> (the worm's eggs: wading through is a risk, feeling through the water more), the <i>roots</i> of the hive's growths (burn one to hurt the growth above), and collapses that lead nowhere.<br>
<b>The hive's Alert.</b> Moving, fighting, fire and a failed sneak make noise; lying still lets it fade. From ${HCRAWL.ALERT.converge} the brood converges on you: it pours into your chamber and fills the chambers behind you again; from ${HCRAWL.ALERT.block} it packs the mouth. Leaving means going back the way you came.<br>
<b>The ${BOSS_NAMES.hivemind}.</b> In the core the ${BOSS_NAMES.hive} and the last of the brood guard it. It never moves, but every turn it pulses (everyone within ${HIVEMIND.pulse} tiles hurt and sometimes stunned), lashes at anyone next to it, and every other turn tears more brood out of the walls. It has ${HIVEMIND.hp} health (+${HIVEMIND.perTier} a tier) and thick flesh. Its death kills the brood around it. The other groups crawl hives too (their war parties clear chambers on the shortest way and come back), and allied fighters thin the brood in every chamber.`;
