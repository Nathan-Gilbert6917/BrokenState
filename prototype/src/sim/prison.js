// @ts-check
// Prison complexes (the user's request 2026-10-25, issue #31 of the interiors epic #7: "add … prisons max of 400x400").
// A prison site (data.js LOCATIONS prison) and a county jail (the jail POI, pois.js jailExtra: one in a suburb ring of
// each town) open one map of many buildings instead of a pick of one (buildingmaps.js buildingMap → prisonMap), laid out
// through compound.js (the multi-building map shared with the malls, #30, and the campus, #28) and furnished by prisonlayout.js. New saves
// only: an older save (worldcfg.js legacyPrisons, no state.prisonV) keeps the prison's one-building pick and no jails.
//
// The kinds (PRISON.KINDS; a prison site is a state prison or a maximum-security penitentiary by its own dice):
//   jail   County jail: about 120 × 100 in a town: the jail building (2 storeys: the sally port with a patrol car,
//          booking and intake with fingerprints and the metal detector, the public lobby, visitation's booths, holding
//          tanks, the property room of the inmates' belongings, the kitchen, the medical room; upstairs the control
//          room, the jail's offices, records, a break room) and two housing pods of two-tier cells round day rooms,
//          joined to it by secure corridors (an L or a T of buildings), a fenced pen for the yard off a pod, the street in
//          front with parked cars, a staff lot. 50–200 beds. No perimeter fence and no towers: it stands in town.
//   state  State prison (medium security): 240–300 square (up to 350 once the cap is raised): a double perimeter fence
//          of chain-link topped with razor wire (CELL pfence) with razor wire between the two lines (CELL wire, razor),
//          guard towers at the corners and along the fence (CELL tower), a sally port for vehicles (a gate in each fence
//          line and a fenced pen between with an inner gate: the evacuation bus's place) and a gatehouse for people
//          straddling the two fences (a metal detector, the officers' post). Inside: 3–6 housing units (two-tier cell
//          blocks facing a day room, or dormitory units of bunks) off a main corridor (the telephone pole), joined to it
//          by short secure corridors with sally-port doors, central control at its end; the chow hall with its kitchen and
//          food warehouse, the exercise yard (a track, a basketball court, weights, bleachers), the infirmary (a ward, a
//          pharmacy, a psych unit), a chapel, the library and education building, prison industries (the licence-plate
//          shop, the print shop, the laundry), the segregation unit (single cells); outside the fence the
//          administration building (the warden's office, records), the armory (riot gear, shotguns, rifles) and the
//          staff parking. 500–1,500 beds (the beds a map holds are reported: prisonBeds).
//   max    Maximum-security penitentiary: as the state prison, 300 square up to 400 once the cap is raised: a high wall
//          (two levels, c.t) outside the fence instead of the outer fence, towers every 40 cells, more housing units off a
//          longer main corridor (6–8), and a death row wing (single cells on two tiers, a security door into each tier:
//          a sally port per tier).
//
// Cell blocks (housingUnit): an officers' station (the picket) the depth of the block at one end, the stairs in it; the
// day room in the middle; a tier of cells (prisonlayout.js tier) along the front wall and one along the back, each cell a
// steel bunk, a steel toilet-and-sink unit behind bars with a cell door; upstairs the same tiers round an open well
// over the day room (openTiers: the well is open air, its edge a railing, so the upper tier is a walkway with a railing
// looking down on the day room; downstairs the wall between the tiers and the day room is gone). A tier's doors stand by
// the unit's state (PRISON.DOORS: opened, shut, or still locked from central control); the panel in the officers'
// station or in central control opens them (cellSwitch: loud).
// The raid: the plan's intro names the housing units, the armory and the gate (prisonIntro); the dead are dense in the
// housing units (their rooms weigh PRISON.DENSE more in buildingmaps.js placeInterior) and the map holds more of them
// (map.deadScale); the guards lie dead at their posts with their kit (the towers, the gatehouse, the pickets, central
// control: PRISON.POSTS); raiders or a prison gang may hold a unit (floorfolk.js / wanderers.js interiorOccupants: the
// plan's hold room). The ways out are the zones at the map's edge outside the perimeter: from inside only through the
// gates, a hole in the fence (PRISON.HOLES) or one cut (wire.js: FENCE_CUTS cuts with a cutter). #25's barrier gates and
// guard booth stand at the checkpoint on the approach road.
import { Rng } from "./rng.js";
import { realFoot } from "./data-buildingsize.js"; // the buildings' footprints (#24's REAL_SIZE rows, a metre a cell)
import { hash01 } from "./skills.js";
import { assemble, BMAP, DOOR_KINDS } from "./buildingmaps.js"; // call-time only (buildingmaps.js builds the complexes through here)
import { placeCar, placeVehicle, CELL } from "./combat.js";
import { mapCap } from "./battlesize.js"; // the per-site map cap (#24): a prison's 400, a jail's 130
import { compoundGrid, placeBuilding, link, guard, parkingLot, compoundResult, compoundVehicle, orient } from "./compound.js"; // the multi-building map shared with #28 and #30

export const PRISON = {
  // The map's cap (cells a side): the user's "max of 400x400", battlesize.js MAP_CAP prison (#24's big-map engine work is
  // on dev; it was 300 until then). A jail's is MAP_CAP jail.
  CAP: 400,
  KINDS: {
    jail:  { name: "County jail", map: [[110, 130], [95, 110]], beds: [50, 200], units: [2, 2] },
    state: { name: "State prison", map: [[250, 350], null], beds: [500, 2000], units: [4, 6], tower: 60, gap: 4 },
    max:   { name: "Maximum-security penitentiary", map: [[300, 400], null], beds: [500, 2000], units: [6, 8], tower: 40, gap: 4 },
  },
  MAX_SHARE: 0.35,            // a prison site is a maximum-security penitentiary on these dice (else a state prison)
  DOORS: { opened: 0.3, shut: 0.45, locked: 0.25 }, // a block's cell doors: open, shut, locked from central control
  HOLES: [0, 2],              // holes in a state prison's fence (where some got out): each through both lines
  DENSE: 4,                   // the housing units' rooms weigh this much more for the dead (placeInterior)
  DEAD: { jail: 1.6, state: 5, max: 5.5 }, // the dead: the site's roster × this (map.deadScale)
  HOLD: { chance: 0.4, n: [3, 6], power: 3, guns: ["shiv", "shiv", "baton", "baton", "shotgun", "pistol", "machete"] }, // a prison gang holding a unit (prisonHolders)
  POSTS: 0.7,                 // a guard's body at a post (a tower, a picket, the gatehouse, central control)
  RING: 14,                   // cells of open ground round the perimeter to the map's edge (the perimeter road in it)
  FRONT: 40,                  // the strip in front (south) of the perimeter: the administration, the armory, the parking
  UNIT_GAP: 7,                // the secure corridor between the main corridor and a housing unit
};
export const PRISON_KEYS = ["prison", "jail"]; // the complexes' building keys (buildingmaps.js BUILDINGS)

// Which kind a site's map is: a jail's, else a prison's by the site's own dice.
/** @param {any} state @param {number} tileId @param {{ key: string, id: string }} option */
export function prisonKind(state, tileId, option) {
  if (option.key === "jail") return "jail";
  return hash01(state.seed, "prisonkind", tileId) < PRISON.MAX_SHARE ? "max" : "state";
}

// ======================================================================================
// The buildings (specs for buildingmaps.js assemble; margins of one cell: the complex's ground replaces them)
// ======================================================================================
const ring1 = { front: 1, back: 1, left: 1, right: 1 };
const leaves = (list) => list.map(([s, r]) => [s, typeof r === "string" ? { role: r } : r]);
const corridorPlan = (front, back, fd, cw = 1) => ({ split: "y", parts: [[fd, { split: "x", parts: leaves(front) }], [cw, { role: "corridor" }], ["*", { split: "x", parts: leaves(back) }]] });
const spec = (bw, bh, program, o = {}) => ({ bw, bh, front: { width: 1 }, ground: "none", storeys: 1, foot: "large", margins: ring1, program, exits: [], ...o });

// A building's footprint from its REAL_SIZE row (data-buildingsize.js, #24): [bw, bh] in cells.
const foot = (rng, key) => { const F = realFoot(rng, key); return F ? [F.bw, F.bh] : [20, 14]; };
// The named plans of each prison building (the user's request for a dozen variants of every building, issue #32's
// rule; prisonvarianttest.js counts them): { id, name, ...its choices }. A building takes its plan by o.plan (pinned:
// the tests, the renders) or its own dice (pickPlan), from the plans its use allows (o.only).
export const PRISON_PLANS = {};
/** @param {any} rng @param {string | any[]} type @param {any} o */
export function pickPlan(rng, type, o = {}) {
  const all = Array.isArray(type) ? type : PRISON_PLANS[type] || [];
  const ok = all.filter((v) => !o.only || o.only(v));
  const want = o.plan ?? o.layout; // o.plan pins a building's plan (the other plan pickers' convention), o.layout a complex's
  return (want && all.find((v) => v.id === want)) || ok[Math.floor(rng.next() * ok.length)] || all[0];
}
// A housing unit's plans: tiers (2, or 3), where its officers' station stands (picket: at one end, at both, in the
// middle between two half blocks), its core (cells both sides of the day room, cells one side, a dormitory of bunks,
// a dormitory of cubicles), and a room of its own across the far end or by the station (extra: showers, a classroom,
// intake, the unit's kitchen, a laundry); single: single cells (an honor block).
PRISON_PLANS.housing = [
  { id: "twotier", name: "Two-tier block" },
  { id: "threetier", name: "Three-tier block (a gun gallery at the top tier's end)", tiers: 3, gallery: true },
  { id: "splitpod", name: "Split pod (two half blocks either side of a pod control)", picket: "split" },
  { id: "singleloaded", name: "Single-loaded block (one row of cells facing the day room)", core: "single", side: "restroom" },
  { id: "doublepicket", name: "Block with a station at each end (a riot-gear closet at the far one)", picket: "both", side: "closet" },
  { id: "showers", name: "Block with its showers across the end", extra: "showers" },
  { id: "programs", name: "Programs block (a classroom at the end)", extra: "classroom" },
  { id: "intake", name: "Intake block (receiving by the station)", extra: "intake", near: true },
  { id: "dorm", name: "Open-bay dormitory", core: "dorm" },
  { id: "cubicles", name: "Cubicle dormitory", core: "cubicles" },
  { id: "honor", name: "Honor block (single cells, a unit kitchen)", single: true, extra: "kitchen" },
  { id: "laundry", name: "Block with its own laundry", extra: "laundry" },
];
const cellsPlan = (v) => !v.core || v.core === "single"; // a plan with cells (death row, segregation and a jail's pods take only these)
// A housing unit. o: { len, day, tiers, picket: "left" | "right" (the side of the station toward the corridor),
// unitId, kind: "cells" | "dorm" (a wish: a dorm picks a dormitory plan), single, dk, name, yard, plan, only }.
export function housingUnit(rng, o) {
  const v = pickPlan(rng, "housing", { plan: o.plan, only: (q) => (o.kind === "dorm" ? !cellsPlan(q) : o.kind === "cells" || o.single ? cellsPlan(q) : true) && (!o.only || o.only(q)) });
  const day = o.day ?? rng.int(7, 10), unitId = o.unitId ?? 0;
  const tiers = o.tiers === 1 ? 1 : v.tiers || o.tiers || 2;
  const left = o.picket !== "right";
  const single = !!(o.single || v.single);
  const core = v.core || "double", dorm = core === "dorm" || core === "cubicles";
  const tier = (face, f) => ({ role: "tier", prison: "tier", face, unitId, name: `${face === "n" ? "Back" : "Front"} ${["lower", "upper", "top"][f] || "upper"} tier`, ...(o.dk ? { dk: o.dk } : {}), ...(single ? { single: true } : {}), dense: PRISON.DENSE });
  const day0 = (f) => (f ? { role: "well", prison: "dayroom", well: true, unitId } : { role: "pdayroom", prison: "dayroom", unitId, name: "Day room", dense: PRISON.DENSE });
  const coreOf = (f) => dorm ? { role: core === "cubicles" ? "pcubicles" : "pdorm", prison: core === "cubicles" ? "cubicles" : "dorm", unitId, name: `${core === "cubicles" ? "Cubicles" : "Dormitory"}${f ? " (upstairs)" : ""}`, dense: PRISON.DENSE }
    : core === "single" ? { split: "y", parts: [["*", day0(f)], [5, tier("n", f)]] }
    : { split: "y", parts: [[5, tier("s", f)], ["*", day0(f)], [5, tier("n", f)]] };
  // An officers' station (the prison mark "picket": openTiers gives the tiers their doors into it): the top tier's a gun
  // gallery (three tiers), a split pod's middle one the pod control; on the ground a room off its end (side).
  const picket = (f, n = "", o = {}) => {
    const role = o.role || (v.gallery && f === tiers - 1 && f > 0 ? "pgallery" : "picket");
    const leaf = { role, prison: "picket", unitId, hub: true, ...(o.name ? { name: o.name } : role === "pgallery" ? {} : f ? { name: `Upper officers' station${n}` } : n ? { name: `Officers' station${n}` } : { entry: true }) };
    const side = !f && o.side ? { restroom: [3, { role: "restroom", name: "Officers' restroom" }], closet: [3, { role: "storage", name: "Riot-gear closet", type: "pcontrol", lock: ["door", 0.5] }] }[o.side] : null;
    return [5, side ? { split: "y", parts: [side, ["*", leaf]] } : leaf];
  };
  const EXTRA = { showers: { role: "pshower", prison: "showers", name: "Showers" }, classroom: { role: "classroom", civic: "classroom", name: "Unit classroom" },
    intake: { role: "booking", prison: "booking", name: "Receiving" }, kitchen: { role: "pkitchen", prison: "pkitchen", name: "Unit kitchen" }, laundry: { role: "plaundry", prison: "laundry", name: "Unit laundry" } };
  // Upstairs over it: the unit's store (at the far end, its door at a tier's walkway), or by the station a second
  // station (the tiers' way to the stairs).
  const extra = (f) => (v.extra ? [6, !f ? { ...EXTRA[v.extra], unitId } : v.near ? { role: "picket", prison: "picket", unitId, hub: true, name: "Upper control room" } : { role: "storage", name: "Unit store", type: "pcontrol" }] : null);
  const plan = (f) => {
    const c = ["*", coreOf(f)], e = extra(f);
    let parts;
    const near = picket(f, "", { side: v.picket ? null : v.side });
    if (v.picket === "both") parts = left ? [near, c, picket(f, " (far end)", { side: v.side })] : [picket(f, " (far end)", { side: v.side }), c, near];
    else if (v.picket === "split") { const pod = picket(f, "", { role: "ppodctl", name: f ? "Upper pod control" : "Pod control" }); parts = left ? [near, c, pod, ["*", coreOf(f)]] : [["*", coreOf(f)], pod, c, near]; }
    else parts = left ? [near, ...(e && v.near ? [e] : []), c] : [c, ...(e && v.near ? [e] : []), near];
    if (e && !v.near) { if (left) parts.push(e); else parts.unshift(e); }
    return { split: "x", parts };
  };
  const bh = dorm ? rng.int(18, 22) : core === "single" ? 2 + day + 3 + 1 + 5 : 2 + 5 + 1 + day + 1 + 5;
  return spec(o.len, bh, plan(0), {
    storeys: tiers, stairs: { roles: ["picket"], n: 1, len: 2 }, upper: tiers > 1 ? (f) => plan(f) : null,
    exits: o.yard ? [{ side: left ? "right" : "left", roles: [dorm ? (core === "cubicles" ? "pcubicles" : "pdorm") : "pdayroom", "pshower", "classroom", "booking", "pkitchen", "plaundry", "picket"], chance: 1, lock: 0.3, name: "Yard door" }] : [],
    unit: { unitId, kind: dorm ? "dorm" : "cells", left, tiers, name: o.name, dk: o.dk || null, plan: v.id },
    vid: v.id, vname: v.name,
  });
}
// The main corridor (the telephone pole): one long hall, 3 wide.
const spine = (len) => spec(5, len, { role: "mainhall", name: "Main corridor", entry: true });
// The other buildings' plans: each a { id, name, plan(rng, bw, bh) } (its program; o: the spec's other fields), the
// first today's. Each has its own rooms (#32's plan signature: the rooms' roles and the doors between them).
const col = (list) => ({ split: "x", parts: leaves(list) }), band = (list) => ({ split: "y", parts: leaves(list) });
const P_ = {
  control: (name = "Central control", panels = 4) => ({ role: "pcontrol", prison: "control", panels, name }),
  lobby: (name) => ({ role: "lobby", entry: true, name }),
  property: (name = "Receiving and property") => ({ role: "property", prison: "property", name, lock: ["door", 0.4] }),
  office: (name, o = {}) => ({ role: "office", prison: "office", name, ...o }),
  store: (name, type, o = {}) => ({ role: "storage", name, type, ...o }),
  lockers: (name = "Officers' lockers") => ({ role: "lockerroom", type: "lockers", name }),
  booking: (name = "Booking") => ({ role: "booking", prison: "booking", name }),
  holding: (name = "Holding tank") => ({ role: "holding", prison: "holding", name }),
  visit: (name = "Visitation") => ({ role: "visitation", prison: "visit", name }),
  ward: (name = "Infirmary ward") => ({ role: "pward", prison: "ward", name }),
  kitchen: (name = "Prison kitchen") => ({ role: "pkitchen", prison: "pkitchen", name }),
  stores: (name = "Food warehouse") => ({ role: "pstores", prison: "pstores", name, lock: ["door", 0.4] }),
  shop: (name) => ({ role: "pshop", prison: "industries", name }),
  laundry: (name = "Laundry") => ({ role: "plaundry", prison: "laundry", name }),
  armory: (name = "Armory", o = {}) => ({ role: "parmory", prison: "parmory", name, ...o }),
  classroom: (name = "Classroom") => ({ role: "classroom", civic: "classroom", name }),
  library: (name = "Library") => ({ role: "plibrary", civic: "library", name }),
  gate: (name, entry) => ({ role: "gatepost", prison: "gate", name, ...(entry ? { entry: true } : {}) }),
};
const R = (role, name, o = {}) => ({ role, ...(name ? { name } : {}), ...o });
// Central control (a full-depth lobby column in every plan: the main corridor's secure corridor joins it from either end).
PRISON_PLANS.control = [
  { id: "standard", name: "Control, lobby, receiving and the shift office", plan: () => col([["*", P_.control()], [6, P_.lobby("Control lobby")], [7, P_.property()], ["*", P_.office("Shift office")]]) },
  { id: "radio", name: "Control with a radio room and a key room", plan: () => col([["*", P_.control()], [6, P_.lobby("Control lobby")], ["*", band([["*", P_.office("Radio room")], [4, P_.store("Key room", "pcontrol", { lock: ["door", 0.6] })]])], [7, P_.property()]]) },
  { id: "lockers", name: "Control with the officers' lockers", plan: () => col([["*", P_.control()], [6, P_.lobby("Control lobby")], ["*", P_.lockers()], ["*", P_.office("Shift office")]]) },
  { id: "breakroom", name: "Control with a break room", plan: () => col([["*", P_.control()], [6, P_.lobby("Control lobby")], [7, P_.property()], ["*", band([["*", "breakroom"], [3, "restroom"]])]]) },
  { id: "intake", name: "Control with booking and a holding cell", plan: () => col([["*", P_.control()], [6, P_.lobby("Control lobby")], ["*", P_.booking("Receiving")], [6, P_.holding("Holding cell")]]) },
  { id: "visits", name: "Control with the visiting room", plan: () => col([["*", P_.control()], [6, P_.lobby("Control lobby")], ["*", P_.visit("Visiting room")], [6, P_.office("Visits officer")]]) },
  { id: "compact", name: "Compact control (the room and its lobby)", plan: () => col([[6, P_.lobby("Control lobby")], ["*", P_.control()]]) },
  { id: "equipment", name: "Control with an equipment room behind", plan: () => col([["*", band([["*", P_.control()], [4, P_.store("Equipment room", "pcontrol")]])], [6, P_.lobby("Control lobby")], [7, P_.property()]]) },
  { id: "staff", name: "Control with lockers and a restroom", plan: () => col([["*", P_.control()], [6, P_.lobby("Control lobby")], ["*", P_.lockers()], [4, "restroom"]]) },
  { id: "armory", name: "Control with its own armory", plan: () => col([["*", P_.control()], [6, P_.lobby("Control lobby")], ["*", P_.armory("Control armory", { lock: ["vault", 0.7] })]]) },
  { id: "mail", name: "Control with the mail room and the property store", plan: () => col([["*", P_.control()], [6, P_.lobby("Control lobby")], ["*", P_.office("Mail room")], ["*", P_.store("Inmates' property store", "property")]]) },
  { id: "records", name: "Control with the records office", plan: () => col([["*", P_.office("Records", { boxLock: ["evidence", 0.3] })], [6, P_.lobby("Control lobby")], ["*", P_.control()], [4, "restroom"]]) },
];
// The chow hall: a hall (or two) and the kitchen with its stores behind or beside it; the loading dock at the back.
const chowBack = (list) => [8, col(list)];
PRISON_PLANS.chow = [
  { id: "standard", name: "Hall, kitchen, food warehouse and dry store", plan: () => band([["*", R("chow", undefined, { prison: "chow", entry: true })], chowBack([["*", P_.kitchen()], [10, P_.stores()], [5, P_.store("Dry store", "pstores")]])]) },
  { id: "bakery", name: "Hall with a bakery", plan: () => band([["*", R("chow", undefined, { prison: "chow", entry: true })], chowBack([["*", P_.kitchen()], [8, P_.kitchen("Bakery")], [10, P_.stores()]])]) },
  { id: "staffmess", name: "Hall and the officers' mess", plan: () => band([["*", col([["*", R("chow", undefined, { prison: "chow", entry: true })], [9, R("breakroom", "Officers' mess")]])], chowBack([["*", P_.kitchen()], [10, P_.stores()], [5, P_.store("Dry store", "pstores")]])]) },
  { id: "twohalls", name: "Two halls round one kitchen", plan: () => band([["*", col([["*", R("chow", "North hall", { prison: "chow", entry: true })], ["*", R("chow", "South hall", { prison: "chow" })]])], chowBack([["*", P_.kitchen()], [10, P_.stores()], [5, P_.store("Dry store", "pstores")]])]) },
  { id: "servery", name: "Hall with a serving line", plan: () => band([["*", R("chow", undefined, { prison: "chow", entry: true })], [3, R("corridor", "Serving line")], chowBack([["*", P_.kitchen()], [10, P_.stores()], [5, P_.store("Dry store", "pstores")]])]) },
  { id: "washroom", name: "Hall with the inmates' washroom", plan: () => band([["*", col([["*", R("chow", undefined, { prison: "chow", entry: true })], [4, "restroom"]])], chowBack([["*", P_.kitchen()], [10, P_.stores()], [5, P_.store("Dry store", "pstores")]])]) },
  { id: "office", name: "Hall with the food service office", plan: () => band([["*", R("chow", undefined, { prison: "chow", entry: true })], chowBack([["*", P_.kitchen()], [10, P_.stores()], [5, P_.store("Walk-in cooler", "pstores")], [5, P_.office("Food service office")]])]) },
  { id: "sidekitchen", name: "Hall with the kitchen beside it", plan: () => col([["*", R("chow", undefined, { prison: "chow", entry: true })], [12, band([["*", P_.kitchen()], [6, P_.stores()], [5, P_.lockers("Kitchen workers' lockers")]])]]) },
  { id: "commissary", name: "Hall with the commissary", plan: () => band([["*", R("chow", undefined, { prison: "chow", entry: true })], chowBack([["*", P_.kitchen()], [10, P_.stores()], [8, R("pcommissary", "Commissary", { prison: "pstores", lock: ["door", 0.5] })]])]) },
  { id: "grill", name: "Hall, kitchen and a staff restroom", plan: () => band([["*", R("chow", undefined, { prison: "chow", entry: true })], chowBack([["*", P_.kitchen()], [10, P_.stores()], [4, "restroom"]])]) },
  { id: "butcher", name: "Hall with a butcher's room", plan: () => band([["*", R("chow", undefined, { prison: "chow", entry: true })], chowBack([["*", P_.kitchen()], [6, P_.kitchen("Butcher's room")], [10, P_.stores()], [5, P_.store("Dry store", "pstores")]])]) },
  { id: "small", name: "Small hall and kitchen", plan: () => band([["*", R("chow", undefined, { prison: "chow", entry: true })], chowBack([["*", P_.kitchen()], [8, P_.store("Dry store", "pstores")]])]) },
];
// The infirmary: front rooms off a corridor, back rooms behind it (the psych unit's cells in most).
const psych = (name = "Psych unit", face = "n") => R("psych", name, { prison: "tier", face, single: true });
const infirm = (front, back) => () => corridorPlan(front, back, 6, 2);
const INF_FRONT = [["*", P_.ward()], [5, P_.lobby("Infirmary desk")], [5, "exam"], [5, R("pharmroom", undefined, { lock: ["door", 0.6], boxLock: ["drugs", 0.5] })]];
const pharm = () => R("pharmroom", undefined, { lock: ["door", 0.6], boxLock: ["drugs", 0.5] });
PRISON_PLANS.infirmary = [
  { id: "standard", name: "Ward, desk, exam room and pharmacy; the psych unit behind", plan: infirm(INF_FRONT, [["*", psych()], [5, P_.office("Doctor's office")], [4, P_.store("Medical stores", "clinic")]]) },
  { id: "dental", name: "Infirmary with a dental clinic", plan: infirm(INF_FRONT, [["*", psych()], [6, R("exam", "Dental clinic")], [4, P_.store("Medical stores", "clinic")]]) },
  { id: "medical", name: "Medical ward (no psych unit)", plan: infirm(INF_FRONT, [["*", P_.ward("Long-term ward")], [5, P_.office("Doctor's office")], [4, P_.store("Medical stores", "clinic")]]) },
  { id: "isolation", name: "Infirmary with isolation rooms", plan: infirm(INF_FRONT, [["*", psych()], ["*", P_.ward("Isolation rooms")], [4, P_.store("Medical stores", "clinic")]]) },
  { id: "xray", name: "Infirmary with an X-ray room", plan: infirm([["*", P_.ward()], [5, P_.lobby("Infirmary desk")], [5, "exam"], [5, R("exam", "X-ray room")]], [["*", psych()], [5, pharm()], [5, P_.office("Doctor's office")]]) },
  { id: "nursing", name: "Infirmary with the nurses' room", plan: infirm(INF_FRONT, [["*", psych()], [5, R("breakroom", "Nurses' room")], [4, "restroom"]]) },
  { id: "hospice", name: "Hospice (two wards)", plan: infirm([["*", P_.ward()], [5, P_.lobby("Infirmary desk")], [5, pharm()]], [["*", P_.ward("Hospice")], [5, P_.office("Doctor's office")], [4, P_.store("Medical stores", "clinic")]]) },
  { id: "waiting", name: "Infirmary with a waiting cell", plan: infirm([["*", P_.ward()], [5, P_.lobby("Infirmary desk")], [6, P_.holding("Waiting cell")], [5, "exam"]], [["*", psych()], [5, pharm()], [4, P_.store("Medical stores", "clinic")]]) },
  { id: "observation", name: "Mental health unit (observation cells both sides, a sick bay)", plan: infirm([["*", psych("Observation cells", "s")], [5, P_.lobby("Infirmary desk")], [5, "exam"], [6, P_.ward("Sick bay")]], [["*", psych()], [5, P_.office("Psychologist's office")], [4, P_.store("Medical stores", "clinic")]]) },
  { id: "lab", name: "Infirmary with a lab and a restroom", plan: infirm(INF_FRONT, [["*", psych()], [5, P_.office("Doctor's office")], [5, P_.store("Lab", "clinic")], [4, "restroom"]]) },
  { id: "counselling", name: "Counselling at the front, the psych unit and a sick bay behind", plan: infirm([["*", P_.office("Counselling")], [5, P_.lobby("Infirmary desk")], [5, "exam"], [5, pharm()]], [["*", psych()], [6, P_.ward("Sick bay")], [4, "restroom"]]) },
  { id: "trauma", name: "Infirmary with a trauma room and the staff lockers", plan: infirm([["*", P_.ward()], [5, P_.lobby("Infirmary desk")], ["*", R("exam", "Trauma room")], [5, pharm()]], [["*", psych()], [5, P_.office("Doctor's office")], [4, P_.store("Medical stores", "clinic")], [5, P_.lockers("Staff lockers")]]) },
];
// The chapel: the narthex, the nave, the rooms behind it.
const narthex = [3, R("foyer", "Narthex", { entry: true, type: "chapel", civic: "narthex" })], nave = (name = "Chapel") => R("nave", name, { civic: "nave" });
const vestry = () => R("vestry", undefined, { civic: "vestry" });
PRISON_PLANS.chapel = [
  { id: "standard", name: "Chapel with a vestry and the chaplain's store", plan: () => band([narthex, ["*", nave()], [4, col([[4, vestry()], ["*", P_.store("Chaplain's store", "chapel")]])]]) },
  { id: "office", name: "Chapel with the chaplain's office", plan: () => band([narthex, ["*", nave()], [4, col([[4, vestry()], ["*", P_.office("Chaplain's office")]])]]) },
  { id: "multifaith", name: "Chapel and a multi-faith room", plan: () => band([narthex, ["*", nave()], [6, nave("Multi-faith room")], [4, col([[4, vestry()], ["*", P_.store("Chaplain's store", "chapel")]])]]) },
  { id: "study", name: "Chapel with a study room", plan: () => band([narthex, ["*", nave()], [5, P_.classroom("Study room")], [4, col([[4, vestry()], ["*", P_.store("Chaplain's store", "chapel")]])]]) },
  { id: "plain", name: "Plain chapel (the nave alone)", plan: () => band([narthex, ["*", nave()]]) },
  { id: "side", name: "Chapel with its vestry and restroom along the side", plan: () => col([["*", band([narthex, ["*", nave()]])], [5, band([["*", vestry()], [4, "restroom"]])]]) },
  { id: "library", name: "Chapel with a religious library", plan: () => band([narthex, ["*", nave()], [5, P_.library("Religious library")]]) },
  { id: "counsel", name: "Chapel with the chaplains' offices", plan: () => band([narthex, ["*", nave()], [4, col([["*", P_.office("Chaplain")], ["*", P_.office("Counsellor")]])]]) },
  { id: "fellowship", name: "Chapel with a fellowship room", plan: () => band([narthex, ["*", nave()], [5, R("breakroom", "Fellowship room")]]) },
  { id: "vestry", name: "Chapel with a vestry", plan: () => band([narthex, ["*", nave()], [4, vestry()]]) },
  { id: "store", name: "Chapel with a store", plan: () => band([narthex, ["*", nave()], [4, P_.store("Chaplain's store", "chapel")]]) },
  { id: "full", name: "Chapel with a vestry, an office and a restroom", plan: () => band([narthex, ["*", nave()], [4, col([[4, vestry()], ["*", P_.office("Chaplain's office")], [3, "restroom"]])]]) },
];
// Library and education: a corridor between the front rooms and the back.
const edu = (front, back) => () => corridorPlan(front, back, 6, 2);
const EDU_FRONT = [["*", P_.library()], [5, P_.lobby("Education lobby")], ["*", P_.classroom()]];
PRISON_PLANS.education = [
  { id: "standard", name: "Library, classrooms and the education office", plan: edu(EDU_FRONT, [["*", P_.classroom()], ["*", P_.office("Education office")], [3, "restroom"]]) },
  { id: "computers", name: "Library and a computer lab", plan: edu(EDU_FRONT, [["*", P_.classroom()], ["*", P_.classroom("Computer lab")], [3, "restroom"]]) },
  { id: "vocational", name: "Library, a classroom and a vocational shop", plan: edu(EDU_FRONT, [["*", P_.shop("Vocational shop")], ["*", P_.office("Education office")], [3, "restroom"]]) },
  { id: "school", name: "School block (classrooms, no library)", plan: edu([["*", P_.classroom("Testing room")], [5, P_.lobby("Education lobby")], ["*", P_.classroom()]], [["*", P_.classroom()], ["*", P_.office("Education office")], [3, "restroom"]]) },
  { id: "library", name: "Library block (the main and the law library)", plan: edu([["*", P_.library()], [5, P_.lobby("Education lobby")], ["*", P_.library("Law library")]], [["*", P_.store("Book store", "office")], ["*", P_.office("Librarian")], [3, "restroom"]]) },
  { id: "classrooms", name: "Classrooms along both sides", plan: edu([["*", P_.classroom()], [5, P_.lobby("Education lobby")], ["*", P_.classroom()]], [["*", P_.classroom()], ["*", P_.classroom()], ["*", P_.classroom()]]) },
  { id: "counselling", name: "Library, classrooms and the counsellors", plan: edu(EDU_FRONT, [["*", P_.classroom()], ["*", P_.office("Education office")], ["*", P_.office("Counsellor")]]) },
  { id: "staff", name: "Library, classrooms and the teachers' room", plan: edu(EDU_FRONT, [["*", P_.classroom()], ["*", R("breakroom", "Teachers' room")], [3, "restroom"]]) },
  { id: "supplies", name: "Library, classrooms and the supply room", plan: edu(EDU_FRONT, [["*", P_.classroom()], ["*", P_.store("School supplies", "office")], [3, "restroom"]]) },
  { id: "hobby", name: "Library, a classroom and the hobby-craft room", plan: edu(EDU_FRONT, [["*", P_.classroom()], ["*", P_.shop("Hobby-craft room")]]) },
  { id: "media", name: "Library, classrooms, the office and a media store", plan: edu(EDU_FRONT, [["*", P_.classroom()], ["*", P_.office("Education office")], [3, "restroom"], [5, P_.store("Media store", "office")]]) },
  { id: "open", name: "Open-plan library and classroom (no corridor)", plan: () => col([["*", P_.library()], [5, P_.lobby("Education lobby")], ["*", P_.classroom()]]) },
];
// Prison industries: the shops in a row, a loading door at the back.
const shopEntry = (name) => ({ ...P_.shop(name), entry: true });
PRISON_PLANS.industries = [
  { id: "standard", name: "Licence-plate shop, print shop and laundry", plan: () => col([["*", shopEntry("Licence-plate shop")], ["*", P_.shop("Print shop")], ["*", P_.laundry()]]) },
  { id: "woodshop", name: "Woodshop, upholstery and the lumber store", plan: () => col([["*", shopEntry("Woodshop")], ["*", P_.shop("Upholstery shop")], [8, P_.store("Lumber store", "workshop")]]) },
  { id: "garment", name: "Garment shop, laundry and the foreman's office", plan: () => col([["*", shopEntry("Garment shop")], ["*", P_.laundry()], [8, P_.office("Shop foreman")]]) },
  { id: "metal", name: "Metal shop, sign shop, store and office", plan: () => col([["*", shopEntry("Metal shop")], ["*", P_.shop("Sign shop")], [8, P_.store("Steel store", "workshop")], [6, P_.office("Shop foreman")]]) },
  { id: "laundry", name: "Central laundry and the linen store", plan: () => col([["*", { ...P_.laundry("Central laundry"), entry: true }], [8, P_.store("Linen store", "plaundry")]]) },
  { id: "print", name: "Print shop and bindery, offices behind", plan: () => band([["*", col([["*", shopEntry("Print shop")], ["*", P_.shop("Bindery")]])], [5, col([["*", P_.office("Print office")], ["*", P_.store("Paper store", "workshop")], [3, "restroom"]])]]) },
  { id: "furniture", name: "Furniture shop with a loading bay", plan: () => col([["*", shopEntry("Furniture shop")], ["*", R("bays", "Loading bay", { type: "garage", maxBoxes: 2 })], [8, P_.store("Timber store", "workshop")]]) },
  { id: "cannery", name: "Cannery and the cold store", plan: () => col([["*", shopEntry("Cannery")], ["*", P_.stores("Cold store")], [8, P_.store("Can store", "pstores")]]) },
  { id: "garage", name: "Vehicle shop and parts shop", plan: () => col([["*", R("bays", "Vehicle shop", { type: "garage", maxBoxes: 3, entry: true })], ["*", P_.shop("Parts shop")], [8, P_.office("Motor pool office")]]) },
  { id: "sewing", name: "Laundry and the sewing room", plan: () => col([["*", { ...P_.laundry(), entry: true }], ["*", P_.shop("Sewing room")], [6, "restroom"]]) },
  { id: "lockers", name: "Two shops and the workers' lockers", plan: () => col([["*", shopEntry("Licence-plate shop")], ["*", P_.shop("Print shop")], [8, P_.lockers("Workers' lockers")]]) },
  { id: "complex", name: "Shops, laundry, office and break room", plan: () => col([["*", shopEntry("Licence-plate shop")], ["*", P_.shop("Print shop")], ["*", P_.laundry()], [8, P_.office("Industries office")], [6, "breakroom"]]) },
];
// Administration (outside the fence, two storeys): offices off a corridor on both floors.
/** @type {(back?: any[], front?: any[]) => () => any} */
const adminUp = (back = [["*", P_.office("Records store")], [5, "breakroom"], [3, "restroom"]], front = [["*", P_.office("Deputy warden")], [6, P_.office("Conference room")], ["*", P_.office("Accounts")]]) => () => corridorPlan(front, back, 5);
const ADMIN_FRONT = [["*", P_.office("Warden's office", { boxLock: ["safe", 0.3], gunSafe: ["gunsafe2", 0.3] })], [6, P_.lobby("Administration lobby")], ["*", P_.office("Records", { boxLock: ["evidence", 0.3] })]];
const ADMIN_BACK = [["*", P_.office("Personnel")], [5, "breakroom"], [3, "restroom"]];
const adminPlan = (front, back, up) => ({ plan: () => corridorPlan(front, back, 5), upper: up || adminUp() });
PRISON_PLANS.admin = [
  { id: "standard", name: "Warden, records and personnel; offices upstairs", ...adminPlan(ADMIN_FRONT, ADMIN_BACK) },
  { id: "training", name: "Administration with a training room", ...adminPlan(ADMIN_FRONT, [["*", P_.office("Personnel")], ["*", P_.classroom("Training room")], [3, "restroom"]]) },
  { id: "visitors", name: "Administration with the visitors' centre", ...adminPlan([["*", P_.office("Warden's office", { boxLock: ["safe", 0.3] })], [6, P_.lobby("Administration lobby")], ["*", P_.visit("Visitors' centre")]], ADMIN_BACK) },
  { id: "lockers", name: "Administration with the staff lockers", ...adminPlan(ADMIN_FRONT, [["*", P_.lockers("Staff lockers")], [5, "breakroom"], [3, "restroom"]]) },
  { id: "archive", name: "Administration with an archive upstairs", ...adminPlan(ADMIN_FRONT, ADMIN_BACK, adminUp([["*", P_.store("Archive", "office", { boxLock: ["evidence", 0.3] })], [5, "breakroom"], [3, "restroom"]])) },
  { id: "response", name: "Administration with the emergency response armory", ...adminPlan(ADMIN_FRONT, [["*", P_.armory("Emergency response armory", { lock: ["vault", 0.7] })], [5, "breakroom"], [3, "restroom"]]) },
  { id: "academy", name: "Training room and lockers", ...adminPlan(ADMIN_FRONT, [["*", P_.lockers("Staff lockers")], ["*", P_.classroom("Training room")], [3, "restroom"]]) },
  { id: "publicside", name: "Visitors' centre and an archive", ...adminPlan([["*", P_.office("Warden's office", { boxLock: ["safe", 0.3] })], [6, P_.lobby("Administration lobby")], ["*", P_.visit("Visitors' centre")]], ADMIN_BACK, adminUp([["*", P_.store("Archive", "office")], [5, "breakroom"], [3, "restroom"]])) },
  { id: "conference", name: "A training room and an archive upstairs", ...adminPlan(ADMIN_FRONT, ADMIN_BACK, adminUp([["*", P_.store("Archive", "office")], [5, "breakroom"], [3, "restroom"]], [["*", P_.office("Deputy warden")], ["*", P_.classroom("Conference and training room")], ["*", P_.office("Accounts")]])) },
  { id: "staffside", name: "Lockers and an archive", ...adminPlan(ADMIN_FRONT, [["*", P_.lockers("Staff lockers")], [5, "breakroom"], [3, "restroom"]], adminUp([["*", P_.store("Archive", "office")], [5, "breakroom"], [3, "restroom"]])) },
  { id: "family", name: "Visitors' centre and a training room", ...adminPlan([["*", P_.office("Warden's office", { boxLock: ["safe", 0.3] })], [6, P_.lobby("Administration lobby")], ["*", P_.visit("Visitors' centre")]], [["*", P_.office("Personnel")], ["*", P_.classroom("Training room")], [3, "restroom"]]) },
  { id: "canteen", name: "Administration with a staff canteen", ...adminPlan(ADMIN_FRONT, [["*", R("breakroom", "Staff canteen")], [7, P_.kitchen("Canteen kitchen")], [3, "restroom"]]) },
];
// The armory (outside the fence): the issue window and the stores behind.
const issue = [3, R("foyer", "Issue window", { entry: true, type: "barracks" })];
const vault = () => P_.armory("Armory", { lock: ["vault", 0.8], boxLock: ["cage", 0.4], gunSafe: ["gunsafe3", 0.3] });
PRISON_PLANS.armory = [
  { id: "standard", name: "Armory and the riot gear store", plan: () => band([issue, ["*", col([["*", vault()], ["*", P_.armory("Riot gear store", { lock: ["door", 0.5] })]])]]) },
  { id: "armorer", name: "Armory and the armorer's office", plan: () => band([issue, ["*", col([["*", vault()], [5, P_.office("Armorer")]])]]) },
  { id: "classroom", name: "Armory and a firearms classroom", plan: () => band([issue, ["*", col([["*", vault()], ["*", P_.classroom("Firearms classroom")]])]]) },
  { id: "cleaning", name: "Armory and the cleaning room", plan: () => band([issue, ["*", col([["*", vault()], [5, P_.shop("Cleaning room")]])]]) },
  { id: "ammo", name: "Armory and the ammunition store", plan: () => band([issue, ["*", col([["*", vault()], ["*", P_.store("Ammunition store", "parmory", { lock: ["door", 0.7] })]])]]) },
  { id: "tactical", name: "Armory and the tactical team's lockers", plan: () => band([issue, ["*", col([["*", vault()], ["*", P_.lockers("Tactical team lockers")]])]]) },
  { id: "keys", name: "Armory and key control", plan: () => band([issue, ["*", col([["*", vault()], [5, R("pcontrol", "Key control", { lock: ["door", 0.5] })]])]]) },
  { id: "restroom", name: "Armory, riot gear and a restroom", plan: () => band([issue, ["*", col([["*", vault()], ["*", P_.armory("Riot gear store", { lock: ["door", 0.5] })], [3, "restroom"]])]]) },
  { id: "vehicle", name: "Armory with a vehicle bay", plan: () => col([["*", band([issue, ["*", vault()]])], [7, R("bays", "Vehicle bay", { type: "garage", maxBoxes: 2 })]]) },
  { id: "ready", name: "Armory and a ready room", plan: () => band([issue, ["*", col([["*", vault()], [5, R("breakroom", "Ready room")]])]]) },
  { id: "storeoffice", name: "Armory, the armorer and a store", plan: () => band([issue, ["*", col([["*", vault()], [5, P_.office("Armorer")], [5, P_.store("Gas store", "parmory")]])]]) },
  { id: "hall", name: "Armory and riot gear off a secure hall", plan: () => band([issue, [2, R("corridor", "Secure hall")], ["*", col([["*", vault()], ["*", P_.armory("Riot gear store", { lock: ["door", 0.5] })]])]]) },
];
// The gatehouse straddles the two fences (bh: the depth it must span, REAL_SIZE pgate: own): visitor processing at
// the front, the officers' post at the back, a room off one or both.
const gateBands = (a = [], b = []) => () => band([["*", col([["*", P_.gate("Visitor processing", true)], ...a])], ["*", col([["*", P_.gate("Officers' post")], ...b])]]);
PRISON_PLANS.gate = [
  { id: "standard", name: "Visitor processing and the officers' post", plan: gateBands() },
  { id: "search", name: "Gatehouse with a search room", plan: gateBands([], [[4, P_.office("Search room")]]) },
  { id: "lockers", name: "Gatehouse with the visitors' lockers", plan: gateBands([[4, P_.lockers("Visitors' lockers")]]) },
  { id: "restroom", name: "Gatehouse with a restroom", plan: gateBands([], [[3, "restroom"]]) },
  { id: "contraband", name: "Gatehouse with the contraband store", plan: gateBands([], [[4, P_.store("Contraband store", "property", { lock: ["door", 0.5] })]]) },
  { id: "waiting", name: "Gatehouse with a waiting room", plan: gateBands([[4, P_.visit("Waiting room")]]) },
  { id: "keys", name: "Gatehouse with the key and radio issue", plan: gateBands([], [[4, R("pcontrol", "Key and radio issue")]]) },
  { id: "breakroom", name: "Gatehouse with a break room", plan: gateBands([], [[4, "breakroom"]]) },
  { id: "armory", name: "Gatehouse with its own armory", plan: gateBands([], [[4, P_.armory("Gate armory", { lock: ["vault", 0.6] })]]) },
  { id: "searchrest", name: "Search room and a restroom", plan: gateBands([[4, P_.office("Search room")]], [[3, "restroom"]]) },
  { id: "lockerstore", name: "Visitors' lockers and the contraband store", plan: gateBands([[4, P_.lockers("Visitors' lockers")]], [[4, P_.store("Contraband store", "property")]]) },
  { id: "waitrest", name: "Waiting room and a restroom", plan: gateBands([[4, P_.visit("Waiting room")]], [[3, "restroom"]]) },
];
// The county jail's building: the public band along the front (the sally port, booking, the lobby, visitation), the
// secure band behind (holding, property, the kitchen, the medical room), a secure corridor along the back wall (the
// pods' corridors join it); upstairs the control room and the offices. mirror: the sally port on the right.
const JF = () => [[6, R("bays", "Sally port", { type: "garage", maxBoxes: 2, civic: "sallyport" })], ["*", P_.booking("Booking and intake")], [6, P_.lobby("Public lobby")], ["*", P_.visit()]];
const JM = () => [["*", P_.holding()], ["*", P_.holding()], [6, P_.property("Property room")], ["*", P_.kitchen("Jail kitchen")], [6, P_.ward("Medical room")]];
const JU1 = () => [["*", P_.control("Control room", 3)], ["*", P_.office("Jail administration")], [6, P_.office("Sheriff's office", { gunSafe: ["gunsafe2", 0.3] })]];
const JU2 = () => [["*", P_.office("Records", { boxLock: ["evidence", 0.3] })], [6, "breakroom"], [4, "restroom"], ["*", P_.lockers()]];
const jail = (o = {}) => ({ front: o.front || JF(), mid: o.mid || JM(), up1: o.up1 || JU1(), up2: o.up2 || JU2(), mirror: !!o.mirror });
PRISON_PLANS.jailmain = [
  { id: "standard", name: "Booking along the front, holding and the kitchen behind", ...jail() },
  { id: "laundry", name: "Jail with its own laundry", ...jail({ mid: [["*", P_.holding()], [6, P_.property("Property room")], ["*", P_.kitchen("Jail kitchen")], [6, P_.ward("Medical room")], [6, P_.laundry("Jail laundry")]] }) },
  { id: "foodstore", name: "Jail with a food warehouse", ...jail({ mid: [["*", P_.holding()], [6, P_.property("Property room")], ["*", P_.kitchen("Jail kitchen")], [5, P_.ward("Medical room")], [6, P_.stores("Food store")]] }) },
  { id: "detox", name: "Jail with detox and sobering cells", ...jail({ mid: [["*", P_.holding()], ["*", P_.holding("Detox cell")], ["*", P_.holding("Sobering cell")], [6, P_.property("Property room")], ["*", P_.kitchen("Jail kitchen")], [5, P_.ward("Medical room")]] }) },
  { id: "videocourt", name: "Jail with a video courtroom", ...jail({ front: [[6, R("bays", "Sally port", { type: "garage", maxBoxes: 2, civic: "sallyport" })], ["*", P_.booking("Booking and intake")], [6, P_.lobby("Public lobby")], ["*", P_.visit()], [6, P_.office("Video courtroom")]] }) },
  { id: "programs", name: "Jail with a programs room", ...jail({ mid: [["*", P_.holding()], [6, P_.property("Property room")], ["*", P_.kitchen("Jail kitchen")], [6, P_.ward("Medical room")], [6, P_.classroom("Programs room")]] }) },
  { id: "showers", name: "Jail with intake showers", ...jail({ mid: [["*", P_.holding()], [6, P_.property("Property room")], ["*", P_.kitchen("Jail kitchen")], [6, P_.ward("Medical room")], [5, R("pshower", "Intake showers", { prison: "showers" })]] }) },
  { id: "sheriff", name: "Sheriff's annex (the sally port on the right, an armory upstairs)", ...jail({ mirror: true, up2: [["*", P_.office("Records", { boxLock: ["evidence", 0.3] })], [6, "breakroom"], [5, P_.armory("Sheriff's armory", { lock: ["vault", 0.7] })], ["*", P_.lockers()]] }) },
  { id: "evidence", name: "Jail with the evidence room upstairs", ...jail({ up2: [["*", P_.store("Evidence room", "property", { boxLock: ["evidence", 0.4] })], [6, "breakroom"], [4, "restroom"], ["*", P_.lockers()]] }) },
  { id: "dispatch", name: "Jail with dispatch and a training room upstairs", ...jail({ up1: [["*", P_.control("Control room", 3)], ["*", R("pcontrol", "Dispatch")], [6, P_.office("Sheriff's office", { gunSafe: ["gunsafe2", 0.3] })]], up2: [["*", P_.office("Records", { boxLock: ["evidence", 0.3] })], [6, "breakroom"], [4, "restroom"], ["*", P_.classroom("Training room")]] }) },
  { id: "suicidewatch", name: "Jail with suicide-watch cells (the sally port on the right)", ...jail({ mirror: true, mid: [["*", P_.holding()], [6, P_.property("Property room")], ["*", P_.kitchen("Jail kitchen")], [5, P_.ward("Medical room")], [6, psych("Suicide-watch cells", "s")]] }) },
  { id: "pharmacy", name: "Jail with a pharmacy by the medical room", ...jail({ mid: [["*", P_.holding()], ["*", P_.holding()], [6, P_.property("Property room")], ["*", P_.kitchen("Jail kitchen")], [6, P_.ward("Medical room")], [4, pharm()]] }) },
];
// The building's spec from its plan (pinned by o.plan or by its dice); bw, bh: its footprint.
function planned(rng, type, bw, bh, o = {}, extra = {}) {
  const v = pickPlan(rng, type, o);
  return spec(bw, bh, v.plan(rng), { ...extra, ...(v.upper ? { upper: v.upper } : {}), vid: v.id, vname: v.name });
}
function centralControl(rng, o = {}) { const [bw, bh] = foot(rng, "pcontrol"); return planned(rng, "control", bw, bh, o); }
export function chowHall(rng, o = {}) {
  const [bw, bh] = foot(rng, "pchow");
  return planned(rng, "chow", bw, bh, o, { exits: [{ side: "back", roles: ["pstores", "storage", "pcommissary", "pkitchen"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Loading dock" }] });
}
export function prisonInfirmary(rng, o = {}) { const [bw, bh] = foot(rng, "pinfirmary"); return planned(rng, "infirmary", bw, bh, o); }
const chapel = (rng, o = {}) => planned(rng, "chapel", ...foot(rng, "pchapel"), o);
const education = (rng, o = {}) => planned(rng, "education", ...foot(rng, "pschool"), o);
const industries = (rng, o = {}) => planned(rng, "industries", ...foot(rng, "pworks"), o, { exits: [{ side: "back", roles: ["pshop", "plaundry", "bays", "storage"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Loading door" }] });
const admin = (rng, o = {}) => planned(rng, "admin", ...foot(rng, "padmin"), o, { storeys: 2 });
const armory = (rng, o = {}) => planned(rng, "armory", ...foot(rng, "parmory"), o);
const gatehouse = (rng, bh, o = {}) => planned(rng, "gate", rng.int(12, 14), bh, o, { exits: [{ side: "back", roles: ["gatepost"], chance: 1, lock: 0, name: "Into the prison" }] });
function jailMain(rng, o = {}) {
  const [bw] = foot(rng, "jailmain");
  const v = pickPlan(rng, "jailmain", o);
  const flip = (l) => (v.mirror ? l.slice().reverse() : l);
  return spec(bw, 2 + 7 + 1 + 7 + 1 + 2, band([[7, col(flip(v.front))], [7, col(flip(v.mid))], [2, R("corridor", "Secure corridor", { hub: true })]]), {
    storeys: 2, stairs: { roles: ["corridor"], n: 1, len: 2 },
    upper: () => band([[7, col(flip(v.up1))], [7, col(flip(v.up2))], [2, R("corridor", "Upper corridor", { hub: true })]]),
    exits: [{ side: v.mirror ? "right" : "left", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.2, name: "Sally port" }],
    vid: v.id, vname: v.name,
  });
}

// Each type's builder (the tests pin each plan by o.plan): (rng, o) => its spec.
export const PRISON_BUILDERS = {
  housing: (rng, o) => housingUnit(rng, { len: foot(rng, "pblock")[0], picket: "left", unitId: 1, ...o }),
  control: centralControl, chow: chowHall, infirmary: prisonInfirmary, chapel, education, industries, admin, armory,
  gate: (rng, o) => gatehouse(rng, 9, o), jailmain: jailMain,
};
// ---------- the two tiers (after assemble) ----------
// Downstairs the wall between each tier and its day room comes down (the day room faces the cells); upstairs the well
// over the day room is open air and its edge a railing; every tier gets a door into its officers' station on every
// floor (where the plan's doors went through the day room or the well). m: an assemble map; spec: its spec.
export function openTiers(m, sp) {
  const U = sp.unit;
  if (!U || U.kind !== "cells") return;
  const W = m.w, floors = m.floors || [{ cells: m.cells }];
  const at = (f, x, y) => floors[f].cells[y * W + x];
  const rooms = m.rooms.filter((a) => !a.outdoor);
  const strip = (c) => { delete c.dk; delete c.hp; delete c.mhp; delete c.t; delete c.win; delete c.wart; };
  const dropDoor = (f, x, y) => { for (const r of rooms) if (r.f === f && r.doors) r.doors = r.doors.filter(([dx, dy]) => dx !== x || dy !== y); m.lockedDoors = m.lockedDoors.filter((d) => d.x !== x || d.y !== y || (d.f || 0) !== f); };
  const door = (f, x, y, dk, ...rs) => {
    const c = at(f, x, y);
    if (c.k !== "wall" && c.k !== "window") return false;
    const K = DOOR_KINDS[dk] || DOOR_KINDS.steel;
    Object.assign(c, { k: "idoor", dk, f: "floor", fl: "conc" }); c.hp = c.mhp = K.hp; delete c.win; delete c.t;
    for (const r of rs) if (r) r.doors.push([x, y]);
    // The cells either side clear (a shelf furnished against the wall before the door was cut).
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      const n = floors[f].cells[ny * W + nx];
      if (!n || !CELL[n.k] || CELL[n.k].walk || ["wall", "window", "bars", "rail", "void"].includes(n.k) || n.k.endsWith("door")) continue;
      const fl = n.fl; for (const k of Object.keys(n)) delete n[k]; Object.assign(n, { k: "open", f: "floor", ...(fl ? { fl } : {}) });
      m.containers = m.containers.filter((q) => q.x !== nx || q.y !== ny || (q.f || 0) !== f);
    }
    return true;
  };
  const overlapX = (a, b) => Math.min(a.x0 + a.w, b.x0 + b.w) - Math.max(a.x0, b.x0) > 2;
  for (let f = 0; f < floors.length; f++) {
    const here = rooms.filter((a) => a.f === f);
    const mids = here.filter((a) => a.prison === "dayroom");
    for (const t of here.filter((a) => a.prison === "tier")) {
      // Its day room (or the well over it): the one it shares a long wall with.
      const mid = mids.find((d) => overlapX(d, t) && (d.y0 + d.h - 1 === t.y0 || t.y0 + t.h - 1 === d.y0));
      if (!mid) continue;
      const below = t.y0 > mid.y0; // the front tier: its cells against the front wall, its walkway its top row
      const row = below ? t.y0 : t.y0 + t.h - 1; // the wall it shares with the day room
      for (let x = Math.max(t.x0, mid.x0) + 1; x <= Math.min(t.x0 + t.w, mid.x0 + mid.w) - 2; x++) {
        const c = at(f, x, row);
        strip(c);
        if (f === 0) Object.assign(c, { k: "open", f: "floor", fl: "conc" }); else Object.assign(c, { k: "rail", f: "floor" });
      }
      t.doors = (t.doors || []).filter(([, y]) => y !== row);
      const walk = below ? t.y0 + 1 : t.y0 + t.h - 2;
      t.walk = walk;
      // The plan's doors in the tier's walls beside a cell (not at its walkway): moved to the walkway's end of that wall
      // (a room beyond keeps its way in), or bricked up in an outer wall.
      for (const [x, y] of t.doors.slice()) {
        if (y === walk) continue;
        const c = at(f, x, y);
        if (!["idoor", "odoor", "door"].includes(c.k)) continue;
        const dk = c.dk || "steel";
        Object.assign(c, { k: "wall", f: "floor" }); strip(c);
        dropDoor(f, x, y);
        if (x === t.x0 || x === t.x0 + t.w - 1) { const other = here.find((r) => r !== t && x >= r.x0 && x < r.x0 + r.w && walk > r.y0 && walk < r.y0 + r.h - 1); if (other) door(f, x, walk, dk, t, other); }
      }
      // A floor cell of the tier its walkway cannot reach (boxed in by the bars where the plan's door stood): bars too.
      {
        const inT = (x, y) => x > t.x0 && x < t.x0 + t.w - 1 && y > t.y0 && y < t.y0 + t.h - 1;
        const walkable = (c) => c.k === "open" || c.k === "idoor" || c.k === "odoor" || c.k === "door";
        const seen = new Set(), q = [];
        for (let x = t.x0 + 1; x < t.x0 + t.w - 1; x++) if (walkable(at(f, x, walk))) { seen.add(`${x},${walk}`); q.push([x, walk]); }
        while (q.length) { const [x, y] = q.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = `${nx},${ny}`; if (!inT(nx, ny) || seen.has(k) || !walkable(at(f, nx, ny))) continue; seen.add(k); q.push([nx, ny]); } }
        for (let y = t.y0 + 1; y < t.y0 + t.h - 1; y++) for (let x = t.x0 + 1; x < t.x0 + t.w - 1; x++) { const c = at(f, x, y); if (c.k === "open" && !seen.has(`${x},${y}`)) c.k = "bars"; }
      }
      // Its doors into the officers' stations beside it, at its walkway (one each side for a block with two).
      for (const pk of here.filter((a) => a.prison === "picket" && (a.x0 === t.x0 + t.w - 1 || a.x0 + a.w - 1 === t.x0))) door(f, pk.x0 === t.x0 + t.w - 1 ? pk.x0 : pk.x0 + pk.w - 1, walk, U.dk || "steel", t, pk);
    }
    if (f > 0) for (const mid of mids) { // the well: open air
      for (let y = mid.y0 + 1; y < mid.y0 + mid.h - 1; y++) for (let x = mid.x0 + 1; x < mid.x0 + mid.w - 1; x++) { const c = at(f, x, y); for (const k of Object.keys(c)) delete c[k]; c.k = "void"; c.f = "air"; }
      const railed = new Set();
      for (const [x, y] of mid.doors || []) { const c = at(f, x, y); if (c.k === "idoor" || c.k === "odoor") { Object.assign(c, { k: "rail" }); delete c.dk; delete c.hp; delete c.mhp; railed.add(`${x},${y}`); dropDoor(f, x, y); } }
      mid.doors = []; mid.type = null; mid.noLabel = true; mid.well = true;
      // A room upstairs whose only door gave onto the well (a unit's store over its showers): a door at a tier's walkway.
      for (const r of here) {
        if (r === mid || r.prison === "tier" || r.prison === "dayroom" || !railed.size || (r.doors || []).length) continue;
        for (const t of here.filter((a) => a.prison === "tier" && a.walk != null && (a.x0 + a.w - 1 === r.x0 || r.x0 + r.w - 1 === a.x0) && a.walk > r.y0 && a.walk < r.y0 + r.h - 1)) door(f, t.x0 + t.w - 1 === r.x0 ? r.x0 : r.x0 + r.w - 1, t.walk, "steel", t, r);
      }
      m.containers = m.containers.filter((q) => q.area !== mid.id);
    }
  }
}
// ======================================================================================
// The complex
// ======================================================================================
const pickW = (rng, w) => { const keys = Object.keys(w); return rng.weighted(keys, (k) => w[k]); };
const inRect = (r, x, y, m = 0) => x >= r.x0 - m && y >= r.y0 - m && x < r.x0 + r.w + m && y < r.y0 + r.h + m;
const overlaps = (a, b, m) => a.x0 - m < b.x0 + b.w && b.x0 - m < a.x0 + a.w && a.y0 - m < b.y0 + b.h && b.y0 - m < a.y0 + a.h;

// compound.js with what a prison needs on top of it: which building owns a cell (C.owner: the fences, the towers and
// the dressing keep off them), a cell door's floor inside placed with its building, the sally-port corridors' doors'
// strength, the plan's prison marks.
function grid(W, H, storeys, groundAt) {
  const C = compoundGrid(W, H, storeys, groundAt);
  C.owner = new Int16Array(W * H).fill(-1);
  return C;
}
function stamp(C, m, x0, y0, o) {
  const part = placeBuilding(C, m, { x0, y0, face: o.face || "s", name: o.name, key: m.plan && m.plan.key, tag: { part: o.extra || {} } });
  // A cell door's floor inside (c.cellIn: the scenes, the tests) placed as the building is.
  const B = m.building, T = orient(part.face, B.w, B.h);
  for (const F of C.floors) for (let y = part.y0; y < part.y0 + part.h; y++) for (let x = part.x0; x < part.x0 + part.w; x++) {
    const c = F.cells[y * C.W + x];
    if (c.cellIn) { const [u, v] = T.pt(c.cellIn[0] - B.x0, c.cellIn[1] - B.y0); c.cellIn = [x0 + u, y0 + v]; }
  }
  for (let y = part.y0; y < part.y0 + part.h; y++) for (let x = part.x0; x < part.x0 + part.w; x++) C.owner[y * C.W + x] = part.k;
  return part;
}
function corridor(C, a, b, o) {
  const area = link(C, a, b, { kind: "corridor", width: o.width || 2, name: o.name, dk: o.dk, sally: !!o.sally });
  if (!area) return null;
  const K = DOOR_KINDS[o.dk] || DOOR_KINDS.steel;
  for (const [x, y] of area.doors) { const c = C.cells[y * C.W + x]; if (c.k === "idoor") { c.hp = c.mhp = K.hp; c.dk = o.dk || "steel"; } }
  for (let y = area.y0; y < area.y0 + area.h; y++) for (let x = area.x0; x < area.x0 + area.w; x++) if (C.owner[y * C.W + x] < 0) C.owner[y * C.W + x] = 1000 + area.id;
  area.conn = [a.k, b.k];
  return area;
}
function finish(C, option, o) {
  const map = compoundResult(C, { key: option.key, id: option.id, name: option.name, zones: o.zones, vehicle: o.vehicle || null, kind: o.kind, extra: o.extra });
  map.complex = o.kind; map.plan.complex = o.kind; map.plan.street = true; // its ways out are its zones (ui/combat.js), as a street's
  map.plan.rooms = map.plan.rooms.map((r) => { const a = C.areas[r.id]; return a && a.prison ? { ...r, prison: a.prison, ...(a.unitId != null ? { unitId: a.unitId } : {}) } : r; });
  return map;
}

// Assembles a building from its spec: { m, sp } (its own dice from the complex's: the same complex every visit).
function build(seed, salt, sp, key, name, legacy) {
  const rng = new Rng(Math.floor(hash01(seed, "pbldg", salt) * 4294967296) || 1);
  const s = typeof sp === "function" ? sp(rng) : sp;
  const m = assemble(rng, s, { key, id: `${key}:${salt}`, name, legacy });
  openTiers(m, s);
  return { m, sp: s, name, key };
}

/**
 * The map of a prison or a jail (buildingmaps.js buildingMap): see the header.
 * @param {any} state @param {number} tileId @param {{ key: string, id: string, name: string, layout?: string }} option @param {any} withVehicle @param {{ legacy?: boolean, cap?: number, layout?: string }} [o]
 */
export function prisonMap(state, tileId, option, withVehicle, o = {}) {
  const kind = prisonKind(state, tileId, option);
  const seed = hash01(state.seed, "prison", tileId, option.id);
  const rng = new Rng(Math.floor(seed * 4294967296) || 1);
  if (option.layout && !o.layout) o = { ...o, layout: option.layout }; // a pinned layout (the option's)
  return kind === "jail" ? jailMap(rng, seed, option, withVehicle, o) : penMap(rng, seed, option, kind, withVehicle, o);
}

// A state prison's or a penitentiary's layouts (the user's dozen, issue #31): where the block of housing stands inside
// the fence (x: against the west fence, the middle, the east; y: the north or the middle of the compound), which sides
// of the main corridor its units stand on (sides: both, or a comb with all of them west or east of it), which end of
// the corridor central control stands at (head: the north end, else the south), where the yard goes (beside the
// housing, toward the gate, else anywhere free). A comb's units in one file: a comb holds as many as fit.
export const PRISON_LAYOUTS = [
  { id: "pole", name: "Telephone pole (units off a central corridor, control at its foot)" },
  { id: "polewest", name: "Telephone pole along the west fence", x: "west" },
  { id: "poleeast", name: "Telephone pole along the east fence", x: "east" },
  { id: "polemid", name: "Telephone pole in the middle of the compound", y: "middle" },
  { id: "head", name: "Control at the head of the pole", head: true },
  { id: "headwest", name: "Control at the head, along the west fence", x: "west", head: true },
  { id: "headeast", name: "Control at the head, along the east fence", x: "east", head: true },
  { id: "combwest", name: "Comb along the west fence (every unit west of the corridor)", x: "west", sides: "left" },
  { id: "combeast", name: "Comb along the east fence (every unit east of the corridor)", x: "east", sides: "right" },
  { id: "combhead", name: "Comb with control at its head", sides: "left", head: true },
  { id: "campus", name: "Campus (the housing in the middle, the yard beside it)", y: "middle", yard: "beside" },
  { id: "yardfront", name: "Control at the head, the yard toward the gate", head: true, yard: "front" },
];
// A state prison or a penitentiary.
function penMap(rng, seed, option, kind, withVehicle, o) {
  const K = PRISON.KINDS[kind], cap = o.cap || mapCap("prison") || PRISON.CAP;
  const S = Math.min(cap, rng.int(K.map[0][0], K.map[0][1]));
  const W = S, H = S;
  const R = PRISON.RING, F = PRISON.FRONT, gap = K.gap;
  // The perimeter: the outer line (a wall at a penitentiary, a fence at a state prison), the inner fence gap cells in.
  const outer = { x0: R, y0: R, w: W - 2 * R, h: H - R - F };
  const inner = { x0: outer.x0 + gap, y0: outer.y0 + gap, w: outer.w - 2 * gap, h: outer.h - 2 * gap };
  const inside = { x0: inner.x0 + 3, y0: inner.y0 + 3, w: inner.w - 6, h: inner.h - 6 }; // where the buildings stand
  const legacy = !!o.legacy;
  const B = []; // { m, sp, name, key, x0, y0, flip?, role }
  // ---------- the layout; the gate's place (kept clear of the housing) ----------
  let n = rng.int(K.units[0], K.units[1]);
  const ROW = 34, fits = (L, k) => (L.sides && L.sides !== "both" ? k : Math.ceil(k / 2)) + (kind === "max" ? 1 : 0) <= Math.floor((inside.h - 20 - 4 - 5 - 16) / ROW);
  const L = pickPlan(rng, PRISON_LAYOUTS, { layout: o.layout, only: (q) => fits(q, n) });
  while (n > 2 && !fits(L, n)) n--; // a pinned comb: the units that fit
  const one = L.sides && L.sides !== "both" ? L.sides : null;
  const southOuter = outer.y0 + outer.h - 1, southInner = inner.y0 + inner.h - 1;
  const gx = Math.floor(W / 2) + rng.int(-20, 20); // the sally port's lane (4 wide)
  const gateKeep = { x0: gx - 6, y0: southInner - 18, w: 40, h: 18 };
  // ---------- the housing units off the main corridor ----------
  const rows = one ? n : Math.ceil(n / 2);
  const units = [];
  for (let i = 0; i < n; i++) {
    const side = one || (i % 2 ? "right" : "left"); // left of the corridor: its picket on its right (toward the corridor)
    const len = foot(rng, "pblock")[0]; // a real block 40–70 m long: about 16–20 cells a tier
    // A state prison's unit is any of the housing plans; a penitentiary's always cells (no dormitories).
    const u = build(seed, `unit${i}`, (r) => housingUnit(r, { len, picket: side === "left" ? "right" : "left", unitId: i + 1, kind: kind === "max" ? "cells" : undefined, tiers: 2 }), "pblock", `Housing unit ${String.fromCharCode(65 + i)}`, legacy);
    u.role = "housing"; u.unitId = i + 1; u.side = side; u.row = one ? i : Math.floor(i / 2); u.dorm = u.sp.unit.kind === "dorm";
    units.push(u);
  }
  // A penitentiary's death row at the far end, a cells block of single cells with a security door into each tier.
  if (kind === "max") {
    const side = one || "right";
    const u = build(seed, "deathrow", (r) => housingUnit(r, { len: foot(r, "pdeathrow")[0], picket: side === "left" ? "right" : "left", unitId: n + 1, kind: "cells", single: true, dk: "security", tiers: 2 }), "pblock", "Death row", legacy);
    u.role = "deathrow"; u.unitId = n + 1; u.side = side; u.row = rows; units.push(u);
  }
  const rowH = Math.max(...units.map((u) => u.m.building.h)) + 6;
  const spineLen = (rows + (kind === "max" ? 1 : 0)) * rowH + 4;
  const ctl = build(seed, "control", centralControl, "pcontrol", "Central control", legacy); ctl.role = "control";
  const sp = build(seed, "spine", spine(spineLen), "pcontrol", "Main corridor", legacy); sp.role = "spine";
  // Where the block of housing stands: against the north of the inside, the corridor down its middle.
  const maxLeft = Math.max(0, ...units.filter((u) => u.side === "left").map((u) => u.m.building.w));
  const maxRight = Math.max(0, ...units.filter((u) => u.side === "right").map((u) => u.m.building.w));
  const GAP = PRISON.UNIT_GAP, wl = maxLeft ? maxLeft + GAP : 0, wr = maxRight ? GAP + maxRight : 0;
  const blockW = wl + 5 + wr, ch = ctl.m.building.h, blockH = spineLen + 5 + ch;
  // Central control at an end of the corridor, its lobby over or under it (the secure corridor joins them there).
  const lob = ctl.m.rooms.find((a) => a.role === "lobby" && !(a.f > 0));
  const lobX = lob ? lob.x0 + Math.floor(lob.w / 2) - ctl.m.building.x0 : Math.floor(ctl.m.building.w / 2);
  // The block's x: the spine's, the units either side; control under it, so the block's outline takes control's too.
  const lo = Math.min(-wl, 2 - lobX), hi = Math.max(5 + wr, 2 - lobX + ctl.m.building.w); // relative to the spine
  const span = hi - lo;
  let bx = L.x === "west" ? inside.x0 + 4 : L.x === "east" ? inside.x0 + inside.w - span - 4 : inside.x0 + Math.floor((inside.w - span) / 2) + rng.int(-8, 8);
  bx = Math.max(inside.x0 + 2, Math.min(inside.x0 + inside.w - span - 2, bx));
  const sx = bx - lo;
  let top = L.y === "middle" ? inside.y0 + Math.floor((inside.h - blockH) / 2) : inside.y0 + 2;
  top = Math.max(inside.y0 + 2, Math.min(top, gateKeep.y0 - 6 - blockH));
  const sy = L.head ? top + ch + 5 : top;
  sp.x0 = sx; sp.y0 = sy;
  for (const u of units) {
    const bw = u.m.building.w;
    u.x0 = u.side === "left" ? sx - GAP - bw : sx + 5 + GAP;
    u.y0 = sy + 2 + u.row * rowH;
  }
  ctl.x0 = sx + 2 - lobX; ctl.y0 = L.head ? top : sy + spineLen + 5;
  B.push(sp, ctl, ...units);
  const housing = { x0: bx - 3, y0: top - 3, w: span + 6, h: blockH + 6 };
  // ---------- the yard and the other buildings inside ----------
  const taken = [housing, gateKeep];
  const spot = (w, h, pref) => {
    for (let t = 0; t < 400; t++) {
      const x = pref && t < 200 ? pref.x0 + rng.int(0, Math.max(0, pref.w - w)) : inside.x0 + rng.int(0, Math.max(0, inside.w - w));
      const y = pref && t < 200 ? pref.y0 + rng.int(0, Math.max(0, pref.h - h)) : inside.y0 + rng.int(0, Math.max(0, inside.h - h));
      const r = { x0: x, y0: y, w, h };
      if (x < inside.x0 || y < inside.y0 || x + w > inside.x0 + inside.w || y + h > inside.y0 + inside.h) continue;
      if (taken.some((q) => overlaps(q, r, 5))) continue;
      taken.push(r);
      return r;
    }
    return null;
  };
  const yardPref = L.yard === "beside" ? (housing.x0 - inside.x0 > inside.x0 + inside.w - housing.x0 - housing.w ? { x0: inside.x0, y0: housing.y0, w: housing.x0 - inside.x0, h: housing.h } : { x0: housing.x0 + housing.w, y0: housing.y0, w: inside.x0 + inside.w - housing.x0 - housing.w, h: housing.h })
    : L.yard === "front" ? { x0: inside.x0, y0: housing.y0 + housing.h, w: inside.w, h: inside.y0 + inside.h - housing.y0 - housing.h } : null;
  const yard = spot(rng.int(52, 64), rng.int(38, 44), yardPref);
  const others = [
    ["chow", chowHall, "pchow", "Chow hall"], ["infirmary", prisonInfirmary, "pinfirmary", "Infirmary"], ["chapel", chapel, "pchapel", "Chapel"],
    ["education", education, "pschool", "Library and education"], ["industries", industries, "pworks", "Prison industries"],
    ["seg", (r) => housingUnit(r, { len: foot(r, "pseg")[0], picket: "left", unitId: 90, kind: "cells", single: true, tiers: 1 }), "pblock", "Segregation unit"],
  ];
  for (const [role, mk, key, name] of others) {
    const b = build(seed, role, mk, key, name, legacy);
    const r = spot(b.m.building.w, b.m.building.h);
    if (!r) continue;
    Object.assign(b, { role, x0: r.x0, y0: r.y0 });
    if (role === "seg") b.unitId = 90;
    B.push(b);
  }
  // ---------- outside the fence: the gatehouse, the sally port, the administration, the armory, the parking ----------
  const gh = build(seed, "gate", (r) => gatehouse(r, southOuter - southInner + 5), "pgate", "Gatehouse", legacy); gh.role = "gate";
  gh.x0 = gx + 12; gh.y0 = southInner - 2;
  const ad = build(seed, "admin", admin, "padmin", "Administration", legacy); ad.role = "admin";
  ad.x0 = gh.x0 + gh.m.building.w + 8; ad.y0 = southOuter + 8;
  const ar = build(seed, "armory", armory, "parmory", "Armory", legacy); ar.role = "armory";
  ar.x0 = gx - 10 - ar.m.building.w; ar.y0 = southOuter + 8;
  B.push(gh, ad, ar);
  // ---------- the grid ----------
  const storeys = Math.max(...B.map((b) => b.m.storeys || 1));
  const roadRing = (x, y) => { const d = Math.min(Math.abs(x - (outer.x0 - 7)), Math.abs(x - (outer.x0 + outer.w + 6)), Math.abs(y - (outer.y0 - 7)), Math.abs(y - (outer.y0 + outer.h + 6))); return d <= 1 && x >= outer.x0 - 8 && x <= outer.x0 + outer.w + 7 && y >= outer.y0 - 8 && y <= outer.y0 + outer.h + 7; };
  const G = grid(W, H, storeys, (x, y) => (inRect(inner, x, y) ? (yard && inRect(yard, x, y) ? "grass" : "gravel") : roadRing(x, y) ? "road" : "grass"));
  for (const b of B) {
    b.rec = stamp(G, b.m, b.x0, b.y0, { name: b.name, extra: { role: b.role, ...(b.unitId ? { unitId: b.unitId } : {}) } });
  }
  // The secure corridors: each housing unit to the main corridor (sally-port doors), the main corridor to central control.
  const conns = [];
  for (const u of units) { const c = corridor(G, sp.rec, u.rec, { width: 2, name: `Secure corridor to ${u.name.toLowerCase()}`, dk: "security", sally: true }); if (c) conns.push(c); }
  { const c = corridor(G, sp.rec, ctl.rec, { width: 2, name: "Secure corridor to central control", dk: "security", sally: false }); if (c) conns.push(c); }
  const I = (x, y) => y * W + x, cells = G.cells;
  const ownerAt = (x, y) => G.owner[I(x, y)];
  const setK = (x, y, k, extra = {}) => { if (x < 0 || y < 0 || x >= W || y >= H || ownerAt(x, y) >= 0) return false; const c = cells[I(x, y)]; for (const q of Object.keys(c)) if (q !== "f") delete c[q]; Object.assign(c, { k, ...extra }); return true; };
  // ---------- the perimeter ----------
  const ringCells = (r) => { const out = []; for (let x = r.x0; x < r.x0 + r.w; x++) out.push([x, r.y0], [x, r.y0 + r.h - 1]); for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) out.push([r.x0, y], [r.x0 + r.w - 1, y]); return out; };
  const wireLine = { x0: outer.x0 + Math.floor(gap / 2), y0: outer.y0 + Math.floor(gap / 2), w: outer.w - 2 * Math.floor(gap / 2), h: outer.h - 2 * Math.floor(gap / 2) };
  const lane = (x) => x >= gx && x < gx + 4;
  for (const [x, y] of ringCells(outer)) if (!(lane(x) && y === southOuter)) setK(x, y, kind === "max" ? "wall" : "pfence", kind === "max" ? { t: 2, f: "floor" } : {});
  for (const [x, y] of ringCells(wireLine)) if (!(lane(x) && y > southInner)) setK(x, y, "wire", { razor: true });
  for (const [x, y] of ringCells(inner)) if (!(lane(x) && y === southInner)) setK(x, y, "pfence");
  // The gates: the sally port's in each line (open gates) and the lane between, a road.
  for (let x = gx; x < gx + 4; x++) {
    setK(x, southOuter, "gate", { f: "road", sally: true }); setK(x, southInner, "gate", { f: "road", sally: true });
    for (let y = southInner + 1; y < southOuter; y++) setK(x, y, "open", { f: "road" });
  }
  // The sally port's pen inside the inner gate: a fenced lane with a gate at its far end (the bus's place).
  const pen = { x0: gx - 2, y0: southInner - 12, w: 8, h: 12 };
  for (let y = pen.y0; y < pen.y0 + pen.h; y++) { setK(pen.x0, y, "pfence"); setK(pen.x0 + pen.w - 1, y, "pfence"); for (let x = pen.x0 + 1; x < pen.x0 + pen.w - 1; x++) setK(x, y, "open", { f: "road" }); }
  for (let x = pen.x0; x < pen.x0 + pen.w; x++) setK(x, pen.y0, x > pen.x0 && x < pen.x0 + pen.w - 1 ? "gate" : "pfence", { f: "road", sally: true });
  for (let y = southInner + 1; y < southOuter + 9; y++) for (let x = gx; x < gx + 4; x++) if (cells[I(x, y)].k === "open") cells[I(x, y)].f = "road";
  const sallyport = { x0: pen.x0 + 1, y0: pen.y0 + 1, w: pen.w - 2, h: pen.h - 1 };
  // The holes (state prisons): through both fence lines and the wire between, where some got out.
  const holes = [];
  if (kind === "state") {
    const nh = rng.int(PRISON.HOLES[0], PRISON.HOLES[1]);
    for (let i = 0; i < nh; i++) {
      const side = rng.pick(["west", "east", "north"]);
      const t = rng.int(20, (side === "north" ? outer.w : outer.h) - 20);
      const pts = side === "north" ? [[outer.x0 + t, outer.y0], [outer.x0 + t, wireLine.y0], [outer.x0 + t, inner.y0]] : side === "west" ? [[outer.x0, outer.y0 + t], [wireLine.x0, outer.y0 + t], [inner.x0, outer.y0 + t]] : [[outer.x0 + outer.w - 1, outer.y0 + t], [wireLine.x0 + wireLine.w - 1, outer.y0 + t], [inner.x0 + inner.w - 1, outer.y0 + t]];
      if (pts.some(([x, y]) => ownerAt(x, y) >= 0)) continue;
      for (const [x, y] of pts) { const c = cells[I(x, y)]; for (const q of Object.keys(c)) if (q !== "f") delete c[q]; c.k = "open"; c.hole = true; c.cutWire = true; }
      holes.push({ side, x: pts[2][0], y: pts[2][1] });
    }
  }
  // The towers: 2 × 2 just inside the inner fence at its corners and every K.tower cells along it.
  const towers = [];
  const tower = (x, y) => {
    const r = { x0: x, y0: y, w: 2, h: 2 };
    for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) if (ownerAt(xx, yy) >= 0 || cells[I(xx, yy)].k !== "open" || G.keep[I(xx, yy)] || lane(xx) || inRect(pen, xx, yy, 1)) return;
    if (holes.some((h) => Math.abs(h.x - x) < 4 && Math.abs(h.y - y) < 4)) return;
    for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) { setK(xx, yy, "tower", { f: "gravel" }); G.keep[I(xx, yy)] = 1; }
    towers.push(r);
  };
  const ix0 = inner.x0 + 1, iy0 = inner.y0 + 1, ix1 = inner.x0 + inner.w - 3, iy1 = inner.y0 + inner.h - 3;
  for (let x = ix0; x <= ix1; x += K.tower) { tower(x, iy0); tower(x, iy1); }
  for (let y = iy0 + K.tower; y < iy1; y += K.tower) { tower(ix0, y); tower(ix1, y); }
  tower(ix1, iy0); tower(ix1, iy1); tower(ix0, iy1);
  // ---------- the yard: a track round a basketball court, weights, bleachers ----------
  /** @type {any} */
  const yardArea = yard ? { id: G.areas.length, type: null, role: "yard", name: "Exercise yard", outdoor: true, f: 0, ...yard, doors: [] } : null;
  if (yard) {
    G.areas.push(yardArea);
    const tr = { x0: yard.x0 + 2, y0: yard.y0 + 2, w: yard.w - 4, h: yard.h - 4 };
    for (let y = tr.y0; y < tr.y0 + tr.h; y++) for (let x = tr.x0; x < tr.x0 + tr.w; x++) if (!inRect({ x0: tr.x0 + 2, y0: tr.y0 + 2, w: tr.w - 4, h: tr.h - 4 }, x, y)) cells[I(x, y)].f = "dirt";
    const court = { x0: yard.x0 + Math.floor(yard.w / 2) - 13, y0: yard.y0 + Math.floor(yard.h / 2) - 7, w: 26, h: 14 };
    for (let y = court.y0; y < court.y0 + court.h; y++) for (let x = court.x0; x < court.x0 + court.w; x++) cells[I(x, y)].f = "road";
    yardArea.court = court; yardArea.track = tr;
    let wb = 0;
    for (let i = 0; i < 6; i++) { const x = tr.x0 + 4 + i * 3, y = tr.y0 + 4; if (setK(x, y, "weightbench", { f: "conc", fc: "s", pc: 900000 + i * 2 }) && setK(x, y + 1, "weightbench", { f: "conc", fc: "s", pc: 900000 + i * 2 })) wb++; }
    yardArea.weights = wb;
    let bl = 0;
    for (let i = 0; i < 3; i++) { const x = court.x0 + 4 + i * 7, y = court.y0 + court.h + 1, pc = 910000 + i; if ([[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dy]) => cells[I(x + dx, y + dy)].k === "open")) { for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) setK(x + dx, y + dy, "bleachers", { f: "dirt", fc: "n", pc }); bl++; } }
    yardArea.bleachers = bl;
  }
  // ---------- the staff parking: cars to search ----------
  const lot = { x0: gx - 6 - 40, y0: southOuter + 26, w: 36, h: 10 };
  const park = { id: G.areas.length, type: "wreck", name: "Staff parking", outdoor: true, f: 0, ...lot, doors: [] };
  let cars = 0;
  for (let t = 0; t < 40 && cars < rng.int(5, 9); t++) {
    const x = lot.x0 + rng.int(0, lot.w - 4), y = lot.y0 + rng.int(0, lot.h - 3);
    const r = placeCar(cells, W, H, x, y, "y", 3, "car", (cx, cy) => cells[I(cx, cy)].k === "open" && ownerAt(cx, cy) < 0 && !G.keep[I(cx, cy)], rng.int(0, 1e6));
    if (!r) continue;
    for (let yy = r.y0; yy < r.y0 + r.h; yy++) for (let xx = r.x0; xx < r.x0 + r.w; xx++) G.keep[I(xx, yy)] = 1;
    G.containers.push({ id: G.cid++, x: r.x0, y: r.y0, w: r.w, h: r.h, f: 0, area: park.id, kind: "car", searched: false, label: "Staff parking: car" });
    cars++;
  }
  for (let y = lot.y0; y < lot.y0 + lot.h; y++) for (let x = lot.x0; x < lot.x0 + lot.w; x++) if (cells[I(x, y)].k === "open") cells[I(x, y)].f = "road";
  if (cars) G.areas.push(park);
  // The evacuation bus in the sally port's pen (a container: interiorscenes.js's bus scene tells its story).
  let busAt = null;
  {
    const r = placeCar(cells, W, H, pen.x0 + 2, pen.y0 + 3, "y", 6, "truck", (cx, cy) => cells[I(cx, cy)].k === "open" && ownerAt(cx, cy) < 0, rng.int(0, 1e6), { ring: false, body: "truck" });
    if (r) {
      const sa = { id: G.areas.length, type: "pbus", name: "Sally port", outdoor: true, f: 0, ...sallyport, doors: [] };
      G.areas.push(sa);
      G.containers.push({ id: G.cid++, x: r.x0, y: r.y0, w: r.w, h: r.h, f: 0, area: sa.id, kind: "pbus", searched: false, label: "Sally port: prison bus" });
      busAt = [r.x0, r.y0];
    }
  }
  // ---------- the ways out: zones at the map's edge outside the perimeter ----------
  const Z = BMAP.ZONE;
  const zones = [
    { x0: gx, y0: H - Z, w: Z, h: Z, side: "south", exit: "south", name: "The approach road", vehicle: false },
    { x0: 0, y0: Math.floor(H / 2) - 1, w: Z, h: Z, side: "west", exit: "west", name: "The west fields", vehicle: false },
    { x0: W - Z, y0: Math.floor(H / 2) - 1, w: Z, h: Z, side: "east", exit: "east", name: "The east fields", vehicle: false },
    { x0: Math.floor(W / 2) - 1, y0: 0, w: Z, h: Z, side: "north", exit: "north", name: "The north fields", vehicle: false },
  ];
  for (let y = southOuter + 1; y < H; y++) for (let x = gx; x < gx + 4; x++) if (cells[I(x, y)].k === "open") cells[I(x, y)].f = "road"; // the approach road
  // The checkpoint on the approach (#25's pieces): a barrier gate either side of the lane, a guard booth beside it.
  for (const [x, k] of [[gx - 1, "barrier"], [gx + 4, "barrier"], [gx + 5, "guardbooth"]]) if (setK(x, southOuter + 4, k, { f: "road", fc: "s" })) G.keep[I(x, southOuter + 4)] = 1;
  for (const z of zones) for (let y = z.y0 - 1; y <= z.y0 + z.h; y++) for (let x = z.x0 - 1; x <= z.x0 + z.w; x++) if (x >= 0 && y >= 0 && x < W && y < H) G.keep[I(x, y)] = 1;
  const vehicle = compoundVehicle(G, zones[0], withVehicle);
  // ---------- dressing: floodlights along the inner fence, crates and barrels by the buildings' back doors ----------
  const gd = guard(G, zones[0].x0 + 1, zones[0].y0 + 1, { free: (x, y) => x >= 0 && y >= 0 && x < W && y < H && G.cells[y * W + x].k === "open" && !G.keep[y * W + x] && G.owner[y * W + x] < 0 });
  for (let i = 0; i < 24; i++) { const x = rng.int(inner.x0 + 2, inner.x0 + inner.w - 3), y = rng.pick([inner.y0 + 2, inner.y0 + inner.h - 3]); gd.block(x, y, "lamp"); }
  for (let i = 0; i < 30; i++) { const b = rng.pick(B); const x = b.x0 + rng.int(-3, b.m.building.w + 2), y = b.y0 + rng.pick([-3, b.m.building.h + 2]); gd.block(x, y, rng.pick(["crate", "barrel"])); }
  const map = finish(G, option, {
    kind, zones, vehicle,
    extra: {
      prisonKind: kind, kindName: K.name, layout: L.id, layoutName: L.name, plans: B.filter((b) => b.sp.vid).map((b) => ({ name: b.name, role: b.role, plan: b.sp.vid, planName: b.sp.vname })), perimeter: { outer, inner, wire: wireLine, wall: kind === "max" }, towers, holes, sallyport, gate: { x: gx, w: 4, y: southOuter, house: gh.rec.k }, yard: yardArea ? yardArea.id : null,
      units: units.map((u) => ({ unitId: u.unitId, name: u.name, house: u.rec.k, dorm: !!u.dorm, role: u.role })), control: ctl.rec.k, spine: sp.rec.k, armory: ar.rec.k, conns: conns.map((c) => c.id),
    },
  });
  finishPrison(map, rng, units, B, kind);
  map.busAt = busAt;
  map.deadScale = PRISON.DEAD[kind];
  return map;
}
// A county jail's layouts (the user's dozen, issue #31): where its two pods stand along the jail's back (pods: over its
// middle, a T; at its west or east end, an L; at both ends, apart: a U) and which has the exercise pen (pen: pod A's,
// pod B's, or one pen behind both, shared).
export const JAIL_LAYOUTS = [];
for (const [pods, pn] of [["centre", "T (the pods over the middle)"], ["west", "L (the pods at the west end)"], ["east", "L (the pods at the east end)"], ["apart", "U (a pod at each end)"]])
  for (const [pen, nn] of [["a", "the pen off pod A"], ["b", "the pen off pod B"], ["shared", "one pen behind both pods"]]) JAIL_LAYOUTS.push({ id: `${pods}-${pen}`, name: `${pn}, ${nn}`, pods, pen });
// A county jail: the jail building and two pods north of it, a fenced pen off a pod, the street in front.
function jailMap(rng, seed, option, withVehicle, o) {
  const K = PRISON.KINDS.jail;
  const jcap = mapCap("jail") || K.map[0][1];
  const W = Math.min(jcap, rng.int(K.map[0][0], K.map[0][1])), H = Math.min(jcap, rng.int(K.map[1][0], K.map[1][1]));
  const legacy = !!o.legacy;
  const main = build(seed, "jail", jailMain, "jailmain", "County jail", legacy); main.role = "jail";
  const mw = main.m.building.w, mh = main.m.building.h;
  main.x0 = Math.floor((W - mw) / 2) + rng.int(-6, 6); main.y0 = H - 18 - mh;
  const L = pickPlan(rng, JAIL_LAYOUTS, { layout: o.layout });
  const units = [];
  const yardOf = (i) => L.pen === "shared" || i === (L.pen === "a" ? 0 : 1);
  for (let i = 0; i < 2; i++) {
    const len = foot(rng, "ppod")[0];
    // A pod's plans: those with cells both sides of the day room and its station at the end the jail's corridor reaches.
    const u = build(seed, `pod${i}`, (r) => housingUnit(r, { len, picket: i === 0 ? "left" : "right", unitId: i + 1, kind: "cells", tiers: 2, yard: yardOf(i), only: (q) => !q.core && q.picket !== "split" }), "pblock", `Pod ${String.fromCharCode(65 + i)}`, legacy);
    u.role = "housing"; u.unitId = i + 1; units.push(u);
  }
  // The pods side by side north of the jail, turned so their officers' stations face it (compound.js placeBuilding
  // face: the first's station on its left turned to the south, the second's on its right): one over the middle of the
  // jail or one over an end (an L or a T of buildings), joined to its secure corridor along the back.
  units[0].face = "e"; units[1].face = "w";
  const pw = units.map((u) => u.m.building.h), gapX = 6;
  const span = pw[0] + gapX + pw[1];
  if (L.pods === "apart") { units[0].x0 = main.x0 - Math.floor(pw[0] / 3); units[1].x0 = Math.max(units[0].x0 + pw[0] + gapX, main.x0 + mw - pw[1] + Math.floor(pw[1] / 3)); }
  else {
    const startX = L.pods === "west" ? main.x0 + 2 : L.pods === "east" ? main.x0 + mw - 2 - span : main.x0 + Math.floor((mw - span) / 2);
    units[0].x0 = startX; units[1].x0 = startX + pw[0] + gapX;
  }
  for (const u of units) u.x0 = Math.max(2, Math.min(W - 2 - u.m.building.h, u.x0));
  for (const u of units) u.y0 = main.y0 - 7 - u.m.building.w;
  const B = [main, ...units];
  const storeys = Math.max(...B.map((b) => b.m.storeys || 1));
  const street = { y0: H - 10, h: 6 };
  const G = grid(W, H, storeys, (x, y) => (y >= street.y0 && y < street.y0 + street.h ? "road" : y === street.y0 - 1 || y === street.y0 + street.h ? "gravel" : "grass"));
  for (const b of B) b.rec = stamp(G, b.m, b.x0, b.y0, { name: b.name, face: b.face, extra: { role: b.role, ...(b.unitId ? { unitId: b.unitId } : {}) } });
  const conns = [];
  for (const u of units) { const c = corridor(G, main.rec, u.rec, { width: 2, name: `Secure corridor to ${u.name.toLowerCase()}`, dk: "security", sally: true }); if (c) conns.push(c); }
  const I = (x, y) => y * W + x, cells = G.cells;
  // The pen: a fenced yard off the pod with the yard door (its exit's side of the pod), the door its one way in; a
  // shared pen behind both pods, their yard doors its ways in.
  const yu = units.find((u) => u.sp.exits.length);
  let pen = null;
  const ex = yu ? yu.rec.exits.find((e) => e.cells.length) : null;
  const exs = units.map((u) => u.rec.exits.find((e) => e.cells.length)).filter(Boolean);
  if (L.pen === "shared" && exs.length === 2 && exs.every((e) => e.side === "n")) {
    const x0 = Math.min(...units.map((u) => u.rec.x0)), x1 = Math.max(...units.map((u) => u.rec.x0 + u.rec.w)), y1 = Math.min(...units.map((u) => u.rec.y0)), deep = 12;
    pen = { x0, y0: Math.max(1, y1 - deep), w: x1 - x0, h: y1 - Math.max(1, y1 - deep) };
    for (let y = pen.y0; y < pen.y0 + pen.h; y++) for (let x = pen.x0; x < pen.x0 + pen.w; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H || G.owner[I(x, y)] >= 0) continue;
      const c = cells[I(x, y)];
      if (y === pen.y0 || x === pen.x0 || x === pen.x0 + pen.w - 1) c.k = "pfence"; else c.f = "conc";
      G.keep[I(x, y)] = 1;
    }
    // Between the pods the pen's south edge is a fence too (the gap down to the jail stays outside).
    const gx0 = units[0].rec.x0 + units[0].rec.w, gx1 = units[1].rec.x0;
    for (let x = gx0; x < gx1; x++) if (G.owner[I(x, y1)] < 0) { cells[I(x, y1)].k = "pfence"; G.keep[I(x, y1)] = 1; }
    G.areas.push({ id: G.areas.length, type: null, role: "yard", name: "Exercise pen", outdoor: true, f: 0, ...pen, doors: exs.map((e) => e.cells[0].slice()) });
  } else if (ex) {
    const B0 = yu.rec, [dx, dy] = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[ex.side], along = 16, deep = 12;
    const [cx, cy] = ex.cells[0];
    pen = dx ? { x0: dx > 0 ? B0.x0 + B0.w : B0.x0 - deep, y0: Math.max(B0.y0, Math.min(B0.y0 + B0.h - along, cy - (along >> 1))), w: deep, h: along }
      : { x0: Math.max(B0.x0, Math.min(B0.x0 + B0.w - along, cx - (along >> 1))), y0: dy > 0 ? B0.y0 + B0.h : B0.y0 - deep, w: along, h: deep };
    for (let y = pen.y0; y < pen.y0 + pen.h; y++) for (let x = pen.x0; x < pen.x0 + pen.w; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H || G.owner[I(x, y)] >= 0) continue;
      const far = dx ? (dx > 0 ? x === pen.x0 + pen.w - 1 : x === pen.x0) : dy > 0 ? y === pen.y0 + pen.h - 1 : y === pen.y0;
      const edge = far || (dx ? y === pen.y0 || y === pen.y0 + pen.h - 1 : x === pen.x0 || x === pen.x0 + pen.w - 1);
      const c = cells[I(x, y)];
      if (edge) c.k = "pfence"; else c.f = "conc";
      G.keep[I(x, y)] = 1;
    }
    G.areas.push({ id: G.areas.length, type: null, role: "yard", name: "Exercise pen", outdoor: true, f: 0, ...pen, doors: [ex.cells[0].slice()] });
  }
  // The street: parked cars, the staff lot beside the jail.
  const wreck = { id: G.areas.length, type: "wreck", name: "Parked cars", outdoor: true, f: 0, x0: 0, y0: street.y0, w: W, h: street.h, doors: [] };
  let cars = 0;
  for (let t = 0; t < 40 && cars < rng.int(2, 4); t++) {
    const x = rng.int(6, W - 10), y = rng.pick([street.y0, street.y0 + street.h - 2]);
    const r = placeCar(cells, W, H, x, y, "x", 3, "car", (cx, cy) => cells[I(cx, cy)].k === "open" && G.owner[I(cx, cy)] < 0, rng.int(0, 1e6));
    if (!r) continue;
    G.containers.push({ id: G.cid++, x: r.x0, y: r.y0, w: r.w, h: r.h, f: 0, area: wreck.id, kind: "car", searched: false, label: "Parked cars: car" });
    cars++;
  }
  if (cars) G.areas.push(wreck);
  const Z = BMAP.ZONE, zy = street.y0 + 1;
  const zones = [
    { x0: 0, y0: zy, w: Z, h: Z, side: "west", exit: "west", name: "West end of the street", vehicle: false },
    { x0: W - Z, y0: zy, w: Z, h: Z, side: "east", exit: "east", name: "East end of the street", vehicle: false },
    { x0: Math.floor(W / 2) - 1, y0: 0, w: Z, h: Z, side: "north", exit: "north", name: "Behind the jail", vehicle: false },
  ];
  for (const z of zones) for (let y = z.y0 - 1; y <= z.y0 + z.h; y++) for (let x = z.x0 - 1; x <= z.x0 + z.w; x++) if (x >= 0 && y >= 0 && x < W && y < H) G.keep[I(x, y)] = 1;
  const gd = guard(G, zones[0].x0 + 1, zones[0].y0 + 1, { free: (x, y) => x >= 0 && y >= 0 && x < W && y < H && G.cells[y * W + x].k === "open" && !G.keep[y * W + x] && G.owner[y * W + x] < 0 });
  for (let i = 0; i < 10; i++) gd.block(rng.int(1, W - 2), rng.int(1, street.y0 - 3), "tree");
  const vehicle = compoundVehicle(G, zones[0], withVehicle);
  const map = finish(G, option, { kind: "jail", zones, vehicle, extra: { prisonKind: "jail", kindName: K.name, layout: L.id, layoutName: L.name, plans: B.filter((b) => b.sp.vid).map((b) => ({ name: b.name, role: b.role, plan: b.sp.vid, planName: b.sp.vname })), units: units.map((u) => ({ unitId: u.unitId, name: u.name, house: u.rec.k, dorm: false, role: u.role })), control: main.rec.k, pen, conns: conns.map((c) => c.id), towers: [], holes: [] } });
  finishPrison(map, rng, units, B, "jail");
  map.deadScale = PRISON.DEAD.jail;
  return map;
}

// The cell doors by each unit's state; the guards' bodies at their posts (the scene bodies, interiorscenes.js
// sceneBattle: bodies with their kit to search); the plan's numbers (beds, cells).
function finishPrison(map, rng, units, B, kind) {
  const plan = map.plan;
  plan.doorState = {};
  for (const u of units) {
    const st = pickW(rng, PRISON.DOORS);
    plan.doorState[u.unitId] = st;
    setDoorsOn(map, u.unitId, st);
  }
  const posts = [];
  for (const t of plan.towers || []) posts.push({ f: 0, x: t.x0, y: t.y0, what: "tower" });
  for (const a of map.rooms) if ((a.prison === "picket" && !(a.f > 0)) || a.prison === "control" || a.prison === "gate") { const c = freeIn(map, a); if (c) posts.push({ f: a.f || 0, x: c[0], y: c[1], what: a.prison }); }
  plan.posts = [];
  for (const p of posts) if (rng.chance(PRISON.POSTS)) plan.posts.push(p);
  plan.beds = prisonBeds(map);
  plan.cells = countCells(map);
}
function setDoorsOn(map, unitId, st) {
  map.floors.forEach((F, f) => F.cells.forEach((c, i) => {
    if (!c.cellDoor || c.tier !== unitId) return;
    if (st === "opened") c.k = "odoor";
    else if (st === "locked") { c.k = "door"; c.dk = "cell"; c.hp = c.mhp = Math.max(60, BMAP.DOOR.locked); map.lockedDoors.push({ x: i % map.w, y: (i / map.w) | 0, f, area: null, kind: "door", dk: "cell", cellDoor: true, unitId }); }
  }));
}
const freeIn = (map, a) => {
  const cells = map.floors[a.f || 0].cells;
  for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) { const c = cells[y * map.w + x]; if (c.k === "open" && c.f === "floor") return [x, y]; }
  return null;
};
// The cells of the map (cell doors), by unit.
function countCells(map) {
  const out = {};
  map.floors.forEach((F) => F.cells.forEach((c) => { if (c.cellDoor) out[c.tier ?? 0] = (out[c.tier ?? 0] || 0) + 1; }));
  return out;
}
// The beds a map holds: two a cell (a single cell's one: segregation, death row, psych), two a dormitory bunk.
export function prisonBeds(map) {
  let n = 0;
  const single = new Set(map.rooms.filter((a) => a.single || a.role === "psych").map((a) => a.id));
  for (const F of map.floors) F.cells.forEach((c, i) => {
    if (c.k === "bunk" && c.pc) n += 1; // a dorm bunk's two cells: one each
    if (c.cellDoor) {
      const a = map.rooms.find((r) => !r.outdoor && r.f != null && (i % map.w) > r.x0 && (i % map.w) < r.x0 + r.w - 1 && ((i / map.w) | 0) > r.y0 && ((i / map.w) | 0) < r.y0 + r.h - 1 && r.prison === "tier" && map.floors[r.f || 0] === F);
      n += a && single.has(a.id) ? 1 : 2;
    }
  });
  return n;
}

// ======================================================================================
// The raid
// ======================================================================================
// The guards dead at their posts (after the scenes: interiorscenes.js sceneBattle makes them bodies with their kit to
// search): plan.posts' cells, the ones a scene left free.
const POST_GUNS = ["pistol", "pistol", "shotgun", "revolver", "huntrifle"]; // a tower's and a post's officer (combat.js KITS.guards)
export function postBodies(map) {
  const P = map.plan;
  if (!P || !P.posts || !P.posts.length) return;
  if (!map.scenes) map.scenes = { list: [], bodies: [], pieces: [], piles: [], seed: 1 + Math.floor(hash01("posts", P.id, P.w) * 2147483645) };
  const S = map.scenes, used = new Set(S.bodies.map((o) => `${o.f}:${o.x},${o.y}`));
  for (const p of P.posts) {
    if (used.has(`${p.f}:${p.x},${p.y}`)) continue;
    used.add(`${p.f}:${p.x},${p.y}`);
    S.bodies.push({ f: p.f, x: p.x, y: p.y, human: true, quiet: false, r: hash01("postr", p.x, p.y), weapon: POST_GUNS[Math.floor(hash01("postw", p.x, p.y) * POST_GUNS.length)], kit: "guards", name: "A corrections officer", post: p.what });
  }
}
// The intro line (combat.js createRaid): the housing units, the armory and the gate.
export function prisonIntro(b) {
  const P = b && b.raid && b.raid.plan;
  if (!P || !P.complex) return "";
  const names = (P.units || []).map((u) => u.name);
  const houses = P.houses || [];
  const arm = P.armory != null && houses[P.armory] ? "the armory outside the fence" : "the armory upstairs from booking";
  const gate = P.gate ? "the sally port and the gatehouse are the ways in through the fence" : "the street is the way in";
  const st = Object.values(P.doorState || {});
  const locked = st.filter((s) => s === "locked").length, opened = st.filter((s) => s === "opened").length;
  return `${P.kindName}: ${houses.length} buildings, ${P.beds || 0} beds. Housing: ${names.join(", ")}${opened ? ` (${opened} with the doors opened)` : ""}${locked ? ` (${locked} still locked down)` : ""}. Loot: ${arm}; ${gate}.`;
}

// The switch on a control panel (combatAct "cellswitch"): next to a control panel in a unit's officers' station its
// unit's cell doors, in central control (or a jail's control room) every unit's, all open at once: loud (the doors'
// motors and the alarm), Heat + SWITCH.HEAT and everyone within SWITCH.RADIUS hears it. Returns an error or "".
export const SWITCH = { AP: 1, HEAT: 6, RADIUS: 18 };
export function switchPanel(b, u) {
  if (!b || !b.raid || !b.raid.plan || !b.raid.plan.complex || !u) return null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const x = u.x + dx, y = u.y + dy;
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
    if (b.cells[y * b.w + x].k !== "ctrlpanel") continue;
    const room = b.raid.areas.find((a) => !a.outdoor && (a.f || 0) === (b.floor || 0) && x > a.x0 && x < a.x0 + a.w - 1 && y > a.y0 && y < a.y0 + a.h - 1);
    if (!room) continue;
    return { x, y, room, all: room.prison === "control", unitId: room.unitId ?? null };
  }
  return null;
}
export function cellSwitch(state, b, u, h) {
  const p = switchPanel(b, u);
  if (!p) return "Stand next to a control panel (an officers' station or central control).";
  if ((u.ap || 0) < SWITCH.AP) return "No actions left.";
  let n = 0;
  const floors = b.floors ? b.floors.map((F) => F.cells) : [b.cells];
  floors.forEach((cells, f) => cells.forEach((c, i) => {
    if (!c.cellDoor || (!p.all && c.tier !== p.unitId)) return;
    if (c.k === "door" || c.k === "idoor") {
      c.k = "odoor"; n++;
      const d = (b.raid.doors || []).find((q) => q.x === i % b.w && q.y === ((i / b.w) | 0) && (q.f || 0) === f);
      if (d) d.lock.open = true;
    }
  }));
  u.ap -= SWITCH.AP;
  b.raid.heat = (b.raid.heat || 0) + SWITCH.HEAT;
  b.raid.noise = (b.raid.noise || 0) + 1;
  if (b.losCache) b.losCache.fill(0);
  if (b.floors) for (const F of b.floors) if (F.losCache && F.losCache !== b.losCache) F.losCache.fill(0);
  if (h && h.alertNear) h.alertNear(b, u.x, u.y, SWITCH.RADIUS, "Motors grind and an alarm wails: the cell doors roll open.", u);
  if (h && h.say) h.say(b, n ? `${u.name} throws the switch: ${n} cell door${n === 1 ? "" : "s"} roll open${p.all ? " across the prison" : ""}, the alarm wailing.` : `${u.name} throws the switch: the doors are open already.`, n ? "danger" : "info");
  return "";
}
// A prison gang holding a unit (combat.js createRaid, after the building's dead and the people the world has there):
// on the site's own dice (PRISON.HOLD.chance), 3–6 inmates who took a housing unit, in the day room of the takeover
// scene's unit when it has one, else a unit's day room or dormitory; armed from what a prison holds (shivs, batons, a
// shotgun or a pistol off a guard). Hostile, placed through buildingmaps.js placeOccupantGroups: each one a survivor
// record of their own (combat.js enemyUnit, fighters.js: ADR 0001), as any site's holders.
export function prisonHolders(state, b, place) {
  const P = b && b.raid && b.raid.plan;
  if (!P || !P.complex) return 0;
  const H = PRISON.HOLD;
  if (hash01(state.seed, "prisonhold", b.tileId, P.id) >= H.chance) return 0;
  const sc = b.raid.scenes && b.raid.scenes.list.find((s) => s.kind === "takeover");
  const rooms = b.raid.areas.filter((a) => !a.outdoor && (a.prison === "dayroom" || a.prison === "dorm") && !(a.f > 0) && !a.well);
  if (!rooms.length) return 0;
  const room = (sc && rooms.find((a) => a.id === sc.room)) || rooms[Math.floor(hash01(state.seed, "prisonholdroom", b.tileId) * rooms.length)];
  const n = H.n[0] + Math.floor(hash01(state.seed, "prisonholdn", b.tileId) * (H.n[1] - H.n[0] + 1));
  const people = Array.from({ length: n }, (_, i) => ({ kit: "raiders", weapon: H.guns[Math.floor(hash01(state.seed, "prisonholdgun", b.tileId, i) * H.guns.length)], power: H.power, name: i === 0 ? "The gang's boss" : "An inmate" }));
  place(state, b, [{ side: "hostile", kind: "raiders", count: n, power: H.power, name: "a prison gang", people, room: room.id, aware: false }]);
  b.raid.holders = { room: room.id, n, name: "a prison gang" };
  return n;
}
