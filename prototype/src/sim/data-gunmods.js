// @ts-check
// More attachments, gun platforms and their slots (docs/weapons-overhaul-plan.md sections 5, 9). Plain data that
// imports nothing; data.js merges MOD_GEAR into GEAR. gunmods.js reads PLATFORMS / WEAPON_PLATFORM once filled.
// Owner: the economy agent (C) for the data, the UI agent (D) reads it for the gun builder.
/** @type {Record<string, any>} */
export const MOD_GEAR = {};
/** @type {Record<string, { slots: string[], [k: string]: any }>} */
export const PLATFORMS = {};
/** @type {Record<string, string>} weapon key -> platform key */
export const WEAPON_PLATFORM = {};
