// @ts-check
// Loot that makes sense for every building type (issue #43 of the round-2 epic #39; the user's request 2026-10-26:
// "Each building type here and and existing should have loot that makes sense"). Pure data and two small helpers;
// nothing in the game reads it: tools/lootsensetest.js holds every building type's containers to it.
//
// GROUPS: the kinds of find the table speaks of (guns, drugs, tools, liquor...), each a set of supply keys (`sup`,
//   as a container's contents hold them before typeFind and sortFind name the food and the rounds) and a test on an
//   item's key (`item`, mostly by data.js GEAR cat).
// PERSONAL: the room types where people kept their own things (a house's rooms, a flat over a shop, a guest room, a
//   dorm room, the luggage room, the cars left outside): a pistol in a nightstand over a bakery is the baker's, not the bakery's. A kind's
//   `never` groups are checked on its other rooms (its own); a personal room only has PERSONAL_NEVER (the Army's
//   weapons) unless its kind's row says `strict` (every room checked).
// LOOT_SENSE: one row per buildingmaps.js BUILDINGS key (the test fails on a building type with no row):
//   sig    { group: rate }: the share of buildings of the kind (over 100 or more) where the group turns up in at least
//          one container, at least `rate` (bodies and the scenes' stashes not counted).
//   never  [group]: never in the kind's own containers (bodies, the scenes' stashes, locked safes and gun safes
//          aside: those are someone's stash, locks.js; and the personal rooms, above).
//   site   the site type its containers roll as (the first buildingmaps.js SITES entry that lists it if none).
//   note   why a row is as it is, where it is not plain.
// How to add a building type (wave 2 of #39: #51–#62): add its row here (sig: what you would expect to find there,
// with a rate it reaches; never: what you would never find), run `node tools/lootsensetest.js <key>` to see its rates
// and anything out of place (`--why <group> <key>`: where it came from), then `--baseline <key>` and paste the line
// into tools/lootsensetest.js BASELINE. See docs/features/combat.md#loot-that-makes-sense.

/** @typedef {{ sup?: string[], item?: (key: string, cat: string) => boolean, label: string }} Group */
/** @typedef {{ sig?: Record<string, number>, never?: string[], site?: string, strict?: boolean, note?: string }} Sense */

const MILITARY = new Set(["m79", "m32", "at4", "rpg", "m203", "frag", "amr", "lmg", "m240"]);
const TOOLS = new Set(["toolbox", "hammer", "crowbar", "prybar", "sledge", "pickaxe", "pipewrench", "shovel", "axe", "multitool", "halligan"]);
const SPORTS = new Set(["sportspads", "footballhelmet", "goaliemask", "hockeystick", "bat", "golfclub", "bikehelmet", "kneeguards", "shinguards", "fishrod", "bicycle"]);
const BODY_ARMOUR = new Set(["vest", "plate", "tacvest", "riothelmet", "riotarms", "riotlegs", "milhelmet", "ceramicplate", "steelplate", "softinsert", "highcut", "kevlarkit", "riotvisor", "ballvisor"]);
const READING = new Set(["novel", "comic", "magazines", "puzzlebook"]);
const EXPLOSIVE = new Set(["frag", "pipebomb", "molotov", "m79", "m32", "at4", "rpg", "m203"]);

/** @type {Record<string, Group>} */
export const GROUPS = {
  food:      { label: "food", sup: ["food", "preserved"] },
  drink:     { label: "water and drinks", sup: ["water"] },
  drugs:     { label: "drugs (meds)", sup: ["meds"] },
  medgear:   { label: "medical kit", item: (k, c) => c === "medical" },
  surgical:  { label: "surgical tools", item: (k) => k === "surgkit" || k === "traumakit" },
  vetmeds:   { label: "animal medicine", item: (k) => k === "dewormer" },
  ammo:      { label: "ammunition", sup: ["ammo"], item: (k, c) => c === "ammo" },
  pistol:    { label: "handguns", item: (k, c) => c === "pistol" },
  longgun:   { label: "rifles and shotguns", item: (k, c) => (c === "rifle" || c === "shotgun") && !MILITARY.has(k) },
  military:  { label: "military arms", item: (k, c) => c === "automatic" || MILITARY.has(k) },
  guns:      { label: "any gun", item: (k, c) => c === "pistol" || c === "rifle" || c === "shotgun" || c === "automatic" || MILITARY.has(k) },
  bows:      { label: "bows", item: (k, c) => c === "bow" },
  explosive: { label: "grenades, bombs and launchers", item: (k) => EXPLOSIVE.has(k) },
  flashbangs: { label: "flashbangs and smoke", item: (k) => k === "flashbang" || k === "smokegren" },
  armour:    { label: "body armour", item: (k) => BODY_ARMOUR.has(k) },
  gunmods:   { label: "gun parts", item: (k, c) => c === "gunmod" },
  tools:     { label: "tools", item: (k, c) => c === "tools" || TOOLS.has(k) },
  parts:     { label: "parts", sup: ["parts", "carparts", "gunparts", "electronics"] },
  build:     { label: "building materials", sup: ["buildmat", "wood", "metalsheet"] },
  fuel:      { label: "fuel", sup: ["fuel", "propane"] },
  liquor:    { label: "liquor", item: (k, c) => c === "liquor" },
  treats:    { label: "snacks and treats", item: (k, c) => c === "treats" },
  books:     { label: "books", item: (k, c) => c === "books" || READING.has(k) },
  gadgets:   { label: "phones, laptops, radios", item: (k, c) => c === "gadgets" || c === "electronics" },
  valuables: { label: "jewellery and collectibles", item: (k, c) => c === "jewelry" || c === "collectibles" || k === "cashbox" },
  sports:    { label: "sports gear", item: (k) => SPORTS.has(k) },
  clothing:  { label: "clothes and bags", item: (k, c) => c === "packs" || k === "leatherjacket" || k === "motopants" },
  camp:      { label: "camping gear", item: (k, c) => c === "camp" },
};

export const PERSONAL = new Set(["house", "farmhouse", "cabin", "hotelroom", "dormroom", "luggage", "wreck", "roadcars"]);
export const PERSONAL_NEVER = ["military", "explosive"];

// The groups a container's contents fall in. sup: { key: n }; keys: the items' keys; cat: key → GEAR cat.
/** @param {Record<string, number>} sup @param {string[]} keys @param {(k: string) => string} cat */
export function groupsOf(sup, keys, cat) {
  const out = new Set();
  for (const [g, d] of Object.entries(GROUPS)) {
    if (d.sup && d.sup.some((k) => (sup[k] || 0) > 0)) out.add(g);
    else if (d.item && keys.some((k) => /** @type {any} */ (d.item)(k, cat(k)))) out.add(g);
  }
  return out;
}

// The never lists most rows share: a shop's or an office's own rooms hold no guns, rounds or gun parts (a gun under a
// counter, in a safe or a manager's desk is someone's: see each row), and no civilian place the Army's weapons.
const ARMY = ["military", "explosive"];
const NO_GUNS = ["guns", "ammo", "military", "explosive", "gunmods", "armour"];
const S = (sig, never = [], o = {}) => ({ sig, never, ...o });

/** @type {Record<string, Sense>} */
export const LOOT_SENSE = {
  // Homes and the countryside.
  house:          S({ food: 0.8, drink: 0.8, tools: 0.6 }, ARMY),
  farmhouse:      S({ food: 0.8, longgun: 0.5, ammo: 0.5 }, ARMY),
  cabin:          S({ food: 0.6, longgun: 0.4, ammo: 0.5 }, ARMY),
  lodge:          S({ longgun: 0.5, ammo: 0.6, camp: 0.4, bows: 0.2 }, ARMY),
  ranger:         S({ food: 0.6, parts: 0.4, longgun: 0.2 }, ["explosive"], { note: "a ranger is police: a patrol rifle in the gun locker" }),
  neighbourhood:  S({ food: 0.95, tools: 0.9, drugs: 0.7 }, ARMY),
  apartments:     S({ food: 0.9, drink: 0.9, drugs: 0.7 }, ARMY),
  motel:          S({ food: 0.9, drink: 0.9, drugs: 0.6 }, ARMY),
  barn:           S({ food: 0.9, build: 0.8, longgun: 0.5, vetmeds: 0.3 }, ARMY),
  machineshed:    S({ tools: 0.7, parts: 0.9, fuel: 0.6 }, ARMY, { note: "a farm's shed: a hunting rifle in the barn rooms" }),
  shelter:        S({ food: 0.9, tools: 0.8, parts: 0.6 }, ["explosive"]),
  prepper:        S({ food: 0.9, longgun: 0.6, ammo: 0.7, camp: 0.3 }, [], { note: "a prepper's pipe bombs" }),
  // Food and drink.
  grocery:        S({ food: 0.9, drink: 0.9, treats: 0.4 }, NO_GUNS),
  corner:         S({ food: 0.9, drink: 0.9, treats: 0.4 }, NO_GUNS),
  supermarket:    S({ food: 0.95, drink: 0.95, drugs: 0.9, treats: 0.9, liquor: 0.5 }, NO_GUNS),
  restaurant:     S({ food: 0.9, drink: 0.9 }, [...ARMY, "ammo", "gunmods", "armour"], { note: "a restaurant's bar keeps the bar's shotgun behind it now and then" }),
  pizza:          S({ food: 0.9, drink: 0.9 }, [...ARMY, "ammo", "gunmods", "armour"], { note: "as a restaurant" }),
  diner:          S({ food: 0.9, drink: 0.9 }, NO_GUNS),
  bar:            S({ liquor: 0.5, drink: 0.9, food: 0.9 }, [...ARMY, "armour"], { note: "a bar's shotgun or revolver behind the counter" }),
  liquor:         S({ liquor: 0.9, drink: 0.9 }, [...ARMY, "armour"], { note: "a gun under the counter now and then (data-shops.js ROWS.ARSENAL_AREA); its table's pistol and revolver on every shelf are its bottles since issue #43" }),
  gasstation:     S({ food: 0.9, drink: 0.9, fuel: 0.8, treats: 0.25 }, [...ARMY, "guns", "gunmods", "armour"], { note: "a country station's bait room sells .22 rounds" }),
  truckstop:      S({ food: 0.9, drink: 0.9, fuel: 0.9, treats: 0.6 }, ARMY),
  cinema:         S({ food: 0.9, drink: 0.9, treats: 0.3 }, NO_GUNS),
  // Shops.
  pharmacy:       S({ drugs: 0.9, medgear: 0.7, surgical: 0.4 }, NO_GUNS),
  gunstore:       S({ guns: 0.95, pistol: 0.9, longgun: 0.9, ammo: 0.95, gunmods: 0.6 }, ["explosive"], { note: "military: a semi-automatic AK on the rack" }),
  pawnshop:       S({ guns: 0.9, valuables: 0.5, gadgets: 0.5, tools: 0.6 }, ["explosive"]),
  sportshop:      S({ sports: 0.9, camp: 0.7, bows: 0.6, clothing: 0.8 }, ["explosive"], { note: "its gun counter: hunting rifles, shotguns, a semi-automatic AK" }),
  electronics:    S({ gadgets: 0.8, parts: 0.9 }, NO_GUNS),
  radioshop:      S({ gadgets: 0.8, parts: 0.9 }, NO_GUNS),
  bookstore:      S({ books: 0.9 }, NO_GUNS),
  petstore:       S({ food: 0.9, vetmeds: 0.6, medgear: 0.6 }, NO_GUNS),
  garden:         S({ tools: 0.9, build: 0.9, fuel: 0.8 }, NO_GUNS),
  clothing:       S({ clothing: 0.9, valuables: 0.3 }, NO_GUNS),
  hardware:       S({ tools: 0.9, build: 0.9, fuel: 0.9, parts: 0.9 }, ARMY),
  feedstore:      S({ food: 0.9, vetmeds: 0.4, build: 0.8, tools: 0.8 }, ARMY, { note: "a farm-supply store keeps hunting rifles and shotguns in its barn rooms" }),
  dealer:         S({ parts: 0.9, fuel: 0.8, tools: 0.8 }, ARMY),
  deptstore:      S({ clothing: 0.6, gadgets: 0.3, food: 0.9 }, ARMY),
  bank:           S({ valuables: 0.8, gadgets: 0.5 }, ARMY, { note: "a revolver in a safe-deposit box (the vault)" }),
  library:        S({ books: 0.9 }, NO_GUNS),
  museum:         S({ valuables: 0.75, food: 0.9, treats: 0.8, tools: 0.75, books: 0.65 }, [...ARMY, "ammo", "gunmods"], { note: "a military museum's arms vault holds a working antique now and then (its locked cases: locks.js relic); its galleries the odd helmet" }),
  // Medical.
  vet:            S({ drugs: 0.9, vetmeds: 0.6, medgear: 0.7, surgical: 0.25 }, NO_GUNS),
  clinic:         S({ drugs: 0.9, medgear: 0.9, surgical: 0.4 }, NO_GUNS),
  infirmary:      S({ drugs: 0.9, medgear: 0.9, surgical: 0.5 }, ARMY),
  hospital:       S({ drugs: 0.95, medgear: 0.95, surgical: 0.8 }, ARMY),
  aidstation:     S({ drugs: 0.9, medgear: 0.7 }),
  lab:            S({ drugs: 0.8, medgear: 0.5, parts: 0.7, gadgets: 0.5 }, ARMY),
  healthcentre:   S({ drugs: 0.95, medgear: 0.95, surgical: 0.5 }, NO_GUNS),
  // Police, prisons, the Army.
  police:         S({ guns: 0.9, ammo: 0.9, armour: 0.5, flashbangs: 0.5 }, ["explosive"]),
  security:       S({ guns: 0.9, ammo: 0.9 }, ["explosive"], { note: "campus police: patrol rifles in the gun locker" }),
  cellblock:      S({ food: 0.6, drink: 0.8 }),
  prison:         S({ food: 0.95, guns: 0.9, ammo: 0.9 }),
  jail:           S({ food: 0.95, ammo: 0.9 }),
  barracks:       S({ military: 0.6, ammo: 0.9, armour: 0.8, flashbangs: 0.5, camp: 0.8 }),
  armorybldg:     S({ guns: 0.9, military: 0.8, ammo: 0.9, flashbangs: 0.8, explosive: 0.2 }),
  messhall:       S({ food: 0.95, drink: 0.95 }),
  hq:             S({ gadgets: 0.8, parts: 0.9, ammo: 0.6 }),
  gatehouse:      S({ ammo: 0.6, guns: 0.5, gadgets: 0.6 }),
  motorpool:      S({ fuel: 0.9, parts: 0.9, tools: 0.9 }),
  hangar:         S({ parts: 0.9, fuel: 0.9, tools: 0.9 }),
  tower:          S({ parts: 0.9, gadgets: 0.7, fuel: 0.8 }),
  flightops:      S({ gadgets: 0.6, parts: 0.9, fuel: 0.5 }),
  milbunker:      S({ military: 0.6, ammo: 0.9, food: 0.9 }),
  mountainbunker: S({ military: 0.6, ammo: 0.9, food: 0.9 }),
  govbunker:      S({ military: 0.5, ammo: 0.9, food: 0.9 }),
  // Fire, travel and work.
  firestation:    S({ tools: 0.9, medgear: 0.5, fuel: 0.8 }),
  terminal:       S({ food: 0.9, drink: 0.9, treats: 0.5, gadgets: 0.5 }, ARMY),
  warehouse:      S({ food: 0.8, tools: 0.8, parts: 0.8, build: 0.8 }, ARMY),
  factory:        S({ tools: 0.8, parts: 0.8, build: 0.6 }, NO_GUNS),
  autoshop:       S({ tools: 0.9, parts: 0.9, fuel: 0.9 }, ARMY),
  garage:         S({ tools: 0.9, parts: 0.9, fuel: 0.7 }, ARMY),
  workshop:       S({ tools: 0.9, parts: 0.9, build: 0.7 }, ARMY),
  control:        S({ parts: 0.9, gadgets: 0.7 }, ARMY),
  radio:          S({ parts: 0.9, gadgets: 0.6 }, ["explosive"], { note: "the relay's guard post and its gun rack (milplans.js; #54 reworks radio towers)" }),
  radiotower:     S({ parts: 0.95, fuel: 0.8, tools: 0.5, gadgets: 0.4 }, ARMY, { site: "radiotower", note: "the tower compound (#54, radiotowerlayout.js): electronics and radio parts, batteries and radios, the generator shed's fuel and tools, the cable store's cable (scrap); a military relay's compound has its guard post" }),
  // Offices and civic.
  offices:        S({ gadgets: 0.6, parts: 0.8, drink: 0.9 }, ARMY, { note: "a pistol in an executive's desk now and then" }),
  storefront:     S({ parts: 0.5, drink: 0.8 }, NO_GUNS),
  bizpark:        S({ parts: 0.9, gadgets: 0.6 }, NO_GUNS),
  cityhall:       S({ gadgets: 0.9, valuables: 0.9, parts: 0.9 }, ARMY, { note: "a pistol in the mayor's desk now and then" }),
  courthouse:     S({ books: 0.5, gadgets: 0.9 }, ARMY, { note: "the evidence room's guns and rounds" }),
  callcenter:     S({ gadgets: 0.9, treats: 0.7 }, NO_GUNS),
  techoffice:     S({ gadgets: 0.9, parts: 0.9 }, [...ARMY, "longgun", "ammo", "gunmods", "armour"], { note: "a pistol in the founder's desk now and then" }),
  station:        S({ gadgets: 0.8, parts: 0.9 }, [...ARMY, "longgun", "ammo", "gunmods", "armour"], { note: "a pistol in the station manager's desk now and then" }),
  church:         S({ valuables: 0.5, food: 0.8 }, NO_GUNS),
  hotel:          S({ liquor: 0.9, drink: 0.9, food: 0.9, clothing: 0.8 }, ARMY, { note: "a lodge's gun room" }),
  // Schools and the campus.
  school:         S({ sports: 0.6, food: 0.9, gadgets: 0.8 }, NO_GUNS),
  campus:         S({ books: 0.8, gadgets: 0.95, food: 0.95 }),
  dorm:           S({ gadgets: 0.9, food: 0.9, sports: 0.7 }, NO_GUNS),
  lecturehall:    S({ gadgets: 0.7, parts: 0.6 }, NO_GUNS),
  sciencehall:    S({ drugs: 0.8, medgear: 0.6, parts: 0.9 }, NO_GUNS),
  univlibrary:    S({ books: 0.7 }, NO_GUNS),
  studentunion:   S({ food: 0.9, gadgets: 0.7 }, [...ARMY, "ammo", "gunmods", "armour"], { note: "the campus pub is a bar (its shotgun)" }),
  dininghall:     S({ food: 0.95, drink: 0.95 }, NO_GUNS),
  athletics:      S({ sports: 0.9 }, NO_GUNS),
  admin:          S({ gadgets: 0.9, parts: 0.9 }, NO_GUNS),
  maintenance:    S({ tools: 0.9, parts: 0.9, build: 0.8 }, NO_GUNS),
  theatre:        S({ gadgets: 0.5, parts: 0.6 }, NO_GUNS),
  parkgarage:     S({ fuel: 0.9, parts: 0.9 }, ["explosive"], { note: "campus security's gun locker" }),
  chapel:         S({ valuables: 0.7 }, NO_GUNS),
  // Malls.
  regionalmall:   S({ clothing: 0.95, food: 0.95, gadgets: 0.95 }),
  stripmall:      S({ clothing: 0.9, food: 0.9 }),
  outlet:         S({ clothing: 0.9, food: 0.9 }),
  amusement:      S({ food: 0.9, drink: 0.9, treats: 0.8, drugs: 0.6, medgear: 0.4, tools: 0.5, parts: 0.8, fuel: 0.8 }, NO_GUNS, { note: "issue #60: a park's snacks and prizes, the first-aid station's, the maintenance shop's tools and parts, the fuel for the generators and the karts; no guns anywhere on it" }),
  arcade:         S({ parts: 0.8, food: 0.5 }, NO_GUNS),
  mallservices:   S({ drugs: 0.5, gadgets: 0.5 }, ["explosive"], { note: "mall security's gun rack" }),
  mallrestrooms:  S({ drink: 0.25, food: 0.25 }, NO_GUNS),
  vacantunit:     S({ food: 0.1 }, NO_GUNS),
};
