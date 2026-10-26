// @ts-check
// Layout variants (the user's request 2026-10-25, issue #32 of the interiors epic #7: "add motel varients. every building
// should have several varients"): a dozen layouts each for the motel, the homes and the rural buildings (the house, the farmhouse, the
// cabin, the lodge, the ranger station, the apartment block, the neighbourhood, the barn, the machine shed). The other
// types' variants are their own tickets' (#33 restaurants, #34 the library, #35 shops and services, #36 civic and
// medical, #37 industrial: industrylayout.js; tools/varianttest.js PENDING_OWNER lists them). A variant is a distinct
// floor plan of a type, not a recolour: it changes at least two of the room list, the rooms' order and arrangement, the
// entrances (their side or count), corridor or open plan, the footprint and the storeys (tools/varianttest.js holds
// every type to it). This module is the registry: each type's layouts (LAYOUTS: an id, the name the map, the POI and the
// raid say, and its weight in each setting), and the pick. The plans themselves are buildingmaps.js's makers (house and
// HOME_PLANS, motel and MOTEL_PLANS, apartments and APT_PLANS, openfloor's OPEN_PLANS, streetMap's NEIGHBOURHOODS),
// which put the pick on the spec as industrylayout.js's plans do (spec.vname, spec.vid: assemble's plan.variant and
// plan.vid).
//
// THE PICK (pickLayout): an older save's building never takes one (opts.legacy: the roomsLegacy rule, its plan exactly as
// it was); else, in order:
//   - opts.layout: a pinned layout (a POI's own, poi.lay: pois.js makePoi rolls it when the POI is made, so its name and
//     its building agree; a render or a test pins one the same way);
//   - the franchise's (a franchise's plan.lay, where a maker passes it: a motel's franchises give only their look);
//   - the building's own dice (a hash of its map seed as it stands: read, never consumed, so the rest of its plan rolls
//     as the dice say) by the setting's weights: rural (open land, farms, the countryside's sites), town or city
//     (settingOfTile). A type with no setting given (a hint, a test) weighs the town's.
// A layout with weight 0 in a setting never stands there by the dice (a motor lodge in a city); pinned it still can. A
// type with no LAYOUTS has none here.
//
// NAMES: a variant's name is what a building with no franchise is called where the game shows one (pois.js poiName: a
// POI's poi.lay; buildingmaps.js buildingOptions: a site's choice of buildings; the raid's intro), as a franchise's is.
import { hash01 } from "./skills.js";
import { registerVariants, pickVariant } from "./variantpick.js"; // the shared picker (issue #41)

/** @typedef {"rural" | "town" | "city"} Setting */
/** @typedef {{ id: string, name: string, w: Record<Setting, number> }} Layout */

/** @param {string} id @param {string} name @param {number} [rural] @param {number} [town] @param {number} [city] @returns {Layout} */
const V = (id, name, rural = 1, town = 1, city = 1) => ({ id, name, w: { rural, town, city } });

// The first layout of each type is its plan as it stood before the variants (the classic), unless said otherwise.
/** @type {Record<string, Layout[]>} */
export const LAYOUTS = {
  // ---------- motels (the user's request: five, each a distinct plan; then a dozen a type) ----------
  motel: [
    V("court", "Motor court", 1, 2, 1),        // two storeys round the lot: the outdoor stair and walkway, the office and the manager's flat, ice and vending, a laundry, an empty pool behind a fence
    V("strip", "Roadside strip motel", 3, 1, 0.3), // one storey by the highway: rooms side by side, the office at one end under a neon sign, a gravel lot, a shed
    V("chain", "Chain motel", 0.5, 1.5, 2),    // 2–3 storeys: a lobby with a breakfast area, rooms off a central corridor, an inside stair
    V("cabins", "Motor lodge", 2.5, 0.8, 0),   // cottages round a drive (a small map of several buildings): the main lodge with the office and a diner, cabins with a kitchenette
    V("extended", "Extended-stay motel", 0.3, 1, 2), // 2–3 storeys: studios with kitchenettes, a guest laundry, a small gym
    V("neon", "Neon motor inn", 2, 1, 0.3),     // 1950s: one storey, the office under its neon sign and a coffee shop with its grill
    V("diner", "Motel and restaurant", 1.5, 1, 0.3), // the motor court's two storeys, a restaurant (its own door, its kitchen) at one end
    V("poolside", "Poolside motel", 0.8, 1.5, 1), // two storeys round the pool: the ground floor's rooms open onto it, a fitness room
    V("fishcamp", "Fishing-camp motel", 2, 0.3, 0), // the bait and tackle shop and office, a fish-cleaning room, a freezer room
    V("cottages", "Tourist court", 2, 0.6, 0),  // a row of tiny cottages and the office round a gravel drive (several buildings)
    V("weekly", "Weekly-rate motel", 0.6, 1, 1.5), // run down: two storeys of studios, a coin laundry, the maintenance shed
    V("ski", "Ski motel", 1.2, 0.5, 0),          // two storeys off an inside corridor: the fireside lounge, the boot room, the ski store
  ],
  // ---------- homes ----------
  house: [
    V("twostorey", "Two-storey house", 1, 2, 1.5),
    V("ranch", "Ranch house", 2, 1.5, 0.6),     // one storey, long, the bedrooms down a hall, sometimes a garage
    V("colonial", "Colonial house", 0.6, 1.2, 1.2), // two storeys about a centre hall: the parlour one side, dining and kitchen the other
    V("mobile", "Mobile home", 2.5, 0.8, 0.2),  // a single-wide or a double-wide: rooms in a row, one storey
    V("duplex", "Duplex", 0.2, 1, 2),           // two homes sharing a wall: two front doors, a home each side
    V("townhouse", "Townhouse", 0, 0.8, 2),     // narrow, three storeys: the living room and the kitchen, the bedrooms, a den
    V("bungalow", "Bungalow", 0.8, 1.5, 0.8),   // one storey, no hall: a den at the front
    V("victorian", "Victorian house", 0.4, 1, 1), // an entry hall between the parlour and the dining room, a pantry and a library
    V("splitlevel", "Split-level", 0.3, 1.5, 0.5), // the rec room, the garage and the laundry below, the living floor up a stair
    V("shotgun", "Shotgun house", 0.5, 0.8, 0.6), // one room wide, the rooms one behind the other
    V("cottage", "Cottage", 1, 1, 0.4),          // the attic bedroom under the eaves
    V("mansion", "Manor house", 0.4, 0.4, 0.3),  // a grand hall, a library, a home gym, four bedrooms
  ],
  farmhouse: [
    V("farmhouse", "Farmhouse"),
    V("oldfarm", "Old farmhouse", 1.2, 0.6, 0),  // a mudroom at the back door, a root cellar behind its own door
    V("ranchfarm", "Ranch farmhouse", 1, 0.8, 0), // one storey, long, a garage, a mudroom and laundry
    V("summer", "Farmhouse with a summer kitchen", 0.8, 0.4, 0), // a second kitchen across a breezeway, its own door
    V("foursquare", "Foursquare farmhouse", 1, 0.8, 0), // square, four rooms a floor, the farm office among them
    V("ihouse", "I-house", 0.8, 0.5, 0),          // one room deep about a centre hall, the cellar behind its own door
    V("homestead", "Homestead", 0.8, 0.2, 0),     // one great room, the bedroom and the larder
    V("dogtrot", "Dogtrot house", 0.6, 0.2, 0),   // two pens either side of an open breezeway
    V("stonehouse", "Stone farmhouse", 0.6, 0.3, 0), // the front door into the farm kitchen, the dairy, the apple store
    V("tenant", "Tenant house", 0.8, 0.4, 0),     // small: a wash house at the back
    V("bigfarm", "Big farmhouse", 0.6, 0.4, 0),   // a sunroom, the farm office, the mudroom and laundry; four bedrooms
    V("modern", "Modern farmhouse", 0.6, 0.6, 0), // one storey, open plan: the great room and the kitchen
  ],
  cabin: [
    V("tworoom", "Two-room cabin"),
    V("hunting", "Hunting cabin", 1.5),          // one room and a lean-to
    V("loft", "Cabin with a loft"),               // a sleeping loft up a ladder over the great room
    V("aframe", "A-frame"),                       // narrow and tall: the great room below, the bedroom loft a storey up
    V("trapper", "Trapper's cabin", 1.2),         // the one room and the skinning room
    V("lake", "Lake cabin"),                      // the boathouse at one end
    V("log", "Log cabin"),                        // two storeys: a bedroom and a bunk room above
    V("prospector", "Prospector's cabin", 1.2),   // the assay bench and the powder store
    V("saddlebag", "Saddlebag cabin"),            // two pens, each its own front door
    V("bunkhouse", "Bunkhouse cabin"),            // the cookroom and two bunk rooms
    V("offgrid", "Off-grid cabin"),               // the battery room and the water tank room
    V("porch", "Cabin with a sleeping porch"),    // the screened porch across the front
  ],
  lodge: [
    V("hunting", "Hunting lodge"),                // the great room and its trophy wall, bunks, the gun room
    V("fishing", "Fishing lodge"),                // bunk rooms, a mudroom and a boot room, the tackle room
    V("camp", "Camp lodge"),                      // a dining hall and its kitchen, a bunk wing; one storey
    V("ski", "Ski lodge"),                        // the fireside lounge, the rental shop, the boot room, the cafeteria; bunks upstairs
    V("guest", "Guest ranch lodge"),              // the front desk, the dining room, the tack room; guest rooms upstairs
    V("duck", "Duck-hunting lodge"),              // the decoy room, the gun room, the boat shed
    V("lake", "Lake lodge"),                      // the boathouse; bedrooms upstairs
    V("scout", "Scout lodge"),                    // the meeting hall, the craft room, the camp store
    V("retreat", "Retreat lodge"),                // two storeys of guest rooms off a corridor, the lounge, a reading room
    V("trading", "Trading-post lodge"),           // the trading post's shelves, the storeroom
    V("outfitter", "Outfitter's lodge"),          // the outfitter's office, the gun room, the gear room
    V("logging", "Logging-camp lodge"),           // the cookhouse, the bunkhouse, the saw-filing room
  ],
  ranger: [
    V("field", "Ranger station"),                 // the field office (sometimes with its garage)
    V("visitor", "Visitor centre"),               // a lobby of exhibits, restrooms, the shop, the office
    V("lookout", "Lookout tower", 1.5),           // a small tower: stores below, the lookout's cab on top
    V("fire", "Fire crew station"),               // the engine bay, the crew quarters, the fire cache
    V("entrance", "Entrance station"),            // the fee booth
    V("backcountry", "Backcountry patrol cabin"), // one room, a bunk room, the tool shed
    V("hq", "Park headquarters"),                 // two storeys of offices off a corridor
    V("research", "Field research station"),      // the field lab, the sample store
    V("maintenance", "Park maintenance shop"),    // the equipment bay, the shop, the parts room
    V("campground", "Campground office"),         // the camp store, the coin laundry, the showers
    V("warden", "Game warden's station"),         // the gun locker, the seized-game store, a holding cell
    V("radio", "Radio relay station"),            // the radio room, the generator shed
  ],
  apartments: [
    V("corridor", "Apartment block", 0.3, 1, 2),  // flats off a long corridor
    V("walkup", "Walk-up", 0.5, 1.5, 1.5),        // a central stair, four flats a floor, no corridor
    V("garden", "Garden apartments", 1, 1.5, 0.5), // several low buildings round a parking lot (a small map of several buildings)
    V("lofts", "Loft conversion", 0, 0.6, 1.5),    // an old mill: big open-plan lofts, a freight stair
    V("tower", "Apartment tower", 0, 0.4, 2),     // 4–6 storeys of small flats, the mail room
    V("shops", "Flats over shops", 0.3, 1.5, 1.5), // two shops below, two flats a floor over them
    V("rooming", "Rooming house", 0.3, 1, 1),     // rooms to let, a shared kitchen and bathrooms
    V("senior", "Senior apartments", 0.3, 1, 0.8), // the common room, the manager's office, the laundry
    V("student", "Student housing", 0, 0.8, 1),   // suites, the study rooms, the bike store
    V("projects", "Housing project", 0, 0.5, 1.5), // a long slab of 4–5 storeys, the boiler room
    V("converted", "Converted house", 0.5, 1.2, 0.8), // one flat a floor up the old stair hall
    V("condos", "Luxury condos", 0, 0.4, 1.2),    // a marble lobby, the concierge, a gym, the parking garage
  ],
  neighbourhood: [
    V("grid", "Street", 0.5, 1.5, 1.5),           // two rows of houses facing a straight road
    V("culdesac", "Cul-de-sac", 0.3, 1.5, 1),     // the road ends in a turning circle: one way out by road
    V("rural", "Country road", 2, 0.5, 0),        // a dirt road, fewer houses far apart, fields between
    V("trailer", "Trailer park", 2, 0.8, 0.3),    // mobile homes on a gravel loop, the park office
    V("suburb", "Suburban street", 0.3, 1.5, 0.8), // ranch houses, split-levels, bungalows
    V("row", "Row houses", 0, 0.6, 1.5),          // townhouses wall to wall
    V("duplexes", "Duplex street", 0.2, 1, 1),    // two duplexes a side
    V("oldtown", "Old town street", 0.3, 1, 0.6), // Victorians and cottages
    V("mill", "Mill village", 0.6, 0.6, 0),       // the company's bungalows, all alike, on a dirt road
    V("estate", "Estate lane", 0.3, 0.4, 0.2),    // three manor houses in their grounds
    V("lakeside", "Lake road", 1.2, 0.3, 0),      // cabins among the trees
    V("hamlet", "Crossroads hamlet", 1.5, 0.2, 0), // farmhouses down a dirt road, a pole barn
  ],
  // ---------- farm and work buildings ----------
  barn: [
    V("barn", "Barn"),                            // the barn floor, the hayloft over it, the tack room
    V("bank", "Bank barn"),                       // two floors: stables below, the threshing floor above up a ramp
    V("pole", "Pole barn"),                       // one open span, a roller door each end
    V("dairy", "Dairy barn"),                     // stalls down an aisle, the milk room, the silo
    V("horse", "Horse barn"),                     // stalls down an aisle, the tack room, the arena
    V("tobacco", "Tobacco barn"),                 // the curing floor, the stripping room, the packing room
    V("hog", "Hog barn"),                         // pens either side of an aisle, the barn office
    V("poultry", "Poultry house"),                // the long laying house, the egg room
    V("sheep", "Sheep barn"),                     // the lambing pens, the shearing floor, the wool store
    V("crib", "Corn crib and granary"),           // a drive bay through the middle
    V("cattle", "Cattle barn"),                   // the loafing barn, the calving pen, the vet room
    V("hay", "Hay barn"),                         // the hay mow over the open floor
  ],
  machineshed: [
    V("shed", "Machine shed"),
    V("pole", "Pole shed"),                       // open bays along the front, no rooms
    V("shop", "Equipment shed with a shop"),     // the bays, a farm shop, the fuel and chemical store
    V("quonset", "Quonset hut"),                  // one deep bay under the arch
    V("grain", "Grain dryer shed"),               // the dryer floor, its controls, the seed store
    V("fuel", "Fuel shed"),                       // the fuel bay, the office, the oil and grease store
    V("welding", "Welding shop"),                 // the shop floor, the steel rack, the gas bottles
    V("tractor", "Tractor garage"),               // the garage, the shop, a washroom
    V("chemical", "Chemical store"),              // the sprayer bay, the locked chemical store
    V("pump", "Pump house"),                      // the pump room, the tank room
    V("office", "Farm office shed"),              // the equipment bay, the office, the crew room
    V("truck", "Truck shed"),                     // the truck bay, the parts room, dispatch
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
  if (!list.some((l) => (!allow || allow.includes(l.id)) && (l.w[s] || 0) > 0)) return list[0].id; // none can stand here: the classic
  // variantpick.js (issue #41): "layout:<key>", the layouts allowed (a street's: ctx.only), weighted by the setting.
  return /** @type {any} */ (pickVariant(`layout:${key}`, null, { setting: s, only: allow ? (l) => allow.includes(l.id) : undefined, r })).id;
}
for (const key of Object.keys(LAYOUTS)) registerVariants(`layout:${key}`, LAYOUTS[key]); // the registry (variantpick.js): each type's layouts as they are ({ id, name, w })

// A POI's kind as the building type its layout is of: a kind with layouts of its own (a house, a barn, a motel...); a
// kind on another's building under its own name (a shed on a machine shed's, a mine shack on a cabin's: buildingmaps.js
// SITES) keeps its name, its building's layout by the dice.
/** @param {string} kind */
export const poiLayoutKey = (kind) => kind;

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
 * @returns {{ id: string, name: string, classic: boolean } | null}
 */
export function pickLayout(key, seed, o = {}, lay = null, allow = null) {
  if (o && o.legacy) return null;
  const list = layoutsOf(key);
  if (!list.length) return null;
  const pinned = layoutById(key, o && o.layout) || layoutById(key, o && typeof o.plan === "string" ? o.plan : null) || layoutById(key, lay); // o.plan: dev's pin of a named plan (setup.raid.place.plan, #26 and #37's)
  const set = o && (o.lset || (["rural", "town", "city"].includes(o.setting) ? o.setting : null)); // lset: buildingmaps.js makeSpec's (the tile's: o.setting there is #35's and #36's own word for it)
  const id = pinned ? pinned.id : layoutFor(key, set, hash01(seed, "layout", key), allow);
  const l = layoutById(key, id) || list[0];
  return { id: l.id, name: l.name, classic: l === list[0] }; // classic: the type's plan as it stood (buildingmaps.js realScale scales it as the general plan)
}
