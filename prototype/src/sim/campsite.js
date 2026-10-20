// @ts-check
// Campsites (the user's request 2026-10-20: "a campsite using these tents spawned on the map around a campfire; these
// tents can have loot in them and be taken down to steal them. The campsites can end up being abandoned, overrun with
// zombies, or an active camp with survivors (raiders).").
//
// THE POI (pois.js; data.js LOCATIONS campsite, its sprite ui/mapsprites.js paintCampsite). The woods' own campsites
// (POI_KINDS.forest) and, rarer than the common places, one more on a land tile by its own dice (campsiteExtra, from
// generatePois after its own list: the list before it unchanged, so a save's changes still line up): the woods, the
// countryside (plains, hills), a roadside, a lake or a riverside (CAMPSITE.GEN, the chances add up).
//
// ITS STATE (campState; hash dice of the seed, the tile, the POI and the period, CAMPSITE.EPOCH days, so it changes now
// and then): abandoned (nobody there, a few dead wandering nearby, its loot the best: RICH, some tents torn), overrun (a
// pack of the dead among the tents, some of them the campers turned, campers' bodies to search, tents torn) or an active
// raider camp (a band of raiders with their kit round a lit fire; at night some of them asleep in the tents). By
// CAMPSITE.ODDS, the overrun weight up with the tile's infection. A camp your people (or a group's raid) cleared stays
// cleared (poi.camp.cleared): the fire cold, nobody of the camp's there, its tents as they were left.
//   It counts in the POI's true threat (pois.js poiThreat + CAMPSITE.DANGER), and a survey or a visit sees it (pois.js
//   notePoiThreat → noteCampSeen: poi.camp.seen { hour, state }): the POI dialogue (poiraid.js poiRows, ui/poipick.js),
//   the tile panel (ui/poiview.js) and the raid plan's window (ui/raidplan.js) say what was seen and when.
// ITS TENTS (campTents: 2–6 of mixed kinds by hash dice, CAMPSITE.KINDS): laid round the fire by the raid map
//   (campRaidMap). Each one with storage holds loot as a container sized by its storage (tentBoxLoot: food, water, camp
//   gear, a gun or rounds now and then, a spare tent bag; by the state's RICH and FILL of its storeKg). Taken down
//   (tentfight.js) it is gone from the POI for good (poi.camp.gone); one left standing keeps what was left in it (the
//   container ledger, poicont.js) and its wear (poi.camp.hp, its share of hit points).
// THE RAID (scavenge.js startScavenge → campRoster: the camp's people and dead join the tile's roster; combat.js
//   createRaid → campRaidMap (the map, the POI's own dice: the same camp every visit) and campRaidUnits (the campers
//   round the fire and in the tents, the dead among the tents, the bodies, the lit fire's glow)). The end
//   (campAfter, combat.js finishCombat): the tents' wear kept; the camp cleared when nobody of the camp's is left
//   standing on the map.
// AI PARITY (docs/adr/0001-ai-parity.md):
//   - Nomad bands and raider bands camping in the world are campsites: a fight at a band's camp (nomads.js nomadFight
//     camp, visitors.js teamFight at a stop) is laid out by the battle layout "campsite" (a clearing round their fire,
//     their real tents from their bags, drifters' makeshift ones, a share of their stores in the tents as piles on the
//     ground: bandStores) and their people round the fire or asleep in the tents by the hour. What is left in those
//     piles goes back to the band before the fight's handler (campAfter), so a won fight hands it over once.
//   - The AI groups and bands raid campsites through their POI picker (grouppois.js raidPoiAsGroup → campGroupRaid):
//     they carry off up to CAMPSITE.AI_BAGS of the standing tents as bags and the camp is cleared.
//   - Raiders at your camp take your tents down (tentfight.js, softcover.js tentAI).
import { TENT_TYPES, TENT_S } from "./data-tents.js";
import { GEAR, SUPPLIES, supWeight } from "./data.js";
import { hash01 } from "./skills.js";
import { Rng } from "./rng.js";
import { CELL, registerBattleLayout, unitAt, say } from "./combat.js"; // call-time only (the import cycle), but registerBattleLayout at load (hoisted)
import { TENT_FIGHT } from "./softcover.js"; // call-time only
import { addTent } from "./tentfight.js"; // call-time only
import { poiAt } from "./pois.js"; // call-time only (pois.js reads this module at call time too)
import { lootItem } from "./inventory.js"; // call-time only
import { isNight } from "./world.js"; // call-time only
import { fieldLayer } from "./raidloot.js"; // call-time only
import { fieldReady } from "./ground.js"; // call-time only

export const CAMPSITE = {
  // The state: its odds (overrun's weight + the tile's infection × INF_OVERRUN), rolled again every EPOCH days.
  ODDS: { abandoned: 0.4, overrun: 0.25, active: 0.35 }, INF_OVERRUN: 0.5, EPOCH: 10,
  // The map's campsites besides the woods' own (generatePois): a land tile's chance by its ground, plus a road, plus
  // water beside it (a lake or a river); the known zone's ones start known KNOWN of the time.
  GEN: { forest: 0.05, hills: 0.03, plains: 0.025, mountain: 0.01, road: 0.03, water: 0.04 }, KNOWN: 0.5,
  // Its tents: how many, their kinds' weights (a makeshift one now and then: tarps and poles, no storage, no bag).
  TENTS: [2, 6], KINDS: { tent1: 3, tent2: 3, tent4: 1, makeshift: 1.5 },
  // The true threat a state adds (pois.js poiThreat).
  DANGER: { active: 1.2, overrun: 1.0, abandoned: 0.3, cleared: 0 },
  // An active camp: a band of RAIDERS at POWER; at night ASLEEP of them asleep in the tents (2 a tent at most).
  RAIDERS: [3, 6], POWER: 3.5, ASLEEP: 0.6, PER_TENT: 2,
  // The dead at the camp by state (on top of the tile's own dead, which an active camp keeps fewer of: DEAD_CUT).
  DEAD: { abandoned: [1, 3], overrun: [6, 10], active: [0, 1], cleared: [0, 0] }, DEAD_CUT: { active: 0.4, overrun: 1, abandoned: 0.6, cleared: 1 },
  TURNED: 0.5, BODIES: { overrun: [2, 4], abandoned: [0, 1], active: [0, 0], cleared: [0, 0] },
  // The tents torn by state (that share of them, each down to 0–60% of its hit points).
  TORN: { abandoned: 0.35, overrun: 0.6, active: 0, cleared: 0 },
  // The loot: × the richness by state; the share of a tent's storage its things fill; the odds of a gun, rounds, a
  // spare tent bag in a tent.
  RICH: { abandoned: 1.3, overrun: 1.0, active: 0.8, cleared: 1 }, FILL: [0.25, 0.6],
  GUN: { abandoned: 0.1, overrun: 0.08, active: 0.2, cleared: 0.05 }, AMMO: 0.35, BAG: 0.12,
  // The map: the clearing's radius, the fire's glow at night (its light, as a flare's), a car or a hand cart by it.
  CLEAR_R: 5, FIRE_R: 4, CAR: 0.3, CART: 0.2,
  // The AI's raid on a campsite: bags it carries off (the standing tents with a bag, best first).
  AI_BAGS: 2,
  // A band's camp in a fight: the share of its stores (by kg) its tents hold, at most a tent's storage each.
  BAND_STORES: 0.6,
};
export const STATE_WORD = { abandoned: "abandoned", overrun: "overrun by the dead", active: "an active raider camp", cleared: "cleared" };
/** @param {Record<string, number>} items @param {number} u */
function pickW(items, u) {
  const tot = Object.values(items).reduce((a, w) => a + w, 0);
  let x = u * tot;
  for (const [k, w] of Object.entries(items)) { x -= w; if (x < 0) return k; }
  return Object.keys(items).pop();
}
/** @param {number} u @param {number[]} r */
const between = (u, r) => r[0] + Math.floor(u * (r[1] - r[0] + 1));
const tileOf = (state, tile) => (typeof tile === "number" ? state.tiles[tile] : tile);
const dayOf = (state) => Math.floor(state.hour / 24) + 1;

// ---------- the POI ----------
/** Is POI i of the tile a campsite? @param {any} t @param {number} i */
export const isCampsite = (t, i) => { const p = poiAt(t, i); return !!p && p.kind === "campsite"; };
/** The camp's record on the POI (plain data, saved with it: pois.js packPois). @param {any} t @param {number} i */
export function campRec(t, i, make = false) {
  const p = poiAt(t, i);
  if (!p) return null;
  if (!p.camp && make) p.camp = { gone: [], hp: {} };
  return p.camp || null;
}
/**
 * The tile's extra campsite (pois.js generatePois, after its own list and its hidden pass): a campsite POI by its own
 * dice, or null. Never where the list is full or already holds one.
 * @param {any} state @param {any} t @param {any[]} list @param {boolean} knownZone
 */
export function campsiteExtra(state, t, list, knownZone) {
  if (!t || list.length >= 4 || list.some((p) => p.kind === "campsite")) return null;
  const G = CAMPSITE.GEN;
  const ground = G[t.terrain];
  if (ground == null) return null; // a suburb, a city block: no camping there
  const g = state.grid;
  const water = !!t.river || !!(g && g.neighbors && g.neighbors(t.id).some((n) => state.tiles[n] && (state.tiles[n].terrain === "water" || state.tiles[n].river)));
  const p = ground + (t.road ? G.road : 0) + (water ? G.water : 0);
  if (hash01(state.seed, "campsite", t.id) >= p) return null;
  const def = { kind: "campsite", hidden: true, pool: null, visits: 0, lastDay: null, cont: null, threatStamp: null, stripped: false };
  def.pool = Math.min(1, 0.25 * (0.7 + 0.5 * hash01(state.seed, "campsitepool", t.id)));
  def.hidden = !(knownZone && hash01(state.seed, "campsiteknown", t.id) < CAMPSITE.KNOWN);
  return def;
}
/** The tents a campsite stands with: their kinds (2–6, its own dice). @param {any} state @param {number} tileId @param {number} i */
export function campTents(state, tileId, i) {
  const n = between(hash01(state.seed, "camptents", tileId, i), CAMPSITE.TENTS);
  const out = [];
  for (let j = 0; j < n; j++) out.push(pickW(CAMPSITE.KINDS, hash01(state.seed, "camptent", tileId, i, j)));
  if (!out.some((k) => TENT_TYPES[k].bag)) out[0] = "tent2"; // a camp with nothing worth taking down is no camp
  return out;
}
/**
 * The camp's state now: "abandoned" | "overrun" | "active", or "cleared" for good. Hash dice by the period.
 * @param {any} state @param {any} tile @param {number} i
 */
export function campState(state, tile, i) {
  const t = tileOf(state, tile);
  const rec = campRec(t, i);
  if (rec && rec.cleared != null) return "cleared";
  const epoch = Math.floor((dayOf(state) - 1) / CAMPSITE.EPOCH);
  const w = { ...CAMPSITE.ODDS, overrun: CAMPSITE.ODDS.overrun + (t.infection || 0) * CAMPSITE.INF_OVERRUN };
  return /** @type {string} */ (pickW(w, hash01(state.seed, "campstate", t.id, i, epoch)));
}
/** The true threat its state adds (pois.js poiThreat). @param {any} state @param {any} t @param {number} i */
export const campDanger = (state, t, i) => (isCampsite(t, i) ? CAMPSITE.DANGER[campState(state, t, i)] || 0 : 0);
/** A survey or a visit sees the camp as it is now (pois.js notePoiThreat). @param {any} state @param {any} t @param {number} i */
export function noteCampSeen(state, t, i) {
  if (!isCampsite(t, i)) return null;
  const rec = campRec(t, i, true);
  rec.seen = { hour: state.hour, state: campState(state, t, i) };
  return rec.seen;
}
/** What was seen of the camp: { state, word, age (days), text } or null (never looked at). @param {any} state @param {any} tile @param {number} i */
export function campSeen(state, tile, i) {
  const t = tileOf(state, tile);
  const rec = isCampsite(t, i) ? campRec(t, i) : null;
  if (!rec || !rec.seen) return null;
  const age = Math.max(0, state.hour - rec.seen.hour) / 24;
  const word = STATE_WORD[rec.seen.state] || rec.seen.state;
  return { state: rec.seen.state, word, age, text: `${word} (${age < 1 ? "seen today" : `seen ${Math.floor(age)}d ago`})` };
}
/** The line the dialogues show: "camp: an active raider camp (seen 2d ago)", "camp: not seen yet", or "" (not a campsite). @param {any} state @param {any} tile @param {number} i */
export function campText(state, tile, i) {
  const t = tileOf(state, tile);
  if (!isCampsite(t, i)) return "";
  const s = campSeen(state, t, i);
  return s ? `camp: ${s.text}` : "camp: who is there is unknown (survey it)";
}

// ---------- the roster ----------
/**
 * The raid's roster at a campsite (scavenge.js startScavenge): the tile's own groups (an active camp keeps fewer of the
 * dead: DEAD_CUT) and the camp's own: the raiders of an active camp, the dead of an abandoned or overrun one (g.camp:
 * their state, so createRaid tags them for campRaidUnits). The world's dice (state.rng), as raidEnemies.
 * @param {any} state @param {any} tile @param {number} i @param {any[]} groups
 */
export function campRoster(state, tile, i, groups) {
  const t = tileOf(state, tile);
  if (!isCampsite(t, i)) return groups;
  const st = campState(state, t, i), rng = state.rng;
  const out = groups.map((g) => (g.kind === "zombies" && !g.surge ? { ...g, count: Math.max(st === "active" ? 0 : 1, Math.round(g.count * (CAMPSITE.DEAD_CUT[st] ?? 1))) } : g)).filter((g) => g.count > 0);
  const inf = t.infection || 0;
  const [dlo, dhi] = CAMPSITE.DEAD[st] || [0, 0];
  const dead = dhi > 0 ? rng.int(dlo, dhi) : 0;
  if (dead > 0) out.push({ kind: "zombies", count: dead, power: 2 + inf * 3, name: st === "overrun" ? "the dead among the tents" : "the dead round the camp", camp: st });
  if (st === "active") out.push({ kind: "raiders", count: rng.int(CAMPSITE.RAIDERS[0], CAMPSITE.RAIDERS[1]), power: CAMPSITE.POWER, name: "the campers (raiders)", guard: true, camp: "active" });
  return out;
}

// ---------- the raid map ----------
/**
 * The camp on a raid map (combat.js createRaid, after genRaidMap made the land and its ways in, with the POI's own map
 * dice so the camp is the same every visit): a clearing round a fire pit in the middle, the tents round it (the ones
 * taken down for good left out, their spots kept), each tent with storage a container, bushes and trees round the
 * clearing, a car now and then. map.camp keeps it for campRaidUnits. Returns map.camp.
 * @param {any} state @param {number} tileId @param {number} poiI @param {any} map @param {number} W @param {number} H @param {any} rng
 * @param {{ kinds?: string[], state?: string, owner?: any }} [opts]
 */
export function campRaidMap(state, tileId, poiI, map, W, H, rng, opts = {}) {
  const t = state.tiles[tileId];
  const kinds = opts.kinds || campTents(state, tileId, poiI);
  const st = opts.state || (poiI != null ? campState(state, t, poiI) : "active");
  const rec = poiI != null ? campRec(t, poiI) : null;
  const gone = new Set((rec && rec.gone) || []);
  const cells = map.cells;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const at = (x, y) => (inside(x, y) ? cells[y * W + x] : null);
  const inZone = (x, y) => map.zones.some((z) => x >= z.x0 - 1 && x <= z.x0 + z.w && y >= z.y0 - 1 && y <= z.y0 + z.h);
  const R = Math.max(3, Math.min(CAMPSITE.CLEAR_R, Math.floor(Math.min(W, H) / 2) - 3));
  const cx = Math.floor(W / 2) + rng.int(-2, 2), cy = Math.floor(H / 2) + rng.int(-1, 1);
  const fixed = (c) => !!c && (c.car || c.k === "water" || c.k === "rail" || c.k === "vehicle" || c.f === "road");
  // The clearing: open ground, trodden to dirt by the fire.
  for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) {
    const c = at(x, y);
    if (!c || inZone(x, y) || fixed(c) || Math.hypot(x - cx, (y - cy) * 1.2) > R + 0.3) continue;
    c.k = "open";
    delete c.hp; delete c.mhp;
    if (Math.hypot(x - cx, y - cy) <= R - 1.5) c.f = "dirt";
  }
  const fire = at(cx, cy);
  fire.k = "firepit";
  if (st === "active") fire.lit = true; else delete fire.lit;
  // The tents round it: each on open ground with a cell all round it clear of the fire and the other tents.
  const taken = new Set([cy * W + cx]);
  const tents = [];
  let cid = map.containers.reduce((a, c) => Math.max(a, c.id || 0), 0) + 1;
  const area = { id: map.areas.length, type: "campsite", name: "Campsite", x0: cx - R, y0: cy - R, w: 2 * R + 1, h: 2 * R + 1, outdoor: true };
  map.areas.push(area);
  const n = kinds.length;
  for (let j = 0; j < n; j++) {
    const kind = kinds[j], T = TENT_TYPES[kind] || TENT_TYPES.tent1;
    const turn = T.w !== T.h && rng.chance(0.5);
    const w = turn ? T.h : T.w, h = turn ? T.w : T.h;
    let spot = null;
    for (let tries = 0; tries < 60 && !spot; tries++) {
      const a = (j / n) * Math.PI * 2 + rng.next() * 0.9 + (tries > 20 ? rng.next() * 6 : 0);
      const rr = 2.2 + rng.next() * Math.max(0.5, R - 2.6) + (tries > 40 ? 1 : 0);
      const x0 = Math.round(cx + Math.cos(a) * rr - (w - 1) / 2), y0 = Math.round(cy + Math.sin(a) * rr - (h - 1) / 2);
      let ok = true;
      for (let y = y0 - 1; y <= y0 + h && ok; y++) for (let x = x0 - 1; x <= x0 + w && ok; x++) {
        const c = at(x, y), foot = x >= x0 && y >= y0 && x < x0 + w && y < y0 + h;
        if (foot && (!c || c.k !== "open" || inZone(x, y) || fixed(c))) ok = false;
        else if (taken.has(y * W + x)) ok = false;
      }
      if (ok) spot = [x0, y0];
    }
    if (!spot) continue;
    const foot = [];
    for (let y = spot[1]; y < spot[1] + h; y++) for (let x = spot[0]; x < spot[0] + w; x++) { foot.push([x, y]); taken.add(y * W + x); }
    const id = T.storeKg > 0 ? cid++ : null; // the container's id kept whether it stands or not (the ledger's ids)
    if (gone.has(j)) continue; // taken down for good: its spot stays open ground
    for (const [x, y] of foot) { const c = at(x, y); c.k = "tent"; c.f = c.f === "dirt" ? "dirt" : c.f; c.mhp = TENT_FIGHT.HP; c.hp = TENT_FIGHT.HP; }
    const tent = { i: j, kind, cells: foot, box: id };
    if (id != null) map.containers.push({ id, x: spot[0], y: spot[1], w, h, area: area.id, kind: "tent", tent: j, tentKind: kind, cap: T.storeKg, searched: false, label: T.name });
    tents.push(tent);
  }
  // The wear: a share of the tents torn by the state (hash dice: the same tents), or as the last visit left them.
  const hp = (rec && rec.hp) || {};
  for (const tent of tents) {
    let pct = hp[tent.i];
    if (pct == null && (CAMPSITE.TORN[st] || 0) > 0 && hash01(state.seed, "camptorn", tileId, poiI ?? -1, tent.i) < CAMPSITE.TORN[st]) pct = Math.round(hash01(state.seed, "camptornpct", tileId, poiI ?? -1, tent.i) * 60);
    if (pct == null || pct >= 100) continue;
    let left = tent.cells.length * TENT_FIGHT.HP * (pct / 100); // the share spread over its cells: the last cells torn first
    for (const [x, y] of tent.cells) {
      const c = at(x, y);
      const v = Math.max(0, Math.min(TENT_FIGHT.HP, Math.round(left)));
      left -= v;
      c.hp = v;
      if (v <= 0) { c.k = "torn"; c.hp = 0; }
    }
  }
  // The land round the clearing: bushes and a few trees (on open ground only, never in a way in).
  for (let y = cy - R - 3; y <= cy + R + 3; y++) for (let x = cx - R - 3; x <= cx + R + 3; x++) {
    const c = at(x, y);
    if (!c || c.k !== "open" || inZone(x, y) || fixed(c) || taken.has(y * W + x)) continue;
    const d = Math.hypot(x - cx, (y - cy) * 1.2);
    if (d <= R + 0.5 || d > R + 3) continue;
    const u = rng.next();
    if (u < 0.22) c.k = "bush";
    else if (u < 0.3 && t && t.terrain !== "plains") c.k = "tree";
  }
  // A car (one of the campers', its doors to search) or a hand cart (carts.js placeMapCarts: none of its own here).
  let car = null;
  if (rng.chance(CAMPSITE.CAR)) {
    for (let tries = 0; tries < 30 && !car; tries++) {
      const a = rng.next() * Math.PI * 2, x = Math.round(cx + Math.cos(a) * (R + 1)), y = Math.round(cy + Math.sin(a) * (R + 1));
      const ax = rng.chance(0.5) ? "x" : "y", L = 3, w = ax === "x" ? L : 2, h = ax === "x" ? 2 : L;
      let ok = true;
      for (let yy = y - 1; yy <= y + h && ok; yy++) for (let xx = x - 1; xx <= x + w && ok; xx++) { const c = at(xx, yy); if (!c || c.k !== "open" && c.k !== "bush" || inZone(xx, yy) || taken.has(yy * W + xx) || fixed(c)) ok = false; }
      if (!ok) continue;
      const id = y * W + x + 1;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const c = at(xx, yy); c.k = "car"; c.car = { id, i: ax === "x" ? xx - x : yy - y, j: ax === "x" ? yy - y : xx - x, L, ax, kind: "car", v: rng.int(0, 1e6), body: "car" }; taken.add(yy * W + xx); }
      car = { x, y, w, h };
      map.containers.push({ id: cid++, x, y, w, h, area: area.id, kind: "car", searched: false, label: "Campsite: car" });
    }
  }
  // Every way in reaches the fire: a path cut from the entry when the land is in the way.
  const z = map.zones[0];
  const reach = floodW(cells, W, H, z.x0 + 1, z.y0 + 1);
  if (!reach[cy * W + cx + 1] && !reach[cy * W + cx - 1]) carve(cells, W, H, z.x0 + 1, z.y0 + 1, cx - 1, cy);
  map.reach = floodW(cells, W, H, z.x0 + 1, z.y0 + 1);
  map.camp = { cx, cy, R, state: st, lit: st === "active", tents, car, poi: poiI, tile: tileId };
  return map.camp;
}
function floodW(cells, W, H, sx, sy) {
  const seen = new Uint8Array(W * H);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return seen;
  if (!CELL[cells[sy * W + sx].k].walk) cells[sy * W + sx].k = "open";
  const q = [sy * W + sx];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop(), x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!seen[j] && CELL[cells[j].k].walk) { seen[j] = 1; q.push(j); }
    }
  }
  return seen;
}
function carve(cells, W, H, x0, y0, x1, y1) {
  let x = x0, y = y0;
  const step = () => { const c = cells[y * W + x]; if (c && !CELL[c.k].walk && !c.car && c.k !== "water" && c.k !== "rail" && c.k !== "vehicle" && c.k !== "firepit") c.k = "open"; };
  while (x !== x1) { x += Math.sign(x1 - x); step(); }
  while (y !== y1) { y += Math.sign(y1 - y); step(); }
}

// ---------- the people and the dead ----------
const cheb = (a, x, y) => Math.max(Math.abs(a.x - x), Math.abs(a.y - y));
/**
 * The camp's people on the map (combat.js createRaid after everyone is placed; the "campsite" layout's units phase):
 * its tents on the battle's list (tentfight.js addTent: whose camp, who loses them), the campers round the fire (one
 * pod), at night some of them asleep in the tents (u.asleep: unaware, inside, concealed; noise wakes them: alertNear),
 * the dead of an overrun camp among the tents (some of them campers turned), the campers' bodies to search, the lit
 * fire's glow at night. Returns how many slept.
 * @param {any} state @param {any} b @param {any} C the camp (map.camp) @param {{ owner?: (tent: any) => any, side?: string | null, item?: (tent: any) => any }} [opts]
 */
export function campRaidUnits(state, b, C, opts = {}) {
  if (!C) return 0;
  const W = b.w;
  const side = opts.side !== undefined ? opts.side : C.state === "active" ? "enemy" : null;
  for (const tent of C.tents) {
    const owner = opts.owner ? opts.owner(tent) : C.poi != null ? { tile: C.tile, poi: C.poi, i: tent.i } : null;
    tent.id = addTent(b, { kind: tent.kind, cells: tent.cells, side, owner, box: tent.box, item: opts.item ? opts.item(tent) : null }).id;
  }
  b.soft = undefined; b.anyTent = undefined;
  // The lit fire: its glow lights the clearing at night as a flare does (your people see what stands in it).
  if (C.lit) (b.flares || (b.flares = [])).push({ x: C.cx, y: C.cy, r: CAMPSITE.FIRE_R, turns: 9999, camp: true });
  const free = (x, y) => x >= 0 && y >= 0 && x < W && y < b.h && CELL[b.cells[y * W + x].k].walk && !unitAt(b, x, y) && (!b.raid || !b.raid.zones.some((z) => x >= z.x0 && x < z.x0 + z.w && y >= z.y0 && y < z.y0 + z.h));
  /** @param {number} r0 @param {number} r1 @param {(x: number, y: number) => boolean} [test] */
  const ringSpot = (r0, r1, test = () => true) => {
    const list = [];
    for (let y = C.cy - r1; y <= C.cy + r1; y++) for (let x = C.cx - r1; x <= C.cx + r1; x++) {
      const d = Math.hypot(x - C.cx, y - C.cy);
      if (d < r0 || d > r1 || !free(x, y) || !test(x, y)) continue;
      list.push([x, y, d]);
    }
    return list.length ? b.rng.pick(list) : null;
  };
  const tentCell = (x, y) => b.cells[y * W + x].k === "tent";
  const campers = b.units.filter((u) => u.side === "enemy" && u.camp === "active" && u.kind === "human");
  const pod = campers.length ? campers[0].pod : null;
  const night = !!(b.night || (state && isNight(state)));
  let slept = 0;
  const inTent = {};
  campers.forEach((u, k) => {
    u.pod = pod;
    u.aware = false;
    let spot = null;
    if (night && b.rng.chance(CAMPSITE.ASLEEP)) {
      // Asleep in a tent: a tent cell, at most PER_TENT a tent.
      const cands = C.tents.filter((tt) => (inTent[tt.id] || 0) < CAMPSITE.PER_TENT && b.cells[tt.cells[0][1] * W + tt.cells[0][0]].tentId === tt.id);
      for (const tt of b.rng.shuffle(cands.slice())) { const c = tt.cells.find(([x, y]) => tentCell(x, y) && !unitAt(b, x, y)); if (c) { spot = c; inTent[tt.id] = (inTent[tt.id] || 0) + 1; break; } }
      if (spot) { u.asleep = true; slept++; }
    }
    if (!spot) spot = ringSpot(1, 3);
    if (!spot) return;
    u.x = spot[0]; u.y = spot[1];
    u.home = [C.cx, C.cy];
    if (!u.asleep) u.face = [Math.sign(C.cx - u.x), Math.sign(C.cy - u.y)];
    else u.face = [0, 1];
    void k;
  });
  if (slept) say(b, `The camp is quiet: ${slept} of them ${slept === 1 ? "is" : "are"} asleep in the tents, the rest by the fire. Noise will wake them.`, "info");
  // The dead of an overrun camp: among the tents, some of them the campers turned.
  const dead = b.units.filter((u) => u.side === "enemy" && u.kind === "zombie" && u.camp === "overrun");
  for (const u of dead) {
    const spot = ringSpot(1.5, C.R + 1);
    if (!spot) continue;
    u.x = spot[0]; u.y = spot[1]; u.home = [spot[0], spot[1]];
    if (b.rng.chance(CAMPSITE.TURNED)) { u.name = u.name.replace(/^[^ ]+/, "Turned camper"); u.turnedCamper = true; }
  }
  // The campers' bodies: one in a tent's door, the rest by the fire (containers to search; the picture with the bodies).
  const [blo, bhi] = CAMPSITE.BODIES[C.state] || [0, 0];
  const nb = bhi > 0 ? b.rng.int(blo, bhi) : 0;
  const L = b.raid ? b.raid : null;
  for (let k = 0; k < nb && L; k++) {
    const spot = ringSpot(1, C.R);
    if (!spot) break;
    const gun = b.rng.chance(0.3) ? b.rng.pick(["huntrifle", "shotgun", "pistol", "rifle22", "revolver"]) : null;
    L.containers.push({ id: b.nextId++, x: spot[0], y: spot[1], f: 0, kind: "body", area: null, searched: false, kit: "survivors", weapon: gun, label: "A camper's body", uid: null });
    (b.corpses || (b.corpses = [])).push({ id: 900 + k, x: spot[0], y: spot[1], seed: b.rng.int(0, 99999), sleeper: false });
  }
  C.slept = slept;
  return slept;
}
/**
 * A camper asleep in a tent (combat.js aiUnit, before anything else): sleeps on while unaware (no turn, no looking
 * about); woken (the noise: combat.js alertNear, a blow, the alarm) they crawl out with one action this turn.
 * Returns true when the turn is spent.
 * @param {any} b @param {any} u
 */
export function campSleeperTurn(b, u) {
  if (!u.asleep) return false;
  if (!u.aware) { u.ap = 0; return true; }
  delete u.asleep;
  u.ap = Math.min(u.ap, 1);
  say(b, `${u.name} scrambles out of a tent.`, "danger");
  return u.ap < 1;
}

// ---------- the loot ----------
const CAMP_GEAR = { stove: 2, headlamp: 2, lantern: 1.5, waterfilter: 1, puritabs: 1.5, handwarmer: 1, flare: 1, lighters: 1.5, cookpot: 1, hikingpack: 0.8, backpack: 1, knife: 1.2, hatchet: 0.8, torch: 1, solarlantern: 0.5, instcoffee: 1, cards: 0.8, chocolate: 1.2, tripwire: 0.5 };
const CAMP_GUNS = { huntrifle: 2, shotgun: 1.5, rifle22: 1.5, pistol: 1.2, revolver: 1, leverrifle: 0.8, dbshotgun: 0.8 };
/**
 * What a campsite tent holds (combat.js searchBox, a container of kind "tent"; the POI's container dice): sized by its
 * storage (storeKg × FILL × the state's RICH × the raid's richness), food and water first, camp gear, rounds and a gun
 * now and then (more at an active camp), a spare tent bag. { sup, gear }.
 * @param {any} state @param {any} rng @param {any} box @param {number} rich @param {number} scav @param {string} st
 */
export function tentBoxLoot(state, rng, box, rich, scav, st) {
  const sup = {}, gear = [];
  const cap = box.cap || (TENT_TYPES[box.tentKind] ? TENT_TYPES[box.tentKind].storeKg : TENT_S);
  const fill = (CAMPSITE.FILL[0] + rng.next() * (CAMPSITE.FILL[1] - CAMPSITE.FILL[0])) * (CAMPSITE.RICH[st] || 1) * Math.min(1.3, 0.5 + rich * 0.6) * (1 + scav / 40);
  let kg = cap * fill;
  const src = "site";
  // Food and water: about half the weight.
  const food = Math.max(0, Math.round((kg * 0.3) / supWeight("food")));
  if (food > 0) { sup.food = food; kg -= food * supWeight("food"); }
  const water = Math.max(0, Math.round((kg * 0.25) / supWeight("water")));
  if (water > 0) { sup.water = water; kg -= water * supWeight("water"); }
  // Rounds now and then (sorted by calibre with the rest of the find: combat.js sortFind).
  if (rng.chance(CAMPSITE.AMMO * (st === "active" ? 1.5 : 1))) sup.ammo = rng.int(4, 14);
  // A gun now and then.
  if (rng.chance(CAMPSITE.GUN[st] ?? 0.08)) { const key = pickW(CAMP_GUNS, rng.next()); if (GEAR[key]) { const it = lootItem(key, src, rng); gear.push(it); kg -= (GEAR[key].weight || 3); } }
  // Camp gear while the weight lasts.
  for (let k = 0; k < 6 && kg > 0.3; k++) {
    const key = pickW(CAMP_GEAR, rng.next());
    if (!GEAR[key] || gear.some((g) => g.key === key)) continue;
    const it = lootItem(key, src, rng);
    gear.push(it);
    kg -= GEAR[key].weight || 0.5;
  }
  // A spare tent bag in a bigger tent.
  if (cap >= 2 * TENT_S && rng.chance(CAMPSITE.BAG)) gear.push(lootItem(rng.chance(0.7) ? "tent1" : "tent2", src, rng));
  return { sup, gear };
}

// ---------- the end ----------
/**
 * The fight is over (combat.js finishCombat, before the handler): a campsite raid keeps its tents' wear and, with
 * nobody of the camp's still standing on the map, is cleared for good; a band's camp gets back what is left in its
 * tents' piles (bandStores). Returns { cleared, back } (tests).
 * @param {any} state @param {any} b @param {any} result
 */
export function campAfter(state, b, result) {
  const out = { cleared: false, back: 0 };
  if (!b) return out;
  const C = (b.raid && b.raid.camp) || b.camp || null;
  if (C && C.poi != null && b.raid) {
    const t = state.tiles[C.tile];
    const rec = campRec(t, C.poi, true);
    if (rec) {
      // The wear of the tents still standing (their share of hit points), by their index on the POI.
      for (const tt of b.tents || []) {
        if (!tt.owner || tt.owner.poi !== C.poi || tt.down) continue;
        let hp = 0;
        for (const [x, y] of tt.cells) { const c = b.cells[y * b.w + x]; if (c && c.k === "tent") hp += Math.max(0, c.hp ?? TENT_FIGHT.HP); }
        const pct = Math.round((hp / (tt.cells.length * TENT_FIGHT.HP)) * 100);
        if (pct >= 100) delete rec.hp[tt.owner.i]; else rec.hp[tt.owner.i] = pct;
      }
      // Cleared: the camp's people and dead all down, dead or gone (and your people got in at all).
      const campers = b.units.filter((u) => u.side === "enemy" && u.camp);
      const anyIn = b.units.some((u) => u.side === "player" && (u.left || !u.dead || u.x != null));
      if (C.state !== "cleared" && anyIn && !(result && result.raid && result.raid.calledOff) && campers.every((u) => u.dead || u.down || u.fled || u.ko)) {
        rec.cleared = dayOf(state);
        rec.by = "player";
        out.cleared = true;
      }
    }
  }
  // A band's camp: what is left in its tents' piles goes back to it.
  if (b.bandStores) out.back = bandStoresBack(state, b);
  return out;
}
/** A campsite's tent gone for good (tentfight.js settleTentsDown): off the POI's list of tents. @param {any} state @param {{ tile: number, poi: number, i: number }} O */
export function campTentGone(state, O) {
  const tt = state.tiles[O.tile];
  const rec = tt ? campRec(tt, O.poi, true) : null;
  if (!rec) return;
  if (!rec.gone.includes(O.i)) rec.gone.push(O.i);
  delete rec.hp[O.i];
}

// ---------- AI raids on a campsite ----------
/**
 * Another group's (or band's) raid on a campsite (grouppois.js raidPoiAsGroup): up to CAMPSITE.AI_BAGS of its standing
 * tents carried off as bags (the biggest first, a torn one damaged), the rest left; the camp cleared (they drove off
 * or put down whoever was there). Returns the bags (into their haul).
 * @param {any} state @param {any} who @param {any} tile @param {number} i
 */
export function campGroupRaid(state, who, tile, i) {
  const t = tileOf(state, tile);
  if (!isCampsite(t, i)) return [];
  const rec = campRec(t, i, true);
  const kinds = campTents(state, t.id, i);
  const st = campState(state, t, i);
  const stand = kinds.map((k, j) => ({ k, j })).filter(({ k, j }) => TENT_TYPES[k].bag && !rec.gone.includes(j));
  stand.sort((a, c) => TENT_TYPES[c.k].sleepers - TENT_TYPES[a.k].sleepers || a.j - c.j);
  const out = [];
  for (const { k, j } of stand.slice(0, CAMPSITE.AI_BAGS)) {
    const pct = rec.hp[j] ?? (CAMPSITE.TORN[st] > 0 && hash01(state.seed, "camptorn", t.id, i, j) < CAMPSITE.TORN[st] ? Math.round(hash01(state.seed, "camptornpct", t.id, i, j) * 60) : 100);
    if (pct <= 20) continue; // rags: not worth carrying
    const it = lootItem(k, "site", [state.seed, "campai", t.id, i, j]);
    if (pct < 100) it.tentHp = pct;
    out.push(it);
    rec.gone.push(j);
    delete rec.hp[j];
  }
  if (rec.cleared == null) { rec.cleared = dayOf(state); rec.by = who && typeof who === "object" ? who.id : who; }
  return out;
}

// ---------- a band's camp in a fight (nomads.js, visitors.js) ----------
/**
 * The tents a band's camp stands with: its bags (nomads' and raiders' shelves, tents.js bandTentBags), a drifters'
 * band makeshift ones for its heads (two a makeshift... one each, at most 4). [{ kind, item }].
 * @param {any} band @param {number} heads
 */
export function bandCampTents(band, heads) {
  const bags = ((band && band.wares) || []).filter((it) => it && GEAR[it.key] && GEAR[it.key].tent && TENT_TYPES[GEAR[it.key].tent] && TENT_TYPES[GEAR[it.key].tent].bag);
  const out = bags.slice(0, 6).map((it) => ({ kind: GEAR[it.key].tent, item: it }));
  if (!out.length) for (let k = 0; k < Math.max(1, Math.min(4, heads || 2)); k++) out.push({ kind: "makeshift", item: null });
  return out;
}
const bandOf = (state, ref) => {
  if (!ref) return null;
  const list = ref.band === "visitor" ? state.visitors || [] : (state.nomads && state.nomads.bands) || [];
  return list.find((x) => x.id === ref.id) || null;
};
// A share of the band's stores into its tents' piles (BAND_STORES of its stock by kg, at most a tent's storage each;
// items off its shelf too, never a tent bag): taken off the band while the fight lasts (bandStoresBack returns what is
// left). The piles are kept apart from the battle's ground (ground.js groundLeftovers skips c.bandStore).
function bandStores(state, b, band, ref, C) {
  if (!band || !band.stock) return;
  fieldReady(b, state);
  const L = fieldLayer(b);
  const boxes = [];
  for (const tent of C.tents) {
    const T = TENT_TYPES[tent.kind];
    if (!T || !(T.storeKg > 0)) continue;
    const [x, y] = tent.cells[0];
    const c = { id: b.nextId++, x, y, f: 0, kind: "ground", drop: false, bandStore: { ...ref }, area: null, searched: false, partial: true, label: `In their ${T.name.toLowerCase()}`, contents: { sup: {}, gear: [] }, cap: T.storeKg };
    tent.box = c.id;
    L.containers.push(c);
    boxes.push(c);
  }
  if (!boxes.length) return;
  let budget = 0;
  for (const [k, q] of Object.entries(band.stock)) if (SUPPLIES[k] && q > 0) budget += q * supWeight(k);
  budget *= CAMPSITE.BAND_STORES;
  for (const c of boxes) {
    let room = Math.min(c.cap, budget);
    for (const k of Object.keys(band.stock)) {
      const q = Math.floor(band.stock[k] || 0), w = supWeight(k);
      if (!SUPPLIES[k] || q <= 0 || !(w >= 0)) continue;
      const n = Math.min(q, Math.floor(Math.max(0, room) / Math.max(0.01, w)), Math.ceil(q / boxes.length));
      if (n <= 0) continue;
      band.stock[k] -= n; c.contents.sup[k] = (c.contents.sup[k] || 0) + n; room -= n * w; budget -= n * w;
    }
  }
  // A few things off the shelf (not the tents themselves): one a tent.
  const items = (band.wares || []).filter((it) => it && !(GEAR[it.key] && GEAR[it.key].tent));
  boxes.forEach((c, k) => { const it = items[k]; if (it) { band.wares.splice(band.wares.indexOf(it), 1); c.contents.gear.push(it); } });
  b.bandStores = { ...ref };
}
function bandStoresBack(state, b) {
  const band = bandOf(state, b.bandStores);
  const L = b.fieldLoot;
  let n = 0;
  for (const c of (L && L.containers) || []) {
    if (!c.bandStore) continue;
    if (band) {
      for (const [k, q] of Object.entries(c.contents.sup)) if (q > 0) { band.stock[k] = (band.stock[k] || 0) + q; n++; }
      for (const it of c.contents.gear) { (band.wares || (band.wares = [])).push(it); n++; }
    }
    c.contents = { sup: {}, gear: [] };
    c.searched = true; c.partial = false;
  }
  b.bandStores = null;
  return n;
}
// The battle layout "campsite" (a band's camp: setup.layout, setup.context.campBand { band: "nomad" | "visitor", id }):
// the map phase lays the clearing on the far side of the map with the band's own tents; the units phase puts their
// people round the fire or asleep in the tents by the hour, and their stores in the tents.
registerBattleLayout("campsite", (b, ctx) => {
  const ref = b.setup && b.setup.context && b.setup.context.campBand;
  const band = ref ? bandOf(ctx.state, ref) : null;
  if (ctx.phase === "map") {
    const heads = band ? band.pop || band.size || 4 : 4;
    const list = bandCampTents(band, heads);
    const W = ctx.W, H = ctx.H;
    // A raid-map shape for campRaidMap: one way in on your side (the west), the camp toward the far side.
    const map = { cells: b.cells, zones: [{ x0: 0, y0: Math.max(0, Math.floor(H / 2) - 1), w: 2, h: 3, side: "west" }], containers: [], areas: [] };
    const rng = new Rng(Math.floor(hash01(ctx.state.seed, "bandcamp", ref ? ref.id : 0, b.tileId) * 4294967296) >>> 0);
    const C = campRaidMap(ctx.state, b.tileId, null, { ...map, cells: b.cells }, W, H, rng, { kinds: list.map((x) => x.kind), state: "active" });
    // Toward their side: shift the camp east by redrawing is costly; it stands in the middle, your people start west.
    C.items = list.map((x) => x.item);
    b.camp = C;
    return;
  }
  const C = b.camp;
  if (!C) return;
  for (const u of b.units) if (u.side === "enemy" && u.kind === "human") u.camp = "active";
  campRaidUnits(ctx.state, b, C, { side: "enemy", owner: () => (ref ? { band: ref.band, id: ref.id } : null), item: (tent) => (C.items ? C.items[C.tents.indexOf(tent)] || null : null) });
  if (band && ref) bandStores(ctx.state, b, band, ref, C);
});

