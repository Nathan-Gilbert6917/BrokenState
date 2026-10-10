// The new-run screen's points, three asks of 2026-10-09 (sim/custompoints.js, ui/startgear.js, ui/backgrounds.js,
// ui/newgame.js, sim/randomkit.js):
//   - "allow to select x amount of an item to add as a stack": the gear window's × boxes put N of a thing in at once
//     (what they carry: each in a spot of its own, at most what fits and what their points pay for; the vehicle's back:
//     at most its 16 things, its room and what its payer and the car pool can pay), priced N times;
//   - "When creating a custom background show a total amount of points it provides": the backgrounds editor's line adds
//     up its skill bumps, traits, kit, supplies and car (normal start) into a Total, live, against Points each;
//   - "donate the remaining points ... to a pool of points ... towards the items set in the back of the car": a crew
//     card's "Give leftover to the car pool", the back paid from the pool first, only what it needs taken (shared by
//     what each gives), a giver who spends more giving less (never over), the payer over when the back costs more
//     than the pool and they can pay (Start refused, the back named), kept through every rebuild and both modes and
//     taken off at Start, Random back / Build / Randomize all / the dice working with it.
// Usage: node tools/newrunpointstest.js [-v]
import { createWorld } from "../src/sim/world.js";
import { GEAR, SKILLS } from "../src/sim/data.js";
import { CUSTOM_POINTS, itemPoints, suppliesPoints, skillCost, pricePerson, overBudget, overText, carPool, poolText, backgroundPoints, ownPoints } from "../src/sim/custompoints.js";
import { carryList, clearStartGear, trunkKg, START_TRUNK } from "../src/sim/startgear.js";
import { allCarried } from "../src/sim/inventory.js";
import { trunkBudget } from "../src/sim/randomkit.js";
import { newRunScreen, crewSnapshot, blankCrew, randomizeAllCrew } from "../src/ui/newgame.js";
import { startGearEditor, SG_ACTIONS, SG_CHANGE, startVehicleInfo, poolRow } from "../src/ui/startgear.js";
import { setCustomLibrary, customLibrary, presetToCustom, backgroundEditor, BG_ACTIONS, BG_CHANGE } from "../src/ui/backgrounds.js";
import { blankBackground } from "../src/sim/custombg.js";

let pass = 0, fail = 0;
const VERBOSE = process.argv.includes("-v");
const check = (ok, msg) => { if (ok) { pass++; if (VERBOSE) console.log(`  ok ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
const ROLL = 9091;
const world = (seed, extra = {}) => { const st = createWorld({ seed, factionCount: 5, crewRoll: ROLL, ...extra }); st.pointsMax = extra.max ?? CUSTOM_POINTS.DEF; return st; };
const blankWorld = (seed, extra = {}) => world(seed, { ...extra, crew: blankCrew(createWorld({ seed, factionCount: 5, crewRoll: ROLL, ...extra })) });
const again = (st, extra = {}) => { const w = createWorld({ seed: st.seed, factionCount: 5, crewRoll: ROLL, mode: st.mode, ...extra, crew: crewSnapshot(st) }); w.pointsMax = st.pointsMax; return w; };
const UI = () => ({ started: false, freeEdit: true, ironman: false, worldSize: "normal", factionCount: 5, nrMsg: "" });
const count = (s, key) => carryList(s.startGear).filter((x) => x.key === key).length;
const qty = (st, ui, k, n) => SG_CHANGE["sg-qty"](st, ui, { value: String(n), dataset: { k } });
const add = (st, ui, key) => SG_CHANGE["sg-item-add"](st, ui, { value: key, dataset: {} });
const tadd = (st, ui, key) => SG_CHANGE["sg-trunk-add"](st, ui, { value: key, dataset: {} });
const pool = (st, s, on = true) => SG_CHANGE["sg-pool"](st, UI(), { checked: on, dataset: { id: String(s.id) } });
const AMMO = Object.keys(GEAR).find((k) => GEAR[k].count && GEAR[k].small && GEAR[k].cat === "ammo" && !GEAR[k].reload);

section("N of a thing at once: what they carry");
{
  const st = blankWorld(42);
  const ui = UI();
  ui.gearEdit = { i: 0, sel: null, msg: "" };
  const s = st.survivors[0];
  // Pockets only: four spots.
  check(qty(st, ui, "qty", 10) === false && ui.gearEdit.qty === 10, "the × box keeps how many (no rebuild)");
  check(add(st, ui, "bandagekit") === true && count(s, "bandagekit") === 4 && /4 Bandage and splint kit added of the 10 asked/.test(ui.gearEdit.msg) && /no room/.test(ui.gearEdit.msg), `10 asked, pockets only: 4 put in, it says why ("${ui.gearEdit.msg}")`);
  check(pricePerson(st, s).carried === 4 * itemPoints("bandagekit"), "priced four times");
  // A bag: then N go in at once, each in a spot of its own.
  SG_CHANGE["sg-slot"](st, ui, { value: "hikingpack", dataset: { slot: "backpack" } });
  SG_ACTIONS["sg-carry-clear"](st, ui);
  qty(st, ui, "qty", 6);
  check(add(st, ui, AMMO) === true && count(s, AMMO) === 6 && !ui.gearEdit.msg, `6 boxes of ${GEAR[AMMO].name} at once, no message`);
  check(pricePerson(st, s).carried === 6 * itemPoints(AMMO), `the points are its price six times (${6 * itemPoints(AMMO)})`);
  const b = again(st);
  const boxes = allCarried(b.survivors[0]).filter((it) => it.key === AMMO);
  check(boxes.length === 6 && boxes.every((it) => it.dur === GEAR[AMMO].dur), `rebuilt: six full boxes on them (${boxes.length}, ${GEAR[AMMO].dur} rounds each: a box is the stack the inventory has)`);
  // The spot picked takes the first, the rest go where they fit.
  ui.gearEdit.sel = { where: "pack", i: 9 };
  qty(st, ui, "qty", 2);
  add(st, ui, "flashlight");
  check(st.survivors[0].startGear.carry.pack[9] === "flashlight" && count(st.survivors[0], "flashlight") === 2, "the spot picked takes the first, the rest where they fit");
  // Points: no more than their points left pay for (at least one, as before).
  const p = blankWorld(42, { max: 10 });
  const u2 = UI();
  u2.gearEdit = { i: 0, sel: null, msg: "" };
  SG_CHANGE["sg-slot"](p, u2, { value: "hikingpack", dataset: { slot: "backpack" } });
  const left = pricePerson(p, p.survivors[0]).left, each = itemPoints(AMMO);
  qty(p, u2, "qty", 9);
  add(p, u2, AMMO);
  check(count(p.survivors[0], AMMO) === Math.max(1, Math.floor(left / each)) && pricePerson(p, p.survivors[0]).over === 0 && /points left pay for/.test(u2.gearEdit.msg), `points: ${left} left at ${each} each, ${count(p.survivors[0], AMMO)} put in, nobody over ("${u2.gearEdit.msg}")`);
  qty(p, u2, "qty", 3);
  add(p, u2, AMMO);
  check(count(p.survivors[0], AMMO) === Math.max(1, Math.floor(left / each)) + 1, "out of points: one still goes in (as a single thing always did; Start refuses it)");
  // The window shows the boxes.
  const html = startGearEditor(st, ui);
  check(/data-action="sg-qty" data-k="qty"/.test(html) && /data-action="sg-qty" data-k="tqty"/.test(html), "the window: a × box by Add a thing and by Put a thing in the back");
  check(qty(st, ui, "qty", 0) === false && ui.gearEdit.qty === 1 && (qty(st, ui, "qty", 500), ui.gearEdit.qty === 99), "the box held to 1–99");
}

section("N of a thing at once: the vehicle's back");
{
  const st = blankWorld(42);
  const ui = UI();
  ui.gearEdit = { i: 0, sel: null, msg: "" };
  qty(st, ui, "tqty", 5);
  check(tadd(st, ui, "bandagekit") === true, "five in the back");
  const lead = st.survivors.find((s) => s.leader);
  check(lead.startVehicle.items.filter((k) => k === "bandagekit").length === 5 && pricePerson(st, lead).vehicle === 5 * itemPoints("bandagekit"), "five things of their own, priced five times");
  qty(st, ui, "tqty", 50);
  tadd(st, ui, "flashlight");
  check(lead.startVehicle.items.length === START_TRUNK.ITEMS && /at most 16/.test(ui.gearEdit.msg), `held to the back's ${START_TRUNK.ITEMS} things ("${ui.gearEdit.msg}")`);
  // Room: heavy things up to the room there is.
  const hc = blankWorld(42, { mode: "hardcore" });
  const uh = UI();
  uh.gearEdit = { i: 0, sel: null, msg: "" };
  hc.pointsMax = 400;
  qty(hc, uh, "tqty", 16);
  tadd(hc, uh, "sandbags");
  const o = hc.survivors.find((s) => s.startVehicle);
  check(trunkKg(o.startVehicle) <= startVehicleInfo(hc).room + 1e-9 && (o.startVehicle.items.length === 16 || /no room/.test(uh.gearEdit.msg)), `Hardcore: up to the room (${trunkKg(o.startVehicle)} / ${startVehicleInfo(hc).room} kg)`);
  // Points: what the payer and the car pool pay for.
  const p = blankWorld(42, { max: 20 });
  const up = UI();
  up.gearEdit = { i: 0, sel: null, msg: "" };
  const payer = p.survivors.find((s) => s.leader);
  const budget = trunkBudget(p, payer), each = itemPoints("ar");
  qty(p, up, "tqty", 10);
  tadd(p, up, "ar");
  check(payer.startVehicle.items.length === Math.max(1, Math.floor(budget / each)) && /pay for/.test(up.gearEdit.msg), `the back's points: ${budget} at ${each} each, ${payer.startVehicle.items.length} put in ("${up.gearEdit.msg}")`);
}

section("A custom background's total");
{
  const d = { ...blankBackground("c_9"), name: "Test", skills: { medicine: 5, shooting: 8 }, traits: ["tough", "loud"], traitTier: { tough: 2 }, gear: { weapon: "pistol", backpack: "hikingpack" }, items: ["bandagekit", "flashlight"], supplies: { food: 30, meds: 10 }, car: { odds: 1, type: "suv", trunk: { fuel: 20 }, items: ["crowbar"] } };
  const N = backgroundPoints(d, "normal"), H = backgroundPoints(d, "hardcore");
  check(N.skills === skillCost(5) + skillCost(8) && N.skills === 13, `skill bumps priced from 0: +5 and +8 come to ${N.skills}`);
  check(N.kit === itemPoints("pistol") + itemPoints("hikingpack") + itemPoints("bandagekit") + itemPoints("flashlight") && N.supplies === suppliesPoints({ food: 30, meds: 10 }), "kit and supplies");
  check(N.car === CUSTOM_POINTS.VEHICLE.suv && H.car === 0 && N.total === N.skills + N.traits + N.kit + N.supplies + N.car && H.total === N.total - N.car, `the car: ${N.car} at a normal start, free in Hardcore (totals ${N.total} / ${H.total})`);
  check(N.trunk === suppliesPoints({ fuel: 20 }) + itemPoints("crowbar"), "the car's back counted apart");
  setCustomLibrary([d]);
  const st = world(5);
  const ui = { started: false, ironman: false };
  BG_ACTIONS["bg-open"](st, ui);
  ui.bgEditor.sel = "c_9";
  const html = backgroundEditor(st, ui);
  check(new RegExp(`Total ${N.total} points`).test(html) && /skill bumps 13\+/.test(html) && /of 80 each/.test(html) && /the car's back \d+ more, not in the total/.test(html), `the editor's line: "${(html.match(/Under Customize:[^<]*/) || [""])[0]}… Total ${N.total}"`);
  BG_CHANGE["bg-skill"](st, ui, { value: "10", dataset: { k: "medicine" } });
  const N2 = backgroundPoints(customLibrary().c_9, "normal");
  check(N2.total === N.total + skillCost(10) - skillCost(5) && new RegExp(`Total ${N2.total} points`).test(backgroundEditor(st, ui)), `live: Medicine +10 makes it ${N2.total}`);
  const hcst = world(5, { mode: "hardcore" });
  check(new RegExp(`Total ${H.total + skillCost(10) - skillCost(5)} points`).test(backgroundEditor(hcst, ui)) && /the car free \(Hardcore\)/.test(backgroundEditor(hcst, ui)), "Hardcore: the car free, the total without it");
  st.pointsMax = 30;
  check(/class="danger">Total/.test(backgroundEditor(st, ui)), "more than Points each: the total in red");
  setCustomLibrary([presetToCustom("veteran", "c_1")]);
  ui.bgEditor.sel = "c_1";
  check(/Total \d+ points/.test(backgroundEditor(world(5), ui)), "a preset made custom shows its total");
  setCustomLibrary([]);
}

section("The car pool");
{
  const st = blankWorld(42);
  const ui = UI();
  ui.gearEdit = { i: 0, sel: null, msg: "" };
  const [a, b, c] = st.survivors.filter((s) => !s.leader);
  const lead = st.survivors.find((s) => s.leader);
  // The leader pays for 60 food and 20 meds (47 points) and has spent 60 on skills.
  SG_CHANGE["sg-trunk-sup"](st, ui, { value: "60", dataset: { k: "food" } });
  SG_CHANGE["sg-trunk-sup"](st, ui, { value: "20", dataset: { k: "meds" } });
  lead.skills.shooting = 15; lead.skills.medicine = 15; lead.skills.scouting = 10; lead.skills.farming = 10; // 20 + 20 + 10 + 10 = 60
  const cost = suppliesPoints({ food: 60, meds: 20 });
  check(pricePerson(st, lead).vehicle === cost && pricePerson(st, lead).over === cost - 20, `no pool: the leader pays all ${cost} and is over by ${cost - 20}`);
  check(/The vehicle's back costs/.test(overText(st)), `Start's refusal names the back: "${overText(st)}"`);
  // Two give their leftover: a has spent 50, b 70.
  a.skills.farming = 15; a.skills.scouting = 15; a.skills.medicine = 10; // 50
  b.skills.shooting = 20; b.skills.farming = 15; b.skills.scouting = 15; // 35 + 20 + 20 = 75
  check(pool(st, a) === false && pool(st, b) === false && a.carPool && b.carPool, "ticking: no rebuild");
  let K = carPool(st);
  check(K.owner === lead && K.cost === cost && K.offers.length === 2 && K.offers[0].n === 30 && K.offers[1].n === 5 && K.total === 35, `offers: their points left (${K.offers.map((o) => o.n).join(", ")})`);
  check(K.used === Math.min(35, cost) && K.offers.reduce((x, o) => x + o.share, 0) === K.used && K.offers.every((o) => o.share <= o.n), `the back takes ${K.used}, shared ${K.offers.map((o) => o.share).join(" + ")}`);
  check(poolText(K) === `Car pool: 35 points from ${a.name.split(" ")[0]} 30, ${b.name.split(" ")[0]} 5`, `in words: "${poolText(K)}"`);
  check(pricePerson(st, lead).vehicle === cost - K.used && pricePerson(st, lead).poolPaid === K.used && pricePerson(st, lead).over === 0, `the leader pays ${cost - K.used} (over 0)`);
  check([a, b].every((x) => pricePerson(st, x).over === 0 && pricePerson(st, x).left === 0) && !overBudget(st).length && !overText(st), "the givers spend all they have, nobody over, Start allowed");
  // Not all needed: the rest stays theirs, shared by what each gave.
  SG_CHANGE["sg-trunk-sup"](st, ui, { value: "20", dataset: { k: "food" } });
  const cost2 = suppliesPoints({ food: 20, meds: 20 });
  K = carPool(st);
  check(K.used === Math.min(35, cost2) && pricePerson(st, lead).vehicle === Math.max(0, cost2 - 35) && pricePerson(st, a).left + pricePerson(st, b).left === 35 - K.used, `a cheaper back (${cost2}): ${K.used} taken, ${35 - K.used} still theirs (${pricePerson(st, a).left} + ${pricePerson(st, b).left})`);
  check(pricePerson(st, a).pool >= pricePerson(st, b).pool, "shared by what each gives");
  SG_CHANGE["sg-trunk-sup"](st, ui, { value: "60", dataset: { k: "food" } });
  // A giver spends more: what they give shrinks, they are never over; the payer pays more.
  a.skills.shooting = 10; // 10 more: a gives 20
  K = carPool(st);
  check(K.offers[0].n === 20 && pricePerson(st, a).over === 0 && pricePerson(st, lead).vehicle === cost - 25, `a spends 10 more: gives 20, not over; the leader pays ${pricePerson(st, lead).vehicle}`);
  a.skills.shooting = 20; // past the max on their own: over by what they spent, giving nothing
  check(carPool(st).offers[0].n === 0 && pricePerson(st, a).over === ownPoints(st, a) - 80 && pricePerson(st, a).pool === 0, "a giver past the max on their own: gives nothing, over by their own spending only");
  check(overBudget(st).some((x) => x.s === lead) && /car pool \(5\)/.test(overText(st)), `the payer over again: "${overText(st)}"`);
  a.skills.shooting = 0;
  // The payer gives nothing; Paid by a giver: their offer drops out.
  pool(st, lead);
  check(!carPool(st).offers.some((o) => o.s === lead) && /Pays for the vehicle's back/.test(poolRow(st, lead)), "the payer's tick does nothing while they pay (the card says they pay the back)");
  SG_CHANGE["sg-trunk-owner"](st, ui, { value: String(b.id) });
  K = carPool(st);
  check(K.owner === b && !K.offers.some((o) => o.s === b) && K.offers.some((o) => o.s === lead) && K.offers.some((o) => o.s === a), "Paid by a giver: they pay, the leader's tick counts now");
  SG_CHANGE["sg-trunk-owner"](st, ui, { value: String(lead.id) });
  // The screen.
  const html = newRunScreen(st, UI());
  check((html.match(/data-action="sg-pool"/g) || []).length === 5 && /Give leftover to the car pool/.test(html), "every card but the payer's: Give leftover to the car pool");
  check(/all \d+ used|of \d+ used/.test(poolRow(st, a)) && !/checked/.test(poolRow(st, c)), `a giver's card says what is used ("${poolRow(st, a).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}")`);
  const gw = startGearEditor(st, ui);
  check(/Car pool: \d+ points from/.test(gw) && /the back takes \d+ of it/.test(gw), "the gear window's vehicle's back shows the pool");
  check(pool(st, c) === false && SG_CHANGE["sg-pool"](st, { ...UI(), ironman: true, freeEdit: false }, { checked: false, dataset: { id: String(c.id) } }) === false && c.carPool, "Ironman / Customize off: the tick refused");
  pool(st, c, false);
  // Kept through every rebuild, both modes; off at Start.
  const r = again(st);
  const ids = (w) => w.survivors.filter((s) => s.carPool).map((s) => s.name).sort().join();
  check(ids(r) === ids(st) && carPool(r).used === carPool(st).used && carPool(r).total === carPool(st).total, `a rebuild keeps the ticks and the pool (${ids(r)})`);
  const h = again(st, { mode: "hardcore" });
  h.pointsMax = st.pointsMax;
  check(h.survivors.filter((s) => s.carPool).length === h.survivors.filter((s, i) => st.survivors[i] && st.survivors[i].carPool).length, "into Hardcore: the ticks go with them");
  const n = again(again(r, { mode: "hardcore" }), { mode: "normal" });
  check(ids(n) === ids(st), "and back to Normal");
  clearStartGear(r);
  check(r.survivors.every((s) => !s.carPool), "Start takes the ticks off");
}

section("The car pool in Hardcore, and the dice");
{
  const hc = blankWorld(42, { mode: "hardcore" });
  const ui = UI();
  ui.gearEdit = { i: 0, sel: null, msg: "" };
  SG_ACTIONS["sg-trunk-dice"](hc, ui);
  const o = hc.survivors.find((s) => s.startVehicle);
  const others = hc.survivors.filter((s) => s !== o);
  const cost = pricePerson(hc, o).vehicleCost;
  others.forEach((s) => pool(hc, s));
  const K = carPool(hc);
  check(cost > 0 && K.used === Math.min(cost, K.total) && pricePerson(hc, o).vehicle === cost - K.used, `Hardcore: the car's back (${cost}) paid by the pool first (${K.used}), the owner the rest`);
  const h2 = again(hc);
  h2.pointsMax = hc.pointsMax;
  check(h2.hardcore.start.carOwner === h2.survivors[hc.survivors.indexOf(o)].id && carPool(h2).used === K.used, "rebuilt: the same owner and pool");
  // Random back for a payer with nothing left: the pool pays for it.
  const st = blankWorld(42);
  const u = UI();
  u.gearEdit = { i: 0, sel: null, msg: "" };
  const lead = st.survivors.find((s) => s.leader);
  for (const k of SKILLS.slice(0, 4)) lead.skills[k] = 20; // 140: past the max
  for (const k of SKILLS) lead.skills[k] = 0;
  lead.skills.shooting = 20; lead.skills.medicine = 15; lead.skills.farming = 15; lead.skills.scouting = 5; // 35 + 20 + 20 + 5 = 80
  check(trunkBudget(st, lead) === 0, "the payer with nothing left: nothing for a random back");
  st.survivors.filter((s) => s !== lead).forEach((s) => pool(st, s));
  const tb = trunkBudget(st, lead);
  check(tb === 80 * (st.survivors.length - 1), `with the pool: ${tb} (everyone else's 80)`);
  let ok = true, any = false;
  for (let k = 0; k < 6; k++) {
    SG_ACTIONS["sg-trunk-rand"](st, u);
    const V = lead.startVehicle;
    if (V && (V.items.length || Object.keys(V.supplies).length)) any = true;
    if (overBudget(st).length) ok = false;
  }
  check(any && ok, "Random back: filled from the pool, nobody over (six draws)");
  // Build on a giver: within what the back leaves them; nobody over, the back still paid.
  let okB = true;
  for (let k = 0; k < 6; k++) {
    for (const s of st.survivors.filter((x) => x !== lead)) SG_ACTIONS["sg-build"](st, u, { i: st.survivors.indexOf(s) });
    if (overBudget(st).length) okB = false;
  }
  check(okB && pricePerson(st, lead).over === 0, `Build on every giver (six times): nobody over, the back paid (${carPool(st).used} of ${carPool(st).cost} from the pool)`);
  // Randomize all under Customize keeps the ticks.
  let rebuilt = null;
  const flags = st.survivors.map((s) => !!s.carPool).join();
  randomizeAllCrew(st, { ...UI(), crewRoll: ROLL }, (crew, crewRoll) => { rebuilt = world(42, { crew, crewRoll }); return rebuilt; });
  check(rebuilt && rebuilt.survivors.map((s) => !!s.carPool).join() === flags && !overBudget(rebuilt).length, "Randomize all: the ticks kept, nobody over");
  // The dice may go over (as ever): a giver loaded from the dice gives what is left, if anything.
  SG_ACTIONS["sg-dice"](st, u, { i: st.survivors.indexOf(st.survivors.find((s) => s !== lead)) });
  const g = st.survivors.find((s) => s !== lead);
  check(pricePerson(st, g).offer === Math.max(0, 80 - ownPoints(st, g)), "Start from the dice on a giver: they give what is left of their max");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
