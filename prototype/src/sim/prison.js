// @ts-check
// Prison complexes (the user's request 2026-10-25, issue #31 of the interiors epic #7: "add … prisons max of 400x400").
// A prison site (data.js LOCATIONS prison) and a county jail (the jail POI, pois.js jailExtra: one in a suburb ring of
// each town) open one map of many buildings instead of a pick of one (buildingmaps.js buildingMap → prisonMap), laid out
// through complexmap.js (the multi-building map shared with the campus, #28) and furnished by prisonlayout.js. New saves
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
// gates, a hole in the fence (PRISON.HOLES) or one cut (wire.js: FENCE_CUTS cuts with a cutter).
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";
import { assemble, BMAP, DOOR_KINDS } from "./buildingmaps.js"; // call-time only (buildingmaps.js builds the complexes through here)
import { placeCar, placeVehicle } from "./combat.js";
import { complexGrid, stampBuilding, connectBuildings, guard, finishComplex } from "./complexmap.js";

export const PRISON = {
  // The map's cap (cells a side). #24's big-map engine work raises it to 400 (the user's "max of 400x400").
  CAP: 300,
  KINDS: {
    jail:  { name: "County jail", map: [[110, 130], [95, 110]], beds: [50, 200], units: [2, 2] },
    state: { name: "State prison", map: [[240, 300], null], beds: [500, 1500], units: [4, 6], tower: 60, gap: 4 },
    max:   { name: "Maximum-security penitentiary", map: [[300, 400], null], beds: [500, 1500], units: [6, 8], tower: 40, gap: 4 },
  },
  MAX_SHARE: 0.35,            // a prison site is a maximum-security penitentiary on these dice (else a state prison)
  DORM: 0.3,                  // a state prison's housing unit is a dormitory of bunks on these dice (else cells)
  DOORS: { opened: 0.3, shut: 0.45, locked: 0.25 }, // a block's cell doors: open, shut, locked from central control
  HOLES: [0, 2],              // holes in a state prison's fence (where some got out): each through both lines
  DENSE: 4,                   // the housing units' rooms weigh this much more for the dead (placeInterior)
  DEAD: { jail: 1.6, state: 5, max: 5.5 }, // the dead: the site's roster × this (map.deadScale)
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

// A housing unit. o: { len, day, tiers, picket: "left" | "right", unitId, kind: "cells" | "dorm", single, dk, name, yard }
export function housingUnit(rng, o) {
  const day = o.day ?? rng.int(7, 10), tiers = o.tiers ?? 2, unitId = o.unitId ?? 0;
  const left = o.picket !== "right";
  const tier = (face, f) => ({ role: "tier", prison: "tier", face, unitId, name: `${face === "n" ? "Back" : "Front"} ${f ? "upper" : "lower"} tier`, ...(o.dk ? { dk: o.dk } : {}), ...(o.single ? { single: true } : {}), dense: PRISON.DENSE });
  const core = (f) => o.kind === "dorm"
    ? { role: "pdorm", prison: "dorm", unitId, name: f ? "Upper dormitory" : "Dormitory", dense: PRISON.DENSE }
    : { split: "y", parts: [[5, tier("s", f)], ["*", f ? { role: "well", prison: "dayroom", well: true, unitId } : { role: "pdayroom", prison: "dayroom", unitId, name: "Day room", dense: PRISON.DENSE }], [5, tier("n", f)]] };
  const picket = (f) => [5, { role: "picket", prison: "picket", unitId, hub: true, ...(f ? { name: "Upper officers' station" } : { entry: true }) }];
  const plan = (f) => ({ split: "x", parts: left ? [picket(f), ["*", core(f)]] : [["*", core(f)], picket(f)] });
  const bh = o.kind === "dorm" ? rng.int(18, 22) : 2 + 5 + 1 + day + 1 + 5;
  return spec(o.len, bh, plan(0), {
    storeys: tiers, stairs: { roles: ["picket"], n: 1, len: 2 }, upper: tiers > 1 ? (f) => plan(f) : null,
    exits: o.yard ? [{ side: left ? "right" : "left", roles: [o.kind === "dorm" ? "pdorm" : "pdayroom"], chance: 1, lock: 0.3, name: "Yard door" }] : [],
    unit: { unitId, kind: o.kind || "cells", left, tiers, name: o.name },
  });
}
// The main corridor (the telephone pole): one long hall, 3 wide.
const spine = (len) => spec(5, len, { role: "mainhall", name: "Main corridor", entry: true });
// Central control: the control room, its lobby, the shift office.
function centralControl(rng) {
  return spec(rng.int(18, 22), rng.int(11, 13), { split: "x", parts: leaves([["*", { role: "pcontrol", prison: "control", panels: 4, name: "Central control" }], [6, { role: "lobby", entry: true, name: "Control lobby" }], ["*", { role: "office", prison: "office", name: "Shift office" }]]) });
}
// The chow hall: the hall, the kitchen and the food warehouse behind.
export function chowHall(rng) {
  return spec(rng.int(30, 38), rng.int(22, 26), { split: "y", parts: [["*", { role: "chow", prison: "chow", entry: true }], [8, { split: "x", parts: leaves([["*", { role: "pkitchen", prison: "pkitchen" }], [10, { role: "pstores", prison: "pstores", lock: ["door", 0.4] }], [5, { role: "storage", name: "Dry store", type: "pstores" }]]) }]] },
    { exits: [{ side: "back", roles: ["pstores", "storage"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Loading dock" }] });
}
// The infirmary: the ward, the desk, the exam room, the pharmacy along the front; the psych unit's cells behind.
export function prisonInfirmary(rng) {
  return spec(rng.int(28, 34), 17, corridorPlan([["*", { role: "pward", prison: "ward" }], [5, { role: "lobby", entry: true, name: "Infirmary desk" }], [5, "exam"], [5, { role: "pharmroom", lock: ["door", 0.6], boxLock: ["drugs", 0.5] }]],
    [["*", { role: "psych", prison: "tier", face: "n", single: true }], [5, { role: "office", prison: "office", name: "Doctor's office" }], [4, { role: "storage", type: "clinic", name: "Medical stores" }]], 6, 2));
}
const chapel = (rng) => spec(rng.int(14, 18), rng.int(22, 26), { split: "y", parts: [[3, { role: "foyer", name: "Narthex", entry: true, type: "chapel", civic: "narthex" }], ["*", { role: "nave", name: "Chapel", civic: "nave" }], [4, { split: "x", parts: leaves([[4, { role: "vestry", civic: "vestry" }], ["*", { role: "storage", type: "chapel", name: "Chaplain's store" }]]) }]] });
const education = (rng) => spec(rng.int(30, 36), 16, corridorPlan([["*", { role: "plibrary", civic: "library", name: "Library" }], [5, { role: "lobby", entry: true, name: "Education lobby" }], ["*", { role: "classroom", civic: "classroom" }]],
  [["*", { role: "classroom", civic: "classroom" }], ["*", { role: "office", prison: "office", name: "Education office" }], [3, "restroom"]], 6, 2));
const industries = (rng) => spec(rng.int(40, 50), rng.int(16, 20), { split: "x", parts: leaves([["*", { role: "pshop", prison: "industries", name: "Licence-plate shop", entry: true }], ["*", { role: "pshop", prison: "industries", name: "Print shop" }], ["*", { role: "plaundry", prison: "laundry" }]]) },
  { exits: [{ side: "back", roles: ["pshop", "plaundry"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Loading door" }] });
const admin = (rng) => spec(rng.int(26, 32), 14, corridorPlan([["*", { role: "office", prison: "office", name: "Warden's office", boxLock: ["safe", 0.3], gunSafe: ["gunsafe2", 0.3] }], [6, { role: "lobby", entry: true, name: "Administration lobby" }], ["*", { role: "office", prison: "office", name: "Records", boxLock: ["evidence", 0.3] }]],
  [["*", { role: "office", prison: "office", name: "Personnel" }], [5, "breakroom"], [3, "restroom"]], 5), { storeys: 2, upper: () => corridorPlan([["*", { role: "office", prison: "office", name: "Deputy warden" }], [6, { role: "office", prison: "office", name: "Conference room" }], ["*", { role: "office", prison: "office", name: "Accounts" }]], [["*", { role: "office", prison: "office", name: "Records store" }], [5, "breakroom"], [3, "restroom"]], 5) });
const armory = (rng) => spec(rng.int(16, 20), 12, { split: "y", parts: [[3, { role: "foyer", name: "Issue window", entry: true, type: "barracks" }], ["*", { split: "x", parts: leaves([["*", { role: "parmory", prison: "parmory", name: "Armory", lock: ["vault", 0.8], boxLock: ["cage", 0.4], gunSafe: ["gunsafe3", 0.3] }], ["*", { role: "parmory", prison: "parmory", name: "Riot gear store", lock: ["door", 0.5] }]]) }]] });
// The gatehouse straddles the two fences: its front door outside, its back door inside. bh: the depth it must span.
const gatehouse = (rng, bh) => spec(rng.int(12, 14), bh, { split: "y", parts: [["*", { role: "gatepost", prison: "gate", entry: true, name: "Visitor processing" }], ["*", { role: "gatepost", prison: "gate", name: "Officers' post" }]] },
  { exits: [{ side: "back", roles: ["gatepost"], chance: 1, lock: 0, name: "Into the prison" }] });
// The county jail's building.
function jailMain(rng) {
  const bw = rng.int(42, 48);
  return spec(bw, 21, corridorPlan([[6, { role: "bays", name: "Sally port", type: "garage", maxBoxes: 2, civic: "sallyport" }], ["*", { role: "booking", prison: "booking", name: "Booking and intake" }], [6, { role: "lobby", entry: true, name: "Public lobby" }], ["*", { role: "visitation", prison: "visit" }]],
    [["*", { role: "holding", prison: "holding", name: "Holding tank" }], ["*", { role: "holding", prison: "holding", name: "Holding tank" }], [6, { role: "property", prison: "property", lock: ["door", 0.4] }], ["*", { role: "pkitchen", prison: "pkitchen", name: "Jail kitchen" }], [6, { role: "pward", prison: "ward", name: "Medical room" }]], 7, 2), {
    storeys: 2, stairs: { roles: ["corridor"], n: 1, len: 2 },
    upper: () => corridorPlan([["*", { role: "pcontrol", prison: "control", panels: 3, name: "Control room" }], ["*", { role: "office", prison: "office", name: "Jail administration" }], [6, { role: "office", prison: "office", name: "Sheriff's office", gunSafe: ["gunsafe2", 0.3] }]],
      [["*", { role: "office", prison: "office", name: "Records", boxLock: ["evidence", 0.3] }], [6, "breakroom"], [4, "restroom"], ["*", { role: "lockerroom", type: "lockers", name: "Officers' lockers" }]], 7, 2),
    exits: [{ side: "left", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.2, name: "Sally port" }],
  });
}

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
  for (let f = 0; f < floors.length; f++) {
    const tiers = rooms.filter((a) => a.f === f && a.prison === "tier"), mid = rooms.find((a) => a.f === f && a.prison === "dayroom"), pk = rooms.find((a) => a.f === f && a.prison === "picket");
    if (!mid) continue;
    for (const t of tiers) {
      const row = t.y0 === mid.y0 + mid.h - 1 ? t.y0 : t.y0 + t.h - 1; // the wall the tier shares with the day room
      for (let x = Math.max(t.x0, mid.x0) + 1; x <= Math.min(t.x0 + t.w, mid.x0 + mid.w) - 2; x++) {
        const c = at(f, x, row);
        if (f === 0) { Object.assign(c, { k: "open", f: "floor", fl: "conc" }); delete c.dk; delete c.hp; delete c.mhp; delete c.t; delete c.win; delete c.wart; }
        else { Object.assign(c, { k: "rail", f: "floor" }); delete c.dk; delete c.hp; delete c.mhp; delete c.t; delete c.win; delete c.wart; }
      }
      t.doors = (t.doors || []).filter(([x, y]) => y !== row);
      const walk = t.y0 > mid.y0 ? t.y0 + 1 : t.y0 + t.h - 2; // the front tier's cells are against the front wall: its walkway is its top row
      // The plan's other doors in the tier's walls (into the station beside a cell, not its walkway): bricked up.
      for (const [x, y] of t.doors.slice()) {
        if (y === walk) continue;
        const c = at(f, x, y);
        if (!["idoor", "odoor", "door"].includes(c.k)) continue;
        Object.assign(c, { k: "wall", f: "floor" }); delete c.dk; delete c.hp; delete c.mhp;
        for (const r of rooms) if (r.f === f && r.doors) r.doors = r.doors.filter(([dx, dy]) => dx !== x || dy !== y);
        m.lockedDoors = m.lockedDoors.filter((d) => d.x !== x || d.y !== y || (d.f || 0) !== f);
      }
      if (pk) { // the tier's door into the officers' station, at its walkway
        const wx = pk.x0 === t.x0 + t.w - 1 ? pk.x0 : pk.x0 + pk.w - 1;
        const c = at(f, wx, walk);
        if (c.k === "wall" || c.k === "window") {
          const dk = sp.unit.dk || "steel";
          Object.assign(c, { k: "idoor", dk, f: "floor", fl: "conc" });
          c.hp = c.mhp = (DOOR_KINDS[dk] || DOOR_KINDS.steel).hp;
          delete c.win; delete c.t;
          t.doors.push([wx, walk]); pk.doors.push([wx, walk]);
        }
      }
    }
    if (f > 0) { // the well: open air
      for (let y = mid.y0 + 1; y < mid.y0 + mid.h - 1; y++) for (let x = mid.x0 + 1; x < mid.x0 + mid.w - 1; x++) { const c = at(f, x, y); for (const k of Object.keys(c)) delete c[k]; c.k = "void"; c.f = "air"; }
      for (const [x, y] of mid.doors || []) { const c = at(f, x, y); if (c.k === "idoor" || c.k === "odoor") { Object.assign(c, { k: "rail" }); delete c.dk; delete c.hp; delete c.mhp; } }
      mid.doors = []; mid.type = null; mid.noLabel = true; mid.well = true;
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
 * @param {any} state @param {number} tileId @param {{ key: string, id: string, name: string }} option @param {any} withVehicle @param {{ legacy?: boolean, cap?: number }} [o]
 */
export function prisonMap(state, tileId, option, withVehicle, o = {}) {
  const kind = prisonKind(state, tileId, option);
  const seed = hash01(state.seed, "prison", tileId, option.id);
  const rng = new Rng(Math.floor(seed * 4294967296) || 1);
  return kind === "jail" ? jailMap(rng, seed, option, withVehicle, o) : penMap(rng, seed, option, kind, withVehicle, o);
}

// A state prison or a penitentiary.
function penMap(rng, seed, option, kind, withVehicle, o) {
  const K = PRISON.KINDS[kind], cap = o.cap || PRISON.CAP;
  const S = Math.min(cap, rng.int(K.map[0][0], K.map[0][1]));
  const W = S, H = S;
  const R = PRISON.RING, F = PRISON.FRONT, gap = K.gap;
  // The perimeter: the outer line (a wall at a penitentiary, a fence at a state prison), the inner fence gap cells in.
  const outer = { x0: R, y0: R, w: W - 2 * R, h: H - R - F };
  const inner = { x0: outer.x0 + gap, y0: outer.y0 + gap, w: outer.w - 2 * gap, h: outer.h - 2 * gap };
  const inside = { x0: inner.x0 + 3, y0: inner.y0 + 3, w: inner.w - 6, h: inner.h - 6 }; // where the buildings stand
  const legacy = !!o.legacy;
  const B = []; // { m, sp, name, key, x0, y0, flip?, role }
  // ---------- the housing units off the main corridor ----------
  const n = rng.int(K.units[0], K.units[1]);
  const rows = Math.ceil(n / 2);
  const units = [];
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? "right" : "left"; // left of the corridor: its picket on its right (toward the corridor)
    const dorm = kind === "state" && rng.chance(PRISON.DORM);
    const len = rng.int(56, 70); // a real block 40–70 m long: about 17–21 cells a tier
    const u = build(seed, `unit${i}`, (r) => housingUnit(r, { len, picket: side === "left" ? "right" : "left", unitId: i + 1, kind: dorm ? "dorm" : "cells", tiers: 2 }), "pblock", `Housing unit ${String.fromCharCode(65 + i)}`, legacy);
    u.role = "housing"; u.unitId = i + 1; u.side = side; u.row = Math.floor(i / 2); u.dorm = dorm;
    units.push(u);
  }
  // A penitentiary's death row at the far end, a cells block of single cells with a security door into each tier.
  if (kind === "max") {
    const u = build(seed, "deathrow", (r) => housingUnit(r, { len: r.int(30, 36), picket: "left", unitId: n + 1, kind: "cells", single: true, dk: "security", tiers: 2 }), "pblock", "Death row", legacy);
    u.role = "deathrow"; u.unitId = n + 1; u.side = "right"; u.row = rows; units.push(u);
  }
  const rowH = Math.max(...units.map((u) => u.m.building.h)) + 6;
  const spineLen = (rows + (kind === "max" ? 1 : 0)) * rowH + 4;
  const ctl = build(seed, "control", centralControl, "pcontrol", "Central control", legacy); ctl.role = "control";
  const sp = build(seed, "spine", spine(spineLen), "pcontrol", "Main corridor", legacy); sp.role = "spine";
  // Where the block of housing stands: against the north of the inside, the corridor down its middle.
  const maxLeft = Math.max(...units.filter((u) => u.side === "left").map((u) => u.m.building.w));
  const maxRight = Math.max(0, ...units.filter((u) => u.side === "right").map((u) => u.m.building.w));
  const blockW = maxLeft + PRISON.UNIT_GAP * 2 + 5 + maxRight;
  const bx = inside.x0 + Math.floor((inside.w - blockW) / 2) + rng.int(-8, 8);
  const sx = bx + maxLeft + PRISON.UNIT_GAP, sy = inside.y0 + 2;
  sp.x0 = sx; sp.y0 = sy;
  for (const u of units) {
    const bw = u.m.building.w;
    u.x0 = u.side === "left" ? sx - PRISON.UNIT_GAP - bw : sx + 5 + PRISON.UNIT_GAP;
    u.y0 = sy + 2 + u.row * rowH;
  }
  ctl.x0 = sx + 2 - Math.floor(ctl.m.building.w / 2); ctl.y0 = sy + spineLen + 5;
  B.push(sp, ctl, ...units);
  const housing = { x0: bx - 3, y0: sy - 3, w: blockW + 6, h: ctl.y0 + ctl.m.building.h - sy + 6 };
  // ---------- the yard and the other buildings inside ----------
  const taken = [housing];
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
  const yard = spot(rng.int(52, 64), rng.int(38, 44));
  const others = [
    ["chow", chowHall, "pchow", "Chow hall"], ["infirmary", prisonInfirmary, "pinfirmary", "Infirmary"], ["chapel", chapel, "pchapel", "Chapel"],
    ["education", education, "pschool", "Library and education"], ["industries", industries, "pworks", "Prison industries"],
    ["seg", (r) => housingUnit(r, { len: r.int(28, 34), picket: "left", unitId: 90, kind: "cells", single: true, tiers: 1 }), "pblock", "Segregation unit"],
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
  const southOuter = outer.y0 + outer.h - 1, southInner = inner.y0 + inner.h - 1;
  const gx = Math.floor(W / 2) + rng.int(-20, 20); // the sally port's lane (4 wide)
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
  const G = complexGrid(W, H, storeys, (x, y) => (inRect(inner, x, y) ? (yard && inRect(yard, x, y) ? "grass" : "gravel") : roadRing(x, y) ? "road" : "grass"));
  for (const b of B) {
    b.rec = stampBuilding(G, b.m, b.x0, b.y0, { name: b.name, extra: { role: b.role, ...(b.unitId ? { unitId: b.unitId } : {}) } });
  }
  // The secure corridors: each housing unit to the main corridor (sally-port doors), the main corridor to central control.
  const conns = [];
  for (const u of units) { const c = connectBuildings(G, sp.rec, u.rec, { width: 2, name: `Secure corridor to ${u.name.toLowerCase()}`, dk: "security", sally: true }); if (c) conns.push(c); }
  { const c = connectBuildings(G, sp.rec, ctl.rec, { width: 2, name: "Secure corridor to central control", dk: "security", sally: false }); if (c) conns.push(c); }
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
  for (const z of zones) for (let y = z.y0 - 1; y <= z.y0 + z.h; y++) for (let x = z.x0 - 1; x <= z.x0 + z.w; x++) if (x >= 0 && y >= 0 && x < W && y < H) G.keep[I(x, y)] = 1;
  const vehicle = teamVehicle(G, zones[0], withVehicle);
  // ---------- dressing: floodlights along the inner fence, crates and barrels by the buildings' back doors ----------
  const gd = guard(G, [zones[0].x0 + 1, zones[0].y0 + 1]);
  for (let i = 0; i < 24; i++) { const x = rng.int(inner.x0 + 2, inner.x0 + inner.w - 3), y = rng.pick([inner.y0 + 2, inner.y0 + inner.h - 3]); gd.block(x, y, "lamp"); }
  for (let i = 0; i < 30; i++) { const b = rng.pick(B); const x = b.x0 + rng.int(-3, b.m.building.w + 2), y = b.y0 + rng.pick([-3, b.m.building.h + 2]); gd.block(x, y, rng.pick(["crate", "barrel"])); }
  const map = finishComplex(G, option, {
    kind, zones, vehicle,
    extra: {
      prisonKind: kind, kindName: K.name, perimeter: { outer, inner, wire: wireLine, wall: kind === "max" }, towers, holes, sallyport, gate: { x: gx, w: 4, y: southOuter, house: gh.rec.k }, yard: yardArea ? yardArea.id : null,
      units: units.map((u) => ({ unitId: u.unitId, name: u.name, house: u.rec.k, dorm: !!u.dorm, role: u.role })), control: ctl.rec.k, spine: sp.rec.k, armory: ar.rec.k, conns: conns.map((c) => c.id),
    },
  });
  finishPrison(map, rng, units, B, kind);
  map.busAt = busAt;
  map.deadScale = PRISON.DEAD[kind];
  return map;
}
// The team's vehicle in the entry zone (laid last: the complex is the same with or without it), as streetMap's.
function teamVehicle(G, z, withVehicle) {
  if (!withVehicle) return null;
  z.vehicle = true;
  const W = G.W, H = G.H, cells = G.cells;
  const v = placeVehicle(cells, W, H, z, withVehicle, (x, y) => x >= 0 && y >= 0 && x < W && y < H && cells[y * W + x].k === "open");
  if (!v) { const c = cells[(z.y0 + 1) * W + z.x0 + 1]; c.k = "vehicle"; c.f = "road"; }
  return v;
}

// A county jail: the jail building and two pods north of it, a fenced pen off a pod, the street in front.
function jailMap(rng, seed, option, withVehicle, o) {
  const K = PRISON.KINDS.jail;
  const W = rng.int(K.map[0][0], K.map[0][1]), H = rng.int(K.map[1][0], K.map[1][1]);
  const legacy = !!o.legacy;
  const main = build(seed, "jail", jailMain, "jailmain", "County jail", legacy); main.role = "jail";
  const mw = main.m.building.w, mh = main.m.building.h;
  main.x0 = Math.floor((W - mw) / 2) + rng.int(-6, 6); main.y0 = H - 18 - mh;
  const units = [];
  const left = rng.chance(0.5);
  for (let i = 0; i < 2; i++) {
    const len = rng.int(26, 32);
    const u = build(seed, `pod${i}`, (r) => housingUnit(r, { len, picket: i === 0 ? "right" : "left", unitId: i + 1, kind: "cells", tiers: 2, yard: i === (left ? 0 : 1) }), "pblock", `Pod ${String.fromCharCode(65 + i)}`, legacy);
    u.role = "housing"; u.unitId = i + 1; units.push(u);
  }
  // The pods side by side north of the jail, joined to it (an L or a T of buildings: one over the middle, one over an end).
  const pw0 = units[0].m.building.w, pw1 = units[1].m.building.w, ph = Math.max(...units.map((u) => u.m.building.h));
  const gapX = 8;
  const span = pw0 + gapX + pw1;
  const startX = rng.chance(0.5) ? main.x0 + Math.floor((mw - span) / 2) : main.x0 + 2;
  units[0].x0 = startX; units[1].x0 = startX + pw0 + gapX;
  for (const u of units) u.y0 = main.y0 - 7 - u.m.building.h;
  const B = [main, ...units];
  const storeys = Math.max(...B.map((b) => b.m.storeys || 1));
  const street = { y0: H - 10, h: 6 };
  const G = complexGrid(W, H, storeys, (x, y) => (y >= street.y0 && y < street.y0 + street.h ? "road" : y === street.y0 - 1 || y === street.y0 + street.h ? "gravel" : "grass"));
  for (const b of B) b.rec = stampBuilding(G, b.m, b.x0, b.y0, { name: b.name, extra: { role: b.role, ...(b.unitId ? { unitId: b.unitId } : {}) } });
  const conns = [];
  for (const u of units) { const c = connectBuildings(G, main.rec, u.rec, { width: 2, name: `Secure corridor to ${u.name.toLowerCase()}`, dk: "security", sally: true }); if (c) conns.push(c); }
  const I = (x, y) => y * W + x, cells = G.cells;
  // The pen: a fenced yard off the pod with the yard door.
  const yu = units.find((u) => u.sp.exits.length);
  let pen = null;
  if (yu) {
    const ex = yu.rec.exits.find((e) => e.cells.length);
    const B0 = yu.rec, pwid = 16, phgt = Math.min(14, B0.h);
    const east = ex && ex.cells[0][0] >= B0.x0 + B0.w - 1;
    const x0 = east ? B0.x0 + B0.w : B0.x0 - pwid, y0 = B0.y0 + Math.floor((B0.h - phgt) / 2);
    pen = { x0, y0, w: pwid, h: phgt };
    for (let y = y0; y < y0 + phgt; y++) for (let x = x0; x < x0 + pwid; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H || G.owner[I(x, y)] >= 0) continue;
      const edge = y === y0 || y === y0 + phgt - 1 || (east ? x === x0 + pwid - 1 : x === x0);
      const c = cells[I(x, y)];
      if (edge) { c.k = "pfence"; } else c.f = "conc";
      G.keep[I(x, y)] = 1;
    }
    // A sure way into the pen from the pod: the yard door, else one put in the wall.
    const wallX = east ? B0.x0 + B0.w - 1 : B0.x0;
    if (!G.floors[0].cells.some((c, i) => (i % W) === wallX && ((i / W) | 0) > y0 && ((i / W) | 0) < y0 + phgt - 1 && (c.k === "idoor" || c.k === "odoor" || c.k === "door"))) {
      for (let y = y0 + 1; y < y0 + phgt - 1; y++) { const c = cells[I(wallX, y)], inn = cells[I(wallX + (east ? -1 : 1), y)]; if ((c.k === "wall" || c.k === "window") && inn.f === "floor" && inn.k === "open") { Object.assign(c, { k: "idoor", dk: "steel", hp: DOOR_KINDS.steel.hp, mhp: DOOR_KINDS.steel.hp }); delete c.win; break; } }
    }
    G.areas.push({ id: G.areas.length, type: null, role: "yard", name: "Exercise pen", outdoor: true, f: 0, ...pen, doors: [] });
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
  const gd = guard(G, [zones[0].x0 + 1, zones[0].y0 + 1]);
  for (let i = 0; i < 10; i++) gd.block(rng.int(1, W - 2), rng.int(1, street.y0 - 3), "tree");
  const vehicle = teamVehicle(G, zones[0], withVehicle);
  const map = finishComplex(G, option, { kind: "jail", zones, vehicle, extra: { prisonKind: "jail", kindName: K.name, units: units.map((u) => ({ unitId: u.unitId, name: u.name, house: u.rec.k, dorm: false, role: u.role })), control: main.rec.k, pen, conns: conns.map((c) => c.id), towers: [], holes: [] } });
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
// The dressed areas a raid's dead and people favour, by name (wanderers.js, floorfolk.js): the holders' unit.
export const holdRoom = (plan) => (plan && plan.rooms ? plan.rooms.find((r) => r.prison === "dayroom" && !(r.f > 0)) || plan.rooms.find((r) => r.prison === "dorm") : null);
