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
export const TITLE_STYLES = [["spray", "Spray-painted"], ["stencil", "Cracked stencil"], ["blood", "Blood-red serif"], ["minimal", "Clean minimal"]];
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
  if (last) items.push(`<button class="tt-item primary" data-action="set-continue"${tip(`Load the latest save: ${last.name}`)}>Continue<small>${esc(last.name)}${/\bday \d/i.test(last.name || "") ? "" : ` · day ${esc(last.day ?? "?")}`}</small></button>`);
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
  const dpr = window.devicePixelRatio || 1, res = Math.min(dpr, 2);
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

// ---------- the dead ----------
// Builds and gaits, so no two of them walk alike: some drag a foot, some lurch, a few crawl, a few just stand and sway.
function walkers(n, seed, opts) {
  const R = rng(seed), out = [];
  for (let i = 0; i < n; i++) {
    const kind = R();
    out.push({
      x: R(), depth: R(), dir: R() < 0.5 ? -1 : 1, ph: R() * 6.28, speed: 0.5 + R() * 0.6,
      k: {
        seed: R() * 6, lean: 4 + R() * 18, droop: (R() - 0.3) * 8, reach: 0.6 + R() * 0.9, both: R() < 0.3, limp: R() < 0.5,
        bulk: 0.8 + R() * 0.5, tall: 0.85 + R() * 0.3, coat: R() < 0.55, hair: R() < 0.4, lurch: R() < 0.3,
        crawl: kind < 0.08, idle: kind >= 0.08 && kind < 0.2,
      },
      ...opts,
    });
  }
  return out;
}

// One of the dead, feet at (x, y), s pixels tall (drawn in units of 100 = full height), facing dir (±1). ph: the
// step's phase. rim: a colour for a thin edge of backlight around the silhouette.
function shambler(g, x, y, s, ph, dir, k, color, rim) {
  g.save();
  g.translate(x, y);
  g.scale((dir * s * k.tall) / 100, (s * k.tall) / 100);
  g.lineCap = "round";
  g.lineJoin = "round";
  const B = k.bulk;
  const paint = (extra, col) => {
    g.strokeStyle = g.fillStyle = col;
    const lw = (w) => { g.lineWidth = w * B + extra * 2; };
    const seg = (pts) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.stroke(); };
    const dot = (cx, cy, r) => { g.beginPath(); g.arc(cx, cy, r * B + extra, 0, Math.PI * 2); g.fill(); };
    if (k.crawl) { // on its belly, pulling itself along by the arms, the legs trailing
      const pull = Math.sin(ph), by = -9;
      lw(7); seg([[-18, by + 2], [-30, -2], [-38, 0]]); seg([[-16, by + 3], [-27, -1 + pull], [-35, 0]]);
      lw(13); seg([[-18, by + 2 - Math.max(0, pull)], [8, by]]);
      lw(5); seg([[8, by], [15, by - 4]]);
      dot(17, by - 6, 7);
      lw(6);
      const a1 = 10 + pull * 8, a2 = 10 - pull * 8;
      seg([[8, by - 2], [14 + a1, -4], [22 + a1, 0]]);
      seg([[6, by], [12 + a2, -3], [20 + a2, 0]]);
      return;
    }
    const sway = k.idle ? Math.sin(ph * 0.35 + k.seed) : 0;
    const bob = k.idle ? 0 : Math.abs(Math.cos(ph)) * (k.lurch ? 3 : 2);
    const lean = (k.idle ? 6 : k.lean) + Math.sin(ph * 0.5 + k.seed) * 3 + sway * 4;
    const legL = 46, hipY = -legL + bob, hipX = sway * 2;
    const rad = (lean * Math.PI) / 180, spine = 36;
    const shX = hipX + Math.sin(rad) * spine, shY = hipY - Math.cos(rad) * spine;
    // Legs: thigh, shin and foot; the knee bends on the swing, a dragged foot trails toe down.
    const leg = (sw, v, drag) => {
      const thigh = 24, shin = 22;
      const a = k.idle ? sw * 0.12 : drag ? sw * 0.22 + 0.1 : sw * 0.45;
      const bend = drag ? 0.55 : k.idle ? 0 : Math.max(0, v) * 0.9;
      const kx = hipX + Math.sin(a) * thigh, ky = hipY + Math.cos(a) * thigh;
      const ax = kx + Math.sin(a - bend) * shin, ay = Math.min(0, ky + Math.cos(a - bend) * shin);
      lw(8.5);
      seg([[hipX, hipY], [kx, ky], [ax, ay]]);
      lw(5);
      if (drag) seg([[ax, ay], [ax - 9, Math.min(0, ay + 2)]]);
      else seg([[ax, ay], [ax + 8, Math.min(0, ay + 1)]]);
    };
    const sw = k.idle ? sway : Math.sin(ph), v = Math.cos(ph);
    leg(k.idle ? -0.8 : sw, v, k.limp);
    leg(k.idle ? 0.8 : -sw, -v, false);
    // A coat or rags hanging from the hips, flapping.
    if (k.coat) {
      const hem = hipY + 12;
      g.beginPath();
      g.moveTo(hipX - 9 * B, hipY - 6); g.lineTo(shX - 8 * B, shY + 2); g.lineTo(shX + 8 * B, shY + 2); g.lineTo(hipX + 10 * B, hipY - 4);
      for (let i = 0; i < 5; i++) { const fx = hipX + 10 * B - (i * 19 * B) / 4; g.lineTo(fx, hem + (i % 2 ? -4 : 3) + Math.sin(ph * 2 + i + k.seed) * 2 - (i === 0 || i === 4 ? 2 : 0)); }
      g.closePath(); g.fill();
    }
    lw(15);
    seg([[hipX, hipY], [shX, shY]]);
    // Head on a bent neck, matted hair on some.
    lw(5);
    const hx = shX + 5 + (k.droop || 0) + Math.sin(ph * 0.5 + k.seed) * 1.5, hy = shY - 8 + Math.abs(k.droop || 0) * 0.35 + (k.idle ? Math.sin(ph * 0.5) * 1.5 : 0);
    seg([[shX, shY], [hx, hy + 4]]);
    dot(hx, hy, 7.5);
    if (k.hair) { g.beginPath(); g.arc(hx - 2, hy - 2, 7.5 * B + extra, Math.PI * 1.05, Math.PI * 1.95); g.lineTo(hx - 9 * B, hy + 6); g.lineTo(hx - 4, hy + 2); g.closePath(); g.fill(); }
    // Arms: upper arm, forearm, hand. One reaching, one hanging (or both reaching).
    const arm = (r1, r2, w) => {
      const sx = shX, sy = shY + 3, up = 16, fo = 16;
      const ex = sx + Math.sin(r1) * up, ey = sy + Math.cos(r1) * up;
      const wx = ex + Math.sin(r2) * fo, wy = ey + Math.cos(r2) * fo;
      lw(w); seg([[sx, sy], [ex, ey], [wx, wy]]);
      dot(wx + Math.sin(r2) * 2, wy + Math.cos(r2) * 2, 2.6);
    };
    const reach = k.reach + Math.sin(ph + k.seed) * 0.08;
    arm(reach, reach + 0.25 + Math.sin(ph * 1.3 + k.seed) * 0.15, 6.5);
    const hang = k.both ? reach - 0.25 : 0.1 + Math.sin(ph) * 0.18 * (k.idle ? 0.4 : 1);
    arm(hang, hang + 0.12, 6);
  };
  if (rim) paint(1.6, rim);
  paint(0, color);
  g.restore();
}

// ---------- background: a ruined skyline at dusk ----------
function skylineScene() {
  let W = 0, H = 0, res = 1, sky, far, mid, near, street, props, fore, fogBack, fogFront, haze;
  let horizon = 0, streetY = 0, P = 0, lampX = 0, lampY = 0;
  const lights = []; // lit windows: [layer, x, y, w, h, phase]
  const fires = [];  // windows with fire behind them, mid layer: [x, y, w, h, phase]
  let sources = [];  // where the smoke rises (fractions of the mid layer)
  const smoke = [], embers = [], ash = [];
  let crowd = [], crows = [], flare = null, heli = null;
  const dark = puff("26,22,25"), lit = puff("125,62,38"), glowP = puff("255,118,40"), ember = puff("255,170,80", 0.3), flameP = puff("255,170,60", 0.2), flash = puff("255,210,150");

  // One layer of buildings: a silhouette strip P wide that scrolls (drawn twice). windows: the window size (0: none).
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
    let nb = 0;
    for (const [x0, w, h, s] of shapes) for (const dx of [0, -P, P]) {
      const r = rng(s), x = x0 + dx, y = base - h, kind = r();
      g.fillStyle = color;
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
      if (kind >= 0.62 && extra < 0.25) { // antenna
        g.beginPath(); g.moveTo(x + w * 0.5, y); g.lineTo(x + w * 0.5 + (r() - 0.5) * 8, y - h * (0.15 + r() * 0.2)); g.stroke();
      } else if (kind >= 0.62 && extra < 0.42) { // water tower
        const tx = x + w * (0.25 + r() * 0.4), tw = Math.min(26, w * 0.3), th = tw * 0.8;
        g.beginPath(); g.moveTo(tx, y); g.lineTo(tx + 3, y - th * 0.7); g.moveTo(tx + tw, y); g.lineTo(tx + tw - 3, y - th * 0.7); g.stroke();
        g.fillRect(tx, y - th * 1.5, tw, th * 0.8);
        g.beginPath(); g.moveTo(tx - 2, y - th * 1.5); g.lineTo(tx + tw / 2, y - th * 1.9); g.lineTo(tx + tw + 2, y - th * 1.5); g.fill();
      } else if (kind >= 0.62 && extra < 0.55) { // the bare frame of the floors that are gone
        const fh = h * 0.35, cols = 3 + (r() * 3) | 0;
        for (let i = 0; i <= cols; i++) { if (r() < 0.3) continue; g.beginPath(); g.moveTo(x + (w * i) / cols, y); g.lineTo(x + (w * i) / cols, y - fh * (0.4 + r() * 0.6)); g.stroke(); }
        for (let j = 1; j < 3; j++) { g.beginPath(); g.moveTo(x, y - (fh * j) / 3); g.lineTo(x + w * (0.3 + r() * 0.7), y - (fh * j) / 3); g.stroke(); }
      } else if (kind >= 0.62 && extra < 0.68 && idx === 2 && w > W * 0.07) { // a billboard on legs, its poster hanging off in strips
        const bw = w * 0.7, bh = bw * 0.38, bx = x + w * 0.15, by = y - bh - h * 0.06;
        g.lineWidth = 2.5;
        for (const lx of [bx + bw * 0.2, bx + bw * 0.8]) { g.beginPath(); g.moveTo(lx, y); g.lineTo(lx, by + bh); g.stroke(); }
        g.fillRect(bx, by, bw, bh);
        g.fillStyle = "#2b2426";
        g.fillRect(bx + 2, by + 2, bw - 4, bh - 4);
        g.fillStyle = "#4e3f3a";
        for (let i = 0; i < 4; i++) { const sx = bx + 3 + (bw - 6) * (i / 4), sw = (bw - 6) / 4 - 2; g.fillRect(sx, by + 3, sw, (bh - 6) * (0.4 + r() * 0.6)); }
        g.fillStyle = color;
      }
      // Windows: the glass shows faintly against the wall, some are boarded or gone; a few are lit (`lights`); in
      // one building out of eight in the middle layer a fire burns on the upper floors (`fires`).
      if (windows && dx === 0) {
        nb++;
        const burning = idx === 1 && nb % 8 === 3 && h > H * 0.16;
        if (burning) sources.push(x0 + w * 0.5);
        const cw = windows, rows = Math.floor((h * 0.85) / (cw * 2.4)), cols = Math.floor((w * 0.8) / (cw * 2));
        for (let j = 1; j < rows; j++) for (let i = 0; i < cols; i++) {
          const wx = x + w * 0.1 + i * cw * 2, wy = base - h * 0.9 + j * cw * 2.4;
          if (wy < y + h * 0.4 && kind < 0.38) continue;
          const v = r();
          if (burning && j <= Math.max(2, rows * 0.35) && v < 0.8) { fires.push([wx, wy, cw, cw * 1.3, r() * 100]); continue; }
          if (v < 0.012) lights.push([idx, wx, wy, cw, cw * 1.3, r() * 100]);
          else if (v < 0.55) { g.fillStyle = idx === 2 ? "rgba(140,105,95,0.13)" : "rgba(255,190,140,0.05)"; g.fillRect(wx, wy, cw, cw * 1.3); }
          else if (v < 0.62 && idx === 2) { g.fillStyle = "rgba(60,45,40,0.5)"; g.fillRect(wx, wy, cw, cw * 1.3); } // boarded
          g.fillStyle = color;
        }
      }
    }
    return L;
  }

  // The street under the dead: cracked asphalt lit from behind by the fires, lane marks, puddles, rubbish.
  function streetLayer() {
    const top = streetY;
    const L = layer(W, H - top, res), R = rng(404), g = L.g;
    g.translate(0, -top);
    const gr = g.createLinearGradient(0, streetY, 0, H);
    gr.addColorStop(0, "#5a4a40"); gr.addColorStop(0.08, "#463a33"); gr.addColorStop(0.4, "#2e2724"); gr.addColorStop(1, "#1a1514");
    g.fillStyle = gr;
    g.fillRect(0, streetY, W, H - streetY);
    // Grain: thousands of flecks, lighter near the camera.
    for (let i = 0; i < 2600; i++) {
      const y = streetY + Math.pow(R(), 0.7) * (H - streetY), v = R();
      g.fillStyle = v < 0.5 ? `rgba(120,100,90,${(0.03 + R() * 0.07).toFixed(3)})` : `rgba(0,0,0,${(0.05 + R() * 0.1).toFixed(3)})`;
      const sz = 1 + R() * 2 * (y - streetY) / (H - streetY) * 2;
      g.fillRect(R() * W, y, sz, sz * 0.6);
    }
    // The kerb: a pale lip along the far edge, the gutter dark under it.
    g.fillStyle = "#6a5a4e";
    g.fillRect(0, streetY, W, Math.max(2, H * 0.004));
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(0, streetY + H * 0.004, W, H * 0.006);
    // The road runs across the screen: a faded dashed centre line and a worn edge line, bent by the camber.
    const cy = streetY + H * 0.052;
    g.fillStyle = "rgba(190,160,90,0.14)";
    for (let x = -H * 0.02 + R() * H * 0.04; x < W; x += H * 0.09) if (R() < 0.8) g.fillRect(x, cy + Math.sin(x * 0.01) * 1.5, H * 0.045, Math.max(2, H * 0.004));
    g.fillStyle = "rgba(200,190,170,0.08)";
    for (let x = 0; x < W; x += H * 0.03) if (R() < 0.75) g.fillRect(x, streetY + H * 0.013, H * 0.028, Math.max(1.5, H * 0.0025));
    // Cracks: dark polylines, a few with grass pushing through.
    g.lineCap = "round";
    for (let i = 0; i < 34; i++) {
      let x = R() * W, y = streetY + H * 0.01 + R() * (H - streetY) * 0.95;
      const f = (y - streetY) / (H - streetY);
      g.strokeStyle = `rgba(10,8,8,${(0.35 + f * 0.4).toFixed(2)})`;
      g.lineWidth = 0.8 + f * 2.2;
      g.beginPath(); g.moveTo(x, y);
      for (let j = 0; j < 4 + R() * 5; j++) { x += (R() - 0.5) * H * 0.08 * (0.4 + f); y += (R() - 0.3) * H * 0.02 * (0.4 + f); g.lineTo(x, y); }
      g.stroke();
      if (R() < 0.4) { // grass in the crack
        g.strokeStyle = "rgba(70,75,40,0.7)"; g.lineWidth = 1 + f;
        for (let b = 0; b < 6; b++) { g.beginPath(); g.moveTo(x + (R() - 0.5) * 8, y); g.lineTo(x + (R() - 0.5) * 16, y - (3 + R() * 6) * (0.5 + f)); g.stroke(); }
      }
    }
    // Puddles and potholes: dark, with the fires' glow mirrored in them.
    for (let i = 0; i < 9; i++) {
      const y = streetY + H * 0.02 + R() * (H - streetY) * 0.9, f = (y - streetY) / (H - streetY), x = R() * W;
      const rx = H * (0.02 + R() * 0.05) * (0.4 + f), ry = rx * (0.18 + f * 0.12);
      const hole = R() < 0.35;
      g.fillStyle = hole ? "#120e0d" : "#1b1716";
      g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
      if (!hole) {
        const rg = g.createLinearGradient(0, y - ry, 0, y + ry);
        rg.addColorStop(0, "rgba(190,95,50,0.35)"); rg.addColorStop(0.5, "rgba(120,60,40,0.1)"); rg.addColorStop(1, "rgba(60,40,40,0.05)");
        g.fillStyle = rg;
        g.beginPath(); g.ellipse(x, y, rx * 0.92, ry * 0.85, 0, 0, Math.PI * 2); g.fill();
      }
    }
    // Rubbish: bricks, paper, bottles, a tyre, a suitcase, bones.
    for (let i = 0; i < 70; i++) {
      const y = streetY + H * 0.012 + R() * (H - streetY) * 0.9, f = (y - streetY) / (H - streetY), x = R() * W, k = R(), sc = (0.4 + f) * H * 0.0034;
      g.save(); g.translate(x, y); g.rotate((R() - 0.5) * 0.8);
      if (k < 0.3) { g.fillStyle = "#3b2a24"; g.fillRect(-sc * 1.6, -sc * 0.7, sc * 3.2, sc * 1.4); g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(-sc * 1.6, sc * 0.3, sc * 3.2, sc * 0.5); }
      else if (k < 0.6) { g.fillStyle = `rgba(150,140,120,${(0.25 + R() * 0.3).toFixed(2)})`; g.beginPath(); g.moveTo(-sc * 2, 0); g.lineTo(sc * 1.5, -sc * 1.2); g.lineTo(sc * 2.2, sc * 0.5); g.lineTo(-sc * 0.8, sc * 1.1); g.closePath(); g.fill(); }
      else if (k < 0.78) { g.fillStyle = "#1e1a18"; g.fillRect(-sc * 2, -sc * 0.5, sc * 4, sc); g.fillStyle = "rgba(255,170,110,0.18)"; g.fillRect(sc * 0.5, -sc * 0.5, sc, sc * 0.3); }
      else if (k < 0.88) { g.strokeStyle = "#141010"; g.lineWidth = sc * 1.2; g.beginPath(); g.ellipse(0, 0, sc * 3, sc * 1.2, 0, 0, Math.PI * 2); g.stroke(); }
      else { g.fillStyle = "#2a1f1b"; g.fillRect(-sc * 3, -sc * 2, sc * 6, sc * 4); g.fillStyle = "rgba(0,0,0,0.4)"; g.fillRect(-sc * 3, -sc * 2, sc * 6, sc * 0.6); }
      g.restore();
    }
    // Dark stains along the far edge, where the fires' light cannot reach the ground under the walls.
    const sh = g.createLinearGradient(0, streetY, 0, streetY + H * 0.05);
    sh.addColorStop(0, "rgba(0,0,0,0.45)"); sh.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = sh;
    g.fillRect(0, streetY, W, H * 0.05);
    return L;
  }

  // Things standing on the kerb behind the dead: power poles and their sagging wires, the street lamp, the
  // quarantine fence, a bus shelter.
  function propsLayer() {
    const L = layer(W, H, res), R = rng(77), g = L.g;
    const base = streetY + H * 0.008;
    g.lineCap = "round";
    // Poles with wires between them, one wire down.
    const poles = [];
    for (let x = W * 0.05 + R() * W * 0.1; x < W; x += W * (0.2 + R() * 0.12)) poles.push(x);
    g.strokeStyle = "#0a0808";
    for (const x of poles) {
      g.lineWidth = Math.max(3, H * 0.007);
      g.beginPath(); g.moveTo(x, base); g.lineTo(x + (R() - 0.5) * 6, base - H * 0.34); g.stroke();
      g.lineWidth = Math.max(2, H * 0.004);
      g.beginPath(); g.moveTo(x - H * 0.03, base - H * 0.31); g.lineTo(x + H * 0.03, base - H * 0.31); g.stroke();
      g.beginPath(); g.moveTo(x - H * 0.022, base - H * 0.33); g.lineTo(x + H * 0.022, base - H * 0.33); g.stroke();
    }
    g.lineWidth = 1.1;
    g.strokeStyle = "rgba(8,6,6,0.85)";
    for (let i = 0; i + 1 < poles.length; i++) for (const dy of [0.31, 0.33]) {
      const x0 = poles[i], x1 = poles[i + 1], y0 = base - H * dy;
      if (R() < 0.18) { // a wire down, hanging to the road
        g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(x0 + (x1 - x0) * 0.3, y0 + H * 0.2, x0 + (x1 - x0) * 0.35, base + H * 0.02); g.stroke();
        continue;
      }
      g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, y0 + H * 0.035, x1, y0); g.stroke();
    }
    // The street lamp, bent over the road; its head is where the light comes from (drawn every frame).
    const lx = W * 0.8;
    lampX = lx + H * 0.062; lampY = base - H * 0.33;
    g.strokeStyle = "#0a0808";
    g.lineWidth = Math.max(3.5, H * 0.007);
    g.beginPath(); g.moveTo(lx, base); g.lineTo(lx + 3, base - H * 0.28); g.quadraticCurveTo(lx + 7, base - H * 0.345, lampX, lampY + H * 0.006); g.stroke();
    g.fillStyle = "#0a0808";
    g.fillRect(lampX - H * 0.016, lampY - H * 0.006, H * 0.032, H * 0.012);
    // A bus shelter, its glass gone.
    const bx = W * 0.3, bw = H * 0.16, bh = H * 0.09;
    g.lineWidth = Math.max(2, H * 0.004);
    for (const px of [bx, bx + bw * 0.5, bx + bw]) { g.beginPath(); g.moveTo(px, base); g.lineTo(px, base - bh); g.stroke(); }
    g.fillRect(bx - 4, base - bh - H * 0.012, bw + 8, H * 0.012);
    g.fillStyle = "rgba(40,30,30,0.5)";
    g.fillRect(bx + bw * 0.5 + 2, base - bh * 0.9, bw * 0.5 - 4, bh * 0.75);
    // Chain-link fence with the warning sign, sagging between its posts.
    const f0 = W * 0.52, f1 = W * 0.7, fy = base, fh = H * 0.11;
    g.strokeStyle = "#0a0808";
    g.lineWidth = 3;
    for (let x = f0; x <= f1; x += (f1 - f0) / 4) { g.beginPath(); g.moveTo(x, fy); g.lineTo(x + (R() - 0.5) * 6, fy - fh); g.stroke(); }
    g.strokeStyle = "rgba(10,8,8,0.55)";
    g.lineWidth = 1;
    for (let x = f0; x < f1; x += 7) {
      const sag = Math.sin(((x - f0) / ((f1 - f0) / 4)) * Math.PI) * 6;
      g.beginPath(); g.moveTo(x, fy); g.lineTo(x + 12, fy - fh + sag); g.moveTo(x + 12, fy); g.lineTo(x, fy - fh + sag); g.stroke();
    }
    g.fillStyle = "#5a4c20";
    const sx = f0 + (f1 - f0) * 0.3, sy = fy - fh * 0.78, sw = (f1 - f0) * 0.24;
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

  // In front of the dead: a car on its side at the left, a heap of rubble and a shopping trolley at the right.
  function foreLayer() {
    const top = streetY + H * 0.05;
    const L = layer(W, H - top, res), R = rng(909), g = L.g;
    g.translate(0, -top);
    // The car, hatchback, on its side, cropped by the screen's edge.
    g.save();
    g.translate(W * 0.02, H * 0.985);
    g.rotate(-0.06);
    const cw = H * 0.34, ch = H * 0.1;
    g.fillStyle = "#07060a";
    g.beginPath();
    g.moveTo(-cw * 0.2, 0); g.lineTo(-cw * 0.2, -ch * 0.5); g.lineTo(cw * 0.1, -ch * 0.58); g.lineTo(cw * 0.28, -ch); g.lineTo(cw * 0.68, -ch); g.lineTo(cw * 0.84, -ch * 0.62); g.lineTo(cw, -ch * 0.48); g.lineTo(cw, 0); g.closePath();
    g.fill();
    g.fillStyle = "rgba(150,110,80,0.09)";
    g.beginPath(); g.moveTo(cw * 0.32, -ch * 0.92); g.lineTo(cw * 0.48, -ch * 0.92); g.lineTo(cw * 0.46, -ch * 0.62); g.lineTo(cw * 0.26, -ch * 0.62); g.fill();
    g.beginPath(); g.moveTo(cw * 0.52, -ch * 0.92); g.lineTo(cw * 0.66, -ch * 0.92); g.lineTo(cw * 0.76, -ch * 0.62); g.lineTo(cw * 0.5, -ch * 0.62); g.fill();
    g.fillStyle = "#07060a";
    g.beginPath(); g.arc(cw * 0.1, 0, ch * 0.3, 0, Math.PI * 2); g.arc(cw * 0.78, 0, ch * 0.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#1a1715";
    g.beginPath(); g.arc(cw * 0.1, 0, ch * 0.13, 0, Math.PI * 2); g.arc(cw * 0.78, 0, ch * 0.13, 0, Math.PI * 2); g.fill();
    g.restore();
    // Rubble: a dark heap with slabs, rebar and a trolley on its side.
    g.fillStyle = "#070608";
    g.beginPath();
    g.moveTo(W * 0.58, H);
    for (let x = W * 0.58; x <= W + 20; x += 14 + R() * 26) g.lineTo(x, H - R() * H * 0.04 - Math.sin((x - W * 0.58) / (W * 0.42) * Math.PI) * H * 0.07);
    g.lineTo(W, H);
    g.fill();
    g.strokeStyle = "#070608";
    for (let i = 0; i < 22; i++) {
      const x = W * 0.6 + R() * W * 0.4, y = H - R() * H * 0.05 - H * 0.03;
      g.lineWidth = 1.5 + R() * 2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 40, y - 12 - R() * 34); g.stroke();
    }
    g.lineWidth = 2.5;
    g.save(); g.translate(W * 0.9, H * 0.96); g.rotate(0.9);
    g.strokeRect(-H * 0.03, -H * 0.045, H * 0.06, H * 0.045);
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(-H * 0.03 + (H * 0.06 * i) / 4, -H * 0.045); g.lineTo(-H * 0.03 + (H * 0.06 * i) / 4, 0); g.stroke(); }
    g.restore();
    return L;
  }

  function resize(w, h, r) {
    W = w; H = h; res = r;
    horizon = H * 0.64; streetY = H * 0.8;
    P = Math.ceil(W * 1.3);
    lights.length = 0; fires.length = 0; sources = [];
    // Sky: bruised dark above, the burning city's glow at the horizon.
    sky = layer(W, H, res);
    const gr = sky.g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, "#0a0b12"); gr.addColorStop(0.35, "#1d1520"); gr.addColorStop(0.55, "#3f1f22"); gr.addColorStop(0.68, "#7a3520"); gr.addColorStop(0.8, "#4a2218"); gr.addColorStop(1, "#140c0c");
    sky.g.fillStyle = gr;
    sky.g.fillRect(0, 0, W, H);
    far = buildingLayer(11, H * 0.3, horizon + H * 0.04, H * 0.06, H * 0.2, W * 0.025, W * 0.06, "#3b2427", 0, 0);
    mid = buildingLayer(23, H * 0.22, horizon + H * 0.1, H * 0.1, H * 0.32, W * 0.035, W * 0.08, "#1e1417", Math.max(2, H * 0.004), 1);
    near = buildingLayer(37, H * 0.25, streetY - H * 0.003, H * 0.12, H * 0.42, W * 0.05, W * 0.11, "#0d0a0c", Math.max(2.5, H * 0.005), 2);
    if (sources.length < 2) sources.push(P * 0.22, P * 0.81);
    sources = sources.map((x) => x / P);
    street = streetLayer();
    props = propsLayer();
    fore = foreLayer();
    fogBack = fogStrip(W, H * 0.3, "150,82,58", 5, res, 1.2);
    fogFront = fogStrip(W, H * 0.22, "70,48,46", 8, res, 0.9);
    haze = fogStrip(W, H * 0.25, "120,58,40", 13, res, 0.8);
    crowd = walkers(15, 77, {});
    crows = walkers(4, 99, {}).map((c) => ({ ...c, y: 0.1 + c.depth * 0.25 }));
    heli = { x: -W * 0.3, y: H * 0.1, v: 22 + Math.random() * 10 };
    smoke.length = 0; embers.length = 0; ash.length = 0;
    const R = rng(5);
    for (let i = 0; i < 60; i++) ash.push({ x: R() * W, y: R() * H, vy: 6 + R() * 14, k: R() * 9, s: 1 + R() * 1.5 });
    flare = null;
    // Start with the plumes already up, not growing from nothing.
    for (let i = 0; i < 400; i++) step(1 / 20, i / 20, true);
  }

  // The particles: smoke from the fires (behind the near buildings), embers and ash in the air, now and then a
  // blast somewhere in the city.
  function step(dt, t, warm) {
    const off = t * 3; // the mid layer's drift
    for (const f of sources) {
      if (Math.random() < dt * 7) {
        const sx = (((f * P - off) % P) + P) % P - (P - W) / 2;
        smoke.push({ x: sx + (Math.random() - 0.5) * 30, y: horizon + H * 0.02, vx: 4 + Math.random() * 6, vy: -(14 + Math.random() * 10), r: H * 0.03, life: 14 + Math.random() * 8, age: 0 });
        if (!warm && Math.random() < 0.7) embers.push({ x: sx, y: horizon + H * 0.03, vx: (Math.random() - 0.3) * 16, vy: -(20 + Math.random() * 30), life: 3 + Math.random() * 4, age: 0, k: Math.random() * 9 });
      }
    }
    if (!warm && Math.random() < dt * 5) embers.push({ x: Math.random() * W, y: H * (0.85 + Math.random() * 0.1), vx: 6 + Math.random() * 10, vy: -(12 + Math.random() * 22), life: 4 + Math.random() * 5, age: 0, k: Math.random() * 9 });
    if (!warm && !flare && Math.random() < dt / 28) {
      flare = { x: W * (0.1 + Math.random() * 0.8), age: 0 };
      for (let i = 0; i < 40; i++) embers.push({ x: flare.x + (Math.random() - 0.5) * 40, y: horizon + H * 0.02, vx: (Math.random() - 0.5) * 90, vy: -(40 + Math.random() * 90), life: 2 + Math.random() * 3, age: 0, k: Math.random() * 9 });
      for (let i = 0; i < 6; i++) smoke.push({ x: flare.x + (Math.random() - 0.5) * 40, y: horizon + H * 0.02, vx: 4 + Math.random() * 6, vy: -(30 + Math.random() * 20), r: H * 0.04, life: 16, age: 0 });
    }
    if (flare) { flare.age += dt; if (flare.age > 3.5) flare = null; }
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
      p.vy += 12 * dt; // slowing as they rise, then drifting down
    }
    for (const a of ash) {
      a.y += a.vy * dt;
      a.x += (6 + Math.sin(t * 0.7 + a.k) * 10) * dt;
      if (a.y > H) { a.y = -4; a.x = Math.random() * W; }
      if (a.x > W + 4) a.x = -4;
    }
    if (heli) { heli.x += heli.v * dt; if (heli.x > W + W * 0.3) { heli.x = -W * 0.3; heli.y = H * (0.06 + Math.random() * 0.1); } }
  }

  function frame(g, t, dt) {
    step(dt, t, false);
    g.drawImage(sky.c, 0, 0, W, H);
    // The fires' glow on the clouds and the haze, flickering; the flash of a blast.
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < sources.length; i++) {
      const sx = (((sources[i] * P - t * 3) % P) + P) % P - (P - W) / 2;
      const r = H * (0.42 + 0.04 * wob(t * 0.8, i * 3));
      g.globalAlpha = 0.16 + 0.05 * wob(t * 1.3, i);
      g.drawImage(glowP, sx - r, horizon - r * 0.7, r * 2, r * 1.4);
    }
    if (flare) {
      const a = flare.age < 0.2 ? flare.age / 0.2 : Math.max(0, 1 - (flare.age - 0.2) / 3), r = H * (0.2 + flare.age * 0.08);
      g.globalAlpha = a * 0.9;
      g.drawImage(flash, flare.x - r, horizon - r * 0.8, r * 2, r * 1.5);
      g.globalAlpha = Math.max(0, 1 - flare.age / 0.35) * 0.18;
      g.fillStyle = "rgb(255,200,140)";
      g.fillRect(0, 0, W, H);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    // High smoke drifting across the sky.
    drawStrip(g, haze, -t * 6, H * 0.06, W, H * 0.25);
    drawStrip(g, haze, -t * 11 + W * 0.4, H * 0.24, W, H * 0.22);
    // A helicopter far off, its lights blinking, a searchlight sweeping the ground below it.
    if (heli) {
      const hx = heli.x, hy = heli.y + Math.sin(t * 0.5) * 4;
      const sw = Math.sin(t * 0.35) * H * 0.08;
      const cone = g.createLinearGradient(0, hy, 0, horizon + H * 0.05);
      cone.addColorStop(0, "rgba(255,240,210,0.07)"); cone.addColorStop(1, "rgba(255,240,210,0)");
      g.fillStyle = cone;
      g.beginPath(); g.moveTo(hx - 2, hy); g.lineTo(hx + 2, hy); g.lineTo(hx + sw + H * 0.06, horizon + H * 0.05); g.lineTo(hx + sw - H * 0.06, horizon + H * 0.05); g.fill();
      g.fillStyle = "#0b0a0e";
      g.fillRect(hx - 7, hy - 2, 14, 4);
      g.fillRect(hx + 6, hy - 1, 9, 2);
      g.fillRect(hx - 9, hy - 3.5, 18, 1);
      if (t % 1 < 0.12) { g.fillStyle = "#ff3030"; g.fillRect(hx - 1, hy + 2, 2, 2); }
      if (t % 1.6 < 0.06) { g.fillStyle = "#fff"; g.fillRect(hx + 13, hy - 1, 2, 2); }
    }
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
    // The burning floors: flames licking out of the windows, a glow on the wall around them.
    const midOff = (((-t * 3) % P) + P) % P - (P - W) / 2;
    g.globalCompositeOperation = "lighter";
    for (const [x, y, w, h, ph] of fires) {
      let sx = x + midOff;
      if (sx > W + 10) sx -= P;
      if (sx < -10 - w) continue;
      const f = 0.6 + 0.4 * wob(t * 6, ph);
      g.globalAlpha = 0.35 * f;
      g.drawImage(glowP, sx - w * 2, y - h * 2, w * 5, h * 4.5);
      g.globalAlpha = 0.9 * f;
      g.fillStyle = `rgb(255,${120 + ((ph * 7) % 60) | 0},30)`;
      g.fillRect(sx, y, w, h);
      g.globalAlpha = 0.55 * f;
      g.drawImage(flameP, sx - w * 0.4 + Math.sin(t * 9 + ph) * 1.5, y - h * (0.9 + 0.5 * f), w * 1.8, h * 1.6);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    drawStrip(g, fogBack, -t * 7 + W * 0.3, horizon - H * 0.02, W, H * 0.3);
    layerAt(near, H * 0.25, 5);
    // Lit windows: a few, flickering like candles and failing bulbs.
    for (const [li, x, y, w, h, ph] of lights) {
      const speed = [1.8, 3, 5][li], off = (((-t * speed) % P) + P) % P - (P - W) / 2;
      let sx = x + off;
      if (sx > W + 10) sx -= P;
      if (sx < -10 - w) continue;
      const f = 0.55 + 0.45 * wob(t * (1 + (ph % 3)), ph);
      if (f < 0.25) continue;
      g.fillStyle = `rgba(255,${150 + (ph % 50) | 0},70,${(0.35 + f * 0.45) * (li === 0 ? 0.5 : 1)})`;
      g.fillRect(sx, y, w, h);
    }
    // Fog lit from behind along the far side of the street, so the dead stand out against it.
    const sg = g.createLinearGradient(0, streetY - H * 0.14, 0, streetY + H * 0.01);
    sg.addColorStop(0, "rgba(120,62,44,0)"); sg.addColorStop(0.75, "rgba(130,66,46,0.5)"); sg.addColorStop(1, "rgba(130,66,46,0.55)");
    g.fillStyle = sg;
    g.fillRect(0, streetY - H * 0.14, W, H * 0.15);
    drawStrip(g, fogBack, t * 9, streetY - H * 0.24, W, H * 0.3);
    g.drawImage(props.c, 0, 0, W, H);
    g.drawImage(street.c, 0, streetY, W, street.h);
    // The street lamp: on, off, buzzing back; a pool of light on the road under it.
    const lampOn = wob(t * 2.3, 4) > -0.55 && (t % 7.3) > 0.25;
    if (lampOn) {
      const poolY = streetY + H * 0.055;
      const cone = g.createLinearGradient(0, lampY, 0, poolY + H * 0.05);
      cone.addColorStop(0, "rgba(255,214,150,0.3)"); cone.addColorStop(1, "rgba(255,214,150,0)");
      g.fillStyle = cone;
      g.beginPath(); g.moveTo(lampX - 6, lampY); g.lineTo(lampX + 6, lampY); g.lineTo(lampX + H * 0.15, poolY + H * 0.05); g.lineTo(lampX - H * 0.15, poolY + H * 0.05); g.fill();
      const pool = g.createRadialGradient(lampX, poolY, 0, lampX, poolY, H * 0.16);
      pool.addColorStop(0, "rgba(255,214,150,0.28)"); pool.addColorStop(1, "rgba(255,214,150,0)");
      g.fillStyle = pool;
      g.save(); g.translate(lampX, poolY); g.scale(1, 0.32); g.beginPath(); g.arc(0, 0, H * 0.16, 0, Math.PI * 2); g.fill(); g.restore();
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.5;
      g.drawImage(glowP, lampX - 18, lampY - 10, 36, 24);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    // The dead on the street, the far ones smaller and greyer, each with its shadow and a thin rim of firelight;
    // those under the lamp are lit by it. Mist drifts over the road between the far and the near ones.
    const sorted = crowd.slice().sort((a, b) => a.depth - b.depth);
    let mist = false;
    for (const z of sorted) {
      if (!mist && z.depth > 0.5) { drawStrip(g, fogFront, -t * 10 + W * 0.2, streetY - H * 0.02, W, H * 0.12); mist = true; }
      const s = H * (0.085 + z.depth * 0.1), span = W + s * 2;
      const gait = z.k.crawl ? 0.25 : z.k.idle ? 0 : z.speed * (0.6 + 0.4 * Math.max(0, Math.sin(t * 0.9 + z.ph))) * (z.k.lurch && Math.sin(t * 1.7 + z.ph) > 0.6 ? 2.2 : 1);
      z.pos = (z.pos ?? z.x * span) + gait * s * 0.18 * dt * z.dir;
      const x = ((z.pos % span) + span) % span - s;
      const y = streetY + H * 0.015 + z.depth * H * 0.14;
      const litBy = lampOn ? Math.max(0, 1 - Math.abs(x - lampX) / (H * 0.14)) * (0.5 + z.depth * 0.5) : 0;
      const shade = Math.round(30 - z.depth * 22 + litBy * 70);
      g.fillStyle = `rgba(0,0,0,${(0.35 + z.depth * 0.25).toFixed(2)})`;
      g.beginPath(); g.ellipse(x, y + 1, s * (z.k.crawl ? 0.3 : 0.2), s * 0.03, 0, 0, Math.PI * 2); g.fill();
      shambler(g, x, y, s, t * 2.2 * z.speed + z.ph, z.dir, z.k, `rgb(${shade},${Math.round(shade * 0.82)},${Math.round(shade * 0.72)})`, `rgba(${150 + litBy * 80},${80 + litBy * 90},${50 + litBy * 60},${(0.42 - z.depth * 0.15 + litBy * 0.3).toFixed(2)})`);
    }
    g.drawImage(fore.c, 0, streetY + H * 0.05, W, fore.h);
    drawStrip(g, fogFront, -t * 12, H * 0.82, W, H * 0.22);
    // Embers and ash.
    g.globalCompositeOperation = "lighter";
    for (const p of embers) {
      const a = Math.min(1, p.age * 2) * (1 - p.age / p.life) * (0.6 + 0.4 * Math.sin(p.age * 20 + p.k));
      g.globalAlpha = Math.max(0, a);
      g.drawImage(ember, p.x - 3, p.y - 3, 6, 6);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.fillStyle = "rgba(150,140,135,0.35)";
    for (const a of ash) g.fillRect(a.x, a.y, a.s, a.s);
  }
  return { resize, frame };
}

// ---------- background: a campfire at night ----------
function campScene() {
  let W = 0, H = 0, res = 1, sky, trees, ground, fog, fx = 0, fy = 0, horizon = 0, groundY = 0;
  const flames = [], sparks = [], smoke = [], eyes = [], flies = [];
  let edge = [], clouds = [];
  const flameY = puff("255,226,150", 0.15), flameO = puff("255,140,40", 0.1), flameR = puff("200,50,20"), glowP = puff("255,130,50"), smokeP = puff("60,58,64"), moonGlow = puff("170,190,220");
  const cloud = puff("22,27,40"), cloudLit = puff("70,80,100");
  // How much the fire lights a spot: 1 at the fire, 0 beyond its reach (the ground is a flat plane, so distance across
  // the screen is distance on the ground, foreshortened top to bottom).
  const lightAt = (x, y) => { const d = Math.hypot(x - fx, (y - fy) * 2.2); return Math.max(0, 1 - d / (H * 0.62)) ** 1.6; };
  const mix = (a, b, f) => `rgb(${Math.round(lerp(a[0], b[0], f))},${Math.round(lerp(a[1], b[1], f))},${Math.round(lerp(a[2], b[2], f))})`;
  const DARK = [8, 9, 13], WARM = [118, 74, 38], GRASS_D = [10, 14, 12], GRASS_L = [96, 86, 36];

  // The clearing: trodden dirt around the fire, grass beyond, stones, roots; the camp's things on it (the log and
  // the crate the people sit on, a tent, a pickup, packs, a pot on a tripod over the fire), all lit from the fire.
  function groundLayer() {
    const L = layer(W, H - groundY, res), R = rng(606), g = L.g;
    g.translate(0, -groundY);
    const gr = g.createLinearGradient(0, groundY, 0, H);
    gr.addColorStop(0, "#07080c"); gr.addColorStop(1, "#0b0a0a");
    g.fillStyle = gr;
    g.fillRect(0, groundY, W, H - groundY);
    // The firelight on the ground, warm, fading with distance.
    const lit = g.createRadialGradient(fx, fy, 0, fx, fy, H * 0.62);
    lit.addColorStop(0, "rgba(140,88,44,0.95)"); lit.addColorStop(0.25, "rgba(110,66,34,0.7)"); lit.addColorStop(0.6, "rgba(50,32,20,0.3)"); lit.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = lit;
    g.save(); g.translate(fx, fy); g.scale(1, 1 / 2.2); g.beginPath(); g.arc(0, 0, H * 0.62, 0, Math.PI * 2); g.fill(); g.restore();
    // Trodden dirt by the fire, darker patches where the grass has gone.
    g.fillStyle = "rgba(60,40,26,0.35)";
    for (let i = 0; i < 16; i++) { const a = R() * Math.PI * 2, d = R() * H * 0.16; g.beginPath(); g.ellipse(fx + Math.cos(a) * d, fy + Math.sin(a) * d * 0.4, H * (0.02 + R() * 0.04), H * (0.008 + R() * 0.014), 0, 0, Math.PI * 2); g.fill(); }
    // Grass: tufts everywhere, each lit by how close it is to the fire; thicker further out.
    g.lineCap = "round";
    for (let i = 0; i < 2600; i++) {
      const x = R() * W, y = groundY + Math.pow(R(), 0.8) * (H - groundY), f = (y - groundY) / (H - groundY);
      const near = Math.hypot(x - fx, (y - fy) * 2.2) < H * 0.14;
      if (near && R() < 0.75) continue;
      const l = lightAt(x, y);
      g.strokeStyle = mix(GRASS_D, GRASS_L, l);
      g.lineWidth = 0.8 + f * 1.4;
      const h = (3 + R() * 7) * (0.5 + f), lean = (R() - 0.5) * 6;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + lean * 0.4, y - h * 0.6, x + lean, y - h); g.stroke();
      if (R() < 0.5) { g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x - lean * 0.3, y - h * 0.5, x - lean * 0.8, y - h * 0.8); g.stroke(); }
    }
    // Stones and roots.
    for (let i = 0; i < 40; i++) {
      const x = R() * W, y = groundY + R() * (H - groundY), f = (y - groundY) / (H - groundY), l = lightAt(x, y);
      const s = H * (0.004 + R() * 0.008) * (0.5 + f);
      g.fillStyle = mix([12, 12, 14], [120, 96, 70], l);
      g.beginPath(); g.ellipse(x, y, s * 1.6, s, (R() - 0.5) * 0.6, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(0,0,0,0.5)";
      g.beginPath(); g.ellipse(x + s * 0.2, y + s * 0.5, s * 1.5, s * 0.5, 0, 0, Math.PI * 2); g.fill();
    }
    // A thing's shadow on the ground, cast away from the fire.
    const shadow = (x, y, w, len) => {
      const dir = Math.sign(x - fx) || 1;
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.beginPath(); g.ellipse(x + dir * len * 0.55, y, len * 0.7 + w * 0.3, w * 0.22, 0, 0, Math.PI * 2); g.fill();
    };
    // A fallen log to the left of the fire (two sit on it) and a crate to the right (one sits on that).
    const lx = fx - H * 0.155, ly = fy + H * 0.012, lw = H * 0.19, lh = H * 0.052;
    shadow(lx, ly + lh * 0.2, lw, H * 0.05);
    let lg = g.createLinearGradient(lx, ly - lh, lx, ly);
    lg.addColorStop(0, "#5a3d26"); lg.addColorStop(0.5, "#3a2617"); lg.addColorStop(1, "#160e09");
    g.fillStyle = lg;
    g.beginPath(); g.roundRect(lx - lw / 2, ly - lh, lw, lh, lh / 2); g.fill();
    g.fillStyle = "#6a4a2e";
    g.beginPath(); g.ellipse(lx + lw / 2, ly - lh / 2, lh * 0.3, lh / 2, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#3a2516";
    g.beginPath(); g.ellipse(lx + lw / 2, ly - lh / 2, lh * 0.18, lh * 0.3, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 1;
    for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(lx - lw / 2 + 6 + R() * (lw - 12), ly - lh + 2); g.lineTo(lx - lw / 2 + 6 + R() * (lw - 12), ly - 2); g.stroke(); }
    const cx = fx + H * 0.13, cy = fy + H * 0.012, cs = H * 0.045;
    shadow(cx, cy + 2, cs, H * 0.04);
    g.fillStyle = "#4a3520";
    g.fillRect(cx - cs / 2, cy - cs * 1.5, cs, cs * 1.5);
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(cx - cs / 2, cy - cs * 1.5, cs * 0.5, cs * 1.5);
    g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 1.5;
    g.strokeRect(cx - cs / 2 + 2, cy - cs * 1.5 + 2, cs - 4, cs * 0.75 - 4);
    g.strokeRect(cx - cs / 2 + 2, cy - cs * 0.75 + 2, cs - 4, cs * 0.75 - 4);
    // A tent at the left edge of the light, its door side lit; a sleeping bag rolled by it.
    const tx = fx - H * 0.46, ty = fy + H * 0.02, tw = H * 0.26, th = H * 0.15;
    shadow(tx, ty, tw, H * 0.08);
    g.fillStyle = "#17120f";
    g.beginPath(); g.moveTo(tx - tw / 2, ty); g.lineTo(tx - tw * 0.1, ty - th); g.lineTo(tx + tw * 0.55, ty); g.closePath(); g.fill();
    lg = g.createLinearGradient(tx - tw * 0.1, 0, tx + tw * 0.55, 0);
    lg.addColorStop(0, "#3d2c1c"); lg.addColorStop(1, "#6b4a2a");
    g.fillStyle = lg;
    g.beginPath(); g.moveTo(tx - tw * 0.1, ty - th); g.lineTo(tx + tw * 0.55, ty); g.lineTo(tx + tw * 0.12, ty); g.closePath(); g.fill();
    g.fillStyle = "#0a0806";
    g.beginPath(); g.moveTo(tx + tw * 0.2, ty); g.lineTo(tx + tw * 0.05, ty - th * 0.55); g.lineTo(tx + tw * 0.38, ty); g.closePath(); g.fill();
    g.strokeStyle = "#8a6a44"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(tx - tw * 0.1, ty - th); g.lineTo(tx - tw * 0.2, ty + H * 0.01); g.moveTo(tx + tw * 0.55, ty); g.lineTo(tx + tw * 0.62, ty + H * 0.012); g.stroke();
    g.fillStyle = "#2c2318";
    g.beginPath(); g.roundRect(tx + tw * 0.62, ty - H * 0.02, H * 0.07, H * 0.022, H * 0.011); g.fill();
    // A pickup at the right edge, nose to the fire, only its lit side showing.
    const px = fx + H * 0.46, py = fy + H * 0.012, pw = H * 0.75, ph = H * 0.2;
    shadow(px, py, pw, H * 0.1);
    lg = g.createLinearGradient(px - pw / 2, 0, px + pw / 2, 0);
    lg.addColorStop(0, "#4a3a2c"); lg.addColorStop(1, "#15110e");
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(px - pw / 2, py); g.lineTo(px - pw / 2, py - ph * 0.55); g.lineTo(px - pw * 0.3, py - ph * 0.6); g.lineTo(px - pw * 0.2, py - ph); g.lineTo(px + pw * 0.12, py - ph); g.lineTo(px + pw * 0.15, py - ph * 0.6); g.lineTo(px + pw / 2, py - ph * 0.58); g.lineTo(px + pw / 2, py); g.closePath(); g.fill();
    g.fillStyle = "rgba(255,200,140,0.12)";
    g.beginPath(); g.moveTo(px - pw * 0.27, py - ph * 0.62); g.lineTo(px - pw * 0.18, py - ph * 0.95); g.lineTo(px + pw * 0.1, py - ph * 0.95); g.lineTo(px + pw * 0.12, py - ph * 0.62); g.closePath(); g.fill();
    g.fillStyle = "#0a0908";
    for (const wx of [px - pw * 0.32, px + pw * 0.32]) { g.beginPath(); g.arc(wx, py, ph * 0.22, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = "#2a241e";
    for (const wx of [px - pw * 0.32, px + pw * 0.32]) { g.beginPath(); g.arc(wx, py, ph * 0.09, 0, Math.PI * 2); g.fill(); }
    // Packs and a jerrycan by the log; firewood stacked.
    g.fillStyle = "#3a2e22";
    g.beginPath(); g.roundRect(lx - lw * 0.75, ly - H * 0.04, H * 0.035, H * 0.045, 4); g.fill();
    g.fillStyle = "#2a3a22";
    g.beginPath(); g.roundRect(lx - lw * 0.62, ly - H * 0.03, H * 0.028, H * 0.035, 3); g.fill();
    g.fillStyle = "#3b2a18";
    for (let i = 0; i < 5; i++) { g.beginPath(); g.roundRect(cx + cs * 0.8 + (i % 3) * H * 0.013, cy - H * 0.012 - Math.floor(i / 3) * H * 0.012, H * 0.012, H * 0.011, 3); g.fill(); }
    // The fire's ring of stones and the tripod with a pot over it (the flames are drawn each frame).
    for (let i = 0; i < 11; i++) { const a = (i / 11) * Math.PI * 2, sx = fx + Math.cos(a) * H * 0.07, sy = fy + Math.sin(a) * H * 0.016 + H * 0.004; g.fillStyle = mix([30, 24, 20], [150, 110, 70], Math.sin(a) > 0 ? 0.6 : 0.25); g.beginPath(); g.ellipse(sx, sy, H * 0.013, H * 0.0075, 0, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = "#1a1410"; g.lineWidth = Math.max(2, H * 0.004); g.lineCap = "round";
    g.beginPath(); g.moveTo(fx - H * 0.06, fy); g.lineTo(fx, fy - H * 0.13); g.lineTo(fx + H * 0.06, fy); g.moveTo(fx, fy - H * 0.13); g.lineTo(fx + H * 0.015, fy - H * 0.005); g.stroke();
    g.lineWidth = 1.5; g.strokeStyle = "#2a2420";
    g.beginPath(); g.moveTo(fx, fy - H * 0.13); g.lineTo(fx, fy - H * 0.085); g.stroke();
    g.fillStyle = "#26201c";
    g.beginPath(); g.roundRect(fx - H * 0.022, fy - H * 0.085, H * 0.044, H * 0.03, 4); g.fill();
    g.fillStyle = "#3a3028";
    g.fillRect(fx - H * 0.024, fy - H * 0.088, H * 0.048, H * 0.006);
    return L;
  }

  function resize(w, h, r) {
    W = w; H = h; res = r;
    horizon = H * 0.6;
    groundY = horizon + H * 0.075;
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
    // A pine: dark, with the side facing the fire picking up its light when it stands near enough.
    const pine = (x, base, h, c) => {
      const l = lightAt(x, base) * 0.8;
      tg.fillStyle = c;
      const outline = (side) => {
        tg.beginPath(); tg.moveTo(x, base - h);
        const tiers = 5;
        for (let i = 1; i <= tiers; i++) { const y = base - h + (h * i) / tiers, w = h * 0.07 + (h * 0.2 * i) / tiers; tg.lineTo(x + w, y); tg.lineTo(x + w * 0.45, y - h * 0.04); }
        for (let i = tiers; i >= 1; i--) { const y = base - h + (h * i) / tiers, w = h * 0.07 + (h * 0.2 * i) / tiers; tg.lineTo(x - w * 0.45, y - h * 0.04); tg.lineTo(x - w, y); }
        tg.closePath();
      };
      outline();
      tg.fill();
      tg.fillRect(x - h * 0.012, base - h * 0.05, h * 0.024, h * 0.08);
      if (l > 0.05) { // the lit side: the same shape, clipped to the half facing the fire, in a warm tone
        tg.save(); outline(); tg.clip();
        const dir = Math.sign(fx - x) || 1;
        const lg = tg.createLinearGradient(x, 0, x + dir * h * 0.25, 0);
        lg.addColorStop(0, `rgba(120,70,30,0)`); lg.addColorStop(1, `rgba(120,70,30,${(l * 0.6).toFixed(2)})`);
        tg.fillStyle = lg;
        tg.fillRect(x - h * 0.3, base - h, h * 0.6, h);
        tg.restore();
      }
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
    ground = groundLayer();
    fog = fogStrip(W, H * 0.16, "90,105,135", 31, res, 1);
    clouds = Array.from({ length: 9 }, (_, i) => ({ x: R() * (W + 600) - 300, y: H * (0.05 + R() * 0.25), r: H * (0.08 + R() * 0.1), v: 3 + R() * 5, k: i }));
    edge = walkers(5, 55, {}).map((z) => ({ ...z, k: { ...z.k, crawl: false } }));
    flies.length = 0;
    for (let i = 0; i < 14; i++) flies.push({ x: R() * W, y: groundY + R() * (H - groundY) * 0.7, k: R() * 9, on: R() * 4 });
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
    // Eyes at the edge of the light, a pair at a time, low in the grass or up in the trees.
    if (eyes.length < 3 && Math.random() < dt * 0.35) {
      const side = Math.random() < 0.5 ? -1 : 1;
      eyes.push({ x: fx + side * W * (0.2 + Math.random() * 0.28), y: horizon + H * (0.03 + Math.random() * 0.12), life: 4 + Math.random() * 6, age: 0, sep: H * (0.006 + Math.random() * 0.004), k: Math.random() * 9, red: Math.random() < 0.4 });
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
    for (const f of flies) { f.x += Math.sin(t * 0.9 + f.k) * 12 * dt; f.y += Math.cos(t * 1.3 + f.k * 2) * 8 * dt; }
  }

  // A survivor by the fire: a dark shape lit on the side that faces it, feet (or seat) on the ground at (x, y).
  function person(g, x, y, s, pose, t, k, flick) {
    const toFire = Math.sign(fx - x) || 1;
    g.save();
    g.translate(x, y);
    g.scale(s / 100, s / 100);
    const gr = g.createLinearGradient(-40 * toFire, 0, 40 * toFire, 0);
    gr.addColorStop(0, "#030304");
    gr.addColorStop(0.55, "#0c0807");
    gr.addColorStop(1, `rgb(${Math.round(105 * flick)},${Math.round(50 * flick)},${Math.round(22 * flick)})`);
    g.fillStyle = g.strokeStyle = gr;
    g.lineCap = g.lineJoin = "round";
    const breathe = Math.sin(t * 1.3 + k) * 0.8;
    if (pose === "sit") { // on the log, hunched towards the fire, hands held out to it
      g.lineWidth = 12;
      g.beginPath(); g.moveTo(-6 * toFire, -30); g.lineTo(14 * toFire, -33); g.lineTo(17 * toFire, -2); g.stroke();
      g.lineWidth = 6;
      g.beginPath(); g.moveTo(17 * toFire, -2); g.lineTo(26 * toFire, 0); g.stroke();
      g.lineWidth = 20;
      g.beginPath(); g.moveTo(-8 * toFire, -32); g.quadraticCurveTo(-10 * toFire, -55, 2 * toFire, -66 + breathe); g.stroke();
      g.beginPath(); g.arc(10 * toFire, -76 + breathe, 9.5, 0, Math.PI * 2); g.fill();
      g.lineWidth = 7;
      g.beginPath(); g.moveTo(4 * toFire, -60 + breathe); g.lineTo(22 * toFire, -46); g.lineTo(34 * toFire, -48 + Math.sin(t * 0.5 + k) * 2); g.stroke();
    } else if (pose === "crate") { // sitting upright on the crate, a cup in hand
      g.lineWidth = 12;
      g.beginPath(); g.moveTo(0, -34); g.lineTo(18 * toFire, -32); g.lineTo(20 * toFire, -2); g.stroke();
      g.lineWidth = 6;
      g.beginPath(); g.moveTo(20 * toFire, -2); g.lineTo(29 * toFire, 0); g.stroke();
      g.lineWidth = 19;
      g.beginPath(); g.moveTo(0, -36); g.lineTo(2 * toFire, -72 + breathe); g.stroke();
      g.beginPath(); g.arc(5 * toFire, -86 + breathe, 9.5, 0, Math.PI * 2); g.fill();
      g.lineWidth = 7;
      const lift = Math.max(0, Math.sin(t * 0.35 + k)) ** 8;
      g.beginPath(); g.moveTo(4 * toFire, -66 + breathe); g.lineTo(14 * toFire, -50 - lift * 14); g.lineTo(20 * toFire, -62 - lift * 14); g.stroke();
      g.beginPath(); g.arc(21 * toFire, -64 - lift * 14, 3.5, 0, Math.PI * 2); g.fill();
    } else { // the guard: standing, rifle over the shoulder, looking out into the dark and back
      const look = Math.sin(t * 0.22 + k) > 0.2 ? -toFire : toFire;
      g.lineWidth = 11;
      g.beginPath(); g.moveTo(-7, 0); g.lineTo(-3, -52); g.lineTo(3, -52); g.lineTo(8, 0); g.stroke();
      g.lineWidth = 5;
      g.beginPath(); g.moveTo(-7, 0); g.lineTo(-14, 0); g.moveTo(8, 0); g.lineTo(15, 0); g.stroke();
      g.lineWidth = 20;
      g.beginPath(); g.moveTo(0, -52); g.lineTo(0, -98 + breathe); g.stroke();
      g.beginPath(); g.arc(3 * look, -110 + breathe, 9.5, 0, Math.PI * 2); g.fill();
      g.lineWidth = 4;
      g.beginPath(); g.moveTo(-12 * toFire, -52); g.lineTo(14 * toFire, -128); g.stroke();
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
    // Moonlit fog in the trees, the treeline, then the ground with the camp on it.
    drawStrip(g, fog, t * 5, horizon - H * 0.07, W, H * 0.16);
    g.drawImage(trees.c, 0, H * 0.4, W, trees.h);
    g.drawImage(ground.c, 0, groundY, W, ground.h);
    // A low mist along the far edge of the clearing.
    g.globalAlpha = 0.6;
    drawStrip(g, fog, -t * 8 + W * 0.5, groundY - H * 0.06, W, H * 0.1);
    g.globalAlpha = 1;
    // The dead at the far edge of the clearing, moving along the treeline on the ground, lit faintly by the fire.
    for (const z of edge) {
      const s = H * (0.05 + z.depth * 0.025), span = W + s * 2;
      const gait = z.k.idle ? 0 : z.speed * s * 0.12;
      z.pos = (z.pos ?? z.x * span) + gait * dt * z.dir;
      const x = ((z.pos % span) + span) % span - s;
      const y = groundY + H * 0.012 + z.depth * H * 0.03;
      const l = lightAt(x, y) * flick;
      g.fillStyle = `rgba(0,0,0,${(0.3 + l * 0.4).toFixed(2)})`;
      g.beginPath(); g.ellipse(x, y + 1, s * 0.2, s * 0.03, 0, 0, Math.PI * 2); g.fill();
      shambler(g, x, y, s, t * 2 * z.speed + z.ph, z.dir, z.k, `rgb(${Math.round(9 + l * 60)},${Math.round(11 + l * 30)},${Math.round(16 + l * 12)})`, l > 0.04 ? `rgba(200,120,60,${(l * 0.7).toFixed(2)})` : null);
    }
    // Eyes catching the firelight; fireflies in the grass.
    g.globalCompositeOperation = "lighter";
    for (const e of eyes) {
      const a = Math.min(1, e.age / 1.2, (e.life - e.age) / 1.2);
      const blink = (e.age * 1.7 + e.k) % 4 < 0.15 ? 0 : 1;
      g.globalAlpha = Math.max(0, a * blink * 0.9);
      g.fillStyle = e.red ? "rgb(255,90,40)" : "rgb(230,220,120)";
      for (const dx of [-e.sep, e.sep]) { g.beginPath(); g.arc(e.x + dx, e.y, H * 0.0022, 0, Math.PI * 2); g.fill(); }
    }
    g.fillStyle = "rgb(190,230,90)";
    for (const f of flies) {
      const on = Math.max(0, Math.sin(t * 1.1 + f.on * 2)) ** 6;
      if (on < 0.05 || lightAt(f.x, f.y) > 0.5) continue;
      g.globalAlpha = on * 0.8;
      g.fillRect(f.x, f.y - 6, 1.6, 1.6);
    }
    // The firelight's flicker on everything around it (the steady part is painted into the ground).
    const r = H * 0.55;
    g.globalAlpha = 0.22 * flick;
    g.drawImage(glowP, fx - r * 1.4, fy - r * 0.75, r * 2.8, r * 1.2);
    g.globalAlpha = 0.18 * flick;
    g.drawImage(glowP, fx - r * 0.7, fy - r * 0.9, r * 1.4, r * 1.4);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    // The people: long shadows away from the fire, then the figures, each on its seat or its feet.
    const people = [[-0.2, "sit", 1.0], [-0.11, "sit", 0.95], [0.13, "crate", 1.0], [0.27, "guard", 1.05]];
    g.fillStyle = "rgba(0,0,0,0.5)";
    for (const [dx, pose, sc] of people) {
      const x = fx + dx * H, len = H * 0.18 * sc * (pose === "guard" ? 1.3 : 0.9);
      g.beginPath(); g.ellipse(x + Math.sign(dx) * len * 0.6, fy + H * 0.012, len * 0.7, H * 0.012, 0, 0, Math.PI * 2); g.fill();
    }
    people.forEach(([dx, pose, sc], i) => person(g, fx + dx * H, fy + H * 0.012, H * 0.2 * sc, pose, t, i * 2.3, flick));
    // The fire itself: embers under the flames, the flames, the sparks and a little smoke.
    g.fillStyle = `rgba(255,${Math.round(120 * flick)},30,0.9)`;
    g.beginPath(); g.ellipse(fx, fy - H * 0.004, H * 0.035, H * 0.008, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#1a0c06";
    g.lineWidth = H * 0.012;
    g.lineCap = "round";
    g.beginPath(); g.moveTo(fx - H * 0.05, fy + H * 0.005); g.lineTo(fx + H * 0.04, fy - H * 0.012); g.moveTo(fx + H * 0.05, fy + H * 0.006); g.lineTo(fx - H * 0.035, fy - H * 0.014); g.stroke();
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
