// Supplies as items you hold, and rounds boxed again (2026-10-16 user requests; sim/supitems.js, data-supitems.js,
// sim/itemstack.js boxRounds / mergeForm, sim/raidloot.js stow):
//   - every supply in a stock has an item form (rounds their boxes, the rest s_<key>), a count stack up to its slot size,
//     small ones in a pocket, the rest in a pack or the off hand, bulky ones (building materials, car parts) neither;
//   - out of a base's stores onto a person (pockets and pack, or the off hand), back into the stock at once when put in
//     the armory (and every hour); food keeps the shelf and the eggs of its lot, and spoiled food is thrown out;
//   - home with a team: what they hold is unpacked into the stores (rounds stay on them);
//   - a body's supplies after a battle into someone's pockets as items;
//   - loose rounds packed back into boxes (Box), boxes opened (Open box), loose and boxed of a load dropped on each other.
// Usage: node tools/supitemstest.js [-v]
import { createWorld, hub, atBase, tickHour } from "../src/sim/world.js";
import { GEAR, SUPPLIES } from "../src/sim/data.js";
import { AMMO_STACK } from "../src/sim/data-stacks.js";
import { roundItem, isSupItem, canStack, mergeInto, stackLabel, boxSize } from "../src/sim/itemstack.js";
import { itemKg, itemAt, ensureInv, packOf, newItem, fitReason, moveItem, openAt, boxAt, quickMove } from "../src/sim/inventory.js";
import { itemValue } from "../src/sim/valuation.js";
import { itemKeyOf, stockKeyOf, slotCap, takeOut, putBack, stockToPerson, roomOn, shelfLeft, unpackPerson, bodyToPerson, supItems } from "../src/sim/supitems.js";
import { settleBase } from "../src/sim/ammo.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { clearFood } from "./foodkit.js";

let pass = 0, fail = 0;
const VERBOSE = process.argv.includes("-v");
const check = (ok, msg) => { if (ok) { pass++; if (VERBOSE) console.log(`  ok ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const held = (s, key) => [...s.pockets, ...(packOf(s) || []), s.gear.tool].reduce((a, it) => a + (it && stockKeyOf(it) === key ? it.dur : 0), 0);
function world(seed = 11) {
  const st = createWorld({ seed, factionCount: 3 });
  st.cards.length = 0;
  const h = hub(st);
  const s = atBase(st, h.id)[0];
  ensureInv(s);
  s.pockets = s.pockets.map(() => null);
  s.gear.tool = null;
  if (!s.gear.backpack) s.gear.backpack = newItem("backpack");
  packOf(s).fill(null);
  return { st, h, s };
}

section("Every supply has an item form");
{
  const keys = Object.keys(SUPPLIES).filter((k) => k !== "ammo");
  check(keys.every((k) => itemKeyOf(k)), `all ${keys.length} supplies but the abstract ammo count can be held (${keys.filter((k) => !itemKeyOf(k)).join(", ") || "none missing"})`);
  check(itemKeyOf("ammo") === null && itemKeyOf("a_9mm_fmj") === "a_9mm_fmj" && itemKeyOf("brass") === "brass" && itemKeyOf("meds") === "s_meds", "rounds are their boxes, the bench's brass its bag, meds s_meds; the abstract ammo none");
  check(GEAR.s_meds.small && !GEAR.s_water.small && !GEAR.s_water.bulky && GEAR.s_buildmat.bulky && GEAR.s_carparts.bulky, "meds go in a pocket, water in a pack, building materials and car parts are bulky");
  const meds = supItems("meds", 12)[0];
  check(near(itemKg(meds), 12 * SUPPLIES.meds.weight) && near(itemValue(meds), 12 * itemValue(supItems("meds", 1)[0]), 1e-6), `12 meds weigh and are worth 12 doses (${itemKg(meds).toFixed(2)} kg)`);
  check(stackLabel(meds) === "Meds ×12" && slotCap("meds") === 20 && supItems("meds", 45).map((x) => x.dur).join(",") === "20,20,5", `"${stackLabel(meds)}", 20 a slot: 45 is 20 + 20 + 5`);
  check(slotCap("f_beans") === 6 && slotCap("f_candybar") === 12 && GEAR.s_f_beans.small, "food by weight: 6 cans of beans a slot (3 kg), candy bars 12");
  check(!fitReason(meds, "tool") && !fitReason(supItems("water", 2)[0], "tool") && /too big/.test(fitReason(supItems("buildmat", 1)[0], "tool")) && !fitReason(roundItem("a_9mm_fmj", 50), "tool"), "the off hand holds meds, water, a box of rounds; not building materials");
  check(/too big for a pocket/.test(fitReason(supItems("water", 1)[0], "pocket")) && /too big for a pack/.test(fitReason(supItems("buildmat", 1)[0], "pack")), "water is no pocket thing; building materials no pack thing");
  const a = supItems("meds", 15)[0], b = supItems("meds", 10)[0];
  check(canStack(a, b) && mergeInto(a, b) === 5 && a.dur === 20 && b.dur === 5, "two stacks of meds merge up to 20");
}

section("Out of the stores and back");
{
  const { st, h, s } = world();
  h.stock.meds = 30;
  check(roomOn(s, "meds") > 0 && stockToPerson(st, h, "meds", 25, s) === 25 && h.stock.meds === 5 && held(s, "meds") === 25, `25 meds out of the stores into the pockets (${held(s, "meds")} held, ${h.stock.meds} left)`);
  check(s.pockets.filter((x) => x && x.key === "s_meds").map((x) => x.dur).join(",") === "20,5", "as two pocket stacks: 20 and 5");
  h.stock.water = 10;
  check(stockToPerson(st, h, "water", 3, s, { hand: true }) === 3 && s.gear.tool && s.gear.tool.key === "s_water" && s.gear.tool.dur === 3, "3 litres of water into the off hand");
  check(stockToPerson(st, h, "water", 5, s, { hand: true }) === 1 && s.gear.tool.dur === 4, "the hand holds 4: one more fits");
  h.stock.buildmat = 4;
  check(roomOn(s, "buildmat") === 0 && stockToPerson(st, h, "buildmat", 2, s) === 0 && h.stock.buildmat === 4, "building materials do not go on a person: nothing moves");
  // Back: into the armory, stock again at once.
  const pi = s.pockets.findIndex((x) => x && x.key === "s_meds" && x.dur === 20);
  const m = moveItem(st, `s:${s.id}:pocket:${pi}`, `armory:${h.id}:list`);
  check(h.stock.meds === 25 && !h.armory.some(isSupItem), `back in the armory: 20 meds in the stores at once (${m})`);
  quickMove(st, `s:${s.id}:tool`, s.id);
  check(!s.gear.tool && h.stock.water === 10, "the water from the hand back (a quick move)");
  // Hourly too: one left in the armory by other means.
  h.armory.push(supItems("meds", 3)[0]);
  settleBase(st, h);
  check(h.stock.meds === 28 && !h.armory.some(isSupItem), "an item left in the armory is stock again within the hour");
}

section("Food keeps its shelf, its eggs, and spoils");
{
  const { st, h, s } = world(12);
  clearFood(h);
  h.stock.f_bread = 4;
  h.foodLots = { f_bread: [{ q: 4, left: 3 }] };
  const items = takeOut(st, h, "f_bread", 4);
  check(items.length === 1 && near(shelfLeft(st, items[0]), 3, 1e-6), `bread taken out has the lot's 3 days left (${shelfLeft(st, items[0])})`);
  check(putBack(st, h, items[0]) === 4 && near(h.foodLots.f_bread.reduce((a, l) => a + l.q, 0), 4) && near(h.foodLots.f_bread[0].left, 3, 0.01), "put back: a lot with the 3 days it has left");
  const it2 = takeOut(st, h, "f_bread", 2)[0];
  for (let i = 0; i < 24 * 4; i++) st.hour++;
  check(shelfLeft(st, it2) <= 0 && putBack(st, h, it2) === 0, "four days in a pocket: spoiled, and thrown out when put back");
  h.stock.f_venison = 3;
  h.foodLots.f_venison = [{ q: 3, left: 2, egg: true }];
  const v = takeOut(st, h, "f_venison", 3);
  check(v.length === 1 && v[0].egg && !canStack(v[0], supItems("f_venison", 1)[0]), "venison with the worm's eggs keeps them, and does not stack with clean meat");
  s.pockets[0] = supItems("f_beans", 2, { until: 50 })[0];
  const fresh = supItems("f_beans", 2, { until: 900 })[0];
  mergeInto(s.pockets[0], fresh);
  check(s.pockets[0].dur === 4 && s.pockets[0].until === 50, "two stacks of beans merge, keeping the sooner spoil day");
}

section("Home with a team: what they hold is unpacked");
{
  const { st, h, s } = world(13);
  h.stock.meds = 0;
  s.pockets[0] = supItems("meds", 6)[0];
  s.pockets[1] = roundItem("a_9mm_fmj", 50);
  s.gear.tool = supItems("water", 2)[0];
  const w0 = h.stock.water || 0;
  const n = unpackPerson(st, s, h);
  check(n === 8 && h.stock.meds === 6 && h.stock.water === w0 + 2 && !s.pockets[0] && !s.gear.tool, `6 meds and 2 water into the stores (${n} units)`);
  check(s.pockets[1] && s.pockets[1].key === "a_9mm_fmj", "the box of rounds stays on them (their own kit, as before)");
}

section("A body's supplies into someone's pockets");
{
  const { st, h, s } = world(14);
  const body = ensureInv({ name: "Raider", kind: "human", uid: 9, kit: null, supplies: { meds: 4, a_9mm_fmj: 30, buildmat: 2 } });
  st.combat = { over: true, bodies: [body], setup: { baseId: h.id }, units: [], place: "The gate", result: { outcome: "victory", loot: { supplies: {}, gear: [] } } };
  const m = bodyToPerson(st, 0, "meds", Infinity, s);
  check(held(s, "meds") === 4 && !body.supplies.meds && st.combat.result.loot.supplies.meds === 4, `4 meds from the body into a pocket (${m})`);
  bodyToPerson(st, 0, "a_9mm_fmj", 20, s);
  const r = s.pockets.find((x) => x && x.key === "a_9mm_fmj");
  check(r && r.loose && r.dur === 20 && body.supplies.a_9mm_fmj === 10, "20 rounds off it: a loose handful in a pocket, 10 left");
  check(/No room/.test(bodyToPerson(st, 0, "buildmat", 1, s)) && body.supplies.buildmat === 2, "building materials: no room on a person (they go to the stores)");
  st.combat = null;
}

section("Loose rounds into boxes, and back");
{
  const { st, s } = world(15);
  const box = boxSize("a_9mm_fmj");
  s.pockets[0] = roundItem("a_9mm_fmj", 70, true);
  const m = boxAt(st, `s:${s.id}:pocket:0`);
  check(!s.pockets[0].loose && s.pockets[0].dur === 70 && stackLabel(s.pockets[0]) === `9mm FMJ · ${Math.ceil(70 / box)} boxes (70)`, `70 loose boxed in place: "${stackLabel(s.pockets[0])}" (${m})`);
  s.pockets[1] = roundItem("a_12ga_slug", 40, true);
  const slugBox = boxSize("a_12ga_slug");
  boxAt(st, `s:${s.id}:pocket:1`);
  const boxed = s.pockets.find((x, i) => i !== 1 && x && x.key === "a_12ga_slug");
  check(s.pockets[1].loose && s.pockets[1].dur === 40 - AMMO_STACK.BOXES * slugBox && boxed && !boxed.loose && boxed.dur === AMMO_STACK.BOXES * slugBox, `40 loose slugs: five boxes of ${slugBox} beside the ${s.pockets[1].dur} still loose`);
  check(/not loose rounds/.test(boxAt(st, `s:${s.id}:pocket:0`)), "boxes are not boxed again");
  openAt(st, `s:${s.id}:pocket:0`);
  check(s.pockets[0].loose && s.pockets[0].dur === 70, "Open box: loose again (70)");
  // Dropped on each other: the moved stack takes the form of the one it lands on.
  s.pockets = [roundItem("a_9mm_fmj", 30, true), roundItem("a_9mm_fmj", 100), null, null];
  const m2 = moveItem(st, `s:${s.id}:pocket:0`, `s:${s.id}:pocket:1`);
  check(!s.pockets[0] && s.pockets[1].dur === 130 && !s.pockets[1].loose, `loose dropped on boxes: packed into them (${m2})`);
  s.pockets = [roundItem("a_9mm_fmj", 50), roundItem("a_9mm_fmj", 60, true), null, null];
  moveItem(st, `s:${s.id}:pocket:0`, `s:${s.id}:pocket:1`);
  check(s.pockets[1].dur === 80 && s.pockets[1].loose && s.pockets[0] && s.pockets[0].dur === 30 && !s.pockets[0].loose, "boxes dropped on loose: opened onto them up to 80, the rest stays boxed");
  s.pockets = [roundItem("a_9mm_fmj", 30, true), roundItem("a_9mm_fmj", 20, true), null, null];
  moveItem(st, `s:${s.id}:pocket:0`, `s:${s.id}:pocket:1`);
  check(!s.pockets[0] && s.pockets[1].dur === 50 && s.pockets[1].loose, "loose on loose: one stack of 50");
  check(!fitReason(roundItem("a_9mm_fmj", 50, true), "pocket") && !fitReason(roundItem("a_9mm_fmj", 50), "pack"), "loose and boxed rounds both go in a pocket or a pack");
}

section("Saves");
{
  const { st, s } = world(16);
  s.pockets[0] = supItems("f_beans", 3, { until: 123.5 })[0];
  s.pockets[1] = supItems("meds", 7)[0];
  const ld = loadFromString(saveToString(st));
  const t = ld.survivors.find((x) => x.id === s.id);
  check(t.pockets[0].key === "s_f_beans" && t.pockets[0].dur === 3 && t.pockets[0].until === 123.5 && t.pockets[1].dur === 7, "held supplies survive a save");
  tickHour(ld);
  check(t.pockets[1].dur === 7, "and an hour passing leaves them on the person");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
