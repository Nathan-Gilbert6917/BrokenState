// The minimap (Menu → Options → Display → Minimap, M, or its own – / ▣ button): the whole state in the map's
// bottom-right corner. Shows only what you know, like the map (render.js liveSet: the dev tools' Reveal map shows
// everything): the land shaded live / reported / unknown, water and roads, the Territory, Infection and Coalition
// layers when they are on, then your bases and teams, the hordes and hives you know of, other groups' bases you know
// (Territory layer), and the part of the map on screen as a frame. Click or drag on it to look there.
//
// Cheap by design (the desktop app runs the map at 120 fps at 4K): the land is one small image, a pixel block per
// tile, worked out again only when the hour, the fog, the layers or the colours change (at most twice a second),
// and only the tiles that changed are written. The dots are gathered at most twice a second; the minimap canvas is
// drawn again (the image scaled, the dots, the frame) only when one of those or the camera changed, at most 30 times
// a second. Hidden, it costs one check a frame.
import { unseenOutpost } from "../sim/hiding.js"; // the groups' hidden outposts
import { TERRAIN } from "../sim/data.js";
import { partyTile, plannedTile } from "../sim/parties.js";
import { contactable } from "../sim/orders.js";
import { camera, view, HEX, liveSet, coalitionLand } from "./render.js";
import { PAL } from "./palette.js";
import { iceRow } from "../sim/weather.js"; // frozen rivers show as ice
import { onForgetPictures } from "./pictures.js";

const SQ3 = Math.sqrt(3);
const SHADES = [1, 0.72, 0.42]; // live, reported, unknown (render.js SHADES)
const ROAD = [205, 187, 138];   // render.js road colour
const ICE_RGB = [205, 225, 238]; // a frozen river (render.js ICE_FILL)
const PLAYER = "#4f8fd6";       // your bases (render.js PLAYER_COLOR)
const DATA_MS = 500, DRAW_MS = 33;

let box = null, cv = null, g2 = null, showBtn = null, mapEl = null, OPT = null;
let mapW = 0, mapH = 0;                    // the State Map's size on screen (CSS px), for the camera frame
let land = null;                           // { cv, ctx, img, px (Uint32 view), cols, rows, col (Uint32 per tile), state }
let sig = "", dataAt = -1e9, drawAt = -1e9, dirty = true, shownState = null;
let dots = null;                           // what the dynamic layer draws (gathered every DATA_MS)
let camSig = "";
let dragging = false;

const rgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
const TERR_RGB = Object.fromEntries(Object.entries(TERRAIN).map(([k, t]) => [k, rgb(t.color)]));

// main.js: the map's box (mapwrap), the map canvas and the options.
export function initMinimap(wrap, mapCanvas, options) {
  OPT = options;
  mapEl = mapCanvas;
  if (!wrap || typeof document === "undefined") return;
  box = document.createElement("div");
  box.id = "minimap";
  box.className = "hidden";
  box.innerHTML = `<canvas></canvas><button class="mm-hide" data-action="mm-toggle" data-tip="Hide the minimap (M). Click or drag on it to look at that part of the map.">–</button>`;
  wrap.appendChild(box);
  showBtn = document.createElement("button");
  showBtn.id = "mm-show";
  showBtn.className = "hidden";
  showBtn.dataset.action = "mm-toggle";
  showBtn.dataset.tip = "Show the minimap (M)";
  showBtn.textContent = "▣ Minimap";
  wrap.appendChild(showBtn);
  cv = box.querySelector("canvas");
  g2 = cv.getContext("2d");
  if (typeof ResizeObserver !== "undefined") { const ro = new ResizeObserver(fit); ro.observe(cv); ro.observe(mapEl); }
  window.addEventListener("resize", fit);
  fit();
  cv.addEventListener("mousedown", (e) => { if (e.button !== 0) return; e.preventDefault(); dragging = true; look(e); });
  window.addEventListener("mousemove", (e) => { if (dragging) { if (e.buttons === 0) dragging = false; else look(e); } });
  window.addEventListener("mouseup", () => { dragging = false; });
  // A finger (or a pen) drags the same way, by its own pointer (the mouse keeps the listeners above). Cancelling the
  // press keeps the browser from scrolling and from sending the mouse events of a tap.
  let fing = null;
  cv.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || !e.isPrimary) return;
    e.preventDefault();
    fing = e.pointerId;
    try { cv.setPointerCapture(e.pointerId); } catch { /* the canvas still hears it while the finger is on it */ }
    look(e);
  });
  cv.addEventListener("pointermove", (e) => { if (e.pointerId === fing) look(e); });
  for (const k of ["pointerup", "pointercancel"]) cv.addEventListener(k, (e) => { if (e.pointerId === fing) fing = null; });
  cv.addEventListener("touchstart", (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
}

// The canvas's pixels follow its box (the minimap size, the UI size, the screen's pixel ratio), and the map's size
// on screen sets the camera frame. On a resize, and with the data twice a second (a resize can come without one).
function fit() {
  if (!cv || !mapEl) return;
  const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; dirty = true; }
  const m = mapEl.getBoundingClientRect();
  if (m.width !== mapW || m.height !== mapH) { mapW = m.width; mapH = m.height; dirty = true; }
}

// The world rectangle the minimap shows: the whole map (render.js: tile centres from grid.toPixel).
const worldBox = (grid) => ({ x: (-SQ3 / 2) * HEX, y: -HEX, w: SQ3 * HEX * (grid.width + 0.5), h: HEX * (1.5 * (grid.height - 1) + 2) });

// Centre the camera on the point under the mouse.
let lookState = null;
function look(e) {
  if (!lookState) return;
  const r = cv.getBoundingClientRect(), W = worldBox(lookState.grid);
  const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), fy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
  camera.x = W.x + fx * W.w - mapW / (2 * camera.zoom);
  camera.y = W.y + fy * W.h - mapH / (2 * camera.zoom);
  dirty = true;
}

// Every frame (main.js step). Shown on the State Map once a game has started, not over a battle, the title screen or
// the timelapse.
export function minimapFrame(state, ui, now) {
  if (!box) return;
  const want = !!OPT && OPT.minimap !== false && ui.started && !ui.title && !ui.timelapse && !state.combat;
  const btn = !!OPT && OPT.minimap === false && ui.started && !ui.title && !ui.timelapse && !state.combat;
  if (box.classList.contains("hidden") === want) { box.classList.toggle("hidden", !want); dirty = true; dataAt = -1e9; } // shown again: measured and gathered at once
  if (showBtn.classList.contains("hidden") === btn) showBtn.classList.toggle("hidden", !btn);
  if (!want) { dragging = false; return; }
  lookState = state;
  if (shownState !== state) { shownState = state; land = null; sig = ""; box.style.aspectRatio = `${worldBox(state.grid).w} / ${worldBox(state.grid).h}`; dataAt = -1e9; }
  if (now - dataAt >= DATA_MS) {
    dataAt = now;
    fit();
    if (updateLand(state)) dirty = true;
    dots = gatherDots(state);
    dirty = true;
  }
  const cs = `${camera.x}|${camera.y}|${camera.zoom}`;
  if (cs !== camSig) { camSig = cs; dirty = true; }
  if (!dirty || now - drawAt < DRAW_MS) return;
  drawAt = now;
  dirty = false;
  draw(state);
}

// ---------- the land: one pixel block per tile ----------
// The image is (2 × columns + 1) × (2 × rows): each tile a 2 × 2 block, odd rows a pixel to the right, so it lines up
// with the hex map when stretched over the map's rectangle.
function updateLand(state) {
  const live = liveSet(state), k = state.knowledge || [];
  const layers = ["territory", "infection", "coalition"].filter((l) => view.layers.has(l)).join(",");
  const s = `${state.hour}|${live === state.live ? live.size : "all"}|${layers}|${PAL.safe}|${state.tiles.length}`;
  if (s === sig && land) return false;
  sig = s;
  const g = state.grid, cols = g.width, rows = g.height, n = state.tiles.length;
  if (!land || land.state !== state) {
    const c = document.createElement("canvas");
    c.width = 2 * cols + 1;
    c.height = 2 * rows;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(c.width, c.height);
    land = { cv: c, ctx, img, px: new Uint32Array(img.data.buffer), cols, rows, col: new Uint32Array(n), state };
  }
  const terr = view.layers.has("territory"), inf = view.layers.has("infection"), coal = view.layers.has("coalition") ? coalitionLand(state) : null;
  const owners = new Map(state.factions.map((f) => [f.id, rgb(f.color)]));
  const mine = rgb(PLAYER), infRgb = PAL.infRgb.split(",").map(Number), coalRgb = coal ? coal.owners.map((o) => (o ? rgb(o.color) : null)) : null;
  let changed = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  const ice = state.weather ? iceRow(state) : -1; // rivers frozen down to this row (sim/weather.js ICE): pale ice
  for (let i = 0; i < n; i++) {
    const t = state.tiles[i], isLive = live.has(i), snap = isLive ? null : k[i];
    const fog = isLive ? 0 : snap ? 1 : 2;
    let [r, gg, b] = t.terrain === "water" && !t.bridge && t.y <= ice ? ICE_RGB : TERR_RGB[t.terrain] || TERR_RGB.plains || [90, 90, 90];
    if (t.terrain !== "water" && t.roadLinks && t.roadLinks.length) { r = (r + ROAD[0]) / 2; gg = (gg + ROAD[1]) / 2; b = (b + ROAD[2]) / 2; }
    // Tints, strongest last: Territory (who holds the tile, as far as you know), Infection, Coalition.
    let tc = null, ta = 0;
    if (fog < 2 && terr) { const o = isLive ? t.owner : snap.owner; tc = o === "player" ? mine : o != null ? owners.get(o) : null; ta = 0.4; }
    if (tc) { r += (tc[0] - r) * ta; gg += (tc[1] - gg) * ta; b += (tc[2] - b) * ta; }
    const v = fog < 2 && inf ? (isLive ? t.infection : snap.infection) : 0;
    if (v > 0) { const a = Math.min(0.75, v * 0.6); r += (infRgb[0] - r) * a; gg += (infRgb[1] - gg) * a; b += (infRgb[2] - b) * a; }
    tc = coal && coal.owner[i] ? coalRgb[coal.owner[i]] : null;
    if (tc) { r += (tc[0] - r) * 0.35; gg += (tc[1] - gg) * 0.35; b += (tc[2] - b) * 0.35; }
    const f = SHADES[fog];
    const c = (255 << 24) | (Math.round(b * f) << 16) | (Math.round(gg * f) << 8) | Math.round(r * f); // little-endian RGBA
    if (land.col[i] === c >>> 0) continue; // never 0: the alpha byte is 255
    land.col[i] = c >>> 0;
    changed++;
    const col = i % cols, row = (i - col) / cols, px = 2 * col + (row & 1), py = 2 * row, W = land.cv.width;
    land.px[py * W + px] = c; land.px[py * W + px + 1] = c; land.px[(py + 1) * W + px] = c; land.px[(py + 1) * W + px + 1] = c;
    if (px < x0) x0 = px; if (py < y0) y0 = py; if (px + 1 > x1) x1 = px + 1; if (py + 1 > y1) y1 = py + 1;
  }
  if (changed) land.ctx.putImageData(land.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  return changed > 0;
}

// ---------- the dots ----------
function gatherDots(state) {
  const live = liveSet(state), k = state.knowledge || [], g = state.grid;
  const at = (tile) => g.toPixel(tile, HEX);
  const out = { bases: [], teams: [], hordes: [], hives: [], groups: [] };
  for (const b of state.bases) out.bases.push({ p: at(b.tile), hub: b.type === "hub" });
  if (state.staging) out.bases.push({ p: at(state.staging.tile), hub: false });
  if (view.layers.has("teams")) for (const p of state.parties) {
    if (p.owner !== "player" || !p.path) continue;
    const known = contactable(p) || p.kind === "convoy" || p.radioLive;
    const tile = known ? partyTile(p) : p.etaOut != null ? plannedTile(state, p) : null;
    if (tile == null || tile < 0) continue;
    out.teams.push({ p: at(tile), waiting: p.phase === "waiting", known });
  }
  if (view.layers.has("hordes")) {
    const size = new Map();
    for (const h of state.hordes) if (live.has(h.tile)) size.set(h.tile, (size.get(h.tile) || 0) + h.size);
    for (let i = 0; i < state.tiles.length; i++) {
      if (live.has(i)) { if (state.tiles[i].hive) out.hives.push({ p: at(i), live: true }); continue; }
      const s = k[i];
      if (!s) continue;
      if (s.hordeSize) size.set(i, s.hordeSize);
      if (s.hive) out.hives.push({ p: at(i), live: false });
    }
    for (const [tile, n] of size) out.hordes.push({ p: at(tile), n, live: live.has(tile) });
  }
  if (view.layers.has("territory")) for (const f of state.factions) {
    if (!f.alive) continue;
    for (const t of f.bases) {
      const s = k[t];
      if ((live.has(t) && !unseenOutpost(state, t)) || (s && s.factionBase === f.id)) out.groups.push({ p: at(t), color: f.color }); // sim/hiding.js: not a hidden outpost you have not found
    }
  }
  return out;
}

// ---------- drawing ----------
function draw(state) {
  const W = worldBox(state.grid), w = cv.width, h = cv.height;
  const sx = w / W.w, sy = h / W.h, X = (x) => (x - W.x) * sx, Y = (y) => (y - W.y) * sy;
  g2.setTransform(1, 0, 0, 1, 0, 0);
  g2.fillStyle = "#0d0f12";
  g2.fillRect(0, 0, w, h);
  if (land) { g2.imageSmoothingEnabled = true; g2.drawImage(land.cv, 0, 0, w, h); }
  const u = Math.max(1.5, w / 110); // a dot's radius in canvas pixels: grows with the minimap
  const sq = (x, y, r, fill, line) => { g2.fillStyle = fill; g2.fillRect(x - r, y - r, 2 * r, 2 * r); if (line) { g2.strokeStyle = line; g2.lineWidth = Math.max(1, u * 0.4); g2.strokeRect(x - r, y - r, 2 * r, 2 * r); } };
  const dot = (x, y, r, fill, line, alpha = 1) => { g2.globalAlpha = alpha; g2.beginPath(); g2.arc(x, y, r, 0, Math.PI * 2); g2.fillStyle = fill; g2.fill(); if (line) { g2.strokeStyle = line; g2.lineWidth = Math.max(1, u * 0.35); g2.stroke(); } g2.globalAlpha = 1; };
  const d = dots;
  if (d) {
    for (const o of d.groups) sq(X(o.p[0]), Y(o.p[1]), u * 0.9, o.color, "#0d0f12");
    for (const o of d.hives) { const x = X(o.p[0]), y = Y(o.p[1]), r = u * 1.3; g2.globalAlpha = o.live ? 1 : 0.7; g2.beginPath(); g2.moveTo(x, y - r); g2.lineTo(x + r, y); g2.lineTo(x, y + r); g2.lineTo(x - r, y); g2.closePath(); g2.fillStyle = `rgb(${PAL.ringEdgeRgb})`; g2.fill(); g2.strokeStyle = "#0d0f12"; g2.lineWidth = Math.max(1, u * 0.35); g2.stroke(); g2.globalAlpha = 1; }
    for (const o of d.hordes) dot(X(o.p[0]), Y(o.p[1]), u * (o.n >= 200 ? 1.4 : o.n >= 60 ? 1.1 : 0.8), PAL.foe, "#0d0f12", o.live ? 1 : 0.55);
    for (const o of d.bases) sq(X(o.p[0]), Y(o.p[1]), u * (o.hub ? 1.5 : 1.1), PLAYER, "#e6e2d8");
    for (const o of d.teams) dot(X(o.p[0]), Y(o.p[1]), u * 0.95, o.waiting ? "#ffd166" : "#7fd0ff", "#0d0f12", o.known ? 1 : 0.5);
  }
  // The part of the map on screen.
  if (mapW > 0 && mapH > 0) {
    const fx = X(camera.x), fy = Y(camera.y), fw = (mapW / camera.zoom) * sx, fh = (mapH / camera.zoom) * sy;
    g2.lineWidth = Math.max(1, u * 0.5);
    g2.strokeStyle = "rgba(13,15,18,0.8)";
    g2.strokeRect(fx - 1, fy - 1, fw + 2, fh + 2);
    g2.strokeStyle = "#e6e2d8";
    g2.strokeRect(fx, fy, fw, fh);
  }
}

// For the headless test: what the minimap would show (the land's fog per tile and the dots), without a DOM.
export function minimapDots(state) { return gatherDots(state); }
onForgetPictures(() => { land = null; sig = ""; dirty = true; }); // ui/pictures.js: the land is drawn again after a lost GPU context
