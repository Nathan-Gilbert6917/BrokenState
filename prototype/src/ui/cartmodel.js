// The carts (sim/carts.js: a wheelbarrow, a hand cart) as small low-poly models, the look of the battle map's figures
// and props (user 2026-10-20: "Carts and wheelbarrows need to be redesigned to fit the 3D look"): flat-shaded faces
// in the battle's own 2:1 projection (ui/figures.js: screen x = x - y, screen y = (x + y) / 2 - z), lit by the
// figures' light (the top lit, a face turned to the screen's right in shade), a dark rim where one part stands in
// front of another and the outline round the whole (sprites.js toCanvas), one grid px an art px like a person, so a
// cart stands beside its pusher at their scale. A model turns with a yaw (the figures' 15° steps), so a pushed cart
// faces the way its pusher does at every turn of the view.
//
// Model space: +x forward, +y left, z up, the ground at z = 0, in art px (a person is 30 tall, a tile 16 along an
// axis). A held cart's origin is under its pusher's feet: the wheelbarrow runs forward from the hands to its wheel,
// the hand cart trails behind the one pulling its T handle. A parked one (held: false) is centred on its cell.
// What it holds shows (load: kind and level 0..3): wood as logs, scrap as steel and rust, fuel as red cans,
// water as blue jugs, anything else as sacks and a crate. Worn, its paint rusts; broken (a wheel off, carts.js
// cartBroken) it sags onto the ground with the wheel lying beside it.
//
// The battle's picture (cartCanvas: cached by everything it depends on, dropped with the lost GPU context's other
// pictures) and the State Map's marker for a cart left on a tile (cartMarkerCanvas, ui/render.js); the item icons are
// drawn by hand after the models (ui/itemart/wear.js: at 16 px a model is a blur). Pure UI.
import { painter, toCanvas } from "./sprites.js";
import { shade } from "./itemart/kit.js";
import { onForgetPictures } from "./pictures.js";

// ---------- vectors ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const SX = (p) => p[0] - p[1], SY = (p) => (p[0] + p[1]) / 2 - p[2], DEPTH = (p) => p[0] + p[1] + 0.8 * p[2];
const VIEW = [1, 1, 0.8]; // toward the viewer (figures.js)
// The figures' light (figures.js LIGHT), a touch harder: a cart is a few px across and its faces must part.
const LIGHT = (n) => 0.2 * n[2] - 0.34 * Math.max(0, n[0]) + 0.05 * Math.max(0, n[1]) - 0.08 * Math.max(0, -n[2]);
const OUTLINE = "#0b0c0e";
const MAP_LIGHT = (n) => 0.24 * n[2] - 0.42 * Math.max(0, n[0]) + 0.06 * Math.max(0, n[1]) - 0.08 * Math.max(0, -n[2]); // the map's pieces' (mapfigures.js)
const hash = (a, b = 0, c = 0) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1103515245); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

// ---------- colours ----------
const C = {
  green: "#4a7f44", greenIn: "#30552e", greenRim: "#79a86a", rust: "#7e4c34", rustDk: "#5a3424",
  steel: "#5b6168", steelDk: "#3c4147", steelLt: "#8d959c", tire: "#1f1d1a", hub: "#a9a59c",
  wood: "#7a5532", woodLt: "#a27a4c", woodDk: "#55391f", bed: "#5e4228", grip: "#3a2e24", iron: "#2e2c2a", void: "#2a2118",
  bark: "#6b4a2c", grain: "#c9a070", sack: "#a08a5c", sackDk: "#7d6a44", crate: "#94704a", can: "#a8322a", jug: "#3a6fb0", tarp: "#4f6a8a",
};

// ---------- the parts ----------
// A face: a planar convex polygon (pts, model space) in a colour, or tex(P, inside) → a colour per point (null: the
// face's own, "": nothing there, a hole); out: a point inside its solid (the normal is turned away from it); two: an
// open sheet seen from both sides (the far side in its inner colour, inside: true to tex); g: its part (the rim
// parts the parts).
const face = (pts, col, o = {}) => ({ pts, col, tex: o.tex || null, g: o.g || 0, two: !!o.two, inner: o.inner || null, out: o.out || null });
// A box, x0..x1 × y0..y1 × z0..z1.
function box(F, x0, x1, y0, y1, z0, z1, col, o = {}) {
  const P = (x, y, z) => [x, y, z], c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const fs = [
    [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], [P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0)],
    [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], [P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)],
    [P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0)], [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)],
  ];
  for (const pts of fs) F.push(face(pts, col, { ...o, out: c }));
}
// A prism from A to B: an n-sided section of radius r0 at A, r1 at B (tapered), turned by phase; capTex(P, end) for
// its ends (a wheel's hub and spokes, a log's grain), sideTex(P) for its sides.
function prism(F, A, B, r0, r1, n, col, o = {}) {
  const d = norm(sub(B, A)), ref = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = norm(cross(ref, d)), v = cross(d, u), ph = o.phase || 0, mid = mul(add(A, B), 0.5);
  const ring = (C0, r) => Array.from({ length: n }, (_, k) => { const a = ph + (2 * Math.PI * k) / n; return add(C0, add(mul(u, r * Math.cos(a)), mul(v, r * Math.sin(a)))); });
  const ra = ring(A, r0), rb = ring(B, r1);
  for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; F.push(face([ra[k], ra[k1], rb[k1], rb[k]], col, { tex: o.sideTex, g: o.g, out: mid })); }
  F.push(face(ra, o.capCol || col, { tex: o.capTex ? (P) => o.capTex(P, "A") : null, g: o.g, out: mid }));
  F.push(face(rb, o.capCol || col, { tex: o.capTex ? (P) => o.capTex(P, "B") : null, g: o.g, out: mid }));
}
// A square beam from A to B, w across.
const beam = (F, A, B, w, col, o = {}) => prism(F, A, B, w / Math.SQRT2, w / Math.SQRT2, 4, col, { phase: Math.PI / 4, ...o });
// A wheel on an axle along y: hub (x, y) at height r, tw wide; spokes (n) or a pressed disc (0); a wooden felloe.
function wheel(F, x, y, r, tw, spokes, o = {}) {
  const g = o.g ?? 3;
  const capTex = (P) => {
    const dx = P[0] - x, dz = P[2] - r, d = Math.hypot(dx, dz) / r, a = Math.atan2(dz, dx);
    if (d > 0.86) return o.tread || C.tire;
    if (spokes) {
      if (d > 0.64) return C.woodLt; // the felloe
      if (d < 0.24) return C.iron; // the hub
      const s = (2 * Math.PI) / spokes, q = (((a % s) + s) % s);
      return q < 0.34 || q > s - 0.34 ? C.woodLt : C.void; // a spoke, or the shade between them
    }
    if (d < 0.22) return C.hub;
    return d < 0.3 ? C.steelDk : C.steel;
  };
  prism(F, [x, y - tw / 2, r], [x, y + tw / 2, r], r, r, spokes ? 14 : 12, o.tread || C.tire, { g, capTex, phase: Math.PI / (spokes ? 14 : 12) });
  if (spokes) prism(F, [x, y - tw / 2 - 0.5, r], [x, y + tw / 2 + 0.5, r], r * 0.22, r * 0.22, 6, C.iron, { g }); // the hub through it
}
// A wheel off, lying flat on the ground at (x, y).
function wheelDown(F, x, y, r, tw, spokes) {
  const capTex = (P) => {
    const dx = P[0] - x, dy = P[1] - y, d = Math.hypot(dx, dy) / r;
    if (d > 0.86) return spokes ? C.iron : C.tire;
    if (!spokes) return d < 0.25 ? C.hub : C.steel;
    const s = (2 * Math.PI) / spokes, q = (((Math.atan2(dy, dx) % s) + s) % s);
    return d > 0.64 ? C.woodLt : d < 0.24 ? C.iron : q < 0.34 || q > s - 0.34 ? C.woodLt : C.void;
  };
  prism(F, [x, y, 0], [x, y, tw], r, r, spokes ? 14 : 12, C.tire, { g: 9, capTex });
}

// ---------- what it holds ----------
// Fills the bed (x0..x1 × y0..y1 from the floor z0, the rim at z1) with the load's pieces, each a part of its own.
function load(F, kind, level, x0, x1, y0, y1, z0, z1, seed) {
  if (!level) return;
  const top = z0 + (z1 - z0) * [0, 0.5, 0.95, 1.35][level], L = x1 - x0, W = y1 - y0;
  let g = 20;
  const rnd = (k) => hash(seed, k, level);
  if (kind === "wood") { // wood: logs along the bed, stacked
    const r = 1.15, per = Math.max(1, Math.floor(W / (2 * r + 0.15)));
    for (let layer = 0, z = z0 + r; z - r < top - 0.4 && layer < 4; layer++, z += 2 * r * 0.86) {
      const n = per - (layer % 2), off = (W - n * 2 * r) / 2 + r + (layer % 2) * r;
      for (let i = 0; i < n; i++) {
        const y = y0 + off + i * 2 * r, a = x0 + 0.4 + rnd(layer * 9 + i) * 0.8, b = x1 - 0.4 - rnd(layer * 9 + i + 50) * 0.8;
        prism(F, [a, y, z], [b, y, z], r, r, 6, C.bark, { g: g++, capCol: C.grain, phase: rnd(i + layer) });
      }
    }
    return;
  }
  const pieces = [];
  const cells = Math.max(2, Math.round((L * W) / 14));
  for (let i = 0; i < cells; i++) pieces.push([x0 + 1.2 + rnd(i) * (L - 2.4), y0 + 1.2 + rnd(i + 30) * (W - 2.4)]);
  pieces.sort((p, q) => p[0] + p[1] - q[0] - q[1]);
  const hgt = (k) => Math.max(1.4, (top - z0) * (0.7 + rnd(k + 70) * 0.5));
  pieces.forEach(([x, y], i) => {
    const h = hgt(i);
    if (kind === "scrap") {
      const col = [C.steel, C.rust, C.steelDk, C.steelLt][Math.floor(rnd(i + 90) * 4)];
      if (i % 3 === 2) prism(F, [x - 2.2, y - 0.6, z0 + 0.8], [x + 2.4, y + 0.8, z0 + h], 0.55, 0.55, 6, C.steelLt, { g: g++ }); // a pipe across the heap
      else box(F, x - 1.3, x + 1.2, y - 1.1, y + 1.2, z0, z0 + h * 0.8, col, { g: g++, tex: (P) => (hash(Math.floor(P[0] * 2), Math.floor(P[1] * 2), Math.floor(P[2] * 2)) < 0.18 ? C.rustDk : null) });
    } else if (kind === "fuel") {
      box(F, x - 1.4, x + 1.4, y - 0.8, y + 0.8, z0, z0 + Math.min(h, 4.6), C.can, { g: g++, tex: (P) => (Math.abs(P[1] - y) < 0.2 ? shade(C.can, -0.3) : null) }); // a jerrycan, its seam
      box(F, x - 0.8, x + 0.2, y - 0.25, y + 0.25, z0 + Math.min(h, 4.6), z0 + Math.min(h, 4.6) + 0.8, C.steelDk, { g: g++ }); // the handle
    } else if (kind === "water") {
      prism(F, [x, y, z0], [x, y, z0 + Math.min(h, 4.8)], 1.3, 1.1, 8, C.jug, { g: g++, capCol: shade(C.jug, 0.25) });
    } else if (i % 3 === 1) {
      box(F, x - 1.5, x + 1.5, y - 1.4, y + 1.4, z0, z0 + Math.min(h, 3.4), C.crate, { g: g++, tex: (P) => (Math.abs(P[2] - (z0 + Math.min(h, 3.4) / 2)) < 0.35 ? C.woodDk : null) }); // a crate, a slat round it
    } else {
      const col = i % 4 === 2 ? C.tarp : C.sack;
      prism(F, [x, y, z0], [x, y, z0 + h], 1.7, 1.0, 6, col, { g: g++, phase: rnd(i + 5), capCol: shade(col, -0.15) }); // a sack, tied at the neck
    }
  });
}

// ---------- the two carts ----------
// A wheelbarrow, parked: on its wheel and two legs, the handles back toward -x, the grips at the origin's end. Its
// own frame: the grips at x = 0, the axle at x = 16 (the parked one is centred on x = 8.5).
function barrowParts(o) {
  const F = [], wear = o.wear || 0, rust = (P) => (wear && hash(Math.floor(P[0] * 1.4), Math.floor(P[1] * 1.4), Math.floor(P[2] * 1.4)) < wear * 0.4);
  // the tray: a pressed steel tub, wider and longer at the rim, its front sloping out over the wheel
  const b = [[6.2, -2.7, 4.4], [12.2, -2.7, 4.4], [12.2, 2.7, 4.4], [6.2, 2.7, 4.4]];
  const t = [[3.8, -4.6, 10.2], [15.0, -4.6, 10.2], [15.0, 4.6, 10.2], [3.8, 4.6, 10.2]];
  const mid = [9.4, 0, 7.6];
  const wall = (P, inside) => (rust(P) ? (inside ? C.rustDk : C.rust) : P[2] > 9.4 ? C.greenRim : inside ? C.greenIn : null);
  for (let k = 0; k < 4; k++) { const k1 = (k + 1) % 4; F.push(face([b[k], b[k1], t[k1], t[k]], C.green, { tex: wall, two: true, inner: C.greenIn, out: mid, g: 1 })); }
  F.push(face(b, C.greenIn, { tex: (P) => (rust(P) ? C.rustDk : null), two: true, inner: C.greenIn, out: mid, g: 1 })); // its floor
  // the frame: two handles from the grips down to the axle, two legs, a cross brace
  for (const s of [-1, 1]) {
    beam(F, [0.6, s * 5.7, 7.0], [16.2, s * 1.5, 3.3], 1.1, C.wood, { g: 2 });
    beam(F, [0.2, s * 5.8, 7.07], [3.0, s * 5.05, 6.57], 1.35, C.grip, { g: 2 }); // the grips
    beam(F, [8.6, s * 3.25, 5.3], [8.1, s * 3.4, 0], 0.7, C.steelDk, { g: 2 }); // a leg
  }
  beam(F, [8.6, -3.2, 5.0], [8.6, 3.2, 5.0], 0.7, C.steelDk, { g: 2 });
  if (o.broken) wheelDown(F, 13.5, 6.2, 3.2, 1.6, 0);
  else wheel(F, 16.2, 0, 3.3, 1.8, 0, { g: 3 });
  load(F, o.kind, o.level, 6.0, 13.6, -3.6, 3.6, 4.6, 10.2, o.seed || 1);
  return F;
}
// A hand cart, parked: a plank bed with side boards on two big spoked wheels, a T handle forward on its pole and a
// prop leg under the front. Its own frame: the T handle at x = 0, the bed behind it (-x), the axle at x = -14.5.
function handcartParts(o) {
  const F = [], wear = o.wear || 0, rust = (P) => (wear && hash(Math.floor(P[0]), Math.floor(P[1]), Math.floor(P[2] * 1.5)) < wear * 0.35);
  const planks = (P) => (o.plain ? null : rust(P) ? C.woodDk : Math.abs(((P[1] + 5.4) % 3.6 + 3.6) % 3.6) < 0.4 ? C.woodDk : null); // the planks, along the bed
  const boards = (P) => (P[2] > 9.2 ? shade(C.woodLt, 0.12) : o.plain ? null : rust(P) ? C.woodDk : Math.abs(P[2] - 8.0) < 0.35 ? C.wood : null); // two planks a board, the top edge catching the light
  box(F, -21.5, -6.5, -5.4, 5.4, 5.0, 6.2, C.bed, { tex: planks, g: 1 }); // the bed, darker: the inside of the box
  for (const s of [-1, 1]) {
    box(F, -21.5, -6.5, s > 0 ? 4.8 : -5.4, s > 0 ? 5.4 : -4.8, 6.2, 9.8, C.woodLt, { tex: boards, g: 1 }); // a side board
    beam(F, [-21.0, s * 5.6, 5.4], [-21.0, s * 5.6, 10.4], 0.8, C.woodDk, { g: 1 }); // the corner posts
    beam(F, [-7.0, s * 5.6, 5.4], [-7.0, s * 5.6, 10.4], 0.8, C.woodDk, { g: 1 });
  }
  box(F, -21.5, -20.9, -4.8, 4.8, 6.2, 9.8, C.woodLt, { tex: boards, g: 1 }); // the tailboard
  box(F, -7.1, -6.5, -4.8, 4.8, 6.2, 8.2, C.woodLt, { tex: boards, g: 1 }); // the low front board
  beam(F, [-14.5, -6.6, 4.4], [-14.5, 6.6, 4.4], 0.9, C.iron, { g: 1 }); // the axle under the bed
  beam(F, [-8.4, 0, 5.0], [-8.4, 0, 0.3], 1.0, C.woodDk, { g: 2 }); // the prop leg
  beam(F, [-6.5, 0, 5.6], [-1.0, 0, 7.6], 1.0, C.woodDk, { g: 2 }); // the pole
  prism(F, [-0.8, -6.0, 7.8], [-0.8, 6.0, 7.8], 0.6, 0.6, 6, C.grip, { g: 2 }); // the T handle's crossbar
  for (const s of [-1, 1]) {
    if (o.broken && s > 0) { wheelDown(F, -12.0, 9.2, 4.4, 1.0, 8); continue; }
    wheel(F, -14.5, s * 6.9, 4.4, 1.0, 8, { g: 3 + (s > 0 ? 1 : 0), tread: C.iron });
  }
  load(F, o.kind, o.level, -20.6, -7.4, -4.6, 4.6, 6.2, 9.8, o.seed || 1);
  return F;
}
// Where each cart's model sits: held, from its pusher's feet (the wheelbarrow pushed ahead, the grips at the hands;
// the hand cart pulled behind); parked, centred on its cell. tilt: the held pose's lift (the legs or the prop off the
// ground) and a broken cart's sag. Returns the parts moved there.
const POSE = {
  barrow: { s: 1.1, held: { dx: -0.9, pivot: [16.2, 0, 0], pitch: -0.07 }, parked: { dx: -10.4, pivot: [16.2, 0, 0], pitch: 0 }, broken: { pivot: [8.0, 0, 0], pitch: -0.22 } },
  cart: { s: 0.85, held: { dx: -0.2, pivot: [-14.5, 0, 0], pitch: 0.07 }, parked: { dx: 9.2, pivot: [-14.5, 0, 0], pitch: 0 }, broken: { pivot: [-14.5, -6.9, 0], roll: 0.3 } },
};
function placed(F, look, o) {
  const P = POSE[look], hp = o.held ? P.held : P.parked;
  const turn = (q, piv, pitch, roll) => {
    let [x, y, z] = sub(q, piv);
    if (pitch) { const c = Math.cos(pitch), s = Math.sin(pitch); [x, z] = [x * c - z * s, x * s + z * c]; }
    if (roll) { const c = Math.cos(roll), s = Math.sin(roll); [y, z] = [y * c - z * s, y * s + z * c]; }
    return add([x, y, z], piv);
  };
  for (const f of F) {
    const fixed = f.g === 9; // a wheel lying off: stays on the ground
    const move = (q) => {
      let r = q;
      if (!fixed && o.broken) r = turn(r, P.broken.pivot, P.broken.pitch || 0, P.broken.roll || 0);
      else if (!fixed) r = turn(r, hp.pivot, hp.pitch, 0);
      if (P.s) r = mul(r, P.s); // built in round numbers, scaled to stand by a person: the barrow to the hip, the hand cart a tile and a bit long
      return [r[0] + hp.dx, r[1], r[2]];
    };
    f.src = f.pts; // the textures read the model's own points (rasterize maps a pixel back to them)
    f.pts = f.pts.map(move);
    if (f.out) f.out = move(f.out);
  }
  return F;
}

// ---------- the painter ----------
// Rasterizes the faces at a yaw (degrees) and scale k onto a painter grid g ({ w, h, ox, oy }: the origin's px),
// into a depth buffer, then a dark rim where a part stands in front of another. p: an existing painter, else a new
// one; light: the light rule (the map's is harder). Returns the painter.
function rasterize(F, yaw, k, g, p = null, light = LIGHT) {
  p = p || painter(g.w, g.h);
  const a = (yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const W = (q) => [(q[0] * c - q[1] * s) * k, (q[0] * s + q[1] * c) * k, q[2] * k];
  const zb = new Float32Array(g.w * g.h).fill(-1e9), gb = new Int16Array(g.w * g.h).fill(-1);
  for (const f of F) {
    const w = f.pts.map(W);
    let n = norm(cross(sub(w[1], w[0]), sub(w[2], w[0])));
    if (f.out) { const ctr = mul(w.reduce((acc, q) => add(acc, q), [0, 0, 0]), 1 / w.length); if (dot(n, sub(ctr, W(f.out))) < 0) n = mul(n, -1); }
    let inside = false;
    if (dot(n, VIEW) <= 0.02) { if (!f.two) continue; n = mul(n, -1); inside = true; }
    const lit = light(n), base = inside ? f.inner || f.col : f.col;
    const scr = w.map((q) => [g.ox + SX(q), g.oy + SY(q), DEPTH(q)]);
    // back to model space for the texture: the face's points are an affine image of the screen within its plane
    const src = f.src || f.pts, m0 = src[0], e1 = sub(src[1], m0), e2 = sub(src[2], m0);
    const s0 = scr[0], d1 = [scr[1][0] - s0[0], scr[1][1] - s0[1]], d2 = [scr[2][0] - s0[0], scr[2][1] - s0[1]], det = d1[0] * d2[1] - d1[1] * d2[0];
    const model = Math.abs(det) > 1e-6 ? (x, y) => { const dx = x - s0[0], dy = y - s0[1], u = (dx * d2[1] - dy * d2[0]) / det, v = (d1[0] * dy - d1[1] * dx) / det; return add(m0, add(mul(e1, u), mul(e2, v))); } : () => m0;
    const cache = new Map();
    const colAt = (x, y) => {
      const t = f.tex ? f.tex(model(x, y), inside) : null;
      if (t === "") return null;
      const col = t || base;
      let out = cache.get(col);
      if (out === undefined) { out = shade(col, lit); cache.set(col, out); }
      return out;
    };
    for (let i = 1; i < scr.length - 1; i++) tri(scr[0], scr[i], scr[i + 1], (x, y, d) => {
      const j = y * g.w + x;
      if (d <= zb[j]) return;
      const col = colAt(x + 0.5, y + 0.5);
      if (!col) return;
      zb[j] = d; gb[j] = f.g; p.set(x, y, col);
    }, g);
  }
  // the rim: where two parts meet, the one behind gets a dark edge
  const px = p.px;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = y * g.w + x;
    if (gb[i] < 0) continue;
    const front = (j) => gb[j] >= 0 && gb[j] !== gb[i] && zb[j] > zb[i] + 1.2 * k;
    if ((x > 0 && front(i - 1)) || (x < g.w - 1 && front(i + 1)) || (y > 0 && front(i - g.w)) || (y < g.h - 1 && front(i + g.w))) px[i] = OUTLINE;
  }
  return p;
}
// One triangle's pixels (their centres inside, a little generous so a thin beam keeps its pixels), depth interpolated.
function tri(A, B, Cc, plot, g) {
  const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], Cc[0]) - 1)), x1 = Math.min(g.w - 1, Math.ceil(Math.max(A[0], B[0], Cc[0]) + 1));
  const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], Cc[1]) - 1)), y1 = Math.min(g.h - 1, Math.ceil(Math.max(A[1], B[1], Cc[1]) + 1));
  const area = (B[0] - A[0]) * (Cc[1] - A[1]) - (B[1] - A[1]) * (Cc[0] - A[0]);
  if (Math.abs(area) < 1e-6) return;
  const E = (P, Q, x, y) => ((Q[0] - P[0]) * (y - P[1]) - (Q[1] - P[1]) * (x - P[0])) / area;
  const lens = [Math.hypot(Cc[0] - B[0], Cc[1] - B[1]), Math.hypot(A[0] - Cc[0], A[1] - Cc[1]), Math.hypot(B[0] - A[0], B[1] - A[1])];
  const tol = lens.map((l) => (0.42 * l) / Math.abs(area)); // half a px from each edge, in barycentric units
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = E(B, Cc, px, py), w1 = E(Cc, A, px, py), w2 = E(A, B, px, py);
    if (w0 < -tol[0] || w1 < -tol[1] || w2 < -tol[2]) continue;
    plot(x, y, A[2] * w0 + B[2] * w1 + Cc[2] * w2);
  }
}
// The model's screen box at a yaw and scale (grid px from its origin).
function bounds(F, yaw, k) {
  const a = (yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const f of F) for (const q of f.pts) {
    const w = [(q[0] * c - q[1] * s) * k, (q[0] * s + q[1] * c) * k, q[2] * k], X = SX(w), Y = SY(w);
    x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
  }
  return [x0, x1, y0, y1];
}

// ---------- the pictures ----------
// look: "barrow" | "cart" (sim/data-carts.js cart.look); o: { held, kind ("" | "wood" | "scrap" | "fuel" | "water" |
// "goods"), level 0..3, broken, wear 0..1, seed }.
export function cartParts(look, o = {}) {
  const F = look === "cart" ? handcartParts(o) : barrowParts(o);
  return placed(F, look === "cart" ? "cart" : "barrow", o);
}
// Fog of war on a picture (isoview.js fogPixels): darker, greyer, a little blue.
function fogged(p) {
  for (let i = 0; i < p.px.length; i++) {
    const c = p.px[i];
    if (!c || c[0] !== "#" || c.length !== 7) continue;
    const n = parseInt(c.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255, l = r * 0.3 + g * 0.59 + b * 0.11;
    const f = (v, add0) => Math.max(0, Math.min(255, Math.round((v * 0.35 + l * 0.65) * 0.42 + add0)));
    p.px[i] = `#${[f(r, 6), f(g, 8), f(b, 14)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }
}
const cache = new Map(), BUDGET = 24 << 20;
let cacheBytes = 0;
export const cartArtStats = { painted: 0 };
const STEP = 15;
// The battle's picture of a cart at a yaw (degrees, the figures': 0 the view's +u, screen right-down), with
// cv.figure = { ox, oy, w, h } (its origin's grid px: a held cart's pusher's feet, a parked one's cell centre), drawn
// as the figures are (isoview.js drawFigure). null without a canvas (the tools).
export function cartCanvas(look, yaw, o = {}) {
  const y = (((Math.round(yaw / STEP) * STEP) % 360) + 360) % 360;
  const key = `${look}|${y}|${o.held ? 1 : 0}|${o.kind || ""}|${o.level || 0}|${o.broken ? 1 : 0}|${Math.round((o.wear || 0) * 4)}|${(o.seed || 1) % 7}|${o.fog ? 1 : 0}`;
  const e = cache.get(key);
  if (e !== undefined) { cache.delete(key); cache.set(key, e); return e.cv; }
  const F = cartParts(look, { ...o, wear: Math.round((o.wear || 0) * 4) / 4, seed: (o.seed || 1) % 7 });
  const [x0, x1, y0, y1] = bounds(F, y, 1);
  const g = { ox: Math.ceil(-x0) + 2, oy: Math.ceil(-y0) + 2 };
  g.w = g.ox + Math.ceil(x1) + 3; g.h = g.oy + Math.ceil(y1) + 3;
  const p = rasterize(F, y, 1, g);
  if (o.fog) fogged(p);
  const cv = toCanvas(p);
  if (cv) cv.figure = g;
  const bytes = g.w * g.h * 64;
  cache.set(key, { cv, bytes, g });
  cacheBytes += bytes;
  while (cacheBytes > BUDGET && cache.size > 1) { const [k, old] = cache.entries().next().value; cache.delete(k); cacheBytes -= old.bytes; }
  cartArtStats.painted++;
  return cv;
}
// The grid px of a model point (a held cart's tray, for its count) at a yaw, from the origin.
const trays = new Map(); // look|held -> the bed's middle at its rim (model space)
export function cartPoint(look, yaw, held) {
  const tk = `${look}|${held ? 1 : 0}`;
  let m = trays.get(tk);
  if (!m) {
    const pts = cartParts(look, { held }).flatMap((f) => (f.g === 1 ? f.pts : []));
    m = mul(pts.reduce((a, b) => add(a, b), [0, 0, 0]), 1 / Math.max(1, pts.length));
    m[2] = Math.max(...pts.map((p) => p[2]));
    trays.set(tk, m);
  }
  const a = (yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), w = [m[0] * c - m[1] * s, m[0] * s + m[1] * c, m[2]];
  return [SX(w), SY(w)];
}
// The State Map's marker for a cart left on a tile (render.js): the parked cart at the map's scale (a person 14 px),
// what is in it heaped when it holds something. Its canvas; cv.grid as a map piece's.
export function cartMarkerCanvas(look, loaded) {
  const key = `marker|${look}|${loaded ? 1 : 0}`;
  const e = cache.get(key);
  if (e !== undefined) return e.cv;
  const k = 0.75, yaw = look === "cart" ? 120 : 300; // finer than the map's 14 px person: the marker is drawn to its width anyway
  const F = cartParts(look, { held: false, kind: loaded ? "goods" : "", level: loaded ? 1 : 0, seed: 3, plain: true }); // plain: no plank lines (noise at this size)
  const [x0, x1, y0, y1] = bounds(F, yaw, k);
  const g = { ox: Math.ceil(-x0) + 1, oy: Math.ceil(-y0) + 1 };
  g.w = g.ox + Math.ceil(x1) + 2; g.h = g.oy + Math.ceil(y1) + 2;
  const cv = toCanvas(rasterize(F, yaw, k, g, null, MAP_LIGHT));
  if (cv) cv.grid = g;
  cache.set(key, { cv, bytes: g.w * g.h * 64, g });
  cacheBytes += g.w * g.h * 64;
  return cv;
}
onForgetPictures(() => { cache.clear(); cacheBytes = 0; }); // ui/pictures.js: drawn again after a lost GPU context
