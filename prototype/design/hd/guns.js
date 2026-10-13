// HD gun art (design preview only: src/ is unchanged): every gun's big side view on a 128 × 48 grid, twice
// ui/gunart.js's 64 × 24 (the builder shows it at 4× in the same 512 × 192 image area; the bore is on rows 14–15,
// the muzzle to the right), in the item icons' style (design/hd/gunkit.js: items.js PAL ramps, light from the upper
// left, one specular line on metal, inner lines only where forms overlap, no dithering).
//
// The same data-driven architecture as the game's, so it could replace gunart.js / gunpaint.js's FAM later:
//   paintGunHD(key, looks = null, slots = null, finish = null) -> painter
//     the gun's spec (ui/gunspecs.js GUN_ART through gunpaint.js norm: its family's defaults, its colours, the finish
//     applied) painted by its HD body family FAMHD[body] (landmarks doubled: r, hg, bar, gx, fe, tube, pump, x0 / x1 /
//     y0, fr, cyl), then its own parts (stock, magazine, muzzle device, bipod, grips, own optic) and the fitted looks
//     (design/hd/gunparts-hd.js PART_HD / KINDS_HD) at the slots' anchors, back to front like gunart.js paintArt.
//   anchorsHD(key, finish) -> { slot: [x, y] } in HD grid pixels; anchorHD(key, slot, fitted) with the aliases and the
//     mount's lift, like gunart.js anchorOf.
// Anchor conventions (HD): optic / mount: y is the rail's top row (the sight draws from y - 1 up); muzzle: x the
// barrel's last column, y = 14 the bore's top row (the device draws from x + 1); mag: the top-left of its first row
// below the well; stock: x its first column behind the receiver (or buffer tube), y its centre row; under / grip /
// bipod: y the fore-end's bottom row (parts hang from y + 1); tactical / rail: y on the fore-end's side; sling: the
// swivel. A current anchor [x, y] is about [2x + 1, 2y + 1] here.
import { painter } from "./hdcore.js";
import { M, IRON, STEEL, BLACK, WOOD, OLIVE, COYOTE, BRASS, RED, GREY, PAL, isWood, R, H, V, dots, vdots, box, cyl, vcyl, grain, rail, gripHD, guardHD, stockHD, magHD, shadow, pin, lensV, lensF } from "./gunkit.js";
import { STOCKS_HD, MAGS_HD, PART_HD, KINDS_HD, drawPart, partIcon, partLookHD } from "./gunparts-hd.js";
import { norm, ownKey, specOf } from "../../src/ui/gunpaint.js";
import { GUN_ART } from "../../src/ui/gunspecs.js";
export { STOCKS_HD, MAGS_HD, PART_HD, KINDS_HD, drawPart, partIcon, partLookHD };

export const HD_W = 128, HD_H = 48, HD_UP = 4;
const DEEP = "#1c2230"; // the bore and the gaps between forms (never black: the rim is)
const X0 = (x) => 2 * x, X1 = (x) => 2 * x + 1; // a current column's left / right HD column
const bore = (p, x, y = 14) => { p.set(x, y + 1, DEEP); p.set(x, y, M("gun")[0]); };

// ---------- shared pieces ----------
// A wooden fore-end: a block with grain, its top row in the dark tone where the barrel sits over it.
const forend = (p, x0, x1, y0, y1, m, seed = 1) => { box(p, x0, y0, x1, y1, m, { wide: true, spec: false }); if (m === WOOD || m === PAL.ash || m[1] === M("walnut")[1]) grain(p, x0, x1, y0, y1, m, seed); };
// An AR handguard from x0 to x1 (rows 12..19) by its type.
function arHandguard(p, s, x0, x1, m) {
  switch (s.hgT) {
    case "a2": cyl(p, x0 + 2, x1, 12, 19, m, { spec: m !== BLACK }); for (let x = x0 + 5; x < x1 - 1; x += 3) V(p, x, 13, 18, m[0]); vcyl(p, x0, x0 + 1, 10, 21, STEEL); break; // round, ribbed, the delta ring
    case "carbine": cyl(p, x0 + 2, x1, 12, 19, m, { spec: false }); for (let x = x0 + 5; x < x1 - 4; x += 6) { R(p, x, 13, x + 2, 14, m[0]); R(p, x + 3, 16, x + 5, 17, m[0]); } vcyl(p, x0, x0 + 1, 10, 21, IRON); break; // oval vents in two rows, the delta ring
    case "quad": box(p, x0, 10, x1, 19, IRON, { wide: true, spec: false }); rail(p, x0, x1, 10); for (let x = x0; x <= x1; x += 2) p.set(x, 19, IRON[2]); rail(p, x0 + 1, x1 - 1, 14, IRON, 2); break;
    case "covers": box(p, x0, 10, x1, 19, IRON, { wide: true, spec: false }); rail(p, x0, x1, 10); for (let x = x0; x <= x1; x += 2) p.set(x, 19, IRON[2]); box(p, x0 + 3, 13, x1 - 3, 17, m, { spec: false }); for (let x = x0 + 5; x < x1 - 4; x += 3) V(p, x, 14, 16, m[0]); break; // ladder covers
    case "mlok": box(p, x0, 12, x1, 19, m, { wide: true, spec: false }); rail(p, x0, x1, 10); for (let x = x0 + 4; x < x1 - 6; x += 8) { R(p, x, 14, x + 4, 15, m[0]); p.set(x + 4, 15, m[2]); } H(p, x0, x1, 19, m[0]); break;
    case "slim": box(p, x0, 12, x1, 17, m, { wide: true, spec: false }); rail(p, x0, x1, 10); for (let x = x0 + 4; x < x1 - 3; x += 4) { R(p, x, 14, x + 1, 15, m[0]); } break;
    default: box(p, x0, 12, x1, 19, m, { wide: true, spec: false }); for (let x = x0 + 4; x < x1 - 4; x += 7) R(p, x, 14, x + 3, 16, m[0]);
  }
}
const frontSight = (p, x, m, o = {}) => { box(p, x, 8, x + 3, 17, m, { spec: false }); V(p, x + 1, 5, 7, m[1]); p.set(x + 1, 5, m[2]); V(p, x, 6, 7, m[0]); V(p, x + 3, 6, 7, m[0]); if (o.swivel) R(p, x + 1, 18, x + 2, 19, STEEL[1]); }; // an A-frame sight base, post and ears
const barrelHD = (p, x0, x1, m, rows = 2, y = 14) => { cyl(p, x0, x1, y, y + rows * 2 - 1, m, { spec: rows > 1 }); bore(p, x1, y); };

// ---------- the body families ----------
export const FAMHD = {};

// The AR family (M16, carbines, the AR-10 DMR, the M249's core).
FAMHD.ar = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), hg = X1(s.hg), bar = X1(s.bar), gx = X0(s.gx);
    const body = M(s.cn.body), low = M(s.cn.low || s.cn.body), hgM = M(s.cn.hg), furn = M(s.cn.furn), barM = M(s.cn.bar);
    const lowB = s.tall ? 23 : 21;
    if (s.buffer !== false) { cyl(p, r0 - 8, r0 - 1, 16, 19, body, { capR: false }); V(p, r0 - 1, 16, 19, body[2]); } // the buffer tube, the castle nut
    box(p, r0, 12, r1, 17, body, { wide: true }); // the upper
    if (s.carry) { box(p, r0 + 4, 4, r1 - 4, 7, body); R(p, r0 + 4, 8, r0 + 5, 11, body[1]); p.set(r0 + 5, 8, body[0]); R(p, r1 - 5, 8, r1 - 4, 11, body[1]); V(p, r1 - 4, 8, 11, body[0]); H(p, r0 + 6, r1 - 6, 5, body[0]); R(p, r0 + 5, 2, r0 + 7, 3, body[1]); p.set(r0 + 5, 2, body[2]); } // the carry handle, its channel, the rear sight
    else rail(p, r0, r1, 10);
    R(p, r0 + 10, 14, r0 + 17, 16, body[0]); H(p, r0 + 11, r0 + 16, 15, STEEL[0]); p.set(r0 + 17, 14, body[0]); // the ejection port, the bolt carrier behind it
    R(p, r1 - 6, 14, r1 - 3, 16, body[1]); p.set(r1 - 6, 14, body[2]); V(p, r1 - 3, 14, 16, body[0]); // the brass deflector and the forward assist
    R(p, r0 - 3, 12, r0 - 1, 13, body[1]); p.set(r0 - 3, 12, body[2]); p.set(r0 - 1, 13, body[0]); // the charging handle's latch
    box(p, r0 + 2, 18, r1 - 2, lowB, low, { wide: true, noTop: true }); H(p, r0 + 2, r1 - 2, 18, low[0]); // the lower, the seam under the upper
    box(p, r0 + 16, 18, r0 + 27, lowB + 2, low, { noTop: true, wide: true }); H(p, r0 + 16, r0 + 27, 18, low[0]); // the magazine well
    R(p, r0 + 7, 19, r0 + 10, 19, low[2]); p.set(r0 + 10, 20, low[0]); pin(p, r0 + 4, lowB - 2, low); pin(p, r1 - 8, lowB - 2, low); // the selector, the pins
    gripHD(p, gx, lowB + 1, 12, 7, furn, { slope: 5 });
    guardHD(p, gx + 4, gx + 11, lowB, IRON);
    arHandguard(p, s, r1 + 1, hg, hgM);
    if (s.fs === "fsb") frontSight(p, hg + 2, body, { swivel: true });
    else if (s.fs === "gas") box(p, hg + 2, 12, hg + 5, 17, IRON, { spec: false });
    else if (s.fs === "flip") { box(p, hg + 2, 12, hg + 5, 17, IRON, { spec: false }); box(p, hg - 4, 6, hg - 1, 9, IRON, { spec: false }); }
    if (s.piston) { box(p, hg + 2, 10, hg + 7, 17, IRON, { spec: false }); p.set(hg + 7, 10, IRON[2]); }
    barrelHD(p, Math.max(hg, r1) + 1, bar, barM);
    if (s.step) { R(p, hg + 10, 16, hg + 11, 17, null); p.clear(hg + 10, 17); p.clear(hg + 11, 17); } // the M4's barrel step
    if (s.rearSight && !s.carry) { box(p, r0 + 2, 6, r0 + 6, 9, IRON, { spec: false }); p.set(r0 + 4, 7, IRON[0]); }
  },
  anchors: (s) => {
    const r0 = X0(s.r0), r1 = X1(s.r1), hg = X1(s.hg), mid = Math.round((r1 + hg) / 2), y0 = s.carry ? 4 : 10;
    return { optic: [r0 + 13, y0], mount: [r0 + 13, y0], muzzle: [X1(s.bar), 14], mag: [r0 + 18, s.tall ? 24 : 22], stock: [s.buffer === false ? r0 - 1 : r0 - 9, 17],
      under: [mid - 1, 19], grip: [mid - 5, 19], rail: [mid - 1, 15], tactical: [hg - 5, 15], bipod: [hg - 5, 19], sling: [r0 - 16, 19] };
  },
};

// The SCAR: one long upper with its top rail to the muzzle end, a polymer lower, the charging handle out at the side.
FAMHD.scar = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), hg = X1(s.hg), bar = X1(s.bar), gx = X0(s.gx);
    const body = M(s.cn.body), low = M(s.cn.low), furn = M(s.cn.furn), barM = M(s.cn.bar), lowB = s.tall ? 23 : 21;
    box(p, r0, 10, hg, 17, body, { wide: true, spec: false }); rail(p, r0, hg, 8); // the upper, its one long rail
    box(p, r0 + 2, 18, r1, lowB, low, { wide: true, noTop: true }); H(p, r0 + 2, r1, 18, low[0]); box(p, r0 + 18, 18, r0 + 29, lowB + 2, low, { noTop: true }); // the lower, the magazine well
    box(p, r0 - 2, 10, r0 - 1, 17, IRON, { spec: false }); // the stock's hinge block
    R(p, r0 + 8, 14, r0 + 15, 16, body[0]); H(p, r0 + 9, r0 + 14, 15, STEEL[0]); // ejection port
    R(p, r1 + 4, 12, r1 + 7, 15, IRON[1]); p.set(r1 + 4, 12, IRON[2]); R(p, r1 + 8, 12, r1 + 10, 13, IRON[1]); p.set(r1 + 10, 13, IRON[0]); // the charging handle
    for (let x = r1 + 12; x < hg - 2; x += 4) R(p, x, 14, x + 1, 15, body[0]); // the side rail's holes
    rail(p, r1 + 10, hg, 18, IRON, 2); // the bottom rail
    gripHD(p, gx, lowB + 1, 12, 7, furn, { slope: 5 }); guardHD(p, gx + 4, gx + 11, lowB, IRON);
    box(p, hg + 2, 12, hg + 5, 17, IRON, { spec: false }); box(p, hg - 3, 5, hg, 7, IRON, { spec: false }); box(p, r0 + 2, 5, r0 + 5, 7, IRON, { spec: false }); // the gas block, the folded sights
    barrelHD(p, hg + 1, bar, barM);
  },
  anchors: (s) => { const r0 = X0(s.r0), r1 = X1(s.r1), hg = X1(s.hg); return { optic: [r0 + 15, 8], mount: [r0 + 15, 8], muzzle: [X1(s.bar), 14], mag: [r0 + 18, s.tall ? 24 : 22], stock: [r0 - 3, 15], under: [r1 + 17, 19], grip: [r1 + 15, 19], rail: [r1 + 17, 18], tactical: [hg - 7, 15], bipod: [hg - 7, 19], sling: [r0 - 16, 19] }; },
};

// The Kalashnikov: the stamped receiver and dust cover, wood or polymer handguards over and under the gas tube, the
// tall front sight block, the cleaning rod under the barrel.
FAMHD.ak = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), hg = X1(s.hg), fs = X0(s.fs), bar = X1(s.bar), gx = X0(s.gx);
    const body = M(s.cn.body), furn = M(s.cn.furn), barM = M(s.cn.bar), wood = isWood(s.cn.furn);
    box(p, r0, 12, r1, 19, body, { wide: true }); // the receiver
    box(p, r0 + 2, 10, r1 - 2, 11, body, { noBottom: true }); H(p, r0 + 2, r1 - 2, 12, body[0]); // the dust cover, its seam
    if (s.ribbed) for (let x = r0 + 6; x < r1 - 4; x += 4) p.set(x, 11, body[0]);
    R(p, r0 + 14, 16, r0 + 21, 17, STEEL[1]); p.set(r0 + 14, 16, STEEL[2]); p.set(r0 + 21, 17, STEEL[0]); R(p, r0 + 22, 18, r0 + 28, 19, body[2]); p.set(r0 + 28, 19, body[0]); // the charging handle, the selector lever
    R(p, r0 + 4, 14, r0 + 11, 16, body[0]); H(p, r0 + 5, r0 + 10, 15, STEEL[0]); // the ejection port cut in the cover
    pin(p, r0 + 2, 16, body); pin(p, r1 - 4, 16, body); // the rivets
    box(p, r1 - 5, 8, r1 + 2, 11, IRON, { spec: false }); p.set(r1 - 2, 8, IRON[2]); // the rear sight block
    gripHD(p, gx, 20, 12, 7, furn, { slope: 4, ribs: !wood }); if (wood) for (let i = 3; i < 11; i += 3) p.set(gx + 3 - Math.round(i * 4 / 11), 20 + i, furn[0]);
    guardHD(p, gx + 6, gx + 13, 19, IRON);
    forend(p, r1 + 1, hg, 14, 19, furn, 2); V(p, hg - 7, 15, 18, furn[0]); V(p, hg - 6, 15, 18, furn[2]); // the lower handguard, its finger groove
    cyl(p, r1 + 1, fs - 1, 12, 13, IRON, { spec: false }); // the gas tube
    box(p, r1 + 1, 8, hg + 5, 11, furn, { spec: false }); if (wood) grain(p, r1 + 1, hg + 5, 8, 11, furn, 3); // the upper handguard
    box(p, fs, 6, fs + 3, 17, body, { spec: false }); V(p, fs + 1, 3, 5, body[1]); p.set(fs + 1, 3, body[2]); V(p, fs, 4, 5, body[0]); V(p, fs + 3, 4, 5, body[0]); // the front sight block, its post and ears
    box(p, hg + 6, 10, fs - 1, 17, IRON, { spec: false }); // the gas block
    barrelHD(p, fs + 4, bar, barM, 1); H(p, fs + 4, bar - 4, 16, STEEL[0]); H(p, hg + 6, bar - 6, 17, STEEL[1]); // the barrel, the cleaning rod
  },
  anchors: (s) => { const r0 = X0(s.r0), r1 = X1(s.r1); return { optic: [r0 + 15, 10], mount: [r0 + 15, 14], muzzle: [X1(s.bar), 14], mag: [r0 + 22, 20], stock: [r0 - 1, 15], under: [r1 + 11, 19], grip: [r1 + 11, 19], rail: [r1 + 13, 15], tactical: [r1 + 17, 15], bipod: [r1 + 17, 19], sling: [r0 - 1, 19] }; },
};

// The FAL: a tall receiver sloping at the back, the carry handle folded on top, the vented handguard, the sight ears.
FAMHD.fal = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), hg = X1(s.hg), bar = X1(s.bar), gx = X0(s.gx);
    const body = M(s.cn.body), furn = M(s.cn.furn), hgM = M(s.cn.hg), barM = M(s.cn.bar);
    box(p, r0, 10, r1, 21, body, { wide: true }); for (let i = 0; i < 4; i++) for (let x = r0; x <= r0 + 3 - i; x++) p.clear(x, 10 + i); V(p, r0 + 4 - 0, 10, 10, body[2]); // the receiver, its sloped back
    H(p, r0 + 4, r1 - 1, 10, body[3]);
    R(p, r0 + 14, 14, r0 + 23, 16, body[0]); H(p, r0 + 15, r0 + 22, 15, STEEL[0]); box(p, r1 - 7, 12, r1 - 4, 15, STEEL, { spec: false }); // ejection port, the cocking handle
    box(p, r1 - 18, 6, r1 - 6, 7, IRON, { spec: false }); V(p, r1 - 18, 8, 9, IRON[1]); V(p, r1 - 6, 8, 9, IRON[1]); // the carry handle, folded
    box(p, r0 + 4, 6, r0 + 7, 9, IRON, { spec: false }); p.set(r0 + 5, 7, IRON[0]); // the rear aperture
    gripHD(p, gx, 22, 12, 7, furn, { slope: 5 }); guardHD(p, gx + 4, gx + 13, 21, IRON);
    box(p, r1 + 1, 12, hg, 19, hgM, { wide: true, spec: false }); if (isWood(s.cn.hg)) grain(p, r1 + 1, hg, 12, 19, hgM, 4); for (let x = r1 + 4; x < hg - 2; x += 4) { R(p, x, 14, x + 1, 14, hgM[0]); R(p, x, 17, x + 1, 17, hgM[0]); } // the vented handguard
    box(p, hg + 2, 12, hg + 7, 17, IRON, { spec: false }); V(p, hg + 4, 6, 11, IRON[1]); p.set(hg + 4, 6, IRON[2]); V(p, hg + 2, 8, 11, IRON[0]); V(p, hg + 7, 8, 11, IRON[0]); V(p, hg + 8, 8, 11, IRON[1]); // gas block, the ears around the post
    barrelHD(p, hg + 1, bar, barM, 1); H(p, hg + 8, bar, 16, barM[1]); H(p, hg + 8, bar, 17, barM[0]);
  },
  anchors: (s) => { const r0 = X0(s.r0), r1 = X1(s.r1), hg = X1(s.hg); return { optic: [r0 + 17, 10], mount: [r0 + 17, 10], muzzle: [X1(s.bar), 14], mag: [r0 + 20, 22], stock: [r0 - 1, 15], under: [r1 + 13, 19], grip: [r1 + 13, 19], rail: [r1 + 13, 12], tactical: [hg - 5, 15], bipod: [hg - 5, 19], sling: [r0 - 14, 21] }; },
};

// The HK roller-locked guns: the MP5 and the G3 (a slim stamped receiver, the cocking tube over the barrel, the drum
// rear sight and the hooded front post).
FAMHD.hk = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), hg = X1(s.hg), bar = X1(s.bar), gx = X0(s.gx), big = !!s.big;
    const body = M(s.cn.body), hgM = M(s.cn.hg), furn = M(s.cn.furn), barM = M(s.cn.bar), rb = big ? 21 : 19;
    box(p, r0, 12, r1, rb, body, { wide: true }); // the receiver
    vcyl(p, r0 + 2, r0 + 5, 8, 11, IRON, { capB: false }); p.set(r0 + 3, 9, IRON[0]); // the drum sight
    cyl(p, r1 - 6, hg + 3, 8, 11, IRON); // the cocking tube, out over the barrel
    if (big) { R(p, r0 + 18, 14, r0 + 25, 16, body[0]); H(p, r0 + 19, r0 + 24, 15, STEEL[0]); } // ejection port
    else { R(p, r0 + 20, 14, r0 + 26, 15, body[0]); }
    box(p, r1 - 11, 10, r1 - 8, 13, STEEL, { spec: false }); // the cocking handle
    pin(p, r0 + 2, 15, body); pin(p, r1 - 4, 15, body); pin(p, r0 + 8, rb - 2, body);
    box(p, gx - 4, rb + 1, gx + 11, rb + 2, furn, { spec: false }); gripHD(p, gx, rb + 3, 11, 7, furn, { slope: 4 }); // the trigger pack, the grip
    guardHD(p, gx + 4, gx + 11, rb + 2, IRON);
    if (big) { box(p, r1 + 1, 14, hg, 21, hgM, { wide: true, spec: false }); for (let x = r1 + 4; x < hg - 2; x += 4) R(p, x, 16, x + 1, 17, hgM[0]); } // the slim handguard
    else { cyl(p, r1 + 1, hg, 12, 21, hgM, { spec: false }); for (let x = r1 + 4; x < hg - 3; x += 5) { R(p, x, 14, x + 2, 15, hgM[0]); R(p, x, 18, x + 2, 19, hgM[0]); } } // the fat one, vented
    V(p, r1 + 1, 12, 21, hgM[2]);
    box(p, hg, 6, hg + 3, 11, IRON, { spec: false }); R(p, hg + 1, 7, hg + 2, 9, null); p.clear(hg + 1, 7); p.clear(hg + 2, 7); p.clear(hg + 1, 8); p.clear(hg + 2, 8); p.set(hg + 1, 9, IRON[2]); // the hooded front post
    barrelHD(p, hg + 4, bar, barM, big ? 2 : 1);
  },
  anchors: (s) => { const r0 = X0(s.r0), r1 = X1(s.r1), hg = X1(s.hg), big = !!s.big; return { optic: [r0 + 23, 12], mount: [r0 + 23, 12], muzzle: [X1(s.bar), 14], mag: [r0 + 24, big ? 22 : 20], stock: [r0 - 1, 15], under: [r1 + 9, 21], grip: [r1 + 9, 21], rail: [r1 + 9, 15], tactical: [r1 + 11, 15], bipod: [hg - 5, 21], sling: [r0 - 1, 19] }; },
};

// The M14 / M1A and the Mini-14: a full-length wooden stock to near the muzzle, the receiver and op-rod on top.
FAMHD.m14 = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), hg = X1(s.hg), bar = X1(s.bar), gx = X0(s.gx);
    const body = M(s.cn.body), furn = M(s.cn.furn), hgM = M(s.cn.hg), barM = M(s.cn.bar);
    box(p, r0 - 2, 16, hg - 1, 21, furn, { wide: true, spec: false }); grain(p, r0 - 2, hg - 1, 16, 21, furn, 5); // the stock's fore part
    box(p, r0, 10, r1, 15, body, { wide: true }); H(p, r0, r1, 16, furn[0]); // the receiver over the wood, the seam
    R(p, r0 + 12, 12, r0 + 19, 14, body[0]); H(p, r0 + 13, r0 + 18, 13, STEEL[0]); // the ejection port
    box(p, r0, 6, r0 + 3, 9, IRON, { spec: false }); V(p, r0 + 1, 4, 5, IRON[1]); p.set(r0 + 1, 4, IRON[2]); // the aperture sight
    box(p, r1 + 1, 12, hg - 7, 15, hgM, { spec: false }); if (isWood(s.cn.hg)) grain(p, r1 + 1, hg - 7, 12, 15, hgM, 6); // the upper handguard
    cyl(p, r1 - 8, hg - 4, 16, 17, STEEL, { spec: false }); box(p, r1 - 11, 14, r1 - 8, 17, STEEL, { spec: false }); // the op-rod and its handle
    box(p, hg - 4, 14, hg + 3, 19, IRON, { spec: false }); // the gas cylinder
    guardHD(p, gx + 2, gx + 11, 21, STEEL);
    barrelHD(p, r1 + 1, bar, barM, 1);
    if (s.ears !== false) { box(p, bar - 6, 6, bar - 3, 13, IRON, { spec: false }); p.clear(bar - 5, 6); p.clear(bar - 4, 6); p.clear(bar - 5, 7); p.clear(bar - 4, 7); V(p, bar - 5, 8, 9, IRON[1]); } else { V(p, bar - 2, 10, 13, IRON[1]); p.set(bar - 2, 10, IRON[2]); } // the front sight's ears, or a plain blade
    if (s.lug !== false) R(p, hg + 6, 16, hg + 8, 17, IRON[1]); // the bayonet lug
  },
  anchors: (s) => { const r0 = X0(s.r0), r1 = X1(s.r1), hg = X1(s.hg), gx = X0(s.gx); return { optic: [r0 + 13, 10], mount: [r0 + 13, 10], muzzle: [X1(s.bar), 14], mag: [gx + 14, 22], stock: [r0 - 3, 15], under: [r1 + 13, 21], grip: [r1 + 13, 21], rail: [r1 + 15, 12], tactical: [r1 + 19, 16], bipod: [hg - 9, 21], sling: [r0 - 16, 23] }; },
};

// Bolt-actions and rimfire rifles: the receiver, the bolt handle, the barrel, a wooden or synthetic fore-end.
FAMHD.bolt = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), bar = X1(s.bar), fe = s.fe ? X1(s.fe) : null;
    const body = M(s.cn.body), barM = M(s.cn.bar), feM = M(s.cn.fe), rb = s.ry1 ? 2 * s.ry1 + 1 : 19;
    if (fe) { forend(p, r0, fe, 18, 21, feM, 7); if (feM === WOOD || feM === PAL.ash) { V(p, fe, 18, 21, feM[2]); } } // the fore-end
    box(p, r0, 12, r1, rb, body, { wide: true }); // the receiver
    R(p, r0 + 8, 13, r0 + 17, 15, body[0]); H(p, r0 + 9, r0 + 16, 14, STEEL[0]); // the ejection port
    cyl(p, r0 - 3, r0 + 1, 13, 16, STEEL, { capL: true }); // the bolt shroud at the back
    barrelHD(p, r1 + 1, bar, barM, s.barRows);
    if (s.taper && s.barRows === 2) { for (let x = bar - 5; x <= bar; x++) { p.clear(x, 16); p.clear(x, 17); } H(p, bar - 5, bar, 15, barM[0]); bore(p, bar); }
    if (s.bead) { V(p, bar - 1, 12, 13, STEEL[1]); p.set(bar - 1, 12, STEEL[3]); }
    if (s.bolt === "knob") { R(p, r1 - 10, 18, r1 - 8, 19, STEEL[1]); R(p, r1 - 8, 20, r1 - 6, 21, STEEL[1]); p.set(r1 - 10, 18, STEEL[2]); R(p, r1 - 6, 20, r1 - 4, 22, STEEL[1]); p.set(r1 - 6, 20, STEEL[3]); p.set(r1 - 4, 22, STEEL[0]); }
    else if (s.bolt === "small") { R(p, r1 - 12, 16, r1 - 10, 17, STEEL[1]); R(p, r1 - 10, 18, r1 - 8, 19, STEEL[1]); p.set(r1 - 8, 19, STEEL[0]); p.set(r1 - 12, 16, STEEL[2]); }
    else if (s.bolt === "tac") { R(p, r1 - 10, 18, r1 - 8, 19, STEEL[1]); R(p, r1 - 8, 20, r1 - 5, 23, IRON[1]); p.set(r1 - 8, 20, IRON[2]); H(p, r1 - 8, r1 - 5, 23, IRON[0]); }
    guardHD(p, r0 + 4, r0 + 13, 21, IRON);
    if (s.floor) { R(p, r0 + 8, 22, r0 + 19, 23, STEEL[1]); H(p, r0 + 8, r0 + 19, 23, STEEL[0]); pin(p, r0 + 16, 22, STEEL); } // the hinged floorplate
    if (s.rail) rail(p, r0, r1 + 8, 10);
    else { R(p, r0 + 3, 10, r0 + 6, 11, body[1]); p.set(r0 + 3, 10, body[2]); R(p, r1 - 3, 10, r1 - 1, 11, body[1]); } // the scope bases
  },
  anchors: (s) => { const r0 = X0(s.r0), r1 = X1(s.r1), fe = s.fe ? X1(s.fe) : r1 + 16, u = Math.round((r1 + fe) / 2) + 2; return { optic: [r0 + 15, 10], mount: [r0 + 15, 10], muzzle: [X1(s.bar), 14], mag: [r0 + 8, 22], stock: [r0 - 4, 17], under: [u, 21], bipod: [u, 21], sling: [r0 - 8, 23] }; },
};

// Break-action guns: a side-by-side double, an over-under, a single barrel (its hinge and hammer showing), a
// sawn-off, the grenade launcher's fat barrel.
FAMHD.brk = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), bar = X1(s.bar), fe = s.fe ? X1(s.fe) : null;
    const body = M(s.cn.body), barM = M(s.cn.bar), feM = M(s.cn.fe);
    if (s.over) { // over-under: a deep action, two barrels stacked, a vent rib on top
      const lo = s.slim ? 14 : 16, top = s.slim ? 10 : 8, bh = s.slim ? 1 : 3; // the lower barrel's top row, the upper barrel's top row, barrel thickness - 1
      box(p, r0, top, r1, lo + bh + 4, body, { wide: true }); p.clear(r1, lo + bh + 4); p.clear(r1, lo + bh + 3); p.clear(r1 - 1, lo + bh + 4); // the action, its front rounded
      R(p, r0 + 2, top - 2, r0 + 5, top - 1, IRON[1]); p.set(r0 + 2, top - 2, IRON[2]); // the top lever
      for (let x = r0 + 4; x < r1 - 4; x += 5) { p.set(x, top + 4, body[0]); p.set(x + 1, top + 5, body[0]); p.set(x + 1, lo + bh - 1, body[0]); p.set(x, lo + bh, body[0]); } // the engraving
      cyl(p, r1 + 1, bar, top, top + bh, barM); // the upper barrel
      H(p, r1 + 1, bar, lo - 1, IRON[0]); if (!s.slim) H(p, r1 + 1, bar, lo - 2, IRON[0]); // the side rib between them
      cyl(p, r1 + 1, bar, lo, lo + bh, barM); // the lower barrel
      cyl(p, r1 + 1, bar, top - 2, top - 1, barM, { spec: false }); dots(p, r1 + 3, bar - 2, top - 2, barM[0], 3); // the vent rib
      V(p, bar, top - 4, top - 3, STEEL[1]); p.set(bar, top - 4, STEEL[3]); // the bead
      forend(p, r1 + 1, fe, lo + bh + 1, lo + bh + 4, feM, 8); R(p, fe + 1, lo + bh + 1, fe + 2, lo + bh + 2, feM[1]); p.set(fe + 2, lo + bh + 2, feM[0]); // the schnabel fore-end
      guardHD(p, r0 + 2, r0 + 11, lo + bh + 4, IRON);
      return;
    }
    if (s.n === 1) { // a single barrel: the action, its hinge pin, the hammer
      box(p, r0, 12, r1, 21, body, { wide: true });
      R(p, r0 - 2, 8, r0 + 1, 11, IRON[1]); p.set(r0 - 2, 8, IRON[2]); R(p, r0 - 4, 6, r0 - 2, 7, IRON[1]); p.set(r0 - 4, 7, IRON[0]); // the hammer's spur
      const rows = s.barRows || 2;
      cyl(p, r1 + 1, bar, 12, 12 + rows * 2 - 1, barM); bore(p, bar, 12);
      if (s.taper) { for (let x = bar - 6; x <= bar; x++) { p.clear(x, 14); p.clear(x, 15); } H(p, bar - 6, bar, 13, barM[0]); }
      R(p, r1 - 3, 16, r1, 19, body[0]); R(p, r1 - 2, 17, r1 - 1, 18, STEEL[1]); p.set(r1 - 2, 17, STEEL[3]); // the hinge pin
      R(p, r0 + 6, 22, r0 + 7, 25, STEEL[1]); p.set(r0 + 7, 25, STEEL[0]); // the release lever in front of the guard
      if (fe) forend(p, r1 + 1, fe, 16, 19, feM, 9);
      guardHD(p, r0 + 2, r0 + 11, 21, IRON);
      if (s.bead !== false) { V(p, bar, 10, 11, STEEL[1]); p.set(bar, 10, STEEL[3]); }
      if (s.base) rail(p, r0 + 2, r1 - 2, 10);
      return;
    }
    // a side-by-side double (one barrel hides the other): the action, the top lever, the rib
    box(p, r0, 12, r1, 21, body, { wide: true }); R(p, r0 + 2, 10, r0 + 5, 11, IRON[1]); p.set(r0 + 2, 10, IRON[2]);
    for (let x = r0 + 4; x < r1 - 4; x += 5) { p.set(x, 15, body[0]); p.set(x + 1, 16, body[0]); p.set(x + 1, 18, body[0]); p.set(x, 19, body[0]); } // the engraving
    if (s.hammers) { R(p, r0 - 2, 8, r0 + 1, 11, IRON[1]); p.set(r0 - 2, 8, IRON[2]); R(p, r0 - 4, 6, r0 - 2, 7, IRON[1]); }
    if (s.fat) { cyl(p, r1 + 1, bar, 12, 21, barM); bore(p, bar, 16); }
    else { cyl(p, r1 + 1, bar, 12, 15, barM); H(p, r1 + 1, bar, 16, barM[0]); H(p, r1 + 1, bar, 17, barM[0]); bore(p, bar, 14); cyl(p, r1 + 1, bar, 10, 11, barM, { spec: false }); } // the barrel, the one beside it in shadow, the rib
    if (fe) forend(p, r1 + 1, fe, s.fat ? 22 : 18, s.fat ? 25 : 21, feM, 10);
    guardHD(p, r0 + 2, r0 + 11, 21, IRON);
    V(p, bar, 8, 9, STEEL[1]); p.set(bar, 8, STEEL[3]);
    if (s.ladder) { box(p, r1 + 6, 4, r1 + 9, 9, IRON, { spec: false }); p.set(r1 + 10, 4, IRON[1]); p.set(r1 + 10, 5, IRON[1]); V(p, bar - 4, 6, 11, IRON[1]); p.set(bar - 4, 6, IRON[2]); } // the launcher's ladder sight and blade
  },
  anchors: (s) => {
    const r0 = X0(s.r0), r1 = X1(s.r1), fe = s.fe ? X1(s.fe) : r1 + 16, top = s.over ? (s.slim ? 10 : 8) : 12;
    return { optic: [r0 + 11, s.over ? top - 2 : 10], mount: [r0 + 11, s.over ? top - 2 : 10], muzzle: [X1(s.bar), top + (s.over ? 0 : s.n === 1 ? 0 : 2)], stock: [r0 - 1, 17], under: [Math.round((r1 + fe) / 2), s.over ? (s.slim ? 19 : 23) : s.fat ? 25 : s.n === 1 ? 19 : 21], sling: [r0 - 8, 23] };
  },
};

// Lever-actions: the receiver (blued, case-coloured or nickel), the tube under the barrel, the lever's loop.
FAMHD.lever = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), bar = X1(s.bar), tube = X1(s.tube), fe = X1(s.fe);
    const body = M(s.cn.body), barM = M(s.cn.bar), feM = M(s.cn.fe);
    box(p, r0, 12, r1, 21, body, { wide: true }); // the receiver
    R(p, r1 - 6, 16, r1 - 3, 18, body[0]); p.set(r1 - 5, 17, STEEL[1]); // the loading gate
    pin(p, r0 + 3, 14, body); pin(p, r0 + 3, 19, body); pin(p, r1 - 4, 13, body); // the side plate screws
    cyl(p, r1 + 1, bar, 14, 14 + (s.barRows || 1) * 2 - 1, barM); bore(p, bar); V(p, bar - 1, 12, 13, STEEL[1]); p.set(bar - 1, 12, STEEL[3]); // the barrel, the bead
    cyl(p, r1 + 1, tube, 16, 17, IRON, { spec: false }); V(p, tube, 16, 17, STEEL[1]); // the magazine tube
    forend(p, r1 + 1, fe, 18, 21, feM, 11); V(p, fe, 18, 21, feM[2]);
    if (s.band) { V(p, fe + 6, 14, 19, STEEL[1]); V(p, fe + 7, 14, 19, STEEL[0]); p.set(fe + 6, 14, STEEL[3]); } // the barrel band
    const loop = s.loop === "big"
      ? [[r0 + 2, 22], [r0 + 1, 24], [r0, 26], [r0, 28], [r0 + 1, 30], [r0 + 3, 31], [r0 + 6, 31], [r0 + 9, 31], [r0 + 11, 30], [r0 + 13, 28], [r0 + 13, 26], [r0 + 14, 24], [r0 + 15, 22]]
      : [[r0 + 2, 22], [r0 + 2, 24], [r0 + 3, 26], [r0 + 5, 27], [r0 + 7, 27], [r0 + 9, 27], [r0 + 11, 26], [r0 + 13, 24], [r0 + 14, 22], [r0 + 15, 22]];
    for (let i = 1; i < loop.length; i++) p.line(loop[i - 1][0], loop[i - 1][1], loop[i][0], loop[i][1], STEEL[1]);
    for (let i = 1; i < loop.length; i++) if (loop[i][1] >= loop[i - 1][1] && loop[i][1] > 24) p.line(loop[i - 1][0], loop[i - 1][1] + 1, loop[i][0], loop[i][1] + 1, STEEL[0]); // the loop's underside
    p.set(loop[0][0], 22, STEEL[3]); p.set(loop[0][0] + 1, 22, STEEL[2]);
    p.set(r0 + 7, 23, STEEL[1]); p.set(r0 + 7, 24, STEEL[2]); // the trigger
    R(p, r0, 10, r0 + 2, 11, IRON[1]); p.set(r0, 10, IRON[2]); p.set(r0 - 1, 9, IRON[1]); // the hammer
    if (s.ring) { R(p, r0 + 4, 21, r0 + 7, 22, STEEL[1]); p.set(r0 + 4, 21, STEEL[3]); } // the saddle ring
  },
  anchors: (s) => { const r0 = X0(s.r0), r1 = X1(s.r1), fe = X1(s.fe); return { optic: [r0 + 9, 12], mount: [r0 + 9, 12], muzzle: [X1(s.bar), 14], mag: [X1(s.tube), 16], stock: [r0 - 1, 17], under: [Math.round((r1 + fe) / 2), 21], bipod: [fe - 4, 21], sling: [r0 - 8, 23] }; },
};

// Pump shotguns: the receiver, the barrel, the magazine tube, the pump (a heat shield, shells in a side saddle).
FAMHD.pump = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), bar = X1(s.bar), tube = X1(s.tube), [q0, q1] = [X0(s.pump[0]), X1(s.pump[1])];
    const body = M(s.cn.body), barM = M(s.cn.bar), pm = M(s.cn.pump), furn = M(s.cn.furn), slim = !!s.slim;
    box(p, r0, 12, r1, 21, body, { wide: true }); R(p, r0 + 8, 16, r0 + 15, 18, body[0]); H(p, r0 + 9, r0 + 14, 17, STEEL[0]); pin(p, r0 + 3, 14, body); pin(p, r1 - 4, 19, body); // the receiver, its port, the pins
    cyl(p, r1 + 1, bar, 12, slim ? 13 : 15, barM); bore(p, bar, 12); V(p, bar, 10, 11, STEEL[1]); p.set(bar, 10, STEEL[3]); // barrel, bead
    if (s.rib) { cyl(p, r1 + 1, bar - 1, 10, 11, barM, { spec: false }); dots(p, r1 + 3, bar - 3, 10, barM[0], 3); }
    cyl(p, r1 + 1, tube, slim ? 14 : 16, slim ? 17 : 19, IRON, { spec: false }); V(p, tube, slim ? 14 : 16, slim ? 17 : 19, STEEL[1]); // the magazine tube
    H(p, r1 + 1, q0 - 1, slim ? 18 : 20, STEEL[1]); H(p, r1 + 1, q0 - 1, slim ? 19 : 21, STEEL[0]); // the action bars
    if (s.pumpT === "tac") { box(p, q0, slim ? 14 : 16, q1, 21, pm, { wide: true, spec: false }); for (let x = q0 + 2; x < q1 - 1; x += 3) V(p, x, slim ? 16 : 18, 19, pm[0]); rail(p, q0 + 2, q1 - 2, 21, IRON, 2); }
    else { box(p, q0, slim ? 14 : 16, q1, 21, pm, { wide: true, spec: false }); for (let x = q0 + 2; x < q1 - 1; x += 3) { V(p, x, slim ? 16 : 18, 19, pm[0]); p.set(x + 1, slim ? 16 : 18, pm[2]); } } // the pump's grooves
    guardHD(p, r0 + 4, r0 + 13, 21, IRON);
    if (s.pg) gripHD(p, r0 + 2, 22, 10, 7, furn, { slope: 4 });
    if (s.shield) { box(p, r1 + 1, 8, r1 + 27, 11, IRON, { spec: false }); for (let x = r1 + 4; x < r1 + 25; x += 4) R(p, x, 9, x + 1, 10, IRON[0]); } // the heat shield
    if (s.ghost) { box(p, r1 - 7, 6, r1 - 4, 11, IRON, { spec: false }); p.clear(r1 - 6, 7); p.clear(r1 - 5, 7); p.clear(r1 - 6, 8); p.clear(r1 - 5, 8); V(p, bar - 3, 6, 9, IRON[1]); p.set(bar - 3, 6, IRON[2]); } // ghost ring and blade
    if (s.saddle) { box(p, r0 + 2, 14, r0 + 17, 20, IRON, { spec: false }); for (let x = r0 + 3; x <= r0 + 15; x += 4) { R(p, x, 15, x + 2, 17, RED[1]); p.set(x, 15, RED[2]); R(p, x, 18, x + 2, 19, BRASS[1]); p.set(x, 18, BRASS[2]); } } // shells in the side saddle
  },
  anchors: (s) => { const r0 = X0(s.r0), q = X1(s.pump[1]); return { optic: [r0 + 13, 10], mount: [r0 + 13, 10], muzzle: [X1(s.bar), 12], mag: [X1(s.tube), s.slim ? 14 : 16], stock: [r0 - 1, 17], under: [q + 6, 21], tactical: [q + 6, 21], grip: [X0(s.pump[0]) + 8, 21], sling: [r0 - 8, 23] }; },
};

// The semi-automatic shotgun: receiver, barrel, tube, a polymer fore-end, a rail on top.
FAMHD.semi = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), bar = X1(s.bar), tube = X1(s.tube), fe = X1(s.fe);
    const body = M(s.cn.body), barM = M(s.cn.bar), feM = M(s.cn.fe), furn = M(s.cn.furn);
    box(p, r0, 12, r1, 21, body, { wide: true }); R(p, r0 + 6, 15, r0 + 15, 17, body[0]); H(p, r0 + 7, r0 + 14, 16, STEEL[1]); box(p, r0 + 12, 14, r0 + 14, 18, STEEL, { spec: false }); // receiver, ejection port, the bolt handle
    cyl(p, r1 + 1, bar, 12, 15, barM); bore(p, bar, 12); V(p, bar, 10, 11, STEEL[1]); p.set(bar, 10, STEEL[3]);
    cyl(p, r1 + 1, tube, 16, 19, IRON, { spec: false }); V(p, tube, 16, 19, STEEL[1]);
    box(p, r1 + 1, 16, fe, 21, feM, { wide: true, spec: false }); for (let x = r1 + 4; x < fe - 2; x += 4) V(p, x, 18, 20, feM[0]); // the fore-end, its grooves
    if (s.pg) gripHD(p, r0 + 2, 22, 10, 7, furn, { slope: 4 });
    guardHD(p, r0 + 8, r0 + 17, 21, IRON);
    if (s.rail) rail(p, r0, r1, 10);
    if (s.ghost) { box(p, r1 - 5, 6, r1 - 2, 9, IRON, { spec: false }); p.clear(r1 - 4, 6); p.clear(r1 - 3, 6); }
  },
  anchors: (s) => { const r0 = X0(s.r0), fe = X1(s.fe); return { optic: [r0 + 17, 10], mount: [r0 + 17, 10], muzzle: [X1(s.bar), 12], mag: [X1(s.tube), 16], stock: [r0 - 1, 17], under: [fe + 6, 21], tactical: [fe + 6, 21], sling: [r0 - 8, 23] }; },
};

// Pistols with a slide: the slide (serrations, the ejection port, sights), the frame and its rail, the grip (panels,
// stippling), a hammer.
FAMHD.slide = {
  paint(p, s) {
    const x0 = X0(s.x0), x1 = X1(s.x1), y0 = 2 * s.y0, gx = X0(s.gx), y1 = y0 + (s.tall ? 9 : 7);
    const sl = M(s.cn.slide), fr = M(s.cn.frame), gr = M(s.cn.grip), barM = M(s.cn.bar);
    box(p, x0, y0, x1, y1, sl, { wide: true }); // the slide
    for (let x = x0 + 3; x <= x0 + 13; x += 2) V(p, x, y0 + 2, y1 - 2, sl[0]); // rear serrations
    if (s.fserr) for (let x = x1 - 12; x <= x1 - 4; x += 2) V(p, x, y0 + 2, y1 - 2, sl[0]);
    R(p, x0 + 18, y0 + 1, x0 + 27, y0 + 4, sl[0]); H(p, x0 + 19, x0 + 26, y0 + 2, STEEL[0]); p.set(x0 + 19, y0 + 2, STEEL[2]); // the ejection port, the barrel hood in it
    if (s.tall) { rail(p, x0 + 4, x1 - 4, y0 - 2); p.clear(x1, y1); p.clear(x1, y1 - 1); p.clear(x1 - 1, y1); H(p, x1 - 18, x1 - 8, y0 + 4, sl[0]); dots(p, x1 - 17, x1 - 9, y0 + 4, sl[2], 3); } // the hand cannon: a top rail, the triangular nose, the ports
    box(p, x0 + 4, y1 + 1, x1 - 8, y1 + 4, fr, { noTop: true, spec: false }); H(p, x0 + 4, x1 - 8, y1 + 1, fr[0]); // the frame, the seam under the slide
    R(p, x0 + 14, y1 + 2, x0 + 17, y1 + 3, fr[2]); p.set(x0 + 17, y1 + 3, fr[0]); R(p, x0 + 6, y1 + 2, x0 + 8, y1 + 2, fr[2]); // the slide stop, the takedown lever
    if (s.rail !== false) rail(p, x1 - 18, x1 - 8, y1 + 5, IRON, 2); // the accessory rail
    R(p, x1 - 4, y0 - 2, x1 - 3, y0 - 1, IRON[1]); p.set(x1 - 4, y0 - 2, IRON[2]); R(p, x0 + 4, y0 - 2, x0 + 7, y0 - 1, IRON[1]); p.set(x0 + 5, y0 - 2, IRON[0]); p.set(x0 + 6, y0 - 2, IRON[0]); // the sights
    const n = s.gripN * 2, w = s.gripW * 2;
    gripHD(p, gx, y1 + 5, n, w, gr, { slope: 2 * Math.floor((s.gripN - 1) / 3) + 1, ribs: !!s.stipple, panel: s.panels ? M(s.cn.panels) : null });
    if (s.hammer) { R(p, x0 - 2, y0, x0 - 1, y0 + 3, IRON[1]); p.set(x0 - 2, y0, IRON[2]); R(p, x0 - 4, y0 - 1, x0 - 2, y0, IRON[1]); p.set(x0 - 4, y0, IRON[0]); }
    if (s.beaver) { R(p, x0 - 2, y1 + 3, x0 + 3, y1 + 4, fr[1]); p.set(x0 - 2, y1 + 3, fr[2]); p.set(x0 - 2, y1 + 4, fr[0]); }
    guardHD(p, gx + 10, gx + 21, y1 + 4, IRON, { depth: 6 });
    if (s.sqGuard) { p.set(gx + 21, y1 + 10, IRON[1]); p.set(gx + 22, y1 + 9, IRON[0]); }
    cyl(p, x1 + 1, x1 + 2, y0 + 2, y0 + 5, STEEL, { spec: false }); bore(p, x1 + 2, y0 + 3); // the barrel's crown just past the slide
    if (s.bbl) { cyl(p, x1 + 1, x1 + 2 * s.bbl, y0 + 2, y0 + 5, barM); bore(p, x1 + 2 * s.bbl, y0 + 3); }
  },
  anchors: (s) => { const x0 = X0(s.x0), x1 = X1(s.x1), y0 = 2 * s.y0, gx = X0(s.gx), y1 = y0 + (s.tall ? 9 : 7), xm = x1 + (s.bbl ? 2 * s.bbl : 2); return { optic: [x1 - 22, y0], mount: [x1 - 22, y0], muzzle: [xm, y0 + 2], mag: [gx - 4, y1 + 4 + s.gripN * 2], under: [x1 - 13, y1 + 6], tactical: [x1 - 13, y1 + 6], grip: [gx - 2, y1 + 14] }; },
};

// Revolvers: the frame, the cylinder (flutes), the barrel (an ejector rod or a full lug under it, a rib on top), the
// hammer, the grip (a part: the builder's grip slot).
FAMHD.revolver = {
  paint(p, s) {
    const f0 = X0(s.fr[0]), f1 = X1(s.fr[1]), c0 = X0(s.cyl[0]), c1 = X1(s.cyl[1]), bar = X1(s.bar);
    const fm = M(s.cn.frame), cm = M(s.cn.cyl), bm = M(s.cn.bar);
    box(p, f0, 12, f1, 21, fm, { wide: true }); box(p, f0, 14, f0 + 3, 25, fm, { noTop: true }); // the frame: top strap, recoil shield down to the grip
    cyl(p, c0, c1, 12, 23, cm); for (const [x, y] of [[c0, 12], [c1, 12], [c0, 23], [c1, 23], [c0, 13], [c1, 13], [c0, 22], [c1, 22]]) p.clear(x, y); V(p, c0 + 1, 14, 21, cm[2]); // the cylinder, bulging past the frame, its corners rounded
    if (!s.fluteless) for (let x = c0 + 4; x < c1 - 2; x += 4) { V(p, x, 15, 20, cm[0]); V(p, x - 1, 15, 20, cm[2]); } // its flutes
    H(p, c0 + 2, c1 - 2, 13, cm[3]);
    cyl(p, f1 + 1, bar, 12, 17, bm); bore(p, bar); // the barrel
    if (s.lug) { box(p, f1 + 1, 18, bar, 21, bm, { noTop: true, spec: false }); H(p, f1 + 1, bar, 18, bm[0]); } // a full-length underlug
    else if (bar - f1 > 12) { cyl(p, f1 + 1, Math.min(bar - 8, f1 + 20), 18, 19, STEEL, { spec: false }); } // the ejector rod
    else R(p, f1 + 1, 18, f1 + 2, 19, bm[1]);
    if (s.rib) { cyl(p, f1 + 1, bar, 10, 11, bm, { spec: false }); dots(p, f1 + 3, bar - 2, 10, bm[0], 3); } // a rib on top
    R(p, bar - 3, 8, bar - 2, 11, bm[1]); p.set(bar - 3, 8, bm[2]); p.set(bar - 4, 10, bm[1]); p.set(bar - 4, 11, bm[1]); p.set(bar - 2, 11, bm[0]); // the ramp front sight
    if (s.hammer !== "bob") { R(p, f0 - 2, 10, f0 + 1, 13, IRON[1]); p.set(f0 - 2, 10, IRON[2]); R(p, f0 - 4, 8, f0 - 1, 9, IRON[1]); p.set(f0 - 4, 9, IRON[0]); } else { R(p, f0 - 1, 10, f0 + 1, 11, fm[1]); p.set(f0 - 1, 10, fm[2]); } // the hammer (shrouded on a snub)
    R(p, f0 + 4, 14, f0 + 7, 15, STEEL[1]); p.set(f0 + 4, 14, STEEL[3]); // the cylinder latch
    guardHD(p, f0 + 4, f0 + 13, 21, IRON);
  },
  anchors: (s) => { const f0 = X0(s.fr[0]), f1 = X1(s.fr[1]); return { optic: [f1 + 11, 10], mount: [f1 + 11, 10], muzzle: [X1(s.bar), 14], grip: [f0 - 1, 24], under: [f1 + 9, s.lug ? 21 : 19], tactical: [f1 + 9, s.lug ? 21 : 19] }; },
};

// The .22 target pistol: a slim receiver and a long heavy barrel, wooden grip panels.
FAMHD.rimpistol = {
  paint(p, s) {
    const x0 = X0(s.x0), x1 = X1(s.x1), bar = X1(s.bar), gx = X0(s.gx);
    const sl = M(s.cn.slide), bm = M(s.cn.bar), gr = M(s.cn.grip), pm = M(s.cn.panels);
    box(p, x0, 12, x1, 19, sl, { wide: true }); R(p, x0 + 6, 14, x0 + 13, 15, sl[0]); // the receiver, its port
    cyl(p, x0 - 3, x0 - 1, 13, 17, STEEL, { capL: true }); // the bolt's cocking ears
    cyl(p, x1 + 1, bar, 12, 17, bm); bore(p, bar); R(p, bar - 2, 9, bar - 1, 11, IRON[1]); p.set(bar - 2, 9, IRON[2]); R(p, x0 + 4, 9, x0 + 7, 11, IRON[1]); p.set(x0 + 5, 9, IRON[0]); // the barrel, the sights
    gripHD(p, gx, 20, 20, 10, gr, { slope: 6, ribs: false, panel: pm });
    guardHD(p, gx + 8, gx + 17, 19, IRON, { depth: 6 });
  },
  anchors: (s) => { const x0 = X0(s.x0), x1 = X1(s.x1), gx = X0(s.gx); return { optic: [x0 + 17, 11], mount: [x0 + 17, 11], muzzle: [X1(s.bar), 14], mag: [gx - 4, 39], under: [x1 + 11, 18], tactical: [x1 + 11, 18], grip: [gx - 2, 28] }; },
};

// The UMP: a boxy polymer receiver, the rails, a straight magazine, a side-folding skeleton stock.
FAMHD.ump = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), bar = X1(s.bar), gx = X0(s.gx);
    const body = M(s.cn.body), furn = M(s.cn.furn), bm = M(s.cn.bar);
    box(p, r0, 10, r1, 21, body, { wide: true, spec: false }); rail(p, r0 + 2, r1 - 12, 8); // the box, its top rail
    R(p, r0 + 16, 14, r0 + 25, 15, body[0]); box(p, r0 + 6, 14, r0 + 9, 17, body, { spec: false }); p.set(r0 + 6, 14, body[2]); // ejection port, the charging knob
    for (let i = 0; i < 4; i++) for (let x = r1 - i; x <= r1; x++) p.clear(x, 21 - i); // the front tapered
    rail(p, r1 - 18, r1 - 4, 22, IRON, 2); // the under rail
    for (let x = r1 - 16; x <= r1 - 4; x += 4) R(p, x, 14, x + 1, 15, body[0]); // the side rail
    gripHD(p, gx, 22, 12, 7, furn, { slope: 4 }); box(p, gx + 4, 22, gx + 15, 27, body, { spec: false }); for (let y = 24; y <= 27; y++) for (let x = gx + 8; x <= gx + 13; x++) p.clear(x, y); p.set(gx + 7, 23, STEEL[1]); p.set(gx + 7, 24, STEEL[2]); // the grip, the big moulded guard, the trigger
    box(p, r0 + 2, 4, r0 + 5, 7, IRON, { spec: false }); box(p, r1 - 8, 4, r1 - 5, 7, IRON, { spec: false }); // sights on the rail
    barrelHD(p, r1 + 1, bar, bm, 1);
  },
  anchors: (s) => { const r0 = X0(s.r0), r1 = X1(s.r1), gx = X0(s.gx); return { optic: [r0 + 25, 8], mount: [r0 + 25, 8], muzzle: [X1(s.bar), 14], mag: [gx + 20, 22], stock: [r0 - 1, 15], under: [r1 - 11, 23], tactical: [r1 - 11, 23], grip: [r1 - 11, 23], sling: [r0 - 1, 19] }; },
};

// The Vector: a long top rail, the low barrel under it, the angled housing in front of the grip, the magazine in it.
FAMHD.vector = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), bar = X1(s.bar), gx = X0(s.gx);
    const body = M(s.cn.body), low = M(s.cn.low), furn = M(s.cn.furn), bm = M(s.cn.bar);
    rail(p, r0, r1, 8); box(p, r0, 10, r1, 17, body, { wide: true, spec: false }); // the top rail, the upper
    for (let i = 0; i < 10; i++) H(p, gx + 6 + i, r1 - 4 - i, 18 + i, low[1]); V(p, r1 - 4, 18, 19, low[0]); H(p, gx + 6, r1 - 4, 18, low[0]); // the housing, its front sloping back
    H(p, gx + 12, r1 - 12, 21, low[0]); // the kriss system's seam
    gripHD(p, gx, 18, 14, 7, furn, { slope: 5 }); guardHD(p, gx + 2, gx + 8, 24, IRON);
    cyl(p, r1 - 3, bar, 18, 21, bm); bore(p, bar, 18); // the low barrel
    box(p, r0 + 4, 4, r0 + 7, 7, IRON, { spec: false }); box(p, r1 - 7, 4, r1 - 4, 7, IRON, { spec: false }); // folding sights
    R(p, r1 - 24, 14, r1 - 4, 15, body[0]);
  },
  anchors: (s) => { const r0 = X0(s.r0), r1 = X1(s.r1), gx = X0(s.gx); return { optic: [r0 + 25, 8], mount: [r0 + 25, 8], muzzle: [X1(s.bar), 18], mag: [gx + 18, 28], stock: [r0 - 1, 13], under: [r1 - 13, 17], tactical: [r1 - 9, 15], grip: [r1 - 13, 17], sling: [r0 - 1, 17] }; },
};

// The P90: a rounded bullpup, the magazine lying on top, the thumbhole grip, a short muzzle.
FAMHD.p90 = {
  paint(p, s, fitted = {}) {
    const r0 = X0(s.r0), r1 = X1(s.r1), bar = X1(s.bar), gx = X0(s.gx);
    const body = M(s.cn.body), bm = M(s.cn.bar);
    box(p, r0, 12, r1, 23, body, { wide: true, spec: false }); for (const [x, y] of [[r0, 12], [r0 + 1, 12], [r0, 13], [r0, 23], [r0, 22], [r1, 23], [r1, 22], [r1 - 1, 23]]) p.clear(x, y); // the shell, rounded
    R(p, r0, 14, r0 + 1, 24, BLACK[1]); V(p, r0, 14, 24, BLACK[0]); // the rubber butt
    for (let i = 0; i < 8; i++) H(p, r0 + 6 + i, r0 + 25 - i, 24 + i, body[1]); H(p, r0 + 6, r0 + 25, 24, body[0]); // under the butt
    box(p, gx - 2, 24, gx + 19, 33, body, { spec: false }); for (let y = 24; y <= 29; y++) for (let x = gx + 2; x <= gx + 13; x++) p.clear(x, y); H(p, gx + 2, gx + 13, 30, body[0]); // the thumbhole loop
    p.set(gx + 1, 25, STEEL[1]); p.set(gx + 1, 26, STEEL[2]); // the trigger
    if (!fitted.optic) { box(p, r0 + 36, 4, r0 + 51, 9, body, { spec: false }); R(p, r0 + 38, 6, r0 + 49, 7, IRON[0]); lensF(p, r0 + 47, 6, r0 + 49, 7); } // the ring sight's housing
    cyl(p, r1 + 1, bar, 16, 17, bm, { spec: false }); bore(p, bar, 16);
    R(p, r1 - 5, 18, r1 - 3, 19, IRON[0]);
  },
  anchors: (s) => { const r0 = X0(s.r0), r1 = X1(s.r1); return { optic: [r0 + 43, 10], mount: [r0 + 43, 10], muzzle: [X1(s.bar), 16], mag: [r0 + 12, 8], under: [r1 - 13, 25], tactical: [r1 - 7, 19], sling: [r0 + 3, 19] }; },
};

// Bullpups: the AUG (its scope-handle, the clear magazine behind the grip, the folding foregrip) and the FAMAS (the
// long carry handle, its bipod legs folded along it).
FAMHD.bullpup = {
  paint(p, s, fitted = {}) {
    const r0 = X0(s.r0), r1 = X1(s.r1), bar = X1(s.bar), gx = X0(s.gx), aug = s.v === "aug";
    const body = M(s.cn.body), furn = M(s.cn.furn), bm = M(s.cn.bar);
    box(p, r0, 12, r1, 23, body, { wide: true, spec: false }); R(p, r0, 12, r0 + 1, 23, BLACK[1]); V(p, r0, 12, 23, BLACK[0]); // the body, the butt pad
    box(p, r0 + 6, 24, r0 + 23, 25, body, { spec: false }); // the cheek
    gripHD(p, gx, 24, 12, 7, furn, { slope: 4 });
    if (aug) {
      H(p, gx - 2, gx + 13, 36, body[1]); H(p, gx - 2, gx + 13, 37, body[0]); V(p, gx + 14, 24, 36, body[1]); V(p, gx + 15, 25, 36, body[0]); p.set(gx + 7, 25, STEEL[1]); p.set(gx + 7, 26, STEEL[2]); // the guard round the hand, the trigger
      box(p, r1 + 1, 12, r1 + 7, 21, body, { spec: false }); // the barrel's shroud
      vcyl(p, r1 + 10, r1 + 13, 20, 31, furn); H(p, r1 + 10, r1 + 13, 32, furn[0]); // the foregrip
      if (!fitted.optic) { cyl(p, gx - 12, gx + 13, 2, 7, body, { spec: false }); R(p, gx - 8, 8, gx - 7, 11, body[1]); R(p, gx + 8, 8, gx + 9, 11, body[1]); V(p, gx - 13, 3, 6, IRON[0]); lensV(p, gx + 14, 3, 6); box(p, gx - 1, 0, gx + 2, 1, IRON, { spec: false }); } // the scope-handle
      else rail(p, gx - 14, gx + 15, 10);
    } else {
      guardHD(p, gx + 4, gx + 13, 23, IRON); H(p, gx - 4, gx + 15, 34, body[1]); H(p, gx - 4, gx + 15, 35, body[0]); V(p, gx + 14, 24, 34, body[1]); V(p, gx + 15, 25, 34, body[0]); // the full guard
      if (!fitted.optic) { box(p, r0 + 16, 4, r1 + 3, 7, body, { spec: false }); R(p, r0 + 18, 8, r0 + 19, 11, body[1]); R(p, r1, 8, r1 + 1, 11, body[1]); box(p, r0 + 18, 2, r0 + 21, 3, IRON, { spec: false }); box(p, r1, 2, r1 + 3, 3, IRON, { spec: false }); } // the carry handle, its sights
      else rail(p, r0 + 18, r1, 10);
      box(p, r1 + 1, 14, r1 + 13, 21, body, { spec: false }); // the handguard's nose
      cyl(p, r1 - 12, r1 + 13, 18, 19, IRON, { spec: false }); V(p, r1 + 13, 18, 21, IRON[1]); // the bipod's legs, folded
    }
    R(p, r0 + 30, 14, r0 + 37, 17, body[0]); H(p, r0 + 31, r0 + 36, 15, STEEL[0]); // the ejection port
    barrelHD(p, aug ? r1 + 8 : r1 + 14, bar, bm, aug ? 2 : 1);
    if (aug) cyl(p, r1 + 8, r1 + 17, 12, 13, IRON, { spec: false }); else { V(p, bar - 4, 11, 13, IRON[1]); p.set(bar - 4, 11, IRON[2]); }
  },
  anchors: (s) => { const r0 = X0(s.r0), r1 = X1(s.r1), gx = X0(s.gx); return s.v === "aug"
    ? { optic: [gx, 10], mount: [gx, 10], muzzle: [X1(s.bar), 14], mag: [gx - 18, 24], under: [r1 + 19, 21], tactical: [r1 + 21, 15], rail: [gx, 11], sling: [r0 + 5, 23] }
    : { optic: [r0 + 37, 10], mount: [r0 + 37, 10], muzzle: [X1(s.bar), 14], mag: [gx - 16, 24], under: [r1 + 7, 23], tactical: [r1 + 9, 17], rail: [r0 + 37, 10], sling: [r0 + 5, 23] }; },
};

// Machine guns: the M249 (feed cover, a carry handle), the M240 (feed cover, carry handle on the barrel, the gas
// tube), the M2 (spade grips, the perforated jacket).
FAMHD.mg = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), hg = X1(s.hg), bar = X1(s.bar), gx = X0(s.gx);
    const body = M(s.cn.body), hgM = M(s.cn.hg), furn = M(s.cn.furn), bm = M(s.cn.bar);
    if (s.v === "m2") {
      box(p, r0, 8, r1, 23, body, { wide: true }); box(p, r0 + 6, 6, r1 - 8, 7, IRON, { spec: false }); // the receiver box, the feed cover
      vcyl(p, r0 - 8, r0 - 1, 10, 13, IRON, { capB: false }); vcyl(p, r0 - 8, r0 - 1, 18, 21, IRON, { capB: false }); V(p, r0 - 10, 8, 23, IRON[1]); V(p, r0 - 9, 8, 23, IRON[0]); // the spade grips, the back plate
      R(p, r0 - 5, 14, r0 - 3, 17, STEEL[1]); p.set(r0 - 5, 14, STEEL[3]); // the butterfly trigger
      cyl(p, r1 + 1, r1 + 25, 10, 19, hgM); for (let x = r1 + 4; x < r1 + 24; x += 4) { R(p, x, 12, x + 1, 13, hgM[0]); R(p, x, 16, x + 1, 17, hgM[0]); } // the perforated jacket
      cyl(p, r1 + 26, bar, 12, 17, bm); bore(p, bar); box(p, bar - 3, 10, bar, 19, IRON, { spec: false }); // the heavy barrel, its flash hider
      box(p, r1 - 13, 2, r1 - 6, 5, IRON, { spec: false }); // the rear sight leaf
      box(p, r0 + 18, 24, r0 + 23, 27, IRON, { spec: false }); for (let i = 0; i < 16; i++) { R(p, r0 + 18 - i, 28 + i, r0 + 19 - i, 28 + i, IRON[1]); R(p, r0 + 22 + i, 28 + i, r0 + 23 + i, 28 + i, IRON[1]); if (i < 11) R(p, r0 + 20, 28 + i, r0 + 21, 28 + i, IRON[1]); } // the tripod
      return;
    }
    if (s.v === "m240") {
      box(p, r0, 10, r1, 21, body, { wide: true }); box(p, r0 + 8, 6, r1 - 2, 9, IRON, { spec: false }); p.set(r1, 8, IRON[1]); p.set(r1, 9, IRON[1]); dots(p, r0 + 10, r1 - 4, 7, IRON[2], 4); // the receiver, the feed cover
      R(p, r1 - 7, 12, r1, 13, body[0]); for (let x = r0 + 4; x <= r0 + 20; x += 4) pin(p, x, 16, body); // the cover's latch, the rivets
      gripHD(p, gx, 22, 12, 7, furn, { slope: 5 }); guardHD(p, gx + 4, gx + 13, 21, IRON);
      cyl(p, r1 + 1, bar, 12, 15, bm); bore(p, bar, 12); // the barrel
      cyl(p, r1 + 1, hg, 16, 19, IRON, { spec: false }); box(p, hg - 4, 16, hg, 21, IRON, { spec: false }); // the gas tube, its cylinder
      box(p, r1 + 6, 4, r1 + 17, 5, IRON, { spec: false }); R(p, r1 + 6, 6, r1 + 7, 11, IRON[1]); R(p, r1 + 16, 6, r1 + 17, 11, IRON[1]); // the carry handle on the barrel
      box(p, bar - 8, 6, bar - 5, 11, IRON, { spec: false }); V(p, bar - 7, 6, 7, IRON[2]); // the front sight
      box(p, r0 - 2, 12, r0 - 1, 19, IRON, { spec: false }); // the buffer
      return;
    }
    FAMHD.ar.paint(p, { ...s, hgT: "x", fs: "fsb", buffer: true }); // the M249: an AR-like core
    box(p, r0 + 14, 4, r1 - 2, 7, IRON, { spec: false }); R(p, r0 + 14, 8, r0 + 15, 9, IRON[1]); R(p, r1 - 3, 8, r1 - 2, 9, IRON[1]); // carry handle
    box(p, r1 + 1, 8, r1 + 7, 11, IRON, { spec: false }); // feed cover hinge
    box(p, r0 + 2, 10, r1, 11, IRON, { noBottom: true, spec: false }); // the feed cover over the receiver
  },
  anchors: (s) => { const r0 = X0(s.r0), r1 = X1(s.r1), hg = X1(s.hg); return s.v === "m2"
    ? { optic: [r0 + 17, 6], mount: [r0 + 17, 6], muzzle: [X1(s.bar), 14], mag: [r0 + 16, 24], stock: [r0 - 1, 17], tactical: [r1 + 13, 19], sling: [r0 + 5, 23] }
    : s.v === "m240"
      ? { optic: [r0 + 21, 6], mount: [r0 + 21, 6], muzzle: [X1(s.bar), 12], mag: [r0 + 20, 22], stock: [r0 - 3, 15], under: [hg + 5, 19], tactical: [hg + 7, 15], bipod: [hg + 7, 17], sling: [r0 - 16, 19] }
      : { optic: [r0 + 23, 4], mount: [r0 + 23, 4], muzzle: [X1(s.bar), 14], mag: [r0 + 24, 22], stock: [r0 - 9, 17], under: [r1 + 11, 19], tactical: [r1 + 15, 15], bipod: [hg + 9, 17], sling: [r0 - 8, 19] }; },
};

// The .50: a big receiver with its rail, a short fore-end, the monopod at the back.
FAMHD.amr = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), fe = X1(s.fe), bar = X1(s.bar), gx = X0(s.gx);
    const body = M(s.cn.body), hgM = M(s.cn.hg), furn = M(s.cn.furn), bm = M(s.cn.bar);
    box(p, r0, 10, r1, 21, body, { wide: true }); rail(p, r0, r1, 8); // the big receiver, its rail
    R(p, r0 + 20, 13, r0 + 29, 16, body[0]); H(p, r0 + 21, r0 + 28, 14, STEEL[0]); R(p, r0 + 6, 13, r0 + 9, 17, body[2]); p.set(r0 + 9, 17, body[0]); // the ejection port, the bolt handle's slot
    pin(p, r0 + 3, 18, body); pin(p, r1 - 5, 18, body);
    gripHD(p, gx, 22, 12, 7, furn, { slope: 5 }); guardHD(p, gx + 4, gx + 13, 21, IRON);
    box(p, r1 + 1, 12, fe, 19, hgM, { wide: true, spec: false }); for (let x = r1 + 4; x < fe - 3; x += 5) R(p, x, 14, x + 2, 16, hgM[0]); // fore-end, its vents
    cyl(p, fe + 1, bar, 14, 17, bm); bore(p, bar); for (let x = fe + 3; x < bar - 2; x += 4) p.set(x, 16, bm[0]); // the fluted barrel
    box(p, r0 - 10, 26, r0 - 7, 33, IRON, { spec: false }); R(p, r0 - 11, 33, r0 - 6, 34, IRON[0]); // the rear monopod
  },
  anchors: (s) => { const r0 = X0(s.r0), r1 = X1(s.r1); return { optic: [r0 + 21, 8], mount: [r0 + 21, 8], muzzle: [X1(s.bar), 14], mag: [r0 + 26, 22], stock: [r0 - 1, 17], under: [r1 + 11, 19], bipod: [r1 + 13, 19], sling: [r0 - 1, 21], tactical: [r1 + 11, 15] }; },
};

// The pipe gun: a plank stock, a pipe, tape.
FAMHD.zip = {
  paint(p, s) {
    const bar = X1(s.bar), bm = M(s.cn.bar), fm = M(s.cn.furn), pipe = GREY;
    box(p, 12, 16, 45, 21, fm, { wide: true, spec: false }); grain(p, 12, 45, 16, 21, fm, 12); p.clear(12, 21); p.clear(12, 16); // the plank
    cyl(p, 40, bar, 12, 15, pipe); bore(p, bar, 12); V(p, 40, 12, 15, pipe[2]); // the pipe
    box(p, 46, 16, 53, 19, pipe, { spec: false }); R(p, 48, 20, 49, 23, STEEL[1]); p.set(48, 20, STEEL[3]); p.set(49, 23, STEEL[0]); // the breech, a nail for a trigger
    for (const [a, b] of [[56, 69], [80, 89]]) { R(p, a, 15, b, 17, PAL.canvas[1]); H(p, a, b, 15, PAL.canvas[2]); H(p, a, b, 17, PAL.canvas[0]); } // tape
    R(p, 51, 10, 52, 11, pipe[1]); p.set(51, 10, pipe[2]); // a bead of weld for a sight
    void bm;
  },
  anchors: (s) => ({ optic: [61, 11], muzzle: [X1(s.bar), 12], stock: [25, 19], sling: [21, 21], under: [75, 17] }),
};

// Launchers: a tube on the shoulder (the AT4, the RPG with its warhead), the revolving 40 mm (the M32), the
// under-barrel 40 mm on its own (the M203).
FAMHD.tube = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), gx = X0(s.gx), body = M(s.cn.body);
    if (s.v === "rpg") {
      cyl(p, r0 + 12, r1 - 24, 14, 19, body); cyl(p, r0 + 4, r0 + 12, 12, 21, body, { capL: true }); // the tube, its flared back
      box(p, r0 + 32, 12, r0 + 53, 21, WOOD, { wide: true, spec: false }); grain(p, r0 + 32, r0 + 53, 12, 21, WOOD, 13); // the wooden heat guard
      gripHD(p, gx, 22, 12, 7, IRON, { slope: 4 }); gripHD(p, gx + 18, 22, 10, 7, IRON, { slope: 3 }); guardHD(p, gx + 4, gx + 11, 21, IRON);
      const wm = M("#3d4a2e"); cyl(p, r1 - 23, r1 - 12, 14, 19, wm); for (let i = 0; i < 8; i++) cyl(p, r1 - 12 + i, r1 - 12 + i, 10 + i, 23 - i, wm, { spec: false }); p.set(r1 - 12, 10, wm[2]); // the warhead
      box(p, r0 + 56, 8, r0 + 61, 13, IRON, { spec: false }); // the sight
      return;
    }
    cyl(p, r0, r1, 12, 21, body); V(p, r0, 12, 21, IRON[0]); V(p, r1, 12, 21, IRON[0]); box(p, r0 + 28, 10, r0 + 37, 23, body, { spec: false }); H(p, r0 + 28, r0 + 37, 10, body[0]); // the AT4's tube, its ends, the shoulder band
    gripHD(p, gx, 22, 10, 7, IRON, { slope: 3 }); box(p, gx + 16, 22, gx + 19, 29, IRON, { spec: false }); // the grips
    box(p, gx - 8, 6, gx - 3, 11, IRON, { spec: false }); box(p, gx + 28, 8, gx + 31, 11, IRON, { spec: false }); // the sights
    R(p, r0 + 6, 16, r0 + 25, 17, COYOTE[1]); H(p, r0 + 6, r0 + 25, 16, COYOTE[2]); // the label band
  },
  anchors: (s) => { const r0 = X0(s.r0), r1 = X1(s.r1), gx = X0(s.gx); return { optic: [gx - 5, 11], muzzle: s.v === "rpg" ? [r1 - 5, 16] : [r1, 14], sling: [r0 + 9, 23], under: [gx + 19, 23], tactical: [gx + 25, 13] }; },
};
FAMHD.m32 = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), bar = X1(s.bar), gx = X0(s.gx), body = M(s.cn.body), bm = M(s.cn.bar), cm = M(s.cn.cyl), furn = M(s.cn.furn);
    cyl(p, r0, r1, 8, 27, cm); for (let y = 12; y <= 25; y += 6) H(p, r0 + 2, r1 - 2, y, cm[0]); for (let x = r0 + 3; x < r1 - 2; x += 5) V(p, x, 9, 26, cm[0]); // the cylinder, its chambers
    box(p, r0 - 4, 10, r0 - 1, 19, body, { spec: false }); cyl(p, r1 + 1, bar, 8, 17, bm); bore(p, bar, 12); // the frame, the barrel
    rail(p, r0 - 4, bar - 8, 6); // the top rail
    gripHD(p, gx - 4, 20, 12, 7, furn, { slope: 4 }); vcyl(p, r1 + 8, r1 + 11, 18, 27, furn); // the grips
    guardHD(p, gx, 19, IRON);
  },
  anchors: (s) => { const r0 = X0(s.r0), r1 = X1(s.r1); return { optic: [r0 + 17, 6], mount: [r0 + 17, 6], muzzle: [X1(s.bar), 10], stock: [r0 - 7, 15], tactical: [r1 + 17, 15], sling: [r0 - 7, 19] }; },
};
FAMHD.m203 = {
  paint(p, s) {
    const r0 = X0(s.r0), r1 = X1(s.r1), bar = X1(s.bar), body = M(s.cn.body), bm = M(s.cn.bar);
    box(p, r0, 16, r1, 25, body, { wide: true, spec: false }); cyl(p, r1 + 1, bar, 16, 23, bm); bore(p, bar, 18); for (let x = r1 + 6; x < bar - 4; x += 6) R(p, x, 20, x + 1, 21, bm[0]); // the receiver, the tube
    rail(p, r0 - 4, bar - 4, 14); // the clamp rail
    guardHD(p, r0 + 4, r0 + 13, 25, IRON); R(p, r0 + 2, 26, r0 + 3, 27, IRON[1]);
    box(p, r0 + 6, 10, r0 + 9, 13, IRON, { spec: false }); // the leaf sight
  },
  anchors: (s) => { const r0 = X0(s.r0); return { optic: [r0 + 9, 14], muzzle: [X1(s.bar), 16], sling: [r0 + 1, 25] }; },
};

// ---------- painting a gun ----------
const ALIAS = { under: ["grip", "tactical", "bipod"], grip: ["under", "tactical"], tactical: ["under", "rail", "grip"], bipod: ["under", "grip"], rail: ["tactical", "under", "optic"], mount: ["optic"], optic: ["mount"], sling: ["stock"], stock: ["sling"], mag: ["under"], muzzle: [], pgrip: ["mag", "grip", "stock"], receiver: ["mount", "optic", "mag"], magnifier: ["optic", "mount"], cuff: ["stock", "sling"] };
const ORDER = ["sling", "stock", "cuff", "grip", "pgrip", "mag", "under", "bipod", "rail", "receiver", "tactical", "muzzle", "mount", "magnifier", "optic"];

// The spec a gun is drawn from (its own, else its look-alike's), normalised with its finish.
export function specHD(key, finish = null) {
  const o = ownKey(key) || (specOf(key) && specOf(key).key) || "carbine";
  return norm(o, finish);
}
export function anchorsHD(key, finish = null) {
  const s = specHD(key, finish), fam = FAMHD[s.body];
  const a = fam.anchors(s);
  if (s.anchors) for (const [slot, [x, y]] of Object.entries(s.anchors)) a[slot] = [2 * x + 1, 2 * y + 1];
  return a;
}
export function anchorHD(key, slot, fitted = {}, finish = null) {
  const A = anchorsHD(key, finish);
  let a = A[slot];
  if (!a) for (const sl of ALIAS[slot] || []) if (A[sl]) { a = A[sl]; break; }
  if (!a) a = [64, 19];
  if (slot === "optic" && fitted.mount) a = [a[0], a[1] - 4];
  return a;
}
// The gun's own parts as looks / specs: { slot: look or { kind } }.
export function ownParts(s) {
  const def = {};
  if (s.stock) def.stock = typeof s.stock === "string" ? s.stock : { kind: "stock", t: s.stock.t, col: s.stock.c || s.cn.furn };
  if (s.mag) def.mag = typeof s.mag === "string" ? s.mag : { kind: "mag", ...s.mag };
  if (s.muzzle) def.muzzle = s.muzzle;
  if (s.bipod) def.bipod = s.bipod;
  if (s.grips) def.grip = s.grips;
  return def;
}
export function paintGunHD(key, looks = null, slots = null, finish = null) {
  const s = specHD(key, finish), fam = FAMHD[s.body];
  if (!fam) throw new Error(`no HD family ${s.body}`);
  const p = painter(HD_W, HD_H);
  const A = anchorsHD(key, finish), def = ownParts(s), own = s.own || {};
  const fitted = looks || {};
  const all = { ...def };
  for (const [sl, l] of Object.entries(own)) if (!slots || !slots.includes(sl)) all[sl] = l;
  for (const [sl, l] of Object.entries(fitted)) if (l) all[sl] = l;
  const ctx = { anchors: A, def, key };
  const at = (slot) => { let a = A[slot]; if (!a) for (const sl of ALIAS[slot] || []) if (A[sl]) { a = A[sl]; break; } if (!a) a = [64, 19]; if (slot === "optic" && all.mount) a = [a[0], a[1] - 4]; return a; };
  for (const sl of ["sling", "stock"]) if (all[sl]) drawPart(p, all[sl], at(sl), ctx);
  fam.paint(p, s, fitted);
  for (const sl of ORDER) if (sl !== "sling" && sl !== "stock" && all[sl]) drawPart(p, all[sl], at(sl), ctx);
  for (const [sl, l] of Object.entries(all)) if (!ORDER.includes(sl)) drawPart(p, l, at(sl), ctx);
  return p;
}
// The HD body families and which GUN_ART bodies have one.
export const coverage = () => { const bodies = [...new Set(Object.values(GUN_ART).map((g) => g.body).filter(Boolean))]; return { bodies, covered: bodies.filter((b) => FAMHD[b]), missing: bodies.filter((b) => !FAMHD[b]) }; };

// ---------- the sheet: representative guns, bare ----------
export const REP = ["pistol", "pistol22", "compact9", "pistol45", "revolver", "snub357", "smg", "ump45", "carbine", "dmr", "ak", "leverrifle", "huntrifle", "sniper", "amr", "shotgun", "dbshotgun", "sawnoff", "semishotgun", "lmg", "aug", "pipegun", "m4", "fal"];
export const REP_LOOKS = { huntrifle: { optic: "scope9" } };
export const SHEET_TITLE = "HD guns (128 × 48), bare";
export const SHEET_COLS = 4;
export const SHEET = REP.map((k) => ({ label: k, paint: () => paintGunHD(k, REP_LOOKS[k] || {}) }));
