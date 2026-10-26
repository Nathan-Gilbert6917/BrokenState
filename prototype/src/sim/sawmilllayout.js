// @ts-check
// Sawmills and lumber yards (issue #53 of the round-2 epic #39, the user's request 2026-10-26: "saw mill"): a building
// type of its own, `sawmill` (buildingmaps.js BUILDINGS.sawmill), with thirteen plans. #37's factory kept its one
// sawmill plan (industrylayout.js INDUSTRY_PLANS.factory "sawmill"); this module is the type.
//
// The plans (SAWMILL_PLANS: id, name, the tile classes they favour, their rooms; sizes in metres, a cell a metre, from
// data-buildingsize.js REAL_SIZE.sawmill.sizes):
//   family      a small family sawmill: the saw shed's headsaw and carriage, the filing room, the office, a lumber shed;
//   industrial  a big industrial mill: a saw house of two storeys (the head rig and carriage, the edger and trimmer, the
//               green chain; the filing room and the sawyer's booth upstairs) on a yard of its own (millYardMap, laid
//               out with compound.js): the log yard and log deck, the dry kilns, the boiler house and its burner, the
//               planer shed, two lumber sheds, the mill office, log trucks;
//   planing     a planing mill: the rough-lumber shed, the planer hall, the grading table, a dry kiln, the knife room;
//   lumberyard  a lumber yard with sheds: the yard office and its counter, a drive-through lumber shed, the sheet-goods
//               shed, the stacks outside;
//   pallet      a pallet plant: the cut-up room's resaws, the nailing line, the heat-treat kiln, the repair bay;
//   shingle     a shingle mill: the bolt room, the shingle saw room, packing and bundles;
//   portable    a portable bandsaw mill in the woods: a lean-to over the bandsaw, a tool shed, a fuel shed, log piles;
//   watermill   a historic water-powered mill of two or three storeys: the wheel pit and gear room, the sash-saw floor,
//               the timber loft and the miller's room up the stairs;
//   treated     a treated-timber yard: the treating plant's retort, the preservative store, the treated-lumber shed;
//   logsort     a log sort yard: the scale house, the loader shop, the fuel shed, the log decks;
//   millwork    a millwork shop in town: the machine room, the finishing room, the showroom, the lumber loft above;
//   framer      a timber framer's barn: the framing floor, the tool room, the office, the timber loft;
//   kilnmill    a sawmill with dry kilns: the saw hall, the green chain, the dry kilns, the boiler and burner room.
//
// The rooms (SAWMILL_ROLES, merged into buildingmaps.js ROLES) keep the loot tables a sawmill would really hold
// (combat.js AREAS): the saw floor and the filing room a workshop's (scrap, parts), the green chain, the kilns and the
// sheds a hardware store's lumber (wood, building materials), the boiler house a garage's (fuel, parts). Their pieces
// (SAWMILL_STYLES, by the room's ind mark, as industrylayout.js's): the headsaw, the edger, conveyors, stacked lumber,
// saw-blade racks (saws: combat.js BOX_LOOT bladerack), a kiln door, a burner; outside, log piles and lumber stacks.
//
// Which plan: the building's own dice (hash dice, never consumed) through the shared picker (variantpick.js
// pickVariant, #41) weighted by the tile's class (#42's placement.js: scenic forest and hills most of all, then the
// country, the coast, the roads; the lumber yard and the millwork shop in towns). The placement row's size class is
// not passed: every class holds small and large mills (a portable mill and the industrial mill are both forest
// sawmills), so the class's weights pick the scale. opts.plan pins one. An older save never had one (placement.js
// adds them to new worlds only); its building is the factory's classic plan.
import { REAL_SIZE } from "./data-buildingsize.js";
import { registerVariants, pickVariant } from "./variantpick.js"; // the shared picker (issue #41)
import { registerScene } from "./interiorscenes.js";
import { compoundGrid, placeBuilding, guard, compoundResult, compoundVehicle } from "./compound.js";
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";

export const SAWMILL = {
  // The containers a plan's rooms hold: each room's share × this (spec.boxScale), tuned with tools/lootsensetest.js and
  // tools/sawmilltest.js so a mill holds about what a factory or a hardware store does an area.
  LOOT: { family: 0.8, industrial: 2, planing: 1.4, lumberyard: 0.75, pallet: 1.5, shingle: 0.8, portable: 0.6, watermill: 0.75, treated: 1.5, logsort: 0.85, millwork: 1.2, framer: 1.5, kilnmill: 1.8 },
  YARD: { logs: [3, 6], stacks: [2, 4], bigLogs: [8, 12] }, // the pieces outside a plan's building (spec.yardPieces)
  // The industrial mill's yard (millYardMap): its edge, the log yard's width, the gaps between buildings, the log
  // piles and lumber stacks in their rows, the log trucks.
  MILL: { EDGE: 6, LOGYARD: [26, 34], GAP: [7, 10], LOGROWS: 3, STACKS: [10, 16], TRUCKS: [1, 3], CAP: 300 },
};

// ---------- the rooms only these buildings have (merged into buildingmaps.js ROLES) ----------
const role = (name, type, furnish, extra = {}) => ({ name, type, furnish, ...extra });
export const SAWMILL_ROLES = {
  millsaw:    role("Saw floor", "workshop", "machines", { hub: true, fl: "plank", maxBoxes: 4 }),
  millchain:  role("Green chain", "hardware", "racks", { fl: "plank", maxBoxes: 4 }),
  millkiln:   role("Dry kiln", "hardware", "racks", { fl: "conc", windows: false, maxBoxes: 3, dk: "steel" }),
  millplaner: role("Planer shed", "hardware", "machines", { hub: true, fl: "conc", maxBoxes: 5 }),
  millfiling: role("Filing room", "workshop", "workbench", { fl: "plank", maxBoxes: 3 }),
  millboiler: role("Boiler house", "garage", "machines", { fl: "conc", windows: false, maxBoxes: 3 }),
  millshed:   role("Lumber shed", "hardware", "racks", { hub: true, fl: "dirt", maxBoxes: 8 }),
};

// ---------- the plans ----------
const X = (...parts) => ({ split: "x", parts });
const Y = (...parts) => ({ split: "y", parts });
/** A room: its role (buildingmaps.js ROLES), its style's mark (SAWMILL_STYLES) and the rest. */
const R = (role, ind, o = {}) => ({ role, ind, ...o });
const roll = (rng, r) => rng.int(r[0], r[1]);
/** A plan's size: its REAL_SIZE row's (data-buildingsize.js REAL_SIZE.sawmill.sizes). @param {any} rng @param {string} id */
const size = (rng, id) => { const S = REAL_SIZE.sawmill.sizes[id]; return { bw: roll(rng, S.w), bh: roll(rng, S.d), storeys: roll(rng, S.storeys) }; };
// The footprint's class (tools/storeytest.js FOOT): small up to 190 cells, medium to 360, large past it (a map of 48 × 36
// at most), xl from 700 cells 30 across (the map its footprint and margins).
const footOf = (s) => { const a = s.bw * s.bh; return a >= 700 && s.bw >= 30 ? "xl" : a > 360 ? "large" : a <= 190 ? "small" : "medium"; };
const OFFICE = (name = "Mill office", o = {}) => R("office", "millofc", { name, entry: true, hub: true, ...o });
const saw = (name, o = {}) => R("millsaw", "millsaw", { name, ...o });
const chain = (name = "Green chain", o = {}) => R("millchain", "millchain", { name, ...o });
const kiln = (name = "Dry kiln", o = {}) => R("millkiln", "millkiln", { name, ...o });
const planer = (name = "Planer shed", o = {}) => R("millplaner", "millplaner", { name, ...o });
const filing = (name = "Filing room", o = {}) => R("millfiling", "millfiling", { name, ...o });
const boiler = (name = "Boiler house", o = {}) => R("millboiler", "millboiler", { name, ...o });
const shed = (name = "Lumber shed", o = {}) => R("millshed", "millshed", { name, ...o });
const roller = (side, roles, o = {}) => ({ side, roles, chance: 1, roller: true, width: 3, lock: 0.25, ...o });
const door = (side, roles, chance = 0.6, lock = 0.35) => ({ side, roles, chance, lock });
const yard = (logs, stacks, name = "Log deck") => ({ name, type: "hardware", pieces: [["logpile", logs], ["lumberstack", stacks]], loot: true });

/** @typedef {{ id: string, name: string, w: Record<string, number>, make: (rng: any, o: any) => any }} SawmillPlan */
/** @type {SawmillPlan[]} */
export const SAWMILL_PLANS = [
  { id: "family", name: "Family sawmill", w: { scenic: 3, rural: 3, coast: 2, highway: 1, town: 1, any: 0.5 }, make: (rng) => {
    const s = size(rng, "family");
    return {
      ...s, front: { width: 1 }, ground: "rural", foot: footOf(s), yardPieces: yard(SAWMILL.YARD.logs, SAWMILL.YARD.stacks),
      program: X([6, Y([5, OFFICE("Mill office")], ["*", filing()])], ["*", saw("Saw shed", { hub: true })], [7, shed()]),
      exits: [roller("right", ["millshed"], { name: "Shed door", chance: 0.8 }), roller("back", ["millsaw"], { name: "Log door" })],
    };
  } },
  { id: "industrial", name: "Industrial sawmill", w: { scenic: 2, rural: 1.2, coast: 1.5, highway: 1, town: 0.3, any: 0.2 }, make: (rng) => {
    const s = size(rng, "industrial");
    return {
      ...s, front: { width: 2 }, ground: "lot", foot: footOf(s), millYard: true, stairs: { roles: ["corridor"], n: 1 },
      program: Y([6, X([9, OFFICE("Sawyer's office")], [3, R("corridor", null, { name: "Stair hall" })], ["*", chain()], [5, R("restroom")])],
        ["*", X(["*", saw("Head rig and carriage", { hub: true })], [12, saw("Edger and trimmer")])]),
      upper: () => Y([6, X([9, R("office", "millofc", { name: "Sawyer's booth" })], [3, R("corridor", null, { name: "Stair hall" })], ["*", R("breakroom")])], ["*", filing("Filing room")]),
      exits: [roller("back", ["millsaw"], { name: "Log infeed" }), roller("right", ["millsaw"], { name: "Trimmer door", chance: 0.8 }), door("left", ["millchain", "office"], 0.7, 0.3)],
    };
  } },
  { id: "planing", name: "Planing mill", w: { scenic: 1, rural: 1, coast: 1, highway: 1, town: 1.2, suburb: 1, any: 0.5 }, make: (rng) => {
    const s = size(rng, "planing");
    return {
      ...s, front: { width: 1 }, ground: "lot", foot: footOf(s), yardPieces: yard([1, 2], SAWMILL.YARD.stacks, "Lumber stacks"),
      program: X([8, Y([5, OFFICE("Mill office")], ["*", filing("Knife room")])], ["*", Y([5, chain("Grading table")], ["*", planer("Planer hall", { hub: true })])], [9, Y(["*", kiln()], [6, shed("Rough-lumber shed")])]),
      exits: [roller("right", ["millshed"], { name: "Rough-lumber door" }), roller("back", ["millplaner"], { name: "Loading door", chance: 0.7 })],
    };
  } },
  { id: "lumberyard", name: "Lumber yard with sheds", w: { town: 3, suburb: 2.5, city: 1.5, highway: 1.5, rural: 1, scenic: 0.6, any: 1 }, make: (rng) => {
    const s = size(rng, "lumberyard");
    return {
      ...s, front: { width: 2 }, ground: "lot", foot: footOf(s), yardPieces: yard([0, 1], [4, 7], "Lumber stacks"),
      program: X([9, Y([6, R("office", "millcounter", { name: "Yard office and counter", entry: true, hub: true, type: "hardware" })], ["*", R("storage", "millstore", { name: "Hardware store room", type: "hardware" })])],
        ["*", shed("Drive-through lumber shed")], [8, shed("Sheet-goods shed")]),
      exits: [roller("left", ["millshed"], { name: "Drive-through" }), roller("right", ["millshed"], { name: "Drive-through" }), roller("back", ["millshed"], { name: "Shed door", chance: 0.5 })],
    };
  } },
  { id: "pallet", name: "Pallet plant", w: { suburb: 2, town: 2, highway: 1.5, city: 1, rural: 1, scenic: 0.5, any: 0.6 }, make: (rng) => {
    const s = size(rng, "pallet");
    return {
      ...s, front: { width: 1 }, ground: "lot", foot: footOf(s), yardPieces: yard([0, 2], [4, 6], "Pallet stacks"),
      program: Y([6, X([8, OFFICE("Plant office")], [6, R("breakroom")], ["*", saw("Cut-up room")])],
        ["*", X(["*", chain("Nailing line", { line: true, hub: true })], [8, kiln("Heat-treat kiln")], [8, R("workshop", "millrepair", { name: "Pallet repair bay" })])]),
      exits: [roller("back", ["millchain"], { name: "Loading dock" }), roller("right", ["workshop"], { chance: 0.6 })],
    };
  } },
  { id: "shingle", name: "Shingle mill", w: { scenic: 2, coast: 2, rural: 1, town: 0.5, any: 0.3 }, make: (rng) => {
    const s = size(rng, "shingle");
    return {
      ...s, front: { width: 1 }, ground: "rural", foot: footOf(s), yardPieces: yard(SAWMILL.YARD.logs, [0, 1], "Bolt pile"),
      program: Y([5, X([7, OFFICE("Office")], ["*", R("storage", "millpack", { name: "Packing and bundles", type: "hardware" })])],
        ["*", X([7, shed("Bolt room")], ["*", saw("Shingle saw room", { shingle: true })])]),
      exits: [roller("back", ["millshed"], { name: "Bolt door", width: 2 }), door("right", ["millsaw"], 0.7, 0.3)],
    };
  } },
  { id: "portable", name: "Portable bandsaw mill", w: { scenic: 3, rural: 1, coast: 1, any: 0.2 }, make: (rng) => {
    const s = size(rng, "portable");
    return {
      ...s, front: { width: 2 }, ground: "woods", foot: footOf(s), openDoors: 0.6, yardPieces: yard([4, 6], [2, 4], "Log piles"),
      program: X(["*", saw("Mill lean-to", { entry: true, hub: true, band: true })], [4, Y([4, R("storage", "milltools", { name: "Tool shed", type: "workshop" })], ["*", boiler("Fuel shed", { fuel: true })])]),
      exits: [door("back", ["millsaw"], 0.9, 0.1)],
    };
  } },
  { id: "watermill", name: "Water-powered mill", w: { coast: 2.5, scenic: 1, rural: 1, town: 0.5, any: 0.2 }, make: (rng) => {
    const s = size(rng, "watermill");
    return {
      ...s, front: { width: 1 }, ground: "rural", foot: footOf(s), stairs: { roles: ["millstore", "storage"], n: 1 }, yardPieces: yard([2, 4], [0, 1], "Log pile"),
      program: X([6, R("workshop", "millwheel", { name: "Wheel pit and gear room", fl: "conc", windows: false })], ["*", Y(["*", saw("Sash-saw floor", { entry: true, sash: true })], [4, R("storage", "millstore", { name: "Mill stores", type: "workshop" })])]),
      upper: (g) => Y(["*", shed(g === 1 ? "Timber loft" : "Upper loft", { fl: "plank" })], [4, X(["*", R("office", "millofc", { name: "Miller's room" })], [4, R("storage", "millstore", { name: "Loft stores", type: "workshop" })])]),
      exits: [door("left", ["workshop"], 0.6, 0.4), door("back", ["millsaw"], 0.7, 0.3)],
    };
  } },
  { id: "treated", name: "Treated-timber yard", w: { highway: 1.5, town: 1.2, rural: 1, suburb: 1, scenic: 0.6, any: 0.5 }, make: (rng) => {
    const s = size(rng, "treated");
    return {
      ...s, front: { width: 1 }, ground: "lot", foot: footOf(s), yardPieces: yard([0, 1], [3, 5], "Treated stacks"),
      program: X([8, Y([5, OFFICE("Yard office")], ["*", R("storage", "millchem", { name: "Preservative store", type: "garage", lock: ["door", 0.4] })])],
        ["*", boiler("Treating plant", { retort: true, hub: true })], [10, shed("Treated-lumber shed")]),
      exits: [roller("right", ["millshed"], { name: "Loading door" }), roller("back", ["millboiler"], { name: "Tram door", chance: 0.8 })],
    };
  } },
  { id: "logsort", name: "Log sort yard", w: { scenic: 2, coast: 1.5, rural: 1, highway: 1, any: 0.3 }, make: (rng) => {
    const s = size(rng, "logsort");
    return {
      ...s, front: { width: 1 }, ground: "lot", foot: footOf(s), yardPieces: yard(SAWMILL.YARD.bigLogs, [0, 1], "Log decks"),
      program: X([6, OFFICE("Scale house")], ["*", R("hgarage", "millloader", { name: "Loader shop", type: "garage" })], [4, boiler("Fuel shed", { fuel: true })]),
      exits: [roller("back", ["hgarage"], { name: "Loader door" }), door("right", ["millboiler"], 0.8, 0.5)],
    };
  } },
  { id: "millwork", name: "Millwork shop", w: { town: 2.5, suburb: 2, city: 2, centre: 1, rural: 0.8, scenic: 0.3, any: 0.5 }, make: (rng) => {
    const s = size(rng, "millwork");
    return {
      ...s, front: { width: 2 }, ground: "town", foot: footOf(s), stairs: { roles: ["millplaner"], n: 1 },
      program: Y([5, X([9, R("office", "millshow", { name: "Showroom and office", entry: true, hub: true, type: "hardware", fl: "hardwood" })], ["*", R("workshop", "millfinish", { name: "Finishing room" })])],
        ["*", planer("Machine room", { work: true })]),
      upper: () => X(["*", shed("Lumber loft", { fl: "plank" })], [6, R("storage", "millstore", { name: "Template store", type: "workshop" })]),
      exits: [roller("back", ["millplaner"], { name: "Delivery door", width: 2 }), door("left", ["workshop"], 0.5, 0.4)],
    };
  } },
  { id: "framer", name: "Timber framer's barn", w: { rural: 1.5, scenic: 1.5, town: 0.8, any: 0.4 }, make: (rng) => {
    const s = size(rng, "framer");
    return {
      ...s, front: { width: 2 }, ground: "rural", foot: footOf(s), stairs: { roles: ["millsaw"], n: 1 }, yardPieces: yard([1, 3], [1, 2], "Timber stacks"),
      program: X(["*", saw("Framing floor", { entry: true, frame: true })], [6, Y([5, R("storage", "milltools", { name: "Tool room", type: "workshop" })], ["*", OFFICE("Office", { entry: false })])]),
      upper: () => shed("Timber loft", { fl: "plank" }),
      exits: [roller("back", ["millsaw"], { name: "Barn doors", width: 3 }), door("right", ["office"], 0.6, 0.4)],
    };
  } },
  { id: "kilnmill", name: "Sawmill with dry kilns", w: { scenic: 2, rural: 1.5, coast: 1, highway: 1, town: 0.5, any: 0.4 }, make: (rng) => {
    const s = size(rng, "kilnmill");
    return {
      ...s, front: { width: 1 }, ground: "rural", foot: footOf(s), yardPieces: { name: "Log deck", type: "hardware", pieces: [["logpile", SAWMILL.YARD.logs], ["burner", [1, 1]], ["lumberstack", SAWMILL.YARD.stacks]], loot: true },
      program: X([7, Y([5, OFFICE("Mill office")], ["*", filing()])], ["*", Y([5, chain()], ["*", saw("Saw hall", { hub: true })])], [10, Y(["*", kiln("Dry kilns")], [6, boiler("Boiler and burner room")])]),
      exits: [roller("back", ["millsaw"], { name: "Log door" }), roller("right", ["millkiln"], { name: "Kiln track door", chance: 0.8 }), door("left", ["office", "millfiling"], 0.6, 0.3)],
    };
  } },
];
export const SAWMILL_IDS = SAWMILL_PLANS.map((p) => p.id);
// The registry's view (variantpick.js, issue #41): "sawmill", weighted by the tile's class (any where unset), each
// entry's foot its REAL_SIZE row's middle (its size class by #42's sizeClassOf).
const mid = (r) => Math.round((r[0] + r[1]) / 2);
registerVariants("sawmill", SAWMILL_PLANS.map((p) => { const S = REAL_SIZE.sawmill.sizes[p.id]; return { id: p.id, name: p.name, w: { ...p.w }, size: p.id, foot: [mid(S.w), mid(S.d), mid(S.storeys)], make: p.make }; }));

/**
 * The spec of a sawmill (a new save's): its plan by its dice and its tile's class (o.tileClass; else its setting), or
 * o.plan's. The spec carries vid, vname and realSize (its REAL_SIZE sizes row).
 * @param {any} rng @param {any} o
 */
export function sawmillPlan(rng, o = {}) {
  const set = o.where && o.where.setting ? o.where.setting : o.setting || null;
  const e = /** @type {any} */ (pickVariant("sawmill", rng, { plan: o.plan ?? null, tileClass: o.tileClass || null, setting: o.tileClass ? null : set }));
  const spec = e.make(rng, o);
  return { ...spec, vid: e.id, vname: e.name, realSize: e.id, boxScale: SAWMILL.LOOT[e.id] || 1 };
}

// ======================================================================================
// The rooms (SAWMILL_STYLES, by the plan leaf's ind mark)
// ======================================================================================
/** @typedef {any} Lay */
const full = (L) => L.boxes() >= L.target();
const P = (L, o = {}) => ({ ...o, plain: full(L) });
/** Lootable pieces of these kinds against the walls, then off them, until the room holds its share. */
function fill(L, kinds) {
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.wall(kinds[i % kinds.length], { prefer: "corner" })) miss = 0; else miss++; }
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.centre(kinds[i % kinds.length])) miss = 0; else miss++; }
}
/** Up to n of k against the walls. */
function some(L, k, n, o = {}) { const out = []; for (let i = 0; i < n; i++) { const r = L.wall(k, P(L, o)); if (!r) break; out.push(r); } return out; }
/**
 * Lines of piece k down the room's long axis, a walk between (every `step` lines), clear of the walls at both ends and
 * cut every `gap` cells (a cross aisle); a container of `box` every `every` cells while the room has its share to come.
 */
function lines(L, k, o = {}) {
  const c = L.c, alongX = o.alongX ?? c.w >= c.h, step = o.step || 2, gap = o.gap || 0, len = o.len || 1;
  const [a0, a1, b0, b1] = alongX ? [c.x0 + 1, c.x1 - 1, c.y0 + (o.start ?? 1), c.y1 - (o.front ?? 1)] : [c.y0 + 1, c.y1 - 1, c.x0 + (o.start ?? 1), c.x1 - (o.front ?? 1)];
  let n = 0, i = 0;
  for (let b = b0; b <= b1; b += step) {
    for (let a = a0; a + len - 1 <= a1; a++) {
      if (gap && (a - a0) % gap === gap - 1) continue;
      const cells = [];
      for (let d = 0; d < len; d++) cells.push(alongX ? [a + d, b] : [b, a + d]);
      if (!cells.every(([x, y]) => L.ok(x, y))) continue;
      const want = o.box && !full(L) && i % (o.every || 3) === 0 ? o.box : k;
      i++;
      if (L.place(want, cells, { face: alongX ? "s" : "e", plain: full(L) })) { n += len; a += len - 1; }
    }
  }
  return n;
}
function deskSet(L, o = {}) { const d = L.wall("desk", P(L, { prefer: "middle", ...o })); if (d) L.around(d, "chair", 1); return d; }

export const SAWMILL_STYLES = {
  // A saw floor: the headsaw with its log carriage run beside it (conveyor), the edger, a tool chest; a band mill's
  // lean-to its one headsaw; a shingle saw room its saws in a row; a framing floor its timbers on the benches; a
  // water mill's sash saw.
  millsaw(L) {
    const r = L.room;
    if (r.frame) { lines(L, "lumberstack", { box: "lumberstack", every: 2, step: 3, gap: 6 }); some(L, "workbench", 2, { prefer: "middle" }); L.wall("toolchest", P(L, { prefer: "corner" })); fill(L, ["toolchest", "bladerack"]); return; }
    const hs = L.centre("headsaw") || L.need("headsaw");
    if (hs && !r.band && !r.sash && L.c.w * L.c.h >= 60) { // the carriage's track along the headsaw's long side
      const c = L.c, alongX = c.w >= c.h, [x, y] = hs.cells[0];
      for (let d = 2; d <= 7; d++) { const nx = alongX ? x - d : x, ny = alongX ? y : y - d; if (L.ok(nx, ny)) L.place("conveyor", [[nx, ny]], { face: alongX ? "s" : "e" }); }
    }
    if (r.shingle) some(L, "headsaw", 1, { prefer: "middle" });
    else if (!r.band && !r.sash && L.c.w * L.c.h >= 40) L.wall("edger", P(L, { prefer: "middle" }));
    L.wall("toolchest", P(L, { prefer: "corner" }));
    fill(L, r.band ? ["toolchest", "lumberstack"] : ["toolchest", "bladerack", "shelf"]);
  },
  // The green chain (and a pallet plant's nailing line, a grading table): the chain down the room (conveyors), the
  // lumber pulled off it stacked by grade along the walls.
  millchain(L) {
    lines(L, "conveyor", { step: L.c.h >= 8 ? 4 : 3, gap: 9 });
    if (!L.has("conveyor")) L.need("conveyor");
    if (L.room.line) L.wall("workbench", P(L, { prefer: "middle" }));
    fill(L, ["lumberstack", "lumberstack", "crate"]);
  },
  // A dry kiln (a heat-treat kiln): the kiln door on the wall, lumber on its stickers in rows on the track.
  millkiln(L) {
    L.wall("kilndoor", { prefer: "middle" }) || L.need("kilndoor");
    lines(L, "lumberstack", { box: "lumberstack", every: 1, step: 2, gap: 6 });
    fill(L, ["lumberstack"]);
  },
  // A planer shed (a planer hall, a millwork shop's machine room): the planer (a machine of two cells), a conveyor out of
  // it, lumber stacked round the walls; the machine room's benches and saws.
  millplaner(L) {
    L.centre("machine", { size: [2, 1] }) || L.need("machine");
    if (L.room.work) { some(L, "workbench", 2, { prefer: "middle" }); L.wall("toolchest", P(L, { prefer: "corner" })); }
    else lines(L, "conveyor", { step: 6, gap: 8, start: 2 });
    if (L.c.w * L.c.h >= 60) L.centre("forklift");
    fill(L, ["lumberstack", "lumberstack", "toolchest"]);
  },
  // The filing room (a planing mill's knife room): the saw-blade racks on the walls, the grinder (a machine), the
  // filer's bench and tool chest.
  millfiling(L) {
    some(L, "bladerack", 3, { prefer: "middle" });
    if (!L.has("bladerack")) L.need("bladerack");
    L.wall("machine", { prefer: "corner" });
    const b = L.wall("workbench", P(L, { prefer: "corner" }));
    if (b) L.beside(b, "toolchest", P(L));
    fill(L, ["bladerack", "toolchest", "shelf"]);
  },
  // The boiler house (the boiler and burner room, a treating plant, a fuel shed): the boiler, the fuel tank, drums; a
  // treating plant's retort (a process tank) and its chemical drums; a fuel shed's drums and a can shelf.
  millboiler(L) {
    const r = L.room;
    if (r.fuel) { L.wall("fueltank", { prefer: "corner" }); fill(L, ["drum", "shelf"]); return; }
    if (r.retort) { const c = L.c; for (let x = c.x0 + 2; x <= c.x1 - 2; x += 2) if (L.ok(x, c.y0 + 1)) L.place("vat", [[x, c.y0 + 1]], { face: "s" }); if (!L.has("vat")) L.need("vat"); fill(L, ["drum", "lumberstack", "toolchest"]); return; }
    L.wall("boiler", { prefer: "corner" }) || L.need("boiler");
    L.wall("fueltank", { prefer: "corner" });
    fill(L, ["drum", "toolchest", "shelf"]);
  },
  // A lumber shed: long rack lines of stacked lumber, a forklift in a big one.
  millshed(L) {
    if (L.c.w * L.c.h >= 50) L.centre("forklift");
    lines(L, "lumberstack", { box: "lumberstack", every: 2, step: 3, gap: 7 });
    fill(L, ["lumberstack", "palletrack"]);
  },
  // The mill office (a scale house, the sawyer's booth, the miller's room): a desk, a filing cabinet, a map of the cut on
  // the wall (a whiteboard), the key rack.
  millofc(L) { deskSet(L); L.wall("filing", P(L, { prefer: "corner" })); L.wall("whiteboard"); fill(L, ["filing", "cabinet"]); },
  // A lumber yard's office and counter: the counter and the till, a rack of fixings.
  millcounter(L) { L.wall("counter", P(L, { prefer: "middle" })); L.wall("checkout", { prefer: "corner" }); deskSet(L); fill(L, ["shelf", "cabinet"]); },
  millstore(L) { fill(L, ["shelf", "crate", "shelf"]); },
  millpack(L) { L.centre("table"); fill(L, ["crate", "lumberstack", "shelf"]); },
  milltools(L) { L.wall("workbench", P(L)); fill(L, ["toolchest", "bladerack", "shelf"]); },
  millchem(L) { fill(L, ["drum", "drum", "shelf"]); if (!L.has("drum")) L.need("drum"); },
  millrepair(L) { const b = L.wall("workbench", P(L, { prefer: "middle" })) || L.need("workbench"); if (b) L.beside(b, "toolchest", P(L)); fill(L, ["lumberstack", "crate"]); },
  // A water mill's wheel pit and gear room: the gearing (a machine), the shaft's housing, tools.
  millwheel(L) { L.wall("machine", { prefer: "corner" }) || L.need("machine"); L.wall("toolchest", P(L)); fill(L, ["shelf", "crate"]); },
  millloader(L) { L.wall("toolchest", P(L, { prefer: "corner" })); L.wall("tirerack", P(L)); L.wall("compressor", { prefer: "corner" }); fill(L, ["shelf", "toolchest"]); },
  millshow(L) { L.wall("counter", P(L, { prefer: "middle" })); deskSet(L); fill(L, ["displaycase", "shelf"]); },
  millfinish(L) { some(L, "workbench", 2); fill(L, ["shelf", "drum"]); },
};
/** The style of a room of a sawmill plan (its ind mark), or null. @param {any} room */
export function sawmillStyle(room) {
  return room && room.ind && SAWMILL_STYLES[room.ind] ? SAWMILL_STYLES[room.ind] : null;
}

// ======================================================================================
// The industrial mill's yard (compound.js): the saw house and five buildings round a yard of its own
// ======================================================================================
// The yard's buildings besides the saw house (each built with assemble at a ring of one cell, then placed facing
// south): the mill office by the gate, the boiler house (its burner outside), the dry kilns, the planer shed, two lumber
// sheds. Sizes in cells.
const YARD_BUILDINGS = {
  office: (rng) => ({ bw: rng.int(11, 14), bh: rng.int(8, 9), front: { width: 1 }, storeys: 1, foot: "small", program: X(["*", OFFICE("Mill office")], [5, Y([4, R("restroom")], ["*", R("breakroom")])]), exits: [door("back", ["breakroom"], 0.6, 0.4)] }),
  boiler: (rng) => ({ bw: rng.int(12, 15), bh: rng.int(9, 11), front: { width: 1 }, storeys: 1, foot: "small", program: X(["*", boiler("Boiler house", { hub: true })], [5, R("storage", "millstore", { name: "Hog-fuel store", type: "garage" })]), exits: [roller("back", ["millboiler"], { name: "Fuel door", chance: 0.7 })] }),
  kilns: (rng) => { const n = rng.int(2, 4); return { bw: n * 8 + 1, bh: rng.int(11, 13), front: { width: 1 }, storeys: 1, foot: n * 8 + 1 >= 20 ? "wide" : "medium", program: X(...Array.from({ length: n }, (_, i) => ["*", kiln(`Dry kiln ${i + 1}`, { entry: i === 0 })])), exits: [roller("back", ["millkiln"], { name: "Kiln track door" })] }; },
  planer: (rng) => ({ bw: rng.int(24, 30), bh: rng.int(14, 17), front: { width: 2 }, storeys: 1, foot: "wide", program: X(["*", planer("Planer shed", { entry: true })], [8, Y([6, filing("Knife room")], ["*", chain("Grading table")])]), exits: [roller("right", ["millplaner"], { name: "Loading door" }), roller("back", ["millchain"], { chance: 0.6 })] }),
  shed: (rng) => ({ bw: rng.int(18, 24), bh: rng.int(10, 12), front: { width: 3, roller: true }, storeys: 1, foot: "wide", program: shed("Lumber shed", { entry: true }), exits: [roller("back", ["millshed"], { chance: 0.6 })] }),
};
const zone = (x0, y0, side, name) => ({ x0, y0, w: 3, h: 3, side, exit: side, name, vehicle: false });
/** A building of the yard: its spec assembled at a ring of one cell, its ground the yard's. */
function yardPart(assemble, spec, rng, opts) {
  spec.margins = { front: 1, back: 1, left: 1, right: 1 };
  spec.boxScale = spec.boxScale || SAWMILL.LOOT.industrial; // the yard's buildings hold what the saw house does an area
  spec.ground = "none";
  return assemble(rng, spec, opts);
}

/**
 * The industrial mill's raid map (buildingmaps.js buildingMap: a spec with millYard): the saw house (spec, as made and
 * scaled) in the middle of its yard, the log yard to its west with its log decks and log trucks, the boiler house and
 * the dry kilns behind it, the planer shed to its east, the lumber sheds and the stacks of lumber in front, the mill
 * office by the gate. Its own dice (the seed, the tile, the option). One map of many buildings (compound.js).
 * assemble: buildingmaps.js's (handed over: no import back, the modules' load order as it was).
 * @param {any} state @param {number} tileId @param {any} option @param {any} withVehicle @param {any} spec @param {(rng: any, spec: any, opts: any) => any} assemble
 */
export function millYardMap(state, tileId, option, withVehicle, spec, assemble) {
  const rng = new Rng(Math.floor(hash01(state.seed, "millyard", tileId, option.id) * 4294967296) || 1);
  const M = SAWMILL.MILL, key = option.key || "sawmill", id = option.id || key;
  const part = (k, sp, name) => ({ name, m: yardPart(assemble, sp, new Rng(Math.floor(hash01(state.seed, "millpart", tileId, id, k) * 4294967296) || 1), { key, id: `${id}#${k}`, name }) });
  const saw = { name: "Saw house", m: yardPart(assemble, { ...spec, millYard: false, yardPieces: null }, rng, { key, id: `${id}#0`, name: "Saw house" }) };
  const B = [saw, part(1, YARD_BUILDINGS.office(rng), "Mill office"), part(2, YARD_BUILDINGS.boiler(rng), "Boiler house"), part(3, YARD_BUILDINGS.kilns(rng), "Dry kilns"),
    part(4, YARD_BUILDINGS.planer(rng), "Planer shed"), part(5, YARD_BUILDINGS.shed(rng), "Lumber shed No. 1"), part(6, YARD_BUILDINGS.shed(rng), "Lumber shed No. 2")];
  const [S, OF, BO, KI, PL, S1, S2] = B.map((b) => ({ ...b, w: b.m.building.w, h: b.m.building.h }));
  const E = M.EDGE, gap = () => rng.int(M.GAP[0], M.GAP[1]), logW = rng.int(M.LOGYARD[0], M.LOGYARD[1]);
  // The rows, north to south: the boiler house and the kilns; the log yard, the saw house and the planer shed; the
  // lumber stacks; the office and the sheds; the gate road.
  const xSaw = E + logW + gap(), xPl = xSaw + S.w + gap();
  const yTop = E, yMid = yTop + Math.max(BO.h, KI.h) + gap(), yStacks = yMid + Math.max(S.h, PL.h) + gap(), yLow = yStacks + 8;
  const W = Math.min(M.CAP, Math.max(xPl + PL.w, E + OF.w + 6 + S1.w + 6 + S2.w, xSaw + BO.w + 4 + KI.w) + E);
  const H = Math.min(M.CAP, yLow + Math.max(OF.h, S1.h, S2.h) + 10);
  const C = compoundGrid(W, H, Math.max(...B.map((b) => b.m.storeys || 1)), (x, y) => (y >= H - 4 ? "road" : Math.abs(x - Math.floor(W / 2)) <= 2 && y >= yStacks ? "gravel" : "dirt"));
  const placed = [];
  const put = (b, x0, y0) => { const p = placeBuilding(C, b.m, { x0, y0, face: "s", k: C.parts.length, name: b.name, key, tag: { part: { role: b === S ? "sawhouse" : "yard" } } }); placed.push(p); return p; };
  put(S, xSaw, yMid);
  put(BO, xSaw, yTop);
  put(KI, Math.min(W - E - KI.w, xSaw + BO.w + 4), yTop);
  put(PL, Math.min(W - E - PL.w, xPl), yMid);
  put(OF, E, yLow);
  put(S1, Math.max(E + OF.w + 6, Math.floor(W / 2) + 4), yLow);
  put(S2, Math.min(W - E - S2.w, Math.max(E + OF.w + 6, Math.floor(W / 2) + 4) + S1.w + 6), yLow);
  const zones = [zone(Math.floor(W / 2) - 1, H - 3, "south", "The mill gate"), zone(0, Math.floor(H / 2), "west", "The log road"), zone(W - 3, Math.floor(H / 2), "east", "The east yard"), zone(Math.floor(W / 2) - 1, 0, "north", "Behind the kilns")];
  const inZone = (x, y) => zones.some((z) => x >= z.x0 - 2 && x <= z.x0 + z.w + 1 && y >= z.y0 - 2 && y <= z.y0 + z.h + 1);
  const free = (x, y) => x >= 1 && y >= 1 && x < W - 1 && y < H - 1 && C.cells[y * W + x].k === "open" && !C.keep[y * W + x] && !C.built[y * W + x] && !inZone(x, y);
  const G = guard(C, zones[0].x0 + 1, zones[0].y0 + 1, { free });
  // The log yard: log piles in rows (fixed: nothing to search), the log trucks between them; its own outdoor area.
  const logA = { id: C.areas.length, type: null, name: "Log yard and log deck", outdoor: true, f: 0, x0: E, y0: yTop, w: logW, h: yStacks - yTop, house: null };
  C.areas.push(logA);
  for (let r = 0; r < M.LOGROWS; r++) {
    const x = E + 2 + r * Math.floor((logW - 4) / M.LOGROWS);
    for (let y = yTop + 2; y < yStacks - 2; y++) if ((y - yTop) % 6 !== 5) G.block(x, y, "logpile");
  }
  for (let i = 0, n = rng.int(M.TRUCKS[0], M.TRUCKS[1]); i < n; i++) {
    const x = E + 4 + rng.int(0, Math.max(0, logW - 10)), y = yTop + 3 + rng.int(0, Math.max(0, yStacks - yTop - 12));
    const rect = G.car(x, y, "y", 5, "truck", rng.int(0, 1e6));
    if (rect) C.containers.push({ id: C.cid++, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, f: 0, area: logA.id, kind: "car", searched: false, label: `${logA.name}: log truck` });
  }
  // The burner (a wigwam burner beside the boiler house, the mill's waste burned in it).
  const bo = placed[1];
  G.block(Math.max(1, bo.x0 - 3), bo.y0 + 2, "burner");
  // The lumber stacks: a band across the yard between the mill and the sheds, a container each (wood, building
  // materials: combat.js BOX_LOOT lumberstack), an outdoor area to search.
  const stackA = { id: C.areas.length, type: "hardware", name: "Lumber yard", outdoor: true, f: 0, x0: xSaw, y0: yStacks, w: Math.max(4, W - E - xSaw), h: 6, house: null };
  let stacks = 0;
  const want = rng.int(M.STACKS[0], M.STACKS[1]);
  for (let y = yStacks + 1; y < yStacks + 5 && stacks < want; y += 3) for (let x = xSaw + 1; x < W - E - 1 && stacks < want; x += 2) {
    if (rng.chance(0.25) || !G.block(x, y, "lumberstack")) continue;
    C.containers.push({ id: C.cid++, x, y, f: 0, area: stackA.id, kind: "lumberstack", searched: false, label: `${stackA.name}: lumberstack` });
    stacks++;
  }
  if (stacks) C.areas.push(stackA);
  const vehicle = compoundVehicle(C, zones[0], withVehicle);
  return compoundResult(C, { key, id, name: option.name || "Sawmill", zones, vehicle, kind: "sawmill", extra: { vid: spec.vid, vname: spec.vname, variant: spec.vname, yard: true, word: "buildings" } });
}

// ======================================================================================
// The sawmills' signs of survival (interiorscenes.js registerScene; their own dice there), only on a map laid out by
// these plans (when: a room carries a mill mark, so no other building rolls them):
//   sawpit     someone caught at the headsaw: the body on the saw floor by the saw, blood across the boards;
//   kilnhold   survivors held out in a dry kiln (its steel door, no windows): cots between the lumber, a crate dragged
//              to the door, and the ones who never came out.
// ======================================================================================
const millRooms = (ctx, marks) => ctx.rng.shuffle(ctx.rooms.filter((r) => marks.includes(r.ind) && !r.scene && !r.locked));
const milled = (ctx) => ctx.rooms.some((r) => typeof r.ind === "string" && r.ind.startsWith("mill"));
const lower = (r) => String(r.name || "room").replace(/ \(upstairs\)$/, "").replace(/, .*$/, "").toLowerCase();
function sawPit(ctx) {
  const { rng } = ctx;
  for (const r of millRooms(ctx, ["millsaw"])) {
    const f = r.f || 0, free = ctx.freeIn(r);
    const saws = [];
    for (let y = r.y0 + 1; y < r.y0 + r.h - 1; y++) for (let x = r.x0 + 1; x < r.x0 + r.w - 1; x++) { const c = ctx.at(f, x, y); if (c && c.k === "headsaw") saws.push([x, y]); }
    if (!saws.length || !free.length) continue;
    const [sx, sy] = saws[0];
    const spot = free.slice().sort((p, q) => Math.abs(p[0] - sx) + Math.abs(p[1] - sy) - (Math.abs(q[0] - sx) + Math.abs(q[1] - sy)))[0];
    ctx.body(f, spot[0], spot[1], { human: true, quiet: rng.chance(0.5) });
    ctx.splatter(f, spot[0], spot[1], "human", 2);
    const d = (r.doors || [])[0];
    if (d && rng.chance(0.6)) ctx.trail(f, spot[0], spot[1], d[0], d[1], "human");
    return ctx.done("sawpit", r, spot[0], spot[1], `Someone was caught on the ${lower(r)} by the headsaw, and the boards round it are dark with blood.`);
  }
  return null;
}
function kilnHold(ctx) {
  const { rng } = ctx;
  for (const r of millRooms(ctx, ["millkiln"])) {
    const f = r.f || 0, free = ctx.freeIn(r).filter(([x, y]) => (x + y) % 2 === 0);
    if (free.length < 3) continue;
    const cots = rng.shuffle(free).slice(0, rng.int(2, 3));
    for (const [x, y] of cots) ctx.piece(f, x, y, "cot");
    const left = ctx.freeIn(r);
    const n = Math.min(left.length, rng.int(0, 2));
    for (const [x, y] of rng.shuffle(left).slice(0, n)) ctx.body(f, x, y, { human: true, quiet: true });
    const [cx, cy] = cots[0];
    return ctx.done("kilnhold", r, cx, cy, `Someone held out in the ${lower(r)} behind its steel door: cots between the lumber${n ? `, and ${n === 1 ? "one who never came out" : `${n} who never came out`}` : ""}.`);
  }
  return null;
}
registerScene("sawpit", { w: 3, place: sawPit, kinds: ["sawmill"], when: milled });
registerScene("kilnhold", { w: 2, place: kilnHold, kinds: ["sawmill"], when: milled });
export const SAWMILL_SCENES = ["sawpit", "kilnhold"];
