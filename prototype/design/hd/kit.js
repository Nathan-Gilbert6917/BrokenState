// The HD figure kit: the item icons' style (design/hd/items.js), made for characters. The user liked the items and
// not the first figures (2026-10-13: "do it in a better style ... make sure arms originate from the sides of the
// torso and do not look overly stretched unless it makes sense for a zombie"). Every HD figure set (people, the dead,
// the map's walkers) builds from these so the whole game reads as one style.
//
// The item style, in rules:
//   - every material is a 4-tone ramp [dark, mid, light, specular] (PAL, or ramp(hex) for a colour from the game);
//   - forms are ROUND volumes, not boxes: a shape is filled with its mid tone, lit along its upper-left rim and dark
//     along its lower-right rim (a 2-px dark band on the right of wide forms), with at most one specular line or dot;
//   - inner lines only where two forms overlap (the dark tone of the form behind, never black); the outer black
//     outline comes from outline();
//   - bold, simple shapes, strong value steps, no dithering, no noise.
//
// Volumes:
//   blob(p, inside, m, opts)   any shape (inside(x, y) -> bool), shaded by its own silhouette;
//   ellipseV(p, cx, cy, rx, ry, m, opts)   a shaded ellipse (heads, bellies, helmets);
//   limb(p, a, b, r0, r1, m, opts)   a tapered capsule from joint a to joint b (radius r0 at a, r1 at b): arms, legs,
//                                    fingers, weapons' shafts. Shaded like a cylinder lit from the upper left.
// Figures: skeleton(build) gives the joints of a standing figure on the 44 × 52 grid; arm() / leg() draw a limb as
// an upper and a lower capsule through its elbow / knee, with a sleeve or trouser material over part of it.
import { painter, mix, shade, warm } from "./hdcore.js";
import { PAL as ITEM_PAL } from "./items.js";

export const PAL = ITEM_PAL;
const LIGHT = [-0.62, -0.78]; // toward the light: the upper left

// ---------- ramps ----------
// A 4-tone ramp from one base colour, with the items' tone steps: shadows cooler, highlights warmer.
export function ramp(hex, { spec = 0.5, dark = 0.42, lite = 0.24 } = {}) {
  return [warm(shade(hex, -dark), -0.1), hex, warm(shade(hex, lite), 0.08), warm(shade(hex, spec), 0.1)];
}
// Skin: warm light and a reddish-cool dark, so faces read as skin not plastic.
export function skinRamp(hex) { return [mix(shade(hex, -0.38), "#5a2a3a", 0.18), hex, warm(shade(hex, 0.2), 0.12), warm(shade(hex, 0.42), 0.12)]; }

// ---------- shading ----------
// Shade the painted pixels of a mask (a Set of "x,y" or a painter) by their own silhouette: the mid tone inside,
// light where the upper-left neighbours are outside, dark where the lower-right ones are (2 px when wide), and an
// optional specular run next to the light rim.
function tone(inside, x, y, m, { rim = 2, specular = false, flat = false } = {}) {
  if (flat) return m[1];
  const out = (dx, dy) => !inside(x + dx, y + dy);
  if (out(1, 0) || out(0, 1) || out(1, 1)) return m[0];
  if (rim > 1 && (out(2, 0) || out(0, 2)) && !(out(-1, 0) || out(0, -1))) return m[0];
  if (out(-1, 0) || out(0, -1) || out(-1, -1)) return m[2];
  if (specular && (out(-2, 0) || out(0, -2)) && !(out(2, 0) || out(0, 2) || out(3, 0))) return m[3];
  return m[1];
}
export function blob(p, inside, m, opts = {}) {
  const { x0 = 0, y0 = 0, x1 = p.w - 1, y1 = p.h - 1 } = opts;
  const px = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inside(x, y)) px.push([x, y]);
  for (const [x, y] of px) {
    const c = tone(inside, x, y, m, opts);
    if (opts.under && p.get(x, y)) continue; // behind what is already painted
    p.set(x, y, c);
  }
  return px.length;
}
// A shaded ellipse, lit by its normal (rounder than the silhouette rule): heads, bellies, helmets, hands.
export function ellipseV(p, cx, cy, rx, ry, m, { specular = true, under = false, cut = null } = {}) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const nx = (x - cx) / (rx + 0.5), ny = (y - cy) / (ry + 0.5), r = nx * nx + ny * ny;
    if (r > 1 || (cut && !cut(x, y))) continue;
    if (under && p.get(x, y)) continue;
    const d = nx * LIGHT[0] + ny * LIGHT[1]; // > 0: facing the light
    p.set(x, y, r > 0.62 && d < -0.15 ? m[0] : d < -0.42 ? m[0] : d > 0.5 && r > 0.25 ? m[2] : m[1]);
  }
  if (specular) p.set(Math.round(cx - rx * 0.42), Math.round(cy - ry * 0.48), m[3]);
}
// A tapered capsule from a = [x, y] to b, radius r0 at a and r1 at b, shaded as a cylinder lit from the upper left.
export function limb(p, a, b, r0, r1, m, { under = false, specular = false, capA = true, capB = true } = {}) {
  const [ax, ay] = a, [bx, by] = b, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
  const L = Math.sqrt(L2), ux = dx / L, uy = dy / L; // along
  let nx = -uy, ny = ux; if (nx * LIGHT[0] + ny * LIGHT[1] < 0) { nx = -nx; ny = -ny; } // the side toward the light
  const R = Math.max(r0, r1) + 1;
  for (let y = Math.floor(Math.min(ay, by) - R); y <= Math.ceil(Math.max(ay, by) + R); y++) for (let x = Math.floor(Math.min(ax, bx) - R); x <= Math.ceil(Math.max(ax, bx) + R); x++) {
    let t = ((x - ax) * dx + (y - ay) * dy) / L2;
    if ((!capA && t < 0) || (!capB && t > 1)) continue;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + dx * t, qy = ay + dy * t, r = r0 + (r1 - r0) * t;
    const ex = x - qx, ey = y - qy, d2 = ex * ex + ey * ey;
    if (d2 > (r + 0.45) * (r + 0.45)) continue;
    if (under && p.get(x, y)) continue;
    const s = (ex * nx + ey * ny) / (r + 0.45); // +1 on the lit side, -1 on the shadow side
    p.set(x, y, r < 1 ? (s > 0.2 ? m[2] : m[1]) : s > 0.55 ? (specular && s > 0.8 ? m[3] : m[2]) : s < -0.4 ? m[0] : m[1]);
  }
}

// ---------- the standing figure ----------
// Joints on the 44 × 52 grid, facing right (the viewer sees the figure's left side a little: the near arm is on the
// right of the sprite, in front; the far arm on the left, behind). Feet on row 49, the outline's free rim round it.
// Proportions: about 4 heads tall (head 12–13 px of a 47-px figure), shoulders 2 heads wide, arms hanging to mid-thigh.
export const BUILDS = {
  slim:    { sw: 8,  hip: 6, waist: 5, r: 2.2, leg: 2.4 },
  average: { sw: 9,  hip: 7, waist: 6, r: 2.5, leg: 2.7 },
  heavy:   { sw: 10, hip: 8, waist: 8, r: 2.9, leg: 3.0 },
  bloated: { sw: 11, hip: 10, waist: 11, r: 3.0, leg: 3.1 },
  brute:   { sw: 13, hip: 9, waist: 9, r: 3.8, leg: 3.6 },
};
export function skeleton(build = "average", { cx = 21, lean = 0 } = {}) {
  const b = BUILDS[build] || BUILDS.average;
  const neck = [cx + lean, 15], chest = [cx + lean * 0.7, 22], pelvis = [cx, 31];
  const sy = 18; // the shoulder line
  return {
    build: b, cx,
    head: [cx + 1 + lean, 8.5], headR: [5.6, 6.4],
    neck, chest, pelvis,
    // Shoulders sit at the top corners of the torso, inset 1 px from its outer edge.
    shoulderN: [cx + b.sw - 1 + lean, sy], shoulderF: [cx - b.sw + 1 + lean, sy],
    hipN: [cx + 3, 32], hipF: [cx - 3, 32],
    kneeN: [cx + 4, 40], kneeF: [cx - 3, 40],
    footN: [cx + 4, 47], footF: [cx - 3, 47],
    // Hanging arms: the elbow at the waist, the hand at the top of the thigh (upper arm 8, forearm 8).
    elbowN: [cx + b.sw, 26], elbowF: [cx - b.sw, 26],
    handN: [cx + b.sw + 1, 33], handF: [cx - b.sw - 1, 33],
    sy,
  };
}
// Segment length guard: no limb longer than anatomy allows (upper arm ≤ 9, forearm ≤ 9 on this grid). Returns the
// clamped point b' at most len from a. Use it when posing an arm to reach for something (a grip, a fore-end).
export function reach(a, b, len) {
  const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
  return d <= len ? b : [a[0] + (dx * len) / d, a[1] + (dy * len) / d];
}
// Two-bone IK: the elbow for a shoulder s and a hand target h, upper arm l1 and forearm l2, bending down/back
// (bend = 1: the elbow below the line from shoulder to hand, toward the back). The hand is pulled in if out of reach.
export function elbowFor(s, h, l1 = 8, l2 = 8, bend = 1) {
  h = reach(s, h, l1 + l2 - 0.5);
  const dx = h[0] - s[0], dy = h[1] - s[1], d = Math.max(0.01, Math.hypot(dx, dy));
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), hgt = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const mx = s[0] + (dx * a) / d, my = s[1] + (dy * a) / d;
  let px = -dy / d, py = dx / d; if (py * bend < 0) { px = -px; py = -py; }
  return [[mx + px * hgt, my + py * hgt], h];
}
// An arm: upper arm shoulder → elbow, forearm elbow → hand, a hand ball; the sleeve covers the upper arm (sleeve =
// "short"), down to the elbow + 2 ("mid"), or to the wrist ("long"); none for a tank top.
export function arm(p, s, e, h, { sleeve = null, sleeveLen = "long", skin, r = 2.5, under = false, hand = true } = {}) {
  const rU = r, rL = r * 0.82;
  limb(p, s, e, rU + 0.3, rU * 0.9, skin, { under });
  limb(p, e, h, rL, rL * 0.85, skin, { under });
  if (sleeve) {
    limb(p, s, e, rU + 0.6, rU + 0.2, sleeve, { under });
    if (sleeveLen === "long") limb(p, e, h, rL + 0.4, rL + 0.2, sleeve, { under, capB: false });
    else if (sleeveLen === "mid") { const k = 0.35; limb(p, e, [e[0] + (h[0] - e[0]) * k, e[1] + (h[1] - e[1]) * k], rL + 0.5, rL + 0.4, sleeve, { under, capB: false }); }
  }
  if (hand) ellipseV(p, h[0] + 0.3, h[1] + 0.5, r * 0.8, r * 0.85, skin, { specular: false, under });
}
// A leg: thigh hip → knee, shin knee → foot top, in the trousers' material; the boot drawn by boot().
export function leg(p, hip, knee, foot, m, { r = 2.7, under = false } = {}) {
  limb(p, hip, knee, r + 0.4, r, m, { under });
  limb(p, knee, foot, r, r * 0.85, m, { under });
}
export function boot(p, foot, m, { len = 6, h = 3, under = false } = {}) {
  const [fx, fy] = foot, x0 = Math.round(fx - 2), x1 = Math.round(fx + len - 2), y0 = Math.round(fy), y1 = y0 + h - 1;
  blob(p, (x, y) => y >= y0 && y <= y1 && x >= x0 && x <= x1 - (y === y0 ? 2 : y === y0 + 1 ? 1 : 0), m, { rim: 1, under });
  p.hl(x0, x1, y1 + 1, m[0]); // the sole
}
// A torso: a rounded trapezoid from the shoulders to the hips, chest a little deeper on the near (right) side.
export function torso(sk, m, p, { top = sk.sy - 2, bot = 33, under = false, specular = false } = {}) {
  const { cx, build: b } = sk;
  const inside = (x, y) => {
    if (y < top || y > bot) return false;
    const t = (y - top) / (bot - top);
    const half = b.sw + 0.5 - (b.sw - b.waist) * Math.min(1, t * 1.35) + (t > 0.75 ? (b.hip - b.waist) * (t - 0.75) * 4 : 0);
    const round = y === top ? 2 : y === top + 1 ? 1 : 0; // rounded shoulders
    return x >= cx - half + round && x <= cx + half - round + (t < 0.6 ? 0.5 : 0);
  };
  blob(p, inside, m, { under, specular });
  return inside;
}
// A head: a skull ellipse and a jaw; returns the face's anchor points for features.
export function head(p, sk, skin, { jaw = 1 } = {}) {
  const [hx, hy] = sk.head, [rx, ry] = sk.headR;
  ellipseV(p, hx, hy, rx, ry, skin, { specular: true });
  // The jaw: a little forward and down on the facing side.
  blob(p, (x, y) => y >= hy + 2 && y <= hy + ry + jaw && x >= hx - rx + 2 + (y - hy - 2) * 0.5 && x <= hx + rx - 0.5, skin, { rim: 1 });
  return { eye: [Math.round(hx + 1.5), Math.round(hy)], eyeFar: [Math.round(hx - 2.5), Math.round(hy)], nose: [Math.round(hx + rx - 0.5), Math.round(hy + 2)], mouth: [Math.round(hx + 2), Math.round(hy + 4)], ear: [Math.round(hx - 2), Math.round(hy + 1)] };
}
export { painter, mix, shade, warm };
