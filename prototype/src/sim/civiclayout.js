// @ts-check
// Civic layouts: police stations, fire stations, schools and churches furnished for their kind (the user's request
// 2026-10-25, issue #15 of the interiors epic #7: "Special buildings like hospitals, police stations etc should have
// furniture, appliances, decor, rooms and layouts that make sense for the type of building."). The room styles, on
// roomlayout.js's placement helpers (lanes kept clear between the doors and to the stairs, backs to the walls, a door's
// front never taken, the lootable pieces the containers); buildingmaps.js assemble runs a room's style when its plan leaf
// carries civic: <style> (civicStyle), which only the new saves' plans set (an older save's buildings keep their layouts:
// worldcfg.js legacyRooms). Hospitals (#14) and shops (#16) keep their own tables.
//
// The styles (CIVIC_STYLES, by the leaf's civic mark):
//   Police: frontdesk (a counter, chairs for the public along the front wall), squad (desks in pairs with their chairs,
//   filing cabinets, a coffee corner: a fridge and a microwave), interview (a table and two chairs, a one-way window into
//   the observation nook beside it: a fixed window cell in the wall between), observation (a chair at the window), chief
//   (a desk and its chair, a bookshelf, a filing cabinet, a cabinet the gun safe may take: locks.js placeGunSafes),
//   plockers (lockers in a row, a shower, a toilet and a sink), armory (gun racks on the walls, an ammo cabinet, a
//   locker for the gun safe), evidence (evidence lockers, shelves), cells (2–6 cells along the back wall, each a bunk, a
//   toilet and a sink behind bars with a cell door: DOOR_KINDS.cell), sallyport (one or two police cars: combat.js
//   placeCar with a light bar, each a container), dispatch (desks, a server rack), records (filing cabinets), briefing
//   (chairs in rows facing a lectern and the whiteboard), breakroom (a fridge, a microwave, a sink, a table and chairs).
//   Fire station: enginebay (the fire engine: a truck of 2 × 5 cells, a container; an ambulance in the second bay or
//   an empty one; turnout lockers along a wall, an air compressor), fdayroom (a TV, sofas facing it, armchairs, a table
//   and chairs), fkitchen (two fridges, the stoves, a sink, a long table), fdorm (bunks, a locker by each), fgym (weight
//   benches), watch (a desk, a server rack of radios), fworkshop (a workbench, a tool chest, a compressor), medstore
//   (medicine cabinets and shelves).
//   School: classroom (school desks in rows facing the whiteboard wall: the teacher's desk against it, the whiteboard
//   above; a bookshelf at the back), schoolhall (a corridor lined with narrow lockers: many small draws), cafeteria
//   (long tables with chairs, a serving counter), skitchen (stoves, fridges, a sink, counters), walkin (a walk-in cold
//   room behind its cold room door: a chest freezer, shelves), gym (bleachers along the longest wall, a storage cage of
//   bats and sticks), library (bookshelves, a desk, a photocopier, reading tables), nurse (a cot, medicine cabinets),
//   principal (a desk, a bookshelf, a filing cabinet, a cabinet), staffroom (a sofa, a fridge, a microwave, a copier, a
//   table), sciencelab (lab benches, a sink, a cabinet), shopclass (workbenches, a tool chest), slobby (a reception counter, chairs).
//   Shared: washroom (a restroom's or a station bathroom's toilet, sink and shower).
//   Church: narthex (a table of leaflets, chairs), nave (pews in two columns either side of a centre aisle that runs to
//   the altar, all facing it; the pulpit, candlesticks and a piano or an organ by the altar), vestry (a wardrobe of
//   robes, a desk, a cabinet), parishhall (a kitchen along one wall, long tables, chairs stacked on a wall), cpantry
//   (shelves of tins: the food bank), belltower (nothing: the loft mechanic raises it, a ladder up).
// The whiteboard (a classroom's, a briefing room's) is put on the wall the desks face (c.wart, decor.js's wall art,
// placed before decorate so its other art keeps off it). The decor by style: decor.js DECOR_CIVIC.
import { hash01 } from "./skills.js";
import { pieceDef } from "./data-furniture.js";
import { registerScene, SCENES } from "./interiorscenes.js"; // the civic buildings' signs of survival (issue #11's hook)
import { BMAP } from "./buildingmaps.js"; // call-time only (buildingmaps.js imports this module)

export const CIVIC = {
  CELLS: [2, 6],        // cells along a cell block's back wall
  DESK_AREA: 10,        // a squad room's or a dispatch room's desks: one a this many cells
  AMBULANCE: 0.5,       // a fire station's second bay holds an ambulance (else it is empty)
  POLICE_CARS: [1, 2],  // a sally port's cars
  CLASS_BOOKS: 0.5,     // a classroom's bookshelf at the back (the school's loot as it was: tools/interiortest.js)
};
const OPP = { n: "s", s: "n", w: "e", e: "w" };
const D4 = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
const ART_D = { n: 2, s: 3, w: 0, e: 1 }; // decor.js wall art's d (toward the room) for a wall on this side

/** @typedef {any} Lay */
// The cells along wall `side` inside the room (row or column against it).
function line(L, side) {
  const c = L.c, out = [];
  if (side === "n" || side === "s") { const y = side === "n" ? c.y0 : c.y1; for (let x = c.x0; x <= c.x1; x++) out.push([x, y]); }
  else { const x = side === "w" ? c.x0 : c.x1; for (let y = c.y0; y <= c.y1; y++) out.push([x, y]); }
  return out;
}
// The wall with no door in it, longest first (else the longest): the wall a room's desks face.
function quietWall(L, salt = "") {
  const c = L.c, doors = L.room.doors || [];
  const doorOn = (side) => doors.some(([x, y]) => (side === "n" ? y === c.y0 - 1 : side === "s" ? y === c.y1 + 1 : side === "w" ? x === c.x0 - 1 : x === c.x1 + 1));
  const sides = ["n", "s", "w", "e"].map((s, i) => ({ s, len: s === "n" || s === "s" ? c.w : c.h, door: doorOn(s), j: hash01(c.seed, "quiet", L.room.id, salt, i) }));
  sides.sort((a, b) => (a.door ? 1 : 0) - (b.door ? 1 : 0) || b.len - a.len || a.j - b.j);
  return sides[0].s;
}
// A whiteboard on the wall cell behind the middle of `side` (a wall, not a window or a door), unless the map is bare
// (tools/decortest.js).
function whiteboard(L, side) {
  const c = L.c;
  if (!c.decor) return null;
  const [dx, dy] = D4[side];
  const cells = line(L, side).map((p, i, all) => [...p, Math.abs(i - (all.length - 1) / 2)]).sort((p, q) => p[2] - q[2]);
  for (const [x, y] of cells) {
    const wx = x + dx, wy = y + dy;
    if (c.kindAt(wx, wy) !== "wall" || c.ridAt(wx, wy) !== -1) continue; // a wall cell (a window either side will do)
    const cl = c.cell(wx, wy);
    if (cl.wart) continue;
    cl.wart = { k: "whiteboard", d: ART_D[side] };
    return [wx, wy];
  }
  return null;
}
// Rows of k facing the wall `side` (school desks before a whiteboard, chairs before a lectern): from two cells off that
// wall, every other row, every other cell along it (the gaps the aisles); never on a lane. At most `most`.
function rowsFacing(L, k, side, most = 99) {
  const c = L.c, along = side === "n" || side === "s";
  const len = along ? c.w : c.h, depth = along ? c.h : c.w;
  const off = L.variant(2, `rows${k}`);
  let n = 0;
  for (let d = 2; d < depth && n < most; d += 2) {
    for (let a = off; a < len && n < most; a += 2) {
      const x = along ? c.x0 + a : side === "w" ? c.x0 + d : c.x1 - d;
      const y = along ? (side === "n" ? c.y0 + d : c.y1 - d) : c.y0 + a;
      if (L.place(k, [[x, y]], { face: side })) n++;
    }
  }
  return n;
}
// A desk (2 × 1) off the walls with a chair at it; face: the way its front looks.
function deskWithChair(L, face = null) {
  const d = L.centre("desk", face ? { face } : {});
  if (d) L.around(d, "chair", 1);
  return d;
}
// A piece taken back up (its cells open again).
function unplace(L, rec) {
  for (const [x, y] of rec.cells) L.c.unblock(x, y);
  const i = L.placed.indexOf(rec);
  if (i >= 0) L.placed.splice(i, 1);
}
// Two chairs facing each other across a table (an interview room's): either side of it, off the lanes where they can be.
function facingPair(L, t) {
  const [x, y] = t.cells[0];
  for (const force of [false, true]) for (const [[ax, ay], [bx, by]] of [[[-1, 0], [1, 0]], [[0, -1], [0, 1]]]) {
    const a = [x + ax, y + ay], b = [x + bx, y + by];
    if (!L.ok(a[0], a[1], force) || !L.ok(b[0], b[1], force)) continue;
    const pa = L.place("chair", [a], { face: ax ? "e" : "s", force }), pb = pa && L.place("chair", [b], { face: ax ? "w" : "n", force });
    if (pa && pb) return 2;
    if (pa) unplace(L, pa); // both or neither
  }
  return L.around(t, "chair", 2);
}
// A table and chairs round it; long: two tables end to end.
function tableSet(L, chairs = 4, long = false) {
  const t = L.centre("table");
  if (!t) return null;
  let cells = t.cells;
  if (long) { const [x, y] = t.cells[0]; const t2 = L.place("table", [[x + 1, y]]) || L.place("table", [[x - 1, y]]); if (t2) cells = [...cells, ...t2.cells]; }
  L.around({ ...t, cells }, "chair", chairs);
  return t;
}
// Up to n of k along the walls (a row of lockers), within the room's share of containers when k holds loot.
function rowOf(L, k, n, sides) {
  let made = 0;
  for (let i = 0; i < n; i++) {
    if (L.boxes() >= L.target() && isLoot(L, k)) break;
    if (!L.wall(k, { sides, prefer: "corner" })) break;
    made++;
  }
  return made;
}
const isLoot = (L, k) => !!(pieceDef(k) && pieceDef(k).loot);
// A bathroom corner (a locker room's): a shower, a toilet, a sink.
function washCorner(L) {
  L.wall("shower", { prefer: "corner" });
  L.wall("toilet", { prefer: "corner" });
  L.wall("sink", { prefer: "corner" });
}
// A kitchen's counter run along its longest wall (and the next), then what it must have.
function kitchen(L, kinds) {
  const ws = L.walls();
  if (!ws.length) return;
  L.run(kinds, ws.slice(0, 2).map((w) => w.side));
  for (const k of ["fridge", "sink", "stove"]) if (kinds.includes(k) && !L.has(k)) L.need(k);
}
// A vehicle in the room by its door (the roller door's when it has one): a rect off the lanes, else anywhere it fits.
function vehicleIn(L, o) {
  const c = L.c, doors = L.room.doors || [];
  const roll = doors.filter(([x, y]) => c.cell(x, y) && c.cell(x, y).roll);
  const at = roll.length ? roll : doors;
  const dmid = at.length ? [at.reduce((a, p) => a + p[0], 0) / at.length, at.reduce((a, p) => a + p[1], 0) / at.length] : [(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2];
  const sideways = at.length && (at[0][0] < c.x0 || at[0][0] > c.x1); // a door in a side wall: the vehicle lies along x
  const ax = o.ax || (sideways ? "x" : "y");
  const [w, h] = ax === "x" ? [o.len, 2] : [2, o.len];
  const cands = [];
  for (let y = c.y0; y + h - 1 <= c.y1; y++) for (let x = c.x0; x + w - 1 <= c.x1; x++) {
    let lane = 0, ok = true;
    for (let yy = y; yy < y + h && ok; yy++) for (let xx = x; xx < x + w; xx++) { if (!c.free(xx, yy)) { ok = false; break; } if (L.lane(xx, yy)) lane++; }
    if (!ok) continue;
    const d = Math.hypot(x + (w - 1) / 2 - dmid[0], y + (h - 1) / 2 - dmid[1]);
    cands.push({ x, y, score: lane * 6 + d + hash01(c.seed, "veh", L.room.id, o.body, x, y) * 0.5 });
  }
  cands.sort((a, b) => a.score - b.score);
  for (const cd of cands.slice(0, 24)) { const r = c.vehicle(cd.x, cd.y, { ...o, ax }); if (r) return r; }
  return null;
}
// The one-way window between an interview room and its observation nook: a wall cell between the two rooms (not by a
// door), glass that does not open (windows.js: fixed).
function oneWay(L) {
  const c = L.c;
  const cands = [];
  for (const side of ["n", "s", "w", "e"]) {
    const [dx, dy] = D4[side];
    for (const [x, y] of line(L, side)) {
      const wx = x + dx, wy = y + dy, ox = wx + dx, oy = wy + dy;
      if (c.kindAt(wx, wy) !== "wall" || c.ridAt(wx, wy) !== -1) continue;
      const other = c.roomAt(ox, oy);
      if (!other || other.civic !== "observation") continue;
      const nearDoor = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ex, ey]) => ["idoor", "odoor", "door"].includes(c.kindAt(wx + ex, wy + ey) || ""));
      if (!nearDoor) cands.push([wx, wy]);
    }
  }
  if (!cands.length) return null;
  const [wx, wy] = cands[Math.floor(cands.length / 2)];
  const cl = c.cell(wx, wy);
  cl.k = "window"; cl.win = { open: false, lock: "fixed", known: true }; cl.oneway = true; delete cl.t;
  return [wx, wy];
}

// ---------- the cells ----------
// A cell block: cells of 2 × 3 along the back wall (the wall with no door), each a bunk, a toilet and a sink behind a row
// of bars with a cell door in it, bars between the cells; the cells' doors open onto the walkway. A cell is laid all or
// none (never by a door; a lane across the back rows is moved to the walkway in front of the cells: block's
// connectivity guard keeps every way open); the walkway keeps the rest: lockers for the prisoners' things.
function cellBlock(L) {
  const c = L.c;
  if (c.w < 2 || c.h < 5) return 0;
  const doors = L.room.doors || [];
  const doorNear = (x, y) => doors.some(([dx, dy]) => Math.abs(dx - x) <= 1 && Math.abs(dy - y) <= 1) || [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([ex, ey]) => ["stairs", "ladder"].includes(c.kindAt(x + ex, y + ey) || ""));
  const side = doors.some(([, y]) => y === c.y0 - 1) && !doors.some(([, y]) => y === c.y1 + 1) ? "s" : "n";
  const sy = side === "n" ? 1 : -1, yb0 = side === "n" ? c.y0 : c.y1; // the back row; rows run toward the walkway
  const row = (i) => yb0 + sy * i; // i 0..2 the cell, 3 the bars
  const fits = (xa) => {
    const xb = xa + 1;
    if (xa < c.x0 || xb > c.x1) return false;
    for (let i = 0; i <= 3; i++) for (const x of [xa, xb]) if (!c.free(x, row(i)) || doorNear(x, row(i))) return false;
    return c.free(xb, row(4));
  };
  // The cells' columns from the west wall or from the east one, whichever fits more (a door by one end).
  const plan = (dir) => {
    const out = [];
    for (let xa = dir > 0 ? c.x0 : c.x1 - 1; xa >= c.x0 && xa + 1 <= c.x1 && out.length < CIVIC.CELLS[1];) {
      if (fits(xa) && !out.some((p) => Math.abs(p - xa) < 3)) { out.push(xa); xa += 3 * dir; } else xa += dir;
    }
    return out;
  };
  const ltr = plan(1), rtl = plan(-1);
  const cols = rtl.length > ltr.length ? rtl : ltr;
  let made = 0;
  for (const xa of cols) {
    const xb = xa + 1;
    const all = [];
    for (let i = 0; i <= 3; i++) all.push([xa, row(i)], [xb, row(i)]);
    if (!fits(xa)) continue;
    // The door first (the cell stays reachable while its bars go up), then the bars, the pieces, the bars between.
    if (!c.block(xb, row(3), "idoor")) continue;
    const door = c.cell(xb, row(3));
    door.cellDoor = true; // buildingmaps.js: a cell door (DOOR_KINDS.cell)
    door.cellIn = [xb, row(2)]; // the cell's floor inside its door (the scenes: a prisoner locked in)
    c.keep(xb, row(4)); c.keep(xb, row(2));
    const ok = c.block(xa, row(3), "bars") && !!L.place("bunk", [[xa, row(0)], [xa, row(1)]], { face: "e", force: true }) &&
      !!L.place("toilet", [[xa, row(2)]], { face: "e", force: true }) && !!L.place("sink", [[xb, row(0)]], { face: OPP[side], force: true });
    if (!ok) { for (const [x, y] of all) if (c.kindAt(x, y) !== "open") c.unblock(x, y); delete door.cellDoor; delete door.cellIn; continue; } // all or none
    for (const x of cols === rtl ? [xa - 1] : [xb + 1]) if (x >= c.x0 && x <= c.x1) for (let i = 0; i <= 3; i++) c.block(x, row(i), "bars"); // the bars between the cells
    made++;
  }
  return made;
}

/** @type {Record<string, (L: Lay) => void>} */
export const CIVIC_STYLES = {
  // ---------- police ----------
  frontdesk(L) {
    const c = L.c, back = quietWall(L, "desk");
    const desk = L.wall("counter", { sides: [back], prefer: "middle" }) || L.need("counter");
    if (desk) L.around(desk, "chair", 1);
    L.run(["chair", "chair", "chair", "chair"].slice(0, Math.max(2, Math.floor(c.w / 2))), [OPP[back]]);
  },
  squad(L) {
    const fridge = L.wall("fridge", { prefer: "corner" });
    if (fridge) L.beside(fridge, "microwave");
    const n = Math.max(1, Math.min(4, Math.floor((L.c.w * L.c.h) / CIVIC.DESK_AREA)));
    for (let i = 0; i < n; i++) if (!deskWithChair(L, i % 2 ? "n" : "s")) break;
    rowOf(L, "filing", 2);
  },
  interview(L) {
    const t = L.centre("table") || L.centre("table", { force: true }) || L.need("table"); // off the walls even over a lane (the way goes round it)
    if (t) facingPair(L, t);
    oneWay(L);
  },
  observation(L) {
    L.wall("chair", { prefer: "middle" });
  },
  chief(L) {
    deskWithChair(L) || L.need("desk");
    L.wall("cabinet", { prefer: "corner" }); // the gun safe may take it (locks.js placeGunSafes)
    L.wall("bookshelf", { prefer: "corner" });
    rowOf(L, "filing", 1);
  },
  plockers(L) {
    const side = L.walls()[0];
    rowOf(L, "locker", 4, side ? [side.side] : undefined);
    washCorner(L);
  },
  armory(L) {
    L.wall("locker", { prefer: "corner" }); // a locker of the armory's own (the gun safe takes one: locks.js placeGunSafes)
    L.wall("ammocab", { prefer: "corner" });
    const side = L.walls()[0];
    rowOf(L, "gunrack", 3, side ? [side.side] : undefined);
  },
  evidence(L) {
    const side = L.walls()[0];
    rowOf(L, "evlocker", 2, side ? [side.side] : undefined);
    L.fill(["shelf", "evlocker"]);
  },
  cells(L) {
    cellBlock(L);
    L.fill(["locker"]);
  },
  sallyport(L) {
    const n = L.variant(2, "cars") ? CIVIC.POLICE_CARS[1] : CIVIC.POLICE_CARS[0];
    for (let i = 0; i < n; i++) if (!vehicleIn(L, { kind: "car", len: 4, body: "police", box: "policecar" })) break;
    L.fill(["shelf"]);
  },
  dispatch(L) {
    const n = Math.max(1, Math.min(3, Math.floor((L.c.w * L.c.h) / CIVIC.DESK_AREA)));
    for (let i = 0; i < n; i++) if (!deskWithChair(L)) break;
    L.wall("serverrack", { prefer: "corner" });
  },
  records(L) {
    L.fill(["filing"]);
    L.wall("copier", { prefer: "corner" });
  },
  briefing(L) {
    const side = quietWall(L, "brief");
    L.wall("pulpit", { sides: [side], prefer: "middle" });
    whiteboard(L, side);
    rowsFacing(L, "chair", side, 12);
  },
  breakroom(L) {
    kitchen(L, ["fridge", "sink", "microwave"]);
    tableSet(L, 4);
    L.fill(["cabinet"]);
  },
  // ---------- fire station ----------
  enginebay(L) {
    vehicleIn(L, { kind: "truck", len: 5, body: "engine", box: "engine" });
    if (hash01(L.c.seed, "ambulance", L.room.id) < CIVIC.AMBULANCE) vehicleIn(L, { kind: "truck", len: 4, body: "ambulance", box: "ambulance" });
    const ws = L.walls();
    rowOf(L, "turnout", 4, ws.length ? [ws[0].side] : undefined);
    L.wall("compressor", { prefer: "corner" });
    L.fill(["shelf"]);
  },
  fdayroom(L) {
    const tv = L.wall("tvstand", { prefer: "middle" });
    const sofa = (tv && L.facing(tv, "sofa")) || L.wall("sofa", { prefer: "middle" });
    L.centre("armchair", sofa ? { near: sofa.cells[0] } : {}) || L.wall("armchair", { prefer: "corner" });
    L.wall("armchair", { prefer: "corner" });
    tableSet(L, 4);
    L.fill(["bookshelf", "cabinet"]);
  },
  fkitchen(L) {
    kitchen(L, ["fridge", "fridge", "sink", "stove", "oven"]);
    tableSet(L, 6, true);
    L.fill(["cabinet"]);
  },
  fdorm(L) {
    const n = Math.max(1, Math.min(6, Math.floor((L.c.w * L.c.h) / 6)));
    for (let i = 0; i < n; i++) {
      const bunk = L.wall("bunk", { prefer: "corner" });
      if (!bunk) break;
      if (L.boxes() < L.target()) L.beside(bunk, "locker");
    }
    if (!L.has("bunk")) L.need("bunk");
    L.fill(["locker"]);
  },
  fgym(L) {
    L.centre("weightbench") || L.wall("weightbench");
    L.wall("weightbench", { prefer: "corner" });
    L.fill(["locker"]);
  },
  watch(L) {
    deskWithChair(L) || L.need("desk");
    L.wall("serverrack", { prefer: "corner" });
    L.fill(["filing"]);
  },
  fworkshop(L) {
    const bench = L.wall("workbench", { prefer: "corner" }) || L.need("workbench");
    if (bench) L.beside(bench, "toolchest");
    L.wall("compressor", { prefer: "corner" });
    L.fill(["toolchest", "shelf"]);
  },
  medstore(L) {
    L.fill(["medcab", "shelf"]);
  },
  // ---------- school ----------
  classroom(L) {
    const side = quietWall(L, "class");
    L.wall("teacherdesk", { sides: [side], prefer: "middle" }) || L.wall("teacherdesk", { sides: [side] });
    whiteboard(L, side);
    if (!rowsFacing(L, "schooldesk", side, 16)) L.need("schooldesk", { face: side });
    if (hash01(L.c.seed, "books", L.room.id) < CIVIC.CLASS_BOOKS) L.wall("bookshelf", { sides: [OPP[side]], prefer: "corner" });
  },
  schoolhall(L) {
    // Narrow lockers along both walls between the doors (every one a small draw), up to the hall's share.
    // A hall two cells wide whose lanes take both rows: the second pass lines one wall anyway (block's connectivity
    // guard keeps the way along it open; a door's front is never taken).
    const c = L.c, along = c.w >= c.h;
    for (const force of [false, true]) for (const side of along ? ["n", "s"] : ["w", "e"]) {
      if (force && (L.boxes() * 2 >= L.target() || Math.min(c.w, c.h) < 2)) return;
      for (const [x, y] of line(L, side)) {
        if (L.boxes() >= L.target()) return;
        if (hash01(c.seed, "hall", L.room.id, x, y) < 0.25) continue; // gaps along the run
        L.place("schoollocker", [[x, y]], { face: OPP[side], side, force });
      }
      if (force) return;
    }
  },
  cafeteria(L) {
    const side = L.walls()[0];
    if (side) L.run(["counter", "counter", "counter"], [side.side]);
    const n = Math.max(1, Math.min(4, Math.floor((L.c.w * L.c.h) / 14)));
    for (let i = 0; i < n; i++) if (!tableSet(L, 4, true)) break;
    if (!L.has("table")) { const t = L.need("table"); if (t) L.around(t, "chair", 2); }
  },
  skitchen(L) {
    kitchen(L, ["fridge", "stove", "stove", "oven", "sink"]);
    L.fill(["counter", "shelf"]);
  },
  walkin(L) {
    L.wall("freezer", { prefer: "corner" });
    L.fill(["shelf"]);
  },
  gym(L) {
    const ws = L.walls();
    if (ws.length) for (let i = 0; i < 3; i++) if (!L.wall("bleachers", { sides: [ws[0].side] })) break;
    L.fill(["sportcage"]);
    if (!L.has("sportcage")) L.need("sportcage");
  },
  library(L) {
    L.fill(["bookshelf"]);
    deskWithChair(L);
    L.wall("copier", { prefer: "corner" });
    tableSet(L, 4);
  },
  nurse(L) {
    L.wall("cot", { prefer: "corner" }) || L.need("cot");
    L.fill(["medcab", "cabinet"]);
  },
  principal(L) {
    deskWithChair(L) || L.need("desk");
    L.wall("bookshelf", { prefer: "corner" });
    L.fill(["filing", "cabinet"]);
  },
  staffroom(L) {
    kitchen(L, ["fridge", "sink", "microwave"]);
    L.wall("sofa", { prefer: "middle" });
    L.wall("copier", { prefer: "corner" });
    tableSet(L, 4);
    L.fill(["cabinet"]);
  },
  sciencelab(L) {
    const side = quietWall(L, "lab");
    L.wall("sink", { sides: [side], prefer: "corner" });
    whiteboard(L, side);
    for (let i = 0; i < 3; i++) if (L.boxes() >= L.target() || !L.centre("labbench")) break;
    L.fill(["cabinet"]);
  },
  shopclass(L) {
    const bench = L.wall("workbench", { prefer: "corner" }) || L.need("workbench");
    if (bench) L.beside(bench, "toolchest");
    L.fill(["shelf"]);
  },
  slobby(L) {
    const back = quietWall(L, "desk");
    const desk = L.wall("counter", { sides: [back], prefer: "middle" });
    if (desk) L.around(desk, "chair", 1);
    L.run(["chair", "chair", "chair"], [OPP[back]]);
  },
  // ---------- church ----------
  narthex(L) {
    L.wall("table", { prefer: "middle" }); // the leaflets
    L.wall("chair", { prefer: "corner" });
  },
  nave(L) { naveLayout(L); },
  vestry(L) {
    L.wall("wardrobe", { prefer: "corner" }) || L.need("wardrobe"); // the robes
    deskWithChair(L);
    L.fill(["cabinet"]);
  },
  parishhall(L) {
    kitchen(L, ["stove", "fridge", "sink"]);
    tableSet(L, 4, true);
    const ws = L.walls();
    if (ws.length) L.run(["chair", "chair", "chair"], [ws[ws.length - 1].side]); // stacked along a wall
    L.fill(["cabinet"]);
  },
  cpantry(L) {
    L.fill(["shelf"]);
  },
  belltower() {},
  // ---------- shared ----------
  washroom(L) { // a restroom's or a station's bathroom
    L.need("toilet", { prefer: "corner" });
    L.wall("sink", { prefer: "middle" }) || L.need("sink");
    if (L.c.w * L.c.h >= 6) L.wall("shower", { prefer: "corner" });
  },
};

// The nave: the altar on the back wall (the one away from the narthex), nearest the middle; the centre aisle runs from
// the front to it; pews (2 × 1, facing the altar) in two columns either side of it, a pew's width each side at most,
// rows two cells apart, a side aisle along each wall; the pulpit, candlesticks and a piano by the altar.
export function naveLayout(L) {
  const c = L.c;
  const back = "n"; // the narthex is at the front (+y): the altar on the far wall
  const cx = c.x0 + Math.floor((c.w - 1) / 2);
  let altar = null;
  for (const dx of [0, -1, 1, -2, 2, -3, 3]) {
    const x = cx + dx;
    if (x < c.x0 + 1 || x + 1 > c.x1 - 1) continue;
    altar = L.place("altar", [[x, c.y0], [x + 1, c.y0]], { face: "s", force: true, side: back });
    if (altar) break;
  }
  const aisle = altar ? altar.cells[0][0] : cx;
  L.room.aisle = aisle; // tools/interiortest.js: the centre aisle's column
  if (altar) {
    const [ax, ay] = altar.cells[0];
    L.place("pulpit", [[ax - 2, ay + 1]], { face: "s" }) || L.wall("pulpit", { sides: [back], near: [ax - 2, ay] });
    for (const x of [ax - 1, ax + 2]) if (L.boxes() < L.target()) L.place("candles", [[x, ay]], { face: "s" });
  }
  L.wall("piano", { sides: ["n", "w", "e"], near: altar ? altar.cells[0] : undefined });
  // The pews: rows from two or three cells off the back wall (the chancel) to the front, every other row.
  for (let y = c.y0 + (c.h >= 8 ? 2 : 3); y <= c.y1 - 1; y += 2) {
    for (let x = aisle - 1; x - 1 >= c.x0 + 1; x -= 2) L.place("pew", [[x - 1, y], [x, y]], { face: "n" });
    for (let x = aisle + 1; x + 1 <= c.x1 - 1; x += 2) L.place("pew", [[x, y], [x + 1, y]], { face: "n" });
  }
  L.fill(["candles"]);
}

// The civic style for a room (buildingmaps.js assemble): its plan leaf's civic mark (the new saves' plans only). null:
// the room keeps buildingmaps.js FURNISH (or a home style).
/** @param {any} room */
export function civicStyle(room) {
  return room && room.civic && CIVIC_STYLES[room.civic] ? CIVIC_STYLES[room.civic] : null;
}

// ======================================================================================
// The civic buildings' signs of survival (interiorscenes.js registerScene, issue #11's hook; their own dice there):
//   frontstand  a police station's last stand at the front desk: officers' bodies in uniform with their kit (kit
//               guards) behind the counter, spent brass round them, the dead in front of it, blood;
//   turned     a cell block: a prisoner who turned in a locked cell (one of the dead that will rise: a Sleeper, its cell
//               door locked, DOOR_KINDS.cell), now and then another cell's prisoner who died locked in (a body);
//   classbar    a school classroom held: chairs jammed in its doorway, a desk dragged behind, the bodies far side;
//   shelter     a school's gym or a church's nave used as a shelter: cots in rows, a water barrel, the ones who never
//               left lying by them;
//   pewdoors    a church's doors blocked from inside with pews shoved against them.
// ======================================================================================
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const civicRooms = (ctx, civic) => ctx.rng.shuffle(ctx.rooms.filter((r) => r.civic === civic && !r.scene && !r.locked));
const nearest = (cells, x, y) => cells.slice().sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y));
const lower = (r) => String(r.name || "room").replace(/ \(upstairs\)$/, "").replace(/ \d+$/, "").toLowerCase();

function frontStand(ctx) {
  const { rng } = ctx;
  for (const r of civicRooms(ctx, "frontdesk")) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 5) continue;
    const counter = ctx.inner(r).find(([x, y]) => (ctx.at(f, x, y) || {}).k === "counter");
    const [cx, cy] = counter || free[0];
    const near = nearest(free, cx, cy);
    const n = rng.chance(0.5) ? 2 : 1;
    for (let i = 0; i < n; i++) { const [x, y] = near.shift(); ctx.body(f, x, y, { human: true, kit: "guards", name: "A police officer" }); ctx.splatter(f, x, y, "human", rng.int(2, 3)); }
    for (const [x, y] of near.slice(0, 3)) { const c = ctx.at(f, x, y); c.brass = rng.int(SCENES.BRASS[0], SCENES.BRASS[1]); }
    const door = (r.doors || []).find((d) => ctx.exit(d[0], d[1], f)) || (r.doors || [])[0];
    const far = door ? nearest(near.slice(3), door[0], door[1]) : near.slice(3).reverse();
    const dead = rng.int(2, 4);
    let placed = 0;
    for (const [x, y] of far) { if (placed >= dead) break; if (!ctx.free(f, x, y)) continue; ctx.body(f, x, y, {}); ctx.splatter(f, x, y, "zombie", rng.int(1, 2)); placed++; }
    return ctx.done("frontstand", r, cx, cy, `Officers made a last stand at the front desk: spent brass behind the counter, ${placed} of the dead in front of it.`);
  }
  return null;
}
// Locks a cell's door (a locked door cell of the map: locks.js opens it; the dead batter it).
function lockCell(ctx, r, f, x, y) {
  const c = ctx.at(f, x, y);
  c.k = "door"; c.dk = "cell"; c.hp = c.mhp = Math.max(60, BMAP.DOOR.locked); // a locked cell door holds as any locked door
  ctx.take(f, x, y);
  if (ctx.map.lockedDoors) ctx.map.lockedDoors.push({ x, y, f, area: r.id, kind: "door", dk: "cell" });
}
function turned(ctx) {
  const { rng } = ctx;
  for (const r of civicRooms(ctx, "cells")) {
    const f = r.f || 0;
    const cells = rng.shuffle(ctx.inner(r).map(([x, y]) => [x, y, ctx.at(f, x, y)]).filter(([, , c]) => c && c.cellDoor && c.cellIn && c.k === "idoor"));
    const inside = (c) => { const p = ctx.at(f, c.cellIn[0], c.cellIn[1]); return p && p.k === "open" && !ctx.used(f, c.cellIn[0], c.cellIn[1]); };
    const ok = cells.filter(([, , c]) => inside(c));
    if (!ok.length) continue;
    const [dx, dy, dc] = ok[0];
    ctx.body(f, dc.cellIn[0], dc.cellIn[1], { sleeper: true });
    ctx.blood(f, dc.cellIn[0], dc.cellIn[1], "zombie", 1);
    lockCell(ctx, r, f, dx, dy);
    let more = "";
    if (ok.length > 1 && rng.chance(0.6)) {
      const [ex, ey, ec] = ok[1];
      ctx.body(f, ec.cellIn[0], ec.cellIn[1], { human: true, quiet: true });
      lockCell(ctx, r, f, ex, ey);
      more = " In the next cell a prisoner died where they were left.";
    }
    return ctx.done("turned", r, dx, dy, `Something moves behind the bars of a locked cell: a prisoner nobody let out.${more}`);
  }
  return null;
}
function classBar(ctx) {
  const { rng } = ctx;
  for (const r of civicRooms(ctx, "classroom")) {
    const f = r.f || 0, ds = r.doors || [];
    if (r.hub || r.entry || ds.length !== 1 || ctx.exit(ds[0][0], ds[0][1], f)) continue;
    const [dx, dy] = ds[0], door = ctx.at(f, dx, dy);
    if (!door || !["idoor", "odoor"].includes(door.k)) continue;
    const inn = NEXT4.map(([ox, oy]) => [dx + ox, dy + oy]).find(([x, y]) => x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1);
    if (!inn) continue;
    const free = ctx.freeIn(r).filter(([x, y]) => x !== inn[0] || y !== inn[1]);
    if (free.length < 3) continue;
    delete door.blood;
    door.k = "odoor";
    ctx.piece(f, dx, dy, "chair"); // the user's chairs that block door ways
    const ic = ctx.at(f, inn[0], inn[1]);
    if (ic && ic.k === "open" && !ctx.stair(inn[0], inn[1])) ctx.piece(f, inn[0], inn[1], "schooldesk");
    for (const [x, y] of nearest(free, inn[0], inn[1]).slice(0, rng.int(1, 2))) ctx.piece(f, x, y, "chair");
    const rest = nearest(ctx.freeIn(r), dx, dy).reverse();
    const n = Math.min(rest.length, rng.chance(0.4) ? 2 : 1);
    for (const [x, y] of rest.slice(0, n)) { ctx.body(f, x, y, { human: true }); ctx.splatter(f, x, y, "human", rng.int(1, 3)); }
    return ctx.done("classbar", r, dx, dy, `Chairs are jammed in the doorway of the ${lower(r)}, a desk dragged behind them: someone held this room.`);
  }
  return null;
}
function shelter(civic, what, kind) {
  return (ctx) => {
    const { rng } = ctx;
    for (const r of civicRooms(ctx, civic)) {
      const f = r.f || 0;
      const free = ctx.freeIn(r).filter(([x, y]) => (x + y) % 2 === 0 && NEXT4.every(([ox, oy]) => { const c = ctx.at(f, x + ox, y + oy); return c && c.k !== "stairs" && c.k !== "ladder"; }));
      if (free.length < 4) continue;
      const cots = rng.shuffle(free).slice(0, rng.int(3, 8));
      for (const [x, y] of cots) ctx.piece(f, x, y, "cot");
      const left = ctx.freeIn(r);
      if (!left.length) continue;
      const [bx, by] = rng.pick(left);
      ctx.piece(f, bx, by, "barrel");
      const by2 = nearest(ctx.freeIn(r).filter(([x, y]) => cots.some(([cx, cy]) => Math.abs(cx - x) + Math.abs(cy - y) === 1)), bx, by);
      const n = Math.min(by2.length, rng.int(2, 4));
      for (const [x, y] of rng.shuffle(by2).slice(0, n)) ctx.body(f, x, y, { human: true, quiet: rng.chance(0.6) });
      const p = ctx.freeIn(r).find(([x, y]) => Math.abs(x - bx) + Math.abs(y - by) <= 2);
      if (p) ctx.pile(f, p[0], p[1], "The last of the water and a few tins", { water: 1, food: rng.chance(0.5) ? 1 : 0 }, r.id);
      return ctx.done(kind, r, bx, by, `The ${what} was a shelter: cots in rows, a water barrel, and ${n === 1 ? "one who never left" : `${n} who never left`}.`);
    }
    return null;
  };
}
function pewDoors(ctx) {
  for (const r of civicRooms(ctx, "nave")) {
    const f = r.f || 0;
    const inside = (d) => NEXT4.map(([ox, oy]) => [d[0] + ox, d[1] + oy]).find(([x, y]) => x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1);
    const outer = (r.doors || []).filter((d) => ctx.exit(d[0], d[1], f));
    let n = 0;
    for (const d of outer.length ? outer : (r.doors || []).slice(0, 1)) {
      const p = inside(d), c = p && ctx.at(f, p[0], p[1]);
      if (!c || c.k !== "open" || ctx.stair(p[0], p[1]) || ctx.used(f, p[0], p[1])) continue;
      ctx.piece(f, p[0], p[1], "pew");
      n++;
    }
    if (!n) continue;
    const d = outer[0] || r.doors[0];
    return ctx.done("pewdoors", r, d[0], d[1], `The church's doors were blocked from inside: pews shoved against them.`);
  }
  return null;
}
// Only on a map laid out by these styles (when): an older save's building rolls its scenes as it did.
const styled = (ctx) => ctx.rooms.some((r) => !!r.civic);
registerScene("frontstand", { w: 3, place: frontStand, kinds: ["police"], when: styled });
registerScene("turned", { w: 3, place: turned, kinds: ["police"], when: styled });
registerScene("classbar", { w: 3, place: classBar, kinds: ["school"], when: styled });
registerScene("gymshelter", { w: 3, place: shelter("gym", "gym", "gymshelter"), kinds: ["school"], when: styled });
registerScene("naveshelter", { w: 3, place: shelter("nave", "nave", "naveshelter"), kinds: ["church"], when: styled });
registerScene("pewdoors", { w: 2, place: pewDoors, kinds: ["church"], when: styled });
