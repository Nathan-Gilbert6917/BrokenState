// Consumable stacks in one inventory slot (2026-10-10, user decisions; sim/data-stacks.js STACK_MAX, sim/itemstack.js):
//   - what stacks and how many: small things 10, medium 5, bottles 3; throwables and anything that wears down never;
//   - a stack weighs, is worth and is named by what is in it ("Chocolate bar ×3");
//   - the same thing merges: stowed onto a person, moved onto a stack, put in an armory; up to the limit, the rest stays;
//   - Split (half into a spot of its own), used one at a time (Use, the evening treats, the armory's treats, a dewormer,
//     the festival's bottles), counted by what is in them;
//   - the new-run screen's ×N adds one stack (points N times), a save keeps stacks, an old save is tidied.
// Usage: node tools/stacktest.js [-v]
import { createWorld, makeSurvivor, hub, tickHour } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { STACK_MAX } from "../src/sim/data-stacks.js";
import { stackMax, countOf, withCount, stackLabel, canStack, mergeInto, splitOff, useOne, takeOneAt, countKey, migrateStacks } from "../src/sim/itemstack.js";
import { newItem, itemKg, itemAt, moveItem, stow, splitAt, useOneAt, ensureInv, packOf } from "../src/sim/inventory.js";
import { itemValue } from "../src/sim/valuation.js";
import { useItemOn, autoTreats } from "../src/sim/comforts.js";
import { baseDewormers } from "../src/sim/worm.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { blankCrew, crewSnapshot } from "../src/ui/newgame.js";
import { SG_CHANGE } from "../src/ui/startgear.js";
import { pricePerson, loosePoints } from "../src/sim/custompoints.js";
import { carryList } from "../src/sim/startgear.js";
import { allCarried } from "../src/sim/inventory.js";

let pass = 0, fail = 0;
const VERBOSE = process.argv.includes("-v");
const check = (ok, msg) => { if (ok) { pass++; if (VERBOSE) console.log(`  ok ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
const stack = (k, n) => withCount(newItem(k, 1), n);

section("What stacks, and how many");
{
  check(stackMax("chocolate") === 10 && stackMax("batteries") === 10 && stackMax("smokes") === 10, "small things: 10 a slot (chocolate, batteries, smokes)");
  check(stackMax("coffee") === 5 && stackMax("candles") === 5, "medium: 5 (a tin of coffee, candles)");
  check(stackMax("whiskey") === 3 && stackMax("vodka") === 3, "bottles: 3");
  check(stackMax("frag") === 1 && stackMax("flare") === 1 && stackMax("molotov") === 1, "grenades and throwables never stack");
  check(stackMax("bandagekit") === 1 && stackMax("puritabs") === 1 && stackMax("soap") === 1, "nothing that wears down stacks (bandage kits, tablets, soap)");
  check(Object.keys(STACK_MAX).every((k) => GEAR[k] && !GEAR[k].throw && !GEAR[k].dur), "every listed key is a real thing that neither is thrown nor wears");
  const c3 = stack("chocolate", 3);
  check(countOf(c3) === 3 && Math.abs(itemKg(c3) - 3 * GEAR.chocolate.weight) < 1e-9 && Math.abs(itemValue(c3) - 3 * itemValue(newItem("chocolate", 1))) < 1e-9, "a stack of three weighs and is worth three");
  check(stackLabel(c3) === `${GEAR.chocolate.name} ×3` && stackLabel(newItem("chocolate", 1)) === GEAR.chocolate.name, `named: "${stackLabel(c3)}"`);
  check(countOf(withCount(newItem("chocolate", 1), 40)) === 10, "never over its limit");
}

section("Merging, splitting, using");
{
  const a = stack("chocolate", 8), b = stack("chocolate", 5);
  check(canStack(a, b) && mergeInto(a, b) === 2 && countOf(a) === 10 && countOf(b) === 3, "merge: as many as fit (8 + 5 → 10, 3 left)");
  check(!canStack(stack("chocolate", 2), newItem("candy", 1)) && !canStack(newItem("frag", 1), newItem("frag", 1)), "different things and throwables do not merge");
  const half = splitOff(a, 4);
  check(half && countOf(half) === 4 && countOf(a) === 6, "split off 4 of 10");
  const u = stack("candy", 2);
  check(useOne(u) === true && countOf(u) === 1 && useOne(u) === false, "used one at a time: the last one is the item itself");
  const list = [stack("vodka", 3)];
  check(takeOneAt(list, 0) && countOf(list[0]) === 2 && list.length === 1, "one off a stack in an armory list");
  check(countKey([stack("dewormer", 3), newItem("dewormer", 1), null], "dewormer") === 4, "counted by what is in them");
}

section("In the inventory");
{
  const st = createWorld({ seed: 11, factionCount: 3 });
  const h = hub(st);
  const s = st.survivors.find((x) => x.location && x.location.kind === "base");
  ensureInv(s);
  s.pockets = [stack("chocolate", 7), null, null, null];
  const at = stow(s, stack("chocolate", 5));
  check(countOf(s.pockets[0]) === 10 && s.pockets.slice(1).some((x) => x && x.key === "chocolate" && countOf(x) === 2), `stowed onto the stack first, the rest to a free pocket (${at})`);
  s.pockets = [stack("candy", 4), stack("candy", 3), null, null];
  const msg = moveItem(st, `s:${s.id}:pocket:1`, `s:${s.id}:pocket:0`);
  check(countOf(s.pockets[0]) === 7 && !s.pockets[1], `moved onto the stack: merged ("${msg}")`);
  s.pockets[1] = stack("candy", 9);
  const m2 = moveItem(st, `s:${s.id}:pocket:1`, `s:${s.id}:pocket:0`);
  check(countOf(s.pockets[0]) === 10 && countOf(s.pockets[1]) === 6, `onto a stack with room for 3: 3 go, 6 stay ("${m2}")`);
  check(/full/.test(moveItem(st, `s:${s.id}:pocket:1`, `s:${s.id}:pocket:0`)), "onto a full stack: refused");
  h.armory.push(stack("candy", 2));
  const n0 = h.armory.length;
  moveItem(st, `s:${s.id}:pocket:1`, `armory:${h.id}:list`);
  check(h.armory.length === n0 && countKey(h.armory, "candy") === 8 && !s.pockets[1], "into the armory: onto its stack of the same");
  s.pockets[2] = stack("smokes", 6);
  const sp = splitAt(st, `s:${s.id}:pocket:2`);
  check(countOf(s.pockets[2]) === 3 && s.pockets.some((x, i) => i !== 2 && x && x.key === "smokes" && countOf(x) === 3), `Split: half into a spot of its own ("${sp}")`);
  // Used one at a time.
  s.pockets = [stack("chocolate", 3), null, null, null];
  s.mood = 20;
  const line = useItemOn(st, s.id, `s:${s.id}:pocket:0`);
  check(countOf(s.pockets[0]) === 2 && /chocolate/i.test(line), `Use: one eaten, two left ("${line}")`);
  check(useOneAt(st, `s:${s.id}:pocket:0`) && countOf(s.pockets[0]) === 1 && useOneAt(st, `s:${s.id}:pocket:0`) && !s.pockets[0], "useOneAt down to the last, then the slot is empty");
  // The armory's treats for the glum.
  h.armory.push(stack("chocolate", 4));
  for (const x of st.survivors) if (x.location && x.location.kind === "base" && x.location.baseId === h.id) { x.mood = 10; x.buzz = null; }
  const before = countKey(h.armory, "chocolate") + countKey(h.armory, "instcoffee") + countKey(h.armory, "smokes") + countKey(h.armory, "vodka");
  const lines = autoTreats(st, h);
  const after = countKey(h.armory, "chocolate") + countKey(h.armory, "instcoffee") + countKey(h.armory, "smokes") + countKey(h.armory, "vodka");
  check(lines.length > 0 && before - after === lines.length, `the armory's treats: one off the stack for each (${lines.length} used, ${after} left)`);
  // Dewormers counted by what is in a stack.
  h.armory.push(stack("dewormer", 3));
  check(baseDewormers(st, h) >= 3, `a stack of three dewormers counts as three (${baseDewormers(st, h)})`);
}

section("New-run ×N, saves");
{
  const mk = () => { const w = createWorld({ seed: 42, factionCount: 5, crewRoll: 9091, crew: blankCrew(createWorld({ seed: 42, factionCount: 5, crewRoll: 9091 })) }); w.pointsMax = 80; return w; };
  const st = mk();
  const ui = { started: false, freeEdit: true, ironman: false, gearEdit: { i: 0, sel: null, msg: "" } };
  SG_CHANGE["sg-qty"](st, ui, { value: "7", dataset: { k: "qty" } });
  SG_CHANGE["sg-item-add"](st, ui, { value: "chocolate", dataset: {} });
  const s = st.survivors[0];
  const picks = carryList(s.startGear).filter((x) => x.key === "chocolate");
  check(picks.length === 1 && picks[0].entry.n === 7, "×7 chocolate: one pick, a stack of seven");
  check(pricePerson(st, s).carried === 7 * loosePoints("chocolate"), "priced seven times");
  const b = createWorld({ seed: 42, factionCount: 5, crewRoll: 9091, crew: crewSnapshot(st) });
  const it = allCarried(b.survivors[0]).find((x) => x.key === "chocolate");
  check(it && countOf(it) === 7, "rebuilt: a stack of seven in a pocket");
  SG_CHANGE["sg-qty"](st, ui, { value: "14", dataset: { k: "qty" } });
  SG_CHANGE["sg-item-add"](st, ui, { value: "candy", dataset: {} });
  check(carryList(s.startGear).filter((x) => x.key === "candy").map((x) => x.entry.n || 1).join("+") === "10+4", "×14 candy: a full stack of ten and one of four");
  // A save keeps stacks; an old save is tidied.
  const w = createWorld({ seed: 7, factionCount: 3 });
  const h = hub(w);
  h.armory.push(stack("whiskey", 3));
  const text = saveToString(w);
  const ld = loadFromString(text);
  check(countKey(hub(ld).armory, "whiskey") === 3 && saveToString(ld) === text, "a save and load keep the stack (and round-trip exactly)");
  const old = loadFromString(text);
  hub(old).armory.push({ key: "knife", name: "Knife", quality: 1, n: 4 }, { key: "candy", name: "Candy bar", quality: 1, n: 1 });
  migrateStacks(old);
  check(!("n" in hub(old).armory.find((x) => x.key === "knife")) && !("n" in hub(old).armory.find((x) => x.key === "candy")), "an old save's tidy: no count on what does not stack, no count of one");
  // A few hours go by with stacks about.
  let err = null;
  try { for (let i = 0; i < 48; i++) tickHour(ld); } catch (e) { err = e; }
  check(!err, `two days with stacks in the armory${err ? `: ${err.stack.split("\n").slice(0, 3).join(" | ")}` : ""}`);
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
