// The State Map's moving pieces as low-poly figures (src/ui/mapfigures.js; drawn by render.js and workermap.js):
// - the heading: yawOf turns a screen direction into the yaw whose forward projects along it (east 315, west 135,
//   down the screen 45, up 225, the hex roads' six ways), rounded to STEP; dirOf gives the screen direction back;
// - every piece builds on a stub canvas without a DOM: your teams in every kind (and a vehicle's upgrades), the
//   groups' parties by type and kind, their parties of one, the outsiders by kind, sub and escort, hordes of 2–7, herds,
//   the workers in every job with every load, a team of one in every gait with a light, a cyclist; each paints
//   pixels, none a NaN;
// - a piece's grid is fixed by its kind: the same canvas size at every heading and frame (a turning piece keeps its
//   drawn width), the ground point inside it;
// - the frames animate: a piece mid-cycle differs from the same piece standing and from another frame; the heading
//   changes the picture; the same look, heading and frame come back from the cache as the same canvas;
// - drawPiece puts the ground point where asked (the canvas's top-left is the ground point less the grid's origin);
// - in the renderer: a team of yours on the road and a horde in view are drawn as pieces (canvases with a grid), the
//   team's at its tile, and the workers' module draws its figures as pieces too.
// Usage: node tools/mapfigurestest.js [seed]   (a few seconds)
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, partyTile } from "../src/sim/parties.js";
import { makeHorde } from "../src/sim/hordes.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log("  FAIL:", msg); } };
const section = (s) => console.log(`\n${s}`);

// A stub 2D context: fillRect records the painted cells (the painter's output), drawImage the pieces drawn on the map.
const images = [];
let nan = 0;
const noop = () => {};
function stubCtx(cv) {
  const off = { x: 0, y: 0 }, stack = [];
  const o = {
    measureText: (t) => ({ width: String(t).length * 5 }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    createRadialGradient: () => ({ addColorStop: noop }), createLinearGradient: () => ({ addColorStop: noop }), createPattern: () => null,
    save: () => stack.push({ ...off }), restore: () => Object.assign(off, stack.pop() || { x: 0, y: 0 }), translate: (x, y) => { off.x += x; off.y += y; },
    fillRect: (x, y, w, h) => { if ([x, y, w, h].some((v) => !Number.isFinite(v))) nan++; if (cv) cv.ops.push(`${o.fillStyle}:${x},${y},${w},${h}`); },
    drawImage: (img, ...a) => { if (a.some((v) => !Number.isFinite(v))) nan++; images.push({ cv: img, x: a[0] + off.x, y: a[1] + off.y, w: a[2], h: a[3] }); },
  };
  return new Proxy(o, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => ((t[k] = v), true) });
}
const stubCanvas = () => { const cv = { width: 0, height: 0, ops: [] }; cv.getContext = () => stubCtx(cv); cv.toDataURL = () => "data:,"; return cv; };
globalThis.document = { createElement: () => stubCanvas(), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const M = await import("../src/ui/mapfigures.js");
const R = await import("../src/ui/render.js");

const solid = (cv) => cv.ops.filter((s) => !s.startsWith("#0b0c0e:")).length; // painted cells, the outline aside
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

section("The heading");
check(M.yawOf(1, 0) === 315 && M.yawOf(-1, 0) === 135 && M.yawOf(0, 1) === 45 && M.yawOf(0, -1) === 225, "east 315, west 135, down the screen 45, up 225");
check(M.yawOf(0.5, 0.866) === 30 && M.yawOf(-0.5, 0.866) === 60 && M.yawOf(-0.5, -0.866) === 210 && M.yawOf(0.5, -0.866) === 240, "the hex roads' diagonals: SE 30, SW 60, NW 210, NE 240");
check(M.yawOf(0, 0) === 315, "no direction: east");
check([0, 30, 45, 60, 135, 210, 225, 240, 315].every((y) => M.yawOf(...M.dirOf(y)) === y), "dirOf and yawOf are inverses on the cached headings");
for (const [dx, dy] of [[1, 0], [0, 1], [3, -2], [-1, 4]]) { const d = M.dirOf(M.yawOf(dx, dy)), l = Math.hypot(dx, dy); const cos = (d[0] * dx + d[1] * dy) / l; check(cos > 0.96, `dirOf(yawOf(${dx}, ${dy})) points that way (cos ${cos.toFixed(3)})`); }
check(M.roundYaw(-7) === 0 && M.roundYaw(367) === 0 && M.roundYaw(37) === 30 && M.roundYaw(38) === 45, "roundYaw to STEP, into 0–359");

section("Every piece builds, paints, and keeps its grid");
const BLUE = "#4f8fd6", RED = "#b03a2a";
const pieces = [];
const add = (name, fn) => pieces.push([name, fn]);
for (const k of ["walkers", "raid", "scouts", "relief", "truck", "sedan", "miltruck", "boat", "raft", "convoy", "supply", "cart", "supplycart"]) add(`team ${k}`, (y, f) => M.mapPartyCanvas(k, BLUE, 3, "", y, f));
for (const [k, n] of [["walkers", 1], ["walkers", 2], ["walkers", 4], ["raid", 1], ["scouts", 1], ["relief", 2]]) add(`team ${k} ×${n}`, (y, f) => M.mapPartyCanvas(k, BLUE, n, "", y, f));
for (const [k, ups] of [["truck", "p1s0g0m0t"], ["truck", "p2s0g1m0tm2hb"], ["sedan", "p0s1g0m1tm240"], ["miltruck", "p1s0g0m0tm2hb"]]) add(`team ${k} ${ups}`, (y, f) => M.mapPartyCanvas(k, BLUE, 3, ups, y, f));
for (const t of ["raider", "military", "zealot", "expansionist", "traders", "commune", "fortress"]) {
  for (const k of ["convoy", "raid", "scav", "walk"]) add(`group ${t} ${k}`, (y, f) => M.mapGroupPartyCanvas(t, k, RED, 3, y, f));
  for (const k of ["walk", "raid", "scav"]) add(`group ${t} one ${k}`, (y, f) => M.mapGroupSoloCanvas(t, k, RED, y, f));
  add(`group ${t} raid ×1`, (y, f) => M.mapGroupPartyCanvas(t, "raid", RED, 1, y, f));
}
for (const [k, s, esc] of [["raiders", "", null], ["raiders", "", null], ["merchants", "", null], ["merchants", "", { tier: "light" }], ["merchants", "", { tier: "armed", vehicle: "" }], ["merchants", "", { tier: "armoured", vehicle: "hummer" }], ["merchants", "", { tier: "armoured", vehicle: "mrap" }], ["explorers", "scouts", null], ["explorers", "refugees", null], ["explorers", "wanderers", null], ["explorers", "", null]]) add(`outsiders ${k} ${s} ${esc ? esc.tier : ""}`, (y, f) => M.mapOutsiderPartyCanvas(k, s, 3, esc, y, f));
for (const [k, s] of [["raiders", ""], ["explorers", "scouts"], ["explorers", "refugees"], ["explorers", "wanderers"]]) for (const i of [0, 1]) add(`outsider ${k} ${s} ${i}`, (y, f) => M.mapOutsiderSoloCanvas(k, s, i, y, f));
for (const n of [2, 3, 4, 5, 6, 7]) add(`horde ${n}`, (y, f) => M.mapHordeCanvas(n, y, f));
for (const k of ["deer", "hog"]) for (const n of [1, 2, 3]) add(`herd ${k} ${n}`, (y, f) => M.mapHerdCanvas(k, n, y, f));
for (const j of ["wood", "hunt", "fish", "forage", "scavenge", "water"]) for (const l of ["", "logs", "game", "fish", "basket", "sack", "buckets", "small"]) add(`worker ${j} ${l}`, (y, f) => M.mapWorkerCanvas(j, BLUE, y, f, l));
for (const k of ["walkers", "raid", "scouts", "relief"]) for (const [l, g] of [["", ""], ["torch", ""], ["lamp", ""], ["", "limp"], ["", "heavy"], ["torch", "limp"]]) add(`one ${k} ${l} ${g}`, (y, f) => M.mapSoloCanvas(k, BLUE, y, f, l, g));
add("cyclist", (y, f) => M.mapCyclistCanvas(BLUE, y, f));
let built = 0, bad = [];
const t0 = performance.now();
for (const [name, fn] of pieces) {
  const a = fn(315, 0), b = fn(315, 3), c = fn(135, 3), d = fn(45, 7);
  built += 4;
  if (!a || !a.grid || !b || !c || !d) { bad.push(`${name}: no canvas`); continue; }
  if (!(solid(a) > 20 && solid(b) > 20 && solid(c) > 20 && solid(d) > 20)) bad.push(`${name}: too few cells (${solid(a)}, ${solid(b)}, ${solid(c)}, ${solid(d)})`);
  if (!(a.width === b.width && a.width === c.width && a.width === d.width && a.height === b.height && a.height === c.height && a.height === d.height)) bad.push(`${name}: the grid changes with the heading or frame`);
  if (!(a.grid.ox > 0 && a.grid.ox < a.grid.w && a.grid.oy > 0 && a.grid.oy < a.grid.h && a.width === a.grid.w * 4)) bad.push(`${name}: the ground point is off the grid`);
  if (a.ops.join() === b.ops.join()) bad.push(`${name}: a frame of the cycle looks like standing still`);
  if (b.ops.join() === c.ops.join()) bad.push(`${name}: the heading changes nothing`);
  if (fn(315, 3) !== b) bad.push(`${name}: not cached`);
}
check(bad.length === 0, `every piece builds, paints and keeps its grid: ${bad.slice(0, 6).join("; ")}`);
check(nan === 0, "no NaN reached a canvas");
console.log(`  ${built} canvases built in ${Math.round(performance.now() - t0)} ms (${pieces.length} pieces)`);
{ // frames apart: eight frames of a walker are eight pictures, the standing one a ninth
  const seen = new Set();
  for (let f = 0; f <= M.FRAMES; f++) seen.add(M.mapSoloCanvas("walkers", BLUE, 315, f).ops.join());
  check(seen.size === M.FRAMES + 1, `a walker's ${M.FRAMES} frames and the standing pose are ${M.FRAMES + 1} pictures (${seen.size})`);
  check(M.mapSoloCanvas("walkers", BLUE, 315, M.FRAMES + 1) === M.mapSoloCanvas("walkers", BLUE, 315, 1), "a frame past the cycle wraps to its first");
  const w1 = M.mapPartyCanvas("truck", BLUE, 3, "", 315, 1), w5 = M.mapPartyCanvas("truck", BLUE, 3, "", 315, 5);
  check(w1.ops.join() !== w5.ops.join(), "a truck's wheels turn between frames");
  check(M.mapPartyCanvas("truck", BLUE, 3, "", 315, 3) !== M.mapPartyCanvas("truck", BLUE, 3, "p1s0g0m0t", 315, 3), "a plated truck is its own piece");
}
{ // the near hand: a lone raider's rifle is in whichever hand shows, so the raid piece differs from a walker heading east and west alike
  const diff = (y) => M.mapSoloCanvas("raid", BLUE, y, 3).ops.join() !== M.mapSoloCanvas("walkers", BLUE, y, 3).ops.join();
  check(diff(315) && diff(135) && diff(45) && diff(225), "the rifle shows at every heading");
}

section("drawPiece puts the ground point where asked");
{
  const ctx = stubCtx(null), cv = M.mapSoloCanvas("walkers", BLUE, 315, 0), g = cv.grid;
  images.length = 0;
  M.drawPiece(ctx, cv, 100, 50, 2, {}, 1);
  check(images.length === 1 && near(images[0].x, 100 - g.ox * 2) && near(images[0].y, 50 - g.oy * 2) && near(images[0].w, g.w * 2) && near(images[0].h, g.h * 2), "the canvas's top-left is the ground point less the grid's origin, 2 px a grid px");
  const [bx, by, bw, bh] = M.pieceBox(cv, 100, 50, 2);
  check(near(bx, images[0].x) && near(by, images[0].y) && near(bw, images[0].w) && near(bh, images[0].h), "pieceBox is the drawn box");
  images.length = 0;
  M.drawPiece(ctx, cv, 100, 50, 2, { angle: 0.1 }, 1);
  check(images.length === 1 && near(images[0].x, 100 - g.ox * 2) && near(images[0].y, 50 - g.oy * 2), "turned, the same box (through the translate)");
  M.drawPiece(ctx, null, 0, 0, 1, {}, 1);
  check(images.length === 1, "no canvas (headless): nothing drawn");
}

section("In the renderer: a team on the road and a horde are drawn as pieces");
{
  const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.cards.length = 0;
  const h = hub(st), people = atBase(st, h.id).filter((s) => s.alive);
  const dest = st.tiles.find((t) => st.grid.distance(t.id, h.tile) === 3 && t.terrain !== "water" && !st.bases.some((b) => b.tile === t.id));
  const res = launchExpedition(st, { memberIds: people.slice(0, 2).map((s) => s.id), dest: dest.id, mission: "move", stance: "normal", supplies: { food: 2, water: 2 } });
  check(!res.error, `a team sets out (${res.error || "ok"})`);
  const p = res.party;
  p.radioLive = true;
  if (p.path.length >= 3) p.idx = 1; // a tile along: on a plain tile (beside the hub a piece stands off the base)
  const horde = makeHorde(st, { tile: st.grid.neighbors(h.tile)[0], size: 20, target: h.tile, role: "attack" });
  R.initRenderer({ getContext: () => stubCtx(null), getBoundingClientRect: () => ({ width: 1600, height: 900 }), width: 0, height: 0 });
  R.zoomAt(800, 450, 2 / R.camera.zoom);
  R.setMapAnim(false); // a moving piece holds a stride (frame 3): the picture is known
  R.view.devReveal = true;
  const frame = (id) => { images.length = 0; R.centerOn(st, id); R.redrawMap(true); R.render(st); };
  frame(partyTile(p));
  const pieces = images.filter((i) => i.cv && i.cv.grid);
  check(pieces.length >= 2, `pieces drawn in view (${pieces.length})`);
  const [tx, ty] = st.grid.toPixel(partyTile(p), R.HEX);
  const team = pieces.find((i) => Math.abs(i.x + i.cv.grid.ox * (i.w / i.cv.grid.w) - tx) < 20 && Math.abs(i.y + i.cv.grid.oy * (i.h / i.cv.grid.h) - ty) < 20);
  check(!!team, "your team's piece stands at its tile");
  const next = p.path[p.idx + 1], [nx, ny] = st.grid.toPixel(next, R.HEX);
  check(team && team.cv === M.mapPartyCanvas("walkers", BLUE, 2, "", M.yawOf(nx - tx, ny - ty), 3), "the team faces the next tile on its path, mid-stride (animations off hold a stride)");
  const [hx, hy] = st.grid.toPixel(horde.tile, R.HEX);
  const hp = pieces.find((i) => Math.abs(i.x + i.cv.grid.ox * (i.w / i.cv.grid.w) - hx) < 24 && Math.abs(i.y + i.cv.grid.oy * (i.h / i.cv.grid.h) - hy) < 24);
  check(!!hp, "the horde is drawn as a piece at its tile");
  check(nan === 0, "no NaN reached the map canvas");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
