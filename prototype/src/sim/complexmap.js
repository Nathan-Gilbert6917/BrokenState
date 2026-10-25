// @ts-check
// Maps of many buildings (issue #31's prisons, shared with #28's campus and #30's malls: one implementation of the
// multi-building map and its connectors). The neighbourhood's street (buildingmaps.js streetMap) was the first map of
// several buildings; this module is that copy-in made general, so every map of several buildings lays them the same way:
//
//   complexGrid(W, H, storeys, groundF)   the map: W × H cells, a ground floor of open ground (groundF(x, y): the
//                                         cell's ground, "grass", "gravel", "road"...) and `storeys - 1` floors of
//                                         "void" above (open air: each building's upper floors are its own).
//   stampBuilding(G, m, x0, y0, o)        copies one building (an assemble map, buildingmaps.js) in with its bounding
//                                         rectangle's top-left at (x0, y0): every floor's cells, its rooms (named
//                                         "<room>, <o.name>"), its containers (numbered on across the map, each with
//                                         house: o.k, so the POI's container ledger, poicont.js, keeps every building's
//                                         apart), its locked doors, its stairs and stair runs, its pieces' numbers. o.flip
//                                         turns it front to back (its front door then faces north), as a street's south
//                                         row is. Returns the building's record { k, name, x0, y0, w, h, front, rooms }.
//   connectBuildings(G, a, b, o)          a corridor between two stamped buildings' facing walls (a covered walkway, a
//                                         secure corridor, a tunnel): a straight run o.width cells wide (2) inside walls of
//                                         its own, a door through each building's wall where a floor cell stands behind
//                                         it, a room of its own (role corridor, a hub: the dead and the living path through
//                                         it). o.dk: the doors' kind (buildingmaps.js DOOR_KINDS; "security" for a prison's
//                                         sally-port doors), o.sally: a cross wall with a third door in the middle (two
//                                         doors with a space between: a sally port), o.name, o.fl. Upper floors stay open
//                                         air over it. null when the two do not face each other across open ground.
//   guard(G, start)                       { block(x, y, k), free(x, y), connected() }: lays a cell that is not walked
//                                         through only where it cuts no walkable cell off from `start` (a flood on a byte
//                                         a cell, as streetMap's), for dressing the open ground.
//   finishComplex(G, option, o)           the map object a raid reads (combat.js createRaid), in streetMap's shape:
//                                         { w, h, cells, rooms, containers, zones, exits, front, lockedDoors, plan,
//                                         building, buildings, floors, stairs, runs, storeys, street: true }, plus
//                                         complex: o.kind. plan.houses lists the buildings with their rooms (the raid
//                                         plan's intro names them); plan.street marks a map whose ways out are its zones.
// Everything here is deterministic: no dice of its own (the caller's rng lays the buildings and the ground).
import { CELL } from "./combat.js";
import { DOOR_KINDS } from "./buildingmaps.js"; // call-time only (buildingmaps.js builds the complexes through prison.js)

/** @typedef {{ cells: any[], name: string }} Floor */
/** @typedef {{ W: number, H: number, floors: Floor[], cells: any[], areas: any[], containers: any[], lockedDoors: any[], stairs: number[][], runs: any[], cid: number, buildings: any[], keep: Uint8Array, owner: Int16Array }} Grid */

const floorName = (g, n) => (g === 0 ? "Ground floor" : g === n - 1 ? "Top floor" : `Floor ${g + 1}`);
/** @param {number} W @param {number} H @param {number} storeys @param {(x: number, y: number) => string} groundF @returns {Grid} */
export function complexGrid(W, H, storeys, groundF) {
  const cells = Array.from({ length: W * H }, (_, i) => ({ k: "open", f: groundF(i % W, (i / W) | 0) }));
  const floors = [{ cells, name: floorName(0, storeys) }];
  for (let g = 1; g < storeys; g++) floors.push({ cells: Array.from({ length: W * H }, () => ({ k: "void", f: "air" })), name: floorName(g, storeys) });
  // owner: the building a cell belongs to (-1 the open ground), so the ground's dressing and the connectors keep off them.
  return { W, H, floors, cells, areas: [], containers: [], lockedDoors: [], stairs: [], runs: [], cid: 1, buildings: [], keep: new Uint8Array(W * H), owner: new Int16Array(W * H).fill(-1) };
}

// A decor record's sides turned front to back (decor.js flipDecoY), passed in so this module needs nothing of decor.js.
/** @param {Grid} G @param {any} m @param {number} x0 @param {number} y0 @param {{ k?: number, name: string, flip?: boolean, flipDeco?: (c: any) => void, ring?: number, extra?: any }} o */
export function stampBuilding(G, m, x0, y0, o) {
  const W = G.W, B = m.building, k = o.k ?? G.buildings.length, base = G.areas.length, flip = !!o.flip;
  const tx = (x) => x0 + (x - B.x0);
  const ty = (y) => (flip ? y0 + (B.y0 + B.h - 1 - y) : y0 + (y - B.y0));
  const rectOf = (r) => ({ x0: tx(r.x0), y0: flip ? ty(r.y0 + r.h - 1) : ty(r.y0), w: r.w, h: r.h });
  (m.floors || [{ cells: m.cells }]).forEach((F, g) => {
    if (!G.floors[g]) return;
    const dst = G.floors[g].cells, cars = new Map(); // a car in a bay: its cells take the id of their new top-left cell
    for (let y = B.y0; y < B.y0 + B.h; y++) for (let x = B.x0; x < B.x0 + B.w; x++) {
      const c = { ...F.cells[y * m.w + x] }, X = tx(x), Y = ty(y);
      if (flip && c.k === "stairs" && c.dir >= 2) c.dir = c.dir === 2 ? 3 : 2; // a run's way up, turned with the building
      if (flip && (c.fc === "n" || c.fc === "s")) c.fc = c.fc === "n" ? "s" : "n"; // roomlayout.js: a piece's front turns too
      if (c.pc) c.pc += 10000 * (k + 1); // a piece's number, the map's own
      if (flip && o.flipDeco) o.flipDeco(c);
      if (c.car) {
        c.car = { ...c.car };
        if (flip) { if (c.car.ax === "y") c.car.i = c.car.L - 1 - c.car.i; else c.car.j = 1 - c.car.j; }
        const e = cars.get(c.car.id) || { x: X, y: Y, list: [] };
        e.x = Math.min(e.x, X); e.y = Math.min(e.y, Y); e.list.push(c.car);
        cars.set(c.car.id, e);
      }
      dst[Y * W + X] = c;
      if (g === 0) G.owner[Y * W + X] = k;
    }
    for (const e of cars.values()) for (const car of e.list) car.id = e.y * W + e.x + 1;
  });
  const rooms = [];
  for (const a of m.rooms) {
    if (a.outdoor) continue; // the building's own ground (its margins) is the map's now
    rooms.push(base + a.id);
    G.areas.push({ ...a, ...rectOf(a), id: base + a.id, name: `${a.name}, ${o.name}`, doors: (a.doors || []).map(([x, y]) => [tx(x), ty(y)]), house: k, ...(o.extra || {}) });
  }
  // Room ids must run 0..n-1 (areas[id] is the room with that id): a building's outdoor areas leave gaps, so close them.
  const remap = new Map();
  for (let i = base; i < G.areas.length; i++) { remap.set(G.areas[i].id, i); G.areas[i].id = i; }
  for (const c of m.containers) {
    const area = remap.has(base + c.area) ? remap.get(base + c.area) : null;
    if (area == null) continue; // on the building's own lot (a wreck, a pump): not copied
    const A = G.areas[area];
    const what = String(c.label || "").split(": ").slice(1).join(": ") || c.kind;
    G.containers.push({ ...c, id: G.cid++, x: tx(c.x), y: ty(flip ? c.y + (c.h || 1) - 1 : c.y), area, house: k, label: `${A ? A.name : o.name}: ${what}` });
  }
  for (const d of m.lockedDoors) G.lockedDoors.push({ ...d, x: tx(d.x), y: ty(d.y), area: d.area == null ? null : remap.has(base + d.area) ? remap.get(base + d.area) : null });
  for (const [x, y] of m.stairs || []) G.stairs.push([tx(x), ty(y)]);
  for (const r of m.runs || []) G.runs.push({ ...r, x: tx(r.x), y: ty(r.y), dy: flip ? -r.dy : r.dy, house: k });
  // The ring round it stays clear of the ground's dressing.
  const ring = o.ring ?? 1;
  for (let y = y0 - ring; y < y0 + B.h + ring; y++) for (let x = x0 - ring; x < x0 + B.w + ring; x++) if (x >= 0 && y >= 0 && x < W && y < G.H) G.keep[y * W + x] = 1;
  const rec = { k, name: o.name, key: m.key, x0, y0, w: B.w, h: B.h, flip, storeys: m.storeys || 1, front: m.front ? { x: tx(m.front.x), y: ty(m.front.y) } : null, rooms, exits: (m.exits || []).map((e) => ({ side: flip && (e.side === "front" || e.side === "back") ? (e.side === "front" ? "back" : "front") : e.side, cells: (e.cells || []).map(([x, y]) => [tx(x), ty(y)]) })), ...(o.extra || {}) };
  G.buildings.push(rec);
  return rec;
}

const isFloor = (c) => !!c && c.f === "floor" && (c.k === "open" || c.k === "loft");
const isOuter = (c) => !!c && (c.k === "wall" || c.k === "window");
/**
 * A corridor between two stamped buildings (see the header). a, b: their records (stampBuilding).
 * @param {Grid} G @param {any} a @param {any} b @param {{ width?: number, name?: string, dk?: string, sally?: boolean, fl?: string, k?: number }} [o]
 */
export function connectBuildings(G, a, b, o = {}) {
  const W = G.W, cw = o.width || 2, cells = G.cells, at = (x, y) => cells[y * W + x];
  const open = (x, y) => x >= 0 && y >= 0 && x < W && y < G.H && at(x, y).k === "open" && G.owner[y * W + x] < 0 && at(x, y).f !== "floor";
  // Along y (one above the other) or along x (side by side): the span both walls share, less a cell at each corner.
  const vert = a.y0 + a.h <= b.y0 || b.y0 + b.h <= a.y0;
  const [P, Q] = vert ? (a.y0 < b.y0 ? [a, b] : [b, a]) : a.x0 < b.x0 ? [a, b] : [b, a];
  const lo = vert ? Math.max(P.x0, Q.x0) + 1 : Math.max(P.y0, Q.y0) + 1;
  const hi = vert ? Math.min(P.x0 + P.w, Q.x0 + Q.w) - 2 - (cw - 1) : Math.min(P.y0 + P.h, Q.y0 + Q.h) - 2 - (cw - 1);
  if (hi < lo) return null;
  const s0 = vert ? P.y0 + P.h - 1 : P.x0 + P.w - 1, s1 = vert ? Q.y0 : Q.x0; // the two walls (rows or columns)
  if (s1 - s0 < 2) return null;
  const xy = (t, s) => (vert ? [t, s] : [s, t]); // t: across the corridor, s: along it
  const mid = (lo + hi) / 2, cands = [];
  for (let t = lo; t <= hi; t++) cands.push(t);
  cands.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
  for (const t0 of cands) {
    // The corridor's own cells and its side walls must be open ground; a door column: a floor cell behind each wall.
    let ok = true;
    for (let s = s0 + 1; s < s1 && ok; s++) for (let t = t0 - 1; t <= t0 + cw; t++) { const [x, y] = xy(t, s); if (!open(x, y)) ok = false; }
    if (!ok) continue;
    const dc = [];
    for (let t = t0; t < t0 + cw; t++) {
      const [px, py] = xy(t, s0), [qx, qy] = xy(t, s1), [pi, pj] = xy(t, s0 - 1), [qi, qj] = xy(t, s1 + 1);
      if (isOuter(at(px, py)) && isOuter(at(qx, qy)) && isFloor(at(pi, pj)) && isFloor(at(qi, qj))) dc.push(t);
    }
    if (!dc.length) continue;
    const td = dc[0], dk = o.dk || "steel", K = DOOR_KINDS[dk] || { hp: 60 };
    const id = G.areas.length;
    const door = (x, y) => { const c = at(x, y); c.k = "idoor"; c.dk = dk; c.hp = c.mhp = K.hp; delete c.win; delete c.t; c.f = "floor"; c.fl = o.fl || "conc"; c.conn = id; };
    for (let s = s0 + 1; s < s1; s++) for (let t = t0 - 1; t <= t0 + cw; t++) {
      const [x, y] = xy(t, s), c = at(x, y);
      c.f = "floor";
      if (t < t0 || t >= t0 + cw) { c.k = "wall"; } else { c.k = "open"; c.fl = o.fl || "conc"; }
      G.owner[y * W + x] = o.k ?? 1000 + id; // a connector's own (keeps the dressing off it)
      G.keep[y * W + x] = 1;
    }
    const ends = [xy(td, s0), xy(td, s1)];
    for (const [x, y] of ends) door(x, y);
    if (o.sally && s1 - s0 - 1 >= 5) { // a cross wall in the middle with a door: two doors with a space between
      const sm = Math.floor((s0 + s1) / 2);
      for (let t = t0; t < t0 + cw; t++) { const [x, y] = xy(t, sm), c = at(x, y); if (t === td) door(x, y); else c.k = "wall"; }
      ends.push(xy(td, sm));
    }
    const [x0, y0] = xy(t0 - 1, s0), [x1, y1] = xy(t0 + cw, s1);
    const area = { id, f: 0, type: null, role: "corridor", name: o.name || "Corridor", x0: Math.min(x0, x1), y0: Math.min(y0, y1), w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1, doors: ends.map((p) => p.slice()), hub: true, locked: null, up: false, entry: false, noLabel: false, conn: [a.k, b.k], len: s1 - s0 - 1 };
    G.areas.push(area);
    for (const B of [a, b]) { const r = G.areas[B.rooms.find((i) => { const A = G.areas[i]; return A.f === 0 && ends.some(([x, y]) => x >= A.x0 && x < A.x0 + A.w && y >= A.y0 && y < A.y0 + A.h); }) ?? -1]; if (r) r.doors.push(...ends.filter(([x, y]) => x >= r.x0 && x < r.x0 + r.w && y >= r.y0 && y < r.y0 + r.h).map((p) => p.slice())); }
    return area;
  }
  return null;
}

/** The walk guard over the ground floor (see the header). @param {Grid} G @param {[number, number]} start */
export function guard(G, start) {
  const W = G.W, H = G.H, N = W * H, cells = G.cells;
  const passable = (c) => !!(CELL[c.k] && CELL[c.k].walk) || c.k === "door" || c.k === "idoor" || c.k === "odoor";
  const pass = new Uint8Array(N);
  let total = 0;
  for (let i = 0; i < N; i++) { pass[i] = passable(cells[i]) ? 1 : 0; total += pass[i]; }
  const seen = new Uint32Array(N), stack = new Int32Array(N), s0 = start[1] * W + start[0];
  let stamp = 0;
  const connected = () => {
    stamp++;
    let sp = 0, got = 1;
    stack[sp++] = s0; seen[s0] = stamp;
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
  const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && cells[y * W + x].k === "open" && !G.keep[y * W + x] && G.owner[y * W + x] < 0;
  // check: false lays it without the flood (the caller knows it cuts nothing off: a cell with walkable ground round it
  // on every side is checked cheaply first).
  const block = (x, y, k, check = true) => {
    if (!free(x, y)) return false;
    const i = y * W + x, c = cells[i];
    c.k = k;
    const p = passable(c) ? 1 : 0;
    if (p === pass[i]) return true;
    pass[i] = p; total--;
    if (check && !surrounded(x, y) && !connected()) { c.k = "open"; pass[i] = 1; total++; return false; }
    return true;
  };
  // All eight cells round it walkable: blocking it cuts nothing off.
  const surrounded = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H || !pass[Y * W + X]) return false; } return true; };
  const sync = (i) => { const p = passable(cells[i]) ? 1 : 0; total += p - pass[i]; pass[i] = p; };
  return { block, free, connected, sync, pass };
}

/** The map a raid reads (see the header). @param {Grid} G @param {{ key: string, id: string, name: string }} option @param {{ kind: string, zones: any[], vehicle?: any, front?: any, extra?: any }} o */
export function finishComplex(G, option, o) {
  const zones = o.zones;
  const zoneExits = () => zones.slice(1).map((z, j) => ({ side: z.side, name: z.name, x: z.x0 + 1, y: z.y0 + 1, cells: [], locked: null, roller: false, zone: j + 1 }));
  const rects = G.buildings.map((h) => ({ x0: h.x0, y0: h.y0, w: h.w, h: h.h }));
  const storeys = G.floors.length;
  const plan = {
    key: option.key, id: option.id, name: option.name, w: G.W, h: G.H, street: true, complex: o.kind, building: rects[0], buildings: rects.map((r) => ({ ...r })),
    houses: G.buildings.map((h) => ({ k: h.k, name: h.name, key: h.key, ...rectOf(h), front: h.front, storeys: h.storeys, rooms: G.areas.filter((a) => a.house === h.k).map((a) => a.id), ...(h.role ? { role: h.role } : {}) })),
    tall: true, storeys, stairs: G.stairs.map((s) => s.slice()), runs: G.runs.map((r) => ({ ...r })),
    rooms: G.areas.filter((a) => !a.outdoor).map((a) => ({ id: a.id, f: a.f, name: a.name, role: a.role, type: a.type, x0: a.x0, y0: a.y0, w: a.w, h: a.h, locked: a.locked, up: a.up, hub: a.hub, entry: a.entry, house: a.house, ...(a.civic ? { civic: a.civic } : {}), ...(a.prison ? { prison: a.prison } : {}) })),
    front: o.front || (G.buildings[0] && G.buildings[0].front), exits: zoneExits(), ...(o.extra || {}),
  };
  return { w: G.W, h: G.H, cells: G.cells, rooms: G.areas, containers: G.containers, zones, vehicle: o.vehicle || null, exits: zoneExits(), front: plan.front, lockedDoors: G.lockedDoors, plan, building: plan.building, buildings: plan.buildings, floors: G.floors, stairs: G.stairs, runs: G.runs, storeys, street: true, complex: o.kind };
}
const rectOf = (h) => ({ x0: h.x0, y0: h.y0, w: h.w, h: h.h });
