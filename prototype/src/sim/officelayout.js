// @ts-check
// The office buildings laid out for their kind (the user's request 2026-10-25, issue #27 of the interiors epic #7: "add
// office building varients"): the room styles of a storefront office (an insurance agent's, a lawyer's, an
// accountant's, a realtor's, a travel agent's, a dentist's, a doctor's practice), a business park's low-rise, the
// corporate tower floor by floor, city hall, the courthouse, a call center, a tech office and a TV or radio station or
// the paper, built on roomlayout.js's placement helpers (lanes kept clear, backs to the wall, nothing on a door's front,
// the lootable pieces the containers). The plans are officeplans.js: every leaf names its style (office: <style>);
// buildingmaps.js assemble asks officeStyle(room) before the other styles, so the mark wins in any building (the tower
// is the old "offices" key). An older save never gets here (opts.legacy: no style at all).
//
// What the rooms get (OFFICE_STYLES, by style name):
//   - front offices: the front desk (a counter run, a filing cabinet), waiting chairs and a table (reception,
//     waiting); private offices (a desk and its chair, a visitor's chair, a bookshelf, filing; a sofa in a big one); the
//     file room (filing cabinets, shelves, the copier); a kitchenette (a fridge, a sink, a microwave, a table);
//   - a dentist: operatories (the dental chair in the middle, the stool, the sink, a medicine cabinet, the instrument
//     cabinet: meds and tools), the sterilization room (a counter run, the sink, instrument cabinets); a doctor: exam
//     rooms (roomlayout.js MEDICAL_STYLES.exam) and the drug cupboard;
//   - open plan (desk pods between cubicle partitions, the copier, a water cooler, a plotter in a big one), meeting rooms
//     (a long table, chairs, a whiteboard), a training room (rows of tables facing the podium and the whiteboard), the
//     mail room (mail sorters, a counter, a plotter or a copier), the IT closet and the server room (server racks);
//   - the tower: the marble lobby (a row of security turnstiles across it with the way through left open, the
//     reception counter, the security desk, the lift bank on its back wall), the lift lobby of every floor (lift doors),
//     the café, the loading bay (pallet racks, crates, a forklift), the security office (the security desk, lockers);
//     executive offices (a big desk, a sofa, an armchair, the liquor cabinet now and then, a safe), the boardroom (a long
//     table, a whiteboard, the liquor cabinet), the canteen (tables, the serving counter, vending machines) and its
//     kitchen and cold store, the fitness center (weight benches) and its locker room, the executive suite (the safe
//     always, the liquor cabinet, a desk, a sofa), the roof plant;
//   - city hall: the rotunda lobby, the clerk's counter with queue posts in front of it, the permits office, the
//     council chambers (the council's dais at the back with their chairs behind it, the podium, rows of seats facing
//     them either side of an aisle), the mayor's office;
//   - the courthouse: the security screening entrance (a walk-through scanner, an X-ray belt, queue posts, the
//     security desk), the clerks' offices, the courtroom (the judge's bench on the back wall, the witness stand beside
//     it, the jury box on a side wall, the two counsel tables, the gallery's benches in rows facing the bench either
//     side of an aisle), the evidence room (evidence lockers: confiscated guns and knives), the judges' chambers, the
//     jury room, the law library (bookshelves in rows); its holding cell is civiclayout.js's cells (bars, a cell door);
//   - a call center: rows of headset desks back to back with their chairs, cubicle partitions, the supervisors' platform
//     (the security desk of monitors and a whiteboard of the numbers) on the main floor, the big break room (vending
//     machines, tables);
//   - a tech office: long bench desks with chairs both sides, beanbags, the games corner (the pool table, beanbags, a
//     TV), phone booths, the kitchen of drinks (fridges along its walls, a table), the server room;
//   - a station: the newsroom (desk pods, a TV, the whiteboard), the studio (the news desk, cameras on tripods facing
//     it, studio lights), a radio's broadcast booth (the console desk), a newspaper's press room (the press, rolls of
//     paper), the control room (consoles, a server rack), the archive, the transmitter room.
// Density: each room tops up to its share of containers (c.target, roomlayout.js), the plain pieces past it; the
// kinds' loot types and the new pieces' tables (data-offices.js OFFICE_AREAS, OFFICE_BOX) keep a building's loot per
// cell within ±10% of the old office tower's (tools/officestest.js).
import { hash01 } from "./skills.js";
import { roomLayout, MEDICAL_STYLES } from "./roomlayout.js";
import { COMMERCIAL_STYLES } from "./shoplayout.js";
import { registerScene, scenePieces, SCENES } from "./interiorscenes.js"; // the office buildings' signs of survival (issue #11's hook)
import { BMAP } from "./buildingmaps.js"; // call-time only (buildingmaps.js imports this module)

export const OFFICE = {
  POD_AREA: 24,     // an open-plan room this big (and 4+ across) gets desk pods; smaller, a desk or two
  DESKS: 1.5,       // the desks to search: up to the room's share of containers × this (the rest plain)
  PLOTTER: 60,      // a plotter in an open-plan floor or a mail room this big
  SAFE: 0.3,        // an executive office's safe
  LIQUOR: 0.5,      // an executive office's liquor cabinet
  BENCH: 4,         // a tech office's bench: desks end to end, up to this many
  // The containers a room holds: one every this many cells of its floor (at least one), by the building (the old
  // tower's few big rooms held two at most; these keep a building's loot per cell where the old tower's was: tuned
  // with tools/officestest.js, ±10%).
  CELLS: { storefront: 18, bizpark: 10.5, offices: 12.5, cityhall: 10.5, courthouse: 8, callcenter: 10.5, techoffice: 15, station: 20, default: 14 },
};

/** @typedef {ReturnType<typeof roomLayout>} Lay */
// ---------- shared pieces ----------
/** The room holds its share of containers: a lootable piece now stands plain. @param {Lay} L */
const full = (L) => L.boxes() >= L.target();
/** A placement's options with plain set as the room stands. @param {Lay} L */
const P = (L, o = {}) => ({ ...o, plain: full(L) });
/** Lootable pieces of these kinds (in turn) until the room holds its share: against the walls, then off them. @param {Lay} L */
function fill(L, kinds) {
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.wall(kinds[i % kinds.length], { prefer: "corner" })) miss = 0; else miss++; }
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.centre(kinds[i % kinds.length])) miss = 0; else miss++; }
}
/** Up to n of piece k against the walls (each the best spot left). @param {Lay} L */
function some(L, k, n, opts = {}) { const out = []; for (let i = 0; i < n; i++) { const r = L.wall(k, P(L, opts)); if (!r) break; out.push(r); } return out; }
/** A desk with its chair. @param {Lay} L */
function deskSet(L, opts = {}) {
  const d = L.wall("desk", P(L, opts)) || L.centre("desk", P(L, opts));
  if (d) L.around(d, "chair", 1);
  return d;
}
/** Tables with chairs round them over the floor. @param {Lay} L */
function tables(L, n, chairs = 2, k = "table") {
  let made = 0;
  for (let i = 0; i < n; i++) { const t = L.centre(k, P(L)); if (!t) break; L.around(t, "chair", chairs); made++; }
  return made;
}
/** A fixed piece that is its own locked container (the safe). @param {Lay} L */
function lockedPiece(L, k, opts = {}) {
  const r = L.wall(k, { prefer: "corner", ...opts });
  if (!r) return null;
  const [x, y] = r.cells[0];
  L.c.unblock(x, y);
  const box = L.c.container(x, y, k, L.lane);
  if (box) box.lockKind = "safe"; else L.c.block(x, y, k);
  L.c.cell(x, y).fc = r.face;
  return box;
}
/** A run of piece k across the room at row y (a counter, the turnstiles), off the lanes; plain (a flag or a test) for a lootable kind. @param {Lay} L */
function rowOf(L, y, k, o = {}) {
  const c = L.c, out = [];
  for (let x = c.x0 + (o.from ?? 0); x <= c.x1 - (o.to ?? 0); x++) {
    if (!L.ok(x, y) || (o.gap && (x - c.x0) % o.gap === o.gap - 1)) continue;
    const r = L.place(k, [[x, y]], { face: o.face || "s", plain: typeof o.plain === "function" ? o.plain() : o.plain ?? true });
    if (r) out.push(r);
  }
  return out;
}
/** A long table down the middle with chairs round it (a meeting room, a boardroom, a jury room). @param {Lay} L */
function longTable(L, most = 4) {
  const c = L.c, n = Math.max(2, Math.min(most, Math.max(c.w, c.h) - 3)), horiz = c.w >= c.h;
  const [mx, my] = [Math.floor((c.x0 + c.x1) / 2), Math.floor((c.y0 + c.y1) / 2)], cells = [];
  for (let i = 0; i < n; i++) { const x = horiz ? mx - Math.floor(n / 2) + i : mx, y = horiz ? my : my - Math.floor(n / 2) + i; if (L.place("table", [[x, y]])) cells.push([x, y]); }
  if (cells.length) L.around({ k: "table", cells, face: null, side: null, box: null }, "chair", cells.length * 2);
  return cells.length;
}
/**
 * Pairs of rows of desks back to back (pods), a chair at each desk on its open side, a partition at a pod's end, a
 * walk between the pairs; k the desk (a desk of 2 cells, a headset desk of 1). Returns the desks laid.
 * @param {Lay} L
 */
function pods(L, k, o = {}) {
  const c = L.c, w = k === "desk" ? 2 : 1, every = o.every || (w === 2 ? 2 : 3), cap = Math.max(L.target(), Math.round(L.target() * OFFICE.DESKS));
  let n = 0;
  for (let y = c.y0 + 1; y + 1 <= c.y1 - 1;) {
    let row = 0;
    for (let x = c.x0 + (o.side ?? 0); x + w - 1 <= c.x1 - (o.side ?? 0);) {
      const span = (yy) => Array.from({ length: w }, (_, i) => [x + i, yy]);
      if (![...span(y), ...span(y + 1)].every(([px, py]) => L.ok(px, py))) { x++; continue; }
      let laid = 0;
      for (let p = 0; p < every && x + w - 1 <= c.x1; p++, x += w) {
        if (![...span(y), ...span(y + 1)].every(([px, py]) => L.ok(px, py))) break;
        for (const [yy, face, cy] of [[y, "s", y - 1], [y + 1, "n", y + 2]]) {
          if (!L.place(k, span(yy), { face, plain: L.boxes() >= cap })) continue;
          n++;
          if (L.ok(x, cy)) L.place("chair", [[x, cy]], { face });
        }
        laid++;
      }
      if (laid && x <= c.x1 - 1 && L.ok(x, y) && L.ok(x, y + 1)) { L.c.block(x, y, "cubicle"); L.c.block(x, y + 1, "cubicle"); }
      row += laid; x += 1;
    }
    y += row ? 5 : 1;
  }
  return n;
}
/** A toilet (two in a long restroom) and a sink. @param {Lay} L */
function toiletAndSink(L) {
  const n = Math.max(L.c.w, L.c.h) >= 5 ? 2 : 1;
  for (let i = 0; i < n; i++) L.wall("toilet", { prefer: "corner" }) || (i === 0 && L.need("toilet", { prefer: "corner" }));
  L.wall("sink", { prefer: "middle" });
}
/** Rows of seats facing `face` from row y0 to y1, an aisle of `aisle` (the room's middle column) left open. @param {Lay} L */
function seatRows(L, k, y0, y1, face = "n", step = 1, aisle = true) {
  const c = L.c, w = k === "pew" ? 2 : 1, mid = Math.floor((c.x0 + c.x1) / 2);
  let n = 0;
  for (let y = y0; y <= y1; y += step) for (let x = c.x0 + 1; x + w - 1 <= c.x1 - 1;) {
    const cells = Array.from({ length: w }, (_, i) => [x + i, y]);
    if (aisle && cells.some(([cx]) => cx === mid)) { x++; continue; }
    if (L.place(k, cells, { face })) { n++; x += w; } else x++;
  }
  return n;
}
/** The room's door on its south wall's side (the one most rooms open by), else its first; null for none. @param {Lay} L */
const doorOf = (L) => { const ds = L.room.doors || []; return ds.find(([, y]) => y === L.c.y1 + 1) || ds[0] || null; };

// ======================================================================================
// The styles, by name. L: roomLayout(c) on the room's furnishCtx (buildingmaps.js); c.key the building's key.
// ======================================================================================
/** @type {Record<string, (L: Lay) => void>} */
export const OFFICE_STYLES = {
  // ---------- front offices ----------
  // The front desk at the back of the front office (a run of counters), filing behind it, waiting chairs along the
  // walls, a low table.
  reception(L) {
    const c = L.c, mid = c.x0 + Math.floor(c.w / 2);
    if (c.h >= 4) for (const x of [mid, mid - 1, mid + 1]) L.place("counter", [[x, c.y0 + 1]], P(L, { face: "s" }));
    else L.wall("counter", P(L, { sides: ["n"] }));
    L.wall("filing", P(L, { sides: ["n"], prefer: "corner" }));
    some(L, "chair", Math.min(4, Math.max(2, c.w - 3)), { sides: ["s", "w", "e"] });
    if (c.w * c.h >= 20) L.centre("table", P(L));
    fill(L, ["filing", "cabinet"]);
  },
  // A waiting room (a dentist's, a doctor's): the reception counter by the back, many chairs along the walls, a table of
  // magazines in the middle.
  waiting(L) {
    const c = L.c;
    L.run(["counter", "counter"], ["n"], { plain: () => full(L) });
    some(L, "chair", Math.min(8, Math.max(3, Math.floor((c.w * c.h) / 4))), { sides: ["s", "w", "e"] });
    L.centre("table", P(L));
    fill(L, ["filing", "cabinet"]);
  },
  // A private office: the desk and its chair, a visitor's chair, a bookshelf and filing; a sofa in a big one.
  privoffice(L) {
    const c = L.c, area = c.w * c.h;
    const d = deskSet(L, { prefer: "middle" });
    if (d && area >= 9) L.around(d, "chair", 2);
    L.wall("bookshelf", P(L, { prefer: "corner" }));
    if (area >= 16) L.wall("sofa") || L.wall("armchair");
    fill(L, ["filing", "bookshelf", "cabinet"]);
  },
  // A dentist's operatory: the dental chair in the room's middle (its foot to the door), the dentist's stool beside it,
  // the sink, a medicine cabinet and the instrument cabinet (meds, tools).
  operatory(L) {
    const ch = L.centre("dentalchair") || L.need("dentalchair");
    if (ch) L.around(ch, "chair", 1);
    L.wall("sink", { prefer: "corner" });
    L.wall("instcab", P(L, { prefer: "corner" })) || L.wall("medcab", P(L));
    L.wall("medcab", P(L));
    fill(L, ["cabinet", "medcab"]);
  },
  // A doctor's exam room (roomlayout.js's: the exam bed, the sink, the medicine cabinet, the desk).
  exam(L) { MEDICAL_STYLES.exam(L); },
  // A dentist's sterilization room: a counter run with the sink, instrument cabinets, shelves.
  sterile(L) {
    const ws = L.walls();
    L.run(["counter", "sink", "counter"], [ws[0] ? ws[0].side : "n"], { plain: () => full(L) });
    fill(L, ["instcab", "medcab", "shelf"]);
  },
  // A doctor's drug cupboard: medicine cabinets, shelves.
  drugroom(L) { fill(L, ["medcab", "medcab", "shelf"]); },
  // A file room, records: filing cabinets round the walls, shelves, the copier.
  fileroom(L) { L.wall("copier", { prefer: "corner" }); fill(L, ["filing", "filing", "shelf"]); },
  // A kitchenette: a fridge, a sink, a microwave and a counter along one wall; a small table.
  kitchenette(L) {
    const ws = L.walls();
    L.run(["fridge", "sink", "microwave", "counter"], [ws[0] ? ws[0].side : "n"], { plain: () => full(L) });
    if (!L.has("fridge")) L.wall("fridge", P(L));
    if (L.c.w * L.c.h >= 9) tables(L, 1, 2);
    fill(L, ["cabinet", "counter"]);
  },
  // The hall down a storefront's side: a water cooler at its end.
  hall(L) { L.wall("watercooler", { prefer: "corner" }); },
  restroom(L) { toiletAndSink(L); },
  // ---------- open plan, meetings, mail ----------
  // An open-plan floor: desk pods between partitions, the copier, a water cooler, a plotter in a big one, filing.
  openplan(L) {
    const c = L.c, area = c.w * c.h;
    L.wall("copier", { prefer: "corner" });
    L.wall("watercooler", { prefer: "corner" });
    if (area >= OFFICE.PLOTTER) L.wall("plotter", { prefer: "corner" });
    if (area >= OFFICE.POD_AREA && Math.min(c.w, c.h) >= 4) pods(L, "desk");
    else { deskSet(L, { prefer: "middle" }); deskSet(L, {}); }
    fill(L, ["filing", "cabinet"]);
  },
  // A meeting room: the long table and its chairs, the whiteboard, filing.
  meeting(L) { longTable(L); L.wall("whiteboard", { prefer: "middle" }); fill(L, ["filing", "cabinet"]); },
  // A training room: rows of tables facing the podium and the whiteboard on the back wall.
  training(L) {
    const c = L.c;
    L.wall("whiteboard", { sides: ["n"], prefer: "middle" });
    L.wall("podium", { sides: ["n"], prefer: "middle" }) || L.centre("podium");
    for (let y = c.y0 + 2; y <= c.y1 - 1; y += 2) for (let x = c.x0 + 1; x <= c.x1 - 1; x += 2) if (L.place("table", [[x, y]], { face: "n" }) && L.ok(x, y + 1)) L.place("chair", [[x, y + 1]], { face: "n" });
    fill(L, ["cabinet", "filing"]);
  },
  // The mail room: mail sorters along the walls, the counter, a plotter (or the copier), shelves and crates.
  mailroom(L) {
    const c = L.c;
    some(L, "sorter", Math.max(1, Math.floor(c.w / 3)), { prefer: "corner" });
    L.wall("counter", P(L, { prefer: "middle" }));
    L.wall(c.w * c.h >= 20 ? "plotter" : "copier", { prefer: "corner" });
    fill(L, ["sorter", "shelf", "crate"]);
  },
  // The IT closet: a server rack or two, shelves of parts, crates.
  itcloset(L) { fill(L, ["serverrack", "shelf", "crate"]); },
  // The server room: server racks in rows across the room (a walk between), more along the walls.
  serverroom(L) {
    const c = L.c;
    for (let y = c.y0 + 1; y <= c.y1 - 1; y += 2) rowOf(L, y, "serverrack", { from: 1, to: 1, plain: () => full(L) });
    fill(L, ["serverrack", "shelf"]);
  },
  breakroom(L) { COMMERCIAL_STYLES.breakroom(L); },
  // ---------- the corporate tower ----------
  // The marble lobby: the lift bank on its back wall, a row of security turnstiles across it (the way through left
  // open: the lanes), the reception counter and the security desk by the front, chairs.
  towerlobby(L) {
    const c = L.c;
    some(L, "liftdoor", 3, { sides: ["n"] });
    for (let y = c.y0 + 2; c.h >= 5 && y <= c.y1 - 2; y++) if (rowOf(L, y, "turnstile", { from: 1, to: 1, face: "s" }).length) break; // the first row a side door's lane leaves free
    L.wall("secdesk", P(L, { sides: ["w", "e"], near: [c.x0, c.y1] }));
    L.run(["counter", "counter"], ["e", "w"], { plain: () => full(L) });
    some(L, "chair", 2, { sides: ["s"] });
    fill(L, ["cabinet"]);
  },
  // A floor's lift lobby: lift doors on its side walls.
  liftlobby(L) { some(L, "liftdoor", 2, { sides: ["w", "e"] }); if (!L.has("liftdoor")) some(L, "liftdoor", 2, {}); },
  cafe(L) { COMMERCIAL_STYLES.cafe(L); },
  // The loading bay: pallet racks and crates along the walls, a forklift in a big one.
  loadingbay(L) { if (L.c.w * L.c.h >= 40) L.centre("forklift"); fill(L, ["crate", "palletrack", "crate", "shelf"]); },
  // The security office: the security desk of monitors, its chair, lockers, a cabinet.
  security(L) { const d = L.wall("secdesk", P(L, { prefer: "middle" })) || L.centre("secdesk", P(L)); if (d) L.around(d, "chair", 1); fill(L, ["locker", "cabinet"]); },
  // An executive office: the big desk, the visitors' chairs, a sofa and an armchair, a bookshelf, the liquor cabinet
  // and a safe now and then.
  execoffice(L) {
    const c = L.c, id = L.room.id;
    if (hash01(c.seed, "esafe", id) < OFFICE.SAFE) lockedPiece(L, "safe");
    const d = deskSet(L, { prefer: "middle", sides: ["n", "w", "e"] });
    if (d) L.around(d, "chair", 2);
    if (hash01(c.seed, "liquor", id) < OFFICE.LIQUOR) L.wall("liquorcab", P(L, { prefer: "corner" }));
    L.wall("sofa") || L.wall("armchair");
    L.wall("bookshelf", P(L, { prefer: "corner" }));
    fill(L, ["bookshelf", "filing", "cabinet"]);
  },
  // The executive suite on the top floor: the safe (always), the liquor cabinet, the desk, a sofa and armchairs.
  execsuite(L) {
    lockedPiece(L, "safe");
    L.wall("liquorcab", P(L, { prefer: "corner" })) || L.need("liquorcab", P(L));
    const d = deskSet(L, { prefer: "middle", sides: ["n", "w", "e"] });
    if (d) L.around(d, "chair", 2);
    L.wall("sofa"); L.centre("armchair");
    fill(L, ["bookshelf", "cabinet", "filing"]);
  },
  // The boardroom: a long table (longer than a meeting room's), the whiteboard, the liquor cabinet.
  boardroom(L) { longTable(L, 6); L.wall("whiteboard", { prefer: "middle" }); L.wall("liquorcab", P(L, { prefer: "corner" })); fill(L, ["cabinet", "bookshelf"]); },
  // The canteen: the serving counter along a wall, vending machines, tables and chairs.
  canteen(L) {
    const c = L.c;
    L.run(["counter", "counter", "counter"], [L.walls()[0] ? L.walls()[0].side : "n"], { plain: () => full(L) });
    some(L, "vending", 2, { prefer: "corner" });
    tables(L, Math.max(1, Math.floor((c.w * c.h) / 12)), 3);
    fill(L, ["counter", "cabinet"]);
  },
  canteenkitchen(L) { COMMERCIAL_STYLES.galley(L); },
  coldstore(L) { COMMERCIAL_STYLES.walkin(L); },
  // The fitness center: weight benches, a water cooler, lockers.
  fitness(L) { some(L, "weightbench", Math.max(2, Math.floor((L.c.w * L.c.h) / 10))); L.wall("watercooler", { prefer: "corner" }); fill(L, ["locker"]); },
  // The locker room: lockers along the walls, a shower.
  towerlockers(L) { L.wall("shower", { prefer: "corner" }); fill(L, ["locker", "locker", "shelf"]); },
  plant(L) { COMMERCIAL_STYLES.plant(L); },
  // ---------- city hall ----------
  // The rotunda lobby: an information counter, the security desk, benches (pews) along its walls.
  rotunda(L) { L.wall("counter", P(L, { sides: ["n"], prefer: "middle" })); L.wall("secdesk", P(L, { sides: ["w", "e"] })); some(L, "pew", 2, { sides: ["w", "e"] }); fill(L, ["cabinet"]); },
  // The clerk's office: the counter across the room, queue posts in front of it, desks and filing behind.
  clerk(L) {
    const c = L.c, y = Math.max(c.y0 + 2, Math.min(c.y1 - 2, c.y0 + 2));
    rowOf(L, y, "counter", { from: 1, to: 1, plain: () => full(L) });
    if (y + 2 <= c.y1) for (let x = c.x0 + 1; x <= c.x1 - 1; x += 2) if (L.ok(x, y + 2)) L.place("stanchion", [[x, y + 2]]);
    deskSet(L, { sides: ["n"] });
    fill(L, ["filing", "cabinet"]);
  },
  // The permits office: a counter, desks, filing.
  permits(L) { L.wall("counter", P(L, { prefer: "middle" })); deskSet(L, {}); deskSet(L, {}); fill(L, ["filing", "cabinet"]); },
  // The council chambers: the council's dais across the back with their chairs behind it, the podium before it, rows
  // of seats facing them either side of an aisle down the middle.
  council(L) {
    const c = L.c, mid = Math.floor((c.x0 + c.x1) / 2);
    for (let x = c.x0 + 1; x + 1 <= c.x1 - 1; x += 2) if (L.place("dais", [[x, c.y0 + 1], [x + 1, c.y0 + 1]], { face: "s" })) for (const cx of [x, x + 1]) if (L.ok(cx, c.y0)) L.place("chair", [[cx, c.y0]], { face: "s" });
    if (!L.has("dais")) L.need("dais", { sides: ["n"] });
    L.place("podium", [[mid, c.y0 + 2]], { face: "n" }) || L.place("podium", [[mid + 1, c.y0 + 2]], { face: "n" }) || L.centre("podium");
    seatRows(L, "chair", c.y0 + 4, c.y1, "n", 1);
    fill(L, ["cabinet", "shelf"]);
  },
  // The mayor's office: the executive office's (a safe by its own dice, the desk, a sofa), a flag stand's corner.
  mayor(L) { OFFICE_STYLES.execoffice(L); },
  records(L) { COMMERCIAL_STYLES.records(L); },
  // ---------- the courthouse ----------
  // The security screening entrance: the X-ray belt and the walk-through scanner beside the way through, queue posts
  // before them, the security desk, chairs.
  screening(L) {
    const c = L.c, d = doorOf(L), near = d ? [d[0], d[1] - 1] : [c.x0, c.y1];
    L.wall("xraybelt", { sides: ["w", "e"], near }) || L.centre("xraybelt", { near });
    L.wall("screener", { sides: ["w", "e"], near }) || L.centre("screener", { near });
    for (let x = c.x0 + 1; x <= c.x1 - 1; x += 2) if (L.ok(x, c.y1 - 1)) L.place("stanchion", [[x, c.y1 - 1]]);
    L.wall("secdesk", P(L, { sides: ["n", "w", "e"] }));
    some(L, "chair", 2, { sides: ["n"] });
    fill(L, ["cabinet", "crate"]);
  },
  // A clerk's office: desks, filing cabinets, a counter.
  clerks(L) { deskSet(L, {}); deskSet(L, {}); L.wall("counter", P(L, { prefer: "middle" })); fill(L, ["filing", "filing", "cabinet"]); },
  // The courtroom: the judge's bench on the back wall (its chair behind it), the witness stand beside it, the jury box
  // on a side wall, the counsel tables, the gallery's benches in rows facing the bench either side of the aisle.
  courtroom(L) {
    const c = L.c, mid = Math.floor((c.x0 + c.x1) / 2);
    const bench = L.place("judgebench", [[mid - 1, c.y0 + 1], [mid, c.y0 + 1]], { face: "s" }) || L.wall("judgebench", { sides: ["n"], prefer: "middle" }) || L.need("judgebench");
    if (bench) { const [bx, by] = bench.cells[0]; if (L.ok(bx, by - 1)) L.place("chair", [[bx, by - 1]], { face: "s" }); L.place("witnessstand", [[bench.cells[bench.cells.length - 1][0] + 1, by]], { face: "s" }) || L.beside(bench, "witnessstand"); }
    if (!L.has("witnessstand")) L.need("witnessstand");
    const side = L.variant(2, "jury") ? "e" : "w";
    L.wall("jurybox", { sides: [side], prefer: "middle" }) || L.wall("jurybox", { sides: [side === "e" ? "w" : "e"] }) || L.need("jurybox");
    L.wall("jurybox", { sides: [side] });
    for (const x of [mid - 3, mid + 2]) if (L.place("table", [[x, c.y0 + 3]], { face: "n" }) && L.ok(x, c.y0 + 4)) L.place("chair", [[x, c.y0 + 4]], { face: "n" });
    if (seatRows(L, "pew", c.y0 + 6, c.y1 - 1, "n", 2) === 0) seatRows(L, "chair", c.y0 + 5, c.y1 - 1, "n", 1);
    fill(L, ["cabinet", "filing"]);
  },
  // The evidence room: evidence lockers round the walls (confiscated guns and knives), shelves.
  evidence(L) { fill(L, ["evlocker", "evlocker", "shelf"]); },
  // A judge's chambers: the desk, bookshelves of law, an armchair.
  chambers(L) { const d = deskSet(L, { prefer: "middle" }); if (d) L.around(d, "chair", 1); some(L, "bookshelf", 2, { prefer: "corner" }); L.centre("armchair"); fill(L, ["bookshelf", "filing"]); },
  // The jury room: the long table, a water cooler.
  jury(L) { longTable(L, 6); L.wall("watercooler", { prefer: "corner" }); fill(L, ["cabinet"]); },
  // The law library: bookshelves in rows, a reading table.
  lawlibrary(L) { COMMERCIAL_STYLES.stacks(L); tables(L, 1, 2); },
  // ---------- a call center ----------
  // A call floor: rows of headset desks back to back, partitions; the main floor's supervisors' platform in the middle
  // (the security desk of monitors, the whiteboard of the numbers).
  callfloor(L) {
    const c = L.c;
    if (/^Main/.test(L.room.name || "")) { const s = L.centre("secdesk", P(L)) || L.wall("secdesk", P(L, { prefer: "middle" })) || L.need("secdesk", P(L)); if (s) L.around(s, "chair", 2); L.wall("whiteboard", { prefer: "middle" }); }
    L.wall("watercooler", { prefer: "corner" });
    pods(L, "headsetdesk", { every: 3 });
    fill(L, ["filing", "cabinet"]);
  },
  // The big break room: vending machines, the fridge, the sink and the microwave, tables.
  bigbreak(L) {
    some(L, "vending", Math.max(2, Math.floor(L.c.w / 3)), { prefer: "corner" });
    COMMERCIAL_STYLES.breakroom(L);
    tables(L, Math.floor((L.c.w * L.c.h) / 16), 3);
  },
  // ---------- a tech office ----------
  // Long bench desks with chairs both sides, beanbags in a corner, a whiteboard.
  benches(L) {
    L.wall("whiteboard", { prefer: "middle" });
    pods(L, "desk", { every: OFFICE.BENCH });
    some(L, "beanbag", 2, { prefer: "corner" });
    fill(L, ["filing", "cabinet"]);
  },
  // The lobby: a counter, a sofa, beanbags.
  techlobby(L) { L.wall("counter", P(L, { sides: ["n"], prefer: "middle" })); L.wall("sofa", { sides: ["w", "e"] }); some(L, "beanbag", 2, {}); fill(L, ["cabinet"]); },
  // The games corner, a lounge: the pool table, beanbags, a sofa facing a TV, a vending machine.
  lounge(L) {
    const c = L.c;
    if (c.w * c.h >= 20) L.centre("pooltable");
    const tv = L.wall("tvstand", P(L));
    if (tv) L.facing(tv, "sofa"); else L.wall("sofa");
    some(L, "beanbag", 3, { prefer: "corner" });
    L.wall("vending", P(L, { prefer: "corner" }));
    fill(L, ["tvstand", "cabinet"]);
  },
  // The kitchen of drinks: fridges along its walls, the sink and the microwave, a table.
  techkitchen(L) {
    const ws = L.walls();
    L.run(["fridge", "fridge", "sink", "microwave", "counter"], [ws[0] ? ws[0].side : "n"], { plain: () => full(L) });
    if (!L.has("fridge")) L.wall("fridge", P(L));
    L.wall("fridge", P(L));
    tables(L, 1, 3);
    fill(L, ["fridge", "counter"]);
  },
  // Phone booths: glass pods along the walls.
  phonebooths(L) { some(L, "phonebooth", 3, {}); fill(L, ["cabinet"]); },
  // ---------- a station ----------
  // The newsroom: desk pods, a TV on its stand, the whiteboard, the copier, filing.
  newsroom(L) {
    L.wall("tvstand", P(L, { prefer: "corner" }));
    L.wall("whiteboard", { prefer: "middle" });
    L.wall("copier", { prefer: "corner" });
    if (L.c.w * L.c.h >= OFFICE.POD_AREA) pods(L, "desk"); else { deskSet(L, {}); deskSet(L, {}); }
    fill(L, ["filing", "cabinet"]);
  },
  // The TV studio: the news desk at the back with the anchors' chairs, cameras on tripods facing it, the lights.
  studio(L) {
    const c = L.c, mid = Math.floor((c.x0 + c.x1) / 2), y = c.y0 + 1;
    const desk = L.place("newsdesk", [[mid - 1, y], [mid, y]], { face: "s", plain: full(L) }) || L.wall("newsdesk", P(L, { sides: ["n"], prefer: "middle" })) || L.need("newsdesk");
    if (desk) for (const [x, yy] of desk.cells) if (L.ok(x, yy - 1)) L.place("chair", [[x, yy - 1]], { face: "s" });
    const cy = Math.min(c.y1 - 1, y + 3);
    for (const x of [mid - 2, mid + 1]) L.place("camera", [[x, cy]], { face: "n" });
    if (!L.has("camera")) L.centre("camera", { face: "n" });
    for (const [x, yy] of [[c.x0, c.y0], [c.x1, c.y0], [c.x0, c.y1], [c.x1, c.y1]]) L.place("studiolight", [[x, yy]], { face: "n" });
    if (!L.has("studiolight")) L.wall("studiolight", { prefer: "corner" });
    fill(L, ["cabinet", "shelf"]);
  },
  // A radio station's broadcast booth: the console desk (monitors), chairs, shelves of records.
  booth(L) { const d = L.wall("secdesk", P(L, { prefer: "middle" })) || L.need("secdesk", P(L)); if (d) L.around(d, "chair", 2); L.wall("studiolight", { prefer: "corner" }); fill(L, ["shelf", "cabinet"]); },
  // A newspaper's press room: the press, rolls of paper (crates), a workbench, shelves.
  press(L) { L.centre("machine") || L.wall("machine"); L.wall("workbench", P(L)); fill(L, ["crate", "shelf", "toolchest"]); },
  // The control room: consoles along the back wall, chairs, a server rack, a TV.
  control(L) {
    const r = L.run(["secdesk", "secdesk"], ["n"], { plain: () => full(L) });
    for (const p of (r && r.placed) || []) L.around(p, "chair", 1);
    if (!L.has("secdesk")) L.need("secdesk", P(L));
    L.wall("serverrack", P(L, { prefer: "corner" }));
    L.wall("tvstand", P(L));
    fill(L, ["serverrack", "cabinet"]);
  },
  // The archive, the tape library: shelves and filing.
  archive(L) { fill(L, ["shelf", "filing", "bookshelf"]); },
  // The transmitter room: server racks of transmitter gear, a workbench and a tool chest.
  transmitter(L) { const b = L.wall("workbench", P(L, { prefer: "middle" })); if (b) L.beside(b, "toolchest", P(L)); fill(L, ["serverrack", "toolchest", "shelf"]); },
};

// The style of a room (buildingmaps.js assemble): its leaf's office mark, else null (the other styles).
/** @param {any} room */
export function officeStyle(room) {
  const fn = room && room.office ? OFFICE_STYLES[room.office] : null;
  return fn ? (L) => { density(L); fn(L); } : null;
}
// The room's share of containers by its floor (OFFICE.CELLS by the building), where it holds any.
/** @param {Lay} L */
function density(L) {
  if (!L.c.canBox) return;
  L.c.target = Math.max(1, Math.round((L.c.w * L.c.h) / (OFFICE.CELLS[L.c.key] ?? OFFICE.CELLS.default)));
}

// ======================================================================================
// The office buildings' signs of survival (interiorscenes.js registerScene, issue #11's hook; their own dice there),
// only on a map laid out by these styles (when: an area carries its style as `office`):
//   officehold   office workers held an upper floor: the stairwell's door on that floor jammed with filing cabinets and
//                desks (a piece in the frame, one shoved against it on the stairwell's side), or the top of a stair run
//                ringed with them; the floor's biggest room theirs (SCENES.ALIVE of the time still held:
//                floorfolk.js's survivors hold it first; else two who never left and the last of the snacks);
//   heldcell     a courthouse's holding cell: a prisoner who turned behind its locked cell door (a Sleeper);
//   councilshelter city hall's council chambers used as a shelter: cots between the seats, a water barrel, the ones who
//                never left;
//   lastbroadcast a station's studio (its booth, its newsroom): the anchor's body at the desk, the script of the last
//                broadcast beside them with a hand-crank radio (a working radio).
// ======================================================================================
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const offRooms = (ctx, styles) => ctx.rng.shuffle(ctx.rooms.filter((r) => styles.includes(r.office) && !r.scene && !r.locked));
const nearest = (cells, x, y) => cells.slice().sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y));
const lower = (r) => String(r.name || "room").replace(/ \(upstairs\)$/, "").replace(/ \d+$/, "").toLowerCase();
const inRoom = (r, x, y) => x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1;
const ORD = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

function officeHold(ctx) {
  const { rng } = ctx;
  const stairs = ctx.map.stairs || [];
  if (ctx.floors.length < 2 || !stairs.length) return null;
  const floors = rng.shuffle(Array.from({ length: ctx.floors.length - 1 }, (_, i) => i + 1));
  for (const f of floors) {
    const set = [];
    let where = null;
    for (const [sx, sy] of stairs) {
      if ((ctx.at(f, sx, sy) || {}).k !== "stairs") continue;
      const r = ctx.rooms.find((q) => (q.f || 0) === f && inRoom(q, sx, sy));
      if (r && r.role === "stairwell") {
        // The stairwell's door jammed: a piece in its frame, another against it on the stairwell's side.
        for (const [dx, dy] of r.doors || []) {
          const door = ctx.at(f, dx, dy);
          if (!door || !["idoor", "odoor"].includes(door.k) || ctx.used(f, dx, dy)) continue;
          const [k1, k2] = scenePieces(r, rng, 2, { half: true });
          delete door.blood;
          door.k = "odoor";
          ctx.piece(f, dx, dy, k1 === "desk" || k1 === "sofa" || k1 === "bed" || k1 === "pew" ? "filing" : k1);
          set.push([dx, dy]);
          const inn = NEXT4.map(([ox, oy]) => [dx + ox, dy + oy]).find(([x, y]) => inRoom(r, x, y) && ctx.free(f, x, y));
          if (inn) { ctx.piece(f, inn[0], inn[1], ["desk", "sofa", "bed", "pew"].includes(k2) ? "cabinet" : k2); set.push(inn); }
          where = where || [dx, dy];
        }
      } else {
        // A stair run in a room: its top ringed with pieces (half cover: crawled over, vaulted).
        const ring = AROUND.map(([dx, dy]) => [sx + dx, sy + dy]).filter(([x, y]) => ctx.free(f, x, y));
        const ks = scenePieces(r, rng, ring.length, { half: true });
        ring.forEach(([x, y], i) => { ctx.piece(f, x, y, ks[i]); set.push([x, y]); });
        if (ring.length) where = where || [sx, sy];
      }
    }
    if (!set.length) continue;
    const held = ctx.rooms.filter((q) => (q.f || 0) === f && q.role !== "stairwell" && !q.locked && !q.scene && !q.hub).sort((p, q) => q.w * q.h - p.w * p.h)[0];
    if (!held) continue;
    const alive = rng.chance(SCENES.ALIVE);
    if (!alive) {
      const free = ctx.freeIn(held);
      const n = Math.min(free.length, rng.int(1, 2));
      for (const [x, y] of rng.shuffle(free).slice(0, n)) ctx.body(f, x, y, { human: true, quiet: rng.chance(0.6) });
      const p = ctx.freeIn(held)[0];
      if (p) ctx.pile(f, p[0], p[1], "Vending machine snacks and a water jug", { food: 1, water: 1 }, held.id);
    }
    const floorName = ORD[f] ? `the ${ORD[f]} floor` : `floor ${f + 1}`;
    return ctx.done("officehold", held, where[0], where[1], `Filing cabinets and desks are jammed in the stairway on ${floorName}: office workers held the ${lower(held)} against the dead${alive ? "" : ", and never came down"}.`, alive ? { alive: true } : {});
  }
  return null;
}
// A holding cell's door locked (a locked door of the map: locks.js opens it; the dead batter it).
function lockCell(ctx, r, f, x, y) {
  const c = ctx.at(f, x, y);
  c.k = "door"; c.dk = "cell"; c.hp = c.mhp = Math.max(60, BMAP.DOOR.locked);
  ctx.take(f, x, y);
  if (ctx.map.lockedDoors) ctx.map.lockedDoors.push({ x, y, f, area: r.id, kind: "door", dk: "cell" });
}
function heldCell(ctx) {
  for (const r of ctx.rng.shuffle(ctx.rooms.filter((q) => q.civic === "cells" && !q.scene && !q.locked))) {
    const f = r.f || 0;
    const ok = ctx.inner(r).map(([x, y]) => ctx.at(f, x, y)).filter((c) => c && c.cellDoor && c.cellIn && c.k === "idoor" && (ctx.at(f, c.cellIn[0], c.cellIn[1]) || {}).k === "open" && !ctx.used(f, c.cellIn[0], c.cellIn[1]));
    const door = ok.length ? ctx.inner(r).find(([x, y]) => ctx.at(f, x, y) === ok[0]) : null;
    if (!door) continue;
    const dc = ok[0];
    ctx.body(f, dc.cellIn[0], dc.cellIn[1], { sleeper: true });
    ctx.blood(f, dc.cellIn[0], dc.cellIn[1], "zombie", 1);
    lockCell(ctx, r, f, door[0], door[1]);
    return ctx.done("heldcell", r, door[0], door[1], "Something moves behind the bars of the holding cell: a prisoner waiting for a hearing that never came, turned where they were left.");
  }
  return null;
}
function councilShelter(ctx) {
  const { rng } = ctx;
  for (const r of offRooms(ctx, ["council"])) {
    const f = r.f || 0;
    const free = ctx.freeIn(r).filter(([x, y]) => (x + y) % 2 === 0 && NEXT4.every(([ox, oy]) => { const c = ctx.at(f, x + ox, y + oy); return c && c.k !== "stairs" && c.k !== "ladder"; }));
    if (free.length < 4) continue;
    const cots = rng.shuffle(free).slice(0, rng.int(3, 7));
    for (const [x, y] of cots) ctx.piece(f, x, y, "cot");
    const left = ctx.freeIn(r);
    if (!left.length) continue;
    const [bx, by] = rng.pick(left);
    ctx.piece(f, bx, by, "barrel");
    const by2 = nearest(ctx.freeIn(r).filter(([x, y]) => cots.some(([cx, cy]) => Math.abs(cx - x) + Math.abs(cy - y) === 1)), bx, by);
    const n = Math.min(by2.length, rng.int(1, 3));
    for (const [x, y] of rng.shuffle(by2).slice(0, n)) ctx.body(f, x, y, { human: true, quiet: rng.chance(0.6) });
    const p = ctx.freeIn(r).find(([x, y]) => Math.abs(x - bx) + Math.abs(y - by) <= 2);
    if (p) ctx.pile(f, p[0], p[1], "The town's emergency rations: a few tins and water", { food: rng.int(1, 2), water: 1 }, r.id);
    return ctx.done("councilshelter", r, bx, by, `The council chambers were the town's shelter: cots between the seats, a water barrel${n ? `, and ${n === 1 ? "one who never left" : `${n} who never left`}` : ""}.`);
  }
  return null;
}
function lastBroadcast(ctx) {
  const { rng } = ctx;
  for (const r of offRooms(ctx, ["studio", "booth", "newsroom"])) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 2) continue;
    const desk = ctx.inner(r).find(([x, y]) => ["newsdesk", "secdesk", "desk"].includes((ctx.at(f, x, y) || {}).k));
    const [ax, ay] = desk ? nearest(free, desk[0], desk[1])[0] : rng.pick(free);
    ctx.body(f, ax, ay, { human: true, quiet: rng.chance(0.5), name: "The anchor" });
    const p = nearest(ctx.freeIn(r), ax, ay)[0];
    if (p) ctx.pile(f, p[0], p[1], "The script of the last broadcast and a hand-crank radio", {}, r.id, ["handradio"]);
    const what = r.office === "booth" ? "the microphone" : r.office === "studio" ? "the cameras" : "the desks";
    return ctx.done("lastbroadcast", r, ax, ay, `The lights still point at ${what}. The script of the last broadcast lies by the anchor: "...stay indoors, stay off the roads, and do not open your door to anyone you love."`);
  }
  return null;
}
const styled = (ctx) => ctx.rooms.some((r) => !!r.office);
registerScene("officehold", { w: 4, place: officeHold, kinds: ["offices", "bizpark", "techoffice", "callcenter", "cityhall", "courthouse", "station", "storefront"], when: styled });
registerScene("heldcell", { w: 4, place: heldCell, kinds: ["courthouse"], when: styled });
registerScene("councilshelter", { w: 4, place: councilShelter, kinds: ["cityhall"], when: styled });
registerScene("lastbroadcast", { w: 5, place: lastBroadcast, kinds: ["station"], when: styled });
