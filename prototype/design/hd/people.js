// HD people (design preview only: src/ is unchanged): survivors and the hostile human kits (raiders, soldiers,
// zealots) painted on the 44 × 52 grid, twice ui/sprites.js's 22 × 26 (the same on-screen size, four times the
// pixels). Same silhouette language as the game's sprites, facing right, with the extra pixels spent on the face, the
// hair, the clothes' folds and seams, hands, boots and the weapon's detail.
//
// Grid conventions (every HD character set keeps them so they match on one map):
//   - head: cols 14..27, rows 5..20 (14 wide, 16 tall), neck rows 21..22, torso rows 23..34 (belt rows 33..34),
//     legs rows 35..45, boots rows 44..49 (sole rows 48..49); row 50-51 and cols 0 / 43 stay free for the outline;
//   - the torso is cols TL..TR = 2L..2R+1 of the game's BUILD (slim 14..27, average 12..29, heavy 10..31);
//     the back (left) arm is cols TL-4..TL-1, the front (right) arm cols TR+1..TR+4; the right hand hangs at
//     rows 34..36 and a melee weapon's grip crosses it at cols TR+2..TR+3; a gun sits at rows 24..26 with its
//     pistol grip in the right hand (rows 27..30) and the muzzle at most at col 42;
//   - light from the upper left: every material has 4 tones (tones(): hi / base / lo / deep; highlights warmed,
//     shadows cooled), the left edge of a form is hi, the right edge lo, and a deep tone (never black) separates
//     overlapping forms; the black rim is added by hdcore outline().
import { painter, outline, shade, mix, desat, warm, scaled } from "./hdcore.js";
import { Rng } from "../../src/sim/rng.js";
import { randomAppearance, LOOK_OPTIONS } from "../../src/sim/appearance.js";
import { paintSurvivor, paintEnemyHuman, enemyLookOf } from "../../src/ui/sprites.js";
import { BLADE_LOOK } from "../../src/sim/data-blades.js";

// ---------- tones ----------
// A dark base (black hair, black leather) gets a stronger lift so its highlight still reads.
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11; };
export const tones = (base) => {
  const dark = lum(base) < 70, lift = dark ? 0.32 : 0.2;
  return { base, hi: warm(shade(base, lift), dark ? 0.06 : 0.1), lo: warm(shade(base, -0.22), -0.08), deep: warm(shade(base, -0.45), -0.1) };
};
const WHITE = "#f1ede4", WHITE_LO = "#c9c3b8", PUPIL = "#17181c", IRIS = "#2c3a46";
const BOOT = tones("#3a302a"), SOLE = "#1c1917", SOLE_HI = "#4a4039";
const BELT = tones("#2c2420"), BUCKLE = "#c7a44c", BUCKLE_HI = "#efd98a";
const METAL = tones("#9aa3ab"), BRIGHT = "#dfe5e9", GUNMETAL = tones("#33373d"), WOOD = tones("#7a5230"), DARKWOOD = tones("#4b3220");

const BUILD = { slim: [7, 13], average: [6, 14], heavy: [5, 15] };
// The body's columns from the game's build: torso TL..TR, its middle, the two arms.
function frame(build) {
  const [L, R] = BUILD[build] || BUILD.average;
  const TL = 2 * L, TR = 2 * R + 1, mid = (TL + TR - 1) >> 1;
  return { TL, TR, mid, AL: [TL - 4, TL - 1], AR: [TR + 1, TR + 4] };
}

// ---------- head ----------
const HEAD_ROWS = { 5: [17, 24], 6: [15, 26], 7: [14, 27], 8: [14, 27], 9: [14, 27], 10: [14, 27], 11: [14, 27], 12: [14, 27], 13: [14, 27], 14: [14, 27], 15: [14, 27], 16: [14, 27], 17: [15, 26], 18: [16, 25], 19: [17, 24], 20: [18, 23] };
function drawHead(p, skin, { ears = true } = {}) {
  const S = tones(skin);
  for (const [y, [x0, x1]] of Object.entries(HEAD_ROWS)) p.hl(x0, x1, +y, S.base);
  // the lit side and the shadowed side
  p.vl(27, 7, 16, S.lo); p.vl(26, 8, 18, S.lo); p.set(26, 7, S.lo); p.set(27, 16, S.deep);
  p.hl(17, 24, 19, S.lo); p.hl(18, 23, 20, S.lo); p.hl(19, 22, 20, S.deep); p.set(25, 18, S.lo); p.set(24, 18, S.lo); p.set(16, 18, S.lo); p.set(27, 16, S.deep); p.set(26, 17, S.deep);
  p.hl(15, 18, 7, S.hi); p.hl(15, 17, 8, S.hi); p.vl(15, 9, 11, S.hi); p.set(14, 10, S.hi);
  // ears (the far one lit, the near one in shadow), the neck in the chin's shadow
  if (ears) {
    p.rect(12, 11, 13, 14, S.base); p.set(13, 12, S.lo); p.set(13, 13, S.lo); p.set(12, 14, S.lo);
    p.rect(28, 11, 29, 14, S.lo); p.set(28, 12, S.deep); p.set(28, 13, S.deep); p.set(29, 14, S.deep);
  }
  p.rect(18, 21, 23, 22, S.lo); p.hl(18, 23, 21, S.deep); p.set(18, 22, S.base);
  return S;
}
function drawFace(p, skin, hair, { brows = true } = {}) {
  const S = tones(skin);
  // brows
  if (brows) { const b = mix(S.lo, hair, 0.5); p.hl(16, 18, 11, b); p.hl(22, 24, 11, b); p.set(19, 11, mix(b, S.base, 0.5)); p.set(25, 11, mix(b, S.base, 0.5)); }
  // eyes (looking right): a white, two pupil pixels, a lid line under
  for (const x of [16, 22]) {
    p.set(x, 12, WHITE); p.set(x, 13, WHITE_LO);
    p.rect(x + 1, 12, x + 2, 13, PUPIL); p.set(x + 1, 12, IRIS);
    p.hl(x, x + 2, 14, S.lo);
  }
  // nose: bridge lit, the near side and the underside in shadow
  p.vl(20, 12, 14, S.hi); p.vl(21, 13, 15, S.lo); p.hl(20, 21, 16, S.lo); p.set(22, 16, S.deep); p.set(20, 16, S.base);
  // mouth
  const lip = mix(S.deep, "#8a3c38", 0.3);
  p.hl(18, 23, 18, lip); p.set(24, 18, S.lo); p.hl(19, 22, 19, mix(S.lo, lip, 0.3));
  // a cheek line on the near side
  p.vl(25, 15, 17, S.lo);
}
function drawFacial(p, facial, hair, skin) {
  const H = tones(hair), S = tones(skin);
  if (facial === "beard") {
    p.rect(15, 16, 26, 18, H.base); p.rect(16, 19, 25, 20, H.base); p.rect(17, 21, 24, 22, H.lo); p.hl(18, 23, 23, H.deep);
    p.vl(14, 14, 16, H.lo); p.vl(27, 14, 16, H.deep); p.hl(15, 17, 15, H.base); p.hl(24, 26, 15, H.lo);
    p.rect(19, 17, 22, 17, H.deep); // the mouth's gap
    p.hl(15, 18, 16, H.hi); p.set(16, 17, H.hi); p.vl(26, 16, 18, H.deep); p.hl(23, 25, 20, H.deep);
  } else if (facial === "stache") {
    p.hl(18, 24, 17, H.base); p.rect(19, 16, 23, 16, H.base); p.set(18, 17, H.hi); p.set(24, 17, H.lo); p.hl(19, 23, 18, H.lo);
  } else if (facial === "stubble") {
    const st = mix(skin, hair, 0.32), st2 = mix(S.lo, hair, 0.32);
    p.rect(15, 16, 26, 18, st); p.rect(16, 19, 25, 19, st2); p.hl(17, 24, 20, st2); p.vl(26, 16, 18, st2); p.vl(14, 14, 16, st); p.vl(27, 14, 15, st2);
    const lip = mix(S.deep, "#8a3c38", 0.3); p.hl(18, 23, 18, lip); p.set(24, 18, S.lo); // mouth again, over the stubble
  }
}

// ---------- hair ----------
const SKULL = [[3, 17, 24], [4, 15, 26], [5, 14, 27], [6, 13, 27], [7, 13, 27], [8, 13, 27]];
function drawHair(p, style, hair, skin, { behind = false } = {}) {
  const H = tones(hair);
  const cap = () => { for (const [y, x0, x1] of SKULL) p.hl(x0, x1, y, H.base); p.hl(13, 14, 9, H.base); p.set(13, 10, H.lo); p.vl(27, 9, 10, H.lo); p.set(27, 11, H.deep); };
  const shadeCap = () => { p.vl(27, 5, 8, H.deep); p.vl(26, 4, 8, H.lo); p.hl(23, 25, 3, H.lo); p.hl(24, 25, 4, H.lo); p.hl(17, 20, 3, H.hi); p.hl(15, 18, 4, H.hi); p.set(14, 5, H.hi); p.hl(16, 17, 5, H.hi); };
  const fringe = () => { p.hl(21, 26, 9, H.base); p.hl(23, 26, 10, H.base); p.set(26, 10, H.lo); p.set(21, 9, H.lo); p.hl(14, 15, 9, H.base); p.set(14, 10, H.lo); };
  if (behind) { // the long hair's fall and the ponytail, painted before the body
    if (style === "long") {
      p.rect(11, 8, 13, 24, H.lo); p.rect(28, 8, 30, 23, H.deep); p.vl(11, 9, 22, H.base); p.vl(30, 9, 20, H.deep); p.hl(12, 13, 25, H.deep); p.hl(28, 29, 24, H.deep);
      p.rect(12, 20, 13, 22, H.base); p.set(11, 24, H.deep);
    } else if (style === "ponytail") {
      p.rect(9, 6, 12, 10, H.lo); p.rect(8, 9, 11, 17, H.base); p.rect(9, 18, 10, 20, H.lo); p.vl(8, 10, 16, H.hi); p.vl(11, 10, 17, H.lo); p.hl(9, 10, 21, H.deep);
      p.hl(9, 11, 8, H.deep); // the tie
    }
    return;
  }
  switch (style) {
    case "bald": { const S = tones(skin); p.hl(16, 19, 6, S.hi); p.hl(15, 18, 7, S.hi); p.set(15, 6, S.hi); p.hl(17, 24, 5, S.base); break; }
    case "buzz": { // a dark shadow of hair over the skull
      const b = mix(skin, hair, 0.72), b2 = mix(skin, hair, 0.55);
      for (const [y, x0, x1] of SKULL) if (y <= 7) p.hl(x0, x1, y, b);
      p.hl(14, 15, 8, b); p.hl(13, 14, 9, b2); p.vl(13, 10, 11, b2); p.hl(26, 27, 8, b); p.vl(27, 9, 10, b2); p.hl(17, 20, 3, b2); p.hl(16, 17, 4, b2); p.vl(27, 5, 7, mix(b, "#000", 0.2));
      break;
    }
    case "short": cap(); shadeCap(); fringe(); p.set(12, 9, H.lo); p.set(28, 8, H.deep); break;
    case "long": cap(); shadeCap(); fringe(); p.vl(13, 9, 11, H.base); p.rect(12, 9, 12, 13, H.lo); p.rect(28, 8, 28, 13, H.deep); p.set(28, 7, H.lo); break;
    case "ponytail": cap(); shadeCap(); p.hl(14, 15, 9, H.base); p.hl(22, 26, 9, H.base); p.set(26, 9, H.lo); p.hl(13, 14, 8, H.lo); break;
    case "mohawk": {
      const b = mix(skin, hair, 0.5), b2 = mix(skin, hair, 0.62);
      for (const [y, x0, x1] of SKULL) if (y >= 5) p.hl(x0, x1, y, b); // shaved sides
      p.hl(13, 14, 9, b); p.vl(27, 9, 10, b2); p.vl(26, 5, 8, b2); p.set(27, 5, b2); p.vl(27, 6, 8, mix(b2, "#000", 0.15));
      // the crest: a brush six pixels wide standing straight up from the scalp, its tips splayed, lit on its left face
      p.rect(18, 2, 23, 8, H.base); p.hl(17, 24, 8, H.base); p.hl(17, 24, 7, H.base);
      p.set(18, 1, H.base); p.set(19, 1, H.base); p.set(22, 1, H.base); p.set(23, 1, H.base); p.set(18, 1, H.hi); p.set(20, 1, H.lo); p.set(23, 1, H.lo); p.set(21, 2, H.lo);
      p.vl(18, 2, 8, H.hi); p.vl(19, 3, 7, H.hi); p.set(17, 7, H.hi); p.vl(23, 2, 8, H.deep); p.vl(22, 3, 7, H.lo); p.set(24, 7, H.deep); p.set(24, 8, H.deep); p.set(17, 8, H.base);
      p.hl(16, 25, 9, H.lo); p.set(15, 9, b); p.set(26, 9, mix(b2, "#000", 0.15)); p.hl(17, 24, 9, H.deep);
      break;
    }
    case "curly": {
      p.rect(13, 3, 28, 10, H.base); p.rect(14, 2, 27, 2, H.base); p.rect(16, 1, 25, 1, H.base); p.rect(12, 5, 12, 10, H.base); p.rect(29, 5, 29, 10, H.lo);
      p.rect(11, 7, 11, 9, H.base); p.rect(30, 7, 30, 9, H.lo); p.hl(12, 13, 11, H.base); p.hl(28, 29, 11, H.deep); p.set(12, 12, H.lo); p.set(29, 12, H.deep);
      p.hl(14, 17, 11, H.base); p.hl(23, 27, 11, H.lo); p.hl(14, 15, 12, H.lo); p.set(27, 12, H.deep); p.hl(13, 14, 4, H.hi);
      // bumps of light along the top left, the deep side on the right
      for (const [x, y] of [[16, 2], [17, 1], [19, 2], [20, 1], [14, 4], [15, 3], [13, 6], [12, 8], [18, 4], [22, 2], [15, 6]]) p.set(x, y, H.hi);
      p.rect(26, 3, 28, 10, H.lo); p.vl(28, 4, 10, H.deep); p.vl(29, 6, 9, H.deep); p.hl(24, 26, 1, H.lo); p.hl(25, 27, 2, H.lo); p.set(29, 11, H.deep);
      for (const [x, y] of [[23, 5], [25, 8], [21, 9], [17, 9]]) p.set(x, y, H.lo);
      break;
    }
    default: break;
  }
}

// ---------- torso, arms, legs ----------
function drawTorso(p, F, color, style, skin, { belt = true } = {}) {
  const { TL, TR, mid } = F, C = tones(color), S = tones(skin);
  const top = 23, bot = belt ? 32 : 34;
  p.rect(TL, top, TR, bot, C.base);
  // shoulders slope: round the corners
  p.clear(TL, top); p.clear(TR, top);
  p.vl(TL + 1, top, bot, C.hi); p.set(TL, top + 1, C.hi); p.vl(TL, top + 2, bot, C.base);
  p.vl(TR, top + 1, bot, C.lo); p.vl(TR - 1, top + 1, bot, C.lo); p.set(TR, top + 1, C.deep);
  p.hl(TL + 2, TR - 2, top, C.hi);
  const shirt = mix(desat(color, 0.5), "#d8d2c4", 0.35);
  switch (style) {
    case "jacket": { // open front over a shirt, lapels, chest pockets, a zip
      p.rect(mid, top + 1, mid + 1, bot, shirt); p.vl(mid, top + 1, bot, shade(shirt, 0.08)); p.set(mid + 1, top + 1, shade(shirt, -0.15));
      p.vl(mid - 1, top + 1, bot, C.deep); p.vl(mid + 2, top + 1, bot, C.deep);
      p.rect(mid - 3, top, mid - 2, top + 2, C.hi); p.rect(mid + 3, top, mid + 4, top + 2, C.lo); p.set(mid - 2, top + 3, C.hi); p.set(mid + 3, top + 3, C.lo); p.hl(mid - 1, mid, top, C.deep); p.hl(mid + 1, mid + 2, top, C.deep);
      p.hl(TL + 2, mid - 3, top + 6, C.deep); p.hl(mid + 4, TR - 2, top + 6, C.deep); p.hl(TL + 2, mid - 3, top + 7, C.hi); p.hl(mid + 4, TR - 2, top + 7, C.base);
      p.set(mid - 1, top + 5, warm(C.hi, 0.2)); // the zip pull catches the light
      break;
    }
    case "hoodie": { // a hood bunched at the neck, drawstrings, a kangaroo pocket
      p.rect(TL + 3, 20, TR - 3, 24, C.lo); p.hl(TL + 4, TR - 4, 20, C.base); p.hl(TL + 3, TR - 3, 25, C.deep); p.rect(TL + 4, 21, TL + 5, 24, C.hi); p.set(TR - 3, 24, C.deep);
      p.rect(mid - 2, 21, mid + 3, 23, C.deep); p.hl(mid - 1, mid + 2, 24, C.deep); // the hood's opening: shadow under the chin
      p.hl(mid - 3, mid + 4, 25, C.lo); p.hl(mid - 2, mid + 3, 26, C.lo);
      p.vl(mid - 1, 26, 29, "#e8e2d4"); p.vl(mid + 2, 26, 30, "#e8e2d4"); p.set(mid - 1, 30, "#9c948a"); p.set(mid + 2, 31, "#9c948a");
      p.rect(TL + 3, 29, TR - 3, bot, C.lo); p.hl(TL + 3, TR - 3, 29, C.deep); p.vl(TL + 3, 29, bot, C.deep); p.vl(TR - 3, 29, bot, C.deep); p.hl(TL + 4, TR - 4, 30, C.base);
      p.vl(mid - 1, 26, 26, "#e8e2d4");
      break;
    }
    case "flannel": { // a plaid: lines every four pixels, the crossings deeper, a shirt collar
      const ln = C.lo, cross = C.deep;
      for (let y = top + 1; y <= bot; y++) for (let x = TL; x <= TR; x++) {
        const vy = (y - top) % 4 === 0, vx = (x - TL - 2) % 4 === 0;
        if (vy && vx) p.set(x, y, cross); else if (vy || vx) p.set(x, y, ln);
      }
      p.vl(TL + 1, top + 1, bot, C.hi); p.vl(TR, top + 2, bot, C.deep);
      p.rect(mid - 2, top, mid - 1, top + 2, C.hi); p.rect(mid + 2, top, mid + 3, top + 2, C.lo); p.rect(mid, top, mid + 1, top + 1, S.lo);
      p.vl(mid, top + 2, bot, C.deep); p.vl(mid + 1, top + 3, bot, C.lo); // the button placket
      for (let y = top + 3; y <= bot; y += 3) p.set(mid + 1, y, "#d9cfa8");
      break;
    }
    case "tank": { // bare shoulders, two straps, a scooped neck
      p.rect(TL, top, TR, top + 2, S.base); p.vl(TL + 1, top + 1, top + 2, S.hi); p.vl(TR - 1, top + 1, top + 2, S.lo); p.set(TL, top + 1, S.hi); p.vl(TR, top + 1, top + 2, S.deep);
      p.clear(TL, top); p.clear(TR, top); p.hl(TL + 1, TR - 1, top, S.lo);
      p.rect(TL + 2, top, TL + 3, top + 2, C.hi); p.rect(TR - 3, top, TR - 2, top + 2, C.lo); p.set(TL + 2, top, C.base); p.set(TR - 2, top, C.deep);
      p.hl(TL + 4, TR - 4, top + 3, S.lo); p.hl(TL + 5, TR - 5, top + 4, S.lo); p.hl(mid - 1, mid + 2, top + 5, S.lo); p.set(mid, top + 6, S.lo);
      p.hl(TL + 4, TR - 4, top + 3, S.base); p.hl(mid - 3, mid + 4, top + 4, S.base);
      p.hl(TL + 2, TL + 3, top + 3, C.hi); p.hl(TR - 3, TR - 2, top + 3, C.lo);
      p.vl(mid, top + 4, bot, C.lo); // a fold down the middle
      break;
    }
    default: { // t-shirt: a ribbed round collar, folds
      p.rect(mid - 2, top, mid + 3, top + 1, S.base); p.hl(mid - 2, mid + 3, top + 1, S.lo); p.set(mid + 3, top, S.lo); p.set(mid - 2, top, S.hi);
      p.set(mid - 3, top, C.lo); p.set(mid + 4, top, C.deep); p.hl(mid - 2, mid + 3, top + 2, C.lo);
      p.vl(mid + 2, top + 5, bot - 1, C.lo); p.vl(TL + 3, top + 6, bot - 2, C.hi);
      break;
    }
  }
  if (belt) {
    p.rect(TL, 33, TR, 34, BELT.base); p.hl(TL, TR, 33, BELT.hi); p.set(TR, 33, BELT.lo); p.set(TR, 34, BELT.deep); p.set(TL, 34, BELT.lo);
    p.rect(mid, 33, mid + 1, 34, BUCKLE); p.set(mid, 33, BUCKLE_HI); p.set(mid + 2, 33, BELT.deep); p.set(mid - 1, 34, BELT.deep);
    p.set(TL + 2, 33, BELT.deep); p.set(TR - 2, 33, BELT.deep); p.set(TL + 2, 34, BELT.deep); p.set(TR - 2, 34, BELT.deep); // loops
  }
}

// An arm hanging straight (side: -1 the back arm, +1 the front one). Sleeve length by the top style; the hand at
// rows 34..36 with a hint of fingers.
function drawArm(p, F, side, sleeve, skin, style, { cuff = true } = {}) {
  const [x0, x1] = side < 0 ? F.AL : F.AR;
  const C = tones(sleeve), S = tones(skin);
  const short = style === "tshirt", bare = style === "tank";
  const sleeveBot = bare ? 22 : short ? 28 : 33;
  const edgeHi = side < 0 ? x0 : x0, edgeLo = x1;
  if (sleeveBot >= 23) {
    p.rect(x0, 23, x1, sleeveBot, C.base);
    p.vl(edgeHi, 24, sleeveBot, C.hi); p.vl(edgeLo, 24, sleeveBot, side > 0 ? C.deep : C.lo); p.vl(edgeLo - 1, 24, sleeveBot, C.lo);
    p.hl(x0 + 1, x1 - 1, 23, C.hi); p.clear(x1, 23); p.set(x0, 23, C.base); // a rounded shoulder
    if (side < 0) { p.vl(x1, 24, sleeveBot, C.deep); } // the back arm is in the body's shadow
    if (short) { p.hl(x0, x1, sleeveBot, C.lo); p.set(x1, sleeveBot, C.deep); }
    else {
      p.hl(x0, x1, 28, side > 0 ? C.lo : C.deep); // the elbow's crease
      if (cuff) { p.hl(x0, x1, 32, C.deep); p.hl(x0, x1, 33, C.lo); p.set(x0, 33, C.hi); }
    }
  }
  const skinTop = sleeveBot + 1;
  if (skinTop <= 33) {
    p.rect(x0, skinTop, x1, 33, S.base); p.vl(x0, skinTop, 33, S.hi); p.vl(x1, skinTop, 33, S.lo); p.vl(x1 - 1, skinTop, 33, S.lo);
    if (bare) { p.set(x0, 23, S.base); p.clear(x1, 23); p.hl(x0 + 1, x1 - 1, 23, S.hi); p.hl(x0, x1, 29, S.lo); p.set(x1 - 1, 29, S.deep); } // the shoulder, the elbow
  }
  // the hand
  p.rect(x0, 34, x1, 36, S.base); p.vl(x0, 34, 36, S.hi); p.vl(x1, 34, 36, S.lo); p.hl(x0 + 1, x1 - 1, 36, S.lo);
  p.set(x1 - 1, 35, S.deep); p.set(x1 - 1, 36, S.deep); p.set(x0 + 1, 36, S.lo); // the thumb's crease and the fingers
  p.clear(x0, 36); p.set(x1, 36, S.deep);
}

// The front arm holding a gun: a short upper arm, the hand on the pistol grip at rows 27..30.
function drawGunArm(p, F, sleeve, skin, style, hx) {
  const [x0, x1] = F.AR, C = tones(sleeve), S = tones(skin);
  const bare = style === "tank", short = style === "tshirt";
  const sleeveBot = bare ? 22 : short ? 26 : 27;
  if (sleeveBot >= 23) {
    p.rect(x0, 23, x1, sleeveBot, C.base); p.vl(x0, 24, sleeveBot, C.hi); p.vl(x1, 24, sleeveBot, C.deep); p.vl(x1 - 1, 24, sleeveBot, C.lo);
    p.hl(x0 + 1, x1 - 1, 23, C.hi); p.clear(x1, 23); p.set(x0, 23, C.base);
    if (!short) { p.hl(x0, x1, sleeveBot, C.deep); }
  } else { p.set(x0, 23, S.base); p.hl(x0 + 1, x1 - 1, 23, S.hi); }
  if (sleeveBot < 27) { p.rect(x0, sleeveBot + 1, x1, 27, S.base); p.vl(x0, sleeveBot + 1, 27, S.hi); p.vl(x1, sleeveBot + 1, 27, S.lo); }
  // the hand on the grip
  p.rect(hx - 1, 27, hx + 2, 30, S.base); p.vl(hx - 1, 27, 30, S.hi); p.vl(hx + 2, 27, 30, S.lo); p.hl(hx, hx + 1, 30, S.lo); p.set(hx + 1, 28, S.lo); p.set(hx + 1, 29, S.deep);
  p.set(hx - 1, 30, S.lo); p.set(hx + 2, 30, S.deep);
}
// The back hand under a long gun's fore-end: the forearm across the chest.
function drawSupportArm(p, F, sleeve, skin, style, fx, fy) {
  const C = tones(sleeve), S = tones(skin);
  const bare = style === "tank" || style === "tshirt";
  const col = bare ? S : C;
  const x0 = F.TL + 1, y0 = fy + 5; // from the back shoulder's level, low on the chest, rising to the fore-end
  for (let x = x0; x < fx; x++) {
    const t = (x - x0) / Math.max(1, fx - 1 - x0), y = Math.round(y0 - (y0 - fy - 2) * t);
    p.rect(x, y, x, y + 2, col.base); p.set(x, y, col.hi); p.set(x, y + 2, col.lo); p.set(x, y - 1, col.deep); p.set(x, y + 3, col.deep); // the shadow lines part it from the chest
  }
  if (!bare) { p.vl(fx - 1, fy + 2, fy + 4, C.deep); p.vl(fx - 2, fy + 2, fy + 4, C.lo); }
  p.rect(fx, fy + 2, fx + 3, fy + 4, S.base); p.hl(fx, fx + 3, fy + 2, S.hi); p.vl(fx + 3, fy + 2, fy + 4, S.lo); p.hl(fx + 1, fx + 3, fy + 4, S.lo); p.set(fx + 2, fy + 3, S.deep); p.set(fx + 3, fy + 4, S.deep);
  p.set(fx, fy + 1, S.base); p.set(fx + 1, fy + 1, S.hi); // the fingers over the fore-end's edge
}

function drawLegs(p, F, pants, { boots = true } = {}) {
  const { TL, TR, mid } = F, P = tones(pants);
  const top = 35, bot = 45;
  // left leg (lit), right leg (behind, darker), the gap between them
  p.rect(TL + 1, top, mid, bot, P.base); p.rect(mid + 1, top, TR - 1, bot, P.lo);
  p.vl(TL + 1, top, bot, P.hi); p.vl(TL + 2, top, bot - 2, P.hi); p.vl(mid, top + 4, bot, P.lo); p.vl(TR - 1, top, bot, P.deep); p.vl(TR - 2, top + 1, bot, P.deep);
  p.rect(mid, top + 4, mid + 1, bot, P.deep); p.vl(mid, top + 3, top + 3, P.lo); p.vl(mid + 1, top + 3, top + 3, P.deep);
  p.hl(TL + 1, TR - 1, top, P.lo); // the belt's shadow
  // pockets, a fly, the knees' creases, the hems
  p.hl(TL + 2, TL + 4, top + 1, P.deep); p.set(TL + 4, top + 2, P.deep); p.set(TL + 4, top + 3, P.deep);
  p.set(TR - 3, top + 1, P.deep); p.set(TR - 4, top + 2, P.deep);
  p.hl(TL + 3, mid - 1, 40, P.deep); p.hl(TL + 3, mid - 1, 41, P.hi); p.hl(mid + 2, TR - 3, 40, P.deep);
  p.hl(TL + 1, mid, bot, P.lo); p.hl(mid + 1, TR - 1, bot, P.deep);
  if (boots) {
    for (const [x0, x1, back] of [[TL + 1, mid, false], [mid + 1, TR - 1, true]]) {
      const B = back ? { base: BOOT.lo, hi: BOOT.base, lo: BOOT.deep, deep: BOOT.deep } : BOOT;
      p.rect(x0, 44, x1, 47, B.base); p.rect(x0, 48, x1 + 1, 49, SOLE); p.set(x1 + 1, 47, B.base); p.set(x1 + 1, 46, B.lo);
      p.vl(x0, 44, 47, B.hi); p.hl(x0, x1, 44, B.hi); p.vl(x1, 45, 47, B.lo); p.hl(x0, x1 + 1, 48, back ? SOLE : SOLE_HI);
      p.set(x0 + 1, 45, B.deep); p.set(x0 + 2, 46, B.deep); p.set(x0 + 1, 47, B.deep); // laces
      p.hl(x1 - 1, x1 + 1, 47, B.lo); p.set(x1 + 1, 49, SOLE); p.set(x0, 49, SOLE);
    }
    p.rect(mid, 44, mid + 1, 49, BOOT.deep); p.set(mid + 1, 48, SOLE); p.set(mid, 48, SOLE); p.set(mid + 1, 49, SOLE); p.set(mid, 49, SOLE);
  }
}

// ---------- accessories ----------
function drawAccessory(p, acc, col, F, skin) {
  const A = tones(col), { TL, TR, mid } = F;
  switch (acc) {
    case "cap": {
      p.rect(14, 3, 27, 8, A.base); p.hl(15, 26, 2, A.base); p.hl(17, 24, 1, A.base); p.set(14, 9, A.lo); p.set(27, 9, A.deep); p.hl(13, 14, 8, A.base);
      p.hl(17, 22, 1, A.hi); p.hl(15, 19, 2, A.hi); p.vl(14, 3, 6, A.hi); p.rect(25, 2, 27, 8, A.lo); p.vl(27, 3, 8, A.deep); p.hl(17, 24, 6, A.lo); // panel seam
      p.set(21, 1, A.lo); p.vl(21, 2, 5, A.lo); // the crown's seam and button
      p.rect(22, 9, 33, 10, A.lo); p.hl(22, 32, 9, A.base); p.hl(26, 33, 9, A.lo); p.set(33, 10, A.deep); p.hl(22, 33, 11, A.deep); p.set(34, 10, A.deep); // peak, its underside
      p.hl(22, 26, 9, A.hi);
      break;
    }
    case "beanie": {
      p.rect(14, 3, 27, 10, A.base); p.hl(15, 26, 2, A.base); p.hl(16, 25, 1, A.base); p.hl(18, 23, 0, A.lo); p.set(13, 9, A.base); p.set(13, 10, A.lo);
      p.rect(14, 8, 27, 10, A.lo); p.hl(14, 27, 8, A.deep); p.hl(13, 27, 11, A.deep); for (let x = 15; x <= 26; x += 2) p.set(x, 9, A.base); for (let x = 16; x <= 26; x += 2) p.set(x, 10, A.deep); // the folded band's rib
      p.hl(16, 20, 1, A.hi); p.hl(15, 18, 2, A.hi); p.vl(14, 3, 6, A.hi); p.vl(27, 2, 7, A.deep); p.vl(26, 3, 7, A.lo); for (let x = 16; x <= 26; x += 3) p.vl(x, 3, 7, x < 20 ? A.hi : A.lo); // the knit
      break;
    }
    case "bandana": { // over the nose and mouth, knotted behind
      p.rect(14, 15, 27, 20, A.base); p.hl(15, 26, 21, A.base); p.hl(17, 24, 22, A.lo); p.hl(14, 27, 15, A.hi); p.set(27, 15, A.lo);
      p.vl(27, 16, 20, A.deep); p.vl(26, 17, 21, A.lo); p.hl(18, 23, 22, A.deep); p.vl(14, 16, 19, A.hi);
      p.hl(19, 22, 18, A.lo); p.hl(17, 24, 20, A.lo); p.set(21, 19, A.lo); // folds
      p.rect(11, 15, 13, 17, A.lo); p.rect(10, 18, 12, 20, A.lo); p.set(12, 21, A.deep); p.set(10, 21, A.deep); p.set(11, 16, A.base); // the knot's tails
      break;
    }
    case "glasses": {
      const fr = "#1d1f24", lens = "#8fb9cf", gl = "#cfe6f0";
      p.rect(15, 12, 19, 14, fr); p.rect(21, 12, 25, 14, fr); p.hl(19, 21, 12, fr); p.set(14, 12, fr); p.set(26, 12, fr); p.hl(27, 29, 11, fr); p.set(13, 11, fr);
      p.rect(16, 12, 18, 13, lens); p.rect(22, 12, 24, 13, lens); p.set(16, 12, gl); p.set(22, 12, gl); p.set(18, 13, mix(lens, fr, 0.4)); p.set(24, 13, mix(lens, fr, 0.4));
      break;
    }
    case "headband": {
      p.rect(14, 9, 27, 10, A.base); p.hl(14, 27, 9, A.hi); p.vl(27, 9, 10, A.lo); p.set(13, 9, A.base); p.set(13, 10, A.lo);
      p.rect(11, 10, 12, 11, A.lo); p.rect(9, 11, 11, 12, A.base); p.rect(8, 13, 10, 13, A.lo); p.set(8, 14, A.deep); p.set(10, 14, A.deep); p.set(7, 14, A.lo); // the tails
      break;
    }
    case "backpack": { // straps over the shoulders, the pack behind the back arm
      const K = tones("#6b4a2a");
      p.rect(TL - 7, 22, TL - 3, 37, K.base); p.rect(TL - 6, 21, TL - 3, 21, K.lo); p.vl(TL - 7, 23, 36, K.hi); p.vl(TL - 3, 22, 37, K.lo); p.hl(TL - 7, TL - 3, 37, K.deep);
      p.hl(TL - 7, TL - 3, 27, K.deep); p.rect(TL - 7, 31, TL - 3, 32, K.deep); p.set(TL - 5, 29, A.base); p.set(TL - 5, 30, A.lo); // flap, pocket, a buckle in the accent color
      p.rect(TL - 6, 28, TL - 4, 29, K.lo); p.hl(TL - 7, TL - 3, 33, K.base);
      p.rect(TL + 2, 23, TL + 3, 31, K.lo); p.rect(TR - 3, 23, TR - 2, 31, K.deep); p.set(TL + 2, 24, K.base); p.hl(TL + 2, TL + 3, 27, K.deep); p.hl(TR - 3, TR - 2, 27, K.deep);
      p.hl(TL + 2, TL + 3, 22, K.lo); p.hl(TR - 3, TR - 2, 22, K.deep);
      break;
    }
    default: break;
  }
}

// ---------- armor ----------
const ARMOR_LOOK = {
  padding: ["vest", "#8a7f6a"], tirevest: ["vest", "#2e2d2d"], sportspads: ["plate", "#b8b0a0"], scrapvest: ["plate", "#6e5a48"],
  vest: ["vest", "#4d5440"], plate: ["plate", "#3c4148"], tacvest: ["tac", "#4b5436"],
};
function drawArmor(p, key, F) {
  if (!key) return;
  const look = ARMOR_LOOK[key] || ["vest", "#5a5a52"];
  const [kind, base] = look, A = tones(base), { TL, TR, mid } = F;
  const x0 = TL + 1, x1 = TR - 1;
  // the vest's body with an arm hole each side, a collar notch
  p.rect(x0, 24, x1, 32, A.base); p.rect(x0 + 1, 23, x1 - 1, 23, A.base);
  p.rect(mid - 1, 23, mid + 2, 24, null); for (let x = mid - 1; x <= mid + 2; x++) { p.clear(x, 23); } p.clear(mid, 24); p.clear(mid + 1, 24);
  p.vl(x0, 24, 32, A.hi); p.vl(x0 + 1, 24, 31, A.hi); p.vl(x1, 24, 32, A.deep); p.vl(x1 - 1, 24, 32, A.lo); p.hl(x0 + 1, x1 - 1, 32, A.deep);
  p.set(mid - 2, 23, A.hi); p.set(mid + 3, 23, A.lo); p.set(mid - 1, 24, A.lo); p.set(mid + 2, 24, A.deep);
  if (kind === "vest") { // padding / tyre rubber / a soft vest: quilting lines, a zip
    for (let y = 26; y <= 30; y += 2) { p.hl(x0 + 2, x1 - 2, y, A.lo); p.set(x1 - 2, y, A.deep); }
    p.vl(mid + 1, 24, 31, A.deep); p.vl(mid, 25, 31, A.hi);
    if (key === "tirevest") { for (let y = 25; y <= 31; y += 3) p.hl(x0 + 2, x1 - 2, y, "#1a1a1a"); for (let x = x0 + 3; x <= x1 - 2; x += 3) p.vl(x, 25, 31, "#1a1a1a"); p.vl(mid, 25, 31, A.hi); }
  } else if (kind === "plate") { // a hard plate on the chest, two pouches at the belt
    p.rect(x0 + 2, 25, x1 - 2, 29, A.hi); p.rect(x0 + 3, 25, x1 - 3, 25, warm(A.hi, 0.15)); p.vl(x1 - 2, 25, 29, A.base); p.hl(x0 + 2, x1 - 2, 29, A.base); p.vl(x0 + 2, 25, 29, warm(A.hi, 0.15));
    p.rect(x0 + 1, 30, x0 + 4, 32, A.deep); p.rect(x1 - 4, 30, x1 - 1, 32, A.deep); p.hl(x0 + 1, x0 + 4, 30, A.lo); p.hl(x1 - 4, x1 - 1, 30, A.lo);
    if (key === "scrapvest") { p.hl(x0 + 2, x1 - 2, 27, A.base); p.set(x0 + 3, 26, METAL.base); p.set(x1 - 3, 28, METAL.base); p.set(mid, 26, METAL.lo); p.set(mid + 1, 28, METAL.base); } // bolts
    if (key === "sportspads") { p.hl(x0 + 2, x1 - 2, 27, A.lo); p.rect(x0, 23, x0 + 2, 25, A.hi); p.rect(x1 - 2, 23, x1, 25, A.lo); p.set(x0, 23, A.base); } // shoulder cups
    if (key === "plate") { p.rect(mid - 1, 26, mid + 2, 27, A.lo); p.set(mid, 26, A.base); } // the plate's velcro patch
  } else { // tac: a webbing vest with mag pouches and straps
    p.rect(x0 + 1, 28, x0 + 3, 31, A.lo); p.rect(mid - 1, 28, mid + 2, 31, A.lo); p.rect(x1 - 3, 28, x1 - 1, 31, A.lo);
    for (const x of [x0 + 1, mid - 1, x1 - 3]) { p.hl(x, x + 2, 28, A.deep); p.hl(x, x + 2, 31, A.deep); p.set(x, 29, A.base); }
    p.hl(x0 + 2, x1 - 2, 26, A.deep); p.vl(x0 + 3, 24, 27, A.deep); p.vl(x1 - 3, 24, 27, A.deep);
  }
}

// ---------- weapons ----------
// hx: the grip's left column (the hand's middle), the hand at rows 34..36 for a melee weapon: its grip crosses rows
// 33..37, the blade / shaft rises from row 32.
const SHAFT = (p, x, y0, y1, T, w = 2) => { p.rect(x, y0, x + w - 1, y1, T.base); p.vl(x, y0, y1, T.hi); if (w > 2) p.vl(x + w - 1, y0, y1, T.lo); else p.vl(x + 1, y0, y1, T.lo); };
const GRIP = (p, x, y0, y1, T) => { p.rect(x, y0, x + 1, y1, T.base); p.vl(x, y0, y1, T.hi); p.vl(x + 1, y0, y1, T.lo); for (let y = y0 + 1; y <= y1; y += 2) p.hl(x, x + 1, y, T.lo); };
const WRAP = tones("#2a2420"), LEATHER = tones("#5b3a22"), TAPE = tones("#4a4a46");

function drawMelee(p, key, hx) {
  const top = 32; // the row above the hand
  switch (key) {
    case "knife": case "huntknife": case "combatknife": {
      const blade = key === "combatknife" ? tones("#5a6066") : METAL;
      p.rect(hx, 25, hx + 1, top, blade.base); p.vl(hx, 25, top, blade.hi); p.vl(hx + 1, 26, top, blade.lo); p.set(hx, 24, BRIGHT); p.set(hx + 1, 25, blade.hi); p.set(hx, 25, BRIGHT);
      p.hl(hx - 1, hx + 2, 33, GUNMETAL.base); p.set(hx - 1, 33, GUNMETAL.hi); // guard
      GRIP(p, hx, 34, 38, key === "combatknife" ? WRAP : LEATHER); p.hl(hx, hx + 1, 39, GUNMETAL.lo);
      break;
    }
    case "machete": case "sawmachete": case "springmachete": {
      p.rect(hx, 17, hx + 3, top, METAL.base); p.rect(hx + 1, 15, hx + 3, 16, METAL.base); p.hl(hx + 2, hx + 3, 14, METAL.lo); p.set(hx + 4, 16, METAL.lo); p.vl(hx + 4, 17, 22, METAL.base); // the blade swells toward the tip
      p.vl(hx, 17, top, METAL.lo); p.vl(hx + 1, 15, top, METAL.base); p.vl(hx + 3, 16, 31, METAL.hi); p.vl(hx + 4, 17, 21, BRIGHT); p.vl(hx + 3, 22, 29, BRIGHT); p.hl(hx + 1, hx + 3, 16, METAL.hi); // the edge
      p.set(hx + 2, 29, METAL.lo); p.set(hx + 2, 25, METAL.lo); // a nick, a lanyard hole
      if (key === "sawmachete") for (let y = 18; y <= 30; y += 2) p.set(hx, y, METAL.deep);
      p.hl(hx - 1, hx + 2, 33, WRAP.deep); GRIP(p, hx, 34, 38, key === "springmachete" ? LEATHER : WRAP); p.set(hx + 1, 39, WRAP.deep); p.set(hx, 39, WRAP.lo);
      break;
    }
    case "bat": case "nailbat": case "spikedbat": {
      const B = tones("#a07a48");
      p.rect(hx, 14, hx + 2, 23, B.base); p.rect(hx, 24, hx + 1, top, B.base); p.hl(hx, hx + 2, 13, B.lo); p.set(hx + 1, 12, B.lo);
      p.vl(hx, 14, top, B.hi); p.vl(hx + 2, 14, 23, B.lo); p.set(hx + 2, 24, B.lo); p.vl(hx + 1, 25, top, B.lo); p.set(hx + 3, 16, B.lo); p.vl(hx + 3, 17, 21, B.lo);
      p.hl(hx, hx + 1, 20, B.lo); // a grain line
      p.rect(hx, 33, hx + 1, 38, TAPE.base); for (let y = 34; y <= 38; y += 2) p.hl(hx, hx + 1, y, TAPE.lo); p.hl(hx - 1, hx + 2, 39, TAPE.deep); // taped grip and knob
      if (key !== "bat") { for (const [x, y] of key === "nailbat" ? [[hx - 1, 15], [hx + 4, 17], [hx - 1, 19], [hx + 4, 21], [hx - 1, 23]] : [[hx - 1, 16], [hx + 4, 19], [hx - 1, 21]]) { p.set(x, y, METAL.base); p.set(x + (x < hx ? -1 : 1), y, BRIGHT); } }
      break;
    }
    case "crowbar": case "prybar": {
      const I = tones("#6d7378");
      SHAFT(p, hx, 17, top, I); p.hl(hx, hx + 3, 16, I.base); p.set(hx + 4, 17, I.base); p.set(hx + 3, 15, I.hi); p.set(hx + 4, 18, I.lo); p.hl(hx + 1, hx + 3, 16, I.hi);
      p.rect(hx, 33, hx + 1, 38, I.base); p.vl(hx, 33, 38, I.hi); p.hl(hx - 1, hx + 1, 39, I.lo); p.set(hx - 2, 39, I.base); p.set(hx - 2, 38, I.hi);
      break;
    }
    case "fireaxe": {
      const H = tones("#b08a5a"), R = tones("#c8362e");
      SHAFT(p, hx, 14, top, H); p.rect(hx + 2, 13, hx + 5, 20, R.base); p.rect(hx + 6, 14, hx + 6, 19, METAL.base); p.vl(hx + 7, 15, 18, BRIGHT); p.vl(hx + 2, 13, 20, R.hi); p.hl(hx + 2, hx + 5, 20, R.lo); p.hl(hx + 3, hx + 5, 13, R.lo);
      p.rect(hx - 2, 15, hx - 1, 17, R.lo); p.set(hx - 2, 15, R.base); // the pick
      p.rect(hx, 33, hx + 1, 38, H.lo); p.vl(hx, 33, 38, H.base); p.hl(hx, hx + 1, 39, H.deep);
      break;
    }
    case "sledge": {
      SHAFT(p, hx, 15, top, WOOD); p.rect(hx - 3, 11, hx + 5, 15, GUNMETAL.base); p.hl(hx - 3, hx + 5, 11, GUNMETAL.hi); p.vl(hx - 3, 11, 15, GUNMETAL.hi); p.hl(hx - 3, hx + 5, 15, GUNMETAL.deep); p.vl(hx + 5, 12, 15, GUNMETAL.deep); p.vl(hx + 4, 12, 14, GUNMETAL.lo);
      p.rect(hx, 33, hx + 1, 38, WOOD.lo); p.vl(hx, 33, 38, WOOD.base); p.hl(hx, hx + 1, 39, WOOD.deep);
      break;
    }
    case "spear": case "pipespear": {
      const T = key === "spear" ? tones("#7a5a3a") : tones("#6d7378");
      SHAFT(p, hx, 12, top, T); p.rect(hx, 8, hx + 1, 11, METAL.base); p.set(hx, 7, BRIGHT); p.set(hx, 8, BRIGHT); p.set(hx + 1, 11, METAL.lo); p.set(hx + 2, 10, METAL.lo);
      p.rect(hx, 33, hx + 1, 40, T.base); p.vl(hx, 33, 40, T.hi); p.vl(hx + 1, 33, 40, T.lo); p.hl(hx, hx + 1, 29, TAPE.base); p.hl(hx, hx + 1, 30, TAPE.lo);
      break;
    }
    case "hatchet": case "tomahawk": {
      SHAFT(p, hx, 21, top, key === "hatchet" ? WOOD : GUNMETAL); p.rect(hx + 2, 19, hx + 4, 24, METAL.base); p.vl(hx + 5, 20, 23, BRIGHT); p.vl(hx + 2, 19, 24, METAL.hi); p.hl(hx + 2, hx + 4, 24, METAL.lo);
      p.rect(hx, 33, hx + 1, 38, key === "hatchet" ? WOOD.lo : WRAP.base); p.hl(hx, hx + 1, 39, WRAP.deep);
      break;
    }
    case "baton": case "stunbaton": {
      SHAFT(p, hx, 20, top, GUNMETAL); p.hl(hx, hx + 1, 19, GUNMETAL.hi); if (key === "stunbaton") { p.hl(hx, hx + 1, 19, "#ffd23f"); p.hl(hx, hx + 1, 20, "#c9a227"); }
      p.rect(hx, 33, hx + 1, 38, WRAP.base); p.vl(hx, 33, 38, WRAP.hi); p.hl(hx - 1, hx + 2, 39, WRAP.deep);
      break;
    }
    case "katana": {
      p.rect(hx, 12, hx + 1, top, BRIGHT); p.vl(hx + 1, 13, top, METAL.base); p.set(hx + 1, 12, METAL.base); p.hl(hx, hx + 1, 11, METAL.lo); p.vl(hx, 12, top, "#f3f6f8");
      p.hl(hx - 1, hx + 2, 33, "#b89a4a"); p.set(hx - 1, 33, "#e0c070"); GRIP(p, hx, 34, 40, WRAP); for (let y = 35; y <= 40; y += 2) p.set(hx + (y % 4 === 3 ? 0 : 1), y, "#d9cfa8");
      break;
    }
    default: {
      const L = BLADE_LOOK[key];
      if (L) { // the knives and swords: 2 rows a game pixel
        const B = tones(L.blade), topY = top - 2 * L.len;
        p.rect(hx, topY, hx + 1, top, B.base); p.vl(hx, topY, top, B.hi); p.vl(hx + 1, topY + 1, top, B.lo);
        if (L.curve) { p.rect(hx + 2, topY + 2, hx + 2, topY + 6, B.base); p.set(hx + 2, topY + 2, B.hi); p.set(hx + 3, topY + 4, B.hi); }
        if (L.len >= 5) { p.set(hx, topY, "#eef2f4"); p.set(hx, topY + 1, "#eef2f4"); }
        if (L.guard) { const G = tones(L.guard); p.hl(hx - 2, hx + 3, 33, G.base); p.hl(hx - 2, hx, 33, G.hi); p.set(hx + 3, 33, G.lo); }
        GRIP(p, hx, L.guard ? 34 : 33, 33 + 2 * (L.hilt || 2), tones(L.handle));
      } else { // a club
        const B = tones("#8a6a48"); SHAFT(p, hx, 16, top, B, 3); p.rect(hx, 33, hx + 1, 38, B.lo); p.hl(hx, hx + 1, 39, B.deep);
      }
    }
  }
}

// A gun held across the body: rows 24..26 (its body), the pistol grip at hx (the right hand there), the muzzle to
// the right, at most col 42. Returns the muzzle's grid pixel.
const GUN_LOOKS = {
  pistol: "pistol", compact9: "pistol", pistol45: "pistol", pistol22: "pistol", pistol57: "pistol",
  revolver: "revolver", snub357: "revolver", snub38: "revolver", service38: "revolver", revolver44: "revolver",
  shotgun: "shotgun", semishotgun: "shotgun", dbshotgun: "shotgun", sawnoff: "shotgun",
  huntrifle: "huntrifle", bolt: "huntrifle", lever44: "huntrifle",
  ar: "ar", ar15rifle: "ar", arpistol: "ar", carbine: "ar", smg: "ar", mp5: "ar", ak: "ak", akm: "ak",
  compbow: "compbow", pulleybow: "compbow", bow: "compbow", crossbow: "crossbow", xbow: "crossbow",
};
export function drawGun(p, key, F) {
  const kind = GUN_LOOKS[key] || (/(pistol|9mm|45)/.test(key) ? "pistol" : /(revolver|snub|magnum)/.test(key) ? "revolver" : /(shot)/.test(key) ? "shotgun" : /(bow)/.test(key) ? "compbow" : "ar");
  const { TR } = F, hx = TR + 2, y = 25, mz = Math.min(42, TR + 13);
  const G = GUNMETAL, M = METAL, W = WOOD;
  if (kind === "pistol") {
    const x0 = hx - 2, x1 = hx + 6;
    p.rect(x0, y - 1, x1, y + 1, G.base); p.hl(x0 + 1, x1, y - 1, G.hi); p.hl(x0, x1, y + 1, G.lo); p.set(x1, y - 1, G.lo); for (let x = x1 - 3; x <= x1 - 1; x += 2) p.set(x, y - 1, G.lo); // slide, its serrations
    p.set(x1 + 1, y, G.deep); p.set(x1, y + 2, G.lo); p.set(x1 - 1, y + 2, G.lo); p.hl(hx + 2, hx + 3, y + 2, G.base); p.hl(hx + 2, hx + 4, y + 3, G.deep); p.set(hx + 2, y + 3, M.lo); // frame, trigger guard, trigger
    p.rect(hx - 1, y + 2, hx + 1, y + 7, G.lo); p.vl(hx - 1, y + 2, y + 7, G.base); p.hl(hx - 2, hx + 1, y + 7, G.deep); p.set(hx - 2, y + 6, G.deep); // grip
    p.set(x0, y - 2, G.lo); p.set(x1 - 1, y - 2, G.lo); // sights
    return { mx: x1 + 1, my: y };
  }
  if (kind === "revolver") {
    const S = tones("#8a9298"), x0 = hx - 2, x1 = hx + 8;
    p.rect(x0, y, x1, y + 1, S.base); p.hl(x0, x1, y, S.hi); p.hl(x0, x1, y + 1, S.lo); p.rect(hx, y - 1, hx + 3, y + 2, S.lo); p.hl(hx, hx + 3, y - 1, S.base); p.vl(hx + 1, y, y + 1, S.deep); p.vl(hx + 3, y, y + 2, S.deep); // frame, cylinder
    p.rect(hx + 4, y - 1, x1, y - 1, S.hi); p.set(x1, y - 2, S.lo); p.set(x1 + 1, y, S.deep); // barrel rib, front sight, muzzle
    p.set(hx - 3, y - 1, S.deep); p.set(hx - 3, y, S.lo); p.hl(hx + 2, hx + 4, y + 3, G.deep); p.set(hx + 2, y + 3, M.lo); // hammer, trigger guard
    p.rect(hx - 1, y + 2, hx + 1, y + 7, W.base); p.vl(hx - 1, y + 2, y + 7, W.hi); p.vl(hx + 1, y + 3, y + 7, W.lo); p.hl(hx - 2, hx + 1, y + 7, W.deep); p.set(hx - 2, y + 6, W.lo);
    return { mx: x1 + 1, my: y };
  }
  if (kind === "compbow") { // a vertical bow in the hand: a riser, two limbs, cams, a string behind
    const R = tones("#3a3d40"), L = tones("#555a60"), bx = hx + 1;
    p.vl(bx - 4, 12, 46, "#d8dde0"); p.set(bx - 4, 11, R.deep); p.set(bx - 4, 47, R.deep); // string
    for (let i = 0; i < 12; i++) { const x = bx - Math.round(((11 - i) / 11) ** 1.6 * 3); p.rect(x, 12 + i, x + 1, 12 + i, L.base); p.set(x, 12 + i, L.hi); } // upper limb curving back
    for (let i = 0; i < 12; i++) { const x = bx - Math.round(((11 - i) / 11) ** 1.6 * 3); p.rect(x, 46 - i, x + 1, 46 - i, L.base); p.set(x + 1, 46 - i, L.lo); } // lower limb
    p.rect(bx, 24, bx + 2, 34, R.base); p.vl(bx, 24, 34, R.hi); p.vl(bx + 2, 24, 34, R.deep); p.rect(bx - 1, 27, bx - 1, 31, R.lo); p.set(bx + 3, 28, R.lo); // riser, grip shelf, rest
    p.rect(bx - 5, 11, bx - 3, 13, M.base); p.rect(bx - 5, 45, bx - 3, 47, M.base); p.set(bx - 5, 11, M.hi); p.set(bx - 5, 45, M.hi); p.set(bx - 3, 13, M.deep); p.set(bx - 3, 47, M.deep); // cams
    p.set(bx + 1, 26, "#d9b23a"); p.set(bx + 1, 32, "#d9b23a"); // sight pin, stabilizer bushing
    return null;
  }
  if (kind === "crossbow") { // a horizontal stock, the prod across at the front
    const x0 = hx - 9, x1 = Math.min(mz - 2, hx + 9), S = tones("#5a4530");
    p.rect(x0, y - 1, x1, y + 1, S.base); p.hl(x0, x1, y - 1, S.hi); p.hl(x0, x1, y + 1, S.lo); p.rect(x0, y + 1, x0 + 1, y + 3, S.lo); p.hl(x0, x0 + 1, y + 3, S.deep); // stock
    p.rect(hx - 1, y + 2, hx + 1, y + 6, S.lo); p.vl(hx - 1, y + 2, y + 6, S.base); p.hl(hx - 1, hx + 1, y + 6, S.deep); p.hl(hx + 2, hx + 4, y + 3, G.deep); // grip, trigger guard
    p.hl(x0 + 3, x1 - 1, y - 2, G.base); p.hl(hx, hx + 1, y - 3, G.lo); // rail, a scope block
    p.rect(x1 - 1, y - 7, x1, y + 7, G.base); p.vl(x1 - 1, y - 7, y + 7, G.hi); p.set(x1 - 1, y - 7, M.base); p.set(x1 - 1, y + 7, M.base); p.vl(x1 - 2, y - 7, y - 5, M.base); p.vl(x1 - 2, y + 5, y + 7, M.base); // prod, its tips
    p.line(x1 - 2, y - 7, hx + 1, y - 2, "#d8dde0"); p.line(x1 - 2, y + 7, hx + 1, y + 2, "#d8dde0"); // string (cocked)
    p.set(x1 + 1, y, BRIGHT); p.set(x1 + 2, y, M.base); // the bolt's head
    return { mx: x1 + 2, my: y };
  }
  // the long guns: stock behind, receiver at the grip, fore-end and barrel forward
  const bx = hx - 11; // the butt
  const stockC = kind === "shotgun" || kind === "huntrifle" || kind === "ak" ? W : G;
  if (kind === "ar") { // a telescoping stock with a buffer tube
    p.rect(bx + 3, y - 1, hx - 3, y, G.lo); p.hl(bx + 3, hx - 3, y - 1, G.base); p.rect(bx, y - 1, bx + 2, y + 2, G.base); p.vl(bx, y - 1, y + 2, G.hi); p.hl(bx, bx + 2, y + 2, G.deep); p.rect(bx + 3, y + 1, bx + 4, y + 1, G.lo);
  } else { // a wooden stock with a comb and a cheek
    for (let i = 0; i < 9; i++) { const x = hx - 3 - i, t = i / 8; p.rect(x, y - 1 + Math.round(t), x, y + 1 + Math.round(t * 1.5), stockC.base); p.set(x, y - 1 + Math.round(t), stockC.hi); }
    p.vl(bx + 1, y, y + 3, stockC.lo); p.vl(bx, y, y + 3, stockC.deep); p.hl(bx + 2, hx - 4, y + 2, stockC.lo); p.hl(bx + 3, hx - 4, y + 3, stockC.deep);
  }
  // receiver
  p.rect(hx - 3, y - 1, hx + 4, y + 1, G.base); p.hl(hx - 3, hx + 4, y - 1, G.hi); p.hl(hx - 3, hx + 4, y + 1, G.lo); p.set(hx + 3, y, G.lo); p.set(hx + 2, y, G.deep); // the ejection port
  // grip and trigger guard (the hand goes over the grip)
  p.rect(hx - 1, y + 2, hx + 1, y + 6, G.lo); p.vl(hx - 1, y + 2, y + 6, G.base); p.hl(hx - 1, hx + 1, y + 6, G.deep); p.hl(hx + 2, hx + 4, y + 3, G.deep); p.set(hx + 2, y + 3, M.lo);
  if (kind === "ar") {
    p.rect(hx + 5, y - 1, hx + 8, y + 1, G.base); p.hl(hx + 5, hx + 8, y - 1, G.hi); p.hl(hx + 5, hx + 8, y + 1, G.deep); p.hl(hx + 5, hx + 8, y, G.lo); p.set(hx + 7, y, G.base); // handguard, its ribs
    p.hl(hx + 9, mz, y, G.base); p.hl(hx + 9, mz - 1, y - 1, G.hi); p.set(mz, y - 1, G.lo); p.set(mz, y, G.deep); // barrel
    p.vl(hx + 9, y - 3, y - 2, G.base); p.set(hx + 9, y - 3, G.hi); p.hl(hx - 1, hx + 3, y - 2, G.base); p.hl(hx, hx + 2, y - 3, G.lo); p.set(hx + 3, y - 3, G.hi); // front sight post, carry handle
    p.rect(hx + 5, y + 2, hx + 6, y + 5, G.base); p.rect(hx + 6, y + 6, hx + 7, y + 7, G.base); p.vl(hx + 5, y + 2, y + 5, G.hi); p.set(hx + 7, y + 7, G.deep); p.set(hx + 6, y + 6, G.hi); // magazine, curving forward
  } else if (kind === "ak") {
    p.rect(hx + 5, y - 1, hx + 8, y + 1, W.base); p.hl(hx + 5, hx + 8, y - 1, W.hi); p.hl(hx + 5, hx + 8, y + 1, W.lo); p.hl(hx + 9, mz, y, G.base); p.hl(hx + 9, mz - 1, y - 1, G.lo); p.set(mz, y - 1, G.hi);
    p.rect(hx + 5, y + 2, hx + 6, y + 5, G.base); p.rect(hx + 6, y + 6, hx + 7, y + 7, G.base); p.vl(hx + 5, y + 2, y + 5, G.hi); p.set(hx + 8, y + 8, G.lo);
  } else if (kind === "shotgun") {
    p.rect(hx + 5, y, hx + 8, y + 1, W.base); p.hl(hx + 5, hx + 8, y, W.hi); p.hl(hx + 5, hx + 8, y + 1, W.lo); for (let x = hx + 6; x <= hx + 8; x += 2) p.set(x, y + 1, W.deep); // the pump's ribs
    p.hl(hx + 5, mz, y - 1, G.base); p.hl(hx + 9, mz, y, G.lo); p.hl(hx + 5, mz - 1, y - 2, G.hi); p.set(mz, y - 2, BRIGHT); p.set(mz, y - 1, G.deep); // barrel over the magazine tube, the bead
    p.hl(hx - 3, hx + 4, y - 2, G.lo); p.hl(hx - 2, hx + 3, y - 2, G.base); // a flat receiver top
  } else { // the hunting rifle: a long wooden fore-end, a bolt, a scope
    p.rect(hx + 5, y, hx + 8, y + 1, W.base); p.hl(hx + 5, hx + 8, y, W.hi); p.hl(hx + 5, hx + 8, y + 1, W.lo); p.set(hx + 9, y + 1, W.lo); p.set(hx + 9, y, W.base);
    p.hl(hx + 5, mz, y - 1, G.base); p.hl(hx + 10, mz, y, G.lo); p.hl(hx + 5, mz - 1, y - 2, G.hi); p.set(mz, y - 2, G.base); p.set(mz, y - 1, G.deep); p.set(mz - 1, y - 2, BRIGHT); // barrel, front sight
    p.rect(hx - 2, y - 4, hx + 4, y - 3, G.base); p.hl(hx - 2, hx + 4, y - 4, G.hi); p.set(hx + 5, y - 4, "#7fb8e6"); p.set(hx + 5, y - 3, "#4f88b6"); p.set(hx - 3, y - 3, G.lo); p.set(hx, y - 2, G.lo); p.set(hx + 3, y - 2, G.lo); // scope and rings
    p.set(hx + 3, y + 2, M.base); p.set(hx + 4, y + 3, M.lo); // bolt handle
  }
  return { mx: mz + 1, my: y };
}

const isGunLike = (key) => !!key && (GUN_LOOKS[key] != null || /(pistol|rifle|shotgun|smg|carbine|revolver|snub|magnum|bow|\bar\b|^ar\d)/.test(key)) && !MELEE_KEYS.has(key);
const MELEE_KEYS = new Set(["knife", "huntknife", "combatknife", "machete", "sawmachete", "springmachete", "bat", "nailbat", "spikedbat", "crowbar", "prybar", "fireaxe", "sledge", "spear", "pipespear", "hatchet", "tomahawk", "baton", "stunbaton", "katana", "kukri", "pickaxe", "hammer", "etool", "golfclub", ...Object.keys(BLADE_LOOK)]);
const twoHanded = (key) => { const k = GUN_LOOKS[key] || "ar"; return k !== "pistol" && k !== "revolver" && k !== "compbow"; };

// ---------- survivors ----------
export function paintSurvivorHD(app, weaponKey = null, armorKey = null, pose = "stand") {
  const p = painter(44, 52);
  const F = frame(app.build);
  const gun = isGunLike(weaponKey) && !MELEE_KEYS.has(weaponKey);
  const sleeve = app.top;
  // behind the body: long hair's fall, the pack
  drawHair(p, app.hairStyle, app.hair, app.skin, { behind: true });
  if (app.accessory === "backpack") drawAccessory(p, "backpack", app.accent, F, app.skin);
  if (!(gun && twoHanded(weaponKey))) drawArm(p, F, -1, sleeve, app.skin, app.topStyle);
  drawLegs(p, F, app.pants);
  drawTorso(p, F, app.top, app.topStyle, app.skin);
  drawArmor(p, armorKey, F);
  if (app.accessory === "backpack") { const K = tones("#6b4a2a"); p.rect(F.TL + 2, 23, F.TL + 3, 31, K.lo); p.rect(F.TR - 3, 23, F.TR - 2, 31, K.deep); p.set(F.TL + 2, 24, K.base); } // the straps over the clothes
  let muzzle = null;
  if (gun) {
    muzzle = drawGun(p, weaponKey, F);
    drawGunArm(p, F, sleeve, app.skin, app.topStyle, F.TR + 2);
    if (twoHanded(weaponKey)) drawSupportArm(p, F, sleeve, app.skin, app.topStyle, Math.min(F.TR + 8, 39), 25);
  } else drawArm(p, F, 1, sleeve, app.skin, app.topStyle);
  drawHead(p, app.skin);
  drawFace(p, app.skin, app.hair);
  drawFacial(p, app.facial, app.hair, app.skin);
  drawHair(p, app.hairStyle, app.hair, app.skin);
  if (app.accessory !== "backpack") drawAccessory(p, app.accessory, app.accent, F, app.skin);
  if (weaponKey && !gun) drawMelee(p, weaponKey, F.TR + 2);
  p.muzzle = muzzle;
  return p;
}

// ---------- hostile humans ----------
export function paintEnemyHD(kit, factionColor, weaponKey, armorKey, seed) {
  const k = enemyLookOf(kit, seed);
  const { skin, hair } = k;
  const p = painter(44, 52);
  const F = frame("average");
  const fc = factionColor || "#a63a32", FC = tones(fc);
  const gun = isGunLike(weaponKey) && !MELEE_KEYS.has(weaponKey);
  const two = gun && twoHanded(weaponKey);
  const S = tones(skin);
  if (kit === "soldiers") {
    const olive = k.olive, O = tones(olive);
    if (!two) drawArm(p, F, -1, olive, skin, "jacket");
    drawLegs(p, F, shade(olive, -0.1));
    // knee pads and a pouch on the thigh
    p.rect(F.TL + 2, 39, F.mid - 1, 41, O.deep); p.hl(F.TL + 2, F.mid - 1, 39, O.lo); p.rect(F.mid + 2, 39, F.TR - 3, 41, O.deep);
    drawTorso(p, F, olive, "jacket", skin);
    // camo blotches
    for (const [x, y, w] of [[F.TL + 2, 26, 3], [F.TR - 5, 29, 3], [F.TL + 3, 31, 2]]) p.hl(x, x + w, y, O.deep);
    drawArmor(p, armorKey || "tacvest", F);
    if (gun) { drawGun(p, weaponKey, F); drawGunArm(p, F, olive, skin, "jacket", F.TR + 2); if (two) drawSupportArm(p, F, olive, skin, "jacket", Math.min(F.TR + 8, 39), 25); }
    else drawArm(p, F, 1, olive, skin, "jacket");
    // the armband in the group's color on the back arm (the front one when it holds a gun with both hands)
    const [ax0, ax1] = two ? F.AR : F.AL;
    p.rect(ax0, 26, ax1, 27, FC.base); p.hl(ax0, ax1, 26, FC.hi); p.set(ax1, 27, FC.deep); p.set(ax1, 26, FC.lo);
    drawHead(p, skin); drawFace(p, skin, hair); drawFacial(p, k.facial, hair, skin);
    // the helmet: a dome with a rim and a cover, the chin strap
    const H = tones(shade(olive, -0.08));
    p.rect(13, 4, 28, 9, H.base); p.hl(14, 27, 3, H.base); p.hl(16, 25, 2, H.base); p.hl(18, 23, 1, H.lo); p.rect(12, 8, 29, 10, H.lo); p.hl(12, 29, 10, H.deep); p.hl(13, 28, 11, H.deep); p.set(12, 11, H.deep); p.set(29, 11, H.deep);
    p.hl(16, 20, 2, H.hi); p.hl(14, 18, 3, H.hi); p.vl(13, 4, 7, H.hi); p.rect(26, 3, 28, 9, H.lo); p.vl(28, 4, 9, H.deep); p.hl(15, 26, 6, H.lo); p.set(21, 4, H.deep); p.set(22, 5, H.deep); // a cover's seam, a scuff
    p.vl(14, 12, 17, H.deep); p.hl(15, 17, 18, H.deep); p.set(15, 18, H.lo); // chin strap
  } else if (kit === "zealots") {
    const robe = k.robe, Rb = tones(robe);
    if (!two) drawArm(p, F, -1, robe, skin, "jacket", { cuff: false });
    // a robe to the ankles instead of trousers: pleats, a hem, the shoes under it
    p.rect(F.TL, 35, F.TR, 47, Rb.base); p.rect(F.TL - 1, 42, F.TR + 1, 47, Rb.base); p.vl(F.TL, 35, 47, Rb.hi); p.vl(F.TL - 1, 42, 47, Rb.hi); p.vl(F.TR, 35, 47, Rb.lo); p.vl(F.TR + 1, 42, 47, Rb.deep); p.vl(F.TR - 1, 36, 47, Rb.lo);
    for (const x of [F.mid - 4, F.mid + 1, F.mid + 5]) { p.vl(x, 36, 47, Rb.lo); p.vl(x + 1, 38, 47, Rb.hi); } p.vl(F.mid - 4, 44, 47, Rb.deep); p.vl(F.mid + 1, 40, 47, Rb.deep);
    p.hl(F.TL - 1, F.TR + 1, 47, Rb.deep); p.hl(F.TL, F.TR, 48, BOOT.deep); p.hl(F.TL + 1, F.TR - 1, 49, SOLE); p.hl(F.TL, F.mid - 1, 48, BOOT.base);
    drawTorso(p, F, robe, "tshirt", robe, { belt: false }); p.rect(F.mid - 2, 23, F.mid + 3, 24, Rb.lo); p.hl(F.mid - 2, F.mid + 3, 23, Rb.deep); // the collar is closed
    // the sash from the left shoulder to the right hip, the waist band
    for (let y = 23; y <= 32; y++) { const x = F.TL + 1 + Math.round((y - 23) * 1.4); p.rect(x, y, x + 2, y, FC.base); p.set(x, y, FC.hi); p.set(x + 2, y, FC.lo); }
    p.rect(F.TL, 33, F.TR, 35, FC.base); p.hl(F.TL, F.TR, 33, FC.hi); p.hl(F.TL, F.TR, 35, FC.deep); p.set(F.TR, 34, FC.deep); p.rect(F.TR - 3, 36, F.TR - 2, 40, FC.lo); p.set(F.TR - 2, 41, FC.deep); // the knot's tail
    if (gun) { drawGun(p, weaponKey, F); drawGunArm(p, F, robe, skin, "jacket", F.TR + 2); if (two) drawSupportArm(p, F, robe, skin, "jacket", Math.min(F.TR + 8, 39), 25); }
    else drawArm(p, F, 1, robe, skin, "jacket", { cuff: false });
    drawHead(p, skin, { ears: false }); drawFace(p, skin, hair); drawFacial(p, k.facial, hair, skin);
    // the hood: a cowl around the face, its peak, the face shadowed under the brim
    p.rect(11, 4, 30, 8, Rb.base); p.hl(12, 29, 3, Rb.base); p.hl(14, 27, 2, Rb.base); p.hl(17, 23, 1, Rb.lo); p.hl(18, 21, 1, Rb.base);
    p.rect(11, 9, 14, 22, Rb.base); p.rect(27, 9, 30, 22, Rb.lo); p.rect(10, 12, 10, 22, Rb.base); p.rect(31, 12, 31, 22, Rb.deep); p.vl(11, 9, 22, Rb.hi); p.set(10, 12, Rb.hi); p.vl(30, 9, 22, Rb.deep); p.vl(29, 10, 22, Rb.lo);
    p.hl(15, 26, 9, Rb.lo); p.hl(15, 26, 8, Rb.base); p.hl(16, 25, 10, S.deep); p.hl(15, 26, 9, Rb.deep); // the hood's edge over the brow, its shadow on the face
    p.hl(14, 18, 2, Rb.hi); p.hl(12, 16, 3, Rb.hi); p.vl(11, 4, 7, Rb.hi); p.rect(27, 3, 30, 8, Rb.lo); p.vl(30, 4, 8, Rb.deep);
    p.vl(14, 10, 20, Rb.deep); p.vl(27, 10, 20, Rb.deep); p.hl(11, 14, 23, Rb.deep); p.hl(27, 30, 23, Rb.deep); p.hl(12, 14, 22, Rb.lo); // the opening's inner edge, the cowl's fall onto the shoulders
    p.rect(19, 5, 22, 6, fc); p.set(19, 5, FC.hi); p.set(22, 6, FC.deep); p.vl(20, 4, 7, FC.base); p.set(20, 4, FC.hi); // the mark on the hood
  } else {
    // raiders: leather and denim, studs, a bandana / cap / headband in the group's color
    const J = tones(k.jacket);
    if (!two) drawArm(p, F, -1, k.jacket, skin, k.armStyle === "tshirt" ? "tshirt" : "jacket");
    drawHair(p, k.hairStyle, hair, skin, { behind: true });
    drawLegs(p, F, k.pants);
    p.hl(F.TL + 3, F.mid - 1, 42, tones(k.pants).deep); p.set(F.TL + 4, 43, tones(k.pants).hi); // a torn knee
    drawTorso(p, F, k.jacket, k.topStyle, skin);
    if (k.topStyle === "tank") { p.hl(F.TL + 4, F.TL + 6, 27, mix(skin, "#2a3a5a", 0.5)); p.set(F.TL + 5, 28, mix(skin, "#2a3a5a", 0.5)); } // a tattoo
    drawArmor(p, armorKey, F);
    if (gun) { drawGun(p, weaponKey, F); drawGunArm(p, F, k.jacket, skin, k.armStyle === "tshirt" ? "tshirt" : "jacket", F.TR + 2); if (two) drawSupportArm(p, F, k.jacket, skin, k.armStyle === "tshirt" ? "tshirt" : "jacket", Math.min(F.TR + 8, 39), 25); }
    else drawArm(p, F, 1, k.jacket, skin, k.armStyle === "tshirt" ? "tshirt" : "jacket");
    if (k.studs) { for (const [x, y] of [[F.TL + 2, 24], [F.TL + 4, 24], [F.TR - 3, 24], [F.TR - 5, 24], [F.TL + 3, 25]]) { p.set(x, y, "#c9c4bb"); p.set(x + 1, y, "#7d7872"); } p.rect(F.TR - 4, 29, F.TR - 2, 30, FC.lo); p.set(F.TR - 4, 29, FC.base); } // studs, a patch
    drawHead(p, skin); drawFace(p, skin, hair); drawFacial(p, k.facial, hair, skin);
    drawHair(p, k.hairStyle, hair, skin);
    drawAccessory(p, k.acc, fc, F, skin);
    if (k.acc !== "bandana") { p.rect(F.AL[0], 27, F.AL[1], 28, FC.base); p.hl(F.AL[0], F.AL[1], 27, FC.hi); p.set(F.AL[1], 28, FC.deep); } // an armband too, so the colour shows from behind
  }
  if (weaponKey && !gun) drawMelee(p, weaponKey, F.TR + 2);
  return p;
}

// The game's painter (ui/sprites.js: no pixels()) as an HD painter, blown up 2× for the comparison cells.
export function fromGame(gp, k = 2) { const q = painter(gp.w, gp.h); q.px.splice(0, q.px.length, ...gp.px); return scaled(q, k); }

// ---------- the sheet ----------
const appOf = (seed) => randomAppearance(new Rng(seed));
const WEAPON_MIX = ["machete", "pistol", "bat", "ar", "knife", "shotgun", "fireaxe", "huntrifle", "crowbar", "revolver", "sledge", "compbow", "crossbow", "nailbat", null];
const ARMOR_MIX = [null, "padding", null, "tirevest", "sportspads", null, "scrapvest", null, "vest", null, "plate", "tacvest"];
const varied = (seed) => { const app = appOf(seed); return paintSurvivorHD(app, WEAPON_MIX[seed % WEAPON_MIX.length], ARMOR_MIX[seed % ARMOR_MIX.length]); };
const base = { build: "average", skin: "#d9a37c", hairStyle: "short", hair: "#3b2a1e", facial: "none", topStyle: "tshirt", top: "#3d4a5c", pants: "#2b3442", accessory: "none", accent: "#b8322a" };

export const SHEET_TITLE = "HD people (44 × 52): survivors, raiders, soldiers, zealots";
export const SHEET_COLS = 8;
export const SHEET = [];
// row 1: eight varied survivors
for (let i = 0; i < 8; i++) { const s = 101 + i * 7; SHEET.push({ label: `survivor ${s}`, paint: () => varied(s) }); }
// row 2: the top styles, the builds
for (const [k] of LOOK_OPTIONS.topStyle.values) SHEET.push({ label: k, paint: () => paintSurvivorHD({ ...base, topStyle: k, top: k === "flannel" ? "#7a3b32" : k === "hoodie" ? "#6d6f73" : k === "jacket" ? "#5b4632" : k === "tank" ? "#c9c2b0" : "#2e5e6b" }) });
for (const b of ["slim", "average", "heavy"]) SHEET.push({ label: `${b} build`, paint: () => paintSurvivorHD({ ...base, build: b, topStyle: "jacket", top: "#33533b" }, b === "heavy" ? "sledge" : null) });
// row 3: hair styles and accessories
for (const [k] of LOOK_OPTIONS.hairStyle.values) SHEET.push({ label: `hair ${k}`, paint: () => paintSurvivorHD({ ...base, hairStyle: k, hair: k === "curly" ? "#1d1a17" : k === "long" ? "#c9a25a" : k === "mohawk" ? "#a9442a" : "#6b4526", facial: k === "buzz" ? "beard" : k === "short" ? "stubble" : k === "bald" ? "stache" : "none", skin: k === "curly" ? "#7d5233" : k === "bald" ? "#a06e46" : base.skin }) });
SHEET.push({ label: "facial beard", paint: () => paintSurvivorHD({ ...base, facial: "beard", hairStyle: "ponytail", hair: "#9a6a3a", topStyle: "flannel", top: "#33533b" }) });
for (const [k] of LOOK_OPTIONS.accessory.values.slice(1)) SHEET.push({ label: k, paint: () => paintSurvivorHD({ ...base, accessory: k, accent: k === "cap" ? "#2d5fa8" : k === "beanie" ? "#3f7a3a" : k === "bandana" ? "#b8322a" : k === "headband" ? "#d9b23a" : "#d97a2b", hairStyle: k === "beanie" || k === "cap" ? "short" : "buzz", skin: k === "bandana" ? "#5c3a24" : base.skin, hair: k === "headband" ? "#1d1a17" : base.hair, topStyle: k === "backpack" ? "jacket" : "tshirt", top: k === "backpack" ? "#5a6b3a" : "#8a6a3a" }) });
// row 4: armors
for (const k of ["padding", "tirevest", "sportspads", "scrapvest", "vest", "plate", "tacvest"]) SHEET.push({ label: `armor ${k}`, paint: () => paintSurvivorHD({ ...base, topStyle: "tshirt", top: "#6d6f73", pants: "#4f4a3a" }, k === "plate" ? "ar" : k === "vest" ? "shotgun" : k === "tacvest" ? "pistol" : null, k) });
SHEET.push({ label: "no armor", paint: () => paintSurvivorHD({ ...base, topStyle: "tshirt", top: "#6d6f73", pants: "#4f4a3a" }, null, null) });
// row 5: weapons
for (const w of ["knife", "machete", "bat", "nailbat", "crowbar", "fireaxe", "sledge", "bowie", "pistol", "revolver", "shotgun", "huntrifle", "ar", "compbow", "crossbow", "sabre"]) SHEET.push({ label: w, paint: () => paintSurvivorHD({ ...base, topStyle: w === "ar" || w === "shotgun" ? "jacket" : w === "compbow" ? "tank" : "tshirt", top: "#5a6b3a", hairStyle: "buzz" }, w, null) });
// row 6: hostiles in two group colours
for (const [fc, name] of [["#a63a32", "red"], ["#2d5fa8", "blue"]]) {
  for (let i = 0; i < 3; i++) SHEET.push({ label: `raider ${name} ${i + 1}`, paint: () => paintEnemyHD("raiders", fc, ["machete", "pistol", "nailbat"][i], i === 2 ? "tirevest" : null, 11 + i) });
  for (let i = 0; i < 3; i++) SHEET.push({ label: `soldier ${name} ${i + 1}`, paint: () => paintEnemyHD("soldiers", fc, ["ar", "shotgun", "pistol"][i], ["vest", "plate", "tacvest"][i], 21 + i) });
  for (let i = 0; i < 2; i++) SHEET.push({ label: `zealot ${name} ${i + 1}`, paint: () => paintEnemyHD("zealots", fc, ["knife", "huntrifle"][i], null, 31 + i) });
}
// comparison: the game's sprite at 2× next to the HD one
export const COMPARE_SEEDS = [3, 17, 42, 58, 77, 93];
export const comparePairs = () => COMPARE_SEEDS.flatMap((s, i) => {
  const app = appOf(s), w = ["machete", "ar", "bat", "pistol", "shotgun", "fireaxe"][i], a = [null, "padding", null, "scrapvest", "vest", null][i];
  return [
    { label: `current ${s}`, paint: () => fromGame(paintSurvivor(app, w, a)) },
    { label: `HD ${s}`, paint: () => paintSurvivorHD(app, w, a) },
  ];
});
SHEET.push(...comparePairs());
SHEET.push({ label: "current raider", paint: () => fromGame(paintEnemyHuman("raiders", "#a63a32", "machete", null, 11)) }, { label: "HD raider", paint: () => paintEnemyHD("raiders", "#a63a32", "machete", null, 11) });
SHEET.push({ label: "current soldier", paint: () => fromGame(paintEnemyHuman("soldiers", "#2d5fa8", "ar", "vest", 21)) }, { label: "HD soldier", paint: () => paintEnemyHD("soldiers", "#2d5fa8", "ar", "vest", 21) });
SHEET.push({ label: "current zealot", paint: () => fromGame(paintEnemyHuman("zealots", "#a63a32", "knife", null, 31)) }, { label: "HD zealot", paint: () => paintEnemyHD("zealots", "#a63a32", "knife", null, 31) });
