// Hardcore's hard rules (issue #79, the user's request 2026-10-27: "I want hardcore mode to actually be hardcore"). A leaf
// module (roadstart.js only), so any sim module may read it. Everything here is 1 outside state.mode === "hardcore"; Normal
// (the same road start, roadstart.js isRoadStart) never meets it. Every number is in HARD.
//
// - Stakes: Hardcore is always Ironman (ui/newgame.js, main.js), has no "Keep playing" after an ending (ui/ui.js) and
//   no Customize points (Ironman's rule).
// - Scarcity and the wear of things: DIALS multiply the World… dials the sim reads (worldcfg.js cfgOf): hunger, thirst, food
//   spoilage, sickness, wear, failures, fuel, and the loot dials (a quarter to a half less ammo, meds, fuel; hardcore-loot.js
//   starts the sites below a normal start's loot instead of at twice it).
// - Injuries (the user, 2026-10-27: "injuries are either permanent or not permanent just take longer to heal"): none is
//   permanent; HEAL is the share of the usual healing speed (everywhere: bases, camps, the field) and INFECT how much worse an
//   infected wound is (it drains faster, sets in easier).
// - The threat: DIRECTOR scales hordes, raids, hive growth and the dead at sites with how big and settled you are
//   (directorMult), on top of DIALS; NOISE doubles what draws the dead (Field Heat); CAMP_ATTACK is the odds of an attack
//   on a base; raiders walk from the first days (hardcore-groups.js hcNoRaiders); a base overrun loses half again of its
//   stores (OVERRUN_TAKE).
// - People: tiredness, grief and mood weigh more, fewer strangers come asking (RECRUIT), the groups start cooler toward you.
// - Information (FOG): no 7-day forecast, no threat estimates, no last-seen times on the map, no auto-answered cards.
import { isHardcore } from "./roadstart.js";

export const HARD = {
  DIALS: { hunger: 1.2, thirst: 1.2, spoil: 1.5, sickness: 1.3, wear: 1.5, failures: 1.5, fuel: 1.25,
    zDmg: 1.15, infectBite: 1.5, worm: 1.25, raids: 1.3, siteDead: 1.15, hiveGrowth: 1.25,
    lootFood: 0.75, lootWater: 0.75, lootAmmo: 0.5, lootMeds: 0.5, lootGuns: 0.8, lootFuel: 0.6, lootParts: 0.8, lootScrap: 0.9 },
  HEAL: 0.6, INFECT: 1.4,
  NOISE: 2, CAMP_ATTACK: 1.5,
  TIRED: 1.25, GRIEF: 1.5, MOOD_BREAK: 6, RECRUIT: 0.5, GOODWILL_START: -15, GOODWILL_DAILY: -0.1,
  OVERRUN_TAKE: 1.5, // factions.js: what raiders carry off a base they overrun (half again)
  LOOT_START: 0.8, // hardcore-loot.js: a site starts with this share of a normal start's loot (Normal's road start: 2)
  START_FUEL: 0.35, // the car's tank at the start, of the dice's
  DIRECTOR: { people: 0.04, bases: 0.05, from: 3, cap: 0.8, dials: ["hordes", "raids", "hiveGrowth", "siteDead"] },
  FOG: { forecast: true, threat: true, lastSeen: true, autoAnswer: true },
};

/** A hard multiplier (HARD[key]); 1 outside Hardcore. @param {any} state @param {"HEAL"|"INFECT"|"NOISE"|"CAMP_ATTACK"|"TIRED"|"GRIEF"|"RECRUIT"} key */
export const hardMult = (state, key) => (isHardcore(state) ? HARD[key] : 1);
/** The dial's hard multiplier (worldcfg.js cfgOf), the director's included; 1 outside Hardcore. @param {any} state @param {string} key */
export function hardDial(state, key) {
  if (!isHardcore(state)) return 1;
  return (HARD.DIALS[key] ?? 1) * (HARD.DIRECTOR.dials.includes(key) ? directorMult(state) : 1);
}
/** The threat that grows with you: 1 up to three people and no base, up to 1.8 (cached for the hour). @param {any} state */
export function directorMult(state) {
  if (!isHardcore(state)) return 1;
  const c = state._director;
  if (c && c.hour === state.hour) return c.v;
  const D = HARD.DIRECTOR;
  const people = (state.survivors || []).filter((s) => s.alive).length;
  const bases = (state.bases || []).length;
  const v = 1 + Math.min(D.cap, Math.max(0, people - D.from) * D.people + bases * D.bases);
  Object.defineProperty(state, "_director", { value: { hour: state.hour, v }, writable: true, enumerable: false, configurable: true }); // not saved
  return v;
}
/** Whether a piece of the information is hidden (HARD.FOG): Hardcore only. @param {any} state @param {"forecast"|"threat"|"lastSeen"|"autoAnswer"} what */
export const fogged = (state, what) => isHardcore(state) && !!HARD.FOG[what];
