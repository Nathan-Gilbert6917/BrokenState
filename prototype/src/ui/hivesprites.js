// Pixel sprites for the hives (sim/hives.js) and their bosses, painted in code like the rest (mapsprites.js,
// sprites.js): the red skull of the ground around a hive, the Wallbreaker that walks with a horde on the map,
// a hive's build site, and the two bosses on the battle map: the Wallbreaker (a hulking brute with a slab of
// concrete for a fist, the one that smashes your defences) and the Broodmother (the bloated queen inside a hive,
// with egg sacs on her back and a crown of bone).
import { onForgetPictures } from "./pictures.js";
const UP = 4;
const OUTLINE = "#0b0c0e";
const BONE = "#d8d0bc";

function painter(w, h) {
  const px = new Array(w * h).fill(null);
  const p = {
    w, h,
    set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < w && y < h && c) px[y * w + x] = c; },
    get(x, y) { return x >= 0 && y >= 0 && x < w && y < h ? px[y * w + x] : null; },
    rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p.set(x, y, c); },
    disc(cx, cy, rx, ry, c) { for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) p.set(x, y, c); },
  };
  return p;
}
function rgb(hex) { const n = parseInt(hex.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
function shade(hex, f) { const [r, g, b] = rgb(hex); return f < 0 ? toHex(r * (1 + f), g * (1 + f), b * (1 + f)) : toHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f); }

// Upscaled canvas with a dark outline round every solid pixel (see-through pixels, 9-char colors, get none).
// makeCanvas: injectable for headless rendering (tools); defaults to a DOM canvas, or null without a document.
let makeCanvas = (w, h) => {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  return cv;
};
export const setHiveCanvasMaker = (fn) => { makeCanvas = fn; cache.clear(); };
function toCanvas(p) {
  const cv = makeCanvas(p.w * UP, p.h * UP);
  if (!cv) return null;
  const c = cv.getContext("2d");
  const solid = (x, y) => { const v = p.get(x, y); return !!v && v.length <= 7; };
  c.fillStyle = OUTLINE;
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
function cached(key, paint) {
  let cv = cache.get(key);
  if (cv === undefined) { cv = toCanvas(paint()); cache.set(key, cv); }
  return cv;
}

// ---------- map ----------
// The red skull: same shape as the danger skull (mapsprites.js paintSkull), in blood red with glowing eyes.
function paintRedSkull() {
  const p = painter(9, 9);
  const RED = "#c8261e", lit = "#ff5a4a", dark = "#6a0e0a", EYE = "#ffd166";
  p.rect(2, 1, 6, 1, RED); p.rect(1, 2, 7, 5, RED); p.rect(2, 6, 6, 7, RED);
  p.rect(2, 1, 4, 1, lit); p.set(1, 2, lit); p.set(2, 2, lit);
  p.rect(2, 3, 3, 4, OUTLINE); p.rect(5, 3, 6, 4, OUTLINE);
  p.set(3, 4, EYE); p.set(5, 4, EYE);
  p.set(4, 5, dark); p.set(3, 7, dark); p.set(5, 7, dark);
  return p;
}
export const redSkullCanvas = () => cached("redskull", paintRedSkull);

// The Wallbreaker on the map: a hulking grey brute, twice a shambler's bulk, a concrete slab bound to one fist.
function paintWallbreakerMap() {
  const p = painter(14, 17);
  const SKIN = "#8f9a86", DARK = "#5e6858", LIT = "#b2bba8", SLAB = "#9a968c", REBAR = "#7a4a30", EYE = "#e2412f";
  p.rect(4, 13, 5, 16, DARK); p.rect(8, 13, 9, 16, DARK);           // legs
  p.rect(2, 5, 11, 13, SKIN);                                        // hunched torso
  p.rect(2, 5, 11, 6, LIT); p.rect(10, 7, 11, 13, DARK);
  p.set(5, 9, "#7a1c18"); p.set(8, 11, "#7a1c18");                   // wounds
  p.rect(5, 2, 8, 5, SKIN); p.set(7, 3, EYE); p.set(8, 3, EYE);      // small head sunk between the shoulders
  p.rect(5, 2, 8, 2, DARK); p.rect(6, 5, 8, 5, "#3a1412");
  p.rect(0, 6, 1, 11, SKIN);                                         // left arm
  p.rect(12, 6, 13, 9, SKIN);                                        // right arm up, holding the slab
  p.rect(10, 0, 13, 4, SLAB); p.rect(10, 0, 13, 0, shade(SLAB, 0.3)); p.set(11, 2, REBAR); p.set(12, 1, REBAR);
  return p;
}
export const wallbreakerMapCanvas = () => cached("wb-map", paintWallbreakerMap);

// A hive's build site: the dead heaped into a low, raw mound with ribs of bone sticking up; started = it glows.
function paintSite(started) {
  const p = painter(22, 12);
  const FLESH = "#5a2a2e", RAW = "#7a3a3a", POOL = "#2a1018";
  p.disc(11, 9.5, 10.5, 2.5, POOL);
  p.disc(11, 8, 7, 3.5, FLESH);
  p.disc(11, 7, 5, 2.5, RAW);
  for (const x of [4, 8, 13, 17]) { p.rect(x, 3 + (x % 3), x, 7, BONE); p.set(x + (x < 11 ? 1 : -1), 3 + (x % 3), BONE); }
  if (started) for (const [x, y] of [[9, 7], [12, 6], [14, 8], [7, 8]]) { p.set(x, y, "#ff5a3a"); p.set(x + 1, y, "#ffb43b"); }
  return p;
}
export const siteSpriteCanvas = (started = false) => cached(`site:${+!!started}`, () => paintSite(started));

// ---------- battle (the same 22 x 26 grid as sprites.js) ----------
function paintWallbreaker() {
  const p = painter(22, 26);
  const SKIN = "#8f9a86", DARK = "#5e6858", LIT = "#b2bba8", SLAB = "#9a968c", REBAR = "#7a4a30", EYE = "#e2412f", PANTS = "#3a3a36";
  p.rect(5, 19, 8, 24, PANTS); p.rect(12, 19, 15, 24, shade(PANTS, -0.25));   // legs planted wide
  p.rect(4, 25, 8, 25, "#2a2622"); p.rect(12, 25, 16, 25, "#2a2622");
  p.rect(2, 8, 18, 19, SKIN);                                                    // massive torso
  p.rect(2, 8, 18, 9, LIT); p.rect(16, 10, 18, 19, DARK); p.rect(3, 17, 17, 19, PANTS);
  for (const [x, y] of [[6, 12], [10, 14], [13, 11], [8, 16]]) p.set(x, y, "#7a1c18");
  p.rect(7, 13, 12, 13, DARK);                                                    // ribs showing through
  p.rect(7, 3, 12, 8, SKIN); p.rect(7, 3, 12, 3, DARK);                          // head sunk low
  p.set(9, 5, EYE); p.set(11, 5, EYE); p.rect(8, 7, 11, 7, "#3a1412");
  p.rect(0, 9, 2, 17, SKIN); p.rect(0, 18, 2, 19, DARK);                         // left arm hanging, knuckles down
  p.rect(18, 7, 20, 13, SKIN);                                                    // right arm raised
  p.rect(16, 0, 21, 6, SLAB); p.rect(16, 0, 21, 0, shade(SLAB, 0.3)); p.rect(16, 6, 21, 6, shade(SLAB, -0.35));
  p.set(17, 2, REBAR); p.set(18, 3, REBAR); p.set(20, 1, REBAR); p.set(19, 4, OUTLINE);
  return p;
}
function paintBroodmother() {
  const p = painter(22, 26);
  const SKIN = "#9a7a86", DARK = "#5e3a48", LIT = "#c4a2ae", SAC = "#e8b46a", SAC_D = "#b07a3a", EYE = "#ffd166", VEIN = "#8a1c22";
  p.disc(11, 17, 9.5, 7.5, SKIN);                                                // swollen body
  p.disc(11, 18, 7, 5, LIT);
  for (const [x, y] of [[6, 16], [14, 20], [10, 22], [16, 15]]) { p.set(x, y, VEIN); p.set(x + 1, y + 1, VEIN); }
  for (const [x, y] of [[4, 10], [9, 8], [15, 9], [18, 12]]) { p.disc(x, y, 2, 2, SAC); p.set(x, y + 1, SAC_D); p.set(x - 1, y - 1, "#fff0c0"); } // egg sacs
  p.rect(8, 3, 14, 9, SKIN); p.rect(8, 3, 14, 3, DARK);                          // head
  p.set(9, 5, EYE); p.set(11, 5, EYE); p.set(13, 5, EYE);                        // three eyes
  p.rect(9, 7, 13, 8, "#3a1412"); p.set(10, 8, BONE); p.set(12, 8, BONE);
  for (const x of [8, 11, 14]) { p.rect(x, 0, x, 2, BONE); }                     // crown of bone
  p.rect(1, 14, 3, 21, DARK); p.rect(19, 14, 21, 21, DARK);                      // clawed arms
  p.set(0, 21, BONE); p.set(21, 21, BONE);
  p.rect(4, 24, 18, 25, DARK);                                                    // the base of the mound she grows from
  return p;
}
// The Hivemind (sim/hivecrawl.js): the organ at the heart of a hive, rooted in the floor of its core room. A swollen,
// folded mass of grey-pink flesh like a brain the size of a car, veined and glowing from inside, with amber pods and
// tendrils coiled at its foot.
function paintHivemind() {
  const p = painter(22, 26);
  const FLESH = "#b07a86", DARK = "#6a3a4a", LIT = "#d8a8b2", FOLD = "#8a4a5a", VEIN = "#8a1c22", GLOW = "#ffb43b", POD = "#e8b46a";
  p.disc(11, 23, 10.5, 2.6, "#2a1018");                                          // the pool of flesh it grows from
  p.disc(11, 14, 10, 9.5, FLESH);                                                // the mass
  p.disc(10, 11, 7, 6, LIT);
  for (const [x0, y0, x1] of [[3, 8, 9], [12, 6, 18], [4, 13, 10], [13, 12, 19], [6, 18, 16]]) for (let x = x0; x <= x1; x++) p.set(x, y0 + ((x * 7) % 3) - 1, FOLD); // its folds
  for (const [x, y] of [[7, 10], [14, 9], [10, 15], [16, 16], [5, 16]]) { p.set(x, y, VEIN); p.set(x + 1, y + 1, VEIN); }
  for (const [x, y] of [[9, 12], [13, 14], [8, 17]]) { p.set(x, y, GLOW); p.set(x + 1, y, "#fff0c0"); } // light from inside
  for (const [x, y] of [[2, 20], [19, 19], [4, 22], [17, 22]]) { p.disc(x, y, 1.6, 1.4, POD); p.set(x, y - 1, "#fff0c0"); } // pods at its foot
  p.rect(0, 21, 2, 21, DARK); p.rect(19, 23, 21, 23, DARK); p.set(1, 20, DARK); p.set(20, 22, DARK); // tendrils
  p.rect(6, 23, 16, 24, DARK);
  return p;
}
// Its second phase (sim/hivecrawl.js HIVEMIND.P2): swollen redder, torn open down the middle with light pouring out of
// the wound, the pods burst, the veins standing out.
function paintHivemind2() {
  const p = painter(22, 26);
  const FLESH = "#b8566a", DARK = "#5a1a2a", LIT = "#e07a8a", FOLD = "#7a2a3a", VEIN = "#ff3a2a", GLOW = "#ffd36b", CORE = "#fff4c8";
  p.disc(11, 23, 10.5, 2.6, "#3a0c14");                                          // the pool, darker with blood
  p.disc(11, 14, 10.5, 10, FLESH);                                               // swollen
  p.disc(10, 11, 7, 6, LIT);
  for (const [x0, y0, x1] of [[3, 8, 9], [12, 6, 18], [4, 13, 10], [13, 12, 19], [6, 18, 16]]) for (let x = x0; x <= x1; x++) p.set(x, y0 + ((x * 7) % 3) - 1, FOLD);
  for (const [x, y] of [[6, 9], [15, 8], [4, 15], [17, 15], [9, 19], [14, 19]]) { p.set(x, y, VEIN); p.set(x + 1, y + 1, VEIN); p.set(x + 2, y + 1, VEIN); } // veins burning
  for (let y = 5; y <= 21; y++) { const w = y < 8 || y > 18 ? 0 : y < 11 || y > 15 ? 1 : 2; for (let dx = -w; dx <= w; dx++) p.set(11 + dx + ((y * 3) % 2), y, Math.abs(dx) === w && w ? GLOW : CORE); } // the wound, pouring light
  for (const [x, y] of [[2, 20], [19, 19], [4, 22], [17, 22]]) { p.disc(x, y, 1.4, 1.1, DARK); p.set(x, y - 1, VEIN); } // the pods burst
  p.rect(0, 20, 3, 20, DARK); p.rect(18, 22, 21, 22, DARK); p.set(1, 19, DARK); p.set(20, 21, DARK); p.set(0, 18, DARK); p.set(21, 20, DARK); // tendrils thrashing
  p.rect(6, 23, 16, 24, DARK);
  return p;
}
export const bossBattleCanvas = (kind) => cached(`boss:${kind}`, () => (kind === "broodmother" ? paintBroodmother() : kind === "hivemind" ? paintHivemind() : kind === "hivemind2" ? paintHivemind2() : paintWallbreaker()));

// ---------- a hive's growths on the map (sim/hivetech.js) ----------
// Small organic structures in the hive's flesh and bone, each with one thing that tells it apart: the pit's
// bubbling pool, the brood chamber's amber egg sacs, the worm cyst's pale veined bladder, the feeding grounds' bones, the warren's holes with red eyes,
// the brute pit's grey hulk in a deep hole, the spitter sac's green bladders, the screamer spire's tower with its
// open mouth, the crawler burrow's low mound of holes and grasping hands, the den's arch of ribs over a dark cave,
// the mutation vat's glowing magenta brew. Withered (its hive destroyed): grey and black.
const FLESH = "#5a2a2e", RAW = "#7a3a3a", POOLC = "#2a1018";
function paintGrowth(kind) {
  const p = painter(16, 14);
  const base = () => { p.disc(8, 11.5, 7.5, 2.4, POOLC); };
  switch (kind) {
    case "pit": {
      base();
      p.disc(8, 10, 6, 3, FLESH); p.disc(8, 10, 4.5, 2, "#3a3a18"); p.disc(8, 10, 3.5, 1.4, "#5a5a20");
      for (const [x, y] of [[6, 10], [9, 9], [10, 11]]) p.set(x, y, "#c9c26a");
      p.set(3, 8, BONE); p.set(12, 8, BONE); p.set(13, 9, BONE);
      break;
    }
    case "brood": {
      base();
      p.disc(8, 10, 6.5, 3, FLESH);
      for (const [x, y, r] of [[5, 7, 2.6], [10, 6, 3], [8, 9, 2.4]]) { p.disc(x, y, r, r, "#e8b46a"); p.set(x - 1, y - 1, "#fff0c0"); p.set(x, y + 1, "#b07a3a"); }
      p.set(3, 10, "#8a1c22"); p.set(13, 10, "#8a1c22");
      break;
    }
    case "cyst": {
      // The worm cyst: a pale, swollen bladder veined red, worms coiled on its skin and in the pool round it.
      base();
      p.disc(8, 10, 6, 2.6, FLESH);
      p.disc(8, 7, 5, 4.5, "#c9c0a0"); p.disc(7, 6, 2.5, 2, "#e2dcc0");
      for (const [x, y] of [[5, 8], [10, 5], [11, 9]]) { p.set(x, y, "#8a1c22"); p.set(x + 1, y + 1, "#8a1c22"); }
      for (const [x, y] of [[3, 11], [6, 12], [12, 11], [9, 3]]) { p.set(x, y, "#f0e4c0"); p.set(x + 1, y, "#cdbf94"); }
      break;
    }
    case "feeding": {
      p.disc(8, 10, 7.5, 3.5, "#4a2018"); p.disc(8, 10, 6, 2.5, RAW);
      for (const [x, y] of [[2, 9], [5, 8], [9, 10], [12, 8], [7, 11], [13, 11]]) { p.set(x, y, BONE); p.set(x + 1, y, BONE); }
      p.rect(6, 6, 6, 9, BONE); p.set(5, 6, BONE); p.set(7, 6, BONE);
      p.set(11, 7, BONE); p.set(11, 6, BONE); p.set(10, 5, BONE);
      break;
    }
    case "warren": {
      base();
      p.disc(8, 8.5, 6.5, 4.5, FLESH); p.disc(8, 7, 5, 3, shade(FLESH, 0.2));
      for (const [x, y] of [[5, 8], [10, 7], [8, 10]]) { p.rect(x - 1, y, x + 1, y + 1, "#140608"); p.set(x - 1, y, "#e2412f"); p.set(x + 1, y, "#e2412f"); }
      break;
    }
    case "brutepit": {
      p.disc(8, 10, 7.5, 3.5, POOLC); p.disc(8, 10, 6, 2.6, "#140608");
      p.rect(5, 4, 11, 10, "#8f9a86"); p.rect(5, 4, 11, 5, "#b2bba8"); p.rect(10, 6, 11, 10, "#5e6858");
      p.rect(6, 2, 9, 4, "#8f9a86"); p.set(7, 3, "#e2412f"); p.set(8, 3, "#e2412f");
      p.rect(3, 5, 4, 9, "#8f9a86"); p.rect(12, 5, 13, 9, "#5e6858");
      p.set(1, 9, BONE); p.set(14, 9, BONE);
      break;
    }
    case "sac": {
      base();
      p.disc(8, 10, 6, 2.6, FLESH);
      for (const [x, y, r] of [[5, 6, 2.8], [10, 5, 3.2], [8, 8, 2.4]]) { p.disc(x, y, r, r * 1.1, "#8ab83a"); p.set(x - 1, y - 1, "#d6f08a"); p.set(x + 1, y + 1, "#4a6a18"); }
      p.set(12, 10, "#b6e04a"); p.set(12, 11, "#b6e04a"); p.set(4, 11, "#b6e04a");
      break;
    }
    case "spire": {
      base();
      p.rect(6, 3, 9, 11, FLESH); p.rect(7, 1, 8, 3, shade(FLESH, 0.2)); p.rect(6, 3, 6, 11, shade(FLESH, 0.25));
      p.rect(7, 4, 8, 6, "#140608"); p.set(7, 4, BONE); p.set(8, 6, BONE); // the mouth
      for (const [x, y] of [[4, 8], [11, 7], [5, 11], [10, 11]]) p.set(x, y, "#8a1c22");
      p.set(11, 2, "#c99ae0"); p.set(12, 1, "#c99ae0"); p.set(4, 2, "#c99ae0"); p.set(3, 1, "#c99ae0"); // the shriek
      break;
    }
    case "burrow": {
      p.disc(8, 10.5, 7.5, 3, "#3a2a1a"); p.disc(8, 10, 6, 2.2, "#5a4028");
      for (const [x, y] of [[4, 10], [8, 9], [12, 10], [6, 11], [10, 11]]) p.set(x, y, "#140608");
      p.rect(3, 7, 3, 9, "#9fb0b5"); p.set(2, 7, "#9fb0b5"); p.set(4, 7, "#9fb0b5"); // a hand reaching up
      p.rect(12, 6, 12, 9, "#9fb0b5"); p.set(11, 6, "#9fb0b5"); p.set(13, 6, "#9fb0b5");
      p.set(7, 7, "#55603f"); p.set(9, 6, "#55603f"); p.set(10, 7, "#55603f");
      break;
    }
    case "den": {
      base();
      p.disc(8, 10, 6.5, 3, FLESH);
      p.disc(8, 9, 3.5, 3, "#0a0406");
      for (let i = 0; i < 5; i++) { const x = 3 + i * 2.5; p.rect(Math.round(x), 3 + Math.abs(2 - i), Math.round(x), 10, BONE); }
      p.rect(3, 3, 13, 3, shade(BONE, -0.15));
      p.set(7, 9, "#e2412f"); p.set(9, 9, "#e2412f");
      break;
    }
    case "vat": {
      base();
      p.disc(8, 9, 6.5, 4, RAW); p.disc(8, 8, 5, 2.4, "#c43aa8"); p.disc(8, 8, 3, 1.4, "#ff7ae8");
      p.set(6, 6, "#ff7ae8"); p.set(10, 5, "#ffc0f4"); p.set(9, 6, "#ff7ae8");
      p.rect(2, 9, 2, 11, BONE); p.rect(14, 9, 14, 11, BONE);
      break;
    }
    case "fold": {
      // The Shepherd's fold: a ring of the dead standing still around a taller one with pale eyes.
      base();
      p.disc(8, 10, 6.5, 3, FLESH);
      for (const [x, y] of [[3, 9], [6, 11], [10, 11], [13, 9], [5, 7], [11, 7]]) { p.rect(x, y - 3, x, y, "#7a8a6a"); p.set(x, y - 4, "#9aa88a"); }
      p.rect(8, 2, 8, 9, "#c9c4d8"); p.rect(7, 4, 9, 7, "#8a84a0"); p.set(8, 1, "#c9c4d8");
      p.set(7, 3, "#e8e2ff"); p.set(9, 3, "#e8e2ff");
      break;
    }
    case "ossuary": {
      // The ossuary: a heap of fused bones, curved plates on top.
      base();
      p.disc(8, 10, 6.5, 3, FLESH);
      p.disc(8, 8, 5.5, 3.5, BONE); for (const y of [6, 8, 10]) p.rect(4, y, 12, y, shade(BONE, -0.3));
      p.set(3, 11, BONE); p.set(13, 11, BONE); p.set(12, 4, BONE); p.set(5, 4, BONE);
      break;
    }
    case "scaffold": {
      // The sinew scaffold: a frame of red sinew strung between bone poles, a thin figure clinging to it.
      base();
      p.rect(3, 2, 3, 11, BONE); p.rect(12, 1, 12, 11, BONE);
      for (const y of [3, 6, 9]) p.rect(4, y, 11, y, "#9a2a2a");
      p.rect(7, 4, 8, 8, "#a59a8c"); p.set(6, 4, "#a59a8c"); p.set(9, 4, "#a59a8c"); p.set(7, 3, "#e2e07a");
      break;
    }
    case "wormpit": {
      // The worm pit: a seething pool of pale worms, a long arm reaching in.
      p.disc(8, 10.5, 7.5, 3, POOLC); p.disc(8, 10, 6, 2.4, "#c4b48a");
      for (const [x, y] of [[4, 10], [6, 9], [9, 11], [11, 9], [7, 11], [12, 11]]) { p.set(x, y, "#f0e4c0"); p.set(x + 1, y, "#fff8e0"); }
      p.rect(12, 3, 12, 9, "#8f9a86"); p.rect(10, 3, 11, 3, "#8f9a86"); p.set(13, 2, "#8f9a86");
      break;
    }
    case "cistern": {
      // The egg cistern: a pool of yellow rot crowded with pale eggs.
      base();
      p.disc(8, 10, 6.5, 3, "#6a6020"); p.disc(8, 9.5, 5, 2, "#8a8030");
      for (const [x, y] of [[5, 9], [8, 8], [10, 10], [6, 11], [11, 8], [9, 11]]) { p.disc(x, y, 1, 0.9, "#e8dca0"); p.set(x, y - 1, "#fff6c8"); }
      p.set(3, 7, BONE); p.set(13, 7, BONE);
      break;
    }
    case "hollow": {
      // The dread hollow: a black pit with a ring of jaws round its lip, the scream rising out of it.
      p.disc(8, 10.5, 7.5, 3.2, POOLC); p.disc(8, 10, 6, 2.6, "#0a0406");
      for (const [x, y] of [[3, 9], [5, 8], [8, 7], [11, 8], [13, 9]]) { p.set(x, y, BONE); p.set(x, y - 1, shade(BONE, -0.2)); }
      p.set(7, 10, "#ff3a2a"); p.set(9, 10, "#ff3a2a");
      for (const [x, y] of [[4, 4], [8, 2], [12, 4], [6, 1], [10, 1]]) p.set(x, y, "#d0446a");
      break;
    }
    // The counter-dead's growths (sim/counterdead.js, sim/tunnels.js).
    case "tunnels": {
      // The tunnel mound: a heap of turned earth riddled with burrow mouths.
      p.disc(8, 10.5, 7.5, 3, "#4a3826"); p.disc(8, 8.5, 6, 4, "#7a5e3e"); p.disc(8, 7.5, 4, 2.5, "#8c7050");
      for (const [x, y] of [[5, 9], [10, 8], [8, 11], [12, 10]]) { p.rect(x - 1, y, x, y, "#140c06"); p.set(x + 1, y, "#4a3826"); }
      p.set(3, 11, BONE); p.set(13, 11, BONE);
      break;
    }
    case "meltpool": {
      // The melt pool: a steaming green pool, a wall stone half eaten in it.
      p.disc(8, 10.5, 7.5, 3, POOLC); p.disc(8, 10, 6, 2.4, "#6aa030"); p.disc(8, 10, 4, 1.6, "#c8f04a");
      p.rect(10, 6, 13, 9, "#8a8a82"); p.set(10, 6, "#6aa030"); p.set(11, 7, "#6aa030");
      for (const [x, y] of [[4, 5], [6, 3], [8, 5], [5, 1]]) p.set(x, y, "#e2f8a0"); // the steam
      break;
    }
    case "huskbed": {
      // The husk bed: dried hides stretched on bone pegs.
      base();
      p.rect(3, 6, 12, 10, "#b8a07a"); p.rect(3, 6, 12, 6, "#d8c09a"); for (const x of [5, 8, 11]) p.rect(x, 7, x, 9, "#8a7050");
      for (const [x, y] of [[2, 5], [13, 5], [2, 11], [13, 11]]) p.set(x, y, BONE);
      break;
    }
    case "blastscar": {
      // The blast scar: blackened, cratered ground, bones flung about.
      p.disc(8, 10.5, 7.5, 3, "#2a2620"); p.disc(6, 10, 2.5, 1.2, "#141210"); p.disc(11, 9.5, 2, 1, "#141210");
      for (const [x, y] of [[3, 8], [9, 7], [13, 11], [5, 12]]) { p.set(x, y, BONE); p.set(x + 1, y, shade(BONE, -0.3)); }
      p.set(7, 6, "#e2412f"); p.set(12, 7, "#e2a02f");
      break;
    }
    case "gloom": {
      // The gloom pit: a pit blacker than the night, pale hands at its lip.
      p.disc(8, 10.5, 7.5, 3.2, "#08080c"); p.disc(8, 10, 6, 2.6, "#000000");
      for (const [x, y] of [[4, 9], [12, 9], [8, 8]]) { p.set(x, y, "#d8d8e0"); p.set(x, y - 1, "#b8b8c4"); }
      break;
    }
    default: base(); p.disc(8, 9, 5, 3, FLESH);
  }
  return p;
}
function wither(p) {
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    const c = p.get(x, y);
    if (!c) continue;
    const [r, g, b] = rgb(c);
    const v = (r * 0.3 + g * 0.5 + b * 0.2) * 0.55;
    p.set(x, y, toHex(v, v * 0.97, v * 0.95));
  }
  return p;
}
export const growthCanvas = (kind, withered = false) => cached(`growth:${kind}:${+!!withered}`, () => (withered ? wither(paintGrowth(kind)) : paintGrowth(kind)));

// ---------- the special dead on the battle map (sim/zombietypes.js; runners and brutes are sprites.js variants; the Carrier and its worm swarm sim/carriers.js) ----------
function paintSpitter() {
  const p = painter(22, 26);
  const SKIN = "#8ea36b", DARK = "#5f7046", ACID = "#9ad63a", ACID_D = "#4a7a18", CLOTH = "#4a4f44";
  p.rect(7, 19, 9, 24, CLOTH); p.rect(12, 19, 14, 24, shade(CLOTH, -0.25));          // legs
  p.disc(11, 15, 6.5, 5.5, SKIN); p.rect(13, 12, 17, 19, DARK);                       // bloated body
  p.disc(14, 9, 4, 4.5, ACID); p.set(13, 7, "#e2f8a0"); p.set(15, 11, ACID_D);         // the acid sac on its back
  p.rect(5, 4, 10, 9, SKIN); p.rect(5, 4, 10, 4, DARK);                              // head thrust forward
  p.set(6, 6, "#e2e07a"); p.set(8, 6, "#e2e07a");
  p.rect(4, 8, 7, 9, "#3a1412"); p.set(3, 9, ACID); p.set(3, 10, ACID); p.set(4, 11, ACID); // dripping mouth
  p.rect(4, 12, 6, 17, SKIN); p.set(4, 18, DARK);                                     // arm
  for (const [x, y] of [[9, 15], [12, 17]]) p.set(x, y, ACID_D);
  return p;
}
function paintScreamer() {
  const p = painter(22, 26);
  const SKIN = "#a7a69b", DARK = "#6f6e66", CLOTH = "#3d3d42", RING = "#c99ae0";
  p.rect(9, 18, 10, 24, CLOTH); p.rect(12, 18, 13, 24, shade(CLOTH, -0.25));         // thin legs
  p.rect(9, 10, 13, 18, SKIN); p.rect(12, 10, 13, 18, DARK); p.rect(9, 15, 13, 17, CLOTH); // gaunt torso
  p.rect(5, 7, 8, 8, SKIN); p.rect(3, 4, 5, 7, SKIN);                                 // arms flung back
  p.rect(14, 7, 17, 8, SKIN); p.rect(17, 4, 19, 7, SKIN);
  p.rect(8, 1, 14, 9, SKIN); p.rect(8, 1, 14, 1, DARK);                               // head thrown back
  p.set(9, 3, "#e2412f"); p.set(13, 3, "#e2412f");
  p.disc(11, 6.5, 2, 2.4, "#1a0608"); p.set(11, 8, "#5c1210");                         // the open mouth
  for (const [x, y] of [[1, 1], [0, 3], [20, 1], [21, 3], [2, 11], [19, 11]]) p.set(x, y, RING); // the shriek
  return p;
}
function paintCrawler() {
  const p = painter(22, 26);
  const SKIN = "#9fb0b5", DARK = "#6a7c82", CLOTH = "#55603f";
  p.rect(6, 19, 18, 22, CLOTH); p.rect(6, 19, 18, 19, shade(CLOTH, 0.2));             // body flat to the ground
  p.rect(17, 20, 21, 21, DARK);                                                         // what is left of the legs
  p.rect(1, 17, 7, 21, SKIN); p.rect(1, 17, 7, 17, DARK);                              // head low, looking up
  p.set(2, 18, "#e2412f"); p.set(4, 18, "#e2412f"); p.rect(1, 20, 3, 20, "#3a1412");
  p.rect(0, 22, 5, 23, SKIN); p.rect(8, 22, 12, 23, SKIN);                              // arms dragging it forward
  p.set(0, 24, BONE); p.set(8, 24, BONE);
  for (const [x, y] of [[10, 20], [14, 21]]) p.set(x, y, "#8a1c18");
  p.rect(3, 24, 20, 25, "#4a6a30");                                                     // grass it hides in
  for (const x of [4, 7, 11, 15, 19]) p.set(x, 23, "#5f8a3a");
  return p;
}
// The Shepherd: tall and still, wrapped in a grey shroud, a long bone crook in one hand, pale watching eyes.
function paintShepherd() {
  const p = painter(22, 26);
  const SKIN = "#b9b4c8", DARK = "#7a748e", SHROUD = "#5d5a66", EYE = "#e8e2ff";
  p.rect(8, 19, 9, 25, SHROUD); p.rect(12, 19, 13, 25, shade(SHROUD, -0.25));          // legs under the shroud
  p.rect(7, 9, 14, 20, SHROUD); p.rect(12, 9, 14, 20, shade(SHROUD, -0.22));          // the shroud, upright
  p.rect(7, 18, 14, 18, shade(SHROUD, -0.35));
  p.rect(8, 2, 13, 9, SKIN); p.rect(8, 2, 13, 3, DARK); p.rect(7, 1, 14, 2, SHROUD);    // head, hooded
  p.set(9, 5, EYE); p.set(12, 5, EYE); p.set(9, 6, "#9a94ff"); p.set(12, 6, "#9a94ff"); // eyes that watch
  p.rect(10, 7, 11, 7, "#3a1412");
  p.rect(15, 10, 16, 13, SKIN);                                                        // arm out to the crook
  p.rect(17, 3, 17, 25, BONE); p.rect(17, 3, 19, 3, BONE); p.set(19, 4, BONE); p.set(19, 5, shade(BONE, -0.2)); // the crook
  p.rect(5, 11, 6, 16, SKIN); p.set(5, 17, DARK);                                       // other arm, raised a little
  for (const [x, y] of [[1, 2], [0, 8], [21, 9], [2, 14]]) p.set(x, y, EYE);           // its pull on the pack
  return p;
}
// The Carrier (sim/carriers.js): bloated and pale, the belly split where the worms push out, the head small and
// sunk on the swollen body, worms trailing from the splits and the mouth.
function paintCarrier() {
  const p = painter(22, 26);
  const SKIN = "#c9c0a0", DARK = "#9a8e6c", LIT = "#e2dcc0", SPLIT = "#5c1e1a", WORM = "#f0e4c0", WORM_D = "#cdbf94", CLOTH = "#5a5648";
  p.rect(7, 20, 9, 24, CLOTH); p.rect(12, 20, 14, 24, shade(CLOTH, -0.25));          // short legs under the weight
  p.rect(6, 25, 9, 25, "#2a2622"); p.rect(12, 25, 15, 25, "#2a2622");
  p.disc(11, 14, 8, 7.5, SKIN); p.disc(9, 12, 4.5, 4, LIT); p.rect(16, 11, 18, 19, DARK); // the swollen body
  for (const [x, y] of [[6, 16], [12, 17], [15, 12]]) { p.rect(x, y, x + 2, y, SPLIT); p.set(x + 1, y - 1, SPLIT); } // splits in the skin
  for (const [x, y] of [[7, 17], [13, 18], [16, 13], [5, 15]]) { p.set(x, y, WORM); p.set(x - 1, y + 1, WORM_D); } // worms pushing out
  p.rect(8, 2, 13, 7, SKIN); p.rect(8, 2, 13, 2, DARK);                                // a small head sunk on it
  p.set(9, 4, "#e8e07a"); p.set(12, 4, "#e8e07a");
  p.rect(9, 6, 12, 6, SPLIT); p.set(10, 7, WORM); p.set(10, 8, WORM_D); p.set(12, 7, WORM); // worms from the mouth
  p.rect(2, 11, 4, 17, SKIN); p.set(2, 18, DARK); p.rect(18, 12, 20, 16, DARK);      // stubby arms
  return p;
}
// A worm swarm: a low, writhing mass of pale worms with a few raised heads.
function paintSwarm() {
  const p = painter(22, 26);
  const WORM = "#f0e4c0", WORM_D = "#c4b48a", WORM_L = "#fff8e0", SLIME = "#7a6a48";
  p.disc(11, 22, 9.5, 3, SLIME);
  p.disc(11, 21, 8, 2.6, WORM_D);
  for (let i = 0; i < 14; i++) { const x = 3 + ((i * 7) % 17), y = 19 + ((i * 3) % 5); p.set(x, y, WORM); p.set(x + 1, y, i % 2 ? WORM_L : WORM); }
  for (const [x, h] of [[5, 4], [9, 6], [13, 5], [17, 3], [11, 3]]) { p.rect(x, 21 - h, x, 20, WORM); p.set(x + 1, 21 - h, WORM); p.set(x + 1, 20 - h, "#5c1e1a"); } // raised heads
  return p;
}
// ---------- the mid game's special dead (sim/middead.js) ----------
// The Boneback: hunched and heavy, a shield of fused bone plates over its chest and face, the eyes peering out
// between them; its back bare and grey.
function paintBoneback() {
  const p = painter(22, 26);
  const SKIN = "#9a9483", DARK = "#6f6a5c", CLOTH = "#3e3d36", PLATE = BONE, PLATE_D = shade(BONE, -0.3);
  p.rect(6, 19, 9, 25, CLOTH); p.rect(12, 19, 15, 25, shade(CLOTH, -0.25));          // thick legs
  p.rect(5, 9, 16, 20, SKIN); p.rect(14, 9, 16, 20, DARK);                            // the body
  p.rect(3, 9, 12, 20, PLATE); for (const y of [11, 14, 17]) p.rect(3, y, 12, y, PLATE_D); // plates over the chest
  p.rect(5, 2, 12, 9, SKIN); p.rect(4, 2, 10, 8, PLATE); p.rect(4, 5, 10, 5, PLATE_D);  // head behind its mask
  p.set(6, 4, "#e2412f"); p.set(9, 4, "#e2412f");
  p.rect(1, 11, 3, 19, SKIN); p.rect(1, 12, 3, 13, PLATE); p.set(1, 20, DARK);        // arms, the forearms plated
  p.rect(17, 11, 19, 18, DARK);
  return p;
}
// The Climber: thin and stretched, long arms raised with hooked bone fingers, crouched to spring.
function paintClimber() {
  const p = painter(22, 26);
  const SKIN = "#a59a8c", DARK = "#7a7062", CLOTH = "#4d4438";
  p.rect(7, 19, 8, 24, CLOTH); p.rect(13, 19, 14, 24, shade(CLOTH, -0.25)); p.rect(6, 24, 8, 25, SKIN); p.rect(13, 24, 15, 25, SKIN); // bent legs, bare feet
  p.rect(8, 10, 13, 19, CLOTH); p.rect(11, 10, 13, 19, shade(CLOTH, -0.2));          // a thin torso
  p.rect(8, 3, 13, 9, SKIN); p.rect(8, 3, 13, 3, DARK); p.set(9, 5, "#e2e07a"); p.set(12, 5, "#e2e07a"); p.rect(10, 7, 11, 7, "#3a1412");
  p.rect(5, 2, 6, 11, SKIN); p.rect(15, 2, 16, 11, DARK);                              // long arms up
  for (const [x, y] of [[4, 0], [5, 0], [7, 0], [14, 0], [16, 0], [17, 0]]) p.set(x, y, BONE); // hooked fingers
  p.set(4, 1, BONE); p.set(17, 1, BONE);
  return p;
}
// The Flinger: long-armed, one arm cocked back over its head holding a dripping mass of pale worms.
function paintFlinger() {
  const p = painter(22, 26);
  const SKIN = "#8f9a86", DARK = "#5f6a58", CLOTH = "#3f4a3a", WORM = "#f0e4c0", WORM_D = "#c4b48a";
  p.rect(7, 19, 9, 25, CLOTH); p.rect(12, 19, 14, 25, shade(CLOTH, -0.25));
  p.rect(7, 10, 14, 19, CLOTH); p.rect(12, 10, 14, 19, shade(CLOTH, -0.2));
  p.rect(7, 3, 12, 9, SKIN); p.rect(7, 3, 12, 3, DARK); p.set(8, 5, "#e2e07a"); p.set(11, 5, "#e2e07a"); p.rect(9, 7, 10, 7, "#3a1412");
  p.rect(15, 4, 16, 12, SKIN); p.rect(16, 1, 18, 4, SKIN);                             // the throwing arm, cocked back
  p.disc(18, 2.5, 3, 2.5, WORM_D); for (const [x, y] of [[17, 1], [19, 2], [20, 4], [18, 4], [21, 2]]) p.set(x, y, WORM); // the mass of worms
  p.set(19, 6, WORM); p.set(20, 8, WORM_D);                                               // dripping
  p.rect(3, 10, 6, 11, SKIN); p.rect(2, 11, 3, 18, SKIN); p.set(2, 19, DARK);           // the other arm, long, hanging
  return p;
}
// The Sower: swollen and slow, its back and sides hung with pale egg sacs, eggs dribbling to the ground.
function paintSower() {
  const p = painter(22, 26);
  const SKIN = "#a8a07a", DARK = "#7a7454", CLOTH = "#5a5440", EGG = "#e8dca0", EGG_D = "#b4a860";
  p.rect(7, 20, 9, 25, CLOTH); p.rect(12, 20, 14, 25, shade(CLOTH, -0.25));
  p.disc(11, 14, 7.5, 7, SKIN); p.rect(15, 9, 17, 19, DARK);
  for (const [x, y, r] of [[15, 8, 2.6], [18, 12, 2.2], [16, 16, 2.4], [5, 15, 2]]) { p.disc(x, y, r, r, EGG); p.set(x, y, EGG_D); p.set(x - 1, y - 1, "#fff6c8"); }
  p.rect(7, 2, 12, 7, SKIN); p.rect(7, 2, 12, 2, DARK); p.set(8, 4, "#e8e07a"); p.set(11, 4, "#e8e07a"); p.rect(9, 6, 10, 6, "#3a1412");
  p.rect(3, 10, 4, 17, SKIN);
  for (const [x, y] of [[13, 23], [16, 25], [5, 24]]) p.set(x, y, EGG);                  // eggs on the ground
  return p;
}
// The Nightmare: tall, dark and gaunt, the jaw hanging open far wider than a jaw should, red eyes, the scream.
function paintNightmare() {
  const p = painter(22, 26);
  const SKIN = "#6e6a78", DARK = "#4a4654", CLOTH = "#1e1c24", RING = "#d0446a";
  p.rect(8, 18, 9, 25, CLOTH); p.rect(12, 18, 13, 25, shade(CLOTH, 0.15));
  p.rect(7, 9, 14, 18, CLOTH); p.rect(12, 9, 14, 18, shade(CLOTH, 0.12));
  p.rect(8, 1, 13, 10, SKIN); p.rect(8, 1, 13, 1, DARK);
  p.set(9, 3, "#ff3a2a"); p.set(12, 3, "#ff3a2a");
  p.rect(9, 5, 12, 10, "#14060a"); p.set(10, 10, "#5c1210"); p.set(11, 9, BONE); p.set(9, 5, BONE); // the jaw, unhinged
  p.rect(4, 9, 6, 10, SKIN); p.rect(3, 10, 4, 18, SKIN); p.rect(15, 9, 17, 10, DARK); p.rect(17, 10, 18, 18, DARK); // long arms
  for (const [x, y] of [[1, 2], [0, 5], [20, 2], [21, 5], [1, 12], [20, 12]]) p.set(x, y, RING); // the scream
  return p;
}
// ---------- the dead beasts (sim/deadbeasts.js) ----------
// The worm's dead animals that walk: thin, the hide split and pale worms in the splits, the eyes gone amber.
const WORMY = (p, spots, WORM, WORM_D, SPLIT) => { for (const [x, y] of spots) { p.rect(x, y, x + 1, y, SPLIT); p.set(x, y + 1, WORM); p.set(x + 1, y + 1, WORM_D); } };
// A dead stag: a tall tan body on long legs, the neck up to a narrow head with antlers of bone, ribs showing.
function paintDeadStag() {
  const p = painter(22, 26);
  const HIDE = "#b08a5c", DARK = "#7c5c3a", LIT = "#cfae80", WORM = "#f0e4c0", WORM_D = "#cdbf94", SPLIT = "#5c1e1a", EYE = "#e8e07a";
  p.rect(6, 11, 18, 16, HIDE); p.rect(6, 11, 18, 11, LIT); p.rect(17, 12, 18, 16, DARK);       // the body
  for (const x of [9, 12, 15]) p.rect(x, 13, x, 15, DARK);                                       // ribs under the hide
  for (const [x0, x1] of [[7, 8], [10, 11], [14, 15], [17, 18]]) { p.rect(x0, 17, x1, 24, DARK); p.rect(x0, 25, x1, 25, "#2a2622"); } // legs and hooves
  p.rect(5, 6, 7, 11, HIDE); p.rect(4, 7, 6, 10, HIDE);                                          // the neck up and forward
  p.rect(1, 4, 6, 7, HIDE); p.rect(1, 4, 6, 4, LIT); p.rect(0, 5, 1, 6, DARK);                   // the head, the muzzle forward
  p.set(3, 5, EYE);
  p.rect(2, 7, 4, 7, SPLIT); p.set(2, 8, WORM);                                                  // the jaw hangs, worms from it
  for (const [x, y] of [[5, 3], [6, 2], [7, 1], [5, 1]]) p.set(x, y, BONE);                      // the antlers
  for (const [x, y] of [[3, 3], [2, 2], [4, 2], [1, 1]]) p.set(x, y, BONE);
  WORMY(p, [[8, 12], [13, 14], [16, 13]], WORM, WORM_D, SPLIT);
  return p;
}
// A dead hog: low and heavy, a dark bristled body on short legs, the snout down, the hide split along the back.
function paintDeadHog() {
  const p = painter(22, 26);
  const HIDE = "#6e5a48", DARK = "#4a3a2c", LIT = "#8e7860", WORM = "#f0e4c0", WORM_D = "#cdbf94", SPLIT = "#5c1e1a", EYE = "#e8e07a";
  p.disc(12, 17, 8, 4.5, HIDE); p.rect(5, 13, 18, 13, LIT); p.rect(17, 15, 20, 19, DARK);         // the body, the rump
  for (const x of [6, 8, 10, 12, 14, 16]) p.set(x, 12, DARK);                                      // bristles along the back
  for (const [x0, x1] of [[6, 7], [9, 10], [14, 15], [17, 18]]) { p.rect(x0, 21, x1, 24, DARK); p.rect(x0, 25, x1, 25, "#2a2622"); } // short legs
  p.rect(1, 15, 6, 20, HIDE); p.rect(1, 15, 6, 15, LIT); p.rect(0, 18, 2, 20, DARK);              // the head low, the snout
  p.set(3, 16, EYE); p.set(1, 21, BONE); p.set(5, 21, BONE);                                       // an eye, the tusks
  p.rect(2, 20, 4, 20, SPLIT); p.set(3, 21, WORM);
  WORMY(p, [[8, 14], [12, 15], [15, 17], [10, 18]], WORM, WORM_D, SPLIT);
  return p;
}
// A dead dog: small and quick, grey and thin, the ribs showing, ears back, the tail down; worms at the jaw.
function paintDeadHound() {
  const p = painter(22, 26);
  const HIDE = "#8a8278", DARK = "#5a544c", LIT = "#aaa296", WORM = "#f0e4c0", WORM_D = "#cdbf94", SPLIT = "#5c1e1a", EYE = "#e8e07a";
  p.rect(6, 16, 17, 20, HIDE); p.rect(6, 16, 17, 16, LIT);                                        // the body
  for (const x of [9, 11, 13]) p.rect(x, 18, x, 19, DARK);                                         // ribs
  p.rect(17, 17, 20, 18, DARK); p.set(20, 19, DARK);                                               // the tail down
  for (const [x0, x1] of [[7, 8], [10, 11], [14, 15], [16, 17]]) { p.rect(x0, 21, x1, 24, DARK); p.rect(x0, 25, x1, 25, "#2a2622"); } // legs
  p.rect(2, 13, 7, 17, HIDE); p.rect(2, 13, 7, 13, LIT); p.rect(0, 15, 2, 17, DARK);               // the head, the muzzle
  p.set(4, 14, EYE); p.set(6, 12, DARK); p.set(5, 11, DARK);                                       // an eye, an ear back
  p.rect(1, 18, 3, 18, SPLIT); p.set(1, 19, WORM); p.set(2, 19, WORM_D);                           // the jaw, worms
  WORMY(p, [[9, 17], [15, 19]], WORM, WORM_D, SPLIT);
  return p;
}
// A dead cow: huge and pale, the belly swollen with the worm and split, the head low with short horns.
function paintDeadCow() {
  const p = painter(22, 26);
  const HIDE = "#d8ccb4", DARK = "#9a8e78", LIT = "#eee6d2", WORM = "#f0e4c0", WORM_D = "#cdbf94", SPLIT = "#5c1e1a", EYE = "#e8e07a";
  p.rect(5, 8, 20, 12, HIDE); p.rect(5, 8, 20, 8, LIT);                                           // the back
  p.disc(13, 15, 8, 5, HIDE); p.rect(19, 10, 21, 16, DARK);                                        // the belly, swollen; the rump
  for (const [x, y] of [[8, 10], [14, 9], [17, 12], [10, 15]]) p.rect(x, y, x + 1, y + 1, DARK);   // patches
  for (const [x0, x1] of [[6, 7], [9, 10], [15, 16], [18, 19]]) { p.rect(x0, 19, x1, 24, DARK); p.rect(x0, 25, x1, 25, "#2a2622"); } // legs
  p.rect(2, 11, 6, 17, HIDE); p.rect(2, 11, 6, 11, LIT); p.rect(0, 14, 2, 17, DARK);               // the head low, the muzzle
  p.set(4, 12, EYE); p.set(3, 9, BONE); p.set(2, 10, BONE); p.set(6, 9, BONE); p.set(7, 10, BONE);  // an eye, short horns
  p.rect(1, 17, 3, 17, SPLIT); p.set(2, 18, WORM);
  for (const [x, y] of [[9, 16], [12, 18], [15, 17]]) { p.rect(x, y, x + 2, y, SPLIT); p.set(x + 1, y - 1, SPLIT); } // the belly split
  for (const [x, y] of [[10, 17], [13, 19], [16, 18], [8, 14]]) { p.set(x, y, WORM); p.set(x - 1, y + 1, WORM_D); } // worms pushing out
  return p;
}
// A dead cat: small and low, grey, the back arched, ears flat, the tail up, worms at the mouth.
function paintDeadCat() {
  const p = painter(22, 26);
  const HIDE = "#9890a0", DARK = "#5e5868", LIT = "#b8b0c0", WORM = "#f0e4c0", WORM_D = "#cdbf94", SPLIT = "#5c1e1a", EYE = "#e8e07a";
  p.disc(12, 20, 5.5, 2.6, HIDE); p.rect(8, 17, 15, 17, LIT);                                     // the body, the back arched
  p.rect(16, 13, 17, 18, DARK); p.set(16, 12, DARK);                                               // the tail up
  for (const [x0, x1] of [[8, 8], [11, 11], [14, 14], [16, 16]]) p.rect(x0, 22, x1, 24, DARK);     // thin legs
  p.rect(4, 16, 8, 20, HIDE); p.rect(4, 16, 8, 16, LIT); p.set(4, 15, DARK); p.set(8, 15, DARK);    // the head, ears flat
  p.set(5, 17, EYE); p.set(7, 17, EYE);
  p.rect(4, 20, 6, 20, SPLIT); p.set(5, 21, WORM); p.set(4, 21, WORM_D);                           // the mouth open, worms
  p.rect(10, 19, 11, 19, SPLIT); p.set(11, 20, WORM);
  p.rect(2, 24, 20, 25, "#4a6a30"); for (const x of [3, 7, 13, 19]) p.set(x, 23, "#5f8a3a");       // the grass (or the rug) it hides in
  return p;
}
// The counter-dead (sim/counterdead.js, sim/tunnels.js): the flat painters, the figures' fallback (ui/figures.js).
// The Digger: hunched and broad, clay to the elbows, great spade hands.
function paintDigger() {
  const p = painter(22, 26);
  const SKIN = "#8c7656", DARK = "#5a4632", CLAY = "#6a4e30";
  p.rect(7, 20, 9, 25, DARK); p.rect(12, 20, 14, 25, shade(DARK, -0.2));
  p.disc(11, 15, 6.5, 5.5, SKIN); p.rect(14, 11, 16, 19, DARK);
  p.rect(5, 7, 10, 12, SKIN); p.rect(5, 7, 10, 7, DARK); p.set(6, 9, "#e2e07a"); p.set(9, 9, "#e2e07a"); // the head low
  p.rect(2, 13, 5, 20, CLAY); p.rect(1, 20, 6, 22, CLAY); p.rect(16, 14, 19, 21, CLAY); p.rect(15, 21, 20, 23, CLAY); // spade hands
  p.rect(2, 24, 20, 25, "#4a3826"); for (const x of [4, 9, 15]) p.set(x, 23, "#7a5e3e"); // the turned earth
  return p;
}
// The Melter: weeping green acid, the skin split and steaming.
function paintMelter() {
  const p = painter(22, 26);
  const SKIN = "#9fbf5a", DARK = "#6a8a38", ACID = "#c8f04a", CLOTH = "#3a4a2a";
  p.rect(7, 19, 9, 25, CLOTH); p.rect(12, 19, 14, 25, shade(CLOTH, -0.25));
  p.rect(7, 10, 14, 19, SKIN); p.rect(12, 10, 14, 19, DARK); p.rect(9, 13, 10, 16, "#3a1412");
  p.rect(7, 3, 12, 9, SKIN); p.set(8, 5, "#d8ff6a"); p.set(11, 5, "#d8ff6a"); p.rect(9, 7, 10, 8, "#3a1412");
  p.rect(4, 10, 6, 17, SKIN); p.rect(15, 10, 17, 17, DARK);
  for (const [x, y] of [[5, 18], [5, 20], [16, 18], [10, 17], [11, 20], [9, 22]]) p.set(x, y, ACID); // dripping
  for (const [x, y] of [[8, 1], [11, 0], [13, 2]]) p.set(x, y, "#e2f8a0"); // steam
  return p;
}
// The Husk: wrapped in a dry hide, stiff and broad.
function paintHusk() {
  const p = painter(22, 26);
  const HIDE = "#b8a07a", DARK = "#8a7050", SKIN = "#a89880";
  p.rect(7, 19, 9, 25, DARK); p.rect(12, 19, 14, 25, shade(DARK, -0.2));
  p.rect(5, 9, 16, 19, HIDE); p.rect(5, 9, 16, 9, "#d8c09a"); for (const y of [12, 15, 18]) p.rect(5, y, 16, y, DARK); // the hide
  p.rect(8, 3, 13, 8, SKIN); p.set(9, 5, "#e2412f"); p.set(12, 5, "#e2412f"); p.rect(10, 7, 11, 7, "#3a1412");
  p.rect(3, 10, 4, 17, HIDE); p.rect(17, 10, 18, 17, DARK);
  return p;
}
// The Tripper: nose to the ground, sniffing, ahead of the rest.
function paintTripper() {
  const p = painter(22, 26);
  const SKIN = "#a89880", DARK = "#78685a", CLOTH = "#4a4440";
  p.rect(14, 18, 16, 25, CLOTH); p.rect(17, 18, 19, 25, shade(CLOTH, -0.25));
  p.rect(9, 13, 18, 18, CLOTH); p.rect(9, 13, 18, 13, shade(CLOTH, 0.15)); // bent double
  p.rect(3, 15, 8, 20, SKIN); p.rect(3, 15, 8, 15, DARK); p.set(4, 17, "#e2e07a"); p.set(6, 17, "#e2e07a"); // the head down by the ground
  p.rect(2, 19, 3, 21, "#3a1412");
  p.rect(9, 18, 10, 24, SKIN); p.rect(12, 18, 13, 24, DARK);
  p.disc(4, 24, 2, 1, "#2a2620"); p.set(4, 23, "#e2412f"); // a mine's pin it has found
  return p;
}
// The Dark-walker: pale and gaunt, black eyes, in dark rags.
function paintDarkwalker() {
  const p = painter(22, 26);
  const SKIN = "#d8d8e0", DARK = "#a8a8b4", CLOTH = "#141418";
  p.rect(8, 19, 9, 25, CLOTH); p.rect(12, 19, 13, 25, CLOTH);
  p.rect(8, 10, 13, 19, CLOTH); p.rect(11, 10, 13, 19, "#202028");
  p.rect(8, 3, 13, 9, SKIN); p.rect(8, 3, 13, 3, DARK); p.rect(9, 5, 9, 6, "#000000"); p.rect(12, 5, 12, 6, "#000000"); p.rect(10, 8, 11, 8, "#3a1412");
  p.rect(5, 10, 6, 21, SKIN); p.rect(15, 10, 16, 21, DARK); p.set(5, 22, BONE); p.set(16, 22, BONE); // long arms, clawed
  return p;
}
const ZPAINT = { digger: paintDigger, melter: paintMelter, husk: paintHusk, tripper: paintTripper, darkwalker: paintDarkwalker, spitter: paintSpitter, screamer: paintScreamer, shepherd: paintShepherd, carrier: paintCarrier, swarm: paintSwarm, boneback: paintBoneback, climber: paintClimber, flinger: paintFlinger, sower: paintSower, nightmare: paintNightmare, deadstag: paintDeadStag, deadhog: paintDeadHog, deadhound: paintDeadHound, deadcow: paintDeadCow, deadcat: paintDeadCat };
export const ztypeBattleCanvas = (kind) => cached(`ztype:${kind}`, () => (ZPAINT[kind] || paintCrawler)());
onForgetPictures(() => cache.clear()); // ui/pictures.js: drawn again after a lost GPU context
