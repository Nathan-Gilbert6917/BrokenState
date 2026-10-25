// Carrying furniture on the battle view and the State Map (issue #17; ui/figures.js carry poses, ui/isoview.js
// drawPairPiece, ui/battlehud.js, ui/mapfigures.js), on stub canvases:
// - one alone with a piece in the arms: the carry pose with the piece's own picture (ui/isoview.js pieceArt) painted in
//   the figure (the piece's colours inside the figure's box, none in the same figure without it); behind the body when
//   they face away (fewer of its pixels show); the pose's hands at the chest, the low pose's lower;
// - weight: a 60 kg fridge or a 100 kg piece alone takes the low pose, a 25 kg table and a shared piece the plain one;
// - a pair: the piece drawn once between them a frame (not in either figure), both facing each other, the CARRY tag
//   never needed while it is drawn; every turn of the view draws it, no NaN;
// - down: a carrier who goes down (sim/furnicarry.js dropPiece) is drawn with nothing in the arms;
// - the cache: a carrier's figure is one entry per (kind, yaw, pose); 20 carriers paint nothing new frame after frame;
// - the HANDS chip names the piece ("✋✋ Refrigerator"); Set down's cells are highlighted on the map;
// - the State Map: a team member with a piece in s.gear.carry walks with it on the shoulders (a picture of its own).
// Usage: node tools/carryviewtest.js
import { battles, carryScene } from "./isobattles.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); };
// A 2D context that counts NaNs and records the fills (their colour) and the strokes (colour, width).
let nan = 0, fills = [], strokes = [];
const recorder = (cv) => {
  const st = { fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1 };
  const own = {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    measureText: (t) => ({ width: String(t).length * 6 }),
    getLineDash: () => [],
    fill: () => { fills.push(String(st.fillStyle)); },
    fillRect: (x, y, w, h) => { if (cv) cv.ops.push(`${st.fillStyle}:${x},${y},${w},${h}`); },
    putImageData: (img) => { if (cv) cv.img = img.data; }, // ui/mapfigures.js toCanvas: the pixels at once
    stroke: () => { strokes.push({ style: String(st.strokeStyle), width: st.lineWidth }); },
  };
  return new Proxy(own, {
    get: (o, k) => (k in o ? o[k] : k in st ? st[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
    set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; st[k] = v; return true; },
  });
};
const stubCvs = (w, h) => { const cv = { width: w, height: h, ops: [], toDataURL: () => "data:," }; const ctx = recorder(cv); cv.getContext = () => ctx; return cv; };
globalThis.document = { createElement: () => stubCvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const ISO = await import("../src/ui/isoview.js");
const FG = await import("../src/ui/figures.js");
const UI = await import("../src/ui/combat.js");
const HUD = await import("../src/ui/battlehud.js");
const MF = await import("../src/ui/mapfigures.js");
const C = await import("../src/sim/combat.js");
const F = await import("../src/sim/furnicarry.js");
const { survivorById } = await import("../src/sim/world.js");
const { newItem } = await import("../src/sim/inventory.js");
const { itemKey } = await import("../src/sim/data-furniture.js");
ISO.setIsoCanvas(stubCvs);
const mainCtx = recorder(null);
UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => mainCtx });
let clock = 1e6;
const draw = (st, dt = 50) => { fills = []; strokes = []; try { clock += dt; UI.drawCombat(st, clock); return ""; } catch (e) { return e.stack.split("\n").slice(0, 3).join(" "); } };

const APP = { build: "average", skin: "#c89070", hairStyle: "short", hair: "#332211", facial: "none", topStyle: "tshirt", top: "#3a6a8a", pants: "#333333", accessory: "none", accent: "#aa3333" };
const hex2 = (v) => v.toString(16).padStart(2, "0");
// The colours of a piece's own picture (ui/isoview.js pieceArt), and how many of a figure's pixels are one of them.
const pieceCols = (k, ax) => { const a = ISO.pieceArt(k, ax), out = new Set(); for (let i = 0; i < a.buf.length; i += 4) if (a.buf[i + 3] >= 128) out.add(`#${hex2(a.buf[i])}${hex2(a.buf[i + 1])}${hex2(a.buf[i + 2])}`); return out; };
const shows = (p, cols) => p.px.filter((c) => c && cols.has(c)).length;

console.log("One alone: the carry pose, the piece in the figure");
{
  const cols = pieceCols("fridge", "v");
  const plain = FG.paintBoxFigure(APP, null, null, 0), held = FG.paintBoxFigure(APP, null, null, 0, false, { kind: "fridge", low: false });
  check(cols.size > 3, `the fridge's own picture (${cols.size} colours)`);
  check(shows(plain, cols) === 0, "the figure without it: none of the fridge's colours");
  const n = shows(held, cols);
  check(n > 150, `with it in the arms: the fridge's colours in the figure's box (${n} px)`);
  const away = shows(FG.paintBoxFigure(APP, null, null, 180, false, { kind: "fridge", low: false }), pieceCols("fridge", "v"));
  check(away < n * 0.9, `facing away: the body hides part of it (${away} px against ${n})`);
  const table = shows(FG.paintBoxFigure(APP, null, null, 90, false, { kind: "table" }), pieceCols("table", "u"));
  check(table > 40, `a table, turned (yaw 90: broadside along u): ${table} px`);
  const hold = FG.figureLimbs(APP, "carry"), low = FG.figureLimbs(APP, "carryLow");
  check(FG.holdOf("carry") === "carry" && FG.holdOf("carryLow") === "carryLow", "holdOf: the carry poses");
  check(hold.carryAt && hold.carryAt[0] > 5 && hold.carryAt[2] > 12, `carry: the hands forward at the chest (${hold.carryAt.map((v) => v.toFixed(1))})`);
  check(low.carryAt && low.carryAt[2] < hold.carryAt[2] - 4, `carryLow: the hands down low (${low.carryAt.map((v) => v.toFixed(1))})`);
  const stride = FG.figureLimbs({ ...APP, stride: 1 }, "carry"), walk = FG.figureLimbs({ ...APP, stride: 1 }, null);
  check(Math.abs(stride[0].B[0]) < Math.abs(walk[0].B[0]) * 0.75 && Math.abs(stride[0].B[0]) > 0, `a shorter stride with a piece (${stride[0].B[0].toFixed(2)} against ${walk[0].B[0].toFixed(2)})`);
}

console.log("The carry layout: alone, the weight, a pair");
const { st, b } = battles(7, ["carry"])[0];
b.phase = "player";
const byKind = (k) => b.carried.find((c) => c.k === k).ids.map((id) => b.units.find((u) => u.id === id));
const [fr] = byKind("fridge"), [tb] = byKind("table"), [s1, s2] = byKind("sofa"), [w1, w2] = byKind("washer");
{
  check(b.carried.length === 4, `four pieces carried (${b.carried.map((c) => c.k).join(", ")})`);
  const lf = FG.carryLook(st, b, fr), lt = FG.carryLook(st, b, tb);
  check(lf && lf.kind === "fridge" && lf.low, `a 60 kg fridge alone: the low pose (${JSON.stringify(lf)})`);
  check(lt && lt.kind === "table" && !lt.low, `a 25 kg table alone: the plain carry pose (${JSON.stringify(lt)})`);
  const ls = FG.carryLook(st, b, s1), lw = FG.carryLook(st, b, w2);
  check(ls && ls.kind === "" && !ls.low && lw && lw.kind === "" && !lw.low, "a pair: the plain pose each, no piece in either figure");
  // A 100 kg piece alone (a server rack's item in the arms, as from the road: furnicarry.js's own rules).
  const s = survivorById(st, tb.sid), it = newItem(itemKey("serverrack"));
  const keep = [s.gear.carry, tb.bag, tb.piece];
  s.gear.carry = it; tb.bag = it; tb.piece = F.pieceKindOf(it);
  const l100 = FG.carryLook(st, b, tb);
  check(l100 && l100.kind === "serverrack" && l100.low, `a ${F.liftDef("serverrack").kg} kg server rack alone: the low pose`);
  [s.gear.carry, tb.bag, tb.piece] = keep;
}
{
  UI.cui.sel = fr.id;
  const e = draw(st);
  check(e === "", `the battle draws (${e || "ok"})`);
  check(ISO.carryFrame.pair === 2, `each pair's piece drawn once a frame (${ISO.carryFrame.pair} for 2 pairs)`);
  const shown = [fr, tb, s1, s2, w1, w2].every((u) => ISO.carryFrame.shown.has(u.id));
  check(shown, "every carrier's piece shown (no CARRY tag)");
  const ring = strokes.filter((x) => x.width === 1 && x.style === "#8fc1ff").length;
  check(ring >= 1, `the washer's pair (a 1-cell piece): the tether line in their colour (${ring})`);
  // Facing each other (ui/isoview.js unitYaw): the yaw toward the partner.
  const yaw = (u, o) => ISO.carryProbe.dirYaw(b, u, [o.x - u.x, o.y - u.y]);
  check(ISO.carryProbe.unitYaw(b, s1) === yaw(s1, s2) && ISO.carryProbe.unitYaw(b, s2) === yaw(s2, s1) && yaw(s1, s2) !== yaw(s2, s1), "a pair faces each other");
  const errs = [];
  for (let r = 0; r < 8; r++) { UI.combatAction?.(st, "cb-view", { v: "rotr" }); const x = draw(st); if (x) errs.push(x); if (ISO.carryFrame.pair !== 2) errs.push(`turn ${r}: ${ISO.carryFrame.pair} pair pieces`); }
  check(!errs.length, `all eight views draw the pairs' pieces once each (${errs[0] || "ok"})`);
  check(nan === 0, `no NaN drawn (${nan})`);
}

console.log("Markers: the HANDS chip, the Set down cells, the CARRY tag");
{
  const chips = HUD.unitChips(st, b, fr).map((c) => c[0]);
  check(chips.includes("✋✋ Refrigerator"), `the HANDS chip names it (${chips.join(" | ")})`);
  const pc = HUD.unitChips(st, b, s2).map((c) => c[0]);
  check(pc.includes("✋✋ Sofa"), `the other end of a pair's too (${pc.join(" | ")})`);
  UI.cui.sel = tb.id; tb.ap = 2;
  const targets = F.setTargets(b, tb);
  UI.cui.mode = "setPiece";
  draw(st);
  const lit = () => fills.filter((f) => f === "rgba(224,168,79,0.38)").length;
  check(targets.length > 0 && lit() === 1, `Set down: its ${targets.length} places highlighted (${lit()} fill of their cells)`);
  UI.cui.mode = "move";
  draw(st);
  check(lit() === 0, "out of Set down: no highlight");
}

console.log("Down: no piece in the arms");
{
  fr.down = true; fr.bleed = 3;
  F.dropPiece(st, b, fr, "down");
  check(!fr.piece && !fr.bag && FG.carryLook(st, b, fr) === null, "a carrier gone down: the piece set down, nothing carried");
  draw(st);
  check(!ISO.carryFrame.shown.has(fr.id), "drawn lying with nothing in the arms");
  check(FG.unitFigure(st, b, fr, 0, 0) === null, "no standing (carrying) figure for the downed");
}

console.log("The cache: one figure per (kind, yaw, pose)");
{
  const before = FG.figureStats.painted;
  for (let i = 0; i < 5; i++) for (const y of [0, 90]) FG.figureCanvas(APP, null, null, y, { carry: { kind: "stove", low: false } });
  check(FG.figureStats.painted - before === 2, `two yaws, five times each: ${FG.figureStats.painted - before} painted`);
  const b2 = FG.figureStats.painted;
  FG.figureCanvas(APP, null, null, 0, { carry: { kind: "stove", low: true } });
  FG.figureCanvas(APP, null, null, 0, { carry: { kind: "oven", low: false } });
  FG.figureCanvas(APP, null, null, 0, { carry: { kind: "stove", low: true } });
  check(FG.figureStats.painted - b2 === 2, `another pose, another kind: one each (${FG.figureStats.painted - b2})`);
  // 20 carriers: the first frame paints them, the rest paint nothing (the cost per frame stays flat).
  const proto = b.units.find((u) => u.side === "player" && u.id === tb.id);
  const extra = [];
  for (let i = 0; i < 15; i++) {
    const u = { ...proto, id: 9000 + i, x: 2 + (i % 7) * 2, y: b.h - 6 + Math.floor(i / 7) * 2, tether: null, shareKg: null, piece: "table", bag: newItem(itemKey("table")), face: [1, 0] };
    b.units.push(u); extra.push(u);
  }
  const carriers = b.units.filter((u) => u.piece && !u.down).length;
  b.rev++;
  draw(st);
  const p0 = FG.figureStats.painted, t0 = performance.now();
  for (let i = 0; i < 10; i++) draw(st, 16);
  const ms = (performance.now() - t0) / 10;
  check(carriers >= 20, `${carriers} carriers on the map`);
  check(FG.figureStats.painted === p0, `ten frames with them: no figure painted again (${FG.figureStats.painted - p0})`);
  console.log(`  (a frame with ${carriers} carriers: ${ms.toFixed(1)} ms on stub canvases)`);
  b.units = b.units.filter((u) => !extra.includes(u));
}

console.log("The State Map: a piece on the shoulders");
{
  const px = (cv) => (cv && cv.img ? Array.from(cv.img) : []), painted = (cv) => px(cv).filter((v, i) => i % 4 === 3 && v).length;
  const plain = MF.mapSoloCanvas("walkers", "#3a7ad8", 315, 0), held = MF.mapSoloCanvas("walkers", "#3a7ad8", 315, 0, "", "", true);
  check(plain !== held && painted(held) > 0, `a walker with a piece: a canvas of its own, painted (${painted(held)} px)`);
  check(px(held).join() !== px(plain).join(), "it differs from the walker without it");
  check(MF.mapSoloCanvas("walkers", "#3a7ad8", 315, 0, "", "", true) === held, "the same look comes back from the cache");
  const party = MF.mapPartyCanvas("walkers", "#3a7ad8", 3, "", 315, 0), party1 = MF.mapPartyCanvas("walkers", "#3a7ad8", 3, "", 315, 0, 1);
  check(party !== party1 && px(party1).join() !== px(party).join(), "a party of three, one carrying: its own picture");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
