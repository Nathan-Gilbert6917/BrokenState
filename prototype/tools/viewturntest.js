// The battle view's eight turns (ui/isoview.js isoRotate, viewStep): the four diagonal views and, between them, four
// straight ones looking down the map's rows and columns (a tile a rectangle), on stub canvases:
// - Q / E step through all eight in order and back; eight turns come back to the same view and the same middle of the
//   screen, and every turn keeps the ground at the middle where it was;
// - every layout (tools/isobattles.js) draws in all eight with no error or NaN, the ground of a one-storey map not
//   painted again on turning;
// - the ground pick of each cell's projected middle is that cell in all eight; the full pick there is that cell or a
//   block in front of it on the screen;
// - a straight view is straight: a step along the map's x or y runs straight across or up the screen;
// - isoCenterOn puts a unit on screen (isoOnScreen) in all eight.
// Usage: node tools/viewturntest.js
import { battles } from "./isobattles.js";
import * as C from "../src/sim/combat.js";
import * as K from "../src/ui/keymap.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();

// A 2D context that does nothing and counts NaNs.
let nan = 0;
const recorder = () => {
  const own = { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }), getLineDash: () => [] };
  return new Proxy(own, {
    get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
    set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; o[k] = v; return true; },
  });
};
const silentCvs = (w, h) => ({ width: w, height: h, getContext: () => recorder(), toDataURL: () => "data:," });
globalThis.document = { createElement: () => silentCvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
ISO.setIsoCanvas(silentCvs);
const main = { clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => recorder() };
UI.initCombatUI(main);
K.initKeymap({});
let clock = 1e6;
const draw = (st) => { try { clock += 50; UI.drawCombat(st, clock); return ""; } catch (e) { return e.stack.split("\n").slice(0, 3).join(" "); } };
const ev = (code) => ({ code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {} });
const lift = (b, x, y) => (b.cells[y * b.w + x].k === "void" ? 0 : ISO.liftOf(b)); // isoview.js liftAt
const mid = (b) => ISO.isoPick(b, 800, 450, { noUnits: true, ground: true });

// ---------- 1. Q / E and the middle of the screen ----------
console.log("Eight turns");
{
  const { st, b } = battles(71, ["field-town"])[0];
  draw(st);
  if (b.phase === "deploy") C.combatAct(st, { type: "start" });
  ISO.isoCenterOn(b, b.w >> 1, b.h >> 1, false);
  draw(st);
  const s0 = ISO.viewStep(), cx = ISO.iso.cx, cy = ISO.iso.cy, m0 = mid(b);
  const right = [], left = [];
  let drift = 0, straight = 0;
  for (let k = 0; k < 8; k++) {
    UI.combatKey(st, ev("KeyE"));
    draw(st);
    right.push(ISO.viewStep());
    if (ISO.iso.straight) straight++;
    const m = mid(b);
    if (!m || Math.max(Math.abs(m.x - m0.x), Math.abs(m.y - m0.y)) > 1) drift++;
  }
  check(right.join() === [1, 2, 3, 4, 5, 6, 7, 0].map((k) => (s0 + k) % 8).join() && straight === 4, `E steps through all eight views in order, four of them straight (${s0} → ${right.join(" → ")})`);
  check(Math.abs(ISO.iso.cx - cx) < 1e-6 && Math.abs(ISO.iso.cy - cy) < 1e-6 && ISO.viewStep() === s0 && ISO.iso.rot === 0 && !ISO.iso.straight, `eight turns come back to the same view and middle (${cx.toFixed(1)},${cy.toFixed(1)} → ${ISO.iso.cx.toFixed(1)},${ISO.iso.cy.toFixed(1)})`);
  check(!drift, `every turn keeps the ground at the middle of the screen where it was (${m0.x},${m0.y}; ${drift} of 8 moved)`);
  for (let k = 0; k < 8; k++) { UI.combatKey(st, ev("KeyQ")); left.push(ISO.viewStep()); }
  check(left.join() === [7, 6, 5, 4, 3, 2, 1, 0].map((k) => (s0 + k) % 8).join(), `Q steps back through them (${left.join(" → ")})`);
  UI.combatKey(st, ev("KeyQ"));
  check(ISO.iso.rot === 0 && ISO.iso.straight, "Q from the first view: the straight view between the last diagonal one and the first");
  UI.combatKey(st, ev("Period"));
  check(ISO.viewStep() === s0, ". turns back");
  const bar = UI.viewBar(b);
  check(/an eighth to the left/.test(bar) && /an eighth to the right/.test(bar) && /Eight views/.test(bar), "the view bar's tooltips say an eighth and the eight views");
}

// ---------- 2. every layout, every view: drawn, picked ----------
console.log("Every layout in every view");
{
  const errs = [], misses = [];
  let cells = 0, ground = 0, full = 0, fullN = 0, straightOk = 0, diagOk = 0, onScreen = 0, units = 0, repaint = 0;
  const list = battles(72), n = list.length;
  for (const { name, st, b } of list) {
    ISO.iso.battle = null;
    let e = draw(st);
    if (e) errs.push(`${name}: ${e}`);
    const g0 = ISO.iso.builds.ground, one = !ISO.floorsOf(b);
    const me = b.units.find((u) => u.side === "player" && C.active(u) && ISO.onFloor(b, u));
    // ui/combat.js view caches by the battle's revision, not the battle: another battle's cached view (its enemies
    // for the hover's threat preview, threatAt) must not be read for this one.
    UI.cui.cache = { key: null };
    for (let k = 0; k < 8; k++) {
      ISO.isoRotate(b, 1);
      if (me) UI.combatMouse(st, ...ISO.project(me.x + 0.5, me.y + 1.5, 0)); // a hover in front of one of yours
      e = draw(st);
      if (e) errs.push(`${name} view ${ISO.viewStep()}: ${e}`);
      const step = ISO.viewStep();
      // Straight or diagonal: a step along x and along y on the screen.
      const [ax, ay] = ISO.project(5, 5, 0), [bx, by] = ISO.project(6, 5, 0), [cx2, cy2] = ISO.project(5, 6, 0);
      const flat = (dx, dy) => Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6;
      if (step & 1) { if (flat(bx - ax, by - ay) && flat(cx2 - ax, cy2 - ay)) straightOk++; } else if (!flat(bx - ax, by - ay) && !flat(cx2 - ax, cy2 - ay)) diagOk++;
      // Picking: every few cells, at the middle of its floor.
      for (let i = k % 3; i < b.w * b.h; i += 3) {
        const x = i % b.w, y = (i / b.w) | 0, z = lift(b, x, y);
        const [X, Y] = ISO.project(x + 0.5, y + 0.5, z);
        cells++;
        const p = ISO.isoPick(b, X, Y, { noUnits: true, ground: true });
        if (p && p.x === x && p.y === y) ground++; else if (misses.length < 4) misses.push(`${name} view ${step} ground (${x},${y}) → ${p ? `${p.x},${p.y}` : "nothing"}`);
        const c = b.cells[i];
        if (c.k === "void" || !C.CELL[c.k] || !C.CELL[c.k].walk || C.heightAt(b, x, y)) continue;
        fullN++;
        const q = ISO.isoPick(b, X, Y, { noUnits: true });
        const front = q && (q.x !== x || q.y !== y) && ISO.project(q.x + 0.5, q.y + 0.5, lift(b, q.x, q.y))[1] > Y + 1e-6;
        if (q && ((q.x === x && q.y === y) || front)) full++; else if (misses.length < 8) misses.push(`${name} view ${step} full (${x},${y}) → ${q ? `${q.x},${q.y} ${b.cells[q.y * b.w + q.x].k}` : "nothing"}`);
      }
      // Centering on one of yours puts them on screen.
      if (me) {
        units++;
        ISO.isoCenterOn(b, me.x, me.y, false);
        draw(st);
        if (ISO.isoOnScreen(b, me.x, me.y)) onScreen++;
      }
    }
    if (one && ISO.iso.builds.ground !== g0) repaint++;
  }
  check(!errs.length && !nan, `${n} layouts drawn in all eight views with a hover, no error or NaN${errs.length ? ` (${errs[0]})` : ""}${nan ? ` (${nan} NaN)` : ""}`);
  check(!repaint, `a one-storey map's ground is not painted again on turning (${repaint} repainted)`);
  check(ground === cells, `the ground pick of each cell's middle is that cell, in every view (${ground}/${cells})${misses.length ? `: ${misses.slice(0, 4).join("; ")}` : ""}`);
  check(full === fullN && fullN > 1000, `the full pick there is that cell or a block in front of it (${full}/${fullN})${misses.length ? `: ${misses.join("; ")}` : ""}`);
  check(straightOk === 4 * n && diagOk === 4 * n, `the four straight views run the map's rows and columns straight across and up the screen, the four diagonal ones do not (${straightOk}/${4 * n}, ${diagOk}/${4 * n})`);
  check(units > 0 && onScreen === units, `centering on a unit puts it on screen in every view (${onScreen}/${units})`);
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
