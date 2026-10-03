// Pixel sprites for the hives (sim/hives.js) and their bosses, painted in code like the rest (mapsprites.js,
// sprites.js): the red skull of the ground around a hive, the Wallbreaker that walks with a horde on the map,
// a hive's build site, and the two bosses on the battle map: the Wallbreaker (a hulking brute with a slab of
// concrete for a fist, the one that smashes your defences) and the Broodmother (the bloated queen inside a hive,
// with egg sacs on her back and a crown of bone).
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
export const bossBattleCanvas = (kind) => cached(`boss:${kind}`, () => (kind === "broodmother" ? paintBroodmother() : paintWallbreaker()));
