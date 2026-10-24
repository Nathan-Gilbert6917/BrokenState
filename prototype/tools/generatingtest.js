// The "Generating map…" box (2026-10-24, the user's request: "When you choose a map show a generating map popup until
// the map is loaded"; ui/newgame.js generating / generatingHtml, main.js gen, prototype/newrun.css):
//   1. headless (no document) generating runs its fn at once;
//   2. with a document and requestAnimationFrame (stubbed here): the box goes up at once with the size in hexes and the
//      note on big maps; fn waits for two frames and a task; a second request while it waits runs after it, in order;
//      one from inside a running fn runs at once; then the box goes and after() runs once; a fn that throws still
//      takes the box down; quick (the map kept: sim/mapgen.js MAP_CACHE) runs fn at once with no box and after() on the next task, and
//      waits its turn behind a build still waiting for its frames;
//   3. main.js: the first world and every action that builds one (Seed, World size, width and height, Mode, AI groups,
//      Starting hives, the vehicle box, Starting people, the Custom counts, New map, New map and survivors, New start
//      position, Pick start on map, Random run, World… Done, the gear and fleet rebuilds, Randomize all and everything,
//      the cards' dice, Ironman, Customize, the backgrounds window's Done, New campaign, Exit) go through gen(); the CSS
//      has the layer and the spinner; gen() skips the box when the map is kept on the seed being built (a new seed,
//      null, always shows it).
// Usage: node tools/generatingtest.js
import { readFileSync } from "node:fs";
import { generating, generatingHtml, generatingUp } from "../src/ui/newgame.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();

section("1. Headless");
{
  let ran = 0;
  generating(() => { ran++; }, { size: { w: 250, h: 150, label: "Normal" }, after: () => { ran += 10; } });
  check(ran === 1, `no document: fn runs at once, after() does not (${ran})`);
  check(!generatingUp(), "nothing pending");
  const h = generatingHtml({ w: 300, h: 200, label: "Large" });
  check(/Generating map…/.test(h) && /300 × 200 hexes \(Large\), 60,000 in all/.test(h) && /Big maps take a while \(Huge: up to a minute\)/.test(h) && /class="genspin"/.test(h) && /class="box genbox"/.test(h), `the box's HTML: the size in hexes, the note, the spinner (${h.length} chars)`);
  check(/Generating map…/.test(generatingHtml(null)) && !/hexes/.test(generatingHtml(null)), "no size: the title alone");
  check(/&lt;b&gt;/.test(generatingHtml({ w: 1, h: 1, label: "<b>" })), "the label is escaped");
}

section("2. Under a document");
// A stub of what the helper touches: one element made on the body, its class list and HTML; frames run by hand.
const made = [];
const makeEl = () => {
  const el = { id: "", className: "", innerHTML: "", classes: new Set() };
  el.classList = { add: (c) => el.classes.add(c), remove: (c) => el.classes.delete(c), contains: (c) => el.classes.has(c) };
  Object.defineProperty(el, "className", { set(v) { el.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }, get() { return [...el.classes].join(" "); } });
  return el;
};
globalThis.document = { body: { appendChild: (el) => made.push(el) }, getElementById: (id) => made.find((e) => e.id === id) || null, createElement: () => makeEl() };
const frames = [];
globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
const tick = () => { for (const f of frames.splice(0)) f(); };
const settle = () => new Promise((r) => setTimeout(r, 10));
const hidden = (el) => el.classes.has("hidden");
const uncaught = [];
process.on("uncaughtException", (e) => uncaught.push(String(e && e.message)));
{
  const order = [];
  generating(() => order.push("a"), { size: { w: 250, h: 150, label: "Normal" }, after: () => order.push("after") });
  const box = document.getElementById("generating");
  check(!!box && made.length === 1 && !hidden(box), "the box is made on the body and shown at once");
  check(/Generating map…/.test(box.innerHTML) && /250 × 150 hexes \(Normal\), 37,500 in all/.test(box.innerHTML), "it names the size in hexes");
  check(order.length === 0 && generatingUp(), "fn waits for the frames");
  generating(() => order.push("b"), { size: { w: 500, h: 300, label: "Huge" }, after: () => order.push("after-b") });
  check(order.length === 0 && /500 × 300/.test(box.innerHTML), "a second request waits with it (the box shows the newest size)");
  tick();
  check(order.length === 0 && frames.length === 1, "one frame: still waiting");
  tick();
  check(order.length === 0, "two frames: the task is still to come");
  await settle();
  check(order.join() === "a,b,after", `then both run in order and after() once: ${order.join()}`);
  check(hidden(box) && box.innerHTML === "" && !generatingUp(), "the box is down and empty");
  check(made.length === 1, "the same element is used again");
  // A build inside a build (Random run's steps): runs at once, the box being up.
  order.length = 0;
  generating(() => { order.push("c"); generating(() => order.push("c2")); order.push("c3"); }, { after: () => order.push("after2") });
  check(!hidden(box) && /Generating map…/.test(box.innerHTML) && !/hexes/.test(box.innerHTML), "up again (no size given: the title alone)");
  tick(); tick(); await settle();
  check(order.join() === "c,c2,c3,after2", `a nested request runs in place: ${order.join()}`);
  check(hidden(box), "and the box is down");
  // A fn that throws: the box still goes, after() still runs, the error is not swallowed.
  order.length = 0;
  generating(() => { throw new Error("boom in the build"); }, { after: () => order.push("after3") });
  tick(); tick(); await settle();
  check(hidden(box) && order.join() === "after3" && !generatingUp(), "a throwing fn takes the box down and after() runs");
  // quick: the map is kept, so no box; behind a build waiting for its frames it waits its turn under that box.
  order.length = 0;
  generating(() => order.push("q"), { quick: true, after: () => order.push("after-q") });
  check(order.join() === "q" && hidden(box) && !generatingUp(), `quick: fn at once, no box: ${order.join()}`);
  await settle();
  check(order.join() === "q,after-q", `then after() on the next task: ${order.join()}`);
  order.length = 0;
  generating(() => order.push("d"), { after: () => order.push("after-d") });
  generating(() => order.push("q2"), { quick: true, after: () => order.push("after-q2") });
  check(order.length === 0 && !hidden(box), "quick behind a waiting build: it waits too");
  tick(); tick(); await settle();
  check(order.join() === "d,q2,after-d", `then runs after it, in order: ${order.join()}`);
  check(uncaught.some((m) => /boom in the build/.test(m)), `the error still surfaces (${uncaught.join("; ")})`);
}

section("3. main.js and the CSS");
{
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../newrun.css", import.meta.url), "utf8");
  const has = (re, what) => check(re.test(main), `main.js: ${what}`);
  has(/let state = await new Promise\(\(done\) => generating\(\(\) => done\(createWorld\(/, "the first world is built under the box (a top-level await)");
  has(/function gen\(fn, seed = state\.seed\) \{\n  const quick = seed != null && worldMapCached\(\{ \.\.\.runOpts\(\), seed \}\);\n  generating\(fn, \{ size: buildSize\(\), quick, after: \(\) => \{ dirtyNow = true; refresh\(\); \} \}\);\n\}/, "gen() shows the size being built (no box for a kept map) and redraws after");
  has(/function buildSize\(\) \{\n  const crash = ui\.mode === "crash";\n  const d = crash \? crashSizeDef\(\) : ui\.worldSize === "custom" \? customDef\(ui\.customW, ui\.customH\) : sizeDef\(ui\.worldSize\);/, "buildSize: Crashlanding's, the custom or the preset's size");
  has(/seed: \(el\) => \{ const seed = cleanSeed\(el\.value\); gen\(\(\) => newWorld\(seed, true\), seed\); \}/, "Seed");
  has(/factioncount: \(el\) => \{ ui\.factionCount = clampGroups\(ui\.worldSize, el\.value\); gen\(\(\) => newWorld\(state\.seed, true\)\); \}/, "AI groups");
  has(/worldsize: \(el\) => \{[\s\S]{0,600}?\.defGroups;\n    gen\(\(\) => newWorld\(state\.seed, true\)\);\n  \}/, "World size (ui set first, then the build under the new size)");
  has(/customw: \(el\) => \{ ui\.startPick = null; ui\.customW = clampCustomW\(el\.value\); gen\(/, "Width");
  has(/customh: \(el\) => \{ ui\.startPick = null; ui\.customH = clampCustomH\(el\.value\); gen\(/, "Height");
  has(/hivecount: \(el\) => \{ ui\.hiveCount = clampHives\(el\.value\); gen\(/, "Starting hives");
  has(/takeModeSet\(ui, mode\);\n    for \(const s of state\.survivors\) delete s\.ownMax;\n    gen\(\(\) => newWorld\(state\.seed, true\)\);/, "Mode (the set taken first, so the box names the mode's size)");
  has(/"nr-vehicle": \(el\) => \{ if \(ui\.started\) return; ui\.startVehicle = !!el\.checked; gen\(/, "Start with a vehicle");
  has(/el\.value = v;\n    gen\(\(\) => newWorld\(state\.seed, true\)\);/, "the Custom counts");
  has(/startpeople: \(el\) => \{ ui\.startPeople = clampStartPeople\(el\.value, ui\.mode\); ui\.fleet = \(ui\.fleet \|\| \[\]\)\.slice\(0, ui\.startPeople\); gen\(/, "Starting people");
  has(/reroll: \(\) => gen\(\(\) => newWorld\(randomSeed\(\)\), null\)/, "New map and survivors");
  has(/restart: \(\) => gen\(\(\) => newWorld\(randomSeed\(\)\), null\)/, "Restart");
  has(/"nr-newmap": \(\) => \{\n    if \(ui\.started\) return;\n    gen\(\(\) => \{/, "New map");
  has(/"nr-start": \(\) => \{\n    if \(ui\.started\) return;\n    gen\(\(\) => \{/, "New start position");
  has(/const line = rollRandomRun\(ui, freshRng\(\)\);\n    gen\(\(\) => \{\n      newWorld\(randomSeed\(\)\);/, "Random run (the settings rolled first, every step under one box)");
  has(/"nr-allcrew": \(\) => gen\(/, "Randomize all");
  has(/"nr-everything": \(\) => gen\(/, "Randomize everything");
  has(/"nr-rand-gear": \(d\) => gen\(/, "a card's Gear");
  has(/"nr-all": \(d\) => gen\(/, "a card's Everything");
  check((main.match(/gen\(\(\) => \{ newWorld\(state\.seed, true, pickRebuild\(crew\)\); pointsLoad\(\[i\]\); \}\)/g) || []).length === 2, "main.js: a Background pick and the card's Background dice");
  has(/if \(changed\) gen\(\(\) => newWorld\(state\.seed, true\)\)/, "World… Done with a dial moved");
  check((main.match(/if \(r\) gen\(\(\) => gearRebuild\(r === "fleet"\)\)/g) || []).length === 2, "main.js: the gear window's and the Starting vehicles' rebuilds (actions and changes)");
  has(/newWorld: \(\) => gen\(\(\) => newWorld\(randomSeed\(\)\), null\)/, "the menu's New campaign");
  has(/toTitle: \(\) => gen\(\(\) => \{ newWorld\(randomSeed\(\)\); showTitle\(ui\); \}, null\)/, "Exit to the title");
  has(/function pickStartAt\(id\) \{\n[\s\S]{0,400}?\n  gen\(\(\) => \{/, "Pick start on map's click");
  has(/gen\(\(\) => \{\n        newWorld\(state\.seed, true, \{ crew: ironmanCrew\(state\)/, "Ironman ticked with a customized crew");
  has(/gen\(\(\) => \{\n        newWorld\(state\.seed, true, pickRebuild\(back \|\| blankCrew\(state\)\)\);/, "Customize ticked");
  has(/if \(changed\.length\) gen\(\(\) => newWorld\(state\.seed, true\)\)/, "the backgrounds window's Done");
  // Every newWorld call sits inside a gen(...) block, or in one of the helpers gen's fns call (cardRebuild, pointsLoad,
  // gearRebuild): no handler calls it bare on its own line at the handlers' depth.
  const CALLEES = new Set(["newWorld", "cardRebuild", "pointsLoad", "gearRebuild"]);
  let fnName = "";
  const blocks = []; // the indents of the open `gen(() => {` blocks
  const bare = [];
  for (const l of main.split("\n")) {
    const f = /^(?:async )?function (\w+)\(/.exec(l);
    if (f) fnName = f[1];
    const open = /^(\s*).*\bgen\(\(\) => \{\s*(\/\/.*)?$/.exec(l);
    if (open) blocks.push(open[1].length);
    else if (blocks.length && new RegExp(`^\\s{${blocks[blocks.length - 1]}}\\}(, null)?\\);`).test(l)) blocks.pop();
    if (/newWorld\(/.test(l) && !/^\s*\/\/|\bgen\(/.test(l) && !blocks.length && !CALLEES.has(fnName)) bare.push(l.trim());
  }
  check(bare.length === 0 && !blocks.length, `main.js: no world built outside gen (${bare.join(" | ")}${blocks.length ? "; a gen block left open" : ""})`);
  check(/#generating \{ position: fixed; inset: 0; z-index: 38;/.test(css) && /@keyframes gen-spin/.test(css) && /#generating \.genspin \{[^}]*will-change: transform/.test(css) && /prefers-reduced-motion: reduce\) \{ #generating \{ animation: none; \}/.test(css), "newrun.css: the layer, the spinner (a transform the compositor turns), reduce motion");
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
