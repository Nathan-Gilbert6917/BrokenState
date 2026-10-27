// The new-run screen's points, three asks of 2026-10-09 (sim/custompoints.js, ui/startgear.js, ui/backgrounds.js,
// ui/newgame.js, sim/randomkit.js):
//   - "allow to select x amount of an item to add as a stack": the gear window's × boxes put N of a thing in at once
//     (what they carry: each in a spot of its own, at most what fits and what their points pay for; the vehicle's back:
//     at most its 16 things, its room and what its own point limit leaves), priced N times;
//   - "When creating a custom background show a total amount of points it provides": the backgrounds editor's line adds
//     up its skill bumps, traits, kit, supplies and car (normal start) into a Total, live, against Points each;
//   - "donate the remaining points ... to a pool of points ... towards the items set in the back of the car": retired
//     2026-10-24 (user request: each starting vehicle has its own point limit, sim/startfleet.js, tools/startfleettest.js):
//     the backs are on nobody's points, no car pool on the cards, Random back / Build / Randomize all / the dice with it;
//     Randomize everything (every build and every vehicle's back to its limit in one click, nobody over, the backs in
//     their room, Normal and Hardcore);
//   - a follow-up the same day ("For choosing guns ... provide how much capacity and what ammo caliber it takes as well
//     as allow for gun customization ... All guns chosen start with a loaded magazine"): every gun in the pickers shows
//     its calibre and rounds, the gun in the hands takes parts that fit it (each adding its worth to the gun's points; a
//     bigger magazine more rounds too), kept through rebuilds, and a gun carried or in the vehicle's back comes loaded;
//   - a fix: at a normal start a custom background's car's back (to the hub with its car) is paid for (since 2026-10-24
//     on the colonist with the background: part of the background), as the backgrounds editor says;
//   - parts on a carried gun and on a gun in the vehicle's back (kept as { key, mods }), loaded to a fitted magazine;
//   - The dice's gear (and Start from the dice, Hardcore's As rolled back) keeps the parts the dice put on a gun;
//   - the background's Total follows every key press (only its line redrawn, so the box keeps its focus).
// Usage: node tools/newrunpointstest.js [-v]
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { readFileSync } from "node:fs";
import { createWorld } from "../src/sim/world.js";
import { GEAR, SKILLS } from "../src/sim/data.js";
import { CUSTOM_POINTS, itemPoints, suppliesPoints, skillCost, pricePerson, overBudget, overText, backgroundPoints, ownPoints, slotPoints, gunPoints, gunExtras, loosePoints, bgBacks, bgCarBack, pickPoints, vehiclePoints } from "../src/sim/custompoints.js";
import { carryList, clearStartGear, trunkKg, START_TRUNK, START_GEAR, gunInfo, gunWith, gunCap, sanitizeStartGear, sanitizeGunMods, sanitizeStartVehicle, noteDiceKit } from "../src/sim/startgear.js";
import { allCarried } from "../src/sim/inventory.js";
import { fleetText, fleetRoom } from "../src/sim/startfleet.js"; // the starting vehicles: a point limit each (2026-10-24)
import { newRunScreen, crewSnapshot, blankCrew, randomizeAllCrew, randomizeEverything, crewWithBackground } from "../src/ui/newgame.js";
import { startGearEditor, fleetEditor, SG_ACTIONS, SG_CHANGE, startVehicleInfo, loadDice } from "../src/ui/startgear.js";
import { setCustomLibrary, customLibrary, presetToCustom, backgroundEditor, BG_ACTIONS, BG_CHANGE, BG_INPUT } from "../src/ui/backgrounds.js";
import { blankBackground } from "../src/sim/custombg.js";

let pass = 0, fail = 0;
const VERBOSE = process.argv.includes("-v");
const check = (ok, msg) => { if (ok) { pass++; if (VERBOSE) console.log(`  ok ${msg}`); } else { fail++; console.log(`FAIL ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
const ROLL = 9091;
const MAX = 80; // Points each in these worlds (fixed: the default went 80 → 85 with the Melee skill)
const world = (seed, extra = {}) => { const st = createWorld({ seed, factionCount: 5, crewRoll: ROLL, ...extra }); st.pointsMax = extra.max ?? MAX; return st; }; // MAX: the numbers below are worked out at 80 each (the default is CUSTOM_POINTS.DEF)
const blankWorld = (seed, extra = {}) => world(seed, { ...extra, crew: blankCrew(createWorld({ seed, factionCount: 5, crewRoll: ROLL, ...extra })) });
const again = (st, extra = {}) => { const w = createWorld({ seed: st.seed, factionCount: 5, crewRoll: ROLL, mode: st.mode, ...extra, crew: crewSnapshot(st) }); w.pointsMax = st.pointsMax; return w; };
const UI = () => ({ started: false, freeEdit: true, ironman: false, worldSize: "normal", factionCount: 5, nrMsg: "" });
const count = (s, key) => carryList(s.startGear).filter((x) => x.key === key).length;
const things = (s, key) => carryList(s.startGear).filter((x) => x.key === key).reduce((a, x) => a + ((x.entry && x.entry.n) || 1), 0); // (boxes stack: .223 at 2 points goes in two to a stack)
const qty = (st, ui, k, n) => SG_CHANGE["sg-qty"](st, ui, { value: String(n), dataset: { k } });
const add = (st, ui, key) => SG_CHANGE["sg-item-add"](st, ui, { value: key, dataset: {} });
const tadd = (st, ui, key) => SG_CHANGE["sg-trunk-add"](st, ui, { value: key, dataset: {} });
const limit = (st, ui, n, i = 0) => SG_CHANGE["fleet-limit"](st, ui, { value: String(n), dataset: { i: String(i) } }); // a starting vehicle's point limit
const backWin = (ui, i = 0) => { ui.fleetEdit = { i, msg: "", tsel: null }; return ui; }; // its back's window (Edit…)
// Emptied first: a vehicle's back as rolled holds what the dice put in it (every mode since 2026-10-25: hardcore-start.js
// rollBack), and these checks price only what is put in by hand.
const emptyBack = (st, ui, i = 0) => SG_ACTIONS["fleet-empty"](st, ui, { i: String(i) });
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
  check(add(st, ui, AMMO) === true && count(s, AMMO) === 2 && carryList(s.startGear).filter((x) => x.key === AMMO).reduce((a, x) => a + (x.entry.n || 1), 0) === 6 && !ui.gearEdit.msg, `6 boxes of ${GEAR[AMMO].name} at once: a stack of five boxes and one box (2026-10-10: a slot holds up to five), no message`);
  check(pricePerson(st, s).carried === 6 * itemPoints(AMMO), `the points are its price six times (${6 * itemPoints(AMMO)})`);
  const b = again(st);
  const boxes = allCarried(b.survivors[0]).filter((it) => it.key === AMMO);
  check(boxes.length === 2 && boxes.reduce((a, it) => a + it.dur, 0) === 6 * GEAR[AMMO].dur && boxes.some((it) => it.dur === 5 * GEAR[AMMO].dur), `rebuilt: a stack of five boxes and one more on them (${boxes.map((it) => it.dur).join(" + ")} rounds)`);
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
  check(things(p.survivors[0], AMMO) === Math.max(1, Math.floor(left / each)) && pricePerson(p, p.survivors[0]).over === 0 && /points left pay for/.test(u2.gearEdit.msg), `points: ${left} left at ${each} each, ${things(p.survivors[0], AMMO)} put in, nobody over ("${u2.gearEdit.msg}")`);
  qty(p, u2, "qty", 3);
  add(p, u2, AMMO);
  check(things(p.survivors[0], AMMO) === Math.max(1, Math.floor(left / each)) + 1, "out of points: one still goes in (as a single thing always did; Start refuses it)");
  // The window shows the boxes.
  const html = startGearEditor(st, ui);
  check(/data-action="sg-qty" data-k="qty"/.test(html) && /data-action="sg-qty" data-k="tqty"/.test(fleetEditor(st, backWin(UI()))), "the windows: a × box by Add a thing, and by Put a thing in the back (a vehicle's back window)");
  check(qty(st, ui, "qty", 0) === false && ui.gearEdit.qty === 1 && (qty(st, ui, "qty", 500), ui.gearEdit.qty === 99), "the box held to 1–99");
}

section("N of a thing at once: the vehicle's back");
{
  const st = blankWorld(42);
  const ui = backWin(UI());
  limit(st, ui, 1000);
  emptyBack(st, ui);
  qty(st, ui, "tqty", 5);
  check(tadd(st, ui, "bandagekit") === "fleet", "five in the back");
  check(ui.fleet[0].load.items.filter((k) => k === "bandagekit").length === 5 && vehiclePoints(ui.fleet[0].load) === 5 * loosePoints("bandagekit"), "five things of their own, priced five times (against the vehicle's limit)");
  qty(st, ui, "tqty", 50);
  tadd(st, ui, "flashlight");
  check(ui.fleet[0].load.items.length === START_TRUNK.ITEMS && /at most 16/.test(ui.fleetEdit.msg), `held to the back's ${START_TRUNK.ITEMS} things ("${ui.fleetEdit.msg}")`);
  // Room: heavy things up to the room there is.
  const hc = blankWorld(42, { mode: "hardcore" });
  const uh = backWin(UI());
  limit(hc, uh, 1000);
  qty(hc, uh, "tqty", 16);
  tadd(hc, uh, "sandbags");
  const V = uh.fleet[0].load;
  check(trunkKg(V) <= startVehicleInfo(hc).room + 1e-9 && (V.items.length === 16 || /no room/.test(uh.fleetEdit.msg)), `Hardcore: up to the room (${trunkKg(V)} / ${startVehicleInfo(hc).room} kg)`);
  // Points: what its point limit pays for.
  const p = blankWorld(42);
  const up = backWin(UI());
  limit(p, up, 20);
  emptyBack(p, up);
  const each = loosePoints("ar");
  qty(p, up, "tqty", 10);
  tadd(p, up, "ar");
  check(up.fleet[0].load.items.length === Math.max(1, Math.floor(20 / each)) && /point limit \(20\) pays for/.test(up.fleetEdit.msg), `the back's points: a limit of 20 at ${each} each, ${up.fleet[0].load.items.length} put in ("${up.fleetEdit.msg}")`);
}

section("A custom background's total");
{
  const d = { ...blankBackground("c_9"), name: "Test", skills: { medicine: 5, shooting: 8 }, traits: ["tough", "loud"], traitTier: { tough: 2 }, gear: { weapon: "pistol", backpack: "hikingpack" }, items: ["bandagekit", "flashlight"], supplies: { food: 30, meds: 10 }, car: { odds: 1, type: "suv", trunk: { fuel: 20 }, items: ["crowbar"] } };
  const N = backgroundPoints(d, "normal"), H = backgroundPoints(d, "hardcore");
  check(N.skills === skillCost(5) + skillCost(8) && N.skills === 13, `skill bumps priced from 0: +5 and +8 come to ${N.skills}`);
  check(N.kit === itemPoints("pistol") + itemPoints("hikingpack") + itemPoints("bandagekit") + itemPoints("flashlight") && N.supplies === suppliesPoints({ food: 30, meds: 10 }), "kit and supplies");
  check(N.car === CUSTOM_POINTS.VEHICLE.suv && H.car === 0 && N.total === N.skills + N.traits + N.kit + N.supplies + N.car + N.trunk && H.total === N.total - N.car - N.trunk, `the car and its back: ${N.car} + ${N.trunk} at a normal start, free in Hardcore (totals ${N.total} / ${H.total})`);
  check(N.trunk === suppliesPoints({ fuel: 20 }) + itemPoints("crowbar"), "the car's back priced (in a normal start's total since 2026-10-24: the background's own)");
  setCustomLibrary([d]);
  const st = world(5);
  const ui = { started: false, ironman: false };
  BG_ACTIONS["bg-open"](st, ui);
  ui.bgEditor.sel = "c_9";
  const html = backgroundEditor(st, ui);
  check(new RegExp(`Total ${N.total} points`).test(html) && /skill bumps 13\+/.test(html) && /of 80 each/.test(html) && /its back \d+/.test(html), `the editor's line: "${(html.match(/Under Customize:[^<]*/) || [""])[0]}… Total ${N.total}"`);
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

section("The vehicles' backs: on nobody's points (the car pool retired)");
{
  const st = blankWorld(42);
  const ui = backWin(UI());
  const lead = st.survivors.find((s) => s.leader);
  lead.skills.shooting = 15; lead.skills.medicine = 15; lead.skills.scouting = 10; lead.skills.farming = 10; // 60
  const before = st.survivors.map((s) => pricePerson(st, s).total).join();
  emptyBack(st, ui);
  SG_CHANGE["sg-trunk-sup"](st, ui, { value: "60", dataset: { k: "food" } });
  SG_CHANGE["sg-trunk-sup"](st, ui, { value: "20", dataset: { k: "meds" } });
  const cost = suppliesPoints({ food: 60, meds: 20 });
  check(vehiclePoints(ui.fleet[0].load) === cost && st.survivors.map((s) => pricePerson(st, s).total).join() === before && !overBudget(st).length && !overText(st), `a back of ${cost} points: nobody pays it, nobody over`);
  check(!("vehicle" in pricePerson(st, lead)) && !("pool" in pricePerson(st, lead)) && !pricePerson(st, lead).lines.some((l) => /vehicle|car pool/i.test(l)), "no vehicle or car pool on a colonist's bill");
  limit(st, ui, 30);
  check(new RegExp(`back costs ${cost} points, over its limit of 30`).test(fleetText(st)), `over its own limit: Start refused, the vehicle named ("${fleetText(st)}")`);
  limit(st, ui, 60);
  check(!fleetText(st), "within it again: Start allowed");
  const html = newRunScreen(st, UI());
  check(!/data-action="sg-pool"/.test(html) && !/car pool/i.test(html) && /data-action="fleet-edit"/.test(html), "the screen: no Give leftover to the car pool; the Starting vehicles' Edit…");
  // A crew snapshot from before (carPool, startVehicle on a colonist): taken no notice of, and gone at Start.
  const old = crewSnapshot(st).map((c, i) => (i === 0 ? { ...c, carPool: true, startVehicle: { items: ["ar"], supplies: { food: 10 } } } : { ...c, carPool: true }));
  const r = createWorld({ seed: 42, factionCount: 5, crewRoll: ROLL, crew: old });
  check(r.survivors.every((s) => !s.carPool && !s.startVehicle) && !r.fleet[0].load, "an older crew snapshot's car pool and back: not on anyone");
  clearStartGear(r);
  check(!("fleet" in r) && r.survivors.every((s) => !s.carPool), "Start takes the screen's fleet off");
}

section("Hardcore's car back, Random back, Build and the dice");
{
  const hc = blankWorld(42, { mode: "hardcore" });
  const ui = backWin(UI());
  const o = hc.survivors.find((s) => s.diceTrunk);
  check(o && hc.fleet[0].load === null && hc.survivors.every((s) => pricePerson(hc, s).total === 0), "Hardcore: the car's back as rolled (the dice's), free, nobody's points");
  SG_CHANGE["sg-trunk-sup"](hc, ui, { value: "5", dataset: { k: "water" } });
  const V = ui.fleet[0].load;
  check(V && V.items.length === o.diceTrunk.items.length && V.supplies.water === 5, "a change on the back as rolled: the dice's back with it, now its own");
  const h2 = again(hc, { fleet: ui.fleet });
  h2.pointsMax = hc.pointsMax;
  check(h2.hardcore.start.carOwner === h2.survivors[hc.survivors.indexOf(hc.survivors.find((s) => s.id === hc.hardcore.start.carOwner))].id && h2.fleet[0].load && h2.fleet[0].load.supplies.water === 5, "rebuilt: the same owner and back");
  // Random back: up to the vehicle's limit, whatever anyone has left.
  const st = blankWorld(42);
  const u = backWin(UI());
  const lead = st.survivors.find((s) => s.leader);
  lead.skills.shooting = 20; lead.skills.medicine = 15; lead.skills.farming = 15; lead.skills.scouting = 5; // 80: nothing left
  let ok = true, any = false;
  for (let k = 0; k < 6; k++) {
    SG_ACTIONS["sg-trunk-rand"](st, u);
    const B = u.fleet[0].load;
    if (B && (B.items.length || Object.keys(B.supplies).length)) any = true;
    if (overBudget(st).length || vehiclePoints(B) > u.fleet[0].limit || trunkKg(B) > fleetRoom(st, 0)) ok = false;
  }
  check(any && ok, "Random back: filled up to its own limit with the payer of old out of points, nobody over (six draws)");
  // Build on everyone: nobody over.
  let okB = true;
  for (let k = 0; k < 6; k++) {
    for (const s of st.survivors) SG_ACTIONS["sg-build"](st, u, { i: st.survivors.indexOf(s) });
    if (overBudget(st).length) okB = false;
  }
  check(okB, "Build on every colonist (six times): nobody over, the back as it was");
  let rebuilt = null;
  randomizeAllCrew(st, { ...UI(), crewRoll: ROLL }, (crew, crewRoll) => { rebuilt = world(42, { crew, crewRoll, fleet: u.fleet }); return rebuilt; });
  check(rebuilt && !overBudget(rebuilt).length && JSON.stringify(rebuilt.fleet[0].load) === JSON.stringify(u.fleet[0].load), "Randomize all: nobody over, the back kept");
}

section("Randomize everything: every build and the vehicle's back");
for (const mode of ["normal", "hardcore"]) {
  let st = blankWorld(42, { mode });
  const u = { ...UI(), crewRoll: ROLL };
  let over = 0, filled = 0, skilled = 0, kitted = 0, roomy = true, limited = true;
  const names = new Set();
  const N = 8;
  for (let k = 0; k < N; k++) {
    st = randomizeEverything(st, u, (crew, crewRoll) => { const w = world(42, { mode, crew, crewRoll, fleet: u.fleet }); return w; });
    if (overBudget(st).length) over++;
    const back = st.fleet[0].load;
    if (back && (back.items.length || Object.keys(back.supplies).length)) filled++;
    if (back && trunkKg(back) > fleetRoom(st, 0) + 1) roomy = false;
    if (back && vehiclePoints(back) > st.fleet[0].limit) limited = false;
    if (st.survivors.every((s) => SKILLS.some((x) => s.skills[x] > 0))) skilled++;
    if (st.survivors.every((s) => s.startGear && Object.values(s.startGear.slots).some(Boolean))) kitted++;
    names.add(st.survivors.map((s) => s.name).join());
  }
  check(!over, `${mode}: nobody over the points (${N} draws)`);
  check(filled === N && limited, `${mode}: the vehicle's back filled each time, within its own limit (${filled} of ${N})`);
  check(roomy, `${mode}: the back within its room once the world is built again`);
  check(skilled === N && kitted === N, `${mode}: every colonist has skills and something worn or held each time (${skilled}, ${kitted})`);
  check(names.size >= N - 1, `${mode}: new names each draw (${names.size} of ${N})`);
}
{
  const st = blankWorld(42);
  check(randomizeEverything(st, { ...UI(), freeEdit: false }, () => { throw new Error("rebuilt"); }) === st, "Randomize everything: nothing outside Customize");
  check(/data-action="nr-everything"/.test(newRunScreen(st, UI())) && !/data-action="nr-everything"/.test(newRunScreen(st, { ...UI(), freeEdit: false })), "the button: under Customize only");
}

section("Guns: calibre and capacity, parts, a loaded magazine");
{
  check(gunInfo("pistol").text === "9mm · 15 rds" && gunInfo("shotgun").text === "12 gauge · 6 rds" && /internal magazine/.test(gunInfo("shotgun").long) && !gunInfo("knife"), `the pickers' words: ${gunInfo("pistol").text}; ${gunInfo("shotgun").text}; ${gunInfo("m79").text}; a knife none`);
  const st = blankWorld(42);
  const ui = UI();
  ui.gearEdit = { i: 0, sel: null, msg: "" };
  const s = st.survivors[0];
  let html = startGearEditor(st, ui);
  check(/>Assault rifle <span class="gpbit">5\.56 NATO( \/ \.223 Rem)? · 30 rds<\/span>/.test(html) && />9mm pistol <span class="gpbit">9mm · 15 rds<\/span>/.test(html) && /Takes 5\.56 NATO( \(and \.223 Rem\))?: 30 rounds/.test(html), "every gun in the pickers: its calibre and rounds (and a sentence on hover; the catalogue's rows, ui/gearpicker.js, 2026-10-27)");
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
  check(/5\.56 NATO( \/ \.223 Rem)? · 40 rds/.test(startGearEditor(st, ui)), "the window says 40 rds now");
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
  tadd(c, uc, "shotgun"); // the starting vehicle's back (the screen's fleet: main.js ui.fleet)
  const cb = again(c, { fleet: uc.fleet });
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
  const h2 = again(hc, { fleet: uh.fleet });
  const rv = h2.parties[0].cargo.gear.find((it) => it.key === "revolver");
  check(rv && rv.loaded && rv.loaded.n === 6 && rv.loaded.key === "a_357_fmj", "Hardcore: the revolver in the car's back loaded (6)");
  const hg = h2.survivors[0].gear.weapon;
  check(hg.key === "ar" && hg.mods.mag.key === "mag_stanag_40" && (h2.parties[0].supplies.a_556_fmj || 0) >= 40 * START_GEAR.LOADS, `Hardcore: the rifle in the hands with its 40-round magazine and its rounds (${h2.parties[0].supplies.a_556_fmj})`);
}

section("A custom background's car's back at a normal start: on its own colonist's bill");
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
  check(bgBacks(st).length === 1 && bgBacks(st)[0].s === bgS && bgBacks(st)[0].n === n, "their background's car's back listed");
  check(pricePerson(st, bgS).extra === suppliesPoints(A0.supplies || {}) + CUSTOM_POINTS.VEHICLE.sedan + n && pricePerson(st, lead).extra === 0, `on their own bill with the car (${pricePerson(st, bgS).extra}), nobody else's`);
  check(/car and its back/.test(pricePerson(st, bgS).lines.join(" · ")), "their bill says so");
  // Over: the refusal names them.
  for (const k of SKILLS) bgS.skills[k] = 15;
  check(overBudget(st).some((x) => x.s === bgS) && new RegExp(bgS.name.split(" ")[0]).test(overText(st)), `Start refused, they are named: "${overText(st)}"`);
  for (const k of SKILLS) bgS.skills[k] = 0;
  // Built: it goes to the hub, the gun in it loaded.
  const plain = mk("normal", crewSnapshot(st0));
  const b = mk("normal", crewSnapshot(st));
  check(b.bases[0].stock.fuel === plain.bases[0].stock.fuel + 20 && food(b.bases[0]) >= food(plain.bases[0]) + 10, "built: its fuel and food in the hub's stores");
  const pz = b.bases[0].armory.find((it) => it.key === "pistol" && it.loaded);
  check(b.bases[0].armory.some((it) => it.key === "crowbar") && !!pz, "and its crowbar and pistol in the armory");
  // Start with a vehicle off: no car, nothing of its back, nothing on the bill.
  const off = createWorld({ seed: 42, factionCount: 5, crewRoll: ROLL, crew: crewSnapshot(st), customBackgrounds: lib, vehicle: false });
  check(!bgBacks(off).length && pricePerson(off, off.survivors[1]).extra === suppliesPoints(A0.supplies || {}), "Start with a vehicle off: no car and no back on their bill");
  // Hardcore: the car's back is the dice's back (the starting vehicle's As rolled): nothing on the bill.
  const h0 = blank("hardcore");
  const ha = mk("hardcore", crewWithBackground(h0, h0.survivors[1].id, "c_5"));
  loadDice(ha, ha.survivors[1]);
  const h = mk("hardcore", crewSnapshot(ha));
  check(!bgBacks(h).length && pricePerson(h, h.survivors[1]).extra === suppliesPoints(A0.supplies || {}), "Hardcore: nothing extra (the car's back is the starting vehicle's, as rolled)");
  // The editor says where it goes.
  const eui = { started: false, ironman: false };
  BG_ACTIONS["bg-open"](st, eui);
  eui.bgEditor.sel = "c_5";
  check(/its back \d+/.test(backgroundEditor(st, eui)) && /what is in its back \(to the hub with it\)/.test(backgroundEditor(st, eui)), "the editor: the car's back in the total, to the hub with it");
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
  // The vehicle's back (its own window since 2026-10-24: Starting vehicles, Edit…).
  ui.gearEdit = null;
  backWin(ui);
  limit(st, ui, 1000);
  emptyBack(st, ui);
  tadd(st, ui, "ar");
  const back = () => ui.fleet[0].load;
  const j = back().items.indexOf("ar");
  check(SG_ACTIONS["sg-trunk-pick"](st, ui, { i: j }) === false && /Parts for the Assault rifle in the back/.test(fleetEditor(st, ui)) && /data-t="trunk" data-j="0"/.test(fleetEditor(st, ui)), "the ⚙ on a gun in the back: its parts box");
  const v0 = vehiclePoints(back());
  check(SG_CHANGE["sg-gunmod"](st, ui, { value: "mag_stanag_40", dataset: { gs: "mag", t: "trunk", j: String(j) } }) === "fleet", "a 40-round magazine on the rifle in the back");
  e = back().items[j];
  check(e.key === "ar" && e.mods.mag === "mag_stanag_40" && vehiclePoints(back()) === v0 - loosePoints("ar") + pickPoints(e), `kept and priced (${v0} → ${vehiclePoints(back())})`);
  const b2 = again(st, { fleet: ui.fleet });
  const ar = b2.bases[0].armory.find((it) => it.key === "ar" && it.mods && it.mods.mag && it.mods.mag.key === "mag_stanag_40");
  check(ar && ar.loaded && ar.loaded.n === 40, "normal: in the armory fitted, loaded with 40");
  check(SG_ACTIONS["sg-gunmods-clear"](st, ui, { t: "trunk", j: String(j) }) === "fleet" && back().items[j] === "ar", "As it comes in the back too");
  const hc = blankWorld(42, { mode: "hardcore" });
  const uh = backWin(UI());
  SG_ACTIONS["sg-trunk-clear"](hc, uh);
  limit(hc, uh, 1000);
  tadd(hc, uh, "pistol");
  SG_CHANGE["sg-gunmod"](hc, uh, { value: "mag_glock_17", dataset: { gs: "mag", t: "trunk", j: "0" } });
  const hp = again(hc, { fleet: uh.fleet }).parties[0].cargo.gear.find((it) => it.key === "pistol");
  check(hp && hp.mods && hp.mods.mag.key === "mag_glock_17" && hp.loaded.n === 17, "Hardcore: the pistol in the car's back fitted, loaded with 17");
  // The plain-key form still reads; a misfit made safe goes back to it.
  check(sanitizeStartGear({ slots: {}, carry: { pocket: ["pistol"] } }).carry.pocket[0] === "pistol" && JSON.stringify(sanitizeStartVehicle({ items: ["ar", { key: "ar", mods: { muzzle: "pistolcan" } }, { key: "pistol", mods: { optic: "reddot" } }] }).items) === JSON.stringify(["ar", "ar", { key: "pistol", mods: { optic: "reddot" } }]), "plain keys read as ever; a gun with no parts that fit is a plain key");
}

section("The dice's gear keeps the parts the dice put on a gun");
{
  let st = null, i = -1;
  for (let seed = 1; seed < 60 && i < 0; seed++) {
    const w = blankWorld(seed);
    const j = w.survivors.findIndex((x) => x.diceKit && x.diceKit.mods && x.diceKit.slots.weapon);
    if (j >= 0) { st = w; i = j; }
  }
  if (check(!!st, "a seed whose dice put parts on someone's gun")) {
    const s = st.survivors[i], dm = { ...s.diceKit.mods }, wk = s.diceKit.slots.weapon;
    const ui = UI();
    check(SG_ACTIONS["sg-dice"](st, ui, { i }) === true && JSON.stringify(s.startGear.mods) === JSON.stringify(dm), `Start from the dice: the ${GEAR[wk].name} with ${JSON.stringify(dm)}`);
    check(pricePerson(st, s).gear >= slotPoints("weapon", wk, dm), "priced with its parts");
    const b = again(st);
    const g = b.survivors[i].gear.weapon;
    check(g.key === wk && Object.entries(dm).every(([slot, k]) => (k ? g.mods && g.mods[slot] && g.mods[slot].key === k : !(g.mods && g.mods[slot]))), "rebuilt: the gun has the dice's parts");
    ui.gearEdit = { i, sel: null, msg: "" };
    SG_ACTIONS["sg-kit-clear"](b, ui);
    check(!b.survivors[i].startGear.mods, "Empty: as it comes");
    check(SG_ACTIONS["sg-dice-kit"](b, ui) === true && JSON.stringify(b.survivors[i].startGear.mods) === JSON.stringify(dm), "the gear window's The dice's gear: the parts again");
  }
  // A carried gun the dice fitted: kept as { key, mods }.
  const it = gunWith("pistol", { optic: "reddot" });
  const fake = blankWorld(42).survivors[0];
  fake.pockets[0] = it;
  noteDiceKit(fake);
  check(JSON.stringify(fake.diceKit.carry.pocket[0]) === JSON.stringify({ key: "pistol", mods: { optic: "reddot" } }), "a carried gun with parts noted with them");
  // Hardcore: the car's back as rolled keeps a gun's parts.
  let found = false;
  for (let seed = 1; seed < 80 && !found; seed++) {
    const h = blankWorld(seed, { mode: "hardcore" });
    const o = h.survivors.find((x) => x.diceTrunk);
    const e = o && o.diceTrunk.items.find((x) => typeof x === "object");
    if (!e) continue;
    found = true;
    const uh = backWin(UI());
    limit(h, uh, 1000);
    SG_CHANGE["sg-trunk-sup"](h, uh, { value: "1", dataset: { k: "water" } }); // a change on the back as rolled: the dice's back is the start of it
    check(uh.fleet[0].load.items.some((x) => typeof x === "object" && x.key === e.key && JSON.stringify(x.mods) === JSON.stringify(e.mods)) && h.parties[0].cargo.gear.some((it) => it.key === e.key && it.mods), `Hardcore As rolled: the ${GEAR[e.key].name} in the back with its parts (seed ${seed})`);
  }
  if (!found) console.log("  (no Hardcore seed under 80 rolled a gun with parts into the car's back: not checked)");
}

section("The background's Total follows every key press");
{
  const d = { ...blankBackground("c_7"), name: "Typing", skills: { medicine: 5 }, supplies: { food: 10 }, car: { odds: 1, type: "sedan", trunk: {}, items: [] } };
  setCustomLibrary([d]);
  const st = world(5);
  const ui = { started: false, ironman: false };
  BG_ACTIONS["bg-open"](st, ui);
  ui.bgEditor.sel = "c_7";
  const before = backgroundPoints(customLibrary().c_7, "normal").total;
  const line = { outerHTML: "<div class=\"small bgtotal\">old</div>" };
  const doc = { querySelector: (q) => (q === ".bgtotal" ? line : null) };
  const el = (action, value, k) => ({ value: String(value), dataset: k ? { k } : {}, ownerDocument: doc });
  const draft = BG_INPUT["bg-skill"](st, ui, el("bg-skill", 9, "medicine"));
  const want = before + skillCost(9) - skillCost(5);
  check(draft && draft.skills.medicine === 9 && new RegExp(`Total ${want} points`).test(line.outerHTML) && /class="small bgtotal"/.test(line.outerHTML), `Medicine typed 9: the line alone redrawn, Total ${before} → ${want}`);
  check(customLibrary().c_7.skills.medicine === 5, "nothing kept until the box's change");
  BG_INPUT["bg-sup"](st, ui, el("bg-sup", 30, "food"));
  check(new RegExp(`Total ${before + suppliesPoints({ food: 30 }) - suppliesPoints({ food: 10 })} points`).test(line.outerHTML), "supplies typed: the Total follows");
  BG_INPUT["bg-carodds"](st, ui, el("bg-carodds", 0));
  check(new RegExp(`Total ${before - CUSTOM_POINTS.VEHICLE.sedan} points`).test(line.outerHTML), "the car's odds typed 0: no car, no car price");
  BG_INPUT["bg-trunk"](st, ui, el("bg-trunk", 20, "fuel"));
  check(/its back \d+/.test(line.outerHTML) && new RegExp(`Total ${before + suppliesPoints({ fuel: 20 })} points`).test(line.outerHTML), "the car's back typed: shown, in the Total (a normal start's: the background's own)");
  check(BG_INPUT["bg-skill"](st, { started: false }, el("bg-skill", 3, "medicine")) === null, "no window open: nothing");
  const mainSrc = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  check(/addEventListener\("input", \(ev\) => \{ const el = [^\n]*BG_INPUT\[el\.dataset\.action\][^\n]*fn\(state, ui, el\); \}\);/.test(mainSrc) && !/BG_INPUT[^\n]*refresh\(\)/.test(mainSrc), "main.js: typing redraws the line with no refresh (the box keeps its focus and caret)");
  setCustomLibrary([]);
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
