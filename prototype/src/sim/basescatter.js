// @ts-check
// The land of the base map (basemap.js): what stands on the ground round a base before anything is built, and clearing it.
//
// The user's requests of 2026-10-20: "There are scatter boxes and such; I want there to be scatter fences, trees,
// etc.", "Trees in the base map can be chopped down for wood", "Trees block building until cleared", "Tree chopping
// takes time and works like a construction progress tile", every piece of scatter "blocks building there until it's
// cleared", "Make a clearing in the middle of the map (this will be what took the 1hr of camp setup)" and "Make the
// build map make sense for the tile it was created on".
//
// One layer for the land (landMap), from the tile alone and fixed in grid coordinates (relative to the middle of the
// base): the same whatever is built, moved or queued, the same as the grid grows (chunk by chunk, SCATTER.CHUNK cells
// square, each from dice of its own: scatterLayer), the same in the Base map view and on the battle map of a raid or a
// horde, and the margin of an AI group's walled base wears it too (fort.js). What it holds, by the tile:
//   - the terrain's dressing (PROFILES): forest: tree clumps, trees, bushes, fallen logs, stumps; farmland: hedgerows
//     (lines of bushes), old fence runs with gaps and corners, lone trees, rocks, hay; a farm's fields more fence and
//     hay; hills and mountains: rocks and boulders with bushes and trees; the suburbs and the city: fences, wrecked cars,
//     crates and barrels, with paved lots (gravel floor: built on freely);
//   - a road tile's road (tile.road: a band of asphalt across the map along the roads it links to, through the middle)
//     with abandoned cars and debris on it, a river tile's river (tile.river, not a bridge: a band of water off the
//     middle with two fords and bushes on its banks; water is never cleared nor built on);
//   - the yard's leavings: in the yard round the clearing only stumps, logs, crates, barrels and a rock;
//   - the clearing (CLEARING by tier: a camp's 12 × 12 round its fire, where its setup hour went): nothing at all.
//
// Every piece blocks building on its cells (basemap.js placeProblemAt: "clear it first") until it is cleared: a
// clearing job (CLEAR: hours of the builders' work and what it gives: a tree its wood, a wreck its scrap and a car
// part) goes into the base's construction queue like a building (buildings.js BUILDINGS.clear, constructionHour) and
// the yield comes into the stores when it is done (finishClear). A wreck can be stripped first (once: the scrap and
// the part) and then dragged off. What is cleared stays cleared (base.land.cleared, by cell; base.land.looted, the
// wrecks stripped). The game's own auto layout picks open ground, and where there is none it places over the land and
// queues the clearing (basemap.js autoLayout, siteWaits): it never gets stuck.
import { Rng } from "./rng.js";

export const SCATTER = {
  CHUNK: 8,        // cells a side of a chunk of the layer, each made from its own dice
  YARD_P: 0.8,     // the chance a chunk leaves one or two things lying in the yard (shown only there)
  STUMP_P: 0.1,    // the chance a tree of the layer standing in the yard is a stump instead (else cleared away)
  ROAD_W: 5,       // a road's width in cells
  ROAD_CAR: 0.55,  // the chance of an abandoned car every ROAD_STEP cells along a road
  ROAD_STEP: 7,
  RIVER_W: 3,      // a river's width in cells
  RIVER_IN: 6,     // its far bank this many cells in from the map's edge (the no-build margin and a cell more)
};
// The clearing in the middle of a new base map (half-size, the square [-h, h)) by tier: a camp's fits its fire, the
// cache and its starter tents with room to walk; nothing of the land ever stands in it.
export const CLEARING = { camp: 6, shelter: 8, outpost: 10, hub: 13 };
// The land's dressing by terrain: n pieces a chunk (range) and the weights of what they are.
export const PROFILES = {
  forest:   { n: [2, 4], w: { clump: 4, tree: 3, bush: 3, log: 2, stump: 1, rock: 1 } },
  plains:   { n: [2, 3], w: { fence: 3, hedge: 2, tree: 2, bush: 2, clump: 1, rock: 1, hay: 1, stump: 1 } },
  farm:     { n: [2, 3], w: { fence: 4, hedge: 2, hay: 2, tree: 2, bush: 1, clump: 1, stump: 1 } },
  hills:    { n: [2, 4], w: { rock: 4, boulder: 3, bush: 2, tree: 2, clump: 1, stump: 1, hedge: 1 } },
  mountain: { n: [2, 4], w: { boulder: 4, rock: 4, tree: 1, bush: 1, log: 1 } },
  suburb:   { n: [2, 3], w: { fence: 4, tree: 3, bush: 3, wreck: 1, clump: 1, crate: 1, lot: 2 } },
  city:     { n: [2, 3], w: { wreck: 2, crate: 2, barrel: 2, fence: 2, rock: 1, bush: 1, tree: 1, lot: 3 } },
};
// What lies about the yard.
const YARD_W = { plain: { stump: 3, log: 2, crate: 2, barrel: 2, rock: 1 }, city: { crate: 3, barrel: 3, rock: 1, log: 1, stump: 1 } };
// The cell kinds of the land (wrecks are laid as cars: combat.js car cells; water is the river).
export const SCATTER_KINDS = new Set(["tree", "bush", "fence", "rock", "boulder", "stump", "log", "hay", "crate", "barrel"]);
// Clearing a piece (the builders' work-hours at a builder's pace, and what it gives into the stores). A tree is felled,
// limbed and its stump dug out: without a cutting tool at the base (an axe, a machete…: woodcutting.js isChopTool) it
// takes NO_TOOL times as long. A wreck: strip it (once) for its scrap and a car part, then drag it off; cleared without
// stripping it gives both.
export const CLEAR = {
  tree:    { hours: 4,   get: { wood: 120 }, word: "a tree", verb: "Fell" },
  stump:   { hours: 2,   get: { wood: 15 },  word: "a stump", verb: "Dig out" },
  log:     { hours: 1.5, get: { wood: 40 },  word: "a fallen log", verb: "Saw up" },
  bush:    { hours: 0.5, get: { wood: 5 },   word: "a bush", verb: "Grub out" },
  fence:   { hours: 0.5, get: { wood: 10 },  word: "a fence panel", verb: "Pull down" },
  hay:     { hours: 0.5, get: {},            word: "a hay bale", verb: "Shift" },
  rock:    { hours: 1,   get: {},            word: "a rock", verb: "Roll away" },
  boulder: { hours: 3,   get: {},            word: "a boulder", verb: "Break up" },
  crate:   { hours: 0.5, get: { scrap: 1 },  word: "a broken crate", verb: "Haul off" },
  barrel:  { hours: 0.5, get: { scrap: 1 },  word: "an old drum", verb: "Haul off" },
  wreck:   { hours: 6,   get: { scrap: 2 },  word: "a wreck", verb: "Drag off" },
  strip:   { hours: 2,   get: { scrap: 6, carparts: 1 }, word: "a wreck", verb: "Strip" },
  NO_TOOL: 2.5, // a tree, a fallen log or a stump with no axe, saw or machete at the base (it was 1.5 until the tools, 2026-10-21)
};
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
// One chunk's pieces: { x, y, k, g (the piece it belongs to), yard (shown only in the yard), ax, len, body (a wreck),
// floor (a paved lot: a floor, no piece) }.
function chunk(seed, cx, cy, terrain) {
  const rng = new Rng(chunkSeed(seed, cx, cy));
  const P = profileOf(terrain), S = SCATTER.CHUNK;
  /** @type {any[]} */
  const out = [];
  const n = rng.int(P.n[0], P.n[1]);
  for (let i = 0; i < n; i++) {
    const kind = pickW(rng, P.w), x = cx * S + rng.int(0, S - 1), y = cy * S + rng.int(0, S - 1), g = `${cx},${cy},${i}`;
    const add = (px, py, k, gg = `${g}@${px},${py}`) => out.push({ x: px, y: py, k, g: gg });
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
      case "hedge": { // a hedgerow: a line of bushes along a field's edge, gaps in it
        const len = rng.int(5, 10), [dx, dy] = rng.chance(0.5) ? [1, 0] : [0, 1];
        for (let j = 0; j < len; j++) if (rng.chance(0.82)) add(x + dx * j, y + dy * j, "bush");
        break;
      }
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
      case "lot": { const w = rng.int(4, 6), h = rng.int(3, 5); for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) out.push({ x: x + xx, y: y + yy, k: "", floor: "gravel", g: `${g}f` }); break; }
      default: add(x, y, kind); // tree, stump
    }
  }
  for (let j = rng.chance(SCATTER.YARD_P) ? rng.int(1, 2) : 0; j > 0; j--) out.push({ x: cx * S + rng.int(0, S - 1), y: cy * S + rng.int(0, S - 1), k: pickW(rng, terrain === "city" ? YARD_W.city : YARD_W.plain), g: `${cx},${cy},y${j}`, yard: true });
  for (const p of out) if (p.k === "tree") p.stump = rng.chance(SCATTER.STUMP_P); // a tree in the yard: a stump for some
  return out;
}
const layerCache = new Map();
/**
 * The terrain's layer over the grid [-G, G) (grid coordinates): the same for the same tile, terrain and grid, and the
 * same cells for a bigger grid. Floors (paved lots) come with an empty k.
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
      const k = `${p.floor ? "f" : ""}${p.x},${p.y}`;
      if (p.k !== "wreck" && seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
  }
  if (layerCache.size > 64) layerCache.clear();
  layerCache.set(key, out);
  return out;
}

// ---------- the land of one base ----------
// What the land is made from: the tile's dice, terrain (a farm's fields as "farm"), the grid, the yard, the clearing,
// the road's axes and the river's (spec.road: "x" | "y" | "xy" | ""; spec.river: "x" | "y" | "").
/** @param {any} state @param {any} base @param {{ G: number, C: number, tier: string, terrain: string }} dims */
export function landSpec(state, base, dims) {
  const t = state && state.tiles && base ? state.tiles[base.tile] : null;
  const seed = scatterSeed(base ? base.tile : 0);
  let road = "";
  if (t && t.road && !t.bridge) {
    const axes = new Set();
    const p0 = state.grid && state.grid.toPixel ? state.grid.toPixel(t.id, 1) : null;
    for (const id of t.roadLinks || []) {
      const p1 = p0 ? state.grid.toPixel(id, 1) : null;
      if (!p1) continue;
      axes.add(Math.abs(p1[0] - p0[0]) >= Math.abs(p1[1] - p0[1]) ? "x" : "y");
    }
    road = axes.size ? [...axes].sort().join("") : "x";
  }
  // A river beside the tile (a neighbour of it a river: mapgen.js makes a river's tiles water): its near bank runs along
  // the map's side toward it, RIVER_IN cells in from the edge (beyond the yard), with two fords across.
  let river = "", riverSide = 0;
  if (t && t.terrain !== "water" && state.grid && state.grid.toPixel) {
    const p0 = state.grid.toPixel(t.id, 1);
    const n = state.grid.neighbors(t.id).map((id) => state.tiles[id]).find((q) => q && q.river);
    if (n) { const p1 = state.grid.toPixel(n.id, 1), dx = p1[0] - p0[0], dy = p1[1] - p0[1]; if (Math.abs(dx) >= Math.abs(dy)) { river = "y"; riverSide = dx > 0 ? 1 : -1; } else { river = "x"; riverSide = dy > 0 ? 1 : -1; } }
  }
  return { seed, terrain: dims.terrain, G: dims.G, C: dims.C, clear: CLEARING[dims.tier] ?? CLEARING.camp, road, river, riverSide, town: !!(t && (t.terrain === "suburb" || t.terrain === "city")) };
}
const inSq = (x, y, h) => x >= -h && x < h && y >= -h && y < h;
// The road's cells (a band SCATTER.ROAD_W wide through the middle along each axis) and the river's (a band RIVER_W
// wide off the middle, beyond the yard: two fords across it), in grid coordinates.
const onRoad = (spec, x, y) => { const h = Math.floor(SCATTER.ROAD_W / 2); return (spec.road.includes("x") && y >= -h && y <= h) || (spec.road.includes("y") && x >= -h && x <= h); };
function onRiver(spec, x, y) {
  if (!spec.river) return 0;
  const a = spec.river === "y" ? x : y, b = spec.river === "y" ? y : x;
  const out = Math.max(spec.C + 2, spec.G - SCATTER.RIVER_IN - SCATTER.RIVER_W); // the near bank's distance from the middle (beyond the yard)
  const lo = spec.riverSide > 0 ? out : -out - SCATTER.RIVER_W;
  if (a < lo || a >= lo + SCATTER.RIVER_W) return a === lo - 1 || a === lo + SCATTER.RIVER_W ? 2 : 0; // 2: the bank
  const ford = Math.round(spec.G / 2);
  if (Math.abs(b - ford) <= 1 || Math.abs(b + ford) <= 1) return 3; // a ford: shallow, walked across
  return 1;
}
const landCache = new Map();
/**
 * The land of a base now: { pieces: Map "x,y" → piece (every cell of a wreck maps to its piece), floors: Map "x,y" →
 * floor, list: the pieces once each }. A piece: { k, g, cells: [[x, y]…], body?, ax?, len?, looted? } (k "water" for the
 * river: never cleared). What is cleared (base.land.cleared) is gone.
 * @param {any} spec landSpec @param {any} land base.land
 */
export function landOf(spec, land) {
  const key = `${spec.seed}|${spec.terrain}|${spec.G}|${spec.C}|${spec.clear}|${spec.road}|${spec.river}${spec.riverSide || ""}|${land ? `${land.n}` : "-"}`;
  let out = landCache.get(key);
  if (out && out.land === land) return out.v;
  const cleared = (land && land.cleared) || {}, looted = (land && land.looted) || {};
  const pieces = new Map(), floors = new Map(), list = [];
  const free = (x, y) => !inSq(x, y, spec.clear) && x >= -spec.G && y >= -spec.G && x < spec.G && y < spec.G && !pieces.has(`${x},${y}`) && !cleared[`${x},${y}`];
  const put = (p) => { list.push(p); for (const [x, y] of p.cells) pieces.set(`${x},${y}`, p); };
  // The river first (nothing else on the water), then the road and what was left on it, then the terrain.
  if (spec.river) for (let a = -spec.G; a < spec.G; a++) for (let b = -spec.G; b < spec.G; b++) {
    const x = spec.river === "y" ? a : b, y = spec.river === "y" ? b : a, r = onRiver(spec, x, y);
    if (r === 1 && !inSq(x, y, spec.clear) && !cleared[`${x},${y}`]) put({ k: "water", g: `w${x},${y}`, cells: [[x, y]] });
    else if (r === 3) floors.set(`${x},${y}`, "gravel");
  }
  if (spec.road) {
    for (let a = -spec.G; a < spec.G; a++) for (let b = -spec.G; b < spec.G; b++) if (onRoad(spec, a, b)) floors.set(`${a},${b}`, "road");
    const rng = new Rng(spec.seed ^ 0x51ab);
    for (const ax of spec.road.split("")) for (let t = -spec.G + 2; t < spec.G - 4; t += SCATTER.ROAD_STEP) {
      const c = rng.chance(SCATTER.ROAD_CAR), lane = rng.pick([-2, 0]), off = rng.int(0, 2), truck = rng.chance(0.25), len = truck ? 4 : 3;
      const debris = rng.chance(0.4), dl = rng.int(-2, 2), dk = rng.pick(["crate", "barrel", "crate"]);
      const x = ax === "x" ? t + off : lane, y = ax === "x" ? lane : t + off;
      if (c) {
        const cells = [];
        for (let i = 0; i < len; i++) for (let j = 0; j < 2; j++) cells.push(ax === "x" ? [x + i, y + j] : [x + j, y + i]);
        if (cells.every(([cx, cy]) => free(cx, cy))) put({ k: "wreck", g: `r${ax}${t}`, cells, body: truck ? "truck" : "car", ax: ax === "x" ? 0 : 1, len, looted: !!looted[`r${ax}${t}`] });
      }
      if (debris) { const dx = ax === "x" ? t + off + len + 1 : dl, dy = ax === "x" ? dl : t + off + len + 1; if (free(dx, dy)) put({ k: dk, g: `rd${ax}${t}`, cells: [[dx, dy]] }); }
    }
  }
  for (const p of scatterLayer(spec.seed, spec.terrain, spec.G)) {
    if (p.floor) { if (!inSq(p.x, p.y, spec.clear) && !floors.has(`${p.x},${p.y}`)) floors.set(`${p.x},${p.y}`, p.floor); continue; }
    const yard = inSq(p.x, p.y, spec.C);
    if (p.k === "wreck") {
      if (yard) continue;
      const cells = [];
      for (let i = 0; i < p.len; i++) for (let j = 0; j < 2; j++) cells.push(p.ax ? [p.x + j, p.y + i] : [p.x + i, p.y + j]);
      if (cells.every(([cx, cy]) => free(cx, cy) && !onRoad(spec, cx, cy))) put({ k: "wreck", g: p.g, cells, body: p.body, ax: p.ax, len: p.len, looted: !!looted[p.g] });
      continue;
    }
    let k = p.k;
    if (yard !== !!p.yard) { if (yard && k === "tree" && p.stump) k = "stump"; else continue; } // the yard: cleared ground (a tree's stump); outside: no yard leavings
    if (!free(p.x, p.y) || (spec.road && onRoad(spec, p.x, p.y))) continue;
    put({ k, g: p.g, cells: [[p.x, p.y]] });
  }
  // Bushes along the river's banks.
  if (spec.river) { const rng = new Rng(spec.seed ^ 0x77e1); for (let a = -spec.G; a < spec.G; a++) for (let b = -spec.G; b < spec.G; b++) { const x = spec.river === "y" ? a : b, y = spec.river === "y" ? b : a; if (onRiver(spec, x, y) === 2 && rng.chance(0.3) && free(x, y)) put({ k: "bush", g: `b${x},${y}`, cells: [[x, y]] }); } }
  const water = list.filter((p) => p.k === "water");
  const v = { pieces, floors, list, waterOnly: { pieces: new Map(water.flatMap((p) => p.cells.map(([x, y]) => [`${x},${y}`, p]))), list: water, floors } };
  if (landCache.size > 48) landCache.clear();
  landCache.set(key, { land, v });
  return v;
}
// A piece's name and its clearing (CLEAR).
export const pieceWord = (p) => (p.k === "water" ? "the river" : p.k === "wreck" ? `a wrecked ${p.body === "truck" ? "truck" : "car"}` : (CLEAR[p.k] || { word: p.k }).word);
/** The clearing of a piece: { hours, get, mode } (mode "strip": a wreck not yet stripped, stripped only). @param {any} p @param {boolean} tool @param {string} mode */
export function clearOf(p, tool = true, mode = "clear") {
  if (!p || p.k === "water") return null;
  if (p.k === "wreck") {
    if (mode === "strip") return p.looted ? null : { hours: CLEAR.strip.hours, get: { ...CLEAR.strip.get }, mode };
    return p.looted ? { hours: CLEAR.wreck.hours, get: { ...CLEAR.wreck.get }, mode } : { hours: CLEAR.wreck.hours + CLEAR.strip.hours, get: { scrap: CLEAR.wreck.get.scrap + CLEAR.strip.get.scrap, carparts: CLEAR.strip.get.carparts }, mode };
  }
  const c = CLEAR[p.k];
  if (!c) return null;
  return { hours: c.hours * ((p.k === "tree" || p.k === "log" || p.k === "stump") && !tool ? CLEAR.NO_TOOL : 1), get: { ...c.get }, mode };
}

// ---------- laying the land on a map ----------
/**
 * Lays the land on a map (basemap.js buildBaseMap; fort.js for an AI group's margin). m: { cells, W, H, ox, oy (grid →
 * map), land (landOf), ok(x, y) → the map cell may take a piece (open ground, nothing standing), floor(x, y) → it may
 * take a floor }. Never on the map's outermost cells (the attackers' ground, an open ring round the map, so wherever a
 * battle floods its reach from on the edge it reaches all of it). Returns { kinds: { k: n } }.
 * @param {any} m
 */
export function layLand(m) {
  const { cells, W, H, ox, oy, land } = m;
  const inner = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1;
  for (const [key, f] of land.floors) {
    const [gx, gy] = key.split(",").map(Number), x = gx + ox, y = gy + oy;
    if (x >= 0 && y >= 0 && x < W && y < H && (!m.floor || m.floor(x, y))) cells[y * W + x].f = f;
  }
  const kinds = {};
  for (const p of land.list) {
    const at = p.cells.map(([gx, gy]) => [gx + ox, gy + oy]);
    if (!at.every(([x, y]) => inner(x, y) && m.ok(x, y))) { if (p.k !== "wreck") continue; else continue; }
    if (p.k === "wreck") {
      const kind = p.body === "truck" ? "truck" : "car", x0 = Math.min(...at.map((c) => c[0])), y0 = Math.min(...at.map((c) => c[1]));
      const id = y0 * W + x0 + 1;
      for (const [x, y] of at) { const c = cells[y * W + x]; c.k = kind; c.car = { id, i: p.ax ? y - y0 : x - x0, j: p.ax ? x - x0 : y - y0, L: p.len, ax: p.ax ? "y" : "x", kind, v: (id * 7) % 1000, body: kind }; c.wreck = 1; }
    } else for (const [x, y] of at) cells[y * W + x].k = p.k;
    kinds[p.k] = (kinds[p.k] || 0) + 1;
  }
  return { kinds };
}
