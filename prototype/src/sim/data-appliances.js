// @ts-check
// Appliances at the base (#19, part of the interiors epic #7; 2026-10-25, the user's request: "I want all reasonable
// appliances, furniture and some decor to be lootable and taken to your base for use, like a fridge to hook up to a
// generator at a base to keep food longer or a oven, stove for cooking"). Plain data that imports only the catalogue (data-furniture.js, plain data too); the rules
// are sim/appliances.js (and electric.js for setting and picking up, power.js for the draw, storage.js for the cold
// rooms, cooking.js for the range's station).
//
// One rule for every appliance (the catalogue's `use` keys: fridge, freezer, stove, oven, microwave): its item form
// sits in the base's armory (carried home in both arms, a cart or a vehicle), it is SET from the stores onto a general
// building's floor (the base map's Build list: Power for the ones that draw power, Fittings for the range and the
// oven; electric.js setPlaced / setPlacedAt), and Demolish picks it up again, whole (electric.js pickUpPlaced). The
// Refrigerator (data-power.js POWER_GEAR.fridge, POWER_BUILDINGS.fridge, FRIDGE) stays the canonical `fridge`; the
// records here are merged into data-power.js's tables beside it (POWER_GEAR, POWER_BUILDINGS, POWER_FOOT,
// POWER_FIXTURES, POWER_TAGS), so every merge that reads those (data.js GEAR, buildings.js BUILDINGS, basemap.js FOOT,
// breakdowns.js FIXTURES, loot.js ITEM_TAGS) sees them with no edit of its own.
//
// THE KINDS (a building type each; its item form; the catalogue's cell kind and use; kg and carry are the catalogue's):
//   type           item          kind       use        kg   carry  need  what it does
//   fridge         fridge        fridge     fridge     60   two    1     40 days of food room at 0.25× its shelf (FRIDGE)
//   chest_freezer  f_freezer     freezer    freezer    45   two    2     60 days of food at the walk-in's 0.05× (COLD)
//   cold_case      f_coldcase    coldcase   fridge     120  two    2     a shop's glass-door cold case: 100 days at 0.3×
//   range          f_stove       stove      stove      50   two    1     a cooking station of its own (RANGE): no wood,
//                                                                       on the grid or on propane
//   oven           f_oven        oven       oven       40   two    0     the baking recipes at a range; ×1.25 with a
//                                                                       range in the same building (OVEN)
//   microwave      f_microwave   microwave  microwave  15   one    1     reheats: ×1.1 on a meal's time (MICROWAVE)
//   freezer_case   f_freezercase freezercase freezer   130  two    3     a store's upright freezer: 90 days at 0.05×
//   island_freezer f_islandfreezer islandfreezer freezer 110 two  3     a store's island freezer: 110 days at 0.05×
//   meat_case      f_meatcase    meatcase   fridge     140  two    2     a butcher's case: 70 days at 0.3×
//   (the last three a grocery store's, issue #22: their rows below each type's)
// Off (no power, switched off, short of power): a fridge, a freezer or a cold case still stands and is a cupboard (its
// room at room temperature: the walk-in freezer's thaw; the Power card says why); a range off the grid burns
// propane, with neither it is idle; a microwave off does nothing. A broken one holds and does nothing.
// The item rows are the catalogue's (#8: data-furniture.js FURNITURE_GEAR, f_<kind>: bulky, both arms, furniture: <kind>,
// weight: kg) with what setting it does (placed: the building type, a worth and a description of its use) on top.
//
// PROPANE (a new small supply, data.js SUPPLIES.propane: a kilo of bottled gas). A range off the grid burns RANGE.propane
// a batch cooked on it. Found with grills and camp stoves (PROPANE_FINDS by the site or point of interest searched,
// AREA_PROPANE by a raid's room: appliances.js rollPropane / rollAreaPropane, their own dice).
import { FURNITURE_KINDS, FURNITURE_GEAR, itemKey } from "./data-furniture.js"; // the catalogue (#8): the kinds, their kg, size and item forms (plain data)

// The cold rooms: days of food (2000 kcal) of room a piece, and the share of the shelf used a day while it has power.
/** @type {Record<string, { need: number, room: number, factor: number, kind: string, name: string }>} */
export const COLD = {
  chest_freezer: { need: 2, room: 60, factor: 0.05, kind: "freezer", name: "Chest freezers" }, // the walk-in's rate (storage.js FACTOR.freezer)
  cold_case: { need: 2, room: 100, factor: 0.3, kind: "coldcase", name: "Cold cases" },
  // A grocery store's (issue #22): the upright glass-door freezer case and the island freezer at the walk-in freezer's
  // rate, the butcher's case at the cold case's.
  freezer_case: { need: 3, room: 90, factor: 0.05, kind: "freezer", name: "Freezer cases" },
  island_freezer: { need: 3, room: 110, factor: 0.05, kind: "freezer", name: "Island freezers" },
  meat_case: { need: 2, room: 70, factor: 0.3, kind: "coldcase", name: "Butcher's cases" },
};
// The range: power while it cooks (or propane a batch without), one cook at it a day (hours: work-hours a day at it,
// as a cook fire's tender's COOK.fireHours, more: no fire to mind), one range in use a `per` people living here.
export const RANGE = { need: 1, propane: 0.1, per: 10, hours: 6 };
export const OVEN = { boost: 1.25 };
export const MICROWAVE = { need: 1, boost: 1.1 };

// The catalogue's kind of each type (#8 FURNITURE_KINDS keys): its cell on the base map and the base's battle map
// (combat.js CELL), its size and its kg.
/** @type {Record<string, string>} */
export const APPLIANCE_KINDS = { chest_freezer: "freezer", cold_case: "coldcase", range: "stove", oven: "oven", microwave: "microwave", freezer_case: "freezercase", island_freezer: "islandfreezer", meat_case: "meatcase" }; // the last three: a grocery store's (issue #22)
export const APPLIANCE_TYPES = Object.keys(APPLIANCE_KINDS);
const kg = (t) => FURNITURE_KINDS[APPLIANCE_KINDS[t]].kg;
const gear = (t) => FURNITURE_GEAR[itemKey(APPLIANCE_KINDS[t])];

// The item forms (data.js GEAR, through data-power.js POWER_GEAR): the catalogue's row, set as its building type.
/** @type {Record<string, any>} */
export const APPLIANCE_GEAR = {
  [itemKey("freezer")]: { ...gear("chest_freezer"), value: 18, placed: "chest_freezer",
    desc: `A white chest freezer, its lid taped shut and its cord coiled on top. ${kg("chest_freezer")} kg: two to lift it, a cart or a vehicle. Set it inside a hut, cabin, lodge, hall or barn (the base map's Build list, Power): with ${COLD.chest_freezer.need} power it keeps ${COLD.chest_freezer.room} days of food frozen (a twentieth of its shelf a day, as the walk-in freezer); without power it is only a cupboard.` },
  [itemKey("coldcase")]: { ...gear("cold_case"), value: 20, placed: "cold_case",
    desc: `A shop's glass-door cold case, its compressor in the base. ${kg("cold_case")} kg: a cart or a vehicle, two people at least. Set it inside a general building (Build list, Power): with ${COLD.cold_case.need} power it keeps ${COLD.cold_case.room} days of food chilled at ${COLD.cold_case.factor}× its shelf a day; without power it is only a cupboard.` },
  [itemKey("freezercase")]: { ...gear("freezer_case"), value: 22, placed: "freezer_case",
    desc: `A supermarket's upright freezer case: glass doors, wire shelves, the compressor on top. ${kg("freezer_case")} kg: a cart or a vehicle, two people at least. Set it inside a general building (Build list, Power): with ${COLD.freezer_case.need} power it keeps ${COLD.freezer_case.room} days of food frozen (a twentieth of its shelf a day, as the walk-in freezer); without power it is only a cupboard.` },
  [itemKey("islandfreezer")]: { ...gear("island_freezer"), value: 22, placed: "island_freezer",
    desc: `A supermarket's island freezer: a long open chest under sliding glass lids. ${kg("island_freezer")} kg: a cart or a vehicle, two people at least. Set it inside a general building (Build list, Power): with ${COLD.island_freezer.need} power it keeps ${COLD.island_freezer.room} days of food frozen (the walk-in freezer's rate); without power it is only a cupboard.` },
  [itemKey("meatcase")]: { ...gear("meat_case"), value: 18, placed: "meat_case",
    desc: `A butcher's counter case: curved glass over a chilled tray, the compressor in its base. ${kg("meat_case")} kg: a cart or a vehicle, two people at least. Set it inside a general building (Build list, Power): with ${COLD.meat_case.need} power it keeps ${COLD.meat_case.room} days of food chilled at ${COLD.meat_case.factor}× its shelf a day; without power it is only a cupboard.` },
  [itemKey("stove")]: { ...gear("range"), name: "Kitchen range", value: 16, placed: "range",
    desc: `A four-ring kitchen range, dual fuel: a plug and a gas hose on the back. ${kg("range")} kg: two to lift it, a cart or a vehicle. Set it inside a general building (Build list, Fittings) and it is a cooking station of its own, burning no wood: ${RANGE.need} power while it cooks, or ${RANGE.propane} propane a batch off the grid; with neither it stands idle. One cook at it a day, one range for every ${RANGE.per} people living here.` },
  [itemKey("oven")]: { ...gear("oven"), value: 12, placed: "oven",
    desc: `A wall oven out of a kitchen, its racks inside. ${kg("oven")} kg: two to lift it, a cart or a vehicle. Set it inside a general building (Build list, Fittings): with a range at the base, the range bakes (bread from flour), and a range in the same building cooks ×${OVEN.boost} as fast. It heats on the range's own power or gas.` },
  [itemKey("microwave")]: { ...gear("microwave"), value: 8, placed: "microwave",
    desc: `A countertop microwave. ${kg("microwave")} kg: one person carries it. Set it inside a general building (Build list, Power): with ${MICROWAVE.need} power the meals are reheated, not cooked again: ×${MICROWAVE.boost} on a meal's time at every station here. No recipes of its own.` },
};

// The set pieces (buildings.js BUILDINGS, through POWER_BUILDINGS): fittings set from the stores, never queued for the
// builders; item: the stores' item key (electric.js placedItemKey); menu: the Build list's group when it is not the
// one its flags give (basemap.js buildMenu: the range and the oven are Fittings, the user's request).
/** @type {Record<string, any>} */
export const APPLIANCE_BUILDINGS = {
  chest_freezer: { name: "Chest freezer", fit: true, furniture: true, grid: true, set: true, cost: {}, hours: 0, max: 6, item: itemKey("freezer"), use: "freezer",
    desc: `A chest freezer set on a general building's floor: with ${COLD.chest_freezer.need} power, ${COLD.chest_freezer.room} days of food room that keeps food twenty times longer than the shelf (the walk-in freezer's rate). Off, a cupboard: the food thaws. Demolish picks it up again.` },
  cold_case: { name: "Cold case", fit: true, furniture: true, grid: true, set: true, cost: {}, hours: 0, max: 3, item: itemKey("coldcase"), use: "fridge",
    desc: `A shop's cold case set on a general building's floor: with ${COLD.cold_case.need} power, ${COLD.cold_case.room} days of food room at ${COLD.cold_case.factor}× the shelf a day. Off, a cupboard. Demolish picks it up again.` },
  freezer_case: { name: "Freezer case", fit: true, furniture: true, grid: true, set: true, cost: {}, hours: 0, max: 3, item: itemKey("freezercase"), use: "freezer",
    desc: `A store's upright freezer case set on a general building's floor: with ${COLD.freezer_case.need} power, ${COLD.freezer_case.room} days of food room that keeps food twenty times longer than the shelf. Off, a cupboard: the food thaws. Demolish picks it up again.` },
  island_freezer: { name: "Island freezer", fit: true, furniture: true, grid: true, set: true, cost: {}, hours: 0, max: 3, item: itemKey("islandfreezer"), use: "freezer",
    desc: `A store's island freezer set on a general building's floor: with ${COLD.island_freezer.need} power, ${COLD.island_freezer.room} days of food room that keeps food twenty times longer than the shelf. Off, a cupboard: the food thaws. Demolish picks it up again.` },
  meat_case: { name: "Butcher's case", fit: true, furniture: true, grid: true, set: true, cost: {}, hours: 0, max: 3, item: itemKey("meatcase"), use: "fridge",
    desc: `A butcher's counter case set on a general building's floor: with ${COLD.meat_case.need} power, ${COLD.meat_case.room} days of food room at ${COLD.meat_case.factor}× the shelf a day. Off, a cupboard. Demolish picks it up again.` },
  range: { name: "Kitchen range", fit: true, furniture: true, grid: true, set: true, cost: {}, hours: 0, max: 4, item: itemKey("stove"), use: "stove", menu: "Fittings",
    desc: `A kitchen range set on a general building's floor: a cooking station of its own (the Farming tab's Cooking: its bills), no wood. ${RANGE.need} power while its bills cook, or ${RANGE.propane} propane a batch off the grid (a gas range runs without the grid); with neither it is idle. One cook at a range a day (${RANGE.hours} hours), one range for every ${RANGE.per} people here. A cheaper way to cooked meals than the Kitchen, without its hot-meal service. Demolish picks it up again.` },
  oven: { name: "Oven", fit: true, furniture: true, set: true, cost: {}, hours: 0, max: 4, item: itemKey("oven"), use: "oven", menu: "Fittings",
    desc: `An oven set on a general building's floor: with a range here the range bakes (bread), and a range in the same building cooks ×${OVEN.boost} as fast. Demolish picks it up again.` },
  microwave: { name: "Microwave", fit: true, furniture: true, grid: true, set: true, cost: {}, hours: 0, max: 2, item: itemKey("microwave"), use: "microwave",
    desc: `A microwave set on a general building's floor: with ${MICROWAVE.need} power while the cooks work, ×${MICROWAVE.boost} on every meal's time at the stations here (it reheats; no recipes). Demolish picks it up again.` },
};
// Their footprints (basemap.js FOOT, through POWER_FOOT): a fitting on a general building's floor, drawn as the
// catalogue's own cell (basemap.js FIT's shape) at the catalogue's size.
/** @type {Record<string, any>} */
export const APPLIANCE_FOOT = Object.fromEntries(APPLIANCE_TYPES.map((t) => { const d = FURNITURE_KINDS[APPLIANCE_KINDS[t]]; return [t, { kind: "prop", k: APPLIANCE_KINDS[t], w: d.size[0], h: d.size[1], fit: true, indoor: true }]; }));
// Wear (breakdowns.js FIXTURES, through POWER_FIXTURES): the cold ones by the days they had power (as the fridge), the
// range and the oven by the days they cooked (ranDay: b.ran), the microwave by the days it had power.
/** @type {Record<string, any>} */
export const APPLIANCE_FIXTURES = {
  chest_freezer: { power: true, use: 0.4, idle: 0.02, spares: 30, repair: { hours: 4, cost: { scrap: 2, parts: 1 }, min: 2 }, rig: { hours: 1, cost: { scrap: 1 }, min: 1 }, what: "a dead compressor: the food in it thaws" },
  cold_case: { power: true, use: 0.5, idle: 0.02, spares: 24, repair: { hours: 5, cost: { scrap: 3, parts: 1 }, min: 2 }, rig: { hours: 1, cost: { scrap: 1 }, min: 1 }, what: "a dead compressor: the food in it warms" },
  freezer_case: { power: true, use: 0.5, idle: 0.02, spares: 24, repair: { hours: 5, cost: { scrap: 3, parts: 1 }, min: 2 }, rig: { hours: 1, cost: { scrap: 1 }, min: 1 }, what: "a dead compressor: the food in it thaws" },
  island_freezer: { power: true, use: 0.5, idle: 0.02, spares: 24, repair: { hours: 5, cost: { scrap: 3, parts: 1 }, min: 2 }, rig: { hours: 1, cost: { scrap: 1 }, min: 1 }, what: "a dead compressor: the food in it thaws" },
  meat_case: { power: true, use: 0.5, idle: 0.02, spares: 24, repair: { hours: 4, cost: { scrap: 2, parts: 1 }, min: 2 }, rig: { hours: 1, cost: { scrap: 1 }, min: 1 }, what: "a dead compressor: the food in it warms" },
  range: { ranDay: true, use: 0.4, idle: 0.01, spares: 40, repair: { hours: 3, cost: { scrap: 2, parts: 1 }, min: 1 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "no cooking at the range" },
  oven: { ranDay: true, use: 0.3, idle: 0.01, spares: 50, repair: { hours: 2, cost: { scrap: 1, parts: 1 }, min: 1 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "no baking, no ×1.25" },
  microwave: { power: true, use: 0.3, idle: 0.02, repair: { hours: 2, cost: { scrap: 1, electronics: 1 }, min: 1 }, rig: { hours: 1, cost: { scrap: 1 }, min: 0 }, what: "no reheating" },
};
// Where they are kept (loot.js ITEM_TAGS, through POWER_TAGS).
/** @type {Record<string, string[]>} */
export const APPLIANCE_TAGS = {
  f_freezer: ["home", "kitchen", "farm"], f_coldcase: ["shop", "kitchen"], f_freezercase: ["shop"], f_islandfreezer: ["shop"], f_meatcase: ["shop", "kitchen"], f_stove: ["home", "kitchen"], f_oven: ["home", "kitchen"], f_microwave: ["home", "kitchen", "office"],
};
// The State Map's hour-by-hour finds (data-power.js POWER_FINDS, merged there by the site): the range at a third of
// the fridge's weight, the freezer in houses and farms, the microwave in houses and offices.
/** @type {Record<string, Record<string, number>>} */
export const APPLIANCE_FINDS = {
  house: { f_stove: 1, f_freezer: 0.6, f_microwave: 1, f_oven: 0.5 },
  neighbourhood: { f_stove: 1, f_freezer: 0.6, f_microwave: 1, f_oven: 0.5 },
  apartments: { f_stove: 1, f_microwave: 1.5 },
  farm: { f_stove: 0.33, f_freezer: 1 },
};
// Propane: [chance a search hour at a full pool (or a raid container), min, max] kilos.
/** @type {Record<string, number[]>} */
export const PROPANE_FINDS = {
  hardware: [0.25, 2, 6], campground: [0.15, 1, 3], gas: [0.2, 1, 4], truckstop: [0.12, 1, 3], house: [0.04, 1, 2], neighbourhood: [0.05, 1, 2],
  farm: [0.06, 1, 3], ranch: [0.05, 1, 3], cabin: [0.06, 1, 2], lodge: [0.05, 1, 2], garage: [0.06, 1, 2], shed: [0.05, 1, 2],
};
/** @type {Record<string, number[]>} */
export const AREA_PROPANE = { garage: [0.06, 1, 2], hardware: [0.12, 1, 4], campsite: [0.1, 1, 2], house: [0.03, 1, 1], farmhouse: [0.05, 1, 2], cabin: [0.05, 1, 2], pitroom: [0.6, 1, 3] }; // pitroom: a BBQ's pit room (issue #33)
