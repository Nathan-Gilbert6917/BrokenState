// @ts-check
// Hotels (the user's request 2026-10-25, issue #29 of the interiors epic #7: "add hotel 200x200 max"): the plans of the
// four kinds, their rooms laid out for their kind, their grounds and their signs of survival. buildingmaps.js's hotel
// archetype calls hotelSpec; its rooms take the styles here through shoplayout.js (every leaf names its style: lay);
// hotels.js puts them on the map and in the crawl.
//
// THE KINDS (a hotel's franchise says which: data-shops.js FRANCHISES.hotel plan.hotel; a hotel with none, a sample
// plan, by HOTEL.ANY's dice). Sizes in cells, about a metre each (#24's CELL_M; HOTEL.SIZE until #24's size table is on
// dev):
//   inn       a roadside inn or a B&B, 21–25 × 19, 3 storeys (2, half the time, when 25 wide: its ground floor then
//             has guest rooms and their housekeeping too, the owners' flat at the front, the laundry upstairs): the
//             reception, the parlour, the breakfast room, a small kitchen, the laundry and the owners' flat on the ground
//             floor; 10–20 rooms. One stair run (a stairwell at the end of the back band).
//   business  40–60 × 21–23, 4–6 storeys: the lobby and its front desk, the restaurant, a bar when 50 wide, the gift
//             shop, the kitchen and its walk-in, the luggage room, the restrooms, the manager's office, the staff
//             lockers, the loading bay when 48 wide; the conference floor above (conference rooms, the business centre,
//             the gym, a ballroom when 50 wide, the laundry, the maintenance shop); guest floors over it.
//   resort    64–90 × 21–23, 2–4 storeys (a long block: #23's L and U wings are not on dev yet): guest wings either
//             side of the core on the ground floor (the grand lobby, the restaurant, the bar, the gift shop; the wings'
//             housekeeping closet and ice nook at their ends), behind it
//             the ballroom, the spa, the gym, the kitchen; the back of house upstairs; the pool deck (an empty pool),
//             tennis courts and gardens in the grounds behind.
//   tower     36–44 × 21–23, 8–10 storeys (buildingmaps.js MAX_STOREYS caps it: 8 until #24 raises it to 10): the grand
//             lobby, the gift shop, the restaurant, the kitchen, the luggage room and the parking garage below the
//             floors (its roller door at the back, the loading dock); the ballroom and a conference room, the back of
//             house above; the gym, the spa and the business centre; guest floors; the top floor's penthouse and
//             rooftop bar.
// Every floor of the business hotel, the resort and the tower has two stairwells (one at each end of the front band:
// two stair runs, #9) and a lift lobby (its lift doors on the wall: the shaft behind them is no way through).
//
// THE VARIANTS (issue #38, the user's requests 2026-10-25: "every building should have several varients"; "for
// buildings with no to only a few varients create a dozen varients per building type"): twelve a kind, data-hotels.js
// HOTEL_VARIANTS, each a plan of its own in PLANS below (its rooms, their order, its entrances, corridor or atrium or a
// core, its size and storeys); the kinds above are each kind's classic plan (#29's, cell for cell). hotelSpec takes the
// variant pinned (o.vid: a POI's hv, a crawl place's), else a chain's classic plan (a hotel made before the variants),
// else one by the dice. The rooms the variants add (a tavern, a boot room, a casino floor, a stable...) take the styles
// at the end of HOTEL_STYLES.
//
// THE GUEST FLOORS: a corridor down the middle, rooms either side. A room (HOTEL.UNIT wide inside) is a bedroom by the
// corridor (a bed or two, a nightstand, a desk and its chair, a TV stand, a wardrobe, the minibar, a suitcase now and
// then) and its en suite bathroom by the window (a toilet, a sink, a tub or a shower); the two share a unit, so the
// bathroom's door is the bedroom's and the bedroom's the corridor's. The room left the most cells at the end of a row is
// a suite (HOTEL.SUITE wide: a sitting room beside the bedroom). Each floor has its housekeeping closet (linen carts,
// shelves of toiletries: soap, shampoo, the little bottles) and its ice and vending nook.
//
// THE GROUNDS (spec.yard: buildingmaps.js assemble calls it on the ground floor before the outside is dressed; HOTEL.
// GROUNDS the margins, cut down so the map is within battlesize.js MAP_CAP.hotel, 200 × 200): the drive from the road to
// the front door, the car park (cars in rows), a service yard (a truck, crates), the gardens (trees, bushes, a gravel
// path), the resort's pool deck (paving, an empty pool with its deep end, loungers, a fence with a gate) and tennis
// courts (lines on green, a wire fence, the net).
//
// THE LOOT: the guests' luggage (the luggage room's and the rooms' suitcases), the front desk's safe (cash, valuables),
// the kitchen's food and its walk-in, the minibars (snacks, drinks), housekeeping's toiletries (combat.js BOX_LOOT and
// data-shops.js AREA_DEFS). A room's containers by its area as everywhere (a guest room HOTEL.ROOM_BOXES), so a bigger
// hotel holds more, each container a little less past the old Large map (battlesize.js BIG).
//
// SIGNS OF SURVIVAL (interiorscenes.js registerScene, when: the map is a hotel's): guests barricaded on an upper floor
// (furniture on the stairs' top landing, notes slipped under doors), the ballroom an evacuation centre (cots in rows, a
// Red Cross table), the lobby overrun (luggage strewn, the dead, blood), the penthouse held (its door barred from inside:
// floorfolk.js's survivors or raiders take it first in the crawl).
//
// An older save never had a hotel: no legacy plan (every hotel is new).
import { registerScene, scenePieces, SCENES } from "./interiorscenes.js";
import { COMMERCIAL_STYLES, COMMERCIAL_KEYS } from "./shoplayout.js";
import { HOME_STYLES } from "./roomlayout.js";
import { mapCap } from "./battlesize.js";
import { REAL_SIZE } from "./data-buildingsize.js"; // the sizes (issue #24 took over HOTEL.SIZE)
import { hotelVariantById, hotelVariantFor, CLASSIC } from "./data-hotels.js"; // a dozen variants a kind (issue #38)

export const HOTEL = {
  KINDS: ["inn", "business", "resort", "tower"],
  ANY: { inn: 0.3, business: 0.35, resort: 0.15, tower: 0.2 }, // a hotel with no franchise (a sample plan): its kind
  // Footprints in cells (≈ 1 m: #24's CELL_M), [min, max]: w the width, d the depth, the storeys.
  // #24's real-world size table holds them now (data-buildingsize.js REAL_SIZE hotelinn…hoteltower, planned).
  SIZE: Object.fromEntries(["inn", "business", "resort", "tower"].map((k) => [k, REAL_SIZE[`hotel${k}`]])),
  UNIT: { inn: 3, big: 4 },     // a standard room's width inside its walls
  SUITE: 7,                     // a room this wide or wider is a suite (a sitting room beside the bedroom)
  FRONT: { inn: 7, big: 8 },    // the front band's depth: the bathroom (2), its wall, the bedroom
  BATH: 2,                      // the en suite bathroom's depth
  ROOM_BOXES: 3,                // a guest room's containers (the minibar, the wardrobe or the nightstand, a suitcase)
  SUITCASE: 0.45,               // a guest's suitcase left in a room
  TWIN: 0.4,                    // a room with two beds
  // The outside round each kind (cells): parking and the drive in front, the service yard or the gardens behind, the
  // resort's pool deck and tennis courts; cut down to battlesize.js MAP_CAP.hotel.
  GROUNDS: {
    inn: { front: 9, back: 8, left: 6, right: 6 },
    business: { front: 16, back: 9, left: 8, right: 8 },
    resort: { front: 16, back: 38, left: 12, right: 12 },
    tower: { front: 9, back: 8, left: 7, right: 7 },
  },
  CARS: { inn: [2, 4], business: [6, 12], resort: [5, 10], tower: [0, 2] },
  POOL: [12, 6],               // the pool's basin (w × h), the deck round it 3 wide
  COURT: [11, 23],             // a tennis court (w × h) inside its fence
};
// ---------- the plans ----------
const leaves = (list) => list.map(([s, r]) => [s, typeof r === "string" ? { role: r } : r]);
function corridorPlan(front, back, fd, cw, hall) {
  return { split: "y", parts: [[fd, { split: "x", parts: leaves(front) }], [cw, { role: "corridor", name: "Corridor", lay: "hotelhall", fl: "carpet", ...hall }], ["*", { split: "x", parts: leaves(back) }]] };
}
const SW = [3, { role: "stairwell", lay: "stairwell" }];
const HK = (w = 3) => [w, { role: "storage", name: "Housekeeping", type: "hotelhk", lay: "housekeeping", fl: "lino", maxBoxes: 2, lock: ["door", 0.25] }];
const ICE = (w = 3) => [w, { role: "hall", name: "Ice and vending", hub: false, type: "hotelhk", lay: "icenook", fl: "lino", maxBoxes: 1 }];
const LIFT = [4, { role: "hall", name: "Lift lobby", lay: "liftlobby", fl: "carpet" }];

// A guest room and its bathroom (side: the band it stands in, "front" or "back": the bathroom by the window), or a
// suite (w ≥ HOTEL.SUITE: a sitting room by the bedroom). no: its number ("214"), fl: the franchise's floor. ro: the
// variant's say over the room (lay: an extended-stay's studio with its kitchenette; prefix: "Residence" for a tower's
// flats, role "apt"; bath: false for none).
function unit(w, f, n, side, fl, ro = {}) {
  const no = `${f + 1}${String(n).padStart(2, "0")}`, u = `h${f}-${n}`;
  const { prefix = "Room", bath: hasBath = true, ...over } = ro;
  const room = { role: "motelroom", name: `${prefix} ${no}`, type: "hotelroom", lay: "guestroom", unit: u, maxBoxes: HOTEL.ROOM_BOXES, boxTarget: HOTEL.ROOM_BOXES, fl, ...over };
  const node = w >= HOTEL.SUITE && !ro.lay
    ? { split: "x", parts: [["*", { role: "motelroom", name: `Suite ${no}`, type: "hotelroom", lay: "suite", unit: u, maxBoxes: 2, fl }], ["*", { ...room, name: `Suite ${no}: bedroom` }]] }
    : room;
  if (!hasBath) return node;
  const bath = { role: "bath", name: `Bath ${no}`, type: null, lay: "ensuite", unit: u };
  return { split: "y", parts: side === "front" ? [[HOTEL.BATH, bath], ["*", node]] : [["*", node], [HOTEL.BATH, bath]] };
}
// A band len cells long: head and tail (fixed leaves) at its ends, guest rooms between, as many of uw as fit; the last
// takes what is left over (a suite when that makes it HOTEL.SUITE wide).
function band(len, head, tail, uw, f, side, n0, fl, ro) {
  const fixed = [...head, ...tail].reduce((a, [s]) => a + s, 0), k = head.length + tail.length;
  const n = Math.max(0, Math.floor((len - fixed - k + 1) / (uw + 1)));
  if (!n) return { parts: [...head, ...tail], rooms: 0 };
  const rest = len - fixed - (k + n - 1) - n * uw;
  const units = [];
  for (let i = 0; i < n; i++) { const last = i === n - 1, w = last ? uw + rest : uw; units.push([last ? "*" : uw, unit(w, f, n0 + i, side, fl, ro)]); }
  return { parts: [...head, ...units, ...tail], rooms: n };
}
// A guest floor: rooms on both sides of the corridor, the stairwells, housekeeping, the ice nook and the lift lobby.
// o: wide (cells more a room: the top floor's), innTail (an inn's back band's end), uw (the room's width), ro (unit's),
// hall (the corridor's leaf: an atrium's gallery), fHead / fTail / bHead / bTail (the bands' ends).
function guestFloor(kind, f, bw, bh, fl, o = {}) {
  const inn = kind === "inn", uw = o.uw || (inn ? HOTEL.UNIT.inn : HOTEL.UNIT.big), fd = inn ? HOTEL.FRONT.inn : HOTEL.FRONT.big, cw = inn ? 1 : 2, len = bw - 2;
  const fr = band(len, o.fHead || (inn ? [] : [SW, HK()]), o.fTail || (inn ? [ICE(2)] : [ICE(), SW]), uw + (o.wide || 0), f, "front", 1, fl, o.ro);
  const bk = band(len, o.bHead || (inn ? [[3, { role: "stairwell", lay: "stairwell" }]] : [LIFT]), o.bTail || (inn ? o.innTail || [HK()] : []), uw + (o.wide || 0), f, "back", fr.rooms + 1, fl, o.ro);
  return corridorPlan(fr.parts, bk.parts, fd, cw, o.hall);
}
const pick = (rng, r) => rng.int(r[0], r[1]);
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * A hotel's spec (buildingmaps.js assemble). o: { plan (the franchise's: planOf), vid (one of data-hotels.js
 * HOTEL_VARIANTS: the variant, pinned), maxStoreys, legacy, storeyBonus }. The variant: o.vid; else the chain's kind's
 * classic plan (#29's: a hotel made before the variants); a hotel with no chain and no variant, a kind and a variant by
 * the dice. A caller with only a kind (#30's mall) passes { plan: { hotel: kind } } or { vid }.
 * @param {any} rng @param {any} [o]
 */
export function hotelSpec(rng, o = {}) {
  const plan = o.plan || {};
  const pinned = hotelVariantById(o.vid);
  const kind = pinned ? pinned.kind : HOTEL.KINDS.includes(plan.hotel) ? plan.hotel : pickKind(rng);
  const v = pinned || (HOTEL.KINDS.includes(plan.hotel) ? hotelVariantById(CLASSIC[kind]) : hotelVariantById(hotelVariantFor(kind, null, null, rng.next())));
  const S0 = HOTEL.SIZE[kind], vs = (v && v.size) || {};
  const S = { w: vs.w || S0.w, d: vs.d || S0.d, storeys: vs.storeys || S0.storeys };
  const maxS = o.maxStoreys || 8;
  const bw = pick(rng, S.w), bh = pick(rng, S.d);
  const fl = plan.fl || "carpet", wallc = plan.look ? plan.look.wall : undefined;
  const C = { rng, kind, bw, bh, S, maxS, fl, wallc, o, R: rooms(kind, fl, wallc) };
  /** @type {any} */
  const spec = (PLANS[v.id] || PLANS[CLASSIC[kind]])(C);
  if (v.boxK) spec.boxScale = v.boxK; // its loot a floor cell near its kind's (tools/hotelvarianttest.js)
  spec.vid = v.id; spec.vname = v.name; // the plan's name (the map, the raid's opening line, the POI)
  const G = { ...KIND_GROUNDS[kind], ...(spec.grounds || {}) };
  spec.margins = groundsFor(kind, bw, bh);
  spec.yard = (Y) => dressGrounds(Y, kind, G);
  return spec;
}
function pickKind(rng) {
  let r = rng.next() * Object.values(HOTEL.ANY).reduce((a, b) => a + b, 0);
  for (const k of HOTEL.KINDS) { r -= HOTEL.ANY[k]; if (r < 0) return k; }
  return "business";
}
// The grounds round a kind, cut so the whole map is within battlesize.js MAP_CAP.hotel.
export function groundsFor(kind, bw, bh) {
  const g = { ...HOTEL.GROUNDS[kind] }, cap = mapCap("hotel") || Infinity;
  const cut = (a, b, room) => { let over = a.v + b.v + room - cap; while (over > 0) { if (a.v >= b.v && a.v > 3) a.v--; else if (b.v > 3) b.v--; else break; over--; } };
  const L = { v: g.left }, R = { v: g.right }, F = { v: g.front }, B = { v: g.back };
  cut(L, R, bw); cut(F, B, bh);
  return { left: L.v, right: R.v, front: F.v, back: B.v };
}
// What a kind's grounds hold unless its variant says otherwise (dressGrounds): pools (pool decks), courts (tennis), trees
// (the gardens), yard (the service yard behind), plaza (paving and planters in front), corral (a fenced paddock).
const KIND_GROUNDS = {
  inn: { trees: 5 },
  business: { yard: true },
  resort: { pools: 1, courts: true, trees: 14 },
  tower: { yard: true, plaza: true },
};

// ---------- the rooms a plan draws on ----------
function rooms(kind, fl, wallc) {
  const R = {
    lobbyOf: (name, extra = {}) => ({ role: "lobby", entry: true, name, type: "hotelfront", lay: "hotellobby", fl: kind === "inn" ? fl : "tile", maxBoxes: 2, ...(wallc ? { wallc } : {}), ...extra }),
    kitchen: { role: "kitchen", name: "Kitchen", lay: "galley", fry: true },
    walkin: { role: "pantry", name: "Walk-in cold room", type: "kitchen", cold: true, dk: "steel", windows: false, fl: "steel", lay: "walkin", maxBoxes: 2 },
    restaurant: (name = "Restaurant") => ({ role: "dining", name, type: "kitchen", lay: "hotelrestaurant", maxBoxes: 2, fl: "hardwood" }),
    bar: (name = "Bar") => ({ role: "dining", name, type: "bar", lay: "barroom", maxBoxes: 3, fl: "hardwood" }),
    gift: { role: "sales", name: "Gift shop", type: "store", lay: "giftshop", hub: false, maxBoxes: 3 },
    luggage: { role: "storage", name: "Luggage room", type: "luggage", lay: "luggage", fl: "carpet", maxBoxes: 4, boxTarget: 4 },
    restrooms: { role: "restroom", name: "Restrooms", lay: "restroom", label: true },
    manager: { role: "office", name: "Manager's office", type: "office", lay: "manager", lock: ["door", 0.4], boxLock: ["safe", 0.6] },
    lockers: { role: "lockerroom", name: "Staff lockers", type: "lockers", lay: "stafflockers" },
    laundry: { role: "storage", name: "Laundry", type: "hotelhk", lay: "hotellaundry", fl: "tile", windows: false },
    maint: { role: "workshop", name: "Maintenance", type: "workshop", lay: "workshop", lock: ["door", 0.3] },
    bizc: { role: "office", name: "Business centre", type: "office", lay: "bizcentre" },
    conf: (name = "Conference room") => ({ role: "office", name, type: "office", lay: "conference", maxBoxes: 1 }),
    ballroom: { role: "dining", name: "Ballroom", type: "kitchen", lay: "ballroom", hub: true, maxBoxes: 1, fl: "hardwood" },
    gym: { role: "gym", name: "Gym", type: "lockers", lay: "hotelgym" },
    spa: { role: "lockerroom", name: "Spa", type: "hotelhk", lay: "spa", fl: "tile" },
    loading: { role: "bays", name: "Loading bay", type: "warehouse", lay: "loading", fl: "conc", maxBoxes: 3 },
    garage: { role: "bays", name: "Parking garage", type: "garage", lay: "parking", fl: "conc", maxBoxes: 3 },
    penthouse: { role: "motelroom", name: "Penthouse suite", type: "hotelroom", lay: "penthouse", maxBoxes: 5, boxTarget: 5, fl: "hardwood" },
    parlour: (name = "Parlour") => ({ role: "living", name, type: "house", lay: "parlour", hub: false, fl }),
    breakfast: (name = "Breakfast room") => ({ role: "dining", name, type: "kitchen", lay: "breakfast", maxBoxes: 1, fl }),
    flat: { role: "apt", name: "Owners' flat", type: "house", lay: "ownersflat", lock: ["door", 0.3], maxBoxes: 3 },
    // Issue #38's rooms (their styles below).
    greatroom: (name = "Great room") => ({ role: "greatroom", name, type: "cabin", lay: "lodgehall", fl: "plank" }),
    library: (name = "Library") => ({ role: "dayroom", name, type: "house", lay: "library", hub: false, fl: "hardwood" }),
    dayroom: (name, lay = "parlour") => ({ role: "dayroom", name, type: "house", lay, hub: false }),
    shop: (name) => ({ role: "sales", name, type: "store", lay: "giftshop", hub: false, maxBoxes: 3 }),
    cafe: (name) => ({ role: "cafeteria", name, type: "kitchen", lay: "hotelrestaurant", maxBoxes: 2, fl: "checker", hub: false }),
    buffet: (name = "Buffet") => ({ role: "cafeteria", name, type: "kitchen", lay: "buffet", maxBoxes: 2, fl: "tile", hub: false }),
    atrium: (name = "Atrium") => ({ role: "hall", name, lay: "atrium", hub: true, label: true, fl: "tile" }),
    foyer: (name) => ({ role: "foyer", name, type: "office", lay: "atrium", maxBoxes: 1, fl: "carpet" }),
    bootroom: (name = "Boot room") => ({ role: "lockerroom", name, type: "lockers", lay: "bootroom", fl: "rubber" }),
    skishop: (name = "Ski rental") => ({ role: "sales", name, type: "sportshop", lay: "skirental", hub: false, maxBoxes: 3 }),
    cellar: (name = "Wine cellar") => ({ role: "pantry", name, type: "bar", lay: "winecellar", windows: false, fl: "conc", maxBoxes: 3 }),
    tasting: { role: "dining", name: "Tasting room", type: "bar", lay: "tasting", fl: "hardwood", maxBoxes: 2 },
    barrels: { role: "storage", name: "Barrel room", type: "warehouse", lay: "barrels", fl: "conc", windows: false },
    boathouse: (name = "Boathouse") => ({ role: "hgarage", name, type: "garage", lay: "boathouse", fl: "plank" }),
    gunroom: { role: "gunroom", name: "Gun room", type: "cabin", lay: "gunroom", lock: ["door", 0.5] },
    fishroom: { role: "workshop", name: "Fish-cleaning room", type: "kitchen", lay: "fishroom", fl: "tile" },
    sunroom: { role: "living", name: "Sunroom", type: "house", lay: "sunroom", hub: false, fl },
    beachstore: (name) => ({ role: "storage", name, type: "sportshop", lay: "beachstore", fl: "plank" }),
    casino: { role: "hall", name: "Casino floor", type: "bar", lay: "casino", hub: true, label: true, fl: "carpet", maxBoxes: 3 },
    cashier: { role: "office", name: "Cashier's cage", type: "office", lay: "cashier", lock: ["door", 0.6], boxLock: ["safe", 0.8] },
    showroom: { role: "nave", name: "Showroom", type: "bar", lay: "showroom", fl: "carpet", maxBoxes: 1 },
    arcade: (name = "Arcade") => ({ role: "dayroom", name, type: "store", lay: "arcade", hub: false }),
    kidsclub: { role: "classroom", name: "Kids' club", type: "house", lay: "kidsclub", fl: "rubber" },
    pool: (name = "Indoor pool") => ({ role: "gym", name, type: "lockers", lay: "indoorpool", fl: "tile" }),
    chemist: (name = "Pharmacy kiosk") => ({ role: "dispensary", name, type: "store", lay: "chemist", windows: true }),
    lecture: (name = "Lecture room") => ({ role: "classroom", name, type: "office", lay: "conference", maxBoxes: 1 }),
    exhibit: { role: "warefloor", name: "Exhibit hall", type: "store", lay: "exhibit", hub: true, fl: "conc", maxBoxes: 3 },
    cartbarn: { role: "bays", name: "Cart barn", type: "garage", lay: "cartbarn", fl: "conc", maxBoxes: 3 },
    tack: { role: "tack", name: "Tack room", type: "barn", lay: "tackroom" },
    stable: { role: "barnfloor", name: "Stables", type: "barn", lay: "stable", fl: "dirt", hub: false },
    chapel: { role: "nave", name: "Wedding chapel", type: "chapel", lay: "chapel", fl: "carpet", maxBoxes: 1 },
    florist: { role: "storage", name: "Florist", type: "garden", lay: "florist", fl: "tile" },
    meditation: { role: "vestry", name: "Meditation hall", type: "chapel", lay: "meditation", fl: "hardwood", maxBoxes: 1 },
    yoga: { role: "gym", name: "Yoga studio", type: "lockers", lay: "yoga", fl: "hardwood" },
    pods: { role: "bunk", name: "Capsule pods", type: "hotelroom", lay: "pods", fl: "lino" },
    washroom: { role: "restroom", name: "Washroom", lay: "restroom", label: true },
    gallery: { role: "sales", name: "Gallery", type: "store", lay: "gallery", hub: false, maxBoxes: 2 },
    barber: { role: "lockerroom", name: "Barber shop", type: "lockers", lay: "barber", fl: "checker" },
    office: (name) => ({ role: "office", name, type: "office", lay: "bizcentre" }),
    baggage: { role: "terminal", name: "Baggage hall", type: "luggage", lay: "luggage", fl: "tile", maxBoxes: 4, boxTarget: 4 },
  };
  return R;
}
const STAIR = [3, { role: "stairwell", lay: "stairwell" }];
const fire = (lock, roles = ["corridor"]) => [{ side: "left", roles, chance: 0.85, lock, name: "Fire exit" }, { side: "right", roles, chance: 0.85, lock, name: "Fire exit" }];
const bigOf = (C) => ({ bw: C.bw, bh: C.bh, front: { width: 2 }, extraDoors: 0, openDoors: 0.2, foot: "large", stairs: { roles: ["stairwell"], n: 2, len: 3 }, hotel: C.kind });
const innOf = (C, n) => ({ bw: C.bw, bh: C.bh, front: { width: 1 }, extraDoors: 0, openDoors: 0.25, foot: "large", hotel: "inn", ground: "town", storeys: n, stairs: { roles: ["stairwell"], n: 1, len: 2 } });
const storeysOf = (C, bonus = 0) => clampN(pick(C.rng, C.S.storeys) + bonus, C.S.storeys[0], C.maxS);
const BIG = (front, back) => corridorPlan(front, back, HOTEL.FRONT.big, 2);
const INN = (front, back) => corridorPlan(front, back, HOTEL.FRONT.inn, 1);
// An inn with its ground floor (front, back: its bands) and guest floors above (o: guestFloor's; top: the top floor's).
function innPlan(C, n, front, back, extra = {}, o = {}, top = null) {
  return {
    ...innOf(C, n), program: INN(front, back),
    upper: (f) => guestFloor("inn", f, C.bw, C.bh, C.fl, f === n - 1 && top ? { ...o, ...top } : o),
    exits: [{ side: "back", roles: ["kitchen", "apt", "corridor"], chance: 0.8, lock: 0.4, name: "Back door" }, { side: "left", roles: ["corridor"], chance: 0.4, lock: 0.5 }],
    ...extra,
  };
}
// A business hotel's guest floor (the top's rooms wider), or a tower's.
const bizGuest = (C, f, ctx, o = {}) => guestFloor(C.kind, f, C.bw, C.bh, C.fl, ctx && ctx.top ? { wide: 2, ...o } : o);
// The business hotel's conference floor (#29's).
function conferenceFloor(C, wide = C.bw >= 50) {
  const { R } = C;
  return BIG([SW, ["*", R.conf("Conference room A")], ["*", R.conf("Conference room B")], [6, R.bizc], SW], [LIFT, [5, R.gym], ["*", wide ? R.ballroom : R.conf("Conference room C")], [5, R.laundry], [5, R.maint], HK()]);
}
// A resort's ground floor: a wing of guest rooms either side of the core, their housekeeping closet and ice nook at the
// wings' ends; ro: the wings' rooms (a cabin's).
function resortGround(C, core, back, ro) {
  const len = C.bw - 2, uw = HOTEL.UNIT.big;
  const fixed = 12 + core.reduce((a, [s]) => a + (typeof s === "number" ? s : 10), 0);
  const spare = len - fixed - (core.length + 3);
  const k = Math.max(0, Math.floor(spare / 2 / (uw + 1)));
  const wing = (n0) => Array.from({ length: k }, (_, i) => [uw, unit(uw, 0, n0 + i, ro ? "back" : "front", C.fl, ro)]);
  return BIG([SW, HK(), ...wing(1), ...core, ...wing(k + 1), ICE(), SW], back);
}
// A resort's first floor up: the back of house (boh) at the back, rooms at the front.
const resortBoh = (C, f, ctx, boh) => { const wide = ctx && ctx.top ? 2 : 0; return BIG(band(C.bw - 2, [SW, HK()], [ICE(), SW], HOTEL.UNIT.big + wide, f, "front", 1, C.fl).parts, band(C.bw - 2, [LIFT, ...boh], [], HOTEL.UNIT.big + wide, f, "back", 50, C.fl).parts); };
const BOH = (R) => [[5, R.laundry], [4, R.lockers], [4, R.manager], [5, R.maint]];
function resortPlan(C, n, core, back, o = {}) {
  return {
    ...bigOf(C), ground: "rural", storeys: n,
    program: resortGround(C, core, back, o.ro),
    upper: (f, r, ctx) => (f === 1 ? resortBoh(C, f, ctx, o.boh || BOH(C.R)) : guestFloor("resort", f, C.bw, C.bh, C.fl, { wide: ctx && ctx.top ? 2 : 0 })),
    exits: o.exits || [{ side: "back", roles: ["dining", "gym", "lockerroom", "corridor"], chance: 1, width: 2, lock: 0.2, name: "Doors to the pool deck" }, { side: "back", roles: ["kitchen", "pantry"], chance: 0.7, lock: 0.4 }, ...fire(0.3)],
    ...(o.extra || {}),
  };
}
// A tower's floors: the top's penthouse and rooftop bar, the back of house, the amenities (gym, spa, business centre).
const towerTop = (C, f, bar = "Rooftop bar") => BIG([SW, ["*", C.R.penthouse], ["*", C.R.bar(bar)], SW], band(C.bw - 2, [LIFT], [HK()], HOTEL.UNIT.big + 3, f, "back", 1, C.fl).parts);
const towerBoh = (C, front) => BIG([SW, ...(front || [["*", C.R.ballroom], ["*", C.R.conf()]]), SW], [LIFT, [5, C.R.laundry], [4, C.R.lockers], [5, C.R.manager], ["*", C.R.maint], HK()]);
const towerAmen = (C, f, front) => BIG([SW, ...(front || [["*", C.R.gym], ["*", C.R.spa], [6, C.R.bizc]]), SW], band(C.bw - 2, [LIFT], [HK()], HOTEL.UNIT.big, f, "back", 1, C.fl).parts);
function towerPlan(C, ground, floors, o = {}) {
  const n = storeysOf(C, C.o.storeyBonus || 0);
  return {
    ...bigOf(C), ground: "city", storeys: n,
    program: ground,
    upper: (f, r, ctx) => (ctx && ctx.top ? (o.top ? o.top(f) : towerTop(C, f)) : floors[f] ? floors[f](f, ctx) : o.guest ? o.guest(f, ctx) : guestFloor("tower", f, C.bw, C.bh, C.fl)),
    exits: o.exits || [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.25, name: "Garage ramp" }, { side: "back", roles: ["kitchen", "pantry"], chance: 0.6, lock: 0.4 }, ...fire(0.5)],
    ...(o.extra || {}),
  };
}
// Two bands joined by a piece in the middle (the twin towers' sky bridge): parts, rooms.
function twinBand(len, head, mid, tail, uw, f, side, n0, fl) {
  const half = Math.floor((len - mid[0] - 2) / 2);
  const a = band(half, head, [], uw, f, side, n0, fl), b = band(len - half - mid[0] - 2, [], tail, uw, f, side, n0 + a.rooms, fl);
  const fix = (parts) => parts.map(([s, x], i) => [i === parts.length - 1 && s === "*" ? "*" : s, x]);
  // The halves' own "*" sized out: the first half fixed to its width, the second the rest.
  const sized = (bd, w) => { const fixed = bd.parts.reduce((t, [s]) => t + (s === "*" ? 0 : s), 0) + bd.parts.length - 1; return bd.parts.map(([s, x]) => [s === "*" ? w - fixed : s, x]); };
  return { parts: [...sized(a, half), mid, ...fix(b.parts)], rooms: a.rooms + b.rooms };
}

/** The plans by variant id (data-hotels.js HOTEL_VARIANTS): C → the spec (its grounds: spec.grounds). @type {Record<string, (C: any) => any>} */
const PLANS = {
  // ---------- the inns ----------
  "inn-country"(C) { // #29's inn, as it was
    const { rng, bw, bh, fl, R } = C;
    const n = bw >= 25 && rng.chance(0.5) ? 2 : 3; // two storeys only when the floors hold 10 rooms between them
    const reception = R.lobbyOf("Reception", { hub: true });
    const parlour = R.parlour(), breakfast = R.breakfast(), flat = R.flat;
    const stair = [3, { role: "stairwell", lay: "stairwell" }];
    const laundryI = [3, { ...R.laundry, name: "Laundry" }], restroom = bw >= 23 ? [[2, { role: "restroom", lay: "restroom" }]] : [];
    const groundBack = n === 2 ? band(bw - 2, [stair, [4, { ...R.kitchen, fry: false }]], [HK()], HOTEL.UNIT.inn, 0, "back", 1, fl).parts
      : [stair, [4, { ...R.kitchen, fry: false }], laundryI, ["*", flat], ...restroom];
    const groundFront = n === 2 ? [["*", parlour], [5, reception], ["*", breakfast], [5, flat]] : [["*", parlour], [5, reception], ["*", breakfast]];
    return {
      bw, bh, front: { width: 1 }, extraDoors: 0, openDoors: 0.25, foot: "large", hotel: "inn", ground: "town", storeys: n, stairs: { roles: ["stairwell"], n: 1, len: 2 },
      program: corridorPlan(groundFront, groundBack, HOTEL.FRONT.inn, 1),
      upper: (f) => guestFloor("inn", f, bw, bh, fl, n === 2 ? { innTail: [laundryI, HK()] } : {}),
      exits: [{ side: "back", roles: ["kitchen", "apt", "corridor"], chance: 0.8, lock: 0.4, name: "Back door" }, { side: "left", roles: ["corridor"], chance: 0.4, lock: 0.5 }],
    };
  },
  "inn-bnb"(C) { // a turreted house: the parlour and the library either side of the reception, the breakfast room behind; big rooms
    const { R } = C;
    return innPlan(C, 3, [["*", R.parlour()], [5, R.lobbyOf("Reception", { hub: true })], ["*", R.library()]],
      [STAIR, [4, { ...R.kitchen, fry: false }], [3, R.laundry], ["*", R.breakfast()], [5, R.flat]],
      { exits: [{ side: "left", roles: ["living"], chance: 1, lock: 0.3, name: "Porch door" }, { side: "back", roles: ["kitchen", "apt"], chance: 0.8, lock: 0.4, name: "Back door" }] }, { uw: 4 });
  },
  "inn-coaching"(C) { // the tavern at the front with its own door, the carriage house and the ale cellar behind, the owners upstairs
    const { R } = C, n = storeysOf(C);
    return innPlan(C, n, [[5, R.lobbyOf("Reception", { hub: true })], ["*", R.bar("Tavern")], [5, R.breakfast("Snug")]],
      [STAIR, [5, R.kitchen], [3, R.cellar("Ale cellar")], [3, R.laundry], ["*", R.boathouse("Carriage house")]],
      { exits: [{ side: "front", roles: ["dining"], chance: 1, lock: 0.2, name: "Tavern door" }, { side: "back", roles: ["hgarage"], chance: 1, roller: true, width: 2, lock: 0.4, name: "Carriage doors" }, { side: "back", roles: ["kitchen"], chance: 0.6, lock: 0.4 }] },
      {}, { innTail: [[5, R.flat], HK()] });
  },
  "inn-chalet"(C) { // the great room and its fire, the boot room by the door, the ski store and the sauna behind
    const { R } = C;
    return innPlan(C, 3, [["*", R.greatroom()], [5, R.lobbyOf("Reception", { hub: true })], [5, R.bootroom()]],
      [STAIR, [4, { ...R.kitchen, fry: false }], [3, R.laundry], [5, R.beachstore("Ski store")], ["*", { ...R.spa, name: "Sauna" }]],
      { exits: [{ side: "right", roles: ["lockerroom", "corridor"], chance: 1, lock: 0.3, name: "Ski door" }, { side: "back", roles: ["kitchen"], chance: 0.7, lock: 0.4 }] });
  },
  "inn-lakeside"(C) { // the great room and the lodge's dining room on the lake side, the boathouse behind
    const { R } = C;
    return innPlan(C, 3, [["*", R.greatroom("Lodge room")], [5, R.lobbyOf("Reception", { hub: true })], ["*", R.restaurant("Lodge dining room")]],
      [STAIR, [4, R.kitchen], [3, R.laundry], ["*", R.boathouse()], [5, R.flat]],
      { exits: [{ side: "back", roles: ["hgarage"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Boathouse doors" }, { side: "back", roles: ["corridor", "kitchen"], chance: 0.9, lock: 0.3, name: "Door to the dock" }] });
  },
  "inn-mainstreet"(C) { // a shop on the street, the dining room, the saloon behind with its own door, the manager's office
    const { R } = C;
    return innPlan(C, 3, [[4, R.shop("Corner shop")], [5, R.lobbyOf("Lobby", { hub: true })], ["*", R.restaurant("Dining room")]],
      [STAIR, [4, R.kitchen], [3, R.laundry], ["*", R.bar("Saloon")], [4, R.manager]],
      { front: { width: 2 }, exits: [{ side: "right", roles: ["dining", "corridor"], chance: 1, lock: 0.2, name: "Saloon doors" }, { side: "back", roles: ["kitchen"], chance: 0.8, lock: 0.4 }] });
  },
  "inn-vineyard"(C) { // the tasting room at the front, the wine cellar and the barrel room behind
    const { R } = C;
    return innPlan(C, 3, [["*", R.tasting], [5, R.lobbyOf("Reception", { hub: true })], ["*", R.breakfast()]],
      [STAIR, [4, { ...R.kitchen, fry: false }], [3, R.laundry], ["*", R.cellar()], [5, R.barrels]],
      { exits: [{ side: "back", roles: ["storage"], chance: 1, roller: true, width: 2, lock: 0.5, name: "Cellar doors" }, { side: "left", roles: ["dining"], chance: 0.8, lock: 0.3, name: "Terrace door" }] });
  },
  "inn-boarding"(C) { // the boarders' day room and dining room, a big shared kitchen, small rooms
    const { R } = C;
    return innPlan(C, 3, [["*", R.dayroom("Day room")], [5, R.lobbyOf("Landlady's desk", { hub: true })], ["*", R.breakfast("Boarders' dining room")]],
      [STAIR, ["*", { ...R.kitchen, name: "Shared kitchen", fry: false }], [3, R.laundry], [3, R.washroom], [5, R.flat]],
      { exits: [{ side: "back", roles: ["kitchen", "corridor"], chance: 0.9, lock: 0.3, name: "Back door" }] });
  },
  "inn-fishing"(C) { // the tackle shop by the door, the great room, the bait cooler and the fish-cleaning room behind
    const { R } = C;
    return innPlan(C, 3, [[5, R.shop("Tackle shop")], [5, R.lobbyOf("Reception", { hub: true })], ["*", R.greatroom()]],
      [STAIR, [4, R.kitchen], [3, R.laundry], [3, { ...R.walkin, name: "Bait cooler" }], ["*", R.fishroom]],
      { exits: [{ side: "back", roles: ["workshop"], chance: 1, lock: 0.3, name: "Door to the dock" }, { side: "front", roles: ["sales"], chance: 0.7, lock: 0.3, name: "Shop door" }] });
  },
  "inn-hunting"(C) { // the trophy room, the gun room, the game larder
    const { R } = C;
    return innPlan(C, 3, [["*", R.greatroom("Trophy room")], [5, R.lobbyOf("Reception", { hub: true })], [4, R.gunroom]],
      [STAIR, [4, R.kitchen], [3, R.laundry], [3, { ...R.walkin, name: "Game larder" }], ["*", R.flat]],
      { exits: [{ side: "back", roles: ["kitchen", "pantry"], chance: 0.9, lock: 0.4, name: "Back door" }, { side: "left", roles: ["greatroom"], chance: 0.7, lock: 0.3, name: "Porch door" }] });
  },
  "inn-seaside"(C) { // the sunroom over the sea, the beach store, a side porch
    const { R } = C;
    return innPlan(C, 3, [["*", R.sunroom], [5, R.lobbyOf("Reception", { hub: true })], ["*", R.breakfast()]],
      [STAIR, [4, { ...R.kitchen, fry: false }], [3, R.laundry], ["*", R.beachstore("Beach store")], [5, R.flat]],
      { exits: [{ side: "right", roles: ["corridor", "dining"], chance: 1, lock: 0.3, name: "Side porch" }] });
  },
  "inn-hotspring"(C) { // the bathhouse at the front, the tea room, the changing room behind
    const { R } = C;
    return innPlan(C, 3, [[5, R.lobbyOf("Reception", { hub: true })], ["*", { ...R.spa, name: "Bathhouse" }], ["*", R.breakfast("Tea room")]],
      [STAIR, [4, { ...R.kitchen, fry: false }], [3, R.laundry], ["*", R.bootroom("Changing room")], [5, R.flat]],
      { exits: [{ side: "back", roles: ["lockerroom"], chance: 1, lock: 0.2, name: "Door to the springs" }, { side: "back", roles: ["kitchen", "apt"], chance: 0.6, lock: 0.4 }] });
  },

  // ---------- the business hotels ----------
  "biz-classic"(C) { // #29's business hotel, as it was
    const { rng, bw, bh, fl, S, maxS, R } = C;
    const n = clampN(pick(rng, S.storeys), S.storeys[0], maxS);
    const wide = bw >= 50;
    const front = [SW, [5, R.gift], ["*", R.lobbyOf("Lobby")], ...(wide ? [[6, R.bar("Lobby bar")]] : []), ["*", R.restaurant()], SW];
    const back = [LIFT, [4, R.luggage], [3, R.restrooms], [5, R.manager], [4, R.lockers], ["*", R.kitchen], [3, R.walkin], ...(bw >= 48 ? [[5, R.loading]] : [])];
    return {
      ...bigOf(C), ground: "lot", storeys: n,
      program: corridorPlan(front, back, HOTEL.FRONT.big, 2),
      upper: (f, r, ctx) => (f === 1 ? conferenceFloor(C, wide) : guestFloor("business", f, bw, bh, fl, ctx && ctx.top ? { wide: 2 } : {})),
      exits: [...(bw >= 48 ? [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Loading bay" }] : []), { side: "back", roles: ["kitchen", "pantry", "lockerroom"], chance: 0.7, lock: 0.4 }, ...fire(0.4)],
    };
  },
  "biz-airport"(C) { // the shuttle lobby, a 24-hour café with its own door, the crew lounge; guest floors from the first up
    const { R } = C, n = storeysOf(C);
    return {
      ...bigOf(C), ground: "lot", storeys: n,
      program: BIG([SW, ["*", R.lobbyOf("Shuttle lobby")], [7, R.cafe("24-hour café")], [5, R.gift], SW], [LIFT, [6, R.luggage], [3, R.restrooms], [5, R.dayroom("Crew lounge")], ["*", R.kitchen], [3, R.walkin], [5, R.laundry]]),
      upper: (f, r, ctx) => bizGuest(C, f, ctx),
      exits: [{ side: "front", roles: ["cafeteria"], chance: 1, lock: 0.2, name: "Café doors" }, { side: "back", roles: ["kitchen", "pantry"], chance: 0.7, lock: 0.4 }, ...fire(0.4)],
      grounds: { yard: true, cars: [10, 16] },
    };
  },
  "biz-conference"(C) { // the pre-function foyer and two ballrooms on the ground floor, two conference floors above
    const { R } = C, n = storeysOf(C);
    return {
      ...bigOf(C), ground: "lot", storeys: n,
      program: BIG([SW, ["*", R.lobbyOf("Lobby")], [9, R.foyer("Pre-function foyer")], ["*", { ...R.ballroom, name: "Grand ballroom" }], SW], [LIFT, [4, R.luggage], [3, R.restrooms], ["*", { ...R.ballroom, name: "Ballroom B" }], ["*", R.kitchen], [3, R.walkin], [5, R.loading]]),
      upper: (f, r, ctx) => (f === 1 ? conferenceFloor(C, false) : f === 2 && !(ctx && ctx.top) ? BIG([SW, ["*", R.lecture("Breakout room A")], ["*", R.lecture("Breakout room B")], ["*", R.restaurant()], SW], [LIFT, [5, R.manager], ["*", R.lecture("Breakout room C")], [5, R.lockers], HK()]) : bizGuest(C, f, ctx)),
      exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Loading bay" }, { side: "front", roles: ["foyer", "dining"], chance: 1, width: 2, lock: 0.2, name: "Ballroom doors" }, ...fire(0.4)],
    };
  },
  "biz-extended"(C) { // studios with kitchenettes, the pantry market, the guest laundry and the gym; no restaurant
    const { R } = C, n = storeysOf(C);
    const studio = { lay: "studio" };
    return {
      ...bigOf(C), ground: "lot", storeys: n,
      program: BIG([SW, [5, R.shop("Pantry market")], ["*", R.lobbyOf("Lobby")], ["*", R.breakfast("Breakfast room")], SW], [LIFT, [6, { ...R.laundry, name: "Guest laundry" }], [5, R.gym], ["*", { ...R.kitchen, fry: false }], [3, R.walkin], [4, R.manager]]),
      upper: (f, r, ctx) => bizGuest(C, f, null, { uw: 5, ro: studio }),
      exits: [{ side: "back", roles: ["kitchen", "gym"], chance: 0.8, lock: 0.4 }, ...fire(0.4)],
    };
  },
  "biz-allsuites"(C) { // an atrium in the lobby, every room a suite off a gallery round it
    const { R } = C, n = storeysOf(C);
    const gallery = { role: "hall", name: "Atrium gallery", lay: "atrium", hub: true };
    return {
      ...bigOf(C), ground: "lot", storeys: n,
      program: BIG([SW, ["*", R.lobbyOf("Lobby")], ["*", R.atrium()], [6, R.bar("Atrium bar")], SW], [LIFT, ["*", R.restaurant()], ["*", R.kitchen], [3, R.walkin], [5, R.laundry], [4, R.luggage]]),
      upper: (f, r, ctx) => bizGuest(C, f, null, { uw: HOTEL.SUITE, hall: gallery }),
      exits: [{ side: "back", roles: ["kitchen", "pantry"], chance: 0.7, lock: 0.4 }, ...fire(0.4, ["hall", "corridor"])],
    };
  },
  "biz-budget"(C) { // a small lobby, the breakfast nook and vending; the back of house behind, guest floors above
    const { R } = C, n = storeysOf(C);
    return {
      ...bigOf(C), ground: "lot", storeys: n, front: { width: 1 },
      program: BIG([SW, ["*", R.lobbyOf("Lobby")], [7, R.breakfast("Breakfast nook")], ICE(), SW], [LIFT, ["*", { ...R.kitchen, fry: false }], [3, R.walkin], [5, R.laundry], [5, R.maint], [4, R.office("Office")]]),
      upper: (f, r, ctx) => bizGuest(C, f, ctx),
      exits: fire(0.5),
      grounds: { yard: false, cars: [8, 14] },
    };
  },
  "biz-boutique"(C) { // a gallery and a bistro on the street, the lounge bar behind; a rooftop bar on the top floor
    const { R } = C, n = storeysOf(C);
    return {
      ...bigOf(C), ground: "city", storeys: n,
      program: BIG([SW, ["*", R.lobbyOf("Lobby", { fl: "hardwood" })], [7, R.gallery], ["*", R.restaurant("Bistro")], SW], [LIFT, [7, R.bar("Lounge bar")], [3, R.restrooms], ["*", R.kitchen], [3, R.walkin], [5, R.laundry]]),
      upper: (f, r, ctx) => (ctx && ctx.top ? BIG([SW, ["*", R.bar("Rooftop bar")], ["*", R.gym], SW], band(C.bw - 2, [LIFT], [HK()], HOTEL.UNIT.big + 3, f, "back", 1, C.fl).parts) : bizGuest(C, f, null, { uw: 5 })),
      exits: [{ side: "front", roles: ["dining"], chance: 1, lock: 0.2, name: "Bistro door" }, { side: "back", roles: ["kitchen", "pantry"], chance: 0.7, lock: 0.4 }, ...fire(0.4)],
      grounds: { yard: true, plaza: true, cars: [0, 3] },
    };
  },
  "biz-convention"(C) { // the registration lobby and the exhibit hall, the ballroom behind, its loading docks; meeting rooms above
    const { R } = C, n = storeysOf(C);
    return {
      ...bigOf(C), ground: "lot", storeys: n,
      program: BIG([SW, ["*", R.lobbyOf("Registration lobby")], ["*", R.exhibit], [6, R.cafe("Coffee bar")], SW], [LIFT, ["*", R.ballroom], ["*", R.kitchen], [3, R.walkin], [6, R.loading], [5, R.laundry]]),
      upper: (f, r, ctx) => (f === 1 ? BIG([SW, ["*", R.lecture("Meeting room A")], ["*", R.lecture("Meeting room B")], ["*", R.lecture("Meeting room C")], [6, R.bizc], SW], [LIFT, [5, R.manager], ["*", R.restaurant()], [5, R.lockers], [5, R.maint], HK()]) : bizGuest(C, f, ctx)),
      exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.2, name: "Loading dock" }, { side: "right", roles: ["warefloor", "cafeteria"], chance: 1, width: 2, lock: 0.3, name: "Exhibit hall doors" }, ...fire(0.4)],
      grounds: { yard: true, cars: [10, 16] },
    };
  },
  "biz-highway"(C) { // the waffle bar and the indoor pool by the lobby, the gym behind
    const { R } = C, n = storeysOf(C);
    return {
      ...bigOf(C), ground: "lot", storeys: n,
      program: BIG([SW, ["*", R.lobbyOf("Lobby")], [6, R.breakfast("Waffle bar")], ["*", R.pool()], SW], [LIFT, [5, R.gym], ["*", { ...R.kitchen, fry: false }], [3, R.walkin], [5, R.laundry], [4, R.maint], [4, R.luggage]]),
      upper: (f, r, ctx) => bizGuest(C, f, ctx),
      exits: [{ side: "right", roles: ["gym"], chance: 0.8, lock: 0.5, name: "Pool door" }, { side: "back", roles: ["kitchen", "pantry"], chance: 0.6, lock: 0.4 }, ...fire(0.4)],
      grounds: { yard: false, cars: [10, 16] },
    };
  },
  "biz-medical"(C) { // by the hospital: a pharmacy kiosk, the family lounge, a café, the shuttle office behind
    const { R } = C, n = storeysOf(C);
    return {
      ...bigOf(C), ground: "lot", storeys: n,
      program: BIG([SW, ["*", R.lobbyOf("Lobby")], [6, R.chemist()], [6, R.dayroom("Family lounge")], ["*", R.cafe("Café")], SW], [LIFT, [5, R.office("Shuttle office")], [3, R.restrooms], ["*", R.kitchen], [3, R.walkin], [5, R.laundry], [4, R.luggage]]),
      upper: (f, r, ctx) => bizGuest(C, f, ctx),
      exits: [{ side: "left", roles: ["corridor"], chance: 1, width: 2, lock: 0.2, name: "Shuttle doors" }, { side: "back", roles: ["kitchen", "pantry"], chance: 0.7, lock: 0.4 }],
    };
  },
  "biz-campus"(C) { // the campus store and the faculty club on the quad, the lecture room and the study room behind
    const { R } = C, n = storeysOf(C);
    return {
      ...bigOf(C), ground: "town", storeys: n,
      program: BIG([SW, [6, R.shop("Campus store")], ["*", R.lobbyOf("Lobby")], ["*", R.restaurant("Faculty club")], SW], [LIFT, ["*", R.lecture()], [3, R.restrooms], ["*", R.kitchen], [3, R.walkin], [5, R.laundry], [5, { ...R.bizc, name: "Study room" }]]),
      upper: (f, r, ctx) => bizGuest(C, f, ctx),
      exits: [{ side: "back", roles: ["corridor", "classroom"], chance: 1, lock: 0.3, name: "Quad door" }, { side: "back", roles: ["kitchen"], chance: 0.6, lock: 0.4 }, ...fire(0.5)],
      grounds: { yard: false, trees: 8, cars: [4, 8] },
    };
  },
  "biz-station"(C) { // the ticket office and the grand dining room, the baggage hall behind with its platform doors
    const { R } = C, n = storeysOf(C);
    return {
      ...bigOf(C), ground: "city", storeys: n,
      program: BIG([SW, [6, { ...R.office("Ticket office"), lay: "manager", lock: ["door", 0.4] }], ["*", R.lobbyOf("Lobby")], ["*", R.restaurant("Grand dining room")], SW], [LIFT, ["*", R.baggage], ["*", R.kitchen], [3, R.walkin], [5, R.laundry], [4, R.lockers]]),
      upper: (f, r, ctx) => (f === 1 ? BIG([SW, ["*", R.ballroom], [8, R.library("Writing room")], SW], [LIFT, [5, R.manager], ["*", R.conf()], [5, R.maint], HK()]) : bizGuest(C, f, ctx)),
      exits: [{ side: "back", roles: ["terminal"], chance: 1, width: 2, lock: 0.3, name: "Platform doors" }, ...fire(0.5)],
      grounds: { yard: false, plaza: true, cars: [2, 5] },
    };
  },

  // ---------- the resorts ----------
  "res-classic"(C) { // #29's resort, as it was
    const { rng, bw, bh, fl, S, maxS, R } = C;
    const n = clampN(pick(rng, S.storeys), S.storeys[0], maxS);
    const core = [[5, R.gift], ["*", R.lobbyOf("Grand lobby")], ["*", R.restaurant()], [6, R.bar("Lounge bar")]];
    const spare = bw - 2 - (5 + 6 + 3 + 3 + 3 + 3) - 2 * 10 - (core.length + 3); // the core's flexible rooms at least 10 each
    const k = Math.max(0, Math.floor(spare / 2 / (HOTEL.UNIT.big + 1)));
    const wing = (n0) => Array.from({ length: k }, (_, i) => [HOTEL.UNIT.big, unit(HOTEL.UNIT.big, 0, n0 + i, "front", fl)]);
    const front = [SW, HK(), ...wing(1), ...core, ...wing(k + 1), ICE(), SW];
    const back = [LIFT, ["*", R.ballroom], [7, R.spa], [6, R.gym], [3, R.restrooms], [4, R.luggage], ["*", R.kitchen], [3, R.walkin]];
    return {
      ...bigOf(C), ground: "rural", storeys: n,
      program: corridorPlan(front, back, HOTEL.FRONT.big, 2),
      upper: (f, r, ctx) => (f !== 1 ? guestFloor("resort", f, bw, bh, fl, { wide: ctx && ctx.top ? 2 : 0 }) : resortBoh(C, f, ctx, BOH(R))),
      exits: [{ side: "back", roles: ["dining", "gym", "lockerroom", "corridor"], chance: 1, width: 2, lock: 0.2, name: "Doors to the pool deck" }, { side: "back", roles: ["kitchen", "pantry"], chance: 0.7, lock: 0.4 }, ...fire(0.3)],
    };
  },
  "res-golf"(C) { // the pro shop and the clubhouse grill, the golfers' locker room and the cart barn behind
    const { R } = C;
    return resortPlan(C, storeysOf(C), [[5, R.shop("Pro shop")], ["*", R.lobbyOf("Clubhouse lobby")], ["*", R.bar("Clubhouse grill")]],
      [LIFT, ["*", R.bootroom("Golfers' locker room")], [8, R.cartbarn], [3, R.restrooms], ["*", R.restaurant()], ["*", R.kitchen], [3, R.walkin]],
      { exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Cart barn doors" }, { side: "back", roles: ["dining", "lockerroom", "corridor"], chance: 1, width: 2, lock: 0.2, name: "Doors to the first tee" }, ...fire(0.3)], extra: { grounds: { pools: 1, courts: false, trees: 22 } } });
  },
  "res-beach"(C) { // the beach shop and the cabana bar, the buffet and the towel hut behind; two pool decks
    const { R } = C;
    return resortPlan(C, storeysOf(C), [[5, R.shop("Beach shop")], ["*", R.lobbyOf("Open-air lobby")], ["*", R.restaurant()], [6, R.bar("Cabana bar")]],
      [LIFT, [7, R.spa], [6, R.gym], [3, R.restrooms], [6, R.beachstore("Towel hut")], ["*", R.kitchen], [3, R.walkin], ["*", R.buffet()]],
      { extra: { grounds: { pools: 2, courts: false, trees: 10 } } });
  },
  "res-casino"(C) { // the casino floor and the cashier's cage at the heart, the buffet and the showroom behind
    const { R } = C;
    return resortPlan(C, storeysOf(C), [["*", R.lobbyOf("Lobby")], ["*", R.casino], [6, R.cashier], [6, R.bar("Casino bar")]],
      [LIFT, ["*", R.buffet()], ["*", R.showroom], [3, R.restrooms], ["*", R.kitchen], [3, R.walkin], [4, R.luggage]],
      { exits: [{ side: "front", roles: ["hall"], chance: 1, width: 2, lock: 0.1, name: "Casino doors" }, { side: "back", roles: ["kitchen", "pantry"], chance: 0.8, lock: 0.4 }, ...fire(0.3)], extra: { grounds: { pools: 1, courts: false, trees: 6, cars: [12, 20] } } });
  },
  "res-spa"(C) { // a great spa with its treatment rooms and fitness studio, the juice bar by the lobby
    const { R } = C;
    return resortPlan(C, storeysOf(C), [[5, R.gift], ["*", R.lobbyOf("Lobby")], [6, R.bar("Juice bar")], ["*", R.restaurant()]],
      [LIFT, ["*", R.spa], [7, { ...R.spa, name: "Treatment rooms", role: "exam" }], [6, { ...R.gym, name: "Fitness studio" }], [3, R.restrooms], ["*", R.kitchen], [3, R.walkin]],
      { extra: { grounds: { pools: 1, courts: false, trees: 20 } } });
  },
  "res-mountain"(C) { // ski rental, the great room and the après-ski bar, the boot room and the ski store behind
    const { R } = C;
    return resortPlan(C, storeysOf(C), [[6, R.skishop()], ["*", R.lobbyOf("Lobby")], ["*", R.greatroom()], [6, R.bar("Après-ski bar")]],
      [LIFT, [6, R.bootroom()], ["*", R.restaurant()], [3, R.restrooms], [6, R.beachstore("Ski store")], ["*", R.kitchen], [3, R.walkin], [7, R.spa]],
      { exits: [{ side: "back", roles: ["lockerroom", "corridor"], chance: 1, width: 2, lock: 0.2, name: "Doors to the slopes" }, { side: "back", roles: ["kitchen", "pantry"], chance: 0.7, lock: 0.4 }, ...fire(0.3)], extra: { grounds: { pools: 1, courts: false, trees: 24 } } });
  },
  "res-waterpark"(C) { // an indoor waterpark behind the lobby, the arcade and the pizza café, a first-aid room
    const { R } = C;
    return resortPlan(C, storeysOf(C), [[5, R.gift], ["*", R.lobbyOf("Lobby")], [8, R.arcade()], ["*", R.cafe("Pizza café")]],
      [LIFT, ["*", R.pool("Indoor waterpark")], [5, R.chemist("First aid")], [3, R.restrooms], ["*", R.kitchen], [3, R.walkin], [4, R.luggage]],
      { exits: [{ side: "back", roles: ["gym", "corridor"], chance: 1, width: 2, lock: 0.2, name: "Doors to the slides" }, { side: "back", roles: ["kitchen", "pantry"], chance: 0.7, lock: 0.4 }, ...fire(0.3)], extra: { grounds: { pools: 1, courts: false, trees: 6, cars: [10, 16] } } });
  },
  "res-ranch"(C) { // the ranch house: the great room and the chuckwagon hall, the tack room and the stables behind; a corral
    const { R } = C;
    return resortPlan(C, 2, [["*", R.lobbyOf("Ranch office", { fl: "plank" })], ["*", R.greatroom()], ["*", R.buffet("Chuckwagon hall")]],
      [LIFT, ["*", R.kitchen], [3, R.walkin], [6, R.tack], ["*", R.stable], [3, R.restrooms]],
      { exits: [{ side: "back", roles: ["barnfloor"], chance: 1, roller: true, width: 2, lock: 0.2, name: "Stable doors" }, { side: "back", roles: ["kitchen", "corridor"], chance: 0.8, lock: 0.3 }, ...fire(0.3)], extra: { ground: "rural", grounds: { pools: 0, courts: false, corral: true, trees: 16 } } });
  },
  "res-cabins"(C) { // the main lodge with cabins along the front, each its own door outside; the boathouse behind
    const { R } = C;
    return resortPlan(C, 2, [["*", R.lobbyOf("Main lodge", { fl: "plank" })], ["*", R.greatroom()], [6, R.shop("Bait and tackle")]],
      [LIFT, ["*", R.restaurant("Lodge dining room")], [7, R.boathouse()], [3, R.restrooms], ["*", R.kitchen], [3, R.walkin], [4, R.luggage]],
      { ro: { prefix: "Cabin" }, exits: [{ side: "back", roles: ["hgarage"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Boathouse doors" }, { side: "back", roles: ["dining", "corridor"], chance: 1, lock: 0.2, name: "Door to the lake" }, ...fire(0.3)], extra: { unitDoors: "motelroom", grounds: { pools: 0, courts: false, trees: 20 } } });
  },
  "res-family"(C) { // the kids' club and the arcade, the buffet, the gym; a pool and courts
    const { R } = C;
    return resortPlan(C, storeysOf(C), [[5, R.gift], ["*", R.lobbyOf("Lobby")], [8, R.kidsclub], ["*", R.restaurant()]],
      [LIFT, [8, R.arcade("Games room")], [6, R.gym], [3, R.restrooms], ["*", R.kitchen], [3, R.walkin], ["*", R.buffet()]],
      { extra: { grounds: { pools: 1, courts: true, trees: 10 } } });
  },
  "res-wellness"(C) { // the meditation hall and the organic kitchen, the spa and the yoga studio behind
    const { R } = C;
    return resortPlan(C, storeysOf(C), [["*", R.lobbyOf("Lobby", { fl: "hardwood" })], [8, R.meditation], ["*", R.restaurant("Organic kitchen")]],
      [LIFT, ["*", R.spa], [7, R.yoga], [3, R.restrooms], [6, R.bar("Juice bar")], ["*", R.kitchen], [3, R.walkin]],
      { extra: { grounds: { pools: 1, courts: false, trees: 26 } } });
  },
  "res-wedding"(C) { // the wedding chapel by the lobby, the ballroom and the florist behind
    const { R } = C;
    return resortPlan(C, storeysOf(C), [[5, R.gift], ["*", R.lobbyOf("Lobby")], [9, R.chapel], ["*", R.restaurant()]],
      [LIFT, ["*", R.ballroom], [6, R.florist], [3, R.restrooms], ["*", R.kitchen], [3, R.walkin], [5, R.bar("Cocktail lounge")]],
      { exits: [{ side: "back", roles: ["dining", "corridor"], chance: 1, width: 2, lock: 0.2, name: "Doors to the garden" }, { side: "back", roles: ["kitchen", "pantry"], chance: 0.7, lock: 0.4 }, ...fire(0.3)], extra: { grounds: { pools: 1, courts: false, trees: 22 } } });
  },

  // ---------- the city towers ----------
  "tow-classic"(C) { // #29's tower, as it was
    const { R } = C;
    return towerPlan(C, BIG([SW, ["*", R.lobbyOf("Grand lobby", { lifts: true })], [5, R.gift], ["*", R.restaurant()], SW], [LIFT, [4, R.luggage], [3, R.restrooms], ["*", R.kitchen], [3, R.walkin], ["*", R.garage]]),
      { 1: () => towerBoh(C), 2: (f) => towerAmen(C, f) });
  },
  "tow-twin"(C) { // two towers over one podium: a sky bridge across the middle of every guest floor, a lift lobby in each
    const { R, bw, fl } = C, uw = HOTEL.UNIT.big;
    const sky = [5, { role: "hall", name: "Sky bridge", lay: "atrium", hub: true, label: true, fl: "tile" }];
    const lift2 = [4, { role: "hall", name: "East lift lobby", lay: "liftlobby", fl: "carpet" }];
    const guest = (f) => { const fr = twinBand(bw - 2, [SW, HK()], sky, [ICE(), SW], uw, f, "front", 1, fl); return BIG(fr.parts, twinBand(bw - 2, [LIFT], [5, { role: "hall", name: "Sky lounge", lay: "atrium", hub: true, label: true }], [HK(), lift2], uw, f, "back", fr.rooms + 1, fl).parts); };
    return towerPlan(C, BIG([SW, ["*", R.lobbyOf("Grand lobby", { lifts: true })], [5, R.gift], ["*", R.restaurant()], SW], [LIFT, [4, R.luggage], [3, R.restrooms], ["*", R.kitchen], [3, R.walkin], ["*", R.garage], lift2]),
      { 1: () => towerBoh(C), 2: (f) => towerAmen(C, f) }, { guest });
  },
  "tow-podium"(C) { // shops round the lobby and a food court on the ground floor, a podium of shops and the salon above it
    const { R } = C;
    return towerPlan(C, BIG([SW, [5, R.shop("Boutique")], [5, R.shop("Newsagent")], ["*", R.lobbyOf("Hotel lobby", { lifts: true })], [5, R.chemist("Pharmacy")], SW], [LIFT, ["*", R.buffet("Food court")], ["*", R.kitchen], [3, R.walkin], ["*", R.garage]]),
      { 1: () => towerBoh(C, [["*", R.restaurant()], [6, { ...R.barber, name: "Salon" }], ["*", R.ballroom]]), 2: (f) => towerAmen(C, f) },
      { exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.25, name: "Garage ramp" }, { side: "left", roles: ["sales", "corridor"], chance: 1, lock: 0.2, name: "Arcade entrance" }, ...fire(0.5)] });
  },
  "tow-atrium"(C) { // an atrium up the middle: every guest floor's rooms off a gallery round it
    const { R } = C;
    const gallery = { role: "hall", name: "Atrium gallery", lay: "atrium", hub: true };
    return towerPlan(C, BIG([SW, ["*", R.lobbyOf("Lobby", { lifts: true })], ["*", R.atrium()], SW], [LIFT, ["*", R.restaurant()], ["*", R.kitchen], [3, R.walkin], [4, R.luggage], ["*", R.garage]]),
      { 1: () => towerBoh(C), 2: (f) => towerAmen(C, f) }, { guest: (f) => guestFloor("tower", f, C.bw, C.bh, C.fl, { hall: gallery }), exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.25, name: "Garage ramp" }, ...fire(0.5, ["hall", "corridor"])] });
  },
  "tow-grand"(C) { // the marble lobby, the barber shop and the Palm Court, the writing room; the grand ballroom, Turkish baths and billiards above; no garage
    const { R } = C;
    return towerPlan(C, BIG([SW, ["*", R.lobbyOf("Marble lobby", { lifts: true, fl: "marble" })], [6, R.barber], ["*", R.restaurant("Palm Court")], SW], [LIFT, [8, R.library("Writing room")], [3, R.restrooms], ["*", R.kitchen], [3, R.walkin], [5, R.luggage]]),
      { 1: () => towerBoh(C, [["*", { ...R.ballroom, name: "Grand ballroom" }]]), 2: (f) => towerAmen(C, f, [["*", { ...R.spa, name: "Turkish baths" }], ["*", R.arcade("Billiard room")]]) },
      { exits: [{ side: "back", roles: ["kitchen", "pantry"], chance: 0.9, lock: 0.4, name: "Tradesmen's entrance" }, { side: "front", roles: ["dining"], chance: 1, lock: 0.2, name: "Palm Court doors" }, ...fire(0.5)], extra: { grounds: { yard: true, plaza: true, cars: [0, 0] } } });
  },
  "tow-core"(C) { // a round tower: the rooms round a central core (the stairs, the lifts), a ring of corridor
    const { R, bw, fl } = C, cwid = 7, wl = Math.floor((bw - 2 - cwid - 2) / 2), wr = bw - 2 - cwid - 2 - wl;
    const core = { split: "y", parts: [[HOTEL.FRONT.big, { role: "stairwell", lay: "stairwell" }], [2, { role: "corridor", name: "Ring corridor", lay: "hotelhall", fl: "carpet" }], ["*", { split: "y", parts: [["*", { role: "hall", name: "Lift lobby", lay: "liftlobby", fl: "carpet" }], [3, { role: "stairwell", lay: "stairwell" }]] }]] };
    const ring = (left, right) => ({ split: "x", parts: [[wl, left], [cwid, core], ["*", right]] });
    const guest = (f) => { const wide = 0, a = band(wl, [HK()], [], HOTEL.UNIT.big + wide, f, "front", 1, fl), b = band(wl, [], [], HOTEL.UNIT.big + wide, f, "back", a.rooms + 1, fl); const c = band(wr, [], [ICE()], HOTEL.UNIT.big + wide, f, "front", a.rooms + b.rooms + 1, fl), d = band(wr, [], [], HOTEL.UNIT.big + wide, f, "back", a.rooms + b.rooms + c.rooms + 1, fl); return ring(BIG(a.parts, b.parts), BIG(c.parts, d.parts)); };
    return towerPlan(C, ring(BIG([["*", R.lobbyOf("Round lobby")], [5, R.gift]], [[4, R.luggage], [3, R.restrooms], ["*", R.kitchen]]), BIG([["*", R.restaurant("Revolving restaurant")]], [[3, R.walkin], ["*", R.garage]])),
      { 1: () => ring(BIG([["*", R.ballroom]], [[5, R.laundry], ["*", R.lockers]]), BIG([["*", R.conf()]], [[5, R.manager], ["*", R.maint], HK()])), 2: () => ring(BIG([["*", R.gym]], [["*", R.bizc], HK()]), BIG([["*", R.spa]], [["*", { ...R.office("Sky lounge"), lay: "parlour", type: "house" }]])) },
      { guest, top: () => ring(BIG([["*", R.penthouse]], [["*", R.bar("Sky bar")], HK()]), BIG([["*", { ...R.penthouse, name: "Penthouse suite B" }]], [["*", R.bar("Observation lounge")]])) });
  },
  "tow-mixed"(C) { // hotel floors below, the residences above (flats with their own kitchens), a residents' lobby with its own door
    const { R } = C;
    const flat = { prefix: "Residence", role: "apt", type: "house", lay: "residence", maxBoxes: 3, boxTarget: 3 };
    return towerPlan(C, BIG([SW, ["*", R.lobbyOf("Hotel lobby", { lifts: true })], [6, R.foyer("Residents' lobby")], ["*", R.restaurant()], SW], [LIFT, [4, R.luggage], [3, R.restrooms], ["*", R.kitchen], [3, R.walkin], ["*", R.garage]]),
      { 1: () => towerBoh(C), 2: (f) => guestFloor("tower", f, C.bw, C.bh, C.fl) },
      { guest: (f) => guestFloor("tower", f, C.bw, C.bh, C.fl, { uw: 7, ro: flat }), exits: [{ side: "front", roles: ["foyer"], chance: 1, lock: 0.3, name: "Residents' entrance" }, { side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.25, name: "Garage ramp" }, ...fire(0.5)] });
  },
  "tow-capsule"(C) { // the capsule lounge and luggage lockers below, a floor of capsule pods, small rooms above
    const { R } = C;
    const podFloor = (f) => BIG([SW, HK(), ["*", R.pods], [4, R.washroom], ["*", { ...R.pods, name: "Capsule pods B" }], ICE(), SW], band(C.bw - 2, [LIFT], [[5, { ...R.spa, name: "Bathhouse" }]], 3, f, "back", 1, C.fl).parts);
    return towerPlan(C, BIG([SW, ["*", R.lobbyOf("Lobby", { lifts: true })], [7, R.dayroom("Capsule lounge")], ["*", R.cafe("Noodle bar")], SW], [LIFT, [6, { ...R.lockers, name: "Luggage lockers", type: "luggage" }], [3, R.restrooms], ["*", R.kitchen], [3, R.walkin], [5, R.laundry], [4, R.manager]]),
      { 1: podFloor, 2: (f) => towerAmen(C, f, [["*", R.gym], ["*", R.arcade("Game lounge")]]) },
      { guest: (f) => guestFloor("tower", f, C.bw, C.bh, C.fl, { uw: 3 }), exits: [{ side: "back", roles: ["kitchen", "pantry"], chance: 0.8, lock: 0.4 }, ...fire(0.5)], extra: { grounds: { yard: true, plaza: true, cars: [0, 0] } } });
  },
  "tow-casino"(C) { // the casino floor through the ground floor, the cashier's cage and the buffet, the showroom above
    const { R } = C;
    return towerPlan(C, BIG([SW, ["*", R.lobbyOf("Lobby", { lifts: true })], ["*", R.casino], SW], [LIFT, [6, R.cashier], ["*", R.buffet()], ["*", R.kitchen], [3, R.walkin], ["*", R.garage]]),
      { 1: () => towerBoh(C, [["*", R.showroom], ["*", R.bar("Lounge")]]), 2: (f) => towerAmen(C, f) },
      { exits: [{ side: "front", roles: ["hall"], chance: 1, width: 2, lock: 0.1, name: "Casino doors" }, { side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.25, name: "Garage ramp" }, ...fire(0.5)] });
  },
  "tow-convention"(C) { // the exhibit hall by the lobby, two ballrooms above, a floor of meeting rooms
    const { R } = C;
    return towerPlan(C, BIG([SW, ["*", R.lobbyOf("Lobby", { lifts: true })], ["*", R.exhibit], SW], [LIFT, [4, R.luggage], ["*", R.kitchen], [3, R.walkin], [6, R.loading], ["*", R.garage]]),
      { 1: () => towerBoh(C, [["*", { ...R.ballroom, name: "Ballroom A" }], ["*", { ...R.ballroom, name: "Ballroom B" }]]), 2: (f) => towerAmen(C, f, [["*", R.lecture("Meeting room A")], ["*", R.lecture("Meeting room B")], [6, R.bizc], [5, R.gym]]) },
      { exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.25, name: "Garage ramp" }, { side: "right", roles: ["warefloor", "corridor"], chance: 1, width: 2, lock: 0.3, name: "Exhibit hall doors" }, ...fire(0.5)] });
  },
  "tow-deco"(C) { // a narrow tower: the gallery and the cocktail bar on the street, the supper club behind; no garage
    const { R } = C;
    return towerPlan(C, BIG([SW, ["*", R.lobbyOf("Lobby", { lifts: true, fl: "hardwood" })], [7, R.gallery], ["*", R.bar("Cocktail bar")], SW], [LIFT, ["*", R.restaurant("Supper club")], ["*", R.kitchen], [3, R.walkin], [4, R.luggage]]),
      { 1: () => towerBoh(C, [["*", R.ballroom]]), 2: (f) => towerAmen(C, f, [["*", R.spa], ["*", R.library("Reading room")]]) },
      { guest: (f) => guestFloor("tower", f, C.bw, C.bh, C.fl, { uw: 5 }), exits: [{ side: "front", roles: ["dining"], chance: 1, lock: 0.2, name: "Bar door" }, { side: "back", roles: ["kitchen", "pantry"], chance: 0.8, lock: 0.4 }, ...fire(0.5)], extra: { grounds: { yard: true, plaza: true, cars: [0, 0] } } });
  },
  "tow-skylobby"(C) { // the street-level entrance hall and the garage, the sky lobby on the first floor up with the restaurant and the kitchen
    const { R } = C;
    return towerPlan(C, BIG([SW, [6, R.lobbyOf("Street reception")], ["*", R.foyer("Entrance hall")], [5, R.gift], SW], [LIFT, ["*", R.garage], [4, R.luggage], [3, R.restrooms], [5, R.office("Security office")], [5, R.laundry]]),
      { 1: () => BIG([SW, ["*", { ...R.atrium("Sky lobby") }], ["*", R.restaurant("Sky restaurant")], SW], [LIFT, ["*", R.kitchen], [3, R.walkin], [5, R.manager], [4, R.lockers], HK()]), 2: (f) => towerAmen(C, f) });
  },
};

// ---------- the grounds (assemble's spec.yard) ----------
// Y: { rng, W, H, b: { x0, y0, x1, y1 } (the walls), front (the front door: x, y, ox, oy, cells), exits, cell(x, y),
// outside(x, y) (the ground round the building), free(x, y) (outside, clear, off the zones and the paths), block(x, y,
// k), car(x, y, kind, test), area(a) (an outdoor area: name, x0, y0, w, h) }.
function dressGrounds(Y, kind, G = KIND_GROUNDS[kind]) {
  const { rng, W, H, b } = Y;
  const paint = (x, y, f, extra = {}) => { if (Y.outside(x, y)) Object.assign(Y.cell(x, y), { f }, extra); };
  // The drive: from the road at the front edge up to the front door, 3 wide.
  const fx = Y.front.x;
  for (let y = b.y1 + 1; y < H; y++) for (let x = fx - 1; x <= fx + 1; x++) paint(x, y, "road");
  // The car park beside the drive (road, cars in rows), on the side with more room.
  const [cmin, cmax] = G.cars || HOTEL.CARS[kind];
  if (cmax > 0 && H - b.y1 - 2 >= 6) {
    const left = fx - b.x0 > b.x1 - fx;
    const x0 = left ? Math.max(1, b.x0 - 2) : fx + 3, x1 = left ? fx - 3 : Math.min(W - 2, b.x1 + 2), y0 = b.y1 + 3, y1 = H - 4;
    if (x1 - x0 >= 5 && y1 - y0 >= 3) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) paint(x, y, "road");
      let cars = 0;
      const want = rng.int(cmin, cmax);
      for (let t = 0; t < want * 10 && cars < want; t++) if (Y.car(rng.int(x0, x1), rng.int(y0, y1), rng.chance(0.15) ? "truck" : "car", (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) cars++;
      Y.area({ name: "Car park", x0: x0 - 1, y0: y0 - 1, w: x1 - x0 + 3, h: y1 - y0 + 3 });
    }
  }
  if (G.yard) { // the service yard behind: a truck, crates, bins
    for (let t = 0; t < 30; t++) { const x = rng.int(b.x0, b.x1), y = rng.int(1, Math.max(1, b.y0 - 2)); if (Y.free(x, y) && Y.car(x, y, "truck")) break; }
    for (let i = 0, t = 0; i < 4 && t < 60; t++) { const x = rng.int(b.x0, b.x1), y = rng.int(1, Math.max(1, b.y0 - 2)); if (Y.free(x, y) && Y.block(x, y, "crate")) i++; }
  }
  if (G.plaza) { // a plaza at the front: paving and planters
    for (let y = b.y1 + 2; y <= Math.min(H - 1, b.y1 + 4); y++) for (let x = b.x0; x <= b.x1; x++) if (Math.abs(x - fx) > 1) paint(x, y, "paving");
    for (let x = b.x0 + 2; x <= b.x1 - 2; x += 5) if (Math.abs(x - fx) > 2 && Y.free(x, b.y1 + 3)) Y.block(x, b.y1 + 3, "plant");
  }
  if (G.pools === 1) poolDeck(Y);
  else if (G.pools >= 2) { const q = Math.round((b.x1 - b.x0) / 4); poolDeck(Y, -q); poolDeck(Y, q); } // a pool deck behind each wing
  if (G.courts) courts(Y);
  if (G.corral) corral(Y);
  if (G.trees) gardens(Y, G.trees);
}
// A dude ranch's corral behind the stables: a ring of fence with a gate, a trough (a barrel), hay.
function corral(Y) {
  const { rng, b } = Y;
  const w = Math.min(24, b.x1 - b.x0 - 4), h = 12, x0 = b.x0 + 2 + rng.int(0, Math.max(0, b.x1 - b.x0 - 4 - w)), y1 = b.y0 - 3, y0 = y1 - h + 1, x1 = x0 + w - 1;
  if (y0 < 2 || x0 < 2 || x1 > Y.W - 3) return;
  const gate = x0 + (w >> 1);
  for (let x = x0 - 1; x <= x1 + 1; x++) { Y.block(x, y0 - 1, "fence"); if (Math.abs(x - gate) > 1) Y.block(x, y1 + 1, "fence"); }
  for (let y = y0; y <= y1; y++) { Y.block(x0 - 1, y, "fence"); Y.block(x1 + 1, y, "fence"); }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (Y.outside(x, y)) Object.assign(Y.cell(x, y), { f: "dirt" });
  Y.block(x0 + 1, y0 + 1, "barrel"); Y.block(x1 - 1, y0 + 1, "hay");
  Y.area({ name: "Corral", x0: x0 - 1, y0: y0 - 1, w: w + 2, h: h + 2 });
}
// The resort's pool deck behind the building: paving round an empty pool (its deep end), loungers, a fence with a gate.
function poolDeck(Y, dx = 0) {
  const { rng, b } = Y, [pw, ph] = HOTEL.POOL;
  const dw = pw + 6, dh = ph + 6;
  const cx = Math.round((b.x0 + b.x1) / 2) + dx + rng.int(-6, 6), y1 = b.y0 - 3, y0 = y1 - dh + 1, x0 = cx - (dw >> 1), x1 = x0 + dw - 1;
  if (y0 < 2 || x0 < 2 || x1 > Y.W - 3) return;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (Y.outside(x, y)) Object.assign(Y.cell(x, y), { f: "paving" });
  const px0 = x0 + 3, py0 = y0 + 3;
  for (let y = py0; y < py0 + ph; y++) for (let x = px0; x < px0 + pw; x++) if (Y.outside(x, y)) Object.assign(Y.cell(x, y), { f: "pool", ...(x >= px0 + pw - 4 ? { deep: true } : {}) });
  // The fence round the deck, a gate toward the building; loungers along the pool's long sides.
  const gate = cx;
  for (let x = x0 - 1; x <= x1 + 1; x++) { Y.block(x, y0 - 1, "fence"); if (Math.abs(x - gate) > 1) Y.block(x, y1 + 1, "fence"); }
  for (let y = y0; y <= y1; y++) { Y.block(x0 - 1, y, "fence"); Y.block(x1 + 1, y, "fence"); }
  for (const y of [y0 + 1, y1 - 1]) for (let x = px0; x < px0 + pw; x += 2) if (rng.chance(0.75)) Y.block(x, y, "lounger");
  Y.area({ name: "Pool deck", x0: x0 - 1, y0: y0 - 1, w: dw + 2, h: dh + 2 });
}
// Tennis courts beside the pool deck: green with white lines, a wire fence with a gate, the net across the middle.
function courts(Y) {
  const { rng, b } = Y, [cw, ch] = HOTEL.COURT;
  const n = rng.int(1, 2);
  let x = b.x0 + 1;
  for (let i = 0; i < n; i++, x += cw + 3) {
    const x0 = rng.chance(0.5) ? x : b.x1 - (i + 1) * (cw + 3) + 2, x1 = x0 + cw - 1, y1 = b.y0 - 3, y0 = y1 - ch + 1;
    if (y0 < 2 || x0 < 2 || x1 > Y.W - 3) continue;
    let clash = false;
    for (let y = y0 - 1; y <= y1 + 1 && !clash; y++) for (let xx = x0 - 1; xx <= x1 + 1; xx++) { const c = Y.cell(xx, y); if (!Y.outside(xx, y) || c.f === "paving" || c.f === "pool" || c.f === "court" || c.k !== "open") { clash = true; break; } }
    if (clash) continue;
    for (let y = y0; y <= y1; y++) for (let xx = x0; xx <= x1; xx++) {
      const line = (y === y0 ? 1 : 0) | (y === y1 ? 2 : 0) | (xx === x0 ? 4 : 0) | (xx === x1 ? 8 : 0) | (y === ((y0 + y1) >> 1) ? 2 : 0);
      Object.assign(Y.cell(xx, y), { f: "court", ...(line ? { line } : {}) });
    }
    const gx = x0 + (cw >> 1);
    for (let xx = x0 - 1; xx <= x1 + 1; xx++) { Y.block(xx, y0 - 1, "wirefence"); if (Math.abs(xx - gx) > 0) Y.block(xx, y1 + 1, "wirefence"); }
    for (let y = y0; y <= y1; y++) { Y.block(x0 - 1, y, "wirefence"); Y.block(x1 + 1, y, "wirefence"); }
    const ny = (y0 + y1) >> 1;
    for (let xx = x0; xx <= x1; xx++) if (xx !== x0 && xx !== x1) Y.block(xx, ny, "tennisnet"); // the ends of the net left open: the court is not cut in two
    Y.area({ name: "Tennis court", x0: x0 - 1, y0: y0 - 1, w: cw + 2, h: ch + 2 });
  }
}
// Gardens on the ground left: trees, bushes, a gravel path or two.
function gardens(Y, trees) {
  const { rng, W, H } = Y;
  let placed = 0;
  for (let t = 0; t < trees * 12 && placed < trees; t++) { const x = rng.int(1, W - 2), y = rng.int(1, H - 2); if (Y.free(x, y) && Y.cell(x, y).f === "grass" && Y.block(x, y, "tree")) placed++; }
  let bushes = 0;
  for (let t = 0; t < trees * 20 && bushes < trees * 2; t++) { const x = rng.int(1, W - 2), y = rng.int(1, H - 2); if (Y.free(x, y) && Y.cell(x, y).f === "grass" && Y.block(x, y, "bush")) bushes++; }
}

// ---------- the rooms (shoplayout.js COMMERCIAL_STYLES, by the leaf's lay) ----------
/** @typedef {ReturnType<typeof import("./roomlayout.js").roomLayout>} Lay */
/** @param {Lay} L */
const full = (L) => L.boxes() >= L.target();
/** @param {Lay} L */
const P = (L, o = {}) => ({ ...o, plain: full(L) });
/** @param {Lay} L */
function fill(L, kinds) {
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.wall(kinds[i % kinds.length], { prefer: "corner" })) miss = 0; else miss++; }
}
/** @param {Lay} L */
function some(L, k, n, opts = {}) { let m = 0; for (let i = 0; i < n; i++) { if (!L.wall(k, P(L, opts))) break; m++; } return m; }
/** A fixed piece that is its own locked container (the front desk's safe). @param {Lay} L */
function lockedSafe(L, opts = {}) {
  const r = L.wall("safe", { prefer: "corner", ...opts });
  if (!r) return null;
  const [x, y] = r.cells[0];
  L.c.unblock(x, y);
  const box = L.c.container(x, y, "safe", L.lane);
  if (box) box.lockKind = "safe"; else L.c.block(x, y, "safe");
  L.c.cell(x, y).fc = r.face;
  return box;
}
/** Tables with chairs round them. @param {Lay} L */
function tables(L, n, chairs = 2, k = "table") { let m = 0; for (let i = 0; i < n; i++) { const t = L.centre(k); if (!t) break; L.around(t, "chair", chairs); m++; } return m; }

/** @type {Record<string, (L: Lay) => void>} */
export const HOTEL_STYLES = {
  // A guest room: a bed or two (a double in a wide room), a nightstand by it, the TV stand facing it, a desk and its
  // chair, the wardrobe, the minibar, a suitcase left behind now and then.
  guestroom(L) {
    const c = L.c, twin = c.w >= 4 && L.variant(100, "twin") < HOTEL.TWIN * 100;
    const bed = (c.w >= 4 && c.h >= 4 && !twin ? L.wall("bed", { size: [2, 2], prefer: "middle", sides: ["n", "s"] }) : null) || L.wall("bed", { prefer: "middle", sides: ["n", "s", "w", "e"] }) || L.need("bed", { size: [1, 2] });
    if (twin && bed) L.beside(bed, "bed") || L.wall("bed", { far: bed.cells[0] });
    L.wall("minifridge", P(L, { prefer: "corner" }));
    L.wall("wardrobe", P(L, { prefer: "corner" })) || L.wall("dresser", P(L));
    if (bed) L.beside(bed, "nightstand", P(L));
    if (bed) L.facing(bed, "tvstand", P(L)) || L.wall("tvstand", P(L)); else L.wall("tvstand", P(L));
    const d = L.wall("desk", P(L, { prefer: "corner" }));
    if (d) L.around(d, "chair", 1);
    if (L.variant(100, "case") < HOTEL.SUITCASE * 100) L.wall("suitcase", P(L)) || L.centre("suitcase", P(L));
    fill(L, ["nightstand", "dresser"]);
  },
  // A suite's sitting room: a sofa facing the TV, armchairs, a coffee table, the minibar.
  suite(L) {
    const tv = L.wall("tvstand", P(L, { prefer: "middle" }));
    const sofa = tv ? L.facing(tv, "sofa") : L.wall("sofa");
    L.wall("armchair") ; L.wall("loungechair");
    if (L.c.w * L.c.h >= 16) L.centre("table");
    L.wall("minifridge", P(L, { prefer: "corner" }));
    if (!sofa) L.wall("sofa");
    fill(L, ["dresser", "minifridge"]);
  },
  // The penthouse: one great room (its bath open to it: a tub, a toilet and a sink behind a partition), a 2 × 2 bed, a
  // sofa and armchairs, a dining table, a bar counter, the minibar and the safe.
  penthouse(L) {
    const bed = L.wall("bed", { size: [2, 2], prefer: "corner", sides: ["n"] }) || L.wall("bed", { size: [2, 2] }) || L.need("bed", { size: [1, 2] });
    if (bed) L.beside(bed, "nightstand", P(L));
    L.wall("bathtub", { prefer: "corner", far: bed ? bed.cells[0] : undefined });
    L.wall("toilet", { prefer: "corner" }); L.wall("sink");
    lockedSafe(L);
    const tv = L.wall("tvstand", P(L, { prefer: "middle" }));
    if (tv) L.facing(tv, "sofa"); else L.wall("sofa");
    L.wall("armchair"); L.wall("loungechair"); L.wall("piano");
    tables(L, 1, 4);
    L.wall("barcounter"); L.wall("minifridge", P(L)); L.wall("wardrobe", P(L));
    fill(L, ["wardrobe", "dresser", "minifridge"]);
  },
  // The en suite bathroom: a toilet, a sink, a tub or a shower (roomlayout.js's bath without its cabinet loot).
  ensuite(L) {
    L.need("toilet", { prefer: "corner" });
    L.wall("sink", { prefer: "middle" }) || L.need("sink");
    (L.variant(2, "tub") === 0 && L.c.w * L.c.h >= 6 ? L.wall("bathtub", { prefer: "corner" }) : null) || L.wall("shower", { prefer: "corner" });
  },
  // A guest floor's corridor: a luggage cart or a linen cart left by a wall now and then, a lounge chair.
  hotelhall(L) {
    if (L.variant(3, "cart") === 0) L.wall(L.variant(2, "kind") ? "linencart" : "luggagecart");
    if (L.c.w * L.c.h >= 40 && L.variant(2, "chair")) L.wall("loungechair");
  },
  // A stairwell: nothing but the run.
  stairwell() {},
  // Housekeeping: linen carts, shelves of toiletries and linen, a cabinet.
  housekeeping(L) { L.wall("linencart"); fill(L, ["shelf", "cabinet", "shelf"]); if (L.c.w * L.c.h >= 9) L.wall("linencart"); },
  // The ice and vending nook: the ice machine and the vending machine.
  icenook(L) { L.wall("icemachine", { prefer: "corner" }) || L.wall("icemachine"); L.wall("vending", P(L)); },
  // A lift lobby: the lift doors on its walls, a lounge chair or a plant.
  liftlobby(L) {
    const ws = L.walls();
    const side = ws.find((w) => w.side === "w") ? "w" : ws.find((w) => w.side === "n") ? "n" : ws[0] ? ws[0].side : "n";
    L.run(["liftdoor", "liftdoor"], [side]);
    if (!L.has("liftdoor")) L.wall("liftdoor");
    L.wall("loungechair");
  },
  // The lobby: the reception desk with the key rack behind it and the safe (cash, valuables), lounge chairs and a sofa,
  // the luggage cart, a plant; a tower's grand lobby its lift doors too.
  hotellobby(L) {
    const c = L.c;
    const desk = L.wall("frontdesk", P(L, { sides: ["n"], prefer: "middle" })) || L.wall("frontdesk", P(L));
    L.wall("keyrack", { sides: ["n"] }) || L.wall("keyrack");
    lockedSafe(L, { sides: ["n", "w", "e"] });
    if (L.room.lifts) { L.wall("liftdoor", { sides: ["w", "e"] }); L.wall("liftdoor", { sides: ["w", "e"] }); }
    const sofa = L.wall("sofa", { sides: ["w", "e"] });
    if (sofa) L.around(sofa, "loungechair", 2);
    L.wall("loungechair", { sides: ["s", "w", "e"] });
    if (c.w * c.h >= 30) { const t = L.centre("table"); if (t) L.around(t, "loungechair", 2); }
    L.wall("luggagecart", { prefer: "corner" });
    if (!desk) L.need("frontdesk");
    fill(L, ["cabinet"]);
  },
  // The hotel's restaurant: tables with their chairs, booths along a wall, a service counter.
  hotelrestaurant(L) {
    const c = L.c;
    L.run(["counter", "counter"], ["n"], { plain: () => full(L) });
    some(L, "booth", c.h >= 5 ? 2 : 0, { sides: ["w", "e"] });
    tables(L, Math.max(1, Math.floor((c.w * c.h) / 14)), 2);
    fill(L, ["counter", "shelf"]);
  },
  // A gift shop: the till, shelves, a display case, a clothes rack.
  giftshop(L) {
    L.wall("checkout", P(L, { sides: ["s", "w", "e"] }));
    L.wall("displaycase", P(L));
    L.centre("clothesrack", P(L));
    fill(L, ["shelf", "displaycase"]);
  },
  // The luggage room: suitcases on shelves and on the floor, a luggage cart.
  luggage(L) {
    L.wall("luggagecart", { prefer: "corner" });
    for (let i = 0; i < 6 && !full(L); i++) L.wall("suitcase", { prefer: "corner" }) || L.centre("suitcase");
    fill(L, ["shelf", "suitcase"]);
  },
  // The staff lockers: lockers, a bench (a table), a sink.
  stafflockers(L) { fill(L, ["locker", "locker"]); some(L, "locker", 2); L.centre("table"); },
  // The laundry: big washers and dryers along a wall, linen carts, shelves of linen.
  hotellaundry(L) {
    const ws = L.walls();
    L.run(["washer", "dryer", "washer", "dryer", "washer", "dryer"], ws.length ? [ws[0].side] : ["n"]);
    L.wall("linencart"); L.wall("linencart");
    fill(L, ["shelf", "cabinet"]);
  },
  // The business centre: desks with their chairs, the copier, filing.
  bizcentre(L) {
    L.wall("copier", { prefer: "corner" });
    for (let i = 0; i < 3; i++) { const d = L.wall("desk", P(L)); if (!d) break; L.around(d, "chair", 1); }
    fill(L, ["filing", "cabinet"]);
  },
  // A conference room: a long table down the middle, chairs round it, a whiteboard, a cabinet.
  conference(L) {
    const c = L.c, horiz = c.w >= c.h, n = Math.max(2, Math.min(6, Math.max(c.w, c.h) - 4));
    const [mx, my] = [Math.floor((c.x0 + c.x1) / 2), Math.floor((c.y0 + c.y1) / 2)], cells = [];
    for (let i = 0; i < n; i++) { const x = horiz ? mx - Math.floor(n / 2) + i : mx, y = horiz ? my : my - Math.floor(n / 2) + i; if (L.place("table", [[x, y]])) cells.push([x, y]); }
    if (cells.length) L.around({ k: "table", cells, face: null, side: null, box: null }, "chair", cells.length * 2);
    L.wall("whiteboard", { prefer: "middle" });
    fill(L, ["cabinet"]);
  },
  // The ballroom: round banquet tables with chairs round them, a stage at the back (its boards, a lectern and the piano),
  // a service counter.
  ballroom(L) {
    const c = L.c;
    for (let x = c.x0; x <= c.x1; x++) { const cl = L.c.cell(x, c.y0); if (L.c.free(x, c.y0) && cl) cl.fl = "hardwood"; } // the stage's boards
    L.wall("pulpit", { sides: ["n"], prefer: "middle" });
    L.wall("piano", { sides: ["n"], prefer: "corner" });
    const n = Math.max(2, Math.floor((c.w * c.h) / 12));
    for (let i = 0; i < n; i++) { const t = L.centre("banquet"); if (!t) break; L.around(t, "chair", 4); }
    L.wall("counter", P(L, { sides: ["w", "e"] }));
    fill(L, ["counter"]);
  },
  // The gym: weight benches, the storage cage, lockers, a water cooler.
  hotelgym(L) { some(L, "weightbench", 3); L.wall("watercooler", { prefer: "corner" }); fill(L, ["locker", "sportcage"]); },
  // The spa: massage tables (exam beds), lounge chairs, a shower, shelves of towels and oils.
  spa(L) { some(L, "exambed", 2); L.wall("shower", { prefer: "corner" }); some(L, "loungechair", 2); fill(L, ["shelf", "cabinet"]); },
  // The inn's parlour: a sofa facing the fireplace's TV stand, armchairs, a bookshelf.
  parlour(L) { HOME_STYLES.living(L); L.wall("piano"); },
  // The inn's breakfast room: tables with chairs, a sideboard (a counter) with the coffee.
  breakfast(L) { L.wall("counter", P(L, { sides: ["n"] })); tables(L, Math.max(1, Math.floor((L.c.w * L.c.h) / 10)), 2); fill(L, ["cabinet", "counter"]); },
  // The owners' flat: a kitchenette, a bed and its nightstand, a table, drawers.
  ownersflat(L) { COMMERCIAL_STYLES.mgrflat(L); },
  // A loading bay: pallet racks and crates, a pallet of stock by the door.
  loading(L) { some(L, "palletrack", 2, { prefer: "corner" }); fill(L, ["crate", "palletrack"]); },
  // The parking garage below a tower: cars in their bays, a few crates (deliveries), a pallet rack.
  parking(L) {
    const c = L.c, cars = Math.max(1, Math.floor((c.w * c.h) / 24));
    for (let i = 0; i < cars; i++) for (const [x, y] of c.innerSpots().slice(0, 10)) if (!L.lane(x, y) && c.car(x, y, c.rng.chance(0.2) ? "truck" : "car")) break;
    fill(L, ["crate", "palletrack"]);
  },
  // ---------- issue #38's rooms ----------
  // An extended-stay studio: the guest room's bed and wardrobe, a kitchenette (a stove, a fridge, a sink) along a wall.
  studio(L) {
    if (!L.run(["stove", "sink"], ["n", "s", "w", "e"]).placed.length) L.wall("stove");
    L.wall("fridge", P(L, { prefer: "corner" }));
    HOTEL_STYLES.guestroom(L);
  },
  // A flat in a mixed-use tower: a kitchenette, a bed, a sofa and its TV, a table.
  residence(L) {
    L.run(["stove", "sink", "fridge"], ["n", "s", "w", "e"]);
    const bed = L.wall("bed", { size: [2, 2], prefer: "corner" }) || L.need("bed", { size: [1, 2] });
    if (bed) L.beside(bed, "nightstand", P(L));
    const tv = L.wall("tvstand", P(L));
    if (tv) L.facing(tv, "sofa"); else L.wall("sofa");
    tables(L, 1, 2);
    L.wall("wardrobe", P(L, { prefer: "corner" }));
    fill(L, ["dresser", "cabinet"]);
  },
  // A lodge's great room: the fireplace's armchairs and sofa, a long table, a trophy or two on the walls (decor), a piano.
  lodgehall(L) {
    const sofa = L.wall("sofa", { prefer: "middle" });
    if (sofa) L.around(sofa, "armchair", 2);
    tables(L, L.c.w * L.c.h >= 30 ? 2 : 1, 4);
    L.wall("bookshelf", P(L)); L.wall("piano");
    fill(L, ["cabinet", "bookshelf"]);
  },
  // A library or a writing room: bookshelves along the walls, armchairs, a desk.
  library(L) {
    some(L, "bookshelf", 4, { prefer: "corner" });
    const d = L.wall("desk", P(L)); if (d) L.around(d, "chair", 1);
    L.wall("armchair"); L.wall("armchair"); L.wall("floorlamp");
    fill(L, ["bookshelf"]);
  },
  // A buffet or a food court: steam tables and a salad bar along a wall, tables with their chairs.
  buffet(L) {
    if (!L.run(["steamtable", "steamtable", "saladbar"], ["n"], { plain: () => full(L) }).placed.length) L.wall("steamtable", P(L));
    tables(L, Math.max(1, Math.floor((L.c.w * L.c.h) / 14)), 2);
    fill(L, ["counter", "cabinet"]);
  },
  // An atrium, a foyer, a gallery round a well of light: planters, lounge chairs round a low table.
  atrium(L) {
    some(L, "plant", 2, { prefer: "corner" });
    if (L.c.w * L.c.h >= 24) { const t = L.centre("table"); if (t) L.around(t, "loungechair", 2); }
    L.wall("loungechair");
    if (L.room.maxBoxes) fill(L, ["cabinet"]);
  },
  // A boot room (a changing room): lockers, benches, boot racks (racks).
  bootroom(L) { some(L, "locker", 3, { prefer: "corner" }); L.wall("rack", P(L)); L.centre("chair"); fill(L, ["locker", "rack"]); },
  // Ski rental: the counter, racks of skis, the boot wall (shelves), a clothes rack.
  skirental(L) { L.wall("counter", P(L, { sides: ["s", "w", "e"] })); some(L, "rack", 3); L.centre("clothesrack", P(L)); fill(L, ["shelf", "rack"]); },
  // A wine or ale cellar: wine racks along the walls, barrels.
  winecellar(L) { some(L, "winerack", 3, { prefer: "corner" }); some(L, "barrel", 2); fill(L, ["winerack", "barrel"]); },
  // A vineyard's tasting room: the bar counter with its stools, a wine rack, tables.
  tasting(L) {
    const bar = L.wall("barcounter", P(L, { sides: ["n"], prefer: "middle" }));
    if (bar) L.around(bar, "barstool", 2);
    L.wall("winerack", P(L));
    tables(L, Math.max(1, Math.floor((L.c.w * L.c.h) / 16)), 2);
    fill(L, ["winerack", "cabinet"]);
  },
  // A barrel room: barrels in rows, a rack.
  barrels(L) { for (let i = 0; i < 6; i++) if (!L.centre("barrel")) break; L.wall("rack", P(L)); fill(L, ["barrel", "shelf"]); },
  // A boathouse or a carriage house: crates, racks of gear, a workbench.
  boathouse(L) { L.wall("workbench", P(L, { prefer: "corner" })); some(L, "rack", 2); L.centre("crate"); fill(L, ["crate", "rack"]); },
  // A gun room: gun racks, the gun safe, a table for cleaning them.
  gunroom(L) { L.wall("gunrack", P(L, { prefer: "corner" })); L.wall("gunsafe", P(L)); L.centre("table"); fill(L, ["cabinet", "gunrack"]); },
  // The fish-cleaning room: a sink and a counter, a chest freezer.
  fishroom(L) { L.run(["sink", "counter"], ["n", "w", "e"]); L.wall("freezer", P(L, { prefer: "corner" })); fill(L, ["counter", "shelf"]); },
  // A sunroom: armchairs and a sofa by the windows, plants, a small table.
  sunroom(L) { L.wall("sofa"); L.wall("armchair"); L.wall("armchair"); some(L, "plant", 2); L.centre("table"); fill(L, ["cabinet"]); },
  // A beach store (a towel hut, a ski store): racks, shelves of towels, loungers stacked.
  beachstore(L) { some(L, "rack", 2, { prefer: "corner" }); L.wall("lounger"); fill(L, ["shelf", "rack"]); },
  // The casino floor: card tables with their chairs, rows of slot machines (vending machines), the bar counter.
  casino(L) {
    const c = L.c;
    some(L, "vending", Math.max(2, Math.floor(c.w / 3)), { sides: ["n", "w", "e"] });
    tables(L, Math.max(2, Math.floor((c.w * c.h) / 18)), 3, "clothtable");
    L.wall("barcounter", P(L));
    fill(L, ["cabinet"]);
  },
  // The cashier's cage: the tellers' counter, the safe (locked), cabinets.
  cashier(L) { L.wall("teller", { sides: ["s", "w", "e"] }) || L.wall("teller"); lockedSafe(L); fill(L, ["cabinet", "filing"]); },
  // A showroom: the stage, rows of chairs, a bar counter at the back.
  showroom(L) {
    L.wall("stage", { sides: ["n"], prefer: "middle" }) || L.wall("pulpit", { sides: ["n"] });
    tables(L, Math.max(2, Math.floor((L.c.w * L.c.h) / 16)), 3);
    L.wall("barcounter", P(L, { sides: ["s"] }));
    fill(L, ["counter"]);
  },
  // An arcade, a games or billiard room: a pool table, the jukebox, machines along the walls.
  arcade(L) { L.centre("pooltable"); L.wall("jukebox"); some(L, "vending", 2); L.wall("loungechair"); fill(L, ["cabinet"]); },
  // A kids' club: little desks, beanbags, shelves of toys.
  kidsclub(L) { for (let i = 0; i < 3; i++) if (!L.centre("schooldesk")) break; some(L, "beanbag", 2); fill(L, ["shelf", "cabinet"]); },
  // An indoor pool or a waterpark hall (its basin drained, a tiled floor): loungers round it, a water cooler.
  indoorpool(L) { some(L, "lounger", 4); L.wall("watercooler", { prefer: "corner" }); some(L, "loungechair", 2); fill(L, ["locker", "shelf"]); },
  // A pharmacy kiosk or a first-aid room: the counter, shelves, the medicine cabinet.
  chemist(L) { L.wall("checkout", P(L, { sides: ["s", "w", "e"] })); L.wall("medcab", P(L)); fill(L, ["shelf", "cabinet"]); },
  // An exhibit hall: display cases and stands in rows, banquet tables, the rope lines.
  exhibit(L) {
    for (let i = 0; i < 4; i++) if (!L.centre("displaycase", P(L))) break;
    for (let i = 0; i < 2; i++) { const t = L.centre("banquet"); if (!t) break; L.around(t, "chair", 2); }
    L.wall("stanchion");
    fill(L, ["displaycase", "crate"]);
  },
  // The golf carts' barn: tyre racks, a workbench, crates of balls.
  cartbarn(L) { L.wall("workbench", P(L, { prefer: "corner" })); L.wall("tirerack", P(L)); L.wall("toolchest", P(L)); fill(L, ["crate", "rack"]); },
  // A tack room: saddle racks, shelves of bridles and brushes.
  tackroom(L) { some(L, "saddlerack", 2, { prefer: "corner" }); fill(L, ["shelf", "saddlerack"]); },
  // The stables: hay, barrels of feed, saddle racks.
  stable(L) { for (let i = 0; i < 4; i++) if (!L.centre("hay")) break; L.wall("saddlerack", P(L)); some(L, "barrel", 2); fill(L, ["shelf", "barrel"]); },
  // A wedding chapel: the altar, pews, candles.
  chapel(L) { L.wall("altar", { sides: ["n"], prefer: "middle" }); for (let i = 0; i < 4; i++) if (!L.centre("pew")) break; L.wall("candles"); fill(L, ["cabinet"]); },
  // A florist: potting benches, plants, shelves.
  florist(L) { L.wall("pottingbench", P(L, { prefer: "corner" })); some(L, "plant", 3); L.wall("coldcase", P(L)); fill(L, ["shelf"]); },
  // A meditation hall: beanbags (cushions) in rows, candles, plants.
  meditation(L) { for (let i = 0; i < 4; i++) if (!L.centre("beanbag")) break; L.wall("candles"); some(L, "plant", 2); fill(L, ["cabinet"]); },
  // A yoga studio: mats (beanbags), a water cooler, shelves.
  yoga(L) { some(L, "beanbag", 3); L.wall("watercooler", { prefer: "corner" }); fill(L, ["shelf", "locker"]); },
  // Capsule pods: bunks along the walls, a locker for each.
  pods(L) { some(L, "bunk", Math.max(2, Math.floor(L.c.w / 2))); fill(L, ["locker", "locker"]); some(L, "locker", 2); },
  // A gallery: paintings on the walls, display cases, the rope line.
  gallery(L) { some(L, "painting", 3); L.centre("displaycase", P(L)); L.wall("stanchion"); fill(L, ["displaycase", "cabinet"]); },
  // A barber shop or a salon: chairs at the sinks, a counter.
  barber(L) { L.run(["sink", "sink"], ["n", "w", "e"]); some(L, "chair", 2); L.wall("counter", P(L)); fill(L, ["cabinet", "shelf"]); },
};
// The rooms take these through shoplayout.js (its styles by the leaf's lay; the hotel's key a commercial building's).
Object.assign(COMMERCIAL_STYLES, HOTEL_STYLES);
COMMERCIAL_KEYS.add("hotel");

// ---------- signs of survival ----------
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const isHotel = (ctx) => ctx.key === "hotel" && ctx.rooms.some((r) => !!r.shop);
const byShop = (ctx, shop) => ctx.rng.shuffle(ctx.rooms.filter((r) => r.shop === shop && !r.scene && !r.locked));
const nearest = (cells, x, y) => cells.slice().sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y));
const NOTES = ["\"Room 3 has water. Knock twice.\"", "\"Don't open the door for anyone who can't talk.\"", "\"We're on the roof. Bring what you can.\"", "\"Stairs blocked. Use the fire exit.\"", "\"Mom, we waited. Gone to the ballroom.\""];
// Guests barricaded on an upper floor: furniture shoved onto the stairwells' top landings, notes slipped under doors.
function barricadedFloor(ctx) {
  const { rng } = ctx;
  const runs = ctx.map.runs || [];
  const floors = [...new Set(ctx.rooms.filter((r) => (r.f || 0) >= 1 && r.shop === "guestroom").map((r) => r.f || 0))];
  for (const f of rng.shuffle(floors)) {
    let n = 0, /** @type {number[] | null} */ at = null;
    for (const run of runs) {
      if (run.single) continue;
      const land = [run.x + run.len * run.dx, run.y + run.len * run.dy];
      const spots = [land, ...NEXT4.map(([dx, dy]) => [land[0] + dx, land[1] + dy])].filter(([x, y]) => ctx.free(f, x, y)).slice(0, 2);
      const sw = ctx.rooms.find((r) => (r.f || 0) === f && land[0] > r.x0 && land[0] < r.x0 + r.w - 1 && land[1] > r.y0 && land[1] < r.y0 + r.h - 1);
      const kinds = scenePieces(sw || null, rng, spots.length, { half: true });
      spots.forEach(([x, y], i) => { ctx.piece(f, x, y, kinds[i] || "chair"); n++; at = at || [x, y]; });
    }
    if (!n || !at) continue;
    const rooms = rng.shuffle(ctx.rooms.filter((r) => (r.f || 0) === f && r.shop === "guestroom" && !r.locked)).slice(0, rng.int(2, 4));
    let notes = 0;
    for (const r of rooms) {
      const d = (r.doors || []).find(([dx, dy]) => NEXT4.some(([ox, oy]) => { const q = ctx.rooms.find((o) => o.shop === "hotelhall" && (o.f || 0) === f && dx + ox > o.x0 && dx + ox < o.x0 + o.w - 1 && dy + oy > o.y0 && dy + oy < o.y0 + o.h - 1); return !!q; }));
      if (!d) continue;
      const p = NEXT4.map(([ox, oy]) => [d[0] + ox, d[1] + oy]).find(([x, y]) => x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1 && ctx.free(f, x, y));
      if (!p) continue;
      ctx.pile(f, p[0], p[1], `A note slipped under the door: ${NOTES[(notes + rng.int(0, NOTES.length - 1)) % NOTES.length]}`, {}, r.id);
      notes++;
    }
    const r0 = ctx.rooms.find((r) => (r.f || 0) === f && r.shop === "hotelhall") || null;
    return ctx.done("hotelbarricade", r0, at[0], at[1], `The stairs onto ${f === 1 ? "the first floor up" : `floor ${f + 1}`} are blocked with furniture${notes ? `, and notes have been slipped under ${notes === 1 ? "a door" : `${notes} doors`}` : ""}: guests held this floor.`);
  }
  return null;
}
// The ballroom an evacuation centre: cots in rows, the Red Cross table (a table, a pile of bandages and a clipboard), the
// last of the water, people who never left.
function evacCentre(ctx) {
  const { rng } = ctx;
  for (const r of byShop(ctx, "ballroom")) {
    const f = r.f || 0;
    const free = ctx.freeIn(r).filter(([x, y]) => (x + y) % 2 === 0);
    if (free.length < 6) continue;
    const cots = rng.shuffle(free).slice(0, rng.int(6, 14));
    for (const [x, y] of cots) ctx.piece(f, x, y, "cot");
    const left = ctx.freeIn(r);
    if (!left.length) continue;
    const [tx, ty] = rng.pick(left);
    ctx.piece(f, tx, ty, "table");
    const by = nearest(ctx.freeIn(r), tx, ty)[0];
    if (by) ctx.pile(f, by[0], by[1], "The Red Cross table: bandages, a clipboard of names, an armband", { meds: rng.int(1, 3) }, r.id, rng.chance(0.4) ? ["bandagekit"] : []);
    const near = ctx.freeIn(r).filter(([x, y]) => cots.some(([cx, cy]) => Math.abs(cx - x) + Math.abs(cy - y) === 1));
    const n = Math.min(near.length, rng.int(1, 4));
    for (const [x, y] of rng.shuffle(near).slice(0, n)) ctx.body(f, x, y, { human: true, quiet: rng.chance(0.7) });
    return ctx.done("evaccentre", r, tx, ty, `The ballroom was an evacuation centre: cots in rows, a Red Cross table, and ${n === 1 ? "one who never left" : `${n} who never left`}.`);
  }
  return null;
}
// An overrun lobby: suitcases strewn, the dead on the floor, a survivor's body by the front desk, blood trailed to the doors.
function overrunLobby(ctx) {
  const { rng } = ctx;
  for (const r of byShop(ctx, "hotellobby")) {
    const f = r.f || 0;
    const free = ctx.freeIn(r);
    if (free.length < 8) continue;
    const cases = rng.shuffle(free).slice(0, rng.int(2, 4));
    for (const [x, y] of cases) ctx.piece(f, x, y, "suitcase");
    const dead = rng.int(4, 8);
    const spots = rng.shuffle(ctx.freeIn(r)).slice(0, dead);
    for (const [x, y] of spots) { ctx.body(f, x, y, {}); ctx.splatter(f, x, y, "zombie", 2); }
    const rest = ctx.freeIn(r);
    if (!rest.length) continue;
    const [bx, by] = rest[0];
    ctx.body(f, bx, by, { human: true });
    ctx.splatter(f, bx, by, "human", 3);
    const door = (r.doors || []).find(([x, y]) => ctx.exit(x, y, f)) || (r.doors || [])[0];
    if (door) ctx.trail(f, bx, by, door[0], door[1], "human");
    return ctx.done("lobbyoverrun", r, bx, by, `The lobby was overrun: suitcases strewn across it, ${spots.length} of the dead on the floor, and someone who held out by the desk.`);
  }
  return null;
}
// The penthouse held: its door barred from inside (a piece in the frame), a piece dragged against it; empty bottles and
// tins inside. floorfolk.js's survivors (or raiders) hold it first in the crawl (area.scene.alive).
function penthouseHoldout(ctx) {
  const { rng } = ctx;
  for (const r of byShop(ctx, "penthouse")) {
    const f = r.f || 0, d = (r.doors || [])[0];
    if (!d) continue;
    const inn = NEXT4.map(([ox, oy]) => [d[0] + ox, d[1] + oy]).find(([x, y]) => x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1);
    if (!inn) continue;
    const spots = ctx.freeIn(r).filter(([x, y]) => Math.abs(x - inn[0]) + Math.abs(y - inn[1]) === 1 || Math.abs(x - inn[0]) + Math.abs(y - inn[1]) === 2).slice(0, 2);
    const kinds = scenePieces(r, rng, spots.length || 1);
    spots.forEach(([x, y], i) => ctx.piece(f, x, y, kinds[i] || "sofa"));
    const p = ctx.freeIn(r)[0];
    if (p) ctx.pile(f, p[0], p[1], "Empty bottles from the minibar, tins, a hand-drawn map of the floors", { water: rng.chance(0.5) ? 1 : 0, food: rng.chance(0.4) ? 1 : 0 }, r.id);
    return ctx.done("penthouse", r, inn[0], inn[1], "The penthouse was held: furniture dragged against its door from inside, the minibar long empty.", { alive: true });
  }
  return null;
}
SCENES.ODDS.hotel = SCENES.ODDS.hotel ?? 0.7; // a hotel has signs of survival as often as a block of flats
registerScene("hotelbarricade", { w: 4, place: barricadedFloor, kinds: ["hotel"], when: isHotel });
registerScene("evaccentre", { w: 3, place: evacCentre, kinds: ["hotel"], when: isHotel });
registerScene("lobbyoverrun", { w: 3, place: overrunLobby, kinds: ["hotel"], when: isHotel });
registerScene("penthouse", { w: 6, place: penthouseHoldout, kinds: ["hotel"], when: isHotel }); // only a tower has a penthouse: the others' draws fall through to the next
