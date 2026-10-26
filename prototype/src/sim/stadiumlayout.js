// @ts-check
// Sports stadiums and arenas' own rooms laid out (issue #57, stadium.js; the user's request 2026-10-26: "different sports
// stadiums 500x500 max"), on roomlayout.js's placement helpers (lanes kept clear, backs to the wall, nothing on a door's
// front, the lootable pieces the containers), the rooms only a venue has (STADIUM_ROLES, merged into buildingmaps.js
// ROLES) and the venues' signs of survival (interiorscenes.js registerScene, each with a when: only a venue's map has them).
//
// The styles (STADIUM_STYLES, by the room's stad mark; stadiumStyle(room)):
//   stands      a section of the stands: rows of fixed stadium seats (bleachers at a high school or a rodeo: room.seat)
//               facing the field or the court (room.face, else the building's back), the row by the rail kept clear,
//               aisles at the ends and every SEAT.AISLE cells;
//   concession  a concession stand: the counters along the concourse side, the fryer and the soft-serve, the freezers and
//               shelves of stock behind; concstore its storeroom (racks and crates of cases);
//   gate        the gates: a line of turnstiles across the room (every other cell open: the way through);
//   ticket      the ticket office: the windows (teller), the safe, a desk;
//   proshop     the team store: racks of jerseys, shelves, the checkout, a mannequin;
//   firstaid    the first-aid room: exam beds, a gurney, the medicine cabinet;
//   security    stadium security: the security desk, the wall of screens, lockers;
//   locker      a team's locker room: lockers round the walls, benches between, a whiteboard; training the trainers' room
//               (exam beds, the ice machine, a weight bench); equip the equipment room (storage cages, racks);
//   pressbox    the press box: a row of desks along the field side, chairs, cameras, computers;
//   suite       a luxury suite: its own seats along the field side, a bar counter, the liquor cabinet, a sofa, the fridge;
//   grounds     the groundskeepers' room: tool chests, fuel drums, racks;
//   court       an arena's floor: the hoops (or a rink's goals) at its ends, the floor kept clear;
//   overlook    an arena's upper floor over the court: the floor cut away (galleryvoid) inside a walkway round it.
//
// The scenes (registerScene, when: a venue's map, map.plan.venue): a FEMA or evacuation shelter on the field (cots in rows
// under the canopies, the supply pallets, the people it took in); a last stand on the concourse (the concession stands'
// counters and the tables dragged across it, brass behind them, the dead piled in front).
import { registerScene, SCENES } from "./interiorscenes.js";
import { COMMERCIAL_STYLES } from "./shoplayout.js"; // a venue's restrooms and offices as a shop's

// The rooms only a venue has (buildingmaps.js ROLES: name, loot type, furnish, extras).
const role = (name, type, furnish, extra = {}) => ({ name, type, furnish, ...extra });
export const STADIUM_ROLES = {
  concourse:  role("Concourse", null, "none", { hub: true, fl: "conc", label: false }),
  stands:     role("Stands", null, "none", { fl: "conc", maxBoxes: 0 }),
  gate:       role("Gates", null, "none", { hub: true, fl: "conc", maxBoxes: 0 }),
  concession: role("Concession stand", "concessions", "none", { fl: "tile", maxBoxes: 4 }),
  suite:      role("Luxury suite", "suites", "none", { fl: "carpet", maxBoxes: 3 }),
};

export const SEAT = {
  AISLE: 12,       // an aisle every this many cells along a row
  BLEACH: 3,       // bleachers' rows (2 deep) this far apart
  FEMA: 0.4,       // stadium.js: the field's FEMA shelter is laid out (an outdoor scene of the map's own dice)
};

/** @typedef {ReturnType<typeof import("./roomlayout.js").roomLayout>} Lay */
const full = (/** @type {Lay} */ L) => L.boxes() >= L.target();
const fillWith = (/** @type {Lay} */ L, kinds, tries = 3) => { for (let i = 0, miss = 0; !full(L) && miss < tries; i++) if (L.wall(kinds[i % kinds.length], { prefer: "corner" })) miss = 0; else miss++; };
const OPP = { n: "s", s: "n", e: "w", w: "e" };

// Rows across a room toward `face` (the side the seats look at): the row by that side kept clear (the rail, the court's
// edge), each row then `step` deep, aisles at the ends and every SEAT.AISLE. kind: a 1-cell seat or 2 × 2 bleachers.
function seatRows(L, face, kind, step) {
  const c = L.c, big = kind === "bleachers";
  const across = face === "n" || face === "s"; // rows along x
  const [a0, a1] = across ? [c.x0, c.x1] : [c.y0, c.y1];
  const [b0, b1] = across ? [c.y0, c.y1] : [c.x0, c.x1];
  const toward = face === "n" || face === "w"; // the face side is the low end
  const depth = b1 - b0 + 1;
  for (let k = 1; k + (big ? 1 : 0) < depth; k += step) {
    const b = toward ? b0 + k : b1 - k - (big ? 1 : 0);
    for (let a = a0 + 1; a <= a1 - 1 - (big ? 1 : 0); a += big ? 2 : 1) {
      if ((a - a0) % SEAT.AISLE === 0) continue;
      const cells = [];
      for (let da = 0; da < (big ? 2 : 1); da++) for (let db = 0; db < (big ? 2 : 1); db++) cells.push(across ? [a + da, b + db] : [b + db, a + da]);
      L.place(kind, cells, { face });
    }
  }
}

/** @type {Record<string, (L: Lay) => void>} */
export const STADIUM_STYLES = {
  stands(L) {
    const r = L.room, kind = r.seat === "bleachers" ? "bleachers" : "stadseat";
    seatRows(L, r.face || "n", kind, kind === "bleachers" ? SEAT.BLEACH : 2);
  },
  concession(L) {
    L.wall("concession", { sides: ["n"], prefer: "middle", plain: true }); // along the concourse side
    L.wall("concession", { sides: ["n"], prefer: "middle", plain: true });
    L.wall("fryer", { sides: ["s", "e", "w"] });
    L.wall("softserve", { sides: ["s", "e", "w"] });
    fillWith(L, ["freezer", "shelf", "counter"]);
  },
  concstore(L) { fillWith(L, ["rack", "crate", "shelf", "crate"], 4); },
  gate(L) {
    const c = L.c, mid = c.y0 + Math.floor((c.y1 - c.y0) / 2);
    for (const y of [mid, mid + 1, mid - 1, mid + 2, mid - 2]) { // the middle row, else the next one off the lanes (a side door's)
      if (y <= c.y0 || y >= c.y1) continue;
      let n = 0;
      for (let x = c.x0 + 1; x <= c.x1 - 1; x += 2) if (L.place("turnstile", [[x, y]], { face: "n" })) n++;
      if (n >= 2) break;
    }
  },
  ticket(L) {
    L.wall("teller", { sides: ["s"], prefer: "middle", plain: true });
    L.wall("teller", { sides: ["s"], prefer: "middle", plain: true });
    L.wall("safe", { prefer: "corner" });
    L.wall("desk", { prefer: "corner" });
    fillWith(L, ["cabinet", "filing"]);
  },
  proshop(L) {
    L.wall("checkout", { sides: ["s"], prefer: "corner" });
    for (let i = 0; i < 3; i++) L.centre("clothesrack");
    L.centre("mannequin", { plain: true });
    fillWith(L, ["shelf", "clothesrack", "displaycase"]);
  },
  firstaid(L) {
    L.wall("exambed", { prefer: "corner" });
    L.wall("exambed", { prefer: "corner" });
    L.wall("gurney", { prefer: "corner" });
    L.wall("medcab", { prefer: "corner" });
    fillWith(L, ["cabinet", "shelf"]);
  },
  security(L) {
    L.wall("secdesk", { prefer: "middle" });
    L.wall("screens", { prefer: "middle" });
    L.wall("chair", { sides: ["s"] });
    fillWith(L, ["locker", "filing", "cabinet"]);
  },
  locker(L) {
    fillWith(L, ["locker"], 4);
    for (let i = 0; i < 6; i++) if (!L.wall("locker", { plain: true })) break;
    L.wall("whiteboard", { prefer: "middle" });
    for (let i = 0; i < 3; i++) L.centre("campusbench");
  },
  training(L) {
    L.wall("exambed", { prefer: "corner" });
    L.wall("icemachine", { prefer: "corner" });
    L.wall("weightbench", { prefer: "corner" });
    fillWith(L, ["medcab", "cabinet", "shelf"]);
  },
  equip(L) { fillWith(L, ["sportcage", "rack", "shelf"], 4); },
  pressbox(L) {
    for (let i = 0; i < 4; i++) if (!L.wall("desk", { sides: ["n"] })) break;
    L.wall("camera", { sides: ["n"] });
    L.wall("computer", { prefer: "corner" });
    for (let i = 0; i < 3; i++) L.wall("chair", { sides: ["n"] });
    fillWith(L, ["cabinet", "filing"]);
  },
  suite(L) {
    const c = L.c;
    for (let x = c.x0 + 1; x <= c.x1 - 1; x++) L.place("stadseat", [[x, c.y0 + 1]], { face: "n" });
    L.wall("barcounter", { sides: ["s", "e", "w"], prefer: "corner" });
    L.wall("liquorcab", { sides: ["s", "e", "w"], prefer: "corner" });
    L.wall("minifridge", { sides: ["s", "e", "w"] });
    L.wall("sofa", { sides: ["s", "e", "w"] });
    L.centre("table");
    fillWith(L, ["cabinet", "shelf"]);
  },
  grounds(L) {
    L.wall("toolchest", { prefer: "corner" });
    for (let i = 0; i < 3; i++) L.wall("drum", { prefer: "corner" });
    fillWith(L, ["rack", "crate", "locker", "shelf"], 4);
  },
  court(L) {
    const c = L.c, r = L.room, long = c.x1 - c.x0 >= c.y1 - c.y0, my = Math.floor((c.y0 + c.y1) / 2), mx = Math.floor((c.x0 + c.x1) / 2);
    const k = r.sport === "hockey" ? "soccergoal" : "hoop";
    if (long) { L.place(k, [[c.x0 + 2, my]], { face: "e" }); L.place(k, [[c.x1 - 2, my]], { face: "w" }); }
    else { L.place(k, [[mx, c.y0 + 2]], { face: "s" }); L.place(k, [[mx, c.y1 - 2]], { face: "n" }); }
  },
  restroom: (L) => COMMERCIAL_STYLES.restroom(L),
  manager: (L) => COMMERCIAL_STYLES.manager(L),
  overlook(L) {
    const c = L.c;
    for (let y = c.y0 + 2; y <= c.y1 - 2; y++) for (let x = c.x0 + 2; x <= c.x1 - 2; x++) if (L.ok(x, y)) L.c.block(x, y, "galleryvoid");
  },
};

/** The style of a venue's room (buildingmaps.js assemble asks it), else null. @param {any} room */
export function stadiumStyle(room) {
  return (room && room.stad && STADIUM_STYLES[room.stad]) || null;
}

// ======================================================================================
// The venues' signs of survival (interiorscenes.js registerScene; their own dice there).
// ======================================================================================
const isVenue = (ctx) => !!(ctx.map && ctx.map.plan && ctx.map.plan.venue);

// A FEMA or evacuation shelter on the field: rows of cots, the supply pallets by them (crates and their stores), the
// people it took in who never left, a canopy's tent poles at the corners.
function femaShelter(ctx) {
  const { rng } = ctx, F = ctx.map.plan.field;
  if (!F || F.w < 24 || F.h < 16) return null;
  const f = 0, w = Math.min(F.w - 8, rng.int(24, 40)), h = Math.min(F.h - 6, rng.int(12, 18));
  const x0 = F.x0 + Math.floor((F.w - w) / 2), y0 = F.y0 + Math.floor((F.h - h) / 2);
  const cots = [];
  for (let y = y0 + 1; y < y0 + h - 1; y += 3) for (let x = x0 + 1; x < x0 + w - 4; x += 2) {
    if (!ctx.free(f, x, y)) continue;
    ctx.piece(f, x, y, "cot"); cots.push([x, y]);
  }
  if (cots.length < 6) return null;
  for (const [x, y] of [[x0, y0], [x0 + w - 1, y0], [x0, y0 + h - 1], [x0 + w - 1, y0 + h - 1]]) if (ctx.free(f, x, y)) { ctx.at(f, x, y).k = "tent"; ctx.take(f, x, y); } // the canopy's poles
  // The pallets along one end: crates, and what was left on them.
  let piles = 0;
  for (let y = y0 + 1; y < y0 + h - 1; y += 3) {
    const x = x0 + w - 2;
    if (!ctx.free(f, x, y) || !ctx.free(f, x - 1, y + 1)) continue;
    ctx.piece(f, x, y, "crate");
    ctx.pile(f, x - 1, y + 1, "Relief supply pallet", { food: rng.int(3, 9), water: rng.int(4, 10), meds: rng.int(0, 2) }, null, rng.chance(0.3) ? ["bandagekit"] : []);
    piles++;
  }
  const n = rng.int(3, 7);
  let made = 0;
  for (const [x, y] of rng.shuffle(cots.slice())) {
    if (made >= n) break;
    const by = y + 1;
    if (!ctx.free(f, x, by)) continue;
    ctx.body(f, x, by, { human: true, quiet: true, patient: true });
    made++;
  }
  return ctx.done("femashelter", null, x0 + Math.floor(w / 2), y0 + Math.floor(h / 2), `An evacuation shelter was set up on the field: ${cots.length} cots in rows, ${piles} supply pallet${piles === 1 ? "" : "s"} by them, and ${made} who were brought here and never left.`, { cells: [x0, y0, w, h] });
}

// A last stand on the concourse: tables and crates dragged across it, spent brass behind, the dead heaped in front.
function concourseStand(ctx) {
  const { rng } = ctx;
  for (const r of rng.shuffle(ctx.rooms.filter((q) => q.role === "concourse" && !q.scene))) {
    const f = r.f || 0, horiz = r.w >= r.h, len = horiz ? r.w : r.h;
    if (len < 24) continue;
    for (let t = 0; t < 6; t++) {
      const at = rng.int(8, len - 9), line = [];
      for (let j = 1; j < (horiz ? r.h : r.w) - 1; j++) {
        const x = horiz ? r.x0 + at : r.x0 + j, y = horiz ? r.y0 + j : r.y0 + at;
        const c = ctx.at(f, x, y);
        if (c && c.k === "open") line.push([x, y]);
      }
      if (line.length < 3 || line.some(([x, y]) => ctx.used(f, x, y) || ctx.nearBox(f, x, y) || ctx.stair(x, y))) continue;
      const gap = rng.int(0, line.length - 1);
      line.forEach(([x, y], i) => { if (i !== gap) ctx.piece(f, x, y, ["table", "crate", "counter"][i % 3]); });
      const side = rng.chance(0.5) ? 1 : -1, off = (k) => line.map(([x, y]) => (horiz ? [x + side * k, y] : [x, y + side * k]));
      for (const [x, y] of off(1)) { const c = ctx.at(f, x, y); if (c && c.k === "open" && rng.chance(0.6)) c.brass = rng.int(SCENES.BRASS[0], SCENES.BRASS[1]); }
      const [hx, hy] = off(2)[rng.int(0, line.length - 1)];
      if (ctx.free(f, hx, hy)) { ctx.body(f, hx, hy, { human: true }); ctx.splatter(f, hx, hy, "human", 2); }
      const n = rng.int(5, 10);
      let dead = 0;
      for (let k = 1; k <= 4 && dead < n; k++) for (const [x, y] of rng.shuffle(off(-k))) { if (dead >= n) break; if (!ctx.free(f, x, y) || !rng.chance(0.5)) continue; ctx.body(f, x, y, {}); ctx.splatter(f, x, y, "zombie", rng.int(1, 3)); dead++; }
      const [cx, cy] = line[gap];
      return ctx.done("concoursestand", r, cx, cy, `A last stand on the ${String(r.name).split(",")[0].toLowerCase()}: tables and crates dragged across it, spent brass behind them, ${dead} of the dead heaped in front.`);
    }
  }
  return null;
}
registerScene("femashelter", { w: 4, place: femaShelter, when: (ctx) => isVenue(ctx) && !!ctx.map.plan.field && !ctx.map.plan.indoor });
registerScene("concoursestand", { w: 3, place: concourseStand, when: (ctx) => isVenue(ctx) && ctx.rooms.some((r) => r.role === "concourse") });
export const STADIUM_SCENES = ["femashelter", "concoursestand"];
SCENES.ODDS.stadium = SCENES.ODDS.stadium ?? 0.9;
SCENES.COUNT_BY.stadium = SCENES.COUNT_BY.stadium || [0.7, 0.35];
