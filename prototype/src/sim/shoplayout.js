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
// The shops' and services' layout variants (shopvariants.js, issue #35) use these styles room by room, plus a big
// shop's service corridor (servicehall: staff lockers and shelving along its back wall); a narrow front the aisles or the
// counter could not row still gets its rack, its cold case or the pawn counter's bars along a wall.
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
    superfloor: 1.6, deptfloor: 1.75, cornerstore: 1.9, "stock:corner": 2, grocerfloor: 1.2, superstore: 1, warehouse: 1, pallets: 1.3, "pallets:warehouse": 1.1, "pallets:deptstore": 1, machines: 1.1, stacks: 1.05, bookfront: 1.2,
    aislefront: "full", "aislefront:deptstore": 1.3, guncounter: 1.25, guncage: 1.7, "stock:electronics": 1.25, walkin: 2,
  },
};
// The buildings whose rooms take these styles (buildingmaps.js BUILDINGS keys).
const SHOPS = ["grocery", "corner", "pharmacy", "gunstore", "pawnshop", "sportshop", "electronics", "radioshop", "bookstore", "petstore", "garden", "clothing", "liquor", "restaurant", "pizza", "bar", "hardware", "feedstore", "diner", "gasstation", "truckstop",
  "furnstore", "laundromat", "thrift", "bakery", "butcher", "deli"]; // issue #55's six
export const COMMERCIAL_KEYS = new Set([...SHOPS, "supermarket", "deptstore", "offices", "motel", "dealer", "bank", "library", "warehouse", "factory", "autoshop", "garage", "workshop", "machineshed", "barn"]);
const SHOP_SET = new Set(SHOPS);

// ---------- shared pieces ----------
/** @typedef {ReturnType<typeof import("./roomlayout.js").roomLayout>} Lay */
// A piece of shelving that is not searched (the stock between the shelves that are): blocked as before, off the lanes.
/** @param {Lay} L */
export const shelving = (L, x, y, k) => L.ok(x, y) && L.c.block(x, y, k);
/** The room holds its share of containers: a lootable piece now stands plain. @param {Lay} L */
export const full = (L) => L.boxes() >= L.target();
/** A placement's options with plain set as the room stands. @param {Lay} L */
export const P = (L, o = {}) => ({ ...o, plain: full(L) });
/**
 * Lootable pieces of these kinds (in turn) until the room holds its share: against the walls while they take one (a
 * corner first), then off them (roomlayout.js fill stops after a couple of tries; a shop's long walls take many).
 * @param {Lay} L
 */
export function fill(L, kinds) {
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.wall(kinds[i % kinds.length], { prefer: "corner" })) miss = 0; else miss++; }
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.centre(kinds[i % kinds.length])) miss = 0; else miss++; }
}
/** The room cell inside the front door (or the front wall's middle). @param {Lay} L */
export function frontDoor(L) {
  const c = L.c, d = (L.room.doors || []).find(([, y]) => y === c.y1 + 1);
  return d ? [d[0], d[1] - 1] : [Math.floor((c.x0 + c.x1) / 2), c.y1];
}
/** A checkout counter and its register by the front door. @param {Lay} L */
export const checkout = (L) => L.wall("checkout", P(L, { sides: ["s", "w", "e"], near: frontDoor(L) })) || L.need("checkout", P(L, { near: frontDoor(L) }));
/** The style's share of containers (SHOP.BOXES). @param {Lay} L */
export function share(L, name) {
  const b = SHOP.BOXES[`${name}:${L.c.key}`] ?? SHOP.BOXES[name];
  if (b === "full") L.c.target = Math.max(L.c.target, L.room.maxBoxes ?? 4);
  else if (b) L.c.target = Math.max(L.c.target, Math.round(L.c.target * b));
}
/** n pieces of k along a wall (the longest free one when not given). @param {Lay} L */
export function along(L, k, n, sides) {
  const ws = sides || L.walls().map((w) => w.side);
  if (!ws.length) return [];
  return L.run(Array(n).fill(k), ws, { plain: () => full(L) }).placed;
}
/** Up to n of piece k against the walls (each the best spot left). @param {Lay} L */
export function some(L, k, n, opts = {}) { const out = []; for (let i = 0; i < n; i++) { const r = L.wall(k, P(L, opts)); if (!r) break; out.push(r); } return out; }
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
/**
 * Aisles that run front to back (a grocery's, a supermarket's: issue #22): a column of shelving every `step` cells from
 * x0 to x1 (a 1-cell walk between at step 2), from row y0 to y1; each run cut where a lane crosses it. A container of
 * `box` at each end of a run (the end caps) and every `every` cells while the room has its share to come, the rest `k`
 * (not searched); `sign`: an aisle marker (decor) at the head of each run of 4+ cells, toward the front. Returns the
 * runs ([[x, y0, y1]...]). @param {Lay} L
 */
function aislesY(L, o) {
  const k = o.k || "rack", box = o.box || "shelf", every = o.every || SHOP.EVERY, runs = [];
  for (let x = o.x0; o.dir < 0 ? x >= o.x1 : x <= o.x1; x += (o.step || 2) * (o.dir || 1)) {
    let seg = [];
    const flush = () => {
      if (seg.length >= 2) runs.push([x, seg[0], seg[seg.length - 1]]);
      seg.forEach((y, i) => {
        if (o.sign && seg.length >= 4 && i === seg.length - 1 && L.place("aislesign", [[x, y]])) return;
        const want = i === 0 || i === seg.length - (o.sign && seg.length >= 4 ? 2 : 1) ? box : i % every === every - 1 ? box : null;
        if (want && !full(L) && L.place(want, [[x, y]], { face: "e" })) return;
        shelving(L, x, y, k);
      });
      seg = [];
    };
    for (let y = o.y0; y <= o.y1; y++) { if (!L.ok(x, y)) { flush(); continue; } seg.push(y); }
    flush();
  }
  return runs;
}
/** A row of checkout lanes across the front at row y (the till at y, the belt behind it, a lane between), n of them from x toward dir. @param {Lay} L */
function checkoutLanes(L, x, y, n, dir = 1) {
  let made = 0;
  for (let i = 0; made < n && i < n * 3; i++, x += 2 * dir) {
    if (!L.inRoom(x, y) || !L.inRoom(x, y - 1)) break;
    if (!L.ok(x, y) || !L.ok(x, y - 1)) continue;
    if (!L.place("checkout", [[x, y]], P(L, { face: "s" }))) continue;
    L.place("counter", [[x, y - 1]], { face: "s", plain: true });
    made++;
  }
  return { made, x };
}
/**
 * A supermarket's front end at row y (issue #22): up to n checkout lanes from x0 toward x1 (the till at y, the belt
 * behind it, a lane between), then the self-checkout block past them (two rows of three kiosks facing each other across
 * a walk: rows y and y - 2); what does not fit that way is tried from x1 back. @param {Lay} L
 */
function frontEnd(L, x0, x1, y, n) {
  const dir = x1 >= x0 ? 1 : -1;
  let lanes = 0, kiosks = 0;
  const laneScan = (from, to, d) => {
    for (let x = from, last = null; lanes < n && (d > 0 ? x <= to : x >= to); x += d) {
      if (!L.ok(x, y) || !L.ok(x, y - 1) || (last !== null && Math.abs(x - last) < 2) || [x - 1, x + 1].some((q) => L.c.kindAt(q, y) === "checkout")) continue;
      if (!L.place("checkout", [[x, y]], P(L, { face: "s" }))) continue;
      L.place("counter", [[x, y - 1]], { face: "s", plain: true });
      lanes++; last = x;
    }
  };
  const block = (from, to, d, yb = y) => {
    for (let x = from; kiosks < 3 && (d > 0 ? x + 2 * d <= to : x + 2 * d >= to); x += d) {
      const xs = [x, x + d, x + 2 * d];
      if (!xs.every((q) => L.ok(q, yb) && L.ok(q, yb - 1) && L.ok(q, yb - 2))) continue;
      for (const q of xs) for (const [yy, f] of [[yb, "n"], [yb - 2, "s"]]) if (L.place("selfcheckout", [[q, yy]], P(L, { face: f }))) kiosks++;
    }
  };
  laneScan(x0, x1, dir);
  if (lanes < n) laneScan(x1, x0, -dir);
  const placed = L.placed.filter((p) => p.k === "checkout").map((p) => p.cells[0][0]);
  const end = placed.length ? (dir > 0 ? Math.max(...placed) : Math.min(...placed)) + 2 * dir : x0;
  block(end, x1, dir);
  if (!kiosks) block(x1, x0, -dir);
  if (!kiosks) block(dir > 0 ? L.c.x1 - 1 : L.c.x0 + 1, dir > 0 ? L.c.x0 + 1 : L.c.x1 - 1, -dir); // anywhere along the front row
  if (!kiosks) block(dir > 0 ? L.c.x0 + 1 : L.c.x1 - 1, dir > 0 ? L.c.x1 - 1 : L.c.x0 + 1, dir);
  // Lanes and doors left no three cells free on that row (issue #35's variants found it, the old plan's too, a seed in
  // ten): the rows behind it and in front of it, anywhere along the front.
  for (const yb of [y - 3, y + 1, y - 4, y + 2]) if (kiosks < 3 && yb - 2 > L.c.y0 && yb <= L.c.y1) block(L.c.x0 + 1, L.c.x1 - 1, 1, yb);
  return { lanes, kiosks };
}
/** The cells of row y between x0 and x1 that take a piece (off the lanes). @param {Lay} L */
export function freeIn(L, y, x0, x1) { let n = 0; for (let x = x0; x <= x1; x++) if (L.ok(x, y)) n++; return n; }
/** Row y if it is mostly off the lanes, else the freest of the next row and the back wall's. @param {Lay} L */
export function rowFrom(L, y) {
  const c = L.c, free = (r) => (r >= c.y0 && r <= c.y1 ? freeIn(L, r, c.x0 + 1, c.x1 - 1) : -1);
  if (free(y) * 2 >= c.w - 2) return y;
  return [y + 1, c.y0, y].reduce((a, b) => (free(b) > free(a) ? b : a));
}
/** A counter run across the room at row y (display cases, a bar), every `every`-th a container of `box`; `ends` at its ends. @param {Lay} L */
export function counterRow(L, y, k, o = {}) {
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
export function stools(L, row) {
  let n = 0;
  for (const p of row) { const [x, y] = p.cells[0]; if (L.ok(x, y + 1) && L.place("barstool", [[x, y + 1]], { face: "n" })) n++; }
  for (const p of row) { if (n) break; const [x, y] = p.cells[0]; if (L.place("barstool", [[x, y + 1]], { face: "n", force: true })) n++; }
  return n;
}
/** Tables with chairs round them over the floor. @param {Lay} L */
export function tables(L, n, chairs = 2, k = "table") {
  let made = 0;
  for (let i = 0; i < n; i++) { const t = L.centre(k); if (!t) break; L.around(t, "chair", chairs); made++; }
  return made;
}
/** Booths along the walls. @param {Lay} L */
export function booths(L, n, sides) {
  let made = 0;
  for (let i = 0; i < n; i++) { if (!L.wall("booth", { sides, prefer: "corner" })) break; made++; }
  return made;
}
/** A desk with its chair (its drawers searched while the room has its share to come). @param {Lay} L */
export function deskSet(L, opts = {}) {
  const d = L.wall("desk", P(L, opts)) || L.centre("desk", P(L, opts));
  if (d) L.around(d, "chair", 1);
  return d;
}
/** A fixed piece that is its own locked container (the safe: a manager's till, a corner office's; the ATM). @param {Lay} L */
export function lockedPiece(L, k, opts = {}) {
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
export function toiletAndSink(L) {
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
    if (!L.has("coldcase")) along(L, "coldcase", 2, [L.variant(2, "cold") ? "w" : "e", "n"]); // that wall all doors (a narrow shop's, issue #35): the other
    aisles(L, { box: "shelf" });
    fill(L, ["shelf", "coldcase"]);
    if (!L.has("coldcase")) L.need("coldcase", P(L));
  },
  // ---------- grocery stores by size (issue #22) ----------
  // A corner store: the counter with its till by the door, the drinks fridges along a side wall, the chest freezer of ice
  // cream by the counter, two to four short shelf runs.
  cornerstore(L) {
    share(L, "cornerstore");
    const c = L.c, door = frontDoor(L), cold = L.variant(2, "cold") ? "e" : "w", other = cold === "e" ? "w" : "e";
    const till = L.wall("checkout", P(L, { sides: ["s", other], near: door })) || L.need("checkout", P(L, { near: door }));
    if (till) L.beside(till, "counter", { plain: true });
    along(L, "coldcase", Math.max(2, c.h - 1), [cold]);
    L.wall("freezer", P(L, { sides: [other, "n", "s"], near: door })) || L.centre("freezer", P(L, { near: door })) || L.need("freezer", P(L, { near: door }));
    const runs = aislesY(L, { x0: c.x0 + (cold === "w" ? 2 : 1), x1: c.x1 - (cold === "w" ? 1 : 2), y0: c.y0 + 1, y1: c.y1 - 2, box: "shelf", every: 3 });
    if (!runs.length) aisles(L, { box: "shelf", front: 2, side: 2, every: 3 });
    fill(L, ["shelf", "coldcase"]);
  },
  // A neighbourhood grocery's sales floor: two or three checkouts at the front, the dairy wall of cold cases along the
  // back with a small deli counter (display cases, the butcher's case) in its corner, the frozen section down one side
  // (upright freezer cases, a chest freezer), the produce corner (bins along the wall and a table of them) on the other,
  // five to eight aisles front to back between.
  grocerfloor(L) {
    share(L, "grocerfloor");
    const c = L.c, door = frontDoor(L), cold = L.variant(2, "cold") ? "e" : "w", prod = cold === "e" ? "w" : "e";
    const n = 2 + L.variant(2, "lanes");
    const startX = door[0] + (door[0] - c.x0 > c.x1 - door[0] ? -2 : 2);
    checkoutLanes(L, startX, c.y1 - 1, n, startX < door[0] ? -1 : 1);
    if (!L.has("checkout")) checkout(L);
    const deli = ["displaycase", "meatcase", "displaycase"], dairy = Array(Math.max(3, c.w - 8)).fill("coldcase");
    L.run(prod === "w" ? [...deli, ...dairy] : [...dairy, ...deli], ["n"], { plain: () => full(L) });
    along(L, "freezercase", Math.max(3, c.h - 4), [cold]);
    L.wall("freezer", P(L, { sides: [cold], near: [cold === "e" ? c.x1 : c.x0, c.y1] })) || L.centre("freezer", P(L, { near: [cold === "e" ? c.x1 - 2 : c.x0 + 2, c.y1 - 3] }));
    const px = prod === "e" ? c.x1 : c.x0;
    some(L, "producebin", 3, { sides: [prod], near: [px, c.y1 - 2] });
    L.centre("producebin", P(L, { near: [px + (prod === "e" ? -2 : 2), c.y1 - 3] }));
    const ax0 = cold === "w" ? c.x0 + 2 : c.x0 + 3, ax1 = cold === "w" ? c.x1 - 3 : c.x1 - 2;
    aislesY(L, { x0: ax0, x1: ax1, y0: c.y0 + 2, y1: c.y1 - 4, box: "shelf", every: 3 });
    fill(L, ["shelf", "coldcase"]);
  },
  // A supermarket's sales floor: the entrance with the cart corrals by the doors and the customer service desk, a row of
  // six to twelve checkout lanes and a self-checkout block, the wide front aisle, produce down one side (bins along the
  // wall and tables of them: the misting racks), the frozen aisles down the other (the wall of upright freezer cases,
  // island freezers down the middle, a back-to-back row of freezer cases), the dairy wall of cold cases along the back,
  // and the long grocery aisles between, an aisle marker at the head of each.
  superstore(L) {
    share(L, "superstore");
    const c = L.c, door = frontDoor(L), prod = L.variant(2, "produce") ? "e" : "w", froz = prod === "e" ? "w" : "e";
    const fronts = (L.room.doors || []).filter(([, y]) => y === c.y1 + 1);
    for (const [dx] of fronts) L.wall("cartcorral", { sides: ["s"], near: [dx, c.y1], avoid: (cells) => cells.some(([x]) => Math.abs(x - dx) < 2) });
    const far = door[0] - c.x0 > c.x1 - door[0] ? c.x0 + 1 : c.x1 - 1;
    for (let i = 0; i < 3; i++) L.wall("counter", P(L, { sides: ["s"], near: [far + (far < door[0] ? i : -i), c.y1] })); // the customer service desk
    // The checkout row: the one of the rows 2 to 4 off the front that the lanes cross least (a lane from the front doors
    // to a side door runs along one); the lanes from the produce side toward the doors, the self-checkout block after them.
    const lx0 = prod === "w" ? c.x0 + 4 : c.x1 - 4, lx1 = prod === "w" ? c.x1 - 4 : c.x0 + 4, sgn = prod === "w" ? 1 : -1;
    const freeRow = (y) => { let n = 0, last = -9; for (let x = c.x0 + 1; x <= c.x1 - 1; x++) if (L.ok(x, y) && L.ok(x, y - 1) && x - last >= 2) { n++; last = x; } return Math.min(n, 15); }; // the lanes the row takes (and the kiosks)
    const yC = [c.y1 - 3, c.y1 - 4, c.y1 - 2, c.y1 - 5].reduce((a, b) => (freeRow(b) > freeRow(a) ? b : a));
    frontEnd(L, lx0, lx1, yC, Math.min(12, Math.max(6, Math.floor((c.w - 18) / 2))));
    const yTop = c.y0 + 3, yBot = yC - 5;
    // Produce: bins along the wall (the misting racks), two rows of tables off it.
    const pw = prod === "w" ? c.x0 : c.x1, pd = prod === "w" ? 1 : -1;
    for (let y = yTop - 1; y <= yC - 3; y++) if (L.ok(pw, y)) L.place("producebin", [[pw, y]], P(L, { face: prod === "w" ? "e" : "w" }));
    const roomy = c.w >= 38; // a wide floor: two rows of produce tables and two of freezer cases, else one of each (the aisles first)
    for (const dx of roomy ? [2, 3] : [2]) for (let y = yTop; y <= yBot; y++) if ((y - yTop) % 4 !== 3 && L.ok(pw + dx * pd, y)) L.place("producebin", [[pw + dx * pd, y]], P(L));
    // Frozen: the wall of freezer cases, island freezers down the middle, a back-to-back row of freezer cases.
    const fw = froz === "w" ? c.x0 : c.x1, fd = froz === "w" ? 1 : -1;
    for (let y = yTop - 1; y <= yC - 3; y++) if (L.ok(fw, y)) L.place("freezercase", [[fw, y]], P(L, { face: froz === "w" ? "e" : "w" }));
    for (let y = yTop; y + 1 <= yBot; y += 3) if (L.ok(fw + 2 * fd, y) && L.ok(fw + 2 * fd, y + 1)) L.place("islandfreezer", [[fw + 2 * fd, y], [fw + 2 * fd, y + 1]], P(L));
    for (const dx of roomy ? [4, 5] : [4]) for (let y = yTop; y <= yBot; y++) if (L.ok(fw + dx * fd, y)) L.place("freezercase", [[fw + dx * fd, y]], P(L, { face: dx === 4 ? (froz === "w" ? "w" : "e") : froz === "w" ? "e" : "w" }));
    // The dairy wall along the back.
    for (let x = c.x0 + 1; x <= c.x1 - 1; x++) if (L.ok(x, c.y0)) L.place("coldcase", [[x, c.y0]], P(L, { face: "s" }));
    // The grocery aisles between, front to back.
    const gx0 = prod === "w" ? pw + (roomy ? 5 : 4) : fw + (roomy ? 7 : 6), gx1 = prod === "w" ? fw - (roomy ? 7 : 6) : pw - (roomy ? 5 : 4);
    aislesY(L, { x0: gx0, x1: gx1, y0: yTop, y1: yBot, box: "shelf", every: 5, sign: true });
    fill(L, ["shelf", "coldcase"]);
  },
  // A supermarket's bakery: the ovens and a sink along the back, bread racks, a display case of the cakes.
  bakery(L) {
    const ws = L.walls();
    L.run(["oven", "oven", "counter", "sink", "counter"], [ws[0] ? ws[0].side : "n"], { plain: () => full(L) });
    if (!L.has("oven")) L.need("oven");
    some(L, "breadrack", 3, { prefer: "corner" });
    L.wall("displaycase", P(L, { near: frontDoor(L) })) || L.centre("displaycase", P(L));
    fill(L, ["breadrack", "counter", "shelf"]);
  },
  // A supermarket's deli and butcher: the counter of butcher's cases and display cases, a cold case, the cutting counters,
  // a sink and a range behind it.
  butcher(L) {
    const ws = L.walls();
    L.run(["meatcase", "displaycase", "meatcase", "displaycase", "coldcase"], [ws[0] ? ws[0].side : "n"], { plain: () => full(L) });
    if (!L.has("meatcase")) L.need("meatcase", P(L));
    L.run(["counter", "sink", "counter", "range"], [ws[1] ? ws[1].side : "s"], { plain: () => full(L) });
    fill(L, ["counter", "coldcase", "shelf"]);
  },
  // A supermarket's warehouse: the receiving floor along the dock wall (the back) kept clear but for the forklift and
  // a few crates, pallet racks in rows behind it (whole pallets of tins and water: combat.js BOX_LOOT palletrack@store).
  warehouse(L) {
    share(L, "warehouse");
    const c = L.c;
    L.centre("forklift", { near: [c.x0 + Math.floor(c.w / 3), c.y0 + 1] });
    aisles(L, { box: "palletrack", every: 2, step: 3, start: 4, front: 1, cap: "palletrack" });
    for (const [x, y] of c.innerSpots().filter(([, y]) => y <= c.y0 + 2).slice(0, 4)) shelving(L, x, y, "crate");
    fill(L, ["palletrack", "crate"]);
  },
  // A walk-in freezer behind its steel door: freezer shelving round the walls (frozen food gone bad but in winter).
  walkfreezer(L) { share(L, "walkin"); fill(L, ["freezershelf"]); if (!L.has("freezershelf")) L.need("freezershelf"); },
  // The compactor and baler: the baler against a wall, bales of cardboard (crates, not searched), a shelf.
  baler(L) { L.wall("baler") || L.need("baler"); for (const [x, y] of L.c.innerSpots().slice(0, 3)) shelving(L, x, y, "crate"); fill(L, ["shelf", "crate"]); },
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
    if (!L.has("rack")) L.wall("rack", { plain: true }) || L.centre("rack", { plain: true }); // a front the aisles could not row (a narrow one, issue #35): its shelving along a wall
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
    if (!L.has("bars")) L.wall("bars", { sides: ["n", "w", "e"], plain: true }); // a counter too short for its caged ends (issue #35): the cage on a wall
    if (!L.has("displaycase")) L.wall("displaycase", P(L, { prefer: "middle" })) || L.need("displaycase", P(L));
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
  // A big shop's service corridor behind the sales floor (issue #35, shopvariants.js corridor plans): staff lockers and
  // shelving along its back wall, a 1-cell walk kept in front of them.
  servicehall(L) {
    const c = L.c;
    if (Math.min(c.w, c.h) < 2) return;
    L.run(["locker", "shelf", "locker", "shelf", "locker"], [c.w >= c.h ? "n" : "w"], { plain: () => full(L) });
  },
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

// ======================================================================================
// Issue #55's six shops (data-newshops.js, the plans shopvariants.js's): the furniture store's showroom of pieces to lift
// (the carry system's best target), its warehouse and dock; the laundromat's rows of washers and dryers, folding
// tables and change machine; the thrift store's racks and bins, its sorting room and donation dock; the bakery's cases,
// bakehouse (deck ovens, floor mixers) and flour store; the butcher's cases, cutting room (the band saw) and smokehouse;
// the deli's cases and slicer (its prep kitchen is #33's eatkitchen, its dry store #33's eatdry: eaterylayout.js). A
// room's mark picks the variant of its style: show (a showroom's: mixed, bedroom, mattress, appliance, antique,
// rustic, used), mode (a laundromat's fold or press; a thrift floor's books, toys, cases, vintage or junk; a
// bakehouse's decor; a cutting room's sausage or game; a bakery front's donut).
// ======================================================================================
// A showroom's vignettes: a set of pieces round the first (a living room set, a dining set, a bedroom set...).
/** @type {Record<string, (L: Lay) => any>} */
const VIGNETTE = {
  living: (L) => { const s = L.centre("sofa"); if (!s) return null; L.facing(s, "tvstand"); L.around(s, "armchair", 1); return s; },
  dining: (L) => { const t = L.centre("table"); if (!t) return null; L.around(t, "chair", 4); return t; },
  bedroom: (L) => { const b = L.centre("bed", { size: [2, 2] }) || L.centre("bed"); if (!b) return null; L.around(b, "nightstand", 1); return b; },
  study: (L) => { const d = L.centre("desk"); if (!d) return null; L.around(d, "chair", 1); return d; },
  lounge: (L) => { const a = L.centre("armchair"); if (!a) return null; L.around(a, "floorlamp", 1); return a; },
  piano: (L) => L.wall("piano", { prefer: "middle" }),
  single: (L) => L.centre("bed"),
};
const SHOW_SETS = {
  mixed: ["living", "dining", "bedroom", "study", "living", "lounge"], bedroom: ["bedroom", "bedroom", "lounge"], mattress: ["bedroom", "single", "bedroom"],
  antique: ["piano", "dining", "lounge", "study", "bedroom"], rustic: ["dining", "dining", "bedroom", "lounge"], used: ["living", "lounge", "dining", "study"],
};
const SHOW_FILL = {
  mixed: ["dresser", "wardrobe", "bookshelf", "tvstand"], bedroom: ["wardrobe", "dresser", "nightstand"], mattress: ["nightstand", "dresser"],
  antique: ["wardrobe", "dresser", "bookshelf", "displaycase"], rustic: ["wardrobe", "dresser", "bookshelf"], used: ["dresser", "bookshelf", "wardrobe", "tvstand"],
};
// A floor mixer and the rest of a bakehouse, a cutting room's band saw: pieces a room must have (the plan's signature).
const must = (L, k, opts = {}) => L.has(k) || L.wall(k, opts) || L.need(k, opts);
Object.assign(COMMERCIAL_STYLES, {
  // ---------- the furniture store ----------
  // A showroom: the till by the door (the main floor's), then vignettes of pieces over the floor by its show, the cases
  // pieces (chests of drawers, wardrobes, bookshelves) round the walls; an appliance floor's rows of washers with the
  // fridges at their ends, the stoves, ovens and dryers along its walls.
  furnfloor(L) {
    share(L, "furnfloor");
    const c = L.c, show = L.room.show || "mixed";
    if (L.room.entry) checkout(L);
    if (show === "appliance") {
      const ws = L.walls();
      L.run(["stove", "oven", "dryer", "dishwasher", "washer", "microwave", "stove", "dryer"], ws.slice(0, 2).map((w) => w.side), { plain: () => full(L) });
      if (c.h >= 6) aisles(L, { k: "washer", box: "fridge", cap: "fridge", every: 3, front: 2, fallback: false });
      fill(L, ["fridge", "freezer"]);
      if (!L.has("fridge")) L.need("fridge", P(L));
      return;
    }
    const sets = SHOW_SETS[show] || SHOW_SETS.mixed, n = Math.max(1, Math.floor((c.w * c.h) / 14)), at = L.variant(sets.length, "show");
    for (let i = 0, miss = 0; i < n && miss < sets.length; i++) { if (VIGNETTE[sets[(i + at) % sets.length]](L)) miss = 0; else miss++; }
    fill(L, SHOW_FILL[show] || SHOW_FILL.mixed);
    if (!L.has("bed") && !L.has("sofa") && !L.has("table") && !L.has("piano")) L.need(show === "mattress" || show === "bedroom" ? "bed" : "sofa");
  },
  // A furniture warehouse (a thrift store's yard too): pallet racks of boxed stock in rows, the pieces waiting to go out
  // along a wall (a sofa, a wardrobe, a chest of drawers), the forklift in a big one.
  furnwh(L) {
    share(L, "pallets");
    const c = L.c;
    if (c.w * c.h >= 60) L.centre("forklift", { near: [c.x0 + 1, c.y1 - 1] });
    aisles(L, { box: "palletrack", every: 3, step: 3, front: 2, cap: "crate" });
    for (const k of ["sofa", "wardrobe", "dresser", "armchair"]) L.wall(k, P(L));
    fill(L, ["crate", "palletrack"]);
  },
  // A delivery or dispatch dock (a furniture store's, a bakery's, a caterer's): kept clear for the trucks' loads, crates
  // and shelving along the walls, a load or two waiting (a sofa wrapped for the truck).
  furndock(L) {
    const c = L.c;
    some(L, "crate", 2, { prefer: "corner" });
    if (L.c.key === "furnstore" || L.c.key === "thrift") L.wall("sofa", { prefer: "corner" });
    if (c.w * c.h >= 40) L.wall("forklift", { prefer: "corner" });
    fill(L, ["shelf", "crate"]);
  },
  // ---------- the laundromat ----------
  // The floor: the change machine by the door, dryers stacked along one side wall, rows of washers back to back down the
  // middle (a walk between), folding tables, chairs along the front, a vending machine; a wash-and-fold counter (fold:
  // the counter, shelves of bagged laundry, folding tables, a washer and a dryer); a dry cleaner's press room (press: the
  // counter, rails of cleaned clothes, pressing tables, shelves).
  laundromat(L) {
    const c = L.c, mode = L.room.mode, side = L.variant(2, "dryers") ? "e" : "w";
    if (mode === "fold") {
      L.wall("counter", P(L, { prefer: "middle" }));
      L.run(["washer", "dryer"], [side]);
      L.centre("foldtable"); L.centre("foldtable");
      fill(L, ["shelf", "cabinet"]);
      return;
    }
    if (mode === "press") {
      L.wall("counter", P(L, { prefer: "middle" }));
      L.centre("foldtable"); L.centre("table");
      fill(L, ["clothesrack", "shelf", "clothesrack"]);
      return;
    }
    L.wall("changer", P(L, { near: frontDoor(L), sides: ["s", "w", "e"] })) || L.need("changer", P(L));
    along(L, "dryer", Math.max(2, c.h - 3), [side]);
    along(L, "washer", Math.max(2, c.h - 4), [side === "e" ? "w" : "e"]);
    if (c.w >= 7 && c.h >= 6) aisles(L, { k: "washer", box: "washer", cap: "washer", every: 99, start: 1, front: 3, side: 2, fallback: false });
    for (let i = 0; i < Math.max(1, Math.floor((c.w * c.h) / 40)); i++) L.centre("foldtable");
    L.wall("vending", P(L, { sides: ["s"] }));
    for (let i = 0; i < 3; i++) L.wall("chair", { sides: ["s"] });
    fill(L, ["shelf", "cabinet"]);
    if (!L.has("washer")) L.need("washer");
    if (!L.has("dryer")) L.need("dryer");
  },
  // ---------- the thrift store ----------
  // The floor: the till by the door, racks of clothes in rows (some searched), shelves of housewares round the walls,
  // bins (crates) of odds and ends, a corner of used furniture; a book room's shelves in rows (books), the toys and games
  // (shelves, bins, a table), a collectibles room's cases (cases), a vintage boutique's racks and mannequins (vintage),
  // a junk barn's or a flea market's rows of shelving, bins and furniture (junk).
  thriftfloor(L) {
    const c = L.c, mode = L.room.mode;
    if (L.room.entry) checkout(L);
    if (mode === "books") { aisles(L, { k: "bookshelf", box: "bookshelf", every: 3 }); fill(L, ["bookshelf", "crate"]); return; }
    if (mode === "toys") { tables(L, 1, 2); some(L, "crate", 2, { prefer: "corner" }); fill(L, ["shelf", "crate"]); return; }
    if (mode === "cases") { counterRow(L, rowFrom(L, c.y0 + 2), "displaycase", { box: "displaycase", every: 2, from: 1, to: 1 }); fill(L, ["displaycase", "shelf"]); return; }
    if (mode === "vintage") { aisles(L, { k: "clothesrack", box: "clothesrack", every: 3 }); some(L, "mannequin", 2, { sides: ["s"] }); fill(L, ["clothesrack", "displaycase"]); return; }
    if (mode === "junk") {
      aisles(L, { k: "rack", box: "crate", every: 3, step: 3 });
      for (const k of ["sofa", "armchair", "dresser", "wardrobe", "table"]) L.centre(k, P(L));
      fill(L, ["crate", "shelf", "dresser"]);
      return;
    }
    aisles(L, { k: "clothesrack", box: "clothesrack", every: 3, front: Math.max(3, Math.floor(c.h / 3)) });
    for (let i = 0; i < Math.max(1, Math.floor((c.w * c.h) / 60)); i++) L.centre("crate", P(L));
    L.wall("armchair"); L.wall("dresser", P(L));
    fill(L, ["shelf", "clothesrack", "crate"]);
  },
  // The sorting room: folding tables down the middle with the donation bags (crates) round them, shelves of sorted stock.
  sorting(L) {
    const c = L.c;
    for (let i = 0; i < Math.max(1, Math.floor((c.w * c.h) / 24)); i++) { const t = L.centre("foldtable"); if (t) L.around(t, "crate", 1); }
    fill(L, ["shelf", "crate", "shelf"]);
  },
  // The donation dock: the bins by the door (crates), a donated sofa and chair waiting to be sorted, shelves.
  donation(L) {
    some(L, "crate", 3, { prefer: "corner" });
    L.wall("sofa"); L.centre("armchair");
    fill(L, ["crate", "shelf"]);
  },
  // ---------- the bakery ----------
  // The shop front: the till by the door, the counter of display and pastry cases across the room, the bread racks along
  // the wall behind it, a drinks fridge, a table or two where it is deep enough; a donut shop's espresso machine.
  bakefront(L) {
    const c = L.c, y = Math.max(c.y0 + 1, Math.min(c.y1 - 2, c.y0 + 2));
    checkout(L);
    counterRow(L, y, "displaycase", { box: "pastrycase", every: 2, from: 1, to: 2 });
    if (!L.has("pastrycase")) L.wall("pastrycase", P(L, { prefer: "middle" })) || L.need("pastrycase", P(L));
    if (L.room.mode === "donut") L.wall("espresso", { sides: ["n"] });
    L.wall("coldcase", P(L, { sides: ["e", "w"] }));
    if (c.h >= 7) tables(L, Math.floor((c.w * (c.h - 4)) / 20), 2);
    fill(L, ["breadrack", "pastrycase"]);
  },
  // The bakehouse: the deck ovens along the back wall, an oven, the floor mixers, the proofing racks (bread racks), the
  // bench down the middle (a counter), a sink; a decorating room's counters, a fridge, a table, shelves (decor).
  bakehouse(L) {
    const c = L.c, ws = L.walls();
    if (L.room.mode === "decor") {
      L.run(["counter", "sink", "counter", "fridge"], [ws[0] ? ws[0].side : "n"], { plain: () => full(L) });
      L.centre("table");
      fill(L, ["shelf", "counter"]);
      return;
    }
    L.run(["deckoven", "deckoven", "oven", "sink"], [ws[0] ? ws[0].side : "n"], { plain: () => full(L) });
    must(L, "deckoven");
    L.wall("mixer", { prefer: "corner" }); if (c.w * c.h >= 20) L.wall("mixer", { prefer: "corner" });
    must(L, "mixer");
    if (c.w * c.h >= 16) L.centre("counter", P(L));
    some(L, "breadrack", 2);
    fill(L, ["dryshelf", "breadrack", "counter"]);
  },
  // The flour store: dry-goods shelving round the walls (sacks of flour and sugar), a barrel, sacks stacked between.
  flourstore(L) {
    fill(L, ["dryshelf", "shelf"]);
    if (!L.has("dryshelf")) L.need("dryshelf", P(L));
    L.wall("barrel", { prefer: "corner" });
    for (const [x, y] of L.c.innerSpots().slice(0, 2)) shelving(L, x, y, "crate");
  },
  // ---------- the butcher ----------
  // The shop front: the till, the run of butcher's cases across the room (the meat, the sausages), a cold case and a chest
  // freezer along a side wall, shelves of sauces and spices.
  butcherfront(L) {
    const c = L.c, y = Math.max(c.y0 + 1, Math.min(c.y1 - 2, c.y0 + 2));
    checkout(L);
    counterRow(L, y, "meatcase", { box: "meatcase", every: 1, from: 1, to: 2 });
    if (!L.has("meatcase")) L.wall("meatcase", P(L, { prefer: "middle" })) || L.need("meatcase", P(L));
    L.wall("coldcase", P(L, { sides: ["e", "w"] }));
    L.wall("freezer", P(L, { sides: ["e", "w", "s"] }));
    fill(L, ["shelf", "meatcase"]);
  },
  // The cutting room: the band saw, the blocks (counters) and the slicer, a sink, shelves of knives and wrap; a sausage
  // kitchen's stockpot and counters (sausage); a game bay's saw, a chest freezer and crates (game).
  cutroom(L) {
    const ws = L.walls(), mode = L.room.mode;
    const line = mode === "sausage" ? ["counter", "stockpot", "counter", "slicer", "sink"] : mode === "game" ? ["meatsaw", "counter", "sink", "counter"] : ["meatsaw", "counter", "slicer", "counter", "sink"];
    L.run(line, ws.slice(0, 2).map((w) => w.side), { plain: () => full(L) });
    if (mode !== "sausage") must(L, "meatsaw");
    if (L.c.w * L.c.h >= 16) L.centre("counter", P(L));
    if (mode === "game") L.wall("freezer", P(L));
    fill(L, mode === "game" ? ["crate", "shelf"] : ["shelf", "counter"]);
  },
  // A smokehouse: the smokers, racks of hanging meat (shelves), a counter.
  smokehouse(L) {
    some(L, "smoker", 2, { prefer: "corner" });
    if (!L.has("smoker")) L.need("smoker");
    L.wall("counter", P(L));
    fill(L, ["shelf", "counter"]);
  },
  // ---------- the deli ----------
  // The deli counter: the cases across the room (butcher's cases of cold cuts, display cases of cheese and salads), the
  // slicer on the back wall behind them, the drinks fridges along a side wall, the till, a table or two.
  delifront(L) {
    const c = L.c, y = Math.max(c.y0 + 2, Math.min(c.y1 - 2, c.y0 + 2));
    if (L.room.entry) checkout(L);
    L.wall("slicer", { sides: ["n"], prefer: "middle" }) || L.wall("slicer", { prefer: "corner" });
    counterRow(L, y, "displaycase", { box: "meatcase", every: 2, from: 1, to: 2 });
    if (!L.has("meatcase")) L.wall("meatcase", P(L, { prefer: "middle" })) || L.need("meatcase", P(L));
    if (!L.has("slicer")) L.need("slicer");
    along(L, "coldcase", Math.max(1, Math.floor(c.h / 3)), [L.variant(2, "cold") ? "e" : "w"]);
    if (c.h >= 8) tables(L, Math.floor((c.w * (c.h - 5)) / 22), 2);
    fill(L, ["shelf", "coldcase"]);
  },
});

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
      return ({ grocery: "minimart", corner: "minimart", gasstation: "minimart", truckstop: "minimart", liquor: "minimart", hardware: "hardware", gunstore: "guncounter", pawnshop: "pawncounter", electronics: "techcounter", radioshop: "techcounter", bookstore: "bookfront", clothing: "clothesfront",
        furnstore: "furnfloor", laundromat: "laundromat", thrift: "thriftfloor", bakery: "bakefront", butcher: "butcherfront", deli: "delifront" })[key] || "aislefront"; // issue #55's six: an upper sales floor's too
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
    case "corridor": return key === "motel" ? "walkway" : /^Service corridor/.test(n) ? "servicehall" : null; // servicehall: a big shop's (shopvariants.js, issue #35)
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
//   The grocery stores' (issue #22): the stock shelter above also in a supermarket's warehouse, and
//   checkoutline the checkout lanes barricaded: the gaps between the checkouts shoved full of crates and shelving (half
//                cover: one gap left), the one who held them behind with spent brass, the dead in front of them;
//   freezershut  someone shut in a supermarket's walk-in freezer, never let out;
//   frontdoors   the dead piled inside the front doors of a grocery or a supermarket, where they broke in and were cut
//                down: blood to the doors, spent brass where the shooters stood.
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
  for (const r of shopRooms(ctx, ["pallets", "stock", "warehouse"])) {
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
function checkoutLine(ctx) {
  const { rng } = ctx;
  for (const r of shopRooms(ctx, ["superstore", "grocerfloor"])) {
    const f = r.f || 0, tills = ctx.inner(r).filter(([x, y]) => (ctx.at(f, x, y) || {}).k === "checkout");
    if (tills.length < 2) continue;
    const y = tills.map((t) => t[1]).sort((a, b) => tills.filter((t) => t[1] === b).length - tills.filter((t) => t[1] === a).length)[0];
    const xs = tills.filter((t) => t[1] === y).map((t) => t[0]), x0 = Math.min(...xs), x1 = Math.max(...xs);
    const gaps = []; // the lanes between the tills (ctx.free keeps clear of a container's side: the tills are containers)
    for (let x = x0 + 1; x < x1; x++) { const c = ctx.at(f, x, y); if (c && c.k === "open" && !ctx.stair(x, y) && !ctx.used(f, x, y)) gaps.push(x); }
    if (gaps.length < 2) continue;
    const open = rng.pick(gaps);
    for (const x of gaps) if (x !== open) ctx.piece(f, x, y, rng.pick(["crate", "shelf", "cabinet", "crate"]));
    const behind = nearest(ctx.freeIn(r).filter(([, yy]) => yy < y - 1), (x0 + x1) / 2, y - 2);
    let held = "";
    if (behind.length) {
      const [bx, by] = behind[0];
      ctx.body(f, bx, by, { human: true });
      ctx.splatter(f, bx, by, "human", rng.int(1, 2));
      for (const [x, yy] of behind.slice(1, 4)) { const c = ctx.at(f, x, yy); c.brass = rng.int(SCENES.BRASS[0], SCENES.BRASS[1]); }
      held = ", the one who held them behind";
    }
    const front = rng.shuffle(ctx.freeIn(r).filter(([x, yy]) => yy > y && yy <= y + 3 && x >= x0 - 1 && x <= x1 + 1));
    const dead = Math.min(front.length, rng.int(3, 6));
    for (const [x, yy] of front.slice(0, dead)) { ctx.body(f, x, yy, {}); ctx.splatter(f, x, yy, "zombie", rng.int(1, 2)); }
    return ctx.done("checkoutline", r, open, y, `The checkout lanes were barricaded: crates and shelving shoved between the tills${held}, ${dead} of the dead in front of them.`);
  }
  return null;
}
function freezerShut(ctx) {
  const { rng } = ctx;
  for (const r of shopRooms(ctx, ["walkfreezer"])) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (!free.length) continue;
    const [x, y] = rng.pick(free);
    ctx.body(f, x, y, { human: true, quiet: true });
    return ctx.done("freezershut", r, x, y, "Someone shut themselves in the walk-in freezer and was never let out: frost on the door's inside, scratched through.");
  }
  return null;
}
function frontDoors(ctx) {
  const { rng } = ctx;
  for (const r of shopRooms(ctx, ["superstore", "grocerfloor"])) {
    const f = r.f || 0, doors = (r.doors || []).filter((d) => ctx.exit(d[0], d[1], f));
    if (!doors.length) continue;
    const [dx, dy] = rng.pick(doors);
    const near = nearest(ctx.freeIn(r), dx, dy).filter(([x, y]) => Math.abs(x - dx) + Math.abs(y - dy) <= 6);
    if (near.length < 6) continue;
    const dead = rng.int(5, 9);
    let n = 0;
    for (const [x, y] of near.slice(0, dead)) { ctx.body(f, x, y, {}); ctx.splatter(f, x, y, "zombie", rng.int(1, 3)); n++; }
    ctx.trail(f, near[0][0], near[0][1], dx, dy, "zombie");
    const back = nearest(ctx.freeIn(r).filter(([x, y]) => Math.abs(x - dx) + Math.abs(y - dy) >= 8), dx, dy).slice(0, 2);
    for (const [x, y] of back) { const c = ctx.at(f, x, y); c.brass = rng.int(SCENES.BRASS[0], SCENES.BRASS[1]); }
    return ctx.done("frontdoors", r, dx, dy, `The dead lie piled inside the front doors, ${n} of them, cut down as they broke in.`);
  }
  return null;
}
function laundryCamp(ctx) {
  const { rng } = ctx;
  for (const r of shopRooms(ctx, ["laundromat"])) {
    const f = r.f || 0, free = ctx.freeIn(r).filter(([x, y]) => (x + y) % 2 === 0);
    if (free.length < 4) continue;
    const cots = rng.shuffle(free).slice(0, rng.int(2, 4));
    for (const [x, y] of cots) ctx.piece(f, x, y, "cot");
    const left = ctx.freeIn(r);
    if (!left.length) continue;
    const [px, py] = rng.pick(left);
    ctx.pile(f, px, py, "A jug of water, soap and the last of the vending machine's snacks", { water: rng.int(1, 2), food: 1 }, r.id);
    const quiet = rng.chance(0.5), [bx, by] = rng.pick(cots);
    if (rng.chance(0.5)) ctx.body(f, bx, by, { human: true, quiet });
    return ctx.done("laundrycamp", r, px, py, `Someone lived in the ${lower(r)}: cots between the machines, a jug of water and the last of the snacks.`);
  }
  return null;
}
function showroomWall(ctx) {
  const { rng } = ctx;
  for (const r of shopRooms(ctx, ["furnfloor", "thriftfloor"])) {
    const f = r.f || 0, doors = (r.doors || []).filter((d) => ctx.exit(d[0], d[1], f));
    if (!doors.length) continue;
    const d = rng.pick(doors), cells = nearest(ctx.freeIn(r), d[0], d[1]).filter(([x, y]) => Math.abs(x - d[0]) + Math.abs(y - d[1]) <= 3).slice(0, rng.int(2, 4));
    if (cells.length < 2) continue;
    for (const [x, y] of cells) ctx.piece(f, x, y, rng.pick(["wardrobe", "dresser", "armchair", "table", "bookshelf"]));
    const out = nearest(ctx.freeIn(r).filter(([x, y]) => Math.abs(x - d[0]) + Math.abs(y - d[1]) >= 5), d[0], d[1]).slice(0, 3);
    for (const [x, y] of out) { const c = ctx.at(f, x, y); c.brass = rng.int(SCENES.BRASS[0], SCENES.BRASS[1]); }
    return ctx.done("showroomwall", r, cells[0][0], cells[0][1], `The ${lower(r)}'s own stock is shoved across the doors: wardrobes, chests of drawers and chairs, spent brass behind them.`);
  }
  return null;
}
registerScene("checkoutline", { w: 3, place: checkoutLine, kinds: ["supermarket", "grocery"], when: styled });
registerScene("freezershut", { w: 2, place: freezerShut, kinds: ["supermarket"], when: styled });
registerScene("frontdoors", { w: 3, place: frontDoors, kinds: ["supermarket", "grocery"], when: styled });
registerScene("motelhold", { w: 4, place: motelHold, kinds: ["motel"], when: styled });
registerScene("stockshelter", { w: 3, place: stockShelter, kinds: ["supermarket", "grocery", "deptstore", "hardware", "warehouse"], when: styled });
// Issue #55's shops: a laundromat lived in (cots between the folding tables, a jug of water, soap and the last snacks),
// a furniture store's showroom barricaded with its own stock (sofas and wardrobes shoved across the front doors).
registerScene("laundrycamp", { w: 3, place: laundryCamp, kinds: ["laundromat"], when: styled });
registerScene("showroomwall", { w: 3, place: showroomWall, kinds: ["furnstore", "thrift"], when: styled });
registerScene("counterstand", { w: 3, place: counterStand, kinds: ["gunstore", "pawnshop", "liquor", "corner", "gasstation"], when: styled });
registerScene("walkin", { w: 2, place: walkIn, kinds: ["restaurant", "diner", "pizza", "bakery", "butcher", "deli"], when: styled }); // issue #55: a bakery's, a butcher's, a deli's walk-in too
