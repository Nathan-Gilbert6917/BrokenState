// HD designs for the dead (design preview only; the game's sprites are src/ui/sprites.js and src/ui/hivesprites.js).
// A 44 × 52 grid (twice the game's 22 × 26), facing right, feet on the bottom rows, a free column each side and a
// free row at the bottom for the outline that outline() adds.
//
// How a figure is built: every body part is painted flat into its own small painter (a "part"), shaded by its own
// silhouette (light from the upper left: a highlight along the top and left edges, a cool shadow along the right
// and bottom, a deep shadow in the lower-right corner), then stamped onto the figure back to front. Where a part
// lands on something already painted its rim darkens what is under it: the selective inner outline. Details
// (wounds, blood, tears, bone) go on last, over the shaded body.
import { painter, shade, mix, desat, warm, scaled } from "./hdcore.js";
import { Rng } from "../../src/sim/rng.js";
import { paintZombie, paintArmoredDead, zombieLookOf, zombieLook } from "../../src/ui/sprites.js";

export const W = 44, H = 52;
const DEFAULT_LOOK = { palette: "mixed", gore: "1", variants: "stats", eyes: "glow", clothes: "torn" };

// ---------- colours ----------
const COOL = "#3a5466";      // the sickly tint shadows lean to
const DEEP = "#243040";
export const BLOOD = { rim: "#5c1210", core: "#330a0b", dry: "#6e1a16", fresh: "#8a1f1a", wet: "#a8302a" };
export const BONE = { base: "#d8d0bc", sh: "#a89e86", dk: "#6f6858", hi: "#efe9da" };
const TEETH = "#e9e4d4", GUM = "#4a1416", MOUTH = "#1c0709";
const SHOE = "#2a2622";
const PUS = { base: "#c9c26a", hi: "#f0eaa6", dk: "#8c8438" };

// Four tones of a material: highlight, base, shadow (cooler), deep shadow (cooler still).
export function tones(base, { cool = 0.22, lift = 0.16 } = {}) {
  return { hi: shade(base, lift), base, sh: mix(shade(base, -0.24), COOL, cool), dk: mix(shade(base, -0.46), DEEP, cool + 0.08) };
}
const bruise = (T) => mix(T.dk, "#3c2240", 0.45); // an eye socket, a hollow
const eyeColors = (eye) => eye;

// ---------- the part shader ----------
// Every pixel of the part by where it sits in the part's silhouette. map: flat colour -> tones; a colour not in the
// map is kept as it is (details painted into the part already shaded).
function shadePart(q, map, { wide = false, soft = false } = {}) {
  const src = q.px.slice();
  const on = (x, y) => x >= 0 && y >= 0 && x < q.w && y < q.h && !!src[y * q.w + x];
  for (let y = 0; y < q.h; y++) for (let x = 0; x < q.w; x++) {
    const c = src[y * q.w + x];
    if (!c) continue;
    const T = map[c];
    if (!T) continue;
    const r1 = !on(x + 1, y), r2 = !on(x + 2, y), b1 = !on(x, y + 1), b2 = !on(x, y + 2);
    const l1 = !on(x - 1, y), t1 = !on(x, y - 1), l2 = !on(x - 2, y), t2 = !on(x, y - 2);
    let out = T.base;
    if ((r1 && (b1 || b2)) || (r2 && b1)) out = T.dk;
    else if (r1 || b1) out = T.sh;
    else if (wide && (r2 || b2)) out = T.sh;
    else if ((t1 && !r2 && !l1) || (l1 && !b2 && !t1)) out = T.hi;
    else if (soft && ((t2 && !r2 && !l2) || (l2 && !b2 && !t2))) out = T.hi;
    q.px[y * q.w + x] = out;
  }
  return q;
}
// A part stamped onto p at (ox, oy); its rim darkens what it lands on (the inner outline), then its pixels go down.
function stamp(p, q, ox, oy, rim = 0.38) {
  if (rim > 0) for (let y = -1; y <= q.h; y++) for (let x = -1; x <= q.w; x++) {
    if (q.get(x, y)) continue;
    if (!(q.get(x - 1, y) || q.get(x + 1, y) || q.get(x, y - 1) || q.get(x, y + 1))) continue;
    const under = p.get(ox + x, oy + y);
    if (under) p.set(ox + x, oy + y, mix(shade(under, -rim), DEEP, 0.18));
  }
  p.blit(q, ox, oy);
}
// A thick limb between two points: t pixels across, square-ended.
function limb(q, x0, y0, x1, y1, t, c) {
  const horiz = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, e = dx + dy;
  for (;;) {
    if (horiz) q.vl(x0, y0, y0 + t - 1, c); else q.hl(x0, x0 + t - 1, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; }
  }
}
const part = (w = W, h = H) => painter(w, h);

// ---------- details ----------
// A wound: a dark rim round a darker core, a dried streak running down from it (gravity), fainter on cloth.
function wound(p, x, y, size, rng, { streak = true, fresh = false } = {}) {
  const core = fresh ? BLOOD.fresh : BLOOD.core;
  if (size >= 2) { p.over(x - 1, y, BLOOD.rim); p.over(x + 1, y, BLOOD.rim); p.over(x, y - 1, BLOOD.rim); p.over(x, y + 1, BLOOD.rim); p.over(x, y, core); if (size >= 3) { p.over(x + 1, y + 1, BLOOD.rim); p.over(x + 1, y, core); p.over(x + 2, y, BLOOD.rim); p.over(x + 1, y - 1, BLOOD.rim); } }
  else { p.over(x, y, BLOOD.rim); p.over(x + 1, y, core); }
  if (streak && rng.chance(0.4)) { const len = rng.int(1, 3), sx = x + (size >= 3 ? 1 : 0); for (let i = 1; i <= len; i++) { const yy = y + (size >= 2 ? 1 : 0) + i, u = p.get(sx, yy); if (u) p.set(sx, yy, mix(u, BLOOD.dry, 0.7)); } }
}
// Exposed ribs: a patch of darker flesh with the bone bars across it.
function ribs(p, x0, y0, w, rows, T) {
  p.rect(x0, y0, x0 + w - 1, y0 + rows * 2, mix(T.dk, "#4a1a1c", 0.5));
  for (let i = 0; i < rows; i++) { p.hl(x0, x0 + w - 1, y0 + i * 2 + (i ? 0 : 1), BONE.base); p.set(x0 + w - 1, y0 + i * 2 + (i ? 0 : 1), BONE.sh); }
}
// The hollow eye: a sunken socket (darkest under the brow), the eye a 2-px core with a 1-px halo of its glow.
function eye(p, x, y, col, kind, T) {
  const sock = bruise(T);
  p.rect(x, y, x + 3, y + 2, sock);
  p.hl(x, x + 3, y, mix(sock, "#000", 0.35)); // the brow's shadow
  if (kind === "dead") { p.set(x + 1, y + 1, col); p.set(x + 2, y + 1, mix(col, sock, 0.3)); return; }
  const halo = mix(col, sock, 0.5), dim = mix(col, sock, 0.78);
  p.set(x, y + 1, halo); p.set(x + 3, y + 1, halo); p.set(x + 1, y + 2, halo); p.set(x + 2, y + 2, halo);
  p.set(x + 1, y, dim); p.set(x + 2, y, dim);
  p.set(x + 1, y + 1, col); p.set(x + 2, y + 1, col);
}
// An open jaw: the cavity, the upper teeth, the lower teeth, dark gums.
function jaw(p, x, y, w, h, { teeth = true, blood = false } = {}) {
  p.rect(x, y, x + w - 1, y + h - 1, MOUTH);
  p.hl(x, x + w - 1, y, GUM);
  if (teeth) { for (let i = 0; i < w; i += 2) p.set(x + i, y + 1, TEETH); for (let i = 1; i < w; i += 2) p.set(x + i, y + h - 1, TEETH); }
  if (blood) { p.set(x + 1, y + h - 1, BLOOD.fresh); p.over(x + 1, y + h, BLOOD.dry); p.over(x + 1, y + h + 1, BLOOD.dry); }
}
// Torn hems: a ragged edge of the garment where it ends, strips hanging below.
function fray(p, x0, x1, y, col, dk, rng, { deep = 1 } = {}) {
  for (let x = x0; x <= x1; x++) {
    const r = rng.next();
    if (r < 0.28) { for (let k = 1; k <= deep; k++) p.clear(x, y - k + 1); }
    else if (r < 0.5) p.over(x, y + 1, dk);
    if (r > 0.86) { p.over(x, y + 1, dk); p.over(x, y + 2, dk); }
  }
}

// ---------- the pieces of a figure ----------
const BUILD_W = { slim: 14, average: 18, heavy: 22, bloated: 26, brute: 28 };
const CX = 20.5;
const LR = (w) => [Math.round(CX - w / 2 + 0.5), Math.round(CX + w / 2 - 0.5)];

// The head: a skull 14 wide and 12 tall with a rounded crown, the jaw dropped open below it, sunken eyes looking
// the way it faces (right), an ear on the far side. Returns the part and where its features are.
function headPart(T, eyeCol, eyeKind, o = {}) {
  const { jawDrop = 2, cheek = false, scalp = false, hair = null, hairLong = true, teethBlood = false, size = 14 } = o;
  const q = part(20, 22);
  const h = size, x0 = 2, y0 = 2, sk = Math.round(h * 12 / 14);
  const SK = "#010101";
  // the skull: crown rounded by two steps, the cheeks tapering to the upper jaw
  q.rect(x0 + 2, y0, x0 + h - 3, y0, SK);
  q.rect(x0 + 1, y0 + 1, x0 + h - 2, y0 + 1, SK);
  q.rect(x0, y0 + 2, x0 + h - 1, y0 + sk - 2, SK);
  q.rect(x0 + 1, y0 + sk - 1, x0 + h - 2, y0 + sk - 1, SK);
  // the lower jaw, dropped
  const jy = y0 + sk + jawDrop - 1;
  q.rect(x0 + 3, jy, x0 + h - 3, jy + 1, SK);
  q.rect(x0 + 4, jy + 2, x0 + h - 4, jy + 2, SK);
  q.rect(x0 - 1, y0 + 5, x0 - 1, y0 + 7, SK); // ear
  shadePart(q, { [SK]: T }, { wide: true });
  // the hollow of the temple, under the cheekbone, the jaw's dark underside
  q.rect(x0 + h - 2, y0 + 5, x0 + h - 2, y0 + sk - 3, T.sh);
  q.hl(x0 + 4, x0 + h - 4, jy + 2, T.dk);
  // the mouth between the jaws: the cavity, teeth above and below
  const mouthY = y0 + sk - 2, mouthH = jy - mouthY + 1;
  jaw(q, x0 + 4, mouthY, h - 7, mouthH, { blood: teethBlood });
  q.rect(x0 + 2, mouthY, x0 + 3, mouthY + 1, T.sh); q.set(x0 + 3, jy, T.dk); // the cheek beside the mouth
  // the nose: a shadow where it was
  q.set(x0 + h - 4, y0 + 7, T.sh); q.set(x0 + h - 4, y0 + 8, T.dk); q.set(x0 + h - 3, y0 + 8, T.sh);
  // eyes, set toward the facing side
  eye(q, x0 + 2, y0 + 4, eyeCol, eyeKind, T);
  eye(q, x0 + h - 6, y0 + 4, eyeCol, eyeKind, T);
  if (cheek) { // the cheekbone through the skin
    q.rect(x0 + h - 5, y0 + 8, x0 + h - 2, y0 + 9, BONE.base); q.set(x0 + h - 2, y0 + 9, BONE.sh); q.set(x0 + h - 5, y0 + 9, BONE.sh); q.set(x0 + h - 3, y0 + 8, BONE.hi);
    q.hl(x0 + h - 6, x0 + h - 2, y0 + 10, BLOOD.rim); q.set(x0 + h - 6, y0 + 8, BLOOD.rim); q.set(x0 + h - 6, y0 + 9, BLOOD.core);
  }
  if (scalp) { q.rect(x0 + 3, y0, x0 + 7, y0, T.dk); q.rect(x0 + 2, y0 + 1, x0 + 6, y0 + 1, mix(T.dk, BLOOD.rim, 0.5)); q.set(x0 + 4, y0 + 1, BONE.sh); q.set(x0 + 5, y0 + 1, BONE.base); }
  if (hair) matted(q, x0, y0, h, hair, hairLong);
  return { q, x0, y0, h, jy, bottom: jy + 2 };
}
// Matted hair: a cap with a ragged edge, strands down the far side, a few light streaks.
function matted(q, x0, y0, h, hair, long = true) {
  const Hh = tones(hair, { cool: 0.1, lift: 0.22 });
  if (!long) { // a short crop, matted flat, patchy
    q.rect(x0 + 2, y0 - 1, x0 + h - 4, y0 - 1, Hh.base); q.rect(x0 + 1, y0, x0 + h - 3, y0, Hh.base); q.rect(x0, y0 + 1, x0 + h - 2, y0 + 1, Hh.sh);
    for (let x = x0; x < x0 + h - 1; x += 3) q.set(x, y0 + 2, Hh.dk); q.set(x0 + 5, y0, Hh.dk); q.hl(x0 + 3, x0 + 4, y0 - 1, Hh.hi); q.set(x0 + h - 1, y0 + 2, Hh.sh);
    return;
  }
  q.rect(x0 + 3, y0 - 2, x0 + h - 5, y0 - 2, Hh.base);
  q.rect(x0 + 1, y0 - 1, x0 + h - 3, y0 - 1, Hh.base);
  q.rect(x0, y0, x0 + h - 2, y0, Hh.base);
  q.rect(x0, y0 + 1, x0 + h - 1, y0 + 1, Hh.base);
  q.rect(x0, y0 + 2, x0 + 2, y0 + 2, Hh.base); q.rect(x0 + h - 4, y0 + 2, x0 + h - 1, y0 + 2, Hh.base); q.set(x0 + 5, y0 + 2, Hh.sh); q.set(x0 + 8, y0 + 2, Hh.sh); // the fringe, broken
  q.set(x0 + 1, y0 + 3, Hh.sh); q.set(x0 + h - 2, y0 + 3, Hh.sh);
  q.rect(x0 + h - 1, y0 + 3, x0 + h - 1, y0 + 4, Hh.sh); // the temple
  // strands down the far (left) side
  q.rect(x0 - 1, y0 + 2, x0 - 1, y0 + 10, Hh.sh); q.rect(x0 - 2, y0 + 4, x0 - 2, y0 + 12, Hh.dk); q.set(x0 - 1, y0 + 12, Hh.dk); q.set(x0 - 2, y0 + 14, Hh.dk);
  q.hl(x0 + 3, x0 + 5, y0 - 1, Hh.hi); q.set(x0 + 7, y0 - 2, Hh.hi); q.set(x0 + 1, y0 + 1, Hh.dk); q.rect(x0 + h - 3, y0 - 1, x0 + h - 3, y0, Hh.sh); q.rect(x0 + h - 2, y0 + 1, x0 + h - 1, y0 + 2, Hh.sh);
}
// Legs standing: two legs with a gap, the trouser hem over the shoes, shoes with a sole; or bare feet.
function legsPart(L, R, PT, SKT, rng, o = {}) {
  const { shoes = [true, true], top = 34, bottom = 50, grime = true, knee = true, apart = 0 } = o;
  const q = part();
  const mid = Math.floor((L + R) / 2);
  const P = "#020202", S = "#030303", K = "#040404";
  const fL = [L + 2 - apart, mid - 1 - apart], nL = [mid + 1 + apart, R - 2 + apart];
  q.rect(L + 2, top, R - 2, top + 3, P); // hips
  q.rect(fL[0], top, fL[1], bottom - 3, P);
  q.rect(nL[0], top, nL[1], bottom - 3, P);
  const feet = (x0, x1, y, kind, near) => {
    if (kind) { q.rect(x0 - (near ? 0 : 1), y, x1 + (near ? 2 : 0), bottom, S); }
    else { q.rect(x0, y, x1 + (near ? 1 : 0), bottom, K); }
  };
  feet(fL[0], fL[1], bottom - 2, shoes[0], false);
  feet(nL[0], nL[1], bottom - 2, shoes[1], true);
  shadePart(q, { [P]: PT, [S]: tones(SHOE, { cool: 0.15, lift: 0.22 }), [K]: SKT }, { wide: true });
  // the crease at the knee, the hem's shadow, the sole
  if (knee) { q.hl(fL[0] + 1, fL[1] - 1, top + 6, PT.sh); q.hl(nL[0] + 1, nL[1] - 1, top + 6, PT.sh); }
  for (const [x0, x1, kind, near] of [[fL[0], fL[1], shoes[0], false], [nL[0], nL[1], shoes[1], true]]) {
    if (kind) { q.hl(x0 - (near ? 0 : 1), x1 + (near ? 2 : 0), bottom, shade(SHOE, -0.4)); q.set(x0 + 1, bottom - 2, shade(SHOE, 0.35)); if (near) q.set(x1 + 1, bottom - 1, shade(SHOE, -0.25)); }
    else { for (let x = x0; x <= x1 + (near ? 1 : 0); x += 2) q.set(x, bottom, SKT.dk); } // toes
  }
  q.hl(fL[0], fL[1], bottom - 3, PT.dk); q.hl(nL[0], nL[1], bottom - 3, PT.dk); // hem shadows
  fray(q, fL[0], fL[1], bottom - 3, PT.base, PT.dk, rng); fray(q, nL[0], nL[1], bottom - 3, PT.base, PT.dk, rng);
  if (grime) { // mud up the shins and on the feet
    const M = mix(PT.dk, "#3a3020", 0.6);
    for (let i = 0; i < 3; i++) { const x = rng.int(fL[0], nL[1]), y = rng.int(bottom - 7, bottom - 3); q.over(x, y, M); q.over(x + 1, y, M); q.over(x, y + 1, M); }
    q.hl(fL[0] - 1, nL[1] + 2, bottom, mix(shade(SHOE, -0.2), "#3a3020", 0.4));
  }
  return q;
}
// Running legs: the back leg trailing, its foot lifted behind, the front leg striding to the ground.
function runLegsPart(L, R, PT, SKT, rng, shoes) {
  const q = part();
  const mid = Math.floor((L + R) / 2), top = 34;
  const P = "#020202", S = "#030303", K = "#040404";
  q.rect(L + 2, top, R - 2, top + 3, P);
  limb(q, L + 3, top + 1, L - 2, top + 8, 5, P); limb(q, L - 3, top + 8, L - 6, top + 12, 5, P); // back thigh, shin back and up
  limb(q, mid, top + 1, R + 2, top + 6, 6, P); limb(q, R + 2, top + 6, R + 3, top + 13, 5, P); // front thigh forward, shin down
  if (shoes[0]) q.rect(L - 8, top + 12, L - 3, top + 14, S); else q.rect(L - 7, top + 13, L - 3, top + 14, K);
  if (shoes[1]) q.rect(R + 2, 48, R + 8, 50, S); else q.rect(R + 3, 48, R + 7, 50, K);
  shadePart(q, { [P]: PT, [S]: tones(SHOE, { cool: 0.15, lift: 0.22 }), [K]: SKT }, { wide: true });
  if (shoes[1]) { q.hl(R + 2, R + 8, 50, shade(SHOE, -0.4)); q.set(R + 3, 48, shade(SHOE, 0.35)); }
  if (shoes[0]) { q.hl(L - 8, L - 3, top + 14, shade(SHOE, -0.4)); q.set(L - 7, top + 12, shade(SHOE, 0.35)); }
  q.hl(mid + 3, R + 1, top + 6, PT.sh); q.hl(L - 2, L + 1, top + 8, PT.sh); // the knees
  fray(q, L - 5, L - 1, top + 11, PT.base, PT.dk, rng); fray(q, R + 2, R + 6, 47, PT.base, PT.dk, rng);
  return q;
}
// The torso: a shirt (t-shirt, jacket, flannel, hoodie, tank) over the skin, a belt, a collar showing the neck.
function torsoPart(L, R, CT, SKT, style, rng, o = {}) {
  const { top = 20, bottom = 33, lean = 0 } = o;
  const q = part();
  const C = "#050505", K = "#060606";
  const mid = Math.floor((L + R) / 2);
  for (let y = top; y <= bottom; y++) { const dx = Math.round(lean * (bottom - y) / (bottom - top)); q.hl(L + dx, R + dx, y, C); }
  // shoulders rounded
  q.clear(L, top); q.clear(R, top); q.clear(L + 1, top); q.clear(R - 1, top); q.clear(L, top + 1); q.clear(R, top + 1);
  if (style === "tank") { q.rect(L + 3, top, R - 3, top + 1, K); q.rect(L + 1, top + 2, L + 2, top + 5, K); q.rect(R - 2, top + 2, R - 1, top + 5, K); }
  else q.rect(mid - 2, top, mid + 2, top, K); // the collar
  shadePart(q, { [C]: CT, [K]: SKT }, { wide: true });
  const sh = CT.sh, dk = CT.dk, hi = CT.hi;
  if (style === "jacket") {
    q.vl(mid + 1, top, bottom, dk); q.vl(mid + 2, top + 1, bottom, sh); // open front
    q.rect(mid - 1, top + 1, mid, top + 2, hi); q.rect(mid + 3, top + 1, mid + 4, top + 2, hi); // lapels
    q.rect(mid - 1, top + 3, mid + 1, top + 5, SKT.sh); q.rect(mid, top + 6, mid + 1, top + 9, SKT.base); // chest in the gap
    q.set(L + 3, top + 10, dk); q.set(L + 4, top + 10, dk); q.rect(L + 2, top + 9, L + 5, top + 9, sh); // a pocket
  } else if (style === "hoodie") {
    q.rect(L + 2, top - 1, R - 2, top + 1, dk); q.rect(L + 3, top - 1, R - 3, top - 1, sh); // the hood's bunch
    q.rect(mid + 1, top + 4, mid + 1, top + 6, mix(CT.base, "#e6e2d8", 0.5)); q.rect(mid - 2, top + 4, mid - 2, top + 6, mix(CT.base, "#e6e2d8", 0.5)); // the cords
    q.rect(mid - 2, top + 9, mid + 3, top + 12, sh); q.hl(mid - 2, mid + 3, top + 9, dk); // the pouch
  } else if (style === "flannel") {
    for (let y = top; y <= bottom; y++) for (let x = L; x <= R; x++) if (q.get(x, y) && (((y - top) % 5 === 1) || ((x - L) % 5 === 2))) q.set(x, y, mix(q.get(x, y), dk, 0.75));
    q.vl(mid + 1, top + 1, bottom, dk); for (let y = top + 3; y <= bottom; y += 4) q.set(mid, y, "#d8d0bc"); // placket and buttons
  } else {
    q.rect(mid - 1, top + 1, mid + 1, top + 1, SKT.sh); // the t-shirt's neck
  }
  // the belt
  q.hl(L + 1, R - 1, bottom, "#2a2420"); q.hl(L + 1, R - 1, bottom - 1, "#3a3028"); q.rect(mid - 1, bottom - 1, mid + 1, bottom, "#8a7a48"); q.set(mid, bottom - 1, "#c4b070");
  return q;
}
// Tears in the shirt: bites out of the hem, holes with skin and the odd rib behind, hanging strips.
function tearShirt(p, L, R, top, bottom, CT, SKT, level, rng, gore) {
  const holes = level === "intact" ? 1 : level === "rags" ? 7 : 3;
  for (let i = 0; i < holes; i++) {
    const x = rng.int(L + 1, R - 3), y = rng.int(top + 2, bottom - 4), w = rng.int(1, level === "rags" ? 4 : 2), h = rng.int(1, 2);
    for (let yy = y; yy <= y + h; yy++) for (let xx = x; xx <= x + w; xx++) if (p.get(xx, yy)) p.set(xx, yy, yy === y ? SKT.sh : SKT.base);
    p.over(x + w + 1, y, CT.dk); p.over(x, y + h + 1, CT.dk); // the hole's rim
  }
  // the hem
  if (level !== "intact") {
    for (let x = L; x <= R; x++) {
      const r = rng.next();
      if (r < 0.25) { p.over(x, bottom - 2, SKT.base); p.over(x, bottom - 3, SKT.sh); if (level === "rags") p.over(x, bottom - 4, SKT.base); }
      else if (r < 0.4) { p.over(x, bottom - 2, CT.dk); }
    }
    if (level === "rags") { // hanging strips below the belt
      for (const x of [L + 2, L + 6, R - 4]) { p.over(x, bottom + 1, CT.sh); p.over(x, bottom + 2, CT.dk); p.over(x + 1, bottom + 1, CT.base); }
    }
  }
  if (gore >= 2 || level === "rags") ribs(p, L + 2, top + 4, 4, 3, SKT);
}

// Arms. Reaching: both arms toward the facing side, the far one above the near one, a sleeve to the elbow and the
// forearm bare, hands with spread fingers. Hanging: at the sides.
function armsPart(L, R, CT, SKT, style, pose, rng, o = {}) {
  const q = part();
  const { lost = false, top = 21, droop = 1, sleeve = style !== "tshirt" && style !== "tank" } = o;
  const S = "#070707", K = "#080808";
  const hand = (x, y, dir, up) => { // a hand with three fingers, reaching
    if (dir > 0) { q.rect(x, y, x + 2, y + 3, K); q.hl(x + 3, x + 4, y, K); q.hl(x + 3, x + 4, y + 2, K); q.set(x + 3, y + 3, K); q.set(x + 2, y - 1, K); }
    else { q.rect(x, y, x + 3, y + 3, K); q.set(x, y + 4, K); q.set(x + 2, y + 4, K); q.set(x + 3, y + 4, K); }
  };
  if (pose === "reach") {
    const arm = (y, len, near, lostOne) => {
      const sx = R - 4, ex = R + len, ey = y + droop + (near ? 1 : 0);
      limb(q, sx, y, R + 2, y, 4, sleeve || style === "tank" ? (style === "tank" ? K : S) : S); // upper arm (sleeve or short sleeve)
      if (!sleeve) { limb(q, sx, y, R + 1, y, 4, S); }
      if (lostOne) { limb(q, R + 2, y, R + 5, ey, 4, K); return [R + 5, ey]; }
      limb(q, R + 2, y, ex - 3, ey, 4, K); // forearm
      hand(ex - 3, ey, 1, near);
      return null;
    };
    const stump = arm(top, 13, false, lost);
    arm(top + 5, 11, true, false);
    // the far arm's shoulder
    q.rect(L - 1, top, L + 2, top + 4, S);
    shadePart(q, { [S]: CT, [K]: SKT });
    // the sleeve's torn end over the forearm
    for (const y of [top, top + 5]) { q.set(R + 2, y + 3, CT.dk); q.set(R + 3, y + 1, CT.dk); q.set(R + 2, y, CT.sh); }
    if (stump) { q.rect(stump[0] - 1, stump[1], stump[0], stump[1] + 3, BLOOD.rim); q.vl(stump[0], stump[1] + 1, stump[1] + 2, BLOOD.core); q.set(stump[0] - 1, stump[1] + 1, BONE.base); }
    return q;
  }
  if (pose === "swing") { // running: the far arm driven back, the near arm pumping forward
    limb(q, L + 1, top, L - 3, top + 8, 4, S); limb(q, L - 3, top + 8, L - 8, top + 10, 4, K); q.rect(L - 11, top + 9, L - 8, top + 12, K); q.set(L - 12, top + 10, K); q.set(L - 12, top + 12, K); q.set(L - 9, top + 13, K);
    limb(q, R - 3, top, R + 1, top + 6, 4, S); limb(q, R + 1, top + 6, R + 7, top + 1, 4, K); hand(R + 7, top, 1, true);
    shadePart(q, { [S]: CT, [K]: SKT });
    q.set(L - 3, top + 8, CT.dk); q.set(R + 1, top + 6, CT.dk); // the sleeves' ends
    return q;
  }
  // hanging
  for (const [x0, far] of [[L - 4, true], [R + 1, false]]) {
    const len = far ? 12 : 13;
    q.rect(x0, top, x0 + 3, top + (sleeve ? 7 : 2), S);
    q.rect(x0, top + (sleeve ? 8 : 3), x0 + 3, top + len, K);
    hand(x0, top + len + 1, -1, !far);
  }
  shadePart(q, { [S]: CT, [K]: SKT });
  return q;
}

// ---------- the four kinds ----------
export function paintZombieHD(variant, seed, look = DEFAULT_LOOK) {
  const Z = zombieLookOf(variant, seed, look);
  const { rng, skin, cloth, pants, gore, eye: eyeCol, build, style } = Z;
  const eyeKind = look.eyes === "dead" ? "dead" : look.eyes === "red" || variant === "runner" ? "red" : "glow";
  const p = part();
  const SKT = tones(skin), CT = tones(cloth, { cool: 0.14 }), PT = tones(pants, { cool: 0.14 });
  const [L, R] = LR(BUILD_W[build]);
  const hair = variant === "walker" && rng.chance(0.5) ? shade(rng.pick(["#3b2a1e", "#6b6b6b", "#8a6a3a"]), -0.3) : null;
  const hairLong = hair && rng.chance(0.6);
  const shoes = [rng.chance(0.85), rng.chance(0.85)];
  if (variant === "bloated") return bloated(p, Z, SKT, CT, PT, L, R, look, eyeKind, shoes);
  if (variant === "brute") return brute(p, Z, SKT, CT, PT, L, R, look, eyeKind, shoes);
  const run = variant === "runner";
  const pose = run ? (rng.chance(0.5) ? "reach" : "swing") : "reach";
  const lost = pose === "reach" && rng.chance(0.25);
  const tilt = variant === "walker" ? rng.pick([-1, 0, 0, 1]) * 2 : 2;
  const lean = run ? 4 : 0;
  // back to front: far arm, legs, torso, near arm, head
  const arms = armsPart(L, R, CT, SKT, style, pose, rng, { lost, top: 21 - (run ? 1 : 0) });
  stamp(p, run ? runLegsPart(L, R, PT, SKT, rng, shoes) : legsPart(L, R, PT, SKT, rng, { shoes }), 0, 0, 0);
  const torso = torsoPart(L, R, CT, SKT, style, rng, { lean });
  stamp(p, torso, 0, 0);
  tearShirt(p, L + (run ? 2 : 0), R + (run ? 2 : 0), 20, 33, CT, SKT, look.clothes, rng, gore);
  stamp(p, arms, run ? 3 : 0, 0);
  // neck
  const nx = 18 + tilt + lean; p.rect(nx, 15, nx + 5, 20, SKT.sh); p.vl(nx + 5, 15, 20, SKT.dk);
  const headO = { jawDrop: run ? 3 : rng.pick([1, 2, 2, 3]), cheek: gore > 0 && rng.chance(0.35), scalp: rng.chance(0.4), hair, hairLong, teethBlood: gore > 0 && rng.chance(0.6) };
  const hd = headPart(SKT, eyeCol, eyeKind, headO);
  stamp(p, hd.q, 12 + tilt + lean, (run ? 5 : 3) - hd.y0);
  // grime: dark blotches on the clothes
  for (let i = 0; i < 3; i++) { const x = rng.int(L + 1, R - 2), y = rng.int(22, 46); const u = p.get(x, y); if (!u || u === SKT.base) continue; const g = mix(shade(u, -0.3), "#2a2418", 0.5); p.set(x, y, g); p.over(x + 1, y, g); if (rng.chance(0.5)) p.over(x, y + 1, g); }
  // wounds and blood
  const wounds = gore === 0 ? 0 : gore === 1 ? rng.int(2, 3) : rng.int(5, 8);
  for (let i = 0; i < wounds; i++) {
    const x = rng.int(L - 2, R + 6), y = rng.int(6, 44);
    if (!p.get(x, y)) continue;
    wound(p, x, y, rng.pick([1, 2, 2, 3]), rng);
  }
  if (gore > 1) { wound(p, L + 3, 40, 3, rng, { fresh: true }); for (let x = L + 1; x <= L + 5; x++) p.over(x, 50, BLOOD.rim); p.over(R + 9, 29, BLOOD.fresh); p.over(R + 10, 29, BLOOD.fresh); }
  return p;
}

// A sheen on a rounded form: a crescent of highlight toward the upper left, a sharp specular in it.
function sheen(q, cx, cy, rx, ry, hi, spec) {
  for (let y = Math.floor(cy - ry); y <= cy; y++) for (let x = Math.floor(cx - rx); x <= cx; x++) {
    const nx = (x - cx) / rx, ny = (y - cy) / ry, d = Math.hypot(nx, ny);
    if (d > 0.62 && d < 0.84 && nx < -0.15 && ny < -0.1 && q.get(x, y)) q.set(x, y, hi);
  }
  const sx = Math.round(cx - rx * 0.5), sy = Math.round(cy - ry * 0.55);
  q.over(sx, sy, spec); q.over(sx + 1, sy, mix(spec, hi, 0.5)); q.over(sx, sy + 1, mix(spec, hi, 0.5));
}

// Bloated: a swollen oval body, the shirt burst open in two flaps over a shiny belly, pustules, a split down the
// middle, swollen arms, short legs under the weight, a small head sunk on it.
function bloated(p, Z, SKT, CT, PT, L, R, look, eyeKind, shoes) {
  const { rng, gore, eye: eyeCol } = Z;
  stamp(p, legsPart(L + 3, R - 3, PT, SKT, rng, { shoes, top: 38, knee: false }), 0, 0, 0);
  const body = part();
  const K = "#060606", C = "#050505";
  const cx = 20.5, cy = 29, rx = 13.5, ry = 10.5;
  body.ellipse(cx, cy, rx, ry, K);
  body.rect(L + 4, 20, R - 4, 22, K); body.rect(L + 2, 21, R - 2, 24, K); // the shoulders
  // the shirt: two flaps following the body's curve, pulled apart over the belly
  for (let y = 20; y <= 37; y++) {
    const gap = y < 24 ? 5 : y < 27 ? 8 : y < 33 ? 11 : 9; // half the opening
    for (let x = 0; x < W; x++) if (body.get(x, y) && Math.abs(x - cx) > gap) body.set(x, y, C);
  }
  shadePart(body, { [K]: SKT, [C]: CT }, { wide: true, soft: true });
  sheen(body, cx, cy + 1, rx - 2, ry - 1, SKT.hi, "#ffffff");
  for (let x = 12; x <= 29; x++) { const d = Math.abs(x - cx) / rx; if (body.get(x, 38) && d < 0.8) body.set(x, 38, SKT.dk); if (body.get(x, 37) && d < 0.6) body.set(x, 37, SKT.sh); } // the belly's underside
  // the flaps' torn edges, a popped button's thread
  for (let y = 21; y <= 37; y++) for (const side of [-1, 1]) { const x = Math.round(cx + side * ((y < 24 ? 5 : y < 27 ? 8 : y < 33 ? 11 : 9) + 0.5)); if (body.get(x, y) && (y % 3 === 0)) body.set(x, y, CT.dk); else if (body.get(x, y) && (y % 3 === 1)) body.set(x, y, CT.sh); }
  body.over(13, 29, "#d8d0bc"); body.over(29, 31, "#d8d0bc");
  // the split: a seam down the belly with a red rim, something glistening inside
  const sx = 22;
  body.vl(sx, 26, 36, BLOOD.rim); body.vl(sx + 1, 27, 35, BLOOD.core); body.vl(sx + 2, 28, 35, BLOOD.rim); body.set(sx + 1, 30, "#b04a5a"); body.set(sx + 1, 33, "#7a2e3a"); body.set(sx + 1, 36, BLOOD.rim);
  // pustules: a yellow dome with a glint, a sore ring round it
  for (const [x, y] of [[15, 31], [18, 35], [26, 25], [29, 33], [17, 27], [25, 38]]) { if (!body.get(x, y)) continue; body.rect(x, y, x + 1, y + 1, PUS.base); body.set(x, y, PUS.hi); body.set(x + 1, y + 1, PUS.dk); for (const [dx, dy] of [[2, 0], [2, 1], [-1, 0], [-1, 1], [0, 2], [1, 2], [0, -1], [1, -1]]) body.over(x + dx, y + dy, mix(body.get(x + dx, y + dy) || SKT.base, "#8a4a3a", 0.35)); }
  stamp(p, body, 0, 0);
  // arms: swollen, hanging, the hands puffy
  const arms = part();
  const S = "#070707";
  arms.rect(L - 4, 22, L, 28, S); arms.rect(L - 4, 29, L, 38, K); arms.rect(L - 4, 39, L, 42, K); arms.set(L - 4, 43, K); arms.set(L - 2, 43, K); arms.set(L, 43, K);
  arms.rect(R + 1, 23, R + 5, 29, S); arms.rect(R + 1, 30, R + 5, 39, K); arms.rect(R + 1, 40, R + 5, 43, K); arms.set(R + 2, 44, K); arms.set(R + 4, 44, K); arms.set(R + 5, 44, K);
  shadePart(arms, { [S]: CT, [K]: SKT });
  arms.hl(L - 3, L - 1, 39, SKT.sh); arms.hl(R + 2, R + 4, 40, SKT.sh); // the wrists' crease
  stamp(p, arms, 0, 0);
  // neck and head: small, sunk between the shoulders
  p.rect(18, 17, 23, 21, SKT.sh);
  const hd = headPart(SKT, eyeCol, eyeKind, { jawDrop: 2, size: 12, teethBlood: gore > 0, scalp: rng.chance(0.5) });
  stamp(p, hd.q, 13, 6);
  const wounds = gore === 0 ? 0 : gore === 1 ? 2 : 5;
  for (let i = 0; i < wounds; i++) { const x = rng.int(L - 2, R + 4), y = rng.int(8, 46); if (p.get(x, y)) wound(p, x, y, rng.pick([1, 2]), rng); }
  if (gore > 1) { for (let y = 37; y <= 40; y++) p.over(sx + 1, y, BLOOD.dry); p.over(sx + 1, 41, BLOOD.rim); p.over(sx, 42, BLOOD.rim); }
  return p;
}

// Brute: a massive hunched body of muscle slabs, the head sunk between the shoulders, arms like legs with fists at
// the knees, bound in chains or rebar, rags round the waist.
function brute(p, Z, SKT, CT, PT, L, R, look, eyeKind, shoes) {
  const { rng, gore, eye: eyeCol } = Z;
  const chainKind = rng.pick(["chain", "rebar", "rags"]);
  stamp(p, legsPart(L + 2, R - 2, PT, SKT, rng, { shoes: [shoes[0], shoes[0]], top: 37, knee: true, apart: 1 }), 0, 0, 0);
  // the torso: shoulders sloping up to the traps, the chest a wall
  const body = part();
  const K = "#060606";
  body.rect(L + 6, 16, R - 6, 16, K);
  body.rect(L + 3, 17, R - 3, 17, K);
  body.rect(L + 1, 18, R - 1, 19, K);
  body.rect(L, 20, R, 37, K);
  body.rect(L + 1, 38, R - 1, 39, K);
  shadePart(body, { [K]: SKT }, { wide: true, soft: true });
  // slabs of muscle: each a block lit on its top and left, dark on its bottom and right, rounded at the bottom corners
  body.rect(L + 2, 21, R - 2, 37, SKT.sh); // the channels between the slabs lie in shadow
  const sl = (x0, y0, x1, y1) => {
    body.rect(x0, y0, x1, y1, SKT.base); body.hl(x0 + 1, x1 - 1, y0, SKT.hi); body.vl(x0, y0 + 1, y1 - 1, SKT.hi);
    body.hl(x0 + 1, x1, y1, SKT.dk); body.vl(x1, y0 + 1, y1 - 1, SKT.sh); body.set(x0, y1, SKT.sh); body.set(x1, y0, SKT.sh);
    body.hl(x0 + 1, x1, y1 + 1, SKT.dk); // the crease below
  };
  sl(L + 3, 22, 19, 29); sl(22, 22, R - 3, 29);              // the pecs
  sl(L + 6, 31, 19, 33); sl(22, 31, R - 6, 33); sl(L + 7, 35, 19, 37); sl(22, 35, R - 7, 37); // the abs
  body.vl(20, 21, 37, SKT.dk); body.vl(21, 21, 37, SKT.dk); // the sternum's crease
  body.rect(L + 2, 20, L + 3, 23, SKT.hi); body.rect(R - 3, 19, R - 2, 23, SKT.sh); // the deltoids
  stamp(p, body, 0, 0);
  // arms: thick, hanging, the fists at the knees
  const arms = part();
  for (const x0 of [L - 6, R + 1]) { arms.rect(x0, 20, x0 + 5, 37, K); arms.rect(x0 - 1, 37, x0 + 6, 43, K); }
  shadePart(arms, { [K]: SKT }, { wide: true });
  for (const x0 of [L - 6, R + 1]) { arms.hl(x0, x0 + 4, 30, SKT.sh); arms.hl(x0 - 1, x0 + 5, 39, SKT.dk); arms.set(x0, 40, SKT.hi); arms.set(x0 + 2, 40, SKT.hi); arms.set(x0 + 4, 40, SKT.hi); arms.hl(x0, x0 + 5, 21, SKT.hi); } // the elbow, the knuckles, the shoulder's light
  stamp(p, arms, 0, 0);
  // the head, sunk between the shoulders: its jaw over the chest
  const hd = headPart(SKT, eyeCol, eyeKind, { jawDrop: 1, size: 13, scalp: rng.chance(0.7), teethBlood: gore > 0 });
  stamp(p, hd.q, 13, 4);
  // bindings
  const IRON = tones("#6d7378", { cool: 0.2, lift: 0.3 }), RUST = "#7a4a30";
  if (chainKind === "chain") {
    for (let i = 0; i < 14; i++) { const x = L + 1 + i * 2, y = 21 + Math.round(i * 1.15); p.over(x, y, i % 2 ? IRON.hi : IRON.sh); p.over(x + 1, y, i % 2 ? IRON.base : IRON.dk); p.over(x, y + 1, i % 2 ? IRON.dk : IRON.base); }
    p.over(R - 1, 37, IRON.base); p.over(R, 38, IRON.sh); p.over(R - 1, 39, IRON.base); p.over(R + 1, 40, IRON.dk);
  } else if (chainKind === "rebar") {
    for (let i = 0; i < 22; i++) { const x = R - 2 - i, y = 14 + Math.round(i * 0.85); p.over(x, y, RUST); p.over(x, y + 1, shade(RUST, -0.35)); if (i % 3 === 0) p.over(x, y - 1, shade(RUST, 0.2)); }
    p.set(R - 1, 13, RUST); p.set(R, 12, shade(RUST, 0.2)); p.set(R - 1, 14, shade(RUST, -0.35)); p.set(R + 1, 11, RUST);
    wound(p, R - 4, 17, 2, rng); wound(p, L + 1, 33, 2, rng, { streak: true });
  } else {
    for (let x = L + 1; x <= R - 1; x++) { const y = 30 + ((x * 3) % 2); p.over(x, y, CT.base); p.over(x, y + 1, CT.sh); if (x % 5 === 0) p.over(x, y + 2, CT.dk); }
  }
  // rags round the waist
  p.rect(L + 1, 38, R - 1, 39, PT.base); p.hl(L + 1, R - 1, 39, PT.dk); for (let x = L + 1; x <= R - 1; x += 3) p.over(x, 40, PT.sh);
  const wounds = gore === 0 ? 0 : gore === 1 ? 3 : 7;
  for (let i = 0; i < wounds; i++) { const x = rng.int(L - 5, R + 5), y = rng.int(8, 46); if (p.get(x, y)) wound(p, x, y, rng.pick([1, 2, 3]), rng); }
  if (gore > 1) { ribs(p, R - 8, 24, 5, 3, SKT); for (let y = 39; y <= 42; y++) p.over(R + 3, y, BLOOD.dry); }
  return p;
}

// ---------- the armoured dead (sim/deadsoldiers.js) ----------
export const CAMO = ["#55603b", "#3e4630", "#6b6a4a", "#4a3f2c"];
// Camouflage: blobs of the four camo tones on a coarse grid, each shaded with the form it is on.
function camoFill(q, x0, y0, x1, y1, seed) {
  const h = (a, b) => { let n = (a * 374761393 + b * 668265263 + seed * 97) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) % 7; };
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const v = h(Math.floor(x / 3), Math.floor(y / 2)); q.set(x, y, CAMO[v < 3 ? 0 : v < 5 ? 1 : v < 6 ? 2 : 3]); }
}
const camoMap = () => Object.fromEntries(CAMO.map((c) => [c, tones(c, { cool: 0.16 })]));

export function paintArmoredDeadHD(kind, seed, look = DEFAULT_LOOK) {
  const Z = zombieLookOf("walker", seed, look);
  const { rng, skin, gore, eye: eyeCol } = Z;
  const eyeKind = look.eyes === "dead" ? "dead" : look.eyes === "red" ? "red" : "glow";
  const SKT = tones(skin);
  const p = part();
  if (kind === "riot") {
    const [L, R] = LR(BUILD_W.heavy);
    const UNI = tones("#23262d", { cool: 0.3, lift: 0.25 }), SHELL = tones("#3f434b", { cool: 0.25, lift: 0.3 }), GUARD = tones("#2e3137", { cool: 0.25, lift: 0.3 });
    const legs = legsPart(L, R, UNI, SKT, rng, { shoes: [true, true], grime: true });
    // shin guards: hard plates over the shins
    const mid = Math.floor((L + R) / 2);
    for (const [x0, x1] of [[L + 2, mid - 1], [mid + 1, R - 2]]) { legs.rect(x0, 40, x1, 46, GUARD.base); legs.hl(x0, x1, 40, GUARD.hi); legs.vl(x0, 40, 46, GUARD.hi); legs.vl(x1, 41, 46, GUARD.dk); legs.hl(x0, x1, 46, GUARD.dk); legs.hl(x0 + 1, x1 - 1, 43, GUARD.sh); }
    stamp(p, legs, 0, 0, 0);
    const torso = torsoPart(L, R, UNI, SKT, "jacket", rng);
    // the chest shell: three hard segments, each lit along its top
    torso.rect(L + 2, 21, R - 2, 32, SHELL.base);
    for (const [y0, y1] of [[21, 24], [25, 28], [29, 32]]) { torso.hl(L + 2, R - 2, y0, SHELL.hi); torso.hl(L + 3, R - 2, y1, SHELL.dk); torso.vl(R - 2, y0, y1, SHELL.dk); torso.vl(R - 3, y0 + 1, y1 - 1, SHELL.sh); torso.vl(L + 2, y0 + 1, y1 - 1, SHELL.hi); }
    torso.rect(L + 4, 26, L + 5, 27, SHELL.dk); torso.rect(R - 6, 30, R - 5, 31, SHELL.dk); // buckles
    torso.hl(L + 1, R - 1, 33, "#1a1c20");
    stamp(p, torso, 0, 0);
    const arms = armsPart(L, R, UNI, UNI, "jacket", "reach", rng, { sleeve: true });
    // the forearm guards and gloves on the reaching arms: hard plates over black sleeves
    for (const y of [21, 26]) { arms.rect(R + 3, y, R + 7, y + 3, GUARD.base); arms.hl(R + 3, R + 7, y, GUARD.hi); arms.hl(R + 3, R + 7, y + 3, GUARD.dk); arms.vl(R + 7, y, y + 3, GUARD.dk); }
    for (let y = 20; y <= 33; y++) for (let x = R + 8; x < W; x++) if (arms.get(x, y)) arms.set(x, y, mix(arms.get(x, y), "#1a1c20", 0.3)); // gloves
    stamp(p, arms, 0, 0);
    // shoulder pads
    const pads = part();
    pads.rect(L - 3, 19, L + 3, 22, "#010101"); pads.rect(L - 2, 23, L + 2, 23, "#010101");
    pads.rect(R - 3, 19, R + 3, 22, "#010101"); pads.rect(R - 2, 23, R + 2, 23, "#010101");
    shadePart(pads, { "#010101": SHELL });
    stamp(p, pads, 0, 0);
    // the head, the helmet, the visor pushed up and cracked
    p.rect(18, 15, 23, 20, SKT.sh);
    const hd = headPart(SKT, eyeCol, eyeKind, { jawDrop: 2, teethBlood: gore > 0 });
    stamp(p, hd.q, 12, 3 - hd.y0);
    const hel = part();
    const HB = "#010101";
    hel.rect(16, 0, 25, 0, HB); hel.rect(14, 1, 27, 1, HB); hel.rect(13, 2, 29, 7, HB); hel.rect(13, 8, 13, 10, HB); hel.rect(28, 8, 29, 9, HB); // the shell
    shadePart(hel, { [HB]: tones("#1c1e22", { cool: 0.35, lift: 0.4 }) }, { wide: true });
    hel.hl(14, 29, 7, "#0f1013"); // the rim
    // the visor, pushed up onto the helmet's front: a pale plate with a glint and a crack
    const V = "#9fb4c4";
    hel.rect(16, 3, 31, 6, V); hel.hl(16, 31, 3, "#d6e4ee"); hel.rect(17, 4, 19, 4, "#eaf3f8"); hel.hl(17, 31, 6, "#5f7484"); hel.vl(31, 3, 6, "#5f7484");
    hel.set(25, 4, "#3a4a56"); hel.set(26, 5, "#3a4a56"); hel.set(24, 5, "#3a4a56"); hel.set(27, 6, "#3a4a56"); hel.set(26, 4, "#c8d8e2"); // the crack
    hel.rect(13, 11, 13, 13, "#1c1e22"); hel.set(14, 14, "#1c1e22"); hel.set(14, 15, "#2a2d33"); // the strap
    stamp(p, hel, 0, 0);
    const wounds = gore === 0 ? 0 : gore === 1 ? 2 : 5;
    for (let i = 0; i < wounds; i++) { const x = rng.int(L - 2, R + 10), y = rng.int(8, 46); if (p.get(x, y)) wound(p, x, y, rng.pick([1, 2]), rng); }
    return p;
  }
  // the soldier
  const [L, R] = LR(BUILD_W.average);
  const CM = camoMap(), CT0 = tones(CAMO[0], { cool: 0.16 });
  const CARRIER = tones(rng.pick(["#6b6a4a", "#5b5a40", "#7a6a48"]), { cool: 0.12 });
  const legs = legsPart(L, R, CT0, SKT, rng, { shoes: [true, true], grime: true });
  const mid = Math.floor((L + R) / 2);
  const lm = part(); camoFill(lm, 0, 0, W - 1, H - 1, seed); // camo laid over the trousers
  for (let y = 34; y <= 44; y++) for (let x = L; x <= R; x++) { const u = legs.get(x, y); if (u) legs.set(x, y, mix(lm.get(x, y), u, 0.45)); }
  // boots: tall, laced
  const BT = tones("#2a2620", { cool: 0.2, lift: 0.3 });
  for (const [x0, x1, near] of [[L + 2, mid - 1, false], [mid + 1, R - 2, true]]) { legs.rect(x0, 44, x1 + (near ? 2 : 0), 50, BT.base); legs.vl(x0, 44, 49, BT.hi); legs.hl(x0, x1 + (near ? 2 : 0), 50, BT.dk); legs.vl(x1 + (near ? 2 : 0), 44, 50, BT.dk); for (let y = 45; y <= 48; y += 1) legs.set(x0 + 2 + (y % 2), y, BT.hi); legs.hl(x0 + 1, x1 - 1, 44, BT.sh); }
  stamp(p, legs, 0, 0, 0);
  const torso = part();
  const C = "#050505";
  for (let y = 20; y <= 33; y++) torso.hl(L, R, y, C); torso.clear(L, 20); torso.clear(R, 20); torso.clear(L + 1, 20); torso.clear(R - 1, 20); torso.clear(L, 21); torso.clear(R, 21);
  const tm = part(); camoFill(tm, 0, 0, W - 1, H - 1, seed + 3);
  for (let y = 20; y <= 33; y++) for (let x = L; x <= R; x++) if (torso.get(x, y)) torso.set(x, y, tm.get(x, y));
  shadePart(torso, CM, { wide: true });
  // the plate carrier: the plate, the cummerbund, three pouches with flaps, molle rows, the shoulder straps
  torso.rect(L + 2, 21, R - 2, 31, CARRIER.base); torso.vl(L + 2, 21, 31, CARRIER.hi); torso.hl(L + 2, R - 2, 21, CARRIER.hi); torso.vl(R - 2, 21, 31, CARRIER.dk); torso.vl(R - 3, 22, 31, CARRIER.sh); torso.hl(L + 2, R - 2, 31, CARRIER.dk);
  for (const y of [23, 25]) { for (let x = L + 4; x <= R - 5; x += 2) torso.set(x, y, CARRIER.sh); }
  for (const x of [L + 3, mid - 2, R - 7]) { torso.rect(x, 27, x + 3, 30, CARRIER.sh); torso.hl(x, x + 3, 27, CARRIER.base); torso.hl(x, x + 3, 28, CARRIER.dk); torso.vl(x + 3, 28, 30, CARRIER.dk); torso.set(x + 1, 29, CARRIER.hi); }
  torso.rect(L + 3, 19, L + 4, 21, CARRIER.sh); torso.rect(R - 4, 19, R - 3, 21, CARRIER.sh); // the straps
  torso.rect(L + 3, 22, L + 4, 22, "#8a7a58"); // a patch
  torso.hl(L + 1, R - 1, 33, "#2a2420"); torso.hl(L + 1, R - 1, 32, "#3a3028"); torso.rect(mid - 1, 32, mid + 1, 33, "#6e6a60");
  stamp(p, torso, 0, 0);
  // the arms: camo sleeves, the near sleeve torn off at the shoulder, that arm bare, rotten and bitten
  const arms = armsPart(L, R, CT0, SKT, "jacket", "reach", rng, { sleeve: true });
  const am = part(); camoFill(am, 0, 0, W - 1, H - 1, seed + 7);
  for (let y = 20; y <= 25; y++) for (let x = L - 1; x <= R + 3; x++) { const u = arms.get(x, y); if (u) arms.set(x, y, mix(am.get(x, y), u, 0.45)); }
  for (let y = 26; y <= 31; y++) for (let x = R - 4; x <= R + 3; x++) { const u = arms.get(x, y); if (u) arms.set(x, y, y === 26 ? SKT.hi : x >= R + 2 ? SKT.base : SKT.base); }
  arms.set(R - 2, 26, CT0.dk); arms.set(R - 3, 27, CT0.sh); arms.set(R - 1, 27, CT0.dk); // the sleeve's torn end
  wound(arms, R + 6, 28, 3, rng, { streak: false }); arms.over(R + 5, 29, BLOOD.rim); arms.over(R + 8, 27, BONE.base);
  stamp(p, arms, 0, 0);
  // head and helmet
  p.rect(18, 15, 23, 20, SKT.sh);
  const hd = headPart(SKT, eyeCol, eyeKind, { jawDrop: rng.pick([1, 2, 3]), teethBlood: gore > 0, cheek: gore > 0 && rng.chance(0.5) });
  stamp(p, hd.q, 12, 3 - hd.y0);
  const HEL = tones(rng.pick(["#4f5a36", "#55603b", "#5b5a40"]), { cool: 0.16, lift: 0.22 });
  const hel = part(); const HB = "#010101";
  hel.rect(16, 0, 25, 0, HB); hel.rect(14, 1, 27, 1, HB); hel.rect(13, 2, 28, 6, HB); hel.rect(12, 7, 29, 7, HB); hel.rect(13, 8, 13, 9, HB); hel.rect(28, 8, 28, 8, HB);
  shadePart(hel, { [HB]: HEL }, { wide: true });
  const hm = part(); camoFill(hm, 0, 0, W - 1, H - 1, seed + 11);
  for (let y = 0; y <= 6; y++) for (let x = 13; x <= 28; x++) { const u = hel.get(x, y); if (u) hel.set(x, y, mix(hm.get(x, y), u, 0.6)); }
  hel.hl(12, 29, 7, HEL.dk); hel.hl(13, 28, 6, HEL.sh); hel.set(20, 1, HEL.hi); hel.set(21, 1, HEL.hi); hel.rect(15, 3, 16, 3, "#2a2a22"); // the rim, the cover's band, a scrape
  hel.rect(13, 10, 13, 15, "#2a2620"); hel.rect(14, 16, 15, 17, "#6e6a60"); hel.set(14, 15, "#2a2620"); // the chin strap hanging, its buckle
  stamp(p, hel, 0, 0);
  const wounds = gore === 0 ? 0 : gore === 1 ? 2 : 5;
  for (let i = 0; i < wounds; i++) { const x = rng.int(L - 2, R + 10), y = rng.int(8, 46); if (p.get(x, y)) wound(p, x, y, rng.pick([1, 2]), rng); }
  return p;
}

// ---------- the special dead (sim/zombietypes.js, hivesprites.js) ----------
const ACID = { base: "#9ad63a", hi: "#e2f8a0", sh: "#5f9a22", dk: "#3a6a14" };
const WORM = { base: "#f0e4c0", hi: "#fff8e0", sh: "#c4b48a", dk: "#8f8260", mouth: "#5c1e1a" };
const EGG = { base: "#e8dca0", hi: "#fff6c8", sh: "#b4a860", dk: "#857a40" };
const GRASS = ["#3f5f28", "#5f8a3a", "#4a6a30"];
// A worm: a short wriggle of 2-px segments from (x, y) heading dir (+1 right, -1 left), a dark mouth at the tip.
function worm(p, x, y, len, dir, up = 0) {
  for (let i = 0; i < len; i++) { const yy = y + (i % 3 === 1 ? -1 : 0) * 1 - Math.round(i * up); p.set(x + i * dir, yy, i % 2 ? WORM.base : WORM.hi); p.set(x + i * dir, yy + 1, WORM.sh); }
  p.set(x + len * dir, y - Math.round(len * up), WORM.mouth);
}
// Rings of a shriek round a point: dashed arcs at three radii.
function shriek(p, cx, cy, col, radii = [9, 13, 17], arc = [-150, -30]) {
  for (const r of radii) for (let a = arc[0]; a <= arc[1]; a += 6) {
    const t = a * Math.PI / 180, x = Math.round(cx + Math.cos(t) * r), y = Math.round(cy + Math.sin(t) * r * 0.8);
    if (Math.round(a / 6) % 3 !== 2 && x >= 1 && x < W - 1 && y >= 1) p.set(x, y, col);
  }
}
const grassTufts = (p, xs, y0, front = true) => { for (const x of xs) { const g = GRASS[x % 3]; p.vl(x, y0 - 3 - (x % 2), y0, g); p.vl(x + 1, y0 - 2, y0, GRASS[(x + 1) % 3]); p.set(x - 1, y0 - 1 - (x % 2), g); p.set(x + 2, y0 - 2, GRASS[(x + 2) % 3]); } };

function spitter() {
  const p = part();
  const rng = new Rng(11);
  const SKT = tones("#8ea36b"), CT = tones(desat("#4a4f44", 0.3), { cool: 0.14 });
  stamp(p, legsPart(14, 29, CT, SKT, rng, { shoes: [true, false], top: 38, knee: false }), 0, 0, 0);
  // the body, squat and swollen, leaning forward; the acid sac on its back
  const body = part(); const K = "#060606", C = "#050505";
  body.ellipse(21, 30, 11, 8.5, K); body.rect(15, 22, 30, 26, K);
  for (let y = 22; y <= 38; y++) for (let x = 0; x < W; x++) if (body.get(x, y) && (x > 27 || y < 25)) body.set(x, y, C); // the shirt's remnant over the shoulders and back
  shadePart(body, { [K]: SKT, [C]: CT }, { wide: true, soft: true });
  sheen(body, 20, 31, 9, 7, SKT.hi, mix(SKT.hi, "#ffffff", 0.6));
  stamp(p, body, 0, 0);
  const sac = part(); const A = "#070707";
  sac.ellipse(32, 19, 6.5, 8, A); sac.ellipse(28, 24, 4, 4, A);
  shadePart(sac, { [A]: ACID }, { wide: true, soft: true });
  sheen(sac, 32, 19, 5.5, 7, ACID.hi, "#f6ffd0");
  for (const [x0, y0, x1, y1] of [[29, 14, 33, 18], [34, 16, 36, 22], [30, 22, 33, 26]]) sac.line(x0, y0, x1, y1, ACID.dk); // veins
  sac.set(35, 13, ACID.sh); sac.set(36, 12, ACID.base); // the sac's nipple
  stamp(p, sac, 0, 0);
  // the near arm reaching down, the far arm on the ground
  const arms = part();
  limb(arms, 27, 26, 36, 32, 4, K); limb(arms, 36, 32, 37, 40, 4, K); arms.rect(36, 40, 40, 43, K); arms.set(41, 41, K); arms.set(41, 43, K);
  limb(arms, 11, 26, 6, 34, 4, K); arms.rect(4, 34, 8, 37, K); arms.set(3, 37, K);
  shadePart(arms, { [K]: SKT });
  stamp(p, arms, 0, 0);
  // the head thrust forward and down, the jaw wide, the throat swollen, acid running out
  const hd = headPart(SKT, "#e2e07a", "glow", { jawDrop: 4, size: 13, scalp: true });
  hd.q.flip();
  p.rect(14, 18, 20, 24, SKT.sh); p.rect(16, 20, 21, 25, SKT.base); // the neck craning forward
  stamp(p, hd.q, 1, 9);
  // acid in the mouth and dripping to the ground, a puddle
  p.rect(10, 22, 15, 23, ACID.base); p.hl(11, 14, 22, ACID.hi); p.set(16, 23, ACID.sh);
  for (const [x, y0, y1] of [[11, 24, 27], [13, 24, 31], [12, 29, 33]]) { for (let y = y0; y <= y1; y++) p.set(x, y, y === y1 ? ACID.hi : ACID.base); }
  p.set(13, 35, ACID.base); p.set(13, 36, ACID.hi); p.set(12, 40, ACID.sh); p.set(12, 41, ACID.base);
  p.ellipse(11, 50, 5, 1, ACID.sh); p.hl(8, 13, 50, ACID.base); p.set(9, 49, ACID.hi); p.set(12, 49, ACID.base);
  for (const [x, y] of [[20, 33], [25, 36], [30, 30]]) { p.over(x, y, ACID.dk); p.over(x + 1, y + 1, ACID.sh); } // acid burns on its own skin
  wound(p, 23, 28, 2, rng);
  p.flip(); // built with the head to the left; the dead face right
  return p;
}
function screamer() {
  const p = part();
  const rng = new Rng(12);
  const SKT = tones("#a7a69b"), CT = tones("#3d3d42", { cool: 0.2, lift: 0.3 });
  stamp(p, legsPart(16, 25, CT, SKT, rng, { shoes: [true, true], top: 34 }), 0, 0, 0);
  // a gaunt torso, the ribs under the skin, the shirt in rags round the waist
  const torso = part(); const K = "#060606", C = "#050505";
  torso.rect(16, 20, 26, 33, K); torso.rect(15, 21, 27, 24, K); torso.rect(16, 30, 26, 33, C); torso.clear(16, 20); torso.clear(26, 20);
  shadePart(torso, { [K]: SKT, [C]: CT }, { wide: true });
  for (const y of [23, 25, 27]) { torso.hl(17, 24, y, SKT.sh); torso.hl(17, 23, y + 1, SKT.hi); } // ribs
  torso.vl(21, 22, 29, SKT.dk);
  for (let x = 16; x <= 26; x++) if (x % 3 === 0) torso.set(x, 29, CT.dk); else if (x % 3 === 1) torso.set(x, 30, SKT.sh);
  stamp(p, torso, 0, 0);
  // arms flung back and out, hands splayed
  const arms = part();
  limb(arms, 16, 21, 8, 16, 4, K); limb(arms, 8, 16, 4, 8, 4, K); arms.rect(3, 4, 6, 7, K); arms.set(2, 3, K); arms.set(4, 3, K); arms.set(7, 4, K);
  limb(arms, 26, 21, 33, 16, 4, K); limb(arms, 33, 16, 37, 8, 4, K); arms.rect(36, 4, 39, 7, K); arms.set(35, 3, K); arms.set(38, 3, K); arms.set(40, 4, K);
  shadePart(arms, { [K]: SKT });
  stamp(p, arms, 0, 0);
  // the head thrown back: the face turned up, the mouth a gaping hole at the top
  const hd = part(); const S = "#010101";
  hd.rect(16, 7, 27, 18, S); hd.rect(17, 6, 26, 6, S); hd.rect(18, 5, 25, 5, S); hd.rect(17, 19, 24, 20, S); hd.rect(18, 21, 22, 21, S);
  shadePart(hd, { [S]: SKT }, { wide: true });
  hd.ellipse(23, 9.5, 3, 4, MOUTH); hd.set(20, 8, GUM); hd.vl(20, 8, 12, GUM);
  for (const [x, y] of [[21, 6], [23, 5], [25, 6], [26, 8], [26, 11], [24, 13], [22, 13]]) hd.set(x, y, TEETH); // teeth round the hole
  hd.set(23, 11, "#5c1210"); hd.set(22, 10, "#3a0c0c");
  eye(hd, 17, 12, "#e2412f", "red", SKT); hd.rect(17, 15, 20, 17, bruise(SKT)); hd.set(18, 16, "#e2412f"); hd.set(19, 16, "#e2412f"); // the other eye, lower
  hd.set(16, 9, SKT.dk); hd.rect(17, 20, 24, 20, SKT.dk);
  stamp(p, hd, 0, 0);
  p.rect(18, 19, 24, 20, SKT.sh); // the stretched throat
  shriek(p, 22, 9, "#c99ae0", [10, 14, 18], [-170, -10]);
  return p;
}
function crawler() {
  const p = part();
  const rng = new Rng(13);
  const SKT = tones("#9fb0b5"), CT = tones("#55603f", { cool: 0.14 });
  // a smear of blood where it dragged itself
  p.hl(26, 42, 49, mix(BLOOD.dry, "#3a3020", 0.4)); p.hl(30, 42, 50, BLOOD.dry); p.hl(34, 41, 48, mix(BLOOD.dry, "#3a3020", 0.6));
  // the body flat to the ground, the hips and what is left of the legs behind
  const body = part(); const K = "#060606", C = "#050505";
  body.rect(12, 38, 30, 46, C); body.rect(14, 36, 26, 38, C); body.rect(30, 40, 36, 46, C); body.rect(36, 42, 39, 46, K); body.rect(35, 41, 37, 42, C);
  shadePart(body, { [K]: SKT, [C]: CT }, { wide: true });
  body.hl(14, 28, 40, CT.hi); body.hl(31, 35, 42, CT.dk);
  body.rect(37, 42, 39, 46, SKT.sh); body.vl(40, 43, 45, BONE.base); body.set(41, 44, BONE.sh); body.rect(38, 42, 39, 43, BLOOD.rim); body.set(39, 44, BLOOD.core); body.rect(37, 45, 39, 46, BLOOD.rim); // the stump: bone out, torn
  for (const x of [15, 19, 23, 27]) { body.over(x, 46, CT.dk); body.over(x + 1, 45, SKT.base); } // the shirt in tatters underneath
  stamp(p, body, 0, 0, 0);
  // arms: the near one planted ahead, pulling; the far one reaching
  const arms = part();
  limb(arms, 14, 40, 4, 36, 4, K); arms.rect(1, 36, 5, 39, K); arms.set(0, 37, K); arms.set(0, 39, K); // far arm forward on the ground
  stamp(p, arms, 0, 0, 0);
  // the head low, raised to look ahead
  const hd = headPart(SKT, "#e2412f", "red", { jawDrop: 3, size: 13, scalp: true, teethBlood: true });
  hd.q.flip();
  stamp(p, hd.q, -2, 25);
  p.rect(12, 36, 17, 40, SKT.sh); // the neck
  const near = part();
  limb(near, 20, 42, 12, 46, 5, K); near.rect(6, 45, 12, 49, K); near.rect(4, 47, 6, 49, K); near.set(3, 49, K); near.set(8, 50, K); near.set(11, 50, K);
  shadePart(near, { [K]: SKT });
  near.hl(7, 11, 47, SKT.sh);
  stamp(p, near, 0, 0);
  wound(p, 25, 42, 2, rng, { streak: false }); wound(p, 18, 44, 1, rng, { streak: false });
  // grass it hides in: tufts in front of it
  grassTufts(p, [9, 17, 24, 31, 38], 50);
  p.hl(2, 41, 50, GRASS[2]); for (let x = 2; x <= 41; x += 5) p.set(x, 49, GRASS[0]);
  p.flip(); // built with the head to the left; the dead face right
  return p;
}
function shepherd() {
  const p = part();
  const rng = new Rng(14);
  const SKT = tones("#b9b4c8", { cool: 0.3 }), SH = tones("#5d5a66", { cool: 0.3, lift: 0.22 }), EYE = "#e8e2ff";
  // the shroud: a long robe from the hood to the ground, its hem ragged, the folds in shadow
  const robe = part(); const C = "#050505";
  robe.rect(15, 17, 27, 49, C); robe.rect(14, 20, 28, 49, C); robe.rect(13, 30, 29, 49, C); robe.rect(12, 42, 30, 49, C);
  shadePart(robe, { [C]: SH }, { wide: true, soft: true });
  for (const x of [17, 21, 25]) robe.vl(x, 24, 48, SH.dk); robe.vl(16, 30, 48, SH.hi); robe.vl(22, 26, 47, SH.sh); // folds
  for (let x = 12; x <= 30; x++) if (x % 3 === 1) robe.clear(x, 49); else if (x % 3 === 2) robe.set(x, 49, SH.dk); // the hem
  stamp(p, robe, 0, 0);
  // the near arm out to the crook, the far hand raised
  const arms = part(); const K = "#060606";
  limb(arms, 26, 23, 33, 26, 4, C); arms.rect(33, 26, 36, 30, K); arms.set(37, 27, K); arms.set(37, 29, K);
  limb(arms, 15, 23, 10, 17, 4, C); arms.rect(8, 12, 11, 16, K); arms.set(8, 11, K); arms.set(10, 11, K); arms.set(7, 13, K);
  shadePart(arms, { [C]: SH, [K]: SKT });
  stamp(p, arms, 0, 0);
  // the hood and the long pale face inside it
  const hd = headPart(SKT, EYE, "glow", { jawDrop: 1, size: 12 });
  stamp(p, hd.q, 14, 5);
  p.rect(16, 7, 17, 14, bruise(SKT)); p.rect(16, 7, 25, 7, bruise(SKT)); // the face deep in the hood
  for (const [x, y] of [[20, 11], [21, 11], [25, 11], [26, 11]]) p.set(x, y, EYE);
  for (const [x, y] of [[19, 11], [22, 11], [24, 11], [27, 11], [20, 12], [21, 12], [25, 12], [26, 12]]) p.set(x, y, mix(EYE, "#9a94ff", 0.6));
  const hood = part();
  hood.rect(14, 3, 27, 4, C); hood.rect(13, 5, 28, 8, C); hood.rect(12, 9, 15, 19, C); hood.rect(27, 9, 29, 16, C); hood.rect(16, 3, 25, 2, C); hood.rect(13, 17, 16, 19, C); hood.rect(26, 17, 28, 19, C);
  shadePart(hood, { [C]: SH }, { wide: true });
  hood.vl(15, 9, 18, SH.dk); hood.vl(27, 9, 15, SH.dk);
  stamp(p, hood, 0, 0);
  // the crook: a long bone staff with a curl at the top
  p.vl(36, 6, 50, BONE.base); p.vl(37, 7, 50, BONE.sh); p.rect(36, 5, 39, 5, BONE.base); p.rect(37, 4, 40, 4, BONE.base); p.set(41, 5, BONE.base); p.set(41, 6, BONE.sh); p.set(40, 7, BONE.sh); p.set(39, 3, BONE.hi);
  for (const y of [14, 24, 36]) p.set(36, y, BONE.dk);
  // its pull on the pack: pale motes drifting in
  for (const [x, y] of [[3, 6], [1, 14], [5, 22], [2, 31], [42, 20], [41, 33], [40, 12]]) p.set(x, y, mix(EYE, "#1b1e24", 0.3));
  return p;
}
function carrier() {
  const p = part();
  const rng = new Rng(15);
  const SKT = tones("#b8b494", { cool: 0.3 }), CT = tones("#5a5648", { cool: 0.15 });
  stamp(p, legsPart(14, 29, CT, SKT, rng, { shoes: [true, true], top: 40, knee: false }), 0, 0, 0);
  const body = part(); const K = "#060606";
  body.ellipse(21, 29, 14, 11.5, K); body.rect(14, 19, 28, 22, K);
  shadePart(body, { [K]: SKT }, { wide: true, soft: true });
  sheen(body, 21, 30, 12, 10, SKT.hi, "#f4f0dc");
  for (let x = 10; x <= 32; x++) { const d = Math.abs(x - 21) / 14; if (body.get(x, 40) && d < 0.7) body.set(x, 40, SKT.dk); if (body.get(x, 39) && d < 0.5) body.set(x, 39, SKT.sh); }
  const VEIN = mix(SKT.sh, "#4a5a3a", 0.5);
  for (const [x0, y0, x1, y1] of [[12, 25, 17, 30], [17, 30, 16, 36], [26, 22, 30, 28], [29, 31, 33, 35], [20, 36, 24, 39]]) body.line(x0, y0, x1, y1, VEIN); // veins under the skin
  // splits where the worms push out: slanted, the flesh inside
  const split = (x, y, w, slant) => { for (let i = 0; i <= w; i++) { const yy = y + Math.round(i * slant); body.set(x + i, yy - 1, BLOOD.rim); body.set(x + i, yy, i === 0 || i === w ? BLOOD.rim : BLOOD.core); body.set(x + i, yy + 1, BLOOD.rim); } body.set(x + 1, y + Math.round(slant), "#8a3a4a"); body.set(x + w - 1, y + Math.round((w - 1) * slant), "#7a2e3a"); };
  split(9, 31, 6, -0.3); split(23, 35, 7, 0.2); split(26, 23, 5, -0.4);
  for (let y = 24; y <= 32; y++) { const x = 20 + (y > 28 ? 1 : 0); body.set(x, y, BLOOD.core); body.set(x - 1, y, BLOOD.rim); body.set(x + 1, y, BLOOD.rim); } body.set(20, 27, "#9a3a4a"); body.set(21, 30, "#9a3a4a"); // the belly split open down the middle
  stamp(p, body, 0, 0);
  worm(p, 11, 30, 5, -1, 0.35); worm(p, 27, 36, 5, 1, -0.25); worm(p, 29, 23, 5, 1, 0.3); worm(p, 20, 29, 4, -1, 0.4); worm(p, 22, 26, 3, 1, -0.5);
  // stubby arms
  const arms = part();
  arms.rect(6, 24, 10, 36, K); arms.rect(5, 36, 10, 40, K); arms.set(4, 38, K);
  arms.rect(33, 25, 37, 36, K); arms.rect(33, 36, 38, 40, K); arms.set(39, 38, K);
  shadePart(arms, { [K]: SKT }, { wide: true });
  stamp(p, arms, 0, 0);
  // a small head sunk on the body, worms from the mouth
  p.rect(18, 15, 24, 20, SKT.sh);
  const hd = headPart(SKT, "#e8e07a", "glow", { jawDrop: 3, size: 11, scalp: true });
  stamp(p, hd.q, 15, 4);
  worm(p, 21, 17, 4, 1, -0.6); worm(p, 20, 18, 3, -1, -0.5);
  return p;
}
function swarm() {
  const p = part();
  // a low writhing mass: slime underneath, a bed of worms, raised heads
  p.ellipse(21, 47, 16, 3.2, "#5a4e36"); p.ellipse(21, 47.5, 13, 2, "#7a6a48"); p.hl(8, 34, 50, "#4a4030");
  const bed = part(); const K = "#060606";
  bed.ellipse(21, 44, 13, 4.5, K); bed.ellipse(16, 42, 6, 3, K); bed.ellipse(27, 41, 7, 3.5, K);
  shadePart(bed, { [K]: WORM }, { wide: true, soft: true });
  stamp(p, bed, 0, 0, 0.3);
  const rng = new Rng(16);
  for (let i = 0; i < 16; i++) { const x = 8 + ((i * 7) % 27), y = 40 + ((i * 5) % 7); if (p.get(x, y)) worm(p, x, y, 2 + (i % 3), i % 2 ? 1 : -1, (i % 4) * 0.15); }
  // raised heads: worms rearing up, each with its dark mouth
  for (const [x, h, lean] of [[11, 7, 1], [17, 10, -1], [23, 8, 1], [30, 11, -1], [35, 6, 1], [27, 5, 1]]) {
    for (let i = 0; i < h; i++) { const xx = x + Math.round(Math.sin(i * 0.9) * lean), yy = 41 - i; p.set(xx, yy, i % 2 ? WORM.base : WORM.hi); p.set(xx + 1, yy, WORM.sh); }
    const tx = x + Math.round(Math.sin(h * 0.9) * lean); p.set(tx, 41 - h, WORM.mouth); p.set(tx + 1, 41 - h, WORM.mouth); p.set(tx, 40 - h, WORM.sh);
  }
  for (const [x, y] of [[6, 48], [37, 47], [20, 50], [31, 50]]) { p.set(x, y, WORM.base); p.set(x + 1, y, WORM.sh); } // strays at the edge
  return p;
}
function boneback() {
  const p = part();
  const rng = new Rng(17);
  const SKT = tones("#8f8a78"), CT = tones("#3e3d36", { cool: 0.2, lift: 0.3 }), PL = { hi: "#efe9da", base: "#d3cab4", sh: "#a39a82", dk: "#6a6252" };
  stamp(p, legsPart(12, 31, CT, SKT, rng, { shoes: [true, true], top: 38, apart: 1 }), 0, 0, 0);
  // the body: hunched forward, the back a grey hump with the spine's knobs, the head carried low in front
  const body = part(); const K = "#060606";
  body.ellipse(16, 27, 12, 11, K); body.rect(12, 28, 33, 38, K); body.rect(20, 21, 33, 30, K);
  shadePart(body, { [K]: SKT }, { wide: true, soft: true });
  for (let i = 0; i < 6; i++) { const x = 9 + i * 2, y = 25 - Math.round(Math.sin(i / 5 * 2.2) * 5); body.set(x, y, SKT.hi); body.set(x + 1, y, SKT.base); body.set(x, y + 1, SKT.dk); } // the spine
  stamp(p, body, 0, 0);
  // a plate: fused bone, lit on top, a dark seam under it, a crack
  const plate = (x0, y0, x1, y1, crack = true) => {
    const q = part(); q.rect(x0, y0, x1, y1, "#010101"); q.clear(x0, y0); q.clear(x1, y0); q.clear(x0, y1); q.clear(x1, y1);
    shadePart(q, { "#010101": PL }); q.hl(x0 + 1, x1 - 1, y1, PL.dk); q.hl(x0 + 2, x1 - 1, y1 - 1, PL.sh); q.vl(x1, y0 + 1, y1 - 1, PL.dk); q.vl(x1 - 1, y0 + 2, y1 - 2, PL.sh);
    if (crack) { const cx = x0 + 2 + ((x0 * 3) % Math.max(1, x1 - x0 - 3)); q.set(cx, y0 + 1, PL.dk); q.set(cx + 1, y0 + 2, PL.dk); q.set(cx + 1, y0 + 3, PL.sh); }
    return q;
  };
  // rows of plates down its front, overlapping like scales
  for (const [x0, y0, x1, y1] of [[22, 34, 29, 38], [30, 33, 35, 38], [21, 29, 28, 33], [29, 28, 36, 33], [23, 23, 30, 28], [31, 22, 37, 27]]) stamp(p, plate(x0, y0, x1, y1), 0, 0, 0.55);
  // arms: the far one hanging behind, the near one forward with its forearm plated
  const arms = part();
  arms.rect(6, 26, 11, 40, K); arms.rect(5, 40, 11, 45, K);
  limb(arms, 32, 27, 37, 34, 5, K); arms.rect(36, 34, 40, 44, K); arms.rect(35, 44, 41, 48, K);
  shadePart(arms, { [K]: SKT }, { wide: true });
  stamp(p, arms, 0, 0);
  stamp(p, plate(35, 35, 41, 43, false), 0, 0, 0.5);
  // the head, low and forward, behind its mask: plates over the brow and the jaw, the eyes peering out between them
  const hd = headPart(SKT, "#e2412f", "red", { jawDrop: 2, size: 13 });
  stamp(p, hd.q, 22, 8);
  const brow = plate(22, 7, 37, 13, true), chin = plate(23, 18, 36, 23, false);
  stamp(p, brow, 0, 0, 0.5); stamp(p, chin, 0, 0, 0.5);
  p.rect(24, 14, 36, 17, bruise(SKT)); p.hl(24, 36, 14, mix(bruise(SKT), "#000", 0.4));
  for (const x of [26, 27, 32, 33]) { p.set(x, 15, "#e2412f"); p.set(x, 16, mix("#e2412f", bruise(SKT), 0.5)); }
  p.set(25, 15, mix("#e2412f", bruise(SKT), 0.5)); p.set(28, 15, mix("#e2412f", bruise(SKT), 0.5)); p.set(31, 15, mix("#e2412f", bruise(SKT), 0.5)); p.set(34, 15, mix("#e2412f", bruise(SKT), 0.5));
  p.rect(26, 18, 34, 19, MOUTH); for (const x of [27, 30, 33]) p.set(x, 18, TEETH); p.hl(26, 34, 17, GUM); // the mouth between mask and jaw plate
  for (const [x, y] of [[29, 10], [33, 21]]) { p.set(x, y, PL.dk); p.set(x + 1, y + 1, PL.dk); }
  wound(p, 15, 23, 2, rng); wound(p, 9, 32, 2, rng); wound(p, 17, 36, 1, rng);
  return p;
}
function climber() {
  const p = part();
  const rng = new Rng(18);
  const SKT = tones("#a59a8c"), CT = tones("#4d4438", { cool: 0.14 });
  // crouched: bent legs, bare feet with long toes
  const legs = part(); const P = "#020202", K = "#040404";
  limb(legs, 15, 36, 8, 42, 5, P); limb(legs, 8, 42, 13, 48, 5, P); legs.rect(10, 48, 19, 50, K); legs.set(20, 50, K); legs.set(22, 50, K);
  limb(legs, 24, 36, 32, 41, 5, P); limb(legs, 32, 41, 28, 48, 5, P); legs.rect(26, 48, 35, 50, K); legs.set(36, 50, K); legs.set(38, 50, K);
  shadePart(legs, { [P]: CT, [K]: SKT });
  fray(legs, 9, 13, 47, CT.base, CT.dk, rng); fray(legs, 27, 32, 47, CT.base, CT.dk, rng);
  stamp(p, legs, 0, 0, 0);
  // a thin torso, low
  const torso = part(); const C = "#050505";
  torso.rect(15, 24, 25, 37, C); torso.rect(14, 25, 26, 28, C);
  shadePart(torso, { [C]: CT }, { wide: true });
  for (const y of [28, 31]) torso.hl(16, 23, y, mix(CT.base, SKT.base, 0.5)); // ribs through the shirt
  torso.hl(15, 25, 36, CT.dk);
  stamp(p, torso, 0, 0);
  // the arms, long and raised, the fingers hooked bone
  const arms = part();
  limb(arms, 15, 25, 7, 14, 4, C); limb(arms, 7, 14, 5, 3, 4, K); arms.rect(4, 1, 8, 3, K);
  limb(arms, 25, 25, 34, 14, 4, C); limb(arms, 34, 14, 37, 3, 4, K); arms.rect(36, 1, 40, 3, K);
  shadePart(arms, { [C]: CT, [K]: SKT });
  for (const x of [3, 5, 7, 9]) { arms.set(x, 0, BONE.base); arms.set(x, 1, BONE.sh); } arms.set(2, 1, BONE.base);
  for (const x of [35, 37, 39, 41]) { arms.set(x, 0, BONE.base); arms.set(x, 1, BONE.sh); } arms.set(42, 1, BONE.base);
  arms.set(5, 11, CT.dk); arms.set(36, 11, CT.dk); // the sleeves' ends
  stamp(p, arms, 0, 0);
  // the head, looking up between the arms
  const hd = headPart(SKT, "#e2e07a", "glow", { jawDrop: 2, size: 12, cheek: true });
  stamp(p, hd.q, 13, 9);
  p.rect(18, 22, 23, 25, SKT.sh);
  return p;
}
function flinger() {
  const p = part();
  const rng = new Rng(19);
  const SKT = tones("#8f9a86"), CT = tones("#3f4a3a", { cool: 0.14 });
  stamp(p, legsPart(13, 30, CT, SKT, rng, { shoes: [true, false], top: 36 }), 0, 0, 0);
  const torso = torsoPart(13, 30, CT, SKT, "tshirt", rng, { top: 22, bottom: 35 });
  stamp(p, torso, 0, 0);
  tearShirt(p, 13, 30, 22, 35, CT, SKT, "torn", rng, 1);
  // the long arms: the throwing arm cocked back over the head, the other hanging almost to the ground
  const arms = part(); const K = "#060606", S = "#070707";
  limb(arms, 27, 23, 36, 34, 4, S); limb(arms, 36, 34, 37, 46, 4, K); arms.rect(36, 46, 40, 49, K); arms.set(41, 47, K); arms.set(41, 49, K);
  limb(arms, 15, 23, 7, 14, 4, S); limb(arms, 7, 14, 10, 4, 4, K); arms.rect(9, 2, 13, 5, K);
  shadePart(arms, { [S]: CT, [K]: SKT });
  stamp(p, arms, 0, 0);
  // the mass of worms in its fist, dripping
  const mass = part(); const M = "#070707";
  mass.ellipse(14, 4, 6, 4, M); mass.ellipse(11, 7, 4, 3, M);
  shadePart(mass, { [M]: WORM }, { soft: true });
  stamp(p, mass, 0, 0);
  worm(p, 16, 2, 3, 1, 0.3); worm(p, 10, 3, 3, -1, 0.2); worm(p, 18, 6, 3, 1, -0.3); worm(p, 8, 8, 2, -1, -0.4);
  for (const [x, y0, y1] of [[13, 10, 13], [17, 9, 11], [15, 12, 16]]) { for (let y = y0; y <= y1; y++) p.set(x, y, y === y1 ? WORM.hi : WORM.sh); }
  p.set(15, 19, WORM.base); p.set(13, 21, WORM.sh);
  // the head
  const hd = headPart(SKT, "#e2e07a", "glow", { jawDrop: 2, size: 13, scalp: true });
  p.rect(18, 16, 23, 22, SKT.sh);
  stamp(p, hd.q, 13, 4);
  return p;
}
function sower() {
  const p = part();
  const rng = new Rng(20);
  const SKT = tones("#a8a07a", { cool: 0.2 }), CT = tones("#5a5440", { cool: 0.14 });
  stamp(p, legsPart(14, 29, CT, SKT, rng, { shoes: [false, true], top: 40, knee: false }), 0, 0, 0);
  const body = part(); const K = "#060606";
  body.ellipse(21, 30, 12, 10.5, K); body.rect(15, 20, 27, 24, K);
  shadePart(body, { [K]: SKT }, { wide: true, soft: true });
  sheen(body, 21, 31, 10, 9, SKT.hi, mix(SKT.hi, "#ffffff", 0.5));
  body.hl(14, 28, 40, SKT.dk);
  stamp(p, body, 0, 0);
  // the near arm hanging
  const arms = part();
  arms.rect(6, 23, 10, 36, K); arms.rect(5, 36, 10, 40, K); arms.set(4, 38, K);
  shadePart(arms, { [K]: SKT }, { wide: true });
  stamp(p, arms, 0, 0);
  // egg sacs hung from its back and sides: pale translucent sacs with the eggs showing inside
  const sac = (x, y, r) => { const q = part(); q.ellipse(x, y, r, r + 0.5, "#010101"); shadePart(q, { "#010101": EGG }, { soft: true }); q.set(x - 1, y - 1, EGG.hi); q.set(x, y + 1, EGG.sh); q.set(x + 1, y, EGG.sh); q.set(x - 1, y + 1, EGG.dk); if (r > 2) { q.set(x + 1, y - 1, EGG.sh); q.set(x - 2, y, EGG.sh); } stamp(p, q, 0, 0, 0.3); p.set(x, y - r - 1, SKT.dk); };
  sac(33, 20, 3.5); sac(36, 27, 3); sac(34, 34, 3.5); sac(31, 41, 2.5); sac(9, 30, 2.5); sac(12, 38, 2.5); sac(27, 44, 2);
  // the head
  const hd = headPart(SKT, "#e8e07a", "glow", { jawDrop: 2, size: 12, scalp: true });
  p.rect(18, 15, 24, 21, SKT.sh);
  stamp(p, hd.q, 14, 4);
  // eggs dribbling to the ground, left behind it
  for (const [x, y] of [[29, 48], [34, 49], [38, 47], [41, 49], [25, 50], [36, 50], [12, 49]]) { p.set(x, y, EGG.base); p.set(x + 1, y, EGG.sh); p.set(x, y - 1, EGG.hi); }
  p.set(32, 45, EGG.base); p.set(32, 46, EGG.sh);
  return p;
}
function nightmare() {
  const p = part();
  const rng = new Rng(21);
  const SKT = tones("#6e6a78", { cool: 0.35 }), CT = tones("#1e1c24", { cool: 0.3, lift: 0.3 });
  stamp(p, legsPart(16, 27, CT, SKT, rng, { shoes: [false, false], top: 34 }), 0, 0, 0);
  const torso = part(); const C = "#050505";
  torso.rect(16, 20, 26, 33, C); torso.rect(15, 21, 27, 24, C); torso.clear(16, 20); torso.clear(26, 20);
  shadePart(torso, { [C]: CT }, { wide: true });
  for (let x = 16; x <= 26; x += 3) torso.set(x, 33, CT.dk); torso.hl(16, 26, 32, CT.sh);
  stamp(p, torso, 0, 0);
  // long arms hanging, the fingers long
  const arms = part(); const K = "#060606";
  limb(arms, 15, 21, 10, 30, 4, C); limb(arms, 10, 30, 9, 40, 3, K); arms.rect(8, 40, 11, 44, K); arms.set(8, 45, K); arms.set(10, 46, K); arms.set(11, 45, K);
  limb(arms, 27, 21, 32, 30, 4, C); limb(arms, 32, 30, 33, 40, 3, K); arms.rect(32, 40, 35, 44, K); arms.set(32, 46, K); arms.set(34, 45, K); arms.set(35, 46, K);
  shadePart(arms, { [C]: CT, [K]: SKT });
  stamp(p, arms, 0, 0);
  // the head: tall and gaunt, the jaw unhinged, hanging to the chest
  const hd = headPart(SKT, "#ff3a2a", "red", { jawDrop: 7, size: 12 });
  stamp(p, hd.q, 15, 1);
  p.rect(20, 11, 25, 20, MOUTH); p.vl(19, 12, 19, GUM); p.vl(26, 12, 19, GUM); for (const y of [13, 16]) { p.set(19, y, TEETH); p.set(26, y, TEETH); } p.set(22, 19, "#5c1210"); p.set(23, 17, "#3a0c0c"); // the throat, a gullet
  p.hl(20, 25, 11, GUM); for (const x of [20, 22, 24]) p.set(x, 12, TEETH);
  shriek(p, 22, 8, "#d0446a", [11, 15, 19], [-175, -5]);
  return p;
}
const SPECIAL = { spitter, screamer, crawler, shepherd, carrier, swarm, boneback, climber, flinger, sower, nightmare };
export const SPECIAL_KINDS = Object.keys(SPECIAL);
export const paintSpecialHD = (kind) => (SPECIAL[kind] || spitter)();

// ---------- the bosses (hivesprites.js), on an 88 × 104 grid ----------
const BW = 88, BH = 104;
// The Wallbreaker: a hulking grey brute twice a shambler's bulk, legs planted wide, the head sunk low, one arm
// hanging knuckles down, the other raised with a slab of concrete bound to the fist with rebar.
function wallbreaker() {
  const p = part(BW, BH);
  const rng = new Rng(31);
  const SKT = tones("#8f9a86"), PT = tones("#3a3a36", { cool: 0.2, lift: 0.3 }), SLAB = tones("#9a968c", { cool: 0.2, lift: 0.3 }), RUST = tones("#7a4a30", { cool: 0.05, lift: 0.3 });
  const K = "#060606", P = "#020202", S = "#030303";
  // legs planted wide, boots split at the toes
  const legs = part(BW, BH);
  legs.rect(14, 70, 34, 96, P); legs.rect(52, 70, 72, 96, P); legs.rect(14, 70, 72, 76, P);
  legs.rect(10, 94, 36, 101, S); legs.rect(50, 94, 78, 101, S);
  shadePart(legs, { [P]: PT, [S]: tones(SHOE, { cool: 0.15, lift: 0.25 }) }, { wide: true });
  legs.hl(16, 32, 82, PT.sh); legs.hl(54, 70, 82, PT.sh); legs.hl(10, 36, 101, shade(SHOE, -0.4)); legs.hl(50, 78, 101, shade(SHOE, -0.4));
  for (const x0 of [14, 52]) fray(legs, x0 + 1, x0 + 19, 93, PT.base, PT.dk, rng, { deep: 2 });
  legs.hl(10, 78, 101, mix(shade(SHOE, -0.2), "#3a3020", 0.4));
  stamp(p, legs, 0, 0, 0);
  // the torso: a wall of muscle, the shoulders sloping up to where the head sits
  const body = part(BW, BH);
  body.rect(20, 24, 66, 26, K); body.rect(14, 27, 72, 30, K); body.rect(9, 31, 77, 74, K); body.rect(11, 75, 75, 78, K);
  shadePart(body, { [K]: SKT }, { wide: true, soft: true });
  body.rect(13, 32, 73, 72, SKT.sh);
  const sl = (x0, y0, x1, y1) => { body.rect(x0, y0, x1, y1, SKT.base); body.hl(x0 + 1, x1 - 1, y0, SKT.hi); body.vl(x0, y0 + 1, y1 - 1, SKT.hi); body.hl(x0 + 1, x1, y1, SKT.dk); body.hl(x0 + 1, x1, y1 + 1, SKT.dk); body.vl(x1, y0 + 1, y1 - 1, SKT.sh); body.set(x0, y1, SKT.sh); body.set(x1, y0, SKT.sh); };
  sl(14, 34, 41, 50); sl(46, 34, 72, 50); sl(18, 54, 41, 60); sl(46, 54, 69, 60); sl(20, 64, 41, 70); sl(46, 64, 67, 70);
  body.vl(42, 33, 72, SKT.dk); body.vl(43, 33, 72, SKT.dk); body.vl(44, 34, 72, SKT.sh);
  // ribs through the skin on its flank, old wounds
  body.rect(10, 38, 17, 51, mix(SKT.dk, "#4a1a1c", 0.45)); for (const y of [40, 44, 48]) { body.hl(10, 16, y, BONE.base); body.set(16, y, BONE.sh); body.hl(10, 15, y + 1, BONE.sh); }
  stamp(p, body, 0, 0);
  // the hanging arm (far side): knuckles down
  const far = part(BW, BH);
  far.rect(0, 30, 10, 76, K); far.rect(0, 76, 12, 90, K); far.rect(1, 90, 11, 92, K);
  shadePart(far, { [K]: SKT }, { wide: true });
  far.hl(0, 9, 52, SKT.sh); for (const x of [1, 4, 7, 10]) far.set(x, 84, SKT.hi); far.hl(0, 11, 86, SKT.dk);
  stamp(p, far, 0, 0);
  // the head, sunk between the shoulders
  const hd = headPart(SKT, "#e2412f", "red", { jawDrop: 2, size: 16, scalp: true, teethBlood: true });
  stamp(p, hd.q, 33, 7);
  // the raised arm and the slab bound to its fist
  const arm = part(BW, BH);
  limb(arm, 70, 36, 78, 22, 10, K); arm.rect(74, 6, 86, 24, K);
  shadePart(arm, { [K]: SKT }, { wide: true });
  arm.hl(71, 79, 30, SKT.sh);
  stamp(p, arm, 0, 0);
  const slab = part(BW, BH);
  const SL = "#070707";
  slab.rect(56, 0, 87, 20, SL); slab.rect(58, 21, 85, 23, SL); slab.clear(56, 0); slab.clear(87, 0); slab.clear(57, 0);
  shadePart(slab, { [SL]: SLAB }, { wide: true });
  slab.hl(57, 86, 1, SLAB.hi); slab.rect(60, 4, 64, 6, SLAB.sh); slab.rect(72, 9, 79, 11, SLAB.sh); slab.set(68, 15, SLAB.dk); slab.set(69, 16, SLAB.dk); slab.set(70, 17, SLAB.dk); slab.set(66, 14, SLAB.dk); // chips and a crack
  slab.line(59, 18, 63, 12, SLAB.dk); slab.set(84, 3, SLAB.dk);
  // rebar: rods bent out of the broken concrete, one wrapped round the fist to bind it
  const rod = (pts, col = RUST.base, dk = RUST.dk) => { for (let i = 0; i < pts.length - 1; i++) { slab.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], col); slab.line(pts[i][0] + 1, pts[i][1], pts[i + 1][0] + 1, pts[i + 1][1], dk); } };
  rod([[63, 4], [63, 14], [66, 20]]); rod([[80, 2], [78, 12], [82, 18]]); rod([[58, 12], [66, 11], [72, 13]]);
  rod([[59, 0], [57, -3]]); rod([[84, 0], [86, -4]]);
  slab.set(63, 3, RUST.hi); slab.set(80, 1, RUST.hi); slab.set(64, 7, mix(RUST.base, SLAB.base, 0.4)); slab.set(79, 9, mix(RUST.base, SLAB.base, 0.4));
  for (let i = 0; i < 4; i++) { slab.hl(70 + i, 86 - i, 24 + i * 2, RUST.base); slab.hl(70 + i, 86 - i, 25 + i * 2, RUST.dk); } // wound round the fist
  stamp(p, slab, 0, 0);
  p.rect(75, 24, 85, 27, SKT.sh); p.rect(76, 26, 84, 27, SKT.base); // the fist under the slab
  for (let i = 0; i < 4; i++) { p.hl(72 + i, 86 - i, 24 + i * 2, RUST.base); p.hl(72 + i, 86 - i, 25 + i * 2, RUST.dk); }
  for (const [x, y, n] of [[24, 46, 3], [54, 66, 2], [62, 44, 3], [34, 70, 2], [6, 60, 2], [20, 84, 2]]) wound(p, x, y, n, rng);
  p.hl(24, 36, 102, BLOOD.rim); p.hl(28, 33, 103, BLOOD.dry);
  return p;
}
// The Broodmother: the bloated queen inside a hive, mottled grey-pink, egg sacs on her back, a crown of bone, three
// amber eyes, clawed arms, grown from a mound of flesh.
function broodmother() {
  const p = part(BW, BH);
  const rng = new Rng(32);
  const SKT = tones("#9a7a86", { cool: 0.25 }), LIT = tones("#c4a2ae", { cool: 0.2 }), SAC = { hi: "#fff0c0", base: "#e8b46a", sh: "#b07a3a", dk: "#7a5024" }, EYE = "#ffd166", VEIN = "#8a1c22";
  const K = "#060606";
  // the mound she grows from
  const mound = part(BW, BH); const M = "#050505";
  mound.ellipse(44, 97, 40, 6, M); mound.ellipse(44, 94, 28, 5, M);
  shadePart(mound, { [M]: tones("#5a2a2e", { cool: 0.2 }) }, { wide: true, soft: true });
  for (const x of [12, 30, 56, 74]) { mound.vl(x, 86 + (x % 5), 93, BONE.base); mound.set(x + 1, 86 + (x % 5), BONE.sh); }
  stamp(p, mound, 0, 0, 0);
  // the egg sacs on her back (behind the body)
  const sac = (x, y, r) => { const q = part(BW, BH); q.ellipse(x, y, r, r + 1, "#010101"); shadePart(q, { "#010101": SAC }, { soft: true }); q.ellipse(x - r * 0.3, y - r * 0.35, r * 0.3, r * 0.3, SAC.hi); q.ellipse(x + r * 0.2, y + r * 0.2, r * 0.35, r * 0.3, SAC.sh); q.ellipse(x + r * 0.2, y + r * 0.2, r * 0.15, r * 0.12, SAC.dk); return q; };
  for (const [x, y, r] of [[14, 50, 8], [22, 34, 9], [38, 24, 7], [66, 28, 9], [78, 44, 8]]) stamp(p, sac(x, y, r), 0, 0, 0.3);
  // the swollen body
  const body = part(BW, BH);
  body.ellipse(44, 66, 38, 29, K); body.ellipse(42, 70, 30, 20, "#070707");
  shadePart(body, { [K]: SKT, "#070707": LIT }, { wide: true, soft: true });
  sheen(body, 42, 70, 28, 18, LIT.hi, "#f0dde4");
  for (const [x, y, rx, ry] of [[22, 58, 6, 4], [62, 56, 7, 5], [48, 80, 8, 4], [14, 74, 4, 5], [70, 76, 5, 4], [34, 90, 6, 2]]) { const q = part(BW, BH); q.ellipse(x, y, rx, ry, "#010101"); for (const [px, py] of q.pixels()) if (body.get(px, py)) body.set(px, py, mix(body.get(px, py), SKT.sh, 0.6)); } // mottling
  const vein = (pts) => { for (let i = 0; i < pts.length - 1; i++) { body.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], mix(VEIN, SKT.base, 0.25)); } };
  vein([[18, 64], [24, 70], [26, 78], [32, 84]]); vein([[24, 70], [20, 76]]); vein([[58, 60], [64, 66], [66, 74], [62, 82]]); vein([[64, 66], [70, 68]]); vein([[40, 86], [46, 90], [52, 88]]); vein([[36, 60], [40, 66], [38, 72]]);
  for (const [x, y] of [[26, 66], [60, 64], [44, 88], [16, 76]]) { body.set(x, y, BLOOD.core); body.set(x + 1, y, BLOOD.rim); body.set(x - 1, y, BLOOD.rim); body.set(x, y - 1, BLOOD.rim); body.set(x, y + 1, BLOOD.rim); }
  stamp(p, body, 0, 0);
  // clawed arms out at her sides
  const arms = part(BW, BH);
  limb(arms, 12, 60, 4, 76, 7, K); arms.rect(1, 76, 9, 84, K); for (const x of [0, 3, 6, 9]) { arms.set(x, 85, BONE.base); arms.set(x, 86, BONE.sh); }
  limb(arms, 76, 58, 82, 74, 7, K); arms.rect(79, 74, 87, 82, K); for (const x of [78, 81, 84, 87]) { arms.set(x, 83, BONE.base); arms.set(x, 84, BONE.sh); }
  shadePart(arms, { [K]: SKT }, { wide: true });
  stamp(p, arms, 0, 0);
  // the head: broad, the jaw hanging, three eyes, the crown of bone
  const hd = part(BW, BH);
  hd.rect(32, 16, 57, 38, K); hd.rect(33, 14, 56, 15, K); hd.rect(35, 12, 54, 13, K); hd.rect(35, 39, 54, 42, K); hd.rect(37, 43, 52, 44, K);
  shadePart(hd, { [K]: SKT }, { wide: true });
  hd.hl(34, 55, 19, SKT.dk); hd.hl(34, 55, 20, SKT.sh); // the brow
  eye(hd, 35, 22, EYE, "glow", SKT); eye(hd, 42, 20, EYE, "glow", SKT); eye(hd, 50, 22, EYE, "glow", SKT);
  jaw(hd, 37, 32, 16, 8, { blood: true });
  hd.rect(36, 32, 36, 34, SKT.sh); hd.set(46, 29, SKT.dk); hd.set(45, 28, SKT.sh);
  for (const [x, h] of [[33, 8], [39, 12], [45, 15], [51, 12], [57, 8]]) { hd.rect(x - 1, 14 - h, x, 13, BONE.base); hd.vl(x + 1, 15 - h, 13, BONE.sh); hd.set(x - 1, 13 - h, BONE.hi); } // the crown
  stamp(p, hd, 0, 0);
  p.rect(36, 44, 53, 48, SKT.sh); p.hl(37, 52, 48, SKT.dk);
  return p;
}
// The Hivemind: the organ at the heart of a hive, a folded mass of grey-pink flesh like a brain the size of a car,
// veined and glowing from inside, amber pods and tendrils coiled at its foot. torn: its second phase, split down the
// middle with light pouring out, the pods burst.
function hivemind(torn = false) {
  const p = part(BW, BH);
  const FL = tones(torn ? "#b8566a" : "#b07a86", { cool: 0.2 }), LIT = tones(torn ? "#e07a8a" : "#d8a8b2", { cool: 0.15 });
  const FOLD = torn ? "#7a2a3a" : "#8a4a5a", VEIN = torn ? "#ff3a2a" : "#8a1c22", GLOW = torn ? "#ffd36b" : "#ffb43b", CORE = "#fff4c8";
  const POD = { hi: "#fff0c0", base: "#e8b46a", sh: "#b07a3a", dk: "#7a5024" };
  const K = "#060606";
  p.ellipse(44, 97, 42, 6, torn ? "#3a0c14" : "#2a1018"); p.ellipse(44, 95, 30, 4, torn ? "#4a1420" : "#3a1820"); // the pool it grows from
  const mass = part(BW, BH);
  mass.ellipse(44, 56, 40, 38, K); mass.ellipse(40, 46, 28, 24, "#070707");
  shadePart(mass, { [K]: FL, "#070707": LIT }, { wide: true, soft: true });
  sheen(mass, 40, 46, 26, 22, LIT.hi, mix(LIT.hi, "#ffffff", 0.5));
  // the folds: winding grooves across the mass
  const fold = (x0, x1, y0, amp, freq, phase) => { let py = null; for (let x = x0; x <= x1; x++) { const y = Math.round(y0 + Math.sin(x * freq + phase) * amp); if (py !== null && Math.abs(y - py) > 1) mass.over(x, (y + py) >> 1, FOLD); mass.over(x, y, FOLD); mass.over(x, y + 1, mix(FOLD, FL.base, 0.45)); mass.over(x, y - 1, mix(LIT.hi, mass.get(x, y - 1) || FL.base, 0.6)); py = y; } };
  // short gyri at every angle, no two alike
  fold(8, 26, 42, 3, 0.55, 0); fold(30, 52, 36, 2, 0.7, 1.5); fold(56, 80, 40, 3, 0.45, 2.2); fold(14, 36, 56, 2.5, 0.6, 2); fold(42, 60, 60, 3, 0.5, 0.5); fold(64, 82, 54, 2, 0.75, 1);
  fold(10, 30, 70, 2, 0.65, 1); fold(34, 58, 74, 3, 0.4, 2.8); fold(62, 76, 68, 2, 0.8, 0.3); fold(24, 46, 86, 2, 0.6, 0.2); fold(50, 66, 84, 2, 0.7, 1.7); fold(20, 40, 24, 2, 0.6, 2.5); fold(46, 68, 20, 2.5, 0.5, 1); fold(30, 50, 12, 2, 0.7, 0.4);
  for (const [x0, y0, x1, y1] of [[12, 30, 16, 40], [72, 26, 78, 36], [60, 44, 62, 56], [28, 60, 26, 70]]) { mass.line(x0, y0, x1, y1, FOLD); mass.line(x0 + 1, y0, x1 + 1, y1, mix(FOLD, FL.base, 0.45)); } // the furrows between the lobes
  for (const [x0, y0, x1, y1] of [[18, 50, 24, 60], [60, 40, 68, 46], [36, 64, 42, 72], [70, 64, 76, 70], [26, 30, 30, 36], [50, 86, 56, 90]]) { mass.line(x0, y0, x1, y1, VEIN); mass.line(x0 + 1, y0, x1 + 1, y1, mix(VEIN, FL.base, 0.5)); } // veins
  for (const [x, y] of [[32, 50], [56, 58], [28, 70], [64, 76], [46, 40]]) { mass.ellipse(x, y, 2.5, 2, GLOW); mass.set(x, y, CORE); mass.set(x + 1, y, CORE); mass.ellipse(x, y, 4, 3.4, null); for (const [dx, dy] of [[-4, 0], [4, 0], [0, -3], [0, 3], [-3, -2], [3, 2], [-3, 2], [3, -2]]) mass.over(x + dx, y + dy, mix(mass.get(x + dx, y + dy) || FL.base, GLOW, 0.4)); } // light from inside
  if (torn) { // the wound down the middle, pouring light
    for (let y = 20; y <= 90; y++) { const w = y < 30 || y > 80 ? 1 : y < 42 || y > 66 ? 3 : 6; for (let dx = -w; dx <= w; dx++) { const x = 44 + dx + ((y * 3) % 2); mass.over(x, y, Math.abs(dx) >= w - 1 && w > 1 ? GLOW : CORE); } mass.over(44 - w - 1 + ((y * 3) % 2), y, BLOOD.rim); mass.over(44 + w + 1 + ((y * 3) % 2), y, BLOOD.rim); }
  }
  stamp(p, mass, 0, 0);
  // pods at its foot, tendrils coiled
  const pod = (x, y, r) => { const q = part(BW, BH); q.ellipse(x, y, r, r * 0.9, "#010101"); shadePart(q, { "#010101": torn ? tones("#5a1a2a", { cool: 0.2 }) : POD }, { soft: true }); if (!torn) { q.set(x - 1, y - 1, POD.hi); q.set(x, y, POD.sh); } else { q.set(x, y - 1, VEIN); q.set(x + 1, y, VEIN); } return q; };
  for (const [x, y, r] of [[8, 84, 5], [78, 80, 5], [18, 92, 4], [70, 92, 4], [44, 94, 3.5]]) stamp(p, pod(x, y, r), 0, 0, 0.3);
  const TD = torn ? "#5a1a2a" : "#6a3a4a";
  for (const pts of [[[2, 90], [6, 82], [2, 74], [8, 70]], [[86, 86], [80, 78], [86, 70], [82, 64]], [[12, 100], [20, 96], [28, 100]], [[60, 100], [68, 97], [76, 100]]]) for (let i = 0; i < pts.length - 1; i++) { p.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], TD); p.line(pts[i][0] + 1, pts[i][1], pts[i + 1][0] + 1, pts[i + 1][1], shade(TD, 0.2)); }
  return p;
}
const BOSS = { wallbreaker, broodmother, hivemind: () => hivemind(false), hivemind2: () => hivemind(true) };
export const BOSS_KINDS = Object.keys(BOSS);
export const paintBossHD = (kind) => (BOSS[kind] || wallbreaker)();

// ---------- the sheet ----------
const wrap = (g) => { const q = painter(g.w, g.h); for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) { const c = g.get(x, y); if (c) q.set(x, y, c); } return q; };
export const current = (variant, seed, look = DEFAULT_LOOK) => scaled(wrap(paintZombie(variant, seed, look)), 2);
export const COMPARE = [["walker", 1], ["walker", 2], ["runner", 1], ["runner", 3], ["bloated", 2], ["brute", 4]];
export const comparePairs = () => COMPARE.flatMap(([v, s]) => [{ label: `${v} ${s} current`, paint: () => current(v, s) }, { label: `${v} ${s} HD`, paint: () => paintZombieHD(v, s) }]);

export const SHEET_TITLE = "the dead: HD designs (44 x 52)";
export const SHEET_COLS = 8;
export const SHEET = [];
for (let s = 1; s <= 8; s++) SHEET.push({ label: `walker ${s}`, paint: () => paintZombieHD("walker", s) });
for (let s = 1; s <= 3; s++) SHEET.push({ label: `runner ${s}`, paint: () => paintZombieHD("runner", s) });
for (let s = 1; s <= 3; s++) SHEET.push({ label: `bloated ${s}`, paint: () => paintZombieHD("bloated", s) });
for (let s = 1; s <= 2; s++) SHEET.push({ label: `brute ${s}`, paint: () => paintZombieHD("brute", s) });
for (const pal of ["rotten", "ashen", "pale", "burnt"]) for (const gore of ["0", "1", "2"]) SHEET.push({ label: `${pal} gore ${gore}`, paint: () => paintZombieHD("walker", 5, { ...DEFAULT_LOOK, palette: pal, gore }) });
for (const k of ["soldier", "riot"]) for (const seed of [3, 8]) SHEET.push({ label: `${k} ${seed}`, paint: () => paintArmoredDeadHD(k, seed) });
for (const k of SPECIAL_KINDS) SHEET.push({ label: k, paint: () => paintSpecialHD(k) });
SHEET.push({ label: "", paint: () => part() });
SHEET.push(...comparePairs());
