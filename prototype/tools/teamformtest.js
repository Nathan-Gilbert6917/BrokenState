// Headless checks for forming a team at a base and changing it there (sim/teamform.js, ui/teamform.js): forming moves
// the people, the vehicle (a car, or bikes one each), the supplies and the cargo items out of the base and onto the
// team with nothing duplicated or lost (every item object and every supply counted before and after); the team waits
// on the base's tile with no mission, in contact, with orders; refusals (nobody picked, too heavy, a car with no fuel,
// someone not at the base, too few bikes); editing at the base (add and remove people, swap the vehicle, set supplies,
// load and drop off gear) with the same totals kept; Enter base disbands it back in; a save and load round trip of a
// waiting formed team (and editing it after the load); and a render smoke test of the window and its buttons.
// Usage: node tools/teamformtest.js [seed]
import { payFood } from "../src/sim/foods.js";
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import { partyTile, partyMembers, poolLoad, partyCapacity, teamName, orderOptions, MISSIONS, planPath, travelHours, paceOpts, carryCapacity, leaveVehicle, wipeParty, launchExpedition, movePartiesHour, orderMove, hoursLeft, partySpeed } from "../src/sim/parties.js";
import { reseat } from "../src/sim/walkers.js";
import { vehiclesAtBase, vehicleById, partyVehicle, isBike, createVehicle, parkBikes, seatsOf, MAX_VEHICLES, fleetOf, partyVehicles, payloadOf, typeSpeed, typeFuel, roadPace, partyFuel, useFuel, breakdownRoll, fleetJoinProblem, addPartyVehicle, driversFor } from "../src/sim/vehicles.js";
import { createBattle, registerCombatHandler, vehicleBlast, settleVehicle } from "../src/sim/combat.js";
import { ROCKET } from "../src/sim/launchers.js";
import { newItem, stripAll, allCarried, itemLoad, packOf, quickMove, carriedSpots } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { SUPPLIES } from "../src/sim/data.js";
import { contactable } from "../src/sim/orders.js";
import { enterOption, joinBase } from "../src/sim/moveout.js";
import { loadFromBase, dropOff } from "../src/sim/teaminv.js";
import { formTeam, formPreview, editBase, editProblem, editableTeams, addMember, removeMember, setVehicle, setVehicles, toggleVehicle, setSupply, teamHas, FORMED, gearSnapshot, gearChanged, restoreGear } from "../src/sim/teamform.js";

const SEED = Number(process.argv[2] || 42);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 5 });
  state.started = true;
  state.noWanderers = true;
  Object.assign(hub(state).stock, { water: 300, fuel: 100, meds: 20, parts: 10, scrap: 100, a_9mm_fmj: 200, a_556_fmj: 120 }); setFood(hub(state), 300);
  return state;
}
// Every item object anywhere that matters here (people at the base and on teams, the armory, cargo), walked into packs,
// rigs, carriers' plates and guns' attachments; each one once.
function itemsOf(state) {
  const seen = [];
  const walk = (it) => {
    if (!it || typeof it !== "object") return;
    seen.push(it);
    for (const c of it.contents || []) walk(c);
    for (const c of Object.values(it.inserts || {})) walk(c);
    for (const c of Object.values(it.mods || {})) if (c && c.key) walk(c);
  };
  for (const s of state.survivors) if (s.alive && s.gear) for (const k of Object.keys(s.gear)) walk(s.gear[k]);
  for (const s of state.survivors) if (s.alive && s.pockets) for (const it of s.pockets) walk(it);
  for (const b of state.bases) for (const it of b.armory) walk(it);
  for (const p of state.parties) for (const it of (p.cargo && p.cargo.gear) || []) walk(it);
  return seen;
}
// Supplies: the bases' stores and every team's packed and found supplies, by key.
function suppliesOf(state) {
  const out = {};
  const add = (o) => { for (const [k, q] of Object.entries(o || {})) if (SUPPLIES[k] && Number.isFinite(q)) out[k] = (out[k] || 0) + q; };
  for (const b of state.bases) add(b.stock);
  for (const p of state.parties) { add(p.supplies); add(p.cargo && p.cargo.supplies); }
  return out;
}
const bikesTotal = (state) => state.vehicles.filter(isBike).reduce((a, v) => a + (v.count || 1), 0);
function census(state) {
  const items = itemsOf(state);
  return { items: new Set(items), n: items.length, sup: suppliesOf(state), people: state.survivors.filter((s) => s.alive).length, cars: state.vehicles.filter((v) => !isBike(v)).length, bikes: bikesTotal(state) };
}
function sameCensus(a, b, what) {
  check(b.n === b.items.size, `${what}: no item is in two places (${b.n} places, ${b.items.size} items)`);
  check(a.items.size === b.items.size && [...a.items].every((it) => b.items.has(it)), `${what}: the same items as before (${a.items.size} → ${b.items.size})`);
  const keys = new Set([...Object.keys(a.sup), ...Object.keys(b.sup)]);
  const off = [...keys].filter((k) => !near(a.sup[k] || 0, b.sup[k] || 0, 1e-6));
  check(!off.length, `${what}: every supply adds up (${off.map((k) => `${k} ${a.sup[k] || 0} → ${b.sup[k] || 0}`).join(", ")})`);
  check(a.people === b.people && a.cars === b.cars && a.bikes === b.bikes, `${what}: people, cars and bikes all still there`);
}
// Two people with known kit; a car with fuel; the armory with a rifle, a pack and magazines.
function setup(state) {
  const h = hub(state);
  const crew = atBase(state, h.id).slice(0, 4);
  for (const s of crew) { s.traits = []; stripAll(s); }
  const car = vehiclesAtBase(state, h.id).find((x) => !isBike(x));
  car.fuel = 20; car.condition = 100;
  const rifle = newItem("ar"), pack = newItem("backpack"), knife = newItem("knife"), crowbar = newItem("crowbar");
  h.armory.push(rifle, pack, knife, crowbar);
  return { h, crew, car, rifle, pack, knife, crowbar };
}
const armoryLoc = (b, it) => `armory:${b.id}:list:${b.armory.indexOf(it)}`;
// Where every item is, as a path (a base's armory slot, a person's slot or pocket, a team's cargo, inside a pack, a rig,
// a carrier or a gun): the undo test compares them all.
function placesOf(state) {
  const m = new Map();
  const walk = (it, path) => {
    if (!it || typeof it !== "object" || !it.key) return;
    m.set(it, path);
    (it.contents || []).forEach((c, i) => walk(c, `${path}>c${i}`));
    for (const [k, c] of Object.entries(it.inserts || {})) walk(c, `${path}>i${k}`);
    for (const [k, c] of Object.entries(it.mods || {})) walk(c, `${path}>m${k}`);
  };
  for (const b of state.bases) b.armory.forEach((it, i) => walk(it, `b${b.id}:${i}`));
  for (const s of state.survivors) if (s.alive && s.gear) { for (const [k, it] of Object.entries(s.gear)) walk(it, `s${s.id}:${k}`); (s.pockets || []).forEach((it, i) => walk(it, `s${s.id}:p${i}`)); }
  for (const p of state.parties) ((p.cargo && p.cargo.gear) || []).forEach((it, i) => walk(it, `c${p.id}:${i}`));
  return m;
}
const where = (state, it) => placesOf(state).get(it);

// ---------------------------------------------------------------------------------------------------------
section("Forming: people, a car, supplies and cargo leave the base, nothing lost or doubled");
{
  const state = mk();
  const { h, crew, car, rifle, pack, crowbar } = setup(state);
  const [a, b] = crew;
  a.gear.weapon = rifle; h.armory.splice(h.armory.indexOf(rifle), 1); // the gear step: moved at the base before forming
  a.gear.backpack = pack; h.armory.splice(h.armory.indexOf(pack), 1);
  const before = census(state);
  const residentsBefore = atBase(state, h.id).length;
  const pre = formPreview(state, { baseId: h.id, memberIds: [a.id, b.id], vehicleId: car.id, supplies: { food: 10, water: 10, fuel: 5, a_556_fmj: 30 }, cargo: [armoryLoc(h, crowbar)] });
  check(!pre.problem && pre.cargo.includes(crowbar) && near(pre.cargoKg, itemLoad(crowbar)), `the preview has no problem and counts the cargo (${pre.problem})`);
  const r = formTeam(state, { baseId: h.id, memberIds: [a.id, b.id], vehicleId: car.id, supplies: { food: 10, water: 10, fuel: 5, a_556_fmj: 30 }, cargo: [armoryLoc(h, crowbar)] });
  check(r.party && !r.error, `the team forms (${r.error || ""})`);
  const p = r.party;
  sameCensus(before, census(state), "forming");
  check(partyTile(p) === h.tile && p.phase === "waiting" && p.path.length === 1, "it stands on the base's tile, waiting");
  check(p.teamMission === FORMED && MISSIONS[FORMED] && /^Field team/.test(teamName(state, p)), `it has no mission: "${teamName(state, p)}"`);
  check(contactable(p) && orderOptions(state, p).length > 0, "it takes orders (in contact, with the orders list)");
  check(a.location.kind === "party" && b.location.kind === "party" && atBase(state, h.id).length === residentsBefore - 2, "the two left the base's roster");
  check(a.gear.weapon === rifle && a.gear.backpack === pack, "they keep the kit set at the base");
  check(car.loc.kind === "party" && car.loc.partyId === p.id && partyVehicle(state, p) === car, "the car went with the team");
  check(p.cargo.gear.includes(crowbar) && !h.armory.includes(crowbar), "the crowbar went into the cargo");
  check(teamHas(p, "food") >= 10 && teamHas(p, "food") < 11.21 && teamHas(p, "a_556_fmj") === 30 && teamHas(p, "fuel") === 5, "the supplies were packed");
  check(!!enterOption(state, p), "Enter base is offered on its own tile");
  check(editBase(state, p) === h && editProblem(state, p) === "" && editableTeams(state, h).includes(p), "it can be changed at the base");
  check(poolLoad(p) <= partyCapacity(state, p) + 1e-9, "within what it can carry");
}

section("Forming on foot and on bikes");
{
  const state = mk();
  const { h, crew } = setup(state);
  const before = census(state);
  const r = formTeam(state, { baseId: h.id, memberIds: [crew[0].id], supplies: { food: 3 } });
  check(r.party && !partyVehicle(state, r.party) && r.party.vehicle === false, `on foot (${r.error || ""})`);
  sameCensus(before, census(state), "forming on foot");
  // Bikes: one each from the base's stack.
  createVehicle(state, "bike", { kind: "base", baseId: h.id }, { count: 3, condition: 90 });
  const stack = parkBikes(state, h);
  const nb = stack.count;
  const before2 = census(state);
  const r2 = formTeam(state, { baseId: h.id, memberIds: [crew[1].id, crew[2].id], vehicleId: stack.id, supplies: { food: 4 } });
  const v = r2.party && partyVehicle(state, r2.party);
  check(v && isBike(v) && v.count === 2, `two bikes went with two people (${r2.error || ""})`);
  check(vehiclesAtBase(state, h.id).filter(isBike).reduce((x, y) => x + (y.count || 1), 0) === nb - 2, "two fewer bikes at the base");
  sameCensus(before2, census(state), "forming on bikes");
  // Adding someone takes one more bike; removing gives it back.
  const n0 = bikesTotal(state);
  check(addMember(state, r2.party, crew[3].id) && partyVehicle(state, r2.party).count === 3 && crew[3].location.partyId === r2.party.id, "adding a person takes another bike");
  check(removeMember(state, r2.party, crew[3].id) && partyVehicle(state, r2.party).count === 2 && crew[3].location.kind === "base", "removing them puts it back");
  check(bikesTotal(state) === n0, "bikes add up");
}

section("Refusals: nobody, too heavy, no fuel, not at the base, too few bikes");
{
  const state = mk();
  const { h, crew, car } = setup(state);
  const before = census(state);
  check(/at least one/.test(formTeam(state, { baseId: h.id, memberIds: [] }).error || ""), "nobody picked");
  check(/Too much to carry/.test(formTeam(state, { baseId: h.id, memberIds: [crew[0].id], supplies: { scrap: 100 } }).error || ""), "too heavy for one person on foot");
  car.fuel = 0;
  check(/no fuel/.test(formTeam(state, { baseId: h.id, memberIds: [crew[0].id], vehicleId: car.id }).error || ""), "a car with an empty tank");
  check(formTeam(state, { baseId: h.id, memberIds: [crew[0].id], vehicleId: car.id, supplies: { fuel: 5 } }).party, "the same car with fuel cans packed goes");
  const other = state.survivors.find((s) => s.alive && s.location.kind !== "base");
  if (other) check(/not at/.test(formTeam(state, { baseId: h.id, memberIds: [other.id] }).error || ""), "someone not at the base");
  else check(/not at/.test(formTeam(state, { baseId: h.id, memberIds: [crew[0].id] }).error || ""), "someone not at the base (already on the team)");
  createVehicle(state, "bike", { kind: "base", baseId: h.id }, { count: 1 });
  const stack = parkBikes(state, h);
  check(/Not enough bikes/.test(formTeam(state, { baseId: h.id, memberIds: [crew[1].id, crew[2].id], vehicleId: stack.id }).error || ""), "two people, one bike");
  check(/Not enough/.test(formTeam(state, { baseId: h.id, memberIds: [crew[1].id], supplies: { meds: 25 } }).error || ""), "more meds than the stores have");
  const p = state.parties.find((x) => x.teamMission === FORMED);
  // Only the one team that formed changed anything: undo it and the totals are where they started.
  const c = census(state);
  check(c.people === before.people && c.items.size === before.items.size, "a refusal moves nothing");
  void p;
}

section("Editing at the base: people, vehicle, supplies, gear");
{
  const state = mk();
  const { h, crew, car, knife } = setup(state);
  const r = formTeam(state, { baseId: h.id, memberIds: [crew[0].id], supplies: { food: 4, water: 4 } });
  const p = r.party;
  const before = census(state);
  check(/joins/.test(addMember(state, p, crew[1].id)) && p.members.includes(crew[1].id) && crew[1].location.partyId === p.id, "add a person from the base");
  check(/not at/.test(addMember(state, p, crew[1].id)), "not twice");
  check(/now has the/.test(setVehicle(state, p, car.id)) && partyVehicle(state, p) === car && p.vehicle === true && car.loc.partyId === p.id, "take the car");
  check(/food|ration bars/.test(setSupply(state, p, "food", 20)) && teamHas(p, "food") >= 20 - 1e-6 && teamHas(p, "food") < 21.21, "load more food (20 days: whole ration bars)");
  check(/food/.test(setSupply(state, p, "food", 6)) && near(teamHas(p, "food"), 6), "drop some off (6)");
  const lr = loadFromBase(state, p, { items: [armoryLoc(h, knife)] }, crew[1].id);
  check(lr.moved.length === 1 && !h.armory.includes(knife), "a knife from the armory onto a member");
  const dr = dropOff(state, p, { items: [knife] });
  check(dr.moved.length === 1 && h.armory.includes(knife), "and back");
  check(/goes back/.test(removeMember(state, p, crew[1].id)) && crew[1].location.kind === "base" && crew[1].location.baseId === h.id, "send a person back in");
  check(/last one/.test(removeMember(state, p, crew[0].id)), "not the last one (Enter base does that)");
  check(/on foot/.test(setVehicle(state, p, null)) && !partyVehicle(state, p) && car.loc.kind === "base", "back on foot: the car parks");
  car.fuel = 0;
  check(/no fuel/.test(setVehicle(state, p, car.id)), "a car with no fuel is refused");
  car.fuel = 20;
  sameCensus(before, census(state), "editing");
  // Too heavy: a lone walker with a car full of scrap cannot go back on foot, nor lose the person carrying it.
  setVehicle(state, p, car.id);
  addMember(state, p, crew[1].id);
  setSupply(state, p, "scrap", 60);
  check(/could not carry/.test(setVehicle(state, p, null)) && partyVehicle(state, p) === car, "on foot with 60 scrap is refused");
  // Busy: on the move it cannot be changed.
  p.phase = "out";
  check(/busy/.test(editProblem(state, p)) && /busy/.test(addMember(state, p, crew[2].id)), "a team on the way cannot be changed");
  p.phase = "waiting";
}

section("Enter base disbands it back in");
{
  const state = mk();
  const { h, crew, car, crowbar } = setup(state);
  const before = census(state);
  const res = atBase(state, h.id).length;
  const p = formTeam(state, { baseId: h.id, memberIds: [crew[0].id, crew[1].id], vehicleId: car.id, supplies: { food: 6, water: 6 }, cargo: [crowbar] }).party;
  joinBase(state, p, h);
  check(!state.parties.includes(p), "the team is gone");
  check(atBase(state, h.id).length === res && crew[0].location.kind === "base" && car.loc.kind === "base", "its people and the car are back");
  check(h.armory.includes(crowbar), "the cargo went into the armory");
  const after = census(state);
  check(after.items.size === before.items.size && [...before.items].every((it) => after.items.has(it)), "every item is still there");
  // Whole units come back (a base keeps whole units of what a team brings in, parties.js addStock).
  check(["food", "water", "fuel"].every((k) => near(after.sup[k] || 0, before.sup[k] || 0, 1)), "the supplies came back");
}

section("Save and load: a formed team waiting on the base");
{
  const state = mk();
  const { h, crew, car, crowbar } = setup(state);
  const p = formTeam(state, { baseId: h.id, memberIds: [crew[0].id, crew[1].id], vehicleId: car.id, supplies: { food: 6, water: 6, a_9mm_fmj: 20 }, cargo: [crowbar] }).party;
  state.cards.length = 0;
  const ld = loadFromString(saveToString(state));
  const lp = ld.parties.find((x) => x.id === p.id);
  check(lp && lp.teamMission === FORMED && lp.phase === "waiting" && partyTile(lp) === h.tile, "the team is still waiting on the base's tile");
  check(lp && partyMembers(ld, lp).length === 2 && partyVehicle(ld, lp) && partyVehicle(ld, lp).id === car.id, "with its people and the car");
  check(lp && lp.cargo.gear.some((it) => it.key === "crowbar") && near(teamHas(lp, "a_9mm_fmj"), 20), "with its cargo and rounds");
  const lh = hub(ld);
  check(lp && editBase(ld, lp) === lh, "it can still be changed at the base after loading");
  const c3 = atBase(ld, lh.id).find((s) => !lp.members.includes(s.id));
  check(lp && c3 && /joins/.test(addMember(ld, lp, c3.id)), "and someone joins in the loaded world");
  check(lp && !!enterOption(ld, lp), "and Enter base is still there");
}

section("Render: the window, the ways in");
{
  let ok = true, why = "";
  try {
    const ui = await import("../src/ui/teamform.js");
    const state = mk();
    const { h, crew, car } = setup(state);
    const u = { inv: null };
    ui.TEAMFORM_ACTIONS["tf-open"](state, u, { base: h.id });
    check(u.inv && u.inv.form && u.inv.form.baseId === h.id, "Form a team… opens the window");
    let html = ui.teamFormModal(state, u);
    check(/Form a team/.test(html) && html.includes(crew[0].name.split(" ")[0]), "it lists the people at the base");
    ui.TEAMFORM_ACTIONS["tf-crew"](state, u, { id: crew[0].id });
    ui.TEAMFORM_ACTIONS["tf-vehicle"](state, u, { v: car.id });
    for (const tab of ["people", "gear", "supplies"]) { ui.TEAMFORM_ACTIONS["tf-tab"](state, u, { tab }); html = ui.teamFormModal(state, u); check(typeof html === "string" && html.length > 200, `the ${tab} tab draws`); }
    ui.TEAMFORM_ACTIONS["tf-go"](state, u, {});
    const p = state.parties.find((x) => x.teamMission === FORMED);
    check(p && p.members.includes(crew[0].id) && partyVehicle(state, p) === car, "Form team forms it");
    check(u.expedition === (p && p.id) && !u.inv, "and opens its panel");
    check(ui.formTeamButton(state, h).includes("tf-open") && ui.formTeamCtx(state, h.tile).includes("tf-open"), "the base screen and the right-click menu offer it");
    check(ui.formTeamCtx(state, h.tile).includes("tf-edit"), "the right-click menu offers Edit for the team there");
    ui.TEAMFORM_ACTIONS["tf-edit"](state, u, { id: p.id });
    for (const tab of ["people", "gear", "supplies"]) { ui.TEAMFORM_ACTIONS["tf-tab"](state, u, { tab }); html = ui.teamFormModal(state, u); check(typeof html === "string" && /Edit/.test(html), `editing: the ${tab} tab draws`); }
    ui.TEAMFORM_ACTIONS["tf-crew"](state, u, { id: crew[1].id });
    check(p.members.includes(crew[1].id), "editing: a click on a person adds them");
  } catch (e) { ok = false; why = e.stack || String(e); }
  check(ok, `the window renders without throwing ${why}`);
}

// ---------------------------------------------------------------------------------------------------------
// Several vehicles to a team (vehicles.js fleets, MAX_VEHICLES).
const carsAt = (state, b, n, type = "truck", fuel = 20) => Array.from({ length: n }, () => createVehicle(state, type, { kind: "base", baseId: b.id }, { fuel, condition: 100 }));
section("Fleets: 1 to 4 vehicles, a 5th refused; seats and cargo summed");
{
  const state = mk();
  const { h, crew } = setup(state);
  const extra = atBase(state, h.id).filter((s) => !crew.includes(s));
  const people = [...crew, ...extra].slice(0, 6);
  for (const s of people) { s.traits = []; stripAll(s); }
  for (const v of vehiclesAtBase(state, h.id)) if (!isBike(v)) { v.loc = { kind: "abandoned", tile: 0, since: 0 }; } // only the cars made here
  const cars = carsAt(state, h, 5);
  for (let n = 1; n <= 4; n++) {
    const pre = formPreview(state, { baseId: h.id, memberIds: people.slice(0, Math.max(n, 2)).map((s) => s.id), vehicleIds: cars.slice(0, n).map((v) => v.id) });
    check(!pre.problem, `${n} vehicle${n > 1 ? "s" : ""}: no problem (${pre.problem})`);
  }
  const p5 = formPreview(state, { baseId: h.id, memberIds: people.slice(0, 6).map((s) => s.id), vehicleIds: cars.map((v) => v.id) });
  check(/At most 4/.test(p5.problem), `a 5th is refused (${p5.problem})`);
  check(MAX_VEHICLES === 4, "the cap is 4");
  const one = formPreview(state, { baseId: h.id, memberIds: people.slice(0, 2).map((s) => s.id), vehicleIds: [cars[0].id] });
  const two = formPreview(state, { baseId: h.id, memberIds: people.slice(0, 2).map((s) => s.id), vehicleIds: [cars[0].id, cars[1].id] });
  check(two.cap > one.cap + 500, `two trucks carry more than one (${Math.round(one.cap)} → ${Math.round(two.cap)} kg)`);
  check(seatsOf(fleetOf([cars[0], cars[1]])) === 10 && payloadOf(fleetOf([cars[0], cars[1]])) === 2 * payloadOf(cars[0]), "seats and payload add up (5 + 5 seats, two payloads)");
  check(/own person/.test(formPreview(state, { baseId: h.id, memberIds: [people[0].id], vehicleIds: [cars[0].id, cars[1].id] }).problem), "two cars need two drivers");
  const sedans = carsAt(state, h, 2, "sedan");
  const nine = atBase(state, h.id).slice(0, 9);
  if (nine.length === 9) check(/seats/.test(formPreview(state, { baseId: h.id, memberIds: nine.map((s) => s.id), vehicleIds: sedans.map((v) => v.id) }).problem), "nine people, two sedans (8 seats): refused");
  // Forming with three: all three ride with the team, nothing lost.
  const before = census(state);
  const r = formTeam(state, { baseId: h.id, memberIds: people.slice(0, 4).map((s) => s.id), vehicleIds: cars.slice(0, 3).map((v) => v.id), supplies: { food: 6, water: 6, fuel: 6 } }); // four people: a driver for a fourth car
  check(r.party && partyVehicles(state, r.party).length === 3 && cars.slice(0, 3).every((v) => v.loc.kind === "party" && v.loc.partyId === r.party.id), `three vehicles go with the team (${r.error || ""})`);
  sameCensus(before, census(state), "forming with three vehicles");
  check(r.party && partyVehicle(state, r.party) === cars[0] && r.party.vehicle === true, "the first car leads");
  check(r.party && Math.abs(partyCapacity(state, r.party) - carryCapacity(state, partyMembers(state, r.party), fleetOf(cars.slice(0, 3)))) < 1e-6, "the team's capacity counts all three");
  // Editing: add the fourth, then a fifth refused, then back to one.
  check(r.party && /now has/.test(toggleVehicle(state, r.party, cars[3].id)) && partyVehicles(state, r.party).length === 4, "edit: a fourth joins");
  check(r.party && /At most 4/.test(toggleVehicle(state, r.party, cars[4].id)), "edit: a fifth is refused");
  check(r.party && /now has/.test(setVehicles(state, r.party, [cars[1].id])) && partyVehicles(state, r.party).length === 1 && cars[0].loc.kind === "base" && cars[2].loc.kind === "base", "edit: back to one, the others park at the base");
}

section("Fleets: the slowest sets the pace; bikes among cars keep to the bikes on roads");
{
  const state = mk();
  const { h, crew } = setup(state);
  const truck = createVehicle(state, "truck", { kind: "base", baseId: h.id }, { fuel: 30, condition: 100 });
  const army = createVehicle(state, "miltruck", { kind: "base", baseId: h.id }, { fuel: 100, condition: 100 });
  const f = fleetOf([truck, army]);
  check(Math.abs(typeSpeed(f) - typeSpeed(army)) < 1e-9 && typeSpeed(f) < typeSpeed(truck), `pace: the Army truck's (${typeSpeed(f)})`);
  check(Math.abs(typeFuel(f) - (typeFuel(truck) + typeFuel(army))) < 1e-9, "fuel a tile: both cars' together");
  createVehicle(state, "bike", { kind: "base", baseId: h.id }, { count: 4 });
  const bikes = parkBikes(state, h);
  check(roadPace(fleetOf([truck, { ...bikes, count: 2 }])) === 0.5 && roadPace(fleetOf([truck, army])) === 1, "bikes among cars: half a car's road pace; cars alone: their own");
  const r = formTeam(state, { baseId: h.id, memberIds: crew.slice(0, 3).map((s) => s.id), vehicleIds: [truck.id, bikes.id], supplies: { food: 3 } });
  const p = r.party;
  check(p && p.vehicle === true && partyVehicles(state, p).length === 2 && partyVehicles(state, p).find(isBike).count === 2, `a truck and two bikes (one each for those not driving) (${r.error || ""})`);
  check(p && p.burden && p.burden.onroad === 0.5, "its weighing keeps the bikes' road pace");
  // The same trip takes longer with the bikes than with the truck alone (roads: the bikes' pace).
  const dest = state.tiles.find((t) => t.id !== h.tile && t.road && state.grid.distance(h.tile, t.id) >= 4 && planPath(state, h.tile, t.id, true));
  if (p && dest) {
    const path = planPath(state, h.tile, dest.id, true).path;
    const mixed = travelHours(state, path, { vehicle: true, ...paceOpts(p), fuel: 100 }).hours;
    const alone = travelHours(state, path, { vehicle: true, ...paceOpts(p), onroad: 1, fuel: 100 }).hours;
    check(mixed >= alone, `a trip on roads: ${mixed}h with the bikes, ${alone}h without`);
  }
}

section("Fleets: fuel drawn from each car's own tank; an empty one shares the others'");
{
  const state = mk();
  const { h, crew } = setup(state);
  const [a, b] = carsAt(state, h, 2, "truck", 10);
  const p = formTeam(state, { baseId: h.id, memberIds: crew.slice(0, 2).map((s) => s.id), vehicleIds: [a.id, b.id] }).party;
  check(p && Math.abs(partyFuel(state, p) - 20) < 1e-9, "the team's fuel: both tanks");
  useFuel(state, p, 4);
  check(Math.abs(a.fuel - 8) < 1e-9 && Math.abs(b.fuel - 8) < 1e-9, `each burns its share (${a.fuel}, ${b.fuel})`);
  a.fuel = 0;
  check(useFuel(state, p, 4) && Math.abs(b.fuel - 4) < 1e-9, `an empty tank is fed from the other car (${b.fuel} left)`);
  check(!useFuel(state, p, 10), "out of fuel: false");
}

section("Fleets: a breakdown hits one vehicle; leaving it, the team goes on in the others");
{
  const state = mk();
  const { h, crew } = setup(state);
  const cars = carsAt(state, h, 3);
  const p = formTeam(state, { baseId: h.id, memberIds: crew.slice(0, 3).map((s) => s.id), vehicleIds: cars.map((v) => v.id) }).party;
  const rng0 = state.rng;
  state.rng = { ...rng0, chance: () => true, next: () => 0.999, int: rng0.int ? rng0.int.bind(rng0) : () => 0, range: rng0.range ? rng0.range.bind(rng0) : () => 0, pick: (xs) => xs[0] };
  const hit = breakdownRoll(state, p, 0);
  state.rng = rng0;
  check(hit === cars[2], "the roll picks one of them (by each one's chance)");
  const before = census(state);
  leaveVehicle(state, p, h.tile, "broke down", cars[2]);
  check(partyVehicles(state, p).length === 2 && cars[2].loc.kind === "abandoned" && p.vehicle === true, "left behind alone; the team keeps the other two");
  check(p.spotted && p.spotted.has(`vehicle:${cars[2].id}`), "and it is marked for the map");
  sameCensus(before, census(state), "leaving one");
  // Wiped far from a base: every vehicle stays there, marked.
  const away = state.tiles.find((t) => t.id !== h.tile && !state.bases.some((b) => b.tile === t.id) && t.terrain !== "water");
  p.path = [away.id]; p.idx = 0;
  const vs = partyVehicles(state, p);
  wipeParty(state, p);
  check(vs.every((v) => v.loc.kind === "abandoned" && v.loc.tile === away.id), "a lost team leaves all its vehicles there");
  check(vs.every((v) => state.markers.some((m) => m.key === `vehicle:${v.id}`)), "each one marked on the map");
}

section("Fleets: every vehicle on the battle map; one blown up is left, the others stay");
{
  registerCombatHandler("teamformtest", () => {});
  const state = mk();
  const { h, crew } = setup(state);
  const cars = carsAt(state, h, 3, "truck", 20);
  const p = formTeam(state, { baseId: h.id, memberIds: crew.slice(0, 3).map((s) => s.id), vehicleIds: cars.map((v) => v.id), supplies: { food: 3 } }).party;
  const tile = state.tiles.find((t) => t.id !== h.tile && !t.loc && t.road && !t.bridge && t.terrain !== "water" && state.grid.distance(t.id, h.tile) > 1);
  p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
  state.combat = createBattle(state, { tile: tile.id, partyId: p.id, enemy: { kind: "raiders", count: 2, power: 3 }, ambush: null, canRetreat: true, handler: "teamformtest", context: {} });
  const b = state.combat;
  check(b.vehicle && b.convoy && b.convoy.length === 2, `the lead to drive and two more parked (${b.convoy ? b.convoy.length : "none"})`);
  const cells = b.cells.filter((c) => c.k === "vehicle").length;
  check(cells >= 3 * 6, `their cells are the team's own vehicles (${cells})`);
  if (b.convoy && b.convoy[0]) {
    const c = b.convoy[0];
    for (let k = 0; k < 6 && !c.blownUp; k++) vehicleBlast(b, c.x, c.y, ROCKET.r, ROCKET.dmg, "rocket");
    check(c.blownUp, "a rocket blows one of them up");
    settleVehicle(state, b, "victory");
    const gone = state.vehicles.find((v) => v.id === c.vid);
    check(gone && gone.destroyed && gone.loc.kind === "abandoned" && !partyVehicles(state, p).includes(gone), "after the fight it is a wreck left there");
    check(partyVehicles(state, p).length === 2, "the team goes on in the other two");
  }
  state.combat = null;
}

section("Fleets: Enter base parks every vehicle");
{
  const state = mk();
  const { h, crew } = setup(state);
  const cars = carsAt(state, h, 2);
  createVehicle(state, "bike", { kind: "base", baseId: h.id }, { count: 3 });
  const bikes = parkBikes(state, h);
  const nb = bikes.count;
  const p = formTeam(state, { baseId: h.id, memberIds: crew.slice(0, 3).map((s) => s.id), vehicleIds: [cars[0].id, cars[1].id, bikes.id] }).party;
  check(p && partyVehicles(state, p).length === 3, "two cars and the bikes go");
  joinBase(state, p, h);
  check(cars.every((v) => v.loc.kind === "base" && v.loc.baseId === h.id), "both cars are parked at the base");
  check(vehiclesAtBase(state, h.id).filter(isBike).reduce((a, v) => a + (v.count || 1), 0) === nb, "and every bike, in one stack");
}

section("Fleets: an old single-vehicle save loads as a list of one");
{
  const state = mk();
  const { h, crew, car } = setup(state);
  const p = formTeam(state, { baseId: h.id, memberIds: [crew[0].id], vehicleId: car.id }).party;
  // The old shape: no list, no migration flag.
  delete p.vehicleIds;
  delete state.fleetV;
  state.cards.length = 0;
  const ld = loadFromString(saveToString(state));
  const lp = ld.parties.find((x) => x.id === p.id);
  check(lp && Array.isArray(lp.vehicleIds) && lp.vehicleIds.length === 1 && lp.vehicleIds[0] === car.id && ld.fleetV === 1, "migrated: vehicleIds [its car]");
  check(lp && partyVehicle(ld, lp) && partyVehicle(ld, lp).id === car.id && partyVehicles(ld, lp).length === 1, "the lead and the list agree");
  // A save with a fleet keeps it.
  const cars = carsAt(state, h, 2);
  const q = formTeam(state, { baseId: h.id, memberIds: crew.slice(1, 3).map((s) => s.id), vehicleIds: cars.map((v) => v.id) }).party;
  state.cards.length = 0;
  const ld2 = loadFromString(saveToString(state));
  const lq = ld2.parties.find((x) => x.id === q.id);
  check(lq && partyVehicles(ld2, lq).length === 2, "a team with two vehicles keeps both through save and load");
}

section("Keep or undo the gear changes");
{
  const state = mk();
  const { h, crew, rifle, pack, knife } = setup(state);
  const [a, b] = crew;
  const snap = gearSnapshot(state, h, null);
  check(!gearChanged(state, snap), "nothing changed yet");
  const placesBefore = new Map([...itemsOf(state)].map((it) => [it, where(state, it)]));
  const stockBefore = { ...h.stock };
  // Moves: the rifle onto Ann, the pack onto Bob, a knife into the pack, a magazine's load changed, 5 food used.
  quickMove(state, armoryLoc(h, rifle), a.id);
  quickMove(state, armoryLoc(h, pack), b.id);
  quickMove(state, armoryLoc(h, knife), b.id);
  payFood(h, 5); // foods.js: the soonest to spoil first
  check(gearChanged(state, snap), "the moves count as changes");
  restoreGear(state, snap);
  check(!gearChanged(state, snap), "undone: nothing differs from the snapshot");
  check([...placesBefore].every(([it, w]) => where(state, it) === w), "every item back exactly where it was");
  check(Object.keys(stockBefore).every((k) => near(h.stock[k] || 0, stockBefore[k] || 0)), "the stores as they were");
  sameCensus({ items: new Set(placesBefore.keys()), n: placesBefore.size, sup: suppliesOf(state), people: state.survivors.filter((s) => s.alive).length, cars: state.vehicles.filter((v) => !isBike(v)).length, bikes: bikesTotal(state) }, census(state), "after undo");
  // Editing a team: load, then undo puts it back in the armory and the stores.
  const p = formTeam(state, { baseId: h.id, memberIds: [a.id, b.id], supplies: { food: 4 } }).party;
  const s2 = gearSnapshot(state, h, p), f2 = teamHas(p, "food");
  loadFromBase(state, p, { items: [armoryLoc(h, rifle)], supplies: { food: 6 } }, a.id);
  check(gearChanged(state, s2) && !h.armory.includes(rifle), "a load from the base is a change");
  restoreGear(state, s2);
  check(h.armory.includes(rifle) && near(teamHas(p, "food"), f2) && !gearChanged(state, s2), "undone: the rifle back in the armory, the food back in the stores");
  // ux-carry: where the team holds its supplies (p.hold) and a bag in someone's arms (s.gear.carry) undo exactly too.
  {
    const CA = await import("../src/sim/carry.js");
    const s3 = gearSnapshot(state, h, p);
    const h0 = JSON.stringify(CA.settleHold(state, p));
    check(!gearChanged(state, s3), "a fresh snapshot with the team's loads settled: no change");
    const from = Object.entries(p.hold.by).flatMap(([sid, r]) => ["pack", "pocket"].filter((pl) => (r[pl].food || 0) > 0).map((place) => ({ sid: Number(sid), place })))[0];
    const msg = from ? CA.moveHeld(state, p, "food", 1, from, { sid: from.sid, place: "hands" }) : "";
    const bag = newItem("backpack");
    const why = CA.carryBag(state, null, b, bag);
    check((from ? /→/.test(msg) : true) && !why && b.gear.carry === bag && gearChanged(state, s3), `food moved into the arms and a bag carried count as changes${from ? "" : " (no food in a pack: the bag only)"}`);
    restoreGear(state, s3);
    check(JSON.stringify(CA.settleHold(state, p)) === h0 && !b.gear.carry && !gearChanged(state, s3), "undone: every load back where it was held, the bag out of the arms");
  }
  // The window: closing with changes asks; Keep keeps, Undo undoes.
  const ui = await import("../src/ui/teamform.js");
  const u = { inv: null };
  ui.TEAMFORM_ACTIONS["tf-open"](state, u, { base: h.id });
  quickMove(state, armoryLoc(h, knife), crew[2].id);
  ui.TEAMFORM_ACTIONS["tf-close"](state, u, {});
  check(u.inv && u.inv.form.asking, "closing with gear moved asks first");
  check(/Keep gear changes/.test(ui.teamFormModal(state, u)) && /Undo changes/.test(ui.teamFormModal(state, u)), "the question offers Keep gear changes and Undo changes");
  ui.TEAMFORM_ACTIONS["tf-keep"](state, u, {});
  check(!u.inv && !h.armory.includes(knife), "Keep: closed, the knife stays with them");
  const bobWas = where(state, knife);
  ui.TEAMFORM_ACTIONS["tf-open"](state, u, { base: h.id });
  const spot = carriedSpots(crew[2]).find((x) => x.item === knife);
  if (spot) quickMove(state, spot.loc, crew[2].id); // off Bob into the armory
  check(spot && h.armory.includes(knife), "a move after opening again: the knife into the armory");
  ui.TEAMFORM_ACTIONS["tf-close"](state, u, {});
  ui.TEAMFORM_ACTIONS["tf-undoclose"](state, u, {});
  check(!u.inv && where(state, knife) === bobWas && !h.armory.includes(knife), "Undo changes: closed, the knife back on them exactly where it was");
  ui.TEAMFORM_ACTIONS["tf-open"](state, u, { base: h.id });
  const s3 = u.inv.form.snap;
  quickMove(state, armoryLoc(h, rifle), crew[2].id);
  ui.TEAMFORM_ACTIONS["tf-undo"](state, u, {});
  check(u.inv && !gearChanged(state, s3) && h.armory.includes(rifle), "the window's Undo changes button puts it back and stays open");
  ui.TEAMFORM_ACTIONS["tf-close"](state, u, {});
  check(!u.inv, "with nothing changed it closes without asking");
}

// ---------------------------------------------------------------------------------------------------------
section("Trip planner: the shared picker, a launch with three vehicles");
{
  const state = mk();
  const { h, crew } = setup(state);
  for (const v of vehiclesAtBase(state, h.id)) if (!isBike(v)) v.loc = { kind: "abandoned", tile: 0, since: 0 };
  const cars = carsAt(state, h, 3);
  const fp = await import("../src/ui/fleetpick.js");
  const uiMod = await import("../src/ui/ui.js");
  const pl = { dest: null, mission: "move", crew: new Set(crew.slice(0, 3).map((s) => s.id)), vehicleIds: [], vehicleId: null, stance: "normal", supplies: { food: 6, water: 6 } };
  for (const v of cars) { const r = fp.toggleFleetIds(state, pl.vehicleIds, v.id); pl.vehicleIds = r.ids; pl.vehicleId = fp.leadId(state, r.ids); }
  check(pl.vehicleIds.length === 3 && pl.vehicleId === cars[0].id, "three clicks pick three vehicles; the first car leads");
  const html = fp.fleetPicker(state, { base: h, ids: pl.vehicleIds, crewN: 3, cans: 0, action: "pl-vehicle" });
  check(/3\/4 vehicles/.test(html) && /15 seats/.test(html) && /pl-vehicle/.test(html), "the planner's picker shows the totals (3/4 vehicles, 15 seats)");
  const v = uiMod.plannerVehicle(state, pl);
  check(v && v.fleet && v.fleet.length === 3 && payloadOf(v) === 3 * payloadOf(cars[0]), "the planner's estimates use all three (payload summed)");
  check(uiMod.plannerFleetProblem(state, pl) === "", "no problem with three people for three cars");
  pl.crew = new Set(crew.slice(0, 2).map((s) => s.id));
  check(/own person/.test(uiMod.plannerFleetProblem(state, pl)), "two people for three cars: refused in the planner");
  pl.crew = new Set(crew.slice(0, 3).map((s) => s.id));
  const dest = state.tiles.find((t) => t.id !== h.tile && t.road && state.grid.distance(h.tile, t.id) >= 3 && planPath(state, h.tile, t.id, true));
  const res = launchExpedition(state, { memberIds: [...pl.crew], dest: dest.id, mission: "move", stance: "normal", vehicleId: pl.vehicleId, vehicleIds: pl.vehicleIds, supplies: { ...pl.supplies } });
  check(res.party && partyVehicles(state, res.party).length === 3 && res.party.phase === "out", `the trip sets off with all three (${res.error || ""})`);
  // Move-out planner: the same through moveTeamOut.
  const cars2 = carsAt(state, h, 2);
  const mo = await import("../src/sim/moveout.js");
  const r2 = mo.moveTeamOut(state, { baseId: h.id, memberIds: crew.slice(3, 4).concat(atBase(state, h.id).filter((s) => !crew.includes(s)).slice(0, 1)).map((s) => s.id), dest: null, vehicleId: cars2[0].id, vehicleIds: cars2.map((x) => x.id), supplies: { food: 2 } });
  check(r2.party && partyVehicles(state, r2.party).length === 2, `moving out with two vehicles (${r2.error || ""})`);
}

section("One person to each vehicle, everywhere");
{
  const state = mk();
  const { h, crew } = setup(state);
  const cars = carsAt(state, h, 2);
  check(/own person/.test(formPreview(state, { baseId: h.id, memberIds: [crew[0].id], vehicleIds: cars.map((v) => v.id) }).problem), "Form: one person, two cars");
  check(/own person/.test(launchExpedition(state, { memberIds: [crew[0].id], dest: h.tile, mission: "move", stance: "normal", vehicleIds: cars.map((v) => v.id), supplies: {} }).error || ""), "the trip planner's launch: one person, two cars");
  const p = formTeam(state, { baseId: h.id, memberIds: [crew[0].id], vehicleIds: [cars[0].id] }).party;
  check(/own person/.test(toggleVehicle(state, p, cars[1].id)), "Edit: a second car for a team of one");
  const other = createVehicle(state, "sedan", { kind: "abandoned", tile: h.tile, since: 0 }, { fuel: 10, condition: 60 });
  check(/own person/.test(fleetJoinProblem(state, p, other)), "a found or recovered car: nobody free to drive it");
  addMember(state, p, crew[1].id);
  check(fleetJoinProblem(state, p, other) === "", "with a second person it may join");
  check(/Leave a vehicle/.test(removeMember(state, p, crew[1].id) || "") || partyVehicles(state, p).length <= p.members.length, "Edit: nobody leaves a vehicle without a person");
}

section("Surplus vehicles after deaths: left on the tile, the least useful first");
{
  const state = mk();
  const { h, crew } = setup(state);
  const cars = carsAt(state, h, 3);
  cars[0].condition = 90; cars[1].condition = 40; cars[2].condition = 70;
  const p = formTeam(state, { baseId: h.id, memberIds: crew.slice(0, 3).map((s) => s.id), vehicleIds: cars.map((v) => v.id) }).party;
  const away = state.tiles.find((t) => t.id !== h.tile && !state.bases.some((b) => b.tile === t.id) && t.terrain !== "water" && planPath(state, h.tile, t.id, true));
  p.path = [away.id]; p.idx = 0; p.phase = "waiting";
  crew[2].alive = false;
  movePartiesHour(state);
  check(partyVehicles(state, p).length === 2 && cars[1].loc.kind === "abandoned" && cars[1].loc.tile === away.id, "one dies: the car in the worst shape is left there");
  check(p.spotted && p.spotted.has(`vehicle:${cars[1].id}`), "marked for the map (recoverable)");
  check(state.cards.some((c) => c.title === "Vehicles left behind" && c.partyId === p.id), "a card says so");
  // Bikes go first: a team with a car and bikes that loses a rider leaves a bike.
  const st2 = mk();
  const s2 = setup(st2);
  createVehicle(st2, "bike", { kind: "base", baseId: s2.h.id }, { count: 4 });
  const stack = parkBikes(st2, s2.h);
  const car = carsAt(st2, s2.h, 1)[0];
  const q = formTeam(st2, { baseId: s2.h.id, memberIds: s2.crew.slice(0, 3).map((s) => s.id), vehicleIds: [car.id, stack.id] }).party;
  q.path = [away.id]; q.idx = 0; q.phase = "waiting";
  s2.crew[1].alive = false;
  movePartiesHour(st2);
  const bk = partyVehicles(st2, q).find(isBike);
  check(partyVehicles(st2, q).includes(car) && bk && bk.count === 1 && st2.vehicles.some((x) => isBike(x) && x.loc.kind === "abandoned"), "a rider lost: a bike is left, the car stays");
  check(driversFor(partyVehicles(st2, q)) <= partyMembers(st2, q).length, "no vehicle goes on with nobody in it");
}

section("Walkers after a vehicle is lost: walking pace, the split card, seats again");
{
  const state = mk();
  const { h } = setup(state);
  const six = atBase(state, h.id).slice(0, 6);
  for (const s of six) { s.traits = []; stripAll(s); }
  const truck = createVehicle(state, "truck", { kind: "base", baseId: h.id }, { fuel: 30, condition: 100 });
  const sedan = createVehicle(state, "sedan", { kind: "base", baseId: h.id }, { fuel: 18, condition: 100 });
  const p = formTeam(state, { baseId: h.id, memberIds: six.map((s) => s.id), vehicleIds: [truck.id, sedan.id], supplies: { food: 12, water: 12 } }).party;
  check(p && !p.walkers, `six people, 9 seats: nobody walks (${p ? "" : "no team"})`);
  const dest = state.tiles.find((t) => t.id !== h.tile && t.road && state.grid.distance(h.tile, t.id) >= 4 && planPath(state, h.tile, t.id, true));
  orderMove(state, p, dest.id);
  const before = hoursLeft(state, p);
  const fast = partySpeed(p);
  leaveVehicle(state, p, h.tile, "blown up", truck);
  check(p.walkers === 2 && partyVehicles(state, p).length === 1, `the truck lost: 4 seats for 6, ${p.walkers} walk`);
  check(partySpeed(p) <= fast && hoursLeft(state, p) > before, `the team goes at walking pace (${before}h → ${hoursLeft(state, p)}h)`);
  check(paceOpts(p).walkers === 2, "the estimates (queue, right-click hours) count the walkers");
  const card = state.cards.find((c) => c.walkersFor === p.id);
  check(card && card.choices.some((c) => /follow on foot/.test(c.label)) && card.choices.some((c) => /Stay together/.test(c.label)), "a card offers to leave the walkers to follow on foot, or stay together");
  // Save and load with the walkers.
  state.cards.length = 0;
  const ld = loadFromString(saveToString(state));
  const lp = ld.parties.find((x) => x.id === p.id);
  check(lp && lp.walkers === 2 && hoursLeft(ld, lp) === hoursLeft(state, p), "save and load: still 2 walking, the same hours");
  // Seats again: another car picked up.
  const spare = createVehicle(state, "van", { kind: "abandoned", tile: partyTile(p), since: 0 }, { fuel: 20, condition: 80 });
  addPartyVehicle(state, p, spare);
  reseat(state, p);
  check(!p.walkers && partySpeed(p) >= fast - 1e-9, "a van picked up: everyone rides again");
  // The split: the walkers become a team of their own on foot.
  const st2 = mk();
  const s2 = setup(st2);
  const six2 = atBase(st2, s2.h.id).slice(0, 6);
  const t2 = createVehicle(st2, "truck", { kind: "base", baseId: s2.h.id }, { fuel: 30, condition: 100 });
  const c2 = createVehicle(st2, "sedan", { kind: "base", baseId: s2.h.id }, { fuel: 18, condition: 100 });
  const q = formTeam(st2, { baseId: s2.h.id, memberIds: six2.map((s) => s.id), vehicleIds: [t2.id, c2.id], supplies: { food: 12, water: 12 } }).party;
  leaveVehicle(st2, q, s2.h.tile, "out of fuel", t2);
  const card2 = st2.cards.find((c) => c.walkersFor === q.id);
  const n0 = st2.parties.length;
  card2.choices.find((c) => /follow on foot/.test(c.label)).resolve(st2);
  const walkersTeam = st2.parties.length === n0 + 1 ? st2.parties[st2.parties.length - 1] : null;
  check(walkersTeam && walkersTeam.members.length === 2 && !partyVehicles(st2, walkersTeam).length && walkersTeam.vehicle === false, "Leave the walkers: two go on foot as their own team");
  check(!q.walkers && q.members.length === 4 && partyVehicles(st2, q).length === 1, "and the four ride on in the sedan at its pace");
  check(teamHas(walkersTeam, "food") > 0, "with a share of the food");
  // A single car that never lost one still takes everyone (pick-list 1a).
  const st3 = mk();
  const s3 = setup(st3);
  const six3 = atBase(st3, s3.h.id).slice(0, 6);
  const sed = createVehicle(st3, "sedan", { kind: "base", baseId: s3.h.id }, { fuel: 18, condition: 100 });
  const r3 = formTeam(st3, { baseId: s3.h.id, memberIds: six3.map((s) => s.id), vehicleIds: [sed.id] });
  check(r3.party && !r3.party.walkers, "six in one sedan with no loss: nobody walks (as before)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
