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
//     (lines of bushes), lone trees, rocks, hay and its fenced fields (fieldLayer: squares of fence with a gate); a
//     farm's more fields and hay; hills and mountains: rocks and boulders with bushes and trees; the suburbs and the
//     city: fences, wrecked cars, crates and barrels, with paved lots (gravel floor: built on freely);
//   - a road tile's road (tile.road: a band of asphalt across the map along the roads it links to, through the middle)
//     with abandoned cars and debris on it, a river tile's river (tile.river, not a bridge: a band of water off the
//     middle with two fords and bushes on its banks; water is never cleared nor built on);
//   - the yard's leavings: in the yard round the clearing only stumps, logs, crates, barrels and a rock;
//   - the clearing (CLEARING by tier: a base from before the camp's spot was picked, or one taken or handed over):
//     nothing at all.
// The land is the tile's in map coordinates (the 500 × 500 map's middle at 0, 0: basemap.js BASE_GRID); a base stands
// on it at its origin (spec.ox, spec.oy: basemap.js originOf), and landOf hands the pieces back in the base's grid
// coordinates. A camp set up on a spot of its own (spec.fresh: the user's requests 2026-10-22, "choose where in the
// 250 x 250 with a highlighted 10x10 to start ... Then you can build around that and clear out more as needed. Provide
// the resources of that area after the process to set up camp is finished", the square since reduced to 5 × 5) has no
// yard swept for it and no clearing of its own: its setup clears the SITE square round the fire like any clearing, the
// yield into its stores (basemap.js clearCampSite), and the rest is cleared as needed.
//
// Every piece blocks building on its cells (basemap.js placeProblemAt: "clear it first") until it is cleared: a
// clearing job (CLEAR: hours of the builders' work and what it gives: a tree its wood, a wreck its scrap, a car part,
// metal sheets and an electronics) goes into the base's construction queue like a building (buildings.js
// BUILDINGS.clear, constructionHour) and the yield comes into the stores when it is done (finishClear). A wreck can be
// stripped first (once: the scrap, the part, the sheets and the electronics) and then dragged off. What is cleared stays cleared (base.land.cleared, by cell; base.land.looted, the
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
// The camp's own spot (the user's requests 2026-10-22: "reduce to 5x5 with camp site in the middle"): its setup clears
// the SIZE × SIZE square with the fire in its middle cell (grid cells LO to LO + SIZE − 1 each way from the fire), and
// the spot is picked on the map with that square highlighted (staging.js askSite, ui/campsite.js).
// NO_TOOL_WOOD (the user's request 2026-10-22: "balance wood yield with and without an axe in the teams inventory when
// setting up camp"): a team with no axe, saw or machete (staging.js teamChopTool) clears the trees, logs and stumps of
// its site the slow way (CLEAR.NO_TOOL as long) and gets only this share of their wood: branches and deadfall broken by
// hand, not logs.
export const SITE = { SIZE: 5, LO: -2, NO_TOOL_WOOD: 0.25 };
const WOODY = new Set(["tree", "log", "stump"]);
/** What clearing a piece of a camp's site gives (clearOf's get, the wood of a tree, a log or a stump cut to NO_TOOL_WOOD with no cutting tool). @param {any} p @param {any} c clearOf(p) @param {boolean} tool */
export function siteGet(p, c, tool) {
  const get = { ...c.get };
  if (!tool && WOODY.has(p.k) && get.wood) get.wood = Math.floor(get.wood * SITE.NO_TOOL_WOOD);
  return get;
}
/** The SITE square round a fire at `at`: { x0, y0, x1, y1 } (half-open). @param {number[]} [at] */
export const siteBox = (at = [0, 0]) => ({ x0: at[0] + SITE.LO, y0: at[1] + SITE.LO, x1: at[0] + SITE.LO + SITE.SIZE, y1: at[1] + SITE.LO + SITE.SIZE });
/**
 * The level a camp's square is levelled to (the user's request 2026-10-23: "Allow building on a hill setting up a camp
 * on a hill burrowed down into the hill"): the middle of its cells' ground heights (land.heights, the tile's land with
 * no base on it), so an open hilltop is level already and a spot over a hill's edge is dug down or filled in the least.
 * The camp stands at it (basemap.js levelOf: base.plan.level). @param {any} land @param {number[]} at
 */
export function siteLevel(land, at) {
  const B = siteBox(at), hs = [];
  for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) hs.push((land.heights && land.heights.get(`${x},${y}`)) || 0);
  hs.sort((a, b) => a - b);
  return hs[(hs.length - 1) >> 1];
}
// The land's dressing by terrain: n pieces a chunk (range) and the weights of what they are.
export const PROFILES = {
  forest:   { n: [2, 4], w: { clump: 4, tree: 3, bush: 3, log: 2, stump: 1, rock: 1 } },
  plains:   { n: [2, 3], w: { hedge: 2, tree: 2, bush: 2, clump: 1, rock: 1, hay: 1, stump: 1 } }, // its fences: fieldLayer
  farm:     { n: [2, 3], w: { hedge: 2, hay: 3, tree: 2, bush: 1, clump: 1, stump: 1 } },
  hills:    { n: [2, 4], w: { rock: 4, boulder: 3, bush: 2, tree: 2, clump: 1, stump: 1, hedge: 1 } },
  mountain: { n: [2, 4], w: { boulder: 4, rock: 4, tree: 1, bush: 1, log: 1 } },
  suburb:   { n: [1, 2], w: { fence: 2, tree: 3, bush: 3, wreck: 1, clump: 1, crate: 1 } }, // round the houses (townLayer)
  city:     { n: [1, 2], w: { wreck: 2, crate: 2, barrel: 2, fence: 1, rock: 1, bush: 1 } },    // round the blocks (townLayer)
};
// What lies about the yard.
const YARD_W = { plain: { stump: 3, log: 2, crate: 2, barrel: 2, rock: 1 }, city: { crate: 3, barrel: 3, rock: 1, log: 1, stump: 1 } };
// The cell kinds of the land (wrecks are laid as cars: combat.js car cells; water is the river).
export const SCATTER_KINDS = new Set(["tree", "bush", "fence", "wirefence", "fieldgate", "rock", "boulder", "stump", "log", "hay", "crate", "barrel"]);
// Clearing a piece (the builders' work-hours at a builder's pace, and what it gives into the stores). A tree is felled,
// limbed and its stump dug out: without a cutting tool at the base (an axe, a machete…: woodcutting.js isChopTool) it
// takes NO_TOOL times as long. A wreck: strip it (once) for its scrap, a car part, its roof and door skins as metal
// sheets (the user's request 2026-10-21: metal sheets salvaged from cars) and an electronics from under its dash (its
// engine control unit or radio: the user's request 2026-10-24, electronics salvaged from cars), then drag it off;
// cleared without stripping it gives both.
export const CLEAR = {
  tree:    { hours: 4,   get: { wood: 120 }, word: "a tree", verb: "Fell" },
  stump:   { hours: 2,   get: { wood: 15 },  word: "a stump", verb: "Dig out" },
  log:     { hours: 1.5, get: { wood: 40 },  word: "a fallen log", verb: "Saw up" },
  bush:    { hours: 0.5, get: { wood: 5 },   word: "a bush", verb: "Grub out" },
  fence:   { hours: 0.5, get: { wood: 10 },  word: "a fence panel", verb: "Pull down" },
  wirefence: { hours: 0.5, get: { wood: 6, scrap: 1 }, word: "a wire fence panel", verb: "Pull down" }, // a field's (fieldLayer): its post for wood, its wire and staples for scrap
  fieldgate: { hours: 0.5, get: { wood: 15 }, word: "a field gate", verb: "Take down" }, // its two cells (fieldLayer)
  hay:     { hours: 0.5, get: {},            word: "a hay bale", verb: "Shift" },
  rock:    { hours: 1,   get: { stone: 12 }, word: "a rock", verb: "Roll away" },   // stone (stone.js, the user's request 2026-10-23)
  boulder: { hours: 3,   get: { stone: 40 }, word: "a boulder", verb: "Break up" },
  crate:   { hours: 0.5, get: { scrap: 1 },  word: "a broken crate", verb: "Haul off" },
  barrel:  { hours: 0.5, get: { scrap: 1 },  word: "an old drum", verb: "Haul off" },
  wreck:   { hours: 6,   get: { scrap: 2 },  word: "a wreck", verb: "Drag off" },
  strip:   { hours: 2,   get: { scrap: 6, carparts: 1, metalsheet: 2, electronics: 1 }, word: "a wreck", verb: "Strip" },
  // The high ground (a cell of it dug down to the ground round it) and the buildings of a town or a city (pulled down
  // whole: their timbers, their scrap, the bricks and blocks as building materials, the roof's metal sheets).
  rise:    { hours: 1,   get: {},            word: "a patch of high ground", verb: "Dig down" }, // a level: × its height
  dip:     { hours: 1,   get: {},            word: "a hollow", verb: "Fill in" },               // a level: × its depth
  slope:   { hours: 0.5, get: {},            word: "a slope", verb: "Dig down" },
  house:   { hours: 20,  get: { wood: 160, scrap: 8, buildmat: 4, metalsheet: 2 }, word: "a house", verb: "Pull down" },
  store:   { hours: 28,  get: { wood: 60, scrap: 18, buildmat: 6, metalsheet: 6 }, word: "a store", verb: "Pull down" },
  block:   { hours: 48,  get: { wood: 40, scrap: 30, buildmat: 14, metalsheet: 8 }, word: "a city building", verb: "Knock down" },
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

// ---------- farmland's fenced fields ----------
// The user's request 2026-10-23: "Fix fences for farmland tiles to not be random singular fences make them square, go
// off screen and have a gate to enter the inside of the fenced area". On farmland (plains) and a farm's fields the
// fence runs are fields now: at most one to a REGION of the map (the chance P by the terrain), a square of fence S
// cells a side, GAP cells or more in from its region's edge (a lane between neighbours). The regions' grid is shifted
// by the tile's dice and runs on past the map, so the ring of them round its edge runs off it: the map's edge (and a
// base view's) cuts those fields. Each field has a
// gate (GATE cells of combat.js CELL fieldgate, walked through) in the side facing the map's middle, on the map and
// never at a corner; landOf keeps the ground APRON cells deep either side of it clear of the scatter, so the way in
// stays open, and lays no field the river (its far part would be shut in) or a road (the user's word 2026-10-23: "Roads
// interrupt the fences") runs through. Its fence is broken where a town's paving, the yard or the clearing crosses
// it. Its fence (the user's word
// 2026-10-23: "Add wire fences and wood fences"): post and rail (k "fence", half cover) or, a WIRE share of the
// fields by the terrain, post and wire (k "wirefence": no cover, seen through, climbed over like half cover:
// combat.js vaultable); the gate a wooden one either way. Where its fence meets the map's edge the view runs it on
// past the edge into the fog (ui/isoview.js offEdgeFences).
const FIELD_FENCE = new Set(["fence", "wirefence"]);
export const FIELD = { REGION: 48, S: [22, 42], GAP: 3, GATE: 2, APRON: 2, P: { farm: 0.85, plains: 0.45 }, WIRE: { farm: 0.4, plains: 0.55 } };
/**
 * The fields over [-G, G) (map coordinates): [{ id, x0, y0, s (the square [x0, x0 + s) each way), k (its fence's
 * kind: "fence" or "wirefence"), fence: [[x, y]…]
 * (on the map, the gate's cells left out), gate: [[x, y]…] (none when its side has no room on the map), out: [dx, dy]
 * (the way out through the gate) }]. The same for the same tile, terrain and grid; none off farmland.
 * @param {number} seed @param {string} terrain @param {number} G
 */
export function fieldLayer(seed, terrain, G) {
  const P = FIELD.P[terrain] || 0;
  if (!P) return [];
  return cached(`f|${seed}|${terrain}|${G}`, () => {
    const R = FIELD.REGION, out = [];
    const on = (x, y) => x >= -G && y >= -G && x < G && y < G;
    // The regions' grid, shifted by the tile's dice: laid on the map's middle it lined up with a base's view (its crop
    // round the middle a whole number of regions across), whose edges then always fell in the lanes between fields.
    const sh = new Rng(seed ^ 0x2b7d), ox = sh.int(0, R - 1), oy = sh.int(0, R - 1);
    for (let ry = Math.floor((-G - oy) / R); ry * R + oy < G; ry++) for (let rx = Math.floor((-G - ox) / R); rx * R + ox < G; rx++) {
      const rng = new Rng(chunkSeed(seed ^ 0x6f1e, rx, ry));
      if (!rng.chance(P)) continue;
      const s = rng.int(FIELD.S[0], FIELD.S[1]), x0 = ox + rx * R + rng.int(FIELD.GAP, R - FIELD.GAP - s), y0 = oy + ry * R + rng.int(FIELD.GAP, R - FIELD.GAP - s);
      const x1 = x0 + s - 1, y1 = y0 + s - 1;
      if (x1 < -G || y1 < -G || x0 >= G || y0 >= G) continue;
      // The gate: in the side facing the map's middle (the longer way to it), its cells on the map, two or more cells
      // from either corner.
      const cx = x0 + s / 2, cy = y0 + s / 2, alongX = Math.abs(cy) > Math.abs(cx); // the gate's side runs along x
      const side = alongX ? (cy > 0 ? y0 : y1) : (cx > 0 ? x0 : x1);
      const dir = alongX ? [0, cy > 0 ? -1 : 1] : [cx > 0 ? -1 : 1, 0];
      const a0 = alongX ? x0 : y0, lo = Math.max(a0 + 2, -G + 2), hi = Math.min(a0 + s - 3, G - 3) - (FIELD.GATE - 1);
      const gate = [];
      if (hi >= lo && side >= -G + 1 && side < G - 1) { const t = rng.int(lo, hi); for (let i = 0; i < FIELD.GATE; i++) gate.push(alongX ? [t + i, side] : [side, t + i]); }
      const isGate = new Set(gate.map(([x, y]) => ck(x, y))), fence = [];
      const edge = (x, y) => { if (on(x, y) && !isGate.has(ck(x, y))) fence.push([x, y]); };
      for (let x = x0; x <= x1; x++) { edge(x, y0); edge(x, y1); }
      for (let y = y0 + 1; y < y1; y++) { edge(x0, y); edge(x1, y); }
      const k = rng.chance(FIELD.WIRE[terrain] || 0) ? "wirefence" : "fence";
      out.push({ id: `${rx},${ry}`, x0, y0, s, k, fence, gate, out: dir });
    }
    return out;
  });
}

// ---------- high ground, streets and buildings (the user's request 2026-10-22) ----------
// "Add more variety to the bare base maps with elevations in hill tiles, houses, roads and stores in town tiles and
// similar but more city like for city tiles". In map coordinates, from the tile's dice, like the rest of the land:
//   - hills and mountains (reliefLayer, below): the ground's own height, hills, hollows and ridges (combat.js c.h, c.ter); was rises of high ground a level up (combat.js CELL.rise, height 1: seen further
//     from, shot down from), one at most to a REGION of the map, a few lobes joined; the way up is a slope (CELL.slope:
//     a climb, never diagonally) at RAMPS places round its foot, elsewhere its edge is a drop nobody walks up. Each cell
//     is a piece of the land: dug down before anything is built on it (CLEAR.rise).
//   - a town (the suburbs and a town's own tile: townLayer "town"): a grid of streets (road floors) every BLOCK cells,
//     the blocks between cut into lots facing the street: a house on most (walls, windows, a front door on the street,
//     rooms, beds, a table, a kitchen counter), a driveway with a car left in some, fences down the back yards; now and
//     then a store (a shop front of windows, shelves in rows, a counter, a back room) with a gravel lot in front, or a
//     lot gone to weeds.
//   - a city (townLayer "city"): narrower blocks with sidewalks, packed with bigger buildings (city blocks of rooms off
//     each other, two storeys high), stores, parking lots of wrecks and the odd park of trees; more wrecks in the streets.
// A building is one piece (k "house", "store", "block") whose cells each carry their own kind and floor (parts):
// pulled down whole before anything is built there (CLEAR), for its wood, scrap, building materials and metal sheets.
// The lie of the land (the user's word 2026-10-23: "Make it so hills can be up to 3 layers high and 1 layer high for the
// short hills ... These hills can be traversed by survivors, vehicles can travel on but the whole vehicle must be on
// the layer. For mountains steep hills that cannot be traversed and blocks line of sight ... like a mountain range",
// "bushes, trees and roads can go through hills", "create negative hills where the ground level goes down 1-2 layers
// and can be traversed down"): reliefLayer, a height a cell (−2 to 3 levels; combat.js c.h, c.ter) laid under
// whatever stands there, and the mountains' ridges of crag (CELL.crag: no way over, no sight through).
//   - hills: one at most to a REGION of the map, lobes joined; a short one a level high, a tall one up to TALL[1],
//     the levels nested inside each other with a ragged edge (EDGE_NOISE); the ground never steps more than a level
//     between neighbours (relaxed), so it is walked up and down anywhere (combat.js climbCost).
//   - hollows (the playtest 2026-10-23: "keep the sunken hollows have it go down max 1 layer depth and make it
//     sizeable minimum width of 8 tiles"): a level down, round, DIP_R across, smooth-edged; one narrower than DIP_MIN
//     cells either way (cut by the yard, a road, the map) is filled in (dropNarrowHollows).
//   - a mountain tile: RIDGES chains of crag (a ridge line wandering across the map, CORE cells wide) with foothills
//     falling away from them a level every FOOT cells, and some hills between.
export const HIGH = {
  REGION: 36,                                          // cells a side of a region of the map: a hill in it at most
  P: { hills: 0.8, mountain: 0.55, forest: 0.12, plains: 0.08, farm: 0.05 }, // the chance a region has a hill
  DIP_P: { hills: 0.3, mountain: 0.25, forest: 0.18, plains: 0.12, farm: 0.08 }, // the chance a region has a hollow
  DIP_R: [5, 9], DIP_MIN: 8,                           // its half-size range; the least it may be across either way
  TALL: { hills: [0.55, 3], mountain: [0.7, 3], forest: [0.2, 2], plains: [0.1, 2], farm: [0, 1] }, // [share tall, its levels]
  R: [5, 11],                                          // a lobe's half-size range
  LOBES: [2, 4],
  EDGE_NOISE: 0.14,                                    // how ragged a level's edge is (a share of the lobe)
  // A mountain tile's massif (the playtest 2026-10-23: "Make the mountains more pointed instead of rounded and make it
  // all combine into the center"): one mass of crag, a CORE_R round core somewhere in the middle half of the map and
  // ARMS ridges reaching out from it, ARM_W wide at the core narrowing to a cell at their ends; its height rises a
  // level a cell in from its edge (CRAG_LV: 3 at the edge up to the peak), so it climbs to the core and to a crest
  // along each arm; FOOT cells a level for the foothills round it.
  ARMS: [3, 5], ARM_LEN: [35, 75], ARM_W: [4, 6], CORE_R: [8, 11], CRAG_LV: [3, 13], FOOT: 2,
  HOLE: 8, PASS: 2,                                    // the massif never shuts ground in (openCrag): a hole this small is rock, a pass this wide
};
// A pond tile's spring (the user's words 2026-10-23: "add pond decor to the world map when a tile has a pond in the
// world map generate a pond in the battle map"; mapgen.js tile.pond): one hollow of its land holds water whatever the
// weather (ponds.js: spring-fed, frozen when it freezes). reliefLayer(…, pond): a hollow of the seed's lying wholly in
// the ring NEAR to FAR cells out from the map's middle (Chebyshev: clear of the biggest clearing round a base there,
// CLEARING.hub, and in its fight map's crop) and OFF cells or more off the middle's row and column (the roads), else
// one made in a diagonal quarter (the dice pick which) D cells out each way, R half-sizes across (at least 9 cells
// once its tips are smoothed off: HIGH.DIP_MIN), the ground RIM cells round it made level (a hill cut back to it).
export const SPRING = { NEAR: 16, FAR: 31, OFF: 4, D: 24, R: [5, 7], RIM: 2 };
export const TOWN = {
  town: { BLOCK: 36, STREET: 5, LOT: [10, 13], STORE_P: 0.12, EMPTY_P: 0.1, DRIVE_CAR_P: 0.35, STREET_CAR_P: 0.3 },
  city: { BLOCK: 30, STREET: 6, STORE_P: 0.3, PARK_P: 0.1, LOT_P: 0.14, STREET_CAR_P: 0.5 },
};
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ck = (x, y) => `${x},${y}`;
const tlCache = new Map();
const cached = (key, make) => { let v = tlCache.get(key); if (v) return v; v = make(); if (tlCache.size > 32) tlCache.clear(); tlCache.set(key, v); return v; };
/**
 * The lie of the land over [-G, G) (map coordinates): { heights: [[x, y, h]…] (h −2 to 3, never 0), crags: [[x, y, lv]…]
 * (lv: the rock's height in levels, 3 at its edge up to the peak) }.
 * The same for the same tile, terrain and grid. pond (a pond tile, mapgen.js tile.pond): springs: [[x, y]…] too, the
 * cells of its spring-fed hollow (SPRING); without it the layer is what it always was.
 * @param {number} seed @param {string} terrain @param {number} G @param {boolean} [pond]
 */
export function reliefLayer(seed, terrain, G, pond = false) {
  return cached(`r|${seed}|${terrain}|${G}${pond ? "|p" : ""}`, () => {
    const R = HIGH.REGION, H = new Map(), crag = new Set();
    const inMap = (x, y) => x >= -G + 1 && y >= -G + 1 && x < G - 1 && y < G - 1;
    const raise = (x, y, h) => { if (!inMap(x, y)) return; const k = ck(x, y), o = H.get(k) || 0; if (h > 0 ? h > o : h < 0 && o <= 0 && h < o) H.set(k, h); };
    // A lobe's levels: the nearer its middle (with a ragged edge), the higher (or the deeper, a hollow).
    const lobe = (rng, ex, ey, ax, ay, top) => {
      for (let y = ey - ay - 1; y <= ey + ay + 1; y++) for (let x = ex - ax - 1; x <= ex + ax + 1; x++) {
        const d = Math.sqrt(((x - ex) / ax) ** 2 + ((y - ey) / ay) ** 2) + (hash01s(seed, x, y) - 0.5) * 2 * HIGH.EDGE_NOISE;
        if (d >= 1) continue;
        const lv = Math.min(Math.abs(top), Math.ceil((1 - d) * Math.abs(top) + 1e-9));
        raise(x, y, top > 0 ? lv : -lv);
      }
    };
    for (let ry = Math.floor(-G / R); ry * R < G; ry++) for (let rx = Math.floor(-G / R); rx * R < G; rx++) {
      const rng = new Rng(chunkSeed(seed ^ 0x4a11, rx, ry));
      if (rng.chance(HIGH.P[terrain] || 0)) {
        const [tallP, tallTop] = HIGH.TALL[terrain] || [0, 1], top = rng.chance(tallP) ? rng.int(2, tallTop) : 1;
        const [lo, hi] = HIGH.R, cx = rx * R + rng.int(hi, R - hi), cy = ry * R + rng.int(hi, R - hi);
        for (let i = rng.int(HIGH.LOBES[0], HIGH.LOBES[1]), first = true; i > 0; i--, first = false) lobe(rng, cx + (first ? 0 : rng.int(-lo, lo)), cy + (first ? 0 : rng.int(-lo, lo)), rng.int(lo, hi), rng.int(lo, hi), first ? top : Math.max(1, top - rng.int(0, 1)));
      }
      // A hollow: a level down, an ellipse DIP_R across with a smooth edge (no ragged noise: it stays wide).
      if (rng.chance(HIGH.DIP_P[terrain] || 0)) {
        const [lo, hi] = HIGH.DIP_R, ax = rng.int(lo, hi), ay = rng.int(lo, hi), cx = rx * R + rng.int(hi, R - hi), cy = ry * R + rng.int(hi, R - hi);
        for (let y = cy - ay; y <= cy + ay; y++) for (let x = cx - ax; x <= cx + ax; x++) if (((x - cx) / ax) ** 2 + ((y - cy) / ay) ** 2 <= 1) raise(x, y, -1);
      }
    }
    // A mountain tile's massif: the core, the arms reaching out from it (they taper and wander), the height by the
    // distance in from the crag's edge.
    const cragLv = new Map();
    if (terrain === "mountain") {
      const rng = new Rng(seed ^ 0x2d93);
      const disc = (x, y, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r && inMap(Math.round(x) + dx, Math.round(y) + dy)) crag.add(ck(Math.round(x) + dx, Math.round(y) + dy)); };
      const cx = rng.int(-Math.floor(G / 2), Math.floor(G / 2)), cy = rng.int(-Math.floor(G / 2), Math.floor(G / 2));
      disc(cx, cy, rng.int(HIGH.CORE_R[0], HIGH.CORE_R[1]));
      const arms = rng.int(HIGH.ARMS[0], HIGH.ARMS[1]), a0 = rng.range(0, Math.PI * 2);
      for (let n = 0; n < arms; n++) {
        let a = a0 + (n * Math.PI * 2) / arms + rng.range(-0.4, 0.4), x = cx, y = cy;
        const len = rng.int(HIGH.ARM_LEN[0], HIGH.ARM_LEN[1]), w0 = rng.int(HIGH.ARM_W[0], HIGH.ARM_W[1]);
        for (let i = 0; i < len; i++) {
          disc(x, y, Math.max(1, Math.round(w0 * (1 - i / len))));
          a += rng.range(-0.22, 0.22);
          x += Math.cos(a); y += Math.sin(a);
          if (!inMap(Math.round(x), Math.round(y))) break;
        }
      }
      openCrag(crag, G); // never a pocket of ground the massif walls in: walked to from the map's edge
      // The height: a level a cell in from the edge (eight ways), from CRAG_LV[0] up to CRAG_LV[1].
      const cq = [];
      for (const k of crag) {
        const [x, y] = k.split(",").map(Number);
        let edge = false;
        for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) if (!crag.has(ck(x + dx, y + dy))) { edge = true; break; }
        if (edge) { cragLv.set(k, HIGH.CRAG_LV[0]); cq.push(k); }
      }
      for (let i = 0; i < cq.length; i++) {
        const k = cq[i], lv = cragLv.get(k), [x, y] = k.split(",").map(Number);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = ck(x + dx, y + dy); if (crag.has(n) && !cragLv.has(n)) { cragLv.set(n, Math.min(HIGH.CRAG_LV[1], lv + 1)); cq.push(n); } }
      }
      // The foothills: a level every FOOT cells out from the crag, 3 levels next to it.
      const dist = new Map(), q = [];
      for (const k of crag) { dist.set(k, 0); q.push(k); }
      for (let h = 0; h < q.length; h++) {
        const k = q[h], d = dist.get(k);
        if (d >= 3 * HIGH.FOOT) continue;
        const [x, y] = k.split(",").map(Number);
        for (const [dx, dy] of ORTHO) { const n = ck(x + dx, y + dy); if (!dist.has(n) && inMap(x + dx, y + dy)) { dist.set(n, d + 1); q.push(n); } }
      }
      for (const [k, d] of dist) if (d > 0) { const [x, y] = k.split(",").map(Number); raise(x, y, Math.max(1, 3 - Math.floor((d - 1 + hash01s(seed, x, y) * 1.4) / HIGH.FOOT))); }
    }
    // Never more than a level between neighbours (eight ways): a hill walked up and down anywhere.
    relaxHeights(H, crag);
    dropNarrowHollows(H);
    const springs = pond ? springHollow(seed, H, crag, G) : null;
    for (const k of crag) H.delete(k);
    const out = { heights: [...H].map(([k, h]) => { const [x, y] = k.split(",").map(Number); return [x, y, h]; }), crags: [...crag].map((k) => { const [x, y] = k.split(",").map(Number); return [x, y, cragLv.get(k) || HIGH.CRAG_LV[0]]; }) };
    if (springs) out.springs = springs;
    return out;
  });
}
// A pond tile's spring-fed hollow (SPRING) in the relaxed heights H ("x,y" → h, in place): a hollow of the seed's in the
// ring, the one nearest the quarter's mark, else one made there and the ground eased round it again. Its cells
// [[x, y]…] (none when the map is too small to hold it: an AI group's margin, fort.js).
function springHollow(seed, H, crag, G) {
  const S = SPRING, sx = hash01s(seed ^ 0x5b1e, 3, 5) < 0.5 ? -1 : 1, sy = hash01s(seed ^ 0x5b1e, 7, 11) < 0.5 ? -1 : 1;
  const mx = sx * S.D, my = sy * S.D;
  const ring = (x, y) => Math.min(Math.abs(x), Math.abs(y)) >= S.OFF && Math.max(Math.abs(x), Math.abs(y)) >= S.NEAR && Math.max(Math.abs(x), Math.abs(y)) <= S.FAR;
  // The seed's own: each hollow (cells joined four ways) wholly in the ring and off the crag.
  const seen = new Set();
  let best = null, bd = Infinity;
  for (const [k, h] of H) {
    if (h >= 0 || seen.has(k)) continue;
    const comp = [k];
    seen.add(k);
    let ok = true, cx = 0, cy = 0;
    for (let i = 0; i < comp.length; i++) {
      const [x, y] = comp[i].split(",").map(Number);
      cx += x; cy += y;
      if (!ring(x, y) || crag.has(comp[i])) ok = false;
      for (const [dx, dy] of ORTHO) { const n = ck(x + dx, y + dy); if (!seen.has(n) && (H.get(n) || 0) < 0) { seen.add(n); comp.push(n); } }
    }
    if (!ok) continue;
    const d = Math.hypot(cx / comp.length - mx, cy / comp.length - my);
    if (d < bd) { bd = d; best = comp; }
  }
  if (best) return best.map((k) => k.split(",").map(Number));
  // None: one made at the mark, the ground round it level, then eased in.
  const ax = S.R[0] + Math.floor(hash01s(seed ^ 0x5b1e, 13, 17) * (S.R[1] - S.R[0] + 1)), ay = S.R[0] + Math.floor(hash01s(seed ^ 0x5b1e, 19, 23) * (S.R[1] - S.R[0] + 1));
  if (S.D + Math.max(ax, ay) + S.RIM + 2 >= G) return [];
  const cells = [];
  for (let y = my - ay - S.RIM; y <= my + ay + S.RIM; y++) for (let x = mx - ax - S.RIM; x <= mx + ax + S.RIM; x++) {
    const k = ck(x, y);
    if (((x - mx) / ax) ** 2 + ((y - my) / ay) ** 2 <= 1) { H.set(k, -1); cells.push(k); }
    else if (((x - mx) / (ax + S.RIM)) ** 2 + ((y - my) / (ay + S.RIM)) ** 2 <= 1) H.delete(k);
  }
  relaxHeights(H, crag);
  dropNarrowHollows(H);
  return cells.filter((k) => (H.get(k) || 0) < 0).map((k) => k.split(",").map(Number));
}
// The massif never shuts ground in (the user's words 2026-10-23: "Blocking base due to ridge"; tools/mapreachtest.js):
// a hole in the rock HIGH.HOLE cells or smaller is rock too, and a bigger pocket of ground its arms wall in gets a
// pass carved through them (cragPasses). The crag as "x,y" keys over [-G, G), in place.
function openCrag(crag, G) {
  const N = 2 * G, rock = new Uint8Array(N * N);
  for (const k of crag) { const [x, y] = k.split(",").map(Number); rock[(y + G) * N + x + G] = 1; }
  const { carved, filled } = cragPasses(rock, null, N, N, { hole: HIGH.HOLE });
  for (const i of carved) crag.delete(ck((i % N) - G, Math.floor(i / N) - G));
  for (const i of filled) crag.add(ck((i % N) - G, Math.floor(i / N) - G));
}
/**
 * The crag on a grid never shuts off ground the map's edges reach without it (the user's words 2026-10-23: "Blocking
 * base due to ridge"): each pocket it walls in, the first in the grid's order first, gets a pass HIGH.PASS cells wide
 * carved through the rock the shortest way (the fewest cells of rock) out to ground the edges reach, or, no bigger
 * than opts.hole cells and walled in by rock alone, is filled with rock (a hole in the rock). Walked four ways.
 * rock: 1 for crag (carved here, in place); block: 1 for what else stops a walk (never carved) or null.
 * Returns { carved, filled }: the cells taken out of the rock and put into it.
 * @param {Uint8Array} rock @param {Uint8Array | null} block @param {number} W @param {number} H @param {{ hole?: number }} [opts]
 */
export function cragPasses(rock, block, W, H, opts = {}) {
  const N = W * H, hole = opts.hole || 0, carved = [], filled = [];
  const stop = (i, withRock) => (block && block[i]) || (withRock && rock[i]);
  const flood = (withRock) => {
    const seen = new Uint8Array(N), q = new Int32Array(N);
    let qt = 0;
    const add = (i) => { if (!seen[i] && !stop(i, withRock)) { seen[i] = 1; q[qt++] = i; } };
    for (let x = 0; x < W; x++) { add(x); add((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { add(y * W); add(y * W + W - 1); }
    for (let qh = 0; qh < qt; qh++) {
      const i = q[qh], x = i % W;
      if (x > 0) add(i - 1);
      if (x < W - 1) add(i + 1);
      if (i >= W) add(i - W);
      if (i < N - W) add(i + W);
    }
    return seen;
  };
  const free = block ? flood(false) : null; // what the edges reach with no crag at all
  for (let round = 0; round < 256; round++) {
    const seen = flood(true);
    let start = -1;
    for (let i = 0; i < N && start < 0; i++) if (!seen[i] && !stop(i, true) && (!free || free[i])) start = i;
    if (start < 0) break;
    // The pocket: the ground walled in with it.
    const pocket = [start], inP = new Uint8Array(N);
    inP[start] = 1;
    let rockOnly = true;
    for (let h = 0; h < pocket.length; h++) {
      const i = pocket[h], x = i % W;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
        if (j < 0 || j >= N || inP[j]) continue;
        if (block && block[j]) { rockOnly = false; continue; }
        if (rock[j]) continue;
        inP[j] = 1; pocket.push(j);
      }
    }
    if (pocket.length <= hole && rockOnly) { for (const i of pocket) { rock[i] = 1; filled.push(i); } continue; }
    // The shortest way out through the rock (a search level by level: a cell of rock costs 1, open ground 0).
    const done = new Uint8Array(N), from = new Int32Array(N).fill(-1);
    let cur = pocket.slice(), out = -1;
    for (const i of pocket) done[i] = 1;
    while (cur.length && out < 0) {
      const next = [];
      for (let h = 0; h < cur.length; h++) {
        const i = cur[h], x = i % W;
        if (seen[i]) { out = i; break; }
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
          if (j < 0 || j >= N || done[j] || (block && block[j])) continue;
          if (rock[j]) { if (from[j] < 0) { from[j] = i; next.push(j); } continue; } // the next level: a cell more of rock
          done[j] = 1; from[j] = i; cur.push(j);
        }
      }
      cur = next.filter((j) => !done[j]);
      for (const j of cur) done[j] = 1;
    }
    if (out < 0) break; // nothing to carve to (cannot happen: the pocket was reached with the crag taken away)
    for (let i = out; i >= 0 && !inP[i]; i = from[i]) {
      const x = i % W, y = Math.floor(i / W);
      for (let dy = 0; dy < HIGH.PASS; dy++) for (let dx = 0; dx < HIGH.PASS; dx++) {
        const nx = Math.min(W - 1, x + dx), ny = Math.min(H - 1, y + dy), j = ny * W + nx;
        if (rock[j]) { rock[j] = 0; carved.push(j); }
      }
    }
  }
  return { carved, filled };
}
/**
 * A level at most between neighbours (eight ways): a hill only ever lowered and a hollow only ever raised toward its
 * neighbours until no step is more than a level; a cell not in the map is level ground (0), one in `apart` (the crag)
 * is left out. In place. @param {Map<string, number>} H "x,y" → h @param {Set<string>} [apart]
 */
export function relaxHeights(H, apart = new Set()) {
  // Worked on a grid over the heights' extent (a cell off it is level ground, never the crag), in the map's own order
  // and in place as it was done on the map itself, so the result is the same to the cell (the 500 × 500 base map's
  // land took four times as long with the map's string keys: the autopilot's days twice as long).
  if (!H.size) return H;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const keys = [...H.keys()], xs = new Int32Array(keys.length), ys = new Int32Array(keys.length);
  keys.forEach((k, i) => { const c = k.indexOf(","), x = +k.slice(0, c), y = +k.slice(c + 1); xs[i] = x; ys[i] = y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; });
  x0 -= 2; y0 -= 2; x1 += 2; y1 += 2;
  const W = x1 - x0 + 1, N = W * (y1 - y0 + 1), g = new Int8Array(N), rock = new Uint8Array(N), at = new Int32Array(keys.length);
  keys.forEach((k, i) => { at[i] = (ys[i] - y0) * W + xs[i] - x0; g[at[i]] = H.get(k); });
  for (const k of apart) { const c = k.indexOf(","), x = +k.slice(0, c), y = +k.slice(c + 1); if (x >= x0 && x <= x1 && y >= y0 && y <= y1) rock[(y - y0) * W + x - x0] = 1; }
  const lvAt = (j, h) => (rock[j] ? (h > 0 ? 9 : -9) : g[j]); // the crag: as high as any hill beside it
  const live = () => { const out = []; for (let i = 0; i < keys.length; i++) if (g[at[i]] && !rock[at[i]]) out.push(at[i]); return out; };
  for (let round = 0, any = true; any && round < 8; round++) {
    any = false;
    // No spur or finger a cell wide (the playtest 2026-10-23: "smoothe out the hills to have at least 2 next to each
    // other and attached to the hill"): a raised cell stands in a 2 × 2 of cells as high or higher (a sunk one as deep
    // or deeper), else it comes down (or up) a level.
    for (let pass = 0, changed = true; changed && pass < 12; pass++) {
      changed = false;
      for (const j of live()) {
        const h = g[j];
        let ok = false;
        for (const o of [0, -1, -W, -W - 1]) {
          const a = lvAt(j + o, h), b = lvAt(j + o + 1, h), c = lvAt(j + o + W, h), d = lvAt(j + o + W + 1, h);
          if (h > 0 ? a >= h && b >= h && c >= h && d >= h : a <= h && b <= h && c <= h && d <= h) { ok = true; break; }
        }
        if (ok) continue;
        g[j] = h > 0 ? h - 1 : h + 1;
        changed = any = true;
      }
    }
    // A level at most between neighbours (eight ways): a hill only lowered, a hollow only raised.
    for (let pass = 0, changed = true; changed && pass < 12; pass++) {
      changed = false;
      for (const j of live()) {
        const h = g[j];
        let lo = Infinity, hi = -Infinity;
        for (const o of [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1]) { if (rock[j + o]) continue; const v = g[j + o]; if (v < lo) lo = v; if (v > hi) hi = v; }
        const v = h > 0 ? Math.min(h, lo + 1) : Math.max(h, hi - 1);
        if (v !== h) { changed = any = true; g[j] = v; }
      }
    }
  }
  keys.forEach((k, i) => { if (rock[at[i]]) return; const v = g[at[i]]; if (!v) H.delete(k); else if (v !== H.get(k)) H.set(k, v); });
  return H;
}
/**
 * Hollows a level down at most, and none narrower than HIGH.DIP_MIN cells either way (its cells joined four ways, its
 * extent): the rest filled in. In place. @param {Map<string, number>} H "x,y" → h
 */
export function dropNarrowHollows(H) {
  for (const [k, h] of H) if (h < -1) H.set(k, -1);
  const seen = new Set();
  for (const [k, h] of [...H]) {
    if (h >= 0 || seen.has(k)) continue;
    const comp = [k], [sx, sy] = k.split(",").map(Number);
    let x0 = sx, x1 = sx, y0 = sy, y1 = sy;
    seen.add(k);
    for (let i = 0; i < comp.length; i++) {
      const [x, y] = comp[i].split(",").map(Number);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const [dx, dy] of ORTHO) { const n = ck(x + dx, y + dy); if (!seen.has(n) && (H.get(n) || 0) < 0) { seen.add(n); comp.push(n); } }
    }
    if (x1 - x0 + 1 < HIGH.DIP_MIN || y1 - y0 + 1 < HIGH.DIP_MIN) for (const c of comp) H.delete(c);
  }
  return H;
}
// A cell's own dice (no Rng: the same whatever is asked first).
const hash01s = (seed, x, y) => (((Math.imul(seed ^ Math.imul(x + 0x9e37, 0x85ebca6b), 0xc2b2ae35) ^ Math.imul(y + 0x7f4a, 0x27d4eb2f)) >>> 0) % 10007) / 10007;

// One building: { k, g, cells, parts } (parts[i]: { k, f: "floor", fl?, t? } for cells[i]). face: the side its front
// door is on ("n" | "s" | "e" | "w"). Walls round it with windows, the door(s), rooms split off with a gap in each
// wall between them (never across a door), then the furniture against the walls, each piece kept only if every bit of
// the floor can still be walked to from the front door.
/** @param {Rng} rng @param {string} k @param {number} x0 @param {number} y0 @param {number} w @param {number} h @param {string} face @param {string} g */
function building(rng, k, x0, y0, w, h, face, g) {
  const x1 = x0 + w - 1, y1 = y0 + h - 1, K = new Map();
  const get = (x, y) => K.get(ck(x, y));
  const set = (x, y, v) => K.set(ck(x, y), v);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, x === x0 || x === x1 || y === y0 || y === y1 ? "wall" : "open");
  // The sides: [cells along it (no corners), the inward step].
  /** @type {(s: string) => [number[][], number[]]} */
  const side = (s) => s === "n" ? [Array.from({ length: w - 2 }, (_, i) => [x0 + 1 + i, y0]), [0, 1]] : s === "s" ? [Array.from({ length: w - 2 }, (_, i) => [x0 + 1 + i, y1]), [0, -1]] : s === "w" ? [Array.from({ length: h - 2 }, (_, i) => [x0, y0 + 1 + i]), [1, 0]] : [Array.from({ length: h - 2 }, (_, i) => [x1, y0 + 1 + i]), [-1, 0]];
  const back = { n: "s", s: "n", e: "w", w: "e" }[face];
  for (const s of ["n", "s", "e", "w"]) {
    const [cells] = side(s), every = k === "block" ? 2 : 3;
    cells.forEach(([x, y], i) => { if (k === "store" && s === face ? i > 0 && i < cells.length - 1 : i % every === 1) set(x, y, rng.chance(0.15) ? "smashed" : "window"); });
  }
  const doors = [];
  const door = (s, wide) => {
    const [cells, [dx, dy]] = side(s), mid = Math.floor(cells.length / 2) + (cells.length > 4 ? rng.int(-1, 1) : 0);
    for (const i of wide ? [mid - 1, mid] : [mid]) { const [x, y] = cells[Math.max(0, Math.min(cells.length - 1, i))]; set(x, y, "doorway"); doors.push([x, y, dx, dy]); }
  };
  door(face, k === "store");
  if (k === "block" || (k === "house" && rng.chance(0.4))) door(back, false);
  const inFront = new Set(doors.map(([x, y, dx, dy]) => ck(x + dx, y + dy)));
  // Rooms: split the inside along its longer side while both halves keep MIN cells; a gap in each new wall.
  const MIN = k === "block" ? 3 : 2, gaps = new Set(); // a room at least this wide
  const split = (ax0, ay0, ax1, ay1, depth) => {
    const W = ax1 - ax0 + 1, H = ay1 - ay0 + 1, vert = W >= H;
    const len = vert ? W : H;
    if (depth <= 0 || len < 2 * MIN + 1) return;
    for (let tries = 0; tries < 6; tries++) {
      const p = (vert ? ax0 : ay0) + rng.int(MIN, len - MIN - 1);
      const line = vert ? Array.from({ length: H }, (_, i) => [p, ay0 + i]) : Array.from({ length: W }, (_, i) => [ax0 + i, p]);
      if (line.some(([x, y]) => inFront.has(ck(x, y)))) continue;
      // Never against a door or a gap in the walls round it (the wall would close it).
      const ends = vert ? [[p, ay0 - 1], [p, ay1 + 1]] : [[ax0 - 1, p], [ax1 + 1, p]];
      if (ends.some(([x, y]) => get(x, y) !== "wall" && get(x, y) !== "window" && get(x, y) !== "smashed")) continue;
      const gap = line[rng.int(0, line.length - 1)];
      for (const [x, y] of line) set(x, y, "wall");
      set(gap[0], gap[1], "open"); gaps.add(ck(gap[0], gap[1]));
      if (vert) { split(ax0, ay0, p - 1, ay1, depth - 1); split(p + 1, ay0, ax1, ay1, depth - 1); }
      else { split(ax0, ay0, ax1, p - 1, depth - 1); split(ax0, p + 1, ax1, ay1, depth - 1); }
      return;
    }
  };
  if (k === "house") split(x0 + 1, y0 + 1, x1 - 1, y1 - 1, h * w >= 56 ? 2 : 1);
  else if (k === "block") split(x0 + 1, y0 + 1, x1 - 1, y1 - 1, 3);
  // Every open cell walked to from inside the front door?
  const whole = () => {
    const [fx, fy, fdx, fdy] = doors[0], start = ck(fx + fdx, fy + fdy);
    if (get(fx + fdx, fy + fdy) !== "open") return false;
    const seen = new Set([start]), q = [[fx + fdx, fy + fdy]];
    while (q.length) { const [x, y] = q.pop(); for (const [dx, dy] of ORTHO) { const n = ck(x + dx, y + dy), v = K.get(n); if (!seen.has(n) && (v === "open" || v === "doorway")) { seen.add(n); q.push([x + dx, y + dy]); } } }
    for (const [n, v] of K) if (v === "open" && !seen.has(n)) return false;
    return true;
  };
  const nearDoor = (x, y) => [[0, 0], ...ORTHO].some(([dx, dy]) => inFront.has(ck(x + dx, y + dy)) || gaps.has(ck(x + dx, y + dy)));
  const byWall = (x, y) => ORTHO.some(([dx, dy]) => { const v = get(x + dx, y + dy); return v === "wall" || v === "window" || v === "smashed"; });
  const place = (kind, wantWall = true) => {
    const spots = [];
    for (const [n, v] of K) { if (v !== "open") continue; const [x, y] = n.split(",").map(Number); if (!nearDoor(x, y) && (!wantWall || byWall(x, y))) spots.push([x, y]); }
    for (let tries = 0; tries < 8 && spots.length; tries++) {
      const [x, y] = spots[rng.int(0, spots.length - 1)];
      set(x, y, kind);
      if (whole()) return true;
      set(x, y, "open");
    }
    return false;
  };
  if (k === "store") {
    // Shelves in rows across the shop, aisles round them; a counter or two and a cabinet.
    const [, [dx, dy]] = side(face), across = dx === 0;
    const depth = across ? h - 2 : w - 2, span = across ? w - 2 : h - 2;
    for (let d = 3; d < depth - 2; d += 2) for (let i = 2; i < span - 2; i++) {
      const x = across ? x0 + 1 + i : dx > 0 ? x0 + d : x1 - d, y = across ? (dy > 0 ? y0 + d : y1 - d) : y0 + 1 + i;
      if (get(x, y) === "open" && !nearDoor(x, y)) set(x, y, "shelf");
    }
    if (!whole()) for (const [n, v] of K) if (v === "shelf") K.set(n, "open"); // never shuts anything off
    place("counter"); place("counter"); place("cabinet");
  } else if (k === "house") {
    for (const f of ["bed", "bed", "table", "counter", "counter", "cabinet"]) place(f, f !== "table");
  } else {
    for (let n = Math.round((w * h) / 18); n > 0; n--) place(rng.pick(["table", "cabinet", "bed", "rack", "counter", "table", "cabinet"]), true);
  }
  const fl = k === "store" ? "tile" : k === "block" ? rng.pick(["conc", "carpet", "tile"]) : rng.pick(["carpet", "tile"]);
  const cells = [], parts = [];
  for (const [n, v] of K) {
    const [x, y] = n.split(",").map(Number);
    cells.push([x, y]);
    parts.push({ k: v, f: "floor", ...(v === "open" || v === "doorway" || !["wall", "window", "smashed"].includes(v) ? { fl } : {}), ...(k === "block" && v === "wall" ? { t: 2 } : {}) });
  }
  return { k, g, cells, parts };
}

/**
 * The streets and buildings of a town or a city over [-G, G) (map coordinates): { floors: [[x, y, f]…], pieces }. The
 * pieces: buildings (k "house" | "store" | "block", with parts), wrecks in the streets and driveways, fences, trees and
 * bushes in the yards and the parks.
 * @param {number} seed @param {string} style "town" | "city" @param {number} G
 */
export function townLayer(seed, style, G) {
  const T = TOWN[style];
  if (!T) return { floors: [], pieces: [] };
  return cached(`t|${seed}|${style}|${G}`, () => {
    const B = T.BLOCK, S = T.STREET, off = seed % B;
    const floors = [], pieces = [];
    const md = (a) => (((a - off) % B) + B) % B; // where a is across the period: under S is the street
    const city = style === "city";
    for (let y = -G; y < G; y++) for (let x = -G; x < G; x++) {
      const a = md(x), b = md(y);
      if (a < S || b < S) floors.push([x, y, "road"]);
      else if (city && (a === S || a === B - 1 || b === S || b === B - 1)) floors.push([x, y, "deck"]); // the sidewalk
    }
    const inMap = (x, y) => x >= -G + 1 && y >= -G + 1 && x < G - 1 && y < G - 1;
    const fits = (x0, y0, w, h) => inMap(x0, y0) && inMap(x0 + w - 1, y0 + h - 1);
    const one = (k, x, y, g) => { if (inMap(x, y)) pieces.push({ k, g, cells: [[x, y]] }); };
    const car = (x, y, ax, g, rng) => {
      const truck = rng.chance(0.25), len = truck ? 4 : 3, cells = [];
      for (let i = 0; i < len; i++) for (let j = 0; j < 2; j++) cells.push(ax ? [x + j, y + i] : [x + i, y + j]);
      if (cells.every(([cx, cy]) => inMap(cx, cy))) pieces.push({ k: "wreck", g, cells, body: truck ? "truck" : "car", ax, len });
    };
    const i0 = Math.floor((-G - off) / B) - 1, i1 = Math.ceil((G - off) / B);
    // The cars left in the streets: along each street, in a lane, now and then.
    for (let i = i0; i <= i1; i++) {
      const line = off + i * B;
      for (let t = Math.floor(-G / 8) * 8 + 2; t < G - 5; t += 8) {
        const rng = new Rng(chunkSeed(seed ^ 0x5e7c, i, t)); // the same car on the same stretch whatever the grid
        if (rng.chance(T.STREET_CAR_P)) { const lane = line + rng.pick([0, S - 2]); if (md(t) >= S && md(t + 6) >= S) car(t + rng.int(0, 2), lane, 0, `tc${line}x${t}`, rng); }
        if (rng.chance(T.STREET_CAR_P)) { const lane = line + rng.pick([0, S - 2]); if (md(t) >= S && md(t + 6) >= S) car(lane, t + rng.int(0, 2), 1, `tc${line}y${t}`, rng); }
        if (rng.chance(0.15)) one(rng.pick(["crate", "barrel"]), t + rng.int(0, 7), line + rng.int(0, S - 1), `td${line}x${t}`);
      }
    }
    for (let j = i0; j <= i1; j++) for (let i = i0; i <= i1; i++) {
      const bx0 = off + i * B + S, by0 = off + j * B + S, L = B - S; // the block [bx0, bx0 + L) × [by0, by0 + L)
      if (bx0 + L <= -G || by0 + L <= -G || bx0 >= G || by0 >= G) continue;
      const rng = new Rng(chunkSeed(seed ^ 0x70f1, i, j)), gb = `b${i},${j}`;
      if (!city) {
        // Two rows of lots back to back, the north row facing the street to the north, the south row the south.
        const half = Math.floor(L / 2);
        for (const row of ["n", "s"]) {
          const ry0 = row === "n" ? by0 : by0 + half, ry1 = row === "n" ? by0 + half - 1 : by0 + L - 1; // inclusive
          let lx = bx0;
          while (lx < bx0 + L) {
            let lw = rng.int(T.LOT[0], T.LOT[1]);
            if (bx0 + L - (lx + lw) < T.LOT[0]) lw = bx0 + L - lx;
            const g = `${gb}${row}${lx}`, roll = rng.next();
            // The back yard's fence (the lot's back line and its sides in the back half), gaps in it.
            const backY = row === "n" ? ry1 : ry0;
            for (let x = lx; x < lx + lw; x++) if (rng.chance(0.75)) one("fence", x, backY, `${g}f${x}`);
            for (let y = Math.min(backY, row === "n" ? ry0 + 9 : ry1 - 9); y <= Math.max(backY, row === "n" ? ry0 + 9 : ry1 - 9); y++) if (y !== backY && rng.chance(0.7)) one("fence", lx, y, `${g}s${y}`);
            if (roll < T.EMPTY_P) {
              for (let n = rng.int(3, 6); n > 0; n--) one(rng.chance(0.7) ? "bush" : "tree", lx + rng.int(1, lw - 2), rng.int(ry0 + 1, ry1 - 1), `${g}e${n}`);
            } else if (roll < T.EMPTY_P + T.STORE_P && lw >= 11) {
              const w = lw - 2, h = Math.min(half - 5, rng.int(8, 10)), x0 = lx + 1, y0 = row === "n" ? ry0 + 4 : ry1 - 3 - h + 1;
              if (fits(x0, y0, w, h)) {
                pieces.push(building(rng, "store", x0, y0, w, h, row, `${g}st`));
                // The gravel lot in front, a car left on it now and then.
                for (let y = row === "n" ? ry0 : y0 + h; y < (row === "n" ? y0 : ry1 + 1); y++) for (let x = x0; x < x0 + w; x++) floors.push([x, y, "gravel"]);
                if (rng.chance(0.5)) car(x0 + rng.int(1, Math.max(1, w - 4)), row === "n" ? ry0 + 1 : ry1 - 1, 0, `${g}pc`, rng); // a row clear in front of the doors (on a south row it stood right against them: tools/mapreachtest.js)
              }
            } else {
              const w = Math.min(lw - 3, rng.int(7, 9)), h = rng.int(6, 8), left = rng.chance(0.5);
              const x0 = left ? lx + lw - 1 - w : lx + 1, y0 = row === "n" ? ry0 + rng.int(2, 3) : ry1 - rng.int(2, 3) - h + 1;
              if (fits(x0, y0, w, h)) {
                const hb = building(rng, "house", x0, y0, w, h, row, `${g}h`);
                pieces.push(hb);
                // The path from the front door to the street, and a driveway beside the house with a car on it now and then.
                const fd = hb.parts.findIndex((p, i) => p.k === "doorway" && hb.cells[i][1] === (row === "n" ? y0 : y0 + h - 1)), [dx] = hb.cells[fd]; // the front door (on a south row a back door came first: the path led to the wall beside it, tools/mapreachtest.js)
                for (let y = row === "n" ? ry0 : y0 + h; y < (row === "n" ? y0 : ry1 + 1); y++) floors.push([dx, y, "gravel"]);
                const dx0 = left ? lx + 1 : x0 + w + 1;
                if ((left ? x0 - lx - 1 : lx + lw - (x0 + w) - 1) >= 2) {
                  const yA = row === "n" ? ry0 : y0, yB = row === "n" ? y0 + h - 1 : ry1;
                  for (let y = yA; y <= yB; y++) for (let x = dx0; x < dx0 + 2; x++) floors.push([x, y, "gravel"]);
                  if (rng.chance(T.DRIVE_CAR_P)) car(dx0, row === "n" ? ry0 + 1 : ry1 - 4, 1, `${g}dc`, rng);
                }
                // A tree or a bush in the front yard, something left in the back.
                if (rng.chance(0.5)) one(rng.chance(0.5) ? "tree" : "bush", left ? x0 + w - 1 : x0, row === "n" ? ry0 + 1 : ry1 - 1, `${g}ft`);
                if (rng.chance(0.5)) one(rng.pick(["crate", "barrel", "bush", "tree"]), lx + rng.int(1, lw - 2), row === "n" ? backY - 1 : backY + 1, `${g}by`);
              }
            }
            lx += lw;
          }
        }
      } else {
        // The sidewalk round the block; inside it parcels of a quarter or a half of the block, each one a city block,
        // a store, a parking lot or a park; an alley between the buildings.
        const ix0 = bx0 + 1, iy0 = by0 + 1, IL = L - 2, hl = Math.floor(IL / 2);
        const cut = rng.next(), parcels = cut < 0.5 ? [[0, 0, hl, hl], [hl, 0, IL - hl, hl], [0, hl, hl, IL - hl], [hl, hl, IL - hl, IL - hl]] : cut < 0.75 ? [[0, 0, IL, hl], [0, hl, IL, IL - hl]] : [[0, 0, hl, IL], [hl, 0, IL - hl, IL]];
        parcels.forEach(([px, py, pw, ph], n) => {
          const x0 = ix0 + px, y0 = iy0 + py, g = `${gb}p${n}`;
          const onN = py === 0, onS = py + ph === IL, onW = px === 0, onE = px + pw === IL;
          const faces = [onN && "n", onS && "s", onW && "w", onE && "e"].filter(Boolean);
          const face = rng.pick(/** @type {string[]} */ (faces));
          const roll = rng.next();
          if (roll < T.PARK_P) {
            for (let n2 = rng.int(4, 8); n2 > 0; n2--) one(rng.chance(0.6) ? "tree" : "bush", x0 + rng.int(1, pw - 2), y0 + rng.int(1, ph - 2), `${g}k${n2}`);
          } else if (roll < T.PARK_P + T.LOT_P) {
            for (let y = y0; y < y0 + ph; y++) for (let x = x0; x < x0 + pw; x++) floors.push([x, y, "gravel"]);
            for (let n2 = rng.int(1, 3); n2 > 0; n2--) car(x0 + rng.int(1, Math.max(1, pw - 5)), y0 + rng.int(1, Math.max(1, ph - 3)), 0, `${g}c${n2}`, rng);
          } else {
            // The building fills the parcel but for an alley a cell wide on its inner sides.
            const bx = x0, by = y0, bw = pw - (onE ? 0 : 1), bh = ph - (onS ? 0 : 1);
            if (bw >= 6 && bh >= 6 && fits(bx, by, bw, bh)) pieces.push(building(rng, roll < T.PARK_P + T.LOT_P + T.STORE_P ? "store" : "block", bx, by, bw, bh, face, `${g}b`));
          }
          if (rng.chance(0.4)) { if (!onE) one(rng.pick(["crate", "barrel"]), x0 + pw - 1, y0 + rng.int(0, ph - 2), `${g}a`); else if (!onS) one(rng.pick(["crate", "barrel"]), x0 + rng.int(0, pw - 2), y0 + ph - 1, `${g}a`); } // in the alley
        });
      }
    }
    // A car left in the street never parks across a driveway or a lot (gravel): the way from a door out onto the street
    // stays open (tools/mapreachtest.js; on the 500 × 500 map one now and then shut a house in).
    const gravel = new Set(floors.filter((f) => f[2] === "gravel").map(([x, y]) => `${x},${y}`));
    const across = (p) => p.k === "wreck" && p.g.startsWith("tc") && p.cells.some(([x, y]) => gravel.has(`${x},${y - 1}`) || gravel.has(`${x},${y + 1}`) || gravel.has(`${x - 1},${y}`) || gravel.has(`${x + 1},${y}`));
    return { floors, pieces: pieces.filter((p) => !across(p)) };
  });
}

// ---------- the land of one base ----------
// What the land is made from: the tile's dice, terrain (a farm's fields as "farm"), the grid, the yard, the clearing,
// the road's axes and the river's (spec.road: "x" | "y" | "xy" | ""; spec.river: "x" | "y" | "").
/** @param {any} state @param {any} base @param {{ G: number, C: number, tier: string, terrain: string, origin?: number[], fresh?: boolean, compact?: boolean, level?: number }} dims */
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
  const [ox, oy] = dims.origin || [0, 0];
  // A town's streets and houses (the suburbs and a town's own tile: basemap.js terrainOf), a city's blocks; the high
  // ground of hills and mountains.
  const style = dims.terrain === "city" ? "city" : dims.terrain === "suburb" ? "town" : "";
  // A pond tile (mapgen.js tile.pond): its spring-fed hollow (reliefLayer SPRING).
  // level: the base's own ground level (basemap.js levelOf: a camp set up on a hill stands on it, the user's request
  // 2026-10-23), 0 for level ground and the tile's land with no base on it.
  // compact (basemap.js landFor: land.v 3): a base read since the user's request 2026-10-24 ("The clearing of initial
  // foliage is done in the 5x5") has the tile's land all round like a camp's, only its 5 × 5 and what it stands on cleared.
  const own = dims.fresh || dims.compact; // the tile's own land all round: no yard and no clearing but what was cleared (a camp's 5 × 5)
  return { seed, terrain: dims.terrain, G: dims.G, C: own ? 0 : dims.C, clear: own ? 0 : CLEARING[dims.tier] ?? CLEARING.camp, road, river, riverSide, style, ox, oy, pond: !!(t && t.pond), level: dims.level || 0 };
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
// The lands last read, the least recently used dropped first (a 500 × 500 map's land is about 24 MB: forty-eight of
// them, emptied all at once when full, were over a gigabyte and made again as soon as they were dropped). One entry a
// land: its key leaves out land.n (what has been cleared), so a clearing replaces the base's land in place rather
// than leaving the old one behind to fill the cache (each 24-40 MB).
const LAND_CACHE = 16, landCache = new Map();
const byCell = (a, b) => { const [ax, ay] = a.split(",").map(Number), [bx, by] = b.split(",").map(Number); return ay - by || ax - bx; };
/**
 * The land of a base now: { pieces: Map "x,y" → piece (every cell of a wreck maps to its piece), floors: Map "x,y" →
 * floor, list: the pieces once each }. A piece: { k, g, cells: [[x, y]…], body?, ax?, len?, looted? } (k "water" for the
 * river: never cleared). What is cleared (base.land.cleared) is gone.
 * @param {any} spec landSpec @param {any} land base.land
 */
export function landOf(spec, land) {
  const tx = spec.ox || 0, ty = spec.oy || 0; // the base on the map: map (x, y) is grid (x - tx, y - ty)
  const key = `${spec.seed}|${spec.terrain}|${spec.G}|${spec.C}|${spec.clear}|${spec.road}|${spec.river}${spec.riverSide || ""}|${tx},${ty}|${land ? "b" : "-"}${spec.pond ? "|p" : ""}${spec.level ? `|L${spec.level}` : ""}`;
  let out = landCache.get(key);
  if (out && out.land === land && out.n === (land ? land.n : null)) { landCache.delete(key); landCache.set(key, out); return out.v; } // the most recently used kept longest
  const cleared = (land && land.cleared) || {}, looted = (land && land.looted) || {};
  const pieces = new Map(), floors = new Map(), list = [];
  // Worked out in map coordinates; the yard and the clearing are round the base itself, what is cleared in grid cells.
  const nearBase = (x, y, h) => inSq(x - tx, y - ty, h);
  // What is cleared and what is taken (pieces.has), for the cells of the map ([-G, G) square, whole numbers) also kept
  // by cell number in typed arrays: asked of every cell, an "x,y" string made each time was a fifth of the land's time.
  // Anything else (off the map, a non-integer cell or origin) asks the string-keyed records as before: the same answers.
  const G = spec.G, N = 2 * G, fast = Number.isInteger(G) && G > 0 && G < 1e4 && Number.isInteger(tx) && Number.isInteger(ty) && Math.abs(tx) < 1e9 && Math.abs(ty) < 1e9;
  const cellOf = (x, y) => ((x | 0) === x && (y | 0) === y && x >= -G && y >= -G && x < G && y < G ? (y + G) * N + x + G : -1);
  const taken = fast ? new Uint8Array(N * N) : null, clearedAt = fast ? new Uint8Array(N * N) : null;
  let anyCleared = false;
  for (const k of Object.keys(cleared)) {
    if (!cleared[k]) continue;
    anyCleared = true;
    if (!fast) break;
    const c = k.indexOf(","), x = Number(k.slice(0, c)), y = Number(k.slice(c + 1));
    if (c < 0 || `${x},${y}` !== k) continue; // never the key of a cell asked for
    const i = cellOf(x + tx, y + ty);
    if (i >= 0) clearedAt[i] = 1;
  }
  const goneKey = (x, y) => !!cleared[`${x - tx},${y - ty}`];
  const gone = !anyCleared ? () => false : !fast ? goneKey : (x, y) => { const i = cellOf(x, y); return i >= 0 ? clearedAt[i] === 1 : goneKey(x, y); };
  let oddCells = false; // a piece's cell not given in numbers (never so far): pieces.has alone answers then
  const has = !fast ? (x, y) => pieces.has(`${x},${y}`) : (x, y) => { const i = oddCells ? -1 : cellOf(x, y); return i >= 0 ? taken[i] === 1 : pieces.has(`${x},${y}`); };
  const free = (x, y) => !nearBase(x, y, spec.clear) && x >= -spec.G && y >= -spec.G && x < spec.G && y < spec.G && !has(x, y) && !gone(x, y);
  const put = (p) => { list.push(p); for (const [x, y] of p.cells) { pieces.set(`${x},${y}`, p); if (fast) { const i = cellOf(x, y); if (i >= 0) taken[i] = 1; else if (typeof x !== "number" || typeof y !== "number") oddCells = true; } } };
  // The river first (nothing else on the water), then the road and what was left on it, then the terrain.
  if (spec.river) for (let a = -spec.G; a < spec.G; a++) for (let b = -spec.G; b < spec.G; b++) {
    const x = spec.river === "y" ? a : b, y = spec.river === "y" ? b : a, r = onRiver(spec, x, y);
    if (r === 1 && !nearBase(x, y, spec.clear) && !gone(x, y)) put({ k: "water", g: `w${x},${y}`, cells: [[x, y]] });
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
  // A town's or a city's streets and buildings, the high ground of the hills: each piece whole or not at all (off the
  // river, the road, the yard and the clearing), the buildings first.
  const street = (x, y) => floors.get(`${x},${y}`) === "road";
  if (spec.style) {
    const T = townLayer(spec.seed, spec.style, spec.G), rank = (p) => (p.parts ? 0 : p.k === "wreck" ? 1 : 2);
    for (const [x, y, f] of T.floors) if (!nearBase(x, y, spec.clear) && !(f !== "road" && street(x, y)) && !(spec.river && onRiver(spec, x, y))) floors.set(`${x},${y}`, f);
    for (const p of [...T.pieces].sort((a, b) => rank(a) - rank(b))) {
      if (!p.cells.every(([x, y]) => free(x, y) && !nearBase(x, y, spec.C) && !(spec.road && onRoad(spec, x, y)) && !(spec.river && onRiver(spec, x, y)))) continue;
      if (p.k !== "wreck" && !p.parts && street(p.cells[0][0], p.cells[0][1])) continue;
      put({ ...p, cells: p.cells.map((c) => c.slice()), ...(p.k === "wreck" ? { looted: !!looted[p.g] } : {}) });
    }
  }
  // The lie of the land (reliefLayer): the mountains' crag first (never on a road: a pass through the ridge), the
  // heights under whatever stands there (trees, bushes, a road), flat in the yard and the clearing and on the river.
  // A pond tile's spring (SPRING): its hollow kept in the yard too (never in the clearing), nothing of the scatter on it.
  const relief = reliefLayer(spec.seed, spec.terrain, spec.G, !!spec.pond), heights = new Map();
  const spring = new Set((relief.springs || []).map(([x, y]) => `${x},${y}`));
  // The ground is eased (relaxHeights) against the crag laid here only: where a road, the yard, the clearing, the river
  // or what is cleared keeps it off, the ground is level and the hills beside come down to it a level a step (it was
  // eased against all of the massif's rock, leaving a road's pass a trench three levels deep: tools/mapreachtest.js).
  const rock = new Set();
  for (const [x, y, lv] of relief.crags) if (free(x, y) && !nearBase(x, y, spec.C) && !street(x, y) && !(spec.river && onRiver(spec, x, y))) { put({ k: "crag", g: `c${x},${y}`, cells: [[x, y]], h: lv }); rock.add(`${x},${y}`); }
  // land.keepH (a camp set up since the user's request 2026-10-23: "It should not be trying to burrow just build on the
  // hill as if it was the ground floor"): what is cleared keeps the ground's own height (a tree felled on a hill leaves
  // the hill); before, the ground went with it, dug down to the plain's.
  const keepH = !!(land && land.keepH), L = spec.level || 0;
  for (const [x, y, h] of relief.heights) if (!nearBase(x, y, spring.size && spring.has(`${x},${y}`) ? spec.clear : Math.max(spec.C, spec.clear)) && (keepH || !gone(x, y)) && !has(x, y) && !(spec.river && onRiver(spec, x, y))) heights.set(`${x},${y}`, h);
  relaxHeights(heights, rock); // the yard, the clearing and what is cleared are level: the ground eased down to them
  dropNarrowHollows(heights); // a hollow cut narrow by them filled in
  // Nothing of the scatter on the ground paved before it (a road, a ford, a town's paths, driveways, lots and
  // sidewalks): a tree on a house's path or a fence across a ford shut the way in (tools/mapreachtest.js).
  const paved = new Set(floors.keys());
  // Farmland's fenced fields (fieldLayer): before the scatter, so nothing of it stands on a fence line; a gate's apron
  // (FIELD.APRON cells either side of it, a cell past each end) kept clear of the scatter. None in the yard, the
  // clearing or on the paving (gaps in the fence there), and no field the river or a road runs through (the user's
  // word 2026-10-23: "Roads interrupt the fences": a field cut in two by the road, its fence broken either side).
  const apron = new Set();
  const fieldOk = (x, y) => free(x, y) && !nearBase(x, y, spec.C) && !(spec.road && onRoad(spec, x, y)) && !street(x, y) && !paved.has(`${x},${y}`) && !spring.has(`${x},${y}`);
  const across = (f, on) => { for (let y = f.y0 - 1; y <= f.y0 + f.s; y++) for (let x = f.x0 - 1; x <= f.x0 + f.s; x++) if (on(spec, x, y)) return true; return false; };
  for (const f of fieldLayer(spec.seed, spec.terrain, spec.G)) {
    if ((spec.river && across(f, onRiver)) || (spec.road && across(f, onRoad))) continue;
    for (const [x, y] of f.fence) if (fieldOk(x, y)) put({ k: f.k, g: `fd${f.id}@${x},${y}`, cells: [[x, y]] });
    if (!f.gate.length) continue;
    const [dx, dy] = f.out, [ax, ay] = [Math.abs(dy), Math.abs(dx)]; // out of the field; along its side
    for (const [x, y] of f.gate) for (let i = -1; i <= 1; i++) for (let d = -FIELD.APRON; d <= FIELD.APRON; d++) if (d) apron.add(`${x + ax * i + dx * d},${y + ay * i + dy * d}`);
    if (f.gate.every(([x, y]) => fieldOk(x, y))) put({ k: "fieldgate", g: `fg${f.id}`, cells: f.gate.map((c) => c.slice()) });
  }
  for (const p of scatterLayer(spec.seed, spec.terrain, spec.G)) {
    if (p.floor) { if (!nearBase(p.x, p.y, spec.clear) && !floors.has(`${p.x},${p.y}`)) floors.set(`${p.x},${p.y}`, p.floor); continue; }
    const yard = nearBase(p.x, p.y, spec.C);
    if (p.k === "wreck") {
      if (yard) continue;
      const cells = [];
      for (let i = 0; i < p.len; i++) for (let j = 0; j < 2; j++) cells.push(p.ax ? [p.x + j, p.y + i] : [p.x + i, p.y + j]);
      if (cells.every(([cx, cy]) => free(cx, cy) && !onRoad(spec, cx, cy) && !street(cx, cy) && !paved.has(`${cx},${cy}`) && !spring.has(`${cx},${cy}`))) put({ k: "wreck", g: p.g, cells, body: p.body, ax: p.ax, len: p.len, looted: !!looted[p.g] });
      continue;
    }
    let k = p.k;
    if (yard !== !!p.yard) { if (yard && k === "tree" && p.stump) k = "stump"; else continue; } // the yard: cleared ground (a tree's stump); outside: no yard leavings
    if (!free(p.x, p.y) || (spec.road && onRoad(spec, p.x, p.y)) || street(p.x, p.y) || paved.has(`${p.x},${p.y}`) || spring.has(`${p.x},${p.y}`) || apron.has(`${p.x},${p.y}`)) continue;
    put({ k, g: p.g, cells: [[p.x, p.y]] });
  }
  // Uneven ground with nothing else on it is a piece of the land too (dug down or filled in before anything is built
  // there: CLEAR rise, dip); under a tree or a bush the height goes with it when it is cleared.
  // A wreck lies on level ground (a vehicle's cells on the one level: combat.js levelRect).
  for (const p of list) if (p.k === "wreck") for (const [x, y] of p.cells) heights.delete(`${x},${y}`);
  relaxHeights(heights, rock);
  dropNarrowHollows(heights);
  // The ground terraformed (terraform.js, the user's request 2026-10-23: hollows dug and hills raised; land.heightEdits,
  // grid "x,y" → the level, 0 levelled): laid over the tile's own once its narrow hollows are filled in (a hollow dug
  // narrow on purpose stays), in the cells' order (the same whatever was dug first), and eased in with it, so a hill
  // raised beside one of the seed's is one hill.
  const edits = (land && land.heightEdits) || null, editKeys = edits ? Object.keys(edits).sort(byCell) : [];
  for (const k of editKeys) { const [x, y] = k.split(",").map(Number), mk = `${x + tx},${y + ty}`, h = edits[k]; if (h) heights.set(mk, h); else heights.delete(mk); }
  if (editKeys.length) relaxHeights(heights, new Set(relief.crags.map(([x, y]) => `${x},${y}`)));
  // The spring's hollow as it lies now (what of it is still a level down): never filled in nor built on (clearOf).
  const springs = new Set([...spring].filter((k) => heights.get(k) < 0));
  // The hills and hollows with nothing on them are pieces of the land too (rise, dip): the ground, never in the way of
  // a building (basemap.js landUnder: one stands on level ground of any height, its ground floor there).
  for (const [k, h] of heights) if (!pieces.has(k)) { const [x, y] = k.split(",").map(Number); put({ k: h > 0 ? "rise" : "dip", g: `h${x},${y}`, cells: [[x, y]], h, ...(springs.has(k) ? { spring: 1 } : {}) }); }
  // Bushes along the river's banks.
  if (spec.river) { const rng = new Rng(spec.seed ^ 0x77e1); for (let a = -spec.G; a < spec.G; a++) for (let b = -spec.G; b < spec.G; b++) { const x = spec.river === "y" ? a : b, y = spec.river === "y" ? b : a; if (onRiver(spec, x, y) === 2 && rng.chance(0.3) && free(x, y)) put({ k: "bush", g: `b${x},${y}`, cells: [[x, y]] }); } }
  // Into the base's grid coordinates (the pieces were made here, so they are moved in place).
  if (tx || ty) {
    for (const p of list) for (const c of p.cells) { c[0] -= tx; c[1] -= ty; }
    pieces.clear();
    for (const p of list) for (const [x, y] of p.cells) pieces.set(`${x},${y}`, p);
    const fl = [...floors];
    floors.clear();
    for (const [k, f] of fl) { const [x, y] = k.split(",").map(Number); floors.set(`${x - tx},${y - ty}`, f); }
    const hs = [...heights];
    heights.clear();
    for (const [k, h] of hs) { const [x, y] = k.split(",").map(Number); heights.set(`${x - tx},${y - ty}`, h); }
    const sp = [...springs];
    springs.clear();
    for (const k of sp) { const [x, y] = k.split(",").map(Number); springs.add(`${x - tx},${y - ty}`); }
  }
  // waterOnly: the land never cleared nor built on, the river and the mountainside (the crag: the game's second pass
  // over the land placed things on it and their clearing never came, basemap.js siteWaits; tools/mapreachtest.js), a
  // pond tile's spring-fed pond. springs: its cells (grid "x,y"; layLand marks them c.spring for ponds.js).
  const water = list.filter((p) => p.k === "water" || p.k === "crag" || p.spring);
  // ground: the ground's height by cell (the same in waterOnly, whose heights are left out for its ponds): what a
  // building stands on (basemap.js placeProblemAt: all of it on one level).
  const v = { pieces, floors, list, heights, springs, level: L, ground: heights, waterOnly: { pieces: new Map(water.flatMap((p) => p.cells.map(([x, y]) => [`${x},${y}`, p]))), list: water, floors, heights: new Map(), ground: heights } };
  landCache.delete(key); // a land read before its last clearing: replaced, and kept as the most recent
  landCache.set(key, { land, n: land ? land.n : null, v });
  while (landCache.size > LAND_CACHE) landCache.delete(landCache.keys().next().value);
  return v;
}
// A piece's name and its clearing (CLEAR).
export const pieceWord = (p) => (p.k === "water" ? "the river" : p.spring ? "the pond" : p.k === "crag" ? "the mountainside" : p.k === "wreck" ? `a wrecked ${p.body === "truck" ? "truck" : "car"}` : (CLEAR[p.k] || { word: p.k }).word);
/** The clearing of a piece: { hours, get, mode } (mode "strip": a wreck not yet stripped, stripped only). @param {any} p @param {boolean} tool @param {string} mode */
export function clearOf(p, tool = true, mode = "clear") {
  if (!p || p.k === "water" || p.spring) return null; // the river and a spring's pond: never cleared
  if (p.k === "wreck") {
    if (mode === "strip") return p.looted ? null : { hours: CLEAR.strip.hours, get: { ...CLEAR.strip.get }, mode };
    return p.looted ? { hours: CLEAR.wreck.hours, get: { ...CLEAR.wreck.get }, mode } : { hours: CLEAR.wreck.hours + CLEAR.strip.hours, get: { scrap: CLEAR.wreck.get.scrap + CLEAR.strip.get.scrap, carparts: CLEAR.strip.get.carparts, metalsheet: CLEAR.strip.get.metalsheet, electronics: CLEAR.strip.get.electronics }, mode };
  }
  const c = CLEAR[p.k];
  if (!c) return null;
  return { hours: c.hours * ((p.k === "tree" || p.k === "log" || p.k === "stump") && !tool ? CLEAR.NO_TOOL : 1) * ((p.k === "rise" || p.k === "dip") && p.h ? Math.abs(p.h) : 1), get: { ...c.get }, mode };
}

// ---------- laying the land on a map ----------
// The land past a map's edge (the user's request 2026-10-23: "The outer margin of the base should not just terminate a
// terrain it should continue the terrain so it does not just terminate at the border"): the cells within R of the
// W × H map (map = grid + ox, oy) and outside it where the land has something to draw (a height, a tree, a bush, a
// hedge, a fence, a rock, a boulder, a stump, a log, a hay bale, the crag; a floor), each [x, y, k, f, h, ch?] in map
// coordinates; inGrid(gx, gy): on the tile's own map (nothing past it). The view draws them running on into the fog
// (ui/isoview.js beyondBoard); scenery only, nothing in the sim stands there.
export const BEYOND_R = 6;
/** @param {any} land @param {number} W @param {number} H @param {number} ox @param {number} oy @param {number} R @param {(gx: number, gy: number) => boolean} inGrid */
export function landBeyond(land, W, H, ox, oy, R, inGrid, lift = 0) { // lift: the map's datum (layLand m.lift): heights as the map's
  const out = [];
  if (!land) return out;
  for (let y = -R; y < H + R; y++) for (let x = -R; x < W + R; x++) {
    if (x === 0 && y >= 0 && y < H) x = W; // the map itself: skip across it
    const gx = x - ox, gy = y - oy;
    if (!inGrid(gx, gy)) continue;
    const key = `${gx},${gy}`, h = ((land.heights && land.heights.get(key)) || 0) - lift, p = land.pieces.get(key), f = land.floors.get(key) || "";
    const field = p && FIELD_FENCE.has(p.k) && typeof p.g === "string" && p.g.startsWith("fd"); // a field's fence: drawn off the edge as fences (ui/isoview.js offEdgeFences)
    const k = p && !field && (SCATTER_KINDS.has(p.k) || p.k === "crag") ? p.k : "open";
    if (!h && k === "open" && !f) continue;
    out.push(k === "crag" ? [x, y, k, f, h, p.h || HIGH.CRAG_LV[0]] : [x, y, k, f, h]);
  }
  return out;
}
/**
 * Lays the land on a map (basemap.js buildBaseMap; fort.js for an AI group's margin). m: { cells, W, H, ox, oy (grid →
 * map), land (landOf), ok(x, y) → the map cell may take a piece (open ground, nothing standing), floor(x, y) → it may
 * take a floor }. Never on the map's outermost cells (the attackers' ground, an open ring round the map, so wherever a
 * battle floods its reach from on the edge it reaches all of it; the heights go there too, a level a step: relief.js
 * cragWays) but for a farmland field's fence (fieldLayer: the
 * user's word 2026-10-23, "Fill in the gap"), run right out to the edge: a fence is climbed over by the living and
 * crawled over by the dead (combat.js vaultable), so the ring is still crossed all the way round. Returns { kinds: { k: n } }.
 * @param {any} m
 */
export function layLand(m) {
  const { cells, W, H, ox, oy, land } = m;
  const inner = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1;
  const onMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const toEdge = (p) => p.cells.length === 1 && FIELD_FENCE.has(p.k) && typeof p.g === "string" && p.g.startsWith("fd"); // a field's fence panel (landOf)
  for (const [key, f] of land.floors) {
    const [gx, gy] = key.split(",").map(Number), x = gx + ox, y = gy + oy;
    if (x >= 0 && y >= 0 && x < W && y < H && (!m.floor || m.floor(x, y))) cells[y * W + x].f = f;
  }
  // The lie of the land under it all (reliefLayer): c.h the cell's height in levels, c.ter: it is the ground's (a hill
  // or a hollow, walked up and down a level at a step: combat.js climbCost). A base on a hill or in a hollow (land.level,
  // the user's request 2026-10-23): its map is laid from its own level (m.lift, the map's datum: combat.js mapLv), so
  // the yard and all that stands in it are level ground and the land round it rises or falls away from it; the plain is
  // laid -lift, the river's water at its level too. The map's outer row too (the user's request 2026-10-23: "The outer
  // margin of the base should not just terminate a terrain it should continue the terrain"): a hill the map's edge cuts
  // runs on to it at its own height (landBeyond carries it on past the edge in the view).
  const lift = m.lift || 0, lays = (x, y) => onMap(x, y) && (!m.floor || m.floor(x, y)) && (!m.ok || m.ok(x, y));
  if (land.heights) for (const [key, h] of land.heights) {
    const [gx, gy] = key.split(",").map(Number), x = gx + ox, y = gy + oy;
    if (lays(x, y)) { const c = cells[y * W + x]; c.h = h - lift; c.ter = 1; if (land.springs && land.springs.has(key)) c.spring = 1; } // c.spring: a pond tile's spring-fed hollow (ponds.js)
  }
  if (lift) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { // the rest of the map: level with the plain
    const key = `${x - ox},${y - oy}`, p = land.pieces.get(key);
    if ((land.heights && land.heights.has(key)) || (p && p.k === "crag") || (m.floor && !m.floor(x, y)) || (m.ok && !m.ok(x, y))) continue;
    const c = cells[y * W + x];
    c.h = -lift; c.ter = 1;
    if (p && p.k === "water") { c.wet = "deep"; c.wl = 0.05 - lift; } // the river's water sheet on the plain's level (ui/isoview.js wetPrims; flat at 0 on a level base's map)
  }
  const kinds = {};
  for (const p of land.list) {
    if (p.k === "rise" || p.k === "dip") { kinds[p.k] = (kinds[p.k] || 0) + 1; continue; } // its height is laid above
    const at = p.cells.map(([gx, gy]) => [gx + ox, gy + oy]);
    if (!at.every(([x, y]) => (inner(x, y) || (toEdge(p) && onMap(x, y))) && m.ok(x, y))) continue;
    if (p.k === "wreck") {
      const kind = p.body === "truck" ? "truck" : "car", x0 = Math.min(...at.map((c) => c[0])), y0 = Math.min(...at.map((c) => c[1]));
      const id = y0 * W + x0 + 1;
      for (const [x, y] of at) { const c = cells[y * W + x]; c.k = kind; c.car = { id, i: p.ax ? y - y0 : x - x0, j: p.ax ? x - x0 : y - y0, L: p.len, ax: p.ax ? "y" : "x", kind, v: (id * 7) % 1000, body: kind }; c.wreck = 1; }
    } else if (p.parts) at.forEach(([x, y], i) => { const c = cells[y * W + x], q = p.parts[i]; c.k = q.k; c.f = q.f; if (q.fl) c.fl = q.fl; if (q.t) c.t = q.t; }); // a building: each cell its own
    else if (p.k === "crag") for (const [x, y] of at) { const c = cells[y * W + x]; c.k = "crag"; c.ch = (p.h || HIGH.CRAG_LV[0]) - lift; } // the rock's height (levels): drawn and seen over by it
    else for (const [x, y] of at) cells[y * W + x].k = p.k;
    kinds[p.k] = (kinds[p.k] || 0) + 1;
  }
  return { kinds };
}
