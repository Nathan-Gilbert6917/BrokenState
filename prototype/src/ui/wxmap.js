// Weather on the State Map (sim/weather.js): the fronts as soft clouds drifting over the land, and the lines a
// tile's tooltip gets (the front over it, frozen river). Drawn by render.js on the moving layer above the cached
// ground, every frame, so they cost a few image draws a front and nothing when there are none:
// - Weather layer (on by default): faint clouds, so the land stays readable.
// - Weather fronts layer: the clouds stronger, with the front's edge, its name and where it is heading (an arrow to
//   where it will be in FRONT_AHEAD hours).
// Each front is one cached cloud image (a handful of radial-gradient puffs, made once per kind and front) drawn
// scaled: one image draw a front a frame. They glide between hours as the clock runs; with Map animations off they
// still move, but only when the map is drawn anyway.
import { visibleFronts, frontAt, riverFrozen, thinIce, ICE, WEATHER } from "../sim/weather.js";
import { onForgetPictures } from "./pictures.js";

// Puff colour per kind (r, g, b) and its strength on the Weather layer (alpha); the Weather fronts layer shows them
// FRONT_STRONG times as strong.
export const FRONT_LOOK = {
  storm:    { rgb: [34, 44, 78],    alpha: 0.42 },
  rain:     { rgb: [64, 86, 124],   alpha: 0.28 },
  blizzard: { rgb: [236, 241, 250], alpha: 0.42 },
  snow:     { rgb: [222, 230, 242], alpha: 0.3 },
  fog:      { rgb: [188, 191, 196], alpha: 0.38 },
};
export const FRONT_STRONG = 1.8;
const FRONT_AHEAD = 6; // hours: the heading arrow points where the front will be by then
const PUFFS = 6;       // puffs round the middle one
const SQ3 = Math.sqrt(3);
const CLOUD = 160, EXT = 1.25; // a cloud image's side (px) and how far it reaches (× the front's radius)

// One front's cloud: a puff in the middle and PUFFS round it (their places and sizes from the front's id, so every
// front has its own shape), in the kind's colour. Kept for the fronts drawn lately.
const clouds = new Map();
function cloudCanvas(k, id) {
  const key = `${k}:${id}`;
  let cv = clouds.get(key);
  if (cv !== undefined) return cv;
  if (clouds.size > 48) clouds.clear();
  cv = null;
  try {
    cv = document.createElement("canvas");
    cv.width = cv.height = CLOUD;
    const c = cv.getContext("2d"), [r, g, b] = (FRONT_LOOK[k] || FRONT_LOOK.rain).rgb, u = CLOUD / (2 * EXT), m = CLOUD / 2;
    const puff = (x, y, rad, a) => {
      const grd = c.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, `rgba(${r},${g},${b},${a})`);
      grd.addColorStop(0.5, `rgba(${r},${g},${b},${a * 0.7})`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      c.fillStyle = grd;
      c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    };
    puff(m, m, 0.8 * u, 1);
    const a0 = (id * 2.399) % (Math.PI * 2);
    for (let j = 0; j < PUFFS; j++) {
      const a = a0 + (j * Math.PI * 2) / PUFFS, d = 0.48 + 0.08 * Math.sin(id + j * 1.7), pr = 0.55 + 0.1 * Math.cos(id * 3 + j);
      puff(m + Math.cos(a) * d * u, m + Math.sin(a) * d * u, pr * u, 0.8);
    }
  } catch { cv = null; }
  clouds.set(key, cv);
  return cv;
}

// Draws the fronts in world coordinates (the caller has set the map transform). hex: the map's hex size in world
// px; view: { minX, maxX, minY, maxY } world rectangle on screen; frac: how far into the coming hour the clock is;
// strong: the Weather fronts layer; zoom: the camera zoom (labels). Returns the number of fronts drawn.
export const frontStats = { drawn: 0, ms: 0 };
export function drawFronts(ctx, state, { hex, view, frac = 0, strong = false, zoom = 1 }) {
  if (typeof document === "undefined") return 0;
  const t0 = performance.now();
  const U = hex * SQ3; // world px per tile
  let n = 0;
  for (const f of visibleFronts(state, frac)) {
    const look = FRONT_LOOK[f.k];
    if (!look || f.r <= 0) continue;
    const cx = f.x * U, cy = f.y * U, R = f.r * U, E = R * EXT;
    if (cx + E < view.minX || cx - E > view.maxX || cy + E < view.minY || cy - E > view.maxY) continue;
    const cv = cloudCanvas(f.k, f.id);
    if (!cv) continue;
    n++;
    ctx.globalAlpha = Math.min(0.8, look.alpha * (strong ? FRONT_STRONG : 1));
    ctx.drawImage(cv, cx - E, cy - E, E * 2, E * 2);
    ctx.globalAlpha = 1;
    if (strong) frontMarks(ctx, f, cx, cy, R, U, zoom);
  }
  frontStats.drawn = n;
  frontStats.ms = performance.now() - t0;
  return n;
}

// The Weather fronts layer: the front's edge (dashed), an arrow to where it will be in FRONT_AHEAD hours, its name.
function frontMarks(ctx, f, cx, cy, R, U, zoom) {
  const light = f.k === "blizzard" || f.k === "snow" || f.k === "fog";
  ctx.save();
  ctx.lineWidth = 1.6 / zoom;
  ctx.setLineDash([6 / zoom, 5 / zoom]);
  ctx.strokeStyle = light ? "rgba(235,240,250,0.75)" : "rgba(150,175,230,0.8)";
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  const ex = cx + f.vx * FRONT_AHEAD * U, ey = cy + f.vy * FRONT_AHEAD * U, ang = Math.atan2(ey - cy, ex - cx), h = 9 / zoom;
  ctx.lineWidth = 2.4 / zoom;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(ex, ey);
  ctx.moveTo(ex - Math.cos(ang - 0.5) * h, ey - Math.sin(ang - 0.5) * h);
  ctx.lineTo(ex, ey);
  ctx.lineTo(ex - Math.cos(ang + 0.5) * h, ey - Math.sin(ang + 0.5) * h);
  ctx.stroke();
  ctx.font = `600 ${Math.round(13 / zoom)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = `${WEATHER[f.k]?.icon || ""} ${f.name}`;
  ctx.lineWidth = 3 / zoom;
  ctx.strokeStyle = "rgba(13,15,18,0.8)";
  ctx.strokeText(label, cx, cy - 12 / zoom);
  ctx.fillStyle = "#eef3fb";
  ctx.fillText(label, cx, cy - 12 / zoom);
  ctx.restore();
}

// Lines for a tile's tooltip: the front over it now, and frozen river (thin ice).
export function weatherTipLines(state, id) {
  const out = [];
  const a = frontAt(state, id, state.hour, state.hour);
  const v = a ? visibleFronts(state, 0).find((f) => f.id === a.f.id) : null;
  if (v) out.push(`${WEATHER[v.k]?.icon || ""} ${v.name} over this tile`);
  if (riverFrozen(state, id)) out.push(`❄️ Frozen river: walkable on foot (${ICE.walk} h a tile), no vehicles${thinIce(state, id) ? "; the ice is thin" : ""}`);
  return out;
}
onForgetPictures(() => clouds.clear()); // ui/pictures.js: drawn again after a lost GPU context
