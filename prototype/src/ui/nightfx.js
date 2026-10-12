// Night on the State Map: a time-of-day shade over the land, with the lights punching through it.
//
// The shade follows the clock (the hour and the minutes of the coming hour): day 07:00–19:00, dusk fading in over
// 19:00–21:00, full night 21:00–05:00, dawn fading out over 05:00–07:00. The sim's night (world.js isNight: 20:00 to
// 06:00, when bases see a tile and teams need lights) sits at the middle of each fade. Full night is a deep blue-black
// over the ground, 62% at Dark (Settings → Display → Night darkness), 38% at Light, none at Off.
//
// Lights cut holes in it with a warm glow: your bases with somebody home (sized by the base: the hub and its
// buildings), floodlights that can be lit (fuel or generator power: a cold white, wider), other groups' bases you know
// of (their windows), a festival's bonfires, your teams' lights (sim/lights.js) and camps' campfires, a timelapse
// frame's camp fire, a siege camp's fires, a crash site burning. Drawn by ui/render.js after the cached ground layers and
// before the per-frame things (bases, teams, hordes, labels, icons, selection): those stay at full brightness.
//
// Cost: one small offscreen canvas (a quarter of the map's device pixels each way, at most 960 wide), reused between frames and painted
// again only when the shade level moved by a step, the camera moved or a light came or went; each drawn frame copies
// it over the map with one drawImage. The hour is not in the map's cache key (the cached chunks never see the night).
// Skipped in the timelapse (days fly by: the map would strobe) and the minimap (a plan of the state, not a view).
// Pure UI: reads the state, never changes it, no dice.
import { LIGHTS, lightOf } from "../sim/lights.js";
import { partyTile, partyMembers, glideAt } from "../sim/parties.js";
import { contactable } from "../sim/orders.js";
import { count } from "../sim/buildings.js";
import { poweredType } from "../sim/power.js";
import { festivalNow } from "../sim/festival.js";
import { activeCrashes } from "../sim/crashes.js";

export const NIGHT_LEVELS = {
  off: { label: "Off", alpha: 0 },
  light: { label: "Light", alpha: 0.38 },
  dark: { label: "Dark", alpha: 0.62 },
};
export const NIGHT = { duskFrom: 19, duskTo: 21, dawnFrom: 5, dawnTo: 7, rgb: "6,10,30", step: 0.01, scale: 4, maxW: 960 };

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// How dark it is at an hour of the day (fractional, 0–24): 0 by day, 1 at night, eased through dusk and dawn.
export function nightLevel(h) {
  h = ((h % 24) + 24) % 24;
  const N = NIGHT;
  if (h >= N.dawnTo && h < N.duskFrom) return 0;
  if (h >= N.duskFrom && h < N.duskTo) return smooth((h - N.duskFrom) / (N.duskTo - N.duskFrom));
  if (h >= N.dawnFrom && h < N.dawnTo) return 1 - smooth((h - N.dawnFrom) / (N.dawnTo - N.dawnFrom));
  return 1;
}
// The shade's opacity: the level × the setting's full-night darkness (an unknown setting counts as Dark).
export const shadeAlpha = (level, setting = "dark") => level * (NIGHT_LEVELS[setting] || NIGHT_LEVELS.dark).alpha;
// The hour of day the map shows: the clock's hour plus the minutes of the coming hour (main.js view.hourFrac).
export const mapHour = (state, frac = 0) => (state.hour % 24) + Math.max(0, Math.min(0.999, frac || 0));

// The setting (ui/display.js applyDisplay sets it from the options).
const opt = { level: "dark" };
export const setNightShade = (v) => { opt.level = NIGHT_LEVELS[v] ? v : "dark"; };
export const nightShade = () => opt.level;

export const nightStats = { draws: 0, builds: 0, buildMs: 0, lights: 0 };
// A lightning flash this frame (ui/lightningfx.js lightningFrame fills it): the shade lifts all over by `all` (0–1)
// and round each strike (holes[0..n): [x, y, radius, strength] in world px, cut like a light's, a cold white).
export const nightFlash = { all: 0, n: 0, holes: Array.from({ length: 4 }, () => [0, 0, 0, 0]) };
const FLASH = "205,218,255";

// Warm (lamps, fires) and cold (floodlights) light, as rgb.
const WARM = "255,168,82", FIRE = "255,140,60", COLD = "214,232,255";

// The lights on the map now, in world pixels: [x, y, radius, strength 0–1, colour]. G: render.js geometry (tile
// centres and what each site is drawn as), boost: render.js zoomBoost (sprites grow when zoomed out, so do lights).
export function mapLights(state, G, boost, frac = 0, hex = 26) {
  const out = [];
  const at = (id) => (G ? [G.x[id], G.y[id]] : state.grid.toPixel(id, hex));
  const home = new Set();
  for (const s of state.survivors) if (s.alive && s.location && s.location.kind === "base") home.add(s.location.baseId);
  // Your bases: lit windows and the hearth where somebody is home, bigger for the hub and more buildings.
  for (const b of state.bases) {
    const [x, y] = at(b.tile);
    const hub = b.type === "hub" && b.tier !== 0, n = Math.min(12, (b.buildings || []).length);
    if (home.has(b.id)) out.push([x, y - 4 * boost, (hub ? 46 : 32) * boost + n * 2.2 * boost, hub ? 0.95 : 0.85, WARM]);
    if (b.camp === true && b.tier === 0 && b.fire !== false) out.push([x, y, 26 * boost, 0.85, FIRE]); // a camp's fire (sim/staging.js)
    if (count(b, "floodlights") && (poweredType(b, "floodlights") || (b.stock && (b.stock.fuel || 0) >= 2))) out.push([x, y, (hub ? 78 : 62) * boost, 0.9, COLD]);
    if (festivalNow(state, b)) out.push([x, y + 6 * boost, 58 * boost, 1, FIRE]);
  }
  // Other groups' bases you know of: drawn as a group base (render.js siteDesc kind 1), lit windows.
  if (G && G.siteDesc) for (const id of G.sites) {
    const d = G.siteDesc[id];
    if (d && d.kind === 1) out.push([G.x[id], G.y[id] - 4 * boost, 30 * boost, 0.7, WARM]);
  }
  // Your teams where the map shows them (render.js drawPlayerParty): their lights, a camp's fire.
  for (const p of state.parties) {
    if (p.owner !== "player") {
      if (p.phase === "siege" && state.live && state.live.has(partyTile(p))) { const [x, y] = at(partyTile(p)); out.push([x - 18 * boost, y + 14 * boost, 26 * boost, 0.75, FIRE]); }
      continue;
    }
    if (!(p.kind === "convoy" || contactable(p))) continue; // your teams: where they are (sim/orders.js)
    let [x, y] = at(partyTile(p));
    if (!state.timelapse && p.path && p.idx < p.path.length - 1) {
      const gl = glideAt(state, p, frac);
      if (gl && gl.to !== gl.from && gl.t > 0) {
        const [ax, ay] = at(gl.from), [bx, by] = at(gl.to);
        x = ax + (bx - ax) * gl.t; y = ay + (by - ay) * gl.t;
      }
    }
    let best = null, lit = 0;
    for (const s of partyMembers(state, p)) { const k = lightOf(s); if (k) { lit++; if (!best || LIGHTS[k].sight > LIGHTS[best].sight) best = k; } }
    if (best) out.push([x, y, (18 + (LIGHTS[best].sight - 7) * 6) * boost, Math.min(1, 0.6 + 0.1 * lit), best === "torch" ? FIRE : WARM]);
    if (p.phase === "task" && p.task && p.task.type === "camp") out.push([x + 14 * boost, y - 6 * boost, 24 * boost, 0.85, FIRE]);
  }
  // Raiders from outside at your walls (sim/visitors.js): their fires.
  for (const v of state.visitors || []) if (v.phase === "siege" && state.live && state.live.has(v.tile)) { const [x, y] = at(v.tile); out.push([x + 16 * boost, y + 12 * boost, 24 * boost, 0.7, FIRE]); }
  // A timelapse frame's camp fire, a crash burning (sim/chronicle.js, sim/crashes.js).
  const camp = state.staging;
  if (camp && camp.fire !== false) { const [x, y] = at(camp.tile); out.push([x, y, 26 * boost, 0.85, FIRE]); }
  for (const c of activeCrashes(state)) { const [x, y] = at(c.found ? c.tile : c.center); out.push([x, y, (c.found ? 16 : 24) * boost, c.found ? 0.5 : 0.8, FIRE]); }
  return out;
}

// ---------- the overlay ----------
let ov = null, octx = null, ovKey = "";
const makeCanvas = () => (typeof document !== "undefined" && document && typeof document.createElement === "function" ? document.createElement("canvas") : null);

// Draws the shade over the map (ctx: the map's context; its transform is saved and put back). v: { state, cw, ch:
// device pixels; S: device px per world px; ox, oy: the camera in device px; boost; G; frac; timelapse }.
// Returns the shade's opacity drawn (0: nothing drawn).
export function drawNight(ctx, v) {
  const { state } = v;
  if (v.timelapse || opt.level === "off") return 0;
  const a = shadeAlpha(nightLevel(mapHour(state, v.frac)), opt.level);
  if (a < NIGHT.step) return 0;
  const aq = Math.round(a / NIGHT.step) * NIGHT.step; // only a noticeable step paints the overlay again
  nightStats.draws++;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!ov) { ov = makeCanvas(); octx = ov ? ov.getContext("2d") : null; }
  if (!octx) {
    // No offscreen canvas (the headless tools): the plain shade, no lights.
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(${NIGHT.rgb},${(aq * (1 - nightFlash.all)).toFixed(2)})`;
    ctx.fillRect(0, 0, v.cw, v.ch);
    ctx.restore();
    return aq;
  }
  const q = Math.max(NIGHT.scale, Math.ceil(v.cw / NIGHT.maxW)), ow =Math.max(1, Math.ceil(v.cw / q)), oh = Math.max(1, Math.ceil(v.ch / q));
  const lights = mapLights(state, v.G, v.boost, v.frac);
  for (let i = 0; i < nightFlash.n; i++) { const h = nightFlash.holes[i]; lights.push([h[0], h[1], h[2], h[3], FLASH]); } // lightning
  // Only the lights that reach the screen; their signature (rounded to an overlay pixel) decides a repaint.
  const vis = [];
  let sig = 0;
  for (const L of lights) {
    const sx = (L[0] * v.S - v.ox) / q, sy = (L[1] * v.S - v.oy) / q, r = (L[2] * v.S) / q;
    if (sx + r < 0 || sy + r < 0 || sx - r > ow || sy - r > oh || r < 0.5) continue;
    vis.push([sx, sy, r, L[3], L[4]]);
    sig = (Math.imul(sig, 31) + Math.round(sx) * 7 + Math.round(sy) * 13 + Math.round(r) * 17 + Math.round(L[3] * 20)) | 0;
  }
  nightStats.lights = vis.length;
  const key = `${aq.toFixed(2)}|${ow}|${oh}|${vis.length}|${sig}`;
  if (key !== ovKey || ov.width !== ow || ov.height !== oh) {
    const t0 = performance.now();
    ovKey = key;
    if (ov.width !== ow || ov.height !== oh) { ov.width = ow; ov.height = oh; }
    const o = octx;
    o.globalCompositeOperation = "copy";
    o.fillStyle = `rgba(${NIGHT.rgb},${aq.toFixed(2)})`;
    o.fillRect(0, 0, ow, oh);
    // Holes: the darkness taken away round each light, most at its heart.
    o.globalCompositeOperation = "destination-out";
    for (const [x, y, r, k] of vis) {
      const g = o.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${(0.92 * k).toFixed(3)})`);
      g.addColorStop(0.45, `rgba(0,0,0,${(0.6 * k).toFixed(3)})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      o.fillStyle = g;
      o.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // The glow: a soft tint of the light's colour on the ground it lights, stronger the darker the night.
    o.globalCompositeOperation = "source-over";
    const tint = Math.min(1, aq / 0.5);
    for (const [x, y, r, k, col] of vis) {
      const g = o.createRadialGradient(x, y, 0, x, y, r * 0.8);
      g.addColorStop(0, `rgba(${col},${(0.2 * k * tint).toFixed(3)})`);
      g.addColorStop(1, `rgba(${col},0)`);
      o.fillStyle = g;
      o.fillRect(x - r, y - r, r * 2, r * 2);
    }
    nightStats.builds++;
    nightStats.buildMs += performance.now() - t0;
  }
  ctx.globalAlpha = 1 - nightFlash.all; // a flash lifts it all over
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(ov, 0, 0, ow, oh, 0, 0, ow * q, oh * q);
  ctx.globalAlpha = 1;
  ctx.restore();
  return aq;
}
