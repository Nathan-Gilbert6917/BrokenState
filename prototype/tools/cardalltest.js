// A crew card's All (2026-10-16, user report: "says this colonist only, but the others' gear changes"): ui/newgame.js
// randomizeOne changes that colonist and nobody else.
//   - a normal start: a new starting weapon for them (2026-10-24, user report: "does not randomize the gear as well
//     in hardcore it works correctly"), their vest as it was, no trade with a crewmate: the others' kit as it was;
//   - Hardcore: a new background and grab for them, everyone else's grab (bag, weapon, things) as it was, also on the
//     first pick (the crew gets dice of its own then) and on repeated clicks; the car stays the owner's;
//   - the Gear dice in Hardcore: the same;
//   - a later rebuild keeps who the others were (bgKept), their grab and the car's dice; Start takes them off.
// Usage: node tools/cardalltest.js
import { createWorld, START_WEAPONS } from "../src/sim/world.js";
import { allCarried } from "../src/sim/inventory.js";
import { randomizeOne, randomizeGear } from "../src/ui/newgame.js";
import { clearStartGear } from "../src/sim/startgear.js";

let pass = 0, fail = 0;
const check = (ok, msg) => { if (ok) pass++; else { fail++; console.log(`FAIL ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const kitOf = (s) => JSON.stringify({ gear: Object.fromEntries(Object.entries(s.gear).map(([k, v]) => [k, v && v.key])), all: allCarried(s).map((it) => it.key).sort() });
// What main.js does around the card's dice: ui keeps the crew roll; a background picked gives the crew dice of its own.
const harness = (seed, mode) => {
  const ui = { started: false, freeEdit: false, ironman: false, crewRoll: null, pickRoll: false };
  const h = { ui, state: createWorld({ seed, factionCount: 5, mode }) };
  h.rebuild = (crew, pick = false) => {
    if (pick && ui.crewRoll == null) { ui.crewRoll = 1 + ((seed * 48271) % 2147483646); ui.pickRoll = true; }
    h.state = createWorld({ seed, factionCount: 5, mode, crew, crewRoll: ui.crewRoll });
    return h.state;
  };
  return h;
};
const others = (st, i) => st.survivors.filter((_, j) => j !== i);

section("A normal start: All draws them a new weapon, nobody else's kit changes");
for (const seed of [3, 42, 77]) {
  const h = harness(seed, "normal");
  const before = h.state.survivors.map(kitOf);
  for (const i of [0, 2, 4]) {
    const kit = JSON.parse(kitOf(h.state.survivors[i]));
    h.state = randomizeOne(h.state, h.ui, h.state.survivors[i], h.rebuild);
    const s = h.state.survivors[i];
    check(s.gear.weapon && START_WEAPONS.includes(s.gear.weapon.key) && s.gear.weapon.key !== kit.gear.weapon, `seed ${seed}: All on #${i} draws a new starting weapon (${kit.gear.weapon} → ${s.gear.weapon && s.gear.weapon.key})`);
    check(JSON.stringify(s.gear.armor && s.gear.armor.key) === JSON.stringify(kit.gear.armor), `seed ${seed}: All on #${i} keeps their vest`);
  }
  const after = h.state.survivors.map(kitOf);
  check([1, 3, 5].every((j) => before[j] === after[j]), `seed ${seed}: nobody else's kit changes (${[1, 3, 5].filter((j) => before[j] !== after[j]).join(", ") || "none"})`);
}

section("Hardcore: All and Gear leave the others' grab as it was");
for (const seed of [3, 42, 77, 101]) {
  for (const i of [0, 1, 2]) {
    const h = harness(seed, "hardcore");
    const before = h.state.survivors.map(kitOf);
    const owner = h.state.hardcore.start.carOwner, ownerAt = h.state.survivors.findIndex((s) => s.id === owner);
    h.state = randomizeOne(h.state, h.ui, h.state.survivors[i], h.rebuild);
    const after = h.state.survivors.map(kitOf);
    check(others(h.state, i).every((s) => before[h.state.survivors.indexOf(s)] === kitOf(s)), `seed ${seed}: All on #${i} (the first pick: the crew's own dice), nobody else's grab changes`);
    if (ownerAt !== i) check(h.state.survivors.findIndex((s) => s.id === h.state.hardcore.start.carOwner) === ownerAt, `seed ${seed}: the car is still #${ownerAt}'s`);
    h.state = randomizeOne(h.state, h.ui, h.state.survivors[i], h.rebuild);
    check(others(h.state, i).every((s) => after[h.state.survivors.indexOf(s)] === kitOf(s)), `seed ${seed}: All on #${i} again, nobody else's grab changes`);
    const mid = h.state.survivors.map(kitOf), j = (i + 1) % 3;
    h.state = randomizeGear(h.state, h.ui, h.state.survivors[j], h.rebuild);
    check(others(h.state, j).every((s) => mid[h.state.survivors.indexOf(s)] === kitOf(s)), `seed ${seed}: Gear on #${j}, nobody else's grab changes`);
  }
}

section("Hardcore: the dice kept on them, and taken off at Start");
{
  const h = harness(42, "hardcore");
  const rolls = h.state.survivors.map((s) => s.grabRoll);
  check(rolls.every(Number.isFinite) && new Set(rolls).size === rolls.length && h.state.survivors.every((s) => Number.isFinite(s.carRoll) && s.carRoll === h.state.survivors[0].carRoll), "each one's grab has its dice noted on them, the car's on everyone");
  check(h.state.survivors.every((s) => !s.startCustom && !s.grabPick), "the dice's own grab is not a pick (Ironman keeps it)");
  const again = createWorld({ seed: 42, factionCount: 5, mode: "hardcore" });
  check(again.survivors.map(kitOf).join() === h.state.survivors.map(kitOf).join(), "the same seed, the same grabs");
  h.state = randomizeGear(h.state, h.ui, h.state.survivors[1], h.rebuild);
  check(h.state.survivors[1].grabPick && h.state.survivors[1].startCustom && !h.state.survivors[0].grabPick, "Gear's new grab is a pick");
  clearStartGear(h.state);
  check(h.state.survivors.every((s) => !("grabRoll" in s) && !("carRoll" in s) && !("grabPick" in s) && !("bgKept" in s)), "Start takes the dice off");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
