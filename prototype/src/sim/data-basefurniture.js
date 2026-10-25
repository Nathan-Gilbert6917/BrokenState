// @ts-check
// Storage, comfort and work furniture at the base (#20, the interiors epic #7; the user's request 2026-10-25: "I want
// all reasonable appliances, furniture and some decor to be lootable and taken to your base for use, like [...]
// shelves, crates etc for storage"). Plain data that imports nothing; the rules are sim/furniture.js (setting and
// picking up, every piece) with the storage in basestorage.js / containers.js and the comfort in relations.js.
// Merged by: data.js (FURN_GEAR into GEAR), buildings.js (FURN_BUILDINGS into BUILDINGS, FURN_STORE_KG into
// STORE_KG), basemap.js (FURN_FOOT into FOOT, FURN_STORES into STORES), inventory.js (FURN_SALVAGE into
// SALVAGE_ELECTRONICS).
//
// A piece is an item while it is in the stores or carried (GEAR f_<kind>: bulky, both arms, furniture: <kind>), and a
// placed thing once it is set on a general building's floor (BUILDINGS f_<kind>: fit + furniture, as the beds). The
// item key and the placed type are the same word (f_<kind>), as a bed's are ("bed"), so the stores are matched by key.
// What a piece does at the base is its catalogue row's `use` (furniture.js useOf):
//   storage:<kg>   room for the base's goods (basestorage.js storageOf: a "building" container of that many kg) and an
//                  assignable container in the Storage tab (containers.js), with its own preferences (FURN_STORE)
//   comfort:<mood> a day's mood for the people sleeping in the building it stands in (furniture.js comfortLine)
//   work:<station> a station: work:craftbench counts as a crafting bench (crafting.js hasBench)
//   none           nothing (a school desk, a server rack: its worth is its salvage)

// TODO(#8): move these rows to data-furniture.js
// The catalogue rows this ticket needs, in #8's agreed shape (FURNITURE_KINDS keyed by cell kind: { name, cell, hp, kg,
// carry, size: [w, h], loot, tags, use }) and their item forms (GEAR f_<kind>: bulky, twoHands, furniture: <kind>,
// weight: kg). The kind names are this ticket's guess at #8's; when data-furniture.js lands, its rows replace these
// and furniture.js reads its FURNITURE_KINDS instead (the kinds it names differently are renamed here then).
// CELL_STANDIN: the battle-map cell each kind is drawn as until #8 adds its own cell kinds (combat.js CELL): an existing
// piece of furniture of about its shape ("open": a rug or a painting, nothing on the floor in the way).
/** @type {Record<string, { name: string, cell: { walk: boolean, cover: number, los: boolean, tall?: boolean }, hp: number, kg: number, carry: "one" | "two" | "fixed", size: [number, number], loot: boolean, tags: string[], use: string }>} */
export const FURNITURE_KINDS = {
  // storage
  shelf:      { name: "Shelving unit",  cell: { walk: false, cover: 1, los: false }, hp: 25, kg: 25, carry: "one", size: [2, 1], loot: true,  tags: ["store", "bay", "office", "living"], use: "storage:150" },
  bookshelf:  { name: "Bookshelf",      cell: { walk: false, cover: 1, los: false }, hp: 25, kg: 30, carry: "one", size: [1, 1], loot: true,  tags: ["living", "office", "school"], use: "storage:60" },
  crate:      { name: "Crate",          cell: { walk: false, cover: 1, los: false }, hp: 20, kg: 12, carry: "one", size: [1, 1], loot: true,  tags: ["store", "bay", "farm"], use: "storage:40" },
  cabinet:    { name: "Cabinet",        cell: { walk: false, cover: 1, los: false }, hp: 25, kg: 30, carry: "one", size: [1, 1], loot: true,  tags: ["kitchen", "office", "ward"], use: "storage:60" },
  filecab:    { name: "Filing cabinet", cell: { walk: false, cover: 2, los: false, tall: true }, hp: 35, kg: 38, carry: "one", size: [1, 1], loot: true, tags: ["office", "school"], use: "storage:50" },
  wardrobe:   { name: "Wardrobe",       cell: { walk: false, cover: 2, los: false, tall: true }, hp: 35, kg: 55, carry: "two", size: [2, 1], loot: true, tags: ["bedroom"], use: "storage:80" },
  dresser:    { name: "Dresser",        cell: { walk: false, cover: 1, los: false }, hp: 25, kg: 40, carry: "one", size: [2, 1], loot: true,  tags: ["bedroom"], use: "storage:50" },
  locker:     { name: "Locker bank",    cell: { walk: false, cover: 2, los: true, tall: true }, hp: 40, kg: 45, carry: "two", size: [2, 1], loot: true, tags: ["school", "cells", "bay", "office"], use: "storage:100" },
  toolchest:  { name: "Tool chest",     cell: { walk: false, cover: 1, los: false }, hp: 30, kg: 40, carry: "one", size: [1, 1], loot: true,  tags: ["bay", "farm"], use: "storage:30" },
  display:    { name: "Display case",   cell: { walk: false, cover: 1, los: true }, hp: 15, kg: 50, carry: "two", size: [2, 1], loot: true,  tags: ["store"], use: "storage:40" },
  gunrack:    { name: "Gun rack",       cell: { walk: false, cover: 1, los: true }, hp: 20, kg: 20, carry: "one", size: [1, 1], loot: true,  tags: ["store", "cells", "office"], use: "storage:40" },
  palletrack: { name: "Pallet rack",    cell: { walk: false, cover: 2, los: true, tall: true }, hp: 45, kg: 80, carry: "two", size: [2, 1], loot: true, tags: ["store", "bay"], use: "storage:300" },
  // comfort
  sofa:       { name: "Sofa",           cell: { walk: false, cover: 1, los: false }, hp: 20, kg: 50, carry: "two", size: [2, 1], loot: false, tags: ["living"], use: "comfort:0.5" },
  armchair:   { name: "Armchair",       cell: { walk: false, cover: 1, los: false }, hp: 15, kg: 20, carry: "one", size: [1, 1], loot: false, tags: ["living", "office"], use: "comfort:0.25" },
  rug:        { name: "Rug",            cell: { walk: true, cover: 0, los: false }, hp: 5, kg: 8, carry: "one", size: [2, 1], loot: false, tags: ["living", "bedroom"], use: "comfort:0.1" },
  painting:   { name: "Painting",       cell: { walk: true, cover: 0, los: false }, hp: 5, kg: 4, carry: "one", size: [1, 1], loot: false, tags: ["living", "office"], use: "comfort:0.1" },
  plant:      { name: "Potted plant",   cell: { walk: false, cover: 0, los: false }, hp: 5, kg: 6, carry: "one", size: [1, 1], loot: false, tags: ["living", "office"], use: "comfort:0.1" },
  lamp:       { name: "Floor lamp",     cell: { walk: false, cover: 0, los: false }, hp: 5, kg: 4, carry: "one", size: [1, 1], loot: false, tags: ["living", "bedroom"], use: "comfort:0.1" },
  tvstand:    { name: "TV stand",       cell: { walk: false, cover: 1, los: false }, hp: 15, kg: 25, carry: "one", size: [2, 1], loot: true,  tags: ["living"], use: "comfort:0" },
  piano:      { name: "Piano",          cell: { walk: false, cover: 2, los: false, tall: true }, hp: 50, kg: 200, carry: "two", size: [2, 1], loot: false, tags: ["living", "school", "church"], use: "comfort:0.5" },
  pew:        { name: "Pew",            cell: { walk: false, cover: 1, los: false }, hp: 25, kg: 60, carry: "two", size: [2, 1], loot: false, tags: ["church"], use: "comfort:0" },
  diningtable: { name: "Dining table and chairs", cell: { walk: false, cover: 1, los: false }, hp: 20, kg: 60, carry: "two", size: [2, 1], loot: false, tags: ["kitchen", "living"], use: "comfort:0.25" },
  // work
  desk:       { name: "Desk",           cell: { walk: false, cover: 1, los: false }, hp: 25, kg: 35, carry: "one", size: [2, 1], loot: true,  tags: ["office", "school"], use: "work:desk" },
  workbench:  { name: "Workbench",      cell: { walk: false, cover: 1, los: false }, hp: 35, kg: 70, carry: "two", size: [2, 1], loot: true,  tags: ["bay", "farm"], use: "work:craftbench" },
  schooldesk: { name: "School desk",    cell: { walk: false, cover: 1, los: false }, hp: 10, kg: 12, carry: "one", size: [1, 1], loot: true,  tags: ["school"], use: "none" },
  serverrack: { name: "Server rack",    cell: { walk: false, cover: 2, los: true, tall: true }, hp: 40, kg: 90, carry: "two", size: [1, 1], loot: false, tags: ["office"], use: "none" },
};
/** @type {Record<string, string>} */
export const CELL_STANDIN = {
  shelf: "shelf", bookshelf: "shelf", crate: "crate", cabinet: "cabinet", filecab: "cabinet", wardrobe: "locker", dresser: "cabinet", locker: "locker",
  toolchest: "cabinet", display: "counter", gunrack: "rack", palletrack: "rack", sofa: "bed", armchair: "table", rug: "open", painting: "open",
  plant: "table", lamp: "table", tvstand: "cabinet", piano: "counter", pew: "table", diningtable: "table", desk: "table", workbench: "counter",
  schooldesk: "table", serverrack: "locker",
};
/** A catalogue row by kind (#8's pieceDef). @param {string} k */
export const pieceDef = (k) => FURNITURE_KINDS[k] || null;
const BLURB = {
  shelf: "A steel shelving unit, bolts and all", bookshelf: "A tall wooden bookshelf", crate: "A lidded wooden crate", cabinet: "A cupboard with doors and a shelf",
  filecab: "A four-drawer steel filing cabinet", wardrobe: "A tall wardrobe with a hanging rail", dresser: "A chest of drawers", locker: "A bank of steel lockers",
  toolchest: "A rolling tool chest of steel drawers", display: "A glass-topped shop display case", gunrack: "A wall rack with slots and a lock bar for long guns",
  palletrack: "A section of warehouse pallet racking", sofa: "A three-seat sofa", armchair: "A deep armchair", rug: "A thick rug", painting: "A framed painting",
  plant: "A potted plant that somehow lived", lamp: "A standing lamp with a shade", tvstand: "A TV stand (the TV long dead)", piano: "An upright piano, mostly in tune",
  pew: "A church pew", diningtable: "A dining table and its chairs", desk: "An office desk", workbench: "A heavy workbench with a vice",
  schooldesk: "A school desk and its chair", serverrack: "A server rack full of dead machines",
};
// The item forms (data.js Object.assign(GEAR, FURN_GEAR)), as the beds' (data-beds.js BED_GEAR): carried in both arms
// (the In arms slot, a cart, the team's cargo, a vehicle; "two" pieces by two people: #12), kept in the armory.
/** @type {Record<string, any>} */
export const FURN_GEAR = Object.fromEntries(Object.entries(FURNITURE_KINDS).map(([k, r]) => [`f_${k}`, {
  name: r.name, slot: "pack", skill: null, power: 0, req: 0, value: Math.max(2, Math.round(r.kg / 4)), noise: 0, weight: r.kg, cat: "household",
  bulky: true, twoHands: true, furniture: k, burnShare: k === "rug" || k === "painting" || k === "sofa" || k === "armchair" ? 0.8 : k === "shelf" || k === "filecab" || k === "locker" || k === "toolchest" || k === "gunrack" || k === "palletrack" || k === "serverrack" ? 0 : 0.6,
  desc: `${BLURB[k] || r.name}. ${r.size[0]} × ${r.size[1]} cells, ${r.kg} kg${r.carry === "two" ? ": a load for two" : ""}. Set it inside a hut, cabin, lodge, hall or barn (the base map's Build list, Furniture).`,
}]));
// TODO(#8) end

// ---------- what each piece does at the base (this ticket's own tables) ----------
// Storage preferences (containers.js autoStore and putItem; basestorage.js storageOf):
//   first   the class of item it takes before any other container does (containers.js itemClass: "gear" anything
//           not dear, "wear" clothing, armour and bags, "guns", "tools", "paper" books and manuals, "dear" valuables)
//   only    it takes nothing else (items of that class only; no supplies): its spare room is no room for the rest
//   max     at most this many items (a gun rack's six slots)
//   food    food may be kept in it (a crate, a shelf, a cabinet, a pallet rack); never in the rest
/** @type {Record<string, { first?: string, only?: string, max?: number, food?: boolean }>} */
export const FURN_STORE = {
  shelf: { first: "gear", food: true }, bookshelf: { first: "paper" }, crate: { food: true }, cabinet: { first: "gear", food: true },
  filecab: { only: "paper" }, wardrobe: { first: "wear" }, dresser: { first: "wear" }, locker: { first: "gear" },
  toolchest: { only: "tools" }, display: { first: "dear" }, gunrack: { only: "guns", max: 6 }, palletrack: { food: true },
};
// Comfort (furniture.js comfortLine, relations.js moodFactors): one line a day "Comforts: sofa, rug (+0.6)" for each
// person sleeping in a building with comfort pieces in it.
//   SEATS      a sofa, an armchair, a piano, a dining table each serves this many of the building's sleepers: with more
//              sleepers than its pieces serve, each gets their share (2 sofas for 12 sleepers: +0.5 each; 1: +0.25)
//   DECOR_MAX  decor (DECOR: a rug, a painting, a plant, a lamp, a desk) adds at most this a building, whoever sleeps there
//   books      a bookshelf with a book or a manual kept in it (containers.js) counts as a comfort piece of this much
//   MAX        a person's comfort line at most (a base's: the best building's)
export const COMFORT = { SEATS: 6, DECOR_MAX: 0.5, books: 0.25, MAX: 1.5 };
export const DECOR = new Set(["rug", "painting", "plant", "lamp", "desk"]);
export const DECOR_MOOD = 0.1; // a desk's, as decor
// Salvage (inventory.js SALVAGE_ELECTRONICS): a server rack taken apart gives its boards.
export const FURN_SALVAGE = { f_serverrack: 3 };
// The placed pieces (buildings.js Object.assign(BUILDINGS, FURN_BUILDINGS)), as the beds': fit, furniture, no cost, no
// hours (the item is the cost), found: true (the Build list shows one only while one is in the stores), storeKg for a
// storage piece (basestorage.js storageOf: a building container).
const useKg = (use) => (/^storage:/.test(use) ? Number(use.slice(8)) || 0 : 0);
/** @type {Record<string, number>} */
export const FURN_STORE_KG = Object.fromEntries(Object.entries(FURNITURE_KINDS).filter(([, r]) => useKg(r.use) > 0).map(([k, r]) => [`f_${k}`, useKg(r.use)]));
/** @type {Record<string, any>} */
export const FURN_BUILDINGS = Object.fromEntries(Object.entries(FURNITURE_KINDS).map(([k, r]) => [`f_${k}`, {
  name: r.name, fit: true, furniture: true, found: true, cost: {}, hours: 0, max: 60, ...(useKg(r.use) ? { storeKg: useKg(r.use) } : {}),
  desc: `${BLURB[k] || r.name}, ${r.kg} kg. Set from the stores onto the floor of a general building (${r.size[0]} × ${r.size[1]}). Demolish picks it up again (back into the stores).`,
}]));
// Their footprints (basemap.js Object.assign(FOOT, FURN_FOOT)): on a general building's floor only (fit), drawn as the
// kind's cell (CELL_STANDIN until #8).
/** @type {Record<string, any>} */
export const FURN_FOOT = Object.fromEntries(Object.entries(FURNITURE_KINDS).map(([k, r]) => [`f_${k}`, { kind: "prop", k: CELL_STANDIN[k] || "crate", w: r.size[0], h: r.size[1], fit: true, indoor: true }]));
// The base map's store weights (basemap.js STORES): a storage piece holds goods raiders search, as the shelves fitting.
/** @type {Record<string, number>} */
export const FURN_STORES = Object.fromEntries(Object.keys(FURN_STORE_KG).map((t) => [t, 1]));
// AI groups (furniture.js groupFurnitureDaily): their pieces are a count a base (f.works[tile][f_<kind>]), each itself
// on their base's map (groupbases.js WORKS_BUILDING).
/** @type {Record<string, string>} */
export const FURN_WORKS_BUILDING = Object.fromEntries(Object.keys(FURNITURE_KINDS).map((k) => [`f_${k}`, `f_${k}`]));
