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
//   own      the size belongs to another ticket (#22: the corner store, grocery, supermarket and department store; #30: the mall's kinds;
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

/** @typedef {{ w?: [number, number], d?: [number, number], small?: [number, [number, number], [number, number]], storeys?: [number, number], city?: [number, number], set: string, own?: boolean, planned?: boolean, wings?: string, sizes?: Record<string, { w?: [number, number], d?: [number, number], storeys?: [number, number], city?: [number, number], planned?: boolean }> }} RealSize */
/** @type {Record<string, RealSize>} */
export const REAL_SIZE = {
  // Homes
  house:       { w: [12, 16], d: [9, 13], small: [0.35, [10, 12], [9, 11]], storeys: [2, 2], set: "town" }, // a small house 10–12 × 9–11 (two storeys: its bedrooms upstairs)
  farmhouse:   { w: [12, 18], d: [10, 14], storeys: [2, 2], set: "rural" },
  cabin:       { w: [7, 9], d: [6, 8], storeys: [1, 1], set: "rural" },
  lodge:       { w: [18, 28], d: [12, 18], storeys: [2, 2], set: "rural" },
  ranger:      { w: [11, 15], d: [9, 12], storeys: [1, 1], set: "rural" },
  apartments:  { w: [25, 50], d: [15, 25], storeys: [3, 6], city: [6, 10], set: "city", // the corridor block (#32's classic layout): laid out at this size, a city's 6–10
    // #32's other layouts are drawn at their own size (buildingmaps.js APT_PLANS: realScale leaves a spec.vid's), their
    // storeys their plan's wherever they stand (the crawl's deeper blocks one more): a variant's row by its layout id.
    sizes: Object.fromEntries(Object.entries({ walkup: [3, 4], garden: [2, 2], lofts: [3, 4], tower: [4, 5], shops: [3, 3], rooming: [3, 3], senior: [3, 3], student: [3, 3], projects: [4, 5], converted: [3, 3], condos: [3, 4] }).map(([k, r]) => [k, { storeys: /** @type {[number, number]} */ (r), city: /** @type {[number, number]} */ (r) }])) },
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
  // #58: thirteen variants drawn at their real size (museumlayout.js reads these rows: a variant's footprint and storeys),
  // a local history museum in an old house to a natural history museum of three storeys by a city's centre.
  museum:      { w: [14, 72], d: [11, 54], storeys: [1, 4], set: "city", planned: true, sizes: {
    art:          { w: [60, 68], d: [44, 50], storeys: [3, 4] }, // huge: galleries round an atrium or a sculpture court
    natural:      { w: [64, 72], d: [48, 54], storeys: [3, 3] }, // huge: the dinosaur hall and its halls
    science:      { w: [40, 48], d: [30, 36], storeys: [2, 2] },
    military:     { w: [40, 48], d: [30, 36], storeys: [1, 2] },
    localhist:    { w: [14, 17], d: [11, 13], storeys: [2, 2] }, // small: an old house
    county:       { w: [16, 20], d: [14, 17], storeys: [1, 1] },
    children:     { w: [26, 32], d: [20, 24], storeys: [1, 2] },
    aviation:     { w: [50, 58], d: [38, 44], storeys: [1, 1] }, // a hangar's height, one floor
    car:          { w: [32, 40], d: [24, 30], storeys: [1, 2] },
    railway:      { w: [40, 48], d: [22, 28], storeys: [1, 1] },
    maritime:     { w: [30, 36], d: [22, 26], storeys: [2, 2] },
    presidential: { w: [44, 52], d: [34, 40], storeys: [2, 3] },
    wax:          { w: [20, 26], d: [16, 20], storeys: [1, 2] },
  } },
  // Issue #55's six shops (data-newshops.js): planned at these sizes by shopvariants.js, a sizes row a variant (its id:
  // w, d metres, storeys); realScale leaves them as drawn.
  furnstore: { w: [10, 70], d: [14, 60], storeys: [1, 2], set: "town", planned: true, // a mattress store to a big-box showroom
    sizes: { mattress: { w: [10, 13], d: [16, 20], storeys: [1, 1] }, bigbox: { w: [56, 68], d: [44, 56], storeys: [1, 2] }, antique: { w: [13, 16], d: [16, 22], storeys: [1, 2] }, appliance: { w: [22, 30], d: [22, 28], storeys: [1, 1] }, family: { w: [16, 22], d: [20, 26], storeys: [1, 1] }, outlet: { w: [32, 42], d: [26, 34], storeys: [1, 1] }, gallery: { w: [14, 18], d: [18, 22], storeys: [2, 2] }, barn: { w: [24, 32], d: [18, 24], storeys: [1, 1] }, unfinished: { w: [12, 16], d: [14, 18], storeys: [1, 1] }, homestore: { w: [30, 40], d: [24, 30], storeys: [1, 1] }, clearance: { w: [20, 26], d: [22, 28], storeys: [1, 1] }, twofloor: { w: [22, 28], d: [22, 28], storeys: [2, 2] } } },
  laundromat: { w: [7, 24], d: [12, 26], storeys: [1, 2], set: "town", planned: true, // a coin laundry to a 24-hour superwash
    sizes: { coin: { w: [7, 9], d: [14, 18], storeys: [1, 1] }, attended: { w: [10, 13], d: [16, 20], storeys: [1, 1] }, washfold: { w: [10, 13], d: [18, 22], storeys: [1, 1] }, drycleaner: { w: [14, 18], d: [20, 24], storeys: [1, 1] }, corner: { w: [13, 15], d: [12, 15], storeys: [1, 1] }, allnight: { w: [18, 24], d: [20, 26], storeys: [1, 1] }, flat: { w: [7, 9], d: [14, 17], storeys: [2, 2] }, cafe: { w: [14, 18], d: [16, 20], storeys: [1, 1] }, strip: { w: [9, 12], d: [16, 20], storeys: [1, 1] }, student: { w: [13, 15], d: [16, 20], storeys: [1, 1] }, roadside: { w: [13, 16], d: [14, 18], storeys: [1, 1] }, commercial: { w: [16, 22], d: [20, 26], storeys: [1, 1] } } },
  thrift: { w: [9, 40], d: [14, 36], storeys: [1, 2], set: "town", planned: true, // a charity shop to a thrift superstore
    sizes: { charity: { w: [9, 12], d: [14, 18], storeys: [1, 1] }, church: { w: [12, 16], d: [16, 20], storeys: [1, 1] }, superstore: { w: [30, 40], d: [28, 36], storeys: [1, 1] }, vintage: { w: [9, 11], d: [14, 18], storeys: [1, 2] }, hospice: { w: [14, 18], d: [18, 22], storeys: [1, 1] }, books: { w: [15, 18], d: [16, 20], storeys: [1, 1] }, barn: { w: [20, 28], d: [16, 22], storeys: [1, 1] }, consign: { w: [12, 16], d: [18, 22], storeys: [1, 1] }, dockside: { w: [22, 28], d: [22, 28], storeys: [1, 1] }, toys: { w: [14, 18], d: [16, 22], storeys: [1, 2] }, twofloor: { w: [18, 24], d: [20, 24], storeys: [2, 2] }, flea: { w: [30, 38], d: [24, 30], storeys: [1, 1] } } },
  bakery: { w: [7, 26], d: [11, 26], storeys: [1, 2], set: "town", planned: true, // a village bakery to a wholesale bakehouse
    sizes: { village: { w: [7, 9], d: [12, 15], storeys: [1, 2] }, patisserie: { w: [10, 13], d: [14, 18], storeys: [1, 1] }, donut: { w: [8, 10], d: [12, 15], storeys: [1, 1] }, wholesale: { w: [20, 26], d: [20, 26], storeys: [1, 1] }, cake: { w: [10, 13], d: [16, 20], storeys: [1, 1] }, bagel: { w: [13, 16], d: [12, 16], storeys: [1, 1] }, cafe: { w: [14, 18], d: [16, 20], storeys: [1, 1] }, corner: { w: [13, 15], d: [11, 14], storeys: [1, 1] }, artisan: { w: [13, 15], d: [14, 18], storeys: [1, 1] }, offices: { w: [10, 13], d: [14, 18], storeys: [2, 2] }, panaderia: { w: [14, 17], d: [15, 18], storeys: [1, 1] }, farm: { w: [12, 16], d: [12, 16], storeys: [1, 1] } } },
  butcher: { w: [6, 30], d: [9, 30], storeys: [1, 2], set: "town", planned: true, // a market stall to a meat packer
    sizes: { family: { w: [7, 9], d: [13, 16], storeys: [1, 1] }, smokehouse: { w: [10, 13], d: [15, 19], storeys: [1, 1] }, meatmarket: { w: [14, 18], d: [18, 22], storeys: [1, 1] }, game: { w: [16, 20], d: [14, 18], storeys: [1, 1] }, halal: { w: [13, 15], d: [12, 15], storeys: [1, 1] }, sausage: { w: [10, 13], d: [16, 20], storeys: [1, 1] }, packer: { w: [24, 30], d: [24, 30], storeys: [1, 1] }, delibutcher: { w: [11, 14], d: [15, 18], storeys: [1, 1] }, flat: { w: [7, 9], d: [13, 16], storeys: [2, 2] }, wrap: { w: [13, 15], d: [14, 18], storeys: [1, 1] }, ranch: { w: [14, 18], d: [16, 20], storeys: [1, 1] }, stall: { w: [6, 8], d: [9, 11], storeys: [1, 1] } } },
  deli: { w: [6, 24], d: [10, 24], storeys: [1, 2], set: "town", planned: true, // a sandwich counter to a food hall deli
    sizes: { classic: { w: [7, 9], d: [12, 15], storeys: [1, 1] }, nyc: { w: [14, 18], d: [18, 22], storeys: [1, 1] }, salumeria: { w: [10, 13], d: [16, 20], storeys: [1, 1] }, sandwich: { w: [6, 8], d: [10, 13], storeys: [1, 1] }, market: { w: [16, 20], d: [20, 24], storeys: [1, 1] }, caterer: { w: [11, 14], d: [15, 18], storeys: [1, 1] }, flat: { w: [13, 15], d: [12, 15], storeys: [2, 2] }, smokehouse: { w: [11, 14], d: [15, 18], storeys: [1, 1] }, foodhall: { w: [20, 24], d: [20, 24], storeys: [1, 1] }, wrap: { w: [13, 15], d: [14, 17], storeys: [1, 1] }, country: { w: [11, 14], d: [13, 16], storeys: [1, 2] }, lunch: { w: [11, 13], d: [14, 17], storeys: [2, 2] } } },
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
  // #30's mall (on hold): its sizes and plans its own (mall.js MALL; a mall is several buildings on one map, its shops
  // the archetypes' own): only the storeys rule applies
  regionalmall: { set: "city", own: true }, stripmall: { set: "town", own: true }, outlet: { set: "town", own: true },
  cinema: { set: "city", own: true }, arcade: { set: "city", own: true }, mallservices: { set: "city", own: true },
  mallrestrooms: { set: "city", own: true }, vacantunit: { set: "city", own: true },
  // #60's amusement parks (amusement.js): the whole park on one map, a row a variant: its grounds' width and depth in
  // metres (the map's, within battlesize.js MAP_CAP.amusement) and the storeys of its tallest buildings
  amusement: { set: "city", planned: true, w: [120, 500], d: [110, 500], storeys: [1, 2], sizes: {
    themepark: { w: [440, 500], d: [420, 500], storeys: [2, 2] }, regional: { w: [300, 360], d: [280, 340], storeys: [1, 2] },
    fairground: { w: [260, 320], d: [220, 280], storeys: [1, 1] }, pier: { w: [110, 130], d: [320, 400], storeys: [1, 2] },
    waterpark: { w: [240, 300], d: [220, 280], storeys: [1, 2] }, carnival: { w: [150, 180], d: [130, 160], storeys: [1, 1] },
    funcentre: { w: [150, 180], d: [140, 170], storeys: [1, 1] }, family: { w: [190, 230], d: [170, 210], storeys: [1, 1] },
    abandoned: { w: [300, 360], d: [260, 320], storeys: [1, 2] }, funfair: { w: [220, 260], d: [180, 220], storeys: [1, 1] },
    lights: { w: [220, 280], d: [200, 260], storeys: [1, 1] }, trampoline: { w: [120, 140], d: [110, 130], storeys: [1, 2] },
    western: { w: [260, 320], d: [240, 300], storeys: [1, 2] },
  } },
  // #59's zoos: a site of many buildings on one map (zoo.js zooMap lays it out from its variant's grid, zoolayout.js
  // ZOO_SIZE its buildings): a sizes row per variant, the site's width and depth in metres (the whole map, a metre a
  // cell) and its buildings' storeys (zoo.js caps every building's at the row's most: a city zoo's keepers' block of
  // two, a city aquarium's three levels, a university zoo's research building of three, the rest one).
  zoo: { set: "city", own: true, storeys: [1, 3], sizes: { // measured over 40 sites a plan (tools/zootest.js holds every map to its row)
    cityzoo: { w: [360, 464], d: [294, 390], storeys: [1, 2] }, cityaquarium: { w: [321, 349], d: [194, 218], storeys: [1, 3] },
    safari: { w: [298, 458], d: [301, 352], storeys: [1, 1] }, researchzoo: { w: [163, 239], d: [136, 199], storeys: [1, 3] },
    primate: { w: [167, 195], d: [175, 208], storeys: [1, 1] }, townzoo: { w: [142, 169], d: [125, 147], storeys: [1, 1] },
    birdpark: { w: [147, 175], d: [160, 189], storeys: [1, 1] }, petting: { w: [91, 112], d: [112, 133], storeys: [1, 1] },
    reptile: { w: [95, 116], d: [89, 139], storeys: [1, 1] }, rescue: { w: [91, 143], d: [112, 133], storeys: [1, 1] },
    bigcat: { w: [104, 165], d: [124, 145], storeys: [1, 1] }, roadside: { w: [87, 104], d: [83, 130], storeys: [1, 1] },
  } },
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
  // A radio tower compound (issue #54, radiotowerlayout.js): its transmitter building by plan (a row a plan); the yard,
  // the fence and the mast outside it. planned: each plan drawn at its row's size.
  radiotower:  { w: [7, 24], d: [4, 18], storeys: [1, 4], set: "rural", planned: true, sizes: {
    am: { w: [14, 18], d: [10, 13], storeys: [1, 1] }, fmtv: { w: [20, 26], d: [12, 15], storeys: [1, 1] }, cell: { w: [12, 14], d: [5, 7], storeys: [1, 1] },
    microwave: { w: [14, 17], d: [9, 11], storeys: [1, 1] }, firerep: { w: [10, 12], d: [8, 10], storeys: [1, 1] }, ham: { w: [14, 18], d: [11, 14], storeys: [1, 1] },
    military: { w: [16, 20], d: [11, 14], storeys: [1, 1] }, ebs: { w: [16, 20], d: [12, 15], storeys: [2, 2] }, radar: { w: [12, 15], d: [10, 12], storeys: [1, 1] },
    rooftop: { w: [16, 22], d: [14, 18], storeys: [3, 4] }, broadcast: { w: [18, 24], d: [13, 16], storeys: [2, 2] }, utility: { w: [10, 13], d: [9, 11], storeys: [1, 1] },
  } },
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
  hotel:         { w: [21, 92], d: [19, 56], storeys: [2, 10], set: "town", planned: true }, // d to 56: a shaped variant's (issue #50)
  // sizes: a shaped variant's bounding box (issue #50: a new save's L, T, U, E, crescent, podium and courtyard
  // footprints, hotellayout.js SHAPES; an older save's hotel the rectangle its row gives)
  hotelinn:      { w: [21, 25], d: [19, 19], storeys: [2, 3], set: "rural", planned: true },
  hotelbusiness: { w: [40, 60], d: [21, 23], storeys: [4, 6], set: "town", planned: true,
    sizes: { "biz-highway": { w: [48, 54], d: [40, 46], storeys: [4, 5] }, "biz-conference": { w: [52, 60], d: [38, 44], storeys: [5, 6] } } },
  hotelresort:   { w: [64, 90], d: [21, 23], storeys: [2, 4], set: "rural", planned: true,
    sizes: { "res-family": { w: [76, 88], d: [44, 52], storeys: [3, 4] }, "res-golf": { w: [86, 90], d: [42, 48], storeys: [2, 4] }, "res-beach": { w: [86, 92], d: [26, 30], storeys: [3, 4] } } },
  hoteltower:    { w: [36, 44], d: [21, 23], storeys: [8, 10], set: "city", planned: true,
    sizes: { "tow-podium": { w: [50, 58], d: [35, 36] }, "tow-twin": { w: [60, 66], d: [36, 37] }, "tow-grand": { w: [54, 58], d: [54, 56], storeys: [8, 9] } } },
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
  // #49's new plans (civicvariants.js, new worlds only), drawn at these sizes and laid out at their kind's sizes row
  // below (CIVIC_REAL) by realScale: a regional medical centre's tower and wings (a shape), a county hospital, a city
  // medical centre's bed tower (the campus round it: civicsite.js), a parish church with its churchyard, a police
  // headquarters with its impound lot, a fire headquarters with its training tower.
  "hospital.regional": { w: [66, 72], d: [44, 48], storeys: [5, 8], set: "city", planned: true }, // Regional medical centre (a U: the bed tower, the ER wing, the clinics' wing)
  "hospital.county": { w: [32, 36], d: [20, 22], storeys: [2, 4], set: "town", planned: true }, // County hospital
  "hospital.medcampus": { w: [30, 34], d: [20, 22], storeys: [6, 10], set: "city", planned: true }, // City medical centre (its bed tower)
  "church.churchyard": { w: [13, 15], d: [20, 23], storeys: [1, 1], set: "rural", planned: true }, // Parish church and churchyard
  "police.hqsite": { w: [30, 34], d: [20, 22], storeys: [4, 6], set: "city", planned: true }, // Police headquarters and impound lot
  "firestation.hqsite": { w: [32, 36], d: [18, 20], storeys: [3, 3], set: "city", planned: true }, // Fire headquarters and training tower
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
  // #52's mines and quarries (minelayout.js MINE_PLANS, QUARRY_PLANS): planned at these sizes by their plans, storeys
  // counting a mine's levels below (the surface and one to three levels); the mine complex's headframe building is the
  // shaft mine's, the open pit's main building the crusher plant's (their other buildings: minelayout.js PARTS).
  mine:        { w: [13, 54], d: [7, 34], storeys: [1, 4], set: "rural", planned: true,
    sizes: {
      shaft: { w: [40, 46], d: [26, 30], storeys: [3, 4] }, hardrock: { w: [48, 54], d: [30, 34], storeys: [4, 4] }, drift: { w: [34, 40], d: [24, 28], storeys: [1, 1] },
      gold: { w: [20, 24], d: [12, 14], storeys: [2, 2] }, coal: { w: [40, 46], d: [24, 28], storeys: [2, 2] }, dry: { w: [27, 32], d: [14, 18], storeys: [1, 2] },
      magazine: { w: [13, 15], d: [7, 9], storeys: [1, 1] }, slope: { w: [30, 36], d: [18, 22], storeys: [2, 3] }, salt: { w: [44, 50], d: [30, 34], storeys: [2, 2] },
      showmine: { w: [26, 30], d: [16, 20], storeys: [2, 2] }, rescue: { w: [22, 26], d: [14, 16], storeys: [2, 2] }, mill: { w: [34, 40], d: [22, 26], storeys: [2, 2] },
      complex: { w: [40, 46], d: [26, 30], storeys: [3, 4] },
    } },
  quarry:      { w: [9, 38], d: [6, 22], storeys: [1, 2], set: "rural", planned: true,
    sizes: {
      pit: { w: [26, 32], d: [16, 20], storeys: [2, 2] }, crusher: { w: [26, 32], d: [16, 20], storeys: [2, 2] }, scale: { w: [9, 11], d: [6, 8], storeys: [1, 1] },
      shop: { w: [32, 38], d: [18, 22], storeys: [1, 1] }, magazine: { w: [9, 12], d: [7, 9], storeys: [1, 1] }, gravel: { w: [16, 20], d: [9, 11], storeys: [1, 1] },
      granite: { w: [30, 36], d: [16, 20], storeys: [1, 1] }, lime: { w: [22, 26], d: [14, 16], storeys: [2, 2] }, slate: { w: [28, 32], d: [10, 12], storeys: [1, 1] },
      sand: { w: [24, 28], d: [12, 14], storeys: [1, 1] }, asphalt: { w: [26, 30], d: [14, 16], storeys: [1, 1] }, concrete: { w: [26, 30], d: [16, 18], storeys: [1, 1] },
      flooded: { w: [14, 18], d: [8, 10], storeys: [1, 1] },
    } },
  // #53's sawmills and lumber yards (sawmilllayout.js SAWMILL_PLANS): planned at these sizes by their plans, a portable
  // bandsaw mill's lean-to to the industrial mill's saw house (its yard's other buildings: sawmilllayout.js YARD_BUILDINGS)
  sawmill:     { w: [9, 46], d: [7, 26], storeys: [1, 3], set: "rural", planned: true,
    sizes: {
      family: { w: [20, 24], d: [12, 14], storeys: [1, 1] }, industrial: { w: [40, 46], d: [22, 26], storeys: [2, 2] }, planing: { w: [34, 38], d: [18, 22], storeys: [1, 1] },
      lumberyard: { w: [32, 38], d: [14, 18], storeys: [1, 1] }, pallet: { w: [32, 36], d: [20, 24], storeys: [1, 1] }, shingle: { w: [18, 22], d: [12, 14], storeys: [1, 1] },
      portable: { w: [9, 11], d: [7, 8], storeys: [1, 1] }, watermill: { w: [14, 17], d: [11, 13], storeys: [2, 3] }, treated: { w: [28, 34], d: [16, 20], storeys: [1, 1] },
      logsort: { w: [14, 16], d: [9, 11], storeys: [1, 1] }, millwork: { w: [22, 26], d: [14, 16], storeys: [2, 2] }, framer: { w: [18, 22], d: [12, 14], storeys: [2, 2] },
      kilnmill: { w: [36, 40], d: [20, 24], storeys: [1, 1] },
    } },
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
  // Data centres (issue #51, datacenter.js): planned at their own size, a row a plan (a campus's: one of its halls; its
  // operations building dcadmin and gatehouse dcgate), metres at CELL_M.
  datacenter: { w: [24, 90], d: [16, 52], storeys: [1, 5], set: "town", planned: true, sizes: {
    colo: { w: [44, 56], d: [30, 38], storeys: [3, 5] }, hyperscale: { w: [70, 90], d: [40, 52], storeys: [1, 1] }, edge: { w: [30, 40], d: [22, 28], storeys: [1, 1] },
    telecom: { w: [24, 32], d: [18, 24], storeys: [2, 4] }, bankdr: { w: [38, 48], d: [28, 34], storeys: [2, 2] }, govdc: { w: [50, 64], d: [34, 42], storeys: [2, 2] },
    research: { w: [34, 44], d: [24, 30], storeys: [2, 2] }, bunker: { w: [50, 58], d: [28, 34], storeys: [2, 3] }, crypto: { w: [36, 46], d: [16, 20], storeys: [1, 1] },
    container: { w: [30, 38], d: [24, 28], storeys: [1, 1] }, playout: { w: [36, 44], d: [26, 32], storeys: [2, 2] }, cloudregion: { w: [60, 80], d: [36, 46], storeys: [2, 2] },
    enterprise: { w: [38, 48], d: [26, 32], storeys: [2, 2] }, dcadmin: { w: [30, 38], d: [16, 20], storeys: [2, 2] }, dcgate: { w: [8, 10], d: [6, 8], storeys: [1, 1] },
  } },
};

// Civic and medical buildings at real scale (issue #49 of the round-2 epic #39, the user's request 2026-10-26: "updating
// the map size of civic and medical buildings to be max size of 350x350"): a sizes row for every plan of the hospital,
// the infirmary, the clinic, the vet, the church, the police station, the fire station (civicvariants.js VARIANTS: #36's
// twelve and #49's new ones), city hall and the courthouse (officeplans.js: #27's twelve each, by the plan's id). A row is
// [w0, w1, d0, d1, storeys0, storeys1, city0, city1] in metres: the footprint the plan is laid out over (buildingmaps.js
// realScale: wings of the plan, its rooms split, its containers to the square metre as at its own size) and its storeys
// (a city's when the last two are given). A "general" plan's row is {}: its kind's own row (#14's and #15's plans scaled
// as before). New worlds only (worldcfg.js legacyCivic): an older save's plans stay at their drawn sizes ("<kind>.<id>").
// The maps round them are at most battlesize.js MAP_CAP's 350 (a hospital, a church) or 300.
/** @type {Record<string, Record<string, number[] | null>>} */
export const CIVIC_REAL = {
  hospital: { general: null, critical: [30, 40, 22, 28, 1, 2], tower: [40, 50, 30, 36, 5, 7, 7, 10], children: [60, 80, 36, 46, 2, 4, 3, 5], psych: [50, 64, 28, 36, 2, 3],
    va: [60, 80, 36, 46, 3, 4, 4, 6], trauma: [70, 90, 40, 50, 3, 4, 4, 6], pavilion: [70, 90, 26, 32, 1, 2], teaching: [80, 110, 46, 60, 4, 5, 6, 9], cottage: [24, 30, 16, 20, 1, 1],
    surgical: [32, 40, 22, 26, 2, 3], nursing: [50, 64, 26, 32, 2, 2], regional: [130, 160, 84, 100, 5, 8, 6, 10], county: [44, 56, 30, 38, 2, 4], medcampus: [62, 70, 40, 46, 6, 8, 8, 10] },
  infirmary: { general: null, prison: [22, 26, 15, 18, 1, 1], prisonhosp: [30, 36, 18, 22, 2, 3], jail: [19, 22, 14, 16, 1, 1], camp: [14, 16, 11, 13, 1, 1], campus: [22, 26, 14, 17, 2, 2],
    field: [26, 32, 15, 18, 1, 1], aid: [20, 24, 16, 18, 1, 1], company: [18, 22, 13, 16, 1, 2], boarding: [17, 20, 13, 15, 2, 2], quarantine: [22, 26, 15, 17, 1, 2], shelter: [20, 24, 14, 16, 1, 1] },
  clinic: { general: null, urgent: [24, 30, 16, 20, 1, 2], family: [18, 22, 13, 16, 1, 1], dialysis: [26, 32, 15, 18, 1, 1], dental: [18, 22, 12, 15, 1, 1], stripmall: [12, 14, 20, 26, 1, 1],
    occhealth: [22, 26, 15, 18, 1, 2], free: [18, 22, 13, 16, 1, 1], multi: [30, 36, 18, 22, 2, 3, 3, 4], paediatric: [22, 26, 14, 18, 1, 1], rural: [12, 16, 10, 12, 1, 1], surgery: [26, 32, 16, 20, 1, 2] },
  vet: { general: null, country: [26, 30, 14, 16, 1, 1], farm: [30, 36, 15, 18, 1, 1], emergency: [28, 32, 16, 18, 1, 2], shelter: [28, 34, 15, 18, 1, 1], boarding: [22, 26, 14, 16, 1, 1],
    equine: [32, 38, 16, 20, 1, 1], storefront: [11, 13, 20, 24, 1, 1], specialty: [24, 28, 16, 18, 2, 2], exotic: [17, 20, 12, 15, 1, 1], cat: [15, 17, 12, 14, 1, 1], teaching: [34, 40, 17, 20, 2, 2] },
  church: { general: null, chapel: [12, 14, 16, 20, 1, 1], brick: [26, 30, 22, 26, 1, 1], mega: [44, 60, 30, 40, 2, 2], cathedral: [40, 50, 70, 90, 1, 1], storefront: [11, 13, 16, 20, 1, 1],
    rectory: [24, 28, 20, 24, 1, 1], country: [14, 16, 22, 26, 1, 1], cruciform: [34, 40, 40, 50, 1, 1], mission: [24, 28, 20, 24, 1, 1], school: [30, 36, 22, 26, 1, 2], meeting: [16, 18, 16, 18, 2, 2],
    churchyard: [15, 18, 24, 30, 1, 1] },
  police: { general: null, substation: [22, 26, 15, 18, 1, 1], smalltown: [24, 28, 16, 20, 1, 2], precinct: [34, 42, 22, 28, 3, 3, 3, 4], patrol: [28, 34, 15, 18, 1, 1], hq: [40, 54, 28, 36, 4, 5, 6, 10],
    jail: [40, 50, 26, 32, 2, 2], community: [18, 22, 22, 26, 1, 2], barracks: [28, 32, 17, 20, 2, 2], townhall: [32, 38, 22, 26, 2, 2], k9: [30, 36, 18, 20, 1, 2], courthouse: [28, 34, 20, 24, 2, 3],
    hqsite: [40, 50, 28, 34, 4, 6, 5, 8] },
  firestation: { general: null, volunteer: [26, 30, 15, 17, 1, 1], twobay: [26, 30, 16, 18, 2, 2], tower: [36, 42, 18, 22, 1, 1], airport: [32, 38, 18, 22, 2, 2], hq: [36, 44, 22, 28, 3, 3, 3, 4],
    brush: [17, 20, 14, 16, 1, 1], firehouse: [14, 17, 22, 26, 2, 3], drive: [24, 28, 20, 24, 1, 2], rescue: [32, 36, 17, 20, 2, 2], academy: [38, 44, 20, 24, 1, 1], county: [28, 32, 20, 22, 1, 1],
    hqsite: [36, 44, 22, 28, 3, 3] },
  // #27's plans by their ids (planname.js planSlug); their storeys their plan's (realScale keeps a scaled plan's own).
  cityhall: { "city-hall": [36, 48, 28, 36, 2, 3], "domed-capitol": [48, 64, 36, 46, 2, 3], "town-hall-with-fire-bay": [30, 36, 22, 28, 2, 2], "town-hall-with-police-office": [30, 36, 22, 28, 2, 2],
    "municipal-annex": [36, 44, 24, 30, 3, 3], "city-hall-and-library": [36, 44, 26, 32, 2, 2], "hall-with-municipal-court": [36, 44, 26, 32, 2, 3], "modern-civic-center": [44, 56, 30, 40, 2, 3],
    "town-hall-with-auditorium": [34, 40, 26, 32, 2, 2], "public-works-hall": [32, 40, 22, 28, 1, 2], "city-hall-with-records-vault": [36, 44, 26, 32, 2, 3], "village-hall": [20, 24, 16, 20, 1, 1] },
  courthouse: { "county-courthouse": [40, 52, 30, 38, 2, 3], "courthouse-and-jail": [44, 54, 30, 38, 2, 3], "twin-courtroom-courthouse": [40, 50, 28, 34, 2, 3], "family-court": [34, 42, 24, 30, 2, 2],
    "federal-courthouse": [50, 64, 36, 44, 3, 3], "traffic-court": [32, 38, 20, 24, 1, 1], "old-courthouse": [36, 44, 26, 32, 2, 2], "justice-center": [50, 62, 34, 42, 2, 3],
    "courthouse-with-law-library": [40, 50, 28, 34, 2, 3], "probate-court": [32, 40, 22, 28, 2, 2], "courthouse-with-sally-port": [40, 50, 28, 34, 2, 3], "magistrate-s-court": [26, 32, 20, 24, 1, 2] },
};
for (const [kind, rows] of Object.entries(CIVIC_REAL)) {
  const R = REAL_SIZE[kind], planned = !!R.planned;
  R.sizes = Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, !r ? {} : {
    w: /** @type {[number, number]} */ ([r[0], r[1]]), d: /** @type {[number, number]} */ ([r[2], r[3]]), storeys: /** @type {[number, number]} */ ([r[4], r[5]]),
    city: /** @type {[number, number]} */ ([r[6] ?? r[4], r[7] ?? r[5]]), ...(planned ? { planned: false } : {}), // #27's planned rows: laid out at this size instead (realScale)
  }]));
}

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
