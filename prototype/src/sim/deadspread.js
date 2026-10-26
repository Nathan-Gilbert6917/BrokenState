// @ts-check
// The spread of the dead between tiles (the heat epic #64 §8, issue #66; the user's request 2026-10-26: "I want tiles
// to leech into each other at a slow rate so if a tile is high rate from a city tile per se and there is a rural tile
// the city tile will slowly increase the level of the tiles around it until the rural tile gets a higher rate but theres
// a cap to the level in rural areas as there is not many people to infect. … The leeching is slow and can be slowed more
// by killing more zombies." / "Spread out from the towns and cities and hive tiles outwards to adjacent tiles once it
// hits the cap for the tile it stops spreading if all adjacent tiles are full" / "Infection with land and worms
// increases the rate of spread").
//
// ONCE A DAY (spreadDaily, from deadpop.js deadPopSpread, right after deadPopDaily at midnight), one pass over the map:
//   - SOURCES: the tiles of the towns and cities (placement.js tileClass centre, city, suburb, town: a city's suburbs are
//     its land) and the hives' own tiles (state.hives). A source pushes its own count of the dead (deadpop.js tileDead)
//     and keeps it: it does not lose what it spreads.
//   - THE FRONT: a tile at its cap (deadpop.js popCap) that a push reaches passes it on at the same level to its own
//     adjacent tiles (a relay). So the dead fill the land ring by ring out from the towns, cities and hives: the ring
//     next to a source fills first, then passes the push on, and spreading through a tile stops once all of its
//     neighbours are full. Each tile takes the strongest push reaching it (the highest level), not their sum.
//   - THE RATE into a tile below its cap: LEECH × (the push's level, at most its own cap, − its own count) a day, × (1 + INF × the mean of
//     the two tiles' infection), × (1 + HIVE on a hive's land: the worm's ground, hives.js zombieToughness), × RIVER
//     across a river (a river is a hex of water: the push hops it to the bank beyond), not when it is frozen
//     (weather.js riverFrozen) or bridged, × 1 / (1 + KILL × the receiver's recent kills, deadpop.js recentKills:
//     yours and the groups' alike). Never more than the room under the receiver's cap. A fraction rounds up on a hash
//     die (skills.js hash01 of the seed, the tile, the day): deterministic, never state.rng.
//   - The inflow lands on the receiver's open ground (deadpop.js putBack, no POI); deadPopDaily's refill moves it into
//     its POIs. Infection speeds the spread but never raises a cap, and t.infection is not read back from the counts.
//   - Every rate uses the counts as they stood at the start of the pass, so the order tiles are visited in never matters.
// Lakes and the sea (water without a river) stop it. The lands' caps (DEADPOP.CAP) are what make rural land always
// hold fewer than a city: a farm beside a city fills to its own 36 and stops.
// PERFORMANCE: the pass visits the sources, the relays and the tiles next to them only, with typed scratch arrays kept
// per map (no allocation per tile); a hex's neighbours are worked out in place (hex.js's arithmetic).
// AI PARITY (docs/adr/0001): the groups' kills (deadpop.js aiRaidKills, their fights through deadPopBattleEnd) go into
// the same recent-kill memory, so their hunting slows the spread the same way.
/** @import { State } from "./types" */
import { hash01 } from "./skills.js";
import { tileClass } from "./placement.js";
import { riverFrozen } from "./weather.js";
import { zombieToughness } from "./hives.js"; // call-time only
import { popCap, recentKills, putBack, deadNow } from "./deadpop.js"; // call-time only (deadpop.js calls this module)

export const DEADSPREAD = {
  LEECH: 0.01,      // the share of the gap a day (the gap: the push's level, at most the receiver's cap, − its count)
  INF: 2,           // × (1 + INF × infection): fully infected ground fills three times as fast
  HIVE: 0.5,        // × (1 + HIVE) on a hive's land (the worm's ground)
  RIVER: 0.5,       // across a river that is not frozen or bridged
  KILL: 0.2,        // × 1 / (1 + KILL × recent kills): 5 kills lately halve it
  SOURCES: ["centre", "city", "suburb", "town"], // the land classes that spread (and the hives' tiles)
};

// Odd-r hex neighbours (hex.js EVEN_DIRS / ODD_DIRS).
const EVEN = [1, 0, 0, -1, -1, -1, -1, 0, -1, 1, 0, 1];
const ODD = [1, 0, 1, -1, 0, -1, -1, 0, 0, 1, 1, 1];

// Per-map scratch: stamps say which entries are this pass's. Kept off the state (not saved).
/** @type {WeakMap<object, any>} */
const scratch = new WeakMap();
function buffers(tiles) {
  let b = scratch.get(tiles);
  if (!b || b.n !== tiles.length) {
    const n = tiles.length;
    b = {
      n, pass: 0,
      seen: new Int32Array(n), dead: new Float64Array(n), cap: new Float64Array(n), // the counts at the pass's start
      lvlAt: new Int32Array(n), lvl: new Float64Array(n),                            // a push reaching a full tile
      bestAt: new Int32Array(n), best: new Float64Array(n),                          // a receiver's strongest inflow
      recv: new Int32Array(n), queue: /** @type {number[]} */ ([]),
    };
    scratch.set(tiles, b);
  }
  return b;
}

/**
 * The day's spread (the header). Returns { sources, relays, receivers, moved } for the tools and tests; opts.rates (a
 * Map) gets each receiver's inflow before rounding, opts.dry moves nothing.
 * @param {State} state @param {{ rates?: Map<number, number>, dry?: boolean }} [opts]
 */
export function spreadDaily(state, opts = {}) {
  const out = { sources: 0, relays: 0, receivers: 0, moved: 0 };
  const g = state.grid, tiles = state.tiles;
  if (!g || !tiles || !tiles.length) return out;
  const W = g.width, H = g.height, b = buffers(tiles);
  const pass = ++b.pass, D = DEADSPREAD;
  const day = Math.floor((state.hour || 0) / 24) + 1;
  // The counts at the pass's start (once per tile per pass).
  const look = (id) => {
    if (b.seen[id] !== pass) {
      b.seen[id] = pass;
      const t = tiles[id];
      b.cap[id] = t.terrain === "water" ? 0 : popCap(state, t);
      b.dead[id] = b.cap[id] > 0 ? deadNow(state, t) : 0;
    }
  };
  const hiveTiles = new Set((state.hives || []).map((h) => h.tile));
  const isSource = (t) => t.terrain !== "water" && (hiveTiles.has(t.id) || D.SOURCES.includes(tileClass(state, t)));
  const q = b.queue;
  q.length = 0;
  for (let id = 0; id < tiles.length; id++) {
    const t = tiles[id];
    if (!isSource(t)) continue;
    look(id);
    if (b.cap[id] <= 0 || b.dead[id] <= 0) continue;
    out.sources++;
    b.lvlAt[id] = pass; b.lvl[id] = b.dead[id];
    q.push(id);
  }
  let nr = 0;
  const infK = (a, c) => 1 + D.INF * (((tiles[a].infection || 0) + (tiles[c].infection || 0)) / 2);
  // A push of level L from tile `from` reaches tile `to` (riverK: the crossing's).
  const reach = (from, to, L, riverK) => {
    look(to);
    const cap = b.cap[to];
    if (cap <= 0) return;
    if (b.dead[to] >= cap) {
      // Full: a relay, at the strongest level reaching it.
      if (b.lvlAt[to] !== pass || b.lvl[to] < L) {
        if (b.lvlAt[to] !== pass && !isSource(tiles[to])) out.relays++;
        b.lvlAt[to] = pass; b.lvl[to] = L;
        q.push(to);
      }
      return;
    }
    const gap = Math.min(L, cap) - b.dead[to]; // the push fills it up to its own cap, never past it
    if (gap <= 0) return;
    const rate = gap * riverK * infK(from, to);
    if (b.bestAt[to] !== pass) { b.bestAt[to] = pass; b.best[to] = rate; b.recv[nr++] = to; }
    else if (rate > b.best[to]) b.best[to] = rate;
  };
  // Each step of the hex grid from id (a river hops to the far bank).
  for (let qi = 0; qi < q.length; qi++) {
    const id = q[qi], L = b.lvl[id];
    const x = id % W, y = (id - x) / W, dirs = y & 1 ? ODD : EVEN;
    for (let k = 0; k < 12; k += 2) {
      const nx = x + dirs[k], ny = y + dirs[k + 1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nid = ny * W + nx, nt = tiles[nid];
      if (nt.terrain !== "water") { reach(id, nid, L, 1); continue; }
      if (!nt.river) continue; // a lake, the sea
      const rk = nt.bridge || riverFrozen(state, nid) ? 1 : D.RIVER;
      const dirs2 = ny & 1 ? ODD : EVEN;
      for (let j = 0; j < 12; j += 2) {
        const fx = nx + dirs2[j], fy = ny + dirs2[j + 1];
        if (fx < 0 || fy < 0 || fx >= W || fy >= H) continue;
        const fid = fy * W + fx;
        if (fid === id || tiles[fid].terrain === "water" || g.distance(id, fid) < 2) continue; // the near bank
        reach(id, fid, L, rk);
      }
    }
  }
  // The inflows, in tile order, from the counts at the start.
  const list = b.recv.subarray(0, nr).sort();
  for (let i = 0; i < nr; i++) {
    const id = list[i], t = tiles[id];
    const hive = zombieToughness(state, id) > 0 ? 1 + D.HIVE : 1;
    const want = D.LEECH * b.best[id] * hive / (1 + D.KILL * recentKills(state, t));
    const room = b.cap[id] - b.dead[id];
    let n = Math.floor(want);
    if (hash01(state.seed, "dpspread", id, day) < want - n) n++;
    n = Math.min(n, Math.floor(room));
    out.receivers++;
    if (opts.rates) opts.rates.set(id, want);
    if (n > 0 && !opts.dry) out.moved += putBack(state, t, null, n);
  }
  return out;
}
