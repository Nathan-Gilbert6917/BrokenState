// @ts-check
// Weapons overhaul content (docs/weapons-overhaul-plan.md sections 3, 4, 13): new guns, melee weapons and launchers.
// Plain data that imports nothing, merged by one line each: data.js Object.assign(GEAR, GUN_GEAR), combat.js
// Object.assign(WEAPONS, GUN_WEAPONS) and the KIT_PATCH merge into KITS (each list field is appended to that kit's list).
// Owner: the roster agent (B). Keep every existing GEAR / WEAPONS key.
/** @type {Record<string, any>} */
export const GUN_GEAR = {};
/** @type {Record<string, any>} */
export const GUN_WEAPONS = {};
/** @type {Record<string, Record<string, any[]>>} e.g. { raiders: { weapons: ["ak"], strong: ["ak"] } } */
export const KIT_PATCH = {};
