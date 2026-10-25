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
import { BUILDINGS, assemble, DOOR_KINDS } from "./buildingmaps.js"; // call-time only (buildingmaps.js imports this module)
import { CELL, enemyUnit, setFloor } from "./combat.js";
import { compoundGrid, placeBuilding, link, guard, parkingLot, compoundResult, compoundVehicle } from "./compound.js"; // #30's shared multi-building code
import { raidLootShare, raidHeatRate } from "./battlesize.js";
import { legacyRooms } from "./worldcfg.js";
import { rollScenes, sceneRng } from "./interiorscenes.js";
import { applyZType, siteList } from "./zombietypes.js";
import { CAMPUS_NAMES } from "./campuslayout.js";
import { placeFolk } from "./floorfolk.js"; // students holed up in a dorm (the city crawl's survivors upstairs)

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
  LOT: [24, 28],       // a parking lot's depth (compound.js parkingLot: two double rows of bays and their aisles)
  FIELD: { w: 64, h: 42, track: 3 }, // the sports field with its running track round it
  TREES: 0.012,        // trees on a quad, a share of its cells
  BENCH: 0.004,        // benches likewise
  DENSE: { dorm: 1.7, dininghall: 1.6, studentunion: 1.2, parkgarage: 0.6, maintenance: 0.6, security: 0.8 }, // the dead per cell of a building by kind (1 else)
  OUTSIDE: 0.3,        // the share of the dead on the open ground
  DEAD_AREA: 2500,     // the site's roster × (the campus's ground-floor building area / this) ^ DEAD_EXP …
  DEAD_EXP: 0.75,
  DEAD_MAX: 100,       // … at most this many of the dead in all (the issue's turn target: 100 dead)
  QUARANTINE: 0.5,     // a quad's quarantine tent (an outdoor scene) on these dice
  SURVIVORS: 0.45,     // students holed up in a dorm (campusFolk: floorfolk.js's survivors upstairs) on these dice
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
 * world seed, the tile and the option id). Built on compound.js (#30's shared multi-building code): the grid, the
 * buildings copied in, the links between them, the guard over the dressing, the parking lots, the result.
 * @param {any} state @param {number} tileId @param {{ id: string, key: string, name: string }} option @param {any} withVehicle
 */
export function campusMap(state, tileId, option, withVehicle) {
  const CP = CAMPUS;
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
  const W = MAXW, H = Math.min(CP.MAX, Math.max(layout.H, Math.min(MAXH, layout.H + 40)));
  // Stretch the quads to the map's depth (a deeper map: roomier quads, never past their range).
  let spare = H - layout.H;
  for (const st of strips) if (spare > 0 && st.kind === "quad") { const add = Math.min(spare, CP.QUAD[1] - st.h); if (add > 0) { st.h += add; spare -= add; } }
  // The rows and strips at their y, top to bottom.
  let y = CP.EDGE;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    row.y0 = y; y += row.D + CP.FRONT; row.walk = y; y += CP.PATH;
    if (strips[i]) { strips[i].y0 = y; y += strips[i].h; }
  }
  const roadY = H - CP.ROAD - 2; // the campus road's top row
  // Across: the buildings left to right, the slack shared out as wider gaps (a joined pair keeps its link's length).
  for (const row of rows) {
    const used = row.list.reduce((a, B) => a + B.bw, 0) + row.gaps.reduce((a, g) => a + g, 0);
    const extra = Math.max(0, AVAIL(W) - used), free = row.gaps.map((g, j) => !row.list[j].link);
    const slots = free.filter(Boolean).length + 2, each = Math.min(14, Math.floor(extra / slots));
    let x = CP.EDGE + 1 + Math.floor((extra - each * (slots - 2)) / 2);
    row.list.forEach((B, j) => { B.x0 = x; B.y0 = row.y0 + row.D - B.bh; x += B.bw + (j < row.gaps.length ? row.gaps[j] + (free[j] ? each : 0) : 0); });
  }
  const storeys = Math.max(...built.map((B) => B.storeys));
  const C = compoundGrid(W, H, storeys, () => "grass");
  const cells = C.cells, keep = C.keep;
  const I = (x, yy) => yy * W + x;
  const inside = (x, yy) => x >= 0 && yy >= 0 && x < W && yy < H;
  const paint = (x0, y0, w, h, f, mark = true) => { for (let yy = y0; yy < y0 + h; yy++) for (let x = x0; x < x0 + w; x++) if (inside(x, yy)) { cells[I(x, yy)].f = f; if (mark) keep[I(x, yy)] = 1; } };
  // ---------- the roads and the paths ----------
  paint(0, roadY, W, CP.ROAD, "road");
  paint(0, roadY - 1, W, 1, "gravel"); paint(0, roadY + CP.ROAD, W, 1, "gravel"); // its sidewalks
  const sx = W - CP.EDGE - CP.SERVICE + 1; // the service road down the east side
  paint(sx, 0, CP.SERVICE, roadY, "road");
  for (const row of rows) {
    paint(CP.EDGE - 2, row.walk, sx - CP.EDGE + 2, CP.PATH, "gravel"); // the promenade along the row's fronts
    // Paths north between the buildings standing apart (and past the row's ends) to the strip behind the row.
    const xs = [CP.EDGE - 1, ...row.list.slice(0, -1).map((B, j) => (B.link ? -1 : Math.floor((B.x0 + B.bw + row.list[j + 1].x0) / 2) - 1)), sx - 3].filter((x) => x >= 0);
    for (const x of xs) paint(x, row.y0 - 1, CP.PATH, row.walk - row.y0 + 1, "gravel");
  }
  // ---------- the buildings copied in (compound.js placeBuilding: rooms, containers, doors, runs; c.house) ----------
  const sceneList = [], sceneBodies = [], scenePiles = [], scenePieces = [];
  for (const B of built) {
    const m = B.m, R = m.building;
    const part = placeBuilding(C, m, { x0: B.x0, y0: B.y0, face: "s", k: B.k, name: B.name, key: B.key });
    B.part = part;
    B.rect = { x0: part.x0, y0: part.y0, w: part.w, h: part.h };
    // Its scenes (interiorscenes.js, rolled on its own map): moved with it, their rooms by the new ids.
    const S = m.scenes;
    if (S) {
      const tx = (x) => B.x0 + (x - R.x0), ty = (yy) => B.y0 + (yy - R.y0);
      const ids = new Map(m.rooms.filter((a) => !a.outdoor).map((a, j) => [a.id, part.rooms[j]]));
      for (const sc of S.list) sceneList.push({ ...sc, x: tx(sc.x), y: ty(sc.y), room: sc.room == null ? null : ids.get(sc.room) ?? null, house: B.k });
      for (const o of S.bodies) sceneBodies.push({ ...o, x: tx(o.x), y: ty(o.y) });
      for (const q of S.piles) scenePiles.push({ ...q, x: tx(q.x), y: ty(q.y), area: q.area == null ? null : ids.get(q.area) ?? null });
      for (const q of S.pieces) scenePieces.push({ ...q, x: tx(q.x), y: ty(q.y) });
    }
    // A path from its front door (and its doors on the front: a roller door's drive) to the promenade, a plaza before it.
    const row = rows.find((r) => r.list.includes(B));
    const toWalk = (x, yy) => { for (let q = yy + 1; q < row.walk && inside(x, q); q++) { keep[I(x, q)] = 1; if (cells[I(x, q)].f === "grass") cells[I(x, q)].f = "gravel"; } };
    for (const [x, yy] of (part.front && part.front.cells) || []) toWalk(x, yy);
    for (const ex of part.exits) if (ex.side === "s") for (const [x, yy] of ex.cells) toWalk(x, yy);
    B.front = part.front ? { x: part.front.x, y: part.front.y } : null;
    if (B.front) paint(B.front.x - 2, B.y0 + R.h + 1, 5, Math.max(0, row.walk - (B.y0 + R.h + 1)), "gravel");
  }
  // ---------- the links between joined buildings (compound.js link: the row both walls open onto a room) ----------
  const links = [];
  for (const row of rows) for (let j = 0; j + 1 < row.list.length; j++) {
    const A = row.list[j], Bb = row.list[j + 1];
    if (!A.link) continue;
    const type = A.link.type, near = Math.max(A.y0, Bb.y0) + 3; // toward their backs: the courtyard in front of it
    const area = link(C, A.part, Bb.part, { kind: type, f: A.link.f, width: 2, near, name: `${LINK_NAME[type]}: ${A.name} – ${Bb.name}`, dk: type === "corridor" ? "steel" : "glass" });
    if (!area) { A.link = null; continue; }
    for (const [dx, dy] of area.doors) { const c = C.floors[area.f].cells[I(dx, dy)]; if (c && c.dk && DOOR_KINDS[c.dk] && c.hp == null) { c.hp = c.mhp = DOOR_KINDS[c.dk].hp; if (DOOR_KINDS[c.dk].see) delete c.t; } }
    area.link = type;
    // A corridor's side door onto the courtyard (the lawn either side stays joined up).
    if (type === "corridor") {
      const mx = Math.floor((area.x0 + area.x0 + area.w - 1) / 2), my = area.y0 + area.h - 1, c = cells[I(mx, my)];
      if (c && c.k === "wall") { cells[I(mx, my)] = { ...c, k: "idoor", dk: "steel", hp: DOOR_KINDS.steel.hp, mhp: DOOR_KINDS.steel.hp }; area.doors.push([mx, my]); }
    }
    links.push({ type, f: area.f, a: A.k, b: Bb.k, x0: area.x0, y0: area.y0, w: area.w, h: area.h, area: area.id, doors: area.doors.map((d) => d.slice()) });
  }
  // The ground's guard (compound.js: nothing put on the ground cuts a walkable cell off from the way in).
  const entry0 = [1, roadY + 2];
  const G = guard(C, entry0[0], entry0[1]);
  const piece = (x, yy, k, w = 1, h = 1) => { // a piece of w × h on the lawn: all its cells or none
    const done = [];
    for (let q = yy; q < yy + h; q++) for (let p = x; p < x + w; p++) {
      if (cells[I(p, q)] && cells[I(p, q)].f === "floor") break;
      if (G.block(p, q, k)) done.push(I(p, q)); else { for (const i of done) { cells[i].k = "open"; G.passAt(i); } return false; }
    }
    if (done.length < w * h) { for (const i of done) { cells[i].k = "open"; G.passAt(i); } return false; }
    for (const i of done) keep[i] = 1;
    return true;
  };
  // The enclosed courtyards: the ground between two joined buildings in front of their link, hedged along the
  // promenade with a gate in the middle.
  /** @type {any[]} */
  const grounds = [];
  for (const L of links) {
    const A = built[L.a], Bb = built[L.b], row = rows.find((r) => r.list.includes(A));
    const x0 = A.x0 + A.bw + 1, x1 = Bb.x0 - 2, y0 = L.y0 + L.h, y1 = row.walk - 1;
    if (x1 - x0 < 2 || y1 - y0 < 2) continue;
    const gate = Math.floor((x0 + x1) / 2);
    for (let x = x0; x <= x1; x++) if (Math.abs(x - gate) > 1 && !keep[I(x, y1)] && G.block(x, y1, "fence")) cells[I(x, y1)].hedge = true;
    grounds.push({ kind: "courtyard", name: `Courtyard, ${A.name}`, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    if (rng.chance(0.5)) { const cx = Math.floor((x0 + x1) / 2), cy = Math.floor((y0 + y1) / 2); piece(cx, cy, rng.chance(0.5) ? "statue" : "campusbench", 1, 1); }
  }
  // ---------- the strips: quads, the dorms' yards, the fields, the lots ----------
  const lots = [];
  let quadNo = 0;
  for (const st of strips) {
    if (!st) continue;
    const x0 = CP.EDGE, x1 = sx - 2, w = x1 - x0 + 1;
    if (st.kind === "quad" || st.kind === "yard") {
      quadNo += st.kind === "quad" ? 1 : 0;
      const name = st.kind === "yard" ? "Residence yard" : quadNo === 1 ? "Main quad" : ["", "", "North quad", "South quad", "East quad", "West quad"][quadNo] || `Quad ${quadNo}`;
      const q = { kind: st.kind, name, x0, y0: st.y0, w, h: st.h };
      grounds.push(q);
      const midY = st.y0 + Math.floor(st.h / 2) - 1, midX = x0 + Math.floor(w / 2) - 1;
      paint(x0, midY, w, CP.PATH, "gravel"); // the cross paths
      if (st.kind === "quad") {
        for (const px of [midX, x0 + Math.floor(w / 4), x0 + Math.floor((3 * w) / 4)]) paint(px, st.y0, CP.PATH, st.h, "gravel");
        // The centre: a fountain (a 2 × 2 basin) or a statue on its plinth, on a plaza where the paths cross.
        for (let p = midX - 3; p <= midX + 4; p++) for (let r = midY - 3; r <= midY + 4; r++) if (inside(p, r) && cells[I(p, r)].k === "open") cells[I(p, r)].f = "gravel";
        for (let p = midX; p <= midX + 1; p++) for (let r = midY; r <= midY + 1; r++) keep[I(p, r)] = 0;
        if (rng.chance(0.5)) { piece(midX, midY, "fountain", 2, 2); q.centre = "fountain"; } else { piece(midX, midY, "statue"); q.centre = "statue"; }
        for (let p = midX - 3; p <= midX + 4; p++) for (let r = midY - 3; r <= midY + 4; r++) if (inside(p, r)) keep[I(p, r)] = 1;
      }
      // Trees round the lawns, benches along the paths.
      const nT = Math.round(w * st.h * CP.TREES), nB = Math.max(2, Math.round(w * st.h * CP.BENCH));
      for (let t = 0, n = 0; t < nT * 6 && n < nT; t++) { const p = rng.int(x0, x1), r = rng.int(st.y0, st.y0 + st.h - 1); if (cells[I(p, r)].f === "grass" && !keep[I(p, r)] && G.block(p, r, "tree")) { keep[I(p, r)] = 1; n++; } }
      for (let t = 0, n = 0; t < nB * 12 && n < nB; t++) {
        const p = rng.int(x0, x1 - 1), r = rng.int(st.y0 + 1, st.y0 + st.h - 2);
        const nearPath = cells[I(p, r - 1)].f === "gravel" || cells[I(p, r + 1)].f === "gravel";
        if (nearPath && cells[I(p, r)].f === "grass" && cells[I(p + 1, r)].f === "grass" && piece(p, r, "campusbench", 2, 1)) n++;
      }
    } else if (st.kind === "south") {
      // The fields (a sports field inside its running track, a stadium stand at a state university) to the west, the
      // parking lots to the east (compound.js parkingLot: bays in double rows, cars to search in some).
      let lx0 = x0;
      if (st.field) {
        const F = CP.FIELD, fx = x0 + 2, fy = st.y0 + 2 + (K.stadium ? 3 : 0);
        paint(fx, fy, F.w, F.h, "track", false);
        paint(fx + F.track, fy + F.track, F.w - 2 * F.track, F.h - 2 * F.track, "grass", false);
        grounds.push({ kind: "field", name: K.stadium ? "Stadium" : "Sports field", x0: fx, y0: fy, w: F.w, h: F.h });
        if (K.stadium) for (let p = fx + 4; p + 1 < fx + F.w - 4; p += 3) piece(p, fy - 3, "bleachers", 2, 2); // the stand along the north side
        lx0 = fx + F.w + 4;
      }
      const nl = K.lots, lw = Math.floor((x1 - lx0 + 1 - (nl - 1) * 4) / nl);
      for (let l = 0; l < nl && lw >= 16; l++) {
        const r = { x0: lx0 + l * (lw + 4), y0: st.y0 + 1, w: lw, h: st.h - 2 };
        const lot = parkingLot(C, G, r, rng, { name: nl > 1 ? `Parking lot ${String.fromCharCode(65 + l)}` : "Parking lot", parked: CP.CARS });
        if (lot) { lots.push(lot); grounds.push({ kind: "lot", name: lot.name, x0: r.x0, y0: r.y0, w: r.w, h: r.h }); }
      }
    }
  }
  // ---------- the ways out ----------
  const Z = 3, zy = roadY + 1;
  const zones = [
    { x0: 0, y0: zy, w: Z, h: Z, side: "west", exit: "west", name: "West end of the campus road", vehicle: false },
    { x0: W - Z, y0: zy, w: Z, h: Z, side: "east", exit: "east", name: "East end of the campus road", vehicle: false },
    { x0: Math.floor(W / 2) - 1, y0: 0, w: Z, h: Z, side: "north", exit: "north", name: "North edge of the campus", vehicle: false },
    { x0: 0, y0: Math.floor(roadY / 2), w: Z, h: Z, side: "west", exit: "west", name: "West edge of the campus", vehicle: false },
    { x0: W - Z, y0: Math.floor(roadY / 2), w: Z, h: Z, side: "east", exit: "east", name: "East edge of the campus", vehicle: false },
  ];
  for (const lot of lots) { paint(lot.x0 + Math.floor(lot.w / 2) - 1, roadY + CP.ROAD, Z, H - roadY - CP.ROAD, "gravel"); zones.push({ x0: lot.x0 + Math.floor(lot.w / 2) - 1, y0: H - Z, w: Z, h: Z, side: "south", exit: "south", name: `South of ${lot.name.toLowerCase()}`, vehicle: false, lot: true }); }
  for (const z of zones) for (let q = z.y0 - 1; q <= z.y0 + z.h; q++) for (let p = z.x0 - 1; p <= z.x0 + z.w; p++) if (inside(p, q)) { keep[I(p, q)] = 1; const c = cells[I(p, q)]; if (c.k === "tree" || c.k === "fence") { c.k = "open"; delete c.hedge; G.passAt(I(p, q)); } }
  // ---------- the quarantine tent on a quad (an outdoor scene: its own dice) ----------
  const qrng = new Rng(seedOf(state, "quarantine", tileId, option.id) || 1);
  const quads = grounds.filter((g) => g.kind === "quad");
  if (quads.length && qrng.chance(CP.QUARANTINE)) {
    const q = qrng.pick(quads), tw = 7, th = 5;
    for (let t = 0; t < 40; t++) {
      const p = qrng.int(q.x0 + 2, q.x0 + q.w - tw - 2), r = qrng.int(q.y0 + 1, q.y0 + q.h - th - 1);
      let ok = true;
      for (let yy = r - 1; yy <= r + th && ok; yy++) for (let x = p - 1; x <= p + tw && ok; x++) if (!inside(x, yy) || cells[I(x, yy)].k !== "open" || cells[I(x, yy)].f !== "grass") ok = false;
      if (!ok) continue;
      // The tent's canvas over the lawn (its long sides, the ends open), cots in two rows, the bodies of those it was for.
      for (let yy = r; yy < r + th; yy++) for (let x = p; x < p + tw; x++) { const c = cells[I(x, yy)]; c.k = yy === r || yy === r + th - 1 ? "tent" : "open"; c.f = "dirt"; keep[I(x, yy)] = 1; }
      const cots = [];
      for (let x = p + 1; x < p + tw - 1; x += 2) for (const yy of [r + 1, r + 3]) { if (G.block(x, yy, "cot", null)) { cots.push([x, yy]); scenePieces.push({ f: 0, x, y: yy, k: "cot" }); } }
      const nb = qrng.int(3, 6);
      let made = 0;
      for (const [x] of qrng.shuffle(cots)) { if (made >= nb) break; if (cells[I(x, r + 2)].k !== "open" || sceneBodies.some((o) => o.f === 0 && o.x === x && o.y === r + 2)) continue; sceneBodies.push({ f: 0, x, y: r + 2, human: true, quiet: true, r: qrng.next(), weapon: null, patient: true }); made++; }
      sceneList.push({ kind: "quarantine", f: 0, room: null, x: p + 3, y: r + 2, text: `A quarantine tent on the ${q.name.toLowerCase()}: cots in rows under the canvas, and ${made} who were brought here and never left.`, seen: false });
      q.quarantine = true;
      break;
    }
  }
  // ---------- the result (compound.js compoundResult: streetMap's shape; plan.houses are the buildings) ----------
  const vehicle = compoundVehicle(C, zones[0], withVehicle);
  const scenes = sceneList.length ? { list: sceneList.map((sc, i) => ({ ...sc, id: i + 1 })), bodies: sceneBodies, piles: scenePiles, pieces: scenePieces, seed: (seedOf(state, "scenebattle", tileId, option.id) % 2147483646) + 1 } : null;
  const map = compoundResult(C, { key: option.key, id: option.id, name: option.name, zones, vehicle, kind: "campus", extra: { street: true, campus: true, campusKind: kind, kindName: K.name, links, grounds } });
  for (const h of map.plan.houses) { const B = built[h.k]; h.row = rows.findIndex((r) => r.list.includes(B)); }
  for (const r of map.plan.rooms) { const a = map.rooms[r.id]; if (a.campus) r.campus = a.campus; if (a.link) r.link = a.link; }
  return Object.assign(map, { street: true, campus: true, scenes });
}
const LINK_NAME = { bridge: "Glass bridge", walkway: "Covered walkway", corridor: "Connecting corridor" };

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
// ---------- in the raid ----------
// The dead on a campus (buildingmaps.js placeInterior for a campus map): the site's roster × CAMPUS.DEAD_AREA's scale,
// spread over the buildings by their floor area × CAMPUS.DENSE (a dorm and the dining hall densest) and over the open
// ground (CAMPUS.OUTSIDE), on every floor of a building by its floors' share; none in an extraction zone or within 8 of
// the way in. Returns how many were placed.
export function campusDead(state, b, map, g, pod0 = 0) {
  const rng = state.rng, R = b.raid, W = b.w, H = b.h, P = map.plan;
  const C = CAMPUS;
  const area = P.houses.reduce((a, h) => a + h.w * h.h, 0);
  const before = R.campusDead || 0; // the groups before this one's (the cap is the campus's, all groups together)
  const n = Math.min(C.DEAD_MAX - before, Math.max(1, Math.round((g.count || 0) * Math.max(1, Math.pow(area / C.DEAD_AREA, C.DEAD_EXP)))));
  if (n <= 0) return 0;
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
  R.campusDead = before + placed;
  return placed;
}
// Students holed up in a dorm (buildingmaps.js placeInterior, after the dead; floorfolk.js placeFolk, the crawl's
// survivors upstairs): CAMPUS.SURVIVORS of campuses with a dorm of two storeys or more, the world's dice. They hold an
// upper floor's dorm room (FOLK.SURVIVORS.prefer.dorm; one a scene left barricaded with nobody dead first), its door
// barred; meeting them raises floorfolk.js's card (talk, ask them to join: they wait outside after the raid,
// scavenge.js afterRaid → folkAfterPlace).
export function campusFolk(state, b) {
  const P = b.raid && b.raid.plan;
  if (!P || !P.campus || !b.floors || b.floors.length < 2) return null;
  if (!P.houses.some((h) => h.key === "dorm" && h.storeys >= 2) || !state.rng.chance(CAMPUS.SURVIVORS)) return null;
  return placeFolk(state, b, { id: P.id, key: "dorm", folk: { survivors: true } }, 1);
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
