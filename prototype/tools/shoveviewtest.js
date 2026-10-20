// Shoving on the battle view (ui/isoview.js, ui/combat.js; sim/shoving.js), on stub canvases: a unit shoved flat
// topples (the standing figure turned about its feet toward the way it falls, while fx "topple" is young), then lies
// with its head that way; the FLAT and HELD tags; a shove's stumble back (fx "move" shove: eased); no frame throws or
// draws a NaN, in every turn of the view; Alt+V is Shove foe and no battle key clashes.
// Usage: node tools/shoveviewtest.js
import { battles } from "./isobattles.js";
import * as K from "../src/ui/keymap.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
// A 2D context that counts NaNs and the turns (rotate) drawn.
let nan = 0, turns = [];
const recorder = () => {
  const own = {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    measureText: (t) => ({ width: String(t).length * 6 }),
    getLineDash: () => [],
    rotate: (a) => { if (!Number.isFinite(a)) nan++; turns.push(a); },
  };
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
const C = await import("../src/sim/combat.js");
ISO.setIsoCanvas(silentCvs);
const mainCtx = recorder();
UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => mainCtx });
let clock = 1e6;
const draw = (st, dt = 50) => { turns = []; try { clock += dt; UI.drawCombat(st, clock); return ""; } catch (e) { return e.stack.split("\n").slice(0, 3).join(" "); } };

console.log("A shove's animations");
{
  const { st, b } = battles(71, ["field-town"])[0];
  b.phase = "player";
  const me = b.units.find((u) => u.side === "player" && C.active(u));
  const foe = b.units.find((u) => u.side === "player" && C.active(u) && u !== me); // one of yours: always drawn (no fog)
  UI.cui.sel = me.id;
  check(draw(st) === "", "the battle draws");
  draw(st); const base = turns.length; // the turns a frame draws with nobody falling (the compass and the like)
  // Floored now: a topple effect, a fresh stumble back.
  foe.floored = 1;
  C.fx(b, { type: "move", unit: foe.id, from: [foe.x - 1, foe.y], path: [[foe.x, foe.y]], shove: true });
  C.fx(b, { type: "topple", unit: foe.id, dir: [1, 0] });
  b.rev = (b.rev || 0) + 1;
  const errs = [];
  const tilt = [];
  let most = 0;
  for (let i = 0; i < 12; i++) { const e = draw(st, 40); if (e) errs.push(e); tilt.push(turns.length - base); most = Math.max(most, ...turns.map(Math.abs)); }
  check(!errs.length, `every frame of the fall draws (${errs[0] || "no error"})`);
  check(tilt[0] > 0 && most > 0.5, `going over: the standing figure is drawn turned about its feet (up to ${most.toFixed(2)} rad)`);
  check(tilt[tilt.length - 1] === 0, "down: lying, no longer turned");
  // In every turn of the view, mid-fall and after.
  for (let r = 0; r < 8; r++) { UI.combatAction?.(st, "cb-view", { v: "rotr" }); C.fx(b, { type: "topple", unit: foe.id, dir: [0, 1] }); for (let i = 0; i < 4; i++) { const e = draw(st, 90); if (e) errs.push(e); } }
  check(!errs.length, `all eight views, falling and down (${errs[0] || "no error"})`);
  foe.heldBy = me.id;
  check(draw(st) === "", "a HELD unit draws");
  check(nan === 0, `no NaN drawn (${nan})`);
}

console.log("Keys");
K.initKeymap({});
{
  const ev = { code: "KeyV", shiftKey: false, ctrlKey: false, altKey: true, metaKey: false, preventDefault() {} };
  check(K.keyAction(ev, "battle") === "battle.shoveFoe", `Alt+V is Shove foe (${K.keyAction(ev, "battle")})`);
  const cf = K.conflicts().filter((c) => c.ctx === "battle");
  check(!cf.length, `no two battle actions share a key${cf.length ? `: ${cf.map((c) => `${c.chord} ${c.ids.join("/")}`).join("; ")}` : ""}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
