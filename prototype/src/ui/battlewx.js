// Rain, fog and snow over the battle view (the user's request 2026-10-23: "Add rain and fog effect during raid … when
// it is foggy or raining in the world map that is when it is foggy or raining in a raid"): every battle drawn by
// ui/isoview.js (raids, fights in the open, a base's defence and its build map) shows the weather over its tile on
// the State Map (sim/wxsight.js b.wx, kept as the battle is made from sim/weather.js weatherAt; ui/battleedge.js
// battleWeather for a battle made before it), with its rain and wind (weatherAt rain, wind):
//   rain      slanted streaks in two layers (near ones longer and brighter), a few splash rings on the ground, a
//             cold grey wash; rings opening on the puddles (sim/puddles.js c.pud: RIPPLE of them at a time on the
//             puddles' cells in sight, from a fixed list of at most RIP_CELLS cells made once per map; not in Light);
//   storm     the same, heavier, longer and blown further over by the wind;
//   fog       soft grey banks drifting slowly (and a little with the camera), thin over the middle of the screen and
//             thick toward its edges, over a light wash; by night the colour of the night's fog (battleedge.js
//             fogColour: dark blue-grey) and a little thicker;
//   snow      flakes drifting down, swaying; blizzard: more and faster, blown sideways, in a white fog.
// Anything else (clear, overcast, frost, heat): nothing. Under the ground (a hive's caves) never.
// Drawing only: nothing here reads the sim's dice or changes it (the fog's cut to sight is sim/wxsight.js's). Screen
// space, after the scene and the night's darkness and before the labels, bars and cursor (isoview.js drawIso), on the
// battle canvas: it takes no clicks.
// Cheap: the particles are fixed tables made once (typed arrays, MAX of each), placed each frame from the clock; the
// rain is two strokes of one path each, the splashes one more, the snow fillRects, the fog a dozen draws of one soft
// puff picture (painted once per colour) and one cached gradient over the edges. Nothing is allocated per frame.
// Display → Battle weather (ui/displayopts.js battleWx): full; light (half the drops and flakes, no splashes, fewer
// fog banks); off (nothing drawn: the fog still cuts sight). Reduce motion: everything held still.
import { battleWeather, fogColour, fogCss } from "./battleedge.js";
import { weatherAt } from "../sim/weather.js";
import { onForgetPictures } from "./pictures.js";

export const WX_LEVELS = { full: 2, low: 1, off: 0 };
export const WXFX = { level: 2, calm: false };
export function setWxLevel(k, calm = WXFX.calm) { WXFX.level = typeof k === "number" ? k : WX_LEVELS[k] ?? 2; WXFX.calm = !!calm; }
// For the tools and the dev view: frames drawn with weather, what the last one drew, puff pictures painted.
export const wxStats = { frames: 0, kind: "", drops: 0, flakes: 0, splashes: 0, banks: 0, puffs: 0, ripples: 0 };

// How much of each, at full (Light: half; no splashes).
export const WX_FX = {
  RAIN: 240, STORM: 400, SPLASH: 18, STORM_SPLASH: 30, // drops (scaled by the rain: weatherAt rain 0.3–1)
  SNOW: 200, BLIZZARD: 380,                            // flakes
  BANKS: 14, BLIZZ_BANKS: 10,                          // fog banks
  RIPPLE: 16, STORM_RIPPLE: 24, RIP_CELLS: 256,        // rings on the puddles at a time; the puddles' cells they pick from
};
const MAXP = 512, MAXB = 16, MAXS = 32;

let mkCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
export function setWxCanvas(fn) { mkCanvas = fn; puff = null; veil = null; }

function hash(a, b, c) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// The particle tables (fixed for the session: where each drop or flake starts, its speed, size and sway).
const PX = new Float32Array(MAXP), PY = new Float32Array(MAXP), SP = new Float32Array(MAXP), SZ = new Float32Array(MAXP);
for (let i = 0; i < MAXP; i++) { PX[i] = hash(i, 1, 7); PY[i] = hash(i, 2, 7); SP[i] = 0.8 + hash(i, 3, 7) * 0.45; SZ[i] = hash(i, 4, 7); }
const BX = new Float32Array(MAXB), BY = new Float32Array(MAXB), BS = new Float32Array(MAXB), BV = new Float32Array(MAXB);
for (let j = 0; j < MAXB; j++) { BX[j] = hash(j, 5, 9); BY[j] = hash(j, 6, 9); BS[j] = 0.38 + hash(j, 7, 9) * 0.4; BV[j] = 0.6 + hash(j, 8, 9) * 0.8; }
const SO = new Float32Array(MAXS);
for (let k = 0; k < MAXS; k++) SO[k] = hash(k, 9, 11);

// ---------- what to draw ----------
const KIND = { rain: "rain", storm: "rain", fog: "fog", snow: "snow", blizzard: "snow" };
let memo = { b: null, hour: -1, wx: "", fx: null };
// The weather effect for this battle now: { kind: "rain" | "fog" | "snow" | null, key (the weather), rain (0..1),
// wind (0..1), heavy (a storm or a blizzard), fog (0..1: how thick the fog banks are) }.
export function wxFxFor(state, b) {
  const hour = state ? state.hour : 0;
  const key0 = b && b.wx != null ? b.wx : battleWeather(state, b).key;
  if (memo.b === b && memo.hour === hour && memo.wx === key0) return memo.fx;
  let rain = 0.4, wind = 0.3;
  try { if (state && state.tiles && b && b.tileId != null) { const w = weatherAt(state, b.tileId); rain = w.rain || 0; wind = w.wind || 0; } } catch { /* the defaults */ }
  const kind = KIND[key0] || null, heavy = key0 === "storm" || key0 === "blizzard";
  const fx = { kind, key: key0, rain: kind === "rain" ? Math.max(0.3, rain) : 0, wind, heavy, fog: key0 === "fog" ? 1 : key0 === "blizzard" ? 0.6 : 0 };
  memo = { b, hour, wx: key0, fx };
  return fx;
}

// ---------- the pictures ----------
// One soft puff of fog (a radial fade), painted in the fog's colour; kept while the colour stays.
let puff = null;
function puffFor(col) {
  if (puff && puff.col === col) return puff.cv;
  const key = col.join(",");
  if (puff && puff.key === key) { puff.col = col; return puff.cv; }
  const cv = mkCanvas(128, 128), g = cv.getContext("2d");
  const gr = g && g.createRadialGradient ? g.createRadialGradient(64, 64, 0, 64, 64, 64) : null;
  if (!gr || !gr.addColorStop) { puff = { key, col, cv: null }; return null; } // a stub canvas (the tools)
  gr.addColorStop(0, fogCss(col, 0.9)); gr.addColorStop(0.45, fogCss(col, 0.55)); gr.addColorStop(1, fogCss(col, 0));
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  puff = { key, col, cv };
  wxStats.puffs++;
  return cv;
}
// The fog thick over the screen's edges (a radial fade to the fog's colour), kept while the size and colour stay.
let veil = null;
function veilFor(ctx, cw, ch, col, a) {
  if (veil && veil.cw === cw && veil.ch === ch && veil.col === col && veil.a === a) return veil.g;
  const r = Math.hypot(cw, ch) / 2, g = ctx.createRadialGradient ? ctx.createRadialGradient(cw / 2, ch / 2, r * 0.2, cw / 2, ch / 2, r) : null;
  if (!g || !g.addColorStop) return null;
  g.addColorStop(0, fogCss(col, 0)); g.addColorStop(0.55, fogCss(col, a * 0.45)); g.addColorStop(1, fogCss(col, a));
  veil = { cw, ch, col, a, g };
  return g;
}
onForgetPictures(() => { puff = null; veil = null; paint = { fx: null, dim: 0, level: -1, p: null }; }); // ui/pictures.js: painted again after a lost GPU context

// The colours of a frame (strings made once per weather, light and level, not every frame).
let paint = { fx: null, dim: 0, level: -1, p: null };
function paintFor(b, fx) {
  const dim = b.night ? 0.55 : b.dark ? 0.75 : 1;
  if (paint.fx === fx && paint.dim === dim && paint.level === WXFX.level) return paint.p;
  const low = WXFX.level < 2, wxCol = fogColour(b, { key: fx.key, snow: 0 }), thick = fx.fog * (b.night ? 1.15 : 1);
  const p = {
    col: wxCol, thick,
    rainWash: fogCss(wxCol, fx.heavy ? 0.16 : 0.09),
    near: `rgba(206,216,230,${0.42 * dim})`, far: `rgba(180,192,210,${0.26 * dim})`, splash: `rgba(214,224,236,${0.34 * dim})`,
    flake: `rgba(242,246,252,${0.85 * dim})`,
    fogWash: fogCss(wxCol, Math.min(0.3, (low ? 0.1 : 0.15) * thick)),
    veilA: Math.round(Math.min(0.85, (low ? 0.45 : 0.62) * thick) * 100) / 100,
  };
  paint = { fx, dim, level: WXFX.level, p };
  return p;
}

// ---------- the frame ----------
// After the scene (isoview.js drawIso). ax, ay: where the middle of the map is on the screen now (the fog banks
// drift a little with the camera). spot(x, y): a cell's middle on the screen ([X, Y]) if it is in sight, else null;
// tile: a cell's size on the screen (px): the puddles' rings. Returns the kind drawn ("" for none).
export function drawBattleWx(ctx, cw, ch, state, b, now, ax = cw / 2, ay = ch / 2, spot = null, tile = 0) {
  if (!WXFX.level || !b || !cw || !ch) return "";
  const fx = wxFxFor(state, b);
  if (!fx || !fx.kind) return "";
  const t = WXFX.calm ? 0 : (now || 0) / 1000, low = WXFX.level < 2, sc = Math.max(0.8, Math.min(1.6, ch / 900));
  const pt = paintFor(b, fx);
  wxStats.frames++; wxStats.kind = fx.kind; wxStats.drops = wxStats.flakes = wxStats.splashes = wxStats.banks = wxStats.ripples = 0;
  ctx.save();
  if (fx.fog) fogBanks(ctx, cw, ch, fx, pt, t, low, ax, ay);
  if (fx.kind === "rain" && !low && spot && tile > 0 && b.puddles) ripples(ctx, cw, ch, b, fx, pt, t, spot, tile);
  if (fx.kind === "rain") rain(ctx, cw, ch, fx, pt, t, low, sc);
  else if (fx.kind === "snow") snow(ctx, cw, ch, fx, pt, t, low, sc);
  ctx.restore();
  return fx.kind;
}

function rain(ctx, cw, ch, fx, pt, t, low, sc) {
  const storm = fx.heavy;
  // The grey of the rain over everything.
  ctx.globalAlpha = 1;
  ctx.fillStyle = pt.rainWash;
  ctx.fillRect(0, 0, cw, ch);
  const n = Math.min(MAXP, Math.round((storm ? WX_FX.STORM : WX_FX.RAIN) * (0.55 + 0.6 * fx.rain) * (low ? 0.5 : 1)));
  const slant = (storm ? 0.32 : 0.1) + fx.wind * (storm ? 0.3 : 0.18), V = ch * (storm ? 1.7 : 1.15), L = (storm ? 22 : 15) * sc;
  const k = 1 / Math.sqrt(1 + slant * slant), H2 = ch + 3 * L, span = cw + ch * slant;
  // Two layers: far (thin, faint, shorter) and near (longer, brighter).
  for (let layer = 0; layer < 2; layer++) {
    const near = layer === 1, len = L * (near ? 1.5 : 0.85), dy = len * k, dx = len * k * slant;
    ctx.beginPath();
    for (let i = layer; i < n; i += 2) {
      const y = ((PY[i] + (t * V * SP[i] * (near ? 1.15 : 0.85)) / H2) % 1) * H2 - L;
      const x = PX[i] * span - ch * slant + y * slant;
      ctx.moveTo(x - dx, y - dy); ctx.lineTo(x, y);
    }
    ctx.strokeStyle = near ? pt.near : pt.far;
    ctx.lineWidth = (near ? 1.4 : 1) * sc;
    ctx.stroke();
  }
  wxStats.drops = n;
  if (low) return;
  // Splashes: a ring opening on the ground and gone, each at a new spot every time round.
  const m = Math.min(MAXS, storm ? WX_FX.STORM_SPLASH : WX_FX.SPLASH), P = 0.6;
  ctx.beginPath();
  let drawn = 0;
  for (let s = 0; s < m; s++) {
    const c = (t + SO[s] * P) / P, cyc = Math.floor(c), f = c - cyc;
    if (f > 0.4) continue;
    const x = hash(s, cyc, 21) * cw, y = (0.15 + 0.85 * hash(s, cyc, 22)) * ch, r = (1.5 + f * 12) * sc;
    ctx.moveTo(x + r, y); ctx.ellipse(x, y, r, r * 0.38, 0, 0, Math.PI * 2);
    drawn++;
  }
  ctx.strokeStyle = pt.splash;
  ctx.lineWidth = 1 * sc;
  ctx.stroke();
  wxStats.splashes = drawn;
}

// The puddles' cells the rings pick from (sim/puddles.js c.pud): at most RIP_CELLS, spread over the map (every k-th),
// made once per map and puddles.
let ripMemo = { b: null, key: "", cells: null };
function ripCells(b) {
  if (ripMemo.b === b && ripMemo.key === b.puddles.key) return ripMemo.cells;
  const all = [];
  for (let i = 0; i < b.cells.length; i++) if (b.cells[i].pud) all.push(i);
  const step = Math.max(1, Math.ceil(all.length / WX_FX.RIP_CELLS)), cells = new Int32Array(Math.ceil(all.length / step));
  for (let j = 0; j < cells.length; j++) cells[j] = all[j * step];
  ripMemo = { b, key: b.puddles.key, cells };
  return cells;
}
// Rain on the puddles: a ring opening on the water and gone, each at a new puddle's cell every time round (only on
// cells in sight and on the screen).
function ripples(ctx, cw, ch, b, fx, pt, t, spot, tile) {
  const cells = ripCells(b);
  if (!cells.length) return;
  const m = fx.heavy ? WX_FX.STORM_RIPPLE : WX_FX.RIPPLE, P = 0.9, W = b.w;
  ctx.beginPath();
  let drawn = 0;
  for (let s = 0; s < m; s++) {
    const c = (t + SO[s % MAXS] * P + s * 0.37) / P, cyc = Math.floor(c), f = c - cyc;
    if (f > 0.6) continue;
    const i = cells[Math.floor(hash(s, cyc, 31) * cells.length)], x = i % W, y = (i / W) | 0;
    const at = spot(x, y);
    if (!at) continue;
    const X = at[0] + (hash(s, cyc, 32) - 0.5) * tile * 0.4, Y = at[1] + (hash(s, cyc, 33) - 0.5) * tile * 0.2, r = tile * (0.04 + f * 0.22);
    if (X < -r || Y < -r || X > cw + r || Y > ch + r) continue;
    ctx.moveTo(X + r, Y); ctx.ellipse(X, Y, r, r * 0.5, 0, 0, Math.PI * 2);
    drawn++;
  }
  if (!drawn) return;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = pt.splash;
  ctx.lineWidth = Math.max(0.8, tile * 0.025);
  ctx.stroke();
  wxStats.ripples = drawn;
}

function snow(ctx, cw, ch, fx, pt, t, low, sc) {
  const heavy = fx.heavy;
  const n = Math.min(MAXP, Math.round((heavy ? WX_FX.BLIZZARD : WX_FX.SNOW) * (low ? 0.5 : 1)));
  const slant = heavy ? 0.9 + fx.wind * 0.8 : 0.08 + fx.wind * 0.2, V = ch * (heavy ? 0.42 : 0.12), H2 = ch + 20, span = cw + ch * slant;
  ctx.globalAlpha = 1;
  ctx.fillStyle = pt.flake;
  for (let i = 0; i < n; i++) {
    const y = ((PY[i] + (t * V * SP[i]) / H2) % 1) * H2 - 10;
    const x = PX[i] * span - ch * slant + y * slant + Math.sin(t * 1.3 + SZ[i] * 6.28) * 7 * sc;
    const s = (1 + SZ[i] * 1.8) * sc;
    ctx.fillRect(x, y, s, s);
  }
  wxStats.flakes = n;
}

function fogBanks(ctx, cw, ch, fx, pt, t, low, ax, ay) {
  const col = pt.col, thick = pt.thick;
  // A light wash over everything, and the edges thick.
  ctx.globalAlpha = 1;
  ctx.fillStyle = pt.fogWash;
  ctx.fillRect(0, 0, cw, ch);
  const vg = veilFor(ctx, cw, ch, col, pt.veilA);
  if (vg) { ctx.fillStyle = vg; ctx.fillRect(0, 0, cw, ch); }
  // The banks: big flattened puffs drifting with the wind, thin in the middle of the screen, thick at its edges.
  const pic = puffFor(col);
  if (!pic) return;
  const nb = Math.min(MAXB, Math.round((fx.key === "blizzard" ? WX_FX.BLIZZ_BANKS : WX_FX.BANKS) * (low ? 0.5 : 1)));
  const big = Math.max(cw, ch), drift = 8 + fx.wind * 30, px = (ax - cw / 2) * 0.35, py = (ay - ch / 2) * 0.35;
  let drawn = 0;
  for (let j = 0; j < nb; j++) {
    const s = BS[j] * big, Wr = cw + 2 * s, Hr = ch + 1.2 * s; // wrapped while wholly off screen
    const x = ((((BX[j] * Wr + t * drift * BV[j] + px) % Wr) + Wr) % Wr) - s / 2;
    const y = ((((BY[j] * Hr + py + Math.sin(t * 0.07 + j) * 10) % Hr) + Hr) % Hr) - s * 0.6;
    const ex = (x - cw / 2) / (cw / 2), ey = (y - ch / 2) / (ch / 2), edge = Math.min(1, Math.hypot(ex, ey) / 1.2);
    ctx.globalAlpha = Math.min(0.9, (0.18 + 0.5 * edge) * thick);
    ctx.drawImage(pic, x - s / 2, y - s * 0.3, s, s * 0.6);
    drawn++;
  }
  ctx.globalAlpha = 1;
  wxStats.banks = drawn;
}
