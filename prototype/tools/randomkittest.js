// The dice under Customize (sim/randomkit.js), drawn many times on fixed seeds: every pick is a real one and every
// limit holds.
//   - randomKit: each slot empty or a thing for that slot (no launchers), no chest rig over a vest with pouches, things
//     carried only where they fit (a pocket, a pouch of its kind, the pack's slots), costing at most the budget, nothing
//     for 0; the fill spends more of it; onto keeps what was there;
//   - randomTrunk: at most START_TRUNK.ITEMS things the back takes, each supply within its cap (rounds by a crew gun's
//     calibre, at most START_TRUNK.ROUNDS), costing at most the budget and weighing at most the room; empty for 0; with
//     fill (2026-10-24: a starting vehicle's 🎲 Random, up to its point limit) the same, and Custom's open backs (any
//     thing and material, OPEN_TRUNK) within the budget and the room;
//   - randomBuild: real traits, none twice, none clashing, at most MAX_TRAITS (three good, two bad), tiers in range,
//     skills 0 to SKILL_MAX, a valid kit, never over the points;
//   - the gear window's dice (kitBudget) put nobody over, and a vehicle's back (its own point limit since 2026-10-24) is
//     on nobody's points;
//   - the same seed draws the same.
// Usage: node tools/randomkittest.js [-v]
import { createWorld } from "../src/sim/world.js";
import { GEAR, SKILLS, SUPPLIES, TRAITS, clashIn, traitKind } from "../src/sim/data.js";
import { Rng } from "../src/sim/rng.js";
import { START_GEAR, START_TRUNK, OPEN_TRUNK, CARRY_PLACES, carryChoices, trunkChoices, carrySpec, carryReason, carryList, sanitizeStartGear, sanitizeStartVehicle, trunkKg, pickKey } from "../src/sim/startgear.js";
import { CUSTOM_POINTS, slotPoints, pickPoints, vehiclePoints, pricePerson } from "../src/sim/custompoints.js";
import { tierCount } from "../src/sim/traits.js";
import { SKILL_MAX } from "../src/sim/appearance.js";
import { baseKey } from "../src/sim/rounds.js";
import { gunCals } from "../src/sim/ammo.js";
import { randomKit, randomTrunk, randomBuild, kitBudget, kitKeys } from "../src/sim/randomkit.js";
import { fleetRoom } from "../src/sim/startfleet.js";

let pass = 0, fail = 0;
const VERBOSE = process.argv.includes("-v");
const check = (ok, msg) => { if (ok) { pass++; if (VERBOSE) console.log(`  ok ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
const DRAWS = 300;
const BUDGETS = [0, 1, 5, 12, 25, 40, 60, 90, 150, 400];
// The first thing wrong with a draw (or ""), so a failing seed says why.
const firstBad = (list) => list.find(Boolean) || "";

// What a kit costs (the bill's own sum: custompoints.js ownBill), and what is wrong with it.
const kitCost = (P) => Object.entries(P.slots).reduce((a, [slot, k]) => a + slotPoints(slot, k, slot === "weapon" ? P.mods : null), 0)
  + CARRY_PLACES.reduce((a, w) => a + (P.carry[w] || []).reduce((b, e) => b + (pickKey(e) ? pickPoints(e) : 0), 0), 0);
const CARRY_OK = new Set(carryChoices());
function kitFault(P) {
  if (!P || !P.slots || !P.carry) return "no slots or carry";
  for (const slot of START_GEAR.SLOTS) {
    if (!(slot in P.slots)) return `${slot} not named`;
    const k = P.slots[slot];
    if (k === "") continue;
    if (!GEAR[k]) return `${slot}: unknown ${k}`;
    if (GEAR[k].slot !== slot) return `${slot}: ${k} goes in ${GEAR[k].slot}`;
    if (GEAR[k].launcher) return `${slot}: a launcher (${k})`;
  }
  for (const slot of Object.keys(P.slots)) if (!START_GEAR.SLOTS.includes(slot)) return `unknown slot ${slot}`;
  if (P.slots.rig && P.slots.armor && GEAR[P.slots.armor].pouches) return `a ${P.slots.rig} over a ${P.slots.armor} with pouches`;
  for (const w of Object.keys(P.carry)) if (!CARRY_PLACES.includes(w)) return `unknown place ${w}`;
  const spec = carrySpec(P);
  for (const x of carryList(P)) {
    if (!CARRY_OK.has(x.key)) return `${x.key} is not a thing to carry`;
    const why = carryReason(x.key, x.where, x.i, spec);
    if (why) return `${x.key} in ${x.where}[${x.i}]: ${why}`;
  }
  const S = sanitizeStartGear(P);
  if (!S || JSON.stringify(S.slots) !== JSON.stringify(P.slots)) return "slots changed by sanitizeStartGear";
  for (const w of CARRY_PLACES) if (carryList({ carry: { [w]: S.carry[w] } }).length !== carryList({ carry: { [w]: P.carry[w] } }).length) return `${w} cut by sanitizeStartGear`;
  return "";
}

section("randomKit: real picks, where they fit, within the budget");
{
  let faults = [], over = [], counts = { weapon: 0, backpack: 0, pack: 0 }, n = 0;
  for (const budget of BUDGETS) for (let seed = 1; seed <= DRAWS; seed++) {
    for (const fill of [false, true]) {
      const P = randomKit(budget, new Rng(seed * 7919 + budget), { fill });
      const f = kitFault(P);
      if (f) faults.push(`budget ${budget} seed ${seed}${fill ? " fill" : ""}: ${f}`);
      const c = kitCost(P);
      if (c > budget) over.push(`budget ${budget} seed ${seed}${fill ? " fill" : ""}: costs ${c}`);
      n++;
      if (P.slots.weapon) counts.weapon++;
      if (P.slots.backpack) counts.backpack++;
      if ((P.carry.pack || []).some(Boolean)) counts.pack++;
    }
  }
  check(!faults.length, `every slot and carried thing valid (${n} draws)${faults.length ? `: ${faults.length} bad, first ${faults[0]}` : ""}`);
  check(!over.length, `never over the budget${over.length ? `: ${over.length} over, first ${over[0]}` : ""}`);
  check(counts.weapon > 0 && counts.backpack > 0 && counts.pack > 0, `the dice do pick weapons (${counts.weapon}), packs (${counts.backpack}) and things in them (${counts.pack})`);
  // A pack's things only up to its slots, a rig's pouches only up to its pouches.
  let bad = "";
  for (let seed = 1; seed <= DRAWS && !bad; seed++) {
    const P = randomKit(150, new Rng(seed), { fill: true }), spec = carrySpec(P);
    for (const w of CARRY_PLACES) if ((P.carry[w] || []).length > spec[w].n) bad = `seed ${seed}: ${P.carry[w].length} in ${w} of ${spec[w].n}`;
    if ((P.carry.pack || []).some(Boolean) && !P.slots.backpack) bad = `seed ${seed}: things in a pack with no bag`;
  }
  check(!bad, `each container holds no more than its slots${bad ? `: ${bad}` : ""}`);
}

section("randomKit: nothing for nothing, the fill and onto");
{
  let empty = true;
  for (let seed = 1; seed <= 50; seed++) for (const fill of [false, true]) {
    const P = randomKit(0, new Rng(seed), { fill });
    if (kitKeys(P).length) empty = false;
  }
  check(empty, "a budget of 0: nothing worn or carried");
  let plain = 0, filled = 0;
  for (let seed = 1; seed <= DRAWS; seed++) {
    plain += 60 - kitCost(randomKit(60, new Rng(seed)));
    filled += 60 - kitCost(randomKit(60, new Rng(seed), { fill: true }));
  }
  check(filled < plain, `the fill leaves less over (on 60: ${(filled / DRAWS).toFixed(1)} a draw, without ${(plain / DRAWS).toFixed(1)})`);
  check(filled / DRAWS <= 60 * 0.25, `the fill spends most of the budget (on 60: ${(filled / DRAWS).toFixed(1)} left a draw)`);
  let kept = true, ok = true;
  for (let seed = 1; seed <= 100; seed++) {
    const A = randomKit(30, new Rng(seed));
    const was = JSON.stringify(A.slots), carried = carryList(A).map((x) => `${x.where}${x.i}${x.key}`);
    const before = kitCost(A);
    const B = randomKit(40, new Rng(seed + 1e6), { onto: A, fill: true });
    const now = carryList(B).map((x) => `${x.where}${x.i}${x.key}`);
    if (Object.entries(JSON.parse(was)).some(([slot, k]) => k && B.slots[slot] !== k) || carried.some((c) => !now.includes(c))) kept = false;
    if (kitFault(B) || kitCost(B) - before > 40) ok = false;
  }
  check(kept, "onto: what was worn and carried stays");
  check(ok, "onto: what it adds is valid and within its budget");
}

section("randomTrunk: things the back takes, supplies within caps, the points and the room");
{
  const TRUNK_OK = new Set(trunkChoices());
  const backKey = (V) => JSON.stringify([V.items, Object.entries(V.supplies).sort()]); // (supplies in any order)
  const ROUNDS = (S) => Object.keys(S).filter((k) => !(k in START_TRUNK.SUPPLIES));
  // The crew's guns' calibres, as the back's dice get them (ui/startgear.js gunCals), from a few worlds; and none.
  const CALS = [{}, ...[3, 11, 29, 47].map((seed) => gunCals(createWorld({ seed, factionCount: 3 }).survivors))];
  let faults = [], n = 0, any = { items: 0, supplies: 0 };
  for (const budget of BUDGETS) for (const room of [0, 5, 20, 60, 300]) for (let seed = 1; seed <= 60; seed++) {
    const cals = CALS[seed % CALS.length];
    const V = randomTrunk(budget, room, new Rng(seed * 104729 + budget * 31 + room), cals);
    const want = Object.keys(cals).length ? Object.keys(cals).map(baseKey) : ["9mm", "12ga"].map(baseKey);
    const at = `budget ${budget} room ${room} seed ${seed}`;
    const f = firstBad([
      V.items.length > START_TRUNK.ITEMS && `${V.items.length} things`,
      V.items.find((k) => !TRUNK_OK.has(k) || !GEAR[k]) && `not a back thing: ${V.items.find((k) => !TRUNK_OK.has(k))}`,
      V.items.find((k) => GEAR[k] && GEAR[k].launcher) && "a launcher",
      Object.entries(V.supplies).find(([, n]) => !(Number.isInteger(n) && n > 0)) && `a supply not a whole count: ${JSON.stringify(V.supplies)}`,
      Object.entries(V.supplies).find(([k, n]) => k in START_TRUNK.SUPPLIES && (!SUPPLIES[k] || n > START_TRUNK.SUPPLIES[k])) && `a supply past its cap: ${JSON.stringify(V.supplies)}`,
      ROUNDS(V.supplies).reduce((a, k) => a + V.supplies[k], 0) > START_TRUNK.ROUNDS && "too many rounds",
      ROUNDS(V.supplies).find((k) => !want.includes(k)) && `rounds not for the crew's guns: ${ROUNDS(V.supplies)} (want ${want})`,
      vehiclePoints(V) > budget && `costs ${vehiclePoints(V)}`,
      trunkKg(V) > room + 1e-9 && `weighs ${trunkKg(V)} kg`,
      backKey(sanitizeStartVehicle(V)) !== backKey(V) && `changed by sanitizeStartVehicle: ${JSON.stringify(V)} → ${JSON.stringify(sanitizeStartVehicle(V))}`,
    ]);
    if (f) faults.push(`${at}: ${f}`);
    if (V.items.length) any.items++;
    if (Object.keys(V.supplies).length) any.supplies++;
    n++;
  }
  check(!faults.length, `every back valid (${n} draws)${faults.length ? `: ${faults.length} bad, first ${faults[0]}` : ""}`);
  check(any.items > 0 && any.supplies > 0, `the dice do fill backs (things in ${any.items}, supplies in ${any.supplies})`);
  let empty = true;
  for (let seed = 1; seed <= 50; seed++) { const V = randomTrunk(0, 300, new Rng(seed)); if (V.items.length || Object.keys(V.supplies).length) empty = false; }
  check(empty, "a budget of 0: an empty back");
  // Filled up to the budget (the starting vehicles' 🎲 Random): Normal and Hardcore's caps, Custom's open backs.
  for (const open of [false, true]) {
    const bad = [];
    let m = 0, spent = 0, asked = 0;
    for (const budget of [0, 10, 60, 200, 1000]) for (const room of [0, 60, 300, 2500]) for (let seed = 1; seed <= 12; seed++) {
      const cals = CALS[seed % CALS.length];
      const V = randomTrunk(budget, room, new Rng(seed * 7919 + budget + room), cals, { fill: true, open });
      const f = firstBad([
        V.items.length > (open ? OPEN_TRUNK.ITEMS : START_TRUNK.ITEMS) && `${V.items.length} things`,
        V.items.find((k) => !TRUNK_OK.has(k)) && "not a back thing",
        Object.entries(V.supplies).find(([, q]) => !(Number.isInteger(q) && q > 0)) && `a supply not a whole count: ${JSON.stringify(V.supplies)}`,
        !open && Object.entries(V.supplies).find(([k, q]) => k in START_TRUNK.SUPPLIES && q > START_TRUNK.SUPPLIES[k]) && `a supply past its cap: ${JSON.stringify(V.supplies)}`,
        !open && ROUNDS(V.supplies).reduce((a, k) => a + V.supplies[k], 0) > START_TRUNK.ROUNDS && "too many rounds",
        vehiclePoints(V) > budget && `costs ${vehiclePoints(V)}`,
        trunkKg(V) > room + 1e-9 && `weighs ${trunkKg(V)} kg`,
        backKey(sanitizeStartVehicle(V, open)) !== backKey(V) && `changed by sanitizeStartVehicle: ${JSON.stringify(V)}`,
      ]);
      if (f) bad.push(`budget ${budget} room ${room} seed ${seed}: ${f}`);
      if (budget === 60 && room === 2500) { spent += vehiclePoints(V); asked += budget; }
      m++;
    }
    check(!bad.length, `${open ? "Custom (open)" : "Normal and Hardcore"}: every filled back valid (${m} draws)${bad.length ? `: ${bad.length} bad, first ${bad[0]}` : ""}`);
    check(spent >= asked * 0.9, `${open ? "Custom (open)" : "Normal and Hardcore"}: filled up to the budget (60 in a big room: ${spent} of ${asked} points spent)`);
  }
}

section("randomBuild: traits, skills and kit within the points");
{
  const GOOD_MAX = Math.round((CUSTOM_POINTS.MAX_TRAITS * 3) / 5), BAD_MAX = CUSTOM_POINTS.MAX_TRAITS - GOOD_MAX;
  let faults = [], over = [], left = [], counts = [0, 0, 0, 0, 0, 0], n = 0;
  for (const max of [0, 20, 50, 90, 200]) for (let seed = 1; seed <= 40; seed++) {
    const st = createWorld({ seed: seed + 500, factionCount: 3 });
    st.pointsMax = max;
    for (const s of st.survivors) {
      randomBuild(st, s, new Rng(seed * 31 + s.id));
      const tiers = s.traitTier || {};
      const kinds = s.traits.map(traitKind);
      const at = `max ${max} seed ${seed} ${s.name}`;
      const f = firstBad([
        s.traits.length > CUSTOM_POINTS.MAX_TRAITS && `${s.traits.length} traits`,
        s.traits.find((t) => !TRAITS[t]) && `unknown trait ${s.traits.find((t) => !TRAITS[t])}`,
        new Set(s.traits).size !== s.traits.length && `a trait twice: ${s.traits}`,
        s.traits.find((t, i) => clashIn(s.traits.slice(0, i), t)) && `clashing traits: ${s.traits}`,
        kinds.includes("neutral") && `a neutral trait: ${s.traits}`,
        kinds.filter((k) => k === "good").length > GOOD_MAX && `more than ${GOOD_MAX} good: ${s.traits}`,
        kinds.filter((k) => k === "bad").length > BAD_MAX && `more than ${BAD_MAX} bad: ${s.traits}`,
        Object.entries(tiers).find(([t, v]) => !s.traits.includes(t) || !Number.isInteger(v) || v < 2 || v > tierCount(t)) && `a tier out of range: ${JSON.stringify(tiers)}`,
        SKILLS.find((k) => !Number.isInteger(s.skills[k]) || s.skills[k] < 0 || s.skills[k] > SKILL_MAX) && `a skill out of range: ${JSON.stringify(s.skills)}`,
        Object.keys(s.skills).find((k) => !SKILLS.includes(k)) && `an unknown skill`,
        kitFault(s.startGear) && `kit: ${kitFault(s.startGear)}`,
      ]);
      if (f) faults.push(`${at}: ${f}`);
      const p = pricePerson(st, s);
      if (p.left < 0) over.push(`${at}: ${p.total} of ${max}`);
      left.push(p.left);
      counts[s.traits.length]++;
      n++;
    }
  }
  check(!faults.length, `every build valid (${n} colonists)${faults.length ? `: ${faults.length} bad, first ${faults[0]}` : ""}`);
  check(!over.length, `never over the points${over.length ? `: ${over.length} over, first ${over[0]}` : ""}`);
  const mean = left.reduce((a, x) => a + x, 0) / left.length;
  check(mean <= 3, `the points are nearly all spent (${mean.toFixed(2)} left a colonist on average, most ${Math.max(...left)})`);
  check(counts.every((c, i) => i === 0 || c > 0), `none to five traits all drawn (${counts.join(" / ")})`);
}

section("The gear window's dice: nobody over; the vehicle's back on nobody's points");
{
  let kitOver = "", backOver = "";
  for (let seed = 1; seed <= 40; seed++) {
    const st = createWorld({ seed: seed + 900, factionCount: 3 });
    st.pointsMax = 90;
    for (const s of st.survivors) {
      randomBuild(st, s, new Rng(seed * 13 + s.id));
      s.startGear = randomKit(kitBudget(st, s), new Rng(seed * 17 + s.id)); // the gear window's dice on a built colonist
      if (pricePerson(st, s).left < 0 && !kitOver) kitOver = `seed ${seed} ${s.name}: ${pricePerson(st, s).total} of 90`;
    }
    // The starting vehicle's back (sim/startfleet.js): up to its own point limit, in its room, on nobody's points.
    const before = st.survivors.map((s) => pricePerson(st, s).total).join();
    const limit = [0, 30, 60, 150][seed % 4];
    st.fleet[0].limit = limit;
    st.fleet[0].load = randomTrunk(limit, fleetRoom(st, 0), new Rng(seed * 19), gunCals(st.survivors), { fill: true });
    if ((vehiclePoints(st.fleet[0].load) > limit || trunkKg(st.fleet[0].load) > fleetRoom(st, 0) || st.survivors.map((s) => pricePerson(st, s).total).join() !== before) && !backOver) backOver = `seed ${seed}: ${vehiclePoints(st.fleet[0].load)} of ${limit}`;
  }
  check(!kitOver, `Random kit on a built colonist: within their points${kitOver ? `: ${kitOver}` : ""}`);
  check(!backOver, `Random back: within its own limit and room, nobody's points changed${backOver ? `: ${backOver}` : ""}`);
}

section("The same seed draws the same");
{
  const st = createWorld({ seed: 77, factionCount: 3 });
  const a = structuredClone(st.survivors[0]), b = structuredClone(st.survivors[0]);
  randomBuild(st, a, new Rng(5));
  randomBuild(st, b, new Rng(5));
  check(JSON.stringify([a.traits, a.traitTier, a.skills, a.startGear]) === JSON.stringify([b.traits, b.traitTier, b.skills, b.startGear]), "randomBuild");
  check(JSON.stringify(randomKit(50, new Rng(9), { fill: true })) === JSON.stringify(randomKit(50, new Rng(9), { fill: true })), "randomKit");
  check(JSON.stringify(randomTrunk(80, 100, new Rng(9))) === JSON.stringify(randomTrunk(80, 100, new Rng(9))), "randomTrunk");
  check(JSON.stringify(randomTrunk(300, 900, new Rng(9), {}, { fill: true, open: true })) === JSON.stringify(randomTrunk(300, 900, new Rng(9), {}, { fill: true, open: true })), "randomTrunk filled, open");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fail ? 1 : 0);
