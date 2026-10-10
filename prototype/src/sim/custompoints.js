// @ts-check
// Customization points (2026-10-08, user request: "When customization is checked Gear, skills and traits all cost
// customization points where each survivor can have a max points to apply starting from 0"). With Customize ticked on
// the new-run screen (not with Ironman), every colonist starts blank (skills 0, no traits, nothing worn or carried)
// and everything they start with costs points from their own max: skill levels, good traits (by tier), every piece of
// gear and everything carried, and what is put in the starting vehicle's back (its owner pays, after the car pool:
// colonists who tick "Give leftover to the car pool" put their points left towards it, carPool below). Bad traits give points
// back (by tier), at most BAD_BACK of the max, so stacking every flaw is no way round it. Start is refused while
// anyone is over. Player only: the AI groups, recruits and everyone else are rolled as ever.
//
// Everything a colonist is priced on is on them while the new-run screen is up (ui/newgame.js crewSnapshot carries it
// through every rebuild): s.skills, s.traits / s.traitTier, s.startGear (their worn, held and carried picks:
// startgear.js), s.startVehicle (the vehicle's back, on whoever pays for it), s.carPool (they give their points left to
// the car pool) and a custom background's own supplies and car (custombg.js). s.startPoints marks a colonist built this way (startgear.js: the dice's kit is not handed out on
// top of the picks).
import { GEAR, SKILLS, SUPPLIES } from "./data.js";
import { ROUND_SUPPLIES, CALIBERS } from "./data-ammo.js";
import { WEAPONS } from "./combat.js";
import { newItem, startKit } from "./inventory.js";
import { itemValue } from "./valuation.js";
import { calOf } from "./ammo.js";
import { keyFor } from "./rounds.js";
import { traitPoints, traitTier, traitLabel } from "./traits.js";
import { START_GEAR, sanitizeStartGear, CARRY_PLACES, gunWith, gunCap, gunLoad, pickKey, pickMods, pickN } from "./startgear.js";

// ---------- the price table (tune here) ----------
export const CUSTOM_POINTS = {
  // Each colonist's max, the same for the whole crew (the new-run screen's "Points each" box). DEF: about what an
  // average rolled colonist and their usual start kit come to by this table (tools/custompointstest.js measures it:
  // 360 rolled colonists of each mode, 2026-10-08: a normal start's median 70 (skills 62, kit 13), Hardcore's 85
  // (skills 72: the backgrounds' bumps on top; kit 10), both 78; rounded to 80. With the Melee skill (2026-10-09,
  // about 5.5 a rolled colonist, more with a hands-on background): normal 77, Hardcore 93, both 85).
  DEF: 85, MIN: 0, MAX: 400,
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
// What is theirs alone (no vehicle's back, no car pool): { skills, good, bad, back (the bad traits' points that count,
// after the cap), cap, gear, carried, extra (a custom background's own supplies and car), own (their sum), lines }.
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
  if (P) {
    for (const [slot, key] of Object.entries(P.slots)) gear += slotPoints(slot, key, slot === "weapon" ? P.mods : null);
    if (P.carry) for (const where of CARRY_PLACES) for (const e of P.carry[where] || []) if (pickKey(e)) carried += pickPoints(e);
  }
  if (gear) lines.push(`Worn and held ${gear}`);
  if (carried) lines.push(`Carried ${carried}`);
  const extra = bgExtraPoints(state, s);
  if (extra) lines.push(`Their background's own supplies${state && state.mode !== "hardcore" ? " and car" : ""} ${extra}`);
  return { skills, good, bad, back, cap, gear, carried, extra, own: skills + good + back + gear + carried + extra, lines };
}
// What is theirs alone, as a number (the dice under Customize: randomkit.js).
/** @param {any} state @param {any} s @param {number} [max] */
export const ownPoints = (state, s, max = pointsMax(state)) => ownBill(state, s, max).own;

// Everything they are priced on: their own bill, plus { vehicle (what they pay for the vehicle's back, after the car
// pool), vehicleCost (the whole back, on its payer), poolPaid (what the car pool pays of it), offer (what they give the
// car pool: their points left), pool (what the back takes of their offer), total, max, left, over, lines (for the
// tooltip) }. state: the world (the crew, for the car pool; a custom background's car; the max: state.pointsMax or the
// default).
/** @param {any} state @param {any} s @param {number} [max] */
export function pricePerson(state, s, max = pointsMax(state)) {
  const O = ownBill(state, s, max);
  const lines = O.lines;
  const K = carPool(state, max, s);
  const mine = K.owner === s;
  const vehicleCost = mine ? K.cost : s.startVehicle && !K.crew.includes(s) ? vehiclePoints(s.startVehicle) : 0; // (someone off the crew: their own back)
  const poolPaid = mine ? K.used : 0;
  const vehicle = vehicleCost - poolPaid;
  if (vehicleCost) lines.push(`In the vehicle${mine && K.extra ? ` and the background cars' backs (${K.extra})` : ""} ${vehicleCost}${poolPaid ? ` (the car pool pays ${poolPaid}, they pay ${vehicle})` : ""}`);
  const gift = K.offers.find((o) => o.s === s);
  const offer = gift ? gift.n : 0, pool = gift ? gift.share : 0;
  if (gift) lines.push(`To the car pool ${pool} (of ${offer} left over${offer > pool ? `: ${offer - pool} not needed, still theirs` : ""})`);
  const total = O.own + vehicle + pool;
  return { ...O, vehicle, vehicleCost, poolPaid, offer, pool, total, max, left: max - total, over: Math.max(0, total - max), lines };
}

// ---------- the car pool ----------
// (2026-10-09, user request: "For each survivor allow them to donate the remaining points they have to a pool of
// points; these pool of points go towards the items set in the back of the car".) A colonist built on points with
// s.carPool gives what they have left to the car pool: their max less everything of their own (skills, traits, what
// they wear and carry, a background's own), never below 0. Spend more and the offer shrinks with it, so giving never
// puts them over (the payer may then pay more). The vehicle's back is paid from the pool first and its payer pays the
// rest; only what the back needs is taken, shared among the givers by what they offer (whole points, the largest
// remainders first, crew order on a tie), and what is not needed stays theirs (it shows as their points left). The
// payer gives nothing (their points pay the back already): their tick is kept and counts again if someone else pays.
// Under Customize only; startgear.js clearStartGear takes s.carPool off at Start.
// { crew, owner (the payer, or null), cost (the back), offers: [{ s, n (offered), share (taken) }], total (offered),
// used (taken: at most the cost), ownerPays }. sub: a stand-in for one colonist (the same id: what they would be
// without their kit, say).
/** @param {any} state @param {number} [max] @param {any} [sub] */
export function carPool(state, max = pointsMax(state), sub = null) {
  const crew = ((state && state.survivors) || []).map((x) => (sub && x.id === sub.id ? sub : x));
  // A normal start's custom backgrounds' car backs (to the hub with their cars) are on the vehicle's back's bill too:
  // with nothing picked for the back, its payer is whoever would pay for it (ui/startgear.js editTrunk: the leader).
  const backs = bgBacks(state, crew);
  const extra = backs.reduce((a, b) => a + b.n, 0);
  const owner = crew.find((x) => x.startVehicle) || (extra > 0 ? backPayer(state, crew) : null);
  const cost = (owner && owner.startVehicle ? vehiclePoints(owner.startVehicle) : 0) + (owner ? extra : 0);
  const offers = crew.filter((x) => x.carPool && x.startPoints && x !== owner).map((x) => ({ s: x, n: Math.max(0, max - ownBill(state, x, max).own), share: 0 }));
  const total = offers.reduce((a, o) => a + o.n, 0);
  const used = Math.min(total, cost);
  if (used > 0) {
    if (used === total) for (const o of offers) o.share = o.n;
    else {
      const exact = offers.map((o) => (used * o.n) / total);
      offers.forEach((o, i) => { o.share = Math.floor(exact[i]); });
      let rest = used - offers.reduce((a, o) => a + o.share, 0);
      const frac = (i) => exact[i] - Math.floor(exact[i]);
      const order = offers.map((o, i) => i).sort((a, b) => frac(b) - frac(a) || a - b);
      for (const i of order) { if (rest <= 0) break; if (offers[i].share < offers[i].n) { offers[i].share++; rest--; } }
    }
  }
  return { crew, owner, cost, offers, total, used, ownerPays: cost - used, backs, extra };
}
// Who pays for the vehicle's back with nothing picked for it yet (as ui/startgear.js editTrunk picks the payer):
// Hardcore, the car's owner; else the leader, else the first.
/** @param {any} state @param {any[]} [crew] */
export function backPayer(state, crew = (state && state.survivors) || []) {
  const id = state && state.hardcore && state.hardcore.start ? state.hardcore.start.carOwner : null;
  return crew.find((x) => id != null && x.id === id) || crew.find((x) => x.leader) || crew[0] || null;
}
// A custom background's car's back, in points: its supplies and things (each thing as loosePoints: a gun loaded).
/** @param {any} A */
export const bgCarBack = (A) => (A && A.car ? suppliesPoints(A.car.trunk || {}) + (A.car.items || []).reduce((a, k) => a + (GEAR[k] ? loosePoints(k) : 0), 0) : 0);
// The custom backgrounds' car backs on the vehicle's back's bill (2026-10-09 fix: the backgrounds editor says the car's
// back is paid by whoever pays for the vehicle's back). At a normal start each one goes to the hub with its car
// (hardcore-start.js normalStartKit), for the colonists built on points: [{ s, n (points) }]. In Hardcore the car's
// back is the dice's back, loaded as picks with "As rolled" and priced as any other (none here).
/** @param {any} state @param {any[]} [crew] */
export function bgBacks(state, crew = (state && state.survivors) || []) {
  if (!state || state.mode === "hardcore" || !state.customBackgrounds) return [];
  const out = [];
  for (const s of crew) {
    const A = s && s.startPoints && s.background ? state.customBackgrounds[s.background] : null;
    const n = A ? bgCarBack(A) : 0;
    if (n > 0) out.push({ s, n });
  }
  return out;
}
// The car pool in words (the vehicle's back): "Car pool: 34 points from Ana 12, Ben 22" ("" with nobody giving).
/** @param {ReturnType<typeof carPool>} K */
export function poolText(K) {
  if (!K.offers.length) return "";
  return `Car pool: ${K.total} point${K.total === 1 ? "" : "s"} from ${K.offers.map((o) => `${firstName(o.s)} ${o.n}`).join(", ")}`;
}
/** @param {any} s */
const firstName = (s) => String((s && s.name) || "").split(" ")[0];

// The vehicle's back picked on the new-run screen: { items: [keys], supplies: { key: n } }.
/** @param {any} v */
export function vehiclePoints(v) {
  if (!v) return 0;
  return (v.items || []).reduce((a, e) => a + pickPoints(e), 0) + suppliesPoints(v.supplies || {});
}
// A custom background's own supplies (on them) and, at a normal start, its car (a vehicle more at the hub). Its skills,
// traits and kit are the colonist's and priced as theirs.
/** @param {any} state @param {any} s */
export function bgExtraPoints(state, s) {
  const A = state && state.customBackgrounds && s && s.background ? state.customBackgrounds[s.background] : null;
  if (!A) return 0;
  return suppliesPoints(A.supplies || {}) + bgCarPoints(A, state.mode);
}
// A custom background's own car: at a normal start a vehicle more at the hub (its price by kind); in Hardcore it is the
// car the team flees in, free; none when it names no kind or is never theirs.
/** @param {any} A @param {string} [mode] */
export const bgCarPoints = (A, mode) => (mode !== "hardcore" && A && A.car && A.car.type && A.car.odds > 0 ? C.VEHICLE[A.car.type] ?? 20 : 0);
// What a custom background comes to under Customize (the backgrounds editor's line; 2026-10-09, user request: "When
// creating a custom background show a total amount of points it provides"): { skills (its bumps priced from level 0:
// on top of a colonist's own levels they cost at least this, more past level 10), traits (by tier; bad ones give
// back), kit (worn, held and carried), supplies (on them), car (bgCarPoints), total (all of those), trunk (the car's
// back: not in the total, it is on the bill of whoever pays for the vehicle's back: bgBacks) }.
/** @param {any} A @param {string} [mode] */
export function backgroundPoints(A, mode) {
  if (!A) return { skills: 0, traits: 0, kit: 0, supplies: 0, car: 0, trunk: 0, total: 0 };
  const skills = Object.values(A.skills || {}).reduce((a, v) => a + skillCost(Number(v) || 0), 0);
  const traits = (A.traits || []).reduce((a, t) => a + traitPoints(t, (A.traitTier || {})[t] || 1), 0);
  const kit = [...Object.values(A.gear || {}), ...(A.items || [])].reduce((a, k) => a + itemPoints(k), 0);
  const supplies = suppliesPoints(A.supplies || {});
  const car = bgCarPoints(A, mode);
  const trunk = bgCarBack(A);
  return { skills, traits, kit, supplies, car, trunk, total: skills + traits + kit + supplies + car };
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
// Start's refusal, or "". When the payer of the vehicle's back is over, it says what the back costs against the car
// pool and what they have to spare.
/** @param {any} state */
export function overText(state) {
  const list = overBudget(state);
  if (!list.length) return "";
  const max = pointsMax(state);
  const K = carPool(state, max);
  let back = "";
  if (K.owner && K.cost > 0 && list.some((x) => x.s === K.owner)) {
    const spare = Math.max(0, max - ownPoints(state, K.owner, max));
    back = ` The vehicle's back${K.extra ? ` (with the background cars' backs, ${K.extra})` : ""} costs ${K.cost}: ${K.offers.length ? `the car pool (${K.total}) and ` : ""}${firstName(K.owner)} (${spare} to spare) cannot pay it.`;
  }
  return `Over the points: ${list.map(({ s, over }) => `${firstName(s)} by ${over}`).join(", ")}.${back} Take something off (or raise Points each) to start.`;
}
// A trait's points as "+5" / "−3" / "free".
/** @param {string} t @param {number} [tier] */
export function traitPointsText(t, tier = 1) {
  const p = traitPoints(t, tier);
  return p > 0 ? `+${p}` : p < 0 ? `−${-p}` : "free";
}
