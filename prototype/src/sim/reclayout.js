// @ts-check
// Gyms and bowling alleys (issue #56 of the round-2 epic #39, wave 2; the user's request 2026-10-26: "gym, bowling
// alley"): two building types new with this module, thirteen variants each, every one a plan of its own drawn at its
// real size (a cell a metre, outer walls included), its rooms furnished for what they are, and their signs of survival.
// buildingmaps.js BUILDINGS.gym and BUILDINGS.bowling call gymPlan / bowlPlan; styleOf runs recStyle on a leaf with a
// rec mark; areas keep the mark (r.rec) for the scenes.
//
// THE GYMS (GYM.SIZE, GYM_NAMES; w × d metres, storeys):
//   chain24    a 24-hour chain gym (30–40 × 25–32, 1): the front desk and its vending, the cardio floor (rows of
//              treadmills, bikes and rowers), the weight floor (squat racks, dumbbell racks, benches), the group studio,
//              two locker rooms with showers.
//   boxing     a boxing gym (18–22 × 22–26, 1): the ring (corner posts round a canvas square), the heavy-bag row, a
//              weight corner, the coach's office, a locker room.
//   crossfit   a CrossFit box in an industrial unit (18–24 × 24–30, 1): one open floor (the rig of racks, rowers and
//              bags), its roller door, the front office, the changing room, the kit store.
//   ymca       a YMCA (40–48 × 34–40, 2): the lobby and its front desk, the pool hall (drained), the basketball court
//              with bleachers, two locker rooms; upstairs the weight room, the cardio floor, a studio, childcare, offices.
//   climbing   a climbing gym (24–30 × 20–26, 1): the bouldering hall (holds on every wall, crash mats), the lead wall,
//              the front desk with its gear shop, a café, a yoga corner, lockers.
//   dojo       a martial arts dojo (14–18 × 16–20, 1): the mat room, the changing rooms, the sensei's office, the front.
//   yoga       a yoga studio (12–16 × 14–18, 1): two studios on hardwood, the reception boutique, a tea corner,
//              changing rooms.
//   club       a high-end health club with a spa (40–48 × 32–38, 2): the lobby, the smoothie bar, the pool; the spa (a
//              hot tub, the sauna, treatment rooms); upstairs the cardio floor, the weight floor, two studios, the lounge.
//   strip      a strip-mall gym (12–15 × 24–30, 1, narrow): the desk, the cardio row at the windows, the weights behind,
//              the locker rooms and the restrooms at the back.
//   barn       a powerlifting barn (14–18 × 20–24, 1): lifting platforms and racks on rubber, the chalk and the bars,
//              a lounge, the back door.
//   fitness    a hotel-style fitness centre (10–13 × 10–13, 1): a cardio row, a bench, lockers and a water cooler (an
//              office park's or a motel's annex).
//   circuit    a women's circuit gym (12–15 × 14–17, 1): the ring of machines, the front desk, a changing room.
//   iron       an old-school iron gym in a brick building (18–22 × 22–26, 2): the desk and the supplement counter, the
//              free weights; upstairs the bodybuilders' floor and the posing room.
// THE BOWLING ALLEYS (BOWL.SIZE, BOWL_NAMES): a lane is two cells across (the lane, then the ball-return gutter or the
// divider between pairs), a walkway each side; the lane room's front three rows the settee (the scorer, the seats), four
// rows of approach (the ball returns), the lane boards, the pins at its far end; the pinsetter room behind, a pinsetter
// at every lane's end (lanes: the count; the building's width follows from it).
//   classic    a 1960s 12-lane house (12 lanes, 34–38 deep): the shoe counter, the coffee shop, the office.
//   mega       a 40-lane bowling centre with an arcade (40 lanes, 42–46 deep): the concourse, the arcade, the bar and
//              grill, the pro shop, party rooms.
//   bowlbar    a bowling bar (8 lanes, 34–38): the long bar, the lounge, the kitchen.
//   smalltown  a small-town 6-lane alley (6 lanes, 32–34): the lunch counter, the shoe counter, the office.
//   duckpin    a duckpin hall (10 lanes, 30–32): the shoe counter, the candy counter, the old office.
//   family     a family fun centre (20 lanes, 44–48): the arcade and its prize counter, laser tag, party rooms, the
//              snack bar.
//   legion     a Legion post's lanes (6 lanes, 32–34): the post's bar, the hall office.
//   glow       a 24-lane suburban centre with cosmic bowling (24 lanes, 40–44): the concourse, the bar, the arcade.
//   roadside   a roadside bowl with a diner (16 lanes, 38–42): the diner's counter, its kitchen.
//   billiards  bowling and billiards (10 lanes, 40–44): the billiards room in front, the bar.
//   downtown   a downtown bowl upstairs (8 lanes, 32–36, 2 storeys): the street lobby, the bar and the pro shop below,
//              the lanes on the floor above.
//   league     a 32-lane league house (32 lanes, 44–48): the pro shop, the league ball lockers, the bar and the
//              restaurant, the nursery.
//   candlepin  a candlepin hall (8 lanes, 30–32): the counter, a lunch room.
// WHICH VARIANT (gymVariant / bowlVariant): o.variant or o.plan pins one; else the shared picker (variantpick.js,
// issue #41) by the place's setting (o.where), its tile class (o.tileClass) and the placement table's size class for
// the kind there (data-placement.js PLACEMENT_ROWS, issue #42: placement.js sizeFor).
// LOOT (data-shops.js AREA_DEFS, room by room): the weight floors, cardio floors and studios water and a little kit
// (gymfloor), the front desk energy bars, protein and first aid (gymdesk), the smoothie bar its drinks, protein powder
// and bars (smoothie: foods.js MIXES.gym), the locker rooms bags and what people left (gymlocker), the spa towels and
// first aid (gymspa), the kit store cleaning stock and a few tools (gymstore); a bowling alley's concourse and shoe
// counter snacks and first aid (shoecounter), the bar its liquor (bowlbar), the pinsetter room tools and parts
// (pinsetter), the pro shop bags (proshop), the arcade its own (arcade). tools/lootsensetest.js holds them to it.
// Older saves: there were no gyms or bowling alleys before (buildingmaps.js NEW_KEYS): nothing to keep.
import { registerVariants, pickVariant } from "./variantpick.js"; // the shared picker (issue #41)
import { registerScene, SCENES } from "./interiorscenes.js";

export const GYM = {
  // Footprints in cells (metres), [min, max], outer walls included; storeys.
  SIZE: {
    chain24:  { w: [30, 40], h: [25, 32], storeys: [1, 1] },
    boxing:   { w: [18, 22], h: [22, 26], storeys: [1, 1] },
    crossfit: { w: [18, 24], h: [24, 30], storeys: [1, 1] },
    ymca:     { w: [40, 48], h: [34, 40], storeys: [2, 2] },
    climbing: { w: [24, 30], h: [20, 26], storeys: [1, 1] },
    dojo:     { w: [14, 18], h: [16, 20], storeys: [1, 1] },
    yoga:     { w: [12, 16], h: [14, 18], storeys: [1, 1] },
    club:     { w: [40, 48], h: [32, 38], storeys: [2, 2] },
    strip:    { w: [12, 15], h: [24, 30], storeys: [1, 1] },
    barn:     { w: [14, 18], h: [20, 24], storeys: [1, 1] },
    fitness:  { w: [10, 13], h: [10, 13], storeys: [1, 1] },
    circuit:  { w: [12, 15], h: [14, 17], storeys: [1, 1] },
    iron:     { w: [18, 22], h: [22, 26], storeys: [2, 2] },
  },
  // The picker's weights by setting (variantpick.js w: the six settings; any where a setting is not named).
  W: {
    chain24:  { centre: 1, city: 1.4, suburb: 1.6, town: 0.6, highway: 0.4, any: 1 },
    boxing:   { centre: 1, city: 1.4, suburb: 0.6, town: 0.5, any: 0.5 },
    crossfit: { centre: 0.4, city: 0.8, suburb: 1.4, town: 0.8, highway: 0.6, any: 0.8 },
    ymca:     { centre: 1.2, city: 1, suburb: 0.6, town: 0.4, any: 0.5 },
    climbing: { centre: 0.6, city: 1, suburb: 0.8, town: 0.3, any: 0.4 },
    dojo:     { centre: 0.6, city: 0.8, suburb: 1, town: 1, any: 0.8 },
    yoga:     { centre: 1, city: 1, suburb: 1, town: 0.8, any: 0.8 },
    club:     { centre: 1.4, city: 0.8, suburb: 0.5, any: 0.3 },
    strip:    { suburb: 1.4, town: 1.2, highway: 0.8, any: 0.8 },
    barn:     { town: 0.6, rural: 2, highway: 0.8, any: 0.4 },
    fitness:  { centre: 0.4, city: 0.5, suburb: 0.6, town: 0.6, highway: 1.4, rural: 0.6, any: 0.5 },
    circuit:  { suburb: 0.8, town: 1.2, rural: 0.5, any: 0.6 },
    iron:     { centre: 0.8, city: 1, suburb: 0.4, town: 0.8, any: 0.5 },
  },
  SHELTER_COTS: [4, 10], // the gym as a shelter (scenes): cots on the court, the mats or a studio
};
export const GYM_NAMES = {
  chain24: "24-hour chain gym", boxing: "Boxing gym", crossfit: "CrossFit box", ymca: "YMCA", climbing: "Climbing gym", dojo: "Martial arts dojo",
  yoga: "Yoga studio", club: "Health club and spa", strip: "Strip-mall gym", barn: "Powerlifting barn", fitness: "Fitness centre", circuit: "Women's circuit gym",
  iron: "Old-school iron gym",
};
export const BOWL = {
  // lanes: the lane count (even); h: the depth; the width is the lanes' (laneWidth). storeys.
  SIZE: {
    classic:   { lanes: 12, h: [34, 38], storeys: [1, 1] },
    mega:      { lanes: 40, h: [42, 46], storeys: [1, 1] },
    bowlbar:   { lanes: 8,  h: [34, 38], storeys: [1, 1] },
    smalltown: { lanes: 6,  h: [32, 34], storeys: [1, 1] },
    duckpin:   { lanes: 10, h: [30, 32], storeys: [1, 1] },
    family:    { lanes: 20, h: [44, 48], storeys: [1, 1] },
    legion:    { lanes: 6,  h: [32, 34], storeys: [1, 1] },
    glow:      { lanes: 24, h: [40, 44], storeys: [1, 1] },
    roadside:  { lanes: 16, h: [38, 42], storeys: [1, 1] },
    billiards: { lanes: 10, h: [40, 44], storeys: [1, 1] },
    downtown:  { lanes: 8,  h: [32, 36], storeys: [2, 2] },
    league:    { lanes: 32, h: [44, 48], storeys: [1, 1] },
    candlepin: { lanes: 8,  h: [30, 32], storeys: [1, 1] },
  },
  W: {
    classic:   { city: 1, suburb: 1.2, town: 1.4, any: 1 },
    mega:      { centre: 1, city: 1.2, suburb: 1.4, any: 0.5 },
    bowlbar:   { centre: 1.6, city: 1.4, suburb: 0.6, any: 0.5 },
    smalltown: { town: 1.4, rural: 2, highway: 1, any: 0.6 },
    duckpin:   { city: 0.8, town: 1, rural: 0.6, any: 0.5 },
    family:    { city: 0.8, suburb: 1.6, town: 0.8, highway: 0.6, any: 0.6 },
    legion:    { town: 1, rural: 1.6, highway: 0.6, any: 0.4 },
    glow:      { city: 1, suburb: 1.4, any: 0.6 },
    roadside:  { suburb: 0.6, town: 0.8, highway: 2, rural: 0.6, any: 0.6 },
    billiards: { centre: 0.8, city: 1, suburb: 0.8, town: 0.8, any: 0.6 },
    downtown:  { centre: 1.6, city: 1, town: 0.6, any: 0.4 },
    league:    { city: 0.8, suburb: 1.2, any: 0.4 },
    candlepin: { city: 0.6, town: 1, rural: 0.8, any: 0.5 },
  },
  SETTEE: 3,    // the lane room's front rows: the scorers and the seats
  APPROACH: 4,  // then the approach (the ball returns on it)
  MECH: 4,      // the pinsetter room's depth inside its walls
};
export const BOWL_NAMES = {
  classic: "1960s 12-lane house", mega: "40-lane bowling centre", bowlbar: "Bowling bar", smalltown: "Small-town 6-lane alley", duckpin: "Duckpin hall",
  family: "Family fun centre", legion: "Legion post lanes", glow: "Cosmic bowling centre", roadside: "Roadside bowl and diner", billiards: "Bowling and billiards hall",
  downtown: "Downtown bowl upstairs", league: "32-lane league house", candlepin: "Candlepin hall",
};
/** A bowling alley's width (outer walls in) for its lane count: two cells a lane, a walkway each side. @param {number} lanes */
export const laneWidth = (lanes) => lanes * 2 + 4;

const X = (...parts) => ({ split: "x", parts });
const Y = (...parts) => ({ split: "y", parts });
// A room: its role (buildingmaps.js ROLES), its style's rec mark, its overrides (name, type, maxBoxes, entry, hub...).
const R = (role, rec, o = {}) => ({ role, rec, ...o });
const rest = (w = 2) => [w, { role: "restroom" }];
/** @param {any} rng @param {number[]} r */
const roll = (rng, r) => rng.int(r[0], r[1]);
const flipX = (node, on) => (on && node.split === "x" ? { ...node, parts: node.parts.slice().reverse() } : node);

// ---------- the gyms' rooms ----------
const desk = (name = "Front desk", o = {}) => R("lobby", "gymdesk", { name, type: "gymdesk", entry: true, hub: true, fl: "tile", maxBoxes: 2, ...o });
const cardio = (name = "Cardio floor", o = {}) => R("gym", "cardio", { name, type: "gymfloor", hub: true, fl: "rubber", maxBoxes: 2, ...o });
const weights = (name = "Weight floor", o = {}) => R("gym", "weights", { name, type: "gymfloor", hub: true, fl: "rubber", maxBoxes: 3, ...o });
const studio = (name = "Studio", o = {}) => R("gym", "studio", { name, type: "gymfloor", hub: false, fl: "hardwood", maxBoxes: 1, ...o });
const lockers = (name = "Locker room", o = {}) => R("lockerroom", "lockers", { name, type: "gymlocker", fl: "tile", windows: false, maxBoxes: 4, ...o });
const smoothie = (name = "Smoothie bar", o = {}) => R("dining", "smoothie", { name, type: "smoothie", fl: "tile", hub: false, maxBoxes: 3, ...o });
const gymOffice = (name = "Manager's office") => R("office", "gymoffice", { name, type: "office", maxBoxes: 2 });
const kit = (name = "Storage") => R("storage", "gymstore", { name, type: "gymstore", maxBoxes: 2 });
const pool = (name = "Pool") => R("gym", "pool", { name, type: "gymlocker", fl: "tile", hub: false, maxBoxes: 1 });
const court = (name = "Basketball court") => R("gym", "court", { name, type: "gymfloor", fl: "hardwood", hub: true, maxBoxes: 1 });
const spa = (name = "Spa") => R("office", "spa", { name, type: "gymspa", fl: "tile", maxBoxes: 3 });
const mats = (name = "Mat room", o = {}) => R("gym", "mats", { name, type: "gymfloor", fl: "mat", hub: true, maxBoxes: 1, ...o });
const hall = (name = "Upper hall") => R("hall", "uphall", { name, hub: true, fl: "rubber" });

// ======================================================================================
// The gyms' plans: each (rng, d) → the spec's program, upper and exits; d = { bw, bh, n }.
// ======================================================================================
const GYM_PLANS = {
  chain24(rng, d) {
    const fd = Math.max(8, Math.round((d.bh - 2) * 0.35));
    return {
      program: Y([fd, flipX(X([10, desk("Front desk", { vend: true })], ["*", cardio("Cardio floor")], [9, studio("Group fitness studio")]), rng.chance(0.5))],
        ["*", flipX(X(["*", weights("Weight floor")], [9, Y(["*", lockers("Men's locker room")], [3, kit("Cleaning store")], ["*", lockers("Women's locker room")])]), rng.chance(0.5))]),
      exits: [{ side: "back", roles: ["gym"], chance: 0.8, lock: 0.5, name: "Fire exit" }],
    };
  },
  boxing(rng, d) {
    return {
      program: Y([5, X(["*", desk("Front counter", { maxBoxes: 1 })], [5, gymOffice("Coach's office")], rest(2))],
        ["*", flipX(X(["*", R("gym", "boxing", { name: "The ring", type: "gymfloor", hub: true, fl: "rubber", maxBoxes: 1 })], [6, Y(["*", R("gym", "bags", { name: "Bag row", type: "gymfloor", fl: "rubber", maxBoxes: 1 })], [5, lockers("Locker room", { maxBoxes: 2 })])]), rng.chance(0.5))]),
      exits: [{ side: "back", roles: ["gym"], chance: 0.7, lock: 0.5 }],
    };
  },
  crossfit(rng, d) {
    return {
      program: Y([5, flipX(X([7, desk("Front office", { maxBoxes: 1 })], ["*", R("gym", "cfwall", { name: "Rower row", type: "gymfloor", hub: true, fl: "rubber", maxBoxes: 1 })], [5, lockers("Changing room", { maxBoxes: 2 })]), rng.chance(0.5))],
        ["*", R("gym", "rig", { name: "The box", type: "gymfloor", hub: true, fl: "rubber", maxBoxes: 3 })],
        [3, X(["*", kit("Kit store")], rest(3))]),
      exits: [{ side: "back", roles: ["gym"], chance: 1, roller: true, width: 3, lock: 0.3, name: "Roller door" }],
    };
  },
  // The lobby at the front between the pool hall and the court; the locker rooms behind; upstairs the weights, the
  // cardio floor, a studio, childcare and the offices round the upper hall over the lobby.
  ymca(rng, d) {
    const flip = rng.chance(0.5), lw = 9;
    return {
      program: flipX(X(["*", Y(["*", pool("Pool hall")], [7, lockers("Men's locker room")])],
        [lw, Y([8, desk("Lobby", { vend: true })], ["*", R("hall", "uphall", { name: "Hall", hub: true, fl: "tile" })], [5, kit("Equipment room")])],
        ["*", Y(["*", court("Basketball court")], [7, lockers("Women's locker room")])]), flip),
      upper: () => flipX(X(["*", Y(["*", weights("Weight room")], [7, studio("Aerobics studio")])],
        [lw, Y([8, hall("Upper hall")], ["*", gymOffice("Offices")], [5, rest(5)[1]])],
        ["*", Y(["*", cardio("Cardio floor", { hub: false })], [7, R("classroom", "childcare", { name: "Childcare room", type: "office", fl: "carpet", maxBoxes: 2 })])]), flip),
      stairs: { roles: ["lobby", "hall"] },
      exits: [{ side: "back", roles: ["hall", "storage"], chance: 1, lock: 0.4 }, { side: flip ? "left" : "right", roles: ["gym"], chance: 0.6, lock: 0.5, name: "Pool door" }],
    };
  },
  climbing(rng, d) {
    return {
      program: flipX(X(["*", R("gym", "climb", { name: "Bouldering hall", type: "gymfloor", fl: "mat", hub: true, maxBoxes: 1 })],
        [9, Y([6, desk("Front desk and gear shop", { shop: true })], [5, smoothie("Café")], [5, mats("Yoga corner", { hub: false, fl: "hardwood" })], ["*", lockers("Lockers", { maxBoxes: 3 })])],
        [7, R("gym", "climb", { name: "Lead wall", type: "gymfloor", fl: "mat", maxBoxes: 1 })]), rng.chance(0.5)),
      exits: [{ side: "back", roles: ["gym"], chance: 0.7, lock: 0.5 }],
    };
  },
  dojo(rng, d) {
    return {
      program: Y([4, flipX(X(["*", desk("Front")], [5, gymOffice("Sensei's office")]), rng.chance(0.5))],
        ["*", mats("Dojo")],
        [4, X(["*", lockers("Changing room (men)", { maxBoxes: 2 })], ["*", lockers("Changing room (women)", { maxBoxes: 2 })], rest(2))]),
      exits: [{ side: "back", roles: ["restroom", "lockerroom"], chance: 0.4, lock: 0.5 }],
    };
  },
  yoga(rng, d) {
    return {
      program: Y([5, flipX(X(["*", desk("Reception boutique", { shop: true })], [4, smoothie("Tea corner", { maxBoxes: 1 })]), rng.chance(0.5))],
        ["*", X(["*", studio("Studio one")], ["*", studio("Studio two")])],
        [3, X(["*", lockers("Changing room", { maxBoxes: 2 })], rest(2), ["*", kit("Mat store")])]),
      exits: [{ side: "back", roles: ["storage"], chance: 0.5, lock: 0.5 }],
    };
  },
  // The lobby and the smoothie bar at the front, the pool, the spa; upstairs the cardio and weight floors, two studios
  // and the members' lounge round the upper hall.
  club(rng, d) {
    const flip = rng.chance(0.5), lw = 9;
    return {
      program: flipX(X(["*", Y([8, smoothie("Smoothie bar", { maxBoxes: 4 })], ["*", pool("Lap pool")])],
        [lw, Y([8, desk("Lobby")], ["*", R("hall", "uphall", { name: "Hall", hub: true, fl: "marble" })], [5, kit("Laundry and store")])],
        ["*", Y([8, spa("Spa")], ["*", lockers("Men's locker room")], ["*", lockers("Women's locker room")])]), flip),
      upper: () => flipX(X(["*", Y(["*", cardio("Cardio floor", { hub: false })], [8, studio("Spin studio")])],
        [lw, Y([8, hall("Upper hall")], ["*", gymOffice("Membership office")], [5, rest(5)[1]])],
        ["*", Y(["*", weights("Weight floor", { hub: false })], [8, studio("Pilates studio")], [6, R("living", "lounge", { name: "Members' lounge", type: "smoothie", fl: "carpet", maxBoxes: 2 })])]), flip),
      stairs: { roles: ["lobby", "hall"] },
      exits: [{ side: "back", roles: ["hall", "storage"], chance: 1, lock: 0.5 }],
    };
  },
  strip(rng, d) {
    return {
      program: Y([5, desk("Front desk", { vend: true })], [7, cardio("Cardio row")], ["*", weights("Weights")],
        [4, X(["*", lockers("Locker room", { maxBoxes: 2 })], rest(2), [3, kit("Store")])]),
      exits: [{ side: "back", roles: ["storage", "gym"], chance: 0.9, lock: 0.5 }],
    };
  },
  barn(rng, d) {
    return {
      program: Y([5, flipX(X(["*", R("living", "barnlounge", { name: "Lounge", type: "gymdesk", entry: true, hub: true, fl: "conc", maxBoxes: 2 })], [5, kit("Chalk and bar store")], rest(2)), rng.chance(0.5))],
        ["*", R("gym", "platforms", { name: "Lifting floor", type: "gymfloor", hub: true, fl: "rubber", maxBoxes: 3 })]),
      exits: [{ side: "back", roles: ["gym"], chance: 1, roller: true, width: 3, lock: 0.4, name: "Barn door" }],
    };
  },
  fitness(rng, d) {
    return {
      program: Y(["*", cardio("Fitness centre", { entry: true, maxBoxes: 2 })], [3, X(["*", lockers("Lockers", { maxBoxes: 1 })], rest(2))]),
      exits: [],
    };
  },
  circuit(rng, d) {
    return {
      program: Y([4, desk("Front desk")], ["*", R("gym", "circuit", { name: "Circuit floor", type: "gymfloor", hub: true, fl: "rubber", maxBoxes: 2 })],
        [3, X(["*", lockers("Changing room", { maxBoxes: 2 })], rest(2))]),
      exits: [{ side: "back", roles: ["lockerroom", "restroom"], chance: 0.4, lock: 0.5 }],
    };
  },
  // The desk and the supplement counter, the free weights; upstairs the bodybuilders' floor and the posing room.
  iron(rng, d) {
    const flip = rng.chance(0.5);
    return {
      program: Y([6, flipX(X(["*", desk("Desk and supplement counter", { shop: true })], [5, R("hall", "uphall", { name: "Stair hall", hub: true, fl: "conc" })], [5, gymOffice("Owner's office")]), flip)],
        ["*", weights("Free weights", { fl: "conc" })], [4, X(["*", lockers("Locker room", { maxBoxes: 2 })], rest(2), [4, kit("Store")])]),
      upper: () => Y([6, flipX(X(["*", R("gym", "posing", { name: "Posing room", type: "gymfloor", fl: "hardwood", maxBoxes: 1 })], [5, hall("Landing")], [5, rest(5)[1]]), flip)],
        ["*", weights("Bodybuilders' floor", { fl: "rubber" })]),
      stairs: { roles: ["hall"] },
      exits: [{ side: "back", roles: ["gym", "storage"], chance: 0.7, lock: 0.5 }],
    };
  },
};

// ---------- the bowling alleys' rooms ----------
const concourse = (name = "Concourse", o = {}) => R("lobby", "concourse", { name, type: "shoecounter", entry: true, hub: true, fl: "carpet", maxBoxes: 2, ...o });
const lanes = (name = "Lanes") => R("gym", "lanes", { name, type: "lanes", fl: "carpet", hub: true, windows: false, maxBoxes: 2 });
const pinroom = (name = "Pinsetter room") => R("workshop", "pinroom", { name, type: "pinsetter", fl: "conc", windows: false, maxBoxes: 4 });
const bowlbar = (name = "Bar and grill", o = {}) => R("dining", "bowlbar", { name, type: "bowlbar", fl: "hardwood", hub: false, maxBoxes: 3, ...o });
const bkitchen = (name = "Kitchen") => R("kitchen", "bowlkitchen", { name, type: "kitchen", maxBoxes: 3 });
const proshop = (name = "Pro shop") => R("sales", "proshop", { name, type: "proshop", fl: "carpet", hub: false, maxBoxes: 3 });
const arcade = (name = "Arcade") => R("arcade", "bowlarcade", { name, type: "arcade", hub: false, maxBoxes: 3 });
const party = (name = "Party room") => R("dining", "party", { name, type: "kitchen", fl: "carpet", hub: false, maxBoxes: 1 });
const boffice = (name = "Office") => R("office", "bowloffice", { name, type: "office", maxBoxes: 2 });
const bstore = (name = "Store room") => R("storage", "bowlstore", { name, type: "pinsetter", maxBoxes: 2 });
const counter = (name, o = {}) => R("dining", "lunch", { name, type: "kitchen", fl: "lino", hub: false, maxBoxes: 3, ...o });
const mechExit = { side: "back", roles: ["workshop"], chance: 1, lock: 0.5, name: "Mechanics' door" };
// The lanes and the pinsetter room behind them, under a front band (the concourse and its rooms).
const alley = (front, fd, more = []) => Y([fd, front], ...more, ["*", lanes()], [BOWL.MECH, pinroom()]);

const BOWL_PLANS = {
  classic(rng, d) {
    return { program: alley(flipX(X([6, counter("Coffee shop")], ["*", concourse("Concourse")], [5, boffice()], rest(2)), rng.chance(0.5)), 7), exits: [mechExit] };
  },
  mega(rng, d) {
    return {
      program: alley(flipX(X([14, arcade()], [8, party("Party room A")], [8, party("Party room B")], ["*", concourse("Concourse", { maxBoxes: 3 })], [7, proshop()], [14, bowlbar("Bar and grill", { maxBoxes: 4 })], [7, bkitchen()], [5, boffice()], rest(3)), rng.chance(0.5)), 9),
      exits: [mechExit, { side: "back", roles: ["kitchen"], chance: 0.3, lock: 0.6 }],
    };
  },
  bowlbar(rng, d) {
    return { program: alley(flipX(X(["*", bowlbar("The bar", { maxBoxes: 4, entry: true, hub: true })], [5, bkitchen()], rest(2)), rng.chance(0.5)), 8), exits: [mechExit] };
  },
  smalltown(rng, d) {
    return { program: alley(flipX(X([5, counter("Lunch counter")], ["*", concourse("Front counter")], [3, boffice("Office")]), rng.chance(0.5)), 6), exits: [mechExit] };
  },
  duckpin(rng, d) {
    return { program: alley(flipX(X(["*", concourse("Front counter")], [5, counter("Candy counter", { type: "shoecounter" })], [4, boffice("Old office")], rest(2)), rng.chance(0.5)), 6), exits: [mechExit] };
  },
  family(rng, d) {
    return {
      program: alley(flipX(X([10, arcade("Arcade and prize counter")], [8, R("gym", "lasertag", { name: "Laser tag arena", type: "arcade", fl: "carpet", windows: false, maxBoxes: 1 })], ["*", concourse("Concourse")], [7, party("Party room")], [7, counter("Snack bar")], rest(2)), rng.chance(0.5)), 10),
      exits: [mechExit],
    };
  },
  legion(rng, d) {
    return { program: alley(X(["*", bowlbar("Post bar", { entry: true, hub: true })], [4, boffice("Post office")]), 7), exits: [mechExit] };
  },
  glow(rng, d) {
    return { program: alley(flipX(X([12, arcade()], ["*", concourse("Concourse")], [6, proshop()], [12, bowlbar("Glow lounge")], [6, bkitchen()], rest(3)), rng.chance(0.5)), 8), exits: [mechExit] };
  },
  roadside(rng, d) {
    return { program: alley(flipX(X([12, counter("Diner", { maxBoxes: 4 })], [6, bkitchen("Diner kitchen")], ["*", concourse("Concourse")], [5, boffice()], rest(2)), rng.chance(0.5)), 8), exits: [mechExit, { side: "back", roles: ["kitchen"], chance: 0.4, lock: 0.6 }] };
  },
  billiards(rng, d) {
    return {
      program: alley(flipX(X(["*", concourse("Front counter")], [6, bowlbar("Bar")], [4, boffice()]), rng.chance(0.5)), 6, [[7, R("dining", "billiards", { name: "Billiards room", type: "bowlbar", fl: "carpet", hub: true, maxBoxes: 2 })]]),
      exits: [mechExit],
    };
  },
  // The street lobby, the bar and the pro shop on the ground floor, the store; the lanes on the floor above.
  downtown(rng, d) {
    const flip = rng.chance(0.5);
    return {
      program: flipX(X(["*", Y(["*", bowlbar("Bar")], [6, bkitchen()])], [7, Y(["*", concourse("Street lobby")], [4, boffice()])], ["*", Y(["*", proshop()], [6, bstore()])]), flip),
      upper: () => Y([5, flipX(X(["*", R("lobby", "concourse", { name: "Upper concourse", type: "shoecounter", hub: true, fl: "carpet", maxBoxes: 2 })], rest(3)), flip)], ["*", lanes()], [BOWL.MECH, pinroom()]),
      stairs: { roles: ["lobby"] },
      exits: [{ side: "back", roles: ["kitchen", "storage"], chance: 0.8, lock: 0.5 }],
    };
  },
  league(rng, d) {
    return {
      program: alley(flipX(X([8, R("classroom", "nursery", { name: "Nursery", type: "office", fl: "carpet", hub: false, maxBoxes: 1 })], [9, R("storage", "balllockers", { name: "League ball lockers", type: "proshop", maxBoxes: 3 })], [8, proshop()], ["*", concourse("Concourse", { maxBoxes: 3 })], [12, bowlbar("Restaurant and bar", { maxBoxes: 4 })], [7, bkitchen()], [5, boffice()], rest(3)), rng.chance(0.5)), 9),
      exits: [mechExit, { side: "back", roles: ["kitchen"], chance: 0.3, lock: 0.6 }],
    };
  },
  candlepin(rng, d) {
    return { program: alley(flipX(X(["*", concourse("Counter")], [6, counter("Lunch room")]), rng.chance(0.5)), 6), exits: [mechExit] };
  },
};

// ---------- the registry and the pick ----------
const mid = (r) => (r[0] + r[1]) / 2;
registerVariants("gym", Object.keys(GYM_PLANS).map((v) => ({ id: v, name: GYM_NAMES[v], w: GYM.W[v], foot: [mid(GYM.SIZE[v].w), mid(GYM.SIZE[v].h), mid(GYM.SIZE[v].storeys)], size: v, storeys: GYM.SIZE[v].storeys })));
registerVariants("bowling", Object.keys(BOWL_PLANS).map((v) => ({ id: v, name: BOWL_NAMES[v], w: BOWL.W[v], foot: [laneWidth(BOWL.SIZE[v].lanes), mid(BOWL.SIZE[v].h), mid(BOWL.SIZE[v].storeys)], size: v, storeys: BOWL.SIZE[v].storeys })));
export const GYM_KEYS = Object.keys(GYM_PLANS);
export const BOWL_KEYS = Object.keys(BOWL_PLANS);

/**
 * The picker's ctx for a building of kind key (o: buildingmaps.js makeSpec's: where, tileClass, site; variant or plan
 * a pin). sizeOf: the placement table's size class for the kind on the tile class (placement.js sizeFor, passed in so
 * this module stays free of the world's imports).
 * @param {any} o @param {(cls: string) => string | null} [sizeOf]
 */
const ctxOf = (o, sizeOf) => ({ setting: o.where || null, tileClass: o.tileClass || null, size: o.tileClass && sizeOf ? sizeOf(o.tileClass) : null, plan: o.variant || (typeof o.plan === "string" ? o.plan : null) });
// The footprint class (buildingmaps.js spec.foot, storeytest's classes): huge 1,800 cells and 50 wide, xl 700 and 30 wide.
const footOf = (bw, bh) => { const a = bw * bh; return a >= 1800 && bw >= 50 ? "huge" : a >= 700 && bw >= 30 ? "xl" : a > 360 ? "large" : a <= 190 ? "small" : "medium"; };

/**
 * A gym's spec for buildingmaps.js assemble: its variant by the shared picker (or o's pin), its footprint and storeys
 * from the variant's size, its plan. The spec carries rec: { type: "gym", variant }, vid, vname.
 * @param {any} rng @param {any} [o] @param {(cls: string) => string | null} [sizeOf]
 */
export function gymPlan(rng, o = {}, sizeOf) {
  const e = /** @type {any} */ (pickVariant("gym", rng, ctxOf(o, sizeOf)));
  const v = e && GYM_PLANS[e.id] ? e.id : "chain24";
  const S = GYM.SIZE[v];
  const bw = roll(rng, S.w), bh = roll(rng, S.h), n = roll(rng, S.storeys);
  const p = GYM_PLANS[v](rng, { bw, bh, n });
  return {
    bw, bh, front: { width: v === "fitness" || v === "dojo" || v === "yoga" ? 1 : 2 }, ground: v === "barn" ? "rural" : v === "ymca" || v === "club" ? "city" : "town",
    storeys: n, upper: n > 1 ? p.upper || null : null, foot: footOf(bw, bh), program: p.program, exits: p.exits || [], openDoors: 0.15,
    ...(p.stairs ? { stairs: p.stairs } : {}), rec: { type: "gym", variant: v }, vid: v, vname: GYM_NAMES[v], real: true,
  };
}
/**
 * A bowling alley's spec likewise: its width from its lane count (laneWidth), its depth from its variant.
 * @param {any} rng @param {any} [o] @param {(cls: string) => string | null} [sizeOf]
 */
export function bowlPlan(rng, o = {}, sizeOf) {
  const e = /** @type {any} */ (pickVariant("bowling", rng, ctxOf(o, sizeOf)));
  const v = e && BOWL_PLANS[e.id] ? e.id : "classic";
  const S = BOWL.SIZE[v];
  const bw = laneWidth(S.lanes), bh = roll(rng, S.h), n = roll(rng, S.storeys);
  const p = BOWL_PLANS[v](rng, { bw, bh, n });
  return {
    bw, bh, front: { width: 2 }, ground: v === "smalltown" || v === "legion" ? "rural" : v === "downtown" ? "city" : "town",
    storeys: n, upper: n > 1 ? p.upper || null : null, foot: footOf(bw, bh), program: p.program, exits: p.exits || [], openDoors: 0.1,
    ...(p.stairs ? { stairs: p.stairs } : {}), rec: { type: "bowling", variant: v, lanes: S.lanes }, vid: v, vname: BOWL_NAMES[v], real: true,
  };
}

// ======================================================================================
// The rooms (REC_STYLES, by the plan leaf's rec mark)
// ======================================================================================
/** @typedef {any} Lay */
const full = (L) => L.boxes() >= L.target();
const P = (L, o = {}) => ({ ...o, plain: full(L) });
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Lootable pieces of these kinds against the walls, then off them, until the room holds its share. */
function fill(L, kinds) {
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.wall(kinds[i % kinds.length], { prefer: "corner" })) miss = 0; else miss++; }
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.centre(kinds[i % kinds.length])) miss = 0; else miss++; }
}
/** Up to n of k against the walls. */
function some(L, k, n, o = {}) { let m = 0; for (let i = 0; i < n; i++) { if (!L.wall(k, P(L, o))) break; m++; } return m; }
/** Up to n of k off the walls. */
function centres(L, k, n, o = {}) { let m = 0; for (let i = 0; i < n; i++) { if (!L.centre(k, P(L, o))) break; m++; } return m; }
// The room's door fronts (the cell inside each door); the front door's the one nearest the street (the largest y).
function doorFronts(L) {
  const out = [];
  for (const [dx, dy] of L.room.doors || []) for (const [ex, ey] of D4) if (L.inRoom(dx + ex, dy + ey)) out.push([dx + ex, dy + ey]);
  return out;
}
const frontDoor = (L) => { const fr = doorFronts(L); return fr.length ? fr.sort((a, b) => b[1] - a[1])[0] : null; };
// A floor over the room's open cells (not its lanes: they keep the room's floor): mats, a drained pool's tiles.
function floorOver(L, fl, inset = 0) {
  const c = L.c;
  for (let y = c.y0 + inset; y <= c.y1 - inset; y++) for (let x = c.x0 + inset; x <= c.x1 - inset; x++) {
    const cl = c.cell(x, y);
    if (cl && cl.k === "open" && L.inRoom(x, y) && (!inset || !L.lane(x, y))) cl.fl = fl;
  }
}
// A counter run by the front door with its till (a front desk, a shoe counter): n pieces of k along the wall.
function counterRun(L, k = "counter", n = 3) {
  const d = frontDoor(L), near = d ? [d[0], d[1] - 2] : null;
  const first = L.wall(k, P(L, { prefer: "middle", ...(near ? { near } : {}) })) || L.centre(k, P(L, near ? { near } : {}));
  let last = first;
  for (let i = 1; i < n && last; i++) last = L.beside(last, k, P(L)) || last;
  if (first) L.around(first, "chair", 1);
  return first;
}
function tableSet(L, chairs = 4, k = "table") { const t = L.centre(k); if (t) L.around(t, "chair", chairs); return t; }
function deskAt(L) { const d = L.wall("desk", P(L, { prefer: "corner" })); if (d) L.around(d, "chair", 1); return d; }

export const REC_STYLES = {
  // ---------- the gyms ----------
  gymdesk(L) {
    counterRun(L, L.room.shop ? "displaycase" : "frontdesk", L.room.shop ? 2 : 1) || L.need("frontdesk");
    L.wall("watercooler", { prefer: "corner" });
    if (L.room.vend) L.wall("vending", { prefer: "corner" });
    if (L.room.shop) some(L, "shelf", 2, { prefer: "corner" });
    some(L, "loungechair", 2);
    fill(L, ["cabinet", "shelf"]);
  },
  cardio(L) {
    const c = L.c, n = Math.max(2, Math.floor((c.w * c.h) / 14));
    let m = centres(L, "treadmill", Math.ceil(n * 0.45), { face: "s" });
    m += centres(L, "exbike", Math.ceil(n * 0.3), { face: "s" });
    m += centres(L, "rower", Math.ceil(n * 0.25));
    if (!m) L.need("treadmill");
    L.wall("tvstand", { prefer: "middle" });
    L.wall("watercooler", { prefer: "corner" });
    if (L.room.entry) { L.wall("weightbench"); L.wall("dumbbells"); }
    fill(L, ["shelf", "locker"]);
  },
  weights(L) {
    const c = L.c, big = c.w * c.h;
    some(L, "squatrack", Math.max(1, Math.floor(big / 40)));
    some(L, "dumbbells", Math.max(1, Math.floor(big / 60)));
    const benches = Math.max(2, Math.floor(big / 30));
    centres(L, "weightbench", Math.ceil(benches / 2));
    some(L, "weightbench", Math.floor(benches / 2));
    L.wall("watercooler", { prefer: "corner" });
    if (!L.has("weightbench")) L.need("weightbench");
    fill(L, ["shelf", "locker"]);
  },
  studio(L) {
    some(L, "yogamats", 2, { prefer: "corner" });
    L.wall("tvstand", { prefer: "middle" });
    fill(L, ["cabinet", "shelf"]);
  },
  lockers(L) {
    const ws = L.walls();
    if (ws.length) L.run(["locker", "locker", "locker", "locker", "locker", "locker"], [ws[0].side], { plain: () => full(L) });
    L.wall("shower", { prefer: "corner" }); L.wall("shower", { prefer: "corner" });
    L.wall("sink", { prefer: "corner" });
    L.centre("campusbench");
    fill(L, ["locker"]);
  },
  smoothie(L) {
    const ws = L.walls();
    L.run(["counter", "coldcase", "counter", "fridge"], ws.length ? [ws[0].side] : ["n"], { plain: () => full(L) });
    for (const p of L.placed.filter((q) => q.k === "counter").slice(0, 2)) L.around(p, "barstool", 1);
    tableSet(L, 2) && tableSet(L, 2);
    fill(L, ["coldcase", "shelf"]);
  },
  lounge(L) { L.wall("sofa", { prefer: "middle" }); some(L, "loungechair", 3); L.wall("tvstand"); L.wall("fridge", { prefer: "corner" }); fill(L, ["cabinet", "coldcase"]); },
  gymoffice(L) { deskAt(L) || L.need("desk"); L.wall("filing", P(L, { prefer: "corner" })); fill(L, ["cabinet", "filing"]); },
  gymstore(L) { fill(L, ["shelf", "crate", "cabinet"]); },
  childcare(L) { tableSet(L, 4); some(L, "beanbag", 3); fill(L, ["shelf", "cabinet"]); },
  // The pool hall: the pool drained (its blue tiles two cells in from the walls), loungers round it, a lifeguard's locker.
  pool(L) {
    floorOver(L, "pool", 2);
    some(L, "lounger", 4);
    L.wall("campusbench");
    fill(L, ["locker", "shelf"]);
  },
  court(L) {
    const c = L.c, sides = c.w >= c.h ? ["n", "s"] : ["w", "e"];
    for (const s of sides) for (let i = 0; i < 3; i++) if (!L.wall("bleachers", { sides: [s] })) break;
    fill(L, ["sportcage", "locker"]);
  },
  spa(L) {
    L.centre("hottub") || L.need("hottub");
    some(L, "campusbench", 2);
    L.wall("loungechair");
    fill(L, ["cabinet", "shelf"]);
  },
  mats(L) {
    floorOver(L, "mat", 1);
    some(L, "yogamats", 2, { prefer: "corner" });
    fill(L, ["shelf", "cabinet"]);
  },
  // The ring: a square of canvas (mat) with a post at each corner off the walls; heavy bags along the walls.
  boxing(L) {
    const c = L.c, s = Math.min(6, c.w - 4, c.h - 4);
    if (s >= 3) {
      const x0 = c.x0 + Math.floor((c.w - s) / 2), y0 = c.y0 + Math.floor((c.h - s) / 2);
      for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) { const cl = c.cell(x, y); if (cl && cl.k === "open") cl.fl = "mat"; }
      for (const [x, y] of [[x0, y0], [x0 + s - 1, y0], [x0, y0 + s - 1], [x0 + s - 1, y0 + s - 1]]) L.place("ringpost", [[x, y]]);
    }
    some(L, "punchbag", 3);
    fill(L, ["locker", "shelf"]);
  },
  bags(L) { centres(L, "punchbag", 4); some(L, "punchbag", 2); fill(L, ["shelf"]); },
  cfwall(L) { centres(L, "rower", 4); L.wall("tvstand"); fill(L, ["shelf", "crate"]); },
  rig(L) {
    const c = L.c, big = c.w * c.h;
    some(L, "squatrack", Math.max(2, Math.floor(big / 35)));
    centres(L, "punchbag", 2);
    centres(L, "rower", 3);
    some(L, "dumbbells", 2);
    fill(L, ["crate", "shelf"]);
  },
  climb(L) {
    floorOver(L, "mat", 1);
    let n = 0;
    for (let i = 0; i < 60; i++) { if (!L.wall("climbwall")) break; n++; }
    if (!n) L.need("climbwall");
    fill(L, ["locker", "shelf"]);
  },
  platforms(L) {
    const c = L.c, big = c.w * c.h;
    some(L, "squatrack", Math.max(2, Math.floor(big / 30)));
    centres(L, "weightbench", 2);
    some(L, "dumbbells", 2);
    fill(L, ["crate", "shelf"]);
  },
  barnlounge(L) { L.wall("sofa"); L.wall("fridge", { prefer: "corner" }); L.wall("tvstand"); fill(L, ["cabinet", "shelf"]); },
  circuit(L) {
    // The ring of machines round the floor's walls, a recovery pad in the middle.
    let n = 0;
    for (const k of ["exbike", "rower", "weightbench", "exbike", "treadmill", "rower", "weightbench", "exbike"]) if (L.wall(k)) n++;
    if (!n) L.need("exbike");
    L.wall("watercooler", { prefer: "corner" });
    fill(L, ["shelf"]);
  },
  posing(L) { L.wall("tvstand", { prefer: "middle" }); some(L, "dumbbells", 1); fill(L, ["cabinet"]); },
  uphall(L) { L.wall("watercooler", { prefer: "corner" }); },
  // ---------- the bowling alleys ----------
  concourse(L) {
    counterRun(L, "counter", 3) || L.need("counter");
    const cub = L.placed.find((p) => p.k === "counter");
    if (cub) L.beside(cub, "shoecubby");
    some(L, "shoecubby", 1);
    some(L, "ballrack", Math.max(1, Math.floor(L.c.w / 10)));
    L.wall("vending", { prefer: "corner" });
    tableSet(L, 4); tableSet(L, 4);
    fill(L, ["cabinet", "shelf"]);
  },
  // The lanes: across the room, a walkway by each wall, then lane pairs (a lane, the ball-return gutter, a lane, the
  // divider): the settee's scorers and seats at the front, the approach (its ball return), the lane boards (the
  // pins at the far end, their deck against the pinsetter room).
  lanes(L) {
    const c = L.c, front = c.y1, settee = BOWL.SETTEE, appr = BOWL.APPROACH;
    if (c.h < settee + appr + 4) { L.need("scorer"); return; }
    for (let x = c.x0 + 1; x <= c.x1 - 1; x++) {
      const k = (x - c.x0 - 1) % 4, laneCell = k === 0 || k === 2;
      for (let y = c.y0; y <= front - settee; y++) {
        const cl = c.cell(x, y);
        if (!cl || cl.k !== "open" || !L.inRoom(x, y)) continue;
        cl.fl = y > front - settee - appr ? "hardwood" : laneCell ? "lane" : "gutter";
      }
      if (laneCell) L.place("pins", [[x, c.y0]]);
      else if (k === 1) {
        L.place("ballreturn", [[x, front - settee - 1]]);
        L.place("scorer", [[x, front - 1]], { face: "n" }) || L.place("scorer", [[x, front - 2]], { face: "n" });
        L.place("loungechair", [[x, front]], { face: "n" }); L.place("loungechair", [[x - 1, front]], { face: "n" }); L.place("loungechair", [[x + 1, front]], { face: "n" });
      }
    }
    fill(L, ["shelf", "cabinet"]);
  },
  // The pinsetter room: a pinsetter at the end of every lane against the lane wall, a workbench and the parts behind.
  pinroom(L) {
    const c = L.c;
    for (let x = c.x0 + 1; x <= c.x1 - 1; x++) { const k = (x - c.x0 - 1) % 4; if (k === 0 || k === 2) L.place("pinsetter", [[x, c.y1]], { face: "n" }); }
    const bench = L.wall("workbench", P(L, { sides: ["n"], prefer: "corner" })) || L.wall("workbench", P(L));
    if (bench) L.beside(bench, "toolchest", P(L));
    fill(L, ["toolchest", "shelf", "crate"]);
  },
  bowlbar(L) {
    const ws = L.walls();
    L.run(["counter", "counter", "fridge", "counter", "counter"], ws.length ? [ws[0].side] : ["n"], { plain: () => full(L) });
    for (const p of L.placed.filter((q) => q.k === "counter").slice(0, 4)) L.around(p, "barstool", 1);
    L.wall("jukebox", { prefer: "corner" });
    tableSet(L, 4); tableSet(L, 4);
    fill(L, ["shelf", "cabinet"]);
  },
  lunch(L) {
    const ws = L.walls();
    L.run(["counter", "coldcase", "counter", "counter"], ws.length ? [ws[0].side] : ["n"], { plain: () => full(L) });
    for (const p of L.placed.filter((q) => q.k === "counter").slice(0, 3)) L.around(p, "barstool", 1);
    tableSet(L, 4);
    fill(L, ["shelf", "cabinet"]);
  },
  bowlkitchen(L) {
    const ws = L.walls();
    L.run(["fridge", "range", "fryer", "sink", "counter"], ws.length ? [ws[0].side] : ["n"]);
    for (const k of ["fridge", "sink"]) if (!L.has(k)) L.need(k);
    fill(L, ["shelf", "cabinet"]);
  },
  proshop(L) {
    counterRun(L, "displaycase", 2);
    some(L, "ballrack", 2);
    L.wall("workbench", P(L, { prefer: "corner" })); // the ball-drilling bench
    fill(L, ["shelf", "displaycase"]);
  },
  balllockers(L) { const ws = L.walls(); if (ws.length) L.run(["locker", "locker", "locker", "locker", "locker"], [ws[0].side], { plain: () => full(L) }); fill(L, ["locker"]); },
  bowlarcade(L) {
    some(L, "arcadecab", Math.max(3, Math.floor((L.c.w * L.c.h) / 12)));
    counterRun(L, "counter", 2);
    fill(L, ["cabinet", "shelf"]);
  },
  lasertag(L) { centres(L, "crate", 6); fill(L, ["shelf"]); },
  party(L) { tableSet(L, 4); tableSet(L, 4); fill(L, ["cabinet", "fridge"]); },
  billiards(L) { centres(L, "pooltable", Math.max(1, Math.floor((L.c.w * L.c.h) / 24))); L.wall("jukebox", { prefer: "corner" }); fill(L, ["shelf", "cabinet"]); },
  nursery(L) { tableSet(L, 4); some(L, "beanbag", 2); fill(L, ["shelf"]); },
  bowloffice(L) { deskAt(L) || L.need("desk"); L.wall("safe", { prefer: "corner" }); fill(L, ["cabinet", "filing"]); },
  bowlstore(L) { fill(L, ["shelf", "crate"]); },
};
/** The rec style for a room (buildingmaps.js assemble): its plan leaf's rec mark. null: none. @param {any} room */
export function recStyle(room) {
  return room && room.rec && REC_STYLES[room.rec] ? REC_STYLES[room.rec] : null;
}

// ======================================================================================
// The signs of survival (interiorscenes.js registerScene; their own dice there, only on a building laid out by these
// plans: when):
//   recshelter  the gym as a shelter: cots in rows on the court, the mats or a studio, a water barrel, the ones who never
//               left;
//   lockerhold  someone held out in a locker room: lockers shoved across its door, the one behind them (alive upstairs
//               now and then: area.scene.alive);
//   pinhide     the mechanic's last hideout behind the pinsetters: a body among the machines, a pile of tools and tins;
//   leaguenight the league sheet on a scorer's console: the last night's scores and a note.
// ======================================================================================
const recRooms = (ctx, marks) => ctx.rng.shuffle(ctx.rooms.filter((r) => marks.includes(r.rec) && !r.scene && !r.locked));
const lower = (r) => String(r.name || "room").toLowerCase();
const nearest = (cells, x, y) => cells.slice().sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y));
function gymShelter(ctx) {
  const { rng } = ctx;
  for (const r of recRooms(ctx, ["court", "mats", "studio", "cardio", "rig", "platforms"])) {
    const f = r.f || 0, free = rng.shuffle(ctx.freeIn(r));
    if (free.length < 8) continue;
    const cots = Math.min(free.length - 2, rng.int(GYM.SHELTER_COTS[0], GYM.SHELTER_COTS[1]));
    for (const [x, y] of free.slice(0, cots)) ctx.piece(f, x, y, "cot");
    const [bx, by] = free[cots];
    ctx.piece(f, bx, by, "barrel");
    const dead = rng.int(0, 2);
    for (const [x, y] of free.slice(cots + 1, cots + 1 + dead)) ctx.body(f, x, y, { human: true, quiet: true });
    return ctx.done("recshelter", r, free[0][0], free[0][1], `The ${lower(r)} was a shelter: ${cots} cots in rows, a water barrel${dead ? `, and ${dead} who never left` : ""}.`);
  }
  return null;
}
function lockerHold(ctx) {
  const { rng } = ctx;
  for (const r of recRooms(ctx, ["lockers"])) {
    const f = r.f || 0, ds = r.doors || [];
    if (!ds.length) continue;
    const [dx, dy] = ds[0];
    const free = ctx.freeIn(r), near = nearest(free, dx, dy).filter(([x, y]) => Math.abs(x - dx) + Math.abs(y - dy) <= 2);
    if (!near.length || free.length < 4) continue;
    for (const [x, y] of near.slice(0, 2)) ctx.piece(f, x, y, rng.pick(["locker", "shelf"]));
    if (f && rng.chance(SCENES.ALIVE)) return ctx.done("lockerhold", r, dx, dy, `Lockers shoved across the door of the ${lower(r)}: someone is still holding out behind them.`, { alive: true });
    const [x, y] = nearest(ctx.freeIn(r), dx, dy).reverse()[0] || free[free.length - 1];
    ctx.body(f, x, y, { human: true });
    ctx.splatter(f, x, y, "human", 1);
    return ctx.done("lockerhold", r, dx, dy, `Someone held out in the ${lower(r)} with the lockers shoved across the door. Not long enough.`);
  }
  return null;
}
function pinHide(ctx) {
  const { rng } = ctx;
  for (const r of recRooms(ctx, ["pinroom"])) {
    const f = r.f || 0, free = rng.shuffle(ctx.freeIn(r));
    if (free.length < 3) continue;
    const [x, y] = free[0];
    ctx.body(f, x, y, { human: true, quiet: true, name: "The mechanic" });
    ctx.pile(f, free[1][0], free[1][1], "A toolbox, empty tins and a jug", { scrap: rng.int(1, 3), water: rng.chance(0.5) ? 1 : 0 }, r.id);
    return ctx.done("pinhide", r, x, y, `Behind the pinsetters, the mechanic's last hideout: a bedroll among the machines, empty tins, and the mechanic.`);
  }
  return null;
}
function leagueNight(ctx) {
  for (const r of recRooms(ctx, ["lanes"])) {
    const f = r.f || 0;
    const sc = ctx.inner(r).find(([x, y]) => (ctx.at(f, x, y) || {}).k === "scorer");
    if (!sc) continue;
    const near = D4.map(([dx, dy]) => [sc[0] + dx, sc[1] + dy]).find(([x, y]) => ctx.free(f, x, y));
    if (near) { const c = ctx.at(f, near[0], near[1]); c.deco = { k: "papers", v: 0 }; ctx.take(f, near[0], near[1]); }
    const lines = [
      "TUESDAY LEAGUE CANCELLED. Lanes closed by order of the county. Refunds when we reopen.",
      "Gutter Kings 612, Pin Pals 598. Dale rolled a 247 and nobody will ever believe it.",
      "We're in the pinsetter room. Don't come back here unless you knock twice.",
      "Took the cash box and the first aid kit. Sorry, Mr. Kowalski. — R.",
    ];
    return ctx.done("leaguenight", r, sc[0], sc[1], `A league sheet left on a scoring console: "${ctx.rng.pick(lines)}"`);
  }
  return null;
}
const isRecMap = (ctx) => ctx.rooms.some((r) => !!r.rec);
registerScene("recshelter", { w: 4, place: gymShelter, kinds: ["gym"], when: isRecMap });
registerScene("lockerhold", { w: 3, place: lockerHold, kinds: ["gym"], when: isRecMap });
registerScene("pinhide", { w: 3, place: pinHide, kinds: ["bowling"], when: isRecMap });
registerScene("leaguenight", { w: 4, place: leagueNight, kinds: ["bowling"], when: isRecMap });
