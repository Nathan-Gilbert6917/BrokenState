// @ts-check
// College campuses (the user's request 2026-10-25, issue #28 of the interiors epic #7: "Add college campus maps that
// are max 500x500 with connected and disconnected buildings courtyards and dorms"). A university (SITES univ) or a
// college (SITES college, mapgen.js: a town's) opens one raid map with the whole campus on it (campusMap), as a
// neighbourhood opens a street of houses (buildingmaps.js streetMap, the precedent this follows):
//
//   - The kind (CAMPUS.KINDS, campusKind: the site's dice, tile.loc.campus when mapgen set it): a community college
//     (4–8 buildings, one quad, a parking lot, no dorm or one small one), a liberal arts college (8–15 round one or two
//     quads, a chapel, dorms) or a state university (15–40, several quads, many dorms, a stadium, a parking garage).
//     The map is sized by the kind, at most CAMPUS.MAX across (300 until #24's big-map engine work is on dev, then 500).
//   - The buildings (campuslayout.js CAMPUS_PLANS, the chapel and the health centre: buildingmaps.js BUILDINGS): each
//     its own plan from its own dice (the option id and its number), its rooms, floors, doors, windows, locks,
//     containers and signs of survival (interiorscenes.js, rolled on each before it is copied in), copied onto the
//     map in rows (CAMPUS.ZONES: the dorms and the dining hall to the north, the teaching buildings round the quads,
//     athletics, the garage and the plant to the south by the fields and the lots), every front to the south onto a
//     promenade. Rooms are named after their building ("Lounge, Hale Hall"); containers are numbered on across the
//     buildings and carry c.house (the building's number), so the site's ledger (poicont.js) keeps each building apart
//     and a revisit finds each as it was left.
//   - Connected buildings (CAMPUS.LINK): two neighbours in a row joined by a covered walkway (a canopy over a floor,
//     open at the sides), a connecting corridor (walls and windows) or, between upper floors, a glass bridge (the same
//     floor index in both: the cells between them on that floor only, the ground under it open); each is a room of
//     its own (plan.links) with a door into each building, so the dead and the living path through it. The rest stand
//     alone across the lawns. In front of each link the space between the two buildings is an enclosed courtyard
//     (hedges along the promenade with a gate).
//   - The ground: quads (lawns with crossing paths, trees, benches, a statue or a fountain), courtyards, plazas by the
//     fronts, parking lots (cars to search: AREAS.wreck), the sports field with its running track (and a stadium stand
//     at a state university), the campus road along the south and a service road down the east side.
//   - The ways out: both ends of the campus road (the team comes in at the west end with its vehicle), the north edge,
//     the west and east edges, and the parking lots.
//   - The dead (campusDead): spread by building and over the open ground by the area each has, the dorms and the dining
//     hall the densest (CAMPUS.DENSE), scaled by the campus's floor area (CAMPUS.DEAD_AREA), at most CAMPUS.DEAD_MAX.
//   - Heat (campusHeatDims): the big-map clock by the area of the buildings your people have searched, not the map's.
//   - Loot (campusLootShare): a container holds what it would in its building's own map.
//   - AI parity: other groups take from the campus through the POI rules (poicont.js lootPoiAbstract): its pool falls a
//     building at a time (poicont.js poiHouses counts the campus's buildings), as your headless crews' does.
//   - Older saves: a university whose buildings a raid already went into keeps them (campusLegacy: the site's ledger
//     names their maps); every other one, and every new run's, is a campus.
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";
import { BUILDINGS, assemble, DOOR_KINDS, STREET } from "./buildingmaps.js"; // call-time only (buildingmaps.js imports this module)
import { CELL, AREAS, placeCar, placeVehicle, CAR_LEN, enemyUnit, setFloor } from "./combat.js";
import { raidLootShare, raidHeatRate } from "./battlesize.js";
import { legacyRooms } from "./worldcfg.js";
import { rollScenes, sceneRng } from "./interiorscenes.js";
import { rollWin } from "./windows.js";
import { applyZType, siteList } from "./zombietypes.js";
import { CAMPUS_NAMES } from "./campuslayout.js";

export const CAMPUS = {
  MAX: 300,            // a campus map's side at most: 500 once #24's engine work (windowed pathing, tiled canvases, compact saves) is on dev
  EDGE: 6,             // the grounds between the map's edges and the buildings (the north, west and east ways out)
  ROAD: 5,             // the campus road along the south edge (the way in)
  SERVICE: 3,          // the service road down the east side
  GAP: [6, 10],        // the lawn between two buildings of a row that stand apart (a path through it)
  LINK: [7, 10],       // a link's length between two joined buildings (the courtyard in front of it as wide)
  LINKS: { community: 0.45, liberal: 0.4, state: 0.35 }, // the chance two neighbours in a row are joined
  BRIDGE: 0.45,        // a link between two buildings of 2+ storeys is a glass bridge upstairs on these dice
  WALKWAY: 0.55,       // else a covered walkway (else a connecting corridor)
  FRONT: 2,            // the lawn between a row's fronts and its promenade
  PATH: 2,             // the promenade's width (and every path's)
  QUAD: [18, 30],      // a quad's depth
  YARD: 10,            // the lawn between two rows of dorms
  LOT: [16, 20],       // a parking lot's depth
  FIELD: { w: 64, h: 42, track: 3 }, // the sports field with its running track round it
  TREES: 0.012,        // trees on a quad, a share of its cells
  BENCH: 0.004,        // benches likewise
  DENSE: { dorm: 1.7, dininghall: 1.6, studentunion: 1.2, parkgarage: 0.6, maintenance: 0.6, security: 0.8 }, // the dead per cell of a building by kind (1 else)
  OUTSIDE: 0.3,        // the share of the dead on the open ground
  DEAD_AREA: 2500,     // the site's roster × (the campus's ground-floor building area / this) ^ DEAD_EXP …
  DEAD_EXP: 0.5,
  DEAD_MAX: 100,       // … at most this many of the dead in all (the issue's turn target: 100 dead)
  QUARANTINE: 0.5,     // a quad's quarantine tent (an outdoor scene) on these dice
  STALL: 3,            // a parking stall's width (a car 2 wide, a cell between: placeCar's ring)
  CARS: 0.55,          // the stalls with a car left in them
  // The kinds: the map's size, the buildings (how many, the dorms among them), the quads.
  KINDS: {
    community: { name: "Community college", w: [140, 160], h: [110, 130], n: [4, 8], dorms: [0, 1], dormStoreys: [2, 2], quads: 1, lots: 1, field: false,
      must: ["admin", "lecturehall", "sciencehall", "univlibrary"], more: ["studentunion", "athletics", "maintenance", "security", "healthcentre", "theatre", "lecturehall", "dininghall"] },
    liberal: { name: "Liberal arts college", w: [200, 240], h: [180, 220], n: [8, 15], dorms: [2, 4], dormStoreys: [2, 4], quads: 2, lots: 1, field: true,
      must: ["admin", "chapel", "lecturehall", "sciencehall", "univlibrary", "dininghall", "studentunion"], more: ["athletics", "theatre", "healthcentre", "security", "maintenance", "lecturehall", "sciencehall", "dorm"] },
    state: { name: "State university", w: [400, 500], h: [400, 500], n: [15, 40], dorms: [4, 10], dormStoreys: [3, 6], quads: 3, lots: 2, field: true, stadium: true,
      must: ["admin", "univlibrary", "studentunion", "dininghall", "athletics", "parkgarage", "security", "healthcentre", "maintenance", "lecturehall", "lecturehall", "sciencehall", "sciencehall"],
      more: ["lecturehall", "sciencehall", "theatre", "chapel", "dininghall", "dorm", "parkgarage", "admin", "lecturehall", "sciencehall", "studentunion", "dorm", "univlibrary"] },
  },
  // Which row a building stands in, north to south.
  ZONES: { dorm: 0, dininghall: 0, admin: 1, univlibrary: 1, lecturehall: 1, sciencehall: 1, studentunion: 1, chapel: 1, theatre: 1, healthcentre: 1, security: 1, athletics: 2, parkgarage: 2, maintenance: 2 },
};
// The halls' names (a franchise-like list in the setting's style): a dorm's, the others' after their kind.
const HALL_NAMES = ["Hale", "Whitcombe", "Calder", "Granite", "Morrow", "Ashby", "Lindqvist", "Carver", "Thorne", "Pell", "Halvorsen", "Brandt", "Okafor", "Reyes", "Sutter", "Wren", "Delacroix", "Ingram", "Marsh", "Quill", "Fenwick", "Adair", "Bellamy", "Crane"];
const KIND_NAME = { lecturehall: "Lecture Hall", sciencehall: "Science Center", univlibrary: "Library", studentunion: "Student Union", dininghall: "Dining Commons", athletics: "Athletics Center", admin: "Administration", security: "Campus Security", maintenance: "Physical Plant", theatre: "Arts Center", parkgarage: "Parking Garage", chapel: "Chapel", healthcentre: "Health Center" };
// The fictional colleges a college site is named after (mapgen.js collegeName): a town's own name in most.
export const COLLEGE_NAMES = {
  community: ["{town} Community College", "{town} Valley Community College", "{town} County Community College", "{town} Technical College"],
  liberal: ["{town} College", "St. Augustine College", "St. Brendan's College", "Whitcombe College", "Calder Bay College", "Morrow College", "{town} Christian College"],
};

const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const dice = (state, ...keys) => hash01(state.seed, "campus", ...keys);
const seedOf = (state, ...keys) => Math.floor(dice(state, ...keys) * 4294967296);

// The campus kind at a site: the tile's (mapgen.js college sites set tile.loc.campus), else by its dice: a university
// is a state university (a liberal arts one a quarter of the time), a college a community college or a liberal arts one.
export function campusKind(state, tile) {
  const L = tile && tile.loc;
  if (L && L.campus && CAMPUS.KINDS[L.campus]) return L.campus;
  const r = dice(state, "kind", tile ? tile.id : 0);
  if (L && L.type === "college") return /community|technical/i.test(L.name || "") ? "community" : r < 0.5 ? "community" : "liberal";
  return r < 0.75 ? "state" : "liberal";
}
// An older save's university one of whose buildings a raid already went into (its site's ledger has their maps, not
// the campus's): it keeps its buildings (buildingmaps.js SITES_LEGACY).
export function campusLegacy(tile) {
  const poi = tile && Array.isArray(tile.pois) ? tile.pois.find((p) => p && p.site) : null;
  const maps = poi && poi.cont && poi.cont.maps ? Object.keys(poi.cont.maps) : [];
  return maps.some((m) => m !== "campus" && m !== "street");
}

// The buildings a campus has: [{ key, o (the plan's options) }], the must-haves first, then the dorms, then more by the
// dice. rng: the campus's own.
function campusList(rng, kind) {
  const K = CAMPUS.KINDS[kind];
  const n = rng.int(K.n[0], K.n[1]), dorms = rng.int(K.dorms[0], K.dorms[1]);
  const out = K.must.map((key) => ({ key }));
  for (let i = 0; i < dorms; i++) out.push({ key: "dorm" });
  const more = rng.shuffle(K.more.slice());
  for (let i = 0; out.length < n; i++) out.push({ key: more[i % more.length] });
  for (const b of out) {
    b.o = {};
    if (b.key === "dorm") { b.o.storeys = rng.int(K.dormStoreys[0], K.dormStoreys[1]); if (kind === "community") b.o.bw = 34; }
    if (kind === "community" && b.key === "univlibrary") b.o.storeys = 2;
    if (kind === "community" && b.key === "athletics") b.o.bw = 38;
  }
  return out.slice(0, Math.max(n, K.must.length + dorms));
}

// The campus's plan without its map (campusMap, campusBuildings): the kind, the map's size, the buildings' specs (each
// from its own dice) and the rows they stand in. Too deep for the map: fewer of the optional buildings, the last first.
const AVAIL = (w) => w - 2 * CAMPUS.EDGE - CAMPUS.SERVICE - 2; // a row's width (the service road down the east side)
function campusPlan(state, tileId, option) {
  const tile = state.tiles[tileId];
  const kind = campusKind(state, tile), K = CAMPUS.KINDS[kind];
  const rng = new Rng(seedOf(state, "map", tileId, option.id));
  const legacy = legacyRooms(state);
  const MAXW = Math.min(CAMPUS.MAX, rng.int(K.w[0], K.w[1])), MAXH = Math.min(CAMPUS.MAX, rng.int(K.h[0], K.h[1]));
  const built = campusList(rng, kind).map((b, k) => {
    const id = `${option.id}#${k + 1}`;
    const hr = new Rng(seedOf(state, "bldg", tileId, id));
    const spec = BUILDINGS[b.key].make(hr, { ...b.o, legacy, maxStoreys: 8 });
    spec.margins = { front: 1, back: 1, left: 1, right: 1 };
    spec.ground = "none";
    const storeys = Math.max(1, Math.min(8, Math.round(spec.storeys || 1)));
    return { k, key: b.key, id, hr, spec, m: null, bw: spec.bw, bh: spec.bh, storeys, zone: CAMPUS.ZONES[b.key] ?? 1, name: "", x0: 0, y0: 0, link: null };
  });
  let layout = planRows(rng, built, kind, MAXW, AVAIL);
  while (layout.H > MAXH && built.length > K.must.length) {
    built.length = Math.max(K.must.length, built.length - Math.max(1, Math.ceil((layout.H - MAXH) / 40)));
    layout = planRows(rng, built, kind, MAXW, AVAIL);
  }
  return { tile, kind, K, rng, legacy, MAXW, MAXH, built, layout };
}

/**
 * The map of a campus (buildingmaps.js buildingMap, for BUILDINGS.campus): the same every visit (its dice from the
 * world seed, the tile and the option id).
 * @param {any} state @param {number} tileId @param {{ id: string, key: string, name: string }} option @param {any} withVehicle
 */
export function campusMap(state, tileId, option, withVehicle) {
  const C = CAMPUS;
  const { kind, K, rng, legacy, MAXW, MAXH, built, layout } = campusPlan(state, tileId, option);
  // ---------- the buildings, each its own plan and map, its signs of survival on it (copied in with it) ----------
  for (const B of built) {
    B.m = assemble(B.hr, B.spec, { key: B.key, id: B.id, name: BUILDINGS[B.key].name, legacy });
    B.storeys = B.m.storeys || 1;
    rollScenes(B.m, sceneRng(state, tileId, { id: B.id }), B.key);
  }
  // Names: a residence hall a person's ("Hale Hall"), the rest by their kind, a second of a kind numbered.
  const names = rng.shuffle(HALL_NAMES.slice());
  const named = {};
  for (const B of built) {
    const base = B.key === "dorm" ? `${names[B.k % names.length]} Hall` : KIND_NAME[B.key] || CAMPUS_NAMES[B.key];
    named[base] = (named[base] || 0) + 1;
    B.name = named[base] > 1 ? `${base} ${["", "", "II", "III", "IV", "V", "VI"][named[base]] || named[base]}` : base;
  }
  const { rows, strips } = layout;
  const W = MAXW, H = Math.min(C.MAX, Math.max(layout.H, Math.min(MAXH, layout.H + 40)));
  // Stretch the quads to the map's depth (a deeper map: roomier quads, never past their range).
  let spare = H - layout.H;
  for (const s of strips) if (spare > 0 && s.kind === "quad") { const add = Math.min(spare, C.QUAD[1] - s.h); if (add > 0) { s.h += add; spare -= add; } }
  // Put the rows and strips at their y, top to bottom.
  let y = C.EDGE;
  const order = [];
  for (let i = 0; i < rows.length; i++) { order.push({ row: rows[i] }); if (strips[i]) order.push({ strip: strips[i] }); }
  for (const o of order) {
    if (o.row) { o.row.y0 = y; y += o.row.D + C.FRONT; o.row.walk = y; y += C.PATH; }
    else { o.strip.y0 = y; y += o.strip.h; }
  }
  const roadY = H - C.ROAD - 2; // the campus road's top row
  // Rows across: buildings left to right, the slack shared out as wider gaps (a joined pair keeps its link's length).
  for (const row of rows) {
    const used = row.list.reduce((a, B) => a + B.bw, 0) + row.gaps.reduce((a, g) => a + g, 0);
    const extra = Math.max(0, AVAIL(W) - used), free = row.gaps.map((g, j) => !row.list[j].link);
    const slots = free.filter(Boolean).length + 2, each = Math.min(14, Math.floor(extra / slots));
    let x = C.EDGE + 1 + Math.floor((extra - each * (slots - 2)) / 2);
    row.list.forEach((B, j) => { B.x0 = x; B.y0 = row.y0 + row.D - B.bh; x += B.bw + (j < row.gaps.length ? row.gaps[j] + (free[j] ? each : 0) : 0); });
  }
  const I = (x, yy) => yy * W + x;
  const inside = (x, yy) => x >= 0 && yy >= 0 && x < W && yy < H;
  /** @type {any[]} */
  const cells = Array.from({ length: W * H }, () => ({ k: "open", f: "grass" }));
  const storeys = Math.max(...built.map((B) => B.storeys));
  const floors = [{ cells, name: "Ground floor" }];
  for (let g = 1; g < storeys; g++) floors.push({ cells: Array.from({ length: W * H }, () => ({ k: "void", f: "air" })), name: g === storeys - 1 ? "Top floor" : `Floor ${g + 1}` });
  const keep = new Uint8Array(W * H); // stays clear: the ring round each building, the paths, the roads, the zones
  const paint = (x0, y0, w, h, f, mark = true) => { for (let yy = y0; yy < y0 + h; yy++) for (let x = x0; x < x0 + w; x++) if (inside(x, yy)) { cells[I(x, yy)].f = f; if (mark) keep[I(x, yy)] = 1; } };
  // ---------- the roads and the paths ----------
  paint(0, roadY, W, C.ROAD, "road");
  paint(0, roadY - 1, W, 1, "gravel"); paint(0, roadY + C.ROAD, W, 1, "gravel"); // its sidewalks
  const sx = W - C.EDGE - C.SERVICE + 1; // the service road down the east side
  paint(sx, 0, C.SERVICE, roadY, "road");
  for (const row of rows) {
    paint(C.EDGE - 2, row.walk, sx - C.EDGE + 2, C.PATH, "gravel"); // the promenade along the row's fronts
    // Paths north between the buildings (and past the row's ends) to the strip behind the row.
    const xs = [C.EDGE - 1, ...row.list.slice(0, -1).map((B, j) => (row.list[j].link ? -1 : Math.floor((B.x0 + B.bw + row.list[j + 1].x0) / 2) - 1)), sx - 3].filter((x) => x >= 0);
    for (const x of xs) paint(x, row.y0 - 1, C.PATH, row.walk - row.y0 + 1, "gravel");
  }
  // ---------- the buildings copied in ----------
  const areas = [], containers = [], lockedDoors = [], stairs = [], runs = [];
  const sceneList = [], sceneBodies = [], scenePiles = [], scenePieces = [];
  let cid = 1;
  for (const B of built) {
    const m = B.m, R = m.building, base = areas.length;
    const tx = (x) => B.x0 + (x - R.x0), ty = (yy) => B.y0 + (yy - R.y0);
    B.rect = { x0: B.x0, y0: B.y0, w: R.w, h: R.h };
    (m.floors || [{ cells: m.cells }]).forEach((F, g) => {
      const dst = floors[g].cells, cars = new Map();
      for (let yy = R.y0; yy < R.y0 + R.h; yy++) for (let x = R.x0; x < R.x0 + R.w; x++) {
        const c = { ...F.cells[yy * m.w + x] }, X = tx(x), Y = ty(yy);
        if (c.pc) c.pc += 10000 * (B.k + 1); // roomlayout.js: a piece's number, the campus's own
        if (c.car) { c.car = { ...c.car }; const e = cars.get(c.car.id) || { x: X, y: Y, list: [] }; e.x = Math.min(e.x, X); e.y = Math.min(e.y, Y); e.list.push(c.car); cars.set(c.car.id, e); }
        dst[I(X, Y)] = c;
      }
      for (const e of cars.values()) for (const car of e.list) car.id = I(e.x, e.y) + 1;
    });
    for (const a of m.rooms) {
      if (a.outdoor) continue;
      areas.push({ ...a, x0: tx(a.x0), y0: ty(a.y0), id: base + a.id, name: `${a.name}, ${B.name}`, doors: (a.doors || []).map(([x, yy]) => [tx(x), ty(yy)]), house: B.k });
    }
    for (const c of m.containers) {
      const area = areas[base + c.area];
      const what = String(c.label || "").split(": ").slice(1).join(": ") || c.kind;
      containers.push({ ...c, id: cid++, x: tx(c.x), y: ty(c.y), area: base + c.area, house: B.k, label: `${area ? area.name : B.name}: ${what}` });
    }
    for (const d of m.lockedDoors) lockedDoors.push({ ...d, x: tx(d.x), y: ty(d.y), area: d.area == null ? null : base + d.area });
    for (const [x, yy] of m.stairs || []) stairs.push([tx(x), ty(yy)]);
    for (const r of m.runs || []) runs.push({ ...r, x: tx(r.x), y: ty(r.y), house: B.k });
    // Its scenes (interiorscenes.js, rolled on its own map): moved with it.
    const S = m.scenes;
    if (S) {
      for (const s of S.list) sceneList.push({ ...s, x: tx(s.x), y: ty(s.y), room: s.room == null ? null : base + s.room, house: B.k });
      for (const o of S.bodies) sceneBodies.push({ ...o, x: tx(o.x), y: ty(o.y) });
      for (const p of S.piles) scenePiles.push({ ...p, x: tx(p.x), y: ty(p.y), area: p.area == null ? null : base + p.area });
      for (const p of S.pieces) scenePieces.push({ ...p, x: tx(p.x), y: ty(p.y) });
    }
    // The ring round the building stays clear; a path from its front door (and a roller door's drive) to the promenade.
    for (let yy = B.y0 - 1; yy <= B.y0 + R.h; yy++) for (let x = B.x0 - 1; x <= B.x0 + R.w; x++) if (inside(x, yy) && !(x >= B.x0 && x < B.x0 + R.w && yy >= B.y0 && yy < B.y0 + R.h)) keep[I(x, yy)] = 1;
    const row = rows.find((r) => r.list.includes(B));
    const toWalk = (x, yy) => { for (let q = yy + 1; q < row.walk && inside(x, q); q++) { keep[I(x, q)] = 1; if (cells[I(x, q)].f === "grass") cells[I(x, q)].f = "gravel"; } };
    for (const [x, yy] of (m.front && m.front.cells) || []) toWalk(tx(x), ty(yy));
    for (const ex of m.exits || []) if (ex.side === "front") for (const [x, yy] of ex.cells || []) toWalk(tx(x), ty(yy));
    B.front = m.front ? { x: tx(m.front.x), y: ty(m.front.y) } : null;
    // A plaza before the front door (paved, kept clear).
    if (B.front) paint(B.front.x - 2, B.y0 + R.h + 1, 5, Math.max(0, row.walk - (B.y0 + R.h + 1)), "gravel");
  }
  // ---------- the links between joined buildings ----------
  const links = [];
  for (const row of rows) for (let j = 0; j + 1 < row.list.length; j++) {
    const A = row.list[j], Bb = row.list[j + 1];
    if (!A.link) continue;
    const L = makeLink(A, Bb, A.link, { W, floors, areas, rng, I, keep, seed: seedOf(state, "link", tileId, option.id, A.k) });
    if (L) links.push(L); else A.link = null;
  }
  // The enclosed courtyards: the ground between two joined buildings in front of their link, hedged along the
  // promenade with a gate in the middle.
  /** @type {any[]} */
  const grounds = [];
  for (const L of links) {
    const A = built[L.a], Bb = built[L.b], row = rows.find((r) => r.list.includes(A));
    const x0 = A.x0 + A.bw + 1, x1 = Bb.x0 - 2, y0 = L.y1 + 1, y1 = row.walk - 1;
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    for (let yy = y0; yy <= y1; yy++) for (let x = x0; x <= x1; x++) if (cells[I(x, yy)].f === "gravel" && !keep[I(x, yy)]) cells[I(x, yy)].f = "grass";
    const gate = Math.floor((x0 + x1) / 2);
    for (let x = x0; x <= x1; x++) if (Math.abs(x - gate) > 1 && !keep[I(x, y1)]) { const c = cells[I(x, y1)]; if (c.k === "open") { c.k = "fence"; c.hedge = true; } }
    grounds.push({ kind: "courtyard", name: `Courtyard, ${A.name}`, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }
  // ---------- the strips: quads, the dorms' yards, the fields, the lots ----------
  const lotsAreas = [];
  const scatterOK = (x, yy, w = 1, h = 1) => {
    for (let q = yy - 1; q <= yy + h; q++) for (let p = x - 1; p <= x + w; p++) { if (!inside(p, q)) return false; const c = cells[I(p, q)]; if (c.k !== "open" || c.f === "floor") return false; if (p >= x && p < x + w && q >= yy && q < yy + h && keep[I(p, q)]) return false; }
    return true;
  };
  const put = (x, yy, k, w = 1, h = 1) => { if (!scatterOK(x, yy, w, h)) return false; for (let q = yy; q < yy + h; q++) for (let p = x; p < x + w; p++) { cells[I(p, q)].k = k; keep[I(p, q)] = 1; } return true; };
  let quadNo = 0;
  for (const s of strips) {
    if (!s) continue;
    const x0 = C.EDGE, x1 = sx - 2, w = x1 - x0 + 1;
    if (s.kind === "quad" || s.kind === "yard") {
      quadNo += s.kind === "quad" ? 1 : 0;
      const name = s.kind === "yard" ? "Residence yard" : quadNo === 1 ? "Main quad" : ["", "", "North quad", "South quad", "East quad", "West quad"][quadNo] || `Quad ${quadNo}`;
      grounds.push({ kind: s.kind, name, x0, y0: s.y0, w, h: s.h });
      const midY = s.y0 + Math.floor(s.h / 2) - 1, midX = x0 + Math.floor(w / 2) - 1;
      paint(x0, midY, w, C.PATH, "gravel"); // the cross paths
      if (s.kind === "quad") {
        for (const px of [midX, x0 + Math.floor(w / 4), x0 + Math.floor((3 * w) / 4)]) paint(px, s.y0, C.PATH, s.h, "gravel");
        // The centre: a fountain (a 2 × 2 basin) or a statue on its plinth, at the crossing of the paths.
        const cx = midX, cy = midY;
        for (const [p, q] of [[cx, cy], [cx, cy + 1], [cx + 1, cy], [cx + 1, cy + 1]]) keep[I(p, q)] = 0;
        const fountain = rng.chance(0.5);
        if (fountain) { for (const [p, q] of [[cx, cy], [cx, cy + 1], [cx + 1, cy], [cx + 1, cy + 1]]) { const c = cells[I(p, q)]; c.k = "fountain"; c.f = "gravel"; keep[I(p, q)] = 1; } }
        else { const c = cells[I(cx, cy)]; c.k = "statue"; c.f = "gravel"; keep[I(cx, cy)] = 1; }
        for (let p = cx - 3; p <= cx + 4; p++) for (let q = cy - 3; q <= cy + 4; q++) if (inside(p, q) && cells[I(p, q)].k === "open") { cells[I(p, q)].f = "gravel"; keep[I(p, q)] = 1; } // the plaza round it
      }
      // Trees round the lawns, benches along the paths.
      const nT = Math.round(w * s.h * C.TREES), nB = Math.max(2, Math.round(w * s.h * C.BENCH));
      for (let t = 0, n = 0; t < nT * 6 && n < nT; t++) { const p = rng.int(x0, x1), q = rng.int(s.y0, s.y0 + s.h - 1); if (cells[I(p, q)].f === "grass" && put(p, q, "tree")) n++; }
      for (let t = 0, n = 0; t < nB * 12 && n < nB; t++) {
        const p = rng.int(x0, x1 - 1), q = rng.int(s.y0, s.y0 + s.h - 1);
        const nearPath = (cells[I(p, q - 1)] || {}).f === "gravel" || (cells[I(p, q + 1)] || {}).f === "gravel";
        if (!nearPath || cells[I(p, q)].f !== "grass" || cells[I(p + 1, q)].f !== "grass") continue;
        if (put(p, q, "campusbench", 2, 1)) n++;
      }
      s.quad = grounds[grounds.length - 1];
    } else if (s.kind === "south") {
      // The fields (a sports field inside its running track, a stadium stand at a state university) to the west, the
      // parking lots to the east.
      let lx0 = x0;
      if (s.field) {
        const F = C.FIELD, fx = x0 + 2, fy = s.y0 + 2 + (K.stadium ? 3 : 0);
        paint(fx, fy, F.w, F.h, "track", false);
        paint(fx + F.track, fy + F.track, F.w - 2 * F.track, F.h - 2 * F.track, "grass", false);
        grounds.push({ kind: "field", name: K.stadium ? "Stadium" : "Sports field", x0: fx, y0: fy, w: F.w, h: F.h });
        if (K.stadium) for (let p = fx + 4; p + 1 < fx + F.w - 4; p += 3) { keep[I(p, fy - 3)] = 0; put(p, fy - 3, "bleachers", 2, 2); } // the stand along the north side
        lx0 = fx + F.w + 4;
      }
      // The lots: rows of stalls facing the aisles, cars left in some (each a container to search).
      const nl = K.lots, lw = Math.floor((x1 - lx0 + 1 - (nl - 1) * 4) / nl);
      for (let l = 0; l < nl && lw >= 16; l++) {
        const ax0 = lx0 + l * (lw + 4), ay0 = s.y0 + 1, ah = s.h - 2;
        paint(ax0, ay0, lw, ah, "road", false);
        const lot = { id: -1, type: "wreck", name: nl > 1 ? `Parking lot ${String.fromCharCode(65 + l)}` : "Parking lot", outdoor: true, f: 0, x0: ax0, y0: ay0, w: lw, h: ah, lot: true };
        lotsAreas.push(lot);
        grounds.push({ kind: "lot", name: lot.name, x0: ax0, y0: ay0, w: lw, h: ah });
        // An aisle round the lot's edge and across it every other stall row (kept clear).
        for (let p = ax0; p < ax0 + lw; p++) for (const q of [ay0, ay0 + ah - 1]) keep[I(p, q)] = 1;
        for (let q = ay0; q < ay0 + ah; q++) for (const p of [ax0, ax0 + lw - 1]) keep[I(p, q)] = 1;
      }
    }
  }
  // Cars left in the lots' stalls (placeCar keeps a free ring round each, so nothing is cut off): CAMPUS.CARS of the
  // stalls, each a container to search.
  lotsAreas.forEach((lot, l) => { lot.id = areas.length + l; });
  for (const lot of lotsAreas) {
    for (let q = lot.y0 + 1; q + 4 <= lot.y0 + lot.h; q += 5) for (let p = lot.x0 + 1; p + 2 <= lot.x0 + lot.w; p += CAMPUS.STALL) {
      if (!rng.chance(CAMPUS.CARS)) continue;
      const rect = placeCar(cells, W, H, p, q, "y", rng.pick(CAR_LEN.car), "car", (x, yy) => cells[I(x, yy)].k === "open" && !keep[I(x, yy)], rng.int(0, 1e6));
      if (!rect) continue;
      for (let yy = rect.y0; yy < rect.y0 + rect.h; yy++) for (let x = rect.x0; x < rect.x0 + rect.w; x++) keep[I(x, yy)] = 1;
      containers.push({ id: cid++, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, f: 0, area: lot.id, kind: "car", searched: false, label: `${lot.name}: car` });
    }
  }
  for (const lot of lotsAreas) areas.push(lot);
  // ---------- the ways out ----------
  const Z = 3, zy = roadY + 1;
  const zones = [
    { x0: 0, y0: zy, w: Z, h: Z, side: "west", exit: "west", name: "West end of the campus road", vehicle: false },
    { x0: W - Z, y0: zy, w: Z, h: Z, side: "east", exit: "east", name: "East end of the campus road", vehicle: false },
    { x0: Math.floor(W / 2) - 1, y0: 0, w: Z, h: Z, side: "north", exit: "north", name: "North edge of the campus", vehicle: false },
    { x0: 0, y0: Math.floor(roadY / 2), w: Z, h: Z, side: "west", exit: "west", name: "West edge of the campus", vehicle: false },
    { x0: W - Z, y0: Math.floor(roadY / 2), w: Z, h: Z, side: "east", exit: "east", name: "East edge of the campus", vehicle: false },
  ];
  for (const lot of lotsAreas) zones.push({ x0: lot.x0 + Math.floor(lot.w / 2) - 1, y0: H - Z, w: Z, h: Z, side: "south", exit: "south", name: `South of ${lot.name.toLowerCase()}`, vehicle: false, lot: true });
  for (const z of zones) for (let q = z.y0 - 1; q <= z.y0 + z.h; q++) for (let p = z.x0 - 1; p <= z.x0 + z.w; p++) if (inside(p, q)) { keep[I(p, q)] = 1; const c = cells[I(p, q)]; if (c.k === "tree" || c.k === "fence") { c.k = "open"; delete c.hedge; } }
  // A lot's way out reaches the map's south edge across the road's verge (paved).
  for (const z of zones.filter((q) => q.lot)) paint(z.x0, roadY + C.ROAD, Z, H - roadY - C.ROAD, "gravel");
  // ---------- the quarantine tent on a quad (an outdoor scene) ----------
  const qrng = new Rng(seedOf(state, "quarantine", tileId, option.id) || 1);
  const quads = grounds.filter((g) => g.kind === "quad");
  if (quads.length && qrng.chance(C.QUARANTINE)) {
    const q = qrng.pick(quads), tw = 7, th = 5;
    for (let t = 0; t < 40; t++) {
      const p = qrng.int(q.x0 + 2, q.x0 + q.w - tw - 2), r = qrng.int(q.y0 + 1, q.y0 + q.h - th - 1);
      let ok = true;
      for (let yy = r - 1; yy <= r + th && ok; yy++) for (let x = p - 1; x <= p + tw && ok; x++) if (!inside(x, yy) || cells[I(x, yy)].k !== "open" || keep[I(x, yy)] && cells[I(x, yy)].f !== "grass") ok = false;
      if (!ok) continue;
      // The tent's floor (canvas over the lawn), cots in two rows, the bodies of those it was for.
      for (let yy = r; yy < r + th; yy++) for (let x = p; x < p + tw; x++) { const c = cells[I(x, yy)]; c.k = yy === r || yy === r + th - 1 ? "tent" : "open"; c.f = "dirt"; keep[I(x, yy)] = 1; }
      const cots = [];
      for (let x = p + 1; x < p + tw - 1; x += 2) for (const yy of [r + 1, r + 3]) { const c = cells[I(x, yy)]; c.k = "cot"; cots.push([x, yy]); scenePieces.push({ f: 0, x, y: yy, k: "cot" }); }
      const nb = qrng.int(3, 6);
      let made = 0;
      for (const [x, yy] of qrng.shuffle(cots)) { if (made >= nb) break; const by = yy === r + 1 ? r + 2 : r + 2; if (cells[I(x, by)].k !== "open") continue; sceneBodies.push({ f: 0, x, y: by, human: true, quiet: true, r: qrng.next(), weapon: null, patient: true }); made++; }
      sceneList.push({ kind: "quarantine", f: 0, room: null, x: p + 3, y: r + 2, text: `A quarantine tent on the ${q.name.toLowerCase()}: cots in rows under the canvas, and ${made} who were brought here and never left.`, seen: false });
      q.quarantine = true;
      break;
    }
  }
  // ---------- the team's vehicle at the west end of the road ----------
  let vehicle = null;
  if (withVehicle) {
    const z = zones[0]; z.vehicle = true;
    vehicle = placeVehicle(cells, W, H, z, withVehicle, (x, yy) => inside(x, yy) && cells[I(x, yy)].k === "open");
    if (!vehicle) { const c = cells[I(z.x0 + 1, z.y0 + 1)]; c.k = "vehicle"; c.f = "road"; }
  }
  // ---------- the result (as streetMap's: plan.houses are the buildings) ----------
  const zoneExits = () => zones.slice(1).map((z, j) => ({ side: z.side, name: z.name, x: z.x0 + 1, y: z.y0 + 1, cells: [], locked: null, roller: false, zone: j + 1 }));
  const houses = built.map((B) => ({ k: B.k, key: B.key, name: B.name, row: rows.findIndex((r) => r.list.includes(B)), ...B.rect, storeys: B.storeys, front: B.front, rooms: areas.filter((a) => a.house === B.k).map((a) => a.id) }));
  const scenes = sceneList.length ? { list: sceneList.map((s, i) => ({ ...s, id: i + 1 })), bodies: sceneBodies, piles: scenePiles, pieces: scenePieces, seed: seedOf(state, "scenebattle", tileId, option.id) % 2147483646 + 1 } : null;
  const plan = {
    key: option.key, id: option.id, name: option.name, w: W, h: H, street: true, campus: true, kind, kindName: K.name,
    building: built[0].rect, buildings: built.map((B) => ({ ...B.rect })), houses, links: links.map((L) => ({ ...L })), grounds,
    tall: true, storeys, stairs: stairs.map((s) => s.slice()), runs: runs.map((r) => ({ ...r })),
    rooms: areas.filter((a) => !a.outdoor).map((a) => ({ id: a.id, f: a.f, name: a.name, role: a.role, type: a.type, x0: a.x0, y0: a.y0, w: a.w, h: a.h, locked: a.locked, up: a.up, hub: a.hub, entry: a.entry, house: a.house, ...(a.civic ? { civic: a.civic } : {}), ...(a.campus ? { campus: a.campus } : {}) })),
    front: built[0].front, exits: zoneExits(),
  };
  return { w: W, h: H, cells, rooms: areas, containers, zones, vehicle, exits: zoneExits(), front: built[0].front, lockedDoors, plan, building: plan.building, buildings: plan.buildings, floors, stairs, runs, storeys, street: true, campus: true, scenes };
}

// The rows: the buildings grouped by zone (north to south), packed left to right within the row's width, a joined pair
// (CAMPUS.LINKS) a link's length apart, else a gap; the strip behind each row (a yard between two rows of dorms, a quad
// after the last dorms and after each row of teaching buildings, the fields and the lots south of the last row). H: the
// map's depth it all needs.
function planRows(rng, built, kind, W, AVAIL) {
  const C = CAMPUS, K = C.KINDS[kind], avail = AVAIL(W);
  /** @type {any[]} */
  const rows = [];
  for (const zone of [0, 1, 2]) {
    let row = null;
    for (const B of built.filter((b) => b.zone === zone)) {
      B.link = null;
      const gap = rng.int(C.GAP[0], C.GAP[1]);
      if (!row || row.used + gap + B.bw > avail) { row = { zone, list: [], gaps: [], used: 0, D: 0 }; rows.push(row); }
      if (row.list.length) { row.gaps.push(gap); row.used += gap; }
      row.list.push(B); row.used += B.bw; row.D = Math.max(row.D, B.bh);
    }
  }
  // Joined pairs: neighbours in a row on the campus's dice; at least one pair (the campus has a connected pair) and never
  // every building joined (it has one standing alone).
  const pairs = [];
  for (const row of rows) for (let j = 0; j + 1 < row.list.length; j++) pairs.push([row, j]);
  for (const [row, j] of pairs) if (rng.chance(C.LINKS[kind]) && !row.list[j - 1]?.link) setLink(rng, row, j);
  if (pairs.length && !pairs.some(([row, j]) => row.list[j].link)) setLink(rng, pairs[0][0], pairs[0][1]);
  const joined = new Set();
  for (const row of rows) row.list.forEach((B, j) => { if (B.link) { joined.add(B); joined.add(row.list[j + 1]); } });
  if (joined.size >= built.length) { const [row, j] = pairs.filter(([r, i]) => r.list[i].link).at(-1); row.list[j].link = null; row.gaps[j] = rng.int(C.GAP[0], C.GAP[1]); }
  for (const row of rows) row.used = row.list.reduce((a, B) => a + B.bw, 0) + row.gaps.reduce((a, g) => a + g, 0);
  // The strips behind the rows.
  /** @type {any[]} */
  const strips = rows.map((row, i) => {
    const next = rows[i + 1];
    if (!next) return { kind: "south", h: Math.max(rng.int(C.LOT[0], C.LOT[1]), K.field ? C.FIELD.h + (K.stadium ? 7 : 4) : 0), field: K.field };
    if (row.zone === 0 && next.zone === 0) return { kind: "yard", h: C.YARD };
    return { kind: "quad", h: rng.int(C.QUAD[0], Math.round((C.QUAD[0] + C.QUAD[1]) / 2)) };
  });
  if (!rows.length) return { rows, strips, H: 0 };
  const H = C.EDGE + rows.reduce((a, r) => a + r.D + C.FRONT + C.PATH, 0) + strips.reduce((a, s) => a + s.h, 0) + C.ROAD + 4;
  return { rows, strips, H };
}
function setLink(rng, row, j) {
  const A = row.list[j], B = row.list[j + 1], C = CAMPUS;
  const up = Math.min(A.storeys, B.storeys);
  const type = up >= 2 && rng.chance(C.BRIDGE) ? "bridge" : rng.chance(C.WALKWAY) ? "walkway" : "corridor";
  A.link = { type, f: type === "bridge" ? rng.int(1, up - 1) : 0 };
  row.gaps[j] = rng.int(C.LINK[0], C.LINK[1]);
}
// A link between A (west) and B (east) on floor link.f: a row band within both buildings' depths, toward their backs,
// where a door fits in each one's side wall (a room's floor inside it); its cells across the gap, the doors, a room of
// its own in areas. Returns { type, f, a, b, x0, y0, w, h, y1 (the band's south row), area, doors } or null.
function makeLink(A, B, link, ctx) {
  const { W, floors, areas, I, keep } = ctx;
  const g = link.f, F = floors[g] && floors[g].cells;
  if (!F) return null;
  const ax = A.x0 + A.bw - 1, bx = B.x0; // the side walls
  const top = Math.max(A.y0, B.y0) + 2, bot = Math.min(A.y0 + A.bh, B.y0 + B.bh) - 3;
  const roomFloor = (x, y) => { const c = F[I(x, y)]; return c && c.k === "open" && c.f === "floor" && !c.landing; };
  const wallish = (x, y) => { const c = F[I(x, y)]; return c && (c.k === "wall" || c.k === "window"); };
  const walls = link.type !== "walkway";
  for (let y = top + (walls ? 1 : 0); y <= bot - (walls ? 1 : 0); y++) {
    const dy = [y, y + 1].find((q) => wallish(ax, q) && wallish(bx, q) && roomFloor(ax - 1, q) && roomFloor(bx + 1, q));
    if (dy == null) continue;
    // Clear across the gap on the ground (a walkway, a corridor: nothing already there but lawn and paths).
    let clear = true;
    for (let x = ax + 1; x < bx && clear; x++) for (let q = y - (walls ? 1 : 0); q <= y + 1 + (walls ? 1 : 0); q++) { const c = F[I(x, q)]; if (g === 0 ? c.k !== "open" || c.f === "floor" : c.k !== "void") clear = false; }
    if (!clear) continue;
    const name = link.type === "bridge" ? "Glass bridge" : link.type === "walkway" ? "Covered walkway" : "Connecting corridor";
    const id = areas.length;
    for (let x = ax + 1; x < bx; x++) {
      for (const q of [y, y + 1]) { F[I(x, q)] = { k: "open", f: "floor", fl: link.type === "corridor" ? "lino" : "conc", ...(link.type === "walkway" ? { canopy: true } : {}), ...(link.type === "bridge" ? { bridge: true } : {}) }; keep[I(x, q)] = 1; }
      if (walls) for (const q of [y - 1, y + 2]) {
        const glass = link.type === "bridge" || (x - ax) % 3 === 0;
        F[I(x, q)] = glass ? { k: "window", f: "floor", win: link.type === "bridge" ? { open: false, lock: "fixed", known: true } : rollWin(ctx.seed, null, g, x, q) } : { k: "wall", f: "floor" };
        keep[I(x, q)] = 1;
      }
    }
    // A corridor's side door in the middle of its south wall (the lawn either side stays joined up).
    const doors = [[ax, dy], [bx, dy]];
    if (link.type === "corridor") { const mx = Math.floor((ax + bx) / 2); doors.push([mx, y + 2]); }
    const dk = link.type === "corridor" ? "steel" : "glass";
    for (const [x, q] of doors) {
      const c = F[I(x, q)];
      c.k = "idoor"; c.dk = dk; c.hp = c.mhp = DOOR_KINDS[dk].hp; delete c.win;
      if (DOOR_KINDS[dk].see) delete c.t;
    }
    // The rooms the doors open into know them (scenes, the occupants read area.doors).
    for (const [x, q, Bd] of [[ax - 1, dy, A], [bx + 1, dy, B]]) {
      const r = areas.find((a) => a.house === Bd.k && (a.f || 0) === g && !a.outdoor && x > a.x0 && x < a.x0 + a.w - 1 && q > a.y0 && q < a.y0 + a.h - 1);
      if (r) r.doors = [...(r.doors || []), x === ax - 1 ? [ax, dy] : [bx, dy]];
    }
    const area = { id, f: g, type: null, role: "corridor", name: `${name}: ${A.name} – ${B.name}`, x0: ax, y0: walls ? y - 1 : y, w: bx - ax + 1, h: walls ? 4 : 2, doors, hub: true, locked: null, up: false, entry: false, link: link.type, house: null };
    areas.push(area);
    return { type: link.type, f: g, a: A.k, b: B.k, x0: area.x0, y0: area.y0, w: area.w, h: area.h, y1: walls ? y + 2 : y + 1, area: id, doors };
  }
  return null;
}

// ---------- in the raid ----------
// The dead on a campus (buildingmaps.js placeInterior for a campus map): the site's roster × CAMPUS.DEAD_AREA's scale,
// spread over the buildings by their floor area × CAMPUS.DENSE (a dorm and the dining hall densest) and over the open
// ground (CAMPUS.OUTSIDE), on every floor of a building by its floors' share; none in an extraction zone or within 8 of
// the way in. Returns how many were placed.
export function campusDead(state, b, map, g, pod0 = 0) {
  const rng = state.rng, R = b.raid, W = b.w, H = b.h, P = map.plan;
  const C = CAMPUS;
  const area = P.houses.reduce((a, h) => a + h.w * h.h, 0);
  const n = Math.min(C.DEAD_MAX, Math.max(1, Math.round((g.count || 0) * Math.max(1, Math.pow(area / C.DEAD_AREA, C.DEAD_EXP)))));
  const zl = siteList(rng, g.mix, n);
  const entry = R.zones[0], ex = entry.x0 + 1, ey = entry.y0 + 1;
  const inZone = (x, y) => R.zones.some((z) => x >= z.x0 - 1 && x <= z.x0 + z.w && y >= z.y0 - 1 && y <= z.y0 + z.h);
  const floorsN = b.floors ? b.floors.length : 1;
  const cellsOf = (f) => (b.floors ? b.floors[f].cells : b.cells);
  const reachOf = (f) => (b.floors ? b.floors[f].reach : b.reach);
  const taken = new Set(b.units.filter((u) => !u.dead).map((u) => `${u.f || 0}:${u.x},${u.y}`));
  const okAt = (f, x, y) => { const c = cellsOf(f)[y * W + x], r = reachOf(f); return !!c && CELL[c.k] && CELL[c.k].walk && !["stairs", "ladder", "idoor", "odoor", "door"].includes(c.k) && (!r || r[y * W + x]) && !taken.has(`${f}:${x},${y}`); };
  // The buildings' weights and the open ground's share.
  const H2 = P.houses.map((h) => ({ h, w: h.w * h.h * (C.DENSE[h.key] ?? 1) }));
  const tot = H2.reduce((a, q) => a + q.w, 0);
  let placed = 0, zn = b.units.filter((u) => u.kind === "zombie").length;
  for (let i = 0; i < n; i++) {
    let f = 0, c = null;
    if (rng.chance(C.OUTSIDE)) {
      for (let t = 0; t < 30 && !c; t++) {
        const x = rng.int(1, W - 2), y = rng.int(1, H - 2), cl = cellsOf(0)[y * W + x];
        if (cl.f === "floor" || inZone(x, y) || Math.hypot(x - ex, y - ey) < 8) continue;
        if (okAt(0, x, y)) c = [x, y];
      }
    } else {
      let r = rng.next() * tot, pick = H2[0];
      for (const q of H2) { r -= q.w; if (r <= 0) { pick = q; break; } }
      const h = pick.h;
      f = h.storeys > 1 && !rng.chance(0.45) ? rng.int(1, Math.min(h.storeys, floorsN) - 1) : 0;
      for (let t = 0; t < 30 && !c; t++) {
        const x = rng.int(h.x0 + 1, h.x0 + h.w - 2), y = rng.int(h.y0 + 1, h.y0 + h.h - 2);
        if (okAt(f, x, y) && cellsOf(f)[y * W + x].f === "floor") c = [x, y];
      }
    }
    if (!c) continue;
    if (b.floors && (b.floor || 0) !== f) setFloor(b, f);
    const u = enemyUnit(b, rng, "zombies", g.power, ++zn);
    if (zl[i]) applyZType(u, zl[i], false, g.power);
    u.aware = false; u.pod = pod0 + placed;
    u.x = c[0]; u.y = c[1]; u.home = [c[0], c[1]];
    b.units.push(u);
    taken.add(`${f}:${c[0]},${c[1]}`);
    placed++;
  }
  if (b.floors && (b.floor || 0) !== 0) setFloor(b, 0);
  return placed;
}
// The area Heat's clock reads on a campus (combat.js: raidHeatRate on these dims): the buildings your people have
// searched in (a container opened there) or stand in now, and a raid map's worth of ground round them; not the map's.
export function campusHeatDims(b) {
  const R = b.raid, P = R && R.plan;
  if (!P || !P.campus) return [b.w, b.h];
  const ks = new Set();
  for (const c of R.containers) if (c.searched && c.house != null) ks.add(c.house);
  for (const u of b.units) if (u.side === "player" && !u.dead) { const h = P.houses.find((q) => u.x >= q.x0 && u.x < q.x0 + q.w && u.y >= q.y0 && u.y < q.y0 + q.h); if (h) ks.add(h.k); }
  const a = P.houses.filter((h) => ks.has(h.k)).reduce((s, h) => s + (h.w + 10) * (h.h + 10), 0);
  return [Math.max(40 * 30, a), 1];
}
// What a container holds on a campus, as a share of the usual (combat.js: raidLootShare): its building's own map's
// (the building and a margin round it), the open ground's a big raid map's.
export function campusLootShare(b, box) {
  const P = b.raid && b.raid.plan;
  const h = P && P.houses && box && box.house != null ? P.houses.find((q) => q.k === box.house) : null;
  return h ? raidLootShare(h.w + 10, h.h + 10) : raidLootShare(b.w, b.h);
}
export const campusHeatRate = (b) => { const [w, h] = campusHeatDims(b); return raidHeatRate(w, h); };
// The opening lines: the campus, its buildings (the ones your side has been into, the ones that look ransacked), the
// links, the ways out.
export function campusIntro(b) {
  const R = b.raid, P = R.plan;
  const names = P.houses.map((h) => h.name);
  const been = P.houses.filter((h) => R.containers.some((c) => c.house === h.k && c.mine)).map((h) => h.name);
  const robbed = P.houses.filter((h) => { const cs = R.containers.filter((c) => c.house === h.k); return cs.length && cs.every((c) => c.ransacked && !c.mine); }).map((h) => h.name);
  const links = (P.links || []).map((L) => `${L.type === "bridge" ? `a glass bridge on floor ${L.f + 1}` : L.type === "walkway" ? "a covered walkway" : "a corridor"} joins ${P.houses[L.a].name} and ${P.houses[L.b].name}`);
  const ways = R.zones.map((z) => (z.name || z.side).toLowerCase());
  return `${P.kindName}: ${names.length} buildings (${names.join(", ")}) round ${(P.grounds || []).filter((g) => g.kind === "quad").length || "no"} quads.${links.length ? ` ${links.join("; ").replace(/^./, (c) => c.toUpperCase())}.` : ""} Ways out: ${ways.join(", ")}.${been.length ? ` Your people have been through ${been.join(", ")} before: what you left there is as you left it.` : ""}${robbed.length ? ` ${robbed.join(", ")} ${robbed.length === 1 ? "looks" : "look"} ransacked.` : ""} The stairs are inside each building; peek through a door (K) before you go in, shut doors behind you (Shift+E).`;
}
// How many buildings a campus at this tile has (poicont.js poiHouses: the headless search goes through it a building
// at a time). Builds no map: the list's own dice.
const countCache = new Map();
export function campusBuildings(state, tile, option = { id: "campus" }) {
  const key = `${state.seed}:${tile.id}:${option.id}:${campusKind(state, tile)}`;
  if (!countCache.has(key)) { if (countCache.size > 64) countCache.clear(); countCache.set(key, campusPlan(state, tile.id, option).built.length); }
  return countCache.get(key);
}
