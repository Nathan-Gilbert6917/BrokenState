// @ts-check
// Commercial interiors laid out for their kind (the user's request 2026-10-25, issue #16 of the interiors epic #7: "Make
// the layouts make sense and filled with appliances, furniture and decor that makes it feel lived in. Special buildings
// [...] should have furniture, appliances, decor, rooms and layouts that make sense for the type of building. [...]
// Improve the building, furniture, appliances etc fidelity for raids and crawls."). The room styles of the shops,
// restaurants, diners, bars, offices, motels, banks, libraries, big stores, the dealer, the auto shop and garage, the
// warehouse, the factory and the barn, built on roomlayout.js's placement helpers (lanes kept clear, backs to the wall,
// nothing on a door's front, the lootable pieces the containers). buildingmaps.js assemble asks commercialStyle(room,
// key) before roomlayout.js homeStyle; null keeps the room on buildingmaps.js FURNISH (an older save always: opts.legacy).
//
// What each building gets (COMMERCIAL_STYLES, by style name; styleName picks it from the building's key, the room's role,
// its name and the marks the plan put on it):
//   - a shop's front room by kind: aisles of shelving in rows with a 1-cell walk between them and a shelf to search at
//     each end (the end cap) and every few cells, a checkout with its register by the front door; a cold case run along
//     a side wall (grocery, corner store, liquor, gas station: drinks and spoiled dairy, BOX_LOOT.coldcase); the gun
//     counter (a run of display cases) with the gun racks along the wall behind it (gun store, pawn shop: the pawn
//     counter's ends caged in bars); bookshelves in rows (bookstore); fish tanks and cages of bars (pet store);
//     potting benches (garden); clothes racks (clothing); a counter with the workbench behind it (electronics, radio);
//     tool aisles and a key-cutting counter (hardware);
//   - a shop's back rooms: the stockroom (shelves and crates), the manager's office (a desk, a chair, filing, the safe:
//     always locked), the staff toilet, the fitting rooms (cubicle partitions, a stool each, clothes racks), the gun cage
//     (gun racks, lockers), the repair bench, the greenhouse (garden: glass walls, potting benches), the yard (pallet
//     racks of lumber);
//   - a restaurant: the dining room of tables and chairs, booths along the walls, the order counter and the register; a
//     diner's long counter with bar stools and a pie case; the commercial kitchen (a range of six rings, a deep fryer
//     where they fry, a pizza oven at a pizza place, stainless counters, a sink, a dishwasher, shelves; knives: the
//     kitchen's table) and the walk-in cold room behind a steel door (cold-room shelving: spoiled food, some tins); a
//     bar's long bar counter with stools, the liquor shelves and the beer fridge behind it, a jukebox, a pool table;
//   - an office tower: the lobby (the reception counter, the security desk with its monitors, chairs), the open-plan
//     floors (desks in pods between cubicle partitions, chairs, filing, a copier, a water cooler), meeting rooms (a long
//     table, chairs, a whiteboard), the corner offices (a desk, a bookshelf, a sofa, sometimes a safe), the break room
//     (a fridge, a microwave, a vending machine, a table), the server room (server racks), the restrooms;
//   - a motel: each room a bed, a nightstand, a TV stand facing the bed and a chest of drawers (its bathroom is
//     roomlayout.js's), the front desk (the counter, the key rack, the safe, a sofa, the vending machine and the ice
//     machine), the manager's flat (a kitchenette, a bed, a table), the laundry (washers, dryers, linen shelves);
//   - a bank: the banking hall (teller windows along its back wall, queue posts, chairs, desks), the ATM lobby at the
//     front door (the ATM: a locked container of cash), the teller line, the safe-deposit room and the vault (safe-
//     deposit boxes), offices;
//   - a supermarket and a department store: aisles in long rows with a wide front aisle, checkout lanes, cold aisles of
//     shop fridges, the deli (display and cold cases, the bakery's oven), the pharmacy counter (a supermarket's), racks
//     of clothes, the furniture department (beds, sofas, wardrobes, drawers to loot), the stockroom of pallet racks;
//   - a dealer's showroom (cars on the tiles, desks), service bays (a car on a lift, tool chests, a workbench, tyre
//     racks, an air compressor), a parts counter; a warehouse's pallet racks in rows and a forklift; a factory floor of
//     machine tools with tool chests between; a barn's stalls of fence and its tack room (saddle racks).
// Density: every style tops its room up to the containers it held before (c.target, × SHOP.BOXES[style] where the old
// furnishing held more), so a shop holds what it did within ±10% (tools/shopstest.js, 200 seeds a kind).
import { hash01 } from "./skills.js";
import { registerScene, SCENES } from "./interiorscenes.js"; // the commercial buildings' signs of survival (issue #11's hook)

export const SHOP = {
  EVERY: 4,           // aisles: a shelf to search every this many cells of shelving (and one at each end)
  FRONT: 3,           // aisles: the rows kept clear at a shop's front for the checkout and the walk
  MEETING: 0.35,      // an office tower's room of 12+ cells is a meeting room on these dice (an open-plan floor at OPEN cells)
  OPEN: 24,
  SERVER: 0.2,        // a tower's records room is its server room on these dice
  OFFICE_SAFE: 0.3,   // a corner office's safe
  DESKS: 1.5,         // an open-plan floor's desks to search: up to its share of containers × this (the rest: tables)
  // The containers a style's room holds: the area's share (c.target, as roomlayout.js), × this where the old furnishing
  // held more (the aisles' and the racks' every-few boxes), "full" for the room's maxBoxes; "style:key" for one
  // building's. Tuned with tools/shopstest.js: each kind within ±10% of before. A lootable piece placed past the share
  // stands plain (not searched: roomlayout.js place's plain).
  BOXES: {
    superfloor: 1.6, deptfloor: 1.75, pallets: 1.3, "pallets:warehouse": 1.1, "pallets:deptstore": 1, machines: 1.1, stacks: 1.05, bookfront: 1.2,
    aislefront: "full", "aislefront:deptstore": 1.3, guncounter: 1.25, guncage: 1.7, "stock:electronics": 1.25, walkin: 2,
  },
};
// The buildings whose rooms take these styles (buildingmaps.js BUILDINGS keys).
const SHOPS = ["grocery", "corner", "pharmacy", "gunstore", "pawnshop", "sportshop", "electronics", "radioshop", "bookstore", "petstore", "garden", "clothing", "liquor", "restaurant", "pizza", "bar", "hardware", "feedstore", "diner", "gasstation", "truckstop"];
export const COMMERCIAL_KEYS = new Set([...SHOPS, "supermarket", "deptstore", "offices", "motel", "dealer", "bank", "library", "warehouse", "factory", "autoshop", "garage", "workshop", "machineshed", "barn"]);
const SHOP_SET = new Set(SHOPS);

// ---------- shared pieces ----------
/** @typedef {ReturnType<typeof import("./roomlayout.js").roomLayout>} Lay */
// A piece of shelving that is not searched (the stock between the shelves that are): blocked as before, off the lanes.
/** @param {Lay} L */
const shelving = (L, x, y, k) => L.ok(x, y) && L.c.block(x, y, k);
/** The room holds its share of containers: a lootable piece now stands plain. @param {Lay} L */
const full = (L) => L.boxes() >= L.target();
/** A placement's options with plain set as the room stands. @param {Lay} L */
const P = (L, o = {}) => ({ ...o, plain: full(L) });
/**
 * Lootable pieces of these kinds (in turn) until the room holds its share: against the walls while they take one (a
 * corner first), then off them (roomlayout.js fill stops after a couple of tries; a shop's long walls take many).
 * @param {Lay} L
 */
function fill(L, kinds) {
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.wall(kinds[i % kinds.length], { prefer: "corner" })) miss = 0; else miss++; }
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.centre(kinds[i % kinds.length])) miss = 0; else miss++; }
}
/** The room cell inside the front door (or the front wall's middle). @param {Lay} L */
function frontDoor(L) {
  const c = L.c, d = (L.room.doors || []).find(([, y]) => y === c.y1 + 1);
  return d ? [d[0], d[1] - 1] : [Math.floor((c.x0 + c.x1) / 2), c.y1];
}
/** A checkout counter and its register by the front door. @param {Lay} L */
const checkout = (L) => L.wall("checkout", P(L, { sides: ["s", "w", "e"], near: frontDoor(L) })) || L.need("checkout", P(L, { near: frontDoor(L) }));
/** The style's share of containers (SHOP.BOXES). @param {Lay} L */
function share(L, name) {
  const b = SHOP.BOXES[`${name}:${L.c.key}`] ?? SHOP.BOXES[name];
  if (b === "full") L.c.target = Math.max(L.c.target, L.room.maxBoxes ?? 4);
  else if (b) L.c.target = Math.max(L.c.target, Math.round(L.c.target * b));
}
/** n pieces of k along a wall (the longest free one when not given). @param {Lay} L */
function along(L, k, n, sides) {
  const ws = sides || L.walls().map((w) => w.side);
  if (!ws.length) return [];
  return L.run(Array(n).fill(k), ws, { plain: () => full(L) }).placed;
}
/** Up to n of piece k against the walls (each the best spot left). @param {Lay} L */
function some(L, k, n, opts = {}) { const out = []; for (let i = 0; i < n; i++) { const r = L.wall(k, P(L, opts)); if (!r) break; out.push(r); } return out; }
/**
 * Rows of shelving across the room from the back (every other row: a 1-cell walk between): a container of `box` at each
 * end of a run (the end cap) and every `every` cells while the room has its share to come, the rest `k` (not searched);
 * a cross aisle down the middle of a wide room; the front `front` rows kept clear. The lanes cut the rows where they
 * cross. @param {Lay} L
 */
function aisles(L, o = {}) {
  const c = L.c, k = o.k || "rack", box = o.box || "shelf", every = o.every || SHOP.EVERY, cap = o.cap === undefined ? box : o.cap;
  const yEnd = c.y1 - (o.front ?? (c.h >= 8 ? SHOP.FRONT : 2)), x0 = c.x0 + (o.side ?? 1), x1 = c.x1 - (o.side ?? 1);
  const mid = c.x0 + Math.floor(c.w / 2) + L.variant(3, "cross") - 1;
  const gap = (x) => c.w > 10 && (x === mid || (c.w > 18 && Math.abs(x - mid) === 6));
  let rows = 0;
  for (let y = c.y0 + (o.start ?? 1); y <= yEnd; y += o.step || 2) {
    while (y <= yEnd && freeIn(L, y, x0, x1) * 2 < x1 - x0 + 1) y++; // a lane runs along this row (between two doors): the next
    if (y > yEnd) break;
    let seg = [];
    const flush = () => {
      seg.forEach((x, i) => {
        const want = (i === 0 || i === seg.length - 1) && cap ? cap : i % every === every - 1 ? box : null;
        if (want && !full(L) && L.place(want, [[x, y]], { face: "s" })) return;
        shelving(L, x, y, k);
      });
      seg = [];
    };
    for (let x = x0; x <= x1; x++) { if (gap(x) || !L.ok(x, y)) { flush(); continue; } seg.push(x); }
    flush();
    rows++;
  }
  if (!rows && o.fallback !== false) some(L, k, 2, { prefer: "corner" }); // a shallow room the lanes cross: shelving along a wall
  return rows;
}
/** The cells of row y between x0 and x1 that take a piece (off the lanes). @param {Lay} L */
function freeIn(L, y, x0, x1) { let n = 0; for (let x = x0; x <= x1; x++) if (L.ok(x, y)) n++; return n; }
/** Row y if it is mostly off the lanes, else the freest of the next row and the back wall's. @param {Lay} L */
function rowFrom(L, y) {
  const c = L.c, free = (r) => (r >= c.y0 && r <= c.y1 ? freeIn(L, r, c.x0 + 1, c.x1 - 1) : -1);
  if (free(y) * 2 >= c.w - 2) return y;
  return [y + 1, c.y0, y].reduce((a, b) => (free(b) > free(a) ? b : a));
}
/** A counter run across the room at row y (display cases, a bar), every `every`-th a container of `box`; `ends` at its ends. @param {Lay} L */
function counterRow(L, y, k, o = {}) {
  const c = L.c, every = o.every || 3, out = [];
  for (let x = c.x0 + (o.from ?? 1); x <= c.x1 - (o.to ?? 1); x++) {
    if (!L.ok(x, y)) continue;
    const i = out.length;
    const r = (o.box && i % every === every - 1 && !full(L) ? L.place(o.box, [[x, y]], { face: o.face || "s" }) : null) || L.place(k, [[x, y]], { face: o.face || "s", plain: true });
    if (r) out.push(r);
  }
  if (o.ends && out.length >= 3) for (const p of [out[0], out[out.length - 1]]) { if (p.box) continue; const [x, yy] = p.cells[0]; L.c.unblock(x, yy); if (!L.c.block(x, yy, o.ends)) L.c.block(x, yy, k); }
  return out;
}
/** Bar stools in front of a counter run (on a lane only when none fits off one: the counter needs its stool). @param {Lay} L */
function stools(L, row) {
  let n = 0;
  for (const p of row) { const [x, y] = p.cells[0]; if (L.ok(x, y + 1) && L.place("barstool", [[x, y + 1]], { face: "n" })) n++; }
  for (const p of row) { if (n) break; const [x, y] = p.cells[0]; if (L.place("barstool", [[x, y + 1]], { face: "n", force: true })) n++; }
  return n;
}
/** Tables with chairs round them over the floor. @param {Lay} L */
function tables(L, n, chairs = 2, k = "table") {
  let made = 0;
  for (let i = 0; i < n; i++) { const t = L.centre(k); if (!t) break; L.around(t, "chair", chairs); made++; }
  return made;
}
/** Booths along the walls. @param {Lay} L */
function booths(L, n, sides) {
  let made = 0;
  for (let i = 0; i < n; i++) { if (!L.wall("booth", { sides, prefer: "corner" })) break; made++; }
  return made;
}
/** A desk with its chair (its drawers searched while the room has its share to come). @param {Lay} L */
function deskSet(L, opts = {}) {
  const d = L.wall("desk", P(L, opts)) || L.centre("desk", P(L, opts));
  if (d) L.around(d, "chair", 1);
  return d;
}
/** A fixed piece that is its own locked container (the safe: a manager's till, a corner office's; the ATM). @param {Lay} L */
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
/** A toilet and a sink (two toilets in a long restroom). @param {Lay} L */
function toiletAndSink(L) {
  const n = Math.max(L.c.w, L.c.h) >= 5 ? 2 : 1;
  for (let i = 0; i < n; i++) L.wall("toilet", { prefer: "corner" }) || (i === 0 && L.need("toilet", { prefer: "corner" }));
  L.wall("sink", { prefer: "middle" });
}
/** An open-plan floor: desks in pods of two facing rows, partitions between the pods, chairs, filing, a copier and a water cooler. @param {Lay} L */
function openPlan(L) {
  const c = L.c, cap = Math.max(L.target(), Math.round(L.target() * SHOP.DESKS));
  L.wall("copier", { prefer: "corner" });
  L.wall("watercooler", { prefer: "corner" });
  // Pods where four cells take them (the lanes between the doors cut through: the pods shift round them), a row of pods
  // every five rows (a chair, two desks, a chair, the walk).
  for (let y = c.y0 + 1; y + 1 <= c.y1 - 1;) {
    let pods = 0;
    for (let x = c.x0; x + 1 <= c.x1;) {
      if (![[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].every(([px, py]) => L.ok(px, py))) { x++; continue; }
      for (const [yy, face, cy] of [[y, "s", y - 1], [y + 1, "n", y + 2]]) {
        if (!L.place("desk", [[x, yy], [x + 1, yy]], { face, plain: L.boxes() >= cap })) continue;
        if (L.ok(x, cy)) L.place("chair", [[x, cy]], { face });
      }
      if (x + 2 <= c.x1 - 1) { shelving(L, x + 2, y, "cubicle"); shelving(L, x + 2, y + 1, "cubicle"); }
      pods++; x += 4;
    }
    y += pods ? 5 : 1;
  }
  fill(L, ["filing", "cabinet"]);
}
/** A meeting room: a long table down the middle with chairs round it, a whiteboard, filing. @param {Lay} L */
function meeting(L) {
  const c = L.c, n = Math.max(2, Math.min(4, Math.max(c.w, c.h) - 3)), horiz = c.w >= c.h;
  const [mx, my] = [Math.floor((c.x0 + c.x1) / 2), Math.floor((c.y0 + c.y1) / 2)], cells = [];
  for (let i = 0; i < n; i++) { const x = horiz ? mx - Math.floor(n / 2) + i : mx, y = horiz ? my : my - Math.floor(n / 2) + i; if (L.place("table", [[x, y]])) cells.push([x, y]); }
  if (cells.length) L.around({ k: "table", cells, face: null, side: null, box: null }, "chair", cells.length * 2);
  L.wall("whiteboard", { prefer: "middle" });
  fill(L, ["filing", "cabinet"]);
}

// ======================================================================================
// The styles, by name. L: roomLayout(c) on the room's furnishCtx (buildingmaps.js); c.key the building's key.
// ======================================================================================
/** @type {Record<string, (L: Lay) => void>} */
export const COMMERCIAL_STYLES = {
  // ---------- shop fronts ----------
  // A grocery's, a corner store's, a gas station's, a liquor store's: aisles, the cold case along a side wall, the checkout.
  minimart(L) {
    share(L, "minimart");
    checkout(L);
    along(L, "coldcase", Math.max(2, Math.floor(L.c.h / 2)), [L.variant(2, "cold") ? "e" : "w"]);
    aisles(L, { box: "shelf" });
    fill(L, ["shelf", "coldcase"]);
  },
  // A pharmacy's, a sporting goods store's, a pet store's (fish tanks, cages), a feed store's, a garden center's (potting
  // benches): aisles and the checkout.
  aislefront(L) {
    share(L, "aislefront");
    const key = L.c.key;
    checkout(L);
    if (key === "petstore") { along(L, "tank", 3, [L.variant(2, "tank") ? "e" : "w"]); some(L, "bars", 2, { sides: ["n"] }); }
    if (key === "sportshop" || key === "deptstore") { const r = L.centre("clothesrack", P(L)); if (r) L.around(r, "clothesrack", 1); }
    if (key === "garden") some(L, "pottingbench", 2, { prefer: "middle" });
    aisles(L, { box: key === "feedstore" || key === "garden" ? "crate" : "shelf" });
    fill(L, key === "garden" ? ["crate", "shelf"] : ["shelf"]);
  },
  // A hardware store: tool aisles, the key-cutting counter (a workbench with a counter beside it), the checkout.
  hardware(L) {
    checkout(L);
    const bench = L.wall("workbench", P(L, { sides: ["w", "e"], prefer: "corner" }));
    if (bench) L.beside(bench, "counter", P(L));
    aisles(L, { box: "shelf" });
    fill(L, ["shelf", "crate"]);
  },
  // A gun store's showroom: the gun counter (a run of display cases) across the room, the gun racks along the wall behind,
  // the till by the door.
  guncounter(L) {
    share(L, "guncounter");
    const c = L.c, y = Math.max(c.y0 + 2, c.y1 - 2);
    checkout(L);
    counterRow(L, y, "displaycase", { box: "displaycase", every: 3, from: 2, to: 2 });
    counterRow(L, c.y0, "gunrack", { box: "gunrack", every: 3, from: 0, to: 0, face: "s" });
    fill(L, ["gunrack", "displaycase"]);
  },
  // A pawn shop's: the pawn counter of display cases caged in bars at its ends, shelves of pawned things, the till.
  pawncounter(L) {
    const c = L.c, y = Math.max(c.y0 + 2, c.y1 - 2);
    checkout(L);
    counterRow(L, y, "displaycase", { box: "displaycase", every: 3, from: 2, to: 2, ends: "bars" });
    fill(L, ["shelf", "displaycase", "gunrack"]);
  },
  // An electronics or a radio shop: the counter with the workbench behind it at the back, display cases, shelves.
  techcounter(L) {
    const c = L.c;
    L.wall("workbench", P(L, { sides: ["n"], prefer: "middle" })) || L.wall("workbench", P(L, { prefer: "corner" }));
    if (c.h >= 5) counterRow(L, rowFrom(L, c.y0 + 2), "counter", { box: "counter", every: 3, from: 2, to: 2 });
    checkout(L);
    if (c.h >= 8) aisles(L, { start: 4, box: "shelf" });
    some(L, "displaycase", 2, { sides: ["w", "e"] });
    fill(L, ["shelf", "displaycase"]);
  },
  // A bookstore: bookshelves along the walls and in rows, a reading table, the till by the door.
  bookfront(L) {
    share(L, "bookfront");
    checkout(L);
    aisles(L, { k: "bookshelf", box: "bookshelf", every: 3 });
    fill(L, ["bookshelf"]);
    tables(L, 1, 2);
  },
  // A clothing store: clothes racks in rows (some searched), the checkout, shelves.
  clothesfront(L) {
    checkout(L);
    aisles(L, { k: "clothesrack", box: "clothesrack", every: 3 });
    fill(L, ["shelf", "clothesrack"]);
  },
  // ---------- restaurants, diners and bars ----------
  // A restaurant's dining room: the order counter along the back, the register, booths on the side walls, tables.
  dining(L) {
    const c = L.c;
    checkout(L);
    L.run(["counter", "counter", "counter"], ["n"], { plain: () => full(L) });
    booths(L, c.h >= 4 ? 2 : 0, ["w", "e"]);
    tables(L, Math.max(1, Math.floor((c.w * c.h) / 16)), 2);
    fill(L, ["counter", "shelf"]);
  },
  // A diner's (a pizza place's, a truck stop's): the long counter with bar stools in front, the pie case at its end, booths.
  diner(L) {
    const c = L.c;
    const row = counterRow(L, rowFrom(L, c.y0 + 1), "barcounter", c.w >= 6 ? { from: 1, to: 2 } : { from: 0, to: 0 });
    if (c.h >= 4) stools(L, row);
    L.wall("displaycase", P(L, { sides: ["e", "w"], near: [c.x1, c.y0] })); // the pie case
    checkout(L);
    booths(L, 3, ["w", "e", "s"]);
    tables(L, Math.floor((c.w * c.h) / 24), 2);
    fill(L, ["counter", "shelf"]);
  },
  // A bar: the long bar with its stools, the liquor shelves and the beer fridge behind it; a jukebox, a pool table, tables.
  barroom(L) {
    const c = L.c, deep = c.h >= 6;
    if (deep) L.run(["shelf", "coldcase", "shelf", "shelf"], ["n"], { plain: () => full(L) }); // behind the bar, a walk in front of them
    const row = counterRow(L, rowFrom(L, deep ? c.y0 + 2 : c.y0), "barcounter", { from: 1, to: deep ? 2 : 1 });
    stools(L, row);
    if (!deep) L.wall("coldcase", P(L, { sides: ["w", "e"] }));
    checkout(L); // the till at the end of the bar
    L.wall("jukebox", { sides: ["w", "e"], prefer: "corner" });
    if (c.w * c.h >= 30) L.centre("pooltable");
    booths(L, 1, ["w", "e"]);
    tables(L, Math.floor((c.w * c.h) / 24), 2);
    fill(L, ["shelf", "coldcase"]);
  },
  // A bar's stage and dance floor: a jukebox, tables round the edge.
  stage(L) { L.wall("jukebox", { prefer: "corner" }); tables(L, 2, 2); fill(L, ["shelf"]); },
  // The commercial kitchen: a range, a deep fryer where they fry, a pizza oven at a pizza place, stainless counters, a
  // sink and a dishwasher, shelves.
  galley(L) {
    const c = L.c, ws = L.walls();
    if (!ws.length) return;
    const line = [...(L.room.pizza ? ["pizzaoven"] : []), "range", ...(L.room.fry ? ["fryer"] : []), "counter", "sink", "dishwasher", "counter"];
    L.run(line, ws.slice(0, 2).map((w) => w.side), { plain: () => full(L) });
    if (!L.has("range")) L.need("range");
    if (L.room.pizza && !L.has("pizzaoven")) L.wall("pizzaoven") || L.need("oven");
    if (!L.has("sink")) L.wall("sink");
    if (c.w * c.h >= 16) L.centre("counter", P(L)); // the prep island
    fill(L, ["shelf", "counter"]);
  },
  // The walk-in cold room behind its steel door: cold-room shelving round the walls (spoiled food, some tins).
  walkin(L) { share(L, "walkin"); fill(L, ["coldshelf"]); if (!L.has("coldshelf")) L.need("coldshelf"); },
  // A bar's keg room: kegs (barrels) and shelves.
  kegroom(L) { some(L, "barrel", 2, { prefer: "corner" }); fill(L, ["shelf", "coldcase"]); },
  // ---------- back rooms ----------
  // A stockroom: shelves round the walls to search, crates stacked between.
  stock(L) {
    share(L, "stock");
    fill(L, ["shelf", "shelf", "crate"]);
    const c = L.c;
    if (c.w * c.h > 16) for (const [x, y] of c.innerSpots().slice(0, 2)) shelving(L, x, y, "crate");
  },
  // The manager's office (a shop's, a workroom): a desk and its chair, the safe (the till: always locked), filing.
  manager(L) {
    if (L.room.boxLock && L.room.boxLock[0] === "safe") lockedPiece(L, "safe");
    deskSet(L, { prefer: "middle" });
    fill(L, ["filing", "cabinet"]);
  },
  // A staff toilet, a restroom.
  restroom(L) { toiletAndSink(L); },
  // Fitting rooms: cubicle partitions making stalls along the back wall, a stool in each, clothes racks to search.
  fitting(L) {
    const c = L.c;
    for (let x = c.x0 + 1; x <= c.x1; x += 2) { shelving(L, x, c.y0, "cubicle"); if (c.h >= 4) shelving(L, x, c.y0 + 1, "cubicle"); }
    for (let x = c.x0; x <= c.x1; x += 2) if (L.ok(x, c.y0)) L.place("chair", [[x, c.y0]], { face: "s" });
    fill(L, ["clothesrack", "shelf", "locker"]);
  },
  // A gun cage or a gun case: gun racks round the walls, lockers and ammunition crates.
  guncage(L) { share(L, "guncage"); fill(L, ["gunrack", "locker", "gunrack"]); if (L.c.h >= 4) L.centre("crate", P(L)); },
  // A pharmacy's dispensary, a supermarket's pharmacy counter: the pharmacist's counter, shelves of drugs.
  dispensary(L) { L.wall("counter", P(L, { prefer: "middle" })); fill(L, ["shelf", "cabinet"]); },
  // A repair bench (electronics, radio): the workbench, a tool chest, shelves of parts.
  repair(L) { const b = L.wall("workbench", P(L, { prefer: "middle" })); if (b) L.beside(b, "toolchest", P(L)); fill(L, ["shelf", "toolchest"]); },
  // A garden center's greenhouse (glass walls: buildingmaps.js glass): potting benches, shelves and crates.
  greenhouse(L) { some(L, "pottingbench", 2); fill(L, ["pottingbench", "shelf", "crate"]); },
  // A yard (lumber, garden stock): pallet racks in rows, crates.
  yard(L) { aisles(L, { box: "palletrack", every: 3, front: 1, cap: "crate" }); fill(L, ["crate", "palletrack"]); },
  // ---------- big stores ----------
  // A supermarket's floor: aisles in long rows with a wide front aisle, the cold aisle of shop fridges along a side wall,
  // checkout lanes at the front.
  superfloor(L) {
    share(L, "superfloor");
    const c = L.c, y = c.y1 - 2;
    for (let x = c.x0 + 2; x <= c.x1 - 2; x += 3) if (L.ok(x, y) && L.ok(x, y + 1)) L.place("checkout", [[x, y]], P(L, { face: "s" }));
    along(L, "coldcase", Math.max(3, c.h - 6), [L.variant(2, "cold") ? "e" : "w"]);
    aisles(L, { front: 4, box: "shelf", every: 5 });
    fill(L, ["shelf", "coldcase"]);
  },
  // A department store's floor: racks of clothes, the furniture department (a display bed, a sofa, an armchair,
  // wardrobes and chests of drawers to loot), the checkout.
  deptfloor(L) {
    share(L, "deptfloor");
    const c = L.c;
    checkout(L);
    if (c.w >= 10) { L.wall("bed", { size: [2, 2], sides: ["n"] }); L.wall("sofa", { sides: ["n"] }); L.centre("armchair"); }
    for (const k of ["wardrobe", "dresser", "wardrobe"]) L.wall(k, P(L, { sides: ["n", "e", "w"] }));
    aisles(L, { k: "clothesrack", box: "clothesrack", every: 4, start: 3, front: 4 });
    fill(L, ["shelf", "clothesrack", "dresser"]);
  },
  // A supermarket's deli: display and cold cases along its front, the bakery's oven, counters and a sink at the back.
  deli(L) {
    L.run(["displaycase", "coldcase", "displaycase"], ["s"], { plain: () => full(L) });
    L.run(["oven", "counter", "sink", "counter"], ["n"], { plain: () => full(L) });
    if (!L.has("oven")) L.wall("oven") || L.need("oven");
    fill(L, ["counter", "shelf"]);
  },
  // A stockroom of pallet racks (a big store's back room, a warehouse floor), a forklift parked between them.
  pallets(L) {
    share(L, "pallets");
    const c = L.c;
    if (c.w * c.h >= 40) L.centre("forklift");
    aisles(L, { box: "palletrack", every: 3, step: 3, front: 2, cap: "crate" });
    fill(L, ["crate", "palletrack"]);
  },
  // A break room: the fridge, a sink, a microwave, a vending machine, a table and chairs.
  breakroom(L) {
    const ws = L.walls();
    L.c.target += 1; // the staff's fridge on top of the room's share (its table holds less: combat.js BOX_LOOT)
    L.run(["fridge", "sink", "microwave", "counter"], [ws[0] ? ws[0].side : "n"], { plain: () => full(L) });
    if (!L.has("fridge")) L.wall("fridge", P(L));
    L.wall("vending", P(L));
    tables(L, 1, 3);
    fill(L, ["counter", "cabinet"]);
  },
  // ---------- offices ----------
  // An office tower's lobby: the reception counter, the security desk with its monitors, chairs along the walls.
  officelobby(L) {
    const c = L.c, mid = c.x0 + Math.floor(c.w / 2);
    if (c.h >= 4) for (const x of [mid, mid - 1, mid + 1]) L.place("counter", [[x, c.y0 + 1]], P(L, { face: "s" }));
    if (c.w * c.h >= 20) L.wall("secdesk", P(L, { sides: ["w", "e"] }));
    some(L, "chair", 3, { sides: ["s", "w", "e"] });
    fill(L, ["cabinet"]);
  },
  // An office: an open-plan floor, a meeting room, or a private office (a desk, a bookshelf, a sofa, sometimes a safe).
  officefloor(L) {
    const c = L.c, area = c.w * c.h;
    if (area >= SHOP.OPEN && Math.min(c.w, c.h) >= 4) return openPlan(L);
    if (area >= 12 && hash01(c.seed, "meeting", L.room.id) < SHOP.MEETING) return meeting(L);
    if (hash01(c.seed, "osafe", L.room.id) < SHOP.OFFICE_SAFE) lockedPiece(L, "safe");
    deskSet(L, { prefer: "middle" });
    L.wall("bookshelf", P(L, { prefer: "corner" }));
    if (area >= 12) L.wall("sofa");
    fill(L, ["filing", "bookshelf"]);
  },
  // A tower's records room (filing, shelves), or its server room (server racks: electronics).
  records(L) {
    if (L.c.key === "offices" && hash01(L.c.seed, "server", L.room.id) < SHOP.SERVER) { fill(L, ["serverrack"]); return; }
    fill(L, ["filing", "shelf"]);
  },
  // A tower's plant room: the boiler, the water heater, a workbench and a tool chest.
  plant(L) { L.wall("boiler", { prefer: "corner" }); L.wall("waterheater", { prefer: "corner" }); fill(L, ["toolchest", "workbench", "shelf"]); },
  // A cafe in a tower's lobby: the counter and the register, a cold case, tables.
  cafe(L) { checkout(L); L.run(["counter", "coldcase", "counter"], ["n"], { plain: () => full(L) }); tables(L, Math.floor((L.c.w * L.c.h) / 14), 2); fill(L, ["counter", "shelf"]); },
  // ---------- libraries ----------
  // The stacks: bookshelves in rows.
  stacks(L) { share(L, "stacks"); aisles(L, { k: "bookshelf", box: "bookshelf", every: 3, front: 1 }); fill(L, ["bookshelf"]); },
  // The circulation desk: its counter, chairs, bookshelves.
  circulation(L) {
    const c = L.c, mid = c.x0 + Math.floor(c.w / 2);
    if (c.h >= 4) for (const x of [mid, mid - 1, mid + 1]) L.place("counter", [[x, c.y0 + 1]], P(L, { face: "s" }));
    some(L, "chair", 2, { sides: ["w", "e"] });
    fill(L, ["bookshelf"]);
  },
  // A reading room, a study room: tables with chairs, bookshelves.
  reading(L) { tables(L, Math.max(1, Math.floor((L.c.w * L.c.h) / 12)), 3); fill(L, ["bookshelf"]); },
  // The children's corner: little tables and chairs, bookshelves.
  children(L) { tables(L, 2, 3); fill(L, ["bookshelf", "shelf"]); },
  // ---------- motels ----------
  // A motel room: the bed, a nightstand by it, the TV stand on the wall it faces, the chest of drawers (the drawers and
  // the nightstand searched within the room's share, the rest plain).
  motelroom(L) {
    const bed = L.wall("bed", { prefer: "middle", sides: ["n", "w", "e"] }) || L.need("bed", { size: [1, 2] });
    L.wall("dresser", P(L)) || L.need("dresser", P(L));
    if (bed) L.beside(bed, "nightstand", P(L)) || L.wall("nightstand", P(L, { near: bed.cells[0] }));
    if (bed) L.facing(bed, "tvstand", P(L)) || L.wall("tvstand", P(L)); else L.wall("tvstand", P(L));
    L.wall("chair", { prefer: "corner" });
  },
  // The front desk: the counter, the key rack behind it, the safe, a sofa, the vending machine and the ice machine.
  motelfront(L) {
    lockedPiece(L, "safe", { sides: ["n", "w", "e"] });
    L.run(["counter", "counter"], ["n"], { plain: () => full(L) });
    L.wall("keyrack", { sides: ["n"] }) || L.wall("keyrack");
    L.wall("sofa", { sides: ["s", "w", "e"] });
    L.wall("vending", P(L));
    L.wall("icemachine");
  },
  // The manager's flat behind the office: a kitchenette, a bed, a table.
  mgrflat(L) {
    const ws = L.walls();
    L.run(["fridge", "sink", "stove"], [ws[0] ? ws[0].side : "n"], { plain: () => full(L) });
    const bed = L.wall("bed", { prefer: "corner" });
    if (bed) L.beside(bed, "nightstand", P(L));
    tables(L, 1, 2);
    fill(L, ["dresser", "cabinet"]);
  },
  // The laundry: washers and dryers along a wall, linen shelves.
  laundry(L) {
    fill(L, ["shelf"]);
    const ws = L.walls();
    L.run(["washer", "dryer", "washer", "dryer"], ws.length ? [ws[0].side] : ["n"]);
  },
  // A studio (an extended-stay motel's room, a motor lodge's cabin: issue #32): a kitchenette along one wall (a fridge,
  // a sink, a stove: data-appliances.js's), then the room's bed, nightstand, TV stand and chest of drawers.
  motelstudio(L) {
    const ws = L.walls();
    L.run(["fridge", "sink", "stove"], [ws[0] ? ws[0].side : "n"], { plain: () => full(L) });
    COMMERCIAL_STYLES.motelroom(L);
  },
  // An ice and vending nook (a motel's, issue #32): the vending machine and the ice machine.
  vendnook(L) { L.wall("vending", P(L)) || L.need("vending", P(L)); L.wall("icemachine"); },
  // The motel's upper walkway: the ice machine.
  walkway(L) { L.wall("icemachine", { sides: ["n"], prefer: "corner" }); },
  // ---------- banks ----------
  // The banking hall: teller windows along its back wall, queue posts in front of them, chairs, the desks.
  bankhall(L) {
    const c = L.c;
    for (let x = c.x0 + 1; x <= c.x1 - 1; x++) if (L.ok(x, c.y0)) L.place("teller", [[x, c.y0]], { face: "s" });
    if (c.h >= 5) for (let x = c.x0 + 2; x <= c.x1 - 2; x += 2) if (L.ok(x, c.y0 + 2)) L.place("stanchion", [[x, c.y0 + 2]]);
    some(L, "chair", 2, { sides: ["s", "w", "e"] });
    deskSet(L, { sides: ["w", "e"] });
    fill(L, ["desk", "cabinet"]);
  },
  // The ATM lobby at the front door: the ATM (a locked container of cash) on its wall.
  atmlobby(L) { lockedPiece(L, "atm", { sides: ["w", "e", "n"], prefer: undefined }); },
  // The teller line behind the windows: the tellers' cash drawers (cabinets), filing, desks.
  tellers(L) { fill(L, ["cabinet", "filing", "desk"]); },
  // The vault and the safe-deposit room: safe-deposit boxes round the walls.
  vault(L) { fill(L, ["deposit", "deposit", "cabinet"]); },
  // ---------- dealers, garages, warehouses, factories, barns ----------
  // A dealer's showroom: cars on the tiles, the salesmen's desks.
  showroom(L) {
    const c = L.c, cars = Math.max(1, Math.floor(c.w / 7));
    for (let i = 0; i < cars; i++) for (const [x, y] of c.innerSpots().slice(0, 10)) if (!L.lane(x, y) && c.car(x, y, "car")) break;
    deskSet(L, { sides: ["n", "w", "e"] });
    deskSet(L, { sides: ["n", "w", "e"] });
    fill(L, ["cabinet", "desk"]);
  },
  // Service bays: the cars (the first on its lift), tool chests, a workbench, tyre racks, an air compressor, shelves.
  bays(L) {
    const c = L.c, cars = Math.max(1, Math.floor(c.w / 5));
    for (let i = 0; i < cars; i++) { const kind = c.rng.chance(0.3) ? "truck" : "car"; for (const [x, y] of c.innerSpots().slice(0, 8)) if (!L.lane(x, y) && c.car(x, y, kind)) { if (i === 0) L.centre("carlift", { near: [x, y] }); break; } }
    const bench = L.wall("workbench", P(L, { prefer: "corner" }));
    if (bench) L.beside(bench, "toolchest", P(L));
    L.wall("compressor", { prefer: "corner" });
    fill(L, ["shelf", "tirerack", "toolchest"]);
  },
  // A parts room: the parts counter, shelves and tyre racks.
  parts(L) { L.wall("counter", P(L, { prefer: "middle" })); fill(L, ["shelf", "tirerack", "shelf"]); },
  // A workshop: workbenches, tool chests, a compressor.
  workshop(L) { L.wall("compressor", { prefer: "corner" }); fill(L, ["workbench", "toolchest", "shelf"]); },
  // A factory floor: machine tools in rows, a tool chest or a workbench in front of each.
  machines(L) {
    share(L, "machines");
    const c = L.c;
    for (let y = c.y0 + 1; y <= c.y1 - 2; y += 3) for (let x = c.x0 + 1; x <= c.x1 - 2; x += 4) {
      if (L.ok(x, y) && L.ok(x + 1, y)) L.place("machine", [[x, y], [x + 1, y]], { face: "s" });
      if (L.ok(x, y + 1) && !full(L)) { const chest = L.variant(2, `m${x},${y}`); L.place(chest ? "toolchest" : "workbench", chest ? [[x, y + 1]] : [[x, y + 1], [x + 1, y + 1]], { face: "s" }); }
    }
    fill(L, ["toolchest", "shelf", "crate"]);
  },
  // A barn's floor: stalls of fence along one side, hay, the truck, crates.
  stalls(L) {
    const c = L.c, right = !!L.variant(2, "stalls"), sx = right ? c.x1 - 2 : c.x0 + 2, ylast = c.y0 + Math.min(3, c.h - 3);
    for (let y = c.y0; y <= ylast; y++) shelving(L, sx, y, "fence");
    for (let y = c.y0 + 2; y <= ylast; y += 2) for (const x of right ? [sx + 1, sx + 2] : [sx - 1, sx - 2]) if (x >= c.x0 && x <= c.x1) shelving(L, x, y, "fence");
    some(L, "hay", 3, { prefer: "corner" });
    if (c.w * c.h > 40) for (const [x, y] of c.innerSpots().slice(0, 8)) if (!L.lane(x, y) && c.car(x, y, "truck")) break;
    fill(L, ["crate", "shelf"]);
  },
  // A tack room: saddle racks, shelves.
  tack(L) { fill(L, ["saddlerack", "shelf"]); },
};

// The style for a room of a commercial building (buildingmaps.js assemble), or null: a home style or FURNISH instead.
// room: its plan leaf with ROLES' defaults (role, name, type, marks: lay, pizza, fry, flat); key: the building's key.
/** @param {any} room @param {string | undefined} key @returns {string | null} */
export function styleName(room, key) {
  if (room.flat) return null;
  if (room.lay && COMMERCIAL_STYLES[room.lay]) return room.lay; // a plan leaf's own style, in any building (a variant's room borrowing a shop's: issue #32)
  if (!key || !COMMERCIAL_KEYS.has(key)) return null;
  const n = room.name || "", shop = SHOP_SET.has(key);
  switch (room.role) {
    case "sales":
      if (key === "supermarket") return "superfloor";
      if (key === "deptstore") return room.type === "lockers" ? "aislefront" : "deptfloor";
      if (key === "offices") return room.type === "kitchen" ? "cafe" : "minimart";
      if (key === "dealer") return "showroom";
      return ({ grocery: "minimart", corner: "minimart", gasstation: "minimart", truckstop: "minimart", liquor: "minimart", hardware: "hardware", gunstore: "guncounter", pawnshop: "pawncounter", electronics: "techcounter", radioshop: "techcounter", bookstore: "bookfront", clothing: "clothesfront" })[key] || "aislefront";
    case "dining": return key === "bar" ? "barroom" : key === "library" ? "reading" : key === "diner" || key === "pizza" || key === "truckstop" ? "diner" : "dining";
    case "kitchen": return key === "supermarket" ? "deli" : "galley";
    case "pantry": return room.cold ? "walkin" : room.type === "bar" ? "kegroom" : "stock";
    case "stock": return key === "library" ? "stacks" : "stock";
    case "storage":
      if (key === "motel") return "laundry";
      if (key === "offices" || key === "bank") return "records";
      if (key === "library") return /archive/i.test(n) ? "stock" : "records";
      return "stock";
    case "office":
      if (key === "motel") return "mgrflat";
      if (shop || /manager|workroom|sales office/i.test(n) || key === "supermarket" || key === "deptstore") return "manager";
      if (key === "bank" && /teller/i.test(n)) return "tellers";
      return "officefloor";
    case "restroom": return "restroom";
    case "breakroom": return "breakroom";
    case "warefloor": return shop ? "yard" : "pallets";
    case "factoryfloor": return "machines";
    case "bays": return "bays";
    case "parts": return "parts";
    case "workshop": return shop ? "repair" : key === "offices" ? "plant" : "workshop";
    case "lockerroom": return /fitting/i.test(n) || room.type === "clothes" ? "fitting" : null;
    case "armory": return key === "bank" ? "vault" : "guncage";
    case "dispensary": return "dispensary";
    case "lobby": return key === "bank" ? (room.atm ? "atmlobby" : "bankhall") : key === "library" ? "circulation" : "officelobby";
    case "reception": return "motelfront";
    case "motelroom": return "motelroom";
    case "corridor": return key === "motel" ? "walkway" : null;
    case "barnfloor": return "stalls";
    case "tack": return "tack";
    case "dayroom": return key === "bar" ? "stage" : null;
    case "classroom": return key === "library" ? "children" : null;
    default: return null;
  }
}
/** @param {any} room @param {string | undefined} key */
export function commercialStyle(room, key) {
  const n = styleName(room, key);
  return n ? COMMERCIAL_STYLES[n] || null : null;
}

// ======================================================================================
// The commercial buildings' signs of survival (interiorscenes.js registerScene, issue #11's hook; their own dice there),
// only on a map laid out by these styles (when: an area carries its style as `shop`, so an older save's building rolls
// its scenes as it did):
//   motelhold    a motel room held from inside: the chest of drawers shoved against its door, the one who held it on the
//                bed or by it (a quiet death now and then);
//   stockshelter a stockroom (a supermarket's, a grocery's, a department store's, a hardware store's, a warehouse's) used
//                as a shelter: cots in rows, a water barrel, the ones who never left, the last tins;
//   counterstand a last stand behind a shop's counter (a gun store's, a pawn shop's, a liquor store's, a corner store's,
//                a gas station's): the owner's body behind it, spent brass, the dead in front of it;
//   walkin       a restaurant's walk-in cold room as a hiding place: someone shut in behind its steel door, never let out.
// ======================================================================================
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const shopRooms = (ctx, styles) => ctx.rng.shuffle(ctx.rooms.filter((r) => styles.includes(r.shop) && !r.scene && !r.locked));
const nearest = (cells, x, y) => cells.slice().sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y));
const lower = (r) => String(r.name || "room").replace(/ \(upstairs\)$/, "").replace(/ \d+$/, "").toLowerCase();
const inside = (r, d) => NEXT4.map(([ox, oy]) => [d[0] + ox, d[1] + oy]).find(([x, y]) => x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1);
const styled = (ctx) => ctx.rooms.some((r) => !!r.shop);

function motelHold(ctx) {
  const { rng } = ctx;
  for (const r of shopRooms(ctx, ["motelroom"])) {
    const f = r.f || 0;
    const d = (r.doors || []).find((q) => ctx.exit(q[0], q[1], f)) || (r.doors || [])[0];
    const p = d && inside(r, d), c = p && ctx.at(f, p[0], p[1]);
    if (!c || c.k !== "open" || ctx.stair(p[0], p[1]) || ctx.used(f, p[0], p[1])) continue;
    ctx.piece(f, p[0], p[1], "dresser");
    const bed = ctx.inner(r).find(([x, y]) => (ctx.at(f, x, y) || {}).k === "bed");
    const spot = nearest(ctx.freeIn(r), ...(bed || p))[0];
    if (spot) { const quiet = rng.chance(0.4); ctx.body(f, spot[0], spot[1], { human: true, quiet }); if (!quiet) ctx.splatter(f, spot[0], spot[1], "human", rng.int(1, 2)); }
    return ctx.done("motelhold", r, p[0], p[1], `The chest of drawers is shoved against the door of ${lower(r) === "room" ? "this motel room" : `the ${lower(r)}`}: someone held it from inside.`);
  }
  return null;
}
function stockShelter(ctx) {
  const { rng } = ctx;
  for (const r of shopRooms(ctx, ["pallets", "stock"])) {
    const f = r.f || 0;
    const free = ctx.freeIn(r).filter(([x, y]) => (x + y) % 2 === 0);
    if (free.length < 4) continue;
    const cots = rng.shuffle(free).slice(0, rng.int(3, 6));
    for (const [x, y] of cots) ctx.piece(f, x, y, "cot");
    const left = ctx.freeIn(r);
    if (!left.length) continue;
    const [bx, by] = rng.pick(left);
    ctx.piece(f, bx, by, "barrel");
    const by2 = nearest(ctx.freeIn(r).filter(([x, y]) => cots.some(([cx, cy]) => Math.abs(cx - x) + Math.abs(cy - y) === 1)), bx, by);
    const n = Math.min(by2.length, rng.int(1, 3));
    for (const [x, y] of rng.shuffle(by2).slice(0, n)) ctx.body(f, x, y, { human: true, quiet: rng.chance(0.6) });
    const q = ctx.freeIn(r).find(([x, y]) => Math.abs(x - bx) + Math.abs(y - by) <= 2);
    if (q) ctx.pile(f, q[0], q[1], "The last of the tins and a jug of water", { food: rng.int(1, 2), water: 1 }, r.id);
    return ctx.done("stockshelter", r, bx, by, `The ${lower(r)} was a shelter: cots between the shelves, a water barrel${n ? `, and ${n === 1 ? "one who never left" : `${n} who never left`}` : ""}.`);
  }
  return null;
}
function counterStand(ctx) {
  const { rng } = ctx;
  for (const r of shopRooms(ctx, ["guncounter", "pawncounter", "minimart"])) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 5) continue;
    const counter = ctx.inner(r).find(([x, y]) => ["displaycase", "checkout"].includes((ctx.at(f, x, y) || {}).k));
    if (!counter) continue;
    const near = nearest(free, counter[0], counter[1]);
    const [ox, oy] = near.shift();
    ctx.body(f, ox, oy, { human: true, name: "The shopkeeper" });
    ctx.splatter(f, ox, oy, "human", rng.int(2, 3));
    for (const [x, y] of near.slice(0, 2)) { const c = ctx.at(f, x, y); c.brass = rng.int(SCENES.BRASS[0], SCENES.BRASS[1]); }
    const door = (r.doors || []).find((d) => ctx.exit(d[0], d[1], f)) || (r.doors || [])[0];
    const far = door ? nearest(near.slice(2), door[0], door[1]) : near.slice(2).reverse();
    const dead = rng.int(2, 3);
    let placed = 0;
    for (const [x, y] of far) { if (placed >= dead) break; if (!ctx.free(f, x, y)) continue; ctx.body(f, x, y, {}); ctx.splatter(f, x, y, "zombie", rng.int(1, 2)); placed++; }
    return ctx.done("counterstand", r, ox, oy, `The shopkeeper made a stand behind the counter: spent brass, ${placed} of the dead in front of it.`);
  }
  return null;
}
function walkIn(ctx) {
  const { rng } = ctx;
  for (const r of shopRooms(ctx, ["walkin"])) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (!free.length) continue;
    const [x, y] = rng.pick(free);
    ctx.body(f, x, y, { human: true, quiet: true });
    return ctx.done("walkin", r, x, y, "Someone shut themselves in the walk-in cold room and was never let out.");
  }
  return null;
}
registerScene("motelhold", { w: 4, place: motelHold, kinds: ["motel"], when: styled });
registerScene("stockshelter", { w: 3, place: stockShelter, kinds: ["supermarket", "grocery", "deptstore", "hardware", "warehouse"], when: styled });
registerScene("counterstand", { w: 3, place: counterStand, kinds: ["gunstore", "pawnshop", "liquor", "corner", "gasstation"], when: styled });
registerScene("walkin", { w: 2, place: walkIn, kinds: ["restaurant", "diner", "pizza"], when: styled });
