// The dead's own figure parts, on top of the shared kit (kit.js, which this module only imports): rotated shaded ovals,
// layers that leave a contact line on what they cover, slumped torsos, drooping hands, shoes on row 49, the zombie
// head, rags and gore. Everything in the item style (STYLE.md): 4-tone ramps, light from the upper left, round
// volumes, no noise. Design preview only: src/ is unchanged.
import { painter } from "./hdcore.js";
import { PAL, blob, limb, mix, shade, warm } from "./kit.js";

const LIGHT = [-0.62, -0.78];

// ---------- colours ----------
// Dead skin: the game's ZPAL colour, its shadow pulled toward a bruised violet, its light barely warmed.
export const deadSkin = (hex) => [mix(shade(hex, -0.44), "#2c2034", 0.28), hex, warm(shade(hex, 0.2), 0.05), warm(shade(hex, 0.42), 0.06)];
export const GORE = { rim: PAL.red[0], core: "#2a0709", wet: "#8a1a1a", hi: PAL.red[2] };
export const MOUTH = "#1e0a0c";
export const SOCKET = "#1b1118";
export const BONE = PAL.paper;
export const PUS = ["#76702e", "#b4aa4a", "#d9cf76", "#f5eeb2"];
export const ACID = ["#2c5612", "#5f9e26", "#97d43a", "#e0f79c"];
export const WORM = ["#8a7656", "#c4b088", "#e6d9b4", "#fbf5e0"];
export const EGG = ["#80733a", "#c2b264", "#e6d99a", "#fff6c8"];
export const FLESH = ["#5a2433", "#94505e", "#bd7c86", "#e2adb2"]; // raw grey-pink hive flesh
export const AMBER = ["#7a4210", "#c47a22", "#eeb04a", "#fff0c0"];

// ---------- volumes ----------
// A shaded ellipse turned by ang (radians): heads that tilt, bellies, sacs, plates. Lit by its normal like
// kit.ellipseV, with one specular dot toward the light.
export function oval(p, cx, cy, rx, ry, m, { ang = 0, specular = true, under = false, cut = null, flat = false } = {}) {
  const c = Math.cos(ang), s = Math.sin(ang), R = Math.max(rx, ry) + 1;
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
    const dx = x - cx, dy = y - cy;
    const u = (dx * c + dy * s) / (rx + 0.5), v = (-dx * s + dy * c) / (ry + 0.5), r = u * u + v * v;
    if (r > 1 || (cut && !cut(x, y))) continue;
    if (under && p.get(x, y)) continue;
    if (flat) { p.set(x, y, m[1]); continue; }
    const nx = u * c - v * s, ny = u * s + v * c, d = nx * LIGHT[0] + ny * LIGHT[1];
    p.set(x, y, r > 0.62 && d < -0.15 ? m[0] : d < -0.42 ? m[0] : d > 0.5 && r > 0.25 ? m[2] : m[1]);
  }
  if (specular) {
    const ux = -rx * 0.42, uy = -ry * 0.5;
    const sx = Math.round(cx + ux * c - uy * s), sy = Math.round(cy + ux * s + uy * c);
    if (!cut || cut(sx, sy)) p.set(sx, sy, m[3]);
  }
}
// A small shaded ball (a pustule, an eye of the hive, a knuckle): 1 dark lower-right, 1 light upper-left.
export function ball(p, x, y, r, m) {
  x = Math.round(x); y = Math.round(y);
  if (r >= 2) { oval(p, x, y, r, r, m, {}); return; }
  const T = r >= 1.4 ? [[1, 2, 1], [2, 3, 0], [1, 0, 0]] : [[2, 1], [1, 0]];
  T.forEach((row, j) => row.forEach((t, i) => p.set(x + i, y + j, m[t])));
}

// Draw into a layer of its own, then lay it over p: where the layer covers what is already painted, the covered
// pixels along its edge darken (the inner line, "the dark tone of the form behind").
export function layer(p, draw, { rim = true, cast = 0 } = {}) {
  const q = painter(p.w, p.h);
  draw(q);
  if (cast) for (let y = p.h - 1; y >= 0; y--) for (let x = p.w - 1; x >= 0; x--) {
    const c = p.get(x, y);
    if (!c || q.get(x, y)) continue;
    let hit = false; for (let k = 1; k <= cast && !hit; k++) hit = !!q.get(x, y - k) || !!q.get(x - 1, y - k);
    if (hit) p.set(x, y, behind(c));
  }
  if (rim) for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const c = p.get(x, y);
    if (!c || q.get(x, y)) continue;
    if (q.get(x - 1, y) || q.get(x + 1, y) || q.get(x, y - 1) || q.get(x, y + 1)) p.set(x, y, behind(c));
  }
  p.blit(q, 0, 0);
  return q;
}
export const behind = (c) => warm(shade(c, -0.36), -0.08);

// ---------- the trunk ----------
// A slumped torso: a rounded trapezoid from the shoulders (top) to the hips (bot) whose centre line runs from topX to
// botX (the lean), half-widths hs (shoulders), hw (waist), hh (hips); dropN / dropF lower one shoulder (uneven);
// belly: a bulge on the facing side low down; hump: the back bowed out high up (a hunch).
export function trunkShape({ top, bot, topX, botX, hs, hw, hh, dropN = 0, dropF = 0, belly = 0, hump = 0, corner = 3 }) {
  const cAt = (y) => topX + (botX - topX) * ((y - top) / (bot - top));
  const halfAt = (t) => (t < 0.55 ? hs + (hw - hs) * (t / 0.55) : hw + (hh - hw) * ((t - 0.55) / 0.45));
  const tN = top + dropN, tF = top + dropF;
  return (x, y) => {
    if (y < Math.min(tN, tF) || y > bot) return false;
    const t = (y - top) / (bot - top), c = cAt(y), half = halfAt(Math.max(0, t));
    const L = c - half - hump * Math.max(0, Math.sin(Math.PI * Math.min(1, t / 0.7))), Rr = c + half + 0.5 + belly * Math.max(0, Math.sin(Math.PI * (t - 0.35) / 0.65));
    if (x < L || x > Rr) return false;
    if (x <= c && y < tF) return false;
    if (x > c && y < tN) return false;
    // rounded shoulders: a circle of radius `corner` in each top corner
    const k = corner;
    if (x < L + k && y < tF + k) { const ex = x - (L + k), ey = y - (tF + k); if (ex * ex + ey * ey > (k + 0.4) * (k + 0.4)) return false; }
    if (x > Rr - k && y < tN + k) { const ex = x - (Rr - k), ey = y - (tN + k); if (ex * ex + ey * ey > (k + 0.4) * (k + 0.4)) return false; }
    return true;
  };
}
// The shoulder joints of a trunk: its top outer corners, 1.5 px in and 2 px down.
export function shoulders(T) {
  const cTop = T.topX, half = T.hs;
  return { N: [cTop + half - 1, T.top + 2 + (T.dropN || 0)], F: [cTop - half + 1.5 - (T.hump || 0) * 0.6, T.top + 2 + (T.dropF || 0)] };
}

// ---------- limbs ----------
// A hand at h: a small palm and fingers. dir: the forearm's direction (unit). droop: the fingers hang down from it;
// claw: the fingers hooked; fist: a big round fist, no fingers.
export function hand(p, h, dir, skin, { r = 1.8, n = 2, len = 3, droop = 1.2, fist = false, under = false, nail = null } = {}) {
  const [hx, hy] = h, [ux, uy] = dir;
  if (fist) { oval(p, hx + ux * 0.6, hy + uy * 0.6 + 0.4, r, r * 1.05, skin, { under }); p.set(Math.round(hx + ux * r * 0.9), Math.round(hy + 0.6), skin[0]); return; }
  oval(p, hx + ux * 0.4, hy + uy * 0.4 + 0.2, r * 0.75, r * 0.85, skin, { specular: false, under });
  // the fingers: the forearm's direction turned down by `droop` radians (clockwise on screen)
  const c = Math.cos(droop), s = Math.sin(droop), fx = ux * c - uy * s, fy = ux * s + uy * c;
  const px = -fy, py = fx; // across the hand
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * (n > 2 ? 1.5 : 2);
    const b = [hx + ux * 1.1 + px * o, hy + uy * 1.1 + py * o + 0.4], L = len - Math.abs(o) * 0.3 - (i === 0 && n > 1 ? 0.6 : 0);
    const t = [b[0] + fx * L, b[1] + fy * L];
    limb(p, b, t, 0.62, 0.5, skin, { under });
    if (nail) p.set(Math.round(t[0]), Math.round(t[1]), nail);
  }
}
// An arm from shoulder s through elbow e to hand h: an upper arm and forearm capsule, a sleeve over part of it
// (sleeve: a ramp; len "short" | "elbow" | "long" | "torn": to mid-forearm with a ragged cuff), the hand.
export function zarm(p, s, e, h, skin, { sleeve = null, len = "long", r = 2.3, hand: H = {}, lost = false, under = false, gore = 0 } = {}) {
  const rU = r, rL = r * 0.84;
  limb(p, s, e, rU + 0.2, rU * 0.9, skin, { under });
  if (!lost) limb(p, e, h, rL, rL * 0.82, skin, { under });
  if (sleeve) {
    limb(p, s, e, rU + 0.55, rU + 0.25, sleeve, { under });
    const k = len === "long" ? 0.86 : len === "torn" ? 0.45 : len === "elbow" ? 0.12 : 0;
    if (k > 0 && !lost) {
      const end = [e[0] + (h[0] - e[0]) * k, e[1] + (h[1] - e[1]) * k];
      limb(p, e, end, rL + 0.5, rL + 0.4, sleeve, { under, capB: false });
      if (len === "torn") { // the ragged cuff: a strip hanging from the torn edge
        p.set(Math.round(end[0]), Math.round(end[1] + rL + 1), sleeve[0]);
        p.set(Math.round(end[0] - 1), Math.round(end[1] + rL + 1), sleeve[1]);
      }
    } else if (len === "short" && !lost) { // a short sleeve's hem: the dark tone at the cuff
      const d = Math.hypot(e[0] - s[0], e[1] - s[1]), ux = (e[0] - s[0]) / d, uy = (e[1] - s[1]) / d;
      p.set(Math.round(e[0] - ux * 1.5), Math.round(e[1] - uy * 1.5 + rU), sleeve[0]);
    }
  }
  const d = Math.hypot(h[0] - e[0], h[1] - e[1]) || 1, dir = [(h[0] - e[0]) / d, (h[1] - e[1]) / d];
  if (lost) { // the forearm gone at the elbow: a stump with the bone end and a ragged red rim
    const tip = [e[0] + dir[0] * 2, e[1] + dir[1] * 2];
    limb(p, e, tip, rL, rL, skin, { under });
    oval(p, tip[0] + dir[0] * 0.8, tip[1] + dir[1] * 0.8, 1.6, 1.8, [GORE.core, GORE.rim, PAL.red[1], PAL.red[2]], { specular: false, under });
    p.set(Math.round(tip[0] + dir[0] * 1.6), Math.round(tip[1] + dir[1] * 1.6 - 0.4), BONE[2]);
    if (gore) { p.set(Math.round(tip[0]), Math.round(tip[1] + rL + 1), GORE.rim); p.set(Math.round(tip[0]), Math.round(tip[1] + rL + 2), GORE.rim); }
    return;
  }
  hand(p, h, dir, skin, { under, ...H });
}
// A leg: thigh and shin in the trousers; torn: the shin bare below a ragged hem.
export function zleg(p, hip, knee, ankle, pants, skin, { r = 2.6, torn = false, under = false } = {}) {
  if (torn) {
    limb(p, hip, knee, r + 0.4, r, pants, { under });
    limb(p, knee, ankle, r * 0.8, r * 0.7, skin, { under });
    const end = [knee[0] + (ankle[0] - knee[0]) * 0.3, knee[1] + (ankle[1] - knee[1]) * 0.3];
    limb(p, knee, end, r + 0.1, r, pants, { under, capB: false });
    p.set(Math.round(end[0] - 1), Math.round(end[1] + 1), pants[0]);
  } else {
    limb(p, hip, knee, r + 0.4, r, pants, { under });
    limb(p, knee, ankle, r, r * 0.85, pants, { under });
  }
}
// A shoe or boot standing on row 49 (the sole), the toe to the right; ankle: where the shin ends. bare: a bare foot.
export function shoe(p, ankle, m, { len = 6, h = 4, under = false, bare = false, floor = 49, back = 2.4 } = {}) {
  const [ax] = ankle, x0 = Math.round(ax - back), x1 = x0 + len, y0 = floor + 1 - h;
  const toe = (y) => (y === y0 ? (bare ? 3 : 2) : y === y0 + 1 ? 1 : 0) * Math.max(1, Math.round(h / 4));
  const inside = (x, y) => y >= y0 && y <= floor && x >= x0 && x <= x1 - toe(y) && !(x === x0 && y === floor && bare);
  blob(p, inside, m, { rim: 1, under });
  if (!bare) { p.hl(x0, x1, floor, m[0]); p.hl(x0 + 1, x1 - 2 - toe(y0), y0, m[2]); }
  else { p.set(x1, floor, m[0]); p.set(x1 - 2, floor, m[0]); } // toes
}
// A worm: capsules through pts (the head last), 1.1 px thick, a dark mouth at the head.
export function worm(p, pts, { r = 1.1, m = WORM, mouth = true } = {}) {
  for (let i = 0; i + 1 < pts.length; i++) limb(p, pts[i], pts[i + 1], r, r * (i + 2 === pts.length ? 0.9 : 1), m);
  const [x, y] = pts[pts.length - 1];
  if (mouth) p.set(Math.round(x), Math.round(y), "#5c1e1a");
}
// Rings of a shriek round (cx, cy): arcs at the radii between angles a0 and a1 (radians), a light and a mid ring.
export function shriek(p, cx, cy, m, radii, a0, a1) {
  for (const r of radii) for (let a = a0; a <= a1; a += 0.5 / r) {
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
    p.set(x, y, m[2]);
    const x2 = Math.round(cx + Math.cos(a) * (r + 1)), y2 = Math.round(cy + Math.sin(a) * (r + 1));
    if (!p.get(x2, y2)) p.set(x2, y2, m[1]);
  }
}
// A foot in the air (a runner's back foot): a capsule from the ankle along dir.
export function airFoot(p, ankle, dir, m, { len = 5, r = 1.7, under = false } = {}) {
  limb(p, ankle, [ankle[0] + dir[0] * len, ankle[1] + dir[1] * len], r + 0.2, r, m, { under });
}

// ---------- gore ----------
// A wound: a dark-red rim round a darker core, one wet light pixel; a streak of blood running down from it.
export function wound(p, x, y, size, { streak = 0, over = true } = {}) {
  const set = (X, Y, c) => { if (!over || p.get(X, Y)) p.set(X, Y, c); };
  const w = size + 1, h = size >= 3 ? 3 : 2;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (w >= 4 && (i === 0 || i === w - 1) && (j === 0 || j === h - 1)) continue;
    const edge = j === 0 || i === 0 || i === w - 1 || j === h - 1;
    set(x + i, y + j, j === 0 && i === (w >= 4 ? 1 : 0) ? PAL.red[1] : edge && !(j === h - 1 && i > 0 && i < w - 1 && h === 2) ? GORE.rim : GORE.core);
  }
  bleed(p, x + Math.floor(w / 2), y + h, streak);
}
// Blood running down from (x, y): a 1-px run over the body, a drop at its end.
export function bleed(p, x, y, n, col = GORE.rim) {
  for (let i = 0; i < n; i++) { if (!p.get(x, y + i)) return; p.set(x, y + i, i === n - 1 ? GORE.core : col); }
}
// Ribs bared: a dark cavity with a red rim, crossed by short bone bars lit on top.
export function ribs(p, x, y, { w = 4, n = 3 } = {}) {
  oval(p, x, y, w * 0.5 + 1, n + 0.6, [GORE.core, GORE.core, GORE.rim, GORE.rim], { specular: false, cut: (X, Y) => !!p.get(X, Y) });
  for (let i = 0; i < n; i++) {
    const yy = y - n + 1 + i * 2;
    for (let k = 0; k < w; k++) p.over(x - w / 2 + k, yy + (k >= w - 1 ? 1 : 0), k === 0 ? BONE[3] : BONE[2]);
    p.over(x - w / 2 + w - 1, yy + 2, BONE[0]);
  }
}
// A bite: a crescent of tooth marks, the flesh dark in it.
export function bite(p, x, y) { for (const [dx, dy] of [[-1, 0], [0, 1], [1, 1], [2, 0]]) p.over(x + dx, y + dy, GORE.rim); p.over(x, y, GORE.core); p.over(x + 1, y, GORE.core); }

// ---------- clothes ----------
// Hanging rags: strips of cloth from a hem, 1–2 px wide, their ends ragged.
export function rag(p, x, y, len, m, { lean = 0 } = {}) {
  for (let i = 0; i < len; i++) {
    const X = Math.round(x + lean * i / len);
    p.set(X, y + i, i === 0 ? m[1] : i === len - 1 ? m[0] : m[1]);
    if (i < len - 2) p.set(X + 1, y + i, m[0]);
  }
}

// ---------- the head ----------
// A zombie head at (x, y) with radii rx, ry, turned by tilt (radians), facing right: the skull, an ear, a nose, eye
// sockets with the eyes in them, an open jaw with a few teeth. eye: { col, kind: "glow" | "red" | "dead" }.
// Returns the face's anchors (mouth, chin, cheek) for blood and hair.
export function zhead(p, { x, y, rx = 5.3, ry = 5.9, tilt = 0, jaw = 2, eye, skin, hair = null, hairLong = false, scalp = false, gore = 0, rot = false, nose = true }) {
  const c = Math.cos(tilt), s = Math.sin(tilt);
  const at = (u, v) => [x + u * c - v * s, y + u * s + v * c]; // head-local (u right, v down) to the grid
  const P = (u, v) => at(u, v).map(Math.round);
  // long hair behind the head first
  if (hair && hairLong) { const a = at(-rx + 1, 0), b = at(-rx + 0.5, ry + 3); limb(p, a, b, 2.4, 1.6, hair); const a2 = at(-rx + 3, 1), b2 = at(-rx + 2.5, ry + 2); limb(p, a2, b2, 1.6, 1.2, hair); }
  // the jaw: a capsule hanging open under the face, drawn first so the skull covers its hinge
  const jA = at(-1.5, ry * 0.45), jB = at(rx * 0.55, ry * 0.62 + jaw);
  limb(p, jA, jB, 2.4, 1.9, skin);
  oval(p, x, y, rx, ry, skin, { ang: tilt });
  // the mouth: a dark gap between the face and the jaw, teeth along its top
  const m0 = at(rx * 0.25, ry * 0.42), m1 = at(rx * 0.9, ry * 0.42 + jaw * 0.6);
  for (let i = 0; i <= 4; i++) {
    const t = i / 4, mx = m0[0] + (m1[0] - m0[0]) * t, my = m0[1] + (m1[1] - m0[1]) * t;
    for (let k = 0; k <= jaw; k++) p.set(Math.round(mx), Math.round(my + k), MOUTH);
  }
  const tA = P(rx * 0.35, ry * 0.42), tB = P(rx * 0.7, ry * 0.45);
  p.set(tA[0], tA[1], BONE[2]); p.set(tB[0], tB[1], BONE[2]);
  if (jaw >= 2) { const tC = P(rx * 0.55, ry * 0.42 + jaw + 0.6); p.set(tC[0], tC[1], BONE[1]); }
  // the ear (the near one, on the side of the head)
  const E = at(-rx * 0.3, ry * 0.12); oval(p, E[0], E[1], 1.1, 1.6, skin, { specular: false, ang: tilt }); p.set(Math.round(E[0]), Math.round(E[1] + 0.5), skin[0]);
  // the nose: a bump on the face's edge, its underside dark
  if (nose) { const N = P(rx + 0.3, ry * 0.05); p.set(N[0], N[1], skin[1]); p.set(N[0], N[1] + 1, skin[0]); }
  // the brow ridge over the sockets, the sockets, the eyes
  const e1 = P(rx * 0.32, -ry * 0.08), e2 = P(rx * 0.85, -ry * 0.08);
  for (const [ex, ey] of [e1, e2]) { p.set(ex, ey, SOCKET); p.set(ex + 1, ey, SOCKET); p.set(ex, ey + 1, mix(SOCKET, skin[0], 0.5)); p.set(ex, ey - 1, skin[0]); p.set(ex + 1, ey - 1, skin[0]); }
  if (eye) {
    const core = eye.kind === "dead" ? "#cfcab4" : eye.col;
    p.set(e1[0] + 1, e1[1], core); p.set(e2[0], e2[1], core);
    if (eye.kind === "glow") { const halo = mix(eye.col, skin[1], 0.45); p.set(e1[0] + 2, e1[1], halo); p.set(e2[0] + 1, e2[1] - 1, halo); }
    if (eye.kind === "red") { p.set(e1[0], e1[1], "#6e1410"); }
  }
  // hair: a matted cap over the back and top, the hairline sloping back from the brow
  if (hair) {
    const inHair = (X, Y) => { const dx = X - x, dy = Y - y, u = dx * c + dy * s, v = -dx * s + dy * c; return v < -ry * 0.3 + (-u) * 0.6 + (Math.round(u) % 3 === 0 ? 1 : 0) && v < ry * 0.3 + (Math.round(u) % 2 ? 0 : 1); };
    oval(p, x - 0.4, y - 0.6, rx + 0.5, ry, hair, { ang: tilt, cut: inHair });
    if (scalp) { const B = P(-rx * 0.1, -ry * 0.75); p.set(B[0], B[1], skin[1]); p.set(B[0] + 1, B[1], skin[2]); p.set(B[0] - 2, B[1] + 1, skin[1]); }
  } else if (scalp) { // a torn scalp: a dark patch, the skull showing in it
    const B = P(-rx * 0.2, -ry * 0.6); p.set(B[0], B[1], GORE.rim); p.set(B[0] + 1, B[1], GORE.rim); p.set(B[0], B[1] + 1, GORE.core); p.set(B[0] + 1, B[1] - 1, BONE[2]);
  }
  if (rot) { const R = P(rx * 0.55, ry * 0.25); p.set(R[0], R[1], skin[0]); p.set(R[0] - 1, R[1], mix(skin[0], GORE.rim, 0.5)); }
  const chin = P(rx * 0.6, ry * 0.75 + jaw), mouth = P(rx * 0.7, ry * 0.5 + jaw), cheek = P(rx * 0.1, ry * 0.4);
  if (gore > 0) { p.set(mouth[0], mouth[1] + 1, GORE.rim); bleed(p, chin[0], chin[1] + 1, gore + 1); }
  return { chin, mouth, cheek, top: P(0, -ry) };
}
