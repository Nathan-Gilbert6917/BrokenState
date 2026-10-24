// Custom mode and Start with a vehicle (sim/custommode.js; 2026-10-24, user request: "Add a toggle for start with a
// vehicle or not to start with a vehicle. Add to the normal/hardcore dropdown custom ... set any number above 1 for
// starting survivors, hives, cities etc").
//   1. the counts clamp to 1 and up, under their caps (a blank or junk value is the default);
//   2. a Custom world is a normal (hub) start with state.custom: its survivors (12 and 30 with no crash, every one armed
//      and with a background), AI groups, hives, cities, towns and military sites as set (or as many as found room),
//      the all-ones corner, and it ticks a day;
//   3. Start with a vehicle off: no pickup at a normal or Custom hub, no custom background's car (nor its back on the
//      points bill); Hardcore flees on foot (no car, no back, no empty-seat load, the tents carried, the world's dice as
//      with the car) and ticks a day; on, everything as before;
//   4. save and load keep state.custom and state.startVehicles;
//   5. the new-run screen: Custom in the Mode select, the six number inputs in place of Starting people, AI groups and
//      Starting hives, the vehicle box in every mode; each mode keeps its own settings (stashModeSet / takeModeSet), and
//      a Random run from Custom picks Normal or Hardcore and leaves Custom's set alone; main.js wires it up.
// Usage: node tools/custommodetest.js
import { readFileSync } from "node:fs";
import { createWorld, tickHour } from "../src/sim/world.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { CUSTOM_RUN, CUSTOM_KEYS, clampCustomCount, cleanCustom, isCustomRun, startsWithVehicle } from "../src/sim/custommode.js";
import { MODES, peopleRange, clampStartPeople } from "../src/sim/hardcore.js";
import { bgBacks } from "../src/sim/custompoints.js";
import { newRunScreen, rollRandomRun, stashModeSet, takeModeSet, screenMode } from "../src/ui/newgame.js";
import { modeLabel } from "../src/ui/hardcore.js";
import { Rng } from "../src/sim/rng.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
const towns = (s) => s.tiles.filter((t) => t.loc && t.loc.type === "town").length;
const hub = (s) => s.bases.find((b) => b.type === "hub");
const runDay = (s) => { for (let h = 0; h < 24; h++) tickHour(s); };

section("1. The counts");
for (const k of CUSTOM_KEYS) {
  const R = CUSTOM_RUN[k];
  check(R.MIN === 1, `${k}: at least 1`);
  check(clampCustomCount(k, 0) === 1 && clampCustomCount(k, -5) === 1, `${k}: 0 and below clamp to 1`);
  check(clampCustomCount(k, 1e6) === R.MAX, `${k}: capped at ${R.MAX}`);
  check(clampCustomCount(k, "") === R.DEF && clampCustomCount(k, "junk") === R.DEF, `${k}: blank or junk is the default ${R.DEF}`);
  check(clampCustomCount(k, 3.4) === Math.min(R.MAX, 3), `${k}: whole numbers`);
}
check(JSON.stringify(cleanCustom({ people: 0, towns: 999 })) === JSON.stringify({ people: 1, groups: 7, hives: 4, cities: 2, towns: 60, military: 1 }), "cleanCustom fills and clamps every count");
check(MODES.custom && MODES.custom.label === "Custom" && MODES.custom.tip, "Custom is in the Mode list with a tip");
check(peopleRange("custom") === CUSTOM_RUN.people && clampStartPeople(12, "custom") === 12 && clampStartPeople(99, "custom") === 30 && clampStartPeople(12, "normal") === 8, "Custom's people range is 1–30 (Normal still 1–8)");

section("2. Custom worlds");
{
  const c = { people: 12, groups: 4, hives: 9, cities: 3, towns: 10, military: 3 };
  const s = createWorld({ seed: 11, factionCount: 7, custom: c });
  check(s.mode === "normal" && isCustomRun(s) && screenMode(s) === "custom" && modeLabel(s) === "Custom", "a Custom run is a normal start with state.custom");
  check(JSON.stringify(s.custom) === JSON.stringify(c), "state.custom keeps the counts");
  check(hub(s) && s.survivors.length === 12 && s.startPeople === 12, `12 survivors at the hub (${s.survivors.length})`);
  check(s.survivors.every((x) => x.gear.weapon && x.background), "every one of the 12 armed and with a background");
  check(s.factions.length === 4, `4 AI groups (${s.factions.length})`);
  check(s.hives.length === 9, `9 hives (${s.hives.length})`);
  check(s.cityIds.length === 3, `3 cities (${s.cityIds.length})`);
  check(towns(s) === 10, `10 towns (${towns(s)})`);
  check(s.militaryIds.length === 3, `3 military sites (${s.militaryIds.length})`);
  check(new Set(s.cityIds.map((id) => s.tiles[id].loc.name)).size === 3, "the cities' names differ");
  runDay(s);
  check(s.survivors.filter((x) => x.alive).length >= 11 && !s.gameOver, "a 12-strong Custom run ticks a day");
  const again = createWorld({ seed: 11, factionCount: 7, custom: c });
  check(JSON.stringify(again.tiles.map((t) => t.loc && t.loc.name)) === JSON.stringify(createWorld({ seed: 11, factionCount: 7, custom: c }).tiles.map((t) => t.loc && t.loc.name)), "the same seed and counts build the same map");
  const plain = createWorld({ seed: 11, factionCount: 7 });
  check(!isCustomRun(plain) && plain.custom === undefined && screenMode(plain) === "normal" && modeLabel(plain) === "Normal", "a plain normal run is not Custom");
  const hard = createWorld({ seed: 11, factionCount: 7, mode: "hardcore", custom: c });
  check(hard.mode === "hardcore" && !hard.custom && !isCustomRun(hard), "Hardcore takes no Custom counts");
}
{
  const ones = createWorld({ seed: 3, factionCount: 7, custom: { people: 0, groups: 0, hives: 0, cities: 0, towns: 0, military: 0 } });
  check(JSON.stringify(ones.custom) === JSON.stringify({ people: 1, groups: 1, hives: 1, cities: 1, towns: 1, military: 1 }), "0s clamp to 1s");
  check(ones.survivors.length === 1 && ones.factions.length === 1 && ones.hives.length === 1 && ones.cityIds.length === 1 && towns(ones) === 1 && ones.militaryIds.length === 1,
    `the all-ones corner: 1 survivor, group, hive, city, town and base (${ones.survivors.length}, ${ones.factions.length}, ${ones.hives.length}, ${ones.cityIds.length}, ${towns(ones)}, ${ones.militaryIds.length})`);
  check(ones.survivors[0].leader, "the lone survivor leads");
}
{
  const t = Date.now();
  const big = createWorld({ seed: 5, factionCount: 7, size: "huge", custom: { people: 30, groups: 50, hives: 50, cities: 12, towns: 60, military: 12 } });
  const ms = Date.now() - t;
  check(big.survivors.length === 30 && big.survivors.every((x) => x.gear.weapon && x.background), "30 survivors, all armed, all with a background");
  check(big.hives.length === 50 && big.cityIds.length === 12 && big.militaryIds.length === 12, `a Huge map fits 50 hives, 12 cities and 12 bases (${big.hives.length}, ${big.cityIds.length}, ${big.militaryIds.length})`);
  check(towns(big) <= 60 && towns(big) >= 30 && big.factions.length <= 50 && big.factions.length >= 20, `towns and groups as many as fit (${towns(big)}, ${big.factions.length})`);
  check(ms < 60000, `the biggest Custom world builds in ${ms} ms`); // Huge is 500 × 300 since 2026-10-24 (worldsize.js): about 16 s on the shared machine (10 s at 100 × 66)
  // A map too small for the counts: the old Small (48 × 32, a custom size now; the new 150 × 75 Small fits 12 cities and 60 towns).
  const small = createWorld({ seed: 5, factionCount: 7, size: "custom", customW: 48, customH: 32, custom: { people: 30, groups: 50, hives: 50, cities: 12, towns: 60, military: 12 } });
  check(small.cityIds.length >= 2 && small.cityIds.length <= 12 && towns(small) >= 1 && small.militaryIds.length >= 1, "a small map places what fits, no hang");
  const html = newRunScreen(small, { mode: "custom", worldSize: "small", factionCount: 7, nrMsg: "", startPeople: 30 });
  check(/found room on this map/.test(html), "the screen says what found no room");
}

section("3. Start with a vehicle");
for (const custom of [null, { people: 6, groups: 5, hives: 4, cities: 2, towns: 13, military: 1 }]) {
  const tag = custom ? "Custom" : "Normal";
  const on = createWorld({ seed: 21, factionCount: 7, custom });
  const off = createWorld({ seed: 21, factionCount: 7, custom, vehicle: false });
  check(on.startVehicles === true && startsWithVehicle(on) && on.vehicles.some((v) => v.type === "truck" && v.loc.kind === "base"), `${tag}: on, the hub's pickup`);
  check(off.startVehicles === false && !startsWithVehicle(off) && off.vehicles.length === 0, `${tag}: off, no vehicle (${off.vehicles.length})`);
  check(JSON.stringify(on.tiles.map((t) => t.loc && t.loc.name)) === JSON.stringify(off.tiles.map((t) => t.loc && t.loc.name)) && hub(on).tile === hub(off).tile && on.factions.length === off.factions.length, `${tag}: the same map, hub and groups either way`);
  runDay(off);
  check(!off.gameOver && off.survivors.some((x) => x.alive), `${tag}: off, a day ticks`);
}
check(startsWithVehicle({ mode: "normal" }), "an older save (no startVehicles) has its vehicle");
{
  // A custom background that brings a car: off, the car and its back stay home, and the back is not on the points bill.
  const bg = { c_car: { id: "c_car", name: "Driver", skills: {}, traits: [], gear: {}, items: [], supplies: {}, car: { odds: 10, type: "van", trunk: { scrap: 5 }, items: [] } } };
  const crew = [{ background: "c_car", points: true, custom: true }];
  const on = createWorld({ seed: 8, factionCount: 7, crew, customBackgrounds: bg });
  const off = createWorld({ seed: 8, factionCount: 7, crew, customBackgrounds: bg, vehicle: false });
  if (check(on.survivors[0].background === "c_car", "the custom background took (fixture)")) {
    check(on.vehicles.some((v) => v.type === "van"), "on: the background's van at the hub");
    check(!off.vehicles.length, "off: no van, no pickup");
    check((hub(on).stock.scrap || 0) - (hub(off).stock.scrap || 0) === 5, "off: nothing from the van's back");
    check(bgBacks(on).length === 1 && bgBacks(off).length === 0, `off: no background car's back on the points bill (on: ${bgBacks(on).length})`);
  }
}
for (const seed of [9, 10, 31]) {
  const on = createWorld({ seed, factionCount: 7, mode: "hardcore" });
  const off = createWorld({ seed, factionCount: 7, mode: "hardcore", vehicle: false });
  const p = off.parties.find((q) => q.hcStart);
  check(on.hardcore.start.car != null && on.vehicles.length === 1, `Hardcore ${seed}: on, the car`);
  check(off.vehicles.length === 0 && off.hardcore.start.car === null && p && !p.vehicle && p.vehicleId == null, `Hardcore ${seed}: off, no car`);
  check(p.cargo.gear.every((it) => it.key === "tent1") && !Object.keys(p.cargo.supplies).length, `Hardcore ${seed}: off, no back and no seat load (${p.cargo.gear.map((it) => it.key)})`);
  const tents = p.cargo.gear.length + off.survivors.filter((x) => x.gear.carry && x.gear.carry.key === "tent1").length;
  check(tents === off.survivors.length, `Hardcore ${seed}: the tents go with them (${tents})`);
  check(off.hardcore.start.grabbed.some((l) => /on foot/.test(l)) && off.log.some((l) => /on foot/.test(l.text)), `Hardcore ${seed}: the start says on foot`);
  const where = (s) => JSON.stringify([s.parties.map((q) => q.path && q.path[0]), s.survivors.map((x) => [x.name, x.background]), s.factions.map((f) => f.name), (s.hives || []).map((h) => h.tile)]);
  check(where(on) === where(off), `Hardcore ${seed}: the same start, crew, groups and hives either way`);
  if (seed === 9) { runDay(off); check(!off.gameOver && off.survivors.some((x) => x.alive), "Hardcore on foot: a day ticks"); }
}

section("4. Save and load");
{
  const s = createWorld({ seed: 14, factionCount: 7, custom: { people: 10, groups: 3, hives: 5, cities: 2, towns: 8, military: 2 }, vehicle: false });
  const back = loadFromString(saveToString(s));
  check(back.mode === "normal" && JSON.stringify(back.custom) === JSON.stringify(s.custom) && isCustomRun(back), "a Custom run loads as Custom with its counts");
  check(back.startVehicles === false && !startsWithVehicle(back) && back.survivors.length === 10, "and with Start with a vehicle off, its 10 survivors");
  const hw = createWorld({ seed: 14, factionCount: 7, mode: "hardcore", vehicle: false });
  hw.cards = []; // the opening card (a card waiting cannot be saved)
  const h = loadFromString(saveToString(hw));
  check(h.mode === "hardcore" && h.startVehicles === false && h.hardcore.start.car === null, "a Hardcore run on foot loads on foot");
}

section("5. The new-run screen");
{
  const c = { people: 9, groups: 3, hives: 5, cities: 2, towns: 8, military: 2 };
  const s = createWorld({ seed: 17, factionCount: 7, custom: c, vehicle: false });
  const html = newRunScreen(s, { mode: "custom", worldSize: "normal", factionCount: 7, nrMsg: "", startPeople: 9 });
  check(/<option value="custom" selected/.test(html), "Mode shows Custom");
  for (const k of CUSTOM_KEYS) {
    const m = new RegExp(`<label data-tip="([^"]*)">[^<]*<input type="number" min="1" max="${CUSTOM_RUN[k].MAX}"[^>]*data-action="nr-custom" data-k="${k}" value="(\\d+)"`).exec(html);
    check(m && Number(m[2]) === (k === "people" ? 9 : c[k]) && m[1].length > 40, `the ${k} input, its value and a tip`);
  }
  check(!/data-action="startpeople"/.test(html) && !/data-action="factioncount"/.test(html) && !/data-action="hivecount"/.test(html), "Starting people, AI groups and Starting hives give way to them");
  check(/data-action="nr-vehicle"(?! checked)/.test(html) && /No vehicle/.test(html), "the vehicle box unticked, the intro says no vehicle");
  check(/Custom: a normal start with the counts you set \(9 survivors, 3 AI groups, 5 hives, 2 cities, 8 towns and 2 military sites\)/.test(html), "the intro for Custom");
  for (const mode of ["normal", "hardcore"]) {
    const w = createWorld({ seed: 17, factionCount: 7, mode });
    const h = newRunScreen(w, { mode, worldSize: "normal", factionCount: 7, nrMsg: "" });
    check(/<label data-tip="[^"]{40,}"><input type="checkbox" data-action="nr-vehicle" checked> Start with a vehicle<\/label>/.test(h), `${mode}: the vehicle box, ticked, with a tip`);
    check(/data-action="startpeople"/.test(h) && /data-action="factioncount"/.test(h) && !/data-action="nr-custom"/.test(h), `${mode}: the usual selects, no Custom inputs`);
    const wOff = createWorld({ seed: 17, factionCount: 7, mode, vehicle: false });
    check(/data-action="nr-vehicle">/.test(newRunScreen(wOff, { mode, worldSize: "normal", factionCount: 7, nrMsg: "" })), `${mode}: the vehicle box unticked when off`);
  }
  // Each mode its own settings.
  const ui = { mode: "custom", startPeople: 14, pointsMax: 90, startVehicle: false, modeSets: { normal: { startPeople: 5, pointsMax: 100, startVehicle: true, other: "kept" }, hardcore: { startPeople: 2, pointsMax: 80, startVehicle: false }, custom: {} } };
  stashModeSet(ui);
  takeModeSet(ui, "normal");
  check(ui.mode === "normal" && ui.startPeople === 5 && ui.pointsMax === 100 && ui.startVehicle === true, "takeModeSet: Normal's own settings");
  check(ui.modeSets.custom.startPeople === 14 && ui.modeSets.custom.pointsMax === 90 && ui.modeSets.custom.startVehicle === false, "stashModeSet: Custom's put away");
  stashModeSet(ui);
  check(ui.modeSets.normal.other === "kept", "stashModeSet keeps what else a mode's entry holds");
  takeModeSet(ui, "custom");
  check(ui.startPeople === 14 && ui.startVehicle === false, "and Custom's come back");
  let picked = new Set();
  for (let i = 0; i < 12; i++) {
    const u = { mode: "custom", startPeople: 20, pointsMax: 90, startVehicle: false, factionCount: 7, modeSets: { normal: { startPeople: 6, pointsMax: 100, startVehicle: true }, hardcore: { startPeople: 3, pointsMax: 100, startVehicle: true }, custom: {} } };
    const line = rollRandomRun(u, new Rng(100 + i));
    picked.add(u.mode);
    check(u.mode !== "custom" && u.modeSets.custom.startPeople === 20 && u.modeSets.custom.startVehicle === false && /A random run: (Normal|Hardcore)/.test(line), `Random run ${i} from Custom: ${u.mode}, Custom's set kept`);
    check(u.startVehicle === true && u.startPeople >= peopleRange(u.mode).MIN && u.startPeople <= peopleRange(u.mode).MAX, `Random run ${i}: the new mode's own vehicle box and a count in its range`);
  }
  check(picked.size === 2, "Random run picks both Normal and Hardcore");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  check(/"nr-vehicle": \(el\)/.test(main) && /"nr-custom": \(el\)/.test(main), "main.js handles the vehicle box and the Custom inputs");
  check(/el\.value === "custom" \? "custom"/.test(main) && /custom: \{ startPeople: peopleRange\("custom"\)\.DEF/.test(main), "main.js: the gamemode select takes Custom, ui.modeSets has its entry");
  check(/mode: custom \? "normal" : ui\.mode/.test(main) && /vehicle: ui\.startVehicle !== false, custom: custom \? \{ \.\.\.ui\.custom, people: ui\.startPeople \}/.test(main), "main.js builds a Custom world as a normal one with its counts, and passes the vehicle box");
  check(/isCustomRun\(state\) \? "custom" : state\.mode/.test(main) && /ui\.startVehicle = startsWithVehicle\(state\)/.test(main), "main.js adopt: a loaded Custom run's mode, counts and vehicle box");
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
