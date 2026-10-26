// @ts-check
// Zoo buildings (issue #59 of the round-2 epic #39, the user's request 2026-10-26: "zoos"): the floor plans of the
// buildings a zoo is made of (zoo.js lays them out on one map with the enclosures between them) and the room styles
// that furnish them, on roomlayout.js's placement helpers (lanes kept clear between the doors, backs to the walls, the
// lootable pieces the containers), as campuslayout.js does for a campus. A plan leaf carries zoo: <style> (zooStyle,
// run by buildingmaps.js assemble before the other styles); the café borrows #16's kitchen styles, the vet hospital is
// laid out with #14's vet rooms (zoo.js assembles it with the key "vet": roomlayout.js MEDICAL_STYLES), the research
// building is #28's science hall (BUILDINGS.sciencehall).
//
// The buildings (ZOO_PLANS, by key; o.size "s" | "m" | "l" | "h" from the zoo's variant, o.animal for an animal house):
//   entrance     the entrance building on the plaza: the ticket office, the turnstile hall straight through to the zoo
//                (its back door), the gift shop and its stockroom, restrooms; a big zoo's first aid and guest services.
//   animalhouse  an animal house by its animals (o.animal): a public viewing hall along the front, the dens, stalls or
//                terraria behind it (hay, a water trough, the feed crates; reptiles' and nocturnal animals' glass tanks),
//                the keepers' passage behind them, a keepers' room and a feed store at one end. Kinds: pachyderm (an
//                elephant or a giraffe house: a few big stalls), primate (dens and a nursery), bigcat (dens and a crush
//                cage, steel doors), reptile (terraria, an incubation room), nocturnal (a dark hall of small dens),
//                bird (a free-flight hall of plants, small aviaries), barn (a petting barn: stalls round its floor).
//   aquarium     the lobby and its gift shop, the great tank hall, side galleries of tanks, the life-support plant
//                (pumps, the water tanks, the workshop), quarantine tanks, the fish kitchen; upstairs (a big one) the
//                upper gallery and the offices.
//   cafe         a snack kiosk (s) or a café (m, l): the counter and the seating, the kitchen, the walk-in, restrooms.
//   giftshop     a big zoo's own gift shop: the shop floor, its stockroom and office.
//   keeper       the keepers' block (the staff building): the keepers' room, the locker room, the staff office, the
//                break room, the workshop; upstairs (l) the curator's office and the education room.
//   commissary   the food prep: the meat room (butcher's cases, chest freezers), the produce room (produce bins), the
//                walk-in freezer, the feed store, the dry store, off a corridor.
//   vethospital  the vet hospital (#14's vet rooms): reception, exam rooms, the surgery, the drug room, the dart room
//                (a dart cabinet: the sedatives and the tranquilliser darts), quarantine pens, the lab, the food store.
//   service      the service yard's building: the vehicle bay (the zoo's truck), the tool room, the fuel store.
// Older saves: none of these buildings existed before (zoos are new places), so there is nothing to keep.
import { pieceDef } from "./data-furniture.js";
import { registerScene } from "./interiorscenes.js"; // the zoo's signs of survival (issue #11's hook)
import { COMMERCIAL_STYLES } from "./shoplayout.js";
import { boardCell } from "./barricade.js";

// The footprints by size, [width range], [depth range] in cells (a metre a cell, #24's CELL_M).
export const ZOO_SIZE = {
  entrance:    { s: [[14, 18], [9, 10]], m: [[22, 28], [11, 13]], l: [[30, 38], [13, 15]], h: [[38, 46], [14, 16]] },
  animalhouse: { s: [[16, 20], [12, 14]], m: [[22, 28], [14, 17]], l: [[30, 38], [17, 21]], h: [[36, 44], [19, 23]] },
  aquarium:    { s: [[22, 26], [16, 18]], m: [[30, 36], [20, 24]], l: [[44, 52], [28, 32]], h: [[76, 86], [46, 52]] },
  cafe:        { s: [[8, 10], [6, 7]], m: [[16, 20], [11, 13]], l: [[22, 28], [14, 16]], h: [[26, 32], [16, 18]] },
  giftshop:    { s: [[10, 12], [8, 9]], m: [[14, 18], [10, 12]], l: [[18, 22], [12, 14]], h: [[20, 26], [12, 14]] },
  keeper:      { s: [[10, 12], [8, 9]], m: [[16, 20], [11, 13]], l: [[22, 28], [13, 15]], h: [[26, 32], [14, 16]] },
  commissary:  { s: [[12, 14], [10, 11]], m: [[18, 22], [12, 14]], l: [[24, 30], [14, 16]], h: [[28, 34], [16, 18]] },
  vethospital: { s: [[14, 16], [11, 12]], m: [[20, 24], [13, 15]], l: [[26, 32], [15, 17]], h: [[30, 36], [17, 19]] },
  service:     { s: [[12, 14], [9, 10]], m: [[16, 20], [11, 12]], l: [[20, 26], [12, 14]], h: [[24, 30], [13, 15]] },
};
// The animal houses' kinds: the building's name and the den's.
export const ANIMALS = {
  pachyderm: { name: "Elephant house", den: "Elephant stall", n: [2, 3], big: true },
  giraffe:   { name: "Giraffe house", den: "Giraffe stall", n: [2, 4], big: true },
  primate:   { name: "Primate house", den: "Primate den", n: [4, 7] },
  bigcat:    { name: "Big-cat house", den: "Cat den", n: [3, 5], steel: true },
  reptile:   { name: "Reptile house", den: "Terrarium room", n: [3, 5], tanks: true },
  nocturnal: { name: "Nocturnal house", den: "Night den", n: [4, 6], tanks: true, dark: true },
  bird:      { name: "Tropical bird house", den: "Aviary", n: [2, 4], flight: true },
  barn:      { name: "Petting barn", den: "Stall", n: [0, 0], barn: true },
};
export const ZOOL = {
  KEEPER_BOXES: 3,  // a keepers' room's containers (its lockers, a cabinet)
  FREEZERS: [2, 3], // the meat room's chest freezers
  TANKS: 0.5,       // a tank every this many cells of a terrarium room's wall (a share)
};
const leaves = (list) => list.map(([s, r]) => [s, typeof r === "string" ? { role: r } : r]);
const range = (rng, [a, b]) => rng.int(a, b);
// A band in front, a corridor, a band behind (campuslayout.js hallPlan's shape): front and back are [size, leaf] lists.
const hallPlan = (front, back, fd, cw = 2, hall = null) => ({ split: "y", parts: [[fd, { split: "x", parts: leaves(front) }], [cw, { role: "corridor", ...(hall || {}) }], ["*", { split: "x", parts: leaves(back) }]] });
const room = (role, name, zoo, extra = {}) => ({ role, name, zoo, ...extra });
const restroom = () => ({ role: "restroom", name: "Restroom" });
const sizeOf = (o) => (o && ZOO_SIZE.entrance[o.size] ? o.size : "m");
// The footprint: o.bw / o.bh, else the size's dice; never past o.maxW / o.maxH (zoo.js: the plot it stands on).
const footOf = (rng, key, o = {}) => {
  const S = ZOO_SIZE[key][sizeOf(o)], bw = o.bw || range(rng, S[0]), bh = o.bh || range(rng, S[1]);
  return { bw: o.maxW ? Math.min(bw, Math.max(10, o.maxW)) : bw, bh: o.maxH ? Math.min(bh, Math.max(8, o.maxH)) : bh };
};

// ---------- the plans ----------
// Each (rng, o) → a buildingmaps.js assemble spec, front toward +y (zoo.js turns it to face its path).
function entrance(rng, o = {}) {
  const sz = sizeOf(o), { bw, bh } = footOf(rng, "entrance", o), big = sz === "l" || sz === "h";
  const lw = big ? 8 : 6;
  const left = big
    ? { split: "y", parts: leaves([["*", room("office", "Ticket office", "ticket", { type: "office", lock: ["door", 0.3], boxLock: ["safe", 0.3] })], [4, room("exam", "First aid", "firstaid", { type: "clinic", maxBoxes: 2 })], [3, restroom()]]) }
    : { split: "y", parts: leaves([["*", room("office", "Ticket office", "ticket", { type: "office", lock: ["door", 0.3] })], [3, restroom()]]) };
  const right = big
    ? { split: "y", parts: leaves([["*", room("sales", "Gift shop", "giftshop", { type: "giftshop", hub: false, maxBoxes: 5 })], [4, room("stock", "Gift shop stockroom", "giftstock", { type: "giftshop", maxBoxes: 3 })], [3, room("office", "Guest services", "guestdesk", { type: "office", maxBoxes: 2 })]]) }
    : { split: "y", parts: leaves([["*", room("sales", "Gift shop", "giftshop", { type: "giftshop", hub: false, maxBoxes: 3 })], [3, room("stock", "Gift shop stockroom", "giftstock", { type: "giftshop", maxBoxes: 2 })]]) };
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: big ? "large" : "medium",
    program: { split: "x", parts: [["*", left], [lw, room("lobby", "Turnstile hall", "turnstiles", { entry: true, type: "office", maxBoxes: 1, fl: "tile" })], ["*", right]] },
    exits: [{ side: "back", roles: ["lobby"], chance: 1, lock: 0, width: 2, name: "Into the zoo" }],
  };
}
// An animal house of kind o.animal (ANIMALS).
function animalhouse(rng, o = {}) {
  const kind = ANIMALS[o.animal] ? o.animal : "primate", A = ANIMALS[kind];
  const sz = sizeOf(o), { bw, bh } = footOf(rng, "animalhouse", o);
  const name = A.den, steel = A.steel ? { dk: "steel" } : {};
  const den = (i) => room("cells", `${name} ${i + 1}`, A.tanks ? "terrarium" : A.big ? "stall" : "den", { type: "animalhouse", maxBoxes: 1, fl: A.tanks ? "tile" : "dirt", den: true, animal: kind, lock: ["door", 0.45], ...steel });
  const hallD = Math.max(4, Math.round(bh * 0.32));
  const keeperRoom = room("office", "Keepers' room", "keeperroom", { type: "zookeeper", maxBoxes: ZOOL.KEEPER_BOXES, boxTarget: ZOOL.KEEPER_BOXES });
  const feed = room("storage", "Feed store", "feedstore", { type: "animalhouse", maxBoxes: 3 });
  if (A.barn) { // a petting barn: its floor a hub of stalls (#16's stalls style), the tack room and the feed store behind
    return {
      bw, bh, front: { width: 2, roller: true }, ground: "rural", storeys: 1, foot: "medium", animal: kind,
      program: { split: "y", parts: [["*", room("barnfloor", "Petting barn", "barnstalls", { entry: true, type: "animalhouse", maxBoxes: 3, fl: "dirt" })], [4, { split: "x", parts: leaves([["*", room("tack", "Tack room", "tack", { type: "animalhouse", maxBoxes: 2 })], [5, feed], [4, keeperRoom]]) }]] },
      exits: [{ side: "back", roles: ["barnfloor", "storage"], chance: 0.9, lock: 0.2, width: 2, roller: true }],
    };
  }
  const n = Math.max(1, Math.min(A.n[1], Math.max(A.n[0], Math.floor((bw - 10) / (A.big ? 9 : 5)))));
  const dens = Array.from({ length: n }, (_, i) => ["*", den(i)]);
  const end = A.flight ? [] : kind === "primate" ? [[4, room("storage", "Nursery", "nursery", { type: "animalhouse", maxBoxes: 2 })]] : kind === "bigcat" ? [[4, room("cells", "Crush cage", "crush", { type: "animalhouse", maxBoxes: 1, dk: "steel", lock: ["door", 0.5] })]] : A.tanks ? [[4, room("storage", kind === "reptile" ? "Incubation room" : "Heat-lamp store", "incubator", { type: "animalhouse", maxBoxes: 2 })]] : [];
  const back = A.flight
    ? [["*", room("dayroom", "Free-flight hall", "freeflight", { type: "animalhouse", maxBoxes: 2, fl: "dirt", hub: false })], ...dens.slice(0, 2), [5, keeperRoom], [4, feed]]
    : [...dens, ...end, [5, keeperRoom], [4, feed]];
  const hall = room("lobby", A.dark ? "Night hall" : "Viewing hall", "viewing", { entry: true, type: "animalhouse", maxBoxes: 1, fl: "tile", animal: kind, ...(A.dark ? { dark: true } : {}) });
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: sz === "s" ? "medium" : "large", animal: kind,
    program: { split: "y", parts: [[hallD, hall], [2, { role: "corridor", name: "Keepers' passage" }], ["*", { split: "x", parts: leaves(back) }]] },
    exits: [{ side: "back", roles: ["cells", "storage", "office", "dayroom"], chance: 1, lock: 0.3, width: A.big ? 2 : 1, ...(A.big ? { roller: true } : {}), name: "Keepers' door to the enclosure" }, { side: sideOf(rng), roles: ["corridor"], chance: 0.6, lock: 0.4 }],
  };
}
const sideOf = (rng) => (rng.chance(0.5) ? "left" : "right");
function aquarium(rng, o = {}) {
  const sz = sizeOf(o), { bw, bh } = footOf(rng, "aquarium", o), big = sz === "l" || sz === "h";
  const n = Math.min(o.maxStoreys || 3, sz === "h" ? 3 : big ? 2 : 1), gw = big ? 9 : 7; // a city aquarium's three levels
  const gallery = (nm) => room("lobby", nm, "gallery", { type: "animalhouse", hub: false, maxBoxes: 1, fl: "tile", dark: true });
  const hallD = Math.round(bh * 0.45);
  const front = [[gw, gallery("Coral gallery")], ["*", room("lobby", "Great tank hall", "tankhall", { entry: true, type: "animalhouse", maxBoxes: 1, fl: "tile" })], [gw, gallery(big ? "Shark gallery" : "Freshwater gallery")]];
  const back = [["*", room("workshop", "Life-support plant", "lifesupport", { type: "workshop", maxBoxes: 3 })], [5, room("storage", "Quarantine tanks", "quarantine", { type: "animalhouse", maxBoxes: 2 })], [5, room("kitchen", "Fish kitchen", "meatprep", { type: "zoofood", maxBoxes: 3 })], [5, room("office", "Aquarists' room", "keeperroom", { type: "zookeeper", maxBoxes: 3 })], [4, room("sales", "Gift shop", "giftshop", { type: "giftshop", hub: false, maxBoxes: 3 })], [3, restroom()]];
  return {
    bw, bh, front: { width: 3 }, ground: "town", storeys: n, foot: big ? "wide" : "large",
    program: hallPlan(front, back, hallD, 3),
    upper: n > 1 ? () => hallPlan([[gw, gallery("Upper gallery")], ["*", room("lobby", "Tank-top walkway", "tankhall", { type: "animalhouse", maxBoxes: 1 })], [gw, gallery("Jellyfish gallery")]], [["*", room("office", "Curator's office", "staffoffice", { type: "office", maxBoxes: 2 })], [6, room("staffroom", "Staff room", "breakroom", { type: "kitchen", maxBoxes: 2 })], [5, room("storage", "Filter store", "workshop", { type: "workshop", maxBoxes: 2 })], [3, restroom()]], hallD, 3) : null,
    stairs: { roles: ["corridor"], n: 2, len: 2, ends: true },
    exits: [{ side: "back", roles: ["workshop", "storage", "kitchen"], chance: 1, lock: 0.3, width: 2, roller: true, name: "Service door" }, { side: "left", roles: ["corridor"], chance: 0.7, lock: 0.4 }, { side: "right", roles: ["corridor"], chance: 0.7, lock: 0.4 }],
  };
}
function cafe(rng, o = {}) {
  const sz = sizeOf(o), { bw, bh } = footOf(rng, "cafe", o);
  if (sz === "s") return { // a snack kiosk: the counter room and its store
    bw, bh, front: { width: 1 }, ground: "town", storeys: 1, foot: "small",
    program: { split: "x", parts: leaves([["*", room("kitchen", "Snack kiosk", "snackbar", { entry: true, type: "kitchen", maxBoxes: 2 })], [3, room("pantry", "Kiosk store", "giftstock", { type: "kitchen", maxBoxes: 1 })]]) },
    exits: [{ side: "back", roles: ["pantry", "kitchen"], chance: 0.8, lock: 0.5 }],
  };
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "medium",
    program: { split: "y", parts: [["*", room("cafeteria", sz === "m" ? "Café" : "Food court", "cafe", { entry: true, type: "kitchen", maxBoxes: 3 })], [5, { split: "x", parts: leaves([["*", room("kitchen", "Kitchen", "galley", { maxBoxes: 3 })], [4, room("pantry", "Walk-in", "walkin", { type: "kitchen", dk: "steel", maxBoxes: 2 })], [3, restroom()]]) }]] },
    exits: [{ side: "back", roles: ["kitchen", "pantry"], chance: 0.9, lock: 0.3 }, { side: sideOf(rng), roles: ["cafeteria"], chance: 0.6, lock: 0.2 }],
  };
}
function giftshop(rng, o = {}) {
  const { bw, bh } = footOf(rng, "giftshop", o);
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "medium",
    program: { split: "y", parts: [["*", room("sales", "Gift shop", "giftshop", { entry: true, type: "giftshop", maxBoxes: 5 })], [4, { split: "x", parts: leaves([["*", room("stock", "Stockroom", "giftstock", { type: "giftshop", maxBoxes: 3 })], [5, room("office", "Shop office", "staffoffice", { type: "office", maxBoxes: 2, lock: ["door", 0.3], boxLock: ["safe", 0.3] })]]) }]] },
    exits: [{ side: "back", roles: ["stock", "office"], chance: 0.8, lock: 0.4 }],
  };
}
function keeper(rng, o = {}) {
  const sz = sizeOf(o), { bw, bh } = footOf(rng, "keeper", o), n = Math.min(o.maxStoreys || 2, sz === "l" || sz === "h" ? 2 : 1);
  const keeperRoom = () => room("office", "Keepers' room", "keeperroom", { type: "zookeeper", maxBoxes: ZOOL.KEEPER_BOXES, boxTarget: ZOOL.KEEPER_BOXES });
  if (sz === "s") return { // a keepers' hut: the keepers' room and a tool store
    bw, bh, front: { width: 1 }, ground: "rural", storeys: 1, foot: "small",
    program: { split: "x", parts: leaves([["*", { ...keeperRoom(), entry: true, hub: true }], [4, room("storage", "Tool store", "toolstore", { type: "workshop", maxBoxes: 2 })]]) },
    exits: [{ side: "back", roles: ["office", "storage"], chance: 0.6, lock: 0.4 }],
  };
  const fd = Math.max(5, Math.floor((bh - 4) / 2));
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: n > 1 ? "large" : "medium",
    program: hallPlan([["*", keeperRoom()], [6, room("lobby", "Staff entrance", "staffdesk", { entry: true, type: "office", maxBoxes: 1 })], ["*", room("lockerroom", "Locker room", "keeperlockers", { type: "zookeeper", maxBoxes: 3 })]],
      [["*", room("staffroom", "Break room", "breakroom", { type: "kitchen", maxBoxes: 2 })], [5, room("office", "Staff office", "staffoffice", { type: "office", maxBoxes: 2 })], [3, restroom()], ["*", room("workshop", "Keepers' workshop", "workshop", { type: "workshop", maxBoxes: 3 })]], fd),
    upper: n > 1 ? () => hallPlan([["*", room("office", "Curator's office", "staffoffice", { type: "office", maxBoxes: 2 })], ["*", room("office", "Records", "staffoffice", { type: "office", maxBoxes: 2 })]], [["*", room("classroom", "Education room", "education", { type: "office", maxBoxes: 2 })], [3, restroom()], ["*", room("office", "Registrar's office", "staffoffice", { type: "office", maxBoxes: 2 })]], fd) : null,
    stairs: { roles: ["corridor"], n: 1, len: 2 },
    exits: [{ side: "back", roles: ["workshop", "staffroom"], chance: 0.8, lock: 0.3 }, { side: sideOf(rng), roles: ["corridor"], chance: 0.6, lock: 0.4 }],
  };
}
function commissary(rng, o = {}) {
  const sz = sizeOf(o), { bw, bh } = footOf(rng, "commissary", o);
  const fd = Math.max(4, Math.floor((bh - 3) / 2));
  const front = sz === "s"
    ? [["*", room("kitchen", "Food prep", "meatprep", { entry: true, type: "zoofood", maxBoxes: 3 })], [5, room("storage", "Feed store", "feedstore", { type: "zoofood", maxBoxes: 2 })]]
    : [["*", room("kitchen", "Meat room", "meatprep", { entry: true, type: "zoofood", maxBoxes: 4 })], [6, room("kitchen", "Produce room", "produce", { type: "zoofood", maxBoxes: 3 })], ["*", room("storage", "Feed store", "feedstore", { type: "zoofood", maxBoxes: 3 })]];
  const back = sz === "s"
    ? [["*", room("pantry", "Walk-in freezer", "walkfreezer", { type: "zoofood", dk: "steel", maxBoxes: 2, windows: false })], [3, restroom()]]
    : [[5, room("pantry", "Walk-in freezer", "walkfreezer", { type: "zoofood", dk: "steel", maxBoxes: 3, windows: false })], ["*", room("storage", "Dry store", "feedstore", { type: "zoofood", maxBoxes: 3 })], [5, room("office", "Nutritionist's office", "staffoffice", { type: "office", maxBoxes: 2 })]];
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: sz === "s" ? "small" : "medium",
    program: hallPlan(front, back, fd),
    exits: [{ side: "back", roles: ["storage", "pantry"], chance: 1, lock: 0.3, width: 2, roller: true, name: "Loading door" }],
  };
}
// The vet hospital: #14's vet rooms by role (zoo.js assembles it with the key "vet", so roomlayout.js MEDICAL_STYLES
// furnishes them: the steel exam tables, the surgery, the locked drug cabinet, the pens), the dart room and the lab its own.
function vethospital(rng, o = {}) {
  const sz = sizeOf(o), { bw, bh } = footOf(rng, "vethospital", o), big = sz === "l" || sz === "h";
  const fd = Math.max(4, Math.floor((bh - 3) / 2));
  const front = big
    ? [[5, { role: "exam", name: "Exam room", type: "vet" }], ["*", { role: "lobby", entry: true, name: "Reception", type: "vet" }], [5, { role: "exam", name: "Exam room", type: "vet" }], [6, { role: "theatre", name: "Surgery", type: "vet", lock: ["door", 0.3] }]]
    : [[5, { role: "exam", name: "Exam room", type: "vet" }], ["*", { role: "lobby", entry: true, name: "Reception", type: "vet" }], [5, { role: "theatre", name: "Surgery", type: "vet", lock: ["door", 0.3] }]];
  const back = [["*", { role: "cells", name: "Quarantine pens", type: "vet", kennel: true, lock: ["door", 0.35] }], [4, { role: "pharmroom", name: "Drug room", type: "vet", lock: ["door", 0.5], boxLock: ["drugs", 0.4] }], [4, room("pharmroom", "Dart room", "dartroom", { type: "vet", lock: ["door", 0.6], maxBoxes: 2 })],
    ...(big ? [[5, { role: "lab", name: "Lab", type: "lab" }]] : []), [4, { role: "storage", name: "Food store", type: "vet", food: true }]];
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "medium",
    program: hallPlan(front, back, fd),
    exits: [{ side: "back", roles: ["cells", "storage"], chance: 0.9, lock: 0.3, width: 2, roller: true, name: "Animal door" }],
  };
}
function service(rng, o = {}) {
  const { bw, bh } = footOf(rng, "service", o);
  return {
    bw, bh, front: { width: 3, roller: true }, ground: "town", storeys: 1, foot: "medium",
    program: { split: "x", parts: [["*", room("bays", "Vehicle bay", "vehbay", { entry: true, type: "garage", maxBoxes: 3 })], [5, { split: "y", parts: leaves([["*", room("workshop", "Tool room", "workshop", { type: "workshop", maxBoxes: 3 })], [4, room("storage", "Fuel store", "fuelstore", { type: "garage", maxBoxes: 2, lock: ["door", 0.4] })]]) }]] },
    exits: [{ side: "back", roles: ["workshop", "storage"], chance: 0.7, lock: 0.4 }],
  };
}
export const ZOO_PLANS = { entrance, animalhouse, aquarium, cafe, giftshop, keeper, commissary, vethospital, service };
// A building's name on the zoo (zoo.js names a second of a kind).
export const ZOO_NAMES = { entrance: "Entrance", aquarium: "Aquarium", cafe: "Café", giftshop: "Gift shop", keeper: "Keepers' block", commissary: "Food prep", vethospital: "Vet hospital", service: "Service yard", research: "Research building" };
export const buildingName = (key, o = {}) => (key === "animalhouse" ? (ANIMALS[o.animal] || ANIMALS.primate).name : key === "cafe" && o.size === "s" ? "Snack kiosk" : key === "keeper" && o.size === "s" ? "Keepers' hut" : ZOO_NAMES[key] || key);

// ---------- the room styles ----------
/** @typedef {any} Lay */
const isLoot = (k) => !!(pieceDef(k) && pieceDef(k).loot);
const full = (L) => L.boxes() >= L.target();
const P = (L, o = {}) => ({ ...o, plain: full(L) });
function some(L, k, n, opts = {}) { const out = []; for (let i = 0; i < n; i++) { const r = L.wall(k, isLoot(k) ? P(L, opts) : opts); if (!r) break; out.push(r); } return out; }
function fill(L, kinds) {
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.wall(kinds[i % kinds.length], { prefer: "corner" })) miss = 0; else miss++; }
  for (let i = 0, miss = 0; !full(L) && miss < kinds.length; i++) { if (L.centre(kinds[i % kinds.length])) miss = 0; else miss++; }
}
function tableSet(L, chairs = 4) { const t = L.centre("table"); if (t) L.around(t, "chair", chairs); return t; }
const area = (L) => L.c.w * L.c.h;

/** @type {Record<string, (L: Lay) => void>} */
export const ZOO_STYLES = {
  // ---------- the entrance ----------
  // The turnstile hall: the turnstiles in a row across the hall (gaps between them kept: the lanes), the barrier
  // posts, a bench, the map board (decor).
  turnstiles(L) {
    const c = L.c, y = c.y0 + Math.floor(c.h / 2);
    for (let x = c.x0 + 1; x < c.x1; x += 2) if (L.ok(x, y) && !L.lane(x, y)) L.place("turnstile", [[x, y]], { face: "s" });
    L.wall("stanchion", { prefer: "corner" });
    L.wall("mallbench", { prefer: "middle" });
  },
  // The ticket office: the counter at its window, a chair, the cash drawer's cabinet, filing (the safe: its boxLock).
  ticket(L) {
    const d = L.wall("counter", P(L, { prefer: "middle" }));
    if (d) L.around(d, "chair", 1);
    if (L.room.boxLock && L.room.boxLock[0] === "safe") L.wall("safe", P(L, { prefer: "corner" }));
    fill(L, ["cabinet", "filing"]);
  },
  // First aid: an exam bed, a medicine cabinet, a chair.
  firstaid(L) { L.wall("exambed", { prefer: "corner" }) || L.centre("exambed"); L.wall("medcab", P(L)); L.wall("chair", { prefer: "corner" }); fill(L, ["cabinet"]); },
  // Guest services: a counter, a pushchair rack (a shelf), a lost-property cabinet.
  guestdesk(L) { const d = L.wall("counter", P(L, { prefer: "middle" })); if (d) L.around(d, "chair", 1); fill(L, ["cabinet", "shelf"]); },
  // The gift shop: the till by the door, racks of T-shirts, display cases of trinkets, shelves of plush and books.
  giftshop(L) {
    const t = L.wall("checkout", P(L, { prefer: "corner" })) || L.wall("counter", P(L, { prefer: "corner" }));
    if (t) L.around(t, "chair", 1);
    const r = L.centre("clothesrack"); if (r) L.around(r, "clothesrack", 1);
    some(L, "displaycase", area(L) > 40 ? 2 : 1);
    fill(L, ["shelf", "shelf", "displaycase"]);
  },
  giftstock(L) { fill(L, ["shelf", "crate", "shelf"]); },
  // ---------- the animal houses ----------
  // The viewing hall: benches facing the dens' glass, an exhibit case, plants; a reptile or a nocturnal house's tanks
  // along its walls (the terraria the public walk past).
  viewing(L) {
    const tanks = L.room.animal === "reptile" || L.room.animal === "nocturnal";
    if (tanks) some(L, "tank", Math.max(2, Math.floor(L.c.w * ZOOL.TANKS)));
    some(L, "mallbench", Math.max(1, Math.floor(L.c.w / 8)), { prefer: "middle" });
    L.wall("displaycase", P(L, { prefer: "corner" }));
    some(L, "plant", 2, { prefer: "corner" });
    fill(L, ["cabinet"]);
  },
  // A den: straw (hay), the water trough (a barrel), a feed crate; a big cat's or a primate's the same on a dirt floor.
  den(L) { some(L, "hay", area(L) > 20 ? 2 : 1, { prefer: "corner" }); L.wall("barrel", { prefer: "corner" }); fill(L, ["crate"]); },
  // A big stall (an elephant's, a giraffe's): bales along the walls, troughs, the feed crates.
  stall(L) { some(L, "hay", 4, { prefer: "corner" }); some(L, "barrel", 2, { prefer: "corner" }); fill(L, ["crate"]); },
  // A terrarium room: glass tanks along the walls, the heat lamps, a cabinet of feed.
  terrarium(L) { some(L, "tank", Math.max(2, Math.floor(Math.max(L.c.w, L.c.h) * ZOOL.TANKS) + 1)); L.wall("floorlamp", { prefer: "corner" }); fill(L, ["cabinet", "shelf"]); },
  // The free-flight hall: plants everywhere, a pond's trough, benches on the path.
  freeflight(L) { some(L, "plant", Math.max(3, Math.floor(area(L) / 12)), { prefer: "corner" }); for (let i = 0; i < 3; i++) L.centre("plant"); L.wall("barrel"); L.wall("mallbench", { prefer: "middle" }); fill(L, ["crate"]); },
  // A primate house's nursery: a crib, a heat lamp, a cabinet of formula and blankets, a chair.
  nursery(L) { L.wall("crib", { prefer: "corner" }); L.wall("floorlamp", { prefer: "corner" }); L.wall("chair"); fill(L, ["cabinet", "shelf"]); },
  // A big-cat house's crush cage: a steel cage of bars to hold a cat for the vet, a cabinet.
  crush(L) { some(L, "bars", 2, { prefer: "middle" }); fill(L, ["cabinet"]); },
  // An incubation room: incubators on benches (a lab bench), the tanks, a cabinet.
  incubator(L) { L.wall("labbench", { prefer: "middle" }); L.wall("tank"); fill(L, ["cabinet", "shelf"]); },
  // The petting barn: its stalls (#16's), straw, the feed bins.
  barnstalls: (L) => COMMERCIAL_STYLES.stalls(L),
  tack: (L) => COMMERCIAL_STYLES.tack(L),
  // A feed store: sacks of feed in crates, drums, shelving.
  feedstore(L) { fill(L, ["crate", "crate", "shelf", "barrel"]); },
  // ---------- the aquarium ----------
  // The great tank hall: the big tank along its back wall, benches before it, plants.
  tankhall(L) { some(L, "tank", Math.max(3, Math.floor(L.c.w * 0.6))); some(L, "mallbench", 2, { prefer: "middle" }); for (let i = 0; i < 2; i++) L.centre("mallbench"); some(L, "plant", 2, { prefer: "corner" }); fill(L, ["cabinet"]); },
  // A gallery: tanks down both walls, dark.
  gallery(L) { some(L, "tank", Math.max(2, Math.floor((L.c.w + L.c.h) * ZOOL.TANKS))); L.wall("mallbench", { prefer: "middle" }); fill(L, ["cabinet"]); },
  // The life-support plant: the pumps (compressors), the water tanks, the boiler, a workbench and tool chest.
  lifesupport(L) { L.wall("watertank", { prefer: "corner" }); L.wall("boiler", { prefer: "corner" }); some(L, "compressor", 2, { prefer: "corner" }); const b = L.wall("workbench", P(L)); if (b) L.beside(b, "toolchest", P(L)); fill(L, ["shelf", "toolchest"]); },
  quarantine(L) { some(L, "tank", 3); fill(L, ["cabinet", "shelf"]); },
  // ---------- the food ----------
  // The meat room: butcher's cases and the cutting counter with its sink, chest freezers along the wall (the meat for
  // the carnivores, gone bad since the power failed: combat.js BOX_LOOT freezer, meatcase), the slicer.
  meatprep(L) {
    const ws = L.walls();
    L.run(["meatcase", "counter", "sink", "counter"], [ws[0] ? ws[0].side : "n"], { plain: () => full(L) });
    if (!L.has("meatcase")) L.need("meatcase", P(L));
    const nf = L.c.rng.int(ZOOL.FREEZERS[0], ZOOL.FREEZERS[1]);
    some(L, "freezer", nf, ws[1] ? { sides: [ws[1].side] } : {});
    if (!L.has("freezer")) L.need("freezer", P(L));
    L.wall("slicer", { prefer: "corner" });
    fill(L, ["counter", "shelf"]);
  },
  // The produce room: produce bins (the root vegetables that keep), the counter and sink, crates of fruit gone to mush.
  produce(L) { some(L, "producebin", 3); if (!L.has("producebin")) L.need("producebin", P(L)); L.wall("sink"); fill(L, ["counter", "crate"]); },
  walkfreezer: (L) => COMMERCIAL_STYLES.walkfreezer(L),
  cafe: (L) => COMMERCIAL_STYLES.cafe(L),
  galley: (L) => COMMERCIAL_STYLES.galley(L),
  walkin: (L) => COMMERCIAL_STYLES.walkin(L),
  // A snack kiosk: the counter at its hatch, the drinks fridge, a shelf of crisps, the freezer of ice lollies.
  snackbar(L) { L.wall("counter", P(L, { prefer: "middle" })); L.wall("coldcase", P(L)); L.wall("freezer", P(L, { prefer: "corner" })); fill(L, ["shelf"]); },
  breakroom: (L) => COMMERCIAL_STYLES.breakroom(L),
  // ---------- the keepers ----------
  // The keepers' room: their lockers, a table and chairs, a cabinet, a coat rack (a shelf), the kettle's counter.
  keeperroom(L) { some(L, "locker", 2, { prefer: "corner" }); tableSet(L, 3); L.wall("cabinet", P(L)); fill(L, ["locker", "cabinet"]); },
  keeperlockers(L) { some(L, "locker", Math.max(2, Math.floor(L.c.w / 2))); L.centre("weightbench") || L.wall("chair"); fill(L, ["locker"]); },
  staffdesk(L) { const d = L.wall("counter", P(L, { prefer: "middle" })); if (d) L.around(d, "chair", 1); L.wall("keyrack", { prefer: "corner" }); },
  staffoffice(L) { const d = L.wall("desk", P(L)) || L.centre("desk", P(L)); if (d) L.around(d, "chair", 1); fill(L, ["filing", "bookshelf", "cabinet"]); },
  education(L) { L.wall("whiteboard", { prefer: "middle" }); for (let i = 0; i < 3; i++) tableSet(L, 2); fill(L, ["bookshelf", "cabinet"]); },
  workshop: (L) => COMMERCIAL_STYLES.workshop(L),
  toolstore(L) { L.wall("workbench", P(L)); fill(L, ["toolchest", "shelf"]); },
  // The service yard: the zoo's truck in the bay, a workbench, the tool chests; the fuel store's drums.
  vehbay: (L) => COMMERCIAL_STYLES.bays(L),
  fuelstore(L) { fill(L, ["drum", "shelf", "drum"]); },
  // ---------- the vet hospital ----------
  // The dart room: the dart cabinet (the sedatives and the darts: data-zoo.js ZOO_BOX dartcab), the drug cabinet, a
  // bench to load the darts at.
  dartroom(L) { L.wall("dartcab", P(L, { prefer: "corner" })) || L.need("dartcab", P(L)); L.wall("medcab", P(L)); L.wall("counter", { prefer: "middle" }); },
};

// The zoo style for a room (buildingmaps.js assemble): its plan leaf's zoo mark. null: the room keeps the other styles.
/** @param {any} r */
export function zooStyle(r) {
  return r && r.zoo && ZOO_STYLES[r.zoo] ? ZOO_STYLES[r.zoo] : null;
}

// ======================================================================================
// The zoo's signs of survival (interiorscenes.js registerScene, issue #11's hook; their own dice there; rolled on the
// whole zoo's map, kinds: ["zoo"]):
//   emptycages     an animal house's dens standing open and empty: their doors forced or left wide, the straw dragged
//                  out, blood on the den floor and a trail toward the keepers' door; what was in them is out there.
//   keepersstand   the keepers' last stand: a keepers' room (or the staff block's) with its door barricaded by the
//                  lockers and the table, the keepers' bodies inside with the dart rifle's case (a ground pile: darts
//                  and the sedatives), the dead they took with them outside the door.
//   escaped        an enclosure broken open (zoo.js marks the enclosures on the plan: plan.grounds kind "enclosure"):
//                  its fence torn down in a stretch, the gate wide, the remains of what was kept there (a ground pile:
//                  bones and a torn harness), a keeper's body by the gate.
// ======================================================================================
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const zooRooms = (ctx, test) => ctx.rng.shuffle(ctx.rooms.filter((r) => test(r) && !r.scene));
const lower = (r) => String(r.name || "room").replace(/ \d+$/, "").replace(/,.*$/, "").toLowerCase();
function emptyCages(ctx) {
  const { rng } = ctx;
  const byHouse = new Map();
  for (const r of ctx.rooms) if (r.zoo && (r.den || r.zoo === "crush") && !r.scene) { const k = r.house ?? -1; if (!byHouse.has(k)) byHouse.set(k, []); byHouse.get(k).push(r); }
  for (const k of rng.shuffle([...byHouse.keys()])) {
    const dens = byHouse.get(k);
    let opened = 0, last = null;
    for (const r of dens) {
      const f = r.f || 0;
      for (const [dx, dy] of r.doors || []) { const c = ctx.at(f, dx, dy); if (c && (c.k === "door" || c.k === "idoor")) { c.k = "odoor"; delete c.locked; ctx.take(f, dx, dy); } }
      r.locked = false;
      const free = ctx.freeIn(r);
      if (!free.length) continue;
      const [x, y] = rng.pick(free);
      ctx.blood(f, x, y, "human", rng.int(1, 2));
      if (r.doors && r.doors[0]) ctx.trail(f, x, y, r.doors[0][0], r.doors[0][1], "human");
      opened++; last = r;
    }
    if (!opened || !last) continue;
    const p = ctx.freeIn(last)[0];
    if (p) ctx.pile(last.f || 0, p[0], p[1], "A keeper's clipboard: feeding times, then \"LET THEM OUT\" in capitals", {}, last.id);
    const house = String(last.name || "").split(", ").slice(1).join(", ") || "the animal house";
    return ctx.done("emptycages", last, p ? p[0] : last.x0 + 1, p ? p[1] : last.y0 + 1, `${house}: ${opened} ${opened === 1 ? "den stands" : "dens stand"} open and empty. Someone let them out, or something did.`);
  }
  return null;
}
function keepersStand(ctx) {
  const { rng } = ctx;
  for (const r of zooRooms(ctx, (q) => q.zoo === "keeperroom" && !q.locked && (q.doors || []).length >= 1)) {
    const f = r.f || 0, [dx, dy] = r.doors[0];
    const door = ctx.at(f, dx, dy);
    if (!door || !["idoor", "odoor"].includes(door.k) || ctx.exit(dx, dy, f)) continue;
    const inn = NEXT4.map(([ox, oy]) => [dx + ox, dy + oy]).find(([x, y]) => x > r.x0 && x < r.x0 + r.w - 1 && y > r.y0 && y < r.y0 + r.h - 1);
    const out = inn ? [2 * dx - inn[0], 2 * dy - inn[1]] : null;
    if (!inn || !out) continue;
    const free = ctx.freeIn(r).filter(([x, y]) => x !== inn[0] || y !== inn[1]);
    if (free.length < 3) continue;
    // The door boarded over and a piece dragged against it inside.
    delete door.blood;
    door.k = "idoor";
    boardCell({ units: [], losCache: { fill() {} } }, door, dx, dy);
    ctx.take(f, dx, dy);
    ctx.out.pieces.push({ f, x: dx, y: dy, k: "boarded" });
    const ic = ctx.at(f, inn[0], inn[1]);
    if (ic && ic.k === "open" && !ctx.stair(inn[0], inn[1])) ctx.piece(f, inn[0], inn[1], "table");
    // The keepers inside, the dart rifle's case by them; the dead they took outside the door.
    const n = rng.int(1, 2);
    const spots = rng.shuffle(free).slice(0, n + 1);
    for (const [x, y] of spots.slice(0, n)) { ctx.body(f, x, y, { human: true, name: "A keeper" }); ctx.splatter(f, x, y, "human", 2); }
    const [px, py] = spots[n] || spots[0];
    ctx.pile(f, px, py, "The dart rifle's case, empty but for the spare darts and the sedative vials", { meds: rng.int(1, 2) }, r.id, rng.chance(0.6) ? ["tranqdarts"] : []);
    const oc = ctx.at(f, out[0], out[1]);
    const dead = rng.int(2, 4);
    if (oc && oc.k === "open") {
      ctx.body(f, out[0], out[1], {}); ctx.splatter(f, out[0], out[1], "zombie", 2);
      let left = dead - 1;
      for (const [ox, oy] of rng.shuffle(NEXT4.slice())) { if (left <= 0) break; const x = out[0] + ox, y = out[1] + oy; if (ctx.free(f, x, y)) { ctx.body(f, x, y, {}); left--; } }
    }
    return ctx.done("keepersstand", r, inn[0], inn[1], `The keepers made their last stand in the ${lower(r)}: the door boarded over, ${n === 1 ? "one of them" : "two of them"} inside, and the dead they put down outside it.`);
  }
  return null;
}
function escaped(ctx) {
  const { rng, map } = ctx;
  const P = map.plan || {};
  const encs = rng.shuffle((P.grounds || []).filter((g) => g.kind === "enclosure" && !g.broken && g.fence && g.fence.length));
  for (const g of encs) {
    // A stretch of its fence torn down (the cells open ground again), the gate left wide.
    const at = rng.int(0, g.fence.length - 1), len = Math.min(g.fence.length, rng.int(3, 6));
    let torn = 0;
    for (let i = 0; i < len; i++) { const [x, y] = g.fence[(at + i) % g.fence.length], c = ctx.at(0, x, y); if (c && (c.k === "fence" || c.k === "pfence" || c.k === "wirefence")) { c.k = "open"; c.f = "dirt"; delete c.hedge; ctx.take(0, x, y); ctx.out.pieces.push({ f: 0, x, y, k: "open" }); torn++; } }
    if (!torn) continue;
    if (g.gate) { const c = ctx.at(0, g.gate[0], g.gate[1]); if (c && c.k === "fieldgate") { c.open = true; ctx.take(0, g.gate[0], g.gate[1]); } }
    const inside = [];
    for (let i = 0; i < 40 && inside.length < 2; i++) { const x = rng.int(g.x0 + 2, g.x0 + g.w - 3), y = rng.int(g.y0 + 2, g.y0 + g.h - 3); if (ctx.free(0, x, y)) inside.push([x, y]); }
    if (inside[0]) ctx.pile(0, inside[0][0], inside[0][1], `The remains of ${g.animal ? g.animal.toLowerCase() : "an animal"}: bones picked clean, a torn tracking collar`, {}, null);
    if (g.gate && inside[1] && rng.chance(0.6)) { const [x, y] = inside[1]; ctx.body(0, x, y, { human: true, name: "A keeper" }); }
    g.broken = true;
    const [fx, fy] = g.fence[at];
    return ctx.done("escaped", null, fx, fy, `The ${g.name.toLowerCase()} has been broken open: ${torn} metres of its fence torn down${g.gate ? " and the keepers' gate standing wide" : ""}. Whatever was kept there is loose.`);
  }
  return null;
}
const hasZoo = (test) => (ctx) => ctx.rooms.some(test);
registerScene("emptycages", { w: 4, place: emptyCages, kinds: ["zoo"], when: hasZoo((r) => !!(r.zoo && r.den)) });
registerScene("keepersstand", { w: 3, place: keepersStand, kinds: ["zoo"], when: hasZoo((r) => r.zoo === "keeperroom") });
registerScene("escaped", { w: 4, place: escaped, kinds: ["zoo"], when: (ctx) => !!(ctx.map.plan && (ctx.map.plan.grounds || []).some((g) => g.kind === "enclosure")) });
