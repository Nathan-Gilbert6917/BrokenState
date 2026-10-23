// Every way in stays open on the generated maps (the user's words 2026-10-23: "Add tests to cover reachability and
// determinism", then "Blocking base due to ridge": a mountain's crag must never cut a base off). Over many tiles of
// every kind (farmland, a farm's fields, forest, hills, mountains, the suburbs, a city, a road tile, a river tile):
//   1. the tile's land (basescatter.js landOf through basemap.js siteLand): what is never cleared (the crag, the river)
//      shuts no ground off from the map's edges; the ground steps a level at most between neighbours (eight ways);
//      the edge's region on foot holds at least WALK_SHARE of the walkable cells as the land stands (the criterion
//      below); the river has its fords, walked across; the game's own spot (defaultSite) is valid and walked to; a
//      town's and a city's every building has a doorway walked to from a street;
//   2. a base on it (a camp set up on its own spot, the game's or picked beside the rock; an old camp in the middle; an
//      outpost with a grown yard): its camp, clearing and yard walked to from the map's edges (the crag and the river
//      as walls, nothing else: everything else is cleared as needed), its camp walked to as the land stands; the
//      auto layout never puts anything on the rock; its battle map (buildBaseMap's crop) leaves no crag pocket and no
//      step over a level, its middle walked to from the crop's edge;
//   3. the battle maps of a hills or mountain tile: an open fight (relief.js applyRelief with the crag), a raid (no
//      crag), the camp's spot cleared of the dead (layout "siteClear", the spot picked beside the rock too): no crag
//      shuts off ground the edges reach without it, the heights never cut a way the flat map had, every enemy is
//      walked to from your people.
// WALK_SHARE: trees, fences, rocks, wrecks and a house's walls make small pockets of their own (a cell ringed by a
// stand of trees, a back yard fenced all round); clearing opens them, so they are no way in that is lost for good.
// The measured least was 99.1% (2026-10-23, forest), so 98% leaves room for the dice and still fails a land whose
// clutter cuts off more than a fiftieth of the map (1250 cells: a forest grown shut, a town walled in by its fences).
// What is never cleared, the crag and the river, is held to 100% (the massif walled in up to 538 cells on a tile, a
// hundredth of the map, before openCrag: the share alone would not see it).
// Usage: node tools/mapreachtest.js [seed]   (about a minute of one CPU)
import { createWorld } from "../src/sim/world.js";
import { HexGrid } from "../src/sim/hex.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { createBattle, registerCombatHandler, CELL, groundH } from "../src/sim/combat.js";
import { Rng } from "../src/sim/rng.js";
import * as BM from "../src/sim/basemap.js";
import { siteBox, reliefLayer, scatterSeed, SCATTER } from "../src/sim/basescatter.js";
import "../src/sim/siteclear.js"; // the "siteClear" layout

const SEED = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return !!ok; };
const section = (t) => console.log(`\n${t} [${((Date.now() - t0) / 1000).toFixed(1)} s]`);
const t0 = Date.now();
const WALK_SHARE = 0.98;
registerCombatHandler("mrt", () => {});
const G = BM.GRID_MAX, N = 2 * G;

// ---------- grids ----------
const walks = (k) => k !== "roof" && k !== "tower" && !!CELL[k] && !!CELL[k].walk;
// The land over the whole map as arrays (index (y + G) * N + x + G in the land's own coordinates, shifted by o):
// perm (never cleared: crag, water), blk (stops a walk now), crag, h (the ground's height).
function landGrid(land, o = [0, 0]) {
  const perm = new Uint8Array(N * N), blk = new Uint8Array(N * N), crag = new Uint8Array(N * N), h = new Int8Array(N * N);
  const I = (x, y) => { const mx = x + o[0] + G, my = y + o[1] + G; return mx >= 0 && my >= 0 && mx < N && my < N ? my * N + mx : -1; };
  for (const p of land.list) {
    if (p.parts) { p.cells.forEach(([x, y], j) => { const i = I(x, y); if (i >= 0 && !walks(p.parts[j].k)) blk[i] = 1; }); continue; }
    for (const [x, y] of p.cells) {
      const i = I(x, y);
      if (i < 0) continue;
      if (p.k === "crag" || p.k === "water") perm[i] = 1;
      if (p.k === "crag") crag[i] = 1;
      if (!walks(BM.landCellKind(p))) blk[i] = 1;
    }
  }
  for (const [k, v] of land.heights) { const [x, y] = k.split(",").map(Number), i = I(x, y); if (i >= 0) h[i] = v; }
  return { perm, blk, crag, h, I };
}
// A flood fill four ways over a W × H grid: from `seeds` (default: every cell on the edge) over cells not in `stop`;
// with `h`, a step of more than a level is no way.
function flood(W, H, stop, seeds = null, h = null) {
  const seen = new Uint8Array(W * H), q = new Int32Array(W * H);
  let qt = 0;
  const add = (i, from) => { if (seen[i] || stop(i) || (h && from >= 0 && Math.abs(h(i) - h(from)) > 1)) return; seen[i] = 1; q[qt++] = i; };
  if (seeds) for (const i of seeds) add(i, -1);
  else { for (let x = 0; x < W; x++) { add(x, -1); add((H - 1) * W + x, -1); } for (let y = 0; y < H; y++) { add(y * W, -1); add(y * W + W - 1, -1); } }
  for (let qh = 0; qh < qt; qh++) {
    const i = q[qh], x = i % W;
    if (x > 0) add(i - 1, i);
    if (x < W - 1) add(i + 1, i);
    if (i >= W) add(i - W, i);
    if (i < W * H - W) add(i + W, i);
  }
  return seen;
}
const countIf = (n, f) => { let c = 0; for (let i = 0; i < n; i++) if (f(i)) c++; return c; };
// Steps over a level between ground cells (eight ways), crag left out.
function steps(W, H, hOf, skip) {
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, a = hOf(i);
    if (a == null || skip(i)) continue;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= W || ny < 0 || ny >= H) continue;
      const j = ny * W + nx, b = hOf(j);
      if (b != null && !skip(j) && Math.abs(a - b) > 1) n++;
    }
  }
  return n;
}

// ---------- 1. the tile's land ----------
section("1. The tile's land: never shut in by the rock or the river, a level a step, fords, the game's spot, front doors");
const hexes = new HexGrid(40, 40);
// A tile on a world of its own: its terrain, a road through it (two links), a river beside it.
function tileWorld(id, terrain, { road = false, river = false, loc = null } = {}) {
  const tiles = {};
  for (let i = 0; i < hexes.size; i++) tiles[i] = { id: i, terrain: "plains" };
  Object.assign(tiles[id], { terrain }, loc ? { loc } : {});
  const nb = hexes.neighbors(id);
  if (road) Object.assign(tiles[id], { road: true, roadLinks: [nb[0], nb[3]] });
  if (river) tiles[nb[1]].river = true;
  return { tiles, grid: hexes, bases: [], survivors: [], parties: [] };
}
const KINDS = [
  ["farmland", "plains", {}], ["a farm's fields", "plains", { loc: { type: "farm" } }], ["forest", "forest", {}], ["hills", "hills", {}],
  ["mountains", "mountain", {}], ["the suburbs", "suburb", {}], ["a city", "city", {}], ["a road through mountains", "mountain", { road: true }],
  ["a river by mountains", "mountain", { river: true }], ["a river and a road in the hills", "hills", { river: true, road: true }], ["a road through forest", "forest", { road: true }],
];
const PER = 4; // tiles of each kind
for (const [name, terrain, o] of KINDS) {
  const bad = { perm: [], steps: [], share: [], site: [], doors: [], fords: [] };
  let least = 1, doors = 0, crag = 0;
  for (let s = 0; s < PER; s++) {
    const id = 41 + ((SEED + s * 37 + KINDS.findIndex((k) => k[0] === name) * 11) % 1500), st = tileWorld(id, terrain, o);
    const land = BM.siteLand(st, id), L = landGrid(land);
    crag += L.crag.reduce((a, v) => a + v, 0);
    // What is never cleared shuts nothing off.
    const fp = flood(N, N, (i) => L.perm[i]);
    const lost = countIf(N * N, (i) => !L.perm[i] && !fp[i]);
    if (lost) bad.perm.push(`${id}: ${lost}`);
    const st8 = steps(N, N, (i) => L.h[i], (i) => L.crag[i]);
    if (st8) bad.steps.push(`${id}: ${st8}`);
    // The land as it stands, on foot (a level a step).
    const fw = flood(N, N, (i) => L.blk[i], null, (i) => L.h[i]);
    const walk = countIf(N * N, (i) => !L.blk[i]), got = countIf(N * N, (i) => !L.blk[i] && fw[i]);
    least = Math.min(least, got / walk);
    if (got / walk < WALK_SHARE) bad.share.push(`${id}: ${(got / walk * 100).toFixed(2)}%`);
    // The game's own spot: valid, walked to from the edge once its 5 × 5 is cleared.
    const d = BM.defaultSite(st, id), B = siteBox(d);
    const open = (i) => { const x = (i % N) - G, y = Math.floor(i / N) - G; return x >= B.x0 && y >= B.y0 && x < B.x1 && y < B.y1; };
    const fs = flood(N, N, (i) => L.blk[i] && !open(i), null, (i) => (open(i) ? 0 : L.h[i]));
    if (BM.siteProblem(st, id, d) || !fp[L.I(d[0], d[1])] || !fs[L.I(d[0], d[1])]) bad.site.push(`${id} at ${d}: ${BM.siteProblem(st, id, d) || "not walked to"}`);
    // Every building's door walked to from a street.
    const streets = [];
    for (const [k, f] of land.floors) if (f === "road") { const [x, y] = k.split(",").map(Number), i = L.I(x, y); if (i >= 0 && !L.blk[i]) streets.push(i); }
    if (streets.length && land.list.some((p) => p.parts)) {
      const fr = flood(N, N, (i) => L.blk[i], streets, (i) => L.h[i]);
      for (const p of land.list) if (p.parts) { doors++; if (!p.cells.some(([x, y], j) => p.parts[j].k === "doorway" && fr[L.I(x, y)])) bad.doors.push(`${id} ${p.k} ${p.g}`); }
    }
    // The river's fords: two crossings, each a band of ground with no water, no rock and nothing in the way.
    if (o.river) {
      const water = land.list.filter((p) => p.k === "water");
      const xs = new Set(water.map((p) => p.cells[0][0])), alongY = xs.size <= SCATTER.RIVER_W; // a band of columns: it runs north to south, crossed along a row
      const across = new Map(); // a line across the river → its ford cells
      for (const [k, f] of land.floors) if (f === "gravel") { const [x, y] = k.split(",").map(Number), line = alongY ? y : x; (across.get(line) || across.set(line, []).get(line)).push(L.I(x, y)); }
      const ok = [...across.values()].filter((c) => c.length >= SCATTER.RIVER_W && c.every((i) => !L.blk[i])).length;
      if (water.length < 100 || ok < 6) bad.fords.push(`${id}: ${water.length} water, ${ok} lines across clear`);
    }
  }
  console.log(`  ${name}: ${PER} tiles${crag ? `, ${crag} cells of crag` : ""}, the least walked share ${(least * 100).toFixed(2)}%${doors ? `, ${doors} buildings` : ""}`);
  check(!bad.perm.length, `${name}: the rock and the river shut no ground off from the map's edge${bad.perm.length ? ` (${bad.perm.join("; ")})` : ""}`);
  check(!bad.steps.length, `${name}: never more than a level between neighbours${bad.steps.length ? ` (${bad.steps.join("; ")})` : ""}`);
  check(!bad.share.length, `${name}: at least ${WALK_SHARE * 100}% of the walkable ground is walked to from the edge as the land stands${bad.share.length ? ` (${bad.share.join("; ")})` : ""}`);
  check(!bad.site.length, `${name}: the game's own spot takes the camp and is walked to from the edge${bad.site.length ? ` (${bad.site.join("; ")})` : ""}`);
  if (doors) check(!bad.doors.length, `${name}: every building's door is walked to from a street (${doors - bad.doors.length} of ${doors}${bad.doors.length ? `: ${bad.doors.slice(0, 4).join("; ")}` : ""})`);
  if (o.river) check(!bad.fords.length, `${name}: the river has its fords, walked across${bad.fords.length ? ` (${bad.fords.join("; ")})` : ""}`);
}
// Many more mountains, the rock alone (the massif and its arms): never a pocket of ground it walls in.
{
  const n = 30, bad = [];
  for (let s = 0; s < n; s++) {
    const id = 2000 + SEED * 7 + s * 13, R = reliefLayer(scatterSeed(id), "mountain", G), rock = new Uint8Array(N * N);
    for (const [x, y] of R.crags) rock[(y + G) * N + x + G] = 1;
    const f = flood(N, N, (i) => rock[i]), lost = countIf(N * N, (i) => !rock[i] && !f[i]);
    if (lost) bad.push(`tile ${id}: ${lost}`);
  }
  check(!bad.length, `${n} more mountain tiles: the massif walls in no ground${bad.length ? ` (${bad.join("; ")})` : ""}`);
}

// ---------- 2. bases on the land ----------
section("2. A base on the land: its camp, clearing and yard walked to; nothing laid on the rock; its battle map open");
const st = createWorld({ seed: SEED, factionCount: 7, mode: "hardcore" });
st.noWanderers = true;
const free = Object.values(st.tiles).filter((t) => t.terrain !== "water" && !t.hive && !st.bases.some((b) => b.tile === t.id) && t.owner == null);
const pickTiles = (f, n) => free.filter(f).slice(0, n);
const mountains = pickTiles((t) => t.terrain === "mountain", 40);
const near = (t) => st.grid.neighbors(t.id).some((n) => st.tiles[n].river);
// A camp: set up on its own spot (fresh: its 5 × 5 cleared), or an old one in the middle with its swept yard.
function camp(tile, origin, { fresh = true, type = "outpost", camp: isCampBase = true, buildings = [] } = {}) {
  const b = { id: 9000 + st.bases.length, tile, type, name: "Reach Camp", stock: { water: 0, fuel: 0, meds: 0, ammo: 0, arrows: 0, parts: 0, scrap: 0, jars: 0, wood: 0, buildmat: 0, metalsheet: 0, rawwater: 0 }, radio: false, watchtower: false, buildings, construction: [], armory: [], tier: 0, camp: isCampBase, fire: true, tentsSet: true, plan: fresh ? { plots: [], origin, fresh: true } : { plots: [] }, land: { v: 2, n: 1, cleared: {}, looted: {} } };
  st.bases.push(b);
  if (fresh) BM.clearCampSite(st, b);
  return b;
}
// The base's land over the map (grid coordinates shifted by its origin): the camp's 5 × 5, the clearing and the yard
// walked to with the rock and the river as walls; the camp walked to as the land stands.
function baseReach(b) {
  const land = BM.landFor(st, b), o = BM.originOf(b), L = landGrid(land, o), C = BM.yardHalf(b);
  const fp = flood(N, N, (i) => L.perm[i]), fw = flood(N, N, (i) => L.blk[i], null, (i) => L.h[i]);
  let cut = 0, cells = 0;
  for (let y = -C; y < C; y++) for (let x = -C; x < C; x++) { const i = L.I(x, y); if (i < 0 || L.perm[i]) continue; cells++; if (!fp[i]) cut++; }
  const B = siteBox();
  let campCut = 0;
  for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) { const i = L.I(x, y); if (L.perm[i] || !fp[i]) campCut++; }
  return { cut, cells, campCut, walked: !!fw[L.I(0, 0)], land };
}
// Its battle map (a raid's, not the view): no crag pocket, no step over a level, the middle walked to from the edge.
function mapReach(b) {
  const F = BM.buildBaseMap(st, b, new Rng(7)), W = F.W, H = F.H, c = F.cells;
  const fa = flood(W, H, (i) => !walks(c[i].k) && c[i].k !== "crag"), fc = flood(W, H, (i) => !walks(c[i].k));
  const pocket = countIf(W * H, (i) => walks(c[i].k) && fa[i] && !fc[i]);
  const gh = (i) => (c[i].k === "crag" ? null : groundH(c[i]));
  const fh = flood(W, H, (i) => !walks(c[i].k), null, (i) => gh(i) ?? 0);
  const cut = countIf(W * H, (i) => fc[i] && !fh[i]);
  const st8 = steps(W, H, gh, (i) => !walks(c[i].k));
  const mid = F.oy * W + F.ox, round = [mid, mid + 1, mid - 1, mid + W, mid - W, mid + W + 1, mid - W - 1];
  return { pocket, cut, steps: st8, mid: round.some((i) => fh[i]), crag: countIf(W * H, (i) => c[i].k === "crag"), W, H, passes: F.passes || 0 };
}
{
  const bad = [], badMap = [], onRock = [];
  let n = 0, cragOn = 0, carved = 0;
  // Spots beside the rock: valid (siteProblem ""), the camp's 5 × 5 within a few cells of the crag.
  const besideRock = (t, k) => {
    const land = BM.siteLand(st, t.id), out = [];
    for (const p of land.list) {
      if (p.k !== "crag" || out.length >= k) continue;
      const [x, y] = p.cells[0], at = [x + 4, y + 3];
      if ((x * 7 + y * 3) % 5 || BM.siteProblem(st, t.id, at)) continue;
      if (!out.some((q) => Math.abs(q[0] - at[0]) + Math.abs(q[1] - at[1]) < 30)) out.push(at);
    }
    return out;
  };
  const cases = [];
  for (const t of mountains.slice(0, 7)) { cases.push([t, BM.defaultSite(st, t.id), {}]); for (const at of besideRock(t, 2)) cases.push([t, at, {}]); }
  for (const t of mountains.slice(10, 13)) cases.push([t, [0, 0], { fresh: false }]); // an old camp in the middle: its yard swept
  for (const t of mountains.slice(13, 15)) cases.push([t, [0, 0], { fresh: false, type: "hub", camp: false, buildings: Array.from({ length: 24 }, (_, i) => ({ id: 70000 + i, type: i % 2 ? "bunkhouse" : "common_room" })) }]); // a grown main base: its yard 70 cells and more round
  for (const t of pickTiles((t) => t.terrain === "hills", 3)) cases.push([t, BM.defaultSite(st, t.id), {}]);
  for (const t of pickTiles((t) => t.terrain === "mountain" && near(t), 2)) cases.push([t, BM.defaultSite(st, t.id), {}]);
  for (const t of pickTiles((t) => t.terrain === "mountain" && t.road, 2)) cases.push([t, BM.defaultSite(st, t.id), {}]);
  for (const [t, at, o] of cases) {
    const b = camp(t.id, at, o);
    const r = baseReach(b);
    n++;
    if (r.cut || r.campCut || !r.walked) bad.push(`${t.terrain} ${t.id} at ${at}${o.fresh === false ? ` (${b.type}, yard ${BM.yardHalf(b)})` : ""}: ${r.cut} of ${r.cells} yard cells cut off, camp ${r.campCut ? "cut off" : r.walked ? "ok" : "not walked to"}`);
    // The auto layout: a few tents and buildings put down by the game, never on the rock.
    for (let i = 0; i < 3; i++) b.construction.push({ id: 80000 + n * 10 + i, type: ["common_room", "storehouse", "bunkhouse"][i], hours: 10, progress: 0 });
    const auto = BM.autoLayout(st, b);
    for (const it of BM.itemsOf(st, b)) {
      const a = it.at || auto.get(it.key);
      if (a && BM.landUnder(r.land, it, a).some((p) => p.k === "crag")) onRock.push(`${t.id} ${it.label} at ${a}`);
    }
    const m = mapReach(b);
    cragOn += m.crag; carved += m.passes;
    if (m.pocket || m.cut || m.steps || !m.mid) badMap.push(`${t.terrain} ${t.id} at ${at}: ${m.W}×${m.H}, ${m.pocket} cells shut in by the rock, ${m.cut} cut by a step, ${m.steps} steps, the middle ${m.mid ? "walked to" : "shut off"}`);
    st.bases.splice(st.bases.indexOf(b), 1);
  }
  check(!bad.length, `${n} bases (the game's spot and spots beside the rock on mountains, old camps and a grown main base in the middle, hills, a river, a road): the camp, the clearing and the yard walked to from the map's edge${bad.length ? `: ${bad.join("; ")}` : ""}`);
  check(!onRock.length, `the game lays nothing on the rock (its second pass over the land never takes the mountainside: it is never cleared)${onRock.length ? `: ${onRock.slice(0, 4).join("; ")}` : ""}`);
  check(!badMap.length, `their battle maps (${cragOn} cells of crag in the crops, ${carved} carved for a pass): no ground shut in by the rock, no step over a level, the middle walked to from the edge${badMap.length ? `: ${badMap.join("; ")}` : ""}`);
  check(/mountainside/.test(BM.landWhy([{ k: "crag", g: "c", cells: [[0, 0]] }, { k: "tree", g: "t", cells: [[1, 0]] }])) && !BM.landWhy([{ k: "crag", g: "c", cells: [[0, 0]] }]).startsWith(BM.LAND_WHY), `on the rock: "${BM.landWhy([{ k: "crag", g: "c", cells: [[0, 0]] }])}" (never a clearing offered)`);
}

// ---------- 3. battle maps ----------
section("3. Fights on a hills or mountain tile: no ground shut in by the rock, no way cut by a step, every enemy walked to");
const party = roadTeam(st);
function inBrowser(f) { globalThis.window = {}; try { return f(); } finally { delete globalThis.window; } }
// b's map: cells the edges reach with the crag taken off but not with it (shut in); cells reached flat but not a level
// a step (cut by the heights); enemies not walked to from your people.
function fightReach(b) {
  const W = b.w, H = b.h, c = b.cells;
  const climb = (i) => !!CELL[c[i].k].climb;
  const hOf = (i) => c[i].h ?? CELL[c[i].k].h ?? 0;
  const fa = flood(W, H, (i) => !walks(c[i].k) && c[i].k !== "crag"), fc = flood(W, H, (i) => !walks(c[i].k));
  const shut = countIf(W * H, (i) => walks(c[i].k) && fa[i] && !fc[i]);
  // a level a step over the ground (a ladder or stairs climb anything: combat.js climbCost)
  const fh = flood(W, H, (i) => !walks(c[i].k), null, (i) => (climb(i) ? NaN : hOf(i)));
  const cut = countIf(W * H, (i) => fc[i] && !fh[i] && groundH(c[i]) != null && c[i].ter);
  const us = b.units.filter((u) => u.side !== "enemy"), them = b.units.filter((u) => u.side === "enemy");
  const fu = flood(W, H, (i) => !walks(c[i].k), us.map((u) => u.y * W + u.x), (i) => (climb(i) ? NaN : hOf(i)));
  const lost = them.filter((u) => !fu[u.y * W + u.x] && fc[u.y * W + u.x]).length; // one the flat map reaches but the heights cut off
  return { shut, cut, lost, n: them.length, crag: countIf(W * H, (i) => c[i].k === "crag"), ter: countIf(W * H, (i) => !!c[i].ter) };
}
{
  const tiles = [...mountains.slice(0, 14), ...pickTiles((t) => t.terrain === "hills", 6)];
  const res = { open: [], raid: [], site: [] }, sum = { open: [0, 0], raid: [0, 0], site: [0, 0] };
  for (const t of tiles) {
    st.rng.state = 1000 + t.id;
    const open = inBrowser(() => createBattle(st, { tile: t.id, partyId: party.id, enemy: { kind: "zombies", count: 6, power: 2 }, ambush: null, canRetreat: true, handler: "mrt", context: {} }));
    const raid = inBrowser(() => createBattle(st, { mode: "raid", tile: t.id, partyId: party.id, canRetreat: true, ambush: null, handler: "mrt", enemy: { kind: "zombies", count: 4, power: 3 }, raid: { heat0: 0 }, context: {} }));
    const spots = [BM.defaultSite(st, t.id)];
    if (t.terrain === "mountain") { // a spot picked beside the rock: the fight's map takes in the massif round it
      const land = BM.siteLand(st, t.id), rock = land.list.filter((p) => p.k === "crag");
      for (let k = 0; k < rock.length && spots.length < 3; k += 97) { const [x, y] = rock[k].cells[0]; for (const at of [[x - 5, y], [x + 5, y], [x, y + 5]]) if (spots.length < 3 && !BM.siteProblem(st, t.id, at)) { spots.push(at); break; } }
    }
    const sites = spots.map((at) => inBrowser(() => createBattle(st, { tile: t.id, partyId: party.id, enemy: { kind: "zombies", count: 8, power: 2 }, ambush: null, canRetreat: true, handler: "mrt", layout: "siteClear", context: { partyId: party.id, tile: t.id, at } })));
    for (const [k, b] of [["open", open], ["raid", raid], ...sites.map((b) => ["site", b])]) {
      const r = fightReach(b);
      sum[k][0] += r.crag; sum[k][1] += r.ter;
      if (r.shut || r.cut || r.lost) res[k].push(`${t.terrain} ${t.id}: ${r.shut} shut in by the rock, ${r.cut} cut by a step, ${r.lost} of ${r.n} enemies not walked to`);
      if (k === "site") { const [sx, sy] = b.siteSpot, f = flood(b.w, b.h, (i) => !walks(b.cells[i].k)); if (!f[sy * b.w + sx] && !f[sy * b.w + sx + 1] && !f[(sy + 1) * b.w + sx]) res.site.push(`${t.id}: the spot not walked to from the edge`); }
    }
  }
  st.combat = null;
  check(!res.open.length, `${tiles.length} open fights (${sum.open[0]} cells of crag, ${sum.open[1]} of hills and hollows): the edges reach all they reached without the rock, every enemy walked to${res.open.length ? `: ${res.open.join("; ")}` : ""}`);
  check(!res.raid.length, `${tiles.length} raids (${sum.raid[1]} cells of hills and hollows, no crag: ${sum.raid[0]}): no way cut by the heights, every enemy walked to${res.raid.length ? `: ${res.raid.join("; ")}` : ""}`);
  check(!res.site.length, `the camp's spot cleared of the dead, at the game's spot and beside the rock (${sum.site[0]} cells of crag): the spot and every one of the dead walked to from your people${res.site.length ? `: ${res.site.join("; ")}` : ""}`);
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
