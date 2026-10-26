// @ts-check
// Radio towers, a dozen plans (issue #54 of the round-2 epic #39; the user's request 2026-10-26: "radio tower(can have a
// base turn it on with generators to extend radio communications further)"). The building type "radiotower"
// (buildingmaps.js BUILDINGS; a new save's radio tower site and point of interest open it: buildingmaps.js SITES,
// siteEntry): a compound on one raid map, the transmitter building with its rooms and, outside it, the fenced yard with
// the tower itself (combat.js CELL tower cells at the mast's foot: climbed, a lookout two levels up), the fuel drums by
// the generator shed and the cable spools. The base feature (claiming a tower, powering it, its range): radiotower.js.
//
// A variant is a plan of its own, not a recolour: each has its own rooms, their arrangement, its entrances, its size and
// storeys, and its own yard (the mast's kind and size, the fence, what stands outside). The plans (TOWER_PLANS; sizes
// data-buildingsize.js REAL_SIZE.radiotower.sizes, a row a plan):
//   am         Guyed AM mast: the transmitter building (transmitter room, the tuning-house workshop, generator room,
//              engineer's office), a tall mast on a big fenced field behind it.
//   fmtv       FM and TV tower on a hill: a long transmitter building (two transmitter halls, the generator room, the
//              equipment room, a bunk room for the winter crews), a lattice tower behind it.
//   cell       Cell tower compound: one equipment shelter (the radio cabinets, the battery string) and the generator
//              shed, a monopole in a tight chain-link compound, cabinets outside.
//   microwave  Microwave relay: the equipment shelter, a battery room, the generator room, a lattice tower of dishes.
//   firerep    Fire-service repeater: the radio room, a kit room, the generator shed, a mast beside it.
//   ham        Ham radio club: the clubhouse (the shack, the meeting room, a kitchenette, the workshop), its tower in
//              the back yard, no fence.
//   military   Military relay: the transmitter room, a kit room, a bunk room, the generator room; wire and sandbags
//              round the compound.
//   ebs        Emergency broadcast station: two storeys (studio, transmitter room, generator room and first aid
//              below; the bunk room, the director's office and the records above), its mast beside it.
//   radar      Weather radar: the instrument room, the equipment room, the generator room; the radome on its tower.
//   rooftop    Rooftop repeater: a three- or four-storey building whose top floor is the repeater room and the
//              equipment room (its lookout: the roof floor itself; no mast on the ground).
//   broadcast  Broadcast studio and mast: the station's studio, control room, record library, offices and the
//              transmitter room, the mast out back.
//   utility    Utility radio relay: the power company's relay hut (the radio room, the battery room) and a
//              separate-sided generator shed, a lattice mast.
// Which plan: the shared picker (variantpick.js, issue #41; key "radiotower"), by the setting (settings.js: centre,
// city, suburb, town, rural, highway; w.any where unset) on the building's hash dice (read, never consumed); o.plan pins
// one. Each has a name (spec.vname) and an id (spec.vid): the raid's opening line, the choice before a raid.
// The rooms' loot (data-radiotower.js TOWER_AREAS): the transmitter room's electronics, radios and batteries, the
// generator shed's fuel and tools, the equipment shelter's radio parts and batteries, the cable store's cable (scrap)
// and connectors; furnished by the military and industrial styles' marks (comms, tequip, genshed, ...).
// Older saves (worldcfg.js legacyTowers): their radio tower site keeps its transmitter hut (BUILDINGS.radio).
import { registerVariants, pickVariant } from "./variantpick.js"; // the shared picker (issue #41)
import { registerScene } from "./interiorscenes.js";
import { REAL_SIZE } from "./data-buildingsize.js";
import { sizeFor } from "./placement.js"; // the size class a radio tower takes on its tile class (#42's placement table)

/** @typedef {{ id: string, name: string, w: Record<string, number>, mast: string | null, fence: boolean, make: (rng: any, o: any) => any }} TowerPlan */

const R = (role, o = {}) => ({ role, ...o });
const X = (...parts) => ({ split: "x", parts });
const Y = (...parts) => ({ split: "y", parts });
const door = (side, roles, chance = 0.6, lock = 0.35) => ({ side, roles, chance, lock });
// The rooms (their loot: data-radiotower.js TOWER_AREAS; their furnishing: a style mark: civic → militarylayout.js
// MILITARY_STYLES / civiclayout.js, ind → industrylayout.js INDUSTRY_STYLES).
const TX = (name = "Transmitter room", o = {}) => R("control", { name, type: "txroom", civic: "comms", ...o });
const EQ = (name = "Equipment shelter", o = {}) => R("lab", { name, type: "eqshelter", civic: "tequip", ...o });
const GEN = (name = "Generator shed", o = {}) => R("workshop", { name, type: "genshed", ind: "genshed", ...o });
const CABLE = (name = "Cable store", o = {}) => R("storage", { name, type: "cablestore", civic: "hparts", lock: ["door", 0.3], ...o });
const BATT = (name = "Battery room", o = {}) => R("genroom", { name, type: "eqshelter", civic: "tequip", ...o });
const OFFICE = (name, o = {}) => R("office", { name, type: "office", civic: "weather", ...o });
const BUNK = (name = "Bunk room", o = {}) => R("bedroom", { name, type: "house", civic: "nco", ...o });
const KIT = (name = "Kit room", o = {}) => R("lockerroom", { name, type: "lockers", civic: "guardroom", ...o });
const WASH = () => R("restroom", { name: "Washroom", type: "lockers", civic: "washroom", maxBoxes: 1 });
const KITCHEN = (name = "Kitchenette") => R("kitchen", { name, type: "kitchen", civic: "breakroom" });
const ENTRY = (name = "Entry", o = {}) => R("foyer", { name, type: "office", entry: true, hub: true, ...o });

// The footprint and storeys from the plan's REAL_SIZE row (data-buildingsize.js radiotower.sizes): metres, a cell a metre.
const roll = (rng, r) => rng.int(r[0], r[1]);
function size(rng, id) {
  const S = REAL_SIZE.radiotower.sizes[id];
  return { bw: roll(rng, S.w), bh: roll(rng, S.d), storeys: roll(rng, S.storeys) };
}
const footOf = (s) => { const a = s.bw * s.bh; return a <= 190 ? "small" : a <= 360 ? "medium" : "large"; };

// The yard round the building (spec.outside, assemble's outdoor tools): the fence, the mast, the drums and the spools.
// y: { mast: "guyed" | "lattice" | "monopole" | "radome" | null, at: "back" | "left" | "right", n: its foot in cells
// (n × n tower cells), fence: "chain" | "wire" | null, drums: [min, max], spools: [min, max], cabinets: [min, max] }.
// Margins (spec.margins) leave the room for it; block() refuses any cell that would cut the yard off.
export const YARD = { GATE: 3, TRIES: 30 };
/** @param {any} api @param {any} y */
export function towerYard(api, y) {
  const { rng, bx0, bx1, by0, by1 } = api;
  const out = { mast: 0, fence: 0, drums: 0, spools: 0, cabinets: 0 };
  // The mast: n × n tower cells (the climb to the platform), behind or beside the building.
  if (y.mast) {
    const n = y.n || 1, midX = Math.round((bx0 + bx1) / 2), midY = Math.round((by0 + by1) / 2);
    const want = y.at === "left" ? [bx0 - 4 - n, midY] : y.at === "right" ? [bx1 + 4, midY] : [midX, by0 - 4 - n];
    for (let t = 0; t < YARD.TRIES && !out.mast; t++) {
      const x0 = want[0] + (t ? rng.int(-3, 3) : 0), y0 = want[1] + (t ? rng.int(-2, 2) : 0);
      const cells = [];
      for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) cells.push([x0 + dx, y0 + dy]);
      if (!cells.every(([x, yy]) => api.free(x, yy))) continue;
      const laid = [];
      for (const [x, yy] of cells) { if (api.block(x, yy, "tower")) laid.push([x, yy]); else break; }
      if (laid.length === cells.length) { out.mast = laid.length; out.mastAt = [x0, y0, n]; }
      else for (const [x, yy] of laid) api.unblock(x, yy);
    }
  }
  // The fence: a ring round the building and the yard (the mast inside it), the gate gap in the front's middle.
  if (y.fence) {
    const k = y.fence === "wire" ? "wirefence" : "wirefence";
    const m = out.mastAt;
    const x0 = Math.min(bx0 - 3, m ? m[0] - 2 : Infinity), x1 = Math.max(bx1 + 3, m ? m[0] + m[2] + 1 : -Infinity);
    const y0 = Math.min(by0 - 3, m ? m[1] - 2 : Infinity), y1 = by1 + 3;
    const gx = Math.round((bx0 + bx1) / 2), gate = (x) => Math.abs(x - gx) <= 1;
    const ring = [];
    for (let x = x0; x <= x1; x++) { ring.push([x, y0]); if (!gate(x)) ring.push([x, y1]); }
    for (let yy = y0 + 1; yy < y1; yy++) ring.push([x0, yy], [x1, yy]);
    for (const [x, yy] of ring) if (api.free(x, yy) && api.block(x, yy, k)) out.fence++;
    if (y.fence === "wire") { for (const dx of [-2, 2]) { const x = gx + dx, yy = y1 + 1; if (api.free(x, yy)) api.block(x, yy, "sandbag"); } }
  }
  // Fuel drums by the building's back (the generator shed's), each a container in the "Fuel store".
  const drums = y.drums ? rng.int(y.drums[0], y.drums[1]) : 0;
  if (drums) out.drums = row(api, "drum", drums, { type: "genshed", name: "Fuel store" }, "fuel drum", [[bx1 + 2, by0 - 2], [bx0 - 2, by0 - 2], [bx1 + 2, by1 - 1]]);
  // Cable spools (crates) in the "Cable yard".
  const spools = y.spools ? rng.int(y.spools[0], y.spools[1]) : 0;
  if (spools) out.spools = row(api, "crate", spools, { type: "cablestore", name: "Cable yard" }, "cable spools", [[bx0 - 3, by0 - 3], [bx1 + 3, by0 - 3], [bx0 - 3, by1]]);
  // Equipment cabinets on a slab (server racks: the radio and battery cabinets of a cell site).
  const cabs = y.cabinets ? rng.int(y.cabinets[0], y.cabinets[1]) : 0;
  if (cabs) out.cabinets = row(api, "serverrack", cabs, { type: "eqshelter", name: "Equipment cabinets" }, "equipment cabinet", [[bx1 + 2, by1 - 2], [bx0 - 2, by1 - 2], [bx1 + 2, by0]]);
  return out;
}
// Up to n of piece k in a line from one of the starts (each a container of the area), the area's rect round them.
function row(api, k, n, area, label, starts) {
  let a = null, made = 0;
  const got = [];
  for (const [sx, sy] of starts) {
    for (let i = 0; made < n && i < n * 3; i++) {
      const x = sx + (i % 2 ? 0 : 0), yy = sy - i;
      if (!api.free(x, yy) || !api.block(x, yy, k)) continue;
      if (!a) a = api.area({ ...area });
      api.container({ x0: x, y0: yy, w: 1, h: 1 }, a, k, label);
      got.push([x, yy]); made++;
    }
    if (made >= n) break;
  }
  if (a && got.length) {
    const xs = got.map(([x]) => x), ys = got.map(([, yy]) => yy);
    Object.assign(a, { x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, w: Math.max(...xs) - Math.min(...xs) + 3, h: Math.max(...ys) - Math.min(...ys) + 3 });
  }
  return made;
}

// A plan's spec: the building, the yard's margins and the yard itself.
function spec(s, o) {
  const { yard, margins, ...rest } = o;
  return {
    ...s, front: { width: 1 }, foot: footOf(s), ...rest,
    margins: { front: 6, back: 10, left: 8, right: 8, ...(margins || {}) },
    outside: (api) => { api.yard = towerYard(api, yard); },
    tower: yard.mast || null,
  };
}

/** @type {TowerPlan[]} */
export const TOWER_PLANS = [
  { id: "am", name: "Guyed AM mast", mast: "guyed", fence: true, w: { rural: 3, highway: 2, town: 0.5, suburb: 0.5, any: 0.5 }, make: (rng) => {
    const s = size(rng, "am");
    return spec(s, { ground: "rural", stairs: undefined,
      program: Y([4, X([5, ENTRY("Lobby")], ["*", OFFICE("Engineer's office")], [3, WASH()])], ["*", X(["*", TX()], [6, R("workshop", { name: "Tuning house", type: "workshop", civic: "avionics" })], [5, GEN("Generator room")])]),
      exits: [door("back", ["workshop", "control"], 0.7, 0.3)],
      yard: { mast: "guyed", n: 1, at: "back", fence: "chain", drums: [2, 4], spools: [1, 2], cabinets: [1, 2] }, margins: { back: 14 } });
  } },
  { id: "fmtv", name: "FM and TV tower", mast: "lattice", fence: true, w: { rural: 3, highway: 1, any: 0.4 }, make: (rng) => {
    const s = size(rng, "fmtv");
    return spec(s, { ground: "rural",
      program: Y([5, X([6, ENTRY()], ["*", TX("FM transmitter hall")], [5, BUNK("Winter crew bunks")])], ["*", X(["*", TX("TV transmitter hall")], [6, EQ("Equipment room")], [6, GEN("Generator room")], [4, CABLE()])]),
      exits: [door("back", ["workshop", "storage"], 0.8, 0.3), door(rng.chance(0.5) ? "left" : "right", ["control"], 0.5, 0.4)],
      yard: { mast: "lattice", n: 3, at: "back", fence: "chain", drums: [3, 5], spools: [2, 3] }, margins: { back: 14 } });
  } },
  { id: "cell", name: "Cell tower compound", mast: "monopole", fence: true, w: { suburb: 3, town: 3, highway: 3, rural: 2, city: 1, centre: 0.3, any: 1 }, make: (rng) => {
    const s = size(rng, "cell");
    return spec(s, { ground: "rural",
      program: X(["*", TX("Radio shelter", { entry: true, hub: true })], [4, BATT("Battery cabinet")], [4, GEN("Generator shed")]),
      exits: [],
      yard: { mast: "monopole", n: 1, at: "right", fence: "chain", drums: [1, 2], cabinets: [2, 3] }, margins: { right: 10 } });
  } },
  { id: "microwave", name: "Microwave relay", mast: "lattice", fence: true, w: { rural: 3, highway: 3, any: 0.5 }, make: (rng) => {
    const s = size(rng, "microwave");
    return spec(s, { ground: "rural",
      program: Y([4, X(["*", ENTRY("Entry")], [5, BATT()])], ["*", X(["*", TX("Microwave radio room")], [5, EQ("Equipment shelter")], [5, GEN("Generator room")])]),
      exits: [door("back", ["workshop"], 0.6, 0.3)],
      yard: { mast: "lattice", n: 2, at: "back", fence: "chain", drums: [1, 3], spools: [1, 1] } });
  } },
  { id: "firerep", name: "Fire-service repeater", mast: "lattice", fence: false, w: { rural: 2, town: 1.5, highway: 1, any: 0.5 }, make: (rng) => {
    const s = size(rng, "firerep");
    return spec(s, { ground: "woods",
      program: X(["*", Y(["*", TX("Radio room", { entry: true, hub: true })], [4, KIT("Kit room")])], [5, GEN("Generator shed")]),
      exits: [door("back", ["workshop"], 0.7, 0.3)],
      yard: { mast: "lattice", n: 1, at: "left", fence: null, drums: [1, 2], cabinets: [1, 1] }, margins: { left: 10 } });
  } },
  { id: "ham", name: "Ham radio club", mast: "lattice", fence: false, w: { suburb: 2, town: 3, rural: 1, any: 0.3 }, make: (rng) => {
    const s = size(rng, "ham");
    return spec(s, { ground: "town",
      program: Y([5, X(["*", R("classroom", { name: "Meeting room", type: "office", civic: "briefing", entry: true, hub: true })], [5, KITCHEN()])], ["*", X(["*", TX("The shack")], [6, R("workshop", { name: "Workshop", type: "eqshelter", civic: "avionics" })], [4, GEN("Generator closet")])]),
      exits: [door("back", ["workshop", "control"], 0.8, 0.3)],
      yard: { mast: "lattice", n: 1, at: "back", fence: null, drums: [1, 1], spools: [1, 2] } });
  } },
  { id: "military", name: "Military relay", mast: "lattice", fence: true, w: { rural: 2, highway: 1.5, any: 0.3 }, make: (rng) => {
    const s = size(rng, "military");
    return spec(s, { ground: "compound",
      program: Y([4, X([5, ENTRY("Guard post")], ["*", KIT("Kit room")], [3, WASH()])], ["*", X(["*", TX("Relay room")], [5, BUNK("Duty bunk room")], [5, GEN("Generator room")])]),
      exits: [door("back", ["workshop", "bedroom"], 0.7, 0.5)],
      yard: { mast: "lattice", n: 2, at: "back", fence: null, drums: [3, 5], spools: [1, 2], cabinets: [1, 2] } }); // the compound ground (militarylayout.js militaryOutside): wire, the fence, watchtowers and the gate
  } },
  { id: "ebs", name: "Emergency broadcast station", mast: "lattice", fence: true, w: { city: 3, centre: 1.5, town: 2, suburb: 1, any: 0.5 }, make: (rng) => {
    const s = size(rng, "ebs");
    return spec(s, { ground: "town", stairs: { roles: ["foyer"], n: 1 },
      program: Y([5, X([6, ENTRY("Hall")], ["*", R("lab", { name: "Studio", type: "txroom", civic: "comms" })], [5, R("nurse", { name: "First aid", type: "nurse", civic: "medic" })])], ["*", X(["*", TX()], [6, GEN("Generator room")], [4, CABLE()])]),
      upper: () => Y([5, X([6, R("corridor", { name: "Landing", hub: true })], ["*", OFFICE("Director's office")], [4, WASH()])], ["*", X(["*", BUNK("Duty bunk room")], [6, R("evidence", { name: "Records", type: "office", civic: "records" })])]),
      exits: [door("back", ["workshop", "storage"], 0.8, 0.4)],
      yard: { mast: "lattice", n: 2, at: rng.chance(0.5) ? "left" : "right", fence: "chain", drums: [2, 3], cabinets: [1, 2] }, margins: { left: 10, right: 10 } });
  } },
  { id: "radar", name: "Weather radar", mast: "radome", fence: true, w: { rural: 2, highway: 2, any: 0.4 }, make: (rng) => {
    const s = size(rng, "radar");
    return spec(s, { ground: "rural",
      program: X(["*", Y([4, ENTRY("Entry")], ["*", R("control", { name: "Instrument room", type: "txroom", ind: "instruments" })])], [6, Y(["*", EQ("Radar equipment room")], [4, GEN("Generator room")])]),
      exits: [door("back", ["workshop", "lab"], 0.6, 0.3)],
      yard: { mast: "radome", n: 3, at: "back", fence: "chain", drums: [2, 3] }, margins: { back: 12 } });
  } },
  { id: "rooftop", name: "Rooftop repeater", mast: null, fence: false, w: { centre: 3, city: 3, suburb: 0.5, any: 0.2 }, make: (rng) => {
    const s = size(rng, "rooftop");
    return spec(s, { ground: "city", stairs: { roles: ["foyer"], n: 1 },
      program: Y([5, X([6, ENTRY("Lobby")], ["*", OFFICE("Leasing office")], [4, WASH()])], ["*", X(["*", R("storage", { name: "Tenants' storage", type: "warehouse" })], [6, GEN("Standby generator room")])]),
      upper: (g, r, ctx) => (ctx.top
        ? Y([5, X([6, R("corridor", { name: "Roof landing", hub: true })], ["*", EQ("Equipment room")])], ["*", X(["*", TX("Repeater room")], [5, BATT()])])
        : Y([5, X([6, R("corridor", { name: "Landing", hub: true })], ["*", OFFICE("Office")])], ["*", OFFICE("Offices")])),
      exits: [door("back", ["workshop", "storage"], 0.7, 0.4)],
      yard: { mast: null, fence: null, drums: [1, 2] } });
  } },
  { id: "broadcast", name: "Broadcast studio and mast", mast: "guyed", fence: true, w: { town: 2, city: 2, suburb: 1.5, centre: 1, any: 0.5 }, make: (rng) => {
    const s = size(rng, "broadcast");
    return spec(s, { ground: "town", stairs: { roles: ["foyer"], n: 1 },
      program: Y([5, X([6, ENTRY("Reception")], ["*", R("lab", { name: "On-air studio", type: "txroom", civic: "comms" })], [6, R("control", { name: "Master control", type: "txroom", civic: "tradar" })])], ["*", X(["*", R("evidence", { name: "Record library", type: "office", civic: "records" })], [6, TX()], [5, GEN("Generator room")])]),
      upper: () => Y([5, X([6, R("corridor", { name: "Landing", hub: true })], ["*", OFFICE("Station manager's office")])], ["*", X(["*", OFFICE("Newsroom")], [5, KITCHEN("Staff kitchen")])]),
      exits: [door("back", ["workshop", "control"], 0.8, 0.4)],
      yard: { mast: "guyed", n: 1, at: "back", fence: "chain", drums: [1, 3], spools: [1, 2], cabinets: [1, 2] }, margins: { back: 12 } });
  } },
  { id: "utility", name: "Utility radio relay", mast: "lattice", fence: true, w: { rural: 2, highway: 2, suburb: 0.5, any: 0.5 }, make: (rng) => {
    const s = size(rng, "utility");
    return spec(s, { ground: "lot",
      program: Y(["*", X(["*", TX("Radio room", { entry: true, hub: true })], [5, BATT()])], [4, X(["*", CABLE("Line store")], [5, GEN("Generator shed")])]),
      exits: [door("back", ["storage", "workshop"], 0.7, 0.3)],
      yard: { mast: "lattice", n: 2, at: rng.chance(0.5) ? "left" : "right", fence: "chain", drums: [1, 3], spools: [2, 3] }, margins: { left: 10, right: 10 } });
  } },
];
export const TOWER_KEYS = TOWER_PLANS.map((p) => p.id);
// The registry (variantpick.js, issue #41): "radiotower", each plan weighted by the setting (w.any where unset), its
// footprint and storeys from its REAL_SIZE row (the size class: #42's sizeClassOf).
const footRow = (id) => { const S = REAL_SIZE.radiotower.sizes[id]; return [S.w[1], S.d[1], S.storeys[1]]; };
registerVariants("radiotower", TOWER_PLANS.map((p) => ({ id: p.id, name: p.name, w: { ...p.w }, foot: footRow(p.id), src: p, make: p.make })));

/**
 * The spec of a radio tower (a new save's): its plan by its dice and its setting (o.where; o.tileClass), or o.plan's.
 * The spec carries vid and vname (planname.js) and yard (what towerYard laid, once assembled: api.yard).
 * @param {any} rng @param {any} o
 */
export function radioTowerPlan(rng, o = {}) {
  const size = o.tileClass ? sizeFor("radiotower", o.tileClass) : null; // placement.js placementCtx's size: a city's rooftop or studio, a hill's mast
  const e = pickVariant("radiotower", rng, { plan: o.plan != null && typeof o.plan === "string" ? o.plan : null, setting: o.where || null, tileClass: o.tileClass || null, size });
  const p = /** @type {TowerPlan} */ (e && e.src ? e.src : TOWER_PLANS[0]);
  return { ...p.make(rng, o), vid: p.id, vname: p.name, realSize: p.id };
}

// ======================================================================================
// The signs of survival (interiorscenes.js registerScene; their own dice there), only on a radio tower's map:
//   towerbroadcast the operator who kept the emergency broadcast going: a body at the transmitter room's console,
//                  a hand-crank radio by them, the door shoved shut with a cabinet.
// ======================================================================================
const lower = (r) => String(r.name || "room").replace(/ \(upstairs\)$/, "").toLowerCase();
function lastBroadcast(ctx) {
  const { rng } = ctx;
  for (const r of rng.shuffle(ctx.rooms.filter((q) => q.type === "txroom" && !q.scene && !q.locked))) {
    const f = r.f || 0, free = ctx.freeIn(r);
    if (free.length < 3) continue;
    const [x, y] = free[0];
    ctx.body(f, x, y, { human: true, quiet: rng.chance(0.6), name: "The last operator" });
    ctx.splatter(f, x, y, "human", 1);
    return ctx.done("towerbroadcast", r, x, y, `Someone kept the emergency broadcast going in the ${lower(r)} to the end: they are still at the console.`);
  }
  return null;
}
registerScene("towerbroadcast", { w: 3, place: lastBroadcast, kinds: ["radiotower"], when: (ctx) => ctx.key === "radiotower" });
