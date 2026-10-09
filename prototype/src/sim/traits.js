// @ts-check
// Survivor traits (data.js TRAITS): the numbers of their rules, small helpers for the files that apply them, and how a
// new survivor comes by the newer ones.
//
// Where each trait works (the rule is in the file named; the numbers are TRAIT_FX):
//   Brave / Coward   world.js combatPower (±1), traitAim (±5 to hit: combat.js playerUnit, autopilot.js stormValue)
//   Tough / Frail    woundMult (× 0.75 / × 1.25 on wounds): world.js hurt, armour.js toughOf, breakoff.js memberOf
//   Lucky / Unlucky, Former Medic, Loud, Farm-Raised, Persuasive: world.js skill (every use of the skill)
//   Quick Study      skills.js gainXp: XP × LEARN (the day's caps count what was earned before it)
//   Iron Stomach     worm.js catchWorm (eggs swallowed: shrugged off STOMACH_SHRUG of the time, its own dice) and
//                    sickRoll (an upset stomach × STOMACH_SICK)
//   Quick Healer     healMult: medical.js healRatePerHour (a base, its hospital), orders.js campHealPerHour (a camp,
//                    a holding convoy), supply.js (a convoy's rest), prisoners.js (a prisoner's rations)
//   Strong Back      load.js maxLoad and feelFactor (and so the battle's load band: carrykit.js weighPlayer)
//   Fleet-Footed     carrykit.js weighPlayer (mob + FLEET_MOB), combat.js escapeOdds and breakoff.js (+ FLEET_ESCAPE),
//                    conflicts.js runBonus (+1 for a team on foot all of them)
//   Iron Will        breakMult: relations.js maybeBreak, mentalbreaks.js mentalBreaksDaily, morale.js desertion
//   Clumsy           meleeTraitAim (combat.js playerUnit), accidentMult: health.js work accidents and searchHazards
//   Glutton          appetite: upkeep.js foodUse (a base's residents), needs.js teamNeedsHour (hunger on the road)
//   Sickly           health.js frailty (× SICKLY) and conditionDrift (+ SICKLY_DRIFT)
//   Hothead          relations.js compat (− HOTHEAD_OPINION), maybeBreak (a fight × HOTHEAD_FIGHT), mentalbreaks.js
//                    snap (an attack × HOTHEAD_ATTACK)
// Everyone with traits plays by these: your people, the autopilot's, recruits, wanderers, prisoners, children grown
// up, and anyone of yours in a fight by the numbers. Other groups' people are numbers (factions.js strength), not
// survivors, so no trait touches them until they join you or are taken prisoner.
import { BIRTH_TRAITS, NEW_TRAITS, clashIn } from "./data.js";
import { Rng } from "./rng.js";

export const TRAIT_FX = {
  BRAVE_AIM: 5, COWARD_AIM: 5,
  TOUGH: 0.75, FRAIL: 1.25,
  LEARN: 1.25,
  STOMACH_SICK: 0.5, STOMACH_SHRUG: 1 / 3, STOMACH_HOW: ["water", "meat", "crop", "forage", "camp", "search"],
  HEAL: 1.3,
  STRONG_MAX: 48, STRONG_FEEL: 0.9,
  FLEET_MOB: 1, FLEET_ESCAPE: 10,
  FARM: 3, SPEECH: 3,
  WILL: 0.5,
  CLUMSY_MELEE: 10, CLUMSY_HURT: 1.5,
  GLUTTON: 1.25,
  SICKLY: 1.5, SICKLY_DRIFT: 1,
  HOTHEAD_OPINION: 10, HOTHEAD_FIGHT: 3, HOTHEAD_ATTACK: 2,
};
const FX = TRAIT_FX;

/** @param {any} s @param {string} t @returns {boolean} */
export const hasTrait = (s, t) => !!(s && Array.isArray(s.traits) && s.traits.includes(t));
// Damage from wounds × (not hunger, thirst or infection: world.js hurt's raw damage).
/** @param {any} s @returns {number} */
export const woundMult = (s) => (hasTrait(s, "tough") ? FX.TOUGH : hasTrait(s, "frail") ? FX.FRAIL : 1);
// To hit in battle, shots and blows (Brave, Coward).
/** @param {any} s @returns {number} */
export const traitAim = (s) => (hasTrait(s, "brave") ? FX.BRAVE_AIM : 0) - (hasTrait(s, "coward") ? FX.COWARD_AIM : 0);
// To hit with blows on top (Clumsy).
/** @param {any} s @returns {number} */
export const meleeTraitAim = (s) => (hasTrait(s, "clumsy") ? -FX.CLUMSY_MELEE : 0);
/** @param {any} s @returns {number} */
export const learnMult = (s) => (hasTrait(s, "quicklearner") ? FX.LEARN : 1);
// Healing at rest × (Quick Healer).
/** @param {any} s @returns {number} */
export const healMult = (s) => (hasTrait(s, "quickheal") ? FX.HEAL : 1);
// Food eaten × (Glutton).
/** @param {any} s @returns {number} */
export const appetite = (s) => (hasTrait(s, "glutton") ? FX.GLUTTON : 1);
// The chance of a break or of walking out × (Iron Will).
/** @param {any} s @returns {number} */
export const breakMult = (s) => (hasTrait(s, "ironwill") ? FX.WILL : 1);
// The chance of a cut or a sprain at work or searching × (Clumsy).
/** @param {any} s @returns {number} */
export const accidentMult = (s) => (hasTrait(s, "clumsy") ? FX.CLUMSY_HURT : 1);
// Battle: tiles a move (Fleet-Footed) and the escape check's bonus.
/** @param {any} s @returns {number} */
export const fleetMob = (s) => (hasTrait(s, "fleet") ? FX.FLEET_MOB : 0);
/** @param {any} s @returns {number} */
export const fleetEscape = (s) => (hasTrait(s, "fleet") ? FX.FLEET_ESCAPE : 0);
// Iron Stomach: are these eggs (swallowed this way: worm.js catchWorm's how) shrugged off? Its own dice, keyed by the
// seed, the person, the hour and the way, so the worm's dice and the world's are untouched.
/** @param {any} state @param {any} s @param {string} how @returns {boolean} */
export function stomachShrugs(state, s, how) {
  if (!hasTrait(s, "ironstomach") || !FX.STOMACH_HOW.includes(how)) return false;
  return traitHash((state && state.seed) || 1, s.id | 0, (state && state.hour) | 0, FX.STOMACH_HOW.indexOf(how)) < FX.STOMACH_SHRUG;
}

// A hash of whole numbers to 0 ≤ x < 1 (deterministic dice that draw nothing from any rng).
/** @param {...number} n @returns {number} */
export function traitHash(...n) {
  let h = 0x811c9dc5;
  for (const x of n) { h ^= x | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; }
  return (h >>> 0) / 4294967296;
}

// ---------- rolling at birth ----------
// world.js rollTraits draws one or two traits from BIRTH_TRAITS with the world's dice, exactly as it always did (so
// every seed keeps its map, its people and every later roll). Then each of them is, NEW_SHARE of the time, swapped for
// one of the newer traits (NEW_TRAITS, none twice, none that clashes with the other), with dice of their own: keyed by
// the seed and how many people the world has made (like their looks and their Crafting: appearance.js), so the world's
// dice never see it. NEW_SHARE is the newer traits' share of all of them, so every trait is about as common as any
// other. How many traits someone has stays the world's draw. ON false: the old roll (tools/traitstest.js compares).
export const TRAIT_ROLL = { SALT: 0x7a17, NEW_SHARE: NEW_TRAITS.length / (NEW_TRAITS.length + BIRTH_TRAITS.length), ON: true };
// The dice for the n-th person a world makes.
/** @param {number} seed @param {number} n @returns {Rng} */
export const traitDice = (seed, n) => new Rng(((Math.imul((seed | 0) ^ TRAIT_ROLL.SALT, 2654435761) ^ Math.imul((n | 0) + 0x3c6e, 1597334677)) >>> 0) || 1);
// Swaps some of the rolled traits for newer ones (in place; returns the list).
/** @param {string[]} traits @param {{ next: () => number }} dice @returns {string[]} */
export function swapNewTraits(traits, dice) {
  if (!TRAIT_ROLL.ON || !dice) return traits;
  for (let i = 0; i < traits.length; i++) {
    const u = dice.next(), v = dice.next(); // two each, whatever comes of them
    if (u >= TRAIT_ROLL.NEW_SHARE) continue;
    const others = traits.filter((_, j) => j !== i);
    const pool = NEW_TRAITS.filter((t) => !others.includes(t) && !clashIn(others, t));
    if (pool.length) traits[i] = pool[Math.floor(v * pool.length)];
  }
  return traits;
}
// What the world's dice rolled for someone before the swap (world.js makeSurvivor): a start's backgrounds weigh their
// fitting trait by it (hardcore-start.js applyArchetype), so whether they draw that trait's dice stays as it was.
// Kept only while the world is being built (not saved): a WeakMap, gone with the person.
/** @type {WeakMap<object, string[]>} */
const BORN = new WeakMap();
/** @param {object} s @param {string[]} rolled */
export const noteBornTraits = (s, rolled) => { BORN.set(s, rolled); };
/** @param {any} s @returns {string[]} */
export const bornTraits = (s) => BORN.get(s) || (s && s.traits) || [];
