// The title screen: what the game opens on (main.js showTitle), in front of everything else. Continue (the latest
// save), New game (the new-run screen), Load game (the menu's save list), Settings (the menu's Options tab), How to
// play (its Help tab) and, in the desktop app, Quit. The menu itself (ui/settings.js) opens over the title.
//
// Behind it one of three animated backgrounds (options.titleBg), each drawn in code: a ruined skyline at dusk, the
// living State Map (the game's own renderer on the main canvas, panning over a world that runs on its own) and a
// campfire at night. The logo comes in four styles (options.titleStyle). Both are picked in the corner of the title
// screen and remembered with the other options (ui/saves.js).
import { latestSave, listSaves } from "./saves.js";
import { openSettings } from "./settings.js";
import { camera, view, HEX } from "./render.js";
import { GAME_VERSION } from "../sim/save.js";

export const TITLE_BGS = [["skyline", "Ruined skyline"], ["map", "Living State Map"], ["camp", "Campfire at night"]];
export const TITLE_STYLES = [["stencil", "Cracked stencil"], ["blood", "Blood-red serif"], ["spray", "Spray-painted"], ["minimal", "Clean minimal"]];
const MAP_TICK_S = 0.7; // the living map's world runs an hour every this many seconds

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const pick = (list, v) => (list.some(([k]) => k === v) ? v : list[0][0]);
export const titleBg = (o) => pick(TITLE_BGS, o && o.titleBg);
export const titleStyle = (o) => pick(TITLE_STYLES, o && o.titleStyle);

// main.js hands over: options, saveOptions(), desktop, getState(), tick() (an hour of the living map's world), newGame(),
// quit(), refresh().
let API = null;
export function initTitle(api) { API = api; }

export function showTitle(ui) {
  ui.title = true;
  mapClock = { t: 0, acc: 0 };
}
// Over the whole window, the map included (main.js does not draw the map behind it).
export const titleCovers = (ui) => !!ui.title && !(API && titleBg(API.options) === "map");

// ---------- the menu ----------
export function titleMenuHTML(ui, api = API) {
  const last = latestSave();
  const n = listSaves().length;
  const items = [];
  if (last) items.push(`<button class="tt-item primary" data-action="set-continue"${tip(`Load the latest save: ${last.name}`)}>Continue<small>${esc(last.name)} · day ${esc(last.day ?? "?")}</small></button>`);
  items.push(`<button class="tt-item${last ? "" : " primary"}" data-action="title-new"${tip("Pick the map, the mode and your people, then start")}>New game</button>`);
  items.push(`<button class="tt-item" data-action="title-load"${n ? "" : " disabled"}${tip(n ? `Pick one of your ${n} save${n === 1 ? "" : "s"}, or load a save file` : "No saves yet")}>Load game</button>`);
  items.push(`<button class="tt-item" data-action="title-settings"${tip("Autosave, confirmations, display, the keys")}>Settings</button>`);
  items.push(`<button class="tt-item" data-action="title-help"${tip("How the game works, one topic at a time")}>How to play</button>`);
  if (api && api.desktop) items.push(`<button class="tt-item" data-action="title-quit">Quit</button>`);
  return items.join("");
}
function lookHTML(o) {
  const row = (label, action, list, cur) => `<span class="tt-pick"><span class="tt-lbl">${label}</span><button data-action="${action}" data-dir="-1" aria-label="Previous">‹</button><b>${esc(list.find(([k]) => k === cur)[1])}</b><button data-action="${action}" data-dir="1" aria-label="Next">›</button></span>`;
  return row("Background", "title-bg", TITLE_BGS, titleBg(o)) + row("Title", "title-style", TITLE_STYLES, titleStyle(o));
}

const cycle = (list, cur, dir) => list[(list.findIndex(([k]) => k === cur) + (Number(dir) || 1) + list.length) % list.length][0];
// main.js registers them: fn(state, ui, data, api).
export const TITLE_ACTIONS = {
  "title-new": (state, ui, d, api = API) => { ui.title = false; api.newGame(); },
  "title-load": (state, ui) => openSettings(ui, "game"),
  "title-settings": (state, ui) => openSettings(ui, "options"),
  "title-help": (state, ui) => openSettings(ui, "help"),
  "title-quit": (state, ui, d, api = API) => api.quit(),
  "title-bg": (state, ui, d, api = API) => { api.options.titleBg = cycle(TITLE_BGS, titleBg(api.options), d.dir); api.saveOptions(); },
  "title-style": (state, ui, d, api = API) => { api.options.titleStyle = cycle(TITLE_STYLES, titleStyle(api.options), d.dir); api.saveOptions(); },
};

// Up and down move between the buttons, Enter presses one (the browser's own). Returns true when it used the key.
export function titleKey(ui, e) {
  if (e.code !== "ArrowUp" && e.code !== "ArrowDown") return false;
  const list = [...document.querySelectorAll("#tt-menu .tt-item:not(:disabled)")];
  if (!list.length) return false;
  const i = list.indexOf(document.activeElement);
  const next = i < 0 ? 0 : (i + (e.code === "ArrowDown" ? 1 : -1) + list.length) % list.length;
  list[next].focus();
  return true;
}

// ---------- the screen (DOM) ----------
let root = null, bgCanvas = null, scene = null, sceneKey = "", logoKey = "", menuShown = "", lookShown = "", lastFrame = 0;
let mapClock = { t: 0, acc: 0 };

function build() {
  root = document.createElement("div");
  root.id = "title";
  root.className = "hidden";
  root.innerHTML = `<canvas id="titlebg"></canvas><div class="tt-shade"></div>
    <div class="tt-main"><div class="tt-logo" id="tt-logo"></div><nav class="tt-menu" id="tt-menu"></nav></div>
    <div class="tt-look" id="tt-look"></div><div class="tt-ver">Broken State · prototype ${esc(GAME_VERSION)}</div>`;
  document.body.appendChild(root);
  bgCanvas = root.querySelector("#titlebg");
}

// Called on every refresh (main.js): shows or hides the screen and brings the menu up to date.
export function syncTitle(state, ui) {
  if (typeof document === "undefined") return;
  if (!root) { if (!ui.title) return; build(); }
  const o = API.options;
  const on = !!ui.title;
  const bg = titleBg(o);
  root.classList.toggle("hidden", !on);
  root.classList.toggle("covered", on && !!(ui.settings || ui.zombieLook)); // the menu opens over the title: only the background shows
  root.dataset.bg = bg;
  document.body.classList.toggle("title-map", on && bg === "map");
  if (on && bg === "map") view.devReveal = true; // the whole state, no fog (a new world or a load sets it back: resetView)
  if (!on) { sceneKey = ""; scene = null; return; }
  const menu = titleMenuHTML(ui);
  if (menu !== menuShown) { root.querySelector("#tt-menu").innerHTML = menu; menuShown = menu; }
  const look = lookHTML(o);
  if (look !== lookShown) { root.querySelector("#tt-look").innerHTML = look; lookShown = look; }
  const style = titleStyle(o);
  if (style !== logoKey) {
    const el = root.querySelector("#tt-logo");
    el.className = `tt-logo tt-${style}`;
    el.innerHTML = LOGOS[style]();
    logoKey = style;
    decorateLogo(el, style);
  }
}

// Every frame while the title is up (main.js step).
export function titleFrame(state, ui, now) {
  if (!root || !ui.title) return;
  const dt = Math.min(0.1, lastFrame ? (now - lastFrame) / 1000 : 0.016);
  lastFrame = now;
  const bg = titleBg(API.options);
  if (bg === "map") { mapFrame(state, dt); return; }
  if (sceneKey !== bg) { scene = bg === "camp" ? campScene() : skylineScene(); sceneKey = bg; scene.size = ""; }
  const dpr = window.devicePixelRatio || 1, res = Math.min(dpr, 1.25);
  const W = window.innerWidth, H = window.innerHeight;
  const size = `${W}x${H}x${res}`;
  if (scene.size !== size) {
    bgCanvas.width = Math.round(W * res);
    bgCanvas.height = Math.round(H * res);
    scene.resize(W, H, res);
    scene.size = size;
  }
  const g = bgCanvas.getContext("2d");
  g.setTransform(res, 0, 0, res, 0, 0);
  scene.frame(g, now / 1000, dt);
}

// The living State Map: the main canvas (full screen under the title, styles: body.title-map) pans slowly over the
// whole state while its world runs on its own.
function mapFrame(state, dt) {
  mapClock.t += dt;
  mapClock.acc += dt;
  if (mapClock.acc >= MAP_TICK_S) {
    mapClock.acc = 0;
    try { API.tick(); } catch (e) { /* a demo world that trips over itself just stands still */ }
  }
  const gr = state.grid;
  if (!gr) return;
  const w = HEX * Math.sqrt(3) * (gr.width + 0.5), h = HEX * (1.5 * (gr.height - 1) + 2);
  camera.zoom = 0.85;
  const vw = window.innerWidth / camera.zoom, vh = window.innerHeight / camera.zoom;
  const t = mapClock.t + 40;
  const ax = Math.max(0, w / 2 - vw / 2) * 0.9, ay = Math.max(0, h / 2 - vh / 2) * 0.9;
  camera.x = w / 2 + ax * Math.sin(t * 0.012) - vw / 2;
  camera.y = h / 2 + ay * Math.sin(t * 0.0083 + 1.3) - vh / 2;
}

// ---------- logos ----------
// Two lines of text in an SVG; the stencil bridges, the crack and the drips are added once the letters can be measured.
const LOGOS = {
  stencil: () => `<svg viewBox="0 0 1000 440" aria-label="Broken State">
    <defs>
      <filter id="tt-wear" x="-2%" y="-2%" width="104%" height="104%">
        <feTurbulence type="fractalNoise" baseFrequency="0.03 0.07" numOctaves="3" seed="11" result="n"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -7 0 0 0 5.2" result="big"/>
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="3" result="f"/>
        <feColorMatrix in="f" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -6 0 0 0 4.4" result="fine"/>
        <feComposite in="big" in2="fine" operator="in" result="keep"/>
        <feComposite in="SourceGraphic" in2="keep" operator="in"/>
      </filter>
      <mask id="tt-cuts" maskUnits="userSpaceOnUse" x="0" y="0" width="1000" height="440"><rect width="1000" height="440" fill="#fff"/><g id="tt-bridges" fill="#000"></g></mask>
      <clipPath id="tt-left"><path id="tt-cl" d="M0 0H1000V440H0Z"/></clipPath>
      <clipPath id="tt-right"><path id="tt-cr" d="M0 0Z"/></clipPath>
    </defs>
    <g class="tt-ink" filter="url(#tt-wear)">
      <g mask="url(#tt-cuts)">
        <text id="tt-l1" x="500" y="195" text-anchor="middle" textLength="930" lengthAdjust="spacingAndGlyphs">BROKEN</text>
        <g clip-path="url(#tt-left)"><text class="tt-l2" x="500" y="410" text-anchor="middle" textLength="930" lengthAdjust="spacingAndGlyphs">STATE</text></g>
        <g clip-path="url(#tt-right)"><g class="tt-shift"><text id="tt-l2" class="tt-l2" x="500" y="410" text-anchor="middle" textLength="930" lengthAdjust="spacingAndGlyphs">STATE</text></g></g>
      </g>
    </g>
  </svg>`,
  blood: () => `<svg viewBox="0 0 1000 470" aria-label="Broken State">
    <defs>
      <linearGradient id="tt-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b3161c"/><stop offset="0.65" stop-color="#7a0b10"/><stop offset="1" stop-color="#4a0407"/></linearGradient>
      <filter id="tt-rough" x="-3%" y="-3%" width="106%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="5" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" result="d"/>
        <feGaussianBlur in="d" stdDeviation="9" result="b"/><feFlood flood-color="#600" flood-opacity="0.55"/><feComposite in2="b" operator="in" result="glow"/>
        <feMerge><feMergeNode in="glow"/><feMergeNode in="d"/></feMerge>
      </filter>
    </defs>
    <g filter="url(#tt-rough)" fill="url(#tt-red)">
      <text id="tt-l1" x="500" y="190" text-anchor="middle" textLength="900" lengthAdjust="spacingAndGlyphs">BROKEN</text>
      <text id="tt-l2" x="500" y="385" text-anchor="middle" textLength="760" lengthAdjust="spacingAndGlyphs">STATE</text>
      <g id="tt-drips"></g>
    </g>
  </svg>`,
  spray: () => `<svg viewBox="0 0 1000 470" aria-label="Broken State">
    <defs>
      <filter id="tt-paint" x="-5%" y="-8%" width="110%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="9" result="w"/>
        <feDisplacementMap in="SourceGraphic" in2="w" scale="7" xChannelSelector="R" yChannelSelector="G" result="core"/>
        <feGaussianBlur in="core" stdDeviation="7" result="halo"/>
        <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="2" result="sp"/>
        <feColorMatrix in="sp" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -9 0 0 0 5.4" result="dots"/>
        <feComposite in="halo" in2="dots" operator="in" result="speck"/>
        <feComponentTransfer in="speck" result="speck2"><feFuncA type="linear" slope="1.6"/></feComponentTransfer>
        <feGaussianBlur in="core" stdDeviation="2.2" result="soft"/>
        <feMerge><feMergeNode in="speck2"/><feMergeNode in="soft"/><feMergeNode in="core"/></feMerge>
      </filter>
    </defs>
    <g transform="rotate(-4 500 235)" filter="url(#tt-paint)">
      <g class="tt-white"><text id="tt-l1" x="490" y="200" text-anchor="middle" textLength="880" lengthAdjust="spacingAndGlyphs">BROKEN</text></g>
      <g class="tt-red"><text id="tt-l2" x="530" y="395" text-anchor="middle" textLength="700" lengthAdjust="spacingAndGlyphs">STATE</text>
        <path class="tt-slash" d="M150 425 C 330 440, 650 418, 905 405"/></g>
      <g id="tt-drips"></g>
    </g>
  </svg>`,
  minimal: () => `<svg viewBox="0 0 1000 230" aria-label="Broken State">
    <text id="tt-l1" x="500" y="110" text-anchor="middle" textLength="900" lengthAdjust="spacing">${[..."BROKEN STATE"].map((c, i) => `<tspan style="animation-delay:${(0.25 + i * 0.09).toFixed(2)}s">${c === " " ? " " : c}</tspan>`).join("")}</text>
    <line class="tt-rule" x1="120" y1="150" x2="455" y2="150"/><line class="tt-rule" x1="545" y1="150" x2="880" y2="150"/>
    <circle class="tt-dot" cx="500" cy="150" r="3"/>
    <text class="tt-sub" x="500" y="200" text-anchor="middle">THE STATE OF CALDER · AFTER THE FALL</text>
  </svg>`,
};

// Glyph boxes of a <text> (user units), measured by the browser.
function glyphs(text) {
  const out = [];
  try { for (let i = 0; i < text.getNumberOfChars(); i++) { const r = text.getExtentOfChar(i); out.push({ ch: text.textContent[i], x: r.x, y: r.y, w: r.width, h: r.height }); } } catch { /* not laid out */ }
  return out;
}

// Stencil bridges, by letter: vertical cuts at fractions of the glyph's width (from top to bottom, or only part of the
// height), horizontal cuts at a fraction of its height.
const BRIDGES = {
  B: [["v", 0.36]], R: [["v", 0.36]], K: [["v", 0.38]], E: [["v", 0.36]], N: [["v", 0.3], ["v", 0.7]],
  O: [["v", 0.5]], S: [["v", 0.5]], T: [["h", 0.27, 0.3, 0.7]], A: [["v", 0.5, 0, 0.42], ["h", 0.68, 0.3, 0.7]],
};

function decorateLogo(el, style) {
  const l1 = el.querySelector("#tt-l1"), l2 = el.querySelector("#tt-l2");
  if (!l1 || !l2) return;
  const all = [...glyphs(l1), ...glyphs(l2)];
  if (!all.length) return;
  const rnd = rng(style.length * 7919 + 17);
  if (style === "stencil") {
    // Cap height: the glyph box includes the font's ascent and descent; capitals fill about the middle 70%.
    const cuts = [];
    for (const gl of all) {
      const top = gl.y + gl.h * 0.18, ch = gl.h * 0.62;
      for (const [k, a, b = 0, c = 1] of BRIDGES[gl.ch] || []) {
        if (k === "v") cuts.push(`<rect x="${(gl.x + gl.w * a - 3.5).toFixed(1)}" y="${(top + ch * b - 6).toFixed(1)}" width="7" height="${(ch * (c - b) + 12).toFixed(1)}"/>`);
        else cuts.push(`<rect x="${(gl.x + gl.w * b).toFixed(1)}" y="${(top + ch * a - 3.5).toFixed(1)}" width="${(gl.w * (c - b)).toFixed(1)}" height="7"/>`);
      }
    }
    // The crack: a jagged line down through STATE's A; the right-hand piece has dropped and turned a little.
    const g2 = glyphs(l2), a = g2[2] || g2[Math.floor(g2.length / 2)];
    if (a) {
      const x0 = a.x + a.w * 0.62, top = a.y - 10, bot = a.y + a.h + 10;
      const pts = [];
      for (let y = top, i = 0; y <= bot; y += 16 + rnd() * 18, i++) pts.push([x0 + (rnd() - 0.5) * 34 + (y - top) * -0.12, y]);
      pts.push([x0 - 10, bot]);
      const line = pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L");
      el.querySelector("#tt-cl").setAttribute("d", `M0 0H${pts[0][0].toFixed(1)} L${line} V440 H0Z`);
      el.querySelector("#tt-cr").setAttribute("d", `M1000 0H${pts[0][0].toFixed(1)} L${line} V440 H1000Z`);
      el.querySelector("#tt-bridges").insertAdjacentHTML("beforeend", `<path d="M${line}" fill="none" stroke="#000" stroke-width="5"/>`);
      // The upper line has a hairline crack too, running into the same break.
      const b1 = glyphs(l1)[4];
      if (b1) {
        let x = b1.x + b1.w * 0.3, y = b1.y + b1.h * 0.85, d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
        while (y > b1.y + b1.h * 0.2) { y -= 12 + rnd() * 14; x += (rnd() - 0.4) * 20; d += ` L${x.toFixed(1)} ${y.toFixed(1)}`; }
        el.querySelector("#tt-bridges").insertAdjacentHTML("beforeend", `<path d="${d}" fill="none" stroke="#000" stroke-width="3"/>`);
      }
    }
    el.querySelector("#tt-bridges").insertAdjacentHTML("afterbegin", cuts.join(""));
    return;
  }
  // Drips from the bottom of some letters (blood, paint), each growing, then letting a drop go, then starting again.
  const holder = el.querySelector("#tt-drips");
  if (!holder) return;
  const thin = style === "spray";
  const out = [];
  for (const gl of all) {
    const n = rnd() < (thin ? 0.55 : 0.75) ? 1 + (rnd() < 0.35 ? 1 : 0) : 0;
    for (let k = 0; k < n; k++) {
      const x = gl.x + gl.w * (0.2 + rnd() * 0.6), y = gl.y + gl.h * (thin ? 0.76 : 0.8) - 4;
      const len = (thin ? 25 : 30) + rnd() * (thin ? 70 : 85), w = thin ? 2.5 + rnd() * 2.5 : 4 + rnd() * 6;
      const dur = (6 + rnd() * 8).toFixed(1), delay = (-rnd() * 12).toFixed(1);
      const cls = thin && gl.y < 250 ? "tt-dw" : thin ? "tt-dr" : "";
      out.push(`<g class="tt-drip ${cls}" style="--len:${len.toFixed(0)}px;animation-duration:${dur}s;animation-delay:${delay}s;transform-origin:${x.toFixed(1)}px ${y.toFixed(1)}px">
        <path d="M${(x - w / 2).toFixed(1)} ${y} V${(y + len).toFixed(1)} a${(w / 2).toFixed(1)} ${(w / 2).toFixed(1)} 0 0 0 ${w.toFixed(1)} 0 V${y}Z"/></g>
        <circle class="tt-drop ${cls}" cx="${x.toFixed(1)}" cy="${(y + len + w * 0.8).toFixed(1)}" r="${(w * 0.62).toFixed(1)}" style="animation-duration:${dur}s;animation-delay:${delay}s"/>`);
    }
  }
  holder.innerHTML = out.join("");
}

// ---------- drawing helpers ----------
function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, f) => a + (b - a) * f;
// Smooth wobble in about -1..1 (sums of sines: no allocation, never repeats exactly).
const wob = (t, k) => Math.sin(t * 1.7 + k) * 0.5 + Math.sin(t * 2.9 + k * 1.3) * 0.3 + Math.sin(t * 5.3 + k * 2.1) * 0.2;

// An offscreen canvas in CSS pixels at the scene's resolution.
function layer(w, h, res) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w * res));
  c.height = Math.max(1, Math.ceil(h * res));
  const g = c.getContext("2d");
  g.scale(res, res);
  return { c, g, w, h };
}
// A soft round puff of one colour (smoke, fog, glow, flame).
const puffs = new Map();
function puff(rgb, hard = 0) {
  const key = rgb + "/" + hard;
  if (puffs.has(key)) return puffs.get(key);
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, `rgba(${rgb},1)`);
  gr.addColorStop(Math.max(0.05, hard), `rgba(${rgb},${hard ? 0.9 : 0.6})`);
  gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  puffs.set(key, c);
  return c;
}
// A wide strip of fog that tiles left to right: drawn twice, side by side, as it drifts.
function fogStrip(w, h, rgb, seed, res, density = 1) {
  const L = layer(w, h, res), R = rng(seed), p = puff(rgb);
  for (let i = 0; i < 90 * density; i++) {
    const r = h * (0.14 + R() * 0.2), x = R() * w, y = h * 0.5 + (R() - 0.5) * h * 0.3;
    L.g.globalAlpha = 0.08 + R() * 0.12;
    for (const dx of [-w, 0, w]) L.g.drawImage(p, x + dx - r * 2.4, y - r, r * 4.8, r * 2);
  }
  return L;
}
function drawStrip(g, L, x, y, w, h) {
  const off = ((x % w) + w) % w;
  g.drawImage(L.c, off - w, y, w, h);
  g.drawImage(L.c, off, y, w, h);
}

// A shambling dead silhouette, feet at (x, y), s pixels tall, walking towards dir (±1). ph: the step's phase.
function shambler(g, x, y, s, ph, dir, k, color) {
  g.save();
  g.translate(x, y);
  g.scale((dir * s) / 100, s / 100);
  g.strokeStyle = g.fillStyle = color;
  g.lineCap = "round";
  g.lineJoin = "round";
  const step = Math.sin(ph), bob = Math.abs(Math.cos(ph)) * 2.5;
  const lean = (k.lean || 10) + Math.sin(ph * 0.5 + k.seed) * 3;
  const hipX = 0, hipY = -50 + bob;
  // Legs: one swings, the dragging one barely leaves the ground.
  g.lineWidth = 8.5;
  const leg = (sw, drag) => {
    const a = sw * (drag ? 0.25 : 0.42);
    const kx = hipX + Math.sin(a) * 25, ky = hipY + Math.cos(a) * 25;
    const fx = kx + Math.sin(a - 0.25 - (drag ? 0 : Math.max(0, -sw) * 0.4)) * 25, fy = Math.min(0, ky + Math.cos(a) * 25);
    g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(kx, ky); g.lineTo(fx, fy); g.stroke();
  };
  leg(step, k.limp);
  leg(-step, false);
  // Torso, leaning into the walk.
  const rad = (lean * Math.PI) / 180;
  const shX = hipX + Math.sin(rad) * 32, shY = hipY - Math.cos(rad) * 32;
  g.lineWidth = 15;
  g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(shX, shY); g.stroke();
  // Head, hanging forward and to the side.
  const hx = shX + 6 + (k.droop || 0) + Math.sin(ph * 0.5) * 1.5, hy = shY - 9 + Math.abs(k.droop || 0) * 0.4;
  g.beginPath(); g.arc(hx, hy, 7.5, 0, Math.PI * 2); g.fill();
  // Arms: one reaching out, one hanging (or both reaching).
  g.lineWidth = 6.5;
  const reach = (k.reach || 0.35) + Math.sin(ph + k.seed) * 0.08;
  g.beginPath(); g.moveTo(shX, shY + 4); g.lineTo(shX + Math.cos(reach) * 19, shY + 4 + Math.sin(reach) * 19); g.lineTo(shX + Math.cos(reach) * 36, shY + 4 + Math.sin(reach + 0.15) * 36); g.stroke();
  const hang = k.both ? reach + 0.25 : 1.35 + Math.sin(ph) * 0.12;
  g.beginPath(); g.moveTo(shX - 2, shY + 5); g.lineTo(shX - 2 + Math.cos(hang) * 18, shY + 5 + Math.sin(hang) * 18); g.lineTo(shX - 2 + Math.cos(hang + 0.2) * 34, shY + 5 + Math.sin(hang + 0.2) * 34); g.stroke();
  g.restore();
}
function walkers(n, seed, opts) {
  const R = rng(seed), out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x: R(), depth: R(), dir: R() < 0.5 ? -1 : 1, ph: R() * 6.28, speed: 0.55 + R() * 0.5,
      k: { seed: R() * 6, lean: 6 + R() * 16, droop: (R() - 0.3) * 8, reach: 0.1 + R() * 0.6, both: R() < 0.3, limp: R() < 0.45 },
      ...opts,
    });
  }
  return out;
}

// ---------- background: a ruined skyline at dusk ----------
function skylineScene() {
  let W = 0, H = 0, res = 1, sky, far, mid, near, ground, fogBack, fogFront, haze;
  let horizon = 0, streetY = 0, P = 0;
  const lights = []; // lit windows: [layer, x, y, w, h, phase]
  const smoke = [], embers = [];
  let crowd = [], crows = [];
  const sources = [0.22, 0.47, 0.81]; // where the fires burn, as fractions of the mid layer
  const dark = puff("26,22,25"), lit = puff("125,62,38"), glowP = puff("255,118,40"), ember = puff("255,170,80", 0.3);

  function buildingLayer(seed, top, base, minH, maxH, minW, maxW, color, windows, idx) {
    const L = layer(P, H - top, res), R = rng(seed), g = L.g;
    g.translate(0, -top);
    g.fillStyle = color;
    const shapes = [];
    for (let x = -30; x < P;) {
      const w = lerp(minW, maxW, R()), h = lerp(minH, maxH, Math.pow(R(), 1.4));
      shapes.push([x, w, h, R() * 1e6 | 0]);
      x += w * (0.7 + R() * 0.45);
    }
    for (const [x0, w, h, s] of shapes) for (const dx of [0, -P, P]) {
      const r = rng(s), x = x0 + dx, y = base - h, kind = r();
      g.beginPath();
      g.moveTo(x, H);
      g.lineTo(x, y + (kind < 0.2 ? h * 0.08 * r() : 0));
      if (kind < 0.38) { // broken top: a jagged line down and up across the roof
        const n = 4 + (r() * 5) | 0;
        for (let i = 1; i < n; i++) g.lineTo(x + (w * i) / n + (r() - 0.5) * 6, y + h * r() * (i % 2 ? 0.3 : 0.12));
        g.lineTo(x + w, y + h * (0.1 + r() * 0.35));
      } else if (kind < 0.52) { // setbacks
        g.lineTo(x + w * 0.2, y); g.lineTo(x + w * 0.2, y - h * 0.12); g.lineTo(x + w * 0.7, y - h * 0.12); g.lineTo(x + w * 0.7, y); g.lineTo(x + w, y);
      } else if (kind < 0.62) { // leaning, half fallen
        g.lineTo(x + w * 0.9, y + h * 0.05); g.lineTo(x + w, y + h * 0.45);
      } else g.lineTo(x + w, y);
      g.lineTo(x + w, H);
      g.closePath();
      g.fill();
      const extra = r();
      g.lineWidth = Math.max(1.2, w * 0.03);
      g.strokeStyle = color;
      if (kind >= 0.62 && extra < 0.3) { // antenna
        g.beginPath(); g.moveTo(x + w * 0.5, y); g.lineTo(x + w * 0.5 + (r() - 0.5) * 8, y - h * (0.15 + r() * 0.2)); g.stroke();
      } else if (kind >= 0.62 && extra < 0.5) { // water tower
        const tx = x + w * (0.25 + r() * 0.4), tw = Math.min(26, w * 0.3), th = tw * 0.8;
        g.beginPath(); g.moveTo(tx, y); g.lineTo(tx + 3, y - th * 0.7); g.moveTo(tx + tw, y); g.lineTo(tx + tw - 3, y - th * 0.7); g.stroke();
        g.fillRect(tx, y - th * 1.5, tw, th * 0.8);
        g.beginPath(); g.moveTo(tx - 2, y - th * 1.5); g.lineTo(tx + tw / 2, y - th * 1.9); g.lineTo(tx + tw + 2, y - th * 1.5); g.fill();
      } else if (kind >= 0.62 && extra < 0.65) { // the bare frame of the floors that are gone
        const fh = h * 0.35, cols = 3 + (r() * 3) | 0;
        for (let i = 0; i <= cols; i++) { if (r() < 0.3) continue; g.beginPath(); g.moveTo(x + (w * i) / cols, y); g.lineTo(x + (w * i) / cols, y - fh * (0.4 + r() * 0.6)); g.stroke(); }
        for (let j = 1; j < 3; j++) { g.beginPath(); g.moveTo(x, y - (fh * j) / 3); g.lineTo(x + w * (0.3 + r() * 0.7), y - (fh * j) / 3); g.stroke(); }
      }
      // Windows: a few lit ones flicker (kept in `lights`), and in the nearer layers the dead ones show faintly.
      if (windows && dx === 0) {
        const cw = windows, rows = Math.floor((h * 0.85) / (cw * 2.4)), cols = Math.floor((w * 0.8) / (cw * 2));
        for (let j = 1; j < rows; j++) for (let i = 0; i < cols; i++) {
          const wx = x + w * 0.1 + i * cw * 2, wy = base - h * 0.9 + j * cw * 2.4;
          if (wy < y + h * 0.4 && kind < 0.38) continue;
          const v = r();
          if (v < 0.012) lights.push([idx, wx, wy, cw, cw * 1.3, r() * 100]);
          else if (v < 0.35 && idx > 0) { g.fillStyle = "rgba(255,190,140,0.035)"; g.fillRect(wx, wy, cw, cw * 1.3); g.fillStyle = color; }
        }
      }
    }
    return L;
  }

  function groundLayer() {
    const top = streetY - H * 0.02;
    const L = layer(W, H - top, res), R = rng(404), g = L.g;
    g.translate(0, -top);
    const base = H * 0.9;
    // Rubble along the front: an uneven heap with slabs and rebar sticking out.
    g.fillStyle = "#060507";
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W + 20; x += 14 + R() * 26) g.lineTo(x, base - R() * H * 0.035 - (Math.sin(x * 0.004) + 1) * H * 0.012);
    g.lineTo(W, H);
    g.fill();
    g.strokeStyle = "#060507";
    g.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const x = R() * W, y = base - R() * H * 0.03;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 30, y - 10 - R() * 26); g.stroke();
    }
    // A wrecked car on its side, left.
    g.save();
    g.translate(W * 0.1, base - H * 0.01);
    g.rotate(-0.12);
    const cw = H * 0.2, ch = H * 0.06;
    g.beginPath();
    g.moveTo(0, 0); g.lineTo(0, -ch * 0.55); g.lineTo(cw * 0.18, -ch * 0.6); g.lineTo(cw * 0.32, -ch); g.lineTo(cw * 0.7, -ch); g.lineTo(cw * 0.84, -ch * 0.6); g.lineTo(cw, -ch * 0.5); g.lineTo(cw, 0); g.closePath();
    g.fill();
    g.fillStyle = "rgba(160,90,60,0.07)";
    g.fillRect(cw * 0.36, -ch * 0.9, cw * 0.14, ch * 0.3);
    g.fillStyle = "#060507";
    g.beginPath(); g.arc(cw * 0.2, 0, ch * 0.28, 0, Math.PI * 2); g.arc(cw * 0.8, 0, ch * 0.28, 0, Math.PI * 2); g.fill();
    g.restore();
    // A bent street lamp, right (its light is drawn every frame).
    const lx = W * 0.8;
    g.lineWidth = Math.max(3, H * 0.006);
    g.beginPath(); g.moveTo(lx, base); g.lineTo(lx + 4, base - H * 0.3); g.quadraticCurveTo(lx + 8, base - H * 0.36, lx + H * 0.06, base - H * 0.345); g.stroke();
    g.fillRect(lx + H * 0.05, base - H * 0.352, H * 0.03, H * 0.012);
    // A chain-link fence with a warning sign, sagging between its posts.
    const f0 = W * 0.52, f1 = W * 0.7, fy = base - H * 0.005, fh = H * 0.11;
    g.lineWidth = 3;
    for (let x = f0; x <= f1; x += (f1 - f0) / 4) { g.beginPath(); g.moveTo(x, fy); g.lineTo(x + (R() - 0.5) * 6, fy - fh); g.stroke(); }
    g.strokeStyle = "rgba(6,5,7,0.55)";
    g.lineWidth = 1;
    for (let x = f0; x < f1; x += 7) {
      const sag = Math.sin(((x - f0) / ((f1 - f0) / 4)) * Math.PI) * 6;
      g.beginPath(); g.moveTo(x, fy); g.lineTo(x + 12, fy - fh + sag); g.moveTo(x + 12, fy); g.lineTo(x, fy - fh + sag); g.stroke();
    }
    g.fillStyle = "#4a3f1c";
    const sx = f0 + (f1 - f0) * 0.3, sy = fy - fh * 0.75, sw = (f1 - f0) * 0.22;
    g.save(); g.translate(sx, sy); g.rotate(0.06);
    g.fillRect(0, 0, sw, sw * 0.42);
    g.fillStyle = "#17130a";
    g.font = `700 ${(sw * 0.13).toFixed(1)}px Bahnschrift, Impact, sans-serif`;
    g.textAlign = "center";
    g.fillText("QUARANTINE", sw / 2, sw * 0.18);
    g.fillText("NO ENTRY", sw / 2, sw * 0.34);
    g.restore();
    return L;
  }

  function resize(w, h, r) {
    W = w; H = h; res = r;
    horizon = H * 0.64; streetY = H * 0.84;
    P = Math.ceil(W * 1.3);
    lights.length = 0;
    // Sky: bruised dark above, the burning city's glow at the horizon.
    sky = layer(W, H, res);
    const gr = sky.g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, "#0a0b12"); gr.addColorStop(0.35, "#1d1520"); gr.addColorStop(0.55, "#3f1f22"); gr.addColorStop(0.68, "#7a3520"); gr.addColorStop(0.8, "#4a2218"); gr.addColorStop(1, "#140c0c");
    sky.g.fillStyle = gr;
    sky.g.fillRect(0, 0, W, H);
    far = buildingLayer(11, H * 0.3, horizon + H * 0.04, H * 0.06, H * 0.2, W * 0.025, W * 0.06, "#3b2427", 0, 0);
    mid = buildingLayer(23, H * 0.22, horizon + H * 0.1, H * 0.1, H * 0.32, W * 0.035, W * 0.08, "#1e1417", Math.max(2, H * 0.004), 1);
    near = buildingLayer(37, H * 0.25, streetY - H * 0.005, H * 0.12, H * 0.42, W * 0.05, W * 0.11, "#0d0a0c", Math.max(2.5, H * 0.005), 2);
    ground = groundLayer();
    fogBack = fogStrip(W, H * 0.3, "150,82,58", 5, res, 1.2);
    fogFront = fogStrip(W, H * 0.22, "70,48,46", 8, res, 0.9);
    haze = fogStrip(W, H * 0.25, "120,58,40", 13, res, 0.8);
    crowd = walkers(9, 77, {});
    crows = walkers(4, 99, {}).map((c) => ({ ...c, y: 0.1 + c.depth * 0.25 }));
    smoke.length = 0;
    embers.length = 0;
    // Start with the plumes already up, not growing from nothing.
    for (let i = 0; i < 400; i++) step(1 / 20, i / 20, true);
  }

  // The particles: smoke from the fires (behind the near buildings) and embers in the air.
  function step(dt, t, warm) {
    const off = t * 3; // the mid layer's drift
    for (const f of sources) {
      if (Math.random() < dt * 7) {
        const sx = (((f * P - off * 0.6) % P) + P) % P - (P - W) / 2;
        smoke.push({ x: sx + (Math.random() - 0.5) * 30, y: horizon + H * 0.02, vx: 4 + Math.random() * 6, vy: -(14 + Math.random() * 10), r: H * 0.03, life: 14 + Math.random() * 8, age: 0 });
        if (!warm && Math.random() < 0.6) embers.push({ x: sx, y: horizon + H * 0.03, vx: (Math.random() - 0.3) * 16, vy: -(20 + Math.random() * 30), life: 3 + Math.random() * 4, age: 0, k: Math.random() * 9 });
      }
    }
    if (!warm && Math.random() < dt * 5) embers.push({ x: Math.random() * W, y: H * (0.85 + Math.random() * 0.1), vx: 6 + Math.random() * 10, vy: -(12 + Math.random() * 22), life: 4 + Math.random() * 5, age: 0, k: Math.random() * 9 });
    for (let i = smoke.length - 1; i >= 0; i--) {
      const p = smoke[i];
      p.age += dt;
      if (p.age > p.life) { smoke.splice(i, 1); continue; }
      p.x += (p.vx + p.age * 1.3) * dt;
      p.y += p.vy * dt;
      p.vy *= 1 - dt * 0.04;
      p.r += dt * H * 0.009;
    }
    for (let i = embers.length - 1; i >= 0; i--) {
      const p = embers[i];
      p.age += dt;
      if (p.age > p.life) { embers.splice(i, 1); continue; }
      p.x += (p.vx + Math.sin(p.age * 3 + p.k) * 14) * dt;
      p.y += p.vy * dt;
    }
  }

  function frame(g, t, dt) {
    step(dt, t, false);
    g.drawImage(sky.c, 0, 0, W, H);
    // The fires' glow on the clouds and the haze, flickering.
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < sources.length; i++) {
      const sx = (((sources[i] * P - t * 1.8) % P) + P) % P - (P - W) / 2;
      const r = H * (0.42 + 0.04 * wob(t * 0.8, i * 3));
      g.globalAlpha = 0.16 + 0.05 * wob(t * 1.3, i);
      g.drawImage(glowP, sx - r, horizon - r * 0.7, r * 2, r * 1.4);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    // High smoke drifting across the sky.
    drawStrip(g, haze, -t * 6, H * 0.06, W, H * 0.25);
    drawStrip(g, haze, -t * 11 + W * 0.4, H * 0.24, W, H * 0.22);
    // Crows, far off.
    g.strokeStyle = "#120c0e";
    g.lineWidth = 1.6;
    for (const c of crows) {
      const x = ((c.x * (W + 200) + t * 22 * c.speed) % (W + 200)) - 100, y = H * c.y + Math.sin(t * 0.4 + c.ph) * 12;
      const f = Math.sin(t * 7 * c.speed + c.ph) * 4, s = 5 + c.depth * 4;
      g.beginPath(); g.moveTo(x - s, y - f); g.quadraticCurveTo(x - s * 0.4, y - 2, x, y); g.quadraticCurveTo(x + s * 0.4, y - 2, x + s, y - f); g.stroke();
    }
    const layerAt = (L, top, speed) => { const off = (((-t * speed) % P) + P) % P; g.drawImage(L.c, off - P - (P - W) / 2, top, P, L.h); g.drawImage(L.c, off - (P - W) / 2, top, P, L.h); };
    layerAt(far, H * 0.3, 1.8);
    drawStrip(g, fogBack, t * 4, horizon - H * 0.12, W, H * 0.3);
    // Smoke rises from behind the middle buildings.
    for (const p of smoke) {
      const a = Math.min(1, p.age / 2) * (1 - p.age / p.life);
      const low = Math.max(0, 1 - (horizon - p.y) / (H * 0.25));
      g.globalAlpha = a * 0.5;
      g.drawImage(dark, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      if (low > 0) { g.globalAlpha = a * low * 0.45; g.drawImage(lit, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2); }
    }
    g.globalAlpha = 1;
    layerAt(mid, H * 0.22, 3);
    drawStrip(g, fogBack, -t * 7 + W * 0.3, horizon - H * 0.02, W, H * 0.3);
    layerAt(near, H * 0.25, 5);
    // Lit windows: a few, flickering like candles and failing bulbs.
    for (const [li, x, y, w, h, ph] of lights) {
      const speed = [1.8, 3, 5][li], top = [H * 0.3, H * 0.22, H * 0.25][li];
      const off = (((-t * speed) % P) + P) % P - (P - W) / 2;
      let sx = x + off;
      if (sx > W + 10) sx -= P;
      if (sx < -10 - w) continue;
      const f = 0.55 + 0.45 * wob(t * (1 + (ph % 3)), ph);
      if (f < 0.25) continue;
      g.fillStyle = `rgba(255,${150 + (ph % 50) | 0},70,${(0.35 + f * 0.45) * (li === 0 ? 0.5 : 1)})`;
      g.fillRect(sx, y, w, h);
    }
    // The street: fog lit from behind, so the dead walking it stand out against it.
    const sg = g.createLinearGradient(0, streetY - H * 0.12, 0, streetY + H * 0.06);
    sg.addColorStop(0, "rgba(120,62,44,0)"); sg.addColorStop(0.65, "rgba(120,62,44,0.55)"); sg.addColorStop(1, "rgba(70,40,34,0.3)");
    g.fillStyle = sg;
    g.fillRect(0, streetY - H * 0.12, W, H * 0.18);
    drawStrip(g, fogBack, t * 9, streetY - H * 0.2, W, H * 0.3);
    // The street lamp: on, off, buzzing back.
    const lampOn = wob(t * 2.3, 4) > -0.55 && (t % 7.3) > 0.25;
    if (lampOn) {
      const lx = W * 0.8 + H * 0.065, ly = H * 0.9 - H * 0.34;
      const cone = g.createLinearGradient(0, ly, 0, H * 0.92);
      cone.addColorStop(0, "rgba(255,214,150,0.32)"); cone.addColorStop(1, "rgba(255,214,150,0)");
      g.fillStyle = cone;
      g.beginPath(); g.moveTo(lx - 6, ly); g.lineTo(lx + 6, ly); g.lineTo(lx + H * 0.14, H * 0.92); g.lineTo(lx - H * 0.14, H * 0.92); g.fill();
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.5;
      g.drawImage(glowP, lx - 18, ly - 10, 36, 24);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // The dead, shambling along the street, the far ones smaller and greyer.
    const sorted = crowd.slice().sort((a, b) => a.depth - b.depth);
    for (const z of sorted) {
      const s = H * (0.075 + z.depth * 0.06), span = W + s * 2;
      const pace = z.speed * (0.6 + 0.4 * Math.max(0, Math.sin(t * 0.9 + z.ph))) * s * 0.18;
      z.pos = (z.pos ?? z.x * span) + pace * dt * z.dir;
      const x = ((z.pos % span) + span) % span - s;
      const y = streetY + H * 0.005 + z.depth * H * 0.045;
      const shade = Math.round(28 - z.depth * 22);
      shambler(g, x, y, s, t * 2.2 * z.speed + z.ph, z.dir, z.k, `rgb(${shade},${shade - 6},${shade - 4})`);
    }
    g.drawImage(ground.c, 0, streetY - H * 0.02, W, ground.h);
    drawStrip(g, fogFront, -t * 12, H * 0.8, W, H * 0.22);
    // Embers.
    g.globalCompositeOperation = "lighter";
    for (const p of embers) {
      const a = Math.min(1, p.age * 2) * (1 - p.age / p.life) * (0.6 + 0.4 * Math.sin(p.age * 20 + p.k));
      g.globalAlpha = Math.max(0, a);
      g.drawImage(ember, p.x - 3, p.y - 3, 6, 6);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  return { resize, frame };
}

// ---------- background: a campfire at night ----------
function campScene() {
  let W = 0, H = 0, res = 1, sky, trees, fog, fx = 0, fy = 0, horizon = 0;
  const flames = [], sparks = [], smoke = [], eyes = [];
  let edge = [];
  const flameY = puff("255,226,150", 0.15), flameO = puff("255,140,40", 0.1), flameR = puff("200,50,20"), glowP = puff("255,130,50"), smokeP = puff("60,58,64"), moonGlow = puff("170,190,220");
  const cloud = puff("22,27,40"), cloudLit = puff("70,80,100");
  let clouds = [];

  function resize(w, h, r) {
    W = w; H = h; res = r;
    horizon = H * 0.6;
    fx = W * 0.56; fy = H * 0.84;
    const R = rng(2024);
    sky = layer(W, H, res);
    const g = sky.g;
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, "#03050a"); gr.addColorStop(0.45, "#0a1020"); gr.addColorStop(0.62, "#111829"); gr.addColorStop(0.7, "#07090f"); gr.addColorStop(1, "#040406");
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 380; i++) {
      const y = Math.pow(R(), 1.5) * horizon, a = 0.15 + R() * 0.6 * (1 - y / horizon);
      g.fillStyle = `rgba(220,228,255,${a.toFixed(2)})`;
      const s = R() < 0.06 ? 1.8 : 1;
      g.fillRect(R() * W, y, s, s);
    }
    // The moon, low and pale.
    const mx = W * 0.87, my = H * 0.14, mr = H * 0.045;
    g.globalAlpha = 0.35;
    g.drawImage(moonGlow, mx - mr * 6, my - mr * 6, mr * 12, mr * 12);
    g.globalAlpha = 1;
    g.fillStyle = "#d9dccf";
    g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(150,150,140,0.35)";
    for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(mx + (R() - 0.5) * mr * 1.2, my + (R() - 0.5) * mr * 1.2, mr * (0.12 + R() * 0.2), 0, Math.PI * 2); g.fill(); }
    // Far hills, then the treeline (the clearing in the middle is where the fire is).
    g.fillStyle = "#0b0f19";
    g.beginPath(); g.moveTo(0, horizon);
    for (let x = 0; x <= W; x += 20) g.lineTo(x, horizon - H * 0.05 - Math.sin(x * 0.003 + 1) * H * 0.03 - Math.sin(x * 0.011) * H * 0.008);
    g.lineTo(W, H); g.lineTo(0, H); g.fill();
    trees = layer(W, H * 0.5, res);
    const tg = trees.g;
    tg.translate(0, -H * 0.4);
    const pine = (x, base, h, c) => {
      tg.fillStyle = c;
      tg.beginPath(); tg.moveTo(x, base - h);
      const tiers = 5;
      for (let i = 1; i <= tiers; i++) { const y = base - h + (h * i) / tiers, w = h * 0.07 + (h * 0.2 * i) / tiers; tg.lineTo(x + w, y); tg.lineTo(x + w * 0.45, y - h * 0.04); }
      for (let i = tiers; i >= 1; i--) { const y = base - h + (h * i) / tiers, w = h * 0.07 + (h * 0.2 * i) / tiers; tg.lineTo(x - w * 0.45, y - h * 0.04); tg.lineTo(x - w, y); }
      tg.closePath(); tg.fill();
      tg.fillRect(x - h * 0.012, base - h * 0.05, h * 0.024, h * 0.08);
    };
    for (let x = -20; x < W + 20; x += 6 + R() * 16) {
      const gap = Math.max(0, 1 - Math.abs(x - W * 0.5) / (W * 0.22));
      pine(x, horizon + H * 0.03, H * (0.07 + R() * 0.07) * (1 - gap * 0.6), "#05070d");
    }
    for (let x = -20; x < W + 20; x += 18 + R() * 40) {
      const d = Math.abs(x - W * 0.5) / (W * 0.5);
      if (d < 0.45) continue;
      pine(x, horizon + H * (0.08 + R() * 0.04), H * (0.2 + R() * 0.16) * d, "#020305");
    }
    tg.fillStyle = "#040406";
    tg.fillRect(0, horizon + H * 0.075, W, H);
    fog = fogStrip(W, H * 0.16, "90,105,135", 31, res, 1);
    clouds = Array.from({ length: 9 }, (_, i) => ({ x: R() * (W + 600) - 300, y: H * (0.05 + R() * 0.25), r: H * (0.08 + R() * 0.1), v: 3 + R() * 5, k: i }));
    edge = walkers(4, 55, {});
    flames.length = sparks.length = smoke.length = eyes.length = 0;
    for (let i = 0; i < 120; i++) step(1 / 30, i / 30);
  }

  function step(dt, t) {
    const n = dt * 75;
    for (let i = 0; i < n || (i === 0 && Math.random() < n); i++) {
      flames.push({ x: fx + (Math.random() - 0.5) * H * 0.05, y: fy - H * 0.005, vx: (Math.random() - 0.5) * 14, vy: -(H * 0.08 + Math.random() * H * 0.1), r: H * (0.018 + Math.random() * 0.014), life: 0.45 + Math.random() * 0.6, age: 0 });
    }
    if (Math.random() < dt * (wob(t * 0.7, 2) > 0.5 ? 18 : 4)) sparks.push({ x: fx + (Math.random() - 0.5) * 20, y: fy - H * 0.03, vx: (Math.random() - 0.4) * 30, vy: -(H * 0.12 + Math.random() * H * 0.18), life: 1.5 + Math.random() * 2.5, age: 0, k: Math.random() * 9 });
    if (Math.random() < dt * 3) smoke.push({ x: fx, y: fy - H * 0.1, vx: 6 + Math.random() * 6, vy: -(H * 0.03 + Math.random() * H * 0.02), r: H * 0.03, life: 7 + Math.random() * 5, age: 0 });
    // Eyes at the edge of the light, a pair at a time.
    if (eyes.length < 3 && Math.random() < dt * 0.35) {
      const side = Math.random() < 0.5 ? -1 : 1;
      eyes.push({ x: fx + side * W * (0.18 + Math.random() * 0.28), y: horizon + H * (0.03 + Math.random() * 0.1), life: 4 + Math.random() * 6, age: 0, sep: H * (0.006 + Math.random() * 0.004), k: Math.random() * 9, red: Math.random() < 0.4 });
    }
    for (const list of [flames, sparks, smoke, eyes]) for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.age += dt;
      if (p.age > p.life) { list.splice(i, 1); continue; }
      if (p.vy == null) continue;
      p.x += (p.vx + (list === sparks ? Math.sin(p.age * 4 + p.k) * 20 : 0)) * dt;
      p.y += p.vy * dt;
      if (list === sparks) p.vy *= 1 - dt * 0.5;
      if (list === smoke) p.r += dt * H * 0.012;
      if (list === flames) p.vx += (fx - p.x) * dt * 2.5;
    }
  }

  // A survivor by the fire: a dark shape lit on the side that faces it.
  function person(g, x, y, s, pose, t, k, flick) {
    const toFire = Math.sign(fx - x) || 1;
    g.save();
    g.translate(x, y);
    g.scale(s / 100, s / 100);
    const gr = g.createLinearGradient(-40 * toFire, 0, 40 * toFire, 0);
    gr.addColorStop(0, "#030304");
    gr.addColorStop(0.55, "#0c0807");
    gr.addColorStop(1, `rgb(${Math.round(95 * flick)},${Math.round(44 * flick)},${Math.round(20 * flick)})`);
    g.fillStyle = g.strokeStyle = gr;
    g.lineCap = g.lineJoin = "round";
    const breathe = Math.sin(t * 1.3 + k) * 0.8;
    if (pose === "sit") { // on a log, hunched towards the fire, hands out
      g.lineWidth = 12;
      g.beginPath(); g.moveTo(-6 * toFire, -30); g.lineTo(14 * toFire, -34); g.lineTo(16 * toFire, -6); g.stroke(); // thigh and shin
      g.lineWidth = 20;
      g.beginPath(); g.moveTo(-8 * toFire, -32); g.quadraticCurveTo(-10 * toFire, -55, 2 * toFire, -66 + breathe); g.stroke(); // back
      g.beginPath(); g.arc(10 * toFire, -76 + breathe, 9.5, 0, Math.PI * 2); g.fill();
      g.lineWidth = 7;
      g.beginPath(); g.moveTo(4 * toFire, -60 + breathe); g.lineTo(22 * toFire, -46); g.lineTo(34 * toFire, -48 + Math.sin(t * 0.5 + k) * 2); g.stroke();
      g.fillRect(-26, -30, 52, 8); // the log
    } else if (pose === "crate") { // sitting upright, a cup in hand
      g.lineWidth = 12;
      g.beginPath(); g.moveTo(0, -30); g.lineTo(18 * toFire, -30); g.lineTo(20 * toFire, 0); g.stroke();
      g.lineWidth = 19;
      g.beginPath(); g.moveTo(0, -32); g.lineTo(2 * toFire, -70 + breathe); g.stroke();
      g.beginPath(); g.arc(5 * toFire, -84 + breathe, 9.5, 0, Math.PI * 2); g.fill();
      g.lineWidth = 7;
      const lift = Math.max(0, Math.sin(t * 0.35 + k)) ** 8;
      g.beginPath(); g.moveTo(4 * toFire, -64 + breathe); g.lineTo(14 * toFire, -48 - lift * 14); g.lineTo(20 * toFire, -60 - lift * 14); g.stroke();
      g.fillRect(-16, -30, 32, 30); // the crate
    } else { // the guard: standing, rifle over the shoulder, looking out into the dark and back
      const look = Math.sin(t * 0.22 + k) > 0.2 ? -toFire : toFire;
      g.lineWidth = 11;
      g.beginPath(); g.moveTo(-6, 0); g.lineTo(-3, -52); g.lineTo(3, -52); g.lineTo(7, 0); g.stroke();
      g.lineWidth = 20;
      g.beginPath(); g.moveTo(0, -52); g.lineTo(0, -98 + breathe); g.stroke();
      g.beginPath(); g.arc(3 * look, -110 + breathe, 9.5, 0, Math.PI * 2); g.fill();
      g.lineWidth = 4;
      g.beginPath(); g.moveTo(-12 * toFire, -52); g.lineTo(14 * toFire, -128); g.stroke(); // the rifle
      g.lineWidth = 7;
      g.beginPath(); g.moveTo(4 * toFire, -92); g.lineTo(9 * toFire, -76); g.lineTo(6 * toFire, -100); g.stroke();
    }
    g.restore();
  }

  function frame(g, t, dt) {
    step(dt, t);
    const flick = 0.85 + 0.15 * wob(t * 3.1, 1) + 0.05 * Math.sin(t * 23);
    g.drawImage(sky.c, 0, 0, W, H);
    // Clouds drift across, lit at the edges by the moon.
    for (const c of clouds) {
      const x = ((c.x + t * c.v) % (W + 600)) - 300;
      g.globalAlpha = 0.8;
      g.drawImage(cloud, x - c.r * 2, c.y - c.r * 0.6, c.r * 4, c.r * 1.2);
      const dx = x - W * 0.87, near = Math.max(0, 1 - Math.abs(dx) / (H * 0.4));
      if (near) { g.globalAlpha = 0.25 * near; g.drawImage(cloudLit, x - c.r * 1.6, c.y - c.r * 0.5, c.r * 3.2, c.r); }
    }
    g.globalAlpha = 1;
    // Moonlit fog in the trees, and the dead moving through it.
    drawStrip(g, fog, t * 5, horizon - H * 0.07, W, H * 0.16);
    for (const z of edge) {
      const s = H * (0.05 + z.depth * 0.025), span = W + s * 2;
      z.pos = (z.pos ?? z.x * span) + z.speed * s * 0.12 * dt * z.dir;
      const x = ((z.pos % span) + span) % span - s;
      const lightNear = Math.max(0, 1 - Math.abs(x - fx) / (W * 0.25));
      shambler(g, x, horizon + H * 0.035 + z.depth * H * 0.015, s, t * 2 * z.speed + z.ph, z.dir, z.k, `rgb(${10 + Math.round(lightNear * 20)},${12 + Math.round(lightNear * 8)},${18})`);
    }
    g.drawImage(trees.c, 0, H * 0.4, W, trees.h);
    drawStrip(g, fog, -t * 8 + W * 0.5, horizon + H * 0.02, W, H * 0.14);
    // Eyes catching the firelight.
    g.globalCompositeOperation = "lighter";
    for (const e of eyes) {
      const a = Math.min(1, e.age / 1.2, (e.life - e.age) / 1.2);
      const blink = (e.age * 1.7 + e.k) % 4 < 0.15 ? 0 : 1;
      g.globalAlpha = Math.max(0, a * blink * 0.9);
      g.fillStyle = e.red ? "rgb(255,90,40)" : "rgb(230,220,120)";
      for (const dx of [-e.sep, e.sep]) { g.beginPath(); g.arc(e.x + dx, e.y, H * 0.0022, 0, Math.PI * 2); g.fill(); }
    }
    // The firelight on the ground and the trees.
    const r = H * 0.6 * flick;
    g.globalAlpha = 0.5;
    g.drawImage(glowP, fx - r * 1.4, fy - r * 0.75, r * 2.8, r * 1.2);
    g.globalAlpha = 0.28;
    g.drawImage(glowP, fx - r * 0.7, fy - r * 0.9, r * 1.4, r * 1.4);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    // Long shadows away from the fire, then the people.
    const people = [[-0.2, "sit", 1.0], [-0.11, "sit", 0.95], [0.13, "crate", 1.0], [0.27, "guard", 1.05]];
    g.fillStyle = "rgba(0,0,0,0.45)";
    for (const [dx, , sc] of people) {
      const x = fx + dx * H, len = H * 0.18 * sc;
      g.beginPath(); g.ellipse(x + Math.sign(dx) * len * 0.6, fy + H * 0.01, len * 0.7, H * 0.012, 0, 0, Math.PI * 2); g.fill();
    }
    people.forEach(([dx, pose, sc], i) => person(g, fx + dx * H, fy + H * 0.012, H * 0.2 * sc, pose, t, i * 2.3, flick));
    // The fire: logs, flames, sparks and a little smoke.
    g.strokeStyle = "#1a0c06";
    g.lineWidth = H * 0.012;
    g.lineCap = "round";
    g.beginPath(); g.moveTo(fx - H * 0.05, fy + H * 0.005); g.lineTo(fx + H * 0.04, fy - H * 0.012); g.moveTo(fx + H * 0.05, fy + H * 0.006); g.lineTo(fx - H * 0.035, fy - H * 0.014); g.stroke();
    g.fillStyle = "#0c0908";
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; g.beginPath(); g.ellipse(fx + Math.cos(a) * H * 0.065, fy + Math.sin(a) * H * 0.012 + H * 0.004, H * 0.012, H * 0.007, 0, 0, Math.PI * 2); g.fill(); }
    for (const p of smoke) {
      g.globalAlpha = Math.min(1, p.age) * (1 - p.age / p.life) * 0.25;
      g.drawImage(smokeP, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "lighter";
    for (const p of flames) {
      const f = p.age / p.life, s = p.r * (1 - f * 0.6);
      g.globalAlpha = (1 - f) * 0.55;
      g.drawImage(f < 0.3 ? flameY : f < 0.65 ? flameO : flameR, p.x - s, p.y - s * 1.3, s * 2, s * 2.6);
    }
    for (const p of sparks) {
      g.globalAlpha = Math.max(0, (1 - p.age / p.life) * (0.6 + 0.4 * Math.sin(p.age * 25 + p.k)));
      g.fillStyle = "rgb(255,190,90)";
      g.fillRect(p.x, p.y, 2, 2);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  }
  return { resize, frame };
}
