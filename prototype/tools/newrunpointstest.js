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
//     taken off at Start, Random back / Build / Randomize all / the dice working with it;
//   - a follow-up the same day ("For choosing guns ... provide how much capacity and what ammo caliber it takes as well
//     as allow for gun customization ... All guns chosen start with a loaded magazine"): every gun in the pickers shows
//     its calibre and rounds, the gun in the hands takes parts that fit it (each adding its worth to the gun's points; a
//     bigger magazine more rounds too), kept through rebuilds, and a gun carried or in the vehicle's back comes loaded;
//   - a fix: at a normal start a custom background's car's back (to the hub with its car) is on the vehicle's back's
//     bill (the car pool first, then its payer), as the backgrounds editor says;
//   - parts on a carried gun and on a gun in the vehicle's back (kept as { key, mods }), loaded to a fitted magazine.
// Usage: node tools/newrunpointstest.js [-v]
import { createWorld } from "../src/sim/world.js";
import { GEAR, SKILLS } from "../src/sim/data.js";
import { CUSTOM_POINTS, itemPoints, suppliesPoints, skillCost, pricePerson, overBudget, overText, carPool, poolText, backgroundPoints, ownPoints, slotPoints, gunPoints, gunExtras, loosePoints, bgBacks, bgCarBack, pickPoints } from "../src/sim/custompoints.js";
import { carryList, clearStartGear, trunkKg, START_TRUNK, START_GEAR, gunInfo, gunWith, gunCap, sanitizeStartGear, sanitizeGunMods, sanitizeStartVehicle } from "../src/sim/startgear.js";
import { allCarried } from "../src/sim/inventory.js";
import { trunkBudget } from "../src/sim/randomkit.js";
import { newRunScreen, crewSnapshot, blankCrew, randomizeAllCrew, crewWithBackground } from "../src/ui/newgame.js";
import { startGearEditor, SG_ACTIONS, SG_CHANGE, startVehicleInfo, poolRow, loadDice } from "../src/ui/startgear.js";
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
  check(new RegExp(`Total ${N.total} points`).test(html) && /skill bumps 13\+/.test(html) && /of 80 each/.test(html) && /the car's back \d+ more, paid with the vehicle's back/.test(html), `the editor's line: "${(html.match(/Under Customize:[^<]*/) || [""])[0]}… Total ${N.total}"`);
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

section("Guns: calibre and capacity, parts, a loaded magazine");
{
  check(gunInfo("pistol").text === "9mm · 15 rds" && gunInfo("shotgun").text === "12 gauge · 6 rds" && /internal magazine/.test(gunInfo("shotgun").long) && !gunInfo("knife"), `the pickers' words: ${gunInfo("pistol").text}; ${gunInfo("shotgun").text}; ${gunInfo("m79").text}; a knife none`);
  const st = blankWorld(42);
  const ui = UI();
  ui.gearEdit = { i: 0, sel: null, msg: "" };
  const s = st.survivors[0];
  let html = startGearEditor(st, ui);
  check(/>Assault rifle · 5\.56 NATO · 30 rds · /.test(html) && />9mm pistol · 9mm · 15 rds · /.test(html) && /Takes 5\.56 NATO: 30 rounds/.test(html), "every gun in the pickers: its calibre and rounds (and a sentence on hover)");
  SG_CHANGE["sg-slot"](st, ui, { value: "ar", dataset: { slot: "weapon" } });
  const p0 = pricePerson(st, s).gear;
  html = startGearEditor(st, ui);
  check(/class="sgparts"/.test(html) && /data-action="sg-gunmod" data-gs="optic"/.test(html) && /Red dot sight · \+\d+ pts/.test(html) && !/>Pistol suppressor/.test(html), "the gun in the hands: a select a slot, only parts that fit, each with what it adds");
  check(SG_CHANGE["sg-gunmod"](st, ui, { value: "reddot", dataset: { gs: "optic" } }) === true && s.startGear.mods && s.startGear.mods.optic === "reddot", "a red dot fitted");
  const p1 = pricePerson(st, s).gear;
  check(p1 === slotPoints("weapon", "ar", { optic: "reddot" }) && p1 > p0 && gunPoints("ar", { optic: "reddot" }) - gunPoints("ar") >= itemPoints("reddot") - 1, `its worth added to the gun: ${p0} → ${p1}`);
  check(SG_CHANGE["sg-gunmod"](st, ui, { value: "pistolcan", dataset: { gs: "muzzle" } }) === false && /does not fit/.test(ui.gearEdit.msg), `a part that does not fit is refused ("${ui.gearEdit.msg}")`);
  SG_CHANGE["sg-gunmod"](st, ui, { value: "mag_stanag_40", dataset: { gs: "mag" } });
  const cap = gunCap(gunWith("ar", s.startGear.mods));
  check(cap === 40 && Object.values(gunExtras("ar", s.startGear.mods))[0] === 40 * START_GEAR.LOADS, `a 40-round magazine: 40 rds, its rounds ${40 * START_GEAR.LOADS} (a full load and two more)`);
  check(/5\.56 NATO · 40 rds/.test(startGearEditor(st, ui)), "the window says 40 rds now");
  const b = again(st);
  const g = b.survivors[0].gear.weapon;
  check(g.key === "ar" && g.mods && g.mods.optic && g.mods.optic.key === "reddot" && g.mods.mag && g.mods.mag.key === "mag_stanag_40", "rebuilt: the rifle has its red dot and 40-round magazine");
  const plain = again({ ...st, survivors: st.survivors.map((x, i) => (i ? x : { ...x, startGear: { ...x.startGear, mods: undefined } })) });
  check(b.bases[0].stock.a_556_fmj - plain.bases[0].stock.a_556_fmj === 10 * START_GEAR.LOADS, `and ${10 * START_GEAR.LOADS} more rounds in the hub's stock than with the 30-round one (${plain.bases[0].stock.a_556_fmj} → ${b.bases[0].stock.a_556_fmj})`);
  check(sanitizeGunMods("ar", { optic: "reddot", muzzle: "pistolcan", grip: "nonsense" }).muzzle === undefined && sanitizeStartGear({ slots: { weapon: "pistol" }, mods: { optic: "scope4x" } }).mods === undefined, "misfits dropped when made safe");
  SG_CHANGE["sg-gunmod"](st, ui, { value: "=", dataset: { gs: "mag" } });
  check(!("mag" in s.startGear.mods) && s.startGear.mods.optic === "reddot", "As it comes for one slot");
  check(SG_ACTIONS["sg-gunmods-clear"](st, ui) === true && !s.startGear.mods && pricePerson(st, s).gear === p0, "the As it comes button: stock again, the points back");
  SG_CHANGE["sg-gunmod"](st, ui, { value: "reddot", dataset: { gs: "optic" } });
  SG_CHANGE["sg-slot"](st, ui, { value: "pistol", dataset: { slot: "weapon" } });
  check(!s.startGear.mods, "another gun in the hands: as it comes");
  SG_CHANGE["sg-slot"](st, ui, { value: "ar", dataset: { slot: "weapon" } });
  SG_CHANGE["sg-gunmod"](st, ui, { value: "reddot", dataset: { gs: "optic" } });
  SG_ACTIONS["sg-rand-kit"](st, ui);
  check(!s.startGear.mods, "Random gear: guns as they come");
  // A factory part taken off (a gun that comes with one).
  const facGun = ["sniper", "huntrifle", "lmg", "dmr"].find((k) => GEAR[k] && Object.keys(gunWith(k).mods || {}).length);
  if (facGun) {
    const fac = Object.keys(gunWith(facGun).mods)[0];
    SG_CHANGE["sg-slot"](st, ui, { value: facGun, dataset: { slot: "weapon" } });
    const before = pricePerson(st, s).gear;
    check(SG_CHANGE["sg-gunmod"](st, ui, { value: "-", dataset: { gs: fac } }) === true && s.startGear.mods[fac] === "" && pricePerson(st, s).gear < before && !(again(st).survivors[0].gear.weapon.mods || {})[fac], `a factory part taken off (the ${GEAR[facGun].name}'s ${fac}): cheaper, gone on the gun`);
  } else check(false, "a gun with a factory part to take off");
  // Carried and in the back: loaded.
  const c = blankWorld(42);
  const uc = UI();
  uc.gearEdit = { i: 0, sel: null, msg: "" };
  SG_CHANGE["sg-slot"](c, uc, { value: "hikingpack", dataset: { slot: "backpack" } });
  add(c, uc, "pistol");
  check(pricePerson(c, c.survivors[0]).carried === loosePoints("pistol") && loosePoints("pistol") === itemPoints("pistol") + suppliesPoints({ a_9mm_fmj: 15 }), `a pistol carried: its price and a loaded magazine's (${loosePoints("pistol")})`);
  tadd(c, uc, "shotgun");
  const cb = again(c);
  const carried = allCarried(cb.survivors[0]).find((it) => it.key === "pistol");
  check(carried && carried.loaded && carried.loaded.n === 15 && carried.loaded.key === "a_9mm_fmj", `rebuilt: the carried pistol loaded (${JSON.stringify(carried && carried.loaded)})`);
  const sg = cb.bases[0].armory.find((it) => it.key === "shotgun");
  check(sg && sg.loaded && sg.loaded.n === 6 && sg.loaded.key === "a_12ga_buck", "normal: the shotgun from the back in the armory, its tube loaded (6)");
  const hc = blankWorld(42, { mode: "hardcore" });
  const uh = UI();
  uh.gearEdit = { i: 0, sel: null, msg: "" };
  hc.pointsMax = 400;
  tadd(hc, uh, "revolver");
  SG_CHANGE["sg-slot"](hc, uh, { value: "ar", dataset: { slot: "weapon" } });
  SG_CHANGE["sg-gunmod"](hc, uh, { value: "mag_stanag_40", dataset: { gs: "mag" } });
  const h2 = again(hc);
  const rv = h2.parties[0].cargo.gear.find((it) => it.key === "revolver");
  check(rv && rv.loaded && rv.loaded.n === 6 && rv.loaded.key === "a_357_fmj", "Hardcore: the revolver in the car's back loaded (6)");
  const hg = h2.survivors[0].gear.weapon;
  check(hg.key === "ar" && hg.mods.mag.key === "mag_stanag_40" && (h2.parties[0].supplies.a_556_fmj || 0) >= 40 * START_GEAR.LOADS, `Hardcore: the rifle in the hands with its 40-round magazine and its rounds (${h2.parties[0].supplies.a_556_fmj})`);
}

section("A custom background's car's back at a normal start: on the vehicle's back's bill");
{
  const lib = [{ ...presetToCustom("veteran", "c_5"), car: { odds: 1, type: "sedan", trunk: { fuel: 20, food: 10 }, items: ["crowbar", "pistol"] } }];
  setCustomLibrary(lib);
  const A0 = customLibrary().c_5;
  const mk = (mode, crew) => { const w = createWorld({ seed: 42, factionCount: 5, crewRoll: ROLL, mode, crew, customBackgrounds: lib }); w.pointsMax = 80; return w; };
  const blank = (mode) => mk(mode, blankCrew(createWorld({ seed: 42, factionCount: 5, crewRoll: ROLL, mode })));
  const st0 = blank("normal");
  const a = mk("normal", crewWithBackground(st0, st0.survivors[1].id, "c_5"));
  loadDice(a, a.survivors[1]); // main.js pointsLoad
  const st = mk("normal", crewSnapshot(a));
  const bgS = st.survivors[1], lead = st.survivors.find((s) => s.leader);
  const n = bgCarBack(A0);
  check(n === suppliesPoints({ fuel: 20, food: 10 }) + itemPoints("crowbar") + loosePoints("pistol") && backgroundPoints(A0, "normal").trunk === n, `the car's back priced: ${n} (a gun in it loaded)`);
  check(bgBacks(st).length === 1 && bgBacks(st)[0].s === bgS && bgBacks(st)[0].n === n, "on the bill: their background's car's back");
  let K = carPool(st);
  check(K.owner === lead && K.cost === n && K.extra === n && pricePerson(st, lead).vehicle === n && pricePerson(st, bgS).vehicle === 0, `nothing picked for the back: its payer (the leader) pays the ${n}`);
  check(/background cars' backs/.test(pricePerson(st, lead).lines.join(" · ")), "the leader's bill says so");
  const ui = UI();
  ui.gearEdit = { i: 0, sel: null, msg: "" };
  check(/Also on this bill, to the hub with their cars: [^<]* background car's back \d+ pts/.test(startGearEditor(st, ui)), "the gear window's vehicle's back shows it");
  // Paid by someone else: it moves with the back.
  SG_CHANGE["sg-trunk-sup"](st, ui, { value: "10", dataset: { k: "water" } });
  const other = st.survivors.find((s) => !s.leader && s !== bgS);
  SG_CHANGE["sg-trunk-owner"](st, ui, { value: String(other.id) });
  K = carPool(st);
  check(K.owner === other && K.cost === n + suppliesPoints({ water: 10 }) && pricePerson(st, lead).vehicle === 0, "Paid by: the background car's back goes with the rest of the back");
  // The car pool first.
  pool(st, lead);
  K = carPool(st);
  check(K.used === Math.min(K.total, K.cost) && pricePerson(st, other).vehicle === K.cost - K.used, `the car pool pays it first (${K.used} of ${K.cost})`);
  // Random back: what the picks may cost leaves room for it.
  const tb = trunkBudget(st, other);
  check(tb === Math.max(0, Math.max(0, 80 - ownPoints(st, other)) + K.offers.filter((o) => o.s !== other).reduce((x, o) => x + o.n, 0) - n), `Random back's budget less the background car's back (${tb})`);
  // Over: the refusal names it.
  for (const k of SKILLS) other.skills[k] = 15;
  pool(st, lead, false);
  check(overBudget(st).some((x) => x.s === other) && /with the background cars' backs, \d+/.test(overText(st)), `Start refused, the back named with it: "${overText(st)}"`);
  for (const k of SKILLS) other.skills[k] = 0;
  // Built: it goes to the hub (it used to be dropped under Customize), the gun in it loaded.
  const plain = mk("normal", crewSnapshot(st0));
  const b = mk("normal", crewSnapshot(st));
  check(b.bases[0].stock.fuel === plain.bases[0].stock.fuel + 20 && b.bases[0].stock.food >= plain.bases[0].stock.food + 10, "built: its fuel and food in the hub's stores");
  const pz = b.bases[0].armory.find((it) => it.key === "pistol" && it.loaded);
  check(b.bases[0].armory.some((it) => it.key === "crowbar") && !!pz, "and its crowbar and pistol in the armory");
  // Hardcore: the car's back is the dice's back (As rolled, priced as picks): nothing extra on the bill.
  const h0 = blank("hardcore");
  const ha = mk("hardcore", crewWithBackground(h0, h0.survivors[1].id, "c_5"));
  loadDice(ha, ha.survivors[1]);
  const h = mk("hardcore", crewSnapshot(ha));
  check(!bgBacks(h).length && carPool(h).extra === 0, "Hardcore: nothing extra (the car's back loads with As rolled)");
  // The editor says where it goes.
  const eui = { started: false, ironman: false };
  BG_ACTIONS["bg-open"](st, eui);
  eui.bgEditor.sel = "c_5";
  check(/paid with the vehicle's back/.test(backgroundEditor(st, eui)) && /goes to the hub with the car, paid by whoever pays for the vehicle's back/.test(backgroundEditor(st, eui)), "the editor: the car's back is paid with the vehicle's back");
  setCustomLibrary([]);
}

section("Parts on a carried gun and on a gun in the vehicle's back");
{
  const st = blankWorld(42);
  const ui = UI();
  ui.gearEdit = { i: 0, sel: null, msg: "" };
  const s = st.survivors[0];
  SG_CHANGE["sg-slot"](st, ui, { value: "hikingpack", dataset: { slot: "backpack" } });
  add(st, ui, "pistol");
  const at = carryList(s.startGear).find((x) => x.key === "pistol");
  check(!/data-t="carry"/.test(startGearEditor(st, ui)), "no parts box until the gun is picked up");
  SG_ACTIONS["sg-cell"](st, ui, { w: at.where, i: at.i });
  check(/Parts for the picked 9mm pistol/.test(startGearEditor(st, ui)) && /data-action="sg-gunmod" data-gs="optic" data-t="carry"/.test(startGearEditor(st, ui)), "picked up: its parts box");
  const p0 = pricePerson(st, s).carried;
  check(SG_CHANGE["sg-gunmod"](st, ui, { value: "reddot", dataset: { gs: "optic", t: "carry" } }) === true, "a red dot on the carried pistol");
  SG_CHANGE["sg-gunmod"](st, ui, { value: "mag_glock_33", dataset: { gs: "mag", t: "carry" } });
  let e = s.startGear.carry[at.where][at.i];
  check(e && e.key === "pistol" && e.mods.optic === "reddot" && e.mods.mag === "mag_glock_33", `kept as { key, mods } (${JSON.stringify(e)})`);
  const p1 = pricePerson(st, s).carried;
  check(p1 === pickPoints(e) && p1 === gunPoints("pistol", e.mods) + suppliesPoints({ a_9mm_fmj: 33 }) && p1 > p0, `priced: the gun as fitted and its 33-round load (${p0} → ${p1})`);
  check(SG_CHANGE["sg-gunmod"](st, ui, { value: "riflecan", dataset: { gs: "muzzle", t: "carry" } }) === false, "a part that does not fit is refused");
  // Moved to another spot: the parts go with it.
  const free = s.startGear.carry.pack.findIndex((x, j) => !x && j !== at.i);
  const to = free >= 0 ? free : s.startGear.carry.pack.length;
  SG_ACTIONS["sg-cell"](st, ui, { w: "pack", i: to });
  e = s.startGear.carry.pack[to];
  check(e && e.mods && e.mods.optic === "reddot", "moved to another pack slot: its parts with it");
  const b = again(st);
  const pz = allCarried(b.survivors[0]).find((it) => it.key === "pistol");
  check(pz && pz.mods && pz.mods.optic.key === "reddot" && pz.mods.mag.key === "mag_glock_33" && pz.loaded && pz.loaded.n === 33, `rebuilt: the carried pistol fitted and loaded to its magazine (${pz && pz.loaded && pz.loaded.n})`);
  ui.gearEdit.sel = { where: "pack", i: to };
  check(SG_ACTIONS["sg-gunmods-clear"](st, ui, { t: "carry" }) === true && s.startGear.carry.pack[to] === "pistol" && pricePerson(st, s).carried === p0, "As it comes: the plain key again, the points back");
  // The vehicle's back.
  ui.gearEdit.sel = null;
  tadd(st, ui, "ar");
  const o = st.survivors.find((x) => x.startVehicle);
  const j = o.startVehicle.items.indexOf("ar");
  check(SG_ACTIONS["sg-trunk-pick"](st, ui, { i: j }) === false && /Parts for the Assault rifle in the back/.test(startGearEditor(st, ui)) && /data-t="trunk" data-j="0"/.test(startGearEditor(st, ui)), "the ⚙ on a gun in the back: its parts box");
  const v0 = pricePerson(st, o).vehicle;
  check(SG_CHANGE["sg-gunmod"](st, ui, { value: "mag_stanag_40", dataset: { gs: "mag", t: "trunk", j: String(j) } }) === true, "a 40-round magazine on the rifle in the back");
  e = o.startVehicle.items[j];
  check(e.key === "ar" && e.mods.mag === "mag_stanag_40" && pricePerson(st, o).vehicle === v0 - loosePoints("ar") + pickPoints(e), `kept and priced (${v0} → ${pricePerson(st, o).vehicle})`);
  const b2 = again(st);
  const ar = b2.bases[0].armory.find((it) => it.key === "ar");
  check(ar && ar.mods && ar.mods.mag.key === "mag_stanag_40" && ar.loaded && ar.loaded.n === 40, "normal: in the armory fitted, loaded with 40");
  check(SG_ACTIONS["sg-gunmods-clear"](st, ui, { t: "trunk", j: String(j) }) === true && o.startVehicle.items[j] === "ar", "As it comes in the back too");
  const hc = blankWorld(42, { mode: "hardcore" });
  const uh = UI();
  uh.gearEdit = { i: 0, sel: null, msg: "" };
  tadd(hc, uh, "pistol");
  SG_CHANGE["sg-gunmod"](hc, uh, { value: "mag_glock_17", dataset: { gs: "mag", t: "trunk", j: "0" } });
  const hp = again(hc).parties[0].cargo.gear.find((it) => it.key === "pistol");
  check(hp && hp.mods && hp.mods.mag.key === "mag_glock_17" && hp.loaded.n === 17, "Hardcore: the pistol in the car's back fitted, loaded with 17");
  // The plain-key form still reads; a misfit made safe goes back to it.
  check(sanitizeStartGear({ slots: {}, carry: { pocket: ["pistol"] } }).carry.pocket[0] === "pistol" && JSON.stringify(sanitizeStartVehicle({ items: ["ar", { key: "ar", mods: { muzzle: "pistolcan" } }, { key: "pistol", mods: { optic: "reddot" } }] }).items) === JSON.stringify(["ar", "ar", { key: "pistol", mods: { optic: "reddot" } }]), "plain keys read as ever; a gun with no parts that fit is a plain key");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
