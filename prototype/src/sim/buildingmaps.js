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
import { fitMargins, buildingTarget, densifyOutside, densify, coverTarget, buildingDeadScale, streetDeadScale, raidMaxDims, raidDims, SIZE_CLASSES, mapCap } from "./battlesize.js";
import { legacyRaids, legacyRooms, legacyScale, legacyOffices, legacyShapes, legacyPrisons } from "./worldcfg.js"; // an older save: a neighbourhood's street laid out as it always was; its buildings furnished as they were
import { roomLayout, homeStyle, medicalStyle, LAYOUT } from "./roomlayout.js"; // homes furnished room by room (the placement helpers); hospitals, clinics and vets too (#14)
import { commercialStyle, styleName as shopStyleName } from "./shoplayout.js";
import { prisonStyle } from "./prisonlayout.js"; // prisons and jails laid out for their kind (issue #31)
import { prisonMap, chowHall, postBodies } from "./prison.js"; // a prison's or a county jail's complex of buildings (issue #31)
import { OFFICE_PLANS } from "./officeplans.js"; // the office buildings of every kind, the corporate tower (issue #27)
import { officeStyle } from "./officelayout.js"; // their rooms' styles (a leaf's office mark) // shops, restaurants, bars, offices, motels, banks and big stores laid out for their kind (issue #16)
import { civicStyle } from "./civiclayout.js"; // police stations, fire stations, schools and churches laid out for their kind (issue #15)
import { campusStyle, CAMPUS_PLANS, CAMPUS_NAMES } from "./campuslayout.js"; // the college campus buildings laid out for their kind (issue #28)
import { campusMap, campusLegacy, campusDead, campusIntro, campusFolk } from "./campus.js"; // a college campus: many buildings on one map (issue #28)
import { hotelSpec } from "./hotellayout.js"; // hotels: their plans, rooms, grounds and scenes (issue #29)
import { militaryStyle, militaryOutside, MIL_SIZE } from "./militarylayout.js";
import { milVariant, milSiteOf, milSiteById, MIL_SITES } from "./milplans.js"; // a dozen plans each for the military, air-base and airport buildings (issue #25, #32's rule) // military bases, air bases, airports and prisons laid out like the real thing (issue #25)
import { decorate, flipDecoY, placeDecorPieces } from "./decor.js"; // rugs, clutter, wall art, wall colours, light fixtures (cosmetic)
import { rollWin, winMixOf, windowOpen } from "./windows.js"; // the windows' states (open, locked, fixed), a throw through an open one
import { rollScenes, sceneRng } from "./interiorscenes.js"; // signs of survival: barricades, blood, bodies (dice of their own)
import { realFoot, realStoreys, storeyRange, REAL_SIZE } from "./data-buildingsize.js"; // buildings at real size (issue #24)
import { BUNKER_PLANS, bunkerStyle, levelName } from "./bunkerlayout.js"; // bunkers: the plans, their rooms, their levels below ground (issue #26)
import { eateryPlan, eateryOf } from "./eaterylayout.js"; // restaurants by kind of food, format and size (issue #33)
import { industryPlan, industryStyle, INDUSTRY_ROLES, INDUSTRY_KEYS } from "./industrylayout.js"; // warehouses, factories and labs: a dozen plans each (issue #37)
import { hasVariants, shopVariantSpec, variantSetting } from "./shopvariants.js"; // a dozen layout variants a shop and service type (issue #35; a new save's plan)
import { pieceDef } from "./data-furniture.js"; // a yard piece that holds loot (spec.yardPieces)
import { variantSpec } from "./civicvariants.js"; // a dozen plans each for the hospital, infirmary, clinic, vet, church, police and fire station (issue #36)
import { settingOf as shopSetting } from "./shops.js"; // a site's setting with its suburbs (city, suburb, town) picks among a kind's plans (issue #36)
import { libraryPlan, libraryStyle } from "./librarylayout.js"; // libraries: thirteen variants and their plans, their rooms (issue #34)

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
  DEAD_CAP: 120,       // a building at real size (realScale): its dead by its floor area, at most this many of a group (a turn with 60 stays well under a second: tools/bigmapbench.js)
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
  blast:    { name: "Blast door", hp: 400, see: false, diff: 3, kick: false, force: false, sfx: "vault", desc: "a bunker's portal: a slab of steel on hinges a metre thick, not kicked or forced" }, // bunkers (issue #26)
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
  bunker: { front: "blast", back: "steel", side: "steel" }, // the blast door at the portal, a steel hatch (issue #26)
};
const STYLE_OF = {
  house: "house", farmhouse: "house", cabin: "house", lodge: "house", ranger: "house", motel: "house", neighbourhood: "house",
  sportshop: "shop", electronics: "shop", radioshop: "shop", bookstore: "shop", petstore: "shop", garden: "shop", clothing: "shop", liquor: "shop", restaurant: "shop", bar: "shop", dealer: "shop", library: "office", vet: "office",
  grocery: "shop", corner: "shop", pharmacy: "shop", hardware: "shop", feedstore: "shop", diner: "shop", gasstation: "shop", truckstop: "shop", supermarket: "shop", deptstore: "shop",
  clinic: "office", infirmary: "office", hospital: "office", school: "office", offices: "office", lab: "office", terminal: "office", apartments: "office",
  storefront: "shop", bizpark: "office", cityhall: "office", callcenter: "office", techoffice: "office", station: "office", courthouse: "secure", // issue #27
  gunstore: "secure", pawnshop: "secure", bank: "secure", police: "secure", barracks: "secure", armorybldg: "secure", cellblock: "secure", control: "secure",
  firestation: "works", messhall: "works", radio: "works", warehouse: "works", factory: "works", hangar: "works", motorpool: "works", autoshop: "works", garage: "works", workshop: "works", machineshed: "works",
  barn: "barn", church: "church",
  // A prison's and a jail's buildings (prison.js, issue #31): steel and security doors.
  pblock: "secure", pcontrol: "secure", pgate: "secure", parmory: "secure", jailmain: "secure", padmin: "office", pschool: "office", pinfirmary: "office", pchapel: "church", pchow: "works", pworks: "works",
  // a college campus's buildings (issue #28, campuslayout.js)
  dorm: "office", lecturehall: "office", sciencehall: "office", univlibrary: "office", studentunion: "shop", dininghall: "shop", athletics: "office",
  admin: "office", security: "secure", maintenance: "works", theatre: "office", parkgarage: "works", chapel: "church", healthcentre: "office", campus: "office",
  hq: "secure", aidstation: "office", gatehouse: "secure", tower: "secure", flightops: "office", // issue #25
  milbunker: "bunker", mountainbunker: "bunker", govbunker: "bunker", shelter: "bunker", prepper: "bunker",
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
// wood, tile, conc, carpet, dirt; since 2026-10-25 also hardwood, plank, lino, checker, rubber, steel: issue #13 (marble: issue #27, a grand lobby), drawn
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
  // Prisons and jails (issue #31: prison.js plans them, prisonlayout.js PRISON_STYLES lays them out; new saves only).
  picket:      role("Officers' station", "pcontrol", "none", { hub: true, fl: "lino", maxBoxes: 2 }),
  tier:        role("Cell tier", "pcells", "none", { fl: "conc", windows: false, maxBoxes: 40 }), // a row of cells and the walkway before them
  pdayroom:    role("Day room", null, "none", { hub: true, fl: "conc" }),
  well:        role("Open well", null, "none", { label: false, fl: "conc", windows: false }), // over a two-tier block's day room (prison.js openTiers: open air upstairs)
  pdorm:       role("Dormitory", "pcells", "none", { hub: true, fl: "conc", maxBoxes: 12 }),
  pcontrol:    role("Central control", "pcontrol", "none", { fl: "lino", windows: false, maxBoxes: 4 }),
  mainhall:    role("Main corridor", null, "none", { hub: true, label: false, fl: "lino", windows: false }),
  chow:        role("Chow hall", null, "none", { hub: true, fl: "lino" }),
  pkitchen:    role("Prison kitchen", "pkitchen", "none", { fl: "tile", maxBoxes: 6 }),
  pstores:     role("Food warehouse", "pstores", "none", { fl: "conc", maxBoxes: 10 }),
  property:    role("Property room", "property", "none", { fl: "conc", windows: false, maxBoxes: 12 }),
  booking:     role("Booking", "office", "none", { hub: true, fl: "lino", maxBoxes: 3 }),
  holding:     role("Holding tank", "pcells", "none", { fl: "conc", windows: false, maxBoxes: 2 }),
  visitation:  role("Visitation", null, "none", { hub: true, fl: "lino" }),
  psych:       role("Psych unit", "pcells", "none", { fl: "lino", windows: false, maxBoxes: 8 }),
  plaundry:    role("Laundry", "plaundry", "none", { hub: true, fl: "conc", maxBoxes: 4 }),
  pshop:       role("Prison industries", "workshop", "none", { hub: true, fl: "conc", maxBoxes: 6 }),
  parmory:     role("Armory", "parmory", "none", { fl: "conc", windows: false, maxBoxes: 8 }),
  pward:       role("Infirmary ward", "clinic", "none", { fl: "lino", maxBoxes: 4 }),
  plibrary:    role("Library", "office", "none", { hub: true, fl: "carpet", maxBoxes: 4 }),
  gatepost:    role("Gatehouse", "pcontrol", "none", { hub: true, fl: "lino", maxBoxes: 2 }),
  pyard:       role("Exercise yard", null, "none", { fl: "conc" }), // a jail's rooftop or walled yard
  pshower:     role("Showers", null, "none", { fl: "tile", windows: false }), // a housing unit's showers (prisonlayout.js showers)
  pcubicles:   role("Cubicle dormitory", "pcells", "none", { hub: true, fl: "conc", maxBoxes: 12 }),
  pgallery:    role("Gun gallery", "pcontrol", "none", { hub: true, fl: "steel", maxBoxes: 1 }), // a three-tier block's top station (an officers' station by its prison mark)
  ppodctl:     role("Pod control", "pcontrol", "none", { hub: true, fl: "lino", maxBoxes: 2 }), // a split pod's middle station
  pcommissary: role("Commissary", "pstores", "none", { fl: "conc", maxBoxes: 8 }),
  // Bunkers (issue #26: bunkerlayout.js BUNKER_STYLES; no windows anywhere, concrete and steel). A plan's { role: "rock" }
  // leaf is no room: assemble fills it with the hillside's crag.
  portal:      role("Blast door hall", "barracks", "none", { fl: "steel", maxBoxes: 1 }),
  airlock:     role("Airlock", "barracks", "none", { fl: "steel", maxBoxes: 1 }),
  checkpoint:  role("Security checkpoint", "barracks", "none", { hub: true, fl: "conc", maxBoxes: 1 }),
  hatch:       role("Escape hatch", null, "none", { fl: "conc" }),
  tunnel:      role("Main tunnel", null, "none", { hub: true, fl: "conc" }),
  genroom:     role("Generator room", "motorpool", "none", { fl: "steel", maxBoxes: 2 }),
  waterstore:  role("Water store", "kitchen", "shelves", { fl: "conc", maxBoxes: 2 }),
  medbay:      role("Med bay", "clinic", "beds", { fl: "lino", maxBoxes: 3 }),
  // Warehouses, factories and labs (issue #37: industrylayout.js INDUSTRY_ROLES): a loading dock, a cold room, a
  // self-storage unit, a sorting hall, a production line, a process hall, a kiln hall, a clean room, a gowning room, a
  // greenhouse.
  ...INDUSTRY_ROLES,
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
  // Issue #25 (militarylayout.js militaryOutside): a base's compound, an air base's or an airport's apron, a prison's
  // grounds.
  compound:   { yard: "dirt", walk: "gravel", street: "road", alley: "dirt" },
  airfield:   { yard: "grass", walk: "road", street: "road", alley: "gravel" },
  prisonyard: { yard: "gravel", walk: "gravel", street: "road", alley: "dirt" },
  rock:  { yard: "dirt", walk: "gravel", street: "road", alley: "dirt" }, // a bunker in the hillside (assemble: crag round it, spec.rockFill)
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
// The most storeys a building has (a city's towers, issue #24: 6–10), and the most of them that are real floors: a
// building taller than OPEN_STOREYS is built up to OPEN_STOREYS floors (one more deeper in the city crawl: opts.
// storeyBonus) and its stairs up from the top one are blocked (collapsed into rubble or barricaded: the cell's sealUp),
// so the floors above never need to exist (the user's word 2026-10-25: "just block off or have destroyed stairs to
// prevent going to higher stories though they dont actually exist"). spec.height: the building's storeys (its look,
// the block card); spec.storeys: the floors built.
export const MAX_STOREYS = 10;
export const OPEN_STOREYS = 4;
const OLD_MAX = 8; // the cap before (an older save's offices and apartments keep their storeys and footprints)
/** The floors built of a building `height` storeys tall (a crawl's deeper block: bonus > 0, one more). */
export const openStoreys = (height, bonus = 0) => (height <= OPEN_STOREYS ? height : Math.min(height - 1, OPEN_STOREYS + (bonus > 0 ? 1 : 0)));

// o.legacy: an older save's plan (worldcfg.js legacyRooms). Since rooms are furnished room by room (roomlayout.js) a
// kitchen keeps room for its fridge, sink and stove: a farmhouse's pantry only when it is wide enough, and a house's or
// a ranger station's garage takes the ground floor's bath (upstairs has one) or the supply room rather than squeezing
// the kitchen to two cells. The dice are rolled as before either way.
function house(rng, v, o = {}) {
  const roomy = !o.legacy;
  const big = v === "farmhouse" || v === "lodge";
  const shaped = roomy && !!o.shapes; // a new save's footprint shape (issue #23: houseShape)
  let bw = v === "cabin" ? rng.int(8, 10) : v === "lodge" ? rng.int(15, 18) : v === "farmhouse" ? rng.int(12, 15) : v === "ranger" ? rng.int(12, 14) : rng.int(11, 14);
  let bh = v === "cabin" ? rng.int(7, 8) : v === "lodge" ? rng.int(11, 13) : v === "farmhouse" ? rng.int(10, 12) : rng.int(9, 11);
  if (shaped && o.cap) { bw = clampN(bw, 10, o.cap.w); bh = Math.min(bh, o.cap.h); } // a street's house (streetMap): its plot, before the shape is cut to it
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
  let garage = null; // a shape's garage: an annex on its side (houseShape), not a strip of the box
  if (v === "house" && bw >= 12 && rng.chance(0.4)) {
    const left = rng.chance(0.5);
    if (roomy) { front = { role: "living", entry: true, type: "house" }; back = { role: "kitchen" }; program = plan(); } // the bedrooms upstairs
    const g = [4, { role: "hgarage" }];
    if (shaped) garage = { left, leaf: g[1] };
    else program = { split: "x", parts: left ? [g, ["*", program]] : [["*", program], g] };
    exits.push({ side: "front", roles: ["hgarage"], chance: 1, roller: true, width: 2, lock: 0.2 });
  }
  if (v === "ranger" && rng.chance(0.5)) {
    const left = rng.chance(0.5), g = [4, { role: "hgarage", type: "garage" }];
    if (roomy) { front = { split: "x", parts: leaves([[0.55, { role: "office", name: "Ranger office", entry: true, hub: true }], ["*", "bunk"]]) }; back = { role: "kitchen" }; program = plan(); }
    if (shaped) garage = { left, leaf: g[1] };
    else program = { split: "x", parts: left ? [g, ["*", program]] : [["*", program], g] };
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
  const spec = {
    bw, bh, program, exits, front: { width: 1 }, openDoors: 0.4, extraDoors: 0.2,
    storeys: two ? 2 : 1, upper: two ? upper : null, foot: big ? "medium" : "small",
    stairs: { roles: ["hall", "living", "greatroom", "dining"], near: "front" }, // up from the hall (else the front room) by the front door
    ground: v === "farmhouse" ? "farm" : v === "cabin" || v === "lodge" || v === "ranger" ? "woods" : "town",
  };
  return shaped ? houseShape(rng, v, spec, { garage, hall, o, upper }) : spec;
}
// A home's shape (a new save's, issue #23), by its own dice after the plan's: a garage the house rolled is an annex on
// its side, flush with the front and as deep or a little shallower (one storey: open air above); else an L (a wing out
// the back on the kitchen's side: a sun room, the laundry or a bedroom, one storey), a porch (a front corner notched:
// the living room and the kitchen in the full-depth part, a bedroom behind the porch) or the plain box. A street's
// house (o.cap: its plot) takes the shapes that fit the plot. A cabin stays a box.
function houseShape(rng, v, spec, { garage, hall, o, upper }) {
  const { bw, bh } = spec, cap = o.cap || null;
  const two = spec.storeys > 1;
  if (garage) {
    const hg = bh - rng.int(0, 2), left = garage.left;
    return { ...spec, ...shapeOf("annex", [
      { x: left ? 5 : 0, y: 0, w: bw - 5, h: bh, name: "House", main: true, program: spec.program, upper },
      { x: left ? 0 : bw - 6, y: bh - hg, w: 6, h: hg, storeys: 1, name: "Garage", program: { ...garage.leaf, nextTo: ["kitchen", "hall", "living"] } },
    ]), program: null, upper: null };
  }
  if (v === "cabin") return spec;
  const r = hash01(rng.state, "shape", v); // the shape's dice read, not consumed: a house that stays a box rolls on as it did
  const kitchenLeft = v === "house" || v === "farmhouse"; // the plan's back row starts with the kitchen
  if (r < 0.45 && !(cap && bh + 5 > cap.h)) {
    const wh = rng.int(5, 6), ww = rng.int(5, 7);
    const wing = v === "lodge" ? { role: "storage", name: "Mud room", type: "cabin" } : v === "ranger" ? { role: "storage", name: "Woodshed", type: "cabin" }
      : rng.pick([{ role: "dayroom", name: "Sun room", type: "house" }, { role: "storage", name: "Laundry", type: "house" }, { role: "bedroom" }]);
    const left = v === "lodge" ? rng.chance(0.5) : kitchenLeft;
    return { ...spec, ...shapeOf("L", [
      { x: 0, y: wh - 1, w: bw, h: bh, name: "House", main: true, program: spec.program, upper },
      { x: left ? 0 : bw - ww, y: 0, w: ww, h: wh, storeys: 1, name: "Back wing", program: { ...wing, nextTo: ["kitchen", "hall", "greatroom"] } },
    ]), program: null, upper: null };
  }
  if (r < 0.75 && bw >= 12 && (v === "house" || v === "farmhouse")) {
    // The porch: a corner of the front 4 wide and 2 deep left out; the box's rooms close up in the rest.
    const nx = 4, left = rng.chance(0.5), farm = v === "farmhouse";
    const living = { role: "living", entry: true, type: farm ? "farmhouse" : "house" };
    const back = { split: "x", parts: leaves([["*", "kitchen"], [2, "bath"]]) };
    const program = hall ? { split: "y", parts: [["*", living], [1, { role: "hall" }], ["*", back]] } : { split: "y", parts: [["*", living], ["*", back]] };
    const [full, short] = notchParts(bw, bh, nx, 2, "front", left);
    return { ...spec, ...shapeOf("notch", [
      { ...full, name: "House", main: true, program, upper },
      { ...short, name: "Porch side", program: { role: "bedroom", type: farm ? "farmhouse" : "house", nextTo: ["living", "hall"] }, ...(two ? { upper: () => ({ role: "bedroom" }) } : {}) },
    ]), program: null, upper: null };
  }
  return spec;
}

// Shops: a sales floor at the front, a back strip of stockroom, office and the rest; a back door, a side fire exit.
// Grocery stores by size (issue #22, a new save's plan only: o.legacy keeps the old 14–18 × 11–14 of both): a corner
// store small (10–14 across: the till's counter, a few short shelf runs, the drinks fridges and a chest freezer, a
// stockroom of crates), a neighbourhood grocery medium (20–26 × 17–20: aisles, checkouts, produce, the dairy wall and
// the frozen section, a small deli counter; a stockroom with a walk-in cooler behind it). The supermarket is bigstore's
// (supermarket below). The dice are rolled in the same order either way.
function shop(rng, v, o = {}) {
  // Issue #33: a new save's restaurant, pizza place, diner or bar is its variant's plan (eaterylayout.js: by its cuisine,
  // format and size; a place with no franchise one by the building's dice, read not consumed). An older save as below.
  if (!o.legacy && (v === "restaurant" || v === "diner" || v === "bar")) {
    const kind = v === "diner" && o.kind === "pizza" ? "pizza" : v;
    return eateryPlan(rng, eateryOf(kind, o.variant, hash01(rng.state, "eatery")), planOf(v, o));
  }
  if (!o.legacy && hasVariants(v)) { // issue #35: the type's 12 named plans (shopvariants.js), #23's shape on a new save's
    const sp = shopVariantSpec(v, rng, o, withPlan, planOf(v === "gasstation" ? "gas" : v, o));
    return o.shapes ? shopShape(rng, sp, sp.backParts, null) : sp;
  }
  const gas = v === "gasstation", truck = v === "truckstop";
  const plan = planOf(v === "gasstation" ? "gas" : v, o); // data-shops.js: the franchise's layout
  const tier = !o.legacy && (v === "corner" || v === "grocery") ? v : null; // issue #22: the corner store and the grocery by size
  const bw = (tier === "corner" ? rng.int(10, 13) : tier === "grocery" ? rng.int(20, 23) : gas ? rng.int(12, 14) : truck ? rng.int(19, 22) : rng.int(14, 18)) + (plan.wide ? (tier === "corner" ? 1 : 3) : 0);
  const bh = tier === "corner" ? rng.int(10, 12) : tier === "grocery" ? rng.int(17, 20) : gas ? rng.int(9, 10) : truck ? rng.int(12, 14) : rng.int(11, 14);
  const ih = bh - 2;
  const sd = tier === "grocery" ? ih - 5 : Math.max(4, Math.round(ih * (plan.depth ?? (gas ? 0.6 : 0.62)))); // a grocery's sales floor: all but a 4-deep back strip
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
      back = plan.back === "big" ? [["*", { role: "stock", type: "sportshop", name: "Stockroom", maxBoxes: 4 }], [rng.int(4, 5), { role: "lockerroom", name: "Fitting rooms", type: "lockers" }], [rng.int(3, 4), { role: "office", boxLock: ["safe", 0.2] }]]
        : plan.back === "hunt" ? [["*", { role: "stock", type: "sportshop" }], [rng.int(4, 5), { role: "armory", name: "Gun counter", type: "gunshop", lock: ["door", 0.5], boxLock: ["cage", 0.4], maxBoxes: 3 }], [3, "office"]]
          : plan.back === "camp" ? [["*", { role: "stock", type: "sportshop", name: "Camping gear" }], [rng.int(3, 4), { role: "storage", name: "Boat and bait room", type: "sportshop" }], [3, "office"]]
            : plan.back === "lockers" ? [["*", { role: "stock", type: "sportshop" }], [4, { role: "lockerroom", name: "Team gear", type: "lockers" }], [3, "office"]]
              : [["*", { role: "stock", type: "sportshop" }], [rng.int(3, 4), "office"], [2, "restroom"]];
      break;
    case "electronics":
      sales = S({ name: "Sales floor", type: "electronics", furnish: "aisles" });
      back = plan.back === "repair" ? [["*", { role: "workshop", name: "Repair bench", type: "electronics" }], ["*", { role: "stock", type: "electronics" }], [3, "office"]]
        : [["*", { role: "stock", type: "electronics", name: "Stockroom", lock: ["door", 0.3] }], [rng.int(3, 4), { role: "office", boxLock: ["safe", 0.25] }], [2, "restroom"]];
      break;
    case "radioshop":
      sales = S({ name: "Radio counter", type: "radioshop", furnish: "shelves", maxBoxes: 5 });
      back = plan.back === "repair" ? [["*", { role: "workshop", name: "Repair bench", type: "radioshop" }], [rng.int(3, 4), { role: "storage", name: "Antenna stock", type: "radioshop" }], [3, "office"]]
        : [["*", { role: "stock", type: "radioshop" }], [rng.int(3, 4), { role: "workshop", name: "Repair bench", type: "radioshop" }], [3, "office"]];
      break;
    case "bookstore":
      sales = S({ name: "Bookshelves", type: "books", furnish: "shelves", maxBoxes: 8 });
      back = [["*", { role: "stock", type: "books", name: "Back room" }], [rng.int(3, 4), "office"], [2, "restroom"]];
      break;
    case "petstore":
      sales = S({ name: "Pet supplies", type: "petstore", furnish: "aisles" });
      back = plan.back === "tanks" ? [["*", { role: "stock", name: "Fish room", type: "petstore" }], [rng.int(3, 4), { role: "storage", name: "Feed store", type: "petstore" }], [3, "office"]]
        : plan.back === "feed" ? [["*", { role: "stock", name: "Feed room", type: "barn" }], [rng.int(3, 4), { role: "stock", type: "petstore" }], [3, "office"]]
          : [["*", { role: "stock", type: "petstore" }], [rng.int(3, 4), { role: "exam", name: "Grooming room", type: "vet" }], [3, "office"]];
      break;
    case "garden":
      sales = S({ name: "Garden aisles", type: "garden", furnish: "aisles" });
      back = plan.back === "yard" ? [["*", { role: "warefloor", name: "Yard stock", type: "garden", hub: false, maxBoxes: 5 }], [rng.int(3, 4), "office"]]
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
    case "restaurant": // the restaurant's back by its kind of place (plan.back): fast food, takeout, sit-down, a smoker, a cafe
      sales = S({ role: "dining", name: "Dining room", type: "store", hub: true });
      back = plan.back === "fastfood" ? [["*", { role: "kitchen" }], [rng.int(3, 4), { role: "pantry", name: "Walk-in", type: "kitchen", lock: ["door", 0.2] }], [2, "restroom"]]
        : plan.back === "takeout" ? [["*", { role: "kitchen" }], [3, { role: "pantry", name: "Storeroom", type: "kitchen" }]]
          : plan.back === "smoker" ? [["*", { role: "kitchen" }], [rng.int(3, 4), { role: "storage", name: "Smokehouse", type: "kitchen" }], [3, "office"]]
            : plan.back === "cafe" ? [["*", { role: "kitchen", name: "Back counter" }], [3, { role: "pantry", type: "kitchen" }], [2, "restroom"]]
              : [["*", { role: "kitchen" }], [rng.int(3, 4), { role: "pantry", name: "Storeroom", type: "kitchen", lock: ["door", 0.2] }], [3, "office"], [2, "restroom"]];
      break;
    case "bar":
      sales = S({ role: "dining", name: "Bar", type: "bar", hub: true });
      back = plan.back === "stage" ? [["*", { role: "dayroom", name: "Stage and dance floor", type: "bar" }], [rng.int(3, 4), { role: "pantry", name: "Keg room", type: "bar", lock: ["door", 0.3] }], [3, { role: "office", boxLock: ["safe", 0.3] }]]
        : [["*", { role: "kitchen", name: "Kitchen" }], [rng.int(3, 4), { role: "pantry", name: "Keg room", type: "bar", lock: ["door", 0.3] }], [3, { role: "office", boxLock: ["safe", 0.3] }], [2, "restroom"]];
      break;
    case "pawnshop": // shops.js: the counter and its cases in front, the gun case and the stock behind
      sales = S({ name: "Pawn counter", type: "pawnshop", maxBoxes: 6 });
      back = [[rng.int(4, 5), { role: "armory", name: "Gun case", type: "gunshop", lock: ["door", 0.6], boxLock: ["cage", 0.5], maxBoxes: 3 }], ["*", { role: "stock", type: "pawnshop", name: "Back room", maxBoxes: 4 }], [rng.int(3, 4), { role: "office", gunSafe: ["gunsafe2", 0.3] }]];
      break;
    case "hardware":
      sales = S({ name: "Hardware aisles", type: "hardware" }); // shops.js: the materials for building and crafting
      back = [["*", plan.back === "yard" ? { role: "warefloor", name: "Lumber yard", type: "hardware", hub: false, maxBoxes: 5 } : { role: "stock", type: "hardware", name: "Lumber and stock" }], [rng.int(3, 4), { role: "office", lock: ["door", 0.25] }], [3, { role: "parts", name: "Tool crib", type: "garage" }]]; // plan.back "yard": a lumber barn's yard
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
      sales = S({ name: v === "corner" ? "Store" : "Sales floor", type: "store", ...(tier ? { lay: tier === "corner" ? "cornerstore" : "grocerfloor", maxBoxes: tier === "corner" ? 7 : 6 } : {}) });
      back = [["*", { role: "stock", ...(tier === "grocery" ? { maxBoxes: 2 } : {}) }], [rng.int(3, 4), { role: "office", boxLock: ["safe", 0.2] }], [2, "restroom"]];
      if (tier === "grocery") back.splice(1, 0, [3, { role: "pantry", name: "Walk-in cooler", type: "kitchen", cold: true, dk: "steel", windows: false, fl: "steel", maxBoxes: 1 }]); // a small walk-in behind the dairy wall (shoplayout.js walkin)
  }
  if (!o.legacy) back = shopBack(v, back, plan, o);
  let program = { split: "y", parts: [[sd, withPlan(sales, plan)], ["*", { split: "x", parts: leaves(back) }]] };
  const exits = [];
  const shaped = !o.legacy && !!o.shapes;
  let bay = null; // a new save's service bay: an annex beside the shop (issue #23)
  if (gas || truck) {
    const g = [rng.int(4, 5), { role: "bays", name: "Service bay", maxBoxes: 3 }], right = rng.chance(0.5);
    if (shaped) bay = { right, w: g[0] + 2, leaf: { ...g[1], nextTo: ["sales", "stock"] } };
    else program = { split: "x", parts: right ? [["*", program], g] : [g, ["*", program]] };
    exits.push({ side: "front", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.2 });
  }
  exits.push({ side: "back", roles: ["stock", "kitchen", "pantry", "office", "bays"], chance: 0.9, lock: 0.3 });
  exits.push({ side: sideRoom(rng), roles: ["sales", "dining"], chance: 0.25, lock: 0.5 });
  // A corner store sometimes has a flat above the shop.
  const flat = (v === "corner" && rng.chance(0.5)) || (!!plan.flat && rng.chance(plan.flat)); // a franchise's flat above (plan.flat: a pub, a bookshop)
  const F = (r) => ({ role: r, flat: true }); // the flat's rooms take the home styles (roomlayout.js)
  const upper = () => ({ split: "y", parts: [["*", { split: "x", parts: leaves([["*", { role: "living", name: "Flat: living room", flat: true }], ["*", { role: "kitchen", name: "Flat: kitchen", flat: true }]]) }], [1, { role: "hall", name: "Landing", flat: true }], ["*", { split: "x", parts: leaves(tier === "corner" ? [["*", F("bedroom")], [2, F("bath")]] : [["*", F("bedroom")], [2, F("bath")], ["*", F("bedroom")]]) }]] }); // a corner store's narrow flat: one bedroom (issue #22)
  const spec = {
    bw, bh, program, exits, front: { width: tier === "corner" ? 1 : 2 }, openDoors: 0.3, ground: v === "feedstore" ? "rural" : truck || gas ? "lot" : "town", pumps: gas || truck ? (truck ? 3 : 2) : 0,
    storeys: flat ? 2 : 1, upper: flat ? upper : null, foot: gas || tier === "corner" ? "small" : tier === "grocery" ? "large" : "medium",
    stairs: { roles: BACK_STAIRS }, // the flat's stair from the back room
  };
  return shaped ? shopShape(rng, spec, back, bay) : spec;
}
// A shop's shape (a new save's, issue #23): a gas station's or a truck stop's service bay an annex beside it, flush
// with the front, as deep or a little shallower (one storey); else, most of the time, a stepped back: a back store of
// one storey stuck on behind one side (its door from the back rooms; a store of the shop's own stock, a container or
// two), so the rear wall of a row of shops runs at different depths. The plan's rooms are as before.
function shopShape(rng, spec, back, bay) {
  const { bw, bh } = spec;
  if (bay) {
    const hg = bh - rng.int(0, 2);
    return { ...spec, ...shapeOf("annex", [
      { x: bay.right ? 0 : bay.w - 1, y: 0, w: bw - bay.w + 1, h: bh, name: "Shop", main: true, program: spec.program, upper: spec.upper }, // the box as wide as it was with the bay inside it
      { x: bay.right ? bw - bay.w : 0, y: bh - hg, w: bay.w, h: hg, storeys: 1, name: "Service bay", program: bay.leaf },
    ]), program: null, upper: null };
  }
  if (hash01(rng.state, "shape", "shop") >= 0.65) return spec; // read, not consumed: a shop that stays a box rolls on as it did
  const leaf = (r) => (typeof r === "string" ? { role: r } : r);
  const right = rng.chance(0.5), list = back.map(([, r]) => leaf(r)); // the back row, left to right
  const by = right ? list[list.length - 1] : list[0]; // the back room the store stands behind
  const stock = list.find((l) => ["stock", "storage", "pantry", "warefloor", "parts"].includes(l.role));
  const type = (stock && (stock.type || (ROLES[stock.role] && ROLES[stock.role].type))) || "store";
  const aw = rng.int(5, Math.min(8, bw - 4)), ah = rng.int(4, 6);
  return { ...spec, ...shapeOf("stepped", [
    { x: 0, y: ah - 1, w: bw, h: bh, name: "Shop", main: true, program: spec.program, upper: spec.upper },
    { x: right ? bw - aw : 0, y: 0, w: aw, h: ah, storeys: 1, name: "Back store", program: { role: "storage", name: "Back store", type, maxBoxes: 1, windows: false, nextTo: [by.role, "stock", "kitchen", "office"] } },
  ]), program: null, upper: null };
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

// Big stores: a wide sales floor of aisles, the deli or a sports section, a back room with racks and a loading dock.
function bigstore(rng, v, o = {}) {
  if (v === "supermarket" && !o.legacy) { const sp = shopVariantSpec("supermarket", rng, o); return o.shapes ? superShape(rng, sp) : sp; } // issue #22: really big; issue #35: its 12 plans (shopvariants.js), #23's shape on a new save (an older save's and every department store's as below)
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

// The supermarket (issue #22, the user's request 2026-10-25: "make super markets really big, the ones in those 3 images
// would be a small one or corner store"; a new save's plan, an older save keeps bigstore's 26–30 × 18–21): 54–58 × 36–40
// cells, twice the old store each way.
//   The front: the sales floor across the middle (shoplayout.js superstore: the entrance with its cart corrals and the
//     customer service desk, a row of checkout lanes and a self-checkout block, the wide front aisle, 10–16 long aisles,
//     produce down one side, the frozen aisles, the dairy wall along the back), two front entrances (in and out) and a
//     fire exit; a column of rooms down each side: the café, the restrooms and the bakery on one, the pharmacy and the
//     deli and butcher on the other (the dice pick which side).
//   The back of house (11–13 deep): the warehouse (receiving along the dock, pallet racks in rows: shoplayout.js
//     warehouse) with 2–3 roller doors onto the loading dock (a box truck parked at a bay: assemble's dockTruck), the
//     walk-in cooler and the walk-in freezer behind steel doors, the compactor and baler, the cash office and the
//     manager's office (their safes), the break room and the staff restroom, a staff door.
//   Upstairs (40%): the mezzanine over it all, an overstock floor with the offices along its back.
function supermarket(rng, o = {}) {
  const bw = rng.int(54, 58), bh = rng.int(36, 40), backD = rng.int(11, 13), flip = rng.chance(0.5);
  const cafeSide = { split: "y", parts: leaves([[7, { role: "dining", name: "Café", type: "store", lay: "cafe", hub: false, maxBoxes: 3 }], [5, { split: "x", parts: leaves([["*", { role: "restroom", name: "Men's restroom" }], ["*", { role: "restroom", name: "Women's restroom" }]]) }], ["*", { role: "kitchen", name: "Bakery", type: "kitchen", lay: "bakery", maxBoxes: 4 }]]) };
  const pharmSide = { split: "y", parts: leaves([[8, { role: "dispensary", name: "Pharmacy", type: "pharmacy", lay: "dispensary", lock: ["door", 0.3], boxLock: ["drugs", 0.4], maxBoxes: 3 }], ["*", { role: "kitchen", name: "Deli and butcher", type: "kitchen", lay: "butcher", maxBoxes: 4 }]]) };
  const floor = { role: "sales", entry: true, name: "Sales floor", type: "store", lay: "superstore", maxBoxes: 60 };
  const main = { split: "x", parts: flip ? [[8, pharmSide], ["*", floor], [8, cafeSide]] : [[8, cafeSide], ["*", floor], [8, pharmSide]] };
  const cold = { name: "Walk-in cooler", type: "kitchen", cold: true, dk: "steel", windows: false, fl: "steel", maxBoxes: 4 };
  const backRooms = [
    ["*", { role: "warefloor", name: "Warehouse", type: "store", lay: "warehouse", hub: true, maxBoxes: 26 }],
    [7, { split: "y", parts: leaves([["*", { role: "pantry", ...cold, lay: "walkin" }], ["*", { role: "pantry", ...cold, name: "Walk-in freezer", lay: "walkfreezer", fl: "steel" }]]) }],
    [6, { role: "storage", name: "Compactor and baler", type: "warehouse", lay: "baler", maxBoxes: 1 }],
    [8, { split: "y", parts: leaves([["*", { role: "office", name: "Cash office", lock: ["door", 0.6], boxLock: ["safe", 0.8], maxBoxes: 2 }], ["*", { role: "office", name: "Manager's office", boxLock: ["safe", 0.4] }]]) }],
    [8, { split: "y", parts: leaves([["*", "breakroom"], [3, { role: "restroom", name: "Staff restroom" }]]) }],
  ];
  const back = { split: "x", parts: leaves(flip ? backRooms.slice().reverse() : backRooms) };
  const two = rng.chance(0.4);
  const mezz = () => ({ split: "y", parts: [["*", { role: "warefloor", name: "Mezzanine stockroom", maxBoxes: 12 }], [7, { split: "x", parts: leaves([["*", { role: "office", name: "Offices" }], ["*", { role: "breakroom", name: "Training room" }], [8, { role: "storage", name: "Records", type: "office" }], [4, "restroom"]]) }]] });
  const upper = mezz;
  const spec = {
    bw, bh, front: { width: 2 }, openDoors: 0.3, ground: "lot", storeys: two ? 2 : 1, upper: two ? upper : null, foot: "huge", stairs: { roles: BACK_STAIRS }, // up to the mezzanine from the back of house
    margins: { back: 8 }, dockTruck: true, // the lot behind: room for the box truck at a dock door (assemble)
    program: { split: "y", parts: [["*", main], [backD, back]] },
    exits: [
      { side: "front", roles: ["sales"], chance: 1, width: 2, lock: 0.2, name: "Exit doors" },
      { side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 3, lock: 0.2, name: "Loading dock" },
      { side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 3, lock: 0.3, name: "Loading dock" },
      { side: "back", roles: ["warefloor"], chance: 0.6, roller: true, width: 3, lock: 0.3, name: "Loading dock" },
      { side: "back", roles: ["breakroom", "storage", "office"], chance: 0.7, lock: 0.4, name: "Staff door" },
      { side: sideRoom(rng), roles: ["sales", "dining", "kitchen"], chance: 0.8, lock: 0.4, name: "Fire exit" },
    ],
  };
  if (!o.shapes) return spec;
  // A new save's (issue #23): the receiving dock an annex out the back behind the warehouse (one tall storey, its roller
  // doors the docks' too), and the entrance's corner notched: the café, the restrooms and the bakery's side 3 cells
  // short of the front, the sales floor's front stepping out past it. The rooms are the plan's.
  const ny = 3, sw = 9, fh = bh - backD - 1, cafeLeft = !flip; // the café's column (8 and its wall) on the left unless flipped
  const front = { split: "x", parts: flip ? [[8, pharmSide], ["*", floor]] : [["*", floor], [8, pharmSide]] };
  const aw = rng.int(14, 18), ah = rng.int(6, 8), dockX = flip ? bw - aw - rng.int(2, 4) : rng.int(2, 4); // the warehouse's end
  return { ...spec, ...shapeOf("notch", [
    { x: 0, y: ah - 1, w: bw, h: backD + 2, name: "Back of house", program: back, upper: two ? () => mezz().parts[1][1] : null, storeys: two ? 2 : 1 },
    { x: cafeLeft ? sw : 0, y: ah - 1 + backD + 1, w: bw - sw, h: fh, name: "Store", main: true, program: front, upper: two ? () => mezz().parts[0][1] : null, storeys: two ? 2 : 1 },
    { x: cafeLeft ? 0 : bw - sw - 1, y: ah - 1 + backD + 1, w: sw + 1, h: fh - ny, storeys: 1, name: "Café side", program: cafeSide },
    { x: dockX, y: 0, w: aw, h: ah, storeys: 1, tall: true, name: "Receiving dock", program: { role: "warefloor", name: "Receiving dock", type: "store", lay: "warehouse", hub: true, maxBoxes: 6, nextTo: ["warefloor"] } },
  ]), program: null, upper: null };
}

// A supermarket variant's shape (issue #35's plans, shopvariants.js superSpec; a new save's, #23's as supermarket's
// above): the receiving dock an annex out the back behind the warehouse, the café's side notched back from the front.
function superShape(rng, sp) {
  const { bw, bh } = sp, { cafeSide, pharmSide, floor, back, flip, backD, two, mezz } = sp.parts;
  const ny = 3, sw = 9, fh = bh - backD - 1, cafeLeft = !flip;
  const front = { split: "x", parts: flip ? [[8, pharmSide], ["*", floor]] : [["*", floor], [8, pharmSide]] };
  const aw = rng.int(14, 18), ah = rng.int(6, 8), dockX = flip ? bw - aw - rng.int(2, 4) : rng.int(2, 4);
  return { ...sp, parts: undefined, ...shapeOf("notch", [
    { x: 0, y: ah - 1, w: bw, h: backD + 2, name: "Back of house", program: back, upper: two ? () => mezz().parts[1][1] : null, storeys: two ? 2 : 1 },
    { x: cafeLeft ? sw : 0, y: ah - 1 + backD + 1, w: bw - sw, h: fh, name: "Store", main: true, program: front, upper: two ? () => mezz().parts[0][1] : null, storeys: two ? 2 : 1 },
    { x: cafeLeft ? 0 : bw - sw - 1, y: ah - 1 + backD + 1, w: sw + 1, h: fh - ny, storeys: 1, name: "Café side", program: cafeSide },
    { x: dockX, y: 0, w: aw, h: ah, storeys: 1, tall: true, name: "Receiving dock", program: { role: "warefloor", name: "Receiving dock", type: "store", lay: "warehouse", hub: true, maxBoxes: 6, nextTo: ["warefloor"] } },
  ]), program: null, upper: null };
}

// Corridor buildings: a band of rooms at the front (with the lobby), a corridor along the building, a band behind it.
// Where a stair run goes (spec.stairs, assemble pickRuns): a shop's from its back rooms; a hospital's and a school's
// one at each end of the main corridor, 3 steps long.
const BACK_STAIRS = ["stock", "warefloor", "office", "storage", "breakroom", "kitchen", "pantry", "parts"];
const ENDS = { roles: ["corridor"], n: 2, len: 3, ends: true };
function corridorPlan(front, back, fd, cw = 1, hall = null) { // hall: the corridor's own marks (a school's lined with lockers)
  return { split: "y", parts: [[fd, { split: "x", parts: leaves(front) }], [cw, { role: "corridor", ...(hall || {}) }], ["*", { split: "x", parts: leaves(back) }]] };
}
function institution(rng, v, o = {}) {
  const L = (o) => ({ role: "lobby", entry: true, ...o });
  const fire = (lock = 0.4) => [{ side: "left", roles: ["corridor"], chance: 0.6, lock }, { side: "right", roles: ["corridor"], chance: 0.6, lock }];
  const S = (bw, bh) => ({ bw, bh });
  switch (v) {
    case "clinic": case "infirmary": {
      if (!o.legacy && !o._classic) return variantSpec(v, rng, o, { classic: () => institution(rng, v, { ...o, _classic: true }) }); // one of a dozen plans (civicvariants.js, issue #36); #14's below is one of them
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
      if (!o.legacy && !o._classic) return variantSpec("hospital", rng, o, { classic: () => institution(rng, v, { ...o, _classic: true }) }); // civicvariants.js (issue #36)
      const bw = rng.int(26, 30), bh = rng.int(17, 19);
      const n = rng.int(3, 5); // reception and the pharmacy low, wards above
      if (!o.legacy && o.shapes) return hospitalShaped(rng, bw, bh, n, fire); // a tower, an ER annex and a lower wing (issue #23)
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
      if (!o.legacy) return variantSpec("police", rng, o, { classic: () => (o.shapes ? policeShaped(rng) : policeStation(rng)) }); // laid out for its kind (civiclayout.js), one of a dozen plans (civicvariants.js, issue #36); its classic plan an L with the sally port in a new save (issue #23); an older save as below
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
      if (!o.legacy && o.shapes) return schoolShaped(rng); // much larger and shaped (issue #23)
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
      // A firm's tower (data-offices.js OFFICE_FIRMS.office, a new save's): the corporate tower, floor by floor
      // (officeplans.js tower). With no firm (a tower saved before them, a city's or a factory's offices) as below.
      // Since the variants (#27, a dozen plans a type): a tower with no firm in a new save too, 3–6 storeys (a city's,
      // a factory's, a campus's offices); an older save's (o.officesLegacy: worldcfg.js legacyOffices) as below.
      const firm = o.legacy ? null : planOf("office", o);
      if (firm && firm.look) return OFFICE_PLANS.tower(rng, o, firm, MAX_STOREYS);
      if (firm && !o.officesLegacy) { // a firm-less tower: one of the named plans, as tall as the setting's offices stand (realScale restorey: a city's 6–10)
        const spec = OFFICE_PLANS.tower(rng, o, { storeys: [3, 6] }, MAX_STOREYS);
        return { ...spec, restorey: (h) => OFFICE_PLANS.tower(rng, { ...o, storeyBonus: 0, plan: spec.variant }, { storeys: [h, h] }, MAX_STOREYS) };
      }
      // A tower: the taller, the smaller its footprint (3 storeys on about 20 × 14, 8 on about 13 × 11). The city crawl
      // adds storeys deeper in (o.storeyBonus).
      const n = clampN(rng.int(3, 8) + (o.storeyBonus || 0), 3, OLD_MAX);
      const t = (n - 3) / (OLD_MAX - 3);
      const bw = Math.round(20 - 7 * t) + rng.int(-1, 1), bh = Math.round(14 - 3 * t) + rng.int(0, 1);
      const small = bw < 16;
      const records = { role: "storage", name: "Records room", type: "office", lock: ["door", 0.4], boxLock: ["safe", 0.3] };
      const fd = Math.max(5, Math.floor((bh - 3) / 2)); // deep enough for the stairwell's run of 3 and its landings
      // The stairwell: a room of its own beside the lobby, at the same place on every floor (the front band's fixed
      // widths are the same on every floor, so its flexible rooms are too).
      const SW = [2, { role: "stairwell" }], lw = rng.int(5, 6);
      const tower = {
        bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "tower", stairs: { roles: ["stairwell"], n: 1, len: 3 },
        program: small
          ? corridorPlan([["*", L({ name: "Lobby" })], SW, ["*", { role: "sales", name: "Shop", type: "store", hub: false, maxBoxes: 3 }]], [["*", "office"], [4, records]], fd)
          : corridorPlan([["*", { role: "sales", name: "Shop", type: "store", hub: false, maxBoxes: 3 }], SW, [lw, L({ name: "Lobby" })], ["*", { role: "sales", name: "Cafe", type: "kitchen", hub: false, maxBoxes: 2 }]], [["*", "office"], [4, "breakroom"], [4, records], ["*", "office"]], fd),
        upper: (f, r, ctx) => (ctx.top
          ? corridorPlan(small ? [["*", { role: "workshop", name: "Plant room", type: "workshop" }], SW, ["*", "office"]] : [["*", { role: "workshop", name: "Plant room", type: "workshop" }], SW, [lw, "office"], ["*", "office"]], small ? [["*", "office"], [2, "restroom"]] : [["*", "office"], [4, "breakroom"], ["*", "office"]], fd)
          : corridorPlan(small ? [["*", "office"], SW, ["*", "office"]] : [["*", "office"], SW, [lw, "office"], ["*", "office"]], small ? [["*", "office"], [3, { role: "storage", type: "office" }]] : [["*", "office"], [4, "breakroom"], [4, { role: "storage", name: "Records", type: "office" }], ["*", "office"]], fd)),
        exits: [{ side: "back", roles: ["breakroom", "storage", "office"], chance: 0.7, lock: 0.3 }, ...fire(0.4)],
      };
      // A new save's (issue #23), half of them: a lower wing of offices on one side, its back stepped (an L).
      if (o.legacy || !o.shapes || hash01(rng.state, "shape", "offices") >= 0.5) return tower; // read, not consumed: a tower that stays a box rolls on as it did
      const wh = wingDepth(rng, fd, bh), wn = rng.int(1, Math.min(3, n - 1));
      const wingPlan = (g) => corridorPlan([["*", { role: "office", name: g ? "Office" : "Meeting room" }]], [["*", "office"], [2, "restroom"]], fd);
      return withSideWing(rng, tower, { w: rng.int(9, 12), h: wh, storeys: wn, name: "Low wing", mainName: "Tower", program: wingPlan(0), upper: (g) => wingPlan(g) });
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
      if (!o.legacy) return milPlan(rng, v, o); // laid out like the real thing (issue #25: militarylayout.js); an older save as below
      const bw = rng.int(18, 22), bh = rng.int(11, 13);
      return {
        ...S(bw, bh), front: { width: 1 }, ground: "base", storeys: 2, foot: "medium",
        program: corridorPlan([["*", "dorm"], [rng.int(4, 5), { role: "foyer", name: "Duty desk", entry: true, type: "barracks" }], [4, "office"]], [["*", "dorm"], [4, { role: "lockerroom", type: "barracks" }], [2, "restroom"], [4, { role: "storage", type: "barracks", lock: ["door", 0.3] }]], 4),
        upper: () => corridorPlan([["*", "dorm"], [4, "office"], ["*", "dorm"]], [["*", "dorm"], [4, { role: "lockerroom", type: "barracks" }], [2, "restroom"]], 4),
        exits: [{ side: "back", roles: ["lockerroom", "dorm", "storage"], chance: 0.7, lock: 0.2 }, ...fire(0.3).map((e) => ({ ...e, chance: 0.5 }))],
      };
    }
    case "armorybldg": {
      if (!o.legacy) return milPlan(rng, v, o); // laid out like the real thing (issue #25: militarylayout.js); an older save as below
      const bw = rng.int(12, 14), bh = rng.int(10, 11);
      return {
        ...S(bw, bh), front: { width: 1 }, ground: "base", storeys: 1, foot: "small",
        program: { split: "y", parts: [[3, { role: "foyer", name: "Issue desk", entry: true, type: "barracks" }], ["*", { split: "x", parts: leaves([["*", { role: "armory", lock: ["vault", 0.9], boxLock: ["cage", 0.6], gunSafe: ["gunsafe3", 0.35] }], ["*", { role: "armory", name: "Ammo store", lock: ["door", 0.5], boxLock: ["crate", 0.4] }], [3, "office"]]) }]] },
        exits: [{ side: "back", roles: ["office"], chance: 0.3, lock: 0.7 }],
      };
    }
    case "cellblock": {
      if (!o.legacy) return milPlan(rng, v, o); // laid out like the real thing (issue #25: militarylayout.js); an older save as below
      const bw = rng.int(20, 24), bh = rng.int(13, 15);
      return {
        ...S(bw, bh), front: { width: 1 }, ground: "base", storeys: 1, foot: "medium",
        program: corridorPlan([["*", { role: "office", name: "Guard room", entry: true, hub: true }], [5, { role: "lockerroom", type: "cellblock" }], [4, { role: "armory", name: "Guard armory", lock: ["vault", 0.7], boxLock: ["cage", 0.4], gunSafe: ["gunsafe3", 0.25] }]], [["*", "cells"], ["*", "cells"]], 4),
        exits: [{ side: "left", roles: ["corridor"], chance: 0.6, lock: 0.6 }, { side: "right", roles: ["corridor"], chance: 0.6, lock: 0.6 }],
      };
    }
    case "messhall": {
      if (!o.legacy) return milPlan(rng, v, o); // laid out like the real thing (issue #25: militarylayout.js); an older save as below
      const bw = rng.int(16, 20), bh = rng.int(11, 13);
      return {
        ...S(bw, bh), front: { width: 2 }, ground: "lot", storeys: 2, foot: "medium",
        program: { split: "y", parts: [["*", { role: "mess", entry: true }], [4, { split: "x", parts: leaves([["*", "kitchen"], [4, { role: "pantry", type: "kitchen", lock: ["door", 0.3] }], [4, "storage"]]) }]] },
        upper: () => ({ split: "y", parts: [["*", { role: "dayroom", name: "Rec room" }], [4, { split: "x", parts: leaves([["*", { role: "storage", type: "barracks" }], ["*", "office"], [2, "restroom"]]) }]] }),
        exits: [{ side: "back", roles: ["kitchen", "storage"], chance: 0.9, lock: 0.3 }, { side: sideRoom(rng), roles: ["mess"], chance: 0.4, lock: 0.4 }],
      };
    }
    case "control": {
      if (!o.legacy) return milPlan(rng, v, o, () => institution(rng, v, { ...o, legacy: true })); // a dozen plans (milplans.js), today's among them; an older save as below
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
      if (!o.legacy) return milPlan(rng, v, o, () => institution(rng, v, { ...o, legacy: true })); // a dozen plans (milplans.js), today's among them; an older save as below
      const bw = rng.int(10, 12), bh = rng.int(8, 9);
      return {
        ...S(bw, bh), front: { width: 1 }, ground: "rural", storeys: 1, foot: "small",
        program: { split: "y", parts: [["*", { role: "control", name: "Transmitter room", entry: true, hub: true }], [3, { split: "x", parts: leaves([["*", { role: "workshop", name: "Generator room" }], [4, { role: "storage", type: "control", lock: ["door", 0.3] }]]) }]] },
        exits: [{ side: "back", roles: ["workshop"], chance: 0.4, lock: 0.3 }],
      };
    }
    case "terminal": {
      if (!o.legacy) return milPlan(rng, v, o); // laid out like the real thing (issue #25: militarylayout.js); an older save as below
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
      if (!o.legacy) return variantSpec("firestation", rng, o, { classic: () => (o.shapes ? fireShaped(rng) : fireStation(rng)) }); // one of a dozen plans (civicvariants.js, issue #36); the classic one's engine bay an offset annex in a new save (issue #23)
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

// Open floors: a warehouse, a factory, a hangar, a motor pool, an auto shop, a workshop, a barn, a machine shed.
function openfloor(rng, v, o = {}) { // o.legacy: an older save (its hangar, motor pool and a base's warehouse as they were)
  if (!o.legacy && hasVariants(v)) return shopVariantSpec(v, rng, o, withPlan, planOf(v, o)); // issue #35: the auto shop's, the garage's and the workshop's 12 plans (shopvariants.js)
  switch (v) {
    case "warehouse": {
      if (!o.legacy && o.site === "military") return milPlan(rng, "supply", o); // a base's supply warehouse (issue #25)
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
      if (!o.legacy) return milPlan(rng, v, o); // issue #25: an air base's or an airport's, at its real size
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
      if (!o.legacy) return milPlan(rng, v, o);
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

function church(rng, o = {}) {
  if (!o.legacy) return variantSpec("church", rng, o, { classic: () => (o.shapes ? churchShaped(rng) : churchPlan(rng)) }); // one of a dozen plans (civicvariants.js, issue #36); the classic one a nave with a side chapel or a transept and a bell tower in a new save (issue #23)
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
// ---------- footprint shapes (issue #23: "Schools should be larger and make buildings not just squares and asymetrical
// like many buildings are irl.", the user's request 2026-10-25) ----------
// A shape is a union of rectangles (assemble: spec.shape = { kind, parts }): a main block with wings and annexes, and
// notches cut out of corners. Each part is { x, y, w, h } in the bounding box (x from its left, y from its back: the
// front is the box's last row), walls included, where two parts meet they share one wall line (the doors through it
// come from assemble's union of the rooms, so every part is reached), and has its own plan (program; upper(g, rng,
// ctx) for its floors up), storeys (fewer than the building's: a lower roof, open air above) and name. Asymmetry is
// the rule: wings of different lengths and depths, an entrance off the middle, an annex on one side only. The kinds
// (shape.kind): L (a main block and a wing), T and U (two or three wings: round a courtyard or a yard), annex (a garage,
// a gym, an engine bay stuck on one side), notch (a porch, a recessed entrance: a corner cut out), stepped (a back of
// different depths), cross (a nave and its transept). Only a new save's buildings have them (o.shapes: worldcfg.js
// legacyShapes; an older save's keep the rectangle its dice always gave).
/** The spec of a shape: its bounding box from its parts (moved so the box starts at 0, 0). @param {string} kind @param {any[]} parts */
function shapeOf(kind, parts) {
  const x0 = Math.min(...parts.map((p) => p.x)), y0 = Math.min(...parts.map((p) => p.y));
  for (const p of parts) { p.x -= x0; p.y -= y0; }
  return { bw: Math.max(...parts.map((p) => p.x + p.w)), bh: Math.max(...parts.map((p) => p.y + p.h)), shape: { kind, parts } };
}
// Two parts in a row (a notched corner, an L, a stepped back): the box W × H with a corner of nx × ny cut out at the
// front or the back (end "front" | "back"), on the left or the right. a: the full-depth part's plan, b: the other's.
// Returns [full, short] parts (their rects; the caller adds program and the rest).
function notchParts(W, H, nx, ny, end, left) {
  const fullW = W - nx, short = { y: end === "front" ? 0 : ny, w: nx + 1, h: H - ny };
  return left ? [{ x: nx, y: 0, w: fullW, h: H }, { x: 0, ...short }] : [{ x: 0, y: 0, w: fullW, h: H }, { x: fullW - 1, ...short }];
}

// A rectangle's spec with a wing on one side (left or right by the dice), flush with its front, its back short of the
// main block's or past it (a stepped back: an L) and fewer storeys (a lower roof); a corridor plan with the main
// block's front band depth keeps the two corridors in line through the shared wall.
function withSideWing(rng, spec, wing) {
  const left = rng.chance(0.5), { bw, bh } = spec, dy = Math.max(0, wing.h - bh);
  return { ...spec, ...shapeOf("L", [
    { x: left ? wing.w - 1 : 0, y: dy, w: bw, h: bh, name: wing.mainName || "Main block", main: true, program: spec.program, upper: spec.upper },
    { x: left ? 0 : bw - 1, y: dy + bh - wing.h, w: wing.w, h: wing.h, storeys: wing.storeys, name: wing.name, wing: true, program: wing.program, upper: wing.upper },
  ]), program: null, upper: null };
}
// A wing's depth for withSideWing: a corridor plan's least (its front band fd, the corridor, two cells behind) up to
// a few past the main block's, never the main block's own.
const wingDepth = (rng, fd, bh) => { const lo = fd + 7, d = rng.int(lo, bh + 4); return d === bh ? (d + 1 <= bh + 4 ? d + 1 : d - 1 >= lo ? d - 1 : d) : d; };

// A school (a new save's since issue #23): much larger than #15's one block and shaped, 2–3 times its floor area. A
// main block along the front (the lobby off the middle, the principal's office, the front office, the nurse, the
// library and classrooms, a corridor of lockers behind them, one storey more than its wings at times), two wings back
// from it round a yard (U: one at each end; F: the second off the middle; E: a spine off the middle and a wing at an
// end), a classroom wing (a corridor of lockers between two rows of classrooms, on one or two storeys: 6–12 of them)
// and a science and art wing (labs, the art room, the shop class, the music room), the gym an annex at the far end of
// a wing (one tall storey: bleachers, two locker rooms), the cafeteria and its kitchen (a walk-in behind its cold room
// door) at the end of the other. #15's room styles (civiclayout.js CIVIC_STYLES) furnish every room.
function schoolShaped(rng) {
  const n = rng.int(2, 3);
  const C = (o = {}) => ({ role: "classroom", civic: "classroom", ...o });
  const hall = { type: "schoolhall", civic: "schoolhall", boxTarget: 10 };
  const corridor = (o = {}) => ({ role: "corridor", ...hall, ...o });
  const fd = rng.int(7, 8), mainH = fd + 5; // the main block: its front band of rooms, a 2-wide corridor behind
  const W = rng.int(52, 64);
  // The main block's front band: the lobby off the middle (its door the front entrance), the offices round it, the
  // library and classrooms out to the ends; upstairs classrooms, the staff room and a shop class or an art room.
  const lw = rng.int(6, 7), atLeft = rng.chance(0.5);
  const office = [[4, { role: "office", name: "Principal's office", lock: ["door", 0.3], boxLock: ["safe", 0.2], civic: "principal" }], [5, { role: "office", name: "Front office", civic: "staffroom", type: "office" }], [lw, { role: "lobby", entry: true, name: "Lobby", type: "office", civic: "slobby" }], [4, { role: "nurse", civic: "nurse" }]];
  const lib = [rng.int(8, 10), { role: "storage", name: "Library", type: "office", maxBoxes: 5, civic: "library" }];
  const band = atLeft ? [["*", C()], ...office, lib, ["*", C()], ["*", C()]] : [["*", C()], ["*", C()], lib, ...office, ["*", C()]];
  const mainProgram = { split: "y", parts: [[fd, { split: "x", parts: leaves(band) }], [2, corridor()]] };
  const mainUpper = (g, r) => ({ split: "y", parts: [[fd, { split: "x", parts: leaves([["*", C()], ["*", C()], [5, { role: "breakroom", name: "Staff room", type: "office", civic: "staffroom" }], ["*", C()], [6, { role: "workshop", name: r.chance(0.5) ? "Shop class" : "Art room", type: "office", maxBoxes: 2, civic: "shopclass" }], ["*", C()]]) }], [2, corridor()]] });
  // A wing back from the main block: a corridor down its middle (joining the main corridor through the shared wall),
  // a row of rooms each side, rooms(g) the rows' leaves on floor g.
  const wingPlan = (rows) => ({ split: "x", parts: [["*", { split: "y", parts: leaves(rows[0]) }], [2, corridor({ name: "Wing corridor" })], ["*", { split: "y", parts: leaves(rows[1]) }]] });
  const k = (len) => clampN(Math.floor((len - 1) / 7), 2, 4); // classrooms a row
  const rowOf = (len, leaf) => Array.from({ length: k(len) }, () => ["*", leaf()]);
  const gw = rng.int(20, 25), gh = rng.int(12, 14);
  const classLen = rng.int(19, Math.min(25, 48 - mainH - gh)), sciLen = rng.int(14, 19); // the box at most 46 deep: the main block, the wing and the gym
  const classN = Math.min(n, rng.chance(0.65) ? 2 : 1), sciN = Math.min(n, rng.chance(0.4) ? 2 : 1);
  const classWing = {
    w: 20, len: classLen, storeys: classN, name: "Classroom wing", wing: true,
    program: wingPlan([rowOf(classLen, C), rowOf(classLen, C)]),
    upper: () => wingPlan([rowOf(classLen, C), rowOf(classLen, C)]),
  };
  const sci = (o) => () => C(o);
  const sciRows = (g) => (g ? [rowOf(sciLen, C), rowOf(sciLen, sci({ name: "Music room" }))] : [rowOf(sciLen, sci({ name: "Science lab", type: "lab", civic: "sciencelab" })), [["*", { role: "workshop", name: "Art room", type: "office", maxBoxes: 2, civic: "shopclass" }], ...rowOf(sciLen, sci({ name: "Science lab", type: "lab", civic: "sciencelab" })).slice(1)]]);
  const sciWing = { w: 18, len: sciLen, storeys: sciN, name: "Science and art wing", wing: true, program: wingPlan(sciRows(0)), upper: (g) => wingPlan(sciRows(g)) };
  // The annexes at a wing's far end: the gym (one tall storey) and the cafeteria with its kitchen.
  const lockersLeft = rng.chance(0.5);
  const lockers = [5, { split: "y", parts: leaves([["*", { role: "lockerroom", name: "Boys' locker room", civic: "plockers" }], ["*", { role: "lockerroom", name: "Girls' locker room", civic: "plockers" }]]) }];
  const gym = { w: gw, h: gh, storeys: 1, tall: true, name: "Gym", gym: true, program: { split: "x", parts: lockersLeft ? [lockers, ["*", { role: "gym", civic: "gym" }]] : [["*", { role: "gym", civic: "gym" }], lockers] } };
  const cw = rng.int(16, 19), ch = rng.int(10, 12);
  const kitchen = [5, { split: "y", parts: leaves([["*", { role: "kitchen", name: "School kitchen", maxBoxes: 1, civic: "skitchen" }], [2, { role: "pantry", name: "Walk-in", type: "kitchen", dk: "coldroom", civic: "walkin" }]]) }];
  const caf = { w: cw, h: ch, storeys: 1, name: "Cafeteria", wing: true, program: { split: "x", parts: rng.chance(0.5) ? [kitchen, ["*", { role: "cafeteria", civic: "cafeteria" }]] : [["*", { role: "cafeteria", civic: "cafeteria" }], kitchen] } };
  // Where the wings stand on the main block's back wall (x of each wing's left wall), and which annex each carries.
  const roomE = W >= cw + 20 + 18 + 7; // a spine and two end wings need the width
  const kind = rng.weighted(roomE ? ["U", "F", "E"] : ["U", "F"], (q) => (q === "U" ? 2 : 1));
  const flip = rng.chance(0.5); // the classroom wing on the left or the right
  let wings;
  if (kind === "U") wings = [{ ...classWing, x: 0, annex: gym }, { ...sciWing, x: W - sciWing.w, annex: caf }];
  else if (kind === "F") wings = [{ ...classWing, x: 0, annex: gym }, { ...sciWing, x: rng.int(classWing.w + 8, W - sciWing.w - 6), annex: caf }];
  else { // E: the classroom wing a spine off the middle with the gym at its end, the cafeteria a wing at one end, the science wing at the other
    const sx = rng.int(cw + 3, W - 18 - 20 - 3);
    wings = [{ ...caf, len: ch, x: 0, annex: null, own: true }, { ...classWing, x: sx, annex: gym }, { ...sciWing, x: W - sciWing.w, annex: null }];
  }
  if (flip) for (const w of wings) { w.x = W - w.x - w.w; } // mirrored: asymmetric the other way round
  const parts = [{ x: 0, y: 0, w: W, h: mainH, storeys: n, name: "Main block", main: true, program: mainProgram, upper: mainUpper }];
  for (const w of wings) {
    const wy1 = 0, wy0 = wy1 - w.len + 1; // a wing shares the main block's back wall
    parts.push({ x: w.x, y: wy0, w: w.w, h: w.len, storeys: w.storeys, name: w.name, wing: true, program: w.program, upper: w.upper, ...(w.tall ? { tall: true } : {}) });
    if (w.annex) { // the annex at its far end, flush with the wing's outer side, wider or narrower than it
      const a = w.annex, out = w.x + w.w / 2 < W / 2; // the wing's outer side: toward the box's nearer edge
      const ax = out ? w.x : w.x + w.w - a.w;
      parts.push({ x: ax, y: wy0 - a.h + 1, w: a.w, h: a.h, storeys: a.storeys, name: a.name, program: a.program, ...(a.tall ? { tall: true } : {}), ...(a.gym ? { gym: true } : {}), ...(a.wing ? { wing: true } : {}) });
    }
  }
  return {
    ...shapeOf(kind, parts), front: { width: 2 }, ground: "town", storeys: n, foot: "large", upper: null, stairs: ENDS, // at the ends of a corridor that rises every storey (the main block's)
    exits: [{ side: "back", roles: ["gym", "cafeteria"], chance: 0.9, lock: 0.3 }, { side: "back", roles: ["corridor"], chance: 0.5, lock: 0.4, name: "Wing door" }, { side: "left", roles: ["corridor"], chance: 0.9, lock: 0.3 }, { side: "right", roles: ["corridor"], chance: 0.9, lock: 0.3 }, { side: sideRoom(rng), roles: ["gym"], chance: 0.6, lock: 0.3 }],
  };
}
// A police station (a new save's, issue #23): the station block as #15 laid it out (the front desk, the squad room, the
// lockers and the chief's office along the front, the corridor, the armory, the evidence room and the cell block
// behind) and the sally port an annex beside it at the back, one storey, the cell block's end against it: an L.
function policeShaped(rng) {
  const bw = rng.int(21, 24), bh = rng.int(15, 17);
  const lobby = (o) => ({ role: "lobby", entry: true, ...o });
  const right = rng.chance(0.5);
  const cellsRow = [[4, { role: "armory", lock: ["vault", 0.85], boxLock: ["cage", 0.5], gunSafe: ["gunsafe3", 0.3], civic: "armory", dk: "steel", boxTarget: 3 }], [3, { role: "evidence", lock: ["door", 0.7], boxLock: ["evidence", 0.6], civic: "evidence", dk: "cell" }], ["*", { role: "cells", civic: "cells" }]];
  const main = corridorPlan([["*", { role: "office", name: "Detectives' office", boxLock: ["evidence", 0.25], civic: "squad" }], [rng.int(5, 6), lobby({ name: "Front desk", type: "office", civic: "frontdesk" })], [4, { role: "lockerroom", type: "barracks", civic: "plockers" }], ["*", { role: "office", name: "Chief's office", gunSafe: ["gunsafe2", 0.3], civic: "chief" }]],
    right ? cellsRow : cellsRow.slice().reverse(), 5); // the cells at the sally port's end
  const n = rng.int(2, 3);
  const interview = [6, { split: "x", parts: leaves([["*", { role: "office", name: "Interview room", civic: "interview" }], [2, { role: "office", name: "Observation", civic: "observation" }]]) }];
  const back = [["*", { role: "office", name: "Records", boxLock: ["evidence", 0.3], civic: "records" }], [4, { role: "breakroom", civic: "breakroom" }], [2, { role: "restroom", civic: "washroom" }]];
  const pw = rng.int(7, 8), ph = rng.int(10, Math.min(12, bh - 3));
  const port = { role: "bays", name: "Sally port", type: "garage", maxBoxes: 3, civic: "sallyport", nextTo: ["cells", "corridor"] };
  return {
    ...shapeOf("L", [
      { x: right ? 0 : pw - 1, y: 0, w: bw, h: bh, name: "Station", main: true, program: main, upper: (f) => corridorPlan(f === 1 ? [["*", { role: "office", name: "Squad room", civic: "squad" }], interview, ["*", { role: "office", name: "Dispatch", civic: "dispatch" }]] : [["*", { role: "office", name: "Briefing room", civic: "briefing" }], interview, ["*", { role: "office", name: "Squad room", civic: "squad" }]], back, 5) },
      { x: right ? bw - 1 : 0, y: 0, w: pw, h: ph, storeys: 1, tall: true, name: "Sally port", program: port },
    ]),
    front: { width: 2 }, ground: "city", storeys: n, foot: "large", program: null, upper: null, stairs: { roles: ["lobby", "dayroom"], n: 1 }, // up from the front desk
    exits: [{ side: right ? "right" : "left", roles: ["bays"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Sally port" }, { side: "back", roles: ["bays"], chance: 0.6, lock: 0.5 }, { side: right ? "left" : "right", roles: ["corridor"], chance: 0.5, lock: 0.5 }],
  };
}
// A fire station (a new save's, issue #23): the living block of #15 (the day room, the kitchen, the medical store and
// the workshop; upstairs the dorm, the gym, the watch office and a bathroom) and the engine bay an annex on one side,
// one tall storey, its apron out past the living block's front and its back short of it: offset, not centred.
function fireShaped(rng) {
  const lw = rng.int(13, 15), lh = rng.int(12, 14);
  const living = { split: "y", parts: [["*", { role: "dayroom", entry: true, civic: "fdayroom" }], ["*", { split: "x", parts: leaves([["*", { role: "kitchen", civic: "fkitchen" }], [4, { role: "storage", name: "Medical store", type: "nurse", lock: ["door", 0.3], civic: "medstore" }], [4, { role: "workshop", civic: "fworkshop" }]]) }]] };
  const left = rng.chance(0.5), out = rng.int(1, 3), short = rng.int(0, 2), bw2 = rng.int(11, 13);
  const bays = { role: "bays", name: "Engine bay", type: "enginebay", maxBoxes: 5, civic: "enginebay", nextTo: ["dayroom", "workshop", "kitchen"] };
  return {
    ...shapeOf("annex", [
      { x: left ? bw2 - 1 : 0, y: 0, w: lw, h: lh, name: "Station", main: true, program: living, upper: () => ({ split: "y", parts: [["*", { role: "dorm", type: "barracks", civic: "fdorm" }], ["*", { split: "x", parts: leaves([["*", { role: "gym", civic: "fgym" }], [4, { role: "office", name: "Watch office", civic: "watch" }], [3, { role: "bath", civic: "washroom" }]]) }]] }) },
      { x: left ? 0 : lw - 1, y: short, w: bw2, h: lh - short + out, storeys: 1, tall: true, name: "Engine bay", program: bays },
    ]),
    front: { width: 1 }, ground: "town", storeys: 2, foot: "medium", program: null, upper: null, stairs: { roles: ["dayroom", "lobby"], n: 1 }, // up from the day room
    exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.1, name: "Bay door" }, { side: "back", roles: ["bays"], chance: 0.6, roller: true, width: 2, lock: 0.3 }, { side: "back", roles: ["kitchen", "workshop"], chance: 0.6, lock: 0.3 }],
  };
}
// A hospital (a new save's, issue #23): the tower (#14's floors: the waiting room, the pharmacy, the morgue, the
// cafeteria and its kitchen on the ground floor, the wards, the theatre and the ICU above), the emergency room an annex
// on one side at the front (one storey: the ER and the ambulance bay behind it, its roller door the back exit), and a
// lower wing (two storeys: the clinics, then a ward) off the tower's back: off the middle (a T) or at its far end (an L).
function hospitalShaped(rng, bw, bh, n, fire) {
  const tw = bw - rng.int(4, 6), th = bh;
  const ward = (o = {}) => ({ role: "ward", ...o });
  const doc = [4, { role: "office", name: "Doctors' office", type: "office" }];
  const supply = (lock) => [4, { role: "storage", name: "Supply room", type: "clinic", ...(lock ? { lock: ["door", 0.3] } : {}) }];
  const erLeft = rng.chance(0.5);
  const tower = corridorPlan([[rng.int(6, 7), { role: "lobby", entry: true, name: "Waiting room", type: "clinic" }], [rng.int(4, 5), { role: "pharmroom", lock: ["vault", 1], boxLock: ["drugs", 0.3] }], ["*", { role: "office", name: "Admissions", type: "office" }], [3, "restroom"]].map((x, i, a) => (erLeft ? x : a[a.length - 1 - i])),
    [[5, { role: "morgue", lock: ["door", 0.3] }], ["*", "cafeteria"], [5, "kitchen"]], 5, 2);
  const upper = (f, r, ctx) => (f === 1
    ? corridorPlan([["*", ward()], [5, "nursestation"], [6, { role: "theatre", lock: ["door", 0.3] }], supply(true)], [["*", "icu"], ["*", ward()], doc, [3, "restroom"]], 5, 2)
    : ctx && ctx.top
      ? corridorPlan([["*", ward({ name: "Maternity ward", cots: true })], [5, "nursestation"], ["*", ward()]], [["*", ward()], [5, "staffroom"], [4, "laundry"], doc, [3, "restroom"]], 5, 2)
      : corridorPlan([["*", ward()], [5, "nursestation"], ["*", ward()]], [["*", ward()], ["*", ward()], doc, supply(false), [3, "restroom"]], 5, 2));
  const ew = rng.int(12, 14), eh = rng.int(11, 13);
  const er = { split: "y", parts: [["*", { role: "er", nextTo: ["corridor", "lobby"] }], [6, { role: "ambbay" }]] };
  const t = rng.chance(0.55), ww = rng.int(13, 16), wl = rng.int(9, 12), wn = Math.min(n - 1, 2);
  const tx = erLeft ? ew - 1 : 0; // the tower's left wall
  const wx = t ? tx + rng.int(3, Math.max(3, tw - ww - 3)) : erLeft ? tx + tw - ww : tx;
  const clinic = (g) => ({ split: "x", parts: [["*", { split: "y", parts: leaves(g ? [["*", ward()], ["*", ward()]] : [["*", { role: "office", name: "Outpatients", type: "office" }], ["*", { role: "exam", name: "Clinic room" }]]) }], [2, { role: "corridor", name: "Wing corridor" }], ["*", { split: "y", parts: leaves(g ? [["*", ward()], ["*", { role: "office", name: "Consulting room", type: "office" }]] : [["*", { role: "office", name: "Physio", type: "office" }], [4, { role: "storage", name: "Records", type: "office" }]]) }]] });
  return {
    ...shapeOf(t ? "T" : "L", [
      { x: tx, y: wl - 1, w: tw, h: th, name: "Tower", main: true, program: tower, upper },
      { x: erLeft ? 0 : tw - 1, y: wl - 1 + th - eh, w: ew, h: eh, storeys: 1, name: "Emergency", program: er },
      { x: wx, y: 0, w: ww, h: wl, storeys: wn, name: "Clinic wing", wing: true, program: clinic(0), upper: (g) => clinic(g) },
    ]),
    front: { width: 2 }, ground: "city", storeys: n, foot: "large", program: null, upper: null, stairs: ENDS, // one at each end of the tower's corridor
    exits: [{ side: "back", roles: ["ambbay"], chance: 1, lock: 0.25, roller: true, width: 2, name: "Ambulance bay" }, ...fire(0.3).map((e) => ({ ...e, chance: 0.85 })), { side: "back", roles: ["corridor"], chance: 0.5, lock: 0.4 }],
  };
}
// A church (a new save's, issue #23): the narthex and the nave (#15's pews either side of the aisle to the altar), the
// vestry, the parish hall, its kitchen and the food bank's pantry behind; a side chapel stuck on one side (an L) or a
// transept across the nave with arms of their own lengths (a cross), and the bell tower a part of its own at a front
// corner beside the narthex (raised: a ladder up, the loft as before), its roof above the nave's.
function churchShaped(rng) {
  const nw = rng.int(12, 14), nh = rng.int(19, 22);
  const narthex = { role: "foyer", name: "Narthex", entry: true, type: "chapel", civic: "narthex" };
  const backRow = { split: "x", parts: leaves([[3, { role: "vestry", boxLock: ["lockbox", 0.4], civic: "vestry" }], ["*", { role: "kitchen", name: "Parish hall", civic: "parishhall" }], [2, { role: "pantry", name: "Food bank pantry", type: "kitchen", civic: "cpantry" }]]) };
  const towerLeft = rng.chance(0.5), cross = rng.chance(0.45);
  const tower = { w: 5, h: 5, storeys: 1, tall: true, name: "Bell tower", program: { role: "storage", name: "Bell tower", type: "chapel", civic: "belltower", nextTo: ["foyer"] } };
  const chapel = (name) => ({ role: "nave", name, civic: "nave", maxBoxes: 1 });
  let parts;
  if (cross) {
    // The nave, the transept (a crossing between two side chapels, the arms of different lengths), the hall behind.
    const aL = rng.int(5, 7), aR = rng.int(4, 6), th = rng.int(7, 8), bh = 7, front = nh - rng.int(6, 8); // the nave shorter: the transept and the hall take the rest
    const transept = { split: "x", parts: [[aL - 1, chapel("North chapel")], ["*", { role: "foyer", name: "Crossing", type: "chapel", hub: true, civic: "narthex" }], [aR - 1, chapel("South chapel")]] };
    parts = [
      { x: aL, y: th + bh - 2, w: nw, h: front, name: "Nave", main: true, program: { split: "y", parts: [[3, narthex], ["*", { role: "nave", civic: "nave" }]] } },
      { x: 0, y: bh - 1, w: nw + aL + aR, h: th, name: "Transept", program: transept },
      { x: aL, y: 0, w: nw, h: bh, name: "Parish hall", program: backRow },
    ];
  } else {
    const cw = rng.int(6, 8), ch = rng.int(8, 10), cy = rng.int(5, Math.max(5, nh - ch - 4)), left = !towerLeft;
    parts = [
      { x: left ? cw - 1 : 0, y: 0, w: nw, h: nh, name: "Nave", main: true, program: { split: "y", parts: [[3, narthex], ["*", { role: "nave", civic: "nave" }], [5, backRow]] } },
      { x: left ? 0 : nw - 1, y: cy, w: cw, h: ch, name: "Side chapel", program: { ...chapel("Side chapel"), nextTo: ["nave"] } },
    ];
  }
  const nave = parts[0];
  parts.push({ x: towerLeft ? nave.x - tower.w + 1 : nave.x + nave.w - 1, y: nave.y + nave.h - tower.h, ...tower }); // beside the narthex, flush with the front
  return {
    ...shapeOf(cross ? "cross" : "L", parts),
    front: { width: 2 }, ground: "town", storeys: 1, foot: "medium", loft: { roles: ["storage"], chance: 1, ladder: true }, program: null, upper: null,
    exits: [{ side: "back", roles: ["kitchen", "pantry"], chance: 0.7, lock: 0.3 }, { side: "left", roles: ["nave"], chance: 0.5, lock: 0.4 }, { side: "right", roles: ["nave"], chance: 0.5, lock: 0.4 }],
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

// ---------- military bases, air bases, airports and prisons laid out like the real thing (issue #25) ----------
// The new saves' plans (an older save keeps the ones above: o.legacy), at real-world sizes (militarylayout.js MIL_SIZE:
// metres, a metre a cell); every leaf names its style (civic: militarylayout.js MILITARY_STYLES, or civiclayout.js's
// shared briefing, records, washroom and breakroom). o.site: the site's location type (siteBuildings), so a hangar at
// an air base holds military aircraft and a warehouse at a base is the supply warehouse. The grounds: compound (a
// base's fence, wire, watchtowers and gatehouse), airfield (the apron, a parked wreck, an air base's fuel farm),
// prisonyard (the double perimeter and the exercise yard): militarylayout.js militaryOutside. The bunkers are #26's
// (bunkerlayout.js).
// Plans with no rectangle beyond their own (no #23 shapes on dev yet): each is a split tree, so a part can become a
// wing of a shape once spec.shape lands.
const milSize = (rng, k) => realFoot(rng, k); // data-buildingsize.js REAL_SIZE (#24's table: #25's rows, planned)
const milStoreys = (rng, k) => rng.int(MIL_SIZE[k].storeys[0], MIL_SIZE[k].storeys[1]);
const WASH = { role: "restroom", name: "Washroom", civic: "washroom", type: "lockers", maxBoxes: 1 };
// Rooms of `unit` cells along a band `width` cells wide, the last taking the rest.
const rowRooms = (width, unit, leaf) => { const n = Math.max(1, Math.floor(width / (unit + 1))); return Array.from({ length: n }, (_, i) => [i === n - 1 ? "*" : unit, leaf(i)]); };
// A dozen plans a type (milplans.js milVariant: today's plan, milPlanOf's or std's, is "standard" among them; its dice
// or o.plan pick one). std: today's plan for a type milPlanOf has no case for (the control building, the transmitter
// hut: their old plans).
function milPlan(rng, v, o = {}, std = () => milPlanOf(rng, v, o)) { const spec = milVariant(v, rng, o, std, (k) => milSize(rng, k)); spec.real = true; return spec; } // drawn at its real size already (realScale leaves it)
function milPlanOf(rng, v, o = {}) {
  const site = o.site || null;
  switch (v) {
    case "hq": { // the command building: ops, the commander, briefing, comms; a helipad outside
      const { bw, bh } = milSize(rng, "hq");
      const fd = Math.floor((bh - 4) / 2);
      return {
        bw, bh, front: { width: 2 }, ground: "compound", helipad: true, margins: { right: 13 }, storeys: 2, foot: "large", stairs: { ...ENDS, len: 2 }, // a run of 2 steps at each end of the corridor
        program: corridorPlan([["*", { role: "control", name: "Operations room", type: "control", civic: "ops", maxBoxes: 3 }], [6, { role: "lobby", entry: true, name: "Duty desk", type: "office", civic: "mlobby" }], ["*", { role: "office", name: "Briefing room", civic: "briefing" }]],
          [["*", { role: "control", name: "Comms room", type: "control", civic: "comms" }], [6, { role: "office", name: "Commander's office", lock: ["door", 0.4], gunSafe: ["gunsafe2", 0.5], civic: "cmdoffice" }], [5, { role: "office", name: "Records", boxLock: ["safe", 0.3], civic: "records" }], [3, WASH], ["*", { role: "office", name: "Staff office", civic: "squadron" }]], fd, 2),
        upper: () => corridorPlan([["*", { role: "office", name: "Planning room", civic: "ops", type: "control" }], [6, { role: "office", name: "Adjutant's office", civic: "squadron" }], ["*", { role: "office", name: "Conference room", civic: "briefing" }]],
          [["*", { role: "control", name: "Signals room", type: "control", civic: "comms" }], [6, { role: "breakroom", civic: "breakroom" }], [3, WASH], ["*", { role: "office", name: "Intelligence office", boxLock: ["safe", 0.4], civic: "records" }]], fd, 2),
        exits: [{ side: "back", roles: ["corridor"], chance: 0.8, lock: 0.5 }, { side: "left", roles: ["corridor"], chance: 0.6, lock: 0.5 }, { side: "right", roles: ["corridor"], chance: 0.6, lock: 0.5 }],
      };
    }
    case "barracks": { // open bays or two-person rooms, a duty desk at the door, latrines and a day room, NCO rooms
      const { bw, bh } = milSize(rng, "barracks"), n = milStoreys(rng, "barracks");
      const fd = Math.floor((bh - 4) / 2);
      const rooms = rng.chance(0.4); // two-person rooms (else open bays)
      const bay = (i) => (rooms ? { role: "dorm", name: `Room ${i + 1}`, civic: "twoman", maxBoxes: 2 } : { role: "dorm", name: "Squad bay", civic: "bay", maxBoxes: 6 });
      const side = Math.floor((bw - 2 - 6) / 2);
      const front = rooms ? [...rowRooms(side, 4, bay), [6, { role: "foyer", name: "Duty desk", entry: true, type: "barracks", civic: "dutydesk" }], ...rowRooms(side, 4, (i) => bay(i + 10))]
        : [["*", bay(0)], [6, { role: "foyer", name: "Duty desk", entry: true, type: "barracks", civic: "dutydesk" }], ["*", bay(1)]];
      const back = (f) => [["*", bay(20 + f)], [6, { role: "restroom", name: "Latrine", civic: "latrine" }], [6, { role: "dayroom", name: "Day room", civic: "mdayroom", hub: false, type: "barracks", maxBoxes: 2 }], [4, { role: "bedroom", name: "NCO room", type: "barracks", civic: "nco", maxBoxes: 2 }], [4, { role: "bedroom", name: "NCO room", type: "barracks", civic: "nco", maxBoxes: 2 }], ["*", bay(30 + f)]];
      return {
        bw, bh, front: { width: 1 }, ground: "compound", storeys: n, foot: "large", stairs: { ...ENDS, len: 2 },
        program: corridorPlan(front, back(0), fd, 2),
        upper: (f) => corridorPlan(rooms ? [...rowRooms(side, 4, (i) => bay(40 + i)), [6, { role: "storage", name: "Supply room", type: "barracks", lock: ["door", 0.3], civic: "qmcage" }], ...rowRooms(side, 4, (i) => bay(50 + i))] : [["*", bay(2)], [6, { role: "storage", name: "Supply room", type: "barracks", lock: ["door", 0.3], civic: "qmcage" }], ["*", bay(3)]], back(f), fd, 2),
        exits: [{ side: "back", roles: ["corridor"], chance: 0.7, lock: 0.2 }, { side: "left", roles: ["corridor"], chance: 0.7, lock: 0.3 }, { side: "right", roles: ["corridor"], chance: 0.7, lock: 0.3 }],
      };
    }
    case "armorybldg": { // the issue window, the vault of weapon racks, the ammo store, the optics cage, the armorer
      const { bw, bh } = milSize(rng, "armorybldg");
      return {
        bw, bh, front: { width: 1 }, ground: site === "prison" ? "prisonyard" : "compound", storeys: 1, foot: "medium",
        program: { split: "y", parts: [[4, { split: "x", parts: leaves([["*", { role: "foyer", name: "Issue window", entry: true, type: "barracks", civic: "issue" }], [6, { role: "office", name: "Armorer's office", type: "workshop", civic: "armorer" }]]) }],
          ["*", { split: "x", parts: leaves([["*", { role: "armory", name: "Arms vault", lock: ["vault", 1], boxLock: ["cage", 0.4], gunSafe: ["gunsafe3", 0.35], civic: "vault", dk: "steel", maxBoxes: 6 }], [6, { role: "armory", name: "Ammo store", lock: ["door", 0.6], boxLock: ["crate", 0.3], civic: "ammostore", dk: "steel" }], [5, { role: "armory", name: "Optics cage", lock: ["door", 0.5], civic: "optics", dk: "cell", maxBoxes: 2 }]]) }]] },
        exits: [{ side: "back", roles: ["office", "foyer"], chance: 0.3, lock: 0.7 }],
      };
    }
    case "messhall": { // the mess and its serving line, the galley, the walk-in cooler and freezer, the dry store
      const { bw, bh } = milSize(rng, "messhall");
      return {
        bw, bh, front: { width: 2 }, ground: site === "prison" ? "prisonyard" : "compound", storeys: 1, foot: "large",
        program: { split: "y", parts: [["*", { role: "mess", entry: true, civic: "mess", maxBoxes: 6 }], [7, { split: "x", parts: leaves([["*", { role: "kitchen", name: "Galley", civic: "galley", maxBoxes: 4 }], [4, { role: "pantry", name: "Walk-in cooler", type: "kitchen", dk: "coldroom", civic: "mwalkin", boxTarget: 3 }], [4, { role: "pantry", name: "Walk-in freezer", type: "kitchen", dk: "coldroom", civic: "mwalkin", boxTarget: 3 }], [6, { role: "pantry", name: "Dry store", type: "kitchen", lock: ["door", 0.3], civic: "drystore", boxTarget: 5 }], [3, WASH]]) }]] },
        exits: [{ side: "back", roles: ["kitchen", "pantry"], chance: 0.9, lock: 0.3 }, { side: "left", roles: ["mess"], chance: 0.5, lock: 0.4 }, { side: "right", roles: ["mess"], chance: 0.5, lock: 0.4 }],
      };
    }
    case "motorpool": { // the bays and their vehicles, the dispatch office, the parts room, the tool crib; the fuel point outside
      const { bw, bh } = milSize(rng, "motorpool");
      const side = [8, { split: "y", parts: leaves([[7, { role: "office", name: "Dispatch office", entry: true, hub: true, civic: "dispatchm" }], ["*", { role: "parts", type: "motorpool", lock: ["door", 0.5], boxLock: ["crate", 0.3], civic: "mparts" }], [7, { role: "workshop", name: "Tool crib", type: "motorpool", lock: ["door", 0.4], civic: "toolcrib" }]]) }];
      const left = rng.chance(0.5);
      return {
        bw, bh, front: { width: 1 }, ground: "compound", storeys: 1, foot: "wide", pumps: 2,
        program: { split: "x", parts: left ? [side, ["*", { role: "motor", name: "Vehicle bays", civic: "vbays" }]] : [["*", { role: "motor", name: "Vehicle bays", civic: "vbays" }], side] },
        exits: [{ side: "front", roles: ["motor"], chance: 1, roller: true, width: 4, lock: 0.1, name: "Vehicle bay" }, { side: "back", roles: ["motor"], chance: 0.7, roller: true, width: 4, lock: 0.3 }, { side: left ? "right" : "left", roles: ["motor"], chance: 0.5, lock: 0.4 }],
      };
    }
    case "supply": { // the military site's warehouse: pallet racks, the quartermaster's office and cage
      const { bw, bh } = milSize(rng, "supply");
      const side = [8, { split: "y", parts: leaves([[7, { role: "office", name: "Quartermaster's office", entry: true, hub: true, civic: "qmoffice" }], ["*", { role: "storage", name: "Quartermaster's cage", type: "barracks", lock: ["door", 0.5], boxLock: ["crate", 0.3], dk: "cell", civic: "qmcage" }]]) }];
      const left = rng.chance(0.5);
      return {
        bw, bh, front: { width: 1 }, ground: "compound", storeys: 1, foot: "wide",
        program: { split: "x", parts: left ? [side, ["*", { role: "warefloor", name: "Supply floor", civic: "msupply" }]] : [["*", { role: "warefloor", name: "Supply floor", civic: "msupply" }], side] },
        exits: [{ side: "back", roles: ["warefloor"], chance: 1, roller: true, width: 3, lock: 0.25, name: "Loading dock" }, { side: "front", roles: ["warefloor"], chance: 0.5, roller: true, width: 3, lock: 0.3 }],
      };
    }
    case "aidstation": { // cots in rows, triage, the medic's office, the medical store
      const { bw, bh } = milSize(rng, "aidstation");
      return {
        bw, bh, front: { width: 2 }, ground: "compound", storeys: 1, foot: "medium",
        program: corridorPlan([["*", { role: "ward", name: "Aid station", civic: "aidward" }], [6, { role: "lobby", entry: true, name: "Triage", type: "clinic", civic: "triage" }]],
          [["*", { role: "ward", name: "Recovery", civic: "aidward" }], [5, { role: "office", name: "Medic's office", type: "clinic", civic: "medic" }], [5, { role: "storage", name: "Medical store", type: "clinic", lock: ["door", 0.4], boxLock: ["drugs", 0.3], civic: "aidstore" }]], Math.floor((bh - 3) / 2)),
        exits: [{ side: "back", roles: ["corridor"], chance: 0.7, lock: 0.3 }],
      };
    }
    case "gatehouse": { // the guard post at the gate
      const { bw, bh } = milSize(rng, "gatehouse");
      return {
        bw, bh, front: { width: 1 }, ground: "compound", storeys: 1, foot: "small",
        program: { split: "x", parts: leaves([["*", { role: "office", name: "Guard post", entry: true, hub: true, type: "barracks", civic: "guardpost" }], [2, WASH]]) },
        exits: [{ side: "back", roles: ["office"], chance: 0.8, lock: 0.3 }],
      };
    }
    case "hangar": { // the hangar floor and its aircraft, the office, the parts store, the avionics shop
      const { bw, bh } = milSize(rng, "hangar"), mil = site === "airbase";
      const side = [9, { split: "y", parts: leaves([[8, { role: "office", name: "Hangar office", entry: true, hub: true, civic: "hoffice" }], ["*", { role: "parts", type: "hangar", lock: ["door", 0.35], civic: "hparts" }], [8, { role: "workshop", name: "Avionics shop", type: "hangar", civic: "avionics" }]]) }];
      const floor = { role: "hangarfloor", civic: "hfloor", maxBoxes: 6, ...(mil ? { milAir: true } : {}) };
      const left = rng.chance(0.5);
      return {
        bw, bh, front: { width: 1 }, ground: "airfield", milAir: mil, margins: { front: 12, ...(mil ? { right: 9 } : {}) }, storeys: 1, foot: "wide", // the apron in front, an air base's fuel farm beside
        program: { split: "x", parts: left ? [side, ["*", floor]] : [["*", floor], side] },
        exits: [{ side: "front", roles: ["hangarfloor"], chance: 1, roller: true, width: 10, lock: 0.1, name: "Hangar door" }, { side: "back", roles: ["hangarfloor", "parts"], chance: 0.6, lock: 0.4 }],
      };
    }
    case "tower": { // the control tower: the cab on the top floor, the radar room below, the equipment room at the foot
      const { bw, bh } = milSize(rng, "tower"), n = milStoreys(rng, "tower");
      const SW = [2, { role: "stairwell" }];
      return {
        bw, bh, front: { width: 1 }, ground: "airfield", milAir: site === "airbase", margins: { front: 12 }, storeys: n, foot: "tower", stairs: { roles: ["stairwell"], n: 1, len: 2 },
        program: { split: "x", parts: [SW, ["*", { split: "y", parts: leaves([["*", { role: "lobby", entry: true, name: "Tower entrance", type: "office", civic: "tlobby" }], [4, { role: "workshop", name: "Equipment room", type: "control", civic: "tequip" }]]) }]] },
        upper: (f, r, ctx) => ({ split: "x", parts: [SW, ["*", ctx.top ? { role: "control", name: "Tower cab", civic: "cab", maxBoxes: 3 } : { role: "control", name: f === 1 ? "Radar room" : "Approach control", civic: "tradar" }]] }),
        exits: [{ side: "back", roles: ["workshop", "lobby"], chance: 0.5, lock: 0.5 }],
      };
    }
    case "flightops": { // briefing, the crew room and its lockers, life support (flight gear), the squadron's offices
      const { bw, bh } = milSize(rng, "flightops"), n = milStoreys(rng, "flightops");
      const fd = Math.floor((bh - 3) / 2);
      return {
        bw, bh, front: { width: 2 }, ground: "airfield", milAir: true, margins: { front: 12 }, storeys: n, foot: "large",
        program: corridorPlan([["*", { role: "office", name: "Briefing room", civic: "briefing" }], [6, { role: "lobby", entry: true, name: "Ops desk", type: "office", civic: "opsdesk" }], ["*", { role: "lockerroom", name: "Crew room", type: "flightgear", civic: "crewroom" }]],
          [["*", { role: "storage", name: "Life support", type: "flightgear", lock: ["door", 0.3], civic: "lifesupport" }], [6, { role: "office", name: "Weather office", civic: "weather" }], [3, WASH], ["*", { role: "office", name: "Squadron office", civic: "squadron" }]], fd),
        upper: n > 1 ? () => corridorPlan([["*", { role: "office", name: "Squadron commander", civic: "cmdoffice", gunSafe: ["gunsafe2", 0.3] }], ["*", { role: "office", name: "Planning room", type: "control", civic: "ops" }]], [["*", { role: "breakroom", civic: "breakroom" }], [3, WASH], ["*", { role: "office", name: "Records", civic: "records" }]], fd) : null,
        exits: [{ side: "back", roles: ["corridor"], chance: 0.8, lock: 0.4 }],
      };
    }
    case "terminal": { // check-in, security, the confiscated items room, the gates, the food court, shops, baggage
      const { bw, bh } = milSize(rng, "terminal"), n = milStoreys(rng, "terminal");
      const land = 11, mid = 9;
      return {
        bw, bh, front: { width: 3 }, ground: "airfield", margins: { front: 12 }, storeys: n, foot: "wide", stairs: { roles: ["terminal", "dining", "lounge"], n: 2 },
        program: { split: "y", parts: [
          ["*", { split: "x", parts: leaves([["*", { role: "terminal", name: "Departure gates", type: "store", civic: "gates", maxBoxes: 3 }], [14, { role: "kitchen", name: "Food court", hub: true, civic: "foodcourt", maxBoxes: 4 }], [9, { role: "sales", name: "Duty free", hub: false, type: "store", civic: "tshop", maxBoxes: 4 }], [5, WASH], ["*", { role: "terminal", name: "Departure gates", type: "store", civic: "gates", maxBoxes: 3 }]]) }],
          [mid, { split: "x", parts: leaves([[14, { role: "terminal", name: "Security checkpoint", type: "office", civic: "security", maxBoxes: 1 }], [7, { role: "office", name: "Confiscated items", lock: ["door", 0.6], boxLock: ["evidence", 0.4], civic: "confiscated" }], [8, { role: "office", name: "Airport police", boxLock: ["evidence", 0.3], gunSafe: ["gunsafe2", 0.3], civic: "squad" }], ["*", { role: "warefloor", name: "Baggage hall", type: "store", civic: "bhall", maxBoxes: 6 }], [9, { role: "office", name: "Airline offices", civic: "airline" }]]) }],
          [land, { split: "x", parts: leaves([["*", { role: "terminal", name: "Check-in hall", entry: true, civic: "checkin", maxBoxes: 3 }], [12, { role: "terminal", name: "Baggage claim", civic: "claim", maxBoxes: 4 }], [5, WASH], [10, { role: "sales", name: "News stand", hub: false, type: "store", civic: "tshop", maxBoxes: 3 }]]) }],
        ].reverse() },
        upper: n > 1 ? () => ({ split: "y", parts: [[land + mid, { split: "x", parts: leaves([["*", { role: "office", name: "Airport offices", civic: "airline" }], [12, { role: "office", name: "Operations", type: "control", civic: "ops" }], [5, WASH]]) }], ["*", { split: "x", parts: leaves([["*", { role: "dining", name: "Departure lounge", type: "store", hub: true, civic: "lounge", maxBoxes: 3 }], [14, { role: "kitchen", name: "Restaurant", hub: true, civic: "foodcourt", maxBoxes: 3 }], ["*", { role: "dining", name: "Airline lounge", type: "store", hub: true, civic: "lounge", maxBoxes: 3 }]]) }]] }) : null,
        exits: [{ side: "back", roles: ["warefloor", "terminal"], chance: 0.9, roller: true, width: 3, lock: 0.2, name: "Airside doors" }, { side: "left", roles: ["terminal"], chance: 0.6, lock: 0.4 }, { side: "right", roles: ["terminal"], chance: 0.6, lock: 0.4 }],
      };
    }
    default: { // the cell block: two tiers of cells facing the day room; intake, control, visitation and the guard room at the front
      const { bw, bh } = milSize(rng, "cellblock");
      const dw = rng.int(10, 12);
      const tier = (up) => ({ split: "x", parts: leaves([["*", { role: "cells", name: up ? "Cell block A (upper tier)" : "Cell block A", civic: "pcells", maxBoxes: 2 }], [dw, { role: "dayroom", name: up ? "Upper tier walkway" : "Day room", civic: "pdayroom", type: "cellblock", maxBoxes: 1 }], ["*", { role: "cells", name: up ? "Cell block B (upper tier)" : "Cell block B", civic: "pcells", maxBoxes: 2 }]]) });
      return {
        bw, bh, front: { width: 1 }, ground: "prisonyard", margins: { back: 10, left: 5, right: 5 }, storeys: 2, foot: "large", // the exercise yard behind stairs: { roles: ["dayroom"], n: 1 },
        program: { split: "y", parts: [[7, { split: "x", parts: leaves([["*", { role: "office", name: "Intake", entry: true, type: "cellblock", civic: "intake", maxBoxes: 4 }], [8, { role: "control", name: "Control room", lock: ["door", 0.5], civic: "pcontrol" }], ["*", { role: "office", name: "Visitation", type: "cellblock", civic: "visitation", maxBoxes: 1 }], [7, { role: "lockerroom", name: "Guard room", type: "cellblock", civic: "guardroom" }]]) }], [2, { role: "corridor" }], ["*", tier(false)]] }, // the front band, the corridor, the cells round the day room behind
        upper: () => ({ split: "y", parts: [[7, { split: "x", parts: leaves([["*", { role: "office", name: "Records", civic: "records" }], [8, { role: "control", name: "Upper control", civic: "pcontrol" }], ["*", { role: "breakroom", name: "Staff room", civic: "breakroom" }], [7, { role: "armory", name: "Riot gear store", lock: ["vault", 0.7], boxLock: ["cage", 0.4], civic: "riotstore", dk: "steel" }]]) }], [2, { role: "corridor" }], ["*", tier(true)]] }),
        exits: [{ side: "left", roles: ["corridor"], chance: 0.6, lock: 0.6 }, { side: "right", roles: ["corridor"], chance: 0.6, lock: 0.6 }],
      };
    }
  }
}

// A motel: a row of rooms, each with its own door onto the parking lot, and the office at one end.
function motel(rng, o = {}) {
  if (!o.legacy && o.shapes) return motelShaped(rng);
  const n = rng.int(4, 5), uw = 4;
  const bw = 2 + 5 + 1 + n * uw + (n - 1);
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
  return {
    bw, bh, front: { width: 1 }, ground: "lot", unitDoors: "motelroom", openDoors: 0.25, extraDoors: 0, storeys: 2, foot: "medium",
    stairs: { out: left ? "left" : "right", n: 1 }, // an outside stair at the office's end, up to the walkway along the back
    program: { split: "x", parts: left ? [office, ...units] : [...units, office] },
    upper: () => ({ split: "y", parts: [["*", { split: "x", parts: left ? [linen, ...upperUnits()] : [...upperUnits(), linen] }], [1, { role: "corridor", name: "Walkway" }]] }),
    exits: [{ side: "back", roles: ["office"], chance: 0.6, lock: 0.3 }],
  };
}

// A motel (a new save's, issue #23): round its parking lot, an L or a U. The office a corner of its own (the front
// desk with its door onto the lot, the manager's room; the laundry above), the row of rooms along the back on two
// storeys (each room's own door onto the lot, its bathroom behind; upstairs the walkway along the back), and a wing of
// one storey down the side from the office's corner, its rooms' doors facing the lot; a U's other wing down the far
// side from a laundry corner, the two wings of different lengths.
function motelShaped(rng) {
  const n = rng.int(4, 5), uw = 4, bh = rng.int(9, 10);
  const u = rng.chance(0.5), left = rng.chance(0.5);
  let no = 0;
  const unit = (bathFirst, ax = "y") => { no++; const room = ["*", { role: "motelroom", name: `Room ${no}` }], bath = [2, { role: "bath", name: `Bath ${no}` }]; return [uw, { split: ax, parts: leaves(bathFirst ? [bath, room] : [room, bath]) }]; };
  // The back row: a room's front onto the lot, its bathroom behind (split y: the front first).
  const rowUnits = Array.from({ length: n }, () => unit(false));
  const rowW = 1 + n * (uw + 1);
  const upperUnits = () => rowUnits.map(([w], i) => [w, { split: "y", parts: leaves([[2, { role: "bath", name: `Bath ${100 + i + 1}`, type: null }], ["*", { role: "motelroom", name: `Room ${100 + i + 1}` }]]) }]);
  const ow = bh + 3;
  // Laid out with the office's corner on the left, then mirrored when it stands on the right (mx).
  const mx = (list) => (left ? list : list.slice().reverse());
  const manager = [4, { role: "office", name: "Manager's room", type: "house", lock: ["door", 0.4], boxLock: ["lockbox", 0.4] }];
  const office = { split: "x", parts: leaves(mx([manager, ["*", { role: "reception", entry: true }]])) }; // the manager's room over the wing, the front desk by the lot
  const k1 = rng.int(2, 4), k2 = u ? clampN(k1 + rng.pick([-1, 1]), 2, 4) : 0;
  // A wing's rooms down the side, top to bottom, their doors onto the lot (the bathroom on the outer side: split x).
  const wing = (k, outerLeft) => ({ split: "y", parts: Array.from({ length: k }, () => unit(outerLeft, "x")) });
  const inner = (side) => (left ? side : side === "right" ? "left" : "right");
  const parts = [
    { x: 0, y: 0, w: ow, h: bh, storeys: 2, name: "Office", program: office, upper: () => ({ role: "storage", name: "Laundry", type: "house" }) },
    { x: ow - 1, y: 0, w: rowW, h: bh, storeys: 2, name: "Rooms", main: true, program: { split: "x", parts: rowUnits }, upper: () => ({ split: "y", parts: [["*", { split: "x", parts: upperUnits() }], [1, { role: "corridor", name: "Walkway" }]] }) },
    { x: 0, y: bh - 1, w: bh, h: 1 + k1 * (uw + 1), storeys: 1, name: "Wing", wing: true, unitSide: inner("right"), program: wing(k1, left) },
  ];
  if (u) {
    const cx = ow - 1 + rowW - 1, cw = bh + 3;
    parts.push({ x: cx, y: 0, w: cw, h: bh, storeys: 1, name: "Laundry", program: { role: "storage", name: "Laundry", type: "house", ownDoor: "front" } });
    parts.push({ x: cx + cw - bh, y: bh - 1, w: bh, h: 1 + k2 * (uw + 1), storeys: 1, name: "Far wing", wing: true, unitSide: inner("left"), program: wing(k2, !left) });
  }
  if (!left) { const W = Math.max(...parts.map((p) => p.x + p.w)); for (const p of parts) p.x = W - p.x - p.w; } // the office's corner on the right
  return {
    ...shapeOf(u ? "U" : "L", parts), ground: "lot", unitDoors: "motelroom", front: { width: 1 }, openDoors: 0.25, extraDoors: 0, storeys: 2, foot: "medium", program: null, upper: null, stairs: { roles: ["reception"], n: 1 }, // up from the front desk to the laundry and the walkway
    exits: [{ side: "back", roles: ["office", "reception"], chance: 0.6, lock: 0.3 }],
  };
}

// A car dealership (data-shops.js): the showroom at the front, the service bays to one side behind a roller door, the
// parts room, the sales office (the keys in a locked box) and the restroom behind; a used-car lot's is a small office
// on its lot (plan.back "lot"), a truck dealer's mostly bays ("service").
function dealer(rng, o = {}) {
  const plan = planOf("dealer", o);
  if (!o.legacy) return shopVariantSpec("dealer", rng, o, withPlan, plan); // issue #35: its 12 plans (shopvariants.js)
  const lot = plan.back === "lot", svc = plan.back === "service";
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
  return { bw, bh, program, exits, front: { width: 2 }, openDoors: 0.3, ground: "lot", storeys: n, upper: n > 1 ? upper : null, foot: lot ? "small" : "medium", stairs: { roles: BACK_STAIRS } };
}

// A bank (data-shops.js): the banking hall at the front, the teller line, the vault (a vault door, its boxes locked)
// and the manager's office behind; the bigger banks have offices above (plan.storeys).
function bank(rng, o = {}) {
  const plan = planOf("bank", o);
  if (!o.legacy) return shopVariantSpec("bank", rng, o, withPlan, plan); // issue #35: its 12 plans (shopvariants.js)
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

// A library (data-shops.js): the circulation desk and the stacks, a reading room, the children's corner, the
// workroom and the archive; the city's central library has more floors of stacks (plan.storeys). A new save's (issue
// #34): one of librarylayout.js's eight variants by the place's franchise (o.variant), from a one-room reading room to
// the central library; an older save's (o.legacy) as it always was.
function library(rng, o = {}) {
  if (!o.legacy) return libraryPlan(rng, { variant: o.variant || null });
  const plan = planOf("library", o);
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
  if (!o.legacy && !o._classic) return variantSpec("vet", rng, o, { classic: () => vet(rng, { ...o, _classic: true }) }); // one of a dozen plans (civicvariants.js, issue #36); the one below is one of them
  const plan = planOf("vet", o);
  const bw = rng.int(15, 18) + (plan.wide ? 3 : 0) + (o.legacy ? 0 : 3), bh = rng.int(11, 13) + (o.legacy ? 0 : 2);
  const n = plan.storeys ? rng.int(plan.storeys[0], plan.storeys[1]) : 1;
  const barn = plan.back === "barn";
  if (!o.legacy) return {
    bw, bh, front: { width: 2 }, ground: barn ? "rural" : "town", storeys: n, foot: "medium",
    program: corridorPlan([[4, { role: "exam", name: "Exam room", type: "vet" }], ["*", { role: "lobby", entry: true, name: "Waiting room", type: "vet" }], [4, { role: "exam", name: "Exam room", type: "vet" }]],
      [["*", barn ? { role: "storage", name: "Large-animal stalls", type: "barn", fl: "dirt" } : { role: "cells", name: "Kennels", type: "vet", kennel: true, lock: ["door", 0.35] }], [4, { role: "theatre", name: "Surgery", type: "vet", lock: ["door", 0.3] }], [3, { role: "pharmroom", name: "Drug room", type: "vet", lock: ["door", 0.5], boxLock: ["drugs", 0.4] }], [3, { role: "storage", name: "Food store", type: "vet", food: true }]], 4),
    upper: n > 1 ? () => corridorPlan([["*", "office"], [4, "breakroom"]], [["*", { role: "ward", name: "Recovery ward", type: "vet" }], [3, { role: "storage", type: "vet" }], [2, "restroom"]], 4) : null,
    exits: [{ side: "back", roles: ["storage", "cells", "theatre"], chance: 0.8, lock: 0.3 }],
  };
  return {
    bw, bh, front: { width: 2 }, ground: barn ? "rural" : "town", storeys: n, foot: "medium",
    program: corridorPlan([[4, { role: "exam", name: "Exam room", type: "vet" }], ["*", { role: "lobby", entry: true, name: "Waiting room", type: "vet" }], [4, { role: "exam", name: "Exam room", type: "vet" }]],
      [["*", barn ? { role: "storage", name: "Large-animal stalls", type: "barn", fl: "dirt" } : { role: "cells", name: "Kennels", type: "vet" }], [rng.int(4, 5), { role: "exam", name: "Surgery", type: "vet", lock: ["door", 0.3] }], [3, { role: "pharmroom", name: "Drug room", type: "vet", lock: ["door", 0.5], boxLock: ["drugs", 0.4] }], [2, "restroom"]], 4),
    upper: n > 1 ? () => corridorPlan([["*", "office"], [4, "breakroom"]], [["*", { role: "ward", name: "Recovery ward", type: "vet" }], [3, { role: "storage", type: "vet" }]], 4) : null,
    exits: [{ side: "back", roles: ["storage", "cells", "exam"], chance: 0.8, lock: 0.3 }],
  };
}

// A hotel (issue #29, hotellayout.js): a roadside inn, a business hotel, a resort or a city tower by its franchise
// (data-shops.js FRANCHISES.hotel plan.hotel; a sample plan's by the dice), its grounds round it; its map up to
// battlesize.js MAP_CAP.hotel (200 × 200).
function hotel(rng, o = {}) {
  return hotelSpec(rng, { ...o, vid: typeof o.plan === "string" ? o.plan : o.vid || null, plan: planOf("hotel", o), maxStoreys: MAX_STOREYS }); // o.plan: one of its kind's dozen variants (data-hotels.js, issue #38)
}

function apartments(rng, o = {}) {
  const bw = rng.int(18, 22), bh = rng.int(14, 16);
  // 3–6 floors of flats (deeper city blocks taller: o.storeyBonus), a lobby and the maintenance room on the ground floor.
  const n = clampN(rng.int(3, 6) + (o.storeyBonus || 0), 3, OLD_MAX);
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
  const block = {
    bw, bh, front: { width: 2 }, ground: "city", storeys: n, foot: "medium", extraDoors: 0,
    stairs: { roles: ["stairwell"], n: 1, len: 3 },
    program: corridorPlan([["*", flat(0, "A", fw)], [2, { role: "stairwell" }], [lobby, { role: "lobby", entry: true, type: "house" }], ["*", flat(0, "B", fw)]],
      [["*", flat(0, "C", bk)], ["*", flat(0, "D", bk)], [4, { role: "hgarage", name: "Maintenance", type: "garage", lock: ["door", 0.3] }]], 5),
    upper: (f) => corridorPlan([["*", flat(f, "A", uw)], [2, { role: "stairwell" }], [lobby, { role: "hall", name: "Landing" }], ["*", flat(f, "B", uw)]], [["*", flat(f, "C", ub)], ["*", flat(f, "D", ub)], [3, { role: "storage", name: f === 1 ? "Laundry" : "Utility room", type: "house" }]], 5),
    exits: [{ side: "back", roles: ["hgarage"], chance: 0.8, lock: 0.3 }, { side: "left", roles: ["corridor"], chance: 0.4, lock: 0.4 }, { side: "right", roles: ["corridor"], chance: 0.4, lock: 0.4 }],
  };
  // A new save's (issue #23), half of them: a lower wing of two more flats a floor on one side, its back stepped (an L).
  if (o.legacy || !o.shapes || hash01(rng.state, "shape", "apartments") >= 0.5) return block; // read, not consumed
  const ww = rng.int(10, 12), wh = wingDepth(rng, 5, bh), wn = rng.int(2, n - 1);
  const wingPlan = (g) => corridorPlan([["*", flat(g, "E", ww - 2)]], [["*", flat(g, "F", ww - 2)]], 5);
  return withSideWing(rng, block, { w: ww, h: wh, storeys: wn, name: "Low wing", program: wingPlan(0), upper: (g) => wingPlan(g) });
}

// ---------- buildings at real size (issue #24) ----------
// realScale: every archetype's spec goes through here (makeSpec) in a world made since (an older save's do not:
// worldcfg.js legacyScale). The archetype's own plan stays what it is, made by its own dice for its own footprint (the
// plan's natural size, natW × natH; an older save's footprint); the building's footprint is its real size (data-
// buildingsize.js REAL_SIZE, realFoot: 1 m a cell), and its storeys its kind's:
//   - footprint: from SCALE.TILE × the plan's width or depth the plan is laid out in wings: nx × ny copies of it, each
//     at least the plan's own size (one more each way where they stay SCALE.SQUASH of it, whichever comes nearer),
//     a SCALE.CORRIDOR wide corridor between them (a hub: the doors join every wing to it), each copy turned left for
//     right by the dice; then the stretched rooms are split (splitUp, every wing alike) until the plan holds as many
//     rooms to the square metre of footprint as at its own size (planCount: carve's own cuts, no dice), and a room's
//     most containers × boxK the same way: rooms, containers and the dead keep today's density (tools/scaletest.js);
//   - row kinds (REAL_SIZE wings): "along" (a motel) side by side wall to wall, "back" (a church) deeper by its back strip;
//   - storeys: the kinds that grow in a city (REAL_SIZE city: offices, apartments, a hospital) roll their height from
//     the setting's range (a city's towers 6–10, a town's 2–4 or 3–6), plus the city crawl's depth bonus; the others
//     keep their own storeys within their row's range. A building taller than OPEN_STOREYS is built up to openStoreys
//     floors (spec.height: what it stands; spec.storeys: the floors built), its stairs up from the top one blocked;
//     from 6 storeys it has two stairwells;
//   - floors that differ: an office tower's floors between the lobby and the top are open plan, cubicles, meeting
//     rooms or a canteen floor by the floor (OFFICE_FLOORS);
//   - deadK: the floor area built over the plan's own (the dead in it go by it: placeInterior, at most BMAP.DEAD_CAP).
// A kind whose size another ticket owns (REAL_SIZE own: #22's groceries, #23's school) keeps its archetype's footprint;
// a spec with a shape of its own (#23's footprints: spec.shape) keeps its plan and is not laid out in wings.
// TILE: wings from this many times the plan's width or depth; SQUASH: a wing never narrower or shallower than this of the
// plan; BOX_MAX / BOX_MIN: a room's containers at most / at least this many times its own; TWINS: a room split into at
// most this many more.
export const SCALE = { TILE: 1.7, CORRIDOR: 2, TWO_STAIRS: 6, BOX_MAX: 4, BOX_MIN: 0.5, SQUASH: 0.8, TWINS: 3 };
// An office floor's plan by its kind (open plan, cubicles, meeting rooms, a canteen floor), for a floor fd deep in front.
const OFFICE_FLOORS = {
  open: (fd) => ({ split: "x", parts: [["*", { role: "office", name: "Open-plan office", hub: true, maxBoxes: 6 }], [4, { split: "y", parts: leaves([["*", { role: "storage", name: "Records", type: "office" }], [3, "restroom"]]) }]] }),
  cubicles: (fd) => corridorPlan([["*", { role: "office", name: "Cubicles" }], [4, "office"], ["*", { role: "office", name: "Cubicles" }]], [["*", "office"], [4, "breakroom"], [4, { role: "storage", name: "Records", type: "office" }], ["*", "office"]], fd),
  meeting: (fd) => corridorPlan([["*", { role: "office", name: "Meeting room" }], [5, { role: "office", name: "Meeting room" }], ["*", { role: "office", name: "Boardroom" }]], [["*", "office"], [4, "breakroom"], ["*", { role: "office", name: "Meeting room" }]], fd),
  canteen: () => ({ split: "y", parts: [["*", { role: "dining", name: "Canteen", type: "store", hub: true, maxBoxes: 4 }], [5, { split: "x", parts: leaves([["*", "kitchen"], [4, "breakroom"], [3, "restroom"]]) }]] }),
};
// A room split in two (realScale splitUp): its twin the same room, or for a few kinds the room that goes beside it (a
// kitchen's pantry, a gym's equipment store), so a stretched plan reads as one: not "Kitchen 1, Kitchen 2".
const TWIN_OF = { kitchen: { role: "pantry", type: "kitchen" }, gym: { role: "storage", name: "Equipment store", type: "lockers" }, dayroom: { role: "office" } };
function twinOf(leaf) {
  const t = TWIN_OF[leaf.role];
  if (!t || leaf.unit) return structuredClone(leaf);
  const out = { ...structuredClone(leaf), ...t };
  if (!t.name) delete out.name; // the role's own name
  delete out.civic; delete out.entry; delete out.hub; delete out.fry; delete out.pizza; // the original's own style and marks (the way in, the hub) stay with it
  return out;
}
const OFFICE_ORDER = ["cubicles", "open", "meeting", "cubicles", "open", "canteen"];
/** @param {any} rng @param {any} spec @param {string} key @param {{ setting?: string, storeyBonus?: number }} [o] */
// A shape at real size (issue #23 under #24's realScale): its parts' corners scaled by the real footprint over the
// plan's (never smaller; cap: a street's plot), so the walls two parts share stay shared and the notches and the
// courtyard grow with them; each part's stretched rooms split in two (twinUp, as realScale's splitUp splits a plan's)
// until it has about the rooms its own size would have here; boxK as for a plan (the containers to the square metre).
function shapeAtScale(rng, spec, key, out, cap) {
  const f = realFoot(rng, key);
  if (!f) return;
  let sx = Math.max(1, f.bw / spec.bw), sy = Math.max(1, f.bh / spec.bh);
  if (cap) { sx = Math.min(sx, Math.max(1, cap.w / spec.bw)); sy = Math.min(sy, Math.max(1, cap.h / spec.bh)); }
  if (sx <= 1 && sy <= 1) return;
  const X = (v) => Math.round(v * sx), Y = (v) => Math.round(v * sy);
  const parts = spec.shape.parts.map((p) => {
    const x0 = X(p.x), y0 = Y(p.y), q = { ...p, x: x0, y: y0, w: X(p.x + p.w - 1) - x0 + 1, h: Y(p.y + p.h - 1) - y0 + 1 };
    const tw = (prog) => twinUp(prog, p.w - 2, p.h - 2, q.w - 2, q.h - 2);
    q.program = tw(p.program);
    if (p.upper) q.upper = (g, r, ctx) => tw(p.upper(g, r, ctx));
    return q;
  });
  out.shape = { ...spec.shape, parts }; out.bw = X(spec.bw - 1) + 1; out.bh = Y(spec.bh - 1) + 1;
  const boxes = (list, k) => list.reduce((a, p) => a + planCount(p.program, p.w - 2, p.h - 2, k).boxes, 0);
  const want = (boxes(spec.shape.parts, 1) * out.bw * out.bh) / (spec.bw * spec.bh);
  let k = 1, got = boxes(parts, 1);
  const dir = got < want ? 1 : -1;
  for (let t = 1 + dir * 0.05; t <= SCALE.BOX_MAX + 1e-9 && t >= SCALE.BOX_MIN - 1e-9; t += dir * 0.05) {
    const g = boxes(parts, t);
    if (Math.abs(g - want) < Math.abs(got - want)) { k = t; got = g; }
    if (dir > 0 ? g >= want : g <= want) break;
  }
  out.boxK = Math.round(k * 100) / 100;
}
// A part's plan (natIw × natIh inside) laid over iw × ih: its stretched rooms (realScale's rule: no hub, no corridor,
// no entry, no room with a door of its own outside, unless it has a twin of its own kind) split in two in turn while
// that brings its rooms nearer what its own size would have here.
function twinUp(prog, natIw, natIh, iw, ih) {
  if (!prog || prog.role) return prog;
  const c = structuredClone(prog), cands = [];
  const stretchy = ([sz, ch]) => !!ch && !!ch.role && (typeof sz !== "number" || sz < 1) && !ch.ownDoor && ch.role !== "motelroom" && (!!TWIN_OF[ch.role] || (!ch.hub && !ch.entry && !(ROLES[ch.role] && ROLES[ch.role].hub)));
  const walk = (node) => { if (!node || node.role) return; const front = node.parts.some(([, ch]) => ch && ch.entry); for (const part of node.parts) { if (!front && stretchy(part)) cands.push([node, part]); walk(part[1]); } }; // never the entrance's row: its front desk and lobby keep their widths
  walk(c);
  const target = (planCount(prog, natIw, natIh).rooms * iw * ih) / Math.max(1, natIw * natIh);
  let now = planCount(c, iw, ih).rooms;
  for (let k = 0; now < target && cands.length && k < cands.length * SCALE.TWINS; k++) {
    const [node, part] = cands[k % cands.length], at = node.parts.indexOf(part);
    if (at < 0) continue;
    const was = node.parts.slice();
    node.parts[at] = ["*", part[1]];
    node.parts.splice(at + 1, 0, ["*", twinOf(part[1])]);
    const next = planCount(c, iw, ih).rooms;
    if (next <= now || Math.abs(next - target) > Math.abs(now - target)) { node.parts.splice(0, node.parts.length, ...was); if (next <= now) continue; break; }
    cands[k % cands.length] = [node, node.parts[at]];
    now = next;
  }
  return c;
}
export function realScale(rng, spec, key, o = {}) {
  const R = REAL_SIZE[key];
  if (!R || !spec) return spec;
  if (spec.real) return { ...spec, height: Math.max(1, spec.storeys || 1) }; // planned at its real size by its archetype (#25's military plans): as it is, every floor built
  const out = { ...spec, natW: spec.bw, natH: spec.bh, natStoreys: Math.max(1, spec.storeys || 1) };
  const bonus = o.storeyBonus || 0;
  // A plan drawn at its own size by its archetype (REAL_SIZE planned: #27's office buildings, a firm's corporate tower
  // with its floorKinds; #37's named warehouses, factories and labs): its footprint and plan as they are, its height its
  // own, only the floors the tall rule builds.
  if (spec.restorey && R.city) { // #27's firm-less tower: its plan redrawn at the setting's height (realStoreys: a city's towers up to MAX_STOREYS)
    const height = clampN((realStoreys(rng, key, o.setting) || out.natStoreys) + bonus, 1, MAX_STOREYS), re = spec.restorey(height);
    delete re.restorey;
    return { ...re, height, storeys: openStoreys(height, bonus) };
  }
  if (R.planned || spec.floorKinds || (spec.vid && spec.vid !== "general")) { // #37's named industrial plans (spec.vid): their own sizes (industrylayout.js INDUSTRY.SIZE)
    const height = out.natStoreys, built = openStoreys(height, bonus);
    return { ...spec, height, storeys: built };
  }
  // Storeys: the height it stands, the floors built.
  let height = out.natStoreys;
  if (R.city) height = clampN((realStoreys(rng, key, o.setting) || height) + bonus, 1, MAX_STOREYS);
  else { const r = storeyRange(key, o.setting); if (r) height = clampN(height, r[0], r[1]); }
  const built = openStoreys(height, bonus);
  out.height = height; out.storeys = built;
  if (height >= SCALE.TWO_STAIRS) out.stairs = { ...(spec.stairs || {}), n: 2 };
  // The footprint, and the plan over it (realFoot; a kind with no size of its own here: the archetype's footprint and plan).
  if (spec.shape && !R.own && R.wings !== "along") shapeAtScale(rng, spec, key, out, o.cap || null); // a shape's parts scaled (issue #23; a motel's rooms are its own size: its U is as long as its row)
  const foot = R.own || spec.shape ? null : realFoot(rng, key);
  const flips = Array.from({ length: 64 }, () => !R.wings && rng.chance(0.5)); // each wing turned left for right
  let lay = (prog) => prog, fill = (prog) => prog;
  if (foot) {
    out.bw = foot.bw; out.bh = foot.bh;
    const iw = foot.bw - 2, ih = foot.bh - 2, natIw = spec.bw - 2, natIh = spec.bh - 2, ratio = (foot.bw * foot.bh) / (spec.bw * spec.bh); // by the footprint, walls and all (a small plan's walls are more of it)
    const C = R.wings === "along" ? 0 : SCALE.CORRIDOR;
    const hasEntry = (n) => !!n && (n.role ? !!n.entry : n.parts.some((p) => hasEntry(p[1])));
    const mirror = (node) => (node && node.split === "x" ? { ...node, parts: node.parts.slice().reverse() } : node);
    const topNum = (n) => (!n ? 0 : n.role ? Number((/ (\d+)$/.exec(n.name || "") || [0, 0])[1]) : Math.max(0, ...n.parts.map((p) => topNum(p[1]))));
    const renum = (n, by) => { if (!n) return; if (n.role) { if (n.name && / \d+$/.test(n.name)) n.name = n.name.replace(/ (\d+)$/, (_, d) => ` ${Number(d) + by}`); return; } for (const p of n.parts) renum(p[1], by); };
    // The copy of a plan for wing k (k ≥ 1): "along" without the entry's part, its numbered rooms numbered on (Room 6…);
    // "back" only the plan's back strip (the last part of its front-to-back split).
    const copyOf = (prog, k) => {
      const c = structuredClone(prog);
      if (!k || !R.wings) return c;
      if (R.wings === "back") return c.split === "y" ? c.parts[c.parts.length - 1][1] : c;
      const kept = c.split === "x" ? { ...c, parts: c.parts.filter((p) => !hasEntry(p[1])) } : c;
      renum(kept, topNum(prog) * k);
      return kept;
    };
    // nx × ny wings of a plan, a corridor between them (along the front: wall to wall, a back corridor strip whole).
    const layOut = (nx, ny) => (prog) => {
      if (nx * ny <= 1) return prog;
      const tail = prog.split === "y" && prog.parts.length > 1 ? prog.parts[prog.parts.length - 1] : null;
      if (R.wings === "along" && tail && tail[1].role && ROLES[tail[1].role] && ROLES[tail[1].role].hub) {
        const head = prog.parts.length > 2 ? { split: "y", parts: prog.parts.slice(0, -1) } : prog.parts[0][1];
        return { split: "y", parts: [["*", layOut(nx, ny)(head)], tail] };
      }
      const corridor = () => [SCALE.CORRIDOR, { role: "corridor" }];
      const band = (j) => { const parts = []; for (let i = 0; i < nx; i++) { if (i && R.wings !== "along") parts.push(corridor()); const c = copyOf(prog, j * nx + i); parts.push(["*", flips[(j * nx + i) % flips.length] ? mirror(c) : c]); } return nx > 1 ? { split: "x", parts } : parts[0][1]; };
      const rows = []; for (let j = 0; j < ny; j++) { if (j) rows.push(corridor()); rows.push(["*", band(j)]); }
      return ny > 1 ? { split: "y", parts: rows } : rows[0][1];
    };
    // A plan's stretched rooms ("*" or a share; no hub, corridor, room with its own door outside, or entry, unless its twin
    // is another room: TWIN_OF, the hub and the entry staying with the original) split in two one
    // at a time, every wing alike, while that brings the plan laid out nearer the rooms its own size would have over
    // this floor (planCount: carve's own sizes, no dice).
    const splitUp = (prog, L) => {
      const c = structuredClone(prog), cands = []; // [the split node, the part itself]
      const stretchy = ([sz, ch]) => !!ch && !!ch.role && (typeof sz !== "number" || sz < 1) && ch.role !== spec.unitDoors && (!!TWIN_OF[ch.role] || (!ch.hub && !ch.entry && !(ROLES[ch.role] && ROLES[ch.role].hub))); // a motel room: a twin behind it would have no door
      const walk = (node) => { if (!node || node.role) return; for (const part of node.parts) { if (stretchy(part)) cands.push([node, part]); walk(part[1]); } };
      walk(c);
      const target = planCount(prog, natIw, natIh).rooms * ratio;
      let now = planCount(L(c), iw, ih).rooms;
      for (let k = 0; now < target && cands.length && k < cands.length * SCALE.TWINS; k++) { // round the candidates again while more are wanted
        const [node, part] = cands[k % cands.length], at = node.parts.indexOf(part);
        if (at < 0) continue;
        const was = node.parts.slice();
        node.parts[at] = ["*", part[1]];
        node.parts.splice(at + 1, 0, ["*", twinOf(part[1])]);
        const next = planCount(L(c), iw, ih).rooms;
        if (next <= now || Math.abs(next - target) > Math.abs(now - target)) { node.parts.splice(0, node.parts.length, ...was); if (next <= now) continue; break; } // no gain, or past the mark by more than short of it
        cands[k % cands.length] = [node, node.parts[at]];
        now = next;
      }
      return { prog: c, rooms: now, target };
    };
    // How many wings: as many as fit at the plan's own size, or one more each way where the wings stay at least
    // SCALE.SQUASH of it; the choice whose plan, rooms split, comes nearest the rooms its own size would have here.
    const fits = (n0, n1) => (n1 >= n0 * SCALE.TILE ? Math.max(1, Math.floor((n1 + C) / (n0 + C))) : 1);
    let ox = R.wings === "back" ? [1] : [fits(natIw, iw)], oy = R.wings === "along" ? [1] : [fits(natIh, ih)];
    const room = (n0, n1, k) => (n1 - (k - 1) * C) / k >= n0 * SCALE.SQUASH;
    if (R.wings !== "back" && room(natIw, iw, ox[0] + 1) && iw >= natIw * SCALE.TILE) ox.push(ox[0] + 1);
    if (R.wings !== "along" && room(natIh, ih, oy[0] + 1) && ih >= natIh * SCALE.TILE) oy.push(oy[0] + 1);
    const P = spec.program;
    if (R.wings === "along" && P.split === "x") { // the copies after the first are the plan's parts without the entry's (a motel's rooms): as many as fill the front
      const unitsW = P.parts.filter((p) => !hasEntry(p[1])).reduce((a, p) => a + (typeof p[0] === "number" && p[0] >= 1 ? p[0] : 4) + 1, 0);
      ox = [1 + Math.max(0, Math.round((foot.bw - spec.bw) / Math.max(1, unitsW)))];
    }
    const strip = P.split === "y" && P.parts.length > 1 ? P.parts[P.parts.length - 1] : null;
    if (R.wings === "back" && strip && typeof strip[0] === "number") { // deeper by back strips while the rest keeps its depth: any number of them
      oy = []; for (let k = 1; k <= 1 + Math.floor((foot.bh - spec.bh) / (strip[0] + C)); k++) oy.push(k);
    }
    let best = null;
    for (const nx of ox) for (const ny of oy) {
      const L = layOut(nx, ny), r = splitUp(P, L), miss = Math.abs(r.rooms - r.target) / Math.max(1, r.target);
      if (!best || miss < best.miss - 1e-9) best = { nx, ny, L, miss };
    }
    lay = best.L;
    fill = (prog) => lay(splitUp(prog, lay).prog);
    out.wings = best.nx * best.ny;
  } else out.wings = 1;
  out.program = fill(spec.program);
  const up = spec.upper, offices = key === "offices";
  if (built > 1 && (up || offices || out.wings > 1 || foot)) out.upper = (f, r, ctx) => {
    const nat = { ...(ctx || {}), bw: spec.bw, bh: spec.bh };
    if (offices && !(ctx && ctx.top)) return fill(OFFICE_FLOORS[OFFICE_ORDER[(f - 1) % OFFICE_ORDER.length]](Math.max(3, Math.floor((spec.bh - 3) / 2))));
    return fill(up ? up(f, r, nat) : spec.program);
  };
  // A room's most containers × boxK (assemble boxCap): the step nearest as many containers to the square metre as the
  // plan at its own size.
  if (foot) {
    const want = planCount(spec.program, spec.bw - 2, spec.bh - 2).boxes * (foot.bw * foot.bh) / (spec.bw * spec.bh);
    let k = 1, got = planCount(out.program, foot.bw - 2, foot.bh - 2, 1).boxes;
    const dir = got < want ? 1 : -1; // more to a room, or (a plan laid out in many wings) fewer
    for (let t = 1 + dir * 0.05; t <= SCALE.BOX_MAX + 1e-9 && t >= SCALE.BOX_MIN - 1e-9; t += dir * 0.05) {
      const g = planCount(out.program, foot.bw - 2, foot.bh - 2, t).boxes;
      if (Math.abs(g - want) < Math.abs(got - want)) { k = t; got = g; }
      if (dir > 0 ? g >= want : g <= want) break;
    }
    out.boxK = Math.round(k * 100) / 100;
  }
  out.deadK = (out.bw * out.bh * built) / (spec.bw * spec.bh * out.natStoreys);
  return out;
}

// How much more floor a site's buildings have at real size than their plans had (the mean of realScale's deadK over a
// few samples of each, by the site's setting; 1 in an older save, or a site with no buildings): the other groups'
// abstract raids go by it (aiscav.js, docs/adr/0001-ai-parity.md): a site holds this many times what it did, stripped
// no faster an hour.
const sizeKCache = new Map();
export function siteSizeK(state, tile) {
  if (!tile || legacyScale(state)) return 1;
  const sb = siteBuildings(tile);
  if (!sb || !sb.options.length) return 1;
  const setting = settingOf(tile);
  let sum = 0;
  for (const o of sb.options) {
    const ck = `${o.key}|${setting}`;
    let k = sizeKCache.get(ck);
    if (k == null) {
      k = 0;
      for (let i = 0; i < 6; i++) { const r = new Rng(4409 + i * 7919); const sp = realScale(r, BUILDINGS[o.key].make(r, {}), o.key, { setting }); k += sp.deadK || 1; }
      k /= 6;
      sizeKCache.set(ck, k);
    }
    sum += k;
  }
  return Math.max(1, sum / sb.options.length);
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
  lab:         { name: "Lab building", make: (r, o = {}) => (o.legacy ? institution(r, "lab") : industryPlan("lab", r, o, () => institution(r, "lab"))) }, // a dozen plans (industrylayout.js, issue #37); an older save today's
  barracks:    { name: "Barracks", make: (r, o) => institution(r, "barracks", o) },
  armorybldg:  { name: "Armory", make: (r, o) => institution(r, "armorybldg", o) },
  cellblock:   { name: "Cell block", make: (r, o) => institution(r, "cellblock", o) },
  messhall:    { name: "Mess hall", make: (r, o) => institution(r, "messhall", o) },
  control:     { name: "Control building", make: (r, o) => institution(r, "control", o) },
  radio:       { name: "Transmitter hut", make: (r, o) => institution(r, "radio", o) },
  terminal:    { name: "Terminal", make: (r, o) => institution(r, "terminal", o) },
  firestation: { name: "Fire station", make: (r, o) => institution(r, "firestation", o) },
  // Military bases, air bases and airports (issue #25: militarylayout.js), new with it (no older plan).
  hq:          { name: "Headquarters", make: (r, o) => milPlan(r, "hq", o) },
  aidstation:  { name: "Aid station", make: (r, o) => milPlan(r, "aidstation", o) },
  gatehouse:   { name: "Gatehouse", make: (r, o) => milPlan(r, "gatehouse", o) },
  tower:       { name: "Control tower", make: (r, o) => milPlan(r, "tower", o) },
  flightops:   { name: "Flight operations", make: (r, o) => milPlan(r, "flightops", o) },
  warehouse:   { name: "Warehouse", make: (r, o = {}) => (o.legacy || o.site === "military" ? openfloor(r, "warehouse", o) : industryPlan("warehouse", r, o, () => openfloor(r, "warehouse", o))) }, // a dozen plans (industrylayout.js, issue #37); a base's supply warehouse #25's; an older save today's
  factory:     { name: "Factory", make: (r, o = {}) => (o.legacy ? openfloor(r, "factory") : industryPlan("factory", r, o, () => openfloor(r, "factory"))) }, // a dozen plans (industrylayout.js, issue #37)
  hangar:      { name: "Hangar", make: (r, o) => openfloor(r, "hangar", o) },
  motorpool:   { name: "Motor pool", make: (r, o) => openfloor(r, "motorpool", o) },
  autoshop:    { name: "Auto shop", make: (r, o) => openfloor(r, "autoshop", o) },
  garage:      { name: "Garage", make: (r, o) => openfloor(r, "garage", o) },
  workshop:    { name: "Workshop", make: (r, o) => openfloor(r, "workshop", o) },
  machineshed: { name: "Machine shed", make: (r) => openfloor(r, "machineshed") },
  barn:        { name: "Barn", make: (r) => openfloor(r, "barn") },
  church:      { name: "Church", make: (r, o) => church(r, o) },
  motel:       { name: "Motel", make: (r, o) => motel(r, o) },
  apartments:  { name: "Apartment block", make: (r, o) => apartments(r, o) },
  hotel:       { name: "Hotel", make: (r, o) => hotel(r, o) },
  // The office buildings of every kind (issue #27: officeplans.js, their firms' plans; the tower is "offices" above).
  storefront:  { name: "Storefront office", make: (r, o) => OFFICE_PLANS.storefront(r, o || {}, planOf("storefront", o), MAX_STOREYS) },
  bizpark:     { name: "Business park offices", make: (r, o) => OFFICE_PLANS.bizpark(r, o || {}, planOf("bizpark", o), MAX_STOREYS) },
  cityhall:    { name: "City hall", make: (r, o) => OFFICE_PLANS.cityhall(r, o || {}, planOf("cityhall", o), MAX_STOREYS) },
  courthouse:  { name: "Courthouse", make: (r, o) => OFFICE_PLANS.courthouse(r, o || {}, planOf("courthouse", o), MAX_STOREYS) },
  callcenter:  { name: "Call center", make: (r, o) => OFFICE_PLANS.callcenter(r, o || {}, planOf("callcenter", o), MAX_STOREYS) },
  techoffice:  { name: "Tech office", make: (r, o) => OFFICE_PLANS.techoffice(r, o || {}, planOf("techoffice", o), MAX_STOREYS) },
  station:     { name: "News station", make: (r, o) => OFFICE_PLANS.station(r, o || {}, planOf("station", o), MAX_STOREYS) },
  // A street of houses (the neighbourhood point of interest): buildingMap builds it with streetMap; make gives one of
  // its houses (the hint, the archetype tests).
  neighbourhood: { name: "Neighbourhood", make: (r, o) => house(r, "house", o), street: true },
  // A prison and a county jail (issue #31): buildingMap builds a complex of buildings (prison.js prisonMap); make gives
  // one of its buildings (the hint, the archetype tests): the chow hall.
  prison: { name: "State prison", make: (r) => chowHall(r), complex: true },
  jail:   { name: "County jail", make: (r) => chowHall(r), complex: true },
  // A college campus (issue #28, campus.js campusMap): many buildings on one map round quads and courtyards; make gives
  // one of its residence halls (the hint, the archetype tests). The campus's buildings, each a raid of its own too
  // (setup.raid.place): campuslayout.js's plans, the chapel the church's, the health centre the clinic's.
  campus: { name: "Campus", make: (r, o) => CAMPUS_PLANS.dorm(r, o), street: true, campus: true },
  ...Object.fromEntries(Object.entries(CAMPUS_PLANS).map(([k, make]) => [k, { name: CAMPUS_NAMES[k], make: (r, o) => make(r, o) }])),
  chapel: { name: "Chapel", make: (r, o) => church(r, o) },
  healthcentre: { name: "Health centre", make: (r, o = {}) => (o.legacy || !r.chance(0.6) ? institution(r, "clinic", o) : institution(r, "infirmary", { ...o, plan: o.plan || "campus" })) }, // #36's college health centre (civicvariants.js infirmary "campus") 60% of the time, else one of its clinic plans; the chapel (church above) takes #36's church plans
  // Bunkers (issue #26, bunkerlayout.js): the military command bunker (a rare military site), Crashlanding's mountain
  // bunker (the same plan, always three levels deep), the government bunker, the fallout shelter and the prepper's.
  milbunker:      { name: "Military command bunker", make: (r, o) => BUNKER_PLANS.milbunker(r, o) },
  mountainbunker: { name: "Mountain bunker", make: (r) => BUNKER_PLANS.milbunker(r, { levels: 3 }) },
  govbunker:      { name: "Government bunker", make: (r, o) => BUNKER_PLANS.govbunker(r, o) },
  shelter:        { name: "Fallout shelter", make: (r, o) => BUNKER_PLANS.shelter(r, o) },
  prepper:        { name: "Prepper bunker", make: (r, o) => BUNKER_PLANS.prepper(r, o) },
};
// The storeys a type can have, [min, max] (the city crawl's bonus can add to offices and apartments, up to MAX_STOREYS).
export const STOREYS_BY_TYPE = {
  house: [2, 2], farmhouse: [2, 2], cabin: [1, 1], lodge: [2, 2], ranger: [1, 1],
  grocery: [1, 2], corner: [1, 2], pharmacy: [1, 2], gunstore: [1, 2], pawnshop: [1, 2], hardware: [1, 2], feedstore: [1, 2], diner: [1, 1], gasstation: [1, 2], truckstop: [1, 2], // issue #35: a variant's flat, offices or stockroom above (shopvariants.js)
  supermarket: [1, 2], deptstore: [1, 2],
  clinic: [1, 3], infirmary: [1, 3], hospital: [1, 7], police: [1, 5], school: [2, 3], offices: [3, MAX_STOREYS], lab: [1, 3], barracks: [1, 3], armorybldg: [1, 1],
  cellblock: [1, 2], messhall: [1, 2], control: [1, 4], radio: [1, 1], terminal: [1, 3], firestation: [1, 3], // issue #25: a new save's cell block two tiers, its mess hall one storey
  hq: [1, 3], aidstation: [1, 1], gatehouse: [1, 1], tower: [2, 6], flightops: [1, 2], // issue #25's dozen plans a type (milplans.js): a company orderly room of one storey, a staff college of three, towers of 2–6
  warehouse: [1, 3], factory: [1, 3], hangar: [1, 1], motorpool: [1, 1], autoshop: [1, 2], garage: [1, 2], workshop: [1, 2], machineshed: [1, 1], barn: [1, 1],
  church: [1, 2], motel: [2, 2], apartments: [3, 6], neighbourhood: [2, 2], prison: [1, 2], jail: [1, 2], hotel: [2, 10], // a hotel: an inn 2–3, a resort 2–4, a business hotel 4–6, a tower 8–10 (within MAX_STOREYS)
  // the shops and services of data-shops.js (a franchise's plan can add a flat above or more floors)
  sportshop: [1, 2], electronics: [1, 2], radioshop: [1, 2], bookstore: [1, 2], petstore: [1, 2], garden: [1, 2], clothing: [1, 2], liquor: [1, 2],
  restaurant: [1, 2], bar: [1, 2], dealer: [1, 2], bank: [1, 3], library: [1, 8], vet: [1, 2], pizza: [1, 1],
  // a college campus's buildings (issue #28: campuslayout.js CAMPUS_SIZE; a state university's dorms up to 8)
  dorm: [2, 8], lecturehall: [1, 4], sciencehall: [1, 6], univlibrary: [1, 8], studentunion: [1, 4], dininghall: [1, 2], athletics: [1, 2],
  admin: [1, 6], security: [1, 2], maintenance: [1, 2], theatre: [1, 3], parkgarage: [2, 6], chapel: [1, 2], healthcentre: [1, 3], campus: [2, 8],
  milbunker: [2, 3], mountainbunker: [3, 3], govbunker: [2, 3], shelter: [2, 2], prepper: [2, 3], // bunkers: the Entrance level and the levels below it (bunkerlayout.js)
  // the office buildings (issue #27; officeplans.js SIZE, the crawl's bonus for the city's kinds)
  storefront: [1, 2], bizpark: [1, 3], cityhall: [1, 3], courthouse: [1, 3], callcenter: [1, 2], techoffice: [1, 5], station: [1, 3],
};

// Which buildings stand at a site, by location type (or the terrain, for open land): a list of building keys (or
// [key, name]); one entry opens straight into it (single: true), more (or multi: true) are a choice before the raid,
// with the street map as one more choice. Missing (campgrounds, crash sites, water): the street map only.
export const SITES = {
  // One building.
  pharmacy: ["pharmacy"], gunstore: ["gunstore"], pawnshop: ["pawnshop"], hardware: ["hardware"], grocery: ["grocery"], diner: ["diner"], supermarket: ["supermarket"],
  police: ["police"], clinic: ["clinic"], hospital: ["hospital"], school: ["school"], office: ["offices"], firestation: ["firestation"],
  church: ["church"], motel: ["motel"], hotel: ["hotel"], apartments: ["apartments"], autoshop: ["autoshop"], feedstore: ["feedstore"], cabin: ["cabin"],
  lodge: ["lodge"], ranger: ["ranger"], radiotower: ["radio"], barn: ["barn"], truckstop: ["truckstop"], gas: ["gasstation"], quarry: ["workshop"],
  // A choice of buildings.
  town: ["house", "corner", "garage", "pharmacy", ["house", "House on the corner"]], city: ["grocery", "pharmacy", "offices", "apartments", "warehouse"],
  farm: ["farmhouse", "barn"], ranch: ["farmhouse", "barn", "machineshed"], mall: ["deptstore", "pharmacy", ["diner", "Food court"], ["warehouse", "Mall stockrooms"]],
  // Issue #25: a base's HQ, mess hall, aid station and gatehouse after its first four (their ids as they were); the
  // air base (a site of its own, near the bases); an airport's control tower and fire station.
  military: ["barracks", "armorybldg", "motorpool", ["warehouse", "Supply warehouse"], "hq", "messhall", "aidstation", "gatehouse"], prison: ["cellblock", "messhall", ["armorybldg", "Guard armory"], "infirmary"],
  airbase: ["hangar", ["hangar", "Second hangar"], "tower", "flightops", "barracks", "messhall"],
  univ: ["campus"], college: ["campus"], airport: ["hangar", "terminal", ["warehouse", "Cargo warehouse"], "tower", "firestation"], factory: ["factory", "offices"],
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
  jail: ["jail"], // a county jail (issue #31, pois.js jailExtra): its complex (prison.js)
  // Bunkers (issue #26): Crashlanding's mountain bunker, the military bunker and the government bunker (sites), the
  // fallout shelter and the prepper's bunker (points of interest).
  bunker_mil: ["mountainbunker"], bunker: ["milbunker"], govbunker: ["govbunker"], shelter: ["shelter"], prepper: ["prepper"],
  // the office buildings (data-offices.js, issue #27): one building each
  storefront: ["storefront"], bizpark: ["bizpark"], cityhall: ["cityhall"], courthouse: ["courthouse"], callcenter: ["callcenter"], techoffice: ["techoffice"], station: ["station"],
  // Open land (no site).
  suburb: ["house", ["house", "House across the street"], "garage"], plains: ["farmhouse", "barn"],
  forest: { multi: true, list: ["cabin"] }, hills: { multi: true, list: ["cabin"] }, mountain: { multi: true, list: ["cabin"] },
};

// The sites that are one complex of buildings in a new save (issue #31, prison.js): a prison, a county jail (a POI).
// An older save (worldcfg.js legacyPrisons) keeps SITES' pick of one building for a prison.
export const COMPLEX_SITES = { prison: ["prison"], jail: ["jail"] };
const siteEntry = (type, state) => (COMPLEX_SITES[type] && !legacyPrisons(state) ? COMPLEX_SITES[type] : SITES[type]);
// A university or a college is a campus (issue #28: campus.js); one whose buildings an older save's raids already went
// into (its site's ledger holds their maps: campus.js campusLegacy) keeps the choice of buildings it had.
export const SITES_LEGACY = { univ: ["lab", "offices", ["messhall", "Cafeteria"]] };
// The buildings at a tile: { single, options: [{ id, key, name }] } or null (the street map only).
const INDUSTRIAL = new Set(INDUSTRY_KEYS); // a warehouse, a factory, a lab: their plan by their setting (issue #37)
// The buildings at a tile: { single, options: [{ id, key, name }] } or null (the street map only). state: the run (an
// older save's prison is its pick of buildings; with no state a prison is the complex).
export function siteBuildings(tile, state = null) {
  if (!tile) return null;
  const old = tile.loc && SITES_LEGACY[tile.loc.type] && campusLegacy(tile) ? SITES_LEGACY[tile.loc.type] : null;
  const entry = old || (tile.loc && siteEntry(tile.loc.type, state)) || (!tile.loc && SITES[tile.terrain]) || null;
  if (!entry) return null;
  const sl = milSiteOf(tile); // a military base's, an air base's or an airport's layout (milplans.js MIL_SITES, issue #25): its core as it was, its own buildings after
  const list = sl ? [...(Array.isArray(entry) ? entry : entry.list).slice(0, MIL_SITES[tile.loc.type].core), ...sl.extra] : Array.isArray(entry) ? entry : entry.list;
  const seen = {};
  // shops.js: a single-building site's franchise (its site POI's v; a site POI saved before franchises: none) lays its building out
  const top = tile.loc && Array.isArray(tile.pois) && tile.pois[0] && tile.pois[0].site ? tile.pois[0] : null;
  const fr = top && top.v && list.length === 1 ? { variant: top.v, kind: tile.loc.type } : null;
  const options = list.map((e) => {
    const [key, name] = Array.isArray(e) ? e : [e, null];
    const n = (seen[key] = (seen[key] || 0) + 1);
    return { id: n > 1 ? `${key}:${n}` : key, key, name: name || BUILDINGS[key].name, ...(fr || {}), ...(tile.loc ? { site: tile.loc.type } : INDUSTRIAL.has(key) ? { site: tile.terrain } : {}), ...(sl ? { sv: sl.id } : {}) }; // site: the place's type (issue #25: an air base's hangar, a base's warehouse; issue #37: an industrial building's setting, industrylayout.js settingOf, the terrain where there is no place)
  });
  return { single: !entry.multi && options.length === 1, options };
}

// The building a raid explores (combat.js createRaid): setup.raid.building (an option id, or "street"), else a
// single-building site's own; null for the street map.
export function raidBuilding(state, tile, setup) {
  if (setup && setup.raid && setup.raid.place) return setup.raid.place; // a city crawl's place ({ id, key, name }, citycrawl.js)
  const sb = siteBuildings(tile, state);
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
  const sb = siteBuildings(tile, state);
  if (!sb || sb.single) return null;
  const [bw, bh] = buildingTarget(tile, false, state), [sw, sh] = raidDims(tile, state);
  // An industrial building by its plan's name (industrylayout.js: "Cold-storage warehouse"), where the site has not named it.
  const named = (o) => (state && INDUSTRIAL.has(o.key) && o.name === BUILDINGS[o.key].name && tile.id != null ? { name: buildingSpec(state, tile.id, o).vname || o.name } : {});
  const out = sb.options.map((o) => ({ ...o, ...buildingHint(o.key), map: `${bw} × ${bh}+`, ...named(o) }));
  out.push({ id: "street", key: "street", name: "The street", hint: "Search the area around the buildings: small buildings, cars, the open ground (the usual raid map).", size: "", rooms: 0, map: `${sw} × ${sh}` });
  return out;
}

// What a kind of building likely holds (from a sample plan, cached): { hint, size, rooms, holds: [AREAS types], sig: [{ name, n }] }.
const hintCache = new Map();
export function buildingHint(key) {
  let h = hintCache.get(key);
  if (h) return h;
  const sr = new Rng(7919), spec = realScale(sr, BUILDINGS[key].make(sr), key, { setting: REAL_SIZE[key] ? REAL_SIZE[key].set : "town" }); // at real size (issue #24)
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
  h = { hint: `Likely: ${sup.join(", ")}${gear ? ", maybe gear" : ""}. Rooms: ${named.join(", ")}.`, size: cells < 200 ? "small" : cells < 800 ? "medium" : "large", rooms: plan.rooms.filter((r) => !r.outdoor).length, holds: [...new Set(types)], sig };
  hintCache.set(key, h);
  return h;
}

// The map for a raid on a building: the site's own layout (its dice from the world seed, the tile and the building).
// option.storeyBonus: extra storeys (the city crawl's deeper blocks, offices and apartments).
const specSeed = (state, tileId, option) => Math.floor(hash01(state.seed, "bmap", tileId, option.id) * 4294967296);
// scale: the real-size step (realScale: { setting }); null for an older save's buildings (worldcfg.js legacyScale: the
// archetype's own footprint and storeys, as they were).
const makeSpec = (rng, option, legacy = false, scale = null, officesOld = false, where = null, shapes = false, vset = null) => { // vset: a shop's or a service's variant by its setting (shopvariants.js variantSetting, issue #35; its plan by id: option.plan) // shapes: footprint shapes (a save from since issue #23: worldcfg.js legacyShapes) // where: siteWhere's setting and site (civicvariants.js, issue #36) // officesOld: an older save's firm-less office tower as it was (worldcfg.js legacyOffices, #27) // variant, kind: the place's franchise and kind (data-shops.js plans); legacy: an older save's plan (worldcfg.js legacyRooms: an apartment's flats one room each)
  const spec = BUILDINGS[option.key].make(rng, { storeyBonus: option.storeyBonus || 0, variant: option.variant || null, kind: option.kind || null, legacy: legacy && !NEW_KEYS.has(option.key), shapes, ...(where || {}), site: option.site || (where && where.site) || null, ...(officesOld ? { officesLegacy: true } : {}), ...(option.plan != null ? { plan: option.plan } : {}), vset: option.vset || vset }); // plan: one of the kind's named plans (bunkerlayout.js BUNKER_VARIANTS: a city hall's shelter, #27; industrylayout.js INDUSTRY_PLANS, #37)
  return scale ? realScale(rng, spec, option.key, { ...scale, storeyBonus: option.storeyBonus || 0 }) : spec;
};
// The archetypes issue #25 added (no older plan): laid out the new way in an older save too.
const NEW_KEYS = new Set(["hq", "aidstation", "gatehouse", "tower", "flightops", "hotel"]); // hotel: issue #29, no older save had one
// The setting a site's buildings stand in (data-buildingsize.js REAL_SIZE city: a city's towers): "city" on a city's
// tile (its crawl too) or a site-less city tile, "town" on a town's, else "rural".
export function settingOf(tile) {
  if (!tile) return "town";
  const t = tile.loc ? tile.loc.type : null;
  return t === "city" || (!tile.loc && tile.terrain === "city") ? "city" : t === "town" || (!tile.loc && tile.terrain === "suburb") ? "town" : "rural";
}
// Where a building stands, for the kinds with a dozen plans (civicvariants.js pickVariant, issue #36): the setting with
// its suburbs (shops.js settingOf: city, suburb or town; else this module's settingOf: a town's or a city's own tile,
// else rural) and the site's type (a prison's infirmary: siteBuildings' option.site where it has one).
export function siteWhere(state, tileId) {
  const t = state && state.tiles ? state.tiles[tileId] : null;
  if (!t) return null;
  return { setting: shopSetting(state, t) || settingOf(t), site: t.loc ? t.loc.type : null };
}
const scaleOf = (state, tileId) => (legacyScale(state) ? null : { setting: settingOf(state.tiles[tileId]) });
// The archetype's spec for a building at a site (its storeys and footprint) without building the map: the same dice
// buildingMap rolls, so the block card can say how many storeys a place has.
export function buildingSpec(state, tileId, option) {
  return makeSpec(new Rng(specSeed(state, tileId, option)), option, legacyRooms(state), scaleOf(state, tileId), legacyOffices(state), siteWhere(state, tileId), !legacyShapes(state), variantSetting(state.tiles[tileId]));
}
export function buildingMap(state, tileId, option, withVehicle) {
  if (BUILDINGS[option.key] && BUILDINGS[option.key].complex) { const m = prisonMap(state, tileId, option, withVehicle, { legacy: legacyRooms(state) }); rollScenes(m, sceneRng(state, tileId, option), option.key, option.scenes || null); postBodies(m); return m; } // a prison's or a jail's complex (prison.js); its scenes (prisonlayout.js) over all its buildings
  if (BUILDINGS[option.key] && BUILDINGS[option.key].campus) return campusMap(state, tileId, option, withVehicle); // a college campus (campus.js: its buildings' scenes rolled in each)
  if (BUILDINGS[option.key] && BUILDINGS[option.key].street) { const m = streetMap(state, tileId, option, withVehicle); rollScenes(m, sceneRng(state, tileId, option), option.key); return m; } // a street of houses (the neighbourhood); its scenes (interiorscenes.js) through the houses
  const rng = new Rng(specSeed(state, tileId, option));
  const spec = makeSpec(rng, option, legacyRooms(state), scaleOf(state, tileId), legacyOffices(state), siteWhere(state, tileId), !legacyShapes(state), variantSetting(state.tiles[tileId]));
  // battlesize.js: at least the site's raid map (more outside around a single-building site's plan, a city's or a
  // town's building the run's largest), the new ground topped up with cover. The floor plan itself is the archetype's.
  const tile = state.tiles[tileId], sb = siteBuildings(tile, state);
  const target = buildingTarget(tile, !!(sb && sb.single), state), cap = mapCap(option.key); // mapCap: a hotel's map at most 200 × 200
  if (spec.natW) { const nm = fitMargins(spec.natW, spec.natH, { ...BMAP.MARGIN, ...(spec.margins || {}) }, target, cap); spec.natMap = [spec.natW + nm.left + nm.right, spec.natH + nm.front + nm.back]; } // the map its plan would have had at its own size: the dead go by it (placeInterior)
  spec.margins = fitMargins(spec.bw, spec.bh, { ...BMAP.MARGIN, ...(spec.margins || {}) }, target, cap);
  if (option.sv && !legacyRooms(state)) spec.sl = milSiteById(option.site, option.sv); // the site's layout: its perimeter, towers, gate and runway (milplans.js MIL_SITES; militarylayout.js militaryOutside)
  const map = assemble(rng, spec, { key: option.key, id: option.id, name: option.name, withVehicle, legacy: legacyRooms(state) && !NEW_KEYS.has(option.key) });
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
  REAL_BW: [10, 16], REAL_BH: 13, // a world made since buildings at real size (data-buildingsize.js): the houses' own sizes, two rows in 40 cells
  CARS: [1, 3],     // cars parked along the kerb (searchable)
  TREES: [3, 6], BINS: [1, 3],
  DEAD: 1.0,        // the dead: the site's roster × this
};
// How many houses stand on a neighbourhood's street (option: the POI's place, poiraid.js poiPlace: id "poi<i>:neighbourhood").
export function streetHouses(state, tileId, option) {
  const [lo, hi] = STREET.HOUSES;
  return lo + Math.min(hi - lo, Math.floor(hash01(state.seed, "streethouses", tileId, option.id) * (hi - lo + 1)));
}
export function streetMap(state, tileId, option, withVehicle) {
  const S = STREET, legacy = legacyRaids(state);
  // The run's largest raid map (World… Raid map, largest): a neighbourhood's street fills it, as a city's or a town's map
  // does. An older save (worldcfg.js legacyRaids): as it always was, at most Extra-large wide, at least Medium.
  const [MAXW, MAXH] = legacy ? [SIZE_CLASSES.XL.w, SIZE_CLASSES.M.h] : raidMaxDims(state);
  const tile = state.tiles[tileId];
  const rng = new Rng(specSeed(state, tileId, option)); // the street's own dice: the layout of the yards, the cars, the trees
  const n = streetHouses(state, tileId, option);
  const perRow = [Math.ceil(n / 2), n - Math.ceil(n / 2)];
  const no0 = 2 + 2 * Math.floor(hash01(state.seed, "streetno", tileId, option.id) * 30); // street numbers: even to the north, odd to the south
  // The houses: each its own plan from its own dice (assemble with a ring of one cell outside: the street's ground replaces it).
  const houses = [];
  for (let k = 0; k < n; k++) {
    const row = k < perRow[0] ? 0 : 1, col = row ? k - perRow[0] : k;
    const id = `${option.id}#${k + 1}`;
    const hr = new Rng(specSeed(state, tileId, { id }));
    const real = !legacyScale(state); // a world made since buildings at real size (issue #24): its houses 10–16 m wide, up to 13 deep
    const BW = real ? S.REAL_BW : S.BW, BH = real ? S.REAL_BH : S.BH;
    const plotW = Math.max(BW[0], Math.min(BW[1], Math.floor((MAXW - 2 * S.SIDE - (perRow[row] - 1) * S.GAP) / perRow[row])));
    const spec0 = BUILDINGS.house.make(hr, { legacy: legacyRooms(state), shapes: !legacyShapes(state), cap: { w: plotW, h: BH } }), spec = real ? realScale(hr, spec0, "neighbourhood", { setting: "town", cap: { w: plotW, h: BH } }) : spec0; // a new save's house shaped to fit its plot (houseShape; realScale grows a shape to its plot at most)
    if (!spec.shape) { spec.bw = Math.max(BW[0], Math.min(spec.bw, plotW)); spec.bh = Math.min(spec.bh, BH); }
    spec.margins = { front: 1, back: 1, left: 1, right: 1 };
    spec.ground = "none";
    const m = assemble(hr, spec, { key: "house", id, name: BUILDINGS.house.name, legacy: legacyRooms(state) });
    houses.push({ k, row, col, m, bw: spec.bw, bh: spec.bh, flip: row === 1, name: `No. ${no0 + 2 * col + row}`, x0: 0, y0: 0, rect: null });
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
  const groundF = (y) => (y === walkN || y === walkS ? "gravel" : y > walkN && y < walkS ? "road" : "grass");
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
    h.rect = { x0: h.x0, y0: h.y0, w: B.w, h: B.h, ...(B.parts ? { shape: B.shape, parts: B.parts.map((p) => ({ ...p, ...rectOf(p) })) } : {}) }; // a shaped house's parts, turned with it
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
    { x0: 0, y0: zy, w: 3, h: 3, side: "west", exit: "west", name: "West end of the street", vehicle: false },
    { x0: W - 3, y0: zy, w: 3, h: 3, side: "east", exit: "east", name: "East end of the street", vehicle: false },
  ];
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
  for (const r of [0, 1]) {
    const list = inRow(r);
    for (let j = 0; j + 1 < list.length; j++) {
      const a = list[j], b = list[j + 1], gx = Math.floor((a.x0 + a.bw + b.x0 - 1) / 2);
      const gate = r ? H - 1 - rng.int(0, S.BACK - 1) : rng.int(0, S.BACK - 1);
      if (r === 0) { for (let y = 0; y <= S.BACK + depth[0] - 3; y++) if (y !== gate) block(gx, y, "fence"); }
      else for (let y = H - 1; y >= topS + 2; y--) if (y !== gate) block(gx, y, "fence");
    }
  }
  // Trees in the yards, bins out the back.
  const yard = (x, y) => cells[I(x, y)].f === "grass";
  const backYard = (x, y) => yard(x, y) && (y < S.BACK || y >= H - S.BACK);
  const scatter = (k, want, test) => { let placed = 0; for (let t = 0; t < want * 12 && placed < want; t++) { const x = rng.int(0, W - 1), y = rng.int(0, H - 1); if (test(x, y) && block(x, y, k)) placed++; } };
  scatter("tree", rng.int(S.TREES[0], S.TREES[1]), yard);
  scatter("barrel", rng.int(S.BINS[0], S.BINS[1]), backYard);
  // Cover over the open yards (battlesize.js densify; never on the road, the sidewalks, a path or round a house).
  densify(cells, W, H, rng, { target: coverTarget(tile ? tile.terrain : "suburb"), keep: (x, y) => !!keep[I(x, y)] || !!reserved[I(x, y)] || cells[I(x, y)].f !== "grass", props: () => ["tree", "fence", "fence", "crate", "barrel", "tree"] });
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
    houses: houses.map((h) => ({ k: h.k, name: h.name, row: h.row, ...h.rect, front: h.front, rooms: areas.filter((a) => a.house === h.k).map((a) => a.id) })),
    tall: true, storeys, stairs: stairs.map((s) => s.slice()), runs: runs.map((r) => ({ ...r })),
    rooms: areas.filter((a) => !a.outdoor).map((a) => ({ id: a.id, f: a.f, name: a.name, role: a.role, type: a.type, x0: a.x0, y0: a.y0, w: a.w, h: a.h, locked: a.locked, up: a.up, hub: a.hub, entry: a.entry, house: a.house })),
    front: houses[0].front, exits: zoneExits(),
  };
  return { w: W, h: H, cells, rooms: areas, containers, zones, vehicle, exits: zoneExits(), front: houses[0].front, lockedDoors, plan, building: plan.building, buildings: plan.buildings, floors, stairs, runs, storeys, street: true };
}

// ======================================================================================
// Assembling a building's map
// ======================================================================================
// A split's part sizes along len cells (walls between them): fixed sizes, shares and "*" for the rest; null when they do not
// fit (assemble's carve drops the last part and tries again). No dice: realScale counts a plan's rooms with it.
function fitParts(parts, len) {
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
// What a plan carved over an iw × ih rectangle holds, as carve would cut it: { rooms (the labelled ones: no corridors or
// halls), boxes (each room's container target: its maxBoxes × boxK, else 4, against a box a 10 cells) }. No dice.
export function planCount(node, iw, ih, boxK = 1) {
  const out = { rooms: 0, boxes: 0 };
  const leaf = (n) => (n.role ? n : leaf(n.parts[0][1]));
  const add = (n, w, h) => {
    const r = { ...ROLES[n.role], ...n };
    if (r.label !== false) out.rooms++;
    if (r.type && AREAS[r.type]) out.boxes += Math.max(1, Math.min(Math.round((r.maxBoxes ?? 4) * boxK), Math.round((w * h) / 10)));
  };
  const go = (n, w, h) => {
    if (!n) return;
    if (n.role) return add(n, w, h);
    const len = n.split === "x" ? w : h;
    let parts = n.parts.slice(), sizes = fitParts(parts, len);
    while (!sizes && parts.length > 1) { parts = parts.slice(0, -1); sizes = fitParts(parts, len); }
    if (!sizes) return add(leaf(n), w, h);
    parts.forEach(([, ch], i) => (n.split === "x" ? go(ch, sizes[i], h) : go(ch, w, sizes[i])));
  };
  go(node, iw, ih);
  return out;
}
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
  const height = Math.max(storeys, typeof spec.height === "number" ? Math.min(MAX_STOREYS, Math.round(spec.height)) : storeys); // the storeys it stands (the floors above `storeys` are not built)
  // A footprint shape (issue #23, spec.shape): a union of rectangles (parts: { x, y, w, h } in the bounding box bw × bh,
  // walls included; where two meet they share a wall line), each with its own plan (program, and upper(g, rng, ctx)
  // for its floors up) and storeys (fewer than the building's: a lower roof, open air above it). None: the one
  // rectangle, as always (every older save's, and every archetype that gives no shape).
  const parts = spec.shape ? spec.shape.parts.map((p, k) => ({ ...p, k, x0: M.left + p.x, y0: M.back + p.y, x1: M.left + p.x + p.w - 1, y1: M.back + p.y + p.h - 1, n: Math.min(storeys, p.storeys || storeys) })) : null;
  const here = parts ? parts.filter((p) => p.n > f) : null; // the parts on this floor
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
  // A room's most containers (maxBoxes, 4 by default); a building at real size: × realScale's boxK.
  const boxCap = (room) => Math.round((room.maxBoxes ?? 4) * (spec.boxK || 1));
  if (here) {
    // Each part's walls and inside; a cell on any part's edge is wall (the shared wall where two parts meet). c.bp: the
    // part a cell belongs to (the tallest holding it, then the first: the shared wall stands with the taller part), on
    // every floor (ui/isoview.js: each part its own roof).
    const bp = new Int16Array(W * H).fill(-1);
    for (const p of here) for (let y = p.y0; y <= p.y1; y++) for (let x = p.x0; x <= p.x1; x++) {
      const i = I(x, y), edge = x === p.x0 || x === p.x1 || y === p.y0 || y === p.y1;
      if (edge || rid[i] !== -1) rid[i] = edge ? -1 : -3;
      if (bp[i] < 0 || parts[bp[i]].n < p.n) bp[i] = p.k;
    }
    for (let i = 0; i < W * H; i++) if (bp[i] >= 0) { const c = cells[i]; c.f = "floor"; c.k = rid[i] === -1 ? "wall" : "open"; c.bp = bp[i]; if (!upper && parts[bp[i]].n < storeys) c.bs = parts[bp[i]].n; } // bs: a lower part's storeys (its roof seen from above: ui/isoview.js)
  } else for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
    const edge = x === bx0 || x === bx1 || y === by0 || y === by1;
    const c = cells[I(x, y)];
    c.f = "floor"; c.k = edge ? "wall" : "open";
    rid[I(x, y)] = edge ? -1 : -3;
  }

  // ---------- the floor plan ----------
  const wallLine = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { cells[I(x, y)].k = "wall"; rid[I(x, y)] = -1; } };
  const fit = fitParts;
  const firstLeaf = (n) => (n.role ? n : firstLeaf(n.parts[0][1]));
  function carve(node, r) {
    if (node.role === "rock") { // solid rock (a bunker's footprint round its portal): the hillside's crag, no room
      for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) { cells[I(x, y)] = { k: "crag", f: G.yard, rock: true }; rid[I(x, y)] = -1; }
      return;
    }
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
    const room = { ...ROLES[rk], ...over, role: rk, id: rooms.length, ix0: r.x0, iy0: r.y0, iw: r.w, ih: r.h, doors: [], up: false, ...(carving ? { part: carving.k } : {}) };
    rooms.push(room);
    for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) { rid[I(x, y)] = room.id; cells[I(x, y)].k = "open"; cells[I(x, y)].fl = room.fl || "wood"; }
  }
  let carving = null; // the part being carved (a shape's), its rooms marked with it (room.part)
  if (here) for (const p of here) { carving = p; carve(upper ? opts._programs[p.k] : p.program, { x0: p.x0 + 1, y0: p.y0 + 1, w: p.w - 2, h: p.h - 2 }); }
  else carve(upper ? opts._program : spec.program, { x0: bx0 + 1, y0: by0 + 1, w: bw - 2, h: bh - 2 });
  carving = null;
  // The walls round the rock with no room beside them are rock too (bunkers: only the portal shows above).
  if (rooms.length && cells.some((c) => c.rock)) {
    const roomNear = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inside(x + dx, y + dy) && rid[I(x + dx, y + dy)] >= 0) return true; return false; };
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) if (cells[I(x, y)].k === "wall" && !roomNear(x, y)) cells[I(x, y)] = { k: "crag", f: G.yard, rock: true };
  }
  // A room touches a side's outer wall: the bounding box's (the one rectangle), or, in a shape, a wall cell along that
  // side of the room with the outside (or open air) beyond it.
  const OUTD = { front: [0, 1], back: [0, -1], left: [-1, 0], right: [1, 0] };
  const outAt = (x, y) => !inside(x, y) || rid[I(x, y)] === -2;
  const touches = here ? (room, side) => {
    const [dx, dy] = OUTD[side];
    const along = dy ? room.iw : room.ih;
    for (let t = 0; t < along; t++) {
      const x = dy ? room.ix0 + t : dx > 0 ? room.ix0 + room.iw - 1 : room.ix0, y = dx ? room.iy0 + t : dy > 0 ? room.iy0 + room.ih - 1 : room.iy0;
      if (rid[I(x + dx, y + dy)] === -1 && outAt(x + 2 * dx, y + 2 * dy)) return true;
    }
    return false;
  } : (room, side) => (side === "front" ? room.iy0 + room.ih - 1 === by1 - 1 : side === "back" ? room.iy0 === by0 + 1 : side === "left" ? room.ix0 === bx0 + 1 : room.ix0 + room.iw - 1 === bx1 - 1);
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
    const want = SP.n || ((here ? footArea() : bw * bh) >= BMAP.STOREY.twoStairs ? 2 : 1);
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
      if (!allUp(room)) continue; // a shape's lower part has no floor up there
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
    const first = [...rooms.filter((r) => r.hub && r !== entry).sort(byArea), entry, ...rooms.filter((r) => !r.hub && r !== entry).sort(byArea)].filter((r, i, all) => allUp(r) || !all.some(allUp))[0];
    return [{ x: first.ix0 + Math.floor(first.iw / 2), y: first.iy0 + Math.floor(first.ih / 2), dx: 0, dy: 0, len: 1, single: true }];
  }
  // A shape's stair runs stand in a part with every storey (a lower part has no floor up there).
  function allUp(r) { return !here || parts[r.part].n >= storeys; }
  function footArea() { let n = 0; for (let i = 0; i < W * H; i++) if (rid[i] !== -2) n++; return n; }
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
      // The top floor built of a taller building (OPEN_STOREYS): the run still rises, but the way up is blocked,
      // collapsed or barricaded (no dice: by its place; every step of the run carries it, the top step is the one tried).
      if (f === storeys - 1 && height > storeys) c.sealUp = (run.x * 7 + run.y * 3 + height) % 3 === 0 ? "barricade" : "rubble";
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
    if (here) { // a shape: every wall cell with the outside beyond it on that side, row by row (the inner corners' runs too)
      const [dx, dy] = OUTD[side];
      const at = (x, y) => { if (rid[I(x, y)] === -1 && outAt(x + dx, y + dy) && !outAt(x - dx, y - dy) && rid[I(x - dx, y - dy)] !== -1) out.push({ x, y, ix: x - dx, iy: y - dy, ox: x + dx, oy: y + dy }); };
      if (dy) { for (let y = by0; y <= by1; y++) for (let x = bx0 + 1; x < bx1; x++) at(x, y); }
      else for (let x = bx0; x <= bx1; x++) for (let y = by0 + 1; y < by1; y++) at(x, y);
      return out;
    }
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
      if (run.some((s, j) => j && Math.abs(s.x - run[j - 1].x) + Math.abs(s.y - run[j - 1].y) !== 1)) continue; // a shape's side runs on past a corner: a door's cells side by side
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
  if (!upper && spec.unitDoors) for (const r of rooms) { const side = here ? parts[r.part].unitSide || "front" : "front"; if (r.role === spec.unitDoors && touches(r, side)) outerDoor(side, (q) => q === r, 1, false); } // a shape's wing: its rooms' doors on the side its part says (a motel's wing onto the lot)
  if (!upper && here) for (const r of rooms) if (r.ownDoor && touches(r, r.ownDoor)) outerDoor(r.ownDoor, (q) => q === r, 1, false); // a shape's room with a door of its own to the outside (a motel's laundry)
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
      else if (!A.unit || !B.unit) { const u = A.unit ? A : B; if (u.role !== "apt") w += 3; }
    }
    if (A.hub && B.hub) w -= 0.6; // hubs open onto each other
    if (A.locked || B.locked) w += 4;
    if (A.up !== B.up) w += (A.up ? B.hub : A.hub) ? 1 : 50;
    if ((A.nextTo && A.nextTo.includes(B.role)) || (B.nextTo && B.nextTo.includes(A.role))) w -= 1.5; // a shape's annex opens onto the room it stands by (issue #23)
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
  // A shape: two-storey walls on the parts that rise past the ground floor (part.tall: a gym's one tall storey) or hold
  // a raised room; a lower part's stay one storey high.
  const tallPart = here ? parts.map((p) => !upper && (p.n > 1 || !!p.tall || rooms.some((r) => r.up && r.part === p.k))) : null;
  if (tall || (tallPart && tallPart.some(Boolean))) for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) { const c = cells[I(x, y)]; if ((c.k === "wall" || c.k === "idoor" || c.k === "door") && (!here || (c.bp != null && tallPart[c.bp]))) c.t = 2; }

  // ---------- windows ----------
  // Each gets its state (windows.js: unlocked, locked or fixed) from hash dice of the map's seed as it stands (rng.state
  // read, not consumed: the map's other rolls are as before), by the building's mix (houses mostly open, shop fronts
  // and offices mostly fixed).
  const winMix = winMixOf(opts.key), winSeed = rng.state;
  for (const side of ["front", "back", "left", "right"]) {
    let n = rng.int(0, BMAP.WINDOW_GAP - 1), last = null;
    for (const s of sideCells(side)) {
      const c = cells[I(s.x, s.y)], r = rid[I(s.ix, s.iy)];
      if (last && Math.abs(s.x - last.x) + Math.abs(s.y - last.y) !== 1) n = 0; // a shape: the next run of outer wall
      last = s;
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
  if (!upper && here) { for (let y = by0 - 1; y <= by1 + 1; y++) for (let x = bx0 - 1; x <= bx1 + 1; x++) if (inside(x, y) && [-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => inside(x + dx, y + dy) && rid[I(x + dx, y + dy)] !== -2))) reserved[I(x, y)] = 1; } // a shape: the ring round its parts (a courtyard's middle is ground)
  else if (!upper) for (let y = by0 - 1; y <= by1 + 1; y++) for (let x = bx0 - 1; x <= bx1 + 1; x++) if (inside(x, y)) reserved[I(x, y)] = 1; // a clear ring around the building
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
    for (let g = 0; g < W + H && inside(x, y); g++) { if (!here || rid[I(x, y)] === -2) pathCells[I(x, y)] = 1; if (x === tx && y === ty) break; if (x !== tx) x += Math.sign(tx - x); else y += Math.sign(ty - y); } // (a shape: past a wing in the way)
  }

  // ---------- connectivity (every walkable cell reachable from the front, locked doors counted as ways through) ----------
  const passable = (c) => !!(CELL[c.k] && CELL[c.k].walk) || c.k === "door";
  const anchor = upper ? I(stairCells[0][0], stairCells[0][1]) : I(zones[0].x0 + 1, zones[0].y0 + 1 - (opts.withVehicle ? 1 : 0)); // upstairs everything hangs off the stairwell
  // The walk runs on every blocking thing put down (hundreds a building): over a byte a cell, passable(cells[i]) kept
  // in step by everything below that changes a cell's kind from here on (block, the cars: passAt).
  const pass = new Uint8Array(W * H);
  // known / whole: the last answer of the whole walk, still good while nothing was opened since (a cell turning passable
  // can join what was cut off); connected(i) with the one cell just blocked answers from its ring when it can.
  let known = false, whole = false;
  const passAt = (i) => { const p = passable(cells[i]) ? 1 : 0; if (p && !pass[i]) known = false; pass[i] = p; };
  const passRect = (r) => { for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) passAt(I(x, y)); };
  let total = 0;
  for (let i = 0; i < cells.length; i++) { passAt(i); total += pass[i]; }
  let stamp = 0;
  const marks = new Uint32Array(W * H), stack = new Int32Array(W * H), N = W * H;
  // The cell i just blocked keeps everything joined when its open neighbours (4-way) are one run round its ring of eight
  // (each two along the ring touch 4-way): any way through it goes round it instead. Then the answer is the last whole
  // walk's (issue #24: a walk of the whole map for every piece put down was most of a 300 × 224 map's making).
  const RING = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  function ringKeeps(i) {
    const x = i % W, y = (i / W) | 0, open = RING.map(([dx, dy]) => inside(x + dx, y + dy) && pass[I(x + dx, y + dy)] === 1);
    if (open.every(Boolean)) return true;
    let runs = 0; // the runs of open ring cells that hold a 4-way neighbour (even k)
    for (let k = 0; k < 8; k++) {
      if (!open[k] || open[(k + 7) % 8]) continue; // not the start of a run
      let four = false;
      for (let j = k; open[j % 8]; j++) if (j % 2 === 0) four = true;
      if (four) runs++;
    }
    return runs <= 1;
  }
  function connected(i = -1) {
    if (i >= 0 && known && ringKeeps(i)) return whole;
    known = true;
    whole = walkAll();
    return whole;
  }
  function walkAll() {
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
      if (!connected(i) || (here && room && !roomWhole(room))) { c.k = was; passAt(i); total++; return false; } // a shape's room stays whole (roomWhole)
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
  const styleOf = (room) => bunkerStyle(room) || libraryStyle(room) || (opts.legacy ? null : prisonStyle(room) || officeStyle(room) || militaryStyle(room) || industryStyle(room) || commercialStyle(room, opts.key) || homeStyle(room, opts.key) || medicalStyle(room, opts.key) || campusStyle(room, opts.key) || civicStyle(room)); // campuslayout.js: a campus building's rooms (their leaf's campus mark, a health centre's by role: #28); shoplayout.js first (a motel's rooms, a shop's back rooms; a flat above stays a home), a hospital's, a clinic's, a vet's rooms (#14), civiclayout.js a civic building's rooms (their leaf's civic mark); bunkerlayout.js a bunker's (their leaf's bunker mark: new kinds, so an older save lays them out the same way) // officelayout.js: a leaf's office mark (issue #27: the office buildings, the corporate tower) // industrylayout.js: a leaf's ind mark (issue #37)
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
      const target = Math.max(1, Math.min(boxCap(room), Math.round((room.iw * room.ih) / 10)));
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
  // A shape's room stays whole (issue #23): every door's and stair's step into it reached from the others inside it, not
  // only round the outside (a garage annex can be the one way between a house's front rooms and its back; a car across
  // it must not split the house through a locked back door). The one rectangle's rooms keep the map-wide test alone.
  function roomWhole(room) {
    const goal = [];
    for (const [dx0, dy0] of room.doors) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = dx0 + dx, y = dy0 + dy; if (inside(x, y) && rid[I(x, y)] === room.id && pass[I(x, y)]) goal.push(I(x, y)); }
    for (let y = room.iy0; y < room.iy0 + room.ih; y++) for (let x = room.ix0; x < room.ix0 + room.iw; x++) if (cells[I(x, y)].k === "stairs") goal.push(I(x, y));
    if (goal.length < 2) return true;
    const seen = new Set([goal[0]]), q = [goal[0]];
    while (q.length) { const i = q.pop(), x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = I(x + dx, y + dy); if (!seen.has(j) && rid[j] === room.id && pass[j]) { seen.add(j); q.push(j); } } }
    return goal.every((i) => seen.has(i));
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
      target: canBox ? room.boxTarget ?? (spec.boxScale ? Math.max(1, Math.round(Math.max(1, Math.min(boxCap(room), Math.round((room.iw * room.ih) / 10))) * spec.boxScale)) : Math.max(1, Math.min(boxCap(room), Math.round((room.iw * room.ih) / 10)))) : 0, // boxTarget: a plan's own count (a school corridor's lockers); boxScale: an industrial plan's share × (industrylayout.js loot: each kind holds what it did a floor cell); boxCap: × realScale's boxK
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
        if (!connected() || (here && !roomWhole(room))) { removeCar(cells, W, rect); passRect(rect); total += rect.w * rect.h; return false; }
        return rect;
      },
      // A vehicle of the room's (civiclayout.js: a fire engine, an ambulance, a police car): placeCar at (x, y) along o.ax,
      // o.len cells, drawn as o.body, never cutting anything off; o.box: a container of that kind over the whole of it
      // (combat.js BOX_LOOT), searched from a free cell beside it.
      vehicle: (x, y, o) => {
        const rect = placeCar(cells, W, H, x, y, o.ax, o.len, o.kind, (cx, cy) => free(cx, cy) && rid[I(cx, cy)] === room.id, rng.int(0, 1e6), { ring: false, body: o.body, wide: o.wide || 2 });
        if (!rect) return null;
        passRect(rect);
        total -= rect.w * rect.h;
        const side = [];
        for (let yy = rect.y0 - 1; yy <= rect.y0 + rect.h; yy++) for (let xx = rect.x0 - 1; xx <= rect.x0 + rect.w; xx++) if ((xx < rect.x0 || xx >= rect.x0 + rect.w) !== (yy < rect.y0 || yy >= rect.y0 + rect.h) && inside(xx, yy) && rid[I(xx, yy)] === room.id && walkAt(xx, yy)) side.push([xx, yy]);
        if (!side.length || !connected() || (here && !roomWhole(room))) { removeCar(cells, W, rect); passRect(rect); total += rect.w * rect.h; return null; }
        if (o.box && canBox) {
          keep[I(side[0][0], side[0][1])] = 1;
          containers.push({ id: cid++, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, f, area: room.id, kind: o.box, searched: false, label: `${room.name}: ${o.label || (o.box === "engine" ? "fire engine" : o.box === "policecar" ? "police car" : o.box === "humvee" ? "Humvee" : o.box)}` }); // o.label: an aircraft's, an Army vehicle's name (militarylayout.js)
        }
        return rect;
      },
      keep: keepAt,
      // A container over cells a piece already stands on (prisonlayout.js: what is hidden under a cell's bunk), searched
      // from a walkable cell of the room beside it; null when it has none.
      stash: (cells, k, name) => {
        if (!canBox) return null;
        const xs = cells.map((p) => p[0]), ys = cells.map((p) => p[1]);
        const bx = Math.min(...xs), by = Math.min(...ys), bw = Math.max(...xs) - bx + 1, bh = Math.max(...ys) - by + 1;
        const side = cells.some(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => walkAt(x + dx, y + dy) && rid[I(x + dx, y + dy)] === room.id));
        if (!side) return null;
        const c = { id: cid++, x: bx, y: by, ...(bw > 1 || bh > 1 ? { w: bw, h: bh } : {}), f, area: room.id, kind: k, searched: false, label: `${room.name}: ${name || k}` };
        containers.push(c);
        return c;
      },
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
  // A bunker in the hillside (spec.rockFill): the outside behind and beside the footprint is mountainside, right up to
  // the walls (the clear ring round a building too), but never the exits' paths, their zones or a door's step, and never
  // where it would cut a walkable cell off (the escape hatch's way round to the front stays). One flood a cell.
  function rockFill() {
    const nearDoor = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inside(x + dx, y + dy) && DOORISH.has(cells[I(x + dx, y + dy)].k)) return true; return false; };
    const inZone = (x, y) => zones.some((z) => x >= z.x0 - 1 && x <= z.x0 + z.w && y >= z.y0 - 1 && y <= z.y0 + z.h);
    for (let y = 0; y <= by1; y++) for (let x = 0; x < W; x++) {
      const i = I(x, y), c = cells[i];
      if (c.k !== "open" || rid[i] !== -2 || pathCells[i] || keep[i] || inZone(x, y) || nearDoor(x, y)) continue;
      c.k = "crag"; passAt(i); total--;
      if (!connected(i)) { c.k = "open"; passAt(i); total++; }
    }
  }
  // The vent stack on the rock over the bunker: the footprint's rock cell nearest its middle.
  function ventStack() {
    let best = -1, bd = Infinity;
    const mx = (bx0 + bx1) / 2, my = (by0 + by1) / 2;
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) { const c = cells[I(x, y)]; if (c.rock && c.k === "crag") { const d = Math.hypot(x - mx, y - my); if (d < bd) { bd = d; best = I(x, y); } } }
    if (best >= 0) cells[best].k = "ventstack";
  }
  // The wire fence across a bunker's approach (gaps where the paths and the zones are: block keeps every way open).
  function fenceLine() {
    const y = Math.min(H - 2, by1 + 4);
    for (let x = 0; x < W; x++) block(x, y, "wirefence");
  }
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
    // A new save's (issue #35: a gas station's pumps in every plan): the lot's trucks or the ways to the exits took that
    // row, the rows either side, the lot beside the building too (no dice: an older save's lot as it was).
    let py = y;
    if (!placed && !opts.legacy) for (const yy of [y - 1, y + 1, y + 2]) {
      if (yy <= by1 + 1 || yy >= H - 1) continue;
      for (let x = 1; x < W - 1 && placed < spec.pumps; x += 2) { // the lot either side of the building too
        if (!outsideFree(x, yy) || !outsideFree(x, yy - 1) && !outsideFree(x, yy + 1)) continue;
        if (box(null, x, yy, "pump", a)) { placed++; py = yy; x++; }
      }
      if (placed) break;
    }
    if (placed) { Object.assign(a, py === y ? { x0: bx0, y0: y - 2, w: bw, h: 5 } : { x0: 0, y0: py - 2, w: W, h: 5 }); outdoor.push(a); }
  }
  // The supermarket's box truck at the loading dock (issue #22; spec.dockTruck): backed up to the dock beside a roller
  // door (its bay; the door's own way out to the edge and the ring round the building left clear), its cargo box a
  // container over the whole of it (combat.js BOX_LOOT.boxtruck: pallets of tins and water), an outdoor area of its own,
  // the "Loading dock". Drawn as the map's box trucks are (body "truck": ui/vehiclemodel.js boxtruck).
  if (!upper && spec.dockTruck) {
    const a = { id: rooms.length + outdoor.length, type: "warehouse", name: "Loading dock", outdoor: true };
    const L = 5, y = by0 - 1 - L;
    const cands = [];
    for (const e of exits.filter((q) => q.roller && q.side === "back")) { const xs = e.cells.map(([x]) => x); for (const d of [2, 3, 4]) cands.push(Math.min(...xs) - d - 1, Math.max(...xs) + d); }
    for (const x of rng.shuffle(cands)) {
      const rect = placeCar(cells, W, H, x, y, "y", L, "truck", (cx, cy) => outsideFree(cx, cy), rng.int(0, 1e6), { ring: false, body: "truck" });
      if (!rect) continue;
      passRect(rect);
      total -= rect.w * rect.h;
      if (!connected()) { removeCar(cells, W, rect); passRect(rect); total += rect.w * rect.h; continue; }
      containers.push({ id: cid++, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, f, area: a.id, kind: "boxtruck", searched: false, label: "Loading dock: box truck" });
      Object.assign(a, { x0: rect.x0 - 1, y0: rect.y0 - 1, w: rect.w + 2, h: rect.h + 2 });
      outdoor.push(a);
      break;
    }
  }
  // An industrial plan's yard (industrylayout.js spec.yardPieces: a tank farm, grain bins, lumber stacks, steel stock): its
  // pieces in rows a cell apart behind and beside the building, never on a path, a zone's ring or a door's step (block's
  // guard keeps every way open); an outdoor area of its own, searched where the pieces hold loot (yard.loot, its type).
  if (!upper && spec.yardPieces) {
    const Yd = spec.yardPieces, a = { id: rooms.length + outdoor.length, type: Yd.loot && Yd.type && AREAS[Yd.type] ? Yd.type : null, name: Yd.name, outdoor: true };
    const spots = [];
    for (let y = 1; y <= by1; y += 2) for (let x = 1; x < W - 1; x += 2) if (y < by0 - 1 || x < bx0 - 1 || x > bx1 + 1) spots.push([x, y]);
    const order = rng.shuffle(spots).sort((p, q) => (p[1] < by0 ? 0 : 1) - (q[1] < by0 ? 0 : 1)); // behind first, then the sides
    const got = [];
    for (const [k, n] of Yd.pieces) {
      const want = Array.isArray(n) ? rng.int(n[0], n[1]) : n;
      let made = 0;
      for (const [x, y] of order) {
        if (made >= want) break;
        if (!outsideFree(x, y) || got.some(([gx, gy]) => gx === x && gy === y)) continue;
        if (a.type && pieceDef(k) && pieceDef(k).loot ? box(null, x, y, k, a) : block(x, y, k)) { got.push([x, y]); made++; }
      }
    }
    if (got.length) {
      const xs = got.map(([x]) => x), ys = got.map(([, y]) => y);
      Object.assign(a, { x0: Math.min(...xs) - 1, y0: Math.min(...ys) - 1, w: Math.max(...xs) - Math.min(...xs) + 3, h: Math.max(...ys) - Math.min(...ys) + 3 });
      outdoor.push(a);
    }
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
  // A building's own grounds (spec.yard: a hotel's drive, car park, pool deck, tennis courts and gardens, hotellayout.js),
  // before the outside is dressed.
  if (!upper && spec.yard) spec.yard({ rng, W, H, b: { x0: bx0, y0: by0, x1: bx1, y1: by1 }, front, exits, cell: (x, y) => cells[I(x, y)], outside: (x, y) => inside(x, y) && rid[I(x, y)] === -2,
    free: outsideFree, block: (x, y, k) => block(x, y, k), car: (x, y, kind, test) => carAt(x, y, kind, test), area: (a) => outdoor.push({ id: rooms.length + outdoor.length, type: null, outdoor: true, ...a }) });
  // What stands outside a restaurant (issue #33, eaterylayout.js eateryOutside: the drive-through lane and its cars, a
  // patio, a BBQ's smokers, a food truck, the grease trap by the back door), every piece keeping the lot one walk.
  if (!upper && spec.outside) spec.outside({
    rng, bx0, bx1, by0, by1, exits,
    free: outsideFree,
    block: (x, y, k) => outsideFree(x, y) && block(x, y, k),
    unblock: (x, y) => { const i = I(x, y), was = pass[i]; cells[i].k = "open"; passAt(i); if (!was && pass[i]) total++; },
    area: (o) => { const a = { id: rooms.length + outdoor.length, outdoor: true, ...o }; outdoor.push(a); return a; },
    car: (x, y, ax, len, kind, body = null) => {
      const rect = placeCar(cells, W, H, x, y, ax, len, kind, (cx, cy) => outsideFree(cx, cy), rng.int(0, 1e6), { ring: false, ...(body ? { body } : {}) });
      if (!rect) return null;
      passRect(rect);
      total -= rect.w * rect.h;
      if (!connected()) { removeCar(cells, W, rect); passRect(rect); total += rect.w * rect.h; return null; }
      return rect;
    },
    container: (rect, a, kind, label) => containers.push({ id: cid++, x: rect.x0, y: rect.y0, w: rect.w, h: rect.h, f, area: a.id, kind, searched: false, label: `${a.name}: ${label}` }),
  });
  // The outside of a base, an airfield or a prison (issue #25: militarylayout.js militaryOutside): its tools.
  let milGround = null;
  const milApi = () => ({
    rng, W, H, I, cells, bx0, by0, bx1, by1, spec, containers, outsideFree, scatter, box,
    block: (x, y, k) => block(x, y, k),
    clear: (x, y) => { const i = I(x, y), was = pass[i]; cells[i].k = "open"; passAt(i); if (!was && pass[i]) total++; }, // a cell of the ground opened again (a fence cell a barrier takes)
    cid: () => cid++,
    area: (type, name) => { const a = { id: rooms.length + outdoor.length, type, name, outdoor: true }; outdoor.push(a); return a; },
    dropArea: (a) => { if (outdoor[outdoor.length - 1] === a) outdoor.pop(); },
    outCar: (x, y, o) => {
      const rect = placeCar(cells, W, H, x, y, o.ax, o.len, o.kind, (cx, cy) => outsideFree(cx, cy), rng.int(0, 1e6), { ring: false, body: o.body, wide: o.wide || 2 });
      if (!rect) return null;
      passRect(rect);
      total -= rect.w * rect.h;
      if (!connected()) { removeCar(cells, W, rect); passRect(rect); total += rect.w * rect.h; return null; }
      return rect;
    },
  });
  if (!upper && spec.rockFill) rockFill();
  if (!upper && spec.vent) ventStack();
  switch (upper ? "none" : spec.ground) {
    case "none": break; // an upper floor: nothing outside its walls
    case "rock": if (spec.fence) fenceLine(); scatter("boulder", rng.int(2, 4), (x, y) => y > by1 + 1); scatter("sandbag", rng.int(2, 4), (x, y) => y > by1 + 1 && y < by1 + 5); break; // a bunker's approach: the wire fence across it, sandbags by the portal
    case "city": scatter("car", rng.int(2, 4), inStreet); scatter("truck", rng.int(0, 1), inStreet); scatter("crate", rng.int(2, 3), behind); break;
    case "lot": scatter("truck", rng.int(1, 2)); scatter("crate", rng.int(2, 4)); scatter("barrel", rng.int(1, 2)); scatter("car", rng.int(1, 2), inStreet); break;
    case "base": scatter("sandbag", rng.int(3, 6)); scatter("crate", rng.int(2, 3)); scatter("truck", rng.int(1, 2)); break;
    case "compound": case "airfield": case "prisonyard": milGround = militaryOutside(spec.ground, milApi()); break; // issue #25
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
  rooms.forEach((r, i) => { if (r.kennel) areas[i].kennel = true; });
  if (here) rooms.forEach((r, i) => { areas[i].part = r.part; }); // a shape's: the part the room is in
  rooms.forEach((r, i) => { if (r.bunker) areas[i].bunker = r.bunker; if (r.ind) areas[i].ind = r.ind; if (r.lib) areas[i].lib = r.lib; }); // lib: librarylayout.js's room (its scenes) // ind: industrylayout.js's room (its scenes) // bunkerlayout.js: a bunker's room (its scenes, its dark, who holds it) // deadbeasts.js shutInPets: a vet's locked kennels hold dead pets
  if (!opts.legacy) rooms.forEach((r, i) => { if (r.flat) areas[i].flat = true; if (r.unit) areas[i].unit = r.unit; if (r.civic) areas[i].civic = r.civic; if (r.prison) { areas[i].prison = r.prison; for (const k of ["unitId", "dense", "single", "face", "well", "panels"]) if (r[k] != null) areas[i][k] = r[k]; } /* prisonlayout.js: a prison's room (its unit, how dense the dead, a single cell) */ if (r.office) areas[i].office = r.office; if (r.campus) areas[i].campus = r.campus; if (r.aisle != null) areas[i].aisle = r.aisle; const sn = shopStyleName(r, opts.key); if (sn) areas[i].shop = sn; }); // shoplayout.js: a room's style (its scenes' when); roomlayout.js: a shop's flat above, an apartment's rooms; civiclayout.js: a room's style, a nave's aisle
  rooms.forEach((r, i) => { if (r.mix) areas[i].mix = r.mix; if (r.eat) areas[i].eat = r.eat; }); // eaterylayout.js: a restaurant's rooms hold its cuisine's food (combat.js boxFinds)
  for (const a of outdoor) areas.push({ ...a, id: idBase + a.id, f: 0 });
  for (const c of containers) c.area += idBase;
  for (const d of lockedDoors) { d.f = f; if (d.area != null) d.area += idBase; }
  if (upper) return { cells, rooms: areas, containers, lockedDoors, nextCid: cid, nextPiece: pieceNo };
  // The upper floors (storeys): each built on its own grid from spec.upper's plan, the same stairwell cells.
  const floorName = (g) => (spec.below ? levelName(g) : g === 0 ? "Ground floor" : g === storeys - 1 && height === storeys ? "Top floor" : `Floor ${g + 1}`); // a bunker's go down: the Entrance level, Level −1...; a taller building's top floor built is not its top
  const floors = [{ cells, name: floorName(0) }];
  let base = areas.length, nextCid = cid;
  for (let g = 1; g < storeys; g++) {
    const program = parts ? null : spec.upper ? spec.upper(g, rng, { top: g === storeys - 1 && height === storeys, storeys, bw, bh }) : spec.program; // top: the roof is over it (a taller building's top floor built is not its plant room)
    const programs = parts ? parts.map((p) => (p.n > g ? (p.upper ? p.upper(g, rng, { top: g === p.n - 1 && (p.n < storeys || height === storeys), storeys: p.n, bw: p.w, bh: p.h, part: p }) : p.program) : null)) : null; // a shape: each part's floor g, while it has one
    const up = assemble(rng, spec, { ...opts, _floor: g, _program: program, _programs: programs, _runs: runs, _idBase: base, _cid: nextCid, _piece: pieceNo });
    areas.push(...up.rooms); containers.push(...up.containers); lockedDoors.push(...up.lockedDoors);
    floors.push({ cells: up.cells, name: floorName(g) });
    base += up.rooms.length; nextCid = up.nextCid; pieceNo = up.nextPiece;
  }
  const plan = { // ground: what militarylayout.js put outside (issue #25: tools/interiortest.js)
    key: opts.key, id: opts.id || opts.key, name: opts.name, w: W, h: H, building: { x0: bx0, y0: by0, w: bw, h: bh, ...(parts ? { shape: spec.shape.kind || null, parts: parts.map((p) => ({ x0: p.x0, y0: p.y0, w: p.w, h: p.h, storeys: p.n, ...(p.tall ? { tall: true } : {}), name: p.name || null })) } : {}) }, tall, storeys, height, ...(milGround ? { ground: milGround } : {}), stairs: stairCells.map((s) => s.slice()), runs: runs.map((r) => ({ ...r })),
    rooms: areas.filter((a) => !a.outdoor).map((a) => ({ id: a.id, f: a.f, name: a.name, role: a.role, type: a.type, x0: a.x0, y0: a.y0, w: a.w, h: a.h, locked: a.locked, up: a.up, hub: a.hub, entry: a.entry, ...(a.civic ? { civic: a.civic } : {}), ...(a.bunker ? { bunker: a.bunker } : {}), ...(a.campus ? { campus: a.campus } : {}), ...(a.lib ? { lib: a.lib } : {}) })), // civic, bunker: wanderers.js interiorOccupants' rooms by kind
    front: { x: front.x, y: front.y },
    ...(spec.variant ? { variant: spec.variant } : {}), // a plan's name among its kind's (bunkerlayout.js BUNKER_VARIANTS)
    exits: exits.map((e) => ({ side: e.side, name: e.name, x: e.x, y: e.y, cells: e.cells, locked: e.locked, roller: e.roller, zone: e.zone })),
    ...(spec.vname ? { variant: spec.vname, vid: spec.vid } : {}), // the plan's name (industrylayout.js: a warehouse's, a factory's, a lab's; shopvariants.js: a shop's or a service's, issue #35)
  };
  return { w: W, h: H, cells, rooms: areas, containers, zones, vehicle, exits, front, lockedDoors, plan, building: plan.building, floors, stairs: plan.stairs, runs: plan.runs, storeys, height, deadK: spec.deadK || 0, natMap: spec.deadK ? spec.natMap || [spec.natW + BMAP.MARGIN.left + BMAP.MARGIN.right, spec.natH + BMAP.MARGIN.front + BMAP.MARGIN.back] : null };
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
  const base = map.deadScale != null ? map.deadScale : map.street ? STREET.DEAD : Math.max(BMAP.DEAD_SCALE[0], Math.min(BMAP.DEAD_SCALE[1], (W * H) / (RAID_W * RAID_H))); // a prison's (prison.js PRISON.DEAD): its own
  // A building at real size (realScale, issue #24): what its plan's map would have held at its own size (map.natMap, the
  // same rules), times its floor area over its plan's (map.deadK): as many to the square metre as before, whatever the
  // ground round it; at most BMAP.DEAD_CAP of a group.
  const oldScale = (w, h) => { const b0 = Math.max(BMAP.DEAD_SCALE[0], Math.min(BMAP.DEAD_SCALE[1], (w * h) / (RAID_W * RAID_H))); return b.raid && b.raid.big ? buildingDeadScale(b0, w, h) : b0; };
  const scale = map.deadScale != null ? base : map.deadK ? oldScale(map.natMap[0], map.natMap[1]) * map.deadK : !(b.raid && b.raid.big) ? base : map.street ? base * streetDeadScale(W, H) : buildingDeadScale(base, W, H);
  let pod = 0, zn = 0, hn = 0;
  const lockedDead = new Set();
  const put = (u, c, home = null) => { u.x = c[0]; u.y = c[1]; u.home = home || [c[0], c[1]]; b.units.push(u); };
  for (const g of groups) {
    if (!(g.count > 0)) continue;
    if (g.kind === "zombies" && map.campus) { pod += campusDead(state, b, map, g, pod); continue; } // a campus (campus.js): by building and over the grounds
    if (g.kind === "zombies") {
      const n = Math.min(map.deadK ? BMAP.DEAD_CAP : Infinity, Math.max(1, Math.round(g.count * scale)));
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
              const a = rng.weighted(open, (q) => Math.max(1, (q.w - 2) * (q.h - 2)) * (q.entry ? 0.5 : 1) * (q.dense || 1)); // dense: a prison's housing units (prison.js PRISON.DENSE)
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
  if (map.campus) campusFolk(state, b); // campus.js: students holed up in a dorm (floorfolk.js)
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
  if (R.plan && R.plan.campus) return campusIntro(b); // a college campus (campus.js)
  if (R.plan && R.plan.street) return streetIntro(b);
  const ex = (R.plan.exits || []).filter((e) => e.zone >= 0);
  const lockedEx = (R.plan.exits || []).filter((e) => e.locked).length;
  const names = ["the front", ...ex.map((e) => e.name.toLowerCase())];
  const st = R.storeys > 1 ? ` ${R.storeys} storeys: ${stairsText(R)}; the ways out are on the ground floor.` : "";
  return `${R.plan.variant ? `${R.plan.variant}. ` : ""}Ways out: ${names.join(", ")}${lockedEx ? ` (${lockedEx} locked)` : ""}.${st} Rooms, walls and closed doors block sight (a glass or a screen door is seen through): peek through a door (K) before you go in, shut doors behind you (Shift+E): the dead have to batter them down. Windows: check one from next to it (free), open it if it is unlocked (or from inside if it is locked: 1 action, quiet), then climb or vault through; a fixed one only breaks (loud).`;
}
// A street of houses (streetMap): the houses, the ways out, and the houses your side has been into before (the
// containers the POI's ledger brought back as you left them: poicont.js poiRaidStart marks them mine).
export function streetIntro(b) {
  const R = b.raid, P = R.plan;
  const names = (P.houses || []).map((h) => h.name);
  const been = (P.houses || []).filter((h) => R.containers.some((c) => c.house === h.k && c.mine)).map((h) => h.name);
  const robbed = (P.houses || []).filter((h) => { const cs = R.containers.filter((c) => c.house === h.k); return cs.length && cs.every((c) => c.ransacked && !c.mine); }).map((h) => h.name);
  const ways = R.zones.map((z) => (z.name || z.side).toLowerCase());
  return `A street of ${names.length} houses (${names.join(", ")}), ${R.storeys > 1 ? `${R.storeys} storeys each: the stairs are inside every house` : "one storey each"}. Ways out: ${ways.join(", ")}.${been.length ? ` Your people have been through ${been.join(", ")} before: what you left there is as you left it.` : ""}${robbed.length ? ` ${robbed.join(", ")} ${robbed.length === 1 ? "looks" : "look"} ransacked.` : ""} Rooms, walls and closed doors block sight: peek through a door (K) before you go in, shut doors behind you (Shift+E). Windows: check one from next to it (free), open it if it is unlocked (1 action, quiet) and climb or vault through; a fixed one only breaks (loud).`;
}
