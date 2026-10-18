// The kept pictures after a lost GPU context (src/ui/pictures.js; README "Lost pictures drawn again"), on stub canvases:
// - every module with a picture cache (sprites, figures, the battle's ground, fog, edge and light masks, the marks,
//   the map's chunks, shade, clouds, minimap, gun art) registers how to forget it; forgetPictures drops them all;
// - a battle frame that changes nothing makes no canvas; after forgetPictures the next frame makes the ground, the
//   fog and the sprites again (the builds counted, canvases made);
// - the battle canvas is watched: contextlost is counted, contextrestored forgets the pictures once for a burst of
//   restores within the gap and again after it, with one console warning each time;
// - the sentinel (checkPictures, once a second from the frame loop): intact it forgets nothing; found blank the
//   pictures are forgotten and it is made again; blank CHECK.giveUp times running the check gives up with a word;
//   a canvas that cannot be read, or a hidden page, is no verdict;
// - a canvas that cannot report (the tools' stubs) is left alone; the sim is untouched by any of it.
// Usage: node tools/picturestest.js
import { battles } from "./isobattles.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();

let made = 0, nan = 0;
const silent = (cv) => new Proxy({ createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: (img) => { cv.img = img; }, measureText: (t) => ({ width: String(t).length * 6 }) }, {
  get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
  set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; o[k] = v; return true; },
});
const cvs = (w, h) => { made++; const cv = { width: w, height: h, toDataURL: () => "data:," }; const g = silent(cv); cv.getContext = () => g; return cv; };
globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const warnings = [];
const warn0 = console.warn;
console.warn = (...a) => { warnings.push(a.join(" ")); };

const PIC = await import("../src/ui/pictures.js");
const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
await import("../src/ui/render.js"); // the map side registers its caches too (chunks, shade, clouds, minimap, map sprites and figures)
ISO.setIsoCanvas(cvs);
// The battle canvas, able to report its context's loss (as a browser's can).
const listeners = {};
const main = { clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent({}), addEventListener: (k, fn) => { (listeners[k] || (listeners[k] = [])).push(fn); } };
const fire = (k) => { for (const fn of listeners[k] || []) fn({ type: k }); };
UI.initCombatUI(main);
let clock = 1e6;
const draw = (st) => { try { clock += 50; UI.drawCombat(st, clock); return ""; } catch (e) { return e.stack.split("\n").slice(0, 3).join(" "); } };

// ---------- 1. the caches, forgotten ----------
console.log("The pictures forgotten and drawn again");
{
  check(!!listeners.contextlost && !!listeners.contextrestored, "the battle canvas is watched for contextlost and contextrestored");
  check(PIC.watchCanvas({ getContext: () => null }) === false && PIC.watchCanvas(null) === false, "a canvas that cannot report (a stub) is left alone");
  check(PIC.contextLost(null) === false && PIC.contextLost({}) === false && PIC.contextLost({ isContextLost: () => true }) === true, "contextLost reads the context's own word, false without one");
  const { st, b } = battles(45, ["base-wall-night"])[0];
  b.night = true;
  const e = draw(st);
  check(!e, `a night battle drawn${e ? `: ${e}` : ""}`);
  draw(st);
  const before = JSON.stringify(b); // after the first frames: what the view keeps on the battle for a save (b.seenMemo) is there already
  const first = made, b0 = { ...ISO.iso.builds };
  draw(st); draw(st);
  check(made === first, `a frame that changes nothing makes no canvas (${made} made so far)`);
  const n = PIC.forgetPictures("the test");
  check(n >= 12, `forgetPictures drops every registered cache (${n} caches: the battle view, the edge, the lights, the marks, the sprites and figures of every kind, the map's chunks, shade and clouds, the gun art)`);
  check(PIC.pictureStats.forgotten === 1 && PIC.pictureStats.why === "the test", "the forget is counted, with its reason");
  const e2 = draw(st);
  check(!e2, `the next frame draws without error${e2 ? `: ${e2}` : ""}`);
  const B = ISO.iso.builds;
  check(B.ground > b0.ground && B.fog > b0.fog && B.sprites > b0.sprites && B.scene > b0.scene, `the ground, the fog, the scene and the sprites are built again (ground +${B.ground - b0.ground}, fog +${B.fog - b0.fog}, sprites +${B.sprites - b0.sprites}, scene +${B.scene - b0.scene})`);
  check(made > first, `canvases are made again for the kept pictures (${made - first} made)`);
  const again = made;
  draw(st); draw(st);
  check(made === again, "and kept once more: a frame after that makes none");
  check(JSON.stringify(b) === before, "the battle is untouched by the forgetting and the frames after it");
  check(!nan, `no NaN reached a canvas (${nan})`);
}

// ---------- 2. the canvas's own report ----------
console.log("The canvas reporting its context lost and back");
{
  const f0 = PIC.pictureStats.forgotten, w0 = warnings.length;
  fire("contextlost");
  check(PIC.pictureStats.lost === 1 && PIC.pictureStats.forgotten === f0, "contextlost is counted and forgets nothing yet (the canvas is blank anyway)");
  fire("contextrestored");
  fire("contextrestored"); // the map's canvas reporting too, in the same burst
  check(PIC.pictureStats.forgotten === f0 + 1 && PIC.pictureStats.restored === 2, `a burst of restores forgets the pictures once (forgotten ${PIC.pictureStats.forgotten - f0}, restores ${PIC.pictureStats.restored})`);
  check(warnings.length === w0 + 1 && /graphics context was lost/.test(warnings[w0] || ""), "one console warning says what happened");
  PIC.PICTURES.gap = 0;
  fire("contextrestored");
  check(PIC.pictureStats.forgotten === f0 + 2, "a restore after the gap forgets them again");
  PIC.PICTURES.gap = 1000;
  const { st } = battles(46, ["raid"])[0];
  const e = draw(st);
  check(!e, `a raid drawn after it all${e ? `: ${e}` : ""}`);
}

// ---------- 3. the sentinel ----------
console.log("The sentinel: a kept picture found blank");
{
  // Canvases that carry a colour: a fill paints it, drawImage copies the source's (nothing while "lost"), the probe reads it.
  let lost = false;
  const pix = () => { const cv = { width: 0, height: 0, col: null }; cv.getContext = () => ({ set fillStyle(v) { cv.fill = v; }, fillRect() { cv.col = [255, 128, 64, 255]; }, drawImage(src) { cv.col = lost ? null : src.col; }, getImageData: () => ({ data: cv.col || [0, 0, 0, 0] }) }); return cv; };
  const doc0 = globalThis.document;
  globalThis.document = { createElement: () => pix(), visibilityState: "visible" };
  PIC.resetPictureCheck();
  const f0 = PIC.pictureStats.forgotten, c0 = PIC.pictureStats.checks;
  check(PIC.checkPictures(0) === true && PIC.checkPictures(500) === null && PIC.checkPictures(1000) === true, "an intact sentinel reads back, once a second, and forgets nothing");
  check(PIC.pictureStats.forgotten === f0 && PIC.pictureStats.checks === c0 + 2, "no forget from an intact picture");
  lost = true; // every kept canvas blank from here (the sentinel too)
  PIC.PICTURES.gap = 0;
  check(PIC.checkPictures(2000) === false && PIC.pictureStats.forgotten === f0 + 1 && PIC.pictureStats.blank === 1, "found blank: the pictures are forgotten and the sentinel made again");
  lost = false;
  check(PIC.checkPictures(3000) === true && PIC.pictureStats.forgotten === f0 + 1, "the new sentinel intact: nothing more forgotten");
  lost = true;
  let t = 4000, r = [];
  for (let i = 0; i < 7; i++, t += 1000) r.push(PIC.checkPictures(t));
  check(PIC.pictureStats.gaveUp && PIC.pictureStats.forgotten === f0 + 1 + PIC.CHECK.giveUp - 1 && r.slice(0, 5).every((x) => x === false) && r.slice(5).every((x) => x === null), `blank ${PIC.CHECK.giveUp} times running: the check gives up, having forgotten ${PIC.CHECK.giveUp - 1} more times, and no more`);
  check(/not keeping pictures/.test(warnings[warnings.length - 1] || ""), "and says so once");
  PIC.resetPictureCheck();
  globalThis.document = { createElement: () => { throw new Error("no canvas"); }, visibilityState: "visible" };
  check(PIC.checkPictures(1e5) === null && !PIC.pictureStats.gaveUp, "a canvas that cannot be read is no verdict");
  globalThis.document = { ...doc0, visibilityState: "hidden" };
  check(PIC.checkPictures(2e5) === null, "a hidden page is not checked");
  globalThis.document = doc0;
  PIC.resetPictureCheck();
  PIC.PICTURES.gap = 1000;
}
console.warn = warn0;

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
