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
  // ---------- hotels (issue #29: hotellayout.js lays them) ----------
  // The reception desk (its drawers searched; the key rack stands behind it), a guest's suitcase (a luggage room's or a
  // room's: clothes, toiletries, a phone, now and then a pistol or meds: combat.js BOX_LOOT), a room's minibar (snacks,
  // drinks, little bottles), the luggage cart, the ballroom's round banquet tables (the lift lobby's lift doors are
  // #27's liftdoor below), the lobby's lounge chairs, the pool deck's loungers and a tennis court's net.
  frontdesk:   P("Reception desk",    HALF, 35, 80, "two", S21, true, ["office"], "storage:40"),
  suitcase:    P("Suitcase",          HALF, 8, 12, "one", S1, true, ["bedroom", "office"], "storage:30"),
  minifridge:  P("Mini fridge",       HALF, 15, 20, "one", S1, true, ["bedroom", "office"], "storage:15", true),
  luggagecart: P("Luggage cart",      HALF, 15, 25, "one", S1, false, ["office", "bedroom"], "storage:60"),
  banquet:     P("Banquet table",     HALF, 20, 30, "one", S1, false, ["dining"], "work:table"),
  loungechair: P("Lounge chair",      HALF, 15, 25, "one", S1, false, ["living", "office"], "comfort:0.5"),
  lounger:     P("Pool lounger",      HALF, 8, 12, "one", S1, false, ["yard"], "comfort:0.3"),
  tennisnet:   P("Tennis net",        POLE, 5, 15, "fixed", S1, false, ["yard"], "none"),
  // ---------- grocery stores by size (issue #22: shoplayout.js cornerstore, grocerfloor, superstore, the back of house) ----------
  // The freezer case (an upright glass-door freezer), the island freezer and the butcher's case are appliances at a base
  // (data-appliances.js freezer_case, island_freezer, meat_case: #19's rules through their use); each holds its own table
  // in a raid (combat.js BOX_LOOT: frozen food gone bad but in winter, spoiled meat), as do the produce bins, the bread
  // rack, the freezer shelving of a walk-in freezer and the self-checkout's till. The cart corral and the baler are
  // bolted down; the aisle marker is the sign on a post at the head of a supermarket's aisle (decor).
  freezercase:   P("Freezer case",      FULL, 40, 130, "two", S1, true, ["shop"], "freezer", true),
  islandfreezer: P("Island freezer",    HALF, 35, 110, "two", S21, true, ["shop"], "freezer"),
  meatcase:      P("Butcher's case",    HALF, 30, 140, "two", S1, true, ["shop", "kitchen"], "fridge"),
  freezershelf:  P("Freezer shelving",  HALF, 25, 40, "two", S1, true, ["kitchen", "shop"], "storage:60", true),
  producebin:    P("Produce bins",      HALF, 15, 28, "one", S1, true, ["shop"], "storage:30"),
  breadrack:     P("Bread rack",        C(false, 1, false), 15, 20, "one", S1, true, ["shop", "kitchen"], "storage:20", true),
  selfcheckout:  P("Self-checkout",     HALF, 30, 60, "two", S1, true, ["shop"], "storage:10"),
  cartcorral:    P("Cart corral",       C(false, 1, false), 40, 150, "fixed", S21, false, ["shop"], "none"),
  baler:         P("Baler",             STEEL, 80, 700, "fixed", S1, false, ["bay", "shop"], "none", true),
  aislesign:     P("Aisle marker",      POLE, 5, 6, "one", S1, false, ["shop"], "none"),
  // ---------- shopping malls (issue #30, mall.js / malllayout.js) ----------
  kiosk:       P("Kiosk cart",         HALF, 30, 90, "two", S21, true, ["shop", "mall"], "storage:60"),
  mallbench:   P("Mall bench",         HALF, 25, 60, "fixed", S21, false, ["mall", "yard"], "none"),
  planter:     P("Planter",            HALF, 45, 300, "fixed", S22, false, ["mall", "yard"], "none"),
  directory:   P("Mall directory",     C(false, 1, false), 25, 80, "fixed", S1, false, ["mall"], "none"),
  escalator:   P("Escalator",          HALF, 120, 2000, "fixed", S1, false, ["mall"], "none"),
  cinemaseat:  P("Cinema seats",       HALF, 20, 60, "fixed", S21, false, ["mall"], "none"),
  projector:   P("Film projector",     HALF, 30, 70, "two", S1, false, ["mall", "office"], "none"),
  concession:  P("Concession counter", HALF, 35, 90, "two", S21, true, ["shop", "mall", "bar"], "storage:50", true),
  arcadecab:   P("Arcade cabinet",     FULL, 40, 110, "two", S1, true, ["mall", "bar"], "comfort:0.4", true),
  carousel:    P("Carousel",           HALF, 60, 1500, "fixed", S22, false, ["mall"], "none"),
  mannequin:   P("Mannequin",          POLE, 8, 12, "one", S1, false, ["shop", "mall"], "none"),
  dumpster:    P("Dumpster",           HALF, 60, 400, "fixed", S1, false, ["yard"], "none"),
  // ---------- restaurants by kind of food, format and size (issue #33: eaterylayout.js lays them) ----------
  // The cooking line by cuisine (a flat-top, deck and conveyor pizza ovens, a wok range, a clay tandoor, a smoker, a char
  // grill, a gyro spit, a stockpot burner, steam tables, an espresso machine, a soft-serve machine, a slicer, a tortilla
  // press), the dish pit's dish machine, the grease trap by the back door, the fire extinguisher; the front of house (a
  // drive-through window, a sushi conveyor, a salad bar, a menu board on the wall, a play structure, a patio umbrella
  // table, a host stand, a white-cloth table, a Korean grill table, a stage); the bar and the cases (a beer tap tower,
  // brewing tanks, a lobster tank, a pastry case, a dipping cabinet, a wine rack) and the dry store's shelving. The
  // pastry case, the dipping cabinet, the wine rack and the dry-goods shelving hold their own tables (combat.js BOX_LOOT);
  // the rest is the line itself, liftable where a pair of people could get it out of the door.
  flattop:      P("Flat-top grill",     HALF, 35, 90, "two", S1, false, ["kitchen"], "none", true),
  deckoven:     P("Deck oven",          STEEL, 50, 180, "two", S1, false, ["kitchen"], "none", true),
  conveyoroven: P("Conveyor oven",      HALF, 40, 140, "two", S21, false, ["kitchen"], "none", true),
  wokrange:     P("Wok range",          HALF, 40, 130, "two", S1, false, ["kitchen"], "none", true),
  tandoor:      P("Tandoor",            STEEL, 60, 300, "fixed", S1, false, ["kitchen"], "none", true), // a clay oven set in brick
  smoker:       P("Smoker",             STEEL, 50, 180, "two", S21, false, ["kitchen", "yard"], "none"),
  chargrill:    P("Char grill",         HALF, 35, 100, "two", S1, false, ["kitchen"], "none", true),
  gyrospit:     P("Gyro spit",          HALF, 15, 25, "one", S1, false, ["kitchen"], "none", true),
  stockpot:     P("Stockpot burner",    HALF, 30, 40, "two", S1, false, ["kitchen"], "none", true),
  steamtable:   P("Steam table",        HALF, 30, 80, "two", S21, false, ["kitchen", "dining"], "none"),
  espresso:     P("Espresso machine",   HALF, 15, 28, "one", S1, false, ["kitchen", "dining"], "none", true),
  softserve:    P("Soft-serve machine", FULL, 35, 120, "two", S1, false, ["kitchen", "dining"], "none", true),
  slicer:       P("Meat slicer",        HALF, 10, 20, "one", S1, false, ["kitchen"], "none", true),
  tortillapress: P("Tortilla press",    HALF, 10, 12, "one", S1, false, ["kitchen"], "none", true),
  dishpit:      P("Dish machine",       HALF, 40, 150, "fixed", S1, false, ["kitchen"], "none", true), // plumbed in: the dish pit's washer and its three sinks
  greasetrap:   P("Grease trap",        HALF, 60, 120, "fixed", S1, false, ["yard"], "none"),
  extinguisher: P("Fire extinguisher",  POLE, 5, 8, "one", S1, false, ["kitchen"], "none", true),
  drivewindow:  P("Drive-through window", C(false, 1, false), 50, 80, "fixed", S1, false, ["kitchen"], "none", true),
  sushibar:     P("Sushi conveyor",     HALF, 35, 150, "fixed", S1, false, ["dining"], "none"),
  saladbar:     P("Salad bar",          HALF, 30, 90, "two", S21, false, ["dining"], "none"),
  menuboard:    P("Menu board",         POLE, 5, 8, "one", S1, false, ["dining"], "none", true),
  playplace:    P("Play structure",     C(false, 1, false), 60, 400, "fixed", S22, false, ["dining"], "none"),
  patiotable:   P("Patio umbrella table", HALF, 15, 25, "one", S1, false, ["yard", "dining"], "work:table"),
  hoststand:    P("Host stand",         HALF, 15, 20, "one", S1, false, ["dining"], "none"),
  clothtable:   P("White-cloth table",  HALF, 15, 25, "one", S1, false, ["dining"], "work:table"),
  kbbqtable:    P("Grill table",        HALF, 30, 60, "two", S21, false, ["dining"], "work:table"), // a Korean barbecue's: a gas grill set in the middle
  stage:        P("Stage",              HALF, 60, 300, "fixed", S22, false, ["dining", "bar"], "none"),
  beertower:    P("Beer tap tower",     HALF, 10, 15, "one", S1, false, ["bar"], "none", true),
  brewtank:     P("Brewing tank",       STEEL, 70, 600, "fixed", S1, false, ["bar"], "none"),
  lobstertank:  P("Lobster tank",       C(false, 1, false), 20, 90, "two", S1, false, ["dining"], "none", true),
  pastrycase:   P("Pastry case",        HALF, 20, 70, "two", S1, true, ["dining", "shop"], "storage:20"),
  dipcabinet:   P("Dipping cabinet",    HALF, 30, 120, "two", S21, true, ["dining", "shop"], "storage:40"),
  winerack:     P("Wine rack",          FULL, 25, 60, "two", S1, true, ["cellar", "bar", "dining"], "storage:40", true),
  dryshelf:     P("Dry-goods shelving", FULL, 35, 45, "two", S1, true, ["kitchen", "cellar"], "storage:100", true),
  // ---------- workshops, bays and garages ----------
  workbench:P("Workbench",  HALF, 35, 60, "two", S21, true, ["bay", "cellar", "school"], "work:workbench", true),
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
  // ---------- prisons and jails (issue #31: prisonlayout.js lays them) ----------
  // A cell's steel bunk (a shelf over it) and its steel toilet-and-sink unit are bolted to the wall; a day room's steel
  // table has its four stools fixed to it; a control room's panel of door switches and monitors (its switch opens a
  // block's cell doors: prison.js cellSwitch); a visitation booth's glass partition and phone (seen through, half cover).
  // The property room's lockers are #25's intake lockers, the metal detector #27's walk-through scanner and #25's X-ray
  // scanner (rows below).
  steelbunk:   P("Steel bunk",          HALF, 60, 70, "fixed", S12, false, ["cells"], "none", true),
  steeltoilet: P("Steel toilet and sink", HALF, 50, 55, "fixed", S1, false, ["cells", "bath"], "none", true),
  daytable:    P("Day-room table",      HALF, 60, 160, "fixed", S22, false, ["cells", "dining"], "none"),
  ctrlpanel:   P("Control panel",       HALF, 50, 120, "fixed", S21, false, ["office", "control"], "none", true),
  visitbooth:  P("Visitation booth",    HALF, 40, 90, "fixed", S1, false, ["office"], "none"),
  // ---------- college campuses (issue #28: campuslayout.js lays them; campus.js the grounds) ----------
  // A dorm room's desk with its hutch (its mini fridge is #29's minibar piece, `minifridge`), a lecture hall's bolted
  // row of seats (its lectern, a library's study carrel: #34's; a teaching lab's fume hood: #37's `fumehood`), a residence hall's
  // wall of mailboxes; outdoors a bench, a statue on its plinth and a fountain on the quads and in the courtyards.
  dormdesk:    P("Dorm desk",        HALF, 20, 25, "one", S1, true, ["bedroom", "school"], "work:desk", true),
  lectureseat: P("Lecture seating",  HALF, 40, 120, "fixed", S21, false, ["school"], "none"),
  mailboxes:   P("Mailbox wall",     FULL, 50, 90, "two", S1, true, ["office", "school"], "storage:20", true),
  campusbench: P("Bench",            HALF, 20, 40, "two", S21, false, ["yard"], "comfort:0.3"),
  statue:      P("Statue",           STEEL, 120, 900, "fixed", S1, false, ["yard"], "none"),
  fountain:    P("Fountain",         HALF, 80, 1500, "fixed", S22, false, ["yard", "mall"], "none"), // a campus's quad and a mall's centre court (#28, #30)
  // ---------- churchyards (issue #49: civicsite.js lays them) ----------
  // A headstone in a churchyard's rows: a low slab of stone, half cover, never lifted.
  headstone:   P("Headstone",        HALF, 60, 300, "fixed", S1, false, ["yard"], "none"),
  // ---------- bunkers (issue #26: bunkerlayout.js lays them) ----------
  // The fixed fittings: the steel frame round a blast door, the air filtration plant, the water and fuel tanks, a
  // decontamination shower, the escape shaft's ladder and the vent stack up on the hillside. The hazmat suit rack and the
  // ration shelf hold loot (the suits, the MREs and tins), so by the rule above (nothing lootable is fixed) they lift as
  // two-person pieces. Liftable: a hand-cranked air filter, a wall of screens, a map table, a radio console, a footlocker
  // (named to be reused: a barracks' bunks, issue #25), a solar battery rack, and the generator (data-power.js's own
  // Military tactical generator item: FURNITURE_ITEM_KEY, set at a base like any found set).
  blastframe:   P("Blast door frame",       STEEL, 120, 600, "fixed", S1, false, ["bunker"], "none"),
  airfilter:    P("Air filtration unit",    FULL, 60, 250, "fixed", S21, false, ["bunker"], "none", true),
  watertank:    P("Water tank",             FULL, 60, 300, "fixed", S1, false, ["bunker", "cellar"], "none"),
  fueltank:     P("Fuel tank",              FULL, 70, 400, "fixed", S21, false, ["bunker", "bay"], "none", true),
  deconshower:  P("Decontamination shower", FULL, 30, 60, "fixed", S1, false, ["bunker"], "none", true),
  escapeladder: P("Escape ladder",          POLE, 40, 60, "fixed", S1, false, ["bunker"], "none", true),
  ventstack:    P("Vent stack",             STEEL, 80, 300, "fixed", S1, false, ["bunker", "yard"], "none"),
  hazmatrack:   P("Hazmat suit rack",       HALF, 20, 40, "two", S1, true, ["bunker"], "storage:30", true),
  rationshelf:  P("Ration shelf",           FULL, 35, 50, "two", S1, true, ["bunker", "cellar"], "storage:150", true),
  handfilter:   P("Hand-cranked air filter", HALF, 20, 28, "one", S1, false, ["bunker"], "none", true),
  screens:      P("Wall of screens",        FULL, 30, 60, "two", S21, false, ["bunker", "office"], "none", true),
  maptable:     P("Map table",              HALF, 30, 70, "two", S21, false, ["bunker", "office"], "work:table"),
  radioconsole: P("Radio console",          HALF, 30, 45, "two", S21, true, ["bunker", "office"], "storage:10", true),
  footlocker:   P("Footlocker",             HALF, 20, 18, "one", S1, true, ["bunker", "bedroom", "cells"], "storage:40"),
  batteries:    P("Solar battery rack",     HALF, 30, 80, "two", S1, false, ["bunker", "cellar"], "none", true),
  genset:       P("Military generator",     STEEL, 80, 140, "two", S22, false, ["bunker", "bay"], "none"),
  // ---------- libraries (issue #34: librarylayout.js lays them) ----------
  // The shelving: a library's tall double-sided stacks (old libraries), low shelving (modern ones), compact mobile
  // shelving on its rails (archives), a card catalogue's drawers, a map cabinet's flat drawers, a book cart and the book
  // return: all hold loot (books, papers, maps), so they lift. The modern library's computer desk, printer, self-check
  // station and microfilm reader; the reading room's long reading table with its green lamps, a study carrel, a globe, a
  // lectern and a cast-iron wood stove (a rural reading room's heat). Fixed: a hearth (a historic library's fireplace),
  // the rows of auditorium seats bolted down, a gallery's railing and the gallery's open well (the floor cut away over the
  // reading hall below: nobody stands there). The beanbags and the lift doors are #27's rows (below).
  bookstack:   P("Library stacks",        FULL, 30, 60, "two", S1, true, ["library"], "storage:40"),
  lowshelf:    P("Low shelving",          HALF, 20, 25, "one", S1, true, ["library", "school"], "storage:30"),
  mobileshelf: P("Compact mobile shelving", FULL, 50, 150, "two", S1, true, ["library", "office"], "storage:80"),
  cardcat:     P("Card catalogue",        HALF, 25, 45, "two", S1, true, ["library"], "storage:20", true),
  mapcase:     P("Map cabinet",           HALF, 30, 80, "two", S21, true, ["library", "office"], "storage:30", true),
  booktruck:   P("Book cart",             HALF, 10, 18, "one", S1, true, ["library", "school"], "storage:20"),
  bookreturn:  P("Book return",           HALF, 25, 40, "two", S1, true, ["library"], "storage:40", true),
  computer:    P("Computer desk",         HALF, 15, 28, "one", S1, true, ["library", "office", "school"], "work:desk", true),
  printer:     P("Printer",               HALF, 12, 22, "one", S1, true, ["library", "office"], "storage:5", true),
  microfilm:   P("Microfilm reader",      HALF, 15, 26, "one", S1, true, ["library"], "storage:5", true),
  selfcheck:   P("Self-check station",    HALF, 20, 38, "two", S1, false, ["library", "shop"], "none"),
  readtable:   P("Reading table",         HALF, 25, 55, "two", S21, false, ["library", "office", "dining"], "work:table"),
  carrel:      P("Study carrel",          HALF, 15, 28, "one", S1, false, ["library", "school"], "work:desk", true),
  globe:       P("Globe",                 POLE, 8, 9, "one", S1, false, ["library", "office", "school"], "comfort:0.1"),
  lectern:     P("Lectern",               HALF, 12, 16, "one", S1, false, ["library", "school", "church"], "none"),
  woodstove:   P("Wood stove",            HALF, 60, 110, "two", S1, false, ["library", "living", "cabin"], "stove"),
  fireplace:   P("Fireplace",             FULL, 120, 900, "fixed", S21, false, ["library", "living"], "none", true),
  audseat:     P("Auditorium seats",      HALF, 30, 90, "fixed", S1, false, ["library", "school", "church"], "none"),
  railing:     P("Gallery railing",       HALF, 40, 60, "fixed", S1, false, ["library"], "none"),
  galleryvoid: P("Open to the hall below", C(false, 0, false), 999, 1, "fixed", S1, false, ["library"], "none"),
  // ---------- warehouses, factories and labs (issue #37: industrylayout.js lays them) ----------
  // Fixed: a fume hood (ducted up through the roof), a conveyor (a section of a bolted line), a process tank (a dye vat,
  // a reactor, a fermenter, a syrup tank, a tank farm's fuel or a water works' settling tank), a kiln (firebrick), a
  // power loom and a grain bin (corrugated steel on its slab). Liftable: the lab freezer (an upright −80 freezer, two
  // people; with no power since the fall it holds nothing cold, so at a base it is a steel cabinet: storage) and a fuel
  // drum (a fuel depot's: what is left in it, then a drum to keep things in).
  fumehood:   P("Fume hood",     FULL, 40, 250, "fixed", S1, false, ["lab"], "none", true),
  conveyor:   P("Conveyor",      C(false, 1, false), 40, 200, "fixed", S1, false, ["bay"], "none"),
  vat:        P("Process tank",  FULL, 70, 800, "fixed", S1, false, ["bay", "yard"], "none"),
  kiln:       P("Kiln",          FULL, 120, 3000, "fixed", S1, false, ["bay"], "none", true),
  loom:       P("Loom",          HALF, 60, 900, "fixed", S21, false, ["bay"], "none"),
  grainbin:   P("Grain bin",     STEEL, 150, 4000, "fixed", S1, false, ["yard"], "none"),
  labfreezer: P("Lab freezer",   FULL, 40, 120, "two", S1, true, ["lab"], "storage:40", true),
  drum:       P("Fuel drum",     HALF, 25, 40, "two", S1, true, ["bay", "yard"], "storage:60"),
  // ---------- mines and quarries (issue #52: minelayout.js lays them) ----------
  // Fixed: the headframe's shaft and cage (the collar of the shaft, the cage in its guides under the sheave wheels), the
  // hoist drum, the ore chute (an ore pass's or a tipple's bin and its gate), a cave-in (a rock fall across a drift: no
  // way through), a timber set (the posts and cap holding a drift's back), a rock pillar (coal or salt left standing),
  // the jaw crusher, the screen deck, a stockpile (gravel, ore, spoil: a heap in a yard, on a dump, in a stope).
  // Liftable: an ore car (two people: ore as stone and scrap, combat.js BOX_LOOT orecart), a cap-lamp rack (a lamp room's
  // charging rack: lamps, batteries, hard hats; BOX_LOOT lamprack) and an explosives box (a magazine's day box, locked:
  // the explosives, rare; BOX_LOOT powderbox).
  headframe:  P("Shaft and cage",   STEEL, 200, 6000, "fixed", S22, false, ["bay"], "none"),
  hoist:      P("Hoist drum",       STEEL, 150, 4000, "fixed", S21, false, ["bay"], "none"),
  orechute:   P("Ore chute",        FULL, 120, 1500, "fixed", S1, false, ["bay"], "none", true),
  cavein:     P("Cave-in",          FULL, 300, 9000, "fixed", S1, false, ["bay"], "none"),
  timberset:  P("Timber set",       POLE, 60, 120, "fixed", S1, false, ["bay"], "none", true),
  pillar:     P("Rock pillar",      FULL, 400, 20000, "fixed", S22, false, ["bay"], "none"),
  jawcrusher: P("Jaw crusher",      STEEL, 200, 8000, "fixed", S22, false, ["bay"], "none"),
  screendeck: P("Screen deck",      HALF, 120, 3000, "fixed", S21, false, ["bay"], "none"),
  gravelpile: P("Stockpile",        HALF, 200, 9000, "fixed", S1, false, ["yard", "bay"], "none"),
  orecart:    P("Ore car",          HALF, 80, 300, "two", S1, true, ["bay", "yard"], "storage:120"),
  lamprack:   P("Cap-lamp rack",    HALF, 30, 28, "one", S1, true, ["bay"], "storage:20", true),
  powderbox:  P("Explosives box",   HALF, 60, 45, "two", S1, true, ["bay"], "storage:30"),
  // ---------- sawmills and lumber yards (issue #53: sawmilllayout.js lays them) ----------
  // Fixed: the headsaw (a band head rig on its frame, bolted to the floor), the edger, a log pile (tonnes of logs on the
  // deck), a dry kiln's door (insulated steel on its track, on the kiln's wall) and the wigwam burner (a steel cone in
  // the yard). Liftable: stacked lumber (a lift of boards on its stickers, two people: wood and building materials,
  // combat.js BOX_LOOT lumberstack; at a base a stack to keep things on) and a saw-blade rack (a filing room's wall rack
  // of blades: the saws, BOX_LOOT bladerack).
  headsaw:     P("Headsaw",          STEEL, 80, 2500, "fixed", S21, false, ["bay"], "none"),
  edger:       P("Edger",            HALF, 60, 1200, "fixed", S21, false, ["bay"], "none"),
  logpile:     P("Log pile",         HALF, 120, 4000, "fixed", S1, false, ["yard"], "none"),
  kilndoor:    P("Kiln door",        FULL, 90, 600, "fixed", S1, false, ["bay"], "none", true),
  burner:      P("Wigwam burner",    STEEL, 150, 9000, "fixed", S1, false, ["yard"], "none"),
  lumberstack: P("Stacked lumber",   HALF, 40, 140, "two", S1, true, ["bay", "yard", "shop"], "storage:150"),
  bladerack:   P("Saw-blade rack",   HALF, 20, 24, "one", S1, true, ["bay"], "storage:20", true),
  // ---------- military bases, air bases, airports and prisons laid out like the real thing (issue #25: militarylayout.js) ----------
  // A suitcase in an airport's baggage hall, an ammo crate (rounds and grenades), a fuel bladder (fuel) and an inmate's
  // property locker (what was taken off them at intake) hold their own tables (combat.js BOX_LOOT). The barrier gate, the
  // guard booth, the jet engine stand, the baggage belt, the security scanner and the gate seating are furniture only.
  // The footlocker at a bunk's foot, the map table and the radio console are #26's rows (above). The field cot is #15's
  // cot, the vehicle lift #16's car lift and the sandbag wall the sandbag cell; the aircraft and helicopter wrecks are
  // vehicles (combat.js placeCar with a body: ui/vehiclemodel.js jet, cargoplane, helo), each one container.
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
  // ---------- the office buildings of every kind (issue #27: officelayout.js lays them) ----------
  // A dentist's chair; the tower lobby's turnstiles and lift doors (fixed: the doors are decor on a shaft that is not
  // there); a courtroom's bench, jury box and witness stand, city hall's dais, a podium; a call center's headset desk; a
  // tech office's beanbags and phone booths; a TV studio's camera on its tripod, its lights and the news desk; a mail
  // room's sorter, a plotter; the courthouse's walk-through scanner (its X-ray tunnel is #25's security scanner,
  // above); an executive's liquor cabinet. The headset desk, the news desk, the sorter and the liquor cabinet hold their
  // own tables (combat.js BOX_LOOT, data-offices.js OFFICE_BOX).
  dentalchair:  P("Dental chair",         HALF, 30, 120, "two", S12, false, ["ward", "office"], "comfort:0.3"),
  turnstile:    P("Turnstile",            C(false, 1, false), 40, 150, "fixed", S1, false, ["office"], "none"),
  // Sports stadiums and arenas (issue #57, stadiumlayout.js): a stand's rows of fixed seats, the goalposts and goals at
  // the ends of a field, a basketball hoop on its stanchion, a scoreboard on a wall. All bolted down.
  stadseat:     P("Stadium seats",        HALF, 20, 40, "fixed", S1, false, ["sport"], "none"),
  goalpost:     P("Goalposts",            POLE, 60, 300, "fixed", S1, false, ["sport"], "none"),
  soccergoal:   P("Goal",                 POLE, 30, 80, "fixed", S1, false, ["sport"], "none"),
  hoop:         P("Basketball hoop",      POLE, 40, 250, "fixed", S1, false, ["sport"], "none"),
  scoreboard:   P("Scoreboard",           FULL, 50, 300, "fixed", S1, false, ["sport"], "none", true),
  liftdoor:     P("Lift doors",           FULL, 80, 300, "fixed", S1, false, ["office", "library"], "none", true), // a central library's lift bank too (issue #34)
  judgebench:   P("Judge's bench",        STEEL, 60, 400, "fixed", S21, false, ["office"], "none"),
  jurybox:      P("Jury box",             HALF, 50, 300, "fixed", S21, false, ["office"], "none"),
  witnessstand: P("Witness stand",        HALF, 40, 150, "fixed", S1, false, ["office"], "none"),
  dais:         P("Council dais",         HALF, 50, 300, "fixed", S21, false, ["office"], "none"),
  podium:       P("Podium",               HALF, 15, 35, "two", S1, false, ["office", "school", "church"], "none"),
  headsetdesk:  P("Headset desk",         HALF, 15, 25, "one", S1, true, ["office"], "work:desk"),
  beanbag:      P("Beanbag",              HALF, 8, 5, "one", S1, false, ["living", "office", "library"], "comfort:0.4"), // a library's story corner too (issue #34)
  camera:       P("TV camera",            POLE, 15, 25, "one", S1, false, ["office"], "none"),
  studiolight:  P("Studio light",         POLE, 5, 8, "one", S1, false, ["office"], "comfort:0.1"),
  newsdesk:     P("News desk",            HALF, 35, 90, "two", S21, true, ["office"], "work:desk"),
  sorter:       P("Mail sorter",          HALF, 30, 50, "two", S1, true, ["office"], "storage:40", true),
  plotter:      P("Plotter",              HALF, 30, 90, "two", S21, false, ["office"], "none", true),
  screener:     P("Walk-through scanner", POLE, 30, 120, "fixed", S1, false, ["office"], "none"),
  liquorcab:    P("Liquor cabinet",       HALF, 25, 30, "one", S1, true, ["office", "living", "bar"], "storage:30", true),
  phonebooth:   P("Phone booth",          C(false, 1, false), 30, 200, "fixed", S1, false, ["office"], "none", true),
  // ---------- data centres (issue #51: datacenter.js lays them) ----------
  // Fixed: a CRAC unit (a computer-room air conditioner, plumbed to the chillers), a hall's 2 MW diesel set on its skid,
  // a cable tray riser, a substation's transformer and a cooling tower out in the yard. Liftable: a UPS cabinet and a
  // battery string (their batteries are the loot: combat.js BOX_LOOT), a drum of cable (copper: scrap), an open-frame
  // mining rig (a crypto shed's) and the standby generator, which is data-power.js's Home standby generator item
  // (FURNITURE_ITEM_KEY), set at a base like any found set. A rack is #15's serverrack, the monitor wall #26's screens.
  crac:         P("CRAC unit",          FULL, 60, 450, "fixed", S1, false, ["datacenter"], "none", true),
  dcgen:        P("Diesel generator",   STEEL, 150, 15000, "fixed", S1, false, ["datacenter", "yard"], "none"),
  cabletray:    P("Cable tray riser",   POLE, 20, 40, "fixed", S1, false, ["datacenter"], "none", true),
  transformer:  P("Transformer",        STEEL, 150, 9000, "fixed", S1, false, ["yard"], "none"),
  coolingtower: P("Cooling tower",      FULL, 120, 5000, "fixed", S1, false, ["yard"], "none"),
  upscab:       P("UPS cabinet",        FULL, 50, 260, "two", S1, true, ["datacenter"], "storage:20", true),
  batterystring: P("Battery string",    HALF, 40, 180, "two", S1, true, ["datacenter"], "storage:10"),
  cablereel:    P("Cable drum",         HALF, 25, 60, "two", S1, true, ["datacenter", "bay"], "storage:10"),
  miningrig:    P("Mining rig",         HALF, 15, 28, "one", S1, true, ["datacenter"], "storage:10"),
  standbyset:   P("Standby generator",  STEEL, 60, 95, "two", S1, false, ["datacenter", "bay"], "none"),
  // ---------- museums (issue #58: museumlayout.js lays them) ----------
  // The art worth carrying home (FURNITURE_VALUE, below): a sculpture on its plinth (two people), a framed gallery
  // painting on its stand, a marble bust, an antique vase, a suit of armour, a ship model on its stand; a wax figure (not
  // worth much). A rowing boat from a maritime museum's hall (two people; at a base it holds things). Fixed: a dinosaur
  // skeleton on its mount, a field gun (deactivated, its breech welded), a railway handcar on its length of track.
  // The display case, the queue posts (the rope barriers), the bench, the play structure, the statue and the kiosk are
  // older rows (above).
  sculpture:   P("Sculpture on a plinth", HALF, 30, 60, "two", S1, false, ["museum"], "comfort:1"),
  artwork:     P("Framed painting",       POLE, 6, 10, "one", S1, false, ["museum", "living"], "comfort:0.6", true),
  bust:        P("Marble bust",           HALF, 20, 28, "one", S1, false, ["museum", "office"], "comfort:0.4"),
  vase:        P("Antique vase",          POLE, 4, 7, "one", S1, false, ["museum", "living"], "comfort:0.3"),
  armourstand: P("Suit of armour",        HALF, 25, 28, "one", S1, false, ["museum"], "comfort:0.2"),
  shipmodel:   P("Ship model",            HALF, 10, 9, "one", S1, false, ["museum", "office"], "comfort:0.4"),
  waxfigure:   P("Wax figure",            POLE, 6, 18, "one", S1, false, ["museum"], "none"),
  boat:        P("Rowing boat",           HALF, 30, 70, "two", S12, false, ["museum", "yard"], "storage:60"),
  fossil:      P("Dinosaur skeleton",     C(false, 1, false), 60, 1200, "fixed", S22, false, ["museum"], "none"),
  cannon:      P("Field gun",             STEEL, 90, 1100, "fixed", S21, false, ["museum"], "none"),
  railcar:     P("Railway handcar",       HALF, 60, 400, "fixed", S21, false, ["museum"], "none"),
  // ---------- issue #55's shops (shoplayout.js): a bakery's floor mixer, a butcher's band saw, a laundromat's change
  // machine (its quarters: combat.js BOX_LOOT changer) and folding table ----------
  mixer:        P("Floor mixer",          STEEL, 40, 110, "two", S1, false, ["kitchen"], "none", true),
  meatsaw:      P("Band saw",             HALF, 30, 120, "two", S1, false, ["kitchen", "bay"], "none", true),
  changer:      P("Change machine",       FULL, 40, 90, "two", S1, true, ["laundry", "shop"], "storage:10", true),
  foldtable:    P("Folding table",        HALF, 12, 14, "one", S1, false, ["laundry", "shop", "kitchen"], "work:table"),
  // ---------- lootable decor (issue #13: decor.js places them; light comfort pieces for the base) ----------
  // The plant and the floor lamp stand on a room's floor cell; the painting and the wall clock hang on a wall (decor.js:
  // c.wart = { k, d, piece: true } on the wall cell, the wall's own kind unchanged) and stand on a cell only once set down.
  plant:     P("Potted plant", POLE, 5, 8, "one", S1, false, ["living", "office", "dining", "ward", "shop"], "comfort:0.2"),
  floorlamp: P("Floor lamp",   POLE, 5, 6, "one", S1, false, ["living", "bedroom", "office"], "comfort:0.1"),
  painting:  P("Painting",     POLE, 5, 4, "one", S1, false, ["living", "dining", "bedroom", "office", "church"], "comfort:0.2", true),
  wallclock: P("Wall clock",   POLE, 3, 2, "one", S1, false, ["living", "kitchen", "office", "school", "ward"], "comfort:0.05", true),
  // ---------- amusement parks (issue #60, amusement.js) ----------
  // The rides out on the grounds (fixed: bolted down, tonnes of steel): a roller coaster's track on its supports and a
  // car of its train stalled on it, a Ferris wheel's base and its lowest gondola, a spinning teacup, a bumper car on its
  // floor, a water slide's tower, a trampoline court's bed, the mini-golf windmill, a holiday light display, a ticket
  // booth at the gate; and a go-kart off its track (two people lift it: its tank still has fuel in it).
  coastertrack: P("Coaster track",   C(false, 1, false), 80, 400, "fixed", S1, false, ["park"], "none"),
  coastercar:   P("Coaster car",     HALF, 60, 600, "fixed", S21, false, ["park"], "none"),
  ferriswheel:  P("Ferris wheel",    FULL, 120, 6000, "fixed", S22, false, ["park"], "none"),
  teacup:       P("Spinning teacup", HALF, 50, 400, "fixed", S22, false, ["park"], "none"),
  bumpercar:    P("Bumper car",      HALF, 40, 180, "fixed", S1, false, ["park"], "none"),
  waterslide:   P("Water slide",     FULL, 80, 3000, "fixed", S22, false, ["park"], "none"),
  trampoline:   P("Trampoline",      C(false, 0, false), 30, 150, "fixed", S22, false, ["park"], "none"),
  windmill:     P("Mini-golf windmill", HALF, 40, 300, "fixed", S22, false, ["park"], "none"),
  lightdisplay: P("Light display",   POLE, 15, 60, "fixed", S1, false, ["park"], "none"),
  ticketbooth:  P("Ticket booth",    FULL, 60, 500, "fixed", S1, false, ["park"], "none"),
  gokart:       P("Go-kart",         HALF, 30, 90, "two", S21, true, ["park", "bay"], "storage:10"),
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
// so it has no f_cot; a bunker's generator is data-power.js's genset_military, so it has no f_genset. Merged into GEAR by data.js (marked piece: kept out of the starting kits and trunks, whose dice
// would change). itemKey(k): the item key for a cell kind (null when fixed).
export const FURNITURE_ITEM_KEY = { fridge: "fridge", cot: "cot", genset: "genset_military", standbyset: "genset_standby" }; // a data centre's standby set is the found Home standby generator (data-power.js GENSETS, issue #51) // a bunker's generator is the found Military tactical generator (data-power.js GENSETS, issue #26)
// What a piece is worth as an item where its weight says too little (value: kg / 4 otherwise): a museum's art (issue #58).
export const FURNITURE_VALUE = { sculpture: 70, artwork: 50, bust: 35, vase: 30, armourstand: 40, shipmodel: 25 }; // a bunker's generator is the found Military tactical generator (data-power.js GENSETS, issue #26)
export const itemKey = (k) => (!FURNITURE_KINDS[k] || FURNITURE_KINDS[k].carry === "fixed" ? null : FURNITURE_ITEM_KEY[k] || `f_${k}`);
/** @type {Record<string, { name: string, slot: string, skill: null, power: number, req: number, value: number, noise: number, weight: number, cat: string, bulky: boolean, twoHands: boolean, furniture: string, desc: string }>} */
export const FURNITURE_GEAR = {};
for (const [k, d] of Object.entries(FURNITURE_KINDS)) {
  const key = itemKey(k);
  if (!key || key !== `f_${k}`) continue; // the fridge's and the cot's items are their own
  FURNITURE_GEAR[key] = {
    name: d.name, slot: "pack", skill: null, power: 0, req: 0, value: FURNITURE_VALUE[k] || Math.max(1, Math.round(d.kg / 4)), noise: 0, weight: d.kg, cat: "household", bulky: true, twoHands: true, furniture: k,
    desc: `${d.name}: ${d.kg} kg, ${d.carry === "two" ? "a two-person lift" : "one person can lift it, very slowly"}. Both arms, a cart or a vehicle.`,
  };
}
