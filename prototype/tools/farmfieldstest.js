// Farmland's fenced fields (the user's request 2026-10-23: "Fix fences for farmland tiles to not be random singular
// fences make them square, go off screen and have a gate to enter the inside of the fenced area"; basescatter.js
// fieldLayer, landOf). Over many farmland and farm tiles (a road through some, a river beside some):
//   1. the layer: each field a square S cells a side whose fence is its edge (the map's own cells only), a gate of
//      GATE cells in the side facing the map's middle, never at a corner; the fields keep GAP apart; some run off the
//      map's edge; none off farmland; the same twice;
//   2. the land: every fence of farmland is a field's (no loose runs), the gates laid as CELL fieldgate (walked
//      through), their aprons clear of anything, and inside each field with its gate laid is walked to from the map's
//      edges through it (the fence as walls, nothing cleared); no field where the river runs;
//   3. wood and wire (the user's word 2026-10-23: "Add wire fences and wood fences"): both kinds of field, each laid
//      in its own kind; a wire fence no cover, seen through, climbed over by the living and crawled over by the dead,
//      torn down for wood (its post) and scrap (its wire);
//   4. off the map (the user's word 2026-10-23: "Show it going off the map and not just terminating"): ui/isoview.js
//      offEdgeFences runs a fence line meeting the map's edge on across the skirt, straight out, in its own kind, and
//      nothing else (a line along the edge, a lone panel, a battle with no skirt);
//   5. no gap at the edge and over the fences (the user's words 2026-10-23: "Fill in the gap and allow vaulting over
//      fences"): on a farm hub's base map a field's fence runs right out to the map's edge cell (nothing else of the land
//      does) and on into the skirt from there; in a fight a survivor vaults a wooden and a wire fence line, the dead
//      crawl over them, and nobody ends a move on one.
// Usage: node tools/farmfieldstest.js [seed]
import "./isobattles.js"; // the UI modules' stubs, before ui/isoview.js
import { HexGrid } from "../src/sim/hex.js";
import { CELL, vaultable, createBattle, registerCombatHandler, reachable, pathTo, VAULT } from "../src/sim/combat.js";
import { crawlable, CRAWL } from "../src/sim/barricade.js";
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { Rng } from "../src/sim/rng.js";
import * as BM from "../src/sim/basemap.js";
import { FIELD, fieldLayer, scatterSeed, CLEAR, SCATTER_KINDS } from "../src/sim/basescatter.js";

const SEED = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return !!ok; };
const G = BM.GRID_MAX, N = 2 * G;
const hexes = new HexGrid(40, 40);
function tileWorld(id, { farm = false, road = false, river = false } = {}) {
  const tiles = {};
  for (let i = 0; i < hexes.size; i++) tiles[i] = { id: i, terrain: "plains" };
  if (farm) tiles[id].loc = { type: "farm" };
  const nb = hexes.neighbors(id);
  if (road) Object.assign(tiles[id], { road: true, roadLinks: [nb[0], nb[3]] });
  if (river) tiles[nb[1]].river = true;
  return { tiles, grid: hexes, bases: [], survivors: [], parties: [] };
}
const ids = (s) => Array.from({ length: 8 }, (_, i) => 41 + ((SEED * 97 + i * 53 + s) % 1500));

// ---------- 1. the layer ----------
console.log("1. The layer: squares with a gate facing the middle, apart, some off the map's edge");
{
  let n = 0, off = 0, gated = 0;
  const bad = { square: [], gate: [], apart: [], det: [] };
  for (const terrain of ["farm", "plains"]) for (const id of ids(terrain.length)) {
    const seed = scatterSeed(id), L = fieldLayer(seed, terrain, G);
    if (JSON.stringify(L) !== JSON.stringify(fieldLayer(seed, terrain, G))) bad.det.push(id);
    for (const f of L) {
      n++;
      const x1 = f.x0 + f.s - 1, y1 = f.y0 + f.s - 1, edge = (x, y) => (x === f.x0 || x === x1) ? y >= f.y0 && y <= y1 : (y === f.y0 || y === y1) && x >= f.x0 && x <= x1;
      const on = (x, y) => x >= -G && y >= -G && x < G && y < G;
      if (f.x0 < -G || f.y0 < -G || x1 >= G || y1 >= G) off++;
      const want = new Set();
      for (let y = f.y0; y <= y1; y++) for (let x = f.x0; x <= x1; x++) if (edge(x, y) && on(x, y)) want.add(`${x},${y}`);
      const got = new Set([...f.fence, ...f.gate].map(([x, y]) => `${x},${y}`));
      if (f.s < FIELD.S[0] || f.s > FIELD.S[1] || got.size !== want.size || [...want].some((k) => !got.has(k)) || f.fence.length + f.gate.length !== got.size) bad.square.push(`${id} ${f.id}`);
      if (!f.gate.length) continue;
      gated++;
      // The gate: GATE cells in a row on one side, on the map's inner cells, two or more from a corner, facing the middle.
      const [dx, dy] = f.out, cx = f.x0 + f.s / 2, cy = f.y0 + f.s / 2;
      const sideOk = f.gate.length === FIELD.GATE && f.gate.every(([x, y]) => edge(x, y) && x > -G && y > -G && x < G - 1 && y < G - 1 && (dx ? x === (dx < 0 ? f.x0 : x1) && y >= f.y0 + 2 && y <= y1 - 2 : y === (dy < 0 ? f.y0 : y1) && x >= f.x0 + 2 && x <= x1 - 2));
      const faces = dx ? Math.sign(-cx) === dx || Math.abs(cx) < 1 : Math.sign(-cy) === dy || Math.abs(cy) < 1;
      if (!sideOk || !faces) bad.gate.push(`${id} ${f.id}`);
    }
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j], gx = Math.max(a.x0, b.x0) - Math.min(a.x0 + a.s, b.x0 + b.s), gy = Math.max(a.y0, b.y0) - Math.min(a.y0 + a.s, b.y0 + b.s);
      if (Math.max(gx, gy) < 2 * FIELD.GAP) bad.apart.push(`${id} ${a.id}/${b.id}`);
    }
  }
  check(n > 60, `fields laid: ${n} over 16 farmland and farm tiles`);
  check(!bad.square.length, `each a square ${FIELD.S[0]}–${FIELD.S[1]} a side, its fence the edge on the map${bad.square.length ? `: ${bad.square.slice(0, 5).join("; ")}` : ""}`);
  check(gated >= n * 0.9 && !bad.gate.length, `a gate in the side facing the middle, off the corners (${gated} of ${n})${bad.gate.length ? `: ${bad.gate.slice(0, 5).join("; ")}` : ""}`);
  check(!bad.apart.length, `${2 * FIELD.GAP} cells or more between fields${bad.apart.length ? `: ${bad.apart.slice(0, 5).join("; ")}` : ""}`);
  check(off > 4, `fields running off the map's edge: ${off}`);
  check(!bad.det.length, `the same twice${bad.det.length ? `: ${bad.det.join(", ")}` : ""}`);
  check(["forest", "hills", "mountain", "suburb", "city"].every((t) => !fieldLayer(scatterSeed(99), t, G).length), "no fields off farmland");
  check(CELL.fieldgate && CELL.fieldgate.walk && SCATTER_KINDS.has("fieldgate") && CLEAR.fieldgate && CLEAR.fieldgate.get.wood > 0, "a field gate: walked through, cleared for its wood");
}

// ---------- 2. the land ----------
console.log("\n2. The land: fences are the fields', gates laid with clear aprons, every field walked into");
{
  const walks = (p) => !!CELL[BM.landCellKind(p)] && CELL[BM.landCellKind(p)].walk;
  const bad = { loose: [], apron: [], inside: [], river: [], kind: [] };
  let gates = 0, fields = 0, wet = 0;
  const kinds = [["farm", { farm: true }], ["farm with a road", { farm: true, road: true }], ["farmland", {}], ["farmland with a river", { river: true }], ["farm with a river and a road", { farm: true, river: true, road: true }]];
  for (const [name, o] of kinds) for (const id of ids(name.length).slice(0, 4)) {
    const st = tileWorld(id, o), land = BM.siteLand(st, id), terrain = BM.terrainOf(st, { tile: id });
    const loose = land.list.filter((p) => (p.k === "fence" || p.k === "wirefence") && !p.g.startsWith("fd"));
    if (loose.length) bad.loose.push(`${name} ${id}: ${loose.length}`);
    // Walked from the map's edges with the land as it stands (nothing cleared).
    const blk = new Uint8Array(N * N), I = (x, y) => (y + G) * N + x + G;
    for (const p of land.list) if (!walks(p)) for (const [x, y] of p.cells) blk[I(x, y)] = 1;
    const seen = new Uint8Array(N * N), q = [];
    for (let a = 0; a < N; a++) for (const i of [a, (N - 1) * N + a, a * N, a * N + N - 1]) if (!blk[i] && !seen[i]) { seen[i] = 1; q.push(i); }
    while (q.length) { const i = q.pop(), x = i % N, y = (i / N) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, j = ny * N + nx; if (nx >= 0 && ny >= 0 && nx < N && ny < N && !blk[j] && !seen[j]) { seen[j] = 1; q.push(j); } } }
    const riverCells = land.list.filter((p) => p.k === "water").flatMap((p) => p.cells);
    for (const f of fieldLayer(scatterSeed(id), terrain, G)) {
      const laid = land.pieces.get(f.gate.length ? `${f.gate[0][0]},${f.gate[0][1]}` : "");
      const fenced = f.fence.some(([x, y]) => (land.pieces.get(`${x},${y}`) || {}).g === `fd${f.id}@${x},${y}`);
      if (f.fence.some(([x, y]) => { const p = land.pieces.get(`${x},${y}`); return p && p.g === `fd${f.id}@${x},${y}` && p.k !== f.k; })) bad.kind.push(`${id} ${f.id}`);
      if (riverCells.some(([x, y]) => x >= f.x0 - 1 && y >= f.y0 - 1 && x <= f.x0 + f.s && y <= f.y0 + f.s)) { wet++; if (fenced) bad.river.push(`${id} ${f.id}`); continue; }
      if (!fenced) continue;
      fields++;
      if (!laid || laid.k !== "fieldgate") continue;
      gates++;
      // The apron: nothing standing APRON cells out and in from the gate.
      const [dx, dy] = f.out;
      for (const [x, y] of f.gate) for (let d = -FIELD.APRON; d <= FIELD.APRON; d++) if (d) { const p = land.pieces.get(`${x + dx * d},${y + dy * d}`); if (p && !walks(p)) bad.apron.push(`${id} ${f.id} (${p.k})`); }
      // Inside: the cell just in from the gate is walked to, and most of the field's open ground.
      const [gx, gy] = f.gate[0];
      let open = 0, got = 0;
      for (let y = f.y0 + 1; y < f.y0 + f.s - 1; y++) for (let x = f.x0 + 1; x < f.x0 + f.s - 1; x++) { if (x < -G || y < -G || x >= G || y >= G) continue; const i = I(x, y); if (!blk[i]) { open++; if (seen[i]) got++; } }
      if (!seen[I(gx - dx, gy - dy)] || got < open * 0.97) bad.inside.push(`${name} ${id} ${f.id}: ${got}/${open}`);
    }
  }
  check(fields > 30 && gates >= fields * 0.85, `fields on the land: ${fields}, ${gates} with their gate laid${wet ? ` (${wet} left off for the river)` : ""}`);
  check(!bad.loose.length, `no loose fence runs on farmland${bad.loose.length ? `: ${bad.loose.join("; ")}` : ""}`);
  check(!bad.river.length, `no field where the river runs${bad.river.length ? `: ${bad.river.join("; ")}` : ""}`);
  check(!bad.apron.length, `the gates' aprons clear${bad.apron.length ? `: ${bad.apron.slice(0, 6).join("; ")}` : ""}`);
  check(!bad.inside.length, `inside every gated field walked to through its gate${bad.inside.length ? `: ${bad.inside.slice(0, 6).join("; ")}` : ""}`);
  check(!bad.kind.length, `each field's fence laid in its own kind${bad.kind.length ? `: ${bad.kind.slice(0, 6).join("; ")}` : ""}`);
}

// ---------- 3. wood and wire ----------
console.log("\n3. Wood and wire fences");
{
  const n = { fence: 0, wirefence: 0 };
  for (const terrain of ["farm", "plains"]) for (const id of ids(terrain.length)) for (const f of fieldLayer(scatterSeed(id), terrain, G)) n[f.k]++;
  check(n.fence > 20 && n.wirefence > 20, `both kinds of field: ${n.fence} wooden, ${n.wirefence} wire`);
  const W = CELL.wirefence, b = { cells: [] };
  check(W && !W.walk && W.cover === 0 && !W.los, "a wire fence: no way through, no cover, seen through");
  check(vaultable(b, { k: "wirefence" }) && crawlable(b, { k: "wirefence" }) && vaultable(b, { k: "fence" }), "climbed over by the living, crawled over by the dead (as a wooden fence)");
  check(CLEAR.wirefence && CLEAR.wirefence.get.wood > 0 && CLEAR.wirefence.get.scrap > 0 && SCATTER_KINDS.has("wirefence"), `torn down for ${CLEAR.wirefence.get.wood} wood and ${CLEAR.wirefence.get.scrap} scrap (a wooden panel ${CLEAR.fence.get.wood} wood, the gate ${CLEAR.fieldgate.get.wood})`);
}

// ---------- 4. off the map ----------
console.log("\n4. Fence lines run on past the map's edge");
{
  const ISO = await import("../src/ui/isoview.js");
  const map = (w, h, put) => { const cells = Array.from({ length: w * h }, () => ({ k: "open", f: "grass" })); for (const [x, y, k] of put) cells[y * w + x].k = k; return { w, h, cells }; };
  // A wooden line down to the top edge at x 5, a wire one to the right edge at y 7, a line along the bottom edge, a lone panel by the left edge.
  const put = [];
  for (let y = 0; y < 10; y++) put.push([5, y, "fence"]);
  for (let x = 8; x < 20; x++) put.push([x, 7, "wirefence"]);
  for (let x = 3; x < 15; x++) put.push([x, 19, "fence"]);
  put.push([0, 12, "fence"]);
  const b = map(20, 20, put), K = 5, got = ISO.offEdgeFences(b, K);
  const top = got.filter((q) => q.x === 5 && q.y < 0), right = got.filter((q) => q.y === 7 && q.x >= 20);
  check(top.length === K && top.every((q) => q.k === "fence" && q.dy === -1 && q.y === -q.t), `a wooden line meeting the top edge runs on ${top.length} tiles up into the skirt`);
  check(right.length === K && right.every((q) => q.k === "wirefence" && q.dx === 1 && q.x === 19 + q.t), `a wire line meeting the right edge runs on ${right.length} tiles out, wire`);
  check(got.length === 2 * K, `nothing else runs off (a line along the edge, a lone panel): ${got.length} tiles in all`);
  check(got.every((q) => q.x < 0 || q.y < 0 || q.x >= b.w || q.y >= b.h), "every one of them off the map (scenery: the skirt's)");
  check(!ISO.offEdgeFences(b, 0).length, "no skirt (Display: Battle map edge off), none");
}

// ---------- 5. no gap at the edge; over the fences ----------
console.log("\n5. No gap at the map's edge; vaulted and crawled over");
{
  const ISO = await import("../src/ui/isoview.js");
  registerCombatHandler("ffields", () => {});
  let edgeFence = 0, edgeOther = 0, runs = 0, maps = 0;
  for (const seed of [41, 44, 47]) {
    const st = createWorld({ seed, factionCount: 6 }), h = hub(st), t = st.tiles[h.tile];
    Object.assign(t, { terrain: "plains", road: false, pond: false, loc: { ...(t.loc || {}), type: "farm" } });
    const F = BM.buildBaseMap(st, h, new Rng(1), { view: true });
    maps++;
    for (let y = 0; y < F.H; y++) for (let x = 0; x < F.W; x++) {
      if (x && y && x < F.W - 1 && y < F.H - 1) continue;
      const k = F.cells[y * F.W + x].k;
      if (k === "fence" || k === "wirefence") edgeFence++;
      else if (k !== "open") edgeOther++;
    }
    runs += ISO.offEdgeFences({ w: F.W, h: F.H, cells: F.cells }, 5).filter((q) => q.t === 1).length;
  }
  check(edgeFence > 0 && runs > 0, `the fields' fences run right out to the edge cell (${edgeFence} panels on the edge of ${maps} farm hubs' maps) and on into the skirt from there (${runs} lines)`);
  check(!edgeOther, `nothing else of the land on the edge cells (${edgeOther}): it stays the attackers' open ground`);
  // A fight: a wooden fence line and a wire one across the map; a survivor vaults both, the dead crawl over them.
  const st = createWorld({ seed: 7, factionCount: 6 }); st.started = true; st.hour = 24 * 3 + 12;
  const h = hub(st), ids = atBase(st, h.id).slice(0, 1).map((s) => s.id);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: ids, enemy: { kind: "zombies", count: 1, power: 1, name: "Test" }, ambush: "player", canRetreat: false, handler: "ffields", context: {} });
  const b = st.combat, I = (x, y) => y * b.w + x;
  for (const c of b.cells) { c.k = "open"; delete c.h; delete c.t; delete c.hp; delete c.mhp; }
  b.reach.fill(1); b.phase = "player";
  for (let y = 0; y < b.h; y++) { b.cells[I(10, y)].k = "fence"; b.cells[I(13, y)].k = "wirefence"; }
  const u = b.units.find((q) => q.side === "player"), z = b.units.find((q) => q.side === "enemy");
  delete z.ztype; // a plain walker (a Climber goes over its own way: tools/vaulttest.js)
  u.x = 8; u.y = 10; z.x = 16; z.y = 10;
  const r = reachable(b, u, 30), past = r.dist[I(14, 10)];
  check(isFinite(past) && past === 6 + 2 * VAULT.COST, `a survivor vaults the wooden fence and the wire one (${past} tiles to the far side: 6 steps + ${VAULT.COST} a vault)`);
  check(pathTo(r, 14, 10).some(([x]) => x === 10) && pathTo(r, 14, 10).some(([x]) => x === 13), "the path goes over both lines");
  check(!isFinite(r.dist[I(10, 10)]) && !isFinite(r.dist[I(13, 10)]), "a move never ends on a fence");
  const rz = reachable(b, z, 30);
  check(isFinite(rz.dist[I(9, 10)]) && rz.dist[I(9, 10)] === 7 + 2 * CRAWL.COST, `the dead crawl over both (${rz.dist[I(9, 10)]} tiles to the far side)`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
