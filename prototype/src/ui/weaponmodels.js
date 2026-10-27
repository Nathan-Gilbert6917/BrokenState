// Every weapon as a small low-poly model in the figures' hands (ui/figures.js; issue #77, the user's request
// 2026-10-26: "I want each weapon survivors, raiders and AI group survivors can use be displayed accordingly with
// models that match the 2d sprite"). One model a weapon key, built from the figures' own primitives (a limb: a
// tapered prism between two points; a box: a four-sided one) in the house style of the vehicles and carts
// (ui/vehiclemodel.js, ui/cartmodel.js): flat colours lit by the face, a glint along the top edge, the dark rim
// against the body painted by the figure.
//
// Guns are built from their own 2D drawing's spec (ui/gunspecs.js GUN_ART through ui/gunpaint.js norm: the receiver,
// fore-end and barrel landmarks, the stock and magazine kinds, the colours by part), so a gun's silhouette, proportions
// and colours are its icon's by construction: a wood-stocked pump with its slide, a double barrel, a lever gun's loop
// and tube, an AK's curved magazine and wood, a bullpup's magazine behind the grip, a drum, a belt box and bipod on
// a machine gun, a scope where the gun carries one, a tube on the shoulder. Fitted parts come with the weapon look
// (ui/gunparts.js weaponLook: "key|finish|slot=look,..."): the big ones that read at this scale (an optic, a
// suppressor or brake, a drum or box magazine, a stock, a bipod, a fore grip, a light). Melee weapons, bows,
// crossbows and the launchers' shapes are a table here (MELEE, BOWS), their colours the item icons'
// (ui/itemart/wear.js, sim/data-blades.js BLADE_LOOK).
//
// Model space: +x along the weapon toward the muzzle, the point or the head; +y left; +z up; the origin at the right
// fist's place on the grip; in figure pixels (a person 30 tall). A model is { key, hold, parts, grip, fore, muzzle,
// len }: hold the pose class (HOLDS: how the figure's arms take it), parts its limbs, fore where the other hand goes
// (null for one hand), muzzle the barrel's far end (null for a blade). placeModel turns it into figure space along a
// direction. A model is built once a look and kept (models).
// Adding a weapon: a gun needs only its GUN_ART spec (a gun without one is drawn as its look-alike, as its icon is);
// a melee weapon or a bow an entry in MELEE / BOWS (hold + a build function on the M helpers), else it is a plain
// blade or haft by its GEAR category (fallback).
import { GEAR } from "../sim/data.js";
import { specOf, norm, C, STOCKS, LOOK_STOCK, LOOK_MAG, isGunKey } from "./gunpaint.js";
import { PART_MINI, parseLook } from "./gunparts.js";
import { BLADE_LOOK } from "../sim/data-blades.js";
import { shade } from "./itemart/kit.js";

// ---------- vectors ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]), norm3 = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ---------- the pose classes ----------
// gun: a long gun at the low ready, the right hand on the grip, the left out on the fore-end; smg: the same, short;
// pump: the gun pose, the left hand on the slide; pistol: one arm out; revolver: one arm out, the gun nosed up a
// little; side: a short blade or tool hanging in the right fist, its point down and forward; sabre: one hand, the
// blade raised; sword: two hands on the hilt before the chest, the blade up; shoulder: a two-handed club, axe or
// haft over the right shoulder; spear: level at the hip in both hands, the point forward; bow: out in the right
// hand, the string hand at the chest; crossbow: the smg pose, the prod across; tube: a launcher resting on the
// right shoulder, the right hand on its grip, the left on the tube.
export const HOLDS = ["gun", "smg", "pump", "pistol", "revolver", "side", "sabre", "sword", "shoulder", "spear", "bow", "crossbow", "tube"];
const GLINT = "#e9eef1", OUT = "#0b0c0e";
const glintOf = (col) => shade(col, 0.45);
// A part's texture: the top edge catches the light in the part's own colour (a near-white on a blade).
const top = (col, under = null) => (face, s, t) => (face === "top" ? col : under ? under(face, s, t) : null);

// ---------- a model's parts: limb-shaped records (ui/figures.js limb / boxL) ----------
const limb = (A, B, ra, rb, col, o = {}) => ({ A, B, ra, rb, col, sides: o.sides ?? 8, phase: o.phase ?? 0, taper: o.taper ?? 1, tex: o.tex || null, u: o.u || null, group: 1, flat: !!o.flat });
const boxL = (A, B, ha, hb, col, o = {}) => limb(A, B, ha * Math.SQRT2, hb * Math.SQRT2, col, { sides: 4, phase: Math.PI / 4, ...o });

// The helpers a build works with (figure px, model space). Every part gets the top glint unless told not to.
function helpers(parts) {
  const push = (L) => { parts.push(L); return L; };
  const M = {
    parts,
    // a box along x from x0 to x1 at height z, h tall (z), w wide (y)
    bar: (x0, x1, z, h, w, col, o = {}) => push(boxL([x0, o.y || 0, z], [x1, o.y || 0, z], h / 2, w / 2, col, { u: [0, 0, 1], tex: o.plain ? o.tex || null : top(o.glint || glintOf(col), o.tex), taper: o.taper, flat: o.flat })),
    // a box between any two points, ha across its up (u), hb across the other way
    box: (A, B, ha, hb, col, o = {}) => push(boxL(A, B, ha, hb, col, { u: o.u || [0, 0, 1], tex: o.plain ? o.tex || null : top(o.glint || glintOf(col), o.tex), taper: o.taper, flat: o.flat })),
    // a round part (8 sides) between two points
    rod: (A, B, ra, rb, col, o = {}) => push(limb(A, B, ra, rb, col, { sides: o.sides || 8, u: o.u || null, taper: o.taper, tex: o.plain ? o.tex || null : top(o.glint || glintOf(col), o.tex) })),
    // a vertical box: from z0 to z1 at x (slanting to x1 at the bottom), d deep (x), w wide (y)
    post: (x, z0, x1, z1, d, w, col, o = {}) => push(boxL([x, o.y || 0, z0], [x1, o.y || 0, z1], d / 2, w / 2, col, { u: [1, 0, 0], tex: o.plain ? null : top(o.glint || glintOf(col)), taper: o.taper })),
    // a blade along x: w across (z), th thick (y); the last `tip` px taper to the point; edge: the glint's colour
    blade: (x0, x1, w, th, col, o = {}) => {
      const tip = o.tip ?? Math.min(1.6, (x1 - x0) * 0.35), z = o.z || 0, e = o.edge || GLINT;
      const tex = top(e, (face, s, t) => (face === "bottom" ? shade(col, -0.25) : null));
      if (x1 - tip > x0) push(boxL([x0, 0, z], [x1 - tip, 0, z + (o.rise || 0)], w / 2, th / 2, col, { u: [0, 0, 1], tex }));
      push(boxL([Math.max(x0, x1 - tip), 0, z + (o.rise || 0)], [x1, 0, z + (o.rise || 0) + (o.curl || 0)], w / 2, th / 2, col, { u: [0, 0, 1], taper: o.point ?? 0.18, tex }));
    },
    // a handle in the fist: a six-sided grip from x0 to x1 (the fist around x = 0)
    handle: (x0, x1, r, col, o = {}) => push(limb([x0, 0, 0], [x1, 0, 0], r, r, col, { sides: 6, u: [0, 0, 1], tex: o.tex || (o.wrap ? (face, s, t) => (Math.round(t * o.wrap) % 2 ? shade(col, -0.25) : null) : null) })),
    // a haft: round, from x0 to x1, radius r (ra) to rb at the far end
    haft: (x0, x1, r, col, o = {}) => push(limb([x0, 0, 0], [x1, 0, 0], r, r, col, { sides: 8, u: [0, 0, 1], taper: o.taper ?? 1, tex: top(glintOf(col), o.tex) })),
    // a guard across the blade at x: span across z (centred, or [z0, z1]), th thick (y), d deep (x)
    guard: (x, span, th, col, d = 0.5) => { const [z0, z1] = Array.isArray(span) ? span : [-span / 2, span / 2]; return push(boxL([x, 0, z0], [x, 0, z1], d / 2, th / 2, col, { u: [1, 0, 0], tex: top(glintOf(col)) })); },
    // a head across the haft at x in the swing plane: z from z0 to z1, d along the haft, w wide
    cross: (x, z0, z1, d, w, col, o = {}) => push(boxL([x, 0, z0], [x, 0, z1], d / 2, w / 2, col, { u: [1, 0, 0], taper: o.taper, tex: o.plain ? null : top(o.glint || glintOf(col), o.tex) })),
    // a spike to a point from A to B
    spike: (A, B, r, col) => push(limb(A, B, r, r, col, { sides: 4, taper: 0.12, tex: top(glintOf(col)) })),
    // a disc across y at x (a saw blade, a cylinder): radius r, th thick
    disc: (x, z, r, th, col, o = {}) => push(limb([x, -th / 2, z], [x, th / 2, z], r, r, col, { sides: o.sides || 8, u: [0, 0, 1], tex: o.tex || null })),
  };
  return M;
}

// ---------- guns from their art specs ----------
const SX = 0.29, SZ = 0.36; // figure px an art px along the gun and up it (a 54 px rifle 15.7 long; a receiver 4 rows 1.4 tall)
const PX = 0.19, PZ = 0.22; // pistols and revolvers (their drawings are at a bigger scale: a slide 26 px of 64)
const THICK = { body: 1.3, hg: 1.3, bar: 0.9, stock: 1.1, mag: 0.9, slide: 0.95, cyl: 1.6 };
const cn = (c, d = C.gun) => (c == null ? d : C[c] || c);
// The stock's kind for the model (fixed, tele, wire, drop, grip, none) and its length, from a spec's stock (a STOCKS
// kind, or a gun builder look) or a fitted stock look (gunparts.js PART_MINI { stock, len }).
function stockOf(st, fitted) {
  if (fitted && fitted.stock) return { t: fitted.stock, len: fitted.len || 11, col: fitted.col || C.gun };
  if (!st) return { t: "none", len: 0, col: C.gun };
  if (typeof st === "string") { const L = LOOK_STOCK[st] || (PART_MINI[st] && PART_MINI[st].stock ? [PART_MINI[st].stock, PART_MINI[st].len] : null); return L ? { t: L[0], len: L[1], col: C.gun } : { t: "fixed", len: 10, col: C.gun }; }
  const K = STOCKS[st.t] || STOCKS.ar;
  return { t: K.mini, len: st.len || K.len, col: cn(st.c, null) };
}
function magOf(mg, fitted) {
  if (fitted && fitted.mag) return { t: fitted.mag, n: fitted.n || 8, w: 4, col: C.gun };
  if (!mg) return null;
  if (typeof mg === "string") return { t: LOOK_MAG[mg] || "stick", n: 8, w: 4, col: C.gun };
  return { t: mg.t === "beltbox" ? "belt" : mg.t || "stick", n: mg.n || 8, w: mg.w || 4, curve: mg.curve, col: cn(mg.col), len: mg.len };
}
const DROP = new Set(["wood", "sporter", "pgwood", "lever", "light", "poly", "sniper", "thumb", "m14", "m79"]); // stocks with a wrist (no pistol grip of their own)
function gunModel(key, look) {
  const sp = specOf(key);
  if (!sp) return null;
  const s = norm(sp.key, look.finish || null), m = { ...(s.fam.mini ? s.fam.mini(s) : {}), ...(s.mini || {}) };
  const A = s.fam.anchors(s), at = (slot, d) => (s.anchors && s.anchors[slot]) || A[slot] || d;
  const F = (l) => (l && PART_MINI[l]) || null, fit = look.looks || {};
  const parts = [], M = helpers(parts), c = s.c;
  const pistol = s.kind === "pistol" || s.kind === "revolver";
  const sx = pistol ? PX : SX, sz = pistol ? PZ : SZ;
  const fx = pistol ? (s.body === "revolver" ? s.fr[0] + 3.5 : s.gx + 2) : s.gx + 1, fy = pistol ? 12.5 : 13; // the fist on the grip (art px)
  const X = (x) => (x - fx) * sx, Z = (y) => (fy - y) * sz, ZR = (y0, y1) => Z((y0 + y1 + 1) / 2 - 0.5); // a row span's middle
  const rows = (x0, y0, x1, y1, th, col, o = {}) => M.bar(X(x0), X(x1 + 1), ZR(y0, y1), (y1 - y0 + 1) * sz, th, col, o);
  const out = { key, hold: "gun", parts, grip: [0, 0, 0], fore: null, muzzle: null };
  let bar = s.bar, barY = 7, barRows = s.barRows || (m.bar2 ? 2 : 1);
  // ---- pistols ----
  if (s.body === "slide" || s.body === "rimpistol") {
    const x0 = s.x0 || 18, x1 = s.x1 || (s.body === "rimpistol" ? 30 : 44), y0 = s.y0 || 5, gripN = s.gripN || 10;
    rows(x0, y0, x1, 8, THICK.slide, c.slide || c.body, { tex: (face, s2, t) => (face !== "top" && t > 0.78 ? shade(c.slide || c.body, -0.25) : null) }); // the slide, its serrations
    if (s.body === "rimpistol") { bar = s.bar || 46; M.rod([X(x1 + 1), 0, Z(7)], [X(bar + 1), 0, Z(7)], 0.42, 0.4, c.bar || c.slide); barY = 7; }
    else bar = x1;
    rows(x0 + 2, 9, x1 - 4, 10, THICK.slide * 0.95, c.frame || c.body); // the frame
    M.post(X(x0 + 5), Z(10.5), X(x0 + 2), Z(11 + gripN), 1.4 * sx * 3, 0.9, c.grip || c.frame || c.body, { tex: c.panels ? (face) => (face === "left" || face === "right" ? c.panels : null) : null }); // the grip, its panels
    if (c.panels) parts[parts.length - 1].tex = (face, s2, t) => (face === "left" || face === "right" ? (t > 0.2 && t < 0.9 ? c.panels : null) : face === "top" ? glintOf(c.grip || c.frame) : null);
    M.post(X(x0 + 9), Z(10.5), X(x0 + 11), Z(12.5), 0.3, 0.4, C.dark, { plain: true }); // the trigger guard's front
    if (s.hammer) M.post(X(x0 - 1), Z(7), X(x0 - 1.5), Z(5), 0.4, 0.5, C.dark, { plain: true });
    out.hold = "pistol";
    out.muzzle = [X(bar + 1), 0, Z(barY)];
  } else if (s.body === "revolver") {
    const [f0, f1] = s.fr, [c0, c1] = s.cyl;
    rows(f0, 6, f1, 11, THICK.slide, c.frame); // the frame
    M.disc(X((c0 + c1 + 1) / 2), ZR(7, 11), 2.6 * sz, THICK.cyl, c.cyl || shade(c.frame, -0.2), { tex: (face, s2, t) => (face !== "left" && face !== "right" && Math.round(s2 * 6) % 2 ? shade(c.cyl || c.frame, -0.2) : null) }); // the cylinder, its flutes
    M.rod([X(f1 + 1), 0, Z(7)], [X(s.bar + 1), 0, Z(7)], 0.52, 0.48, c.bar || c.frame); // the barrel
    if (s.lug) rows(f1 + 1, 8, s.bar - 2, 9, 0.8, c.bar || c.frame); // the under-lug, the ejector rod
    M.post(X(f0 + 4), Z(11), X(f0 + 1), Z(17), 1.3, 0.9, c.grip || C.wood, { tex: (face, s2, t) => (face === "top" ? glintOf(c.grip || C.wood) : t > 0.2 && Math.round(t * 5) % 2 ? shade(c.grip || C.wood, -0.18) : null) }); // the grips
    if (s.hammer !== "bob") M.post(X(f0 - 1), Z(6.5), X(f0 - 2), Z(5), 0.4, 0.5, C.dark, { plain: true }); // the hammer spur
    M.post(X(f0 + 6), Z(11), X(f0 + 8), Z(12.5), 0.3, 0.4, C.dark, { plain: true });
    out.hold = "revolver";
    bar = s.bar; out.muzzle = [X(bar + 1), 0, Z(7)];
  } else if (s.body === "tube") {
    // a launcher on the shoulder: the tube along the top, its grips under it
    const r0 = s.r0, r1 = s.r1, rpg = s.v === "rpg";
    if (rpg) {
      M.rod([X(r0 + 2), 0, Z(8)], [X(r1 - 12), 0, Z(8)], 1.7 * sz, 1.4 * sz, c.body); // the tube, flared at the back
      M.rod([X(r0 + 16), 0, Z(8)], [X(r0 + 26), 0, Z(8)], 2.3 * sz, 2.3 * sz, C.wood); // the wooden heat guard
      M.rod([X(r1 - 12), 0, Z(8)], [X(r1 - 6), 0, Z(8)], 1.4 * sz, 1.8 * sz, "#3d4a2e"); // the warhead's neck
      M.rod([X(r1 - 6), 0, Z(8)], [X(r1 + 1), 0, Z(8)], 3.2 * sz, 3.2 * sz, "#3d4a2e", { taper: 0.25 }); // the warhead
      M.post(X(s.gx + 10), Z(10), X(s.gx + 9), Z(15), 1.0, 0.8, C.gun); // the fore grip
      bar = r1; barY = 8;
    } else {
      M.rod([X(r0), 0, Z(8)], [X(r1 + 1), 0, Z(8)], 2.3 * sz, 2.3 * sz, c.body, { tex: (face, s2, t) => (face === "top" ? glintOf(c.body) : (t < 0.04 || t > 0.96) ? C.dark : t > 0.23 && t < 0.3 ? shade(c.body, -0.3) : t > 0.06 && t < 0.2 && face === "left" ? C.tan : null) }); // the AT4's tube: its ends, the shoulder band, the label
      M.post(X(s.gx + 9), Z(10.5), X(s.gx + 9), Z(14), 0.7, 0.6, C.gun); // the fore grip
      bar = r1; barY = 8;
    }
    M.post(X(s.gx + 2), Z(10.5), X(s.gx), Z(16), 1.2, 0.9, C.gun); // the pistol grip
    M.post(X(s.gx - 3), Z(5), X(s.gx - 3), Z(3.5), 0.6, 0.5, C.gun, { plain: true }); // the sight
    out.hold = "tube";
    out.fore = [X(s.gx + 10), 0, Z(14) - 0.6];
    out.muzzle = [X(bar + 1), 0, Z(barY)];
  } else {
    // ---- long guns ----
    const r0 = s.r0, r1 = s.r1, hg = s.hg, deep = !!m.deep, bullpup = !!m.bullpup;
    const fe = m.fore || null; // a wooden fore-end under the barrel (x0..x1)
    const stock = stockOf(s.stock, F(fit.stock)), sa = at("stock", [r0 - 1, 8]);
    const fam = s.body;
    // the receiver and the lower
    if (fam === "zip") { M.rod([X(r0), 0, Z(7)], [X(bar + 1), 0, Z(7)], 0.75, 0.7, c.body); barY = 7; } // the pipe gun: one pipe end to end
    else if (fam === "m32") { rows(r0, 5, r1, 11, THICK.body, c.body); M.disc(X((r0 + r1 + 1) / 2), ZR(4, 11), 4.2 * sz, 2.4, c.cyl || C.od); } // the six-shot launcher's cylinder
    else if (fam === "lever") { rows(r0, 6, r1, 9, THICK.body, c.body, { tex: (face, s2, t) => (face === "right" && s2 < 0.3 ? shade(c.body, -0.2) : null) }); M.box([X(r0 + 2), 0, Z(10)], [X(r0 + 6), 0, Z(12.5)], 0.22, 0.3, C.steel, { u: [1, 0, 0] }); M.box([X(r0 + 6), 0, Z(12.5)], [X(r0 + 7), 0, Z(10)], 0.22, 0.3, C.steel, { u: [1, 0, 0] }); } // the loop under the receiver
    else if (fam === "bolt") { rows(r0, 6, r1, s.ry1 || 9, THICK.body, c.body); M.rod([X(r1 - 2), 0, Z(7)], [X(r1 - 2), -1.1, Z(8.5)], 0.32, 0.4, C.steel, { sides: 6 }); } // the bolt handle out to the right
    else if (fam === "brk") { rows(r0, 6, r1, 9, THICK.body, c.body); if (s.hammers) M.post(X(r0 - 1), Z(6), X(r0 - 2), Z(4.5), 0.4, 0.5, C.dark, { plain: true }); }
    else if (fam === "revolver") { /* above */ }
    else {
      rows(r0, bullpup ? 5 : 6, r1, deep || s.tall ? (bullpup ? 10 : 11) : 9, THICK.body, c.body, { tex: fam === "scar" || s.hgT === "quad" || s.hgT === "covers" ? (face, s2, t) => (face === "top" && Math.round(s2 * 9) % 2 ? shade(c.body, -0.15) : null) : null });
      if (!deep && !s.tall && !bullpup && c.low && c.low !== c.body) rows(r0 + 1, 9, r1 - 1, 10, THICK.body * 0.9, c.low);
    }
    // the stock, from its anchor back
    if (stock.t !== "none" && fam !== "zip") {
      const xa = sa[0], ya = sa[1] || 8, col = stock.col || c.furn || c.body, L = stock.len;
      if (stock.t === "fixed") M.box([X(xa + 1), 0, Z(ya)], [X(xa - L), 0, Z(ya + 1.2)], 1.3 * sz, THICK.stock / 2, col, { taper: 1.7 });
      else if (stock.t === "tele") { M.bar(X(xa + 1), X(xa - L + 4), Z(ya + 0.5), 0.8, 0.8, C.gun); M.bar(X(xa - L + 4.5), X(xa - L), Z(ya + 1), 1.8, THICK.stock, col); }
      else if (stock.t === "wire") { M.bar(X(xa + 1), X(xa - L + 1.5), Z(ya - 0.5), 0.35, 0.5, col, { plain: true }); M.bar(X(xa + 1), X(xa - L + 1.5), Z(ya + 2.5), 0.35, 0.5, col, { plain: true }); M.post(X(xa - L + 1), Z(ya - 1), X(xa - L), Z(ya + 4.5), 0.5, THICK.stock, col); }
      else if (stock.t === "drop") M.box([X(xa + 1), 0, Z(ya)], [X(xa - L), 0, Z(ya + 2.8)], 1.3 * sz, THICK.stock / 2, col, { taper: 1.9, tex: (face, s2, t) => (face === "top" ? glintOf(col) : face === "bottom" ? shade(col, -0.25) : null) });
      else if (stock.t === "grip") M.post(X(xa + 1), Z(ya + 1), X(xa - 2), Z(ya + 6), 1.2, 0.9, col);
      if (stock.t === "drop" && !DROP.has(typeof s.stock === "object" && s.stock ? s.stock.t : "") && s.stock && typeof s.stock === "object" && s.stock.t === "pgwood") M.post(X(xa), Z(ya + 2), X(xa - 2), Z(ya + 6), 1.0, 0.8, col); // a pistol-grip wrist
    } else if (fam === "zip") { M.box([X(r0 - 2), 0, Z(9)], [X(r0 - 2 - (m.butt || 6) - 3), 0, Z(11)], 1.2 * sz, 0.5, cn(c.furn, C.board), { taper: 1.6 }); } // a plank for a stock
    // the pistol grip
    const wrist = s.stock && typeof s.stock === "object" && DROP.has(s.stock.t);
    if (!wrist && fam !== "zip" && fam !== "lever" && fam !== "bolt" && fam !== "brk" && fam !== "m14" && stock.t !== "grip") M.post(X(s.gx + 2), Z(10.5 + (deep || s.tall ? 1 : 0)), X(s.gx), Z(16), 1.2, 0.9, cn(c.furn, c.body));
    else if (fam === "m14") M.box([X(sa[0]), 0, Z(9.5)], [X(hg), 0, Z(9.5)], 1.6 * sz, THICK.hg / 2, c.furn, { tex: (face, s2, t) => (face === "top" ? glintOf(c.furn) : null) }); // one piece of wood from the wrist to the fore-end
    // the handguard or fore-end, the barrel
    if (fam === "pump") {
      const [p0, p1] = s.pump || [r1 + 4, r1 + 12];
      M.rod([X(r1 + 1), 0, Z(7)], [X(bar + 1), 0, Z(7)], 0.5, 0.45, c.bar); // the barrel
      if (s.tube) M.rod([X(r1 + 1), 0, Z(8.6)], [X(s.tube + 1), 0, Z(8.6)], 0.4, 0.4, c.body); // the magazine tube under it
      M.bar(X(p0), X(p1 + 1), Z(9), 1.3, THICK.hg, c.pump || c.furn, { tex: (face, s2, t) => (face !== "top" && Math.round(s2 * 8) % 2 ? shade(c.pump || c.furn, -0.18) : null) }); // the slide, ribbed
      out.fore = [X((p0 + p1 + 1) / 2), 0, Z(9.7) - 0.7];
      out.hold = "pump";
      if (s.pumpT === "tac" || c.furn === C.poly) M.post(X(r0 + 6), Z(4.5), X(r0 + 6), Z(6), 1.2, 0.6, C.dark, { plain: true }); // the ghost ring
    } else if (fam === "brk" || fam === "semi" || fam === "lever" || fam === "bolt" || fam === "m14") {
      const two = fam === "brk" && (s.n || 1) === 2, over = !!(two && s.over);
      if (two && over) { M.rod([X(r1 + 1), 0, Z(6)], [X(bar + 1), 0, Z(6)], 0.5, 0.45, c.bar); M.rod([X(r1 + 1), 0, Z(7.4)], [X(bar + 1), 0, Z(7.4)], 0.5, 0.45, c.bar); } // over and under
      else if (two) { M.rod([X(r1 + 1), 0.5, Z(7)], [X(bar + 1), 0.5, Z(7)], 0.5, 0.45, c.bar); M.rod([X(r1 + 1), -0.5, Z(7)], [X(bar + 1), -0.5, Z(7)], 0.5, 0.45, c.bar); } // side by side
      else M.rod([X(r1 + 1), 0, Z(7)], [X(bar + 1), 0, Z(7)], barRows > 1 ? 0.55 : 0.45, barRows > 1 ? 0.5 : 0.38, c.bar);
      if (s.tube && fam !== "bolt") M.rod([X(r1 + 1), 0, Z(8.6)], [X(s.tube + 1), 0, Z(8.6)], 0.4, 0.4, c.body); // a tube magazine
      if (fe && fam !== "m14") M.bar(X(fe.x0), X(fe.x1 + 1), Z(9), 1.2, THICK.hg, fe.col || c.fe || c.furn); // the fore-end under the barrel
      else if (fam === "m14") M.bar(X(r1 + 1), X(hg + 1), Z(8.5), 1.1, THICK.hg * 0.9, c.hg || c.furn);
      const fx1 = fe ? (fe.x0 + fe.x1 + 1) / 2 : (r1 + hg) / 2;
      out.fore = [X(Math.max(fx1, fx + 10)), 0, Z(9.6) - 0.7];
      if (fam === "brk") M.post(X(r1 - 1), Z(9), X(r1 - 1), Z(10.5), 0.4, THICK.body, C.dark, { plain: true }); // the hinge
    } else if (fam === "ak") {
      M.bar(X(r1 + 1), X(hg + 1), Z(8.2), 1.1, THICK.hg, c.furn); // the lower handguard
      M.bar(X(r1 + 1), X(hg + 3), Z(5.2), 0.7, THICK.hg * 0.8, c.furn); // the upper, over the gas tube
      M.rod([X(hg + 1), 0, Z(7)], [X(bar + 1), 0, Z(7)], 0.45, 0.4, c.bar);
      M.post(X(s.fs || hg + 3), Z(7), X(s.fs || hg + 3), Z(3.5), 0.6, 0.7, C.gun, { plain: true }); // the front sight block
      out.fore = [X((r1 + hg + 1) / 2), 0, Z(8.8) - 0.7];
    } else if (bullpup) {
      M.bar(X(r1 + 1), X(hg + 1), Z(7.5), 1.3, THICK.hg, c.hg || c.body); // the fore-end
      M.rod([X(hg + 1), 0, Z(7)], [X(bar + 1), 0, Z(7)], 0.45, 0.4, c.bar);
      const fg = (m.under || []).find((f) => f && f.t === "fgrip");
      if (fg) M.post(X(fg.x0), Z(9), X(fg.x0 - 1), Z(13), 0.9, 0.7, c.furn || c.body); // the fore grip (the AUG's folding one, the KSG's)
      out.fore = fg ? [X(fg.x0 - 0.5), 0, Z(12.5) - 0.5] : [X((r1 + hg + 1) / 2), 0, Z(9) - 0.7];
      for (const f of m.top || []) if (f && f.t === "scope") M.rod([X(f.x0), 0, Z(4)], [X(f.x1 + 1), 0, Z(4)], 0.6, 0.6, c.body); // the AUG's scope handle
      else if (f && f.t === "bar") M.bar(X(f.x0), X(f.x1 + 1), Z(3.5), 0.6, 0.6, c.body); // the FAMAS's carry handle
    } else if (fam === "m32") {
      M.rod([X(r1 + 1), 0, Z(6)], [X(bar + 1), 0, Z(6)], 0.6, 0.55, c.bar); barY = 6;
      M.post(X(r1 + 5), Z(8), X(r1 + 4), Z(12), 1.0, 0.8, c.furn || c.body);
      out.fore = [X(r1 + 4.5), 0, Z(11.5) - 0.5];
    } else if (fam === "zip") {
      out.fore = [X((r1 + hg) / 2), 0, Z(7.5) - 0.9];
    } else {
      // AR, SCAR, HK, UMP, Vector, P90, MG, AMR: a handguard to hg, the barrel past it
      const hgc = c.hg || c.body, low = !!m.low;
      M.bar(X(r1 + 1), X(hg + 1), Z(7.5 + (low ? 1 : 0)), deep || fam === "mg" || fam === "amr" || fam === "hk" ? 1.4 : 1.25, THICK.hg, hgc, { tex: s.hgT === "quad" || s.hgT === "covers" || fam === "scar" ? (face, s2, t) => (face !== "top" && Math.round(t * 10) % 3 === 0 ? shade(hgc, -0.2) : null) : s.hgT === "a2" ? (face, s2, t) => (face !== "top" && Math.round(t * 12) % 2 ? shade(hgc, -0.18) : null) : null });
      if (bar > hg) M.rod([X(hg + 1), 0, Z(7 + (low ? 1.5 : 0))], [X(bar + 1), 0, Z(7 + (low ? 1.5 : 0))], fam === "mg" || fam === "amr" ? 0.55 : 0.42, fam === "mg" || fam === "amr" ? 0.5 : 0.38, c.bar);
      else bar = hg; // the barrel inside a shroud (the P90, the UMP, the Vector): the shot leaves at the shroud's end
      if (low) barY = 8.5;
      if (s.fs === "fsb") M.post(X(hg + 1), Z(7), X(hg + 1), Z(3.5), 0.6, 0.6, C.gun, { plain: true }); // the front sight post
      if (s.carry) M.bar(X(r0 + 2), X(r1 - 1), Z(2.8), 0.7, 0.7, c.body); // the carry handle
      if (fam === "mg") { M.bar(X(r0 + 7), X(r1 - 1), Z(3.2), 0.6, 0.6, c.body); } // the MG's carry handle
      if (fam === "p90") { M.bar(X(r0 + 6), X(r0 + 6 + (s.mag && s.mag.len || 20)), Z(4.5), 0.8, 1.0, C.clear, { tex: (face, s2, t) => (face === "top" ? C.clearD : Math.round(t * 20) % 2 ? C.brass : null) }); } // the magazine along the top
      out.fore = [X(Math.max((r1 + hg + 1) / 2, fx + 9)), 0, Z(deep ? 9.5 : 9) - 0.7];
    }
    // the magazine (a fitted one in its place), from the mag anchor down
    const mg = fam === "p90" ? null : magOf(s.mag, F(fit.mag)), ma = at("mag", null);
    if (mg && ma && mg.t !== "none") {
      const [mx, my] = ma, n = mg.n, w = mg.w, col = mg.col || C.gun, fwd = mg.t === "curve" ? 0.9 : mg.t === "stick" || mg.t === "long" ? 0.45 : 0.1;
      const z0 = Z(my - 0.5), ztop = bullpup ? Z(my - 1.5) : z0;
      if (mg.t === "drum") M.disc(X(mx + 2), Z(my + 3.5), 3.4 * sz, 1.9, col, { tex: (face, s2, t) => (face === "left" || face === "right" ? (Math.hypot(s2 - 0.5, t - 0.5) < 0.12 ? C.hi : null) : null) });
      else if (mg.t === "belt") M.box([X(mx - 3), 0, Z(my + 1)], [X(mx - 3), 0, Z(my + 7)], 4.5 * sx, 1.1, cn(mg.colName, C.od), { u: [1, 0, 0], tex: (face, s2, t) => (face === "top" ? C.brass : null) }); // the belt box under the feed tray
      else if (mg.t === "clear") M.post(X(mx), ztop, X(mx + fwd * n * 0.5), Z(my + n), w * sx * 1.3, THICK.mag, C.clear, { tex: (face, s2, t) => (face === "top" ? C.clearD : Math.round(t * n) % 2 ? C.brass : null) });
      else M.post(X(mx), ztop, X(mx + fwd * n * 0.5), Z(my + (mg.t === "box" ? Math.min(n, 6) : n)), w * sx * 1.3, THICK.mag, col, { tex: (face, s2, t) => (face === "top" ? glintOf(col) : t > 0.86 ? shade(col, -0.3) : null) });
    }
    // the gun's own optic or a fitted one, on the receiver's top
    const own = s.own || {}, op = F(fit.optic) || (!fit.optic && F(s.optic || own.optic));
    if (op && op.kind) {
      const ox = X(at("optic", [r0 + 6, 5])[0]), ztop2 = Z(bullpup ? 5 : s.carry ? 2 : 5.5), oc = op.col || C.gun;
      if (op.kind === "dot") M.bar(ox - 0.4, ox + 0.5, ztop2 + 0.5, 0.9, 0.8, oc, { tex: (face, s2, t) => (face === "front" ? C.glass : face === "top" ? C.red : null) });
      else if (op.kind === "prism") M.bar(ox - 0.7, ox + 0.8, ztop2 + 0.5, 1.0, 0.9, oc, { tex: (face, s2, t) => (face === "front" ? C.glass : null) });
      else { const L = (op.len || 5) * sx * 1.3, big = (op.len || 5) >= 7; M.rod([ox - L / 2 - 0.3, 0, ztop2 + 0.8], [ox + L / 2 + 0.3, 0, ztop2 + 0.8], big ? 0.62 : 0.5, big ? 0.72 : 0.55, oc, { tex: (face, s2, t) => (face === "front" ? C.glass : face === "top" ? glintOf(oc) : null) }); M.post(ox - 0.2, ztop2 + 0.8, ox - 0.2, ztop2 - 0.2, 0.5, 0.5, C.dark, { plain: true }); }
    }
    // a bipod (its own or fitted), folded back under the fore-end
    const bp = F(fit.bipod) || (!fit.bipod && F(s.bipod || own.bipod));
    if (bp && bp.kind === "bipod") { const bx = X(at("bipod", [hg - 2, 9])[0]); for (const side of [-1, 1]) M.rod([bx, side * 0.5, Z(9.5)], [bx - 2.6, side * 0.9, Z(10.5)], 0.22, 0.22, C.gun, { sides: 4, plain: true }); }
    // a fore grip, a light or a laser under the fore-end
    for (const slot of ["under", "grip", "tactical", "rail"]) {
      const q = F(fit[slot]);
      if (!q || !q.kind) continue;
      const gx2 = X(at(slot, at("under", [hg - 3, 9]))[0]);
      if (q.kind === "grip") M.post(gx2, Z(9.5), gx2 - 0.2, Z(13), 0.8, 0.7, q.col || C.gun);
      else if (q.kind === "light" || q.kind === "laser") M.bar(gx2 - 0.6, gx2 + 0.6, Z(9.8), 0.7, 0.7, q.col || C.gun, { tex: (face) => (face === "front" ? (q.kind === "light" ? "#f4f0c8" : C.red) : null) });
      else if (q.kind === "gl") M.rod([gx2 - 1.6, 0, Z(10.5)], [gx2 + 1.8, 0, Z(10.5)], 0.7, 0.7, q.col || C.olive);
    }
    out.muzzle = [X(bar + 1), 0, Z(barY)];
  }
  // the muzzle device: a fitted suppressor or brake, else the gun's own (a big brake)
  const md = F(fit.muzzle);
  const mz = out.muzzle;
  if (mz && md && md.kind === "can") { const L = (md.len || 6) * sx * 1.1, r = pistol ? 0.5 : 0.62; M.rod([mz[0] - 0.2, 0, mz[2]], [mz[0] + L, 0, mz[2]], r, r, md.col || C.gun); out.muzzle = [mz[0] + L, 0, mz[2]]; }
  else if (mz && md && md.kind === "brake") { const L = pistol ? 0.5 : 0.9; M.rod([mz[0], 0, mz[2]], [mz[0] + L, 0, mz[2]], 0.5, 0.5, C.gun, { sides: 6, tex: (face, s2, t) => (face !== "top" && Math.round(t * 3) % 2 ? C.dark : null) }); out.muzzle = [mz[0] + L, 0, mz[2]]; }
  else if (mz && !fit.muzzle && s.muzzle === "brake_big") { M.rod([mz[0], 0, mz[2]], [mz[0] + 1.3, 0, mz[2]], 0.7, 0.7, C.gun, { sides: 6 }); out.muzzle = [mz[0] + 1.3, 0, mz[2]]; }
  if (out.hold === "gun") {
    const L = out.muzzle ? out.muzzle[0] - Math.min(...parts.map((P) => Math.min(P.A[0], P.B[0]))) : 10;
    if (s.kind === "smg" || L < 11.5) out.hold = "smg"; // short: held close
  }
  if (out.fore && out.fore[0] < 2.8) out.fore[0] = 2.8; // the other hand always ahead of the fist
  out.len = span(parts);
  return out;
}
const span = (parts) => { let a = Infinity, b = -Infinity; for (const P of parts) { a = Math.min(a, P.A[0], P.B[0]); b = Math.max(b, P.A[0], P.B[0]); } return b - a; };

// ---------- melee weapons, bows and crossbows: the table ----------
// Each: hold and a build (M) on the helpers above; origin at the right fist, +x toward the business end. The
// colours are the item icons' (ui/itemart/wear.js). fore: where the other hand goes (two-handed holds).
const K = { steel: "#b4bcc3", steelD: "#8d959c", gun: "#55595e", blk: "#3a3e45", poly: "#2e3238", wood: "#7a5230", woodL: "#a07a48", woodD: "#4a3324", hick: "#b08a5a", ash: "#9a7a52", brass: "#b89a4a", red: "#c8362e", olive: "#4d5440", oliveL: "#5f6b4a", tape: "#9aa0a6", string: "#e8e0c8" };
const twoHand = (fore) => fore;
// A knife or sword from sim/data-blades.js BLADE_LOOK: len 1..9 (the icon's), blade, handle, guard, hilt, curve.
function bladeOf(L) {
  const bl = 1.6 + L.len * 1.25, w = L.len >= 7 ? 1.1 : L.len >= 4 ? 0.9 : 0.7, hilt = L.hilt ? 2.2 : 1.4;
  return (M) => {
    M.handle(-hilt + 0.2, 0.9, 0.42, L.handle, { wrap: L.len >= 5 ? 6 : 0 });
    if (L.guard) M.guard(0.95, L.len >= 7 ? 2.4 : 1.6, 0.45, L.guard);
    if (L.hilt) M.disc(-hilt + 0.1, 0, 0.5, 0.6, L.guard || K.steelD);
    M.blade(1.2, 1.2 + bl, w, 0.24, L.blade, { tip: Math.min(2.2, bl * 0.35), curl: L.curve ? 0.5 : 0, rise: L.curve ? 0.25 : 0 });
  };
}
export const MELEE = {
  // ---- knives: hanging at the side ----
  knife: { hold: "side", m: (M) => { M.handle(-1.3, 0.9, 0.42, K.blk); M.guard(0.95, 1.2, 0.4, K.steelD, 0.3); M.blade(1.2, 6.0, 1.0, 0.22, K.steel, { tip: 2.0 }); } },
  combatknife: { hold: "side", m: (M) => { M.handle(-1.4, 0.9, 0.42, K.poly, { wrap: 5 }); M.guard(0.95, 1.6, 0.4, K.poly); M.blade(1.2, 6.2, 0.9, 0.24, "#4a4f57", { tip: 1.3, edge: "#c2c9cf" }); } },
  machete: { hold: "side", m: (M) => { M.handle(-1.6, 0.9, 0.44, "#3a2a1c"); M.blade(1.0, 8.4, 1.3, 0.22, "#a9b0b6", { tip: 1.8 }); M.blade(5.4, 8.0, 1.8, 0.2, "#a9b0b6", { tip: 2.2, z: -0.25 }); } }, // broader toward the tip
  sawmachete: { hold: "side", m: (M) => { M.handle(-1.8, 0.9, 0.46, "#5b5048", { wrap: 6 }); M.bar(0.9, 3.0, 0, 1.0, 0.22, "#bcc4cb"); M.disc(5.0, 0.4, 2.5, 0.22, "#bcc4cb", { sides: 12, tex: (face, s, t) => (face === "left" || face === "right" ? (Math.hypot(s - 0.5, t - 0.5) < 0.08 ? OUT : Math.hypot(s - 0.5, t - 0.5) > 0.44 && Math.round(Math.atan2(t - 0.5, s - 0.5) * 6) % 2 ? shade("#bcc4cb", -0.3) : null) : GLINT) }); } }, // a circular-saw blade
  sheetmachete: { hold: "side", m: (M) => { M.handle(-1.6, 0.9, 0.44, "#6d7378", { wrap: 4 }); M.blade(1.0, 7.8, 1.3, 0.18, "#9aa1a8", { tip: 1.6, edge: "#c4cbd1" }); } },
  springmachete: { hold: "side", m: (M) => { M.handle(-1.6, 0.9, 0.44, "#4f5a3e", { wrap: 5 }); M.blade(1.0, 8.4, 1.3, 0.3, "#4a4f57", { tip: 2.0, edge: "#dfe5ea" }); } },
  kukri: { hold: "side", m: (M) => { M.handle(-1.6, 0.9, 0.44, "#5b3a22"); M.disc(-1.6, 0, 0.5, 0.5, K.brass); M.blade(1.0, 3.6, 0.9, 0.24, "#b4bcc3", { tip: 0.1 }); M.blade(3.4, 7.4, 1.5, 0.24, "#b4bcc3", { tip: 2.0, rise: -0.5, z: -0.35 }); } }, // bent forward, wide at the belly
  cleaver: { hold: "side", m: (M) => { M.handle(-1.5, 0.9, 0.42, K.woodD); M.blade(1.0, 5.4, 2.2, 0.22, K.steelD, { tip: 0.3, edge: K.steel }); } },
  hatchet: { hold: "side", m: (M) => { M.haft(-1.6, 5.2, 0.4, K.wood); M.cross(4.6, -0.7, 0.6, 1.0, 0.7, K.steelD, { plain: true }); M.cross(4.6, 0.5, 2.4, 1.5, 0.3, K.steelD, { glint: "#d6dde2" }); } },
  sheethatchet: { hold: "side", m: (M) => { M.haft(-1.6, 5.2, 0.4, K.wood); M.cross(4.6, -0.7, 0.6, 1.0, 0.7, "#9aa1a8", { plain: true }); M.cross(4.6, 0.5, 2.4, 1.5, 0.26, "#9aa1a8", { glint: "#c4cbd1" }); } },
  tomahawk: { hold: "side", m: (M) => { M.haft(-1.8, 6.0, 0.36, K.poly); M.cross(5.4, -0.6, 0.6, 0.9, 0.6, "#3e434b", { plain: true }); M.cross(5.4, 0.5, 2.6, 1.6, 0.26, "#3e434b", { glint: "#d6dde2" }); M.spike([5.4, 0, -0.6], [5.4, 0, -2.0], 0.3, "#3e434b"); } },
  hammer: { hold: "side", m: (M) => { M.handle(-1.6, 1.2, 0.4, "#2f5d8a"); M.haft(1.2, 4.0, 0.3, "#9aa1a8"); M.cross(3.7, -1.0, 1.1, 1.0, 0.9, "#5d636b", { plain: true }); M.spike([3.7, 0, -1.0], [3.2, 0, -2.0], 0.3, "#5d636b"); } },
  prybar: { hold: "side", m: (M) => { M.haft(-2.2, 7.0, 0.3, "#5d636b", { tex: (face, s, t) => (face === "top" ? "#9aa1a8" : null) }); M.box([7.0, 0, 0], [7.8, 0, 1.2], 0.3, 0.3, "#5d636b", { u: [1, 0, 0] }); M.box([-2.2, 0, 0], [-2.8, 0, -0.6], 0.3, 0.4, "#5d636b", { u: [1, 0, 0] }); } }, // the hooked claw, the chisel foot
  baton: { hold: "side", m: (M) => { M.handle(-1.8, 1.0, 0.4, K.poly, { wrap: 6 }); M.rod([1.0, 0, 0], [3.6, 0, 0], 0.3, 0.26, "#7d858c", { sides: 6 }); M.rod([3.6, 0, 0], [6.4, 0, 0], 0.24, 0.2, "#aab2b9", { sides: 6 }); M.disc(6.5, 0, 0.32, 0.5, "#c2c9cf", { sides: 6 }); } }, // telescoped out
  stunbaton: { hold: "side", m: (M) => { M.handle(-2.0, 1.0, 0.46, K.poly); M.rod([1.0, 0, 0], [6.4, 0, 0], 0.46, 0.42, K.poly, { sides: 8, tex: (face, s, t) => (t > 0.22 && t < 0.32 ? "#e6c23a" : t > 0.9 ? "#d8b43a" : null) }); } },
  etool: { hold: "side", m: (M) => { M.haft(-1.4, 4.2, 0.34, "#4b5340"); M.disc(4.2, 0, 0.42, 0.7, K.poly); M.box([4.4, 0, 0], [7.2, 0, 0], 1.1, 0.12, "#5f6b4a", { u: [0, 0, 1], taper: 0.5 }); } },
  pipewrench: { hold: "side", m: (M) => { M.bar(-1.8, 5.0, 0, 0.9, 0.5, K.red); M.cross(5.2, -0.5, 1.6, 1.0, 0.7, "#55595e", { plain: true }); M.cross(6.1, 0.6, 1.6, 0.8, 0.7, "#55595e", { plain: true }); } },
  shiv: { hold: "side", m: (M) => { M.handle(-1.3, 0.7, 0.36, K.tape, { wrap: 5 }); M.blade(0.8, 3.8, 0.7, 0.16, "#9a9a92", { tip: 1.4 }); } },
  multitool: { hold: "side", m: (M) => { M.handle(-1.2, 0.8, 0.36, "#c9ced3"); M.blade(0.8, 2.6, 0.5, 0.2, "#c9ced3", { tip: 0.8 }); } },
  boxcutter: { hold: "side", m: (M) => { M.handle(-1.4, 0.9, 0.4, "#d9b23a"); M.blade(0.9, 2.4, 0.5, 0.16, K.steel, { tip: 0.8 }); } },
  // ---- swords ----
  katana: { hold: "sword", fore: -1.6, m: (M) => { M.handle(-2.8, 0.9, 0.4, K.poly, { tex: (face, s, t) => (Math.round(t * 8) % 2 ? "#e8e0c8" : null) }); M.disc(1.0, 0, 0.75, 0.3, K.brass); M.blade(1.2, 13.2, 0.9, 0.22, "#d6dde2", { tip: 2.4, rise: 0.4, curl: 0.5 }); } },
  broadsword: { hold: "sword", fore: -1.6, m: (M) => { M.handle(-2.8, 0.9, 0.42, "#5b3a22"); M.disc(-2.9, 0, 0.55, 0.6, "#8d959c"); M.guard(1.0, 3.2, 0.5, "#8d959c"); M.blade(1.2, 13.0, 1.4, 0.26, "#c2c9cf", { tip: 2.0 }); } },
  cutlass: { hold: "sabre", m: (M) => { M.handle(-1.6, 0.9, 0.42, "#3a2a1c"); M.box([-1.6, 0, -0.9], [1.0, 0, -0.9], 0.2, 0.9, K.brass, { u: [0, 0, 1] }); M.guard(1.0, [-1.2, 1.0], 0.5, K.brass); M.blade(1.2, 9.8, 1.2, 0.24, "#c2c9cf", { tip: 2.0, rise: 0.3, curl: 0.6 }); } }, // the brass basket
  sabre: { hold: "sabre", m: (M) => { M.handle(-1.6, 0.9, 0.4, K.poly); M.box([-1.7, 0, -0.9], [1.0, 0, -0.9], 0.16, 0.5, K.brass, { u: [0, 0, 1] }); M.guard(1.0, [-1.0, 0.9], 0.45, K.brass); M.blade(1.2, 12.0, 0.9, 0.22, "#d6dde2", { tip: 2.6, rise: 0.4, curl: 0.8 }); } }, // the D-guard
  // ---- clubs, tools and axes over the shoulder ----
  bat: { hold: "shoulder", fore: 2.4, m: (M) => { M.disc(-1.9, 0, 0.55, 0.4, K.poly); M.rod([-1.8, 0, 0], [4.0, 0, 0], 0.45, 0.6, K.poly, { tex: (face, s, t) => (Math.round(t * 6) % 2 ? "#4a4f57" : null) }); M.rod([4.0, 0, 0], [13.4, 0, 0], 0.6, 1.0, "#b9c0c6", { tex: (face, s, t) => (face === "top" ? "#e6eaee" : t > 0.5 && t < 0.58 ? "#c8402f" : null) }); M.disc(13.5, 0, 0.95, 0.5, "#b9c0c6"); } }, // aluminium, a knob, the maker's band
  nailbat: { hold: "shoulder", fore: 2.4, m: (M) => { M.disc(-1.9, 0, 0.55, 0.4, shade("#a07a48", -0.35)); M.rod([-1.8, 0, 0], [4.0, 0, 0], 0.45, 0.6, shade("#a07a48", -0.25)); M.rod([4.0, 0, 0], [13.4, 0, 0], 0.6, 1.0, "#a07a48"); for (const [x, a] of [[7, 0], [9, 1], [11, 0], [8, 2], [10, 3], [12, 2]]) { const dz = a === 0 ? 1 : a === 2 ? -1 : 0, dy = a === 1 ? 1 : a === 3 ? -1 : 0; M.spike([x, 0, 0], [x, dy * 1.8, dz * 1.8], 0.16, "#c9ced3"); } } },
  spikedbat: { hold: "shoulder", fore: 2.4, m: (M) => { M.disc(-1.9, 0, 0.55, 0.4, shade("#8a6638", -0.35)); M.rod([-1.8, 0, 0], [4.0, 0, 0], 0.45, 0.6, K.tape); M.rod([4.0, 0, 0], [13.0, 0, 0], 0.6, 1.0, "#8a6638"); for (const [x, a] of [[6.5, 0], [8.5, 1], [10.5, 0], [12.2, 1], [7.5, 2], [9.5, 3], [11.5, 2]]) { const dz = a === 0 ? 1 : a === 2 ? -1 : 0, dy = a === 1 ? 1 : a === 3 ? -1 : 0; M.spike([x, 0, 0], [x, dy * 2.6, dz * 2.6], 0.2, "#e0e5e9"); } } },
  sledge: { hold: "shoulder", fore: 3.0, m: (M) => { M.haft(-1.6, 14.0, 0.52, K.hick); M.cross(13.6, -2.2, 2.2, 2.2, 1.6, "#55595e"); } },
  fireaxe: { hold: "shoulder", fore: 3.0, m: (M) => { M.haft(-1.6, 14.0, 0.52, K.hick); M.cross(13.4, -0.9, 0.9, 1.6, 0.9, K.red, { plain: true }); M.cross(13.4, 0.8, 3.6, 2.6, 0.32, K.red, { glint: "#d6dde2" }); M.spike([13.4, 0, -0.9], [13.4, 0, -3.0], 0.4, K.red); } }, // a red head, the pick behind
  axe: { hold: "shoulder", fore: 3.0, m: (M) => { M.haft(-1.6, 13.0, 0.52, K.hick); M.cross(12.4, -1.0, 0.9, 1.7, 0.9, "#6d7378", { plain: true }); M.cross(12.4, 0.8, 3.4, 2.8, 0.34, "#6d7378", { glint: "#d6dde2" }); } }, // a felling axe
  scrapaxe: { hold: "shoulder", fore: 3.0, m: (M) => { M.haft(-1.6, 12.0, 0.52, K.woodL); M.cross(11.4, -0.8, 0.8, 1.5, 0.9, K.tape, { plain: true }); M.cross(11.4, 0.6, 3.0, 2.4, 0.3, "#9aa1a8", { glint: "#c4cbd1" }); } },
  pickaxe: { hold: "shoulder", fore: 3.0, m: (M) => { M.haft(-1.6, 14.0, 0.52, K.wood); M.cross(13.4, -0.9, 0.9, 1.4, 1.0, "#6d7378", { plain: true }); M.spike([13.4, 0, 0.8], [14.6, 0, 4.6], 0.5, "#6d7378"); M.spike([13.4, 0, -0.8], [14.6, 0, -4.6], 0.5, "#6d7378"); } }, // the two curved points
  golfclub: { hold: "shoulder", fore: 2.6, m: (M) => { M.handle(-1.8, 1.4, 0.36, K.poly, { wrap: 5 }); M.rod([1.4, 0, 0], [13.6, 0, 0], 0.24, 0.2, "#c9ced3", { sides: 6 }); M.box([13.4, 0, -0.2], [14.6, 1.0, -1.4], 0.9, 0.7, "#30343a", { u: [1, 0, 0] }); } }, // the driver's head turned out
  hockeystick: { hold: "shoulder", fore: 2.6, m: (M) => { M.handle(-1.8, 1.4, 0.4, K.poly); M.bar(1.4, 15.0, 0, 0.9, 0.5, "#c9a46a", { tex: (face, s, t) => (face === "top" ? "#e0c08a" : t > 0.5 && t < 0.56 ? "#c8402f" : null) }); M.box([15.0, 0, 0.2], [16.8, 0, 2.6], 0.45, 0.25, "#2a2c30", { u: [1, 0, 0], tex: (face, s, t) => (t > 0.3 && t < 0.7 ? "#e8e4d8" : null) }); } }, // the blade, taped
  shovel: { hold: "shoulder", fore: 3.0, m: (M) => { M.haft(-1.6, 12.0, 0.5, K.ash); M.box([12.0, 0, 0], [16.4, 0, 0], 1.5, 0.12, "#8d959c", { u: [0, 0, 1], taper: 0.55 }); } },
  halligan: { hold: "shoulder", fore: 3.0, m: (M) => { M.bar(-2.4, 12.0, 0, 0.7, 0.6, "#9aa3ab"); M.spike([12.0, 0, 0.3], [14.4, 0, 0.9], 0.3, "#9aa3ab"); M.spike([12.0, 0, -0.3], [14.4, 0, -0.9], 0.3, "#9aa3ab"); M.cross(-2.4, -0.4, 1.8, 0.6, 0.9, "#9aa3ab", { plain: true }); M.spike([-2.4, 0, -0.4], [-2.4, 0, -2.2], 0.32, "#9aa3ab"); } }, // the fork, the adze and the pick
  // ---- spears: level in both hands ----
  spear: { hold: "spear", fore: 6.4, m: (M) => { M.haft(-7.0, 12.0, 0.36, K.ash); M.disc(12.1, 0, 0.5, 0.5, "#8d959c"); M.blade(12.4, 17.6, 1.5, 0.24, "#c9ced3", { tip: 2.6 }); } },
  pipespear: { hold: "spear", fore: 6.4, m: (M) => { M.rod([-7.0, 0, 0], [12.0, 0, 0], 0.4, 0.4, "#5d636b", { tex: (face, s, t) => (t < 0.03 ? "#1f2226" : null) }); M.rod([10.6, 0, 0], [12.6, 0, 0], 0.44, 0.44, "#c9ced3", { plain: true, tex: (face, s, t) => (Math.round(t * 4) % 2 ? "#8a9096" : null) }); M.handle(12.4, 13.4, 0.3, K.blk); M.blade(13.4, 17.0, 0.9, 0.2, K.steel, { tip: 1.6 }); } }, // a kitchen knife taped to a pipe
};
// Knives and swords with a look in sim/data-blades.js and no entry above: a blade from its look (the folders, the
// steak and fillet knives, the hunting, survival and Bowie knives, the bayonet).
for (const [k, L] of Object.entries(BLADE_LOOK)) if (!MELEE[k]) MELEE[k] = { hold: "side", m: bladeOf(L) };
export const BOWS = {
  compbow: { hold: "bow", m: (M) => {
    M.post(0.4, -2.6, 0.4, 2.6, 1.0, 0.7, "#35383e"); // the riser
    M.box([0.4, 0, 2.6], [1.6, 0, 6.4], 0.5, 0.35, "#4f545c", { u: [1, 0, 0] }); M.box([0.4, 0, -2.6], [1.6, 0, -6.4], 0.5, 0.35, "#4f545c", { u: [1, 0, 0] }); // the limbs, bent forward
    M.disc(1.7, 6.5, 0.6, 0.5, "#c9ced3"); M.disc(1.7, -6.5, 0.6, 0.5, "#c9ced3"); // the cams
    M.rod([1.4, 0, 6.5], [1.4, 0, -6.5], 0.1, 0.1, K.string, { sides: 4, plain: true }); // the string
    M.bar(0.9, 3.4, -0.9, 0.3, 0.3, "#5d636b", { plain: true }); M.bar(0.8, 1.8, 1.0, 0.4, 0.4, "#5d636b", { plain: true, tex: (face) => (face === "front" ? "#e04848" : null) }); // the stabilizer, the sight
  } },
  pulleybow: { hold: "bow", m: (M) => {
    for (const side of [-1, 1]) for (const [z0, z1, x0, x1] of [[0, 2.6, 0.4, 0.9], [2.6, 5.0, 0.9, 2.0], [5.0, 7.0, 2.0, 3.6]]) M.box([x0, 0, side * z0], [x1, 0, side * z1], 0.45, 0.3, "#b8895a", { u: [1, 0, 0], tex: (face) => (face === "back" ? "#6e4a2c" : face === "top" ? glintOf("#b8895a") : null) }); // the laminated arc
    M.post(0.3, -1.3, 0.3, 1.3, 0.8, 0.6, "#3a2a1c", { plain: true }); // the grip wrap
    M.disc(3.7, 7.1, 0.45, 0.4, "#c9ced3"); M.disc(3.7, -7.1, 0.45, 0.4, "#c9ced3"); // the pulleys at the tips
    M.rod([3.4, 0, 7.1], [3.4, 0, -7.1], 0.1, 0.1, K.string, { sides: 4, plain: true });
  } },
  crossbow: { hold: "crossbow", fore: 3.2, m: (M) => {
    M.bar(-3.6, 6.6, 0.6, 1.1, 0.9, "#9a7448"); M.post(0.4, 0.2, -0.6, -1.6, 1.0, 0.8, "#9a7448"); // the pale wooden stock, its grip
    M.bar(1.6, 2.8, 1.25, 0.2, 0.9, K.tape, { plain: true });
    for (const side of [-1, 1]) M.box([5.6, 0, 1.1], [4.2, side * 5.4, 1.1], 0.3, 0.45, "#4a4f57", { u: [0, 0, 1], taper: 0.6 }); // the leaf-spring prod, swept back
    M.rod([4.2, 5.4, 1.1], [1.0, 0, 1.3], 0.1, 0.1, "#e8e4da", { sides: 4, plain: true }); M.rod([4.2, -5.4, 1.1], [1.0, 0, 1.3], 0.1, 0.1, "#e8e4da", { sides: 4, plain: true }); // the cord drawn back
  } },
  xbow: { hold: "crossbow", fore: 3.2, m: (M) => {
    M.bar(-3.6, 6.8, 0.6, 1.2, 0.9, K.poly); M.post(0.4, 0.2, -0.6, -1.8, 1.0, 0.8, K.poly); // the black stock
    for (const side of [-1, 1]) M.box([6.0, 0, 1.1], [4.6, side * 5.0, 1.1], 0.3, 0.45, "#3a3e45", { u: [0, 0, 1], taper: 0.6 });
    M.disc(4.4, 1.1, 0.5, 0.4, "#c9ced3"); // the cams at the tips (one each side, drawn on the axis for the scale)
    M.rod([4.6, 5.0, 1.1], [1.2, 0, 1.3], 0.1, 0.1, K.string, { sides: 4, plain: true }); M.rod([4.6, -5.0, 1.1], [1.2, 0, 1.3], 0.1, 0.1, K.string, { sides: 4, plain: true });
    M.rod([-0.6, 0, 2.2], [2.6, 0, 2.2], 0.42, 0.46, "#1f2226", { tex: (face) => (face === "front" ? "#7fb8e6" : face === "top" ? glintOf("#1f2226") : null) }); // the scope
    M.rod([1.4, 0, 1.4], [7.6, 0, 1.4], 0.1, 0.1, "#d6dde2", { sides: 4, plain: true, tex: (face, s, t) => (t < 0.15 ? "#e04848" : null) }); // a bolt with red vanes
  } },
};
// A weapon with no model of its own (a key added later): a plain blade or a haft by its category, so it still shows.
function fallbackMelee(key) {
  const g = GEAR[key] || {};
  if (g.small) return { hold: "side", m: (M) => { M.handle(-1.3, 0.9, 0.4, K.blk); M.blade(1.0, 5.0, 0.9, 0.22, K.steel); } };
  return { hold: "shoulder", fore: 2.6, m: (M) => { M.haft(-1.6, 12.0, 0.42, K.wood); M.cross(11.4, -1.4, 1.4, 1.4, 1.0, "#7d858c"); } };
}

// ---------- the models, by look ----------
const models = new Map();
/** The model of a weapon look (a key, or gunparts.js weaponLook's "key|finish|parts"); null for no weapon. */
export function weaponModel(look) {
  if (!look || look === "fists" || look === "claws" || look === "acid" || look === "carry" || look === "carryLow") return null;
  const L = String(look);
  let m = models.get(L);
  if (m !== undefined) return m;
  const { key, finish, looks } = parseLook(L);
  if (isGunKey(key)) m = gunModel(key, { finish, looks });
  else {
    const T = MELEE[key] || BOWS[key] || (GEAR[key] && GEAR[key].slot === "weapon" ? fallbackMelee(key) : null);
    if (T) {
      const parts = [], M = helpers(parts);
      T.m(M);
      m = { key, hold: T.hold, parts, grip: [0, 0, 0], fore: T.fore != null ? [T.fore, 0, 0] : null, muzzle: null, len: span(parts) };
    } else m = null;
  }
  if (models.size > 400) models.clear();
  models.set(L, m);
  return m;
}
/** The pose class of a weapon look (figures.js holdOf). */
export const holdOfModel = (look) => { const m = weaponModel(look); return m ? m.hold : null; };

// Places a model in figure space: origin O at the fist, its +x along dir, its +z as near `up` as the direction
// allows (the bow's riser stays vertical, a blade hanging point-down turns its edge forward). Returns the limbs
// (group 1: the figure paints a dark rim where they meet the body) and the placed grip, fore and muzzle points.
export function placeModel(model, O, dir, up = [0, 0, 1]) {
  const ex = norm3(dir);
  let ey = cross(up, ex);
  if (len(ey) < 1e-3) ey = cross([1, 0, 0], ex);
  ey = norm3(ey);
  const ez = cross(ex, ey);
  const T = (p) => add(O, add(add(mul(ex, p[0]), mul(ey, p[1])), mul(ez, p[2])));
  const R = (v) => add(add(mul(ex, v[0]), mul(ey, v[1])), mul(ez, v[2]));
  const limbs = model.parts.map((P) => ({ ...P, A: T(P.A), B: T(P.B), u: P.u ? R(P.u) : null }));
  return { limbs, grip: T(model.grip), fore: model.fore ? T(model.fore) : null, muzzle: model.muzzle ? T(model.muzzle) : null };
}
// The distance from a point to a model part's axis segment (the tests: a hand on the weapon).
export function distToPart(P, L) {
  const d = sub(L.B, L.A), l2 = dot(d, d);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(P, L.A), d) / l2)) : 0;
  return len(sub(P, add(L.A, mul(d, t))));
}
export const clearModels = () => models.clear();
