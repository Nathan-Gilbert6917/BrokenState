// Lights in a night battle (b.night; dusk, b.dark, lighter): everyone carrying a light (sim/lights.js, u.light: set by
// sim/stealth.js) shines it. A headlamp, a flashlight (a weapon light or a helmet light counts as one) and a spotlight
// throw a soft cone the way the unit faces (u.face, the sim's: set by every move, shot and blow), as long as the light
// lets them see (LIGHTS sight: 6–9 tiles; a spotlight the full 12) and as wide as its cone; a torch and a lantern a warm
// flickering pool all around (LIGHTS cone: the pool's radius). Fires, flares and the base's floodlit cells light the
// ground too. The rest of the scene is darker than it was, so the beams read.
// Fog-of-war honesty: a beam is drawn only for your people and for the enemies (and third side) your people see now
// (a raider's flashlight is a tell only once he is in sight; an unseen one shows nothing), and every light is clipped
// to the cells your people see, so no light falls where you do not see and nothing hidden is lit or drawn. The sim's
// rules are untouched: a light's `seen` (detection range, sim/stealth.js detectRange) is what the beam shows, nothing
// more. No vehicle has lights in the sim, so none are drawn.
// Cheap: the lights are painted at half the screen's resolution into one reused canvas (gradients cached, unit radius,
// placed by the transform), clipped with a one-pixel-a-tile mask of the cells not seen, then used twice: added as a
// warm glow on the ground before the units are drawn, and cut out of the night's darkness laid over the whole scene.
import { LIGHTS } from "../sim/lights.js";
import { FLARE } from "../sim/throwables.js";

export const LIGHT_SCALE = 0.5;               // the light canvas's resolution, of the screen's
export const DARK = { night: 0.5, dusk: 0.26 }; // the darkness over what no light reaches (was 0.34 / 0.18)
const DARK_RGB = "4,8,22";

let mkCanvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
export function setLightsCanvas(fn) { mkCanvas = fn; LC = DC = MASK = null; GRADS.clear(); }

// ---------- beam geometry ----------
// What a light looks like on the ground: a cone { kind: "cone", len, half } (tiles; half: the half-angle) or a pool
// { kind: "pool", r }; its colour. len from LIGHTS sight (a headlamp's and a flashlight's three quarters of it, a
// spotlight's all), the cone as wide as LIGHTS cone at its end.
const WARM = { torch: "255,150,64", lantern: "255,204,120" };
export function beamOf(key) {
  const L = LIGHTS[key] || LIGHTS.flashlight;
  if (L.round) return { kind: "pool", r: L.cone, col: WARM[key] || "255,200,120", a: key === "torch" ? 0.85 : 0.8 };
  const len = key === "spotlight" ? L.sight : L.sight * 0.75;
  return { kind: "cone", len, half: Math.atan2(L.cone / 2, len), col: key === "spotlight" ? "240,246,255" : "255,244,214", a: key === "spotlight" ? 1 : 0.85 };
}
// The way a unit faces (world radians): the sim's u.face, else its last move, else east.
export function facingAngle(b, t) {
  const f = t.face;
  if (f && (f[0] || f[1])) return Math.atan2(f[1], f[0]);
  for (let i = (b.fx || []).length - 1; i >= 0; i--) {
    const e = b.fx[i];
    if (e.type === "move" && e.unit === t.id && e.path && e.path.length) {
      const p = e.path[e.path.length - 1], q = e.path.length > 1 ? e.path[e.path.length - 2] : e.from;
      if (q && (p[0] !== q[0] || p[1] !== q[1])) return Math.atan2(p[1] - q[1], p[0] - q[0]);
    }
  }
  return 0;
}
// Every light to draw now: { x, y (world, tile units), beam, ang, id, unit }. vis/seen: the view's (who your people see).
// pos(t): where a unit is drawn (sliding along its move).
export function lightSources(b, v, pos = (t) => [t.x + 0.5, t.y + 0.5]) {
  const out = [];
  if (!b.night && !b.dark) return out;
  for (const t of b.units) {
    if (!t.light || t.dead || t.down || t.left || t.fled || t.off || t.x < 0) continue;
    if (t.side !== "player" && !(v && v.seen && v.seen.has(t.id))) continue; // an enemy's light only once you see them
    if (b.floors && (t.f || 0) !== (b.floor || 0)) continue;
    const [x, y] = pos(t);
    out.push({ x, y, beam: beamOf(t.light), ang: facingAngle(b, t), id: t.id, unit: t });
  }
  return out;
}

// ---------- drawing ----------
let LC = null, DC = null, MASK = null;
const GRADS = new Map();
function grad(c, col, a, soft) {
  const k = `${col}:${a}:${soft ? 1 : 0}`;
  let g = GRADS.get(k);
  if (!g) {
    g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
    if (!g || !g.addColorStop) return `rgba(${col},${a * 0.5})`; // a stub canvas (the tools)
    if (soft) { g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(0.5, `rgba(${col},${a * 0.55})`); g.addColorStop(1, `rgba(${col},0)`); }
    else { g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(0.15, `rgba(${col},${a * 0.95})`); g.addColorStop(0.65, `rgba(${col},${a * 0.5})`); g.addColorStop(1, `rgba(${col},0)`); }
    GRADS.set(k, g);
  }
  return g;
}
// The cells nobody of yours sees, one pixel a tile in map space (opaque where not seen). Kept while the view's
// visibility array stays the same object (ui/combat.js caches the view per battle revision).
function maskFor(b, vis) {
  if (MASK && MASK.b === b && MASK.vis === vis && MASK.w === b.w && MASK.h === b.h) return MASK.cv;
  const cv = MASK && MASK.w === b.w && MASK.h === b.h ? MASK.cv : mkCanvas(b.w, b.h);
  const c = cv.getContext("2d"), img = c.createImageData(b.w, b.h), d = img.data;
  for (let i = 0; i < b.w * b.h; i++) if (!vis[i]) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 0; d[i * 4 + 3] = 255; }
  c.putImageData(img, 0, 0);
  MASK = { b, vis, w: b.w, h: b.h, cv };
  return cv;
}
const smooth = new Map(); // unit id → the beam's angle as drawn (turning toward the facing, not snapping)
let lastNow = 0;

// Paint the lights into the light canvas. xf: the map → screen affine for the ground (tile units: isoview.js
// groundXform with 1 px a tile). Returns the number of lights, 0 when there is nothing to draw (by day).
export function paintLights(b, v, xf, cw, ch, now = 0, pos) {
  LIGHTS_DRAWN.n = 0;
  if (!b.night && !b.dark) return 0;
  const w = Math.max(1, Math.ceil(cw * LIGHT_SCALE)), h = Math.max(1, Math.ceil(ch * LIGHT_SCALE));
  if (!LC || LC.width !== w || LC.height !== h) { LC = mkCanvas(w, h); DC = mkCanvas(w, h); GRADS.clear(); }
  const c = LC.getContext("2d");
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = "source-over";
  c.globalAlpha = 1;
  c.clearRect(0, 0, w, h);
  const k = LIGHT_SCALE, base = [xf[0] * k, xf[1] * k, xf[2] * k, xf[3] * k, xf[4] * k, xf[5] * k];
  const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
  lastNow = now;
  c.globalCompositeOperation = "lighter";
  const src = lightSources(b, v, pos);
  for (const s of src) {
    const B = s.beam;
    c.setTransform(...base);
    c.translate(s.x, s.y);
    if (B.kind === "pool") {
      const fl = s.unit.light === "torch" ? 1 + 0.06 * Math.sin(now / 83 + s.id * 1.7) + 0.03 * Math.sin(now / 37 + s.id) : 1 + 0.015 * Math.sin(now / 140 + s.id);
      c.globalAlpha = s.unit.light === "torch" ? 0.88 + 0.12 * Math.sin(now / 61 + s.id * 2.3) : 1;
      c.scale(B.r * fl, B.r * fl);
      c.fillStyle = grad(c, B.col, B.a, true);
      c.beginPath(); c.arc(0, 0, 1, 0, Math.PI * 2); c.fill();
      continue;
    }
    // A cone, turning smoothly toward where the unit faces.
    let a = smooth.has(s.id) ? smooth.get(s.id) : s.ang;
    const diff = Math.atan2(Math.sin(s.ang - a), Math.cos(s.ang - a));
    a = dt > 0 ? a + diff * Math.min(1, dt * 9) : s.ang;
    smooth.set(s.id, a);
    c.rotate(a);
    // The spill around the carrier, the soft wide edge, the core.
    c.save(); c.scale(1.1, 1.1); c.globalAlpha = 0.55; c.fillStyle = grad(c, B.col, B.a, true); c.beginPath(); c.arc(0, 0, 1, 0, Math.PI * 2); c.fill(); c.restore();
    c.scale(B.len, B.len);
    c.fillStyle = grad(c, B.col, B.a, false);
    c.globalAlpha = 0.4;
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 1, -B.half * 1.45, B.half * 1.45); c.closePath(); c.fill();
    c.globalAlpha = 0.85;
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 1, -B.half, B.half); c.closePath(); c.fill();
    c.globalAlpha = 1;
  }
  let n = src.length;
  // Fires and flares (sim/throwables.js) and the floodlit cells of a base at night (sim/deploy.js b.lit).
  c.setTransform(...base);
  for (const f of b.fires || []) {
    if (b.floors && (f.f || 0) !== (b.floor || 0)) continue;
    const r = 2.2 * (1 + 0.07 * Math.sin(now / 71 + f.x * 3 + f.y));
    c.setTransform(...base); c.translate(f.x + 0.5, f.y + 0.5); c.scale(r, r);
    c.globalAlpha = 0.9; c.fillStyle = grad(c, "255,140,50", 0.9, true); c.beginPath(); c.arc(0, 0, 1, 0, Math.PI * 2); c.fill();
    n++;
  }
  for (const f of b.flares || []) {
    const r = (f.r || FLARE.r) * (1 + 0.03 * Math.sin(now / 47 + f.x));
    c.setTransform(...base); c.translate(f.x + 0.5, f.y + 0.5); c.scale(r, r);
    c.globalAlpha = 1; c.fillStyle = grad(c, "255,96,76", 0.8, true); c.beginPath(); c.arc(0, 0, 1, 0, Math.PI * 2); c.fill();
    n++;
  }
  if (b.lit && b.floodAim) {
    c.setTransform(...base);
    c.globalAlpha = 0.6; c.fillStyle = "rgb(255,236,170)";
    c.beginPath();
    let any = false;
    for (let i = 0; i < b.w * b.h; i++) if (b.lit[i]) { c.rect(i % b.w, (i / b.w) | 0, 1, 1); any = true; }
    if (any) { c.fill(); n++; }
  }
  c.globalAlpha = 1;
  // Clip to what your people see: the light is cut out of every cell they do not.
  if (n && v && v.vis) {
    c.setTransform(...base);
    c.globalCompositeOperation = "destination-out";
    c.imageSmoothingEnabled = false;
    c.drawImage(maskFor(b, v.vis), 0, 0);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = "source-over";
  LIGHTS_DRAWN.n = n;
  LIGHTS_DRAWN.src = src;
  return n;
}
export const LIGHTS_DRAWN = { n: 0, src: [] };

// The lights as a warm glow on the ground (before the units and blocks are drawn).
export function drawGlow(ctx, cw, ch) {
  if (!LIGHTS_DRAWN.n || !LC) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.3;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(LC, 0, 0, cw, ch);
  ctx.restore();
}
// The night's darkness over everything, the lights cut out of it.
export function drawDarkness(ctx, b, cw, ch) {
  if (!b.night && !b.dark) return;
  const a = b.night ? DARK.night : DARK.dusk;
  if (!LIGHTS_DRAWN.n || !DC) { ctx.fillStyle = `rgba(${DARK_RGB},${a})`; ctx.fillRect(0, 0, cw, ch); return; }
  const c = DC.getContext("2d");
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = "source-over";
  c.clearRect(0, 0, DC.width, DC.height);
  c.fillStyle = `rgba(${DARK_RGB},${a})`;
  c.fillRect(0, 0, DC.width, DC.height);
  c.globalCompositeOperation = "destination-out";
  c.drawImage(LC, 0, 0);
  c.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(DC, 0, 0, cw, ch);
  ctx.restore();
}
