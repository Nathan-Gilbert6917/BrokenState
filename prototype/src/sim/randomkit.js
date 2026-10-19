// @ts-check
// Random builds under Customize (2026-10-09, user requests: "allow to randomize a select one and not just all"; the
// gear dice "gives me 33 over 80 points"; the vehicle's back "gave the same two items each time ... have it empty then
// set the new gear"). Each is a fresh draw every time (not the world's dice) and stays within the colonist's points
// (sim/custompoints.js), whatever else they have:
//   randomKit: what they wear, hold and carry, for the points left after their skills, traits and the vehicle's back
//     (a gun in the hands brings its spare magazines and a box or two of its rounds in the pockets, pouches or pack:
//     the user's request 2026-10-18, "when a gun is set also set some loose or magazine(s) of ammo ... in the inventory
//     slots of the survivor"; the rounds in the gun's price go to the stock as ever);
//   randomTrunk: the vehicle's back, for what its payer has left and the car pool, in the room there is;
//   randomTraits: traits only, within what they have left (the crew card's Traits);
//   randomBuild: a whole colonist from a blank slate: traits (none to two), skills and kit, the rest into skills;
//   randomEverything: every colonist's build and the vehicle's back in one draw.
// The new-run screen's buttons (ui/startgear.js, ui/newgame.js) put the result on and build the world again. Player
// only: the AI groups are rolled as ever.
import { GEAR, SKILLS, SUPPLIES, TRAITS, clashIn, traitKind } from "./data.js";
import { START_GEAR, START_TRUNK, CARRY_PLACES, slotChoices, carryChoices, trunkChoices, carrySpec, firstFit, trunkKg, pickKey } from "./startgear.js";
import { CUSTOM_POINTS, pricePerson, maxFor, itemPoints, slotPoints, vehiclePoints, skillsCost, nextLevelCost, ownPoints, carPool, loosePoints } from "./custompoints.js";
import { tierCount, traitPoints, tidyTiers } from "./traits.js";
import { standardMag } from "./mags.js";
import { baseKey } from "./rounds.js";
import { gunCals, calOf } from "./ammo.js";
import { CALIBERS } from "./data-ammo.js";
import { pickN, pickStackMax } from "./startgear.js"; // a box of rounds onto a stack of them already picked
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
// What the back's picks can cost: what its payer has left with the back empty, and the car pool (everyone else's
// offers), less a normal start's background car backs (on the same bill: custompoints.js bgBacks).
/** @param {any} state @param {any} payer */
export function trunkBudget(state, payer) {
  const max = maxFor(state, payer);
  const K = carPool(state);
  const pool = K.offers.filter((o) => o.s.id !== payer.id).reduce((a, o) => a + o.n, 0);
  return Math.max(0, Math.max(0, max - ownPoints(state, payer, max)) + pool - K.extra);
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
  let reserve = 0; // points kept for the gun's rounds while the other slots are drawn (released when they are put)
  // A thing for an empty slot priced from lo×left up to share×left (anything cheaper when nothing is that dear).
  const take = (slot, share, lo = 0) => {
    if (P.slots[slot]) return;
    if (slot === "rig" && P.slots.armor && GEAR[P.slots.armor].pouches) return; // not over a vest with pouches
    const spend = Math.max(0, left - reserve);
    const cap = Math.min(spend, Math.max(spend * share, 1));
    const ok = slotChoices(slot).filter((k) => noLauncher(k) && slotPoints(slot, k) <= cap && !(slot === "armor" && P.slots.rig && GEAR[k].pouches)); // nor a vest with pouches over a rig
    const dear = ok.filter((k) => slotPoints(slot, k) >= left * lo);
    const list = dear.length ? dear : ok;
    if (!list.length) return;
    const k = rng.pick(list);
    P.slots[slot] = k;
    left -= slotPoints(slot, k);
  };
  const put = (key) => {
    if (!GEAR[key] || loosePoints(key) > left - reserve) return false; // (the reserve: the gun's box of rounds comes first)
    const at = firstFit(P, key, carrySpec(P)); // the containers as picked so far
    if (!at) return false;
    const list = P.carry[at.where];
    while (list.length < at.i) list.push(null);
    list[at.i] = key;
    left -= loosePoints(key);
    return true;
  };
  // The gun's rounds: the box key of the common round of its calibre (null: no gun, or one with no boxed rounds: a bow,
  // a launcher), and a box onto a stack of them already carried (up to a slot's worth: pickStackMax) or into a new spot.
  const roundKey = () => { const cal = P.slots.weapon ? calOf(P.slots.weapon) : null; const k = cal && CALIBERS[cal] ? baseKey(cal) : null; return k && GEAR[k] ? k : null; };
  const boxesOf = (key) => CARRY_PLACES.reduce((a, w) => a + P.carry[w].reduce((b, e) => b + (pickKey(e) === key ? pickN(e) : 0), 0), 0);
  const putBox = (key) => {
    if (!GEAR[key] || loosePoints(key) > left) return false;
    for (const w of CARRY_PLACES) {
      const list = P.carry[w];
      for (let i = 0; i < list.length; i++) if (pickKey(list[i]) === key && pickN(list[i]) < pickStackMax(key)) { list[i] = { key, n: pickN(list[i]) + 1 }; left -= loosePoints(key); return true; }
    }
    return put(key);
  };
  // Rounds for the gun in the hands: lo to hi boxes of its common round where they fit (a pouch of their kind, a pocket,
  // the pack), as far as the points go; at least `least` boxes with it in all. Nothing for a gun with no boxed rounds.
  const putRounds = (lo, hi, least = 0) => {
    reserve = 0;
    const key = roundKey();
    if (!key) return;
    const want = Math.max(least - boxesOf(key), rng.int(lo, hi));
    for (let n = want; n > 0; n--) if (!putBox(key)) break;
  };
  const pool = new Set(carryChoices());
  const extras = CARRY_POOL.filter((k) => pool.has(k));
  if (!opts.onto) {
    take("weapon", 0.8); // most of it may go on the weapon (a gun is a pistol or better)
    reserve = roundKey() ? loosePoints(/** @type {string} */ (roundKey())) : 0; // a box of its rounds is kept for after the slots
    for (const [slot, p] of rng.shuffle(SLOT_ODDS.map((x) => [...x]))) if (rng.chance(/** @type {number} */ (p))) take(/** @type {string} */ (slot), 0.5);
    const mag = P.slots.weapon && standardMag(P.slots.weapon);
    if (mag) for (let n = rng.int(1, 2); n > 0; n--) put(mag);
    putRounds(1, 2); // its rounds to hand: a box or two in the pockets, a pouch or the pack
    for (let n = rng.int(1, 5); n > 0 && left > 0; n--) put(rng.pick(extras));
  }
  if (opts.fill) {
    // The empty slots, each a share of what is left (the weapon first if there is none), then things carried.
    if (!P.slots.weapon) take("weapon", 0.8, 0.3);
    const empty = rng.shuffle(SLOT_ODDS.map(([slot]) => /** @type {string} */ (slot)).filter((slot) => !P.slots[slot]));
    empty.forEach((slot, i) => take(slot, i === empty.length - 1 ? 1 : 0.6, 0.15));
    const mag = P.slots.weapon && standardMag(P.slots.weapon);
    if (mag) for (let n = 2; n > 0; n--) put(mag);
    putRounds(1, 2, 1); // a gun with no rounds on them yet gets a box at least
    for (let tries = 0; tries < 40 && left > 0; tries++) put(rng.pick(extras));
  }
  return P;
}

// A random back for the vehicle: { items, supplies } costing at most budget, weighing at most room kg.
// cals: the crew's guns' calibres ({ cal: guns }): rounds in the back are the common rounds of one of them (none: 9mm
// or 12 gauge).
/** @param {number} budget @param {number} room @param {import("./rng.js").Rng} rng @param {Record<string, number>} [cals] */
export function randomTrunk(budget, room, rng, cals = {}) {
  const V = { items: /** @type {string[]} */ ([]), supplies: /** @type {Record<string, number>} */ ({}) };
  const fits = (W) => vehiclePoints(W) <= budget && trunkKg(W) <= room + 1e-9;
  const pool = trunkChoices().filter((k) => TRUNK_CATS.has(GEAR[k].cat) && noLauncher(k));
  for (let n = rng.int(1, 5); n > 0 && V.items.length < START_TRUNK.ITEMS; n--) {
    const spare = budget - vehiclePoints(V);
    const list = pool.filter((k) => loosePoints(k) <= Math.max(1, spare * 0.5));
    if (!list.length) break;
    const k = rng.pick(list);
    if (fits({ ...V, items: [...V.items, k] })) V.items.push(k);
  }
  const kinds = rng.shuffle([...Object.keys(START_TRUNK.SUPPLIES).filter((k) => SUPPLIES[k]), "rounds"]);
  for (const kind of kinds.slice(0, rng.int(1, 4))) {
    const cl = Object.keys(cals || {}).sort();
    const k = kind === "rounds" ? baseKey(cl.length ? rng.pick(cl) : rng.pick(["9mm", "12ga"])) : kind;
    const cap = kind === "rounds" ? START_TRUNK.ROUNDS : START_TRUNK.SUPPLIES[k];
    let n = Math.max(1, Math.round((rng.range(0.15, 0.7) * cap) / 5) * 5);
    while (n > 0 && !fits({ ...V, supplies: { ...V.supplies, [k]: n } })) n = n > 5 ? n - 5 : n - 1;
    if (n >= Math.max(1, cap * 0.05)) V.supplies[k] = n; // not a token handful
  }
  return V;
}

// Random traits on points (randomBuild; the crew card's Traits under Customize): up to MAX_TRAITS (five), good to bad
// 3:2 (user pick 2026-10-09: five: three good and two bad; three: two and one), in place of the ones they had. The bad ones
// first (they give points back, at most a third of the max), then the good ones, each only when it costs at most a
// quarter of what there is. avail(): their points left as things stand (the default: pricePerson's).
/** @param {any} state @param {any} s @param {import("./rng.js").Rng} rng @param {() => number} [avail] */
export function randomTraits(state, s, rng, avail = () => pricePerson(state, s).left) {
  s.traits = [];
  delete s.traitTier;
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
  return s;
}

// A whole colonist on points: traits (up to five, good to bad 3:2, tier I mostly), skills, a kit (a quarter to nearly half the points),
// and what is left into skills, then more kit: the total comes to the max (never over).
// Writes s.skills, s.traits / s.traitTier and s.startGear (the caller marks them and builds the world again).
// opts.keep: points kept aside (left unspent: what randomEverything draws the vehicle's back on).
/** @param {any} state @param {any} s @param {import("./rng.js").Rng} rng @param {{ keep?: number }} [opts] */
export function randomBuild(state, s, rng, opts = {}) {
  const max = maxFor(state, s);
  s.skills = Object.fromEntries(SKILLS.map((k) => [k, 0]));
  s.traits = [];
  delete s.traitTier;
  s.startGear = { slots: blankSlots(), carry: blankCarry() };
  const keep = Math.max(0, Math.floor(opts.keep || 0));
  const avail = () => pricePerson(state, s, max).left - keep;
  randomTraits(state, s, rng, avail);
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

// Randomize everything (Customize): every colonist a random build and the vehicle's back a new random load, in one
// draw. The back is emptied first; everyone but its payer is built (what they would give the car pool goes on their own
// build), then the payer with a tenth to a quarter of the max kept aside, and the back is drawn on what that leaves
// (rounds for the crew's new guns), so nobody ends over. room(): the back's kg, asked once the kits are drawn (Hardcore:
// the riders' kit rides in the car); null: no vehicle, the back stays empty. Writes as randomBuild does, and
// payer.startVehicle (the caller marks them and builds the world again).
/** @param {any} state @param {any} payer @param {(() => number) | null} room @param {import("./rng.js").Rng} rng */
export function randomEverything(state, payer, room, rng) {
  for (const s of state.survivors) delete s.startVehicle;
  for (const s of state.survivors) if (s !== payer) randomBuild(state, s, rng);
  randomBuild(state, payer, rng, { keep: room ? Math.floor(maxFor(state, payer) * rng.range(0.1, 0.25)) : 0 });
  if (!room) return state;
  const guns = state.survivors.map((s) => s.startGear.slots.weapon).filter(Boolean).map((key) => ({ key }));
  payer.startVehicle = randomTrunk(trunkBudget(state, payer), room(), rng, gunCals([], guns));
  return state;
}

// The places a kit's things are in, for the tools: [key].
/** @param {any} P */
export const kitKeys = (P) => [...Object.values(P.slots || {}).filter(Boolean), ...CARRY_PLACES.flatMap((w) => ((P.carry && P.carry[w]) || []).map(pickKey).filter(Boolean))];
