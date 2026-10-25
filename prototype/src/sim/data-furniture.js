// @ts-check
// The furniture and appliance catalogue (the user's request 2026-10-25, issue #8 of the interiors epic #7: "Make the
// layouts make sense and filled with appliances, furniture and decor that makes it feel lived in. [...] I want all
// reasonable appliances, furniture and some decor to be lootable and taken to your base for use [...] some will
// require two survivors to carry"). Plain data that imports nothing: the one source of truth for every piece of
// furniture that stands on a battle map's cell. Merged by: data.js (FURNITURE_GEAR into GEAR: the item forms, issue #12's
// furnicarry.js lifts them), combat.js (furnitureCells into CELL, at load), barricade.js
// (furnitureHp into FURNITURE: what can be shoved and battered), ui/isoview.js (FURNITURE_KINDS: the furniture set,
// the floored set, the outlines, the wall-standing pieces; a sprite and a height for each kind), ui/codex.js (the
// Barricades entry's names). Placing the pieces in rooms (buildingmaps.js FURNISH), picking them up, base use: the
// sibling tickets under #7 (they read carry, size, loot, tags and use).
//
// FURNITURE_KINDS, keyed by cell kind:
//   name     what the tooltips and the codex call it (CELL name)
//   cell     { walk, cover, los, tall? }: the cell's rules (combat.js CELL: cover 0 none, 1 half, 2 full; los blocks
//            sight; tall: seen over only from that many levels up, and never vaulted)
//   hp       hit points when it stands in the dead's way (a shoved piece: barricade.js FURNITURE, combat.js bash)
//   kg       its weight
//   carry    "one": one survivor lifts it, very slowly; "two": it takes two survivors; "fixed": never lifted (plumbed
//            in, bolted down, built in: a bathtub, a bar counter, a safe). Every "two" piece weighs more than every
//            "one" piece (CARRY_KG); a fixed piece is never shoved either (not in barricade.js FURNITURE)
//   size     [w, h] in cells (1 × 1, 1 × 2, 2 × 1, 2 × 2): the footprint the layout tickets lay it on
//   loot     also a container: a raid's AREAS[...].boxes draw from these (nothing lootable is fixed: what holds loot
//            can be carried home)
//   tags     the room roles it belongs in (kitchen, bath, bedroom, living, dining, office, ward, cells, bay, shop,
//            church, school, bar, laundry, cellar, yard...)
//   use      what it does at a base, as a key the base-use tickets read: "fridge", "freezer", "stove", "oven",
//            "microwave", "storage:<kg>", "comfort:<mood>", "work:<station>", "bed:<data-beds.js BED_SPEC kind>",
//            "none"
//   wall     stands against a wall, running along it (ui/isoview.js turns it to the wall it stands by)
// The first twelve rows are the kinds the raid maps had before (2026-10-18 and earlier): their cell rules, names and
// hit points are as they were (bars and the gun safe were never shoved, so they are fixed and have no shove entry).

/** @typedef {{ walk: boolean, cover: number, los: boolean, tall?: number }} CellDef */
/** @typedef {"one" | "two" | "fixed"} Carry */
/** @typedef {{ name: string, cell: CellDef, hp: number, kg: number, carry: Carry, size: [number, number], loot: boolean, tags: string[], use: string, wall?: boolean }} Piece */

/** @type {Carry[]} */
export const CARRY = ["one", "two", "fixed"];
// The line between the classes: a "one" piece weighs at most ONE kg, a "two" piece at least TWO (tools/furnituretest.js).
export const CARRY_KG = { ONE: 30, TWO: 35 };

const C = (walk, cover, los) => ({ walk, cover, los });
const HALF = C(false, 1, false), FULL = C(false, 2, true), STEEL = C(false, 2, false), POLE = C(false, 0, false);
/** @returns {Piece} */
const P = (name, cell, hp, kg, carry, size, loot, tags, use, wall = false) => ({ name, cell, hp, kg, carry, size, loot, tags, use, ...(wall ? { wall } : {}) });
const S1 = [1, 1], S12 = [1, 2], S21 = [2, 1], S22 = [2, 2];

/** @type {Record<string, Piece>} */
export const FURNITURE_KINDS = {
  // ---------- the kinds the raid maps had already (numbers unchanged) ----------
  shelf:   P("Shelves",     HALF, 25, 25, "one", S1, true, ["kitchen", "shop", "living", "bay", "office", "cellar"], "storage:40", true),
  locker:  P("Lockers",     FULL, 40, 40, "two", S1, true, ["ward", "cells", "bay", "office", "school"], "storage:60", true),
  cabinet: P("Cabinet",     HALF, 25, 30, "one", S1, true, ["kitchen", "bath", "office", "ward", "living"], "storage:40", true),
  counter: P("Counter",     HALF, 30, 70, "two", S1, true, ["kitchen", "shop", "bar", "ward"], "storage:50", true),
  crate:   P("Crates",      HALF, 20, 20, "one", S1, true, ["bay", "shop", "cellar", "yard"], "storage:60"),
  rack:    P("Shelving",    FULL, 35, 45, "two", S1, true, ["shop", "bay", "cellar"], "storage:120"),
  table:   P("Table",       HALF, 15, 25, "one", S1, false, ["kitchen", "dining", "living", "office"], "work:table"),
  bed:     P("Bed",         HALF, 20, 22, "one", S12, false, ["bedroom", "ward", "cells"], "bed:bed"),
  bars:    P("Cell bars",   HALF, 60, 120, "fixed", S1, false, ["cells"], "none"),
  hay:     P("Hay bales",   HALF, 15, 25, "one", S1, false, ["barn", "yard"], "none"),
  barrel:  P("Rain barrels", HALF, 15, 25, "one", S1, false, ["yard"], "none"),
  gunsafe: P("Gun safe",    STEEL, 80, 180, "fixed", S1, false, ["armory", "shop", "bedroom"], "storage:40"), // locks.js / gunsafes.js: its own locked container, not an area's box
  // ---------- kitchen and laundry appliances ----------
  fridge:      P("Refrigerator",    FULL, 40, 60, "two", S1, true, ["kitchen", "bar", "office"], "fridge", true), // as data-power.js POWER_GEAR.fridge
  freezer:     P("Chest freezer",   HALF, 35, 45, "two", S21, true, ["kitchen", "cellar", "bay", "shop"], "freezer", true),
  stove:       P("Stove",           HALF, 35, 50, "two", S1, false, ["kitchen"], "stove", true),
  oven:        P("Oven",            HALF, 35, 40, "two", S1, false, ["kitchen"], "oven", true),
  microwave:   P("Microwave",       HALF, 10, 15, "one", S1, false, ["kitchen", "office", "ward"], "microwave", true),
  dishwasher:  P("Dishwasher",      HALF, 25, 35, "two", S1, false, ["kitchen"], "none", true),
  washer:      P("Washing machine", HALF, 30, 65, "two", S1, false, ["laundry", "bath"], "none", true),
  dryer:       P("Tumble dryer",    HALF, 30, 35, "two", S1, false, ["laundry", "bath"], "none", true),
  waterheater: P("Water heater",    FULL, 35, 55, "fixed", S1, false, ["laundry", "cellar", "bath"], "none", true),
  boiler:      P("Boiler",          FULL, 50, 150, "fixed", S1, false, ["cellar", "bay"], "none", true),
  // ---------- bathroom ----------
  sink:    P("Sink",         HALF, 25, 20, "fixed", S1, false, ["kitchen", "bath", "ward"], "none", true),
  toilet:  P("Toilet",       HALF, 20, 30, "fixed", S1, false, ["bath", "cells"], "none", true),
  bathtub: P("Bathtub",      HALF, 40, 100, "fixed", S12, false, ["bath"], "none", true),
  shower:  P("Shower stall", FULL, 20, 40, "fixed", S1, false, ["bath", "ward", "school", "cells"], "none", true),
  // ---------- living rooms and bedrooms ----------
  sofa:       P("Sofa",              HALF, 25, 45, "two", S21, false, ["living", "office"], "comfort:1", true),
  armchair:   P("Armchair",          HALF, 15, 25, "one", S1, false, ["living", "office", "ward"], "comfort:0.5"),
  chair:      P("Chair",             HALF, 8, 6, "one", S1, false, ["kitchen", "dining", "office", "school", "living"], "comfort:0.1"),
  desk:       P("Desk",              HALF, 20, 30, "one", S21, true, ["office", "bedroom", "living"], "work:desk"),
  filing:     P("Filing cabinet",    HALF, 30, 30, "one", S1, true, ["office", "school", "cells"], "storage:30", true),
  bookshelf:  P("Bookshelf",         FULL, 25, 30, "one", S1, true, ["living", "office", "school", "bedroom"], "storage:30", true),
  wardrobe:   P("Wardrobe",          FULL, 30, 50, "two", S1, true, ["bedroom"], "storage:60", true),
  dresser:    P("Chest of drawers",  HALF, 25, 30, "one", S1, true, ["bedroom"], "storage:40", true),
  nightstand: P("Nightstand",        HALF, 10, 8, "one", S1, true, ["bedroom", "ward"], "storage:10"),
  tvstand:    P("TV stand",          HALF, 15, 20, "one", S1, true, ["living", "bar", "ward"], "storage:15", true),
  piano:      P("Piano",             STEEL, 50, 230, "two", S21, false, ["living", "church", "school", "bar"], "comfort:1", true),
  // ---------- churches ----------
  pew:    P("Pew",    HALF, 30, 60, "two", S21, false, ["church"], "comfort:0"),
  altar:  P("Altar",  HALF, 40, 120, "fixed", S21, false, ["church"], "none"),
  pulpit: P("Pulpit", HALF, 20, 35, "two", S1, false, ["church", "school"], "none"),
  // ---------- hospitals, clinics and vets ----------
  hospbed: P("Hospital bed",     HALF, 25, 70, "two", S12, false, ["ward"], "bed:bed"),
  gurney:  P("Gurney",           HALF, 15, 35, "two", S12, false, ["ward", "bay"], "bed:cot"),
  ivstand: P("IV stand",         POLE, 5, 5, "one", S1, false, ["ward"], "none"),
  medcab:  P("Medicine cabinet", HALF, 20, 20, "one", S1, true, ["ward", "bath", "office"], "storage:15", true),
  medcart: P("Medication cart",  HALF, 15, 30, "one", S1, true, ["ward"], "storage:20"),
  optable: P("Operating table",  HALF, 30, 90, "two", S12, false, ["ward"], "work:surgery"),
  // The hospital, clinic and vet rooms room by room (issue #14, roomlayout.js MEDICAL_STYLES): an ER bay's curtain (the
  // dead push through it: 5 hp), the pharmacy's drug safe (its container always locked: locks.js "drugs"), the
  // theatre's instrument cabinet, the morgue's body drawers and table, the corridor's wheelchairs, the laundry's carts,
  // the ICU's monitor on its stand, the maternity ward's cots (crib), an exam bed, a vet's steel table.
  curtain:      P("Privacy curtain",    HALF, 5, 5, "one", S1, false, ["ward"], "none"),
  drugsafe:     P("Drug safe",          STEEL, 80, 120, "two", S1, true, ["ward", "shop"], "storage:20", true),
  instcab:      P("Instrument cabinet", FULL, 25, 40, "two", S1, true, ["ward"], "storage:20", true),
  morguelocker: P("Morgue drawers",     STEEL, 60, 150, "two", S1, true, ["ward"], "storage:40", true),
  autopsy:      P("Autopsy table",      HALF, 30, 80, "two", S12, false, ["ward"], "work:table"),
  wheelchair:   P("Wheelchair",         HALF, 10, 15, "one", S1, false, ["ward"], "comfort:0.1"),
  linencart:    P("Linen cart",         HALF, 10, 20, "one", S1, false, ["ward", "laundry"], "none"),
  monitor:      P("Patient monitor",    POLE, 5, 12, "one", S1, false, ["ward"], "none"),
  crib:         P("Infant cot",         HALF, 10, 15, "one", S1, false, ["ward", "bedroom"], "none"), // "crib": #15's cot is a camp cot
  exambed:      P("Exam bed",           HALF, 15, 40, "two", S12, false, ["ward"], "bed:cot"),
  vettable:     P("Steel exam table",   HALF, 20, 40, "two", S1, false, ["ward"], "work:table"),
  // ---------- shops, restaurants and bars ----------
  vending:     P("Vending machine", FULL, 60, 200, "two", S1, true, ["shop", "office", "school", "ward"], "storage:60", true),
  checkout:    P("Checkout",        HALF, 30, 40, "two", S1, true, ["shop", "bar"], "storage:20"),
  displaycase: P("Display case",    HALF, 20, 45, "two", S1, true, ["shop"], "storage:30"),
  coldcase:    P("Cold case",       FULL, 40, 120, "two", S1, true, ["shop", "bar"], "fridge", true),
  booth:       P("Booth",           HALF, 30, 80, "fixed", S21, false, ["dining", "bar"], "none"),
  barcounter:  P("Bar counter",     HALF, 35, 150, "fixed", S1, false, ["bar"], "none"),
  barstool:    P("Bar stool",       HALF, 8, 6, "one", S1, false, ["bar", "kitchen"], "comfort:0.1"),
  // ---------- shops, restaurants, bars, offices, motels, banks and big stores (issue #16: shoplayout.js lays them) ----------
  // A cold-room shelf, a cold case and a server rack hold their own tables (combat.js BOX_LOOT); the ATM is fixed and
  // is its own container (buildingmaps.js puts one at a bank's door, as a safe), not an area's box.
  range:        P("Range",              HALF, 40, 120, "two", S1, false, ["kitchen"], "stove", true), // six rings and an oven under them
  fryer:        P("Deep fryer",         HALF, 25, 55, "two", S1, false, ["kitchen"], "none", true),
  pizzaoven:    P("Pizza oven",         STEEL, 60, 450, "fixed", S21, false, ["kitchen"], "oven", true), // brick-lined, built in
  coldshelf:    P("Cold-room shelving", HALF, 25, 40, "two", S1, true, ["kitchen", "shop"], "storage:60", true),
  jukebox:      P("Jukebox",            C(false, 1, false), 25, 110, "two", S1, false, ["bar"], "comfort:0.5", true),
  pooltable:    P("Pool table",         HALF, 50, 300, "two", S21, false, ["bar"], "comfort:0.5"),
  clothesrack:  P("Clothes rack",       HALF, 10, 18, "one", S1, true, ["shop"], "storage:20"),
  tank:         P("Fish tank",          C(false, 1, false), 15, 70, "two", S1, false, ["shop"], "none", true),
  pottingbench: P("Potting bench",      HALF, 20, 40, "two", S21, true, ["shop", "yard"], "work:table", true),
  palletrack:   P("Pallet rack",        FULL, 50, 160, "two", S1, true, ["bay", "shop"], "storage:200"),
  tirerack:     P("Tyre rack",          HALF, 30, 60, "two", S1, true, ["bay"], "storage:40", true),
  carlift:      P("Car lift",           C(false, 1, false), 80, 900, "fixed", S1, false, ["bay"], "none"),
  machine:      P("Machine tool",       STEEL, 80, 900, "fixed", S21, false, ["bay"], "none"), // a lathe, a press, a mill: bolted down
  forklift:     P("Forklift",           STEEL, 80, 3000, "fixed", S12, false, ["bay"], "none"),
  saddlerack:   P("Saddle rack",        HALF, 15, 25, "one", S1, true, ["barn"], "storage:20", true),
  cubicle:      P("Cubicle partition",  C(false, 1, false), 10, 15, "one", S1, false, ["office"], "none"),
  whiteboard:   P("Whiteboard",         POLE, 5, 8, "one", S1, false, ["office", "school"], "none", true),
  watercooler:  P("Water cooler",       HALF, 10, 20, "one", S1, false, ["office"], "none", true),
  secdesk:      P("Security desk",      HALF, 30, 60, "two", S21, true, ["office"], "work:desk"), // the monitors on it
  keyrack:      P("Key rack",           POLE, 5, 3, "one", S1, false, ["office"], "none", true),
  icemachine:   P("Ice machine",        FULL, 40, 90, "two", S1, false, ["shop", "office"], "none", true),
  teller:       P("Teller window",      C(false, 1, false), 40, 200, "fixed", S1, false, ["office"], "none"), // a counter under a glass screen
  deposit:      P("Safe-deposit boxes", STEEL, 60, 160, "two", S1, true, ["office"], "storage:20", true),
  atm:          P("ATM",                STEEL, 80, 400, "fixed", S1, false, ["shop", "office"], "none", true),
  stanchion:    P("Queue post",         POLE, 3, 6, "one", S1, false, ["office", "shop"], "none"),
  // ---------- workshops, bays and garages ----------
  workbench: P("Workbench",  HALF, 35, 60, "two", S21, true, ["bay", "cellar", "school"], "work:workbench", true),
  toolchest: P("Tool chest", HALF, 35, 55, "two", S1, true, ["bay", "cellar"], "storage:40", true),
  // ---------- police, fire stations, barracks, schools, offices ----------
  bunk:        P("Bunk",           HALF, 25, 40, "two", S12, false, ["cells", "bedroom", "ward"], "bed:bunkbed"),
  schooldesk:  P("School desk",    HALF, 10, 12, "one", S1, true, ["school"], "storage:5"),
  teacherdesk: P("Teacher's desk", HALF, 25, 40, "two", S21, true, ["school", "office"], "work:desk"),
  bleachers:   P("Bleachers",      HALF, 50, 200, "fixed", S22, false, ["school"], "none"),
  serverrack:  P("Server rack",    FULL, 50, 120, "two", S1, true, ["office"], "none", true),
  copier:      P("Photocopier",    HALF, 30, 80, "two", S1, false, ["office", "school"], "none", true),
  safe:        P("Safe",           STEEL, 80, 200, "fixed", S1, false, ["office", "bedroom", "shop"], "storage:20"), // the gun safe's rules (locks.js: its own lock, never shoved)
  // ---------- police, fire stations, schools and churches laid out for their kind (issue #15: civiclayout.js) ----------
  // The armory's gun racks and ammo cabinets, the evidence room's lockers, a fire station's turnout lockers, a school
  // corridor's narrow lockers and a gym's storage cage are containers with their own tables (combat.js BOX_LOOT); a cot
  // (a gym or a nave used as a shelter: interiorscenes.js) is data-beds.js's own Cot item (FURNITURE_ITEM_KEY).
  gunrack:     P("Gun rack",          HALF, 35, 40, "two", S1, true, ["armory", "shop"], "storage:30", true), // a gun store's too (shoplayout.js, issue #16)
  ammocab:     P("Ammo cabinet",      FULL, 45, 60, "two", S1, true, ["armory"], "storage:40", true),
  evlocker:    P("Evidence locker",   FULL, 40, 45, "two", S1, true, ["evidence", "office"], "storage:40", true),
  turnout:     P("Turnout locker",    FULL, 35, 40, "two", S1, true, ["bay"], "storage:40", true),
  schoollocker: P("School lockers",   FULL, 30, 35, "two", S1, true, ["school"], "storage:20", true),
  sportcage:   P("Storage cage",      HALF, 40, 50, "two", S1, true, ["school"], "storage:80", true),
  labbench:    P("Lab bench",         HALF, 40, 70, "two", S21, true, ["school", "lab"], "work:workbench", true),
  weightbench: P("Weight bench",      HALF, 25, 40, "two", S12, false, ["school", "bay"], "comfort:0.2"),
  compressor:  P("Air compressor",    HALF, 30, 45, "two", S1, false, ["bay"], "none", true),
  cot:         P("Cot",               HALF, 8, 7, "one", S12, false, ["school", "church", "ward"], "bed:cot"),
  candles:     P("Candlesticks",      POLE, 5, 6, "one", S1, true, ["church"], "comfort:0.1"),
  // ---------- military bases, air bases, airports and prisons laid out like the real thing (issue #25: militarylayout.js) ----------
  // A soldier's footlocker at the foot of a bunk (personal kit, a sidearm now and then), a suitcase in an airport's baggage hall, an ammo crate (rounds and
  // grenades), a radio console (radios), a fuel bladder (fuel) and an inmate's property locker (what was taken off them
  // at intake) hold their own tables (combat.js BOX_LOOT). The map table, the barrier gate, the guard booth, the jet
  // engine stand, the baggage belt, the security scanner and the gate seating are furniture only. The field cot is #15's
  // cot, the vehicle lift #16's car lift and the sandbag wall the sandbag cell; the aircraft and helicopter wrecks are
  // vehicles (combat.js placeCar with a body: ui/vehiclemodel.js jet, cargoplane, helo), each one container.
  footlocker:   P("Footlocker",        HALF, 25, 18, "one", S1, true, ["bedroom", "cells", "armory"], "storage:40"),
  maptable:     P("Map table",         HALF, 30, 45, "two", S21, false, ["office"], "work:table"),
  radioconsole: P("Radio console",     HALF, 30, 40, "two", S1, true, ["office"], "none", true),
  ammocrate:    P("Ammo crate",        HALF, 25, 28, "one", S1, true, ["armory", "bay"], "storage:40"),
  barrier:      P("Barrier gate",      HALF, 30, 80, "fixed", S1, false, ["yard"], "none"),
  guardbooth:   P("Guard booth",       FULL, 60, 300, "fixed", S1, false, ["yard"], "none"),
  fuelbladder:  P("Fuel bladder",      HALF, 30, 90, "two", S22, true, ["yard", "bay"], "storage:200"),
  enginestand:  P("Jet engine stand",  STEEL, 60, 900, "fixed", S21, false, ["bay"], "none"),
  baggagebelt:  P("Baggage belt",      HALF, 40, 200, "fixed", S1, false, ["shop"], "none"),
  scanner:      P("Security scanner",  C(false, 1, false), 50, 300, "fixed", S21, false, ["shop"], "none"),
  gateseat:     P("Gate seating",      HALF, 20, 40, "two", S21, false, ["shop", "office"], "comfort:0.3"),
  intakelocker: P("Property locker",   FULL, 40, 45, "two", S1, true, ["cells"], "storage:40", true),
  luggage:      P("Luggage",           HALF, 10, 16, "one", S1, true, ["shop", "yard"], "storage:30"), // an airport's baggage hall and its belts: suitcases, a container each
  // ---------- lootable decor (issue #13: decor.js places them; light comfort pieces for the base) ----------
  // The plant and the floor lamp stand on a room's floor cell; the painting and the wall clock hang on a wall (decor.js:
  // c.wart = { k, d, piece: true } on the wall cell, the wall's own kind unchanged) and stand on a cell only once set down.
  plant:     P("Potted plant", POLE, 5, 8, "one", S1, false, ["living", "office", "dining", "ward", "shop"], "comfort:0.2"),
  floorlamp: P("Floor lamp",   POLE, 5, 6, "one", S1, false, ["living", "bedroom", "office"], "comfort:0.1"),
  painting:  P("Painting",     POLE, 5, 4, "one", S1, false, ["living", "dining", "bedroom", "office", "church"], "comfort:0.2", true),
  wallclock: P("Wall clock",   POLE, 3, 2, "one", S1, false, ["living", "kitchen", "office", "school", "ward"], "comfort:0.05", true),
};

// The cells' rules for combat.js CELL (merged at load: Object.assign(CELL, furnitureCells())).
export function furnitureCells() {
  /** @type {Record<string, CellDef & { name: string }>} */
  const out = {};
  for (const [k, d] of Object.entries(FURNITURE_KINDS)) out[k] = { ...d.cell, name: d.name };
  return out;
}
// What can be shoved and battered (barricade.js FURNITURE): every piece that is not fixed, with its hit points.
export function furnitureHp() {
  /** @type {Record<string, { hp: number }>} */
  const out = {};
  for (const [k, d] of Object.entries(FURNITURE_KINDS)) if (d.carry !== "fixed") out[k] = { hp: d.hp };
  return out;
}
export const isFurniture = (k) => !!FURNITURE_KINDS[k];
// The kinds for a room role ("kitchen", "bath"...), the containers only with loot: true (the layout tickets).
export const furnitureFor = (tag, loot = null) => Object.keys(FURNITURE_KINDS).filter((k) => FURNITURE_KINDS[k].tags.includes(tag) && (loot == null || FURNITURE_KINDS[k].loot === loot));
// A piece's base use split into its key and its number or name ("storage:40" → { key: "storage", arg: "40" }).
export function useOf(k) {
  const u = (FURNITURE_KINDS[k] && FURNITURE_KINDS[k].use) || "none", i = u.indexOf(":");
  return i < 0 ? { key: u, arg: null } : { key: u.slice(0, i), arg: u.slice(i + 1) };
}
// The row for a cell kind, or null (the sibling tickets' lookup).
export const pieceDef = (k) => FURNITURE_KINDS[k] || null;

// The item form of every piece that can be lifted (not fixed), for the pick-up ticket (#12) to merge into data.js GEAR:
// keyed f_<kind>, in both arms only (bulky, twoHands, the In arms slot, a cart or a vehicle, as data-beds.js BED_GEAR),
// furniture: its cell kind (set down again as that cell), weight its kg. The fridge keeps its own item, data-power.js
// POWER_GEAR.fridge (key "fridge"), so it has no f_fridge; the cot is data-beds.js's BED_GEAR.cot (a base's camp bed),
// so it has no f_cot. Merged into GEAR by data.js (marked piece: kept out of the starting kits and trunks, whose dice
// would change). itemKey(k): the item key for a cell kind (null when fixed).
export const FURNITURE_ITEM_KEY = { fridge: "fridge", cot: "cot" };
export const itemKey = (k) => (!FURNITURE_KINDS[k] || FURNITURE_KINDS[k].carry === "fixed" ? null : FURNITURE_ITEM_KEY[k] || `f_${k}`);
/** @type {Record<string, { name: string, slot: string, skill: null, power: number, req: number, value: number, noise: number, weight: number, cat: string, bulky: boolean, twoHands: boolean, furniture: string, desc: string }>} */
export const FURNITURE_GEAR = {};
for (const [k, d] of Object.entries(FURNITURE_KINDS)) {
  const key = itemKey(k);
  if (!key || key !== `f_${k}`) continue; // the fridge's and the cot's items are their own
  FURNITURE_GEAR[key] = {
    name: d.name, slot: "pack", skill: null, power: 0, req: 0, value: Math.max(1, Math.round(d.kg / 4)), noise: 0, weight: d.kg, cat: "household", bulky: true, twoHands: true, furniture: k,
    desc: `${d.name}: ${d.kg} kg, ${d.carry === "two" ? "a two-person lift" : "one person can lift it, very slowly"}. Both arms, a cart or a vehicle.`,
  };
}
