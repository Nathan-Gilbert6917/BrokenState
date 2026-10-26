// The edge of a battle map: instead of ending in black, the ground runs on for a few tiles (a skirt) and fades into a
// fog the colour of the sky (day or night, the weather where the fight is), and the canvas has a soft vignette of the
// same fog. The skirt continues each edge tile's ground (grass, a field, dirt, asphalt, rubble, water), runs the roads
// off the map, and scatters a few low things over it (grass tufts, the odd tree stump, rubble in towns). It is
// scenery only: the skirt cells are outside the battle (no hover, no clicks: isoview.js isoPick ends at the map), and
// nothing in the sim knows of them.
// Painted once per battle (and when the weather, the night or the edge ground changes) in map space, 16 texels a tile
// like the ground (isoview.js flatGroundFor) and with the same colours (its floorColor, handed in), into one canvas
// stretched onto the diamonds with the ground's own transform: right under every turn of the view and at every zoom,
// and never repainted for either.
// Display → Battle map edge (ui/displayopts.js battleEdge): full (5 tiles, the scattered things, the vignette); light
// (3 tiles of plain ground, no vignette); off (the fog colour behind the map, nothing else).
import { weatherAt } from "../sim/weather.js";
import { battleTile } from "../sim/wxsight.js"; // the tile whose weather a battle has (a base map: its base's)
import { onForgetPictures } from "./pictures.js";

export const EDGE_LEVELS = { full: 2, low: 1, off: 0 };
export const EDGE = { level: 2 };
export function setEdgeLevel(k) { EDGE.level = typeof k === "number" ? k : EDGE_LEVELS[k] ?? 2; }
export const skirtTiles = (lvl = EDGE.level) => (lvl >= 2 ? 5 : lvl === 1 ? 3 : 0);
const TEX = 16, TILE = 32; // texels a tile; skirt cells a side of one picture at most (isoview.js TILE_CELLS)

let mkCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
export function setEdgeCanvas(fn) { mkCanvas = fn; skirtCache = null; vig = null; }

function hash(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];

// ---------- the fog's colour ----------
// By the weather over the battle's tile (sim/weather.js): a grey-green haze on a clear day, greyer overcast, a cold
// blue-grey in rain and storms, pale in fog, white in snow, a warm haze in a heat wave; dusk darker; night a deep
// blue-black.
const WX_FOG = {
  clear: [70, 78, 78], overcast: [78, 82, 86], rain: [58, 64, 72], storm: [44, 48, 58], fog: [118, 122, 124],
  heat: [102, 94, 78], drought: [98, 90, 74], snow: [146, 152, 162], blizzard: [164, 170, 180], frost: [112, 124, 138],
};
const NIGHT = [9, 12, 21];
let wxMemo = { b: null, hour: -1, key: "clear", snow: 0 };
export function battleWeather(state, b) {
  if (!b) return { key: "clear", snow: 0 };
  const hour = state ? state.hour : 0;
  if (wxMemo.b === b && wxMemo.hour === hour) return wxMemo;
  let key = "clear", snow = 0;
  const tile = battleTile(state, b); // its own tile, or a base map's base's (sim/wxsight.js)
  try { if (state && state.tiles && tile != null) { const w = weatherAt(state, tile); key = w.key; snow = w.snowCover || 0; } } catch { /* no weather: a clear day */ }
  wxMemo = { b, hour, key: WX_FOG[key] ? key : "clear", snow };
  return wxMemo;
}
// [r, g, b] for the battle as it is (night: b.night; dusk or dark hours: b.dark).
export function fogColour(b, wx = { key: "clear", snow: 0 }) {
  let c = WX_FOG[wx.key] || WX_FOG.clear;
  if (wx.snow >= 0.08 && wx.key !== "blizzard") c = mix(c, WX_FOG.snow, 0.6);
  if (b && b.night) c = mix(c, NIGHT, 0.86);
  else if (b && b.dark) c = mix(c, NIGHT, 0.55);
  return c.map((v) => Math.round(v));
}
export const fogCss = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// ---------- the skirt ----------
// Every cell of the skirt, K tiles deep around the map: { x, y } (outside the bounds) and the edge cell it continues
// (ex, ey). For the tools.
export function skirtCells(b, K = skirtTiles()) {
  const out = [];
  for (let y = -K; y < b.h + K; y++) for (let x = -K; x < b.w + K; x++) {
    if (x >= 0 && y >= 0 && x < b.w && y < b.h) continue;
    out.push({ x, y, ex: Math.max(0, Math.min(b.w - 1, x)), ey: Math.max(0, Math.min(b.h - 1, y)) });
  }
  return out;
}
// The ground an edge cell's skirt is painted with: its own, but a building's floor or a roof is dirt or gravel
// outside, a wall's trench or the hive's flesh is grass; a road runs on straight out (and not into the corners).
const NATURAL = new Set(["grass", "field", "dirt"]);
function skirtGround(c, corner) {
  if (c.k === "water") return { f: c.f, k: "water" };
  let f = c.f || "grass";
  if (f === "floor") f = "dirt";
  else if (f === "roof") f = "gravel";
  if (f === "road" && corner) f = c.deck ? "road" : "gravel";
  return { f, k: "open", deck: c.deck && f === "road" ? c.deck : undefined };
}
let skirtCache = null;
// floorColor(c, k, x, y, lx, ly, mud) → [r, g, b]: isoview.js's own (the ground's colours). gkey: the ground's
// signature (isoview.js sceneFor groundKey). Returns { cv, K } or null (off).
// cells: the ground floor's (on an upper floor of a building the skirt still runs on from the ground; issue #24: it was
// painted again on every floor). Its key holds the edge cells' grounds itself.
export function skirtFor(b, fog, floorColor, gkey = "", cells = b.cells) {
  const K = skirtTiles();
  if (!K) return null;
  let esig = 0;
  for (let x = 0; x < b.w; x++) for (const y of [0, b.h - 1]) { const c = cells[y * b.w + x]; esig = (Math.imul(esig, 31) + (c.f ? c.f.charCodeAt(0) + c.f.length * 7 : 0) + (c.k === "tree" ? 3 : c.k === "water" ? 5 : 0)) | 0; }
  for (let y = 0; y < b.h; y++) for (const x of [0, b.w - 1]) { const c = cells[y * b.w + x]; esig = (Math.imul(esig, 31) + (c.f ? c.f.charCodeAt(0) + c.f.length * 7 : 0) + (c.k === "tree" ? 3 : c.k === "water" ? 5 : 0)) | 0; }
  const key = `${b.w}x${b.h}:${K}:${EDGE.level}:${fog.join(",")}:${gkey}:${esig}`;
  if (skirtCache && skirtCache.b === b && skirtCache.key === key) return skirtCache;
  const W = b.w + 2 * K, H = b.h + 2 * K, tw = W * TEX, th = H * TEX;
  // How wooded the edges are (more stumps in a forest).
  let trees = 0, edge = 0;
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    if (x > 1 && y > 1 && x < b.w - 2 && y < b.h - 2) continue;
    edge++;
    if (cells[y * b.w + x].k === "tree") trees++;
  }
  const wood = edge ? Math.min(1, (trees / edge) * 4) : 0;
  const props = EDGE.level >= 2;
  // In tiles of at most TILE skirt cells a side (issue #24: a 300 × 300 map's skirt would be one 4960 px picture); a
  // tile wholly inside the map has nothing to paint and is left out.
  const tiles = [];
  for (let y0 = 0; y0 < H; y0 += TILE) for (let x0 = 0; x0 < W; x0 += TILE) {
    const cw = Math.min(TILE, W - x0), chh = Math.min(TILE, H - y0);
    if (x0 >= K && y0 >= K && x0 + cw <= K + b.w && y0 + chh <= K + b.h) continue;
    const ttw = cw * TEX, tth = chh * TEX;
    const cv = mkCanvas(ttw, tth), ctx = cv.getContext("2d"), img = ctx.createImageData(ttw, tth), buf = img.data;
    for (let ty = y0; ty < y0 + chh; ty++) for (let tx = x0; tx < x0 + cw; tx++) {
      const x = tx - K, y = ty - K;
      if (x >= 0 && y >= 0 && x < b.w && y < b.h) continue;
      const ex = Math.max(0, Math.min(b.w - 1, x)), ey = Math.max(0, Math.min(b.h - 1, y));
      const corner = (x < 0 || x >= b.w) && (y < 0 || y >= b.h);
      const g = skirtGround(cells[ey * b.w + ex], corner);
      // What lies on this skirt tile (props): a few grass tufts, a stump, rubble, litter on the road.
      const h = hash(x, y, 31);
      const urban = g.f === "road" || g.f === "gravel" || g.f === "rubble";
      const prop = !props || g.k === "water" ? null : NATURAL.has(g.f) ? (h < 0.04 + wood * 0.1 ? "stump" : h < 0.42 ? "tuft" : null) : urban ? (h < (g.f === "road" ? 0.08 : 0.3) ? "rubble" : null) : null;
      for (let py = 0; py < TEX; py++) for (let px = 0; px < TEX; px++) {
        const lx = (px + 0.5) / TEX, ly = (py + 0.5) / TEX;
        let col = floorColor(g, g.k, x, y, lx, ly, 0);
        if (prop) col = propPixel(prop, col, x, y, px, py) || col;
        // Distance out from the map's edge (tiles), with a ragged, wispy front.
        const wx = x + lx, wy = y + ly;
        const ox = wx < 0 ? -wx : wx > b.w ? wx - b.w : 0, oy = wy < 0 ? -wy : wy > b.h ? wy - b.h : 0;
        const d = Math.hypot(ox, oy) + (hash(Math.floor((x * TEX + px) / 4), Math.floor((y * TEX + py) / 4), 5) - 0.5) * 0.7;
        const t = Math.max(0, Math.min(1, (d - 0.15) / (K - 0.6)));
        col = mix(mul(col, 0.94), fog, t * t * (3 - 2 * t) * 0.98 + 0.06 * Math.min(1, d));
        const i = (((ty - y0) * TEX + py) * ttw + (tx - x0) * TEX + px) * 4;
        buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = { cv, x: (x0 - K) * TEX, y: (y0 - K) * TEX }; // its place in the map's texels (the map's corner at 0, 0)
    if (typeof createImageBitmap === "function" && typeof HTMLCanvasElement !== "undefined" && cv instanceof HTMLCanvasElement) createImageBitmap(cv).then((bm) => { t.cv = bm; }, () => { /* keep the canvas */ });
    tiles.push(t);
  }
  // cv: the one picture of a map small enough for a single tile (the tools read it).
  skirtCache = { b, key, tiles, cv: tiles.length === 1 && W <= TILE && H <= TILE ? tiles[0].cv : null, K, tw, th };
  return skirtCache;
}
// A prop's texel over the ground (px, py in 0..15 on the tile), or null where it is not.
function propPixel(kind, col, x, y, px, py) {
  if (kind === "tuft") {
    // 2–4 tufts of blades: short strokes, lit at the tip.
    const n = 2 + Math.floor(hash(x, y, 41) * 3);
    for (let k = 0; k < n; k++) {
      const cx = 2 + Math.floor(hash(x, y, 50 + k) * 12), cy = 3 + Math.floor(hash(x, y, 60 + k) * 11);
      if (py > cy || py < cy - 3) continue;
      const dx = px - cx;
      if (dx === -1 && py >= cy - 1) return mul(col, 0.7);
      if (dx === 0) return py === cy - 3 ? mul(col, 1.45) : mul(col, 1.18);
      if (dx === 1 && py >= cy - 2) return mul(col, py === cy - 2 ? 1.35 : 1.05);
    }
    return null;
  }
  if (kind === "stump") {
    const cx = 5 + hash(x, y, 70) * 6, cy = 5 + hash(x, y, 71) * 6, d = Math.hypot(px + 0.5 - cx, (py + 0.5 - cy) * 1.1);
    if (d < 1.3) return [126, 98, 64];
    if (d < 2.4) return [92, 70, 44];
    if (d < 3.1) return [58, 44, 30];
    if (Math.hypot(px + 0.5 - cx - 1.6, py + 0.5 - cy - 1.4) < 3.2) return mul(col, 0.7); // its shadow
    return null;
  }
  if (kind === "rubble") {
    const n = 3 + Math.floor(hash(x, y, 80) * 4);
    for (let k = 0; k < n; k++) {
      const cx = 1 + Math.floor(hash(x, y, 90 + k) * 13), cy = 1 + Math.floor(hash(x, y, 100 + k) * 13), s = hash(x, y, 110 + k) < 0.4 ? 2 : 1;
      if (px >= cx && px < cx + s && py >= cy && py < cy + s) return mul([108, 104, 98], 0.8 + hash(x, y, 120 + k) * 0.4);
      if (px === cx + s && py === cy + s) return mul(col, 0.6);
    }
    return null;
  }
  return null;
}

// ---------- the vignette ----------
// A soft ring of fog over the canvas's edges (full only). One gradient, kept while the size and colour stay.
let vig = null;
export function drawVignette(ctx, cw, ch, fog) {
  if (EDGE.level < 2 || !ctx.createRadialGradient) return;
  const key = `${cw}x${ch}:${fog.join(",")}`;
  if (!vig || vig.key !== key) {
    const r = Math.hypot(cw, ch) / 2, g = ctx.createRadialGradient(cw / 2, ch / 2, r * 0.55, cw / 2, ch / 2, r);
    if (!g || !g.addColorStop) return; // a stub canvas (the tools)
    g.addColorStop(0, fogCss(fog, 0)); g.addColorStop(0.6, fogCss(fog, 0.22)); g.addColorStop(1, fogCss(fog, 0.6));
    vig = { key, g };
  }
  ctx.fillStyle = vig.g;
  ctx.fillRect(0, 0, cw, ch);
}
onForgetPictures(() => { skirtCache = null; vig = null; }); // ui/pictures.js: drawn again after a lost GPU context
