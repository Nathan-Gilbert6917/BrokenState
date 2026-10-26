// @ts-check
// The shopping malls' own rooms laid out (issue #30, mall.js; the user's request 2026-10-25: "add … mall max 500x500
// building variants"), on roomlayout.js's placement helpers (lanes kept clear, backs to the wall, nothing on a door's
// front, the lootable pieces the containers), and the malls' signs of survival (interiorscenes.js registerScene, each
// with a when: only a mall's map has them).
//
// The styles (MALL_STYLES, by the room's lay mark; mallStyle(room, key): only in the mall's own buildings, MALL_KEYS):
//   - screen: a cinema's screen, rows of fixed cinema seats facing the screen wall (the front), an aisle each side;
//   - concession: the cinema's lobby, the concession counters along the back, a vending machine, chairs;
//   - projection: the projection booth behind the screens, a film projector to each screen, cabinets of reels;
//   - arcade: arcade cabinets along the walls and in rows (the ones past the room's share stand plain);
//   - security: mall security's office (the security desk with its monitors, a chair, lockers, filing);
//   - seclocker: its locker room (lockers, the gun rack: the few weapons it keeps);
//   - vacant: an empty unit (a mannequin or two left behind; the back room's shelf); halfbuilt: bare concrete, crates and
//     drums where the fit-out stopped;
//   - deck: a parking deck, cars in bays along its walls (each a container: a car's glovebox and boot), the ramps (the
//     stair runs) kept clear by their lanes.
// The rest of a mall's rooms (the offices, the restrooms) take shoplayout.js's styles by their lay; the shops inside a
// mall are their own kind's buildings and take their own styles.
//
// The scenes (MALL_SCENES): a department store's survivors' camp (tents between the racks: the classic mall holdout),
// the food court overrun, a cinema sealed with people inside, a barricaded concourse (kiosks and tables across it, a gap
// left), a looters' trail (storefront glass smashed along a row, a trail of blood, a body).
import { registerScene, SCENES } from "./interiorscenes.js";
import { COMMERCIAL_STYLES } from "./shoplayout.js";

// The mall's own buildings (buildingmaps.js BUILDINGS): their rooms carry a lay mark.
export const MALL_KEYS = new Set(["cinema", "arcade", "mallservices", "mallrestrooms", "vacantunit", "parkgarage"]);
// The mall's own room styles' tuning.
export const MALL_LAY = {
  SEAT_FRONT: 3,     // a screen's rows kept clear before the screen wall
  MANNEQUINS: [0, 2], // left behind in a vacant unit
  HALFBUILT: [3, 7], // crates and drums in an unfinished unit
  ARCADE_PLAIN: 6,   // arcade cabinets past the room's share (plain: not searched)
};

/** @typedef {ReturnType<typeof import("./roomlayout.js").roomLayout>} Lay */
const full = (/** @type {Lay} */ L) => L.boxes() >= L.target();
/** @param {Lay} L @param {string} k */
const block = (L, x, y, k) => L.ok(x, y) && L.c.block(x, y, k);

/** @type {Record<string, (L: Lay) => void>} */
export const MALL_STYLES = {
  // Rows of cinema seats (2 cells each) facing the screen at the front (+y), an aisle down each side.
  screen(L) {
    const c = L.c;
    for (let y = c.y0; y <= c.y1 - MALL_LAY.SEAT_FRONT; y += 2) for (let x = c.x0 + 1; x + 1 <= c.x1 - 1; x += 2) if (L.ok(x, y) && L.ok(x + 1, y)) L.place("cinemaseat", [[x, y], [x + 1, y]], { face: "s" });
  },
  concession(L) {
    L.wall("concession", { sides: ["n"], prefer: "middle", plain: full(L) });
    L.wall("concession", { sides: ["n"], prefer: "middle", plain: full(L) });
    L.wall("vending", { prefer: "corner", plain: full(L) });
    for (let i = 0; i < 2; i++) L.wall("chair", { sides: ["s"] });
    for (let i = 0, miss = 0; !full(L) && miss < 3; i++) if (L.wall(["shelf", "cabinet", "vending"][i % 3], { prefer: "corner" })) miss = 0; else miss++;
  },
  projection(L) {
    const c = L.c;
    for (let x = c.x0 + 2; x <= c.x1 - 1; x += 9) L.wall("projector", { sides: ["s"], near: [x, c.y1] });
    for (let i = 0, miss = 0; !full(L) && miss < 2; i++) if (L.wall(i % 2 ? "shelf" : "cabinet", { sides: ["n", "e", "w"] })) miss = 0; else miss++;
  },
  arcade(L) {
    for (let i = 0, miss = 0; !full(L) && miss < 2; i++) if (L.wall("arcadecab", { prefer: "corner" })) miss = 0; else miss++;
    for (let i = 0; i < MALL_LAY.ARCADE_PLAIN; i++) if (!L.wall("arcadecab", { plain: true })) break;
    L.wall("counter", { sides: ["n"], plain: full(L) });
  },
  security(L) {
    L.wall("secdesk", { prefer: "middle", plain: full(L) });
    L.wall("chair", { sides: ["s"] });
    for (let i = 0, miss = 0; !full(L) && miss < 2; i++) if (L.wall(i % 2 ? "filing" : "locker", { prefer: "corner" })) miss = 0; else miss++;
  },
  seclocker(L) {
    L.wall("gunrack", { prefer: "corner", plain: full(L) });
    for (let i = 0, miss = 0; !full(L) && miss < 2; i++) if (L.wall("locker", { prefer: "corner" })) miss = 0; else miss++;
  },
  vacant(L) {
    const c = L.c, n = L.variant(MALL_LAY.MANNEQUINS[1] + 1, "mannequins");
    if (L.room.role === "stock") { L.wall("shelf", { prefer: "corner" }); return; }
    for (const [x, y] of c.innerSpots().slice(0, n)) block(L, x, y, "mannequin");
  },
  halfbuilt(L) {
    const c = L.c, n = MALL_LAY.HALFBUILT[0] + L.variant(MALL_LAY.HALFBUILT[1] - MALL_LAY.HALFBUILT[0] + 1, "fitout");
    const spots = c.innerSpots();
    for (let i = 0; i < n && i < spots.length; i++) block(L, spots[i][0], spots[i][1], i % 3 === 2 ? "barrel" : "crate");
  },
  // Cars in bays along the north and the south walls (a car 2 wide, 4 long, nose to the wall), the middle the drive.
  deck(L) {
    const c = L.c;
    for (const [y, ax] of [[c.y0, "y"], [c.y1 - 3, "y"]]) for (let x = c.x0 + 1; x + 1 <= c.x1 - 1; x += 3) {
      if (L.variant(10, `bay${x},${y}`) < 4) continue; // an empty bay
      const box = !full(L);
      c.vehicle(x, y, { ax, len: 4, kind: "car", body: "car", ...(box ? { box: "car" } : {}) });
    }
  },
  manager: (L) => COMMERCIAL_STYLES.manager(L),
  restroom: (L) => COMMERCIAL_STYLES.restroom(L),
};
const ROLE_LAY = { restroom: "restroom", storage: "stock" };

/**
 * The style of a room in one of the mall's own buildings (buildingmaps.js assemble asks this first), else null.
 * @param {any} room @param {string} key
 */
export function mallStyle(room, key) {
  if (!key || !MALL_KEYS.has(key)) return null;
  const n = room.lay || ROLE_LAY[room.role];
  if (n === "stock") return COMMERCIAL_STYLES.stock;
  return (n && MALL_STYLES[n]) || null;
}

// ======================================================================================
// The malls' signs of survival (interiorscenes.js registerScene; their own dice there).
// ======================================================================================
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const isMall = (ctx) => !!(ctx.map && ctx.map.plan && ctx.map.plan.mall);
const inRoomOf = (ctx, role) => ctx.rng.shuffle(ctx.rooms.filter((r) => (r.mall === role || r.role === role) && !r.scene && !r.locked));
const nearest = (cells, x, y) => cells.slice().sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y));

// A department store's survivors' camp: tents between the racks, a cookfire's remains, the campers dead among them.
function mallCamp(ctx) {
  const { rng } = ctx;
  const floors = ctx.rng.shuffle(ctx.rooms.filter((r) => /Department floor|Upper sales floor/.test(r.name) && !r.scene));
  for (const r of floors) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 30) continue;
    const mid = [r.x0 + Math.floor(r.w / 2), r.y0 + Math.floor(r.h / 2)];
    const spots = nearest(free, mid[0], mid[1]).filter((_, i) => i % 3 === 0).slice(0, rng.int(3, 5));
    for (const [x, y] of spots) { const c = ctx.at(f, x, y); c.k = "tent"; ctx.take(f, x, y); ctx.out.pieces.push({ f, x, y, k: "tent" }); }
    const rest = ctx.freeIn(r);
    const people = rng.int(2, 4);
    for (const [x, y] of nearest(rest, mid[0], mid[1]).slice(0, people)) { ctx.body(f, x, y, { human: true }); ctx.splatter(f, x, y, "human", rng.int(1, 2)); }
    const [px, py] = nearest(ctx.freeIn(r), mid[0], mid[1])[0] || mid;
    ctx.pile(f, px, py, "The camp's stores", { food: rng.int(2, 6), water: rng.int(2, 5) }, r.id);
    return ctx.done("mallcamp", r, mid[0], mid[1], `Survivors made their camp on the ${String(r.name).split(",")[0].toLowerCase()}: tents pitched between the racks, the stores in a heap. It did not hold.`);
  }
  return null;
}
// The food court overrun: the dead cut down among the tables, the tables and chairs shoved about, blood to the doors.
function foodCourtOverrun(ctx) {
  const { rng } = ctx;
  for (const r of inRoomOf(ctx, "foodcourt")) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 12) continue;
    const n = rng.int(6, 11);
    for (const [x, y] of rng.shuffle(free).slice(0, n)) { ctx.body(f, x, y, {}); ctx.splatter(f, x, y, "zombie", rng.int(1, 3)); }
    for (const [x, y] of rng.shuffle(ctx.freeIn(r)).slice(0, 2)) { ctx.body(f, x, y, { human: true }); ctx.blood(f, x, y, "human", 2); }
    const [x, y] = free[0];
    return ctx.done("foodcourtoverrun", r, x, y, `The food court was overrun: ${n} of the dead lie among the tables, and the people who held them off beside them.`);
  }
  return null;
}
// A cinema sealed with people inside: a screen's door barricaded from within, the people still in their seats.
function cinemaSealed(ctx) {
  const { rng } = ctx;
  for (const r of inRoomOf(ctx, "screen")) {
    const f = r.f || 0, d = (r.doors || [])[0];
    if (!d) continue;
    const inn = NEXT4.map(([ox, oy]) => [d[0] + ox, d[1] + oy]).find(([x, y]) => x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1);
    const free = ctx.freeIn(r);
    if (!inn || free.length < 4) continue;
    const c = ctx.at(f, inn[0], inn[1]);
    if (!c || c.k !== "open") continue;
    ctx.piece(f, inn[0], inn[1], "crate");
    const n = rng.int(3, 6);
    const spots = rng.shuffle(free.filter(([x, y]) => Math.abs(x - inn[0]) + Math.abs(y - inn[1]) > 2)).slice(0, n);
    spots.forEach(([x, y], i) => ctx.body(f, x, y, { human: true, quiet: i > 0, sleeper: i === 0 && rng.chance(0.5) }));
    return ctx.done("cinemasealed", r, inn[0], inn[1], `${r.name.split(",")[0]} was sealed from inside, crates against the door; ${n} people sat out the end in the dark.`);
  }
  return null;
}
// A barricaded concourse: kiosk carts, crates and tables dragged across it, one gap left to squeeze through.
function concourseBarricade(ctx) {
  const { rng } = ctx;
  for (const r of inRoomOf(ctx, "concourse")) {
    const f = r.f || 0;
    const xs = rng.shuffle(Array.from({ length: Math.max(0, r.w - 30) }, (_, i) => r.x0 + 15 + i));
    for (const x of xs.slice(0, 8)) {
      const col = [];
      for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) { const c = ctx.at(f, x, y); if (c && c.k === "open") col.push(y); }
      if (col.length < 4 || col.some((y) => ctx.used(f, x, y) || ctx.nearBox(f, x, y))) continue;
      const gap = col[rng.int(0, col.length - 1)];
      for (const y of col) if (y !== gap) ctx.piece(f, x, y, ["crate", "table", "crate"][(y + x) % 3]);
      for (let i = 0; i < 3; i++) { const y = rng.pick(col); ctx.blood(f, x + 1, y, "zombie", 1); }
      const bx = x - 1, by = col[0];
      if (ctx.free(f, bx, by)) ctx.body(f, bx, by, { human: true });
      return ctx.done("concoursebarricade", r, x, gap, "Someone barricaded the concourse: crates and tables dragged across it, one gap left to squeeze through.");
    }
  }
  return null;
}
// A looters' trail: storefront glass smashed along a row, blood along the walk, one of them left behind.
function lootersTrail(ctx) {
  const { rng } = ctx;
  const plan = ctx.map.plan || {};
  const shops = rng.shuffle((plan.houses || []).filter((h) => h.role === "shop"));
  if (shops.length < 3) return null;
  const [a] = shops;
  const row = shops.filter((h) => h.y0 === a.y0 && (h.f0 || 0) === (a.f0 || 0)).sort((p, q) => p.x0 - q.x0).slice(0, rng.int(3, 6));
  let smashed = 0;
  const f = a.f0 || 0;
  for (const h of row) for (let y = h.y0; y < h.y0 + h.h; y++) for (let x = h.x0; x < h.x0 + h.w; x++) {
    const c = ctx.at(f, x, y);
    if (c && c.k === "window" && rng.chance(0.7)) { c.k = "smashed"; delete c.win; ctx.out.pieces.push({ f, x, y, k: "smashed" }); smashed++; }
  }
  if (!smashed) return null;
  const fr = row[0].front || { x: row[0].x0, y: row[0].y0 };
  ctx.trail(f, fr.x, fr.y + 1, fr.x + 12, fr.y + 1, "human");
  const room = ctx.rooms.find((r) => r.house === row[0].k && (r.f || 0) === f) || null;
  return ctx.done("looterstrail", room, fr.x, fr.y, `Looters went down this row: ${smashed} storefront window${smashed > 1 ? "s" : ""} smashed in, the racks behind them stripped, blood along the walk.`);
}
registerScene("mallcamp", { w: 3, place: mallCamp, when: isMall });
registerScene("foodcourtoverrun", { w: 3, place: foodCourtOverrun, when: isMall });
registerScene("cinemasealed", { w: 3, place: cinemaSealed, when: isMall });
registerScene("concoursebarricade", { w: 2, place: concourseBarricade, when: isMall });
registerScene("looterstrail", { w: 3, place: lootersTrail, when: isMall });
export const MALL_SCENES = ["mallcamp", "foodcourtoverrun", "cinemasealed", "concoursebarricade", "looterstrail"];
// A mall's scenes come oftener than a house's (many rooms, many people sheltered there).
SCENES.ODDS.regionalmall = SCENES.ODDS.regionalmall ?? 0.95;
SCENES.ODDS.stripmall = SCENES.ODDS.stripmall ?? 0.75;
SCENES.ODDS.outlet = SCENES.ODDS.outlet ?? 0.75;
