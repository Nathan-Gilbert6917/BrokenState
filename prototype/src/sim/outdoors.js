// @ts-check
// Golf courses, campgrounds and RV parks (issue #61 of the round-2 epic #39, the user's request 2026-10-26: "golf
// clubhouse, camp grounds, RV parks"). Each opens one raid map with the whole place on it (outdoorMap), built on
// compound.js (#30's shared multi-building code) as a campus is (campus.js): its buildings in a row along the access
// road, each its own plan, rooms, containers and signs of survival, and its grounds behind them.
//
//   - The kinds (OUTDOOR.KINDS): golfcourse (a POI by the towns and the cities: placement.js PLACE_EXTRA), campground
//     (mapgen.js's old forest site, a new world's only: buildingmaps.js OUTDOOR_SITES; and a POI by the lakes) and rvpark
//     (a POI by the highways, the lakes and in scenic land).
//   - The variants: a dozen and more a kind (GOLF_VARIANTS, CAMP_VARIANTS, RV_VARIANTS), registered with the shared
//     picker (variantpick.js, #41) under the kind's key and picked through it with #42's placementCtx (the tile's
//     class, its setting, the size the placement table gives the kind there: each variant's sizeClass). A pin:
//     option.layout or option.plan (an id). Its id and name are the map's vid / vname (planname.js, #40).
//   - The buildings (PLANS): the clubhouses (a country club's dining room, bar, locker rooms and pro shop; a municipal
//     course's grill room; a resort's; a links's; a driving range's shed; a mini-golf office), the cart barn, the
//     maintenance shed, the starter's hut, a pool house; the campground's bathhouses, vault toilets, bait shop, boat shed,
//     the nurse's cabin and the skinning shed, and the ranger station's own plans (buildvariants.js ranger: the
//     campground office with its camp store, laundry and showers, the entrance station, the visitor centre, the field
//     station), the camp and scout lodges, the cabins; the RV park's office and store, laundry and showers, rec hall, and
//     mobile homes (buildvariants.js house "mobile"). Sizes: data-buildingsize.js REAL_SIZE golfcourse / campground /
//     rvpark, a sizes row per variant for its main building (realFoot, realStoreys).
//   - The grounds (golfGrounds, campGrounds, rvGrounds): fairways with tees, greens, bunkers, ponds and cart paths, a
//     driving range under its floodlights, a mini-golf course; gravel loops of tent sites (a tent: campsite.js's tent
//     cells and its storage a container, rolled by tentBoxLoot; a picnic table, a fire ring, a cooler), a pavilion, a
//     group field; rows of RV pads (each RV or trailer a container: AREAS rvpad), the dump station, a pool, a court; a
//     lake or a river along the north edge with a boat launch and a dock. Golf carts, parked cars and boat trailers to
//     search. Every piece through compound.js guard (nothing cuts a walkable cell off from the way in).
//   - The ways out: both ends of the access road (the team comes in at the west end with its vehicle), and by the
//     variant the north edge and the west and east edges.
//   - The dead: the site's roster × the place's size (map.deadScale: OUTDOOR.DEAD_*), OUTDOOR.OUTSIDE of them out on
//     the grounds (map.outsideDead: buildingmaps.js placeInterior).
//   - Loot (outdoorLootShare): a building's container holds what it would in its building's own map, an RV, a tent site
//     or a cart what it would on an ordinary raid map. Heat (outdoorHeatRate): the big-map clock by what your people
//     have searched, as a campus's.
//   - AI parity: other groups take from the place through the POI rules (poicont.js poiHouses: outdoorHouses, a building
//     or a few pads at a time), as your headless crews do.
//   - Older saves: a save from before (worldcfg.js legacyOutdoors) has no golf courses or RV parks and keeps its
//     campgrounds' street map.
/** @import { State } from "./types" */
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";
import { BUILDINGS, assemble } from "./buildingmaps.js"; // call-time only (buildingmaps.js imports this module)
import { compoundGrid, placeBuilding, guard, parkingLot, compoundResult, compoundVehicle } from "./compound.js";
import { rollScenes, sceneRng, registerScene } from "./interiorscenes.js";
import { registerVariants, pickVariant, variantsOf } from "./variantpick.js";
import { placementCtx } from "./placement.js";
import { TENT_TYPES } from "./data-tents.js";
import { TENT_FIGHT } from "./softcover.js"; // a tent's hit points (call-time only)
import { realFoot, realStoreys } from "./data-buildingsize.js";

export const OUTDOOR = {
  CAP: 300,             // a map's side at most (battlesize.js MAP_CAP: the epic's default cap)
  EDGE: 5,              // the ground between the map's edges and the grounds
  ROAD: 5,              // the access road along the south edge (the way in)
  FRONT: 3,             // the lawn between the buildings' fronts and the forecourt
  APRON: 5,             // the gravel forecourt before the buildings (a lot: LOT)
  LOT: 18,              // a parking lot's depth (compound.js parkingLot: a double row of bays and its aisles)
  GAP: [5, 9],          // the ground between two buildings of a row
  ROWGAP: 8,            // between two rows of buildings (a path along the second row's fronts)
  BACK: 6,              // between the last row's backs and the grounds
  MIN_GROUNDS: 40,      // the grounds' least depth
  DEAD_AREA: 2500,      // the site's roster × (the place's built and used area / this) ^ DEAD_EXP, at most DEAD_MAX
  DEAD_EXP: 0.7,
  DEAD_MAX: 3.5,
  OUTSIDE: { golfcourse: 0.45, campground: 0.55, rvpark: 0.6 }, // the share of the dead out on the grounds
  HOLE: [13, 18],       // a hole's strip, north to south
  SITE: 9,              // a tent site's spacing along its loop
  PAD: { w: 5, d: 11, aisle: 5 }, // an RV pad and the drive between two rows of them
  KINDS: {
    golfcourse: { name: "Golf course" },
    campground: { name: "Campground" },
    rvpark: { name: "RV park" },
  },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dice = (state, ...keys) => hash01(state.seed, "outdoor", ...keys);
const seedOf = (state, ...keys) => Math.floor(dice(state, ...keys) * 4294967296) || 1;
/** @param {any} rng @param {number[]} r */
const R2 = (rng, r) => rng.int(r[0], r[1]);

// ======================================================================================
// The buildings' plans (buildingmaps.js assemble specs, front toward +y; the compound turns nothing: every front faces
// the access road). X and Y: a split across and front to back of [size, leaf] parts; a leaf is a room role with its
// name, its loot (type: combat.js AREAS) and its furnishing (lay: a shoplayout.js COMMERCIAL_STYLES style). as: the
// archetype a borrowed plan is laid out and dressed as (its BUILDINGS key: a ranger station's, a lodge's, a cabin's).
// ======================================================================================
const leaves = (list) => list.map(([s, r]) => [s, typeof r === "string" ? { role: r } : r]);
const X = (...parts) => ({ split: "x", parts: leaves(parts) });
const Y = (...parts) => ({ split: "y", parts: leaves(parts) });
const Rm = (role, o = {}) => ({ role, ...o });
const bldg = (bw, bh, program, o = {}) => ({ bw, bh, program, front: { width: 2 }, openDoors: 0.35, extraDoors: 0.15, storeys: 1, foot: "medium", ground: "town", ...o });
const back = (roles, chance = 0.8) => ({ side: "back", roles, chance, lock: 0.2 });
const side = (roles, chance = 0.6) => ({ side: "right", roles, chance, lock: 0.2 });
// A plan's footprint from its kind's REAL_SIZE row (o.vid: the variant's own row), else [w, d] metres here.
const foot = (rng, key, vid, w, d) => realFoot(rng, key, vid) || { bw: R2(rng, w), bh: R2(rng, d) };
const storeysOf = (rng, key, vid, n) => realStoreys(rng, key, "town", vid) || n;

const PRO = (o = {}) => Rm("sales", { name: "Pro shop", type: "proshop", lay: "clothesfront", hub: false, maxBoxes: 5, ...o });
const BAR = (name, o = {}) => Rm("dining", { name, type: "bar", lay: "barroom", maxBoxes: 4, ...o });
const KITCHEN = (name = "Kitchen") => Rm("kitchen", { name, lay: "galley" });
const LOCKERS = (name) => Rm("lockerroom", { name });

/** @type {Record<string, { name: string, as?: string, make: (rng: any, o?: any) => any }>} */
export const PLANS = {
  // ---------- golf ----------
  // A country club: the lobby between the dining room and the pro shop, the kitchen, the grill-room bar, the men's and
  // the women's locker rooms and the manager's office behind; upstairs the ballroom, the members' lounge, the board room.
  country: { name: "Clubhouse", make(rng, o = {}) {
    const { bw, bh } = foot(rng, "golfcourse", o.vid || "country", [34, 40], [20, 24]);
    return bldg(bw, bh, Y([Math.round(bh * 0.45), X(["*", Rm("dining", { name: "Dining room", type: "kitchen", lay: "dining" })], [7, Rm("lobby", { name: "Lobby", entry: true })], ["*", PRO()])], [2, Rm("corridor")],
      ["*", X([9, KITCHEN()], ["*", BAR("Grill room")], [7, LOCKERS("Men's locker room")], [7, LOCKERS("Women's locker room")], [5, Rm("office", { name: "Club manager's office", lay: "manager" })])]), {
      storeys: storeysOf(rng, "golfcourse", o.vid || "country", 2), foot: "large", stairs: { roles: ["lobby", "corridor"], n: 1 },
      upper: () => Y(["*", Rm("dining", { name: "Ballroom", type: "kitchen", lay: "dining" })], [2, Rm("corridor")], [7, X(["*", BAR("Members' lounge")], [8, Rm("office", { name: "Board room" })], [3, "restroom"])]),
      exits: [back(["kitchen"], 0.9), side(["lockerroom", "dining"], 0.7)],
    });
  } },
  // A municipal course's clubhouse: one storey, the grill room and the pro shop counter at the front, the snack-bar
  // kitchen, one locker room, the pro's office and a restroom behind.
  municipal: { name: "Clubhouse", make(rng, o = {}) {
    const { bw, bh } = foot(rng, "golfcourse", o.vid || "municipal", [24, 28], [14, 16]);
    return bldg(bw, bh, Y(["*", X(["*", Rm("dining", { name: "Grill room", type: "kitchen", lay: "diner", entry: true })], [9, PRO({ maxBoxes: 4 })])],
      [5, X([7, KITCHEN("Snack-bar kitchen")], ["*", LOCKERS("Locker room")], [5, Rm("office", { name: "Pro's office", lay: "manager" })], [3, "restroom"])]), {
      foot: "medium", exits: [back(["kitchen"], 0.85)],
    });
  } },
  // A resort's clubhouse: the lobby, the pro shop and the terrace restaurant at the front, the kitchen, the terrace bar,
  // the spa's two locker rooms; upstairs the banquet hall and golf suites.
  resort: { name: "Clubhouse", make(rng, o = {}) {
    const { bw, bh } = foot(rng, "golfcourse", o.vid || "resort", [40, 46], [22, 26]);
    return bldg(bw, bh, Y([Math.round(bh * 0.45), X(["*", PRO({ maxBoxes: 6 })], [8, Rm("lobby", { name: "Lobby", entry: true })], ["*", Rm("dining", { name: "Terrace restaurant", type: "kitchen", lay: "dining" })])], [2, Rm("corridor")],
      ["*", X([8, LOCKERS("Spa locker room")], [8, LOCKERS("Spa locker room")], ["*", BAR("Terrace bar")], [10, KITCHEN()], [5, Rm("office", { name: "Golf director's office", lay: "manager" })])]), {
      storeys: storeysOf(rng, "golfcourse", o.vid || "resort", 2), foot: "large", stairs: { roles: ["lobby", "corridor"], n: 1 },
      upper: () => Y(["*", Rm("dining", { name: "Banquet hall", type: "kitchen", lay: "dining" })], [2, Rm("corridor")], [7, X(["*", Rm("motelroom", { name: "Golf suite", type: "hotelroom" })], ["*", Rm("motelroom", { name: "Golf suite", type: "hotelroom" })], ["*", Rm("motelroom", { name: "Golf suite", type: "hotelroom" })], [3, "restroom"])]),
      exits: [back(["kitchen"], 0.9), side(["lockerroom"], 0.6)],
    });
  } },
  // A links clubhouse: an old stone house of two storeys, the bar (the nineteenth hole) at the front door and the pro
  // shop, the locker room, the secretary's office and the kitchen behind; upstairs the members' dining room, the
  // trophy room and the steward's flat.
  links: { name: "Clubhouse", make(rng, o = {}) {
    const { bw, bh } = foot(rng, "golfcourse", o.vid || "links", [26, 30], [16, 18]);
    return bldg(bw, bh, Y(["*", X(["*", BAR("Nineteenth hole", { entry: true })], [9, PRO({ maxBoxes: 4 })])], [2, Rm("corridor")],
      [6, X(["*", LOCKERS("Locker room")], [6, Rm("office", { name: "Secretary's office", lay: "manager" })], [7, KITCHEN()], [3, "restroom"])]), {
      storeys: storeysOf(rng, "golfcourse", o.vid || "links", 2), foot: "medium", stairs: { roles: ["corridor"], n: 1 },
      upper: () => Y(["*", Rm("dining", { name: "Members' dining room", type: "kitchen", lay: "dining" })], [2, Rm("corridor")], [6, X(["*", Rm("office", { name: "Trophy room", type: "proshop", maxBoxes: 2 })], ["*", Rm("apt", { name: "Steward's flat" })], [3, "restroom"])]),
      exits: [back(["kitchen", "lockerroom"], 0.85)],
    });
  } },
  // A driving range's shed: the ball shop at the counter, the snack counter, the ball room (the picker and the
  // dispensers) and a restroom.
  range: { name: "Range shed", make(rng, o = {}) {
    const { bw, bh } = foot(rng, "golfcourse", o.vid || "range", [18, 22], [9, 10]);
    return bldg(bw, bh, Y(["*", X(["*", PRO({ name: "Ball shop", lay: "aislefront", entry: true, hub: true, maxBoxes: 3 })], [7, Rm("kitchen", { name: "Snack counter", lay: "cafe", type: "kitchen" })])],
      [4, X(["*", Rm("storage", { name: "Ball room", type: "cartbarn", maxBoxes: 2 })], [3, "restroom"])]), {
      foot: "small", exits: [back(["storage"], 0.9)],
    });
  } },
  // A mini-golf office: the counter with its putters and balls, the snack bar, the office and a restroom.
  minigolf: { name: "Mini-golf office", make(rng, o = {}) {
    const { bw, bh } = foot(rng, "golfcourse", o.vid || "minigolf", [12, 14], [9, 10]);
    return bldg(bw, bh, Y(["*", X(["*", Rm("sales", { name: "Counter", type: "proshop", lay: "cornerstore", entry: true, hub: true, maxBoxes: 3 })], [6, Rm("kitchen", { name: "Snack bar", lay: "galley" })])],
      [4, X(["*", Rm("office", { name: "Office", lay: "manager" })], [3, "restroom"])]), {
      foot: "small", exits: [back(["office", "kitchen"], 0.7)],
    });
  } },
  // The cart barn: the carts' charging bays behind the roller door, the mechanic's shop and the parts room; its fuel
  // tank outside (golfGrounds).
  cartbarn: { name: "Cart barn", make(rng) {
    const bw = rng.int(20, 26), bh = rng.int(12, 14);
    return bldg(bw, bh, X(["*", Rm("bays", { name: "Cart bays", type: "cartbarn", entry: true, maxBoxes: 4 })], [8, Y(["*", Rm("workshop", { name: "Mechanic's shop", type: "cartbarn" })], [5, Rm("parts", { name: "Parts room", type: "cartbarn" })])]), {
      foot: "medium", ground: "town", exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.2, name: "Barn door" }, back(["workshop", "parts"], 0.6)],
    });
  } },
  // The maintenance shed: the equipment bay (the mowers, the tractor) behind its roller door, the workshop and the
  // chemical store, the superintendent's office.
  maintshed: { name: "Maintenance shed", make(rng) {
    const bw = rng.int(22, 26), bh = rng.int(12, 14);
    return bldg(bw, bh, X(["*", Rm("bays", { name: "Equipment bay", type: "workshop", entry: true, maxBoxes: 4 })], [8, Y(["*", Rm("workshop", { name: "Workshop" })], [5, Rm("storage", { name: "Chemical store", type: "garage" })])], [5, Rm("office", { name: "Superintendent's office" })]), {
      foot: "medium", exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.25, name: "Bay door" }, back(["storage", "workshop"], 0.5)],
    });
  } },
  // The starter's hut by the first tee: one room, the tee sheet and a cooler.
  starter: { name: "Starter's hut", make(rng) {
    return bldg(rng.int(6, 7), rng.int(5, 6), Rm("office", { name: "Starter's hut", type: "proshop", entry: true, hub: true, maxBoxes: 2 }), { foot: "small", front: { width: 1 }, exits: [] });
  } },
  // A pool house: the changing rooms and the pump room.
  poolhouse: { name: "Pool house", make(rng) {
    return bldg(rng.int(12, 14), rng.int(8, 9), X(["*", LOCKERS("Changing rooms")], [5, Rm("storage", { name: "Pump room", type: "garage", maxBoxes: 2 })]), { foot: "small", exits: [back(["storage"], 0.5)] });
  } },
  // ---------- campgrounds ----------
  // The ranger station's own plans (buildvariants.js LAYOUTS.ranger, buildingmaps.js HOME_PLANS.ranger): the campground
  // office (the camp store, the staff kitchen, the coin laundry, the showers), the entrance station's fee booth, the
  // visitor centre, the field station.
  campoffice: { name: "Campground office", as: "ranger", make: (rng) => BUILDINGS.ranger.make(rng, { layout: "campground" }) },
  entrance: { name: "Entrance station", as: "ranger", make: (rng) => BUILDINGS.ranger.make(rng, { layout: "entrance" }) },
  visitor: { name: "Visitor centre", as: "ranger", make: (rng) => BUILDINGS.ranger.make(rng, { layout: "visitor" }) },
  ranger: { name: "Ranger station", as: "ranger", make: (rng) => BUILDINGS.ranger.make(rng, { layout: "field" }) },
  // The lodges (buildvariants.js LAYOUTS.lodge): the camp lodge's dining hall (a scout camp's mess hall), the scout lodge
  // (the meeting hall, the craft room, the camp store), the retreat lodge (a glamping resort's reception), the hunting lodge.
  messhall: { name: "Mess hall", as: "lodge", make: (rng) => BUILDINGS.lodge.make(rng, { layout: "camp" }) },
  craftlodge: { name: "Craft lodge", as: "lodge", make: (rng) => BUILDINGS.lodge.make(rng, { layout: "scout" }) },
  reception: { name: "Reception lodge", as: "lodge", make: (rng) => BUILDINGS.lodge.make(rng, { layout: "retreat" }) },
  huntlodge: { name: "Hunting lodge", as: "lodge", make: (rng) => BUILDINGS.lodge.make(rng, { layout: "hunting" }) },
  // The cabins (buildvariants.js LAYOUTS.cabin): a bunkhouse cabin, a two-room cabin, a cabin with a sleeping porch, a
  // trapper's lean-to (a trail shelter), a yurt (a two-room cabin under canvas).
  bunkcabin: { name: "Cabin", as: "cabin", make: (rng) => BUILDINGS.cabin.make(rng, { layout: "bunkhouse" }) },
  cabin: { name: "Cabin", as: "cabin", make: (rng) => BUILDINGS.cabin.make(rng, { layout: rng.chance(0.5) ? "tworoom" : "porch" }) },
  shelter: { name: "Trail shelter", as: "cabin", make: (rng) => BUILDINGS.cabin.make(rng, { layout: "hunting" }) },
  yurt: { name: "Yurt", as: "cabin", make: (rng) => BUILDINGS.cabin.make(rng, { layout: "tworoom" }) },
  // A bathhouse: the men's and the women's showers and the utility closet.
  bathhouse: { name: "Bathhouse", make(rng, o = {}) {
    const { bw, bh } = foot(rng, "campground", o.vid || "statepark", [12, 14], [8, 9]);
    return bldg(bw, bh, X(["*", LOCKERS("Men's showers")], ["*", LOCKERS("Women's showers")], [3, Rm("storage", { name: "Utility closet", type: "bathhouse", maxBoxes: 1 })]), {
      foot: "small", front: { width: 1 }, exits: [side(["lockerroom"], 0.9)],
    });
  } },
  // A vault toilet: one room.
  toilet: { name: "Vault toilet", make(rng) {
    return bldg(rng.int(5, 6), rng.int(4, 5), Rm("restroom", { name: "Vault toilet", type: "bathhouse", entry: true, hub: true, maxBoxes: 1, label: true }), { foot: "small", front: { width: 1 }, exits: [] });
  } },
  // A lake's bait and tackle shop: the shop floor and the stockroom.
  baitshop: { name: "Bait and tackle", make(rng) {
    return bldg(rng.int(14, 16), rng.int(10, 11), Y(["*", Rm("sales", { name: "Bait and tackle", type: "campstore", lay: "aislefront", entry: true, maxBoxes: 4 })], [4, X(["*", Rm("stock", { name: "Stockroom", type: "campstore" })], [3, "restroom"])]), {
      foot: "small", exits: [back(["stock"], 0.7)],
    });
  } },
  // A boat shed: the canoes and the paddles.
  boatshed: { name: "Boat shed", make(rng) {
    return bldg(rng.int(12, 14), rng.int(8, 9), X(["*", Rm("bays", { name: "Boat shed", type: "garage", entry: true, maxBoxes: 2 })], [5, Rm("storage", { name: "Paddle store", type: "campstore", maxBoxes: 2 })]), {
      foot: "small", exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.2, name: "Shed door" }],
    });
  } },
  // A camp's nurse's cabin: first aid on hand.
  nurse: { name: "Nurse's cabin", make(rng) {
    return bldg(rng.int(8, 9), rng.int(7, 8), Y(["*", Rm("nurse", { name: "Camp nurse", entry: true, hub: true })], [3, X(["*", Rm("bunk", { name: "Sick bay" })], [3, "restroom"])]), { foot: "small", front: { width: 1 }, exits: [] });
  } },
  // A hunters' camp's skinning shed.
  skinshed: { name: "Skinning shed", make(rng) {
    return bldg(rng.int(8, 10), rng.int(7, 8), Rm("workshop", { name: "Skinning shed", type: "cabin", entry: true, hub: true, maxBoxes: 3 }), { foot: "small", ground: "woods", exits: [] });
  } },
  // ---------- RV parks ----------
  // The park office: the front desk and the park store, the manager's office, the store room and a restroom.
  rvoffice: { name: "Park office", make(rng, o = {}) {
    const { bw, bh } = foot(rng, "rvpark", o.vid || "highway", [16, 20], [10, 12]);
    return bldg(bw, bh, Y(["*", X(["*", Rm("reception", { name: "Front desk", entry: true })], [8, Rm("sales", { name: "Park store", type: "campstore", lay: "aislefront", hub: false, maxBoxes: 4 })])],
      [4, X([6, Rm("office", { name: "Manager's office", lay: "manager" })], ["*", Rm("stock", { name: "Store room", type: "campstore" })], [3, "restroom"])]), {
      foot: "medium", exits: [back(["stock", "office"], 0.7)],
    });
  } },
  // The laundry and showers: the coin laundry and the two shower rooms.
  laundry: { name: "Laundry and showers", make(rng) {
    return bldg(rng.int(12, 14), rng.int(9, 10), Y(["*", Rm("storage", { name: "Coin laundry", type: "coinlaundry", lay: "laundry", entry: true, hub: true, maxBoxes: 3 })], [4, X(["*", LOCKERS("Showers")], ["*", LOCKERS("Showers")])]), {
      foot: "small", exits: [side(["lockerroom"], 0.6)],
    });
  } },
  // The rec hall: the hall, its kitchen, the card room and a restroom.
  rechall: { name: "Rec hall", make(rng) {
    return bldg(rng.int(22, 26), rng.int(13, 15), Y(["*", Rm("dayroom", { name: "Rec hall", entry: true })], [5, X([8, KITCHEN("Hall kitchen")], ["*", Rm("office", { name: "Card room", type: "house" })], [3, "restroom"])]), {
      foot: "medium", exits: [back(["kitchen"], 0.8)],
    });
  } },
  // A mobile home (buildvariants.js house "mobile"), a crew office trailer (one room and the plans table).
  mobile: { name: "Mobile home", as: "house", make: (rng) => BUILDINGS.house.make(rng, { layout: "mobile" }) },
  crewoffice: { name: "Crew office", make(rng) {
    return bldg(rng.int(12, 14), rng.int(5, 6), X(["*", Rm("office", { name: "Crew office", entry: true, hub: true })], [4, Rm("office", { name: "Site manager" })]), { foot: "small", front: { width: 1 }, exits: [] });
  } },
};
// The plan keys of the buildings with a bar (the scene below): the clubhouses.
const CLUBHOUSES = new Set(["country", "municipal", "resort", "links"]);

// ======================================================================================
// The variants (a dozen and more a kind): the buildings (b: [plan, count range]), the map ([[w], [h]]), the ground,
// the road, a lot, the ways out (ways: 2–5), water (north: a lake, river: a river along the north edge), and the
// grounds' own (golf, camp, rv). sizeClass: the placement table's size it stands as (#42); w: its weight by setting
// and tile class (#41); foot: its main building's footprint (the gallery's).
// ======================================================================================
const B = (p, a = 1, b = a) => [p, a, b];
const V = (id, name, sizeClass, w, def) => ({ id, name, sizeClass, w, ...def });
export const GOLF_VARIANTS = registerVariants("golfcourse", [
  V("country", "Country club", "large", { suburb: 2, town: 1, any: 1 }, { b: [B("country"), B("cartbarn"), B("maintshed"), B("starter"), B("poolhouse")], map: [[220, 280], [200, 260]], lot: true, ways: 4, golf: { holes: [5, 9], ponds: 0.35, sand: 3, trees: 0.35, carts: 0.5 }, pool: true }),
  V("municipal", "Municipal course", "medium", { town: 2, city: 1.5, any: 1 }, { b: [B("municipal"), B("cartbarn"), B("maintshed"), B("starter")], map: [[200, 250], [180, 240]], lot: true, ways: 3, golf: { holes: [5, 9], ponds: 0.2, sand: 2, trees: 0.25, carts: 0.35 } }),
  V("resort", "Resort clubhouse", "large", { coast: 2, scenic: 1.5, any: 1 }, { b: [B("resort"), B("cartbarn"), B("maintshed"), B("starter"), B("poolhouse")], map: [[240, 300], [220, 280]], lot: true, ways: 4, water: "north", golf: { holes: [6, 9], ponds: 0.4, sand: 3, trees: 0.3, carts: 0.6 }, pool: true }),
  V("links", "Links clubhouse", "medium", { coast: 3, any: 0.6 }, { b: [B("links"), B("maintshed"), B("starter")], map: [[200, 260], [180, 240]], ways: 3, ground: "field", water: "north", golf: { holes: [5, 8], ponds: 0, sand: 6, trees: 0.03, carts: 0.25, dunes: true } }),
  V("range", "Driving range", "small", { highway: 2, suburb: 1.5, any: 1 }, { b: [B("range"), B("maintshed")], map: [[120, 150], [110, 140]], lot: true, ways: 2, golf: { holes: [0, 0], range: true, rangeOnly: true } }),
  V("minigolf", "Mini-golf and range", "small", { highway: 1.5, suburb: 1.5, town: 1.5, any: 1 }, { b: [B("minigolf"), B("range")], map: [[120, 150], [110, 140]], lot: true, ways: 2, golf: { holes: [0, 0], range: true, mini: true } }),
  V("par3", "Par-3 course", "small", { town: 1.5, any: 1 }, { b: [B("municipal"), B("starter")], map: [[130, 170], [120, 160]], ways: 2, golf: { holes: [3, 6], short: true, ponds: 0.25, sand: 1, trees: 0.25, carts: 0.15 } }),
  V("executive", "Executive nine", "medium", { suburb: 1.5, town: 1, any: 1 }, { b: [B("municipal"), B("cartbarn"), B("starter")], map: [[170, 220], [160, 210]], lot: true, ways: 3, golf: { holes: [4, 7], ponds: 0.3, sand: 2, trees: 0.3, carts: 0.4 } }),
  V("prairie", "Prairie course", "medium", { rural: 2, highway: 1, any: 0.8 }, { b: [B("municipal"), B("maintshed"), B("cartbarn")], map: [[200, 260], [180, 240]], ways: 3, ground: "field", golf: { holes: [5, 8], ponds: 0.1, sand: 4, trees: 0.06, carts: 0.3 } }),
  V("parkland", "Parkland club", "large", { suburb: 1.5, scenic: 1.5, any: 1 }, { b: [B("country"), B("cartbarn"), B("maintshed"), B("starter")], map: [[230, 290], [210, 270]], lot: true, ways: 5, golf: { holes: [6, 9], ponds: 0.45, sand: 2, trees: 0.6, carts: 0.45 } }),
  V("private", "Old private club", "large", { suburb: 1.5, town: 1, any: 0.8 }, { b: [B("links"), B("cartbarn"), B("maintshed"), B("starter"), B("poolhouse")], map: [[220, 280], [200, 260]], lot: true, ways: 3, golf: { holes: [5, 9], ponds: 0.3, sand: 3, trees: 0.45, carts: 0.4 }, pool: true }),
  V("lakeside", "Lakeside golf club", "large", { coast: 3, any: 0.7 }, { b: [B("resort"), B("cartbarn"), B("maintshed"), B("starter")], map: [[230, 290], [220, 280]], lot: true, ways: 3, water: "north", launch: true, golf: { holes: [5, 8], ponds: 0.5, sand: 2, trees: 0.35, carts: 0.5 } }),
].map((e) => ({ ...e, foot: footOf("golfcourse", e) })));
export const CAMP_VARIANTS = registerVariants("campground", [
  V("statepark", "State park campground", "large", { scenic: 1.5, coast: 1.5, any: 1 }, { b: [B("entrance"), B("campoffice"), B("bathhouse", 1, 2)], map: [[200, 260], [180, 240]], ways: 3, road: "road", camp: { loops: 2, sites: [24, 40], tent: 0.55, car: 0.45, rv: 0.12, pavilion: true } }),
  V("primitive", "Primitive campsite", "medium", { scenic: 2, any: 1 }, { b: [B("toilet")], map: [[110, 140], [100, 130]], ways: 2, road: "dirt", ground: "dirt", trees: 0.05, camp: { loops: 1, sites: [6, 12], tent: 0.6, car: 0.2, rv: 0, nopad: true } }),
  V("scout", "Scout camp", "large", { scenic: 2, any: 1 }, { b: [B("messhall"), B("craftlodge"), B("nurse"), B("bathhouse"), B("bunkcabin", 3, 6)], map: [[200, 260], [180, 240]], ways: 3, road: "gravel", trees: 0.02, camp: { loops: 1, sites: [8, 14], tent: 0.8, car: 0.1, rv: 0, field: [8, 16], pavilion: true } }),
  V("group", "Group camp", "large", { scenic: 1.5, rural: 1, any: 1 }, { b: [B("messhall"), B("bathhouse"), B("bunkcabin", 2, 4)], map: [[180, 230], [160, 210]], ways: 3, road: "gravel", camp: { loops: 1, sites: [6, 10], tent: 0.6, car: 0.3, rv: 0.05, field: [10, 20], pavilion: true } }),
  V("glamping", "Glamping resort", "large", { scenic: 1.5, coast: 1.5, any: 0.8 }, { b: [B("reception"), B("bathhouse"), B("yurt", 3, 6), B("poolhouse")], map: [[200, 250], [180, 230]], lot: true, ways: 3, road: "road", camp: { loops: 1, sites: [8, 16], tent: 1, big: true, car: 0.35, rv: 0, pavilion: true }, pool: true }),
  V("lake", "Lake campground", "large", { coast: 3, any: 0.5 }, { b: [B("campoffice"), B("baitshop"), B("bathhouse")], map: [[200, 260], [200, 260]], ways: 2, road: "gravel", water: "north", launch: true, camp: { loops: 1, sites: [16, 28], tent: 0.5, car: 0.45, rv: 0.15 } }),
  V("forest", "Forest service campground", "medium", { scenic: 2.5, any: 1 }, { b: [B("ranger"), B("toilet", 1, 2)], map: [[150, 190], [140, 180]], ways: 2, road: "gravel", trees: 0.06, camp: { loops: 1, sites: [10, 18], tent: 0.55, car: 0.4, rv: 0.1 } }),
  V("riverside", "Riverside campground", "medium", { coast: 2.5, any: 0.8 }, { b: [B("campoffice"), B("boatshed"), B("bathhouse")], map: [[170, 220], [160, 210]], ways: 2, road: "gravel", water: "river", launch: true, camp: { loops: 1, sites: [12, 20], tent: 0.55, car: 0.4, rv: 0.1 } }),
  V("hikers", "Backpackers' camp", "medium", { scenic: 2.5, any: 0.8 }, { b: [B("visitor"), B("toilet"), B("shelter", 2, 3)], map: [[130, 170], [120, 160]], ways: 3, road: "dirt", ground: "dirt", trees: 0.06, camp: { loops: 1, sites: [8, 14], tent: 0.75, car: 0.05, rv: 0, nopad: true } }),
  V("youth", "Summer youth camp", "medium", { scenic: 1.5, coast: 1.5, any: 1 }, { b: [B("messhall"), B("nurse"), B("bathhouse"), B("cabin", 4, 6)], map: [[180, 230], [160, 210]], ways: 2, road: "gravel", water: "north", launch: true, camp: { loops: 0, sites: [0, 0], field: [6, 12], pavilion: true } }),
  V("family", "Family campground", "large", { highway: 1.5, rural: 1.5, any: 1 }, { b: [B("campoffice"), B("bathhouse"), B("cabin", 2, 4), B("poolhouse")], map: [[200, 250], [180, 230]], lot: true, ways: 3, road: "road", camp: { loops: 2, sites: [20, 34], tent: 0.4, car: 0.5, rv: 0.3, pavilion: true }, pool: true }),
  V("hunters", "Hunters' camp", "medium", { scenic: 2, rural: 1, any: 0.8 }, { b: [B("huntlodge"), B("skinshed"), B("cabin", 1, 3)], map: [[140, 180], [130, 170]], ways: 2, road: "dirt", ground: "dirt", trees: 0.05, camp: { loops: 1, sites: [6, 12], tent: 0.65, car: 0.45, rv: 0.1 } }),
].map((e) => ({ ...e, foot: footOf("campground", e) })));
export const RV_VARIANTS = registerVariants("rvpark", [
  V("highway", "Highway RV park", "medium", { highway: 3, any: 1 }, { b: [B("rvoffice"), B("laundry")], map: [[170, 220], [150, 200]], ways: 2, road: "road", rv: { rows: [2, 4], full: 0.55, big: 0.45, dump: true, surface: "gravel" }, pool: true }),
  V("resort", "Resort RV park", "large", { scenic: 1.5, coast: 1.5, any: 1 }, { b: [B("rvoffice"), B("rechall"), B("laundry"), B("poolhouse")], map: [[210, 260], [190, 240]], lot: true, ways: 3, road: "road", rv: { rows: [3, 5], full: 0.6, big: 0.6, dump: true, court: true, surface: "road" }, pool: true }),
  V("mobilemix", "Mobile home and RV park", "large", { town: 2, highway: 1.5, rural: 1.5, any: 1 }, { b: [B("rvoffice"), B("laundry"), B("mobile", 4, 7)], map: [[200, 260], [170, 220]], ways: 3, road: "gravel", rv: { rows: [2, 3], full: 0.65, big: 0.35, dump: true, surface: "gravel" } }),
  V("boondock", "Desert boondocking lot", "small", { rural: 2, highway: 1, any: 1 }, { b: [B("toilet")], map: [[130, 170], [120, 160]], ways: 3, road: "dirt", ground: "dirt", trees: 0, rv: { scatter: [8, 16], full: 1, big: 0.5 } }),
  V("lakeside", "Lakeside RV resort", "large", { coast: 3, any: 0.6 }, { b: [B("rvoffice"), B("baitshop"), B("laundry")], map: [[210, 260], [210, 260]], ways: 2, road: "road", water: "north", launch: true, rv: { rows: [2, 4], full: 0.6, big: 0.5, dump: true, surface: "gravel" } }),
  V("overnight", "Overnight RV stop", "small", { highway: 3, any: 0.8 }, { b: [B("rvoffice")], map: [[120, 150], [110, 140]], ways: 2, road: "road", rv: { rows: [1, 2], full: 0.5, big: 0.5, dump: true, surface: "road" } }),
  V("snowbird", "Snowbird park", "large", { rural: 1.5, town: 1.5, any: 1 }, { b: [B("rvoffice"), B("rechall"), B("laundry")], map: [[200, 250], [180, 230]], ways: 3, road: "road", rv: { rows: [3, 5], full: 0.75, big: 0.5, court: true, surface: "road" }, pool: true }),
  V("workcamp", "Work camp", "small", { rural: 2, highway: 1.5, any: 1 }, { b: [B("crewoffice"), B("laundry")], map: [[130, 170], [120, 160]], ways: 2, road: "gravel", ground: "dirt", rv: { rows: [1, 3], full: 0.8, big: 0.25, fuel: true, surface: "gravel" } }),
  V("trailercourt", "Old trailer court", "medium", { town: 2, highway: 1.5, any: 1 }, { b: [B("rvoffice"), B("laundry"), B("mobile", 1, 3)], map: [[150, 190], [140, 180]], ways: 2, road: "gravel", rv: { rows: [2, 3], full: 0.6, big: 0.2, surface: "gravel" } }),
  V("pines", "RV park in the pines", "medium", { scenic: 3, any: 0.8 }, { b: [B("rvoffice"), B("laundry")], map: [[170, 220], [160, 210]], ways: 2, road: "gravel", trees: 0.05, rv: { rows: [2, 3], full: 0.5, big: 0.45, dump: true, surface: "gravel" } }),
  V("riverside", "Riverside RV park", "medium", { coast: 2.5, any: 0.8 }, { b: [B("rvoffice"), B("laundry")], map: [[170, 220], [170, 220]], ways: 2, road: "gravel", water: "river", launch: true, rv: { rows: [2, 3], full: 0.55, big: 0.4, dump: true, surface: "gravel" } }),
  V("luxury", "Motorcoach resort", "large", { suburb: 2, coast: 1.5, any: 0.8 }, { b: [B("rvoffice"), B("rechall"), B("poolhouse"), B("laundry")], map: [[220, 270], [200, 250]], lot: true, ways: 3, road: "road", rv: { rows: [3, 4], full: 0.55, big: 0.95, court: true, surface: "road" }, pool: true }),
].map((e) => ({ ...e, foot: footOf("rvpark", e) })));
const VARIANTS = { golfcourse: GOLF_VARIANTS, campground: CAMP_VARIANTS, rvpark: RV_VARIANTS };
// A variant's main building's usual footprint (variantpick.js foot: the gallery's; its size class is its own sizeClass):
// its REAL_SIZE row (data-buildingsize.js golfcourse, campground, rvpark: a sizes row per variant).
function footOf(kind, e) {
  const rng = new Rng(7919), f = realFoot(rng, kind, e.id);
  return f ? [f.bw, f.bh, realStoreys(rng, kind, "town", e.id) || 1] : [12, 10, 1];
}

// ======================================================================================
// The pick and the plan
// ======================================================================================
/** Is this BUILDINGS key one of this module's places? @param {string} key */
export const isOutdoor = (key) => !!OUTDOOR.KINDS[key];
/**
 * The variant a place takes: option.layout or option.plan (an id) pinned; else the shared picker on the tile's class,
 * setting and the placement table's size (option.setting, a pinned setting: the tests', with no size).
 * @param {any} state @param {number} tileId @param {{ id: string, key: string, layout?: string | null, plan?: any, setting?: string }} option
 */
export function outdoorVariant(state, tileId, option) {
  const key = option.key, tile = state.tiles ? state.tiles[tileId] : null;
  const ctx = option.setting ? { setting: option.setting } : tile ? placementCtx(state, tile, key) : {};
  const pin = option.layout || (typeof option.plan === "string" ? option.plan : null);
  return /** @type {any} */ (pickVariant(key, null, { ...ctx, plan: pin, r: dice(state, "variant", key, tileId, option.id) })) || VARIANTS[key][0];
}
// The plan without its map: the variant, its buildings (each from its own dice) and the map's dice.
function outdoorPlan(state, tileId, option) {
  const key = option.key, Vr = outdoorVariant(state, tileId, option);
  const rng = new Rng(seedOf(state, "map", key, tileId, option.id));
  const list = [];
  for (const [p, a, b] of Vr.b) { const n = rng.int(a, b); for (let i = 0; i < n; i++) list.push(p); }
  const named = {};
  const built = list.map((p, k) => {
    const id = `${option.id}#${k + 1}`;
    const hr = new Rng(seedOf(state, "bldg", key, tileId, id));
    const spec = PLANS[p].make(hr, k === 0 ? { vid: Vr.id } : {}); // the main building's size the variant's row (REAL_SIZE sizes)
    spec.margins = { front: 1, back: 1, left: 1, right: 1 };
    spec.ground = "none";
    const base = PLANS[p].name;
    named[base] = (named[base] || 0) + 1;
    return { k, p, as: PLANS[p].as || p, id, hr, spec, bw: spec.bw, bh: spec.bh, name: base, n: named[base], x0: 0, y0: 0, gap: 0, row: 0, m: /** @type {any} */ (null), part: /** @type {any} */ (null) };
  });
  for (const Bd of built) if (named[Bd.name] > 1) Bd.name = `${Bd.name} ${Bd.n}`;
  return { key, Vr, rng, built };
}

// ======================================================================================
// The map
// ======================================================================================
/**
 * The map of a golf course, a campground or an RV park (buildingmaps.js buildingMap, for BUILDINGS golfcourse,
 * campground and rvpark): the same every visit (its dice from the world seed, the tile and the option id).
 * @param {State} state @param {number} tileId @param {{ id: string, key: string, name: string, layout?: string, plan?: any, setting?: string }} option @param {any} withVehicle
 */
export function outdoorMap(state, tileId, option, withVehicle) {
  const O = OUTDOOR, { key, Vr, rng, built } = outdoorPlan(state, tileId, option);
  // ---------- the buildings, each its own plan and map, its signs of survival on it (copied in with it) ----------
  for (const Bd of built) {
    Bd.m = assemble(Bd.hr, Bd.spec, { key: Bd.as, id: Bd.id, name: Bd.name });
    rollScenes(Bd.m, sceneRng(state, tileId, { id: Bd.id }), Bd.as);
  }
  // ---------- the size: the rows of buildings along the road, the grounds behind ----------
  const avail = (W) => W - 2 * O.EDGE - 4;
  let W = clamp(R2(rng, Vr.map[0]), 80, O.CAP);
  const widest = Math.max(...built.map((Bd) => Bd.bw)) + 2 * O.EDGE + 4;
  W = clamp(Math.max(W, widest), 80, O.CAP);
  /** @type {any[][]} */
  const rows = [[]];
  let used = 0;
  for (const Bd of built) {
    const gap = R2(rng, O.GAP);
    if (rows[rows.length - 1].length && used + gap + Bd.bw > avail(W)) { rows.push([]); used = 0; }
    const row = rows[rows.length - 1];
    if (row.length) used += gap;
    Bd.gap = row.length ? gap : 0;
    row.push(Bd); used += Bd.bw;
  }
  const depth = (row) => Math.max(...row.map((Bd) => Bd.bh));
  const rowsD = rows.reduce((a, r) => a + depth(r), 0) + (rows.length - 1) * O.ROWGAP;
  const front = Vr.lot ? O.LOT : O.APRON;
  const need = 2 * O.EDGE + O.MIN_GROUNDS + O.BACK + rowsD + O.FRONT + front + O.ROAD + 2 + (Vr.water ? 38 : 0);
  const H = clamp(Math.max(R2(rng, Vr.map[1]), need), 80, O.CAP);
  const storeys = Math.max(1, ...built.map((Bd) => Bd.m.storeys || 1));
  const ground = Vr.ground || "grass";
  const C = compoundGrid(W, H, storeys, () => ground);
  const cells = C.cells, keep = C.keep, I = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const paint = (x0, y0, w, h, f, mark = true) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (inside(x, y)) { cells[I(x, y)].f = f; if (mark) keep[I(x, y)] = 1; } };
  const roadF = Vr.road || "road", walkF = roadF === "dirt" ? "dirt" : "gravel";
  const roadY = H - O.ROAD - 2;
  paint(0, roadY, W, O.ROAD, roadF);
  const foreY = roadY - front; // the forecourt (or the lot) between the road and the buildings
  paint(O.EDGE, foreY, W - 2 * O.EDGE, front, walkF, !Vr.lot);
  // The rows, the first by the forecourt, each further one behind it with a path along its fronts.
  let rowFront = foreY - O.FRONT;
  const rowTops = [];
  rows.forEach((row, ri) => {
    const D = depth(row), extra = Math.max(0, avail(W) - row.reduce((a, Bd) => a + Bd.bw + Bd.gap, 0));
    let x = O.EDGE + 2 + Math.floor(extra / 2);
    for (const Bd of row) { x += Bd.gap; Bd.x0 = x; Bd.y0 = rowFront - Bd.bh; x += Bd.bw; Bd.row = ri; }
    if (ri > 0) paint(O.EDGE, rowFront + 1, W - 2 * O.EDGE, 2, walkF); // the path along this row's fronts
    rowTops.push(rowFront - D);
    rowFront = rowFront - D - O.ROWGAP;
  });
  const groundsY1 = Math.min(...rowTops) - O.BACK - 1;
  // ---------- water along the north edge (a lake or a river), before the buildings ----------
  let waterY = 0;
  if (Vr.water) {
    const deep = Vr.water === "river" ? rng.int(8, 12) : rng.int(22, 34), wob = rng.next() * 6;
    for (let x = 0; x < W; x++) {
      const d = Math.round(deep + 3 * Math.sin(x / 17 + wob) + 2 * Math.sin(x / 7 + wob * 2));
      for (let y = 0; y < d && y < H; y++) { const c = cells[I(x, y)]; c.k = "water"; c.f = "grass"; keep[I(x, y)] = 1; }
      for (let y = d; y < d + 2 && y < H; y++) cells[I(x, y)].f = Vr.water === "river" ? "gravel" : "sand"; // the bank, the beach
      waterY = Math.max(waterY, d + 2);
    }
  }
  // ---------- the buildings copied in (compound.js placeBuilding: rooms, containers, doors, runs; c.house) ----------
  const sceneList = [], sceneBodies = [], scenePiles = [], scenePieces = [];
  for (const Bd of built) {
    const m = Bd.m, Rb = m.building;
    const part = placeBuilding(C, m, { x0: Bd.x0, y0: Bd.y0, face: "s", k: Bd.k, name: Bd.name, key: Bd.p });
    Bd.part = part;
    const S = m.scenes;
    if (S) {
      const tx = (x) => Bd.x0 + (x - Rb.x0), ty = (y) => Bd.y0 + (y - Rb.y0);
      const ids = new Map(m.rooms.filter((a) => !a.outdoor).map((a, j) => [a.id, part.rooms[j]]));
      for (const sc of S.list) sceneList.push({ ...sc, x: tx(sc.x), y: ty(sc.y), room: sc.room == null ? null : ids.get(sc.room) ?? null, house: Bd.k });
      for (const o of S.bodies) sceneBodies.push({ ...o, x: tx(o.x), y: ty(o.y) });
      for (const q of S.piles) scenePiles.push({ ...q, x: tx(q.x), y: ty(q.y), area: q.area == null ? null : ids.get(q.area) ?? null });
      for (const q of S.pieces) scenePieces.push({ ...q, x: tx(q.x), y: ty(q.y) });
    }
    // A path from its front door (and a roller door's drive) to the forecourt or the row's path.
    const stop = Bd.row === 0 ? foreY : Bd.y0 + Bd.bh + 2;
    const toFore = (x, y) => { for (let q = y + 1; q < stop && inside(x, q); q++) { keep[I(x, q)] = 1; if (cells[I(x, q)].k === "open") cells[I(x, q)].f = walkF; } };
    for (const [x, y] of (part.front && part.front.cells) || []) toFore(x, y);
    for (const ex of part.exits) if (ex.side === "s") for (const [x, y] of ex.cells) toFore(x, y);
  }
  // ---------- the ways out (kept clear before anything is dressed) ----------
  const Z = 3, zy = roadY + 1;
  const zones = [
    { x0: 0, y0: zy, w: Z, h: Z, side: "west", exit: "west", name: "West end of the road", vehicle: false },
    { x0: W - Z, y0: zy, w: Z, h: Z, side: "east", exit: "east", name: "East end of the road", vehicle: false },
  ];
  const more = [];
  if (!Vr.water) more.push({ x0: Math.floor(W / 2) - 1, y0: 0, w: Z, h: Z, side: "north", exit: "north", name: "North edge of the grounds", vehicle: false });
  const midY = Math.max(waterY + 4, Math.floor((waterY + groundsY1) / 2));
  more.push({ x0: 0, y0: midY, w: Z, h: Z, side: "west", exit: "west", name: "West edge of the grounds", vehicle: false });
  more.push({ x0: W - Z, y0: midY, w: Z, h: Z, side: "east", exit: "east", name: "East edge of the grounds", vehicle: false });
  for (const z of more.slice(0, Math.max(0, (Vr.ways || 2) - 2))) zones.push(z);
  for (const z of zones) for (let q = z.y0 - 1; q <= z.y0 + z.h; q++) for (let p = z.x0 - 1; p <= z.x0 + z.w; p++) if (inside(p, q)) { keep[I(p, q)] = 1; const c = cells[I(p, q)]; if (c.k === "water") { c.k = "open"; c.f = "sand"; } }
  // ---------- the grounds ----------
  const G = guard(C, 1, roadY + 2);
  /** @type {any[]} */ const grounds = [];
  const S = { holes: 0, carts: 0, sites: 0, tents: 0, pads: 0, rvs: 0, cars: 0, pool: false, launch: false, range: false, mini: false, pavilion: false, dump: false, court: false, field: false, lake: Vr.water || null };
  const Gr = { x0: O.EDGE, y0: Math.max(O.EDGE, waterY + 3), x1: W - O.EDGE - 1, y1: groundsY1 };
  const K = { C, G, rng, cells, keep, I, inside, paint, W, H, grounds, S, Vr, walkF, roadF, areas: {} };
  const lots = [];
  if (Vr.lot) {
    const r = { x0: O.EDGE + 2, y0: foreY, w: Math.min(W - 2 * O.EDGE - 4, 90), h: front };
    const lot = parkingLot(C, G, r, rng, { name: "Parking lot", parked: 0.35 });
    if (lot) { lots.push(lot); grounds.push({ kind: "lot", name: lot.name, x0: r.x0, y0: r.y0, w: r.w, h: r.h }); }
  }
  if (Vr.pool) pool(K, Gr); // first: its spot kept from the pads, the sites and the fairways
  if (key === "golfcourse") golfGrounds(K, Gr, built);
  else if (key === "campground") campGrounds(K, Gr);
  else rvGrounds(K, Gr);
  if (Vr.launch && Vr.water) launch(K, waterY);
  // The trees and bushes in the rough and round the edges (never on a path, a pad or a way in).
  const nT = Math.round(W * H * (Vr.trees ?? (key === "golfcourse" ? 0 : 0.02)) * 0.5);
  for (let t = 0, n = 0; t < nT * 4 && n < nT; t++) {
    const x = rng.int(1, W - 2), y = rng.int(1, roadY - 2), c = cells[I(x, y)];
    if (c.k === "open" && (c.f === ground || c.f === "grass") && !keep[I(x, y)] && !C.built[I(x, y)] && G.block(x, y, rng.chance(0.7) ? "tree" : "bush")) n++;
  }
  // ---------- the result (compound.js compoundResult: streetMap's shape; plan.houses are the buildings) ----------
  const vehicle = compoundVehicle(C, zones[0], withVehicle);
  const scenes = sceneList.length ? { list: sceneList.map((sc, i) => ({ ...sc, id: i + 1 })), bodies: sceneBodies, piles: scenePiles, pieces: scenePieces, seed: (seedOf(state, "scenebattle", key, tileId, option.id) % 2147483646) + 1 } : null;
  const map = compoundResult(C, { key, id: option.id, name: option.name, zones, vehicle, kind: key, extra: { street: true, outdoors: key, word: built.length === 1 ? "building" : "buildings", kindName: O.KINDS[key].name, vid: Vr.id, vname: Vr.name, grounds, stats: S } });
  for (const h of map.plan.houses) { const Bd = built[h.k]; h.row = Bd.row; h.plan = Bd.p; }
  const area = built.reduce((a, Bd) => a + Bd.bw * Bd.bh * (Bd.m.storeys || 1), 0) + 60 * (S.sites + S.pads) + 300 * S.holes;
  const deadScale = clamp(Math.pow(area / O.DEAD_AREA, O.DEAD_EXP), 1, O.DEAD_MAX);
  return Object.assign(map, { street: true, outdoors: key, deadScale, outsideDead: O.OUTSIDE[key], scenes });
}

// An outdoor area for a kind of container (one a map: its rect the grounds'), made on first use.
function areaFor(K, type, name, Gr) {
  if (K.areas[type + name]) return K.areas[type + name];
  const a = { id: K.C.areas.length, type, name, outdoor: true, f: 0, x0: Gr.x0, y0: Gr.y0, w: Gr.x1 - Gr.x0 + 1, h: Gr.y1 - Gr.y0 + 1, house: null };
  K.C.areas.push(a);
  return (K.areas[type + name] = a);
}
const box = (K, a, x, y, w, h, kind, what, extra = {}) => { K.C.containers.push({ id: K.C.cid++, x, y, ...(w > 1 || h > 1 ? { w, h } : {}), f: 0, area: a.id, kind, searched: false, label: `${a.name}: ${what}`, house: null, ...extra }); };
// A piece of w × h on free ground: all its cells or none (compound.js guard: nothing cut off).
function piece(K, x, y, k, w = 1, h = 1) {
  const { G, cells, keep, I } = K, done = [];
  for (let q = y; q < y + h; q++) for (let p = x; p < x + w; p++) {
    if (G.block(p, q, k)) done.push(I(p, q));
    else { for (const i of done) { cells[i].k = "open"; G.passAt(i); } return false; }
  }
  for (const i of done) keep[i] = 1;
  return true;
}
// A vehicle on free ground (compound.js guard's car), its body named (ui/vehiclemodel.js: an RV a box body).
function vehicle(K, x, y, ax, L, body = null) {
  const rect = K.G.car(x, y, ax, L, "car", K.rng.int(0, 1e6));
  if (!rect) return null;
  if (body) for (let q = rect.y0; q < rect.y0 + rect.h; q++) for (let p = rect.x0; p < rect.x0 + rect.w; p++) { const c = K.cells[K.I(p, q)]; if (c.car) c.car.body = body; }
  for (let q = rect.y0 - 1; q <= rect.y0 + rect.h; q++) for (let p = rect.x0 - 1; p <= rect.x0 + rect.w; p++) if (K.inside(p, q)) K.keep[K.I(p, q)] = 1;
  return rect;
}
const free = (K, x, y) => K.inside(x, y) && K.cells[K.I(x, y)].k === "open" && !K.keep[K.I(x, y)] && !K.C.built[K.I(x, y)];
const freeRect = (K, x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (!free(K, x, y)) return false; return true; };
const blob = (K, cx, cy, r, f, rx = r) => { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) if (K.inside(x, y) && ((x - cx) / rx) ** 2 + ((y - cy) / r) ** 2 <= 1 && free(K, x, y)) K.cells[K.I(x, y)].f = f; };

// ---------- golf ----------
function golfGrounds(K, Gr, built) {
  const { rng, Vr, S, grounds, paint } = K, g = Vr.golf;
  let x0 = Gr.x0;
  // The fuel tank by the cart barn (the mowers' and the gas carts'): on the ground beside it.
  const barn = built.find((Bd) => Bd.p === "cartbarn");
  if (barn) for (let t = 0; t < 6; t++) if (piece(K, barn.x0 + barn.bw + 1, barn.y0 + 2 + t, "fueltank", 1, 2)) break;
  // The carts parked by the cart barn.
  if (barn) { const a = areaFor(K, "golfcart", "Golf carts", Gr); let n = 0; for (let t = 0; t < 10 && n < rng.int(2, 5); t++) { const r = vehicle(K, barn.x0 + t * 3, barn.y0 - 5, "y", 3, "golfcart"); if (r) { box(K, a, r.x0, r.y0, r.w, r.h, "car", "golf cart"); n++; S.carts++; } } }
  if (g.range) {
    const rw = g.rangeOnly ? Gr.x1 - Gr.x0 + 1 : Math.min(80, Math.floor((Gr.x1 - Gr.x0 + 1) * (g.mini ? 0.55 : 0.4)));
    range(K, { x0, y0: Gr.y0, x1: x0 + rw - 1, y1: Gr.y1 });
    x0 += rw + 4;
  }
  if (g.mini && x0 < Gr.x1 - 30) { mini(K, { x0, y0: Gr.y0, x1: Gr.x1, y1: Gr.y1 }); return; }
  const n = R2(rng, g.holes);
  if (!n || x0 > Gr.x1 - 40) return;
  // The holes: strips north to south, a fairway along each from its tee to its green, the next hole back the other way.
  const cartA = areaFor(K, "golfcart", "Golf carts", Gr);
  let y = Gr.y0;
  for (let h = 0; h < n; h++) {
    const hd = R2(rng, OUTDOOR.HOLE);
    if (y + hd > Gr.y1) break;
    const cy = y + Math.floor(hd / 2), fw = rng.int(3, 5), east = h % 2 === 0;
    const len = g.short ? rng.int(30, Math.min(60, Gr.x1 - x0 - 6)) : Math.max(40, Gr.x1 - x0 - rng.int(6, 30));
    const tx = east ? x0 + 3 : Gr.x1 - 3, gx = east ? tx + len : tx - len;
    for (let x = Math.min(tx, gx); x <= Math.max(tx, gx); x++) for (let yy = cy - fw; yy <= cy + fw; yy++) if (K.inside(x, yy) && K.cells[K.I(x, yy)].k === "open" && !K.keep[K.I(x, yy)]) K.cells[K.I(x, yy)].f = "fairway";
    for (let q = cy - 1; q <= cy + 1; q++) for (let p = tx - 1; p <= tx + 1; p++) if (free(K, p, q)) K.cells[K.I(p, q)].f = "green"; // the tee box
    blob(K, gx, cy, rng.int(3, 4), "green", rng.int(4, 5)); // the green
    const sand = g.sand + (g.dunes ? 4 : 0);
    for (let s = 0; s < rng.int(1, sand); s++) blob(K, gx + (east ? -1 : 1) * rng.int(5, 9), cy + (rng.chance(0.5) ? -1 : 1) * rng.int(4, 6), rng.int(1, 2), "sand", rng.int(2, 3));
    if (g.dunes) for (let s = 0; s < 3; s++) blob(K, rng.int(Math.min(tx, gx), Math.max(tx, gx)), cy + (rng.chance(0.5) ? -1 : 1) * (fw + rng.int(2, 3)), 2, "sand", rng.int(3, 6));
    // A pond beside the fairway now and then (water through the guard: it never cuts the course in two).
    if (rng.chance(g.ponds || 0)) {
      const px = Math.round((tx + gx) / 2) + rng.int(-8, 8), py = cy + (rng.chance(0.5) ? -1 : 1) * (fw + 3), r = rng.int(2, 3), rx = rng.int(3, 6);
      for (let yy = py - r; yy <= py + r; yy++) for (let x = px - rx; x <= px + rx; x++) if (((x - px) / rx) ** 2 + ((yy - py) / r) ** 2 <= 1 && free(K, x, yy)) K.G.block(x, yy, "water");
    }
    // The cart path along the strip's south side, a cart left on it now and then; trees between the holes.
    const pathY = y + hd - 2;
    for (let x = x0; x <= Gr.x1; x++) if (free(K, x, pathY)) K.cells[K.I(x, pathY)].f = "gravel";
    if (rng.chance(g.carts || 0)) { const r = vehicle(K, rng.int(x0 + 4, Gr.x1 - 8), pathY - 1, "x", 3, "golfcart"); if (r) { box(K, cartA, r.x0, r.y0, r.w, r.h, "car", "golf cart"); S.carts++; } }
    for (let x = x0; x <= Gr.x1; x++) if (rng.chance(g.trees || 0) && free(K, x, y)) K.G.block(x, y, rng.chance(0.8) ? "tree" : "bush");
    grounds.push({ kind: "hole", name: `Hole ${h + 1}`, x0: Math.min(tx, gx) - 2, y0: y, w: Math.abs(gx - tx) + 5, h: hd });
    S.holes++;
    y += hd;
  }
}
// A driving range: the tee line under its canopy at the south end, the targets (greens) out on the field, the
// floodlights down its sides, the netting along the far end.
function range(K, R) {
  const { rng, paint, S, grounds } = K;
  const ty = R.y1 - 3;
  paint(R.x0, ty, R.x1 - R.x0 + 1, 3, "paving", false);
  for (let x = R.x0; x <= R.x1; x++) for (let y = ty; y < ty + 3; y++) if (K.inside(x, y)) K.cells[K.I(x, y)].canopy = true;
  for (let x = R.x0 + 2; x < R.x1 - 1; x += 3) piece(K, x, ty + 2, "chair");
  for (let t = 0; t < 4; t++) blob(K, rng.int(R.x0 + 8, R.x1 - 8), rng.int(R.y0 + 6, ty - 12), rng.int(2, 3), "green", rng.int(3, 5));
  for (let y = R.y0 + 4; y < ty - 2; y += 12) { piece(K, R.x0, y, "lamp"); piece(K, R.x1, y, "lamp"); }
  for (let x = R.x0 + 1; x < R.x1; x++) if (x % 9 !== 4) K.G.block(x, R.y0, "fence");
  grounds.push({ kind: "range", name: "Driving range", x0: R.x0, y0: R.y0, w: R.x1 - R.x0 + 1, h: R.y1 - R.y0 + 1 });
  S.range = true;
}
// A mini-golf course: little holes of felt in a grid, each walled round with a gap at its tee, an obstacle in it.
function mini(K, R) {
  const { rng, S, grounds } = K, hw = 6, hh = 9;
  const cols = Math.min(6, Math.floor((R.x1 - R.x0) / (hw + 2))), rowsN = Math.min(3, Math.floor((R.y1 - R.y0) / (hh + 2)));
  let n = 0;
  const y0 = R.y1 - rowsN * (hh + 2);
  for (let r = 0; r < rowsN; r++) for (let c = 0; c < cols; c++) {
    const x = R.x0 + c * (hw + 2), y = y0 + r * (hh + 2);
    if (!freeRect(K, x, y, hw, hh)) continue;
    for (let q = y; q < y + hh; q++) for (let p = x; p < x + hw; p++) K.cells[K.I(p, q)].f = "green";
    for (let q = y; q < y + hh; q++) for (let p = x; p < x + hw; p++) if ((q === y || q === y + hh - 1 || p === x || p === x + hw - 1) && !(q === y + hh - 1 && p >= x + 2 && p <= x + 3)) K.G.block(p, q, "rail");
    piece(K, x + 2 + rng.int(0, 1), y + 3 + rng.int(0, 2), rng.chance(0.5) ? "statue" : "planter", 1, 1);
    n++;
  }
  if (n) { grounds.push({ kind: "mini", name: "Mini-golf course", x0: R.x0, y0, w: cols * (hw + 2), h: rowsN * (hh + 2) }); S.mini = true; S.holes += n; }
}

// ---------- campgrounds ----------
function campGrounds(K, Gr) {
  const { rng, Vr, S, grounds, paint, walkF } = K, g = Vr.camp;
  const tentA = areaFor(K, "tentsite", "Tent sites", Gr), carA = areaFor(K, "wreck", "Parked cars", Gr), rvA = areaFor(K, "rvpad", "Campers", Gr);
  const want = R2(rng, g.sites);
  let fx0 = Gr.x0, fieldW = 0;
  // A group field (a scout camp's, a group camp's): rows of tents on the open field at the west end.
  if (g.field) {
    const nt = R2(rng, g.field);
    fieldW = Math.min(70, Math.max(30, Math.ceil(nt / 4) * 6 + 6));
    let made = 0;
    for (let y = Gr.y0 + 4; y + 3 < Gr.y1 && made < nt; y += 6) for (let x = fx0 + 3; x + 3 < fx0 + fieldW && made < nt; x += 6) if (tent(K, tentA, x, y, "tent2")) made++;
    if (made) { grounds.push({ kind: "field", name: "Tent field", x0: fx0, y0: Gr.y0, w: fieldW, h: Gr.y1 - Gr.y0 + 1 }); S.field = true; }
    fx0 += fieldW + 4;
  }
  // The pavilion: a roof over picnic tables on a slab.
  if (g.pavilion) {
    const pw = 12, ph = 7, px = rng.int(fx0, Math.max(fx0, Math.min(Gr.x1 - pw - 2, fx0 + 30))), py = Gr.y1 - ph - 1;
    if (freeRect(K, px, py, pw, ph)) {
      paint(px, py, pw, ph, "paving", false);
      for (let y = py; y < py + ph; y++) for (let x = px; x < px + pw; x++) K.cells[K.I(x, y)].canopy = true;
      for (let x = px + 2; x < px + pw - 2; x += 3) for (const y of [py + 2, py + 4]) piece(K, x, y, "patiotable");
      grounds.push({ kind: "pavilion", name: "Pavilion", x0: px, y0: py, w: pw, h: ph });
      S.pavilion = true;
    }
  }
  if (!g.loops || !want) return;
  // The loops: gravel rings of road, the sites along both sides of them, a spur down to the forecourt.
  const L = g.loops, span = Math.floor((Gr.x1 - fx0 + 1) / L);
  let made = 0;
  for (let l = 0; l < L && made < want; l++) {
    const lx0 = fx0 + l * span + 8, lx1 = fx0 + (l + 1) * span - 9, ly0 = Gr.y0 + 8, ly1 = Gr.y1 - 10;
    if (lx1 - lx0 < 24 || ly1 - ly0 < 20) continue;
    const rw = 3, f = K.roadF === "road" ? "road" : walkF;
    paint(lx0, ly0, lx1 - lx0 + 1, rw, f); paint(lx0, ly1 - rw + 1, lx1 - lx0 + 1, rw, f);
    paint(lx0, ly0, rw, ly1 - ly0 + 1, f); paint(lx1 - rw + 1, ly0, rw, ly1 - ly0 + 1, f);
    const sx = Math.floor((lx0 + lx1) / 2);
    paint(sx, ly1, rw, Gr.y1 - ly1 + OUTDOOR.BACK + 2, f); // the spur toward the road
    grounds.push({ kind: "loop", name: `Loop ${String.fromCharCode(65 + l)}`, x0: lx0 - 7, y0: ly0 - 7, w: lx1 - lx0 + 15, h: ly1 - ly0 + 15 });
    // The site slots: outside the ring (north of its top, south of its bottom, west, east) and inside it.
    const slots = [];
    for (let x = lx0 + 2; x + 6 < lx1; x += OUTDOOR.SITE) { slots.push([x, ly0 - 7]); slots.push([x, ly0 + rw + 1]); if (Math.abs(x - sx) > 8) slots.push([x, ly1 + 1]); slots.push([x, ly1 - rw - 6]); }
    for (let y = ly0 + rw + 8; y + 6 < ly1 - rw - 7; y += OUTDOOR.SITE) { slots.push([lx0 - 7, y]); slots.push([lx1 + 1, y]); }
    for (const [x, y] of rng.shuffle(slots)) { if (made >= want) break; if (site(K, x, y, g, { tentA, carA, rvA })) made++; }
  }
}
// One tent site of 6 × 6: its pad, a picnic table, a fire ring, a cooler, a tent, a car or a camper parked on it.
function site(K, x, y, g, A) {
  const { rng, S } = K;
  if (!freeRect(K, x, y, 6, 6)) return false;
  if (!g.nopad) for (let q = y; q < y + 6; q++) for (let p = x; p < x + 6; p++) K.cells[K.I(p, q)].f = "dirt";
  piece(K, x + 1, y + 1, "patiotable");
  piece(K, x + 3, y + 1, "firepit");
  if (rng.chance(0.55) && piece(K, x + 1, y + 2, "crate")) box(K, A.tentA, x + 1, y + 2, 1, 1, "crate", "cooler");
  if (rng.chance(g.tent || 0)) tent(K, A.tentA, x + 3, y + 3, g.big ? "tent4" : rng.chance(0.5) ? "tent2" : rng.chance(0.6) ? "tent1" : "tent4");
  if (rng.chance(g.rv || 0)) { const r = vehicle(K, x, y + 3, "x", 5, "rv"); if (r) { box(K, A.rvA, r.x0, r.y0, r.w, r.h, "car", "camper"); S.rvs++; } }
  else if (rng.chance(g.car || 0)) { const r = vehicle(K, x, y + 4, "x", 3); if (r) { box(K, A.carA, r.x0, r.y0, r.w, r.h, "car", "car"); S.cars++; } }
  S.sites++;
  return true;
}
// A tent (campsite.js's tent cells; its storage a container rolled by campsite.js tentBoxLoot).
function tent(K, a, x, y, kind) {
  const T = TENT_TYPES[kind] || TENT_TYPES.tent2, w = T.w, h = T.h;
  if (!freeRect(K, x - 1, y - 1, w + 2, h + 2)) return false;
  for (let q = y; q < y + h; q++) for (let p = x; p < x + w; p++) { const c = K.cells[K.I(p, q)]; c.k = "tent"; c.hp = c.mhp = TENT_FIGHT.HP; K.keep[K.I(p, q)] = 1; K.G.passAt(K.I(p, q)); }
  if (T.storeKg > 0) box(K, a, x, y, w, h, "tent", T.name.toLowerCase(), { tent: K.S.tents, tentKind: kind, cap: T.storeKg });
  K.S.tents++;
  return true;
}

// ---------- RV parks ----------
const RV_WHAT = ["motorhome", "fifth-wheel trailer", "travel trailer", "camper van", "pop-up camper", "truck camper"];
function rvGrounds(K, Gr) {
  const { rng, Vr, S, grounds, paint, walkF } = K, g = Vr.rv, P = OUTDOOR.PAD;
  const rvA = areaFor(K, "rvpad", "RV sites", Gr);
  const park = (x, y, ax) => {
    const big = rng.chance(g.big || 0), L = big ? 5 : 4;
    const r = vehicle(K, x, y, ax, L, "rv");
    if (!r) return false;
    box(K, rvA, r.x0, r.y0, r.w, r.h, "car", big ? (rng.chance(0.6) ? "motorhome" : "fifth-wheel trailer") : rng.pick(RV_WHAT.slice(2)));
    S.rvs++;
    return true;
  };
  let x0 = Gr.x0;
  // The extras at the west end: the dump station, a fuel tank, a court.
  if (g.dump) {
    const dx = x0 + 2, dy = Gr.y1 - 6;
    if (freeRect(K, dx, dy, 6, 4)) { paint(dx, dy, 6, 4, "paving", false); piece(K, dx + 2, dy + 1, "drum"); piece(K, dx + 4, dy + 1, "barrel"); grounds.push({ kind: "dump", name: "Dump station", x0: dx, y0: dy, w: 6, h: 4 }); S.dump = true; }
  }
  if (g.fuel) piece(K, x0 + 10, Gr.y1 - 4, "fueltank", 2, 1);
  if (g.court) {
    const cx = x0 + 2, cy = Gr.y0 + 2;
    if (freeRect(K, cx, cy, 14, 8)) { paint(cx, cy, 14, 8, "court", false); for (let y = cy + 1; y < cy + 7; y++) piece(K, cx + 7, y, "tennisnet"); grounds.push({ kind: "court", name: "Court", x0: cx, y0: cy, w: 14, h: 8 }); S.court = true; }
  }
  x0 += 18;
  if (g.scatter) {
    // Boondocking: RVs where their owners stopped on the open ground, no pads.
    const n = R2(rng, g.scatter);
    for (let t = 0, made = 0; t < n * 8 && made < n; t++) if (park(rng.int(x0, Gr.x1 - 6), rng.int(Gr.y0, Gr.y1 - 6), rng.chance(0.5) ? "x" : "y")) { made++; S.pads++; }
    grounds.push({ kind: "pads", name: "The lot", x0: Gr.x0, y0: Gr.y0, w: Gr.x1 - Gr.x0 + 1, h: Gr.y1 - Gr.y0 + 1 });
    return;
  }
  // Rows: a drive with a row of pads either side, back-in; the drives joined by a cross drive at the west end down to
  // the forecourt.
  const rowsN = R2(rng, g.rows), f = g.surface === "road" ? "road" : walkF;
  const band = 2 * P.d + P.aisle + 2;
  const yTop = Math.max(Gr.y0, Gr.y1 - rowsN * band + 1);
  paint(x0, yTop, P.aisle, Gr.y1 - yTop + OUTDOOR.BACK + 2, f); // the cross drive
  for (let r = 0; r < rowsN; r++) {
    const by = yTop + r * band;
    if (by + band - 2 > Gr.y1) break;
    const ay = by + P.d;
    paint(x0, ay, Gr.x1 - x0 + 1, P.aisle, f);
    for (let x = x0 + P.aisle + 1; x + P.w <= Gr.x1; x += P.w + 1) {
      for (const [py, toward] of [[by, 1], [ay + P.aisle, -1]]) {
        if (!freeRect(K, x, py, P.w, P.d)) continue;
        for (let q = py; q < py + P.d; q++) for (let p = x; p < x + P.w; p++) K.cells[K.I(p, q)].f = "gravel";
        S.pads++;
        if (rng.chance(g.full || 0)) { park(x + 1, toward > 0 ? py + P.d - 6 : py + 1, "y"); }
        if (rng.chance(0.4)) piece(K, x + 4, toward > 0 ? py + 1 : py + P.d - 2, "patiotable");
        piece(K, x + 4, toward > 0 ? py + P.d - 1 : py, "lamp"); // the hook-up post's light
      }
    }
    grounds.push({ kind: "pads", name: `Row ${String.fromCharCode(65 + r)}`, x0, y0: by, w: Gr.x1 - x0 + 1, h: band - 2 });
  }
}

// ---------- the shared extras ----------
// A pool: its deck and the drained pool behind a fence with a gate, loungers along the deck.
function pool(K, Gr) {
  const { rng, S, grounds, paint } = K, pw = 16, ph = 11;
  for (let t = 0; t < 30; t++) {
    const x = rng.int(Gr.x0 + 2, Gr.x1 - pw - 2), y = rng.int(Math.max(Gr.y0, Gr.y1 - 40), Gr.y1 - ph - 1);
    if (!freeRect(K, x - 1, y - 1, pw + 2, ph + 2)) continue;
    paint(x, y, pw, ph, "paving", false);
    paint(x + 3, y + 3, pw - 6, ph - 6, "pool", false);
    for (let q = y; q < y + ph; q++) for (let p = x; p < x + pw; p++) if ((q === y || q === y + ph - 1 || p === x || p === x + pw - 1) && !(q === y + ph - 1 && p >= x + 7 && p <= x + 8)) K.G.block(p, q, "fence");
    for (let p = x + 3; p < x + pw - 3; p += 2) piece(K, p, y + 1, "lounger");
    for (let q = y - 1; q <= y + ph; q++) for (let p = x - 1; p <= x + pw; p++) if (K.inside(p, q)) K.keep[K.I(p, q)] = 1; // kept from the pads, the sites and the fairways
    grounds.push({ kind: "pool", name: "Pool", x0: x, y0: y, w: pw, h: ph });
    S.pool = true;
    return;
  }
}
// A boat launch on the shore: a gravel ramp into the water, a dock beside it, boat trailers parked at the top.
function launch(K, waterY) {
  const { rng, S, grounds, W, cells, I } = K;
  const x = rng.int(Math.floor(W * 0.3), Math.floor(W * 0.6));
  let shore = 0;
  for (let y = 0; y < waterY + 2; y++) if (cells[I(x, y)].k === "water") shore = y;
  if (!shore) return;
  for (let y = shore - 4; y <= shore + 2; y++) for (let p = x; p < x + 4; p++) if (K.inside(p, y)) { const c = cells[I(p, y)]; c.k = "open"; c.f = "gravel"; K.keep[I(p, y)] = 1; }
  let land = shore + 1; // the dock runs out from dry land (the shore beside the ramp may lie deeper)
  while (land < waterY + 3 && (cells[I(x + 6, land)].k === "water" || cells[I(x + 7, land)].k === "water")) land++;
  for (let y = shore - 8; y <= land; y++) for (let p = x + 6; p < x + 8; p++) if (K.inside(p, y)) { const c = cells[I(p, y)]; c.k = "open"; c.f = "floor"; c.fl = "plank"; K.keep[I(p, y)] = 1; }
  // the guard's walk was set before the ramp and the dock: their cells are passable now
  for (let y = shore - 8; y <= land; y++) for (let p = x; p < x + 8; p++) if (K.inside(p, y)) K.G.passAt(I(p, y));
  const a = areaFor(K, "wreck", "Boat trailers", { x0: x - 10, y0: shore + 3, x1: x + 20, y1: shore + 12 });
  for (let t = 0, n = 0; t < 8 && n < 2; t++) { const r = vehicle(K, x - 8 + t * 4, shore + 5, "y", 4); if (r) { box(K, a, r.x0, r.y0, r.w, r.h, "car", "boat trailer"); n++; } }
  grounds.push({ kind: "launch", name: "Boat launch", x0: x, y0: shore - 8, w: 8, h: 11 });
  S.launch = true;
}

// ======================================================================================
// In the raid
// ======================================================================================
// The loot share and the Heat clock: outdoorshare.js (a leaf: combat.js reads them without this module's imports).
export { outdoorLootShare, outdoorHeatRate } from "./outdoorshare.js";
// The opening line: the place, its buildings, its grounds, the ways out.
export function outdoorIntro(b) {
  const R = b.raid, P = R.plan, s = P.stats || {};
  const names = P.houses.map((h) => h.name);
  const parts = [];
  if (s.holes) parts.push(`${s.holes} hole${s.holes === 1 ? "" : "s"}${s.mini ? " of mini-golf" : ""}`);
  if (s.range) parts.push("a driving range");
  if (s.sites) parts.push(`${s.sites} tent sites`);
  if (s.field) parts.push("a tent field");
  if (s.pads) parts.push(`${s.pads} RV pads`);
  if (s.rvs) parts.push(`${s.rvs} RV${s.rvs === 1 ? "" : "s"} and trailers left`);
  if (s.pool) parts.push("a pool");
  if (s.launch) parts.push("a boat launch");
  const water = s.lake === "river" ? " A river runs along the north edge." : s.lake ? " A lake fills the north." : "";
  const ways = R.zones.map((z) => (z.name || z.side).toLowerCase());
  const been = P.houses.filter((h) => R.containers.some((c) => c.house === h.k && c.mine)).map((h) => h.name);
  return `${P.vname || P.kindName}: ${names.length} building${names.length === 1 ? "" : "s"} (${names.join(", ")})${parts.length ? `, ${parts.join(", ")}` : ""}.${water} Ways out: ${ways.join(", ")}.${been.length ? ` Your people have been through ${been.join(", ")} before: what you left there is as you left it.` : ""}`;
}
// What a kind likely holds (buildingmaps.js buildingHint): { hint, size, rooms, holds, sig }.
export function outdoorHint(key) {
  if (key === "golfcourse") return { hint: "Likely: golf clubs, liquor at the bar, fuel and tools in the cart barn, food. A clubhouse, a cart barn, the course.", size: "huge", rooms: 18, holds: ["proshop", "bar", "kitchen", "lockers", "cartbarn"], sig: [{ name: "Pro shop", n: 1 }, { name: "Grill room", n: 1 }, { name: "Cart bays", n: 1 }] };
  if (key === "campground") return { hint: "Likely: camping gear, food, fuel and first aid. The office and camp store, bathhouses, tent sites.", size: "huge", rooms: 12, holds: ["campsite", "tentsite", "campstore", "bathhouse"], sig: [{ name: "Camp store", n: 1 }, { name: "Tent site", n: 20 }] };
  return { hint: "Likely: what each RV's owner kept (food, water, propane, fuel, first aid), the laundry. The office, the pads.", size: "huge", rooms: 8, holds: ["rvpad", "coinlaundry", "campstore"], sig: [{ name: "RV", n: 20 }, { name: "Coin laundry", n: 1 }] };
}
// How many buildings and pads a place has for the headless search (poicont.js poiHouses): its buildings and a share of
// its grounds (a few sites or pads at a time). Builds no map.
const countCache = new Map();
export function outdoorHouses(state, tileId, option) {
  const k = `${state.seed}:${tileId}:${option.id}:${option.key}`;
  if (!countCache.has(k)) {
    if (countCache.size > 64) countCache.clear();
    const { Vr, built } = outdoorPlan(state, tileId, option);
    const yard = Vr.camp ? (Vr.camp.sites[0] + Vr.camp.sites[1]) / 2 : Vr.rv ? (Vr.rv.rows ? (Vr.rv.rows[0] + Vr.rv.rows[1]) * 12 : (Vr.rv.scatter[0] + Vr.rv.scatter[1]) / 2) : Vr.golf ? (Vr.golf.holes[0] + Vr.golf.holes[1]) / 2 : 0;
    countCache.set(k, built.length + Math.ceil(yard / 8));
  }
  return countCache.get(k);
}
/** The variants of a kind (the gallery's and the tests'). @param {string} key */
export const outdoorVariants = (key) => variantsOf(key);

// ======================================================================================
// The signs of survival of this module's buildings (interiorscenes.js registerScene, issue #11's hook; their own dice)
//   lastround  a clubhouse's bar: the last round poured, the ones who drank it at the bar, the bottles left.
// ======================================================================================
function lastRound(ctx) {
  const { rng } = ctx;
  for (const r of rng.shuffle(ctx.rooms.filter((q) => q.type === "bar" && !q.scene && !q.locked))) {
    const f = r.f || 0, cells = ctx.freeIn(r);
    if (cells.length < 4) continue;
    const [x, y] = cells[Math.floor(cells.length / 2)];
    const n = rng.int(1, 3);
    for (let i = 0; i < n && i + 1 < cells.length; i++) { const [bx, by] = cells[(i * 5 + 1) % cells.length]; ctx.body(f, bx, by, i === 0 && rng.chance(0.3) ? { sleeper: true } : { human: true, quiet: true }); }
    ctx.pile(f, x, y, "The last round: glasses still on the bar, the bottles open", { water: rng.int(0, 2) }, r.id);
    return ctx.done("lastround", r, x, y, `In the ${String(r.name || "bar").toLowerCase()} someone poured a last round, and ${n === 1 ? "one of them never left" : "they never left"}.`);
  }
  return null;
}
registerScene("lastround", { w: 3, place: lastRound, kinds: [...CLUBHOUSES], when: (ctx) => ctx.rooms.some((r) => r.type === "bar") });
