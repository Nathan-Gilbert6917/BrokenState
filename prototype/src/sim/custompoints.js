// @ts-check
// Customization points (2026-10-08, user request: "When customization is checked Gear, skills and traits all cost
// customization points where each survivor can have a max points to apply starting from 0"). With Customize ticked on
// the new-run screen (not with Ironman), every colonist starts blank (skills 0, no traits, nothing worn or carried)
// and everything they start with costs points from their own max: skill levels, good traits (by tier), every piece of
// gear and everything carried, and what is put in the starting vehicle's back (its owner pays). Bad traits give points
// back (by tier), at most BAD_BACK of the max, so stacking every flaw is no way round it. Start is refused while
// anyone is over. Player only: the AI groups, recruits and everyone else are rolled as ever.
//
// Everything a colonist is priced on is on them while the new-run screen is up (ui/newgame.js crewSnapshot carries it
// through every rebuild): s.skills, s.traits / s.traitTier, s.startGear (their worn, held and carried picks:
// startgear.js), s.startVehicle (the vehicle's back, on whoever pays for it) and a custom background's own supplies and
// car (custombg.js). s.startPoints marks a colonist built this way (startgear.js: the dice's kit is not handed out on
// top of the picks).
import { GEAR, SKILLS, SUPPLIES } from "./data.js";
import { ROUND_SUPPLIES, CALIBERS } from "./data-ammo.js";
import { WEAPONS } from "./combat.js";
import { newItem, startKit } from "./inventory.js";
import { itemValue } from "./valuation.js";
import { calOf } from "./ammo.js";
import { keyFor } from "./rounds.js";
import { traitPoints, traitTier, traitLabel } from "./traits.js";
import { START_GEAR, sanitizeStartGear, CARRY_PLACES } from "./startgear.js";

// ---------- the price table (tune here) ----------
export const CUSTOM_POINTS = {
  // Each colonist's max, the same for the whole crew (the new-run screen's "Points each" box). DEF: about what an
  // average rolled colonist and their usual start kit come to by this table (tools/custompointstest.js measures it:
  // 360 rolled colonists of each mode, 2026-10-08: a normal start's median 70 (skills 62, kit 13), Hardcore's 85
  // (skills 72: the backgrounds' bumps on top; kit 10), both 78; rounded to 80).
  DEF: 80, MIN: 0, MAX: 400,
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
  // a launcher LAUNCH rounds, a bow ARROWS arrows), priced as supplies.
  VALUE: 6, POWER: 0.5, ITEM_MIN: 1,
  // Supplies (the vehicle's back, a custom background's own): what they are worth (data.js SUPPLIES value; rounds by
  // calibre) ÷ VALUE, summed and rounded up. 30 food is 10 points, 10 meds 14.
  SUPPLY_VALUE: 6,
  // A custom background's own car at a normal start is a vehicle more at the hub: its price by kind. (In Hardcore it
  // is the one car the team flees in, which is free.)
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
const unitValue = (k) => (SUPPLIES[k] ? SUPPLIES[k].value : ROUND_SUPPLIES[k] ? ROUND_SUPPLIES[k].value : 0);
// Supplies { key: n } as points: their worth ÷ SUPPLY_VALUE, rounded up.
/** @param {Record<string, number>} sup */
export function suppliesPoints(sup) {
  let v = 0;
  for (const [k, n] of Object.entries(sup || {})) if (n > 0) v += unitValue(k) * n;
  return v > 0 ? Math.ceil(v / C.SUPPLY_VALUE - 1e-9) : 0;
}
// A picked gun's rounds, launcher rounds or arrows (startgear.js applyStartGear gives them): { key: n }.
/** @param {string} key */
export function gunExtras(key) {
  const w = WEAPONS[key], d = GEAR[key];
  if (!w || !d) return {};
  const cal = calOf(key);
  if (cal && CALIBERS[cal]) return { [keyFor(cal, null)]: Math.max(1, w.cap || 1) * START_GEAR.LOADS };
  if (w.launcher && !w.oneShot) return { [keyFor(w.launcher, null)]: START_GEAR.LAUNCH };
  if (d.cat === "bow") return { arrows: START_GEAR.ARROWS };
  return {};
}
// A picked slot's price: the item, and a gun in the hands with its rounds.
/** @param {string} slot @param {string} key */
export function slotPoints(slot, key) {
  if (!key || !GEAR[key]) return 0;
  return itemPoints(key) + (slot === "weapon" ? suppliesPoints(gunExtras(key)) : 0);
}

// ---------- a colonist's bill ----------
// Everything they are priced on: { skills, good, bad, back (the bad traits' points that count, after the cap), gear,
// carried, vehicle, extra (a custom background's own supplies and car), total, max, left, over, lines (for the
// tooltip) }. state: the world (a custom background's car, the max: state.pointsMax or the default).
/** @param {any} state @param {any} s @param {number} [max] */
export function pricePerson(state, s, max = pointsMax(state)) {
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
  if (P) {
    for (const [slot, key] of Object.entries(P.slots)) gear += slotPoints(slot, key);
    if (P.carry) for (const where of CARRY_PLACES) for (const key of P.carry[where] || []) if (key) carried += itemPoints(key);
  }
  if (gear) lines.push(`Worn and held ${gear}`);
  if (carried) lines.push(`Carried ${carried}`);
  const vehicle = vehiclePoints(s.startVehicle);
  if (vehicle) lines.push(`In the vehicle ${vehicle}`);
  const extra = bgExtraPoints(state, s);
  if (extra) lines.push(`Their background's own supplies${state && state.mode !== "hardcore" ? " and car" : ""} ${extra}`);
  const total = skills + good + back + gear + carried + vehicle + extra;
  return { skills, good, bad, back, cap, gear, carried, vehicle, extra, total, max, left: max - total, over: Math.max(0, total - max), lines };
}
// The vehicle's back picked on the new-run screen: { items: [keys], supplies: { key: n } }.
/** @param {any} v */
export function vehiclePoints(v) {
  if (!v) return 0;
  return (v.items || []).reduce((a, k) => a + itemPoints(k), 0) + suppliesPoints(v.supplies || {});
}
// A custom background's own supplies (on them) and, at a normal start, its car (a vehicle more at the hub). Its skills,
// traits and kit are the colonist's and priced as theirs.
/** @param {any} state @param {any} s */
export function bgExtraPoints(state, s) {
  const A = state && state.customBackgrounds && s && s.background ? state.customBackgrounds[s.background] : null;
  if (!A) return 0;
  let p = suppliesPoints(A.supplies || {});
  if (state.mode !== "hardcore" && A.car && A.car.type && A.car.odds > 0) p += C.VEHICLE[A.car.type] ?? 20;
  return p;
}
// The crew's max (the new-run screen's box: main.js keeps it in ui.pointsMax and the world as state.pointsMax).
/** @param {any} state */
export const pointsMax = (state) => (state && Number.isFinite(state.pointsMax) ? state.pointsMax : C.DEF);
// Who is over their max, and by how much: [{ s, over }].
/** @param {any} state */
export function overBudget(state) {
  const max = pointsMax(state);
  return (state.survivors || []).filter((s) => s.startPoints).map((s) => ({ s, over: pricePerson(state, s, max).over })).filter((x) => x.over > 0);
}
// Start's refusal, or "".
/** @param {any} state */
export function overText(state) {
  const list = overBudget(state);
  if (!list.length) return "";
  return `Over the points: ${list.map(({ s, over }) => `${s.name.split(" ")[0]} by ${over}`).join(", ")}. Take something off (or raise Points each) to start.`;
}
// A trait's points as "+5" / "−3" / "free".
/** @param {string} t @param {number} [tier] */
export function traitPointsText(t, tier = 1) {
  const p = traitPoints(t, tier);
  return p > 0 ? `+${p}` : p < 0 ? `−${-p}` : "free";
}
