// A crop plot's wood border (the user's request 2026-10-23: "update the farm plot to have a small wood border around the
// 2x2 plot when putting a plot next to each other remove the wood border between to have the plots merge seamlessly"):
// the base map marks every plot cell (cell.plot), and ui/isoview.js plotEdges gives each cell a bit for each side with no
// plot beside it (1 north, 2 south, 4 west, 8 east), the sides floorColor edges with wood.
// Usage: node tools/plotbordertest.js [seed]
import { createWorld, hub } from "../src/sim/world.js";
import { addBuilding } from "../src/sim/buildings.js";
import * as BM from "../src/sim/basemap.js";
import { seasonGround } from "../src/sim/seasonground.js";

const cvsCtx = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 7 }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: cvsCtx, toDataURL: () => "data:," }), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const { plotEdges } = await import("../src/ui/isoview.js");

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const seed = Number(process.argv[2]) || 42;

const st = createWorld({ seed, factionCount: 6 }); st.started = true;
const h = hub(st);
const t = st.tiles[h.tile]; t.terrain = "plains"; t.loc = null;
h.buildings = h.buildings.filter((b) => b.type !== "farm_plot"); // the start's own eight plots: the game lays them where the land lets it, the test's four are its own
BM.landFor(st, h);
for (let i = 0; i < 4; i++) addBuilding(h, "farm_plot");
const plots = BM.itemsOf(st, h).filter((it) => it.type === "farm_plot");
// Four plots: A and B side by side, C under A (an L of three), D well apart.
const OFF = [[0, 0], [2, 0], [0, 2], [6, 0]];
let origin = null;
for (let d = 8; d < 50 && !origin; d++) for (const [x, y] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]]) {
  if (OFF.every((o, i) => !BM.placeItem(st, h, plots[i].key, x + o[0], y + o[1], 0))) { origin = [x, y]; break; }
}
check(!!origin, "four plots placed (an L of three and one apart)");

console.log("\nThe plots on the base map");
check(!BM.openBaseMap(st, h.id) && st.combat, "the Base map view opens");
const b = st.combat, F = b.deployPlan.fort;
const at = (gx, gy) => { const x = gx + F.ox, y = gy + F.oy; return [x, y, b.cells[y * b.w + x]]; };
let marked = 0;
for (const o of OFF) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (at(origin[0] + o[0] + dx, origin[1] + o[1] + dy)[2].plot) marked++;
check(marked === 16, `all 16 cells of the four plots are plot cells (${marked})`);
const outside = at(origin[0] + 4, origin[1] + 4)[2];
check(!outside.plot, "the ground beside them is not");

console.log("\nThe edges");
const PE = plotEdges(b.cells, b.w, b.h);
check(!!PE, "the map has plot edges");
const E = (gx, gy) => { const [x, y] = at(gx, gy); return PE[y * b.w + x]; };
const [ox, oy] = origin;
// A (0,0)-(1,1): its east side meets B, its south side meets C: those cells carry no east / south border there.
check(E(ox + 1, oy) === 1, "A's top-right cell: a border on the north only (B beside it)");
check(E(ox + 1, oy + 1) === 0, "A's bottom-right cell: no border at all (B east, C south-east of it is plot, south of it is C)");
check((E(ox, oy) & 8) === 0 && (E(ox, oy + 1) & 8) === 0, "A's east side has no border where B joins it");
check((E(ox, oy + 1) & 2) === 0 && (E(ox + 1, oy + 1) & 2) === 0, "A's south side has no border where C joins it");
check((E(ox, oy) & 1) === 1 && (E(ox, oy) & 4) === 4, "A's outer corner (north and west) is bordered");
// B (2,0)-(3,1): its west meets A; its other sides are open.
check((E(ox + 2, oy) & 4) === 0 && (E(ox + 2, oy + 1) & 4) === 0, "B's west side has no border where A joins it");
check((E(ox + 3, oy) & 9) === 9 && (E(ox + 3, oy + 1) & 8) === 8, "B's outer sides (north, east) are bordered");
check((E(ox + 2, oy + 1) & 2) === 2 && (E(ox + 3, oy + 1) & 2) === 2, "B's south side is bordered (nothing under it)");
// D stands alone: every side of its four cells that faces out has wood.
let ring = 0;
for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
  const want = (dy === 0 ? 1 : 0) | (dy === 1 ? 2 : 0) | (dx === 0 ? 4 : 0) | (dx === 1 ? 8 : 0);
  if (E(ox + 6 + dx, oy + dy) === want) ring++;
}
check(ring === 4, `the lone plot is bordered all the way round (${ring} of 4 cells exactly)`);
check(PE[(outside === undefined ? 0 : at(ox + 4, oy + 4)[1] * b.w + at(ox + 4, oy + 4)[0])] === 0, "cells that are not plots carry no edge bits");

console.log("\nThe season never covers a plot (builds are the top layer: the user's word 2026-10-23)");
const plotCells = b.cells.filter((c) => c.plot), others = b.cells.filter((c) => !c.plot);
const clear = () => { for (const c of b.cells) { delete c.gnd; delete c.sd; } delete b.ground; delete b.snowLie; };
clear();
// (The yard is the tile's own grass since 2026-10-24, no dirt square: some trodden ground for the mud to lie on.)
for (const c of b.cells.filter((c) => c.k === "open" && !c.plot && c.f === "grass").slice(0, 2000)) c.f = "dirt";
const mud = seasonGround(st, b, h.tile);
check(mud > 0, `spring mud lies on the trodden dirt (${mud} cells)`);
check(!plotCells.some((c) => c.gnd), "…and on none of the plots' soil");
clear();
b.snowLie = 0.75;
const snow = seasonGround(st, b, h.tile);
check(snow > 0 && others.some((c) => c.gnd === "snow"), `winter snow lies on the open ground (${snow} cells)`);
check(!plotCells.some((c) => c.gnd), "…and on none of the plots");
clear();

// A map with no plots at all: nothing to edge.
const cells = b.cells.map((c) => ({ ...c, plot: undefined }));
check(plotEdges(cells, b.w, b.h) === null, "no plots: plotEdges gives null (floorColor draws nothing)");

console.log(`\n${failed ? "FAILED" : "passed"}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
