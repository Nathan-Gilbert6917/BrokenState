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

export const HOTEL = {
  KINDS: ["inn", "business", "resort", "tower"],
  ANY: { inn: 0.3, business: 0.35, resort: 0.15, tower: 0.2 }, // a hotel with no franchise (a sample plan): its kind
  // Footprints in cells (≈ 1 m: #24's CELL_M), [min, max]: w the width, d the depth, the storeys.
  SIZE: {
    inn: { w: [21, 25], d: [19, 19], storeys: [2, 3] },
    business: { w: [40, 60], d: [21, 23], storeys: [4, 6] },
    resort: { w: [64, 90], d: [21, 23], storeys: [2, 4] },
    tower: { w: [36, 44], d: [21, 23], storeys: [8, 10] },
  },
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
// suite (w ≥ HOTEL.SUITE: a sitting room by the bedroom). no: its number ("214"), fl: the franchise's floor.
function unit(w, f, n, side, fl) {
  const no = `${f + 1}${String(n).padStart(2, "0")}`, u = `h${f}-${n}`;
  const room = { role: "motelroom", name: `Room ${no}`, type: "hotelroom", lay: "guestroom", unit: u, maxBoxes: HOTEL.ROOM_BOXES, boxTarget: HOTEL.ROOM_BOXES, fl };
  const node = w >= HOTEL.SUITE
    ? { split: "x", parts: [["*", { role: "motelroom", name: `Suite ${no}`, type: "hotelroom", lay: "suite", unit: u, maxBoxes: 2, fl }], ["*", { ...room, name: `Suite ${no}: bedroom` }]] }
    : room;
  const bath = { role: "bath", name: `Bath ${no}`, type: null, lay: "ensuite", unit: u };
  return { split: "y", parts: side === "front" ? [[HOTEL.BATH, bath], ["*", node]] : [["*", node], [HOTEL.BATH, bath]] };
}
// A band len cells long: head and tail (fixed leaves) at its ends, guest rooms between, as many of uw as fit; the last
// takes what is left over (a suite when that makes it HOTEL.SUITE wide).
function band(len, head, tail, uw, f, side, n0, fl) {
  const fixed = [...head, ...tail].reduce((a, [s]) => a + s, 0), k = head.length + tail.length;
  const n = Math.max(0, Math.floor((len - fixed - k + 1) / (uw + 1)));
  if (!n) return { parts: [...head, ...tail], rooms: 0 };
  const rest = len - fixed - (k + n - 1) - n * uw;
  const units = [];
  for (let i = 0; i < n; i++) { const last = i === n - 1, w = last ? uw + rest : uw; units.push([last ? "*" : uw, unit(w, f, n0 + i, side, fl)]); }
  return { parts: [...head, ...units, ...tail], rooms: n };
}
// A guest floor: rooms on both sides of the corridor, the stairwells, housekeeping, the ice nook and the lift lobby.
function guestFloor(kind, f, bw, bh, fl, o = {}) {
  const inn = kind === "inn", uw = inn ? HOTEL.UNIT.inn : HOTEL.UNIT.big, fd = inn ? HOTEL.FRONT.inn : HOTEL.FRONT.big, cw = inn ? 1 : 2, len = bw - 2;
  const fr = band(len, inn ? [] : [SW, HK()], inn ? [ICE(2)] : [ICE(), SW], uw + (o.wide || 0), f, "front", 1, fl);
  const bk = band(len, inn ? [[3, { role: "stairwell", lay: "stairwell" }]] : [LIFT], inn ? o.innTail || [HK()] : [], uw + (o.wide || 0), f, "back", fr.rooms + 1, fl);
  return corridorPlan(fr.parts, bk.parts, fd, cw);
}
const pick = (rng, [a, b]) => rng.int(a, b);
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * A hotel's spec (buildingmaps.js assemble). o: { plan (the franchise's: planOf), maxStoreys, legacy, storeyBonus }.
 * @param {any} rng @param {any} [o]
 */
export function hotelSpec(rng, o = {}) {
  const plan = o.plan || {};
  const kind = HOTEL.KINDS.includes(plan.hotel) ? plan.hotel : pickKind(rng);
  const S = HOTEL.SIZE[kind], maxS = o.maxStoreys || 8;
  const bw = pick(rng, S.w), bh = pick(rng, S.d);
  const fl = plan.fl || "carpet", wallc = plan.look ? plan.look.wall : undefined;
  const lobbyOf = (name, extra = {}) => ({ role: "lobby", entry: true, name, type: "hotelfront", lay: "hotellobby", fl: kind === "inn" ? fl : "tile", maxBoxes: 2, ...(wallc ? { wallc } : {}), ...extra });
  const kitchen = { role: "kitchen", name: "Kitchen", lay: "galley", fry: true };
  const walkin = { role: "pantry", name: "Walk-in cold room", type: "kitchen", cold: true, dk: "steel", windows: false, fl: "steel", lay: "walkin", maxBoxes: 2 };
  const restaurant = (name = "Restaurant") => ({ role: "dining", name, type: "kitchen", lay: "hotelrestaurant", maxBoxes: 2, fl: "hardwood" });
  const bar = (name = "Bar") => ({ role: "dining", name, type: "bar", lay: "barroom", maxBoxes: 3, fl: "hardwood" });
  const gift = { role: "sales", name: "Gift shop", type: "store", lay: "giftshop", hub: false, maxBoxes: 3 };
  const luggage = { role: "storage", name: "Luggage room", type: "luggage", lay: "luggage", fl: "carpet", maxBoxes: 4, boxTarget: 4 };
  const restrooms = { role: "restroom", name: "Restrooms", lay: "restroom", label: true };
  const manager = { role: "office", name: "Manager's office", type: "office", lay: "manager", lock: ["door", 0.4], boxLock: ["safe", 0.6] };
  const lockers = { role: "lockerroom", name: "Staff lockers", type: "lockers", lay: "stafflockers" };
  const laundry = { role: "storage", name: "Laundry", type: "hotelhk", lay: "hotellaundry", fl: "tile", windows: false };
  const maint = { role: "workshop", name: "Maintenance", type: "workshop", lay: "workshop", lock: ["door", 0.3] };
  const bizc = { role: "office", name: "Business centre", type: "office", lay: "bizcentre" };
  const conf = (name = "Conference room") => ({ role: "office", name, type: "office", lay: "conference", maxBoxes: 1 });
  const ballroom = { role: "dining", name: "Ballroom", type: "kitchen", lay: "ballroom", hub: true, maxBoxes: 1, fl: "hardwood" };
  const gym = { role: "gym", name: "Gym", type: "lockers", lay: "hotelgym" };
  const spa = { role: "lockerroom", name: "Spa", type: "hotelhk", lay: "spa", fl: "tile" };
  const loading = { role: "bays", name: "Loading bay", type: "warehouse", lay: "loading", fl: "conc", maxBoxes: 3 };
  const fire = (lock) => [{ side: "left", roles: ["corridor"], chance: 0.85, lock, name: "Fire exit" }, { side: "right", roles: ["corridor"], chance: 0.85, lock, name: "Fire exit" }];
  const big = { bw, bh, front: { width: 2 }, extraDoors: 0, openDoors: 0.2, foot: "large", stairs: { roles: ["stairwell"], n: 2, len: 3 }, hotel: kind };
  /** @type {any} */
  let spec;
  switch (kind) {
    case "inn": {
      const n = bw >= 25 && rng.chance(0.5) ? 2 : 3; // two storeys only when the floors hold 10 rooms between them
      const reception = lobbyOf("Reception", { hub: true });
      const parlour = { role: "living", name: "Parlour", type: "house", lay: "parlour", hub: false, fl };
      const breakfast = { role: "dining", name: "Breakfast room", type: "kitchen", lay: "breakfast", maxBoxes: 1, fl };
      const flat = { role: "apt", name: "Owners' flat", type: "house", lay: "ownersflat", lock: ["door", 0.3], maxBoxes: 3 };
      const stair = [3, { role: "stairwell", lay: "stairwell" }];
      // A two-storey inn's ground floor holds guest rooms behind, with their housekeeping closet (its owners' flat at the
      // front, by the parlour; its laundry upstairs).
      const laundryI = [3, { ...laundry, name: "Laundry" }], restroom = bw >= 23 ? [[2, { role: "restroom", lay: "restroom" }]] : [];
      const groundBack = n === 2 ? band(bw - 2, [stair, [4, { ...kitchen, fry: false }]], [HK()], HOTEL.UNIT.inn, 0, "back", 1, fl).parts
        : [stair, [4, { ...kitchen, fry: false }], laundryI, ["*", flat], ...restroom];
      const groundFront = n === 2 ? [["*", parlour], [5, reception], ["*", breakfast], [5, flat]] : [["*", parlour], [5, reception], ["*", breakfast]];
      spec = {
        bw, bh, front: { width: 1 }, extraDoors: 0, openDoors: 0.25, foot: "large", hotel: kind, ground: "town", storeys: n, stairs: { roles: ["stairwell"], n: 1, len: 2 },
        program: corridorPlan(groundFront, groundBack, HOTEL.FRONT.inn, 1),
        upper: (f) => guestFloor("inn", f, bw, bh, fl, n === 2 ? { innTail: [laundryI, HK()] } : {}),
        exits: [{ side: "back", roles: ["kitchen", "apt", "corridor"], chance: 0.8, lock: 0.4, name: "Back door" }, { side: "left", roles: ["corridor"], chance: 0.4, lock: 0.5 }],
      };
      break;
    }
    case "business": {
      const n = clampN(pick(rng, S.storeys), S.storeys[0], maxS);
      const wide = bw >= 50;
      const front = [SW, [5, gift], ["*", lobbyOf("Lobby")], ...(wide ? [[6, bar("Lobby bar")]] : []), ["*", restaurant()], SW];
      const back = [LIFT, [4, luggage], [3, restrooms], [5, manager], [4, lockers], ["*", kitchen], [3, walkin], ...(bw >= 48 ? [[5, loading]] : [])];
      const conference = () => corridorPlan([SW, ["*", conf("Conference room A")], ["*", conf("Conference room B")], [6, bizc], SW], [LIFT, [5, gym], ["*", wide ? ballroom : conf("Conference room C")], [5, laundry], [5, maint], HK()], HOTEL.FRONT.big, 2);
      spec = {
        ...big, ground: "lot", storeys: n,
        program: corridorPlan(front, back, HOTEL.FRONT.big, 2),
        upper: (f, r, ctx) => (f === 1 ? conference() : guestFloor("business", f, bw, bh, fl, ctx && ctx.top ? { wide: 2 } : {})),
        exits: [...(bw >= 48 ? [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Loading bay" }] : []), { side: "back", roles: ["kitchen", "pantry", "lockerroom"], chance: 0.7, lock: 0.4 }, ...fire(0.4)],
      };
      break;
    }
    case "resort": {
      const n = clampN(pick(rng, S.storeys), S.storeys[0], maxS);
      // The ground floor's front: a wing of guest rooms either side of the core (gift shop, lobby, restaurant, bar), their
      // housekeeping closet and ice nook at the wings' ends.
      const core = [[5, gift], ["*", lobbyOf("Grand lobby")], ["*", restaurant()], [6, bar("Lounge bar")]];
      const spare = bw - 2 - (5 + 6 + 3 + 3 + 3 + 3) - 2 * 10 - (core.length + 3); // the core's flexible rooms at least 10 each
      const k = Math.max(0, Math.floor(spare / 2 / (HOTEL.UNIT.big + 1)));
      const wing = (n0) => Array.from({ length: k }, (_, i) => [HOTEL.UNIT.big, unit(HOTEL.UNIT.big, 0, n0 + i, "front", fl)]);
      const front = [SW, HK(), ...wing(1), ...core, ...wing(k + 1), ICE(), SW];
      const back = [LIFT, ["*", ballroom], [7, spa], [6, gym], [3, restrooms], [4, luggage], ["*", kitchen], [3, walkin]];
      const boh = [[5, laundry], [4, lockers], [4, manager], [5, maint]]; // the back of house over the ballroom
      spec = {
        ...big, ground: "rural", storeys: n,
        program: corridorPlan(front, back, HOTEL.FRONT.big, 2),
        // The first floor up holds the back of house (the laundry, the lockers, the manager, maintenance) at the back.
        upper: (f, r, ctx) => {
          const wide = ctx && ctx.top ? 2 : 0;
          if (f !== 1) return guestFloor("resort", f, bw, bh, fl, { wide });
          return corridorPlan(band(bw - 2, [SW, HK()], [ICE(), SW], HOTEL.UNIT.big + wide, f, "front", 1, fl).parts, band(bw - 2, [LIFT, ...boh], [], HOTEL.UNIT.big + wide, f, "back", 50, fl).parts, HOTEL.FRONT.big, 2);
        },
        exits: [{ side: "back", roles: ["dining", "gym", "lockerroom", "corridor"], chance: 1, width: 2, lock: 0.2, name: "Doors to the pool deck" }, { side: "back", roles: ["kitchen", "pantry"], chance: 0.7, lock: 0.4 }, ...fire(0.3)],
      };
      break;
    }
    default: { // tower
      const n = clampN(pick(rng, S.storeys) + (o.storeyBonus || 0), S.storeys[0], maxS);
      const garage = { role: "bays", name: "Parking garage", type: "garage", lay: "parking", fl: "conc", maxBoxes: 3 };
      const front = [SW, ["*", lobbyOf("Grand lobby", { lifts: true })], [5, gift], ["*", restaurant()], SW];
      const back = [LIFT, [4, luggage], [3, restrooms], ["*", kitchen], [3, walkin], ["*", garage]];
      const penthouse = { role: "motelroom", name: "Penthouse suite", type: "hotelroom", lay: "penthouse", maxBoxes: 5, boxTarget: 5, fl: "hardwood" };
      spec = {
        ...big, ground: "city", storeys: n, foot: "large",
        program: corridorPlan(front, back, HOTEL.FRONT.big, 2),
        upper: (f, r, ctx) => {
          if (ctx && ctx.top) return corridorPlan([SW, ["*", penthouse], ["*", bar("Rooftop bar")], SW], band(bw - 2, [LIFT], [HK()], HOTEL.UNIT.big + 3, f, "back", 1, fl).parts, HOTEL.FRONT.big, 2);
          if (f === 1) return corridorPlan([SW, ["*", ballroom], ["*", conf()], SW], [LIFT, [5, laundry], [4, lockers], [5, manager], ["*", maint], HK()], HOTEL.FRONT.big, 2);
          if (f === 2) return corridorPlan([SW, ["*", gym], ["*", spa], [6, bizc], SW], band(bw - 2, [LIFT], [HK()], HOTEL.UNIT.big, f, "back", 1, fl).parts, HOTEL.FRONT.big, 2);
          return guestFloor("tower", f, bw, bh, fl);
        },
        exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.25, name: "Garage ramp" }, { side: "back", roles: ["kitchen", "pantry"], chance: 0.6, lock: 0.4 }, ...fire(0.5)],
      };
    }
  }
  spec.margins = groundsFor(kind, bw, bh);
  spec.yard = (Y) => dressGrounds(Y, kind);
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

// ---------- the grounds (assemble's spec.yard) ----------
// Y: { rng, W, H, b: { x0, y0, x1, y1 } (the walls), front (the front door: x, y, ox, oy, cells), exits, cell(x, y),
// outside(x, y) (the ground round the building), free(x, y) (outside, clear, off the zones and the paths), block(x, y,
// k), car(x, y, kind, test), area(a) (an outdoor area: name, x0, y0, w, h) }.
function dressGrounds(Y, kind) {
  const { rng, W, H, b } = Y;
  const paint = (x, y, f, extra = {}) => { if (Y.outside(x, y)) Object.assign(Y.cell(x, y), { f }, extra); };
  // The drive: from the road at the front edge up to the front door, 3 wide.
  const fx = Y.front.x;
  for (let y = b.y1 + 1; y < H; y++) for (let x = fx - 1; x <= fx + 1; x++) paint(x, y, "road");
  // The car park beside the drive (road, cars in rows), on the side with more room.
  const [cmin, cmax] = HOTEL.CARS[kind];
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
  if (kind === "business" || kind === "tower") { // the service yard behind: a truck, crates, bins
    for (let t = 0; t < 30; t++) { const x = rng.int(b.x0, b.x1), y = rng.int(1, Math.max(1, b.y0 - 2)); if (Y.free(x, y) && Y.car(x, y, "truck")) break; }
    for (let i = 0, t = 0; i < 4 && t < 60; t++) { const x = rng.int(b.x0, b.x1), y = rng.int(1, Math.max(1, b.y0 - 2)); if (Y.free(x, y) && Y.block(x, y, "crate")) i++; }
  }
  if (kind === "tower") { // a plaza at the front: paving and planters
    for (let y = b.y1 + 2; y <= Math.min(H - 1, b.y1 + 4); y++) for (let x = b.x0; x <= b.x1; x++) if (Math.abs(x - fx) > 1) paint(x, y, "paving");
    for (let x = b.x0 + 2; x <= b.x1 - 2; x += 5) if (Math.abs(x - fx) > 2 && Y.free(x, b.y1 + 3)) Y.block(x, b.y1 + 3, "plant");
  }
  if (kind === "resort") { poolDeck(Y); courts(Y); }
  if (kind === "inn" || kind === "resort") gardens(Y, kind === "resort" ? 14 : 5);
}
// The resort's pool deck behind the building: paving round an empty pool (its deep end), loungers, a fence with a gate.
function poolDeck(Y) {
  const { rng, b } = Y, [pw, ph] = HOTEL.POOL;
  const dw = pw + 6, dh = ph + 6;
  const cx = Math.round((b.x0 + b.x1) / 2) + rng.int(-6, 6), y1 = b.y0 - 3, y0 = y1 - dh + 1, x0 = cx - (dw >> 1), x1 = x0 + dw - 1;
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
