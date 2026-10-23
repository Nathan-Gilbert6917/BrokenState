// Terrain detail for the State Map (render.js): small pixel decals scattered over today's flat terrain colors
// (trees, crop rows, fences, hay, rocks, peaks, houses, ruins, wrecks, reeds) and a rippled water texture for
// rivers and lakes. Design: docs/tile-designs (style B with style A's water).
//
// - Placement comes from a stable per-tile seed (the tile's id and the world's seed), never from state.rng: drawing
//   the map never changes the simulation, and the same world always looks the same. A tile's decals are placed the
//   first time it is drawn (zoomed out nothing is placed).
// - What goes where depends on the terrain and what is around it: farmland near a farm gets crop rows, hay and
//   fences, open farmland grass tufts, bushes and the odd tree; forests dense trees (broadleaf ones turn in autumn
//   and stand bare in winter); hills mounds and rocks; mountains peaks; suburbs houses (some burnt), yards and cars;
//   the city blocks, ruins and rubble; wrecked cars along roads; reeds on the banks; a pond on a pond tile (the user's
//   words 2026-10-23: "add pond decor to the world map when a tile has a pond in the world map generate a pond in the
//   battle map"; sim/mapgen.js tile.pond): a small body of the rivers' and lakes' water with a muddy bank and reeds,
//   placed first to one side and kept clear of the tile's other decals, drawn under them (and under a site's sprite,
//   never hidden by its clear zone); frozen (ICE_LOOK: pale ice, cracks) while
//   the ponds are ice (sim/ponds.js pondIce, render.js). Decals keep off the roads, off
//   the map's edge, and (when a tile shows a site, a base or a hive) out of the clear zone around its icon and name:
//   each decal is marked with the clear zones it touches and render.js skips it while that zone is in use.
// - Every decal sprite, in three shades (live, reported, unknown) and with a snow-capped twin, is drawn once into a
//   small atlas (1 or 2 device px per sprite px), and the water texture once per shade, as ImageBitmaps; render.js
//   draws them into its cached map chunks, so a frame costs nothing extra. Zoomed out the map keeps its flat
//   colors: the detail fades in between the zooms in DECO_FADE.
import { onForgetPictures } from "./pictures.js";
import { FALL } from "./seasontrees.js"; // autumn's leaf colours, as on the battle maps (seasonSprites)

// Options (ui/settings.js "Map detail"): detail false draws the flat map at every zoom.
export const deco = { detail: true };
export const setMapDetail = (on) => { deco.detail = !!on; };

// Zoom where decals and the water texture start to show, and where they are fully in.
export const DECO_FADE = [0.6, 0.75];
export const decoAlpha = (zoom) => (!deco.detail || zoom <= DECO_FADE[0] ? 0 : zoom >= DECO_FADE[1] ? 1 : (zoom - DECO_FADE[0]) / (DECO_FADE[1] - DECO_FADE[0]));

// ---------- small helpers ----------
const SQ3 = Math.sqrt(3);
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash(a, b = 0) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x632be5ab) | 0, 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return h >>> 0;
}
const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Canvases: the page's, or OffscreenCanvas, or one handed in by a headless tool (null: no detail is drawn).
let canvasMaker = null;
export function setDecoCanvas(fn) { canvasMaker = fn; atlases.clear(); waters.clear(); }
function makeCanvas(w, h) {
  if (canvasMaker) return canvasMaker(w, h);
  if (typeof document !== "undefined" && document && typeof document.createElement === "function") {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  return null;
}
// Writes an RGBA buffer into a new canvas (a stub context without image data just gets nothing).
// In a browser it becomes an ImageBitmap: drawing sub-images of a bitmap is many times cheaper per call than of a canvas
// (Chrome takes a snapshot of a canvas source on every drawImage).
function canvasFrom(data, w, h) {
  if (!canvasMaker && typeof OffscreenCanvas !== "undefined" && typeof ImageData !== "undefined") {
    try {
      const oc = new OffscreenCanvas(w, h), c = oc.getContext("2d");
      c.putImageData(new ImageData(data, w, h), 0, 0);
      if (typeof oc.transferToImageBitmap === "function") return oc.transferToImageBitmap();
      return oc;
    } catch { /* fall back to a canvas */ }
  }
  const cv = makeCanvas(w, h);
  if (!cv) return null;
  const c = cv.getContext("2d");
  let img = c && typeof c.createImageData === "function" ? c.createImageData(w, h) : null;
  if (img && img.data && img.data.length === data.length) { img.data.set(data); c.putImageData(img, 0, 0); }
  return cv;
}

// ---------- the decal sprites (1 sprite px = 1 world px, like the site sprites) ----------
// A pixel is [r, g, b, alpha?, "noSnow"?]. Decals have no outline and soft shadows, so the game's outlined sprites
// stay on top visually.
function sprite(w, h, paint) {
  const px = new Array(w * h).fill(null);
  const p = {
    set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < w && y < h && c) px[y * w + x] = c; },
    rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p.set(x, y, c); },
    disc(cx, cy, rad, fn) { for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) { const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy <= rad * rad) p.set(x, y, fn(dx / rad, dy / rad)); } },
  };
  paint(p);
  return { w, h, px };
}
const SH = [0, 0, 0, 0.28, "noSnow"]; // soft shadow pixel
const SNOW = [236, 240, 246];
function shadow(p, cx, cy, rx, ry) { for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) p.set(cx + x, cy + y, SH); }
const shadeDisc = (dark, mid, light, hi) => (dx, dy) => { const s = -dx * 0.6 - dy * 0.8, d = Math.hypot(dx, dy); return d > 0.82 ? dark : s > 0.55 ? hi : s > 0.05 ? light : s > -0.45 ? mid : dark; };

function makeSprites() {
  const r = rng(4242), D = {};
  const greens = [
    [[34, 54, 32], [56, 84, 46], [78, 112, 58], [104, 136, 72]],
    [[40, 52, 30], [66, 82, 44], [92, 108, 56], [118, 130, 70]],
    [[30, 50, 36], [50, 76, 52], [70, 100, 64], [96, 126, 80]],
  ];
  const autumn = [[[50, 46, 28], [92, 84, 44], [126, 110, 54], [150, 132, 70]], [[60, 36, 24], [110, 66, 36], [146, 90, 44], [172, 116, 58]]];
  const tree = (g) => sprite(11, 12, (p) => { shadow(p, 6, 10, 4, 1); p.rect(5, 8, 5, 10, [86, 62, 40]); p.disc(5, 4.5, 4.6, shadeDisc(...g)); });
  D.tree = greens.map(tree);
  D.autumn = autumn.map(tree);
  D.pine = [0, 1].map((v) => sprite(9, 13, (p) => {
    shadow(p, 5, 11, 3, 1);
    p.rect(4, 10, 4, 11, [80, 58, 38]);
    for (let y = 0; y < 10; y++) { const hw = Math.floor(y * 0.42) + (y % 3 === 2 ? 1 : 0); for (let x = -hw; x <= hw; x++) p.set(4 + x, y, x < 0 ? (v ? [52, 78, 56] : [48, 72, 46]) : x === 0 ? [40, 62, 40] : [28, 46, 32]); }
  }));
  D.bush = [sprite(7, 5, (p) => { shadow(p, 4, 4, 3, 1); p.disc(3, 2.2, 2.6, shadeDisc([40, 56, 34], [62, 86, 48], [84, 110, 60], [104, 130, 70])); }),
    sprite(7, 5, (p) => { shadow(p, 4, 4, 3, 1); p.disc(3, 2.2, 2.6, shadeDisc([52, 54, 30], [80, 84, 44], [104, 106, 56], [124, 124, 68])); })];
  D.tuft = [sprite(5, 4, (p) => { p.set(1, 1, [96, 120, 62]); p.set(1, 2, [72, 94, 48]); p.set(2, 0, [110, 134, 70]); p.set(2, 1, [86, 110, 56]); p.set(2, 2, [72, 94, 48]); p.set(3, 1, [96, 120, 62]); p.set(3, 2, [72, 94, 48]); p.set(2, 3, SH); }),
    sprite(5, 4, (p) => { p.set(1, 1, [128, 124, 70]); p.set(1, 2, [96, 96, 52]); p.set(2, 0, [140, 134, 80]); p.set(2, 1, [112, 110, 60]); p.set(3, 1, [128, 124, 70]); p.set(3, 2, [96, 96, 52]); p.set(2, 2, [96, 96, 52]); p.set(2, 3, SH); })];
  D.rock = [0, 1, 2].map((v) => sprite(7, 5, (p) => { shadow(p, 4, 4, 3, 1); p.disc(3, 2, 2.5 + v * 0.3, shadeDisc([70, 68, 64], [112, 108, 100], [138, 134, 124], [164, 160, 150])); }));
  D.crops = [[[96, 76, 48], [104, 132, 60]], [[96, 76, 48], [168, 148, 78]], [[88, 70, 46], [120, 98, 64]], [[90, 74, 48], [132, 150, 70]]].map(([soil, crop]) => sprite(16, 10, (p) => {
    for (let y = 0; y < 10; y++) for (let x = 0; x < 16; x++) { const sx = x - Math.floor(y / 3); if (sx < 0 || sx > 12) continue; p.set(x, y, y % 2 ? [soil[0], soil[1], soil[2], 0.85] : [crop[0], crop[1], crop[2], 0.9]); }
  }));
  D.fence = [sprite(14, 4, (p) => { for (let x = 0; x < 14; x++) if (x !== 9 && x !== 10) p.set(x, 1, [124, 100, 72]); for (let x = 0; x < 14; x += 3) { p.set(x, 0, [100, 80, 56]); p.set(x, 1, [90, 72, 50]); p.set(x, 2, [80, 64, 44]); p.set(x, 3, SH); } })];
  D.hay = [sprite(5, 4, (p) => { shadow(p, 3, 3, 2, 1); p.disc(2, 1.6, 1.8, shadeDisc([130, 110, 62], [176, 150, 88], [200, 176, 108], [220, 200, 130])); })];
  D.deadtree = [sprite(8, 10, (p) => { shadow(p, 4, 9, 3, 1); const c = [96, 84, 70]; for (let y = 2; y < 9; y++) p.set(4, y, c); p.set(3, 4, c); p.set(2, 3, c); p.set(5, 3, c); p.set(6, 2, c); p.set(6, 1, c); p.set(3, 1, c); p.set(4, 1, c); })];
  const carCols = [[128, 74, 48], [80, 96, 120], [176, 172, 164], [52, 48, 46], [110, 112, 70]];
  D.car = carCols.map((col) => sprite(9, 6, (p) => {
    shadow(p, 5, 5, 4, 1);
    p.rect(1, 2, 7, 4, mul(col, 0.8)); p.rect(2, 1, 6, 1, col); p.rect(3, 2, 5, 2, [44, 52, 60]); p.set(2, 4, [28, 28, 30]); p.set(6, 4, [28, 28, 30]);
    p.set(1, 2, mul(col, 1.1)); p.set(7, 3, [150, 90, 50]); // rust
  }));
  D.wreck = [0, 1].map((v) => sprite(9, 6, (p) => { // burnt-out shells
    shadow(p, 5, 5, 4, 1);
    p.rect(1, 2, 7, 4, [58, 46, 40]); p.rect(2, 1, 6, 1, [72, 52, 40]); p.rect(3, 2, 5, 2, [28, 26, 26]);
    p.set(1, 3, [132, 74, 40]); p.set(6, 2, [150, 88, 46]); p.set(v ? 2 : 7, 4, [104, 60, 36]); p.set(v ? 7 : 2, 5, SH);
  }));
  D.rubble = [0, 1].map(() => sprite(9, 5, (p) => { shadow(p, 4, 4, 4, 1); for (let k = 0; k < 16; k++) { const x = 1 + ((r() * 7) | 0), y = 1 + ((r() * 3) | 0); p.set(x, y, [[110, 104, 96], [86, 80, 74], [128, 92, 70], [62, 58, 54]][(r() * 4) | 0]); } }));
  const roofCols = [[138, 75, 50], [93, 97, 104], [110, 92, 64], [120, 62, 48]];
  const house = (roof, burnt) => sprite(12, 11, (p) => {
    shadow(p, 7, 10, 5, 1);
    p.rect(1, 5, 10, 9, [185, 169, 138]); p.rect(1, 9, 10, 9, [150, 136, 110]);
    p.rect(3, 6, 4, 7, [44, 46, 50]); p.rect(7, 7, 8, 9, [64, 50, 40]);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 12; x++) if (Math.abs(x - 5.5) <= 3.5 + y * 0.6) p.set(x, y, mul(roof, y === 0 ? 1.2 : y < 3 ? 1 : 0.82));
    if (burnt === 1) { p.rect(5, 0, 9, 3, [40, 36, 34]); p.set(6, 1, [150, 80, 40]); p.rect(9, 5, 10, 8, [52, 48, 44]); }
    if (burnt === 2) { // roof gone, black walls
      for (let y = 0; y < 5; y++) for (let x = 0; x < 12; x++) if (Math.abs(x - 5.5) <= 3.5 + y * 0.6) p.set(x, y, (x + y) % 3 ? [46, 40, 36] : [70, 60, 52]);
      p.rect(1, 5, 10, 6, [58, 52, 46]); p.set(3, 2, [150, 82, 40]); p.set(8, 3, [96, 60, 40]);
    }
  });
  D.house = roofCols.map((roof) => house(roof, 0));
  D.burnt = [house(roofCols[0], 1), house(roofCols[1], 2), house(roofCols[2], 2)];
  const wall = [[150, 148, 140], [138, 86, 64], [86, 94, 104], [120, 114, 104]];
  const building = (w, ruin) => sprite(14, 16, (p) => {
    shadow(p, 8, 15, 6, 1);
    const roof = mul(w, 0.78);
    p.rect(1, 0, 12, 5, roof); p.rect(1, 0, 12, 0, mul(roof, 1.2)); p.set(4, 2, [170, 170, 166]); p.set(5, 2, [170, 170, 166]); p.set(9, 3, [60, 60, 62]);
    p.rect(1, 6, 12, 14, w); p.rect(1, 6, 12, 6, mul(w, 0.7));
    for (let y = 8; y < 14; y += 2) for (let x = 2; x < 12; x += 2) p.set(x, y, r() < 0.15 ? [150, 160, 170] : [36, 40, 46]);
    if (ruin) { for (let x = 7; x <= 12; x++) for (let y = 0; y <= 4; y++) p.set(x, y, r() < 0.5 ? [52, 48, 44] : [92, 86, 80]); p.rect(8, 5, 12, 5, [40, 36, 34]); p.set(10, 9, [30, 28, 28]); p.set(11, 11, [30, 28, 28]); }
  });
  D.building = wall.map((w) => building(w, false));
  D.ruin = [building(wall[0], true), building(wall[3], true)];
  D.peak = [0, 1].map((v) => sprite(20, 14, (p) => {
    shadow(p, 11, 12, 9, 1);
    const top = v ? 7 : 10;
    for (let y = 0; y < 13; y++) for (let x = 0; x < 20; x++) {
      const l = top - (y * top) / 12, rr = top + (y * (19 - top)) / 12;
      if (x < l || x > rr) continue;
      p.set(x, y, x < top - 0.5 + y * 0.15 ? (y < 3 ? [176, 172, 164] : [146, 142, 134]) : x < top + 1 + y * 0.1 ? [104, 100, 96] : [84, 80, 78]);
    }
  }));
  D.mound = [0, 1].map(() => sprite(18, 7, (p) => {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 18; x++) {
      const dx = (x - 8.5) / 8.5, dy = (y - 6) / 6;
      if (dx * dx + dy * dy > 1 || y > 6) continue;
      const s = -dx * 0.7 - dy * 0.5;
      p.set(x, y, s > 0.6 ? [154, 142, 104, 0.9] : s > 0.2 ? [138, 128, 92, 0.85] : dx > 0.3 ? [92, 84, 60, 0.85] : [122, 113, 82, 0.6]);
    }
  }));
  // A pond (sim/mapgen.js tile.pond): the rivers' water (TERRAIN.water) in a muddy bank, a ripple's light, reeds at one
  // end; its frozen twin pale ice with cracks. The water and the ice never take the snow caps (noSnow).
  const pond = (v, ice) => sprite(22, 12, (p) => {
    const cx = 10.5, cy = 5.6, rx = 10.4 - v * 1.2, ry = 5.3;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 22; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d > 1) continue;
      if (d > 0.7) { p.set(x, y, y < cy ? [80, 86, 52, 0.95] : [98, 86, 60, 0.95]); continue; } // the bank: grass behind, mud in front
      const q = 1 - d;
      if (ice) { // pale blue ice, a sheen at the back, cracks across it
        const crack = ((x + 2 * y + v * 3) % 9 === 0 || (x - y + 40 + v) % 11 === 0) && d < 0.5;
        p.set(x, y, crack ? [120, 150, 174, 1, "noSnow"] : y < cy - 1.5 && x < cx + 2 ? [214, 230, 242, 1, "noSnow"] : [150 + q * 40, 182 + q * 30, 206 + q * 20, 1, "noSnow"]);
      } else { // the rivers' water, deeper in the middle, a ripple's light
        const ripple = (y === 4 && x >= 6 && x <= 10) || (y === 7 && x >= 12 - v && x <= 15 - v);
        const f = 0.8 + (1 - q) * 0.35;
        p.set(x, y, ripple ? [128, 164, 186, 1, "noSnow"] : [44 * f, 79 * f, 107 * f, 1, "noSnow"]);
      }
    }
    const rx0 = v ? 18 : 2; // reeds at one end, standing out of the bank
    for (const [dx, h] of [[0, 3], [1, 5], [2, 3], [3, 2]]) for (let k = 0; k < h; k++) p.set(rx0 + (v ? -dx : dx), 6 - k, k === h - 1 ? [110, 84, 50] : ice ? [128, 118, 84] : [92, 112, 60]);
  });
  D.pond = [0, 1].map((v) => pond(v, false));
  D.pondice = [0, 1].map((v) => pond(v, true));
  D.reeds = [sprite(6, 6, (p) => { for (const x of [1, 3, 4]) for (let y = 1 + (x & 1); y < 6; y++) p.set(x, y, y < 3 ? [120, 128, 70] : [76, 96, 54]); p.set(3, 0, [110, 84, 50]); })];
  return D;
}

// The seasons' trees and bushes (ui/seasontrees.js; the user's request 2026-10-23: "In fall the trees should be red
// orange and brown in winter the trees are leaf less and have snow on them."): never placed themselves, only drawn in
// place of the green ones (SEASON_LOOK), the same size so a tree keeps its spot. fall: a crown in each FALL colour
// (red, orange, brown, rust); fallbush: two browned bushes; bare: a broadleaf's trunk and limbs in a haze of twigs (snow
// on every other bit of limb, "snow", and the crown's top; not on the trunk or the lower twigs, "noSnow"); barebush: a
// bush's twigs.
function seasonSprites(D) {
  const shades = (c) => [mul(c, 0.46), mul(c, 0.78), c, mix(c, [240, 204, 150], 0.28)];
  const tree = (g) => sprite(11, 12, (p) => { shadow(p, 6, 10, 4, 1); p.rect(5, 8, 5, 10, [86, 62, 40]); p.disc(5, 4.5, 4.6, shadeDisc(...g)); });
  D.fall = FALL.map((c) => tree(shades(c)));
  D.fallbush = [3, 1].map((i) => sprite(7, 5, (p) => { shadow(p, 4, 4, 3, 1); p.disc(3, 2.2, 2.6, shadeDisc(...shades(mix(FALL[i], FALL[2], 0.35)))); }));
  const twig = (up) => (up ? [122, 106, 92, 0.55] : [122, 106, 92, 0.42, "noSnow"]), trunk = [84, 64, 46, 1, "noSnow"];
  const limb = (i) => (i % 2 ? [98, 80, 64, 1, "noSnow"] : [98, 80, 64, 1, "snow"]); // every other one snowed on
  const LIMBS = [
    [[4, 7], [3, 6], [2, 5], [1, 4], [1, 3], [6, 6], [7, 5], [8, 4], [8, 3], [9, 2], [5, 3], [5, 2], [4, 1], [6, 2], [7, 1], [3, 4], [2, 2]],
    [[4, 6], [3, 5], [3, 4], [2, 3], [2, 2], [6, 7], [7, 6], [8, 5], [9, 4], [9, 3], [5, 3], [6, 2], [6, 1], [4, 2], [4, 1], [7, 4], [8, 2]],
  ];
  D.bare = LIMBS.map((ls, v) => sprite(11, 12, (p) => {
    shadow(p, 6, 10, 4, 1);
    p.disc(5, 4.5, 4.6, (dx, dy) => ((Math.round(5 + dx * 4.6) + Math.round(4.5 + dy * 4.6) + v) & 1 ? null : twig(dy < -0.6)));
    ls.forEach(([x, y], i) => p.set(x, y, limb(i)));
    p.rect(5, 4, 5, 10, trunk);
  }));
  D.barebush = [sprite(7, 5, (p) => {
    shadow(p, 4, 4, 3, 1);
    for (const [x, y] of [[3, 3], [3, 2], [2, 1], [1, 0], [4, 2], [5, 1], [5, 0], [3, 1], [3, 0], [1, 2], [6, 2]]) p.set(x, y, y > 2 ? [92, 76, 62, 1, "noSnow"] : [112, 96, 80]);
  })];
}

// Every sprite in one list (cell = index), with where each set starts.
const SPR = [], SET = {};
{
  const D = makeSprites();
  seasonSprites(D);
  for (const [k, list] of Object.entries(D)) { SET[k] = { at: SPR.length, n: list.length }; SPR.push(...list); }
}
export const DECO_SETS = Object.keys(SET);
// A decal that lies flat on the ground (a pond: placeTile draws it under a site's sprite, never in a clear zone).
export const flatDecal = (cell) => (cell >= SET.pond.at && cell < SET.pond.at + SET.pond.n) || (cell >= SET.pondice.at && cell < SET.pondice.at + SET.pondice.n);
// The broadleaf trees and bushes by the season (render.js and poimap.js pick it: seasontrees.js mapSeason):
// SEASON_LOOK[key]: sprite -> the sprite drawn. Spring and summer green (the autumn decals too); early autumn
// ("autumn0") two greens of three turned, a bush in two; autumn every tree red, orange, brown or rust and the bushes
// browned; winter every broadleaf bare (snow on it while snow lies: drawDecor's snow), the bushes bare twigs. Pines and
// everything else stay as they are.
const lookOf = (to) => { const m = Int32Array.from(SPR, (_, i) => i), set = (k, f) => { for (let i = 0; i < SET[k].n; i++) m[SET[k].at + i] = f(i); }; to(set); return m; };
const turned = (set) => set("autumn", (k) => SET.fall.at + [3, 1][k % 2]);
export const SEASON_LOOK = {
  spring: lookOf((set) => set("autumn", (k) => SET.tree.at + (k % SET.tree.n))),
  autumn0: lookOf((set) => { turned(set); set("tree", (k) => (k < 2 ? SET.fall.at + k : SET.tree.at + k)); set("bush", (k) => (k ? SET.bush.at + k : SET.fallbush.at)); }),
  autumn: lookOf((set) => { turned(set); set("tree", (k) => SET.fall.at + (k % 3)); set("bush", (k) => SET.fallbush.at + (k % SET.fallbush.n)); }),
  winter: lookOf((set) => { for (const k of ["tree", "autumn"]) set(k, (i) => SET.bare.at + (i % SET.bare.n)); set("bush", () => SET.barebush.at); }),
};
SEASON_LOOK.summer = SEASON_LOOK.spring;
// The same with the ponds frozen (sim/ponds.js pondIce): ICE_LOOK[season key].
export const ICE_LOOK = Object.fromEntries(Object.entries(SEASON_LOOK).map(([k, m]) => { const c = Int32Array.from(m); for (let i = 0; i < SET.pond.n; i++) c[SET.pond.at + i] = SET.pondice.at + i; return [k, c]; }));
// Atlas layout in sprite px: [x, y] of each cell's plain and snowy version (1 px apart), and the atlas size.
const LAYOUT = (() => {
  const W = 128, cells = [];
  let x = 0, y = 0, rowH = 0;
  for (const s of SPR) for (let v = 0; v < 2; v++) {
    if (x + s.w > W) { x = 0; y += rowH + 1; rowH = 0; }
    cells.push([x, y]);
    x += s.w + 1; rowH = Math.max(rowH, s.h);
  }
  return { W, H: y + rowH, cells };
})();

// Brightness by what you know of a tile (render.js SHADES): live, known from a report, unknown. Decals and the water
// texture come pre-shaded, so a decal takes its own tile's shade even where it overhangs a neighbour.
export const DECO_SHADES = [1, 0.72, 0.42];
// The atlas at R device px per sprite px, one band per shade: { cv, R, src: Float32Array [sx, sy, sw, sh] per cell,
// at ((shade * sprites + sprite) * 2 + snow) * 4 }.
const atlases = new Map();
export function decoAtlas(R) {
  if (atlases.has(R)) return atlases.get(R);
  const W = LAYOUT.W * R, BH = (LAYOUT.H + 1) * R, H = BH * DECO_SHADES.length, data = new Uint8ClampedArray(W * H * 4);
  const src = new Float32Array(DECO_SHADES.length * SPR.length * 8);
  DECO_SHADES.forEach((f, sh) => SPR.forEach((s, i) => {
    for (let v = 0; v < 2; v++) {
      const [ax, ay0] = LAYOUT.cells[i * 2 + v], ay = ay0 + sh * (LAYOUT.H + 1);
      src.set([ax * R, ay * R, s.w * R, s.h * R], ((sh * SPR.length + i) * 2 + v) * 4);
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
        let c = s.px[y * s.w + x];
        if (!c) continue;
        // Snow on top: the top pixel or two of every column (not on shadows; "snow": always, a bare tree's limbs).
        if (v && c[4] !== "noSnow" && (c[4] === "snow" || y === 0 || !s.px[(y - 1) * s.w + x] || (y > 1 && !s.px[(y - 2) * s.w + x] && c[3] == null))) c = [...SNOW, c[3]];
        const a = Math.round((c[3] ?? 1) * 255), cr = Math.round(c[0] * f), cg = Math.round(c[1] * f), cb = Math.round(c[2] * f);
        for (let yy = 0; yy < R; yy++) for (let xx = 0; xx < R; xx++) {
          const o = (((ay + y) * R + yy) * W + (ax + x) * R + xx) * 4;
          data[o] = cr; data[o + 1] = cg; data[o + 2] = cb; data[o + 3] = a;
        }
      }
    }
  }));
  const at = { cv: canvasFrom(data, W, H), R, src, sprites: SPR.length, bytes: W * H * 4 };
  atlases.set(R, at);
  return at;
}

// ---------- the water texture (style A): rippled water, 1 texel per world px, tiling every 256 world px ----------
const WP = 256;
function fbm(seed, n, cells, oct) {
  const out = new Float32Array(n * n);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const c = Math.min(n, cells << o), r = rng(seed * 7919 + o * 104729), lat = new Float32Array(c * c);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    for (let y = 0; y < n; y++) {
      const fy = (y * c) / n, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty), y0 = iy % c, y1 = (iy + 1) % c;
      for (let x = 0; x < n; x++) {
        const fx = (x * c) / n, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx), x0 = ix % c, x1 = (ix + 1) % c;
        const a = lat[y0 * c + x0] + (lat[y0 * c + x1] - lat[y0 * c + x0]) * sx;
        const b = lat[y1 * c + x0] + (lat[y1 * c + x1] - lat[y1 * c + x0]) * sx;
        out[y * n + x] += (a + (b - a) * sy) * amp;
      }
    }
    tot += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
let waterTexels = null;
function waterTex(base) {
  if (waterTexels) return waterTexels;
  const n = fbm(101, WP, 4, 3), d = new Uint8ClampedArray(WP * WP * 4);
  for (let y = 0; y < WP; y++) for (let x = 0; x < WP; x++) {
    const i = y * WP + x;
    let c = mul(base, 0.86 + n[i] * 0.26);
    if ((y + Math.floor(n[i] * 14)) % 7 === 0 && Math.sin(x * 0.33 + y * 1.7 + n[i] * 9) > 0.25) c = mix(c, [128, 164, 186], 0.5);
    d.set([c[0], c[1], c[2], 255], i * 4);
  }
  return (waterTexels = d);
}
const waters = new Map();
// { cv, R } for the water color (TERRAIN.water.color as [r, g, b]) at a shade (DECO_SHADES index). One texel per world
// px at every zoom (the pattern is sampled smoothed or crisp like the decals).
export function waterTexture(R, base, shade = 0) {
  if (waters.has(shade)) return waters.get(shade);
  const t = waterTex(base), f = DECO_SHADES[shade], d = new Uint8ClampedArray(t.length);
  for (let o = 0; o < t.length; o += 4) { d[o] = t[o] * f; d[o + 1] = t[o + 1] * f; d[o + 2] = t[o + 2] * f; d[o + 3] = 255; }
  const w = { cv: canvasFrom(d, WP, WP), R: 1, bytes: WP * WP * 4 };
  waters.set(shade, w);
  return w;
}
// A pattern belongs to the context that made it: one per chunk context, scaled so one texel = 1 world px.
const patterns = new WeakMap();
export function waterPattern(ctx, tex) {
  if (!tex || !tex.cv || typeof ctx.createPattern !== "function") return null;
  let m = patterns.get(ctx);
  if (!m) patterns.set(ctx, (m = new Map()));
  let p = m.get(tex);
  if (p === undefined) {
    p = ctx.createPattern(tex.cv, "repeat") || null;
    if (p && tex.R !== 1 && typeof p.setTransform === "function" && typeof DOMMatrix !== "undefined") p.setTransform(new DOMMatrix().scale(1 / tex.R));
    m.set(tex, p);
  }
  return p;
}
// Atlas and texture scale for S device px per world px: crisp pixels (nearest, from the 1× atlas) from 2 device px
// per sprite px up, like the site sprites; below that smoothed, from the 2× atlas between 1 and 2.
export const decoScale = (S) => (S >= 2 ? { R: 1, smooth: false } : { R: S > 1.05 ? 2 : 1, smooth: true });
export const decoMemory = () => {
  let b = 0;
  for (const a of atlases.values()) b += a.bytes;
  for (const w of waters.values()) b += w.bytes;
  return b;
};

// ---------- placement, once per world ----------
// The clear zone of a tile that shows a site, a base or a hive (world px from its center): the sprite and its plate,
// and below them the name and the danger skulls. Decals of the tile and of its six neighbours stay out of it.
export const CLEAR_ZONE = [[-21, -27, 21, 24], [-26, 12, 26, 34]];
const MAX_REACH = 34; // no decal reaches further than this from its tile's center (so only neighbours can touch a zone)
const FARM_TYPES = new Set(["farm", "ranch", "barn"]);

// What goes on a tile: [set, lo, hi, chance]; the count is lo..hi when the chance comes up.
function rulesFor(t, ctx) {
  switch (t.terrain) {
    case "forest": return [["tree", 4, 6], ["pine", 2, 3], ["autumn", 0, 2, 0.35], ["bush", 0, 1, 0.5]];
    case "plains": return ctx.farm
      ? [["crops", 1, 2, 0.95], ["fence", 0, 1, 0.6], ["hay", 1, 2, 0.5], ["tuft", 0, 2], ["tree", 0, 1, 0.2]]
      : [["tuft", 2, 3], ["bush", 0, 1, 0.55], ["crops", 0, 1, 0.12], ["fence", 0, 1, 0.22], ["tree", 0, 1, 0.3], ["hay", 0, 1, 0.08], ["deadtree", 0, 1, 0.08], ["burnt", 0, 1, 0.04]];
    case "hills": return [["mound", 2, 3], ["rock", 1, 2], ["tuft", 0, 2], ["tree", 0, 1, 0.25], ["pine", 0, 1, 0.15]];
    case "mountain": return [["peak", 2, 2], ["rock", 1, 3], ["pine", 0, 1, 0.2]];
    case "suburb": return [["house", 2, 3], ["burnt", 1, 1, 0.45], ["tree", 0, 2], ["car", 0, 1, 0.3], ["wreck", 0, 1, 0.2], ["fence", 0, 1, 0.3]];
    case "city": return [["building", 2, 3], ["ruin", 1, 1, 0.55], ["rubble", 1, 2], ["wreck", 0, 1, 0.35], ["car", 0, 1, 0.25]];
    default: return [];
  }
}

// Is a segment (ax, ay)-(bx, by) closer than m to a rectangle [x0, y0, x1, y1]?
function segNear(ax, ay, bx, by, x0, y0, x1, y1, m) {
  if (Math.max(ax, bx) < x0 - m || Math.min(ax, bx) > x1 + m || Math.max(ay, by) < y0 - m || Math.min(ay, by) > y1 + m) return false;
  // The segment against the rectangle grown by m (a little generous at the corners): clip it (Liang-Barsky).
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy], q = [ax - (x0 - m), x1 + m - ax, ay - (y0 - m), y1 + m - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}
// Is (x, y) inside the hex of size s at the origin (pointy top)?
const inHex = (x, y, s) => { const ax = Math.abs(x), ay = Math.abs(y); return ax <= (s * SQ3) / 2 && ay <= s - ax / SQ3; };

// The rules as objects with set indices (made once), and scratch space for one tile, so placing allocates nothing.
const RULES = {};
const ruleObjs = (list) => list.map(([set, lo, hi, p = 1]) => ({ set: SET[set].at, n: SET[set].n, lo, hi, p }));
for (const terrain of ["forest", "plains", "hills", "mountain", "suburb", "city"]) RULES[terrain] = ruleObjs(rulesFor({ terrain }, { farm: 0 }));
RULES.farm = ruleObjs(rulesFor({ terrain: "plains" }, { farm: 1 }));
const NONE = [];
const CAR = { set: SET.car.at, n: SET.car.n }, WRECK = { set: SET.wreck.at, n: SET.wreck.n }, REEDS = { set: SET.reeds.at, n: SET.reeds.n }, POND = { set: SET.pond.at, n: SET.pond.n };
const MAXW = 48;
const wSet = new Int32Array(MAXW), wN = new Int32Array(MAXW), wKind = new Uint8Array(MAXW), wDx = new Float64Array(MAXW), wDy = new Float64Array(MAXW);
const road = new Float64Array(5 * 64), ownV = new Float64Array(2 * 16);
const pX = new Float64Array(MAXW), pY = new Float64Array(MAXW), pYc = new Float64Array(MAXW), pW = new Float64Array(MAXW), pH = new Float64Array(MAXW), pCell = new Int32Array(MAXW), pFlat = new Uint8Array(MAXW), order = new Int32Array(MAXW);
const nbTmp = new Int32Array(6);

// The decals of one tile, appended to D.items (D.start / D.len say where); returns how far they reach from its center.
function placeTile(D, id) {
  const { tiles, x: X, y: Y, nb, farm, seed, hex } = D;
  const t = tiles[id], cx = X[id], cy = Y[id], r = rng(hash(id, seed ^ 0x5eed));
  let nn = 0;
  for (let k = 0; k < 6; k++) { const m = nb[id * 6 + k]; if (m >= 0) nbTmp[nn++] = m; }
  const edge = nn < 6;
  // Roads near the tile (its own and its neighbours', center to center), relative to its center; bridges are wider.
  let nr = 0, no = 0;
  for (let i = -1; i < nn; i++) {
    const a = i < 0 ? id : nbTmp[i], links = tiles[a].roadLinks;
    if (!links) continue;
    for (let q = 0; q < links.length; q++) {
      const m = links[q];
      if (m < a) { // both ends near: listed once
        let near = m === id;
        for (let k = 0; !near && k < nn; k++) near = nbTmp[k] === m;
        if (near) continue;
      }
      if (nr >= 64) break;
      const o = nr++ * 5;
      road[o] = X[a] - cx; road[o + 1] = Y[a] - cy; road[o + 2] = X[m] - cx; road[o + 3] = Y[m] - cy;
      road[o + 4] = tiles[a].bridge || tiles[m].bridge ? 6.5 : 2.6;
      if (no < 16 && (a === id || m === id)) { ownV[no * 2] = (a === id ? road[o + 2] : road[o]) / 2; ownV[no * 2 + 1] = (a === id ? road[o + 3] : road[o + 1]) / 2; no++; }
    }
  }
  const water = t.terrain === "water";
  let nw = 0;
  // A pond tile's pond (sim/mapgen.js tile.pond): first, so the rest keep clear of it.
  if (t.pond && !water) { wSet[nw] = POND.set; wN[nw] = POND.n; wKind[nw] = 3; nw++; }
  const rules = water ? NONE : t.terrain === "plains" && farm[id] ? RULES.farm : RULES[t.terrain] || NONE;
  for (let i = 0; i < rules.length; i++) {
    const R = rules[i];
    if (r() > R.p) continue;
    const k = R.lo + Math.floor(r() * (R.hi - R.lo + 1));
    for (let a = 0; a < k && nw < MAXW; a++) { wSet[nw] = R.set; wN[nw] = R.n; wKind[nw] = 0; nw++; }
  }
  // Wrecked and abandoned cars along the road (more of them in built-up land).
  if (no && !water && r() < (t.terrain === "city" || t.terrain === "suburb" ? 0.45 : 0.22) && nw < MAXW) {
    const c = r() < 0.6 ? WRECK : CAR;
    wSet[nw] = c.set; wN[nw] = c.n; wKind[nw] = 1; nw++;
  }
  // Reeds on the banks: a clump on some of the sides that touch land.
  if (water) for (let k = 0; k < nn; k++) {
    const m = nbTmp[k];
    if (tiles[m].terrain === "water" || r() >= 0.55 || nw >= MAXW) continue;
    wSet[nw] = REEDS.set; wN[nw] = REEDS.n; wKind[nw] = 2; wDx[nw] = X[m] - cx; wDy[nw] = Y[m] - cy; nw++;
  }
  let np = 0;
  for (let w = 0; w < nw; w++) {
    const cell = wSet[w] + Math.floor(r() * wN[w]), sp = SPR[cell], kind = wKind[w];
    const sc = 0.88 + r() * 0.24, bw = sp.w * sc, bh = sp.h * sc;
    let found = false, bx = 0, by = 0, bsp = -1;
    for (let k = 0; k < 16; k++) {
      let x, y;
      if (kind === 2) { // reeds: just inside the bank, toward that neighbour
        const f = 0.36 + r() * 0.08, s2 = (r() - 0.5) * 12, vx = wDx[w], vy = wDy[w], l = Math.hypot(vx, vy);
        x = vx * f - (vy / l) * s2; y = vy * f + (vx / l) * s2 + bh / 2;
      } else if (kind === 1 && k < 10) { // beside the road
        const o = Math.floor(r() * no) * 2, vx = ownV[o], vy = ownV[o + 1], l = Math.hypot(vx, vy), u = 0.3 + r() * 0.6, side = r() < 0.5 ? -1 : 1, off = 3.5 + bh / 2 + r() * 3;
        x = vx * u - (vy / l) * off * side; y = vy * u + (vx / l) * off * side + bh / 2;
      } else if (kind === 3) { // the pond: to one side of the middle, where a site's sprite on the tile leaves it showing
        const a = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.9, d = 9 + r() * 5;
        x = Math.cos(a) * d; y = Math.sin(a) * d * 0.7 + bh / 2 + 2;
      } else {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 18;
        x = Math.cos(a) * d; y = Math.sin(a) * d * 0.95 + bh / 2;
      }
      const x0 = x - bw / 2, y0 = y - bh, x1 = x + bw / 2, y1 = y;
      if (-x0 > MAX_REACH || x1 > MAX_REACH || -y0 > MAX_REACH || y1 > MAX_REACH) continue;
      if (np && pFlat[0] && kind !== 3 && x0 < pX[0] + pW[0] / 2 && pX[0] - pW[0] / 2 < x1 && y0 < pY[0] && pY[0] - pH[0] < y1 - 1) continue; // nothing standing in the pond
      // Off the roads, and inside the map at its edge.
      let ok = true;
      for (let q = 0; ok && q < nr; q++) { const o = q * 5; if (segNear(road[o], road[o + 1], road[o + 2], road[o + 3], x0, y0, x1, y1, road[o + 4] / 2 + 1.2)) ok = false; }
      if (!ok) continue;
      if (edge && !(inHex(x0, y0, hex) && inHex(x1, y0, hex) && inHex(x0, y1, hex) && inHex(x1, y1, hex))) continue;
      let sp2 = 99;
      const yc = y - bh / 2;
      for (let q = 0; q < np; q++) { const dd = Math.hypot(pX[q] - x, pYc[q] - yc); if (dd < sp2) sp2 = dd; }
      if (!found || sp2 > bsp) { found = true; bx = x; by = y; bsp = sp2; }
      if (sp2 > 9) break;
    }
    if (!found) continue;
    pX[np] = bx; pY[np] = by; pYc[np] = by - bh / 2; pW[np] = bw; pH[np] = bh; pCell[np] = cell; pFlat[np] = kind === 3 ? 1 : 0; order[np] = np; np++;
  }
  // Farther back first (insertion sort: a handful); the pond, flat on the ground, under everything.
  const yKey = (q) => (pFlat[q] ? -1e9 : pY[q]);
  for (let i = 1; i < np; i++) { const v = order[i]; let j = i - 1; while (j >= 0 && yKey(order[j]) > yKey(v)) { order[j + 1] = order[j]; j--; } order[j + 1] = v; }
  let reach = 0;
  D.start[id] = D.used / 6;
  D.len[id] = np;
  for (let i = 0; i < np; i++) {
    const q = order[i], x0 = pX[q] - pW[q] / 2, y0 = pY[q] - pH[q], x1 = pX[q] + pW[q] / 2, y1 = pY[q];
    let f = 0;
    for (let k = -1; k < 6 && !pFlat[q]; k++) { // the pond lies flat under a site's sprite and name: never in a clear zone
      const m = k < 0 ? id : nb[id * 6 + k];
      if (m < 0) continue;
      const dx = X[m] - cx, dy = Y[m] - cy;
      for (let z = 0; z < CLEAR_ZONE.length; z++) {
        const Z = CLEAR_ZONE[z];
        if (x0 < dx + Z[2] && dx + Z[0] < x1 && y0 < dy + Z[3] && dy + Z[1] < y1) { f |= 1 << (k + 1); break; }
      }
    }
    reach = Math.max(reach, -x0, x1, -y0, y1);
    if (D.used + 6 > D.items.length) { const bigger = new Float32Array(D.items.length * 2); bigger.set(D.items); D.items = bigger; }
    const o = D.used;
    D.items[o] = pCell[q]; D.items[o + 1] = x0; D.items[o + 2] = y0; D.items[o + 3] = pW[q]; D.items[o + 4] = pH[q]; D.items[o + 5] = f;
    D.used += 6;
  }
  return reach;
}

// Decal placements for a world. Each tile's decals are placed the first time the tile is drawn (zoomed out nothing
// is placed at all), from the tile's own seed, so the order tiles are placed in never changes the result. A tile's
// run is items[start[id] * 6 ..] of len[id] items, 6 floats each: [sprite, left, top, width, height, zones] (world px
// from the tile's center). zones: bit 0 the tile's own clear zone, bit 1 + k that of its neighbour nb[id * 6 + k],
// when the decal overlaps it. hex: render.js HEX. Uses the world's seed and the map only, never state.rng.
export function placeDecor(state, hex) {
  const g = state.grid, tiles = state.tiles, n = tiles.length, seed = (state.seed >>> 0) || 0;
  const nb = new Int32Array(n * 6).fill(-1), X = new Float64Array(n), Y = new Float64Array(n);
  for (let id = 0; id < n; id++) {
    [X[id], Y[id]] = g.toPixel(id, hex);
    const nbs = g.neighbors(id);
    for (let k = 0; k < nbs.length; k++) nb[id * 6 + k] = nbs[k];
  }
  // Farmland within 2 tiles of a farm, ranch or barn grows crops.
  const farm = new Uint8Array(n);
  for (const t of tiles) if (t.loc && FARM_TYPES.has(t.loc.type)) for (const m of g.within(t.id, 2)) farm[m] = 1;
  return {
    tiles, seed, hex, n, nb, x: X, y: Y, farm, start: new Int32Array(n).fill(-1), len: new Uint8Array(n), items: new Float32Array(6 * 1024), used: 0,
    reach: MAX_REACH + 1,
    get bytes() { return this.nb.byteLength + this.x.byteLength * 2 + this.farm.byteLength + this.start.byteLength + this.len.byteLength + this.items.byteLength; },
  };
}
// Places the decals of every tile (the tests and measurements); returns D.
export function placeAll(D) {
  for (let id = 0; id < D.n; id++) if (D.start[id] < 0) placeTile(D, id);
  return D;
}
// Every tile's decals in tile order (placing what is missing): a list of [tile, ...6 floats] rows for comparisons.
export function decorRows(D) {
  placeAll(D);
  const out = [];
  for (let id = 0; id < D.n; id++) for (let k = 0; k < D.len[id]; k++) { const j = (D.start[id] + k) * 6; out.push([id, ...D.items.subarray(j, j + 6)]); }
  return out;
}

// Draws the decals of the tiles list[0..n) into ctx (world transform), each in its tile's shade (key[tile] & 3,
// render.js), skipping those in a clear zone in use (clr[tile] 1: a site, base or hive is drawn there).
// at: decoAtlas(R); snow: the snowy versions; look: SEASON_LOOK of the season. Returns the number drawn.
export function drawDecor(ctx, D, list, n, key, clr, at, snow, alpha, look = SEASON_LOOK.autumn) {
  if (!at || !at.cv) return 0;
  const { nb, x: TX, y: TY, start, len } = D, src = at.src, cv = at.cv, v = snow ? 1 : 0, ns = at.sprites;
  const a0 = ctx.globalAlpha;
  if (alpha < 1) ctx.globalAlpha = alpha;
  let drawn = 0;
  for (let a = 0; a < n; a++) {
    const id = list[a];
    if (start[id] < 0) placeTile(D, id);
    const k0 = start[id], k1 = k0 + len[id], items = D.items;
    if (k0 === k1) continue;
    let cm = clr[id];
    for (let k = 0, o = id * 6; k < 6; k++) { const m = nb[o + k]; if (m >= 0 && clr[m]) cm |= 2 << k; }
    const X = TX[id], Y = TY[id], base = Math.min(2, key[id] & 3) * ns;
    for (let k = k0; k < k1; k++) {
      const j = k * 6;
      if (cm & items[j + 5]) continue;
      const s = ((base + look[items[j]]) * 2 + v) * 4;
      ctx.drawImage(cv, src[s], src[s + 1], src[s + 2], src[s + 3], X + items[j + 1], Y + items[j + 2], items[j + 3], items[j + 4]);
      drawn++;
    }
  }
  ctx.globalAlpha = a0;
  return drawn;
}
// One decal on its own (ui/poimap.js: the POI dialogue's tile map): sprite k (mod the set's count) of a set
// (DECO_SETS), its feet at (x, y), `scale` device px a sprite px, from the 1× atlas in full light; look: the
// season's (SEASON_LOOK), snow: its snowy version. Returns [w, h] drawn, or null without an atlas.
export function drawDecal(ctx, set, k, x, y, scale, { snow = false, look = SEASON_LOOK.spring } = {}) {
  const S = SET[set], at = decoAtlas(1);
  if (!S || !at || !at.cv) return null;
  const cell = look[S.at + (((k % S.n) + S.n) % S.n)], sp = SPR[cell], o = (cell * 2 + (snow ? 1 : 0)) * 4, w = sp.w * scale, h = sp.h * scale;
  ctx.drawImage(at.cv, at.src[o], at.src[o + 1], at.src[o + 2], at.src[o + 3], Math.round(x - w / 2), Math.round(y - h), w, h);
  return [w, h];
}
/** A decal's size in sprite px: [w, h]. @param {string} set @param {number} [k] */
export const decalSize = (set, k = 0) => { const S = SET[set]; if (!S) return [0, 0]; const sp = SPR[S.at + (((k % S.n) + S.n) % S.n)]; return [sp.w, sp.h]; };
onForgetPictures(() => { atlases.clear(); waters.clear(); }); // ui/pictures.js: drawn again after a lost GPU context
