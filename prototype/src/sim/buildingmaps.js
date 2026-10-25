// Building interiors for raids: exploring a building opens its own map, generated from the kind of building (a house,
// a shop, a supermarket, a clinic or hospital, a police station, a school, offices, a warehouse, a barn...), with rooms,
// corridors, doors, windows, furniture to hide behind and containers to search, and a little of the outside around it
// (the street and parking at the front, an alley or a yard at the back).
//
// The map (assemble):
//   - the building: a footprint split into rooms by an archetype's floor plan (a tree of splits, front to back and side
//     to side, so every plan varies with the dice), rooms with roles from ROLES (a kitchen, a stockroom, a ward...) and a
//     loot type from combat.js AREAS (the same loot tables as the street raid's buildings: a room is a raid "area");
//   - doors: a spanning tree over the rooms (rooms open onto the hubs: halls, corridors, the sales floor, a lobby), a
//     few extra doors; a closed door (idoor) blocks sight until someone walks through it (then it is open, odoor);
//   - exits: the front entrance always; back doors, side doors, loading docks and bay doors (roller doors, loud to
//     haul up) by archetype. Each exit has an extraction zone at the map edge outside it; the team comes in at the
//     front (the vehicle waits in the front zone). Some side and back exits are locked (locks.js: open them from
//     either side like any lock);
//   - locked rooms (an armory, a pharmacy's dispensary, an evidence room, a gun cage...) whose doors are locked door
//     cells (locks.js), and locked containers inside (lockKind: always locked, by the archetype's dice);
//   - windows on the outer walls: seen through, half cover, climbed through (Climb, combat.js: the glass breaks,
//     Heat +3 and noise); a few already smashed (open);
//   - storeys (docs/multi-storey-crawl.md): most building types have several floors (spec.storeys, by type: a house
//     2, an office tower 3–8 on a footprint that shrinks as it grows, a hospital 3–5, a supermarket 1–2...). Every
//     floor is its own grid the size of the ground map (result.floors[f] = { cells, name }; outside the footprint an
//     upper floor is "void": open air), with rooms rolled from the archetype's spec.upper(f) plan (a lobby and shops
//     below, offices above, a plant room on top; flats on every floor; wards above the pharmacy), doors, windows and
//     containers of its own (containers and rooms carry f). One or two stairwells at fixed (x, y) are "stairs" cells
//     on every floor; combat.js setFloor swaps the active floor and the Go up / Go down actions take the stairs. A
//     barn keeps its hayloft the old way (spec.loft: rooms raised one level, loft cells up a ladder, on one grid).
// The layout is the site's own: the same building at the same site has the same floor plan every visit (its dice come
// from the world seed, the tile and the building). The dead, the guards and who else is inside (wanderers.js
// interiorOccupants) are placed by the world's dice when the raid starts.
//
// Which buildings a site has (SITES): single-building sites (a pharmacy, a gun store, a police station...) open straight
// into their interior; towns, cities, farms, bases, prisons, malls... offer a choice of building before the raid (or the
// street map as before); open country, campgrounds and crash sites keep the street map. A neighbourhood (a point of
// interest, pois.js) opens a street of 3–5 houses on one map (streetMap). Headless (scavenge.js) the search stays
// hour by hour and never needs a map.
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";
import { interiorOccupants } from "./wanderers.js";
import { AREAS, CELL, KITS, WEAPONS, RAID_W, RAID_H, enemyUnit, occupantSide, los, active, alertPod, setFloor, placeVehicle, placeCar, removeCar, CAR_LEN } from "./combat.js"; // placeCar: cars are 2 × 3–4 cells
import { siteDanger, GEAR } from "./data.js";
import { lootItem } from "./inventory.js";
import { kitSource } from "./itemcond.js";
import { armPerson } from "./fighters.js";
import { armFromArsenal } from "./arsenal.js"; // a person given the weapon the occupants list names
import { noiseAt, detectRange, isBehind, throwablesOf, THROWABLES } from "./stealth.js";
import { FRANCHISES } from "./data-shops.js"; // a franchise's layout (plan): the floor, the front room's depth and name, the width, a flat above
import { applyZType, siteList } from "./zombietypes.js";
import { fitMargins, buildingTarget, densifyOutside, densify, coverTarget, buildingDeadScale, streetDeadScale, raidMaxDims, raidDims, SIZE_CLASSES } from "./battlesize.js";
import { legacyRaids, legacyRooms } from "./worldcfg.js"; // an older save: a neighbourhood's street laid out as it always was; its buildings furnished as they were
import { roomLayout, homeStyle, medicalStyle, LAYOUT } from "./roomlayout.js"; // homes furnished room by room (the placement helpers); hospitals, clinics and vets too (#14)
import { commercialStyle, styleName as shopStyleName } from "./shoplayout.js"; // shops, restaurants, bars, offices, motels, banks and big stores laid out for their kind (issue #16)
import { civicStyle } from "./civiclayout.js"; // police stations, fire stations, schools and churches laid out for their kind (issue #15)
import { decorate, flipDecoY, placeDecorPieces } from "./decor.js"; // rugs, clutter, wall art, wall colours, light fixtures (cosmetic)
import { rollWin, winMixOf, windowOpen } from "./windows.js"; // the windows' states (open, locked, fixed), a throw through an open one
import { rollScenes, sceneRng } from "./interiorscenes.js"; // signs of survival: barricades, blood, bodies (dice of their own)
import { pickLayout, settingOfTile, layoutName } from "./buildvariants.js"; // every type's layout variants (issue #32): which plan a building takes, its name

export const BMAP = {
  MARGIN: { front: 5, back: 4, left: 4, right: 4 }, // cells of outside around the building
  ZONE: 3,             // extraction zones are 3 × 3 at the map edge
  WINDOW_GAP: 3,       // a window every few cells of outer wall
  SMASHED: 0.06,       // a window already broken (walkable)
  OPEN_DOOR: 0.3,      // an inner door left open
  EXTRA_DOOR: 0.15,    // a second door between two rooms
  CLIMB: { ap: 1, heat: 3, radius: 6 },   // climbing through a window (combat.js "climb")
  ROLLER: { heat: 3, radius: 8 },         // hauling a roller door up
  DEAD_SCALE: [0.35, 0.85],               // the dead at a site × the map's area over the street raid's, clamped (indoors they are closer together); past the old Large 40 × 30 more with the ground (battlesize.js BIG)
  OUTSIDE_DEAD: 0.25,  // share of the dead outside the building
  LOCKED_DEAD: 0.15,   // chance one of the dead is shut in a locked room (one a room)
  CUT_R: 6,            // the isometric cutaway: walls lowered within this many tiles of your people
  // Storeys: a second stairwell from this footprint area (cells); the dead inside a multi-storey building: this share
  // on the ground floor, the rest spread over the upper floors, where this share of them wait by the stairwell.
  STOREY: { twoStairs: 220, dead: { ground: 0.55, stairs: 0.3 } },
  // Doors' hit points (the dead batter a closed door: a claw blow does about 10–16; people open it unless it is braced
  // or locked, then they kick or shoot it in): an inner door, an outer one, a roller door, a cell door, a locked
  // door, a steel security door.
  DOOR: { inner: 30, outer: 45, roller: 70, cell: 60, locked: 160, vault: 240 }, // a locked door holds the dead a good while (claws 12-20 a blow: about ten); the fallback for a door cell with no kind (c.dk: DOOR_KINDS)
  BRACE: 0.5,          // a door braced from the other side takes this share of each blow (Brace: the rest of the turn)
  DOOR_NOISE: { radius: 7, noise: 0.5 }, // each blow on a door: earshot (the dead and guards come to look) and noise (Heat)
  // Peeking through a door (free, once a turn a unit): see from the far side of it, this far; an unaware guard who
  // faces it and would notice you there catches you NOTICE − PER_STEALTH a Stealth point (at least MIN); the dead
  // within DEAD_NEAR tiles DEAD_NOTICE.
  PEEK: { range: 8, notice: 0.35, perStealth: 0.025, min: 0.05, deadNotice: 0.2, deadNear: 2 },
  WALL_DAMP: 3,        // inside, each wall or closed door between a noise and a listener counts as this many tiles more
  DIVERT_NEAR: 3,      // the dead after you turn to a thrown noise unless one of your people is this close and in sight
};
// ---------- the kinds of door (the user's request 2026-10-17) ----------
// A door cell carries its kind (c.dk) and everything follows from it: its hit points (hp: the dead batter it, combat.js
// bash), whether it is seen through when closed (see: combat.js los doorSees; a glass door, a screen door, a cell's
// bars), its lock's difficulty when locked (diff: locks.js openOdds; lock false: never locked), whether it can be
// kicked in without a crowbar (kick; force false: not forced at all, pick it or find the key), whether it goes with a
// crash (glass: breakCell), and the sound it makes (sfx: ui/sfx-doors.js doorKind). A door cell with no kind (an old
// save, a map made before) behaves as before: BMAP.DOOR by its place, wood or front by the sound's own rules.
export const DOOR_KINDS = {
  screen:   { name: "Screen door", hp: 10, see: true, lock: false, kick: true, sfx: "screen", desc: "flimsy mesh on a spring: seen through, slams, no lock" },
  wood:     { name: "Door", hp: 30, see: false, diff: 2, kick: true, sfx: "wood", desc: "an inner door" },
  front:    { name: "Front door", hp: 45, see: false, diff: 2, kick: true, sfx: "front", desc: "a solid outer door" },
  glass:    { name: "Glass door", hp: 20, see: true, diff: 1, kick: true, glass: true, sfx: "glass", desc: "a shop's or a patio's: seen through, an easy lock, breaks with a crash" },
  steel:    { name: "Steel door", hp: 60, see: false, diff: 2, kick: true, sfx: "metal", desc: "a fire door with a push bar" },
  security: { name: "Security door", hp: 90, see: false, diff: 3, kick: false, force: false, sfx: "metal", desc: "steel in a steel frame: not kicked or forced, a hard lock" },
  roller:   { name: "Roller door", hp: 70, see: false, diff: 2, kick: true, loud: true, sfx: "roller", desc: "a garage's: loud to haul up or down" },
  cell:     { name: "Cell door", hp: 60, see: true, diff: 2, kick: false, sfx: "cell", desc: "barred steel: seen through" },
  barred:   { name: "Barred door", hp: 45, see: false, kick: true, sfx: "barred", desc: "a base building's, barred from inside" },
  gate:     { name: "Gate", hp: 100, see: false, kick: false, sfx: "gate", desc: "a base's gate" },
  vault:    { name: "Steel security door", hp: 240, see: false, diff: 3, kick: false, sfx: "vault", desc: "an armory's or a gun cage's" },
  coldroom: { name: "Cold room door", hp: 50, see: false, diff: 2, kick: true, sfx: "metal", desc: "a walk-in's insulated steel door" }, // a school kitchen's walk-in (issue #15)
};
// A closed door seen through (combat.js los): a glass door, a screen door, a cell's bars.
export const doorSees = (c) => !!c && (c.k === "idoor" || c.k === "door") && !!c.dk && !!DOOR_KINDS[c.dk] && !!DOOR_KINDS[c.dk].see;
// The kinds by archetype: the front door, the back door (a list: by the dice), a side door. A roller door is always a
// roller, an inner door wood (a cell block's cells a cell door), a locked room's door wood.
const DOOR_STYLE = {
  house:  { front: "front", back: ["screen", "glass", "screen"], side: "front" }, // a screen or a patio door at the back
  shop:   { front: "glass", back: "steel", side: "steel" },
  office: { front: "glass", back: "steel", side: "steel" },
  secure: { front: "security", back: "security", side: "security" }, // police, the military, a gun store, a control room
  works:  { front: "steel", back: "steel", side: "steel" },
  barn:   { front: "wood", back: "wood", side: "wood" },
  church: { front: "front", back: "front", side: "front" },
};
const STYLE_OF = {
  house: "house", farmhouse: "house", cabin: "house", lodge: "house", ranger: "house", motel: "house", neighbourhood: "house",
  sportshop: "shop", electronics: "shop", radioshop: "shop", bookstore: "shop", petstore: "shop", garden: "shop", clothing: "shop", liquor: "shop", restaurant: "shop", bar: "shop", dealer: "shop", library: "office", vet: "office",
  grocery: "shop", corner: "shop", pharmacy: "shop", hardware: "shop", feedstore: "shop", diner: "shop", gasstation: "shop", truckstop: "shop", supermarket: "shop", deptstore: "shop",
  clinic: "office", infirmary: "office", hospital: "office", school: "office", offices: "office", lab: "office", terminal: "office", apartments: "office",
  gunstore: "secure", pawnshop: "secure", bank: "secure", police: "secure", barracks: "secure", armorybldg: "secure", cellblock: "secure", control: "secure",
  firestation: "works", messhall: "works", radio: "works", warehouse: "works", factory: "works", hangar: "works", motorpool: "works", autoshop: "works", garage: "works", workshop: "works", machineshed: "works",
  barn: "barn", church: "church",
};
export const doorStyleOf = (key) => DOOR_STYLE[STYLE_OF[key] || "house"];
// Risk pays (raids on the map: what containers hold × this): by the site's danger (data.js siteDanger: the
// countryside 0, small towns 1, city blocks 2, hospitals, prisons and bases 3); open land with no site WILDS.
export const REWARD = { byDanger: [0.6, 0.9, 1.3, 1.5], wilds: 0.55 };
export function rewardMult(tile) {
  if (!tile) return 1;
  if (!tile.loc) return REWARD.wilds;
  return REWARD.byDanger[siteDanger(tile.loc)] ?? 1;
}

// ---------- room roles ----------
// name, type (combat.js AREAS: what its containers hold; null: nothing to search), furnish (FURNISH), hub (rooms open
// onto it: halls, corridors, the sales floor), label (its name on the map), windows (on its outer walls), fl (the floor:
// wood, tile, conc, carpet, dirt; since 2026-10-25 also hardwood, plank, lino, checker, rubber, steel: issue #13, drawn
// by ui/isoview.js floorColor), maxBoxes. Decor by role (rugs, clutter, wall art, wall colours, lights): decor.js DECOR.
const role = (name, type, furnish, extra = {}) => ({ name, type, furnish, ...extra });
export const ROLES = {
  hall:        role("Hallway", null, "none", { hub: true, label: false, fl: "hardwood" }),
  corridor:    role("Corridor", null, "none", { hub: true, label: false, fl: "lino" }),
  foyer:       role("Entry hall", "office", "lobby", { hub: true, fl: "tile", maxBoxes: 1 }),
  living:      role("Living room", "house", "living", { hub: true, fl: "hardwood" }),
  dining:      role("Dining room", "house", "dining", { fl: "hardwood" }),
  kitchen:     role("Kitchen", "kitchen", "kitchen", { fl: "lino" }),
  bedroom:     role("Bedroom", "house", "bedroom", { fl: "hardwood", maxBoxes: 2 }),
  bath:        role("Bathroom", "house", "bath", { fl: "checker", maxBoxes: 1 }),
  restroom:    role("Restroom", null, "none", { fl: "tile", label: false, windows: false }),
  pantry:      role("Pantry", "kitchen", "shelves", { fl: "plank", maxBoxes: 2, windows: false }),
  hgarage:     role("Garage", "garage", "bays", { fl: "conc", maxBoxes: 3 }),
  greatroom:   role("Great room", "cabin", "living", { hub: true, fl: "plank" }),
  bunk:        role("Bunk room", "cabin", "beds", { fl: "plank", maxBoxes: 2 }),
  gunroom:     role("Gun room", "cabin", "armory", { fl: "plank", windows: false, maxBoxes: 3 }),
  storage:     role("Storage", "warehouse", "shelves", { fl: "conc", maxBoxes: 3 }),
  sales:       role("Sales floor", "store", "aisles", { hub: true, fl: "tile", maxBoxes: 7 }),
  stock:       role("Stockroom", "store", "shelves", { fl: "conc", maxBoxes: 4 }),
  office:      role("Office", "office", "office", { fl: "carpet", maxBoxes: 2 }),
  dispensary:  role("Dispensary", "pharmacy", "shelves", { fl: "tile", windows: false, maxBoxes: 3 }),
  lobby:       role("Lobby", "office", "lobby", { hub: true, fl: "tile", maxBoxes: 1 }),
  ward:        role("Ward", "clinic", "beds", { fl: "lino", maxBoxes: 3 }),
  exam:        role("Exam room", "clinic", "exam", { fl: "lino", maxBoxes: 2 }),
  pharmroom:   role("Pharmacy", "pharmacy", "shelves", { fl: "tile", windows: false, maxBoxes: 3 }),
  armory:      role("Armory", "armory", "armory", { fl: "conc", windows: false, maxBoxes: 4 }),
  evidence:    role("Evidence room", "office", "shelves", { fl: "conc", windows: false, maxBoxes: 3 }),
  cells:       role("Cell block", "cellblock", "cells", { fl: "conc", maxBoxes: 3 }),
  bays:        role("Service bays", "garage", "bays", { hub: true, fl: "steel", maxBoxes: 5 }),
  parts:       role("Parts room", "workshop", "shelves", { fl: "conc", maxBoxes: 3 }),
  classroom:   role("Classroom", "office", "classroom", { fl: "lino", maxBoxes: 2 }),
  gym:         role("Gym", "lockers", "gym", { fl: "rubber", maxBoxes: 2 }),
  lockerroom:  role("Locker room", "lockers", "lockers", { fl: "tile", maxBoxes: 3 }),
  nurse:       role("Nurse's office", "nurse", "exam", { fl: "lino", maxBoxes: 2 }), // first aid only (medfinds.js)
  cafeteria:   role("Cafeteria", "kitchen", "dining", { hub: true, fl: "checker", maxBoxes: 3 }),
  breakroom:   role("Break room", "kitchen", "kitchen", { fl: "lino", maxBoxes: 2 }),
  warefloor:   role("Warehouse floor", "warehouse", "racks", { hub: true, fl: "conc", maxBoxes: 8 }),
  factoryfloor: role("Factory floor", "workshop", "machines", { hub: true, fl: "conc", maxBoxes: 7 }),
  barnfloor:   role("Barn floor", "barn", "barn", { hub: true, fl: "dirt", maxBoxes: 4 }),
  tack:        role("Tack room", "barn", "shelves", { fl: "plank", maxBoxes: 2 }),
  hayloft:     role("Hayloft", "barn", "hay", { fl: "plank", maxBoxes: 2 }),
  nave:        role("Nave", "chapel", "pews", { hub: true, fl: "wood", maxBoxes: 2 }),
  vestry:      role("Vestry", "chapel", "office", { fl: "carpet", maxBoxes: 2 }),
  dorm:        role("Dormitory", "barracks", "beds", { fl: "tile", maxBoxes: 3 }),
  mess:        role("Mess hall", "kitchen", "dining", { hub: true, fl: "lino", maxBoxes: 3 }),
  motor:       role("Motor pool", "motorpool", "bays", { hub: true, fl: "conc", maxBoxes: 6 }),
  hangarfloor: role("Hangar floor", "hangar", "hangar", { hub: true, fl: "conc", maxBoxes: 6 }),
  terminal:    role("Terminal hall", "store", "benches", { hub: true, fl: "tile", maxBoxes: 4 }),
  control:     role("Control room", "control", "control", { fl: "tile", maxBoxes: 3 }),
  workshop:    role("Workshop", "workshop", "workbench", { fl: "conc", maxBoxes: 3 }),
  lab:         role("Lab", "lab", "lab", { fl: "tile", maxBoxes: 3 }),
  motelroom:   role("Room", "house", "bedroom", { fl: "carpet", maxBoxes: 2 }),
  reception:   role("Front desk", "office", "lobby", { hub: true, fl: "tile", maxBoxes: 1 }),
  apt:         role("Apartment", "house", "apartment", { fl: "hardwood", maxBoxes: 3 }),
  dayroom:     role("Day room", "house", "living", { hub: true, fl: "hardwood" }),
  stairwell:   role("Stairwell", null, "none", { fl: "conc" }), // a stair run's own room (flats, offices: spec.stairs), one door a floor
  // The hospitals, clinics and vets room by room (issue #14: roomlayout.js MEDICAL_STYLES; new saves only).
  er:          role("Emergency", "clinic", "exam", { fl: "lino", maxBoxes: 4 }),
  icu:         role("ICU", "clinic", "beds", { fl: "lino", maxBoxes: 2 }),
  theatre:     role("Operating theatre", "clinic", "exam", { fl: "tile", windows: false, maxBoxes: 3 }),
  morgue:      role("Morgue", "clinic", "shelves", { fl: "tile", windows: false, maxBoxes: 4 }),
  ambbay:      role("Ambulance bay", "clinic", "bays", { fl: "conc", maxBoxes: 2 }),
  nursestation: role("Nurses' station", "clinic", "office", { fl: "lino", maxBoxes: 3 }),
  laundry:     role("Laundry", null, "none", { fl: "tile", windows: false }),
  staffroom:   role("Staff room", "kitchen", "kitchen", { fl: "lino", maxBoxes: 2 }),
};

// ---------- the outside ----------
// yard: the sides; walk: the strip in front of the building; street: the front beyond it; alley: behind.
const GROUNDS = {
  town:  { yard: "grass", walk: "gravel", street: "road", alley: "dirt" },
  city:  { yard: "rubble", walk: "gravel", street: "road", alley: "gravel" },
  rural: { yard: "grass", walk: "dirt", street: "dirt", alley: "dirt" },
  farm:  { yard: "field", walk: "dirt", street: "dirt", alley: "dirt" },
  woods: { yard: "grass", walk: "dirt", street: "grass", alley: "grass" },
  lot:   { yard: "gravel", walk: "gravel", street: "road", alley: "gravel" },
  base:  { yard: "dirt", walk: "gravel", street: "road", alley: "dirt" },
};

// ---------- the archetypes ----------
// Each makes a spec for assemble from its dice: the footprint (bw × bh, outer walls included), the floor plan (a tree:
// { split: "x" | "y", parts: [[size, child]...] } with leaves { role, ...overrides }; a size is cells (≥ 1), a share
// of the room (< 1) or "*" for the rest; "y" parts go from the front (the street side, the bottom) to the back, "x"
// parts from left to right), the front door (width, roller), exits ({ side: back | left | right | front, roles,
// chance, lock: the chance it is locked, width, roller }), the storeys (storeys: how many floors; upper(f, rng, ctx):
// the plan of floor f ≥ 1, ctx { top, storeys, bw, bh }; foot: the footprint class the tests check, "small" |
// "medium" | "large" | "wide" | "tower"), a raised loft on one grid (loft: { roles, chance, ladder }: barns) and the
// outside. make(rng, opts) takes opts.storeyBonus (the city crawl: deeper blocks are taller) for offices and apartments.
// A leaf can set entry (the front door opens into it), lock: [lock kind, chance] (a locked room, locks.js LOCKS),
// boxLock: [lock kind, chance] (its containers locked), name, type.
const sideRoom = (rng) => (rng.chance(0.5) ? "left" : "right");
const leaves = (list) => list.map(([s, r]) => [s, typeof r === "string" ? { role: r } : r]);
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
// A franchise's layout (data-shops.js FRANCHISES plan) by the building's kind and the place's franchise (opts.variant:
// shops.js poi.v, a crawl place's v); {} for none (the building as it always was).
/** @param {string} kind @param {any} [o] @returns {import("./data-shops.js").Plan} */
const planOf = (kind, o) => { const id = o && o.variant; const f = id ? (FRANCHISES[(o && o.kind) || kind] || []).find((x) => x.id === id) : null; return f ? { ...(f.plan || {}), look: f.look } : {}; }; // o.kind: the place's kind when its building is another's archetype (a pizza place is a diner)
/** The front room with the franchise's floor and name over it. @param {any} leaf @param {any} plan */
const withPlan = (leaf, plan) => (leaf && leaf.role ? { ...leaf, ...(plan.fl ? { fl: plan.fl } : {}), ...(plan.room ? { name: plan.room } : {}), ...(plan.look ? { wallc: plan.look.wall } : {}) } : leaf); // wallc: its inside walls in the franchise's colour (decor.js)
export const MAX_STOREYS = 8;

// o.legacy: an older save's plan (worldcfg.js legacyRooms). Since rooms are furnished room by room (roomlayout.js) a
// kitchen keeps room for its fridge, sink and stove: a farmhouse's pantry only when it is wide enough, and a house's or
// a ranger station's garage takes the ground floor's bath (upstairs has one) or the supply room rather than squeezing
// the kitchen to two cells. The dice are rolled as before either way.
function house(rng, v, o = {}) {
  const lay = pickLayout(v, rng.state, o, null, o.allow || (o.street ? STREET_HOUSES : null)); // the layout variant (issue #32; none in an older save); allow: a street's own mix
  if (lay && HOME_PLANS[v] && HOME_PLANS[v][lay.id]) return { ...HOME_PLANS[v][lay.id](rng, o), variant: lay };
  const roomy = !o.legacy;
  const big = v === "farmhouse" || v === "lodge";
  const bw = v === "cabin" ? rng.int(8, 10) : v === "lodge" ? rng.int(15, 18) : v === "farmhouse" ? rng.int(12, 15) : v === "ranger" ? rng.int(12, 14) : rng.int(11, 14);
  const bh = v === "cabin" ? rng.int(7, 8) : v === "lodge" ? rng.int(11, 13) : v === "farmhouse" ? rng.int(10, 12) : rng.int(9, 11);
  const ih = bh - 2;
  let front, back;
  if (v === "cabin") {
    front = { role: "greatroom", entry: true };
    back = { split: "x", parts: leaves([["*", "bedroom"], [rng.int(2, 3), rng.chance(0.5) ? "bath" : { role: "storage", name: "Storeroom", type: "cabin" }]]) };
  } else if (v === "lodge") {
    front = { split: "x", parts: leaves([[0.6, { role: "greatroom", entry: true }], ["*", "kitchen"]]) };
    back = { split: "x", parts: leaves([["*", "bunk"], [rng.int(3, 4), { role: "gunroom", lock: ["door", 0.5], boxLock: ["locker", 0.4] }], ["*", "bunk"], [2, "bath"]]) };
  } else if (v === "ranger") {
    front = { split: "x", parts: leaves([[0.55, { role: "office", name: "Ranger office", entry: true, hub: true }], ["*", { role: "storage", name: "Supply room", type: "cabin", lock: ["door", 0.4] }]]) };
    back = { split: "x", parts: leaves([["*", "bunk"], ["*", "kitchen"]]) };
  } else {
    const farm = v === "farmhouse";
    front = { split: "x", parts: leaves([[0.55, { role: "living", entry: true, type: farm ? "farmhouse" : "house" }], ["*", farm ? { role: "dining", type: "farmhouse" } : "bedroom"]]) };
    back = { split: "x", parts: leaves(farm ? [["*", { role: "kitchen" }], ...(roomy && bw < 14 ? [] : [[2, "pantry"]]), [2, "bath"], ["*", { role: "bedroom", type: "farmhouse" }]] : [["*", "kitchen"], [2, "bath"], ["*", "bedroom"]]) };
  }
  const hall = v !== "cabin" && ih >= 8;
  const plan = () => (hall ? { split: "y", parts: [["*", front], [1, { role: "hall" }], ["*", back]] } : { split: "y", parts: [["*", front], ["*", back]] });
  let program = plan();
  const exits = [];
  if (v === "house" && bw >= 12 && rng.chance(0.4)) {
    const left = rng.chance(0.5);
    if (roomy) { front = { role: "living", entry: true, type: "house" }; back = { role: "kitchen" }; program = plan(); } // the bedrooms upstairs
    const g = [4, { role: "hgarage" }];
    program = { split: "x", parts: left ? [g, ["*", program]] : [["*", program], g] };
    exits.push({ side: "front", roles: ["hgarage"], chance: 1, roller: true, width: 2, lock: 0.2 });
  }
  if (v === "ranger" && rng.chance(0.5)) {
    const left = rng.chance(0.5), g = [4, { role: "hgarage", type: "garage" }];
    if (roomy) { front = { split: "x", parts: leaves([[0.55, { role: "office", name: "Ranger office", entry: true, hub: true }], ["*", "bunk"]]) }; back = { role: "kitchen" }; program = plan(); }
    program = { split: "x", parts: left ? [g, ["*", program]] : [["*", program], g] };
    exits.push({ side: "front", roles: ["hgarage"], chance: 1, roller: true, width: 2, lock: 0.3 });
  }
  exits.push({ side: "back", roles: ["kitchen", "hall", "greatroom", "bunk", "storage", "pantry"], chance: v === "cabin" ? 0.45 : 0.85, lock: 0.15 });
  exits.push({ side: sideRoom(rng), roles: ["living", "dining", "greatroom", "kitchen", "hall", "bedroom"], chance: big ? 0.4 : 0.2, lock: 0.25 });
  // Upstairs (houses, farmhouses, lodges): bedrooms and a bathroom off a landing (the hall, where the ground floor has one).
  const two = v === "house" || v === "farmhouse" || v === "lodge";
  const upper = () => (v === "lodge"
    ? { split: "y", parts: [["*", { split: "x", parts: leaves([["*", "bunk"], ["*", "bunk"]]) }], [1, { role: "hall", name: "Landing" }], ["*", { split: "x", parts: leaves([["*", "bunk"], [2, "bath"], [3, { role: "storage", name: "Store", type: "cabin" }]]) }]] }
    : hall
      ? { split: "y", parts: [["*", { split: "x", parts: leaves([["*", "bedroom"], [2, "bath"]]) }], [1, { role: "hall", name: "Landing" }], ["*", { split: "x", parts: leaves([["*", "bedroom"], ["*", "bedroom"]]) }]] }
      : { split: "y", parts: [["*", { split: "x", parts: leaves([["*", "bedroom"], [2, "bath"]]) }], ["*", { split: "x", parts: leaves([["*", "bedroom"], [3, { role: "storage", name: "Box room", type: "house" }]]) }]] });
  return {
    bw, bh, program, exits, front: { width: 1 }, openDoors: 0.4, extraDoors: 0.2,
    storeys: two ? 2 : 1, upper: two ? upper : null, foot: big ? "medium" : "small",
    stairs: { roles: ["hall", "living", "greatroom", "dining"], near: "front" }, // up from the hall (else the front room) by the front door
    ground: v === "farmhouse" ? "farm" : v === "cabin" || v === "lodge" || v === "ranger" ? "woods" : "town",
    ...(lay ? { variant: lay } : {}),
  };
}

// ---------- the homes' layout variants (issue #32: buildvariants.js LAYOUTS; the classic is house() above) ----------
// The house's layouts that fit a neighbourhood's street (streetMap: 10–14 cells wide, 10 deep at most).
const STREET_HOUSES = ["twostorey", "ranch", "colonial", "mobile"];
const Rm = (role, o = {}) => ({ role, ...o }); // a plan leaf
const upHall = (front, back) => ({ split: "y", parts: [["*", { split: "x", parts: leaves(front) }], [1, { role: "hall", name: "Landing" }], ["*", { split: "x", parts: leaves(back) }]] });
const HOME_PLANS = {
  house: {
    // One storey, long: the living room, dining room and kitchen across the front, a hall, the bedrooms and the bath
    // behind it; a garage at one end now and then (its roller door to the drive).
    ranch(rng, o) {
      const bw = o.street ? 14 : rng.int(16, 20), bh = rng.int(9, 10), exits = [];
      let program = { split: "y", parts: [["*", { split: "x", parts: leaves([[0.4,Rm("living", { entry: true, type: "house" })], ["*", "dining"], ["*", "kitchen"]]) }], [1,Rm("hall")], ["*", { split: "x", parts: leaves([["*", "bedroom"], [2, "bath"], ["*", "bedroom"], ["*", "bedroom"]]) }]] };
      if (!o.street && rng.chance(0.5)) { const g = [4,Rm("hgarage")], left = rng.chance(0.5); program = { split: "x", parts: left ? [g, ["*", program]] : [["*", program], g] }; exits.push({ side: "front", roles: ["hgarage"], chance: 1, roller: true, width: 2, lock: 0.2 }); }
      exits.push({ side: "back", roles: ["kitchen", "hall"], chance: 0.85, lock: 0.15 }, { side: sideRoom(rng), roles: ["living", "bedroom", "hall"], chance: 0.3, lock: 0.25 });
      return { bw, bh, program, exits, front: { width: 1 }, openDoors: 0.4, extraDoors: 0.2, storeys: 1, foot: "medium", ground: "town" };
    },
    // Two storeys about a centre hall: the parlour and the study one side, the dining room and the kitchen the other;
    // upstairs the bedrooms either side of the landing, the bathroom at its end.
    colonial(rng, o) {
      const bw = o.street ? rng.int(12, 14) : rng.int(13, 15), bh = o.street ? 10 : rng.int(11, 12);
      const side = (a, b) => ({ split: "y", parts: leaves([["*", a], ["*", b]]) });
      return {
        bw, bh, front: { width: 1 }, openDoors: 0.4, extraDoors: 0.25, storeys: 2, foot: "small", ground: "town",
        program: { split: "x", parts: [["*", side(Rm("living", { name: "Parlour", type: "house" }),Rm("office", { name: "Study", type: "house" }))], [3,Rm("hall", { name: "Centre hall", entry: true })], ["*", side(Rm("dining"),Rm("kitchen"))]] },
        upper: () => ({ split: "x", parts: [["*", { split: "y", parts: leaves([["*", "bedroom"], ["*", "bedroom"]]) }], [3, { split: "y", parts: leaves([["*",Rm("hall", { name: "Landing" })], [2, "bath"]]) }], ["*", { split: "y", parts: leaves([["*", "bedroom"], ["*", "bedroom"]]) }]] }),
        stairs: { roles: ["hall"], near: "front" },
        exits: [{ side: "back", roles: ["kitchen", "hall"], chance: 0.85, lock: 0.15 }, { side: sideRoom(rng), roles: ["dining", "living"], chance: 0.25, lock: 0.25 }],
      };
    },
    // A mobile home: a single-wide's rooms in a row (a bedroom each end, the living room and the kitchen between), a
    // double-wide two rows deep; one storey, the door on the long side.
    mobile(rng, o) {
      const double = rng.chance(0.45);
      const bw = o.street ? 14 : double ? rng.int(14, 16) : rng.int(15, 18), bh = double ? rng.int(8, 9) : rng.int(5, 6);
      const program = double
        ? { split: "y", parts: [["*", { split: "x", parts: leaves([["*",Rm("living", { entry: true, type: "house" })], [5, "kitchen"]]) }], ["*", { split: "x", parts: leaves([["*", "bedroom"], [2, "bath"], ["*", "bedroom"], [2, "bath"]]) }]] }
        : { split: "x", parts: leaves([[4, "bedroom"], [2, "bath"], ["*",Rm("living", { entry: true, type: "house" })], [4, "kitchen"], [3, "bedroom"]]) };
      return {
        bw, bh, program, front: { width: 1 }, openDoors: 0.4, extraDoors: 0.1, storeys: 1, foot: "small", ground: o.street ? "town" : "rural",
        exits: [{ side: "back", roles: ["kitchen", "living"], chance: 0.7, lock: 0.2 }, { side: double ? sideRoom(rng) : "front", roles: ["kitchen", "bedroom"], chance: 0.4, lock: 0.3 }],
      };
    },
    // A duplex: two homes side by side under one roof, a wall between (each its own unit: no door through), each with
    // its own front door, living room, kitchen, bedrooms and bathroom.
    duplex(rng) {
      const bw = rng.int(18, 20), bh = rng.int(10, 11);
      const half = (u, door) => ({ split: "y", parts: [["*", { split: "x", parts: leaves([["*",Rm("living", { unit: u, type: "house", ...(door ? { ownDoor: true } : { entry: true }) })], ["*",Rm("kitchen", { unit: u })]]) }], ["*", { split: "x", parts: leaves([["*",Rm("bedroom", { unit: u })], [2,Rm("bath", { unit: u })], ["*",Rm("bedroom", { unit: u })]]) }]] });
      return {
        bw, bh, front: { width: 1 }, openDoors: 0.4, extraDoors: 0.15, storeys: 1, foot: "medium", ground: "town",
        program: { split: "x", parts: [["*", half("A", false)], ["*", half("B", true)]] },
        exits: [{ side: "back", roles: ["kitchen"], chance: 0.8, lock: 0.2 }, { side: "back", roles: ["kitchen"], chance: 0.6, lock: 0.2 }],
      };
    },
  },
  farmhouse: {
    // The old farmhouse: the classic's rooms, a mudroom at the back door and a root cellar behind its own door.
    oldfarm(rng) {
      const bw = rng.int(13, 15), bh = rng.int(11, 12);
      return {
        bw, bh, front: { width: 1 }, openDoors: 0.4, extraDoors: 0.2, storeys: 2, foot: "medium", ground: "farm",
        program: { split: "y", parts: [["*", { split: "x", parts: leaves([[0.5,Rm("living", { entry: true, type: "farmhouse" })], ["*",Rm("dining", { type: "farmhouse" })]]) }], [1,Rm("hall")], ["*", { split: "x", parts: leaves([[3,Rm("storage", { name: "Mudroom", type: "farmhouse", maxBoxes: 1 })], ["*", "kitchen"], [2, "bath"], [3,Rm("storage", { name: "Root cellar", type: "kitchen", ownDoor: "back", windows: false, fl: "dirt", maxBoxes: 2 })]]) }]] },
        upper: () => upHall([["*",Rm("bedroom", { type: "farmhouse" })], [2, "bath"]], [["*",Rm("bedroom", { type: "farmhouse" })], ["*",Rm("bedroom", { type: "farmhouse" })]]),
        stairs: { roles: ["hall", "living"], near: "front" },
        exits: [{ side: "back", roles: ["storage"], chance: 1, lock: 0.15, name: "Mudroom door" }, { side: sideRoom(rng), roles: ["living", "dining"], chance: 0.3, lock: 0.25 }],
      };
    },
    // The ranch farmhouse: one storey, long; the living room, dining room and kitchen across the front, a hall, the
    // bedrooms, the bath and the mudroom-laundry behind, a garage at one end.
    ranchfarm(rng) {
      const bw = rng.int(19, 22), bh = rng.int(10, 11), left = rng.chance(0.5);
      const main = { split: "y", parts: [["*", { split: "x", parts: leaves([[0.4,Rm("living", { entry: true, type: "farmhouse" })], ["*",Rm("dining", { type: "farmhouse" })], ["*", "kitchen"]]) }], [1,Rm("hall")], ["*", { split: "x", parts: leaves([["*",Rm("bedroom", { type: "farmhouse" })], [2, "bath"], ["*",Rm("bedroom", { type: "farmhouse" })], [3,Rm("laundry", { name: "Mudroom and laundry" })]]) }]] };
      const g = [4,Rm("hgarage", { type: "garage" })];
      return {
        bw, bh, front: { width: 1 }, openDoors: 0.4, extraDoors: 0.2, storeys: 1, foot: "medium", ground: "farm",
        program: { split: "x", parts: left ? [g, ["*", main]] : [["*", main], g] },
        exits: [{ side: "front", roles: ["hgarage"], chance: 1, roller: true, width: 2, lock: 0.2 }, { side: "back", roles: ["laundry", "kitchen", "hall"], chance: 0.9, lock: 0.15 }],
      };
    },
    // The farmhouse with a summer kitchen: the farmhouse, and across a breezeway at one end the summer kitchen with
    // its own door and the cold store behind it; the attic over it upstairs.
    summer(rng) {
      const bw = rng.int(16, 18), bh = rng.int(10, 12), left = rng.chance(0.5);
      const main = { split: "y", parts: [["*", { split: "x", parts: leaves([[0.55,Rm("living", { entry: true, type: "farmhouse" })], ["*",Rm("dining", { type: "farmhouse" })]]) }], ["*", { split: "x", parts: leaves([["*", "kitchen"], [2, "bath"], ["*",Rm("bedroom", { type: "farmhouse" })]]) }]] };
      const annex = [5, { split: "y", parts: leaves([["*",Rm("kitchen", { name: "Summer kitchen", ownDoor: true })], [3,Rm("pantry", { name: "Cold store", type: "kitchen" })]]) }];
      const attic = [5,Rm("storage", { name: "Attic", type: "farmhouse", windows: false })];
      const up = { split: "y", parts: [["*", { split: "x", parts: leaves([["*",Rm("bedroom", { type: "farmhouse" })], [2, "bath"]]) }], ["*", { split: "x", parts: leaves([["*",Rm("bedroom", { type: "farmhouse" })], ["*",Rm("bedroom", { type: "farmhouse" })]]) }]] };
      return {
        bw, bh, front: { width: 1 }, openDoors: 0.4, extraDoors: 0.2, storeys: 2, foot: "medium", ground: "farm",
        program: { split: "x", parts: left ? [annex, ["*", main]] : [["*", main], annex] },
        upper: () => ({ split: "x", parts: left ? [attic, ["*", up]] : [["*", up], attic] }),
        stairs: { roles: ["living", "dining"], near: "front" },
        exits: [{ side: "back", roles: ["kitchen", "pantry"], chance: 0.85, lock: 0.15 }, { side: sideRoom(rng), roles: ["living", "dining"], chance: 0.3, lock: 0.25 }],
      };
    },
  },
  cabin: {
    // One room (the great room, its kitchenette in a corner) and a lean-to store behind it.
    hunting(rng) {
      const bw = rng.int(6, 7), bh = rng.int(6, 7);
      return {
        bw, bh, front: { width: 1 }, openDoors: 0.4, storeys: 1, foot: "small", ground: "woods",
        program: { split: "y", parts: leaves([["*",Rm("greatroom", { entry: true })], [2,Rm("storage", { name: "Lean-to", type: "cabin", maxBoxes: 1 })]]) },
        exits: [{ side: "back", roles: ["storage"], chance: 0.4, lock: 0.2 }],
      };
    },
    // The great room below a sleeping loft (raised, up a ladder: as a barn's hayloft), the bathroom beside it.
    loft(rng) {
      const bw = rng.int(9, 10), bh = rng.int(7, 8);
      return {
        bw, bh, front: { width: 1 }, openDoors: 0.4, storeys: 1, foot: "small", ground: "woods", loft: { roles: ["bunk"], chance: 1, ladder: true },
        program: { split: "y", parts: [["*",Rm("greatroom", { entry: true })], [3, { split: "x", parts: leaves([["*",Rm("bunk", { name: "Sleeping loft" })], [2, "bath"]]) }]] },
        exits: [{ side: "back", roles: ["greatroom", "bath"], chance: 0.4, lock: 0.2 }, { side: sideRoom(rng), roles: ["greatroom"], chance: 0.3, lock: 0.2 }],
      };
    },
    // An A-frame: narrow and deep, the great room and the kitchen below, the loft bedroom a storey up.
    aframe(rng) {
      const bw = rng.int(7, 8), bh = rng.int(10, 11);
      return {
        bw, bh, front: { width: 2 }, openDoors: 0.4, storeys: 2, foot: "small", ground: "woods",
        program: { split: "y", parts: [["*",Rm("greatroom", { entry: true })], [3, { split: "x", parts: leaves([["*", "kitchen"], [2, "bath"]]) }]] },
        upper: () => ({ split: "y", parts: leaves([["*",Rm("bedroom", { name: "Loft bedroom" })], [3,Rm("storage", { name: "Attic store", type: "cabin", windows: false })]]) }),
        stairs: { roles: ["greatroom"] },
        exits: [{ side: "back", roles: ["kitchen", "greatroom"], chance: 0.5, lock: 0.2 }],
      };
    },
  },
  lodge: {
    // The fishing lodge: the mudroom at the front door, the great room and the kitchen; bunk rooms, the boot room and
    // the tackle room behind; more bunks upstairs.
    fishing(rng) {
      const bw = rng.int(15, 18), bh = rng.int(11, 13);
      return {
        bw, bh, front: { width: 1 }, openDoors: 0.4, extraDoors: 0.2, storeys: 2, foot: "medium", ground: "woods",
        program: { split: "y", parts: [["*", { split: "x", parts: leaves([[3,Rm("hall", { name: "Mudroom", entry: true })], [0.55, "greatroom"], ["*", "kitchen"]]) }], ["*", { split: "x", parts: leaves([["*", "bunk"], [3,Rm("storage", { name: "Boot room", type: "cabin", maxBoxes: 1 })], [4,Rm("storage", { name: "Tackle room", type: "sportshop", lock: ["door", 0.3] })], ["*", "bunk"], [2, "bath"]]) }]] },
        upper: () => upHall([["*", "bunk"], ["*", "bunk"]], [["*", "bunk"], [2, "bath"]]),
        stairs: { roles: ["greatroom", "hall"], near: "front" },
        exits: [{ side: "back", roles: ["kitchen", "storage", "bunk"], chance: 0.8, lock: 0.15 }, { side: sideRoom(rng), roles: ["greatroom", "kitchen"], chance: 0.4, lock: 0.25 }],
      };
    },
    // The camp lodge: one storey; the dining hall at the front, its kitchen and pantry behind, a bunk wing at one end.
    camp(rng) {
      const bw = rng.int(19, 22), bh = rng.int(12, 13), left = rng.chance(0.5);
      const main = { split: "y", parts: [["*",Rm("mess", { name: "Dining hall", entry: true, type: "cabin" })], [4, { split: "x", parts: leaves([["*", "kitchen"], [3,Rm("pantry", { type: "kitchen" })], [3, "bath"]]) }]] };
      const wing = [7, { split: "y", parts: leaves([["*", "bunk"], [1,Rm("hall")], ["*", "bunk"]]) }];
      return {
        bw, bh, front: { width: 2 }, openDoors: 0.4, extraDoors: 0.2, storeys: 1, foot: "medium", ground: "woods",
        program: { split: "x", parts: left ? [wing, ["*", main]] : [["*", main], wing] },
        exits: [{ side: "back", roles: ["kitchen", "pantry"], chance: 0.85, lock: 0.2 }, { side: left ? "left" : "right", roles: ["hall", "bunk"], chance: 0.7, lock: 0.25 }],
      };
    },
  },
  ranger: {
    // The visitor centre: a lobby of exhibits and the shop at the front, the office, restrooms and the supply room
    // behind; doors at the front and the side.
    visitor(rng) {
      const bw = rng.int(15, 17), bh = rng.int(10, 12);
      return {
        bw, bh, front: { width: 2 }, openDoors: 0.4, storeys: 1, foot: "medium", ground: "woods",
        program: { split: "y", parts: [["*", { split: "x", parts: leaves([["*",Rm("lobby", { name: "Exhibit hall", entry: true, type: "cabin", maxBoxes: 2 })], [5,Rm("sales", { name: "Gift shop", type: "store", hub: false, lay: "aislefront", maxBoxes: 3 })]]) }], [4, { split: "x", parts: leaves([["*",Rm("office", { name: "Ranger office" })], [2, "restroom"], [2, "restroom"], [4,Rm("storage", { name: "Supply room", type: "cabin", lock: ["door", 0.4] })]]) }]] },
        exits: [{ side: sideRoom(rng), roles: ["lobby"], chance: 0.9, lock: 0.3 }, { side: "back", roles: ["office", "storage"], chance: 0.6, lock: 0.3 }],
      };
    },
    // The lookout tower: a small square tower three storeys up, the store room at its foot, a bunk room, the lookout's
    // cab on top (the radio, the maps).
    lookout(rng) {
      const bw = rng.int(6, 7), bh = rng.int(6, 7);
      return {
        bw, bh, front: { width: 1 }, openDoors: 0.5, storeys: 3, foot: "small", ground: "woods",
        program:Rm("storage", { name: "Store room", type: "cabin", entry: true, hub: true, maxBoxes: 2 }),
        upper: (f, r, ctx) => (ctx.top ?Rm("control", { name: "Lookout cab", type: "control", hub: true, maxBoxes: 2 }) :Rm("bunk", { name: "Bunk room", hub: true })),
        stairs: { roles: ["storage", "bunk", "control"], n: 1 },
        exits: [],
      };
    },
  },
};

// Shops: a sales floor at the front, a back strip of stockroom, office and the rest; a back door, a side fire exit.
function shop(rng, v, o = {}) {
  const gas = v === "gasstation", truck = v === "truckstop";
  const plan = planOf(v === "gasstation" ? "gas" : v, o); // data-shops.js: the franchise's layout
  // Since #32 (new saves) its layout (buildvariants.js; the franchise's plan.lay, else the dice and the setting): SHOP_LAYS
  // below says what each changes (its back rooms, the arrangement, a flat or a floor above, extra ways in); the
  // classic changes nothing. A pizza place is the diner's archetype under its own layouts.
  const key = v === "diner" && o.kind === "pizza" ? "pizza" : v;
  const lay = pickLayout(key, rng.state, o, plan.lay || null);
  const LY = lay ? (SHOP_LAYS[key] || {})[lay.id] || {} : {};
  if (LY.make) return { ...LY.make(rng, o, plan), variant: lay }; // a layout with a plan of its own (a pump kiosk)
  const pb = LY.back !== undefined ? LY.back : plan.back; // the back's arrangement by kind (the franchise's, or the layout's)
  const bw = (gas ? rng.int(12, 14) : truck ? rng.int(19, 22) : rng.int(14, 18)) + (plan.wide || LY.wide ? 3 : 0) - (LY.small ? 3 : 0);
  const bh = gas ? rng.int(9, 10) : truck ? rng.int(12, 14) : rng.int(11, 14);
  const ih = bh - 2;
  const sd = Math.max(4, Math.round(ih * (LY.depth ?? plan.depth ?? (gas ? 0.6 : 0.62))));
  const S = (o) => ({ role: "sales", entry: true, ...o });
  let sales, back;
  switch (v) {
    case "pharmacy":
      sales = S({ name: "Pharmacy", type: "pharmacy" });
      back = [[rng.int(4, 5), { role: "dispensary", lock: ["door", 0.65], boxLock: ["drugs", 0.5] }], ["*", { role: "stock", type: "pharmacy" }], [rng.int(3, 4), "office"]];
      break;
    case "gunstore":
      sales = S({ name: "Showroom", type: "gunshop", furnish: "gundesk", maxBoxes: 4 });
      back = [[rng.int(4, 5), { role: "armory", name: "Gun cage", type: "gunshop", lock: ["vault", 0.8], boxLock: ["cage", 0.6], maxBoxes: 3 }], ["*", { role: "stock", type: "store", name: "Back room", maxBoxes: 3 }], [rng.int(3, 4), { role: "office", gunSafe: ["gunsafe2", 0.5] }]]; // locks.js gun safes: the owner's safe
      break;
    // The shops of data-shops.js (shops.js places them; their back rooms by the franchise's plan.back).
    case "sportshop":
      sales = S({ name: "Sales floor", type: "sportshop", furnish: "aisles", maxBoxes: 7 });
      back = pb === "big" ? [["*", { role: "stock", type: "sportshop", name: "Stockroom", maxBoxes: 4 }], [rng.int(4, 5), { role: "lockerroom", name: "Fitting rooms", type: "lockers" }], [rng.int(3, 4), { role: "office", boxLock: ["safe", 0.2] }]]
        : pb === "hunt" ? [["*", { role: "stock", type: "sportshop" }], [rng.int(4, 5), { role: "armory", name: "Gun counter", type: "gunshop", lock: ["door", 0.5], boxLock: ["cage", 0.4], maxBoxes: 3 }], [3, "office"]]
          : pb === "camp" ? [["*", { role: "stock", type: "sportshop", name: "Camping gear" }], [rng.int(3, 4), { role: "storage", name: "Boat and bait room", type: "sportshop" }], [3, "office"]]
            : pb === "lockers" ? [["*", { role: "stock", type: "sportshop" }], [4, { role: "lockerroom", name: "Team gear", type: "lockers" }], [3, "office"]]
              : [["*", { role: "stock", type: "sportshop" }], [rng.int(3, 4), "office"], [2, "restroom"]];
      break;
    case "electronics":
      sales = S({ name: "Sales floor", type: "electronics", furnish: "aisles" });
      back = pb === "repair" ? [["*", { role: "workshop", name: "Repair bench", type: "electronics" }], ["*", { role: "stock", type: "electronics" }], [3, "office"]]
        : [["*", { role: "stock", type: "electronics", name: "Stockroom", lock: ["door", 0.3] }], [rng.int(3, 4), { role: "office", boxLock: ["safe", 0.25] }], [2, "restroom"]];
      break;
    case "radioshop":
      sales = S({ name: "Radio counter", type: "radioshop", furnish: "shelves", maxBoxes: 5 });
      back = pb === "repair" ? [["*", { role: "workshop", name: "Repair bench", type: "radioshop" }], [rng.int(3, 4), { role: "storage", name: "Antenna stock", type: "radioshop" }], [3, "office"]]
        : [["*", { role: "stock", type: "radioshop" }], [rng.int(3, 4), { role: "workshop", name: "Repair bench", type: "radioshop" }], [3, "office"]];
      break;
    case "bookstore":
      sales = S({ name: "Bookshelves", type: "books", furnish: "shelves", maxBoxes: 8 });
      back = [["*", { role: "stock", type: "books", name: "Back room" }], [rng.int(3, 4), "office"], [2, "restroom"]];
      break;
    case "petstore":
      sales = S({ name: "Pet supplies", type: "petstore", furnish: "aisles" });
      back = pb === "tanks" ? [["*", { role: "stock", name: "Fish room", type: "petstore" }], [rng.int(3, 4), { role: "storage", name: "Feed store", type: "petstore" }], [3, "office"]]
        : pb === "feed" ? [["*", { role: "stock", name: "Feed room", type: "barn" }], [rng.int(3, 4), { role: "stock", type: "petstore" }], [3, "office"]]
          : [["*", { role: "stock", type: "petstore" }], [rng.int(3, 4), { role: "exam", name: "Grooming room", type: "vet" }], [3, "office"]];
      break;
    case "garden":
      sales = S({ name: "Garden aisles", type: "garden", furnish: "aisles" });
      back = pb === "yard" ? [["*", { role: "warefloor", name: "Yard stock", type: "garden", hub: false, maxBoxes: 5 }], [rng.int(3, 4), "office"]]
        : [["*", { role: "stock", type: "garden", name: "Potting shed" }], [rng.int(3, 4), "office"], [3, { role: "parts", name: "Tool shed", type: "hardware" }]];
      break;
    case "clothing":
      sales = S({ name: "Sales floor", type: "clothes", furnish: "aisles" });
      back = [["*", { role: "stock", type: "clothes" }], [4, { role: "lockerroom", name: "Fitting rooms", type: "clothes" }], [3, { role: "office", boxLock: ["safe", 0.2] }]];
      break;
    case "liquor":
      sales = S({ name: "Liquor shelves", type: "liquor", furnish: "aisles" });
      back = [["*", { role: "stock", type: "liquor", name: "Back room", lock: ["door", 0.3] }], [rng.int(3, 4), { role: "office", boxLock: ["safe", 0.35] }]];
      break;
    case "restaurant": // the restaurant's back by its kind of place (pb: the franchise's plan.back, or its layout's): fast food, takeout, sit-down, a smoker, a cafe
      sales = S({ role: "dining", name: "Dining room", type: "store", hub: true });
      back = pb === "fastfood" ? [["*", { role: "kitchen" }], [rng.int(3, 4), { role: "pantry", name: "Walk-in", type: "kitchen", lock: ["door", 0.2] }], [2, "restroom"]]
        : pb === "takeout" ? [["*", { role: "kitchen" }], [3, { role: "pantry", name: "Storeroom", type: "kitchen" }]]
          : pb === "smoker" ? [["*", { role: "kitchen" }], [rng.int(3, 4), { role: "storage", name: "Smokehouse", type: "kitchen" }], [3, "office"]]
            : pb === "cafe" ? [["*", { role: "kitchen", name: "Back counter" }], [3, { role: "pantry", type: "kitchen" }], [2, "restroom"]]
              : [["*", { role: "kitchen" }], [rng.int(3, 4), { role: "pantry", name: "Storeroom", type: "kitchen", lock: ["door", 0.2] }], [3, "office"], [2, "restroom"]];
      break;
    case "bar":
      sales = S({ role: "dining", name: "Bar", type: "bar", hub: true });
      back = pb === "stage" ? [["*", { role: "dayroom", name: "Stage and dance floor", type: "bar" }], [rng.int(3, 4), { role: "pantry", name: "Keg room", type: "bar", lock: ["door", 0.3] }], [3, { role: "office", boxLock: ["safe", 0.3] }]]
        : [["*", { role: "kitchen", name: "Kitchen" }], [rng.int(3, 4), { role: "pantry", name: "Keg room", type: "bar", lock: ["door", 0.3] }], [3, { role: "office", boxLock: ["safe", 0.3] }], [2, "restroom"]];
      break;
    case "pawnshop": // shops.js: the counter and its cases in front, the gun case and the stock behind
      sales = S({ name: "Pawn counter", type: "pawnshop", maxBoxes: 6 });
      back = [[rng.int(4, 5), { role: "armory", name: "Gun case", type: "gunshop", lock: ["door", 0.6], boxLock: ["cage", 0.5], maxBoxes: 3 }], ["*", { role: "stock", type: "pawnshop", name: "Back room", maxBoxes: 4 }], [rng.int(3, 4), { role: "office", gunSafe: ["gunsafe2", 0.3] }]];
      break;
    case "hardware":
      sales = S({ name: "Hardware aisles", type: "hardware" }); // shops.js: the materials for building and crafting
      back = [["*", pb === "yard" ? { role: "warefloor", name: "Lumber yard", type: "hardware", hub: false, maxBoxes: 5 } : { role: "stock", type: "hardware", name: "Lumber and stock" }], [rng.int(3, 4), { role: "office", lock: ["door", 0.25] }], [3, { role: "parts", name: "Tool crib", type: "garage" }]]; // pb "yard": a lumber barn's yard
      break;
    case "feedstore":
      sales = S({ name: "Store", type: "barn" });
      back = [["*", { role: "stock", type: "warehouse", name: "Feed room" }], [rng.int(3, 4), "office"]];
      break;
    case "diner":
      sales = S({ role: "dining", name: "Dining room", type: "store", hub: true });
      back = [["*", { role: "kitchen" }], [rng.int(3, 4), { role: "pantry", name: "Storeroom", type: "kitchen", lock: ["door", 0.2] }], [3, "office"]];
      break;
    case "gasstation":
      sales = S({ name: "Shop", type: "store" });
      back = [["*", { role: "stock", name: "Storeroom" }], [2, "restroom"]];
      break;
    case "truckstop":
      sales = { split: "x", parts: leaves([[0.55, S({ name: "Shop", type: "store" })], ["*", { role: "dining", name: "Diner", type: "store", hub: true }]]) };
      back = [["*", "kitchen"], [rng.int(3, 4), { role: "stock", name: "Storeroom" }], [3, { role: "office", lock: ["door", 0.3], boxLock: ["safe", 0.3] }], [2, "restroom"]];
      break;
    default: // grocery, the corner store
      sales = S({ name: v === "corner" ? "Store" : "Sales floor", type: "store" });
      back = [["*", { role: "stock" }], [rng.int(3, 4), { role: "office", boxLock: ["safe", 0.2] }], [2, "restroom"]];
  }
  if (LY.rooms) back = LY.rooms(rng, back, plan); // the layout's back rooms
  if (LY.sales) sales = LY.sales(sales);         // and its front
  if (!o.legacy) back = shopBack(v, back, { ...plan, back: pb }, o);
  let program = LY.form === "side" ? { split: "x", parts: sideOf(rng, [LY.sideW || 5, { split: "y", parts: leaves(back) }], withPlan(sales, plan)) } // the back rooms down one side
    : LY.form === "corridor" ? { split: "y", parts: [[sd, withPlan(sales, plan)], [1, { role: "corridor", name: "Back corridor" }], ["*", { split: "x", parts: leaves(back) }]] } // a service corridor between the floor and the back rooms
      : { split: "y", parts: [[sd, withPlan(sales, plan)], ["*", { split: "x", parts: leaves(back) }]] };
  const exits = [...(LY.exits ? LY.exits(rng) : [])];
  if (LY.bays) { // the layout's own bays (a car wash through the building, a tyre shop's)
    const g = [LY.bays.w || 5, { role: "bays", name: LY.bays.name, maxBoxes: 3 }];
    program = { split: "x", parts: rng.chance(0.5) ? [["*", program], g] : [g, ["*", program]] };
    exits.push(...LY.bays.exits);
  } else if ((gas || truck) && !LY.noBays) {
    const g = [rng.int(4, 5), { role: "bays", name: "Service bay", maxBoxes: 3 }];
    program = { split: "x", parts: rng.chance(0.5) ? [["*", program], g] : [g, ["*", program]] };
    exits.push({ side: "front", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.2 });
  }
  exits.push({ side: "back", roles: ["stock", "kitchen", "pantry", "office", "bays"], chance: 0.9, lock: 0.3 });
  exits.push({ side: sideRoom(rng), roles: ["sales", "dining"], chance: 0.25, lock: 0.5 });
  // A corner store sometimes has a flat above the shop.
  const flat = (v === "corner" && rng.chance(0.5)) || (!!plan.flat && rng.chance(plan.flat)) || !!LY.flat; // a franchise's flat above (plan.flat: a pub, a bookshop); a layout's always (LY.flat)
  const F = (r) => ({ role: r, flat: true }); // the flat's rooms take the home styles (roomlayout.js)
  const upper = () => ({ split: "y", parts: [["*", { split: "x", parts: leaves([["*", { role: "living", name: "Flat: living room", flat: true }], ["*", { role: "kitchen", name: "Flat: kitchen", flat: true }]]) }], [1, { role: "hall", name: "Landing", flat: true }], ["*", { split: "x", parts: leaves([["*", F("bedroom")], [2, F("bath")], ["*", F("bedroom")]]) }]] });
  const up = LY.upper ? LY.upper : flat ? upper : null; // a layout's own floor above (stores and offices: a tactical outfitter's, a superstore's)
  return {
    bw, bh, program, exits, front: { width: 2 }, openDoors: 0.3, ground: v === "feedstore" ? "rural" : truck || gas ? "lot" : "town", pumps: gas || truck ? (truck ? 3 : 2) : 0,
    storeys: up ? 2 : 1, upper: up, foot: gas ? "small" : "medium",
    stairs: { roles: BACK_STAIRS }, // the flat's stair from the back room
    ...(lay ? { variant: lay } : {}),
  };
}

// A shop's back rooms laid out for their kind (shoplayout.js, issue #16; a new save's plan only: o.legacy keeps the
// old): a restaurant's or a diner's storeroom is its walk-in cold room behind a steel door (a smokehouse's office), its
// kitchen fries where the place fries and has a pizza oven at a pizza place, a garden center's potting shed is a
// greenhouse of glass walls. No dice: the plan's rolls are as before.
function shopBack(v, back, plan, o) {
  const leaf = (r) => (typeof r === "string" ? { role: r } : r);
  const eats = v === "restaurant" || v === "diner";
  const fry = v === "diner" || v === "truckstop" || v === "bar" || (v === "restaurant" && ["fastfood", "takeout", "smoker"].includes(plan.back || ""));
  const walkin = { name: "Walk-in cold room", cold: true, dk: "steel", windows: false, fl: "steel" };
  let cold = false;
  const out = back.map(([sz, r]) => {
    const l = leaf(r);
    if (l.role === "kitchen") return [sz, { ...l, ...(fry ? { fry: true } : {}), ...(o.kind === "pizza" ? { pizza: true } : {}) }];
    if (eats && l.role === "pantry" && !cold) { cold = true; return [sz, { ...l, ...walkin }]; }
    if (v === "garden" && l.role === "stock") return [sz, { ...l, name: "Greenhouse", lay: "greenhouse", glass: true }];
    return [sz, l];
  });
  if (eats && !cold) { const i = out.findIndex(([, l]) => l.role === "office"); if (i >= 0) out[i] = [out[i][0], { role: "pantry", type: "kitchen", maxBoxes: 2, ...walkin }]; }
  return out;
}

// ---------- the shops' layout variants (issue #32: buildvariants.js LAYOUTS) ----------
// What each layout changes in shop() (the classic, its first, changes nothing): back (the back's arrangement by kind, as
// a franchise's plan.back), rooms(rng, back, plan) (the back rooms instead), sales(front) (the front), wide / small (3
// cells wider or narrower), depth (the front room's share), form ("side": the back rooms down one side; "corridor": a
// service corridor between the floor and the back rooms), flat (a flat above, always), upper (a floor of its own above),
// exits(rng) (more ways in), bays ({ name, w, exits }: bays of its own; noBays: none where the kind has them), make
// (a plan of its own instead).
const rm = (role, o = {}) => ({ role, ...o });
const SHOP_LAYS = {
  pharmacy: {
    // A chain drugstore: wide, the dispensary at the back with the drive-through window beside it, the stock, the
    // office and a restroom.
    chain: { wide: true, depth: 0.66, rooms: (rng) => [[rng.int(5, 6), rm("dispensary", { name: "Pharmacy counter", lock: ["door", 0.65], boxLock: ["drugs", 0.5] })], ["*", rm("stock", { type: "pharmacy" })], [3, "office"], [2, "restroom"]],
      exits: (rng) => [{ side: sideRoom(rng), roles: ["dispensary"], chance: 1, lock: 0.9, name: "Drive-through window" }] },
    // An independent pharmacy: the soda fountain beside the shop floor, the dispensary and the stock behind, the
    // pharmacist's flat above.
    soda: { flat: true, sales: (S) => ({ split: "x", parts: [["*", S], [5, rm("dining", { name: "Soda fountain", type: "store", hub: false, lay: "diner", maxBoxes: 2 })]] }),
      rooms: (rng) => [[rng.int(4, 5), rm("dispensary", { lock: ["door", 0.65], boxLock: ["drugs", 0.5] })], ["*", rm("stock", { type: "pharmacy" })]] },
    // An outpatient pharmacy: the waiting room and the pharmacy counter, a corridor, consultation rooms, the stock and a
    // restroom behind.
    outpatient: { form: "corridor", sales: () => ({ split: "x", parts: [["*", rm("lobby", { name: "Waiting room", entry: true, type: "pharmacy", maxBoxes: 1 })], [5, rm("dispensary", { name: "Pharmacy counter", lock: ["door", 0.65], boxLock: ["drugs", 0.5] })]] }),
      rooms: () => [[4, rm("exam", { name: "Consultation room", type: "clinic" })], [4, rm("exam", { name: "Consultation room", type: "clinic" })], ["*", rm("stock", { type: "pharmacy" })], [2, "restroom"]] },
  },
  gunstore: {
    // A gun range: the shop, then the range office and the gun cage, and the range's lanes across the back.
    range: { depth: 0.45, rooms: (rng) => [[rng.int(4, 5), rm("armory", { name: "Gun cage", type: "gunshop", lock: ["vault", 0.8], boxLock: ["cage", 0.6], maxBoxes: 3 })], ["*", rm("storage", { name: "Shooting range", type: "gunshop", maxBoxes: 2 })], [4, rm("office", { name: "Range office", gunSafe: ["gunsafe2", 0.5] })]],
      exits: () => [{ side: "back", roles: ["storage"], chance: 0.8, lock: 0.7, name: "Range door" }] },
    // A gunsmith: a small counter, the gunsmith's workshop, the safe room and the office.
    gunsmith: { small: true, depth: 0.45, rooms: (rng) => [["*", rm("workshop", { name: "Gunsmith's workshop", type: "gunshop", maxBoxes: 3 })], [rng.int(3, 4), rm("armory", { name: "Safe room", type: "gunshop", lock: ["vault", 0.85], boxLock: ["cage", 0.6], maxBoxes: 2 })], [3, rm("office", { gunSafe: ["gunsafe2", 0.5] })]] },
    // A tactical outfitter: the shop and the gun cage below, the training room, the gear store and the office above.
    tactical: { upper: () => ({ split: "y", parts: [["*", rm("classroom", { name: "Training room", type: "gunshop", maxBoxes: 2 })], ["*", { split: "x", parts: leaves([["*", rm("storage", { name: "Gear store", type: "gunshop", lock: ["door", 0.4] })], [4, rm("office", { gunSafe: ["gunsafe2", 0.4] })], [2, "restroom"]]) }]] }) },
  },
  pawnshop: {
    // Pawn and loan: the counter, the loan office with its own door, the vault, the stock and a restroom.
    loan: { rooms: (rng) => [[rng.int(4, 5), rm("armory", { name: "Vault", type: "pawnshop", lock: ["vault", 0.8], boxLock: ["safe", 0.5], maxBoxes: 2 })], ["*", rm("office", { name: "Loan office", ownDoor: "front", boxLock: ["lockbox", 0.4] })], ["*", rm("stock", { type: "pawnshop", name: "Back room", maxBoxes: 3 })], [2, "restroom"]] },
    // A trading post: the counter, then a yard shed of big things behind its roller door, the back room and the office.
    trading: { rooms: (rng) => [["*", rm("warefloor", { name: "Yard shed", type: "pawnshop", hub: false, maxBoxes: 4 })], [rng.int(3, 4), rm("stock", { type: "pawnshop", name: "Back room", maxBoxes: 3 })], [3, rm("office", { gunSafe: ["gunsafe2", 0.3] })]],
      exits: () => [{ side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 2, lock: 0.4, name: "Yard door" }] },
  },
  sportshop: {
    sports: { back: null },
    // A sports superstore: wide, fitting rooms and the stock, and a floor above: the bike and ski workshop, more stock.
    big: { back: "big", wide: true, upper: () => ({ split: "y", parts: [["*", rm("sales", { name: "Upper floor", type: "sportshop", maxBoxes: 4, lay: "aislefront" })], [4, { split: "x", parts: leaves([["*", rm("workshop", { name: "Bike and ski workshop", type: "sportshop" })], [4, rm("stock", { type: "sportshop" })], [2, "restroom"]]) }]] }) },
    // A team sports shop: team gear, the printing room, the office.
    team: { back: "lockers", rooms: (rng, back) => [...back.slice(0, 2), [4, rm("workshop", { name: "Printing room", type: "clothes" })], ...back.slice(2)] },
    camp: { back: "camp" },
    hunt: { back: "hunt" },
  },
  electronics: {
    repair: { back: "repair" },
    // An electronics superstore: wide, the stockroom, the service desk, a break room and a restroom down one side.
    mega: { wide: true, form: "side", sideW: 5, rooms: (rng) => [["*", rm("stock", { type: "electronics", name: "Stockroom", lock: ["door", 0.3] })], [4, rm("office", { name: "Service desk", boxLock: ["safe", 0.25] })], [3, "breakroom"], [2, "restroom"]] },
  },
  radioshop: {
    repair: { back: "repair" },
    // Ham radio supply: the counter, the radio shack and the office, the antenna yard behind its gate.
    ham: { rooms: (rng) => [["*", rm("warefloor", { name: "Antenna yard", type: "radioshop", hub: false, maxBoxes: 3 })], [rng.int(4, 5), rm("control", { name: "Radio shack", type: "radioshop" })], [3, "office"]],
      exits: () => [{ side: "back", roles: ["warefloor"], chance: 1, width: 2, lock: 0.4, name: "Yard gate" }] },
  },
  bookstore: {
    // A used bookshop: stacks in the back room, the office; the owner's flat above.
    used: { flat: true, rooms: (rng) => [["*", rm("stock", { type: "books", name: "Back room stacks", lay: "bookfront" })], [rng.int(3, 4), "office"]] },
    // A bookshop and cafe: wide, the cafe, the stockroom and the office down one side.
    cafe: { wide: true, form: "side", sideW: 6, rooms: () => [["*", rm("dining", { name: "Cafe", type: "kitchen", hub: false, lay: "cafe", maxBoxes: 2 })], [4, rm("stock", { type: "books", name: "Stockroom" })], [3, "office"], [2, "restroom"]] },
  },
  petstore: {
    pets: { back: null },
    aquarium: { back: "tanks" },
    feed: { back: "feed", exits: () => [{ side: "back", roles: ["stock"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Loading door" }] },
  },
  garden: {
    garden: { back: null },
    yard: { back: "yard" },
    // A greenhouse nursery: the glass house across most of the back, the office and the seed store beside it.
    greenhouse: { back: null, rooms: () => [["*", rm("stock", { type: "garden", name: "Glass house", maxBoxes: 4 })], [4, { split: "y", parts: leaves([["*", "office"], ["*", rm("storage", { name: "Seed store", type: "garden" })]]) }]],
      exits: (rng) => [{ side: sideRoom(rng), roles: ["stock"], chance: 0.8, width: 2, lock: 0.3, name: "Glass house door" }] },
  },
  clothing: {
    // A boutique: small, the stock and the alterations room; the owner's flat above.
    boutique: { small: true, flat: true, rooms: () => [["*", rm("stock", { type: "clothes" })], [4, rm("workshop", { name: "Alterations room", type: "clothes" })]] },
    // Western wear: boots and saddlery; the boot room, the tack room, the office.
    western: { rooms: (rng) => [["*", rm("stock", { type: "clothes", name: "Boot room" })], [rng.int(4, 5), rm("tack", { name: "Tack room", type: "barn" })], [3, "office"]] },
    // A workwear store: the stock, the embroidery room, the office and a restroom down one side.
    workwear: { form: "side", sideW: 5, rooms: () => [["*", rm("stock", { type: "clothes" })], [4, rm("workshop", { name: "Embroidery room", type: "clothes" })], [3, "office"], [2, "restroom"]] },
  },
  liquor: {
    // A liquor warehouse: wide, the warehouse behind its loading door, the office.
    warehouse: { wide: true, rooms: (rng) => [["*", rm("warefloor", { name: "Warehouse", type: "liquor", hub: false, maxBoxes: 4 })], [rng.int(3, 4), rm("office", { boxLock: ["safe", 0.35] })]],
      exits: () => [{ side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Loading door" }] },
    // A package store: small, the cooler room behind a cold room door, the office, a drive-up window at the side.
    package: { small: true, depth: 0.55, rooms: () => [["*", rm("pantry", { name: "Cooler room", type: "liquor", cold: true, dk: "coldroom", fl: "steel", windows: false, lay: "walkin" })], [3, rm("office", { boxLock: ["safe", 0.35] })]],
      exits: (rng) => [{ side: sideRoom(rng), roles: ["sales"], chance: 1, lock: 0.9, name: "Drive-up window" }] },
  },
  restaurant: {
    sitdown: { back: null },
    fastfood: { back: "fastfood" },
    takeout: { back: "takeout" },
    smoker: { back: "smoker" },
    // A cafe: the back counter, the pantry and the roastery.
    cafe: { back: "cafe", rooms: (rng, back) => [back[0], back[1], [4, rm("workshop", { name: "Roastery", type: "kitchen" })]] },
  },
  bar: {
    bar: { back: null },
    roadhouse: { back: "stage" },
    // A pub: the kitchen, the cellar and the snug; the landlord's flat above.
    pub: { flat: true, rooms: (rng) => [["*", rm("kitchen", { name: "Kitchen" })], [3, rm("pantry", { name: "Cellar", type: "bar", lock: ["door", 0.3], windows: false })], [rng.int(4, 5), rm("dining", { name: "Snug", type: "bar", hub: false, lay: "barroom", maxBoxes: 1 })]] },
    // A sports bar: wide, the game room, the kitchen, the keg room and the office down one side.
    sports: { wide: true, form: "side", sideW: 6, rooms: (rng) => [["*", rm("dayroom", { name: "Game room", type: "bar", lay: "barroom" })], ["*", rm("kitchen", { name: "Kitchen" })], [3, rm("pantry", { name: "Keg room", type: "bar", lock: ["door", 0.3] })], [3, rm("office", { boxLock: ["safe", 0.3] })]] },
  },
  hardware: {
    hardware: { back: null },
    lumber: { back: "yard" },
    // A home centre: wide, a service corridor behind the floor, the garden section, the stock, the office and the
    // loading dock.
    bigbox: { wide: true, form: "corridor", depth: 0.55, rooms: (rng) => [["*", rm("stock", { type: "hardware", name: "Stock", maxBoxes: 4 })], [rng.int(5, 6), rm("sales", { name: "Garden section", type: "garden", hub: false, lay: "aislefront", maxBoxes: 3 })], [4, rm("office", { lock: ["door", 0.25] })]],
      exits: () => [{ side: "back", roles: ["stock"], chance: 1, roller: true, width: 3, lock: 0.25, name: "Loading dock" }] },
  },
  feedstore: {
    // A farm-supply barn: the store, then a barn of fencing, posts and bales behind its roller door, the office.
    supply: { rooms: (rng) => [["*", rm("warefloor", { name: "Supply barn", type: "barn", hub: false, maxBoxes: 4 })], [rng.int(3, 4), "office"]],
      exits: () => [{ side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 3, lock: 0.25, name: "Barn door" }] },
    // A farmers' co-op: the co-op office, the seed store and the grain bin room, a side door to the bins.
    coop: { rooms: (rng) => [[rng.int(4, 5), rm("office", { name: "Co-op office" })], ["*", rm("storage", { name: "Seed store", type: "barn" })], [4, rm("storage", { name: "Grain bin room", type: "barn", windows: false })]],
      exits: (rng) => [{ side: sideRoom(rng), roles: ["storage"], chance: 1, lock: 0.3, name: "Bin door" }] },
    // A western store: boots and saddles at the front, the stock, the tack room and the office behind.
    western: { sales: (S) => ({ ...S, name: "Boots and saddles", type: "clothes" }), rooms: (rng) => [["*", rm("stock", { type: "warehouse", name: "Feed room" })], [rng.int(4, 5), rm("tack", { name: "Tack room", type: "barn" })], [3, "office"]] },
  },
  diner: {
    // A lunch counter: small, the counter and the kitchen, a storeroom, no office.
    counter: { small: true, depth: 0.5, sales: (S) => ({ ...S, name: "Lunch counter" }), rooms: () => [["*", rm("kitchen")], [3, rm("pantry", { name: "Storeroom", type: "kitchen" })]] },
    // A truckers' diner: wide, the kitchen and its storeroom, the showers and the drivers' lounge.
    truckers: { wide: true, rooms: (rng) => [["*", rm("kitchen")], [3, rm("pantry", { name: "Storeroom", type: "kitchen", lock: ["door", 0.2] })], [4, rm("lockerroom", { name: "Showers", type: "lockers" })], [rng.int(4, 5), rm("dayroom", { name: "Drivers' lounge", type: "store" })]] },
  },
  pizza: {
    // A slice counter: small, the oven room and the storeroom.
    slice: { small: true, depth: 0.5, sales: (S) => ({ ...S, name: "Slice counter" }), rooms: () => [["*", rm("kitchen", { name: "Oven room" })], [3, rm("pantry", { name: "Storeroom", type: "kitchen" })]] },
    // A pizza parlour: wide, the kitchen, the storeroom, the party room and a restroom.
    parlour: { wide: true, rooms: (rng) => [["*", rm("kitchen")], [3, rm("pantry", { name: "Storeroom", type: "kitchen", lock: ["door", 0.2] })], [rng.int(5, 6), rm("dining", { name: "Party room", type: "store", hub: false, maxBoxes: 2 })], [2, "restroom"]] },
  },
  gasstation: {
    // A pump kiosk: a little kiosk by the pumps, its storeroom and a restroom.
    kiosk: { make: (rng) => ({
      bw: rng.int(7, 8), bh: rng.int(6, 7), front: { width: 1 }, openDoors: 0.3, ground: "lot", pumps: 3, storeys: 1, foot: "small", stairs: { roles: BACK_STAIRS },
      program: { split: "y", parts: [["*", rm("sales", { name: "Kiosk", entry: true, type: "store", maxBoxes: 3 })], [2, { split: "x", parts: leaves([["*", rm("stock", { name: "Storeroom" })], [2, "restroom"]]) }]] },
      exits: [{ side: "back", roles: ["stock"], chance: 0.6, lock: 0.4 }],
    }) },
    // Gas and car wash: the shop, the car wash bay through the building (a roller door each end) and its equipment room.
    carwash: { bays: { name: "Car wash", w: 5, exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.2, name: "Car wash door" }, { side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Car wash door (back)" }] },
      rooms: () => [["*", rm("stock", { name: "Storeroom" })], [3, rm("parts", { name: "Wash equipment", type: "garage" })], [2, "restroom"]] },
  },
  truckstop: {
    // A travel centre: the shop and the fast food counter, the kitchen, the showers, the drivers' lounge, a small chapel
    // and a restroom; no bays.
    travel: { noBays: true, sales: (S) => ({ split: "x", parts: leaves([[0.55, rm("sales", { name: "Shop", type: "store", entry: true })], ["*", rm("dining", { name: "Fast food", type: "store", hub: true })]]) }),
      rooms: (rng) => [["*", "kitchen"], [4, rm("lockerroom", { name: "Showers", type: "lockers" })], [rng.int(4, 5), rm("dayroom", { name: "Drivers' lounge", type: "store" })], [4, rm("nave", { name: "Chapel", type: "chapel", civic: "nave", hub: false, maxBoxes: 1 })], [2, "restroom"]] },
    // A truck scale and tyre shop: the scale house, a small diner and its kitchen, the tyre shop's drive-through bays.
    scale: { sales: () => ({ split: "x", parts: leaves([[6, rm("office", { name: "Scale house", entry: true, hub: true })], ["*", rm("dining", { name: "Diner", type: "store", hub: true })]]) }),
      rooms: (rng) => [["*", "kitchen"], [rng.int(3, 4), rm("stock", { name: "Storeroom" })], [2, "restroom"]],
      bays: { name: "Tyre shop", w: 7, exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.2, name: "Tyre bay" }, { side: "back", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.3, name: "Tyre bay (back)" }] } },
  },
};

// Big stores: a wide sales floor of aisles, the deli or a sports section, a back room with racks and a loading dock.
function bigstore(rng, v, o = {}) {
  const bw = rng.int(26, 30), bh = rng.int(18, 21);
  const dept = v === "dept";
  const salesFloor = dept
    ? { split: "x", parts: leaves([["*", { role: "sales", entry: true, name: "Department floor", type: "store" }], [rng.int(7, 9), { role: "sales", name: "Sporting goods", type: "lockers", hub: false, maxBoxes: 4 }]]) }
    : o.legacy ? { role: "sales", entry: true, name: "Sales floor", type: "store", maxBoxes: 10 }
      : { split: "x", parts: [["*", { role: "sales", entry: true, name: "Sales floor", type: "store", maxBoxes: 10 }], [4, { role: "dispensary", name: "Pharmacy counter", type: "pharmacy", maxBoxes: 1, windows: false }]] }; // a new save's: the pharmacy counter (shoplayout.js)
  const back = dept
    ? [["*", { role: "warefloor", name: "Stockroom", hub: true, maxBoxes: 5 }], [4, { role: "office", lock: ["door", 0.35], boxLock: ["safe", 0.4] }], [3, "restroom"]]
    : [[rng.int(5, 6), { role: "kitchen", name: "Deli", type: "kitchen" }], ["*", { role: "warefloor", name: "Back room", hub: true, maxBoxes: 5 }], [4, { split: "y", parts: leaves([["*", { role: "office", name: "Manager's office", lock: ["door", 0.4], boxLock: ["safe", 0.4] }], ["*", "breakroom"]]) }]];
  // Sometimes a second floor: a department store's upper sales floor, a supermarket's stockroom and offices.
  const two = rng.chance(0.4);
  const upper = () => (dept
    ? { split: "y", parts: [["*", { role: "sales", name: "Upper sales floor", type: "store", maxBoxes: 8 }], [5, { split: "x", parts: leaves([["*", { role: "warefloor", name: "Upper stockroom", hub: true, maxBoxes: 4 }], [4, "office"], [3, "restroom"]]) }]] }
    : { split: "y", parts: [["*", { role: "warefloor", name: "Upper stockroom", maxBoxes: 6 }], [5, { split: "x", parts: leaves([["*", "office"], ["*", "breakroom"], [3, "restroom"]]) }]] });
  return {
    bw, bh, front: { width: 2 }, openDoors: 0.3, ground: "lot", storeys: two ? 2 : 1, upper: two ? upper : null, foot: "wide", stairs: { roles: BACK_STAIRS },
    program: { split: "y", parts: [["*", salesFloor], [rng.int(5, 6), { split: "x", parts: leaves(back) }]] },
    exits: [
      { side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 3, lock: 0.2, name: "Loading dock" },
      { side: sideRoom(rng), roles: ["sales"], chance: 0.7, lock: 0.4, name: "Fire exit" },
    ],
  };
}

// Corridor buildings: a band of rooms at the front (with the lobby), a corridor along the building, a band behind it.
// Where a stair run goes (spec.stairs, assemble pickRuns): a shop's from its back rooms; a hospital's and a school's
// one at each end of the main corridor, 3 steps long.
const BACK_STAIRS = ["stock", "warefloor", "office", "storage", "breakroom", "kitchen", "pantry", "parts"];
const ENDS = { roles: ["corridor"], n: 2, len: 3, ends: true };
function corridorPlan(front, back, fd, cw = 1, hall = null) { // hall: the corridor's own marks (a school's lined with lockers)
  return { split: "y", parts: [[fd, { split: "x", parts: leaves(front) }], [cw, { role: "corridor", ...(hall || {}) }], ["*", { split: "x", parts: leaves(back) }]] };
}
// Since #32 (new saves) the clinic, infirmary, hospital, police station, fire station and lab take one of their
// layouts (INST_PLANS below; the classic is the plan here; a franchise names its own: data-shops.js plan.lay). The
// military buildings, the school, the offices and the cell block keep theirs (#23, #25, #27, #31 own them).
function institution(rng, v, o = {}) {
  const lay = pickLayout(v, rng.state, o, planOf(v, o).lay || null);
  if (lay && INST_PLANS[v] && INST_PLANS[v][lay.id]) return { ...INST_PLANS[v][lay.id](rng, o), variant: lay };
  const spec = institutionClassic(rng, v, o);
  return lay ? { ...spec, variant: lay } : spec;
}
function institutionClassic(rng, v, o = {}) {
  const L = (o) => ({ role: "lobby", entry: true, ...o });
  const fire = (lock = 0.4) => [{ side: "left", roles: ["corridor"], chance: 0.6, lock }, { side: "right", roles: ["corridor"], chance: 0.6, lock }];
  const S = (bw, bh) => ({ bw, bh });
  switch (v) {
    case "clinic": case "infirmary": {
      const bw = rng.int(16, 18), bh = rng.int(11, 13) + (o.legacy ? 0 : 2); // 2 deeper since #14: the back rooms take an exam bed
      const pl = planOf(v, o), n = clampN(rng.int(1, 3), ...(pl.storeys || [1, 3])); // exam rooms and offices above (a franchise's: plan.storeys)
      // Since #14 (new saves): exam rooms either side of the waiting room and one behind, the drug cupboard, the staff
      // kitchenette and a restroom; an older save (o.legacy) its office, pharmacy and storeroom as before.
      const back = o.legacy ? [["*", "exam"], [rng.int(4, 5), { role: "pharmroom", lock: ["door", 0.6], boxLock: ["drugs", 0.5] }], [3, "storage"], [2, "restroom"]]
        : [["*", "exam"], [3, { role: "pharmroom", name: "Drug cupboard", lock: ["door", 0.6], boxLock: ["drugs", 0.5] }], [3, { role: "staffroom", name: "Kitchenette" }], [2, "restroom"]];
      return {
        ...S(bw, bh), front: { width: 2 }, ground: v === "infirmary" ? "base" : "town", storeys: n, foot: "medium",
        program: corridorPlan([[4, "exam"], ["*", L({ name: "Waiting room", type: "clinic" })], [4, o.legacy ? "office" : "exam"]], back, 4),
        upper: n > 1 ? () => corridorPlan([["*", "exam"], [4, "office"], ["*", "exam"]], [["*", "exam"], [3, { role: "storage", type: "clinic" }], [2, "restroom"]], 4) : null,
        exits: [{ side: "back", roles: ["storage", "exam"], chance: 0.8, lock: 0.3 }, ...fire(0.5).map((e) => ({ ...e, chance: 0.4 }))],
      };
    }
    case "hospital": {
      const bw = rng.int(26, 30), bh = rng.int(17, 19);
      const n = rng.int(3, 5); // reception and the pharmacy low, wards above
      if (!o.legacy) return hospital(rng, bw, bh, n, fire); // room by room since #14 (an older save: the plan below, as it was)
      return {
        ...S(bw, bh), front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: ENDS,
        program: corridorPlan([["*", "ward"], [rng.int(6, 7), L({ name: "Reception", type: "clinic" })], [4, "office"], [4, "exam"], [4, "exam"]],
          [["*", "ward"], ["*", "ward"], [rng.int(4, 5), { role: "pharmroom", lock: ["door", 0.7], boxLock: ["drugs", 0.6] }], [5, "kitchen"], [4, { role: "storage", name: "Supply room", type: "clinic", lock: ["door", 0.3] }]], 5, 2),
        upper: (f) => (f === 1
          ? corridorPlan([["*", "ward"], [5, { role: "pharmroom", name: "Dispensary", lock: ["door", 0.6], boxLock: ["drugs", 0.5] }], [4, "exam"], [4, "office"]], [["*", "ward"], ["*", "ward"], [4, { role: "storage", name: "Supply room", type: "clinic", lock: ["door", 0.3] }], [2, "restroom"]], 5, 2)
          : corridorPlan([["*", "ward"], [4, { role: "office", name: "Nurses' station", type: "clinic" }], ["*", "ward"]], [["*", "ward"], ["*", "ward"], [4, { role: "storage", name: "Supply room", type: "clinic" }], [2, "restroom"]], 5, 2)),
        exits: [{ side: "back", roles: ["kitchen", "storage"], chance: 0.9, lock: 0.25, roller: true, width: 2, name: "Ambulance bay" }, ...fire(0.3).map((e) => ({ ...e, chance: 0.85 }))],
      };
    }
    case "police": {
      if (!o.legacy) return policeStation(rng); // laid out for its kind (civiclayout.js); an older save as below
      const bw = rng.int(23, 26), bh = rng.int(14, 16);
      const main = corridorPlan([["*", { role: "office", name: "Detectives' office", boxLock: ["evidence", 0.25] }], [rng.int(5, 6), L({ name: "Front desk", type: "office" })], [4, { role: "lockerroom", type: "barracks" }], ["*", { role: "office", name: "Chief's office", gunSafe: ["gunsafe2", 0.3] }]], // locks.js: a gun safe, not a plain safe
        [[4, { role: "armory", lock: ["vault", 0.85], boxLock: ["cage", 0.5], gunSafe: ["gunsafe3", 0.3] }], [4, { role: "evidence", lock: ["door", 0.7], boxLock: ["evidence", 0.6] }], ["*", "cells"]], 5);
      const port = [5, { role: "bays", name: "Sally port", type: "garage", maxBoxes: 2 }];
      const right = rng.chance(0.5);
      const n = rng.int(2, 3); // the squad room, interview rooms and records above
      return {
        ...S(bw, bh), front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: { roles: ["lobby", "dayroom"], n: 1 },
        program: { split: "x", parts: right ? [["*", main], port] : [port, ["*", main]] },
        upper: () => corridorPlan([["*", { role: "office", name: "Squad room" }], [4, { role: "office", name: "Interview room" }], ["*", { role: "office", name: "Briefing room" }]], [["*", { role: "office", name: "Records", boxLock: ["evidence", 0.3] }], [4, "breakroom"], [2, "restroom"]], 5),
        exits: [{ side: right ? "right" : "left", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Sally port" }, { side: "back", roles: ["cells", "bays"], chance: 0.6, lock: 0.5 }],
      };
    }
    case "school": {
      if (!o.legacy) return schoolPlan(rng);
      const bw = rng.int(26, 30), bh = rng.int(16, 18);
      const n = rng.int(2, 3); // classrooms above
      return {
        ...S(bw, bh), front: { width: 2 }, ground: "town", storeys: n, foot: "large", stairs: ENDS,
        program: corridorPlan([["*", "classroom"], [4, { role: "office", name: "Principal's office", lock: ["door", 0.3], boxLock: ["safe", 0.2] }], [rng.int(5, 6), L({ name: "Lobby", type: "office" })], [4, "nurse"], ["*", "classroom"]],
          [["*", "classroom"], ["*", "classroom"], [rng.int(7, 9), "gym"], [4, "lockerroom"], [rng.int(5, 6), "cafeteria"]], 5, 2),
        upper: () => corridorPlan([["*", "classroom"], ["*", "classroom"], [4, "office"]], [["*", "classroom"], ["*", "classroom"], [5, { role: "storage", name: "Library", type: "office" }]], 5, 2),
        exits: [{ side: "back", roles: ["gym", "cafeteria"], chance: 0.8, lock: 0.3 }, ...fire(0.3).map((e) => ({ ...e, chance: 0.9 }))],
      };
    }
    case "offices": {
      // A tower: the taller, the smaller its footprint (3 storeys on about 20 × 14, 8 on about 13 × 11). The city crawl
      // adds storeys deeper in (o.storeyBonus).
      const n = clampN(rng.int(3, 8) + (o.storeyBonus || 0), 3, MAX_STOREYS);
      const t = (n - 3) / (MAX_STOREYS - 3);
      const bw = Math.round(20 - 7 * t) + rng.int(-1, 1), bh = Math.round(14 - 3 * t) + rng.int(0, 1);
      const small = bw < 16;
      const records = { role: "storage", name: "Records room", type: "office", lock: ["door", 0.4], boxLock: ["safe", 0.3] };
      const fd = Math.max(5, Math.floor((bh - 3) / 2)); // deep enough for the stairwell's run of 3 and its landings
      // The stairwell: a room of its own beside the lobby, at the same place on every floor (the front band's fixed
      // widths are the same on every floor, so its flexible rooms are too).
      const SW = [2, { role: "stairwell" }], lw = rng.int(5, 6);
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "tower", stairs: { roles: ["stairwell"], n: 1, len: 3 },
        program: small
          ? corridorPlan([["*", L({ name: "Lobby" })], SW, ["*", { role: "sales", name: "Shop", type: "store", hub: false, maxBoxes: 3 }]], [["*", "office"], [4, records]], fd)
          : corridorPlan([["*", { role: "sales", name: "Shop", type: "store", hub: false, maxBoxes: 3 }], SW, [lw, L({ name: "Lobby" })], ["*", { role: "sales", name: "Cafe", type: "kitchen", hub: false, maxBoxes: 2 }]], [["*", "office"], [4, "breakroom"], [4, records], ["*", "office"]], fd),
        upper: (f, r, ctx) => (ctx.top
          ? corridorPlan(small ? [["*", { role: "workshop", name: "Plant room", type: "workshop" }], SW, ["*", "office"]] : [["*", { role: "workshop", name: "Plant room", type: "workshop" }], SW, [lw, "office"], ["*", "office"]], small ? [["*", "office"], [2, "restroom"]] : [["*", "office"], [4, "breakroom"], ["*", "office"]], fd)
          : corridorPlan(small ? [["*", "office"], SW, ["*", "office"]] : [["*", "office"], SW, [lw, "office"], ["*", "office"]], small ? [["*", "office"], [3, { role: "storage", type: "office" }]] : [["*", "office"], [4, "breakroom"], [4, { role: "storage", name: "Records", type: "office" }], ["*", "office"]], fd)),
        exits: [{ side: "back", roles: ["breakroom", "storage", "office"], chance: 0.7, lock: 0.3 }, ...fire(0.4)],
      };
    }
    case "lab": {
      const bw = rng.int(18, 22), bh = rng.int(12, 14);
      const n = rng.int(1, 3);
      return {
        ...S(bw, bh), front: { width: 2 }, ground: "town", storeys: n, foot: "medium",
        program: corridorPlan([["*", "lab"], [rng.int(5, 6), L({ name: "Lobby" })], [4, "office"]], [["*", "lab"], ["*", "lab"], [4, { role: "storage", name: "Chemical store", type: "lab", lock: ["door", 0.4], boxLock: ["drugs", 0.3] }], [4, "breakroom"]], 4),
        upper: n > 1 ? () => corridorPlan([["*", "lab"], [4, "office"], ["*", "lab"]], [["*", "lab"], [4, "office"], [4, "breakroom"]], 4) : null,
        exits: [{ side: "back", roles: ["storage", "breakroom", "lab"], chance: 0.6, lock: 0.3 }, ...fire(0.4)],
      };
    }
    case "barracks": {
      const bw = rng.int(18, 22), bh = rng.int(11, 13);
      return {
        ...S(bw, bh), front: { width: 1 }, ground: "base", storeys: 2, foot: "medium",
        program: corridorPlan([["*", "dorm"], [rng.int(4, 5), { role: "foyer", name: "Duty desk", entry: true, type: "barracks" }], [4, "office"]], [["*", "dorm"], [4, { role: "lockerroom", type: "barracks" }], [2, "restroom"], [4, { role: "storage", type: "barracks", lock: ["door", 0.3] }]], 4),
        upper: () => corridorPlan([["*", "dorm"], [4, "office"], ["*", "dorm"]], [["*", "dorm"], [4, { role: "lockerroom", type: "barracks" }], [2, "restroom"]], 4),
        exits: [{ side: "back", roles: ["lockerroom", "dorm", "storage"], chance: 0.7, lock: 0.2 }, ...fire(0.3).map((e) => ({ ...e, chance: 0.5 }))],
      };
    }
    case "armorybldg": {
      const bw = rng.int(12, 14), bh = rng.int(10, 11);
      return {
        ...S(bw, bh), front: { width: 1 }, ground: "base", storeys: 1, foot: "small",
        program: { split: "y", parts: [[3, { role: "foyer", name: "Issue desk", entry: true, type: "barracks" }], ["*", { split: "x", parts: leaves([["*", { role: "armory", lock: ["vault", 0.9], boxLock: ["cage", 0.6], gunSafe: ["gunsafe3", 0.35] }], ["*", { role: "armory", name: "Ammo store", lock: ["door", 0.5], boxLock: ["crate", 0.4] }], [3, "office"]]) }]] },
        exits: [{ side: "back", roles: ["office"], chance: 0.3, lock: 0.7 }],
      };
    }
    case "cellblock": {
      const bw = rng.int(20, 24), bh = rng.int(13, 15);
      return {
        ...S(bw, bh), front: { width: 1 }, ground: "base", storeys: 1, foot: "medium",
        program: corridorPlan([["*", { role: "office", name: "Guard room", entry: true, hub: true }], [5, { role: "lockerroom", type: "cellblock" }], [4, { role: "armory", name: "Guard armory", lock: ["vault", 0.7], boxLock: ["cage", 0.4], gunSafe: ["gunsafe3", 0.25] }]], [["*", "cells"], ["*", "cells"]], 4),
        exits: [{ side: "left", roles: ["corridor"], chance: 0.6, lock: 0.6 }, { side: "right", roles: ["corridor"], chance: 0.6, lock: 0.6 }],
      };
    }
    case "messhall": {
      const bw = rng.int(16, 20), bh = rng.int(11, 13);
      return {
        ...S(bw, bh), front: { width: 2 }, ground: "lot", storeys: 2, foot: "medium",
        program: { split: "y", parts: [["*", { role: "mess", entry: true }], [4, { split: "x", parts: leaves([["*", "kitchen"], [4, { role: "pantry", type: "kitchen", lock: ["door", 0.3] }], [4, "storage"]]) }]] },
        upper: () => ({ split: "y", parts: [["*", { role: "dayroom", name: "Rec room" }], [4, { split: "x", parts: leaves([["*", { role: "storage", type: "barracks" }], ["*", "office"], [2, "restroom"]]) }]] }),
        exits: [{ side: "back", roles: ["kitchen", "storage"], chance: 0.9, lock: 0.3 }, { side: sideRoom(rng), roles: ["mess"], chance: 0.4, lock: 0.4 }],
      };
    }
    case "control": {
      const bw = rng.int(14, 18), bh = rng.int(10, 12);
      const n = rng.int(1, 3);
      return {
        ...S(bw, bh), front: { width: 1 }, ground: "lot", storeys: n, foot: "medium",
        program: { split: "y", parts: [[4, { split: "x", parts: leaves([["*", L({ name: "Entry", type: "office" })], [rng.int(4, 5), "office"]]) }], ["*", { split: "x", parts: leaves([["*", "control"], [rng.int(4, 5), "workshop"], [4, { role: "storage", type: "workshop", lock: ["door", 0.4], boxLock: ["safe", 0.3] }]]) }]] },
        upper: n > 1 ? () => ({ split: "y", parts: [["*", { split: "x", parts: leaves([["*", { role: "office", hub: true }], ["*", "control"]]) }], ["*", { split: "x", parts: leaves([["*", "office"], [4, { role: "storage", type: "control" }]]) }]] }) : null,
        exits: [{ side: "back", roles: ["workshop", "storage", "control"], chance: 0.7, lock: 0.3 }, { side: sideRoom(rng), roles: ["control", "lobby", "office"], chance: 0.5, lock: 0.4 }],
      };
    }
    case "radio": {
      const bw = rng.int(10, 12), bh = rng.int(8, 9);
      return {
        ...S(bw, bh), front: { width: 1 }, ground: "rural", storeys: 1, foot: "small",
        program: { split: "y", parts: [["*", { role: "control", name: "Transmitter room", entry: true, hub: true }], [3, { split: "x", parts: leaves([["*", { role: "workshop", name: "Generator room" }], [4, { role: "storage", type: "control", lock: ["door", 0.3] }]]) }]] },
        exits: [{ side: "back", roles: ["workshop"], chance: 0.4, lock: 0.3 }],
      };
    }
    case "terminal": {
      const bw = rng.int(22, 26), bh = rng.int(13, 15);
      const n = rng.int(1, 3);
      return {
        ...S(bw, bh), front: { width: 2 }, ground: "lot", storeys: n, foot: "large",
        program: { split: "y", parts: [["*", { role: "terminal", entry: true }], [5, { split: "x", parts: leaves([[4, { role: "office", name: "Airline office" }], [4, { role: "office", name: "Security office", lock: ["door", 0.5], boxLock: ["evidence", 0.3] }], [5, { role: "kitchen", name: "Cafe" }], ["*", { role: "warefloor", name: "Baggage room", maxBoxes: 4 }]]) }]] },
        upper: n > 1 ? () => ({ split: "y", parts: [["*", { role: "dining", name: "Departure lounge", type: "store", hub: true, maxBoxes: 4 }], [5, { split: "x", parts: leaves([["*", "office"], ["*", { role: "office", name: "Control office", type: "control" }], [4, "restroom"]]) }]] }) : null,
        exits: [{ side: "back", roles: ["warefloor"], chance: 0.9, roller: true, width: 2, lock: 0.2 }, { side: sideRoom(rng), roles: ["terminal"], chance: 0.6, lock: 0.4 }],
      };
    }
    default: // firestation
    {
      if (!o.legacy) return fireStation(rng);
      const bw = rng.int(18, 22), bh = rng.int(12, 14);
      const living = { split: "y", parts: [["*", { role: "dayroom", entry: true }], ["*", { split: "x", parts: leaves([["*", { role: "dorm", type: "barracks" }], [4, { role: "storage", name: "Medical store", type: "nurse", lock: ["door", 0.3] }], [4, "kitchen"]]) }]] };
      const bays = [0.48, { role: "bays", name: "Engine bay", type: "motorpool", maxBoxes: 5 }];
      const left = rng.chance(0.5);
      return {
        ...S(bw, bh), front: { width: 1 }, ground: "town", storeys: 2, foot: "medium", stairs: { roles: ["dayroom", "lobby"], n: 1 },
        program: { split: "x", parts: left ? [bays, ["*", living]] : [["*", living], bays] },
        upper: () => ({ split: "y", parts: [["*", { role: "dorm", type: "barracks" }], ["*", { split: "x", parts: leaves([["*", { role: "dayroom", name: "Day room" }], [4, "office"], [3, "bath"]]) }]] }),
        exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.1, name: "Bay door" }, { side: "back", roles: ["bays"], chance: 0.6, roller: true, width: 2, lock: 0.3 }, { side: "back", roles: ["kitchen", "dorm"], chance: 0.6, lock: 0.3 }],
      };
    }
  }
}

// Open floors: a warehouse, a factory, a hangar, a motor pool, an auto shop, a workshop, a barn, a machine shed. Since
// #32 (new saves) each but the hangar and the motor pool (#25's) one of its layouts (OPEN_PLANS below; the classic is
// the plan here).
function openfloor(rng, v, o = {}) {
  const lay = pickLayout(v, rng.state, o, planOf(v, o).lay || null);
  if (lay && OPEN_PLANS[v] && OPEN_PLANS[v][lay.id]) return { ...OPEN_PLANS[v][lay.id](rng, o), variant: lay };
  const spec = openfloorClassic(rng, v);
  return lay ? { ...spec, variant: lay } : spec;
}
function openfloorClassic(rng, v) {
  switch (v) {
    case "warehouse": {
      const bw = rng.int(22, 26), bh = rng.int(14, 17);
      const offices = [rng.int(5, 6), { split: "y", parts: leaves([[4, { role: "office", name: "Shipping office", entry: true, hub: true }], ["*", { role: "storage", name: "Secure storage", lock: ["door", 0.35], boxLock: ["crate", 0.4] }]]) }];
      const left = rng.chance(0.5);
      return {
        bw, bh, front: { width: 1 }, ground: "lot", storeys: 1, foot: "wide",
        program: { split: "x", parts: left ? [offices, ["*", { role: "warefloor" }]] : [["*", { role: "warefloor" }], offices] },
        exits: [{ side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 3, lock: 0.25, name: "Loading dock" }, { side: "front", roles: ["warefloor"], chance: 0.5, roller: true, width: 3, lock: 0.3 }, { side: left ? "right" : "left", roles: ["warefloor"], chance: 0.6, lock: 0.4 }],
      };
    }
    case "factory": {
      const bw = rng.int(24, 28), bh = rng.int(16, 18);
      return {
        bw, bh, front: { width: 1 }, ground: "lot", storeys: 1, foot: "wide",
        program: { split: "y", parts: [[4, { split: "x", parts: leaves([[5, { role: "office", entry: true, hub: true }], ["*", { role: "lockerroom", type: "workshop" }], [5, "breakroom"], [4, { role: "storage", name: "Tool store", type: "workshop", lock: ["door", 0.35], boxLock: ["safe", 0.2] }]]) }], ["*", { role: "factoryfloor" }]] },
        exits: [{ side: "back", roles: ["factoryfloor"], chance: 1, roller: true, width: 3, lock: 0.25, name: "Loading dock" }, { side: "left", roles: ["factoryfloor"], chance: 0.6, lock: 0.4 }, { side: "right", roles: ["factoryfloor"], chance: 0.6, lock: 0.4 }],
      };
    }
    case "hangar": {
      const bw = rng.int(22, 26), bh = rng.int(15, 17);
      const side = [5, { split: "y", parts: leaves([["*", { role: "office", name: "Hangar office", entry: true, hub: true }], ["*", { role: "parts", type: "hangar", lock: ["door", 0.35] }]]) }];
      const left = rng.chance(0.5);
      return {
        bw, bh, front: { width: 1 }, ground: "lot", storeys: 1, foot: "wide",
        program: { split: "x", parts: left ? [side, ["*", { role: "hangarfloor" }]] : [["*", { role: "hangarfloor" }], side] },
        exits: [{ side: "front", roles: ["hangarfloor"], chance: 1, roller: true, width: 4, lock: 0.1, name: "Hangar door" }, { side: "back", roles: ["hangarfloor", "parts"], chance: 0.6, lock: 0.4 }],
      };
    }
    case "motorpool": {
      const bw = rng.int(18, 22), bh = rng.int(12, 14);
      const side = [5, { split: "y", parts: leaves([["*", { role: "office", name: "Dispatch office", entry: true, hub: true }], ["*", { role: "parts", type: "motorpool", lock: ["door", 0.5], boxLock: ["crate", 0.3] }]]) }];
      return {
        bw, bh, front: { width: 1 }, ground: "base", storeys: 1, foot: "medium",
        program: { split: "x", parts: rng.chance(0.5) ? [side, ["*", { role: "motor" }]] : [["*", { role: "motor" }], side] },
        exits: [{ side: "front", roles: ["motor"], chance: 1, roller: true, width: 3, lock: 0.1, name: "Vehicle bay" }, { side: "back", roles: ["motor"], chance: 0.5, roller: true, width: 3, lock: 0.3 }],
      };
    }
    case "autoshop": case "garage": case "machineshed": case "workshop": {
      const small = v !== "autoshop";
      const bw = small ? rng.int(12, 15) : rng.int(14, 18), bh = small ? rng.int(9, 11) : rng.int(10, 12);
      const floorRole = v === "workshop" ? { role: "workshop", hub: true, maxBoxes: 4 } : v === "machineshed" ? { role: "bays", name: "Machine shed", type: "garage", maxBoxes: 4 } : { role: "bays", maxBoxes: 5 };
      const side = [rng.int(4, 5), { split: "y", parts: leaves([["*", { role: "office", entry: true, hub: true, name: v === "machineshed" ? "Tool room" : "Office", type: v === "machineshed" ? "workshop" : "office" }], ["*", { role: "parts", lock: ["door", small ? 0.15 : 0.3] }]]) }];
      return {
        bw, bh, front: { width: 1 }, ground: v === "machineshed" ? "farm" : v === "workshop" ? "lot" : "town", storeys: 1, foot: small ? "small" : "medium",
        program: { split: "x", parts: rng.chance(0.5) ? [side, ["*", floorRole]] : [["*", floorRole], side] },
        exits: [{ side: "front", roles: ["bays", "workshop"], chance: v === "workshop" ? 0.6 : 1, roller: true, width: v === "machineshed" ? 3 : 2, lock: 0.15, name: "Bay door" }, { side: "back", roles: ["bays", "workshop", "parts"], chance: 0.7, lock: 0.3 }],
      };
    }
    default: { // barn
      const bw = rng.int(12, 16), bh = rng.int(10, 12);
      return {
        bw, bh, front: { width: 2 }, ground: "farm", storeys: 1, foot: "medium", loft: { roles: ["hayloft"], chance: 0.6, ladder: true }, openDoors: 0.4, // the hayloft stays a raised room on one grid
        program: { split: "y", parts: [["*", { role: "barnfloor", entry: true }], [3, { split: "x", parts: leaves([["*", "hayloft"], [rng.int(3, 4), "tack"]]) }]] },
        exits: [{ side: "back", roles: ["barnfloor", "tack"], chance: 0.6, width: 2, lock: 0.2 }, { side: sideRoom(rng), roles: ["barnfloor"], chance: 0.4, lock: 0.2 }],
      };
    }
  }
}

// ---------- the institutions' layout variants (issue #32: buildvariants.js LAYOUTS) ----------
const big = (bw, bh) => (bw * bh >= 290 ? "large" : "medium"); // the footprint's class by its area (tools/storeytest.js)
const INST_PLANS = {
  clinic: {
    // The doctor's surgery: a converted house, no corridor; the waiting room and reception at the front, two
    // consulting rooms, the drug cupboard and a restroom behind.
    surgery(rng) {
      const bw = rng.int(12, 14), bh = rng.int(11, 12);
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: 1, foot: "small",
        program: { split: "y", parts: [["*", { split: "x", parts: leaves([["*", { role: "lobby", name: "Waiting room", entry: true, type: "clinic" }], [4, { role: "office", name: "Reception", type: "office" }]]) }], ["*", { split: "x", parts: leaves([["*", { role: "exam", name: "Consulting room" }], ["*", { role: "exam", name: "Consulting room" }], [3, { role: "pharmroom", name: "Drug cupboard", lock: ["door", 0.6], boxLock: ["drugs", 0.5] }], [2, "restroom"]]) }]] },
        exits: [{ side: "back", roles: ["exam", "restroom"], chance: 0.6, lock: 0.3 }],
      };
    },
    // The medical centre: two storeys off a corridor; X-ray, the waiting room and the pharmacy counter at the front,
    // the treatment room and exam rooms behind; the doctors' offices, more exam rooms and the day ward upstairs.
    medcentre(rng) {
      const bw = rng.int(18, 20), bh = rng.int(14, 15);
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: 2, foot: "medium", stairs: ENDS,
        program: corridorPlan([[5, { role: "exam", name: "X-ray" }], ["*", { role: "lobby", name: "Waiting room", entry: true, type: "clinic" }], [5, { role: "pharmroom", name: "Pharmacy counter", lock: ["door", 0.5], boxLock: ["drugs", 0.4] }]], [["*", { role: "er", name: "Treatment room" }], [4, "exam"], [4, "exam"], [3, { role: "staffroom", name: "Kitchenette" }], [2, "restroom"]], 5, 2),
        upper: () => corridorPlan([["*", { role: "office", name: "Doctors' offices", type: "office" }], [4, "exam"], ["*", "exam"]], [["*", { role: "ward", name: "Day ward" }], [4, { role: "storage", name: "Records", type: "office" }], [2, "restroom"]], 5, 2),
        exits: [{ side: "back", roles: ["er", "exam", "staffroom"], chance: 0.7, lock: 0.3 }, { side: sideRoom(rng), roles: ["corridor"], chance: 0.5, lock: 0.4 }],
      };
    },
  },
  infirmary: {
    // The ward infirmary: one long ward hall of beds at the front, the treatment room, the drug store, the duty
    // office and a restroom behind.
    ward(rng) {
      const bw = rng.int(16, 19), bh = rng.int(11, 13);
      return {
        bw, bh, front: { width: 2 }, ground: "base", storeys: 1, foot: "medium",
        program: { split: "y", parts: [["*", { role: "ward", name: "Ward", entry: true, hub: true }], [4, { split: "x", parts: leaves([["*", { role: "exam", name: "Treatment room" }], [4, { role: "pharmroom", name: "Drug store", lock: ["door", 0.6], boxLock: ["drugs", 0.5] }], [4, { role: "office", name: "Duty office", type: "office" }], [2, "restroom"]]) }]] },
        exits: [{ side: "back", roles: ["exam", "office"], chance: 0.6, lock: 0.3 }, { side: sideRoom(rng), roles: ["ward"], chance: 0.5, lock: 0.4 }],
      };
    },
    // The dispensary: a small one; the counter and an exam room, the drug store and the supply room behind.
    dispensary(rng) {
      const bw = rng.int(10, 12), bh = rng.int(9, 10);
      return {
        bw, bh, front: { width: 1 }, ground: "base", storeys: 1, foot: "small",
        program: { split: "y", parts: [["*", { split: "x", parts: leaves([["*", { role: "lobby", name: "Counter", entry: true, type: "clinic" }], [4, "exam"]]) }], [3, { split: "x", parts: leaves([["*", { role: "pharmroom", name: "Drug store", lock: ["door", 0.6], boxLock: ["drugs", 0.5] }], [4, { role: "storage", name: "Supply room", type: "clinic" }]]) }]] },
        exits: [{ side: "back", roles: ["storage"], chance: 0.4, lock: 0.4 }],
      };
    },
  },
  hospital: {
    // The critical-access hospital: one or two storeys; the emergency room, the waiting room, the pharmacy at the
    // front, a ward, the nurses' station, the ambulance bay and the kitchen behind; a ward and the ICU upstairs.
    critical(rng) {
      const bw = rng.int(20, 24), bh = rng.int(14, 15), n = rng.int(1, 2);
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: big(bw, bh), stairs: ENDS,
        program: corridorPlan([["*", { role: "er" }], [6, { role: "lobby", entry: true, name: "Waiting room", type: "clinic" }], [4, { role: "pharmroom", lock: ["vault", 1], boxLock: ["drugs", 0.3] }], [3, "restroom"]], [["*", { role: "ward" }], [5, "nursestation"], [6, { role: "ambbay" }], [4, "kitchen"]], 5, 2),
        upper: n > 1 ? () => corridorPlan([["*", { role: "ward" }], [5, "nursestation"], ["*", { role: "ward" }]], [["*", "icu"], [4, { role: "office", name: "Doctors' office", type: "office" }], [4, "laundry"], [3, "restroom"]], 5, 2) : null,
        exits: [{ side: "back", roles: ["ambbay"], chance: 1, lock: 0.25, roller: true, width: 2, name: "Ambulance bay" }, { side: "left", roles: ["corridor"], chance: 0.7, lock: 0.3 }, { side: "right", roles: ["corridor"], chance: 0.7, lock: 0.3 }],
      };
    },
    // The children's hospital: the children's emergency, the play room and the clinic on the ground floor with the
    // cafeteria, the ambulance bay and the pharmacy; children's wards of cots, the parents' lounge upstairs; no morgue.
    children(rng) {
      const bw = rng.int(26, 30), bh = rng.int(17, 19), n = rng.int(3, 4);
      const ward = (name = "Children's ward") => ({ role: "ward", name, cots: true });
      return {
        bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: ENDS,
        program: corridorPlan([["*", { role: "er", name: "Children's emergency" }], [6, { role: "lobby", entry: true, name: "Waiting room", type: "clinic" }], [5, { role: "dayroom", name: "Play room", type: "house", hub: false }], [4, { role: "pharmroom", lock: ["vault", 1], boxLock: ["drugs", 0.3] }]], [[6, { role: "ambbay" }], ["*", "cafeteria"], [5, "kitchen"], [5, { role: "exam", name: "Clinic" }]], 5, 2),
        upper: (f, r, ctx) => (ctx && ctx.top
          ? corridorPlan([["*", ward("Neonatal ward")], [5, "nursestation"], ["*", ward()]], [["*", "icu"], [5, { role: "dayroom", name: "Parents' lounge", type: "house", hub: false }], [4, "laundry"], [3, "restroom"]], 5, 2)
          : corridorPlan([["*", ward()], [5, "nursestation"], [5, { role: "dayroom", name: "Play room", type: "house", hub: false }], ["*", ward()]], [["*", ward()], [5, "staffroom"], [4, { role: "storage", name: "Supply room", type: "clinic" }], [3, "restroom"]], 5, 2)),
        exits: [{ side: "back", roles: ["ambbay"], chance: 1, lock: 0.25, roller: true, width: 2, name: "Ambulance bay" }, { side: "left", roles: ["corridor"], chance: 0.85, lock: 0.3 }, { side: "right", roles: ["corridor"], chance: 0.85, lock: 0.3 }],
      };
    },
  },
  police: {
    // The sheriff's substation: one storey; the front desk and the deputy's office, a holding cell, the gun locker
    // and a washroom behind.
    substation(rng) {
      const bw = rng.int(14, 16), bh = rng.int(11, 12);
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: 1, foot: "small",
        program: { split: "y", parts: [["*", { split: "x", parts: leaves([["*", { role: "lobby", name: "Front desk", entry: true, type: "office", civic: "frontdesk" }], ["*", { role: "office", name: "Deputy's office", gunSafe: ["gunsafe2", 0.3], civic: "squad" }]]) }], [4, { split: "x", parts: leaves([["*", { role: "cells", name: "Holding cell", civic: "cells" }], [4, { role: "armory", name: "Gun locker", lock: ["vault", 0.8], boxLock: ["cage", 0.5], civic: "armory", dk: "steel" }], [2, { role: "restroom", civic: "washroom" }]]) }]] },
        exits: [{ side: "back", roles: ["cells", "restroom"], chance: 0.4, lock: 0.6 }],
      };
    },
    // The state patrol post: the cruisers' garage at one end, the front desk and dispatch, a corridor, the locker
    // room, the armory and the sergeant's office behind.
    patrol(rng) {
      const bw = rng.int(19, 22), bh = rng.int(12, 14), left = rng.chance(0.5);
      const main = corridorPlan([["*", { role: "lobby", name: "Front desk", entry: true, type: "office", civic: "frontdesk" }], ["*", { role: "office", name: "Dispatch", civic: "dispatch" }]], [[5, { role: "lockerroom", type: "barracks", civic: "plockers" }], [4, { role: "armory", lock: ["vault", 0.85], boxLock: ["cage", 0.5], gunSafe: ["gunsafe3", 0.3], civic: "armory", dk: "steel" }], ["*", { role: "office", name: "Sergeant's office", civic: "chief" }], [2, { role: "restroom", civic: "washroom" }]], 4);
      const port = [0.38, { role: "bays", name: "Cruiser garage", type: "garage", maxBoxes: 3, civic: "sallyport" }];
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: 1, foot: "medium",
        program: { split: "x", parts: left ? [port, ["*", main]] : [["*", main], port] },
        exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Garage door" }, { side: "back", roles: ["corridor", "lockerroom"], chance: 0.6, lock: 0.5 }],
      };
    },
  },
  firestation: {
    // The volunteer fire hall: one storey; the engine bay beside the meeting hall, its kitchen, the medical store and
    // a restroom behind.
    volunteer(rng) {
      const bw = rng.int(16, 18), bh = rng.int(11, 13), left = rng.chance(0.5);
      const hall = { split: "y", parts: [["*", { role: "dayroom", name: "Meeting hall", entry: true, civic: "fdayroom" }], [4, { split: "x", parts: leaves([["*", { role: "kitchen", civic: "fkitchen" }], [4, { role: "storage", name: "Medical store", type: "nurse", lock: ["door", 0.3], civic: "medstore" }], [2, { role: "restroom", civic: "washroom" }]]) }]] };
      const bay = [0.42, { role: "bays", name: "Engine bay", type: "enginebay", maxBoxes: 4, civic: "enginebay" }];
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: 1, foot: "medium",
        program: { split: "x", parts: left ? [bay, ["*", hall]] : [["*", hall], bay] },
        exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.1, name: "Bay door" }, { side: "back", roles: ["kitchen", "bays"], chance: 0.6, lock: 0.3 }],
      };
    },
    // Fire headquarters: three bays behind two bay doors, the day room, the kitchen, the medical store and the
    // workshop, the training tower at the end; the dorm, the gym, the watch office and the chief's office above.
    big(rng) {
      const bw = rng.int(26, 30), bh = rng.int(14, 16), left = rng.chance(0.5);
      const living = { split: "y", parts: [["*", { role: "dayroom", entry: true, civic: "fdayroom" }], ["*", { split: "x", parts: leaves([["*", { role: "kitchen", civic: "fkitchen" }], [4, { role: "storage", name: "Medical store", type: "nurse", lock: ["door", 0.3], civic: "medstore" }], [4, { role: "workshop", civic: "fworkshop" }]]) }]] };
      const bays = [0.5, { role: "bays", name: "Engine bay", type: "enginebay", maxBoxes: 6, civic: "enginebay" }];
      const tower = [4, { role: "storage", name: "Training tower", type: "nurse", windows: false, maxBoxes: 2 }];
      return {
        bw, bh, front: { width: 1 }, ground: "city", storeys: 2, foot: "large", stairs: { roles: ["dayroom"], n: 1 },
        program: { split: "x", parts: left ? [bays, ["*", living], tower] : [tower, ["*", living], bays] },
        upper: () => ({ split: "y", parts: [["*", { split: "x", parts: leaves([["*", { role: "dorm", type: "barracks", civic: "fdorm" }], ["*", { role: "dorm", type: "barracks", civic: "fdorm" }]]) }], ["*", { split: "x", parts: leaves([["*", { role: "gym", civic: "fgym" }], [4, { role: "office", name: "Watch office", civic: "watch" }], [4, { role: "office", name: "Chief's office", civic: "chief" }], [3, { role: "bath", civic: "washroom" }]]) }]] }),
        exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.1, name: "Bay door" }, { side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.1, name: "Bay door" }, { side: "back", roles: ["bays"], chance: 0.7, roller: true, width: 3, lock: 0.3 }, { side: "back", roles: ["kitchen", "workshop", "storage"], chance: 0.6, lock: 0.3 }],
      };
    },
  },
  lab: {
    // The teaching lab: lecture rooms, the lobby and the prep room at the front, teaching labs, the chemical store and
    // restrooms behind a 2-wide corridor; more of each upstairs.
    teaching(rng) {
      const bw = rng.int(20, 24), bh = rng.int(14, 15), n = rng.int(1, 2);
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: big(bw, bh), stairs: ENDS,
        program: corridorPlan([["*", { role: "classroom", name: "Lecture room" }], [6, { role: "lobby", entry: true, name: "Lobby" }], [4, { role: "office", name: "Prep room", type: "lab" }]], [["*", { role: "lab", name: "Teaching lab" }], ["*", { role: "lab", name: "Teaching lab" }], [4, { role: "storage", name: "Chemical store", type: "lab", lock: ["door", 0.4], boxLock: ["drugs", 0.3] }], [2, "restroom"]], 5, 2),
        upper: n > 1 ? () => corridorPlan([["*", { role: "classroom", name: "Lecture room" }], ["*", { role: "lab", name: "Teaching lab" }]], [["*", { role: "lab", name: "Teaching lab" }], [4, "office"], [2, "restroom"]], 5, 2) : null,
        exits: [{ side: "left", roles: ["corridor"], chance: 0.6, lock: 0.4 }, { side: "right", roles: ["corridor"], chance: 0.6, lock: 0.4 }],
      };
    },
    // The biohazard lab: the security desk, the changing room and the decontamination shower at the front, the airlock
    // corridor, then sealed labs each behind an airlock, the freezer room and the waste store.
    biohazard(rng) {
      const bw = rng.int(19, 22), bh = rng.int(14, 15);
      const sealed = () => ["*", { split: "y", parts: leaves([[2, { role: "hall", name: "Airlock" }], ["*", { role: "lab", name: "Sealed lab", lock: ["door", 0.5], windows: false }]]) }];
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: 1, foot: "medium",
        program: { split: "y", parts: [[4, { split: "x", parts: leaves([["*", { role: "lobby", entry: true, name: "Security desk" }], [5, { role: "lockerroom", name: "Changing room", type: "lab" }], [3, { role: "bath", name: "Decontamination shower" }]]) }], [1, { role: "corridor", name: "Airlock corridor" }], ["*", { split: "x", parts: [sealed(), sealed(), [5, { role: "pantry", name: "Freezer room", type: "lab", cold: true, dk: "coldroom", fl: "steel", windows: false, lay: "walkin" }], [3, { role: "storage", name: "Waste store", type: "lab", lock: ["door", 0.4] }]] }]] },
        exits: [{ side: "back", roles: ["storage", "pantry"], chance: 0.5, lock: 0.6 }],
      };
    },
  },
};

// ---------- the open floors' layout variants (issue #32: buildvariants.js LAYOUTS) ----------
const sideOf = (rng, side, rest) => (rng.chance(0.5) ? [side, ["*", rest]] : [["*", rest], side]);
const OPEN_PLANS = {
  warehouse: {
    // The distribution centre: the shipping offices, the dispatch office, the drivers' room and a break room across
    // the front; the racking floor behind, a row of three loading docks along the back.
    distribution(rng) {
      const bw = rng.int(28, 32), bh = rng.int(16, 18);
      return {
        bw, bh, front: { width: 1 }, ground: "lot", storeys: 1, foot: "wide",
        program: { split: "y", parts: [[4, { split: "x", parts: leaves([[6, { role: "office", name: "Shipping office", entry: true, hub: true }], [5, { role: "office", name: "Dispatch" }], [5, { role: "lockerroom", name: "Drivers' room", type: "workshop" }], [4, "breakroom"], [2, "restroom"], ["*", { role: "storage", name: "Returns cage", lock: ["door", 0.4], boxLock: ["crate", 0.3] }]]) }], ["*", { role: "warefloor", name: "Racking floor" }]] },
        exits: [1, 2, 3].map((i) => ({ side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 3, lock: 0.25, name: `Dock ${i}` })).concat([{ side: sideRoom(rng), roles: ["warefloor"], chance: 0.7, lock: 0.4 }]),
      };
    },
    // The cold-storage warehouse: the dock floor, the freezer room and the cooler behind their cold room doors along
    // one side, the office in a corner.
    cold(rng) {
      const bw = rng.int(22, 26), bh = rng.int(14, 16);
      const cold = (name) => ({ role: "pantry", name, type: "kitchen", cold: true, dk: "coldroom", fl: "steel", windows: false, maxBoxes: 4, lay: "walkin" });
      const side = [0.42, { split: "y", parts: leaves([["*", cold("Freezer room")], ["*", cold("Cooler room")], [4, { role: "office", name: "Office", entry: true, hub: true }]]) }];
      return {
        bw, bh, front: { width: 1 }, ground: "lot", storeys: 1, foot: "wide",
        program: { split: "x", parts: sideOf(rng, side, { role: "warefloor", name: "Dock floor", maxBoxes: 6 }) },
        exits: [{ side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 3, lock: 0.25, name: "Loading dock" }, { side: "front", roles: ["warefloor"], chance: 0.6, roller: true, width: 3, lock: 0.3 }],
      };
    },
    // Self-storage: the rental office at the front, then rows of locked units off aisles and a cross aisle down one
    // side: a maze of small rooms, many locked, each a stranger's belongings.
    storage(rng) {
      const bw = rng.int(24, 28), bh = rng.int(16, 18);
      let no = 0;
      const units = () => ({ split: "x", parts: Array.from({ length: Math.floor((bw - 6) / 4) }, () => ["*", { role: "storage", name: `Unit ${++no}`, type: "house", lock: ["door", 0.6], boxLock: ["lockbox", 0.2], maxBoxes: 2, windows: false, lay: "stock" }]) });
      const aisles = { split: "y", parts: [[3, units()], [1, { role: "corridor", name: "Aisle" }], [3, units()], [3, units()], [1, { role: "corridor", name: "Aisle" }], ["*", units()]] };
      return {
        bw, bh, front: { width: 1 }, ground: "lot", storeys: 1, foot: "wide", openDoors: 0.1, extraDoors: 0,
        program: { split: "y", parts: [[3, { split: "x", parts: leaves([[6, { role: "office", name: "Rental office", entry: true, hub: true }], ["*", { role: "corridor", name: "Front aisle" }]]) }], ["*", { split: "x", parts: [[2, { role: "corridor", name: "Cross aisle" }], ["*", aisles]] }]] },
        exits: [{ side: "left", roles: ["corridor"], chance: 0.9, lock: 0.5 }, { side: "right", roles: ["corridor"], chance: 0.7, lock: 0.5 }],
      };
    },
  },
  factory: {
    // The food-processing plant: the offices, lockers and break room across the front, the processing floor, cold
    // rooms and the packing room behind, the dock.
    food(rng) {
      const bw = rng.int(24, 28), bh = rng.int(16, 18);
      const cold = (name) => ({ role: "pantry", name, type: "kitchen", cold: true, dk: "coldroom", fl: "steel", windows: false, maxBoxes: 3, lay: "walkin" });
      return {
        bw, bh, front: { width: 1 }, ground: "lot", storeys: 1, foot: "wide",
        program: { split: "y", parts: [[4, { split: "x", parts: leaves([[5, { role: "office", entry: true, hub: true }], ["*", { role: "lockerroom", type: "workshop" }], [5, "breakroom"]]) }], ["*", { split: "x", parts: [["*", { role: "factoryfloor", name: "Processing floor" }], [7, { split: "y", parts: leaves([["*", cold("Cold room")], ["*", cold("Freezer")], [4, { role: "storage", name: "Packing room", type: "warehouse", lay: "pallets" }]]) }]] }]] },
        exits: [{ side: "back", roles: ["factoryfloor", "storage"], chance: 1, roller: true, width: 3, lock: 0.25, name: "Loading dock" }, { side: sideRoom(rng), roles: ["factoryfloor"], chance: 0.6, lock: 0.4 }],
      };
    },
    // The textile mill: two or three floors of mill floor round a stair, the offices and the dye store below, the
    // bale store and the overseer's office above.
    textile(rng) {
      const bw = rng.int(22, 26), bh = rng.int(13, 15), n = rng.int(2, 3);
      return {
        bw, bh, front: { width: 1 }, ground: "lot", storeys: n, foot: "wide", stairs: { roles: ["factoryfloor", "office"], n: 1 },
        program: { split: "y", parts: [[4, { split: "x", parts: leaves([[5, { role: "office", name: "Mill office", entry: true, hub: true }], ["*", { role: "storage", name: "Dye store", type: "workshop", lock: ["door", 0.3] }], [2, "restroom"]]) }], ["*", { role: "factoryfloor", name: "Mill floor" }]] },
        upper: () => ({ split: "y", parts: [[4, { split: "x", parts: leaves([[5, { role: "office", name: "Overseer's office" }], ["*", { role: "storage", name: "Bale store", type: "warehouse", lay: "pallets" }], [2, "restroom"]]) }], ["*", { role: "factoryfloor", name: "Mill floor" }]] }),
        exits: [{ side: "back", roles: ["factoryfloor"], chance: 1, roller: true, width: 3, lock: 0.25, name: "Loading door" }, { side: sideRoom(rng), roles: ["factoryfloor"], chance: 0.5, lock: 0.4 }],
      };
    },
    // The chemical plant: the gatehouse office, the control room, the plant lab and the locker room across the
    // front, the tank hall and the locked drum store behind.
    chemical(rng) {
      const bw = rng.int(24, 28), bh = rng.int(16, 18);
      return {
        bw, bh, front: { width: 1 }, ground: "lot", storeys: 1, foot: "wide",
        program: { split: "y", parts: [[5, { split: "x", parts: leaves([[5, { role: "office", name: "Gatehouse office", entry: true, hub: true }], [6, { role: "control", name: "Control room" }], ["*", { role: "lab", name: "Plant lab" }], [4, { role: "lockerroom", type: "workshop" }]]) }], ["*", { split: "x", parts: [["*", { role: "factoryfloor", name: "Tank hall" }], [6, { role: "storage", name: "Drum store", type: "lab", lock: ["door", 0.5], boxLock: ["crate", 0.3], lay: "pallets" }]] }]] },
        exits: [{ side: "back", roles: ["factoryfloor"], chance: 1, roller: true, width: 3, lock: 0.25, name: "Tanker bay" }, { side: "left", roles: ["factoryfloor"], chance: 0.6, lock: 0.4 }, { side: "right", roles: ["factoryfloor", "storage"], chance: 0.6, lock: 0.4 }],
      };
    },
  },
  autoshop: {
    // The quick lube: the lube bays drive-through, a roller door front and back; the waiting room and the parts room.
    quicklube(rng) {
      const bw = rng.int(14, 16), bh = rng.int(10, 12);
      const side = [5, { split: "y", parts: leaves([["*", { role: "lobby", name: "Waiting room", entry: true, type: "office", maxBoxes: 1 }], ["*", { role: "parts", lock: ["door", 0.2] }]]) }];
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: 1, foot: "small",
        program: { split: "x", parts: sideOf(rng, side, { role: "bays", name: "Lube bays", maxBoxes: 4 }) },
        exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.15, name: "Bay door" }, { side: "back", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.25, name: "Bay door (back)" }],
      };
    },
    // The body shop: the frame bay, the paint booth sealed off beside it, the office and the parts room.
    body(rng) { return bodyShop(rng, 16, 19); },
    // The tyre shop: the showroom of tyres and the counter at the front, the bays and the tyre store behind.
    tyre(rng) {
      const bw = rng.int(14, 18), bh = rng.int(11, 12);
      return {
        bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "medium",
        program: { split: "y", parts: [[4, { split: "x", parts: leaves([["*", { role: "sales", name: "Tyre showroom", entry: true, type: "garage", maxBoxes: 2 }], [4, { role: "office", boxLock: ["safe", 0.2] }]]) }], ["*", { split: "x", parts: [["*", { role: "bays", maxBoxes: 4 }], [5, { role: "parts", name: "Tyre store" }]] }]] },
        exits: [{ side: sideRoom(rng), roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.15, name: "Bay door" }, { side: "back", roles: ["bays", "parts"], chance: 0.6, lock: 0.3 }],
      };
    },
  },
  garage: {
    // The garage with a workshop: the bay, the workshop beside it and the storage loft over it (a ladder up).
    workshop(rng) {
      const bw = rng.int(11, 13), bh = rng.int(9, 10);
      const side = [5, { split: "y", parts: leaves([["*", { role: "workshop", name: "Workshop", entry: true, hub: true }], [3, { role: "storage", name: "Loft store", type: "garage" }]]) }];
      return {
        bw, bh, front: { width: 1 }, ground: "town", storeys: 1, foot: "small", loft: { roles: ["storage"], chance: 1, ladder: true },
        program: { split: "x", parts: sideOf(rng, side, { role: "bays", name: "Garage", maxBoxes: 3 }) },
        exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.2, name: "Garage door" }, { side: "back", roles: ["workshop", "bays"], chance: 0.5, lock: 0.3 }],
      };
    },
    body(rng) { return bodyShop(rng, 14, 16); },
  },
  workshop: {
    // The welding shop: the welding bay behind a back roller door, the steel store, the office at the front door.
    welding(rng) {
      const bw = rng.int(12, 15), bh = rng.int(10, 11);
      const side = [5, { split: "y", parts: leaves([["*", { role: "office", entry: true, hub: true }], ["*", { role: "storage", name: "Steel store", type: "workshop", lay: "pallets" }], [3, { role: "parts", name: "Gas and consumables", type: "workshop", lock: ["door", 0.3] }]]) }];
      return {
        bw, bh, front: { width: 1 }, ground: "lot", storeys: 1, foot: "small",
        program: { split: "x", parts: sideOf(rng, side, { role: "workshop", name: "Welding bay", hub: true, maxBoxes: 4 }) },
        exits: [{ side: "back", roles: ["workshop"], chance: 1, roller: true, width: 3, lock: 0.2, name: "Roller door" }],
      };
    },
    // The woodshop: the office and the finishing room across the front, the shop floor and the lumber store behind,
    // a roller door at the side.
    woodshop(rng) {
      const bw = rng.int(13, 15), bh = rng.int(10, 12), side = sideRoom(rng);
      return {
        bw, bh, front: { width: 1 }, ground: "lot", storeys: 1, foot: "small",
        program: { split: "y", parts: [[4, { split: "x", parts: leaves([[5, { role: "office", entry: true, hub: true }], ["*", { role: "storage", name: "Finishing room", type: "workshop" }], [2, "restroom"]]) }], ["*", { split: "x", parts: [["*", { role: "workshop", name: "Shop floor", hub: true, maxBoxes: 4 }], [4, { role: "storage", name: "Lumber store", type: "warehouse", lay: "pallets" }]] }]] },
        exits: [{ side, roles: ["workshop", "storage"], chance: 1, roller: true, width: 2, lock: 0.2, name: "Roller door" }, { side: "back", roles: ["workshop"], chance: 0.4, lock: 0.3 }],
      };
    },
  },
  machineshed: {
    // The pole shed: one open run of bays along the front, two bay doors, no rooms.
    pole(rng) {
      const bw = rng.int(15, 18), bh = rng.int(9, 11);
      return {
        bw, bh, front: { width: 1 }, ground: "farm", storeys: 1, foot: "medium",
        program: { role: "bays", name: "Pole shed", type: "garage", entry: true, maxBoxes: 4 },
        exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.1, name: "Bay door" }, { side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.1, name: "Bay door" }],
      };
    },
    // The equipment shed with a shop: the equipment bay, the farm shop at the front door, the fuel and chemical store.
    shop(rng) {
      const bw = rng.int(14, 16), bh = rng.int(10, 11);
      const side = [5, { split: "y", parts: leaves([["*", { role: "workshop", name: "Farm shop", entry: true, hub: true }], ["*", { role: "storage", name: "Fuel and chemical store", type: "workshop", lock: ["door", 0.4] }]]) }];
      return {
        bw, bh, front: { width: 1 }, ground: "farm", storeys: 1, foot: "medium",
        program: { split: "x", parts: sideOf(rng, side, { role: "bays", name: "Equipment bay", type: "garage", maxBoxes: 4 }) },
        exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.15, name: "Bay door" }, { side: "back", roles: ["storage", "workshop"], chance: 0.8, lock: 0.3 }],
      };
    },
  },
  barn: {
    // The bank barn: two floors, the stables and the root cellar below, the threshing floor and the hayloft above (up
    // the ramp in life: a stair here).
    bank(rng) {
      const bw = rng.int(13, 16), bh = rng.int(10, 12);
      return {
        bw, bh, front: { width: 2 }, ground: "farm", storeys: 2, foot: "medium", openDoors: 0.4, stairs: { roles: ["barnfloor"], n: 1 },
        program: { split: "y", parts: [["*", { role: "barnfloor", name: "Stables", entry: true }], [3, { split: "x", parts: leaves([["*", "tack"], [4, { role: "storage", name: "Root cellar", type: "kitchen", fl: "dirt", windows: false }]]) }]] },
        upper: () => ({ split: "y", parts: [["*", { role: "barnfloor", name: "Threshing floor" }], [3, { role: "hayloft" }]] }),
        exits: [{ side: "back", roles: ["barnfloor"], chance: 0.8, width: 2, lock: 0.2 }],
      };
    },
    // The pole barn: one open span, a roller door at each end.
    pole(rng) {
      const bw = rng.int(15, 18), bh = rng.int(11, 13);
      return {
        bw, bh, front: { width: 2 }, ground: "farm", storeys: 1, foot: "medium", openDoors: 0.4,
        program: { role: "warefloor", name: "Pole barn", type: "barn", entry: true, maxBoxes: 5 },
        exits: [{ side: "front", roles: ["warefloor"], chance: 1, roller: true, width: 3, lock: 0.15, name: "Roller door" }, { side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 3, lock: 0.2, name: "Roller door (back)" }],
      };
    },
    // The dairy barn: the stall barn, the milk room behind its cold room door, the feed room and the silo room.
    dairy(rng) {
      const bw = rng.int(17, 20), bh = rng.int(11, 13);
      return {
        bw, bh, front: { width: 2 }, ground: "farm", storeys: 1, foot: "medium", openDoors: 0.4,
        program: { split: "y", parts: [["*", { role: "barnfloor", name: "Stall barn", entry: true }], [4, { split: "x", parts: leaves([[5, { role: "pantry", name: "Milk room", type: "kitchen", cold: true, dk: "coldroom", fl: "steel", lay: "walkin", maxBoxes: 2 }], ["*", { role: "storage", name: "Feed room", type: "barn" }], [4, { role: "storage", name: "Silo room", type: "barn", windows: false }]]) }]] },
        exits: [{ side: "back", roles: ["storage"], chance: 0.8, lock: 0.2, name: "Silo door" }, { side: sideRoom(rng), roles: ["barnfloor"], chance: 0.7, width: 2, lock: 0.2 }],
      };
    },
    // The horse barn: stalls either side of an aisle that runs end to end (a door at each end), the tack room at the
    // aisle's end, the arena across one end with the front door.
    horse(rng) {
      const bw = rng.int(18, 21), bh = rng.int(13, 14), left = rng.chance(0.5);
      const stall = () => ["*", { role: "hayloft", name: "Stall", fl: "dirt", maxBoxes: 1 }];
      const stalls = (n, tack) => ({ split: "x", parts: [...Array.from({ length: n }, stall), ...(tack ? [[4, { role: "tack" }]] : [])] });
      const block = { split: "y", parts: [["*", stalls(3, false)], [2, { role: "corridor", name: "Aisle" }], ["*", stalls(2, true)]] };
      const arena = [0.38, { role: "barnfloor", name: "Arena", entry: true }];
      return {
        bw, bh, front: { width: 2 }, ground: "farm", storeys: 1, foot: "medium", openDoors: 0.4,
        program: { split: "x", parts: left ? [arena, ["*", block]] : [["*", block], arena] },
        exits: [{ side: left ? "right" : "left", roles: ["corridor"], chance: 1, width: 2, lock: 0.2, name: "Aisle door" }, { side: "back", roles: ["barnfloor"], chance: 0.6, width: 2, lock: 0.2 }],
      };
    },
  },
};
// A body shop (an auto shop's, a garage's): the frame bay, the paint booth sealed off beside it, the office at the
// front door and the parts room behind it.
function bodyShop(rng, w0, w1) {
  const bw = rng.int(w0, w1), bh = rng.int(10, 12);
  const side = [5, { split: "y", parts: leaves([["*", { role: "office", entry: true, hub: true }], ["*", { role: "parts", lock: ["door", 0.25] }]]) }];
  return {
    bw, bh, front: { width: 1 }, ground: "town", storeys: 1, foot: bw * bh > 190 ? "medium" : "small",
    program: { split: "x", parts: sideOf(rng, side, { split: "x", parts: [["*", { role: "bays", name: "Frame bay", maxBoxes: 4 }], [5, { role: "workshop", name: "Paint booth", windows: false, maxBoxes: 2 }]] }) },
    exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.2, name: "Bay door" }, { side: "back", roles: ["workshop", "bays"], chance: 0.7, roller: true, width: 2, lock: 0.3, name: "Booth door" }],
  };
}

function church(rng, o = {}) {
  if (!o.legacy) { // since #32 one of its layouts (CHURCH_PLANS; the brick church is churchPlan's), a franchise's its own
    const lay = pickLayout("church", rng.state, o, planOf("church", o).lay || null);
    if (lay && CHURCH_PLANS[lay.id]) return { ...CHURCH_PLANS[lay.id](rng), variant: lay };
    return { ...churchPlan(rng), ...(lay ? { variant: lay } : {}) };
  }
  const bw = rng.int(13, 16), bh = rng.int(16, 19);
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "medium",
    program: { split: "y", parts: [[3, { role: "foyer", name: "Narthex", entry: true, type: "chapel" }], ["*", { role: "nave" }], [4, { split: "x", parts: leaves([[4, { role: "vestry", boxLock: ["lockbox", 0.4] }], ["*", { role: "kitchen", name: "Parish kitchen" }], [3, { role: "storage", type: "chapel" }]]) }]] },
    exits: [{ side: "back", roles: ["kitchen", "storage"], chance: 0.7, lock: 0.3 }, { side: "left", roles: ["nave"], chance: 0.5, lock: 0.4 }, { side: "right", roles: ["nave"], chance: 0.5, lock: 0.4 }],
  };
}

// ---------- police stations, fire stations, schools and churches laid out for their kind (issue #15) ----------
// The new saves' plans (an older save keeps the ones above: o.legacy): every room's leaf names its style (civic:
// civiclayout.js CIVIC_STYLES), dk a room's own door kind (an armory's steel door, an evidence room's barred one, a
// walk-in's cold room door). Police: the front desk, the detectives' squad room, the locker room and the chief's
// office along the front, the armory, the evidence room and the cell block behind, the sally port beside; upstairs the
// squad room, interview rooms with their observation nooks, dispatch (the second floor a briefing room), records and a
// break room. Fire station: the engine bay (two bays: the engine and an ambulance or an empty one) beside the day room,
// the kitchen, the medical store and the workshop; upstairs the dorm, the gym, the watch office and a bathroom. School:
// classrooms, the principal's office, the lobby and the nurse at the front, the science lab, the gym, the cafeteria and
// its kitchen with a walk-in behind, a corridor lined with lockers (they stand in for the old locker room); upstairs classrooms, the staff
// room, a shop class or an art room and the library. Church: the narthex, the nave, and behind it the vestry, the
// parish hall and its kitchen, the food bank's pantry and the bell tower (raised: a ladder up, as a barn's hayloft).
function policeStation(rng) {
  const bw = rng.int(25, 28), bh = rng.int(15, 17);
  const lobby = (o) => ({ role: "lobby", entry: true, ...o });
  const main = corridorPlan([["*", { role: "office", name: "Detectives' office", boxLock: ["evidence", 0.25], civic: "squad" }], [rng.int(5, 6), lobby({ name: "Front desk", type: "office", civic: "frontdesk" })], [4, { role: "lockerroom", type: "barracks", civic: "plockers" }], ["*", { role: "office", name: "Chief's office", gunSafe: ["gunsafe2", 0.3], civic: "chief" }]],
    [[4, { role: "armory", lock: ["vault", 0.85], boxLock: ["cage", 0.5], gunSafe: ["gunsafe3", 0.3], civic: "armory", dk: "steel", boxTarget: 3 }], [3, { role: "evidence", lock: ["door", 0.7], boxLock: ["evidence", 0.6], civic: "evidence", dk: "cell" }], ["*", { role: "cells", civic: "cells" }]], 5);
  const port = [rng.int(5, 6), { role: "bays", name: "Sally port", type: "garage", maxBoxes: 3, civic: "sallyport" }];
  const right = rng.chance(0.5);
  const n = rng.int(2, 3);
  const interview = [6, { split: "x", parts: leaves([["*", { role: "office", name: "Interview room", civic: "interview" }], [2, { role: "office", name: "Observation", civic: "observation" }]]) }];
  const back = [["*", { role: "office", name: "Records", boxLock: ["evidence", 0.3], civic: "records" }], [4, { role: "breakroom", civic: "breakroom" }], [2, { role: "restroom", civic: "washroom" }]];
  return {
    bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: { roles: ["lobby", "dayroom"], n: 1 }, // up from the front desk
    program: { split: "x", parts: right ? [["*", main], port] : [port, ["*", main]] },
    upper: (f) => corridorPlan(f === 1 ? [["*", { role: "office", name: "Squad room", civic: "squad" }], interview, ["*", { role: "office", name: "Dispatch", civic: "dispatch" }]] : [["*", { role: "office", name: "Briefing room", civic: "briefing" }], interview, ["*", { role: "office", name: "Squad room", civic: "squad" }]], back, 5),
    exits: [{ side: right ? "right" : "left", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Sally port" }, { side: "back", roles: ["bays"], chance: 0.6, lock: 0.5 }],
  };
}
function fireStation(rng) {
  const bw = rng.int(20, 23), bh = rng.int(13, 15);
  const living = { split: "y", parts: [["*", { role: "dayroom", entry: true, civic: "fdayroom" }], ["*", { split: "x", parts: leaves([["*", { role: "kitchen", civic: "fkitchen" }], [4, { role: "storage", name: "Medical store", type: "nurse", lock: ["door", 0.3], civic: "medstore" }], [4, { role: "workshop", civic: "fworkshop" }]]) }]] };
  const bays = [0.5, { role: "bays", name: "Engine bay", type: "enginebay", maxBoxes: 5, civic: "enginebay" }];
  const left = rng.chance(0.5);
  return {
    bw, bh, front: { width: 1 }, ground: "town", storeys: 2, foot: "medium", stairs: { roles: ["dayroom", "lobby"], n: 1 }, // up from the day room
    program: { split: "x", parts: left ? [bays, ["*", living]] : [["*", living], bays] },
    upper: () => ({ split: "y", parts: [["*", { role: "dorm", type: "barracks", civic: "fdorm" }], ["*", { split: "x", parts: leaves([["*", { role: "gym", civic: "fgym" }], [4, { role: "office", name: "Watch office", civic: "watch" }], [3, { role: "bath", civic: "washroom" }]]) }]] }),
    exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.1, name: "Bay door" }, { side: "back", roles: ["bays"], chance: 0.6, roller: true, width: 2, lock: 0.3 }, { side: "back", roles: ["kitchen", "workshop"], chance: 0.6, lock: 0.3 }],
  };
}
function schoolPlan(rng) {
  const bw = rng.int(28, 31), bh = rng.int(17, 19);
  const n = rng.int(2, 3);
  const C = (o = {}) => ({ role: "classroom", civic: "classroom", ...o });
  const hall = { type: "schoolhall", civic: "schoolhall", boxTarget: 10 }; // a corridor lined with lockers: many small draws
  const lobby = { role: "lobby", entry: true, name: "Lobby", type: "office", civic: "slobby" };
  const kitchen = [4, { split: "y", parts: leaves([["*", { role: "kitchen", name: "School kitchen", maxBoxes: 1, civic: "skitchen" }], [2, { role: "pantry", name: "Walk-in", type: "kitchen", dk: "coldroom", civic: "walkin" }]]) }];
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "large", stairs: ENDS, // one at each end of the corridor
    program: corridorPlan([["*", C()], [4, { role: "office", name: "Principal's office", lock: ["door", 0.3], boxLock: ["safe", 0.2], civic: "principal" }], [rng.int(5, 6), lobby], [4, { role: "nurse", civic: "nurse" }], ["*", C()]],
      [["*", C({ name: "Science lab", type: "lab", civic: "sciencelab" })], [rng.int(8, 9), { role: "gym", civic: "gym" }], [rng.int(6, 7), { role: "cafeteria", civic: "cafeteria" }], kitchen], 5, 2, hall),
    upper: (f, r) => corridorPlan([["*", C()], ["*", C()], [5, { role: "breakroom", name: "Staff room", type: "office", civic: "staffroom" }]],
      [["*", C()], [5, { role: "workshop", name: r.chance(0.5) ? "Shop class" : "Art room", type: "office", maxBoxes: 2, civic: "shopclass" }], [6, { role: "storage", name: "Library", type: "office", maxBoxes: 4, civic: "library" }]], 5, 2, hall),
    exits: [{ side: "back", roles: ["gym", "cafeteria"], chance: 0.8, lock: 0.3 }, { side: "left", roles: ["corridor"], chance: 0.9, lock: 0.3 }, { side: "right", roles: ["corridor"], chance: 0.9, lock: 0.3 }],
  };
}
function churchPlan(rng) {
  const bw = rng.int(14, 16), bh = rng.int(19, 22);
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "medium", loft: { roles: ["storage"], chance: 1, ladder: true }, // the bell tower, a ladder up
    program: { split: "y", parts: [[3, { role: "foyer", name: "Narthex", entry: true, type: "chapel", civic: "narthex" }], ["*", { role: "nave", civic: "nave" }], [5, { split: "x", parts: leaves([[3, { role: "vestry", boxLock: ["lockbox", 0.4], civic: "vestry" }], ["*", { role: "kitchen", name: "Parish hall", civic: "parishhall" }], [2, { role: "pantry", name: "Food bank pantry", type: "kitchen", civic: "cpantry" }], [2, { role: "storage", name: "Bell tower", type: "chapel", civic: "belltower" }]]) }]] },
    exits: [{ side: "back", roles: ["kitchen", "pantry"], chance: 0.7, lock: 0.3 }, { side: "left", roles: ["nave"], chance: 0.5, lock: 0.4 }, { side: "right", roles: ["nave"], chance: 0.5, lock: 0.4 }],
  };
}

// The churches' layouts (issue #32): the clapboard chapel (one small nave, a porch and a vestry), the megachurch (an
// auditorium, the lobby cafe, classrooms; classrooms and offices upstairs), the cathedral (the long nave between rows of
// side chapels, the narthex, the sacristy and the crypt stair).
const CHURCH_PLANS = {
  chapel(rng) {
    const bw = rng.int(9, 11), bh = rng.int(13, 15);
    return {
      bw, bh, front: { width: 1 }, ground: "rural", storeys: 1, foot: "small",
      program: { split: "y", parts: [[2, { role: "foyer", name: "Porch", entry: true, type: "chapel", civic: "narthex" }], ["*", { role: "nave", civic: "nave" }], [3, { split: "x", parts: leaves([["*", { role: "vestry", boxLock: ["lockbox", 0.4], civic: "vestry" }], [3, { role: "storage", type: "chapel" }]]) }]] },
      exits: [{ side: "back", roles: ["vestry", "storage"], chance: 0.5, lock: 0.3 }],
    };
  },
  mega(rng) {
    const bw = rng.int(28, 32), bh = rng.int(18, 21);
    return {
      bw, bh, front: { width: 2 }, ground: "lot", storeys: 2, foot: "large", stairs: { roles: ["foyer", "corridor"], n: 2 },
      program: { split: "y", parts: [[5, { split: "x", parts: leaves([["*", { role: "foyer", name: "Lobby", entry: true, type: "chapel", civic: "narthex" }], [7, { role: "sales", name: "Cafe", type: "kitchen", hub: false, lay: "cafe", maxBoxes: 2 }], [5, { role: "office", name: "Church office", civic: "vestry" }]]) }], ["*", { role: "nave", name: "Auditorium", civic: "nave" }], [5, { split: "x", parts: leaves([["*", { role: "classroom", civic: "classroom" }], ["*", { role: "classroom", civic: "classroom" }], [6, { role: "kitchen", name: "Fellowship kitchen", civic: "parishhall" }], [3, { role: "restroom", civic: "washroom" }]]) }]] },
      upper: () => ({ split: "y", parts: [["*", { split: "x", parts: leaves([["*", { role: "classroom", civic: "classroom" }], ["*", { role: "classroom", civic: "classroom" }], ["*", { role: "classroom", civic: "classroom" }]]) }], [2, { role: "corridor" }], ["*", { split: "x", parts: leaves([["*", { role: "office", name: "Pastor's office", civic: "vestry" }], ["*", { role: "storage", name: "Youth room", type: "chapel" }], [3, { role: "restroom", civic: "washroom" }]]) }]] }),
      exits: [{ side: "left", roles: ["nave"], chance: 0.8, lock: 0.4 }, { side: "right", roles: ["nave"], chance: 0.8, lock: 0.4 }, { side: "back", roles: ["kitchen", "classroom"], chance: 0.6, lock: 0.3 }],
    };
  },
  cathedral(rng) {
    const bw = rng.int(22, 25), bh = rng.int(24, 27);
    const chapels = () => [5, { split: "y", parts: leaves([["*", { role: "vestry", name: "Side chapel", civic: "vestry" }], ["*", { role: "vestry", name: "Side chapel", civic: "vestry" }], ["*", { role: "vestry", name: "Side chapel", civic: "vestry" }]]) }];
    const middle = { split: "y", parts: [[3, { role: "foyer", name: "Narthex", entry: true, type: "chapel", civic: "narthex" }], ["*", { role: "nave", civic: "nave" }], [4, { split: "x", parts: leaves([["*", { role: "vestry", name: "Sacristy", boxLock: ["lockbox", 0.5], civic: "vestry" }], [4, { role: "storage", name: "Crypt stair", type: "chapel", windows: false }]]) }]] };
    return {
      bw, bh, front: { width: 2 }, ground: "city", storeys: 1, foot: "large",
      program: { split: "x", parts: [chapels(), ["*", middle], chapels()] },
      exits: [{ side: "back", roles: ["vestry", "storage"], chance: 0.6, lock: 0.4 }, { side: "front", roles: ["vestry"], chance: 0.6, lock: 0.3, name: "Side porch" }],
    };
  },
};

// A motel: a row of rooms, each with its own door onto the parking lot, and the office at one end. Since #32 (new saves)
// one of five layouts (buildvariants.js LAYOUTS.motel, by the dice and the setting; the franchise gives the look):
//   court     the motor court (the plan below): two storeys, the outside stair at the office's end up to the walkway
//             along the back, the office and the manager's flat, an ice and vending nook with its own door, the laundry
//             upstairs, an empty pool behind a fence (spec.pool) on the ground behind;
//   strip     the roadside strip: one storey, five or six rooms side by side, the office at one end under a neon sign
//             (the office leaf's neon), the shed at the other with its own door, a gravel lot;
//   chain     the chain motel: 2–3 storeys, a lobby and a breakfast area at the front, the rooms off a central corridor
//             (their doors on the corridor: the room opens, its bathroom behind it), a stair at each end, a linen room
//             and an ice and vending nook upstairs;
//   cabins    the motor lodge: several buildings on one map (spec.compound: buildingMap lays them out as streetMap lays
//             a street's houses, round the drive): the main lodge (the front desk, a diner and its kitchen, the
//             manager's flat) and 4–6 cabins, each a studio with a kitchenette and a bathroom;
//   extended  the extended-stay motel: as the chain's corridor, the rooms studios with a kitchenette (a stove, a fridge
//             and a sink: shoplayout.js motelstudio), a guest laundry and a small gym on the ground floor.
// An older save (o.legacy) builds the plan below exactly as it did (no nook, no pool).
function motel(rng, o = {}) {
  const lay = pickLayout("motel", rng.state, o, planOf("motel", o).lay || null);
  if (lay && lay.id !== "court") return { ...MOTEL_PLANS[lay.id](rng, o), variant: lay };
  const n = rng.int(4, 5), uw = 4;
  const bw = 2 + 5 + 1 + n * uw + (n - 1) + (lay ? 3 : 0); // a motor court's ice and vending nook (3 wide) between the office and the rooms
  const bh = rng.int(8, 9) + (o.legacy ? 0 : 1); // a new save's a cell deeper: the upper rooms' bathrooms fit behind the walkway (shoplayout.js)
  const office = [5, { split: "y", parts: leaves([["*", { role: "reception", entry: true }], ["*", { role: "office", name: "Manager's room", type: "house", lock: ["door", 0.4], boxLock: ["lockbox", 0.4] }]]) }];
  const units = [];
  for (let i = 0; i < n; i++) units.push([uw, { split: "y", parts: leaves([["*", { role: "motelroom", name: `Room ${i + 1}` }], [2, { role: "bath", name: `Bath ${i + 1}` }]]) }]);
  const left = rng.chance(0.5);
  // The upper floor: a walkway (corridor) along the back and a row of rooms over the ground floor's, a linen room over the office.
  // A new save's upper room has its bathroom on the far side from the walkway (a cell deeper, they fit; before, the room
  // took the whole depth), no cabinet loot in it so a motel holds what it did.
  const upperUnits = () => units.map(([w], i) => [w, { split: "y", parts: leaves(o.legacy ? [["*", { role: "motelroom", name: `Room ${n + i + 1}` }], [2, { role: "bath", name: `Bath ${n + i + 1}` }]] : [[2, { role: "bath", name: `Bath ${n + i + 1}`, type: null }], ["*", { role: "motelroom", name: `Room ${n + i + 1}` }]]) }]);
  const linen = [5, { role: "storage", name: o.legacy ? "Linen room" : "Laundry", type: "house" }]; // a new save's: washers, dryers and the linen shelves (shoplayout.js)
  const nook = lay ? [[2, { role: "storage", name: "Ice and vending", type: "store", lay: "vendnook", ownDoor: true, maxBoxes: 1, windows: false }]] : [];
  const upNook = lay ? [[2, { role: "storage", name: "Linen closet", type: "house", maxBoxes: 1, windows: false }]] : [];
  return {
    bw, bh, front: { width: 1 }, ground: "lot", unitDoors: "motelroom", openDoors: 0.25, extraDoors: 0, storeys: 2, foot: "medium",
    stairs: { out: left ? "left" : "right", n: 1 }, // an outside stair at the office's end, up to the walkway along the back
    program: { split: "x", parts: left ? [office, ...nook, ...units] : [...units, ...nook, office] },
    upper: () => ({ split: "y", parts: [["*", { split: "x", parts: left ? [linen, ...upNook, ...upperUnits()] : [...upperUnits(), ...upNook, linen] }], [1, { role: "corridor", name: "Walkway" }]] }),
    exits: [{ side: "back", roles: ["office"], chance: 0.6, lock: 0.3 }],
    ...(lay ? { pool: { w: rng.int(4, 6), h: 3 }, margins: { back: 9 }, variant: lay } : {}),
  };
}
// A motel room and its bathroom as one unit off a corridor (the chain's, the extended stay's): the bathroom on the
// outer wall's side, the room on the corridor's (front: the band in front of the corridor), the room the unit's door.
const motelUnit = (name, front, studio = false) => {
  const room = { role: "motelroom", name, unit: name, opens: true, ...(studio ? { lay: "motelstudio", maxBoxes: 3 } : {}) };
  const bath = { role: "bath", name: `${name}: bathroom`, unit: name, type: null, windows: false };
  return { split: "y", parts: front ? [[2, bath], ["*", room]] : [["*", room], [2, bath]] };
};
const MOTEL_PLANS = {
  strip(rng) {
    const n = rng.int(5, 6), uw = 4;
    const bw = 2 + 4 + 1 + n * uw + (n - 1) + 1 + 3, bh = rng.int(8, 9);
    const office = [4, { split: "y", parts: leaves([["*", { role: "reception", entry: true, neon: true }], [3, { role: "office", name: "Manager's room", type: "house", lock: ["door", 0.4], boxLock: ["lockbox", 0.4] }]]) }];
    const units = [];
    for (let i = 0; i < n; i++) units.push([uw, { split: "y", parts: leaves([["*", { role: "motelroom", name: `Room ${i + 1}` }], [2, { role: "bath", name: `Bath ${i + 1}` }]]) }]);
    const shed = [3, { role: "storage", name: "Shed", type: "garage", lay: "stock", ownDoor: true, windows: false, maxBoxes: 2 }];
    const left = rng.chance(0.5);
    return {
      bw, bh, front: { width: 1 }, ground: "gravel", unitDoors: "motelroom", openDoors: 0.25, extraDoors: 0, storeys: 1, foot: "medium",
      program: { split: "x", parts: left ? [office, ...units, shed] : [shed, ...units, office] },
      exits: [{ side: "back", roles: ["office", "reception"], chance: 0.6, lock: 0.3 }],
    };
  },
  chain(rng) { return corridorMotel(rng, false); },
  extended(rng) { return corridorMotel(rng, true); },
  cabins(rng) {
    const count = rng.int(5, 7); // the lodge and its cabins
    const spec = motorLodge(rng);
    return { ...spec, compound: { count, word: "buildings", make: (k, r) => (k === 0 ? motorLodge(r) : motorCabin(r)), name: (k) => (k === 0 ? "Lodge" : `Cabin ${k}`), road: "gravel", yard: "grass", BW: [6, 18], BH: 11, GAP: 3, CARS: [1, 3], TREES: [5, 9], fences: false } };
  },
};
// The chain's and the extended stay's: a corridor down the middle, units either side, a stair at each end.
function corridorMotel(rng, studios) {
  const n = rng.int(2, 3), k = rng.int(4, 5), uw = studios ? 5 : 4;
  const fd = studios ? 6 : 5;
  const bw = Math.min(40, 2 + 6 + 1 + 5 + 1 + k * (uw + 1)), bh = 2 + fd + 1 + 2 + 1 + fd;
  let no = 100; // rooms 101, 102... on the ground floor, 201... on the next
  const U = (front) => [uw, motelUnit(`${studios ? "Studio" : "Room"} ${++no}`, front, studios)];
  const row = (m, front) => Array.from({ length: m }, () => U(front));
  const lobby = [6, { role: "lobby", entry: true, name: "Lobby", type: "office", lay: "motelfront", neon: !studios }];
  const breakfast = [5, studios ? { role: "gym", name: "Gym", type: "lockers", civic: "fgym", maxBoxes: 1 } : { role: "dining", name: "Breakfast area", type: "kitchen", lay: "dining", hub: false, maxBoxes: 2 }];
  const ground = corridorPlan([lobby, breakfast, ...row(k, true)], [[4, { role: "office", name: "Manager's office", lay: "manager", lock: ["door", 0.4], boxLock: ["safe", 0.4] }], [studios ? 5 : 4, { role: "storage", name: studios ? "Guest laundry" : "Laundry", type: "house", lay: "laundry" }], ...row(k, false)], fd, 2);
  return {
    bw, bh, front: { width: 2 }, ground: "lot", openDoors: 0.2, extraDoors: 0, storeys: n, foot: bw * bh >= 290 ? "large" : "medium", stairs: ENDS,
    program: ground,
    upper: (f) => { no = (f + 1) * 100; return corridorPlan([[6, { role: "storage", name: "Linen room", type: "house", lay: "laundry" }], [5, { role: "storage", name: "Ice and vending", type: "store", lay: "vendnook", maxBoxes: 1 }], ...row(k, true)], [[4, { role: "storage", name: "Housekeeping", type: "house", maxBoxes: 1 }], [studios ? 5 : 4, U(false)[1]], ...row(k, false)], fd, 2); },
    exits: [{ side: "back", roles: ["office", "storage"], chance: 0.7, lock: 0.3 }, { side: "left", roles: ["corridor"], chance: 0.6, lock: 0.4 }, { side: "right", roles: ["corridor"], chance: 0.6, lock: 0.4 }],
  };
}
// The motor lodge's main building (the front desk, a diner and its kitchen, the manager's flat) and a cabin (a studio
// with a kitchenette, its bathroom behind).
function motorLodge(rng) {
  const bw = rng.int(15, 18), bh = rng.int(10, 11);
  return {
    bw, bh, front: { width: 1 }, ground: "woods", openDoors: 0.3, storeys: 1, foot: "small",
    program: { split: "y", parts: [["*", { split: "x", parts: leaves([[5, { role: "reception", entry: true, neon: true }], ["*", { role: "dining", name: "Diner", type: "store", hub: true }]]) }], [4, { split: "x", parts: leaves([["*", { role: "kitchen", name: "Kitchen", fry: true }], [5, { role: "office", name: "Manager's flat", type: "house", lock: ["door", 0.3], boxLock: ["lockbox", 0.4] }], [2, "restroom"]]) }]] },
    exits: [{ side: "back", roles: ["kitchen"], chance: 0.8, lock: 0.3 }],
  };
}
function motorCabin(rng) {
  const bw = rng.int(6, 7), bh = rng.int(6, 7);
  return {
    bw, bh, front: { width: 1 }, ground: "woods", openDoors: 0.2, storeys: 1, foot: "small",
    program: { split: "y", parts: [["*", { role: "motelroom", name: "Cabin", entry: true, lay: "motelstudio", maxBoxes: 3 }], [2, { role: "bath", name: "Bathroom", type: null, windows: false }]] },
    exits: [{ side: "back", roles: ["motelroom"], chance: 0.2, lock: 0.5 }],
  };
}

// A car dealership (data-shops.js): the showroom at the front, the service bays to one side behind a roller door, the
// parts room, the sales office (the keys in a locked box) and the restroom behind; a used-car lot's is a small office
// on its lot (plan.back "lot"), a truck dealer's mostly bays ("service").
function dealer(rng, o = {}) {
  const plan = planOf("dealer", o);
  const lay = pickLayout("dealer", rng.state, o, plan.lay || null); // since #32 (new saves) its layout: the franchise's (plan.lay), else the dice
  const lot = lay ? lay.id === "lot" : plan.back === "lot", svc = lay ? lay.id === "truck" : plan.back === "service";
  const bw = (lot ? rng.int(12, 14) : rng.int(19, 23)) + (plan.wide ? 3 : 0), bh = lot ? rng.int(9, 10) : rng.int(12, 14);
  const sd = Math.max(4, Math.round((bh - 2) * (plan.depth ?? 0.55)));
  const show = withPlan({ role: "sales", entry: true, name: lot ? "Sales office" : "Showroom", type: "dealer", furnish: "lobby", maxBoxes: lot ? 3 : 4 }, plan);
  const back = [["*", { role: "parts", name: "Parts room", type: "garage" }], [rng.int(3, 4), { role: "office", name: "Sales office", boxLock: ["lockbox", 0.5] }], [2, "restroom"]];
  let program = { split: "y", parts: [[sd, show], ["*", { split: "x", parts: leaves(lot ? [["*", { role: "office", boxLock: ["lockbox", 0.5] }], [2, "restroom"]] : back) }]] };
  const exits = [{ side: "back", roles: ["parts", "office", "bays"], chance: 0.8, lock: 0.3 }];
  if (!lot) {
    const bays = [svc ? 0.5 : rng.int(6, 7), { role: "bays", name: "Service bays", type: "garage", maxBoxes: 4 }];
    program = { split: "x", parts: rng.chance(0.5) ? [["*", program], bays] : [bays, ["*", program]] };
    exits.push({ side: "front", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Service door" });
  }
  const n = plan.storeys ? rng.int(plan.storeys[0], plan.storeys[1]) : 1;
  const upper = () => ({ split: "y", parts: [["*", { role: "office", name: "Finance office", hub: true, boxLock: ["safe", 0.3] }], [4, { split: "x", parts: leaves([["*", "office"], [3, "restroom"]]) }]] });
  if (lay && svc) { // a truck dealer's (#32): the parts warehouse behind its own roller door
    program = { split: "y", parts: [["*", program], [4, { role: "warefloor", name: "Parts warehouse", type: "garage", hub: false, maxBoxes: 3 }]] };
    exits.push({ side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Loading door" });
  }
  return { bw, bh: lay && svc ? bh + 5 : bh, program, exits, front: { width: 2 }, openDoors: 0.3, ground: "lot", storeys: n, upper: n > 1 ? upper : null, foot: lot ? "small" : "medium", stairs: { roles: BACK_STAIRS }, ...(lay ? { variant: lay } : {}) };
}

// A bank (data-shops.js): the banking hall at the front, the teller line, the vault (a vault door, its boxes locked)
// and the manager's office behind; the bigger banks have offices above (plan.storeys).
function bank(rng, o = {}) {
  const plan = planOf("bank", o);
  const lay = pickLayout("bank", rng.state, o, plan.lay || null); // since #32 (new saves): its layout (BANK_PLANS; the classic below)
  if (lay && BANK_PLANS[lay.id]) return { ...BANK_PLANS[lay.id](rng, plan), variant: lay };
  return { ...bankClassic(rng, o, plan), ...(lay ? { variant: lay } : {}) };
}
function bankClassic(rng, o, plan) {
  const bw = rng.int(16, 19) + (plan.wide ? 3 : 0), bh = rng.int(12, 14);
  const n = plan.storeys ? rng.int(plan.storeys[0], plan.storeys[1]) : 1;
  const hall = { role: "lobby", entry: true, name: "Banking hall", type: "office" };
  const back = [["*", { role: "office", name: "Teller line", type: "office", boxLock: ["lockbox", 0.4] }], [rng.int(4, 5), { role: "armory", name: "Vault", type: "bankvault", lock: ["vault", o.legacy ? 0.85 : 1], boxLock: ["safe", 0.6], windows: false, fl: "conc" }], [rng.int(3, 4), { role: "office", name: "Manager's office", boxLock: ["safe", 0.3] }], [2, "restroom"]];
  // A new save's (shoplayout.js): the vault always locked, a safe-deposit room beside it, an ATM lobby at the front door.
  if (!o.legacy) back.splice(2, 0, [3, { role: "armory", name: "Safe-deposit room", type: "bankvault", lock: ["door", 0.5], boxLock: ["safe", 0.3], windows: false, fl: "conc", maxBoxes: 2 }]);
  const upper = () => corridorPlan([["*", "office"], [4, { role: "office", name: "Loan office" }], ["*", "office"]], [["*", { role: "storage", name: "Records", type: "office", lock: ["door", 0.3] }], [4, "breakroom"], [2, "restroom"]], 4);
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "medium", openDoors: 0.2,
    program: { split: "y", parts: [[Math.max(4, Math.round((bh - 2) * 0.5)), o.legacy ? hall : { split: "x", parts: [[3, { role: "lobby", name: "ATM lobby", entry: true, atm: true, hub: false, type: "office", maxBoxes: 1 }], ["*", { ...hall, entry: false }]] }], ["*", { split: "x", parts: leaves(back) }]] },
    upper: n > 1 ? upper : null,
    exits: [{ side: "back", roles: ["office", "restroom"], chance: 0.6, lock: 0.6 }],
  };
}

// The banks' layouts (issue #32): the small-town bank (one banking hall, the teller line, the vault and the manager's
// office behind it), the drive-through branch (the teller line down one side along its drive-through window), the city
// bank (a marble hall between offices off a 2-wide corridor, the vault and the deposit room; offices and the boardroom
// above).
const vaultRoom = (name = "Vault") => ({ role: "armory", name, type: "bankvault", lock: ["vault", 1], boxLock: ["safe", 0.6], windows: false, fl: "conc" });
const BANK_PLANS = {
  town(rng) {
    const bw = rng.int(12, 14), bh = rng.int(10, 11);
    return {
      bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "small", openDoors: 0.2,
      program: { split: "y", parts: [["*", { role: "lobby", entry: true, name: "Banking hall", type: "office" }], [4, { split: "x", parts: leaves([["*", { role: "office", name: "Teller line", type: "office", boxLock: ["lockbox", 0.4] }], [4, vaultRoom()], [4, { role: "office", name: "Manager's office", boxLock: ["safe", 0.3] }]]) }]] },
      exits: [{ side: "back", roles: ["office"], chance: 0.5, lock: 0.6 }],
    };
  },
  drive(rng) {
    const bw = rng.int(17, 20), bh = rng.int(12, 13), side = sideRoom(rng);
    const main = { split: "y", parts: [["*", { role: "lobby", entry: true, name: "Banking hall", type: "office" }], [4, { split: "x", parts: leaves([[4, vaultRoom()], ["*", { role: "office", name: "Manager's office", boxLock: ["safe", 0.3] }], [2, "restroom"]]) }]] };
    const tellers = [5, { role: "office", name: "Teller line", type: "office", boxLock: ["lockbox", 0.4] }];
    return {
      bw, bh, front: { width: 2 }, ground: "lot", storeys: 1, foot: "medium", openDoors: 0.2,
      program: { split: "x", parts: side === "left" ? [tellers, ["*", main]] : [["*", main], tellers] },
      exits: [{ side, roles: ["office"], chance: 1, lock: 0.9, name: "Drive-through window" }, { side: "back", roles: ["office", "restroom"], chance: 0.5, lock: 0.6 }],
    };
  },
  city(rng, plan) {
    const bw = rng.int(22, 26), bh = rng.int(14, 16), n = plan.storeys ? clampN(rng.int(plan.storeys[0], plan.storeys[1]), 2, 3) : rng.int(2, 3);
    return {
      bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: big(bw, bh), openDoors: 0.2, stairs: { roles: ["corridor"], n: 1 },
      program: corridorPlan([["*", { role: "office", name: "Loan office" }], [8, { role: "lobby", entry: true, name: "Marble hall", type: "office" }], ["*", { role: "office", name: "Private banking" }]], [[5, vaultRoom()], [4, { ...vaultRoom("Safe-deposit room"), lock: ["door", 0.5], boxLock: ["safe", 0.3], maxBoxes: 2 }], ["*", { role: "office", name: "Teller line", type: "office", boxLock: ["lockbox", 0.4] }], [4, { role: "office", name: "Manager's office", boxLock: ["safe", 0.3] }], [2, "restroom"]], 5, 2),
      upper: () => corridorPlan([["*", "office"], [6, { role: "office", name: "Boardroom" }], ["*", "office"]], [["*", { role: "storage", name: "Records", type: "office", lock: ["door", 0.3] }], [4, "breakroom"], [2, "restroom"]], 5, 2),
      exits: [{ side: "back", roles: ["office", "restroom"], chance: 0.6, lock: 0.6 }, { side: sideRoom(rng), roles: ["corridor"], chance: 0.5, lock: 0.5 }],
    };
  },
};

// A library (data-shops.js): the circulation desk and the stacks, a reading room, the children's corner, the
// workroom and the archive; the city's central library has more floors of stacks (plan.storeys).
function library(rng, o = {}) {
  const plan = planOf("library", o);
  const lay = pickLayout("library", rng.state, o, plan.lay || null); // since #32 (new saves): its layout (LIBRARY_PLANS; the central library below)
  if (lay && LIBRARY_PLANS[lay.id]) return { ...LIBRARY_PLANS[lay.id](rng, plan), variant: lay };
  return { ...libraryClassic(rng, o, plan), ...(lay ? { variant: lay } : {}) };
}
// The libraries' layouts (issue #32): the Carnegie library (the domed hall in the middle with reading rooms either side
// and the stacks behind them, the mezzanine stacks upstairs), the branch library (one open room of stacks and the
// children's area, the community room and the workroom behind), the county library (a corridor front to back, rooms
// either side: the archive, the genealogy room, the meeting room).
const stacksRoom = (name = "Stacks", o = {}) => ({ role: "stock", name, type: "books", fl: "carpet", maxBoxes: 6, ...o });
const LIBRARY_PLANS = {
  carnegie(rng) {
    const bw = rng.int(18, 20), bh = rng.int(14, 16);
    const wing = () => ({ split: "y", parts: [["*", { role: "dining", name: "Reading room", type: "books", hub: false, maxBoxes: 2 }], ["*", stacksRoom()]] });
    return {
      bw, bh, front: { width: 2 }, ground: "town", storeys: 2, foot: "medium", stairs: { roles: ["lobby"], n: 1 },
      program: { split: "x", parts: [["*", wing()], [6, { role: "lobby", entry: true, name: "Domed hall", type: "books" }], ["*", wing()]] },
      upper: () => ({ split: "x", parts: [["*", stacksRoom("Mezzanine stacks")], [6, { role: "hall", name: "Gallery" }], ["*", { split: "y", parts: leaves([["*", stacksRoom("Mezzanine stacks")], [4, { role: "storage", name: "Archive", type: "books", lock: ["door", 0.3] }]]) }]] }),
      exits: [{ side: "back", roles: ["stock"], chance: 0.5, lock: 0.4 }],
    };
  },
  branch(rng) {
    const bw = rng.int(18, 22), bh = rng.int(12, 14);
    return {
      bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "medium",
      program: { split: "y", parts: [["*", { split: "x", parts: leaves([["*", stacksRoom("Library", { entry: true, hub: true })], [0.32, { role: "classroom", name: "Children's area", type: "books" }]]) }], [4, { split: "x", parts: leaves([["*", { role: "dining", name: "Community room", type: "books", hub: false, maxBoxes: 2 }], [4, { role: "office", name: "Workroom" }], [2, "restroom"], [2, "restroom"]]) }]] },
      exits: [{ side: "back", roles: ["dining", "office"], chance: 0.6, lock: 0.4 }, { side: sideRoom(rng), roles: ["stock"], chance: 0.5, lock: 0.4 }],
    };
  },
  county(rng) {
    const bw = rng.int(17, 19), bh = rng.int(15, 17);
    const left = { split: "y", parts: leaves([[5, { role: "lobby", entry: true, name: "Circulation desk", type: "books" }], ["*", stacksRoom()], [4, { role: "storage", name: "Archive", type: "books", lock: ["door", 0.3] }]]) };
    const right = { split: "y", parts: leaves([["*", { role: "dining", name: "Meeting room", type: "books", hub: false, maxBoxes: 2 }], ["*", { role: "office", name: "Genealogy room", type: "books" }], [4, { role: "office", name: "Workroom" }], [2, "restroom"]]) };
    return {
      bw, bh, front: { width: 2 }, ground: "town", storeys: 1, foot: "medium",
      program: { split: "x", parts: [["*", left], [2, { role: "corridor" }], ["*", right]] },
      exits: [{ side: "back", roles: ["corridor"], chance: 0.8, lock: 0.4 }],
    };
  },
};
function libraryClassic(rng, o, plan) {
  const bw = rng.int(18, 22) + (plan.wide ? 4 : 0), bh = rng.int(13, 15);
  const n = plan.storeys ? rng.int(plan.storeys[0], plan.storeys[1]) : rng.int(1, 2);
  const stacks = (name = "Stacks") => ({ role: "stock", name, type: "books", fl: "carpet", maxBoxes: 6 });
  return {
    bw, bh, front: { width: 2 }, ground: "town", storeys: n, foot: "medium",
    program: corridorPlan([["*", stacks()], [rng.int(5, 6), { role: "lobby", entry: true, name: "Circulation desk", type: "books" }], ["*", { role: "dining", name: "Reading room", type: "books", hub: false, maxBoxes: 2 }]],
      [["*", stacks("Stacks")], [rng.int(4, 5), { role: "classroom", name: "Children's corner", type: "books" }], [4, { role: "office", name: "Workroom" }], [2, "restroom"]], 5, 2),
    upper: n > 1 ? () => corridorPlan([["*", stacks("Upper stacks")], ["*", { role: "dining", name: "Study room", type: "books", hub: false, maxBoxes: 2 }]], [["*", stacks("Reference")], [4, { role: "storage", name: "Archive", type: "books", lock: ["door", 0.3] }], [2, "restroom"]], 5, 2) : null,
    exits: [{ side: "back", roles: ["office", "restroom"], chance: 0.6, lock: 0.4 }, { side: sideRoom(rng), roles: ["corridor"], chance: 0.5, lock: 0.4 }],
  };
}

// A hospital room by room (issue #14, new saves; roomlayout.js MEDICAL_STYLES furnishes each room). The ground floor:
// the emergency room, the waiting room, the pharmacy behind its steel door (always locked) and a restroom at the front;
// the ambulance bay (its roller door the back exit), the morgue, the cafeteria and its kitchen behind. The first floor
// up: a ward, the nurses' station, the operating theatre and the supply room; the ICU, a ward, the doctors' office and
// a restroom. The floors between: wards round a nurses' station, a doctors' office and a supply room. The top floor:
// the maternity ward, the staff room and the laundry. A 2-wide corridor down every floor.
function hospital(rng, bw, bh, n, fire) {
  const ward = (o = {}) => ({ role: "ward", ...o });
  const doc = [4, { role: "office", name: "Doctors' office", type: "office" }];
  const supply = (lock) => [4, { role: "storage", name: "Supply room", type: "clinic", ...(lock ? { lock: ["door", 0.3] } : {}) }]; // locked only on the first floor up, as before (a stairwell cell can stand in a higher floor's wall)
  return {
    bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", stairs: ENDS, // one at each end of the corridor
    program: corridorPlan([["*", { role: "er" }], [rng.int(6, 7), { role: "lobby", entry: true, name: "Waiting room", type: "clinic" }], [rng.int(4, 5), { role: "pharmroom", lock: ["vault", 1], boxLock: ["drugs", 0.3] }], [3, "restroom"]],
      [[6, { role: "ambbay" }], [5, { role: "morgue", lock: ["door", 0.3] }], ["*", "cafeteria"], [5, "kitchen"]], 5, 2),
    upper: (f, r, ctx) => (f === 1
      ? corridorPlan([["*", ward()], [5, "nursestation"], [6, { role: "theatre", lock: ["door", 0.3] }], supply(true)], [["*", "icu"], ["*", ward()], doc, [3, "restroom"]], 5, 2)
      : ctx && ctx.top
        ? corridorPlan([["*", ward({ name: "Maternity ward", cots: true })], [5, "nursestation"], ["*", ward()]], [["*", ward()], [5, "staffroom"], [4, "laundry"], doc, [3, "restroom"]], 5, 2)
        : corridorPlan([["*", ward()], [5, "nursestation"], ["*", ward()]], [["*", ward()], ["*", ward()], doc, supply(false), [3, "restroom"]], 5, 2)),
    exits: [{ side: "back", roles: ["ambbay"], chance: 1, lock: 0.25, roller: true, width: 2, name: "Ambulance bay" }, ...fire(0.3).map((e) => ({ ...e, chance: 0.85 }))],
  };
}

// A veterinary clinic (data-shops.js): the waiting room, exam rooms, the surgery and its drug cabinet, the kennels;
// a country vet's has a large-animal barn at the back (plan.back "barn"). Since #14 (new saves): 3 cells wider and 2
// deeper, the surgery an operating room (MEDICAL_STYLES theatre: the steel table), a food store (feed: BOX_LOOT
// "crate@vet") in place of the ground floor's restroom, the kennels pens of bars (sometimes locked: dead pets shut in,
// deadbeasts.js).
function vet(rng, o = {}) {
  const plan = planOf("vet", o);
  const lay = pickLayout("vet", rng.state, o, plan.lay || null); // since #32 (new saves): the animal clinic (below), the country vet's barn, the animal hospital
  const bw = rng.int(15, 18) + (plan.wide ? 3 : 0) + (o.legacy ? 0 : 3), bh = rng.int(11, 13) + (o.legacy ? 0 : 2);
  if (lay && lay.id === "hospital") return { ...animalHospital(rng, bw, bh), variant: lay };
  const n = plan.storeys ? rng.int(plan.storeys[0], plan.storeys[1]) : 1;
  const barn = lay ? lay.id === "country" : plan.back === "barn";
  if (!o.legacy) return {
    ...(lay ? { variant: lay } : {}),
    bw, bh, front: { width: 2 }, ground: barn ? "rural" : "town", storeys: n, foot: "medium",
    program: corridorPlan([[4, { role: "exam", name: "Exam room", type: "vet" }], ["*", { role: "lobby", entry: true, name: "Waiting room", type: "vet" }], [4, { role: "exam", name: "Exam room", type: "vet" }]],
      [["*", barn ? { role: "storage", name: "Large-animal stalls", type: "barn", fl: "dirt" } : { role: "cells", name: "Kennels", type: "vet", kennel: true, lock: ["door", 0.35] }], [4, { role: "theatre", name: "Surgery", type: "vet", lock: ["door", 0.3] }], [3, { role: "pharmroom", name: "Drug room", type: "vet", lock: ["door", 0.5], boxLock: ["drugs", 0.4] }], [3, { role: "storage", name: "Food store", type: "vet", food: true }]], 4),
    upper: n > 1 ? () => corridorPlan([["*", "office"], [4, "breakroom"]], [["*", { role: "ward", name: "Recovery ward", type: "vet" }], [3, { role: "storage", type: "vet" }], [2, "restroom"]], 4) : null,
    exits: [{ side: "back", roles: ["storage", "cells", "theatre"], chance: 0.8, lock: 0.3, ...(lay && barn ? { roller: true, width: 2, name: "Stall door" } : {}) }, ...(lay && barn ? [{ side: sideRoom(rng), roles: ["storage"], chance: 0.6, lock: 0.3 }] : [])],
  };
  return {
    bw, bh, front: { width: 2 }, ground: barn ? "rural" : "town", storeys: n, foot: "medium",
    program: corridorPlan([[4, { role: "exam", name: "Exam room", type: "vet" }], ["*", { role: "lobby", entry: true, name: "Waiting room", type: "vet" }], [4, { role: "exam", name: "Exam room", type: "vet" }]],
      [["*", barn ? { role: "storage", name: "Large-animal stalls", type: "barn", fl: "dirt" } : { role: "cells", name: "Kennels", type: "vet" }], [rng.int(4, 5), { role: "exam", name: "Surgery", type: "vet", lock: ["door", 0.3] }], [3, { role: "pharmroom", name: "Drug room", type: "vet", lock: ["door", 0.5], boxLock: ["drugs", 0.4] }], [2, "restroom"]], 4),
    upper: n > 1 ? () => corridorPlan([["*", "office"], [4, "breakroom"]], [["*", { role: "ward", name: "Recovery ward", type: "vet" }], [3, { role: "storage", type: "vet" }]], 4) : null,
    exits: [{ side: "back", roles: ["storage", "cells", "exam"], chance: 0.8, lock: 0.3 }],
  };
}

// The animal hospital (a vet's layout, issue #32): two storeys off a corridor; exam rooms, the waiting room and X-ray at
// the front, the boarding kennels, the surgery, the ICU and the drug room behind; offices, the recovery ward and the
// staff room upstairs.
function animalHospital(rng, bw, bh) {
  const V = (role, o = {}) => ({ role, type: "vet", ...o });
  return {
    bw: Math.min(bw, 24), bh: Math.max(bh, 15), front: { width: 2 }, ground: "town", storeys: 2, foot: "medium", stairs: ENDS,
    program: corridorPlan([[4, V("exam", { name: "Exam room" })], ["*", V("lobby", { entry: true, name: "Waiting room" })], [4, V("exam", { name: "X-ray" })], [4, V("exam", { name: "Exam room" })]],
      [["*", V("cells", { name: "Boarding kennels", kennel: true, lock: ["door", 0.35] })], [5, V("theatre", { name: "Surgery", lock: ["door", 0.3] })], [4, V("icu", { name: "ICU" })], [3, V("pharmroom", { name: "Drug room", lock: ["door", 0.5], boxLock: ["drugs", 0.4] })]], 5, 2),
    upper: () => corridorPlan([["*", { role: "office" }], [5, "staffroom"], ["*", { role: "office" }]], [["*", V("ward", { name: "Recovery ward" })], [4, V("storage", { food: true, name: "Food store" })], [2, "restroom"]], 5, 2),
    exits: [{ side: "back", roles: ["cells", "theatre", "storage"], chance: 0.8, lock: 0.3 }, { side: sideRoom(rng), roles: ["corridor"], chance: 0.5, lock: 0.4 }],
  };
}

function apartments(rng, o = {}) {
  const lay = pickLayout("apartments", rng.state, o); // since #32 (new saves): the corridor block (below), the walk-up, garden apartments, lofts
  if (lay && APT_PLANS[lay.id]) return { ...APT_PLANS[lay.id](rng, o), variant: lay };
  return { ...apartmentsClassic(rng, o), ...(lay ? { variant: lay } : {}) };
}
// A flat as apartments() lays it out (a kitchen-living room, a bedroom and a bathroom when it is wide enough, a studio
// and a bathroom when not), named and unit-marked: the variants' (issue #32). loft: one open room and its bathroom.
function flatOf(f, k, w, loft = false, word = "Apartment") {
  const name = `${word} ${f + 1}${k}`, unit = `${f}${k}`;
  if (loft || w < 8) return w < 6 && !loft ? { role: "apt", name, unit } : { split: "x", parts: [["*", { role: "apt", name, unit, maxBoxes: loft ? 3 : 2 }], [loft ? 3 : 2, { role: "bath", name: `${name}: bathroom`, unit }]] };
  return { split: "x", parts: [["*", { role: "apt", name, unit, maxBoxes: 1 }], [3, { split: "y", parts: [["*", { role: "bedroom", name: `${name}: bedroom`, unit, maxBoxes: 1 }], [2, { role: "bath", name: `${name}: bathroom`, unit }]] }]] };
}
// The apartment blocks' layouts (issue #32):
//   walkup  a walk-up: a central stair hall from the front door to the back, four flats a floor round it, no
//           corridor; 3–4 storeys;
//   garden  garden apartments: three or four low blocks of two storeys round a parking lot (several buildings on one
//           map, spec.compound), each a stair hall between two flats a floor;
//   lofts   a loft conversion of an old mill: big open-plan lofts (one room and a bathroom) off a 2-wide corridor, the
//           freight stair, the bike store; 3–4 storeys.
const APT_PLANS = {
  walkup(rng, o) {
    const bw = rng.int(15, 17), bh = rng.int(13, 15), n = clampN(rng.int(3, 4) + (o.storeyBonus || 0), 3, MAX_STOREYS);
    const fw = Math.floor((bw - 2 - 4 - 2) / 2);
    const floor = (f) => ({ split: "x", parts: [["*", { split: "y", parts: [["*", flatOf(f, "A", fw)], ["*", flatOf(f, "C", fw)]] }], [4, f ? { role: "hall", name: "Landing" } : { role: "lobby", name: "Stair hall", entry: true, type: "house" }], ["*", { split: "y", parts: [["*", flatOf(f, "B", fw)], ["*", flatOf(f, "D", fw)]] }]] });
    return {
      bw, bh, front: { width: 1 }, ground: "city", storeys: n, foot: "medium", extraDoors: 0, stairs: { roles: ["lobby", "hall"], n: 1, len: 3 },
      program: floor(0), upper: (f) => floor(f),
      exits: [{ side: "back", roles: ["lobby"], chance: 0.7, lock: 0.4 }],
    };
  },
  garden(rng) {
    const count = rng.int(3, 4);
    return { ...gardenBlock(rng), compound: { count, key: "apartments", word: "buildings", make: (k, r) => gardenBlock(r), name: (k) => `Building ${String.fromCharCode(65 + k)}`, BW: [12, 16], BH: 11, GAP: 4, CARS: [3, 6], TREES: [4, 8], fences: false } };
  },
  lofts(rng, o) {
    const bw = rng.int(21, 24), bh = rng.int(15, 16), n = clampN(rng.int(3, 4) + (o.storeyBonus || 0), 3, MAX_STOREYS);
    const SW = [3, { role: "stairwell", name: "Freight stair" }];
    const floor = (f) => corridorPlan([["*", flatOf(f, "A", 9, true, "Loft")], SW, [5, f ? { role: "hall", name: "Landing" } : { role: "lobby", entry: true, type: "house" }], ["*", flatOf(f, "B", 9, true, "Loft")]], [["*", flatOf(f, "C", 9, true, "Loft")], [5, { role: "storage", name: f ? "Utility room" : "Bike store", type: "house" }], ["*", flatOf(f, "D", 9, true, "Loft")]], 6, 2);
    return {
      bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "large", extraDoors: 0, stairs: { roles: ["stairwell"], n: 1, len: 3 },
      program: floor(0), upper: (f) => floor(f),
      exits: [{ side: "back", roles: ["storage"], chance: 0.7, lock: 0.3 }, { side: "left", roles: ["corridor"], chance: 0.4, lock: 0.4 }, { side: "right", roles: ["corridor"], chance: 0.4, lock: 0.4 }],
    };
  },
};
// A garden apartments' block: two storeys, a stair hall from the front door between two flats a floor.
function gardenBlock(rng) {
  const bw = rng.int(13, 15), bh = rng.int(10, 11), fw = Math.floor((bw - 2 - 3 - 2) / 2);
  const floor = (f) => ({ split: "x", parts: [["*", flatOf(f, "A", fw)], [3, f ? { role: "hall", name: "Landing" } : { role: "lobby", name: "Stair hall", entry: true, type: "house" }], ["*", flatOf(f, "B", fw)]] });
  return {
    bw, bh, front: { width: 1 }, ground: "town", storeys: 2, foot: "small", extraDoors: 0, stairs: { roles: ["lobby", "hall"], n: 1 },
    program: floor(0), upper: (f) => floor(f),
    exits: [{ side: "back", roles: ["lobby"], chance: 0.6, lock: 0.4 }],
  };
}
function apartmentsClassic(rng, o = {}) {
  const bw = rng.int(18, 22), bh = rng.int(14, 16);
  // 3–6 floors of flats (deeper city blocks taller: o.storeyBonus), a lobby and the maintenance room on the ground floor.
  const n = clampN(rng.int(3, 6) + (o.storeyBonus || 0), 3, MAX_STOREYS);
  const lobby = rng.int(4, 5);
  // A flat (roomlayout.js): a kitchen-living room with a bedroom and a bathroom beside it when it is wide enough (w:
  // its width as the plan will cut it), a studio and a bathroom when not, a studio alone when narrower still; its rooms
  // share a unit (assemble: doors within the flat, the living room's onto the corridor). An older save (o.legacy): one
  // room a flat, as before.
  const flat = (f, k, w = 0) => {
    const name = `Apartment ${f + 1}${k}`, unit = `${f}${k}`;
    if (o.legacy || w < 6) return { role: "apt", name, ...(o.legacy ? {} : { unit }) };
    if (w < 8) return { split: "x", parts: [["*", { role: "apt", name, unit, maxBoxes: 2 }], [2, { role: "bath", name: `${name}: bathroom`, unit }]] };
    return { split: "x", parts: [["*", { role: "apt", name, unit, maxBoxes: 1 }], [3, { split: "y", parts: [["*", { role: "bedroom", name: `${name}: bedroom`, unit, maxBoxes: 1 }], [2, { role: "bath", name: `${name}: bathroom`, unit }]] }]] };
  };
  // The stairwell (2 wide) is a room of its own beside the lobby, a landing over the lobby upstairs: the front band is
  // the same widths on every floor, so the stairwell is at the same place on every floor (assemble pickRuns).
  const fw = Math.floor((bw - 2 - lobby - 2 - 2 - 1) / 2), uw = fw, bk = Math.floor((bw - 2 - 4 - 2) / 2), ub = Math.floor((bw - 2 - 3 - 2) / 2);
  return {
    bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "medium", extraDoors: 0,
    stairs: { roles: ["stairwell"], n: 1, len: 3 },
    program: corridorPlan([["*", flat(0, "A", fw)], [2, { role: "stairwell" }], [lobby, { role: "lobby", entry: true, type: "house" }], ["*", flat(0, "B", fw)]],
      [["*", flat(0, "C", bk)], ["*", flat(0, "D", bk)], [4, { role: "hgarage", name: "Maintenance", type: "garage", lock: ["door", 0.3] }]], 5),
    upper: (f) => corridorPlan([["*", flat(f, "A", uw)], [2, { role: "stairwell" }], [lobby, { role: "hall", name: "Landing" }], ["*", flat(f, "B", uw)]], [["*", flat(f, "C", ub)], ["*", flat(f, "D", ub)], [3, { role: "storage", name: f === 1 ? "Laundry" : "Utility room", type: "house" }]], 5),
    exits: [{ side: "back", roles: ["hgarage"], chance: 0.8, lock: 0.3 }, { side: "left", roles: ["corridor"], chance: 0.4, lock: 0.4 }, { side: "right", roles: ["corridor"], chance: 0.4, lock: 0.4 }],
  };
}

// The buildings: key → { name, make(rng, opts) }. Location types use these through SITES. opts.storeyBonus: extra
// storeys for offices and apartments (the city crawl's deeper blocks).
export const BUILDINGS = {
  house:       { name: "House", make: (r, o) => house(r, "house", o) },
  farmhouse:   { name: "Farmhouse", make: (r, o) => house(r, "farmhouse", o) },
  cabin:       { name: "Cabin", make: (r, o) => house(r, "cabin", o) },
  lodge:       { name: "Hunting lodge", make: (r, o) => house(r, "lodge", o) },
  ranger:      { name: "Ranger station", make: (r, o) => house(r, "ranger", o) },
  grocery:     { name: "Grocery store", make: (r, o) => shop(r, "grocery", o) },
  corner:      { name: "Corner store", make: (r, o) => shop(r, "corner", o) },
  pharmacy:    { name: "Pharmacy", make: (r, o) => shop(r, "pharmacy", o) },
  gunstore:    { name: "Gun store", make: (r, o) => shop(r, "gunstore", o) },
  pawnshop:    { name: "Pawn shop", make: (r, o) => shop(r, "pawnshop", o) },
  // the shops and services of data-shops.js
  sportshop:   { name: "Sporting goods store", make: (r, o) => shop(r, "sportshop", o) },
  electronics: { name: "Electronics store", make: (r, o) => shop(r, "electronics", o) },
  radioshop:   { name: "Radio shop", make: (r, o) => shop(r, "radioshop", o) },
  bookstore:   { name: "Bookstore", make: (r, o) => shop(r, "bookstore", o) },
  petstore:    { name: "Pet store", make: (r, o) => shop(r, "petstore", o) },
  garden:      { name: "Garden center", make: (r, o) => shop(r, "garden", o) },
  clothing:    { name: "Clothing store", make: (r, o) => shop(r, "clothing", o) },
  liquor:      { name: "Liquor store", make: (r, o) => shop(r, "liquor", o) },
  restaurant:  { name: "Restaurant", make: (r, o) => shop(r, "restaurant", o) },
  pizza:       { name: "Pizza place", make: (r, o) => shop(r, "diner", { ...o, kind: "pizza" }) }, // the crawl's (a POI's is the diner under its name, SITES)
  bar:         { name: "Bar", make: (r, o) => shop(r, "bar", o) },
  dealer:      { name: "Car dealership", make: (r, o) => dealer(r, o) },
  bank:        { name: "Bank", make: (r, o) => bank(r, o) },
  library:     { name: "Library", make: (r, o) => library(r, o) },
  vet:         { name: "Veterinary clinic", make: (r, o) => vet(r, o) },
  hardware:    { name: "Hardware store", make: (r, o) => shop(r, "hardware", o) },
  feedstore:   { name: "Feed store", make: (r, o) => shop(r, "feedstore", o) },
  diner:       { name: "Diner", make: (r, o) => shop(r, "diner", o) },
  gasstation:  { name: "Gas station", make: (r, o) => shop(r, "gasstation", o) },
  truckstop:   { name: "Truck stop", make: (r, o) => shop(r, "truckstop", o) },
  supermarket: { name: "Supermarket", make: (r, o) => bigstore(r, "supermarket", o) },
  deptstore:   { name: "Department store", make: (r, o) => bigstore(r, "dept", o) },
  clinic:      { name: "Clinic", make: (r, o) => institution(r, "clinic", o) },
  infirmary:   { name: "Infirmary", make: (r, o) => institution(r, "infirmary", o) },
  hospital:    { name: "Hospital", make: (r, o) => institution(r, "hospital", o) },
  police:      { name: "Police station", make: (r, o) => institution(r, "police", o) },
  school:      { name: "School", make: (r, o) => institution(r, "school", o) },
  offices:     { name: "Office building", make: (r, o) => institution(r, "offices", o) },
  lab:         { name: "Lab building", make: (r, o) => institution(r, "lab", o) },
  barracks:    { name: "Barracks", make: (r) => institution(r, "barracks") },
  armorybldg:  { name: "Armory", make: (r) => institution(r, "armorybldg") },
  cellblock:   { name: "Cell block", make: (r) => institution(r, "cellblock") },
  messhall:    { name: "Mess hall", make: (r) => institution(r, "messhall") },
  control:     { name: "Control building", make: (r) => institution(r, "control") },
  radio:       { name: "Transmitter hut", make: (r) => institution(r, "radio") },
  terminal:    { name: "Terminal", make: (r) => institution(r, "terminal") },
  firestation: { name: "Fire station", make: (r, o) => institution(r, "firestation", o) },
  warehouse:   { name: "Warehouse", make: (r, o) => openfloor(r, "warehouse", o) },
  factory:     { name: "Factory", make: (r, o) => openfloor(r, "factory", o) },
  hangar:      { name: "Hangar", make: (r) => openfloor(r, "hangar") },
  motorpool:   { name: "Motor pool", make: (r) => openfloor(r, "motorpool") },
  autoshop:    { name: "Auto shop", make: (r, o) => openfloor(r, "autoshop", o) },
  garage:      { name: "Garage", make: (r, o) => openfloor(r, "garage", o) },
  workshop:    { name: "Workshop", make: (r, o) => openfloor(r, "workshop", o) },
  machineshed: { name: "Machine shed", make: (r, o) => openfloor(r, "machineshed", o) },
  barn:        { name: "Barn", make: (r, o) => openfloor(r, "barn", o) },
  church:      { name: "Church", make: (r, o) => church(r, o) },
  motel:       { name: "Motel", make: (r, o) => motel(r, o) },
  apartments:  { name: "Apartment block", make: (r, o) => apartments(r, o) },
  // A street of houses (the neighbourhood point of interest): buildingMap builds it with streetMap; make gives one of
  // its houses (the hint, the archetype tests).
  neighbourhood: { name: "Neighbourhood", make: (r, o) => house(r, "house", o), street: true },
};
// The storeys a type can have, [min, max] (the city crawl's bonus can add to offices and apartments, up to MAX_STOREYS).
export const STOREYS_BY_TYPE = {
  // Since #32 a type's range covers all its layouts (buildvariants.js): a ranch house of one storey, a lookout tower of three.
  house: [1, 2], farmhouse: [1, 2], cabin: [1, 2], lodge: [1, 2], ranger: [1, 3],
  grocery: [1, 2], corner: [1, 2], pharmacy: [1, 2], gunstore: [1, 2], pawnshop: [1, 1], hardware: [1, 1], feedstore: [1, 1], diner: [1, 1], gasstation: [1, 1], truckstop: [1, 1],
  supermarket: [1, 2], deptstore: [1, 2],
  clinic: [1, 3], infirmary: [1, 3], hospital: [1, 5], police: [1, 3], school: [2, 3], offices: [3, 8], lab: [1, 3], barracks: [2, 2], armorybldg: [1, 1],
  cellblock: [1, 1], messhall: [2, 2], control: [1, 3], radio: [1, 1], terminal: [1, 3], firestation: [1, 2],
  warehouse: [1, 1], factory: [1, 3], hangar: [1, 1], motorpool: [1, 1], autoshop: [1, 1], garage: [1, 1], workshop: [1, 1], machineshed: [1, 1], barn: [1, 2],
  church: [1, 2], motel: [1, 3], apartments: [2, 6], neighbourhood: [1, 2],
  // the shops and services of data-shops.js (a franchise's plan can add a flat above or more floors)
  sportshop: [1, 2], electronics: [1, 2], radioshop: [1, 2], bookstore: [1, 2], petstore: [1, 2], garden: [1, 2], clothing: [1, 2], liquor: [1, 2],
  restaurant: [1, 2], bar: [1, 2], dealer: [1, 2], bank: [1, 3], library: [1, 3], vet: [1, 2], pizza: [1, 1],
};

// Which buildings stand at a site, by location type (or the terrain, for open land): a list of building keys (or
// [key, name]); one entry opens straight into it (single: true), more (or multi: true) are a choice before the raid,
// with the street map as one more choice. Missing (campgrounds, crash sites, water): the street map only.
export const SITES = {
  // One building.
  pharmacy: ["pharmacy"], gunstore: ["gunstore"], pawnshop: ["pawnshop"], hardware: ["hardware"], grocery: ["grocery"], diner: ["diner"], supermarket: ["supermarket"],
  police: ["police"], clinic: ["clinic"], hospital: ["hospital"], school: ["school"], office: ["offices"], firestation: ["firestation"],
  church: ["church"], motel: ["motel"], apartments: ["apartments"], autoshop: ["autoshop"], feedstore: ["feedstore"], cabin: ["cabin"],
  lodge: ["lodge"], ranger: ["ranger"], radiotower: ["radio"], barn: ["barn"], truckstop: ["truckstop"], gas: ["gasstation"], quarry: ["workshop"],
  // A choice of buildings.
  town: ["house", "corner", "garage", "pharmacy", ["house", "House on the corner"]], city: ["grocery", "pharmacy", "offices", "apartments", "warehouse"],
  farm: ["farmhouse", "barn"], ranch: ["farmhouse", "barn", "machineshed"], mall: ["deptstore", "pharmacy", ["diner", "Food court"], ["warehouse", "Mall stockrooms"]],
  military: ["barracks", "armorybldg", "motorpool", "warehouse"], prison: ["cellblock", "messhall", ["armorybldg", "Guard armory"], "infirmary"],
  univ: ["lab", "offices", ["messhall", "Cafeteria"]], airport: ["hangar", "terminal", "warehouse"], factory: ["factory", "offices"],
  warehouse: ["warehouse", ["warehouse", "Second warehouse"], "offices"], dam: ["control", "workshop", "warehouse"],
  // Points of interest (pois.js): one building each (the raid map a chosen POI opens). The pizza place is the diner
  // archetype under its own name, the farm stand a corner shop's, the shed a machine shed's, the mine shack a
  // cabin's; the neighbourhood a street of 3–5 houses on one map (streetMap). A campsite, a hiker camp and a
  // hunting blind have no building: the street map only (combat.js AREA_SETS).
  house: ["house"], neighbourhood: ["neighbourhood"], garage: ["garage"], corner: ["corner"], pizza: [["diner", "Pizza place"]],
  // the shops and services of data-shops.js: one building each
  sportshop: ["sportshop"], electronics: ["electronics"], radioshop: ["radioshop"], bookstore: ["bookstore"], library: ["library"], petstore: ["petstore"],
  garden: ["garden"], clothing: ["clothing"], vet: ["vet"], dealer: ["dealer"], restaurant: ["restaurant"], bank: ["bank"], bar: ["bar"], liquor: ["liquor"],
  farmstand: [["corner", "Farm stand"]], shed: [["machineshed", "Shed"]], mineshack: [["cabin", "Mine shack"]],
  // Open land (no site).
  suburb: ["house", ["house", "House across the street"], "garage"], plains: ["farmhouse", "barn"],
  forest: { multi: true, list: ["cabin"] }, hills: { multi: true, list: ["cabin"] }, mountain: { multi: true, list: ["cabin"] },
};

// The buildings at a tile: { single, options: [{ id, key, name }] } or null (the street map only).
export function siteBuildings(tile) {
  if (!tile) return null;
  const entry = (tile.loc && SITES[tile.loc.type]) || (!tile.loc && SITES[tile.terrain]) || null;
  if (!entry) return null;
  const list = Array.isArray(entry) ? entry : entry.list;
  const seen = {};
  // shops.js: a single-building site's franchise (its site POI's v; a site POI saved before franchises: none) lays its building out
  const top = tile.loc && Array.isArray(tile.pois) && tile.pois[0] && tile.pois[0].site ? tile.pois[0] : null;
  const fr = top && top.v && list.length === 1 ? { variant: top.v, kind: tile.loc.type } : top && top.lay && list.length === 1 ? { layout: top.lay } : null; // buildvariants.js: a site POI's layout (issue #32)
  const options = list.map((e) => {
    const [key, name] = Array.isArray(e) ? e : [e, null];
    const n = (seen[key] = (seen[key] || 0) + 1);
    return { id: n > 1 ? `${key}:${n}` : key, key, name: name || BUILDINGS[key].name, ...(fr || {}) };
  });
  return { single: !entry.multi && options.length === 1, options };
}

// The building a raid explores (combat.js createRaid): setup.raid.building (an option id, or "street"), else a
// single-building site's own; null for the street map.
export function raidBuilding(state, tile, setup) {
  if (setup && setup.raid && setup.raid.place) return setup.raid.place; // a city crawl's place ({ id, key, name }, citycrawl.js)
  const sb = siteBuildings(tile);
  if (!sb) return null;
  const want = setup && setup.raid ? setup.raid.building : null;
  if (want === "street") return null;
  if (want) return sb.options.find((o) => o.id === want) || null;
  return sb.single ? sb.options[0] : null;
}

// The choice offered before a raid at a site with several buildings: [{ id, key, name, hint, size, rooms }], the street
// map last ({ id: "street" }); null when there is nothing to choose.
// state: the run's raid map dials (World… Raid map): each option's map in tiles, a building's at least that (its plan
// and the outside round it), the street's exactly.
export function buildingOptions(tile, state = null) {
  const sb = siteBuildings(tile);
  if (!sb || sb.single) return null;
  const [bw, bh] = buildingTarget(tile, false, state), [sw, sh] = raidDims(tile, state);
  const out = sb.options.map((o) => {
    const lay = state && state.tiles ? buildingSpec(state, tile.id, o).variant : null; // its layout (buildvariants.js, issue #32): the name it goes by
    return { ...o, ...buildingHint(o.key), map: `${bw} × ${bh}+`, ...(lay ? { layout: lay.id, name: o.name === BUILDINGS[o.key].name ? lay.name : `${o.name} (${lay.name.toLowerCase()})` } : {}) };
  });
  out.push({ id: "street", key: "street", name: "The street", hint: "Search the area around the buildings: small buildings, cars, the open ground (the usual raid map).", size: "", rooms: 0, map: `${sw} × ${sh}` });
  return out;
}

// What a kind of building likely holds (from a sample plan, cached): { hint, size, rooms, holds: [AREAS types], sig: [{ name, n }] }.
const hintCache = new Map();
export function buildingHint(key) {
  let h = hintCache.get(key);
  if (h) return h;
  const spec = BUILDINGS[key].make(new Rng(7919));
  const plan = assemble(new Rng(104729), spec, { key, name: BUILDINGS[key].name });
  const types = plan.rooms.filter((r) => r.type && AREAS[r.type] && !r.outdoor).map((r) => r.type);
  const score = {};
  for (const t of types) for (const [k, [p, lo, hi]] of Object.entries(AREAS[t].loot)) score[k] = (score[k] || 0) + p * (lo + hi) * (k === "ammo" ? 0.1 : 1);
  const sup = Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);
  const gear = types.some((t) => AREAS[t].gear.length);
  const cells = spec.bw * spec.bh;
  const named = [...new Set(plan.rooms.filter((r) => !r.outdoor && r.label !== false).map((r) => r.name.replace(/ \d+[AB]?$/, "")))].slice(0, 6);
  // The rooms by name (a flat's own rooms under its flat; numbers off) with how many the sample has, in plan order:
  // the city crawl's hint line names the kind's signature rooms from them (citycrawl.js placeHint, issue #21).
  const sig = [];
  for (const r of plan.rooms) {
    if (r.outdoor || r.label === false) continue;
    const name = r.name.replace(/:.*$/, "").replace(/ \d+[A-Z]?$/, "");
    const o = sig.find((x) => x.name === name);
    if (o) o.n++; else sig.push({ name, n: 1 });
  }
  h = { hint: `Likely: ${sup.join(", ")}${gear ? ", maybe gear" : ""}. Rooms: ${named.join(", ")}.`, size: cells < 140 ? "small" : cells < 300 ? "medium" : "large", rooms: plan.rooms.filter((r) => !r.outdoor).length, holds: [...new Set(types)], sig };
  hintCache.set(key, h);
  return h;
}

// The map for a raid on a building: the site's own layout (its dice from the world seed, the tile and the building).
// option.storeyBonus: extra storeys (the city crawl's deeper blocks, offices and apartments).
const specSeed = (state, tileId, option) => Math.floor(hash01(state.seed, "bmap", tileId, option.id) * 4294967296);
// variant, kind: the place's franchise and kind (data-shops.js plans); legacy: an older save's plan (worldcfg.js
// legacyRooms: an apartment's flats one room each, no layout variants); layout: a pinned layout variant (a POI's
// poi.lay, buildvariants.js); setting: rural, town or city, the variant's weights (the tile's, buildvariants.js
// settingOfTile).
const makeSpec = (rng, option, legacy = false, tile = null) => BUILDINGS[option.key].make(rng, { storeyBonus: option.storeyBonus || 0, variant: option.variant || null, kind: option.kind || null, legacy, layout: option.layout || null, setting: option.setting || settingOfTile(tile) });
// The archetype's spec for a building at a site (its storeys and footprint) without building the map: the same dice
// buildingMap rolls, so the block card can say how many storeys a place has.
export function buildingSpec(state, tileId, option) {
  return makeSpec(new Rng(specSeed(state, tileId, option)), option, legacyRooms(state), state.tiles ? state.tiles[tileId] : null);
}
export function buildingMap(state, tileId, option, withVehicle) {
  if (BUILDINGS[option.key] && BUILDINGS[option.key].street) { const m = streetMap(state, tileId, option, withVehicle); rollScenes(m, sceneRng(state, tileId, option), option.key); return m; } // a street of houses (the neighbourhood); its scenes (interiorscenes.js) through the houses
  const rng = new Rng(specSeed(state, tileId, option));
  const spec = makeSpec(rng, option, legacyRooms(state), state.tiles ? state.tiles[tileId] : null);
  if (spec.compound) { const m = streetMap(state, tileId, option, withVehicle, spec.compound, spec.variant); rollScenes(m, sceneRng(state, tileId, option), option.key, option.scenes || null); return m; } // several buildings on one map (a motor lodge's cabins, garden apartments: buildvariants.js), laid out as a street's houses are
  // battlesize.js: at least the site's raid map (more outside around a single-building site's plan, a city's or a
  // town's building the run's largest), the new ground topped up with cover. The floor plan itself is the archetype's.
  const tile = state.tiles[tileId], sb = siteBuildings(tile);
  spec.margins = fitMargins(spec.bw, spec.bh, { ...BMAP.MARGIN, ...(spec.margins || {}) }, buildingTarget(tile, !!(sb && sb.single), state));
  const map = assemble(rng, spec, { key: option.key, id: option.id, name: option.name, withVehicle, legacy: legacyRooms(state) });
  densifyOutside(map, rng, tile ? tile.terrain : "plains");
  rollScenes(map, sceneRng(state, tileId, option), option.key, option.scenes || null); // interiorscenes.js: signs of survival (their own dice: the map is as it was); option.scenes: a city crawl place's say (citycrawl.js placeOption)
  return map;
}

// ======================================================================================
// A street of houses (the neighbourhood point of interest, pois.js)
// ======================================================================================
// A neighbourhood opens one raid map with a street of 3–5 houses (STREET.HOUSES, hash dice of the seed, the tile and
// the option id) instead of one building: a road across the middle with a sidewalk each side, a row of houses facing it
// from the north and a row from the south (each built the usual way, front to the street, then turned: its plan
// flipped front to back), side yards between them with a fence down the middle of each back yard (a gate in it), cars
// parked along the kerb (an outdoor area to search: AREAS.wreck), trees, bins and the cover densify adds. Every house
// is the house archetype's own plan (BUILDINGS.house: two storeys with its stairwell; the street's upper floor is one
// grid, "void" between the houses), its rooms, doors, windows, locks and containers made by assemble from dice of its
// own (the street's option id and the house's number) and copied in, so the street is the same every visit. Rooms are
// named after their house ("Kitchen, No. 14"); containers are numbered on across the houses (the first house's first,
// then the street's cars), so the POI's container ledger (poicont.js) keeps each house's containers under their own
// ids: a house nobody went into stays unopened, what you left in one stays there, and the one pool of the POI falls
// as the houses' containers are opened (poiRaidEnd: its share a container, across the whole street). The map fits
// the run's largest raid map (World… Raid map, largest: 56 × 42 as it stands; never narrower or shallower than its houses
// and the two rows of gardens need, 34 deep at least); the ways out are the two ends of the street
// (the west first: the team comes in there with its vehicle, as on a street map) and the back gardens to the north
// and the south. The dead are the site's roster at STREET.DEAD (one house's map has about 0.6 of it: BMAP.DEAD_SCALE
// by its area), placed through the houses and the yards (placeInterior). Stealth, the lights and hearing work as in
// any building: they read the cells and the rooms.
export const STREET = {
  HOUSES: [3, 5],   // houses on the street
  SIDE: 2,          // cells at least from the west and east edges to the first and last house of a row
  GAP: 3,           // the side yard between two houses, at least (a fence down its middle at the back)
  BACK: 3,          // the back gardens behind each row (the north and south ways out)
  FRONT: 1,         // the front yard between a house and the sidewalk (more when the map has room to spare)
  ROAD: 4,          // the road (a lane each way: a parked car never closes it); a sidewalk of one cell each side
  BW: [10, 14],     // a house's width (what three in a row leave), and BH its depth at most: two rows fit 34 cells
  BH: 10,
  CARS: [1, 3],     // cars parked along the kerb (searchable)
  TREES: [3, 6], BINS: [1, 3],
  DEAD: 1.0,        // the dead: the site's roster × this
};
// The neighbourhood's layouts (new saves, buildvariants.js LAYOUTS.neighbourhood) as streetMap defs: the grid street
// is the plan as it always was (null); a cul-de-sac's road ends in a turning circle (one way out by road); a country
// road is dirt between fields, its houses far apart.
const NEIGHBOURHOODS = {
  grid: null,
  culdesac: { closed: "east", allow: ["ranch"] }, // a cul-de-sac of ranch houses
  // the last of its buildings a farm shed (a garage's plan): the country road's houses keep their outbuildings
  rural: { road: "dirt", walk: "dirt", yard: "field", GAP: 8, SIDE: 5, CARS: [0, 1], TREES: [6, 10], BINS: [0, 1], allow: ["twostorey", "ranch", "mobile"],
    make: (k, r, n, o) => (k === n - 1 ? { ...BUILDINGS.garage.make(r, { ...o, layout: "garage" }), key: "garage" } : { ...BUILDINGS.house.make(r, { ...o, street: true, allow: ["twostorey", "ranch", "mobile"] }), key: "house" }),
    name: (k, n, no) => (k === n - 1 ? "Farm shed" : no) },
};
// How many houses stand on a neighbourhood's street (option: the POI's place, poiraid.js poiPlace: id "poi<i>:neighbourhood").
export function streetHouses(state, tileId, option) {
  const [lo, hi] = STREET.HOUSES;
  return lo + Math.min(hi - lo, Math.floor(hash01(state.seed, "streethouses", tileId, option.id) * (hi - lo + 1)));
}
// def (issue #32): another layout of several buildings on one map, laid out the same way (rows facing a road), its
// fields over STREET's: count (the buildings), make(k, rng) (building k's spec), name(k), key (the archetype whose
// styles its rooms take: the option's), word ("cabins", "buildings": the intro's), road, walk and yard (the ground),
// fences (false: none down the back yards), closed ("east": a cul-de-sac's turning circle, no way out by road there).
// No def: the neighbourhood, by its layout (new saves: NEIGHBOURHOODS, buildvariants.js; the grid street is the plan
// as it always was, its houses each of the house's layouts that fit a street); variant: the layout's { id, name }.
export function streetMap(state, tileId, option, withVehicle, def = null, variant = null) {
  if (!def && !legacyRooms(state) && BUILDINGS[option.key] && BUILDINGS[option.key].street) {
    variant = pickLayout("neighbourhood", specSeed(state, tileId, option), { layout: option.layout || null, setting: option.setting || settingOfTile(state.tiles[tileId]) });
    def = variant ? NEIGHBOURHOODS[variant.id] || null : null;
  }
  const S = def ? { ...STREET, ...def } : STREET, legacy = legacyRaids(state);
  // The run's largest raid map (World… Raid map, largest): a neighbourhood's street fills it, as a city's or a town's map
  // does. An older save (worldcfg.js legacyRaids): as it always was, at most Extra-large wide, at least Medium.
  const [MAXW, MAXH] = legacy ? [SIZE_CLASSES.XL.w, SIZE_CLASSES.M.h] : raidMaxDims(state);
  const tile = state.tiles[tileId];
  const rng = new Rng(specSeed(state, tileId, option)); // the street's own dice: the layout of the yards, the cars, the trees
  const n = def && def.count ? def.count : streetHouses(state, tileId, option);
  const hkey = (def && def.key) || (def && def.make ? option.key : "house"); // the archetype the buildings' rooms are styled as
  const perRow = [Math.ceil(n / 2), n - Math.ceil(n / 2)];
  const no0 = 2 + 2 * Math.floor(hash01(state.seed, "streetno", tileId, option.id) * 30); // street numbers: even to the north, odd to the south
  // The houses: each its own plan from its own dice (assemble with a ring of one cell outside: the street's ground replaces it).
  const houses = [];
  for (let k = 0; k < n; k++) {
    const row = k < perRow[0] ? 0 : 1, col = row ? k - perRow[0] : k;
    const id = `${option.id}#${k + 1}`;
    const hr = new Rng(specSeed(state, tileId, { id }));
    const spec = def && def.make ? def.make(k, hr, n, { legacy: legacyRooms(state), setting: settingOfTile(state.tiles[tileId]) }) : BUILDINGS.house.make(hr, { legacy: legacyRooms(state), ...(legacyRooms(state) ? {} : { street: true, setting: settingOfTile(state.tiles[tileId]), ...(def && def.allow ? { allow: def.allow } : {}) }) }); // street: a house's layouts that fit one (buildvariants.js)
    spec.bw = Math.max(S.BW[0], Math.min(spec.bw, S.BW[1], Math.floor((MAXW - 2 * S.SIDE - (perRow[row] - 1) * S.GAP) / perRow[row])));
    spec.bh = Math.min(spec.bh, S.BH);
    spec.margins = { front: 1, back: 1, left: 1, right: 1 };
    spec.ground = "none";
    const ukey = spec.key || hkey; // a building's own archetype (a country road's farm shed)
    const m = assemble(hr, spec, { key: ukey, id, name: BUILDINGS[ukey].name, legacy: legacyRooms(state) });
    houses.push({ k, row, col, m, bw: spec.bw, bh: spec.bh, flip: row === 1, name: def && def.name ? def.name(k, n, `No. ${no0 + 2 * col + row}`) : `No. ${no0 + 2 * col + row}`, x0: 0, y0: 0, rect: null, variant: spec.variant || null });
  }
  // The layout: the north row's fronts in line along the north sidewalk, the south row's along the south one.
  const inRow = (r) => houses.filter((h) => h.row === r);
  const rowW = (r) => inRow(r).reduce((a, h) => a + h.bw, 0) + (perRow[r] - 1) * S.GAP + 2 * S.SIDE;
  const W = legacy ? Math.max(SIZE_CLASSES.M.w, Math.min(MAXW, Math.max(rowW(0), rowW(1)))) : Math.max(MAXW, rowW(0), rowW(1)); // never narrower than its houses need (a small dial: the houses and their yards past it)
  const depth = [0, 1].map((r) => Math.max(...inRow(r).map((h) => h.bh)));
  let front = S.FRONT, road = S.ROAD;
  const tall = () => 2 * S.BACK + depth[0] + depth[1] + 2 + 2 * front + road;
  if (tall() < MAXH) { const extra = MAXH - tall(), fe = Math.floor(extra / 3); front += fe; road += extra - 2 * fe; }
  const H = tall();
  const walkN = S.BACK + depth[0] + front, r0 = walkN + 1, walkS = walkN + road + 1, topS = walkS + front + 1;
  for (const r of [0, 1]) {
    const list = inRow(r), extra = Math.max(0, W - rowW(r)), slots = list.length + 1;
    const share = (j) => Math.floor(extra / slots) + (j < extra % slots ? 1 : 0);
    let x = S.SIDE + share(0);
    list.forEach((h, j) => { h.x0 = x; h.y0 = r === 0 ? S.BACK + depth[0] - h.bh : topS; x += h.bw + S.GAP + share(j + 1); });
  }
  const I = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const ROADF = (def && def.road) || "road", WALKF = (def && def.walk) || "gravel", YARDF = (def && def.yard) || "grass";
  const groundF = (y) => (y === walkN || y === walkS ? WALKF : y > walkN && y < walkS ? ROADF : YARDF);
  const cells = Array.from({ length: W * H }, (_, i) => ({ k: "open", f: groundF((i / W) | 0) }));
  const storeys = Math.max(...houses.map((h) => h.m.storeys || 1));
  const floors = [{ cells, name: "Ground floor" }];
  for (let g = 1; g < storeys; g++) floors.push({ cells: Array.from({ length: W * H }, () => ({ k: "void", f: "air" })), name: g === storeys - 1 ? "Top floor" : `Floor ${g + 1}` });
  // Each house copied in (a south house flipped front to back): its floors' cells, rooms, containers, locked doors, stairs.
  const areas = [], containers = [], lockedDoors = [], stairs = [], runs = [];
  const keep = new Uint8Array(W * H); // stays clear: the ring round each house, the paths to the front doors
  let cid = 1;
  for (const h of houses) {
    const m = h.m, B = m.building, base = areas.length;
    const tx = (x) => h.x0 + (x - B.x0);
    const ty = (y) => (h.flip ? h.y0 + (B.y0 + B.h - 1 - y) : h.y0 + (y - B.y0));
    const rectOf = (r) => ({ x0: tx(r.x0), y0: h.flip ? ty(r.y0 + r.h - 1) : ty(r.y0), w: r.w, h: r.h });
    h.rect = { x0: h.x0, y0: h.y0, w: B.w, h: B.h };
    (m.floors || [{ cells: m.cells }]).forEach((F, g) => {
      const dst = floors[g].cells, cars = new Map(); // a car in the garage: its cells take the id of their new top-left cell
      for (let y = B.y0; y < B.y0 + B.h; y++) for (let x = B.x0; x < B.x0 + B.w; x++) {
        const c = { ...F.cells[y * m.w + x] }, X = tx(x), Y = ty(y);
        if (h.flip && c.k === "stairs" && c.dir >= 2) c.dir = c.dir === 2 ? 3 : 2; // a run's way up, flipped front to back
        if (h.flip && (c.fc === "n" || c.fc === "s")) c.fc = c.fc === "n" ? "s" : "n"; // roomlayout.js: a piece's front turns with the house
        if (c.pc) c.pc += 10000 * (h.k + 1); // and its number is the street's own
        if (h.flip) flipDecoY(c); // a rug's sides, wall art's face turned with the house (decor.js)
        if (c.car) {
          c.car = { ...c.car };
          if (h.flip) { if (c.car.ax === "y") c.car.i = c.car.L - 1 - c.car.i; else c.car.j = 1 - c.car.j; }
          const e = cars.get(c.car.id) || { x: X, y: Y, list: [] };
          e.x = Math.min(e.x, X); e.y = Math.min(e.y, Y); e.list.push(c.car);
          cars.set(c.car.id, e);
        }
        dst[I(X, Y)] = c;
      }
      for (const e of cars.values()) for (const car of e.list) car.id = I(e.x, e.y) + 1;
    });
    for (const a of m.rooms) {
      if (a.outdoor) continue; // none: a house of the street has no ground of its own
      areas.push({ ...a, ...rectOf(a), id: base + a.id, name: `${a.name}, ${h.name}`, doors: (a.doors || []).map(([x, y]) => [tx(x), ty(y)]), house: h.k });
    }
    for (const c of m.containers) {
      const area = areas[base + c.area];
      const what = String(c.label || "").split(": ").slice(1).join(": ") || c.kind;
      containers.push({ ...c, id: cid++, x: tx(c.x), y: ty(h.flip ? c.y + (c.h || 1) - 1 : c.y), area: base + c.area, house: h.k, label: `${area ? area.name : h.name}: ${what}` }); // a piece of 2 rows (roomlayout.js): its top-left once flipped
    }
    for (const d of m.lockedDoors) lockedDoors.push({ ...d, x: tx(d.x), y: ty(d.y), area: d.area == null ? null : base + d.area });
    for (const [x, y] of m.stairs || []) stairs.push([tx(x), ty(y)]);
    for (const r of m.runs || []) runs.push({ ...r, x: tx(r.x), y: ty(r.y), dy: h.flip ? -r.dy : r.dy, house: h.k });
    // The ring round the house stays clear; a path from the front door (and a driveway from a garage's roller door)
    // runs to the sidewalk.
    for (let y = h.y0 - 1; y <= h.y0 + B.h; y++) for (let x = h.x0 - 1; x <= h.x0 + B.w; x++) if (inside(x, y) && !(x >= h.x0 && x < h.x0 + B.w && y >= h.y0 && y < h.y0 + B.h)) keep[I(x, y)] = 1;
    const toward = h.flip ? -1 : 1, walk = h.flip ? walkS : walkN;
    const pathFrom = (x, y, f) => { for (let yy = y + toward; inside(x, yy) && yy !== walk; yy += toward) { keep[I(x, yy)] = 1; cells[I(x, yy)].f = f; } };
    for (const [x, y] of (m.front && m.front.cells) || []) pathFrom(tx(x), ty(y), "gravel");
    for (const ex of m.exits || []) if (ex.roller && ex.side === "front") for (const [x, y] of ex.cells) pathFrom(tx(x), ty(y), "gravel");
    h.front = m.front ? { x: tx(m.front.x), y: ty(m.front.y) } : null;
  }
  // The ways out: both ends of the street, and the back gardens north and south (a side yard between two houses if
  // the row has one, else an end of the row).
  const zy = r0 + Math.floor((road - 3) / 2);
  const zones = [
    { x0: 0, y0: zy, w: 3, h: 3, side: "west", exit: "west", name: def && def.road && def.road !== "road" ? "West end of the drive" : "West end of the street", vehicle: false },
    ...(def && def.closed === "east" ? [] : [{ x0: W - 3, y0: zy, w: 3, h: 3, side: "east", exit: "east", name: def && def.road && def.road !== "road" ? "East end of the drive" : "East end of the street", vehicle: false }]),
  ];
  // A cul-de-sac (def.closed): the road ends in a turning circle at the east end, a fence across its mouth.
  if (def && def.closed === "east") {
    const cx = W - 4, cy = r0 + (road - 1) / 2, rad = road / 2 + 2;
    for (let y = 0; y < H; y++) for (let x = W - 9; x < W; x++) { const d = Math.hypot(x - cx, y - cy); if (d <= rad && cells[I(x, y)].f === YARDF) cells[I(x, y)].f = d > rad - 1 ? WALKF : ROADF; }
  }
  for (const r of [0, 1]) {
    const spans = [];
    let x = 0;
    for (const h of inRow(r)) { spans.push([x, h.x0 - 1]); x = h.x0 + h.bw; }
    spans.push([x, W - 1]);
    const wide = spans.filter(([a, b]) => b - a + 1 >= 3), between = wide.filter(([a, b]) => a > 0 && b < W - 1);
    const [a, b] = rng.pick(between.length ? between : wide) || [0, 2];
    zones.push({ x0: clampN(Math.floor((a + b) / 2) - 1, 0, W - 3), y0: r ? H - 3 : 0, w: 3, h: 3, side: r ? "south" : "north", exit: r ? "south" : "north", name: r ? "Back gardens (south)" : "Back gardens (north)", vehicle: false });
  }
  const reserved = new Uint8Array(W * H);
  for (const z of zones) for (let y = z.y0 - 1; y <= z.y0 + z.h; y++) for (let x = z.x0 - 1; x <= z.x0 + z.w; x++) if (inside(x, y)) reserved[I(x, y)] = 1;
  // Dressing the street: nothing ever cuts a walkable cell off from the west end (locked doors count as ways through).
  const passable = (c) => !!(CELL[c.k] && CELL[c.k].walk) || c.k === "door";
  const start = I(zones[0].x0 + 1, zones[0].y0 + 1);
  // The walk over a byte a cell (as assemble's): passable(cells[i]), kept in step by block and the cars (passAt).
  const pass = new Uint8Array(W * H);
  const passAt = (i) => { pass[i] = passable(cells[i]) ? 1 : 0; };
  const passRect = (r) => { for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) passAt(I(x, y)); };
  let total = 0;
  for (let i = 0; i < cells.length; i++) { passAt(i); total += pass[i]; }
  const seen = new Uint32Array(W * H), stack = new Int32Array(W * H), N = W * H;
  let stamp = 0;
  const connected = () => {
    stamp++;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = stamp;
    let got = 1;
    while (sp) {
      const i = stack[--sp], x = i % W;
      let j = i + 1;
      if (x + 1 < W && seen[j] !== stamp && pass[j]) { seen[j] = stamp; got++; stack[sp++] = j; }
      j = i - 1;
      if (x > 0 && seen[j] !== stamp && pass[j]) { seen[j] = stamp; got++; stack[sp++] = j; }
      j = i + W;
      if (j < N && seen[j] !== stamp && pass[j]) { seen[j] = stamp; got++; stack[sp++] = j; }
      j = i - W;
      if (j >= 0 && seen[j] !== stamp && pass[j]) { seen[j] = stamp; got++; stack[sp++] = j; }
    }
    return got === total;
  };
  const free = (x, y) => inside(x, y) && cells[I(x, y)].k === "open" && !keep[I(x, y)] && !reserved[I(x, y)];
  const block = (x, y, k) => {
    if (!free(x, y)) return false;
    const i = I(x, y), c = cells[i];
    c.k = k; passAt(i); total--;
    if (!connected()) { c.k = "open"; passAt(i); total++; return false; }
    return true;
  };
  // Cars parked along the kerb, a lane each side (a car keeps a free ring: the other lane stays open).
  const wreck = { id: areas.length, type: "wreck", name: AREAS.wreck.name, outdoor: true, f: 0 };
  const lanes = [r0, r0 + road - 2];
  const wantCars = rng.int(S.CARS[0], S.CARS[1]);
  for (let t = 0, placed = 0; t < 60 && placed < wantCars; t++) {
    const x = rng.int(4, W - 9), y = rng.pick(lanes), L = rng.pick(CAR_LEN.car);
    const rect = placeCar(cells, W, H, x, y, "x", L, "car", (cx, cy) => free(cx, cy), rng.int(0, 1e6));
    if (!rect) continue;
    passRect(rect);
    total -= rect.w * rect.h;
    if (!connected()) { removeCar(cells, W, rect); passRect(rect); total += rect.w * rect.h; continue; }
    containers.push({ id: cid++, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, f: 0, area: wreck.id, kind: "car", searched: false, label: `${wreck.name}: car` });
    placed++;
  }
  const carsIn = containers.filter((c) => c.area === wreck.id);
  if (carsIn.length) {
    const xs = carsIn.map((c) => c.x), ys = carsIn.map((c) => c.y);
    Object.assign(wreck, { x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, w: Math.max(...carsIn.map((c) => c.x + c.w)) - Math.min(...xs) + 2, h: Math.max(...carsIn.map((c) => c.y + c.h)) - Math.min(...ys) + 2 });
    areas.push(wreck);
  }
  // Fences down the back yards between two houses (a gate in each), stopping short of the fronts.
  if (!def || def.fences !== false) for (const r of [0, 1]) {
    const list = inRow(r);
    for (let j = 0; j + 1 < list.length; j++) {
      const a = list[j], b = list[j + 1], gx = Math.floor((a.x0 + a.bw + b.x0 - 1) / 2);
      const gate = r ? H - 1 - rng.int(0, S.BACK - 1) : rng.int(0, S.BACK - 1);
      if (r === 0) { for (let y = 0; y <= S.BACK + depth[0] - 3; y++) if (y !== gate) block(gx, y, "fence"); }
      else for (let y = H - 1; y >= topS + 2; y--) if (y !== gate) block(gx, y, "fence");
    }
  }
  // Trees in the yards, bins out the back.
  const yard = (x, y) => cells[I(x, y)].f === YARDF;
  const backYard = (x, y) => yard(x, y) && (y < S.BACK || y >= H - S.BACK);
  const scatter = (k, want, test) => { let placed = 0; for (let t = 0; t < want * 12 && placed < want; t++) { const x = rng.int(0, W - 1), y = rng.int(0, H - 1); if (test(x, y) && block(x, y, k)) placed++; } };
  scatter("tree", rng.int(S.TREES[0], S.TREES[1]), yard);
  scatter("barrel", rng.int(S.BINS[0], S.BINS[1]), backYard);
  // Cover over the open yards (battlesize.js densify; never on the road, the sidewalks, a path or round a house).
  densify(cells, W, H, rng, { target: coverTarget(tile ? tile.terrain : "suburb"), keep: (x, y) => !!keep[I(x, y)] || !!reserved[I(x, y)] || cells[I(x, y)].f !== YARDF, props: () => ["tree", "fence", "fence", "crate", "barrel", "tree"] });
  // The team's vehicle at the west end (laid last: the street is the same with or without it).
  let vehicle = null;
  if (withVehicle) {
    const z = zones[0]; z.vehicle = true;
    vehicle = placeVehicle(cells, W, H, z, withVehicle, (x, y) => inside(x, y) && cells[I(x, y)].k === "open");
    if (!vehicle) { const c = cells[I(z.x0 + 1, z.y0 + 1)]; c.k = "vehicle"; c.f = "road"; }
  }
  const zoneExits = () => zones.slice(1).map((z, j) => ({ side: z.side, name: z.name, x: z.x0 + 1, y: z.y0 + 1, cells: [], locked: null, roller: false, zone: j + 1 }));
  const plan = {
    key: option.key, id: option.id, name: option.name, w: W, h: H, street: true, building: houses[0].rect, buildings: houses.map((h) => ({ ...h.rect })),
    ...(variant ? { variant: { ...variant } } : {}), ...(def && def.word ? { word: def.word } : {}), // the layout (buildvariants.js); what its buildings are called (a motor lodge's "buildings")
    houses: houses.map((h) => ({ k: h.k, name: h.name, row: h.row, ...h.rect, front: h.front, rooms: areas.filter((a) => a.house === h.k).map((a) => a.id), ...(h.variant ? { variant: h.variant.id } : {}) })),
    tall: true, storeys, stairs: stairs.map((s) => s.slice()), runs: runs.map((r) => ({ ...r })),
    rooms: areas.filter((a) => !a.outdoor).map((a) => ({ id: a.id, f: a.f, name: a.name, role: a.role, type: a.type, x0: a.x0, y0: a.y0, w: a.w, h: a.h, locked: a.locked, up: a.up, hub: a.hub, entry: a.entry, house: a.house })),
    front: houses[0].front, exits: zoneExits(),
  };
  return { w: W, h: H, cells, rooms: areas, containers, zones, vehicle, exits: zoneExits(), front: houses[0].front, lockedDoors, plan, building: plan.building, buildings: plan.buildings, floors, stairs, runs, storeys, street: true };
}

// ======================================================================================
// Assembling a building's map
// ======================================================================================
const FLOOR_KINDS = new Set(["open", "loft"]);
const DOORISH = new Set(["idoor", "odoor", "door"]);

// ---------- stair runs (the user's request 2026-10-25, issue #9) ----------
// A stairwell is a straight run: run = { x, y (its bottom step), dx, dy (one step up the run), len (steps), f0, f1
// (the lowest and highest floor it joins), out ("left" / "right": an outside stair along that side wall, the motel's),
// single (a one-cell stairwell in a footprint too small for a run: len 1, no landings) }. Its steps are "stairs" cells
// on every floor it joins (c.dir: the way up, an index of STAIR_DIRS; c.step 1…len; c.top on the top step, the one
// cell where Go up / Go down change floor: combat.js stairOptions); a landing cell at each end stays walkable floor
// (c.landing). An older save's one-cell stairwells have no run (b.raid.runs missing) and no c.step: every stairs cell
// changes floor, as it always did.
export const STAIR_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const stairDir = (dx, dy) => STAIR_DIRS.findIndex(([a, b]) => a === dx && b === dy);
/** The steps of a run, bottom first. @param {any} r @returns {number[][]} */
export const runSteps = (r) => Array.from({ length: r.len }, (_, i) => [r.x + i * r.dx, r.y + i * r.dy]);
/** The top step: the cell that changes floor. @param {any} r */
export const runTop = (r) => [r.x + (r.len - 1) * r.dx, r.y + (r.len - 1) * r.dy];
/** The landings, [bottom, top] ([] for a one-cell stairwell). @param {any} r @returns {number[][]} */
export const runLandings = (r) => (r.single ? [] : [[r.x - r.dx, r.y - r.dy], [r.x + r.len * r.dx, r.y + r.len * r.dy]]);
/** A stairs cell that changes floor: a run's top step, or any cell of an older save's one-cell stairwells. @param {any} c */
export const stairTop = (c) => !!c && c.k === "stairs" && (c.step == null || !!c.top);
// The landing cells of a raid's stairwells (b.raid.runs; none in an older save's).
export const landingsOf = (R) => ((R && R.runs) || []).flatMap(runLandings);
// Free cells by the stairwells on one floor's grid, for the dead and the watchers who wait there: the landings first,
// else the walkable cells next to a landing (never a step), else (an older save's one-cell stairwells) the cells next
// to a stairwell cell. ok(x, y): walkable and free.
export function stairWaits(R, ok) {
  const lands = landingsOf(R).filter(([x, y]) => ok(x, y));
  if (lands.length) return lands;
  const out = [], seen = new Set();
  const from = landingsOf(R).length ? landingsOf(R) : (R && R.stairs) || [];
  for (const [sx, sy] of from) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = sx + dx, y = sy + dy, key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (ok(x, y)) out.push([x, y]);
  }
  return out;
}

// Storeys: the ground floor (f = 0) is built here with the outside around it; each upper floor is built by a call of its
// own (opts._floor ≥ 1: that floor's plan from spec.upper, the stairwell cells the ground floor chose, "void" outside
// the walls, no doors to the outside and no zones) and merged into the ground floor's result: result.floors[f] =
// { cells, name }, result.stairs = [[x, y]...], rooms and containers of every floor in one list with f on each (room
// ids run on across the floors, so areas[id] is the room with that id).
export function assemble(rng, spec, opts = {}) {
  const M = { ...BMAP.MARGIN, ...(spec.margins || {}) };
  const bw = spec.bw, bh = spec.bh;
  const W = bw + M.left + M.right, H = bh + M.front + M.back;
  const bx0 = M.left, by0 = M.back, bx1 = bx0 + bw - 1, by1 = by0 + bh - 1;
  const G = GROUNDS[spec.ground] || GROUNDS.town;
  const f = opts._floor || 0, upper = f > 0;
  const storeys = Math.max(1, typeof spec.storeys === "number" ? Math.min(MAX_STOREYS, Math.round(spec.storeys)) : 1);
  const cells = Array.from({ length: W * H }, (_, i) => {
    if (upper) return { k: "void", f: "air" };
    const y = (i / W) | 0;
    return { k: "open", f: y < by0 ? G.alley : y === by1 + 1 ? G.walk : y > by1 + 1 ? G.street : G.yard };
  });
  const rid = new Int16Array(W * H).fill(-2); // -2 outside, -1 wall, ≥ 0 a room
  const I = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const at = (x, y) => (inside(x, y) ? cells[I(x, y)] : null);
  const inBldg = (x, y) => x >= bx0 && x <= bx1 && y >= by0 && y <= by1;
  const rooms = [];
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    const edge = x === bx0 || x === bx1 || y === by0 || y === by1;
    const c = cells[I(x, y)];
    c.f = "floor"; c.k = edge ? "wall" : "open";
    rid[I(x, y)] = edge ? -1 : -3;
  }

  // ---------- the floor plan ----------
  const wallLine = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { cells[I(x, y)].k = "wall"; rid[I(x, y)] = -1; } };
  function fit(parts, len) {
    const n = parts.length, avail = len - (n - 1);
    const mins = parts.map(([s]) => (typeof s === "number" && s >= 1 ? Math.min(2, Math.round(s)) : 2)); // a corridor or a hall can be 1 wide
    if (avail < mins.reduce((a, v) => a + v, 0)) return null;
    const sz = parts.map(([s]) => (typeof s === "number" ? (s >= 1 ? Math.round(s) : Math.max(2, Math.round(s * avail))) : 0));
    const flex = parts.map(([s], i) => (typeof s === "number" ? -1 : i)).filter((i) => i >= 0);
    let rest = avail - sz.reduce((a, v) => a + v, 0);
    const need = 2 * flex.length;
    while (rest < need) { // too tight: shrink the biggest fixed part
      let bi = -1;
      sz.forEach((v, i) => { if (!flex.includes(i) && v > mins[i] && (bi < 0 || v > sz[bi])) bi = i; });
      if (bi < 0) return null;
      sz[bi]--; rest++;
    }
    if (flex.length) {
      const each = Math.floor(rest / flex.length);
      let extra = rest - each * flex.length;
      for (const i of flex) { sz[i] = each + (extra > 0 ? 1 : 0); extra--; }
    } else if (rest) {
      let bi = 0;
      sz.forEach((v, i) => { if (v > sz[bi]) bi = i; });
      sz[bi] += rest;
    }
    return sz.every((v, i) => v >= mins[i]) ? sz : null;
  }
  const firstLeaf = (n) => (n.role ? n : firstLeaf(n.parts[0][1]));
  function carve(node, r) {
    if (node.role) return addRoom(node, r);
    const axis = node.split, len = axis === "x" ? r.w : r.h;
    let parts = node.parts.slice(), sizes = fit(parts, len);
    while (!sizes && parts.length > 1) { parts = parts.slice(0, -1); sizes = fit(parts, len); }
    if (!sizes) return addRoom(firstLeaf(node), r);
    let pos = axis === "x" ? r.x0 : r.y0 + r.h;
    parts.forEach(([, child], i) => {
      const s = sizes[i], last = i === parts.length - 1;
      if (axis === "x") {
        carve(child, { x0: pos, y0: r.y0, w: s, h: r.h });
        pos += s;
        if (!last) { wallLine(pos, r.y0, pos, r.y0 + r.h - 1); pos++; }
      } else {
        pos -= s;
        carve(child, { x0: r.x0, y0: pos, w: r.w, h: s });
        if (!last) { pos--; wallLine(r.x0, pos, r.x0 + r.w - 1, pos); }
      }
    });
  }
  function addRoom(node, r) {
    const { role: rk, ...over } = node;
    const room = { ...ROLES[rk], ...over, role: rk, id: rooms.length, ix0: r.x0, iy0: r.y0, iw: r.w, ih: r.h, doors: [], up: false };
    rooms.push(room);
    for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) { rid[I(x, y)] = room.id; cells[I(x, y)].k = "open"; cells[I(x, y)].fl = room.fl || "wood"; }
  }
  carve(upper ? opts._program : spec.program, { x0: bx0 + 1, y0: by0 + 1, w: bw - 2, h: bh - 2 });
  const touches = (room, side) => (side === "front" ? room.iy0 + room.ih - 1 === by1 - 1 : side === "back" ? room.iy0 === by0 + 1 : side === "left" ? room.ix0 === bx0 + 1 : room.ix0 + room.iw - 1 === bx1 - 1);
  let entry = upper ? null : rooms.find((r) => r.entry && touches(r, "front")) || rooms.find((r) => r.hub && touches(r, "front")) || rooms.find((r) => touches(r, "front")) || rooms[0];
  // ---------- the stairwells (storeys) ----------
  // Stair runs (STAIR_DIRS above): the ground floor picks one or two (spec.stairs.n, else two from a footprint of
  // BMAP.STOREY.twoStairs cells) against a wall of the rooms spec.stairs.roles names by the building's kind (a house's
  // hall or living room by the front, a shop's back room, a stairwell room of its own in flats and offices, each end
  // of a hospital's or a school's corridor), else the hubs, else the entry: a run of spec.stairs.len steps (2; 3 in the
  // big buildings; shorter where a room is too short) and its two landings in one room, parallel to the wall, with a
  // free lane of the room beside every step. A motel's (spec.stairs.out) is an outside stair along a side wall, up to
  // the walkway. No room fits a run (a cabin's, a shed's footprint): the one-cell stairwell at a room's centre, as
  // before. The upper floors get the same cells, opened where their own plan put a wall there. No door is ever put
  // where a step is its only approach (stepAt: outerDoor, innerDoor).
  const SP = { len: 2, ...(spec.stairs || {}) };
  const runs = upper ? opts._runs.map((r) => ({ ...r })) : storeys > 1 ? pickRuns() : [];
  for (const r of runs) { r.f0 = 0; r.f1 = storeys - 1; }
  function pickRuns() {
    const want = SP.n || (bw * bh >= BMAP.STOREY.twoStairs ? 2 : 1);
    if (SP.out) { // an outside stair along the side wall, its top landing by the back corner (the walkway upstairs)
      const sx = SP.out === "left" ? bx0 - 1 : bx1 + 1;
      for (let len = SP.len; len >= 2; len--) if (by0 + 2 + len <= by1 && sx >= 1 && sx < W - 1) return [{ x: sx, y: by0 + 1 + len, dx: 0, dy: -1, len, out: SP.out }];
    }
    const seed = rng.state; // read, not consumed: the rest of the plan rolls as before
    const roles = SP.roles || [];
    const rank = (r) => { const i = roles.indexOf(r.role); return i >= 0 ? i : roles.length + (r.hub && r !== entry ? 0 : r === entry ? 1 : 2); };
    const cands = [];
    for (const room of rooms) {
      if (room.lock) continue; // never behind a door that may be locked
      for (let len = SP.len; len >= 2; len--) {
        const L = len + 2;
        // Along x against the back or front wall (the lane a row in), along y against the left or right wall.
        const lines = [];
        if (room.ih >= 2 && room.iw >= L) for (const [wy, lane] of [[room.iy0, 1], [room.iy0 + room.ih - 1, -1]]) for (let x0 = room.ix0; x0 + L <= room.ix0 + room.iw; x0++) lines.push({ x0, y0: wy, ax: [1, 0], wall: [0, -lane], lane: [0, lane] });
        if (room.iw >= 2 && room.ih >= L) for (const [wx, lane] of [[room.ix0, 1], [room.ix0 + room.iw - 1, -1]]) for (let y0 = room.iy0; y0 + L <= room.iy0 + room.ih; y0++) lines.push({ x0: wx, y0, ax: [0, 1], wall: [-lane, 0], lane: [lane, 0] });
        for (const ln of lines) for (const up of [1, -1]) {
          const dx = ln.ax[0] * up, dy = ln.ax[1] * up;
          const first = up > 0 ? [ln.x0 + ln.ax[0], ln.y0 + ln.ax[1]] : [ln.x0 + ln.ax[0] * len, ln.y0 + ln.ax[1] * len]; // the bottom step
          const run = { x: first[0], y: first[1], dx, dy, len };
          const steps = runSteps(run), lands = runLandings(run);
          // The wall behind: an outer wall best, a room that is no hub next, a hub's (its doors) worst.
          let s = rank(room) * 100 + (SP.len - len) * 20;
          for (const [x, y] of steps) {
            const bx = x + 2 * ln.wall[0], by = y + 2 * ln.wall[1];
            const beyond = inBldg(bx, by) ? rid[I(bx, by)] : -2;
            s += beyond === -2 ? -1 : beyond >= 0 && rooms[beyond].hub ? 1 : 0;
          }
          if (SP.near === "front") { const [bx, by] = lands[0]; s += (by1 - 1 - by) * 1.5 + (dy < 0 ? -1 : 0) + Math.abs(bx - (room.ix0 + room.iw / 2)) * 0.2; } // up from by the front door, toward the back
          const mid = [(steps[0][0] + steps[len - 1][0]) / 2, (steps[0][1] + steps[len - 1][1]) / 2];
          const along = room.iw >= room.ih ? Math.abs(mid[0] - (room.ix0 + (room.iw - 1) / 2)) : Math.abs(mid[1] - (room.iy0 + (room.ih - 1) / 2));
          if (SP.ends) s -= along * 0.5; // a corridor's: by its ends
          s += hash01(seed, "stairs", run.x, run.y, dx, dy) * 0.9;
          cands.push({ run, room, s, mid, cells: [...steps, ...lands] });
        }
      }
    }
    cands.sort((a, c) => a.s - c.s);
    const out = [];
    if (cands.length) {
      out.push(cands[0]);
      if (want >= 2) {
        const far = (c) => Math.hypot(c.mid[0] - out[0].mid[0], c.mid[1] - out[0].mid[1]);
        const apart = (c) => c.cells.every(([x, y]) => out[0].cells.every(([u, v]) => Math.max(Math.abs(x - u), Math.abs(y - v)) >= 2));
        const second = cands.filter((c) => far(c) >= 6 && apart(c)).sort((a, c) => a.s - far(a) * 0.5 - (c.s - far(c) * 0.5))[0];
        if (second) out.push(second);
      }
      return out.map((c) => c.run);
    }
    // Too small for a run: the one-cell stairwell at the centre of a hub (else the entry), as before.
    const byArea = (a, b) => b.iw * b.ih - a.iw * a.ih;
    const first = [...rooms.filter((r) => r.hub && r !== entry).sort(byArea), entry, ...rooms.filter((r) => !r.hub && r !== entry).sort(byArea)][0];
    return [{ x: first.ix0 + Math.floor(first.iw / 2), y: first.iy0 + Math.floor(first.ih / 2), dx: 0, dy: 0, len: 1, single: true }];
  }
  const stepAt = new Uint8Array(W * H); // a run's steps on this floor (no door opens onto one)
  for (const run of runs) {
    const steps = runSteps(run), lands = runLandings(run);
    for (const [x, y] of [...steps, ...lands]) {
      const i = I(x, y);
      if (rid[i] === -1 && inBldg(x, y)) { // an inner wall of this floor's plan: the stairwell opens it
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => rid[I(x + dx, y + dy)]).find((r) => r >= 0);
        rid[i] = nb ?? 0;
        cells[i].k = "open";
        cells[i].fl = rooms[rid[i]].fl || "wood";
      }
      if (run.out) { // an outside stair: open air beside the building (upstairs: a concrete flight where the void was)
        if (upper) cells[i] = { k: "open", f: "floor", fl: "conc" };
        cells[i].openair = true;
      }
    }
    steps.forEach(([x, y], s) => {
      const c = cells[I(x, y)];
      c.k = "stairs"; c.step = s + 1; c.len = run.len;
      if (!run.single) c.dir = stairDir(run.dx, run.dy);
      if (s === run.len - 1) c.top = true;
      stepAt[I(x, y)] = 1;
    });
    for (const [x, y] of lands) { const c = cells[I(x, y)]; c.k = "open"; c.landing = true; }
  }
  const stairCells = runs.map(runTop); // the cells that change floor (result.stairs, b.raid.stairs)
  const nearStep = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inside(x + dx, y + dy) && stepAt[I(x + dx, y + dy)]);
  if (upper) entry = rooms[rid[I(stairCells[0][0], stairCells[0][1])]] || rooms.find((r) => r.hub) || rooms[0];
  entry.entry = true;
  for (const r of rooms) if (r !== entry && r.entry) r.entry = false;
  // Numbered names for rooms that share one (Bedroom 1, Bedroom 2).
  const byName = {};
  for (const r of rooms) (byName[r.name] = byName[r.name] || []).push(r);
  for (const list of Object.values(byName)) if (list.length > 1 && list[0].label !== false) list.forEach((r, i) => { r.name = `${r.name} ${i + 1}`; });
  // Locked rooms and an upper floor, by the dice.
  for (const r of rooms) if (r.lock && r !== entry && rng.chance(r.lock[1])) r.locked = r.lock[0];
  const ST = upper ? null : spec.loft || null; // a raised room on this one grid (a barn's hayloft); real storeys are separate floors
  if (ST && rng.chance(ST.chance)) for (const r of rooms) if (ST.roles.includes(r.role) && r !== entry && !r.locked) r.up = true;

  // ---------- doors ----------
  const OUT = rooms.length;
  const uf = Array.from({ length: rooms.length + 1 }, (_, i) => i);
  const find = (a) => { while (uf[a] !== a) { uf[a] = uf[uf[a]]; a = uf[a]; } return a; };
  const union = (a, b) => { uf[find(a)] = find(b); };
  const doors = []; // { x, y, a, b (room ids; b = OUT for an outer door), ext, side, roller, exit }
  const doorAt = new Set();
  // Outer wall cells by side, with the room inside each.
  const sideCells = (side) => {
    const out = [];
    if (side === "front" || side === "back") { const y = side === "front" ? by1 : by0, iy = side === "front" ? by1 - 1 : by0 + 1; for (let x = bx0 + 1; x < bx1; x++) out.push({ x, y, ix: x, iy, ox: x, oy: side === "front" ? by1 + 1 : by0 - 1 }); }
    else { const x = side === "left" ? bx0 : bx1, ix = side === "left" ? bx0 + 1 : bx1 - 1; for (let y = by0 + 1; y < by1; y++) out.push({ x, y, ix, iy: y, ox: side === "left" ? bx0 - 1 : bx1 + 1, oy: y }); }
    return out;
  };
  // The front door (and a motel room's own door) joins its room to the outside; the other exits do not count for the
  // rooms' doors, so the inside is always connected without going round the building.
  function outerDoor(side, ok, width = 1, roller = false, joins = true, onStep = false) {
    const list = sideCells(side);
    const cands = [];
    for (let i = 0; i + width <= list.length; i++) {
      const run = list.slice(i, i + width);
      const r0 = rid[I(run[0].ix, run[0].iy)];
      if (r0 < 0 || !run.every((s) => rid[I(s.ix, s.iy)] === r0) || !ok(rooms[r0])) continue;
      if (run.some((s) => doorAt.has(I(s.x, s.y)))) continue;
      const before = list[i - 1], after = list[i + width];
      if ((before && doorAt.has(I(before.x, before.y))) || (after && doorAt.has(I(after.x, after.y)))) continue;
      const room = rooms[r0];
      const mid = side === "front" || side === "back" ? room.ix0 + (room.iw - width) / 2 : room.iy0 + (room.ih - width) / 2;
      const p = side === "front" || side === "back" ? run[0].x : run[0].y;
      const score = Math.abs(p - mid) + rng.next() * 2.5; // (drawn first: the dice after it are as they were without the runs)
      if (!onStep && run.some((s) => stepAt[I(s.ix, s.iy)] || (inside(s.ox, s.oy) && stepAt[I(s.ox, s.oy)]))) continue; // a stair run's step is no door's approach
      cands.push({ run, room, score });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => a.score - b.score);
    const { run, room } = cands[0];
    const made = [];
    for (const s of run) {
      const c = cells[I(s.x, s.y)];
      c.k = "idoor";
      if (roller) c.roll = true;
      doorAt.add(I(s.x, s.y));
      const d = { x: s.x, y: s.y, a: room.id, b: OUT, ext: true, side, ix: s.ix, iy: s.iy, ox: s.ox, oy: s.oy };
      doors.push(d); made.push(d);
      room.doors.push([s.x, s.y]);
    }
    if (joins) union(room.id, OUT);
    return { side, room: room.id, cells: made.map((d) => [d.x, d.y]), x: made[0].x, y: made[0].y, ox: made[0].ox, oy: made[0].oy, roller };
  }
  // An upper floor has no doors to the outside: its stairwell's room stands for the way in.
  if (upper) union(entry.id, OUT);
  // An outside stair (the motel's): upstairs, a door in the side wall from its top landing onto the walkway.
  if (upper) for (const run of runs) if (run.out) {
    const [lx, ly] = runLandings(run)[1];
    const wx = run.out === "left" ? bx0 : bx1, ix = run.out === "left" ? bx0 + 1 : bx1 - 1, r = rid[I(ix, ly)];
    if (r < 0) continue;
    cells[I(wx, ly)].k = "idoor";
    doorAt.add(I(wx, ly));
    doors.push({ x: wx, y: ly, a: r, b: OUT, ext: true, side: run.out, ix, iy: ly, ox: lx, oy: ly });
    rooms[r].doors.push([wx, ly]);
    union(r, OUT);
  }
  const front = upper ? null : outerDoor("front", (r) => r === entry, (spec.front && spec.front.width) || 1, false) || outerDoor("front", (r) => r === entry, 1, false) ||
    outerDoor("front", (r) => !r.locked && !r.up, 1, false) || outerDoor("front", () => true, 1, false) || outerDoor("front", () => true, 1, false, true, true);
  if (!upper && spec.unitDoors) for (const r of rooms) if (r.role === spec.unitDoors && touches(r, "front")) outerDoor("front", (q) => q === r, 1, false);
  if (!upper) for (const r of rooms) { // a room with a door of its own to the outside (a variant's: a duplex's second home, a motel's shed, an ice and vending nook); ownDoor: true (the front) or the side
    const side = r.ownDoor === true ? "front" : r.ownDoor;
    if (side && r !== entry && !r.lock && touches(r, side)) outerDoor(side, (q) => q === r, 1, false);
  }
  const exits = [];
  if (!upper) for (const e of spec.exits || []) {
    if (!rng.chance(e.chance)) continue;
    const allowed = (r) => !r.locked && !r.up;
    const made = outerDoor(e.side, (r) => allowed(r) && (!e.roles || e.roles.includes(r.role)), e.width || 1, !!e.roller, false) ||
      (e.width > 1 ? outerDoor(e.side, (r) => allowed(r) && (!e.roles || e.roles.includes(r.role)), 1, !!e.roller, false) : null);
    if (!made) continue;
    made.name = e.name || (e.roller ? "Roller door" : e.side === "back" ? "Back door" : e.side === "front" ? "Side entrance" : "Side door");
    made.locked = rng.chance(e.lock || 0) ? "door" : null;
    exits.push(made);
  }
  // Inner doors: a spanning tree (rooms open onto the hubs; a locked room or an upper floor has one way in), then a
  // few extra doors.
  const pairs = new Map();
  for (let y = by0 + 1; y < by1; y++) for (let x = bx0 + 1; x < bx1; x++) {
    if (rid[I(x, y)] !== -1) continue;
    const L = rid[I(x - 1, y)], R = rid[I(x + 1, y)], U = rid[I(x, y - 1)], D = rid[I(x, y + 1)];
    const add = (a, b) => { const key = a < b ? `${a},${b}` : `${b},${a}`; if (!pairs.has(key)) pairs.set(key, { a: Math.min(a, b), b: Math.max(a, b), cells: [] }); pairs.get(key).cells.push([x, y]); };
    if (L >= 0 && R >= 0 && L !== R && U === -1 && D === -1) add(L, R);
    if (U >= 0 && D >= 0 && U !== D && L === -1 && R === -1) add(U, D);
  }
  const edges = [...pairs.values()].map((p) => {
    const A = rooms[p.a], B = rooms[p.b];
    let w = rng.next() * 0.6 - Math.min(6, p.cells.length) * 0.15; // a longer shared wall first
    if (!A.hub && !B.hub) w += 2;
    if (A.unit || B.unit) { // a flat's rooms (apartments): doors within the flat, only its living room's onto the corridor
      if (A.unit && B.unit && A.unit !== B.unit) w += 8;
      else if (!A.unit || !B.unit) { const u = A.unit ? A : B; if (u.role !== "apt" && !u.opens) w += 3; } // opens: the unit's room that opens onto the corridor (a motel's room, not its bathroom)
    }
    if (A.hub && B.hub) w -= 0.6; // hubs open onto each other
    if (A.locked || B.locked) w += 4;
    if (A.up !== B.up) w += (A.up ? B.hub : A.hub) ? 1 : 50;
    if (A.role === "stairwell" || B.role === "stairwell") w += A.hub || B.hub ? 0 : 3; // a stairwell opens onto the lobby, the landing or the corridor
    const free = p.cells.filter(([x, y]) => !nearStep(x, y)); // a door never opens onto a step
    return { ...p, cells: free.length ? free : p.cells, blocked: !free.length, all: p.cells.length, w };
  }).sort((a, b) => a.w - b.w);
  const inner = (e) => doors.some((d) => !d.ext && ((d.a === e.a && d.b === e.b) || (d.a === e.b && d.b === e.a)));
  function innerDoor(e) {
    const cs = e.cells.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const jig = (e.all ?? cs.length) > 4 ? rng.int(-1, 1) : 0; // drawn by the whole wall's length: the dice after it are as they were without the runs
    const mid = Math.floor(cs.length / 2) + (cs.length > 4 ? jig : 0);
    let pick = cs[Math.max(0, Math.min(cs.length - 1, mid))];
    // Not right next to another door.
    const near = (p) => doors.some((d) => Math.abs(d.x - p[0]) + Math.abs(d.y - p[1]) <= 1);
    if (near(pick)) pick = cs.find((p) => !near(p)) || pick;
    doors.push({ x: pick[0], y: pick[1], a: e.a, b: e.b, ext: false });
    doorAt.add(I(pick[0], pick[1]));
    rooms[e.a].doors.push(pick); rooms[e.b].doors.push(pick);
    union(e.a, e.b);
  }
  const ok1 = (e) => {
    const A = rooms[e.a], B = rooms[e.b];
    if ((A.locked && A.doors.length) || (B.locked && B.doors.length)) return false;
    if (A.up !== B.up) { const low = A.up ? B : A, high = A.up ? A : B; if (!low.hub || high.stair) return false; }
    return true;
  };
  for (const e of edges) if (find(e.a) !== find(e.b) && !e.blocked && ok1(e)) { innerDoor(e); const A = rooms[e.a], B = rooms[e.b]; if (A.up !== B.up) (A.up ? A : B).stair = true; }
  const allIn = () => rooms.every((r) => find(r.id) === find(OUT));
  if (!allIn()) {
    // A room left out: allow a second door into a locked room, then bring an upper floor down to the ground.
    for (const e of edges) if (find(e.a) !== find(e.b) && !e.blocked && rooms[e.a].up === rooms[e.b].up) innerDoor(e);
    for (const r of rooms) if (find(r.id) !== find(OUT)) r.up = false;
    for (const e of edges) if (find(e.a) !== find(e.b) && !e.blocked && rooms[e.a].up === rooms[e.b].up) innerDoor(e);
    for (const e of edges) if (find(e.a) !== find(e.b) && rooms[e.a].up === rooms[e.b].up) innerDoor(e); // the last resort: beside a step
  }
  for (const e of edges) {
    const A = rooms[e.a], B = rooms[e.b];
    if (inner(e) || e.blocked || A.locked || B.locked || A.up !== B.up || A.role === "stairwell" || B.role === "stairwell") continue; // a stairwell has its one door
    if ((A.unit || B.unit) && A.unit !== B.unit) continue; // never a second way into a flat
    if (rng.chance(spec.extraDoors ?? BMAP.EXTRA_DOOR)) innerDoor(e);
  }
  // Upper floors: a stair down to the hub at its door; an upper room whose door does not lead to a hub comes down.
  const upDoors = doors.filter((d) => !d.ext && rooms[d.a].up !== rooms[d.b].up);
  for (const r of rooms) if (r.up && !upDoors.some((d) => d.a === r.id || d.b === r.id) && !doors.some((d) => !d.ext && (d.a === r.id || d.b === r.id) && rooms[d.a].up && rooms[d.b].up)) r.up = false;
  const tall = rooms.some((r) => r.up) || (!upper && storeys > 1); // two-storey walls on the ground floor of a building with storeys
  // The doors' cells.
  const lockedDoors = [];
  const keep = new Uint8Array(W * H); // stays walkable: door sides, stairs
  for (const run of runs) for (const [x, y] of [...runSteps(run), ...runLandings(run)]) keep[I(x, y)] = 1; // the steps and the landings stay clear
  for (const d of doors) {
    const c = cells[I(d.x, d.y)];
    if (d.ext) { keep[I(d.ix, d.iy)] = 1; if (inside(d.ox, d.oy)) keep[I(d.ox, d.oy)] = 1; continue; }
    const A = rooms[d.a], B = rooms[d.b];
    const locked = A.locked ? A : B.locked ? B : null;
    if (locked) { c.k = "door"; lockedDoors.push({ x: d.x, y: d.y, area: locked.id, kind: locked.locked }); }
    else c.k = rng.chance(spec.openDoors ?? BMAP.OPEN_DOOR) ? "odoor" : "idoor";
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (rid[I(d.x + dx, d.y + dy)] >= 0) keep[I(d.x + dx, d.y + dy)] = 1;
    if (A.up && B.up) c.h = 1;
    else if (A.up !== B.up) {
      c.h = 1;
      const low = A.up ? B : A;
      const st = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [d.x + dx, d.y + dy]).find(([x, y]) => rid[I(x, y)] === low.id);
      if (st) { cells[I(st[0], st[1])].k = ST && ST.ladder ? "ladder" : "stairs"; keep[I(st[0], st[1])] = 1; }
    }
  }
  for (const ex of exits) if (ex.locked) for (const [x, y] of ex.cells) { cells[I(x, y)].k = "door"; delete cells[I(x, y)].roll; lockedDoors.push({ x, y, area: null, kind: "door", exit: true }); }
  for (const r of rooms) if (r.up) for (let y = r.iy0; y < r.iy0 + r.ih; y++) for (let x = r.ix0; x < r.ix0 + r.iw; x++) { const c = cells[I(x, y)]; if (c.k === "open") c.k = "loft"; c.h = 1; }
  if (tall) for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) { const c = cells[I(x, y)]; if (c.k === "wall" || c.k === "idoor" || c.k === "door") c.t = 2; }

  // ---------- windows ----------
  // Each gets its state (windows.js: unlocked, locked or fixed) from hash dice of the map's seed as it stands (rng.state
  // read, not consumed: the map's other rolls are as before), by the building's mix (houses mostly open, shop fronts
  // and offices mostly fixed).
  const winMix = winMixOf(opts.key), winSeed = rng.state;
  for (const side of ["front", "back", "left", "right"]) {
    let n = rng.int(0, BMAP.WINDOW_GAP - 1);
    for (const s of sideCells(side)) {
      const c = cells[I(s.x, s.y)], r = rid[I(s.ix, s.iy)];
      if (c.k !== "wall" || r < 0) { n = 0; continue; }
      const room = rooms[r];
      if (room.windows === false || spec.windows === false) continue;
      if (room.glass) { c.k = "window"; c.win = rollWin(winSeed, winMix, f, s.x, s.y); delete c.t; continue; } // a greenhouse: glass all round (a new save's plan, shoplayout.js)
      const along = side === "front" || side === "back" ? [[s.x - 1, s.y], [s.x + 1, s.y]] : [[s.x, s.y - 1], [s.x, s.y + 1]];
      if (along.some(([x, y]) => DOORISH.has(cells[I(x, y)].k) || cells[I(x, y)].k === "window")) { n++; continue; }
      if (n++ % BMAP.WINDOW_GAP !== 0 || !rng.chance(0.8)) continue;
      c.k = !upper && !room.up && !room.locked && rng.chance(BMAP.SMASHED) ? "smashed" : "window"; // upstairs nobody climbs in or out
      if (c.k === "window") c.win = rollWin(winSeed, winMix, f, s.x, s.y);
      delete c.t;
    }
  }

  // ---------- zones (the exits' extraction zones at the map edge) ----------
  const Z = BMAP.ZONE;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const zoneFor = (side, x, y) => (side === "front" ? { x0: clamp(x - 1, 0, W - Z), y0: H - Z } : side === "back" ? { x0: clamp(x - 1, 0, W - Z), y0: 0 } : side === "left" ? { x0: 0, y0: clamp(y - 1, 0, H - Z) } : { x0: W - Z, y0: clamp(y - 1, 0, H - Z) });
  const zones = [];
  const overlaps = (z) => zones.some((q) => z.x0 < q.x0 + q.w + 1 && q.x0 < z.x0 + z.w + 1 && z.y0 < q.y0 + q.h + 1 && q.y0 < z.y0 + z.h + 1);
  if (!upper) { // the ground floor only: the street, the zones and the vehicle are not upstairs
    const fmid = front.cells[Math.floor(front.cells.length / 2)];
    const fz = zoneFor("front", fmid[0], fmid[1]);
    zones.push({ ...fz, w: Z, h: Z, side: "south", exit: "front", name: "Front entrance", vehicle: false });
    for (const ex of exits) {
      const midCell = ex.cells[Math.floor(ex.cells.length / 2)];
      const z = { ...zoneFor(ex.side, midCell[0], midCell[1]), w: Z, h: Z, side: { front: "south", back: "north", left: "west", right: "east" }[ex.side], exit: ex.side, name: ex.name, vehicle: false };
      if (overlaps(z)) { ex.zone = -1; continue; }
      ex.zone = zones.length;
      zones.push(z);
    }
  }
  const reserved = new Uint8Array(W * H);
  for (const z of zones) for (let y = z.y0 - 1; y <= z.y0 + z.h; y++) for (let x = z.x0 - 1; x <= z.x0 + z.w; x++) if (inside(x, y)) reserved[I(x, y)] = 1;
  if (!upper) for (let y = by0 - 1; y <= by1 + 1; y++) for (let x = bx0 - 1; x <= bx1 + 1; x++) if (inside(x, y)) reserved[I(x, y)] = 1; // a clear ring around the building
  let vehicle = null; // the team's car or truck in the entry zone, 2 × 3–4 cells (combat.js placeVehicle; a bike or no room: one cell)
  if (!upper && opts.withVehicle) {
    const z = zones[0]; z.vehicle = true;
    vehicle = placeVehicle(cells, W, H, z, opts.withVehicle, (x, y) => inside(x, y) && cells[I(x, y)].k === "open"); // a bike: 2 x 1
    if (!vehicle) { const c = cells[I(z.x0 + 1, z.y0 + 1)]; c.k = "vehicle"; c.f = "road"; }
  }
  // A path from each outer door to the map edge (its zone), so the lot is never cut by the dressing.
  const pathCells = new Uint8Array(W * H);
  for (const d of doors) if (d.ext) {
    let x = d.ox, y = d.oy;
    const tx = d.side === "front" ? x : d.side === "back" ? x : d.side === "left" ? 0 : W - 1, ty = d.side === "front" ? H - 1 : d.side === "back" ? 0 : y;
    for (let g = 0; g < W + H && inside(x, y); g++) { pathCells[I(x, y)] = 1; if (x === tx && y === ty) break; if (x !== tx) x += Math.sign(tx - x); else y += Math.sign(ty - y); }
  }

  // ---------- connectivity (every walkable cell reachable from the front, locked doors counted as ways through) ----------
  const passable = (c) => !!(CELL[c.k] && CELL[c.k].walk) || c.k === "door";
  const anchor = upper ? I(stairCells[0][0], stairCells[0][1]) : I(zones[0].x0 + 1, zones[0].y0 + 1 - (opts.withVehicle ? 1 : 0)); // upstairs everything hangs off the stairwell
  // The walk runs on every blocking thing put down (hundreds a building): over a byte a cell, passable(cells[i]) kept
  // in step by everything below that changes a cell's kind from here on (block, the cars: passAt).
  const pass = new Uint8Array(W * H);
  const passAt = (i) => { pass[i] = passable(cells[i]) ? 1 : 0; };
  const passRect = (r) => { for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) passAt(I(x, y)); };
  let total = 0;
  for (let i = 0; i < cells.length; i++) { passAt(i); total += pass[i]; }
  let stamp = 0;
  const marks = new Uint32Array(W * H), stack = new Int32Array(W * H), N = W * H;
  function connected() {
    stamp++;
    let a = anchor;
    if (!passable(cells[a])) { a = cells.findIndex((c, i) => passable(c) && !inBldg(i % W, (i / W) | 0)); if (a < 0) return false; }
    let sp = 0;
    stack[sp++] = a;
    marks[a] = stamp;
    let n = 1;
    while (sp) {
      const i = stack[--sp], x = i % W;
      let j = i + 1;
      if (x + 1 < W && marks[j] !== stamp && pass[j]) { marks[j] = stamp; n++; stack[sp++] = j; }
      j = i - 1;
      if (x > 0 && marks[j] !== stamp && pass[j]) { marks[j] = stamp; n++; stack[sp++] = j; }
      j = i + W;
      if (j < N && marks[j] !== stamp && pass[j]) { marks[j] = stamp; n++; stack[sp++] = j; }
      j = i - W;
      if (j >= 0 && marks[j] !== stamp && pass[j]) { marks[j] = stamp; n++; stack[sp++] = j; }
    }
    return n === total;
  }
  // Puts a thing on a free cell (a blocking one is undone if it would cut anything off).
  function block(x, y, k, room = null) {
    if (!inside(x, y)) return false;
    const i = I(x, y), c = cells[i];
    if (keep[i] || (reserved[i] && !room) || pathCells[i] || !passable(c) || DOORISH.has(c.k) || c.k === "stairs" || c.k === "ladder" || c.k === "vehicle") return false;
    if (room ? rid[i] !== room.id : rid[i] !== -2) return false;
    const was = c.k;
    c.k = k;
    passAt(i);
    if (!passable(c)) {
      total--;
      if (!connected()) { c.k = was; passAt(i); total++; return false; }
    }
    if (room && room.up) c.h = 1;
    return true;
  }
  const keepAt = (x, y) => { if (inside(x, y)) keep[I(x, y)] = 1; };

  // ---------- furnishing and containers ----------
  const containers = [];
  let cid = opts._cid || 1; // container ids run on across the floors
  const walkAt = (x, y) => inside(x, y) && passable(cells[I(x, y)]);
  function box(room, x, y, kind, outdoorArea = null, kept = false) {
    const area = outdoorArea || room;
    if (!area.type || !AREAS[area.type]) return false;
    // It needs a free side to search it from (kept clear). kept (roomlayout.js): a side already kept clear first (a
    // door's front, a lane), so a small room does not lose a cell to it.
    const sides = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => walkAt(nx, ny) && (outdoorArea ? rid[I(nx, ny)] === -2 : rid[I(nx, ny)] === room.id || keep[I(nx, ny)]));
    const side = (kept && sides.find(([nx, ny]) => keep[I(nx, ny)] || (typeof kept === "function" && kept(nx, ny)))) || sides[0];
    if (!side) return false;
    const cellKind = kind === "car" ? "car" : kind === "pump" ? "pump" : kind;
    if (!block(x, y, cellKind, outdoorArea ? null : room)) return false;
    keep[I(side[0], side[1])] = 1;
    const label = kind === "car" ? "car" : kind === "pump" ? "fuel pump" : kind;
    const c = { id: cid++, x, y, f, area: area.id, kind, searched: false, label: `${area.name}: ${label}` };
    if (!outdoorArea && room.boxLock && rng.chance(room.boxLock[1] + (containers.some((q) => q.area === room.id && q.lockKind) ? 0 : room.boxLock[1] >= 0.5 ? 0.5 : 0))) c.lockKind = room.boxLock[0];
    if (!outdoorArea && room.locked) c.room = true;
    containers.push(c);
    return true;
  }
  // Homes room by room (roomlayout.js): which bedroom is the master, which a child's, a great room with no kitchen on
  // its floor, a flat with no bedroom (a studio). An older save (opts.legacy) furnishes every room as it did.
  const styleOf = (room) => (opts.legacy ? null : commercialStyle(room, opts.key) || homeStyle(room, opts.key) || medicalStyle(room, opts.key) || civicStyle(room)); // shoplayout.js first (a motel's rooms, a shop's back rooms; a flat above stays a home), a hospital's, a clinic's, a vet's rooms (#14), civiclayout.js a civic building's rooms (their leaf's civic mark)
  if (!opts.legacy) {
    for (const r of rooms) if (r.role === "bedroom" && styleOf(r) && r.iw * r.ih <= 4) Object.assign(r, { role: "storage", name: "Box room", furnish: "shelves" }); // too small for a bed and a wardrobe
    const beds = rooms.filter((r) => r.role === "bedroom" && styleOf(r)).sort((a, b) => b.iw * b.ih - a.iw * a.ih);
    if (beds.length && beds[0].iw * beds[0].ih >= LAYOUT.MASTER_AREA && Math.min(beds[0].iw, beds[0].ih) >= 3) beds[0].master = true;
    if (beds.length >= 2 && hash01(rng.state, "child", f) < LAYOUT.CHILD) beds[beds.length - 1].child = true;
    if (!rooms.some((r) => r.role === "kitchen" || r.role === "apt")) for (const r of rooms) if (r.role === "greatroom") r.kitchenette = true;
    for (const r of rooms) if (r.role === "apt" && !rooms.some((q) => q.role === "bedroom" && q.unit && q.unit === r.unit)) r.studio = true;
  }
  const layoutSeed = rng.state; // the arrangements' dice (read, not consumed)
  let pieceNo = opts._piece || 0;
  for (const room of rooms) {
    const ctx = furnishCtx(room);
    const home = styleOf(room);
    if (home) { // the pieces are the containers: no top-up; the lanes then stay clear of what comes after (decor.js pieces)
      const L = roomLayout(ctx);
      home(L);
      for (let y = ctx.y0; y <= ctx.y1; y++) for (let x = ctx.x0; x <= ctx.x1; x++) if (L.lane(x, y) && ctx.free(x, y)) keepAt(x, y);
      continue;
    }
    (FURNISH[room.furnish] || FURNISH.none)(ctx);
    // Top up the containers along the walls.
    if (room.type && AREAS[room.type]) {
      const target = Math.max(1, Math.min(room.maxBoxes ?? 4, Math.round((room.iw * room.ih) / 10)));
      const kinds = AREAS[room.type].boxes;
      for (const [x, y] of ctx.wallSpots()) {
        if (containers.filter((c) => c.area === room.id).length >= target) break;
        box(room, x, y, rng.pick(kinds));
      }
    }
  }
  // The lootable decor (decor.js placeDecorPieces): a plant, a floor lamp by a room's wall, by hash dice (no roll used).
  if (!opts.noDecor) {
    const pseed = rng.state;
    for (const room of rooms) {
      const ctx = furnishCtx(room);
      placeDecorPieces(room, { seed: pseed, f }, (x, y) => ctx.free(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => rid[I(x + dx, y + dy)] === -1), (x, y, k) => block(x, y, k, room));
    }
  }
  function furnishCtx(room) {
    const x0 = room.ix0, y0 = room.iy0, x1 = room.ix0 + room.iw - 1, y1 = room.iy0 + room.ih - 1;
    const free = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && FLOOR_KINDS.has(cells[I(x, y)].k) && !keep[I(x, y)];
    const wallNext = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => rid[I(x + dx, y + dy)] === -1);
    const all = () => { const out = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (free(x, y)) out.push([x, y]); return out; };
    const canBox = !!(room.type && AREAS[room.type]);
    return {
      rng, room, x0, y0, x1, y1, w: room.iw, h: room.ih, free, key: opts.key,
      // roomlayout.js: the cells as they stand, a piece taken back up, a container on a cell (its record), the dice.
      kindAt: (x, y) => (inside(x, y) ? cells[I(x, y)].k : null),
      ridAt: (x, y) => (inside(x, y) ? rid[I(x, y)] : -2),
      cell: (x, y) => cells[I(x, y)],
      unblock: (x, y) => { const i = I(x, y), c = cells[i]; const was = pass[i]; c.k = "open"; delete c.fc; delete c.pc; passAt(i); if (!was && pass[i]) total++; },
      container: (x, y, k, lane = true) => (free(x, y) && box(room, x, y, k, null, lane) ? containers[containers.length - 1] : null),
      boxes: () => containers.filter((q) => q.area === room.id),
      target: canBox ? room.boxTarget ?? Math.max(1, Math.min(room.maxBoxes ?? 4, Math.round((room.iw * room.ih) / 10))) : 0, // boxTarget: a plan's own count (a school corridor's lockers)
      roomAt: (x, y) => (inside(x, y) && rid[I(x, y)] >= 0 ? rooms[rid[I(x, y)]] : null), // civiclayout.js: the room next door (an interview room's observation nook)
      decor: !opts.noDecor, // civiclayout.js: a whiteboard on the wall the desks face (decor.js's wall art), not on a bare map
      seed: hash01(layoutSeed, "rooms", f) * 0x7fffffff, canBox, piece: () => ++pieceNo,
      kinds: () => (room.type && AREAS[room.type] ? AREAS[room.type].boxes : ["shelf"]),
      block: (x, y, k) => free(x, y) && block(x, y, k, room),
      // A car or a truck in the room (a garage bay, a hangar): 2 × 3–4 cells (combat.js placeCar) when it fits without
      // cutting the room in two.
      car: (x, y, kind) => {
        const L = rng.pick(CAR_LEN[kind]), ax = rng.chance(0.5) ? "x" : "y";
        const rect = placeCar(cells, W, H, x, y, ax, L, kind, (cx, cy) => free(cx, cy) && rid[I(cx, cy)] === room.id, rng.int(0, 1e6), { ring: false });
        if (!rect) return false;
        passRect(rect);
        total -= rect.w * rect.h;
        if (!connected()) { removeCar(cells, W, rect); passRect(rect); total += rect.w * rect.h; return false; }
        return rect;
      },
      // A vehicle of the room's (civiclayout.js: a fire engine, an ambulance, a police car): placeCar at (x, y) along o.ax,
      // o.len cells, drawn as o.body, never cutting anything off; o.box: a container of that kind over the whole of it
      // (combat.js BOX_LOOT), searched from a free cell beside it.
      vehicle: (x, y, o) => {
        const rect = placeCar(cells, W, H, x, y, o.ax, o.len, o.kind, (cx, cy) => free(cx, cy) && rid[I(cx, cy)] === room.id, rng.int(0, 1e6), { ring: false, body: o.body });
        if (!rect) return null;
        passRect(rect);
        total -= rect.w * rect.h;
        const side = [];
        for (let yy = rect.y0 - 1; yy <= rect.y0 + rect.h; yy++) for (let xx = rect.x0 - 1; xx <= rect.x0 + rect.w; xx++) if ((xx < rect.x0 || xx >= rect.x0 + rect.w) !== (yy < rect.y0 || yy >= rect.y0 + rect.h) && inside(xx, yy) && rid[I(xx, yy)] === room.id && walkAt(xx, yy)) side.push([xx, yy]);
        if (!side.length || !connected()) { removeCar(cells, W, rect); passRect(rect); total += rect.w * rect.h; return null; }
        if (o.box && canBox) {
          keep[I(side[0][0], side[0][1])] = 1;
          containers.push({ id: cid++, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, f, area: room.id, kind: o.box, searched: false, label: `${room.name}: ${o.box === "engine" ? "fire engine" : o.box === "policecar" ? "police car" : o.box}` });
        }
        return rect;
      },
      keep: keepAt,
      box: (x, y, k) => free(x, y) && box(room, x, y, k || rng.pick(room.type && AREAS[room.type] ? AREAS[room.type].boxes : ["shelf"])),
      wallSpots: () => rng.shuffle(all().filter(([x, y]) => wallNext(x, y))),
      innerSpots: () => rng.shuffle(all().filter(([x, y]) => !wallNext(x, y))),
    };
  }

  // ---------- the outside ----------
  const outdoor = [];
  const outsideFree = (x, y) => inside(x, y) && rid[I(x, y)] === -2 && !reserved[I(x, y)] && !pathCells[I(x, y)] && cells[I(x, y)].k === "open";
  // A car or a truck on the lot: 2 × 3–4 cells (combat.js placeCar), turned as its dice say, never cutting the lot in two.
  const carAt = (x, y, kind, test = () => true) => {
    const L = rng.pick(CAR_LEN[kind]), ax = rng.chance(0.5) ? "x" : "y";
    const rect = placeCar(cells, W, H, x, y, ax, L, kind, (cx, cy) => outsideFree(cx, cy) && test(cx, cy), rng.int(0, 1e6), { ring: false });
    if (!rect) return null;
    passRect(rect);
    total -= rect.w * rect.h;
    if (!connected()) { removeCar(cells, W, rect); passRect(rect); total += rect.w * rect.h; return null; }
    return rect;
  };
  const scatter = (k, n, test = () => true) => {
    let placed = 0;
    for (let t = 0; t < n * 12 && placed < n; t++) {
      const x = rng.int(0, W - 1), y = rng.int(0, H - 1);
      if (k === "car" || k === "truck") { if (carAt(x, y, k, test)) placed++; continue; }
      if (outsideFree(x, y) && test(x, y) && block(x, y, k)) placed++;
    }
    return placed;
  };
  const inStreet = (x, y) => y > by1 + 1;
  const behind = (x, y) => y < by0;
  // Fuel pumps (a gas station, a truck stop) on the lot in front: an outdoor area of their own.
  if (!upper && spec.pumps) {
    const a = { id: rooms.length + outdoor.length, type: "pumps", name: AREAS.pumps.name, outdoor: true };
    const y = Math.min(H - 2, by1 + 3);
    let placed = 0;
    for (let x = bx0 + 1; x < bx1 && placed < spec.pumps; x += 3) {
      if (!outsideFree(x, y) || !outsideFree(x, y - 1) && !outsideFree(x, y + 1)) continue;
      if (box(null, x, y, "pump", a)) placed++;
    }
    if (placed) { Object.assign(a, { x0: bx0, y0: y - 2, w: bw, h: 5 }); outdoor.push(a); }
  }
  // An empty pool behind a fence (a motor court's, issue #32): a basin of tiles (walkable, drained) inside a ring of
  // fence with a gate, on open ground behind or beside the building (the nearest spot that fits; none: no pool).
  if (!upper && spec.pool) {
    const pw = spec.pool.w || 5, ph = spec.pool.h || 3, cands = [];
    for (let y = 0; y + ph + 2 <= H; y++) for (let x = 0; x + pw + 2 <= W; x++) {
      if (y + ph + 1 >= by0 && y <= by1 + 1 && x + pw + 1 >= bx0 - 1 && x <= bx1 + 1) continue; // never against the walls
      let ok = true;
      for (let yy = y; yy < y + ph + 2 && ok; yy++) for (let xx = x; xx < x + pw + 2; xx++) if (!outsideFree(xx, yy) || inStreet(xx, yy)) { ok = false; break; }
      if (ok) cands.push({ x, y, d: Math.abs(x + pw / 2 + 1 - (bx0 + bx1) / 2) * 0.3 + (y + ph + 2 <= by0 ? by0 - (y + ph + 2) : Math.abs(y - by1)) + rng.next() });
    }
    cands.sort((a, b) => a.d - b.d);
    const p = cands[0];
    if (p) {
      const gate = [p.x + 1 + Math.floor(pw / 2), p.y + ph + 1 <= by0 - 1 ? p.y + ph + 1 : p.y]; // the gate on the side toward the building
      for (let yy = p.y; yy < p.y + ph + 2; yy++) for (let xx = p.x; xx < p.x + pw + 2; xx++) {
        const ring = yy === p.y || yy === p.y + ph + 1 || xx === p.x || xx === p.x + pw + 1;
        if (!ring) { cells[I(xx, yy)].f = "pool"; reserved[I(xx, yy)] = 1; continue; } // ui/isoview.js floorColor: the drained basin's tiles
        if (xx === gate[0] && yy === gate[1]) { keepAt(xx, yy); continue; }
        block(xx, yy, "fence");
      }
      for (let yy = p.y; yy < p.y + ph + 2; yy++) for (let xx = p.x; xx < p.x + pw + 2; xx++) reserved[I(xx, yy)] = 1;
    }
  }
  // A neon sign over the front of a room (a motel office's: its leaf's neon mark), on the outer wall (c.neon: the face,
  // 2 the street side; ui/isoview.js draws it).
  if (!upper) for (const r of rooms) if (r.neon) {
    const xs = [];
    for (let x = r.ix0; x < r.ix0 + r.iw; x++) if (cells[I(x, by1)].k === "wall" && touches(r, "front")) xs.push(x);
    if (xs.length) cells[I(xs[Math.floor(xs.length / 2)], by1)].neon = 2;
  }
  // Wrecked cars on the street (towns and cities): an outdoor area to search (car alarms, AREAS.wreck).
  if (!upper && (spec.ground === "town" || spec.ground === "city") && rng.chance(0.45)) {
    const a = { id: rooms.length + outdoor.length, type: "wreck", name: AREAS.wreck.name, outdoor: true };
    let placed = 0;
    const want = rng.int(1, 2);
    for (let t = 0; t < 40 && placed < want; t++) {
      const x = rng.int(1, W - 2), y = rng.int(by1 + 2, H - 1);
      const rect = outsideFree(x, y) ? carAt(x, y, "car") : null; // a wrecked car of 2 × 3–4 cells, searched from any side
      if (rect) { containers.push({ id: cid++, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, f, area: a.id, kind: "car", searched: false, label: `${a.name}: car` }); placed++; }
    }
    if (placed) {
      const cs = containers.filter((c) => c.area === a.id);
      const xs = cs.map((c) => c.x), ys = cs.map((c) => c.y);
      Object.assign(a, { x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, w: Math.max(...xs) - Math.min(...xs) + 3, h: Math.max(...ys) - Math.min(...ys) + 3 });
      outdoor.push(a);
    }
  }
  switch (upper ? "none" : spec.ground) {
    case "none": break; // an upper floor: nothing outside its walls
    case "city": scatter("car", rng.int(2, 4), inStreet); scatter("truck", rng.int(0, 1), inStreet); scatter("crate", rng.int(2, 3), behind); break;
    case "lot": scatter("truck", rng.int(1, 2)); scatter("crate", rng.int(2, 4)); scatter("barrel", rng.int(1, 2)); scatter("car", rng.int(1, 2), inStreet); break;
    case "base": scatter("sandbag", rng.int(3, 6)); scatter("crate", rng.int(2, 3)); scatter("truck", rng.int(1, 2)); break;
    case "farm": scatter("hay", rng.int(3, 5)); scatter("fence", rng.int(4, 7)); scatter("tree", rng.int(2, 4)); scatter("truck", rng.int(0, 1)); scatter("well", rng.int(0, 1)); break;
    case "woods": scatter("tree", rng.int(10, 18)); scatter("rock", rng.int(2, 4)); break;
    case "rural": scatter("tree", rng.int(4, 7)); scatter("fence", rng.int(2, 5)); scatter("car", rng.int(0, 1)); break;
    default: scatter("car", rng.int(1, 3), inStreet); scatter("tree", rng.int(2, 4), (x, y) => !inStreet(x, y)); scatter("fence", rng.int(2, 4), behind); scatter("crate", rng.int(1, 2), behind);
  }

  // ---------- doors' kinds and strength (DOOR_KINDS; the dead batter closed doors) ----------
  // The kind by the archetype (doorStyleOf: the front door, the back and side exits), a roller door always a roller, a
  // locked room's door wood (a gun cage's or an armory's the steel security door), a cell block's cells a cell door,
  // any other inner door wood. Hit points by the kind; a locked solid door holds as a locked door always did
  // (BMAP.DOOR.locked), glass and mesh hold no better for a lock. Dice: hash of the map's seed (rng.state read, not
  // consumed: the upper floors roll the same as before).
  const D = BMAP.DOOR, style = doorStyleOf(opts.key), dkSeed = rng.state;
  const pickKind = (list, x, y) => (Array.isArray(list) ? list[Math.floor(hash01(dkSeed, "dk", f, x, y) * list.length) % list.length] : list);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (c.k !== "idoor" && c.k !== "odoor" && c.k !== "door") continue;
    const x = i % W, y = (i / W) | 0;
    const lockedOne = c.k === "door" ? lockedDoors.find((d) => d.x === x && d.y === y) : null;
    const d = doors.find((q) => q.x === x && q.y === y);
    const cellsRoom = (d && !d.ext && (rooms[d.a].role === "cells" || rooms[d.b].role === "cells")) || c.cellDoor; // cellDoor: a cell's own door (civiclayout.js)
    const roomDk = d && !d.ext ? rooms[d.a].dk || rooms[d.b].dk : null; // a room's own door kind (civiclayout.js plans: an evidence room's barred door, a walk-in's; shoplayout.js's: a restaurant's walk-in steel door)
    const dk = c.roll ? "roller" : lockedOne && lockedOne.kind === "vault" ? "vault" : d && d.ext ? pickKind(d.side === "front" ? style.front : d.side === "back" ? style.back : style.side, x, y) : roomDk && DOOR_KINDS[roomDk] ? roomDk : cellsRoom ? "cell" : "wood";
    const K = DOOR_KINDS[dk];
    c.dk = dk;
    const frail = dk === "glass" || dk === "screen";
    c.hp = c.mhp = lockedOne ? (lockedOne.kind === "vault" ? D.vault : frail ? K.hp : Math.max(K.hp, D.locked)) : K.hp;
    if (K.see) delete c.t; // seen through from the ground, however tall the building
    if (lockedOne) lockedOne.dk = dk; // locks.js openOdds: the lock's difficulty, whether it can be kicked
  }

  // ---------- decor (decor.js) ----------
  // Rugs, clutter, wall art, wall colours and light fixtures: cosmetic, no cell's kind changes. Hash dice of the map's
  // seed as it stands (rng.state read, not consumed: the upper floors roll the same as before).
  if (!opts.noDecor) decorate(cells, W, H, rooms, rid, { seed: rng.state, f, key: opts.id || opts.key, ...(opts.legacy ? {} : { kind: opts.key }) }); // noDecor: the same map bare (tools/decortest.js)

  // ---------- the result ----------
  // Room ids run on across the floors (opts._idBase: the ids used so far), so areas[id] is the room with that id.
  const idBase = opts._idBase || 0;
  const areas = rooms.map((r) => ({
    id: idBase + r.id, f, type: r.type && AREAS[r.type] ? r.type : null, role: r.role, name: r.name + (r.up ? " (upstairs)" : ""),
    x0: r.ix0 - 1, y0: r.iy0 - 1, w: r.iw + 2, h: r.ih + 2, doors: r.doors.map((d) => d.slice ? d.slice() : d),
    hub: !!r.hub, locked: r.locked || null, up: !!r.up, entry: !!r.entry, noLabel: r.label === false,
  }));
  rooms.forEach((r, i) => { if (r.gunSafe) areas[i].gunSafe = r.gunSafe.slice(); }); // locks.js placeGunSafes: a gun safe may stand here
  rooms.forEach((r, i) => { if (r.kennel) areas[i].kennel = true; }); // deadbeasts.js shutInPets: a vet's locked kennels hold dead pets
  if (!opts.legacy) rooms.forEach((r, i) => { if (r.flat) areas[i].flat = true; if (r.unit) areas[i].unit = r.unit; if (r.civic) areas[i].civic = r.civic; if (r.aisle != null) areas[i].aisle = r.aisle; const sn = shopStyleName(r, opts.key); if (sn) areas[i].shop = sn; }); // shoplayout.js: a room's style (its scenes' when); roomlayout.js: a shop's flat above, an apartment's rooms; civiclayout.js: a room's style, a nave's aisle
  for (const a of outdoor) areas.push({ ...a, id: idBase + a.id, f: 0 });
  for (const c of containers) c.area += idBase;
  for (const d of lockedDoors) { d.f = f; if (d.area != null) d.area += idBase; }
  if (upper) return { cells, rooms: areas, containers, lockedDoors, nextCid: cid, nextPiece: pieceNo };
  // The upper floors (storeys): each built on its own grid from spec.upper's plan, the same stairwell cells.
  const floorName = (g) => (g === 0 ? "Ground floor" : g === storeys - 1 ? "Top floor" : `Floor ${g + 1}`);
  const floors = [{ cells, name: floorName(0) }];
  let base = areas.length, nextCid = cid;
  for (let g = 1; g < storeys; g++) {
    const program = spec.upper ? spec.upper(g, rng, { top: g === storeys - 1, storeys, bw, bh }) : spec.program;
    const up = assemble(rng, spec, { ...opts, _floor: g, _program: program, _runs: runs, _idBase: base, _cid: nextCid, _piece: pieceNo });
    areas.push(...up.rooms); containers.push(...up.containers); lockedDoors.push(...up.lockedDoors);
    floors.push({ cells: up.cells, name: floorName(g) });
    base += up.rooms.length; nextCid = up.nextCid; pieceNo = up.nextPiece;
  }
  const plan = {
    key: opts.key, id: opts.id || opts.key, name: opts.name, w: W, h: H, building: { x0: bx0, y0: by0, w: bw, h: bh }, tall, storeys, stairs: stairCells.map((s) => s.slice()), runs: runs.map((r) => ({ ...r })),
    rooms: areas.filter((a) => !a.outdoor).map((a) => ({ id: a.id, f: a.f, name: a.name, role: a.role, type: a.type, x0: a.x0, y0: a.y0, w: a.w, h: a.h, locked: a.locked, up: a.up, hub: a.hub, entry: a.entry, ...(a.civic ? { civic: a.civic } : {}) })), // civic: wanderers.js interiorOccupants' rooms by kind
    front: { x: front.x, y: front.y }, ...(spec.variant ? { variant: { ...spec.variant } } : {}), // the layout variant it was built as (buildvariants.js)
    exits: exits.map((e) => ({ side: e.side, name: e.name, x: e.x, y: e.y, cells: e.cells, locked: e.locked, roller: e.roller, zone: e.zone })),
  };
  return { w: W, h: H, cells, rooms: areas, containers, zones, vehicle, exits, front, lockedDoors, plan, building: plan.building, floors, stairs: plan.stairs, runs: plan.runs, storeys };
}

// ======================================================================================
// Furniture by room. c: the room's tools (furnishCtx): block / box (false when it would cut something off), spots.
// The front is +y (the street side), the back wall is y0.
// ======================================================================================
const rowOf = (c, y, x0, x1, k, boxEvery = 0) => { let n = 0; for (let x = x0; x <= x1; x++) { if (boxEvery && n % boxEvery === boxEvery - 1 ? c.box(x, y, k === "rack" ? "shelf" : k) : c.block(x, y, k)) n++; } return n; };
const FURNISH = {
  none() {},
  living(c) {
    for (const [x, y] of c.innerSpots().slice(0, c.w * c.h > 20 ? 2 : 1)) c.block(x, y, "table");
    const w = c.wallSpots()[0];
    if (w) c.block(w[0], w[1], "shelf");
  },
  apartment(c) {
    const [x, y] = [c.x0, c.y0];
    c.block(x, y, "bed"); c.block(x, y + 1, "bed");
    rowOf(c, c.y0, c.x1 - 1, c.x1, "counter");
    for (const [ix, iy] of c.innerSpots().slice(0, 1)) c.block(ix, iy, "table");
  },
  dining(c) {
    for (let y = c.y0 + 1; y < c.y1; y += 2) for (let x = c.x0 + 1; x < c.x1; x += 3) if (c.rng.chance(0.75)) c.block(x, y, "table");
    rowOf(c, c.y0, c.x0 + 1, Math.min(c.x1 - 1, c.x0 + Math.max(2, Math.floor(c.w / 2))), "counter", 3);
  },
  kitchen(c) {
    rowOf(c, c.y0, c.x0, c.x1 - (c.w > 4 ? 1 : 0), "counter", 3);
    if (c.w * c.h > 16) for (const [x, y] of c.innerSpots().slice(0, 1)) c.block(x, y, "table");
  },
  bedroom(c) {
    const left = c.rng.chance(0.5), x = left ? c.x0 : c.x1;
    if (c.block(x, c.y0, "bed")) c.block(x, c.y0 + 1, "bed");
    c.box(left ? x + 1 : x - 1, c.y0);
  },
  bath() {},
  shelves(c) {
    rowOf(c, c.y0, c.x0, c.x1, "shelf", 3);
    if (c.h >= 4) for (let y = c.y0 + 2; y < c.y1; y += 2) { c.block(c.x0, y, "shelf"); c.block(c.x1, y, "shelf"); }
    if (c.w * c.h > 24) for (const [x, y] of c.innerSpots().slice(0, 2)) c.block(x, y, "crate");
  },
  aisles(c) {
    // Rows of tall shelving across the floor (they block sight: sneak down the aisles), every few a shelf to search;
    // a checkout counter by the door.
    const yLast = c.y1 - 3;
    for (let y = c.y0 + 1; y <= yLast; y += 2) {
      const gap = c.w > 10 ? c.x0 + Math.floor(c.w / 2) + c.rng.int(-1, 1) : -1;
      for (let x = c.x0 + 1; x <= c.x1 - 1; x++) {
        if (x === gap || (c.w > 18 && Math.abs(x - gap) === 6)) continue;
        if ((x + y) % 5 === 0) c.box(x, y, "shelf"); else c.block(x, y, "rack");
      }
    }
    rowOf(c, c.y1 - 1, c.x0 + 1, c.x0 + 3, "counter", 3);
  },
  gundesk(c) {
    const y = Math.max(c.y0 + 1, c.y1 - 2);
    for (let x = c.x0 + 2; x <= c.x1 - 2; x++) if ((x - c.x0) % 4 === 3) c.box(x, y, "counter"); else c.block(x, y, "counter");
    rowOf(c, c.y0, c.x0, c.x1, "rack", 4);
  },
  office(c) {
    for (const [x, y] of c.innerSpots().slice(0, Math.max(1, Math.min(3, Math.floor((c.w * c.h) / 8))))) c.block(x, y, "table");
  },
  lobby(c) {
    const mid = c.x0 + Math.floor(c.w / 2);
    if (c.h >= 4) rowOf(c, c.y0 + 1, mid - 1, mid + 1, "counter", 2);
    for (const [x, y] of c.innerSpots().slice(0, 1)) c.block(x, y, "table");
  },
  beds(c) {
    for (let x = c.x0; x <= c.x1; x += 2) { if (c.block(x, c.y0, "bed")) c.block(x, c.y0 + 1, "bed"); }
    if (c.h >= 6) for (let x = c.x0 + 1; x <= c.x1; x += 2) { if (c.block(x, c.y1, "bed")) c.block(x, c.y1 - 1, "bed"); }
  },
  exam(c) {
    for (const [x, y] of c.innerSpots().slice(0, 1)) c.block(x, y, "bed");
  },
  armory(c) {
    rowOf(c, c.y0, c.x0, c.x1, "locker", 2);
    if (c.h >= 4) for (const [x, y] of c.innerSpots().slice(0, 1)) c.box(x, y, "crate");
  },
  cells(c) {
    // Cells along the back wall: 2 × 2 behind a row of bars with a door each, bars between them; a bunk inside.
    if (c.h < 5 || c.w < 4) return;
    const yb = c.y0 + 2;
    for (let x0 = c.x0; x0 + 1 <= c.x1; x0 += 3) {
      const xd = x0 + c.rng.int(0, 1), xo = xd === x0 ? x0 + 1 : x0;
      if (!c.free(xd, yb) || !c.free(xd, yb + 1) || !c.free(xd, yb - 1)) continue;
      c.block(xd, yb, "idoor");
      c.keep(xd, yb - 1); c.keep(xd, yb + 1);
      c.block(xo, yb, "bars");
      if (x0 + 2 <= c.x1) for (let y = c.y0; y <= yb; y++) c.block(x0 + 2, y, "bars");
      if (c.rng.chance(0.6)) c.box(xo, c.y0, "locker"); else c.block(xo, c.y0, "bed");
    }
  },
  bays(c) {
    const cars = Math.max(1, Math.floor(c.w / 5));
    for (let i = 0; i < cars; i++) { const kind = c.rng.chance(0.3) ? "truck" : "car"; for (const [x, y] of c.innerSpots().slice(0, 8)) if (c.car(x, y, kind)) break; } // 2 × 3–4 cells each (combat.js placeCar)
    rowOf(c, c.y0, c.x0, c.x1, "counter", 3);
  },
  hangar(c) {
    const cx = c.x0 + Math.floor(c.w / 2), cy = c.y0 + Math.floor(c.h / 2);
    for (const [x, y] of [[cx - 2, cy - 1], [cx - 2, cy + 1], [cx + 2, cy - 1], [cx - 3, cy]]) c.car(x, y, "truck"); // the trucks parked inside, 2 × 4 cells each
    rowOf(c, c.y0, c.x0, c.x1, "crate", 4);
  },
  classroom(c) {
    for (let y = c.y0 + 2; y <= c.y1 - 1; y += 2) for (let x = c.x0 + 1; x <= c.x1 - 1; x += 2) c.block(x, y, "table");
    c.box(c.x0 + Math.floor(c.w / 2), c.y0, "counter");
  },
  gym(c) {
    for (const [x, y] of c.wallSpots().slice(0, 3)) c.block(x, y, "crate");
  },
  lockers(c) {
    rowOf(c, c.y0, c.x0, c.x1, "locker", 3);
    for (const [x, y] of c.innerSpots().slice(0, 1)) c.block(x, y, "table");
  },
  racks(c) {
    // Long racks with aisles between; crates on the racks to search.
    for (let y = c.y0 + 1; y <= c.y1 - 2; y += 3) {
      const gap = c.x0 + Math.floor(c.w / 2) + c.rng.int(-2, 2);
      for (let x = c.x0 + 1; x <= c.x1 - 1; x++) {
        if (Math.abs(x - gap) <= 0) continue;
        if ((x * 7 + y) % 6 === 0) c.box(x, y, "crate"); else c.block(x, y, "rack");
      }
    }
  },
  machines(c) {
    for (let y = c.y0 + 1; y <= c.y1 - 2; y += 3) for (let x = c.x0 + 1; x <= c.x1 - 2; x += 4) {
      c.block(x, y, "counter"); c.block(x + 1, y, "crate");
      if (c.rng.chance(0.35)) c.box(x, y + 1, "crate"); else c.block(x, y + 1, "counter");
    }
  },
  barn(c) {
    for (const [x, y] of c.wallSpots().slice(0, 4)) c.block(x, y, "hay");
    for (let y = c.y0; y <= c.y0 + Math.min(2, c.h - 3); y++) c.block(c.x1 - 2, y, "fence");
    if (c.w * c.h > 40) for (const [x, y] of c.innerSpots().slice(0, 8)) if (c.car(x, y, "truck")) break; // a truck of 2 × 4 cells (combat.js placeCar)
  },
  hay(c) {
    for (const [x, y] of c.wallSpots().slice(0, Math.max(1, Math.floor(c.w / 2)))) c.block(x, y, "hay");
  },
  pews(c) {
    const aisle = c.x0 + Math.floor(c.w / 2);
    for (let y = c.y0 + 3; y <= c.y1 - 1; y += 2) for (let x = c.x0 + 1; x <= c.x1 - 1; x++) if (x !== aisle && (c.w < 9 || Math.abs(x - aisle) !== 4)) c.block(x, y, "table");
    c.box(aisle, c.y0, "counter");
  },
  control(c) {
    rowOf(c, c.y0, c.x0, c.x1, "counter", 3);
    if (c.h >= 5) rowOf(c, c.y0 + 2, c.x0 + 2, c.x1 - 2, "counter");
  },
  workbench(c) {
    rowOf(c, c.y0, c.x0, c.x1, "counter", 3);
    for (const [x, y] of c.innerSpots().slice(0, c.w * c.h > 20 ? 2 : 0)) c.block(x, y, "crate");
  },
  lab(c) {
    for (let y = c.y0 + 2; y <= c.y1 - 1; y += 3) rowOf(c, y, c.x0 + 1, c.x1 - 1, "counter", 4);
  },
  benches(c) {
    for (let y = c.y0 + 2; y <= c.y1 - 2; y += 3) for (let x = c.x0 + 2; x <= c.x1 - 2; x++) if ((x - c.x0) % 5 !== 0) c.block(x, y, "table");
    rowOf(c, c.y0, c.x0 + 1, c.x0 + 4, "counter", 2);
  },
};

// ======================================================================================
// Who is inside (combat.js createRaid → placeInterior): the site's dead and guards (scavenge.js raidEnemies) placed in
// the rooms and around the building, then the living people interiorOccupants (wanderers.js) returns.
// ======================================================================================
export function placeInterior(state, b, map, groups) {
  const rng = state.rng;
  const R = b.raid;
  const W = b.w, H = b.h;
  const I = (x, y) => y * W + x;
  const entry = R.zones[0];
  const ex = entry.x0 + 1, ey = entry.y0 + 1;
  const d2 = (x, y) => Math.hypot(x - ex, y - ey);
  // Storeys: b.cells / b.reach are the active floor's (setFloor below walks the floors); a unit or a room is on its own floor.
  const storeys = b.floors ? b.floors.length : 1;
  const floorOf = (a) => a.f || 0;
  const taken = (x, y) => b.units.some((u) => !u.dead && (u.f || 0) === (b.floor || 0) && u.x === x && u.y === y);
  const walk = (x, y) => CELL[b.cells[I(x, y)].k].walk && !["stairs", "ladder", "idoor", "odoor"].includes(b.cells[I(x, y)].k);
  const inZone = (x, y) => R.zones.some((z) => x >= z.x0 && x < z.x0 + z.w && y >= z.y0 && y < z.y0 + z.h);
  const allRooms = R.areas.filter((a) => !a.outdoor && a.role);
  const rooms = allRooms.filter((a) => floorOf(a) === 0);
  const roomCells = (a, reach = true) => {
    const out = [];
    for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) if (walk(x, y) && !taken(x, y) && (!reach || b.reach[I(x, y)])) out.push([x, y]);
    return out;
  };
  // Free cells by a stairwell on the active floor (the dead upstairs wait by the stairs): its landings, not its steps.
  const stairSide = () => stairWaits(R, (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1 && walk(x, y) && !taken(x, y));
  const Bs = map.buildings || [map.building]; // a street of houses (streetMap): every house
  const outsideCells = () => {
    const out = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (Bs.some((B) => x >= B.x0 && x < B.x0 + B.w && y >= B.y0 && y < B.y0 + B.h)) continue;
      if (walk(x, y) && !taken(x, y) && b.reach[I(x, y)] && !inZone(x, y) && d2(x, y) >= 7) out.push([x, y]);
    }
    return out;
  };
  // A street of houses: the whole roster (more past the old Extra-large); a building's by its map's area (more past the
  // old Large). The big-map scales only on a map that has them (battlesize.js raidBig, b.raid.big; an older save's never).
  const base = map.street ? STREET.DEAD : Math.max(BMAP.DEAD_SCALE[0], Math.min(BMAP.DEAD_SCALE[1], (W * H) / (RAID_W * RAID_H)));
  const scale = !(b.raid && b.raid.big) ? base : map.street ? base * streetDeadScale(W, H) : buildingDeadScale(base, W, H);
  let pod = 0, zn = 0, hn = 0;
  const lockedDead = new Set();
  const put = (u, c, home = null) => { u.x = c[0]; u.y = c[1]; u.home = home || [c[0], c[1]]; b.units.push(u); };
  for (const g of groups) {
    if (!(g.count > 0)) continue;
    if (g.kind === "zombies") {
      const n = Math.max(1, Math.round(g.count * scale));
      const zl = siteList(rng, g.mix, n); // dead soldiers in a barracks, riot police in a station (deadsoldiers.js); the bred kinds met exploring
      // Storeys: most of the dead on the ground floor, the rest spread over the upper floors (a share of those by the stairwell).
      const SD = BMAP.STOREY.dead;
      const byFloor = Array.from({ length: n }, () => (storeys > 1 && !rng.chance(SD.ground) ? rng.int(1, storeys - 1) : 0));
      for (let fl = 0; fl < storeys; fl++) {
        if (!byFloor.includes(fl)) continue;
        if (b.floors && (b.floor || 0) !== fl) setFloor(b, fl);
        const roomsHere = allRooms.filter((a) => floorOf(a) === fl);
        for (let i = 0; i < n; i++) {
          if (byFloor[i] !== fl) continue;
          const u = enemyUnit(b, rng, "zombies", g.power, ++zn);
          if (zl[i]) applyZType(u, zl[i], false, g.power);
          u.aware = false; u.pod = pod++;
          let c = null;
          if (fl === 0 && rng.chance(BMAP.OUTSIDE_DEAD)) c = rng.pick(outsideCells());
          if (!c && fl > 0 && rng.chance(SD.stairs)) c = rng.pick(stairSide());
          if (!c) {
            const locked = roomsHere.filter((a) => a.locked && !lockedDead.has(a.id));
            if (locked.length && rng.chance(BMAP.LOCKED_DEAD)) {
              const a = rng.pick(locked);
              c = rng.pick(roomCells(a, false));
              if (c) lockedDead.add(a.id);
            }
          }
          if (!c) {
            const open = roomsHere.filter((a) => !a.locked);
            for (let t = 0; t < 6 && !c && open.length; t++) {
              const a = rng.weighted(open, (q) => Math.max(1, (q.w - 2) * (q.h - 2)) * (q.entry ? 0.5 : 1));
              c = rng.pick(roomCells(a).filter(([x, y]) => fl > 0 || d2(x, y) >= 5));
            }
          }
          if (!c && fl === 0) c = rng.pick(outsideCells());
          if (!c) continue;
          put(u, c);
        }
      }
      if (b.floors && (b.floor || 0) !== 0) setFloor(b, 0);
    } else {
      // Guards hold a room together (the biggest worth holding), one of them at the front.
      const homeRooms = rooms.filter((a) => !a.locked && !a.entry && (a.w - 2) * (a.h - 2) >= 6);
      const home = rng.pick(homeRooms.length ? homeRooms : rooms.filter((a) => !a.locked)) || rooms[0];
      const hx = home.x0 + Math.floor(home.w / 2), hy = home.y0 + Math.floor(home.h / 2);
      for (let i = 0; i < Math.max(0, Math.min(20, Math.round(g.count))); i++) {
        const u = enemyUnit(b, rng, g.kind, g.power, ++hn);
        u.aware = false; u.pod = pod;
        if (g.name) u.gname = g.name; // parley.js: the group's own name on its record
        if (g.factionId != null) { u.factionId = g.factionId; armFromArsenal(state, b, u, hn); } // arsenal.js / fighters.js: one of the group's people
        let c = null;
        if (i === 1 && rng.chance(0.5)) c = rng.pick(roomCells(rooms.find((a) => a.entry) || home).filter(([x, y]) => d2(x, y) >= 6));
        if (!c) c = rng.pick(roomCells(home)) || rng.pick(rooms.filter((a) => !a.locked).flatMap((a) => roomCells(a)).filter(([x, y]) => d2(x, y) >= 6));
        if (!c) continue;
        put(u, c, [hx, hy]);
      }
      pod++;
    }
  }
  // The living people inside (wanderers.js).
  const groupsIn = interiorOccupants(state, state.tiles[b.tileId] || null, R.plan) || [];
  R.occupants = { asked: true, groups: 0, waiting: [] };
  placeOccupantGroups(state, b, groupsIn, pod);
}

// Places interiorOccupants' groups: hostile ones are guards here (enemy units, their own alert group); neutral survivors
// and military squads go to the side's handler (combat.js registerOccupantSide) once the encounters work registers
// one, else they wait in b.raid.occupants.waiting. Returns the next free alert group number.
export function placeOccupantGroups(state, b, groupsIn, pod = null) {
  const rng = state.rng;
  const R = b.raid;
  R.occupants = R.occupants || { asked: false, groups: 0, waiting: [] };
  R.occupants.groups += groupsIn.length;
  if (pod == null) pod = 1 + b.units.reduce((a, u) => Math.max(a, u.pod ?? -1), -1);
  const W = b.w, I = (x, y) => y * W + x;
  const entry = R.zones[0];
  const d2 = (x, y) => Math.hypot(x - (entry.x0 + 1), y - (entry.y0 + 1));
  const taken = (x, y) => b.units.some((u) => !u.dead && (u.f || 0) === (b.floor || 0) && u.x === x && u.y === y);
  const walk = (x, y) => CELL[b.cells[I(x, y)].k].walk && !["stairs", "ladder", "idoor", "odoor"].includes(b.cells[I(x, y)].k);
  const allRooms = R.areas.filter((a) => !a.outdoor && a.role);
  const roomCells = (a) => {
    const out = [];
    for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) if (walk(x, y) && !taken(x, y) && b.reach[I(x, y)]) out.push([x, y]);
    return out;
  };
  let hn = b.units.filter((u) => u.side === "enemy" && u.kind === "human").length;
  const put = (u, c, home) => { u.x = c[0]; u.y = c[1]; u.home = home; b.units.push(u); };
  const floor0 = b.floor || 0;
  for (const grp of groupsIn) {
    const people = (grp.people || []).slice(0, 12);
    if (!people.length) continue;
    const room = typeof grp.room === "number" ? allRooms.find((a) => a.id === grp.room) : grp.room ? allRooms.find((a) => a.role === grp.room || a.name === grp.room) : null;
    const home = room || rng.pick(allRooms.filter((a) => !a.locked && !a.entry)) || allRooms[0];
    // Storeys: the group is placed on its room's floor (the units made meanwhile carry that floor).
    if (b.floors && (home.f || 0) !== (b.floor || 0)) setFloor(b, home.f || 0);
    const rooms = allRooms.filter((a) => (a.f || 0) === (b.floor || 0));
    const far = (x, y, d) => (b.floor || 0) > 0 || d2(x, y) >= d;
    const cellsHere = () => { const list = roomCells(home).filter(([x, y]) => far(x, y, 5)); return list.length ? list : rooms.filter((a) => !a.locked).flatMap((a) => roomCells(a)).filter(([x, y]) => far(x, y, 6)); };
    if (grp.side === "hostile") {
      for (const p of people) {
        const kind = KITS[p.kit] ? p.kit : "raiders";
        const u = enemyUnit(b, rng, kind, p.power || 4, ++hn);
        if (p.weapon && WEAPONS[p.weapon] && !WEAPONS[p.weapon].acid && p.weapon !== u.weapon) { if (u.who) armPerson(b, u, GEAR[p.weapon] ? lootItem(p.weapon, kitSource(kind), [b.tileId ?? 0, "occ", u.id]) : null); else { u.weapon = p.weapon; u.weaponName = WEAPONS[p.weapon].name; } } // fighters.js: the person holds it
        if (p.name) { u.name = p.name; u.short = p.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(); }
        u.aware = !!grp.aware; u.pod = pod; u.occupant = "hostile";
        if (grp.factionId != null) { u.factionId = grp.factionId; armFromArsenal(state, b, u, hn); } // one of the group's people
        const c = rng.pick(cellsHere());
        if (c) put(u, c, [home.x0 + Math.floor(home.w / 2), home.y0 + Math.floor(home.h / 2)]);
      }
      pod++;
      continue;
    }
    // TODO(encounters): neutral survivors and military squads need a side of their own in combat.js (not the enemy's):
    // register one with registerOccupantSide("neutral" | "military", fn); until then they are listed here, not placed.
    const fn = occupantSide(grp.side);
    if (fn) fn(state, b, grp, { room: home, cells: cellsHere, pod: () => pod++ });
    else R.occupants.waiting.push({ side: grp.side, count: people.length, room: home.id });
  }
  if (b.floors && (b.floor || 0) !== floor0) setFloor(b, floor0);
  return pod;
}

// ======================================================================================
// Climbing through a window (combat.js "climb"): next to one (not diagonally; closed, open or broken: windows.js) with
// a free cell at the same height on the far side. Returns [{ x, y, to: [x, y] }].
// ======================================================================================
export function windowsNear(b, u) {
  if (!b.raid) return [];
  const W = b.w, H = b.h;
  const out = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = u.x + dx, y = u.y + dy, tx = x + dx, ty = y + dy;
    if (x < 0 || y < 0 || x >= W || y >= H || tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
    if (b.cells[y * W + x].k !== "window" && b.cells[y * W + x].k !== "smashed") continue;
    const to = b.cells[ty * W + tx];
    if (!CELL[to.k].walk || ["stairs", "ladder"].includes(to.k)) continue;
    const h0 = b.cells[u.y * W + u.x].h ?? CELL[b.cells[u.y * W + u.x].k].h ?? 0, h1 = to.h ?? CELL[to.k].h ?? 0;
    if (h0 !== h1) continue;
    if (b.units.some((o) => !o.dead && !o.left && !o.fled && !o.away && o.x === tx && o.y === ty)) continue;
    out.push({ x, y, to: [tx, ty] });
  }
  return out;
}

// ======================================================================================
// Doors in play (combat.js combatAct "close" / "brace" / "peek", bash, breakCell, moveAlong)
// ======================================================================================
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const cellOf = (b, x, y) => (x >= 0 && y >= 0 && x < b.w && y < b.h ? b.cells[y * b.w + x] : null);
const unitOn = (b, x, y) => b.units.some((o) => !o.dead && !o.left && !o.fled && !o.off && !o.away && o.x === x && o.y === y); // away: on another storey
// Open doors next to a unit (not diagonally) with nobody standing in them: they can be closed.
export function closeOptions(b, u) {
  return NEXT4.map(([dx, dy]) => [u.x + dx, u.y + dy]).filter(([x, y]) => { const c = cellOf(b, x, y); return c && c.k === "odoor" && !unitOn(b, x, y); }).map(([x, y]) => ({ x, y }));
}
// Closed or locked doors next to a unit with strength left: they can be braced.
export function braceOptions(b, u) {
  return NEXT4.map(([dx, dy]) => [u.x + dx, u.y + dy]).filter(([x, y]) => { const c = cellOf(b, x, y); return c && (c.k === "idoor" || c.k === "door") && c.hp > 0; }).map(([x, y]) => ({ x, y }));
}
// Doors and doorways next to a unit to peek through: { x, y (the door), fx, fy (the cell beyond it, where the look is
// taken from) }.
const PEEKABLE = new Set(["idoor", "odoor", "door", "doorway", "smashed"]);
export function peekOptions(b, u) {
  const out = [];
  for (const [dx, dy] of NEXT4) {
    const x = u.x + dx, y = u.y + dy, c = cellOf(b, x, y), far = cellOf(b, x + dx, y + dy);
    if (!c || !PEEKABLE.has(c.k) || !far || (CELL[far.k].los && !CELL[far.k].walk)) continue;
    out.push({ x, y, fx: x + dx, fy: y + dy });
  }
  return out;
}
// Cells seen through this turn's peeks (combat.js playerVision, playerSees).
export function peekSees(b, x, y) {
  for (const p of b.peeks || []) {
    if (p.turn !== b.turn || (b.floors && (p.f || 0) !== (b.floor || 0))) continue; // another storey's peek shows nothing here
    if ((x === p.x && y === p.y) || (x === p.dx && y === p.dy)) return true;
    if (Math.hypot(x - p.x, y - p.y) <= p.r && los(b, p.x, p.y, x, y)) return true;
  }
  return false;
}
// Closing a door (1 action; quiet, a roller door loud), bracing one (the rest of the turn: it holds against people
// and takes half of each blow until you step away), peeking through one (free, once a turn). H: { say, alertNear, fx }.
export function doorAct(state, b, u, act, H) {
  const pickOf = (list) => (act.x != null ? list.find((o) => o.x === Number(act.x) && o.y === Number(act.y)) : list[0]);
  if (act.type === "close") {
    const o = pickOf(closeOptions(b, u));
    if (!o) return "Stand next to an open door (not diagonally) with nobody in the doorway.";
    const c = cellOf(b, o.x, o.y);
    const list = [[o.x, o.y]];
    if (c.roll) for (let i = 0; i < list.length; i++) for (const [dx, dy] of NEXT4) {
      const nx = list[i][0] + dx, ny = list[i][1] + dy, n = cellOf(b, nx, ny);
      if (n && n.k === "odoor" && n.roll && !unitOn(b, nx, ny) && !list.some(([px, py]) => px === nx && py === ny)) list.push([nx, ny]);
    }
    for (const [x, y] of list) {
      const d = cellOf(b, x, y);
      d.k = "idoor";
      if (d.tOpen) d.t = d.tOpen;
      if (!(d.hp > 0)) d.hp = d.mhp = d.roll ? BMAP.DOOR.roller : BMAP.DOOR.inner;
    }
    b.losCache.fill(0);
    u.ap -= 1;
    u.face = [Math.sign(o.x - u.x), Math.sign(o.y - u.y)];
    if (c.roll) {
      if (b.raid) b.raid.heat = Math.min(100, b.raid.heat + BMAP.ROLLER.heat);
      b.noise = (b.noise || 0) + 1;
      H.say(b, `${u.name} hauls the roller door down. It clangs shut (Heat +${BMAP.ROLLER.heat}).`, "info");
      H.alertNear(b, o.x, o.y, BMAP.ROLLER.radius, "The clang of the roller door carries.");
    } else H.say(b, `${u.name} eases the door shut.`, "info");
    return "";
  }
  if (act.type === "brace") {
    const o = pickOf(braceOptions(b, u));
    if (!o) return "Stand next to a closed door (not diagonally) to brace it.";
    const c = cellOf(b, o.x, o.y);
    u.brace = [o.x, o.y];
    c.held = u.id;
    u.ap = 0;
    u.hunker = false;
    u.face = [Math.sign(o.x - u.x), Math.sign(o.y - u.y)];
    H.say(b, `${u.name} braces the door with a shoulder: people cannot open it, and it takes half of every blow until ${u.name.split(" ")[0]} lets go.`, "good");
    return "";
  }
  // Peek.
  const o = pickOf(peekOptions(b, u));
  if (!o) return "Stand right next to a door or a doorway (not diagonally) to peek through it.";
  if (u.peekTurn === b.turn) return `${u.name} has already peeked this turn.`;
  u.peekTurn = b.turn;
  b.peeks = (b.peeks || []).filter((p) => p.turn === b.turn);
  b.peeks.push({ turn: b.turn, unit: u.id, x: o.fx, y: o.fy, dx: o.x, dy: o.y, f: b.floor || 0, r: Math.min(BMAP.PEEK.range, u.sight || BMAP.PEEK.range) });
  u.face = [Math.sign(o.x - u.x), Math.sign(o.y - u.y)];
  // Someone on the other side may catch the movement.
  const P = BMAP.PEEK;
  const eye = { ...u, x: o.fx, y: o.fy };
  let caught = null;
  for (const e of b.units) {
    if (e.side !== "enemy" || e.aware || !active(e) || caught) continue;
    const d = Math.hypot(e.x - o.fx, e.y - o.fy);
    if (!los(b, e.x, e.y, o.fx, o.fy)) continue;
    let p = 0;
    if (e.kind === "human") { if (d <= detectRange(b, e, eye, true) && !isBehind(eye, e)) p = Math.max(P.min, P.notice - P.perStealth * (u.stealth || 0)); }
    else if (d <= P.deadNear) p = P.deadNotice;
    if (p && b.rng.chance(p)) caught = e;
  }
  const seen = b.units.filter((e) => e.side === "enemy" && active(e) && peekSees(b, e.x, e.y)).length;
  H.say(b, `${u.name} peeks through the ${cellOf(b, o.x, o.y).k === "idoor" ? "door" : "doorway"}: ${seen ? `${seen} ${seen === 1 ? "figure" : "figures"} beyond` : "nothing moving"}.`, "info");
  if (caught) alertPod(b, caught.pod, `${caught.name} ${caught.kind === "zombie" ? "lurches toward the door" : "catches the movement at the door"}!`);
  return "";
}
// Each blow on a closed door (combat.js bash): noise, and the unaware nearby come to look.
export function doorNoise(b, x, y) {
  b.noise = (b.noise || 0) + BMAP.DOOR_NOISE.noise;
  noiseAt(b, x, y, BMAP.DOOR_NOISE.radius, "door");
}
// A door battered down (combat.js breakCell): it stays broken; a locked one counts as opened.
export function doorBroken(b, x, y) {
  const c = cellOf(b, x, y);
  c.k = "doorway";
  delete c.held; delete c.t; delete c.tOpen;
  const d = ((b.raid ? b.raid.doors : b.doors) || []).find((q) => q.x === x && q.y === y && (q.f || 0) === (b.floor || 0)); // a field map's houses too (combat.js b.doors)
  if (d && !d.lock.open) { d.lock.open = true; d.lock.how = "broken"; }
}
// Where a thrown thing lands inside a building: through open doorways and open or broken windows (windows.js), not
// through walls, closed doors, tall shelving or glass (it drops in the last free cell before). Null when there is no
// room at all.
export const throwBlocks = (c) => (CELL[c.k].los && !CELL[c.k].walk) || (c.k === "window" && !windowOpen(c)) || c.k === "idoor" || c.k === "door";
export function throwLanding(b, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 4);
  let last = null;
  for (let i = 1; i <= n; i++) {
    const px = x0 + 0.5 + (dx * i) / n, py = y0 + 0.5 + (dy * i) / n;
    const cx = Math.floor(px), cy = Math.floor(py);
    if (cx === x0 && cy === y0) continue;
    const c = cellOf(b, cx, cy);
    if (!c) break;
    const fx = px - cx, fy = py - cy;
    const graze = !(fx > 0.12 && fx < 0.88 && fy > 0.12 && fy < 0.88);
    if (throwBlocks(c)) { if (graze) continue; return last; }
    if (CELL[c.k].walk) last = [cx, cy];
  }
  return last && last[0] === x1 && last[1] === y1 ? [x1, y1] : last;
}
// How much walls and closed doors muffle a noise inside: BMAP.WALL_DAMP tiles for each between.
export function noiseDamp(b, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 4);
  const seen = new Set();
  for (let i = 1; i < n; i++) {
    const px = x0 + 0.5 + (dx * i) / n, py = y0 + 0.5 + (dy * i) / n;
    const cx = Math.floor(px), cy = Math.floor(py);
    if ((cx === x0 && cy === y0) || (cx === x1 && cy === y1)) continue;
    const c = cellOf(b, cx, cy);
    if (!c || !CELL[c.k].los || CELL[c.k].walk && c.k !== "idoor") continue;
    const fx = px - cx, fy = py - cy;
    if (fx > 0.12 && fx < 0.88 && fy > 0.12 && fy < 0.88) seen.add(cy * b.w + cx);
  }
  return seen.size * BMAP.WALL_DAMP;
}

// ---------- the raid bot (combat.js autoRaidTurn) ----------
// On the way out: shut an open door between it and the dead (or hostile people) coming after it, or throw a lure
// away from its way out to pull off the dead that cannot see it close up. Returns an action or null.
export function botEscape(state, b, u, targets) {
  if (u.ap < 1) return null;
  const foes = b.units.filter((e) => e.side === "enemy" && active(e) && e.aware);
  if (!foes.length) return null;
  for (const o of closeOptions(b, u)) {
    const far = [o.x * 2 - u.x, o.y * 2 - u.y];
    if (foes.some((e) => Math.hypot(e.x - o.x, e.y - o.y) <= 6 && Math.hypot(e.x - far[0], e.y - far[1]) < Math.hypot(e.x - u.x, e.y - u.y))) return { type: "close", unit: u.id, x: o.x, y: o.y };
  }
  if (b.botEscapeTurn === b.turn) return null;
  const have = throwablesOf(state, b, u);
  const key = ["noisemaker", "firecracker", "bottle"].find((k) => have[k]);
  if (!key) return null;
  const chasers = foes.filter((e) => e.kind === "zombie" && Math.hypot(e.x - u.x, e.y - u.y) <= 8 && Math.hypot(e.x - u.x, e.y - u.y) > BMAP.DIVERT_NEAR);
  if (chasers.length < 2) return null;
  const T = THROWABLES[key];
  const nearExit = (x, y) => Math.min(...targets.map(([tx, ty]) => Math.hypot(tx - x, ty - y)));
  let best = null;
  for (let y = Math.max(0, u.y - T.range); y <= Math.min(b.h - 1, u.y + T.range); y++) for (let x = Math.max(0, u.x - T.range); x <= Math.min(b.w - 1, u.x + T.range); x++) {
    const d = Math.hypot(x - u.x, y - u.y);
    if (d < 4 || d > T.range || !CELL[b.cells[y * b.w + x].k].walk) continue;
    const land = throwLanding(b, u.x, u.y, x, y);
    if (!land || land[0] !== x || land[1] !== y) continue;
    const sc = nearExit(x, y) + chasers.filter((e) => Math.hypot(e.x - x, e.y - y) <= T.radius).length * 3;
    if (!best || sc > best.sc) best = { x, y, sc };
  }
  if (!best) return null;
  b.botEscapeTurn = b.turn;
  return { type: "throw", unit: u.id, item: key, x: best.x, y: best.y };
}

// Where the stairs are, for the raid's opening lines: each run by the room it goes up from ("a stair run up from the
// lobby's wall"), the motel's outside stair, or the one-cell stairwell of a footprint too small for a run.
function stairsText(R) {
  const runs = R.runs || [];
  if (!runs.length) return R.stairs.length === 1 ? "a stairwell on every floor" : `${R.stairs.length} stairwells on every floor`;
  const roomOf = (r) => (R.areas || []).find((a) => !a.outdoor && (a.f || 0) === 0 && r.x > a.x0 && r.x < a.x0 + a.w - 1 && r.y > a.y0 && r.y < a.y0 + a.h - 1);
  const one = (r) => {
    if (r.out) return `an outside stair up the ${r.out} wall to the walkway`;
    if (r.single) return "a single stair cell (the building is too small for a flight)";
    const a = roomOf(r), name = a ? (a.noLabel ? ROLES[a.role] ? ROLES[a.role].name : a.name : a.name).toLowerCase() : "hall";
    return `a flight of ${r.len} steps against a wall of the ${name}`;
  };
  const list = runs.map(one);
  return `${list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0]}, up from a landing to a landing; the top step takes you up or down a floor`;
}
// The building's name and its exits, for the raid's opening lines.
export function interiorIntro(b) {
  const R = b.raid;
  if (!R || !R.interior) return "";
  if (R.plan && R.plan.street) return streetIntro(b);
  const ex = (R.plan.exits || []).filter((e) => e.zone >= 0);
  const lockedEx = (R.plan.exits || []).filter((e) => e.locked).length;
  const names = ["the front", ...ex.map((e) => e.name.toLowerCase())];
  const st = R.storeys > 1 ? ` ${R.storeys} storeys: ${stairsText(R)}; the ways out are on the ground floor.` : "";
  return `Ways out: ${names.join(", ")}${lockedEx ? ` (${lockedEx} locked)` : ""}.${st} Rooms, walls and closed doors block sight (a glass or a screen door is seen through): peek through a door (K) before you go in, shut doors behind you (Shift+E): the dead have to batter them down. Windows: check one from next to it (free), open it if it is unlocked (or from inside if it is locked: 1 action, quiet), then climb or vault through; a fixed one only breaks (loud).`;
}
// A street of houses (streetMap): the houses, the ways out, and the houses your side has been into before (the
// containers the POI's ledger brought back as you left them: poicont.js poiRaidStart marks them mine).
export function streetIntro(b) {
  const R = b.raid, P = R.plan;
  const names = (P.houses || []).map((h) => h.name);
  const been = (P.houses || []).filter((h) => R.containers.some((c) => c.house === h.k && c.mine)).map((h) => h.name);
  const robbed = (P.houses || []).filter((h) => { const cs = R.containers.filter((c) => c.house === h.k); return cs.length && cs.every((c) => c.ransacked && !c.mine); }).map((h) => h.name);
  const ways = R.zones.map((z) => (z.name || z.side).toLowerCase());
  if (R.plan.word) return `${b.place || "The place"}: ${names.length} ${R.plan.word} (${names.join(", ")}). Ways out: ${ways.join(", ")}.${been.length ? ` Your people have been through ${been.join(", ")} before: what you left there is as you left it.` : ""}${robbed.length ? ` ${robbed.join(", ")} ${robbed.length === 1 ? "looks" : "look"} ransacked.` : ""} Rooms, walls and closed doors block sight: peek through a door (K) before you go in, shut doors behind you (Shift+E).`; // several buildings that are not a street's houses (a motor lodge's cabins, garden apartments: issue #32)
  return `A street of ${names.length} houses (${names.join(", ")}), ${R.storeys > 1 ? `${R.storeys} storeys each: the stairs are inside every house` : "one storey each"}. Ways out: ${ways.join(", ")}.${been.length ? ` Your people have been through ${been.join(", ")} before: what you left there is as you left it.` : ""}${robbed.length ? ` ${robbed.join(", ")} ${robbed.length === 1 ? "looks" : "look"} ransacked.` : ""} Rooms, walls and closed doors block sight: peek through a door (K) before you go in, shut doors behind you (Shift+E). Windows: check one from next to it (free), open it if it is unlocked (1 action, quiet) and climb or vault through; a fixed one only breaks (loud).`;
}
