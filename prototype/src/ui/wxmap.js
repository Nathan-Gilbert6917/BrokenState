// Weather on the State Map (sim/weather.js): the fronts as soft clouds drifting over the land, and the lines a
// tile's tooltip gets (its weather on a tile seen live, frozen river). The fronts are not shown to players (the user's
// word 2026-10-23: "Weather fronts are not shown to players and rain only shows in live coverage tiles in the world
// map"): drawFronts is the dev tools' Reveal map's only (render.js), drawn strong with each front's edge, its name and
// where it is heading (an arrow to where it will be in FRONT_AHEAD hours); players see the rain and fog on the tiles
// they see live (drawWeatherFx, live).
// Each front is one cached cloud image (a handful of radial-gradient puffs, made once per kind and front) drawn
// scaled: one image draw a front a frame. They glide between hours as the clock runs; with Map animations off they
// still move, but only when the map is drawn anyway.
// Rain and fog on the land (drawWeatherFx; the user's request 2026-10-23: "Add rain and fog effect … on the world map
// when it is foggy or raining in the world map. Fog reduces visibility on the world map too."): on the Weather layer,
// over each tile on screen where it is raining (slanted streaks falling; a storm adds a heavier, faster set) or foggy
// (soft grey banks drifting; a blizzard's whiteout the same in white), by the tile's own weather (sim/weather.js skyAt:
// the front over it, else the day's sky), easing from this hour's tiles to the next hour's as the clock runs. Drawn
// over the land, the sites, the dead and the groups (fog veils what is on its tiles), under your teams, notes and
// labels. Cheap: the sky of every tile is worked out once an hour (wxFxGrid), the rain is a pre-drawn streak pattern
// filled over the rainy tiles in a few fills a frame, the fog two cached puff images a fogged tile (FOG.MAX_DRAWS a
// frame at most: zoomed out, every other tile's puffs, twice the size). Frames: FX.RAIN_MS / FX.FOG_MS while some is on
// screen and Map animations are on (none with Reduce motion: they stand still); nothing on screen, nothing asked.
import { visibleFronts, riverFrozen, thinIce, ICE, WEATHER, skyAt, sightCut, WAVE } from "../sim/weather.js";
import { onForgetPictures } from "./pictures.js";

// Puff colour per kind (r, g, b) and its strength on the Weather layer (alpha); drawFronts (dev tools only) shows them
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
// strong: drawn strong (render.js: always, under the dev tools' Reveal map); zoom: the camera zoom (labels).
// Returns the number of fronts drawn.
export const frontStats = { drawn: 0, ms: 0 };
export function drawFronts(ctx, state, { hex, view, frac = 0, strong = false, zoom = 1 }) {
  if (typeof document === "undefined") return 0;
  const t0 = performance.now();
  const U = hex * SQ3; // world px per tile
  let n = 0;
  for (const f of visibleFronts(state, frac)) {
    const look = FRONT_LOOK[f.k];
    if (!look || f.r <= 0) continue;
    const cx = f.x * U, cy = f.y * U, R = f.r * U, E = R * EXT, ER = E * (f.sh ? WAVE.across : 1); // a rain belt: a band (sim/weather.js WAVE)
    if (cx + ER < view.minX || cx - ER > view.maxX || cy + ER < view.minY || cy - ER > view.maxY) continue;
    const cv = cloudCanvas(f.k, f.id);
    if (!cv) continue;
    n++;
    ctx.globalAlpha = Math.min(0.8, look.alpha * (strong ? FRONT_STRONG : 1));
    if (f.sh) { // the cloud stretched across its heading, narrow along it
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.atan2(f.vy, f.vx));
      ctx.drawImage(cv, -E * WAVE.along, -E * WAVE.across, E * 2 * WAVE.along, E * 2 * WAVE.across);
      ctx.restore();
    } else ctx.drawImage(cv, cx - E, cy - E, E * 2, E * 2);
    ctx.globalAlpha = 1;
    if (strong) frontMarks(ctx, f, cx, cy, R, U, zoom);
  }
  frontStats.drawn = n;
  frontStats.ms = performance.now() - t0;
  return n;
}

// Drawn strong (the dev tools' Reveal map): the front's edge (dashed), an arrow to where it will be in FRONT_AHEAD
// hours, its name.
function frontMarks(ctx, f, cx, cy, R, U, zoom) {
  const light = f.k === "blizzard" || f.k === "snow" || f.k === "fog";
  ctx.save();
  ctx.lineWidth = 1.6 / zoom;
  ctx.setLineDash([6 / zoom, 5 / zoom]);
  ctx.strokeStyle = light ? "rgba(235,240,250,0.75)" : "rgba(150,175,230,0.8)";
  ctx.beginPath();
  if (f.sh) ctx.ellipse(cx, cy, R * WAVE.along, R * WAVE.across, Math.atan2(f.vy, f.vx), 0, Math.PI * 2); // a rain belt's band
  else ctx.arc(cx, cy, R, 0, Math.PI * 2);
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

// ---------- rain and fog on the land ----------
// What each kind of weather shows on a tile: rain streaks (1 rain, 2 a storm: heavier) or a fog bank (1 fog, 2 a
// blizzard's whiteout).
export const FX_RAIN = { rain: 1, storm: 2 };
export const FX_FOG = { fog: 1, blizzard: 2 };
// RAIN: the streak pattern (px a side, streaks in it, their length, the slant: px across per px down), how fast they
//   fall (CSS px a second, the storm's set STORM_SPEED), how strong (alpha; the storm's set STORM_ALPHA), at night
//   NIGHT × as strong; the tiles go in LEVELS steps of strength as they ease into the next hour.
// FOG: puff images (VARIANTS, PX a side), a puff SIZE × a tile's width across (FLAT × that high), ALPHA each (two a
//   tile, together always ALPHA), drifting DRIFT tiles across and fading out over DRIFT_MS, MAX_DRAWS images a frame.
// FX: the frame gaps (ms) asked for while rain (RAIN_MS) or only fog (FOG_MS) is on screen.
export const RAIN = { PX: 128, N: 40, LEN: [7, 13], SLANT: 0.32, SPEED: 230, ALPHA: 0.8, STORM_N: 46, STORM_LEN: [12, 20], STORM_SPEED: 360, STORM_ALPHA: 0.65, NIGHT: 0.6, LEVELS: 3 };
export const FOG = { VARIANTS: 3, PX: 128, SIZE: 2.3, FLAT: 0.72, ALPHA: 0.44, DRIFT: 0.9, DRIFT_MS: 16000, NIGHT: 0.6, MAX_DRAWS: 640 };
export const FX = { RAIN_MS: 50, FOG_MS: 100 };
const FOG_RGB = { 1: [196, 201, 207], 2: [238, 242, 248] };

// The sky of every tile at an hour, as codes (wxCode: 0 nothing to draw, 1 rain, 2 storm, 3 fog, 4 whiteout): worked
// out once an hour from the weather (weather.js skyAt) and kept for the last few hours asked.
export const wxCode = (k) => (FX_RAIN[k] || 0) + (FX_FOG[k] ? 2 + FX_FOG[k] : 0);
const grids = new Map();
let gridsW = null;
export function wxFxGrid(state, hour) {
  const w = state.weather, n = state.tiles.length;
  if (gridsW !== w || grids.size > 6) { grids.clear(); gridsW = w; }
  let g = grids.get(hour);
  if (g && g.length === n) return g;
  g = new Uint8Array(n);
  for (let id = 0; id < n; id++) g[id] = wxCode(skyAt(state, id, hour));
  grids.set(hour, g);
  return g;
}
export const dropWxFx = () => { grids.clear(); gridsW = null; };
// What a tile shows now (or at an hour): { rain: 0 | 1 | 2, fog: 0 | 1 | 2 } (the tools; the map reads wxFxGrid).
export function wxFxAt(state, id, hour = state.hour) {
  const k = skyAt(state, id, hour);
  return { rain: FX_RAIN[k] || 0, fog: FX_FOG[k] || 0 };
}

// A small seeded stream for the pictures (the same streaks and puffs every time).
const lcg = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
// The streak pattern: N slanted streaks of LEN px, wrapped round the edges so it tiles. heavy: the storm's set.
const rainPics = new Map();
function rainCanvas(heavy) {
  let cv = rainPics.get(heavy);
  if (cv !== undefined) return cv;
  cv = null;
  try {
    cv = document.createElement("canvas");
    cv.width = cv.height = RAIN.PX;
    const c = cv.getContext("2d"), rnd = lcg(heavy ? 977 : 331), P = RAIN.PX;
    const n = heavy ? RAIN.STORM_N : RAIN.N, [l0, l1] = heavy ? RAIN.STORM_LEN : RAIN.LEN, k = Math.hypot(RAIN.SLANT, 1);
    c.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const x = rnd() * P, y = rnd() * P, len = l0 + rnd() * (l1 - l0), dx = (-RAIN.SLANT / k) * len, dy = len / k;
      c.strokeStyle = heavy ? `rgba(200,214,236,${(0.55 + rnd() * 0.35).toFixed(2)})` : `rgba(210,222,240,${(0.5 + rnd() * 0.4).toFixed(2)})`;
      c.lineWidth = heavy ? 1.2 : 1;
      for (const ox of [-P, 0, P]) for (const oy of [-P, 0, P]) {
        c.beginPath();
        c.moveTo(x + ox, y + oy);
        c.lineTo(x + ox + dx, y + oy + dy);
        c.stroke();
      }
    }
  } catch { cv = null; }
  rainPics.set(heavy, cv);
  return cv;
}
// A fog puff: a few soft lumps along a flat bank, in the fog's or the whiteout's colour.
const fogPics = new Map();
function fogCanvas(kind, v) {
  const key = kind * 16 + v;
  let cv = fogPics.get(key);
  if (cv !== undefined) return cv;
  cv = null;
  try {
    cv = document.createElement("canvas");
    cv.width = cv.height = FOG.PX;
    const c = cv.getContext("2d"), rnd = lcg(71 + v * 131), P = FOG.PX, [r, g, b] = FOG_RGB[kind] || FOG_RGB[1];
    const lump = (x, y, rad, a) => {
      const grd = c.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, `rgba(${r},${g},${b},${a})`);
      grd.addColorStop(0.55, `rgba(${r},${g},${b},${(a * 0.55).toFixed(3)})`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      c.fillStyle = grd;
      c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    };
    lump(P / 2, P / 2, P * 0.42, 0.75);
    for (let i = 0; i < 4; i++) lump(P * (0.24 + rnd() * 0.52), P * (0.36 + rnd() * 0.28), P * (0.16 + rnd() * 0.12), 0.45 + rnd() * 0.3);
  } catch { cv = null; }
  fogPics.set(key, cv);
  return cv;
}
const hash01 = (id) => ((Math.imul(id + 1, 2654435761) >>> 0) % 4096) / 4096;

// Draws the rain and fog over the tiles in view (world coordinates: the caller has set the map transform). frac: how
// far into the coming hour the clock is (the tiles ease into the next hour's weather); t: the animation clock in ms
// (0: standing still); zoom: the camera zoom (the streaks keep their size on screen); night: dimmer. Returns how many
// tiles on screen got rain and fog this frame (0, 0: nothing drawn, no frames wanted).
export const fxStats = { rain: 0, fog: 0, fills: 0, puffs: 0, ms: 0 };
// live: the tiles you see live (render.js liveSet: state.live; every tile under the dev tools' Reveal map); rain and
// fog show only there (the user's word 2026-10-23: "rain only shows in live coverage tiles in the world map"). null:
// every tile (the tools).
export function drawWeatherFx(ctx, state, { hex, view, frac = 0, t = 0, zoom = 1, night = false, live = null }) {
  fxStats.rain = fxStats.fog = fxStats.fills = fxStats.puffs = 0;
  if (!state.weather || !state.grid || !state.tiles) return fxStats;
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const g0 = wxFxGrid(state, state.hour), g1 = frac > 0 ? wxFxGrid(state, state.hour + 1) : g0;
  const cols = state.grid.width, rows = state.grid.height, colW = hex * SQ3, rowH = hex * 1.5;
  // The tiles in view (a tile's puffs reach about a tile past it), with what each shows this frame.
  const pad = colW * 1.5;
  const r0 = Math.max(0, Math.ceil((view.minY - pad) / rowH)), r1 = Math.min(rows - 1, Math.floor((view.maxY + pad) / rowH));
  const rain = [], heavy = [], fog = [];
  for (let r = r0; r <= r1; r++) {
    const off = 0.5 * (r & 1);
    const c0 = Math.max(0, Math.ceil((view.minX - pad) / colW - off)), c1 = Math.min(cols - 1, Math.floor((view.maxX + pad) / colW - off));
    for (let c = c0; c <= c1; c++) {
      const id = r * cols + c, a = g0[id], b = g1[id];
      if ((!a && !b) || (live && !live.has(id))) continue;
      const wr = (a === 1 || a === 2 ? 1 - frac : 0) + (b === 1 || b === 2 ? frac : 0);
      const ws = (a === 2 ? 1 - frac : 0) + (b === 2 ? frac : 0);
      const wf = (a >= 3 ? 1 - frac : 0) + (b >= 3 ? frac : 0);
      if (wr > 0.02) rain.push(id, wr);
      if (ws > 0.02) heavy.push(id, ws);
      if (wf > 0.02) fog.push(id, wf, (b >= 3 && frac >= 0.5) || a < 3 ? b - 2 : a - 2);
    }
  }
  fxStats.rain = rain.length / 2;
  fxStats.fog = fog.length / 3;
  if (typeof document === "undefined" || (!rain.length && !fog.length)) return fxStats;
  const dim = night ? RAIN.NIGHT : 1;
  ctx.save();
  // Rain: the streak pattern over each rainy tile's brick (the rows' half-offset bricks tile the plane), in LEVELS
  // steps of strength; anchored to the land, the size it is on screen, falling as the clock runs.
  const sheet = (list, isHeavy) => {
    if (!list.length) return;
    const cv = rainCanvas(isHeavy);
    if (!cv) return;
    const pat = ctx.createPattern(cv, "repeat");
    if (!pat) return;
    const P = RAIN.PX, sp = (isHeavy ? RAIN.STORM_SPEED : RAIN.SPEED) * (t / 1000), k = Math.hypot(RAIN.SLANT, 1);
    const ox = ((((-RAIN.SLANT / k) * sp) % P) + P) % P, oy = (((sp / k) % P) + P) % P;
    if (pat.setTransform && typeof DOMMatrix !== "undefined") pat.setTransform(new DOMMatrix([1 / zoom, 0, 0, 1 / zoom, ox / zoom, oy / zoom]));
    ctx.fillStyle = pat;
    const L = RAIN.LEVELS;
    for (let lv = 1; lv <= L; lv++) {
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < list.length; i += 2) {
        if (Math.max(1, Math.round(list[i + 1] * L)) !== lv) continue;
        const id = list[i], r = (id / cols) | 0, x = colW * (id - r * cols + 0.5 * (r & 1)), y = rowH * r;
        ctx.rect(x - colW / 2, y - rowH / 2, colW, rowH);
        any = true;
      }
      if (!any) continue;
      ctx.globalAlpha = (isHeavy ? RAIN.STORM_ALPHA : RAIN.ALPHA) * (lv / L) * dim;
      ctx.fill();
      fxStats.fills++;
    }
  };
  sheet(rain, false);
  sheet(heavy, true);
  // Fog: two puffs a tile drifting with the wind and fading in and out by turns (their strengths always add up to
  // one), so the banks flow without flicker; zoomed out with many on screen, every other tile's, twice the size.
  if (fog.length) {
    const n = fog.length / 3, s = n * 2 > FOG.MAX_DRAWS ? Math.ceil(Math.sqrt((n * 2) / FOG.MAX_DRAWS)) : 1;
    const sw = FOG.SIZE * colW * s, sh = sw * FOG.FLAT, L = FOG.DRIFT * colW, fd = night ? FOG.NIGHT : 1;
    for (let i = 0; i < fog.length; i += 3) {
      const id = fog[i], r = (id / cols) | 0, c = id - r * cols;
      if (s > 1 && (r % s || c % s)) continue;
      const x = colW * (c + 0.5 * (r & 1)), y = rowH * r, h = hash01(id);
      const cv = fogCanvas(fog[i + 2], Math.floor(h * FOG.VARIANTS));
      if (!cv) continue;
      const u0 = (t / FOG.DRIFT_MS + h) % 1;
      for (let j = 0; j < 2; j++) {
        const u = (u0 + j * 0.5) % 1, wgt = Math.sin(Math.PI * u) ** 2, d = (u - 0.5) * L;
        if (wgt < 0.02) continue;
        ctx.globalAlpha = Math.min(1, FOG.ALPHA * fog[i + 1] * wgt * fd);
        ctx.drawImage(cv, x + d - sw / 2, y + d * 0.18 - sh / 2 + (h - 0.5) * rowH * 0.3, sw, sh);
        fxStats.puffs++;
      }
    }
  }
  ctx.restore();
  fxStats.ms = (typeof performance !== "undefined" ? performance.now() : 0) - t0;
  return fxStats;
}

// Lines for a tile's tooltip: the front over it now (else the rain or snow of the day's sky over it), what fog or a
// blizzard does to sight there (weather.js sightCut), and frozen river (thin ice).
// The weather lines of a tile's tooltip. The weather over it only on a tile you see live (live: as drawWeatherFx; null
// every tile), and never the front by name: the fronts are not shown to players (the user's word 2026-10-23).
export function weatherTipLines(state, id, live = null) {
  const out = [];
  const seen = !live || live.has(id);
  const k = state.weather && seen ? skyAt(state, id) : null;
  if (k && (FX_RAIN[k] || FX_FOG[k] || k === "snow")) out.push(`${WEATHER[k].icon} ${WEATHER[k].name} here`);
  const cut = state.weather && seen ? sightCut(state, id) : 0;
  if (cut < 0) out.push(`${WEATHER[k]?.icon || "🌫️"} ${k === "blizzard" ? "Whiteout" : "Fog"}: whoever is here sees ${-cut} tile less on the map (your teams, a base's lookouts, a watch tower, the groups' parties), and what is here is seen only from closer`);
  if (riverFrozen(state, id)) out.push(`❄️ Frozen river: walkable on foot (${ICE.walk} h a tile), no vehicles${thinIce(state, id) ? "; the ice is thin" : ""}`);
  return out;
}
onForgetPictures(() => { clouds.clear(); rainPics.clear(); fogPics.clear(); }); // ui/pictures.js: drawn again after a lost GPU context
