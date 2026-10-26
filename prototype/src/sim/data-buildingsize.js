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
//   sizes    sizes by variant ({ small: { w, d, storeys, city }, medium: {...}, ... }, any names): a variant's row, the
//            fields it gives over the kind's (realFoot / realStoreys / storeyRange with the variant's name; sizeOf). A
//            rural critical-access hospital and a city medical centre are one kind at two sizes (#35, #36, #37: a dozen
//            variants a type, the user's request 2026-10-25);
//   own      the size belongs to another ticket (#22: the corner store, grocery, supermarket and department store;
//            #23: the school; #26: the bunkers): its archetype's own dice are kept (only the storeys rule applies);
//            (#35's shops and services are planned: shopvariants.js SIZES cuts these rows into its size classes)
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

/** @typedef {{ w?: [number, number], d?: [number, number], small?: [number, [number, number], [number, number]], storeys?: [number, number], city?: [number, number], set: string, own?: boolean, planned?: boolean, wings?: string, sizes?: Record<string, { w?: [number, number], d?: [number, number], storeys?: [number, number], city?: [number, number] }> }} RealSize */
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
  pharmacy:    { w: [12, 20], d: [14, 24], storeys: [1, 1], set: "town", planned: true },
  gunstore:    { w: [10, 18], d: [12, 20], storeys: [1, 1], set: "town", planned: true },
  pawnshop:    { w: [10, 16], d: [12, 20], storeys: [1, 1], set: "town", planned: true },
  sportshop:   { w: [16, 26], d: [16, 25], storeys: [1, 2], set: "town", planned: true },
  electronics: { w: [14, 24], d: [14, 22], storeys: [1, 2], set: "town", planned: true },
  radioshop:   { w: [12, 16], d: [13, 18], storeys: [1, 2], set: "town", planned: true },
  bookstore:   { w: [10, 18], d: [12, 22], storeys: [1, 2], set: "town", planned: true },
  petstore:    { w: [14, 22], d: [12, 20], storeys: [1, 2], set: "town", planned: true },
  garden:      { w: [18, 30], d: [14, 22], storeys: [1, 1], set: "town", planned: true },
  clothing:    { w: [12, 22], d: [14, 24], storeys: [1, 2], set: "town", planned: true },
  liquor:      { w: [10, 18], d: [12, 20], storeys: [1, 2], set: "town", planned: true },
  hardware:    { w: [18, 30], d: [16, 25], storeys: [1, 1], set: "town", planned: true },
  feedstore:   { w: [15, 25], d: [12, 20], storeys: [1, 1], set: "rural", planned: true },
  restaurant:  { w: [8, 54], d: [9, 40], storeys: [1, 2], set: "town", planned: true }, // #33: by its format and size (the eat* rows)
  pizza:       { w: [8, 54], d: [9, 40], storeys: [1, 1], set: "town", planned: true },
  bar:         { w: [8, 54], d: [9, 40], storeys: [1, 2], set: "town", planned: true },
  diner:       { w: [8, 54], d: [9, 40], storeys: [1, 1], set: "town", planned: true },
  gasstation:  { w: [15, 25], d: [10, 15], storeys: [1, 1], set: "rural", planned: true }, // plus the forecourt and its canopy outside
  truckstop:   { w: [25, 40], d: [15, 25], storeys: [1, 1], set: "rural", planned: true },
  bank:        { w: [15, 30], d: [15, 25], storeys: [1, 2], set: "town", planned: true },
  dealer:      { w: [30, 50], d: [20, 35], storeys: [1, 2], set: "town", planned: true },
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
  barracks:    { w: [40, 50], d: [15, 17], storeys: [1, 3], set: "rural", planned: true },
  armorybldg:  { w: [17, 21], d: [12, 14], storeys: [1, 1], set: "rural", planned: true },
  cellblock:   { w: [40, 48], d: [24, 27], storeys: [2, 2], set: "rural", planned: true },
  messhall:    { w: [26, 32], d: [17, 20], storeys: [1, 1], set: "rural", planned: true },
  control:     { w: [15, 25], d: [12, 18], storeys: [1, 4], set: "rural" },
  radio:       { w: [8, 12], d: [6, 9], storeys: [1, 1], set: "rural" }, // a transmitter hut
  terminal:    { w: [80, 90], d: [40, 44], storeys: [1, 2], set: "rural", planned: true },
  // #25's military bases, air bases, airports and prisons (militarylayout.js): planned at these sizes by their own plans
  hq:          { w: [26, 32], d: [17, 20], storeys: [1, 3], set: "rural", planned: true },
  aidstation:  { w: [17, 21], d: [13, 15], storeys: [1, 1], set: "rural", planned: true },
  gatehouse:   { w: [8, 10], d: [6, 7], storeys: [1, 1], set: "rural", planned: true },
  tower:       { w: [9, 11], d: [9, 11], storeys: [2, 6], set: "rural", planned: true },
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
  // #36's named civic and medical plans (civicvariants.js VARIANTS), keyed "<kind>.<plan id>": each drawn at its row's
  // size by its own plan (civicvariants.js SIZE reads these; realScale leaves a named plan as it is, its floors past
  // the tall rule's not built). Each kind's "general" plan, #14's or #15's, is the kind's own row above, through realScale.
  // hospital
  "hospital.critical": { w: [23, 24], d: [16, 17], storeys: [1, 2], set: "rural", planned: true }, // Critical-access hospital
  "hospital.tower": { w: [22, 22], d: [16, 16], storeys: [5, 7], set: "city", planned: true }, // Regional medical tower
  "hospital.children": { w: [26, 29], d: [16, 18], storeys: [2, 4], set: "city", planned: true }, // Children's hospital
  "hospital.psych": { w: [26, 29], d: [15, 17], storeys: [2, 3], set: "town", planned: true }, // Psychiatric hospital
  "hospital.va": { w: [27, 30], d: [17, 19], storeys: [3, 4], set: "city", planned: true }, // Veterans' hospital
  "hospital.trauma": { w: [28, 31], d: [18, 19], storeys: [3, 4], set: "city", planned: true }, // Trauma centre
  "hospital.pavilion": { w: [32, 36], d: [15, 17], storeys: [1, 2], set: "town", planned: true }, // Pavilion-plan hospital
  "hospital.teaching": { w: [28, 31], d: [18, 19], storeys: [4, 5], set: "city", planned: true }, // University teaching hospital
  "hospital.cottage": { w: [20, 22], d: [13, 15], storeys: [1, 1], set: "town", planned: true }, // Cottage hospital
  "hospital.surgical": { w: [21, 22], d: [15, 16], storeys: [2, 3], set: "town", planned: true }, // Surgical hospital
  "hospital.nursing": { w: [32, 35], d: [17, 18], storeys: [2, 2], set: "town", planned: true }, // Community hospital and nursing home
  // infirmary
  "infirmary.prison": { w: [20, 22], d: [14, 15], storeys: [1, 1], set: "rural", planned: true }, // Prison infirmary
  "infirmary.prisonhosp": { w: [27, 30], d: [16, 18], storeys: [2, 3], set: "city", planned: true }, // Prison hospital wing
  "infirmary.jail": { w: [18, 19], d: [13, 14], storeys: [1, 1], set: "town", planned: true }, // County jail clinic
  "infirmary.camp": { w: [14, 15], d: [11, 12], storeys: [1, 1], set: "rural", planned: true }, // Camp infirmary
  "infirmary.campus": { w: [20, 23], d: [13, 15], storeys: [2, 2], set: "town", planned: true }, // College health centre
  "infirmary.field": { w: [24, 28], d: [14, 16], storeys: [1, 1], set: "rural", planned: true }, // Field hospital
  "infirmary.aid": { w: [19, 21], d: [15, 16], storeys: [1, 1], set: "rural", planned: true }, // Base aid station
  "infirmary.company": { w: [17, 19], d: [12, 14], storeys: [1, 2], set: "town", planned: true }, // Works infirmary
  "infirmary.boarding": { w: [16, 18], d: [12, 14], storeys: [2, 2], set: "town", planned: true }, // Boarding-school sanatorium
  "infirmary.quarantine": { w: [21, 23], d: [14, 15], storeys: [1, 2], set: "rural", planned: true }, // Quarantine station
  "infirmary.shelter": { w: [19, 22], d: [13, 15], storeys: [1, 1], set: "city", planned: true }, // Shelter infirmary
  // clinic
  "clinic.urgent": { w: [21, 23], d: [14, 15], storeys: [1, 2], set: "city", planned: true }, // Urgent care
  "clinic.family": { w: [18, 20], d: [12, 14], storeys: [1, 1], set: "town", planned: true }, // Family practice
  "clinic.dialysis": { w: [22, 24], d: [13, 15], storeys: [1, 1], set: "city", planned: true }, // Dialysis centre
  "clinic.dental": { w: [18, 20], d: [12, 13], storeys: [1, 1], set: "town", planned: true }, // Dental practice
  "clinic.stripmall": { w: [11, 13], d: [18, 20], storeys: [1, 1], set: "city", planned: true }, // Walk-in clinic
  "clinic.occhealth": { w: [19, 21], d: [13, 15], storeys: [1, 2], set: "city", planned: true }, // Occupational health clinic
  "clinic.free": { w: [17, 19], d: [12, 14], storeys: [1, 1], set: "city", planned: true }, // Free clinic
  "clinic.multi": { w: [25, 27], d: [15, 15], storeys: [2, 3], set: "city", planned: true }, // Multi-specialty medical centre
  "clinic.paediatric": { w: [21, 23], d: [13, 15], storeys: [1, 1], set: "town", planned: true }, // Paediatric practice
  "clinic.rural": { w: [12, 14], d: [10, 11], storeys: [1, 1], set: "rural", planned: true }, // Rural health post
  "clinic.surgery": { w: [21, 23], d: [14, 15], storeys: [1, 2], set: "town", planned: true }, // Outpatient surgery centre
  // vet
  "vet.country": { w: [25, 28], d: [14, 15], storeys: [1, 1], set: "town", planned: true }, // Country vet
  "vet.farm": { w: [28, 32], d: [14, 16], storeys: [1, 1], set: "rural", planned: true }, // Large-animal and farm vet
  "vet.emergency": { w: [26, 28], d: [15, 15], storeys: [1, 2], set: "city", planned: true }, // Emergency animal hospital
  "vet.shelter": { w: [27, 30], d: [14, 16], storeys: [1, 1], set: "town", planned: true }, // Animal shelter
  "vet.boarding": { w: [21, 24], d: [13, 15], storeys: [1, 1], set: "town", planned: true }, // Boarding kennel
  "vet.equine": { w: [29, 32], d: [15, 17], storeys: [1, 1], set: "rural", planned: true }, // Equine hospital
  "vet.storefront": { w: [11, 13], d: [20, 22], storeys: [1, 1], set: "city", planned: true }, // Storefront vet
  "vet.specialty": { w: [22, 24], d: [15, 15], storeys: [2, 2], set: "city", planned: true }, // Veterinary specialty centre
  "vet.exotic": { w: [17, 19], d: [12, 14], storeys: [1, 1], set: "city", planned: true }, // Exotic and bird clinic
  "vet.cat": { w: [15, 16], d: [12, 13], storeys: [1, 1], set: "town", planned: true }, // Cat clinic
  "vet.teaching": { w: [31, 34], d: [16, 18], storeys: [2, 2], set: "city", planned: true }, // Veterinary teaching hospital
  // church
  "church.chapel": { w: [11, 12], d: [15, 17], storeys: [1, 1], set: "rural", planned: true }, // White clapboard chapel
  "church.brick": { w: [23, 26], d: [19, 22], storeys: [1, 1], set: "town", planned: true }, // Brick church with a fellowship hall
  "church.mega": { w: [32, 36], d: [21, 24], storeys: [2, 2], set: "town", planned: true }, // Megachurch
  "church.cathedral": { w: [31, 36], d: [24, 25], storeys: [1, 1], set: "city", planned: true }, // Cathedral
  "church.storefront": { w: [11, 13], d: [15, 18], storeys: [1, 1], set: "city", planned: true }, // Storefront church
  "church.rectory": { w: [22, 25], d: [19, 22], storeys: [1, 1], set: "town", planned: true }, // Catholic church with a rectory
  "church.country": { w: [13, 15], d: [20, 22], storeys: [1, 1], set: "rural", planned: true }, // Country church
  "church.cruciform": { w: [32, 36], d: [21, 24], storeys: [1, 1], set: "city", planned: true }, // Cruciform stone church
  "church.mission": { w: [22, 25], d: [19, 21], storeys: [1, 1], set: "town", planned: true }, // Mission church
  "church.school": { w: [26, 30], d: [19, 22], storeys: [1, 2], set: "town", planned: true }, // Church with a parish school
  "church.meeting": { w: [15, 17], d: [15, 17], storeys: [2, 2], set: "town", planned: true }, // Meeting house
  // police
  "police.substation": { w: [21, 22], d: [14, 15], storeys: [1, 1], set: "rural", planned: true }, // Sheriff's substation
  "police.smalltown": { w: [22, 24], d: [15, 16], storeys: [1, 2], set: "town", planned: true }, // Small-town police department
  "police.precinct": { w: [28, 31], d: [17, 19], storeys: [3, 3], set: "city", planned: true }, // City precinct house
  "police.patrol": { w: [27, 30], d: [14, 15], storeys: [1, 1], set: "rural", planned: true }, // State patrol post
  "police.hq": { w: [21, 22], d: [15, 15], storeys: [4, 5], set: "city", planned: true }, // Police headquarters
  "police.jail": { w: [32, 35], d: [19, 21], storeys: [2, 2], set: "town", planned: true }, // County sheriff's office and jail
  "police.community": { w: [18, 20], d: [21, 23], storeys: [1, 2], set: "city", planned: true }, // Neighbourhood police office
  "police.barracks": { w: [25, 27], d: [16, 17], storeys: [2, 2], set: "rural", planned: true }, // Highway patrol barracks
  "police.townhall": { w: [30, 33], d: [20, 22], storeys: [2, 2], set: "town", planned: true }, // Town hall and police department
  "police.k9": { w: [26, 29], d: [16, 17], storeys: [1, 2], set: "town", planned: true }, // Police station with a K-9 unit
  "police.courthouse": { w: [26, 29], d: [18, 20], storeys: [2, 3], set: "town", planned: true }, // Old courthouse police station
  // firestation
  "firestation.volunteer": { w: [24, 27], d: [14, 15], storeys: [1, 1], set: "rural", planned: true }, // Volunteer fire hall
  "firestation.twobay": { w: [24, 27], d: [15, 16], storeys: [2, 2], set: "town", planned: true }, // Two-bay station
  "firestation.tower": { w: [33, 36], d: [16, 18], storeys: [1, 1], set: "town", planned: true }, // Fire station with a training tower
  "firestation.airport": { w: [28, 32], d: [16, 18], storeys: [2, 2], set: "city", planned: true }, // Airport crash station
  "firestation.hq": { w: [28, 31], d: [17, 18], storeys: [3, 3], set: "city", planned: true }, // Fire headquarters
  "firestation.brush": { w: [16, 18], d: [13, 14], storeys: [1, 1], set: "rural", planned: true }, // Rural brush station
  "firestation.firehouse": { w: [13, 15], d: [19, 21], storeys: [2, 3], set: "city", planned: true }, // Historic firehouse
  "firestation.drive": { w: [22, 25], d: [17, 19], storeys: [1, 2], set: "town", planned: true }, // Drive-through station
  "firestation.rescue": { w: [28, 31], d: [15, 17], storeys: [2, 2], set: "town", planned: true }, // Fire and rescue station
  "firestation.academy": { w: [33, 36], d: [17, 19], storeys: [1, 1], set: "town", planned: true }, // Fire training academy
  "firestation.county": { w: [24, 27], d: [17, 19], storeys: [1, 1], set: "town", planned: true }, // County fire and rescue
  // #33's restaurants by size (data-eateries.js EAT_SIZE reads these; a pizza place's, a diner's and a bar's too):
  // planned at these sizes by its plans (eaterylayout.js eateryPlan)
  eattiny:     { w: [8, 10], d: [9, 10], set: "town", planned: true },
  eatsmall:    { w: [11, 14], d: [10, 12], set: "town", planned: true },
  eatmedium:   { w: [16, 22], d: [13, 16], set: "town", planned: true },
  eatlarge:    { w: [26, 34], d: [18, 22], set: "town", planned: true },
  eathuge:     { w: [50, 54], d: [36, 40], set: "town", planned: true }, // a banquet hall, a buffet palace: the shared rule's huge footprint (≥ 50 wide, 1800 cells; storeytest), as the supermarket (#33)
  // #31's prisons and county jails (prison.js, prisonlayout.js): planned at these sizes by their own plans. "prison" and
  // "jail" are the complexes' sample building (the chow hall: buildingmaps.js BUILDINGS make; their maps of many
  // buildings are prison.js PRISON.KINDS); a housing unit by where it stands (a state prison's or a penitentiary's
  // block, death row, the segregation unit, a jail's pod); the main corridor's length and the gatehouse's depth are the
  // complex's (own).
  prison:      { w: [30, 38], d: [22, 26], storeys: [1, 1], set: "rural", planned: true },
  jail:        { w: [30, 38], d: [22, 26], storeys: [1, 1], set: "town", planned: true },
  pblock:      { w: [54, 66], d: [21, 24], storeys: [2, 2], set: "rural", planned: true }, // two tiers of cells round the day room
  pdeathrow:   { w: [30, 36], d: [21, 24], storeys: [2, 2], set: "rural", planned: true },
  pseg:        { w: [28, 34], d: [21, 24], storeys: [1, 1], set: "rural", planned: true },
  ppod:        { w: [26, 32], d: [21, 24], storeys: [2, 2], set: "town", planned: true },
  pcontrol:    { w: [24, 28], d: [11, 13], storeys: [1, 1], set: "rural", planned: true },
  pchow:       { w: [30, 38], d: [22, 26], storeys: [1, 1], set: "rural", planned: true },
  pinfirmary:  { w: [28, 34], d: [17, 17], storeys: [1, 1], set: "rural", planned: true },
  pchapel:     { w: [14, 18], d: [22, 26], storeys: [1, 1], set: "rural", planned: true },
  pschool:     { w: [30, 36], d: [16, 16], storeys: [1, 1], set: "rural", planned: true },
  pworks:      { w: [40, 50], d: [16, 20], storeys: [1, 1], set: "rural", planned: true },
  padmin:      { w: [26, 32], d: [14, 14], storeys: [2, 2], set: "rural", planned: true },
  parmory:     { w: [16, 20], d: [12, 12], storeys: [1, 1], set: "rural", planned: true },
  jailmain:    { w: [42, 48], d: [21, 21], storeys: [2, 2], set: "town", planned: true },
  pspine:      { set: "rural", own: true },
  pgate:       { set: "rural", own: true },
  // Open floors
  warehouse:   { w: [40, 80], d: [25, 50], storeys: [1, 1], set: "town" }, // one tall storey
  factory:     { w: [50, 100], d: [30, 60], storeys: [1, 1], set: "town" },
  hangar:      { w: [50, 58], d: [40, 46], storeys: [1, 1], set: "rural", planned: true },
  motorpool:   { w: [40, 48], d: [26, 30], storeys: [1, 1], set: "rural", planned: true },
  autoshop:    { w: [15, 25], d: [12, 20], storeys: [1, 1], set: "town", planned: true },
  garage:      { w: [10, 16], d: [8, 12], storeys: [1, 1], set: "town", planned: true },
  workshop:    { w: [12, 20], d: [10, 14], storeys: [1, 1], set: "rural", planned: true },
  machineshed: { w: [12, 20], d: [8, 14], storeys: [1, 1], set: "rural" },
  barn:        { w: [15, 30], d: [10, 20], storeys: [1, 1], set: "rural" }, // plus its hayloft (a raised room on one grid)
  // #28's college campus buildings: planned at their own real size (campuslayout.js CAMPUS_SIZE and campusplans.js's
  // named plans, a metre a cell; these rows their range over the plans); on a campus each is laid out as it is
  // (campus.js), raided alone through realScale like #25's. The chapel and the health centre are the church's and the
  // clinic's plans at their sizes.
  dorm:         { w: [24, 46], d: [10, 28], storeys: [2, 8], set: "town", planned: true },
  lecturehall:  { w: [30, 46], d: [12, 26], storeys: [1, 4], set: "town", planned: true },
  sciencehall:  { w: [20, 46], d: [12, 26], storeys: [1, 6], set: "town", planned: true }, // with #37's lab plans
  univlibrary:  { w: [14, 56], d: [13, 44], storeys: [1, 8], set: "town", planned: true }, // with #34's library plans (the law library to the central library)
  studentunion: { w: [32, 46], d: [16, 26], storeys: [1, 4], set: "town", planned: true },
  dininghall:   { w: [28, 34], d: [20, 24], storeys: [1, 2], set: "town", planned: true },
  athletics:    { w: [30, 46], d: [16, 32], storeys: [1, 2], set: "town", planned: true },
  admin:        { w: [22, 44], d: [12, 26], storeys: [1, 6], set: "town", planned: true },
  security:     { w: [10, 28], d: [8, 18], storeys: [1, 2], set: "town", planned: true },
  maintenance:  { w: [22, 40], d: [11, 20], storeys: [1, 2], set: "town", planned: true },
  theatre:      { w: [24, 46], d: [13, 28], storeys: [1, 3], set: "town", planned: true },
  parkgarage:   { w: [30, 48], d: [18, 32], storeys: [2, 6], set: "town", planned: true },
  chapel:       { w: [14, 24], d: [22, 36], storeys: [1, 2], set: "town", wings: "back" },
  healthcentre: { w: [15, 25], d: [12, 20], storeys: [1, 3], set: "town" },
};

const pick = (rng, [lo, hi]) => rng.int(Math.round(lo / CELL_M), Math.round(hi / CELL_M));
/**
 * A kind's row, or one of its variants' (R.sizes[size]: its fields over the kind's; an unknown variant: the kind's own).
 * @param {string} key @param {string} [size] @returns {RealSize | null}
 */
export function sizeOf(key, size) {
  const R = REAL_SIZE[key];
  if (!R) return null;
  const V = size && R.sizes && R.sizes[size];
  return V ? { ...R, small: undefined, ...V } : R;
}
/**
 * A building's footprint in cells, bw × bh (outer walls included), from its row: null for a kind with no row or one
 * whose size another ticket owns (its archetype's own dice stand).
 * @param {any} rng @param {string} key @param {string} [size] a variant's size (R.sizes) @returns {{ bw: number, bh: number } | null}
 */
export function realFoot(rng, key, size) {
  const R = sizeOf(key, size);
  if (!R || R.own || !R.w || !R.d) return null;
  if (R.small && rng.chance(R.small[0])) return { bw: pick(rng, R.small[1]), bh: pick(rng, R.small[2]) };
  return { bw: pick(rng, R.w), bh: pick(rng, R.d) };
}
/**
 * A building's storeys (its height) by its row and setting ("city": a city's tiles and the city crawl), null for a
 * kind with no row or no storeys given.
 * @param {any} rng @param {string} key @param {string} [setting] @param {string} [size] a variant's size (R.sizes) @returns {number | null}
 */
export function realStoreys(rng, key, setting = "town", size) {
  const R = sizeOf(key, size);
  if (!R) return null;
  const range = setting === "city" && R.city ? R.city : R.storeys;
  return range ? rng.int(range[0], range[1]) : null;
}
/** The range of storeys a kind (or its variant) stands in a setting (the tests'). @param {string} key @param {string} [setting] @param {string} [size] @returns {[number, number] | null} */
export const storeyRange = (key, setting = "town", size) => { const R = sizeOf(key, size); return R ? (setting === "city" && R.city ? R.city : R.storeys || null) : null; };
