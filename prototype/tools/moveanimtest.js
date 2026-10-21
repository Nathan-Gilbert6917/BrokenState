// Walking on the battle map (ui/moveanim.js, ui/combat.js stampMoves / moveNow, ui/figures.js stride; the user's
// request 2026-10-21: "add movement animations for battle map currently its like teleportations"):
// - a move is walked at its gait's pace, eased in and out, every frame a small step on from the last (no jumps), and
//   over when its plan says; a long one walked faster, in MAX_WALK_MS (plus the easing) unless that is past MIN_PER a cell;
// - the gaits: the dead shuffle slower than a person walks, a runner and a dash quicker, a sneak slower, a shove the
//   old stumble;
// - the walk cycle: both legs ahead in turn, in halves, the body up as they pass; standing still, nothing;
// - a figure's stride is its own picture (legs and arms moved), only for a body on two legs; a cached-only lookup
//   paints nothing;
// - a unit's two moves in a row are walked one after the other (the second sets off as the first ends, its footsteps
//   that much later); the enemy's next one waits for a walk you saw.
// Usage: node tools/moveanimtest.js
import { battles } from "./isobattles.js";
import * as C from "../src/sim/combat.js";
import { PACE, MAX_WALK_MS, MIN_PER, planOf, moveAt, timeAt, strideOf, moveGait } from "../src/ui/moveanim.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();

const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, {
  get: (o, k) => (k in o ? o[k] : () => ({ data: new Uint8ClampedArray(4) })),
  set: (o, k, v) => { o[k] = v; return true; },
});
let cvN = 0;
const cvs = (w, h) => ({ width: w, height: h, n: ++cvN, getContext: () => silent(), toDataURL: () => "data:," });
globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
const F = await import("../src/ui/figures.js");
ISO.setIsoCanvas(cvs);
UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });
const cui = UI.cui;

const line = (x, y, n) => Array.from({ length: n }, (_, i) => [x + i + 1, y]);
const walkOf = (b, u, f) => { const out = []; for (let el = 0; ; el += 16) { const m = moveAt(b, u, f, el); if (!m) break; out.push(m); } return out; };

console.log("The walk");
{
  const { b } = battles(21, ["field-town"])[0];
  const me = b.units.find((u) => u.side === "player" && C.active(u));
  for (const e of b.units) if (e.side === "enemy") e.aware = true; // not sneaking
  const f = { type: "move", unit: me.id, from: [me.x, me.y], path: line(me.x, me.y, 4) };
  const p = planOf(b, me, f);
  check(p.gait === "walk" && p.per === PACE.walk && p.total > 4 * PACE.walk && p.total < 4 * PACE.walk + PACE.walk, `a 4-cell walk: ${p.total} ms at ${p.per} ms a cell, eased (was 280 ms, a slide)`);
  check(planOf(b, me, f) === p, "worked out once a move");
  const w = walkOf(b, me, f);
  const jumps = w.slice(1).map((m, i) => Math.hypot(m.x - w[i].x, m.y - w[i].y));
  check(w[0].x === me.x && w[0].y === me.y && Math.max(...jumps) < 0.15, `from where it stood, a little further every frame (the biggest step ${Math.max(...jumps).toFixed(3)} cells)`);
  const last = w[w.length - 1];
  check(Math.abs(last.x - (me.x + 4)) < 0.1 && moveAt(b, me, f, p.total) === null, "on to the end, then over");
  check(jumps[0] < jumps[Math.floor(jumps.length / 2)] * 0.5 && jumps[jumps.length - 1] < jumps[Math.floor(jumps.length / 2)] * 0.6, "easing in and out: slow at the start and at the end");
  check(w.every((m) => m.dir && m.dir[0] === 1 && m.dir[1] === 0), "facing the way it walks");
  check([0, 0.5, 1, 2, 3.7].every((d) => Math.abs(timeAt(p, d) - w.findIndex((m) => m.dist >= d) * 16) <= 17), "timeAt: when it has gone so far");
  const long = { type: "move", unit: me.id, from: [me.x, me.y], path: line(me.x, me.y, 20) }, lp = planOf(b, me, long);
  check(lp.gait === "run" && lp.per < PACE.run && lp.total <= Math.max(MAX_WALK_MS, 20 * MIN_PER) + lp.ramp, `a 20-cell dash: ${Math.round(lp.total)} ms, quicker than its pace (${MAX_WALK_MS} ms, or ${MIN_PER} ms a cell at the most)`);
  me.sneaking = true;
  check(moveGait(b, me, f) === "sneak" && planOf(b, me, { ...f }).per > PACE.walk, "sneaking: slower");
  me.sneaking = false;
  const z = b.units.find((u) => u.kind === "zombie") || { id: -1, kind: "zombie", side: "enemy" };
  const zp = planOf(b, { ...z, ztype: null }, { type: "move", unit: z.id, from: [0, 0], path: line(0, 0, 3) });
  const rp = planOf(b, { ...z, ztype: "runner" }, { type: "move", unit: z.id, from: [0, 0], path: line(0, 0, 3) });
  check(zp.gait === "shuffle" && zp.per > PACE.walk && rp.gait === "runner" && rp.per < PACE.walk, "the dead shuffle slower than you walk; a runner quicker");
  const sh = { type: "move", unit: me.id, from: [me.x, me.y], path: line(me.x, me.y, 1), shove: true }, sp = planOf(b, me, sh);
  check(sp.gait === "shove" && sp.total === PACE.shove && moveAt(b, me, sh, 50).dir === null, "shoved back: the stumble, still facing the shove");
  // the walk cycle
  const st = w.map(strideOf);
  check(st.some((s) => s.stride === 1) && st.some((s) => s.stride === -1) && st.every((s) => s.stride * 2 === Math.round(s.stride * 2) && s.bob >= 0), "striding: either leg ahead in turn, in halves, the body bobbing");
  const up = st.filter((s) => s.stride === 0), out = st.filter((s) => Math.abs(s.stride) === 1);
  check(up.length && out.length && Math.min(...up.map((s) => s.bob)) > Math.max(...out.map((s) => s.bob)), "up as the legs pass, down with a foot out");
  check(strideOf(null).stride === 0 && strideOf({ ...w[3], dir: null }).stride === 0 && strideOf({ ...w[3], gait: "crawler" }).stride === 0, "standing, turning in place or crawling: no stride");
}

console.log("The figures");
{
  const app = F.zombieApp("walker", 7);
  const a = F.figureCanvas(app, null, null, 30), b = F.figureCanvas(app, null, null, 30, { stride: 1 }), c = F.figureCanvas(app, null, null, 30, { stride: -1 });
  check(a && b && c && a !== b && b !== c && F.figureCanvas(app, null, null, 30, { stride: 1 }) === b, "a stride is a picture of its own, cached like the others");
  const legs = (ap, st) => F.figureLimbs({ ...ap, stride: st }).slice(0, 4).map((l) => l.B[0]);
  const l0 = legs(app, 0), l1 = legs(app, 1);
  check(l1[0] !== l0[0] && Math.sign(l1[0] - l0[0]) !== Math.sign(l1[2] - l0[2]), "one foot ahead, the other behind");
  const n = F.figureStats.painted;
  check(F.figureCanvas(app, null, null, 60, { stride: 0.5, cached: true }) === null && F.figureStats.painted === n, "a cached-only lookup paints nothing");
  const beast = F.specialApp("deadhound", 3);
  check(F.figureCanvas(beast, null, null, 0, { stride: 1 }) === F.figureCanvas(beast, null, null, 0), "a beast on four legs: no stride picture");
}

console.log("Moves in a row");
{
  const { st, b } = battles(22, ["field-town"])[0];
  UI.drawCombat(st, 1e6);
  const me = b.units.find((u) => u.side === "player" && C.active(u));
  for (const e of b.units) if (e.side === "enemy") e.aware = true;
  UI.combatTick(st, 1e6);
  const before = b.fxSeq;
  C.fx(b, { type: "move", unit: me.id, from: [me.x, me.y], path: line(me.x, me.y, 3) });
  C.fx(b, { type: "move", unit: me.id, from: [me.x + 3, me.y], path: line(me.x + 3, me.y, 2) });
  const T = 2e6;
  UI.combatTick(st, T);
  const [f1, f2] = b.fx.filter((f) => f.seq > before);
  const p1 = planOf(b, me, f1), p2 = planOf(b, me, f2);
  check(cui.anim.get(f1.seq) === T && cui.anim.get(f2.seq) === T + p1.total, "the second move sets off as the first one ends");
  check(p1.delay === 0 && p2.delay === p1.total, "its footsteps that much later (the plan's delay)");
  let err = "";
  try { for (let t = T; t < T + p1.total + p2.total + 100; t += 16) UI.drawCombat(st, t); } catch (e) { err = e.stack.split("\n").slice(0, 2).join(" "); }
  check(!err, `drawn frame by frame through both${err ? `: ${err}` : ""}`);
}

console.log("The enemy turn");
{
  const { st, b } = battles(23, ["field-town"])[0];
  let t = 1e6, guard = 0, waited = 0, maxWait = 0;
  UI.drawCombat(st, t);
  C.endPlayerTurn(st);
  while (b.phase === "enemy" && !b.over && guard++ < 4000) {
    t += 50;
    UI.combatTick(st, t);
    if (cui.walkUntil > t) { waited++; maxWait = Math.max(maxWait, cui.walkUntil - t); }
  }
  check(b.phase !== "enemy" || b.over, `the enemy turn plays out (${guard} ticks)`);
  check(maxWait <= 2000, `waiting for a walk seen, never long (${waited} ticks waited, at most ${Math.round(maxWait)} ms)`);
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
