// The State Map's moving pieces as low-poly figures (docs/design-doc/sprites/map-figures-3d.md): your teams on foot
// and by car, the groups' parties and convoys, the hardcore bands and nomads, the outsiders, the hordes, the infested
// herds and your bases' workers out on job trips, built from the battle figures' one primitive (ui/figures.js limb: a
// tapered prism between two points, its faces lit by their normals in the item art's light) in the same 2:1 projection,
// at the map's scale (a person 14 px tall), each piece a small scene: the people in a loose column, a vehicle on its
// wheels, a wagon behind its oxen. A piece has a heading, the yaw of the way it travels on the screen (yawOf), so it
// turns with its road instead of being mirrored, and a frame: 0 standing still, 1–FRAMES one walk cycle (legs and arms
// swinging, the body riding up and down), the wheels turning, the oxen and the mule stepping, the oars pulling, the
// cranks going round, the dead shuffling. Painted on a fixed grid per kind of piece (so a turning piece keeps its drawn
// width), outlined, upscaled by UP and cached by look, heading and frame (render.js, workermap.js). The flat painters
// in ui/mapsprites.js stay for the places, the markers and the headless tools.
import { limb, boxL, paintLimbs } from "./figures.js";
import { painter, zombieLook } from "./sprites.js";
import { shade } from "./itemart/kit.js";
import { onForgetPictures } from "./pictures.js";

const UP = 4;             // pre-upscale factor for the cached canvas (mapsprites.js gridW reads it)
const OUTLINE = "#0b0c0e";
export const FRAMES = 8;  // frames in one cycle (a walk's two steps, a wheel's turn); frame 0 stands still
export const STEP = 15;   // degrees between cached headings

// ---------- the heading ----------
// The yaw (degrees, the battle view's: 0 faces screen down-right, 90 down-left, 180 up-left, 270 up-right) whose
// forward projects along the screen direction (dx, dy) (down is +dy): screen x = x - y, screen y = (x + y) / 2.
// Standing still with no direction: 315, facing screen-right. Rounded to STEP.
export function yawOf(dx, dy) {
  if (!dx && !dy) return 315;
  const th = Math.atan2(dy, dx), b = Math.atan2(2 * Math.sin(th), Math.cos(th));
  return roundYaw((b * 180) / Math.PI - 45);
}
export const roundYaw = (yaw) => (((Math.round(yaw / STEP) * STEP) % 360) + 360) % 360;
// The screen direction a yaw heads in (unit vector), for what trails a piece (dust, a wake).
export function dirOf(yaw) {
  const a = (yaw * Math.PI) / 180, x = Math.cos(a), y = Math.sin(a);
  const sx = x - y, sy = (x + y) / 2, l = Math.hypot(sx, sy) || 1;
  return [sx / l, sy / l];
}

// ---------- vectors ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rotator = (deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return (q) => [q[0] * c - q[1] * s, q[0] * s + q[1] * c, q[2]]; };

// ---------- colours ----------
const TIRE = "#1c1c1e", HUB = "#8a8a8a", GLASS = "#7d9db5", WOOD = "#7a5230", WOOD_LIT = "#a2713f", PACK = "#6b5434", SKIN = "#d6a77a", PANTS = "#34363c", HAIR = "#3a2a1c";
const METAL = "#7d848c", STEEL = "#cdd5da", STONE = "#8d8a82", WHITE = "#e8e4da", RED = "#d0342c", CANVAS = "#b3a27a", OLIVE = "#5d6b3a", OLIVE_DARK = "#454f2c", RUST = "#7b5a44", GOLD = "#e8c04a";
const FIRE = "#ffb43b", FIRE_HOT = "#fff0a0", FIRE_RED = "#e0542a", GLOW = "#ff9a3a55", BONE = "#d8d0bc", HAY = "#c9b25a", SHOE = "#2a2622", GUN = "#4b5159", LOG = "#8a5e36";
const PLATE = "#6f757c", PLATE_DK = "#4d5258", SCRAP_A = "#7b5a44", SCRAP_B = "#5f6158", BGLASS = "#7fb3a6", MESH = "#3e4044", LAMP = "#ffe28a", TAIL = "#d24a3a";
const OUT_RED = "#7a1a1a", OUT_GOLD = "#d9a520", OUT_GRAY = "#8a8a86";
const mixHex = (a, b, f) => { const x = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16)), y = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16)); return `#${x.map((v, i) => Math.round(v + (y[i] - v) * f).toString(16).padStart(2, "0")).join("")}`; };
const desat = (hex, f) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)), m = (r + g + b) / 3; return mixHex(hex, `#${[m, m, m].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`, f); };

// ---------- the grids ----------
// Every kind of piece paints on its own fixed grid: w × h grid px, the world origin (the ground under the piece's
// centre) at (ox, oy). A piece is drawn centred on its grid (render.js drawMapSprite), so the ground sits oy - h / 2
// below the drawn centre: the renderer's rings and badges are placed for that.
const GRIDS = { // tall enough for a column heading up or down the screen (its far end rises, its near end drops)
  solo: { w: 20, h: 22, ox: 10, oy: 19 },
  party: { w: 32, h: 28, ox: 16, oy: 22 },
  wide: { w: 48, h: 42, ox: 24, oy: 29 },
  horde: { w: 44, h: 32, ox: 22, oy: 24 },
  herd: { w: 40, h: 26, ox: 20, oy: 19 },
};
export const gridOf = (kind) => GRIDS[kind] || GRIDS.party;
// Draws a piece with its ground point (the world origin under it) at (gx, gy) on the context, one grid px `u`
// context units; the grid is on the canvas (cv.grid). alpha and angle as drawMapSprite's; facing is not a thing here.
export function drawPiece(ctx, cv, gx, gy, u, { alpha = 1, angle = 0 } = {}, scale) {
  if (!cv) return;
  const g = cv.grid || GRIDS.party, w = g.w * u, h = g.h * u;
  if (scale == null) { const t = ctx.getTransform(); scale = Math.hypot(t.a, t.b); }
  const a0 = ctx.globalAlpha, s0 = ctx.imageSmoothingEnabled, q0 = ctx.imageSmoothingQuality;
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = u * scale < 2; // crisp when drawn large, smoothed when small so it does not shimmer
  ctx.imageSmoothingQuality = "high";
  if (!angle) ctx.drawImage(cv, gx - g.ox * u, gy - g.oy * u, w, h);
  else { ctx.save(); ctx.translate(gx, gy); ctx.rotate(angle); ctx.drawImage(cv, -g.ox * u, -g.oy * u, w, h); ctx.restore(); }
  ctx.globalAlpha = a0; ctx.imageSmoothingEnabled = s0; ctx.imageSmoothingQuality = q0;
}
// The drawn box of a piece at (gx, gy): [x, y, w, h] in context units, for what keeps clear of it (names, badges).
export function pieceBox(cv, gx, gy, u) { const g = (cv && cv.grid) || GRIDS.party; return [gx - g.ox * u, gy - g.oy * u, g.w * u, g.h * u]; }

// ---------- the painter ----------
// Paints a scene's limbs (world space: forward +x is the heading's way before the yaw turns it) on the grid, turned by
// the yaw, into a depth buffer; then a dark rim where one part stands in front of another (figures.js rim does it for a
// weapon on its body; here every figure and vehicle is its own group, so the people in a column stay apart).
// The light on the map's pieces: the figures' rule (figures.js LIGHT) pushed harder, since a piece is a few pixels
// across and its faces must part at a glance: the top well lit, a face turned to the screen's right deep in shade.
const MAP_LIGHT = (n) => 0.24 * n[2] - 0.42 * Math.max(0, n[0]) + 0.06 * Math.max(0, n[1]) - 0.08 * Math.max(0, -n[2]);
function paintScene(limbs, grid, yaw) {
  const p = painter(grid.w, grid.h);
  const W = rotator(yaw);
  W.n = W;
  W.light = MAP_LIGHT;
  const { zb, gb } = paintLimbs(p, limbs, W, grid, null);
  const g = grid, px = p.px;
  // The rim: where two parts meet, the one behind gets the dark edge; at one depth (a cab on its body) the part with
  // the higher group number does, so every boundary is drawn once.
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = y * g.w + x;
    if (!px[i]) continue;
    const front = (j) => px[j] && gb[j] !== gb[i] && (zb[j] > zb[i] + 0.5 || (Math.abs(zb[j] - zb[i]) <= 0.5 && gb[j] < gb[i]));
    if ((x > 0 && front(i - 1)) || (x < g.w - 1 && front(i + 1)) || (y > 0 && front(i - g.w)) || (y < g.h - 1 && front(i + g.w))) px[i] = OUTLINE;
  }
  return p;
}
function toCanvas(p) {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = p.w * UP;
  cv.height = p.h * UP;
  const c = cv.getContext("2d");
  c.fillStyle = OUTLINE;
  const solid = (x, y) => { const v = p.get(x, y); return !!v && v.length <= 7; };
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (solid(x, y)) continue;
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) c.fillRect(x * UP, y * UP, UP, UP);
  }
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const col = p.get(x, y);
    if (!col) continue;
    c.fillStyle = col;
    c.fillRect(x * UP, y * UP, UP, UP);
  }
  return cv;
}
const cache = new Map();
let curNear = 1; // the side nearer the viewer at the yaw being built (nearOf): the hand that carries things
function cached(key, grid, yaw, build) {
  let cv = cache.get(key);
  if (cv === undefined) {
    if (cache.size > 2400) cache.clear();
    curNear = nearOf(yaw);
    cv = toCanvas(paintScene(build(), grid, yaw));
    if (cv) cv.grid = grid;
    cache.set(key, cv);
  }
  return cv;
}
// The frame as a phase of the cycle: 0 standing (null), else 0..1.
const phaseOf = (frame) => (frame > 0 ? ((frame - 1) % FRAMES) / FRAMES : null);
const clampFrame = (f) => (f > 0 ? (((f | 0) - 1) % FRAMES) + 1 : 0); // 0 stands; past the cycle wraps round

// ---------- building a scene ----------
// A scene is a list of limbs. Parts are built at the origin in their own space (forward +f, left +l, z up, the
// ground at z = 0) and placed: place(F, O, turn, build) builds through `build(push)` and moves every limb to O, turned
// by `turn` degrees about its own origin, in a group of its own (so the rim separates one figure from the next); a
// limb's own `group` (G.*) marks a part within it (the head, the legs, the wheels, a weapon) that gets a rim too.
let groupSeq = 1;
const G = { body: 0, legs: 1, arms: 2, head: 3, hat: 4, pack: 5, carry: 6, weapon: 7, wheels: 8, cab: 9, bonnet: 10, rails: 11, load: 12, deck: 13 };
function place(F, O, turn, build) {
  const R = rotator(turn), g = groupSeq++;
  const at = (q) => add(O, R(q));
  const push = (L) => { F.push({ ...L, A: at(L.A), B: at(L.B), u: L.u ? R(L.u) : null, group: g * 16 + (L.group || 0) }); }; // a limb's own group (1–15): a part of its own within the figure
  push.F = F; // for a part that places parts of its own (a raft's car, a boat's rowers): straight into the scene
  build(push);
}

// ---------- a person ----------
// 14 px tall: legs 5.5, torso 5, head 3.6. look: cloth, pants, skin, hair, hat ("helmet" | "mohawk" | "hood" | "straw" |
// "cap" | ""), hatColor, band (an armband), pack, bigpack (a load with a bedroll), sack (over the back), robe, arm (what
// the hands do: "none" swing, "rifle", "raised", "spear", "fork", "torch", "banner", "shield", "binoc", "staff", "bar",
// "axe", "rod", "basket", "buckets", "lamp"), armColor, bandage (the hurt leg). pose: { t (the walk's phase, null standing),
// lean (radians forward), stride (1 a full step), dead ("reach": arms out, the head tipped), limp (the hurt leg's swing) }.
function person(push, look, pose = {}) {
  const cloth = look.cloth || "#5a6068", pants = look.pants || PANTS, skin = look.skin || SKIN, hair = look.hair || HAIR;
  const t = pose.t, stride = pose.stride ?? 1, limp = pose.limp ?? 1;
  const legH = 5.5, torsoH = 5, headS = 4.0, TW = 3.6, TD = 2.2;
  const R = pose.near ?? -1, Lf = -R; // the hand nearer the viewer holds what one hand holds (the right unless the heading turns it away)
  // the body rides up a little at the passing step, down at the strides
  const ride = t == null ? 0 : -0.3 * Math.abs(Math.sin(t * Math.PI * 2)) + 0.15;
  const lean = pose.lean || 0, lf = Math.sin(lean) * torsoH, lz = (1 - Math.cos(lean)) * torsoH;
  const hipZ = legH + ride, shoulderZ = hipZ + torsoH - lz;
  // legs: hip → knee → ankle, swinging from the hip; the foot lifted on its way forward
  for (const side of [-1, 1]) {
    const l = side * TW / 4, sw = t == null ? 0 : Math.sin(t * Math.PI * 2 + (side > 0 ? Math.PI : 0)) * stride * (side > 0 && limp < 1 ? limp : 1);
    const lift = t == null ? 0 : Math.max(0, Math.cos(t * Math.PI * 2 + (side > 0 ? Math.PI : 0))) * 1.1 * stride;
    const hip = [0, l, hipZ], ankle = [sw * 2.6, l, 0.7 + lift * 0.6], knee = [sw * 1.3 + lift * 0.9 + 0.2, l, hipZ / 2 + lift * 0.3];
    const lc = side > 0 ? pants : shade(pants, -0.12);
    const bandage = look.bandage && side > 0 ? (face, s, tt) => (tt > 0.45 && tt < 0.75 ? WHITE : null) : null;
    push(limb(hip, knee, 0.95, 0.9, lc, { sides: 6, taper: 0.9, group: G.legs }));
    push(limb(knee, ankle, 0.85, 0.8, lc, { sides: 6, taper: 0.85, tex: bandage, group: G.legs }));
    push(limb(add(ankle, [-0.6, 0, -0.1]), add(ankle, [1.3, 0, -0.1]), 0.55, 0.75, SHOE, { sides: 4, phase: Math.PI / 4, u: [0, 0, 1], group: G.legs }));
  }
  // the torso, leaning into the walk; a robe hangs to the ground instead of legs showing
  const hipP = [0, 0, hipZ], shP = [lf, 0, shoulderZ];
  if (look.robe) push(limb([lf * 0.5, 0, hipZ + 0.5], [0, 0, 0.3], TD / 2 + 0.3, TW / 2 + 0.4, cloth, { taper: 1.25, tex: (face, s, tt) => (tt > 0.9 ? shade(cloth, -0.35) : null) }));
  push(limb(shP, hipP, TD / 2, TW / 2, cloth, { taper: 0.88, tex: (face, s, tt) => (look.sash && face !== "top" && tt > 0.55 && tt < 0.7 ? look.sash : tt > 0.9 && !look.robe ? "#2a2420" : null) }));
  push(limb(add(shP, [0, 0, 0.2]), add(shP, [0, 0, -1]), TD / 2 * 0.9, TW / 2 * 0.98, cloth, { taper: 1.0 })); // the shoulders' round
  if (look.vest) push(limb(add(shP, [0, 0, -0.6]), lerp(shP, hipP, 0.72), TD / 2 + 0.35, TW / 2 + 0.3, look.vest, { taper: 0.95 }));
  // the pack: a box behind the shoulders; a big load rides higher, a bedroll on it; a sack slung over the back
  if (look.bigpack) { push(boxL(add(shP, [-TD / 2 - 0.9, 0, 0.6]), add(shP, [-TD / 2 - 0.9, 0, -3.6]), 1.0, 1.5, PACK, { u: [1, 0, 0], group: G.pack, tex: (face, s, tt) => (face === "back" && Math.abs(s - 0.5) < 0.12 ? shade(PACK, -0.3) : null) })); push(limb(add(shP, [-TD / 2 - 1.0, -1.7, 1.2]), add(shP, [-TD / 2 - 1.0, 1.7, 1.2]), 0.7, 0.7, "#a08a60", { sides: 6, group: G.carry })); }
  else if (look.pack) push(boxL(add(shP, [-TD / 2 - 0.7, 0, -0.4]), add(shP, [-TD / 2 - 0.7, 0, -3.4]), 0.8, 1.2, PACK, { u: [1, 0, 0], group: G.pack }));
  if (look.sack) push(limb(add(shP, [-TD / 2 - 1.2, Lf * 0.6, 0.2]), add(shP, [-TD / 2 - 1.4, Lf * 0.6, -3.4]), 1.3, 1.1, "#a08a60", { sides: 6, taper: 1.2, group: G.carry }));
  // arms: shoulder → elbow → hand; swinging against the legs, or on what they hold
  const armR = 0.65, sideL = TW / 2 + armR + 0.1, dead = pose.dead;
  const SH = (side) => add(shP, [0.2, side * sideL, -0.9]);
  const arm = (side, E, H, col = cloth) => { const S = SH(side); push(limb(S, E, armR, armR, col, { sides: 6, taper: 0.9, group: G.arms, tex: look.band ? (face, s, tt) => (tt > 0.3 && tt < 0.6 ? look.band : null) : null })); push(limb(E, H, armR * 0.9, armR * 0.9, col, { sides: 6, taper: 0.9, group: G.arms })); push(limb(H, add(H, mul([H[0] - E[0], H[1] - E[1], H[2] - E[2]], 0.35)), armR * 0.95, armR * 0.8, skin, { sides: 5, group: G.arms })); };
  const swing = (side, k = 1) => { const sw = t == null ? 0 : Math.sin(t * Math.PI * 2 + (side > 0 ? 0 : Math.PI)) * 1.6 * stride * k; arm(side, add(SH(side), [sw * 0.8, side * 0.2, -2.3]), add(SH(side), [sw * 1.9, side * 0.3, -4.3])); };
  const hang = (side) => arm(side, add(SH(side), [0.1, side * 0.2, -2.3]), add(SH(side), [0.3, side * 0.3, -4.4]));
  const up = (side, Hf, Hz) => arm(side, add(SH(side), [1.0, side * 0.6, -0.4]), add(SH(side), [Hf, side * 0.4, Hz]));
  const W1 = { group: G.weapon }, pole = (A, B, col, r = 0.32) => push(limb(A, B, r, r, col, { sides: 4, ...W1 }));
  const ac = look.armColor || cloth, right = R, left = Lf; // "right": the near hand
  const a = dead ? "reach" : look.arm || "none";
  if (a === "reach") { // the dead: both arms out ahead, hanging a little
    for (const side of [-1, 1]) arm(side, add(SH(side), [2.0, side * 0.2, -1.4]), add(SH(side), [4.2, side * 0.1, -2.4]), cloth);
  } else if (a === "rifle") { // low ready: the right hand on the grip, the left out to the fore-end
    const butt = add(shP, [-0.6, R * 1.4, -1.6]), muzzle = add(shP, [5.0, R * 1.0, -2.6]);
    arm(right, add(SH(right), [0.6, R * 0.5, -2.4]), add(lerp(butt, muzzle, 0.3), [0, R * 0.4, -0.5]));
    arm(left, add(SH(left), [1.4, R * 0.4, -2.6]), add(lerp(butt, muzzle, 0.66), [0, R * 0.2, -0.5]));
    push(boxL(butt, muzzle, 0.5, 0.35, GUN, { u: [0, 0, 1], ...W1, tex: (face) => (face === "top" ? shade(GUN, 0.45) : null) }));
  } else if (a === "raised") { // a club or a blade swung up in the right fist
    up(right, 0.8, 2.2); swing(left, 0.6);
    const H = add(SH(right), [0.8, R * 0.4, 2.2]);
    push(boxL(H, add(H, [1.4, 0, 3.2]), 0.4, 0.3, STEEL, { u: [1, 0, 0], ...W1, tex: (face) => (face === "top" ? WHITE : null) }));
  } else if (a === "spear" || a === "fork" || a === "banner" || a === "torch") { // a pole in the right hand, upright
    const H = add(SH(right), [1.2, R * 0.3, -2.6]);
    arm(right, add(SH(right), [0.8, R * 0.6, -1.6]), H); swing(left, 0.7);
    const top = a === "banner" ? 9.5 : a === "torch" ? 8.0 : 6.5; // the torch and the banner rise above the head
    pole(add(H, [0, 0, -3]), add(H, [0, 0, top]), WOOD);
    if (a === "spear") pole(add(H, [0, 0, top]), add(H, [0, 0, top + 1.6]), STEEL, 0.28);
    if (a === "fork") for (const dl of [-0.6, 0, 0.6]) pole(add(H, [0, dl, top]), add(H, [0, dl, top + 1.4]), METAL, 0.2);
    if (a === "banner") push(boxL(add(H, [0.1, 0, top]), add(H, [0.1, 0, top - 3.2]), 0.12, 1.6, ac, { u: [1, 0, 0], ...W1, tex: (face, s, tt) => (tt > 0.85 ? shade(ac, -0.3) : Math.abs(s - 0.5) < 0.2 && tt > 0.3 && tt < 0.6 ? GOLD : null) }));
    if (a === "torch") { push(limb(add(H, [0, 0, top]), add(H, [0, 0, top + 1.6]), 0.8, 0.8, FIRE_RED, { sides: 5, taper: 0.5, tex: (face, s, tt) => (tt < 0.5 ? FIRE : null) })); push(limb(add(H, [0, 0, top + 1.5]), add(H, [0.2, 0, top + 2.4]), 0.45, 0.45, FIRE_HOT, { sides: 4, taper: 0.3 })); }
  } else if (a === "shield") { // a shield on the left arm, a hand weapon in the right
    arm(right, add(SH(right), [1.2, R * 0.4, -2.0]), add(SH(right), [2.0, R * 0.6, -3.2]));
    push(boxL(add(SH(right), [2.6, R * 1.2, -0.6]), add(SH(right), [2.6, R * 1.2, -5.0]), 0.2, 1.4, ac, { u: [1, 0, 0], ...W1, tex: (face, s, tt) => (Math.abs(s - 0.5) < 0.15 && Math.abs(tt - 0.5) < 0.15 ? STEEL : null) }));
    hang(left);
    pole(add(SH(left), [0.6, Lf * 0.6, -4.2]), add(SH(left), [1.0, Lf * 0.6, 0.4]), STEEL, 0.28);
  } else if (a === "binoc") { // both hands up to the face
    for (const side of [-1, 1]) arm(side, add(SH(side), [1.4, side * 0.2, -1.6]), add(shP, [1.6, side * 0.6, torsoH * 0.1 + 1.4]));
    push(boxL(add(shP, [1.8, -0.9, torsoH * 0.1 + 1.9]), add(shP, [1.8, 0.9, torsoH * 0.1 + 1.9]), 0.4, 0.45, "#2a2a2e", { u: [0, 0, 1], ...W1 }));
  } else if (a === "staff") { // a walking stick in the right hand, planted ahead
    const H = add(SH(right), [1.0, R * 0.4, -3.0]);
    arm(right, add(SH(right), [0.6, R * 0.5, -1.8]), H); swing(left, 0.8);
    pole(add(H, [0.8, 0, -legH - torsoH + 2.4]), add(H, [-0.2, 0, 1.6]), WOOD, 0.3);
  } else if (a === "bar") { // a crowbar hanging from the right hand
    hang(right); swing(left, 0.8);
    pole(add(SH(right), [0.5, R * 0.5, -4.6]), add(SH(right), [0.9, R * 0.5, -8.0]), METAL, 0.28);
  } else if (a === "axe") { // an axe over the right shoulder
    arm(right, add(SH(right), [1.0, R * 0.4, -1.4]), add(SH(right), [0.4, R * 0.6, 0.8])); swing(left, 0.8);
    pole(add(SH(right), [1.6, R * 0.6, -0.6]), add(SH(right), [-2.4, R * 0.8, 2.6]), WOOD, 0.3);
    push(boxL(add(SH(right), [-2.4, R * 1.4, 2.6]), add(SH(right), [-2.4, 0.0, 2.6]), 0.9, 0.3, STEEL, { u: [0, 0, 1], ...W1 }));
  } else if (a === "rod") { // a fishing rod over the shoulder, the line hanging
    arm(right, add(SH(right), [1.0, R * 0.4, -1.4]), add(SH(right), [0.4, R * 0.6, 0.8])); swing(left, 0.8);
    pole(add(SH(right), [1.4, R * 0.6, -0.4]), add(SH(right), [-5.0, R * 0.6, 4.2]), "#c8b48a", 0.22);
    if (!look.load) pole(add(SH(right), [-5.0, R * 0.6, 4.2]), add(SH(right), [-5.2, R * 0.6, 1.4]), "#e8e4da80", 0.12);
  } else if (a === "basket") { // a basket on the right arm
    arm(right, add(SH(right), [0.8, R * 0.4, -2.2]), add(SH(right), [1.6, R * 0.4, -2.8])); swing(left, 0.8);
    push(limb(add(SH(right), [1.6, R * 0.3, -3.2]), add(SH(right), [1.6, R * 0.3, -5.4]), 1.1, 1.0, "#a0784a", { sides: 6, taper: 0.8, ...W1, tex: (face, s, tt) => (face === "top" && look.load ? [RED, "#5f9a3c", "#7a3a8a"][Math.round(s * 2)] : null) }));
  } else if (a === "buckets") { // a bucket in each hand
    for (const side of [-1, 1]) { hang(side); push(limb(add(SH(side), [0.3, side * 0.5, -4.8]), add(SH(side), [0.3, side * 0.5, -6.8]), 0.9, 0.9, "#8a9096", { sides: 6, taper: 0.85, ...W1, tex: (face) => (face === "top" && look.load ? "#5aa0d8" : null) })); }
  } else if (a === "lamp") { // a lantern in the leading hand, lit
    arm(right, add(SH(right), [1.2, R * 0.4, -2.0]), add(SH(right), [2.4, R * 0.4, -2.8])); swing(left, 0.8);
    push(boxL(add(SH(right), [2.6, R * 0.4, -3.2]), add(SH(right), [2.6, R * 0.4, -4.6]), 0.5, 0.5, "#f6f2d0", { u: [1, 0, 0], ...W1 }));
  } else { swing(right); swing(left); }
  if (look.carry === "logs") push(limb(add(shP, [-2.6, R * 2.2, 1.2]), add(shP, [2.6, R * 2.2, 1.6]), 0.9, 0.9, LOG, { sides: 6, group: G.carry, tex: (face, s, tt) => (tt < 0.06 || tt > 0.94 ? "#c8a070" : (Math.round(s * 5) + Math.round(tt * 9)) % 4 === 0 ? shade(LOG, -0.25) : null) }));
  if (look.carry === "game") { const hide = "#8a6a48", C = { sides: 6, group: G.carry }; push(limb(add(shP, [-2.4, 0, 1.4]), add(shP, [2.6, 0, 1.6]), 1.0, 1.2, hide, { ...C, tex: (face) => (face === "top" ? shade(hide, 0.2) : null) })); push(limb(add(shP, [2.6, 0, 1.6]), add(shP, [3.6, 0, 0.2]), 0.5, 0.5, hide, { ...C, sides: 4 })); push(limb(add(shP, [-2.4, R * 0.8, 1.2]), add(shP, [-2.6, R * 0.8, -1.4]), 0.3, 0.3, shade(hide, -0.3), { ...C, sides: 4 })); push(limb(add(shP, [3.8, 0.3, 0.6]), add(shP, [4.6, 0.6, 1.8]), 0.2, 0.2, BONE, { ...C, sides: 4 })); }
  if (look.carry === "fish") for (let i = 0; i < 3; i++) push(limb(add(SH(right), [0.6, R * 0.5, -4.8 - i * 0.6]), add(SH(right), [1.6, R * 0.5, -5.4 - i * 0.6]), 0.35, 0.25, i % 2 ? "#aab8c0" : "#8a9aa4", { sides: 4, group: G.carry }));
  if (look.carry === "small") push(limb(add(SH(right), [0.5, R * 0.5, -4.6]), add(SH(right), [0.7, R * 0.5, -6.4]), 0.5, 0.4, "#8a6a48", { sides: 5, taper: 0.7, group: G.carry }));
  // the neck and the head: the face on the front; tipped forward on the dead
  const drop = dead ? 0.8 : 0, hz = shoulderZ + 0.6 - drop, hf = lf + (dead ? 0.8 : 0) + (pose.lean ? 0.3 : 0);
  push(limb([lf, 0, shoulderZ + 0.8], [lf, 0, shoulderZ - 0.4], 0.8, 0.9, shade(skin, -0.12), { sides: 5 }));
  const eye = dead ? look.eye || "#e8e07a" : "#1a1a1a", hat = look.hat || "";
  const hairy = hat !== "hood" && hat !== "helmet" && !dead;
  push(limb([hf, 0, hz + headS], [hf, 0, hz], headS / 2 * 0.95, headS / 2, skin, {
    taper: 1.05, group: G.head,
    tex: (face, s, tt) => {
      if (face === "front" && tt > 0.38 && tt < 0.62 && (Math.abs(s - 0.3) < 0.16 || Math.abs(s - 0.7) < 0.16)) return eye;
      if (dead && face === "front" && tt > 0.72 && Math.abs(s - 0.5) < 0.25) return "#3a1210";
      if (hairy && (face === "top" || tt < (face === "back" ? 0.45 : face === "front" ? 0.12 : 0.24))) return face === "top" ? shade(hair, 0.15) : hair;
      return null;
    },
  }));
  const hc = look.hatColor || cloth;
  const HT = { group: G.hat };
  if (hat === "helmet") { push(limb([hf, 0, hz + headS + 0.7], [hf, 0, hz + headS * 0.45], headS / 2 + 0.35, headS / 2 + 0.4, hc, { ...HT, taper: 1.1, tex: (face) => (face === "top" ? shade(hc, 0.1) : null) })); push(limb([hf, 0, hz + headS * 0.5], [hf, 0, hz + headS * 0.4], headS / 2 + 0.8, headS / 2 + 0.8, shade(hc, -0.2), { ...HT, sides: 8 })); }
  else if (hat === "hood") push(limb([hf, 0, hz + headS + 0.8], [hf, 0, hz + headS * 0.15], headS / 2 + 0.5, headS / 2 + 0.5, hc, { ...HT, taper: 1.1, tex: (face, s, tt) => (face === "front" && tt > 0.3 ? skin : null) }));
  else if (hat === "straw") { push(limb([hf, 0, hz + headS + 1.0], [hf, 0, hz + headS - 0.2], headS / 2 * 0.75, headS / 2 * 0.8, HAY, { ...HT, taper: 1.3 })); push(limb([hf, 0, hz + headS + 0.1], [hf, 0, hz + headS - 0.3], headS / 2 + 1.3, headS / 2 + 1.3, shade(HAY, -0.1), { ...HT, sides: 8 })); }
  else if (hat === "cap") { push(limb([hf, 0, hz + headS + 0.8], [hf, 0, hz + headS - 0.4], headS / 2 + 0.15, headS / 2 + 0.2, hc, { ...HT, taper: 1.08 })); push(boxL([hf + headS / 2 - 0.2, 0, hz + headS - 0.3], [hf + headS / 2 + 1.4, 0, hz + headS - 0.5], 0.15, 0.9, shade(hc, -0.2), { ...HT, u: [0, 0, 1] })); }
  else if (hat === "mohawk") push(boxL([hf + headS * 0.4, 0, hz + headS + 0.3], [hf - headS * 0.4, 0, hz + headS + 0.3], 1.0, 0.35, hc, { ...HT, u: [0, 0, 1] }));
  else if (hairy) push(limb([hf, 0, hz + headS + 0.6], [hf, 0, hz + headS - 0.2], headS / 2 * 0.8, headS / 2 * 0.82, hair, { group: G.head, taper: 1.2 })); // the crown
}

// ---------- a quadruped ----------
// kind: "mule" | "ox" | "deer" | "hog" (herds: gaunt and sore). pose.t: the trot's phase (null standing).
function beast(push, kind, pose = {}, o = {}) {
  const t = pose.t, deer = kind === "deer", hog = kind === "hog", mule = kind === "mule";
  const hide = o.hide || (deer ? "#7f796e" : hog ? "#6e6860" : mule ? "#7a5a40" : "#6a4a34");
  const L = hog ? 6 : deer ? 6.5 : 7.5, H = hog ? 3.4 : deer ? 5.4 : 5.8, R = hog ? 1.9 : deer ? 1.3 : 1.8, legR = hog ? 0.55 : 0.5;
  const sick = o.sick;
  push(limb([-L / 2, 0, H], [L / 2, 0, H + 0.2], R * 1.15, R, hide, { sides: 8, taper: 0.95, tex: (face, s, tt) => (sick && (((face === "left" || face === "right") && Math.abs(tt - 0.36) < 0.05) || (face === "top" && Math.abs(tt - 0.7) < 0.05)) ? "#9a2a2c" : sick && (face === "left" || face === "right") && tt > 0.42 && tt < 0.78 && Math.round(tt * 14) % 2 === 0 ? shade(hide, -0.28) : face === "bottom" ? shade(hide, -0.3) : null) })); // sores, the ribs showing
  for (const [f, side, ph] of [[L / 2 - 0.9, -1, 0], [L / 2 - 0.9, 1, Math.PI], [-L / 2 + 0.9, -1, Math.PI], [-L / 2 + 0.9, 1, 0]]) {
    const sw = t == null ? 0 : Math.sin(t * Math.PI * 2 + ph) * 1.6, lift = t == null ? 0 : Math.max(0, Math.cos(t * Math.PI * 2 + ph)) * 0.8;
    const l = side * R * 0.7, hip = [f, l, H - R * 0.4], knee = [f + sw * 0.4, l, H / 2 + lift * 0.4], foot = [f + sw, l, 0.3 + lift];
    push(limb(hip, knee, legR * 1.3, legR * 1.2, hide, { sides: 5, taper: 0.8, group: G.legs })); push(limb(knee, foot, legR, legR, shade(hide, -0.25), { sides: 5, taper: 0.8, group: G.legs }));
  }
  // the neck and the head: a herd's hang low; the mule and the ox carry theirs forward
  const low = o.sick || deer || hog, nz = low ? H - 1.2 : H + 1.6, nf = L / 2 + (low ? 1.6 : 1.4);
  push(limb([L / 2 - 0.4, 0, H + 0.4], [nf, 0, nz], R * 0.6, R * 0.55, hide, { sides: 6, taper: 0.85 }));
  const hl = hog ? 1.6 : 2.0, hr = hog ? 0.9 : 0.75;
  push(limb([nf, 0, nz], [nf + hl, 0, nz - (low ? 1.0 : 0.3)], hr, hr * 0.9, hide, { sides: 6, taper: 0.7, group: G.head, tex: (face, s, tt) => (tt > 0.3 && tt < 0.5 && (face === "left" || face === "right") ? (sick ? "#ff6a3a" : "#1a1a1a") : hog && tt > 0.9 ? shade(hide, 0.25) : null) }));
  if (deer) for (const side of [-1, 1]) { push(limb([nf + 0.2, side * 0.5, nz + 0.4], [nf - 0.6, side * 1.4, nz + 2.4], 0.22, 0.22, BONE, { sides: 4 })); push(limb([nf - 0.2, side * 0.95, nz + 1.4], [nf + 0.6, side * 1.6, nz + 2.4], 0.18, 0.18, BONE, { sides: 4 })); }
  if (mule || kind === "ox") for (const side of [-1, 1]) push(limb([nf + 0.2, side * 0.6, nz + 0.6], [nf - 0.2 + (mule ? 0 : 0.6), side * (mule ? 0.9 : 1.6), nz + (mule ? 1.9 : 1.2)], 0.22, mule ? 0.35 : 0.2, mule ? hide : BONE, { sides: 4 }));
  push(limb([-L / 2 - 0.2, 0, H + 0.6], [-L / 2 - 1.2, 0.2, H - 1.4], 0.25, 0.25, shade(hide, -0.3), { sides: 4 })); // the tail
  if (o.packs) { push(boxL([-0.4, -R - 0.8, H + 0.6], [-0.4, R + 0.8, H + 0.6], 1.1, 1.3, "#8c7a52", { u: [0, 0, 1], group: 1, tex: (face) => (face === "top" ? shade("#8c7a52", 0.25) : null) })); push(boxL([-0.4, -R - 0.9, H + 1.2], [-0.4, R + 0.9, H + 1.2], 0.25, 0.3, o.packs, { u: [0, 0, 1], group: 1 })); }
}

// ---------- vehicles ----------
// A wheel: a short 8-sided limb across the axle, its flats turning with the frame; the end faces a tyre with a hub
// whose spokes turn too. f, l the hub; r the radius; tw the tyre's width.
function wheel(push, f, l, r, tw, t) {
  const turn = t == null ? 0 : t * Math.PI * 2;
  push(limb([f, l - tw / 2, r], [f, l + tw / 2, r], r, r, TIRE, {
    sides: 8, phase: turn / 2, group: G.wheels,
    tex: (face, s, tt) => {
      if (face !== "left" && face !== "right") return null;
      const dx = s - 0.5, dy = tt - 0.5, d = Math.hypot(dx, dy) * 2, ang = Math.atan2(dy, dx) + turn;
      if (d < 0.28) return HUB;
      const T3 = (Math.PI * 2) / 3, a3 = ((ang % T3) + T3) % T3; // three spokes: a turn of 45° a frame reads as turning (four would repeat every other frame)
      if (d < 0.68 && (a3 < 0.32 || a3 > T3 - 0.32)) return shade(HUB, -0.25);
      return d < 0.7 ? "#3a3a3e" : null;
    },
  }));
}
// A cab's window on a face: glass with a lit corner; meshed over or armoured glass with upgrades.
// A cab is a vertical box (A its top, B its bottom, u forward), so its side faces get s along it and t down it.
const glassTex = (ups, extra = null, roof = null) => (face, s, t) => {
  if (face === "top") return roof;
  if (face === "bottom") return extra ? extra(face, s, t) : null;
  const win = t > 0.06 && t < 0.55 && s > 0.1 && s < 0.9;
  if (!win) return extra ? extra(face, s, t) : null;
  if (ups.mesh) return (Math.round(s * 6) + Math.round(t * 6)) % 2 ? MESH : GLASS;
  return ups.glass ? BGLASS : s < 0.3 && t < 0.25 ? "#d4e6f0" : GLASS;
};
// The end of a box along the way (s up the face, t across it): the lamps at the front, the tail lights behind.
const endTex = (lamp, tail, dark = null) => (face, s, t) => (face === "bottom" ? dark : face === "front" && Math.abs(t - 0.5) > 0.3 && Math.abs(s - 0.55) < 0.2 ? lamp : face === "back" && Math.abs(t - 0.5) > 0.3 && Math.abs(s - 0.55) < 0.2 ? tail : null);
// plates (p), scrap (s): the body's sides armoured; a gun on the roof (t): a ring, a shield and a barrel forward.
function armour(push, ups, x0, x1, hw, z0, z1, roof) {
  const n = ups.plating || 0, sc = ups.scrapPlate || 0;
  if (sc || n) for (const side of [-1, 1]) push(boxL([x0, side * (hw + 0.3), (z0 + z1) / 2], [x1, side * (hw + 0.3), (z0 + z1) / 2], (z1 - z0) / 2, 0.15, sc ? SCRAP_A : PLATE, { u: [0, 0, 1], tex: (face, s, t) => (sc ? ((Math.round(s * 3) + Math.round(t * 9)) % 2 ? SCRAP_B : null) : Math.round(t * 7) % 2 ? PLATE_DK : null) }));
  if (ups.turret && roof) { const [f, z] = roof; push(limb([f, 0, z + 1.0], [f, 0, z], 1.1, 1.1, PLATE_DK, { sides: 8, group: G.weapon })); push(boxL([f - 0.3, 0, z + 1.2], [f + (ups.turret.gun === "m2hb" ? 4.6 : 3.4), 0, z + 1.2], 0.25, 0.22, "#26272a", { u: [0, 0, 1], group: G.weapon })); }
}
// A pickup: a bed behind the cab, the bonnet ahead, four wheels. body: colour; bed(push) paints the load.
function pickup(push, body, t, ups = {}, bed = null) {
  const dark = shade(body, -0.3), L = 14, HW = 3.0;
  push(boxL([-L / 2, 0, 3.0], [L / 2, 0, 3.0], 1.0, HW, body, { u: [0, 0, 1], tex: endTex(LAMP, TAIL, dark) })); // the body
  push(boxL([-L / 2 + 0.3, 0, 4.5], [-0.5, 0, 4.5], 0.5, HW - 0.1, body, { u: [0, 0, 1], group: G.rails, tex: (face) => (face === "top" ? shade(body, -0.25) : null) })); // the bed's rails
  push(boxL([1.65, 0, 7.4], [1.65, 0, 4.0], 1.95, HW - 0.3, body, { u: [1, 0, 0], group: G.cab, tex: glassTex(ups, null, shade(body, 0.2)) })); // the cab
  push(boxL([3.6, 0, 4.7], [L / 2 - 0.2, 0, 4.7], 0.7, HW - 0.15, shade(body, 0.1), { u: [0, 0, 1], group: G.bonnet, tex: (face) => (face === "top" ? shade(body, 0.25) : null) })); // the bonnet
  if (bed) bed(push, -L / 2 + 0.6, -0.6);
  for (const f of [-4.2, 4.2]) for (const side of [-1, 1]) wheel(push, f, side * (HW + 0.6), 1.7, 1.2, t);
  armour(push, ups, -L / 2, L / 2, HW, 2.0, 4.0, [1.6, 7.4]);
}
function sedan(push, body, t, ups = {}) {
  const dark = shade(body, -0.3), L = 13, HW = 2.9;
  push(boxL([-L / 2, 0, 2.9], [L / 2, 0, 2.9], 1.0, HW, body, { u: [0, 0, 1], tex: endTex(LAMP, TAIL, dark) }));
  push(boxL([-0.4, 0, 6.4], [-0.4, 0, 3.9], 3.0, HW - 0.4, body, { u: [1, 0, 0], group: G.cab, tex: glassTex(ups, null, shade(body, 0.2)) }));
  push(boxL([2.6, 0, 4.2], [L / 2 - 0.2, 0, 4.2], 0.35, HW - 0.1, shade(body, 0.1), { u: [0, 0, 1], group: G.bonnet, tex: (face) => (face === "top" ? shade(body, 0.25) : null) }));
  push(boxL([-L / 2 + 0.2, 0, 4.2], [-3.4, 0, 4.2], 0.3, HW - 0.1, body, { u: [0, 0, 1], group: G.rails, tex: (face) => (face === "top" ? shade(body, 0.15) : null) }));
  for (const f of [-4.0, 4.0]) for (const side of [-1, 1]) wheel(push, f, side * (HW + 0.6), 1.6, 1.2, t);
  armour(push, ups, -L / 2, L / 2, HW, 1.9, 3.9, [-0.4, 6.4]);
}
// An Army cargo truck: a tall square cab, a canvas-covered bed on six wheels, a white star on the door.
function milTruck(push, color, t, ups = {}) {
  const body = OLIVE, dark = shade(body, -0.3), L = 17, HW = 3.2, canvas = mixHex(CANVAS, color, 0.15);
  push(boxL([-L / 2, 0, 3.4], [L / 2, 0, 3.4], 1.0, HW, body, { u: [0, 0, 1], tex: (face) => (face === "bottom" ? dark : null) }));
  push(boxL([-L / 2 + 0.3, 0, 6.6], [2.0, 0, 6.6], 2.2, HW - 0.1, canvas, { u: [0, 0, 1], group: G.load, tex: (face, s, tt) => (face === "top" ? shade(canvas, 0.2) : (face === "left" || face === "right") && Math.round(tt * 10) % 3 === 0 ? shade(canvas, -0.18) : null) }));
  push(boxL([4.1, 0, 9.2], [4.1, 0, 4.4], 1.9, HW - 0.2, body, { u: [1, 0, 0], group: G.cab, tex: glassTex(ups, (face, s, tt) => ((face === "left" || face === "right") && tt > 0.6 && tt < 0.9 && Math.abs(s - 0.5) < 0.2 ? WHITE : null), shade(body, 0.2)) }));
  push(boxL([6.0, 0, 4.8], [L / 2 - 0.2, 0, 4.8], 0.7, HW - 0.2, body, { u: [0, 0, 1], group: G.bonnet, tex: endTex(LAMP, null, null) }));
  for (const f of [-5.6, -2.0, 5.8]) for (const side of [-1, 1]) wheel(push, f, side * (HW + 0.7), 2.0, 1.3, t);
  armour(push, ups, -L / 2, L / 2, HW, 2.4, 4.4, [4.0, 9.2]);
}
function humvee(push, c, t) {
  const body = mixHex(OLIVE_DARK, c, 0.25), L = 14, HW = 3.5;
  push(boxL([-L / 2, 0, 4.0], [L / 2, 0, 4.0], 1.3, HW, body, { u: [0, 0, 1], tex: endTex(LAMP, null, shade(body, -0.3)) }));
  push(boxL([-1.1, 0, 7.8], [-1.1, 0, 5.3], 3.5, HW - 0.2, body, { u: [1, 0, 0], group: G.cab, tex: glassTex({}, null, shade(body, 0.2)) }));
  push(boxL([2.4, 0, 5.6], [L / 2 - 0.4, 0, 5.6], 0.3, HW - 0.1, shade(body, 0.08), { u: [0, 0, 1], group: G.bonnet }));
  push(limb([-1.2, 0, 8.9], [-1.2, 0, 7.8], 1.3, 1.3, PLATE_DK, { sides: 8, group: G.weapon })); push(boxL([-1.4, 0, 8.9], [2.6, 0, 9.1], 0.25, 0.22, "#26272a", { u: [0, 0, 1], group: G.weapon })); // the ring and the gun
  for (const f of [-4.4, 4.4]) for (const side of [-1, 1]) wheel(push, f, side * (HW + 0.7), 2.1, 1.4, t);
}
function mrap(push, c, t) {
  const body = mixHex("#4a4e3c", c, 0.2), L = 16, HW = 3.6;
  push(boxL([-L / 2, 0, 4.8], [L / 2, 0, 4.8], 1.4, HW - 0.4, body, { u: [0, 0, 1], tex: (face) => (face === "bottom" ? shade(body, -0.3) : null) })); // the V hull
  push(boxL([-2.3, 0, 9.9], [-2.3, 0, 6.2], 5.9, HW, body, { u: [1, 0, 0], group: G.cab, tex: (face, s, tt) => (face === "top" ? shade(body, 0.2) : (face === "left" || face === "right") && tt > 0.12 && tt < 0.32 && Math.round(s * 9) % 2 === 0 && s > 0.1 && s < 0.9 ? BGLASS : null) })); // the crew box, slit windows
  push(boxL([5.6, 0, 8.7], [5.6, 0, 6.2], 2.1, HW - 0.2, shade(body, 0.05), { u: [1, 0, 0], group: G.bonnet, tex: (face, s, tt) => (face === "front" && tt > 0.1 && tt < 0.45 && Math.abs(s - 0.5) < 0.42 ? BGLASS : face === "top" ? shade(body, 0.15) : null) }));
  push(limb([-0.6, 0, 11.0], [-0.6, 0, 9.9], 1.3, 1.3, PLATE_DK, { sides: 8, group: G.weapon })); push(boxL([-0.8, 0, 11.0], [3.6, 0, 11.2], 0.25, 0.22, "#26272a", { u: [0, 0, 1], group: G.weapon }));
  for (const f of [-5.0, 5.0]) for (const side of [-1, 1]) wheel(push, f, side * (HW + 0.7), 2.4, 1.5, t);
}
// Spiked pickup with scrap plating and a pipe cage over the bed.
function raiderTruck(push, c, t) {
  pickup(push, c, t, { scrapPlate: 1 }, (push, bx) => {
    const CG = { sides: 4, group: G.rails };
    for (const f of [bx + 0.5, bx + 5.5]) for (const side of [-1, 1]) push(limb([f, side * 2.6, 4.2], [f, side * 2.6, 7.6], 0.25, 0.25, METAL, CG));
    for (const side of [-1, 1]) push(limb([bx + 0.5, side * 2.6, 7.6], [bx + 5.5, side * 2.6, 7.6], 0.25, 0.25, METAL, CG));
    push(limb([bx + 0.5, -2.6, 7.6], [bx + 0.5, 2.6, 7.6], 0.25, 0.25, METAL, CG));
    for (const l of [-2.2, -0.8, 0.8, 2.2]) push(limb([7.2, l, 3.2], [8.9, l, 2.8], 0.3, 0.3, STEEL, { sides: 4, taper: 0.2, group: G.weapon })); // the spikes on the bumper
  });
}
function armoredTruck(push, c, t) {
  const body = mixHex("#5a6068", c, 0.3), L = 15, HW = 3.2;
  push(boxL([-L / 2, 0, 3.4], [L / 2, 0, 3.4], 1.2, HW, body, { u: [0, 0, 1], tex: (face) => (face === "bottom" ? shade(body, -0.3) : null) }));
  push(boxL([-2.45, 0, 8.2], [-2.45, 0, 4.6], 4.95, HW - 0.1, PLATE, { u: [1, 0, 0], group: G.load, tex: (face, s, tt) => ((face === "left" || face === "right") && Math.round(s * 8) % 2 === 0 && tt > 0.35 && tt < 0.65 ? PLATE_DK : face === "top" ? shade(PLATE, 0.15) : null) })); // the plated box, rivets along it
  push(boxL([4.9, 0, 7.8], [4.9, 0, 4.6], 2.3, HW - 0.2, body, { u: [1, 0, 0], group: G.cab, tex: glassTex({ mesh: 1 }, null, shade(body, 0.2)) }));
  for (const f of [-4.6, 4.6]) for (const side of [-1, 1]) wheel(push, f, side * (HW + 0.7), 1.9, 1.3, t);
  push(boxL([-L / 2 - 0.4, -HW, 3.6], [-L / 2 - 0.4, HW, 3.6], 0.9, 0.3, c, { u: [0, 0, 1], group: G.rails })); // the group's colour on the tailgate
}
// A traders' covered wagon behind two horses (mules here), a lantern on a pole.
function wagon(push, c, t, o = {}) {
  const canvas = o.canvas || mixHex("#cfc7b4", c, 0.35), L = 9, HW = 2.8;
  const bx = o.bx ?? -4.5;
  push(boxL([bx - L / 2, 0, 3.6], [bx + L / 2, 0, 3.6], 0.6, HW, WOOD, { u: [0, 0, 1], group: G.deck, tex: (face) => (face === "top" ? WOOD_LIT : null) }));
  push(boxL([bx, 0, 9.6], [bx, 0, 4.2], L / 2 - 0.4, HW - 0.1, canvas, { u: [1, 0, 0], group: G.load, tex: (face, s, tt) => (face === "top" ? shade(canvas, 0.25) : (face === "left" || face === "right") && Math.round(s * 9) % 3 === 0 ? shade(canvas, -0.18) : face === "front" || face === "back" ? shade(canvas, -0.1) : null) })); // the canvas over hoops
  for (const f of [bx - 2.8, bx + 2.8]) for (const side of [-1, 1]) wheel(push, f, side * (HW + 0.6), 2.0, 0.7, t);
  push(limb([bx + L / 2, 0, 2.8], [bx + L / 2 + 3.2, 0, 2.8], 0.25, 0.25, WOOD, { sides: 4 })); // the shaft
  push(limb([bx + L / 2 + 0.5, -0.5, 7.0], [bx + L / 2 + 0.5, -0.5, 10.4], 0.2, 0.2, METAL, { sides: 4 })); push(limb([bx + L / 2 + 0.5, -0.5, 10.4], [bx + L / 2 + 0.5, -0.5, 11.4], 0.5, 0.5, FIRE, { sides: 4, tex: (face) => (face === "top" ? FIRE_HOT : null) })); // the lantern
  if (o.crates) push(boxL([bx - L / 2 - 1.2, 0, 2.2], [bx - L / 2 - 1.2, 0, 4.8], 0.9, 1.4, WOOD_LIT, { u: [1, 0, 0], group: G.carry, tex: (face, s, tt) => (Math.abs(tt - 0.5) < 0.08 ? shade(WOOD_LIT, -0.3) : null) }));
}
function tractor(push, c, t) {
  const body = mixHex("#b33a2a", c, 0.35), dark = shade(body, -0.3);
  push(boxL([-3.0, 0, 4.0], [5.0, 0, 4.0], 1.2, 1.9, body, { u: [0, 0, 1], group: G.bonnet, tex: (face) => (face === "bottom" ? dark : face === "top" ? shade(body, 0.2) : null) })); // the engine
  push(limb([-1.6, 0, 5.2], [-1.6, 0, 8.6], 0.3, 0.3, "#3a3a3a", { sides: 4 })); push(boxL([-2.2, 0, 8.8], [0.6, 0, 8.8], 0.2, 2.0, body, { u: [0, 0, 1] })); // the roll frame and canopy
  push(boxL([-2.6, 0, 5.4], [-1.2, 0, 5.4], 0.3, 1.0, "#2a2a2a", { u: [0, 0, 1] })); // the seat
  push(limb([5.0, 0, 4.8], [5.6, 0, 4.8], 0.5, 0.5, "#3a3a3a", { sides: 6 })); // the exhaust stack base
  push(limb([2.6, 0.8, 5.2], [2.6, 0.8, 7.8], 0.3, 0.3, "#3a3a3a", { sides: 4 }));
  for (const side of [-1, 1]) { wheel(push, -3.2, side * 2.9, 3.0, 1.4, t); wheel(push, 4.0, side * 2.2, 1.6, 0.9, t); }
}
// The zealots' cart: a two-wheeled cart with a shrine box and a banner, two of the faithful pulling it.
function zealotCart(push, c, t) {
  const canvas = "#cfc7b4";
  push(boxL([-4.5, 0, 3.0], [0.5, 0, 3.0], 0.4, 2.2, WOOD, { u: [0, 0, 1], group: G.deck, tex: (face) => (face === "top" ? WOOD_LIT : null) }));
  push(boxL([-2.2, 0, 7.0], [-2.2, 0, 3.4], 1.8, 1.8, canvas, { u: [1, 0, 0], tex: (face, s, tt) => (face === "top" ? shade(canvas, 0.2) : face !== "bottom" && Math.abs(s - 0.5) < 0.14 && tt > 0.2 && tt < 0.8 ? c : null) })); // the shrine box, a stripe of the colour down each side
  for (const side of [-1, 1]) wheel(push, -2.0, side * 2.8, 2.0, 0.6, t);
  push(limb([-3.6, 0, 7.0], [-3.6, 0, 12.4], 0.22, 0.22, WOOD, { sides: 4, group: G.weapon })); push(boxL([-3.5, 0, 12.4], [-3.5, 0, 9.6], 0.12, 1.3, c, { u: [1, 0, 0], group: G.weapon }));
  for (const side of [-1, 1]) push(limb([0.5, side * 1.4, 3.0], [3.4, side * 1.0, 3.6], 0.2, 0.2, WOOD, { sides: 4 })); // the shafts
}
// A handcart: a flat bed on two wheels with a load, its shafts ahead for the one pulling it.
function handcart(push, t, load) {
  push(boxL([-3.2, 0, 2.8], [1.8, 0, 2.8], 0.35, 2.0, WOOD, { u: [0, 0, 1], group: G.deck, tex: (face) => (face === "top" ? WOOD_LIT : null) }));
  for (const side of [-1, 1]) wheel(push, -0.6, side * 2.6, 1.7, 0.6, t);
  for (const side of [-1, 1]) push(limb([1.8, side * 1.4, 2.8], [4.4, side * 1.1, 3.4], 0.2, 0.2, WOOD, { sides: 4 }));
  const LD = { group: G.load };
  if (load === "supply") { for (const [f, l, col] of [[-2.0, -0.8, RUST], [-2.0, 0.9, "#3a68a8"], [0.2, 0, RUST]]) push(limb([f, l, 3.2], [f, l, 5.6], 0.8, 0.8, col, { ...LD, sides: 8, tex: (face) => (face === "top" ? shade(col, -0.3) : null) })); }
  else if (load === "bundles") { push(limb([-1.6, -0.6, 3.2], [-1.6, -0.6, 5.4], 1.3, 1.2, "#8a7a6a", { ...LD, sides: 6, taper: 0.8 })); push(limb([0.4, 0.6, 3.2], [0.4, 0.6, 4.8], 1.0, 1.0, "#6a7a8a", { ...LD, sides: 6, taper: 0.8 })); }
  else { push(boxL([-2.4, 0, 3.2], [-2.4, 0, 5.8], 1.0, 1.3, WOOD_LIT, { ...LD, u: [1, 0, 0], tex: (face, s, tt) => (Math.abs(tt - 0.5) < 0.08 ? shade(WOOD_LIT, -0.3) : null) })); push(boxL([0.2, 0, 3.2], [0.2, 0, 4.8], 0.8, 1.0, shade(WOOD_LIT, -0.1), { ...LD, u: [1, 0, 0] })); }
}
// A rowboat with two rowers, the oars pulling with the frame; or a raft of logs with the vehicle on it and a poler.
function boat(push, color, t, raft) {
  if (raft) {
    for (const l of [-3.2, -1.6, 0, 1.6, 3.2]) push(limb([-7, l, 0.7], [7, l, 0.7], 0.75, 0.75, l === 0 || Math.abs(l) > 3 ? WOOD : WOOD_LIT, { sides: 6, tex: (face, s, tt) => (tt < 0.04 || tt > 0.96 ? "#c8a070" : null) }));
    place(push.F, [-1.0, 0, 1.4], 0, (q) => sedan(q, color, null));
    const push2 = t == null ? 0.3 : 0.5 + 0.5 * Math.sin(t * Math.PI * 2); // the poler leans into the push and straightens, the pole trailing
    push(limb([5.8 - push2 * 2.0, 1.8, 0.6], [6.4 + push2 * 0.8, 2.0, 9.6], 0.22, 0.22, "#5c4128", { sides: 4, group: G.weapon })); // the pole
    place(push.F, [5.4, 1.6, 1.4], 0, (q) => person(q, { cloth: shade(color, -0.1), arm: "none" }, { lean: 0.1 + push2 * 0.3, near: curNear }));
    return;
  }
  const hull = WOOD, L = 15;
  push(limb([-L / 2 + 1, 0, 1.6], [L / 2 - 1, 0, 1.7], 2.6, 1.5, hull, { sides: 8, phase: Math.PI / 8, taper: 1.0, tex: (face) => (face === "top" ? shade(hull, -0.35) : null) })); // the hull
  push(limb([L / 2 - 1, 0, 1.7], [L / 2 + 1.0, 0, 2.4], 1.8, 1.0, hull, { sides: 6, taper: 0.2 })); // the bow
  push(boxL([-L / 2 + 1.2, 0, 3.2], [L / 2 - 1.2, 0, 3.2], 0.2, 2.5, WOOD_LIT, { u: [0, 0, 1], group: G.rails })); // the gunwale
  push(boxL([L / 2 - 3.6, 0, 3.8], [L / 2 - 1.6, 0, 3.8], 0.6, 1.4, "#8c7a52", { u: [0, 0, 1], group: G.load })); // the gear forward
  for (const f of [-3.4, 0.6]) { // two rowers, facing the stern, pulling the oars back with the frame
    const pull = t == null ? 0.3 : Math.sin(t * Math.PI * 2) * 0.9;
    place(push.F, [f, 0, 2.9], 180, (q) => { seated(q, { cloth: f < 0 ? shade(color, -0.15) : color, pants: PANTS }, pull); });
    for (const side of [-1, 1]) push(limb([f - 0.4 + pull * 1.6, side * 2.6, 4.2], [f - 1.8 - pull * 1.4, side * 5.4, 0.6], 0.22, 0.22, "#5c4128", { sides: 4, group: G.weapon })); // the oars
  }
}
// Someone seated (a rower, a rider): legs forward, the torso upright, arms out to the hands' reach (pull: back).
function seated(push, look, pull = 0) {
  const cloth = look.cloth, pants = look.pants || PANTS, skin = look.skin || SKIN, hz = 4.8, headS = 3.2;
  push(limb([0, 0, 1.0], [0, 0, 0.6], 1.2, 1.9, pants, { sides: 6 }));
  for (const side of [-1, 1]) { push(limb([0, side * 0.9, 0.8], [2.4, side * 0.9, 0.4], 0.8, 0.8, pants, { sides: 5, taper: 0.9 })); }
  push(limb([-0.3 + pull * 0.4, 0, hz], [0, 0, 0.6], 1.1, 1.8, cloth, { taper: 0.9 }));
  for (const side of [-1, 1]) { const S = [-0.1 + pull * 0.4, side * 2.2, hz - 0.8]; push(limb(S, add(S, [1.6 - pull * 1.2, side * 0.3, -1.2]), 0.6, 0.6, cloth, { sides: 5 })); push(limb(add(S, [1.6 - pull * 1.2, side * 0.3, -1.2]), add(S, [2.6 - pull * 2.0, side * 0.6, -1.4]), 0.55, 0.55, skin, { sides: 5 })); }
  push(limb([pull * 0.5, 0, hz + headS + 0.4], [pull * 0.5, 0, hz + 0.2], headS / 2 * 0.95, headS / 2, skin, { taper: 1.05, tex: (face, s, tt) => (face === "front" && tt > 0.4 && tt < 0.6 && (Math.abs(s - 0.3) < 0.15 || Math.abs(s - 0.7) < 0.15) ? "#1a1a1a" : face === "top" || tt < 0.3 ? (look.hair || HAIR) : null) }));
}
// A bicycle and its rider: frame 0 stopped, a foot down; the cranks and the wheels turn with the frame.
function cyclist(push, color, t) {
  const frameC = desat(color, 0.2), dark = "#3a3a3a";
  for (const f of [-3.4, 3.6]) wheel(push, f, 0, 2.0, 0.4, t);
  push(limb([-3.4, 0, 2.0], [0.0, 0, 2.0], 0.22, 0.22, frameC, { sides: 4 })); push(limb([0.0, 0, 2.0], [-0.8, 0, 5.4], 0.22, 0.22, frameC, { sides: 4 })); // chainstay, seat tube
  push(limb([-0.8, 0, 5.4], [2.6, 0, 5.6], 0.22, 0.22, frameC, { sides: 4 })); push(limb([0.0, 0, 2.0], [2.6, 0, 5.6], 0.22, 0.22, frameC, { sides: 4 })); // top tube, down tube
  push(limb([2.6, 0, 5.6], [3.6, 0, 2.0], 0.22, 0.22, frameC, { sides: 4 })); push(boxL([2.8, -1.4, 6.2], [2.8, 1.4, 6.2], 0.2, 0.2, dark, { u: [0, 0, 1] })); // the fork, the bars
  push(boxL([-1.4, 0, 5.8], [-0.2, 0, 5.8], 0.2, 0.7, "#2a2a2a", { u: [0, 0, 1] })); // the saddle
  // the rider, leaning to the bars: the hips on the saddle, the torso forward, the arms to the bars
  const hip = [-0.8, 0, 6.2], sh = [1.0, 0, 10.2];
  push(limb(sh, hip, 1.1, 1.8, color, { taper: 0.9 }));
  push(boxL(add(hip, [-1.6, 0, 3.4]), add(hip, [-1.6, 0, 0.6]), 0.7, 1.2, PACK, { u: [1, 0, 0] }));
  for (const side of [-1, 1]) { const S = add(sh, [0.2, side * 2.2, -0.6]); push(limb(S, add(S, [1.4, side * -0.2, -1.6]), 0.6, 0.6, color, { sides: 5 })); push(limb(add(S, [1.4, side * -0.2, -1.6]), [2.8, side * 1.4, 6.6], 0.55, 0.55, SKIN, { sides: 5 })); }
  push(limb(add(sh, [0.6, 0, 1.0]), add(sh, [0.6, 0, -0.2]), 0.8, 0.9, shade(SKIN, -0.12), { sides: 5 }));
  push(limb(add(sh, [1.0, 0, 4.2]), add(sh, [1.0, 0, 1.0]), 1.6, 1.7, SKIN, { taper: 1.05, tex: (face, s, tt) => (face === "front" && tt > 0.4 && tt < 0.6 && (Math.abs(s - 0.3) < 0.15 || Math.abs(s - 0.7) < 0.15) ? "#1a1a1a" : face === "top" || tt < 0.3 ? HAIR : null) }));
  // the legs on the cranks (the crank at (0, 0, 2.0)); stopped: the near foot down on the ground
  for (const side of [-1, 1]) {
    const ph = t == null ? (side > 0 ? 0.25 : 0.75) : t + (side > 0 ? 0 : 0.5), ang = ph * Math.PI * 2;
    const foot = t == null && side > 0 ? [0.6, side * 1.6, 0.5] : [Math.sin(ang) * 1.4, side * 1.1, 2.0 - Math.cos(ang) * 1.4];
    const knee = lerp(hip, foot, 0.5); knee[0] += 1.6; knee[2] += 0.6;
    push(limb(add(hip, [0, side * 0.9, 0]), knee, 0.85, 0.8, PANTS, { sides: 5, taper: 0.9 })); push(limb(knee, foot, 0.75, 0.7, PANTS, { sides: 5, taper: 0.85 })); push(limb(add(foot, [-0.5, 0, -0.1]), add(foot, [1.1, 0, -0.1]), 0.45, 0.6, SHOE, { sides: 4, phase: Math.PI / 4, u: [0, 0, 1] }));
  }
}
// A motorbike with a rider leaning over the tank.
function biker(push, color, hair, t) {
  const bike = "#2a2a2e";
  for (const f of [-3.6, 3.8]) wheel(push, f, 0, 1.9, 0.9, t);
  push(boxL([-3.0, 0, 3.0], [3.4, 0, 3.0], 0.6, 0.9, bike, { u: [0, 0, 1] })); push(boxL([-0.4, 0, 4.6], [2.4, 0, 4.6], 0.9, 1.3, color, { u: [0, 0, 1], tex: (face) => (face === "top" ? shade(color, 0.25) : null) })); // the frame, the tank
  push(boxL([-2.6, 0, 4.4], [-0.6, 0, 4.4], 0.3, 1.1, "#1a1a1a", { u: [0, 0, 1] })); // the seat
  push(limb([3.0, 0, 4.0], [3.8, 0, 6.2], 0.25, 0.25, STEEL, { sides: 4 })); push(boxL([3.8, -1.6, 6.3], [3.8, 1.6, 6.3], 0.18, 0.18, STEEL, { u: [0, 0, 1] })); // the forks' top, the bars
  push(limb([-3.0, -1.2, 2.6], [-4.6, -1.3, 2.9], 0.35, 0.35, STEEL, { sides: 5 })); // the exhaust
  const hip = [-1.6, 0, 5.4], sh = [1.4, 0, 8.6], jacket = "#3a3028";
  push(limb(sh, hip, 1.1, 1.8, jacket, { taper: 0.9 }));
  for (const side of [-1, 1]) { const S = add(sh, [0.2, side * 2.1, -0.4]); push(limb(S, add(S, [1.6, side * -0.3, -1.2]), 0.6, 0.6, jacket, { sides: 5 })); push(limb(add(S, [1.6, side * -0.3, -1.2]), [3.8, side * 1.5, 6.6], 0.55, 0.55, SKIN, { sides: 5 })); }
  for (const side of [-1, 1]) { push(limb(add(hip, [0, side * 0.9, 0]), [0.6, side * 1.5, 3.4], 0.85, 0.8, PANTS, { sides: 5, taper: 0.9 })); push(limb([0.6, side * 1.5, 3.4], [-0.6, side * 1.5, 1.6], 0.7, 0.7, PANTS, { sides: 5 })); }
  push(limb(add(sh, [0.8, 0, 3.8]), add(sh, [0.8, 0, 0.8]), 1.6, 1.7, SKIN, { taper: 1.05, tex: (face, s, tt) => (face === "front" && tt > 0.45 && tt < 0.62 && (Math.abs(s - 0.3) < 0.15 || Math.abs(s - 0.7) < 0.15) ? "#1a1a1a" : face === "top" || tt < 0.3 ? hair : null) }));
  push(boxL(add(sh, [2.2, 0, 3.9]), add(sh, [-1.8, 0, 3.9]), 1.0, 0.35, color, { u: [0, 0, 1] })); // the mohawk
}

// ---------- looks ----------
// Who a group sends, by group type (mapsprites.js groupLook, the same vocabulary). i the figure's place; raid: weapons up.
function groupLook(type, c, i, raid) {
  switch (type) {
    case "raider": return { cloth: i % 2 ? "#3a3028" : shade(c, -0.25), hat: "mohawk", hatColor: c, band: c, arm: raid ? "raised" : "rifle", pants: "#2a2a30" };
    case "military": return { cloth: OLIVE, pants: OLIVE_DARK, hat: "helmet", hatColor: shade(OLIVE, -0.15), band: c, arm: i === 0 && !raid ? "banner" : "rifle", armColor: c, pack: !raid, vest: "#4d5440" };
    case "zealot": return { cloth: i === 0 ? shade(c, -0.1) : "#cfc7b4", hat: "hood", hatColor: shade(c, -0.25), robe: true, sash: c, arm: i === 0 ? "banner" : i === 1 ? "torch" : raid ? "raised" : "none", armColor: c };
    case "expansionist": return { cloth: "#5a6068", pants: "#3a3e44", hat: "helmet", hatColor: c, band: c, arm: i === 0 ? "banner" : raid ? "shield" : "rifle", armColor: c, pack: !raid };
    case "traders": return { cloth: i % 2 ? "#8a7a5a" : shade(c, -0.15), hat: "cap", hatColor: c, pack: true, arm: i === 0 ? "rifle" : "none" };
    case "commune": return { cloth: i % 2 ? "#6a7a9a" : shade(c, -0.1), pants: "#4a5a7a", hat: "straw", arm: i % 2 ? "fork" : raid ? "raised" : "fork", pack: !raid };
    default: return { cloth: shade(c, -0.1), hat: "helmet", hatColor: STONE, arm: i === 0 ? "spear" : "shield", armColor: c }; // fortress militia
  }
}
// Your lone walker's look by what the team is doing (mapsprites.js soloLook): "walkers" a pack, "raid" a rifle,
// "scouts" a cap and binoculars while standing, "relief" a helmet and a raised weapon.
function soloLook(kind, color, moving) {
  const base = { cloth: color, pack: true };
  if (kind === "raid") return { ...base, arm: moving ? "rifle" : "raised" };
  if (kind === "scouts") return { ...base, hat: "cap", hatColor: shade(color, -0.4), arm: moving ? "none" : "binoc" };
  if (kind === "relief") return { ...base, hat: "helmet", hatColor: shade(color, -0.45), arm: "raised" };
  return { ...base, arm: "none" };
}
// Where the people of a party on foot stand (f, l) by how many: a loose column along the way.
const COLUMN = [[[0, 0]], [[2.4, -2.8], [-2.4, 2.8]], [[4.6, 0], [-1.0, -4.0], [-2.4, 4.0]], [[5.4, -2.4], [1.6, 3.4], [-2.4, -3.6], [-6.2, 2.2]]];
const columnOf = (n) => COLUMN[Math.max(1, Math.min(4, n)) - 1];
// The walk's pose for a frame; k the figure's place, so a column is not in lockstep.
const walkPose = (frame, k = 0, o = {}) => ({ t: frame > 0 ? ((phaseOf(frame) + k * 0.23) % 1) : null, near: curNear, ...o });
// The side nearer the viewer at a yaw (-1 the figure's right, 1 its left): what one hand carries goes in that hand.
const nearOf = (yaw) => (yaw > 45 && yaw < 225 ? -1 : 1);

// ---------- your teams ----------
// kind: "walkers" | "raid" | "scouts" | "relief" (count people, 1–4) | "truck" | "sedan" | "miltruck" (ups: the
// vehicle's upgrades, mapsprites.js upsCode) | "boat" | "raft" | "convoy" | "supply" (a loaded pickup) | "cart" |
// "supplycart" (a handcart and two on foot). yaw: the heading; frame: 0 still, 1–FRAMES the cycle.
export function mapPartyCanvas(kind, color, count = 3, ups = "", yaw = 315, frame = 0) {
  const y = roundYaw(yaw), f = clampFrame(frame), n = Math.max(1, Math.min(4, count));
  const people = PEOPLE.has(kind);
  return cached(`party:${kind}:${color}:${people ? n : ""}:${ups}:${y}:${f}`, GRIDS.party, y, () => {
    const F = [], t = phaseOf(f), U = upsOf(ups);
    const push = (L) => F.push(L); push.F = F;
    if (kind === "truck") place(F, [0, 0, 0], 0, (q) => pickup(q, color, t, U, (q2, bx) => q2(boxL([bx, 0, 4.0], [bx + 5.4, 0, 4.0], 0.9, 2.4, "#8c7a52", { u: [0, 0, 1], group: G.load, tex: (face) => (face === "top" ? shade("#8c7a52", 0.2) : null) }))));
    else if (kind === "sedan") place(F, [0, 0, 0], 0, (q) => sedan(q, color, t, U));
    else if (kind === "miltruck") place(F, [0, 0, 0], 0, (q) => milTruck(q, color, t, U));
    else if (kind === "boat" || kind === "raft") place(F, [0, 0, 0], 0, (q) => boat(q, color, t, kind === "raft"));
    else if (kind === "convoy" || kind === "supply") place(F, [0, 0, 0], 0, (q) => pickup(q, color, t, {}, (q2, bx) => {
      const LD = { group: G.load };
      if (kind === "supply") for (const [df, l, col] of [[0.8, -1.4, RUST], [0.8, 1.4, "#3a68a8"], [3.2, -1.2, RUST], [3.2, 1.3, RUST]]) q2(limb([bx + df, l, 3.8], [bx + df, l, 6.6], 1.0, 1.0, col, { ...LD, sides: 8, tex: (face) => (face === "top" ? shade(col, -0.3) : null) }));
      else { q2(boxL([bx + 1.8, 0, 3.8], [bx + 1.8, 0, 7.4], 1.9, 2.2, WOOD_LIT, { ...LD, u: [1, 0, 0], tex: (face, s, tt) => (Math.abs(tt - 0.5) < 0.06 ? shade(WOOD_LIT, -0.3) : null) })); q2(boxL([bx + 4.6, 0, 3.8], [bx + 4.6, 0, 6.0], 1.2, 1.8, shade(WOOD_LIT, -0.1), { ...LD, u: [1, 0, 0] })); }
      q2(limb([bx - 0.4, -2.4, 4.4], [bx - 0.4, -2.4, 10.4], 0.18, 0.18, "#c9c9c9", { sides: 4, group: G.weapon })); q2(boxL([bx - 0.3, -2.4, 10.4], [bx - 0.3, -2.4, 9.0], 0.1, 1.2, color, { u: [1, 0, 0], group: G.weapon })); // the pennant
    }));
    else if (kind === "cart" || kind === "supplycart") {
      place(F, [-1.0, 0, 0], 0, (q) => handcart(q, t, kind === "supplycart" ? "supply" : "crates"));
      place(F, [4.6, 0, 0], 0, (q) => person(q, { cloth: color, pack: true, arm: "none" }, walkPose(f, 0, { stride: 0.8 })));
      place(F, [-6.4, 1.6, 0], 0, (q) => person(q, { cloth: shade(color, -0.15), pack: true, arm: "rifle" }, walkPose(f, 1)));
    } else if (kind === "scouts") {
      const col = columnOf(Math.min(2, n));
      col.forEach(([pf, pl], i) => place(F, [pf, pl, 0], 0, (q) => person(q, { cloth: i ? shade(color, -0.15) : color, pack: true, hat: "cap", hatColor: shade(color, -0.4), arm: i ? "rifle" : f ? "none" : "binoc" }, walkPose(f, i))));
    } else if (kind === "relief") {
      columnOf(Math.min(3, n)).forEach(([pf, pl], i) => place(F, [pf, pl, 0], 0, (q) => person(q, { cloth: i % 2 ? shade(color, -0.15) : color, pack: true, hat: "helmet", hatColor: shade(color, -0.45), arm: i === 0 ? "banner" : "raised", armColor: color, band: RED }, walkPose(f, i))));
    } else columnOf(Math.min(3, n)).forEach(([pf, pl], i) => place(F, [pf, pl, 0], 0, (q) => person(q, { cloth: i % 2 ? shade(color, -0.15) : color, pack: true, arm: kind === "raid" ? "rifle" : "none" }, walkPose(f, i))));
    return F;
  });
}
const PEOPLE = new Set(["walkers", "raid", "scouts", "relief"]);
// "p<plating>s<scrap>g<glass>m<mesh>t<gun>" (mapsprites.js upsCode) back to its parts.
function upsOf(code) {
  if (!code) return {};
  const n = (k) => Number(code[code.indexOf(k) + 1]) || 0, gun = code.slice(code.indexOf("t") + 1);
  return { plating: n("p"), scrapPlate: n("s"), glass: n("g"), mesh: n("m"), turret: gun ? { gun } : null };
}
export const soloKind = (kind) => PEOPLE.has(kind);

// A team of one on foot: kind as mapPartyCanvas's people; light "torch" | "lamp" | "" (carried, lit at night); gait ""
// | "limp" (wounded: the hurt leg swings short, bandaged) | "heavy" (bent under a big load with a bedroll).
export function mapSoloCanvas(kind, color, yaw = 315, frame = 0, light = "", gait = "") {
  const y = roundYaw(yaw), f = clampFrame(frame), l = light ? (light === "torch" ? "torch" : "lamp") : "", g = gait === "limp" || gait === "heavy" ? gait : "";
  return cached(`solo:${kind}:${color}:${y}:${f}:${l}:${g}`, GRIDS.solo, y, () => {
    const F = [], look = soloLook(kind, color, f > 0);
    if (l) look.arm = l;
    if (g === "heavy") { look.bigpack = true; look.pack = false; }
    if (g === "limp") look.bandage = true;
    place(F, [0, 0, 0], 0, (q) => person(q, look, walkPose(f, 0, g === "heavy" ? { lean: 0.35, stride: 0.7 } : g === "limp" ? { stride: 0.8, limp: 0.35 } : {})));
    return F;
  });
}
// A team of one on a bike: frame 0 stopped, a foot down; the cranks and the wheels turn.
export function mapCyclistCanvas(color, yaw = 315, frame = 0) {
  const y = roundYaw(yaw), f = clampFrame(frame);
  return cached(`cyclist:${color}:${y}:${f}`, GRIDS.solo, y, () => { const F = []; place(F, [0, 0, 0], 0, (q) => cyclist(q, color, phaseOf(f))); return F; });
}

// ---------- the groups' parties ----------
// type: a FACTION_TYPES key; kind: "convoy" (the group's vehicle) | "raid" | "scav" (scavengers, a sack) | "walk"; n people.
export function mapGroupPartyCanvas(type, kind, color, n = 3, yaw = 315, frame = 0) {
  const y = roundYaw(yaw), f = clampFrame(frame), k = kind === "convoy" ? 0 : Math.max(1, Math.min(4, n));
  return cached(`gp:${type}:${kind}:${color}:${k}:${y}:${f}`, GRIDS.party, y, () => {
    const F = [], t = phaseOf(f);
    const push = (L) => F.push(L); push.F = F;
    if (kind === "convoy") {
      place(F, [0, 0, 0], 0, (q) => {
        if (type === "raider") raiderTruck(q, color, t);
        else if (type === "military") humvee(q, color, t);
        else if (type === "expansionist") armoredTruck(q, color, t);
        else if (type === "traders") { wagon(q, color, t, { bx: -3.0 }); place(F, [5.2, 0, 0], 0, (q2) => beast(q2, "mule", { t }, { hide: "#6a4a34" })); }
        else if (type === "commune") tractor(q, color, t);
        else if (type === "zealot") { zealotCart(q, color, t); for (const [pf, pl] of [[4.6, -1.2], [5.6, 1.4]]) place(F, [pf, pl, 0], 0, (q2) => person(q2, groupLook("zealot", color, 2, false), walkPose(f, pf, { stride: 0.8 }))); }
        else pickup(q, mixHex("#8d8a82", color, 0.4), t, { plating: 1 }, (q2, bx) => q2(boxL([bx + 0.4, 0, 4.0], [bx + 5.2, 0, 4.0], 0.8, 2.3, CANVAS, { u: [0, 0, 1], group: G.load })));
      });
      return F;
    }
    const raid = kind === "raid", scav = kind === "scav";
    const col = columnOf(Math.min(scav ? 3 : type === "traders" && !raid ? 2 : 4, k));
    if (type === "raider" && raid && k >= 2) { // a motorbike with the raid
      place(F, [-5.0, 2.6, 0], 0, (q) => biker(q, color, color, t));
      col.splice(2);
    }
    col.forEach(([pf, pl], i) => {
      const look = groupLook(type, color, i, raid);
      if (scav) { look.pack = true; if (i === 0) look.arm = "bar"; else if (look.arm === "banner") look.arm = "rifle"; if (i === col.length - 1) look.sack = true; }
      place(F, [pf, pl, 0], 0, (q) => person(q, look, walkPose(f, i)));
    });
    if (type === "traders" && !raid && !scav) place(F, [-4.4, -0.4, 0], 0, (q) => beast(q, "mule", { t }, { packs: color })); // a pack mule with the walkers
    return F;
  });
}
// A group's party of one on foot, in its group's look (the lead figure); kind "walk" | "raid" | "scav".
export function mapGroupSoloCanvas(type, kind, color, yaw = 315, frame = 0) {
  const y = roundYaw(yaw), f = clampFrame(frame);
  return cached(`gsolo:${type}:${kind}:${color}:${y}:${f}`, GRIDS.solo, y, () => {
    const F = [], look = groupLook(type, color, 0, kind === "raid");
    if (kind === "scav") { look.pack = true; look.arm = "bar"; look.sack = true; }
    place(F, [0, 0, 0], 0, (q) => person(q, look, walkPose(f, 0)));
    return F;
  });
}

// ---------- outsiders ----------
export const OUTSIDER_COLORS = { raiders: OUT_RED, merchants: OUT_GOLD, explorers: OUT_GRAY };
const raiderLook = (k) => ({ cloth: k ? "#2c2420" : shade(OUT_RED, -0.2), hat: "hood", hatColor: shade(OUT_RED, -0.35), band: "#c03030", arm: k ? "rifle" : "raised", pants: "#24222a" });
const travellerLook = (sub, k, moving) => ({ cloth: k ? "#6e6a60" : OUT_GRAY, pants: "#4a4840", hat: sub === "wanderers" && !k ? "straw" : "cap", hatColor: "#5a5850", pack: true, arm: sub === "scouts" ? (k || moving ? "rifle" : "binoc") : sub === "wanderers" ? "staff" : "none", bigpack: sub === "refugees", bedroll: true });
// kind "raiders" | "merchants" | "explorers" (sub "scouts" | "refugees" | "wanderers"); n people (1–3); escort: a
// merchant caravan's (sim/escorts.js { tier, vehicle }): light a guard ahead, armed a pickup behind, armoured a Humvee or an MRAP leading.
export function mapOutsiderPartyCanvas(kind, sub = "", n = 3, escort = null, yaw = 315, frame = 0) {
  const y = roundYaw(yaw), f = clampFrame(frame), k = Math.max(1, Math.min(3, n));
  const tier = kind === "merchants" && escort ? escort.tier : "", veh = kind === "merchants" && escort ? escort.vehicle || "" : "";
  const big = kind === "merchants";
  return cached(`out:${kind}:${sub || ""}:${big ? `${tier}:${veh}` : k}:${y}:${f}`, big ? GRIDS.wide : GRIDS.party, y, () => {
    const F = [], t = phaseOf(f);
    const push = (L) => F.push(L); push.F = F;
    if (kind === "raiders") {
      place(F, [-4.0, 2.6, 0], 0, (q) => biker(q, OUT_RED, "#1a1a1a", t));
      const col = [[3.0, -1.4], [-1.0, -3.0], [5.6, 2.0]].slice(0, k);
      col.forEach(([pf, pl], i) => place(F, [pf, pl, 0], 0, (q) => person(q, { ...raiderLook(i % 2), arm: i === 0 ? "banner" : raiderLook(i).arm, armColor: "#1a1414" }, walkPose(f, i))));
    } else if (kind === "merchants") {
      const armed = tier === "armed" || tier === "armoured";
      place(F, [1.5, 0, 0], 0, (q) => wagon(q, OUT_GOLD, t, { canvas: OUT_GOLD, crates: true, bx: -4.5 }));
      for (const [pf, pl] of [[7.0, -1.5], [7.0, 1.5]]) place(F, [pf, pl, 0], 0, (q) => beast(q, "ox", { t: t == null ? null : (t + (pl > 0 ? 0.5 : 0)) % 1 }));
      if (!armed) place(F, [13.4, -2.6, 0], 0, (q) => person(q, { cloth: "#6a5a3a", pants: PANTS, hat: "cap", hatColor: "#4a3a2a", arm: "rifle" }, walkPose(f, 1))); // a guard walking ahead
      else if (veh === "mrap") place(F, [-10.6, 0, 0], 0, (q) => mrap(q, OUT_GOLD, t));
      else if (veh === "hummer") place(F, [-10.2, 0, 0], 0, (q) => humvee(q, OUT_GOLD, t));
      else place(F, [-9.6, 0, 0], 0, (q) => pickup(q, "#5a5a52", t, {}, null));
      if (tier === "armoured") place(F, [13.4, -2.6, 0], 0, (q) => person(q, { cloth: "#4d5440", pants: PANTS, hat: "helmet", hatColor: "#3a4030", arm: "rifle", vest: "#3c4148" }, walkPose(f, 2)));
    } else {
      const s = sub || "wanderers";
      if (s === "refugees") place(F, [-5.0, 1.4, 0], 0, (q) => handcart(q, t, "bundles"));
      const col = (s === "refugees" ? [[-1.0, 1.6], [3.4, -1.6], [-0.4, -2.8]] : columnOf(3)).slice(0, k);
      col.forEach(([pf, pl], i) => place(F, [pf, pl, 0], 0, (q) => person(q, travellerLook(s, i % 2, f > 0), walkPose(f, i, s === "refugees" ? { lean: 0.25, stride: 0.7 } : {}))));
    }
    return F;
  });
}
// Outsiders in ones and twos, walking: kind "raiders" | "explorers" (sub as above); i 0 the lead, 1 the second.
export function mapOutsiderSoloCanvas(kind, sub, i = 0, yaw = 315, frame = 0) {
  const y = roundYaw(yaw), f = clampFrame(frame), k = i ? 1 : 0;
  return cached(`osolo:${kind}:${sub || ""}:${k}:${y}:${f}`, GRIDS.solo, y, () => {
    const F = [];
    if (kind === "raiders") place(F, [0, 0, 0], 0, (q) => person(q, raiderLook(k), walkPose(f, k)));
    else place(F, [0, 0, 0], 0, (q) => person(q, travellerLook(sub, k, f > 0), walkPose(f, k, sub === "refugees" ? { lean: 0.25, stride: 0.7 } : {})));
    return F;
  });
}

// ---------- the dead ----------
const ZSKIN = { rotten: ["#8ea36b", "#7f9a62", "#9aa877"], ashen: ["#a7a69b", "#8f8e86", "#b5b2a5"], pale: ["#9fb0b5", "#8fa3aa", "#b4c2c4"], burnt: ["#6b5446", "#5c463a", "#7a6152"] };
const ZRAGS = ["#56606e", "#6a4a3a", "#55603f", "#6d6f73", "#7a3b32", "#45454a", "#8a7a5a", "#45606b"];
const ZEYES = { glow: "#e8e07a", red: "#e2412f", dead: "#2a2a2a" };
const CROWD = [[2.7, -2.7], [-2.7, 3.0], [6.1, 2.4], [-5.8, -3.4], [0.7, 6.4], [-1.0, -7.1], [8.8, -4.1]]; // where the dead of a horde stand
// A horde of n (2–7) of the dead shuffling along, reaching ahead, each a little off the others' step and heading.
export function mapHordeCanvas(n, yaw = 315, frame = 0) {
  const look = zombieLook(), y = roundYaw(yaw), f = clampFrame(frame), k = Math.max(2, Math.min(7, n));
  return cached(`horde:${k}:${look.palette}:${look.eyes}:${y}:${f}`, GRIDS.horde, y, () => {
    const F = [], pals = look.palette && ZSKIN[look.palette] ? [ZSKIN[look.palette]] : [ZSKIN.rotten, ZSKIN.ashen, ZSKIN.pale, ZSKIN.rotten];
    const eye = look.eyes in ZEYES ? ZEYES[look.eyes] : ZEYES.glow;
    for (let i = 0; i < k; i++) {
      const pal = pals[(i * 3) % pals.length], rag = ZRAGS[(i * 5 + 2) % ZRAGS.length];
      const [pf, pl] = CROWD[i];
      place(F, [pf, pl, 0], (i % 3 - 1) * 14, (q) => person(q, { cloth: rag, pants: shade(rag, -0.45), skin: pal[i % pal.length], eye, hair: shade(pal[i % pal.length], -0.5) }, { t: f > 0 ? (phaseOf(f) + i * 0.31) % 1 : null, dead: "reach", lean: 0.2 + (i % 2) * 0.12, stride: 0.55 }));
    }
    return F;
  });
}

// ---------- infested animals ----------
// n (1–3) gaunt grey deer or hogs with raw sores, heads hanging, grazing (frame: a slow step).
export function mapHerdCanvas(kind, n, yaw = 315, frame = 0) {
  const y = roundYaw(yaw), f = clampFrame(frame), k = Math.max(1, Math.min(3, n)), kd = kind === "hog" ? "hog" : "deer";
  return cached(`herd:${kd}:${k}:${y}:${f}`, GRIDS.herd, y, () => {
    const F = [];
    [[0, 0], [-7.0, 3.6], [6.6, -3.8]].slice(0, k).forEach(([pf, pl], i) => place(F, [pf, pl, 0], (i % 2 ? -1 : 1) * 20 * (i > 0 ? 1 : 0), (q) => beast(q, kd, { t: f > 0 ? (phaseOf(f) + i * 0.4) % 1 : null }, { sick: true, hide: i % 2 ? "#8d877a" : "#7f796e" })));
    return F;
  });
}

// ---------- your bases' workers ----------
// A base worker out on a job trip (sim/jobtrips.js; ui/workermap.js) in the job's kit: an axe (wood), a rifle (hunt), a
// rod (fish), a basket (forage), a crowbar and a sack (scavenge), two buckets (water). load: what they bring home ("" on
// the way out and at work): "logs" (a bundle on the shoulder), "game" (a deer across the shoulders), "fish" (a string
// of fish), "basket" (full), "sack" (full, on the back), "buckets" (full), "small" (a rabbit from the hand). Logs and
// game bend them under the weight.
export function mapWorkerCanvas(job, color, yaw = 315, frame = 0, load = "") {
  const y = roundYaw(yaw), f = clampFrame(frame);
  return cached(`worker:${job}:${color}:${y}:${f}:${load}`, GRIDS.solo, y, () => {
    const F = [], heavy = load === "logs" || load === "game";
    const look = { cloth: color, pack: job === "hunt" || job === "fish", hat: job === "hunt" ? "cap" : job === "forage" || job === "wood" ? "straw" : "", hatColor: shade(color, -0.4), load: !!load, carry: load };
    look.arm = heavy ? "none" : job === "hunt" ? "rifle" : job === "scavenge" ? "bar" : job === "wood" ? "axe" : job === "fish" ? "rod" : job === "forage" ? "basket" : job === "water" ? "buckets" : "none";
    if (load === "basket") look.arm = "basket";
    if (load === "buckets") look.arm = "buckets";
    if (load === "sack") { look.sack = true; look.arm = "bar"; }
    if (load === "fish" || load === "small") look.arm = "none";
    if (job === "scavenge" && !load) look.sack = true;
    place(F, [0, 0, 0], 0, (q) => person(q, look, walkPose(f, 0, heavy ? { lean: 0.3, stride: 0.7 } : {})));
    return F;
  });
}

// Width of a cached piece in its own grid pixels (0 without a canvas, e.g. headless): the draw size scales with it.
export const gridW = (cv) => (cv ? cv.width / UP : 0);
// For the sheets and tests: the painter of a piece without the canvas cache.
export const paintPiece = (limbs, grid, yaw) => paintScene(limbs, grid, yaw);
export const _test = { person, beast, pickup, place, GRIDS };
onForgetPictures(() => cache.clear()); // ui/pictures.js: drawn again after a lost GPU context
