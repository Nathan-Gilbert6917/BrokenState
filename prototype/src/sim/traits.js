// @ts-check
// Survivor traits (data.js TRAITS): their tiers, points and numbers (TRAIT_TIERS), the helpers the files that apply
// them call, and how a new survivor comes by the newer ones and by a tier.
//
// Tiers (2026-10-08, user request: "add tiers to positive and negative traits that scale the points"): a good or bad
// trait comes as I, II or III (II for Lucky and Unlucky, one tier for the neutral ones). s.traits stays a list of keys,
// so every traits.includes(...) still works; the tier is kept beside it, s.traitTier = { tough: 2 } (missing: tier I,
// the trait as it always was: an old save loads as tier I). Every number a trait changes goes through traitFx (one
// helper, one table), and the points a tier is worth under Customize (custompoints.js) are in the same row.
//
// Where each trait works (the rule is in the file named; its numbers are TRAIT_TIERS fx, by tier):
//   Brave / Coward   world.js combatPower (traitPower), traitAim (to hit: combat.js playerUnit, autopilot.js stormValue)
//   Tough / Frail    woundMult (× mult on wounds): world.js hurt, armour.js toughOf, breakoff.js memberOf
//   Lucky / Unlucky, Former Medic, Loud, Farm-Raised, Persuasive, Nearsighted, Squeamish: world.js skill (traitSkill,
//                    every use of the skill)
//   Quick Study / Slow Learner   skills.js gainXp: XP × learnMult (the day's caps count what was earned before it)
//   Iron Stomach     worm.js catchWorm (eggs swallowed: shrugged off `shrug` of the time, its own dice) and sickRoll
//                    (an upset stomach × stomachMult); Weak Stomach: sickRoll × stomachMult
//   Quick Healer     healMult: medical.js healRatePerHour (a base, its hospital), orders.js campHealPerHour (a camp,
//                    a holding convoy), supply.js (a convoy's rest), prisoners.js (a prisoner's rations)
//   Strong Back / Bad Back / Feeble   load.js maxLoad and feelFactor (and so the battle's load band: carrykit.js)
//   Fleet-Footed / Slow   carrykit.js weighPlayer (mob + fleetMob), combat.js escapeOdds and breakoff.js (+ fleetEscape),
//                    conflicts.js runBonus (+1 a team on foot all Fleet-Footed, −1 a team on foot with anyone Slow)
//   Iron Will        breakMult: relations.js maybeBreak, mentalbreaks.js mentalBreaksDaily, morale.js desertion
//   Clumsy / Feeble  meleeTraitAim (combat.js playerUnit); Clumsy accidentMult: health.js work accidents, searchHazards
//   Glutton          appetite: upkeep.js foodUse (a base's residents), needs.js teamNeedsHour (hunger on the road),
//                    eating.js (hunger at a base, and they eat to 100)
//   Picky Eater / Vegetarian / Cannibal (2026-10-11)   eating.js noteEat (timed food thoughts) and the menu (a
//                    Vegetarian's plant food first)
//   Sickly           health.js frailty (× sicklyMult) and conditionDrift (+ sicklyDrift)
//   Hothead          relations.js compat (− opinion), maybeBreak (a fight × fight), mentalbreaks.js snap (× attack)
//   Keen Eye         markers.js perceptionChance (+ notice), parties.js sight (+ sight), survey.js (the keen eye):
//                    the team's best (teamTraitFx)
//   Night Owl        conflicts.js spotting others first (+ night by night, − day by day)
//   Squeamish        relations.js onDeath (a death in the group: − grief mood); Pessimist relations.js moodFactors
//   Tactical (2026-10-09)  combat.js playerUnit (u.tact) and shotOdds: + to hit a flanked target, − to be hit in cover,
//                    + to hit for allies near them (the best one near, not stacked; melee too: meleeOdds); world.js
//                    combatPower (traitPower: + fighting strength by the numbers: autopilot, conflicts, breakoff)
//   Strategic        conflicts.js conflictChance (the team's road encounters × encounterMult, its best tier);
//                    intelest.js (estimates of other groups' bases and parties: error × intelMult, your best at a base)
//   Diplomatic       factions.js changeGoodwill (gains × and losses × goodwillMult: your best among the free; a change
//                    that sets goodwill to a value passes exact and is left alone); conflicts.js bribeChoice (a toll or
//                    bribe × bribeMult, the team's best); radiotrade.js minFee (the lowest delivery fee, − feeCut of
//                    their fee, the best at the calling base)
// Everyone with traits plays by these: your people, the autopilot's, recruits, wanderers, prisoners, children grown
// up, and anyone of yours in a fight by the numbers. Other groups' people are numbers (factions.js strength), not
// survivors, so no trait touches them until they join you or are taken prisoner.
import { TRAITS, BIRTH_TRAITS, SWAP_TRAITS, LATE_TRAITS, DIET_TRAITS, DIET_ROLLED, clashIn, traitKind } from "./data.js";
import { Rng } from "./rng.js";

// ---------- the tiers: points and numbers (tune here) ----------
// One row a trait. pts: the points each tier is worth under Customize (custompoints.js: a good trait costs them, a bad
// one gives them back, a neutral one is free); as many tiers as pts has. fx: the trait's numbers, one a tier (tier I
// first: the trait as it was before tiers). say: the tooltip for a tier's numbers. A skill level is worth 1 point up to
// level 10 (custompoints.js SKILL_STEPS), so +4 Medicine is about 4 points.
const pc = (v) => `${Math.round(v * 100)}%`;
const shrugText = (v) => (v < 0.4 ? "1 time in 3" : v < 0.6 ? "half the time" : "2 times in 3");
export const TRAIT_TIERS = {
  // good: they cost points
  brave:        { pts: [3, 5, 8],    fx: { power: [1, 1, 2], aim: [5, 8, 12] }, say: (f) => `Fights harder: +${f.power} fighting strength, +${f.aim}% to hit in battle` },
  medic:        { pts: [4, 6, 8],    fx: { skill: [4, 6, 8] }, say: (f) => `+${f.skill} Medicine` },
  tough:        { pts: [4, 7, 10],   fx: { mult: [0.75, 0.65, 0.55] }, say: (f) => `Takes ${pc(1 - f.mult)} less damage from wounds (not from hunger, thirst or infection)` },
  keeneye:      { pts: [3, 5, 8],    fx: { sight: [1, 1, 2], notice: [0.15, 0.25, 0.35] }, say: (f) => `+${f.sight} sight radius for their team, and it notices hidden finds more often (+${pc(f.notice)})` },
  lucky:        { pts: [8, 15],      fx: { all: [1, 2] }, say: (f) => `+${f.all} to every skill` },
  quicklearner: { pts: [3, 5, 7],    fx: { learn: [1.25, 1.4, 1.6] }, say: (f) => `Learns ${pc(f.learn - 1)} faster: +${pc(f.learn - 1)} XP from everything (use, study, fights)` },
  ironstomach:  { pts: [2, 3, 4],    fx: { sick: [0.5, 0.35, 0.2], shrug: [1 / 3, 1 / 2, 2 / 3] }, say: (f) => `${pc(1 - f.sick)} less chance of an upset stomach from un-purified water or uncooked food, and shrugs off the worm's eggs ${shrugText(f.shrug)} (water, raw food, camping, searching)` },
  quickheal:    { pts: [3, 5, 7],    fx: { heal: [1.3, 1.5, 1.75] }, say: (f) => `Wounds heal ${pc(f.heal - 1)} faster while resting (at a base, in a hospital bed, in camp, as a prisoner)` },
  strongback:   { pts: [3, 5, 7],    fx: { max: [48, 52, 56], feel: [0.9, 0.85, 0.8] }, say: (f) => `Max load ${f.max} kg instead of 40, and loads feel ${pc(1 - f.feel)} lighter (a better load band)` },
  fleet:        { pts: [3, 5, 8],    fx: { mob: [1, 1, 2], escape: [10, 15, 20] }, say: (f) => `+${f.mob} tile${f.mob === 1 ? "" : "s"} a move in battle, and +${f.escape}% to break off and get away from a fight (a team on foot all Fleet-Footed: +1 to Run for it on the road)` },
  farmraised:   { pts: [3, 5, 7],    fx: { skill: [3, 5, 7], cook: [1, 2, 3] }, say: (f) => `+${f.skill} Farming, +${f.cook} Cooking` }, // cook: kitchen-plus (Cooking, 2026-10-10)
  persuasive:   { pts: [3, 5, 7],    fx: { skill: [3, 5, 7] }, say: (f) => `+${f.skill} Speech (better prices, talks, recruiting)` },
  ironwill:     { pts: [3, 5, 7],    fx: { mult: [0.5, 0.35, 0.2] }, say: (f) => `${pc(1 - f.mult)} less likely to break down (small breaks and mental breaks) or walk out when mood is low` },
  // 2026-10-09 (user request): Tactical (the battle), Strategic (the State Map), Diplomatic (the other groups).
  tactical:     { pts: [4, 6, 9],    fx: { flank: [10, 15, 20], cover: [5, 8, 12], aura: [3, 4, 5], power: [0.5, 1, 1.5] }, say: (f) => `Reads a fight: +${f.flank}% to hit a flanked target (in cover, none facing them), −${f.cover}% to be hit while in cover, and allies within 2 tiles get +${f.aura}% to hit (shots and blows; the best one near counts); +${f.power} fighting strength in a fight by the numbers` },
  strategic:    { pts: [3, 5, 7],    fx: { enc: [0.1, 0.15, 0.2], intel: [0.15, 0.25, 0.35] }, say: (f) => `Plans ahead: their team meets ${pc(f.enc)} less trouble on the road (routes and hours picked), and while they are at one of your bases your estimates of other groups' bases and parties are ${pc(f.intel)} sharper (narrower ranges)` },
  diplomatic:   { pts: [3, 5, 7],    fx: { gw: [0.1, 0.15, 0.2], bribe: [0.1, 0.15, 0.2], fee: [0.1, 0.15, 0.2] }, say: (f) => `Knows how to deal: goodwill with groups rises ${pc(f.gw)} faster and falls ${pc(f.gw)} slower (while they are free), their team's bribes and tolls cost ${pc(f.bribe)} less, and in radio deals from their base groups take a delivery fee ${pc(f.fee)} lower` },
  // neutral: a real trade-off, free, one tier
  nightowl:     { pts: [0],          fx: { night: [0.15], day: [0.05] }, say: (f) => `At night their team is ${pc(f.night)} more likely to spot others first; by day, drowsy, ${pc(f.day)} less likely` },
  greedy:       { pts: [0],          fx: {}, say: () => TRAITS.greedy.desc },
  // bad: they give points back
  coward:       { pts: [-3, -5, -8], fx: { power: [1, 1, 2], aim: [5, 8, 12] }, say: (f) => `Fights worse: −${f.power} fighting strength, −${f.aim}% to hit in battle; may lose their nerve on a trip` },
  loud:         { pts: [-3, -5, -7], fx: { skill: [3, 5, 7] }, say: (f) => `−${f.skill} Stealth` },
  badback:      { pts: [-3, -5, -7], fx: { max: [28, 24, 20], feel: [1.2, 1.3, 1.4] }, say: (f) => `Max load ${f.max} kg instead of 40, and loads feel ${pc(f.feel - 1)} heavier (a worse load band)` },
  unlucky:      { pts: [-8, -15],    fx: { all: [1, 2] }, say: (f) => `−${f.all} to every skill` },
  frail:        { pts: [-4, -7, -10], fx: { mult: [1.25, 1.35, 1.45] }, say: (f) => `Takes ${pc(f.mult - 1)} more damage from wounds (not from hunger, thirst or infection)` },
  clumsy:       { pts: [-2, -4, -6], fx: { melee: [10, 15, 20], hurt: [1.5, 1.75, 2] }, say: (f) => `−${f.melee}% to hit in melee, and ${pc(f.hurt - 1)} more cuts and sprains at work and when searching` },
  glutton:      { pts: [-2, -4, -6], fx: { eat: [1.25, 1.4, 1.6] }, say: (f) => `Eats ${pc(f.eat - 1)} more: a bigger share of the ration at a base, and hunger falls ${pc(f.eat - 1)} faster on the road` },
  sickly:       { pts: [-3, -5, -7], fx: { sick: [1.5, 1.75, 2], drift: [1, 1, 2] }, say: (f) => `Falls ill ${pc(f.sick - 1)} more often, and illnesses clear ${f.drift} point${f.drift === 1 ? "" : "s"} a day slower` },
  hothead:      { pts: [-3, -5, -7], fx: { opinion: [10, 15, 20], fight: [3, 4, 5], attack: [2, 2.5, 3] }, say: (f) => `Gets along worse with everyone (−${f.opinion} opinion), and when they break they lash out: fights ×${f.fight} and attacks ×${f.attack} as likely` },
  slow:         { pts: [-3, -5, -8], fx: { mob: [1, 1, 2], escape: [10, 15, 20] }, say: (f) => `−${f.mob} tile${f.mob === 1 ? "" : "s"} a move in battle, and −${f.escape}% to break off and get away from a fight (a team on foot with them: −1 to Run for it on the road)` },
  slowlearner:  { pts: [-3, -5, -7], fx: { learn: [0.8, 0.65, 0.5] }, say: (f) => `Learns ${pc(1 - f.learn)} slower: −${pc(1 - f.learn)} XP from everything (use, study, fights)` },
  weakstomach:  { pts: [-2, -3, -4], fx: { sick: [1.5, 2, 2.5] }, say: (f) => `${pc(f.sick - 1)} more likely to get an upset stomach from un-purified water or uncooked food` },
  nearsighted:  { pts: [-3, -5, -7], fx: { scout: [2, 3, 4], shoot: [1, 2, 3] }, say: (f) => `−${f.scout} Scouting and −${f.shoot} Shooting` },
  feeble:       { pts: [-2, -4, -6], fx: { kg: [4, 7, 10], melee: [5, 10, 15] }, say: (f) => `Max load ${f.kg} kg lower, and −${f.melee}% to hit in melee` },
  squeamish:    { pts: [-2, -4, -6], fx: { skill: [2, 3, 4], grief: [3, 5, 8] }, say: (f) => `−${f.skill} Medicine, and a death in the group hits their mood ${f.grief} points harder (wherever they are)` },
  pessimist:    { pts: [-2, -4, -6], fx: { mood: [0.5, 1, 1.5] }, say: (f) => `Always expects the worst: mood −${f.mood} a day` },
  // 2026-10-11 (wave 2 eating, user pick 3): eating.js noteEat, the timed food thoughts (mood once, lasting 2–5 days).
  // picky: a simple meal −simple, raw food −raw (on top of "Ate raw food"), a fine meal +fine (a lavish one × 1.5).
  picky:        { pts: [-2, -3, -5], fx: { simple: [3, 4, 6], raw: [4, 6, 8], fine: [2, 3, 4] }, say: (f) => `Fussy about food: a simple meal mood −${f.simple} and raw food −${f.raw} on top of the usual; a fine meal +${f.fine} and a lavish one +${Math.round(f.fine * 1.5)} on top` },
  vegetarian:   { pts: [-3],         fx: { meat: [6] }, say: (f) => `Eats plant food first (the menu puts it first); meat, fish, eggs, milk, honey or a mixed meal: mood −${f.meat} (2 days)` },
  cannibal:     { pts: [0],          fx: { lift: [10] }, say: (f) => `Human meat lifts their mood (+${f.lift}) where it turns anyone else's stomach (−20). There is no human meat in the game: the dead carry the worm` },
  // The prepper's background trait (hardcore-start.js): changes nothing in play, worth nothing.
  prepper:      { pts: [0],          fx: {}, say: () => TRAITS.prepper.desc },
};
// Tier I's numbers by their old names (the rules used to read them from here; the tools still may).
const T1 = (t, k) => TRAIT_TIERS[t].fx[k][0];
export const TRAIT_FX = {
  BRAVE_AIM: T1("brave", "aim"), COWARD_AIM: T1("coward", "aim"),
  TOUGH: T1("tough", "mult"), FRAIL: T1("frail", "mult"),
  LEARN: T1("quicklearner", "learn"),
  STOMACH_SICK: T1("ironstomach", "sick"), STOMACH_SHRUG: T1("ironstomach", "shrug"), STOMACH_HOW: ["water", "meat", "crop", "forage", "camp", "search"],
  HEAL: T1("quickheal", "heal"),
  STRONG_MAX: T1("strongback", "max"), STRONG_FEEL: T1("strongback", "feel"),
  FLEET_MOB: T1("fleet", "mob"), FLEET_ESCAPE: T1("fleet", "escape"),
  FARM: T1("farmraised", "skill"), SPEECH: T1("persuasive", "skill"),
  WILL: T1("ironwill", "mult"),
  CLUMSY_MELEE: T1("clumsy", "melee"), CLUMSY_HURT: T1("clumsy", "hurt"),
  GLUTTON: T1("glutton", "eat"),
  SICKLY: T1("sickly", "sick"), SICKLY_DRIFT: T1("sickly", "drift"),
  HOTHEAD_OPINION: T1("hothead", "opinion"), HOTHEAD_FIGHT: T1("hothead", "fight"), HOTHEAD_ATTACK: T1("hothead", "attack"),
};
const FX = TRAIT_FX;

// ---------- the helpers every rule calls ----------
/** @param {any} s @param {string} t @returns {boolean} */
export const hasTrait = (s, t) => !!(s && Array.isArray(s.traits) && s.traits.includes(t));
// How many tiers a trait comes in (1 for the neutral ones).
/** @param {string} t @returns {number} */
export const tierCount = (t) => (TRAIT_TIERS[t] ? TRAIT_TIERS[t].pts.length : 1);
// A tier made safe: a whole number 1..tierCount (anything else: 1).
/** @param {string} t @param {any} n @returns {number} */
export const cleanTier = (t, n) => { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.max(1, Math.min(tierCount(t), v)) : 1; };
// Someone's tier of trait t: 0 without it, else 1..tierCount (missing: 1).
/** @param {any} s @param {string} t @returns {number} */
export const traitTier = (s, t) => (hasTrait(s, t) ? cleanTier(t, s.traitTier && s.traitTier[t]) : 0);
// THE helper: trait t's number k for someone, at their tier (0 without the trait).
/** @param {any} s @param {string} t @param {string} k @returns {number} */
export function traitFx(s, t, k) {
  const n = traitTier(s, t);
  if (!n) return 0;
  const row = TRAIT_TIERS[t] && TRAIT_TIERS[t].fx[k];
  return row ? row[Math.min(n, row.length) - 1] : 0;
}
// A trait's numbers at a tier (the tooltips and the tools): { k: value }.
/** @param {string} t @param {number} [tier] @returns {Record<string, number>} */
export function tierFx(t, tier = 1) {
  const row = TRAIT_TIERS[t];
  if (!row) return {};
  const n = cleanTier(t, tier);
  return Object.fromEntries(Object.entries(row.fx).map(([k, v]) => [k, v[Math.min(n, v.length) - 1]]));
}
// A team's number for a trait that works for the whole team (Keen Eye, Night Owl): the highest tier among them.
/** @param {any[]} members @param {string} t @param {string} k @returns {number} */
export const teamTraitFx = (members, t, k) => (members || []).reduce((a, m) => Math.max(a, traitFx(m, t, k)), 0);
// The points a trait is worth at a tier under Customize (good +, bad −, neutral 0).
/** @param {string} t @param {number} [tier] @returns {number} */
export const traitPoints = (t, tier = 1) => { const row = TRAIT_TIERS[t]; return row ? row.pts[cleanTier(t, tier) - 1] : 0; };
const ROMAN = ["", "I", "II", "III", "IV"];
// "Tough II" (a one-tier trait: the name alone).
/** @param {string} t @param {number} [tier] @returns {string} */
export function traitLabel(t, tier = 1) {
  const name = TRAITS[t] ? TRAITS[t].name : t;
  return tierCount(t) > 1 ? `${name} ${ROMAN[cleanTier(t, tier)]}` : name;
}
// What a trait does at a tier, in words (TRAIT_TIERS say; else data.js desc).
/** @param {string} t @param {number} [tier] @returns {string} */
export function traitDesc(t, tier = 1) {
  const row = TRAIT_TIERS[t];
  if (row && row.say) return row.say(tierFx(t, tier));
  return TRAITS[t] ? TRAITS[t].desc : "";
}
// Someone's trait: key, tier, kind, "Tough II" and what it does at their tier.
/** @param {any} s @param {string} t */
export function traitOf(s, t) {
  const tier = traitTier(s, t) || cleanTier(t, s && s.traitTier && s.traitTier[t]);
  return { key: t, tier, kind: traitKind(t), label: traitLabel(t, tier), desc: traitDesc(t, tier) };
}
// Sets someone's tier of t (tier I is not written: missing is I); tiers of traits they no longer have go.
/** @param {any} s @param {string} t @param {number} tier */
export function setTier(s, t, tier) {
  tidyTiers(s, { ...(s.traitTier || {}), [t]: cleanTier(t, tier) });
}
/** @param {any} s @param {Record<string, number>} [m] */
export function tidyTiers(s, m = (s && s.traitTier) || {}) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const t of s.traits || []) { const n = cleanTier(t, m[t]); if (n > 1) out[t] = n; }
  if (Object.keys(out).length) s.traitTier = out; else delete s.traitTier;
  return s;
}

// Damage from wounds × (not hunger, thirst or infection: world.js hurt's raw damage).
/** @param {any} s @returns {number} */
export const woundMult = (s) => (hasTrait(s, "tough") ? traitFx(s, "tough", "mult") : hasTrait(s, "frail") ? traitFx(s, "frail", "mult") : 1);
// To hit in battle, shots and blows (Brave, Coward).
/** @param {any} s @returns {number} */
export const traitAim = (s) => traitFx(s, "brave", "aim") - traitFx(s, "coward", "aim");
// Fighting strength by the numbers (world.js combatPower: Brave +, Coward −, Tactical +).
/** @param {any} s @returns {number} */
export const traitPower = (s) => traitFx(s, "brave", "power") - traitFx(s, "coward", "power") + traitFx(s, "tactical", "power");
// To hit with blows on top (Clumsy, Feeble).
/** @param {any} s @returns {number} */
export const meleeTraitAim = (s) => -traitFx(s, "clumsy", "melee") - traitFx(s, "feeble", "melee");
// XP × (Quick Study, Slow Learner).
/** @param {any} s @returns {number} */
export const learnMult = (s) => (hasTrait(s, "quicklearner") ? traitFx(s, "quicklearner", "learn") : 1) * (hasTrait(s, "slowlearner") ? traitFx(s, "slowlearner", "learn") : 1);
// Healing at rest × (Quick Healer).
/** @param {any} s @returns {number} */
export const healMult = (s) => (hasTrait(s, "quickheal") ? traitFx(s, "quickheal", "heal") : 1);
// Food eaten × (Glutton).
/** @param {any} s @returns {number} */
export const appetite = (s) => (hasTrait(s, "glutton") ? traitFx(s, "glutton", "eat") : 1);
// The chance of a break or of walking out × (Iron Will).
/** @param {any} s @returns {number} */
export const breakMult = (s) => (hasTrait(s, "ironwill") ? traitFx(s, "ironwill", "mult") : 1);
// The chance of a cut or a sprain at work or searching × (Clumsy).
/** @param {any} s @returns {number} */
export const accidentMult = (s) => (hasTrait(s, "clumsy") ? traitFx(s, "clumsy", "hurt") : 1);
// Battle: tiles a move (Fleet-Footed +, Slow −) and the escape check's bonus.
/** @param {any} s @returns {number} */
export const fleetMob = (s) => traitFx(s, "fleet", "mob") - traitFx(s, "slow", "mob");
/** @param {any} s @returns {number} */
export const fleetEscape = (s) => traitFx(s, "fleet", "escape") - traitFx(s, "slow", "escape");
// An upset stomach × (Iron Stomach, Weak Stomach).
/** @param {any} s @returns {number} */
export const stomachMult = (s) => (hasTrait(s, "ironstomach") ? traitFx(s, "ironstomach", "sick") : 1) * (hasTrait(s, "weakstomach") ? traitFx(s, "weakstomach", "sick") : 1);
// Falling ill × and the slower clearing (Sickly).
/** @param {any} s @returns {number} */
export const sicklyMult = (s) => (hasTrait(s, "sickly") ? traitFx(s, "sickly", "sick") : 1);
/** @param {any} s @returns {number} */
export const sicklyDrift = (s) => traitFx(s, "sickly", "drift");
// Tactical on the battle map (combat.js playerUnit keeps it on the unit: shotOdds and meleeOdds read it): to hit a
// flanked target, off the odds of a shot at them in cover, and to hit for allies within TACT_RANGE tiles. null: none.
export const TACT_RANGE = 2;
/** @param {any} s @returns {{ flank: number, cover: number, aura: number } | null} */
export const tactOf = (s) => (hasTrait(s, "tactical") ? { flank: traitFx(s, "tactical", "flank"), cover: traitFx(s, "tactical", "cover"), aura: traitFx(s, "tactical", "aura") } : null);
// Strategic: a team's road encounters × (conflicts.js conflictChance: the team's best tier).
/** @param {any[]} members @returns {number} */
export const encounterMult = (members) => 1 - teamTraitFx(members, "strategic", "enc");
// The best of a trait's number among your living people who are at one of your bases (Strategic's intel) or free (not
// held by another group: Diplomatic's goodwill). Coarse on purpose: the group's planner or envoy, wherever they are.
/** @param {any} state @param {string} t @param {string} k @param {boolean} [atBase] @returns {number} */
function bestOfYours(state, t, k, atBase = false) {
  let v = 0;
  for (const s of (state && state.survivors) || []) {
    if (!s.alive || !s.location || !hasTrait(s, t)) continue;
    if (atBase ? s.location.kind !== "base" : s.location.kind === "captive") continue;
    v = Math.max(v, traitFx(s, t, k));
  }
  return v;
}
// Strategic: the error of every estimate of another group (intelest.js) × this.
/** @param {any} state @returns {number} */
export const intelMult = (state) => 1 - bestOfYours(state, "strategic", "intel", true);
// Diplomatic: a change of goodwill with a group (factions.js changeGoodwill), gains × (1 + gw), losses × (1 − gw).
/** @param {any} state @param {number} amount @returns {number} */
export function goodwillMult(state, amount) {
  if (!amount) return 1;
  const g = bestOfYours(state, "diplomatic", "gw");
  return amount > 0 ? 1 + g : 1 - g;
}
// Diplomatic: a team's bribe or toll × (conflicts.js bribeChoice); the lowest delivery fee a group takes over the
// radio, − this share of their fee (radiotrade.js minFee: the best at the base making the call).
/** @param {any[]} members @returns {number} */
export const bribeMult = (members) => 1 - teamTraitFx(members, "diplomatic", "bribe");
/** @param {any[]} people @returns {number} */
export const feeCut = (people) => teamTraitFx(people, "diplomatic", "fee");
// The skill levels traits add or take for skill k (world.js skill: every use of the skill).
/** @param {any} s @param {string} k @returns {number} */
export function traitSkill(s, k) {
  let v = traitFx(s, "lucky", "all") - traitFx(s, "unlucky", "all");
  if (k === "medicine") v += traitFx(s, "medic", "skill") - traitFx(s, "squeamish", "skill");
  else if (k === "stealth") v -= traitFx(s, "loud", "skill");
  else if (k === "farming") v += traitFx(s, "farmraised", "skill");
  else if (k === "cooking") v += traitFx(s, "farmraised", "cook"); // farm kitchens
  else if (k === "speech") v += traitFx(s, "persuasive", "skill");
  else if (k === "scouting") v -= traitFx(s, "nearsighted", "scout");
  else if (k === "shooting") v -= traitFx(s, "nearsighted", "shoot");
  return v;
}
// Iron Stomach: are these eggs (swallowed this way: worm.js catchWorm's how) shrugged off? Its own dice, keyed by the
// seed, the person, the hour and the way, so the worm's dice and the world's are untouched.
/** @param {any} state @param {any} s @param {string} how @returns {boolean} */
export function stomachShrugs(state, s, how) {
  if (!hasTrait(s, "ironstomach") || !FX.STOMACH_HOW.includes(how)) return false;
  // The person's world-local id (world.js localId, written out here to keep this module free of world.js): ids are
  // process-wide, and the same seed must roll the same in a second world.
  const local = (s.id | 0) - ((state && state.idBase) || 0);
  return traitHash((state && state.seed) || 1, local, (state && state.hour) | 0, FX.STOMACH_HOW.indexOf(how)) < traitFx(s, "ironstomach", "shrug");
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
// one of the newer traits (SWAP_TRAITS, none twice, none that clashes with the other), with dice of their own: keyed by
// the seed and how many people the world has made (like their looks and their Crafting: appearance.js), so the world's
// dice never see it. NEW_SHARE is the newer traits' share of all of them, so every trait is about as common as any
// other. How many traits someone has stays the world's draw. ON false: the old roll (tools/traitstest.js compares).
// LATE_TRAITS (2026-10-09: Tactical, Strategic, Diplomatic) come in after the swap (lateTraits): each trait then is,
// LATE_SHARE of the time, one of them, with numbers hashed from where the swap's dice stand (read, not drawn), so the
// swap and everything else are as they were. LATE_SHARE is their share of all the traits.
// DIET_* (2026-10-11): Picky Eater and Vegetarian come in last (dietTraits), DIET_SHARE of the time each; LATE_SHARE is
// fixed at what it was before them (3 of the 34 traits then), so every seed keeps its rolls but for the few a food trait
// now takes the place of.
export const TRAIT_ROLL = { SALT: 0x7a17, NEW_SHARE: SWAP_TRAITS.length / (SWAP_TRAITS.length + BIRTH_TRAITS.length), LATE_SALT: 0x1a7e, LATE_SHARE: LATE_TRAITS.length / (Object.keys(TRAITS).length - DIET_TRAITS.length), DIET_SALT: 0xd1e7, DIET_SHARE: DIET_ROLLED.length / Object.keys(TRAITS).length, ON: true };
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
    const pool = SWAP_TRAITS.filter((t) => !others.includes(t) && !clashIn(others, t));
    if (pool.length) traits[i] = pool[Math.floor(v * pool.length)];
  }
  return lateTraits(traits, dice);
}
// The 2026-10-09 traits: each of someone's traits, LATE_SHARE of the time, becomes one of LATE_TRAITS (none twice,
// none that clashes with the other). Hashed from the dice's state after the swap: nothing is drawn.
/** @param {string[]} traits @param {any} dice @returns {string[]} */
export function lateTraits(traits, dice) {
  if (!TRAIT_ROLL.ON || !dice) return traits;
  const key = Number.isFinite(dice.state) ? dice.state % 4294967296 : 0;
  for (let i = 0; i < traits.length; i++) {
    if (traitHash(key, TRAIT_ROLL.LATE_SALT, i, 0) >= TRAIT_ROLL.LATE_SHARE) continue;
    const others = traits.filter((_, j) => j !== i);
    const pool = LATE_TRAITS.filter((t) => !others.includes(t) && !clashIn(others, t));
    if (pool.length) traits[i] = pool[Math.floor(traitHash(key, TRAIT_ROLL.LATE_SALT, i, 1) * pool.length)];
  }
  return dietTraits(traits, key);
}
// The food traits (2026-10-11): each of someone's traits, DIET_SHARE of the time, becomes Picky Eater or Vegetarian
// (none twice, none that clashes). Hashed from the same key as lateTraits: nothing is drawn.
/** @param {string[]} traits @param {number} key @returns {string[]} */
export function dietTraits(traits, key) {
  if (!TRAIT_ROLL.ON || !(TRAIT_ROLL.DIET_SHARE > 0)) return traits;
  for (let i = 0; i < traits.length; i++) {
    if (traitHash(key, TRAIT_ROLL.DIET_SALT, i, 0) >= TRAIT_ROLL.DIET_SHARE) continue;
    const others = traits.filter((_, j) => j !== i);
    const pool = DIET_ROLLED.filter((t) => !others.includes(t) && !clashIn(others, t));
    if (pool.length) traits[i] = pool[Math.floor(traitHash(key, TRAIT_ROLL.DIET_SALT, i, 1) * pool.length)];
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

// ---------- a tier at birth ----------
// Everyone made (world.js makeSurvivor: your crew, recruits, wanderers, prisoners) gets a tier for each tiered trait
// from dice of their own, keyed by the seed, how many people the world has made and the trait (like the newer traits'
// swap), so the world's dice never see it. ODDS: the chance of tier I, II, III (a two-tier trait: III counts as II).
// A child grown up (family.js) rolls the same way, keyed by its id. ON false: everyone tier I (the tools compare).
export const TIER_ROLL = { SALT: 0x71e7, ODDS: [0.6, 0.3, 0.1], ON: true };
/** @param {number} seed @param {number} n @param {string} t @returns {number} */
export function rollTier(seed, n, t) {
  if (!TIER_ROLL.ON || tierCount(t) < 2) return 1;
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0;
  const u = traitHash(seed | 0, n | 0, TIER_ROLL.SALT, h);
  let acc = 0;
  for (let i = 0; i < TIER_ROLL.ODDS.length; i++) { acc += TIER_ROLL.ODDS[i]; if (u < acc) return cleanTier(t, i + 1); }
  return cleanTier(t, TIER_ROLL.ODDS.length);
}
// Tiers for all of someone's traits (in place of any they had).
/** @param {any} s @param {number} seed @param {number} n */
export function rollTiers(s, seed, n) {
  /** @type {Record<string, number>} */
  const m = {};
  for (const t of s.traits || []) m[t] = rollTier(seed, n, t);
  return tidyTiers(s, m);
}
