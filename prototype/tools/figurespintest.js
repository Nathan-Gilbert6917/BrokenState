// The inventory's figure turned by hand (src/ui/figures.js figureSpinImg and the hand helpers; drawn on a stub
// canvas, no DOM, the exported helpers driven directly):
// - a figure starts on the automatic spin: not manual, its frame the clock's;
// - a drag of 60 px turns it four steps of 15° (HAND.PX a step, a degree a pixel) and makes it manual; the
//   remainder of a short move is kept for the next one;
// - the ticker (spinTick) leaves a manual figure alone: its yaw stays, its img shows its own frame while an
//   automatic one's shows the clock's;
// - a wheel notch turns one step, down one way and up the other; a hold stops it where the spin had it;
// - ↻ Spin (spinFigure) puts it back on the clock, and a later hold starts from the clock's frame again;
// - the frame URL for a yaw is figureCanvas's at that yaw rounded to STEP;
// - the markup: the img[data-spin], the ↻ Spin button hidden until the figure is manual, the tip; two figures
//   keep their own state; the battle map's figureCanvas cache is untouched by a turn;
// - the module imports cleanly without window or document (the tools do), and the inventory, the battle's peek
//   and the loot screen show the figure.
// Usage: node tools/figurespintest.js [seed]   (a few seconds)
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorld, makeSurvivor, hub } from "../src/sim/world.js";
import { makeItem } from "../src/sim/crafting.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(t);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- headless: the module without a page ----------
section("Headless import");
{
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `const F = await import(${JSON.stringify("file://" + join(root, "src/ui/figures.js").replace(/\\/g, "/"))}); console.log(typeof F.figureSpinImg, typeof F.dragFigure);`], { encoding: "utf8" });
  check(r.status === 0 && /^function function/.test(r.stdout.trim()), `figures.js imports without window or document (${r.status === 0 ? "ok" : (r.stderr || "").split("\n")[0]})`);
}

// ---------- the page: a stub canvas (a URL of its own per canvas), a stub document with the figures' imgs ----------
// The page's img[data-spin] and button[data-figreset] elements, as figureSpinImg's markup would make them.
const page = [];
const pageOf = (html) => { // the elements of a figureSpinImg's markup
  const key = /data-spin="([^"]*)"/.exec(html)[1], src = /src="([^"]*)"/.exec(html)[1], hidden = / hidden>/.test(html);
  const img = { tag: "img", dataset: { spin: key }, src }, btn = { tag: "button", dataset: { figreset: key }, hidden };
  page.push(img, btn);
  return { key, img, btn };
};
let cvN = 0;
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ data: new Uint8ClampedArray(4) })), set: (t, k, v) => ((t[k] = v), true) });
globalThis.document = {
  createElement: () => { const n = ++cvN; return { width: 0, height: 0, getContext: () => ctx, toDataURL: () => `data:cv${n}` }; },
  querySelectorAll: (sel) => page.filter((e) => e.tag === (sel.startsWith("img") ? "img" : "button")),
};
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = () => 1; // the ticker is driven by hand here (spinTick), and the process must exit
const F = await import("../src/ui/figures.js");
globalThis.setInterval = realSetInterval;
const { HAND, figureSpinImg, figureCanvas, spinURL, spinArgs, spinTick, spinFrame, frameOfYaw, clockFrame, handOf, holdFigure, dragFigure, wheelFigure, turnFigure, spinFigure } = F;
const STEP = 15;

const state = createWorld({ seed, factionCount: 5 });
const h = hub(state);
const s = makeSurvivor(state);
s.location = { kind: "base", baseId: h.id };
state.survivors.push(s);
s.gear.weapon = makeItem("pistol");
const s2 = makeSurvivor(state);
s2.location = { kind: "base", baseId: h.id };
state.survivors.push(s2);
s2.gear.backpack = makeItem("backpack");

section("A figure starts automatic");
const T0 = 1_000_000; // a clock: frame floor(T0 / 110) % 24
const A = pageOf(figureSpinImg(state, s, 7));
check(A.key && A.img.src.startsWith("data:cv"), `the markup has an img[data-spin] with a frame (${A.img.src})`);
check(!handOf(A.key).manual && handOf(A.key).yaw === 0, "not manual, yaw 0");
check(spinFrame(A.key, T0) === clockFrame(T0) && clockFrame(T0) === Math.floor(T0 / 110) % 24, "its frame is the clock's");
check(A.btn.hidden, "the ↻ Spin button is hidden while it spins by itself");
check(/data-tip="Drag the figure/.test(figureSpinImg(state, s, 7)), "the tip says how to turn it");

section("A drag of 60 px turns it four steps and makes it manual");
{
  const start = clockFrame(T0) * STEP;
  const hd = dragFigure(A.key, 60, T0);
  check(hd.manual, "manual after the drag");
  check(hd.yaw === (start + 4 * STEP) % 360, `turned 4 steps from where the spin had it (${start}° → ${hd.yaw}°)`);
  check(HAND.PX === 15 && 60 / HAND.PX === 4, "a step every 15 px: a degree a pixel");
  check(A.img.src === spinURL(A.key, frameOfYaw(hd.yaw)), "the page's img shows its frame at once");
  check(!A.btn.hidden, "the ↻ Spin button shows");
  check(/Turned by hand/.test(figureSpinImg(state, s, 7)) && !/ hidden>/.test(figureSpinImg(state, s, 7)), "rebuilt markup: the manual frame, the button up, the tip says so");
  const y = hd.yaw;
  dragFigure(A.key, 7, T0 + 10);
  check(handOf(A.key).yaw === y && handOf(A.key).rem === 7, "7 px: no step yet, the remainder kept");
  dragFigure(A.key, 8, T0 + 20);
  check(handOf(A.key).yaw === (y + STEP) % 360 && handOf(A.key).rem === 0, "another 8 px: a step, the remainder spent");
  dragFigure(A.key, -45, T0 + 30);
  check(handOf(A.key).yaw === ((y + STEP - 3 * STEP) % 360 + 360) % 360, "a drag back turns it back three steps");
  check(handOf(A.key).lastInput === T0 + 30, "lastInput is the last move's time");
}

section("The tick leaves a manual figure alone");
{
  const y = handOf(A.key).yaw;
  const B = pageOf(figureSpinImg(state, s2, 7)); // a second, automatic figure
  check(B.key !== A.key, "two looks: two figures with their own state");
  for (const now of [T0 + 110, T0 + 220, T0 + 5000]) spinTick(now);
  check(handOf(A.key).yaw === y && handOf(A.key).manual, "the manual figure's yaw and state unchanged by three ticks");
  check(A.img.src === spinURL(A.key, frameOfYaw(y)), "its img keeps its own frame");
  check(B.img.src === spinURL(B.key, clockFrame(T0 + 5000)) && !handOf(B.key).manual, "the automatic figure's img shows the clock's frame");
  check(spinFrame(A.key, T0 + 5000) === frameOfYaw(y) && spinFrame(B.key, T0 + 5000) === clockFrame(T0 + 5000), "spinFrame: the manual one's own, the automatic one's the clock's");
}

section("A wheel notch turns one step");
{
  const y = handOf(A.key).yaw;
  wheelFigure(A.key, 100, T0 + 40);
  check(handOf(A.key).yaw === (y + STEP) % 360, "a notch down: one step");
  wheelFigure(A.key, -100, T0 + 50);
  wheelFigure(A.key, -1, T0 + 60);
  check(handOf(A.key).yaw === ((y - STEP) % 360 + 360) % 360, "notches up: one step back each, whatever the notch's size");
  wheelFigure(A.key, 0, T0 + 70);
  check(handOf(A.key).yaw === ((y - STEP) % 360 + 360) % 360, "a notch of nothing turns nothing");
  const B = page.find((e) => e.tag === "img" && e.dataset.spin !== A.key);
  const hb = wheelFigure(B.dataset.spin, 100, T0 + 80);
  check(hb.manual && hb.yaw === (clockFrame(T0 + 80) * STEP + STEP) % 360, "a wheel on an automatic figure stops it where the spin had it and turns it a step");
  spinFigure(B.dataset.spin);
}

section("Spin resets to automatic");
{
  const hd = spinFigure(A.key);
  check(!hd.manual && hd.rem === 0, "not manual any more");
  check(spinFrame(A.key, T0 + 330) === clockFrame(T0 + 330), "its frame is the clock's again");
  spinTick(T0 + 330);
  check(A.img.src === spinURL(A.key, clockFrame(T0 + 330)), "the tick moves its img again");
  check(A.btn.hidden, "the ↻ Spin button hides");
  check(/ hidden>/.test(figureSpinImg(state, s, 7)) && !/Turned by hand/.test(figureSpinImg(state, s, 7)), "rebuilt markup: the button hidden, the plain tip");
  const held = holdFigure(A.key, T0 + 440);
  check(held.manual && held.yaw === clockFrame(T0 + 440) * STEP, "a hold stops it at the clock's frame");
  const y0 = held.yaw; // (held is the live state: its yaw moves with the turns below)
  check(holdFigure(A.key, T0 + 9000).yaw === y0, "a hold on a held figure changes nothing");
  turnFigure(A.key, 370, T0 + 450);
  check(handOf(A.key).yaw === (y0 + 10) % 360, "turnFigure wraps the yaw into 0–359");
  spinFigure(A.key);
}

section("The frame for a yaw is figureCanvas's at that yaw rounded to STEP");
{
  const sa = spinArgs(A.key);
  check(sa && sa.args.length === 3 && typeof sa.o === "object", "spinArgs gives what the frames are drawn from");
  let all = true;
  for (const yaw of [0, 7, 8, 37, 38, 90, 187, 352, 353, 359, -15, 375]) {
    const cv = figureCanvas(...sa.args, yaw, sa.o);
    if (spinURL(A.key, frameOfYaw(yaw)) !== cv.toDataURL()) { all = false; console.log(`    yaw ${yaw}: frame ${frameOfYaw(yaw)} ${spinURL(A.key, frameOfYaw(yaw))} vs ${cv.toDataURL()}`); }
  }
  check(all, "spinURL(key, frameOfYaw(yaw)) is figureCanvas's data URL at that yaw (rounded to 15°, 24 frames)");
  check(frameOfYaw(0) === 0 && frameOfYaw(7) === 0 && frameOfYaw(8) === 1 && frameOfYaw(359) === 0 && frameOfYaw(-15) === 23 && frameOfYaw(375) === 1, "frameOfYaw rounds and wraps");
  const before = figureCanvas(...sa.args, 45, sa.o);
  dragFigure(A.key, 300, T0 + 500);
  check(figureCanvas(...sa.args, 45, sa.o) === before, "a turn by hand leaves the figure cache (the battle map's frames) as it was");
  spinFigure(A.key);
}

section("The screens show the figure");
{
  const { inventoryModal, INV_ACTIONS } = await import("../src/ui/inventory.js");
  const ui = { inv: null, invSel: null, invMsg: "" };
  INV_ACTIONS["inv-open"](state, ui, { id: String(s.id) });
  const html = inventoryModal(state, ui) || "";
  check(html.includes(`data-spin="${A.key}"`) && html.includes(`data-figreset="${A.key}"`) && /Drag the figure/.test(html), "the inventory: the figure, its ↻ Spin button and the hint");
  ui.inv = { sid: s.id, peek: true };
  state.combat = { over: false, place: "a field", units: [{ side: "player", sid: s.id, id: 1, hp: 10, ap: 2 }] };
  const peek = inventoryModal(state, ui) || "";
  state.combat = null;
  check(peek.includes(`data-spin="${A.key}"`) && /(look only|1 action a move)/i.test(peek) && /Drag the figure to turn it/.test(peek), "the battle's inventory (peek): the same figure, turned the same way");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
