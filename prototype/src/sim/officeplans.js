// @ts-check
// The office buildings' floor plans (the user's request 2026-10-25, issue #27 of the interiors epic #7: "add office
// building varients"): the specs buildingmaps.js assemble builds, one maker a kind (BUILDINGS: storefront, bizpark,
// cityhall, courthouse, callcenter, techoffice, station; and the corporate tower, the office tower's plan when it has a
// firm). Each takes (rng, o, plan): the archetype's dice, its options (o.storeyBonus: the crawl's deeper blocks) and the
// firm's plan (buildingmaps.js planOf: data-offices.js OFFICE_FIRMS plan with its look). Every leaf names its room's
// style (office: officelayout.js OFFICE_STYLES); a courthouse's holding cell is civiclayout.js's cells (civic). The
// sizes are SIZE (cells of about a metre: the furniture's scale, data-furniture.js), one row a kind, until the real-world
// size table (#24) takes them.
//
// The plans (y parts go from the front, the street, to the back; x from left to right):
//   storefront  the front office across the front (a front desk, waiting chairs), a hall down one side to the back:
//               private offices, the file room, a kitchenette, a restroom. A dentist's operatories (dental chairs) and
//               sterilization room, or a doctor's exam rooms and drug cupboard, in their place (plan.office). Upstairs
//               (a 2-storey firm): more offices, a partner's office at the front.
//   bizpark     a glass lobby between open-plan floors, a meeting room and the mail room along the front, a corridor,
//               open plan, a training room, the break room, the IT closet and a restroom behind; upstairs open plan,
//               meeting rooms, a manager's office, records. Its parking lot outside (ground "lot").
//   tower       the corporate tower: two stairwells at the ends of the front band on every floor (two stair runs); the
//               ground floor's marble lobby (turnstiles, the reception, the lift bank), a café and the mail room
//               along the front, the loading bay (a roller door), the security office and a staff room behind; the
//               floors above vary floor by floor (TOWER.FLOORS): open plan, an executive floor (big offices, the
//               boardroom), a canteen floor, a fitness floor, an IT and server floor; the top floor the executive
//               suite (the safe, the liquor cabinet), the boardroom and the roof plant.
//   cityhall    the clerk's office (its counter and queue posts), the lobby and the permits office along the front;
//               the council chambers (rows of seats facing the dais), the mayor's office, records behind; upstairs
//               council offices, a committee room, planning, the archives.
//   courthouse  the clerk of court, the security screening entrance (a walk-through scanner, an X-ray belt) and a
//               records office along the front; the courtroom (the judge's bench, the witness stand, the jury box, the
//               gallery's benches), the holding cell behind bars and the evidence room behind; upstairs the judges'
//               chambers, the jury room, a second courtroom and the law library.
//   callcenter  call floors either side of the reception and a big one behind (rows of headset desks, the supervisors'
//               platform), the big break room (vending machines), the team leads' office, the IT closet.
//   techoffice  long bench desks, the games corner (a pool table, beanbags), the lobby; the kitchen of drinks, phone
//               booths, the server room behind; upstairs benches, a meeting room, a lounge.
//   station     the newsroom, the reception and the studio (a TV studio's cameras, news desk and lights; a radio
//               station's booth; a newspaper's press room) at the front; the control room, the archive and a break
//               room behind; upstairs the editorial offices, the station manager's office, the tape library and the
//               transmitter room.
import { REAL_SIZE } from "./data-buildingsize.js"; // the sizes (issue #24 took over SIZE)

// #24's real-world size table holds these rows now (data-buildingsize.js REAL_SIZE, planned; "h" the depth there "d";
// the corporate tower the officetower row).
const ROW = (k) => ({ w: REAL_SIZE[k].w, h: REAL_SIZE[k].d, storeys: REAL_SIZE[k].storeys });
export const SIZE = {
  storefront: ROW("storefront"), bizpark: ROW("bizpark"), tower: ROW("officetower"), // the tower's storeys capped by buildingmaps.js MAX_STOREYS (10); only the lower floors are built (buildingmaps.js openStoreys)
  cityhall: ROW("cityhall"), courthouse: ROW("courthouse"), callcenter: ROW("callcenter"), techoffice: ROW("techoffice"), station: ROW("station"),
};
// The tower's floors above the ground (tower floorKinds): the first is open plan; the one under the top an executive
// floor (4+ storeys); each of the others one of SPECIAL (each at most once) on SPECIAL_P, else open plan.
export const TOWER = { SPECIAL: ["canteen", "fitness", "it", "exec"], SPECIAL_P: 0.6 };

const leaves = (list) => list.map(([s, r]) => [s, typeof r === "string" ? { role: r } : r]);
const corridorPlan = (front, back, fd, cw = 1, hall = null) => ({ split: "y", parts: [[fd, { split: "x", parts: leaves(front) }], [cw, { role: "corridor", ...(hall || {}) }], ["*", { split: "x", parts: leaves(back) }]] });
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
/** A leaf: its role (buildingmaps.js ROLES), its style (officelayout.js) and overrides. */
const O = (role, office, o = {}) => ({ role, office, ...o });
/** @param {any} rng @param {number[]} r */
const roll = (rng, r) => rng.int(r[0], r[1]);
/** The storeys: the firm's (plan.storeys) within the kind's, + the crawl's bonus, at most max. */
const storeysOf = (rng, kind, plan, o, max) => { const r = plan.storeys || SIZE[kind].storeys; return clampN(roll(rng, r) + (o.storeyBonus || 0), 1, max); };
/** The front room in the firm's look: its floor and its walls (decor.js wallc). */
const front = (leaf, plan) => ({ ...leaf, ...(plan.fl ? { fl: plan.fl } : {}), ...(plan.look ? { wallc: plan.look.wall } : {}) });
const restroom = [2, O("restroom", "restroom")];
const fire = (lock) => [{ side: "left", roles: ["corridor"], chance: 0.5, lock }, { side: "right", roles: ["corridor"], chance: 0.5, lock }];

// ---------- a storefront office ----------
/** @param {any} rng @param {any} o @param {any} plan @param {number} max */
export function storefront(rng, o, plan, max) {
  const S = SIZE.storefront, bw = roll(rng, S.w), bh = roll(rng, S.h);
  const kind = plan.office || "insurance", n = storeysOf(rng, "storefront", plan, { storeyBonus: 0 }, max), left = rng.chance(0.5);
  const fd = rng.int(5, 6);
  const NAME = { insurance: "Front office", law: "Reception", accounts: "Front office", realty: "Front office", travel: "Travel desk", dentist: "Reception", doctor: "Waiting room" };
  const lobby = front(O("lobby", kind === "doctor" || kind === "dentist" ? "waiting" : "reception", { entry: true, name: NAME[kind] || "Front office", type: kind === "doctor" ? "clinic" : kind === "dentist" ? "dental" : "office", maxBoxes: 2 }), plan);
  // The rooms behind: two columns either side of the hall.
  const room = kind === "dentist" ? () => O("exam", "operatory", { name: "Operatory", type: "dental", maxBoxes: 2 })
    : kind === "doctor" ? () => O("exam", "exam", { name: "Exam room", type: "clinic" })
      : () => O("office", "privoffice", { name: kind === "law" ? "Attorney's office" : kind === "realty" ? "Agent's office" : "Office", type: "office" });
  const store = kind === "dentist" ? O("storage", "sterile", { name: "Sterilization", type: "dental", lock: ["door", 0.3], boxLock: ["drugs", 0.3], windows: false })
    : kind === "doctor" ? O("pharmroom", "drugroom", { name: "Drug cupboard", lock: ["door", 0.5], boxLock: ["drugs", 0.5] })
      : O("storage", "fileroom", { name: "File room", type: "office", lock: ["door", 0.3], windows: false });
  const rooms = { split: "y", parts: leaves([["*", room()], ["*", room()]]) };
  const service = { split: "y", parts: leaves([[3, store], [3, O("breakroom", "kitchenette", { name: "Kitchenette" })], ["*", room()], restroom]) };
  const hall = [1, O("corridor", "hall", { name: "Hall" })];
  const body = { split: "x", parts: left ? [["*", rooms], hall, ["*", service]] : [["*", service], hall, ["*", rooms]] };
  const upper = () => ({ split: "y", parts: [[fd, O("office", "privoffice", { name: kind === "law" ? "Partner's office" : "Manager's office", type: "office" })], ["*", { split: "x", parts: left ? [["*", { split: "y", parts: leaves([["*", O("office", "privoffice", { name: "Office" })], ["*", O("office", "privoffice", { name: "Office" })]]) }], hall, ["*", { split: "y", parts: leaves([[3, O("storage", "fileroom", { name: "Records", type: "office" })], ["*", O("office", "privoffice", { name: "Office" })], restroom]) }]] : [["*", { split: "y", parts: leaves([[3, O("storage", "fileroom", { name: "Records", type: "office" })], ["*", O("office", "privoffice", { name: "Office" })], restroom]) }], hall, ["*", { split: "y", parts: leaves([["*", O("office", "privoffice", { name: "Office" })], ["*", O("office", "privoffice", { name: "Office" })]]) }]] }]] });
  return {
    bw, bh, front: { width: 1 }, ground: "town", storeys: n, foot: "medium", stairs: { roles: ["lobby", "corridor"], n: 1 },
    program: { split: "y", parts: [[fd, lobby], ["*", body]] },
    upper: n > 1 ? upper : null,
    exits: [{ side: "back", roles: ["corridor", "breakroom", "storage"], chance: 0.8, lock: 0.4 }],
  };
}

// ---------- a business park's low-rise ----------
/** @param {any} rng @param {any} o @param {any} plan @param {number} max */
export function bizpark(rng, o, plan, max) {
  const S = SIZE.bizpark, bw = roll(rng, S.w), bh = roll(rng, S.h), n = storeysOf(rng, "bizpark", plan, o, max), fd = rng.int(6, 7);
  const open = (name = "Open-plan office") => O("office", "openplan", { name });
  const lobby = front(O("lobby", "glasslobby", { entry: true, name: "Lobby", fl: "tile" }), plan);
  return {
    bw, bh, front: { width: 2 }, ground: "lot", storeys: n, foot: "wide", stairs: { roles: ["corridor"], n: 1, ends: true },
    program: corridorPlan([["*", open()], [rng.int(6, 7), lobby], [5, O("office", "meeting", { name: "Meeting room" })], [4, O("storage", "mailroom", { name: "Mail room", type: "office" })]],
      [["*", open()], [6, O("classroom", "training", { name: "Training room", type: "office" })], [5, O("breakroom", "breakroom")], [3, O("storage", "itcloset", { name: "IT closet", type: "techfloor", lock: ["door", 0.4], windows: false })], restroom], fd, 2),
    upper: n > 1 ? () => corridorPlan([["*", open()], [5, O("office", "meeting", { name: "Meeting room" })], [5, O("office", "privoffice", { name: "Manager's office" })], ["*", open()]],
      [["*", open()], [5, O("breakroom", "breakroom")], [4, O("storage", "fileroom", { name: "Records", type: "office" })], restroom], fd, 2) : null,
    exits: [{ side: "back", roles: ["breakroom", "storage", "corridor"], chance: 0.8, lock: 0.3 }, ...fire(0.4)],
  };
}

// ---------- the corporate tower ----------
// The kinds of its floors above the ground, by its dice: [f] for f = 1 … n − 1 (the top always "top").
/** @param {any} rng @param {number} n */
export function floorKinds(rng, n) {
  const out = ["ground"], left = rng.shuffle(TOWER.SPECIAL.slice());
  for (let f = 1; f < n; f++) {
    if (f === n - 1) out.push("top");
    else if (f === 1) out.push("open");
    else if (f === n - 2 && n >= 5 && left.includes("exec")) { left.splice(left.indexOf("exec"), 1); out.push("exec"); }
    else if (left.length && rng.chance(TOWER.SPECIAL_P)) out.push(left.pop());
    else out.push("open");
  }
  return out;
}
/** @param {any} rng @param {any} o @param {any} plan @param {number} max */
export function tower(rng, o, plan, max) {
  const S = SIZE.tower, n = storeysOf(rng, "tower", plan, o, max);
  const bw = roll(rng, S.w), bh = roll(rng, S.h), fd = 6, lw = rng.int(5, 6);
  const SW = [2, { role: "stairwell" }];
  const kinds = floorKinds(rng, n);
  const open = (name = "Open-plan office") => O("office", "openplan", { name });
  const exec = (name = "Executive office") => O("office", "execoffice", { name, type: "execsuite" });
  const lift = [lw, O("lobby", "liftlobby", { name: "Lift lobby", hub: true, maxBoxes: 0, type: null })];
  const bands = {
    open: () => [[SW, ["*", open()], lift, ["*", open()], SW], [["*", open()], [4, O("breakroom", "breakroom")], restroom, ["*", O("office", "meeting", { name: "Meeting room" })]]],
    exec: () => [[SW, ["*", exec()], lift, ["*", O("office", "boardroom", { name: "Boardroom" })], SW], [["*", exec()], [4, O("office", "privoffice", { name: "Assistants' office" })], restroom, ["*", exec()]]],
    canteen: () => [[SW, ["*", O("cafeteria", "canteen", { name: "Canteen", hub: false })], lift, ["*", O("cafeteria", "canteen", { name: "Canteen", hub: false })], SW], [["*", O("kitchen", "canteenkitchen", { name: "Canteen kitchen" })], [3, O("pantry", "coldstore", { name: "Cold store", type: "kitchen", dk: "coldroom" })], restroom, ["*", open()]]],
    fitness: () => [[SW, ["*", O("gym", "fitness", { name: "Fitness center", type: "lockers" })], lift, ["*", O("lockerroom", "towerlockers", { name: "Locker room", type: "lockers" })], SW], [["*", O("gym", "fitness", { name: "Fitness center", type: "lockers" })], [4, O("breakroom", "breakroom")], restroom, ["*", open()]]],
    it: () => [[SW, ["*", O("storage", "serverroom", { name: "Server room", type: "techfloor", lock: ["door", 0.4], windows: false })], lift, ["*", open("IT department")], SW], [["*", O("office", "openplan", { name: "IT department", type: "techfloor" })], [4, O("storage", "itcloset", { name: "IT stores", type: "techfloor", lock: ["door", 0.3] })], restroom, ["*", O("storage", "serverroom", { name: "Server room", type: "techfloor", lock: ["door", 0.4], windows: false })]]],
    top: () => [[SW, ["*", O("office", "execsuite", { name: "Executive suite", type: "execsuite" })], lift, ["*", O("office", "boardroom", { name: "Boardroom" })], SW], [["*", O("workshop", "plant", { name: "Roof plant", type: "workshop" })], [4, O("breakroom", "breakroom", { name: "Executive kitchen" })], restroom, ["*", exec("Chairman's office")]]],
  };
  const lobby = front(O("lobby", "towerlobby", { entry: true, name: "Lobby", fl: "marble", maxBoxes: 1 }), plan);
  const ground = corridorPlan([SW, ["*", O("sales", "cafe", { name: "Café", type: "kitchen", hub: false, maxBoxes: 2 })], [lw + 2, lobby], ["*", O("storage", "mailroom", { name: "Mail room", type: "office" })], SW],
    [["*", O("bays", "loadingbay", { name: "Loading bay", type: "warehouse", maxBoxes: 3 })], [5, O("office", "security", { name: "Security office" })], restroom, ["*", O("breakroom", "breakroom", { name: "Staff room" })]], fd);
  return {
    bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: { roles: ["stairwell"], n: 2, len: 3 }, floorKinds: kinds,
    program: ground,
    upper: (f) => { const [a, b] = bands[kinds[f]] ? bands[kinds[f]]() : bands.open(); return corridorPlan(a, b, fd); },
    exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.4, name: "Loading dock" }, ...fire(0.4)],
  };
}

// ---------- city hall ----------
/** @param {any} rng @param {any} o @param {any} plan @param {number} max */
export function cityhall(rng, o, plan, max) {
  const S = SIZE.cityhall, bw = roll(rng, S.w), bh = roll(rng, S.h), n = storeysOf(rng, "cityhall", plan, { storeyBonus: 0 }, max), fd = 7;
  const lobby = front(O("lobby", "rotunda", { entry: true, name: "Lobby", fl: "marble" }), plan);
  const records = (name = "Records room") => O("storage", "records", { name, type: "office", lock: ["door", 0.3] });
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "large", stairs: { roles: ["corridor"], n: 2, ends: true },
    program: corridorPlan([["*", O("office", "clerk", { name: "Clerk's office" })], [rng.int(7, 8), lobby], ["*", O("office", "permits", { name: "Permits office" })]],
      [["*", O("office", "council", { name: "Council chambers", type: "civichall", maxBoxes: 3 })], [6, O("office", "mayor", { name: "Mayor's office", type: "execsuite", boxLock: ["safe", 0.3] })], [5, records()], restroom], fd, 2),
    upper: () => corridorPlan([["*", O("office", "openplan", { name: "Council offices" })], [6, O("office", "meeting", { name: "Committee room" })], ["*", O("office", "openplan", { name: "Planning department" })]],
      [["*", O("office", "privoffice", { name: "City manager's office" })], [5, O("breakroom", "breakroom")], [6, records("Archives")], restroom], fd, 2),
    exits: [{ side: "back", roles: ["corridor", "storage"], chance: 0.7, lock: 0.4 }, ...fire(0.4)],
  };
}

// ---------- the courthouse ----------
/** @param {any} rng @param {any} o @param {any} plan @param {number} max */
export function courthouse(rng, o, plan, max) {
  const S = SIZE.courthouse, bw = roll(rng, S.w), bh = roll(rng, S.h), n = storeysOf(rng, "courthouse", plan, { storeyBonus: 0 }, max), fd = 6;
  const lobby = front(O("lobby", "screening", { entry: true, name: "Security screening", fl: "marble" }), plan);
  const court = (name = "Courtroom") => O("office", "courtroom", { name, type: "courtoffice", maxBoxes: 2 });
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "large", stairs: { roles: ["corridor"], n: 2, ends: true },
    program: corridorPlan([["*", O("office", "clerks", { name: "Clerk of court", type: "courtoffice" })], [rng.int(7, 8), lobby], ["*", O("office", "clerks", { name: "Records office", type: "courtoffice" })]],
      [["*", court()], [6, { role: "cells", name: "Holding cell", civic: "cells", maxBoxes: 1 }], [5, O("armory", "evidence", { name: "Evidence room", type: "courtev", lock: ["door", 0.6], boxLock: ["evidence", 0.5], dk: "steel" })], restroom], fd, 2),
    upper: () => corridorPlan([["*", O("office", "chambers", { name: "Judge's chambers", type: "courtoffice", boxLock: ["safe", 0.25] })], [6, O("office", "jury", { name: "Jury room" })], ["*", O("office", "chambers", { name: "Judge's chambers", type: "courtoffice" })]],
      [["*", court("Courtroom 2")], [6, O("storage", "lawlibrary", { name: "Law library", type: "courtoffice" })], restroom], fd, 2),
    exits: [{ side: "back", roles: ["armory", "corridor"], chance: 0.6, lock: 0.6 }, ...fire(0.5)], // never through the holding cell (its cells keep off a door: civiclayout.js)
  };
}

// ---------- a call center ----------
/** @param {any} rng @param {any} o @param {any} plan @param {number} max */
export function callcenter(rng, o, plan, max) {
  const S = SIZE.callcenter, bw = roll(rng, S.w), bh = roll(rng, S.h), n = storeysOf(rng, "callcenter", plan, { storeyBonus: 0 }, max), fd = rng.int(6, 7);
  const floor = (name = "Call floor") => O("office", "callfloor", { name, type: "callfloor" });
  const lobby = front(O("lobby", "reception", { entry: true, name: "Reception" }), plan);
  return {
    bw, bh, front: { width: 2 }, ground: "lot", storeys: n, foot: "wide", stairs: { roles: ["lobby", "corridor"], n: 1 },
    program: corridorPlan([["*", floor()], [rng.int(5, 6), lobby], ["*", floor()]],
      [["*", floor("Main call floor")], [7, O("breakroom", "bigbreak", { name: "Break room", maxBoxes: 3 })], [4, O("office", "privoffice", { name: "Team leads' office" })], [3, O("storage", "itcloset", { name: "IT closet", type: "techfloor", lock: ["door", 0.3], windows: false })], restroom], fd),
    upper: n > 1 ? () => corridorPlan([["*", floor()], [5, O("classroom", "training", { name: "Training room", type: "office" })], ["*", floor()]], [["*", floor()], [6, O("breakroom", "bigbreak", { name: "Break room" })], [4, O("office", "privoffice", { name: "Manager's office" })], restroom], fd) : null,
    exits: [{ side: "back", roles: ["breakroom", "corridor"], chance: 0.8, lock: 0.3 }, ...fire(0.3)],
  };
}

// ---------- a tech office ----------
/** @param {any} rng @param {any} o @param {any} plan @param {number} max */
export function techoffice(rng, o, plan, max) {
  const S = SIZE.techoffice, bw = roll(rng, S.w), bh = roll(rng, S.h), n = storeysOf(rng, "techoffice", plan, o, max), fd = 6;
  const bench = (name = "Open-plan floor") => O("office", "benches", { name, type: "techfloor" });
  const lobby = front(O("lobby", "techlobby", { entry: true, name: "Lobby" }), plan);
  return {
    bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: { roles: ["corridor", "lobby"], n: 1 },
    program: corridorPlan([["*", bench()], [6, lobby], ["*", O("dayroom", "lounge", { name: "Games corner", type: "techfloor", hub: false })]],
      [["*", O("kitchen", "techkitchen", { name: "Kitchen", type: "techfloor" })], [3, O("office", "phonebooths", { name: "Phone booths", type: "techfloor" })], [4, O("storage", "serverroom", { name: "Server room", type: "techfloor", lock: ["door", 0.4], windows: false })], restroom], fd),
    upper: () => corridorPlan([["*", bench()], [5, O("office", "meeting", { name: "Meeting room" })], ["*", O("dayroom", "lounge", { name: "Lounge", type: "techfloor", hub: false })]],
      [["*", bench()], [3, O("office", "phonebooths", { name: "Phone booths", type: "techfloor" })], [4, O("breakroom", "techkitchen", { name: "Snack bar", type: "techfloor" })], restroom], fd),
    exits: [{ side: "back", roles: ["kitchen", "corridor"], chance: 0.7, lock: 0.3 }, ...fire(0.4)],
  };
}

// ---------- a TV or radio station, a newspaper ----------
/** @param {any} rng @param {any} o @param {any} plan @param {number} max */
export function station(rng, o, plan, max) {
  const S = SIZE.station, bw = roll(rng, S.w), bh = roll(rng, S.h), n = storeysOf(rng, "station", plan, { storeyBonus: 0 }, max), fd = 6;
  const media = plan.media || "tv";
  const studio = media === "tv" ? O("office", "studio", { name: "Studio", type: "studio", windows: false, maxBoxes: 2 })
    : media === "radio" ? O("office", "booth", { name: "Broadcast booth", type: "studio", windows: false })
      : O("workshop", "press", { name: "Press room", type: "workshop" });
  const lobby = front(O("lobby", "reception", { entry: true, name: "Reception" }), plan);
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "large", stairs: { roles: ["corridor", "lobby"], n: 1 }, media,
    program: corridorPlan([["*", O("office", "newsroom", { name: "Newsroom", type: "studio" })], [5, lobby], ["*", studio]],
      [["*", O("office", "control", { name: media === "paper" ? "Layout room" : "Control room", type: "studio", windows: false })], [5, O("storage", "archive", { name: "Archive", type: "office" })], [4, O("breakroom", "breakroom")], restroom], fd),
    upper: () => corridorPlan([["*", O("office", "newsroom", { name: "Editorial offices", type: "studio" })], [5, O("office", "meeting", { name: "Meeting room" })], ["*", O("office", "execoffice", { name: media === "paper" ? "Editor's office" : "Station manager's office", type: "execsuite" })]],
      [["*", O("storage", "archive", { name: media === "paper" ? "Back issues" : "Tape library", type: "office" })], [4, O("breakroom", "breakroom")], [4, O("workshop", "transmitter", { name: media === "paper" ? "Darkroom" : "Transmitter room", type: "studio", windows: false })], restroom], fd),
    exits: [{ side: "back", roles: ["corridor", "storage"], chance: 0.7, lock: 0.4 }, ...fire(0.4)],
  };
}

export const OFFICE_PLANS = { storefront, bizpark, tower, cityhall, courthouse, callcenter, techoffice, station };
