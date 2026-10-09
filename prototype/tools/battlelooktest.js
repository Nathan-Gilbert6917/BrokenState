// The battle map's look (ui/battleedge.js, ui/battlelights.js, ui/battlemarks.js; hooks in ui/isoview.js and
// ui/combat.js) on stub canvases:
// - the edge skirt: cells generated outside the bounds for every layout (tools/isobattles.js), none inside, none
//   picked in any turn of the view; the ground continued from the edge (a road runs off the map), fading into the fog
//   colour, which follows the night; the Display levels (full 5 tiles, light 3, off none);
// - marks from a scripted run of fx: hits and misses, a burst, a shotgun, a crossbow, a kill (a spitter's acid green),
//   a frag, a Molotov, fire, a smashed window: the right kinds, places and counts; a launcher's dud takes its scorch
//   back; the cap (oldest brass first); a new battle, a restart (the battle-start save is a new object) or a map swap
//   clears them; fog of war: drawn only once seen; bodies kept once seen;
// - light beams: the cone's direction from the facing, its length and width from LIGHTS, pools for a torch and a
//   lantern; only your people's and the enemies you see; the light cut out of every cell you do not see; every enemy
//   drawn is one you see;
// - determinism: a run of combat actions gives the same sim results with the modules drawing (full or off) as without.
// Usage: node tools/battlelooktest.js
import { battles } from "./isobattles.js";
import * as C from "../src/sim/combat.js";
import { LIGHTS } from "../src/sim/lights.js";
import { FRAG, FIRE } from "../src/sim/throwables.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
const t0 = performance.now();

const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
const EDGE = await import("../src/ui/battleedge.js");
const LT = await import("../src/ui/battlelights.js");
const MK = await import("../src/ui/battlemarks.js");
let nan = 0;
// Stub canvases that remember the last picture put on them (putImageData), so pixels can be read back.
const silent = (cv) => new Proxy({ createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: (img) => { cv.img = img; }, measureText: (t) => ({ width: String(t).length * 6 }) }, {
  get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
  set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; o[k] = v; return true; },
});
const cvs = (w, h) => { const cv = { width: w, height: h, toDataURL: () => "data:," }; const g = silent(cv); cv.getContext = () => g; return cv; };
globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
ISO.setIsoCanvas(cvs);
UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent({}) });
let clock = 1e6;
const draw = (st) => { try { clock += 50; UI.drawCombat(st, clock); return ""; } catch (e) { return e.stack.split("\n").slice(0, 3).join(" "); } };
const W = (b, x, y) => b.cells[y * b.w + x];

// ---------- 1. the edge skirt ----------
console.log("The edge skirt");
{
  let bad = 0, inside = 0, picked = 0, pickedOut = 0, total = 0, errs = [];
  for (const { name, st, b } of battles(41)) {
    const e = draw(st);
    if (e) errs.push(`${name}: ${e}`);
    const cells = EDGE.skirtCells(b, EDGE.skirtTiles());
    const want = (b.w + 10) * (b.h + 10) - b.w * b.h;
    if (cells.length !== want) bad++;
    for (const c of cells) if (c.x >= 0 && c.y >= 0 && c.x < b.w && c.y < b.h) inside++;
    // No skirt cell is picked, in any turn of the view (the ground pick: the cell under the point as if nothing stood
    // there; the full pick may land on a tall block inside the map in front of it, never outside).
    for (let r = 0; r < 4; r++) {
      ISO.isoRotate(b, 1);
      draw(st);
      for (let k = 0; k < cells.length; k += 7) {
        const c = cells[k], [X, Y] = ISO.project(c.x + 0.5, c.y + 0.5, 0);
        total++;
        if (ISO.isoPick(b, X, Y, { noUnits: true, ground: true })) picked++;
        const p = ISO.isoPick(b, X, Y, { noUnits: true });
        if (p && (p.x < 0 || p.y < 0 || p.x >= b.w || p.y >= b.h)) pickedOut++;
      }
    }
  }
  check(!errs.length && !nan, `every layout drawn with the skirt in all four turns, no error or NaN${errs.length ? ` (${errs[0]})` : ""}`);
  check(!bad && !inside, "the skirt: (w+10)×(h+10)−w×h cells round every layout's map, none inside it");
  check(!picked && !pickedOut, `no skirt cell is picked: ${picked} by the ground pick, ${pickedOut} out of bounds by the full pick (${total} points × 4 turns)`);

  // The skirt's picture: a road at the edge runs on; far out it is the fog; the fog follows the night.
  const { st, b } = battles(42, ["field-town"])[0];
  const roadEdge = (() => { for (let y = 0; y < b.h; y++) if (W(b, 0, y).f === "road") return y; return -1; })();
  const fc = (c, k) => (k === "water" ? [0, 0, 255] : c.f === "road" ? [200, 0, 0] : [0, 160, 0]);
  const day = EDGE.fogColour(b, { key: "clear", snow: 0 });
  const sk = EDGE.skirtFor(b, day, fc, "t1");
  const px = (x, y) => { const d = sk.cv.img.data, i = ((y + sk.K * 16) * sk.tw + (x + sk.K * 16)) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
  const near = roadEdge >= 0 ? px(-6, roadEdge * 16 + 8) : null, far = px(-sk.K * 16 + 1, 8), mid = px(40, 40);
  check(roadEdge < 0 || (near[0] > 120 && near[1] < 60), `the road at the west edge runs on into the skirt (${roadEdge < 0 ? "no road on the west edge" : near.join(",")})`);
  check(Math.abs(far[0] - day[0]) < 12 && Math.abs(far[1] - day[1]) < 12 && Math.abs(far[2] - day[2]) < 12, `the outer skirt is the fog colour (${far.slice(0, 3)} vs ${day})`);
  check(mid[3] === 0, "the map itself is left clear in the skirt's picture");
  const night = EDGE.fogColour({ night: true }, { key: "clear", snow: 0 }), fogd = EDGE.fogColour(b, { key: "fog", snow: 0 }), snow = EDGE.fogColour(b, { key: "overcast", snow: 0.5 });
  check(night.reduce((a, v) => a + v, 0) < day.reduce((a, v) => a + v, 0) / 3 && fogd[0] > day[0] + 20 && snow[0] > day[0] + 30, `the fog by night (${night}), in fog (${fogd}) and over snow (${snow}) against a clear day (${day})`);
  EDGE.setEdgeLevel("low");
  const lo = EDGE.skirtFor(b, day, fc, "t1");
  EDGE.setEdgeLevel("off");
  const off = EDGE.skirtFor(b, day, fc, "t1");
  EDGE.setEdgeLevel("full");
  check(lo && lo.K === 3 && off === null && EDGE.skirtTiles() === 5, "Display → Battle map edge: full 5 tiles, light 3, off none");
}

// ---------- 2. marks ----------
console.log("Marks");
{
  const { st, b } = battles(43, ["field-town"])[0];
  draw(st);
  const me = b.units.filter((u) => u.side === "player");
  const foes = b.units.filter((u) => u.side === "enemy");
  // An open stretch of ground: the shooters and targets put there (test only).
  const open = [];
  for (let y = 1; y < b.h - 1; y++) for (let x = 1; x < b.w - 1; x++) if (W(b, x, y).k === "open" && !b.units.some((u) => u.x === x && u.y === y)) open.push([x, y]);
  const put = (u, i) => { [u.x, u.y] = open[i]; };
  const [a, a2, a3, a4] = me, [t, t2, t3] = foes;
  put(a, 0); put(a2, 10); put(a3, 20); put(a4, 30); put(t, 40); put(t2, 50); put(t3, 60);
  a.weapon = "pistol"; a2.weapon = "ar"; a3.weapon = "shotgun"; a4.weapon = "crossbow";
  MK.clearMarks();
  const st0 = MK.marksOf(b);
  const now = 5000;
  const of = (k) => st0.list.filter((m) => m.k === k);
  const n0 = (k) => of(k).length;
  const dist = (m, x, y) => Math.hypot(m.x - (x + 0.5), m.y - (y + 0.5));
  C.fx(b, { type: "shot", from: [a.x, a.y], to: [t.x, t.y], hit: true, crit: false, dmg: 12, side: "player", rounds: 1, hits: 1 });
  MK.ingestMarks(b, now);
  check(n0("brass") === 1 && dist(of("brass")[0], a.x, a.y) < 1, "a pistol shot: one case under the shooter");
  const blood = of("zblood").concat(of("blood"));
  check(blood.length === 1 && dist(blood[0], t.x, t.y) < 0.6, `a hit: blood where it hit (${blood.length})`);
  C.fx(b, { type: "shot", from: [a2.x, a2.y], to: [t2.x, t2.y], hit: false, side: "player", rounds: 3 });
  MK.ingestMarks(b, now);
  check(n0("brass") === 4 && of("brass").slice(1).every((m) => dist(m, a2.x, a2.y) < 1), "a missed burst of 3: three cases under the rifleman");
  check(of("zblood").length + of("blood").length === 1, "a miss leaves no blood");
  C.fx(b, { type: "shot", from: [a2.x, a2.y], to: [t2.x, t2.y], hit: true, dmg: 20, side: "player", rounds: 12, hits: 3 });
  MK.ingestMarks(b, now);
  check(n0("brass") === 4 + 6, `full auto (12 rounds): a scatter of six, not twelve (${n0("brass") - 4})`);
  C.fx(b, { type: "shot", from: [a3.x, a3.y], to: [t3.x, t3.y], hit: true, dmg: 18, side: "player", rounds: 1, hits: 1 });
  C.fx(b, { type: "shot", from: [a4.x, a4.y], to: [t3.x, t3.y], hit: true, dmg: 14, side: "player", rounds: 1, hits: 1 });
  MK.ingestMarks(b, now);
  check(n0("shell") === 1 && dist(of("shell")[0], a3.x, a3.y) < 1, "a shotgun: a red shell");
  check(n0("brass") === 10 && !st0.list.some((m) => (m.k === "brass" || m.k === "shell") && dist(m, a4.x, a4.y) < 1), "a crossbow: no brass");
  // A kill: a pool under the body; a spitter's is acid green.
  t.dead = true; t2.ztype = "spitter"; t2.kind = "zombie"; t2.dead = true;
  MK.ingestMarks(b, now);
  const pools = st0.list.filter((m) => m.pool);
  check(pools.length === 2 && pools.some((m) => m.k === "acid" && dist(m, t2.x, t2.y) < 0.4) && pools.some((m) => m.k !== "acid" && dist(m, t.x, t.y) < 0.4), "a kill: a pool under each body, a spitter's acid green");
  MK.ingestMarks(b, now);
  check(st0.list.filter((m) => m.pool).length === 2, "each body bleeds once");
  // A frag and a Molotov; fire; a window smashed.
  const [gx, gy] = open[70], [mx, my] = open[80], [fx, fy] = open[90];
  C.fx(b, { type: "throw", from: [a.x, a.y], to: [gx, gy], item: "frag" });
  C.fx(b, { type: "throw", from: [a.x, a.y], to: [mx, my], item: "molotov" });
  (b.fires || (b.fires = [])).push({ x: fx, y: fy, r: 0.5, turns: 2 });
  MK.ingestMarks(b, now);
  const sc = of("scorch");
  check(sc.some((m) => dist(m, gx, gy) < 0.01 && Math.abs(m.r - FRAG.r * 0.75) < 1e-9), "a frag: scorch where it went off, its size from FRAG.r");
  check(sc.some((m) => dist(m, mx, my) < 0.01 && Math.abs(m.r - FIRE.r * 0.8) < 1e-9) && of("ash").some((m) => dist(m, mx, my) < 0.01), "a Molotov: scorch from FIRE.r and ash");
  check(sc.some((m) => dist(m, fx, fy) < 0.01) && of("ash").some((m) => dist(m, fx, fy) < 0.01), "a burning cell: scorched, ash on it");
  // A launcher's round too close to arm: the dud takes its scorch back.
  const [dx, dy] = open[100];
  C.fx(b, { type: "throw", from: [a.x, a.y], to: [dx, dy], item: "frag" });
  C.fx(b, { type: "melee", from: [a.x, a.y], to: [dx, dy], hit: true, dmg: 3, side: "player", text: "DUD" });
  MK.ingestMarks(b, now);
  check(!of("scorch").some((m) => dist(m, dx, dy) < 0.01), "a dud leaves no scorch");
  // ux-tactical's cook-offs (sim/launchers.js fireCookOffs): a grenade going off in the flames scorches like one thrown;
  // a smoke grenade hissing does not.
  const [kx, ky] = open[110], [hx, hy] = open[120];
  C.fx(b, { type: "cookoff", from: [kx, ky], to: [kx, ky], item: "frag", hit: true, text: "BOOM" });
  C.fx(b, { type: "cookoff", from: [hx, hy], to: [hx, hy], item: "smokegren", hit: true, text: "HISS" });
  MK.ingestMarks(b, now);
  check(of("scorch").some((m) => dist(m, kx, ky) < 0.01 && Math.abs(m.r - FRAG.r * 0.75) < 1e-9) && !of("scorch").some((m) => dist(m, hx, hy) < 0.01), "a cook-off: a frag's blast scorches, a smoke grenade's hiss does not");
  let win = -1;
  for (let i = 0; i < b.cells.length && win < 0; i++) if (b.cells[i].k === "window") win = i;
  if (win >= 0) {
    MK.clearMarks(); MK.marksOf(b); // the windows as they stand
    b.cells[win].k = "smashed";
    const st1 = MK.ingestMarks(b, now);
    const gl = st1.list.filter((m) => m.k === "glass");
    check(gl.length >= 1 && gl.every((m) => Math.hypot(m.x - (win % b.w + 0.5), m.y - (((win / b.w) | 0) + 0.5)) < 1.8), `a window smashed: glass beside it (${gl.length})`);
    b.cells[win].k = "window";
  } else check(true, "(no window on this map)");
  // The cap: the oldest brass goes first.
  MK.clearMarks();
  const st2 = MK.marksOf(b);
  C.fx(b, { type: "throw", from: [a.x, a.y], to: [gx, gy], item: "frag" });
  MK.ingestMarks(b, now);
  for (let k = 0; k < 140; k++) { C.fx(b, { type: "shot", from: [a2.x, a2.y], to: [t3.x, t3.y], hit: false, side: "player", rounds: 12 }); MK.ingestMarks(b, now); }
  check(st2.list.length === MK.MARK_CAP && st2.list.some((m) => m.k === "scorch") && st2.list[0].k === "scorch", `capped at ${MK.MARK_CAP} (${st2.list.length}), the scorch kept, the oldest brass gone`);
  // Fog of war: drawn only once seen; bodies kept once seen.
  const vis = new Uint8Array(b.w * b.h);
  const g = cvs(1, 1).getContext();
  MK.drawMarks(g, b, now + 1e5, 0);
  check(st2.baked === 0, "nothing drawn while no one has seen the cells");
  vis[gy * b.w + gx] = 1;
  MK.revealMarks(b, vis);
  MK.drawMarks(g, b, now + 1e5, 0);
  check(st2.baked === st2.list.filter((m) => m.cell === gy * b.w + gx).length && st2.baked >= 1, `drawn once seen (${st2.baked})`);
  vis.fill(0);
  check(!MK.knownBody(b, t, vis), "a body never seen is not drawn");
  vis[t.y * b.w + t.x] = 1;
  check(MK.knownBody(b, t, vis), "seen: drawn");
  vis.fill(0);
  check(MK.knownBody(b, t, vis) && MK.knownBody(b, me[5] || a, vis), "once seen it stays, out of sight; your own always");
  // A new battle, a restart (the battle-start save: a new battle object), a map swap: clean.
  const again = battles(43, ["field-town"])[0];
  check(MK.marksOf(again.b).list.length === 0, "a restart (the same battle loaded again: a new object) starts with no marks");
  MK.marksOf(b).list.push({ k: "brass", x: 1, y: 1, cell: 0, seen: true });
  const w0 = b.w; b.w = w0 + 1;
  check(MK.marksOf(b).list.length === 0, "a map swap (the fall back to the yard) clears them");
  b.w = w0;
  // Display → Battle ground marks: light keeps no brass, off none.
  MK.setMarksLevel("low");
  MK.clearMarks(); MK.marksOf(b);
  C.fx(b, { type: "shot", from: [a.x, a.y], to: [t3.x, t3.y], hit: true, dmg: 10, side: "player", rounds: 1, hits: 1 });
  MK.ingestMarks(b, now);
  const lowList = MK.marksOf(b).list;
  MK.setMarksLevel("off");
  MK.clearMarks(); MK.marksOf(b);
  C.fx(b, { type: "shot", from: [a.x, a.y], to: [t3.x, t3.y], hit: true, dmg: 10, side: "player", rounds: 1, hits: 1 });
  MK.ingestMarks(b, now);
  check(!lowList.some((m) => m.k === "brass") && lowList.some((m) => !m.pool && /blood/.test(m.k)) && MK.marksOf(b).list.length === 0, "Display: light keeps the blood but no brass, off keeps nothing");
  MK.setMarksLevel("full");
  // Real fighting: marks appear on their own as the battle is played through the UI.
  MK.clearMarks();
  const real = battles(44, ["field-city"])[0];
  draw(real.st);
  let tt = 2e6;
  UI.combatAction(real.st, "cb-autoplay", {});
  for (let i = 0; i < 400 && !real.b.over && real.b.turn < 5; i++) { tt += 500; UI.combatTick(real.st, tt); if (i % 10 === 0) draw(real.st); }
  const rl = MK.marksOf(real.b).list;
  check(rl.some((m) => m.k === "brass" || m.k === "shell") && rl.some((m) => /blood|acid/.test(m.k)), `a battle played by the AI leaves brass and blood (${rl.length} marks by turn ${real.b.turn}: ${[...new Set(rl.map((m) => m.k))].join(", ")})`);
  UI.cui.autoPlay = false;
}

// ---------- 3. light beams ----------
console.log("Light beams");
{
  const fl = LT.beamOf("flashlight"), hl = LT.beamOf("headlamp"), sp = LT.beamOf("spotlight"), to = LT.beamOf("torch"), la = LT.beamOf("lantern");
  check(fl.kind === "cone" && hl.kind === "cone" && sp.kind === "cone" && to.kind === "pool" && la.kind === "pool", "flashlight, headlamp and spotlight cones; torch and lantern pools");
  check(fl.len >= 5 && fl.len <= 8 && hl.len >= 5 && hl.len <= 8 && sp.len === LIGHTS.spotlight.sight && sp.len > fl.len, `lengths from LIGHTS sight: headlamp ${hl.len}, flashlight ${fl.len}, spotlight ${sp.len}`);
  check(Math.abs(Math.tan(fl.half) * fl.len * 2 - LIGHTS.flashlight.cone) < 1e-9 && to.r === LIGHTS.torch.cone && la.r === LIGHTS.lantern.cone, "the cone as wide as LIGHTS cone at its end; a pool's radius LIGHTS cone");
  const { st, b } = battles(45, ["base-wall-night"])[0];
  const fb = { fx: [] };
  check(Math.abs(LT.facingAngle(fb, { face: [1, 0] })) < 1e-9 && Math.abs(LT.facingAngle(fb, { face: [0, 1] }) - Math.PI / 2) < 1e-9 && Math.abs(LT.facingAngle(fb, { face: [-1, -1] }) + 3 * Math.PI / 4) < 1e-9, "the cone points the way the unit faces (u.face)");
  check(Math.abs(LT.facingAngle({ fx: [{ type: "move", unit: 7, from: [3, 3], path: [[3, 4], [3, 5]] }] }, { id: 7 }) - Math.PI / 2) < 1e-9, "no facing yet: the way it last moved");
  draw(st);
  const me = b.units.filter((u) => u.side === "player" && C.active(u));
  me[0].light = "flashlight"; me[0].face = [0, -1]; if (me[1]) me[1].light = "torch";
  const foes = b.units.filter((u) => u.side === "enemy" && C.active(u));
  for (const e of foes) e.light = "flashlight"; // test only: raiders with flashlights
  b.rev++;
  draw(st);
  const v = { vis: new Uint8Array(b.w * b.h), seen: new Set() };
  const seenFoe = foes[0], hiddenFoe = foes[1];
  v.seen.add(seenFoe.id);
  const src = LT.lightSources(b, v);
  check(src.some((s) => s.id === me[0].id && Math.abs(s.ang + Math.PI / 2) < 1e-9) && (!me[1] || src.some((s) => s.id === me[1].id && s.beam.kind === "pool")), "your people's lights: the flashlight's cone their way, the torch's pool");
  check(src.some((s) => s.id === seenFoe.id) && !src.some((s) => s.id === hiddenFoe.id) && src.filter((s) => s.unit.side !== "player").every((s) => v.seen.has(s.id)), "an enemy's flashlight only once you see them: none for one you do not");
  check(LT.lightSources({ ...b, night: false, dark: false }, v).length === 0, "by day: no beams");
  // The mask: every cell not seen opaque (the light cut out there), every seen one clear.
  for (let i = 0; i < v.vis.length; i += 3) v.vis[i] = 1;
  const n = LT.paintLights(b, v, [16, 8, -16, 8, 800, 100], 1600, 900, 1000);
  const masks = [];
  ISO.setIsoCanvas((w, h) => { const c = cvs(w, h); if (w === b.w && h === b.h) masks.push(c); return c; });
  LT.paintLights(b, { vis: v.vis.slice(), seen: v.seen }, [16, 8, -16, 8, 800, 100], 1600, 900, 1000);
  const m = masks[masks.length - 1], d = m && m.img && m.img.data;
  let wrong = 0;
  if (d) for (let i = 0; i < v.vis.length; i++) if ((d[i * 4 + 3] === 255) === !!v.vis[i]) wrong++;
  check(n > 0 && d && !wrong, `the lights are cut out of every cell your people do not see (${wrong} cells wrong of ${v.vis.length})`);
  ISO.setIsoCanvas(cvs);
  // Drawn: every enemy drawn (a unit rectangle) is one your people see.
  let leaks = 0, checked = 0;
  for (const { st: s2, b: b2 } of battles(46, ["base-wall-night", "raid", "field-forest"])) {
    b2.night = true;
    for (const e of b2.units) if (e.side === "enemy") e.light = "flashlight";
    for (let k = 0; k < 3 && !b2.over; k++) {
      draw(s2);
      const seen = new Set(b2.units.filter((e) => e.side !== "player" && C.active(e) && C.playerSees(b2, e)).map((e) => e.id));
      for (const r of ISO.iso.rects) { const u = b2.units.find((q) => q.id === r.id); if (u && u.side !== "player") { checked++; if (!seen.has(u.id)) leaks++; } }
      for (const s of LT.LIGHTS_DRAWN.src) if (s.unit.side !== "player" && !seen.has(s.id)) leaks++;
      if (b2.phase === "deploy") C.endDeploy ? C.endDeploy(b2) : null;
      C.autoPlayerTurn(s2); if (!b2.over) C.runEnemyPhase(s2);
      b2.rev++;
    }
  }
  check(!leaks && !nan, `at night with every enemy carrying a light: no enemy drawn or lit that your people do not see (${checked} enemies drawn checked)`);
}

// ---------- 4. determinism ----------
console.log("Determinism");
{
  const snap = (b) => JSON.stringify({ units: b.units.map((u) => [u.id, u.x, u.y, u.hp, !!u.dead, !!u.down, u.ap]), log: b.log.map((l) => l.text), turn: b.turn, over: b.over, fxSeq: b.fxSeq, rng: JSON.stringify(b.rng), cells: b.cells.map((c) => c.k + (c.hp ?? "")).join() });
  const run = (mode) => {
    const { st, b } = battles(47, ["base-wall-night"])[0];
    for (const e of b.units) if (e.side === "player") e.light = e.light || "headlamp";
    MK.setMarksLevel(mode === "off" ? "off" : "full"); EDGE.setEdgeLevel(mode === "off" ? "off" : "full");
    for (let k = 0; k < 6 && !b.over; k++) {
      if (mode !== "none") draw(st);
      C.autoPlayerTurn(st);
      if (mode !== "none") { MK.ingestMarks(b, clock); draw(st); }
      if (!b.over) C.runEnemyPhase(st);
      if (mode !== "none") draw(st);
    }
    MK.setMarksLevel("full"); EDGE.setEdgeLevel("full");
    return snap(b);
  };
  const a = run("none"), f = run("full"), o = run("off");
  check(a === f && a === o, `six turns of a night base fight: the same sim results without the modules, with them drawing, and with them off (${a.length} chars of state)`);
}

console.log(`\n${passed} passed, ${failed} failed. (${Math.round(performance.now() - t0)} ms)`);
if (failed) process.exitCode = 1;
