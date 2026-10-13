// HD designs for the dead (design preview only; the game's sprites are src/ui/sprites.js and src/ui/hivesprites.js).
// The second take, in the item icons' style (STYLE.md; the first take's box figures were rejected): every figure is
// built from round shaded volumes (kit.js: limb capsules, ellipses, blobs; deadkit.js: rotated ovals, layers with a
// contact line, slumped trunks, drooping hands, gore), on the 44 × 52 grid, facing right, feet on row 49.
//
// The look comes from the game: zombieLookOf(variant, seed, look) picks the skin (ZPAL: rotten, ashen, pale,
// burnt), the clothes, the build and the style from the seed, and its rng goes on drawing the details here, so a
// seed is always the same body. The look settings are honoured: palette, gore 0/1/2, eyes glow/red/dead,
// clothes torn/rags/intact.
//
// Anatomy: about 4 heads tall like the living, but slumped: the head forward and tilted, the shoulders uneven, the
// knees bent. Arms start at the shoulder joints (the trunk's top outer corners) and bend at the elbow; upper arm and
// forearm about 8 px each. Walkers reach with both arms (the far one behind, darker, lower), runners swing one
// forward one back, the bloated hang short swollen arms off a huge belly, brutes hang thick arms to the knees.
// Only the climber has long limbs.
import { painter, scaled } from "./hdcore.js";
import { PAL, ramp, blob, limb, ellipseV, mix, shade, warm } from "./kit.js";
import { paintZombie, zombieLookOf } from "../../src/ui/sprites.js";
import { Rng } from "../../src/sim/rng.js";
import {
  deadSkin, GORE, MOUTH, SOCKET, BONE, PUS, ACID, WORM, EGG, FLESH, AMBER,
  oval, ball, layer, behind, trunkShape, shoulders, hand, zarm, zleg, shoe, airFoot, wound, bleed, ribs, bite, rag, zhead, worm, shriek,
} from "./deadkit.js";

export const W = 44, H = 52;
const DEFAULT_LOOK = { palette: "mixed", gore: "1", variants: "stats", eyes: "glow", clothes: "torn" };
const dim = (m, f = 0.16) => m.map((c) => warm(shade(c, -f), -0.05)); // the far side: a little darker, cooler
const SHOE = ramp("#3a322b", { spec: 0.3 });
const eyeOf = (Z, look, variant) => ({ col: Z.eye, kind: look.eyes === "dead" ? "dead" : look.eyes === "red" || variant === "runner" ? "red" : "glow" });
const pol = (a, len) => [Math.cos(a) * len, Math.sin(a) * len];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];

// ---------- clothes on a trunk ----------
// The trunk in skin, the trousers' waist, then the top over it, cut by the look's tears: notches in the hem (skin
// showing), holes, hanging strips; a flannel's check, a jacket's open front, a hoodie's pouch.
function dress(p, T, { skin, cloth, pants, style, clothes, rng, belt = true, topCut = null }) {
  const inT = trunkShape(T);
  blob(p, inT, skin, { specular: false });
  blob(p, (x, y) => inT(x, y) && y >= T.bot - 4, pants, { rim: 1 });
  if (belt) for (let x = 0; x < p.w; x++) if (inT(x, T.bot - 3) && inT(x, T.bot - 4)) p.set(x, T.bot - 3, PAL.leather[0]);
  if (!cloth) return inT;
  const hem = T.bot - 3;
  const nN = clothes === "intact" ? 0 : clothes === "rags" ? 4 : 2;
  const notches = [];
  for (let i = 0; i < nN; i++) notches.push([rng.range(T.botX - T.hh, T.botX + T.hh), rng.range(2, clothes === "rags" ? 6 : 4), rng.range(1.5, 2.8)]);
  const holes = [];
  const nH = clothes === "intact" ? 0 : clothes === "rags" ? 3 : 1;
  for (let i = 0; i < nH; i++) holes.push([rng.range(T.topX - T.hs + 2, T.topX + T.hs - 2), rng.range(T.top + 5, hem - 3), rng.range(1, 1.9)]);
  const nx = T.topX + 1.5, vee = style === "flannel" || style === "jacket";
  const inNeck = (x, y) => (vee ? Math.abs(x - nx) < 2.6 - (y - T.top) * 0.5 : ((x - nx) / 2.8) ** 2 + ((y - T.top + 0.5) / 2.4) ** 2 < 1);
  const inC = (x, y) => {
    if (!inT(x, y) || y > hem || (topCut && !topCut(x, y))) return false;
    if (style !== "hoodie" && inNeck(x, y)) return false;
    for (const [nx, d, w] of notches) if (Math.abs(x - nx) < w && y > hem - d * (1 - Math.abs(x - nx) / w)) return false;
    for (const [hx, hy, r] of holes) if ((x - hx) ** 2 + (y - hy) ** 2 * 1.3 <= r * r + 0.3) return false;
    return true;
  };
  blob(p, inC, cloth, { specular: false });
  // a torn hole's upper edge throws a shadow on the skin in it
  for (const [hx, hy, r] of holes) for (let x = Math.round(hx - r); x <= Math.round(hx + r); x++) { const y = Math.round(hy - r * 0.7); if (!inC(x, y) && inT(x, y)) p.set(x, y, cloth[0]); }
  if (style === "flannel") for (let y = T.top; y <= hem; y++) for (let x = 0; x < p.w; x++) if (inC(x, y) && p.get(x, y) === cloth[1] && ((x + 1) % 4 === 0 || y % 4 === 0)) p.set(x, y, mix(cloth[1], cloth[0], 0.55));
  if (style === "jacket") { const fx = Math.round(T.topX + 2); for (let y = T.top + 3; y <= hem; y++) { const x = Math.round(fx + (T.botX - T.topX) * (y - T.top) / (T.bot - T.top)); if (inC(x, y)) { p.set(x, y, cloth[0]); if (inC(x - 1, y)) p.set(x - 1, y, cloth[2]); } } }
  if (style === "hoodie") { const y = hem - 4; for (let x = Math.round(T.botX - 2); x <= Math.round(T.botX + 3); x++) if (inC(x, y)) p.set(x, y, cloth[0]); }
  // folds: a crease from under the near arm, two at the waist (a dark line with its lit edge above)
  const fold = (x0, y0, x1, y1) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i++) { const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n); if (inC(x, y) && inC(x, y - 1) && p.get(x, y) !== cloth[0]) { p.set(x, y, cloth[0]); if (p.get(x, y - 1) === cloth[1]) p.set(x, y - 1, cloth[2]); } } };
  if (!T.noFolds) {
    const sx = T.topX + T.hs - 3;
    fold(sx, T.top + 6, sx - 3, T.top + 9);
    fold(T.botX + 1, hem - 3, T.botX + 4, hem - 2);
    fold(T.botX - 4, hem - 2, T.botX - 2, hem - 1);
  }
  // rags: strips hanging from the hem
  if (clothes === "rags") for (let i = 0; i < 3; i++) { const x = Math.round(rng.range(T.botX - T.hh + 1, T.botX + T.hh - 1)); if (inC(x, hem)) rag(p, x, hem + 1, rng.int(3, 6), cloth, { lean: rng.range(-1, 1) }); }
  return inC;
}

// Wounds at the body's anchor points (only on painted pixels): gore 1 a few, gore 2 many, with ribs and bites.
function goreOn(p, gore, rng, spots, { ribsAt = null, bites = [] } = {}) {
  if (!gore) return;
  const n = gore === 1 ? rng.int(2, 3) : rng.int(4, 6);
  const pool = spots.slice();
  for (let i = 0; i < n && pool.length; i++) {
    const [x, y] = pool.splice(rng.int(0, pool.length - 1), 1)[0].map(Math.round);
    if (!p.get(x, y)) continue;
    wound(p, x, y, gore === 2 && rng.chance(0.6) ? 2 : 1, { streak: gore === 1 ? rng.int(0, 2) : rng.int(2, 5) });
  }
  if (gore > 1) { if (ribsAt) ribs(p, ribsAt[0], ribsAt[1]); for (const [x, y] of bites) bite(p, Math.round(x), Math.round(y)); }
}

// ---------- the walker (and the base of the runner and the armoured dead) ----------
const TRUNK = {
  slim: { hs: 5.6, hw: 4.4, hh: 5.0, r: 2.1, leg: 2.3 },
  average: { hs: 6.4, hw: 5.0, hh: 5.8, r: 2.3, leg: 2.5 },
  heavy: { hs: 7.2, hw: 6.4, hh: 6.6, r: 2.6, leg: 2.8, belly: 1.6 },
};
const SLEEVE = { tshirt: "short", jacket: "long", flannel: "long", hoodie: "long", tank: null };

export function paintZombieHD(variant, seed, look = DEFAULT_LOOK) {
  const Z = zombieLookOf(variant, seed, look);
  if (variant === "bloated") return bloated(Z, look);
  if (variant === "brute") return brute(Z, look);
  if (variant === "runner") return runner(Z, look);
  return walker(Z, look);
}

function walker(Z, look, kit = null) {
  const { rng, gore } = Z;
  const build = kit?.build || Z.build;
  const B = TRUNK[build] || TRUNK.average;
  const skin = deadSkin(Z.skin), cloth = kit?.cloth || ramp(Z.cloth), pants = kit?.pants || ramp(Z.pants);
  const style = kit?.style || Z.style, clothes = look.clothes;
  const hairCol = !kit && rng.chance(0.5) ? shade(rng.pick(["#3b2a1e", "#6b6b6b", "#8a6a3a"]), -0.25) : null;
  const hair = hairCol ? ramp(hairCol, { spec: 0.25 }) : null, hairLong = hair && rng.chance(0.6);
  const p = painter(W, H);
  const lean = rng.pick([2, 2, 3]), cx = Math.min(16, Math.floor(23.5 - lean - B.hs)); // room for the reaching fingers
  const dropN = rng.int(0, 2), dropF = dropN ? 0 : rng.int(1, 2);
  const T = { top: 17, bot: 33, topX: cx + lean, botX: cx, hs: B.hs, hw: B.hw, hh: B.hh, dropN, dropF, belly: B.belly || 0, hump: 1.6 };
  const S = shoulders(T);
  // the stance: knees bent, the near foot a little ahead or behind
  const step = rng.pick([-1, 1, 2]);
  const hipN = [cx + 2.5, 31.5], kneeN = [cx + 6 + step * 0.5, 39.5], ankleN = [cx + 3 + step, 46];
  const hipF = [cx - 2.5, 31], kneeF = [cx + 0.5 - step * 0.5, 39], ankleF = [cx - 3 - step, 46];
  // the arms: raised forward from the shoulders, the forearms sagging, the hands drooping
  const lost = !kit && rng.chance(0.22);
  const aN = rng.range(-0.38, 0.06), aF = aN + rng.range(0.22, 0.42); // the near arm up to ~20° above level, the far one lower
  const eN = add(S.N, pol(aN, 8)), hN = add(eN, pol(aN + rng.range(0.18, 0.36), 7.6));
  const eF = add(S.F, pol(aF, 8)), hF = add(eF, pol(aF + rng.range(0.12, 0.3), 7.6));
  let sleeve = kit?.sleeve !== undefined ? kit.sleeve : SLEEVE[style] || "long";
  if (!kit && clothes === "rags" && rng.chance(0.6)) sleeve = "torn";
  const sleeveF = sleeve;
  const shoes = kit?.shoes || [rng.chance(0.85), rng.chance(0.85)];
  const tornLeg = !kit && clothes === "rags" && rng.chance(0.5);
  const tilt = rng.pick([-0.22, 0, 0.12, 0.28]), jaw = rng.pick([1, 2, 2, 3]);
  const head = { x: T.topX + 4.5 + Math.max(0, tilt) * 3, y: 10.5 + (tilt > 0.2 ? 1 : 0), tilt, jaw };
  const fSkin = dim(skin), fCloth = dim(cloth), fPants = dim(pants);

  // back to front: the far arm, the far leg, the near leg, the trunk, the neck and head, the near arm
  zarm(p, S.F, eF, hF, fSkin, { sleeve: sleeveF ? (kit?.sleeveF || fCloth) : null, len: sleeveF, r: B.r * 0.95, hand: { droop: 1.25 } });
  zleg(p, hipF, kneeF, ankleF, fPants, fSkin, { r: B.leg });
  shoe(p, ankleF, shoes[1] ? dim(kit?.boot || SHOE) : fSkin, { bare: !shoes[1] });
  layer(p, (q) => { zleg(q, hipN, kneeN, ankleN, pants, skin, { r: B.leg, torn: tornLeg }); shoe(q, ankleN, shoes[0] ? kit?.boot || SHOE : skin, { bare: !shoes[0] }); });
  limb(p, [T.topX + 1, T.top + 2], [head.x - 1, head.y + 4], 2.2, 2.0, skin);
  if (style === "hoodie") oval(p, T.topX - 2, T.top + 0.5, 4, 2.6, cloth, { specular: false });
  layer(p, (q) => { dress(q, T, { skin, cloth, pants, style, clothes, rng }); kit?.onTrunk?.(q, T, S); });
  let face;
  layer(p, (q) => { face = zhead(q, { ...head, skin, eye: eyeOf(Z, look, "walker"), hair, hairLong, scalp: rng.chance(0.4), gore, rot: rng.chance(0.5) }); kit?.onHead?.(q, head, face); });
  layer(p, (q) => { zarm(q, S.N, eN, hN, skin, { sleeve: sleeve ? cloth : null, len: sleeve, r: B.r, lost, gore }); kit?.onArm?.(q, S.N, eN, hN); }, { cast: 2 });
  // grime on the trousers: a darker patch at the knee
  p.over(Math.round(kneeN[0]), Math.round(kneeN[1]), pants[0]);
  goreOn(p, gore, rng, [[T.topX - 2, 22], [T.topX + 2, 26], [T.botX - 2, 29], [eN[0] + 2, eN[1]], [kneeN[0] - 1, kneeN[1] - 3], [hipF[0] - 1, 36]],
    { ribsAt: [T.topX - 2, 24], bites: [[eN[0] - 3, eN[1] - 1]] });
  return p;
}

// ---------- the runner: hunched, mid-stride, one arm forward, one back ----------
function runner(Z, look) {
  const { rng, gore } = Z;
  const B = TRUNK.slim;
  const skin = deadSkin(Z.skin), cloth = ramp(Z.cloth), pants = ramp(Z.pants), style = Z.style, clothes = look.clothes;
  const p = painter(W, H);
  const cx = 14;
  const T = { top: 19, bot: 33, topX: cx + 6, botX: cx, hs: B.hs, hw: B.hw, hh: B.hh, dropN: 1, dropF: 0, hump: 2 };
  const S = shoulders(T);
  const reachUp = rng.chance(0.5);
  // the stride: the near leg forward (knee up), the far leg pushing off behind, its foot in the air
  const hipN = [cx + 2, 31.5], kneeN = [cx + 8, 37], ankleN = [cx + 8, 45];
  const hipF = [cx - 2, 31], kneeF = [cx - 4, 39], ankleF = [cx - 10, 42];
  // the arms: the near one clawing forward, the far one swung back
  const eN = add(S.N, pol(reachUp ? -0.05 : 0.45, 7.8)), hN = add(eN, pol(reachUp ? 0.6 : 0.05, 7.0));
  const eF = add(S.F, pol(2.1, 7.8)), hF = add(eF, pol(reachUp ? 2.55 : 2.35, 7.2));
  const sleeve = clothes === "rags" ? "torn" : SLEEVE[style] || "long";
  const head = { x: T.topX + 6, y: 15.5, tilt: 0.18, jaw: 3 };
  const fSkin = dim(skin), fCloth = dim(cloth), fPants = dim(pants);
  zleg(p, hipF, kneeF, ankleF, fPants, fSkin, { r: B.leg });
  airFoot(p, ankleF, [-0.35, 0.94], dim(SHOE), { len: 4.5 });
  zarm(p, S.F, eF, hF, fSkin, { sleeve: fCloth, len: sleeve, r: B.r * 0.95, hand: { droop: -0.9, n: 2 } });
  layer(p, (q) => { zleg(q, hipN, kneeN, ankleN, pants, skin, { r: B.leg }); shoe(q, ankleN, SHOE); });
  limb(p, [T.topX + 2, T.top + 2], [head.x - 2, head.y + 3], 2.1, 2.0, skin);
  layer(p, (q) => dress(q, T, { skin, cloth, pants, style, clothes, rng }));
  layer(p, (q) => zhead(q, { ...head, skin, eye: eyeOf(Z, look, "runner"), gore, scalp: rng.chance(0.5), rot: true }));
  layer(p, (q) => zarm(q, S.N, eN, hN, skin, { sleeve: cloth, len: sleeve, r: B.r, gore, hand: { droop: 0.9, len: 3, nail: SOCKET } }), { cast: 2 });
  goreOn(p, gore, rng, [[T.topX - 1, 24], [T.topX + 2, 27], [kneeN[0] - 2, kneeN[1] - 2], [eN[0], eN[1]], [hipN[0], 34]], { ribsAt: [T.topX - 1, 25], bites: [[kneeF[0], kneeF[1] - 2]] });
  return p;
}

// ---------- the bloated: a huge round belly, short swollen arms hanging off it ----------
function bloated(Z, look) {
  const { rng, gore } = Z;
  const skin = deadSkin(mix(Z.skin, "#a8a86a", 0.25)), cloth = ramp(Z.cloth), pants = ramp(Z.pants), clothes = look.clothes;
  const p = painter(W, H);
  const cx = 21;
  const belly = { x: cx + 1, y: 30, rx: 12, ry: 10.5 };
  const T = { top: 16, bot: 27, topX: cx + 1, botX: cx, hs: 9, hw: 10, hh: 10.5 };
  const S = shoulders(T);
  const fSkin = dim(skin), fPants = dim(pants);
  // short thick legs, planted wide under the weight
  const hipN = [cx + 4, 37], kneeN = [cx + 6, 42], ankleN = [cx + 6, 46];
  const hipF = [cx - 4, 37], kneeF = [cx - 6, 42], ankleF = [cx - 7, 46];
  // short swollen arms hanging off the belly's sides
  S.F = [cx - 9, 19]; S.N = [cx + 10, 19];
  const eF = add(S.F, [-3.5, 6]), hF = add(eF, [0.5, 5]);
  const eN = add(S.N, [3.5, 6]), hN = add(eN, [-0.5, 5]);
  zarm(p, S.F, eF, hF, fSkin, { r: 3.1, hand: { r: 2.3, droop: 1.6, n: 3, len: 2 } });
  zleg(p, hipF, kneeF, ankleF, fPants, fSkin, { r: 3.3 });
  shoe(p, ankleF, dim(SHOE), { len: 7 });
  layer(p, (q) => { zleg(q, hipN, kneeN, ankleN, pants, skin, { r: 3.3 }); shoe(q, ankleN, SHOE, { len: 7 }); });
  // the shirt over the chest, rolled up on the belly
  layer(p, (q) => dress(q, T, { skin, cloth, pants: cloth, style: Z.style, clothes, rng, belt: false }));
  // the belly
  layer(p, (q) => {
    oval(q, belly.x, belly.y, belly.rx, belly.ry, skin, { specular: false });
    // a sheen: a crescent of the light tone and a specular streak, wet and stretched
    for (const [x, y] of [[belly.x - 6, belly.y - 6], [belly.x - 5, belly.y - 7], [belly.x - 7, belly.y - 5]]) q.set(x, y, skin[3]);
    // the navel, sunk; a dark crease under the belly where it hangs over the hips
    q.set(belly.x + 2, belly.y + 2, skin[0]); q.set(belly.x + 2, belly.y + 3, mix(skin[0], SOCKET, 0.4));
    // veins: thin dark lines across the stretched skin
    for (const [x0, y0, x1, y1] of [[belly.x - 8, belly.y + 2, belly.x - 4, belly.y + 5], [belly.x + 5, belly.y - 4, belly.x + 8, belly.y - 1]]) q.line(x0, y0, x1, y1, mix(skin[1], "#4a3a5a", 0.4));
    // the split: a slanting tear with the dark inside and a rim of red
    const sx = belly.x + rng.int(-3, 2), sy = belly.y + rng.int(-2, 2);
    for (let i = 0; i < 6; i++) { const x = sx + i, y = sy + Math.round(i * 0.7); q.set(x, y, GORE.core); q.set(x, y - 1, GORE.rim); q.set(x, y + 1, i % 2 ? PUS[1] : GORE.rim); }
    if (gore) bleed(q, sx + 4, sy + 5, 3 + gore * 2);
    // pustules: tiny shaded balls
    const pus = [[belly.x - 6, belly.y + 4], [belly.x + 7, belly.y + 3], [belly.x - 2, belly.y - 6], [belly.x + 4, belly.y + 7], [belly.x - 9, belly.y - 1]];
    for (const [x, y] of pus.slice(0, 3 + (gore > 1 ? 2 : 0))) ball(q, x, y, rng.chance(0.5) ? 1.5 : 1, PUS);
  });
  // a fat neck, the small head sunk on it
  const head = { x: cx + 4, y: 11, rx: 4.8, ry: 5.3, tilt: 0.1, jaw: 1 };
  layer(p, (q) => { oval(q, cx + 2, 16.5, 5.5, 2.6, skin, { specular: false }); zhead(q, { ...head, skin, eye: eyeOf(Z, look, "bloated"), gore, rot: true }); });
  layer(p, (q) => zarm(q, S.N, eN, hN, skin, { r: 3.2, hand: { r: 2.4, droop: 1.6, n: 3, len: 2 } }));
  goreOn(p, gore, rng, [[S.N[0] - 3, 21], [hN[0], hN[1] - 3], [kneeN[0], kneeN[1]], [cx - 5, 20]]);
  return p;
}

// ---------- the brute: massive shoulders, thick arms to the knees, big fists, a small head sunk forward ----------
function brute(Z, look) {
  const { rng, gore } = Z;
  const skin = deadSkin(Z.skin), pants = ramp(Z.pants), cloth = ramp(Z.cloth), clothes = look.clothes;
  const p = painter(W, H);
  const cx = 21;
  const T = { top: 16, bot: 34, topX: cx + 1, botX: cx, hs: 12, hw: 7.5, hh: 8, dropN: 0, dropF: 1, corner: 5 };
  const S = shoulders(T);
  S.N = [S.N[0] - 0.5, S.N[1] + 1]; S.F = [S.F[0] + 0.5, S.F[1] + 1];
  const fSkin = dim(skin), fPants = dim(pants);
  const hipN = [cx + 4, 33], kneeN = [cx + 6, 40], ankleN = [cx + 6, 46];
  const hipF = [cx - 4, 33], kneeF = [cx - 6, 40], ankleF = [cx - 6, 46];
  // the arms hang a little out from the body, the elbows bent, the fists at the knees
  const eF = add(S.F, [-2.2, 8.2]), hF = add(eF, [0.6, 8]);
  const eN = add(S.N, [2.2, 8.2]), hN = add(eN, [0.4, 8]);
  zarm(p, S.F, eF, hF, fSkin, { r: 3.7, hand: { fist: true, r: 3.0 } });
  zleg(p, hipF, kneeF, ankleF, fPants, fSkin, { r: 3.4 });
  shoe(p, ankleF, dim(SHOE), { len: 7 });
  layer(p, (q) => { zleg(q, hipN, kneeN, ankleN, pants, skin, { r: 3.4 }); shoe(q, ankleN, SHOE, { len: 7 }); });
  layer(p, (q) => {
    const tank = clothes !== "rags";
    const inT = dress(q, T, { skin, cloth: null, pants, style: "tank", clothes, rng });
    // the chest: two pecs as shaded volumes, a line down the belly
    oval(q, T.topX - 3.6, 21.6, 4.6, 2.9, skin, { specular: false, cut: inT });
    oval(q, T.topX + 4.4, 21.8, 4.4, 2.9, skin, { specular: true, cut: inT });
    for (let y = 26; y <= 29; y++) q.over(Math.round(T.topX + 0.5), y, mix(skin[1], skin[0], 0.55));
    q.over(Math.round(T.topX - 2), 28, mix(skin[1], skin[0], 0.4)); q.over(Math.round(T.topX + 3), 28, mix(skin[1], skin[0], 0.4));
    if (clothes === "intact") {
      const half = (y) => { const t = (y - T.top) / (T.bot - T.top); return t < 0.55 ? T.hs + (T.hw - T.hs) * (t / 0.55) : T.hw + (T.hh - T.hw) * ((t - 0.55) / 0.45); };
      const cAt = (y) => T.topX + (T.botX - T.topX) * (y - T.top) / (T.bot - T.top);
      blob(q, (x, y) => inT(x, y) && y >= 20 && y <= T.bot - 4 && Math.abs(x - cAt(y) - 0.5) < half(y) - 3.5 && !(((x - T.topX - 0.5) / 4.5) ** 2 + ((y - 19) / 4) ** 2 < 1), cloth, { rim: 1 });
    } else { // what is left of a shirt: one strap across the chest, frayed ends
      limb(q, [T.topX + 7, T.top + 3], [T.topX - 6, T.bot - 6], 1.6, 1.6, cloth);
      if (clothes === "rags") { rag(q, Math.round(T.topX - 6), T.bot - 5, 4, cloth); rag(q, Math.round(T.topX + 3), T.bot - 3, 3, cloth); }
    }
    // the trapezius: a ridge of muscle from shoulder to shoulder, the head sunk in it
    oval(q, T.topX + 1, T.top + 1.5, 8, 3.2, skin, { specular: false });
  });
  const head = { x: cx + 5, y: 12.5, rx: 4.6, ry: 5.0, tilt: 0.12, jaw: 2 };
  layer(p, (q) => zhead(q, { ...head, skin, eye: eyeOf(Z, look, "brute"), gore, rot: true }));
  layer(p, (q) => zarm(q, S.N, eN, hN, skin, { r: 3.8, hand: { fist: true, r: 3.1 } }), { cast: 1 });
  // a chain or rope wound round the near forearm (seeded)
  if (rng.chance(0.5)) for (let i = 0; i < 3; i++) { const y = Math.round(eN[1] + 2 + i * 2); p.over(Math.round(eN[0] - 2), y, PAL.iron[2]); p.over(Math.round(eN[0] - 1), y, PAL.iron[1]); p.over(Math.round(eN[0]), y + 1, PAL.iron[0]); }
  goreOn(p, gore, rng, [[T.topX - 6, 21], [T.topX + 4, 28], [eN[0] + 1, eN[1] + 3], [S.F[0] + 2, 22], [kneeN[0] - 1, kneeN[1] - 3]], { ribsAt: [T.topX - 6, 26] });
  return p;
}

// ---------- the armoured dead (sim/deadsoldiers.js) ----------
// A dead soldier: olive fatigues with big camo patches, a plate carrier with its pouches, a helmet with the strap
// hanging, a sleeve torn off the reaching arm. A dead riot cop: navy, a hard black shell, shoulder pads, forearm and
// shin guards, the helmet's visor pushed up with a glint on the glass.
export const CAMO = ["#55603b", "#3e4630", "#6b6a4a", "#4a3f2c"];
export function paintArmoredDeadHD(kind, seed, look = DEFAULT_LOOK) {
  const Z = zombieLookOf("walker", seed, look);
  const rng = new Rng(seed * 31 + 7);
  if (kind === "riot") {
    const NAVY = ramp("#2f3a58", { spec: 0.4 }), SHELL = ramp("#383d46", { spec: 0.7, lite: 0.3 });
    return walker(Z, look, {
      build: "heavy", cloth: NAVY, pants: NAVY, style: "jacket", sleeve: "long", boot: PAL.black, shoes: [true, true],
      onTrunk(q, T) {
        const inT = trunkShape(T);
        blob(q, (x, y) => inT(x, y) && y >= T.top + 2 && y <= T.bot - 6 && x > T.topX - T.hs + 1.5 && x < T.topX + T.hs - 0.5, SHELL, { specular: true });
        for (const y of [T.top + 7, T.top + 11]) for (let x = 0; x < q.w; x++) if (q.get(x, y) === SHELL[1] || q.get(x, y) === SHELL[3]) { q.set(x, y, SHELL[0]); if (q.get(x, y + 1) === SHELL[1]) q.set(x, y + 1, SHELL[2]); }
      },
      onHead(q, h) {
        oval(q, h.x - 0.6, h.y - 1.4, 6.3, 5.8, SHELL, { ang: h.tilt, cut: (x, y) => y <= h.y + 1.5 + (x - h.x) * Math.sin(h.tilt) - (x > h.x + 1 ? 3.5 : 0) });
        oval(q, h.x + 2.6, h.y - 5.6, 4.3, 1.5, PAL.glass, { ang: h.tilt - 0.3 });
        q.set(Math.round(h.x + 4), Math.round(h.y - 5 + h.tilt * 2), PAL.glass[0]); q.set(Math.round(h.x + 5), Math.round(h.y - 6 + h.tilt * 2), PAL.glass[0]); // a crack
      },
      onArm(q, s, e, h) {
        oval(q, s[0], s[1] - 0.5, 3.4, 3, SHELL, {}); // the shoulder pad
        const a = [e[0] + (h[0] - e[0]) * 0.2, e[1] + (h[1] - e[1]) * 0.2], b = [e[0] + (h[0] - e[0]) * 0.75, e[1] + (h[1] - e[1]) * 0.75];
        limb(q, a, b, 2.6, 2.4, SHELL, { specular: true }); // the forearm guard
        oval(q, h[0] + 0.6, h[1] + 0.6, 1.9, 2, SHELL, { specular: false }); // the glove
      },
    });
  }
  const olive = ramp(rng.pick(["#55603b", "#5b5a40", "#4f5a36"])), carrier = rng.pick([PAL.olive, PAL.coyote]);
  return walker(Z, look, {
    build: "average", cloth: olive, pants: olive, style: "jacket", sleeve: "long", boot: PAL.leather, shoes: [true, true],
    onTrunk(q, T) {
      const inT = trunkShape(T);
      // camo: two big patches of a darker green and one of brown on the fatigues (shapes, not noise)
      for (const [x, y, rx, ry, c] of [[T.topX - 3, T.top + 4, 2.5, 1.6, CAMO[1]], [T.topX + 3, T.bot - 6, 2.2, 1.4, CAMO[3]]]) for (let Y = Math.floor(y - ry); Y <= y + ry; Y++) for (let X = Math.floor(x - rx); X <= x + rx; X++) if (inT(X, Y) && q.get(X, Y) === olive[1] && ((X - x) / rx) ** 2 + ((Y - y) / ry) ** 2 <= 1) q.set(X, Y, c);
      // the plate carrier: a rounded plate on the chest, a row of pouches along its bottom, the straps
      const inP = (x, y) => inT(x, y) && y >= T.top + 2 && y <= T.bot - 6 && x > T.topX - T.hs + 1.5 && x < T.topX + T.hs - 0.5;
      blob(q, inP, carrier, {});
      const y0 = T.bot - 9;
      for (let i = 0; i < 3; i++) { const x0 = Math.round(T.topX - T.hs + 3 + i * 3.6); blob(q, (x, y) => inP(x, y) && x >= x0 && x <= x0 + 2 && y >= y0 && y <= y0 + 3, carrier, { rim: 1 }); q.set(x0, y0, carrier[2]); q.set(x0 + 1, y0, carrier[2]); q.hl(x0, x0 + 2, y0 + 1, carrier[0]); }
      for (let x = Math.round(T.topX - 2); x <= Math.round(T.topX + 2); x++) { q.set(x, T.top + 5, carrier[0]); q.set(x, T.top + 4, carrier[2]); } // the velcro panel's edge
    },
    onHead(q, h) {
      oval(q, h.x - 0.4, h.y - 2, 6.4, 5.2, olive, { ang: h.tilt, cut: (x, y) => y <= h.y - 0.5 + (x - h.x) * Math.sin(h.tilt) });
      // the brim: a dark lip round the dome; the chin strap hanging loose by the ear
      for (let x = Math.round(h.x - 6.5); x <= Math.round(h.x + 6.5); x++) { const y = Math.round(h.y + (x - h.x) * Math.sin(h.tilt)); if (q.get(x, y - 1) === olive[1] || q.get(x, y - 1) === olive[2] || q.get(x, y - 1) === olive[0]) q.set(x, y, olive[0]); }
      for (let i = 1; i <= 4; i++) q.set(Math.round(h.x - 4.5 + i * 0.2), Math.round(h.y + i), i === 4 ? PAL.leather[0] : PAL.leather[1]);
    },
    onArm(q, s, e, h) { // the sleeve torn off at the elbow: the forearm bare and bitten
      const sk = deadSkin(Z.skin);
      limb(q, e, h, 2.0, 1.7, sk);
      hand(q, h, [(h[0] - e[0]) / 8, (h[1] - e[1]) / 8], sk, {});
      q.set(Math.round(e[0] + 3), Math.round(e[1]), GORE.rim);
    },
  });
}

// ---------- the special dead (sim/zombietypes.js, hivesprites.js) ----------
// Each one built from the same volumes as the walkers, each with one thing that says what it does at a glance.
const ROT = deadSkin("#8ea36b"), ASH = deadSkin("#a7a69b"), PALE = deadSkin("#9fb0b5"), BURNT = deadSkin("#6b5446");
const RAGS = ramp("#5a5a52"), RAGS2 = ramp("#4a4f44"), DENIM = ramp("#3f4a58"), EYE_Y = { col: "#e8e07a", kind: "glow" }, EYE_R = { col: "#e2412f", kind: "red" };
const SHRIEK = ["#4a3a5a", "#9a86b4", "#e4d8f2", "#ffffff"], SHRIEK_R = ["#5a1418", "#b4343a", "#f07a6a", "#ffd0c0"];
const trunk = (p, T, m, o = {}) => blob(p, trunkShape(T), m, o);

// The spitter: squat and hunched, an acid bladder swelling on its back and throat, the jaw wide, acid running out
// of the mouth into a puddle.
function spitter() {
  const p = painter(W, H), sk = ROT, cx = 16;
  const T = { top: 21, bot: 34, topX: cx + 5, botX: cx, hs: 6.2, hw: 5.6, hh: 5.8, hump: 2.5, dropN: 1 };
  const S = shoulders(T);
  const head = { x: T.topX + 8.5, y: 17, rx: 5, ry: 5.4, tilt: 0.25, jaw: 3 };
  oval(p, cx + 6, 48.4, 9, 0.6, ACID, { specular: false }); // the puddle
  zarm(p, S.F, add(S.F, [1, 8]), add(S.F, [5, 14]), dim(sk), { r: 2.2, hand: { droop: 0.6 } });
  zleg(p, [cx - 3, 33], [cx + 1, 40], [cx - 3, 46], dim(DENIM), dim(sk), { r: 2.6 });
  shoe(p, [cx - 3, 46], dim(SHOE));
  layer(p, (q) => { zleg(q, [cx + 2, 33], [cx + 7, 39], [cx + 4, 46], DENIM, sk, { r: 2.6, torn: true }); shoe(q, [cx + 4, 46], sk, { bare: true }); });
  layer(p, (q) => dress(q, T, { skin: sk, cloth: RAGS, pants: DENIM, style: "tshirt", clothes: "rags", rng: new Rng(5) }));
  // the bladder on its back: a big glowing sac, veined, its specular wet
  layer(p, (q) => { oval(q, cx - 1, 22, 5.5, 6, ACID, {}); q.line(cx - 4, 20, cx - 2, 25, ACID[0]); q.line(cx + 1, 18, cx + 2, 22, ACID[0]); });
  layer(p, (q) => {
    limb(q, [T.topX + 1, T.top + 2], [head.x - 2, head.y + 3], 2.4, 2.6, sk);
    oval(q, head.x + 1, head.y + 6.5, 3.4, 2.6, ACID, {}); // the swollen throat
    zhead(q, { ...head, skin: sk, eye: EYE_Y, rot: true });
  });
  // acid in the mouth, drooling to the ground
  const mx = Math.round(head.x + 4), my = Math.round(head.y + 5);
  p.set(mx, my, ACID[2]); p.set(mx - 1, my, ACID[1]);
  for (let y = my + 1; y <= 47; y++) { p.set(mx + (y > my + 8 ? 1 : 0), y, y % 5 === 0 ? ACID[3] : ACID[2]); }
  layer(p, (q) => zarm(q, S.N, add(S.N, [3, 7]), add(S.N, [8, 12]), sk, { r: 2.3, hand: { droop: 0.5 } }), { cast: 1 });
  return p;
}

// The screamer: gaunt, ribs under the skin, the head thrown back and the mouth a hole to the sky, the arms flung
// out, the hands splayed; rings of its shriek round its mouth.
function screamer() {
  const p = painter(W, H), sk = PALE, cx = 19;
  const T = { top: 19, bot: 33, topX: cx - 1, botX: cx, hs: 5.4, hw: 4, hh: 4.8, dropN: 0, dropF: 1 };
  const S = shoulders(T);
  const head = { x: cx + 1, y: 12.5, rx: 5, ry: 5.4, tilt: -0.75, jaw: 4 };
  zarm(p, S.F, add(S.F, [-5, 5]), add(S.F, [-9, 2]), dim(sk), { r: 1.9, hand: { droop: -0.9, n: 3, len: 3 } });
  zleg(p, [cx - 2, 31], [cx - 2, 40], [cx - 3, 46], dim(RAGS2), dim(sk), { r: 2.2 });
  shoe(p, [cx - 3, 46], dim(sk), { bare: true });
  layer(p, (q) => { zleg(q, [cx + 2, 31], [cx + 3, 40], [cx + 3, 46], RAGS2, sk, { r: 2.2 }); shoe(q, [cx + 3, 46], sk, { bare: true }); });
  layer(p, (q) => {
    const inT = trunkShape(T);
    trunk(q, T, sk);
    for (let i = 0; i < 4; i++) for (let k = 0; k < 6; k++) { const x = Math.round(T.topX - 3 + k), y = 23 + i * 2 + (k > 3 ? 1 : 0); if (inT(x, y)) q.set(x, y, k === 0 ? sk[2] : sk[0]); } // ribs under the skin
    blob(q, (x, y) => inT(x, y) && y >= T.bot - 4, RAGS2, { rim: 1 }); // the trousers' waist
    rag(q, Math.round(cx - 3), T.bot - 4, 4, RAGS); rag(q, Math.round(cx + 2), T.bot - 4, 5, RAGS);
  });
  layer(p, (q) => {
    limb(q, [T.topX + 1, T.top + 1], [head.x, head.y + 3], 2.1, 2.1, sk);
    limb(q, [head.x + 1, head.y + 2], [head.x + 6, head.y + 2.5], 2.2, 1.8, sk); // the jaw dropped open
    oval(q, head.x - 0.5, head.y - 1, head.rx, head.ry, sk, { ang: -0.6 }); // the skull, tipped back
    oval(q, head.x + 3.4, head.y - 1.2, 1.9, 2.8, [MOUTH, MOUTH, MOUTH, MOUTH], { ang: -0.5, specular: false }); // the mouth, wide open upward
    for (const [x, y] of [[2, -3], [4, -2], [5, 0]]) q.set(Math.round(head.x + x), Math.round(head.y + y), BONE[2]); // teeth along its rim
    q.set(Math.round(head.x + 4), Math.round(head.y + 2), BONE[1]);
    for (const [x, y] of [[0, -5], [2, -6]]) { q.set(Math.round(head.x + x), Math.round(head.y + y), SOCKET); q.set(Math.round(head.x + x + 1), Math.round(head.y + y), "#e8e07a"); } // the eyes, turned up
    q.set(Math.round(head.x - 3), Math.round(head.y), sk[0]); // the ear
  });
  layer(p, (q) => zarm(q, S.N, add(S.N, [4, 6]), add(S.N, [10, 3]), sk, { r: 2, hand: { droop: -0.9, n: 3, len: 3 } }));
  shriek(p, head.x + 4, head.y - 1, SHRIEK, [5, 8, 10], -1.75, -0.45);
  return p;
}

// The crawler: no legs, the body dragged flat along the ground, one hand planted ahead pulling, the head raised;
// a smear of blood behind it, grass in front where it hides.
function crawler() {
  const p = painter(W, H), sk = ASH, shirt = ramp("#55603f");
  for (let x = 1; x <= 12; x++) { p.set(x, 49, x < 4 ? GORE.core : GORE.rim); if (x > 3 && x < 10) p.set(x, 48, GORE.rim); } // the smear
  // the far arm reaching ahead, behind the body
  zarm(p, [25, 39], [31, 37], [37, 40], dim(sk), { r: 2, hand: { droop: 1.1, len: 3, nail: SOCKET } });
  // the body: a capsule from the torn hips to the shoulders, the shirt on it, the stumps of the legs behind
  layer(p, (q) => {
    limb(q, [10, 45], [14, 44], 3.3, 3.6, ramp("#3f4a58")); // what is left of the trousers
    oval(q, 8, 45.5, 2, 2.6, [GORE.core, GORE.rim, PAL.red[1], PAL.red[2]], { specular: false }); // the torn end
    q.set(7, 45, BONE[2]); q.set(7, 46, BONE[1]);
    limb(q, [14, 44], [26, 41], 4, 4.6, shirt);
    for (const x of [17, 21]) { q.set(x, 46, sk[1]); q.set(x + 1, 46, sk[1]); } // torn shirt, skin under it
    ribs(q, 20, 43, { w: 3, n: 2 });
  });
  layer(p, (q) => { limb(q, [26, 40], [30, 37], 2.2, 2.2, sk); zhead(q, { x: 32, y: 34, rx: 4.8, ry: 5.2, tilt: 0.1, jaw: 2, skin: sk, eye: EYE_Y, gore: 1, scalp: true }); });
  // the near arm planted ahead, pulling: elbow up, the hand flat on the ground
  layer(p, (q) => zarm(q, [27, 42], [32, 44], [37, 46], sk, { sleeve: shirt, len: "torn", r: 2.2, hand: { droop: -0.3, len: 3, n: 3 } }), { cast: 1 });
  for (const x of [34, 39, 41]) { p.set(x, 49, PAL.green[1]); p.set(x, 48, PAL.green[2]); p.set(x + 1, 47, PAL.green[2]); p.set(x + 1, 48, PAL.green[1]); p.set(x + 1, 49, PAL.green[0]); } // grass
  return p;
}

// The shepherd: a tall shroud from the hood to the ground, its hem in tatters, a long pale face in the hood, the
// near hand on a crook of bone; pale motes drift in to it (its pull on the pack).
function shepherd() {
  const p = painter(W, H), robe = ramp("#4a4356", { spec: 0.3 }), face = deadSkin("#c8c6d2"), cx = 19;
  // the crook: a long bone staff, curled at the top
  limb(p, [34, 48.4], [35, 11], 1, 1, BONE);
  for (const [a, b] of [[[35, 11], [35, 7]], [[35, 7], [33, 4]], [[33, 4], [30, 4]], [[30, 4], [29, 6]], [[29, 6], [30, 8]]]) limb(p, a, b, 1, 1, BONE);
  // the far arm under the shroud, raised a little behind
  zarm(p, [cx - 6, 19], [cx - 10, 25], [cx - 12, 21], dim(face), { sleeve: dim(robe), len: "long", r: 2.2, hand: { droop: -0.6, n: 3, len: 3 } });
  layer(p, (q) => {
    const inR = (x, y) => { if (y < 15 || y > 49) return false; const t = (y - 15) / 34, half = 7 + t * 5, c = cx + 1 - t * 1.5; return x >= c - half && x <= c + half + 1; };
    const notch = (x) => [3, 0, 2, 4, 1, 0, 3, 1, 2, 0, 4, 2, 0, 1, 3, 2, 0, 4][((x % 18) + 18) % 18];
    blob(q, (x, y) => inR(x, y) && y <= 49 - notch(x), robe, {});
    for (const x of [cx - 4, cx + 1, cx + 6]) for (let y = 30; y <= 46; y++) if (q.get(x, y) === robe[1]) q.set(x, y, robe[0]); // the folds
    for (const x of [cx - 3, cx + 2, cx + 7]) for (let y = 31; y <= 45; y++) if (q.get(x, y) === robe[1]) q.set(x, y, robe[2]);
  });
  layer(p, (q) => {
    oval(q, cx + 1, 10, 7, 8, robe, { specular: false }); // the hood
    oval(q, cx + 4, 11.5, 3.6, 5.6, ["#141218", "#141218", "#141218", "#141218"], { specular: false }); // its dark opening
    oval(q, cx + 4.6, 12.5, 2.6, 4.6, face, { specular: false }); // the long pale face
    for (const x of [cx + 3, cx + 6]) { q.set(x, 11, SOCKET); q.set(x, 12, "#b8f0ff"); }
    q.set(cx + 5, 16, MOUTH); q.set(cx + 4, 16, MOUTH);
  });
  layer(p, (q) => zarm(q, [cx + 6, 19], [cx + 11, 24], [34, 22], face, { sleeve: robe, len: "long", r: 2.3, hand: { fist: true, r: 1.8 } }));
  limb(p, [34, 20], [34.6, 25], 1, 1, BONE); // the staff over the fist
  for (const [x, y] of [[6, 14], [3, 22], [8, 30], [4, 38]]) { p.set(x, y, "#b8f0ff"); p.set(x + 1, y, "#6a8a9a"); }
  return p;
}

// The carrier: a swollen, stooping body split open where worms push out, short arms, worms spilling from its mouth;
// it takes them to the bodies.
function carrier() {
  const p = painter(W, H), sk = deadSkin("#b4a9a0"), cx = 20, rng = new Rng(77);
  zleg(p, [cx - 4, 36], [cx - 3, 42], [cx - 5, 46], dim(DENIM), dim(sk), { r: 3 }); shoe(p, [cx - 5, 46], dim(SHOE), { len: 7 });
  zarm(p, [cx - 7, 21], [cx - 10, 27], [cx - 9, 32], dim(sk), { r: 2.8, hand: { droop: 1.4 } });
  layer(p, (q) => { zleg(q, [cx + 4, 36], [cx + 6, 42], [cx + 5, 46], DENIM, sk, { r: 3 }); shoe(q, [cx + 5, 46], SHOE, { len: 7 }); });
  layer(p, (q) => {
    oval(q, cx, 28, 11, 11.5, sk, { ang: 0.2 });
    // splits: slanted tears with the dark inside, a worm pushing out of each
    for (const [x, y, d] of [[cx - 5, 23, 1], [cx + 3, 26, 1], [cx - 3, 32, -1], [cx + 6, 33, 1]]) {
      for (let i = 0; i < 4; i++) { q.set(x + i, y + Math.round(i * 0.5), GORE.core); q.set(x + i, y + Math.round(i * 0.5) - 1, GORE.rim); q.set(x + i, y + Math.round(i * 0.5) + 1, sk[0]); }
      worm(q, [[x + 2, y + 1], [x + 2 + d * 2, y - 2], [x + 2 + d * 4, y - 3]]);
    }
    for (const [x, y] of [[cx - 7, 30], [cx + 2, 20]]) ball(q, x, y, 1.4, PUS);
  });
  const head = { x: cx + 6, y: 14, rx: 4.6, ry: 5, tilt: 0.3, jaw: 2 };
  layer(p, (q) => { zhead(q, { ...head, skin: sk, eye: EYE_Y, rot: true }); });
  worm(p, [[head.x + 3, head.y + 5], [head.x + 5, head.y + 8], [head.x + 4, head.y + 11]]);
  worm(p, [[head.x + 2, head.y + 5], [head.x + 2, head.y + 9]]);
  layer(p, (q) => zarm(q, [cx + 8, 21], [cx + 12, 26], [cx + 14, 31], sk, { r: 2.9, hand: { droop: 1.4 } }));
  return p;
}

// The swarm: a low writhing mass of worms on a bed of slime, heads rearing up.
function swarm() {
  const p = painter(W, H), rng = new Rng(9), SLIME = ["#4a4030", "#7a6c4a", "#a8986a", "#d8cca0"];
  oval(p, 21, 46, 18, 3.1, SLIME, {});
  for (let i = 0; i < 18; i++) {
    const x = rng.range(6, 36), y = rng.range(40, 46), d = rng.chance(0.5) ? 1 : -1, l = rng.range(3, 6);
    worm(p, [[x, y], [x + d * l * 0.5, y - rng.range(0, 2)], [x + d * l, y + rng.range(-1, 1)]], { mouth: false });
  }
  for (const [x, h, d] of [[10, 9, 1], [17, 13, -1], [24, 11, 1], [31, 8, -1], [21, 6, 1]]) { // raised heads
    worm(p, [[x, 44], [x + d, 44 - h * 0.5], [x, 44 - h], [x + d * 2, 44 - h - 1]], { r: 1.3 });
  }
  return p;
}

// The boneback: a heavy hunched body under a hump of fused bone plates, a plated forearm, the head low in front
// behind a bone mask, the eyes peering out.
function boneback() {
  const p = painter(W, H), sk = deadSkin("#8c7a68"), cx = 17;
  const T = { top: 20, bot: 35, topX: cx + 4, botX: cx, hs: 8, hw: 6.5, hh: 7, hump: 3 };
  const S = shoulders(T);
  zarm(p, S.F, add(S.F, [-1, 8]), add(S.F, [2, 15]), dim(sk), { r: 2.8, hand: { fist: true, r: 2.3 } });
  zleg(p, [cx - 3, 34], [cx, 41], [cx - 3, 46], dim(DENIM), dim(sk), { r: 3 }); shoe(p, [cx - 3, 46], dim(SHOE), { len: 7 });
  layer(p, (q) => { zleg(q, [cx + 3, 34], [cx + 7, 41], [cx + 5, 46], DENIM, sk, { r: 3 }); shoe(q, [cx + 5, 46], SHOE, { len: 7 }); });
  layer(p, (q) => dress(q, T, { skin: sk, cloth: null, pants: DENIM, style: "tank", clothes: "torn", rng: new Rng(3) }));
  // the hump: a ridge of bone plates along the spine, each a shaded oval with a spine raking back (each its own
  // layer, so a seam where it overlaps the one below)
  const PLATE = ramp("#c4b89c", { spec: 0.5 });
  for (const [x, y, a] of [[cx - 6, 29.5, 1.0], [cx - 6, 23.5, 0.5], [cx - 2.5, 18.5, 0.0], [cx + 3, 16.5, -0.4]]) {
    layer(p, (q) => { limb(q, [x - 1, y - 0.5], [x - 4, y - 3.5], 1.3, 0.5, PLATE); oval(q, x, y, 3, 2.3, PLATE, { ang: a }); });
  }
  const head = { x: T.topX + 10, y: 18.5, rx: 4.6, ry: 4.8, tilt: 0.3, jaw: 2 };
  layer(p, (q) => {
    limb(q, [T.topX + 3, T.top + 3], [head.x - 2, head.y + 2], 2.6, 2.4, sk);
    zhead(q, { ...head, skin: sk, eye: EYE_R });
    oval(q, head.x - 0.4, head.y - 3.4, 4, 1.6, PLATE, { ang: 0.25 }); // the brow plate
    limb(q, [head.x - 2, head.y - 4], [head.x - 5, head.y - 6.5], 1.1, 0.5, PLATE);
  });
  layer(p, (q) => {
    zarm(q, S.N, add(S.N, [0.5, 8]), add(S.N, [3.5, 15]), sk, { r: 2.9, hand: { droop: 1.0, n: 3, len: 3, nail: BONE[2] } });
    limb(q, add(S.N, [1, 9.5]), add(S.N, [2.6, 13]), 2.6, 2.4, PLATE, { specular: true }); // a bone plate on the forearm
  }, { cast: 1 });
  return p;
}

// The climber: thin and crouched, the long arms (the one special with long limbs) raised to grip, hooked bone
// fingers, bare feet with long toes, the head looking up between the arms.
function climber() {
  const p = painter(W, H), sk = ASH, cx = 20;
  const T = { top: 23, bot: 35, topX: cx + 2, botX: cx, hs: 5, hw: 3.8, hh: 4.4, hump: 1 };
  const S = shoulders(T);
  zarm(p, S.F, add(S.F, [-5, -9]), add(S.F, [-3, -20]), dim(sk), { r: 1.7, hand: { droop: 2.4, n: 3, len: 3.4, nail: BONE[2] } });
  zleg(p, [cx - 2, 34], [cx - 9, 37], [cx - 7, 46], dim(RAGS2), dim(sk), { r: 2 }); shoe(p, [cx - 7, 46], dim(sk), { bare: true, len: 6 });
  layer(p, (q) => { zleg(q, [cx + 2, 34], [cx + 10, 37], [cx + 8, 46], RAGS2, sk, { r: 2 }); shoe(q, [cx + 8, 46], sk, { bare: true, len: 6 }); });
  layer(p, (q) => { trunk(q, T, sk); const inT = trunkShape(T); for (let i = 0; i < 3; i++) for (let k = 0; k < 4; k++) if (inT(T.topX - 2 + k, 27 + i * 2)) q.set(T.topX - 2 + k, 27 + i * 2, k ? sk[0] : sk[2]); blob(q, (x, y) => inT(x, y) && y >= T.bot - 3, RAGS2, { rim: 1 }); });
  layer(p, (q) => { limb(q, [T.topX + 1, T.top + 1], [cx + 4, 19], 1.8, 1.8, sk); zhead(q, { x: cx + 4, y: 15, rx: 4.6, ry: 5, tilt: -0.35, jaw: 2, skin: sk, eye: EYE_Y }); });
  layer(p, (q) => zarm(q, S.N, add(S.N, [6, -9]), add(S.N, [5, -21]), sk, { r: 1.8, hand: { droop: -2.4, n: 3, len: 3.4, nail: BONE[2] } }));
  return p;
}

// The flinger: the throwing arm cocked back over its head, a writhing ball of worms in the fist; the other arm
// hanging; leaning back into the throw.
function flinger() {
  const p = painter(W, H), sk = ROT, cx = 19, cloth = ramp("#4a5566");
  const T = { top: 19, bot: 33, topX: cx - 1, botX: cx, hs: 6.4, hw: 5, hh: 5.8, dropN: 1, dropF: 0 };
  const S = shoulders(T);
  // the throwing arm (the far one) cocked back behind the head, the ball of worms in its fist
  const hb = [S.F[0] - 5, S.F[1] - 13.5];
  oval(p, hb[0], hb[1], 4.2, 3.8, FLESH, { specular: false });
  for (const pts of [[[hb[0] - 3, hb[1] - 1], [hb[0] - 1, hb[1] - 3], [hb[0] + 2, hb[1] - 3]], [[hb[0] - 2, hb[1] + 2], [hb[0] + 1, hb[1] + 1], [hb[0] + 3, hb[1] + 2]], [[hb[0] - 3, hb[1] + 1], [hb[0] - 5, hb[1] - 1], [hb[0] - 5, hb[1] - 4]], [[hb[0] + 1, hb[1] - 3], [hb[0] + 1, hb[1] - 5], [hb[0] + 3, hb[1] - 6]]]) worm(p, pts);
  for (let y = hb[1] + 4; y <= hb[1] + 6; y++) p.set(hb[0] + 2, y, FLESH[0]); // dripping
  zarm(p, S.F, add(S.F, [-6, -5]), [hb[0] + 2, hb[1] + 3], dim(sk), { sleeve: dim(cloth), len: "short", r: 2.2, hand: { fist: true, r: 2 } });
  zleg(p, [cx - 3, 31], [cx - 4, 40], [cx - 6, 46], dim(DENIM), dim(sk), { r: 2.5 }); shoe(p, [cx - 6, 46], dim(SHOE));
  layer(p, (q) => { zleg(q, [cx + 2, 31], [cx + 6, 39], [cx + 5, 46], DENIM, sk, { r: 2.5 }); shoe(q, [cx + 5, 46], SHOE); });
  layer(p, (q) => dress(q, T, { skin: sk, cloth, pants: DENIM, style: "tshirt", clothes: "torn", rng: new Rng(4) }));
  layer(p, (q) => { limb(q, [T.topX + 1, T.top + 1], [cx + 2, 15], 2.1, 2.1, sk); zhead(q, { x: cx + 2, y: 11, rx: 5, ry: 5.6, tilt: -0.1, jaw: 2, skin: sk, eye: EYE_Y, gore: 1 }); });
  layer(p, (q) => zarm(q, S.N, add(S.N, [1.5, 8]), add(S.N, [2.5, 15.5]), sk, { sleeve: cloth, len: "short", r: 2.3, hand: { droop: 1.3 } }), { cast: 1 });
  return p;
}

// The sower: a shambling walker hung with egg sacs, pale and translucent with the eggs showing; eggs dribble to
// the ground behind it.
function sower() {
  const p = painter(W, H), sk = PALE, cx = 18, cloth = ramp("#6a4a3a");
  const T = { top: 19, bot: 33, topX: cx + 2, botX: cx, hs: 6.4, hw: 5.4, hh: 5.8, hump: 1.5, dropN: 1 };
  const S = shoulders(T);
  const sac = (q, x, y, rx, ry) => { oval(q, x, y, rx, ry, EGG, {}); for (const [dx, dy] of [[-1, 0], [1, 1], [0, -2], [-1, 2]]) if (Math.abs(dx) < rx - 1 && Math.abs(dy) < ry - 1) q.set(Math.round(x + dx), Math.round(y + dy), EGG[0]); };
  layer(p, (q) => { sac(q, cx - 7, 24, 4, 5); sac(q, cx - 5, 31, 3.4, 4); });
  zarm(p, S.F, add(S.F, [1, 8]), add(S.F, [2, 15]), dim(sk), { sleeve: dim(cloth), len: "elbow", r: 2.2, hand: { droop: 1.4 } });
  zleg(p, [cx - 2.5, 31], [cx - 1, 39], [cx - 4, 46], dim(DENIM), dim(sk), { r: 2.5 }); shoe(p, [cx - 4, 46], dim(SHOE));
  layer(p, (q) => { zleg(q, [cx + 2.5, 31], [cx + 6, 39], [cx + 4, 46], DENIM, sk, { r: 2.5 }); shoe(q, [cx + 4, 46], SHOE); });
  layer(p, (q) => dress(q, T, { skin: sk, cloth, pants: DENIM, style: "jacket", clothes: "torn", rng: new Rng(8) }));
  layer(p, (q) => { sac(q, cx + 1, 30, 3, 3.6); });
  layer(p, (q) => { limb(q, [T.topX + 1, T.top + 1], [cx + 6, 16], 2.1, 2.1, sk); zhead(q, { x: cx + 7, y: 12, rx: 5, ry: 5.6, tilt: 0.2, jaw: 2, skin: sk, eye: EYE_Y, rot: true }); });
  layer(p, (q) => zarm(q, S.N, add(S.N, [2, 8]), add(S.N, [6, 14]), sk, { sleeve: cloth, len: "elbow", r: 2.3, hand: { droop: 1.2 } }), { cast: 1 });
  for (const [x, y] of [[3, 46], [7, 47], [10, 46]]) ball(p, x, y, 1.4, EGG);
  return p;
}

// The nightmare: tall, gaunt and black, red eyes burning, the jaw unhinged down to its chest, long thin fingers;
// its scream (red rings) panics your people.
function nightmare() {
  const p = painter(W, H), sk = ["#141218", "#2a2532", "#433b4e", "#6a5f78"], cx = 20;
  const T = { top: 15, bot: 31, topX: cx + 1, botX: cx, hs: 5.6, hw: 3.6, hh: 4.4, hump: 1.2 };
  const S = shoulders(T);
  zarm(p, S.F, add(S.F, [-2, 8]), add(S.F, [-1, 16]), dim(sk, 0.1), { r: 1.6, hand: { droop: 1.6, n: 3, len: 4 } });
  zleg(p, [cx - 2, 30], [cx - 1, 39], [cx - 3, 46], dim(sk, 0.1), sk, { r: 2 }); shoe(p, [cx - 3, 46], dim(sk, 0.1), { bare: true, len: 6 });
  layer(p, (q) => { zleg(q, [cx + 2, 30], [cx + 4, 39], [cx + 3, 46], sk, sk, { r: 2 }); shoe(q, [cx + 3, 46], sk, { bare: true, len: 6 }); });
  layer(p, (q) => { trunk(q, T, sk); const inT = trunkShape(T); for (let i = 0; i < 3; i++) for (let k = 0; k < 5; k++) if (inT(T.topX - 2 + k, 20 + i * 2)) q.set(T.topX - 2 + k, 20 + i * 2, k ? sk[0] : sk[3]); });
  // the head: tall and narrow, the jaw hanging to the chest, a mouthful of teeth
  layer(p, (q) => {
    limb(q, [cx + 1, 15], [cx + 3, 10], 1.8, 1.8, sk);
    limb(q, [cx + 2, 10], [cx + 6, 21], 2.2, 2, sk); // the unhinged jaw
    oval(q, cx + 3, 6.5, 4.4, 5, sk, {});
    for (let y = 10; y <= 19; y++) { q.set(cx + 5 + (y > 14 ? 1 : 0), y, MOUTH); q.set(cx + 6 + (y > 14 ? 1 : 0), y, y % 3 === 0 ? BONE[2] : MOUTH); }
    q.set(cx + 7, 10, BONE[2]); q.set(cx + 8, 11, BONE[2]);
    for (const x of [cx + 3, cx + 6]) { q.set(x, 5, "#ff4a3a"); q.set(x + 1, 5, "#ffb0a0"); q.set(x, 6, "#7a1410"); }
  });
  layer(p, (q) => zarm(q, S.N, add(S.N, [2, 8]), add(S.N, [3, 16]), sk, { r: 1.7, hand: { droop: 1.4, n: 3, len: 4 } }));
  shriek(p, cx + 7, 9, SHRIEK_R, [6, 9], -0.75, 0.6);
  return p;
}
const SPECIAL = { spitter, screamer, crawler, shepherd, carrier, swarm, boneback, climber, flinger, sower, nightmare };
export const SPECIAL_KINDS = Object.keys(SPECIAL);
export const paintSpecialHD = (kind) => (SPECIAL[kind] || spitter)();

// ---------- the bosses (hivesprites.js), on an 88 × 104 grid ----------
// Twice the figures' grid, the same volumes at twice the size: feet on row 101, cols 0 and 87 and rows 0, 102, 103
// free for the outline.
const BW = 88, BH = 104, FLOOR = 101;
// A boss's head at twice a figure's: a shaded skull, a heavy brow, eyes in deep sockets (eyes: their centres), a
// nose, a hanging jaw with a row of teeth.
function bossHead(p, { x, y, rx, ry, skin, eyes, eyeCol, jaw = 5, glow = true }) {
  limb(p, [x - 2, y + ry * 0.4], [x + rx * 0.45, y + ry * 0.7 + jaw], 4.4, 3.6, skin); // the jaw
  oval(p, x, y, rx, ry, skin, {});
  // the mouth between the face and the jaw, teeth along the top and a few on the jaw
  for (let i = 0; i <= 8; i++) { const t = i / 8, mx = Math.round(x - rx * 0.1 + rx * 0.75 * t), my = Math.round(y + ry * 0.45 + jaw * 0.5 * t); for (let k = 0; k <= jaw - 1; k++) p.set(mx, my + k, MOUTH); if (i % 2 === 0) { p.set(mx, my, BONE[2]); p.set(mx, my + 1, BONE[1]); } else p.set(mx, my + jaw - 1, BONE[1]); }
  for (const [ex, ey] of eyes) {
    oval(p, ex, ey, 2.2, 1.7, [SOCKET, SOCKET, SOCKET, SOCKET], { specular: false });
    p.set(ex, ey, eyeCol); p.set(ex + 1, ey, eyeCol); p.set(ex, ey - 1, mix(eyeCol, "#ffffff", 0.5));
    if (glow) { p.set(ex + 2, ey - 1, mix(eyeCol, skin[1], 0.5)); p.set(ex - 1, ey + 1, mix(eyeCol, SOCKET, 0.5)); }
    p.hl(ex - 2, ex + 2, ey - 2, skin[0]); // the brow's shadow over the socket
  }
  p.set(Math.round(x + rx), Math.round(y + 1), skin[1]); p.set(Math.round(x + rx), Math.round(y + 2), skin[0]); p.set(Math.round(x + rx - 1), Math.round(y + 2), skin[0]); // the nose
}

// The Wallbreaker: a hulking grey brute twice a shambler's bulk, legs planted wide, the head sunk low between the
// shoulders, one arm hanging knuckles down, the other raised with a slab of concrete bound to the fist with rebar.
function wallbreaker() {
  const p = painter(BW, BH), sk = deadSkin("#8f9a86"), pants = ramp("#3a3a36"), boot = ramp("#2e2a26", { spec: 0.3 }), cx = 38;
  const T = { top: 34, bot: 70, topX: cx + 2, botX: cx, hs: 23, hw: 15, hh: 15.5, dropN: 0, dropF: 2, corner: 9, hump: 1 };
  const S = shoulders(T);
  S.N = [S.N[0] - 2, S.N[1] + 2]; S.F = [S.F[0] + 2, S.F[1] + 2];
  const CONC = ramp("#9a968c", { spec: 0.4 });
  // the far arm hanging, knuckles down
  zarm(p, S.F, add(S.F, [-8, 14]), add(S.F, [-7, 30]), dim(sk), { r: 7.4, hand: { fist: true, r: 6.2 } });
  for (let i = 0; i < 3; i++) p.set(Math.round(S.F[0] - 10 + i * 3), Math.round(S.F[1] + 38), dim(sk)[0]); // knuckles
  // legs planted wide, the boots split at the toes
  const legs = [[[cx - 8, 68], [cx - 14, 83], [cx - 14, 94]], [[cx + 8, 68], [cx + 13, 83], [cx + 12, 94]]];
  zleg(p, ...legs[0], dim(pants), dim(sk), { r: 7 }); shoe(p, legs[0][2], dim(boot), { len: 16, h: 8, floor: FLOOR, back: 5 });
  layer(p, (q) => { zleg(q, ...legs[1], pants, sk, { r: 7 }); shoe(q, legs[1][2], boot, { len: 16, h: 8, floor: FLOOR, back: 5 }); for (const [x, y] of [[legs[1][2][0] + 9, 96], [legs[1][2][0] + 10, 96]]) { q.set(x, y, sk[1]); q.set(x, y + 1, sk[0]); } });
  layer(p, (q) => {
    const inT = dress(q, T, { skin: sk, cloth: null, pants, style: "tank", clothes: "torn", rng: new Rng(1), belt: true });
    oval(q, T.topX - 8, 45, 10, 6.4, sk, { cut: inT, specular: false }); oval(q, T.topX + 9, 45.5, 10, 6.4, sk, { cut: inT }); // the pecs
    for (let y = 53; y <= 64; y++) q.over(Math.round(T.topX + 1), y, mix(sk[1], sk[0], 0.55)); // the line down the belly
    for (let i = 0; i < 4; i++) for (let k = 0; k < 7; k++) q.over(Math.round(T.topX - 18 + k), 52 + i * 3 + (k > 4 ? 1 : 0), k === 0 ? sk[2] : sk[0]); // ribs through the skin on its flank
    oval(q, T.topX + 2, T.top + 3, 15, 5.6, sk, { specular: false }); // the trapezius, the head sunk in it
    for (const [x, y, n] of [[T.topX - 10, 48, 4], [T.topX + 12, 56, 6], [T.topX - 4, 62, 3]]) wound(q, x, y, 2, { streak: n });
  });
  layer(p, (q) => bossHead(q, { x: cx + 10, y: 30, rx: 8.6, ry: 9, skin: sk, eyes: [[cx + 11, 28], [cx + 16, 28]], eyeCol: "#e2412f", jaw: 4 }));
  // the raised arm, and the slab bound to its fist
  const eN = add(S.N, [14, -5]), hN = add(eN, [-1, -16]);
  layer(p, (q) => {
    const sx0 = hN[0] - 15, sx1 = Math.min(85, hN[0] + 13), sy0 = 1, sy1 = hN[1] + 4;
    const chip = (x, y) => (x - sx0 < 4 - (y - sy0) && y - sy0 < 4) || (sx1 - x < 3 - (sy1 - y) && sy1 - y < 3) || (x - sx0 < 2 - (sy1 - y) && sy1 - y < 2);
    blob(q, (x, y) => x >= sx0 && x <= sx1 && y >= sy0 && y <= sy1 && !chip(x, y), CONC, { specular: true });
    for (const [x, y] of [[sx0 + 5, sy0 + 5], [sx0 + 13, sy0 + 3], [sx0 + 8, sy0 + 11], [sx0 + 17, sy0 + 9]]) { q.set(x, y, CONC[0]); q.set(x + 1, y, CONC[0]); q.set(x, y - 1, CONC[2]); } // pits
    q.line(sx0 + 2, sy0 + 9, sx0 + 7, sy0 + 13, CONC[0]); // a crack
    // rebar: rods bent out of the broken concrete
    for (const pts of [[[sx0 + 3, sy0 + 4], [sx0 - 2, sy0 + 1]], [[sx1 - 5, sy0 + 4], [sx1 - 1, sy0 + 1], [sx1, sy0 + 5]], [[sx0 + 4, sy1 - 2], [sx0 - 2, sy1 + 4]]]) for (let i = 0; i + 1 < pts.length; i++) limb(q, pts[i], pts[i + 1], 1, 1, PAL.rust);
  });
  layer(p, (q) => {
    zarm(q, S.N, eN, hN, sk, { r: 7.4, hand: { fist: true, r: 6 } });
    for (let i = 0; i < 3; i++) limb(q, [hN[0] - 7, hN[1] + 4 + i * 3], [hN[0] + 7, hN[1] + 2 + i * 3], 1, 1, PAL.rust); // rebar wound round the fist
  }, { cast: 2 });
  return p;
}

// The Broodmother: the bloated queen of a hive grown from a mound of flesh, mottled grey-pink, egg sacs swelling on
// her back, a broad head with three amber eyes and a crown of bone, clawed arms out at her sides.
function broodmother() {
  const p = painter(BW, BH), sk = deadSkin("#a07e8a"), mound = FLESH, cx = 44;
  oval(p, cx, 94, 40, 7, mound, {}); // the mound she grows from
  for (const [x, y, r] of [[20, 38, 9], [34, 28, 8], [56, 28, 8], [69, 38, 9], [12, 54, 7], [77, 54, 7]]) layer(p, (q) => { oval(q, x, y, r, r * 0.9, AMBER, {}); for (const [dx, dy] of [[-2, 1], [2, -1], [1, 3], [-3, -2]]) ball(q, x + dx, y + dy, 1.4, ["#7a4210", "#a06018", "#c47a22", "#e0a050"]); }); // the egg sacs
  // the clawed arms, out at her sides
  const claw = (q, h, d) => { for (let i = 0; i < 3; i++) limb(q, [h[0] + d * (i - 1) * 2, h[1] + 3], [h[0] + d * (i - 1) * 3.4 + d * 1, h[1] + 11 - Math.abs(i - 1) * 2], 1.6, 0.6, BONE); };
  zarm(p, [22, 52], [10, 64], [8, 79], dim(sk), { r: 5, hand: { fist: true, r: 4.2 } }); claw(p, [8, 79], -1);
  layer(p, (q) => {
    oval(q, cx, 62, 28, 25, sk, {});
    for (const [x, y, rx, ry] of [[cx - 12, 54, 5, 3.4], [cx + 9, 70, 6.4, 4], [cx - 4, 78, 4, 2.6], [cx + 14, 52, 3.6, 2.4]]) oval(q, x, y, rx, ry, [sk[0], mix(sk[1], sk[0], 0.45), sk[1], sk[2]], { specular: false }); // mottling
    for (const [x0, y0, x1, y1] of [[cx - 20, 64, cx - 10, 72], [cx + 4, 58, cx + 16, 62], [cx - 6, 84, cx + 4, 80]]) { q.line(x0, y0, x1, y1, GORE.rim); q.line(x0, y0 + 1, x1, y1 + 1, mix(sk[1], GORE.rim, 0.4)); } // veins
    for (const [x, y] of [[cx - 16, 76], [cx + 18, 66], [cx + 2, 46]]) ball(q, x, y, 1.4, PUS);
  });
  layer(p, (q) => {
    bossHead(q, { x: cx + 1, y: 31, rx: 12, ry: 10, skin: sk, eyes: [[cx - 5, 29], [cx + 1, 27], [cx + 7, 29]], eyeCol: "#ffd166", jaw: 7 });
    for (const [x, a, l] of [[cx - 8, -2.1, 8], [cx - 3, -1.8, 10], [cx + 2, -1.57, 12], [cx + 7, -1.35, 10], [cx + 11, -1.05, 8]]) limb(q, [x, 24], [x + Math.cos(a) * l, 24 + Math.sin(a) * l], 2.4, 0.6, BONE); // the crown of bone
  });
  layer(p, (q) => { zarm(q, [66, 52], [78, 64], [80, 79], sk, { r: 5.2, hand: { fist: true, r: 4.4 } }); claw(q, [80, 79], 1); }, { cast: 1 });
  return p;
}

// The Hivemind: the organ at the heart of a hive, a folded mass of grey-pink flesh like a brain the size of a car,
// its lobes round shaded volumes, veined and glowing from inside, amber pods and coiled tendrils at its foot.
// torn: its second phase, redder, split down the middle with light pouring out, the pods burst.
function hivemind(torn = false) {
  const p = painter(BW, BH), rng = new Rng(torn ? 12 : 11), cx = 44, cy = 54, RX = 38, RY = 34;
  const M = torn ? ["#5a1424", "#a8404e", "#d46a74", "#ffb4b0"] : FLESH;
  const inMass = (x, y) => ((x - cx) / (RX + 0.5)) ** 2 + ((y - cy) / (RY + 0.5)) ** 2 <= 1 && y <= 92;
  oval(p, cx, 95, 40, 5, torn ? ["#2a0810", "#4a1420", "#6a2030", "#8a3040"] : ["#2a1018", "#4a2030", "#6a3446", "#8a4a5a"], { specular: false }); // the pool it grows from
  // tendrils coiled at its foot
  const coil = (q, x, y, d) => { const pts = [[x, y], [x + d * 6, y - 1], [x + d * 10, y + 2], [x + d * 10, y + 6], [x + d * 7, y + 7], [x + d * 6, y + 4]]; for (let i = 0; i + 1 < pts.length; i++) limb(q, pts[i], pts[i + 1], 2.2 - i * 0.25, 2 - i * 0.25, M); };
  coil(p, cx - 30, 86, -1); coil(p, cx + 30, 86, 1);
  // the mass: the dark tone first (the grooves), then the lobes, back to front, each its own volume
  blob(p, inMass, [M[0], M[0], M[0], M[0]], { flat: true });
  // the folds: winding tubes of flesh packed into the mass, row under row, each its own volume (a seam where it
  // lies on the ones behind), split down the top by the fissure between the two halves
  const lobes = [];
  for (let row = 0; row < 9; row++) for (let k = 0; k < 4; k++) {
    let x = cx - RX + 2 + k * 21 + rng.range(-4, 4) + (row % 2) * 9, y = cy - RY + 5 + row * 8 + rng.range(-1.5, 1.5), a = rng.range(-0.7, 0.7);
    const pts = [[x, y]];
    for (let i = 0; i < 5; i++) { a = Math.max(-1.3, Math.min(1.3, a + rng.range(-1.1, 1.1))); x += Math.cos(a) * 5; y += Math.sin(a) * 3.4; pts.push([x, y]); }
    lobes.push([pts[2][0], pts[2][1], 4, 3]);
    layer(p, (q) => { for (let i = 0; i + 1 < pts.length; i++) limb(q, pts[i], pts[i + 1], 4.2, 4.2, M); for (const [X, Y] of q.pixels()) if (!inMass(X, Y) || (Math.abs(X - cx) < 1 && Y < cy - 12)) q.clear(X, Y); });
  }
  for (let y = cy - RY; y < cy - 12; y++) if (inMass(cx, y)) { p.set(cx, y, M[0]); p.set(cx + 1, y, M[0]); } // the fissure
  // the whole mass as one volume: lit toward the upper left, in shadow toward the lower right
  for (const [x, y, c] of p.pixels()) {
    if (!inMass(x, y)) continue;
    const nx = (x - cx) / RX, ny = (y - cy) / RY, r = nx * nx + ny * ny, d = -0.62 * nx - 0.78 * ny;
    if (r > 0.45 && d < -0.25) p.set(x, y, mix(c, M[0], d < -0.6 ? 0.6 : 0.35));
    else if (r > 0.3 && d > 0.55) p.set(x, y, mix(c, M[3], 0.18));
  }
  // the light from inside, in the grooves
  const glow = torn ? ["#c45a12", "#ff9a3a", "#ffd36b", "#fff4c8"] : AMBER;
  for (let i = 0; i < 9; i++) { const [x, y, rx, ry] = rng.pick(lobes), gx = Math.round(x + rx * 0.9), gy = Math.round(y + ry * 0.6); if (inMass(gx, gy)) { p.set(gx, gy, glow[2]); p.set(gx + 1, gy, glow[1]); p.set(gx, gy + 1, glow[1]); } }
  // veins: dark red runs across the lobes
  for (let i = 0; i < 7; i++) { let x = rng.range(cx - 28, cx + 28), y = rng.range(cy - 22, cy + 24); const dx = rng.range(-1, 1), col = torn ? "#ff5a2a" : GORE.rim; for (let k = 0; k < 9; k++) { x += dx + rng.range(-0.6, 0.6); y += 0.8; if (inMass(Math.round(x), Math.round(y))) p.set(Math.round(x), Math.round(y), col); } }
  if (torn) { // split down the middle, light pouring out
    for (let y = cy - RY + 4; y <= 90; y++) {
      const t = (y - (cy - RY + 4)) / (90 - (cy - RY + 4)), w = Math.round(1 + 4 * Math.sin(Math.PI * t)), xc = Math.round(cx + Math.sin(y * 0.5) * 1.5);
      for (let dx = -w - 1; dx <= w + 1; dx++) p.set(xc + dx, y, Math.abs(dx) === w + 1 ? GORE.rim : Math.abs(dx) === w ? glow[1] : Math.abs(dx) >= w - 1 ? glow[2] : glow[3]);
    }
  }
  // pods at its foot (burst in the second phase)
  for (const [x, y, r] of [[12, 86, 5], [22, 93, 4.4], [66, 93, 4.6], [77, 86, 5.2]]) {
    if (torn) { oval(p, x, y, r, r * 0.8, [GORE.core, GORE.core, GORE.rim, GORE.rim], { specular: false }); for (const [dx, dy] of [[-r, -1], [r, 0], [0, -r]]) { p.set(Math.round(x + dx), Math.round(y + dy * 0.8), AMBER[1]); p.set(Math.round(x + dx * 0.8), Math.round(y + dy * 0.8 - 1), AMBER[2]); } }
    else oval(p, x, y, r, r * 0.85, AMBER, {});
  }
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
SHEET.push({ label: "", paint: () => painter(W, H) });
SHEET.push(...comparePairs());
