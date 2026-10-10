// @ts-check
// Random builds under Customize (2026-10-09, user requests: "allow to randomize a select one and not just all"; the
// gear dice "gives me 33 over 80 points"; the vehicle's back "gave the same two items each time ... have it empty then
// set the new gear"). Each is a fresh draw every time (not the world's dice) and stays within the colonist's points
// (sim/custompoints.js), whatever else they have:
//   randomKit: what they wear, hold and carry, for the points left after their skills, traits and the vehicle's back;
//   randomTrunk: the vehicle's back, for what its payer has left and the car pool, in the room there is;
//   randomBuild: a whole colonist from a blank slate: traits (none to two), skills and kit, the rest into skills.
// The new-run screen's buttons (ui/startgear.js, ui/newgame.js) put the result on and build the world again. Player
// only: the AI groups are rolled as ever.
import { GEAR, SKILLS, SUPPLIES, TRAITS, clashIn, traitKind } from "./data.js";
import { START_GEAR, START_TRUNK, CARRY_PLACES, slotChoices, carryChoices, trunkChoices, carrySpec, firstFit, trunkKg } from "./startgear.js";
import { CUSTOM_POINTS, pricePerson, pointsMax, itemPoints, slotPoints, vehiclePoints, skillsCost, nextLevelCost, ownPoints, carPool } from "./custompoints.js";
import { tierCount, traitPoints, tidyTiers } from "./traits.js";
import { standardMag } from "./mags.js";
import { randomSkills, fitSkills, skillTotal, SKILL_MAX } from "./appearance.js";

// Worn and held slots after the weapon: [slot, chance it is filled]. Shuffled each draw.
const SLOT_ODDS = [["armor", 0.55], ["backpack", 0.6], ["head", 0.4], ["tool", 0.35], ["rig", 0.3], ["legs", 0.2], ["arms", 0.2]];
// Things worth carrying (anything not in the catalogue is skipped).
const CARRY_POOL = ["bandagekit", "tourniquet", "traumakit", "puritabs", "flashlight", "headlamp", "crowbar", "waterfilter", "lighters", "batteries",
  "frag", "molotov", "pipebomb", "flare", "smokegren", "noisemaker", "bottle", "candy", "chocolate", "coffee", "cigarettes", "binoculars",
  "monocular", "handradio", "fishrod", "snarewire", "repairkit", "pepper", "knife", "hatchet", "earplugs", "whiskey", "novel", "cards"];
// What goes in the vehicle's back: these kinds of thing.
const TRUNK_CATS = new Set(["medical", "tools", "camp", "melee", "armor", "electronics", "optics", "books", "household", "treats", "smokes", "liquor", "packs", "pistol", "shotgun", "rifle", "bow"]);
const blankSlots = () => Object.fromEntries(START_GEAR.SLOTS.map((k) => [k, ""]));
const blankCarry = () => ({ pocket: [], pouch: [], pack: [] });
const noLauncher = (k) => !GEAR[k].launcher;

// Their points left with nothing worn or carried (skills, traits, the vehicle's back and a background's own count; a
// giver to the car pool keeps what the back takes of their offer for it: custompoints.js carPool).
/** @param {any} state @param {any} s */
export const kitBudget = (state, s) => Math.max(0, pricePerson(state, { ...s, startGear: null }).left);
// What the back can cost: what its payer has left with the back empty, and the car pool (everyone else's offers).
/** @param {any} state @param {any} payer */
export function trunkBudget(state, payer) {
  const max = pointsMax(state);
  const pool = carPool(state, max).offers.filter((o) => o.s.id !== payer.id).reduce((a, o) => a + o.n, 0);
  return Math.max(0, max - ownPoints(state, payer, max)) + pool;
}

// A random kit as picks (every slot named, things placed where they fit) costing at most budget. opts.fill: then spend
// what is left too (empty slots first, then things carried) so little of the budget is left over; opts.onto: add to
// these picks instead of starting bare (only the fill: a random build's leftover points).
/** @param {number} budget @param {import("./rng.js").Rng} rng @param {{ fill?: boolean, onto?: any }} [opts] */
export function randomKit(budget, rng, opts = {}) {
  const P = opts.onto || { slots: blankSlots(), carry: blankCarry() };
  for (const k of START_GEAR.SLOTS) if (!(k in P.slots)) P.slots[k] = "";
  if (!P.carry) P.carry = blankCarry();
  for (const w of CARRY_PLACES) P.carry[w] = [...(P.carry[w] || [])];
  let left = Math.max(0, Math.floor(budget));
  // A thing for an empty slot priced from lo×left up to share×left (anything cheaper when nothing is that dear).
  const take = (slot, share, lo = 0) => {
    if (P.slots[slot]) return;
    if (slot === "rig" && P.slots.armor && GEAR[P.slots.armor].pouches) return; // not over a vest with pouches
    const cap = Math.min(left, Math.max(left * share, 1));
    const ok = slotChoices(slot).filter((k) => noLauncher(k) && slotPoints(slot, k) <= cap);
    const dear = ok.filter((k) => slotPoints(slot, k) >= left * lo);
    const list = dear.length ? dear : ok;
    if (!list.length) return;
    const k = rng.pick(list);
    P.slots[slot] = k;
    left -= slotPoints(slot, k);
  };
  const put = (key) => {
    if (!GEAR[key] || itemPoints(key) > left) return false;
    const at = firstFit(P, key, carrySpec(P)); // the containers as picked so far
    if (!at) return false;
    const list = P.carry[at.where];
    while (list.length < at.i) list.push(null);
    list[at.i] = key;
    left -= itemPoints(key);
    return true;
  };
  const pool = new Set(carryChoices());
  const extras = CARRY_POOL.filter((k) => pool.has(k));
  if (!opts.onto) {
    take("weapon", 0.8); // most of it may go on the weapon (a gun is a pistol or better)
    for (const [slot, p] of rng.shuffle(SLOT_ODDS.map((x) => [...x]))) if (rng.chance(/** @type {number} */ (p))) take(/** @type {string} */ (slot), 0.5);
    const mag = P.slots.weapon && standardMag(P.slots.weapon);
    if (mag) for (let n = rng.int(1, 2); n > 0; n--) put(mag);
    for (let n = rng.int(1, 5); n > 0 && left > 0; n--) put(rng.pick(extras));
  }
  if (opts.fill) {
    // The empty slots, each a share of what is left (the weapon first if there is none), then things carried.
    if (!P.slots.weapon) take("weapon", 0.8, 0.3);
    const empty = rng.shuffle(SLOT_ODDS.map(([slot]) => /** @type {string} */ (slot)).filter((slot) => !P.slots[slot]));
    empty.forEach((slot, i) => take(slot, i === empty.length - 1 ? 1 : 0.6, 0.15));
    const mag = P.slots.weapon && standardMag(P.slots.weapon);
    if (mag) for (let n = 2; n > 0; n--) put(mag);
    for (let tries = 0; tries < 40 && left > 0; tries++) put(rng.pick(extras));
  }
  return P;
}

// A random back for the vehicle: { items, supplies } costing at most budget, weighing at most room kg.
/** @param {number} budget @param {number} room @param {import("./rng.js").Rng} rng */
export function randomTrunk(budget, room, rng) {
  const V = { items: /** @type {string[]} */ ([]), supplies: /** @type {Record<string, number>} */ ({}) };
  const fits = (W) => vehiclePoints(W) <= budget && trunkKg(W) <= room + 1e-9;
  const pool = trunkChoices().filter((k) => TRUNK_CATS.has(GEAR[k].cat) && noLauncher(k));
  for (let n = rng.int(1, 5); n > 0 && V.items.length < START_TRUNK.ITEMS; n--) {
    const spare = budget - vehiclePoints(V);
    const list = pool.filter((k) => itemPoints(k) <= Math.max(1, spare * 0.5));
    if (!list.length) break;
    const k = rng.pick(list);
    if (fits({ ...V, items: [...V.items, k] })) V.items.push(k);
  }
  const kinds = rng.shuffle(Object.keys(START_TRUNK.SUPPLIES).filter((k) => SUPPLIES[k]));
  for (const k of kinds.slice(0, rng.int(1, 4))) {
    const cap = START_TRUNK.SUPPLIES[k];
    let n = Math.max(1, Math.round((rng.range(0.15, 0.7) * cap) / 5) * 5);
    while (n > 0 && !fits({ ...V, supplies: { ...V.supplies, [k]: n } })) n = n > 5 ? n - 5 : n - 1;
    if (n >= Math.max(1, cap * 0.05)) V.supplies[k] = n; // not a token handful
  }
  return V;
}

// A whole colonist on points: traits (up to five, good to bad 3:2, tier I mostly), skills, a kit (a quarter to nearly half the points),
// and what is left into skills, then more kit: the total comes to the max (never over).
// Writes s.skills, s.traits / s.traitTier and s.startGear (the caller marks them and builds the world again).
/** @param {any} state @param {any} s @param {import("./rng.js").Rng} rng */
export function randomBuild(state, s, rng) {
  const max = pointsMax(state);
  s.skills = Object.fromEntries(SKILLS.map((k) => [k, 0]));
  s.traits = [];
  delete s.traitTier;
  s.startGear = { slots: blankSlots(), carry: blankCarry() };
  const avail = () => pricePerson(state, s, max).left;
  // Traits (user pick 2026-10-09): up to MAX_TRAITS (five), good to bad 3:2 (five: three good and two bad; three: two
  // and one). The bad ones first (they give points back, at most a third of the max), then the good ones, each only
  // when it costs at most a quarter of what there is.
  const count = rng.weighted([0, 1, 2, 3, 4, 5], (n) => [0.08, 0.14, 0.2, 0.22, 0.2, 0.16][n]);
  const good = Math.round((count * 3) / 5), want = { bad: count - good, good };
  for (const kind of ["bad", "good"]) {
    const keys = Object.keys(TRAITS).filter((t) => traitKind(t) === kind);
    let got = 0;
    for (let tries = 0; got < want[kind] && s.traits.length < CUSTOM_POINTS.MAX_TRAITS && tries < 60; tries++) {
      const t = rng.pick(keys);
      if (s.traits.includes(t) || clashIn(s.traits, t)) continue;
      const tier = tierCount(t) > 1 && rng.chance(0.3) ? rng.int(2, tierCount(t)) : 1;
      if (kind === "good" && traitPoints(t, tier) > Math.max(0, avail()) * 0.25) continue;
      s.traits.push(t);
      s.traitTier = { ...(s.traitTier || {}), [t]: tier };
      got++;
    }
  }
  tidyTiers(s);
  // Skills: most of what is left, the kit's share (a quarter to nearly a half) kept aside.
  const kitShare = Math.floor(Math.max(0, avail()) * rng.range(0.25, 0.45));
  const target = Math.max(0, avail() - kitShare);
  let skills = randomSkills(rng, Math.min(target, SKILL_MAX * SKILLS.length));
  for (let guard = 0; skillsCost(skills) > target && skillTotal(skills) > 0 && guard < 400; guard++) skills = fitSkills(rng, skills, skillTotal(skills) - 1);
  s.skills = skills;
  s.startGear = randomKit(Math.max(0, avail()), rng, { fill: true });
  // What is left goes into skills (the ones they have most of, mostly), and what skills cannot take into more kit.
  const intoSkills = () => {
    for (let guard = 0; guard < 400; guard++) {
      const left = avail();
      const can = SKILLS.filter((k) => s.skills[k] < SKILL_MAX && nextLevelCost(s.skills[k]) <= left);
      if (!can.length) break;
      s.skills[rng.weighted(can, (k) => 1 + s.skills[k])]++;
    }
  };
  intoSkills();
  if (avail() > 0) { s.startGear = randomKit(avail(), rng, { onto: s.startGear, fill: true }); intoSkills(); }
  return s;
}

// The places a kit's things are in, for the tools: [key].
/** @param {any} P */
export const kitKeys = (P) => [...Object.values(P.slots || {}).filter(Boolean), ...CARRY_PLACES.flatMap((w) => ((P.carry && P.carry[w]) || []).filter(Boolean))];
