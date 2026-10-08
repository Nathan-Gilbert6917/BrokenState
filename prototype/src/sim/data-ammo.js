// @ts-check
// Calibres, ammo types and boxes of rounds (docs/weapons-overhaul-plan.md sections 1, 12 and the section 20 decision:
// every calibre and type is its own box, common rounds included). Plain data that imports nothing; data.js merges
// AMMO_GEAR and RELOAD_GEAR into GEAR. Owner: the ballistics agent (A) for CALIBERS / AMMO_TYPES / AMMO_GEAR /
// KIT_AMMO, the economy agent (C) for RELOAD_GEAR (brass, powder, primers).
// A box is a count stack: GEAR `count: true`, item.dur = rounds left (valuation.js / inventory.js weigh and price it
// by the share left).
/** @type {Record<string, any>} */
export const CALIBERS = {};
/** @type {Record<string, any>} */
export const AMMO_TYPES = {};
/** @type {Record<string, any>} */
export const AMMO_GEAR = {};
/** @type {Record<string, any>} */
export const RELOAD_GEAR = {};
/** @type {Record<string, any>} enemy loads by kit (section 6) */
export const KIT_AMMO = {};
