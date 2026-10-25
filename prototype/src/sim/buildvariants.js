// @ts-check
// Layout variants for every building type (the user's request 2026-10-25, issue #32 of the interiors epic #7: "add motel
// varients. every building should have several varients"). A variant is a distinct floor plan of a type, not a recolour:
// it changes at least two of the room list, the rooms' order and arrangement, the entrances (their side or count),
// corridor or open plan, the footprint and the storeys (tools/varianttest.js holds every type to it). This module is the
// registry: each type's layouts (LAYOUTS: an id, the name the map, the POI and the raid say, and its weight in each
// setting), and the pick. The plans themselves are buildingmaps.js's archetype makers (house, shop, institution,
// openfloor, motel...), which read the pick (spec.variant = { id, name }).
//
// THE PICK (pickLayout): an older save's building never takes one (opts.legacy: the roomsLegacy rule, its plan exactly as
// it was); else, in order:
//   - opts.layout: a pinned layout (a POI's own, poi.lay: pois.js makePoi rolls it when the POI is made, so its name and
//     its building agree; a render or a test pins one the same way);
//   - the franchise's (data-shops.js FRANCHISES plan.lay: a Quick Lube is the drive-through lube bay, a Sheriff's office
//     the substation, St. Mary's the cathedral);
//   - the building's own dice (a hash of its map seed as it stands: read, never consumed, so the rest of its plan rolls
//     as the dice say) by the setting's weights: rural (open land, farms, the countryside's sites), town or city
//     (settingOfTile). A type with no setting given (a hint, a test) weighs the town's.
// A layout with weight 0 in a setting never stands there by the dice (a cathedral in the countryside); pinned it still
// can. A type with no LAYOUTS (owned by another ticket until it lands: PENDING_OWNER in tools/varianttest.js) has none.
//
// NAMES: a variant's name is what a building with no franchise is called where the game shows one (pois.js poiName: a
// POI's poi.lay; buildingmaps.js buildingOptions: a site's choice of buildings; the raid's intro), as a franchise's is.
import { hash01 } from "./skills.js";

/** @typedef {"rural" | "town" | "city"} Setting */
/** @typedef {{ id: string, name: string, w: Record<Setting, number> }} Layout */

/** @param {string} id @param {string} name @param {number} [rural] @param {number} [town] @param {number} [city] @returns {Layout} */
const V = (id, name, rural = 1, town = 1, city = 1) => ({ id, name, w: { rural, town, city } });

// The first layout of each type is its plan as it stood before the variants (the classic), unless said otherwise.
/** @type {Record<string, Layout[]>} */
export const LAYOUTS = {
  // ---------- motels (the user's request: five, each a distinct plan) ----------
  motel: [
    V("court", "Motor court", 1, 2, 1),        // two storeys round the lot: the outdoor stair and walkway, the office and the manager's flat, ice and vending, a laundry, an empty pool behind a fence
    V("strip", "Roadside strip motel", 3, 1, 0.3), // one storey by the highway: rooms side by side, the office at one end under a neon sign, a gravel lot, a shed
    V("chain", "Chain motel", 0.5, 1.5, 2),    // 2–3 storeys: a lobby with a breakfast area, rooms off a central corridor, an inside stair
    V("cabins", "Motor lodge", 2.5, 0.8, 0),   // cottages round a drive (a small map of several buildings): the main lodge with the office and a diner, cabins with a kitchenette
    V("extended", "Extended-stay motel", 0.3, 1, 2), // 2–3 storeys: studios with kitchenettes, a guest laundry, a small gym
  ],
  // ---------- homes ----------
  house: [
    V("twostorey", "Two-storey house", 1, 2, 1.5),
    V("ranch", "Ranch house", 2, 1.5, 0.6),     // one storey, long, the bedrooms down a hall, sometimes a garage
    V("colonial", "Colonial house", 0.6, 1.2, 1.2), // two storeys about a centre hall: the parlour one side, dining and kitchen the other
    V("mobile", "Mobile home", 2.5, 0.8, 0.2),  // a single-wide or a double-wide: rooms in a row, one storey
    V("duplex", "Duplex", 0.2, 1, 2),           // two homes sharing a wall: two front doors, a home each side
  ],
  farmhouse: [
    V("farmhouse", "Farmhouse"),
    V("oldfarm", "Old farmhouse", 1.2, 0.6, 0),  // a mudroom at the back door, a root cellar behind its own door
    V("ranchfarm", "Ranch farmhouse", 1, 0.8, 0), // one storey, long, a garage, a mudroom and laundry
    V("summer", "Farmhouse with a summer kitchen", 0.8, 0.4, 0), // a second kitchen across a breezeway, its own door
  ],
  cabin: [
    V("tworoom", "Two-room cabin"),
    V("hunting", "Hunting cabin", 1.5),          // one room and a lean-to
    V("loft", "Cabin with a loft"),               // a sleeping loft up a ladder over the great room
    V("aframe", "A-frame"),                       // narrow and tall: the great room below, the bedroom loft a storey up
  ],
  lodge: [
    V("hunting", "Hunting lodge"),                // the great room and its trophy wall, bunks, the gun room
    V("fishing", "Fishing lodge"),                // bunk rooms, a mudroom and a boot room, the tackle room
    V("camp", "Camp lodge"),                      // a dining hall and its kitchen, a bunk wing; one storey
  ],
  ranger: [
    V("field", "Ranger station"),                 // the field office (sometimes with its garage)
    V("visitor", "Visitor centre"),               // a lobby of exhibits, restrooms, the shop, the office
    V("lookout", "Lookout tower", 1.5),           // a small tower: stores below, the lookout's cab on top
  ],
  apartments: [
    V("corridor", "Apartment block", 0.3, 1, 2),  // flats off a long corridor
    V("walkup", "Walk-up", 0.5, 1.5, 1.5),        // a central stair, four flats a floor, no corridor
    V("garden", "Garden apartments", 1, 1.5, 0.5), // several low buildings round a parking lot (a small map of several buildings)
    V("lofts", "Loft conversion", 0, 0.6, 1.5),    // an old mill: big open-plan lofts, a freight stair
  ],
  neighbourhood: [
    V("grid", "Street", 0.5, 1.5, 1.5),           // two rows of houses facing a straight road
    V("culdesac", "Cul-de-sac", 0.3, 1.5, 1),     // the road ends in a turning circle: one way out by road
    V("rural", "Country road", 2, 0.5, 0),        // a dirt road, fewer houses far apart, fields between
  ],
  // ---------- farm and work buildings ----------
  barn: [
    V("barn", "Barn"),                            // the barn floor, the hayloft over it, the tack room
    V("bank", "Bank barn"),                       // two floors: stables below, the threshing floor above up a ramp
    V("pole", "Pole barn"),                       // one open span, a roller door each end
    V("dairy", "Dairy barn"),                     // stalls down an aisle, the milk room, the silo
    V("horse", "Horse barn"),                     // stalls down an aisle, the tack room, the arena
  ],
  machineshed: [
    V("shed", "Machine shed"),
    V("pole", "Pole shed"),                       // open bays along the front, no rooms
    V("shop", "Equipment shed with a shop"),     // the bays, a farm shop, the fuel and chemical store
  ],
  garage: [
    V("garage", "Detached garage"),
    V("workshop", "Garage with a workshop"),     // the bay, a workshop and the storage loft over it
    V("body", "Body shop", 0.5, 1, 1),            // bays, the paint booth, the office
  ],
  workshop: [
    V("workshop", "Workshop"),
    V("welding", "Welding shop"),                 // the welding bay behind its roller door, the steel store, the office
    V("woodshop", "Woodshop"),                    // the shop floor, the lumber store, the finishing room
  ],
  autoshop: [
    V("garage", "Auto shop"),
    V("quicklube", "Quick lube"),                 // drive-through bays front to back, a waiting room
    V("body", "Body shop"),                       // the paint booth, the frame bay, the parts room
    V("tyre", "Tyre shop"),                       // the tyre store, the bays, a counter
  ],
  warehouse: [
    V("warehouse", "Warehouse"),
    V("distribution", "Distribution centre", 0.5, 1, 1.5), // pallet racks, a row of loading docks, the shipping offices across the front
    V("cold", "Cold-storage warehouse"),          // freezer rooms behind cold room doors, the dock
    V("storage", "Self-storage", 0.8, 1.5, 1),    // rows of locked units off aisles: a maze
  ],
  factory: [
    V("works", "Machine works"),                  // the factory floor of machine tools, the offices across the front
    V("food", "Food-processing plant"),           // the processing floor, cold rooms, packing, the dock
    V("textile", "Textile mill"),                 // two or three floors of mill floor round a stair
    V("chemical", "Chemical plant"),              // the tank hall, the control room, the lab, the drum store
  ],
  // ---------- institutions ----------
  lab: [
    V("research", "Research lab"),
    V("teaching", "Teaching lab"),                // lecture rooms, teaching labs, the prep room
    V("biohazard", "Biohazard lab"),              // airlocks, the freezer room, the decontamination showers, sealed labs
  ],
  hospital: [
    V("regional", "Regional hospital", 0.3, 1, 2),
    V("critical", "Critical-access hospital", 2, 1, 0.2), // one or two storeys: a small ER, a ward, the pharmacy
    V("children", "Children's hospital", 0, 0.5, 1),     // children's wards of cots, the play room, the clinic floors
  ],
  clinic: [
    V("clinic", "Clinic"),
    V("surgery", "Doctor's surgery", 1.5, 1, 0.5), // a converted house: the waiting room, two consulting rooms, no corridor
    V("medcentre", "Medical centre", 0.3, 1, 1.5), // two storeys: X-ray, the pharmacy counter, the treatment room
  ],
  infirmary: [
    V("infirmary", "Infirmary"),
    V("ward", "Ward infirmary"),                  // one long ward hall of beds, the treatment room, the drug store
    V("dispensary", "Dispensary"),                // a small one: the counter, the exam room, the stores
  ],
  police: [
    V("precinct", "City precinct", 0, 0.5, 2),
    V("substation", "Sheriff's substation", 2, 1, 0.2), // one storey: the desk, an office, a holding cell, the gun locker
    V("patrol", "State patrol post", 1, 1, 0.3),        // the cruisers' garage, dispatch, the locker room, the armory
  ],
  firestation: [
    V("city", "City fire station", 0.2, 1, 2),
    V("volunteer", "Volunteer fire hall", 2, 1, 0.1),   // one storey: one bay, the meeting hall and its kitchen
    V("big", "Fire headquarters", 0, 0.5, 1.5),         // three bays, the training tower, the dorm above
  ],
  church: [
    V("brick", "Brick church"),                   // the nave, the steeple's bell tower, the parish hall
    V("chapel", "Clapboard chapel", 2, 1, 0.3),   // one small nave and a vestry
    V("mega", "Megachurch", 0, 0.8, 1.5),         // an auditorium, classrooms, a cafe, offices; two storeys
    V("cathedral", "Cathedral", 0, 0.2, 1),       // the long nave, side chapels, the sacristy, the crypt stair
  ],
  library: [
    V("central", "Central library", 0, 0.6, 2),
    V("carnegie", "Carnegie library", 0.5, 1.5, 0.6), // the domed hall in the middle, reading rooms either side, the stacks behind
    V("branch", "Branch library", 1, 1, 1),            // one open room of stacks, the children's area, the community room
    V("county", "County library", 1, 1, 0.5),          // a corridor of rooms: the archive, the genealogy room, the meeting room
  ],
  bank: [
    V("bank", "Bank"),
    V("town", "Small-town bank", 2, 1.2, 0.2),    // one room of a banking hall, the vault, the manager's office
    V("drive", "Drive-through branch", 0.5, 1, 1), // the teller line along the drive-through window, a side lane
    V("city", "City bank", 0, 0.4, 1.5),          // the marble hall, the vault and the deposit room, offices above
  ],
  vet: [
    V("small", "Animal clinic"),
    V("country", "Country vet", 2, 1, 0),         // the large-animal stalls and their roller door
    V("hospital", "Animal hospital", 0.2, 1, 1.5), // two storeys: X-ray, the ICU, the boarding kennels
  ],
  dealer: [
    V("dealer", "Car dealership"),
    V("lot", "Used-car lot"),
    V("truck", "Truck dealer"),
  ],
  // ---------- shops and services ----------
  pharmacy: [
    V("pharmacy", "Pharmacy"),
    V("chain", "Chain drugstore", 0.3, 1, 1.5),   // aisles, the counter at the back, a drive-through window
    V("soda", "Independent pharmacy", 1.5, 1, 0.5), // the soda fountain at the front, the dispensary, the flat above
    V("outpatient", "Outpatient pharmacy", 0.3, 1, 1.5), // a waiting room, consultation rooms off a corridor, the dispensary
  ],
  gunstore: [
    V("gunstore", "Gun store"),
    V("range", "Gun range"),                      // the shop, the range's lanes behind, the range office
    V("gunsmith", "Gunsmith"),                    // a small counter, the gunsmith's workshop, the safe room
    V("tactical", "Tactical outfitter"),          // two floors: the shop, the training room and stores above
  ],
  pawnshop: [
    V("pawn", "Pawn shop"),
    V("loan", "Pawn and loan"),                   // the loan office, the vault, the counter
    V("trading", "Trading post"),                 // a yard of big things behind the shop, the back room
  ],
  sportshop: [
    V("sports", "Sporting goods store"),
    V("big", "Sports superstore"),                // fitting rooms, the bike and ski workshop, two floors
    V("team", "Team sports shop"),                // team gear, the printing room
    V("camp", "Outdoor store"),                   // camping gear, the boat and bait room
    V("hunt", "Hunting outfitter"),               // the gun counter, the stock
  ],
  electronics: [
    V("electronics", "Electronics store"),
    V("repair", "TV and repair shop"),            // the repair bench, the parts room
    V("mega", "Electronics superstore"),          // a wide floor, the stockroom along one side, the service desk
  ],
  radioshop: [
    V("radio", "Radio shop"),
    V("repair", "Radio repair"),                  // the repair bench front and centre
    V("ham", "Ham radio supply"),                 // the antenna yard behind, the radio shack
  ],
  bookstore: [
    V("books", "Bookstore"),
    V("used", "Used bookshop"),                   // stacks in back rooms, the owner's flat above
    V("cafe", "Bookshop and cafe"),               // a cafe along one side, the stockroom along the other
  ],
  petstore: [
    V("pets", "Pet store"),
    V("aquarium", "Aquarium shop"),               // the fish room and the feed store
    V("feed", "Feed and pet supply"),             // the feed room, a loading door
  ],
  garden: [
    V("garden", "Garden center"),
    V("yard", "Nursery yard"),                    // the yard stock behind, the office
    V("greenhouse", "Greenhouse nursery"),        // a glass house along one side, the potting shed
  ],
  clothing: [
    V("clothing", "Clothing store"),
    V("boutique", "Boutique"),                    // small, the alterations room, the owner's flat above
    V("western", "Western wear"),                 // boots and saddlery, the tack room
    V("workwear", "Workwear store"),              // the stock along one side, the embroidery room
  ],
  liquor: [
    V("liquor", "Liquor store"),
    V("warehouse", "Liquor warehouse"),           // a big floor, the warehouse behind its loading door
    V("package", "Package store"),                // small, the drive-up window, the cooler room
  ],
  restaurant: [
    V("sitdown", "Sit-down restaurant"),
    V("fastfood", "Fast food"),
    V("takeout", "Takeout counter"),
    V("smoker", "Smokehouse"),
    V("cafe", "Cafe"),
  ],
  bar: [
    V("bar", "Bar"),
    V("roadhouse", "Roadhouse"),                  // the stage and dance floor, the keg room
    V("pub", "Pub"),                              // the snug, the cellar, the landlord's flat above
    V("sports", "Sports bar"),                    // the game room, the kitchen
  ],
  hardware: [
    V("hardware", "Hardware store"),
    V("lumber", "Lumber yard"),                   // the yard behind, the tool crib
    V("bigbox", "Home centre"),                   // a wide floor, the garden section, the loading dock
  ],
  feedstore: [
    V("feed", "Feed store"),
    V("supply", "Farm-supply barn", 1.5, 1, 0),   // the store, the barn of fencing and bales behind its roller door
    V("coop", "Farmers' co-op", 1.5, 1, 0),       // the office, the seed store, the grain bin room
    V("western", "Western store", 1, 1, 0.3),     // saddles and boots at the front, the tack room
  ],
  diner: [
    V("diner", "Diner"),
    V("counter", "Lunch counter"),                // small: the counter and the kitchen, no dining room
    V("truckers", "Truckers' diner"),             // a big dining room, the showers, the lounge
  ],
  pizza: [
    V("pizza", "Pizza place"),
    V("slice", "Slice counter"),                  // the counter, the oven room, the storeroom
    V("parlour", "Pizza parlour"),                // the dining room, the party room, the arcade corner
  ],
  gasstation: [
    V("service", "Service station"),              // the shop and the repair bay
    V("kiosk", "Pump kiosk"),                     // a kiosk by the pumps, nothing else
    V("carwash", "Gas and car wash"),             // the shop, the car wash bay through the building
  ],
  truckstop: [
    V("truckstop", "Truck stop"),
    V("travel", "Travel centre"),                 // the shop, fast food, the showers and lounge, the chapel
    V("scale", "Truck scale and tyre shop"),      // the scale house, the tyre shop's bays, a small diner
  ],
};

// The building types whose franchises name their layout (data-shops.js plan.lay) use the same ids as LAYOUTS.
/** The type's layouts ([] for none). @param {string} key */
export const layoutsOf = (key) => LAYOUTS[key] || [];
/** A layout by its id. @param {string} key @param {string | null | undefined} id */
export const layoutById = (key, id) => (id ? layoutsOf(key).find((l) => l.id === id) || null : null);
/** A layout's name ("" for none). @param {string} key @param {string | null | undefined} id */
export const layoutName = (key, id) => { const l = layoutById(key, id); return l ? l.name : ""; };

// A weighted pick of a type's layouts by the setting, r in [0, 1).
/** @param {string} key @param {Setting | null | undefined} setting @param {number} r @param {string[] | null} [allow] @returns {string | null} */
export function layoutFor(key, setting, r, allow = null) {
  const list = layoutsOf(key);
  if (!list.length) return null;
  const s = setting || "town";
  const ws = list.map((l) => (allow && !allow.includes(l.id) ? 0 : Math.max(0, l.w[s] || 0)));
  const tot = ws.reduce((a, b) => a + b, 0);
  if (!(tot > 0)) return list[0].id;
  let x = r * tot;
  for (let i = 0; i < list.length; i++) { x -= ws[i]; if (x < 0 && ws[i] > 0) return list[i].id; }
  return list[list.length - 1].id;
}

// A POI's kind as the building type its layout is of (buildingmaps.js SITES: a shed is a machine shed's, a mine shack
// a cabin's, a quarry's workshop).
const POI_KEY = { shed: "machineshed", mineshack: "cabin", quarry: "workshop", radiotower: "radio", gas: "gasstation", office: "offices" };
/** @param {string} kind */
export const poiLayoutKey = (kind) => POI_KEY[kind] || kind;

// The setting a building stands in, from its tile: a city's tiles and urban sites "city", a town's and the suburbs
// "town", everything else (farms, open land, the countryside's sites, crash sites, bases) "rural".
/** @param {any} tile @returns {Setting} */
export function settingOfTile(tile) {
  if (!tile) return "town";
  if (tile.terrain === "city") return "city";
  const z = tile.loc && tile.loc.zone;
  if (z === "urban") return "city";
  if (z === "town") return "town";
  if (tile.terrain === "suburb") return "town";
  return "rural";
}
// The setting of a shop's place (shops.js settingOf: "city", "suburb", "town" or null) as a layout setting.
/** @param {string | null | undefined} s @returns {Setting} */
export const settingOfPlace = (s) => (s === "city" ? "city" : s === "suburb" || s === "town" ? "town" : "rural");

/**
 * The layout a building of type `key` takes (see the header): { id, name } or null (an older save's, a type with none).
 * seed: the building's dice as they stand (buildingmaps.js passes rng.state: read, not consumed); o: the archetype's
 * opts (legacy, layout, setting); lay: the franchise's plan.lay.
 * allow: the layouts the dice may pick from (a street's houses: the ones that fit a street), all when null.
 * @param {string} key @param {number} seed @param {any} [o] @param {string | null} [lay] @param {string[] | null} [allow]
 * @returns {{ id: string, name: string } | null}
 */
export function pickLayout(key, seed, o = {}, lay = null, allow = null) {
  if (o && o.legacy) return null;
  const list = layoutsOf(key);
  if (!list.length) return null;
  const pinned = layoutById(key, o && o.layout) || layoutById(key, lay);
  const id = pinned ? pinned.id : layoutFor(key, o && o.setting, hash01(seed, "layout", key), allow);
  const l = layoutById(key, id) || list[0];
  return { id: l.id, name: l.name };
}
