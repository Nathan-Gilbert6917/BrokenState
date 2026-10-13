// HD sprite design kit (design preview only: the game is unchanged). A pixel painter at any grid size with the
// helpers the HD sprites are drawn with, and the color helpers of ui/sprites.js. Runs in Node and the browser.
//
// Conventions for the HD sets (design/hd/*.js):
//   - characters are painted on a 44 × 52 grid (twice ui/sprites.js's 22 × 26: the same on-screen size, four times
//     the pixels), facing right like the originals, feet on the bottom rows, a free column on each side for the outline;
//   - items are painted on a 32 × 32 grid;
//   - colors are hex strings; null is transparent; outline() adds the dark rim the way toCanvas does in the game.
export const OUTLINE = "#0b0c0e";

export function rgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
export function shade(hex, f) { // f < 0 darker, f > 0 lighter
  const [r, g, b] = rgb(hex);
  return f < 0 ? toHex(r * (1 + f), g * (1 + f), b * (1 + f)) : toHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
}
export function mix(a, b, t) {
  const x = rgb(a), y = rgb(b);
  return toHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}
export const desat = (hex, t) => { const [r, g, b] = rgb(hex); const l = r * 0.3 + g * 0.59 + b * 0.11; return toHex(r + (l - r) * t, g + (l - g) * t, b + (l - b) * t); };
// A hue shift toward warm (t > 0) or cool (t < 0) for shading that is not just darker.
export const warm = (hex, t) => mix(hex, t > 0 ? "#ff9a3c" : "#3c6cff", Math.abs(t));

export function painter(w = 44, h = 52) {
  const px = new Array(w * h).fill(null);
  const p = {
    px, w, h,
    set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < w && y < h && c) px[y * w + x] = c; },
    get(x, y) { return x >= 0 && y >= 0 && x < w && y < h ? px[y * w + x] : null; },
    clear(x, y) { if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = null; },
    rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p.set(x, y, c); },
    // Horizontal / vertical runs (hl / vl: w and h are the size).
    hl(x0, x1, y, c) { for (let x = x0; x <= x1; x++) p.set(x, y, c); },
    vl(x, y0, y1, c) { for (let y = y0; y <= y1; y++) p.set(x, y, c); },
    // A line (Bresenham).
    line(x0, y0, x1, y1, c) {
      let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, e = dx + dy;
      for (;;) { p.set(x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
    },
    // A filled ellipse centred on (cx, cy) with radii rx, ry.
    ellipse(cx, cy, rx, ry, c) {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x - cx) / (rx + 0.5), ny = (y - cy) / (ry + 0.5);
        if (nx * nx + ny * ny <= 1) p.set(x, y, c);
      }
    },
    // A filled circle.
    circle(cx, cy, r, c) { p.ellipse(cx, cy, r, r, c); },
    // Only where something is already painted (a highlight or a wound on a body).
    over(x, y, c) { if (p.get(x, y)) p.set(x, y, c); },
    // Recolor every pixel of color a to b.
    swap(a, b) { for (let i = 0; i < px.length; i++) if (px[i] === a) px[i] = b; },
    // Mirror left-right.
    flip() { for (let y = 0; y < h; y++) for (let x = 0; x < w >> 1; x++) { const i = y * w + x, j = y * w + (w - 1 - x); const t = px[i]; px[i] = px[j]; px[j] = t; } },
    // Stamp another painter at (ox, oy); transparent pixels leave what is below.
    blit(q, ox, oy) { for (let y = 0; y < q.h; y++) for (let x = 0; x < q.w; x++) { const c = q.px[y * q.w + x]; if (c) p.set(ox + x, oy + y, c); } },
    // Every painted pixel: [x, y, color].
    pixels() { const out = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = px[y * w + x]; if (c) out.push([x, y, c]); } return out; },
    count() { return px.filter(Boolean).length; },
  };
  return p;
}

// The dark rim: every empty pixel touching a painted one (4-neighbours, like the game's toCanvas). Returns a new
// painter with the outline in place so the source stays editable.
export function outline(p, col = OUTLINE) {
  const q = painter(p.w, p.h);
  q.px.splice(0, q.px.length, ...p.px);
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (p.get(x, y)) continue;
    if (p.get(x - 1, y) || p.get(x + 1, y) || p.get(x, y - 1) || p.get(x, y + 1)) q.set(x, y, col);
  }
  return q;
}

// The painter upscaled onto a canvas (browser only); up: canvas pixels a grid pixel.
export function toCanvas(p, up = 2, withOutline = true) {
  if (typeof document === "undefined") return null;
  const q = withOutline ? outline(p) : p;
  const cv = document.createElement("canvas");
  cv.width = q.w * up; cv.height = q.h * up;
  const c = cv.getContext("2d");
  for (const [x, y, col] of q.pixels()) { c.fillStyle = col; c.fillRect(x * up, y * up, up, up); }
  return cv;
}

// A painter blown up k× (nearest neighbour): the game's 22 × 26 sprites next to the HD ones on one sheet.
export function scaled(p, k = 2) {
  const q = painter(p.w * k, p.h * k);
  for (const [x, y, c] of p.pixels()) q.rect(x * k, y * k, x * k + k - 1, y * k + k - 1, c);
  return q;
}
