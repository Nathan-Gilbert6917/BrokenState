// The shared multi-building code (src/sim/compound.js: #30's malls, #28's campuses).
// Usage: node tools/compoundtest.js [seed]
// - placeBuilding: a building turned to each of the four faces keeps its rooms, containers, locked doors and stair runs;
//   its front door opens on the face it was turned to, the stair runs' ways up and the pieces' facings turn with it, a
//   car's cells stay one car (one id, its top-left), container and room ids run on, c.house says whose
// - solid sides: an inline unit's shared side wall has no window
// - connect: a corridor, a covered walkway and an upper-floor bridge join two buildings (one flood reaches both), a room of
//   their own with a door in each wall
// - guard: hundreds of blocking things on an open ground never cut a walkable cell off (and the simple-point test agrees
//   with the flood)
// - parkingLot: cars in double rows, containers of the lot's area, the drive aisles open
// - compoundResult: the map in streetMap's shape (plan.compound, plan.houses with their rooms)
import "../src/sim/world.js"; // the modules' load order (achievements.js)
import { Rng } from "../src/sim/rng.js";
import { BUILDINGS, assemble, STAIR_DIRS } from "../src/sim/buildingmaps.js";
import { CELL } from "../src/sim/combat.js";
import { compoundGrid, placeBuilding, link, guard, parkingLot, compoundResult, orient } from "../src/sim/compound.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const walk = (c) => !!c && (!!(CELL[c.k] && CELL[c.k].walk) || c.k === "door" || c.k === "idoor" || c.k === "odoor");
function flood(cells, W, H, sx, sy) {
  const seen = new Uint8Array(W * H), st = [sy * W + sx];
  seen[st[0]] = 1;
  while (st.length) {
    const i = st.pop(), x = i % W;
    for (const j of [x + 1 < W ? i + 1 : -1, x > 0 ? i - 1 : -1, i + W < W * H ? i + W : -1, i - W]) if (j >= 0 && !seen[j] && walk(cells[j])) { seen[j] = 1; st.push(j); }
  }
  return seen;
}
const mk = (key, s, storeys = null) => {
  const r = new Rng(s);
  const spec = BUILDINGS[key].make(r, {});
  spec.margins = { front: 1, back: 1, left: 1, right: 1 }; spec.ground = "none";
  if (storeys === 1) { spec.storeys = 1; spec.upper = null; }
  return assemble(r, spec, { key, id: `${key}${s}`, name: BUILDINGS[key].name });
};

section("placeBuilding: the four faces");
for (const key of ["grocery", "house", "offices", "garage"]) for (let s = 0; s < 6; s++) {
  const m = mk(key, seed * 100 + s);
  for (const face of ["s", "n", "e", "w"]) {
    const B = m.building, T = orient(face, B.w, B.h);
    const C = compoundGrid(T.w + 6, T.h + 6, m.storeys || 1, () => "gravel");
    C.cid = 5;
    const p = placeBuilding(C, m, { x0: 3, y0: 3, face, k: 2, name: "Test" });
    const rooms = m.rooms.filter((a) => !a.outdoor);
    check(C.areas.length === rooms.length && C.areas.every((a, i) => a.id === i && a.house === 2), `${key} ${face}: rooms copied and numbered`);
    const boxes = m.containers.filter((c) => rooms.some((a) => a.id === c.area));
    check(C.containers.length === boxes.length && C.containers.every((c, i) => c.id === 5 + i && c.house === 2), `${key} ${face}: containers numbered on (${C.containers.length}/${boxes.length})`);
    check(C.containers.every((c) => C.areas[c.area] && c.x >= p.x0 && c.y >= p.y0 && c.x < p.x0 + p.w && c.y < p.y0 + p.h), `${key} ${face}: containers inside the building`);
    check(C.containers.every((c) => { const k = C.floors[c.f].cells[c.y * C.W + c.x].k; return k !== "open" && k !== "void"; }), `${key} ${face}: each container stands on its piece`);
    check(C.lockedDoors.length === m.lockedDoors.length && C.lockedDoors.every((d) => C.floors[d.f].cells[d.y * C.W + d.x].k === "door"), `${key} ${face}: locked doors on door cells`);
    check(p.front && p.front.side === face && !walk(null) && walk(C.cells[p.front.oy * C.W + p.front.ox]) && C.cells[p.front.y * C.W + p.front.x].k.endsWith("door"), `${key} ${face}: the front door opens on its face`);
    // Stair runs: their steps where the run says, rising the way it says.
    const okRuns = C.runs.every((r) => { for (let i = 0; i < r.len; i++) { const c = C.floors[r.f0].cells[(r.y + i * r.dy) * C.W + r.x + i * r.dx]; if (c.k !== "stairs" || (!r.single && STAIR_DIRS[c.dir][0] !== r.dx) || (!r.single && STAIR_DIRS[c.dir][1] !== r.dy)) return false; } return true; });
    check(okRuns && C.runs.length === (m.runs || []).length, `${key} ${face}: stair runs turned with it`);
    // A piece's facing: looking away from the wall behind it.
    let faced = 0, wrong = 0;
    for (let y = 0; y < C.H; y++) for (let x = 0; x < C.W; x++) {
      const c = C.cells[y * C.W + x];
      if (!c.fc || c.pc == null) continue;
      const [dx, dy] = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[c.fc];
      const back = C.cells[(y - dy) * C.W + x - dx];
      faced++;
      if (back && (back.k === "open" || back.k === "void") && C.cells[(y + dy) * C.W + x + dx].k !== "open") wrong++;
    }
    check(wrong <= Math.max(1, faced * 0.15), `${key} ${face}: pieces face into their rooms (${wrong} of ${faced} odd)`);
    // A car: one id, its top-left cell's.
    const ids = new Map();
    for (let i = 0; i < C.cells.length; i++) { const c = C.cells[i]; if (c.car) { const e = ids.get(c.car.id) || []; e.push(i); ids.set(c.car.id, e); } }
    check([...ids].every(([id, list]) => Math.min(...list) + 1 === id), `${key} ${face}: a car's cells keep one id`);
  }
}

section("solid sides");
{
  const m = mk("clothing", seed);
  const C = compoundGrid(m.building.w + 4, m.building.h + 4, 1, () => "gravel");
  const p = placeBuilding(C, m, { x0: 2, y0: 2, face: "s", name: "Unit", solid: ["w", "e"] });
  let win = 0;
  for (let y = p.y0; y < p.y0 + p.h; y++) for (const x of [p.x0, p.x0 + p.w - 1]) if (["window", "smashed"].includes(C.cells[y * C.W + x].k)) win++;
  check(win === 0, "an inline unit's side walls have no windows");
}

section("connect: corridor, walkway, bridge");
for (const kind of ["corridor", "walkway", "bridge"]) {
  const two = kind === "bridge";
  const a = mk(two ? "offices" : "grocery", seed + 1), b = mk(two ? "offices" : "pharmacy", seed + 2);
  const C = compoundGrid(a.building.w + b.building.w + 20, Math.max(a.building.h, b.building.h) + 6, Math.max(a.storeys || 1, b.storeys || 1), () => "grass");
  const pa = placeBuilding(C, a, { x0: 2, y0: 2, face: "s", name: "A" });
  const pb = placeBuilding(C, b, { x0: pa.x0 + pa.w + 8, y0: 2, face: "s", name: "B" });
  const f = two ? 1 : 0;
  const ar = link(C, pa, pb, { kind, f, width: 2 });
  const y = ar ? ar.doors[0][1] : 0;
  const cells = C.floors[f].cells;
  check(ar && ar.doors.length >= 2 && ar.doors.length % 2 === 0 && ar.doors.every(([x, yy]) => /door/.test(cells[yy * C.W + x].k)), `${kind}: a door in each wall`);
  const seen = flood(cells, C.W, C.H, pa.x0 + pa.w + 2, y);
  const inside = (P) => { for (let yy = P.y0 + 1; yy < P.y0 + P.h - 1; yy++) for (let x = P.x0 + 1; x < P.x0 + P.w - 1; x++) if (seen[yy * C.W + x]) return true; return false; };
  check(inside(pa) && inside(pb), `${kind}: one walk from one building into the other`);
  check(C.areas[ar.id] === ar && ar.connector === kind, `${kind}: a room of its own`);
  if (kind === "walkway") check(cells[y * C.W + pa.x0 + pa.w + 3].canopy === true, "walkway: under a canopy");
  if (two) check(C.floors[0].cells[y * C.W + pa.x0 + pa.w + 3].k === "open", "bridge: the ground under it open");
}

section("guard: nothing cut off");
{
  const rng = new Rng(seed);
  const C = compoundGrid(60, 50, 1, () => "grass");
  const G = guard(C, 0, 0);
  let placed = 0;
  for (let t = 0; t < 2500; t++) if (G.block(rng.int(0, 59), rng.int(0, 49), "fence")) placed++;
  const seen = flood(C.cells, 60, 50, 0, 0);
  const open = C.cells.reduce((n, c, i) => n + (walk(c) ? 1 : 0), 0), got = seen.reduce((n, v) => n + v, 0);
  check(placed > 300 && open === got && G.connected(), `${placed} fences: every open cell still reached (${got}/${open})`);
}

section("parking lot");
{
  const C = compoundGrid(70, 40, 1, () => "gravel");
  const G = guard(C, 0, 0);
  const lot = parkingLot(C, G, { x0: 2, y0: 2, w: 66, h: 36 }, new Rng(seed), { parked: 0.6 });
  const cars = C.containers.filter((c) => c.kind === "car");
  check(lot && cars.length >= 15 && cars.every((c) => c.area === lot.id && c.w * c.h >= 6), `cars parked as containers of the lot (${cars.length})`);
  check(G.connected(), "the lot's aisles stay open");
  const res = compoundResult(C, { key: "lot", id: "lot", name: "Lot", zones: [{ x0: 0, y0: 0, w: 3, h: 3 }] });
  check(res.compound && res.plan.compound && res.w === 70 && res.rooms === C.areas, "compoundResult: the map's shape");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
