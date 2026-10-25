// The starting vehicles and their backs (sim/startfleet.js; 2026-10-24, user request: "add a new customize to the
// starting vehicle(s): you can set how many, which kind of vehicle and what items are loaded in the vehicle. The items can
// be any item and material in the game. You can set a point limit for each vehicle and hit random to fill the vehicle
// with items up to that point limit. Make this how to set vehicles in normal and hardcore mode").
//   1. the fleet made safe: a slot a starting survivor in every mode (the first with the initial vehicle, the rest
//      empty; any slot any motor kind, null: rolled by whose it is, every mode since 2026-10-25), each a point limit
//      (0–1000) and a back (null: as rolled);
//   2. Start with a vehicle off in Normal, Hardcore and Custom: no starting vehicle, no section; Custom's counts (12
//      survivors, the all-ones corner) build with several vehicles;
//   3. Custom: several vehicles of the kinds set, all at the hub, each back unloaded into the hub on day 1 (any thing and
//      any material, foods, rounds past 300); Normal and Hardcore keep START_TRUNK's caps (the materials among them, 2026-10-24);
//      each named and rolled by whose it is (its kind, tank, condition and a dice back, unloaded unless a back is set);
//      ＋ Add a vehicle (as rolled in the first free slot, up to one a survivor), Remove (the list closes up; Hardcore's
//      car slot kept free, the button at the top), Normal's rolled vehicle changed for another kind;
//   4. Normal and Hardcore with no backs set: the same world as before (the dice untouched); Hardcore's back set goes in
//      place of the dice's, As rolled brings the dice's back;
//   5. Random fills a back up to its point limit and within its room (Normal, Hardcore, Custom; the screen's 🎲 Random,
//      Randomize everything's every vehicle);
//   6. the backs are on nobody's points: the bill, Start's refusal names the vehicle over its limit or room;
//   7. the screen: the Starting vehicles section (hidden with the box off), its backs under Customize alone, Ironman read-only,
//      each mode its own fleet, save and load of a Custom run during the screen, main.js wiring.
// Usage: node tools/startfleettest.js
import { readFileSync } from "node:fs";
import { createWorld } from "../src/sim/world.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { START_FLEET, fleetKinds, cleanFleet, fitFleet, defaultFleet, resizeFleet, clampLimit, fleetRoom, fleetText, fleetProblems, fleetName, fleetVehicle, ridesIn } from "../src/sim/startfleet.js";
import { sanitizeStartVehicle, trunkKg, START_TRUNK, clearStartGear } from "../src/sim/startgear.js";
import { vehiclePoints, pricePerson, bgBacks, bgCarBack, suppliesPoints, loosePoints } from "../src/sim/custompoints.js";
import { randomTrunk } from "../src/sim/randomkit.js";
import { VEHICLE_TYPES } from "../src/sim/vehicles.js";
import { HC_START } from "../src/sim/hardcore-start.js";
import { isCustomRun } from "../src/sim/custommode.js";
import { Rng } from "../src/sim/rng.js";
import { newRunScreen, blankCrew, randomizeEverything, stashModeSet, takeModeSet } from "../src/ui/newgame.js";
import { SG_ACTIONS, SG_CHANGE, fleetEditor, fleetSection, startGearEditor } from "../src/ui/startgear.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
const SMALL = { people: 4, groups: 3, hives: 3, cities: 1, towns: 6, military: 1 }; // a quick Custom map
const hub = (s) => s.bases.find((b) => b.type === "hub");
const UI = (extra = {}) => ({ started: false, freeEdit: false, ironman: false, worldSize: "normal", factionCount: 5, nrMsg: "", ...extra });
const el = (value, dataset = {}) => ({ value: String(value), dataset });
const empty = (V) => !V || (!V.items.length && !Object.keys(V.supplies).length);
const kindWord = (type) => { const n = VEHICLE_TYPES[type].name; return /^[A-Z]{2,}\b/.test(n) ? n : n.toLowerCase(); }; // "work van", "SUV"
const reEsc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

section("1. The fleet made safe");
{
  check(cleanFleet(null, "normal").length === 1 && cleanFleet(null, "normal")[0].type === null && cleanFleet(null, "normal")[0].limit === START_FLEET.LIMIT && cleanFleet(null, "normal")[0].load === null, "Normal: one vehicle, its kind as rolled (null), the default limit, its back as rolled");
  check(cleanFleet([{ type: "van" }, { type: "suv" }], "normal").map((f) => f.type).join() === "van,suv" && cleanFleet([{ type: "van", empty: true, load: { supplies: { water: 5 } } }], "normal")[0].empty && cleanFleet([{ empty: true, load: { supplies: { water: 5 } } }], "normal")[0].load === null, "Normal: the slots as given, any kind (the pickup may be changed); an empty slot stays empty, with no back");
  check(cleanFleet([{}, {}], "hardcore").map((f) => f.type).join() === "," && cleanFleet([{ type: "van" }, { type: "suv" }], "hardcore").map((f) => f.type).join() === "van,suv", "Hardcore: every slot as rolled (null) unless a kind is set (the car and, since 2026-10-25, the rest)");
  check(fitFleet([{ type: "van" }], 4, "custom").length === 4 && fitFleet([{ type: "van" }], 4, "custom").slice(1).every((f) => f.empty && f.type === "truck") && fitFleet(Array.from({ length: 6 }, () => ({ type: "suv" })), 2, "normal").length === 2, "fitFleet: a slot a survivor, the ones past the list empty, the ones past the survivors dropped");
  check(cleanFleet(Array.from({ length: 30 }, () => ({})), "custom").length === START_FLEET.COUNT.MAX && cleanFleet([], "custom").length === 1, `Custom: 1–${START_FLEET.COUNT.MAX} vehicles`);
  check(JSON.stringify(cleanFleet([{ type: "bike" }, { type: "hummer" }, { type: "nonsense" }], "custom").map((f) => f.type)) === '[null,"hummer",null]', "Custom: no bicycles, no unknown kinds (as rolled in their place)");
  check(!fleetKinds().includes("bike") && ["sedan", "suv", "truck", "hummer", "van", "miltruck"].every((k) => fleetKinds().includes(k)), `the kinds: ${fleetKinds().join(", ")}`);
  check(clampLimit(-5) === 0 && clampLimit(5000) === 1000 && clampLimit("") === START_FLEET.LIMIT && clampLimit("junk") === START_FLEET.LIMIT && clampLimit(35) === 35, "the point limit: 0–1000, the default when blank");
  check(resizeFleet([{ type: "van", limit: 10, load: null }], 3).map((f) => `${f.type}:${f.limit}`).join() === "van:10,null:60,null:60" && resizeFleet(resizeFleet([], 5), 2).length === 2, "the Vehicles box: the first kept, new ones as rolled at the default limit");
  const open = sanitizeStartVehicle({ items: ["ar"], supplies: { wood: 500, stone: 40, f_rice: 6, electronics: 3, food: 200, a_9mm_fmj: 2000, ammo: 50, nonsense: 4 } }, true);
  check(open.supplies.wood === 500 && open.supplies.stone === 40 && open.supplies.f_rice === 6 && open.supplies.electronics === 3 && open.supplies.food === 200 && open.supplies.a_9mm_fmj === 2000 && !("nonsense" in open.supplies) && !("ammo" in open.supplies), `Custom's back: any material, food and rounds past ${START_TRUNK.ROUNDS} (${JSON.stringify(open.supplies)})`);
  const shut = sanitizeStartVehicle({ supplies: { wood: 5000, stone: 40, f_rice: 6, food: 200, a_9mm_fmj: 2000 } });
  check(shut.supplies.wood === START_TRUNK.SUPPLIES.wood && shut.supplies.stone === 40 && !("f_rice" in shut.supplies) && shut.supplies.food === START_TRUNK.SUPPLIES.food && shut.supplies.a_9mm_fmj === START_TRUNK.ROUNDS, "Normal and Hardcore keep START_TRUNK's caps (wood 600, stone as set, no foods by kind, food 60, rounds 300)");
  check(sanitizeStartVehicle({ items: Array(40).fill("knife") }, true).items.length === 40 && sanitizeStartVehicle({ items: Array(40).fill("knife") }).items.length === START_TRUNK.ITEMS, "Custom: more than 16 things");
  const back = { load: { supplies: { f_rice: 9, wood: 9 } } };
  check(cleanFleet([back], "custom")[0].load.supplies.f_rice === 9 && cleanFleet([back], "normal")[0].load.supplies.f_rice === undefined && cleanFleet([back], "normal")[0].load.supplies.wood === 9, "a mode's fleet takes its own kind of back (rice by kind Custom's alone; wood in every mode)");
}

section("2. Start with a vehicle off, and on");
{
  for (const [tag, opts] of [["Normal", {}], ["Hardcore", { mode: "hardcore" }], ["Custom", { custom: SMALL }]]) {
    const off = createWorld({ seed: 31, factionCount: 5, ...opts, vehicle: false, fleet: [{ type: "van", limit: 60, load: { items: [], supplies: { water: 20 } } }] });
    check(off.vehicles.length === 0 && off.fleet.length === off.survivors.length && off.fleet.every((f) => f.vid == null) && !fleetVehicle(off, 0) && !fleetText(off), `${tag} off: no starting vehicle (${off.vehicles.length}), a slot a survivor (${off.fleet.length}), nothing to refuse`);
    check(fleetSection(off, UI()) === "" && !/data-action="fleet-/.test(newRunScreen(off, UI({ mode: tag.toLowerCase() }))), `${tag} off: no Starting vehicles section`);
    const on = createWorld({ seed: 31, factionCount: 5, ...opts });
    check(on.fleet.length === on.survivors.length && !!fleetVehicle(on, 0) && on.fleet.slice(1).every((f) => f.empty && f.vid == null) && /data-action="fleet-edit"/.test(newRunScreen(on, UI({ mode: tag.toLowerCase(), freeEdit: true }))), `${tag} on: the first slot's vehicle, the rest empty (${on.fleet.length} slots), the section with Edit… under Customize`);
    const plain = newRunScreen(on, UI({ mode: tag.toLowerCase() }));
    check(/data-action="fleet-kind"/.test(plain) && /data-action="fleet-remove"/.test(plain) && /data-action="fleet-add"/.test(plain) && !/fleet-edit|fleet-rand|fleet-empty|fleet-limit|fleet-dice|Point limit|\/ \d+ pts/.test(plain), `${tag} on, Customize off: the kinds, ✕ Remove and ＋ Add a vehicle alone (no point limit, points or gear buttons)`);
  }
  const off = createWorld({ seed: 31, factionCount: 5, custom: SMALL, vehicle: false, fleet: [{ load: { supplies: { wood: 300 } } }] });
  const none = createWorld({ seed: 31, factionCount: 5, custom: SMALL, vehicle: false });
  check(hub(off).stock.wood === hub(none).stock.wood, "Custom off: a back set is not unloaded");
  const big = createWorld({ seed: 5, factionCount: 5, custom: { ...SMALL, people: 12 }, fleet: resizeFleet([], 3) });
  check(big.survivors.length === 12 && big.vehicles.filter((v) => v.loc.kind === "base").length === 3 && big.survivors.every((s) => s.gear.weapon), "Custom: 12 survivors and three vehicles, no crash");
  const ones = createWorld({ seed: 5, factionCount: 5, custom: { people: 0, groups: 0, hives: 0, cities: 0, towns: 0, military: 0 } });
  check(isCustomRun(ones) && Object.values(ones.custom).every((n) => n === 1) && ones.survivors.length === 1 && ones.fleet.length === 1 && !!fleetVehicle(ones, 0), "Custom: every count clamps to 1, one vehicle");
}

section("3. Custom: several vehicles, any thing and material");
{
  const fleet = [
    { type: "van", limit: 200, load: { items: ["crowbar", "knife"], supplies: { wood: 400, stone: 60, f_rice: 5, electronics: 2, a_9mm_fmj: 400 } } },
    { type: "hummer", limit: 60, load: null },
    { type: "miltruck", limit: 1000, load: { items: [], supplies: { metalsheet: 30, carparts: 10 } } },
  ];
  const st = createWorld({ seed: 23, factionCount: 5, custom: SMALL, fleet });
  // The same fleet with the set backs emptied: a back set (even empty) keeps the dice's out of the hub, so the stores
  // differ by the backs set alone.
  const plain = createWorld({ seed: 23, factionCount: 5, custom: SMALL, fleet: fleet.map((f) => ({ ...f, load: f.load ? { items: [], supplies: {} } : null })) });
  const atHub = st.vehicles.filter((v) => v.loc.kind === "base" && v.loc.baseId === hub(st).id);
  check(atHub.map((v) => v.type).join() === "van,hummer,miltruck", `the kinds set, all at the hub (${atHub.map((v) => v.type).join()})`);
  const R = START_FLEET.ROLL, pAt = plain.vehicles.filter((v) => v.loc.kind === "base");
  check(atHub.every((v, k) => { const T = VEHICLE_TYPES[v.type].tank; return v.fuel >= Math.round(T * R.FUEL[0] * 10) / 10 && v.fuel <= Math.round(T * R.FUEL[1] * 10) / 10 && Number.isInteger(v.condition) && v.condition >= R.CONDITION[0] && v.condition <= R.CONDITION[1] && v.fuel === pAt[k].fuel && v.condition === pAt[k].condition; }), `each with a rolled tank (${R.FUEL.join("–")} of its own) and condition (${R.CONDITION.join("–")}), on its slot's own dice (${atHub.map((v) => `${v.fuel}/${v.condition}`).join(", ")})`);
  check(st.fleet.length === SMALL.people && st.fleet[3].empty && st.fleet[3].vid == null && st.fleet.filter((f) => f.vid != null).map((f) => f.vid).join() === atHub.map((v) => v.id).join(), "each filled slot knows its vehicle; the fourth slot (a slot a survivor) empty");
  const H = hub(st).stock, P = hub(plain).stock;
  check(H.wood - P.wood === 400 && H.stone - P.stone === 60 && (H.f_rice || 0) - (P.f_rice || 0) === 5 && (H.electronics || 0) - (P.electronics || 0) === 2 && (H.metalsheet || 0) - (P.metalsheet || 0) === 30 && (H.carparts || 0) - (P.carparts || 0) === 10, "every back unloaded into the hub's stores on day 1 (wood, stone, rice, electronics, metal sheets, car parts)");
  check((H.a_9mm_fmj || 0) - (P.a_9mm_fmj || 0) === 400 && st.fleet[0].load.supplies.a_9mm_fmj === 400, "and its 400 rounds (past Normal's 300)");
  check(st.fleet.slice(0, 3).every((f) => f.diceTrunk) && JSON.stringify(st.fleet.map((f) => f.diceTrunk)) === JSON.stringify(plain.fleet.map((f) => f.diceTrunk)), "every vehicle has a dice back noted (f.diceTrunk), the same whatever back is set");
  const arms = (s) => hub(s).armory.map((it) => it.key);
  check(arms(st).filter((k) => k === "crowbar").length === arms(plain).filter((k) => k === "crowbar").length + 1 && arms(st).filter((k) => k === "knife").length === arms(plain).filter((k) => k === "knife").length + 1, "its things into the armory");
  const first = (s, i) => s.survivors[i].name.split(" ")[0];
  check(st.fleet.slice(0, 3).every((f, i) => f.ownerId === st.survivors[i].id) && fleetName(st, 0) === `${first(st, 0)}'s work van` && fleetName(st, 2) === `${first(st, 2)}'s army cargo truck` && fleetRoom(st, 2) === VEHICLE_TYPES.miltruck.payload, `named by whose (the crew in order) and roomed by kind (${fleetName(st, 0)}, ${fleetName(st, 2)}: ${fleetRoom(st, 2)} kg)`);
  // The window: any supply or material.
  const ui = UI({ mode: "custom", freeEdit: true });
  SG_ACTIONS["fleet-edit"](st, ui, { i: "1" });
  check(ui.fleetEdit && ui.fleetEdit.i === 1 && /data-action="sg-trunk-supadd"/.test(fleetEditor(st, ui)), "Edit… under Customize: the window, with Add a supply or material");
  check(SG_CHANGE["sg-trunk-supadd"](st, ui, el("stone")) === "fleet" && ui.fleet[1].load.supplies.stone === 10 && st.fleet[1].load.supplies.stone === 10, "a material in: ten of it, on the screen's fleet and the world's");
  check(SG_CHANGE["sg-trunk-sup"](st, ui, el(250, { k: "stone" })) === "fleet" && ui.fleet[1].load.supplies.stone === 250, "as much as the room holds (250 stone)");
  SG_CHANGE["sg-trunk-sup"](st, ui, el(99999, { k: "stone" }));
  check(trunkKg(ui.fleet[1].load) <= fleetRoom(st, 1) + 1e-9 && /Only room for/.test(ui.fleetEdit.msg), `held by the room (${trunkKg(ui.fleet[1].load)} / ${fleetRoom(st, 1)} kg): "${ui.fleetEdit.msg}"`);
  SG_CHANGE["sg-qty"](st, ui, el(30, { k: "tqty" }));
  ui.fleet[1].limit = st.fleet[1].limit = 1000;
  SG_CHANGE["sg-trunk-sup"](st, ui, el(0, { k: "stone" }));
  SG_CHANGE["sg-trunk-add"](st, ui, el("knife"));
  const knives = ui.fleet[1].load.items.reduce((a, e) => a + ((e.key || e) === "knife" ? e.n || 1 : 0), 0);
  check(knives === 30 && ui.fleet[1].load.items.reduce((a, e) => a + (e.n || 1), 0) === 30 + st.fleet[1].diceTrunk.items.length, `Custom: more than 16 things in a back (30 knives on what the dice put in it: ${st.fleet[1].diceTrunk.items.join(", ")})`);
  // Kinds and the count rebuild.
  check(SG_CHANGE["fleet-kind"](st, ui, el("sedan", { i: "1" })) === "fleet" && ui.fleet[1].type === "sedan" && SG_CHANGE["fleet-kind"](st, ui, el("bike", { i: "1" })) === false, "a kind: the world again; no bicycles");
  // A slot a starting survivor (SMALL: 4): the fourth is free until ＋ Add a vehicle puts one in it, as rolled.
  check(ui.fleet.length === 4 && ui.fleet[3].empty && SG_ACTIONS["fleet-add"](st, ui, {}) === "fleet" && !ui.fleet[3].empty && ui.fleet[3].type === null && ui.fleet[3].load === null && ui.fleet[1].type === "sedan", "＋ Add a vehicle: as rolled in the first free slot (the fourth, one a survivor), the sedan kept");
  const re = createWorld({ seed: 23, factionCount: 5, custom: SMALL, fleet: ui.fleet }), r3 = re.fleet[3], o3 = re.survivors[3];
  const cars3 = (HC_START.ARCHETYPES[o3.background] || {}).cars || { sedan: 2, truck: 1 };
  check(re.vehicles.filter((v) => v.loc.kind === "base").map((v) => v.type).join() === `van,sedan,miltruck,${r3.type}` && r3.rolledType && r3.ownerId === o3.id && r3.type in cars3 && fleetName(re, 3) === `${first(re, 3)}'s ${kindWord(r3.type)}`, `built again with them, the fourth rolled by whose it is (${fleetName(re, 3)}, of ${o3.background}'s ${Object.keys(cars3).join("/")})`);
  check(SG_ACTIONS["fleet-add"](re, ui, {}) === false && /data-action="fleet-add" disabled/.test(newRunScreen(re, ui)) && /4 of 4/.test(newRunScreen(re, ui)), "a vehicle a survivor already: no more added, the button greyed (4 of 4)");
  check(SG_ACTIONS["fleet-remove"](re, ui, { i: "1" }) === "fleet" && JSON.stringify(ui.fleet.map((f) => (f.empty ? "-" : f.type))) === '["van","miltruck",null,"-"]', "Remove the sedan: the others close up (the rolled one still as rolled), the free slot at the end");
  const re2 = createWorld({ seed: 23, factionCount: 5, custom: SMALL, fleet: ui.fleet }), rh = newRunScreen(re2, ui);
  check(re2.vehicles.filter((v) => v.loc.kind === "base").map((v) => v.type).join() === `van,miltruck,${re2.fleet[2].type}` && re2.fleet[2].rolledType && re2.fleet[2].ownerId === re2.survivors[2].id && fleetName(re2, 2) === `${first(re2, 2)}'s ${kindWord(re2.fleet[2].type)}` && (rh.match(/data-action="fleet-kind"/g) || []).length === 3 && !/Empty: add a vehicle/.test(rh) && rh.indexOf('data-action="fleet-add"') > rh.lastIndexOf('data-action="fleet-kind"') && /3 of 4/.test(rh), `three vehicles, their rows alone and ＋ Add a vehicle under them (3 of 4; the third rolled anew in its slot: ${fleetName(re2, 2)})`);
  check(SG_ACTIONS["fleet-remove"](re2, ui, { i: "3" }) === false && SG_ACTIONS["fleet-remove"](re2, ui, { i: "2" }) === "fleet" && ui.fleet[2].empty && createWorld({ seed: 23, factionCount: 5, custom: SMALL, fleet: ui.fleet }).vehicles.filter((v) => v.loc.kind === "base").length === 2, "Remove the last: nothing on a free slot; two vehicles");
  const nu = UI(), nw = createWorld({ seed: 23, factionCount: 5 });
  check(SG_CHANGE["fleet-kind"](nw, nu, el("van", { i: "0" })) === "fleet" && nu.fleet[0].type === "van" && SG_CHANGE["fleet-kind"](nw, nu, el("bike", { i: "0" })) === false, "Normal: the pickup's kind may be changed too (the user's request: 'you can change it'); no bicycles");
  const nv = createWorld({ seed: 23, factionCount: 5, fleet: nu.fleet });
  check(nv.vehicles.filter((v) => v.loc.kind === "base" && v.loc.baseId === hub(nv).id).map((v) => v.type).join() === "van" && nv.fleet[0].ownerId === nv.survivors[0].id && fleetName(nv, 0) === `${first(nv, 0)}'s work van`, `Normal: a van at the hub in its place (${fleetName(nv, 0)})`);
}

section("4. Normal and Hardcore: as before with no back set");
{
  const key = (s) => JSON.stringify([s.vehicles.map((v) => [v.type, v.fuel, v.condition, v.loc.kind]), hub(s) ? hub(s).stock : null, s.survivors.map((x) => [x.name, x.background, x.skills]), s.factions.map((f) => f.name), s.rng.state]);
  for (const seed of [3, 42]) {
    const a = createWorld({ seed, factionCount: 5 }), b = createWorld({ seed, factionCount: 5, fleet: defaultFleet("normal") });
    check(key(a) === key(b), `Normal ${seed}: the default fleet is the old start (the pickup, the stores, the dice)`);
    const loaded = createWorld({ seed, factionCount: 5, fleet: [{ limit: 60, load: { items: [], supplies: { water: 20, meds: 5 } } }] });
    const bare = createWorld({ seed, factionCount: 5, fleet: [{ limit: 60, load: { items: [], supplies: {} } }] }); // a back set, empty: the dice's not unloaded either
    check(hub(loaded).stock.water === hub(bare).stock.water + 20 && hub(loaded).stock.meds === hub(bare).stock.meds + 5, `Normal ${seed}: a back set is unloaded into the hub (in place of the dice's)`);
    const dice = a.fleet[0].diceTrunk, sup = (k) => (hub(a).stock[k] || 0) - (hub(bare).stock[k] || 0);
    check(!!dice && (dice.items.length || Object.keys(dice.supplies).length) && ["water", "meds", "fuel", "scrap", "parts"].every((k) => sup(k) === (dice.supplies[k] || 0)) && hub(a).armory.length === hub(bare).armory.length + dice.items.length, `Normal ${seed}: as rolled, the dice's back is unloaded into the hub (${JSON.stringify(dice)})`);
    const h1 = createWorld({ seed, factionCount: 5, mode: "hardcore" }), h2 = createWorld({ seed, factionCount: 5, mode: "hardcore", fleet: defaultFleet("hardcore") });
    const team = (s) => s.parties.find((p) => p.hcStart);
    check(key(h1) === key(h2) && JSON.stringify(team(h1).cargo.supplies) === JSON.stringify(team(h2).cargo.supplies), `Hardcore ${seed}: as rolled is the old start (the car, its back, the dice)`);
    check(h2.fleet[0].vid === h2.hardcore.start.car && h2.fleet[0].type === fleetVehicle(h2, 0).type, `Hardcore ${seed}: the fleet's one vehicle is the car fled in (${h2.fleet[0].type})`);
    const set = createWorld({ seed, factionCount: 5, mode: "hardcore", fleet: [{ limit: 60, load: { items: ["crowbar"], supplies: { water: 7 } } }] });
    const cargo = team(set).cargo;
    check(cargo.gear.some((it) => it.key === "crowbar") && set.survivors.some((s) => s.diceTrunk), `Hardcore ${seed}: a back set goes in place of the dice's (the dice's noted for As rolled)`);
    check(set.hardcore.start.car != null && set.factions.map((f) => f.name).join() === h1.factions.map((f) => f.name).join() && set.survivors.map((s) => s.name).join() === h1.survivors.map((s) => s.name).join(), `Hardcore ${seed}: the same crew and groups`);
    // As rolled on the screen.
    const ui = UI({ mode: "hardcore", freeEdit: true, fleet: [{ type: null, limit: 60, load: { items: ["crowbar"], supplies: { water: 7 } } }] });
    check(SG_ACTIONS["fleet-dice"](set, ui, { i: "0" }) === "fleet" && ui.fleet[0].load === null && set.fleet[0].load === null, `Hardcore ${seed}: As rolled: the back back to the dice's`);
    const nu = UI({ freeEdit: true, fleet: [{ type: null, limit: 60, load: { items: [], supplies: { water: 20, meds: 5 } } }] });
    check(SG_ACTIONS["fleet-dice"](a, UI({ freeEdit: true }), { i: "0" }) === false && SG_ACTIONS["fleet-dice"](loaded, nu, { i: "0" }) === "fleet" && nu.fleet[0].load === null && loaded.fleet[0].load === null, `Normal ${seed}: As rolled: nothing to do as rolled already; with a back set, the back back to the dice's`);
  }
}

section("5. Random: up to the point limit, within the room");
{
  for (const open of [false, true]) {
    let over = 0, heavy = 0, near = 0, sanitized = 0;
    const canon = (V) => JSON.stringify({ items: V.items, supplies: Object.fromEntries(Object.entries(V.supplies).sort(([a], [b]) => a.localeCompare(b))) });
    const N = 40;
    for (let k = 0; k < N; k++) {
      const limit = [20, 60, 150, 400][k % 4], room = [120, 400, 650, 2500][(k >> 2) % 4];
      const V = randomTrunk(limit, room, new Rng(1000 + k), { "9mm": 1 }, { fill: true, open });
      if (vehiclePoints(V) > limit) over++;
      if (trunkKg(V) > room + 1e-9) heavy++;
      // Up to the limit, or as far as the room or (Normal and Hardcore) the 16 things and the supplies' caps let it.
      if (vehiclePoints(V) >= limit * 0.85 || trunkKg(V) >= room * 0.9 || (!open && V.items.length >= START_TRUNK.ITEMS)) near++;
      if (canon(sanitizeStartVehicle(V, open)) !== canon(V)) sanitized++;
    }
    check(!over && !heavy, `${open ? "Custom" : "Normal/Hardcore"}: never over the limit or the room (${N} draws)`);
    check(near >= N * 0.9, `${open ? "Custom" : "Normal/Hardcore"}: filled up to the limit, the room or the caps (${near} of ${N})`);
    check(!sanitized, `${open ? "Custom" : "Normal/Hardcore"}: what it draws is a back as kept (caps and keys)`);
  }
  let mats = 0;
  for (let k = 0; k < 20; k++) { const V = randomTrunk(300, 2500, new Rng(77 + k), {}, { fill: true, open: true }); if (Object.keys(V.supplies).some((x) => !(x in START_TRUNK.SUPPLIES) && !x.startsWith("a_"))) mats++; }
  check(mats >= 10, `Custom: Random draws other materials and foods too (${mats} of 20)`);
  check(empty(randomTrunk(0, 600, new Rng(4), {}, { fill: true })) && empty(randomTrunk(0, 600, new Rng(4), {}, { fill: true, open: true })), "a limit of 0: nothing");
  // The screen's 🎲 Random, each mode.
  for (const [tag, opts] of [["Normal", {}], ["Hardcore", { mode: "hardcore" }], ["Custom", { custom: SMALL, fleet: [{ type: "sedan", limit: 80 }, { type: "van", limit: 300 }] }]]) {
    const st = createWorld({ seed: 12, factionCount: 5, ...opts });
    const ui = UI({ mode: opts.custom ? "custom" : opts.mode || "normal", freeEdit: true });
    let ok = true;
    for (let k = 0; k < 4; k++) for (let i = 0; i < st.fleet.length; i++) {
      if (st.fleet[i].empty) { if (SG_ACTIONS["fleet-rand"](st, ui, { i: String(i) }) !== false) ok = false; continue; } // an empty slot: nothing to fill
      if (SG_ACTIONS["fleet-rand"](st, ui, { i: String(i) }) !== "fleet") ok = false;
      const f = ui.fleet[i];
      if (!f.load || empty(f.load) || vehiclePoints(f.load) > f.limit || trunkKg(f.load) > fleetRoom(st, i) + 1e-9) ok = false;
    }
    check(ok && !fleetText(st), `${tag}: 🎲 Random fills each back within its limit and room (nothing for Start to refuse)`);
  }
  // Randomize everything: every vehicle's back to its limit.
  for (const [tag, opts] of [["Normal", {}], ["Hardcore", { mode: "hardcore" }], ["Custom", { custom: SMALL, fleet: [{ type: "sedan", limit: 40 }, { type: "suv", limit: 120 }] }]]) {
    const mk = (crew, extra = {}) => { const w = createWorld({ seed: 8, factionCount: 5, crewRoll: 91, ...opts, ...extra, crew }); w.pointsMax = 90; return w; };
    let st = mk(blankCrew(mk(null)));
    const u = UI({ freeEdit: true, crewRoll: 91 });
    let ok = true, overs = 0;
    for (let k = 0; k < 3; k++) {
      st = randomizeEverything(st, u, (crew) => mk(crew, { fleet: u.fleet }));
      st.fleet.forEach((f, i) => { if (f.empty) { if (f.load) ok = false; return; } if (!f.load || empty(f.load) || vehiclePoints(f.load) > f.limit || trunkKg(f.load) > fleetRoom(st, i) + 1) ok = false; });
      if (st.survivors.some((s) => pricePerson(st, s).over > 0)) overs++;
    }
    check(ok && u.fleet.length === st.fleet.length && st.fleet.some((f) => !f.empty), `${tag}: Randomize everything fills every vehicle's back to its own limit, the empty slots left so (${st.fleet.map((f) => (f.empty ? "empty" : `${vehiclePoints(f.load)}/${f.limit}`)).join(", ")})`);
    check(!overs, `${tag}: nobody over their points`);
  }
}

section("6. On nobody's points; Start refused over a limit");
{
  const mk = (fleet) => { const s0 = createWorld({ seed: 42, factionCount: 5 }); const w = createWorld({ seed: 42, factionCount: 5, crew: blankCrew(s0), fleet }); w.pointsMax = 90; return w; };
  const a = mk(null), b = mk([{ limit: 60, load: { items: ["ar"], supplies: { food: 30, meds: 10 } } }]);
  check(b.survivors.every((s, i) => pricePerson(b, s).total === pricePerson(a, a.survivors[i]).total) && !("vehicle" in pricePerson(b, b.survivors[0])), "a back set costs no colonist anything (no vehicle bill, no car pool)");
  const gw = startGearEditor(b, { ...UI({ freeEdit: true }), gearEdit: { i: 0, sel: null, msg: "" } });
  check(!/data-action="sg-trunk-/.test(gw) && !/car pool|Paid by/i.test(gw) && /The vehicles' backs: Starting vehicles/.test(gw), "the gear window has no vehicle's back of its own any more (it points at Starting vehicles)");
  check(!fleetText(b), `within its limit (${vehiclePoints(b.fleet[0].load)} of 60): Start allowed`);
  const c = mk([{ limit: 20, load: { items: ["ar"], supplies: { food: 30, meds: 10 } } }]);
  const t = fleetText(c);
  const cName = fleetName(c, 0);
  check(fleetProblems(c).length === 1 && cName.startsWith(`${c.survivors[0].name.split(" ")[0]}'s `) && t.startsWith(`${cName}'s back costs `) && /'s back costs \d+ points, over its limit of 20/.test(t), `over its limit: refused, the vehicle named ("${t}")`);
  const h = createWorld({ seed: 42, factionCount: 5, mode: "hardcore", fleet: [{ limit: 1000, load: { items: [], supplies: { water: 60, fuel: 40, scrap: 40, parts: 20 } } }] });
  const room = fleetRoom(h, 0), kg = trunkKg(h.fleet[0].load);
  check(kg <= room || /more than its room/.test(fleetText(h)), `Hardcore: over its room refused (${kg} / ${room} kg)`);
  const heavy = createWorld({ seed: 42, factionCount: 5, custom: SMALL, fleet: [{ type: "sedan", limit: 1000, load: { supplies: { stone: 900 } } }] });
  check(fleetText(heavy).startsWith(`${heavy.survivors[0].name.split(" ")[0]}'s old sedan's back weighs 900 kg, more than its room (400 kg)`), `over its room: refused ("${fleetText(heavy)}")`);
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  check(/const fleetOver = fleetText\(state\);\s*if \(fleetOver\) \{ ui\.nrMsg = fleetOver; return; \}/.test(main), "main.js begin refuses Start with fleetText (every mode, Customize or not)");
  // A custom background's car's back is the background's: on its colonist's own bill.
  const lib = { bgx: { id: "bgx", name: "Trucker", blurb: "", skills: {}, traits: [], traitTier: {}, gear: {}, items: [], supplies: {}, car: { odds: 1, type: "van", trunk: { water: 30 }, items: [] }, custom: true } };
  const s0 = createWorld({ seed: 42, factionCount: 5, customBackgrounds: lib });
  const crew = blankCrew(s0).map((x, i) => (i === 1 ? { ...x, background: "bgx" } : x));
  const w = createWorld({ seed: 42, factionCount: 5, crew, customBackgrounds: lib });
  w.pointsMax = 90;
  const who = w.survivors[1];
  if (w.customBackgrounds && w.customBackgrounds.bgx && who.background === "bgx") {
    check(bgBacks(w).length === 1 && bgBacks(w)[0].s === who && pricePerson(w, who).extra >= bgCarBack(w.customBackgrounds.bgx) && pricePerson(w, w.survivors[0]).extra === 0, `a background car's back on its own colonist's bill (${bgCarBack(w.customBackgrounds.bgx)} points), nobody else's`);
  } else check(true, "(no custom background in this world)");
  // Start takes the fleet off.
  clearStartGear(b);
  check(!("fleet" in b), "Start: nothing of the screen's fleet stays on the world");
}

section("7. The screen");
{
  const st = createWorld({ seed: 42, factionCount: 5, fleet: [{ limit: 60, load: { items: [], supplies: { water: 10 } } }] });
  const html = newRunScreen(st, UI({ freeEdit: true })), row0 = `${reEsc(fleetName(st, 0))} <select data-action="fleet-kind" data-i="0"><option value="" selected>As rolled: ${reEsc(VEHICLE_TYPES[fleetVehicle(st, 0).type].name)}</option>`;
  check(/Starting vehicles/.test(html) && /data-action="fleet-limit" data-i="0" value="60"/.test(html) && /data-action="fleet-rand"/.test(html) && /data-action="fleet-edit"/.test(html) && /data-action="fleet-empty"/.test(html) && /data-action="fleet-dice" data-i="0"/.test(html) && /data-action="fleet-view" data-i="0"/.test(html) && /data-action="fleet-reroll" data-i="0"/.test(html) && fleetName(st, 0).startsWith(`${st.survivors[0].name.split(" ")[0]}'s `) && new RegExp(row0).test(html) && /data-action="fleet-remove" data-i="0"/.test(html) && (html.match(/data-action="fleet-add"/g) || []).length === 1 && html.indexOf('data-action="fleet-add"') > html.indexOf('data-action="fleet-remove"') && new RegExp(`>1 of ${st.fleet.length}<`).test(html) && !/fleet-count|slots/.test(html), `Normal: the rolled vehicle's row (${fleetName(st, 0)}): its kind (As rolled first), Point limit, 🎲 Random, Edit…, Empty, As rolled, 👁 Back, 🎲 Reroll, ✕ Remove; ＋ Add a vehicle under it (1 of ${st.fleet.length}: one a survivor, no slots or Vehicles box)`);
  check(/Back <b>\d+<\/b> \/ 60 pts/.test(html) && new RegExp(`\\d+(\\.\\d)? / ${fleetRoom(st, 0)} kg`).test(html) && fleetRoom(st, 0) === VEHICLE_TYPES[fleetVehicle(st, 0).type].payload, `points used against the limit and kg against the room (${fleetRoom(st, 0)} kg)`);
  const tips = (html.match(/data-action="fleet-[a-z]+"[^>]*>/g) || []).every((m) => /data-tip="[^"]{20,}"/.test(m)) || (html.match(/<label data-tip="[^"]+">Point limit/) || []).length === 1;
  check(tips, "tooltips on the controls");
  const ui = UI({ freeEdit: true });
  check(SG_CHANGE["fleet-limit"](st, ui, el(1, { i: "0" })) === false && ui.fleet[0].limit === 1 && st.fleet[0].limit === 1 && /over its limit of 1/.test(fleetText(st)), "the Point limit: kept on the screen and the world (no rebuild); below the back's price, Start is refused");
  check(SG_ACTIONS["fleet-empty"](st, ui, { i: "0" }) === "fleet" && empty(ui.fleet[0].load) && !fleetText(st), "Empty: nothing in it, Start allowed");
  // Ironman: as rolled, read-only.
  const iron = UI({ ironman: true });
  const ih = newRunScreen(st, iron);
  check(/data-action="fleet-kind" data-i="0"/.test(ih) && !/fleet-limit|fleet-rand|fleet-edit|Point limit/.test(ih) && /Ironman: as rolled/.test(ih), "Ironman: the section as rolled (no Customize: the kinds alone, no limit or gear buttons)");
  check(SG_ACTIONS["fleet-rand"](st, iron, { i: "0" }) === false && SG_ACTIONS["fleet-edit"](st, iron, { i: "0" }) === false && SG_CHANGE["fleet-limit"](st, iron, el(80, { i: "0" })) === false, "Ironman: Random, Edit… and the limit refused");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  check(/fleet: ui\.ironman \|\| !ui\.freeEdit \? \(ui\.fleet \|\| \[\]\)\.map\(\(f\) => \(\{ \.\.\.f, load: null \}\)\) : ui\.fleet/.test(main), "main.js: an Ironman world, or one without Customize, is built with the backs as rolled");
  // Customize off (the user's request 2026-10-24: "Remove points left and setting gear in vehicles when no having customize
  // toggled"): the rows are the kinds and ✕ Remove alone, the backs as rolled; Random, Edit…, Empty and the limit refused.
  const plain = UI(), ph = newRunScreen(st, plain);
  check(/Starting vehicles/.test(ph) && new RegExp(row0).test(ph) && /data-action="fleet-remove" data-i="0"/.test(ph) && /data-action="fleet-view" data-i="0"/.test(ph) && /data-action="fleet-reroll" data-i="0"/.test(ph) && (ph.match(/data-action="fleet-add"/g) || []).length === 1 && !/fleet-edit|fleet-rand|fleet-empty|fleet-limit|fleet-dice|Point limit|ptsbar|\/ \d+ pts|\/ \d+ kg/.test(ph) && !/>Empty</.test(ph), "Customize off: the rolled vehicle's row is its kind (As rolled first), 👁 Back, 🎲 Reroll and ✕ Remove, ＋ Add a vehicle under it; no Point limit, points, kg, Random, Edit…, Empty, As rolled");
  check(SG_ACTIONS["fleet-rand"](st, plain, { i: "0" }) === false && SG_ACTIONS["fleet-edit"](st, plain, { i: "0" }) === false && SG_ACTIONS["fleet-empty"](st, plain, { i: "0" }) === false && SG_CHANGE["fleet-limit"](st, plain, el(80, { i: "0" })) === false && !plain.fleetEdit && st.fleet[0].limit === 1, "Customize off: Random, Edit…, Empty and the limit refused, the back's window shut");
  check(SG_ACTIONS["fleet-remove"](st, plain, { i: "0" }) === "fleet" && SG_CHANGE["fleet-kind"](createWorld({ seed: 42, factionCount: 5 }), UI(), el("van", { i: "0" })) === "fleet", "Customize off: ✕ Remove and the kind still work");
  check(/vehicle: ui\.startVehicle !== false, custom: custom \? \{ \.\.\.ui\.custom, people: ui\.startPeople \} : null,\s*fleet:/.test(main), "main.js runOpts passes the fleet next to vehicle and custom");
  check(/gearRebuild\(r === "fleet"\)/.test(main) && /fleetEditor\(state, ui\)/.test(readFileSync(new URL("../src/ui/ui.js", import.meta.url), "utf8")), "main.js rebuilds on a fleet change; ui.js shows the back's window");
  // Hardcore's row: the car's name, As rolled.
  const hc = createWorld({ seed: 42, factionCount: 5, mode: "hardcore" });
  const hh = newRunScreen(hc, UI({ mode: "hardcore", freeEdit: true }));
  check(/data-action="fleet-dice"/.test(hh) && new RegExp(`${fleetName(hc, 0).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(hh) && /As rolled: /.test(hh), `Hardcore: the car's row (${fleetName(hc, 0)}), as rolled, with As rolled`);
  const hp = newRunScreen(hc, UI({ mode: "hardcore" }));
  check(/data-action="fleet-kind" data-i="0"/.test(hp) && />as rolled</.test(hp) && /As rolled: /.test(hp) && !/fleet-dice|fleet-edit|Point limit/.test(hp), "Hardcore, Customize off: the car's kind and as rolled (what the dice put in it in its hover), no As rolled button, limit or Edit…");
  // Custom: the vehicles' rows (a kind select each) and ＋ Add a vehicle under them, up to one a survivor.
  const cs = createWorld({ seed: 42, factionCount: 5, custom: SMALL, fleet: resizeFleet([], 2) });
  const ch = newRunScreen(cs, UI({ mode: "custom", freeEdit: true }));
  check(/>2 of 4</.test(ch) && (ch.match(/data-action="fleet-kind"/g) || []).length === 2 && (ch.match(/data-action="fleet-rand"/g) || []).length === 2 && (ch.match(/data-action="fleet-add"/g) || []).length === 1 && !/fleet-add" disabled/.test(ch) && !/bike/.test((ch.match(/data-action="fleet-kind"[\s\S]*?<\/select>/) || [""])[0]), "Custom: two vehicles, a kind select each (no bicycles), one ＋ Add a vehicle (2 of 4)");
  // Hardcore with the car removed: the button at the top of the list, the team in the next vehicle; Add puts one as
  // rolled in the car's place (the one the team flees in: the dice's car again), As rolled still on its select.
  const hu = UI({ mode: "hardcore" }), h0 = createWorld({ seed: 42, factionCount: 5, mode: "hardcore" });
  check(SG_ACTIONS["fleet-remove"](h0, hu, { i: "0" }) === "fleet" && hu.fleet[0].empty && hu.fleet.length === h0.survivors.length, "Hardcore: the car removed, its slot kept free");
  hu.fleet[1] = { ...hu.fleet[1], type: "van", empty: false };
  const h1 = createWorld({ seed: 42, factionCount: 5, mode: "hardcore", fleet: hu.fleet }), h1h = newRunScreen(h1, hu);
  check(!fleetVehicle(h1, 0) && fleetVehicle(h1, 1).type === "van" && ridesIn(h1, 1) && h1.hardcore.start.car == null, "the car gone, a van added: the team rides in the van (no car fled in)");
  check(h1h.indexOf('data-action="fleet-add"') < h1h.indexOf('data-action="fleet-kind"') && (h1h.match(/data-action="fleet-add"/g) || []).length === 1 && /takes the rolled car's place/.test(h1h), "＋ Add a vehicle at the top of the list, above the van");
  check(SG_ACTIONS["fleet-add"](h1, hu, {}) === "fleet" && hu.fleet[0].type === null && hu.fleet[0].load === null && !hu.fleet[0].empty, "Add: one as rolled in the car's slot");
  const h2 = createWorld({ seed: 42, factionCount: 5, mode: "hardcore", fleet: hu.fleet }), h2h = newRunScreen(h2, hu);
  const ownerAt = (w) => w.survivors.findIndex((s) => s.id === w.hardcore.start.carOwner);
  check(fleetVehicle(h2, 0).type === fleetVehicle(h0, 0).type && h2.fleet[0].rolledType && ownerAt(h2) === ownerAt(h0) && fleetName(h2, 0) === fleetName(h0, 0) && h2.hardcore.start.car === h2.fleet[0].vid && ridesIn(h2, 0) && fleetVehicle(h2, 1).type === "van", `the dice's car again (${fleetName(h2, 0)}), the car the team flees in, the van along`);
  check(/<option value="" >As rolled<\/option>/.test(h2h) && h2h.indexOf('data-action="fleet-add"') > h2h.lastIndexOf('data-action="fleet-kind"'), "its select offers As rolled (the dice's car back); the button under the list again");
  // Each mode its own fleet.
  const u = { mode: "custom", startPeople: 6, pointsMax: 90, startVehicle: true, fleet: resizeFleet([], 3), modeSets: { normal: { fleet: [{ limit: 25 }] }, hardcore: {}, custom: {} } };
  stashModeSet(u);
  takeModeSet(u, "normal");
  check(u.fleet.length === 1 && u.fleet[0].limit === 25 && u.fleet[0].type === null && u.modeSets.custom.fleet.length === 3, "each mode keeps its own fleet (stashModeSet / takeModeSet; Normal's as rolled)");
  takeModeSet(u, "hardcore");
  check(u.fleet.length === 1 && u.fleet[0].type === null, "Hardcore's: one, as rolled");
  // Save and load during the screen.
  const sv = createWorld({ seed: 14, factionCount: 5, custom: SMALL, fleet: [{ type: "van", limit: 100, load: { supplies: { wood: 20 } } }, { type: "suv" }] });
  const back = loadFromString(saveToString(sv));
  check(isCustomRun(back) && JSON.stringify(back.custom) === JSON.stringify(sv.custom) && JSON.stringify(back.fleet) === JSON.stringify(sv.fleet), "a Custom run saves and loads with its counts and fleet");
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
