// @ts-check
// Military bases, air bases, airports and prisons laid out like the real thing (the user's request
// 2026-10-25, issue #25 of the interiors epic #7: "yes open a ticket for the military buildings bases, airports, air
// bases, etc that fits too"). The room styles, on roomlayout.js's placement helpers (lanes kept clear between the doors
// and to the stairs, backs to the walls, a door's front never taken, the lootable pieces the containers) and
// civiclayout.js's (desks in rows, a cell block's cells, a vehicle in a bay); buildingmaps.js's plans for these buildings
// (new saves only: an older save keeps its plans and buildingmaps.js FURNISH, worldcfg.js legacyRooms) mark each leaf
// civic: <style> with one of the styles here, and assemble runs it through militaryStyle (after civicStyle, whose
// shared styles: briefing, records, washroom, breakroom, these plans use as they are).
//
// The sizes (MIL_SIZE): metres, at about a metre a cell (CELL_M ≈ 1: a bed is 1 × 2 cells, a doorway 1); the issue's
// reference sizes at their low end, so the maps stay playable. One row per building, for #24's real-world size table
// (REAL_SIZE) to take over; storeys likewise.
//
// The styles (MILITARY_STYLES, by the leaf's civic mark):
//   HQ: mlobby (the duty desk: a counter and a chair, chairs for visitors, a key rack), ops (the map table in the middle
//   with chairs round it, radio consoles along the walls, a whiteboard), cmdoffice (the commander's desk and chair, a
//   bookshelf, a cabinet the gun safe may take: the room's gunSafe), comms (radio consoles and server racks along the
//   walls, a desk).
//   Barracks: bay (an open bay: bunks against the walls, a footlocker at the foot of every one, lockers), twoman (a
//   two-person room: two bunks or beds with their footlockers, a wardrobe), nco (an NCO's private room: a bed, a
//   footlocker, a desk, a locker), dutydesk (a counter at the door, a filing cabinet, a key rack), latrine (toilets and
//   sinks along one wall, showers along another), mdayroom (a TV with sofas facing it, tables and chairs, a vending
//   machine).
//   Armory: issue (the issue window: a counter across the room, caged in bars at its ends, a filing cabinet), vault
//   (weapon racks in rows: gun racks along every wall and back to back down the middle, a cleaning bench), ammostore
//   (ammo cabinets and ammo crates), optics (the NVG and optics cage: storage cages, a locker), armorer (a desk, a
//   workbench, a tool chest).
//   Mess hall: mess (the serving line: counters along one wall; long tables with chairs down the room), galley (an
//   industrial kitchen: ranges, a fryer, sinks, steel counters), mwalkin (a walk-in cooler or freezer: cold-room shelving,
//   a chest freezer), drystore (shelves and crates: MREs and tins).
//   Motor pool: vbays (Humvees and Army trucks in the bays, each a container: combat.js placeCar drawn by
//   ui/vehiclemodel.js; car lifts, tool chests, a compressor, crates of parts and fuel cans), toolcrib (a workbench, tool
//   chests, shelves), mparts (tyre racks, shelves, crates), dispatchm (a desk and a radio console, a filing cabinet).
//   Supply warehouse: msupply (pallet racks in rows, crates), qmcage (the quartermaster's cage: storage cages, lockers, a
//   desk), qmoffice (a desk, filing cabinets).
//   Aid station: aidward (field cots in rows, medicine cabinets), triage (a counter, gurneys), medic (a desk, a medicine
//   cabinet, a filing cabinet), aidstore (medicine cabinets, shelves, a locker).
//   Gatehouse: guardpost (a radio console, a desk and a chair, a locker, a gun rack).
//   Hangar (an air base's or an airport's): hfloor (an aircraft: an air base's a fighter or a transport plane, often a
//   helicopter too; an airport's an airliner or a small transport; jet engine stands, tool chests, a compressor),
//   hoffice (a desk, a radio console, filing), hparts (pallet racks, shelves, tool chests), avionics (workbenches, a server
//   rack).
//   Control tower: tlobby (a counter, chairs), tequip (server racks, a radio console), tradar (desks, radio consoles), cab
//   (the tower cab on the top floor: radio consoles along every wall, a map table, chairs).
//   Flight ops: opsdesk (a counter, a radio console, a whiteboard), crewroom (lockers of flight gear along a wall, a sofa,
//   a table and chairs), lifesupport (lockers and shelves of helmets, survival vests and flares), weather (desks, a server
//   rack), squadron (desks, a bookshelf).
//   Terminal: checkin (the check-in desks: counters in a row with the baggage belt behind, queue posts in front), security
//   (the security lanes: scanners in rows with a table of bins at each end, queue posts), confiscated (the confiscated
//   items room: evidence lockers and shelves: knives, lighters, tools), gates (rows of gate seating, the gate desk),
//   foodcourt (counters, a range, tables and chairs), tshop (shelves in rows, a checkout), claim (baggage carousels:
//   belts in a loop, suitcases on them), bhall (the baggage hall behind: belts, suitcases as containers, carts), lounge
//   (sofas, gate seating, a vending machine), airline (desks, filing cabinets).
//   Prison cell block: pcells (cells along the back wall, each a bunk, a toilet and a sink behind bars with a cell door:
//   civiclayout.js cellBlock, up to MIL.PRISON_CELLS a block), pdayroom (the common day room the cells face: tables and
//   chairs, a TV), intake (property lockers along the walls: the inmates' belongings, a counter, a chair), pcontrol (the
//   control room: security desks of monitors, a server rack of door panels, a radio console), visitation (a glass
//   divider of teller windows across the room, chairs either side), guardroom (lockers, a table and chairs), riotstore
//   (riot gear: lockers, gun racks of shotguns, an ammo cabinet of beanbag rounds).
//
// The bunkers are #26's (bunkerlayout.js: the mountain bunker of the bunker_mil site among them).
//
// The outside (militaryOutside, called from assemble for the grounds these plans name):
//   compound (a military base's buildings): a perimeter fence a cell in from the map's edge with barbed wire along its
//   outside (gaps where the ways out run: the zones), a watchtower inside each corner (combat.js tower: climbed, a
//   lookout), the gatehouse at the front gap (a barrier gate either side of the way through, a guard booth and sandbags
//   round it); the HQ's helipad (a pad with a helicopter wreck on it: one container); the motor pool's fuel point.
//   airfield (an air base's or an airport's): the apron across the front (taxiway: road cells, their centre lines), an
//   aircraft wreck parked on it and a fire truck (containers), an air base's fuel farm (fuel bladders) at the side and
//   its fence and towers as a base's.
//   prisonyard: a double perimeter (the fence and barbed wire along its inside), towers at the corners, the exercise
//   yard behind the cell block (its own fence, weight benches).
// The scenes (registerScene, their own dice; only on maps these styles laid out: when): gatestand, barracksoverrun,
// armorybarricade, helipadevac, cellsopen, terminalshelter (below).
import { REAL_SIZE } from "./data-buildingsize.js"; // the sizes (issue #24 took over MIL_SIZE)
import { hash01 } from "./skills.js";
import { pieceDef } from "./data-furniture.js";
import { registerScene, SCENES } from "./interiorscenes.js";
import { quietWall, whiteboard, rowsFacing, deskWithChair, tableSet, rowOf, kitchen, vehicleIn, cellBlock } from "./civiclayout.js";

export const MIL = {
  PRISON_CELLS: 12,     // cells along a prison block's back wall, at most
  VEHICLES: [2, 4],     // military vehicles in a motor pool's bays
  HELO: 0.6,            // an air base's hangar holds a helicopter too
  CARGO: 0.4,           // an air base's hangar aircraft is a transport plane (else a fighter)
  AIRLINER: 0.6,        // an airport's hangar aircraft is an airliner (else a small transport)
  TOWERS: 4,            // watchtowers at a compound's corners
};
// The buildings' real sizes (metres, at CELL_M ≈ 1 m a cell) and storeys: [min, max] each. See the header.
// #24's real-world size table holds these rows now (data-buildingsize.js REAL_SIZE, planned: drawn at that size).
export const MIL_SIZE = Object.fromEntries(["hq", "barracks", "armorybldg", "messhall", "motorpool", "supply", "aidstation", "gatehouse", "hangar", "tower", "flightops", "terminal", "cellblock"].map((k) => [k, REAL_SIZE[k]]));
// The archetypes (buildingmaps.js BUILDINGS keys) these styles lay out in a new save.
export const MIL_KEYS = new Set(["hq", "barracks", "armorybldg", "messhall", "motorpool", "aidstation", "gatehouse", "hangar", "tower", "flightops", "terminal", "cellblock"]);

const OPP = { n: "s", s: "n", w: "e", e: "w" };
const D4 = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
/** @typedef {any} Lay */

// The cell beyond a piece's far end from its wall (a bunk's foot): the footlocker's.
function footOf(rec) {
  if (!rec.side) return null;
  const [dx, dy] = D4[OPP[rec.side]];
  let best = null, bd = -1e9;
  for (const [x, y] of rec.cells) { const d = x * dx + y * dy; if (d > bd) { bd = d; best = [x, y]; } }
  return best ? [best[0] + dx, best[1] + dy] : null;
}
// A bunk with its footlocker at its foot (else beside it): both or neither. plain: the footlocker stands without being
// searched once the room holds its share of containers (every bunk keeps its footlocker).
function bunkWithLocker(L, k = "bunk", opts = {}) {
  const bunk = L.wall(k, { prefer: "corner", ...opts });
  if (!bunk) return null;
  const plain = L.boxes() >= L.target();
  const foot = footOf(bunk);
  const fl = (foot && L.place("footlocker", [foot], { face: bunk.side, plain })) || L.beside(bunk, "footlocker", { plain });
  if (!fl) { L.remove(bunk); return null; }
  return bunk;
}
// Gun racks back to back down the middle of a room (an armory's vault): rows two cells off the walls, every other row,
// each cell of a row a rack facing out; never on a lane.
function rackRows(L, k = "gunrack", most = 24) {
  const c = L.c, along = c.w >= c.h;
  let n = 0;
  for (let d = 2; d < (along ? c.h : c.w) - 2 && n < most; d += 3) {
    for (let a = 1; a < (along ? c.w : c.h) - 1 && n < most; a++) {
      const x = along ? c.x0 + a : c.x0 + d, y = along ? c.y0 + d : c.y0 + a;
      if (L.place(k, [[x, y]], { face: along ? "s" : "e", plain: L.boxes() >= L.target() })) n++;
    }
  }
  return n;
}
// Up to n of k along the walls, plain past the room's share (a row that must look full: the vault's racks).
function wallRun(L, k, n, sides) {
  let made = 0;
  for (let i = 0; i < n; i++) if (L.wall(k, { sides, prefer: "corner", plain: L.boxes() >= L.target() })) made++; else break;
  return made;
}
// Rows of k (2 × 1 or 1 × 1) across the room facing `side` (gate seating, cots): from two cells off that wall, every
// other row, a gap of a cell between pieces.
function rowsOf(L, k, side, most = 40) {
  const c = L.c, along = side === "n" || side === "s";
  const [pw] = pieceDef(k) ? pieceDef(k).size : [1, 1];
  let n = 0;
  for (let d = 1; d < (along ? c.h : c.w) - 1 && n < most; d += 2) {
    for (let a = 1; a + pw - 1 < (along ? c.w : c.h) - 1 && n < most; a += pw + 1) {
      const cells = [];
      for (let i = 0; i < pw; i++) cells.push(along ? [c.x0 + a + i, side === "n" ? c.y0 + d : c.y1 - d] : [side === "w" ? c.x0 + d : c.x1 - d, c.y0 + a + i]);
      if (L.place(k, cells, { face: side })) n++;
    }
  }
  return n;
}
const longWall = (L) => { const ws = L.walls(); return ws.length ? ws[0].side : "n"; };

/** @type {Record<string, (L: Lay) => void>} */
export const MILITARY_STYLES = {
  // ---------- HQ ----------
  mlobby(L) {
    const back = quietWall(L, "duty");
    const desk = L.wall("counter", { sides: [back], prefer: "middle" }) || L.need("counter");
    if (desk) L.around(desk, "chair", 1);
    L.wall("keyrack", { sides: [back], prefer: "corner" });
    L.run(["chair", "chair", "chair"], [OPP[back]]);
  },
  ops(L) {
    const t = L.centre("maptable") || L.need("maptable");
    if (t) L.around(t, "chair", 4);
    const side = quietWall(L, "ops");
    whiteboard(L, side);
    wallRun(L, "radioconsole", 3, [OPP[side], side]);
    L.fill(["filing"]);
  },
  cmdoffice(L) {
    deskWithChair(L) || L.need("desk");
    L.wall("cabinet", { prefer: "corner" }); // the gun safe may take it (locks.js placeGunSafes)
    L.wall("bookshelf", { prefer: "corner" });
    L.wall("sofa", { prefer: "middle" });
    L.fill(["filing"]);
  },
  comms(L) {
    const side = longWall(L);
    wallRun(L, "radioconsole", 3, [side]);
    wallRun(L, "serverrack", 2, [OPP[side]]);
    if (!L.has("radioconsole")) L.need("radioconsole");
    deskWithChair(L);
  },
  // ---------- barracks ----------
  bay(L) {
    const n = Math.max(2, Math.min(16, Math.floor((L.c.w * L.c.h) / 7)));
    for (let i = 0; i < n; i++) if (!bunkWithLocker(L)) break;
    if (!L.has("bunk")) { const b = L.need("bunk"); if (b) { const f = footOf(b); if (!(f && L.place("footlocker", [f], { face: b.side, force: true }))) L.beside(b, "footlocker"); } }
    L.fill(["locker"]);
  },
  twoman(L) {
    for (let i = 0; i < 2; i++) bunkWithLocker(L, L.variant(2, "bed") ? "bunk" : "bed");
    if (!L.has("bunk") && !L.has("bed")) { const b = L.need("bed"); if (b) L.beside(b, "footlocker"); }
    L.wall("locker", { prefer: "corner" });
  },
  nco(L) {
    bunkWithLocker(L, "bed") || L.need("bed");
    deskWithChair(L);
    L.fill(["locker", "wardrobe"]);
  },
  dutydesk(L) {
    const back = quietWall(L, "duty");
    const desk = L.wall("counter", { sides: [back], prefer: "middle" }) || L.need("counter");
    if (desk) L.around(desk, "chair", 1);
    L.wall("keyrack", { prefer: "corner" });
    L.fill(["filing"]);
  },
  latrine(L) {
    const ws = L.walls();
    const a = ws[0] ? ws[0].side : "n", b = ws.find((w) => w.side !== a && w.side !== OPP[a]);
    for (let i = 0; i < 4; i++) if (!L.wall("toilet", { sides: [a], prefer: "corner" })) break;
    for (let i = 0; i < 3; i++) if (!L.wall("shower", { sides: [OPP[a]], prefer: "corner" })) break;
    for (let i = 0; i < 3; i++) if (!L.wall("sink", { sides: b ? [b.side] : undefined, prefer: "corner" })) break;
    if (!L.has("toilet")) L.need("toilet");
  },
  mdayroom(L) {
    const tv = L.wall("tvstand", { prefer: "middle" });
    if (tv) L.facing(tv, "sofa");
    tableSet(L, 4);
    L.wall("vending", { prefer: "corner" });
    L.fill(["bookshelf"]);
  },
  // ---------- armory ----------
  issue(L) {
    // The issue window: a counter across the room between the door and the back, bars at its ends (a caged counter).
    const c = L.c, back = quietWall(L, "issue");
    const along = back === "n" || back === "s";
    const row = back === "n" ? c.y0 + 1 : back === "s" ? c.y1 - 1 : back === "w" ? c.x0 + 1 : c.x1 - 1;
    let made = 0;
    const len = along ? c.w : c.h;
    for (let a = 0; a < len; a++) {
      const x = along ? c.x0 + a : row, y = along ? row : c.y0 + a;
      const end = a === 0 || a === len - 1;
      if (L.place(end ? "bars" : "counter", [[x, y]], { face: OPP[back] })) made++;
    }
    if (!made) L.need("counter");
    L.fill(["filing", "locker"]);
  },
  vault(L) {
    const ws = L.walls();
    for (const w of ws) wallRun(L, "gunrack", 6, [w.side]);
    rackRows(L);
    L.wall("workbench", { prefer: "corner" }); // the cleaning bench
    if (!L.has("gunrack")) L.need("gunrack");
    L.wall("locker", { prefer: "corner" }); // the gun safe may take it
  },
  ammostore(L) {
    wallRun(L, "ammocab", 3);
    for (let i = 0; i < 4; i++) if (!L.centre("ammocrate", { plain: L.boxes() >= L.target() })) break;
    if (!L.has("ammocab")) L.need("ammocab");
    L.fill(["ammocrate"]);
  },
  optics(L) {
    L.wall("sportcage", { prefer: "corner" }) || L.need("sportcage");
    L.fill(["sportcage", "locker"]);
  },
  armorer(L) {
    deskWithChair(L);
    const b = L.wall("workbench", { prefer: "corner" });
    if (b) L.beside(b, "toolchest");
    L.fill(["filing"]);
  },
  // ---------- mess hall ----------
  mess(L) {
    const side = longWall(L);
    L.run(["counter", "counter", "counter", "counter", "counter"], [side]); // the serving line
    const n = Math.max(1, Math.min(10, Math.floor((L.c.w * L.c.h) / 16)));
    for (let i = 0; i < n; i++) if (!tableSet(L, 4, true)) break;
    if (!L.has("table")) { const t = L.need("table"); if (t) L.around(t, "chair", 2); }
    L.fill(["shelf"]);
  },
  galley(L) {
    kitchen(L, ["range", "range", "fryer", "sink", "counter", "range", "counter", "sink"]);
    if (!L.has("range")) L.need("range");
    L.fill(["counter", "shelf"]);
  },
  mwalkin(L) {
    L.fill(["shelf"]); // the tins and the jars that kept
    L.wall("coldshelf", { prefer: "corner", plain: true });
    L.wall("freezer", { prefer: "corner", plain: true }); // spoiled long ago
  },
  drystore(L) {
    L.fill(["shelf", "crate"]);
    for (let i = 0; i < 3; i++) if (!L.centre("crate", { plain: L.boxes() >= L.target() })) break;
  },
  // ---------- motor pool ----------
  vbays(L) {
    const n = MIL.VEHICLES[0] + Math.floor(hash01(L.c.seed, "veh", L.room.id) * (MIL.VEHICLES[1] - MIL.VEHICLES[0] + 1));
    for (let i = 0; i < n; i++) {
      const truck = hash01(L.c.seed, "truck", L.room.id, i) < 0.45;
      if (!vehicleIn(L, truck ? { kind: "truck", len: 5, body: "m35", box: "m35", label: "Army truck" } : { kind: "truck", len: 4, body: "humvee", box: "humvee", label: "Humvee" })) break;
    }
    for (let i = 0; i < 2; i++) L.centre("carlift", {});
    const ws = L.walls();
    if (ws.length) for (let i = 0; i < 3; i++) if (!L.wall("toolchest", { sides: [ws[0].side], prefer: "corner" })) break;
    L.wall("compressor", { prefer: "corner" });
    L.fill(["crate", "toolchest", "shelf"]);
  },
  toolcrib(L) {
    const b = L.wall("workbench", { prefer: "corner" }) || L.need("workbench");
    if (b) L.beside(b, "toolchest");
    L.fill(["toolchest", "shelf"]);
  },
  mparts(L) {
    L.fill(["tirerack", "shelf", "crate"]);
  },
  dispatchm(L) {
    deskWithChair(L) || L.need("desk");
    L.wall("radioconsole", { prefer: "corner" });
    L.fill(["filing"]);
  },
  // ---------- supply warehouse ----------
  msupply(L) {
    const c = L.c, along = c.w >= c.h;
    // Pallet racks in rows two deep with an aisle of two between (forklifts), every few a crate stack.
    for (let d = 2; d < (along ? c.h : c.w) - 2; d += 4) for (let a = 2; a < (along ? c.w : c.h) - 2; a++) {
      const x = along ? c.x0 + a : c.x0 + d, y = along ? c.y0 + d : c.y0 + a;
      L.place("palletrack", [[x, y]], { face: along ? "s" : "e", plain: L.boxes() >= L.target() });
    }
    L.centre("forklift", {});
    L.fill(["crate", "palletrack"]);
  },
  qmcage(L) {
    L.wall("sportcage", { prefer: "corner" }) || L.need("sportcage");
    L.fill(["locker", "sportcage", "shelf"]);
  },
  qmoffice(L) {
    deskWithChair(L) || L.need("desk");
    L.fill(["filing"]);
  },
  // ---------- aid station ----------
  aidward(L) {
    const side = quietWall(L, "cots");
    rowsOf(L, "cot", side, 12);
    if (!L.has("cot")) L.need("cot");
    L.fill(["medcab"]);
  },
  triage(L) {
    const back = quietWall(L, "triage");
    const desk = L.wall("counter", { sides: [back], prefer: "middle" }) || L.need("counter");
    if (desk) L.around(desk, "chair", 1);
    L.wall("gurney", { prefer: "corner" });
    L.fill(["medcab"]);
  },
  medic(L) {
    deskWithChair(L) || L.need("desk");
    L.fill(["medcab", "filing"]);
  },
  aidstore(L) {
    L.fill(["medcab", "shelf", "locker"]);
  },
  // ---------- gatehouse ----------
  guardpost(L) {
    L.wall("radioconsole", { prefer: "corner" }) || L.need("radioconsole");
    deskWithChair(L);
    L.wall("gunrack", { prefer: "corner" });
    L.fill(["locker"]);
  },
  // ---------- hangars ----------
  hfloor(L) {
    const mil = !!L.room.milAir;
    const big = mil ? hash01(L.c.seed, "cargo", L.room.id) < MIL.CARGO : hash01(L.c.seed, "liner", L.room.id) < MIL.AIRLINER;
    const plane = mil ? (big ? { body: "cargoplane", len: 9, wide: 6, label: "transport plane" } : { body: "jet", len: 6, wide: 4, label: "fighter jet" })
      : big ? { body: "airliner", len: 9, wide: 6, label: "airliner" } : { body: "cargoplane", len: 8, wide: 6, label: "small transport plane" };
    vehicleIn(L, { kind: "truck", len: plane.len, wide: plane.wide, body: plane.body, box: plane.body, label: plane.label, ax: "y" })
      || vehicleIn(L, { kind: "truck", len: plane.len, wide: plane.wide, body: plane.body, box: plane.body, label: plane.label, ax: "x" });
    if (mil && hash01(L.c.seed, "helo", L.room.id) < MIL.HELO) vehicleIn(L, { kind: "truck", len: 5, body: "helo", box: "helo", label: "helicopter" });
    for (let i = 0; i < 2; i++) L.centre("enginestand", {});
    const ws = L.walls();
    if (ws.length) for (let i = 0; i < 3; i++) if (!L.wall("toolchest", { sides: [ws[0].side], prefer: "corner" })) break;
    L.wall("compressor", { prefer: "corner" });
    L.fill(["crate", "toolchest", "shelf"]);
  },
  hoffice(L) {
    deskWithChair(L) || L.need("desk");
    L.wall("radioconsole", { prefer: "corner" });
    L.fill(["filing"]);
  },
  hparts(L) {
    L.fill(["palletrack", "shelf", "toolchest"]);
  },
  avionics(L) {
    const b = L.wall("workbench", { prefer: "corner" }) || L.need("workbench");
    if (b) L.beside(b, "toolchest");
    L.wall("serverrack", { prefer: "corner" });
    L.fill(["shelf"]);
  },
  // ---------- control tower ----------
  tlobby(L) {
    const back = quietWall(L, "tower");
    const desk = L.wall("counter", { sides: [back], prefer: "middle" });
    if (desk) L.around(desk, "chair", 1);
    L.fill(["filing"]);
  },
  tequip(L) {
    wallRun(L, "serverrack", 2);
    L.wall("radioconsole", { prefer: "corner" });
    L.fill(["cabinet"]);
  },
  tradar(L) {
    deskWithChair(L);
    wallRun(L, "radioconsole", 2);
    L.fill(["filing"]);
  },
  cab(L) {
    for (const side of ["n", "e", "s", "w"]) L.wall("radioconsole", { sides: [side], prefer: "middle", plain: L.boxes() >= L.target() });
    if (!L.has("radioconsole")) L.need("radioconsole");
    const t = L.centre("maptable");
    if (t) L.around(t, "chair", 2);
  },
  // ---------- flight ops ----------
  opsdesk(L) {
    const back = quietWall(L, "ops");
    const desk = L.wall("counter", { sides: [back], prefer: "middle" }) || L.need("counter");
    if (desk) L.around(desk, "chair", 1);
    whiteboard(L, back);
    L.wall("radioconsole", { prefer: "corner" });
  },
  crewroom(L) {
    const side = longWall(L);
    rowOf(L, "locker", 4, [side]);
    L.wall("sofa", { sides: [OPP[side]], prefer: "middle" });
    tableSet(L, 4);
    L.fill(["locker"]);
  },
  lifesupport(L) {
    const side = longWall(L);
    rowOf(L, "locker", 4, [side]);
    L.fill(["shelf", "locker"]);
  },
  weather(L) {
    deskWithChair(L);
    L.wall("serverrack", { prefer: "corner" });
    L.fill(["filing"]);
  },
  squadron(L) {
    deskWithChair(L) || L.need("desk");
    deskWithChair(L);
    L.wall("bookshelf", { prefer: "corner" });
    L.fill(["filing"]);
  },
  // ---------- terminal ----------
  checkin(L) {
    // The check-in desks: a row of counters a cell off the back wall, the baggage belt between them and the wall,
    // queue posts in front.
    const c = L.c, back = quietWall(L, "checkin");
    const along = back === "n" || back === "s";
    const len = along ? c.w : c.h;
    const at = (d, a) => (along ? [c.x0 + a, back === "n" ? c.y0 + d : c.y1 - d] : [back === "w" ? c.x0 + d : c.x1 - d, c.y0 + a]);
    for (let a = 2; a < len - 2; a++) {
      L.place("baggagebelt", [at(0, a)], { face: OPP[back] });
      if (a % 3 !== 0) L.place("counter", [at(1, a)], { face: OPP[back], plain: L.boxes() >= L.target() });
      else L.place("stanchion", [at(3, a)], {});
    }
    if (!L.has("counter")) L.need("counter");
    rowsOf(L, "gateseat", OPP[back], 4);
  },
  security(L) {
    // The lanes: a scanner (2 cells) with a table of bins at its ends, lanes a cell apart across the room.
    const c = L.c, side = quietWall(L, "sec");
    const along = side === "n" || side === "s";
    const len = along ? c.w : c.h, depth = along ? c.h : c.w;
    const d = Math.max(1, Math.floor(depth / 2) - 1);
    for (let a = 1; a + 3 < len - 1; a += 3) {
      const cells = [0, 1].map((i) => (along ? [c.x0 + a, (side === "n" ? c.y0 : c.y1 - 1) + (side === "n" ? d + i : -d + i)] : [(side === "w" ? c.x0 : c.x1 - 1) + (side === "w" ? d + i : -d + i), c.y0 + a]));
      const cs = along ? cells : [[cells[0][0], cells[0][1]], [cells[0][0] + 1, cells[0][1]]];
      if (L.place("scanner", cs, { face: side })) {
        const t = along ? [c.x0 + a, cs[1][1] + 1] : [cs[1][0] + 1, c.y0 + a];
        L.place("table", [t], {});
      }
    }
    if (!L.has("scanner")) L.need("scanner");
    for (let i = 0; i < 3; i++) L.centre("stanchion", {});
  },
  confiscated(L) {
    const side = longWall(L);
    rowOf(L, "evlocker", 3, [side]);
    L.fill(["shelf", "evlocker"]);
  },
  gates(L) {
    const side = quietWall(L, "gate");
    L.wall("counter", { sides: [side], prefer: "middle" }); // the gate desk
    rowsOf(L, "gateseat", OPP[side], 24);
    if (!L.has("gateseat")) L.need("gateseat");
    L.fill(["vending"]);
  },
  foodcourt(L) {
    const side = longWall(L);
    L.run(["counter", "range", "counter", "fryer", "counter", "coldcase", "counter"], [side]);
    const n = Math.max(1, Math.min(8, Math.floor((L.c.w * L.c.h) / 14)));
    for (let i = 0; i < n; i++) if (!tableSet(L, 4)) break;
    L.fill(["coldcase", "shelf"]);
  },
  tshop(L) {
    const back = quietWall(L, "shop");
    L.wall("checkout", { sides: [OPP[back]], prefer: "corner" }) || L.need("checkout");
    rowsFacing(L, "shelf", back, 12);
    L.fill(["shelf"]);
  },
  claim(L) {
    // A carousel: belts in a loop off the walls, suitcases on it (containers up to the room's share).
    const c = L.c;
    const x0 = c.x0 + 2, y0 = c.y0 + 2, x1 = Math.min(c.x1 - 2, x0 + 6), y1 = Math.min(c.y1 - 2, y0 + 2);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (y === y0 || y === y1 || x === x0 || x === x1) L.place(y === y0 && (x - x0) % 3 === 1 && L.boxes() < L.target() ? "luggage" : "baggagebelt", [[x, y]], {});
    if (!L.has("baggagebelt")) L.need("baggagebelt");
    L.fill(["luggage"]);
  },
  bhall(L) {
    const side = longWall(L);
    for (let i = 0; i < 6; i++) if (!L.wall("baggagebelt", { sides: [side] })) break;
    for (let i = 0; i < 6; i++) if (!L.centre("luggage", { plain: L.boxes() >= L.target() })) break;
    L.fill(["luggage", "crate"]);
    L.wall("linencart", { prefer: "corner" }); // a baggage cart
  },
  lounge(L) {
    L.wall("sofa", { prefer: "middle" });
    L.wall("sofa", { prefer: "middle" });
    rowsOf(L, "gateseat", quietWall(L, "lounge"), 8);
    L.wall("vending", { prefer: "corner" });
    L.fill(["cabinet"]);
  },
  airline(L) {
    deskWithChair(L) || L.need("desk");
    deskWithChair(L);
    L.fill(["filing"]);
  },
  // ---------- prison ----------
  pcells(L) {
    cellBlock(L, MIL.PRISON_CELLS);
    L.fill(["locker"]);
  },
  pdayroom(L) {
    const tv = L.wall("tvstand", { prefer: "middle" });
    const n = Math.max(1, Math.min(6, Math.floor((L.c.w * L.c.h) / 14)));
    for (let i = 0; i < n; i++) if (!tableSet(L, 4)) break;
    if (!tv) L.wall("tvstand", { prefer: "corner" });
  },
  intake(L) {
    const back = quietWall(L, "intake");
    const desk = L.wall("counter", { sides: [back], prefer: "middle" }) || L.need("counter");
    if (desk) L.around(desk, "chair", 1);
    const ws = L.walls().map((w) => w.side).filter((s) => s !== back);
    for (const s of ws) wallRun(L, "intakelocker", 4, [s]);
    if (!L.has("intakelocker")) L.need("intakelocker");
  },
  pcontrol(L) {
    const side = longWall(L);
    L.wall("secdesk", { sides: [side], prefer: "middle" }) || L.need("secdesk");
    L.wall("secdesk", { sides: [side] });
    L.wall("serverrack", { prefer: "corner" }); // the door panels
    L.wall("radioconsole", { prefer: "corner" });
    for (let i = 0; i < 2; i++) L.centre("chair", {});
  },
  visitation(L) {
    // A glass divider across the room's middle: teller windows (a counter under glass) with a chair each side.
    const c = L.c, along = c.w >= c.h;
    const mid = along ? c.y0 + Math.floor(c.h / 2) : c.x0 + Math.floor(c.w / 2);
    for (let a = 1; a < (along ? c.w : c.h) - 1; a += 2) {
      const p = along ? [c.x0 + a, mid] : [mid, c.y0 + a];
      if (!L.place("teller", [p], { face: along ? "s" : "e" })) continue;
      const q = along ? [[p[0], mid - 1], [p[0], mid + 1]] : [[mid - 1, p[1]], [mid + 1, p[1]]];
      L.place("chair", [q[0]], { face: along ? "s" : "e" });
      L.place("chair", [q[1]], { face: along ? "n" : "w" });
    }
    if (!L.has("teller")) L.need("teller");
  },
  guardroom(L) {
    const side = longWall(L);
    rowOf(L, "locker", 4, [side]);
    tableSet(L, 4);
  },
  riotstore(L) {
    wallRun(L, "gunrack", 3);
    L.wall("ammocab", { prefer: "corner" });
    L.fill(["locker"]);
  },
};

// The military style for a room (buildingmaps.js assemble): its plan leaf's civic mark when it is one of these.
/** @param {any} room */
export function militaryStyle(room) {
  return room && room.civic && MILITARY_STYLES[room.civic] ? MILITARY_STYLES[room.civic] : null;
}

// ======================================================================================
// The outside (assemble's grounds compound, airfield and prisonyard). api: assemble's tools for the ground
// floor's outside: { rng, W, H, I, cells, bx0, by0, bx1, by1, outsideFree(x, y), block(x, y, k) (refused where it would
// cut anything off: the ways out stay open), box(room, x, y, kind, area), outCar(x, y, o) (a vehicle on the lot, o as a
// room's: kind, len, wide, ax, body; its rect or null), area(type, name) (a new outdoor area), spec }.
// ======================================================================================
// A ring of k round the map, `inset` cells in from its edge, where each cell will take it.
function ring(api, inset, k) {
  const { W, H } = api;
  let n = 0;
  for (let x = inset; x < W - inset; x++) for (const y of [inset, H - 1 - inset]) if (api.outsideFree(x, y) && api.block(x, y, k)) n++;
  for (let y = inset + 1; y < H - 1 - inset; y++) for (const x of [inset, W - 1 - inset]) if (api.outsideFree(x, y) && api.block(x, y, k)) n++;
  return n;
}
// Watchtowers inside the ring's corners (combat.js tower: climbed, a lookout two levels up).
function towers(api, inset, most = MIL.TOWERS) {
  const { W, H } = api;
  let n = 0;
  if (most <= 0) return 0;
  for (const [x, y] of [[inset, inset], [W - 1 - inset, inset], [inset, H - 1 - inset], [W - 1 - inset, H - 1 - inset]]) {
    for (const [dx, dy] of [[0, 0], [x < W / 2 ? 1 : -1, 0], [0, y < H / 2 ? 1 : -1], [x < W / 2 ? 1 : -1, y < H / 2 ? 1 : -1]]) {
      if (api.outsideFree(x + dx, y + dy) && api.block(x + dx, y + dy, "tower")) { n++; break; }
    }
    if (n >= most) break;
  }
  return n;
}
// The gatehouse at the front gap of the fence: a barrier gate either side of the way through (on the fence's line), a
// guard booth inside beside it, sandbags round the booth.
function gatehouse(api, fenceY) {
  const { W, cells, I } = api;
  // The front gap: the fence row's longest run of cells that are not fence, nearest the middle.
  let best = null;
  for (let x = 1; x < W - 1; x++) {
    if (cells[I(x, fenceY)].k === "fence") continue;
    let e = x;
    while (e + 1 < W - 1 && cells[I(e + 1, fenceY)].k !== "fence") e++;
    if (!best || e - x > best[1] - best[0]) best = [x, e];
    x = e;
  }
  if (!best) return 0;
  let n = 0;
  for (const x of [best[0] - 1, best[1] + 1]) {
    if (cells[I(x, fenceY)] && cells[I(x, fenceY)].k === "fence") { api.clear(x, fenceY); if (api.block(x, fenceY, "barrier")) n++; else api.block(x, fenceY, "fence"); }
  }
  const bx = best[1] + 2, by = fenceY - 2;
  if (api.outsideFree(bx, by) && api.block(bx, by, "guardbooth")) {
    n++;
    for (const [dx, dy] of [[1, 0], [0, -1], [1, -1]]) if (api.outsideFree(bx + dx, by + dy)) api.block(bx + dx, by + dy, "sandbag");
  }
  return n;
}
// The gatehouse at the side gap of the fence (the fence's column x = fenceX): as gatehouse, turned.
function gatehouseSide(api, fenceX) {
  const { H, cells, I } = api;
  let best = null;
  for (let y = 1; y < H - 1; y++) {
    if (cells[I(fenceX, y)].k === "fence") continue;
    let e = y;
    while (e + 1 < H - 1 && cells[I(fenceX, e + 1)].k !== "fence") e++;
    if ((!best || e - y > best[1] - best[0]) && e - y >= 2) best = [y, e];
    y = e;
  }
  if (!best) return 0;
  let n = 0;
  for (const y of [best[0] - 1, best[1] + 1]) {
    if (cells[I(fenceX, y)] && cells[I(fenceX, y)].k === "fence") { api.clear(fenceX, y); if (api.block(fenceX, y, "barrier")) n++; else api.block(fenceX, y, "fence"); }
  }
  const bx = fenceX + 2, by = best[1] + 2;
  if (api.outsideFree(bx, by) && api.block(bx, by, "guardbooth")) {
    n++;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) if (api.outsideFree(bx + dx, by + dy)) api.block(bx + dx, by + dy, "sandbag");
  }
  return n;
}
// A vehicle on the ground as an outdoor area's container (a helicopter on its pad, a parked aircraft, a fire truck).
function parked(api, o, near, type, name) {
  const { rng } = api;
  for (let t = 0; t < 60; t++) {
    const x = Math.round(near[0] + rng.int(-6, 6)), y = Math.round(near[1] + rng.int(-4, 4));
    if (!api.outsideFree(x, y)) continue;
    const rect = api.outCar(x, y, { ...o, ax: t % 2 ? "x" : "y" });
    if (!rect) continue;
    const a = api.area(type, name);
    api.containers.push({ id: api.cid(), x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, f: 0, area: a.id, kind: o.box, searched: false, label: `${name}: ${o.label}` });
    Object.assign(a, { x0: rect.x0 - 1, y0: rect.y0 - 1, w: rect.w + 2, h: rect.h + 2 });
    return rect;
  }
  return null;
}
// Fuel bladders (2 × 2, each a container) in an outdoor area by the building's side.
function fuelFarm(api, n) {
  const { W, bx1, by0, by1 } = api;
  const a = api.area("pumps", "Fuel farm");
  let made = 0;
  const xs = [];
  for (let x = bx1 + 3; x < W - 3 && made < n; x += 3) for (let y = by0; y < by1 && made < n; y += 3) {
    const cells = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
    if (!cells.every(([cx, cy]) => api.outsideFree(cx, cy))) continue;
    if (!api.box(null, x, y, "fuelbladder", a)) continue;
    const ok = cells.slice(1).every(([cx, cy]) => api.block(cx, cy, "fuelbladder"));
    const box = api.containers[api.containers.length - 1];
    box.w = 2; box.h = 2;
    if (!ok) { box.w = 1; box.h = 1; }
    xs.push([x, y]); made++;
  }
  if (made) Object.assign(a, { x0: Math.min(...xs.map((p) => p[0])) - 1, y0: Math.min(...xs.map((p) => p[1])) - 1, w: Math.max(...xs.map((p) => p[0])) - Math.min(...xs.map((p) => p[0])) + 4, h: Math.max(...xs.map((p) => p[1])) - Math.min(...xs.map((p) => p[1])) + 4 });
  else api.dropArea(a);
  return made;
}
/** @param {string} kind @param {any} api */
export function militaryOutside(kind, api) {
  const { rng, W, H, cells, I, bx0, by0, bx1, by1, spec } = api;
  // The site's layout (milplans.js MIL_SITES, spec.sl: a new save's), else the default: wire and a fence, four towers,
  // the gate on the front, the apron across the front (an airport's unfenced).
  const sl = spec.sl || { fence: kind === "airfield" && !spec.milAir ? "open" : "wire", towers: kind === "airfield" && !spec.milAir ? 0 : MIL.TOWERS, gate: "front", runway: "front" };
  const out = { fence: 0, towers: 0, gate: 0, helo: null, plane: null, truck: null, fuel: 0, yard: 0, layout: spec.sl ? spec.sl.id : null, runway: null };
  if (kind === "airfield") {
    // The apron (road cells: the taxiway's centre line drawn with them) across the front, down the side or along the
    // back (sl.runway), an aircraft wreck and a fire truck parked on it.
    const rw = sl.runway || "front";
    out.runway = rw;
    const onApron = rw === "side" ? (x) => x >= bx1 + 2 : null;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = cells[I(x, y)];
      if (c.k !== "open") continue;
      if (rw === "front" ? y >= by1 + 2 : rw === "back" ? y <= by0 - 2 : onApron(x)) c.f = "road";
    }
    const at = rw === "side" ? [Math.min(W - 6, bx1 + 6), (by0 + by1) / 2] : rw === "back" ? [(bx0 + bx1) / 2, Math.max(4, by0 - 6)] : [(bx0 + bx1) / 2, Math.min(H - 4, by1 + 5)];
    out.plane = parked(api, spec.milAir ? { kind: "truck", len: 6, wide: 4, body: "jet", box: "jet", label: "fighter jet wreck" } : { kind: "truck", len: 8, wide: 6, body: "airliner", box: "airliner", label: "airliner wreck" }, at, spec.milAir ? "milwreck" : "fuselage", "Apron");
    out.truck = parked(api, { kind: "truck", len: 5, body: "engine", box: "firetruck", label: "crash tender" }, rw === "side" ? [at[0], at[1] + 6] : [bx1 - 4, at[1]], "wreck", "Fire truck");
    if (spec.milAir) out.fuel = fuelFarm(api, rng.int(2, 3));
    if (sl.fence === "open") { api.scatter("car", rng.int(1, 3)); return out; }
  }
  if (kind === "prisonyard") {
    // The exercise yard behind the cell block: a fenced rectangle, weight benches in it.
    const y1 = by0 - 2, y0 = Math.max(2, y1 - 6), x0 = bx0, x1 = Math.min(W - 3, bx0 + 14);
    if (y1 - y0 >= 3) {
      for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) if (api.outsideFree(x, y)) api.block(x, y, "wirefence");
      for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) if (api.outsideFree(x, y)) api.block(x, y, "wirefence");
      for (let i = 0; i < 2; i++) { const x = x0 + 2 + i * 3, y = y0 + 2; if (api.outsideFree(x, y) && api.block(x, y, "weightbench")) out.yard++; }
    }
  }
  // The perimeter (sl.fence): barbed wire along the map's edge and the fence a cell in ("wire"), a second fence inside it
  // ("double"; a prison's always), a line of sandbags ("sandbag"), or nothing ("open"); watchtowers inside its corners
  // (sl.towers); gaps where the ways out run (the zones: block keeps them open).
  const fence = kind === "prisonyard" ? "double" : sl.fence;
  if (fence === "wire" || fence === "double") { ring(api, 0, "wire"); out.fence = ring(api, 1, "fence"); }
  if (fence === "double") ring(api, 2, "wirefence");
  if (fence === "sandbag") out.fence = ring(api, 1, "sandbag");
  if (fence !== "open") out.towers = towers(api, kind === "prisonyard" ? 3 : fence === "double" ? 3 : 2, kind === "prisonyard" ? MIL.TOWERS : sl.towers);
  if ((kind === "compound" || kind === "airfield") && (fence === "wire" || fence === "double")) out.gate = sl.gate === "side" ? gatehouseSide(api, 1) || gatehouse(api, H - 2) : gatehouse(api, H - 2);
  if (kind === "compound" && spec.helipad) {
    const pad = [Math.min(W - 6, bx1 + 7), (by0 + by1) / 2];
    for (let y = Math.round(pad[1]) - 3; y <= Math.round(pad[1]) + 3; y++) for (let x = pad[0] - 3; x <= pad[0] + 3; x++) if (x > 0 && y > 0 && x < W && y < H && cells[I(x, y)].k === "open") cells[I(x, y)].f = "road";
    out.helo = parked(api, { kind: "truck", len: 5, body: "helo", box: "helo", label: "helicopter wreck" }, pad, "milwreck", "Helipad");
  }
  api.scatter("sandbag", rng.int(2, 4) + (fence === "open" ? 4 : 0)); api.scatter("crate", rng.int(1, 3));
  return out;
}

// ======================================================================================
// The signs of survival (interiorscenes.js registerScene, issue #11's hook; their own dice there):
//   gatestand        a base's last stand at the duty desk or the guard post: soldiers' bodies with their kit (kit
//                    soldiers), spent brass round them, sandbags stacked in the doorway, the dead in front;
//   barracksoverrun  an overrun barracks bay: bunks shoved over, blood, soldiers' bodies among the dead;
//   armorybarricade  an armory emptied and barricaded: its racks bare (the containers searched, empty), lockers shoved
//                    against its door from inside, a body with an empty rifle;
//   helipadevac      an evacuation abandoned at the HQ: the briefing room or the lobby full of dropped bags and cots,
//                    the dead who missed the last flight;
//   cellsopen        a cell block where the doors opened: every cell door open, the inmates' bodies in the day room,
//                    a guard's body by the control room;
//   terminalshelter  a terminal used as a shelter: cots between the gate seats, water barrels, the ones who never left.
// ======================================================================================
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const milRooms = (ctx, ...civics) => ctx.rng.shuffle(ctx.rooms.filter((r) => civics.includes(r.civic) && !r.scene && !r.locked));
const nearest = (cells, x, y) => cells.slice().sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y));
const lower = (r) => String(r.name || "room").replace(/ \(upstairs\)$/, "").replace(/ \d+$/, "").toLowerCase();

function gateStand(ctx) {
  const { rng } = ctx;
  for (const r of milRooms(ctx, "dutydesk", "guardpost", "mlobby")) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 5) continue;
    const door = (r.doors || []).find((d) => ctx.exit(d[0], d[1], f)) || (r.doors || [])[0];
    if (!door) continue;
    const far = nearest(free, door[0], door[1]).reverse();
    const n = rng.chance(0.5) ? 2 : 1;
    for (let i = 0; i < n; i++) { const [x, y] = far[i]; ctx.body(f, x, y, { human: true, kit: "soldiers", name: "A soldier" }); ctx.splatter(f, x, y, "human", rng.int(2, 3)); }
    for (const [x, y] of far.slice(n, n + 3)) { const c = ctx.at(f, x, y); c.brass = rng.int(SCENES.BRASS[0], SCENES.BRASS[1]); }
    const inn = NEXT4.map(([ox, oy]) => [door[0] + ox, door[1] + oy]).find(([x, y]) => x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1);
    if (inn && ctx.free(f, inn[0], inn[1]) && !ctx.stair(inn[0], inn[1])) ctx.piece(f, inn[0], inn[1], "sandbag");
    let placed = 0;
    for (const [x, y] of nearest(free, door[0], door[1])) { if (placed >= rng.int(2, 3)) break; if (!ctx.free(f, x, y)) continue; ctx.body(f, x, y, {}); ctx.splatter(f, x, y, "zombie", 1); placed++; }
    return ctx.done("gatestand", r, door[0], door[1], `Soldiers made a last stand at the ${lower(r)}: sandbags in the doorway, brass on the floor, ${placed} of the dead before them.`);
  }
  return null;
}
function barracksOverrun(ctx) {
  const { rng } = ctx;
  for (const r of milRooms(ctx, "bay")) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 6) continue;
    const pick = rng.shuffle(free.slice());
    const soldiers = rng.int(1, 2), dead = rng.int(2, 4);
    for (const [x, y] of pick.slice(0, soldiers)) { ctx.body(f, x, y, { human: true, kit: "soldiers", name: "A soldier" }); ctx.splatter(f, x, y, "human", rng.int(2, 4)); }
    for (const [x, y] of pick.slice(soldiers, soldiers + dead)) { ctx.body(f, x, y, {}); ctx.blood(f, x, y, "zombie", 1); }
    const [cx, cy] = pick[0];
    return ctx.done("barracksoverrun", r, cx, cy, `The ${lower(r)} was overrun in the night: blood across the bunks, soldiers who never got their boots on.`);
  }
  return null;
}
function armoryBarricade(ctx) {
  const { rng } = ctx;
  for (const r of ctx.rng.shuffle(ctx.rooms.filter((q) => q.civic === "vault" && !q.scene))) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 3) continue;
    // Its racks bare: what they held is gone (searched, empty).
    let emptied = 0;
    for (const b of ctx.map.containers) if (b.area === r.id && (b.f || 0) === f && !b.lockKind && b.kind !== "gunsafe") { b.contents = { sup: {}, gear: [] }; b.hidden = null; b.quick = false; b.searched = true; b.partial = false; emptied++; } // as poicont.js keeps a container emptied
    const door = (r.doors || [])[0];
    if (door) {
      const inn = NEXT4.map(([ox, oy]) => [door[0] + ox, door[1] + oy]).find(([x, y]) => x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1);
      if (inn && ctx.free(f, inn[0], inn[1]) && !ctx.stair(inn[0], inn[1])) ctx.piece(f, inn[0], inn[1], "locker");
    }
    const [x, y] = rng.pick(ctx.freeIn(r).length ? ctx.freeIn(r) : free);
    ctx.body(f, x, y, { human: true, kit: "soldiers", name: "A soldier", quiet: true });
    return ctx.done("armorybarricade", r, x, y, `Someone emptied the ${lower(r)} and barricaded themselves in: ${emptied ? "bare racks" : "nothing left"}, a locker against the door.`);
  }
  return null;
}
function helipadEvac(ctx) {
  const { rng } = ctx;
  for (const r of milRooms(ctx, "mlobby", "briefing")) {
    if (!ctx.rooms.some((q) => q.civic === "ops")) continue; // an HQ's
    const f = r.f || 0, free = ctx.freeIn(r).filter(([x, y]) => (x + y) % 2 === 0);
    if (free.length < 4) continue;
    const spots = rng.shuffle(free).slice(0, rng.int(3, 6));
    for (const [x, y] of spots.slice(0, 2)) ctx.piece(f, x, y, "cot");
    const [px, py] = spots[2];
    ctx.pile(f, px, py, "Bags dropped for the last flight out", { food: 1, water: 1, ammo: rng.int(5, 15) }, r.id);
    for (const [x, y] of spots.slice(3)) if (ctx.free(f, x, y)) ctx.body(f, x, y, { human: true, quiet: rng.chance(0.5) });
    return ctx.done("helipadevac", r, px, py, `An evacuation was called here and abandoned: bags left in a pile for the helicopter that never came.`);
  }
  return null;
}
function cellsOpen(ctx) {
  const { rng } = ctx;
  // A day room and its cells: #25's cell block (civic pdayroom, pcells), or a housing unit of #31's (prison.js cellblockSpec:
  // prison "dayroom", its tiers of cells).
  const dayrooms = ctx.rng.shuffle(ctx.rooms.filter((r) => (r.civic === "pdayroom" || r.prison === "dayroom") && !r.scene && !r.locked));
  for (const r of dayrooms) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 5) continue;
    let opened = 0;
    for (const q of ctx.rooms.filter((q) => (q.civic === "pcells" || q.prison === "tier") && (q.f || 0) === f)) {
      for (const [x, y] of ctx.inner(q)) { const c = ctx.at(f, x, y); if (c && c.cellDoor && c.k === "idoor") { c.k = "odoor"; opened++; } }
    }
    if (!opened) continue;
    const pick = rng.shuffle(free.slice());
    const n = rng.int(2, 4);
    for (const [x, y] of pick.slice(0, n)) { ctx.body(f, x, y, { human: true, name: "An inmate" }); ctx.splatter(f, x, y, "human", rng.int(1, 3)); }
    const [gx, gy] = pick[n];
    ctx.body(f, gx, gy, { human: true, kit: "guards", name: "A guard" });
    return ctx.done("cellsopen", r, gx, gy, `The control room opened every cell at once: ${opened} doors stand open, and the day room shows what came of it.`);
  }
  return null;
}
function terminalShelter(ctx) {
  const { rng } = ctx;
  for (const r of milRooms(ctx, "gates")) {
    const f = r.f || 0;
    const free = ctx.freeIn(r).filter(([x, y]) => (x + y) % 2 === 0 && NEXT4.every(([ox, oy]) => { const c = ctx.at(f, x + ox, y + oy); return c && c.k !== "stairs" && c.k !== "ladder"; }));
    if (free.length < 5) continue;
    const cots = rng.shuffle(free).slice(0, rng.int(4, 9));
    for (const [x, y] of cots) ctx.piece(f, x, y, "cot");
    const left = ctx.freeIn(r);
    if (!left.length) continue;
    const [bx, by] = rng.pick(left);
    ctx.piece(f, bx, by, "barrel");
    const by2 = nearest(ctx.freeIn(r).filter(([x, y]) => cots.some(([cx, cy]) => Math.abs(cx - x) + Math.abs(cy - y) === 1)), bx, by);
    const n = Math.min(by2.length, rng.int(2, 4));
    for (const [x, y] of rng.shuffle(by2).slice(0, n)) ctx.body(f, x, y, { human: true, quiet: rng.chance(0.6) });
    return ctx.done("terminalshelter", r, bx, by, `Travellers sheltered between the gates: cots among the seats, a water barrel, and ${n === 1 ? "one who never left" : `${n} who never left`}.`);
  }
  return null;
}
// Only on a map laid out by these styles (when): an older save's building rolls its scenes as it did.
const styled = (ctx) => ctx.rooms.some((r) => !!r.civic && !!MILITARY_STYLES[r.civic]);
registerScene("gatestand", { w: 3, place: gateStand, kinds: ["barracks", "gatehouse", "hq"], when: styled });
registerScene("barracksoverrun", { w: 3, place: barracksOverrun, kinds: ["barracks"], when: styled });
registerScene("armorybarricade", { w: 2, place: armoryBarricade, kinds: ["armorybldg"], when: styled });
registerScene("helipadevac", { w: 3, place: helipadEvac, kinds: ["hq"], when: styled });
registerScene("cellsopen", { w: 3, place: cellsOpen, kinds: ["cellblock"], when: (ctx) => styled(ctx) || ctx.rooms.some((r) => r.prison === "dayroom") });
registerScene("terminalshelter", { w: 3, place: terminalShelter, kinds: ["terminal"], when: styled });

// ======================================================================================
// The city crawl's checkpoint (citycrawl.js street event "checkpoint": a street map with a barracks and an armory as
// its guard shack and arms store, a wreck, a campsite): the new pieces put on the map genRaidMap made (a new save's:
// citycrawl.js sets setup.raid.checkpoint). The guard shack's containers become footlockers and a radio console stands
// in it; the arms store's become gun racks and ammo crates; the first wrecked car is the Army truck (drawn as the M35:
// ui/vehiclemodel.js); a barrier gate across the road's edge with a guard booth and sandbags beside it. Nothing that
// would cut a walkable cell off is put down (walk: combat.js CELL's walk rule). Hash dice (rng: its own).
// ======================================================================================
/** @param {any} map @param {number} W @param {number} H @param {any} rng @param {(k: string) => boolean} walk */
export function dressCheckpoint(map, W, H, rng, walk) {
  const cells = map.cells, I = (x, y) => y * W + x;
  const z = map.zones && map.zones[0];
  const reachCount = () => {
    if (!z) return 0;
    const seen = new Uint8Array(W * H), st = [I(z.x0 + 1, z.y0 + 1)];
    seen[st[0]] = 1;
    let n = 0;
    while (st.length) {
      const i = st.pop(); n++;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NEXT4) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = I(nx, ny); if (!seen[j] && (walk(cells[j].k) || cells[j].k === "door")) { seen[j] = 1; st.push(j); } }
    }
    return n;
  };
  let base = reachCount();
  const put = (x, y, k) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const c = cells[I(x, y)];
    if (c.k !== "open" || (map.containers || []).some((b) => b.x === x && b.y === y)) return false;
    c.k = k;
    const n = reachCount();
    if (n < base - 1) { c.k = "open"; return false; }
    base = n;
    return true;
  };
  const out = { footlockers: 0, racks: 0, truck: 0, barrier: 0, booth: 0 };
  for (const a of map.areas || []) {
    if (a.outdoor) continue;
    const boxes = (map.containers || []).filter((b) => b.area === a.id && b.kind !== "body");
    if (a.type === "barracks") {
      for (const b of boxes) { b.kind = "footlocker"; b.label = `${a.name}: footlocker`; cells[I(b.x, b.y)].k = "footlocker"; out.footlockers++; }
    } else if (a.type === "armory") {
      boxes.forEach((b, i) => { const k = i % 2 ? "ammocrate" : "gunrack"; b.kind = k; b.label = `${a.name}: ${k === "gunrack" ? "gun rack" : "ammo crate"}`; cells[I(b.x, b.y)].k = k; out.racks++; });
    } else continue;
  }
  const car = (map.containers || []).find((b) => b.kind === "car" && cells[I(b.x, b.y)].car);
  if (car) {
    for (let y = car.y; y < car.y + (car.h || 1); y++) for (let x = car.x; x < car.x + (car.w || 1); x++) { const c = cells[I(x, y)]; if (c.car) c.car = { ...c.car, body: "m35", mil: { cond: "wrecked" } }; }
    car.label = "Checkpoint: Army truck"; out.truck = 1;
  }
  // The barrier across the road's edge, the booth and the sandbags beside it.
  const road = [];
  for (let y = 1; y < H - 1; y++) for (let x = 2; x < W - 2; x++) if (cells[I(x, y)].f === "road" && cells[I(x, y)].k === "open") road.push([x, y]);
  if (road.length) {
    const ys = road.map((p) => p[1]), top = Math.min(...ys);
    const xm = Math.round(W / 2) + rng.int(-4, 4);
    for (const [x, y] of [[xm, top], [xm + 1, top]]) if (put(x, y, "barrier")) out.barrier++;
    if (put(xm + 2, top - 1, "guardbooth")) { out.booth++; for (const [dx, dy] of [[1, 0], [0, -1], [1, -1]]) put(xm + 2 + dx, top - 1 + dy, "sandbag"); }
  }
  return out;
}
