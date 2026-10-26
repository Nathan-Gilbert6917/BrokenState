// @ts-check
// A dozen layout variants per civic and medical building type (issue #36 of the interiors epic #7, the user's
// requests 2026-10-25: "every building should have several varients"; "for buildings with no to only a few varients
// create a dozen varients per building type"). The hospital, the infirmary, the clinic, the vet, the church, the police
// station and the fire station each have 12 plans of their own here (VARIANTS): a plan differs from the others in at
// least two of its room list, the rooms' order, its entrances, corridor or open plan, its size and its storeys, never
// only its colours. Every plan keeps its kind's signature rooms (#14's and #15's): a hospital's emergency room and
// wards and its locked pharmacy, a clinic's or an infirmary's exam rooms and drug cupboard, a vet's kennels, a church's
// nave and its altar, a police station's front desk, squad room, chief's office, armory, evidence room, cells and a
// police car in its sally port, a fire station's engine bay behind its bay door, its dorm and its kitchen.
//
// Which plan a building gets (pickVariant): its own dice (one draw, first), weighted by the setting (o.setting: city,
// suburb, town, rural: buildingmaps.js siteSetting) and the site (o.site: an infirmary at a prison is one of the
// prison plans), among the plans its franchise maps to (o.variant: data-shops.js FRANCHISES; a plan's fr). o.plan
// (a building option's plan, buildingmaps.js makeSpec) pins a plan by its id (the tests, the renders, another ticket's
// building that wants one: #25's airport crash station, #28's campus health centre, #31's county jail). An older save
// (o.legacy) never comes here: buildingmaps.js keeps its old plans (worldcfg.js legacyRooms).
//
// The plans are buildingmaps.js archetype specs (the plan trees of rooms, split front to back and side to side; the
// exits; the storeys and the plan of each floor up); each spec carries vid and vname (#37's names: assemble puts them on
// the map's plan as vid and variant, the raid's opening lines name it). Each kind's plan before this ticket (#14's or
// #15's) is its "general" plan and goes through #24's real-size step as before (buildingmaps.js realScale); the others
// are drawn at their own sizes, their SIZE rows (metres: a cell is data-buildingsize.js CELL_M, 1 m), which realScale
// leaves as they are (a vid other than "general"), the floors past the tall rule's not built. The rooms are furnished
// by their kind's styles as before: roomlayout.js MEDICAL_STYLES by role in the medical kinds (a room with a civic mark
// keeps the civic style), civiclayout.js CIVIC_STYLES by the leaf's civic mark.
//
// VARIANT_KINDS: the kinds with their plans here (each list's first, "general", the plan before this ticket).
// variantNames(kind): [{ id, name }] for the docs and the tests.

import { registerVariants, pickVariant as pickRegistered } from "./variantpick.js"; // the shared picker (issue #41)
import { REAL_SIZE } from "./data-buildingsize.js"; // the plans' sizes (#24's table: its "<kind>.<plan id>" rows; #49's sizes rows, CIVIC_REAL)
import { PLACEMENT } from "./data-placement.js"; // #42's placement table: the size class a kind's plan takes on a tile class (issue #49)

/** @typedef {{ city?: number, suburb?: number, town?: number, rural?: number, [site: string]: number | undefined }} Weights */
/** @typedef {{ w: [number, number], h: [number, number], storeys: [number, number] }} Size */
/** @typedef {{ id: string, name: string, w: Weights, fr?: string[], fresh?: boolean, make: (rng: any, o: any, K: any) => any }} Variant */

// ---------- the plan trees ----------
/** @param {any[]} list */
const lv = (list) => list.map(([s, r]) => [s, typeof r === "string" ? { role: r } : r]);
/** Side by side, left to right. @param {...any} parts */
const X = (...parts) => ({ split: "x", parts: lv(parts) });
/** Front (the street side) to back. @param {...any} parts */
const Y = (...parts) => ({ split: "y", parts: lv(parts) });
/** A band of rooms at the front, a corridor, a band at the back (buildingmaps.js corridorPlan). @param {any[]} front @param {any[]} back @param {number} fd @param {number} [cw] @param {any} [hall] */
const cor = (front, back, fd, cw = 1, hall = null) => ({ split: "y", parts: [[fd, X(...front)], [cw, { role: "corridor", ...(hall || {}) }], ["*", X(...back)]] });
const ENDS = { roles: ["corridor"], n: 2, len: 3, ends: true }; // a hospital's: one at each end of the corridor (buildingmaps.js ENDS)
const ENDS2 = { roles: ["corridor"], n: 2, ends: true };      // the same for the others (a run of 2 steps)
const fire = (lock = 0.4, chance = 0.6) => [{ side: "left", roles: ["corridor"], chance, lock }, { side: "right", roles: ["corridor"], chance, lock }];
/** @param {any} rng @param {Size} s */
const dims = (rng, s) => ({ bw: rng.int(s.w[0], s.w[1]), bh: rng.int(s.h[0], s.h[1]), storeys: rng.int(s.storeys[0], s.storeys[1]) });
const W = (city = 0, suburb = 0, town = 0, rural = 0, more = {}) => ({ city, suburb, town, rural, ...more });

// ---------- the rooms each kind keeps ----------
// Medical (roomlayout.js MEDICAL_STYLES by role).
const er = (o = {}) => ({ role: "er", bays: 4, ...o }); // at most 4 bays: room for the triage desk (roomlayout.js MEDICAL_STYLES er)
const ward = (o = {}) => ({ role: "ward", ...o });
const pharm = (o = {}) => ({ role: "pharmroom", lock: ["vault", 1], boxLock: ["drugs", 0.3], ...o }); // a hospital's: behind its steel security door, always locked (#14)
const cupboard = (o = {}) => ({ role: "pharmroom", name: "Drug cupboard", lock: ["door", 0.6], boxLock: ["drugs", 0.5], ...o }); // a clinic's or an infirmary's
const waiting = (o = {}) => ({ role: "lobby", entry: true, name: "Waiting room", type: "clinic", ...o });
const exam = (o = {}) => ({ role: "exam", ...o });
const supply = (lock = 0) => ({ role: "storage", name: "Supply room", type: "clinic", ...(lock ? { lock: ["door", lock] } : {}) });
const docs = (name = "Doctors' office") => ({ role: "office", name, type: "office" });
const kitchenette = { role: "staffroom", name: "Kitchenette" };
const ex3 = (o = {}) => exam({ boxTarget: 3, ...o }); // a busier room: a cabinet more (the meds by area as the old plan's, tools/variantcivictest.js)
// The vet's (#14: the kennels pens of bars, sometimes locked: dead pets shut in, deadbeasts.js).
const kennels = (o = {}) => ({ role: "cells", name: "Kennels", type: "vet", kennel: true, lock: ["door", 0.35], ...o });
const vexam = (o = {}) => ({ role: "exam", name: "Exam room", type: "vet", ...o });
const vsurgery = (o = {}) => ({ role: "theatre", name: "Surgery", type: "vet", lock: ["door", 0.3], ...o });
const vdrugs = (o = {}) => ({ role: "pharmroom", name: "Drug room", type: "vet", lock: ["door", 0.5], boxLock: ["drugs", 0.4], ...o });
const vx = (o = {}) => vexam({ boxTarget: 3, ...o }); // a busier practice's: a cabinet more (the meds by area as the old vet's, tools/variantcivictest.js)
const vd = (o = {}) => vdrugs({ boxTarget: 3, ...o });
const vfood = (o = {}) => ({ role: "storage", name: "Food store", type: "vet", food: true, ...o });
const vwait = (o = {}) => ({ role: "lobby", entry: true, name: "Waiting room", type: "vet", ...o });
const stalls = (o = {}) => ({ role: "barnfloor", name: "Large-animal stalls", type: "vet", hub: false, ...o }); // a barn's floor (buildingmaps.js FURNISH barn: stalls of hay and fences); a vet's room since issue #43 (a barn's were its hunting rifles)

// Police (civiclayout.js CIVIC_STYLES by the civic mark, #15).
const desk = (o = {}) => ({ role: "lobby", entry: true, name: "Front desk", type: "office", civic: "frontdesk", ...o });
const squad = (o = {}) => ({ role: "office", name: "Squad room", civic: "squad", ...o });
const chief = (o = {}) => ({ role: "office", name: "Chief's office", gunSafe: ["gunsafe2", 0.3], civic: "chief", ...o });
const armory = (o = {}) => ({ role: "armory", lock: ["vault", 0.85], boxLock: ["cage", 0.5], gunSafe: ["gunsafe3", 0.3], civic: "armory", dk: "steel", boxTarget: 3, ...o });
const evidence = (o = {}) => ({ role: "evidence", lock: ["door", 0.7], boxLock: ["evidence", 0.6], civic: "evidence", dk: "cell", ...o });
const cells = (o = {}) => ({ role: "cells", civic: "cells", ...o });
const sally = (o = {}) => ({ role: "bays", name: "Sally port", type: "garage", maxBoxes: 3, civic: "sallyport", ...o });
const plockers = (o = {}) => ({ role: "lockerroom", type: "barracks", civic: "plockers", ...o });
const records = (o = {}) => ({ role: "office", name: "Records", boxLock: ["evidence", 0.3], civic: "records", ...o });
const pbreak = (o = {}) => ({ role: "breakroom", civic: "breakroom", ...o });
const wash = (o = {}) => ({ role: "restroom", civic: "washroom", ...o });
const dispatch = (o = {}) => ({ role: "office", name: "Dispatch", civic: "dispatch", ...o });
const briefing = (o = {}) => ({ role: "office", name: "Briefing room", civic: "briefing", ...o });
const interview = (w = 6) => [w, X(["*", { role: "office", name: "Interview room", civic: "interview" }], [2, { role: "office", name: "Observation", civic: "observation" }])];
const sallyExit = (side, o = {}) => ({ side, roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Sally port", ...o });
// Fire (#15).
const bay = (o = {}) => ({ role: "bays", name: "Engine bay", type: "enginebay", maxBoxes: 5, civic: "enginebay", ...o });
const fday = (o = {}) => ({ role: "dayroom", civic: "fdayroom", ...o });
const fkitchen = (o = {}) => ({ role: "kitchen", civic: "fkitchen", ...o });
const fdorm = (o = {}) => ({ role: "dorm", type: "barracks", civic: "fdorm", ...o });
const medstore = (o = {}) => ({ role: "storage", name: "Medical store", type: "nurse", lock: ["door", 0.3], civic: "medstore", ...o });
const fshop = (o = {}) => ({ role: "workshop", civic: "fworkshop", ...o });
const fgym = (o = {}) => ({ role: "gym", civic: "fgym", ...o });
const watch = (o = {}) => ({ role: "office", name: "Watch office", civic: "watch", ...o });
const fbath = (o = {}) => ({ role: "bath", civic: "washroom", ...o });
const bayDoor = (side = "front", o = {}) => ({ side, roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.1, name: "Bay door", ...o });
// Church (#15).
const narthex = (o = {}) => ({ role: "foyer", name: "Narthex", entry: true, type: "chapel", civic: "narthex", ...o });
const nave = (o = {}) => ({ role: "nave", civic: "nave", ...o });
const vestry = (o = {}) => ({ role: "vestry", boxLock: ["lockbox", 0.4], civic: "vestry", ...o });
const hall = (o = {}) => ({ role: "kitchen", name: "Parish hall", civic: "parishhall", ...o });
const cpantry = (o = {}) => ({ role: "pantry", name: "Food bank pantry", type: "kitchen", civic: "cpantry", ...o });
const tower = (o = {}) => ({ role: "storage", name: "Bell tower", type: "chapel", civic: "belltower", ...o }); // raised: the loft mechanic, a ladder up (spec.loft on the storage role: no other storage room in a church with one)
const sunday = (o = {}) => ({ role: "classroom", name: "Sunday school", civic: "classroom", ...o });
const BELFRY = { roles: ["storage"], chance: 1, ladder: true };

// ---------- the sizes (cells, outer walls included) and storeys of each plan ----------
// One row a plan, in metres (a cell is 1 m: data-buildingsize.js CELL_M), read from #24's table (REAL_SIZE, planned rows
// as #29's hotels and #33's restaurants): realScale leaves a named plan at its size. The plans were drawn to a building
// of at most 36 × 25 cells
// (tools/interiortest.js: the map with its margins at most 44 × 34) and its footprint class (spec.foot,
// tools/storeytest.js: small ≤ 190 cells, medium 90–360, large ≥ 290, wide ≥ 280 and 20 wide, a tower ≤ 330 and 22 wide).
/** @type {Record<string, Size>} */
export const SIZE = Object.fromEntries(Object.entries(REAL_SIZE).filter(([k]) => /^[a-z]+\./.test(k)).map(([k, R]) => [k, { w: R.w, h: R.d, storeys: R.storeys }])); // #24's table holds them (data-buildingsize.js REAL_SIZE "<kind>.<plan id>" rows, metres at CELL_M 1 m)
// A world made since issue #49 (o.civicReal, worldcfg.js legacyCivic): the plan being made (variantSpec sets it, the
// plan's make reads it through sized) draws its storeys from its kind's sizes row (data-buildingsize.js CIVIC_REAL: a
// city's where it has them), so its floors' plans are its own; buildingmaps.js realScale lays it out at that row's
// footprint (spec.realSize, spec.vscale). Null otherwise: the drawn row's storeys, as before.
/** @type {{ setting: string } | null} */
let REAL = null;
/** @param {any} rng @param {string} key */
const sized = (rng, key) => {
  const S = SIZE[key];
  if (!REAL) return dims(rng, S);
  const [kind, id] = key.split("."), R = REAL_SIZE[kind] && REAL_SIZE[kind].sizes ? REAL_SIZE[kind].sizes[id] : null;
  const st = R ? (REAL.setting === "city" && R.city ? R.city : R.storeys) : null;
  return dims(rng, st ? { ...S, storeys: st } : S);
};
// A shape's parts (buildingmaps.js shapeOf, issue #23: its own copy, this module is buildingmaps.js's import).
/** @param {string} kind @param {any[]} parts */
const shapeOf = (kind, parts) => {
  const x0 = Math.min(...parts.map((p) => p.x)), y0 = Math.min(...parts.map((p) => p.y));
  for (const p of parts) { p.x -= x0; p.y -= y0; }
  return { bw: Math.max(...parts.map((p) => p.x + p.w)), bh: Math.max(...parts.map((p) => p.y + p.h)), shape: { kind, parts } };
};

// ======================================================================================
// The plans
// ======================================================================================
/** @type {Record<string, Variant[]>} */
export const VARIANTS = {
  // ---------- hospitals: the ER, wards and the locked pharmacy in every plan; 2-wide corridors ----------
  hospital: [
    { id: "general", name: "General hospital", w: W(1, 1, 0.6, 0.15), make: (rng, o, K) => K.classic() }, // #14's plan
    { id: "critical", name: "Critical-access hospital", w: W(0, 0.2, 0.8, 1), make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "hospital.critical");
      return {
        bw, bh, front: { width: 2 }, ground: "rural", storeys: n, foot: "large", stairs: ENDS,
        program: cor([["*", er()], [5, waiting()], [4, pharm()]],
          n > 1 ? [["*", ward()], [7, { role: "ambbay" }], [4, "kitchen"], [3, { role: "morgue", lock: ["door", 0.3] }]] : [["*", ward()], [7, { role: "ambbay" }], [4, "kitchen"], ["*", ward()]], 5, 2),
        upper: n > 1 ? () => cor([["*", ward()], [4, "nursestation"], [5, { role: "theatre", lock: ["door", 0.3] }]], [["*", ward()], [4, docs()], [2, "restroom"]], 5, 2) : null,
        exits: [{ side: "back", roles: ["ambbay"], chance: 1, lock: 0.2, roller: true, width: 2, name: "Ambulance bay" }, ...fire(0.3, 0.5)],
      };
    } },
    { id: "tower", name: "Regional medical tower", w: W(1, 0.3, 0, 0), make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "hospital.tower");
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: ENDS,
        program: cor([["*", er()], [5, waiting()], [4, pharm()]], [[6, { role: "ambbay" }], ["*", "cafeteria"], [4, "kitchen"], [2, "restroom"]], 5, 2),
        upper: (f, r, ctx) => (f === 1 ? cor([["*", ward()], [4, "nursestation"], [5, { role: "theatre", lock: ["door", 0.3] }]], [["*", "icu"], ["*", ward()], [4, supply(0.3)], [2, "restroom"]], 5, 2)
          : ctx && ctx.top ? cor([["*", { role: "gym", name: "Rehab gym", civic: "fgym" }], [4, "nursestation"], ["*", ward()]], [["*", ward()], [4, "staffroom"], [4, "laundry"], [2, "restroom"]], 5, 2)
            : cor([["*", ward()], [4, "nursestation"], ["*", ward()]], [["*", ward()], [4, docs()], ["*", ward()], [2, "restroom"]], 5, 2)),
        exits: [{ side: "back", roles: ["ambbay"], chance: 1, lock: 0.25, roller: true, width: 2, name: "Ambulance bay" }, ...fire(0.3, 0.85)],
      };
    } },
    { id: "children", name: "Children's hospital", w: W(0.8, 0.6, 0.1, 0), make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "hospital.children");
      const cw = (name, o = {}) => ward({ name, ...o });
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: ENDS,
        program: cor([["*", er({ name: "Children's emergency" })], [6, waiting({ name: "Family waiting room" })], [4, pharm()], [3, "restroom"]], [[6, { role: "ambbay" }], ["*", "cafeteria"], [4, "kitchen"], [5, { role: "dayroom", name: "Playroom", civic: "fdayroom", hub: false }]], 5, 2),
        upper: (f, r, ctx) => (f === 1 ? cor([["*", cw("Children's ward")], [5, "nursestation"], [6, { role: "theatre", lock: ["door", 0.3] }]], [["*", { role: "icu", name: "Paediatric ICU" }], ["*", cw("Children's ward")], [4, docs()], [3, "restroom"]], 5, 2)
          : ctx && ctx.top ? cor([["*", cw("Neonatal unit", { cots: true })], [5, "nursestation"], ["*", cw("Maternity ward", { cots: true })]], [["*", cw("Children's ward")], [5, "staffroom"], [4, "laundry"], [3, "restroom"]], 5, 2)
            : cor([["*", cw("Children's ward")], [5, "nursestation"], [6, { role: "classroom", name: "Hospital school", civic: "classroom" }]], [["*", cw("Children's ward")], ["*", cw("Children's ward")], [4, supply()], [3, "restroom"]], 5, 2)),
        exits: [{ side: "back", roles: ["ambbay"], chance: 1, lock: 0.25, roller: true, width: 2, name: "Ambulance bay" }, ...fire(0.3, 0.8)],
      };
    } },
    { id: "psych", name: "Psychiatric hospital", w: W(0.3, 0.4, 0.6, 0.5), make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "hospital.psych");
      const secure = { lock: ["door", 0.4], name: "Secure ward" };
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: n, foot: "large", stairs: ENDS, openDoors: 0.15,
        program: cor([["*", er({ name: "Intake" })], [6, waiting({ name: "Admissions" })], [4, pharm()]], [["*", { role: "dayroom", name: "Day room", civic: "fdayroom", hub: false }], ["*", { role: "cafeteria", name: "Dining hall" }], [4, "kitchen"], [5, { role: "cells", name: "Seclusion rooms", type: "clinic", lock: ["door", 0.5] }]], 5, 2),
        upper: () => cor([["*", ward(secure)], [5, "nursestation"], ["*", ward(secure)]], [["*", { role: "workshop", name: "Art therapy", type: "office", civic: "shopclass" }], [5, { role: "classroom", name: "Group therapy", civic: "briefing" }], [4, docs("Psychiatrist's office")], [3, "restroom"]], 5, 2),
        exits: [{ side: "back", roles: ["kitchen", "cafeteria"], chance: 0.8, lock: 0.6 }, ...fire(0.7, 0.6)],
      };
    } },
    { id: "va", name: "Veterans' hospital", w: W(0.6, 0.5, 0.3, 0.1), make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "hospital.va");
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: ENDS,
        program: cor([["*", er()], [6, waiting({ name: "Veterans' lobby" })], [4, pharm()], [3, "restroom"]],
          [[6, { role: "ambbay" }], ["*", { role: "gym", name: "Physical therapy", civic: "fgym" }], ["*", "cafeteria"], [4, "kitchen"]], 5, 2),
        upper: (f, r, ctx) => (f === 1 ? cor([["*", ward()], [5, "nursestation"], [6, { role: "theatre", lock: ["door", 0.3] }], [4, supply(0.3)]], [["*", "icu"], ["*", ward()], [4, docs()], [5, { role: "workshop", name: "Prosthetics workshop", civic: "fworkshop" }], [3, "restroom"]], 5, 2)
          : ctx && ctx.top ? cor([["*", ward({ name: "Long-term care" })], [5, "nursestation"], ["*", { role: "dayroom", name: "Veterans' lounge", civic: "fdayroom", hub: false }]], [["*", ward()], [5, "staffroom"], [4, "laundry"], [5, { role: "office", name: "Benefits office", type: "office" }], [3, "restroom"]], 5, 2)
            : cor([["*", ward()], [5, "nursestation"], ["*", ward()]], [["*", ward()], ["*", ward()], [4, docs()], [3, "restroom"]], 5, 2)),
        exits: [{ side: "back", roles: ["ambbay"], chance: 1, lock: 0.25, roller: true, width: 2, name: "Ambulance bay" }, ...fire(0.3, 0.85)],
      };
    } },
    { id: "trauma", name: "Trauma centre", w: W(0.7, 0.2, 0, 0), make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "hospital.trauma");
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: ENDS,
        program: cor([["*", er({ name: "Trauma bays", bays: 6 })], [6, waiting({ name: "Emergency waiting" })], [4, pharm()], [4, { role: "bath", name: "Decontamination", type: null, civic: "washroom" }]],
          [[5, { role: "ambbay" }], [5, { role: "ambbay" }], [4, { role: "storage", name: "Blood bank", type: "clinic", lock: ["door", 0.4] }], [4, exam({ name: "Radiology" })], ["*", { role: "morgue", lock: ["door", 0.3] }]], 6, 2),
        upper: (f, r, ctx) => (f === 1 ? cor([["*", { role: "theatre", name: "Trauma theatre", lock: ["door", 0.3] }], [5, "nursestation"], ["*", { role: "theatre", lock: ["door", 0.3] }], [4, supply(0.3)]], [["*", { role: "icu", name: "Trauma ICU" }], ["*", { role: "icu", name: "Surgical ICU" }], ["*", ward()], [3, "restroom"]], 6, 2)
          : ctx && ctx.top ? cor([["*", ward({ name: "Burns unit" })], [5, "nursestation"], ["*", ward()]], [["*", ward()], [5, "staffroom"], [4, "laundry"], [4, docs()], [3, "restroom"]], 6, 2)
            : cor([["*", ward()], [5, "nursestation"], ["*", ward()]], [["*", ward()], ["*", ward()], [4, docs()], [3, "restroom"]], 6, 2)),
        exits: [{ side: "back", roles: ["ambbay"], chance: 1, lock: 0.2, roller: true, width: 2, name: "Ambulance bay" }, { side: "back", roles: ["ambbay"], chance: 1, lock: 0.2, roller: true, width: 2, name: "Second ambulance bay" }, ...fire(0.3, 0.85)],
      };
    } },
    { id: "pavilion", name: "Pavilion-plan hospital", w: W(0.2, 0.3, 0.5, 0.4), make: (rng) => {
      // The old pavilion plan: long open wards either side of a spine (the entrance hall and a corridor running back).
      const { bw, bh, storeys: n } = sized(rng, "hospital.pavilion");
      const spine = (front) => [4, Y([5, front], ["*", { role: "corridor" }])];
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "wide", stairs: { roles: ["corridor"], n: 1, len: 3 },
        program: X(["*", Y(["*", ward()], [6, { role: "ambbay" }])], ["*", Y(["*", er()], ["*", ward()])], spine({ role: "lobby", entry: true, name: "Entrance hall", type: "clinic" }), ["*", Y([5, pharm()], ["*", ward()])], ["*", Y([5, "kitchen"], ["*", "cafeteria"])]),
        upper: n > 1 ? () => X(["*", Y(["*", ward()], ["*", ward()])], ["*", Y([5, "nursestation"], ["*", ward()])], spine({ role: "hall", name: "Landing" }), ["*", Y([5, { role: "theatre", lock: ["door", 0.3] }], ["*", ward()])], ["*", Y([5, "staffroom"], ["*", ward()])]) : null,
        exits: [{ side: "back", roles: ["ambbay"], chance: 1, lock: 0.3, roller: true, width: 2, name: "Ambulance bay" }, { side: "back", roles: ["corridor"], chance: 0.7, lock: 0.3 }, { side: "left", roles: ["ward"], chance: 0.5, lock: 0.4 }, { side: "right", roles: ["cafeteria", "ward"], chance: 0.5, lock: 0.4 }],
      };
    } },
    { id: "teaching", name: "University teaching hospital", w: W(0.8, 0.3, 0, 0), make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "hospital.teaching");
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: ENDS,
        program: cor([["*", er()], [6, waiting({ name: "Main lobby" })], [4, pharm()], [3, "restroom"]],
          [[6, { role: "ambbay" }], [4, { role: "morgue", lock: ["door", 0.3] }], ["*", "cafeteria"], [4, "kitchen"]], 6, 2),
        upper: (f, r, ctx) => (f === 1 ? cor([["*", ward()], [5, "nursestation"], [6, { role: "theatre", lock: ["door", 0.3] }], [4, supply(0.3)]], [["*", "icu"], ["*", ward()], [4, docs()], [6, { role: "classroom", name: "Lecture theatre", civic: "briefing" }], [3, "restroom"]], 6, 2)
          : ctx && ctx.top ? cor([["*", ward({ name: "Maternity ward", cots: true })], [5, "nursestation"], ["*", ward()]], [["*", ward()], [5, "staffroom"], [4, "laundry"], [4, docs()], [3, "restroom"]], 6, 2)
            : cor([["*", ward()], [5, "nursestation"], [6, { role: "classroom", name: "Seminar room", civic: "classroom" }]], [["*", ward()], [5, { role: "lab", name: "Research lab", civic: "sciencelab" }], [4, docs()], [5, { role: "stock", name: "Medical library", type: "office", civic: "library", fl: "carpet" }], [3, "restroom"]], 6, 2)),
        exits: [{ side: "back", roles: ["ambbay"], chance: 1, lock: 0.25, roller: true, width: 2, name: "Ambulance bay" }, ...fire(0.3, 0.85)],
      };
    } },
    { id: "cottage", name: "Cottage hospital", w: W(0, 0.2, 0.8, 0.6), make: (rng) => {
      // A small town's: no corridor, the rooms round the front hall.
      const { bw, bh } = sized(rng, "hospital.cottage");
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: 1, foot: "medium",
        program: Y(["*", X(["*", er()], [6, waiting({ name: "Front hall" })], [4, pharm()])], ["*", X(["*", ward()], [4, docs("Doctor's office")], [4, "kitchen"], ["*", ward()])]),
        exits: [{ side: "back", roles: ["kitchen", "ward"], chance: 0.8, lock: 0.3 }, { side: "left", roles: ["er", "ward"], chance: 0.4, lock: 0.4 }],
      };
    } },
    { id: "surgical", name: "Surgical hospital", w: W(0.5, 1, 0.2, 0), make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "hospital.surgical");
      return {
        bw, bh, front: { width: 2 }, ground: "lot", storeys: n, foot: "medium", stairs: ENDS,
        program: cor([["*", er({ name: "Urgent care" })], [5, waiting()], [4, pharm()]], [["*", { role: "theatre", lock: ["door", 0.3] }], ["*", { role: "theatre", lock: ["door", 0.3] }], [5, { role: "icu", name: "Recovery" }], [4, { role: "storage", name: "Sterile store", type: "clinic" }]], 5, 2),
        upper: () => cor([["*", ward({ name: "Pre-op" })], [4, "nursestation"], ["*", ward()]], [["*", ward()], [4, docs("Surgeons' office")], [3, "staffroom"], [2, "restroom"]], 5, 2),
        exits: [{ side: "back", roles: ["storage", "theatre"], chance: 0.7, lock: 0.4 }, ...fire(0.4, 0.6)],
      };
    } },
    { id: "nursing", name: "Community hospital and nursing home", w: W(0.1, 0.5, 0.6, 0.3), make: (rng) => {
      const { bw, bh } = sized(rng, "hospital.nursing");
      const ltc = (o = {}) => ward({ name: "Long-term care", ...o });
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: 2, foot: "wide", stairs: ENDS,
        program: cor([[9, er()], [6, waiting({ name: "Reception" })], [4, pharm()], ["*", { role: "dayroom", name: "Residents' lounge", civic: "fdayroom", hub: false }]],
          [["*", ward()], [7, { role: "ambbay" }], [4, "kitchen"], [7, { role: "cafeteria", name: "Residents' dining room" }], ["*", ltc()], [3, "restroom"]], 5, 2),
        upper: () => cor([["*", ltc()], [5, "nursestation"], ["*", ltc({ name: "Memory care", lock: ["door", 0.3] })], [4, "staffroom"]], [["*", ltc()], ["*", ward()], [4, docs()], [4, "laundry"], [3, "restroom"]], 5, 2),
        exits: [{ side: "back", roles: ["ambbay"], chance: 1, lock: 0.3, roller: true, width: 2, name: "Ambulance bay" }, ...fire(0.3, 0.7)],
      };
    } },
    // ---------- issue #49 (new worlds only: fresh): the big hospitals at real scale ----------
    { id: "regional", name: "Regional medical centre", w: W(1, 0.2, 0, 0), fresh: true, make: (rng) => {
      // A U round a courtyard (#23's shapes): the bed tower along the front (the main lobby, the pharmacy, admissions,
      // radiology, the cafeteria, the kitchen and the morgue on the ground floor; theatres, ICUs and the ward floors
      // above), the emergency wing down one side (one storey: the ambulance bay at its far end, the ER, decontamination,
      // triage and the blood bank along its corridor) and the outpatients' wing down the other (clinics, then wards).
      // Laid out at its sizes row (data-buildingsize.js CIVIC_REAL: 130–160 × 84–100 m, 5–8 storeys, a city's 6–10).
      const { bw, bh, storeys: n } = sized(rng, "hospital.regional");
      const th = rng.int(18, 20), ew = rng.int(22, 24), ow = rng.int(20, 22), wh = bh - th + 1, erLeft = rng.chance(0.5);
      const tower = cor([[6, waiting({ name: "Main lobby" })], [5, pharm()], ["*", { role: "office", name: "Admissions", type: "office" }], [5, { role: "office", name: "Radiology", type: "clinic" }], [3, "restroom"]],
        [["*", "cafeteria"], [5, "kitchen"], [5, { role: "morgue", lock: ["door", 0.3] }], [5, supply(0.3)], [3, "restroom"]], 6, 2);
      const upper = (f, r, ctx) => (f === 1 ? cor([["*", ward()], [5, "nursestation"], [6, { role: "theatre", lock: ["door", 0.3] }], [6, { role: "theatre", name: "Operating theatre 2", lock: ["door", 0.3] }]], [["*", { role: "icu", name: "Surgical ICU" }], ["*", "icu"], [5, docs()], [3, "restroom"]], 6, 2)
        : ctx && ctx.top ? cor([["*", ward({ name: "Maternity ward", cots: true })], [5, "nursestation"], ["*", ward({ name: "Neonatal unit", cots: true })]], [["*", ward()], [5, "staffroom"], [5, "laundry"], [3, "restroom"]], 6, 2)
          : cor([["*", ward({ name: "Cardiac ward" })], [5, "nursestation"], ["*", ward({ name: "Oncology ward" })]], [["*", ward()], ["*", ward()], [5, docs()], [3, "restroom"]], 6, 2));
      const erWing = X(["*", Y([7, { role: "ambbay" }], ["*", er({ name: "Emergency department" })], [6, { role: "lobby", name: "Emergency waiting", type: "clinic" }])], [2, { role: "corridor", name: "Emergency corridor" }],
        [9, Y([6, { role: "bath", name: "Decontamination", type: null, civic: "washroom" }], ["*", { role: "office", name: "Triage", type: "clinic" }], [5, { role: "storage", name: "Blood bank", type: "clinic", lock: ["door", 0.4] }])]);
      const opd = (g) => X(["*", Y(...(g ? [["*", ward()], ["*", ward()]] : [["*", exam({ name: "Clinic room" })], ["*", exam({ name: "Clinic room" })], ["*", { role: "office", name: "Outpatients", type: "office" }]]))], [2, { role: "corridor", name: "Wing corridor" }],
        ["*", Y(...(g ? [["*", ward()], [5, "nursestation"]] : [["*", { role: "gym", name: "Physiotherapy", civic: "fgym" }], ["*", exam({ name: "Consulting room" })], [5, cupboard()]]))]);
      return {
        ...shapeOf("U", [
          { x: 0, y: wh - 1, w: bw, h: th, name: "Bed tower", main: true, program: tower, upper },
          { x: erLeft ? 0 : bw - ew, y: 0, w: ew, h: wh, storeys: 1, name: "Emergency wing", program: erWing },
          { x: erLeft ? bw - ow : 0, y: 0, w: ow, h: wh, storeys: Math.min(n, 3), name: "Outpatients' wing", wing: true, program: opd(0), upper: (g) => opd(g) },
        ]),
        front: { width: 2 }, ground: "city", storeys: n, foot: "large", program: null, upper: null, stairs: ENDS,
        exits: [{ side: "back", roles: ["ambbay"], chance: 1, lock: 0.2, roller: true, width: 2, name: "Ambulance bay" }, ...fire(0.3, 0.85), { side: "back", roles: ["corridor"], chance: 0.6, lock: 0.4 }],
      };
    } },
    { id: "county", name: "County hospital", w: W(0.2, 0.4, 0.9, 0.3), fresh: true, make: (rng) => {
      // A town's hospital: the ER at one end of the front, the reception, the pharmacy and the outpatients' clinic; the
      // ambulance bay, a ward, the kitchen and the morgue behind; the theatre, the ICU and the wards above, the
      // maternity ward on the floors past the first.
      const { bw, bh, storeys: n } = sized(rng, "hospital.county");
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "large", stairs: ENDS,
        program: cor([["*", er()], [6, waiting({ name: "Reception" })], [4, pharm()], ["*", exam({ name: "Outpatients' clinic" })]], [[7, { role: "ambbay" }], ["*", ward()], [4, "kitchen"], [4, { role: "morgue", lock: ["door", 0.3] }], [3, "restroom"]], 5, 2),
        upper: (f) => (f === 1 ? cor([["*", ward()], [4, "nursestation"], [6, { role: "theatre", lock: ["door", 0.3] }], [4, supply(0.3)]], [["*", "icu"], ["*", ward()], [4, docs()], [2, "restroom"]], 5, 2)
          : cor([["*", ward({ name: "Maternity ward", cots: true })], [4, "nursestation"], ["*", ward()]], [["*", ward()], [4, "staffroom"], [4, "laundry"], [2, "restroom"]], 5, 2)),
        exits: [{ side: "back", roles: ["ambbay"], chance: 1, lock: 0.25, roller: true, width: 2, name: "Ambulance bay" }, ...fire(0.3, 0.7)],
      };
    } },
    { id: "medcampus", name: "City medical centre", w: W(0.8, 0, 0, 0), fresh: true, make: (rng) => {
      // A downtown medical centre's campus (civicsite.js lays it out round this, its bed tower): a second tower, the
      // emergency department with its ambulances and the helipad, the parking garage and the clinic building. The bed
      // tower: the pharmacy, the main lobby, the urgent-care desk, the gift shop and the chapel low, the cafeteria and
      // imaging behind; the theatres and ICUs, the ward floors and the top floor's wards above.
      const { bw, bh, storeys: n } = sized(rng, "hospital.medcampus");
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: { ...ENDS, n: 2 }, civicSite: "medcampus",
        program: cor([[4, pharm()], ["*", waiting({ name: "Main lobby" })], [6, er({ name: "Urgent care" })], [5, { role: "office", name: "Gift shop", type: "store" }], [5, { role: "nave", name: "Hospital chapel", civic: "nave", maxBoxes: 1 }]],
          [["*", "cafeteria"], [5, "kitchen"], [5, { role: "office", name: "Imaging", type: "clinic" }], [4, "staffroom"], [3, "restroom"]], 6, 2),
        upper: (f, r, ctx) => (f === 1 ? cor([[6, { role: "theatre", lock: ["door", 0.3] }], [5, "nursestation"], ["*", { role: "icu", name: "Cardiac ICU" }], [6, { role: "theatre", name: "Operating theatre 2", lock: ["door", 0.3] }]], [["*", "icu"], [5, supply(0.3)], ["*", ward({ name: "Recovery" })], [3, "restroom"]], 6, 2)
          : ctx && ctx.top ? cor([["*", ward({ name: "Private ward" })], [5, "nursestation"], ["*", ward()]], [["*", ward()], [5, docs()], [5, "laundry"], [3, "restroom"]], 6, 2)
            : cor([["*", ward()], [5, "nursestation"], ["*", ward()]], [["*", ward({ name: "Step-down unit" })], ["*", ward()], [5, docs()], [3, "restroom"]], 6, 2)),
        exits: [...fire(0.3, 0.85), { side: "back", roles: ["kitchen", "cafeteria"], chance: 0.8, lock: 0.4 }],
      };
    } },
  ],

  // ---------- infirmaries: exam rooms and the drug cupboard in every plan; a prison's (o.site "prison") its own ----------
  infirmary: [
    { id: "general", name: "Infirmary", w: W(0.5, 0.5, 0.5, 0.5, { prison: 0.6, base: 0.5 }), make: (rng, o, K) => K.classic() }, // #14's plan
    { id: "prison", name: "Prison infirmary", w: W(0, 0, 0, 0.1, { prison: 1 }), make: (rng) => {
      // Sick call at the front; the secure ward behind: cells (civiclayout.js cell block) where the sick are locked in.
      const { bw, bh } = sized(rng, "infirmary.prison");
      return {
        bw, bh, front: { width: 1 }, ground: "base", storeys: 1, foot: "medium", openDoors: 0.15,
        program: cor([[4, { role: "office", name: "Officers' post", type: "cellblock" }], [4, ex3()], ["*", waiting({ name: "Sick call" })], [4, ex3()]], [["*", cells({ name: "Secure ward", type: "clinic" })], [3, cupboard()], [4, docs("Medical records")]], 4),

        exits: [{ side: "back", roles: ["office"], chance: 0.5, lock: 0.8 }],
      };
    } },
    { id: "prisonhosp", name: "Prison hospital wing", w: W(0, 0, 0, 0, { prison: 0.7 }), make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "infirmary.prisonhosp");
      return {
        bw, bh, front: { width: 1 }, ground: "base", storeys: n, foot: "large", stairs: ENDS2, openDoors: 0.15,
        program: cor([["*", ex3()], [5, waiting({ name: "Sick call" })], [4, exam({ name: "X-ray" })], [4, exam({ name: "Dental room" })]], [["*", ward({ name: "Secure ward", lock: ["door", 0.5] })], ["*", cells({ name: "Holding cells", type: "clinic" })], [3, cupboard()], [4, supply()], [2, "restroom"]], 5, 2),
        upper: () => cor([["*", ward({ name: "Secure ward", lock: ["door", 0.5] })], [5, "nursestation"], ["*", ward()]], [["*", cells({ name: "Isolation cells", type: "clinic" })], [4, ex3({ name: "Doctor's exam" })], [3, { role: "storage", type: "clinic" }], [2, "restroom"]], 5, 2),
        exits: [{ side: "back", roles: ["staffroom", "restroom"], chance: 0.4, lock: 0.9 }],
      };
    } },
    { id: "jail", name: "County jail clinic", w: W(0, 0, 0.2, 0.1, { prison: 0.6 }), make: (rng) => {
      const { bw, bh } = sized(rng, "infirmary.jail");
      return {
        bw, bh, front: { width: 1 }, ground: "base", storeys: 1, foot: "medium",
        program: Y([5, X(["*", waiting({ name: "Booking medical" })], [4, exam()])], ["*", X(["*", cells({ name: "Medical holding", type: "clinic" })], [3, cupboard()], [4, exam()])]),
        exits: [{ side: "back", roles: ["exam"], chance: 0.4, lock: 0.8 }],
      };
    } },
    { id: "camp", name: "Camp infirmary", w: W(0, 0, 0.2, 1), make: (rng) => {
      const { bw, bh } = sized(rng, "infirmary.camp");
      return {
        bw, bh, front: { width: 1 }, ground: "woods", storeys: 1, foot: "small",
        program: Y([4, X(["*", waiting({ name: "Nurse's porch", fl: "plank" })], [4, exam({ fl: "plank" })])], ["*", X(["*", ward({ name: "Sick bay", fl: "plank" })], [3, cupboard()], [3, { role: "bath", name: "Washroom", type: null, civic: "washroom" }])]),
        exits: [{ side: "back", roles: ["ward"], chance: 0.6, lock: 0.2 }],
      };
    } },
    { id: "campus", name: "College health centre", w: W(0.4, 0.6, 0.6, 0.1), make: (rng) => {
      const { bw, bh } = sized(rng, "infirmary.campus");
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: 2, foot: "medium",
        program: cor([[4, ex3()], ["*", waiting({ name: "Health centre lobby" })], [4, ex3()], [4, { role: "office", name: "Counselling", type: "office" }]], [["*", exam()], [4, { role: "lab", name: "Clinic lab", type: "clinic", civic: "sciencelab" }], [3, cupboard()], [2, "restroom"]], 4),
        upper: () => cor([["*", exam()], [5, { role: "classroom", name: "Health education", civic: "classroom" }], ["*", exam()]], [["*", ex3()], [6, ward({ name: "Overnight beds" })], [4, supply()], [2, "restroom"]], 4),
        exits: [{ side: "back", roles: ["exam", "lab"], chance: 0.7, lock: 0.3 }, ...fire(0.4, 0.4)],
      };
    } },
    { id: "field", name: "Field hospital", w: W(0, 0, 0.1, 0.4, { base: 1 }), make: (rng) => {
      // Tents in a row: the triage tent open at the front, the ward, surgical and supply tents behind (bare ground).
      const { bw, bh } = sized(rng, "infirmary.field");
      return {
        bw, bh, front: { width: 3 }, ground: "base", storeys: 1, foot: "wide", openDoors: 0.6,
        program: Y([6, X(["*", er({ name: "Triage tent", entry: true, hub: true, fl: "dirt" })], [5, exam({ name: "Treatment tent", fl: "dirt" })])], ["*", X(["*", ward({ name: "Ward tent", fl: "dirt" })], [5, { role: "theatre", name: "Surgical tent", fl: "dirt", boxTarget: 1 }], [4, cupboard({ name: "Medical supply", fl: "dirt" })], ["*", ward({ name: "Ward tent", fl: "dirt" })])]),
        exits: [{ side: "back", roles: ["ward"], chance: 0.8, lock: 0 }, { side: "left", roles: ["er", "ward"], chance: 0.6, lock: 0 }, { side: "right", roles: ["exam", "ward"], chance: 0.6, lock: 0 }],
      };
    } },
    { id: "aid", name: "Base aid station", w: W(0, 0, 0, 0.2, { base: 0.8 }), make: (rng) => {
      const { bw, bh } = sized(rng, "infirmary.aid");
      return {
        bw, bh, front: { width: 2 }, ground: "base", storeys: 1, foot: "medium",
        program: cor([["*", er({ name: "Aid station", entry: true, boxTarget: 2 })], [4, { role: "bath", name: "Decontamination", type: null, civic: "washroom" }], [4, exam()]], [["*", ward()], [4, cupboard({ name: "Medical supply" })], [7, { role: "ambbay", name: "Field ambulance bay" }]], 5),
        exits: [{ side: "back", roles: ["ambbay"], chance: 1, lock: 0.2, roller: true, width: 2, name: "Ambulance bay" }, { side: "left", roles: ["corridor"], chance: 0.5, lock: 0.3 }],
      };
    } },
    { id: "company", name: "Works infirmary", w: W(0.3, 0.3, 0.4, 0.2, { factory: 1 }), make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "infirmary.company");
      return {
        bw, bh, front: { width: 1 }, ground: "lot", storeys: n, foot: "medium",
        program: cor([["*", waiting({ name: "First-aid room" })], [4, ex3()], [4, ex3({ name: "Occupational health" })]], [["*", ward({ name: "Rest room" })], [3, cupboard()], [4, { role: "bath", name: "Eyewash and showers", type: null, civic: "washroom" }]], 4),
        upper: n > 1 ? () => cor([["*", exam()], [4, docs("Company doctor")]], [["*", { role: "storage", name: "Supply room", type: "clinic" }], [2, "restroom"]], 4) : null,
        exits: [{ side: "back", roles: ["ward", "bath"], chance: 0.7, lock: 0.3 }],
      };
    } },
    { id: "boarding", name: "Boarding-school sanatorium", w: W(0, 0.2, 0.4, 0.3), make: (rng) => {
      // The sick bay below, the matron's flat above (a home: roomlayout.js home styles on a flat's rooms).
      const { bw, bh } = sized(rng, "infirmary.boarding");
      const flat = (role, name) => ({ role, name, flat: true });
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: 2, foot: "medium", stairs: { roles: ["hall", "lobby"], n: 1 },
        program: Y([5, X([4, ex3()], ["*", waiting({ name: "Front hall", fl: "hardwood" })], [3, cupboard()])], ["*", X(["*", ward({ name: "Sick bay" })], [4, supply()], ["*", ex3({ name: "Treatment room" })])]),
        upper: () => Y([5, X([4, flat("bedroom", "Matron's bedroom")], ["*", { role: "hall", name: "Landing" }], [3, flat("bath", "Matron's bathroom")])], ["*", X(["*", flat("living", "Matron's sitting room")], [4, flat("kitchen", "Matron's kitchen")], ["*", ex3({ name: "Doctor's surgery" })])]),
        exits: [{ side: "back", roles: ["staffroom", "ward"], chance: 0.7, lock: 0.3 }],
      };
    } },
    { id: "quarantine", name: "Quarantine station", w: W(0, 0.1, 0.2, 0.5, { base: 0.4 }), make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "infirmary.quarantine");
      const iso = () => ward({ name: "Isolation room", lock: ["door", 0.4] });
      return {
        bw, bh, front: { width: 1 }, ground: "rural", storeys: n, foot: "medium",
        program: cor([[4, { role: "bath", name: "Decontamination", type: null, civic: "washroom" }], ["*", waiting({ name: "Screening" })], [4, ex3()]], [["*", iso()], ["*", iso()], [4, ex3({ name: "Sample room" })], [3, cupboard()], [3, supply()]], 4),
        upper: n > 1 ? () => cor([["*", iso()], [4, ex3()]], [["*", iso()], [4, ex3({ name: "Sample room" })], [4, supply()]], 4) : null,
        exits: [{ side: "back", roles: ["pharmroom", "ward"], chance: 0.5, lock: 0.6 }],
      };
    } },
    { id: "shelter", name: "Shelter infirmary", w: W(0.6, 0.3, 0.2, 0), make: (rng) => {
      const { bw, bh } = sized(rng, "infirmary.shelter");
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: 1, foot: "medium",
        program: Y([5, X(["*", waiting({ name: "Drop-in room" })], [4, ex3()], [4, ex3()])], ["*", X(["*", ward({ name: "Respite beds" })], [3, cupboard()], [4, kitchenette], [4, { role: "bath", name: "Showers", type: null, civic: "washroom" }])]),
        exits: [{ side: "back", roles: ["staffroom", "bath", "ward"], chance: 0.6, lock: 0.3 }],
      };
    } },
  ],

  // ---------- clinics: exam rooms and the drug cupboard in every plan ----------
  clinic: [
    { id: "general", name: "Medical clinic", w: W(0.6, 0.8, 0.8, 0.4), fr: ["familymed", "valleyhealth", "drhale"], make: (rng, o, K) => K.classic() }, // #14's plan
    { id: "urgent", name: "Urgent care", w: W(1, 1, 0.4, 0), fr: ["urgentnow", "medfirst"], make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "clinic.urgent");
      return {
        bw, bh, front: { width: 2 }, ground: "lot", storeys: n, foot: "medium",
        program: cor([[4, exam({ boxTarget: 3 })], ["*", waiting()], [7, er({ name: "Treatment bay", type: "clinic", bays: 3 })]], [["*", exam()], [4, exam({ name: "X-ray" })], [3, cupboard()], [3, kitchenette], [2, "restroom"]], 5),
        upper: n > 1 ? () => cor([["*", exam()], [4, docs()]], [["*", { role: "storage", type: "clinic" }], [2, "restroom"]], 5) : null,
        exits: [{ side: "back", roles: ["exam", "staffroom"], chance: 0.7, lock: 0.3 }, { side: "right", roles: ["er"], chance: 0.6, lock: 0.3, name: "Ambulance door" }],
      };
    } },
    { id: "family", name: "Family practice", w: W(0.2, 0.8, 1, 0.6), fr: ["familymed", "drhale", "valleyhealth"], make: (rng) => {
      // A converted house: no corridor, the rooms round the waiting room.
      const { bw, bh } = sized(rng, "clinic.family");
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: 1, foot: "medium",
        program: Y(["*", X([4, exam()], ["*", waiting({ fl: "hardwood" })], [4, docs("Doctor's office")])], ["*", X(["*", exam()], [3, cupboard()], [4, kitchenette], ["*", exam()])]),
        exits: [{ side: "back", roles: ["staffroom", "exam"], chance: 0.7, lock: 0.3 }],
      };
    } },
    { id: "dialysis", name: "Dialysis centre", w: W(0.8, 0.8, 0.4, 0.1), fr: ["familymed", "valleyhealth", "urgentnow"], make: (rng) => {
      const { bw, bh } = sized(rng, "clinic.dialysis");
      return {
        bw, bh, front: { width: 2 }, ground: "lot", storeys: 1, foot: "medium",
        program: Y([5, X(["*", waiting()], [4, exam({ boxTarget: 3 })], [4, docs("Nephrologist's office")])], ["*", X(["*", { role: "icu", name: "Dialysis floor", type: "clinic", boxTarget: 5 }], [3, { role: "workshop", name: "Water treatment", type: "workshop", civic: "fworkshop" }], [3, cupboard()], [3, kitchenette])]),
        exits: [{ side: "back", roles: ["workshop", "staffroom"], chance: 0.8, lock: 0.3 }],
      };
    } },
    { id: "dental", name: "Dental practice", w: W(0.6, 1, 0.8, 0.2), fr: ["drhale", "familymed"], make: (rng) => {
      // Operatories off a hall behind the front desk (the chair: an exam bed); #27's dentist office is the offices' own.
      const { bw, bh } = sized(rng, "clinic.dental");
      const op = () => exam({ name: "Operatory", boxTarget: 2 });
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: 1, foot: "medium",
        program: cor([["*", waiting({ name: "Reception" })], [4, docs("Dentist's office")]], [["*", op()], ["*", op()], ["*", op()], [3, cupboard({ name: "Sterilisation room" })]], 4),
        exits: [{ side: "back", roles: ["pharmroom", "exam"], chance: 0.6, lock: 0.4 }],
      };
    } },
    { id: "stripmall", name: "Walk-in clinic", w: W(1, 1, 0.3, 0), fr: ["medfirst", "urgentnow"], make: (rng) => {
      // A unit in a strip mall: narrow and deep, the exam rooms either side of a hall down the middle.
      const { bw, bh } = sized(rng, "clinic.stripmall");
      return {
        bw, bh, front: { width: 2 }, ground: "lot", storeys: 1, foot: "medium",
        program: Y([4, waiting()], ["*", X(["*", Y(["*", exam({ boxTarget: 2 })], ["*", exam({ boxTarget: 2 })])], [1, { role: "corridor" }], ["*", Y(["*", exam({ boxTarget: 2 })], [3, cupboard()])])], [3, X(["*", kitchenette], [2, "restroom"])]),
        exits: [{ side: "back", roles: ["staffroom", "restroom"], chance: 0.9, lock: 0.4 }],
      };
    } },
    { id: "occhealth", name: "Occupational health clinic", w: W(0.6, 0.5, 0.5, 0.2), fr: ["valleyhealth", "medfirst"], make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "clinic.occhealth");
      return {
        bw, bh, front: { width: 2 }, ground: "lot", storeys: n, foot: "medium",
        program: cor([[4, exam({ boxTarget: 3 })], ["*", waiting()], [4, exam({ name: "Hearing booth" })]], [["*", { role: "gym", name: "Physical therapy", type: "clinic", civic: "fgym" }], [4, exam({ boxTarget: 3 })], [3, exam({ name: "Drug testing" })], [3, cupboard()]], 4),
        upper: n > 1 ? () => cor([["*", exam({ boxTarget: 3 })], [4, docs()]], [["*", { role: "storage", name: "Supply room", type: "clinic" }], [2, "restroom"]], 4) : null,
        exits: [{ side: "back", roles: ["gym", "exam"], chance: 0.7, lock: 0.3 }, ...fire(0.4, 0.3)],
      };
    } },
    { id: "free", name: "Free clinic", w: W(0.8, 0.4, 0.5, 0.3), fr: ["valleyhealth", "drhale"], make: (rng) => {
      // In an old storefront: a big waiting room, curtained exam rooms, donated medicines and a food pantry.
      const { bw, bh } = sized(rng, "clinic.free");
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "medium",
        program: Y(["*", waiting()], [6, X(["*", exam({ boxTarget: 2 })], ["*", exam({ boxTarget: 2 })], ["*", exam({ boxTarget: 2 })], [3, cupboard({ name: "Donated medicines" })], [3, { role: "pantry", name: "Food pantry", type: "kitchen", civic: "cpantry" }])]),
        exits: [{ side: "back", roles: ["pantry", "exam"], chance: 0.7, lock: 0.3 }, { side: "left", roles: ["lobby"], chance: 0.3, lock: 0.5 }],
      };
    } },
    { id: "multi", name: "Multi-specialty medical centre", w: W(1, 0.8, 0.2, 0), fr: ["familymed", "urgentnow"], make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "clinic.multi");
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: ENDS2,
        program: cor([[4, exam()], ["*", waiting()], [4, exam({ name: "Imaging" })], [4, exam()]], [["*", exam()], [4, { role: "lab", name: "Clinic lab", civic: "sciencelab" }], [3, cupboard()], [3, kitchenette], [2, "restroom"]], 5, 2),
        upper: () => cor([[4, exam({ boxTarget: 3 })], ["*", exam({ boxTarget: 3 })], [4, exam()], [4, docs()]], [["*", exam({ boxTarget: 3 })], [4, { role: "storage", type: "clinic" }], [3, { role: "storage", name: "Supply room", type: "clinic" }], [2, "restroom"]], 5, 2),
        exits: [{ side: "back", roles: ["lab", "staffroom", "exam"], chance: 0.7, lock: 0.3 }, ...fire(0.4, 0.6)],
      };
    } },
    { id: "paediatric", name: "Paediatric practice", w: W(0.4, 1, 0.6, 0.2), fr: ["familymed", "drhale"], make: (rng) => {
      // Two waiting rooms (sick and well), a playroom, the vaccine fridge in the drug cupboard.
      const { bw, bh } = sized(rng, "clinic.paediatric");
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "medium",
        program: cor([["*", waiting({ name: "Well waiting room" })], [4, { role: "dayroom", name: "Playroom", civic: "fdayroom", hub: false }], ["*", waiting({ name: "Sick waiting room", entry: false })]], [["*", exam({ boxTarget: 2 })], ["*", exam({ boxTarget: 2 })], ["*", exam({ boxTarget: 2 })], [3, cupboard({ name: "Vaccine room" })], [2, "restroom"]], 5),
        exits: [{ side: "back", roles: ["exam", "restroom"], chance: 0.6, lock: 0.4 }],
      };
    } },
    { id: "rural", name: "Rural health post", w: W(0, 0, 0.4, 1), fr: ["valleyhealth", "drhale"], make: (rng) => {
      const { bw, bh } = sized(rng, "clinic.rural");
      return {
        bw, bh, front: { width: 1 }, ground: "rural", storeys: 1, foot: "small",
        program: Y(["*", X(["*", waiting()], [3, cupboard()])], ["*", X(["*", exam()], [2, "restroom"])]),
        exits: [{ side: "back", roles: ["exam"], chance: 0.5, lock: 0.4 }],
      };
    } },
    { id: "surgery", name: "Outpatient surgery centre", w: W(0.8, 1, 0.2, 0), fr: ["urgentnow", "medfirst"], make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "clinic.surgery");
      return {
        bw, bh, front: { width: 2 }, ground: "lot", storeys: n, foot: "medium",
        program: cor([["*", waiting()], [4, exam({ name: "Consult room" })], ["*", ward({ name: "Pre-op" })]], [["*", { role: "theatre", lock: ["door", 0.3], boxTarget: 1 }], ["*", { role: "theatre", lock: ["door", 0.3], boxTarget: 1 }], [4, { role: "icu", name: "Recovery" }], [3, cupboard()]], 4),

        upper: n > 1 ? () => cor([["*", docs("Surgeons' office")], [4, "staffroom"]], [["*", { role: "storage", name: "Sterile store", type: "clinic" }], [2, "restroom"]], 4) : null,
        exits: [{ side: "back", roles: ["theatre", "pharmroom"], chance: 0.6, lock: 0.4 }],
      };
    } },
  ],

  // ---------- vets: the kennels in every plan ----------
  vet: [
    { id: "general", name: "Small-animal clinic", w: W(0.8, 1, 0.6, 0.3), fr: ["pawsclinic", "companion", "animalhosp"], make: (rng, o, K) => K.classic() }, // #14's plan (a country vet's barn plans are the country and farm variants)
    { id: "country", name: "Country vet", w: W(0, 0.3, 1, 1), fr: ["countryvet", "valleyvet"], make: (rng) => {
      const { bw, bh } = sized(rng, "vet.country");
      return {
        bw, bh, front: { width: 2 }, ground: "rural", storeys: 1, foot: "medium",
        program: cor([[4, vx()], ["*", vwait()], [4, vx()]], [["*", stalls()], [5, kennels()], [4, vsurgery()], [3, vd()], [3, vfood()]], 4),
        exits: [{ side: "back", roles: ["barnfloor", "storage", "cells", "theatre"], chance: 0.8, lock: 0.3 }, { side: "left", roles: ["barnfloor"], chance: 0.6, width: 2, lock: 0.2, name: "Stall door" }],
      };
    } },
    { id: "farm", name: "Large-animal and farm vet", w: W(0, 0, 0.5, 1), fr: ["valleyvet", "countryvet"], make: (rng) => {
      // The clinic on one side, the barn on the other behind its big door: stalls, stocks for treating cattle, hay.
      const { bw, bh } = sized(rng, "vet.farm");
      const left = rng.chance(0.5);
      const clinic = ["*", Y([5, X(["*", vwait()], [4, vx()], [4, vx({ name: "Small-animal exam" })])], ["*", X(["*", kennels()], [3, vd()], [4, vsurgery()])])];
      const barn = [0.38, Y(["*", { role: "barnfloor", name: "Large-animal barn", type: "barn", hub: true }], [4, X(["*", vx({ name: "Treatment stocks", fl: "dirt" })], [4, vfood({ name: "Feed and hay" })])])];
      return {
        bw, bh, front: { width: 2 }, ground: "farm", storeys: 1, foot: "wide",
        program: X(...(left ? [barn, clinic] : [clinic, barn])),
        exits: [{ side: "front", roles: ["barnfloor"], chance: 1, roller: true, width: 3, lock: 0.2, name: "Barn door" }, { side: "back", roles: ["barnfloor", "storage"], chance: 0.7, width: 2, lock: 0.3 }, { side: left ? "right" : "left", roles: ["cells", "lobby"], chance: 0.4, lock: 0.4 }],
      };
    } },
    { id: "emergency", name: "Emergency animal hospital", w: W(1, 0.7, 0.2, 0), fr: ["animalhosp", "companion"], make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "vet.emergency");
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: ENDS2,
        program: cor([[4, vx()], [7, er({ name: "Triage", type: "vet" })], ["*", vwait()], [4, vx()]], [["*", kennels()], [4, vsurgery()], [4, vsurgery()], [4, { role: "ward", name: "Critical care", type: "vet" }], [3, vd()]], 5, 2),
        upper: n > 1 ? () => cor([["*", { role: "office", type: "vet" }], [4, "breakroom"], ["*", { role: "office", type: "vet" }]], [["*", { role: "ward", name: "Recovery ward", type: "vet" }], [3, vfood()], [2, "restroom"]], 5, 2) : null,
        exits: [{ side: "back", roles: ["cells", "theatre"], chance: 0.8, lock: 0.3 }, { side: "right", roles: ["er"], chance: 0.6, lock: 0.3, name: "Ambulance door" }],
      };
    } },
    { id: "shelter", name: "Animal shelter", w: W(0.5, 0.8, 0.8, 0.5), fr: ["pawsclinic", "companion", "countryvet"], make: (rng) => {
      const { bw, bh } = sized(rng, "vet.shelter");
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "wide",
        program: cor([[4, vx({ name: "Intake" })], ["*", vwait({ name: "Adoption lobby" })], [4, vx()], [4, { role: "office", type: "vet" }]], [["*", kennels({ name: "Dog kennels" })], ["*", kennels({ name: "Cat room", lock: ["door", 0.2] })], [4, vsurgery({ name: "Spay and neuter" })], [3, vd()], [3, vfood()], [3, { role: "laundry" }]], 4),
        exits: [{ side: "back", roles: ["cells", "storage"], chance: 0.9, lock: 0.3, name: "Dog run gate" }, ...fire(0.4, 0.4)],
      };
    } },
    { id: "boarding", name: "Boarding kennel", w: W(0.2, 0.7, 0.8, 0.8), fr: ["companion", "pawsclinic"], make: (rng) => {
      const { bw, bh } = sized(rng, "vet.boarding");
      return {
        bw, bh, front: { width: 1 }, ground: "rural", storeys: 1, foot: "medium",
        program: Y([5, X(["*", vwait({ name: "Check-in" })], [4, vx({ name: "Grooming" })], [3, vd()])], ["*", X(["*", kennels({ name: "Kennel run" })], ["*", kennels({ name: "Kennel run" })], [4, vx()], [3, vfood()])]),
        exits: [{ side: "back", roles: ["cells"], chance: 0.9, lock: 0.3, name: "Exercise yard" }, { side: "back", roles: ["storage", "exam"], chance: 0.5, lock: 0.4 }],
      };
    } },
    { id: "equine", name: "Equine hospital", w: W(0, 0.2, 0.5, 1), fr: ["valleyvet", "countryvet"], make: (rng) => {
      const { bw, bh } = sized(rng, "vet.equine");
      return {
        bw, bh, front: { width: 2 }, ground: "farm", storeys: 1, foot: "wide",
        program: cor([[4, vx({ name: "Lameness exam" })], ["*", vwait({ name: "Reception" })], [4, vx({ name: "Farrier's room" })], ["*", vx({ name: "Treatment stocks", fl: "dirt", boxTarget: 4 })]], [["*", stalls({ name: "Stall barn" })], [5, vsurgery({ name: "Equine surgery" })], [3, { role: "ward", name: "Recovery stall", type: "vet", fl: "dirt" }], [3, kennels({ name: "Barn kennels" })], [3, vd()], [3, vfood({ name: "Feed room" })]], 5, 2),
        exits: [{ side: "back", roles: ["barnfloor"], chance: 1, roller: true, width: 2, lock: 0.2, name: "Stall door" }, { side: "left", roles: ["corridor"], chance: 0.5, width: 2, lock: 0.3 }, { side: "right", roles: ["corridor"], chance: 0.5, width: 2, lock: 0.3 }],
      };
    } },
    { id: "storefront", name: "Storefront vet", w: W(1, 0.8, 0.3, 0), fr: ["pawsclinic", "companion"], make: (rng) => {
      const { bw, bh } = sized(rng, "vet.storefront");
      return {
        bw, bh, front: { width: 2 }, ground: "lot", storeys: 1, foot: "medium",
        program: Y([5, vwait()], ["*", X(["*", Y(["*", vexam()], ["*", vexam()])], [1, { role: "corridor" }], ["*", Y([4, vd()], ["*", vsurgery()])])], [5, kennels()]),
        exits: [{ side: "back", roles: ["cells"], chance: 0.9, lock: 0.4 }],
      };
    } },
    { id: "specialty", name: "Veterinary specialty centre", w: W(1, 0.6, 0.1, 0), fr: ["animalhosp"], make: (rng) => {
      const { bw, bh } = sized(rng, "vet.specialty");
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: 2, foot: "medium", stairs: ENDS2,
        program: cor([[4, vx({ name: "Cardiology" })], [4, vx({ name: "Imaging" })], ["*", vwait()], [4, vx({ name: "Oncology" })]], [["*", kennels()], [5, vsurgery()], [3, vd()], [3, vfood()]], 5, 2),
        upper: () => cor([["*", { role: "office", type: "vet" }], [4, "breakroom"], ["*", { role: "gym", name: "Hydrotherapy", type: "vet", civic: "fgym" }]], [["*", vx({ name: "Consult room" })], [6, { role: "ward", name: "Recovery ward", type: "vet" }], [4, { role: "office", name: "Specialists' office", type: "vet" }], [2, "restroom"]], 5, 2),
        exits: [{ side: "back", roles: ["cells", "theatre", "storage"], chance: 0.8, lock: 0.3 }, ...fire(0.4, 0.4)],
      };
    } },
    { id: "exotic", name: "Exotic and bird clinic", w: W(0.8, 0.8, 0.2, 0), fr: ["companion", "animalhosp"], make: (rng) => {
      const { bw, bh } = sized(rng, "vet.exotic");
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "medium",
        program: Y(["*", X([4, vexam()], ["*", vwait()], [4, vexam({ name: "Avian exam" })])], ["*", X(["*", { role: "ward", name: "Aviary ward", type: "vet" }], ["*", kennels({ name: "Reptile room" })], [3, vdrugs()], [3, vfood()])]),
        exits: [{ side: "back", roles: ["ward", "storage"], chance: 0.6, lock: 0.4 }],
      };
    } },
    { id: "cat", name: "Cat clinic", w: W(0.8, 1, 0.4, 0.1), fr: ["pawsclinic", "companion"], make: (rng) => {
      const { bw, bh } = sized(rng, "vet.cat");
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: 1, foot: "medium",
        program: cor([[4, vexam()], ["*", vwait({ name: "Cats-only waiting room" })], [4, { role: "office", name: "Consult room", type: "office" }]], [["*", kennels({ name: "Cat ward", lock: ["door", 0.25] })], [4, vsurgery()], [3, vdrugs({ boxTarget: 1 })]], 4),
        exits: [{ side: "back", roles: ["cells", "pharmroom"], chance: 0.5, lock: 0.4 }],
      };
    } },
    { id: "teaching", name: "Veterinary teaching hospital", w: W(0.6, 0.4, 0.4, 0.4), fr: ["animalhosp", "valleyvet"], make: (rng) => {
      const { bw, bh } = sized(rng, "vet.teaching");
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: 2, foot: "large", stairs: ENDS2,
        program: cor([[4, vx()], [4, vx()], ["*", vwait()], [6, { role: "classroom", name: "Teaching lab", civic: "briefing" }], [4, vx()]], [["*", kennels()], ["*", stalls({ name: "Large-animal ward" })], [5, vsurgery()], [5, vsurgery({ name: "Teaching surgery" })], [3, vd()], [3, vfood()]], 5, 2),
        upper: () => cor([["*", vx({ name: "Consult room" })], [5, vx({ name: "Student exam" })], ["*", vx({ name: "Consult room" })]], [["*", vx({ name: "Consult room" })], [7, { role: "ward", name: "Recovery ward", type: "vet" }], [5, { role: "lab", name: "Diagnostic lab", civic: "sciencelab" }], [4, "breakroom"], [2, "restroom"]], 5, 2),
        exits: [{ side: "back", roles: ["barnfloor", "cells"], chance: 0.9, roller: true, width: 2, lock: 0.3, name: "Livestock door" }, ...fire(0.4, 0.5)],
      };
    } },
  ],

  // ---------- churches: the nave and its altar in every plan ----------
  church: [
    { id: "general", name: "Parish church", w: W(0.6, 1, 0.8, 0.5), fr: ["holytrinity", "gracemethodist", "stmarys"], make: (rng, o, K) => K.classic() }, // #15's plan
    { id: "chapel", name: "White clapboard chapel", w: W(0, 0.3, 0.8, 1), fr: ["firstbaptist", "calvary", "gracemethodist"], make: (rng) => {
      const { bw, bh } = sized(rng, "church.chapel");
      return {
        bw, bh, front: { width: 1 }, ground: "rural", storeys: 1, foot: "small", loft: BELFRY,
        program: Y([2, narthex({ fl: "plank" })], ["*", nave({ fl: "plank" })], [3, X(["*", vestry()], [2, tower({ name: "Belfry" })])]),
        exits: [{ side: "back", roles: ["vestry"], chance: 0.6, lock: 0.3 }],
      };
    } },
    { id: "brick", name: "Brick church with a fellowship hall", w: W(0.3, 1, 1, 0.4), fr: ["firstbaptist", "gracemethodist", "holytrinity"], make: (rng) => {
      // The church on one side, the fellowship hall's wing on the other: the hall and its kitchen, Sunday school rooms.
      const { bw, bh } = sized(rng, "church.brick");
      const left = rng.chance(0.5);
      const church = ["*", Y([3, X(["*", narthex()], [3, tower({ name: "Steeple" })])], ["*", nave()], [4, X(["*", vestry()], [3, { role: "restroom" }])])];
      const wing = [0.42, Y([4, X(["*", sunday()], ["*", sunday()])], ["*", { role: "kitchen", name: "Fellowship hall", civic: "parishhall" }], [3, X(["*", cpantry()], [3, { role: "restroom" }])])];
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "large", loft: BELFRY,
        program: X(...(left ? [wing, church] : [church, wing])),
        exits: [{ side: "front", roles: ["classroom"], chance: 0.8, lock: 0.3, name: "Hall entrance" }, { side: "back", roles: ["kitchen", "pantry"], chance: 0.7, lock: 0.3 }, { side: left ? "right" : "left", roles: ["nave"], chance: 0.5, lock: 0.4 }],
      };
    } },
    { id: "mega", name: "Megachurch", w: W(0.6, 1, 0.1, 0), fr: ["calvary", "firstbaptist"], make: (rng) => {
      // The worship centre (a nave the size of an auditorium) behind a lobby with a café; classrooms, the youth room
      // and the nursery round it; upstairs classrooms, offices and the media booth.
      const { bw, bh } = sized(rng, "church.mega");
      return {
        bw, bh, front: { width: 3 }, ground: "lot", storeys: 2, foot: "large", stairs: { roles: ["foyer", "corridor"], n: 2 },
        program: Y([5, X([6, { role: "cafeteria", name: "Café", civic: "cafeteria", hub: false }], ["*", narthex({ name: "Lobby" })], [5, { role: "office", name: "Welcome centre", type: "office" }])], ["*", X([6, Y(["*", sunday()], ["*", sunday()])], ["*", nave({ name: "Worship centre" })], [6, Y(["*", { role: "dayroom", name: "Youth room", civic: "fdayroom", hub: false }], ["*", { role: "dayroom", name: "Nursery", type: "house", hub: false }])])], [4, X(["*", hall({ name: "Fellowship hall" })], [4, cpantry()], [3, { role: "restroom" }])]),
        upper: () => Y([5, X([6, { role: "office", type: "office" }], ["*", { role: "corridor", name: "Mezzanine" }], [5, { role: "office", name: "Media booth", civic: "dispatch" }])], ["*", X([6, Y(["*", sunday()], ["*", sunday()])], ["*", { role: "dayroom", name: "Gallery", civic: "fdayroom" }], [6, Y(["*", sunday()], ["*", { role: "office", name: "Pastors' offices", type: "office" }])])], [4, X(["*", { role: "storage", name: "Stage storage", type: "chapel" }], [3, { role: "restroom" }])]),
        exits: [{ side: "back", roles: ["kitchen", "pantry"], chance: 0.8, lock: 0.3 }, { side: "left", roles: ["classroom", "nave"], chance: 0.7, lock: 0.3 }, { side: "right", roles: ["dayroom", "nave"], chance: 0.7, lock: 0.3 }, { side: "front", roles: ["cafeteria"], chance: 0.5, lock: 0.3, name: "Café door" }],
      };
    } },
    { id: "cathedral", name: "Cathedral", w: W(1, 0.2, 0, 0), fr: ["stmarys", "holytrinity"], make: (rng) => {
      // A great nave between the Lady chapel and a side chapel (each its own altar), the twin towers at the front corners,
      // the sacristy behind the high altar, the chapter house and the almonry behind the chapels.
      const { bw, bh } = sized(rng, "church.cathedral");
      const chapel = (name) => nave({ name });

      return {
        bw, bh, front: { width: 3 }, ground: "city", storeys: 1, foot: "large", loft: BELFRY,
        program: X([9, Y([4, tower({ name: "North tower" })], ["*", chapel("Lady chapel")], [5, hall({ name: "Chapter house" })])], ["*", Y([4, narthex()], ["*", nave()], [5, vestry({ name: "Sacristy" })])], [9, Y([4, tower({ name: "South tower" })], ["*", chapel("Side chapel")], [5, cpantry({ name: "Almonry" })])]),
        exits: [{ side: "back", roles: ["vestry", "kitchen"], chance: 0.8, lock: 0.4 }, { side: "left", roles: ["nave"], chance: 0.6, lock: 0.4 }, { side: "right", roles: ["nave"], chance: 0.6, lock: 0.4 }],
      };
    } },
    { id: "storefront", name: "Storefront church", w: W(1, 0.6, 0.3, 0), fr: ["calvary", "firstbaptist"], make: (rng) => {
      // An old shop: the sanctuary straight in off the street, the pastor's office and a kitchenette behind.
      const { bw, bh } = sized(rng, "church.storefront");
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: 1, foot: "small",
        program: Y(["*", nave({ name: "Sanctuary", entry: true, fl: "tile" })], [4, X(["*", vestry({ name: "Pastor's office" })], [4, cpantry({ name: "Kitchenette" })], [2, { role: "restroom" }])]),
        exits: [{ side: "back", roles: ["vestry", "pantry", "restroom"], chance: 0.8, lock: 0.5 }],
      };
    } },
    { id: "rectory", name: "Catholic church with a rectory", w: W(0.5, 0.8, 0.8, 0.4), fr: ["stmarys"], make: (rng) => {
      // The church and, joined at the back, the priest's house (a home: roomlayout.js home styles on a flat's rooms).
      const { bw, bh } = sized(rng, "church.rectory");
      const flat = (role, name) => ({ role, name, flat: true });
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "large", loft: BELFRY,
        program: X(["*", Y([3, narthex()], ["*", nave()], [4, X(["*", vestry({ name: "Sacristy" })], [3, tower()])])], [0.38, Y([5, X(["*", flat("living", "Rectory parlour")], [4, flat("kitchen", "Rectory kitchen")])], ["*", X(["*", flat("bedroom", "Priest's bedroom")], [3, flat("bath", "Rectory bathroom")])], [5, X(["*", hall({ name: "Parish office" })], [3, cpantry()])])]),
        exits: [{ side: "front", roles: ["living"], chance: 1, lock: 0.5, name: "Rectory door" }, { side: "back", roles: ["kitchen", "pantry", "bedroom"], chance: 0.6, lock: 0.4 }, { side: "left", roles: ["nave"], chance: 0.5, lock: 0.4 }],
      };
    } },
    { id: "country", name: "Country church", w: W(0, 0.2, 0.6, 1), fr: ["firstbaptist", "gracemethodist", "holytrinity"], make: (rng) => {
      // A bell tower over the door, the nave, and the hall in a wing behind; a cellar-free plan on one floor.
      const { bw, bh } = sized(rng, "church.country");
      return {
        bw, bh, front: { width: 1 }, ground: "rural", storeys: 1, foot: "medium", loft: BELFRY,
        program: Y([3, X(["*", narthex({ fl: "plank" })], [3, tower()])], ["*", nave({ fl: "plank" })], [5, X([3, vestry()], ["*", hall({ name: "Church hall" })])]),
        exits: [{ side: "back", roles: ["kitchen"], chance: 0.8, lock: 0.3 }],
      };
    } },
    { id: "cruciform", name: "Cruciform stone church", w: W(0.6, 0.6, 0.4, 0.2), fr: ["stmarys", "holytrinity"], make: (rng) => {
      // A cross: the nave down the middle, the transepts either side of it (chapels, each its own altar), the parish
      // office and a Sunday school room (each with a pantry) in the front corners, the sacristy and the bell tower behind.
      const { bw, bh } = sized(rng, "church.cruciform");
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "large", loft: BELFRY, extraDoors: 0,
        program: X([9, Y([5, X(["*", { role: "office", name: "Parish office", type: "office" }], [3, cpantry()])], ["*", nave({ name: "North transept" })])], ["*", Y([3, narthex()], ["*", nave()], [4, X(["*", vestry({ name: "Sacristy" })], [3, tower()])])], [9, Y([5, X(["*", sunday()], [3, cpantry({ name: "Hall kitchen" })])], ["*", nave({ name: "South transept" })])]),
        exits: [{ side: "back", roles: ["pantry", "kitchen", "vestry"], chance: 0.7, lock: 0.3 }, { side: "left", roles: ["nave", "office"], chance: 0.5, lock: 0.4 }, { side: "right", roles: ["nave", "classroom"], chance: 0.5, lock: 0.4 }],
      };
    } },
    { id: "mission", name: "Mission church", w: W(0.2, 0.4, 0.6, 0.6), fr: ["stmarys", "calvary"], make: (rng) => {
      // Adobe walls round a covered cloister walk; the nave on one side, the convento's rooms on the other.
      const { bw, bh } = sized(rng, "church.mission");
      const left = rng.chance(0.5);
      const church = ["*", Y([3, narthex({ fl: "tile" })], ["*", nave({ fl: "tile" })], [4, X(["*", vestry()], [3, tower({ name: "Campanario" })])])];
      const walk = [2, { role: "corridor", name: "Cloister walk", fl: "tile" }];
      const convento = [0.36, Y([5, X(["*", { role: "office", name: "Mission office", type: "office" }], [4, cpantry()])], ["*", hall({ name: "Refectory" })], [4, sunday({ name: "School room" })])];
      return {
        bw, bh, front: { width: 2 }, ground: "rural", storeys: 1, foot: "large", loft: BELFRY,
        program: X(...(left ? [convento, walk, church] : [church, walk, convento])),
        exits: [{ side: "front", roles: ["corridor"], chance: 0.8, lock: 0.3, name: "Cloister gate" }, { side: "back", roles: ["kitchen", "classroom"], chance: 0.6, lock: 0.3 }],
      };
    } },
    { id: "school", name: "Church with a parish school", w: W(0.4, 0.8, 0.6, 0.2), fr: ["stmarys", "holytrinity", "gracemethodist"], make: (rng) => {
      // The church at the front, the school's classrooms along a corridor behind and beside it.
      const { bw, bh, storeys: n } = sized(rng, "church.school");
      const C = (o = {}) => ({ role: "classroom", civic: "classroom", ...o });
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "large", stairs: { roles: ["corridor"], n: 1 }, ...(n > 1 ? {} : { loft: BELFRY }),
        program: X(["*", Y([3, narthex()], ["*", nave()], [4, X(["*", vestry()], ...(n > 1 ? [] : [[3, tower()]]))])], [2, { role: "corridor", name: "School corridor" }], [0.4, Y([5, { role: "office", name: "School office", type: "office", entry: true }], ["*", C()], ["*", C()], [4, hall({ name: "School hall" })])]),
        upper: n > 1 ? () => X(["*", { role: "storage", name: "Choir loft", type: "chapel" }], [2, { role: "corridor", name: "School corridor" }], [0.4, Y([5, C()], ["*", C()], ["*", C()], [4, { role: "office", name: "Staff room", type: "office" }])]) : null,
        exits: [{ side: "back", roles: ["kitchen", "corridor"], chance: 0.8, lock: 0.3 }, { side: "right", roles: ["classroom", "kitchen"], chance: 0.5, lock: 0.3 }],
      };
    } },
    { id: "meeting", name: "Meeting house", w: W(0.2, 0.6, 0.8, 0.6), fr: ["gracemethodist", "firstbaptist", "calvary"], make: (rng) => {
      // A plain square meeting room (the communion table its altar), entered at the side; the fellowship room above.
      const { bw, bh } = sized(rng, "church.meeting");
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: 2, foot: "medium", stairs: { roles: ["foyer"], n: 1 },
        program: X([4, Y([5, narthex({ name: "Porch" })], ["*", vestry({ name: "Elders' room" })])], ["*", nave({ name: "Meeting room", hub: true })]),
        upper: () => X([4, Y([5, { role: "hall", name: "Landing" }], ["*", cpantry()])], ["*", hall({ name: "Fellowship room" })]),
        exits: [{ side: "right", roles: ["nave"], chance: 0.8, lock: 0.3 }, { side: "back", roles: ["vestry", "nave"], chance: 0.5, lock: 0.4 }],
      };
    } },
    // ---------- issue #49 (new worlds only: fresh): the parish church in its churchyard (civicsite.js) ----------
    { id: "churchyard", name: "Parish church and churchyard", w: W(0, 0.2, 0.8, 1), fr: ["holytrinity", "gracemethodist", "stmarys"], fresh: true, make: (rng) => {
      // An old stone parish church: the narthex under its bell tower at the front, the nave, the vestry and the
      // sacristy behind the altar. It stands in its churchyard, the graves in rows round it, the parish hall a building
      // of its own across the path (civicsite.js).
      const { bw, bh } = sized(rng, "church.churchyard");
      return {
        bw, bh, front: { width: 1 }, ground: "rural", storeys: 1, foot: "medium", loft: BELFRY, civicSite: "churchyard",
        program: Y([3, X(["*", narthex()], [4, tower()])], ["*", nave()], [4, X(["*", vestry()], ["*", vestry({ name: "Sacristy" })])]),
        exits: [{ side: "back", roles: ["vestry"], chance: 0.8, lock: 0.3, name: "Priest's door" }, { side: "left", roles: ["nave"], chance: 0.6, lock: 0.4 }],
      };
    } },
  ],

  // ---------- police stations: front desk, squad room, chief, armory, evidence, cells, a police car ----------
  police: [
    { id: "general", name: "Police station", w: W(0.8, 1, 0.8, 0.3), fr: ["precinct", "sheriff"], make: (rng, o, K) => K.classic() }, // #15's plan
    { id: "substation", name: "Sheriff's substation", w: W(0, 0.3, 0.6, 1), fr: ["sheriff"], make: (rng) => {
      const { bw, bh } = sized(rng, "police.substation");
      return {
        bw, bh, front: { width: 1 }, ground: "rural", storeys: 1, foot: "medium",
        program: cor([["*", desk({ name: "Front counter" })], [4, chief({ name: "Sergeant's office" })], [3, armory()], [3, evidence()]], [["*", cells()], [6, sally({ name: "Carport" })], [4, squad({ name: "Deputies' room" })]], 4),
        exits: [sallyExit("back", { name: "Carport" }), { side: "left", roles: ["corridor"], chance: 0.4, lock: 0.5 }],
      };
    } },
    { id: "smalltown", name: "Small-town police department", w: W(0.1, 0.6, 1, 0.6), fr: ["sheriff", "precinct", "statepatrol"], make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "police.smalltown");
      const right = rng.chance(0.5);
      const main = ["*", cor([[4, chief()], ["*", desk()], [3, evidence()]], [[3, armory()], ["*", cells()]], 4)];
      const side = [6, Y(["*", squad()], [6, sally()])];
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: n, foot: "medium", stairs: { roles: ["lobby"], n: 1 },
        program: X(...(right ? [main, side] : [side, main])),
        upper: n > 1 ? () => cor([["*", records()], interview(6)], [["*", pbreak()], [4, plockers()], [2, wash()]], 4) : null,
        exits: [sallyExit(right ? "right" : "left"), { side: "back", roles: ["bays", "corridor"], chance: 0.5, lock: 0.5 }],
      };
    } },
    { id: "precinct", name: "City precinct house", w: W(1, 0.4, 0, 0), fr: ["precinct"], make: (rng) => {
      // Three floors round a corridor: the desk sergeant and the cells low, squad rooms and interview rooms above;
      // the sally port behind with two doors (in and out).
      const { bw, bh } = sized(rng, "police.precinct");
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: 3, foot: "large", stairs: ENDS2,
        program: cor([["*", squad({ name: "Detectives' squad" })], [4, plockers()], [6, desk({ name: "Desk sergeant" })], [4, chief({ name: "Captain's office" })], ["*", squad({ name: "Patrol room" })]], [[4, armory()], [3, evidence()], ["*", cells()], [7, sally()]], 5, 2),
        upper: (f) => cor(f === 1 ? [["*", squad()], interview(6), interview(6)] : [["*", briefing()], interview(6), ["*", dispatch()]], [["*", records()], [4, pbreak()], [2, wash()], ["*", squad({ name: "Narcotics" })]], 5, 2),
        exits: [sallyExit("back"), sallyExit("right", { name: "Sally port exit", chance: 0.7 }), ...fire(0.5, 0.5)],
      };
    } },
    { id: "patrol", name: "State patrol post", w: W(0, 0.3, 0.5, 1), fr: ["statepatrol"], make: (rng) => {
      // Long and low by the highway: the garage of patrol cars at one end, the radio room, a short row of cells.
      const { bw, bh } = sized(rng, "police.patrol");
      const left = rng.chance(0.5);
      const garage = [8, Y(["*", sally({ name: "Patrol garage", maxBoxes: 4 })], [4, squad({ name: "Troopers' room" })])];
      const main = ["*", cor([["*", desk({ name: "Public counter" })], [5, dispatch({ name: "Radio room" })], [4, chief({ name: "Post commander" })]], [[3, armory()], [3, evidence()], ["*", cells()]], 4)];
      return {
        bw, bh, front: { width: 2 }, ground: "rural", storeys: 1, foot: "wide",
        program: X(...(left ? [garage, main] : [main, garage])),
        exits: [sallyExit("front", { name: "Garage door", width: 3 }), sallyExit(left ? "left" : "right", { name: "Garage side door", chance: 0.6, width: 1, roller: false }), { side: "back", roles: ["corridor"], chance: 0.4, lock: 0.5 }],
      };
    } },
    { id: "hq", name: "Police headquarters", w: W(1, 0.1, 0, 0), fr: ["precinct"], make: (rng) => {
      // A tower: the public hall, the cells and the sally port low; squad floors, dispatch, the crime lab and the
      // commissioner's floor above.
      const { bw, bh, storeys: n } = sized(rng, "police.hq");
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "tower", stairs: ENDS2,
        program: cor([[3, armory()], ["*", desk({ name: "Public hall" })], [3, evidence()], [4, chief({ name: "Watch commander" })]], [["*", cells()], [6, sally()]], 4, 2),
        upper: (f, r, ctx) => (ctx && ctx.top ? cor([["*", chief({ name: "Commissioner's office" })], ["*", briefing({ name: "Press room" })]], [["*", records()], [4, pbreak()], [2, wash()]], 4, 2)
          : f === 1 ? cor([["*", squad()], interview(6)], [["*", dispatch()], [4, plockers()], [2, wash()]], 4, 2)
            : f === 2 ? cor([["*", { role: "lab", name: "Crime lab", civic: "sciencelab" }], ["*", squad({ name: "Detectives' squad" })]], [["*", records()], [4, pbreak()], [2, wash()]], 4, 2)
              : cor([["*", squad({ name: "Internal affairs" })], ["*", squad()]], [["*", records()], [4, pbreak()], [2, wash()]], 4, 2)),
        exits: [sallyExit("back"), ...fire(0.5, 0.5)],
      };
    } },
    { id: "jail", name: "County sheriff's office and jail", w: W(0.2, 0.4, 0.8, 0.8), fr: ["sheriff"], make: (rng) => {
      // The sheriff's office at the front, booking and the jail's cellblocks behind, the sally port; upstairs more
      // cells round the jailers' post (#31's county jail is the prison's own).
      const { bw, bh } = sized(rng, "police.jail");
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: 2, foot: "large", stairs: ENDS2,
        program: cor([["*", squad({ name: "Deputies' room" })], [4, chief({ name: "Sheriff's office" })], [6, desk({ name: "Public lobby" })], [4, plockers()], [4, armory()], [3, evidence()]], [["*", cells({ name: "Cellblock A" })], [5, { role: "office", name: "Booking", civic: "records" }], ["*", cells({ name: "Cellblock B" })], [7, sally()]], 6, 2),
        upper: () => cor([["*", squad({ name: "Investigations" })], interview(6), ["*", dispatch()]], [["*", cells({ name: "Cellblock C" })], [5, { role: "office", name: "Jailers' post", civic: "records" }], [4, pbreak()], ["*", cells({ name: "Cellblock D" })]], 6, 2),
        exits: [sallyExit("back"), ...fire(0.6, 0.5)],
      };
    } },
    { id: "community", name: "Neighbourhood police office", w: W(1, 0.6, 0.2, 0), fr: ["precinct"], make: (rng) => {
      // A converted shopfront, narrow and deep: the counter at the window, a hall back past the squad room to the
      // cells along the back wall; the garage off the side street.
      const { bw, bh, storeys: n } = sized(rng, "police.community");
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: { roles: ["corridor"], n: 1 },
        program: Y([5, X(["*", desk({ name: "Storefront counter" })], [3, armory()], [3, evidence()])], ["*", X(["*", squad()], [2, { role: "corridor" }], [8, sally({ name: "Side garage" })])], [6, X(["*", cells()], [4, chief({ name: "Sergeant's office" })], [3, wash()])]),
        upper: n > 1 ? () => Y([5, X(["*", records()], [4, pbreak()])], ["*", X(["*", { role: "office", name: "Community room", civic: "briefing" }], [2, { role: "corridor" }], [8, interview(6)[1]])], [6, X(["*", plockers()], [3, wash()])]) : null,
        exits: [sallyExit("right", { name: "Side garage" })],

      };
    } },
    { id: "barracks", name: "Highway patrol barracks", w: W(0, 0.4, 0.6, 0.8), fr: ["statepatrol"], make: (rng) => {
      // The troopers live in: the post below, the dorm, the day room and the kitchen above.
      const { bw, bh } = sized(rng, "police.barracks");
      return {
        bw, bh, front: { width: 2 }, ground: "rural", storeys: 2, foot: "large", stairs: { roles: ["lobby"], n: 1 },
        program: cor([[4, chief({ name: "Barracks commander" })], ["*", desk({ name: "Public counter" })], [5, dispatch({ name: "Radio room" })], ["*", squad({ name: "Troopers' room" })]], [[3, armory()], [3, evidence()], ["*", cells()], [6, sally({ name: "Patrol garage" })]], 5),
        upper: () => cor([["*", { role: "dorm", name: "Troopers' dorm", type: "barracks", civic: "fdorm" }], [5, { role: "dayroom", civic: "fdayroom", hub: false }]], [["*", { role: "kitchen", name: "Barracks kitchen", civic: "fkitchen" }], [4, plockers()], [3, wash()]], 5),
        exits: [sallyExit("right"), { side: "back", roles: ["corridor", "bays"], chance: 0.5, lock: 0.5 }],
      };
    } },
    { id: "townhall", name: "Town hall and police department", w: W(0, 0.4, 1, 0.5), fr: ["sheriff", "precinct"], make: (rng) => {
      // Two halves under one roof: the town clerk and the council chamber on one side, the police on the other.
      const { bw, bh } = sized(rng, "police.townhall");
      const left = rng.chance(0.5);
      const town = [0.42, Y([5, X(["*", { role: "lobby", entry: true, name: "Town clerk", type: "office", civic: "frontdesk" }], [4, { role: "office", name: "Mayor's office", civic: "chief" }])], ["*", { role: "office", name: "Council chamber", civic: "briefing" }], [4, X(["*", records({ name: "Town records" })], [3, wash()])])];
      const pol = ["*", Y([5, X(["*", desk({ role: "foyer", entry: false })], [4, chief()])], ["*", X(["*", squad()], [3, armory()], [3, evidence()])], [6, X(["*", cells()], [6, sally()])])];
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: 2, foot: "large", stairs: { roles: ["lobby"], n: 1 },
        program: X(...(left ? [town, pol] : [pol, town])),
        upper: () => X(...(left ? [[0.42, Y([5, { role: "hall", name: "Landing" }], ["*", { role: "office", name: "Planning office", civic: "records" }])], ["*", Y([5, interview(6)[1]], ["*", pbreak()])]] : [["*", Y([5, interview(6)[1]], ["*", pbreak()])], [0.42, Y([5, { role: "hall", name: "Landing" }], ["*", { role: "office", name: "Planning office", civic: "records" }])]])),
        exits: [{ side: "front", roles: ["foyer"], chance: 1, lock: 0.3, name: "Police entrance" }, sallyExit(left ? "right" : "left"), { side: "back", roles: ["office", "restroom"], chance: 0.5, lock: 0.5 }],
      };
    } },
    { id: "k9", name: "Police station with a K-9 unit", w: W(0.3, 0.8, 0.6, 0.6), fr: ["statepatrol", "sheriff"], make: (rng) => {
      const { bw, bh, storeys: n } = sized(rng, "police.k9");
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "large", stairs: { roles: ["lobby"], n: 1 },
        program: cor([["*", squad()], [6, desk()], [4, chief()], [3, evidence()]], [[3, armory()], ["*", cells()], [5, { role: "storage", name: "K-9 kennels", civic: "kennels", type: "garage" }], [6, sally({ name: "K-9 garage" })]], 5),
        upper: n > 1 ? () => cor([["*", squad({ name: "K-9 unit" })], interview(6)], [["*", records()], [4, pbreak()], [4, plockers()], [2, wash()]], 5) : null,
        exits: [sallyExit("back"), { side: "back", roles: ["storage"], chance: 0.7, lock: 0.4, name: "Dog run gate" }],
      };
    } },
    { id: "courthouse", name: "Old courthouse police station", w: W(0.2, 0.4, 0.9, 0.5), fr: ["sheriff", "precinct", "statepatrol"], make: (rng) => {
      // The old county courthouse: the police below, the courtroom and the judge's chambers upstairs.
      const { bw, bh, storeys: n } = sized(rng, "police.courthouse");
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "large", stairs: ENDS2,
        program: cor([["*", squad()], [4, chief()], [6, desk({ name: "Rotunda" })], [3, armory()], [3, evidence()]], [["*", cells({ name: "Holding cells" })], ["*", plockers()], [7, sally()]], 6, 2),

        upper: (f) => cor(f === 1 ? [["*", { role: "office", name: "Courtroom", civic: "briefing" }], [5, { role: "office", name: "Judge's chambers", civic: "chief" }], ["*", { role: "office", name: "Jury room", civic: "breakroom" }]] : [["*", records({ name: "County records" })], interview(6), ["*", squad({ name: "Detectives' squad" })]], [["*", records({ name: "Court clerk" })], [4, pbreak()], [2, wash()]], 6, 2),
        exits: [sallyExit("back"), ...fire(0.5, 0.6)],
      };
    } },
    // ---------- issue #49 (new worlds only: fresh): the police headquarters with its impound lot (civicsite.js) ----------
    { id: "hqsite", name: "Police headquarters and impound lot", w: W(0.8, 0.2, 0, 0), fr: ["precinct"], fresh: true, make: (rng) => {
      // A city's headquarters: records, the lobby's front desk, dispatch and the desk sergeant along the front; the
      // holding cells, the evidence room, the armory and the sally port behind; the squads, interview rooms, the
      // forensics lab and narcotics above, the chief and the command centre on top. Its impound lot and the staff lot
      // beside it (civicsite.js).
      const { bw, bh, storeys: n } = sized(rng, "police.hqsite");
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: ENDS2, civicSite: "policehq",
        program: cor([[4, records()], ["*", desk({ name: "Headquarters lobby" })], [4, dispatch()], [4, chief({ name: "Desk sergeant" })]], [["*", cells({ name: "Holding cells" })], [4, evidence()], [3, armory()], [6, sally()]], 5, 2),
        upper: (f, r, ctx) => (ctx && ctx.top ? cor([["*", chief({ name: "Chief of police" })], ["*", briefing({ name: "Command centre" })]], [["*", records({ name: "Archives" })], [4, pbreak()], [2, wash()]], 5, 2)
          : f === 1 ? cor([["*", squad()], interview(6), [4, plockers()]], [["*", squad({ name: "Patrol squad room" })], [4, pbreak()], [2, wash()]], 5, 2)
            : cor([["*", squad({ name: "Detectives' squad" })], ["*", { role: "lab", name: "Forensics lab", civic: "sciencelab" }]], [["*", squad({ name: "Narcotics unit" })], [4, evidence({ name: "Evidence store" })], [2, wash()]], 5, 2)),
        exits: [sallyExit("back"), ...fire(0.5, 0.6)],
      };
    } },
  ],

  // ---------- fire stations: the engine bay behind its bay door, the dorm and the kitchen in every plan ----------
  firestation: [
    { id: "general", name: "Fire station", w: W(0.8, 1, 0.8, 0.3), fr: ["engine7", "countyfire"], make: (rng, o, K) => K.classic() }, // #15's plan
    { id: "volunteer", name: "Volunteer fire hall", w: W(0, 0.3, 0.8, 1), fr: ["volunteer"], make: (rng) => {
      // One storey: the bays, the meeting hall (suppers, the auxiliary), the kitchen, a bunk room for a night shift.
      const { bw, bh } = sized(rng, "firestation.volunteer");
      const left = rng.chance(0.5);
      const bays = [0.45, bay()];
      const rest = ["*", Y(["*", fday({ name: "Meeting hall", entry: true })], [5, X(["*", fkitchen()], [4, fdorm({ name: "Bunk room" })], [3, fbath()])])];
      return {
        bw, bh, front: { width: 1 }, ground: "rural", storeys: 1, foot: "medium",
        program: X(...(left ? [bays, rest] : [rest, bays])),
        exits: [bayDoor(), { side: "back", roles: ["kitchen", "bays"], chance: 0.6, lock: 0.3 }],
      };
    } },
    { id: "twobay", name: "Two-bay station", w: W(0.4, 1, 0.6, 0.2), fr: ["countyfire", "engine7"], make: (rng) => {
      // Two bays of their own either side of the day room, the quarters above.
      const { bw, bh } = sized(rng, "firestation.twobay");
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: 2, foot: "large", stairs: { roles: ["dayroom"], n: 1 },
        program: X([0.32, bay()], ["*", Y(["*", fday({ entry: true })], [5, X(["*", fkitchen()], [4, medstore()])])], [0.32, bay({ name: "Truck bay" })]),
        upper: () => X([0.32, fdorm()], ["*", Y(["*", fday({ name: "Lounge" })], [5, X(["*", watch()], [3, fbath()])])], [0.32, fgym()]),
        exits: [bayDoor(), bayDoor("front", { name: "Bay door" }), { side: "back", roles: ["kitchen", "storage"], chance: 0.6, lock: 0.3 }],
      };
    } },
    { id: "tower", name: "Fire station with a training tower", w: W(0.6, 0.8, 0.3, 0), fr: ["engine7", "countyfire"], make: (rng) => {
      // A big one-storey station: three bays' worth of floor, the quarters behind the day room, the drill tower at the
      // end raised a level (the loft mechanic: a ladder up, as a church's bell tower).
      const { bw, bh } = sized(rng, "firestation.tower");
      return {
        bw, bh, front: { width: 1 }, ground: "lot", storeys: 1, foot: "wide", loft: { roles: ["storage"], chance: 1, ladder: true },
        program: X([0.34, bay()], ["*", Y(["*", X(["*", fday({ entry: true })], [4, watch()], [3, fbath()])], ["*", X(["*", fdorm()], [4, fkitchen()], [4, fgym()])])], [6, Y([4, medstore({ role: "dispensary", type: "nurse" })], ["*", { role: "storage", name: "Training tower", type: "enginebay" }], [4, fshop()])]),
        exits: [bayDoor(), { side: "back", roles: ["bays"], chance: 0.8, roller: true, width: 3, lock: 0.3, name: "Rear bay door" }, { side: "right", roles: ["workshop", "storage"], chance: 0.6, lock: 0.3 }],
      };
    } },
    { id: "airport", name: "Airport crash station", w: W(0.1, 0.1, 0, 0.05, { airport: 1 })
, fr: ["countyfire", "engine7"], make: (rng) => {
      // Wide bays for the crash tenders (two engines), the watch room up in the tower over the quarters (#25's airport
      // can pin this plan: o.plan "airport").
      const { bw, bh } = sized(rng, "firestation.airport");
      return {
        bw, bh, front: { width: 1 }, ground: "lot", storeys: 2, foot: "wide", stairs: { roles: ["dayroom"], n: 1 },
        program: X([0.6, Y(["*", bay({ name: "Crash tender bay" })])], ["*", Y(["*", fday({ entry: true, name: "Ready room" })], [5, X(["*", fkitchen()], [4, medstore()])], [4, X(["*", fdorm()], [3, fbath()])])]),
        upper: () => X([0.6, Y(["*", { role: "storage", name: "Foam store", type: "enginebay" }])], ["*", Y(["*", watch({ name: "Watch room" })], [5, X(["*", fgym()], [4, fdorm({ name: "Crew dorm" })])], [4, X(["*", { role: "office", type: "office" }], [3, fbath()])])]),
        exits: [bayDoor("front", { width: 4 }), { side: "back", roles: ["bays"], chance: 1, roller: true, width: 4, lock: 0.1, name: "Airside door" }],
      };
    } },
    { id: "hq", name: "Fire headquarters", w: W(1, 0.3, 0, 0), fr: ["engine7"], make: (rng) => {
      const { bw, bh } = sized(rng, "firestation.hq");
      return {
        bw, bh, front: { width: 1 }, ground: "city", storeys: 3, foot: "large", stairs: { roles: ["lobby", "dayroom"], n: 1 },
        program: X([0.45, bay()], ["*", Y([5, X(["*", { role: "lobby", entry: true, name: "Public lobby", type: "office", civic: "frontdesk" }], [4, { role: "office", name: "Fire marshal", civic: "chief" }])], ["*", fday()], [5, X(["*", fkitchen()], [4, medstore()], [4, fshop()])])]),
        upper: (f) => (f === 1 ? X([0.45, fdorm()], ["*", Y([5, X(["*", watch()], [3, fbath()])], ["*", fgym()])]) : X([0.45, { role: "storage", name: "Turnout and hose store", type: "enginebay" }], ["*", Y([5, X(["*", { role: "office", name: "Chief's office", civic: "chief" }], [3, fbath()])], ["*", X(["*", { role: "office", name: "Dispatch centre", civic: "dispatch" }], ["*", { role: "office", name: "Training room", civic: "briefing" }])])])),
        exits: [bayDoor(), { side: "back", roles: ["bays"], chance: 0.7, roller: true, width: 2, lock: 0.3 }, { side: "back", roles: ["kitchen", "workshop"], chance: 0.6, lock: 0.3 }],
      };
    } },
    { id: "brush", name: "Rural brush station", w: W(0, 0, 0.3, 1), fr: ["volunteer", "countyfire"], make: (rng) => {
      const { bw, bh } = sized(rng, "firestation.brush");
      return {
        bw, bh, front: { width: 1 }, ground: "rural", storeys: 1, foot: "medium",
        program: X([0.55, bay({ name: "Brush truck bay" })], ["*", Y(["*", fday({ entry: true, name: "Crew room" })], [4, X(["*", fkitchen()], ["*", fdorm({ name: "Bunk room" })])])]),
        exits: [bayDoor(), { side: "back", roles: ["dorm", "bays"], chance: 0.5, lock: 0.3 }],
      };
    } },
    { id: "firehouse", name: "Historic firehouse", w: W(1, 0.4, 0.4, 0), fr: ["engine7"], make: (rng) => {
      // Narrow and tall: the apparatus floor the whole front, the kitchen behind; the company's floors above.
      const { bw, bh, storeys: n } = sized(rng, "firestation.firehouse");
      return {
        bw, bh, front: { width: 1 }, ground: "city", storeys: n, foot: "medium", stairs: { roles: ["kitchen", "workshop"], n: 1 },
        program: Y([11, bay({ name: "Apparatus floor" })], ["*", X(["*", fkitchen({ entry: true })], [4, Y(["*", fshop()], [3, fbath()])])]),
        upper: (f, r, ctx) => (f === 1 ? Y([11, fdorm()], ["*", X(["*", fday()], [4, Y(["*", watch({ name: "Captain's office" })], [3, fbath()])])]) : Y([11, fgym()], ["*", X(["*", { role: "storage", name: "Hose store", type: "enginebay" }], [4, medstore()])])),
        exits: [bayDoor(), { side: "back", roles: ["kitchen", "workshop"], chance: 0.7, lock: 0.3 }],
      };
    } },
    { id: "drive", name: "Drive-through station", w: W(0.3, 1, 0.8, 0.3), fr: ["countyfire"], make: (rng) => {
      // The bay runs front to back with a door at each end (the engines never back in); the quarters beside it.
      const { bw, bh, storeys: n } = sized(rng, "firestation.drive");
      const right = rng.chance(0.5);
      const bays = [0.45, bay({ name: "Drive-through bay" })];
      const rest = ["*", Y(["*", fday({ entry: true })], [5, X(["*", fkitchen()], [4, medstore()])], [5, X(["*", fdorm()], [3, fbath()])])];
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: n, foot: "large", stairs: { roles: ["dayroom"], n: 1 },
        program: X(...(right ? [rest, bays] : [bays, rest])),
        upper: n > 1 ? () => X(...(right ? [["*", Y(["*", fgym()], [5, watch()])], [0.45, { role: "storage", name: "Mezzanine store", type: "enginebay" }]] : [[0.45, { role: "storage", name: "Mezzanine store", type: "enginebay" }], ["*", Y(["*", fgym()], [5, watch()])]])) : null,
        exits: [bayDoor(), { side: "back", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.1, name: "Rear bay door" }, { side: right ? "left" : "right", roles: ["dayroom", "dorm"], chance: 0.5, lock: 0.3 }],
      };
    } },
    { id: "rescue", name: "Fire and rescue station", w: W(0.5, 0.8, 0.6, 0.3), fr: ["countyfire", "engine7", "volunteer"], make: (rng) => {
      // The engine bay and a rescue bay (an engine and, half the time, an ambulance), the EMS quarters between them.
      const { bw, bh } = sized(rng, "firestation.rescue");
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: 2, foot: "wide", stairs: { roles: ["dayroom"], n: 1 },
        program: X([0.36, bay()], ["*", Y(["*", fday({ entry: true })], [5, X(["*", fkitchen()], [4, medstore({ name: "EMS supply" })])])], [0.3, bay({ name: "Rescue bay" })]),
        upper: () => X([0.36, fdorm()], ["*", Y(["*", fgym()], [5, X(["*", watch()], [3, fbath()])])], [0.3, fdorm({ name: "EMS dorm" })]),
        exits: [bayDoor(), bayDoor("front", { name: "Bay door" }), { side: "back", roles: ["kitchen", "bath"], chance: 0.6, lock: 0.3 }],
      };
    } },
    { id: "academy", name: "Fire training academy", w: W(0.3, 0.6, 0.4, 0.4), fr: ["engine7", "countyfire"], make: (rng) => {
      // Classrooms and a drill hall beside the bays; the smoke tower raised a level (a ladder up).
      const { bw, bh } = sized(rng, "firestation.academy");
      return {
        bw, bh, front: { width: 2 }, ground: "lot", storeys: 1, foot: "wide", loft: { roles: ["storage"], chance: 1, ladder: true },
        program: X([0.3, bay({ name: "Apparatus bay" })], ["*", cor([["*", { role: "classroom", name: "Classroom", civic: "briefing" }], [5, { role: "lobby", entry: true, name: "Academy office", type: "office", civic: "frontdesk" }], ["*", { role: "classroom", name: "Classroom", civic: "briefing" }]], [["*", fdorm({ name: "Recruits' dorm" })], [4, fkitchen()], [4, fgym({ name: "Drill hall" })]], 5)], [5, Y(["*", { role: "storage", name: "Smoke tower", type: "enginebay" }], [4, medstore({ role: "dispensary", type: "nurse" })], [3, fbath()])]),
        exits: [bayDoor(), { side: "back", roles: ["bays"], chance: 0.7, roller: true, width: 3, lock: 0.3, name: "Drill yard door" }, { side: "right", roles: ["storage", "bath"], chance: 0.5, lock: 0.3 }],
      };
    } },
    { id: "county", name: "County fire and rescue", w: W(0.2, 0.6, 0.8, 0.8), fr: ["countyfire", "volunteer"], make: (rng) => {
      // The bays along one side with their doors in the side wall (the apron beside the building), the offices at the
      // front, the quarters at the back.
      const { bw, bh } = sized(rng, "firestation.county");
      const left = rng.chance(0.5);
      const bays = [0.42, Y(["*", bay()], [5, fshop()])];
      const rest = ["*", Y([5, X(["*", { role: "lobby", entry: true, name: "Station office", type: "office", civic: "frontdesk" }], [4, watch()])], ["*", X(["*", fday()], [4, fkitchen()])], [5, X(["*", fdorm()], [4, medstore()], [3, fbath()])])];
      return {
        bw, bh, front: { width: 1 }, ground: "rural", storeys: 1, foot: "large",
        program: X(...(left ? [bays, rest] : [rest, bays])),
        exits: [bayDoor(left ? "left" : "right"), { side: "front", roles: ["bays"], chance: 0.5, roller: true, width: 3, lock: 0.2, name: "Front bay door" }, { side: "back", roles: ["dorm", "workshop"], chance: 0.6, lock: 0.3 }],
      };
    } },
    // ---------- issue #49 (new worlds only: fresh): the fire headquarters on its training ground (civicsite.js) ----------
    { id: "hqsite", name: "Fire headquarters and training ground", w: W(0.8, 0.2, 0, 0), fr: ["engine7", "countyfire"], fresh: true, make: (rng) => {
      // The city's headquarters station: the engine bay and the ladder bay side by side along the front, each behind its
      // own roller door and through to a rear door, the lobby, the watch office, the day room and the kitchen beside
      // them; the dorm and the gym over the bays, the fire prevention bureau, dispatch and the chief's office on top. Its
      // training ground round it (civicsite.js): the drill tower, the drill yard, the staff lot.
      const { bw, bh } = sized(rng, "firestation.hqsite");
      return {
        bw, bh, front: { width: 1 }, ground: "city", storeys: 3, foot: "large", stairs: { roles: ["lobby", "dayroom"], n: 1 }, civicSite: "firehq",
        program: X([0.28, bay()], [0.28, bay({ name: "Ladder bay" })], ["*", Y([5, X(["*", { role: "lobby", entry: true, name: "Headquarters lobby", type: "office", civic: "frontdesk" }], [4, watch()])], ["*", fday()], [5, X(["*", fkitchen()], [4, medstore()])])]),
        upper: (f) => (f === 1 ? X([0.56, fdorm()], ["*", Y(["*", fgym()], [4, X(["*", fbath()], ["*", fshop()])])])
          : X([0.3, { role: "office", name: "Fire prevention bureau", civic: "chief" }], [0.26, { role: "office", name: "Dispatch centre", civic: "dispatch" }], ["*", Y(["*", { role: "office", name: "Chief's office", civic: "chief" }], [4, fbath()])])),
        exits: [bayDoor(), bayDoor("front", { name: "Ladder bay door" }), { side: "back", roles: ["bays"], chance: 0.8, roller: true, width: 3, lock: 0.3, name: "Rear bay door" }, { side: "back", roles: ["kitchen"], chance: 0.6, lock: 0.3 }],
      };
    } },
  ],
};
// The buildings of #49's multi-building sites (civicsite.js) besides the main one and the other kinds' own plans: each
// a spec as the plans above (drawn in metres, a cell 1 m), built and placed by civicsite.js. ER: a medical centre's
// emergency department (one storey: the ambulance entrance and bay at the back, its ambulances on the apron outside);
// hall: a churchyard's parish hall; impound: a police impound lot's office; drilltower: a fire training ground's drill
// tower (five storeys of bare drill floors up its stair: the tall rule builds four).
export const SITE_PLANS = {
  er: (rng) => ({
    bw: rng.int(30, 36), bh: rng.int(20, 23), front: { width: 2 }, ground: "city", storeys: 1, foot: "large",
    program: cor([[7, waiting({ name: "Emergency entrance" })], ["*", er({ name: "Emergency department" })], [6, { role: "office", name: "Triage", type: "clinic" }], [4, cupboard({ name: "Crash cart store" })]],
      [[8, { role: "ambbay" }], [6, { role: "bath", name: "Decontamination", type: null, civic: "washroom" }], ["*", er({ name: "Resuscitation bays" })], [5, supply(0.3)], [3, "restroom"]], 6, 2),
    exits: [{ side: "back", roles: ["ambbay"], chance: 1, lock: 0.2, roller: true, width: 2, name: "Ambulance bay" }, ...fire(0.3, 0.6)],
  }),
  hall: (rng) => ({
    bw: rng.int(16, 20), bh: rng.int(13, 15), front: { width: 1 }, ground: "rural", storeys: 1, foot: "medium",
    program: Y([3, X(["*", { role: "foyer", name: "Hall porch", entry: true, type: "chapel", civic: "narthex" }], [4, wash()])], ["*", hall()], [4, X(["*", cpantry()], ["*", sunday()])]),
    exits: [{ side: "back", roles: ["pantry", "classroom"], chance: 0.6, lock: 0.3 }],
  }),
  impound: (rng) => ({
    bw: rng.int(10, 12), bh: rng.int(8, 9), front: { width: 1 }, ground: "city", storeys: 1, foot: "small",
    program: Y(["*", X(["*", { role: "lobby", entry: true, name: "Impound office", type: "office", civic: "frontdesk" }], [4, records({ name: "Release desk" })])], [3, X(["*", evidence({ name: "Property cage" })], [3, wash()])]),
    exits: [{ side: "back", roles: ["evidence", "restroom"], chance: 0.5, lock: 0.4 }],
  }),
  drilltower: (rng) => ({
    bw: rng.int(9, 10), bh: rng.int(9, 10), front: { width: 1 }, ground: "city", storeys: 5, foot: "small", stairs: { roles: ["lobby", "storage"], n: 1 },
    program: Y(["*", { role: "lobby", entry: true, name: "Tower base", type: "enginebay", civic: "fdayroom" }], [3, { role: "storage", name: "Hose store", type: "enginebay" }]),
    upper: () => Y(["*", { role: "storage", name: "Drill floor", type: "enginebay" }]),
    exits: [{ side: "back", roles: ["storage", "lobby"], chance: 0.7, lock: 0.2 }],
  }),
};
export const VARIANT_KINDS = Object.keys(VARIANTS);
/** The kind's plans: [{ id, name }]. @param {string} kind */
export const variantNames = (kind) => (VARIANTS[kind] || []).map((v) => ({ id: v.id, name: v.name }));

// ======================================================================================
// Which plan a building gets
// ======================================================================================
/**
 * The kind's plan for this building: o.plan pins one by its id; else one draw of the dice, weighted by the site's
 * weight (o.site), else the setting's (o.setting; town when unknown), among the plans the franchise maps to (o.variant;
 * all of them when it maps to none). Always one draw, pinned or not, so the rest of the plan rolls the same way.
 * @param {string} kind @param {any} rng @param {any} [o]
 */
export function pickVariant(kind, rng, o = {}) {
  // variantpick.js (issue #41): "civic:<kind>", the dice drawn first (r: one rng.next(), pinned or not), a franchise's
  // plans at least 0.05. A world made since issue #49 (o.civicReal): every plan, the new ones too (fresh), narrowed to
  // the size class #42's placement table gives the kind on the building's tile class (sizeOn: a city centre's huge
  // medical centre, a town's large county hospital, a country clinic's small one); a site some plans name (a prison's
  // infirmary, an airport's crash station) keeps its own plans, whatever their size. An older save's (or a building
  // made outside a world: the tests', a campus's): only the plans before #49 (FRESH out of the pool: the same weights
  // and walk, so the same picks).
  const real = !!o.civicReal, site = o.site || null;
  const named = !!site && (VARIANTS[kind] || []).some((v) => v.w && v.w[site] != null);
  const size = real && !named ? sizeOn(kind, o.tileClass) : null;
  const e = pickRegistered(`civic:${kind}`, rng, { plan: typeof o.plan === "string" ? o.plan : null, franchise: o.variant || null, site, setting: o.setting || "town", r: rng.next(), ...(real ? {} : { only: OLD }), ...(size ? { size } : {}) });
  return e ? /** @type {any} */ (e).src : null;
}
/** @param {any} e */
const OLD = (e) => !e.src.fresh;
// The size class a kind's plan takes on a tile class (data-placement.js PLACEMENT: its row's letter there), null for a
// kind that stands only as part of a site (an infirmary: "of prison") or a tile class its row does not name.
/** @param {string} kind @param {string | null | undefined} cls @returns {string | null} */
export const sizeOn = (kind, cls) => { const P = PLACEMENT[kind]; return P && !P.of && cls ? P.size[cls] || null : null; };
// Each plan's size class (#42's small, medium, large, huge: placement.js SIZE_CLASSES; the picker's ctx.size), by its
// real size (data-buildingsize.js CIVIC_REAL, floor area) and where it belongs: a downtown medical centre huge, a
// town's county hospital large, a country clinic small. S small, M medium, L large, H huge.
const SZ = {
  hospital: { general: "H", critical: "M", tower: "L", children: "L", psych: "L", va: "H", trauma: "H", pavilion: "L", teaching: "H", cottage: "M", surgical: "L", nursing: "L", regional: "H", county: "L", medcampus: "H" },
  infirmary: { general: "M", prison: "M", prisonhosp: "M", jail: "S", camp: "S", campus: "M", field: "M", aid: "M", company: "S", boarding: "S", quarantine: "M", shelter: "M" },
  clinic: { general: "M", urgent: "M", family: "S", dialysis: "M", dental: "S", stripmall: "M", occhealth: "M", free: "M", multi: "M", paediatric: "S", rural: "S", surgery: "M" },
  vet: { general: "S", country: "M", farm: "M", emergency: "M", shelter: "M", boarding: "S", equine: "M", storefront: "S", specialty: "M", exotic: "S", cat: "S", teaching: "M" },
  church: { general: "M", chapel: "S", brick: "M", mega: "L", cathedral: "L", storefront: "M", rectory: "M", country: "S", cruciform: "L", mission: "M", school: "M", meeting: "S", churchyard: "S" },
  police: { general: "M", substation: "S", smalltown: "S", precinct: "M", patrol: "S", hq: "L", jail: "M", community: "M", barracks: "S", townhall: "S", k9: "M", courthouse: "S", hqsite: "L" },
  firestation: { general: "M", volunteer: "S", twobay: "S", tower: "M", airport: "M", hq: "L", brush: "S", firehouse: "M", drive: "M", rescue: "M", academy: "M", county: "S", hqsite: "L" },
};
const SIZE_OF = { S: "small", M: "medium", L: "large", H: "huge" };
// The registry's views (variantpick.js): each kind's plans, their weights by setting and site, their franchises, their
// size classes (#49) and whether they are new (fresh: a world made since #49 only).
for (const kind of Object.keys(VARIANTS)) registerVariants(`civic:${kind}`, VARIANTS[kind].map((v) => ({ id: v.id, name: v.name, w: { ...(v.w || {}) }, ...(v.fr ? { fr: v.fr } : {}), sizeClass: SIZE_OF[SZ[kind][v.id]], ...(v.fresh ? { fresh: true } : {}), src: v })), { frMin: 0.05 });
/**
 * The spec of a new save's building of a kind with plans here: the plan pickVariant gives, built; K.classic() the
 * kind's plan before this ticket (#14's or #15's, buildingmaps.js). The spec carries vid and vname.
 * @param {string} kind @param {any} rng @param {any} o @param {{ classic: () => any }} K
 */
export function variantSpec(kind, rng, o, K) {
  const v = pickVariant(kind, rng, o);
  if (!v) return K.classic();
  // A world made since issue #49: a named plan drawn with its sizes row's storeys (REAL, sized) and laid out at its
  // footprint by realScale (realSize: the row; vscale: its storeys its own); the general plan as before, through its
  // kind's row (its sizes row is the kind's own).
  const scaled = !!o.civicReal && v.id !== "general";
  REAL = scaled ? { setting: o.setting || "town" } : null;
  let spec;
  try { spec = v.make(rng, o, K); } finally { REAL = null; }
  return { ...spec, vid: v.id, vname: v.name, ...(o.civicReal ? { realSize: v.id } : {}), ...(scaled ? { vscale: true } : {}) };
}
