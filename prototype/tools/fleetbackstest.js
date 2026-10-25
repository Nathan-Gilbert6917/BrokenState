// Hardcore's starting vehicles past the car have backs of their own, and the start's account splits the crew between
// the vehicles (the user's request 2026-10-25: "The preamble still says the first vehicle has everyone onboard and then
// the second vehicle is just tacked on saying it's being driven by a survivor make it all meld and also have each
// additional vehicle have random gear set in the back with dice rolling like how the first vehicle and add a button to
// view and randomize it"; sim/hardcore-start.js extraBacks, rideSplit, carPart, morePart; sim/startfleet.js roll;
// ui/startgear.js fleetViewer, fleet-view, fleet-reroll):
//   1. each vehicle past the car gets a back on dice of its own (by its driver's background), noted on its slot
//      (f.diceTrunk) and in the team's cargo; the world's dice untouched (the crew, the groups, the car and its back);
//      the same seed, the same backs;
//   2. a slot's roll (🎲 Reroll) changes that back alone; the car's roll its back alone (whose car, its kind, the rest
//      as before); a back set under Customize goes in place of the dice's (still noted);
//   3. the account: one vehicle, "got everyone into" as before; more, each vehicle a line of its own with who rides in it
//      (its driver first, nobody twice, no more than its seats), no tacked-on "Another vehicle" line;
//   4. the screen: 👁 Back and 🎲 Reroll on every Hardcore vehicle (Customize on or off), none in Normal; the view
//      window lists the back; Reroll gives the slot new dice and the world again changes that back.
// Usage: node tools/fleetbackstest.js
import { createWorld } from "../src/sim/world.js";
import { cleanFleet, fleetVehicle, fleetDriver } from "../src/sim/startfleet.js";
import { SEATS } from "../src/sim/vehicles.js";
import { newRunScreen } from "../src/ui/newgame.js";
import { SG_ACTIONS, fleetViewer } from "../src/ui/startgear.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const UI = (extra = {}) => ({ started: false, freeEdit: false, ironman: false, worldSize: "normal", factionCount: 5, nrMsg: "", ...extra });
const team = (st) => st.parties.find((p) => p.owner === "player");
const J = (x) => JSON.stringify(x);
const owner = (st) => st.survivors.find((s) => s.diceTrunk);
const filled = (V) => !!V && ((V.items || []).length > 0 || Object.keys(V.supplies || {}).length > 0);
const HC = (fleet, extra = {}) => createWorld({ seed: 7, factionCount: 5, mode: "hardcore", startPeople: 4, fleet, ...extra });
const FLEET = [{ type: null }, { type: "truck" }, { type: "van" }];

section("1. Dice backs past the car");
{
  const a = HC(FLEET), b = HC(FLEET), one = HC([{ type: null }]);
  check(filled(a.fleet[1].diceTrunk) && filled(a.fleet[2].diceTrunk), `each vehicle past the car has a back from the dice (${a.fleet.slice(1, 3).map((f) => `${(f.diceTrunk.items || []).length} things, ${Object.keys(f.diceTrunk.supplies).length} supplies`).join("; ")})`);
  check(J(a.fleet[1].diceTrunk) === J(b.fleet[1].diceTrunk) && J(a.fleet[2].diceTrunk) === J(b.fleet[2].diceTrunk), "the same seed: the same backs");
  check(J(a.fleet[1].diceTrunk) !== J(a.fleet[2].diceTrunk), "each its own dice: two backs, not one twice");
  check(a.factions.map((f) => f.name).join() === one.factions.map((f) => f.name).join() && a.survivors.map((s) => s.name).join() === one.survivors.map((s) => s.name).join(), "the world's dice untouched: the same crew and groups as with the car alone");
  check(owner(a).name === owner(one).name && J(owner(a).diceTrunk) === J(owner(one).diceTrunk) && fleetVehicle(a, 0).type === fleetVehicle(one, 0).type, "the car: the same owner, kind and back");
  const things = (st) => team(st).cargo.gear.map((g) => g.key);
  const extra = [...a.fleet[1].diceTrunk.items, ...a.fleet[2].diceTrunk.items].map((e) => (typeof e === "string" ? e : e.key));
  check(extra.every((k) => things(a).includes(k)) && things(a).length >= things(one).length + extra.length, "what is in their backs is the team's cargo");
}

section("2. Rolled again, and set by hand");
{
  const a = HC(FLEET);
  const r = HC(FLEET.map((f, i) => (i === 1 ? { ...f, roll: 12345 } : f)));
  check(J(r.fleet[1].diceTrunk) !== J(a.fleet[1].diceTrunk) && J(r.fleet[2].diceTrunk) === J(a.fleet[2].diceTrunk) && J(owner(r).diceTrunk) === J(owner(a).diceTrunk), "a slot's roll changes its back alone");
  check(J(HC(FLEET.map((f, i) => (i === 1 ? { ...f, roll: 12345 } : f))).fleet[1].diceTrunk) === J(r.fleet[1].diceTrunk), "the same roll: the same back");
  const c = HC(FLEET.map((f, i) => (i === 0 ? { ...f, roll: 999 } : f)));
  check(J(owner(c).diceTrunk) !== J(owner(a).diceTrunk) && owner(c).name === owner(a).name && fleetVehicle(c, 0).type === fleetVehicle(a, 0).type && Math.abs(fleetVehicle(c, 0).fuel - fleetVehicle(a, 0).fuel) < 1e-9 && c.factions.map((f) => f.name).join() === a.factions.map((f) => f.name).join(), "the car's roll: its back alone (whose car, its kind and tank, the groups as before)");
  check(J(c.fleet[1].diceTrunk) === J(a.fleet[1].diceTrunk), "the others' backs as before");
  const set = HC(FLEET.map((f, i) => (i === 2 ? { ...f, load: { items: ["crowbar"], supplies: { water: 7 } } } : f)));
  const tc = team(set).cargo;
  check(tc.gear.some((g) => g.key === "crowbar") && J(set.fleet[2].diceTrunk) === J(a.fleet[2].diceTrunk), "a back set by hand goes in place of the dice's (the dice's still noted, for As rolled)");
}

section("3. The account: the crew split between the vehicles");
{
  const one = HC([{ type: null }], { startPeople: 3 });
  check(one.hardcore.start.grabbed.some((l) => / got everyone into their /.test(l)), "one vehicle: everyone in the car, as before");
  for (const [tag, fleet, n] of [["the car and a pickup", [{ type: null }, { type: "truck" }], 3], ["three vehicles", FLEET, 4], ["no car, two others", [{ type: null, empty: true }, { type: "truck" }, { type: "suv" }], 3]]) {
    const st = HC(fleet, { startPeople: n });
    const lines = st.hardcore.start.grabbed, vs = st.fleet.map((f, i) => fleetVehicle(st, i)).filter(Boolean);
    const vLines = lines.slice(lines.length - vs.length);
    check(!lines.some((l) => /got everyone into|Another vehicle comes|more vehicles come/.test(l)), `${tag}: nobody "got everyone into" one of them, and no tacked-on line`);
    const firsts = st.survivors.map((s) => s.name.split(" ")[0]);
    const inLines = firsts.map((f) => vLines.filter((l) => new RegExp(`\\b${f}\\b`).test(l.replace(/^\w+'s /, ""))).length);
    check(inLines.every((k) => k === 1), `${tag}: each of them in one vehicle's line (${firsts.map((f, i) => `${f} ${inLines[i]}`).join(", ")})`);
    check(vs.every((v, i) => { const d = st.fleet.findIndex((f) => f.vid === v.id); const who = fleetDriver(st, d); return !who || vLines[i].includes(who.name.split(" ")[0]); }), `${tag}: each line names its driver`);
    check(vLines.slice(1).every((l) => / followed in /.test(l)) && vLines.every((l) => /tank \d+% full/.test(l)), `${tag}: the ones after the first "followed in", each with its tank`);
    const backs = vs.filter((v, i) => i > 0 || !st.hardcore.start.car).length;
    check(vLines.filter((l) => /in the back:/.test(l)).length >= backs, `${tag}: each vehicle's line says what is in its back`);
    check(vs.every((v) => (SEATS[v.type] ?? 4) >= 1), `${tag}: seats known`);
  }
  const big = HC([{ type: "sedan" }, { type: "truck" }], { startPeople: 4 });
  check(big.hardcore.start.grabbed.some((l) => / followed in a pickup truck/.test(l)), "a sedan and a pickup: the pickup follows");
}

section("4. The screen: 👁 Back and 🎲 Reroll");
{
  const st = HC(FLEET);
  for (const free of [false, true]) {
    const h = newRunScreen(st, UI({ mode: "hardcore", freeEdit: free }));
    check((h.match(/data-action="fleet-view"/g) || []).length === 3 && (h.match(/data-action="fleet-reroll"/g) || []).length === 3, `Hardcore, Customize ${free ? "on" : "off"}: 👁 Back and 🎲 Reroll on each of the three vehicles`);
  }
  const plain = HC(FLEET), first = plain.fleet[1];
  check(!/\(\w+ driving\)/.test(newRunScreen(plain, UI({ mode: "hardcore" }))), "no leftover '(… driving)' text");
  const nm = createWorld({ seed: 7, factionCount: 5, startPeople: 4, fleet: [{ type: "truck" }, { type: "van" }] });
  check(!/fleet-view|fleet-reroll/.test(newRunScreen(nm, UI({ mode: "normal" }))), "Normal: none (its vehicles come empty)");
  const ui = UI({ mode: "hardcore", fleet: cleanFleet(FLEET, "hardcore") });
  check(SG_ACTIONS["fleet-view"](st, ui, { i: "1" }) === false && ui.fleetView && ui.fleetView.i === 1, "👁 Back opens the look at its back");
  const win = fleetViewer(st, ui);
  const names = st.fleet[1].diceTrunk.items.length;
  check(/Things/.test(win) && /Supplies/.test(win) && /data-action="fleet-reroll" data-i="1"/.test(win) && (win.match(/class="chip"/g) || []).length >= Math.min(1, names) && /follows|drives it/.test(win), "the window: its things, its supplies, who drives it, 🎲 Reroll");
  check(SG_ACTIONS["fleet-reroll"](st, ui, { i: "1" }) === "fleet" && Number.isInteger(ui.fleet[1].roll) && ui.fleet[1].load === null && st.fleet[1].roll === ui.fleet[1].roll, "🎲 Reroll: new dice on the slot (the world again)");
  const re = createWorld({ seed: 7, factionCount: 5, mode: "hardcore", startPeople: 4, fleet: ui.fleet });
  check(J(re.fleet[1].diceTrunk) !== J(first.diceTrunk) && J(re.fleet[2].diceTrunk) === J(plain.fleet[2].diceTrunk) && re.survivors.map((s) => s.name).join() === plain.survivors.map((s) => s.name).join(), "the world again: that back new, the rest as they were");
  check(SG_ACTIONS["fleet-reroll"](st, UI({ started: true, fleet: ui.fleet }), { i: "1" }) === false && SG_ACTIONS["fleet-view"](nm, UI(), { i: "0" }) === false, "not once started; not in Normal");
  check(SG_ACTIONS["fleet-view-close"](st, ui, {}) === false && ui.fleetView === null, "Done closes it");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
