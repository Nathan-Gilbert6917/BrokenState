// @ts-check
// Room layouts: homes furnished room by room (the user's request 2026-10-25, issue #10 of the interiors epic #7: "I
// want the interiors of buildings during raids and crawls to make sense. Make the layouts make sense and filled with
// appliances, furniture and decor that makes it feel lived in."). The placement helpers every room style uses, and the
// home styles built on them (a house, a farmhouse, a cabin, a lodge, a ranger station, a flat above a shop, an
// apartment block, a motel's bathrooms). buildingmaps.js assemble calls roomLayout(ctx) on a room's furnishCtx and runs
// the room's style from HOME_STYLES (homeStyle: which rooms get one); every other room keeps buildingmaps.js FURNISH.
// The pieces are data-furniture.js FURNITURE_KINDS (their cell kinds, sizes, loot and wall flags, used exactly).
//
// The rules every helper keeps (the later layout tickets, #14 hospitals, #15 police / fire / school / church and #16
// shops, call the same helpers rather than writing their own):
//   - lanes: before anything is placed, a 1-cell lane runs inside the room from every door to every other door and to
//     the stair run (every stairs or ladder cell in the room, however many: #9's runs, read from the cells), each stair
//     cell's landing (its free neighbours) kept clear too. The lane's path is the cheapest walk with cells along a wall
//     dearer (LAYOUT.WALL_COST), so it keeps off the walls the pieces hug and runs down the room's middle, along its
//     length. Nothing is placed on a lane unless a style asks for force (a required piece with no other room), and
//     after the style buildingmaps.js keeps the lanes clear of what comes later (decor.js's plants and lamps);
//   - block's connectivity guard (buildingmaps.js) still refuses any piece that would cut a walkable cell off;
//   - backs to the wall: a piece stands with its back to a solid wall (not a door, a window or a stair), facing into
//     the room (c.fc on its cells: "n" | "s" | "e" | "w", the way its front looks; -y is north, the back wall);
//   - a door's front (the room cell inside it) is never taken (buildingmaps.js keep), so nothing straddles a doorway;
//     a piece of 2+ cells keeps a cell (8 ways) off any door or stair cell too, unless a style forces a piece the room
//     must have (a bed in a two-deep bedroom);
//   - footprints: a piece's size [w, h] is laid against the north wall as it reads (w along the wall, h into the room)
//     and turned for the other walls: a sofa runs along the wall, a bed's head is against it;
//   - containers follow the pieces: a piece with loot: true is a container (buildingmaps.js box: the room's AREAS type,
//     the kind's own table in combat.js BOX_LOOT) and is placed only in a room with a loot type; a piece of 2+ cells is
//     one container with w × h. Its cells share c.pc (the piece's number on the floor);
//   - arrangement variants: variant(n, salt) is the house's dice (a hash of the map's seed as it stood when the
//     furnishing began, the floor, the room), so two houses on a street lay the same room out differently, and the
//     same house the same way every visit;
//   - density by area: target() is the old count of containers for the room (max(1, min(maxBoxes, area / 10)), as
//     buildingmaps.js topped rooms up to before), so a house holds about as much loot as it did; fill() tops a room up
//     to it with lootable pieces, never with generic shelves.
//
// The helpers (roomLayout(c) → L):
//   L.place(k, cells, { face, force, size, plain })   puts piece k on exactly these cells (all or nothing); the record or
//                                              null (plain, here and in wall / centre / beside / facing: a lootable piece
//                                              standing without being a container, as shoplayout.js's past a room's share)
//   L.wall(k, { sides, prefer, near, far, face, force, size, avoid })   the best spot with its back to a wall: sides
//                                              limits the walls ("n", "s", "e", "w"), prefer "corner" | "middle", near /
//                                              far a point to be close to / away from, avoid(cells) a spot not to take
//   L.centre(k, { near, face, force })        a spot off the walls (a table, a coffee table), nearest the room's middle
//   L.around(p, k, n)                          up to n of k beside piece p, facing it (chairs round a table)
//   L.beside(p, k)                             one k against the same wall next to piece p (a nightstand by the bed)
//   L.facing(p, k)                             k on the wall p faces, turned to it (a sofa facing the TV); else off the
//                                              walls, a cell or more away, turned to it
//   L.run(kinds, sides, { plain })             kinds laid one after another along the walls given (a kitchen's counter
//                                              run: fridge, cabinet, sink, stove...), skipping cells that will not take one
//   L.fill(kinds)                              lootable pieces of these kinds against the walls up to target()
//   L.need(k, opts)                            a piece the room must have: L.wall, then L.centre, then both with force
//   L.walls()                                  the room's walls by how much free run each has (longest first, dice ties)
//   L.remove(p)                                a piece taken back up (not a container)
//   L.variant(n, salt), L.target(), L.boxes(), L.lane(x, y), L.has(k), L.inRoom(x, y)
//
// The home styles (HOME_STYLES, by room role): kitchen (a counter run on one wall, two in an L or a galley, by the
// dice: the fridge, the sink and the stove always, cabinets as the containers, a dishwasher or a microwave sometimes, a
// table with chairs when the room is 4+ wide), living (a TV stand with a sofa facing it, an armchair, a coffee table,
// bookshelves and cabinets; a piano now and then in a lodge), dining (a table and chairs round it, a sideboard),
// bedroom (a bed, the master's a 2 × 2 double, a child's a bunk, a nightstand by it, a wardrobe or a chest of drawers),
// bath (a toilet, a sink, a bathtub or a shower, a medicine cabinet), hgarage (the car in its bay, a workbench and a tool
// chest, the washer, the dryer and the water heater, shelves, a chest freezer), pantry (shelves, a chest freezer),
// hall / landing (a console table where the hall is 2 wide; lanes keep the stairs clear), greatroom (a cabin's or a
// lodge's: a kitchenette along a wall when the floor has no kitchen, then the living room), bunk (bunks or beds and the
// drawers), apt (an apartment's kitchen-living room: the kitchen along one wall, a sofa and a table; a studio's bed when
// the flat has no bedroom) and storage (a home's box room or storeroom: shelves).
import { pieceDef } from "./data-furniture.js";
import { hash01 } from "./skills.js";

export const LAYOUT = {
  WALL_COST: 3,       // a lane's step on a cell along a wall (the rest 1): lanes keep off the walls the pieces hug
  TABLE_FROM: 4,      // a kitchen's table and chairs when the room's shorter side is at least this
  COFFEE_FROM: 4,     // a living room's coffee table likewise
  MASTER_AREA: 12,    // the largest bedroom on a floor of at least this many cells is the master (a 2 × 2 double)
  CHILD: 0.4,         // the smallest of two or more bedrooms on a floor is a child's room (a bunk) on these dice
  DISHWASHER: 0.5, MICROWAVE: 0.4, FREEZER: 0.35, PIANO: 0.25, ARMCHAIR: 0.75,
};
// The home archetypes (buildingmaps.js BUILDINGS keys) whose rooms take the home styles; a shop's flat above takes them
// through its rooms' flat mark.
export const HOME_KEYS = new Set(["house", "farmhouse", "cabin", "lodge", "ranger", "apartments", "motel"]);

const D4 = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] };
const OPP = { n: "s", s: "n", w: "e", e: "w" };
const STAIRY = new Set(["stairs", "ladder"]);
const DOORS = new Set(["idoor", "odoor", "door"]);

/** @typedef {{ k: string, cells: number[][], face: string | null, side: string | null, box: any }} Placed */

// The helpers on a room's furnishCtx c (buildingmaps.js): c.x0..c.y1, c.w, c.h, c.room, c.rng, c.free(x, y),
// c.block(x, y, k), c.unblock(x, y), c.container(x, y, k) (a container on a free cell: its record or null),
// c.kindAt(x, y), c.ridAt(x, y) (a room's id, -1 a wall / door / window, -2 outside), c.cell(x, y), c.seed, c.piece()
// (the next piece number), c.canBox (the room has a loot type), c.boxes() (its containers so far), c.target.
/** @param {any} c */
export function roomLayout(c) {
  const { x0, y0, x1, y1, room } = c;
  const inR = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && c.ridAt(x, y) === room.id;
  const at = (x, y) => (y - y0) * c.w + (x - x0);
  const lane = new Uint8Array(c.w * c.h);
  /** @type {Placed[]} */
  const placed = [];
  // A wall to put a back to: not a door; a window only behind a low piece that leaves it seen through (a sink, a bed,
  // a sofa: the catalogue's cell does not block sight), never behind a tall one (a fridge, a wardrobe, a shower).
  let lowBack = false;
  const solid = (x, y) => c.ridAt(x, y) === -1 && (c.kindAt(x, y) === "wall" || (lowBack && (c.kindAt(x, y) === "window" || c.kindAt(x, y) === "smashed")));
  const low = (k) => { const d = pieceDef(k); return !!d && !d.cell.los; };
  const nearDoor = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = c.kindAt(x + dx, y + dy); if (k && (DOORS.has(k) || STAIRY.has(k))) return true; } return false; };
  const wallNext = (x, y) => Object.values(D4).some(([dx, dy]) => c.ridAt(x + dx, y + dy) === -1);

  // ---------- the lanes ----------
  const targets = [];
  for (const [dx, dy] of room.doors || []) for (const [ex, ey] of Object.values(D4)) if (inR(dx + ex, dy + ey)) targets.push([dx + ex, dy + ey]);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inR(x, y) && STAIRY.has(c.kindAt(x, y))) {
    targets.push([x, y]);
    for (const [ex, ey] of Object.values(D4)) if (inR(x + ex, y + ey) && !STAIRY.has(c.kindAt(x + ex, y + ey))) lane[at(x + ex, y + ey)] = 1; // the landing
  }
  const walkable = (x, y) => inR(x, y) && (c.free(x, y) || STAIRY.has(c.kindAt(x, y)) || c.kindAt(x, y) === "open" || c.kindAt(x, y) === "loft");
  for (const t of targets) if (inR(t[0], t[1])) lane[at(t[0], t[1])] = 1;
  if (targets.length > 1) {
    // Cheapest paths from the first target to each other one (Dijkstra on a small grid: a room is at most a few dozen cells).
    const N = c.w * c.h, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    const s = at(targets[0][0], targets[0][1]);
    dist[s] = 0;
    for (;;) {
      let i = -1, best = Infinity;
      for (let j = 0; j < N; j++) if (!done[j] && dist[j] < best) { best = dist[j]; i = j; }
      if (i < 0) break;
      done[i] = 1;
      const x = x0 + (i % c.w), y = y0 + Math.floor(i / c.w);
      for (const [dx, dy] of Object.values(D4)) {
        const nx = x + dx, ny = y + dy;
        if (!walkable(nx, ny)) continue;
        const j = at(nx, ny), d = best + (wallNext(nx, ny) ? LAYOUT.WALL_COST : 1);
        if (d < dist[j]) { dist[j] = d; prev[j] = i; }
      }
    }
    for (const t of targets.slice(1)) for (let j = at(t[0], t[1]); j >= 0 && dist[j] < Infinity; j = prev[j]) lane[j] = 1;
  }
  const onLane = (x, y) => inR(x, y) && !!lane[at(x, y)];
  const ok = (x, y, force) => inR(x, y) && c.free(x, y) && (force || !lane[at(x, y)]);

  // ---------- footprints ----------
  // A piece's cells with its back to wall `side` and its first cell at (x, y) along that wall: canonical [w, h] against
  // the north wall (w along it, h into the room), turned for the others.
  const sizeOf = (k, size) => size || (pieceDef(k) ? pieceDef(k).size : [1, 1]);
  function footprint(side, x, y, w, h) {
    const out = [];
    for (let a = 0; a < w; a++) for (let d = 0; d < h; d++) {
      if (side === "n") out.push([x + a, y + d]);
      else if (side === "s") out.push([x + a, y - d]);
      else if (side === "w") out.push([x + d, y + a]);
      else out.push([x - d, y + a]);
    }
    return out;
  }
  // The cells along a wall inside the room (the row or column against it), in order.
  function wallLine(side) {
    const out = [];
    if (side === "n" || side === "s") { const y = side === "n" ? y0 : y1; for (let x = x0; x <= x1; x++) out.push([x, y]); }
    else { const x = side === "w" ? x0 : x1; for (let y = y0; y <= y1; y++) out.push([x, y]); }
    return out.filter(([x, y]) => inR(x, y));
  }
  /** Puts piece k on exactly these cells, all or none. @returns {Placed | null} */
  function place(k, cells, opts = {}) {
    const d = pieceDef(k);
    if (!d || !cells.length) return null;
    const asBox = d.loot && !opts.plain; // plain: a lootable piece that stands without being searched (shoplayout.js: past the room's containers)
    if (asBox && !c.canBox) return null;
    if (cells.length > 1 && !opts.force && cells.some(([x, y]) => nearDoor(x, y))) return null;
    if (!cells.every(([x, y]) => ok(x, y, opts.force))) return null;
    const sorted = cells.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const done = [];
    let box = null;
    const undo = () => { for (const [x, y] of done.reverse()) c.unblock(x, y); return null; };
    for (const [x, y] of sorted.slice(1)) { if (!c.block(x, y, k)) return undo(); done.push([x, y]); }
    const [fx, fy] = sorted[0];
    if (asBox) { box = c.container(fx, fy, k, onLane); if (!box) return undo(); } // searched from a lane or a door's front where it can
    else if (!c.block(fx, fy, k)) return undo();
    if (box && sorted.length > 1) {
      const xs = sorted.map((p) => p[0]), ys = sorted.map((p) => p[1]);
      box.w = Math.max(...xs) - Math.min(...xs) + 1; box.h = Math.max(...ys) - Math.min(...ys) + 1;
    }
    const pc = sorted.length > 1 ? c.piece() : 0;
    for (const [x, y] of sorted) { const cl = c.cell(x, y); if (opts.face) cl.fc = opts.face; if (pc) cl.pc = pc; }
    const rec = { k, cells: sorted, face: opts.face || null, side: opts.side || null, box };
    placed.push(rec);
    return rec;
  }

  // The room's walls by their free run (cells along each that take a piece), longest first, dice for ties.
  function walls() {
    lowBack = false;
    return ["n", "s", "w", "e"].map((side, i) => {
      const line = wallLine(side).filter(([x, y]) => ok(x, y) && solid(x + D4[side][0], y + D4[side][1]));
      return { side, free: line.length, len: wallLine(side).length, j: hash01(c.seed, "wall", room.id, i) };
    }).filter((w) => w.free > 0).sort((a, b) => b.free - a.free || a.j - b.j);
  }
  const variant = (n, salt = "") => Math.min(n - 1, Math.floor(hash01(c.seed, "arr", room.id, salt) * n));
  const mid = () => [(x0 + x1) / 2, (y0 + y1) / 2];
  const dist2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
  const centreOf = (cells) => [cells.reduce((a, p) => a + p[0], 0) / cells.length, cells.reduce((a, p) => a + p[1], 0) / cells.length];

  // The best spot with its back to a wall.
  function wall(k, opts = {}) {
    lowBack = low(k);
    const [w, h] = sizeOf(k, opts.size);
    const sides = opts.sides || ["n", "s", "w", "e"];
    const cands = [];
    sides.forEach((side, si) => {
      const line = wallLine(side);
      line.forEach(([x, y], li) => {
        const cells = footprint(side, x, y, w, h);
        if (!cells.every(([cx, cy]) => ok(cx, cy, opts.force)) || (opts.avoid && opts.avoid(cells))) return;
        // The back row (the cells against the wall) is solid wall behind.
        const back = cells.filter(([cx, cy]) => (side === "n" ? cy === y0 : side === "s" ? cy === y1 : side === "w" ? cx === x0 : cx === x1));
        if (back.length < Math.min(w, cells.length) || !back.every(([cx, cy]) => solid(cx + D4[side][0], cy + D4[side][1]))) return;
        const ctr = centreOf(cells);
        let score = si * 0.5 + hash01(c.seed, "spot", room.id, k, side, li) * 0.8;
        if (opts.prefer === "corner") score += Math.min(li, line.length - 1 - (li + w - 1)) * 1.2;
        if (opts.prefer === "middle") score += Math.abs(li + (w - 1) / 2 - (line.length - 1) / 2) * 1.2;
        if (opts.near) score += Math.sqrt(dist2(ctr, opts.near)) * 2;
        if (opts.far) score -= Math.sqrt(dist2(ctr, opts.far)) * 2;
        cands.push({ cells, side, score });
      });
    });
    cands.sort((a, b) => a.score - b.score);
    for (const cd of cands) {
      const r = place(k, cd.cells, { face: opts.face || OPP[cd.side], side: cd.side, force: opts.force, plain: opts.plain });
      if (r) return r;
    }
    return null;
  }
  // A spot off the walls, nearest the room's middle (or opts.near).
  function centre(k, opts = {}) {
    const [w, h] = sizeOf(k, opts.size);
    const goal = opts.near || mid();
    const cands = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cells = footprint("n", x, y, w, h);
      if (!cells.every(([cx, cy]) => ok(cx, cy, opts.force) && (opts.walls || !wallNext(cx, cy)))) continue;
      cands.push({ cells, score: dist2(centreOf(cells), goal) + hash01(c.seed, "ctr", room.id, k, x, y) * 0.5 });
    }
    cands.sort((a, b) => a.score - b.score);
    for (const cd of cands) { const r = place(k, cd.cells, { face: opts.face || null, force: opts.force, plain: opts.plain }); if (r) return r; }
    return null;
  }
  const faceTo = (from, to) => { const dx = to[0] - from[0], dy = to[1] - from[1]; return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "e" : "w") : (dy >= 0 ? "s" : "n"); };
  // Up to n of k beside piece p, each facing it.
  function around(p, k, n) {
    let made = 0;
    const spots = [];
    for (const [x, y] of p.cells) for (const [dx, dy] of Object.values(D4)) {
      const sx = x + dx, sy = y + dy;
      if (p.cells.some((q) => q[0] === sx && q[1] === sy) || spots.some((q) => q[0] === sx && q[1] === sy)) continue;
      spots.push([sx, sy, x, y]);
    }
    spots.sort((a, b) => hash01(c.seed, "around", room.id, a[0], a[1]) - hash01(c.seed, "around", room.id, b[0], b[1]));
    for (const [sx, sy, tx, ty] of spots) {
      if (made >= n) break;
      if (place(k, [[sx, sy]], { face: faceTo([sx, sy], [tx, ty]) })) made++;
    }
    return made;
  }
  // One k against the same wall, next to piece p (a nightstand by the bed's head).
  function beside(p, k, opts = {}) {
    if (!p.side) return null;
    lowBack = low(k);
    const along = p.side === "n" || p.side === "s" ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
    const back = p.cells.filter(([x, y]) => solid(x + D4[p.side][0], y + D4[p.side][1]));
    const order = variant(2, `beside${p.k}`) ? along.slice().reverse() : along;
    for (const [dx, dy] of order) for (const [x, y] of back) {
      const nx = x + dx, ny = y + dy;
      if (p.cells.some((q) => q[0] === nx && q[1] === ny)) continue;
      if (!solid(nx + D4[p.side][0], ny + D4[p.side][1])) continue;
      const r = place(k, [[nx, ny]], { face: OPP[p.side], side: p.side, plain: opts.plain });
      if (r) return r;
    }
    return null;
  }
  // k on the wall p faces, turned to it; else off the walls, turned to it.
  function facing(p, k, opts = {}) {
    const ctr = centreOf(p.cells);
    if (p.face) {
      const r = wall(k, { sides: [p.face], near: ctr, face: OPP[p.face], plain: opts.plain });
      if (r) return r;
    }
    const [w, h] = sizeOf(k);
    const cands = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cells = footprint("n", x, y, w, h);
      const cc = centreOf(cells), d = Math.sqrt(dist2(cc, ctr));
      if (d < 2 || !cells.every(([cx, cy]) => ok(cx, cy))) continue;
      cands.push({ cells, cc, score: Math.abs(d - 2.5) + hash01(c.seed, "facing", room.id, x, y) * 0.3 });
    }
    cands.sort((a, b) => a.score - b.score);
    for (const cd of cands) { const r = place(k, cd.cells, { face: faceTo(cd.cc, ctr), plain: opts.plain }); if (r) return r; }
    return null;
  }
  // Kinds laid one after another along these walls (each tried at the next cells that take it).
  function run(kinds, sides, opts = {}) {
    const out = [];
    let i = 0;
    for (const side of sides) {
      const line = wallLine(side);
      for (let li = 0; li < line.length && i < kinds.length; li++) {
        const k = kinds[i], [w, h] = sizeOf(k);
        lowBack = low(k);
        const [x, y] = line[li];
        const cells = footprint(side, x, y, w, h);
        if (!solid(x + D4[side][0], y + D4[side][1])) continue;
        const r = place(k, cells, { face: OPP[side], side, plain: typeof opts.plain === "function" ? opts.plain() : opts.plain });
        if (r) { out.push(r); i++; li += w - 1; }
      }
    }
    return { placed: out, left: kinds.slice(i) };
  }
  const boxes = () => c.boxes().length;
  const target = () => c.target;
  // Lootable pieces of these kinds (in turn) against the walls until the room holds target() containers.
  function fill(kinds) {
    let tries = 0;
    for (let i = 0; boxes() < target() && tries < kinds.length * 2; i++, tries++) {
      const k = kinds[i % kinds.length];
      if (pieceDef(k) && pieceDef(k).loot) wall(k, { prefer: "corner" });
    }
  }
  // A piece the room must have: against a wall, else off the walls, then the same over the lanes.
  function need(k, opts = {}) {
    return wall(k, opts) || centre(k, { ...opts, walls: true }) || wall(k, { ...opts, force: true }) || centre(k, { ...opts, walls: true, force: true });
  }
  const has = (k) => placed.some((p) => p.k === k);
  // A piece taken back up (not a container: its record stays with the room's loot): false when it cannot be.
  function remove(p) {
    if (!p || p.box || !placed.includes(p)) return false;
    for (const [x, y] of p.cells) c.unblock(x, y);
    placed.splice(placed.indexOf(p), 1);
    return true;
  }
  return { place, wall, centre, around, beside, facing, run, fill, need, walls, variant, target, boxes, has, remove, placed, lane: onLane, ok, inRoom: inR, room, c };
}

// ======================================================================================
// The home styles, by room role. L: roomLayout(c); c: the room's furnishCtx (c.room.master / child / kitchenette /
// studio: buildingmaps.js marks them before the styles run; c.key: the building's key).
// ======================================================================================
/** @param {ReturnType<typeof roomLayout>} L */
function kitchenRun(L, extras = true) {
  const v = L.variant(3, "kitchen"), ws = L.walls();
  if (!ws.length) return;
  const first = ws[0].side;
  const adj = { n: ["w", "e"], s: ["e", "w"], w: ["s", "n"], e: ["n", "s"] }[first];
  const sides = v === 0 ? [first] : v === 1 ? [first, ...adj.filter((s) => ws.some((w) => w.side === s)).slice(0, 1)] : [first, OPP[first]];
  // The three it must have first (a small kitchen has room for little else), the cabinets next to them, the extras last.
  const roomy = L.c.w * L.c.h >= 9;
  const order = L.variant(2, "order") ? ["stove", roomy ? "cabinet" : "", "sink", "fridge"] : ["fridge", roomy ? "cabinet" : "", "sink", "stove"];
  L.run(order.filter(Boolean), sides);
  for (const k of ["fridge", "sink", "stove"]) if (!L.has(k)) L.need(k);
  L.fill(["cabinet"]);
  const sink = L.placed.find((p) => p.k === "sink");
  if (extras && sink && hash01(L.c.seed, "dish", L.room.id) < LAYOUT.DISHWASHER) L.beside(sink, "dishwasher");
  if (extras && hash01(L.c.seed, "micro", L.room.id) < LAYOUT.MICROWAVE) L.wall("microwave", { sides });
}
/** @param {ReturnType<typeof roomLayout>} L */
function tableAndChairs(L, from = LAYOUT.TABLE_FROM, chairs = 4) {
  if (Math.min(L.c.w, L.c.h) < from) return null;
  const t = L.centre("table");
  if (t) L.around(t, "chair", chairs);
  return t;
}
/** @param {ReturnType<typeof roomLayout>} L */
function livingSet(L, opts = {}) {
  const v = L.variant(3, "living");
  const tv = opts.tv === false ? null : L.wall("tvstand", { prefer: "middle", sides: v === 2 ? L.walls().map((w) => w.side).reverse() : undefined });
  const sofa = (tv ? L.facing(tv, "sofa") : null) || L.wall("sofa", { prefer: "middle", far: tv ? tv.cells[0] : undefined });
  if (!sofa || hash01(L.c.seed, "armchair", L.room.id) < LAYOUT.ARMCHAIR) { // no room for the sofa: an armchair at least
    const near = sofa ? sofa.cells[v === 1 ? sofa.cells.length - 1 : 0] : null;
    L.centre("armchair", { near: near || undefined, face: tv ? undefined : null }) || L.wall("armchair", { prefer: "corner" });
  }
  if (sofa && tv && Math.min(L.c.w, L.c.h) >= LAYOUT.COFFEE_FROM) {
    const a = sofa.cells[0], b = tv.cells[0];
    L.centre("table", { near: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
  }
  if (opts.piano && hash01(L.c.seed, "piano", L.room.id) < LAYOUT.PIANO) L.wall("piano", { prefer: "corner" });
  L.fill(v === 0 ? ["bookshelf", "cabinet"] : ["cabinet", "bookshelf"]);
}
/** @param {ReturnType<typeof roomLayout>} L */
function bedSet(L) {
  const r = L.room, v = L.variant(3, "bed");
  let bed = null;
  if (r.master) bed = L.wall("bed", { size: [2, 2], prefer: "middle" });
  else if (r.child) bed = L.wall("bunk", { prefer: "corner" });
  if (!bed) bed = L.wall("bed", { prefer: v === 0 ? "middle" : "corner" }) || L.need("bed", { size: [1, 2] });
  const store = v === 2 ? ["dresser", "wardrobe"] : ["wardrobe", "dresser"];
  if (!L.wall(store[0], { far: bed ? bed.cells[0] : undefined })) L.wall(store[1]) || L.need(store[1]);
  if (L.boxes() < L.target()) { if (!(bed && L.beside(bed, "nightstand"))) L.wall("nightstand", { near: bed ? bed.cells[0] : undefined }); } // within the room's share of containers
  L.fill(store);
}
export const HOME_STYLES = {
  /** @param {ReturnType<typeof roomLayout>} L */
  kitchen(L) {
    kitchenRun(L);
    tableAndChairs(L);
    L.fill(["cabinet", "shelf"]);
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  living(L) { livingSet(L); },
  /** @param {ReturnType<typeof roomLayout>} L */
  dayroom(L) { livingSet(L); },
  /** @param {ReturnType<typeof roomLayout>} L */
  dining(L) {
    const t = L.centre("table") || L.need("table");
    if (t) { const t2 = Math.min(L.c.w, L.c.h) >= 4 && L.c.w * L.c.h >= 24 ? L.place("table", [[t.cells[0][0] + 1, t.cells[0][1]]]) : null; L.around(t2 ? { ...t, cells: [...t.cells, ...t2.cells] } : t, "chair", t2 ? 6 : 4); }
    L.fill(L.variant(2, "side") ? ["cabinet", "dresser"] : ["dresser", "cabinet"]);
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  bedroom(L) { bedSet(L); },
  /** @param {ReturnType<typeof roomLayout>} L */
  bath(L) {
    const v = L.variant(2, "bath");
    L.need("toilet", { prefer: "corner" });
    const sink = L.wall("sink", { prefer: "middle" }) || L.need("sink");
    if (sink) L.beside(sink, "medcab"); // over the sink
    L.fill(["medcab"]);
    const tub = v === 0 && L.c.w * L.c.h >= 8 ? L.wall("bathtub", { prefer: "corner" }) : null;
    if (!tub) L.wall("shower", { prefer: "corner" });
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  hgarage(L) {
    const c = L.c;
    // The car in its bay first (combat.js placeCar, 2 × 3–4 cells), then the work wall and the laundry corner.
    if (c.w >= 4 && c.h >= 4) { const kind = c.rng.chance(0.3) ? "truck" : "car"; for (const [x, y] of c.innerSpots().slice(0, 8)) if (!L.lane(x, y) && c.car(x, y, kind)) break; }
    const bench = L.wall("workbench", { prefer: "corner" });
    if (bench) L.beside(bench, "toolchest"); else L.wall("toolchest");
    const v = L.variant(2, "laundry");
    L.run(v ? ["washer", "dryer", "waterheater"] : ["waterheater", "washer", "dryer"], L.walls().map((w) => w.side).slice(-2));
    if (hash01(c.seed, "freezer", L.room.id) < LAYOUT.FREEZER && L.boxes() < L.target()) L.wall("freezer");
    L.fill(["shelf", "toolchest"]);
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  pantry(L) {
    if (hash01(L.c.seed, "freezer", L.room.id) < LAYOUT.FREEZER) L.wall("freezer");
    L.fill(["shelf"]);
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  hall(L) {
    if (Math.min(L.c.w, L.c.h) >= 2) L.wall("table", { prefer: "middle" });
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  greatroom(L) {
    if (L.room.kitchenette) { kitchenRun(L, false); tableAndChairs(L, 3, 2); }
    livingSet(L, { piano: L.c.key === "lodge", tv: !L.room.kitchenette }); // a cabin's one room: no TV (its fridge is the container)
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  bunk(L) {
    const n = Math.max(1, Math.min(3, Math.floor((L.c.w * L.c.h) / 8)));
    for (let i = 0; i < n; i++) if (!L.wall(L.variant(2, `bunk${i}`) ? "bunk" : "bed", { prefer: "corner" })) break;
    if (!L.has("bunk") && !L.has("bed")) L.need("bed", { size: [1, 2] });
    L.fill(L.variant(2, "drawers") ? ["wardrobe", "dresser"] : ["dresser", "wardrobe"]);
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  apt(L) {
    kitchenRun(L);
    if (L.room.studio) { const bed = L.wall("bed", { prefer: "corner" }) || L.need("bed", { size: [1, 2] }); if (bed && L.boxes() < L.target()) L.beside(bed, "nightstand"); }
    const tv = L.boxes() < L.target() ? L.wall("tvstand", { prefer: "middle" }) : null; // within the flat's share of containers
    if (!(tv && L.facing(tv, "sofa"))) L.wall("sofa", { prefer: "middle" });
    tableAndChairs(L, 3, 2);
    L.fill(L.room.studio ? ["wardrobe", "cabinet"] : ["cabinet", "bookshelf"]);
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  storage(L) {
    L.fill(["shelf"]);
  },
};
// The home style for a room (buildingmaps.js assemble): a home archetype's rooms (HOME_KEYS) and a shop's flat above
// (its rooms carry flat: true); a home's storage room only. null: the room keeps buildingmaps.js FURNISH.
/** @param {any} room @param {string | undefined} key */
export function homeStyle(room, key) {
  if (!HOME_STYLES[room.role]) return null;
  return HOME_KEYS.has(key || "") || room.flat ? HOME_STYLES[room.role] : null;
}

// ======================================================================================
// The hospitals, clinics and vets room by room (the user's request 2026-10-25, issue #14 of the interiors epic #7:
// "Special buildings like hospitals, police stations etc should have furniture, appliances, decor, rooms and layouts
// that make sense for the type of building."). The rooms of a hospital, a clinic, an infirmary and a vet (MED_KEYS),
// by role, on the same helpers as the homes; buildingmaps.js institution / vet lay the rooms out floor by floor (the
// emergency room, the ambulance bay, the morgue, the cafeteria on the ground; wards, the theatre, the ICU above).
//   er          the emergency room: a medication cart, bays of a gurney with an IV stand by it, a medicine cabinet
//               while the room has containers to give, a curtain between the bays (the dead push through it), the
//               triage desk
//   ward        hospital beds, each with its nightstand (a patient's things: the containers, the poorest of the
//               building) or its IV stand by it (a bed with room for neither is taken back up); a maternity ward
//               (room.cots) a cot by each bed. icu: fewer beds, an IV stand and a monitor on its stand by each, a
//               medication cart
//   theatre     the operating table (a vet's surgery: the steel table) with a lamp and a monitor by it, instrument
//               cabinets (the richest: surgical kits), a sink
//   pharmroom   the counter by the door, the drug safe (a clinic's, a vet's: a medicine cabinet; always locked:
//               locks.js "drugs") away from it, shelves
//   morgue      a run of body drawers along a wall (their effects), the autopsy table, a sink
//   lobby       the waiting room: the reception counter, a vending machine, chairs along the walls and a row of them
//               down the middle when the room is 5 deep
//   nursestation  a counter, a desk with its chair, a filing cabinet and a medication cart
//   exam        an exam bed (a vet's: the steel table), a sink, a medicine cabinet, a desk
//   ambbay      the ambulance in its bay (combat.js placeCar, a container of its own: BOX_LOOT.ambulance), a parked
//               gurney, shelves
//   corridor    wheelchairs and gurneys parked along one wall only (every few cells: MED.PARK_EVERY), so the other
//               row stays clear
//   cafeteria, kitchen, staffroom (breakroom), laundry, storage (the supply room; a vet's food store: crates of feed),
//   office (a doctor's: a desk, a chair, a bookshelf, filing), restroom (toilets in a row, a sink), cells (a vet's
//   kennels: bars every other cell along the walls, a pen between each two)
export const MED = {
  BEDS: [2, 8],       // a ward's beds: area / 6 within these
  BED_AREA: 6,
  ICU: [2, 4],        // an ICU's beds: area / 10 within these
  BAYS: [2, 8],       // an ER's bays: area / 6 within these
  TABLES: [1, 5],     // a cafeteria's tables: area / 12
  CHAIRS: [4, 14],    // a waiting room's chairs along its walls: area / 4
  PARK_EVERY: 7,      // a corridor: one wheelchair or gurney parked for every so many cells of its length
};
export const MED_KEYS = new Set(["hospital", "clinic", "infirmary", "vet"]);
/** @param {number} v @param {number[]} r */
const clampM = (v, r) => Math.max(r[0], Math.min(r[1], v));
const D4L = Object.values(D4);
/** The cell inside the room in front of its first door. @param {ReturnType<typeof roomLayout>} L */
function doorFront(L) {
  for (const [dx, dy] of L.room.doors || []) for (const [ex, ey] of D4L) if (L.inRoom(dx + ex, dy + ey)) return [dx + ex, dy + ey];
  return undefined;
}
// A stand by a bed (the first of kinds that goes, a lootable one only while the room has containers to give): against
// the wall beside its head, else any free cell next to it.
/** @param {ReturnType<typeof roomLayout>} L @param {Placed} bed @param {string[]} kinds */
function standBy(L, bed, kinds) {
  const can = (k) => !pieceDef(k).loot || L.boxes() < L.target();
  for (const k of kinds) if (can(k)) { const r = L.beside(bed, k); if (r) return r; }
  for (const k of kinds) {
    if (!can(k)) continue;
    for (const [x, y] of bed.cells) for (const [dx, dy] of D4L) {
      const nx = x + dx, ny = y + dy;
      if (bed.cells.some((q) => q[0] === nx && q[1] === ny)) continue;
      const r = L.place(k, [[nx, ny]], { face: bed.face });
      if (r) return r;
    }
  }
  return null;
}
// Up to n beds of kind k against the walls, each with a stand by it (kinds); a bed with no room for one is taken back up
// and its spot skipped. Returns the beds.
/** @param {ReturnType<typeof roomLayout>} L @param {string} k @param {number} n @param {string[]} kinds */
function bedsWithStands(L, k, n, kinds, opts = {}) {
  const beds = [], skip = new Set();
  const avoid = (cells) => skip.has(`${cells[0]}`);
  for (let t = 0; t < n * 3 && beds.length < n; t++) {
    const bed = L.wall(k, { ...opts, avoid });
    if (!bed) break;
    if (standBy(L, bed, kinds)) beds.push(bed);
    else { skip.add(`${bed.cells[0]}`); L.remove(bed); }
  }
  if (!beds.length) { // a room that must have one: with force
    const bed = L.need(k);
    if (bed && !standBy(L, bed, kinds)) L.remove(bed); else if (bed) beds.push(bed);
  }
  return beds;
}
/** A row of chairs down the room's middle, along its length, facing f. @param {ReturnType<typeof roomLayout>} L */
function chairRow(L, face) {
  const { x0, y0, x1, y1, w, h } = L.c;
  let n = 0;
  if (w >= h) { const y = Math.floor((y0 + y1) / 2); for (let x = x0 + 1; x < x1; x++) if (L.place("chair", [[x, y]], { face })) n++; }
  else { const x = Math.floor((x0 + x1) / 2); for (let y = y0 + 1; y < y1; y++) if (L.place("chair", [[x, y]], { face })) n++; }
  return n;
}
export const MEDICAL_STYLES = {
  /** @param {ReturnType<typeof roomLayout>} L */
  er(L) {
    const n = Math.min(L.room.bays || Infinity, clampM(Math.floor((L.c.w * L.c.h) / MED.BED_AREA), MED.BAYS)); // bays: a plan's own most (civicvariants.js: a small ER keeps room for its triage desk)
    L.wall("medcart", { prefer: "corner" });
    for (const g of bedsWithStands(L, "gurney", n, ["ivstand"])) {
      if (L.boxes() < L.target()) L.beside(g, "medcab");
      const iv = L.placed.find((p) => p.k === "ivstand" && p.cells.some(([x, y]) => g.cells.some(([gx, gy]) => Math.abs(gx - x) + Math.abs(gy - y) === 1)));
      L.beside(iv && iv.side ? iv : g, "curtain");
    }
    const desk = L.need("desk", { prefer: "corner", near: doorFront(L) });
    if (desk) L.around(desk, "chair", 1);
    L.fill(["medcab"]);
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  ward(L) {
    if (L.c.key === "vet") return MEDICAL_STYLES.cells(L); // a vet's recovery ward: pens
    const n = clampM(Math.floor((L.c.w * L.c.h) / MED.BED_AREA), MED.BEDS);
    const beds = bedsWithStands(L, "hospbed", n, ["nightstand", "ivstand"], { prefer: L.variant(2, "ward") ? "corner" : undefined });
    if (L.room.cots) for (const b of beds) L.beside(b, "crib") || L.wall("crib", { near: b.cells[0] });
    if (L.variant(3, "wheelchair") === 0) L.wall("wheelchair", { prefer: "corner" });
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  icu(L) {
    const n = clampM(Math.floor((L.c.w * L.c.h) / 10), MED.ICU);
    for (const b of bedsWithStands(L, "hospbed", n, ["ivstand"])) standBy(L, b, ["monitor"]);
    L.fill(["medcart", "medcab"]);
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  theatre(L) {
    const k = L.c.key === "vet" ? "vettable" : "optable";
    const t = L.centre(k) || L.need(k);
    if (t) { L.around(t, "floorlamp", 1); if (k === "optable") { L.around(t, "monitor", 1); L.around(t, "ivstand", 1); } }
    L.need("instcab", { prefer: "corner" });
    L.wall("sink", { prefer: "middle" });
    L.fill(["instcab"]);
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  pharmroom(L) {
    const front = doorFront(L);
    L.wall("counter", { near: front });
    // A hospital's drug safe; a clinic's drug cupboard or a vet's drug room a locked medicine cabinet. Always locked.
    const safe = L.need(L.c.key === "hospital" ? "drugsafe" : "medcab", { prefer: "corner", far: front });
    if (safe && safe.box) safe.box.lockKind = "drugs"; // locks.js
    L.fill(["shelf"]);
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  morgue(L) {
    const ws = L.walls();
    if (ws.length) L.run(Array(Math.max(2, L.target())).fill("morguelocker"), [ws[0].side]);
    if (!L.has("morguelocker")) L.need("morguelocker");
    L.centre("autopsy") || L.need("autopsy");
    L.wall("sink");
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  lobby(L) {
    const desk = L.need("counter", { prefer: "middle" }); // reception
    if (desk) L.around(desk, "chair", 1);
    if (L.c.key === "hospital" || L.variant(2, "vending")) L.wall("vending", { prefer: "corner" });
    const n = clampM(Math.floor((L.c.w * L.c.h) / 4), MED.CHAIRS);
    let made = Math.min(L.c.w, L.c.h) >= 5 ? chairRow(L, desk ? desk.side : null) : 0;
    for (let i = 0; made < n && i < n * 2; i++) if (L.wall("chair")) made++;
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  nursestation(L) {
    const ctr = L.need("counter", { prefer: "middle", near: doorFront(L) });
    if (ctr) L.beside(ctr, "counter");
    const desk = L.wall("desk");
    if (desk) L.around(desk, "chair", 1);
    L.wall("filing", { prefer: "corner" });
    L.wall("medcart", { prefer: "corner" }) || L.need("medcart");
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  exam(L) {
    if (L.c.key === "vet") L.centre("vettable") || L.need("vettable");
    else L.wall("exambed", { prefer: "corner" }) || L.need("exambed");
    L.wall("sink");
    L.wall("medcab") || L.need("medcab");
    const desk = L.c.key === "vet" ? null : L.wall("desk");
    if (desk) L.around(desk, "chair", 1);
    L.fill(["cabinet"]);
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  ambbay(L) {
    const c = L.c;
    // The ambulance in its bay (a truck's 2 × 4 cells drawn as an ambulance: buildingmaps.js furnishCtx vehicle, #15's),
    // a container of its own (BOX_LOOT.ambulance).
    if (Math.min(c.w, c.h) >= 3 && Math.max(c.w, c.h) >= 5) {
      const ax = c.w >= c.h ? "x" : "y";
      for (const [x, y] of c.innerSpots().slice(0, 12)) { if (L.lane(x, y)) continue; if (c.vehicle(x, y, { ax, len: 4, kind: "truck", body: "ambulance", box: "ambulance" })) break; }
    }
    L.wall("gurney", { size: [2, 1] });
    L.fill(["shelf"]);
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  corridor(L) {
    if (Math.min(L.c.w, L.c.h) < 2) return;
    const sides = L.c.w >= L.c.h ? ["n", "s"] : ["w", "e"];
    const side = sides[L.variant(2, "park")];
    const n = Math.floor(Math.max(L.c.w, L.c.h) / MED.PARK_EVERY);
    for (let i = 0; i < n; i++) if (i % 2) L.wall("gurney", { sides: [side], size: [2, 1] }); else L.wall("wheelchair", { sides: [side] });
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  cafeteria(L) {
    const ws = L.walls();
    if (ws.length) L.run(["counter", "counter", "counter"], [ws[0].side]); // the serving counter
    const n = clampM(Math.floor((L.c.w * L.c.h) / 12), MED.TABLES);
    for (let i = 0; i < n; i++) { const t = L.centre("table"); if (!t) break; L.around(t, "chair", 4); }
    L.fill(["counter"]);
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  kitchen(L) {
    const ws = L.walls();
    if (ws.length) L.run(["fridge", "stove", "oven", "sink", "counter"], [ws[0].side, ...(ws[1] ? [ws[1].side] : [])]);
    for (const k of ["fridge", "stove", "sink"]) if (!L.has(k)) L.need(k);
    L.wall("freezer");
    L.fill(["counter", "shelf"]);
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  staffroom(L) {
    L.wall("fridge", { prefer: "corner" }) || L.need("fridge");
    L.wall("microwave");
    L.wall("sink");
    L.wall("sofa", { prefer: "middle" });
    if (Math.min(L.c.w, L.c.h) >= 3) { const t = L.centre("table"); if (t) L.around(t, "chair", 2); }
    L.fill(["cabinet"]);
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  laundry(L) {
    const ws = L.walls();
    if (ws.length) L.run(L.variant(2, "laundry") ? ["washer", "dryer", "washer", "dryer"] : ["washer", "washer", "dryer", "dryer"], [ws[0].side]);
    if (!L.has("washer")) L.need("washer");
    for (let i = 0; i < 2; i++) L.wall("linencart", { prefer: "corner" }) || L.centre("linencart");
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  storage(L) {
    L.fill(L.room.food ? ["crate"] : L.c.key === "hospital" && L.room.type === "clinic" ? ["rack"] : ["shelf"]); // a vet's food store: sacks of feed in crates (BOX_LOOT "crate@vet"); a hospital's supply room's shelving (rack@clinic)
    if (!L.room.food && L.room.type === "clinic") L.wall("linencart");
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  office(L) {
    const desk = L.wall("desk", { prefer: "middle" }) || L.need("desk");
    if (desk) L.around(desk, "chair", 1);
    L.wall("bookshelf", { prefer: "corner" });
    L.fill(["filing", "bookshelf"]);
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  restroom(L) {
    const ws = L.walls();
    const n = ws.length ? Math.max(1, Math.floor(ws[0].free / 2)) : 1;
    if (ws.length) L.run(Array(n).fill("toilet"), [ws[0].side]);
    if (!L.has("toilet")) L.need("toilet");
    L.wall("sink") || L.need("sink");
  },
  /** @param {ReturnType<typeof roomLayout>} L */
  cells(L) {
    // A vet's kennels: bars every other cell along the two longest walls (a pen between each two).
    const { x0, y0, x1, y1 } = L.c;
    const ws = L.walls().slice(0, 2);
    for (const { side } of ws) {
      const line = side === "n" || side === "s" ? Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, side === "n" ? y0 : y1]) : Array.from({ length: y1 - y0 + 1 }, (_, i) => [side === "w" ? x0 : x1, y0 + i]);
      line.forEach(([x, y], i) => { if (i % 2 === 1) L.place("bars", [[x, y]], { face: OPP[side] }); });
    }
  },
};
MEDICAL_STYLES.breakroom = MEDICAL_STYLES.staffroom;
// The medical style for a room (buildingmaps.js assemble): a hospital's, a clinic's, an infirmary's or a vet's rooms
// by role; null for a role with none (the room keeps buildingmaps.js FURNISH).
/** @param {any} room @param {string | undefined} key */
export function medicalStyle(room, key) {
  if (room.civic) return null; // a room marked with a civic style keeps it (civiclayout.js: a prison infirmary's cells, issue #36)
  return MED_KEYS.has(key || "") ? MEDICAL_STYLES[room.role] || null : null;
}
