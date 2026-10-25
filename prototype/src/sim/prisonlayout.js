// @ts-check
// Prison layouts: county jails, state prisons and maximum-security penitentiaries furnished for their kind (the user's
// request 2026-10-25, issue #31 of the interiors epic #7: "add … prisons max of 400x400"). The room styles, on
// roomlayout.js's placement helpers (lanes kept clear between the doors and to the stairs, backs to the walls, a door's
// front never taken, the lootable pieces the containers); buildingmaps.js assemble runs a room's style when its plan leaf
// carries prison: <style> (prisonStyle), which only prison.js's plans set (new saves only: an older save's prison keeps
// its one building, worldcfg.js legacyPrisons).
//
// The styles (PRISON_STYLES, by the leaf's prison mark):
//   tier       a row of cells against the wall the leaf's face names (n or s), the walkway before them: each cell 2 × 3
//              cells, a steel bunk (a shelf over it) and a steel toilet-and-sink unit behind a row of bars with a cell
//              door in it (DOOR_KINDS.cell), bars between the cells. The block's state (open, shut or locked: the leaf's
//              doors) sets how the doors stand. Under every other bunk a stash of contraband (a container: shivs,
//              cigarettes, a lighter, a makeshift pick). A two-tier block has a tier each side of its day room on both
//              floors (prison.js housingUnit); single cells (segregation, death row, the psych unit) are the same cells.
//   dayroom    steel tables with their stools fixed (2 × 2) in rows, a television on a wall.
//   picket     an officers' station: a control panel by the window onto the block, a desk and a chair, a locker.
// Reused pieces (2026-10-25, once on dev): #25's intake lockers (the property room), #25's X-ray scanner and #27's
// walk-through scanner (the gatehouse, booking), #26's footlockers (a dorm's bunks) and radio console (central control).
//   control    central control: control panels along the walls (each the switch of a housing unit's cell doors: its
//              unit id, prison.js cellSwitch), monitors (a server rack), a desk, lockers of riot gear.
//   dorm       a dormitory unit's bays: bunks in rows with an aisle, a locker each two.
//   chow       the chow hall: steel tables in rows, the serving line (counters) along the kitchen wall.
//   pkitchen   the kitchen: ranges, fridges, sinks and counters along the walls.
//   pstores    the food warehouse: pallet racks and crates of food in bulk.
//   property   the property room: property lockers along every wall (the inmates' belongings).
//   booking    booking and intake: the counter, a desk for fingerprints, a metal detector, filing cabinets, a bench.
//   holding    a holding tank: a steel toilet and benches (pews bolted down) along the walls.
//   visit      visitation: a row of booths across the room (glass, a phone each), chairs either side.
//   laundry    washers and dryers along the walls, a table to fold on.
//   industries prison industries (the licence-plate shop, the print shop): workbenches, tool chests, a machine.
//   parmory    the armory: gun racks, ammo cabinets, lockers of riot gear.
//   ward       the infirmary's ward: hospital beds against the walls with a medicine cabinet.
//   gate       the gatehouse's post: a metal detector by the lane, a counter, a control panel, a locker.
//   office     the warden's office, records, the shift office: a desk and its chair, filing cabinets, a bookshelf.
// The pieces: data-furniture.js's prison rows (steelbunk, steeltoilet, daytable, ctrlpanel, visitbooth),
// and the catalogue's own (gunrack, ammocab, locker, hospbed, washer, dryer, workbench...).
import { hash01 } from "./skills.js";
import { pieceDef } from "./data-furniture.js";
import { registerScene, SCENES } from "./interiorscenes.js"; // the prisons' signs of survival (issue #11's hook)
import { BMAP } from "./buildingmaps.js"; // call-time only (buildingmaps.js imports this module)

export const PRISON_LAYOUT = {
  STASH: 0.5,         // a cell's bunk with a stash under it (a container)
  TABLE_GAP: 2,       // cells between a day room's tables
};
const OPP = { n: "s", s: "n", w: "e", e: "w" };
const isLoot = (k) => !!(pieceDef(k) && pieceDef(k).loot);

/** @typedef {any} Lay */
// ---------- the cells ----------
// A tier of cells along wall `side` (n: the back wall y0, s: the front wall y1) of the room: rows 0–2 the cell, 3 the
// bars with the door, 4 the walkway (kept clear). Cells from the end away from the room's first door. Returns the cells
// made: [{ door: [x, y], in: [x, y] }].
export function tierCells(L, side, o = {}) {
  const c = L.c, room = L.room;
  if (c.h < 5 || c.w < 2) return [];
  const sy = side === "n" ? 1 : -1, yb0 = side === "n" ? c.y0 : c.y1;
  const row = (i) => yb0 + sy * i;
  const doors = room.doors || [];
  const nearDoor = (x, y) => doors.some(([dx, dy]) => Math.abs(dx - x) <= 1 && Math.abs(dy - y) <= 1) || [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([ex, ey]) => ["stairs", "ladder"].includes(c.kindAt(x + ex, y + ey) || ""));
  const fits = (xa) => {
    const xb = xa + 1;
    if (xa < c.x0 || xb > c.x1) return false;
    for (let i = 0; i <= 3; i++) for (const x of [xa, xb]) if (!c.free(x, row(i)) || nearDoor(x, row(i))) return false;
    return c.free(xb, row(4));
  };
  // From the west end or the east one: whichever end has no door by it goes first (the walkway's way in is the other).
  const westDoor = doors.some(([x]) => x < c.x0 + 2), dir = westDoor ? -1 : 1;
  const made = [];
  for (let xa = dir > 0 ? c.x0 : c.x1 - 1; xa >= c.x0 && xa + 1 <= c.x1;) {
    if (!fits(xa)) { xa += dir; continue; }
    const xb = xa + 1, all = [];
    for (let i = 0; i <= 3; i++) all.push([xa, row(i)], [xb, row(i)]);
    // The door first (the cell stays reachable while its bars go up), then the bars, the pieces, the bars between.
    if (!c.block(xb, row(3), "idoor")) { xa += dir; continue; }
    const door = c.cell(xb, row(3));
    door.cellDoor = true; door.cellIn = [xb, row(2)]; door.tier = room.unitId ?? null;
    c.keep(xb, row(4)); c.keep(xb, row(2));
    const bunk = c.block(xa, row(3), "bars") && L.place(o.bunk || "steelbunk", [[xa, row(0)], [xa, row(1)]], { face: "e", force: true });
    const ok = !!bunk && !!L.place("steeltoilet", [[xb, row(0)]], { face: OPP[side], force: true });
    if (!ok) { for (const [x, y] of all) if (c.kindAt(x, y) !== "open") c.unblock(x, y); delete door.cellDoor; delete door.cellIn; delete door.tier; xa += dir; continue; }
    const between = dir > 0 ? xb + 1 : xa - 1;
    if (between >= c.x0 && between <= c.x1) for (let i = 0; i <= 3; i++) c.block(between, row(i), "bars");
    if (c.stash && hash01(c.seed, "stash", room.id, xa) < (o.stash ?? PRISON_LAYOUT.STASH)) c.stash(bunk.cells, "steelbunk", "under the bunk");
    made.push({ door: [xb, row(3)], in: [xb, row(2)] });
    xa += 3 * dir;
  }
  room.cellsMade = made.length;
  return made;
}

// Steel tables (2 × 2, their stools fixed) in rows across a room, TABLE_GAP cells apart, off the lanes.
function tables(L, k = "daytable", most = 99) {
  const c = L.c, g = PRISON_LAYOUT.TABLE_GAP;
  let n = 0;
  for (let y = c.y0 + 1; y + 1 <= c.y1 - 1 && n < most; y += 2 + g) for (let x = c.x0 + 1; x + 1 <= c.x1 - 1 && n < most; x += 2 + g) {
    const cells = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
    if (cells.some(([cx, cy]) => L.lane(cx, cy))) continue;
    if (L.place(k, cells, { face: "s" })) n++;
  }
  return n;
}
// n pieces of k against the walls, while the room still wants containers (a lootable k) or up to n.
function along(L, k, n, sides) {
  let made = 0;
  for (let i = 0; i < n; i++) {
    if (isLoot(k) && L.boxes().length >= L.target()) break;
    if (!L.wall(k, { sides, prefer: "corner" })) break;
    made++;
  }
  return made;
}
const desk = (L) => { const d = L.wall("desk", { prefer: "middle" }); if (d) L.around(d, "chair", 1); return d; };

/** @type {Record<string, (L: Lay) => void>} */
export const PRISON_STYLES = {
  tier(L) { tierCells(L, L.room.face || "n"); },
  dayroom(L) {
    if (L.room.well) return; // upstairs: open air over the day room (prison.js openTiers)
    tables(L);
    L.wall("tvstand", { prefer: "middle" });
  },
  picket(L) {
    L.wall("ctrlpanel", { prefer: "middle" }) || L.need("ctrlpanel");
    desk(L);
    along(L, "locker", 2);
  },
  control(L) {
    let panels = 0;
    for (let i = 0; i < (L.room.panels || 3); i++) if (L.wall("ctrlpanel", { prefer: "middle" })) panels++;
    if (!panels) L.need("ctrlpanel");
    L.wall("serverrack", { prefer: "corner" });
    L.wall("radioconsole", { prefer: "corner" }); // #26's radio console
    desk(L);
    along(L, "locker", 3);
  },
  dorm(L) {
    const c = L.c;
    // Bunks (1 × 2) in rows across the bay, two cells of aisle between the columns, two rows free between bunk rows.
    for (let y = c.y0; y + 1 <= c.y1; y += 4) for (let x = c.x0; x <= c.x1; x += 3) { const b = L.place("bunk", [[x, y], [x, y + 1]], { face: "s" }); if (b && x + 1 <= c.x1 && L.boxes().length < L.target()) L.place("footlocker", [[x + 1, y + 1]], { face: "w" }); } // a footlocker at a bunk's foot (#26's)
    along(L, "locker", 6);
  },
  chow(L) {
    const ws = L.walls();
    if (ws.length) for (let i = 0; i < 4; i++) L.wall("counter", { sides: [ws[0].side], prefer: "middle" });
    tables(L);
  },
  pkitchen(L) {
    const ws = L.walls();
    if (ws.length) L.run(["range", "range", "sink", "counter", "fridge", "fridge", "counter", "sink"], ws.slice(0, 2).map((w) => w.side));
    for (const k of ["fridge", "sink", "range"]) if (!L.has(k)) L.need(k);
    L.fill(["shelf", "counter"]);
  },
  pstores(L) {
    along(L, "palletrack", 8);
    L.fill(["crate", "shelf"]);
  },
  property(L) { along(L, "intakelocker", 20); L.fill(["intakelocker"]); }, // #25's intake lockers
  booking(L) {
    L.wall("counter", { prefer: "middle" }) || L.need("counter");
    L.wall("screener", { prefer: "corner" }); // #27's walk-through scanner
    desk(L);
    along(L, "filing", 2);
    L.wall("pew", { prefer: "corner" });
  },
  holding(L) {
    L.wall("steeltoilet", { prefer: "corner" }) || L.need("steeltoilet");
    along(L, "pew", 3);
  },
  visit(L) {
    // The booths in a row across the middle of the room (a glass wall with its phones), a chair each side.
    const c = L.c, y = c.y0 + Math.floor(c.h / 2);
    let n = 0;
    for (let x = c.x0 + 1; x <= c.x1 - 1; x += 2) {
      if (L.lane(x, y) || !L.place("visitbooth", [[x, y]], { face: "s" })) continue;
      n++;
      if (y - 1 >= c.y0) L.place("chair", [[x, y - 1]], { face: "s" });
      if (y + 1 <= c.y1) L.place("chair", [[x, y + 1]], { face: "n" });
    }
    if (!n) L.need("visitbooth");
  },
  laundry(L) {
    const ws = L.walls();
    if (ws.length) L.run(["washer", "washer", "dryer", "dryer", "washer", "dryer"], ws.slice(0, 2).map((w) => w.side));
    L.centre("table");
    L.fill(["shelf"]);
  },
  industries(L) {
    along(L, "workbench", 4);
    L.wall("machine", { prefer: "corner" });
    L.fill(["toolchest", "crate"]);
  },
  parmory(L) {
    along(L, "gunrack", 4);
    along(L, "ammocab", 2);
    L.fill(["locker", "gunrack", "ammocab"]);
  },
  ward(L) {
    along(L, "hospbed", 6);
    L.wall("medcab", { prefer: "corner" });
    L.fill(["medcab"]);
  },
  gate(L) {
    L.wall("screener", { prefer: "middle" }) || L.need("screener"); // #27's walk-through scanner
    L.wall("scanner", { prefer: "corner" }); // #25's X-ray belt for the bags
    L.wall("ctrlpanel", { prefer: "corner" });
    L.wall("counter", { prefer: "corner" });
    along(L, "locker", 1);
  },
  office(L) {
    desk(L);
    along(L, "filing", 2);
    L.wall("bookshelf", { prefer: "corner" });
    L.fill(["filing", "cabinet"]);
  },
};

// The prison style for a room (buildingmaps.js assemble): its plan leaf's prison mark. null: not a prison's room.
/** @param {any} room */
export function prisonStyle(room) {
  return room && room.prison && PRISON_STYLES[room.prison] ? PRISON_STYLES[room.prison] : null;
}

// ======================================================================================
// The prisons' signs of survival (interiorscenes.js registerScene, issue #11's hook; their own dice there), on a prison
// or a jail's complex only (when: its rooms carry the prison marks):
//   opened     a block where the doors opened: every cell door of a tier standing open, bodies on the walkway and in
//              the day room, blood;
//   lockdown   a block still locked from central control: its cell doors locked (the dead inside, Sleepers that rise
//              when the doors open: cellSwitch, or a lock picked);
//   guardstand the guards' last stand in central control: officers' bodies in uniform with their kit (kit guards), brass,
//              the dead in front of the door, a desk shoved against it;
//   takeover   inmates who took over and barricaded a unit: tables and lockers piled in the door to the corridor, a
//              holder's note; floorfolk.js's holders (survivors or raiders, prison.js PRISON.HOLD) are inside;
//   bus        an abandoned evacuation bus in the sally port: a prison bus (a container: its seats, the guards' bags),
//              bodies round it, a door left open.
// ======================================================================================
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const nearest = (cells, x, y) => cells.slice().sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y));
const lower = (r) => String(r.name || "room").replace(/ \(upstairs\)$/, "").replace(/, .*$/, "").toLowerCase();
const marked = (ctx, mark) => ctx.rng.shuffle(ctx.rooms.filter((r) => r.prison === mark && !r.scene));
const cellDoorsIn = (ctx, r) => ctx.inner(r).map(([x, y]) => [x, y, ctx.at(r.f || 0, x, y)]).filter(([, , c]) => c && c.cellDoor && c.cellIn);
const unitOf = (ctx, r) => (r.unitId == null ? null : r.unitId);
// Open floor nothing took (ctx.free refuses a cell beside a door: a cell's floor inside its door, a doorway's inside).
const openAt = (ctx, f, x, y) => { const c = ctx.at(f, x, y); return !!c && c.k === "open" && c.f === "floor" && !ctx.used(f, x, y) && !ctx.stair(x, y); };
const openIn = (ctx, r) => ctx.inner(r).filter(([x, y]) => openAt(ctx, r.f || 0, x, y));

function opened(ctx) {
  const { rng } = ctx;
  for (const r of marked(ctx, "tier")) {
    if (r.locked) continue;
    const f = r.f || 0, doors = cellDoorsIn(ctx, r);
    if (doors.length < 3) continue;
    for (const [, , c] of doors) { if (c.k === "idoor") c.k = "odoor"; }
    const free = ctx.freeIn(r);
    const n = Math.min(free.length, rng.int(2, 4));
    for (const [x, y] of rng.shuffle(free).slice(0, n)) { ctx.body(f, x, y, { human: true, quiet: rng.chance(0.3), kit: rng.chance(0.3) ? "guards" : undefined }); ctx.splatter(f, x, y, "human", rng.int(1, 3)); }
    for (const [, , c] of doors.slice(0, 4)) if (openAt(ctx, f, c.cellIn[0], c.cellIn[1])) ctx.blood(f, c.cellIn[0], c.cellIn[1], "human", 1);
    return ctx.done("opened", r, doors[0][0], doors[0][1], `Every door on the ${lower(r)} stands open: the block's doors were opened all at once, and the walkway shows what came out.`, { unit: unitOf(ctx, r) });
  }
  return null;
}
function lockDoor(ctx, r, f, x, y) {
  const c = ctx.at(f, x, y);
  c.k = "door"; c.dk = "cell"; c.hp = c.mhp = Math.max(60, BMAP.DOOR.locked);
  ctx.take(f, x, y);
  if (ctx.map.lockedDoors) ctx.map.lockedDoors.push({ x, y, f, area: r.id, kind: "door", dk: "cell", cellDoor: true });
}
function sealed(ctx) {
  const { rng } = ctx;
  for (const r of marked(ctx, "tier")) {
    const f = r.f || 0, doors = cellDoorsIn(ctx, r).filter(([, , c]) => c.k === "idoor");
    if (doors.length < 3) continue;
    let dead = 0;
    for (const [x, y, c] of doors) {
      const [ix, iy] = c.cellIn;
      if (rng.chance(0.55) && openAt(ctx, f, ix, iy)) { ctx.body(f, ix, iy, { sleeper: true }); ctx.blood(f, ix, iy, "zombie", 1); dead++; }
      lockDoor(ctx, r, f, x, y);
    }
    if (!dead) continue;
    return ctx.done("lockdown", r, doors[0][0], doors[0][1], `The ${lower(r)} is still locked down from central control: ${dead} of its cells hold something that moves behind the bars.`, { unit: unitOf(ctx, r) });
  }
  return null;
}
function lastStand(ctx) {
  const { rng } = ctx;
  for (const r of marked(ctx, "control")) {
    const f = r.f || 0, free = openIn(ctx, r);
    if (free.length < 5) continue;
    const door = (r.doors || [])[0];
    const away = door ? nearest(free, door[0], door[1]).reverse() : free;
    const n = rng.int(2, 3);
    for (const [x, y] of away.slice(0, n)) { ctx.body(f, x, y, { human: true, kit: "guards", name: "A corrections officer" }); ctx.splatter(f, x, y, "human", rng.int(2, 3)); }
    for (const [x, y] of away.slice(n, n + 4)) { const c = ctx.at(f, x, y); c.brass = rng.int(SCENES.BRASS[0], SCENES.BRASS[1]); }
    if (door) {
      const inn = NEXT4.map(([ox, oy]) => [door[0] + ox, door[1] + oy]).find(([x, y]) => x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1 && openAt(ctx, f, x, y));
      if (inn) ctx.piece(f, inn[0], inn[1], "desk");
      const outside = NEXT4.map(([ox, oy]) => [door[0] + ox, door[1] + oy]).filter(([x, y]) => !(x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1) && openAt(ctx, f, x, y));
      for (const [x, y] of outside.slice(0, 2)) { ctx.body(f, x, y, {}); ctx.splatter(f, x, y, "zombie", 1); }
    }
    return ctx.done("guardstand", r, (door || away[0])[0], (door || away[0])[1], `The guards made their last stand in ${lower(r)}: a desk against the door, spent brass by the panels, ${n} officers who never left their post.`);
  }
  return null;
}
function takeover(ctx) {
  const { rng } = ctx;
  for (const r of rng.shuffle(ctx.rooms.filter((q) => (q.prison === "dayroom" || q.prison === "dorm") && !q.scene && !(q.f > 0)))) {
    const f = r.f || 0;
    const ds = (r.doors || []).filter(([x, y]) => ["idoor", "odoor"].includes((ctx.at(f, x, y) || {}).k));
    if (!ds.length) continue;
    let n = 0;
    for (const d of ds) {
      const inn = NEXT4.map(([ox, oy]) => [d[0] + ox, d[1] + oy]).find(([x, y]) => x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1);
      if (!inn || !openAt(ctx, f, inn[0], inn[1])) continue;
      ctx.piece(f, inn[0], inn[1], n % 2 ? "locker" : "table");
      n++;
    }
    if (!n) continue;
    const p = ctx.freeIn(r)[0] || openIn(ctx, r)[0];
    if (p) ctx.pile(f, p[0], p[1], "A stash the holders kept: tins and a few smokes", { food: rng.int(1, 3) }, r.id, rng.chance(0.6) ? ["cigarettes"] : []);
    return ctx.done("takeover", r, ds[0][0], ds[0][1], `Inmates took ${lower(r)} and barricaded it: tables and lockers piled in its doors. Someone may still hold it.`, { alive: true, unit: unitOf(ctx, r) });
  }
  return null;
}
function bus(ctx) {
  const { rng } = ctx, B = ctx.map.plan && ctx.map.plan.sallyport;
  if (!B || !ctx.map.busAt) return null;
  const [bx, by] = ctx.map.busAt;
  const near = [];
  for (let y = B.y0; y < B.y0 + B.h; y++) for (let x = B.x0; x < B.x0 + B.w; x++) if (ctx.free(0, x, y)) near.push([x, y]);
  const n = Math.min(near.length, rng.int(2, 4));
  for (const [x, y] of rng.shuffle(near).slice(0, n)) { ctx.body(0, x, y, { human: true, kit: rng.chance(0.5) ? "guards" : undefined, quiet: rng.chance(0.4) }); ctx.splatter(0, x, y, "human", rng.int(1, 2)); }
  return ctx.done("bus", null, bx, by, "A prison bus stands abandoned in the sally port, its door open: the evacuation that never left.");
}
// Only on a prison's or a jail's complex (when): any other map never rolls them.
const prisonish = (ctx) => ctx.rooms.some((r) => !!r.prison);
const KINDS = ["prison", "jail"];
registerScene("opened", { w: 3, place: opened, kinds: KINDS, when: prisonish });
registerScene("lockdown", { w: 3, place: sealed, kinds: KINDS, when: prisonish });
registerScene("guardstand", { w: 3, place: lastStand, kinds: KINDS, when: prisonish });
registerScene("takeover", { w: 3, place: takeover, kinds: KINDS, when: prisonish });
registerScene("bus", { w: 2, place: bus, kinds: ["prison"], when: (ctx) => prisonish(ctx) && !!ctx.map.busAt });
