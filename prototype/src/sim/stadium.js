// @ts-check
// Sports stadiums and arenas (the user's request 2026-10-26, issue #57 of the round-2 epic #39: "different sports
// stadiums 500x500 max"): one raid map of the whole venue, built on compound.js (the shared multi-building code: the
// buildings copied onto one grid, turned to face out from the field) as #30's malls and #28's campuses are.
//
// THE VENUES (STADIUM_VARIANTS, registered with the shared picker as "stadium": variantpick.js, #41): a pro football
// stadium, a baseball ballpark, a soccer stadium, a basketball and hockey arena, a college football stadium, a high
// school stadium with its bleachers, a minor league ballpark, a speedway with its grandstand and pit garages, a horse
// racetrack with its stables, an indoor sports complex, a tennis centre and a county rodeo arena. Each is a plan of its
// own (its field, which sides have stands, how many storeys, its extra buildings, its lots), picked by where it stands:
// placement.js placementCtx (#42's table: the pro venues downtown, a town's high school and minor league ballpark, a
// rodeo in the country); its size row is data-buildingsize.js REAL_SIZE.stadium.sizes[vid] (the venue's footprint, the
// stands round the field, in metres, and its storeys). spec.vid / spec.vname are the venue's (#40).
//
// WHAT EACH HAS:
//   - the bowl or grandstand: stand buildings round the field (a bowl of four, a horseshoe, two sides, one grandstand),
//     each a building of its own (buildingmaps.js assemble) turned to face out: along the field side the stands, in
//     sections of fixed seats on every storey (the upper decks above), the field side's wall a railing (gaps down to
//     the field on the ground floor); behind them the concourse (the stairs at its ends) with the concession stands,
//     their storerooms and the restrooms along the outer wall; on the ground floor of the main stand the gates with
//     their turnstiles, the ticket office, the team store, the first-aid room and stadium security on the outer wall,
//     and between the concourse and the seats the home and visitors' locker rooms, the trainers' room, the coaches'
//     office, the equipment room, the groundskeepers' room and the media room either side of the players' tunnel, which
//     runs through the stand out onto the field; upstairs on the main stand the luxury suites and the press box on the
//     field side (their glass where the railing is);
//   - an arena or an indoor complex is one building: the court (or the rink, or several courts) in the middle with the
//     seats round it, the concourse in front, the team's rooms behind; upstairs the floor open to the court below;
//   - the field painted on the ground (a gridiron with its goalposts, a pitch with its goals, a diamond's dirt infield,
//     a running track, an oval of road or dirt, a rodeo's fenced dirt arena, the tennis courts with their nets);
//   - the plaza round it, the parking lots (compound.js parkingLot: cars to search) and on the big ones a parking garage
//     (#28's BUILDINGS.parkgarage), the road along the south, the ways out (STADIUM.ZONES).
// Scenes (stadiumlayout.js): a FEMA shelter on the field, a last stand on a concourse; the usual ones in the rooms.
// Older saves: no stadium stands in one (they come from #42's placement table, a new world's only). The same venue is
// the same map every visit (its dice from the seed, the tile, the option).
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";
import { registerVariants, pickVariant } from "./variantpick.js"; // the shared picker (issue #41)
import { BUILDINGS, assemble } from "./buildingmaps.js";
import { REAL_SIZE } from "./data-buildingsize.js";
import { placementCtx, placing } from "./placement.js"; // #42: where it stands, the size its variant takes there
import { compoundGrid, placeBuilding, guard, parkingLot, compoundResult, compoundVehicle } from "./compound.js";

export const STADIUM = {
  CAP: 500,        // battlesize.js MAP_CAP.stadium: the venue's map at most 500 × 500
  EDGE: 3,         // ground at the map's edges
  PLAZA: 10,       // the plaza round the bowl
  ROAD: 7,         // the road along the south
  SEC: 15,         // a section of the stands about this wide
  BAND: { fd: 6, cw: 4, td: 8 }, // a stand's outer band, its concourse and the main stand's team band (cells)
  MAIN_MIN: 30,    // the main stand at least this deep (its bands, the team's rooms and some rows of seats)
  STAND_MIN: 18,   // any other stand
  LOT: 46,         // a parking lot's depth (north) or width (east, west)
  GARAGE: 0.7,     // a pro venue's parking garage on a lot
  CARS: 0.35,      // the bays with a car left in them
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const seedOf = (state, ...k) => Math.floor(hash01(state.seed, "stadium", ...k) * 4294967296);
const roll = (rng, r) => (Array.isArray(r) ? rng.int(r[0], r[1]) : r);

// ---------------------------------------------------------------------------------------------------------------------
// The rooms (assemble's leaves; stad: their style in stadiumlayout.js).
// ---------------------------------------------------------------------------------------------------------------------
const Rm = (role, name, stad, o = {}) => ({ role, name, ...(stad ? { stad } : {}), ...o });
const ROOM = {
  gate: () => Rm("gate", "Gates", "gate", { entry: true }),
  ticket: () => Rm("office", "Ticket office", "ticket", { type: "office", boxLock: ["safe", 0.5], maxBoxes: 3 }),
  conc: () => Rm("concession", "Concession stand", "concession"),
  store: () => Rm("storage", "Concessions storeroom", "concstore", { type: "concstore", maxBoxes: 5, windows: false }),
  men: () => Rm("restroom", "Men's restroom", "restroom"),
  women: () => Rm("restroom", "Women's restroom", "restroom"),
  shop: (name = "Team store") => Rm("sales", name, "proshop", { type: "proshop", hub: false, maxBoxes: 5 }),
  aid: () => Rm("nurse", "First-aid room", "firstaid", { type: "nurse", maxBoxes: 3 }),
  sec: () => Rm("office", "Stadium security", "security", { type: "stadsec", maxBoxes: 3, lock: ["door", 0.3] }),
  home: (name = "Home locker room") => Rm("lockerroom", name, "locker", { type: "lockers", maxBoxes: 5 }),
  away: (name = "Visitors' locker room") => Rm("lockerroom", name, "locker", { type: "lockers", maxBoxes: 4 }),
  train: () => Rm("nurse", "Trainers' room", "training", { type: "nurse", maxBoxes: 3 }),
  equip: () => Rm("storage", "Equipment room", "equip", { type: "lockers", maxBoxes: 4 }),
  coach: () => Rm("office", "Coaches' office", "manager", { type: "office", maxBoxes: 2 }),
  media: () => Rm("office", "Media room", "manager", { type: "pressbox", maxBoxes: 2 }),
  press: () => Rm("office", "Press box", "pressbox", { type: "pressbox", maxBoxes: 3, glass: true }),
  suite: (i) => Rm("suite", `Luxury suite ${i}`, "suite", { lock: ["door", 0.25], glass: true }),
  grounds: () => Rm("workshop", "Groundskeeping", "grounds", { type: "groundskeep", maxBoxes: 4 }),
  tunnel: () => Rm("corridor", "Players' tunnel", null, { hub: true, tunnel: true }),
  concourse: (f) => Rm("concourse", f ? `Concourse, level ${f + 1}` : "Concourse", null, { hub: true }),
  stands: (name, face, seat) => Rm("stands", name, "stands", { face, ...(seat ? { seat } : {}) }),
  court: (name, sport) => Rm("gym", name, "court", { hub: true, sport, type: null, maxBoxes: 0, fl: sport === "hockey" ? "conc" : "hardwood" }),
  overlook: () => Rm("hall", "Open to the floor below", "overlook", { hub: true, label: false }),
};
const FILL = [[8, ROOM.conc], [5, ROOM.men], [5, ROOM.women], [8, ROOM.conc], [6, ROOM.store]];

// A band of rooms across `inner` cells: the specials ([w, leaf]) spread among fillers cycled from `fill`, the last "*".
/** @param {number} inner @param {any[]} specials @param {any[]} [fill] */
function band(inner, specials, fill = FILL) {
  let left = inner + 1 - specials.reduce((a, [w]) => a + w + 1, 0), i = 0;
  const fillers = [];
  while (left >= fill[i % fill.length][0] + 4) { const [w, mk] = fill[i % fill.length]; fillers.push([w, mk()]); left -= w + 1; i++; }
  /** @type {any[]} */
  const out = [];
  let fi = 0;
  specials.forEach((s, k) => { const upto = Math.round(((k + 1) * fillers.length) / (specials.length + 1)); while (fi < upto) out.push(fillers[fi++]); out.push(s); });
  while (fi < fillers.length) out.push(fillers[fi++]);
  if (!out.length) out.push(["*", fill[0][1]()]);
  out[out.length - 1] = ["*", out[out.length - 1][1]];
  return { split: "x", parts: out };
}
// Sections of the stands across (or down: split "y") `len` cells, numbered from n0.
function sections(len, f, face, seat, n0, split = "x") {
  const k = Math.max(1, Math.floor((len + 1) / (STADIUM.SEC + 1)));
  return { split, parts: Array.from({ length: k }, (_, i) => ["*", ROOM.stands(`Section ${(f + 1) * 100 + n0 + i}`, face, seat)]) };
}
const X = (...parts) => ({ split: "x", parts });
const Y = (...parts) => ({ split: "y", parts });
const SIDE_EXITS = [{ side: "left", roles: ["concourse"], chance: 0.9, lock: 0.2, name: "Concourse gate" }, { side: "right", roles: ["concourse"], chance: 0.9, lock: 0.2, name: "Concourse gate" }];
const STAIRS = { roles: ["concourse"], n: 2, len: 2, ends: true };

// ---------------------------------------------------------------------------------------------------------------------
// A stand: len cells along the field, depth from the outer wall to the field side, its storeys. o.main: the main
// stand (the gates, the ticket office, the store, first aid, security; the team's rooms and the tunnel; the suites and
// the press box upstairs); o.seat: "bleachers"; o.n0: its sections' first number; o.names: the venue's own room names.
// Built facing +y (its front the outer wall); its back (y small) is the field side.
// ---------------------------------------------------------------------------------------------------------------------
export function standSpec(rng, len, depth, storeys, o = {}) {
  const B = STADIUM.BAND, inner = len - 2, nm = o.names || {}, seat = o.seat || null, n0 = o.n0 || 1;
  const front0 = o.main
    ? band(inner, [[10, ROOM.gate()], [8, ROOM.ticket()], [12, ROOM.shop(nm.shop)], [7, ROOM.aid()], [8, ROOM.sec()]])
    : band(inner, inner >= 80 ? [[10, ROOM.gate()], [8, ROOM.aid()]] : [[10, ROOM.gate()]]);
  const half = Math.floor((inner - 6) / 2);
  const wide = half >= 40; // a narrow stand (a tennis centre's, a rodeo's) keeps the rooms it must have
  const teamL = wide ? X(["*", ROOM.home(nm.home)], [8, ROOM.train()], [6, ROOM.coach()]) : X(["*", ROOM.home(nm.home)], [7, ROOM.train()], [7, ROOM.grounds()]);
  const teamR = wide ? X(["*", ROOM.away(nm.away)], [7, ROOM.equip()], [8, ROOM.grounds()], [7, ROOM.media()]) : X(["*", ROOM.away(nm.away)], [7, ROOM.equip()]);
  const back0 = o.main
    ? X(["*", Y([B.td, teamL], ["*", sections(half, 0, "n", seat, n0)])], [6, ROOM.tunnel()], ["*", Y([B.td, teamR], ["*", sections(half, 0, "n", seat, n0 + 10)])])
    : sections(inner, 0, "n", seat, n0);
  const upperSeats = (f, top) => {
    if (!o.main) return sections(inner, f, "n", seat, n0);
    const k = clamp(Math.floor((inner - 40) / 14), 1, 6), suites = Array.from({ length: k }, (_, i) => [6, ROOM.suite(f * 10 + i + 1)]);
    /** @type {any[]} */
    const mid = top ? [[16, ROOM.press()], ...(f === 1 ? suites : [])] : suites;
    const side = Math.floor((inner - mid.reduce((a, [w]) => a + w + 1, 0)) / 2);
    return X(["*", sections(side, f, "n", seat, n0)], ...mid, ["*", sections(side, f, "n", seat, n0 + 10)]);
  };
  depth = Math.max(depth, o.main ? STADIUM.MAIN_MIN : STADIUM.STAND_MIN);
  return {
    bw: len, bh: depth, front: { width: 3 }, ground: "town", storeys, foot: len * depth >= 1800 && len >= 50 ? "huge" : "large", stairs: storeys > 1 ? STAIRS : null, extraDoors: 0.05,
    program: Y([B.fd, front0], [B.cw, ROOM.concourse(0)], ["*", back0]),
    upper: storeys > 1 ? (f, r, ctx) => Y([B.fd, band(inner, f === 1 && o.main ? [[8, ROOM.sec()]] : [])], [B.cw, ROOM.concourse(f)], ["*", upperSeats(f, !!(ctx && ctx.top))]) : null,
    exits: SIDE_EXITS,
  };
}

// An arena: the court (or rink) in the middle, the seats on its four sides, the concourse in front, the team's rooms
// behind; upstairs the suites and the press box over the front seats, the floor open to the court. o.courts: an indoor
// complex's several courts in a row, small stands before each, the floor above open over them all.
export function arenaSpec(rng, bw, bh, storeys, o = {}) {
  const B = STADIUM.BAND, inner = bw - 2, sd = o.sd || 10, bd = 8, sport = o.sport || "basketball", nm = o.names || {};
  const courtName = sport === "hockey" ? "Rink" : o.courts ? "Court" : "Arena floor";
  const front0 = band(inner, [[10, ROOM.gate()], [8, ROOM.ticket()], [12, ROOM.shop(nm.shop)], [7, ROOM.aid()], [8, ROOM.sec()]]);
  const back0 = X(["*", ROOM.home(nm.home)], [8, ROOM.train()], [6, ROOM.coach()], [6, ROOM.tunnel()], ["*", ROOM.away(nm.away)], [7, ROOM.equip()], [8, ROOM.grounds()], [7, ROOM.media()]);
  let mid, upMid;
  if (o.courts) {
    const k = o.courts, col = (i) => ["*", Y([6, ROOM.stands(`Court ${i + 1} bleachers`, "n", "bleachers")], ["*", ROOM.court(`${courtName} ${i + 1}`, i === k - 1 && o.turf ? "turf" : sport)])];
    mid = X(...Array.from({ length: k }, (_, i) => col(i)));
    upMid = ROOM.overlook();
  } else {
    const side = (f, face, n0) => sections(bh - B.fd - B.cw - bd - 2 * sd - 8, f, face, null, n0, "y");
    mid = Y([sd, sections(inner, 0, "n", null, 1)], ["*", X([sd, side(0, "e", 30)], ["*", ROOM.court(courtName, sport)], [sd, side(0, "w", 40)])], [sd, sections(inner, 0, "s", null, 20)]);
    upMid = null;
  }
  const upper = (f, r, ctx) => {
    const top = !!(ctx && ctx.top);
    if (o.courts) return Y([B.fd, band(inner, [[16, ROOM.press()], [6, ROOM.suite(f * 10 + 1)], [6, ROOM.suite(f * 10 + 2)]])], [B.cw, ROOM.concourse(f)], [6, sections(inner, f, "n", "bleachers", 1)], ["*", upMid], [bd, band(inner, [])]); // the balcony's bleachers over the courts
    const k = clamp(Math.floor((inner - 40) / 14), 1, 5), suites = Array.from({ length: k }, (_, i) => [6, ROOM.suite(f * 10 + i + 1)]);
    const frontRow = X(["*", sections(20, f, "n", null, 1)], ...(top ? [[16, ROOM.press()]] : []), ...suites, ["*", sections(20, f, "n", null, 11)]);
    const side = (face, n0) => sections(bh - B.fd - B.cw - bd - 2 * sd - 8, f, face, null, n0, "y");
    return Y([B.fd, band(inner, [])], [B.cw, ROOM.concourse(f)], [sd, frontRow], ["*", X([sd, side("e", 30)], ["*", ROOM.overlook()], [sd, side("w", 40)])], [sd, sections(inner, f, "s", null, 20)], [bd, band(inner, [])]);
  };
  return {
    bw, bh, front: { width: 3 }, ground: "town", storeys, foot: "huge", stairs: storeys > 1 ? STAIRS : null, extraDoors: 0.05,
    program: Y([B.fd, front0], [B.cw, ROOM.concourse(0)], ["*", mid], [bd, back0]),
    upper: storeys > 1 ? upper : null,
    exits: [...SIDE_EXITS, { side: "back", roles: ["lockerroom", "corridor", "storage", "workshop"], chance: 1, lock: 0.3, name: "Players' entrance" }],
  };
}

// A plain block of rooms (a front row, a corridor, a back row): a speedway's pit garages, a racetrack's stables, a
// rodeo's livestock barn. rooms: [[w, leaf maker]...] front and back.
function blockSpec(bw, bh, front, back, o = {}) {
  const inner = bw - 2, row = (list) => band(inner, [], list);
  return {
    bw, bh, front: { width: o.door || 2, ...(o.roller ? { roller: true } : {}) }, ground: "town", storeys: 1, foot: bw * bh >= 1800 && bw >= 50 ? "huge" : bw * bh >= 290 ? "large" : "medium", stairs: null,
    program: Y([Math.floor((bh - 5) / 2), row(front)], [3, Rm("corridor", o.corridor || "Corridor", null, { hub: true })], ["*", row(back)]),
    exits: [{ side: "left", roles: ["corridor"], chance: 0.9, lock: 0.2 }, { side: "right", roles: ["corridor"], chance: 0.9, lock: 0.2 }],
  };
}
const BAY = () => Rm("bays", "Pit garage", null, { type: "garage", maxBoxes: 2 });
const STALL = () => Rm("barnfloor", "Stalls", null, { type: "barn", maxBoxes: 2 });
const TACK = () => Rm("tack", "Tack room", null, { type: "barn", maxBoxes: 2 });
const FEED = () => Rm("storage", "Feed room", null, { type: "barn", maxBoxes: 3 });
const RACECTRL = () => Rm("office", "Race control", "pressbox", { type: "pressbox", maxBoxes: 2 });
const FUEL = () => Rm("workshop", "Fuel store", "grounds", { type: "groundskeep", maxBoxes: 3 });

// ---------------------------------------------------------------------------------------------------------------------
// The venues (the shared picker's "stadium"): their weights by tile class (#42), their size class, their foot, and the
// plan: form (bowl | oval | arena | complex), field (w × h cells and its sport), the stands by side (depth from the
// size row, storeys, a share of the side's length: span), the extra buildings, the lots.
// ---------------------------------------------------------------------------------------------------------------------
const FOOTBALL = { w: 130, h: 64, sport: "football" };
/** @type {any[]} */
export const STADIUM_VARIANTS = [
  { id: "profootball", lot: 92, name: "Pro football stadium", w: { centre: 3, city: 2 }, sizeClass: "huge", form: "bowl", field: FOOTBALL,
    stands: { s: { main: true }, n: {}, e: { end: true }, w: { end: true } }, lots: 3, garage: true, names: { shop: "Team store" } },
  { id: "ballpark", lot: 80, name: "Baseball ballpark", w: { centre: 2.5, city: 2 }, sizeClass: "huge", form: "bowl", field: { w: 120, h: 116, sport: "baseball" },
    stands: { s: { main: true }, e: { span: 0.55, end: true }, w: { span: 0.55, end: true }, n: { storeys: 1, seat: "bleachers", depth: 18, name: "Outfield bleachers" } }, lots: 3, garage: true, names: { home: "Home clubhouse", away: "Visitors' clubhouse" } },
  { id: "soccer", lot: 60, name: "Soccer stadium", w: { centre: 2, city: 2 }, sizeClass: "huge", form: "bowl", field: { w: 113, h: 76, sport: "soccer" },
    stands: { s: { main: true }, n: {}, e: { end: true }, w: { end: true } }, lots: 2, garage: false, names: { home: "Home dressing room", away: "Away dressing room", shop: "Club shop" } },
  { id: "arena", lot: 70, name: "Basketball and hockey arena", w: { centre: 3, city: 2 }, sizeClass: "huge", form: "arena", sport: "hockey", lots: 3, garage: true },
  { id: "college", name: "College football stadium", w: { city: 0.5, suburb: 1.5, town: 1.5 }, sizeClass: "large", form: "bowl", field: FOOTBALL,
    stands: { s: { main: true }, n: {}, e: { end: true, storeys: 1, seat: "bleachers" } }, lots: 2, garage: false, names: { shop: "Campus team shop" } },
  { id: "highschool", name: "High school stadium", w: { suburb: 1.5, town: 3 }, sizeClass: "large", form: "bowl", field: { w: 156, h: 84, sport: "track" },
    stands: { s: { main: true, seat: "bleachers" } }, bleachers: "n", lots: 1, garage: false, names: { shop: "Spirit shop", home: "Home team locker room" } },
  { id: "minorleague", name: "Minor league ballpark", w: { suburb: 1, town: 2, highway: 1 }, sizeClass: "large", form: "bowl", field: { w: 100, h: 96, sport: "baseball" },
    stands: { s: { main: true }, e: { span: 0.5, end: true, storeys: 1 }, w: { span: 0.5, end: true, storeys: 1 } }, lots: 2, garage: false, names: { home: "Home clubhouse", away: "Visitors' clubhouse" } },
  { id: "speedway", lot: 80, name: "Speedway", w: { suburb: 0.5, town: 0.6, highway: 3 }, sizeClass: "large", form: "oval", field: { R: 54, a: 92, band: 16, sport: "speedway" },
    stands: { s: { main: true, span: 0.7 } }, extra: "pits", lots: 3, garage: false, names: { home: "Drivers' lounge", away: "Crew locker room", shop: "Souvenir shop" } },
  { id: "horse", lot: 60, name: "Horse racetrack", w: { suburb: 0.8, town: 0.6, highway: 2 }, sizeClass: "large", form: "oval", field: { R: 44, a: 78, band: 13, sport: "horse" },
    stands: { s: { main: true, span: 0.6 } }, extra: "stables", lots: 2, garage: false, names: { home: "Jockeys' room", away: "Valets' room", shop: "Gift shop" } },
  { id: "complex", name: "Indoor sports complex", w: { city: 0.6, suburb: 2, town: 1.2 }, sizeClass: "large", form: "complex", sport: "basketball", lots: 2, garage: false, names: { shop: "Pro shop", home: "Men's locker room", away: "Women's locker room" } },
  { id: "tennis", name: "Tennis centre", w: { city: 0.8, suburb: 1.5, town: 0.4 }, sizeClass: "large", form: "bowl", field: { w: 40, h: 26, sport: "tennis" },
    stands: { s: { main: true }, n: {}, e: { end: true }, w: { end: true } }, outer: true, lots: 1, garage: false, names: { home: "Players' locker room", away: "Officials' room", shop: "Pro shop" } },
  { id: "rodeo", name: "Rodeo arena", w: { town: 0.5, highway: 1, rural: 3, scenic: 2, coast: 1 }, sizeClass: "medium", form: "bowl", field: { w: 84, h: 48, sport: "rodeo" },
    stands: { s: { main: true, seat: "bleachers" } }, bleachers: "n", extra: "barn", lots: 1, garage: false, names: { home: "Cowboys' locker room", away: "Contestants' room", shop: "Western shop" } },
];
for (const V of STADIUM_VARIANTS) { V.size = V.id; V.make = (rng, o) => mainSpec(rng, V, o); const S = sizeRow(V); V.foot = [S.w[1], S.d[1], S.storeys[1]]; }
registerVariants("stadium", STADIUM_VARIANTS);
function sizeRow(V) { return (REAL_SIZE.stadium && REAL_SIZE.stadium.sizes && REAL_SIZE.stadium.sizes[V.id]) || { w: [200, 200], d: [140, 140], storeys: [2, 2] }; }

// The venue's dims from its size row: its storeys, the stands' depths (the long sides', the ends'), an arena's footprint.
function dimsOf(rng, V) {
  const S = sizeRow(V), W = roll(rng, S.w), D = roll(rng, S.d), storeys = roll(rng, S.storeys);
  if (V.form === "arena" || V.form === "complex") return { W, D, storeys };
  const F = fieldOf(V);
  const st = V.stands, ends = (st.e && !st.e.depth) || (st.w && !st.w.depth);
  const sides = (st.s ? 1 : 0) + (st.n && !st.n.depth ? 1 : 0);
  const ds = clamp(Math.round((D - F.h - (st.n && st.n.depth ? st.n.depth : 0)) / Math.max(1, sides)), 22, 44);
  const de = ends ? clamp(Math.round((W - F.w) / ((st.e ? 1 : 0) + (st.w ? 1 : 0))), 16, 40) : 0;
  return { W, D, storeys, ds, de };
}
const fieldOf = (V) => (V.form === "oval" ? { w: 2 * (V.field.a + V.field.R), h: 2 * V.field.R } : V.field);

// The main building's spec (BUILDINGS.stadium.make: the archetype tests, the hint): the main stand, or the arena.
export function mainSpec(rng, V, o = {}) {
  const d = dimsOf(rng, V);
  let spec;
  if (V.form === "arena") spec = arenaSpec(rng, d.W, d.D, d.storeys, { sport: V.sport, names: V.names });
  else if (V.form === "complex") spec = arenaSpec(rng, d.W, d.D, d.storeys, { sport: V.sport, courts: rng.int(3, 4), turf: rng.chance(0.5), names: V.names });
  else { const F = fieldOf(V), s = V.stands.s; spec = standSpec(rng, Math.round(F.w * (s.span || 1)), s.depth || d.ds, s.storeys || d.storeys, { main: true, seat: s.seat, names: V.names }); }
  if (!o.legacy) Object.assign(spec, { vid: V.id, vname: V.name });
  return spec;
}

/** The venue a site holds (the picker: placementCtx, or the setting a caller pins; option.plan an id). */
export function venueFor(state, tile, option = {}, rng) {
  const s = option.setting ? (option.setting === "city" ? "city" : option.setting === "town" ? "town" : "rural") : null;
  const ctx = s ? { setting: s, tileClass: s } : tile && state && placing(state) ? placementCtx(state, tile, "stadium") : {};
  return pickVariant("stadium", rng, { ...ctx, plan: option.plan ?? option.layout ?? null }) || STADIUM_VARIANTS[0];
}

// ---------------------------------------------------------------------------------------------------------------------
// The map.
// ---------------------------------------------------------------------------------------------------------------------
const FACE_OF = { s: "s", n: "n", e: "e", w: "w" };
const STAND_NAME = { s: "Main grandstand", n: "North stand", e: "East stand", w: "West stand" };
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// The stand's field side opened up on its own map before it is copied in: the seats' wall a railing (two cells open
// onto the field on the ground floor), the suites' and the press box's glass, the tunnel's end open.
function openFieldSide(m) {
  const B = m.building, W = m.w;
  (m.floors || [{ cells: m.cells }]).forEach((F, g) => {
    for (const a of m.rooms) {
      if (a.outdoor || (a.f || 0) !== g) continue;
      const face = a.face || (a.role === "stands" || a.glass || a.tunnel ? "n" : null);
      if (!face) continue;
      const line = [];
      const x0 = a.x0, y0 = a.y0, x1 = a.x0 + a.w - 1, y1 = a.y0 + a.h - 1;
      if (face === "n") for (let x = x0 + 1; x < x1; x++) line.push([x, y0]);
      else if (face === "s") for (let x = x0 + 1; x < x1; x++) line.push([x, y1]);
      else if (face === "w") for (let y = y0 + 1; y < y1; y++) line.push([x0, y]);
      else for (let y = y0 + 1; y < y1; y++) line.push([x1, y]);
      const outer = face === "n" && y0 === B.y0;
      if (!outer && a.role !== "stands") continue; // the suites' glass and the tunnel only on the outer wall
      const mid = Math.floor(line.length / 2);
      line.forEach(([x, y], i) => {
        const c = F.cells[y * W + x];
        if (!c || (c.k !== "wall" && c.k !== "window" && c.k !== "smashed")) return;
        delete c.win;
        if (a.tunnel) { if (g === 0) { c.k = "open"; c.f = "floor"; c.fl = "conc"; } return; }
        if (a.glass) { c.k = "window"; return; }
        if (g === 0 && (i === mid || i === mid - 1)) { c.k = "open"; c.f = "floor"; c.fl = "conc"; } // the steps down to the field
        else { c.k = "rail"; c.f = "floor"; c.fl = "conc"; }
      });
    }
  });
}

/**
 * The map of a venue (buildingmaps.js buildingMap, for BUILDINGS.stadium): the same every visit.
 * @param {any} state @param {number} tileId @param {{ id: string, key: string, name: string, [k: string]: any }} option @param {any} withVehicle
 */
export function stadiumMap(state, tileId, option, withVehicle) {
  const S = STADIUM, tile = state.tiles ? state.tiles[tileId] : null;
  const rng = new Rng(seedOf(state, "map", tileId, option.id) || 1);
  const V = venueFor(state, tile, option, rng);
  const d = dimsOf(rng, V);
  const indoor = V.form === "arena" || V.form === "complex";
  /** @type {any[]} */
  const built = []; // { key, name, spec, face, x0, y0 (placed), role }
  const make = (spec, k) => { spec.margins = { front: 1, back: 1, left: 1, right: 1 }; spec.ground = "none"; const hr = new Rng(seedOf(state, "bldg", tileId, option.id, k) || 1); return { hr, spec }; };
  // ---------- the field and the stands round it (sizes first: the map's size follows) ----------
  const F = indoor ? { w: d.W, h: d.D } : fieldOf(V);
  const st = V.stands || {};
  const depth = { s: 0, n: 0, e: 0, w: 0 };
  /** @type {Record<string, any>} */
  const stands = {};
  if (!indoor) for (const side of ["s", "n", "e", "w"]) {
    const o = st[side];
    if (!o) continue;
    const long = side === "s" || side === "n";
    const len = Math.round((long ? F.w : F.h) * (o.span || 1));
    const dep = Math.max(o.depth || (long ? d.ds : d.de), o.main ? S.MAIN_MIN : S.STAND_MIN);
    const storeys = o.storeys || (o.main ? d.storeys : Math.max(1, d.storeys - (o.end ? 1 : 0)));
    const spec = standSpec(rng, len, dep, storeys, { main: !!o.main, seat: o.seat, names: V.names, n0: { s: 1, w: 20, n: 40, e: 60 }[side] });
    stands[side] = { side, len, dep, storeys, spec, name: o.name || (o.main ? (V.form === "oval" ? "Grandstand" : STAND_NAME.s) : STAND_NAME[side]) };
    depth[side] = dep;
  }
  // The extra buildings (beyond the field, north of it): the pits, the stables, the barn.
  /** @type {any[]} */
  const extras = [];
  if (V.extra === "pits") extras.push({ name: "Pit garages", spec: blockSpec(rng.int(90, 120), 22, [[7, BAY], [7, BAY], [7, BAY], [8, RACECTRL]], [[7, BAY], [7, BAY], [7, BAY], [8, FUEL]], { corridor: "Pit lane corridor", door: 3, roller: true }), infield: true });
  if (V.extra === "stables") for (let i = 0; i < 2; i++) extras.push({ name: i ? "Stable B" : "Stable A", spec: blockSpec(rng.int(60, 72), 18, [[8, STALL], [8, STALL], [6, TACK]], [[8, STALL], [8, STALL], [6, FEED]], { corridor: "Barn aisle", door: 3 }) });
  if (V.extra === "barn") extras.push({ name: "Livestock barn", spec: blockSpec(rng.int(40, 48), 20, [[8, STALL], [6, TACK]], [[8, STALL], [6, FEED]], { corridor: "Barn aisle", door: 3 }) });
  const exH = extras.filter((e) => !e.infield).reduce((a, e) => Math.max(a, e.spec.bh), 0);
  // ---------- the map's size ----------
  const lots = V.lots || 1;
  const LOT = V.lot || S.LOT;
  let lotN = lots >= 1 ? LOT : 0, lotW = lots >= 2 ? LOT : 0, lotE = lots >= 3 ? LOT : 0;
  const outer = V.outer ? 92 : 0; // a tennis centre's outer courts to the east
  const bowlW = depth.w + F.w + depth.e, bowlH = depth.n + F.h + depth.s;
  const needW = () => S.EDGE * 2 + lotW + S.PLAZA * 2 + bowlW + lotE + outer, needH = () => S.EDGE + lotN + (exH ? exH + 6 : 0) + S.PLAZA * 2 + bowlH + S.ROAD + 6;
  // Within the cap: the lots give way (the east one first, then the west, then the north), never the bowl.
  for (const cut of [() => (lotE = Math.max(0, lotE - (needW() - S.CAP))), () => (lotW = Math.max(0, lotW - (needW() - S.CAP)))]) if (needW() > S.CAP) cut();
  if (needH() > S.CAP) lotN = Math.max(0, lotN - (needH() - S.CAP));
  if (lotE && lotE < 20) lotE = 0;
  if (lotW && lotW < 20) lotW = 0;
  const W = clamp(needW(), 120, S.CAP), H = clamp(needH(), 100, S.CAP);
  const fx = S.EDGE + lotW + S.PLAZA + depth.w, fy = S.EDGE + lotN + (exH ? exH + 6 : 0) + S.PLAZA + depth.n;
  const storeys = Math.max(1, ...Object.values(stands).map((s) => s.storeys), indoor ? d.storeys : 1);
  const C = compoundGrid(W, H, storeys, () => "grass");
  const cells = C.cells, keep = C.keep, I = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const paint = (x0, y0, w, h, f, mark = false) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (inside(x, y)) { cells[I(x, y)].f = f; if (mark) keep[I(x, y)] = 1; } };
  const roadY = H - S.ROAD - 3;
  // ---------- the ground: the plaza, the road, the field ----------
  paint(fx - depth.w - S.PLAZA, fy - depth.n - S.PLAZA, bowlW + 2 * S.PLAZA, bowlH + 2 * S.PLAZA, "paving");
  paint(0, roadY, W, S.ROAD, "road", true);
  paint(0, roadY - 1, W, 1, "gravel", true); paint(0, roadY + S.ROAD, W, 1, "gravel", true);
  const field = indoor ? null : { x0: fx, y0: fy, w: F.w, h: F.h };
  if (!indoor) paintField(V, field, paint, cells, I);
  // ---------- the buildings ----------
  let k = 0;
  const place = (spec, x0, y0, face, name, role) => {
    const { hr } = make(spec, k);
    const m = assemble(hr, spec, { key: "stadium", id: `${option.id}#${k + 1}`, name, legacy: false });
    openFieldSide(m);
    const part = placeBuilding(C, m, { x0, y0, face, k, name, key: "stadium", tag: { part: { role } } });
    k++;
    return part;
  };
  /** @type {any[]} */
  const parts = [];
  if (indoor) {
    const spec = mainSpecAt(rng, V, d);
    parts.push(place(spec, fx, fy, "s", V.form === "complex" ? "Sports complex" : "Arena", "main"));
  } else {
    for (const side of ["s", "n", "e", "w"]) {
      const s = stands[side];
      if (!s) continue;
      const long = side === "s" || side === "n";
      const off = Math.round(((long ? F.w : F.h) - s.len) * (side === "s" || side === "n" ? 0.5 : 1)); // a short side stand toward home (the south end)
      const x0 = side === "s" || side === "n" ? fx + off : side === "e" ? fx + F.w : fx - s.dep;
      const y0 = side === "s" ? fy + F.h : side === "n" ? fy - s.dep : fy + off;
      parts.push(place(s.spec, x0, y0, FACE_OF[side], s.name, side === "s" ? "main" : "stand"));
    }
    let ex = fx;
    for (const e of extras) {
      if (e.infield) { parts.push(place(e.spec, fx + Math.floor((F.w - e.spec.bw) / 2), fy + Math.floor((F.h - e.spec.bh) / 2), "s", e.name, "extra")); continue; }
      parts.push(place(e.spec, ex, fy - depth.n - S.PLAZA - e.spec.bh - 2, "s", e.name, "extra"));
      ex += e.spec.bw + 8;
    }
  }
  // A pro venue's parking garage on the north lot.
  const GARAGE = /** @type {any} */ (BUILDINGS).parkgarage; // #28's parking garage
  const garage = V.garage && lotN && rng.chance(S.GARAGE) && GARAGE;
  let garageRect = null;
  if (garage) {
    const hr = new Rng(seedOf(state, "garage", tileId, option.id) || 1);
    const spec = GARAGE.make(hr, {});
    if (spec.bh <= lotN - 4 && spec.bw <= 120) {
      spec.margins = { front: 1, back: 1, left: 1, right: 1 }; spec.ground = "none";
      const m = assemble(hr, spec, { key: "parkgarage", id: `${option.id}#garage`, name: "Parking garage", legacy: false });
      if ((m.storeys || 1) <= storeys) {
        const gx = S.EDGE + lotW + 4, gy = S.EDGE + 2;
        parts.push(placeBuilding(C, m, { x0: gx, y0: gy, face: "s", k, name: "Parking garage", key: "parkgarage", tag: { part: { role: "garage" } } }));
        garageRect = { x0: gx, y0: gy, w: spec.bw, h: spec.bh };
        k++;
      }
    }
  }
  // Paths from the doors facing out across the plaza.
  for (const p of parts) for (const ex of [p.front, ...p.exits].filter(Boolean)) for (const [x, y] of ex.cells || [[ex.x, ex.y]]) {
    const [dx, dy] = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[ex.side] || [0, 1];
    for (let i = 1; i <= 4; i++) { const xx = x + dx * i, yy = y + dy * i; if (inside(xx, yy) && !C.built[I(xx, yy)]) keep[I(xx, yy)] = 1; }
  }
  // ---------- the guard, the field's pieces, the lots ----------
  const entry0 = [1, roadY + 2];
  const G = guard(C, entry0[0], entry0[1]);
  const piece = (x, y, kd, w = 1, h = 1) => {
    const done = [];
    for (let q = y; q < y + h; q++) for (let p = x; p < x + w; p++) { if (G.block(p, q, kd)) done.push(I(p, q)); else { for (const i of done) { cells[i].k = "open"; G.passAt(i); } return false; } }
    for (const i of done) keep[i] = 1;
    return true;
  };
  if (!indoor) dressField(V, field, piece, G, rng);
  // Open bleachers across from the grandstand (a high school's visitors' side, a rodeo's north rail).
  if (field && V.bleachers === "n") for (let x = fx + 6; x + 1 < fx + F.w - 6; x += 3) piece(x, fy - 4, "bleachers", 2, 2);
  // A tennis centre's outer courts, in rows to the east of the bowl.
  /** @type {any[]} */
  const grounds = [];
  if (V.outer) {
    const ox = fx + F.w + depth.e + S.PLAZA + 4;
    let n = 0;
    for (let cy = fy - depth.n; cy + 20 <= fy + F.h + depth.s; cy += 22) for (let cx = ox; cx + 40 <= Math.min(W - S.EDGE - lotE, ox + outer); cx += 44) {
      paint(cx, cy, 40, 20, "court");
      for (let y = cy + 2; y < cy + 18; y++) G.block(cx + 20, y, "tennisnet");
      grounds.push({ kind: "court", name: `Court ${++n + 1}`, x0: cx, y0: cy, w: 40, h: 20 });
    }
  }
  if (field) grounds.push({ kind: "field", name: V.form === "oval" ? "Infield" : V.field.sport === "tennis" ? "Centre court" : "Field", ...field });
  const lotsMade = [];
  const lotRects = [];
  if (lotN) lotRects.push({ x0: S.EDGE + lotW + (garageRect ? garageRect.w + 8 : 0), y0: S.EDGE, w: W - 2 * S.EDGE - lotW - lotE - (garageRect ? garageRect.w + 8 : 0), h: lotN - 2, name: "North lot" });
  if (lotW) lotRects.push({ x0: S.EDGE, y0: S.EDGE, w: lotW - 2, h: roadY - S.EDGE - 3, name: "West lot" });
  if (lotE) lotRects.push({ x0: W - S.EDGE - lotE + 2, y0: S.EDGE, w: lotE - 2, h: roadY - S.EDGE - 3, name: "East lot" });
  for (const r of lotRects) {
    if (r.w < 16 || r.h < 16) continue;
    const lot = parkingLot(C, G, r, rng, { name: r.name, parked: S.CARS });
    if (lot) { lotsMade.push(lot); grounds.push({ kind: "lot", name: lot.name, x0: r.x0, y0: r.y0, w: r.w, h: r.h }); }
  }
  // ---------- the ways out ----------
  const Z = 3, zy = roadY + 1;
  const zone = (x0, y0, side, name) => ({ x0, y0, w: Z, h: Z, side, exit: side, name, vehicle: false });
  const zones = [
    zone(0, zy, "west", "West end of the road"), zone(W - Z, zy, "east", "East end of the road"),
    zone(Math.floor(W / 2) - 1, 0, "north", "North edge of the grounds"),
    zone(0, Math.floor(roadY / 2), "west", "West edge of the grounds"), zone(W - Z, Math.floor(roadY / 2), "east", "East edge of the grounds"),
  ];
  for (const z of zones) for (let q = z.y0 - 1; q <= z.y0 + z.h; q++) for (let p = z.x0 - 1; p <= z.x0 + z.w; p++) if (inside(p, q)) {
    keep[I(p, q)] = 1;
    const c = cells[I(p, q)];
    if (c.k !== "open" && !C.built[I(p, q)] && !c.car) { c.k = "open"; G.passAt(I(p, q)); }
  }
  // ---------- the result ----------
  const vehicle = compoundVehicle(C, zones[0], withVehicle);
  for (const a of C.areas) {
    if (a.role === "concourse") a.deadW = 2.5;
    else if (a.role === "stands") a.deadW = 1.5;
    else if (a.role === "concession" || a.role === "gym") a.deadW = 2;
  }
  const map = compoundResult(C, {
    key: option.key, id: option.id, name: option.name, zones, vehicle, kind: "stadium",
    extra: { venue: true, vid: V.id, vname: V.name, kindName: V.name, form: V.form, sport: indoor ? V.sport : V.field.sport, indoor, field, grounds, lots: lotsMade.length },
  });
  for (const r of map.plan.rooms) { const a = map.rooms[r.id]; if (a && a.stad) r.stad = a.stad; }
  return Object.assign(map, { venue: true });
}
// The arena's or the complex's building at the dims already rolled.
function mainSpecAt(rng, V, d) {
  return V.form === "complex"
    ? arenaSpec(rng, d.W, d.D, d.storeys, { sport: V.sport, courts: rng.int(3, 4), turf: rng.chance(0.5), names: V.names })
    : arenaSpec(rng, d.W, d.D, d.storeys, { sport: V.sport, names: V.names });
}

// The field's ground by its sport.
function paintField(V, R, paint, cells, I) {
  const sport = V.field.sport;
  if (V.form === "oval") {
    const { R: rad, a, band } = V.field, cx = R.x0 + R.w / 2 - 0.5, cy = R.y0 + R.h / 2 - 0.5;
    const surf = sport === "speedway" ? "road" : "dirt";
    for (let y = R.y0; y < R.y0 + R.h; y++) for (let x = R.x0; x < R.x0 + R.w; x++) {
      const dx = Math.max(0, Math.abs(x - cx) - a), dist = Math.hypot(dx, y - cy);
      cells[I(x, y)].f = dist <= rad && dist > rad - band ? surf : dist <= rad - band ? "grass" : "paving";
    }
    return;
  }
  if (sport === "tennis") { paint(R.x0, R.y0, R.w, R.h, "court"); return; }
  if (sport === "rodeo") { paint(R.x0, R.y0, R.w, R.h, "dirt"); return; }
  paint(R.x0, R.y0, R.w, R.h, "grass");
  if (sport === "track") {
    paint(R.x0, R.y0, R.w, R.h, "track");
    paint(R.x0 + 8, R.y0 + 8, R.w - 16, R.h - 16, "grass");
  }
  if (sport === "baseball") { // the infield's dirt, a diamond above home plate at the south end
    const hx = R.x0 + Math.floor(R.w / 2), hy = R.y0 + R.h - 8, rad = Math.round(Math.min(R.w, R.h) * 0.3);
    for (let y = hy - 2 * rad; y <= hy + 2; y++) for (let x = hx - rad - 2; x <= hx + rad + 2; x++) {
      const t = Math.abs(x - hx) + Math.abs(y - (hy - rad));
      if (t <= rad + 2 && t >= rad - 3) cells[I(x, y)].f = "dirt";
      if (Math.abs(x - hx) + Math.abs(y - (hy - rad)) <= 2) cells[I(x, y)].f = "dirt"; // the mound
    }
  }
}
// The field's pieces: goalposts, goals, the net, the rails and pens.
function dressField(V, R, piece, G, rng) {
  const sport = V.field.sport, my = R.y0 + Math.floor(R.h / 2);
  if (sport === "football" || sport === "track") {
    const inset = sport === "track" ? 12 : 3;
    for (const x of [R.x0 + inset, R.x0 + R.w - 1 - inset]) piece(x, my, "goalpost");
  } else if (sport === "soccer") {
    for (const x of [R.x0 + 2, R.x0 + R.w - 3]) for (let y = my - 3; y <= my + 3; y++) piece(x, y, "soccergoal");
  } else if (sport === "tennis") {
    const nx = R.x0 + Math.floor(R.w / 2);
    for (let y = R.y0 + 3; y < R.y0 + R.h - 3; y++) piece(nx, y, "tennisnet");
  } else if (sport === "rodeo") { // the arena's fence (a gate every so often), the bucking chutes at the east end
    for (let x = R.x0; x < R.x0 + R.w; x++) if ((x - R.x0) % 14 > 2) piece(x, R.y0 + 1, "fence");
    for (const x of [R.x0 + 1, R.x0 + R.w - 2]) for (let y = R.y0 + 2; y < R.y0 + R.h - 2; y++) if ((y - R.y0) % 12 > 2) piece(x, y, "fence");
    for (let i = 0; i < 4; i++) for (let y = R.y0 + 8 + i * 6; y < R.y0 + 12 + i * 6; y++) piece(R.x0 + R.w - 6, y, "fence");
  } else if (V.form === "oval") { // the inner rail, open here and there
    const { R: rad, a, band } = V.field, cx = R.x0 + R.w / 2 - 0.5, cy = R.y0 + R.h / 2 - 0.5;
    if (sport === "horse") for (let y = R.y0; y < R.y0 + R.h; y++) for (let x = R.x0; x < R.x0 + R.w; x++) {
      const dx = Math.max(0, Math.abs(x - cx) - a), dist = Math.hypot(dx, y - cy);
      if (Math.abs(dist - (rad - band - 0.5)) < 0.5 && (x + y) % 9 > 1) piece(x, y, "fence");
    }
    for (let i = 0; i < 6; i++) piece(rng.int(R.x0 + rad, R.x0 + R.w - rad), Math.round(cy + rad - band - 4), "drum");
  }
}

// ---------- in the raid ----------
// The opening lines: the venue, its stands and buildings, the ways out.
export function stadiumIntro(b) {
  const R = b.raid, P = R.plan;
  const names = P.houses.map((h) => h.name);
  const ways = R.zones.map((z) => (z.name || z.side).toLowerCase());
  const been = P.houses.filter((h) => R.containers.some((c) => c.house === h.k && c.mine)).map((h) => h.name);
  const floors = R.storeys > 1 ? ` The concourses go up ${R.storeys} levels: the stairs are at their ends.` : "";
  return `${P.kindName}: ${names.join(", ")}${P.field ? ` round the ${P.form === "oval" ? "track" : "field"}` : ""}. The gates and the ticket office are on the main side, the locker rooms and the players' tunnel under it, the concession stands along the concourses.${floors} Ways out: ${ways.join(", ")}.${been.length ? ` Your people have been through ${been.join(", ")} before.` : ""}`;
}
