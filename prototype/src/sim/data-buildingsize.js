// @ts-check
// Buildings at real-world size (issue #24, the user's request 2026-10-25: "All buildings should scale based on how large
// buildings are in real life with unique layouts and 1 to 3 stories tall and city buildings can be 10 stories tall make
// the raid maps larger if needed up to 300x300").
//
// The scale: one cell is CELL_M metres. The furniture says so: a bed is 1 × 2 cells (data-beds.js BED_SPEC: a single
// bed is about 1 m by 2 m), a doorway one cell (a door is 0.8–0.9 m), a sofa 2 cells (about 2 m), a car 2 × 3–4 cells
// (combat.js placeCar: a car is about 1.8 m by 4.5 m). So 1 m a cell.
//
// REAL_SIZE: each archetype's (buildingmaps.js BUILDINGS) real width along its street front × depth in metres (outer
// walls included), its usual storeys, the setting it stands in, and, for the kinds that grow in a city (offices,
// apartments, a hospital's tower), its storeys there. Turned into cells at CELL_M by realFoot / realStoreys. Rows:
//   w, d     [min, max] metres across the front and front to back;
//   small    an alternative smaller kind by its share: [share, w, d] (a small house among houses);
//   storeys  [min, max] storeys (a town's, or anywhere for the kinds that do not grow);
//   city     [min, max] storeys in a city (a city's tiles and the city crawl);
//   set      the setting it is usually found in (rural | town | city): the tests' and the docs' only;
//   own      the size belongs to another ticket (#22: the corner store, grocery, supermarket and department store;
//            #23: the school; #26: the bunkers): its archetype's own dice are kept (only the storeys rule applies);
//   planned  the archetype's own plan is drawn at this size (#25's military buildings: militarylayout.js MIL_SIZE is these
//            rows, read through realFoot; #27's office buildings: officeplans.js SIZE; #34's libraries: librarylayout.js LIBRARY.SIZE): realScale leaves its footprint as
//            it is (and #25's storeys; #27's tall towers keep only the floors the tall rule builds);
//   wings    how a footprint much bigger than the plan is laid out (buildingmaps.js realScale), when not in whole copies:
//            "along" side by side along the front only, wall to wall, never turned, the copies after the first without the
//            entry's part (a motel: more rooms down the row, every door on the lot, one office and its outside stair);
//            "back" never side by side, and deeper by more of the plan's back strip behind a corridor (a church: one
//            long nave, a parish hall's rooms behind).
// A footprint is the building's bounding box; buildingmaps.js realScale lays the archetype's own plan out over it (in
// wings of the plan's own size when it is much bigger than the plan: rooms, containers and the dead keep today's
// density per area).
export const CELL_M = 1;

/** @typedef {{ w?: [number, number], d?: [number, number], small?: [number, [number, number], [number, number]], storeys?: [number, number], city?: [number, number], set: string, own?: boolean, planned?: boolean, wings?: string }} RealSize */
/** @type {Record<string, RealSize>} */
export const REAL_SIZE = {
  // Homes
  house:       { w: [12, 16], d: [9, 13], small: [0.35, [10, 12], [9, 11]], storeys: [2, 2], set: "town" }, // a small house 10–12 × 9–11 (two storeys: its bedrooms upstairs)
  farmhouse:   { w: [12, 18], d: [10, 14], storeys: [2, 2], set: "rural" },
  cabin:       { w: [7, 9], d: [6, 8], storeys: [1, 1], set: "rural" },
  lodge:       { w: [18, 28], d: [12, 18], storeys: [2, 2], set: "rural" },
  ranger:      { w: [11, 15], d: [9, 12], storeys: [1, 1], set: "rural" },
  apartments:  { w: [25, 50], d: [15, 25], storeys: [3, 6], city: [6, 10], set: "city" },
  neighbourhood: { w: [12, 16], d: [9, 13], small: [0.35, [10, 12], [9, 11]], storeys: [2, 2], set: "town" }, // one of its houses
  // Shops and services
  pharmacy:    { w: [12, 20], d: [14, 24], storeys: [1, 1], set: "town" },
  gunstore:    { w: [10, 18], d: [12, 20], storeys: [1, 1], set: "town" },
  pawnshop:    { w: [10, 16], d: [12, 20], storeys: [1, 1], set: "town" },
  sportshop:   { w: [16, 26], d: [16, 25], storeys: [1, 2], set: "town" },
  electronics: { w: [14, 24], d: [14, 22], storeys: [1, 2], set: "town" },
  radioshop:   { w: [12, 16], d: [13, 18], storeys: [1, 2], set: "town" },
  bookstore:   { w: [10, 18], d: [12, 22], storeys: [1, 2], set: "town" },
  petstore:    { w: [14, 22], d: [12, 20], storeys: [1, 2], set: "town" },
  garden:      { w: [18, 30], d: [14, 22], storeys: [1, 1], set: "town" },
  clothing:    { w: [12, 22], d: [14, 24], storeys: [1, 2], set: "town" },
  liquor:      { w: [10, 18], d: [12, 20], storeys: [1, 2], set: "town" },
  hardware:    { w: [18, 30], d: [16, 25], storeys: [1, 1], set: "town" },
  feedstore:   { w: [15, 25], d: [12, 20], storeys: [1, 1], set: "rural" },
  restaurant:  { w: [8, 46], d: [9, 30], storeys: [1, 2], set: "town", planned: true }, // #33: by its format and size (the eat* rows)
  pizza:       { w: [8, 46], d: [9, 30], storeys: [1, 1], set: "town", planned: true },
  bar:         { w: [8, 46], d: [9, 30], storeys: [1, 2], set: "town", planned: true },
  diner:       { w: [8, 46], d: [9, 30], storeys: [1, 1], set: "town", planned: true },
  gasstation:  { w: [15, 25], d: [10, 15], storeys: [1, 1], set: "rural" }, // plus the forecourt and its canopy outside
  truckstop:   { w: [25, 40], d: [15, 25], storeys: [1, 1], set: "rural" },
  bank:        { w: [15, 30], d: [15, 25], storeys: [1, 2], set: "town" },
  dealer:      { w: [30, 50], d: [20, 35], storeys: [1, 2], set: "town" },
  library:     { w: [9, 56], d: [10, 44], storeys: [1, 8], set: "town", planned: true }, // #34: thirteen variants drawn at their real size (librarylayout.js LIBRARY.SIZE), a rural reading room to an 8-storey central library
  vet:         { w: [15, 20], d: [12, 18], storeys: [1, 2], set: "town" },
  motel:       { w: [40, 70], d: [10, 14], storeys: [2, 2], set: "rural", wings: "along" },
  church:      { w: [14, 24], d: [22, 36], storeys: [1, 1], set: "town", wings: "back" }, // a long nave (and a tower), a parish hall behind
  // #22's grocery tiers and #23's school: their own sizes
  corner:      { set: "town", own: true },
  grocery:     { set: "town", own: true },
  supermarket: { set: "town", own: true },
  deptstore:   { set: "city", own: true },
  school:      { set: "town", own: true },
  // #26's bunkers: their own plans (a portal at the surface, levels below ground), sizes and levels
  milbunker:   { set: "rural", own: true },
  mountainbunker: { set: "rural", own: true },
  govbunker:   { set: "town", own: true },
  shelter:     { set: "town", own: true },
  prepper:     { set: "rural", own: true },
  // Institutions
  clinic:      { w: [15, 25], d: [12, 20], storeys: [1, 2], set: "town" },
  infirmary:   { w: [15, 25], d: [12, 20], storeys: [1, 2], set: "rural" },
  hospital:    { w: [60, 100], d: [40, 60], storeys: [3, 6], city: [6, 10], set: "city" },
  police:      { w: [25, 45], d: [20, 35], storeys: [2, 2], set: "town" },
  firestation: { w: [20, 30], d: [14, 22], storeys: [1, 2], set: "town" },
  offices:     { w: [20, 40], d: [15, 30], storeys: [2, 4], city: [6, 10], set: "city" },
  lab:         { w: [20, 40], d: [15, 25], storeys: [1, 3], set: "town" },
  barracks:    { w: [40, 50], d: [15, 17], storeys: [2, 3], set: "rural", planned: true },
  armorybldg:  { w: [17, 21], d: [12, 14], storeys: [1, 1], set: "rural", planned: true },
  cellblock:   { w: [40, 48], d: [24, 27], storeys: [2, 2], set: "rural", planned: true },
  messhall:    { w: [26, 32], d: [17, 20], storeys: [1, 1], set: "rural", planned: true },
  control:     { w: [15, 25], d: [12, 18], storeys: [1, 3], set: "rural" },
  radio:       { w: [8, 12], d: [6, 9], storeys: [1, 1], set: "rural" }, // a transmitter hut
  terminal:    { w: [80, 90], d: [40, 44], storeys: [1, 2], set: "rural", planned: true },
  // #25's military bases, air bases, airports and prisons (militarylayout.js): planned at these sizes by their own plans
  hq:          { w: [26, 32], d: [17, 20], storeys: [2, 2], set: "rural", planned: true },
  aidstation:  { w: [17, 21], d: [13, 15], storeys: [1, 1], set: "rural", planned: true },
  gatehouse:   { w: [8, 10], d: [6, 7], storeys: [1, 1], set: "rural", planned: true },
  tower:       { w: [9, 11], d: [9, 11], storeys: [4, 5], set: "rural", planned: true },
  flightops:   { w: [24, 28], d: [15, 17], storeys: [1, 2], set: "rural", planned: true },
  supply:      { w: [40, 48], d: [25, 29], storeys: [1, 1], set: "rural", planned: true }, // a military base's warehouse (no archetype of its own: the warehouse's plan at a base)
  // #27's office buildings of every kind (officeplans.js: its SIZE is these rows; a firm's corporate tower the
  // officetower row, an "offices" archetype with a firm): planned at these sizes, their storeys built by the tall rule
  storefront:  { w: [10, 14], d: [15, 20], storeys: [1, 2], set: "town", planned: true },
  bizpark:     { w: [26, 32], d: [17, 21], storeys: [1, 3], set: "town", planned: true },
  officetower: { w: [24, 28], d: [16, 18], storeys: [6, 10], set: "city", planned: true }, // a firm's corporate tower (the offices archetype's, issue #27)
  cityhall:    { w: [26, 30], d: [21, 24], storeys: [2, 3], set: "town", planned: true },
  courthouse:  { w: [26, 30], d: [21, 24], storeys: [2, 3], set: "town", planned: true },
  callcenter:  { w: [26, 32], d: [17, 20], storeys: [1, 2], set: "town", planned: true },
  techoffice:  { w: [20, 24], d: [15, 18], storeys: [2, 5], set: "city", planned: true },
  station:     { w: [22, 26], d: [15, 17], storeys: [2, 2], set: "town", planned: true },
  // #29's hotels (hotellayout.js HOTEL.SIZE reads the kinds' rows): planned at these sizes, their storeys built by the
  // tall rule (a city tower hotel's 8–10 storeys: 4 floors built, the stairs above blocked); "hotel" the archetype's span
  hotel:         { w: [21, 90], d: [19, 23], storeys: [2, 10], set: "town", planned: true },
  hotelinn:      { w: [21, 25], d: [19, 19], storeys: [2, 3], set: "rural", planned: true },
  hotelbusiness: { w: [40, 60], d: [21, 23], storeys: [4, 6], set: "town", planned: true },
  hotelresort:   { w: [64, 90], d: [21, 23], storeys: [2, 4], set: "rural", planned: true },
  hoteltower:    { w: [36, 44], d: [21, 23], storeys: [8, 10], set: "city", planned: true },
  // #33's restaurants by size (data-eateries.js EAT_SIZE reads these; a pizza place's, a diner's and a bar's too):
  // planned at these sizes by its plans (eaterylayout.js eateryPlan)
  eattiny:     { w: [8, 10], d: [9, 10], set: "town", planned: true },
  eatsmall:    { w: [11, 14], d: [10, 12], set: "town", planned: true },
  eatmedium:   { w: [16, 22], d: [13, 16], set: "town", planned: true },
  eatlarge:    { w: [26, 34], d: [18, 22], set: "town", planned: true },
  eathuge:     { w: [40, 46], d: [26, 30], set: "town", planned: true },
  // Open floors
  warehouse:   { w: [40, 80], d: [25, 50], storeys: [1, 1], set: "town" }, // one tall storey
  factory:     { w: [50, 100], d: [30, 60], storeys: [1, 1], set: "town" },
  hangar:      { w: [50, 58], d: [40, 46], storeys: [1, 1], set: "rural", planned: true },
  motorpool:   { w: [40, 48], d: [26, 30], storeys: [1, 1], set: "rural", planned: true },
  autoshop:    { w: [15, 25], d: [12, 20], storeys: [1, 1], set: "town" },
  garage:      { w: [10, 16], d: [8, 12], storeys: [1, 1], set: "town" },
  workshop:    { w: [12, 20], d: [10, 14], storeys: [1, 1], set: "rural" },
  machineshed: { w: [12, 20], d: [8, 14], storeys: [1, 1], set: "rural" },
  barn:        { w: [15, 30], d: [10, 20], storeys: [1, 1], set: "rural" }, // plus its hayloft (a raised room on one grid)
};

const pick = (rng, [lo, hi]) => rng.int(Math.round(lo / CELL_M), Math.round(hi / CELL_M));
/**
 * A building's footprint in cells, bw × bh (outer walls included), from its row: null for a kind with no row or one
 * whose size another ticket owns (its archetype's own dice stand).
 * @param {any} rng @param {string} key @returns {{ bw: number, bh: number } | null}
 */
export function realFoot(rng, key) {
  const R = REAL_SIZE[key];
  if (!R || R.own || !R.w || !R.d) return null;
  if (R.small && rng.chance(R.small[0])) return { bw: pick(rng, R.small[1]), bh: pick(rng, R.small[2]) };
  return { bw: pick(rng, R.w), bh: pick(rng, R.d) };
}
/**
 * A building's storeys (its height) by its row and setting ("city": a city's tiles and the city crawl), null for a
 * kind with no row or no storeys given.
 * @param {any} rng @param {string} key @param {string} [setting] @returns {number | null}
 */
export function realStoreys(rng, key, setting = "town") {
  const R = REAL_SIZE[key];
  if (!R) return null;
  const range = setting === "city" && R.city ? R.city : R.storeys;
  return range ? rng.int(range[0], range[1]) : null;
}
/** The range of storeys a kind stands in a setting (the tests'). @param {string} key @param {string} [setting] @returns {[number, number] | null} */
export const storeyRange = (key, setting = "town") => { const R = REAL_SIZE[key]; return R ? (setting === "city" && R.city ? R.city : R.storeys || null) : null; };
