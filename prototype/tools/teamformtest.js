// Headless checks for forming a team at a base and changing it there (sim/teamform.js, ui/teamform.js): forming moves
// the people, the vehicle (a car, or bikes one each), the supplies and the cargo items out of the base and onto the
// team with nothing duplicated or lost (every item object and every supply counted before and after); the team waits
// on the base's tile with no mission, in contact, with orders; refusals (nobody picked, too heavy, a car with no fuel,
// someone not at the base, too few bikes); editing at the base (add and remove people, swap the vehicle, set supplies,
// load and drop off gear) with the same totals kept; Enter base disbands it back in; a save and load round trip of a
// waiting formed team (and editing it after the load); and a render smoke test of the window and its buttons.
// Usage: node tools/teamformtest.js [seed]
import { createWorld, hub, atBase, survivorById } from "../src/sim/world.js";
import { partyTile, partyMembers, poolLoad, partyCapacity, teamName, orderOptions, MISSIONS } from "../src/sim/parties.js";
import { vehiclesAtBase, vehicleById, partyVehicle, isBike, createVehicle, parkBikes } from "../src/sim/vehicles.js";
import { newItem, stripAll, allCarried, itemLoad, packOf } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { SUPPLIES } from "../src/sim/data.js";
import { contactable } from "../src/sim/orders.js";
import { enterOption, joinBase } from "../src/sim/moveout.js";
import { loadFromBase, dropOff } from "../src/sim/teaminv.js";
import { formTeam, formPreview, editBase, editProblem, editableTeams, addMember, removeMember, setVehicle, setSupply, teamHas, FORMED } from "../src/sim/teamform.js";

const SEED = Number(process.argv[2] || 42);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 5 });
  state.started = true;
  state.noWanderers = true;
  Object.assign(hub(state).stock, { food: 300, water: 300, fuel: 100, meds: 20, parts: 10, scrap: 100, a_9mm_fmj: 200, a_556_fmj: 120 });
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
  check(teamHas(p, "food") === 10 && teamHas(p, "a_556_fmj") === 30 && teamHas(p, "fuel") === 5, "the supplies were packed");
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
  check(/food/.test(setSupply(state, p, "food", 20)) && near(teamHas(p, "food"), 20), "load more food (20)");
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
