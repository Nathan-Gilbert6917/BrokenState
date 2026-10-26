// @ts-check
// A dozen layout variants for every shop and service (the user's requests 2026-10-25: "every building should have
// several varients"; "for buildings with no to only a few varients create a dozen varients per building type"; issue
// #35 of the interiors epic #7). The pharmacy, the gas station, the truck stop, every franchise shop kind (gun store,
// pawn shop, sporting goods, electronics, radio, books, pets, garden, clothing, liquor, hardware), the feed store, the
// car dealer, the auto shop, the garage, the workshop, the bank and #22's grocery tiers (the corner store, the grocery,
// the supermarket): 12 named plans each, a new save's (buildingmaps.js calls shopVariantSpec; an older save, o.legacy,
// keeps the plan it always had: the roomsLegacy rule).
//
// A variant is a plan of its own, not a recolour: it differs from every other of its type in at least two of the room
// list, the arrangement (VARIANT_LAYS), the entrances, a corridor or an open plan, the size (SIZES) and the storeys
// (tools/shopvarianttest.js checks every pair). Each is data: a row of VARIANTS[type] with
//   id, name     the variant's id and the name the place and its map show ("Drive-through pharmacy"; a franchise's
//                place shows its franchise's name, the variant under it: layoutName; the map's plan.variant and vid, the
//                raid's opening lines, as #37's plans);
//   w            its weight by setting [rural, town, city, highway, strip] (SETTINGS; no setting: every variant alike);
//   size         the footprint's class (SIZES by type: S, M, L, XL, the quarters of #24's real-world size);
//   lay          the arrangement (below), depth the front room's share of the depth (else the type's);
//   front        the front band's rooms, left to right ("S" the sales floor; none: the sales floor alone);
//   mid, back    the middle band's and the back strip's rooms, left to right; side the side column's, front to back
//                (sideW its width);
//   ex           the ways out besides the front door (EXITS); bays a service bay at one end ({ w, leaf, width, ex });
//   st, up       the storeys (a number, or [a, b]: the dice) and the plan upstairs (UPPER);
//   pumps, ground, fw  the fuel pumps on the lot, the ground outside, the front door's width.
// A room is a token of the type's ROOMS (its signature rooms: the pharmacy's dispensary, the gun store's locked gun
// cage, the bank's vault and ATM), of COMMON, a ROLES key or a leaf of its own; a size is cells, [a, b] (the dice), a
// share (< 1) or "*" (the rest).
//
// Layouts (VARIANT_LAYS):
//   strip     the front band over a back strip of rooms side by side (the usual shop);
//   corridor  the front band, a corridor along the building, the back strip behind it;
//   deep      the front band, a middle band (a counter room, offices across), the back strip;
//   side      the front band the full depth (the back strip under it, if any), a column of rooms down one side (the
//             dice pick the side);
//   wrap      an L of rooms: the back strip and a column down one side.
//
// Picking (shopVariant): o.plan (a variant's id, buildingmaps.js option.plan as #37's: a strip mall's slot, a test, a
// render; o.layout the same) first; else the franchise's
// variants (data-shops.js FRANCHISES plan.variants: a franchise maps to the plans that fit it) weighted by the setting
// (o.vset: buildingmaps.js variantSetting from the tile; o.setting a caller's own: a strip mall's slot), drawn on the building's
// dice (the plan's first roll). A kind without franchises names its variants itself.
//
// For a strip mall (#30): shopPlan(kind, { size, setting, layout, variant }) returns the spec of a kind's plan for a slot.
import { planName } from "./planname.js"; // a plan's name, one field (issue #40)
import { FRANCHISES } from "./data-shops.js";
import { Rng } from "./rng.js";
import { ROLES } from "./buildingmaps.js"; // the rooms' usual containers (read when a plan is made: no cycle at load)
import { eateryVariant } from "./eaterylayout.js"; // a truck stop's diner is one of #33's diners (issue #33's table)
import { REAL_SIZE, CELL_M } from "./data-buildingsize.js"; // #24's real-world sizes: the classes below are its rows' quarters

export const SETTINGS = ["rural", "town", "city", "highway", "strip"];
const W = (rural, town, city, highway, strip) => [rural, town, city, highway, strip];
const BACK_STAIRS = ["stock", "warefloor", "office", "storage", "breakroom", "kitchen", "pantry", "parts", "bays", "workshop"];
export const VARIANT_LAYS = ["strip", "corridor", "deep", "side", "wrap"];

// ---------- the footprints (cells, outer walls included: [w0, w1, h0, h1]) by type and class ----------
// #24's real-world size of the type (data-buildingsize.js REAL_SIZE: metres across the front and front to back, CELL_M
// a cell) cut into quarters: S the smallest quarter, M the next, L, XL the biggest; #22's tiers (REAL_SIZE own) keep
// #22's footprints (TIER_SIZES). REAL_SIZE marks these rows planned: buildingmaps.js realScale leaves them as drawn.
const TIER_SIZES = {
  corner: { S: [10, 11, 10, 11], M: [11, 13, 10, 12], L: [13, 14, 11, 12] },          // #22: 10–14 across
  grocery: { S: [20, 21, 17, 18], M: [20, 23, 17, 20], L: [23, 26, 18, 20] },         // #22: 20–26 × 17–20
  supermarket: { M: [54, 56, 36, 38], L: [56, 58, 37, 40] },                          // #22: 54–58 × 36–40
};
const quarters = ([a, b]) => [0, 1, 2, 3].map((i) => [Math.round((a + ((b - a) * i) / 4) / CELL_M), Math.round((a + ((b - a) * (i + 1)) / 4) / CELL_M)]);
/** @param {string} key */
function realSizes(key) {
  const R = REAL_SIZE[key];
  const w = quarters(R.w), d = quarters(R.d);
  return Object.fromEntries(["S", "M", "L", "XL"].map((c, i) => [c, [w[i][0], w[i][1], d[i][0], d[i][1]]]));
}
const SIZED = ["pharmacy", "gunstore", "pawnshop", "sportshop", "electronics", "radioshop", "bookstore", "petstore", "garden", "clothing", "liquor", "hardware", "feedstore", "gasstation", "truckstop", "dealer", "bank", "autoshop", "garage", "workshop"];
/** @type {Record<string, Record<string, number[]>>} */
export const SIZES = { ...Object.fromEntries(SIZED.map((k) => [k, realSizes(k)])), ...TIER_SIZES };

// ---------- rooms shared by every type ----------
const COMMON = {
  office: { role: "office" },
  safeoff: { role: "office", boxLock: ["safe", 0.3] },
  mgr: { role: "office", name: "Manager's office", boxLock: ["safe", 0.3] },
  wc: { role: "restroom" },
  brk: { role: "breakroom" },
  stock: { role: "stock" },
  store: { role: "storage", name: "Storeroom", type: "store" },
  records: { role: "storage", name: "Records", type: "office", lock: ["door", 0.3] },
};

// ---------- the ways out (besides the front door) ----------
const BACKS = ["stock", "kitchen", "pantry", "office", "bays", "storage", "parts", "warefloor", "workshop", "breakroom", "restroom", "dispensary"];
/** @param {string} t @param {{ side: string, other: string, col: string | null }} s */
function exitOf(t, s) {
  switch (t) {
    case "back": return { side: "back", roles: BACKS, chance: 0.9, lock: 0.3 };
    case "back!": return { side: "back", roles: BACKS, chance: 1, lock: 0.3 };
    case "side": return { side: s.other, roles: ["sales", "dining", "lobby", "bays", "workshop"], chance: 1, lock: 0.5, name: "Side door" };
    case "fire": return { side: s.other, roles: ["sales", "dining", "lobby", "warefloor", "stock"], chance: 1, lock: 0.4, name: "Fire exit" };
    case "front2": return { side: "front", roles: ["sales", "dining", "lobby"], chance: 1, lock: 0.2, name: "Second entrance" };
    case "dock": return { side: "back", roles: ["warefloor", "stock", "storage", "parts", "bays"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Loading door" };
    case "yard": return { side: s.col || s.side, roles: ["warefloor", "storage", "bays", "stock"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Yard gate" };
    case "drive": return { side: s.col || s.side, roles: ["storage", "office", "lobby"], chance: 1, lock: 0.5, name: "Drive-through window" };
    case "bayback": return { side: "back", roles: ["bays", "workshop"], chance: 1, roller: true, width: 2, lock: 0.2, name: "Back bay door" };
    case "bay2": return { side: "front", roles: ["bays", "workshop"], chance: 1, roller: true, width: 2, lock: 0.2, name: "Bay door" };
    default: throw new Error(`shopvariants: no exit ${t}`);
  }
}

// ---------- the plans upstairs ----------
const leaves = (list) => list.map(([s, r]) => [s, typeof r === "string" ? { role: r } : r]);
const Xs = (ps) => (ps.length === 1 ? ps[0][1] : { split: "x", parts: ps });
const Ys = (ps) => (ps.length === 1 ? ps[0][1] : { split: "y", parts: ps });
/** @type {Record<string, (g: number, rng: Rng, ctx: any) => any>} */
const UPPER = {
  // the shop's flat (its rooms take the home styles: roomlayout.js)
  flat: (g, rng, ctx) => Ys([["*", Xs(leaves([["*", { role: "living", name: "Flat: living room", flat: true }], ["*", { role: "kitchen", name: "Flat: kitchen", flat: true }]]))], [1, { role: "hall", name: "Landing", flat: true }], ["*", Xs(leaves(ctx.bw < 13 ? [["*", { role: "bedroom", flat: true }], [2, { role: "bath", flat: true }]] : [["*", { role: "bedroom", flat: true }], [2, { role: "bath", flat: true }], ["*", { role: "bedroom", flat: true }]]))]]),
  // offices above (a bank's, a co-op's, a dealer's finance floor)
  offices: () => Ys([["*", Xs(leaves([["*", "office"], [4, { role: "office", name: "Meeting room" }], ["*", "office"]]))], [1, { role: "corridor" }], ["*", Xs(leaves([["*", { role: "storage", name: "Records", type: "office", lock: ["door", 0.3] }], [4, "breakroom"], [2, "restroom"]]))]]),
  // an upper stockroom (a mezzanine of overstock) and an office
  stock: (g, rng, ctx) => Ys([["*", { role: "stock", name: "Upper stockroom", ...(ctx.type ? { type: ctx.type } : {}) }], [4, Xs(leaves([["*", "office"], [3, "restroom"]]))]]),
  // a second sales floor (a two-floor store)
  sales: (g, rng, ctx) => Ys([["*", { role: "sales", name: "Upper sales floor", type: ctx.type, maxBoxes: 5 }], [4, Xs(leaves([["*", { role: "stock", name: "Upper stockroom", ...(ctx.type ? { type: ctx.type } : {}) }], [3, "restroom"]]))]]),
  // a grain loft or a hay loft (a feed mill)
  loft: () => Ys([["*", { role: "storage", name: "Grain loft", type: "barn" }], [3, Xs(leaves([["*", { role: "storage", name: "Sack store", type: "warehouse" }]]))]]),
  // drivers' bunks above a truck stop
  bunks: () => Ys([["*", Xs(leaves([["*", { role: "bunk", name: "Drivers' bunk room", type: "cabin" }], ["*", { role: "bunk", name: "Drivers' bunk room", type: "cabin" }]]))], [1, { role: "corridor" }], ["*", Xs(leaves([["*", { role: "bath", name: "Showers" }], ["*", { role: "storage", name: "Linen store", type: "cabin" }]]))]]),
};

// ---------- the types ----------
// Each type: base (the sales floor's leaf: the front room), depth (its usual share), rooms (its own tokens), ground,
// pumps, fw (the front door's width), stairs, and VARIANTS[type] (below). The franchise shops share one set of 12
// arrangements (SHOP12) filled with each kind's own rooms and names.
/** @typedef {{ id: string, name: string, w: number[], size: string, lay?: string, depth?: number, front?: any[], mid?: any[], back?: any[], side?: any[], sideW?: any, ex?: string[], st?: number | number[], up?: string, bays?: any, pumps?: number, ground?: string, fw?: number, sales?: any, midD?: any }} Variant */
const S = "S"; // the sales floor in a band
/**
 * The 12 arrangements of a franchise shop kind (each kind's rooms: sig, its signature back room, in every plan; sig2 a
 * second room of its kind; extra a second front room; yard its yard or warehouse; stock; safeoff its office).
 * @param {Record<string, string>} n the variants' names by id
 * @returns {Variant[]}
 */
const SHOP12 = (n, sigS = [3, 4]) => [
  { id: "main", name: n.main, w: W(0.8, 1, 0.6, 0.3, 0.4), size: "M", lay: "strip", back: [[sigS, "sig"], ["*", "stock"], [[3, 4], "safeoff"]], ex: ["back"] },
  { id: "narrow", name: n.narrow, w: W(0.4, 1, 1, 0, 0.2), size: "S", lay: "strip", depth: 0.68, back: [["*", "stock"], [sigS, "sig"]], ex: ["back"], st: 2, up: "flat" },
  { id: "corner", name: n.corner, w: W(0.4, 0.8, 1, 0.3, 0.3), size: "M", lay: "strip", back: [["*", "stock"], [sigS, "sig"], [2, "wc"]], ex: ["back", "side"] },
  { id: "strip", name: n.strip, w: W(0.2, 0.6, 0.4, 0.5, 1), size: "S", lay: "strip", depth: 0.72, back: [[sigS, "sig"], ["*", "stock"]], ex: ["back!"] },
  { id: "superstore", name: n.superstore, w: W(0, 0.5, 0.8, 0.6, 0.8), size: "XL", lay: "corridor", back: [["*", "stock"], [[4, 5], "sig"], [4, "sig2"], [4, "brk"], [3, "mgr"], [2, "wc"]], ex: ["dock", "front2"], fw: 2 },
  { id: "outlet", name: n.outlet, w: W(0.6, 0.4, 0.1, 1, 0.4), size: "L", lay: "side", sideW: [6, 7], side: [[[4, 5], "sig"], ["*", "yard"]], ex: ["yard"] },
  { id: "twofloor", name: n.twofloor, w: W(0.2, 0.6, 1, 0.2, 0.5), size: "M", lay: "strip", back: [["*", "stock"], [sigS, "sig"], [3, "office"]], ex: ["back", "fire"], st: 2, up: "sales" },
  { id: "wrap", name: n.wrap, w: W(0.5, 0.8, 0.5, 0.5, 0.5), size: "M", lay: "wrap", sideW: 4, side: [[3, "office"], ["*", "wc"]], back: [[sigS, "sig"], ["*", "stock"]], ex: ["back"] },
  { id: "counter", name: n.counter, w: W(0.6, 0.8, 0.6, 0.3, 0.3), size: "M", lay: "deep", depth: 0.5, midD: [3, 4], mid: [["*", "sig2"], [sigS, "sig"]], back: [["*", "stock"], [3, "office"]], ex: ["back"] },
  { id: "twin", name: n.twin, w: W(0.3, 0.7, 1, 0.3, 0.6), size: "L", lay: "strip", front: [[0.6, S], ["*", "extra"]], back: [["*", "stock"], [sigS, "sig"], [3, "mgr"], [2, "wc"]], ex: ["front2", "back"], fw: 2 },
  { id: "roadside", name: n.roadside, w: W(1, 0.6, 0, 1, 0), size: "L", lay: "side", sideW: [5, 6], side: [["*", "stock"], [sigS, "sig"]], ex: ["side", "back"], st: [1, 2], up: "flat", ground: "rural" },
  { id: "flagship", name: n.flagship, w: W(0, 0.3, 1, 0.2, 0.3), size: "XL", lay: "corridor", front: [[0.3, "extra"], ["*", S]], back: [["*", "stock"], [[4, 5], "sig"], [4, "sig2"], [4, "office"], [2, "wc"]], ex: ["front2", "back", "dock"], st: 2, up: "offices", fw: 2 },
];

/** @type {Record<string, any>} */
export const VARIANT_TYPES = {
  // ---------- the pharmacy: the dispensary in every plan ----------
  pharmacy: {
    base: { name: "Pharmacy", type: "pharmacy" }, depth: 0.62,
    rooms: {
      disp: { role: "dispensary", lock: ["door", 0.65], boxLock: ["drugs", 0.5] },
      pstock: { role: "stock", type: "pharmacy" },
      drive: { role: "storage", name: "Drive-through window", type: "pharmacy", maxBoxes: 1 },
      photo: { role: "office", name: "Photo counter", type: "store" },
      fountain: { role: "dining", name: "Soda fountain", type: "store", lay: "diner", hub: false },
      compound: { role: "dispensary", name: "Compounding lab", type: "pharmacy", lock: ["door", 0.5], boxLock: ["drugs", 0.4] },
      consult: { role: "office", name: "Consultation room", type: "pharmacy", maxBoxes: 1 },
      waiting: { role: "lobby", name: "Waiting area", type: "office", hub: true, maxBoxes: 1 },
      vaccine: { role: "pantry", name: "Vaccine fridge room", type: "pharmacy", cold: true, dk: "steel", windows: false, fl: "steel", maxBoxes: 1 },
      recv: { role: "warefloor", name: "Receiving", type: "pharmacy", hub: false, maxBoxes: 4 },
    },
  },
  // ---------- the gas station: its pumps in every plan ----------
  gasstation: {
    boxes: 0.5,
    base: { name: "Shop", type: "store" }, depth: 0.6, pumps: 2, ground: "lot",
    rooms: {
      gstock: { role: "stock", name: "Storeroom" },
      bay: { role: "bays", name: "Service bay", maxBoxes: 3 },
      wash: { role: "bays", name: "Car wash", type: "garage", maxBoxes: 1 },
      tyre: { role: "bays", name: "Tyre shop", maxBoxes: 3 },
      tyrestore: { role: "parts", name: "Tyre store", type: "garage" },
      snack: { role: "dining", name: "Coffee and snack bar", type: "store", lay: "cafe", hub: false },
      deli: { role: "dining", name: "Deli counter", type: "store", lay: "cafe", hub: false },
      lunch: { role: "dining", name: "Lunch counter", type: "store", lay: "diner", hub: false },
      feed: { role: "storage", name: "Feed and seed", type: "barn" },
      bait: { role: "storage", name: "Bait room", type: "sportshop" },
      attend: { role: "office", name: "Attendant's office" },
      showers: { role: "restroom", name: "Showers" },
      cooler: { role: "pantry", name: "Walk-in cooler", type: "kitchen", cold: true, dk: "steel", windows: false, fl: "steel", maxBoxes: 1 },
      parts: { role: "parts", name: "Parts room" },
    },
  },
  // ---------- the truck stop: the shop and the diner in every plan (#33 owns restaurants; this diner is the stop's) ----------
  truckstop: {
    base: { name: "Shop", type: "store" }, depth: 0.55, pumps: 3, ground: "lot", fw: 2,
    eatery: { diner: "eatdiner", kit: "eatkitchen" }, // #33's styles for its diner and kitchen
    boxes: 1.05, // the rest of the stop: #33's diner and kitchen hold what its table sets by their area
    rooms: {
      diner: { role: "dining", name: "Diner", type: "store", hub: true },
      kit: { role: "kitchen", fry: true },
      tstock: { role: "stock", name: "Storeroom" },
      toff: { role: "office", lock: ["door", 0.3], boxLock: ["safe", 0.3] },
      showers: { role: "restroom", name: "Showers" },
      lounge: { role: "lobby", name: "Drivers' lounge", type: "office", hub: false, maxBoxes: 1 },
      chapel: { role: "nave", name: "Chapel", hub: false, maxBoxes: 1 },
      scale: { role: "office", name: "CAT scale house" },
      tyre: { role: "bays", name: "Tyre shop", maxBoxes: 3 },
      bay: { role: "bays", name: "Service bay", maxBoxes: 3 },
      truckwash: { role: "bays", name: "Truck wash", maxBoxes: 1 },
      food: { role: "dining", name: "Food court", type: "store", lay: "cafe", hub: false },
      feed: { role: "storage", name: "Feed room", type: "barn" },
      recv: { role: "warefloor", name: "Receiving", type: "store", hub: false, maxBoxes: 3 },
    },
  },
  // ---------- the franchise shops (data-shops.js): each kind's own rooms in SHOP12's arrangements ----------
  gunstore: {
    base: { name: "Showroom", type: "gunshop", furnish: "gundesk", maxBoxes: 4 }, depth: 0.62,
    rooms: {
      sig: { role: "armory", name: "Gun cage", type: "gunshop", lock: ["vault", 0.8], boxLock: ["cage", 0.6], maxBoxes: 3 },
      stock: { role: "stock", type: "store", name: "Back room", maxBoxes: 3 },
      safeoff: { role: "office", gunSafe: ["gunsafe2", 0.5] },
      sig2: { role: "workshop", name: "Gunsmith's bench", type: "gunshop" },
      extra: { role: "sales", name: "Ammo and reloading", type: "gunshop", hub: false, maxBoxes: 3 },
      yard: { role: "storage", name: "Indoor range", type: "gunshop", maxBoxes: 2 },
    },
    variants: SHOP12({ main: "Main street gun shop", narrow: "Gun shop with the owner's flat above", corner: "Corner gun shop with a side door", strip: "Strip-mall gun counter", superstore: "Tactical supply superstore", outlet: "Gun shop with an indoor range", twofloor: "Two-floor firearms store", wrap: "Gun shop with an L of back rooms", counter: "Gunsmith and gun shop", twin: "Guns and ammo, two shopfronts", roadside: "Roadside hunting and gun shop", flagship: "Flagship firearms outfitter" }, [4, 5]),
  },
  pawnshop: {
    boxes: 1.05,
    base: { name: "Pawn counter", type: "pawnshop", maxBoxes: 6 }, depth: 0.62,
    rooms: {
      sig: { role: "armory", name: "Gun case", type: "gunshop", lock: ["door", 0.6], boxLock: ["cage", 0.5], maxBoxes: 3 },
      stock: { role: "stock", type: "pawnshop", name: "Back room", maxBoxes: 4 },
      safeoff: { role: "office", gunSafe: ["gunsafe2", 0.3] },
      sig2: { role: "storage", name: "Jewellery safe room", type: "pawnshop", lock: ["door", 0.5], boxLock: ["safe", 0.4], maxBoxes: 2 },
      extra: { role: "sales", name: "Electronics and tools", type: "pawnshop", hub: false, maxBoxes: 3 },
      yard: { role: "warefloor", name: "Storage yard", type: "pawnshop", hub: false, maxBoxes: 4 },
    },
    variants: SHOP12({ main: "Main street pawn shop", narrow: "Pawn shop with a flat above", corner: "Corner pawn and loan", strip: "Strip-mall pawn counter", superstore: "Pawn superstore", outlet: "Pawn shop with a storage yard", twofloor: "Two-floor pawn exchange", wrap: "Pawn shop with an L of back rooms", counter: "Pawn shop with a jewellery safe room", twin: "Pawn and electronics, two shopfronts", roadside: "Roadside trading post", flagship: "Gold and gun exchange" }, [4, 5]),
  },
  sportshop: {
    boxes: 0.93,
    base: { name: "Sales floor", type: "sportshop", furnish: "aisles", maxBoxes: 7 }, depth: 0.62,
    rooms: {
      sig: { role: "lockerroom", name: "Fitting rooms", type: "lockers" },
      stock: { role: "stock", type: "sportshop" },
      safeoff: { role: "office", boxLock: ["safe", 0.2] },
      sig2: { role: "armory", name: "Gun counter", type: "gunshop", lock: ["door", 0.5], boxLock: ["cage", 0.4], maxBoxes: 3 },
      extra: { role: "sales", name: "Camping and fishing", type: "sportshop", hub: false, maxBoxes: 4 },
      yard: { role: "warefloor", name: "Boat yard", type: "sportshop", hub: false, maxBoxes: 4 },
    },
    variants: SHOP12({ main: "Sporting goods store", narrow: "Bike and ski shop with a flat above", corner: "Corner sports shop", strip: "Strip-mall sports outlet", superstore: "Sports superstore", outlet: "Outdoor outfitter with a boat yard", twofloor: "Two-floor sports store", wrap: "Team sports shop", counter: "Hunting and fishing counter", twin: "Sports and camping, two shopfronts", roadside: "Bait and tackle on the road", flagship: "Flagship outdoor store" }),
  },
  electronics: {
    base: { name: "Sales floor", type: "electronics", furnish: "aisles" }, depth: 0.62,
    rooms: {
      sig: { role: "workshop", name: "Repair bench", type: "electronics" },
      stock: { role: "stock", type: "electronics", name: "Stockroom", lock: ["door", 0.3] },
      safeoff: { role: "office", boxLock: ["safe", 0.25] },
      sig2: { role: "storage", name: "Home theatre room", type: "electronics" },
      extra: { role: "sales", name: "Phones and computers", type: "electronics", hub: false, maxBoxes: 3 },
      yard: { role: "warefloor", name: "Warehouse pickup", type: "electronics", hub: false, maxBoxes: 4 },
    },
    variants: SHOP12({ main: "Electronics store", narrow: "TV shop with a flat above", corner: "Corner electronics shop", strip: "Strip-mall phone and gadget store", superstore: "Electronics megastore", outlet: "Electronics warehouse outlet", twofloor: "Two-floor electronics store", wrap: "Hi-fi shop", counter: "TV and radio repair shop", twin: "Computers and TVs, two shopfronts", roadside: "Roadside satellite and TV dealer", flagship: "Flagship electronics store" }),
  },
  radioshop: {
    base: { name: "Radio counter", type: "radioshop", furnish: "shelves", maxBoxes: 5 }, depth: 0.55,
    rooms: {
      sig: { role: "workshop", name: "Repair bench", type: "radioshop" },
      stock: { role: "stock", type: "radioshop" },
      safeoff: { role: "office" },
      sig2: { role: "storage", name: "Antenna stock", type: "radioshop" },
      extra: { role: "sales", name: "CB and scanner counter", type: "radioshop", hub: false, maxBoxes: 3 },
      yard: { role: "warefloor", name: "Tower parts yard", type: "radioshop", hub: false, maxBoxes: 3 },
    },
    variants: SHOP12({ main: "Radio shop", narrow: "Radio shop with a flat above", corner: "Corner radio and parts", strip: "Strip-mall radio counter", superstore: "Electronic parts supply", outlet: "Radio shop with a tower parts yard", twofloor: "Two-floor ham radio store", wrap: "Radio shop with an L of back rooms", counter: "Radio repair shop", twin: "CB and scanners, two shopfronts", roadside: "Truckers' CB shop", flagship: "Communications outfitter" }),
  },
  bookstore: {
    boxes: 0.72,
    base: { name: "Bookshelves", type: "books", furnish: "shelves", maxBoxes: 8 }, depth: 0.62,
    rooms: {
      sig: { role: "storage", name: "Rare books room", type: "books", lock: ["door", 0.3] },
      stock: { role: "stock", type: "books", name: "Back room" },
      safeoff: { role: "office" },
      sig2: { role: "dining", name: "Reading café", type: "books", lay: "cafe", hub: false },
      extra: { role: "sales", name: "Children's books", type: "books", hub: false, maxBoxes: 3 },
      yard: { role: "warefloor", name: "Book warehouse", type: "books", hub: false, maxBoxes: 4 },
    },
    variants: SHOP12({ main: "Bookshop", narrow: "Used bookshop with a flat above", corner: "Corner bookshop", strip: "Strip-mall bookstore", superstore: "Book superstore", outlet: "Book barn and warehouse", twofloor: "Two-floor bookstore", wrap: "Bookshop with an L of back rooms", counter: "Bookshop with a reading café", twin: "Books and children's books, two shopfronts", roadside: "Roadside book barn", flagship: "Flagship bookstore with a café" }),
  },
  petstore: {
    base: { name: "Pet supplies", type: "petstore", furnish: "aisles" }, depth: 0.62,
    rooms: {
      sig: { role: "stock", name: "Fish room", type: "petstore" },
      stock: { role: "stock", type: "petstore" },
      safeoff: { role: "office" },
      sig2: { role: "exam", name: "Grooming room", type: "vet" },
      extra: { role: "sales", name: "Aquarium hall", type: "petstore", hub: false, maxBoxes: 3 },
      yard: { role: "warefloor", name: "Feed warehouse", type: "barn", hub: false, maxBoxes: 4 },
    },
    variants: SHOP12({ main: "Pet shop", narrow: "Pet shop with a flat above", corner: "Corner pet shop", strip: "Strip-mall pet supply", superstore: "Pet superstore", outlet: "Pet and feed warehouse", twofloor: "Two-floor pet store", wrap: "Pet shop with an L of back rooms", counter: "Pet shop with a grooming salon", twin: "Pets and aquariums, two shopfronts", roadside: "Country pet and feed", flagship: "Flagship pet store with a groomer" }),
  },
  garden: {
    base: { name: "Garden aisles", type: "garden", furnish: "aisles" }, depth: 0.55,
    rooms: {
      sig: { role: "stock", name: "Greenhouse", type: "garden", lay: "greenhouse", glass: true },
      stock: { role: "stock", type: "garden", name: "Potting shed" },
      safeoff: { role: "office" },
      sig2: { role: "parts", name: "Tool shed", type: "hardware" },
      extra: { role: "sales", name: "Outdoor living", type: "garden", hub: false, maxBoxes: 3 },
      yard: { role: "warefloor", name: "Yard stock", type: "garden", hub: false, maxBoxes: 5 },
    },
    variants: SHOP12({ main: "Garden centre", narrow: "Florist and garden shop with a flat above", corner: "Corner garden shop", strip: "Strip-mall garden supply", superstore: "Garden superstore", outlet: "Nursery with a yard", twofloor: "Two-floor garden store", wrap: "Garden centre with an L of sheds", counter: "Garden shop with a tool shed", twin: "Garden and outdoor living, two shopfronts", roadside: "Roadside nursery", flagship: "Flagship garden centre" }, [4, 5]),
  },
  clothing: {
    boxes: 0.95,
    base: { name: "Sales floor", type: "clothes", furnish: "aisles" }, depth: 0.62,
    rooms: {
      sig: { role: "lockerroom", name: "Fitting rooms", type: "clothes" },
      stock: { role: "stock", type: "clothes" },
      safeoff: { role: "office", boxLock: ["safe", 0.2] },
      sig2: { role: "storage", name: "Alterations room", type: "clothes" },
      extra: { role: "sales", name: "Shoe department", type: "clothes", hub: false, maxBoxes: 3 },
      yard: { role: "warefloor", name: "Outlet stockroom", type: "clothes", hub: false, maxBoxes: 4 },
    },
    variants: SHOP12({ main: "Clothing store", narrow: "Boutique with a flat above", corner: "Corner clothing shop", strip: "Strip-mall clothing store", superstore: "Clothing superstore", outlet: "Factory outlet", twofloor: "Two-floor fashion store", wrap: "Clothing store with an L of back rooms", counter: "Tailor and clothier", twin: "Clothes and shoes, two shopfronts", roadside: "Western and work wear barn", flagship: "Flagship fashion store" }),
  },
  liquor: {
    boxes: 0.55,
    base: { name: "Liquor shelves", type: "liquor", furnish: "aisles" }, depth: 0.62,
    rooms: {
      sig: { role: "pantry", name: "Walk-in beer cooler", type: "liquor", cold: true, dk: "steel", windows: false, fl: "steel", maxBoxes: 1 },
      stock: { role: "stock", type: "liquor", name: "Back room", lock: ["door", 0.3] },
      safeoff: { role: "office", boxLock: ["safe", 0.35] },
      sig2: { role: "storage", name: "Wine cellar", type: "liquor", lock: ["door", 0.3] },
      extra: { role: "sales", name: "Wine room", type: "liquor", hub: false, maxBoxes: 3 },
      yard: { role: "warefloor", name: "Keg and case warehouse", type: "liquor", hub: false, maxBoxes: 4 },
    },
    variants: SHOP12({ main: "Liquor store", narrow: "Off-licence with a flat above", corner: "Corner liquor store", strip: "Strip-mall liquor store", superstore: "Liquor superstore", outlet: "Liquor warehouse", twofloor: "Two-floor wine and spirits", wrap: "Liquor store with an L of back rooms", counter: "Wine merchant with a cellar", twin: "Beer and wine, two shopfronts", roadside: "Roadside package store", flagship: "Flagship wine and spirits" }),
  },
  hardware: {
    base: { name: "Hardware aisles", type: "hardware" }, depth: 0.62,
    rooms: {
      sig: { role: "parts", name: "Tool crib", type: "garage" },
      stock: { role: "stock", type: "hardware", name: "Lumber and stock" },
      safeoff: { role: "office", lock: ["door", 0.25] },
      sig2: { role: "workshop", name: "Key and paint counter", type: "hardware" },
      extra: { role: "sales", name: "Paint and plumbing", type: "hardware", hub: false, maxBoxes: 3 },
      yard: { role: "warefloor", name: "Lumber yard", type: "hardware", hub: false, maxBoxes: 5 },
    },
    variants: SHOP12({ main: "Hardware store", narrow: "Hardware shop with a flat above", corner: "Corner hardware store", strip: "Strip-mall hardware store", superstore: "Home improvement superstore", outlet: "Lumber yard and hardware", twofloor: "Two-floor hardware store", wrap: "Hardware store with an L of back rooms", counter: "Hardware store with a key and paint counter", twin: "Hardware and paint, two shopfronts", roadside: "Farm and ranch hardware", flagship: "Flagship builders' supply" }),
  },
  // ---------- the feed store ----------
  feedstore: {
    boxes: 0.94,
    base: { name: "Store", type: "barn" }, depth: 0.6, ground: "rural",
    rooms: {
      feed: { role: "stock", type: "warehouse", name: "Feed room" },
      bales: { role: "warefloor", name: "Fencing and bale yard", type: "barn", hub: false, maxBoxes: 5 },
      grain: { role: "storage", name: "Grain bins", type: "barn" },
      saddle: { role: "storage", name: "Saddle and tack room", type: "barn" },
      western: { role: "sales", name: "Western wear", type: "clothes", hub: false, maxBoxes: 3 },
      vetsup: { role: "stock", name: "Vet supplies", type: "vet" },
      hware: { role: "sales", name: "Hardware", type: "hardware", hub: false, maxBoxes: 3 },
      green: { role: "stock", name: "Greenhouse", type: "garden", lay: "greenhouse", glass: true },
    },
  },
  // ---------- the car dealer ----------
  dealer: {
    boxes: 0.98,
    base: { name: "Showroom", type: "dealer", furnish: "lobby", maxBoxes: 4 }, depth: 0.55, ground: "lot", fw: 2,
    rooms: {
      parts: { role: "parts", name: "Parts room", type: "garage" },
      soff: { role: "office", name: "Sales office", boxLock: ["lockbox", 0.5] },
      fin: { role: "office", name: "Finance office", boxLock: ["safe", 0.3] },
      bays: { role: "bays", name: "Service bays", type: "garage", maxBoxes: 4 },
      rvbay: { role: "bays", name: "RV service bay", type: "garage", maxBoxes: 3 },
      paint: { role: "bays", name: "Paint booth", type: "garage", maxBoxes: 2 },
      wash: { role: "bays", name: "Wash bay", type: "garage", maxBoxes: 1 },
      gear: { role: "sales", name: "Gear and helmets", type: "sportshop", hub: false, maxBoxes: 3 },
      bikeshop: { role: "workshop", name: "Bike workshop", type: "garage" },
      acc: { role: "storage", name: "Accessories store", type: "garage" },
      rental: { role: "office", name: "Rental desk", boxLock: ["lockbox", 0.5] },
    },
  },
  // ---------- the bank: the vault and the ATM in every plan (#27 owns the offices' bank-like branches) ----------
  bank: {
    base: { role: "lobby", name: "Banking hall", type: "office", entry: false }, depth: 0.5, fw: 2, openDoors: 0.2,
    rooms: {
      atm: { role: "lobby", name: "ATM lobby", entry: true, atm: true, hub: false, type: "office", maxBoxes: 1 },
      tellers: { role: "office", name: "Teller line", type: "office", boxLock: ["lockbox", 0.4] },
      vault: { role: "armory", name: "Vault", type: "bankvault", lock: ["vault", 1], boxLock: ["safe", 0.6], windows: false, fl: "conc" },
      sdb: { role: "armory", name: "Safe-deposit room", type: "bankvault", lock: ["door", 0.5], boxLock: ["safe", 0.3], windows: false, fl: "conc", maxBoxes: 2 },
      mgr: { role: "office", name: "Manager's office", boxLock: ["safe", 0.3] },
      loan: { role: "office", name: "Loan office" },
      drive: { role: "office", name: "Drive-up teller window", type: "office", boxLock: ["lockbox", 0.4] },
    },
  },
  // ---------- the auto shop, the garage, the workshop (an office by the front door, the floor behind or beside it) ----------
  autoshop: {
    base: { role: "bays", name: "Service bays", maxBoxes: 5, hub: true, entry: false }, depth: 0.65, ground: "town", main: "bays",
    rooms: {
      off: { role: "office", entry: true, hub: true, name: "Office" },
      parts: { role: "parts", lock: ["door", 0.3] },
      tyres: { role: "storage", name: "Tyre store", type: "garage" },
      paint: { role: "bays", name: "Paint booth", type: "garage", maxBoxes: 2 },
      engine: { role: "workshop", name: "Engine room", type: "workshop" },
      tow: { role: "storage", name: "Tow gear store", type: "garage" },
      wash: { role: "bays", name: "Wash bay", type: "garage", maxBoxes: 1 },
      counter: { role: "sales", name: "Parts counter", type: "garage", hub: false, maxBoxes: 3 },
    },
  },
  garage: {
    boxes: 1.12,
    base: { role: "bays", name: "Service bays", maxBoxes: 5, hub: true, entry: false }, depth: 0.65, ground: "town", main: "bays",
    rooms: {
      off: { role: "office", entry: true, hub: true, name: "Office" },
      parts: { role: "parts", lock: ["door", 0.15] },
      tyres: { role: "storage", name: "Tyre store", type: "garage" },
      paint: { role: "bays", name: "Paint booth", type: "garage", maxBoxes: 2 },
      engine: { role: "workshop", name: "Workshop", type: "workshop" },
      tow: { role: "storage", name: "Tow gear store", type: "garage" },
      wash: { role: "bays", name: "Wash bay", type: "garage", maxBoxes: 1 },
      counter: { role: "sales", name: "Parts counter", type: "garage", hub: false, maxBoxes: 3 },
    },
  },
  workshop: {
    base: { role: "workshop", name: "Workshop", hub: true, maxBoxes: 4, entry: false }, depth: 0.65, ground: "lot", main: "workshop",
    rooms: {
      off: { role: "office", entry: true, hub: true, name: "Office" },
      parts: { role: "parts", lock: ["door", 0.15] },
      tyres: { role: "storage", name: "Material store", type: "workshop" },
      paint: { role: "bays", name: "Spray booth", type: "garage", maxBoxes: 2 },
      engine: { role: "workshop", name: "Machine room", type: "workshop" },
      tow: { role: "storage", name: "Timber store", type: "warehouse" },
      wash: { role: "bays", name: "Loading bay", type: "garage", maxBoxes: 1 },
      counter: { role: "sales", name: "Trade counter", type: "hardware", hub: false, maxBoxes: 3 },
    },
  },
  // ---------- #22's grocery tiers: their signature rooms (freezers, walk-ins, the warehouse and docks) in every plan ----------
  corner: {
    base: { name: "Store", type: "store", lay: "cornerstore", maxBoxes: 7 }, depth: 0.62, fw: 1,
    rooms: {
      office: { role: "office", boxLock: ["safe", 0.2] },
      deli: { role: "dining", name: "Deli counter", type: "store", lay: "cafe", hub: false },
      post: { role: "office", name: "Post office counter", type: "office" },
      cooler: { role: "pantry", name: "Walk-in cooler", type: "kitchen", cold: true, dk: "steel", windows: false, fl: "steel", maxBoxes: 1 },
      booth: { role: "office", name: "Cashier's booth", boxLock: ["safe", 0.5], maxBoxes: 1 },
      laundro: { role: "storage", name: "Laundromat", type: "store" },
      backstore: { role: "storage", name: "Back storeroom", type: "store" },
    },
  },
  grocery: {
    boxes: 0.9,
    base: { name: "Sales floor", type: "store", lay: "grocerfloor", maxBoxes: 6 }, depthBack: 5, fw: 2,
    rooms: {
      stock: { role: "stock", maxBoxes: 2 },
      cooler: { role: "pantry", name: "Walk-in cooler", type: "kitchen", cold: true, dk: "steel", windows: false, fl: "steel", maxBoxes: 1 },
      freezer: { role: "pantry", name: "Walk-in freezer", type: "kitchen", cold: true, dk: "steel", windows: false, fl: "steel", lay: "walkfreezer", maxBoxes: 1 },
      office: { role: "office", boxLock: ["safe", 0.2] },
      bakery: { role: "kitchen", name: "Bakery", type: "kitchen", lay: "bakery", maxBoxes: 2 },
      butcher: { role: "kitchen", name: "Butcher", type: "kitchen", lay: "butcher", maxBoxes: 2 },
      pharm: { role: "dispensary", name: "Pharmacy counter", type: "pharmacy", maxBoxes: 1, windows: false },
      members: { role: "breakroom", name: "Members' room" },
      spice: { role: "storage", name: "Dry goods room", type: "store" },
      annex: { role: "sales", name: "Beer and wine", type: "liquor", lay: "minimart", hub: false, maxBoxes: 2 },
      florist: { role: "storage", name: "Florist", type: "garden" },
      feed: { role: "storage", name: "Feed and seed", type: "barn" },
    },
  },
};

VARIANT_TYPES.supermarket = { base: { name: "Sales floor", type: "store" }, rooms: {} }; // its plan is superSpec's
// ---------- the variants of the types that are not SHOP12's ----------
const V = VARIANT_TYPES;
V.pharmacy.variants = [
  { id: "drivethru", name: "Chain drugstore with a drive-through", w: W(0.6, 1, 1, 0.8, 0.6), size: "M", lay: "side", sideW: [4, 5], side: [[3, "drive"], ["*", "disp"]], back: [["*", "pstock"], [3, "office"], [2, "wc"]], ex: ["back", "drive"] },
  { id: "fountain", name: "Independent pharmacy with a soda fountain", w: W(0.8, 1, 0.4, 0.3, 0.2), size: "M", lay: "strip", front: [["*", S], [0.3, "fountain"]], back: [[[4, 5], "disp"], ["*", "pstock"], [3, "office"]], ex: ["back"], st: [1, 2], up: "flat" },
  { id: "compounding", name: "Compounding pharmacy", w: W(0.3, 0.6, 0.8, 0, 0.4), size: "S", lay: "deep", depth: 0.45, midD: 3, mid: [["*", "disp"], ["*", "compound"]], back: [["*", "pstock"], [2, "wc"]], ex: ["back!"] },
  { id: "outpatient", name: "Hospital outpatient pharmacy", w: W(0, 0.3, 1, 0, 0), size: "L", lay: "corridor", front: [[0.3, "waiting"], ["*", S]], back: [["*", "disp"], [3, "vaccine"], ["*", "pstock"], [3, "office"]], ex: ["front2", "fire"], fw: 2 },
  { id: "stripmall", name: "Strip-mall pharmacy", w: W(0.2, 0.6, 0.4, 0.4, 1), size: "S", lay: "strip", depth: 0.7, back: [[4, "disp"], ["*", "pstock"], [2, "wc"]], ex: ["back!"] },
  { id: "allnight", name: "24-hour pharmacy with a photo counter", w: W(0, 0.6, 1, 0.6, 0.5), size: "L", lay: "strip", front: [[4, "photo"], ["*", S]], back: [[5, "disp"], ["*", "pstock"], [4, "brk"], [3, "mgr"], [2, "wc"]], ex: ["back", "side"], fw: 2 },
  { id: "country", name: "Country drugstore", w: W(1, 0.5, 0, 0.4, 0), size: "M", lay: "side", sideW: [4, 5], side: [["*", "pstock"], [4, "disp"]], ex: ["back"], st: [1, 2], up: "flat", ground: "rural" },
  { id: "clinic", name: "Pharmacy with a walk-in clinic", w: W(0.2, 0.8, 0.8, 0.3, 0.6), size: "L", lay: "corridor", back: [[5, "disp"], [4, "consult"], [4, "consult"], ["*", "pstock"], [2, "wc"]], ex: ["back", "front2"], fw: 2 },
  { id: "apothecary", name: "Two-storey main street apothecary", w: W(0.6, 1, 0.6, 0, 0), size: "M", lay: "strip", back: [[[4, 5], "disp"], ["*", "pstock"], [3, "office"]], ex: ["back", "side"], st: 2, up: "offices" },
  { id: "discount", name: "Discount pharmacy warehouse", w: W(0, 0.4, 0.6, 0.6, 0.8), size: "XL", lay: "wrap", sideW: [5, 6], side: [[6, "disp"], ["*", "pstock"]], back: [["*", "recv"], [4, "office"], [2, "wc"]], ex: ["dock", "back", "front2"], fw: 2 },
  { id: "highway", name: "Highway drug and sundries store", w: W(0.3, 0.2, 0, 1, 0.3), size: "M", lay: "wrap", sideW: 4, side: [[3, "office"], [2, "wc"], ["*", "vaccine"]], back: [[5, "disp"], ["*", "pstock"]], ex: ["back", "fire"] },
  { id: "mezzanine", name: "Mall pharmacy with a mezzanine stockroom", w: W(0, 0.6, 1, 0, 0.8), size: "M", lay: "strip", depth: 0.7, back: [[4, "disp"], ["*", "pstock"], [2, "wc"]], ex: ["front2"], st: 2, up: "stock", fw: 2 },
];
V.gasstation.variants = [
  { id: "kiosk", name: "Pump island and kiosk", w: W(0.6, 0.8, 0.8, 0.6, 0.4), size: "S", lay: "strip", depth: 0.7, back: [["*", "gstock"], [2, "wc"]], ex: [] },
  { id: "carwash", name: "Convenience store with a car wash", w: W(0.2, 1, 0.8, 0.8, 0.6), size: "M", lay: "strip", back: [["*", "gstock"], [2, "wc"]], bays: { w: [4, 5], leaf: "wash", ex: "Car wash door", back: true }, ex: ["back"], pumps: 3 },
  { id: "service", name: "Old service station with repair bays", w: W(0.8, 1, 0.4, 0.6, 0.2), size: "M", lay: "strip", back: [["*", "gstock"], [3, "office"]], bays: { w: [4, 5], leaf: "bay" }, ex: ["back"] },
  { id: "plaza", name: "Highway travel plaza", w: W(0, 0.1, 0, 1, 0.2), size: "XL", lay: "strip", front: [["*", S], [0.35, "snack"]], back: [["*", "gstock"], [4, "brk"], [3, "office"], [2, "wc"], [2, "wc"]], ex: ["front2", "back"], pumps: 4, fw: 2 },
  { id: "general", name: "Rural general store with pumps", w: W(1, 0.4, 0, 0.4, 0), size: "M", lay: "strip", back: [["*", "gstock"], [4, "feed"]], ex: ["back", "side"], st: [1, 2], up: "flat", pumps: 1, ground: "rural" },
  { id: "citycorner", name: "City corner gas station", w: W(0, 0.6, 1, 0.2, 0.4), size: "S", lay: "side", sideW: 3, side: [["*", "office"]], back: [["*", "gstock"]], ex: ["side"] },
  { id: "tyres", name: "Gas station with a tyre shop", w: W(0.4, 0.8, 0.4, 0.8, 0.4), size: "L", lay: "strip", back: [["*", "gstock"], [4, "tyrestore"], [2, "wc"]], bays: { w: [5, 6], leaf: "tyre" }, ex: ["back"], pumps: 3 },
  { id: "bait", name: "Lakeside gas and bait", w: W(1, 0.4, 0, 0.6, 0), size: "S", lay: "strip", depth: 0.65, back: [["*", "gstock"], [3, "bait"]], ex: ["back", "side"], pumps: 1, ground: "rural" },
  { id: "towing", name: "Two-bay garage with a towing yard", w: W(0.6, 0.6, 0.2, 0.8, 0), size: "L", lay: "strip", back: [["*", "gstock"], [3, "office"], [3, "parts"]], bays: { w: [6, 7], leaf: "bay", width: 3 }, ex: ["back!", "dock"] },
  { id: "deli", name: "Modern convenience station with a deli counter", w: W(0, 0.8, 1, 0.8, 0.8), size: "L", lay: "corridor", front: [["*", S], [0.3, "deli"]], back: [["*", "gstock"], [3, "cooler"], [3, "brk"], [2, "wc"]], ex: ["back", "front2"], pumps: 4, fw: 2 },
  { id: "filling", name: "1950s filling station with an attendant's office", w: W(0.8, 0.6, 0.2, 0.6, 0), size: "L", lay: "side", sideW: 3, side: [["*", "attend"]], bays: { w: 4, leaf: "bay" }, ex: [] },
  { id: "fuelstop", name: "Fuel stop with a lunch counter and showers", w: W(0.4, 0.2, 0, 1, 0), size: "L", lay: "strip", front: [["*", S], [0.38, "lunch"]], back: [["*", "gstock"], [4, "showers"], [2, "wc"]], ex: ["back", "side"], pumps: 3 },
];
V.truckstop.variants = [
  { id: "classic", name: "Truck stop diner with showers and a drivers' lounge", w: W(0.6, 0.6, 0, 1, 0), size: "M", lay: "strip", front: [[0.55, S], ["*", "diner"]], back: [["*", "kit"], [4, "showers"], [4, "lounge"], [2, "wc"]], ex: ["back"] },
  { id: "travel", name: "Travel centre with a food court and a chapel", w: W(0, 0.2, 0, 1, 0.2), size: "XL", lay: "corridor", front: [[0.45, S], [0.25, "food"], ["*", "diner"]], back: [["*", "kit"], [4, "tstock"], [4, "chapel"], [4, "showers"], [3, "toff"], [2, "wc"]], ex: ["back", "front2"] },
  { id: "scale", name: "CAT scale and tyre shop", w: W(0.4, 0.4, 0, 1, 0), size: "L", lay: "strip", front: [[0.5, S], ["*", "diner"]], back: [["*", "kit"], [3, "scale"], [3, "tstock"], [2, "wc"]], bays: { w: [5, 6], leaf: "tyre" }, ex: ["back"] },
  { id: "oldstop", name: "Old truck stop with a service bay", w: W(0.8, 0.8, 0, 1, 0), size: "M", lay: "strip", front: [[0.55, S], ["*", "diner"]], back: [["*", "kit"], [[3, 4], "tstock"], [3, "toff"], [2, "wc"]], bays: { w: [4, 5], leaf: "bay" }, ex: ["back", "side"] },
  { id: "diesel", name: "Diesel island and café", w: W(0.6, 0.6, 0, 0.8, 0.4), size: "S", lay: "strip", front: [[0.6, S], ["*", "diner"]], back: [["*", "kit"], ["*", "tstock"], [2, "wc"]], ex: [] },
  { id: "bunks", name: "Truck stop with drivers' bunks upstairs", w: W(0.4, 0.4, 0, 1, 0), size: "L", lay: "strip", front: [[0.45, "diner"], ["*", S]], back: [["*", "kit"], [4, "tstock"], [3, "toff"], [2, "wc"]], ex: ["back"], st: 2, up: "bunks" },
  { id: "plaza", name: "Highway plaza with two entrances", w: W(0, 0.4, 0, 1, 0.4), size: "L", lay: "deep", depth: 0.45, midD: 3, front: [[0.5, S], ["*", "diner"]], mid: [["*", "lounge"], ["*", "showers"]], back: [["*", "kit"], ["*", "tstock"], [2, "wc"]], ex: ["front2", "back"] },
  { id: "feedstop", name: "Rural fuel-and-feed stop", w: W(1, 0.4, 0, 0.6, 0), size: "M", lay: "wrap", sideW: [4, 5], side: [["*", "feed"]], front: [[0.55, S], ["*", "diner"]], back: [["*", "kit"], [2, "wc"]], ex: ["side", "back"], ground: "rural" },
  { id: "chain", name: "Chain travel stop", w: W(0, 0.2, 0, 1, 0.4), size: "XL", lay: "wrap", sideW: [5, 6], side: [[4, "showers"], ["*", "lounge"], [2, "wc"]], front: [[0.5, S], ["*", "diner"]], back: [["*", "kit"], ["*", "recv"], [4, "toff"]], ex: ["back", "dock", "front2"] },
  { id: "truckwash", name: "Truck stop with a truck wash", w: W(0.4, 0.4, 0, 1, 0), size: "L", lay: "strip", front: [[0.6, S], ["*", "diner"]], back: [["*", "kit"], ["*", "tstock"]], bays: { w: [6, 7], leaf: "truckwash", width: 3, back: true }, ex: ["back"] },
  { id: "cafe", name: "Truckers' café and store", w: W(0.8, 0.8, 0, 0.6, 0), size: "S", lay: "strip", front: [[0.5, "diner"], ["*", S]], back: [["*", "kit"], [3, "tstock"]], ex: ["side"], st: [1, 2], up: "flat" },
  { id: "mega", name: "Mega travel centre with a tyre shop and chapel", w: W(0, 0, 0, 1, 0), size: "XL", lay: "corridor", front: [[0.45, S], ["*", "diner"]], back: [["*", "kit"], [4, "chapel"], [4, "showers"], [3, "scale"], [2, "wc"]], bays: { w: 6, leaf: "tyre" }, ex: ["back", "front2", "dock"] },
];
V.feedstore.variants = [
  { id: "supplybarn", name: "Farm-supply barn with a bale yard", w: W(1, 0.4, 0, 0.6, 0), size: "L", lay: "side", sideW: [6, 7], side: [["*", "bales"]], back: [["*", "feed"], [3, "office"]], ex: ["yard"] },
  { id: "coop", name: "Grain co-op with bins", w: W(1, 0.6, 0, 0.4, 0), size: "L", lay: "strip", back: [["*", "grain"], ["*", "feed"], [3, "office"], [2, "wc"]], ex: ["dock"] },
  { id: "western", name: "Western store with saddles and boots", w: W(0.8, 1, 0.2, 0.6, 0.4), size: "M", lay: "strip", front: [[0.6, S], ["*", "western"]], back: [[4, "saddle"], ["*", "feed"], [3, "office"]], ex: ["back", "front2"], fw: 2 },
  { id: "country", name: "Country feed store", w: W(1, 0.8, 0, 0.4, 0.2), size: "M", lay: "strip", back: [["*", "feed"], [[3, 4], "office"]], ex: ["back"] },
  { id: "tack", name: "Tack and saddlery", w: W(0.6, 0.8, 0.2, 0.2, 0.4), size: "S", lay: "strip", back: [["*", "saddle"], [3, "office"]], ex: ["side"] },
  { id: "ranch", name: "Farm and ranch centre", w: W(0.6, 0.6, 0, 0.8, 0.6), size: "XL", lay: "corridor", front: [[0.6, S], ["*", "western"]], back: [["*", "feed"], [4, "vetsup"], [4, "saddle"], [3, "office"], [2, "wc"]], ex: ["dock", "front2"], fw: 2 },
  { id: "mill", name: "Old feed mill", w: W(1, 0.4, 0, 0.2, 0), size: "M", lay: "deep", depth: 0.45, midD: [3, 4], mid: [["*", "grain"]], back: [["*", "feed"]], ex: ["back", "dock"], st: 2, up: "loft" },
  { id: "livestock", name: "Livestock supply with a vet counter", w: W(1, 0.6, 0, 0.4, 0), size: "M", lay: "wrap", sideW: 4, side: [[4, "vetsup"], ["*", "office"]], back: [["*", "feed"]], ex: ["back"] },
  { id: "feedhardware", name: "Feed and hardware", w: W(0.6, 1, 0, 0.6, 0.6), size: "L", lay: "strip", front: [[0.55, S], ["*", "hware"]], back: [["*", "feed"], [3, "office"]], ex: ["side", "back"], fw: 2 },
  { id: "hayshed", name: "Roadside hay and feed shed", w: W(0.8, 0.2, 0, 1, 0), size: "S", lay: "side", sideW: 4, side: [["*", "bales"]], ex: ["yard", "back"] },
  { id: "seed", name: "Seed and garden supply", w: W(0.6, 1, 0.2, 0.2, 0.6), size: "M", lay: "strip", back: [["*", "feed"], [5, "green"], [3, "office"]], ex: ["back"], st: [1, 2], up: "flat" },
  { id: "towncoop", name: "Farmers' co-op store with offices upstairs", w: W(0.6, 1, 0, 0.2, 0.2), size: "M", lay: "corridor", back: [["*", "feed"], [4, "grain"], [2, "wc"]], ex: ["back"], st: 2, up: "offices" },
];
V.dealer.variants = [
  { id: "franchise", name: "New car dealer with service bays", w: W(0.4, 1, 0.8, 0.8, 0.6), size: "M", lay: "strip", back: [["*", "parts"], [[3, 4], "soff"], [2, "wc"]], bays: { w: [6, 7], leaf: "bays", ex: "Service door" }, ex: ["back"] },
  { id: "usedlot", name: "Used car lot office", w: W(0.8, 1, 0.6, 0.8, 0.4), size: "S", lay: "strip", depth: 0.45, sales: { name: "Sales office", maxBoxes: 3 }, back: [["*", { role: "office", boxLock: ["lockbox", 0.5] }], [2, "wc"]], ex: ["back"] },
  { id: "automall", name: "Auto mall with a finance floor", w: W(0, 0.4, 1, 0.6, 0.4), size: "L", lay: "corridor", back: [["*", "parts"], [4, "soff"], [4, "fin"], [2, "wc"]], bays: { w: 7, leaf: "bays", ex: "Service door" }, ex: ["back", "front2"], st: 2, up: "offices" },
  { id: "truck", name: "Truck and tractor dealer", w: W(1, 0.6, 0, 0.8, 0), size: "L", lay: "strip", back: [["*", "parts"], [3, "soff"]], bays: { w: [8, 9], leaf: "bays", width: 3, ex: "Service door" }, ex: ["back"], ground: "rural" },
  { id: "boutique", name: "Import boutique showroom", w: W(0, 0.4, 1, 0, 0.4), size: "M", lay: "strip", depth: 0.7, back: [["*", "soff"], [4, "fin"], [2, "wc"]], ex: [] },
  { id: "rv", name: "RV and boat dealer", w: W(0.8, 0.4, 0, 1, 0), size: "L", lay: "deep", depth: 0.45, midD: 3, mid: [["*", "soff"], ["*", "fin"]], back: [["*", "parts"], ["*", "acc"]], bays: { w: 7, leaf: "rvbay", ex: "Service door" }, ex: ["back", "side"] },
  { id: "motorcycle", name: "Motorcycle dealer", w: W(0.4, 0.8, 0.8, 0.6, 0.6), size: "M", lay: "strip", front: [[0.6, S], ["*", "gear"]], back: [["*", "parts"], ["*", "bikeshop"]], ex: ["back", "side"] },
  { id: "bodyshop", name: "Dealer with a body shop", w: W(0.4, 0.8, 0.4, 0.6, 0.2), size: "M", lay: "strip", back: [[5, "paint"], ["*", "parts"], [3, "soff"]], bays: { w: 6, leaf: "bays", ex: "Service door" }, ex: ["back", "dock"] },
  { id: "glass", name: "Glass-front showroom on the strip", w: W(0, 0.6, 0.8, 0.6, 1), size: "L", lay: "strip", depth: 0.72, back: [["*", "soff"], ["*", "fin"], [2, "wc"]], ex: ["front2", "side"] },
  { id: "country", name: "Country dealer and garage", w: W(1, 0.8, 0, 0.6, 0), size: "M", lay: "wrap", sideW: 4, side: [[4, "soff"], ["*", "wc"]], back: [["*", "parts"]], bays: { w: 6, leaf: "bays", ex: "Service door" }, ex: ["back", "side"], ground: "rural" },
  { id: "rental", name: "Car rental and sales", w: W(0.2, 0.6, 1, 0.8, 0.6), size: "S", lay: "side", sideW: 4, side: [["*", "rental"]], back: [["*", "wash"]], ex: ["bayback"] },
  { id: "superstore", name: "Used car superstore", w: W(0, 0.4, 0.6, 1, 0.6), size: "XL", lay: "corridor", back: [["*", "parts"], [4, "soff"], [4, "soff"], [4, "fin"], [4, "brk"], [2, "wc"]], bays: { w: 7, leaf: "bays", ex: "Service door" }, ex: ["back", "front2", "dock"] },
];
const ATMH = [[3, "atm"], ["*", S]];
V.bank.variants = [
  { id: "smalltown", name: "Small-town bank", w: W(1, 1, 0.2, 0.2, 0.2), size: "S", lay: "strip", front: ATMH, back: [["*", "tellers"], [[4, 5], "vault"], [3, "mgr"]], ex: ["back"] },
  { id: "drivethru", name: "Branch with a drive-through", w: W(0.4, 1, 0.6, 0.6, 0.8), size: "M", lay: "side", sideW: 4, side: [["*", "drive"]], front: ATMH, back: [["*", "tellers"], [4, "vault"], [3, "sdb"], [2, "wc"]], ex: ["drive"] },
  { id: "marble", name: "Big city bank with a marble hall", w: W(0, 0.2, 1, 0, 0), size: "L", lay: "deep", depth: 0.55, midD: 3, front: ATMH, mid: [["*", "tellers"]], back: [[5, "vault"], [4, "sdb"], [4, "mgr"], ["*", "records"], [2, "wc"]], ex: ["back", "front2"], st: [2, 3], up: "offices" },
  { id: "creditunion", name: "Credit union in a strip mall", w: W(0.2, 0.6, 0.4, 0.2, 1), size: "S", lay: "strip", depth: 0.6, front: [["*", S], [3, "atm"]], back: [["*", "tellers"], [4, "vault"], [2, "wc"]], ex: ["back!"] },
  { id: "savings", name: "Savings and loan with loan offices", w: W(0.4, 1, 0.6, 0.2, 0.6), size: "M", lay: "corridor", front: ATMH, back: [[4, "loan"], [4, "loan"], ["*", "tellers"], [4, "vault"], [3, "mgr"]], ex: ["back"] },
  { id: "farmers", name: "Farmers' bank with a loan office", w: W(1, 0.6, 0, 0.4, 0), size: "M", lay: "wrap", sideW: 4, side: [[4, "mgr"], ["*", "loan"]], front: ATMH, back: [["*", "tellers"], [5, "vault"]], ex: ["side"], ground: "rural" },
  { id: "tower", name: "Bank tower lobby", w: W(0, 0, 1, 0, 0), size: "L", lay: "corridor", front: ATMH, back: [["*", "tellers"], [5, "vault"], [4, "sdb"], [4, "records"], [4, "brk"], [2, "wc"]], ex: ["front2", "back"], st: 3, up: "offices" },
  { id: "corner", name: "Corner bank with two doors", w: W(0.4, 1, 0.8, 0.2, 0.2), size: "M", lay: "strip", front: ATMH, back: [["*", "tellers"], [4, "vault"], [3, "sdb"], [3, "mgr"]], ex: ["side", "back"] },
  { id: "grand", name: "Old grand bank with offices above", w: W(0.2, 0.8, 0.8, 0, 0), size: "L", lay: "strip", depth: 0.65, front: ATMH, back: [[5, "vault"], ["*", "tellers"], [4, "mgr"]], ex: [], st: 2, up: "offices" },
  { id: "driveup", name: "Branch with a drive-up ATM", w: W(0.6, 0.6, 0.4, 0.8, 0.6), size: "S", lay: "side", sideW: 3, side: [[3, "atm"], ["*", "drive"]], back: [["*", "tellers"], [4, "vault"]], ex: ["back", "drive"] },
  { id: "trust", name: "Trust company with private offices", w: W(0, 0.6, 1, 0, 0.2), size: "M", lay: "deep", depth: 0.45, midD: 3, front: ATMH, mid: [["*", "loan"], ["*", "loan"]], back: [[5, "vault"], [4, "sdb"], ["*", "mgr"]], ex: ["back"] },
  { id: "headquarters", name: "Regional bank headquarters", w: W(0, 0.2, 1, 0, 0), size: "XL", lay: "corridor", front: [[3, "atm"], ["*", S], [3, { role: "lobby", name: "Night deposit", hub: false, type: "office", maxBoxes: 1 }]], back: [["*", "tellers"], [6, "vault"], [5, "sdb"], [4, "records"], [4, "mgr"], [4, "brk"], [2, "wc"]], ex: ["front2", "back", "side"], st: [2, 3], up: "offices" },
];
// The auto shop's, the garage's and the workshop's 12: one set of arrangements, each type's rooms and names.
/** @param {Record<string, string>} n @returns {Variant[]} */
const BAYS12 = (n) => [
  { id: "standard", name: n.standard, w: W(0.8, 1, 0.6, 0.6, 0.4), size: "M", lay: "side", sideW: [4, 5], side: [["*", "off"], ["*", "parts"]], ex: ["bay2", "back"] },
  { id: "drivethru", name: n.drivethru, w: W(0.2, 0.8, 0.8, 0.8, 0.8), size: "M", lay: "side", sideW: 4, side: [["*", "off"], [2, "wc"]], ex: ["bay2", "bayback"] },
  { id: "tyres", name: n.tyres, w: W(0.6, 0.8, 0.6, 0.8, 0.6), size: "M", lay: "side", sideW: [4, 5], side: [[4, "off"], ["*", "tyres"]], ex: ["bay2", "side"] },
  { id: "paint", name: n.paint, w: W(0.4, 0.8, 0.6, 0.4, 0.4), size: "L", lay: "wrap", sideW: [4, 5], side: [["*", "off"], ["*", "parts"]], back: [[5, "paint"], ["*", "wc"]], ex: ["bay2", "back"] },
  { id: "engine", name: n.engine, w: W(0.4, 0.8, 0.6, 0.4, 0.4), size: "L", lay: "strip", depth: 0.6, front: [[0.35, "off"], ["*", S]], back: [["*", "parts"], ["*", "engine"], [2, "wc"]], ex: ["bay2", "back"] },
  { id: "small", name: n.small, w: W(0.8, 0.8, 0.6, 0.4, 0.6), size: "S", lay: "side", sideW: 4, side: [["*", "off"]], ex: ["bay2"] },
  { id: "fleet", name: n.fleet, w: W(0, 0.4, 0.8, 0.6, 0.2), size: "XL", lay: "side", sideW: 5, side: [[4, "off"], [4, "parts"], ["*", "brk"], [2, "wc"]], ex: ["bay2", "bay2", "bayback"] },
  { id: "tow", name: n.tow, w: W(0.8, 0.6, 0.4, 1, 0), size: "M", lay: "wrap", sideW: 4, side: [["*", "off"], ["*", "parts"]], back: [["*", "tow"]], ex: ["bay2", "dock"] },
  { id: "flat", name: n.flat, w: W(1, 0.6, 0.2, 0.4, 0), size: "M", lay: "side", sideW: [4, 5], side: [["*", "off"], ["*", "parts"]], ex: ["bay2"], st: 2, up: "flat", ground: "rural" },
  { id: "wash", name: n.wash, w: W(0.2, 0.8, 0.8, 0.8, 0.6), size: "M", lay: "strip", depth: 0.7, front: [[0.3, "off"], ["*", S], [5, "wash"]], back: [["*", "parts"]], ex: ["bay2", "bayback"] },
  { id: "counter", name: n.counter, w: W(0.4, 1, 0.8, 0.4, 0.8), size: "M", lay: "deep", depth: 0.35, midD: [4, 5], front: [["*", "counter"], [0.4, "off"]], mid: [["*", S]], back: [["*", "parts"], [2, "wc"]], ex: ["bay2", "back"] },
  { id: "heavy", name: n.heavy, w: W(0.8, 0.4, 0.2, 1, 0), size: "L", lay: "side", sideW: 5, side: [["*", "off"], ["*", "parts"], [2, "wc"]], ex: ["bay3", "bayback3"] },
];
V.autoshop.variants = BAYS12({ standard: "Two-bay repair shop", drivethru: "Quick lube with drive-through bays", tyres: "Tyre and brake shop", paint: "Body shop with a paint booth", engine: "Engine and transmission shop", small: "Muffler shop", fleet: "Fleet service garage", tow: "Garage and tow yard", flat: "Country garage with a flat above", wash: "Detailing and car wash", counter: "Auto parts and repair", heavy: "Heavy truck repair" });
V.garage.variants = BAYS12({ standard: "Town garage", drivethru: "Drive-through garage", tyres: "Garage with a tyre store", paint: "Body shop and garage", engine: "Garage with a workshop", small: "Lock-up garage", fleet: "Municipal vehicle garage", tow: "Breakdown and recovery garage", flat: "Garage with a flat above", wash: "Garage with a wash bay", counter: "Garage with a parts counter", heavy: "Bus and truck garage" });
V.workshop.variants = BAYS12({ standard: "Welding shop", drivethru: "Fabrication shop with through doors", tyres: "Steel stockholder's shop", paint: "Sign shop with a spray booth", engine: "Machine shop", small: "Small engine repair", fleet: "Contractor's workshop", tow: "Joinery with a timber store", flat: "Blacksmith's forge with a flat above", wash: "Boat repair shop", counter: "Trade counter and workshop", heavy: "Heavy fabrication works" });
V.corner.variants = [
  { id: "classic", name: "Corner shop", w: W(0.6, 1, 1, 0.4, 0.4), size: "M", lay: "strip", back: [["*", "stock"], [[3, 4], "office"], [2, "wc"]], ex: ["back"], st: [1, 2], up: "flat" },
  { id: "bodega", name: "Bodega with a deli counter", w: W(0, 0.4, 1, 0, 0.4), size: "M", lay: "strip", front: [["*", S], [0.4, "deli"]], back: [["*", "stock"], [2, "wc"]], ex: ["back"] },
  { id: "flat", name: "Shop with the owner's flat above", w: W(0.6, 1, 0.8, 0.2, 0), size: "S", lay: "strip", back: [["*", "stock"], [2, "wc"]], ex: ["back!"], st: 2, up: "flat" },
  { id: "twodoor", name: "Corner store with two doors", w: W(0.2, 0.8, 1, 0.4, 0.4), size: "M", lay: "strip", back: [["*", "stock"], [3, "office"]], ex: ["side", "back"] },
  { id: "post", name: "Village shop and post office", w: W(1, 0.6, 0, 0.2, 0), size: "L", lay: "strip", front: [["*", S], [0.35, "post"]], back: [["*", "stock"], [2, "wc"]], ex: ["back"], ground: "rural" },
  { id: "kiosk", name: "Newsagent kiosk", w: W(0.2, 0.6, 1, 0.4, 0.6), size: "S", lay: "strip", depth: 0.72, back: [["*", "stock"]], ex: [] },
  { id: "cooler", name: "Beer-and-ice store with a walk-in", w: W(0.8, 0.6, 0.4, 1, 0.6), size: "M", lay: "strip", back: [["*", "stock"], [3, "cooler"]], ex: ["dock"] },
  { id: "sidestock", name: "Corner market with its stock on the side", w: W(0.4, 0.8, 0.6, 0.4, 0.6), size: "L", lay: "side", sideW: 4, side: [["*", "stock"]], ex: ["back"] },
  { id: "booth", name: "Late-night store with a cashier's booth", w: W(0, 0.6, 1, 0.8, 0.6), size: "M", lay: "strip", front: [["*", S], [3, "booth"]], back: [["*", "stock"]], ex: ["side"] },
  { id: "laundro", name: "Corner store and laundromat", w: W(0.2, 0.8, 1, 0.2, 0.8), size: "L", lay: "strip", front: [[0.6, S], ["*", "laundro"]], back: [["*", "stock"], [2, "wc"]], ex: ["front2"] },
  { id: "general", name: "General store with a back storeroom", w: W(1, 0.8, 0.2, 0.6, 0), size: "M", lay: "wrap", sideW: 3, side: [[3, "office"], ["*", "backstore"]], back: [["*", "stock"]], ex: ["back", "side"], ground: "rural" },
  { id: "wrap", name: "Corner store with an L of back rooms", w: W(0.4, 0.8, 0.8, 0.2, 0.2), size: "L", lay: "wrap", sideW: 3, side: [[3, "office"], ["*", "wc"]], back: [["*", "stock"]], ex: ["back"], st: 2, up: "flat" },
];
V.grocery.variants = [
  { id: "neighbourhood", name: "Neighbourhood grocery", w: W(0.6, 1, 0.8, 0.4, 0.6), size: "M", lay: "strip", back: [["*", "stock"], [3, "cooler"], [[3, 4], "office"], [2, "wc"]], ex: ["back", "fire"] },
  { id: "bakery", name: "Grocery with an in-store bakery", w: W(0.4, 1, 0.8, 0.2, 0.6), size: "M", lay: "strip", back: [[5, "bakery"], ["*", "stock"], [3, "cooler"], [2, "wc"]], ex: ["back"] },
  { id: "butcher", name: "Butcher and grocer", w: W(0.8, 1, 0.4, 0.2, 0.2), size: "S", lay: "strip", back: [[5, "butcher"], [3, "cooler"], ["*", "stock"], [3, "office"]], ex: ["back", "side"] },
  { id: "dock", name: "Grocery with a loading dock", w: W(0.4, 0.8, 0.8, 0.6, 0.8), size: "L", lay: "strip", back: [["*", "stock"], [3, "cooler"], [3, "freezer"], [3, "office"]], ex: ["dock", "back"] },
  { id: "pharmacy", name: "Grocery with a pharmacy counter", w: W(0.4, 0.8, 1, 0.4, 0.8), size: "M", lay: "strip", back: [[4, "pharm"], ["*", "stock"], [3, "cooler"], [2, "wc"]], ex: ["back", "front2"] },
  { id: "coop", name: "Food co-op with offices upstairs", w: W(0.4, 1, 0.8, 0, 0.2), size: "S", lay: "strip", back: [["*", "stock"], [3, "cooler"], [4, "members"]], ex: ["back"], st: 2, up: "offices" },
  { id: "international", name: "International market", w: W(0, 0.6, 1, 0.2, 0.6), size: "M", lay: "strip", back: [["*", "stock"], [3, "cooler"], [4, "spice"], [2, "wc"]], ex: ["side"] },
  { id: "annex", name: "Grocery with a beer and wine annex", w: W(0.4, 0.8, 0.6, 0.6, 0.6), size: "L", lay: "wrap", sideW: 4, side: [["*", "annex"]], back: [["*", "stock"], [3, "cooler"], [2, "wc"]], ex: ["back"] },
  { id: "twostorey", name: "Two-storey grocery with a stockroom above", w: W(0.2, 0.8, 1, 0, 0.2), size: "L", lay: "strip", back: [["*", "stock"], [3, "cooler"], [2, "wc"]], ex: ["back", "fire"], st: 2, up: "stock" },
  { id: "corridor", name: "Grocery with a service corridor", w: W(0.2, 0.8, 0.8, 0.6, 0.8), size: "L", lay: "corridor", back: [["*", "stock"], [3, "cooler"], [3, "freezer"], [3, "office"], [3, "brk"], [2, "wc"]], ex: ["back", "dock"] },
  { id: "florist", name: "Market with a florist", w: W(0.2, 1, 0.8, 0.2, 0.6), size: "S", lay: "strip", back: [["*", "stock"], [3, "cooler"], [4, "florist"], [2, "wc"]], ex: ["front2", "back"] }, // the florist in the back row: the sales floor keeps #22's aisles
  { id: "country", name: "Country supermarket with a feed corner", w: W(1, 0.6, 0, 0.6, 0), size: "M", lay: "strip", back: [["*", "stock"], [3, "cooler"], [4, "feed"]], ex: ["side", "back"], ground: "rural" },
];

// ---------- the supermarket (#22's plan, its rooms in every variant: shoplayout.js superstore) ----------
// Each variant: flip (the café side left or right; null: the dice), extra rooms down the outer columns (cafeX: on the
// café's side, pharmX: on the pharmacy's), docks (the loading dock's roller doors: 2 or 3; [2, 3] the dice), doors (the
// front entrances: 1 or 2), fire (the side fire exit), st (storeys), up (the upstairs: "mezz" the overstock, "food" a
// food hall), pumps (a fuel station on the lot).
V.supermarket.variants = [
  { id: "classic", name: "Supermarket", w: W(0.6, 1, 1, 0.6, 0.8), size: "M", docks: [2, 3], doors: 2, fire: 0.8, st: [1, 2], up: "mezz" },
  { id: "fuel", name: "Supermarket with a fuel station", w: W(0.6, 0.8, 0.4, 1, 0.6), size: "M", docks: 2, doors: 1, fire: 1, pumps: 4 },
  { id: "garden", name: "Supermarket with a garden centre", w: W(0.6, 1, 0.4, 0.6, 0.6), size: "L", cafeX: [{ role: "sales", name: "Garden centre", type: "garden", lay: "aislefront", hub: false, maxBoxes: 4 }], docks: 2, doors: 2, fire: 0 },
  { id: "liquor", name: "Supermarket with a liquor store", w: W(0.4, 0.8, 1, 0.6, 0.6), size: "M", pharmX: [{ role: "sales", name: "Liquor store", type: "liquor", lay: "minimart", hub: false, maxBoxes: 3 }], docks: 2, doors: 2, fire: 1 },
  { id: "mezzanine", name: "Two-storey supermarket", w: W(0.2, 0.8, 1, 0.4, 0.4), size: "L", docks: 3, doors: 2, fire: 1, st: 2, up: "mezz" },
  { id: "bank", name: "Supermarket with a bank branch", w: W(0.2, 0.6, 1, 0.2, 0.6), size: "M", cafeX: [{ role: "lobby", name: "Bank branch", type: "office", hub: false, maxBoxes: 1 }], docks: 2, doors: 1, fire: 0.8 },
  { id: "foodhall", name: "City supermarket with a food hall upstairs", w: W(0, 0.2, 1, 0, 0.2), size: "L", docks: 2, doors: 2, fire: 0, st: 2, up: "food" },
  { id: "discount", name: "Discount warehouse grocery", w: W(0.4, 0.6, 0.6, 1, 1), size: "L", docks: 3, doors: 1, fire: 0, backD: 13 },
  { id: "twoends", name: "Supermarket with doors at both ends", w: W(0.4, 0.8, 0.8, 0.6, 0.8), size: "M", docks: 2, doors: 2, fire: 1, fire2: true },
  { id: "florist", name: "Supermarket with a florist and photo lab", w: W(0.2, 0.8, 1, 0.4, 0.6), size: "M", cafeX: [{ role: "storage", name: "Florist", type: "garden", maxBoxes: 1 }], pharmX: [{ role: "office", name: "Photo lab", type: "store" }], docks: [2, 3], doors: 2, fire: 0.8 },
  { id: "regional", name: "Regional supermarket and hardware", w: W(1, 0.8, 0, 0.6, 0.2), size: "M", pharmX: [{ role: "sales", name: "Hardware corner", type: "hardware", lay: "hardware", hub: false, maxBoxes: 3 }], docks: 2, doors: 1, fire: 1, ground: "rural" },
  { id: "hyper", name: "Hypermarket with a fuel station and a mezzanine", w: W(0, 0.2, 0.6, 0.8, 0.6), size: "L", docks: 2, doors: 2, fire: 1, st: 2, up: "mezz", pumps: 4 },
];

// ======================================================================================
// Picking a variant
// ======================================================================================
/**
 * A tile's setting for the variants (SETTINGS): a city's blocks "city", a suburb "town", a road through open country
 * "highway", the rest "rural" (a strip mall's slot passes "strip" itself). @param {any} tile
 */
export const variantSetting = (tile) => (!tile ? null : tile.terrain === "city" ? "city" : tile.terrain === "suburb" ? "town" : tile.road ? "highway" : "rural");
/** The variants of a type ([] for a type with none). @param {string} key */
export const variantsOf = (key) => (VARIANT_TYPES[key] && VARIANT_TYPES[key].variants) || [];
/** Whether a type takes its plan from these tables. @param {string} key */
export const hasVariants = (key) => variantsOf(key).length > 0;
/** The franchise kind of a type (data-shops.js FRANCHISES' key: the gas station's are "gas"). @param {string} key */
const frKind = (key) => (key === "gasstation" ? "gas" : key);
/** A variant by its id, or null. @param {string} key @param {string | null | undefined} id */
export const variantById = (key, id) => (id ? variantsOf(key).find((v) => v.id === id) || null : null);
/**
 * The variant a building is (o.layout: a variant's id; else by its franchise, its setting and the dice): its row.
 * @param {string} key @param {Rng} rng @param {any} [o]
 */
export function shopVariant(key, rng, o = {}) {
  const list = variantsOf(key);
  const r = rng.next(); // the plan's first roll, always drawn
  const set = variantById(key, o.plan || o.layout);
  if (set) return set;
  const fr = o.variant ? (FRANCHISES[(o.kind && FRANCHISES[o.kind] ? o.kind : frKind(key))] || []).find((f) => f.id === o.variant) : null;
  const ids = fr && fr.plan && fr.plan.variants ? fr.plan.variants : null;
  const pool = ids ? list.filter((v) => ids.includes(v.id)) : list;
  const si = SETTINGS.indexOf(o.vset || o.setting); // vset: buildingmaps.js variantSetting (o.setting: #36's siteWhere, or a caller's own)
  const ws = (pool.length ? pool : list).map((v) => (si >= 0 ? v.w[si] : 1));
  const cands = pool.length ? pool : list;
  const tot = ws.reduce((a, b) => a + b, 0);
  if (!(tot > 0)) return cands[Math.floor(r * cands.length)];
  let x = r * tot;
  for (let i = 0; i < cands.length; i++) { x -= ws[i]; if (x < 0 && ws[i] > 0) return cands[i]; }
  return cands[cands.length - 1];
}

// ======================================================================================
// Building a variant's spec (buildingmaps.js assemble's input)
// ======================================================================================
const sz = (s, rng) => (Array.isArray(s) ? rng.int(s[0], s[1]) : s);
const MIN_FRONT = 8; // the cells across a sales floor keeps beside a side column
const DEEP_MIN = 15; // a deep plan's depth at least (the front, the middle band and the back strip)
const TIERS = new Set(["corner", "grocery", "supermarket"]); // #22's tiers: their footprints as #22 set them
// The containers a room holds are its area's share up to its maxBoxes (buildingmaps.js assemble): a bigger plan's rooms
// get maxBoxes × its area over the type's usual (today's footprint, TODAY_AREA), × the type's boxes (tuned with
// tools/shopvarianttest.js: every kind's loot a 100 cells within ±10% of today's), so a superstore holds as a shop
// does by its area. Never below a room's own.
// Today's footprint in the middle (cells: dev's plan before the variants and #24's sizes), which a room's maxBoxes is for.
const TODAY_AREA = { gasstation: 123, truckstop: 267, dealer: 273, bank: 227, autoshop: 176, garage: 135, workshop: 135 };
const midArea = (key) => { if (TIER_SIZES[key]) { const m = SIZES[key].M; return ((m[0] + m[1]) / 2) * ((m[2] + m[3]) / 2); } return TODAY_AREA[key] || 200; }; // a shop's: 16 × 12.5
/** @param {any} node @param {number} k */
function scaleBoxes(node, k) {
  if (!node || k === 1) return node;
  if (node.parts) { node.parts.forEach((p) => scaleBoxes(p[1], k)); return node; }
  if (!node.role || node.flat) return node;
  const was = node.maxBoxes ?? (ROLES[node.role] ? ROLES[node.role].maxBoxes : undefined) ?? 4;
  node.maxBoxes = Math.max(1, Math.round(was * k));
  return node;
}
/** The footprint class storeytest checks by the area (small, medium, large; xl past the large maps: its map its footprint and margins). */
const footOf = (bw, bh) => { const a = bw * bh; return a >= 700 && bw >= 30 ? "xl" : a <= 160 ? "small" : a <= 340 ? "medium" : "large"; };

/**
 * A variant's spec for a type: its footprint, its plan, its ways out, its storeys and its layout's name.
 * o: { variant (a franchise's id), kind (the place's kind), setting, layout (a variant's id), size (a size class: a
 * strip mall's slot) }. planOf: buildingmaps.js's franchise plan (the floor, the front room's name, the look, wide).
 * @param {string} key @param {Rng} rng @param {any} [o] @param {(leaf: any, plan: any) => any} [withPlan] @param {any} [plan]
 */
export function shopVariantSpec(key, rng, o = {}, withPlan = (l) => l, plan = {}) {
  const T = VARIANT_TYPES[key], v = shopVariant(key, rng, o);
  if (key === "supermarket") return superSpec(rng, v, o);
  const size = (o.size && SIZES[key][o.size]) || SIZES[key][v.size] || SIZES[key].M;
  const wide = plan.wide && !TIERS.has(key) ? 2 : 0;
  const bw = rng.int(size[0], size[1]) + wide, bh = Math.max(rng.int(size[2], size[3]), v.lay === "deep" && !TIERS.has(key) ? DEEP_MIN : 0); // a deep plan's three bands: at least DEEP_MIN deep
  const ih = bh - 2;
  const flip = rng.chance(0.5); // the side column's side (side, wrap) and the bays' end
  const colSide = flip ? "left" : "right", other = flip ? "right" : "left";
  // A truck stop's diner and its kitchen: one of #33's truck-stop diners (eaterylayout.js eateryVariant: its cuisine, its
  // counter and grill, its kitchen's line, its food), on the plan's dice.
  const ev = T.eatery ? eateryVariant({ format: "diner", setting: "truckstop", r: rng.next() }) : null;
  const eat = ev ? { eat: ev.cuisine, mix: `eat:${ev.cuisine}`, kind: "diner", ...(ev.tint ? { tint: ev.tint } : {}) } : null;
  const R = (t) => {
    if (t === S) return withPlan({ role: "sales", entry: true, ...T.base, ...(v.sales || {}) }, plan);
    if (typeof t !== "string") return { ...t };
    const leaf = T.rooms[t] || COMMON[t];
    if (eat && leaf && T.eatery[t]) return { ...leaf, ...eat, lay: T.eatery[t] };
    return leaf ? { ...leaf } : { role: t };
  };
  const P = (list) => list.map(([s, t]) => [sz(s, rng), R(t)]);
  const band = (list) => Xs(P(list));
  const front = v.front ? band(v.front) : R(S);
  const depth = v.depth ?? T.depth ?? 0.62;
  const midD = v.lay === "deep" ? sz(v.midD ?? 3, rng) : 0;
  const sd = T.depthBack ? Math.max(4, ih - T.depthBack - (v.lay === "corridor" ? 2 : 0) - (midD ? midD + 1 : 0)) : Math.max(4, Math.round(ih * depth)); // a grocery's: all but its back strip (#22)
  let program;
  const backParts = v.back ? P(v.back) : v.side ? P(v.side) : [[1, R(S)]]; // the back row's rooms (#23's stepped back stands behind one: buildingmaps.js shopShape)
  const back = v.back ? Xs(backParts) : null;
  switch (v.lay || "strip") {
    case "strip": program = Ys([[sd, front], ["*", back]]); break;
    case "corridor": program = Ys([[sd, front], [2, { role: "corridor", name: "Service corridor", type: T.base.type || "store", maxBoxes: 1 }], ["*", back]]); break; // shoplayout.js servicehall
    case "deep": program = Ys([[sd, front], [midD, band(v.mid)], ["*", back]]); break;
    case "side": case "wrap": {
      const main = back ? Ys([[Math.max(4, sd), front], ["*", back]]) : front;
      const col = [Math.max(3, Math.min(sz(v.sideW ?? 4, rng), bw - 3 - MIN_FRONT)), Ys(P(v.side))]; // the front keeps MIN_FRONT across (its counter, its aisles)
      program = Xs(flip ? [col, ["*", main]] : [["*", main], col]);
      break;
    }
    default: throw new Error(`shopvariants: no layout ${v.lay}`);
  }
  const s = { side: colSide, other, col: v.lay === "side" || v.lay === "wrap" ? colSide : null };
  const exits = [];
  let bay = null; // #23's annex on a new save's shaped plan (buildingmaps.js shopShape): the bay beside the box, the box without it
  if (v.bays) { // a service bay at one end (the other end from the side column), its roller door on the front
    const leaf = R(v.bays.leaf || "bay"), atLeft = !flip;
    const b = [sz(v.bays.w, rng), leaf];
    bay = { right: !atLeft, w: b[0] + 2, leaf: Object.assign(leaf, { nextTo: ["sales", "stock"] }), program };
    program = Xs(atLeft ? [b, ["*", program]] : [["*", program], b]);
    exits.push({ side: "front", roles: ["bays"], chance: 1, roller: true, width: v.bays.width || 2, lock: 0.2, name: v.bays.ex || "Bay door" });
    if (v.bays.back) exits.push({ side: "back", roles: ["bays"], chance: 1, roller: true, width: v.bays.width || 2, lock: 0.2, name: "Back bay door" });
  }
  for (const t of v.ex || []) {
    if (t === "bay3") exits.push({ ...exitOf("bay2", s), width: 3 });
    else if (t === "bayback3") exits.push({ ...exitOf("bayback", s), width: 3 });
    else exits.push(exitOf(t, s));
  }
  let n = Array.isArray(v.st) ? rng.int(v.st[0], v.st[1]) : v.st || 1, upName = v.up || "stock";
  if (n === 1 && !v.st && plan.flat && rng.chance(plan.flat)) { n = 2; upName = "flat"; } // a franchise's flat above (data-shops.js plan.flat: a bodega, a used bookshop)
  const up = n > 1 ? UPPER[upName] : null;
  const type = T.base.type;
  const bk = Math.max(1, (bw * bh) / midArea(key)) * (T.boxes ?? 1);
  scaleBoxes(program, bk);
  return {
    bw, bh, program, exits, front: { width: v.fw || T.fw || (bw >= 14 ? 2 : 1) }, openDoors: T.openDoors ?? 0.3,
    ground: v.ground || T.ground || "town", pumps: v.pumps ?? T.pumps ?? 0,
    storeys: n, upper: up ? (g, r, ctx) => scaleBoxes(up(g, r, { ...ctx, type }), bk) : null, foot: footOf(bw, bh),
    stairs: { roles: BACK_STAIRS }, layout: { id: v.id, name: v.name }, vname: v.name, vid: v.id, backParts, bay,
  };
}

// The supermarket's spec for a variant (#22's plan: the sales floor with its café, restrooms and bakery down one side,
// the pharmacy and the deli and butcher down the other, the back of house of warehouse, walk-ins, baler, offices and
// break room; the variant's extra rooms, docks, doors, storeys and pumps).
/** @param {Rng} rng @param {any} v @param {any} o */
function superSpec(rng, v, o) {
  const size = (o.size && SIZES.supermarket[o.size]) || SIZES.supermarket[v.size] || SIZES.supermarket.M;
  const bw = rng.int(size[0], size[1]), bh = rng.int(size[2], size[3]), backD = v.backD || rng.int(11, 12);
  const flip = rng.chance(0.5);
  const xs = (list) => (list || []).map((l) => [6, { ...l }]);
  const cafeSide = Ys(leaves([[7, { role: "dining", name: "Café", type: "store", lay: "cafe", hub: false, maxBoxes: 3 }], [5, Xs(leaves([["*", { role: "restroom", name: "Men's restroom" }], ["*", { role: "restroom", name: "Women's restroom" }]]))], ...xs(v.cafeX), ["*", { role: "kitchen", name: "Bakery", type: "kitchen", lay: "bakery", maxBoxes: 4 }]]));
  const pharmSide = Ys(leaves([[8, { role: "dispensary", name: "Pharmacy", type: "pharmacy", lay: "dispensary", lock: ["door", 0.3], boxLock: ["drugs", 0.4], maxBoxes: 3 }], ...xs(v.pharmX), ["*", { role: "kitchen", name: "Deli and butcher", type: "kitchen", lay: "butcher", maxBoxes: 4 }]]));
  const floor = { role: "sales", entry: true, name: "Sales floor", type: "store", lay: "superstore", maxBoxes: 60 };
  const main = Xs(flip ? [[8, pharmSide], ["*", floor], [8, cafeSide]] : [[8, cafeSide], ["*", floor], [8, pharmSide]]);
  const cold = { name: "Walk-in cooler", type: "kitchen", cold: true, dk: "steel", windows: false, fl: "steel", maxBoxes: 4 };
  const backRooms = [
    ["*", { role: "warefloor", name: "Warehouse", type: "store", lay: "warehouse", hub: true, maxBoxes: 26 }],
    [7, Ys(leaves([["*", { role: "pantry", ...cold, lay: "walkin" }], ["*", { role: "pantry", ...cold, name: "Walk-in freezer", lay: "walkfreezer", fl: "steel" }]]))],
    [6, { role: "storage", name: "Compactor and baler", type: "warehouse", lay: "baler", maxBoxes: 1 }],
    [8, Ys(leaves([["*", { role: "office", name: "Cash office", lock: ["door", 0.6], boxLock: ["safe", 0.8], maxBoxes: 2 }], ["*", { role: "office", name: "Manager's office", boxLock: ["safe", 0.4] }]]))],
    [8, Ys(leaves([["*", "breakroom"], [3, { role: "restroom", name: "Staff restroom" }]]))],
  ];
  const back = Xs(leaves(flip ? backRooms.slice().reverse() : backRooms));
  const n = Array.isArray(v.st) ? (rng.chance(0.4) ? 2 : 1) : v.st || 1;
  const two = n > 1;
  const mezz = () => Ys([["*", { role: "warefloor", name: "Mezzanine stockroom", maxBoxes: 12 }], [7, Xs(leaves([["*", { role: "office", name: "Offices" }], ["*", { role: "breakroom", name: "Training room" }], [8, { role: "storage", name: "Records", type: "office" }], [4, "restroom"]]))]]);
  const food = () => Ys([["*", { role: "dining", name: "Food hall", type: "store", lay: "cafe", maxBoxes: 6 }], [7, Xs(leaves([["*", { role: "warefloor", name: "Overstock", maxBoxes: 8 }], ["*", { role: "office", name: "Offices" }], [4, "restroom"]]))]]);
  const docks = Array.isArray(v.docks) ? rng.int(v.docks[0], v.docks[1]) : v.docks;
  const exits = [];
  if (v.doors >= 2) exits.push({ side: "front", roles: ["sales"], chance: 1, width: 2, lock: 0.2, name: "Exit doors" });
  for (let i = 0; i < docks; i++) exits.push({ side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 3, lock: i ? 0.3 : 0.2, name: "Loading dock" });
  exits.push({ side: "back", roles: ["breakroom", "storage", "office"], chance: 0.7, lock: 0.4, name: "Staff door" });
  const fs = flip ? "right" : "left";
  if (v.fire) exits.push({ side: rng.chance(0.5) ? "left" : "right", roles: ["sales", "dining", "kitchen"], chance: v.fire, lock: 0.4, name: "Fire exit" });
  if (v.fire2) exits.push({ side: fs, roles: ["sales", "dining", "kitchen", "lobby", "office", "storage"], chance: 1, lock: 0.4, name: "Side entrance" }, { side: fs === "left" ? "right" : "left", roles: ["sales", "dining", "kitchen", "lobby", "office", "storage", "dispensary"], chance: 1, lock: 0.4, name: "Side entrance" });
  return {
    bw, bh, front: { width: 2 }, openDoors: 0.3, ground: v.ground || "lot", storeys: n, upper: n > 1 ? (v.up === "food" ? food : mezz) : null, foot: "huge", stairs: { roles: BACK_STAIRS },
    margins: { back: 8 }, dockTruck: true, pumps: v.pumps || 0,
    program: Ys([["*", main], [backD, back]]), exits, layout: { id: v.id, name: v.name }, vname: v.name, vid: v.id,
    parts: { cafeSide, pharmSide, floor, back, flip, backD, two, mezz: v.up === "food" ? food : mezz }, // #23's shape (buildingmaps.js superShape)
  };
}

/**
 * A kind's plan for a slot (#30's strip mall, a test): the spec of the variant o.layout names (else by the franchise,
 * the setting and the dice) at size class o.size. Its own dice when no rng is given.
 * @param {string} kind @param {any} [o] @param {Rng} [rng]
 */
export function shopPlan(kind, o = {}, rng) {
  if (!hasVariants(kind)) return null;
  return shopVariantSpec(kind, rng || new Rng(o.seed || 1), o);
}
/** The layout's name a place shows under its own ("Drive-through pharmacy"), or "". @param {any} spec */
export const layoutName = (spec) => planName(spec) || ""; // planname.js (issue #40): the one reader of a plan's name
