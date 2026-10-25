// @ts-check
// Storage, comfort and work furniture at the base (#20, the interiors epic #7; the user's request 2026-10-25: "I want
// all reasonable appliances, furniture and some decor to be lootable and taken to your base for use, like [...]
// shelves, crates etc for storage"). Plain data that imports only #8's catalogue (data-furniture.js); the rules are sim/furniture.js (setting and
// picking up, every piece) with the storage in basestorage.js / containers.js and the comfort in relations.js.
// Merged by: data.js (FURN_GEAR into GEAR), buildings.js (FURN_BUILDINGS into BUILDINGS, FURN_STORE_KG into
// STORE_KG), basemap.js (FURN_FOOT into FOOT, FURN_STORES into STORES), inventory.js (FURN_SALVAGE into
// SALVAGE_ELECTRONICS).
//
// A piece is an item while it is in the stores or carried (GEAR f_<kind>: bulky, both arms, furniture: <kind>), and a
// placed thing once it is set on a general building's floor (BUILDINGS f_<kind>: fit + furniture, as the beds). The
// item key and the placed type are the same word (f_<kind>), as a bed's are ("bed"), so the stores are matched by key.
// The catalogue is #8's (data-furniture.js FURNITURE_KINDS); what a piece does at the base is its row's `use`
// (furniture.js useOf):
//   storage:<kg>   room for the base's goods (basestorage.js storageOf: a "building" container of that many kg) and an
//                  assignable container in the Storage tab (containers.js), with its own preferences (FURN_STORE)
//   comfort:<mood> a day's mood for the people sleeping in the building it stands in (furniture.js comfortLine)
//   work:<station> a station: work:workbench counts as a crafting bench (crafting.js hasBench); work:desk is decor
//   none           not set by this ticket (a server rack's worth is its salvage: FURN_SALVAGE)
import { FURNITURE_KINDS, FURNITURE_GEAR } from "./data-furniture.js"; // #8's catalogue: the kinds, their use, their item forms
// The pieces this ticket sets at a base: every liftable catalogue kind (not "fixed") whose use is storage, comfort or
// work (the appliances are #19's; the beds' kinds, use "bed:<kind>", are data-beds.js's own items). Each is #8's item
// form (data-furniture.js FURNITURE_GEAR f_<kind>, piece: true as #12's merge of the rest: never in a starting kit or a
// trunk), with the base's words added to its description (data.js, ahead of #12's merge): kept in the armory, carried in
// both arms; ITEM_TAGS has none of them, so no loot pool or shop draws them (#12 lifts them off a raid's floor).
const BASE_USE = /^(storage|comfort|work):/;
/** The catalogue kinds set at a base by furniture.js. */
export const FURN_KINDS = Object.keys(FURNITURE_KINDS).filter((k) => FURNITURE_KINDS[k].carry !== "fixed" && BASE_USE.test(FURNITURE_KINDS[k].use) && FURNITURE_GEAR[`f_${k}`]);
/** @type {Record<string, any>} */
export const FURN_GEAR = Object.fromEntries(FURN_KINDS.map((k) => {
  const r = FURNITURE_KINDS[k];
  return [`f_${k}`, { ...FURNITURE_GEAR[`f_${k}`], piece: true, desc: `${FURNITURE_GEAR[`f_${k}`].desc} Set it inside a hut, cabin, lodge, hall or barn (the base map's Build list, Furniture): ${r.size[0]} × ${r.size[1]} cells.` }];
}));

// ---------- what each piece does at the base (this ticket's own tables) ----------
// Storage preferences (containers.js autoStore and putItem; basestorage.js storageOf):
//   first   the class of item it takes before any other container does (containers.js itemClass: "gear" anything
//           not dear, "wear" clothing, armour and bags, "guns", "tools", "paper" books and manuals, "dear" valuables)
//   only    it takes nothing else (items of that class only; no supplies): its spare room is no room for the rest
//   max     at most this many items (a gun rack's six slots)
//   food    food may be kept in it (a crate, a shelf, a cabinet, a pallet rack); never in the rest
/** @type {Record<string, { first?: string, only?: string, max?: number, food?: boolean }>} */
export const FURN_STORE = {
  shelf: { first: "gear", food: true }, rack: { food: true }, crate: { food: true }, cabinet: { first: "gear", food: true }, counter: { food: true },
  locker: { first: "gear" }, filing: { only: "paper" }, bookshelf: { first: "paper" }, wardrobe: { first: "wear" }, dresser: { first: "wear" },
  nightstand: { first: "wear" }, displaycase: { first: "dear" }, vending: { food: true }, toolchest: { only: "tools" }, gunrack: { only: "guns", max: 6 },
};
// Comfort (furniture.js comfortLine, relations.js moodFactors): one line a day "Comforts: sofa, rug (+0.6)" for each
// person sleeping in a building with comfort pieces in it.
//   SEATS      a sofa, an armchair, a piano, a dining table each serves this many of the building's sleepers: with more
//              sleepers than its pieces serve, each gets their share (2 sofas for 12 sleepers: +0.5 each; 1: +0.25)
//   DECOR_MAX  decor (DECOR: a plant, a floor lamp, a painting, a wall clock, a chair, a bar stool, a desk; DECOR_MOOD
//              each) adds at most this a building
//   books      a bookshelf with a book or a manual kept in it (containers.js) counts as a comfort piece of this much
//   MAX        a person's comfort line at most (a base's: the best building's)
export const COMFORT = { SEATS: 6, DECOR_MAX: 0.5, books: 0.25, MAX: 1.5 };
export const DECOR = new Set(["chair", "barstool", "desk", "teacherdesk", "plant", "floorlamp", "painting", "wallclock"]); // #13's decor kinds too: the ticket's +0.1 each, whatever their row's comfort
export const DECOR_MOOD = 0.1; // a desk's, as decor
// Salvage (inventory.js SALVAGE_ELECTRONICS): a server rack taken apart gives its boards.
export const FURN_SALVAGE = { f_serverrack: 3 }; // (the server rack's item: #12 merges it into GEAR)
// The placed pieces (buildings.js Object.assign(BUILDINGS, FURN_BUILDINGS)), as the beds': fit, furniture, no cost, no
// hours (the item is the cost), found: true (the Build list shows one only while one is in the stores), storeKg for a
// storage piece (basestorage.js storageOf: a building container).
const useKg = (use) => (/^storage:/.test(use) ? Number(use.slice(8)) || 0 : 0);
/** @type {Record<string, number>} */
export const FURN_STORE_KG = Object.fromEntries(FURN_KINDS.filter((k) => useKg(FURNITURE_KINDS[k].use) > 0).map((k) => [`f_${k}`, useKg(FURNITURE_KINDS[k].use)]));
/** @type {Record<string, any>} */
export const FURN_BUILDINGS = Object.fromEntries(FURN_KINDS.map((k) => { const r = FURNITURE_KINDS[k]; return [`f_${k}`, {
  name: r.name, fit: true, furniture: true, found: true, cost: {}, hours: 0, max: 60, ...(useKg(r.use) ? { storeKg: useKg(r.use) } : {}),
  desc: `${r.name}, ${r.kg} kg${r.carry === "two" ? " (a two-person lift)" : ""}. Set from the stores onto the floor of a general building (${r.size[0]} × ${r.size[1]}). Demolish picks it up again (back into the stores).`,
}]; }));
// Their footprints (basemap.js Object.assign(FOOT, FURN_FOOT)): on a general building's floor only (fit), drawn as the
// kind's own cell (combat.js CELL: data-furniture.js furnitureCells).
/** @type {Record<string, any>} */
export const FURN_FOOT = Object.fromEntries(FURN_KINDS.map((k) => [`f_${k}`, { kind: "prop", k, w: FURNITURE_KINDS[k].size[0], h: FURNITURE_KINDS[k].size[1], fit: true, indoor: true }]));
// The base map's store weights (basemap.js STORES): a storage piece holds goods raiders search, as the shelves fitting.
/** @type {Record<string, number>} */
export const FURN_STORES = Object.fromEntries(Object.keys(FURN_STORE_KG).map((t) => [t, 1]));
// AI groups (furniture.js groupFurnitureDaily): their pieces are a count a base (f.works[tile][f_<kind>]), each itself
// on their base's map (groupbases.js WORKS_BUILDING).
/** @type {Record<string, string>} */
export const FURN_WORKS_BUILDING = Object.fromEntries(FURN_KINDS.map((k) => [`f_${k}`, `f_${k}`]));
export { FURNITURE_KINDS };
