// @ts-check
// The base map's scatter (the user's request 2026-10-20: "There are scatter boxes and such; I want there to be scatter
// fences, trees, etc."): the ground round every base is dressed by its land instead of the crates, barrels and hay the
// map used to top itself up with. Forest: tree clumps, single trees, bushes, fallen logs and stumps; farmland: old
// fence runs with gaps in them, a lone tree, bushes, a hay bale; hills and mountains: rocks and boulders with a few
// bushes and trees; the suburbs: fences, trees, bushes and the odd wrecked car; the city: wrecked cars and trucks,
// crates, barrels and broken fences. The yard itself is cleared ground: stumps where trees stood, a log, a crate or
// a barrel left lying about (cover for a fight in it), never a tree, a bush or a fence.
//
// One layer for the land, made once: it is fixed in grid coordinates (relative to the middle of the base) and comes
// from the tile alone (scatterSeed), chunk by chunk (SCATTER.CHUNK cells square, each from dice of its own), so it is
// the same whatever is built, moved, queued or pulled down, as the grid grows, in the Base map view and on the battle
// map of a raid or a horde alike; what is placed only hides the scatter under it and round it (the buffers the base
// map keeps: basemap.js buildBaseMap). Nothing here is a thing of the base's: scatter takes no building room and is
// cleared by building over it (the ground is cleared for the site), as the old cover was.
//
// What blocks: trees, bushes, fences, rocks, boulders, stumps, logs, wrecks, crates, barrels and hay bales are all
// solid cover on the battle map (combat.js CELL), none walkable; a wreck is a 2-cell-wide car or truck (combat.js
// placeCar). A piece that would shut off open ground from the map's edge is taken away again (unpocket), so the
// scatter never closes a way in or out.
//
// The AI groups' walled bases (fort.js buildFort without a grid) dress their margin with the same layer (ADR 0001).
import { Rng } from "./rng.js";

export const SCATTER = {
  CHUNK: 8,        // cells a side of a chunk of the layer, each made from its own dice
  YARD_P: 0.8,     // the chance a chunk leaves one or two things lying in the yard (shown only there)
  STUMP_P: 0.1,    // the chance a tree of the layer standing in the yard is a stump instead (else cleared)
  UNPOCKET: 6,     // rounds of taking away scatter that shuts off open ground
};
// The land's dressing by terrain: n pieces a chunk (range) and the weights of what they are.
export const PROFILES = {
  forest:   { n: [2, 4], w: { clump: 4, tree: 3, bush: 3, log: 2, stump: 1, rock: 1 } },
  plains:   { n: [2, 3], w: { fence: 4, tree: 2, bush: 2, clump: 1, rock: 1, hay: 1, stump: 1 } },
  farm:     { n: [2, 3], w: { fence: 5, hay: 2, tree: 2, bush: 1, clump: 1, stump: 1 } },
  hills:    { n: [2, 4], w: { rock: 4, boulder: 3, bush: 2, tree: 2, clump: 1, stump: 1 } },
  mountain: { n: [2, 4], w: { boulder: 4, rock: 4, tree: 1, bush: 1, log: 1 } },
  suburb:   { n: [2, 3], w: { fence: 4, tree: 3, bush: 3, wreck: 1, clump: 1, crate: 1 } },
  city:     { n: [2, 3], w: { wreck: 2, crate: 2, barrel: 2, fence: 2, rock: 1, bush: 1, tree: 1 } },
};
// What lies about the cleared yard.
const YARD_W = { plain: { stump: 3, log: 2, crate: 2, barrel: 2, rock: 1 }, city: { crate: 3, barrel: 3, rock: 1, log: 1, stump: 1 } };
// The cell kinds of the scatter (wrecks are laid as cars: placeCar).
export const SCATTER_KINDS = new Set(["tree", "bush", "fence", "rock", "boulder", "stump", "log", "hay", "crate", "barrel"]);
export const profileOf = (terrain) => PROFILES[terrain] || PROFILES.plains;

const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/** The layer's seed: the tile's (the land is the land, whoever's base stands on it). @param {any} tile */
export const scatterSeed = (tile) => hashStr(`scatter|${tile}`);
const chunkSeed = (seed, cx, cy) => (Math.imul(seed ^ Math.imul(cx + 0x2545, 0x9e3779b1), 0x85ebca6b) ^ Math.imul(cy + 0x632b, 0xc2b2ae35)) >>> 0;
/** @param {Rng} rng @param {Record<string, number>} w */
function pickW(rng, w) {
  const ks = Object.keys(w);
  let t = rng.range(0, ks.reduce((a, k) => a + w[k], 0));
  for (const k of ks) { t -= w[k]; if (t < 0) return k; }
  return ks[ks.length - 1];
}
// One chunk's pieces: { x, y, k, g (the piece it belongs to, for taking it away whole), yard (shown only in the yard),
// ax, len, body (a wreck) }.
function chunk(seed, cx, cy, terrain) {
  const rng = new Rng(chunkSeed(seed, cx, cy));
  const P = profileOf(terrain), S = SCATTER.CHUNK, out = [];
  const n = rng.int(P.n[0], P.n[1]);
  for (let i = 0; i < n; i++) {
    const kind = pickW(rng, P.w), x = cx * S + rng.int(0, S - 1), y = cy * S + rng.int(0, S - 1), g = `${cx},${cy},${i}`;
    const add = (px, py, k) => out.push({ x: px, y: py, k, g });
    switch (kind) {
      case "clump": { // a stand of trees, bushes at its edge
        const r = rng.pick([1.5, 2, 2.5]);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const d = Math.hypot(dx, dy);
          if (d > r) continue;
          if (rng.chance(d < 1 ? 0.85 : 0.55)) add(x + dx, y + dy, "tree");
          else if (d >= 1 && rng.chance(0.35)) add(x + dx, y + dy, "bush");
        }
        break;
      }
      case "bush": { let px = x, py = y; for (let j = rng.int(1, 3); j > 0; j--) { add(px, py, "bush"); if (rng.chance(0.5)) px += rng.pick([-1, 1]); else py += rng.pick([-1, 1]); } break; }
      case "fence": { // an old fence run, gaps in it, now and then turning a corner
        const len = rng.int(3, 8), [dx, dy] = rng.chance(0.5) ? [1, 0] : [0, 1];
        let px = x, py = y;
        for (let j = 0; j < len; j++, px += dx, py += dy) if (rng.chance(0.78)) add(px, py, "fence");
        if (rng.chance(0.3)) { const s = rng.pick([-1, 1]); for (let j = 1, n2 = rng.int(2, 4); j <= n2; j++) if (rng.chance(0.8)) add(px - dx + dy * s * j, py - dy + dx * s * j, "fence"); }
        break;
      }
      case "rock": add(x, y, "rock"); if (rng.chance(0.35)) add(x + rng.pick([-1, 1]), y, "rock"); break;
      case "boulder": add(x, y, "boulder"); if (rng.chance(0.4)) add(x, y + rng.pick([-1, 1]), "rock"); break;
      case "log": { add(x, y, "log"); if (rng.chance(0.5)) { if (rng.chance(0.5)) add(x + 1, y, "log"); else add(x, y + 1, "log"); } break; }
      case "hay": add(x, y, "hay"); if (rng.chance(0.4)) add(x + 1, y, "hay"); break;
      case "crate": case "barrel": add(x, y, kind); if (rng.chance(0.3)) add(x, y + 1, rng.chance(0.5) ? "crate" : "barrel"); break;
      case "wreck": { const truck = rng.chance(0.3); out.push({ x, y, k: "wreck", g, ax: rng.int(0, 1), len: truck ? 4 : 3, body: truck ? "truck" : "car" }); break; }
      default: add(x, y, kind); // tree, stump
    }
  }
  for (let j = rng.chance(SCATTER.YARD_P) ? rng.int(1, 2) : 0; j > 0; j--) out.push({ x: cx * S + rng.int(0, S - 1), y: cy * S + rng.int(0, S - 1), k: pickW(rng, terrain === "city" ? YARD_W.city : YARD_W.plain), g: `${cx},${cy},y${j}`, yard: true });
  // The trees in the yard: a stump for some (by their own dice: the same tree, the same stump).
  for (const p of out) if (p.k === "tree") p.stump = rng.chance(SCATTER.STUMP_P);
  return out;
}
const layerCache = new Map();
/**
 * The scatter layer over the grid [-G, G) (grid coordinates), one piece a cell (the first chunk's wins): the same for
 * the same tile, terrain and grid, and the same cells for a bigger grid.
 * @param {number} seed @param {string} terrain @param {number} G
 */
export function scatterLayer(seed, terrain, G) {
  const key = `${seed}|${terrain}|${G}`;
  let out = layerCache.get(key);
  if (out) return out;
  out = [];
  const S = SCATTER.CHUNK, seen = new Set();
  for (let cy = Math.floor(-G / S); cy <= Math.floor((G - 1) / S); cy++) for (let cx = Math.floor(-G / S); cx <= Math.floor((G - 1) / S); cx++) {
    for (const p of chunk(seed, cx, cy, terrain)) {
      if (p.x < -G || p.y < -G || p.x >= G || p.y >= G) continue;
      const k = `${p.x},${p.y}`;
      if (p.k !== "wreck" && seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
  }
  if (layerCache.size > 64) layerCache.clear();
  layerCache.set(key, out);
  return out;
}
/**
 * Lays the layer on a map. m: { cells, W, H, ox, oy (grid → map), seed, terrain, G, yard(gx, gy) → in the cleared
 * yard, ok(x, y) → the map cell may take scatter (open ground, not kept clear), pass(cell) → walkable, car(x, y, ax,
 * len, body, ok) → a wreck's cells or null (combat.js placeCar) }. Returns { cells: [[x, y]…], kinds: { k: n } }.
 * @param {any} m
 */
export function layScatter(m) {
  const { cells, W, H, ox, oy } = m;
  const placed = new Map(); // group → map cells
  const own = new Map();    // map cell index → group
  const put = (g, x, y) => { (placed.get(g) || placed.set(g, []).get(g)).push([x, y]); own.set(y * W + x, g); };
  // Never on the map's outermost cells: the attackers' ground, an open ring round the whole map, so wherever a battle
  // floods its reach from on the edge (combat.js flood: a corner, the middle of a side) it reaches all of it (a clump of
  // trees boxing in the corner it started from left nothing on the map reachable: a drill on a hill base threw).
  const okAt = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1 && m.ok(x, y);
  for (const p of scatterLayer(m.seed, m.terrain, m.G)) {
    const x = p.x + ox, y = p.y + oy;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const inYard = m.yard(p.x, p.y);
    if (p.k === "wreck") {
      if (inYard || !m.car) continue;
      const r = m.car(x, y, p.ax, p.len, p.body, (xx, yy) => okAt(xx, yy) && !own.has(yy * W + xx));
      if (r) for (let yy = r.y0; yy < r.y0 + r.h; yy++) for (let xx = r.x0; xx < r.x0 + r.w; xx++) put(p.g, xx, yy);
      continue;
    }
    let k = p.k;
    if (inYard !== !!p.yard) { if (inYard && k === "tree" && p.stump) k = "stump"; else continue; } // the yard: cleared ground (a tree's stump); outside: no yard clutter
    if (!okAt(x, y) || own.has(y * W + x)) continue;
    const c = cells[y * W + x];
    c.k = k;
    put(`${p.g}@${x},${y}`, x, y); // single cells go one by one (a gap in a fence, a tree out of a clump)
  }
  unpocket(m, placed, own);
  const kinds = {}, out = [];
  for (const list of placed.values()) for (const [x, y] of list) { const c = cells[y * W + x]; if (c.k === "open") continue; kinds[c.k] = (kinds[c.k] || 0) + 1; out.push([x, y]); }
  return { cells: out, kinds };
}
// Scatter that shuts off open ground from the map's edge (ground reached with the scatter treated as open but not
// with it) is taken away, the pieces next to such ground first, a few rounds.
function unpocket(m, placed, own) {
  const { cells, W, H } = m;
  const flood = (thru) => {
    const seen = new Uint8Array(W * H), q = [];
    const can = (i) => m.pass(cells[i]) || (thru && own.has(i));
    for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const i = y * W + x; if (!seen[i] && can(i)) { seen[i] = 1; q.push(i); } }
    for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { const i = y * W + x; if (!seen[i] && can(i)) { seen[i] = 1; q.push(i); } }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % W, y = (i - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, j = ny * W + nx; if (nx >= 0 && ny >= 0 && nx < W && ny < H && !seen[j] && can(j)) { seen[j] = 1; q.push(j); } }
    }
    return seen;
  };
  for (let round = 0; round < SCATTER.UNPOCKET && own.size; round++) {
    const a = flood(false), b = flood(true), drop = new Set();
    for (let i = 0; i < W * H; i++) {
      if (!b[i] || a[i] || own.has(i)) continue; // a pocket: open ground only the scatter shuts off
      const x = i % W, y = (i - x) / W;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = (y + dy) * W + x + dx; if (own.has(j)) drop.add(own.get(j)); }
    }
    if (!drop.size) break;
    for (const g of drop) { for (const [x, y] of placed.get(g) || []) { const c = cells[y * W + x]; c.k = "open"; delete c.car; delete c.hp; delete c.mhp; own.delete(y * W + x); } placed.delete(g); }
  }
}
