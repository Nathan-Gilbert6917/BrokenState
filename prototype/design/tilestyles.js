// Tile texture styles for the State Map: a DESIGN PREVIEW only (design/tiles.html). Nothing in the game imports
// this file. Every style is built the way render.js would use it: textures (or decal sprites) are made once per
// zoom bucket, then the ground of a list of tiles is drawn with a handful of batched fills, exactly like
// render.js drawGround fills one path per terrain color today, so it drops straight into the chunk cache.
//
// Styles:
//   flat  Today: one flat color per terrain (render.js as it is).
//   A     Pixel ground: per-terrain procedural pixel textures (1 texel = 1 world px, the same pixel size as the
//         map's site sprites), world-anchored patterns so neighbouring tiles of one terrain join seamlessly.
//   B     Decals: today's flat colors plus small hand-placed-looking pixel sprites per tile (trees, rocks, crop
//         patches, fences, wrecks, houses, ruins), placed once per world by a per-tile seed.
//   C     Painterly: soft brushed textures plus edge blending (each terrain bleeds a wobbly fringe into lower
//         neighbours), ambient occlusion on the shadow side of forests, mountains and cities, shoreline foam.
//   D     Tactical: muted paper-map palette with ink symbols (tree rings, contour lines, hatching), hex grid
//         hairlines, red roads, blue shorelines, a red hatch for infection.
import { TERRAIN } from "../src/sim/data.js";
import { bridgeCanvas, drawMapSprite } from "../src/ui/mapsprites.js";

export const HEX = 26;               // render.js HEX
export const P = 256;                // world px covered by one repeat of a texture
const N = 256;                       // texels per texture side for the pixel / noise generators
const SQ3 = Math.sqrt(3);
export const TKEYS = Object.keys(TERRAIN); // water, plains, forest, hills, mountain, suburb, city
const TI = Object.fromEntries(TKEYS.map((k, i) => [k, i]));
export const HEX_CORNERS = Array.from({ length: 6 }, (_, i) => [Math.cos((Math.PI / 180) * (60 * i - 30)), Math.sin((Math.PI / 180) * (60 * i - 30))]);
export function hexSub(ctx, cx, cy, s) {
  ctx.moveTo(cx + s * HEX_CORNERS[0][0], cy + s * HEX_CORNERS[0][1]);
  for (let i = 1; i < 6; i++) ctx.lineTo(cx + s * HEX_CORNERS[i][0], cy + s * HEX_CORNERS[i][1]);
  ctx.closePath();
}

// ---------- color, random, noise ----------
export function rgb(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const css = (c, a = 1) => (a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
export function rng(seed) {
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
// Tileable fractal value noise on an n×n grid (wraps at the edges, so textures repeat without seams). 0..1.
export function fbm(seed, n, cells, oct = 4, gain = 0.5) {
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
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
const mk = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const bytesOf = (cvs) => cvs.reduce((s, c) => s + (c ? c.width * c.height * 4 : 0), 0);

// Pixel buffer that wraps (for seamless textures).
function pixbuf(n = N) {
  const d = new Uint8ClampedArray(n * n * 4);
  const w = (v) => ((v % n) + n) % n;
  return {
    n, d,
    set(x, y, c, a = 255) { const i = (w(Math.round(y)) * n + w(Math.round(x))) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = a; },
    get(x, y) { const i = (w(y) * n + w(x)) * 4; return [d[i], d[i + 1], d[i + 2]]; },
    canvas() { const cv = mk(n, n); cv.getContext("2d").putImageData(new ImageData(d, n, n), 0, 0); return cv; },
  };
}
// A texture at R device px per world px (P world px square), from a source canvas; nearest-neighbour for pixel art.
function scaled(src, R, smooth) {
  const cv = mk(P * R, P * R), c = cv.getContext("2d");
  c.imageSmoothingEnabled = smooth;
  c.imageSmoothingQuality = "high";
  c.drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
}
// A vector-painted texture at R: draw(ctx, wrap) in world px; wrap(x, y, r, fn) repeats a mark near the edges.
function painted(R, draw) {
  const cv = mk(P * R, P * R), c = cv.getContext("2d");
  c.scale(R, R);
  const wrap = (x, y, r, fn) => {
    for (const ox of [-P, 0, P]) for (const oy of [-P, 0, P]) {
      const X = x + ox, Y = y + oy;
      if (X + r < 0 || Y + r < 0 || X - r > P || Y - r > P) continue;
      fn(X, Y);
    }
  };
  draw(c, wrap, R);
  return cv;
}
// Patterns are made per context (a pattern belongs to the context that made it) and scaled so one repeat = P world px.
const patCache = new WeakMap();
export function pattern(ctx, cv) {
  let m = patCache.get(ctx);
  if (!m) patCache.set(ctx, (m = new Map()));
  let p = m.get(cv);
  if (!p) {
    p = ctx.createPattern(cv, "repeat");
    p.setTransform(new DOMMatrix().scale(P / cv.width));
    m.set(cv, p);
  }
  return p;
}

// ---------- Style A: procedural pixel textures ----------
function voronoi(r, count) {
  const pts = [];
  for (let i = 0; i < count; i++) pts.push({ x: r() * N, y: r() * N, a: r(), b: r(), c: r() });
  return (x, y) => {
    let d1 = 1e9, d2 = 1e9, best = null;
    for (const p of pts) {
      let dx = Math.abs(x - p.x), dy = Math.abs(y - p.y);
      if (dx > N / 2) dx = N - dx;
      if (dy > N / 2) dy = N - dy;
      const d = Math.hypot(dx, dy);
      if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
    }
    return [best, d1, d2];
  };
}
function canopy(b, r, cx, cy, rad, col, gap) {
  for (let dy = -Math.ceil(rad) - 2; dy <= Math.ceil(rad) + 2; dy++) for (let dx = -Math.ceil(rad) - 2; dx <= Math.ceil(rad) + 2; dx++) {
    const ds = Math.hypot(dx - 1.5, dy - 2);
    if (ds <= rad && Math.hypot(dx, dy) > rad) b.set(cx + dx, cy + dy, mul(gap, 0.75)); // cast shadow
  }
  for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy++) for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
    const d = Math.hypot(dx, dy);
    if (d > rad) continue;
    let f = 1 + 0.3 * ((-dx * 0.6 - dy * 0.8) / rad);
    if (d > rad - 1.1) f *= 0.78;
    if (r() < 0.14) f *= 1.13;
    b.set(cx + dx, cy + dy, mul(col, f));
  }
}
function texA(key, seed) {
  const b = pixbuf(), r = rng(seed), base = rgb(TERRAIN[key].color);
  const n = fbm(seed, N, 4, 4), idx = (x, y) => (((y % N) + N) % N) * N + (((x % N) + N) % N);
  if (key === "plains") {
    const d = fbm(seed + 7, N, 6, 3), vor = voronoi(r, 22);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, [f, d1, d2] = vor(x, y);
      let c = mul(base, (0.9 + f.a * 0.18) * (0.92 + n[i] * 0.16) * (0.96 + r() * 0.08));
      if (f.b < 0.3) c = mix(c, [150, 138, 78], 0.28);          // stubble going yellow
      else if (f.b > 0.78) c = mix(c, [92, 108, 58], 0.3);       // greener pasture
      const o = Math.floor(f.c * 5), row = o === 0 ? y : o === 1 ? x : o === 2 ? x + y : o === 3 ? x - y : -1;
      if (row >= 0 && ((row % 4) + 4) % 4 === 0) c = mul(c, 0.86); // furrows
      if (d[i] > 0.64) c = mix(c, [118, 100, 66], Math.min(0.7, (d[i] - 0.64) * 2.4)); // bare dirt
      if (d2 - d1 < 1.2) c = mix(c, [74, 84, 50], 0.38);         // hedgerow between fields
      b.set(x, y, c);
    }
    for (let k = 0; k < 800; k++) { const x = r() * N | 0, y = r() * N | 0; b.set(x, y, mul(base, 1.28)); b.set(x, y + 1, mul(base, 0.72)); }
  } else if (key === "forest") {
    const gap = mul(base, 0.6);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) b.set(x, y, mul(gap, 0.85 + n[y * N + x] * 0.3));
    const tones = [base, mix(base, [80, 112, 58], 0.35), mix(base, [52, 74, 44], 0.3), mix(base, [98, 100, 52], 0.3), mix(base, [44, 70, 54], 0.3)];
    const trees = [];
    for (let k = 0; k < 1250; k++) trees.push([r() * N, r() * N, 2.6 + r() * 3.6, tones[(r() * tones.length) | 0]]);
    trees.sort((a, c) => a[1] - c[1]);
    for (const [x, y, rad, col] of trees) canopy(b, r, Math.round(x), Math.round(y), rad, col, gap);
  } else if (key === "hills") {
    const h = fbm(seed + 3, N, 3, 4), g = fbm(seed + 11, N, 7, 3);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, sl = (h[idx(x + 1, y)] - h[idx(x - 1, y)]) + (h[idx(x, y + 1)] - h[idx(x, y - 1)]);
      let c = mul(base, clamp(1 - sl * 28, 0.72, 1.3) * (0.95 + r() * 0.1));
      if (g[i] > 0.58) c = mix(c, [104, 116, 66], Math.min(0.45, (g[i] - 0.58) * 2.5)); // grass
      const v = h[i] * 11;
      if (v - Math.floor(v) < 0.1) c = mul(c, 0.82);                                       // contour step
      b.set(x, y, c);
    }
    for (let k = 0; k < 160; k++) { const x = r() * N | 0, y = r() * N | 0; b.set(x, y, [158, 152, 136]); b.set(x + 1, y, [130, 124, 110]); b.set(x, y + 1, [70, 64, 50]); }
  } else if (key === "mountain") {
    const vor = voronoi(r, 30), g = fbm(seed + 5, N, 8, 3);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const [p, d1, d2] = vor(x, y);
      let dx = x - p.x, dy = y - p.y;
      if (dx > N / 2) dx -= N; if (dx < -N / 2) dx += N; if (dy > N / 2) dy -= N; if (dy < -N / 2) dy += N;
      let f = 0.78 + p.a * 0.42 + clamp((-dx * 0.55 - dy * 0.75) / 22, -0.3, 0.3);
      const e = d2 - d1;
      if (e < 1.3) f = 0.5; else if (e < 2.6) f *= 1.16;
      let c = mul(base, f * (0.9 + g[y * N + x] * 0.2) * (0.95 + r() * 0.1));
      if (p.b > 0.75) c = mix(c, [112, 98, 82], 0.25);
      b.set(x, y, c);
    }
  } else if (key === "water") {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      let c = mul(base, 0.86 + n[i] * 0.26);
      if (((y + Math.floor(n[i] * 14)) % 7) === 0 && Math.sin(x * 0.33 + y * 1.7 + n[i] * 9) > 0.25) c = mix(c, [128, 164, 186], 0.5);
      b.set(x, y, c);
    }
  } else if (key === "suburb") {
    const yardC = mix(base, [102, 108, 70], 0.4), roofs = [[138, 75, 50], [93, 97, 104], [110, 92, 64], [150, 140, 118], [120, 62, 48]];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, street = x % 32 < 3 || y % 32 < 3;
      b.set(x, y, street ? mul([96, 92, 86], 0.92 + r() * 0.12) : mul(yardC, 0.86 + n[i] * 0.26 + r() * 0.06));
    }
    for (let by = 0; by < N; by += 32) for (let bx = 0; bx < N; bx += 32) for (let ly = 0; ly < 2; ly++) for (let lx = 0; lx < 2; lx++) {
      const x0 = bx + 3 + lx * 14.5, y0 = by + 3 + ly * 14.5;
      if (r() < 0.08) continue; // empty lot
      const w = 6 + (r() * 3 | 0), h = 5 + (r() * 3 | 0), hx = Math.round(x0 + 1 + r() * (12 - w)), hy = Math.round(y0 + 1 + r() * (12 - h));
      const burnt = r() < 0.15, col = burnt ? [46, 41, 38] : roofs[(r() * roofs.length) | 0];
      for (let yy = 0; yy <= h; yy++) b.set(hx + w + 1, hy + yy + 1, mul(yardC, 0.62));        // shadow
      for (let xx = 0; xx <= w; xx++) b.set(hx + xx + 1, hy + h + 1, mul(yardC, 0.62));
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        let f = yy < h / 2 ? 1.1 : 0.88;
        if (yy === Math.floor(h / 2)) f = 0.72;
        if (xx === w - 1 || yy === h - 1) f *= 0.8;
        b.set(hx + xx, hy + yy, burnt && r() < 0.3 ? [96, 66, 44] : mul(col, f * (0.95 + r() * 0.1)));
      }
      if (r() < 0.5) canopy(b, r, Math.round(x0 + (hx > x0 + 6 ? 3 : 11)), Math.round(y0 + 10), 2.2, [64, 92, 52], yardC);
    }
    for (let k = 0; k < 26; k++) { // cars left in the street
      const v = r() < 0.5, s = ((r() * 8) | 0) * 32 + 1, t = (r() * N) | 0, col = [[120, 70, 50], [80, 96, 120], [176, 172, 164], [52, 48, 46]][(r() * 4) | 0];
      for (let a = 0; a < 4; a++) for (let c2 = 0; c2 < 2; c2++) b.set(v ? s + c2 : t + a, v ? t + a : s + c2, mul(col, a === 1 ? 0.6 : 1));
    }
  } else if (key === "city") {
    const asphalt = [64, 62, 60], pal = [[112, 108, 102], [88, 84, 82], [122, 112, 98], [76, 74, 74], [100, 92, 84], [128, 84, 66]];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      b.set(x, y, mul(asphalt, 0.88 + n[i] * 0.2 + r() * 0.06));
      if ((x % 32 === 1 || y % 32 === 1) && (x + y) % 6 < 3 && r() < 0.8) b.set(x, y, [128, 118, 84]); // faded lane paint
    }
    const building = (x0, y0, w, h) => {
      const col = pal[(r() * pal.length) | 0], ruin = r() < 0.18;
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
        let c = ruin ? (r() < 0.5 ? [72, 68, 64] : r() < 0.5 ? [104, 96, 86] : [40, 38, 36]) : col;
        let f = 1;
        if (!ruin) { if (xx === 0 || yy === 0) f = 1.18; else if (xx === w - 1 || yy === h - 1) f = 0.66; f *= 0.96 + r() * 0.08; }
        b.set(x0 + xx, y0 + yy, mul(c, f));
      }
      if (!ruin) for (let k = 0; k < (w * h) / 40; k++) { const ax = x0 + 2 + ((r() * (w - 4)) | 0), ay = y0 + 2 + ((r() * (h - 4)) | 0); b.set(ax, ay, [150, 150, 146]); b.set(ax + 1, ay, [150, 150, 146]); b.set(ax, ay + 1, [60, 60, 60]); b.set(ax + 1, ay + 1, [60, 60, 60]); }
      for (let yy = 0; yy < h; yy++) b.set(x0 + w, y0 + yy + 1, [34, 32, 31]); // shadow
      for (let xx = 0; xx < w; xx++) b.set(x0 + xx + 1, y0 + h, [34, 32, 31]);
    };
    const split = (x0, y0, w, h, depth) => {
      if (depth > 0 && (w > 10 || h > 10) && r() < 0.85) {
        if (w >= h) { const s = Math.round(w * (0.35 + r() * 0.3)); split(x0, y0, s - 1, h, depth - 1); split(x0 + s, y0, w - s, h, depth - 1); }
        else { const s = Math.round(h * (0.35 + r() * 0.3)); split(x0, y0, w, s - 1, depth - 1); split(x0, y0 + s, w, h - s, depth - 1); }
      } else building(x0, y0, w - 1, h - 1);
    };
    for (let by = 0; by < N; by += 32) for (let bx = 0; bx < N; bx += 32) split(bx + 4, by + 4, 27, 27, 2);
    for (let k = 0; k < 600; k++) { const x = (r() * N) | 0, y = (r() * N) | 0; if (x % 32 < 4 || y % 32 < 4) b.set(x, y, r() < 0.5 ? [110, 102, 92] : [40, 38, 36]); } // rubble
    for (let k = 0; k < 30; k++) { // cracks
      let x = r() * N, y = r() * N, a = r() * 6.28;
      for (let s = 0; s < 14; s++) { b.set(x, y, [36, 34, 32]); a += (r() - 0.5) * 1.2; x += Math.cos(a); y += Math.sin(a); }
    }
  }
  return b.canvas();
}
function snowA(seed) {
  const b = pixbuf(), r = rng(seed), n = fbm(seed, N, 12, 3), m = fbm(seed + 1, N, 32, 2);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, a = clamp(0.3 + (n[i] - 0.5) * 1.1 + (m[i] - 0.5) * 0.5, 0.05, 0.8);
    const sparkle = r() < 0.025;
    b.set(x, y, sparkle ? [255, 255, 255] : mix([206, 216, 228], [242, 245, 250], n[i]), Math.round((sparkle ? 0.95 : a) * 255));
  }
  return b.canvas();
}
function infectA(seed) {
  const b = pixbuf(), r = rng(seed), n = fbm(seed, N, 5, 4), v = fbm(seed + 9, N, 4, 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (Math.abs(v[i] - 0.5) < 0.012) b.set(x, y, [70, 6, 12], 220);                  // veins
    else if (n[i] > 0.56) b.set(x, y, mix([120, 18, 24], [70, 8, 14], r()), Math.round(clamp((n[i] - 0.56) * 5, 0, 1) * 200)); // stains
  }
  return b.canvas();
}

// ---------- Style B: decal sprites (pixel art, 1 sprite px = 1 world px like the site sprites) ----------
const UP = 4;
function sprite(w, h, paint) {
  const px = new Array(w * h).fill(null);
  const p = {
    w, h,
    set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < w && y < h && c) px[y * w + x] = c; },
    get(x, y) { return x >= 0 && y >= 0 && x < w && y < h ? px[y * w + x] : null; },
    rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p.set(x, y, c); },
    disc(cx, cy, rad, fn) { for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) { const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy <= rad * rad) p.set(x, y, fn(dx / rad, dy / rad)); } },
  };
  paint(p);
  const out = (snow) => {
    const cv = mk(w * UP, h * UP), c = cv.getContext("2d");
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = px[y * w + x];
      if (!v) continue;
      if (snow && v[4] !== "noSnow" && (y === 0 || !px[(y - 1) * w + x] || (y > 1 && !px[(y - 2) * w + x] && v[3] == null))) v = [236, 240, 246, v[3]];
      c.fillStyle = css(v, v[3] ?? 1);
      c.fillRect(x * UP, y * UP, UP, UP);
    }
    return cv;
  };
  return { w, h, cv: out(false), snow: out(true) };
}
const SH = [0, 0, 0, 0.28, "noSnow"]; // soft shadow pixel
function shadow(p, cx, cy, rx, ry) { for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) p.set(cx + x, cy + y, SH); }
function makeDecals(seed) {
  const r = rng(seed), D = {};
  const shadeDisc = (dark, mid, light, hi) => (dx, dy) => { const s = -dx * 0.6 - dy * 0.8, d = Math.hypot(dx, dy); return d > 0.82 ? dark : s > 0.55 ? hi : s > 0.05 ? light : s > -0.45 ? mid : dark; };
  const greens = [[[34, 54, 32], [56, 84, 46], [78, 112, 58], [104, 136, 72]], [[40, 52, 30], [66, 82, 44], [92, 108, 56], [118, 130, 70]], [[50, 46, 28], [92, 84, 44], [126, 110, 54], [150, 132, 70]]];
  D.tree = greens.map((g) => sprite(11, 12, (p) => { shadow(p, 6, 10, 4, 1); p.rect(5, 8, 5, 10, [86, 62, 40]); p.disc(5, 4.5, 4.6, shadeDisc(...g)); }));
  D.pine = [0, 1].map((v) => sprite(9, 13, (p) => {
    shadow(p, 5, 11, 3, 1);
    p.rect(4, 10, 4, 11, [80, 58, 38]);
    for (let y = 0; y < 10; y++) { const hw = Math.floor(y * 0.42) + (y % 3 === 2 ? 1 : 0); for (let x = -hw; x <= hw; x++) p.set(4 + x, y, x < 0 ? (v ? [52, 78, 56] : [48, 72, 46]) : x === 0 ? [40, 62, 40] : [28, 46, 32]); }
  }));
  D.bush = [sprite(7, 5, (p) => { shadow(p, 4, 4, 3, 1); p.disc(3, 2.2, 2.6, shadeDisc([40, 56, 34], [62, 86, 48], [84, 110, 60], [104, 130, 70])); })];
  D.tuft = [sprite(5, 4, (p) => { p.set(1, 1, [96, 120, 62]); p.set(1, 2, [72, 94, 48]); p.set(2, 0, [110, 134, 70]); p.set(2, 1, [86, 110, 56]); p.set(2, 2, [72, 94, 48]); p.set(3, 1, [96, 120, 62]); p.set(3, 2, [72, 94, 48]); p.set(2, 3, SH); })];
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
  D.rubble = [0, 1].map(() => sprite(9, 5, (p) => { shadow(p, 4, 4, 4, 1); for (let k = 0; k < 16; k++) { const x = 1 + ((r() * 7) | 0), y = 1 + ((r() * 3) | 0); p.set(x, y, [[110, 104, 96], [86, 80, 74], [128, 92, 70], [62, 58, 54]][(r() * 4) | 0]); } }));
  const roofCols = [[138, 75, 50], [93, 97, 104], [110, 92, 64], [120, 62, 48]];
  D.house = roofCols.map((roof, i) => sprite(12, 11, (p) => {
    shadow(p, 7, 10, 5, 1);
    p.rect(1, 5, 10, 9, [185, 169, 138]); p.rect(1, 9, 10, 9, [150, 136, 110]);
    p.rect(3, 6, 4, 7, [44, 46, 50]); p.rect(7, 7, 8, 9, [64, 50, 40]);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 12; x++) if (Math.abs(x - 5.5) <= 3.5 + y * 0.6) p.set(x, y, mul(roof, y === 0 ? 1.2 : y < 3 ? 1 : 0.82));
    if (i === 3) { p.rect(5, 0, 9, 3, [40, 36, 34]); p.set(6, 1, [150, 80, 40]); p.rect(9, 5, 10, 8, [52, 48, 44]); } // burnt
  }));
  const wall = [[150, 148, 140], [138, 86, 64], [86, 94, 104], [120, 114, 104]];
  D.building = wall.map((w, i) => sprite(14, 16, (p) => {
    shadow(p, 8, 15, 6, 1);
    const roof = mul(w, 0.78);
    p.rect(1, 0, 12, 5, roof); p.rect(1, 0, 12, 0, mul(roof, 1.2)); p.set(4, 2, [170, 170, 166]); p.set(5, 2, [170, 170, 166]); p.set(9, 3, [60, 60, 62]);
    p.rect(1, 6, 12, 14, w); p.rect(1, 6, 12, 6, mul(w, 0.7));
    for (let y = 8; y < 14; y += 2) for (let x = 2; x < 12; x += 2) p.set(x, y, r() < 0.15 ? [150, 160, 170] : [36, 40, 46]);
    if (i === 3) { for (let x = 8; x <= 12; x++) for (let y = 0; y <= 3; y++) p.set(x, y, r() < 0.5 ? [52, 48, 44] : [92, 86, 80]); p.rect(8, 4, 12, 4, [40, 36, 34]); }
  }));
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
  D.reeds = [sprite(6, 6, (p) => { for (const x of [1, 3, 4]) for (let y = 1 + (x & 1); y < 6; y++) p.set(x, y, y < 3 ? [120, 128, 70] : [76, 96, 54]); p.set(3, 0, [110, 84, 50]); })];
  D.ripple = [sprite(9, 3, (p) => { for (const [x, y] of [[0, 1], [1, 1], [2, 0], [3, 0], [5, 2], [6, 2], [7, 1]]) p.set(x, y, [128, 166, 190, 0.7]); })];
  return D;
}
// What goes on each terrain: [decal set, count range, min spacing]. Counts are per tile, drawn in y order.
const DECAL_RULES = {
  forest: [["tree", 5, 7], ["pine", 2, 4], ["bush", 0, 1]],
  plains: [["crops", 0, 1, 0.6], ["tuft", 1, 3], ["fence", 0, 1, 0.3], ["tree", 0, 1, 0.25], ["hay", 0, 1, 0.2], ["deadtree", 0, 1, 0.08]],
  hills: [["mound", 2, 3], ["rock", 1, 2], ["tuft", 0, 2], ["tree", 0, 1, 0.25]],
  mountain: [["peak", 2, 2], ["rock", 1, 3]],
  suburb: [["house", 3, 4], ["tree", 0, 2], ["car", 0, 1, 0.4], ["fence", 0, 1, 0.3]],
  city: [["building", 3, 4], ["rubble", 1, 2], ["car", 0, 1, 0.5]],
  water: [["ripple", 1, 2]],
};
// Decal placements for every tile of a world (once per world, like render.js geometry()): per tile a run of
// [set, variant, dx, dy, scale] (foot point offsets from the tile center).
export function placeDecals(W) {
  const SETS = Object.keys(makeDecalsKeys);
  const runs = new Int32Array(W.n + 1), items = [];
  for (let i = 0; i < W.n; i++) {
    runs[i] = items.length / 5;
    const r = rng(hash(i, 991)), key = TKEYS[W.T[i]], rules = DECAL_RULES[key] || [];
    const want = [];
    for (const [set, lo, hi, p = 1] of rules) { if (r() > p) continue; const k = lo + Math.floor(r() * (hi - lo + 1)); for (let a = 0; a < k; a++) want.push(set); }
    const pts = [], clear = W.site[i] ? 15 : 0;
    for (const set of want) {
      let best = null;
      for (let t = 0; t < 14; t++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 17, x = Math.cos(a) * d, y = Math.sin(a) * d * 0.95;
        if (Math.hypot(x, y) < clear) continue;
        const sp = Math.min(...pts.map((q) => Math.hypot(q[0] - x, q[1] - y)), 99);
        if (!best || sp > best[2]) best = [x, y, sp];
        if (sp > 9) break;
      }
      if (best) pts.push([best[0], best[1], set]);
    }
    // Reeds along the banks: water tiles next to land get a clump on that side.
    if (key === "water") for (let d = 0; d < 6; d++) {
      const m = W.nb[i * 6 + d];
      if (m < 0 || W.T[m] === TI.water || r() > 0.55) continue;
      const ang = (-60 * d * Math.PI) / 180;
      pts.push([Math.cos(ang) * 15 + (r() - 0.5) * 8, Math.sin(ang) * 15 + (r() - 0.5) * 6, "reeds"]);
    }
    pts.sort((a, b) => a[1] - b[1]);
    for (const [x, y, set] of pts) items.push(SETS.indexOf(set), (r() * 8) | 0, x, y + 6, (0.85 + r() * 0.3) * 1000);
  }
  runs[W.n] = items.length / 5;
  W.decals = { runs, items: new Float32Array(items), sets: SETS };
}
const makeDecalsKeys = { tree: 1, pine: 1, bush: 1, tuft: 1, rock: 1, crops: 1, fence: 1, hay: 1, deadtree: 1, car: 1, rubble: 1, house: 1, building: 1, peak: 1, mound: 1, reeds: 1, ripple: 1 };

// ---------- Style C: painterly textures and edge fringes ----------
function texC(key, seed, R) {
  const r = rng(seed), base = rgb(TERRAIN[key].color);
  // A smooth light/shade layer from noise (soft relief), drawn first and scaled up smoothly.
  const relief = (cells, k, ridged) => {
    const M = 128, h = fbm(seed + 21, M, cells, 4), b = pixbuf(M);
    const id = (x, y) => (((y % M) + M) % M) * M + (((x % M) + M) % M);
    for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
      let v = h[id(x, y)], vx = h[id(x + 1, y)], vy = h[id(x, y + 1)];
      if (ridged) { v = 1 - Math.abs(2 * v - 1); vx = 1 - Math.abs(2 * vx - 1); vy = 1 - Math.abs(2 * vy - 1); }
      const sl = (vx - v) + (vy - v);
      b.set(x, y, mul(base, clamp(1 - sl * k + (v - 0.5) * 0.2, 0.68, 1.32)));
    }
    return b.canvas();
  };
  return painted(R, (c, wrap) => {
    c.fillStyle = css(base);
    c.fillRect(0, 0, P, P);
    if (key === "hills") c.drawImage(relief(3, 9, false), 0, 0, P, P);
    if (key === "mountain") c.drawImage(relief(3, 12, true), 0, 0, P, P);
    if (key === "water") c.drawImage(relief(2, 3, false), 0, 0, P, P);
    c.filter = `blur(${(1.4 * R).toFixed(1)}px)`;
    const tints = { plains: [[150, 150, 84], [104, 122, 60], [132, 112, 72]], forest: [[70, 98, 56], [46, 66, 40], [84, 90, 50]], hills: [[140, 128, 90], [100, 108, 68]], mountain: [[140, 136, 128], [86, 82, 80]], water: [[70, 110, 136], [36, 64, 86]], suburb: [[150, 142, 124], [116, 118, 92]], city: [[110, 104, 98], [70, 66, 64]] }[key];
    for (let k = 0; k < 150; k++) {
      const x = r() * P, y = r() * P, rx = 10 + r() * 26, ry = rx * (0.35 + r() * 0.4), rot = key === "water" ? (r() - 0.5) * 0.2 : r() * Math.PI;
      c.fillStyle = css(tints[(r() * tints.length) | 0], 0.1 + r() * 0.1);
      wrap(x, y, rx, (X, Y) => { c.beginPath(); c.ellipse(X, Y, rx, key === "water" ? ry * 0.25 : ry, rot, 0, Math.PI * 2); c.fill(); });
    }
    if (key === "plains") for (let k = 0; k < 16; k++) { // patchwork fields
      const x = r() * P, y = r() * P, w = 26 + r() * 40, h = 20 + r() * 30, rot = (r() - 0.5) * 0.5, col = tints[(r() * 3) | 0];
      wrap(x, y, 60, (X, Y) => { c.save(); c.translate(X, Y); c.rotate(rot); c.fillStyle = css(col, 0.22); c.fillRect(-w / 2, -h / 2, w, h); c.strokeStyle = css([80, 88, 50], 0.2); c.lineWidth = 1.2; c.strokeRect(-w / 2, -h / 2, w, h); c.restore(); });
    }
    c.filter = "none";
    if (key === "plains" || key === "hills") for (let k = 0; k < 1400; k++) { // brushed grass
      const x = r() * P, y = r() * P, l = 2 + r() * 3, a = -1.2 + (r() - 0.5) * 0.6, light = r() < 0.5;
      c.strokeStyle = light ? css(mix(base, [200, 200, 140], 0.35), 0.28) : css(mul(base, 0.72), 0.28);
      c.lineWidth = 0.9;
      wrap(x, y, l, (X, Y) => { c.beginPath(); c.moveTo(X, Y); c.lineTo(X + Math.cos(a) * l, Y + Math.sin(a) * l); c.stroke(); });
    }
    if (key === "forest") {
      const trees = [];
      for (let k = 0; k < 700; k++) trees.push([r() * P, r() * P, 3.5 + r() * 4.5, r()]);
      trees.sort((a, b) => a[1] - b[1]);
      for (const [x, y, rad, t] of trees) wrap(x, y, rad + 3, (X, Y) => {
        c.fillStyle = "rgba(10,20,10,0.22)";
        c.beginPath(); c.arc(X + 1.6, Y + 2.4, rad, 0, Math.PI * 2); c.fill();
        const g = c.createRadialGradient(X - rad * 0.35, Y - rad * 0.4, rad * 0.1, X, Y, rad);
        const tone = t < 0.33 ? [72, 102, 58] : t < 0.66 ? [62, 92, 52] : [84, 96, 54];
        g.addColorStop(0, css(mix(tone, [170, 190, 120], 0.25)));
        g.addColorStop(0.55, css(tone));
        g.addColorStop(1, css(mul(tone, 0.62)));
        c.fillStyle = g;
        c.beginPath(); c.arc(X, Y, rad, 0, Math.PI * 2); c.fill();
      });
    }
    if (key === "suburb" || key === "city") {
      const step = 32, street = key === "city" ? 4 : 3;
      c.fillStyle = css(key === "city" ? [58, 56, 54] : [100, 96, 90], 0.55);
      for (let k = 0; k < P; k += step) { c.fillRect(k, 0, street, P); c.fillRect(0, k, P, street); }
      c.filter = `blur(${(0.5 * R).toFixed(1)}px)`;
      for (let by = 0; by < P; by += step) for (let bx = 0; bx < P; bx += step) {
        const cnt = key === "city" ? 3 : 4;
        for (let q = 0; q < cnt; q++) {
          const w = key === "city" ? 9 + r() * 10 : 6 + r() * 3, h = key === "city" ? 8 + r() * 10 : 5 + r() * 2;
          const x = bx + street + 1 + r() * (step - street - 2 - w), y = by + street + 1 + r() * (step - street - 2 - h);
          const col = key === "city" ? [[118, 112, 106], [92, 88, 86], [128, 90, 72], [80, 78, 78]][(r() * 4) | 0] : [[138, 75, 50], [93, 97, 104], [110, 92, 64], [60, 54, 50]][(r() * 4) | 0];
          c.fillStyle = "rgba(0,0,0,0.25)"; c.fillRect(x + 1.2, y + 1.6, w, h);
          c.fillStyle = css(col, 0.9); c.fillRect(x, y, w, h);
          c.fillStyle = "rgba(255,240,220,0.12)"; c.fillRect(x, y, w, h * 0.45);
        }
      }
      c.filter = "none";
    }
    if (key === "water") for (let k = 0; k < 70; k++) {
      const x = r() * P, y = r() * P, w = 6 + r() * 14;
      c.strokeStyle = "rgba(170,205,225,0.18)"; c.lineWidth = 0.8;
      wrap(x, y, w, (X, Y) => { c.beginPath(); c.moveTo(X - w, Y); c.quadraticCurveTo(X, Y - 1.5, X + w, Y); c.stroke(); });
    }
  });
}
function snowC(seed, R) {
  const r = rng(seed);
  return painted(R, (c, wrap) => {
    c.fillStyle = "rgba(236,241,248,0.3)";
    c.fillRect(0, 0, P, P);
    c.filter = `blur(${(1.2 * R).toFixed(1)}px)`;
    for (let k = 0; k < 260; k++) {
      const x = r() * P, y = r() * P, rad = 3 + r() * 9, light = r() < 0.6;
      c.fillStyle = light ? css([246, 248, 252], 0.35 + r() * 0.3) : css([150, 165, 185], 0.12 + r() * 0.12);
      wrap(x, y, rad, (X, Y) => { c.beginPath(); c.ellipse(X, Y, rad, rad * 0.45, (r() - 0.5) * 0.6, 0, Math.PI * 2); c.fill(); });
    }
    c.filter = "none";
  });
}
function infectC(seed, R) {
  const r = rng(seed);
  return painted(R, (c, wrap) => {
    c.filter = `blur(${(1.5 * R).toFixed(1)}px)`;
    for (let k = 0; k < 70; k++) {
      const x = r() * P, y = r() * P, rad = 4 + r() * 14;
      c.fillStyle = css([110, 14, 22], 0.25 + r() * 0.35);
      wrap(x, y, rad, (X, Y) => { c.beginPath(); c.ellipse(X, Y, rad, rad * (0.4 + r() * 0.5), r() * 3, 0, Math.PI * 2); c.fill(); });
    }
    c.filter = "none";
  });
}
// Which terrain bleeds over which (higher over lower) and how deep (world px).
const PRIO = { water: 0, plains: 1, suburb: 2, city: 3, hills: 4, forest: 5, mountain: 6 };
const DEPTH = { water: 0, plains: 5, suburb: 4, city: 4, hills: 6, forest: 7, mountain: 7 };
const TALL = new Set(["forest", "mountain", "city"]);
const K = 10;
// Fringe outlines per (terrain, dir, variant): K+1 points beyond the tile's edge, relative to its center.
function fringeShapes() {
  const out = {};
  for (const key of TKEYS) {
    out[key] = [];
    for (let d = 0; d < 6; d++) for (let v = 0; v < 4; v++) {
      const r = rng(hash(d * 31 + v, PRIO[key])), a = HEX_CORNERS[(6 - d) % 6], b = HEX_CORNERS[(7 - d) % 6];
      const th = (-60 * d * Math.PI) / 180, nx = Math.cos(th), ny = Math.sin(th);
      const ph = r() * 6.28, ph2 = r() * 6.28, pts = new Float32Array((K + 1) * 2), foam = new Float32Array((K + 1) * 2);
      for (let k = 0; k <= K; k++) {
        const t = k / K, taper = Math.pow(Math.sin(Math.PI * t), 0.6);
        const dep = taper * DEPTH[key] * (0.75 + 0.35 * Math.sin(ph + t * 9) + 0.2 * Math.sin(ph2 + t * 23)) + (k && k < K ? (r() - 0.5) * 1.4 : 0);
        const ex = (a[0] + (b[0] - a[0]) * t) * HEX, ey = (a[1] + (b[1] - a[1]) * t) * HEX;
        pts[k * 2] = ex + nx * dep; pts[k * 2 + 1] = ey + ny * dep;
        foam[k * 2] = ex + nx * (dep + 1.6 * taper); foam[k * 2 + 1] = ey + ny * (dep + 1.6 * taper);
      }
      out[key].push({ pts, foam });
    }
  }
  return out;
}
export function prepFringes(W) {
  const mask = new Uint8Array(W.n);
  for (let i = 0; i < W.n; i++) {
    const p = PRIO[TKEYS[W.T[i]]];
    for (let d = 0; d < 6; d++) { const m = W.nb[i * 6 + d]; if (m >= 0 && PRIO[TKEYS[W.T[m]]] < p) mask[i] |= 1 << d; }
  }
  W.fmask = mask;
  W.fshapes = W.fshapes || fringeShapes();
}
function addPoly(ctx, x, y, pts, close) {
  ctx.moveTo(x + pts[0], y + pts[1]);
  for (let k = 2; k < pts.length; k += 2) ctx.lineTo(x + pts[k], y + pts[k + 1]);
  if (close) ctx.closePath();
}

// ---------- Style D: tactical map ----------
const PAPER = [178, 174, 158];
const mutedOf = (hex) => { const c = rgb(hex), l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11; return mix(mix([l, l, l], c, 0.55), PAPER, 0.16); };
function contours(c, seed, cells, levels, ink, bold) {
  const M = 96, h = fbm(seed, M, cells, 3), cs = P / M, at = (x, y) => h[(((y % M) + M) % M) * M + (((x % M) + M) % M)];
  levels.forEach((l, li) => {
    c.beginPath();
    for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
      const v0 = at(x, y), v1 = at(x + 1, y), v2 = at(x + 1, y + 1), v3 = at(x, y + 1);
      const pts = [];
      const edge = (va, vb, xa, ya, xb, yb) => { if ((va < l) !== (vb < l)) { const t = (l - va) / (vb - va); pts.push([(xa + (xb - xa) * t) * cs, (ya + (yb - ya) * t) * cs]); } };
      edge(v0, v1, x, y, x + 1, y); edge(v1, v2, x + 1, y, x + 1, y + 1); edge(v2, v3, x + 1, y + 1, x, y + 1); edge(v3, v0, x, y + 1, x, y);
      for (let k = 0; k + 1 < pts.length; k += 2) { c.moveTo(pts[k][0], pts[k][1]); c.lineTo(pts[k + 1][0], pts[k + 1][1]); }
    }
    c.strokeStyle = ink;
    c.lineWidth = bold && li % 4 === 0 ? 1.1 : 0.55;
    c.stroke();
  });
}
function hatch(c, step, angle, ink, lw) {
  c.save();
  c.beginPath();
  c.rect(0, 0, P, P);
  c.clip();
  c.strokeStyle = ink;
  c.lineWidth = lw;
  c.beginPath();
  // Lines at 45° with a step that divides P along x keep the pattern seamless.
  for (let k = -P; k <= 2 * P; k += step) {
    if (angle > 0) { c.moveTo(k, 0); c.lineTo(k + P, P); } else { c.moveTo(k, 0); c.lineTo(k - P, P); }
  }
  c.stroke();
  c.restore();
}
function texD(key, seed, R) {
  const r = rng(seed), base = mutedOf(TERRAIN[key].color), ink = css(mul(base, 0.5), 0.85);
  return painted(R, (c, wrap) => {
    c.fillStyle = css(base);
    c.fillRect(0, 0, P, P);
    if (key === "forest") {
      c.strokeStyle = css([38, 62, 36], 0.9); c.lineWidth = 0.7;
      for (let y = 0; y < P; y += 8) for (let x = 0; x < P; x += 8) {
        const X = x + ((y / 8) % 2) * 4 + (r() - 0.5) * 2.5, Y = y + (r() - 0.5) * 2.5;
        wrap(X, Y, 3, (a, b) => { c.beginPath(); c.arc(a, b, 1.9, 0, Math.PI * 2); c.stroke(); });
      }
    } else if (key === "hills") contours(c, seed, 3, [0.32, 0.4, 0.48, 0.56, 0.64, 0.72], css([96, 72, 42], 0.8), false);
    else if (key === "mountain") contours(c, seed, 3, Array.from({ length: 14 }, (_, i) => 0.22 + i * 0.045), css([80, 58, 36], 0.85), true);
    else if (key === "water") { c.strokeStyle = css([150, 180, 200], 0.35); c.lineWidth = 0.5; c.beginPath(); for (let y = 2; y < P; y += 5) { c.moveTo(0, y); c.lineTo(P, y); } c.stroke(); }
    else if (key === "suburb") hatch(c, 8, 1, ink, 0.6);
    else if (key === "city") { hatch(c, 4, 1, ink, 0.7); hatch(c, 4, -1, ink, 0.7); }
    else if (key === "plains") {
      c.strokeStyle = css([96, 104, 64], 0.45); c.lineWidth = 0.6;
      for (let k = 0; k < 110; k++) { const x = r() * P, y = r() * P; wrap(x, y, 4, (a, b) => { c.beginPath(); c.moveTo(a - 1.5, b); c.lineTo(a - 1.5, b - 2); c.moveTo(a, b); c.lineTo(a, b - 3); c.moveTo(a + 1.5, b); c.lineTo(a + 1.5, b - 2); c.stroke(); }); }
    }
  });
}
function snowD(seed, R) {
  const r = rng(seed);
  return painted(R, (c, wrap) => {
    c.strokeStyle = "rgba(236,242,250,0.9)"; c.lineWidth = 0.6;
    for (let y = 0; y < P; y += 16) for (let x = 0; x < P; x += 16) {
      const X = x + ((y / 16) % 2) * 8 + (r() - 0.5) * 2, Y = y + (r() - 0.5) * 2;
      wrap(X, Y, 3, (a, b) => { c.beginPath(); c.moveTo(a - 1.6, b); c.lineTo(a + 1.6, b); c.moveTo(a, b - 1.6); c.lineTo(a, b + 1.6); c.stroke(); });
    }
  });
}
const infectD = (seed, R) => painted(R, (c) => hatch(c, 8, -1, "rgba(200,30,30,0.9)", 1.2));

// ---------- the styles ----------
const gameFlat = TKEYS.map((k) => css(rgb(TERRAIN[k].color)));
const dFlat = TKEYS.map((k) => css(mutedOf(TERRAIN[k].color)));
const ROAD_TODAY = [["#cdbb8a", 2.6]];
export const STYLES = [
  {
    key: "flat", name: "Today (flat colors)", short: "Today",
    blurb: "The map as it is now: one color per terrain, darkened for reported and unknown tiles.",
    flat: gameFlat, build: () => ({ bytes: 0 }), roads: ROAD_TODAY,
  },
  {
    key: "A", name: "A. Pixel ground", short: "A Pixel",
    blurb: "Procedural pixel textures per terrain (1 texel = 1 world px, the same pixel size as the site sprites): furrowed fields and hedgerows, clustered tree canopies, contour-stepped hills, cracked rock, rippled water, roofs and streets.",
    flat: gameFlat,
    build(R) {
      const terr = TKEYS.map((k, i) => scaled(texA(k, 101 + i * 17), R, false));
      const snow = scaled(snowA(77), R, false), infect = scaled(infectA(55), R, false);
      return { terr, snow, infect, bytes: bytesOf([...terr, snow, infect]) };
    },
    snowWash: 0.06,
    roads: [["#2c2a27", 4.4], ["#5f5b55", 3.2], ["#b8a060", 0.55, [3, 4]]],
  },
  {
    key: "B", name: "B. Scattered decals", short: "B Decals",
    blurb: "Today's flat colors plus a few small pixel sprites per tile (trees, rocks, crop patches, fences, hay, wrecks, houses, ruins, peaks), placed once per world by a per-tile seed; snow caps on every sprite in snow.",
    flat: gameFlat,
    // One atlas per zoom bucket: every decal (and its snowy twin) pre-scaled to R device px per sprite px, so a
    // chunk draws sub-images of one canvas with no resampling work beyond a plain copy.
    build(R) {
      const D = makeDecals(4242), R1 = R || 1, Wa = 256 * R1, pad = 1, at = [];
      const sets = Object.keys(makeDecalsKeys), cells = [];
      let x = 0, y = 0, rowH = 0;
      for (const key of sets) for (const sp of D[key]) for (const v of [0, 1]) {
        const w = sp.w * R1, h = sp.h * R1;
        if (x + w > Wa) { x = 0; y += rowH + pad; rowH = 0; }
        cells.push([sp, v, x, y, w, h]);
        x += w + pad; rowH = Math.max(rowH, h);
      }
      const atlas = mk(Wa, y + rowH), c = atlas.getContext("2d");
      c.imageSmoothingEnabled = false;
      for (const [sp, v, ax, ay, w, h] of cells) c.drawImage(v ? sp.snow : sp.cv, ax, ay, w, h);
      for (const key of sets) at.push(D[key].map((sp) => { const a = cells.find((q) => q[0] === sp && !q[1]), b = cells.find((q) => q[0] === sp && q[1]); return [a[2], a[3], b[2], b[3], a[4], a[5], sp.w, sp.h]; }));
      return { atlas, at, R: R1, bytes: bytesOf([atlas]) };
    },
    prep: placeDecals, reach: HEX + 12,
    snowWash: 0.22,
    roads: [["rgba(40,34,24,0.55)", 4.2], ["#cdbb8a", 2.6]],
    detail(ctx, W, list, n, tex, o) {
      if (o.far) return;
      const { runs, items } = W.decals, at = tex.at, A = tex.atlas;
      ctx.imageSmoothingEnabled = o.S < tex.R * 0.99;
      ctx.imageSmoothingQuality = "low";
      for (let a = 0; a < n; a++) {
        const id = list[a], x = W.X[id], y = W.Y[id], snow = W.snow[id] && W.T[id] !== TI.water;
        for (let k = runs[id]; k < runs[id + 1]; k++) {
          const j = k * 5, set = at[items[j]], s = set[items[j + 1] % set.length], sc = items[j + 4] / 1000;
          const w = s[6] * sc, h = s[7] * sc;
          ctx.drawImage(A, snow ? s[2] : s[0], snow ? s[3] : s[1], s[4], s[5], x + items[j + 2] - w / 2, y + items[j + 3] - h, w, h);
        }
      }
      ctx.imageSmoothingEnabled = true;
    },
  },
  {
    key: "C", name: "C. Painterly with edge blending", short: "C Painterly",
    blurb: "Soft brushed textures; each terrain bleeds a wobbly fringe into lower neighbours so hexes stop looking like stickers; shadow on the south-east side of forests, mountains and cities; shallows and foam along every shore.",
    flat: gameFlat,
    build(R) {
      const terr = TKEYS.map((k, i) => texC(k, 300 + i * 13, R));
      const snow = snowC(91, R), infect = infectC(37, R);
      return { terr, snow, infect, bytes: bytesOf([...terr, snow, infect]) };
    },
    prep: prepFringes, reach: HEX + 10, farDetail: true,
    snowWash: 0.05,
    roads: [["rgba(60,46,30,0.35)", 6], ["#b9a77c", 2.8], ["rgba(255,240,200,0.25)", 1]],
    detail(ctx, W, list, n, tex, o) {
      const sh = W.fshapes, X = W.X, Y = W.Y, byT = o.byT;
      // Lowest terrain first, so higher ones (forest, mountains) lie over the fringes of lower ones.
      const order = TKEYS.map((k, i) => i).sort((a, b) => PRIO[TKEYS[a]] - PRIO[TKEYS[b]]);
      for (const ti of order) {
        const key = TKEYS[ti], ids = byT[ti];
        if (!ids.length || !DEPTH[key]) continue;
        const shapes = sh[key];
        const each = (fn) => { for (const id of ids) { const m = W.fmask[id]; if (!m) continue; for (let d = 0; d < 6; d++) if (m & (1 << d)) fn(id, d, shapes[d * 4 + (hash(id, d) & 3)], W.nb[id * 6 + d]); } };
        // Shallows: a lighter band in the water just off the shore.
        if (!o.far) {
          ctx.beginPath();
          each((id, d, s, m) => { if (W.T[m] === TI.water) addPoly(ctx, X[id], Y[id], s.pts, false); });
          ctx.strokeStyle = "rgba(150,190,205,0.22)"; ctx.lineWidth = 7; ctx.stroke();
        }
        // Ambient occlusion: tall terrain throws a soft shadow onto lower land to its south-east.
        if (TALL.has(key) && !o.far) {
          ctx.beginPath();
          each((id, d, s) => { if (d === 0 || d === 4 || d === 5) addPoly(ctx, X[id] + 1.2, Y[id] + 2, s.pts, false); });
          ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = 4; ctx.stroke();
        }
        ctx.beginPath();
        each((id, d, s) => addPoly(ctx, X[id], Y[id], s.pts, true));
        ctx.fillStyle = o.far ? this.flat[ti] : pattern(ctx, tex.terr[ti]);
        ctx.fill();
        if (!o.far) {
          ctx.beginPath();
          each((id, d, s) => addPoly(ctx, X[id], Y[id], s.pts, false));
          ctx.strokeStyle = css(mul(rgb(TERRAIN[key].color), 0.7), 0.35); ctx.lineWidth = 0.8; ctx.stroke();
          ctx.beginPath();
          each((id, d, s, m) => { if (W.T[m] === TI.water) addPoly(ctx, X[id], Y[id], s.foam, false); });
          ctx.strokeStyle = "rgba(225,236,236,0.55)"; ctx.lineWidth = 1; ctx.stroke();
        }
      }
    },
  },
  {
    key: "D", name: "D. Tactical map", short: "D Tactical",
    blurb: "A muted paper-map palette with ink symbols: tree rings for forest, contour lines for hills and mountains, hatching for built-up land, waterlining, hex grid hairlines, red roads, blue shorelines and a red hatch over infected ground.",
    flat: dFlat,
    build(R) {
      const terr = TKEYS.map((k, i) => texD(k, 500 + i * 7, R));
      const snow = snowD(3, R), infect = infectD(1, R);
      return { terr, snow, infect, bytes: bytesOf([...terr, snow, infect]) };
    },
    snowWash: 0.2, infWash: 0.35, infAlpha: 1.6,
    roads: [["#2a2826", 3.6], ["#c44a3a", 2]],
    detail(ctx, W, list, n, tex, o) {
      const X = W.X, Y = W.Y;
      ctx.beginPath();
      for (let a = 0; a < n; a++) {
        const id = list[a];
        if (W.T[id] !== TI.water) continue;
        for (let d = 0; d < 6; d++) {
          const m = W.nb[id * 6 + d];
          if (m < 0 || W.T[m] === TI.water) continue;
          const c0 = HEX_CORNERS[(6 - d) % 6], c1 = HEX_CORNERS[(7 - d) % 6];
          ctx.moveTo(X[id] + c0[0] * HEX, Y[id] + c0[1] * HEX);
          ctx.lineTo(X[id] + c1[0] * HEX, Y[id] + c1[1] * HEX);
        }
      }
      ctx.strokeStyle = "rgba(28,56,84,0.9)"; ctx.lineWidth = o.far ? 1.8 : 1.2; ctx.stroke();
      if (o.far) return;
      ctx.beginPath();
      for (let a = 0; a < n; a++) hexSub(ctx, X[list[a]], Y[list[a]], HEX);
      ctx.strokeStyle = "rgba(30,28,22,0.2)"; ctx.lineWidth = 0.6; ctx.stroke();
    },
  },
];

// ---------- the ground pass (what render.js drawGround would become) ----------
const byTerr = TKEYS.map(() => []);
// ctx: transform = world -> device (scale S). list[0..n): tiles to draw (render.js geo.list); roads: road tiles.
// o: { S, far } far = zoomed out (flat colors, no textures).
export function drawGround(ctx, style, W, list, n, roads, nr, tex, o) {
  const X = W.X, Y = W.Y;
  for (const b of byTerr) b.length = 0;
  for (let a = 0; a < n; a++) byTerr[W.T[list[a]]].push(list[a]);
  o.byT = byTerr;
  // 1. Terrain: one fill per terrain (a world-anchored texture, or the flat color).
  byTerr.forEach((ids, ti) => {
    if (!ids.length) return;
    ctx.beginPath();
    for (const id of ids) hexSub(ctx, X[id], Y[id], HEX + 0.5);
    ctx.fillStyle = o.far || !tex.terr ? style.flat[ti] : pattern(ctx, tex.terr[ti]);
    ctx.fill();
  });
  // 2. The style's own details (decals, fringes, grid).
  if (style.detail && (!o.far || style.farDetail || style.key === "D")) style.detail(ctx, W, list, n, tex, o);
  // 3. Snow: a snow texture over the land in snow, plus the weather wash (weather.js weatherTint).
  ctx.beginPath();
  let any = false;
  for (let a = 0; a < n; a++) { const id = list[a]; if (W.snow[id] && W.T[id] !== TI.water) { hexSub(ctx, X[id], Y[id], HEX + 0.5); any = true; } }
  if (any) {
    if (!o.far && tex.snow) { ctx.fillStyle = pattern(ctx, tex.snow); ctx.fill(); }
    ctx.fillStyle = `rgba(235,240,248,${o.far || !tex.snow ? 0.34 : style.snowWash ?? 0.3})`;
    ctx.fill();
  }
  // 4. What you know: reported tiles darker, unknown ones darker still (render.js SHADES 0.72 / 0.42).
  for (const [f, a0] of [[1, 0.28], [2, 0.58]]) {
    ctx.beginPath();
    let k = 0;
    for (let a = 0; a < n; a++) if (W.fog[list[a]] === f) { hexSub(ctx, X[list[a]], Y[list[a]], HEX + 0.5); k++; }
    if (k) { ctx.fillStyle = `rgba(0,0,0,${a0})`; ctx.fill(); }
  }
  // 5. Infection as you know it (not on unknown tiles), one fill per level, plus the style's stain texture up close.
  const lv = new Map();
  for (let a = 0; a < n; a++) { const id = list[a]; if (W.fog[id] === 2 || !(W.inf[id] > 0.02)) continue; const q = Math.round(W.inf[id] * 10); if (!lv.has(q)) lv.set(q, []); lv.get(q).push(id); }
  for (const [q, ids] of lv) {
    ctx.beginPath();
    for (const id of ids) hexSub(ctx, X[id], Y[id], HEX + 0.5);
    ctx.fillStyle = `rgba(220,40,40,${((q / 10) * 0.55 * (tex.infect && !o.far ? style.infWash ?? 0.6 : 1)).toFixed(3)})`;
    ctx.fill();
    if (tex.infect && !o.far) { ctx.globalAlpha = Math.min(1, (q / 10) * (style.infAlpha ?? 1.2)); ctx.fillStyle = pattern(ctx, tex.infect); ctx.fill(); ctx.globalAlpha = 1; }
  }
  // 6. Roads (each stroke over the same path) and bridges.
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const path = new Path2D();
  for (let a = 0; a < nr; a++) {
    const id = roads[a];
    for (const m of W.tiles[id].roadLinks) { if (m < id) continue; path.moveTo(X[id], Y[id]); path.lineTo(X[m], Y[m]); }
  }
  for (const [color, lw, dash] of style.roads) {
    if (dash && o.far) continue;
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke(path);
  }
  ctx.setLineDash([]);
  for (let a = 0; a < n; a++) { const id = list[a]; if (W.angle[id] === W.angle[id]) drawMapSprite(ctx, bridgeCanvas(), X[id], Y[id], 24, { angle: W.angle[id] }, o.S); }
}

// World data that never changes (render.js geometry()): tile centers, terrain index, neighbours by direction.
const EVEN_DIRS = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const ODD_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
export function prepWorld(grid, tiles) {
  const n = tiles.length;
  const W = {
    grid, tiles, n, cols: grid.width, rows: grid.height,
    X: new Float64Array(n), Y: new Float64Array(n), T: new Uint8Array(n), fog: new Uint8Array(n), snow: new Uint8Array(n),
    inf: new Float32Array(n), site: new Uint8Array(n), nb: new Int32Array(n * 6).fill(-1), angle: new Float64Array(n).fill(NaN),
  };
  for (let i = 0; i < n; i++) {
    const t = tiles[i], x = i % grid.width, y = Math.floor(i / grid.width);
    [W.X[i], W.Y[i]] = grid.toPixel(i, HEX);
    W.T[i] = Math.max(0, TI[t.terrain] ?? 1);
    W.fog[i] = t.fog | 0;
    W.snow[i] = t.snow ? 1 : 0;
    W.inf[i] = t.infection || 0;
    W.site[i] = t.loc || t.base ? 1 : 0;
    const dirs = y & 1 ? ODD_DIRS : EVEN_DIRS;
    dirs.forEach(([dx, dy], d) => { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < grid.width && ny < grid.height) W.nb[i * 6 + d] = ny * grid.width + nx; });
    if (t.bridge) {
      const [a, b] = t.roadLinks.length > 1 ? t.roadLinks : [t.id, t.roadLinks[0] ?? t.id];
      const [ax, ay] = grid.toPixel(a, HEX), [bx, by] = grid.toPixel(b, HEX);
      W.angle[i] = ax === bx && ay === by ? 0 : Math.atan2(by - ay, bx - ax);
    }
  }
  return W;
}
// Tile ids whose centers lie in a world rectangle (render.js tilesIn).
export function tilesIn(W, x0, y0, x1, y1, out) {
  const rowH = HEX * 1.5, colW = HEX * SQ3;
  const r0 = Math.max(0, Math.ceil(y0 / rowH)), r1 = Math.min(W.rows - 1, Math.floor(y1 / rowH));
  let n = 0;
  for (let r = r0; r <= r1; r++) {
    const off = 0.5 * (r & 1);
    const c0 = Math.max(0, Math.ceil(x0 / colW - off)), c1 = Math.min(W.cols - 1, Math.floor(x1 / colW - off));
    for (let c = c0; c <= c1; c++) out[n++] = r * W.cols + c;
  }
  return n;
}
// Texture resolution for a zoom: device px per world px, rounded to the bucket the textures are made for.
export const bucketOf = (zoom, S) => (zoom < 0.6 ? { far: true, R: 0 } : { far: false, R: S <= 1.25 ? 1 : S <= 2.5 ? 2 : 4 });
