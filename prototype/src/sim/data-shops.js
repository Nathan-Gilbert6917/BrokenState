// @ts-check
// The town's and the city's shops and services as places (the user's requests 2026-10-21: "Add sporting good/out door
// store (Add football gear as a light armor and other sport items like clubs, bows, bats etc for weapons) Add
// electronics shop, add radio shop, add bookstore and libraries add grocery stores, diners, clinics, motels, churches,
// auto shops, animal/pet stores, fire station, police stations, garden center, clothing stores, vet clinics, car dealer
// ship, pizza shops and other restaurants, banks, bars, liquor store add all of these and have them more common in
// areas that makes sense and make versions that fit the setting if they apply to multiple places for city, town,
// suburbs POIs and crawls"; "Create many variants for each to show being different franchises including colors,
// layout etc"). Pure data (its one import, data-offices.js, is pure data too: the office buildings and their firms,
// issue #27, merged into each table below), so data.js, loot.js, combat.js and the rest can each merge their own slice.
//
// NEW_KINDS: the site types new with this module (each module takes its part: data.js LOCATIONS from site, loot.js
//   SITE_TAGS from tags, combat.js AREA_SETS from areas, battlesize.js SIZES.SITE from size, buildingmaps.js the
//   building from building). Their raid rooms: AREA_DEFS (combat.js AREAS, loot.js AREA_TAGS from tags).
// PLACE_W: where each shop or service stands as a place (shops.js): its weight on a city block, a city's suburb and a
//   town's suburb ring (a tile's own dice, SHOP.POI), and on the crawl's blocks (crawl.city / crawl.town, + deep a
//   block deeper in, from the block `from`); rich and dead × the building's (citycrawl.js placeDanger,
//   placeRichness); rare: shown as a find on the block's card.
// FRANCHISES: the versions of a kind (fictional chains and local names, never a real company's): its name, where it
//   stands (w: city, suburb, town), its look on the map (look: wall, trim, sign, text and accent colours, roof, style
//   0–3: the painter's shape, ui/mapsprites.js) and its layout inside (plan: buildingmaps.js reads fl, the main
//   room's floor; depth, the share of the building the front room takes; wide; flat, the chance of a flat above;
//   storeys; room, the front room's name; back, the back's arrangement by kind; libs, a library's variants and their
//   weights: librarylayout.js; variants, the layout variants of shopvariants.js that fit it, issue #35: a new save's
//   plan is one of them, the older keys keep an older save's). A place's franchise is its own dice
//   (shops.js franchiseFor): poi.v, place.v, a site's by its tile.
// ROWS: the new kinds' rows in the find tables, by table (each module merges its own: loot.js SITE_FINDS …).

import { OFFICE_KINDS, OFFICE_AREAS, OFFICE_W, OFFICE_FIRMS, OFFICE_ROWS } from "./data-offices.js"; // the office buildings of every kind, with their firms (issue #27)
import { PARK_KINDS, PARK_AREA_DEFS } from "./data-parks.js"; // amusement parks, fairgrounds and water parks (issue #60): pure data too
import { NEWSHOP_KINDS, NEWSHOP_AREAS, NEWSHOP_W, NEWSHOP_FRANCHISES, NEWSHOP_ROWS } from "./data-newshops.js"; // six more shops (issue #55): pure data too
import { TOWER_AREAS } from "./data-radiotower.js"; // a radio tower compound's rooms (issue #54)

/** @typedef {{ wall: string, trim: string, sign: string, text: string, accent: string, roof?: string, style: number }} Look */
/** @typedef {{ fl?: string, depth?: number, wide?: boolean, flat?: number, storeys?: [number, number], room?: string, back?: string, office?: string, media?: string, truck?: boolean, hotel?: string, libs?: Record<string, number>, variants?: string[] }} Plan */
/** @typedef {{ id: string, name: string, w: { city: number, suburb: number, town: number, scenic?: number }, look: Look, plan?: Plan, eat?: { cuisine: string, format: string, size: string, brew?: boolean, truck?: boolean } }} Franchise */

import { VARIANTS } from "./data-eateries.js"; // the restaurant variants (issue #33): pure data too
import { MINE_AREAS } from "./data-mines.js"; // a mine's raid rooms: the workings, the dry, the lamp room, the magazines (issue #52)
import { MUSEUM_AREAS } from "./data-museums.js"; // a museum's raid rooms (issue #58): pure data too

const G = (city, suburb, town) => ({ city, suburb, town });
const L = (wall, trim, sign, text, accent, style = 0, roof = undefined) => ({ wall, trim, sign, text, accent, style, ...(roof ? { roof } : {}) });

// ---------- the new site types ----------
export const NEW_KINDS = {
  // Shopping malls (issue #30, mall.js): a strip mall in a town or a city's suburbs, an outlet centre by a highway (the
  // regional mall is the old "mall" site, data.js). Their raid map is the whole complex (buildingmaps.js BUILDINGS
  // stripmall, outlet: compound.js); placed on their own dice (pois.js mallExtra), never by PLACE_W.
  stripmall: {
    site: { name: "Strip mall", glyph: "Sm", cat: "town", danger: 1, gearRate: 1.2, loot: { food: 2, water: 1, scrap: 2, meds: 0.3, parts: 1 },
      gear: ["knife", "backpack", "slingbag", "duffle", "flashlight", "bat", "golfclub", "hikingpack", "handradio", "stove"], richness: 0.6, known: "public" }, // never above a town's (pois.js: a place never out-ranks its tile's site)
    tags: ["shop", "mall", "home", "kitchen"],
    areas: ["store", "store", "clothes", "kitchen", "office", "wreck"], size: 1, storeys: [1, 1],
  },
  outlet: {
    site: { name: "Outlet centre", glyph: "Oc", cat: "urban", danger: 2, gearRate: 1.3, loot: { food: 1, water: 1, scrap: 3, parts: 1 },
      gear: ["backpack", "slingbag", "duffle", "hikingpack", "leatherjacket", "motopants", "kneeguards", "bikehelmet", "bat", "golfclub", "stove", "waterfilter"], richness: 0.8, known: "public" },
    tags: ["shop", "mall", "sport", "travel", "home"],
    areas: ["clothes", "clothes", "sportshop", "store", "kitchen", "wreck"], size: 1, storeys: [1, 1],
  },
  sportshop: {
    site: { name: "Sporting goods store", glyph: "Sp", cat: "town", danger: 1, gearRate: 1.5, loot: { water: 1, food: 1, ammo: 1, scrap: 1 },
      gear: ["bat", "golfclub", "hockeystick", "compbow", "xbow", "footballhelmet", "sportspads", "goaliemask", "kneeguards", "bikehelmet", "bicycle", "hikingpack", "backpack", "duffle", "stove", "waterfilter", "headlamp", "lantern", "binoculars", "monocular", "machete", "hatchet", "rifle22", "spear", "handwarmer", "fishrod"],
      richness: 0.65, known: "public" },
    tags: ["sport", "outdoor", "camp", "hunt", "shop", "mall"],
    areas: ["sportshop", "sportshop", "store", "lockers", "office"], size: 0.5, storeys: [1, 2],
  },
  electronics: {
    site: { name: "Electronics store", glyph: "El", cat: "urban", danger: 2, gearRate: 1.2, loot: { parts: 4, scrap: 2, water: 0.5 },
      gear: ["handradio", "flashlight", "windlight", "binoculars", "telescope", "slingbag", "backpack"], richness: 0.65, known: "public" },
    tags: ["tech", "shop", "mall", "home"],
    areas: ["electronics", "electronics", "store", "office"], size: 0.5, storeys: [1, 2],
  },
  radioshop: {
    site: { name: "Radio shop", glyph: "Ra", cat: "town", danger: 1, gearRate: 1.4, loot: { parts: 4, scrap: 2 },
      gear: ["handradio", "flashlight", "windlight", "headlamp", "binoculars", "spotlight", "repairkit"], richness: 0.5, known: "public" },
    tags: ["tech", "shop", "travel", "tools"],
    areas: ["radioshop", "radioshop", "workshop", "office"], size: 0.5, storeys: [1, 1],
  },
  bookstore: {
    site: { name: "Bookstore", glyph: "Bk", cat: "town", danger: 1, loot: { scrap: 1, water: 1, food: 0.5 },
      gear: ["slingbag", "backpack", "windlight", "lantern"], richness: 0.45, known: "public" },
    tags: ["books", "shop", "home", "office"],
    areas: ["books", "books", "store", "office"], size: 0.5, storeys: [1, 2],
  },
  library: {
    site: { name: "Library", glyph: "Li", cat: "town", danger: 1, loot: { water: 1, scrap: 1, food: 0.5 },
      gear: ["slingbag", "backpack", "fireaxe", "telescope"], richness: 0.5, known: "public" },
    tags: ["books", "school", "office"],
    areas: ["books", "books", "books", "office", "kitchen"], size: 0.5, storeys: [1, 3],
  },
  petstore: {
    site: { name: "Pet store", glyph: "Pe", cat: "town", danger: 1, loot: { food: 3, water: 1, meds: 0.5, scrap: 1 },
      gear: ["dewormer", "bandagekit", "flashlight", "backpack", "slingbag"], richness: 0.45, known: "public" },
    tags: ["shop", "farm", "medical", "home"],
    areas: ["petstore", "petstore", "store", "warehouse"], size: 0.5, storeys: [1, 1],
  },
  garden: {
    site: { name: "Garden center", glyph: "Gd", cat: "town", danger: 1, gearRate: 1.2, loot: { scrap: 3, water: 2, rawwater: 1, food: 1, fuel: 0.4 },
      gear: ["hatchet", "machete", "pickaxe", "sledge", "barbedwire", "sandbags", "boards", "beartrap", "lantern", "hammer", "crowbar"], richness: 0.55, known: "public" },
    tags: ["farm", "tools", "shop", "outdoor"],
    areas: ["garden", "garden", "store", "barn"], size: 0.5, storeys: [1, 1],
  },
  clothing: {
    site: { name: "Clothing store", glyph: "Ct", cat: "town", danger: 1, gearRate: 1.2, loot: { scrap: 1, water: 1, food: 0.5 },
      gear: ["leatherjacket", "motopants", "backpack", "slingbag", "duffle", "hikingpack", "bikehelmet", "kneeguards", "handwarmer"], richness: 0.5, known: "public" },
    tags: ["shop", "mall", "home", "travel", "sport"],
    areas: ["clothes", "clothes", "store", "office"], size: 0.5, storeys: [1, 2],
  },
  vet: {
    site: { name: "Veterinary clinic", glyph: "Vt", cat: "town", danger: 1, loot: { meds: 4, water: 1, food: 1 },
      gear: ["dewormer", "bandagekit", "surgkit"], richness: 0.55, known: "public" },
    tags: ["medical", "farm"],
    areas: ["vet", "vet", "clinic", "office"], size: 0.5, storeys: [1, 1],
  },
  dealer: {
    site: { name: "Car dealership", glyph: "Cd", cat: "town", danger: 1, loot: { fuel: 0.8, parts: 3, scrap: 2 }, // fuel: a little in the lot's tanks, as an auto shop's (the real sources: gas stations, truck stops, airports, the military: farmtest.js)
      gear: ["crowbar", "prybar", "flashlight", "repairkit", "kneeguards", "sledge", "hammer", "spotlight"], richness: 0.65, known: "public" },
    tags: ["garage", "shop", "travel", "tools", "office"],
    areas: ["dealer", "garage", "garage", "office", "wreck"], size: 0.5, storeys: [1, 2],
  },
  restaurant: {
    site: { name: "Restaurant", glyph: "Rs", cat: "town", danger: 1, loot: { food: 5, water: 3, scrap: 1, jars: 0.5 },
      gear: ["knife", "bottle", "flashlight", "slingbag"], richness: 0.45, known: "public" },
    tags: ["kitchen", "shop", "travel"],
    areas: ["kitchen", "kitchen", "store", "wreck"], size: 0.5, storeys: [1, 1],
  },
  bank: {
    site: { name: "Bank", glyph: "Bn", cat: "town", danger: 1, loot: { scrap: 1, water: 1 },
      gear: ["pistol", "revolver", "slingbag"], richness: 0.6, known: "public" },
    tags: ["office", "crime", "shop"],
    areas: ["bankvault", "office", "office", "store"], size: 0.5, storeys: [1, 3],
  },
  bar: {
    site: { name: "Bar", glyph: "Ba", cat: "town", danger: 1, loot: { water: 3, food: 2, scrap: 1 },
      gear: ["bat", "shotgun", "revolver", "pistol", "bottle", "knife"], richness: 0.45, known: "public" },
    tags: ["kitchen", "crime", "travel", "shop", "home"],
    areas: ["bar", "bar", "kitchen", "store"], size: 0.5, storeys: [1, 2],
  },
  // A hotel (issue #29, the user's request 2026-10-25: "add hotel 200x200 max"): a roadside inn, a business hotel, a
  // resort or a city tower by its franchise (hotellayout.js). Not a shop of PLACE_W: it stands on dice of its own
  // (hotels.js: a POI in a town, a city or scenic land, a place in the crawl), so the shops' lists stay as they were.
  hotel: {
    site: { name: "Hotel", glyph: "Ht", cat: "town", danger: 2, loot: { food: 2, water: 2, meds: 1, scrap: 2, ammo: 0.5 },
      gear: ["pistol", "compact9", "knife", "backpack", "duffle", "slingbag", "flashlight"], richness: 0.6, known: "public" },
    tags: ["home", "travel", "kitchen", "office", "shop"],
    areas: ["hotelroom", "hotelroom", "hotelfront", "kitchen", "luggage"], size: 1, storeys: [2, 10],
  },
  liquor: {
    site: { name: "Liquor store", glyph: "Lq", cat: "town", danger: 1, loot: { water: 2, food: 1, scrap: 1 },
      gear: ["bottle", "revolver", "pistol", "bat", "flashlight"], richness: 0.45, known: "public" },
    tags: ["shop", "crime", "travel", "kitchen", "home"],
    areas: ["liquor", "liquor", "store", "office"], size: 0.5, storeys: [1, 1],
  },
  ...OFFICE_KINDS, // the office buildings (data-offices.js)
  ...PARK_KINDS, // the amusement parks (data-parks.js, issue #60)
  ...NEWSHOP_KINDS, // the furniture store, laundromat, thrift store, bakery, butcher and deli (data-newshops.js, issue #55)
};

// ---------- their raid rooms (combat.js AREAS; tags: loot.js AREA_TAGS) ----------
export const AREA_DEFS = {
  // Shopping malls (issue #30): mall security's office and locker room (a few weapons: cuffs, batons, radios), the arcade,
  // the cinema's concession stand.
  mallsec: { tags: ["police", "tech", "shop"], def: { name: "Mall security", boxes: ["locker", "locker", "cabinet"],
    loot: { ammo: [0.25, 4, 12], meds: [0.15, 1, 1], water: [0.25, 1, 2] }, gear: [["baton", 0.16], ["cuffs", 0.14], ["handradio", 0.14], ["flashlight", 0.12], ["taser", 0.05], ["vest", 0.03], ["pistol", 0.035], ["revolver", 0.015], ["riotarms", 0.02]] } },
  arcade: { tags: ["tech", "shop", "mall"], def: { name: "Arcade", boxes: ["counter", "shelf", "cabinet"],
    loot: { scrap: [0.55, 1, 3], parts: [0.45, 1, 2], food: [0.15, 1, 2] }, gear: [["flashlight", 0.03], ["slingbag", 0.02]] } },
  cinema: { tags: ["shop", "kitchen", "mall"], def: { name: "Cinema", boxes: ["counter", "shelf", "cabinet"],
    loot: { food: [0.7, 2, 6], water: [0.65, 2, 6], scrap: [0.2, 1, 2] }, gear: [["candy", 0.08], ["chocolate", 0.06], ["flashlight", 0.04], ["slingbag", 0.02]] } }, // candy: the concession stand's (issue #43)
  sportshop: { tags: ["sport", "outdoor", "camp", "hunt", "shop"], def: { name: "Sporting goods", boxes: ["shelf", "shelf", "locker"],
    loot: { water: [0.3, 1, 3], food: [0.25, 1, 3], ammo: [0.15, 4, 12] },
    gear: [["bat", 0.08], ["golfclub", 0.06], ["hockeystick", 0.06], ["compbow", 0.04], ["xbow", 0.02], ["footballhelmet", 0.06], ["sportspads", 0.06], ["goaliemask", 0.04], ["kneeguards", 0.05], ["bikehelmet", 0.04], ["hikingpack", 0.05], ["backpack", 0.04], ["duffle", 0.03], ["stove", 0.04], ["waterfilter", 0.04], ["headlamp", 0.04], ["binoculars", 0.03], ["machete", 0.03], ["hatchet", 0.03], ["rifle22", 0.015], ["fishrod", 0.03], ["bicycle", 0.02]] } },
  electronics: { tags: ["tech", "shop", "mall", "home"], def: { name: "Electronics floor", boxes: ["shelf", "shelf", "counter"],
    loot: { parts: [0.65, 1, 3], scrap: [0.4, 1, 3] }, gear: [["handradio", 0.05], ["flashlight", 0.05], ["windlight", 0.03], ["binoculars", 0.02], ["telescope", 0.01]] } },
  radioshop: { tags: ["tech", "shop", "travel", "tools"], def: { name: "Radio counter", boxes: ["counter", "shelf", "cabinet"],
    loot: { parts: [0.7, 1, 3], scrap: [0.4, 1, 3] }, gear: [["handradio", 0.12], ["flashlight", 0.05], ["windlight", 0.04], ["headlamp", 0.03], ["spotlight", 0.02], ["repairkit", 0.02]] } },
  books: { tags: ["books", "shop", "school", "office", "home"], def: { name: "Bookshelves", boxes: ["shelf", "shelf", "counter"],
    loot: { scrap: [0.3, 1, 2], water: [0.12, 1, 2] }, // its books since issue #43 (a bookstore's shelves held none of their own)
    gear: [["novel", 0.08], ["comic", 0.05], ["magazines", 0.05], ["puzzlebook", 0.03], ["cookbook", 0.01], ["gardenbook", 0.008], ["survivalbook", 0.006], ["diybook", 0.006], ["slingbag", 0.02], ["windlight", 0.01]] } },
  petstore: { tags: ["shop", "farm", "medical", "home"], def: { name: "Pet supplies", boxes: ["shelf", "shelf", "crate"],
    loot: { food: [0.7, 3, 8], water: [0.3, 1, 3], meds: [0.12, 1, 1] }, gear: [["dewormer", 0.06], ["bandagekit", 0.03], ["flashlight", 0.02]] } },
  garden: { tags: ["farm", "tools", "shop", "outdoor"], def: { name: "Garden aisles", boxes: ["shelf", "crate", "crate"],
    loot: { scrap: [0.5, 1, 4], water: [0.3, 1, 3], rawwater: [0.3, 2, 6], fuel: [0.15, 1, 2], buildmat: [0.2, 1, 2], wood: [0.3, 20, 60] },
    gear: [["hatchet", 0.04], ["machete", 0.04], ["pickaxe", 0.03], ["sledge", 0.02], ["barbedwire", 0.05], ["sandbags", 0.04], ["boards", 0.05], ["beartrap", 0.03], ["lantern", 0.03]] } },
  clothes: { tags: ["shop", "mall", "home", "travel", "sport"], def: { name: "Clothing racks", boxes: ["shelf", "shelf", "counter"],
    loot: { scrap: [0.35, 1, 3], water: [0.12, 1, 2] },
    gear: [["leatherjacket", 0.06], ["motopants", 0.04], ["backpack", 0.04], ["slingbag", 0.05], ["duffle", 0.03], ["hikingpack", 0.02], ["kneeguards", 0.02], ["bikehelmet", 0.02]] } },
  vet: { tags: ["medical", "farm"], def: { name: "Vet clinic", boxes: ["cabinet", "shelf", "locker"],
    loot: { meds: [0.6, 1, 4], food: [0.3, 1, 3], water: [0.3, 1, 2] }, gear: [["dewormer", 0.1], ["bandagekit", 0.05], ["surgkit", 0.03]] } },
  dealer: { tags: ["garage", "shop", "travel", "office", "tools"], def: { name: "Showroom", boxes: ["counter", "cabinet", "shelf"],
    loot: { parts: [0.35, 1, 2], scrap: [0.3, 1, 3], fuel: [0.2, 1, 3] }, gear: [["flashlight", 0.04], ["repairkit", 0.03], ["slingbag", 0.02], ["spotlight", 0.02]] } },
  bankvault: { tags: ["office", "crime", "shop", "home"], def: { name: "Vault", boxes: ["locker", "locker", "cabinet"],
    loot: { scrap: [0.2, 1, 2] }, gear: [["pistol", 0.03], ["revolver", 0.02]] } },
  bar: { tags: ["kitchen", "crime", "travel", "shop", "home"], def: { name: "Bar", boxes: ["counter", "shelf", "cabinet"],
    loot: { water: [0.5, 2, 6], food: [0.3, 1, 4] }, gear: [["bottle", 0.12], ["bat", 0.03], ["shotgun", 0.02], ["revolver", 0.02], ["knife", 0.03]] } },
  // A hotel's (issue #29, hotellayout.js): a guest room (its minibar and a guest's suitcase have their own tables:
  // combat.js BOX_LOOT), the front desk (its safe: cash and valuables), the luggage room (suitcases), housekeeping
  // (linen, the toiletries: soap, shampoo, the little bottles).
  hotelroom: { tags: ["home", "travel"], def: { name: "Hotel room", boxes: ["nightstand", "wardrobe", "dresser"],
    loot: { water: [0.25, 1, 2], food: [0.15, 1, 2], scrap: [0.3, 1, 3], meds: [0.06, 1, 1] }, gear: [["slingbag", 0.02], ["flashlight", 0.02], ["knife", 0.015], ["pistol", 0.006]] } },
  hotelfront: { tags: ["office", "travel"], def: { name: "Front desk", boxes: ["counter", "cabinet"],
    loot: { scrap: [0.4, 1, 3], water: [0.2, 1, 2] }, gear: [["flashlight", 0.04]] } },
  luggage: { tags: ["travel", "home"], def: { name: "Luggage room", boxes: ["suitcase", "suitcase", "shelf"],
    loot: { scrap: [0.5, 1, 3] }, gear: [["backpack", 0.04], ["duffle", 0.04], ["slingbag", 0.04]] } },
  hotelhk: { tags: ["home", "shop"], def: { name: "Housekeeping", boxes: ["shelf", "cabinet"],
    loot: { scrap: [0.55, 1, 4], water: [0.2, 1, 2], meds: [0.05, 1, 1] }, gear: [] } },
  pitroom: { tags: ["kitchen", "shop", "travel"], def: { name: "Pit room", boxes: ["shelf", "counter", "shelf"], // a BBQ's smokers (issue #33)
    loot: { food: [0.6, 2, 6], preserved: [0.4, 1, 3], wood: [0.5, 10, 30] }, gear: [["knife", 0.06], ["cleaver", 0.04]] } },
  liquor: { tags: ["shop", "crime", "travel", "kitchen", "home"], def: { name: "Liquor shelves", boxes: ["shelf", "shelf", "counter"],
    loot: { water: [0.6, 2, 6], food: [0.25, 1, 3] }, gear: [["bottle", 0.15], ["whiskey", 0.04], ["vodka", 0.03], ["wine", 0.03], ["scotch", 0.005], ["bat", 0.02]] } }, // its bottles since issue #43, in place of a pistol and a revolver on every shelf (a supermarket's beer and wine aisle is a liquor room too)
  // A library's rooms by what they hold (issue #34, librarylayout.js): the reference and technical rooms (and a
  // genealogy archive) manuals and skill books; the map room maps (no map item in the game: the survival books, "maps,
  // tracks, reading the land", and a compass's worth of kit); the rare-books room valuables; the staff room snacks and
  // first aid; the computer bank electronics. The stacks and the reading rooms are "books" (above), and every container
  // in a library rolls skills.js's book as before.
  libref: { tags: ["books", "office", "school", "tools"], def: { name: "Reference shelves", boxes: ["bookshelf", "cardcat"],
    loot: { scrap: [0.25, 1, 2], parts: [0.05, 1, 1] },
    gear: [["medbook", 0.01], ["enginebook", 0.01], ["diybook", 0.008], ["forgebook", 0.007], ["surgerybook", 0.004], ["gardenbook", 0.008], ["survivalbook", 0.007], ["cookbook", 0.007], ["lockbook", 0.003], ["gunbook", 0.003], ["scavbook", 0.005], ["leadbook", 0.005], ["talkbook", 0.005]] } },
  libmaps: { tags: ["books", "travel", "outdoor"], def: { name: "Map cabinets", boxes: ["mapcase"],
    loot: { scrap: [0.3, 1, 2] }, gear: [["survivalbook", 0.08], ["bushcraftbook", 0.04], ["binoculars", 0.02], ["telescope", 0.01]] } },
  librare: { tags: ["books", "crime", "office"], def: { name: "Rare books", boxes: ["displaycase"],
    loot: { scrap: [0.15, 1, 1] }, gear: [["stamps", 0.06], ["coins", 0.03], ["silverware", 0.02], ["cigars", 0.02], ["scotch", 0.015], ["tcards", 0.015], ["goldchain", 0.01], ["watch", 0.01], ["surgerybook", 0.015], ["armymanual", 0.007]] } },
  libstaff: { tags: ["kitchen", "office", "medical"], def: { name: "Staff room", boxes: ["cabinet", "counter"],
    loot: { food: [0.45, 1, 3], water: [0.35, 1, 2], meds: [0.2, 1, 1] }, gear: [["bandagekit", 0.03], ["candy", 0.06], ["coffee", 0.04], ["tea", 0.04]] } },
  libtech: { tags: ["tech", "office", "school"], def: { name: "Computers", boxes: ["computer", "printer"],
    loot: { electronics: [0.2, 1, 1], parts: [0.2, 1, 1], scrap: [0.3, 1, 2] }, gear: [["laptop", 0.01], ["phone", 0.01], ["camera", 0.005], ["handradio", 0.005]] } },
  ...OFFICE_AREAS,
  ...PARK_AREA_DEFS, // a park's rooms (data-parks.js, issue #60)
  ...NEWSHOP_AREAS, // issue #55's rooms (data-newshops.js)
  ...TOWER_AREAS, // radio towers (issue #54, data-radiotower.js)
  ...MINE_AREAS, // a mine's workings below, its dry, its lamp room, an explosives magazine (issue #52, minelayout.js)
  ...MUSEUM_AREAS, // a museum's galleries, gift shop, café, labs, stores, dock and security (issue #58, museumlayout.js)
};

// ---------- where each stands (shops.js) ----------
// city: a city block; suburb: a city's suburbs (its footprint, pois.js POI.CITY_R); town: a town's suburb ring. crawl:
// the crawl's extra place, by a city's or a town's crawl, + deep a block deeper in, from block `from`.
const C = (city, town, deep = 0, from = 1, rich = 1, dead = 1, rare = false) => ({ city, town, deep, from, rich, dead, ...(rare ? { rare } : {}) });
export const PLACE_W = {
  // shops
  grocery:     { ...G(0.8, 1, 0.9),     crawl: C(0.8, 1.1, -0.05, 1, 1, 1) },
  corner:      { ...G(0.4, 0.5, 0.5),   crawl: C(0.3, 0.5, -0.05, 1, 0.8, 0.8) },
  sportshop:   { ...G(0.7, 1, 0.8),     crawl: C(0.7, 0.9, 0.05, 1, 1.05, 0.9, true) },
  electronics: { ...G(1, 0.7, 0.35),    crawl: C(0.9, 0.4, 0.15, 1, 1.05, 1) },
  radioshop:   { ...G(0.45, 0.4, 0.55), crawl: C(0.4, 0.6, 0.05, 1, 1, 0.9) },
  bookstore:   { ...G(0.7, 0.45, 0.45), crawl: C(0.7, 0.5, 0.1, 1, 0.9, 0.9) },
  library:     { ...G(0.45, 0.35, 0.5), crawl: C(0.4, 0.5, 0.1, 1, 0.95, 1.1) },
  petstore:    { ...G(0.5, 0.8, 0.45),  crawl: C(0.5, 0.5, 0, 1, 0.9, 0.9) },
  garden:      { ...G(0.25, 0.9, 0.75), crawl: C(0.25, 0.8, -0.1, 1, 1, 0.85) },
  clothing:    { ...G(1, 0.7, 0.45),    crawl: C(1, 0.5, 0.15, 1, 0.95, 1) },
  vet:         { ...G(0.35, 0.55, 0.65), crawl: C(0.3, 0.6, 0, 1, 1, 0.9) },
  dealer:      { ...G(0.35, 0.8, 0.55), crawl: C(0.4, 0.6, -0.1, 1, 1.05, 0.9) },
  pawnshop:    { ...G(0.8, 0.55, 0.55), crawl: C(0.7, 0.5, 0.05, 1, 1.1, 0.9, true) },
  gunstore:    { ...G(0.35, 0.5, 0.6),  crawl: C(0.35, 0.6, 0.05, 1, 1.2, 1, true) },
  hardware:    { ...G(0.45, 0.8, 0.8),  crawl: C(0.5, 0.8, -0.05, 1, 1.1, 0.9) },
  liquor:      { ...G(0.8, 0.7, 0.6),   crawl: C(0.8, 0.6, 0, 1, 0.9, 0.9) },
  // food and drink
  restaurant:  { ...G(1.5, 1.1, 0.8),   crawl: C(1.4, 0.9, 0.1, 1, 0.9, 1) },
  pizza:       { ...G(0.9, 0.9, 0.6),   crawl: C(0.8, 0.6, 0, 1, 0.9, 0.9) },
  diner:       { ...G(0.5, 0.8, 1),     crawl: C(0.5, 1, -0.05, 1, 0.9, 0.9) },
  bar:         { ...G(1.1, 0.6, 0.9),   crawl: C(1, 0.9, 0.1, 1, 0.9, 1.1) },
  // services
  bank:        { ...G(0.8, 0.4, 0.45),  crawl: C(0.7, 0.5, 0.2, 2, 1.15, 1, true) },
  clinic:      { ...G(0.45, 0.5, 0.45), crawl: C(0.4, 0.5, 0.05, 1, 1.1, 1.2) },
  motel:       { ...G(0.3, 0.4, 0.6),   crawl: C(0.3, 0.6, -0.1, 1, 0.9, 1) },
  church:      { ...G(0.35, 0.55, 0.7), crawl: C(0.3, 0.6, 0, 1, 0.9, 1.4) },
  autoshop:    { ...G(0.45, 0.75, 0.7), crawl: C(0.5, 0.7, -0.1, 1, 0.9, 0.8) },
  firestation: { ...G(0.2, 0.25, 0.25), crawl: C(0.2, 0.25, 0.05, 1, 1.1, 1) },
  police:      { ...G(0.15, 0.2, 0.2),  crawl: C(0.15, 0.2, 0.05, 1, 1.2, 1.3, true) },
  // the office buildings (data-offices.js): their own dice place them (shops.js officeExtras, officePlaces), not the shops'
  ...OFFICE_W,
  // issue #55's six shops (data-newshops.js): a new world's only (shops.js: worldcfg.js legacyShopsR2)
  ...NEWSHOP_W,
};

// ---------- the franchises ----------
// Colours: walls (brick, stucco, siding, glass), the sign board, its letters, an accent (awning, stripes, trim).
// style: the painter's shape (0 a flat front with an awning, 1 a sign on the roof, 2 a pylon sign by the door, 3 a
// big glass front).
export const FRANCHISES = {
  sportshop: [
    { id: "peaksports", name: "Peak Sports", w: G(1, 1, 0.3), look: L("#c9ced3", "#5d6168", "#1f4f9a", "#ffffff", "#e8c04a", 3), plan: { fl: "tile", depth: 0.7, wide: true, back: "big", variants: ["superstore", "flagship", "twofloor"] } },
    { id: "allstar", name: "All-Star Athletics", w: G(1, 0.8, 0.4), look: L("#d9d4c8", "#3c3a36", "#c8402f", "#ffffff", "#1f4f9a", 1), plan: { fl: "wood", depth: 0.65, back: "lockers", variants: ["main", "corner", "wrap", "strip"] } },
    { id: "trailhead", name: "Trailhead Outfitters", w: G(0.5, 1, 1), look: L("#7a5230", "#4a3424", "#3f6b3a", "#f0e6c8", "#c9873c", 0), plan: { fl: "wood", depth: 0.6, back: "camp", variants: ["outlet", "roadside", "counter"] } },
    { id: "bigbuck", name: "Big Buck Sporting Goods", w: G(0.1, 0.6, 1), look: L("#8b6a48", "#4a3424", "#5f7a3e", "#f0d070", "#a2713f", 2), plan: { fl: "conc", depth: 0.6, back: "hunt", variants: ["counter", "roadside", "outlet"] } },
    { id: "riverbend", name: "Riverbend Bait & Tackle", w: G(0, 0.3, 0.8), look: L("#5d8aa8", "#2d4a5e", "#e8e4d8", "#1f4f9a", "#d9a520", 0), plan: { fl: "wood", depth: 0.55, back: "camp", variants: ["narrow", "roadside", "main"] } },
    { id: "summit", name: "Summit Outdoor Co.", w: G(0.8, 0.8, 0.5), look: L("#3d4a3c", "#232b23", "#e2826f", "#ffffff", "#9cc46e", 3), plan: { fl: "conc", depth: 0.7, wide: true, back: "big", variants: ["flagship", "twin", "superstore"] } },
  ],
  electronics: [
    { id: "voltmart", name: "VoltMart", w: G(1, 1, 0.2), look: L("#2d4a6e", "#1c2a3a", "#e8c04a", "#1c2026", "#e2412f", 3), plan: { fl: "tile", depth: 0.72, wide: true, variants: ["superstore", "outlet", "twin"] } },
    { id: "circuittown", name: "Circuit Town", w: G(1, 0.8, 0.3), look: L("#c9ced3", "#5d6168", "#c8402f", "#ffffff", "#3a6fb0", 1), plan: { fl: "tile", depth: 0.65, variants: ["main", "corner", "strip", "twofloor"] } },
    { id: "megabyte", name: "MegaByte Electronics", w: G(1, 0.6, 0), look: L("#2a2a2e", "#111114", "#7fe6ff", "#111114", "#b06ae0", 3), plan: { fl: "tile", depth: 0.75, wide: true, variants: ["flagship", "superstore", "twin"] } },
    { id: "hifihut", name: "Hi-Fi Hut", w: G(0.6, 0.8, 0.5), look: L("#d8b47a", "#7a5230", "#5b3a7a", "#f0d070", "#e88aa0", 0), plan: { fl: "carpet", depth: 0.6, variants: ["wrap", "narrow", "main"] } },
    { id: "tvrepair", name: "Hometown TV & Repair", w: G(0, 0.3, 1), look: L("#b9a98a", "#6b5434", "#3d6fb0", "#ffffff", "#c9873c", 2), plan: { fl: "wood", depth: 0.5, back: "repair", variants: ["counter", "roadside", "narrow"] } },
  ],
  radioshop: [
    { id: "signalhill", name: "Signal Hill Radio", w: G(0.8, 0.8, 0.6), look: L("#c9b28a", "#6b5434", "#c8402f", "#ffffff", "#e8c04a", 1), plan: { fl: "tile", depth: 0.55, variants: ["main", "corner", "wrap"] } },
    { id: "wavelength", name: "Wavelength Electronics", w: G(1, 0.6, 0.3), look: L("#3a5f6e", "#20363f", "#7fe6ff", "#20363f", "#e8e4d8", 3), plan: { fl: "tile", depth: 0.62, variants: ["superstore", "twofloor", "twin", "flagship"] } },
    { id: "cbcorner", name: "CB Corner", w: G(0.1, 0.5, 1), look: L("#8e4f3c", "#4a2a20", "#e8c04a", "#2a2a2a", "#3f6b3a", 2), plan: { fl: "wood", depth: 0.5, back: "repair", variants: ["counter", "roadside", "strip"] } },
    { id: "antennajoe", name: "Antenna Joe's", w: G(0, 0.4, 1), look: L("#9a8f7a", "#4d4741", "#3d6fb0", "#ffffff", "#e2654f", 1), plan: { fl: "conc", depth: 0.45, back: "repair", variants: ["outlet", "roadside", "counter", "narrow"] } },
    { id: "freqsupply", name: "Frequency Supply", w: G(1, 0.5, 0.1), look: L("#5d6168", "#2a2a2e", "#e8e4d8", "#c8402f", "#7d848c", 0), plan: { fl: "tile", depth: 0.6, variants: ["flagship", "superstore", "main"] } },
  ],
  bookstore: [
    { id: "dogeared", name: "Dog-Eared Books", w: G(0.4, 0.7, 1), look: L("#7a3b32", "#4a2420", "#3f6b3a", "#f0e6c8", "#d9a520", 0), plan: { fl: "wood", depth: 0.7, variants: ["main", "counter", "wrap"] } },
    { id: "chapterverse", name: "Chapter & Verse", w: G(1, 0.8, 0.3), look: L("#2d4a3c", "#16241d", "#d9a520", "#16241d", "#e8e4d8", 3), plan: { fl: "carpet", depth: 0.72, wide: true, variants: ["superstore", "flagship", "twofloor"] } },
    { id: "secondstory", name: "Second Story Used Books", w: G(0.5, 0.5, 1), look: L("#b9a98a", "#6b5434", "#5b3a7a", "#ffffff", "#c9873c", 1), plan: { fl: "wood", depth: 0.6, flat: 0.7, variants: ["narrow", "roadside", "outlet"] } },
    { id: "boundfound", name: "Bound & Found", w: G(0.6, 1, 0.5), look: L("#d9c9a8", "#8a7a5a", "#c8402f", "#ffffff", "#3a6fb0", 2), plan: { fl: "wood", depth: 0.65, variants: ["corner", "strip", "twin"] } },
    { id: "readwells", name: "Readwell's", w: G(1, 0.6, 0.2), look: L("#e8e4d8", "#5d6168", "#1f4f9a", "#ffffff", "#e8c04a", 3), plan: { fl: "carpet", depth: 0.7, wide: true, variants: ["flagship", "twin", "superstore"] } },
  ],
  // Libraries (issue #34): each name lays its building out as one of librarylayout.js's variants (plan.libs: their
  // weights; the five first names' ids as before, so a saved place keeps its name): a Carnegie Library is always a
  // Carnegie, a Branch Library a modern branch or a strip-mall library, the Central Library the city's main one (only
  // downtown, and rare there: about 1 in 15 of the downtown libraries), the reading rooms and house libraries in the towns'
  // villages, the Athenaeum and Harmon Hall the rare historic ones; a children's library in the suburbs, a historical
  // society in the towns, the county law library and the college library rare downtown (the courthouse's and the
  // campus's own come from #27 and #28 through libraryPlan).
  library: [
    { id: "central", name: "Central Library", w: G(0.25, 0, 0), look: L("#c9c2b0", "#7d786c", "#5d6168", "#ffffff", "#8a8780", 1), plan: { storeys: [2, 3], wide: true, libs: { central: 1 } } },
    { id: "carnegie", name: "Carnegie Library", w: G(0.5, 0.4, 1), look: L("#8e4f3c", "#d9d0b8", "#3c3a36", "#e8e4d8", "#d9d0b8", 0), plan: { storeys: [1, 2], libs: { carnegie: 1 } } },
    { id: "branch", name: "Branch Library", w: G(0.6, 1, 0.5), look: L("#b9a98a", "#5d6168", "#3a6fb0", "#ffffff", "#9cc46e", 2), plan: { storeys: [1, 1], libs: { modern: 0.7, strip: 0.3 } } },
    { id: "county", name: "County Library", w: G(0.2, 0.7, 1), look: L("#a7adb3", "#5d6168", "#2d4a3c", "#e8e4d8", "#c9873c", 3), plan: { storeys: [1, 2], libs: { county: 0.85, bookmobile: 0.15 } } },
    { id: "memorial", name: "Memorial Library", w: G(0.8, 0.6, 0.8), look: L("#d9d4c8", "#8a8780", "#5b3a7a", "#ffffff", "#d9a520", 0), plan: { storeys: [1, 2], libs: { carnegie: 0.45, county: 0.25, historic: 0.15, archive: 0.15 } } },
    { id: "calderfree", name: "Calder Free Public Library", w: G(0.6, 0.4, 0.6), look: L("#9a5a44", "#e2d8c0", "#2d4a3c", "#f0e6c8", "#d9d0b8", 0), plan: { libs: { carnegie: 0.6, county: 0.4 } } },
    { id: "pinecrest", name: "Pinecrest Reading Room", w: G(0, 0.1, 1), look: L("#8b6a48", "#4a3424", "#3f6b3a", "#f0e6c8", "#c9873c", 0), plan: { libs: { rural: 1 } } },
    { id: "millbrook", name: "Millbrook Village Library", w: G(0, 0, 0.8), look: L("#c9b28a", "#6b5434", "#7a3b32", "#ffffff", "#e8e4d8", 2), plan: { libs: { rural: 0.6, house: 0.4 } } },
    { id: "elmstreet", name: "Elm Street House Library", w: G(0, 0.4, 0.6), look: L("#e2ddcc", "#6b5434", "#3f6b3a", "#ffffff", "#c9873c", 0), plan: { libs: { house: 1 } } },
    { id: "juniper", name: "Juniper Children's Library", w: G(0.3, 0.5, 0.3), look: L("#e8c04a", "#a8842a", "#3a6fb0", "#ffffff", "#e2412f", 3), plan: { libs: { children: 1 } } },
    { id: "countylaw", name: "Calder County Law Library", w: G(0.12, 0, 0.05), look: L("#c9c2b0", "#5d6168", "#2a2a2e", "#e8d8a8", "#8a6a3a", 1), plan: { libs: { law: 1 } } },
    { id: "college", name: "Calder College Library", w: G(0.06, 0.03, 0), look: L("#9a5a44", "#e2d8c0", "#5b2a2a", "#f0e6c8", "#d9a520", 1), plan: { libs: { university: 1 } } },
    { id: "historical", name: "Harlan County Historical Society", w: G(0.1, 0.2, 0.5), look: L("#d9d0b8", "#6b5434", "#4a2a20", "#f0d070", "#7a5a3a", 0), plan: { libs: { archive: 1 } } },
    { id: "lakeside", name: "Lakeside Branch Library", w: G(0.3, 1, 0.3), look: L("#d9e0e4", "#5d6168", "#2a7090", "#ffffff", "#9cc46e", 3), plan: { libs: { modern: 1 } } },
    { id: "westgate", name: "Westgate Library Express", w: G(0.3, 0.8, 0.2), look: L("#e8e4d8", "#3c3a36", "#c8402f", "#ffffff", "#3a6fb0", 3), plan: { libs: { strip: 1 } } },
    { id: "bookmobile", name: "County Bookmobile Depot", w: G(0, 0.3, 0.6), look: L("#a7adb3", "#4d4741", "#2d5a8a", "#ffffff", "#e8c04a", 2), plan: { libs: { bookmobile: 1 } } },
    { id: "athenaeum", name: "The Athenaeum", w: G(0.15, 0.05, 0.05), look: L("#d0c4a8", "#6b5434", "#3c3a36", "#e8d8a8", "#8a6a3a", 1), plan: { libs: { historic: 1 } } },
    { id: "harmonhall", name: "Harmon Hall Library", w: G(0.1, 0.1, 0.1), look: L("#7a5240", "#d9d0b8", "#4a2a20", "#f0d070", "#d9d0b8", 0), plan: { libs: { historic: 1 } } },
  ],
  petstore: [
    { id: "pawsclaws", name: "Paws & Claws", w: G(1, 1, 0.5), look: L("#e8c04a", "#a8842a", "#3a6fb0", "#ffffff", "#e2412f", 3), plan: { fl: "tile", depth: 0.68, wide: true, variants: ["superstore", "twin", "flagship"] } },
    { id: "happytails", name: "Happy Tails Pet Supply", w: G(0.8, 1, 0.6), look: L("#9cc46e", "#5f7a3e", "#e88aa0", "#ffffff", "#e8c04a", 0), plan: { fl: "tile", depth: 0.62, variants: ["main", "corner", "strip"] } },
    { id: "finsfeathers", name: "Fins & Feathers", w: G(1, 0.6, 0.3), look: L("#5d8aa8", "#2d4a5e", "#e8c04a", "#2d4a5e", "#7fe6ff", 1), plan: { fl: "tile", depth: 0.6, back: "tanks", variants: ["twin", "wrap", "twofloor"] } },
    { id: "feedbin", name: "The Feed Bin", w: G(0, 0.4, 1), look: L("#8b6a48", "#4a3424", "#c8402f", "#ffffff", "#d8b47a", 2), plan: { fl: "conc", depth: 0.5, back: "feed", variants: ["outlet", "roadside", "counter"] } },
    { id: "wagmore", name: "Wagmore Pet Mart", w: G(1, 0.8, 0.2), look: L("#d9d4c8", "#5d6168", "#b06ae0", "#ffffff", "#3a6fb0", 3), plan: { fl: "tile", depth: 0.72, wide: true, variants: ["flagship", "superstore", "narrow"] } },
  ],
  garden: [
    { id: "greenthumb", name: "Green Thumb Garden Center", w: G(1, 1, 0.6), look: L("#3f6b3a", "#232b23", "#e8e4d8", "#3f6b3a", "#e8c04a", 3), plan: { depth: 0.55, wide: true, variants: ["superstore", "flagship", "twin"] } },
    { id: "bloomingacres", name: "Blooming Acres Nursery", w: G(0.2, 0.7, 1), look: L("#c9b28a", "#6b5434", "#e88aa0", "#ffffff", "#9cc46e", 0), plan: { depth: 0.5, back: "yard", variants: ["outlet", "roadside"] } },
    { id: "sunflower", name: "Sunflower Garden Supply", w: G(0.6, 1, 0.7), look: L("#e8c04a", "#a8842a", "#5f7a3e", "#ffffff", "#c8402f", 2), plan: { depth: 0.55, variants: ["main", "corner", "strip", "narrow"] } },
    { id: "rootbranch", name: "Root & Branch", w: G(0.8, 0.9, 0.4), look: L("#5f4a3a", "#3a2a20", "#9cc46e", "#232b23", "#d8b47a", 1), plan: { depth: 0.6, back: "yard", variants: ["outlet", "counter", "wrap"] } },
    { id: "hillcrest", name: "Hillcrest Greenhouses", w: G(0, 0.5, 1), look: L("#a9cbe0", "#5d6168", "#3f6b3a", "#ffffff", "#e8e4d8", 3), plan: { depth: 0.65, wide: true, back: "yard", variants: ["twofloor", "roadside", "flagship"] } },
  ],
  clothing: [
    { id: "threadline", name: "Threadline", w: G(1, 1, 0.3), look: L("#e8e4d8", "#3c3a36", "#1c2026", "#ffffff", "#e2412f", 3), plan: { fl: "tile", depth: 0.72, wide: true, variants: ["superstore", "flagship", "twofloor"] } },
    { id: "denimco", name: "Denim & Co.", w: G(1, 0.8, 0.5), look: L("#3a5f8e", "#1f3550", "#e8e4d8", "#1f3550", "#c9873c", 1), plan: { fl: "wood", depth: 0.65, variants: ["main", "corner", "strip"] } },
    { id: "westernwear", name: "Western Wear Outlet", w: G(0, 0.4, 1), look: L("#a2713f", "#5a3a20", "#f0d070", "#5a3a20", "#c8402f", 2), plan: { fl: "wood", depth: 0.6, variants: ["roadside", "outlet"] } },
    { id: "workwear", name: "Workwear Depot", w: G(0.3, 1, 0.9), look: L("#7d858c", "#3c3a36", "#e8a020", "#1c2026", "#5d6168", 0), plan: { fl: "conc", depth: 0.62, variants: ["outlet", "counter", "wrap"] } },
    { id: "urbanthread", name: "Urban Thread", w: G(1, 0.5, 0), look: L("#2a2a2e", "#111114", "#e88aa0", "#111114", "#7fe6ff", 3), plan: { fl: "tile", depth: 0.7, variants: ["narrow", "twin", "corner"] } },
    { id: "mackinaw", name: "Mackinaw Outfitters", w: G(0.2, 0.6, 1), look: L("#7a3b32", "#3a1c18", "#e8e4d8", "#7a3b32", "#2d4a3c", 1), plan: { fl: "wood", depth: 0.6, flat: 0.5, variants: ["narrow", "roadside", "main"] } },
    { id: "velvetlane", name: "Velvet Lane Boutique", w: G(1, 0.6, 0.2), look: L("#d9c9d8", "#6a4a6a", "#5b3a7a", "#f0d070", "#e88aa0", 0), plan: { fl: "carpet", depth: 0.68, variants: ["twin", "counter", "strip"] } },
  ],
  vet: [
    { id: "countryvet", name: "Country Vet", w: G(0, 0.5, 1), look: L("#c9b28a", "#6b5434", "#3f6b3a", "#ffffff", "#e8e4d8", 2), plan: { back: "barn" } },
    { id: "animalhosp", name: "Animal Hospital", w: G(1, 0.7, 0.2), look: L("#d9d4c8", "#5d6168", "#3a6fb0", "#ffffff", "#e2412f", 1), plan: { storeys: [1, 2], wide: true } },
    { id: "pawsclinic", name: "Paws Animal Clinic", w: G(0.8, 1, 0.5), look: L("#e8e4d8", "#7d848c", "#2aa0a0", "#ffffff", "#e8c04a", 3) },
    { id: "valleyvet", name: "Valley Large Animal Vet", w: G(0, 0.3, 1), look: L("#8b6a48", "#4a3424", "#c8402f", "#ffffff", "#d8b47a", 0), plan: { back: "barn" } },
    { id: "companion", name: "Companion Care Vet", w: G(0.8, 1, 0.4), look: L("#b8d0c8", "#4a6a60", "#e88aa0", "#ffffff", "#3a6fb0", 2) },
  ],
  dealer: [
    { id: "calder", name: "Calder Motors", w: G(0.8, 1, 0.6), look: L("#e8e4d8", "#5d6168", "#1f4f9a", "#ffffff", "#c8402f", 3), plan: { wide: true, depth: 0.55, variants: ["franchise", "automall", "glass"] } },
    { id: "bargainbob", name: "Bargain Bob's Used Cars", w: G(0.3, 0.8, 1), look: L("#d8b47a", "#7a5230", "#e8c04a", "#c8402f", "#3a6fb0", 2), plan: { depth: 0.4, back: "lot", variants: ["usedlot", "rental", "superstore"] } },
    { id: "highline", name: "Highline Auto Mall", w: G(1, 0.8, 0), look: L("#2a2a2e", "#111114", "#c9ced3", "#111114", "#7fe6ff", 3), plan: { wide: true, depth: 0.6, storeys: [1, 2], variants: ["automall", "boutique", "glass"] } },
    { id: "truckcountry", name: "Truck Country", w: G(0, 0.6, 1), look: L("#7d848c", "#3c3a36", "#c8402f", "#ffffff", "#e8c04a", 1), plan: { depth: 0.45, back: "service", variants: ["truck", "country", "rv"] } },
    { id: "hometownauto", name: "Hometown Auto Sales", w: G(0.3, 0.8, 1), look: L("#b9a98a", "#6b5434", "#3f6b3a", "#ffffff", "#e8e4d8", 0), plan: { depth: 0.5, variants: ["franchise", "country", "bodyshop", "motorcycle"] } },
    { id: "prestige", name: "Prestige Imports", w: G(1, 0.6, 0), look: L("#c9ced3", "#3c3a36", "#1c2026", "#d9a520", "#d9a520", 3), plan: { wide: true, depth: 0.62, variants: ["boutique", "glass", "motorcycle"] } },
  ],
  restaurant: [
    { id: "burgerbarn", name: "Burger Barn", w: G(1, 1, 1), look: L("#c8402f", "#7a1c18", "#e8c04a", "#7a1c18", "#ffffff", 1), plan: { room: "Dining room", depth: 0.5, back: "fastfood" } },
    { id: "cluckshack", name: "Cluck Shack", w: G(1, 1, 0.8), look: L("#e8e4d8", "#c8402f", "#c8402f", "#ffffff", "#e8c04a", 2), plan: { room: "Order counter", depth: 0.45, back: "fastfood" } },
    { id: "tacorio", name: "Taco Rio", w: G(1, 0.9, 0.6), look: L("#e8a020", "#8a4b32", "#3f6b3a", "#ffffff", "#c8402f", 0), plan: { room: "Dining room", depth: 0.5, back: "fastfood" } },
    { id: "goldenwok", name: "Golden Wok", w: G(1, 0.8, 0.5), look: L("#c8402f", "#5a1410", "#d9a520", "#5a1410", "#d9a520", 1), plan: { room: "Dining room", depth: 0.58, back: "takeout" } },
    { id: "bigsky", name: "Big Sky Steakhouse", w: G(0.6, 1, 0.8), look: L("#5a3a20", "#2a1c10", "#e8e4d8", "#5a3a20", "#a2713f", 0), plan: { room: "Dining room", fl: "wood", depth: 0.65, back: "sitdown" } },
    { id: "smokypete", name: "Smoky Pete's BBQ", w: G(0.4, 0.7, 1), look: L("#7a5230", "#3a2414", "#2a2a2a", "#e8a020", "#c8402f", 2), plan: { room: "Dining room", fl: "wood", depth: 0.55, back: "smoker" } },
    { id: "beanthere", name: "Bean There Coffee", w: G(1, 0.9, 0.6), look: L("#3a2a20", "#1a120c", "#9cc46e", "#ffffff", "#d8b47a", 3), plan: { room: "Cafe", fl: "wood", depth: 0.6, back: "cafe" } },
    { id: "substation", name: "Sub Station", w: G(1, 1, 0.5), look: L("#3f6b3a", "#1c2a18", "#e8c04a", "#1c2a18", "#ffffff", 0), plan: { room: "Sandwich counter", depth: 0.5, back: "takeout" } },
    { id: "noodlehouse", name: "Noodle House", w: G(1, 0.5, 0.1), look: L("#e8e4d8", "#2a2a2a", "#c8402f", "#ffffff", "#2a2a2a", 3), plan: { room: "Noodle bar", fl: "tile", depth: 0.6, back: "takeout" } },
    { id: "sals", name: "Sal's Italian Kitchen", w: G(0.8, 0.8, 0.6), look: L("#d9c9a8", "#3f6b3a", "#c8402f", "#ffffff", "#3f6b3a", 1), plan: { room: "Dining room", fl: "wood", depth: 0.62, back: "sitdown", flat: 0.4 } },
  ],
  bank: [
    { id: "firstcalder", name: "First Calder Bank", w: G(1, 0.8, 0.6), look: L("#d9d4c8", "#7d786c", "#1f3550", "#e8e4d8", "#d9a520", 1), plan: { storeys: [1, 3], wide: true, variants: ["marble", "corner", "drivethru", "headquarters", "trust"] } },
    { id: "mercantile", name: "Mercantile Trust", w: G(1, 0.5, 0.1), look: L("#c9c2b0", "#5d6168", "#2a2a2e", "#d9a520", "#d9a520", 3), plan: { storeys: [2, 3], wide: true, variants: ["tower", "grand", "headquarters", "marble"] } },
    { id: "farmersmerch", name: "Farmers & Merchants Bank", w: G(0.1, 0.5, 1), look: L("#8e4f3c", "#d9d0b8", "#3f6b3a", "#e8e4d8", "#d9d0b8", 0), plan: { storeys: [1, 2], variants: ["farmers", "smalltown", "grand"] } },
    { id: "libertysl", name: "Liberty Savings & Loan", w: G(0.3, 0.8, 1), look: L("#e8e4d8", "#3a5f8e", "#c8402f", "#ffffff", "#3a5f8e", 2), plan: { storeys: [1, 1], variants: ["savings", "drivethru", "driveup"] } },
    { id: "granite", name: "Granite National Bank", w: G(1, 0.6, 0.2), look: L("#8a8780", "#4d4741", "#e8e4d8", "#2a2a2e", "#c9ced3", 3), plan: { storeys: [2, 3], variants: ["marble", "tower", "grand"] } },
    { id: "unioncu", name: "Union Credit Union", w: G(0.6, 1, 0.6), look: L("#b9a98a", "#5d6168", "#2aa0a0", "#ffffff", "#e8c04a", 2), plan: { storeys: [1, 1], variants: ["creditunion", "driveup", "savings", "corner"] } },
  ],
  bar: [
    { id: "rustynail", name: "The Rusty Nail", w: G(0.3, 0.6, 1), look: L("#7b5a44", "#3a2a20", "#2a2a2a", "#e2654f", "#c4562a", 0), plan: { room: "Barroom", fl: "wood", flat: 0.4 } },
    { id: "roadhouse61", name: "Roadhouse 61", w: G(0, 0.4, 1), look: L("#8b6a48", "#4a3424", "#c8402f", "#f0d070", "#e8c04a", 2), plan: { room: "Roadhouse", fl: "wood", wide: true, back: "stage" } },
    { id: "omalleys", name: "O'Malley's Pub", w: G(1, 0.7, 0.5), look: L("#2d4a3c", "#16241d", "#d9a520", "#16241d", "#d9a520", 1), plan: { room: "Pub", fl: "wood", flat: 0.6 } },
    { id: "velvetlounge", name: "The Velvet Lounge", w: G(1, 0.4, 0), look: L("#2a2a2e", "#111114", "#b06ae0", "#ffffff", "#e88aa0", 3), plan: { room: "Lounge", fl: "carpet", back: "stage" } },
    { id: "touchdown", name: "Touchdown Sports Bar", w: G(1, 1, 0.5), look: L("#3a5f8e", "#1f3550", "#e8c04a", "#1f3550", "#c8402f", 3), plan: { room: "Sports bar", fl: "tile", wide: true } },
    { id: "lastcall", name: "Last Call Tavern", w: G(0.6, 0.8, 0.9), look: L("#8e4f3c", "#4a2a20", "#e8e4d8", "#8e4f3c", "#3f6b3a", 0), plan: { room: "Tavern", fl: "wood" } },
    { id: "neonmoose", name: "Neon Moose Saloon", w: G(0, 0.3, 1), look: L("#a2713f", "#5a3a20", "#7fe6ff", "#5a3a20", "#e2412f", 2), plan: { room: "Saloon", fl: "wood", back: "stage" } },
  ],
  liquor: [
    { id: "spiritshoppe", name: "Spirit Shoppe", w: G(1, 1, 0.5), look: L("#5b3a7a", "#2a1c3a", "#e8c04a", "#2a1c3a", "#e88aa0", 1), plan: { variants: ["main", "corner", "wrap"] } },
    { id: "bottleking", name: "Bottle King", w: G(1, 0.9, 0.4), look: L("#c8402f", "#5a1410", "#e8c04a", "#5a1410", "#ffffff", 3), plan: { wide: true, variants: ["superstore", "outlet", "flagship"] } },
    { id: "package", name: "Package Liquors", w: G(0.2, 0.6, 1), look: L("#b9a98a", "#6b5434", "#c8402f", "#ffffff", "#3f6b3a", 2), plan: { variants: ["roadside", "strip", "counter"] } },
    { id: "cornercork", name: "Corner Cork Wine & Spirits", w: G(1, 0.6, 0.2), look: L("#7a3b32", "#3a1c18", "#e8e4d8", "#7a3b32", "#d9a520", 0), plan: { variants: ["narrow", "counter", "twofloor"] } },
    { id: "libertyliquor", name: "Liberty Liquor", w: G(0.6, 1, 0.8), look: L("#e8e4d8", "#3a5f8e", "#3a5f8e", "#ffffff", "#c8402f", 2), plan: { variants: ["main", "twin", "strip"] } },
    { id: "hopsbarley", name: "Hops & Barley", w: G(0.5, 0.6, 0.9), look: L("#a2713f", "#5a3a20", "#3f6b3a", "#f0d070", "#e8c04a", 0), plan: { variants: ["outlet", "roadside", "twin"] } },
  ],
  // ---------- the old kinds, as franchises (their own painters take the look, buildingmaps.js the plan) ----------
  grocery: [
    { id: "freshway", name: "FreshWay Market", w: G(1, 1, 0.5), look: L("#e8e4d8", "#3f6b3a", "#3f6b3a", "#ffffff", "#e8c04a", 3), plan: { depth: 0.68, wide: true, variants: ["dock", "corridor", "pharmacy"] } },
    { id: "valuebasket", name: "Value Basket", w: G(0.8, 1, 0.8), look: L("#d9c9a8", "#c8402f", "#c8402f", "#ffffff", "#e8c04a", 1), plan: { depth: 0.62, variants: ["neighbourhood", "bakery", "international", "twostorey"] } },
    { id: "hilltop", name: "Hilltop Grocers", w: G(0.3, 0.8, 1), look: L("#8e4f3c", "#4a2a20", "#2d4a3c", "#e8e4d8", "#9cc46e", 0), plan: { depth: 0.6, fl: "wood", variants: ["butcher", "florist", "country"] } },
    { id: "generalstore", name: "Mercer's General Store", w: G(0, 0.3, 1), look: L("#a2713f", "#5a3a20", "#e8e4d8", "#5a3a20", "#c8402f", 2), plan: { depth: 0.55, fl: "wood", flat: 0.6, variants: ["country", "coop", "butcher"] } },
    { id: "bodega", name: "Corner Bodega", w: G(1, 0.4, 0), look: L("#e8a020", "#8a4b32", "#2a2a2a", "#e8c04a", "#c8402f", 0), plan: { depth: 0.6, flat: 0.8, variants: ["international", "annex", "coop"] } },
    { id: "harvest", name: "Harvest Foods", w: G(0.8, 1, 0.6), look: L("#9cc46e", "#3f6b3a", "#e8a020", "#ffffff", "#3f6b3a", 3), plan: { depth: 0.66, variants: ["bakery", "florist", "pharmacy", "annex"] } },
  ],
  corner: [
    { id: "quikstop", name: "Quik Stop", w: G(1, 1, 0.6), look: L("#e8e4d8", "#c8402f", "#c8402f", "#ffffff", "#3a6fb0", 1), plan: { variants: ["classic", "twodoor", "cooler", "kiosk"] } },
    { id: "sevenstar", name: "Seven Star Mart", w: G(1, 0.8, 0.4), look: L("#3a6fb0", "#1f3550", "#e8a020", "#1f3550", "#c8402f", 3), plan: { variants: ["booth", "laundro", "sidestock"] } },
    { id: "pennymart", name: "Penny Mart", w: G(0.5, 0.8, 1), look: L("#b9a98a", "#6b5434", "#3f6b3a", "#ffffff", "#e8c04a", 0), plan: { variants: ["post", "general", "flat", "wrap"] } },
    { id: "nightowl", name: "Night Owl", w: G(1, 0.6, 0.3), look: L("#2a2a2e", "#111114", "#b06ae0", "#ffffff", "#e8c04a", 2), plan: { variants: ["booth", "bodega", "kiosk", "wrap"] } },
  ],
  gas: [
    { id: "petrostar", name: "PetroStar", w: G(1, 1, 0.6), look: L("#e8e4d8", "#c8402f", "#c8402f", "#ffffff", "#e8c04a", 1), plan: { variants: ["kiosk", "carwash", "deli", "plaza"] } },
    { id: "bluefalcon", name: "Blue Falcon Gas", w: G(0.8, 1, 0.8), look: L("#e8e4d8", "#1f4f9a", "#1f4f9a", "#ffffff", "#c9ced3", 2), plan: { variants: ["service", "tyres", "citycorner", "carwash"] } },
    { id: "greenleaf", name: "Greenleaf Fuel", w: G(0.6, 0.8, 1), look: L("#e8e4d8", "#3f6b3a", "#3f6b3a", "#ffffff", "#e8c04a", 0), plan: { variants: ["general", "bait", "filling", "towing"] } },
    { id: "sundown", name: "Sundown Gas & Go", w: G(0.3, 0.6, 1), look: L("#e8a020", "#8a4b32", "#2a2a2a", "#e8a020", "#c8402f", 3), plan: { variants: ["fuelstop", "plaza", "kiosk", "towing", "deli"] } },
  ],
  pizza: [
    { id: "tonys", name: "Tony's Pizzeria", w: G(1, 1, 0.8), look: L("#d9b98a", "#3f6b3a", "#c8402f", "#ffffff", "#3f6b3a", 0), plan: { room: "Dining room", depth: 0.55 } },
    { id: "pizzapalace", name: "Pizza Palace", w: G(1, 1, 0.6), look: L("#c8402f", "#5a1410", "#e8c04a", "#5a1410", "#ffffff", 1), plan: { room: "Dining room", depth: 0.6 } },
    { id: "sliceheaven", name: "Slice of Heaven", w: G(1, 0.7, 0.4), look: L("#e8e4d8", "#3a6fb0", "#3a6fb0", "#ffffff", "#e8c04a", 3), plan: { room: "Slice counter", depth: 0.45 } },
    { id: "brickoven", name: "Brick Oven Co.", w: G(0.8, 0.8, 0.5), look: L("#8e4f3c", "#4a2a20", "#2a2a2a", "#e8a020", "#c4562a", 2), plan: { room: "Dining room", fl: "wood", depth: 0.6 } },
    { id: "piehole", name: "The Pie Hole", w: G(0.4, 0.8, 1), look: L("#b9a98a", "#6b5434", "#e8a020", "#2a2a2a", "#c8402f", 0), plan: { room: "Counter", depth: 0.5 } },
  ],
  diner: [
    { id: "starlite", name: "Starlite Diner", w: G(1, 1, 0.8), look: L("#c9ced3", "#c8402f", "#c8402f", "#ffffff", "#7fe6ff", 3), plan: { room: "Dining room", fl: "tile", depth: 0.6 } },
    { id: "route9", name: "Route 9 Diner", w: G(0.3, 0.8, 1), look: L("#e8e4d8", "#3a6fb0", "#3a6fb0", "#ffffff", "#c8402f", 1), plan: { room: "Dining room", fl: "tile", depth: 0.55 } },
    { id: "lous", name: "Lou's Lunch Counter", w: G(0.6, 0.6, 1), look: L("#b9a98a", "#6b5434", "#2a2a2a", "#e8c04a", "#c8402f", 0), plan: { room: "Lunch counter", fl: "wood", depth: 0.5 } },
    { id: "silverspoon", name: "Silver Spoon Diner", w: G(0.8, 1, 0.6), look: L("#c9ced3", "#5d6168", "#2a2a2e", "#c9ced3", "#e88aa0", 2), plan: { room: "Dining room", fl: "tile", depth: 0.6 } },
    { id: "waffleshack", name: "Waffle Shack", w: G(0.5, 1, 1), look: L("#e8c04a", "#2a2a2a", "#2a2a2a", "#e8c04a", "#e8e4d8", 1), plan: { room: "Counter", fl: "tile", depth: 0.5 } },
  ],
  clinic: [
    { id: "urgentnow", name: "Urgent Care Now", w: G(1, 1, 0.3), look: L("#e8e4d8", "#5d6168", "#c8402f", "#ffffff", "#3a6fb0", 3), plan: { storeys: [1, 2] } },
    { id: "familymed", name: "Family Medical Center", w: G(0.8, 1, 0.8), look: L("#c9c2b0", "#5d6168", "#3a6fb0", "#ffffff", "#9cc46e", 1), plan: { storeys: [1, 3] } },
    { id: "drhale", name: "Dr. Hale's Office", w: G(0, 0.4, 1), look: L("#b9a98a", "#6b5434", "#2d4a3c", "#e8e4d8", "#d9a520", 0), plan: { storeys: [1, 1] } },
    { id: "medfirst", name: "MedFirst Walk-In", w: G(1, 0.8, 0.4), look: L("#d9d4c8", "#2aa0a0", "#2aa0a0", "#ffffff", "#e8e4d8", 2), plan: { storeys: [1, 2] } },
    { id: "valleyhealth", name: "Valley Health Clinic", w: G(0.3, 0.7, 1), look: L("#a7adb3", "#3f6b3a", "#3f6b3a", "#ffffff", "#e8e4d8", 0), plan: { storeys: [1, 2] } },
  ],
  motel: [
    { id: "sleepypines", name: "Sleepy Pines Motel", w: G(0.2, 0.6, 1), look: L("#8b6a48", "#3f6b3a", "#3f6b3a", "#f0e6c8", "#e8c04a", 2) },
    { id: "starlightinn", name: "Starlight Motor Inn", w: G(0.6, 1, 0.8), look: L("#e8e4d8", "#3a6fb0", "#3a6fb0", "#ffffff", "#e8c04a", 2) },
    { id: "budgetrest", name: "Budget Rest Inn", w: G(1, 1, 0.5), look: L("#d9c9a8", "#c8402f", "#c8402f", "#ffffff", "#e8e4d8", 1) },
    { id: "lakeside", name: "Lakeside Motel", w: G(0.2, 0.6, 1), look: L("#5d8aa8", "#2d4a5e", "#e8e4d8", "#2d4a5e", "#9cc46e", 0) },
    { id: "route9lodge", name: "Route 9 Motor Lodge", w: G(0.3, 0.8, 1), look: L("#a2713f", "#5a3a20", "#e8a020", "#5a3a20", "#c8402f", 3) },
  ],
  // Hotels (issue #29): plan.hotel the kind (hotellayout.js), w.scenic its weight in scenic land (hotels.js: the resorts).
  hotel: [
    { id: "willowcreek", name: "Willow Creek Inn", w: { city: 0, suburb: 0.4, town: 1, scenic: 0 }, look: L("#e8e4d8", "#3f6b3a", "#3f6b3a", "#f0e6c8", "#c8402f", 0, "#4a3424"), plan: { hotel: "inn", fl: "hardwood", variants: ["inn-country", "inn-bnb", "inn-seaside", "inn-vineyard", "inn-mainstreet", "inn-hotspring"] } },
    { id: "oldmill", name: "Old Mill Bed & Breakfast", w: { city: 0, suburb: 0.2, town: 0.9, scenic: 0 }, look: L("#a2713f", "#5a3a20", "#e8e0c8", "#5a3a20", "#3f6b3a", 2, "#5a3a20"), plan: { hotel: "inn", fl: "plank", variants: ["inn-coaching", "inn-boarding", "inn-mainstreet", "inn-vineyard", "inn-country", "inn-bnb"] } },
    { id: "interstate", name: "Interstate Inn & Suites", w: { city: 0.5, suburb: 1, town: 0.7, scenic: 0 }, look: L("#d9c9a8", "#1f4f9a", "#1f4f9a", "#ffffff", "#e8c04a", 2), plan: { hotel: "business", fl: "carpet", variants: ["biz-classic", "biz-airport", "biz-extended", "biz-budget", "biz-highway", "biz-medical"] } },
    { id: "meridian", name: "Meridian Business Hotel", w: { city: 1, suburb: 0.8, town: 0.3, scenic: 0 }, look: L("#a7adb3", "#3c3a36", "#2d4a5e", "#e8e4d8", "#9cc46e", 3), plan: { hotel: "business", fl: "carpet", variants: ["biz-classic", "biz-conference", "biz-allsuites", "biz-boutique", "biz-convention", "biz-campus", "biz-station"] } },
    { id: "pinecrest", name: "Pinecrest Lodge Resort", w: { city: 0, suburb: 0, town: 0.12, scenic: 1 }, look: L("#7a5230", "#4a3424", "#3f6b3a", "#f0e6c8", "#c9873c", 1, "#3f4a3a"), plan: { hotel: "resort", fl: "hardwood", variants: ["res-mountain", "res-ranch", "res-cabins", "res-wellness", "res-golf", "res-classic"] } },
    { id: "lakeshore", name: "Lakeshore Grand Resort", w: { city: 0, suburb: 0.08, town: 0.08, scenic: 0.8 }, look: L("#e8e4d8", "#2d4a5e", "#5d8aa8", "#ffffff", "#d9a520", 3, "#2d4a5e"), plan: { hotel: "resort", fl: "carpet", variants: ["res-classic", "res-beach", "res-spa", "res-golf", "res-family", "res-wedding", "res-cabins"] } },
    { id: "caldergrand", name: "Calder Grand Hotel", w: { city: 1, suburb: 0, town: 0, scenic: 0 }, look: L("#8e4f3c", "#4a2a20", "#3c3a36", "#e8c04a", "#d9a520", 1), plan: { hotel: "tower", fl: "carpet", variants: ["tow-classic", "tow-grand", "tow-deco", "tow-atrium", "tow-convention", "tow-core"] } },
    { id: "harborview", name: "Harbor View Tower", w: { city: 0.8, suburb: 0, town: 0, scenic: 0 }, look: L("#c9ced3", "#2d4a5e", "#1f4f9a", "#ffffff", "#5d8aa8", 3), plan: { hotel: "tower", fl: "carpet", variants: ["tow-classic", "tow-twin", "tow-podium", "tow-skylobby", "tow-mixed", "tow-core"] } },
    // Issue #38: a chain a kind more, so a dozen variants have chains to carry them (plan.variants: data-hotels.js).
    { id: "timberline", name: "Timberline Lodges", w: { city: 0, suburb: 0.1, town: 0.6, scenic: 0 }, look: L("#6b4a2e", "#3a2a1c", "#4a5a3a", "#e8dcc0", "#b8632e", 1, "#3a2a1c"), plan: { hotel: "inn", fl: "plank", variants: ["inn-chalet", "inn-lakeside", "inn-fishing", "inn-hunting", "inn-hotspring", "inn-country"] } },
    { id: "keystone", name: "Keystone Suites", w: { city: 0.4, suburb: 0.8, town: 0.5, scenic: 0 }, look: L("#c8c0b0", "#5a2a2a", "#7a2e2e", "#f4efe4", "#c9a64a", 2), plan: { hotel: "business", fl: "carpet", variants: ["biz-extended", "biz-allsuites", "biz-budget", "biz-highway", "biz-airport", "biz-medical", "biz-campus"] } },
    { id: "sundance", name: "Sundance Resorts & Casino", w: { city: 0, suburb: 0.05, town: 0.06, scenic: 0.6 }, look: L("#e6cfa0", "#8a4a20", "#c0702e", "#fff4dc", "#d94a2e", 3, "#8a4a20"), plan: { hotel: "resort", fl: "carpet", variants: ["res-casino", "res-waterpark", "res-family", "res-beach", "res-classic"] } },
    { id: "pinnacle", name: "Pinnacle Tower Hotels", w: { city: 0.7, suburb: 0, town: 0, scenic: 0 }, look: L("#9aa4ad", "#22303c", "#2f4a63", "#e8eef2", "#7fb0d0", 3), plan: { hotel: "tower", fl: "carpet", variants: ["tow-casino", "tow-capsule", "tow-twin", "tow-podium", "tow-atrium", "tow-mixed", "tow-skylobby", "tow-convention"] } },
  ],
  church: [
    { id: "firstbaptist", name: "First Baptist Church", w: G(0.6, 1, 1), look: L("#e8e4d8", "#5d6168", "#5d6168", "#ffffff", "#c8402f", 0) },
    { id: "stmarys", name: "St. Mary's Catholic Church", w: G(1, 0.8, 0.6), look: L("#8e4f3c", "#4a2a20", "#3c3a36", "#e8e4d8", "#d9a520", 1) },
    { id: "gracemethodist", name: "Grace Methodist Church", w: G(0.6, 1, 0.8), look: L("#c9c2b0", "#7d786c", "#3a6fb0", "#ffffff", "#e8e4d8", 0) },
    { id: "calvary", name: "Calvary Chapel", w: G(0.4, 0.8, 1), look: L("#d9c9a8", "#6b5434", "#2d4a3c", "#ffffff", "#e8c04a", 2) },
    { id: "holytrinity", name: "Holy Trinity Lutheran", w: G(0.8, 0.8, 0.8), look: L("#a7adb3", "#4d4741", "#5b3a7a", "#ffffff", "#d9a520", 3) },
  ],
  autoshop: [
    { id: "quicklube", name: "Quick Lube Express", w: G(1, 1, 0.6), look: L("#e8e4d8", "#c8402f", "#e8c04a", "#c8402f", "#3a6fb0", 3), plan: { depth: 0.4, variants: ["drivethru", "wash", "small"] } },
    { id: "hanks", name: "Hank's Garage & Tow", w: G(0.3, 0.8, 1), look: L("#7b5a44", "#3a2a20", "#2a2a2a", "#e8a020", "#c8402f", 0), plan: { variants: ["tow", "flat", "standard"] } },
    { id: "precision", name: "Precision Auto Repair", w: G(1, 1, 0.6), look: L("#c9ced3", "#1f4f9a", "#1f4f9a", "#ffffff", "#e8e4d8", 1), plan: { variants: ["standard", "engine", "counter", "fleet"] } },
    { id: "tiretown", name: "Tire Town", w: G(0.8, 1, 0.8), look: L("#2a2a2e", "#111114", "#e8c04a", "#111114", "#c8402f", 2), plan: { variants: ["tyres", "heavy", "counter"] } },
    { id: "mainmuffler", name: "Main Street Muffler", w: G(0.6, 0.8, 1), look: L("#b9a98a", "#5d6168", "#c8402f", "#ffffff", "#e8c04a", 1), plan: { variants: ["small", "paint", "engine"] } },
  ],
  firestation: [
    { id: "engine7", name: "Engine Company 7", w: G(1, 0.6, 0.1), look: L("#8e4f3c", "#4a2a20", "#c8402f", "#ffffff", "#e8c04a", 1) },
    { id: "countyfire", name: "County Fire Station 3", w: G(0.4, 1, 0.8), look: L("#c9c2b0", "#5d6168", "#c8402f", "#ffffff", "#e8e4d8", 0) },
    { id: "volunteer", name: "Volunteer Fire Company", w: G(0, 0.5, 1), look: L("#e8e4d8", "#c8402f", "#c8402f", "#ffffff", "#3c3a36", 2) },
  ],
  police: [
    { id: "precinct", name: "Police Precinct", w: G(1, 0.6, 0), look: L("#8a8780", "#4d4741", "#1f3550", "#ffffff", "#3a6fb0", 1) },
    { id: "sheriff", name: "Sheriff's Substation", w: G(0.1, 0.8, 1), look: L("#b9a98a", "#6b5434", "#5a3a20", "#e8c04a", "#e8c04a", 0) },
    { id: "statepatrol", name: "State Patrol Post", w: G(0.2, 0.6, 0.8), look: L("#c9c2b0", "#5d6168", "#2d4a3c", "#ffffff", "#d9a520", 2) },
  ],
  gunstore: [
    { id: "bigiron", name: "Big Iron Guns", w: G(0.6, 1, 1), look: L("#5e4a3e", "#3a2a20", "#e8a020", "#1f1c1a", "#c8402f", 0), plan: { variants: ["main", "corner", "narrow", "wrap"] } },
    { id: "patriot", name: "Patriot Firearms", w: G(0.8, 1, 0.8), look: L("#e8e4d8", "#1f3550", "#c8402f", "#ffffff", "#1f3550", 1), plan: { variants: ["strip", "twofloor", "twin", "counter"] } },
    { id: "tactical", name: "Tactical Supply Co.", w: G(1, 0.8, 0.4), look: L("#3d4a3c", "#232b23", "#2a2a2a", "#9cc46e", "#7d848c", 3), plan: { variants: ["superstore", "flagship", "outlet"] } },
    { id: "huntersrest", name: "Hunter's Rest Gun Shop", w: G(0, 0.5, 1), look: L("#7a5230", "#4a3424", "#5f7a3e", "#f0d070", "#e8a020", 2), plan: { variants: ["roadside", "counter", "outlet"] } },
  ],
  pawnshop: [
    { id: "quickcash", name: "Quick Cash Pawn", w: G(1, 0.8, 0.6), look: L("#8e4f3c", "#3c3a36", "#e8c04a", "#1c2026", "#d9a520", 0), plan: { variants: ["main", "strip", "narrow", "wrap"] } },
    { id: "goldgun", name: "Gold & Gun Exchange", w: G(0.6, 1, 1), look: L("#5e4a3e", "#2a1c10", "#2a2a2a", "#e8c04a", "#d9a520", 1), plan: { variants: ["flagship", "counter", "twin"] } },
    { id: "silverdollar", name: "Silver Dollar Pawn", w: G(0.6, 0.8, 1), look: L("#b9a98a", "#5d6168", "#c9ced3", "#1c2026", "#c9ced3", 2), plan: { variants: ["roadside", "outlet", "corner"] } },
    { id: "mainloan", name: "Main Street Loan", w: G(1, 0.6, 0.6), look: L("#3a5f8e", "#1f3550", "#e8e4d8", "#1f3550", "#e8c04a", 3), plan: { variants: ["twofloor", "superstore", "corner"] } },
  ],
  hardware: [
    { id: "handyhank", name: "Handy Hank's Hardware", w: G(0.6, 1, 1), look: L("#c8402f", "#5a1410", "#e8e4d8", "#c8402f", "#e8a020", 0), plan: { variants: ["main", "corner", "narrow"] } },
    { id: "builders", name: "Builders Supply Co.", w: G(1, 1, 0.6), look: L("#e8a020", "#8a4b32", "#2a2a2a", "#e8a020", "#7d848c", 3), plan: { depth: 0.66, wide: true, variants: ["superstore", "flagship", "twin"] } },
    { id: "nailbolt", name: "Nail & Bolt Hardware", w: G(0.8, 0.8, 0.8), look: L("#3a6fb0", "#1f3550", "#e8c04a", "#1f3550", "#c9ced3", 1), plan: { variants: ["strip", "wrap", "counter", "twofloor"] } },
    { id: "lumberbarn", name: "Lumber Barn", w: G(0.2, 0.8, 1), look: L("#a2713f", "#5a3a20", "#3f6b3a", "#f0d070", "#c9a46a", 2), plan: { back: "yard", variants: ["outlet", "roadside"] } },
    { id: "fixit", name: "Fix-It Depot", w: G(1, 1, 0.5), look: L("#e8e4d8", "#3f6b3a", "#3f6b3a", "#ffffff", "#e8a020", 3), plan: { depth: 0.66, wide: true, variants: ["superstore", "twin", "flagship"] } },
  ],
  // the office buildings' firms (data-offices.js); the tower's are the site type "office"'s (the crawl's "offices" reads
  // them: shops.js franchisesOf)
  ...OFFICE_FIRMS,
  // issue #55's six shops' chains and local names (data-newshops.js)
  ...NEWSHOP_FRANCHISES,
};
// Restaurants by kind of food, format and size (issue #33, data-eateries.js VARIANTS): every food kind's franchise has
// its cuisine, format and size (eat); the variants new with it join the lists, with their own look and plan.
for (const v of VARIANTS) {
  const list = FRANCHISES[v.kind], eat = { cuisine: v.cuisine, format: v.format, size: v.size, ...(v.brew ? { brew: true } : {}), ...(v.plan && v.plan.truck ? { truck: true } : {}) };
  const have = list.find((f) => f.id === v.id);
  if (have) { have.eat = eat; continue; }
  list.push({ id: v.id, name: v.name, w: v.w, look: v.look, plan: { ...(v.plan || {}) }, eat });
}

// ---------- the new kinds' rows in the find tables ----------
const P = (p, items) => ({ p, items });
export const ROWS = {
  // loot.js: small finds a search hour and a raid container
  SITE_FINDS: {
    sportshop: P(0.12, { lipbalm: 2, deodorant: 2, chocolate: 2, batteries: 2, lighters: 1, puritabs: 1, handwarmer: 2, gamecall: 0.5 }),
    electronics: P(0.2, { phone: 3, laptop: 2, camera: 2, console: 2, batteries: 3, pocketradio: 1.5, alarmclock: 1.5, vinyl: 0.5, solderiron: 1 }), // solderiron: the electronics recipes' iron (data-tools.js, 2026-10-24): the repair counter
    radioshop: P(0.16, { batteries: 4, pocketradio: 2, alarmclock: 1, phone: 1, lighters: 0.5, solderiron: 2 }),
    bookstore: P(0.06, { tcards: 1, cards: 2, candles: 1, instcoffee: 1, tea: 1 }),
    library: P(0.05, { instcoffee: 2, photos: 1, stamps: 1, phone: 1, laptop: 0.5 }),
    petstore: P(0.06, { soap: 1, wetwipes: 1, batteries: 1 }),
    garden: P(0.08, { candles: 1, lighters: 1, honey: 1, batteries: 1, tripwire: 0.5 }),
    clothing: P(0.14, { watch: 1.5, perfume: 2, makeup: 2, deodorant: 2, goldchain: 0.5, shampoo: 1 }),
    vet: P(0.05, { soap: 1, wetwipes: 1, puritabs: 1 }),
    dealer: P(0.08, { lighters: 1, batteries: 1, instcoffee: 1, cigarettes: 1 }),
    restaurant: P(0.08, { instcoffee: 1, coffee: 1, tea: 1, candy: 1, wine: 0.5, lighters: 0.5 }),
    bank: P(0.08, { coins: 2, watch: 1, stamps: 1, goldring: 0.5 }),
    bar: P(0.18, { vodka: 2, whiskey: 2, scotch: 1, wine: 1, cigarettes: 2, cigars: 0.5, smokes: 1, cards: 1, lighters: 1 }),
    liquor: P(0.24, { vodka: 3, whiskey: 3, scotch: 1.5, wine: 3, cigarettes: 2, cigars: 1, smokes: 1.5, lighters: 1, candy: 0.5 }),
    hotel: P(0.16, { soap: 2, shampoo: 2, toothpaste: 1, phone: 1, watch: 0.5, perfume: 0.5, chocolate: 1, vodka: 0.5, lighters: 0.5 }),
  },
  AREA_FINDS: {
    sportshop: P(0.1, { lipbalm: 1, deodorant: 1, chocolate: 1, handwarmer: 2, batteries: 1 }),
    electronics: P(0.18, { phone: 3, laptop: 2, camera: 2, console: 2, batteries: 3, pocketradio: 1, alarmclock: 1, solderiron: 1 }),
    radioshop: P(0.14, { batteries: 4, pocketradio: 2, alarmclock: 1, solderiron: 2 }),
    books: P(0.05, { cards: 1, tcards: 0.5, candles: 0.5 }),
    petstore: P(0.05, { soap: 1, wetwipes: 1 }),
    garden: P(0.06, { candles: 1, lighters: 1, tripwire: 0.5 }),
    clothes: P(0.12, { watch: 1, perfume: 2, makeup: 2, deodorant: 1.5, goldchain: 0.3 }),
    vet: P(0.04, { soap: 1, wetwipes: 1 }),
    dealer: P(0.06, { lighters: 1, cigarettes: 1, instcoffee: 1 }),
    bankvault: P(0.45, { goldring: 3, goldchain: 2, watch: 2, coins: 3, diamond: 0.8, pearls: 1, stamps: 1, silverware: 1 }),
    bar: P(0.2, { vodka: 2, whiskey: 2, scotch: 1, wine: 1, cigarettes: 2, cigars: 0.5, cards: 1, lighters: 1 }),
    liquor: P(0.24, { vodka: 3, whiskey: 3, scotch: 1.5, wine: 3, cigarettes: 1.5, cigars: 0.8, lighters: 1 }),
    hotelroom: P(0.12, { phone: 1, watch: 0.3, lighters: 1, cigarettes: 1, deodorant: 1, perfume: 0.5, makeup: 0.5 }),
    luggage: P(0.18, { phone: 1, camera: 0.5, watch: 0.4, perfume: 1, makeup: 1, deodorant: 1, toothpaste: 1 }),
    hotelhk: P(0.4, { soap: 3, shampoo: 3, toothpaste: 2, deodorant: 1, wetwipes: 1 }),
    hotelfront: P(0.1, { lighters: 1, phone: 0.5, stamps: 0.5 }),
  },
  // loot.js: lamps, carts, the hunter's kit, building materials, wood, arrows
  LIGHT_FINDS: { sportshop: P(0.05, { headlamp: 2, lantern: 1.5, windlight: 1 }), radioshop: P(0.05, { windlight: 2, headlamp: 1, spotlight: 0.5 }), electronics: P(0.04, { windlight: 2 }), garden: P(0.04, { lantern: 2, windlight: 1 }) },
  CART_FINDS: { garden: P(0.08, { wheelbarrow: 3, handcart: 1.5 }) },
  HUNT_FINDS: { sportshop: P(0.08, { fishrod: 2, fishnet: 1, snarewire: 1 }) },
  BUILDMAT_FINDS: { garden: [0.25, 1, 3], dealer: [0.06, 1, 2] },
  SITE_WOOD: { garden: [0.35, 30, 120] },
  AREA_WOOD: { garden: [0.25, 30, 90] },
  SITE_ARROWS: { sportshop: [0.25, 6, 18] },
  AREA_ARROWS: { sportshop: [0.12, 4, 12] },
  // data-survival.js: survival gear
  SURV_FINDS: {
    sportshop: P(0.08, { solarlantern: 2, rangefinder: 1, anglelight: 1, leatherjacket: 0.5 }),
    garden: P(0.05, { solarlantern: 2, pipewrench: 1 }),
    clothing: P(0.1, { leatherjacket: 3, motopants: 2 }),
    dealer: P(0.05, { pipewrench: 2, leatherjacket: 1, motopants: 0.6 }),
    vet: P(0.03, { jumpbag: 1 }),
  },
  AREA_SURV: {
    sportshop: P(0.06, { solarlantern: 2, rangefinder: 0.8, anglelight: 0.8 }),
    garden: P(0.04, { solarlantern: 2, pipewrench: 1 }),
    clothes: P(0.08, { leatherjacket: 3, motopants: 2 }),
    dealer: P(0.04, { pipewrench: 2, leatherjacket: 0.6 }),
  },
  // carrykit.js: rigs and magazines
  SITE_KIT: { sportshop: P(0.04, { makeshiftrig: 1, mag_22_10: 1.5 }) },
  AREA_KIT: { sportshop: P(0.03, { makeshiftrig: 1, mag_22_10: 1 }) },
  // blades.js
  BLADE_FINDS: { sportshop: P(0.08, { huntknife: 2, survivalknife: 2, multitool: 1.5, pocketknife: 1.5, lockback: 1 }), garden: P(0.04, { boxcutter: 2, pocketknife: 1, multitool: 1 }), clothing: P(0.02, { pocketknife: 1 }), bar: P(0.03, { pocketknife: 1, flipknife: 1 }) },
  AREA_BLADES: { sportshop: P(0.06, { huntknife: 1.5, survivalknife: 1.5, multitool: 1, pocketknife: 1 }), garden: P(0.03, { boxcutter: 2, pocketknife: 1 }), bar: P(0.03, { pocketknife: 1, flipknife: 1 }) },
  // helmets.js: hard hats and ear protection
  HEAD_FINDS: { garden: P(0.03, { hardhat: 1, earmuffs: 1 }), radioshop: P(0.03, { earmuffs: 1 }) },
  AREA_HEAD: { garden: P(0.02, { hardhat: 1 }) },
  // skills.js: books
  BOOK_SITES: {
    bookstore: { p: 0.35, books: ["novel", "comic", "magazines", "puzzlebook", "cookbook", "gardenbook", "diybook", "survivalbook", "bushcraftbook", "talkbook", "medbook", "enginebook", "leadbook", "chefbook", "gamebook", "forgebook", "lockbook"] },
    library: { p: 0.4, books: ["novel", "comic", "magazines", "gardenbook", "talkbook", "medbook", "enginebook", "leadbook", "diybook", "cookbook", "survivalbook", "bushcraftbook", "forgebook", "surgerybook", "scavbook", "gamebook"] },
    sportshop: { p: 0.05, books: ["survivalbook", "bushcraftbook", "gamebook", "magazines"] },
    garden: { p: 0.06, books: ["gardenbook", "diybook"] },
    vet: { p: 0.05, books: ["medbook", "gardenbook"] },
    radioshop: { p: 0.04, books: ["enginebook", "diybook"] },
    electronics: { p: 0.03, books: ["enginebook", "magazines"] },
  },
  // data-tents.js: tent bags
  TENT_FINDS: { sportshop: P(0.06, { tent1: 3, tent2: 2.5, tent4: 1 }), garden: P(0.01, { tent2: 1 }) },
  AREA_TENTS: { sportshop: P(0.08, { tent1: 3, tent2: 2, tent4: 0.8 }) },
  // data-boxes.js: lockable boxes
  BOX_SITE: { bank: P(0.08, { cashbox: 3, firebox: 1 }), liquor: P(0.05, { cashbox: 3 }), bar: P(0.04, { cashbox: 3 }), dealer: P(0.04, { cashbox: 1, toolbox: 2 }), pawnshop: P(0.04, { cashbox: 2, gearcase: 1 }) },
  BOX_AREA: { bankvault: P(0.2, { cashbox: 3, firebox: 1.5 }), bar: P(0.03, { cashbox: 2 }), liquor: P(0.04, { cashbox: 2 }), dealer: P(0.03, { toolbox: 2, cashbox: 1 }) },
  // gunsafes.js: a drill on the shelves (site), the cases (area)
  SEARCH_TOOLS: { dealer: { powerdrill: 0.03, anglegrinder: 0.015 }, garden: { powerdrill: 0.01 } },
  GUN_FINDS: { sportshop: { riflecase: 0.02, pistolcase: 0.01 }, dealer: { powerdrill: 0.02 } },
  // data-guns.js / data-gunmods.js: the extra gun and the parts catalogue
  ARSENAL_SITE: { sportshop: 0.015, bar: 0.006, liquor: 0.006, bank: 0.004 },
  ARSENAL_AREA: { sportshop: 0.015, bar: 0.006, liquor: 0.006, bankvault: 0.01 },
  PART_SITE: { sportshop: 0.012 },
  PART_AREA: { sportshop: 0.01 },
  // loot.js PARTS_MIX: parts by kind
  PARTS_MIX: { electronics: { electronics: 0.85 }, radioshop: { electronics: 0.8 }, dealer: { carparts: 0.75 } },
  // foods.js: the food a place holds (its mix) and how much its shelves held (shop food)
  SITE_MIX: { hotel: "diner", sportshop: "travel", electronics: "shop", radioshop: "shop", bookstore: "house", library: "house", petstore: "shop", garden: "farm", clothing: "shop",
    vet: "house", dealer: "house", restaurant: "diner", bank: "house", bar: "diner", liquor: "shop" },
  AREA_MIX: { sportshop: "travel", petstore: "shop", garden: "farm", bar: "diner", liquor: "shop", vet: "house", dealer: "house" },
  SHOP_FOOD: { sportshop: 40, petstore: 60, restaurant: 70, bar: 50, liquor: 40, garden: 30 },
  // itemcond.js: the condition finds come in
  SITE_SOURCE: { hotel: "home", sportshop: "shop", electronics: "shop", radioshop: "shop", bookstore: "shop", library: "home", petstore: "shop", garden: "shop", clothing: "shop",
    vet: "shop", dealer: "shop", restaurant: "shop", bank: "home", bar: "home", liquor: "shop" },
  AREA_SOURCE: { hotelroom: "home", luggage: "home", hotelhk: "shop", hotelfront: "home", sportshop: "shop", electronics: "shop", radioshop: "shop", books: "shop", petstore: "shop", garden: "shop", clothes: "shop", vet: "shop", dealer: "shop", bankvault: "home", bar: "home", liquor: "shop" },
  // locks.js: locked containers by area [box kinds, lock kind, chance]; a locked room at a site; a search hour's locked find
  LOCK_RULES: { bankvault: [["locker", "cabinet", "deposit"], "safe", 0.75], liquor: [["counter", "checkout"], "lockbox", 0.3], bar: [["counter", "cabinet", "checkout"], "lockbox", 0.2], electronics: [["counter", "displaycase"], "lockbox", 0.25], vet: [["cabinet"], "drugs", 0.3], radioshop: [["cabinet"], "lockbox", 0.2] }, // deposit, checkout, displaycase: the pieces buildingmaps.js lays since issue #16 (shoplayout.js)
  LOCK_ROOM: { bank: 0.7, vet: 0.3, electronics: 0.2, dealer: 0.2, liquor: 0.2 },
  SEARCH_LOCK: { bank: 0.3, vet: 0.15 },
  SEARCH_KIND: { bank: "safe", vet: "drugs" },
};

// The office buildings' rows (data-offices.js), each table's own rows first.
for (const [t, rows] of Object.entries(OFFICE_ROWS)) ROWS[t] = { ...rows, ...(ROWS[t] || {}) };
// Issue #55's six shops' rows (data-newshops.js), the same way.
for (const [t, rows] of Object.entries(NEWSHOP_ROWS)) ROWS[t] = { ...rows, ...(ROWS[t] || {}) };

/** Merges rows into a table, never over a row it has (a module's own rows win). @param {Record<string, any>} into @param {Record<string, any>} [rows] */
export function mergeRows(into, rows) {
  for (const [k, v] of Object.entries(rows || {})) if (!(k in into)) into[k] = v;
  return into;
}
