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
import { cleanFleet, fleetVehicle, fleetDriver, fleetName } from "../src/sim/startfleet.js";
import { SEATS } from "../src/sim/vehicles.js";
import { newRunScreen } from "../src/ui/newgame.js";
import { SG_ACTIONS, SG_CHANGE, fleetViewer } from "../src/ui/startgear.js";

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
  check(big.hardcore.start.grabbed.some((l) => / followed in (their|\w+'s) pickup truck/.test(l)), "a sedan and a pickup: the pickup follows");
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
  check((newRunScreen(nm, UI({ mode: "normal" })).match(/data-action="fleet-reroll"/g) || []).length === 2, "Normal: 🎲 Reroll on both vehicles too (rolled by whose they are, 2026-10-25)");
  const ui = UI({ mode: "hardcore", fleet: cleanFleet(FLEET, "hardcore") });
  check(SG_ACTIONS["fleet-view"](st, ui, { i: "1" }) === false && ui.fleetView && ui.fleetView.i === 1, "👁 Back opens the look at its back");
  const win = fleetViewer(st, ui);
  const names = st.fleet[1].diceTrunk.items.length;
  check(/Things/.test(win) && /Supplies/.test(win) && /data-action="fleet-reroll" data-i="1"/.test(win) && (win.match(/class="chip"/g) || []).length >= Math.min(1, names) && /at the wheel/.test(win), "the window: its things, its supplies, who drives it, 🎲 Reroll");
  check(SG_ACTIONS["fleet-reroll"](st, ui, { i: "1" }) === "fleet" && Number.isInteger(ui.fleet[1].roll) && ui.fleet[1].load === null && st.fleet[1].roll === ui.fleet[1].roll, "🎲 Reroll: new dice on the slot (the world again)");
  const re = createWorld({ seed: 7, factionCount: 5, mode: "hardcore", startPeople: 4, fleet: ui.fleet });
  check(J(re.fleet[1].diceTrunk) !== J(first.diceTrunk) && J(re.fleet[2].diceTrunk) === J(plain.fleet[2].diceTrunk) && re.survivors.map((s) => s.name).join() === plain.survivors.map((s) => s.name).join(), "the world again: that back new, the rest as they were");
  check(SG_ACTIONS["fleet-reroll"](st, UI({ started: true, fleet: ui.fleet }), { i: "1" }) === false && SG_ACTIONS["fleet-view"](nm, UI({ started: true }), { i: "0" }) === false, "not once started");
  check(SG_ACTIONS["fleet-view-close"](st, ui, {}) === false && ui.fleetView === null, "Done closes it");
}

section("5. Added vehicles rolled by whose they are; named so; the card as set");
{
  // The user's request 2026-10-25: "Instead of showing name like vehicle 2 do what you do with the first rolled vehicle.
  // When you add a vehicle roll it based on the remaining survivors and update the preamble to show based on what was set when you begin".
  const st = HC([{ type: null }], { startPeople: 3 });
  const ui = UI({ mode: "hardcore", fleet: cleanFleet([{ type: null }], "hardcore") });
  ui.fleet = cleanFleet(st.fleet.map((f) => ({ ...f, type: f.rolledType ? null : f.type })), "hardcore");
  check(SG_ACTIONS["fleet-add"](st, ui, {}) === "fleet" && ui.fleet[1].type === null && !ui.fleet[1].empty, "＋ Add a vehicle (Hardcore): as rolled, no kind set");
  const w = HC(ui.fleet, { startPeople: 3 }), carOwner = w.hardcore.start.carOwner, f1 = w.fleet[1];
  const own = w.survivors.find((s) => s.id === f1.ownerId);
  check(!!own && own.id !== carOwner && own === w.survivors.find((s) => s.id !== carOwner), "whose it is: the first of the crew without a vehicle (the car's owner has the car)");
  check(f1.rolledType === true && fleetName(w, 1) === `${own.name.split(" ")[0]}'s ${/^[A-Z]{2,}/.test(fleetVehicle(w, 1).name) ? fleetVehicle(w, 1).name : fleetVehicle(w, 1).name.toLowerCase()}`, `named as the car is: ${fleetName(w, 1)}`);
  check(fleetDriver(w, 1) === own, "its owner at its wheel by default");
  const screen = newRunScreen(w, UI({ mode: "hardcore", fleet: ui.fleet }));
  check(!/Vehicle 2/.test(screen) && screen.includes(fleetName(w, 1).replace(/'/g, "&#39;")) || screen.includes(fleetName(w, 1)), "the screen shows its name, not 'Vehicle 2'");
  check(/<option value="" selected>As rolled: /.test((screen.match(/data-action="fleet-kind" data-i="1"[\s\S]*?<\/select>/) || [""])[0]), "its kind select offers As rolled (its rolled kind)");
  const kinds = new Set();
  for (let r = 1; r <= 30; r++) kinds.add(fleetVehicle(HC([{ type: null }, { type: null, roll: r * 7919 }], { startPeople: 3 }), 1).type);
  check(kinds.size >= 2, `rolled by its owner's background: more than one kind over rerolls (${[...kinds].join(", ")})`);
  const card = w.cards.find((c) => c.intro);
  check(!!card && w.hardcore.start.grabbed.every((l) => card.text.includes(l)) && card.text.includes(`${own.name.split(" ")[0]} followed in their`), "the opening card is the account as set: the added vehicle's owner follows in it");
  const ui2 = UI({ mode: "hardcore", fleet: ui.fleet.map((f) => ({ ...f })) });
  check(SG_CHANGE["fleet-kind"](w, ui2, { value: "van", dataset: { i: "1" } }) === "fleet" && ui2.fleet[1].type === "van", "a kind picked");
  const w2 = HC(ui2.fleet, { startPeople: 3 });
  check(fleetVehicle(w2, 1).type === "van" && w2.cards.find((c) => c.intro).text.includes("work van") && w2.survivors.find((s) => s.id === w2.fleet[1].ownerId).name === own.name, "the world again: the card says the van, the same owner");
  check(SG_CHANGE["fleet-kind"](w2, ui2, { value: "", dataset: { i: "1" } }) === "fleet" && ui2.fleet[1].type === null, "As rolled again");
}

section("6. Normal and Custom: the hub's vehicles rolled the same way");
{
  // The user's requests 2026-10-25: "Add the same rolling to normal mode vehicles too", "and custom".
  const SMALL = { people: 4, groups: 3, hives: 3, cities: 1, towns: 6, military: 1 };
  for (const [tag, opts] of [["Normal", { startPeople: 4 }], ["Custom", { custom: SMALL }]]) {
    const mk = (fleet) => createWorld({ seed: 7, factionCount: 5, ...opts, fleet });
    const a = mk([{}, {}]), b = mk([{}, {}]), one = mk([{}]), hubA = a.bases.find((x) => x.type === "hub");
    const owners = a.fleet.slice(0, 2).map((f) => a.survivors.find((s) => s.id === f.ownerId));
    check(owners[0] === a.survivors[0] && owners[1] === a.survivors[1], `${tag}: whose each is, in the crew's order`);
    check(a.fleet.slice(0, 2).every((f) => f.rolledType && filled(f.diceTrunk)), `${tag}: each as rolled, with a back from the dice`);
    check([0, 1].every((i) => fleetName(a, i).startsWith(`${owners[i].name.split(" ")[0]}'s `)) && [0, 1].every((i) => fleetDriver(a, i) === owners[i]), `${tag}: named after its owner (${fleetName(a, 0)}, ${fleetName(a, 1)}), at its wheel`);
    check([0, 1].every((i) => { const v = fleetVehicle(a, i); return v && v.loc.kind === "base" && v.condition >= 60 && v.condition <= 85; }), `${tag}: at the hub, its condition rolled (60–85)`);
    check(J(a.fleet[1].diceTrunk) === J(b.fleet[1].diceTrunk) && a.survivors.map((s) => s.name).join() === one.survivors.map((s) => s.name).join() && a.factions.map((f) => f.name).join() === one.factions.map((f) => f.name).join(), `${tag}: the same seed, the same; the world's dice untouched by a second vehicle`);
    const things = a.fleet[1].diceTrunk.items.map((e) => (typeof e === "string" ? e : e.key));
    check(things.every((k) => hubA.armory.some((it) => it.key === k)), `${tag}: what was in the backs is in the hub's armory`);
    const r = mk([{}, { roll: 4242 }]);
    check(J(r.fleet[1].diceTrunk) !== J(a.fleet[1].diceTrunk) && J(r.fleet[0].diceTrunk) === J(a.fleet[0].diceTrunk), `${tag}: a slot's roll changes its vehicle alone`);
    const html = newRunScreen(a, UI({ mode: tag.toLowerCase() }));
    check(html.includes(`In the yard: ${fleetName(a, 0)} and ${fleetName(a, 1)}`), `${tag}: the start's story names them in the yard`);
  }
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
