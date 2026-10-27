// @ts-check
// Customization points (2026-10-08, user request: "When customization is checked Gear, skills and traits all cost
// customization points where each survivor can have a max points to apply starting from 0"). With Customize ticked on
// the new-run screen (not with Ironman), every colonist starts blank (skills 0, no traits, nothing worn or carried)
// and everything they start with costs points from their own max: skill levels, good traits (by tier), every piece of
// gear and everything carried. (The starting vehicles' backs are not theirs since 2026-10-24: each vehicle has a point
// limit of its own, startfleet.js, priced with vehiclePoints below; the car pool is gone.) Bad traits give points
// back (by tier), at most BAD_BACK of the max, so stacking every flaw is no way round it. Start is refused while
// anyone is over. Player only: the AI groups, recruits and everyone else are rolled as ever.
//
// Everything a colonist is priced on is on them while the new-run screen is up (ui/newgame.js crewSnapshot carries it
// through every rebuild): s.skills, s.traits / s.traitTier, s.startGear (their worn, held and carried picks:
// startgear.js) and a custom background's own supplies, car and its back (custombg.js). s.startPoints marks a colonist built this way (startgear.js: the dice's kit is not handed out on
// top of the picks).
import { GEAR, SKILLS, SUPPLIES } from "./data.js";
import { isRoadStart } from "./roadstart.js";
import { ROUND_SUPPLIES, CALIBERS } from "./data-ammo.js";
import { WEAPONS } from "./combat.js";
import { newItem, startKit } from "./inventory.js";
import { itemValue } from "./valuation.js";
import { calOf } from "./ammo.js";
import { keyFor } from "./rounds.js";
import { traitPoints, traitTier, traitLabel } from "./traits.js";
import { START_GEAR, sanitizeStartGear, CARRY_PLACES, gunWith, gunCap, gunLoad, pickKey, pickMods, pickN } from "./startgear.js";
import { startsWithVehicle } from "./custommode.js"; // Start with a vehicle (2026-10-24): off, no background car backs to pay for
import { isCrashRun } from "./crashmode.js"; // Crashlanding (2026-10-24): the fixed military kit is the unit's issue, no points

// ---------- the price table (tune here) ----------
export const CUSTOM_POINTS = {
  // Each colonist's max, the same for the whole crew (the new-run screen's "Points each" box). DEF: about what an
  // average rolled colonist and their usual start kit come to by this table (tools/custompointstest.js measures it:
  // 360 rolled colonists of each mode, 2026-10-08: a normal start's median 70 (skills 62, kit 13), Hardcore's 85
  // (skills 72: the backgrounds' bumps on top; kit 10), both 78; rounded to 80. With the Melee skill (2026-10-09,
  // about 5.5 a rolled colonist, more with a hands-on background): normal 77, Hardcore 93, both 85. With the Cooking
  // skill (2026-10-10, about 4.8 a rolled colonist): normal 82, Hardcore 97, both 91; rounded to 90).
  DEF: 90, MIN: 0, MAX: 400,
  // A skill level's price by the level it reaches: levels 1–10 cost 1 each, 11–15 cost 2, 16–20 cost 3 (so 10 is 10
  // points, 15 is 20 and 20 is 35).
  SKILL_STEPS: [[10, 1], [15, 2], [20, 3]],
  // Bad traits give back at most this share of the max (a third: with the default max, 28 points).
  BAD_BACK: 1 / 3,
  // Traits a colonist may have under Customize (bad ones are worth having now).
  MAX_TRAITS: 5,
  // Gear and things carried: points = what a new one is worth (valuation.js itemValue: with a carrier's plates, a
  // gun's factory parts) ÷ VALUE, plus POWER × its power for what is worn or held in a fight (weapons, armour, helmets,
  // guards, plates), rounded, at least MIN. A picked gun's rounds come with it (startgear.js: a full load and two more,
  // a launcher LAUNCH rounds, a bow ARROWS arrows), priced as supplies; its parts (picked in the gear window) at what
  // they are worth (gunPoints); a gun carried or in the vehicle's back comes with its magazine loaded, priced as
  // supplies too (loosePoints).
  VALUE: 6, POWER: 0.5, ITEM_MIN: 1,
  // Supplies (the vehicle's back, a custom background's own): what they are worth (data.js SUPPLIES value; rounds by
  // calibre) ÷ VALUE, summed and rounded up. 30 food is 10 points, 10 meds 14.
  SUPPLY_VALUE: 6,
  // A custom background's own car at a normal start is a vehicle more at the hub: its price by kind (and its back, on the
  // same colonist's bill). (In Hardcore it is the one car the team flees in, which is free.)
  VEHICLE: { sedan: 15, suv: 20, truck: 25, van: 25, hummer: 35, miltruck: 60 },
};
const C = CUSTOM_POINTS;
export const clampMax = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(C.MIN, Math.min(C.MAX, n)) : C.DEF; };

// ---------- prices ----------
// One skill at level v: the sum of its steps.
/** @param {number} v @returns {number} */
export function skillCost(v) {
  let cost = 0, from = 0;
  const lvl = Math.max(0, Math.min(20, Math.round(v || 0)));
  for (const [upTo, each] of C.SKILL_STEPS) {
    if (lvl <= from) break;
    cost += (Math.min(lvl, upTo) - from) * each;
    from = upTo;
  }
  return cost;
}
// What one more level of a skill at v costs (the + button's hover text).
/** @param {number} v */
export const nextLevelCost = (v) => skillCost(v + 1) - skillCost(v);
/** @param {Record<string, number>} skills */
export const skillsCost = (skills) => SKILLS.reduce((a, k) => a + skillCost((skills && skills[k]) || 0), 0);

const priceCache = new Map();
// A thing's price (new, as the picks make it). Weapons, armour, helmets, guards and plates add their power.
/** @param {string} key @returns {number} */
export function itemPoints(key) {
  if (priceCache.has(key)) return priceCache.get(key);
  const d = GEAR[key];
  let p = 0;
  if (d) {
    const fights = ["weapon", "armor", "head", "arms", "legs", "insert"].includes(d.slot);
    const v = itemValue(startKit(newItem(key, 1)));
    p = Math.max(C.ITEM_MIN, Math.round(v / C.VALUE + (fights ? (d.power || 0) * C.POWER : 0)));
  }
  priceCache.set(key, p);
  return p;
}
// What a supply is worth a unit (rounds by calibre too).
/** @param {string} k */
const unitValue = (k) => (k === "food" ? 2 : SUPPLIES[k] ? SUPPLIES[k].value : ROUND_SUPPLIES[k] ? ROUND_SUPPLIES[k].value : 0); // food: days of it (foods.js), at the old food's worth: 30 days 10 points
// Supplies { key: n } as points: their worth ÷ SUPPLY_VALUE, rounded up.
/** @param {Record<string, number>} sup */
export function suppliesPoints(sup) {
  let v = 0;
  for (const [k, n] of Object.entries(sup || {})) if (n > 0) v += unitValue(k) * n;
  return v > 0 ? Math.ceil(v / C.SUPPLY_VALUE - 1e-9) : 0;
}
// A picked gun with its parts (startgear.js P.mods): what it is worth so fitted, ÷ VALUE, plus its power (as
// itemPoints; no parts picked: itemPoints). Each part adds what it is worth (valuation.js counts a gun's parts).
const gunCache = new Map();
/** @param {string} key @param {any} [mods] @returns {number} */
export function gunPoints(key, mods = null) {
  if (!mods || !Object.keys(mods).length || !GEAR[key]) return itemPoints(key);
  const id = `${key}|${JSON.stringify(mods)}`;
  if (gunCache.has(id)) return gunCache.get(id);
  const d = GEAR[key];
  const p = Math.max(C.ITEM_MIN, Math.round(itemValue(startKit(gunWith(key, mods))) / C.VALUE + (d.power || 0) * C.POWER));
  gunCache.set(id, p);
  return p;
}
// A picked gun's rounds, launcher rounds or arrows (startgear.js applyStartGear gives them): { key: n }. A gun's rounds
// are its capacity as fitted (a bigger magazine picked: more) START_GEAR.LOADS times.
/** @param {string} key @param {any} [mods] */
export function gunExtras(key, mods = null) {
  const w = WEAPONS[key], d = GEAR[key];
  if (!w || !d) return {};
  const cal = calOf(key);
  if (cal && CALIBERS[cal]) return { [keyFor(cal, null)]: Math.max(1, gunCap(gunWith(key, mods)) || w.cap || 1) * START_GEAR.LOADS };
  if (w.launcher && !w.oneShot) return { [keyFor(w.launcher, null)]: START_GEAR.LAUNCH };
  if (d.cat === "bow") return { arrows: START_GEAR.ARROWS };
  return {};
}
// A picked slot's price: the item (a gun with its parts), and a gun in the hands with its rounds.
/** @param {string} slot @param {string} key @param {any} [mods] */
export function slotPoints(slot, key, mods = null) {
  if (!key || !GEAR[key]) return 0;
  if (slot !== "weapon") return itemPoints(key);
  return gunPoints(key, mods) + suppliesPoints(gunExtras(key, mods));
}
// A thing carried or put in the vehicle's back: the item, and a gun its loaded magazine (startgear.js loadGun).
const looseCache = new Map();
/** @param {string} key @returns {number} */
export function loosePoints(key) {
  if (!looseCache.has(key)) looseCache.set(key, itemPoints(key) + suppliesPoints(gunLoad(key)));
  return looseCache.get(key);
}
// A carried or back pick (a key, or { key, mods }: a gun with parts): the gun as fitted and its loaded magazine (a
// bigger magazine fitted: more rounds).
/** @param {any} e @returns {number} */
export function pickPoints(e) {
  const key = pickKey(e), mods = pickMods(e);
  if (!key || !GEAR[key]) return 0;
  return mods ? gunPoints(key, mods) + suppliesPoints(gunLoad(key, mods)) : loosePoints(key) * pickN(e); // a stack: n of it (n boxes of rounds)
}

// ---------- a colonist's bill ----------
// What is theirs: { skills, good, bad, back (the bad traits' points that count, after the cap), cap, gear, carried, extra
// (a custom background's own supplies, car and its back), own (their sum), lines }.
/** @param {any} state @param {any} s @param {number} max */
function ownBill(state, s, max) {
  const lines = [];
  const skills = skillsCost(s.skills);
  lines.push(`Skills ${skills}`);
  let good = 0, bad = 0;
  for (const t of s.traits || []) {
    const p = traitPoints(t, traitTier(s, t) || 1);
    if (p > 0) good += p; else bad += p;
    if (p) lines.push(`${traitLabel(t, traitTier(s, t) || 1)} ${p > 0 ? "+" : "−"}${Math.abs(p)}`);
  }
  const cap = Math.floor(max * C.BAD_BACK);
  const back = Math.max(-cap, bad);
  if (back !== bad) lines.push(`Bad traits give back at most ${cap} (a third of the max)`);
  const P = sanitizeStartGear(s.startGear);
  let gear = 0, carried = 0;
  // Crashlanding (2026-10-24, user request: "You cannot customize anything beside the traits, skills and character
  // look"): the kit is fixed and the unit's issue, so nothing worn, held or carried costs a point (world.js applyCrew
  // ignores the picks and puts the kit back); skills and traits are priced as ever.
  if (isCrashRun(state)) lines.push("The military kit is the unit's issue: free");
  else if (P) {
    for (const [slot, key] of Object.entries(P.slots)) gear += slotPoints(slot, key, slot === "weapon" ? P.mods : null);
    if (P.carry) for (const where of CARRY_PLACES) for (const e of P.carry[where] || []) if (pickKey(e)) carried += pickPoints(e);
  }
  if (gear) lines.push(`Worn and held ${gear}`);
  if (carried) lines.push(`Carried ${carried}`);
  const extra = bgExtraPoints(state, s);
  if (extra) lines.push(`Their background's own supplies${state && !isRoadStart(state) && startsWithVehicle(state) ? ", car and its back" : ""} ${extra}`);
  return { skills, good, bad, back, cap, gear, carried, extra, own: skills + good + back + gear + carried + extra, lines };
}
// What is theirs alone, as a number (the dice under Customize: randomkit.js).
/** @param {any} state @param {any} s @param {number} [max] */
export const ownPoints = (state, s, max = maxFor(state, s)) => ownBill(state, s, max).own;

// Everything they are priced on: their own bill, plus { total, max, left, over, lines (for the tooltip) }. state: the
// world (a custom background's car). max: theirs (maxFor: their own points when set on their card, else the crew's
// Points each). The starting vehicles' backs are not on it (2026-10-24: startfleet.js, a point limit each).
/** @param {any} state @param {any} s @param {number} [max] */
export function pricePerson(state, s, max = maxFor(state, s)) {
  const O = ownBill(state, s, max);
  const total = O.own;
  return { ...O, total, max, left: max - total, over: Math.max(0, total - max) };
}

// A custom background's car's back, in points: its supplies and things (each thing as loosePoints: a gun loaded).
/** @param {any} A */
export const bgCarBack = (A) => (A && A.car ? suppliesPoints(A.car.trunk || {}) + (A.car.items || []).reduce((a, k) => a + (GEAR[k] ? loosePoints(k) : 0), 0) : 0);
// The custom backgrounds' car backs (2026-10-09 fix; since 2026-10-24 part of the background: on the bill of the colonist
// who has it, bgExtraPoints). At a normal start each one goes to the hub with its car (hardcore-start.js normalStartKit),
// for the colonists built on points: [{ s, n (points) }]. In Hardcore the car's back is the dice's back (the starting
// vehicle's As rolled, free); none with Start with a vehicle off.
/** @param {any} state @param {any[]} [crew] */
export function bgBacks(state, crew = (state && state.survivors) || []) {
  if (!state || isRoadStart(state) || !state.customBackgrounds || !startsWithVehicle(state)) return []; // Start with a vehicle off: no car, no back (hardcore-start.js normalStartKit)
  const out = [];
  for (const s of crew) {
    const A = s && s.startPoints && s.background ? state.customBackgrounds[s.background] : null;
    const n = A ? bgCarBack(A) : 0;
    if (n > 0) out.push({ s, n });
  }
  return out;
}

// A vehicle's back set on the new-run screen (startfleet.js: against the vehicle's own point limit): { items: [picks],
// supplies: { key: n } }.
/** @param {any} v */
export function vehiclePoints(v) {
  if (!v) return 0;
  return (v.items || []).reduce((a, e) => a + pickPoints(e), 0) + suppliesPoints(v.supplies || {});
}
// A custom background's own supplies (on them) and, at a normal start, its car (a vehicle more at the hub) and what is
// in its back (to the hub with it: bgBacks); no car nor back with Start with a vehicle off. Its skills, traits and kit
// are the colonist's and priced as theirs.
/** @param {any} state @param {any} s */
export function bgExtraPoints(state, s) {
  const A = state && state.customBackgrounds && s && s.background ? state.customBackgrounds[s.background] : null;
  if (!A) return 0;
  const car = !isRoadStart(state) && startsWithVehicle(state);
  return suppliesPoints(A.supplies || {}) + (car ? bgCarPoints(A, state.mode) + bgCarBack(A) : 0);
}
// A custom background's own car: at a normal start a vehicle more at the hub (its price by kind); in Hardcore it is the
// car the team flees in, free; none when it names no kind or is never theirs.
/** @param {any} A @param {string} [mode] */
export const bgCarPoints = (A, mode) => (mode !== "hardcore" && A && A.car && A.car.type && A.car.odds > 0 ? C.VEHICLE[A.car.type] ?? 20 : 0);
// What a custom background comes to under Customize (the backgrounds editor's line; 2026-10-09, user request: "When
// creating a custom background show a total amount of points it provides"): { skills (its bumps priced from level 0:
// on top of a colonist's own levels they cost at least this, more past level 10), traits (by tier; bad ones give
// back), kit (worn, held and carried), supplies (on them), car (bgCarPoints), trunk (the car's back: at a normal start
// on the same colonist's bill since 2026-10-24, bgBacks; in Hardcore it is the dice's back, free), total (all of those) }.
/** @param {any} A @param {string} [mode] */
export function backgroundPoints(A, mode) {
  if (!A) return { skills: 0, traits: 0, kit: 0, supplies: 0, car: 0, trunk: 0, total: 0 };
  const skills = Object.values(A.skills || {}).reduce((a, v) => a + skillCost(Number(v) || 0), 0);
  const traits = (A.traits || []).reduce((a, t) => a + traitPoints(t, (A.traitTier || {})[t] || 1), 0);
  const kit = [...Object.values(A.gear || {}), ...(A.items || [])].reduce((a, k) => a + itemPoints(k), 0);
  const supplies = suppliesPoints(A.supplies || {});
  const car = bgCarPoints(A, mode);
  const trunk = bgCarBack(A);
  return { skills, traits, kit, supplies, car, trunk, total: skills + traits + kit + supplies + car + (mode !== "hardcore" ? trunk : 0) };
}
// The crew's max (the new-run screen's box: main.js keeps it in ui.pointsMax and the world as state.pointsMax).
/** @param {any} state */
export const pointsMax = (state) => (state && Number.isFinite(state.pointsMax) ? state.pointsMax : C.DEF);
// One colonist's max (2026-10-19, user request: "allow the user to change an individual survivor's points and not
// affect the other survivors"): their own (s.ownMax, set on their crew card: ui/newgame.js) when set, else the crew's.
// Setting Points each again puts everyone back on it (main.js nr-points clears s.ownMax).
/** @param {any} state @param {any} s */
export const maxFor = (state, s) => (s && Number.isFinite(s.ownMax) ? s.ownMax : pointsMax(state));
// Who is over their max, and by how much: [{ s, over }].
/** @param {any} state */
export function overBudget(state) {
  return (state.survivors || []).filter((s) => s.startPoints).map((s) => ({ s, over: pricePerson(state, s).over })).filter((x) => x.over > 0);
}
/** @param {any} s */
const firstName = (s) => String((s && s.name) || "").split(" ")[0];
// Start's refusal, or "". (A starting vehicle's back over its own limit: startfleet.js fleetText.)
/** @param {any} state */
export function overText(state) {
  const list = overBudget(state);
  if (!list.length) return "";
  return `Over the points: ${list.map(({ s, over }) => `${firstName(s)} by ${over}`).join(", ")}. Take something off (or raise Points each) to start.`;
}
// A trait's points as "+5" / "−3" / "free".
/** @param {string} t @param {number} [tier] */
export function traitPointsText(t, tier = 1) {
  const p = traitPoints(t, tier);
  return p > 0 ? `+${p}` : p < 0 ? `−${-p}` : "free";
}
