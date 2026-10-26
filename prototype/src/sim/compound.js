// @ts-check
// Compounds: many buildings on one raid map (the interiors epic #7: #30's shopping malls, #28's college campuses, any
// later complex of buildings). The shared multi-building and connector code, generalised from buildingmaps.js
// streetMap (the neighbourhood's street of houses, which keeps its own code so its saved streets stay exactly as they
// were). One implementation for every complex:
//
//   - compoundGrid(W, H, storeys, groundAt): the map's floors (the ground from groundAt(x, y) → a floor kind; every
//     upper floor "void": open air), and the lists the buildings are copied into (areas, containers, locked doors,
//     stair cells, stair runs). Container ids and room ids run on across the buildings.
//   - placeBuilding(C, m, o): copies a building assemble() made (buildingmaps.js, built the usual way with its front
//     toward +y and a ring of one cell outside it: margins 1, ground "none") onto the grid at (o.x0, o.y0), turned to
//     face o.face ("s" as built, "n" flipped front to back as streetMap's south row, "e" or "w" turned a quarter), on
//     floors o.f0 up. Every floor's cells, rooms (renamed by o.roomName, else "<room>, <building>"), containers
//     (c.house = o.k: poicont.js keeps each building's apart, as a street's houses), locked doors, stair runs (their
//     way up turned), a piece's facing (c.fc), a car's cells, the decor's sides; o.solid: the world sides ("n", "s",
//     "e", "w") whose outer wall is shared with a neighbour (its windows walled up: an inline shop's side walls).
//     Returns the placed record (its rect, front door, exits with their world side, rooms).
//   - connect(C, from, to, o): a corridor ("corridor": walls both sides, a door at each end), a covered walkway
//     ("walkway": open sides, a canopy over it, c.canopy) or a bridge between two upper floors ("bridge": floor o.f,
//     railings both sides) along a straight line of cells from one building's outer wall to another's; a room of its
//     own (role o.role, else "corridor") so the dead and the living path through it. Returns the area. link(C, a, b, o)
//     finds the row or column where two placed buildings' facing walls both open onto a room and connects them there.
//   - guard(C, sx, sy, o): blocking things put on the ground floor (or floor o.f) (block(x, y, k), car(...)) never cut a walkable cell
//     off from start. A cell whose eight neighbours stay joined round it is safe without a flood (the simple-point
//     test); only the rest flood the floor, so dressing a 300 × 300 map stays quick.
//   - parkingLot(C, G, rect, o): a surface lot of bays in double rows a drive aisle apart, cars parked in a share of the
//     bays (containers of an outdoor area, AREAS.wreck), lamp posts at the rows' ends.
//   - compoundResult(C, meta): the raid map in streetMap's shape (plan.buildings / plan.houses: the buildings, each
//     with its rooms; plan.compound: true; zones, exits, the vehicle), which combat.js createRaid loads as it does a
//     street of houses (each upper floor's reach flooded from every stair run).
import { CELL, AREAS, placeCar, removeCar, placeVehicle } from "./combat.js";
import { DOOR_KINDS } from "./buildingmaps.js"; // a connector's doors: their hit points by kind

/** @typedef {{ k: string, f?: string, [key: string]: any }} Cell */
/** @typedef {"s" | "n" | "e" | "w"} Face */

export const COMPOUND = {
  PC: 10000,     // a piece's number (c.pc) on the compound: the building's (k + 1) × this + its own
  BAY: [3, 5],   // a parking bay: 3 cells wide (a car of 2 and a cell between), 5 deep
  AISLE: 6,      // a lot's drive aisle between two double rows of bays
  PARKED: 0.45,  // the share of the bays with a car in them
};

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // buildingmaps.js STAIR_DIRS; ui/isoview.js VD (wall art's d)
const FACING = { e: [1, 0], w: [-1, 0], s: [0, 1], n: [0, -1] }; // a piece's c.fc
const dirOf = (dx, dy) => DIRS.findIndex(([a, b]) => a === dx && b === dy);
const fcOf = (dx, dy) => Object.keys(FACING).find((k) => FACING[k][0] === dx && FACING[k][1] === dy);
// The building's own sides (front: +y, its street side) by the way it faces once placed.
const SIDES = {
  s: { front: "s", back: "n", left: "w", right: "e" },
  n: { front: "n", back: "s", left: "w", right: "e" },
  e: { front: "e", back: "w", left: "s", right: "n" },
  w: { front: "w", back: "e", left: "n", right: "s" },
};
export const SIDE_NAME = { n: "north", s: "south", e: "east", w: "west" };

/**
 * The turn of a building w × h (its local cells u, v from its top-left; its front the last row) to face `face`: the
 * placed size, a cell's place and a direction's.
 * @param {Face} face @param {number} w @param {number} h
 */
export function orient(face, w, h) {
  switch (face) {
    case "n": return { w, h, pt: (u, v) => [u, h - 1 - v], vec: (dx, dy) => [dx, -dy] };
    case "e": return { w: h, h: w, pt: (u, v) => [v, w - 1 - u], vec: (dx, dy) => [dy, -dx] };
    case "w": return { w: h, h: w, pt: (u, v) => [h - 1 - v, u], vec: (dx, dy) => [-dy, dx] };
    default: return { w, h, pt: (u, v) => [u, v], vec: (dx, dy) => [dx, dy] };
  }
}

/** A cell copied turned (T: orient's): its stair's way up, its piece's facing, its car's cells, its decor's sides. */
function turnCell(c, face, T) {
  if (face === "s") return;
  if (c.k === "stairs" && c.dir != null && c.dir >= 0) { const [dx, dy] = T.vec(...DIRS[c.dir]); c.dir = dirOf(dx, dy); }
  if (c.fc && FACING[c.fc]) { const [dx, dy] = T.vec(...FACING[c.fc]); c.fc = fcOf(dx, dy); }
  if (c.wart && c.wart.d != null) { const [dx, dy] = T.vec(...DIRS[c.wart.d]); c.wart = { ...c.wart, d: dirOf(dx, dy) }; }
  if (c.deco && c.deco.e) { // a rug's edges: 1 north, 2 south, 4 west, 8 east
    const bits = [[1, 0, -1], [2, 0, 1], [4, -1, 0], [8, 1, 0]];
    let e = 0;
    for (const [bit, dx, dy] of bits) if (c.deco.e & bit) { const [ex, ey] = T.vec(dx, dy); e |= bits.find(([, a, b]) => a === ex && b === ey)[0]; }
    c.deco = { ...c.deco, e };
  }
  if (c.car) { // i along the car (0 its front), j across; ax the world axis it lies along
    const car = (c.car = { ...c.car });
    if (face === "n") { if (car.ax === "y") car.i = car.L - 1 - car.i; else car.j = 1 - car.j; }
    else if (face === "e") { if (car.ax === "x") { car.ax = "y"; car.i = car.L - 1 - car.i; } else { car.ax = "x"; car.j = 1 - car.j; } }
    else if (car.ax === "x") { car.ax = "y"; car.j = 1 - car.j; } else { car.ax = "x"; car.i = car.L - 1 - car.i; }
  }
}

/**
 * The compound's grid: floor 0 the ground (groundAt(x, y): its floor kind), every upper floor open air.
 * @param {number} W @param {number} H @param {number} storeys @param {(x: number, y: number) => string} groundAt
 */
export function compoundGrid(W, H, storeys, groundAt) {
  const cells = new Array(W * H);
  for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) cells[i] = { k: "open", f: groundAt(x, y) };
  const floorName = (g) => (g === 0 ? "Ground floor" : g === storeys - 1 ? "Top floor" : `Floor ${g + 1}`);
  const floors = [{ cells, name: floorName(0) }];
  for (let g = 1; g < storeys; g++) { const up = new Array(W * H); for (let i = 0; i < up.length; i++) up[i] = { k: "void", f: "air" }; floors.push({ cells: up, name: floorName(g) }); }
  return {
    W, H, storeys, floors, cells,
    /** @type {any[]} */ areas: [], /** @type {any[]} */ containers: [], /** @type {any[]} */ lockedDoors: [],
    /** @type {number[][]} */ stairs: [], /** @type {any[]} */ runs: [], /** @type {any[]} */ parts: [],
    keep: new Uint8Array(W * H), // stays clear: the ring round each building, the paths to its doors
    built: new Uint8Array(W * H), // inside a placed building (every floor's footprint): no lot, no dressing
    cid: 1,
  };
}
export const cAt = (C, f, x, y) => (x >= 0 && y >= 0 && x < C.W && y < C.H ? C.floors[f].cells[y * C.W + x] : null);

/**
 * Copies building m (assemble's result) onto the compound. o: { x0, y0 (the placed top-left), face, f0 (the floor its
 * ground floor goes on), k (its number: c.house), name, roomName(room) → its name on the compound, solid (world sides
 * whose wall is shared), tag (extra fields on its rooms and containers), keepRing (false: no clear ring round it) }.
 * @param {any} C @param {any} m @param {any} o
 */
export function placeBuilding(C, m, o) {
  const face = o.face || "s", f0 = o.f0 || 0, k = o.k ?? C.parts.length, B = m.building;
  const T = orient(face, B.w, B.h), W = C.W;
  const tx = (x, y) => o.x0 + T.pt(x - B.x0, y - B.y0)[0];
  const ty = (x, y) => o.y0 + T.pt(x - B.x0, y - B.y0)[1];
  // A rect of cells (a room's, with its walls) placed: the corners' bounding box.
  const rectOf = (r) => {
    const xs = [tx(r.x0, r.y0), tx(r.x0 + r.w - 1, r.y0 + r.h - 1)], ys = [ty(r.x0, r.y0), ty(r.x0 + r.w - 1, r.y0 + r.h - 1)];
    return { x0: Math.min(...xs), y0: Math.min(...ys), w: Math.abs(xs[1] - xs[0]) + 1, h: Math.abs(ys[1] - ys[0]) + 1 };
  };
  const rect = { x0: o.x0, y0: o.y0, w: T.w, h: T.h };
  const solid = new Set(o.solid || []);
  const sideOfWall = (X, Y) => (Y === rect.y0 ? "n" : Y === rect.y0 + rect.h - 1 ? "s" : X === rect.x0 ? "w" : X === rect.x0 + rect.w - 1 ? "e" : null);
  const pcBase = COMPOUND.PC * (k + 1);
  (m.floors || [{ cells: m.cells }]).forEach((F, g) => {
    const dst = C.floors[f0 + g].cells, cars = new Map(); // a car's cells take the id of their new top-left cell
    for (let y = B.y0; y < B.y0 + B.h; y++) for (let x = B.x0; x < B.x0 + B.w; x++) {
      const c = { ...F.cells[y * m.w + x] }, X = tx(x, y), Y = ty(x, y);
      turnCell(c, face, T);
      if (c.pc) c.pc += pcBase;
      const side = solid.size ? sideOfWall(X, Y) : null;
      if (side && solid.has(side) && (c.k === "window" || c.k === "smashed")) { c.k = "wall"; delete c.win; }
      if (c.car) {
        const e = cars.get(c.car.id) || { x: X, y: Y, list: [] };
        e.x = Math.min(e.x, X); e.y = Math.min(e.y, Y); e.list.push(c.car);
        cars.set(c.car.id, e);
      }
      if (o.tag && o.tag.cell) Object.assign(c, o.tag.cell);
      dst[Y * W + X] = c;
    }
    for (const e of cars.values()) for (const car of e.list) car.id = e.y * W + e.x + 1;
  });
  const roomIds = new Map(), base = C.areas.length;
  let n = 0;
  for (const a of m.rooms) {
    if (a.outdoor) continue; // a building of a compound has no ground of its own: the compound's is round it
    const id = base + n++;
    roomIds.set(a.id, id);
    const name = o.roomName ? o.roomName(a) : `${a.name}, ${o.name}`;
    C.areas.push({ ...a, ...rectOf(a), id, f: (a.f || 0) + f0, name, doors: (a.doors || []).map(([x, y]) => [tx(x, y), ty(x, y)]), house: k, ...((o.tag && o.tag.room) || {}) });
  }
  for (const c of m.containers) {
    const area = C.areas[roomIds.get(c.area)];
    if (!area) continue;
    const what = String(c.label || "").split(": ").slice(1).join(": ") || c.kind;
    const r = rectOf({ x0: c.x, y0: c.y, w: c.w || 1, h: c.h || 1 }); // a piece of 2+ cells: its placed top-left
    C.containers.push({ ...c, id: C.cid++, x: r.x0, y: r.y0, ...(c.w ? { w: r.w, h: r.h } : {}), f: (c.f || 0) + f0, area: area.id, house: k, label: `${area.name}: ${what}`, ...((o.tag && o.tag.box) || {}) });
  }
  for (const d of m.lockedDoors) C.lockedDoors.push({ ...d, x: tx(d.x, d.y), y: ty(d.x, d.y), f: (d.f || 0) + f0, area: d.area == null ? null : roomIds.get(d.area) ?? null, house: k });
  for (const [x, y] of m.stairs || []) C.stairs.push([tx(x, y), ty(x, y)]);
  for (const r of m.runs || []) {
    const [dx, dy] = T.vec(r.dx, r.dy);
    C.runs.push({ ...r, x: tx(r.x, r.y), y: ty(r.x, r.y), dx, dy, f0: (r.f0 || 0) + f0, f1: (r.f1 ?? (m.storeys || 1) - 1) + f0, house: k });
  }
  for (let y = rect.y0; y < rect.y0 + rect.h; y++) for (let x = rect.x0; x < rect.x0 + rect.w; x++) if (x >= 0 && y >= 0 && x < W && y < C.H) C.built[y * W + x] = 1;
  if (o.keepRing !== false) for (let y = rect.y0 - 1; y <= rect.y0 + rect.h; y++) for (let x = rect.x0 - 1; x <= rect.x0 + rect.w; x++) if (x >= 0 && y >= 0 && x < W && y < C.H && !(x >= rect.x0 && x < rect.x0 + rect.w && y >= rect.y0 && y < rect.y0 + rect.h)) C.keep[y * W + x] = 1;
  const sides = SIDES[face];
  const out = (side, x, y) => { const s = sides[side] || side, [dx, dy] = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[s]; return { side: s, ox: x + dx, oy: y + dy }; };
  const front = m.front ? { x: tx(m.front.x, m.front.y), y: ty(m.front.x, m.front.y), cells: (m.front.cells || [[m.front.x, m.front.y]]).map(([x, y]) => [tx(x, y), ty(x, y)]), ...out("front", tx(m.front.x, m.front.y), ty(m.front.x, m.front.y)) } : null;
  const exits = (m.exits || []).map((e) => ({ name: e.name, roller: !!e.roller, locked: e.locked || null, x: tx(e.x, e.y), y: ty(e.x, e.y), cells: (e.cells || []).map(([x, y]) => [tx(x, y), ty(x, y)]), ...out(e.side, tx(e.x, e.y), ty(e.x, e.y)) }));
  const part = { k, name: o.name, key: o.key || (m.plan && m.plan.key) || null, face, f0, storeys: m.storeys || 1, ...rect, front, exits, rooms: [...roomIds.values()], ...((o.tag && o.tag.part) || {}) };
  C.parts.push(part);
  return part;
}

/**
 * A connector along a straight line of cells (x0, y0) → (x1, y1) (one axis), from one building's outer wall cell to
 * another's: its floor between, width cells wide (the line its first row; the rest toward +x or +y), a door cut in each
 * wall. o: { kind: "corridor" | "walkway" | "bridge", f, width, name, role, fl, house }. Returns the area.
 * @param {any} C @param {number[]} from @param {number[]} to @param {any} o
 */
export function connect(C, from, to, o = {}) {
  const kind = o.kind || "corridor", f = kind === "bridge" ? o.f || 1 : o.f || 0, wd = Math.max(1, o.width || 1);
  const [x0, y0] = from, [x1, y1] = to, horiz = y0 === y1;
  const len = horiz ? Math.abs(x1 - x0) : Math.abs(y1 - y0), sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
  const cells = C.floors[f].cells, W = C.W, I = (x, y) => y * W + x;
  const fl = o.fl || (kind === "walkway" ? "conc" : kind === "bridge" ? "steel" : "lino");
  const set = (x, y, c) => { cells[I(x, y)] = c; };
  for (let s = 1; s < len; s++) for (let j = -1; j <= wd; j++) {
    const x = horiz ? x0 + s * sx : x0 + j, y = horiz ? y0 + j : y0 + s * sy;
    if (x < 0 || y < 0 || x >= W || y >= C.H) continue;
    const edge = j === -1 || j === wd;
    if (edge) {
      if (kind === "walkway") continue; // open sides: the ground round it as it is
      const was = cells[I(x, y)];
      if (was && was.k !== "open" && was.k !== "void") continue; // a wall it runs along stays as it is
      set(x, y, kind === "bridge" ? { k: "rail", f: "floor", fl } : { k: "wall", f: "floor" });
    } else set(x, y, { k: "open", f: kind === "walkway" ? "gravel" : "floor", fl, ...(kind === "walkway" ? { canopy: true } : {}), ...(kind === "bridge" ? { bridge: true } : {}) });
    if (!edge) C.keep[I(x, y)] = f === 0 ? 1 : C.keep[I(x, y)];
  }
  // The doors at each end (a walkway's open ends need none where the wall is already a door or open).
  const doors = [];
  for (const [ex, ey] of [from, to]) for (let j = 0; j < wd; j++) {
    const x = horiz ? ex : ex + j, y = horiz ? ey + j : ey, c = cells[I(x, y)];
    if (!c) continue;
    if (c.k === "wall" || c.k === "window" || c.k === "smashed") { const dk = o.dk || (kind === "walkway" ? "glass" : "wood"), hp = (DOOR_KINDS[dk] || DOOR_KINDS.wood).hp; cells[I(x, y)] = { ...c, k: kind === "walkway" ? "odoor" : "idoor", dk, hp, mhp: hp }; delete cells[I(x, y)].win; } // its hit points by its kind (buildingmaps.js DOOR_KINDS)
    doors.push([x, y]);
  }
  const xs = [x0, x1, horiz ? x0 : x0 + wd - 1], ys = [y0, y1, horiz ? y0 + wd - 1 : y0];
  const area = {
    id: C.areas.length, f, type: null, role: o.role || "corridor", name: o.name || (kind === "walkway" ? "Covered walkway" : kind === "bridge" ? "Skybridge" : "Connecting corridor"),
    x0: Math.min(...xs) - (horiz ? 0 : 1), y0: Math.min(...ys) - (horiz ? 1 : 0), w: (Math.max(...xs) - Math.min(...xs)) + (horiz ? 1 : 3), h: (Math.max(...ys) - Math.min(...ys)) + (horiz ? 3 : 1),
    doors, hub: true, locked: null, up: false, entry: false, noLabel: true, connector: kind, house: o.house ?? null,
  };
  C.areas.push(area);
  return area;
}

/**
 * Joins two placed buildings a and b (placeBuilding's records) facing each other across open ground with a connector
 * (connect's o): a's east wall to b's west wall when b stands to its east (south to north when below), at the row (or
 * column) nearest o.near (else the middle of their overlap) where both walls open onto a room's floor on floor o.f
 * (never a stair step, a corner or a door already there). null when they do not face each other or no row fits.
 * @param {any} C @param {any} a @param {any} b @param {any} o
 */
export function link(C, a, b, o = {}) {
  const f = o.kind === "bridge" ? o.f || 1 : o.f || 0, wd = Math.max(1, o.width || 1);
  if (f > a.f0 + a.storeys - 1 || f > b.f0 + b.storeys - 1 || f < a.f0 || f < b.f0) return null;
  const cells = C.floors[f].cells, W = C.W;
  const floorAt = (x, y) => { const c = cells[y * W + x]; return !!c && (c.k === "open" || c.k === "odoor") && !c.landing; };
  const wallAt = (x, y) => { const c = cells[y * W + x]; return !!c && (c.k === "wall" || c.k === "window"); };
  let horiz, lo, hi, ax, bx;
  if (a.x0 + a.w <= b.x0 || b.x0 + b.w <= a.x0) { // side by side: a row
    [a, b] = a.x0 < b.x0 ? [a, b] : [b, a];
    horiz = true; lo = Math.max(a.y0, b.y0) + 1; hi = Math.min(a.y0 + a.h, b.y0 + b.h) - 2 - (wd - 1);
    ax = a.x0 + a.w - 1; bx = b.x0;
  } else if (a.y0 + a.h <= b.y0 || b.y0 + b.h <= a.y0) { // one above the other: a column
    [a, b] = a.y0 < b.y0 ? [a, b] : [b, a];
    horiz = false; lo = Math.max(a.x0, b.x0) + 1; hi = Math.min(a.x0 + a.w, b.x0 + b.w) - 2 - (wd - 1);
    ax = a.y0 + a.h - 1; bx = b.y0;
  } else return null;
  if (hi < lo) return null;
  const mid = o.near != null ? o.near : Math.round((lo + hi) / 2);
  const fits = (t) => {
    for (let j = 0; j < wd; j++) {
      const p = t + j;
      if (horiz ? !(wallAt(ax, p) && wallAt(bx, p) && floorAt(ax - 1, p) && floorAt(bx + 1, p)) : !(wallAt(p, ax) && wallAt(p, bx) && floorAt(p, ax - 1) && floorAt(p, bx + 1))) return false;
    }
    return true;
  };
  const order = [];
  for (let t = lo; t <= hi; t++) order.push(t);
  order.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid) || p - q);
  const t = order.find(fits);
  if (t == null) return wd > 1 && !o.exact ? link(C, a, b, { ...o, width: wd - 1 }) : null; // narrower where it must (o.exact: never)
  return connect(C, horiz ? [ax, t] : [t, ax], horiz ? [bx, t] : [t, bx], { ...o, f });
}

const passable = (c) => !!c && (!!(CELL[c.k] && CELL[c.k].walk) || c.k === "door");

/**
 * The connectivity guard over the ground floor: block / car refuse anything that would cut a walkable cell off from
 * (sx, sy) (locked doors count as ways through). o.free(x, y): may dressing go here (default: open, not kept); o.f: the
 * floor it guards (default the ground; an upper floor's walk starts from a stair cell or a landing).
 * @param {any} C @param {number} sx @param {number} sy @param {{ free?: (x: number, y: number) => boolean, f?: number }} [o]
 */
export function guard(C, sx, sy, o = {}) {
  const { W, H } = C, cells = C.floors[o.f || 0].cells, N = W * H, I = (x, y) => y * W + x;
  const pass = new Uint8Array(N);
  let total = 0;
  for (let i = 0; i < N; i++) { pass[i] = passable(cells[i]) ? 1 : 0; total += pass[i]; }
  const seen = new Uint32Array(N), stack = new Int32Array(N);
  let stamp = 0;
  const start = I(sx, sy);
  const connected = () => {
    stamp++;
    let sp = 0, got = 1;
    stack[sp++] = start; seen[start] = stamp;
    while (sp) {
      const i = stack[--sp], x = i % W;
      let j = i + 1;
      if (x + 1 < W && seen[j] !== stamp && pass[j]) { seen[j] = stamp; got++; stack[sp++] = j; }
      j = i - 1;
      if (x > 0 && seen[j] !== stamp && pass[j]) { seen[j] = stamp; got++; stack[sp++] = j; }
      j = i + W;
      if (j < N && seen[j] !== stamp && pass[j]) { seen[j] = stamp; got++; stack[sp++] = j; }
      j = i - W;
      if (j >= 0 && seen[j] !== stamp && pass[j]) { seen[j] = stamp; got++; stack[sp++] = j; }
    }
    return got === total;
  };
  // The simple-point test: going round the eight neighbours (each step round the ring is a step on the map), the
  // passable ones beside the cell's four sides all lie in one run, so taking the cell away leaves them joined.
  const RING = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  const simple = (x, y) => {
    const p = RING.map(([dx, dy]) => { const xx = x + dx, yy = y + dy; return xx >= 0 && yy >= 0 && xx < W && yy < H && pass[I(xx, yy)] === 1; });
    const gap = p.indexOf(false);
    if (gap < 0) return true;
    let runs = 0, inRun = false, side = false; // round the ring from a gap: runs holding a side cell (a corner alone never touched the cell)
    for (let s = 1; s <= 8; s++) {
      const i = (gap + s) % 8;
      if (p[i]) { if (!inRun) { inRun = true; side = false; } if (i % 2 === 0) side = true; }
      else if (inRun) { inRun = false; if (side) runs++; }
    }
    return runs <= 1;
  };
  const free = o.free || ((x, y) => x >= 0 && y >= 0 && x < W && y < H && cells[I(x, y)].k === "open" && !C.keep[I(x, y)] && !C.built[I(x, y)]);
  const g = {
    pass, connected, passAt: (i) => { const was = pass[i]; pass[i] = passable(cells[i]) ? 1 : 0; total += pass[i] - was; },
    /** A blocking thing on a free cell, undone if it would cut anything off. @param {number} x @param {number} y @param {string} k @param {any} [extra] */
    block(x, y, k, extra = null) {
      if (!free(x, y) || I(x, y) === start) return false;
      const i = I(x, y), c = cells[i], was = c.k;
      const safe = simple(x, y);
      c.k = k; if (extra) Object.assign(c, extra);
      g.passAt(i);
      if (!pass[i] && !safe && !connected()) { c.k = was; if (extra) for (const key of Object.keys(extra)) delete c[key]; g.passAt(i); return false; }
      return true;
    },
    /** A thing taken back up (the cell open floor again). */
    unblock(x, y) { const i = I(x, y), c = cells[i]; c.k = "open"; delete c.fc; delete c.pc; g.passAt(i); },
    /** A car of L cells along ax at (x, y) (combat.js placeCar), undone if it cuts anything off. */
    car(x, y, ax, L, kind = "car", v = 0) {
      const rect = placeCar(cells, W, H, x, y, ax, L, kind, (cx, cy) => free(cx, cy) && I(cx, cy) !== start, v, { ring: false });
      if (!rect) return null;
      for (let yy = rect.y0; yy < rect.y0 + rect.h; yy++) for (let xx = rect.x0; xx < rect.x0 + rect.w; xx++) g.passAt(I(xx, yy));
      if (!g.carSafe(rect) && !connected()) { removeCar(cells, W, rect); for (let yy = rect.y0; yy < rect.y0 + rect.h; yy++) for (let xx = rect.x0; xx < rect.x0 + rect.w; xx++) g.passAt(I(xx, yy)); return null; }
      return rect;
    },
    // A car with open ground all round it (its ring passable) cuts nothing off.
    carSafe(r) { for (let yy = r.y0 - 1; yy <= r.y0 + r.h; yy++) for (let xx = r.x0 - 1; xx <= r.x0 + r.w; xx++) { const inR = xx >= r.x0 && yy >= r.y0 && xx < r.x0 + r.w && yy < r.y0 + r.h; if (!inR && (xx < 0 || yy < 0 || xx >= W || yy >= H || !pass[I(xx, yy)])) return false; } return true; },
  };
  return g;
}

/**
 * A surface lot in rect: double rows of bays (COMPOUND.BAY) along x a drive aisle apart (COMPOUND.AISLE), its floor
 * the road's, cars parked in a share of the bays: each a container of the lot's outdoor area (AREAS.wreck: a car's
 * glovebox and boot), lamp posts at the rows' ends. Returns the area (null when nothing was parked).
 * @param {any} C @param {any} G guard() @param {{ x0: number, y0: number, w: number, h: number }} r @param {any} rng @param {{ name?: string, parked?: number, house?: number | null }} [o]
 */
export function parkingLot(C, G, r, rng, o = {}) {
  const W = C.W, [bw, bd] = COMPOUND.BAY, A = COMPOUND.AISLE;
  for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) { const c = C.cells[y * W + x]; if (c && c.k === "open" && !C.keep[y * W + x] && !C.built[y * W + x]) c.f = "road"; }
  const area = { id: C.areas.length, type: "wreck", name: o.name || "Parking lot", outdoor: true, f: 0, x0: r.x0, y0: r.y0, w: r.w, h: r.h, house: o.house ?? null, lot: true };
  let cars = 0;
  // Rows: an aisle, a row of bays facing it, a row back to back, an aisle...
  for (let y = r.y0 + A; y + 2 * bd <= r.y0 + r.h - A + 1; y += 2 * bd + A) {
    for (const [ry, ax] of [[y, "y"], [y + bd, "y"]]) {
      for (let x = r.x0 + 1; x + bw <= r.x0 + r.w - 1; x += bw) {
        if (!rng.chance(o.parked ?? COMPOUND.PARKED)) continue;
        const L = rng.chance(0.25) ? 4 : 3, cy = ry === y ? ry + (bd - L) : ry;
        const rect = G.car(x, cy, ax, L, "car", rng.int(0, 1e6));
        if (!rect) continue;
        C.containers.push({ id: C.cid++, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, f: 0, area: area.id, kind: "car", searched: false, label: `${area.name}: car`, house: o.house ?? null });
        cars++;
      }
    }
    G.block(r.x0, y + bd - 1, "lamp"); G.block(r.x0 + r.w - 1, y + bd, "lamp");
  }
  if (!cars) return null;
  C.areas.push(area);
  return area;
}

/**
 * The raid map from the compound, in streetMap's shape. meta: { key, id, name, zones, vehicle (the team's, placed by
 * the caller), kind (the compound's own kind: "stripmall"...), intro, extra (more plan fields) }.
 * @param {any} C @param {any} meta
 */
export function compoundResult(C, meta) {
  const { W, H } = C, zones = meta.zones;
  const zoneExits = () => zones.slice(1).map((z, j) => ({ side: z.side, name: z.name, x: z.x0 + 1, y: z.y0 + 1, cells: [], locked: null, roller: false, zone: j + 1 }));
  const rects = C.parts.map((p) => ({ x0: p.x0, y0: p.y0, w: p.w, h: p.h }));
  const first = C.parts[0];
  const plan = {
    key: meta.key, id: meta.id, name: meta.name, w: W, h: H, compound: true, kind: meta.kind || meta.key, building: rects[0], buildings: rects,
    houses: C.parts.map((p) => ({ k: p.k, name: p.name, key: p.key, face: p.face, ...(p.kind ? { kind: p.kind } : {}), x0: p.x0, y0: p.y0, w: p.w, h: p.h, f0: p.f0, storeys: p.storeys, front: p.front ? { x: p.front.x, y: p.front.y } : null, rooms: p.rooms.slice(), ...(p.role ? { role: p.role } : {}), ...(p.anchor ? { anchor: true } : {}) })),
    tall: true, storeys: C.storeys, stairs: C.stairs.map((s) => s.slice()), runs: C.runs.map((r) => ({ ...r })),
    rooms: C.areas.filter((a) => !a.outdoor).map((a) => ({ id: a.id, f: a.f, name: a.name, role: a.role, type: a.type, x0: a.x0, y0: a.y0, w: a.w, h: a.h, locked: a.locked, up: a.up, hub: a.hub, entry: a.entry, house: a.house, ...(a.civic ? { civic: a.civic } : {}), ...(a.shop ? { shop: a.shop } : {}) })),
    front: first && first.front ? { x: first.front.x, y: first.front.y } : null, exits: zoneExits(), ...(meta.extra || {}),
  };
  return {
    w: W, h: H, cells: C.cells, rooms: C.areas, containers: C.containers, zones, vehicle: meta.vehicle || null, exits: zoneExits(), front: plan.front,
    lockedDoors: C.lockedDoors, plan, building: plan.building, buildings: plan.buildings, floors: C.floors, stairs: C.stairs, runs: C.runs, storeys: C.storeys, compound: true,
  };
}

/** The team's vehicle in zone z (laid last: the compound is the same with or without it). */
export function compoundVehicle(C, z, withVehicle) {
  if (!withVehicle) return null;
  z.vehicle = true;
  const W = C.W, H = C.H, cells = C.cells;
  const v = placeVehicle(cells, W, H, z, withVehicle, (x, y) => x >= 0 && y >= 0 && x < W && y < H && cells[y * W + x].k === "open");
  if (!v) { const c = cells[(z.y0 + 1) * W + z.x0 + 1]; c.k = "vehicle"; c.f = "road"; }
  return v;
}

/** Is this outdoor area of a compound one to search (AREAS)? */
export const searchable = (a) => !!(a && a.type && AREAS[a.type]);
