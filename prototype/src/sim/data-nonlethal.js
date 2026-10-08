// @ts-check
// Non-lethal weapons (nonlethal.js runs them): the taser and its cartridges, the stun baton, pepper spray. Plain data
// that imports nothing, merged like data-guns.js: data.js Object.assign(GEAR, NL_GEAR), combat.js Object.assign(WEAPONS,
// NL_WEAPONS) and NL_KIT_PATCH appended to KITS' lists. Kept out of data-guns.js (still the overhaul's empty stub on
// dev) so the roster branch's file merges without a conflict; move these entries into GUN_GEAR / GUN_WEAPONS /
// KIT_PATCH once the roster is on dev if one file is wanted.
// The taser and pepper spray are carried (a pocket, a pack slot, the off hand) and used beside the gun in hand: they are
// not WEAPONS. A taser holds 2 cartridges (item.shots, 2 when unset); a cartridge pack reloads it (1 action). Pepper
// spray: item.dur = sprays left (3 new; found part-used through itemcond.js).

/** @type {Record<string, any>} */
export const NL_GEAR = {
  taser:     { name: "Taser",                   slot: "pack", skill: null, power: 0, req: 0, value: 30, noise: 0, small: true, weight: 0.35, cat: "tools", nonlethal: "taser",
               desc: "A police conducted-energy pistol, carried beside the gun in hand. 1 action and the turn, up to 4 tiles, quiet: a person hit loses their next 2 actions and aims −20 the turn after; someone already under 40% health drops, knocked out. Nothing on the dead. Holds 2 cartridges; a cartridge pack reloads it (1 action)." },
  tasercart: { name: "Taser cartridges (pair)", slot: "pack", skill: null, power: 0, req: 0, value: 6, noise: 0, small: true, weight: 0.1, cat: "tools",
               desc: "Two spare cartridges for a taser: a reload (1 action in battle) when both of its own are spent." },
  pepper:    { name: "Pepper spray",            slot: "pack", skill: null, power: 0, req: 0, value: 8, noise: 0, small: true, dur: 3, weight: 0.15, cat: "tools", nonlethal: "pepper",
               desc: "A police canister of OC spray. 1 action: a cone up to 3 tiles in front of you (the preview shows it). Everyone living caught in it is blinded for 2 turns: −40 aim, no overwatch. The dead do not care. Three sprays when full." },
  stunbaton: { name: "Stun baton",              slot: "weapon", skill: "shooting", power: 1.2, req: 0, value: 22, noise: 0, small: true, dur: 50, weight: 0.7, cat: "melee",
               desc: "A prod baton with a charged tip. A quick melee weapon whose blows never kill a living person (at 0 they drop, knocked out) and stun them (−1 action on their next turn). On the dead it is only a light club. Good for takedowns (+20)." },
};

/** @type {Record<string, any>} */
export const NL_WEAPONS = {
  stunbaton: { name: "Stun baton", melee: true, dmg: [8, 14], quick: true, mclass: "blunt", takedown: 20, nonlethal: true, stun: 1 },
};

// Who carries them (combat.js KITS lists, appended): stun batons among the guards' weapons; tasers, cartridges, spray
// and batons on their bodies; spray on militia and soldiers now and then. The off-hand taser and spray an enemy brings
// to a fight are nonlethal.js NL_KIT (or the group's real arsenal, f.arsenal, when it has one).
/** @type {Record<string, Record<string, any[]>>} */
export const NL_KIT_PATCH = {
  guards:   { weapons: ["stunbaton"], loot: ["taser", "tasercart", "pepper", "stunbaton"], finds: ["pepper", "tasercart"] },
  soldiers: { loot: ["taser", "pepper"] },
  militia:  { loot: ["pepper"] },
};
