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

export const SIZE = {
  storefront: { w: [10, 14], h: [15, 20], storeys: [1, 2] },
  bizpark:    { w: [26, 32], h: [17, 21], storeys: [1, 3] },
  tower:      { w: [24, 28], h: [16, 18], storeys: [6, 10] }, // capped by buildingmaps.js MAX_STOREYS (#24 raises it to 10)
  cityhall:   { w: [26, 30], h: [21, 24], storeys: [2, 3] },
  courthouse: { w: [26, 30], h: [21, 24], storeys: [2, 3] },
  callcenter: { w: [26, 32], h: [17, 20], storeys: [1, 2] },
  techoffice: { w: [20, 24], h: [15, 18], storeys: [2, 5] },
  station:    { w: [22, 26], h: [15, 17], storeys: [2, 2] },
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


// ======================================================================================
// The variants (the user's request 2026-10-25: "for buildings with no to only a few varients create a dozen varients
// per building type"; issue #32's rule: a variant is a distinct plan, its room list and arrangement, not a recolour).
// Each kind has OFFICE_VARIANTS[kind]: twelve named plans, picked by the building's dice (o.plan: a given one, by name
// or index; the tests'). The first of each is the plan above (its dice as they were after the pick). The others are
// data for build(): a footprint, storeys, the ground floor's plan and the floors' above from the shared rooms (SLOTS),
// the exits. The tower's are towerVariant(): its ground floor's bands and the kinds of floor it stacks (TOWER_FLOORS).
// spec.variant: the plan's name (the raid plan shows it).
// ======================================================================================
const N = (list) => list.map(([sz, r]) => [sz, typeof r === "string" ? { role: r } : r]);
const X = (...parts) => ({ split: "x", parts: N(parts) });
const Y = (...parts) => ({ split: "y", parts: N(parts) });
/** The footprint class by its area (tools/storeytest.js). */
const footOf = (bw, bh) => { const a = bw * bh; return a <= 190 ? "small" : a <= 360 ? "medium" : "large"; };
const exitBack = (roles = ["corridor", "storage", "breakroom"], chance = 0.7) => ({ side: "back", roles, chance, lock: 0.3 });
const exitSide = (side, roles = ["corridor", "lobby"], chance = 1) => ({ side, roles, chance, lock: 0.3 });
// The rooms every kind's plans share, as leaves (each its role, its style, its name; o: overrides).
/** @param {any} plan */
function SLOTS(plan) {
  const k = plan.office || "insurance", media = plan.media || "tv";
  const med = k === "dentist" ? "dentist" : k === "doctor" ? "doctor" : null;
  return {
    lobby: (o = {}) => front(O("lobby", med ? "waiting" : "reception", { entry: true, name: med === "doctor" ? "Waiting room" : "Reception", type: med === "doctor" ? "clinic" : med ? "dental" : "office", ...o }), plan),
    hall: (name = "Corridor") => ({ role: "corridor", name }),
    wc: () => O("restroom", "restroom"),
    kit: (name = "Kitchenette") => O("breakroom", "kitchenette", { name }),
    brk: (name = "Break room") => O("breakroom", "breakroom", { name }),
    priv: (name = "Office", o = {}) => O("office", "privoffice", { name, ...o }),
    // A storefront's own room by the firm's kind: an office, a dentist's operatory, a doctor's exam room.
    room: (name) => (med === "dentist" ? O("exam", "operatory", { name: name || "Operatory", type: "dental", maxBoxes: 2 }) : med === "doctor" ? O("exam", "exam", { name: name || "Exam room", type: "clinic" }) : O("office", "privoffice", { name: name || (k === "law" ? "Attorney's office" : k === "realty" ? "Agent's office" : "Office") })),
    store: () => (med === "dentist" ? O("storage", "sterile", { name: "Sterilization", type: "dental", lock: ["door", 0.3], boxLock: ["drugs", 0.3], windows: false }) : med === "doctor" ? O("pharmroom", "drugroom", { name: "Drug cupboard", lock: ["door", 0.5], boxLock: ["drugs", 0.5] }) : O("storage", "fileroom", { name: "File room", type: "office", lock: ["door", 0.3], windows: false })),
    meet: (name = "Meeting room") => O("office", "meeting", { name }),
    open: (name = "Open-plan office", o = {}) => O("office", "openplan", { name, ...o }),
    files: (name = "Records room") => O("storage", "records", { name, type: "office", lock: ["door", 0.3] }),
    mail: () => O("storage", "mailroom", { name: "Mail room", type: "office" }),
    it: (name = "IT closet") => O("storage", "itcloset", { name, type: "techfloor", lock: ["door", 0.4], windows: false }),
    server: (name = "Server room") => O("storage", "serverroom", { name, type: "techfloor", lock: ["door", 0.4], windows: false }),
    train: (name = "Training room") => O("classroom", "training", { name, type: "office" }),
    lounge: (name = "Lounge", o = {}) => O("dayroom", "lounge", { name, type: "office", hub: false, ...o }),
    atrium: (name = "Atrium") => O("dayroom", "atrium", { name, type: "office", hub: true }),
    canteen: (name = "Cafeteria") => O("cafeteria", "canteen", { name, hub: false }),
    kitchen: (name = "Kitchen") => O("kitchen", "canteenkitchen", { name }),
    gym: (name = "Fitness room") => O("gym", "fitness", { name, type: "lockers" }),
    lockers: (name = "Locker room") => O("lockerroom", "towerlockers", { name, type: "lockers" }),
    shop: (name = "Shop") => O("sales", "shopunit", { name, type: "store", hub: false, maxBoxes: 3 }),
    cafe: (name = "Café") => O("sales", "cafe", { name, type: "kitchen", hub: false, maxBoxes: 2 }),
    bay: (name = "Loading bay") => O("bays", "loadingbay", { name, type: "warehouse", maxBoxes: 3 }),
    ware: (name = "Warehouse") => O("warefloor", "pallets", { name, type: "warehouse" }),
    shopfloor: (name = "Workshop") => O("workshop", "workshoproom", { name, type: "workshop" }),
    plant: (name = "Plant room") => O("workshop", "plant", { name, type: "workshop" }),
    lab: (name = "Lab") => O("lab", "labroom", { name, type: "techfloor" }),
    exam: (name = "Exam room") => O("exam", "exam", { name, type: "clinic" }),
    drugs: () => O("pharmroom", "drugroom", { name: "Drug cupboard", lock: ["door", 0.5], boxLock: ["drugs", 0.5] }),
    secure: (name = "Security office") => O("office", "security", { name }),
    vault: (name = "Vault") => O("armory", "vault", { name, type: "bankvault", lock: ["vault", 0.8], boxLock: ["safe", 0.5], windows: false, fl: "conc" }),
    bank: (name = "Banking hall") => O("lobby", "bankhall", { name, type: "office", hub: true, maxBoxes: 2 }),
    cells: (name = "Holding cell") => ({ role: "cells", name, civic: "cells", maxBoxes: 1 }),
    exec: (name = "Executive office") => O("office", "execoffice", { name, type: "execsuite" }),
    suite: (name = "Executive suite") => O("office", "execsuite", { name, type: "execsuite" }),
    board: (name = "Boardroom") => O("office", "boardroom", { name }),
    call: (name = "Call floor") => O("office", "callfloor", { name, type: "callfloor" }),
    bench: (name = "Open-plan floor") => O("office", "benches", { name, type: "techfloor" }),
    booths: () => O("office", "phonebooths", { name: "Phone booths", type: "techfloor" }),
    techkit: (name = "Kitchen", role = "kitchen") => O(role, "techkitchen", { name, type: "techfloor" }),
    court: (name = "Courtroom") => O("office", "courtroom", { name, type: "courtoffice", maxBoxes: 2 }),
    chambers: (name = "Judge's chambers") => O("office", "chambers", { name, type: "courtoffice" }),
    jury: (name = "Jury room") => O("office", "jury", { name }),
    clerks: (name = "Clerk of court") => O("office", "clerks", { name, type: "courtoffice" }),
    lawlib: (name = "Law library") => O("storage", "lawlibrary", { name, type: "courtoffice" }),
    evidence: (name = "Evidence room") => O("armory", "evidence", { name, type: "courtev", lock: ["door", 0.6], boxLock: ["evidence", 0.5], dk: "steel" }),
    screen: (o = {}) => front(O("lobby", "screening", { entry: true, name: "Security screening", fl: "marble", ...o }), plan),
    council: (name = "Council chambers") => O("office", "council", { name, type: "civichall", maxBoxes: 3 }),
    clerk: (name = "Clerk's office") => O("office", "clerk", { name }),
    permits: (name = "Permits office") => O("office", "permits", { name }),
    mayor: (name = "Mayor's office") => O("office", "mayor", { name, type: "execsuite", boxLock: ["safe", 0.3] }),
    rotunda: (o = {}) => front(O("lobby", "rotunda", { entry: true, name: "Lobby", fl: "marble", ...o }), plan),
    engine: () => ({ role: "bays", name: "Engine bay", type: "enginebay", maxBoxes: 4, civic: "enginebay" }),
    sally: () => ({ role: "bays", name: "Sally port", type: "garage", maxBoxes: 2, civic: "sallyport" }),
    newsroom: (name = "Newsroom") => O("office", "newsroom", { name, type: "studio" }),
    // A station's studio by its firm's media: a TV studio, a radio station's booth, a newspaper's press room.
    studio: (name) => (media === "tv" ? O("office", "studio", { name: name || "Studio", type: "studio", windows: false, maxBoxes: 2 }) : media === "radio" ? O("office", "booth", { name: name || "Broadcast booth", type: "studio", windows: false }) : O("workshop", "press", { name: name || "Press room", type: "workshop" })),
    control: (name) => O("office", "control", { name: name || (media === "paper" ? "Layout room" : "Control room"), type: "studio", windows: false }),
    archive: (name) => O("storage", "archive", { name: name || (media === "paper" ? "Back issues" : "Tape library"), type: "office" }),
    xmit: (name) => O("workshop", "transmitter", { name: name || (media === "paper" ? "Darkroom" : "Transmitter room"), type: "studio", windows: false }),
  };
}
/**
 * A spec from a variant's data: v.size (w, h ranges), v.storeys (or the firm's, or the kind's), v.bonus (the crawl's
 * storeys add), v.plan(D, c, rng) the ground floor's tree, v.up(D, c, rng) the floors' above (c.f the floor, c.top),
 * v.exits, v.stairs, v.ground, v.door (the front door's width). @param {string} kind @param {any} v @param {any} rng @param {any} o @param {any} plan @param {number} max
 */
function build(kind, v, rng, o, plan, max) {
  const S = v.size || SIZE[kind], bw = roll(rng, S.w), bh = roll(rng, S.h);
  const n = clampN(roll(rng, v.storeys || plan.storeys || SIZE[kind].storeys) + (v.bonus ? o.storeyBonus || 0 : 0), 1, Math.min(max, v.most || max));
  const D = SLOTS(plan), c = { bw, bh, n, fd: v.fd ? roll(rng, v.fd) : 6, left: rng.chance(0.5) };
  return {
    bw, bh, front: { width: v.door || 2 }, ground: v.ground || (kind === "bizpark" || kind === "callcenter" ? "lot" : kind === "techoffice" ? "city" : "town"), storeys: n, foot: footOf(bw, bh), variant: v.name,
    stairs: v.stairs || { roles: ["corridor", "lobby", "dayroom"], n: 1 },
    program: v.plan(D, c, rng),
    upper: n > 1 ? (f, r, ctx) => (v.up || v.plan)(D, { ...c, f, top: ctx.top }, r) : null,
    exits: v.exits || [exitBack(), ...fire(0.4)],
  };
}
const V = (name, def) => ({ name, make: (kind) => (rng, o, plan, max) => build(kind, def, rng, o, plan, max) });

// ---------- a storefront office: twelve plans ----------
const STOREFRONT = [
  { name: "Main street office", make: () => storefront },
  V("Corner office", { size: { w: [12, 15], h: [12, 15] }, storeys: [1, 1], exits: [exitSide("left", ["lobby", "office", "exam"]), exitBack(["breakroom", "storage"])],
    plan: (D) => Y([5, X(["*", D.lobby()], [4, D.room()])], ["*", X(["*", D.room()], ["*", D.room()], [4, Y(["*", D.kit()], [2, D.wc()])])]) }),
  V("Walk-up office", { size: { w: [9, 11], h: [15, 19] }, storeys: [2, 2], stairs: { roles: ["corridor", "lobby"], n: 1 },
    plan: (D) => Y([6, D.lobby()], [1, D.hall("Stair hall")], ["*", X(["*", D.lounge("Waiting room")], [3, Y(["*", D.store()], [2, D.wc()])])]),
    up: (D) => Y([6, X(["*", D.room()], ["*", D.room()])], [1, D.hall("Landing")], ["*", X(["*", D.room()], [4, D.kit()])]) }),
  V("Strip-mall unit", { size: { w: [8, 10], h: [17, 22] }, storeys: [1, 1], door: 1, exits: [exitBack(["storage", "breakroom", "restroom"], 1)],
    plan: (D) => Y([5, D.lobby()], [1, D.hall()], ["*", X(["*", D.room()], ["*", D.room()])], [4, D.store()], [3, X(["*", D.kit()], [2, D.wc()])]) }),
  V("Converted house", { size: { w: [11, 13], h: [12, 15] }, storeys: [2, 2], ground: "town", stairs: { roles: ["hall", "lobby"], n: 1 },
    plan: (D) => Y([5, X(["*", D.lobby({ name: "Front parlour" })], [4, D.room()])], ["*", X(["*", D.kitchen("Old kitchen")], [3, { role: "hall", name: "Hall" }], ["*", D.store()])]),
    up: (D) => Y([5, X(["*", D.room()], ["*", D.room()])], ["*", X(["*", D.room()], [3, { role: "hall", name: "Landing" }], [3, D.wc()])]) }),
  V("Open-plan agency", { size: { w: [12, 15], h: [14, 18] }, storeys: [1, 1],
    plan: (D) => Y([5, D.lobby()], ["*", D.open("Agents' floor")], [4, X(["*", D.meet("Conference room")], [4, D.room()], [3, D.kit()])]) }),
  V("Partners' suite", { size: { w: [14, 16], h: [15, 18] }, storeys: [1, 1],
    plan: (D) => Y([5, X(["*", D.lobby()], [5, D.meet("Conference room")])], [1, D.hall()], ["*", X(["*", D.room()], ["*", D.room()], ["*", D.room()])], [3, X(["*", D.store()], [4, D.kitchen("Partners' kitchen")], [2, D.wc()])]) }),
  V("Office over a shop", { size: { w: [10, 13], h: [14, 17] }, storeys: [2, 2], stairs: { roles: ["corridor", "lobby"], n: 1 },
    plan: (D) => Y([6, X(["*", D.shop("Shop")], [4, D.lobby({ name: "Stair lobby" })])], [1, D.hall("Back passage")], ["*", X(["*", D.store()], [3, D.wc()])]),
    up: (D) => Y([6, X(["*", D.room()], ["*", D.room()])], [1, D.hall("Landing")], ["*", X(["*", D.meet("Conference room")], [4, D.kit()])]) }),
  V("Records office", { size: { w: [11, 14], h: [16, 20] }, storeys: [1, 1],
    plan: (D) => Y([5, D.lobby()], [1, D.hall()], ["*", X(["*", D.files("Archive")], ["*", D.room()])], [5, X(["*", D.files("Records vault")], [4, D.lounge("Client lounge")])]) }),
  V("Courtyard office", { size: { w: [13, 16], h: [14, 17] }, storeys: [1, 1],
    plan: (D) => Y([5, X(["*", D.room()], [5, D.lobby()], ["*", D.room()])], ["*", X(["*", D.room()], [5, D.lounge("Waiting hall", { hub: true })], ["*", D.store()])], [3, X(["*", D.kit()], [2, D.wc()])]) }),
  V("Office with a garage", { size: { w: [13, 16], h: [15, 18] }, storeys: [1, 1], exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.3 }],
    plan: (D) => Y([5, D.lobby()], [1, D.hall()], ["*", X(["*", D.room()], ["*", D.bay("Garage")])], [3, X(["*", D.kit()], [3, D.store()], [2, D.wc()])]) }),
  V("Two-door office", { size: { w: [14, 17], h: [13, 16] }, storeys: [1, 1], exits: [exitSide("left", ["lounge", "dayroom", "lobby"]), exitSide("right", ["lounge", "dayroom", "lobby"]), exitBack()],
    plan: (D) => Y([5, X(["*", D.lobby()], ["*", D.lounge("Second waiting room")])], [1, D.hall()], ["*", X(["*", D.room()], ["*", D.room()], [4, Y(["*", D.store()], [3, D.kit()])])]) }),
];

// ---------- a business park's building: twelve plans ----------
const BIZPARK = [
  { name: "Low-rise office", make: () => bizpark },
  V("Flex space", { storeys: [1, 1], exits: [{ side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 2, lock: 0.3 }, exitSide("left", ["corridor"], 0.5)],
    plan: (D) => Y([6, X(["*", D.open()], [6, D.lobby({ name: "Lobby" })], [5, D.meet()])], [1, D.hall()], ["*", X(["*", D.ware()], [4, Y(["*", D.brk()], [2, D.wc()])])]) }),
  V("Research park building", { storeys: [1, 2],
    plan: (D) => Y([6, X(["*", D.lab()], [6, D.lobby({ name: "Lobby" })], ["*", D.lab()])], [2, D.hall()], ["*", X(["*", D.lab()], [5, D.server()], [5, D.brk()], restroom)]),
    up: (D) => Y([6, X(["*", D.open("Researchers' offices")], [5, D.meet()], ["*", D.lab()])], [2, D.hall()], ["*", X(["*", D.lab()], [4, D.files()], restroom)]) }),
  V("Training center", { storeys: [1, 2],
    plan: (D) => Y([6, X(["*", D.train("Classroom")], [6, D.lobby({ name: "Lobby" })], ["*", D.train("Classroom")])], [2, D.hall()], ["*", X(["*", D.train("Lecture room")], [6, D.canteen("Lunch room")], [4, D.kitchen()], restroom)]),
    up: (D) => Y([6, X(["*", D.train("Classroom")], ["*", D.train("Computer lab")])], [2, D.hall()], ["*", X(["*", D.open("Instructors' office")], [4, D.files()], restroom)]) }),
  V("Medical office building", { storeys: [2, 3],
    plan: (D) => Y([6, X(["*", D.lounge("Waiting room", { type: "clinic" })], [6, D.lobby({ name: "Lobby" })], ["*", D.exam()])], [2, D.hall()], ["*", X(["*", D.exam()], ["*", D.exam()], [4, D.drugs()], restroom)]),
    up: (D) => Y([6, X(["*", D.exam()], [5, D.priv("Doctor's office")], ["*", D.exam()])], [2, D.hall()], ["*", X(["*", D.exam()], [4, D.files("Patient records")], [4, D.brk()], restroom)]) }),
  V("Atrium building", { storeys: [2, 3], stairs: { roles: ["dayroom", "corridor"], n: 1 },
    plan: (D) => Y([6, X(["*", D.open()], [8, D.lobby({ name: "Lobby" })], ["*", D.meet()])], ["*", X(["*", D.open()], [8, D.atrium()], ["*", Y(["*", D.brk()], [3, D.wc()])])]),
    up: (D) => Y([6, X(["*", D.open()], [8, D.atrium("Atrium gallery")], ["*", D.priv("Manager's office")])], ["*", X(["*", D.open()], [8, D.lounge("Breakout space", { hub: true })], ["*", D.files()])]) }),
  V("Data center", { storeys: [1, 1], exits: [exitBack(["storage", "workshop"], 1)],
    plan: (D) => Y([6, X(["*", D.secure()], [6, D.lobby({ name: "Lobby" })], ["*", D.open("Operations room")])], [2, D.hall()], ["*", X(["*", D.server("Data hall")], ["*", D.server("Data hall")], [5, D.plant("Generator room")], restroom)]) }),
  V("Back-office park building", { storeys: [2, 3], stairs: { roles: ["corridor"], n: 1, ends: true },
    plan: (D, c) => Y([6, X(["*", D.open("Claims floor")], [6, D.lobby({ name: "Lobby" })], [4, D.mail()])], [1, D.hall()], ["*", X(["*", D.open("Accounts floor")], [5, D.files()], [4, D.brk()], restroom)]),
    up: (D) => Y([6, X(["*", D.open("Processing floor")], ["*", D.open("Processing floor")])], [1, D.hall()], ["*", X(["*", D.open()], [5, D.files()], restroom)]) }),
  V("Showroom offices", { storeys: [1, 2],
    plan: (D) => Y([7, X(["*", D.shop("Showroom")], [6, D.lobby({ name: "Lobby" })])], [2, D.hall()], ["*", X(["*", D.open("Sales office")], [5, D.meet()], [5, D.ware("Stockroom")], restroom)]),
    up: (D) => Y([6, X(["*", D.open()], [5, D.priv("Manager's office")])], [2, D.hall()], ["*", X(["*", D.files()], [4, D.brk()], restroom)]) }),
  V("Corporate campus building", { storeys: [2, 3],
    plan: (D) => Y([6, X(["*", D.canteen()], [6, D.lobby({ name: "Lobby" })], ["*", D.gym()])], [2, D.hall()], ["*", X(["*", D.kitchen()], [5, D.lockers()], ["*", D.open()], restroom)]),
    up: (D) => Y([6, X(["*", D.open()], [5, D.meet()], ["*", D.open()])], [2, D.hall()], ["*", X(["*", D.open()], [4, D.brk()], [4, D.it()], restroom)]) }),
  V("Courier depot", { storeys: [1, 1], exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.3 }, { side: "left", roles: ["bays"], chance: 0.6, roller: true, width: 2, lock: 0.3 }],
    plan: (D) => Y([6, X(["*", D.mail()], [6, D.lobby({ name: "Customer counter" })], ["*", D.open("Dispatch office")])], [1, D.hall()], ["*", X(["*", D.bay("Sorting bay")], [5, D.lockers("Drivers' room")], [4, D.brk()], restroom)]) }),
  V("Startup incubator", { storeys: [1, 2],
    plan: (D) => Y([5, X(["*", D.priv("Suite")], ["*", D.priv("Suite")], [6, D.lobby({ name: "Lobby" })], ["*", D.priv("Suite")])], [1, D.hall()], ["*", X(["*", D.priv("Suite")], ["*", D.priv("Suite")], [6, D.kitchen("Shared kitchen")], [5, D.lounge("Shared lounge")])]),
    up: (D) => Y([5, X(["*", D.priv("Suite")], ["*", D.priv("Suite")], ["*", D.meet()])], [1, D.hall()], ["*", X(["*", D.priv("Suite")], ["*", D.priv("Suite")], [4, D.wc()])]) }),
];

// ---------- city hall: twelve plans ----------
const CITYHALL = [
  { name: "City hall", make: () => cityhall },
  V("Domed capitol", { storeys: [2, 3], stairs: { roles: ["lobby", "corridor"], n: 2 },
    plan: (D) => Y([7, X(["*", D.clerk()], [9, D.rotunda({ name: "Rotunda" })], ["*", D.permits()])], [2, D.hall()], ["*", X(["*", D.council()], [6, D.mayor()], [5, D.files()], restroom)]),
    up: (D) => Y([7, X(["*", D.open("Council offices")], [9, D.atrium("Rotunda gallery")], ["*", D.priv("City manager's office")])], [2, D.hall()], ["*", X(["*", D.council("Committee chamber")], [6, D.files("Archives")], restroom)]) }),
  V("Town hall with fire bay", { storeys: [2, 2], exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.2 }, exitBack()],
    plan: (D) => Y([7, X(["*", D.clerk()], [7, D.rotunda()], [8, D.engine()])], [2, D.hall()], ["*", X(["*", D.council()], [6, D.mayor()], [4, D.kit()], restroom)]),
    up: (D) => Y([7, X(["*", D.open("Town offices")], [7, D.meet("Committee room")], ["*", D.lounge("Firemen's day room")])], [2, D.hall()], ["*", X(["*", D.files("Archives")], [5, D.lockers("Turnout room")], restroom)]) }),
  V("Town hall with police office", { storeys: [2, 2],
    plan: (D) => Y([7, X(["*", D.clerk()], [7, D.rotunda()], ["*", D.priv("Police office")])], [2, D.hall()], ["*", X(["*", D.council()], [6, D.cells("Lockup")], [6, D.mayor()], restroom)]),
    up: (D) => Y([7, X(["*", D.permits()], [6, D.meet("Committee room")], ["*", D.open("Planning department")])], [2, D.hall()], ["*", X(["*", D.files("Archives")], [5, D.brk()], restroom)]) }),
  V("Municipal annex", { storeys: [3, 3], stairs: { roles: ["corridor"], n: 2, ends: true },
    plan: (D) => Y([7, X(["*", D.clerk("Tax office")], [7, D.rotunda()], ["*", D.permits()])], [2, D.hall()], ["*", X(["*", D.open("Utilities billing")], [5, D.files()], [5, D.brk()], restroom)]),
    up: (D, c) => (c.top ? Y([7, X(["*", D.council()], [6, D.mayor()])], [2, D.hall()], ["*", X(["*", D.priv("City attorney")], [5, D.files("Archives")], restroom)])
      : Y([7, X(["*", D.open("Planning department")], [6, D.meet("Committee room")], ["*", D.open("Engineering")])], [2, D.hall()], ["*", X(["*", D.open("Parks and recreation")], [5, D.canteen("Staff canteen")], restroom)])) }),
  V("City hall and library", { storeys: [2, 2],
    plan: (D) => Y([7, X(["*", D.lawlib("Public library")], [7, D.rotunda()], ["*", D.clerk()])], [2, D.hall()], ["*", X(["*", D.council()], [6, D.mayor()], [5, D.lounge("Reading room")], restroom)]),
    up: (D) => Y([7, X(["*", D.lawlib("Stacks")], [6, D.permits()])], [2, D.hall()], ["*", X(["*", D.files("Archives")], [5, D.brk()], restroom)]) }),
  V("Hall with municipal court", { storeys: [2, 3],
    plan: (D) => Y([7, X(["*", D.clerk()], [7, D.screen({ name: "Lobby" })], ["*", D.permits()])], [2, D.hall()], ["*", X(["*", D.council()], ["*", D.court("Municipal court")], [5, D.cells()], restroom)]),
    up: (D) => Y([7, X(["*", D.mayor()], [6, D.chambers("Magistrate's chambers")], ["*", D.open("Town offices")])], [2, D.hall()], ["*", X(["*", D.files("Archives")], [5, D.evidence()], restroom)]) }),
  V("Modern civic center", { storeys: [2, 3], stairs: { roles: ["dayroom", "corridor"], n: 1 },
    plan: (D) => Y([7, X(["*", D.clerk("Service counter")], [9, D.rotunda({ name: "Civic lobby", fl: "tile" })], ["*", D.cafe("Coffee bar")])], ["*", X(["*", D.council()], [8, D.atrium("Civic atrium")], ["*", Y(["*", D.mayor()], [3, D.wc()])])]),
    up: (D) => Y([7, X(["*", D.open("City departments")], [9, D.atrium("Atrium gallery")], ["*", D.meet("Committee room")])], ["*", X(["*", D.open("Planning department")], [8, D.lounge("Breakout space", { hub: true })], ["*", D.it()])]) }),
  V("Town hall with auditorium", { storeys: [2, 2],
    plan: (D) => Y([7, X(["*", D.clerk()], [7, D.rotunda()], ["*", D.lounge("Cloakroom")])], [2, D.hall()], ["*", X(["*", D.council("Auditorium")], [6, D.lockers("Dressing room")], [5, D.mayor()], restroom)]),
    up: (D) => Y([7, X(["*", D.council()], [6, D.meet("Committee room")])], [2, D.hall()], ["*", X(["*", D.files("Archives")], [5, D.kit()], restroom)]) }),
  V("Public works hall", { storeys: [1, 2], exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.3 }, exitSide("left", ["corridor"], 0.6)],
    plan: (D) => Y([7, X(["*", D.clerk("Water and power office")], [7, D.rotunda()], ["*", D.council()])], [2, D.hall()], ["*", X(["*", D.bay("Public works garage")], [6, D.shopfloor("Utility workshop")], [5, D.mayor()], restroom)]),
    up: (D) => Y([7, X(["*", D.open("Engineering")], [6, D.meet("Committee room")])], [2, D.hall()], ["*", X(["*", D.files("Plans room")], [5, D.brk()], restroom)]) }),
  V("City hall with records vault", { storeys: [2, 3],
    plan: (D) => Y([7, X(["*", D.clerk("Recorder's office")], [7, D.rotunda()], ["*", D.permits()])], [2, D.hall()], ["*", X(["*", D.council()], [5, D.vault("Records vault")], [6, D.mayor()], restroom)]),
    up: (D) => Y([7, X(["*", D.files("Deeds room")], [6, D.meet("Committee room")], ["*", D.open("Treasurer's office")])], [2, D.hall()], ["*", X(["*", D.files("Archives")], [5, D.brk()], restroom)]) }),
  V("Village hall", { size: { w: [18, 22], h: [15, 18] }, storeys: [1, 1], exits: [exitBack(["kitchen", "corridor"])],
    plan: (D) => Y([6, X(["*", D.clerk()], [5, D.rotunda({ fl: "hardwood", name: "Entrance hall" })], [5, D.mayor()])], [1, D.hall()], ["*", X(["*", D.council("Village hall")], [5, D.kitchen()], restroom)]) }),
];

// ---------- the courthouse: twelve plans ----------
const COURTHOUSE = [
  { name: "County courthouse", make: () => courthouse },
  V("Courthouse and jail", { storeys: [2, 3], exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.5 }, ...fire(0.5)],
    plan: (D) => Y([6, X(["*", D.clerks()], [8, D.screen()], ["*", D.priv("Sheriff's office")])], [2, D.hall()], ["*", X(["*", D.court()], [6, D.cells("Cell block")], [7, D.sally()])]),
    up: (D) => Y([6, X(["*", D.chambers()], [6, D.jury()], ["*", D.lockers("Deputies' locker room")])], [2, D.hall()], ["*", X(["*", D.court("Courtroom 2")], [5, D.evidence()], restroom)]) }),
  V("Twin-courtroom courthouse", { storeys: [2, 3],
    plan: (D) => Y([6, X(["*", D.clerks()], [8, D.screen()], ["*", D.files("Records office")])], [2, D.hall()], ["*", X(["*", D.court("Courtroom A")], [5, D.cells()], ["*", D.court("Courtroom B")])]),
    up: (D) => Y([6, X(["*", D.chambers()], [6, D.jury()], ["*", D.chambers()])], [2, D.hall()], ["*", X(["*", D.lawlib()], [5, D.lounge("Witness room")], restroom)]) }),
  V("Family court", { storeys: [2, 2],
    plan: (D) => Y([6, X(["*", D.lounge("Waiting room")], [8, D.screen()], ["*", D.lounge("Children's room")])], [2, D.hall()], ["*", X(["*", D.court("Family courtroom")], [5, D.meet("Mediation room")], [4, D.cells()], restroom)]),
    up: (D) => Y([6, X(["*", D.chambers()], [6, D.priv("Social workers")], ["*", D.clerks()])], [2, D.hall()], ["*", X(["*", D.files("Case files")], [5, D.brk()], restroom)]) }),
  V("Federal courthouse", { size: { w: [28, 32], h: [22, 25] }, storeys: [3, 3], stairs: { roles: ["corridor"], n: 2, ends: true },
    plan: (D) => Y([6, X(["*", D.clerks()], [9, D.screen()], ["*", D.lockers("Marshals' office")])], [2, D.hall()], ["*", X(["*", D.court("Ceremonial courtroom")], [6, D.cells()], [5, D.evidence()], restroom)]),
    up: (D, c) => (c.top ? Y([6, X(["*", D.chambers()], [6, D.lawlib()], ["*", D.chambers()])], [2, D.hall()], ["*", X(["*", D.lawlib("Law library")], [5, D.brk()], restroom)])
      : Y([6, X(["*", D.jury()], [6, D.chambers()])], [2, D.hall()], ["*", X(["*", D.court("District courtroom")], [5, D.cells("Holding cell")], restroom)])) }),
  V("Traffic court", { size: { w: [28, 32], h: [18, 21] }, storeys: [1, 1],
    plan: (D) => Y([6, X(["*", D.clerk("Payment windows")], [7, D.screen()])], [1, D.hall()], ["*", X(["*", D.court("Traffic courtroom")], [5, D.cells()], [5, D.chambers()], [4, D.files()], restroom)]) }),
  V("Old courthouse", { storeys: [2, 2],
    plan: (D) => Y([6, X(["*", D.clerks("Recorder of deeds")], [8, D.screen({ name: "Entrance hall" })], ["*", D.files("Probate office")])], [2, D.hall()], ["*", X(["*", D.priv("County assessor")], [5, D.vault("Deeds vault")], ["*", D.priv("County treasurer")], restroom)]),
    up: (D) => Y([6, X(["*", D.chambers()], [6, D.jury()])], [2, D.hall()], ["*", X(["*", D.court("Upper courtroom")], [5, D.evidence()], restroom)]) }),
  V("Justice center", { storeys: [2, 3],
    plan: (D) => Y([6, X(["*", D.canteen("Cafeteria")], [8, D.screen()], ["*", D.clerks()])], [2, D.hall()], ["*", X(["*", D.court()], [4, D.kitchen()], [5, D.cells()], [5, D.evidence()])]),
    up: (D) => Y([6, X(["*", D.chambers()], [6, D.jury()], ["*", D.priv("Prosecutor's office")])], [2, D.hall()], ["*", X(["*", D.court("Courtroom 2")], [5, D.priv("Public defender")], restroom)]) }),
  V("Courthouse with law library", { storeys: [2, 2],
    plan: (D) => Y([6, X(["*", D.lawlib("Law library")], [8, D.screen()], ["*", D.clerks()])], [2, D.hall()], ["*", X(["*", D.court()], [5, D.cells()], [6, D.lounge("Reading room")], restroom)]),
    up: (D) => Y([6, X(["*", D.chambers()], [6, D.jury()])], [2, D.hall()], ["*", X(["*", D.lawlib("Stacks")], [5, D.evidence()], restroom)]) }),
  V("Probate court", { storeys: [1, 2],
    plan: (D) => Y([6, X(["*", D.clerks("Probate clerk")], [8, D.screen()])], [2, D.hall()], ["*", X(["*", D.court("Probate courtroom")], [5, D.vault("Wills vault")], [4, D.cells()], restroom)]),
    up: (D) => Y([6, X(["*", D.chambers()], [6, D.files("Estate files")])], [2, D.hall()], ["*", X(["*", D.meet("Hearing room")], [4, D.brk()], restroom)]) }),
  V("Courthouse with sally port", { storeys: [2, 3], exits: [{ side: "left", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.5 }, exitBack()],
    plan: (D) => Y([6, X([7, D.sally()], ["*", D.clerks()], [8, D.screen()])], [2, D.hall()], ["*", X(["*", D.court()], [6, D.cells()], [5, D.evidence()], restroom)]),
    up: (D) => Y([6, X(["*", D.chambers()], [6, D.jury()], ["*", D.chambers()])], [2, D.hall()], ["*", X(["*", D.court("Courtroom 2")], [5, D.lawlib()], restroom)]) }),
  V("Magistrate's court", { size: { w: [24, 28], h: [18, 21] }, storeys: [1, 1],
    plan: (D) => Y([6, X(["*", D.clerks()], [6, D.screen()])], [1, D.hall()], ["*", X(["*", D.court("Magistrate's courtroom")], [5, D.cells()], [5, D.chambers("Magistrate's chambers")], restroom)]) }),
];

// ---------- a call center: twelve plans ----------
const CALLCENTER = [
  { name: "Contact center", make: () => callcenter },
  V("Open-floor contact center", { storeys: [1, 1], stairs: { roles: ["lobby"], n: 1 },
    plan: (D) => Y([6, X(["*", D.call()], [6, D.lobby()], ["*", D.call()])], ["*", D.call("Main call floor")], [5, X(["*", D.brk()], [5, D.priv("Team leads' office")], restroom)]) }),
  V("Two-floor support center", { storeys: [2, 2], stairs: { roles: ["corridor"], n: 1, ends: true },
    plan: (D) => Y([6, X(["*", D.call("Support floor")], [6, D.lobby()], ["*", D.train()])], [1, D.hall()], ["*", X(["*", D.call("Main call floor")], [7, D.brk()], [5, D.gym("Wellness room")], restroom)]),
    up: (D) => Y([6, X(["*", D.call("Escalations floor")], [5, D.meet()], ["*", D.call("Support floor")])], [1, D.hall()], ["*", X(["*", D.call("Night floor")], [6, D.brk()], restroom)]) }),
  V("Night-shift center", { storeys: [1, 1],
    plan: (D) => Y([6, X(["*", D.call()], [6, D.lobby()], ["*", D.lounge("Quiet room")])], [1, D.hall()], ["*", X(["*", D.call("Main call floor")], [6, D.kitchen("Kitchen")], [5, D.lockers()], restroom)]) }),
  V("Telemarketing office", { size: { w: [18, 22], h: [14, 17] }, storeys: [1, 1],
    plan: (D) => Y([5, X(["*", D.call("Phone room")], [5, D.lobby()], ["*", D.call("Phone room")])], [1, D.hall()], ["*", X(["*", D.call("Main call floor")], [4, D.priv("Manager's office")], [4, D.kit()], restroom)]) }),
  V("Help desk", { storeys: [1, 2],
    plan: (D) => Y([6, X(["*", D.call("Help desk floor")], [6, D.lobby()], ["*", D.shopfloor("Repair bench")])], [1, D.hall()], ["*", X(["*", D.call("Main call floor")], [5, D.server()], [5, D.brk()], restroom)]),
    up: (D) => Y([6, X(["*", D.call("Second-line floor")], [5, D.meet()])], [1, D.hall()], ["*", X(["*", D.it("Parts store")], [5, D.brk()], restroom)]) }),
  V("Dispatch center", { storeys: [1, 2], exits: [exitBack(["corridor"], 1), exitSide("left", ["corridor"], 1)],
    plan: (D) => Y([6, X(["*", D.secure("Dispatch supervisor")], [6, D.lobby()], ["*", D.call("Dispatch floor")])], [1, D.hall()], ["*", X(["*", D.call("Main call floor")], [5, D.server("Radio room")], [5, D.lockers()], restroom)]),
    up: (D) => Y([6, X(["*", D.train()], [5, D.meet()])], [1, D.hall()], ["*", X(["*", D.lounge("Rest room")], [5, D.kit()], restroom)]) }),
  V("Survey center", { storeys: [1, 1],
    plan: (D) => Y([6, X(["*", D.train("Interviewer training")], [6, D.lobby()], ["*", D.call("Survey floor")])], [1, D.hall()], ["*", X(["*", D.call("Main call floor")], [5, D.lounge("Respondents' lounge")], [6, D.brk()], restroom)]) }),
  V("Order desk and warehouse", { storeys: [1, 1], exits: [{ side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 2, lock: 0.3 }],
    plan: (D) => Y([6, X(["*", D.call("Order desk")], [6, D.lobby()], [5, D.mail()])], [1, D.hall()], ["*", X(["*", D.call("Main call floor")], ["*", D.ware("Fulfilment warehouse")], restroom)]) }),
  V("Call center with cafeteria", { storeys: [1, 2],
    plan: (D) => Y([6, X(["*", D.call()], [6, D.lobby()], ["*", D.canteen()])], [1, D.hall()], ["*", X(["*", D.call("Main call floor")], [5, D.kitchen()], [5, D.lockers()], restroom)]),
    up: (D) => Y([6, X(["*", D.call()], ["*", D.call()])], [1, D.hall()], ["*", X(["*", D.call("Upper call floor")], [5, D.brk()], restroom)]) }),
  V("Strip-mall call center", { size: { w: [14, 17], h: [20, 24] }, storeys: [1, 1], door: 1,
    plan: (D) => Y([5, D.lobby()], [1, D.hall()], ["*", D.call("Main call floor")], [5, X(["*", D.brk()], [4, D.lounge("Smoking room")])], [3, X(["*", D.it()], [2, D.wc()])]) }),
  V("Converted big-box call center", { size: { w: [32, 38], h: [20, 24] }, storeys: [1, 1], exits: [exitBack(["corridor"], 1), exitSide("left", ["corridor"], 1), exitSide("right", ["corridor"], 1)],
    plan: (D) => Y([6, X(["*", D.call()], [7, D.lobby()], ["*", D.gym("Wellness room")])], [1, D.hall()], ["*", X(["*", D.call("Main call floor")], ["*", D.call("Main call floor 2")], [7, D.canteen("Break hall")], restroom)]) }),
];

// ---------- a tech office: twelve plans ----------
const TECHOFFICE = [
  { name: "Tech office", make: () => techoffice },
  V("Loft office", { storeys: [2, 4], bonus: true, stairs: { roles: ["lobby", "office"], n: 1 },
    plan: (D) => Y([6, X(["*", D.bench()], [6, D.lobby()])], ["*", X(["*", D.bench("Loft floor")], [5, Y(["*", D.techkit("Kitchen", "breakroom")], [3, D.wc()])])]),
    up: (D) => Y([6, X(["*", D.bench("Loft floor")], [6, D.lounge()])], ["*", X(["*", D.bench("Loft floor")], [5, Y(["*", D.booths()], [3, D.wc()])])]) }),
  V("Garage startup", { size: { w: [19, 23], h: [15, 18] }, storeys: [1, 2], ground: "town", exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.3 }],
    plan: (D) => Y([7, X([7, D.bay("Garage lab")], ["*", D.lobby({ name: "Front room" })])], [1, D.hall()], ["*", X(["*", D.bench()], [5, D.techkit()], [3, D.wc()])]),
    up: (D) => Y([7, X(["*", D.bench("Loft")], [5, D.lounge()])], [1, D.hall()], ["*", X(["*", D.server("Server closet")], [4, D.wc()])]) }),
  V("Game studio", { storeys: [2, 3],
    plan: (D) => Y([6, X(["*", D.bench("Dev floor")], [6, D.lobby()], ["*", D.lounge("Games corner")])], [1, D.hall()], ["*", X(["*", D.studio("Motion-capture stage")], [5, D.techkit()], [4, D.server()], restroom)]),
    up: (D) => Y([6, X(["*", D.bench("Art floor")], [5, D.meet("Playtest room")], ["*", D.bench("Dev floor")])], [1, D.hall()], ["*", X(["*", D.lounge("Sound studio")], [4, D.booths()], restroom)]) }),
  V("Hardware lab", { storeys: [1, 2],
    plan: (D) => Y([6, X(["*", D.lab("Electronics lab")], [6, D.lobby()], ["*", D.bench()])], [1, D.hall()], ["*", X(["*", D.shopfloor("Prototype shop")], [5, D.it("Parts store")], [5, D.techkit()], restroom)]),
    up: (D) => Y([6, X(["*", D.bench()], [5, D.meet()])], [1, D.hall()], ["*", X(["*", D.lab("Test lab")], [4, D.booths()], restroom)]) }),
  V("Data company", { storeys: [2, 4], bonus: true,
    plan: (D) => Y([6, X(["*", D.bench()], [6, D.lobby()], ["*", D.secure()])], [1, D.hall()], ["*", X(["*", D.server("Data hall")], [6, D.plant("Cooling plant")], [5, D.techkit()], restroom)]),
    up: (D) => Y([6, X(["*", D.bench("Analysts' floor")], [5, D.meet()], ["*", D.bench()])], [1, D.hall()], ["*", X(["*", D.server()], [4, D.booths()], restroom)]) }),
  V("Coworking space", { storeys: [2, 3],
    plan: (D) => Y([6, X(["*", D.cafe("Coffee bar")], [6, D.lobby()], ["*", D.bench("Hot desks")])], [1, D.hall()], ["*", X(["*", D.priv("Private office")], ["*", D.priv("Private office")], [4, D.booths()], restroom)]),
    up: (D) => Y([6, X(["*", D.bench("Hot desks")], [5, D.meet()], ["*", D.priv("Private office")])], [1, D.hall()], ["*", X(["*", D.priv("Private office")], [5, D.lounge()], [4, D.booths()], restroom)]) }),
  V("Design agency", { storeys: [1, 2],
    plan: (D) => Y([6, X(["*", D.bench("Studio floor")], [6, D.lobby()], ["*", D.meet("Pitch room")])], [1, D.hall()], ["*", X(["*", D.shop("Print shop")], [5, D.lounge()], [5, D.techkit()], restroom)]),
    up: (D) => Y([6, X(["*", D.bench("Studio floor")], [5, D.priv("Creative director")])], [1, D.hall()], ["*", X(["*", D.files("Archive")], [4, D.booths()], restroom)]) }),
  V("Fintech office", { storeys: [2, 4], bonus: true,
    plan: (D) => Y([6, X(["*", D.bench("Trading floor")], [6, D.lobby({ fl: "marble" })], ["*", D.secure()])], [1, D.hall()], ["*", X(["*", D.vault("Secure room")], [5, D.server()], [5, D.techkit()], restroom)]),
    up: (D) => Y([6, X(["*", D.bench()], [5, D.board()], ["*", D.exec("Founder's office")])], [1, D.hall()], ["*", X(["*", D.bench("Quant floor")], [4, D.booths()], restroom)]) }),
  V("Robotics startup", { storeys: [1, 2], exits: [{ side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 2, lock: 0.3 }],
    plan: (D) => Y([6, X(["*", D.bench()], [6, D.lobby()], ["*", D.lab("Robotics lab")])], [1, D.hall()], ["*", X(["*", D.ware("Assembly floor")], [6, D.shopfloor("Machine shop")], restroom)]),
    up: (D) => Y([6, X(["*", D.bench()], [5, D.meet()])], [1, D.hall()], ["*", X(["*", D.techkit("Snack bar", "breakroom")], [4, D.booths()], restroom)]) }),
  V("Campus building", { storeys: [2, 3],
    plan: (D) => Y([6, X(["*", D.canteen("Café")], [6, D.lobby()], ["*", D.gym()])], [1, D.hall()], ["*", X(["*", D.kitchen()], [5, D.lockers()], ["*", D.bench()], restroom)]),
    up: (D) => Y([6, X(["*", D.bench()], [5, D.lounge("Games room")], ["*", D.bench()])], [1, D.hall()], ["*", X(["*", D.bench()], [4, D.booths()], [4, D.techkit("Snack bar", "breakroom")], restroom)]) }),
  V("Biotech startup", { storeys: [2, 3],
    plan: (D) => Y([6, X(["*", D.lab("Wet lab")], [6, D.lobby()], ["*", D.bench()])], [1, D.hall()], ["*", X(["*", D.lab("Wet lab")], [4, O("pantry", "coldstore", { name: "Cold room", type: "kitchen", dk: "coldroom" })], [5, D.techkit()], restroom)]),
    up: (D) => Y([6, X(["*", D.bench()], [5, D.meet()])], [1, D.hall()], ["*", X(["*", D.lab("Tissue culture lab")], [4, D.server()], restroom)]) }),
];

// ---------- a station: twelve plans (the firm's media picks the studio: TV, radio, the paper) ----------
const STATION = [
  { name: "News station", make: () => station },
  V("Small-market station", { size: { w: [18, 22], h: [14, 16] }, storeys: [1, 1], stairs: { roles: ["corridor"], n: 1 },
    plan: (D) => Y([6, X(["*", D.newsroom()], [5, D.lobby()], ["*", D.studio()])], [1, D.hall()], ["*", X(["*", D.control()], [5, D.archive()], [4, D.kit()], restroom)]) }),
  V("Radio house", { size: { w: [12, 15], h: [12, 15] }, storeys: [2, 2], ground: "town", stairs: { roles: ["hall", "lobby"], n: 1 },
    plan: (D) => Y([5, X(["*", D.lobby({ name: "Front parlour" })], ["*", D.studio()])], ["*", X(["*", D.kitchen("Old kitchen")], [3, { role: "hall", name: "Hall" }], ["*", D.control()])]),
    up: (D) => Y([5, X(["*", D.newsroom("Bedroom newsroom")], ["*", D.archive()])], ["*", X(["*", D.xmit()], [3, { role: "hall", name: "Landing" }], [3, D.wc()])]) }),
  V("Broadcast center", { size: { w: [26, 30], h: [17, 19] }, storeys: [3, 3], stairs: { roles: ["corridor"], n: 2, ends: true },
    plan: (D) => Y([6, X(["*", D.studio("Studio A")], [6, D.lobby()], ["*", D.studio("Studio B")])], [1, D.hall()], ["*", X(["*", D.control("Master control")], [5, D.lockers("Dressing room")], [5, D.brk()], restroom)]),
    up: (D, c) => (c.top ? Y([6, X(["*", D.exec("General manager's office")], [5, D.board()])], [1, D.hall()], ["*", X(["*", D.xmit()], [5, D.archive()], restroom)])
      : Y([6, X(["*", D.newsroom()], [5, D.meet()], ["*", D.newsroom("Sports desk")])], [1, D.hall()], ["*", X(["*", D.server("Edit suites")], [5, D.kit()], restroom)])) }),
  V("Paper with printing hall", { storeys: [1, 2], exits: [{ side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 2, lock: 0.3 }],
    plan: (D) => Y([6, X(["*", D.newsroom()], [5, D.lobby()], ["*", D.priv("Advertising office")])], [1, D.hall()], ["*", X(["*", D.ware("Printing hall")], [6, D.studio("Press room")], [4, D.brk()], restroom)]),
    up: (D) => Y([6, X(["*", D.newsroom("Editorial floor")], [5, D.exec("Editor's office")])], [1, D.hall()], ["*", X(["*", D.archive()], [4, D.xmit()], restroom)]) }),
  V("Station with satellite yard", { storeys: [1, 2], exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.3 }],
    plan: (D) => Y([6, X(["*", D.newsroom()], [5, D.lobby()], ["*", D.studio()])], [1, D.hall()], ["*", X(["*", D.bay("Truck bay")], [5, D.control()], [4, D.shopfloor("Engineering shop")], restroom)]),
    up: (D) => Y([6, X(["*", D.newsroom("Assignment desk")], [5, D.meet()])], [1, D.hall()], ["*", X(["*", D.archive()], [4, D.brk()], restroom)]) }),
  V("Public radio station", { storeys: [1, 2],
    plan: (D) => Y([6, X(["*", D.train("Community room")], [5, D.lobby()], ["*", D.studio()])], [1, D.hall()], ["*", X(["*", D.control()], [5, D.archive("Record library")], [4, D.kit()], restroom)]),
    up: (D) => Y([6, X(["*", D.priv("Membership office")], [5, D.meet()])], [1, D.hall()], ["*", X(["*", D.newsroom()], [4, D.xmit()], restroom)]) }),
  V("Station with weather center", { storeys: [2, 2],
    plan: (D) => Y([6, X(["*", D.newsroom()], [5, D.lobby()], ["*", D.studio()])], [1, D.hall()], ["*", X(["*", D.control()], [5, D.server("Weather center")], [4, D.lockers("Crew room")], restroom)]),
    up: (D) => Y([6, X(["*", D.priv("Meteorologists")], [5, D.meet()], ["*", D.exec("Station manager's office")])], [1, D.hall()], ["*", X(["*", D.archive()], [4, D.xmit()], restroom)]) }),
  V("News bureau", { size: { w: [16, 20], h: [13, 15] }, storeys: [1, 1],
    plan: (D) => Y([5, X(["*", D.newsroom("Bureau newsroom")], [5, D.lobby()])], [1, D.hall()], ["*", X(["*", D.studio()], [5, D.priv("Bureau chief")], [3, D.kit()], [2, D.wc()])]) }),
  V("Studio complex", { size: { w: [26, 30], h: [17, 19] }, storeys: [2, 2],
    plan: (D) => Y([6, X(["*", D.studio("Studio A")], [5, D.lobby()], ["*", D.studio("Studio B")])], [1, D.hall()], ["*", X(["*", D.lockers("Dressing rooms")], [5, D.lounge("Green room")], [5, D.control()], restroom)]),
    up: (D) => Y([6, X(["*", D.newsroom()], [5, D.meet()])], [1, D.hall()], ["*", X(["*", D.server("Edit suites")], [4, D.archive()], restroom)]) }),
  V("Transmitter site", { size: { w: [16, 20], h: [13, 16] }, storeys: [1, 1], ground: "town", exits: [exitBack(["workshop", "corridor"], 1)],
    plan: (D) => Y([5, X(["*", D.studio()], [5, D.lobby()])], [1, D.hall()], ["*", X(["*", D.xmit()], [5, D.plant("Generator room")], [3, D.wc()])]) }),
  V("Station with tape vault", { storeys: [2, 2],
    plan: (D) => Y([6, X(["*", D.newsroom()], [5, D.lobby()], ["*", D.studio()])], [1, D.hall()], ["*", X(["*", D.control()], [5, D.vault("Tape vault")], [4, D.brk()], restroom)]),
    up: (D) => Y([6, X(["*", D.archive()], [5, D.exec("Station manager's office")])], [1, D.hall()], ["*", X(["*", D.files("Music library")], [4, D.xmit()], restroom)]) }),
];

// ---------- the corporate tower: twelve plans ----------
// A tower variant: its ground floor's front band and back band (its stairwells SW at the ends, else at the core), the
// kinds of floor it stacks (TOWER_FLOORS: the first floor up, the specials it draws from, the one under the top) and its
// top floor. Every floor keeps the stairwells where the ground floor has them.
const TOWER_FLOORS = {
  open: (D) => [["*", D.open()], ["*", D.open()], [["*", D.open()], [4, D.brk()], restroom, ["*", D.meet()]]],
  exec: (D) => [["*", D.exec()], ["*", D.board()], [["*", D.exec()], [4, D.priv("Assistants' office")], restroom, ["*", D.exec()]]],
  canteen: (D) => [["*", D.canteen("Canteen")], ["*", D.canteen("Canteen")], [["*", D.kitchen("Canteen kitchen")], [3, O("pantry", "coldstore", { name: "Cold store", type: "kitchen", dk: "coldroom" })], restroom, ["*", D.open()]]],
  fitness: (D) => [["*", D.gym("Fitness center")], ["*", D.lockers()], [["*", D.gym("Fitness center")], [4, D.brk()], restroom, ["*", D.open()]]],
  it: (D) => [["*", D.server()], ["*", D.open("IT department", { type: "techfloor" })], [["*", D.open("IT department", { type: "techfloor" })], [4, D.it("IT stores")], restroom, ["*", D.server()]]],
  medical: (D) => [["*", D.exam("Clinic suite")], ["*", D.lounge("Clinic waiting room", { type: "clinic" })], [["*", D.exam("Clinic suite")], [4, D.drugs()], restroom, ["*", D.exam("Clinic suite")]]],
  law: (D) => [["*", D.priv("Partner's office")], ["*", D.lawlib("Firm library")], [["*", D.priv("Associates' offices")], [4, D.files()], restroom, ["*", D.meet("Conference room")]]],
  claims: (D) => [["*", D.call("Claims floor")], ["*", D.call("Claims floor")], [["*", D.files("Claims files")], [4, D.brk()], restroom, ["*", D.call("Claims floor")]]],
  media: (D) => [["*", D.studio("Studio")], ["*", D.newsroom()], [["*", D.control()], [4, D.archive()], restroom, ["*", D.newsroom()]]],
  gov: (D) => [["*", D.open("Agency offices")], ["*", D.clerk("Service counter")], [["*", D.files()], [4, D.brk()], restroom, ["*", D.open("Agency offices")]]],
  tech: (D) => [["*", D.bench()], ["*", D.lounge("Games corner")], [["*", D.bench()], [4, D.booths()], restroom, ["*", D.techkit("Snack bar", "breakroom")]]],
  cells: (D) => [["*", D.priv("Office")], ["*", D.priv("Office")], [["*", D.priv("Office")], [4, D.files()], restroom, ["*", D.priv("Office")]]],
  top: (D) => [["*", D.suite()], ["*", D.board()], [["*", D.plant("Roof plant")], [4, D.brk("Executive kitchen")], restroom, ["*", D.exec("Chairman's office")]]],
};
/** @type {any[]} */
const TOWER_VARIANTS = [
  { name: "Glass slab tower" }, // the plan above (tower)
  { name: "Centre-core tower", core: true, ground: (D) => [[["*", D.cafe()], "SW", "LOBBY", "SW", ["*", D.mail()]], [["*", D.bay()], [5, D.lockers("Couriers' room")], restroom, ["*", D.brk("Staff room")]]], floors: ["open", "exec", "it", "canteen"] },
  { name: "Atrium tower", ground: (D) => [["SW", ["*", D.cafe()], "LOBBY", ["*", D.shop("Newsstand")], "SW"], [["*", D.atrium()], [5, D.secure()], restroom, ["*", D.bay()]]], floors: ["open", "open", "exec", "fitness"] },
  { name: "Bank tower", ground: (D) => [["SW", ["*", D.bank()], "LOBBY", ["*", D.priv("Loan office")], "SW"], [["*", D.vault()], [5, D.secure()], restroom, ["*", D.bay()]]], floors: ["open", "exec", "claims", "it"] },
  { name: "Retail podium tower", ground: (D) => [["SW", ["*", D.shop()], "LOBBY", ["*", D.shop("Shop 2")], "SW"], [["*", D.canteen("Food court")], [5, D.kitchen()], restroom, ["*", D.bay()]]], floors: ["open", "fitness", "exec", "canteen"] },
  { name: "Medical office tower", ground: (D) => [["SW", ["*", D.drugs()], "LOBBY", ["*", D.lounge("Patient lounge", { type: "clinic" })], "SW"], [["*", D.exam("Urgent care")], [5, D.secure()], restroom, ["*", D.bay()]]], floors: ["medical", "medical", "open", "exec"] },
  { name: "Law firm tower", ground: (D) => [["SW", ["*", D.cafe()], "LOBBY", ["*", D.lawlib("Reading room")], "SW"], [["*", D.mail()], [5, D.secure()], restroom, ["*", D.bay()]]], floors: ["law", "law", "exec", "cells"] },
  { name: "Insurance headquarters", ground: (D) => [["SW", ["*", D.call("Claims counter")], "LOBBY", ["*", D.mail()], "SW"], [["*", D.files("Claims archive")], [5, D.secure()], restroom, ["*", D.bay()]]], floors: ["claims", "claims", "open", "exec"] },
  { name: "Media tower", ground: (D) => [["SW", ["*", D.cafe()], "LOBBY", ["*", D.studio("Street-level studio")], "SW"], [["*", D.control()], [5, D.lockers("Dressing room")], restroom, ["*", D.bay()]]], floors: ["media", "open", "media", "exec"] },
  { name: "Government office tower", ground: (D) => [["SW", ["*", D.clerk("Service center")], "LOBBY", ["*", D.lounge("Waiting hall")], "SW"], [["*", D.files()], [5, D.secure()], restroom, ["*", D.bay()]]], floors: ["gov", "gov", "open", "cells"] },
  { name: "Brutalist office block", wide: true, ground: (D) => [["SW", ["*", D.open("Plaza offices")], "LOBBY", ["*", D.canteen("Staff canteen")], "SW"], [["*", D.plant("Boiler room")], [5, D.secure()], restroom, ["*", D.kitchen()]]], floors: ["cells", "cells", "open", "gov"] },
  { name: "Tech campus tower", ground: (D) => [["SW", ["*", D.cafe("Coffee bar")], "LOBBY", ["*", D.lounge("Games corner")], "SW"], [["*", D.gym()], [5, D.secure()], restroom, ["*", D.bay()]]], floors: ["tech", "tech", "it", "canteen"] },
];
/** @param {any} v @param {any} rng @param {any} o @param {any} plan @param {number} max */
function towerVariant(v, rng, o, plan, max) {
  const S = v.wide ? { w: [28, 32], h: [16, 18] } : SIZE.tower;
  const n = storeysOf(rng, "tower", plan, o, max);
  const bw = roll(rng, S.w), bh = roll(rng, S.h), fd = 6, lw = rng.int(5, 6);
  const D = SLOTS(plan), SW = [2, { role: "stairwell" }];
  const lobby = front(O("lobby", "towerlobby", { entry: true, name: "Lobby", fl: "marble", maxBoxes: 1 }), plan);
  const fill = (list, mid) => list.map((x) => (x === "SW" ? SW : x === "LOBBY" ? [lw + 2, lobby] : x === "LIFT" ? mid : x));
  const [gf, gb] = v.ground(D);
  // The floors above: the first of v.floors first, the one under the top the second-last (5+ storeys), the rest drawn.
  const kinds = ["ground"], pool = rng.shuffle(v.floors.slice(1));
  for (let f = 1; f < n; f++) kinds.push(f === n - 1 ? "top" : f === 1 ? v.floors[0] : pool.length && rng.chance(0.7) ? pool.pop() : "open");
  const lift = [lw, O("lobby", "liftlobby", { name: "Lift lobby", hub: true, maxBoxes: 0, type: null })];
  const floorOf = (f) => {
    const [a, b, back] = (TOWER_FLOORS[kinds[f]] || TOWER_FLOORS.open)(D);
    const frontBand = v.core ? [a, SW, lift, SW, b] : [SW, a, lift, b, SW];
    return corridorPlan(frontBand, back, fd);
  };
  return {
    bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: { roles: ["stairwell"], n: 2, len: 3 }, floorKinds: kinds, variant: v.name,
    program: corridorPlan(fill(gf), gb, fd),
    upper: (f) => floorOf(f),
    exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.4, name: "Loading dock" }, ...fire(0.4)],
  };
}

/** @type {Record<string, { name: string, make: (kind: string) => (rng: any, o: any, plan: any, max: number) => any }[]>} */
export const OFFICE_VARIANTS = {
  storefront: STOREFRONT, bizpark: BIZPARK, cityhall: CITYHALL, courthouse: COURTHOUSE, callcenter: CALLCENTER, techoffice: TECHOFFICE, station: STATION,
  tower: TOWER_VARIANTS.map((v, i) => (i === 0 ? { name: v.name, make: () => tower } : { name: v.name, make: () => (rng, o, plan, max) => towerVariant(v, rng, o, plan, max) })),
};
// The plan a building takes: o.plan (a name or an index), else by its dice.
/** @param {string} kind @param {any} rng @param {any} o */
export function pickVariant(kind, rng, o) {
  const L = OFFICE_VARIANTS[kind];
  if (o && o.plan != null) { const i = typeof o.plan === "number" ? o.plan : L.findIndex((v) => v.name === o.plan); if (i >= 0 && L[i]) return L[i]; }
  return L[rng.int(0, L.length - 1)];
}
const dispatch = (kind) => (rng, o, plan, max) => { const v = pickVariant(kind, rng, o || {}); const spec = v.make(kind)(rng, o || {}, plan, max); spec.variant = v.name; return spec; };
export const OFFICE_PLANS = { storefront: dispatch("storefront"), bizpark: dispatch("bizpark"), tower: dispatch("tower"), cityhall: dispatch("cityhall"), courthouse: dispatch("courthouse"), callcenter: dispatch("callcenter"), techoffice: dispatch("techoffice"), station: dispatch("station") };
