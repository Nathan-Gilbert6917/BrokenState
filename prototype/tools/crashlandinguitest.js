// Crashlanding's new-run screen (2026-10-24, user request: "Add a new scenario start to the Normal Hardcore Custom called
// Crashlanding ... The starting character can be customized but will start with military gear ... You cannot customize
// anything beside the traits, skills and character look. You do not start with a vehicle. The preamble should
// summaries what I said above and the begin button say Survive"; sim/crashmode.js, sim/hardcore.js MODES, ui/newgame.js,
// ui/hardcore.js, sim/custompoints.js, sim/save.js, main.js):
//   1. Crashlanding is the fourth Mode (MODES.crash), its people range the one survivor;
//   2. a crash world's screen: "▶ Survive", the preamble (the ? button's hover) names the helicopter, the broken radio,
//      the 500 × 250 map and the unit's base; no vehicle box, no Starting vehicles, no Background select or dice, no
//      Gear…, Gear or Build buttons (Customize on or off); World size and Starting people locked; screenMode and
//      modeLabel say Crashlanding; the save list's summary too;
//   3. the points: the fixed kit costs nothing, skills and traits are priced as ever;
//   4. a Normal world's screen still has "▶ Start", its vehicle box and its gear controls, and prices the kit;
//   5. each mode keeps its own settings (stashModeSet / takeModeSet) and a Random run from Crashlanding picks Normal
//      or Hardcore; main.js wires the mode up (runOpts, the gamemode select, ui.modeSets, adopt).
// Usage: node tools/crashlandinguitest.js
import { readFileSync } from "node:fs";
import { createWorld } from "../src/sim/world.js";
import { CRASH, CRASH_PEOPLE, isCrashRun } from "../src/sim/crashmode.js";
import { MODES, peopleRange, clampStartPeople } from "../src/sim/hardcore.js";
import { pricePerson } from "../src/sim/custompoints.js";
import { saveMeta } from "../src/sim/save.js";
import { newRunScreen, screenMode, stashModeSet, takeModeSet, rollRandomRun, crashKitWords } from "../src/ui/newgame.js";
import { modeLabel } from "../src/ui/hardcore.js";
import { Rng } from "../src/sim/rng.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
const uiFor = (mode, extra = {}) => ({ mode, worldSize: "normal", factionCount: 7, nrMsg: "", startPeople: peopleRange(mode).DEF, pointsMax: 90, ...extra });
const preamble = (html) => { const m = /<button class="mini nr-why" data-tip="([^"]*)">\?<\/button>/.exec(html); return m ? m[1] : ""; };
const PICKS = { slots: { weapon: "ar", armor: "plate", backpack: "rucksack" }, carry: { pocket: ["frag"], pouch: [], pack: ["candy"] } };

section("1. The mode");
check(MODES.crash && MODES.crash.label === "Crashlanding" && MODES.crash.tip && /kit/.test(MODES.crash.tip), "Crashlanding is in the Mode list with a tip that names the kit");
check(Object.keys(MODES).join() === "normal,hardcore,custom,crash", `after Custom (${Object.keys(MODES).join()})`);
check(peopleRange("crash") === CRASH_PEOPLE && clampStartPeople(5, "crash") === 1 && clampStartPeople("junk", "crash") === 1, "the people range is the one survivor");
check(/Military carbine/.test(crashKitWords()) && /Plate carrier/.test(crashKitWords()) && /STANAG/.test(crashKitWords()), `the kit in words: ${crashKitWords()}`);

section("2. A crash world's screen");
const tBuild = Date.now();
const s = createWorld({ seed: 7, factionCount: 7, crash: true });
console.log(`  (a crash world built in ${((Date.now() - tBuild) / 1000).toFixed(1)} s)`);
check(isCrashRun(s) && s.mode === "normal" && screenMode(s) === "crash" && modeLabel(s) === "Crashlanding", "a crash world is a normal-mode run that the screen calls Crashlanding");
check(s.grid.width === CRASH.W && s.grid.height === CRASH.H, `the grid is ${CRASH.W} × ${CRASH.H} (${s.grid.width} × ${s.grid.height})`);
check(s.survivors.length === 1, `one survivor (${s.survivors.length})`);
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const home = esc((s.crash && s.crash.homeName) || "your unit's base"); // as the HTML carries it
for (const free of [false, true]) {
  const tag = free ? "Customize on" : "Customize off";
  const html = newRunScreen(s, uiFor("crash", { freeEdit: free }));
  check(/<button class="primary" data-action="begin" data-tip="[^"]{40,}">▶ Survive<\/button>/.test(html) && !/▶ Start</.test(html), `${tag}: the begin button says ▶ Survive, with a tip`);
  check(/<option value="crash" selected/.test(html), `${tag}: Mode shows Crashlanding`);
  const p = preamble(html);
  check(p.length > 300, `${tag}: the ? button carries the whole preamble (${p.length} chars)`);
  check(/helicopter/i.test(p) && /sole survivor/i.test(p), `${tag}: the preamble names the helicopter and the sole survivor`);
  check(/radio is broken/i.test(p) && /soldering iron/i.test(p), `${tag}: the broken radio and its repair`);
  check(p.includes(`${CRASH.W} × ${CRASH.H}`), `${tag}: the ${CRASH.W} × ${CRASH.H} map`);
  check(p.includes(home) && /far side|across/.test(p), `${tag}: the unit's base (${home}) across the map`);
  check(/three years after/i.test(p) && /Calder/.test(p), `${tag}: three years after the fall of Calder`);
  check(/no base and no vehicle/i.test(p) && /wreck/.test(p) && /loud/.test(p), `${tag}: no base, no vehicle, the loud crash and the wreck to raid`);
  check(/Military carbine/.test(p) && /cannot be changed/.test(p), `${tag}: the kit, which cannot be changed`);
  check(!/Hives and Hordes/.test(p) && !/In an out raids/i.test(p), `${tag}: the user's later notes are not in the preamble`);
  check(/Crashlanding: three years after the fall/.test(html) && /No vehicle: you walk/.test(html), `${tag}: the one-line intro and "No vehicle: you walk"`);
  check(!/data-action="nr-vehicle"/.test(html) && !/fleet-add/.test(html) && !/Starting vehicles/.test(html.replace(/data-tip="[^"]*"/g, "")), `${tag}: no vehicle box, no Starting vehicles`);
  check(!/data-action="nr-bg"/.test(html) && !/data-action="nr-rand-bg"/.test(html) && !/data-action="bg-open"/.test(html), `${tag}: no Background select, dice or Backgrounds…`);
  check(!/data-action="sg-open"/.test(html) && !/data-action="nr-rand-gear"/.test(html) && !/data-action="sg-build"/.test(html), `${tag}: no Gear…, Gear or Build`);
  check(/data-action="worldsize" disabled/.test(html) && html.includes(`${CRASH.W} × ${CRASH.H} (Crashlanding)`) && !/data-action="customw"/.test(html), `${tag}: World size locked at ${CRASH.W} × ${CRASH.H}, no custom size row`);
  check(/data-action="startpeople" disabled/.test(html) && !/data-action="nr-custom"/.test(html), `${tag}: Starting people locked at 1, no Custom inputs`);
  check(/data-action="seed"/.test(html) && /data-action="factioncount"/.test(html) && /data-action="hivecount"/.test(html) && /data-action="ironman"/.test(html) && /data-action="nr-free"/.test(html) && /data-action="nr-start"/.test(html) && /data-action="nr-pick"/.test(html) && /data-action="nr-newmap"/.test(html), `${tag}: Seed, AI groups, Starting hives, Ironman, Customize, New map, New start position and Pick start on map stay`);
  check(/another crash site, the unit's base across the map from it/.test(html), `${tag}: New start position's tip says what it does for a crash`);
  check(/data-action="nr-rand-traits"/.test(html) && /data-action="nr-look"/.test(html) && /data-action="nr-all"/.test(html) && /data-action="nr-name"/.test(html), `${tag}: name, look, traits and Everything still roll`);
  check(/What they start with: [^"]*Military carbine/.test(html), `${tag}: the crew card's "What they start with" lists the kit`);
  if (free) {
    check(/data-action="sg-dice"/.test(html) && /data-action="sg-blank"/.test(html) && /data-action="nr-ownpoints"/.test(html) && /data-action="nr-points"/.test(html) && /data-action="nr-everything"/.test(html), "Customize on: Start from the dice, Clear, the points boxes and Randomize everything stay");
    check(/The unit&#39;s kit, free|The unit's kit, free/.test(html), "Customize on: the card says the kit is free");
  } else check(/data-action="nr-allcrew"/.test(html) && /data-action="nr-skills"/.test(html), "Customize off: Randomize all and the Skills dice stay");
}
check(/^Crashlanding · Day /.test(saveMeta(s).summary) && saveMeta(s).mode === "normal", `the save list's summary names it (${saveMeta(s).summary})`);

section("3. The points");
{
  const x = s.survivors[0];
  const was = x.startGear;
  x.startGear = PICKS;
  const B = pricePerson(s, x);
  check(B.gear === 0 && B.carried === 0, `the kit costs nothing (gear ${B.gear}, carried ${B.carried})`);
  check(B.skills > 0 && B.total === B.skills + B.good + B.back + B.extra, `skills and traits are priced as ever (skills ${B.skills}, total ${B.total})`);
  check(B.lines.some((l) => /unit's issue/.test(l)), "the bill says the kit is the unit's issue");
  x.startGear = was;
}

section("4. A Normal world's screen");
{
  const n = createWorld({ seed: 7, factionCount: 7 });
  check(!isCrashRun(n) && screenMode(n) === "normal" && modeLabel(n) === "Normal" && n.crash === undefined, "a plain normal world is not Crashlanding");
  const html = newRunScreen(n, uiFor("normal"));
  check(/▶ Start<\/button>/.test(html) && !/Survive/.test(html), "▶ Start");
  check(/data-action="nr-vehicle" checked/.test(html) && /data-action="nr-rand-gear"/.test(html) && /data-action="nr-rand-bg"/.test(html) && /data-action="worldsize">/.test(html) && /data-action="startpeople">/.test(html), "the vehicle box, Gear, Background, World size and Starting people as ever");
  const h2 = newRunScreen(n, uiFor("normal", { freeEdit: true }));
  check(/data-action="sg-open"/.test(h2) && /data-action="sg-build"/.test(h2) && /data-action="bg-open"/.test(h2) && /data-action="nr-bg"/.test(h2), "Customize on: Gear…, Build, Backgrounds… and the Background select");
  const x = n.survivors[0], was = x.startGear;
  x.startGear = PICKS;
  check(pricePerson(n, x).gear > 0 && pricePerson(n, x).carried > 0, "a normal start prices the kit");
  x.startGear = was;
  check(!/Crashlanding/.test(saveMeta(n).summary), "its save summary does not say Crashlanding");
}

section("5. Each mode its own settings; main.js");
{
  const ui = { mode: "crash", startPeople: 1, pointsMax: 120, startVehicle: false, fleet: [], modeSets: { normal: { startPeople: 5, pointsMax: 100, startVehicle: true }, hardcore: { startPeople: 2, pointsMax: 80, startVehicle: false }, custom: {}, crash: {} } };
  stashModeSet(ui);
  takeModeSet(ui, "normal");
  check(ui.mode === "normal" && ui.startPeople === 5 && ui.pointsMax === 100 && ui.startVehicle === true, "takeModeSet: Normal's own settings");
  check(ui.modeSets.crash.startPeople === 1 && ui.modeSets.crash.pointsMax === 120 && ui.modeSets.crash.startVehicle === false, "stashModeSet: Crashlanding's put away");
  stashModeSet(ui);
  takeModeSet(ui, "crash");
  check(ui.mode === "crash" && ui.startPeople === 1 && ui.pointsMax === 120, "and come back");
  takeModeSet(ui, "crash"); ui.startPeople = 9; stashModeSet(ui); takeModeSet(ui, "crash");
  check(ui.startPeople === 1, "Crashlanding's Starting people clamps to 1");
  const picked = new Set();
  for (let i = 0; i < 8; i++) {
    const u = { mode: "crash", startPeople: 1, pointsMax: 120, startVehicle: false, factionCount: 7, modeSets: { normal: { startPeople: 6, pointsMax: 100, startVehicle: true }, hardcore: { startPeople: 3, pointsMax: 100, startVehicle: true }, custom: {}, crash: {} } };
    const line = rollRandomRun(u, new Rng(200 + i));
    picked.add(u.mode);
    check((u.mode === "normal" || u.mode === "hardcore") && u.modeSets.crash.pointsMax === 120 && /A random run: (Normal|Hardcore)/.test(line), `Random run ${i} from Crashlanding: ${u.mode}, its set kept`);
  }
  check(picked.size === 2, "Random run picks both Normal and Hardcore, never Crashlanding");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  check(/el\.value === "crash" \? "crash"/.test(main) && /crash: \{ startPeople: peopleRange\("crash"\)\.DEF/.test(main), "main.js: the gamemode select takes Crashlanding, ui.modeSets has its entry");
  check(/const custom = ui\.mode === "custom", crash = ui\.mode === "crash"/.test(main) && /\.\.\.\(crash \? \{ mode: "normal", crash: true, custom: null, vehicle: false, fleet: \[\], startPeople: 1 \} : \{\}\)/.test(main), "main.js runOpts builds a Crashlanding world as a normal-mode one with crash, one survivor, no vehicle, no fleet, no Custom counts");
  check(/isCrashRun\(state\) \? "crash" : isCustomRun\(state\) \? "custom" : state\.mode/.test(main), "main.js adopt: a loaded Crashlanding run comes back as Crashlanding");
  check(/"nr-rand-bg": \(d\) => \{\n[^\n]*\n[^\n]*isCrashRun\(state\)\) return;/.test(main) && /"nr-bg": \(el\) => \{\n[^\n]*isCrashRun\(state\)\) return;/.test(main), "main.js: the background handlers do nothing in a crash run");
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
