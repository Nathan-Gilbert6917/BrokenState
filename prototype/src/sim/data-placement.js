// @ts-check
// Where buildings stand: the placement table by setting (issue #42, the user's request 2026-10-26: "Stadiums, zoos
// hospitals should show in and near City centers. Towns can have some large building types and some small buildings and
// rural areas have smaller buildings").
//
// Every BUILDINGS key (buildingmaps.js), every site type (buildingmaps.js SITES) and every POI kind (pois.js POI_KINDS)
// has a row: the tile classes it stands on (placement.js tileClass), its weight on each, and the size class its variant
// takes there. A class the row does not name: it never stands there (weight 0, no size).
//
// THE TILE CLASSES (placement.js tileClass, in this order: the first that fits):
//   centre   the heart of a city (its own tile, state.cityIds) and the tiles next to it (CENTRE_R)
//   city     any other city block (city terrain) or a city's urban site
//   suburb   a suburb tile in a city's footprint (shops.js settingOf "suburb")
//   town     a town's own tile and its suburb ring (shops.js settingOf "town"), a town's sites
//   highway  a road tile out in the open
//   coast    land by water (a river, a lake, the sea) and water itself
//   scenic   forest, hills and mountains
//   rural    the rest: farmland and open country
//
// THE WEIGHT: how often the kind turns up on that class against how often it did before this table (1 = as before, 2 =
// twice as often, 0.2 = a fifth; 0 or no entry = never). A new world's POI lists and crawl blocks multiply their own
// weights by it (pois.js generatePois, citycrawl.js genBlock; placement.js placeExtra adds the big and the country kinds).
//
// THE SIZE CLASS: small | medium | large | huge, the size of the variant a building of the kind takes there (the variant
// picker's ctx.size, variantpick.js #41: a city centre's regional medical centre, a town's county hospital). By floor
// area (placement.js sizeClassOf): small under 400 m², medium under 2,000 m², large under 10,000 m², huge above.
//
// A ROW is a string, one entry a class: "<class> <weight> <S|M|L|H>", separated by commas; or "of <row>" for a building
// that only stands as part of a site (a barracks: the military base's), the site's row; or a profile below by name.
import { CENTRE_R } from "./settings.js";
/** @typedef {"centre" | "city" | "suburb" | "town" | "highway" | "coast" | "scenic" | "rural"} TileClass */
/** @typedef {"small" | "medium" | "large" | "huge"} SizeClass */

/** @type {TileClass[]} */
export const TILE_CLASSES = ["centre", "city", "suburb", "town", "highway", "coast", "scenic", "rural"];
/** @type {SizeClass[]} */
export const SIZE_CLASSES = ["small", "medium", "large", "huge"];
// Floor area (m², all storeys) where each size class ends: small < 400, medium < 2,000, large < 10,000, huge beyond.
export const SIZE_AREA = [400, 2000, 10000];
// The kinds that belong in and next to a city centre (the user's "Stadiums, zoos hospitals"; wave 2 adds its own:
// stadiums, zoos, museums, amusement parks, convention hotels). Their huge variants stand within BIG_R of a heart.
export const BIG_KINDS = ["hospital", "mall", "regionalmall", "univ", "campus", "stadium", "zoo", "museum", "amusement", "convention"];
export const PLACE = {
  CENTRE_R, // a city's heart and the ring next to it are its centre (settings.js settingAt's rule)
  BIG_R: 2,    // a huge building stands within this many tiles of a city's heart (placementtest.js)
};

// Profiles: the rows many kinds share.
const PROFILES = {
  // Downtown shops and services: most in a city, some in the suburbs, a few in a town.
  downtown: "centre 1.6 M, city 1.5 M, suburb 1 M, town 0.5 S",
  // Main-street shops: everywhere people live, a town's most of all; now and then on a road out in the country.
  mainstreet: "centre 0.8 S, city 1 S, suburb 1 M, town 1.4 S, highway 0.3 S, rural 0.1 S",
  // The suburbs' big lots: garden centres, dealers, hardware.
  bigLot: "city 0.4 M, suburb 1.8 M, town 1 M, highway 0.5 M, rural 0.1 S",
  // Offices.
  office: "centre 2 L, city 1.6 L, suburb 0.8 M, town 0.4 M",
  // A place by the road: gas, diners, motels.
  roadside: "centre 0.3 S, city 0.6 S, suburb 1 S, town 1.2 S, highway 2 M, coast 0.3 S, scenic 0.2 S, rural 0.4 S",
  // Homes.
  home: "city 0.2 S, suburb 2 M, town 2 M, highway 0.3 S, coast 0.6 M, scenic 0.4 S, rural 0.6 S",
  // Farms and their buildings.
  farm: "town 0.2 M, highway 0.8 M, coast 0.6 M, scenic 0.5 M, rural 2 M",
  // The wilds: cabins, blinds, camps.
  wild: "highway 0.2 S, coast 1 S, scenic 2 S, rural 0.4 S",
  // A secret place anywhere out of the way (a prepper's bunker).
  hideout: "town 0.1 S, highway 0.3 S, coast 0.6 S, scenic 1.4 S, rural 1 S",
};

/** @type {Record<string, string>} */
export const PLACEMENT_ROWS = {
  // ---- homes ----
  house: "home",
  neighbourhood: "city 0.3 M, suburb 2 M, town 1.6 M, highway 0.2 M",
  apartments: "centre 3 L, city 3 L, suburb 1.4 M, town 0.4 M",
  farmhouse: "farm",
  cabin: "wild",
  lodge: "highway 0.4 M, coast 1.2 M, scenic 1.5 M, rural 0.3 M",
  ranger: "coast 0.6 S, scenic 1.5 S, rural 0.2 S",
  garage: "city 0.6 S, suburb 1.5 S, town 1.5 S, highway 0.4 S, rural 0.3 S",
  shed: "town 0.3 S, highway 0.5 S, coast 0.6 S, scenic 0.8 S, rural 1.5 S",
  mineshack: "scenic 1 S",
  blind: "coast 0.6 S, scenic 1.5 S, rural 0.4 S",
  hikercamp: "coast 0.4 S, scenic 1.5 S",
  campsite: "town 0.2 S, highway 0.4 S, coast 1.2 S, scenic 1.4 S, rural 0.6 S",
  campground: "coast 1.4 M, scenic 1.4 M, rural 0.4 M",
  // ---- food ----
  grocery: "centre 1 M, city 1.2 M, suburb 1.2 M, town 1.4 M, highway 0.2 S, rural 0.1 S",
  corner: "centre 1 S, city 1.2 S, suburb 1.2 S, town 1.2 S, highway 0.4 S, rural 0.2 S",
  supermarket: "centre 0.6 L, city 1 L, suburb 1.6 L, town 0.8 L, highway 0.3 L",
  deptstore: "centre 1.6 L, city 1.4 L, suburb 1 L, town 0.3 L",
  farmstand: "town 0.2 S, highway 1 S, coast 0.4 S, scenic 0.3 S, rural 1.6 S",
  diner: "roadside",
  pizza: "centre 1 S, city 1.2 S, suburb 1.2 S, town 1.2 S, highway 0.3 S",
  restaurant: "downtown",
  bar: "centre 1.4 S, city 1.4 S, suburb 1 S, town 1.2 S, highway 0.4 S, rural 0.1 S",
  // ---- shops ----
  pharmacy: "centre 1.2 M, city 1.4 M, suburb 1.2 M, town 1 S, highway 0.2 S, rural 0.15 S",
  gunstore: "mainstreet",
  pawnshop: "mainstreet",
  hardware: "bigLot",
  feedstore: "suburb 0.2 M, town 1.4 M, highway 1 M, coast 0.3 S, scenic 0.3 S, rural 1.2 S",
  sportshop: "centre 0.8 M, city 1 M, suburb 1.4 M, town 1 S",
  electronics: "downtown",
  radioshop: "mainstreet",
  bookstore: "centre 1.4 S, city 1.2 S, suburb 1 S, town 1 S",
  library: "centre 1.4 L, city 1.2 M, suburb 1 M, town 1 S, rural 0.1 S",
  museum: "centre 2 H, city 1 L, suburb 0.5 M, town 1 S, highway 0.3 M, coast 0.3 M, rural 0.1 S", // #58: a city centre's natural history or art museum, a town's local history museum
  petstore: "city 0.6 S, suburb 1.6 M, town 1 S",
  garden: "bigLot",
  clothing: "downtown",
  liquor: "mainstreet",
  vet: "city 0.4 S, suburb 1.2 M, town 1.4 S, highway 0.3 S, rural 0.3 S",
  dealer: "bigLot",
  bank: "downtown",
  gasstation: "roadside",
  gas: "roadside",
  truckstop: "highway 2 M, rural 0.3 M, town 0.2 M",
  autoshop: "centre 0.4 S, city 1 M, suburb 1.4 M, town 1.4 S, highway 0.6 S, rural 0.2 S",
  motel: "roadside",
  hotel: "centre 2 H, city 1.6 L, suburb 1 M, town 0.8 S, highway 0.3 S, coast 0.3 M, scenic 0.2 M", // a convention hotel downtown, a town's inn
  // Issue #55's six shops (data-newshops.js; a new world's only): the size class picks among each kind's plans (S a
  // mattress store, a village bakery; M a family furniture store, an attended laundromat; L a big-box showroom, a thrift
  // superstore). The country's bakeries and butchers stand on placement.js PLACE_EXTRA's dice.
  furnstore: "centre 0.4 M, city 0.8 M, suburb 1.6 L, town 1 M, highway 0.6 L, rural 0.1 S",
  laundromat: "centre 1 S, city 1.4 M, suburb 1 M, town 1 S, highway 0.2 S",
  thrift: "centre 0.6 S, city 1 M, suburb 1.2 L, town 1.2 M, highway 0.4 L, rural 0.2 S",
  bakery: "centre 1.2 S, city 1.2 M, suburb 1 M, town 1.4 S, highway 0.3 S, coast 0.2 S, scenic 0.1 S, rural 0.5 S",
  butcher: "centre 0.6 S, city 0.8 M, suburb 0.8 M, town 1.4 S, highway 0.3 S, rural 0.6 S",
  deli: "centre 1.6 S, city 1.4 M, suburb 0.8 S, town 0.8 S, highway 0.2 S",
  // ---- malls ----
  mall: "centre 0.6 H, city 1 H, suburb 1.4 L", // a regional mall: a city's own site
  regionalmall: "of mall",
  stripmall: "suburb 1 M, town 1.4 M, highway 0.3 M",
  outlet: "suburb 0.6 L, highway 1.6 L, rural 0.3 L",
  cinema: "of mall", arcade: "of mall", mallservices: "of mall", mallrestrooms: "of mall", vacantunit: "of mall",
  // ---- civic and medical ----
  clinic: "centre 0.8 M, city 1 M, suburb 1.2 M, town 1.4 S, highway 0.2 S, scenic 0.2 S, rural 0.5 S", // a rural clinic among the farms
  hospital: "centre 3 H, city 2 H, suburb 0.8 L, town 0.15 L", // a city centre's medical centre, the suburbs' community hospital, a county hospital in a town
  infirmary: "of prison",
  police: "centre 2 L, city 1.6 M, suburb 1 M, town 1 S",
  firestation: "centre 1 M, city 1.2 M, suburb 1 M, town 1 S, rural 0.1 S",
  school: "centre 0.6 L, city 1 L, suburb 1.4 L, town 1 L, rural 0.1 S", // a town's regional high school: large; a one-room schoolhouse in the country
  church: "centre 0.6 M, city 0.8 M, suburb 1 M, town 1.4 S, highway 0.3 S, rural 0.6 S", // a chapel in the country
  chapel: "of univ",
  cityhall: "centre 2 L, city 0.5 L, town 1 M",
  courthouse: "centre 2 L, city 0.5 L, town 1 M",
  jail: "suburb 0.3 M, town 1 M",
  prison: "highway 0.5 L, rural 1 L, scenic 0.4 L", // a compound of large buildings out in the country, never one huge one
  cellblock: "of prison",
  // ---- offices ----
  office: "office",
  offices: "office",
  storefront: "centre 0.6 S, city 0.8 S, suburb 1 S, town 1.4 S",
  bizpark: "city 0.4 L, suburb 2 L, town 0.4 M, highway 0.4 L",
  callcenter: "centre 1 L, city 1.4 L, suburb 1.4 L, town 0.3 M",
  techoffice: "centre 2 L, city 1.6 L, suburb 1 M",
  station: "centre 0.5 M, city 0.6 M, suburb 0.8 M, town 1.6 S",
  // ---- colleges ----
  univ: "centre 1 H, city 1.4 H, suburb 1 L", // a city's university: its biggest campuses by the centre
  college: "town 1 L", // a town's college
  campus: "of univ", dorm: "of univ", lecturehall: "of univ", sciencehall: "of univ", univlibrary: "of univ", studentunion: "of univ",
  dininghall: "of univ", athletics: "of univ", admin: "of univ", security: "of univ", maintenance: "of univ", theatre: "of univ",
  parkgarage: "of univ", healthcentre: "of univ",
  // ---- industry ----
  warehouse: "centre 0.2 L, city 0.6 L, suburb 1.6 L, town 0.4 M, highway 0.8 L, rural 0.2 M",
  factory: "city 0.4 H, suburb 1.4 L, town 0.3 L, highway 0.6 L, coast 0.4 L",
  workshop: "suburb 0.6 S, town 0.8 S, highway 0.4 S, rural 0.4 S",
  machineshed: "farm",
  barn: "farm",
  farm: "farm",
  ranch: "highway 0.4 L, scenic 0.6 L, rural 1.4 L",
  quarry: "scenic 1.6 L, rural 0.4 L",
  radiotower: "centre 0.4 M, city 0.6 M, suburb 0.4 S, town 0.6 S, highway 1.2 S, scenic 1.4 S, rural 0.4 S", // issue #54: masts on the hills, cell sites and relays by the highways, rooftop repeaters and broadcast studios in the cities (PLACE_EXTRA)
  radio: "of radiotower",
  dam: "coast 1 L, scenic 0.4 L",
  control: "of dam",
  // ---- military, air and the bunkers ----
  military: "highway 0.4 L, scenic 0.6 L, rural 1 L", // a compound: its buildings large at most
  barracks: "of military", armorybldg: "of military", motorpool: "of military", hq: "of military", messhall: "of military",
  aidstation: "of military", gatehouse: "of military",
  airbase: "highway 0.4 L, rural 1 L",
  airport: "suburb 0.4 L, highway 0.6 L, rural 1 L",
  hangar: "of airport", terminal: "of airport", tower: "of airport", flightops: "of airbase", lab: "of military",
  bunker_mil: "highway 0.5 L, coast 0.5 L, scenic 1 L",
  bunker: "highway 0.5 L, coast 0.5 L, scenic 1 L",
  milbunker: "of bunker", mountainbunker: "of bunker_mil",
  govbunker: "centre 0.6 L, city 1 L, highway 0.3 L, coast 0.3 L, scenic 0.6 L",
  shelter: "centre 0.6 M, city 1 M, suburb 1.2 M, town 0.8 M",
  prepper: "hideout",
  // ---- amusement parks (issue #60, amusement.js: its variant by the class, variantpick.js) ----
  amusement: "centre 1 H, city 1 L, suburb 1.2 L, town 1 L, highway 0.8 L, coast 1 L, scenic 0.3 L, rural 0.25 L", // a destination theme park by a city's centre (huge), a regional park, a water park or a fun park in the city and its suburbs, a fairground in a town, a pier or a funfair on the coast
  // ---- the places themselves (a town, a city and the bare land as sites: their own buildings) ----
  town: "town 1 M",
  city: "centre 1 L, city 1 L",
  suburb: "suburb 1 M, town 1 M",
  plains: "farm",
  forest: "wild",
  hills: "wild",
  mountain: "wild",
};

// ---------- the table, read ----------
const LETTER = { S: "small", M: "medium", L: "large", H: "huge" };
/**
 * A row as { at: { class: weight }, size: { class: SizeClass } }.
 * @param {string} key @param {Set<string>} [seen]
 * @returns {{ at: Record<string, number>, size: Record<string, SizeClass>, of?: string }}
 */
function readRow(key, seen = new Set()) {
  let text = PLACEMENT_ROWS[key];
  if (text == null || seen.has(key)) return { at: {}, size: {} };
  seen.add(key);
  const of = /^of\s+(\S+)$/.exec(text.trim());
  if (of) return { ...readRow(of[1], seen), of: of[1] };
  if (PROFILES[text]) text = PROFILES[text];
  /** @type {Record<string, number>} */ const at = {};
  /** @type {Record<string, SizeClass>} */ const size = {};
  for (const part of text.split(",")) {
    const [cls, w, s] = part.trim().split(/\s+/);
    if (!TILE_CLASSES.includes(/** @type {any} */ (cls))) throw new Error(`data-placement.js: ${key}: no tile class "${cls}"`);
    at[cls] = Number(w);
    size[cls] = /** @type {SizeClass} */ (LETTER[s] || s);
  }
  return { at, size };
}
/** The placement table: every row read. @type {Record<string, { at: Record<string, number>, size: Record<string, SizeClass>, of?: string }>} */
export const PLACEMENT = Object.fromEntries(Object.keys(PLACEMENT_ROWS).map((k) => [k, readRow(k)]));
