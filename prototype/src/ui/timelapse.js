// Timelapse viewer: plays the chronicle (sim/chronicle.js) back over the whole map with the fog of war off: land
// growing and shrinking, infection spreading, hordes and teams moving, bases rising and falling, your people over
// time and captions for what happened. Opened from the game-over screen ("Watch the timelapse") or the dev panel
// ("Timelapse so far"); the sim is paused while it is open (main.js blocked()). Every frame builds a state-like
// object from the recording and hands it to the normal map renderer, so it looks like the game. Close returns to
// the game-over screen, or to the game when it was opened from the dev panel.
import { render, resize, camera, view, HEX } from "./render.js";
import { chronicleReader, finishChronicle, INF_Q } from "../sim/chronicle.js";
import { drawMapSprite, markerSpriteCanvas } from "./mapsprites.js";
import { seasonOfDay } from "../sim/weather.js";

export const TL_SPEEDS = [1, 2, 5, 10]; // in-game days per second
const PLAYER_COLOR = "#4f8fd6";
const KIND_COLOR = { death: "#ff4d4d", danger: "#e2685f", good: "#6cc48a", info: "#8fb4e0", world: "#c9b98a" };
const LAYER_KEYS = ["pois", "territory", "teams", "hordes", "infection", "weather"];
const CHART_W = 300, CHART_H = 54;
const HOT = Math.ceil(0.6 * INF_Q); // hotzone tiles (same 0.6 line as the dev panel)
const CAPTIONS = 7;                 // captions shown at once

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const dayOf = (h) => Math.floor(h / 24) + 1;
const clockOf = (h) => `Day ${dayOf(h)} · ${String(Math.floor(h) % 24).padStart(2, "0")}:00 · ${seasonOfDay(dayOf(h) - 1).icon} ${seasonOfDay(dayOf(h) - 1).name}`; // with the season (weather.js)
const kindColor = (e) => e.color || KIND_COLOR[e.kind] || KIND_COLOR.info;

let active = null; // the open session, for the scrubber's DOM listeners

// A playback session (no DOM, so tools can build one): the reader, the time shown (in-game hours), play state.
export function tlSession(state, from) {
  if (!finishChronicle(state)) return null;
  const reader = chronicleReader(state);
  const days = (reader.h1 - reader.h0) / 24;
  return {
    from, reader, grid: state.grid, series: reader.series(), t: reader.h0, playing: days > 0,
    speed: days <= 30 ? 1 : days <= 80 ? 2 : days <= 200 ? 5 : 10, // about 30 seconds for the whole game
    metric: "land", last: 0, shownK: -1, shownHour: -1, dragging: false, dirty: true, saved: null,
  };
}

export function openTimelapse(state, ui, from) {
  const s = tlSession(state, from);
  if (!s) return;
  s.saved = { cam: { ...camera }, layers: view.layers, selected: view.selected, preview: view.preview };
  view.layers = new Set(LAYER_KEYS);
  view.selected = -1;
  view.hover = -1;
  view.preview = null;
  ui.timelapse = active = s;
  document.body.classList.add("tl-on"); // CSS hides the side panels and the log; the map fills the window
  resize();
  const el = overlay();
  el.innerHTML = shellHTML(s);
  el.classList.remove("hidden");
  fit(s);
}

export function closeTimelapse(state, ui) {
  const s = ui.timelapse;
  if (!s) return;
  Object.assign(camera, s.saved.cam);
  view.layers = s.saved.layers;
  view.selected = s.saved.selected;
  view.preview = s.saved.preview;
  ui.timelapse = active = null;
  document.body.classList.remove("tl-on");
  const el = document.getElementById("timelapse");
  if (el) { el.classList.add("hidden"); el.innerHTML = ""; }
  resize();
}

// Called by main.js every animation frame while the timelapse is open (instead of render(state)).
export function tlFrame(state, ui, now) {
  const s = ui.timelapse;
  const dt = s.last ? Math.min(0.25, (now - s.last) / 1000) : 0;
  s.last = now;
  if (s.playing && !s.dragging) {
    s.t += dt * s.speed * 24;
    if (s.t >= s.reader.h1) { s.t = s.reader.h1; s.playing = false; s.dirty = true; }
  }
  const fs = s.reader.frameState(s.t);
  render(fs);
  drawExtras(s, fs);
  updateOverlay(s, fs);
}

// ---------- actions (data-action buttons, wired in main.js) and keys ----------
export const TL_ACTIONS = {
  "tl-open": (state, ui, d) => openTimelapse(state, ui, d.from || "dev"),
  "tl-close": (state, ui) => closeTimelapse(state, ui),
  "tl-play": (state, ui) => {
    const s = ui.timelapse;
    if (!s.playing && s.t >= s.reader.h1) s.t = s.reader.h0; // play again from the start
    s.playing = !s.playing;
    s.dirty = true;
  },
  "tl-step": (state, ui, d) => step(ui.timelapse, Number(d.dir)),
  "tl-jump": (state, ui, d) => seek(ui.timelapse, d.to === "end" ? ui.timelapse.reader.h1 : ui.timelapse.reader.h0),
  "tl-seek": (state, ui, d) => seek(ui.timelapse, Number(d.h)),
  "tl-speed": (state, ui, d) => { ui.timelapse.speed = Number(d.v); ui.timelapse.dirty = true; },
  "tl-layer": (state, ui, d) => { view.layers.has(d.k) ? view.layers.delete(d.k) : view.layers.add(d.k); ui.timelapse.dirty = true; },
  "tl-metric": (state, ui, d) => {
    const s = ui.timelapse;
    s.metric = d.m;
    const box = document.getElementById("tl-groupchart"), btns = document.getElementById("tl-metrics");
    if (box) box.innerHTML = groupChartSVG(s);
    if (btns) btns.innerHTML = metricButtons(s);
    s.dirty = true;
    s.shownHour = -1; // the new chart's cursor
  },
  "tl-fit": (state, ui) => fit(ui.timelapse),
  "tl-goto": (state, ui, d) => {
    const id = Number(d.tile);
    if (id < 0) return;
    const [px, py] = ui.timelapse.grid.toPixel(id, HEX);
    const r = document.getElementById("map").getBoundingClientRect();
    camera.zoom = Math.max(camera.zoom, 0.9);
    camera.x = px - r.width / (2 * camera.zoom);
    camera.y = py - r.height / (2 * camera.zoom);
  },
};

// Keyboard while the timelapse is open. Returns true when the key was used.
export function tlKey(state, ui, e) {
  const s = ui.timelapse, pan = 40 / camera.zoom;
  const speedKey = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
  if (e.code === "Space") TL_ACTIONS["tl-play"](state, ui);
  else if (e.code === "ArrowLeft") step(s, -1);
  else if (e.code === "ArrowRight") step(s, 1);
  else if (e.code === "Home") seek(s, s.reader.h0);
  else if (e.code === "End") seek(s, s.reader.h1);
  else if (speedKey >= 0) { s.speed = TL_SPEEDS[speedKey]; s.dirty = true; }
  else if (e.code === "KeyF") fit(s);
  else if (e.code === "KeyI") TL_ACTIONS["tl-layer"](state, ui, { k: "infection" });
  else if (e.code === "KeyT") TL_ACTIONS["tl-layer"](state, ui, { k: "territory" });
  else if (e.code === "Escape") closeTimelapse(state, ui);
  else if (e.code === "KeyW" || e.code === "ArrowUp") camera.y -= pan;
  else if (e.code === "KeyS" || e.code === "ArrowDown") camera.y += pan;
  else if (e.code === "KeyA") camera.x -= pan;
  else if (e.code === "KeyD") camera.x += pan;
  else return false;
  return true;
}

function seek(s, h) {
  s.t = Math.max(s.reader.h0, Math.min(s.reader.h1, h));
  s.dirty = true;
}
// One day back or forward, landing on midnight (the daily frames).
function step(s, dir) {
  s.playing = false;
  const d = Math.floor(s.t / 24);
  seek(s, dir > 0 ? (d + 1) * 24 : s.t > d * 24 ? d * 24 : (d - 1) * 24);
}

// Zooms out to the whole state, leaving room for the info panel on the left and the controls at the bottom.
function fit(s) {
  const cv = document.getElementById("map");
  if (!cv) return;
  const r = cv.getBoundingClientRect(), g = s.grid;
  const info = document.querySelector("#timelapse .tl-info"), bar = document.querySelector("#timelapse .tl-bar");
  const left = info && r.width > 900 ? info.offsetLeft + info.offsetWidth + 8 : 0;
  const bottom = bar ? bar.offsetHeight + 18 : 0;
  const w = HEX * Math.sqrt(3) * (g.width + 0.5), h = HEX * (1.5 * (g.height - 1) + 2);
  const aw = Math.max(200, r.width - left - 8), ah = Math.max(150, r.height - bottom - 8);
  camera.zoom = Math.max(0.08, Math.min(2.6, Math.min(aw / w, ah / h)));
  // Tile (0,0) is centered on the origin, so the map starts half a hex left of and one hex above it.
  camera.x = -HEX * Math.sqrt(3) / 2 + w / 2 - (left + aw / 2) / camera.zoom;
  camera.y = -HEX + h / 2 - (4 + ah / 2) / camera.zoom;
}

// ---------- map extras: event pings and the graves of a fallen holdout ----------
function lastEventAt(s, t) {
  const ev = s.reader.events;
  let lo = -1, hi = ev.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ev[mid].h <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function drawExtras(s, fs) {
  const cv = document.getElementById("map");
  const ctx = cv.getContext("2d"), dpr = window.devicePixelRatio || 1, z = camera.zoom;
  ctx.setTransform(dpr * z, 0, 0, dpr * z, -camera.x * dpr * z, -camera.y * dpr * z);
  const g = fs.grid, boost = Math.max(1, Math.sqrt(0.9 / z));
  // A ring spreads from where each event happened; it lasts at least ~0.6 s of real time at any speed.
  const life = Math.max(30, s.speed * 15);
  for (let i = lastEventAt(s, s.t); i >= 0; i--) {
    const e = s.reader.events[i], age = (s.t - e.h) / life;
    if (age > 1) break;
    if (e.tile < 0) continue;
    const [px, py] = g.toPixel(e.tile, HEX);
    ctx.globalAlpha = Math.max(0, 1 - age);
    ctx.beginPath();
    ctx.arc(px, py, HEX * (0.8 + age * 2.4) * boost, 0, Math.PI * 2);
    ctx.strokeStyle = kindColor(e);
    ctx.lineWidth = 3 * boost;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const tile of fs.fallen) {
    const [px, py] = g.toPixel(tile, HEX);
    ctx.beginPath();
    ctx.ellipse(px, py + 9 * boost, 18 * boost, 6 * boost, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fill();
    ctx.strokeStyle = "#ff4d4d";
    ctx.lineWidth = 2;
    ctx.stroke();
    drawMapSprite(ctx, markerSpriteCanvas("death"), px, py - 2 * boost, 22 * boost);
  }
}

// ---------- overlay ----------
function overlay() {
  let el = document.getElementById("timelapse");
  if (el) return el;
  el = document.createElement("div");
  el.id = "timelapse";
  el.className = "hidden";
  document.getElementById("mapwrap").appendChild(el);
  // The scrubber: dragging seeks live (and holds playback until it is let go).
  el.addEventListener("input", (e) => { if (active && e.target.id === "tl-scrub") { active.t = Number(e.target.value); active.dirty = true; } });
  el.addEventListener("pointerdown", (e) => { if (active && e.target.id === "tl-scrub") active.dragging = true; });
  window.addEventListener("pointerup", () => {
    if (!active || !active.dragging) return;
    active.dragging = false;
    const sc = document.getElementById("tl-scrub");
    if (sc) sc.blur(); // keys go back to the timelapse (Space, arrows)
  });
  return el;
}

// Static parts, built once when the viewer opens; updateOverlay fills in the rest as time moves.
export function shellHTML(s) {
  const r = s.reader, span = Math.max(1, r.h1 - r.h0);
  const pct = (h) => (((h - r.h0) / span) * 100).toFixed(2);
  const ticks = r.events.filter((e) => e.major).map((e) => `<i data-action="tl-seek" data-h="${e.h}" style="left:${pct(e.h)}%;background:${kindColor(e)}"${tip(`${clockOf(e.h)}: ${e.text}`)}></i>`).join("");
  const labels = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span style="left:${(f * 100).toFixed(0)}%">Day ${dayOf(r.h0 + span * f)}</span>`).join("");
  return `
    <div class="tl-info">
      <div class="spread"><b class="tl-title">Timelapse</b><span class="tl-day" id="tl-day">${clockOf(s.t)}</span></div>
      <div class="muted small">${r.overAt != null ? "The whole game" : "So far"}, fog of war off · ${dayOf(r.h1) - dayOf(r.h0) + 1} days</div>
      <div class="tl-label"><span>Your people</span><span id="tl-people"></span></div>
      <div class="tl-chartbox">${popChartSVG(s)}</div>
      <div class="small" id="tl-stock"></div>
      <div class="tl-label"><span>Groups</span><span class="row" id="tl-metrics">${metricButtons(s)}</span></div>
      <div class="tl-chartbox" id="tl-groupchart">${groupChartSVG(s)}</div>
      <div id="tl-vals"></div>
      <div class="small muted" id="tl-world"></div>
    </div>
    <div class="tl-caps"><b>What happened</b><div id="tl-caps"></div></div>
    <div class="tl-bar">
      <div class="row" id="tl-ctl">${controlsHTML(s)}</div>
      <div class="tl-track"><div class="tl-ticks">${ticks}</div>
        <input type="range" id="tl-scrub" min="${r.h0}" max="${Math.max(r.h1, r.h0 + 1)}" step="1" value="${Math.round(s.t)}"${tip("Drag to scrub through the game")}>
        <div class="tl-days">${labels}</div></div>
    </div>`;
}

const metricButtons = (s) => ["land", "pop"].map((m) => `<button class="mini${s.metric === m ? " active" : ""}" data-action="tl-metric" data-m="${m}"${tip(m === "land" ? "Chart the land each group holds (tiles)" : "Chart each group's population")}>${m === "land" ? "Land" : "Pop"}</button>`).join("");

export function controlsHTML(s) {
  const b = (action, label, t, extra = "", cls = "") => `<button class="${cls}" data-action="${action}"${extra}${tip(t)}>${label}</button>`;
  return `
    ${b("tl-jump", "⏮", "Back to day 1 (Home)", ` data-to="start"`)}
    ${b("tl-step", "◀", "One day back (←)", ` data-dir="-1"`)}
    ${b("tl-play", s.playing ? "⏸ Pause" : "▶ Play", "Play / pause (Space)", "", "primary tl-playbtn")}
    ${b("tl-step", "▶", "One day forward (→)", ` data-dir="1"`)}
    ${b("tl-jump", "⏭", "To the end (End)", ` data-to="end"`)}
    <span class="muted small">Days / s</span>
    ${TL_SPEEDS.map((v, i) => b("tl-speed", v, `${v} in-game day${v > 1 ? "s" : ""} per second (${i + 1})`, ` data-v="${v}"`, s.speed === v ? "active" : "")).join("")}
    <span class="tl-sep"></span>
    ${b("tl-layer", "Infection", "Zombie infection overlay (I)", ` data-k="infection"`, view.layers.has("infection") ? "active" : "")}
    ${b("tl-layer", "Territory", "Land held by you and the groups (T)", ` data-k="territory"`, view.layers.has("territory") ? "active" : "")}
    ${b("tl-layer", "Weather", "Season and weather wash over the land (snow, rain, fog, heat)", ` data-k="weather"`, view.layers.has("weather") ? "active" : "")}
    ${b("tl-fit", "Fit", "Show the whole map (F). Drag to pan, wheel to zoom.")}
    ${b("tl-close", "Close ✕", s.from === "end" ? "Back to the game-over screen (Esc)" : "Back to the game (Esc)")}`;
}

// Chart x for an hour; series y scaled to the chart (top margin 4, bottom 3).
const chartX = (s, h) => ((h - s.reader.h0) / Math.max(1, s.reader.h1 - s.reader.h0)) * CHART_W;
const chartY = (v, max) => CHART_H - 3 - (v / Math.max(1, max)) * (CHART_H - 7);
const points = (s, values, max) => s.series.hours.map((h, i) => `${chartX(s, h).toFixed(1)},${chartY(values[i], max).toFixed(1)}`).join(" ");
const svg = (body, id, max) => `<svg class="tl-chart" viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none">${body}
  <line id="${id}" class="tl-cursor" x1="0" x2="0" y1="0" y2="${CHART_H}" vector-effect="non-scaling-stroke"/></svg><span class="tl-max">${max}</span>`;

export function popChartSVG(s) {
  const pop = s.series.pop, max = Math.max(1, ...pop);
  const line = points(s, pop, max);
  const area = `0,${CHART_H} ${line} ${CHART_W},${CHART_H}`;
  return svg(`<polygon points="${area}" fill="rgba(79,143,214,0.22)"/><polyline points="${line}" fill="none" stroke="${PLAYER_COLOR}" stroke-width="2" vector-effect="non-scaling-stroke"/>`, "tl-cur1", max);
}

export function groupChartSVG(s) {
  const key = s.metric, mine = key === "land" ? s.series.land : s.series.pop;
  const max = Math.max(1, ...mine, ...s.series.groups.flatMap((g) => g[key]));
  const lines = s.reader.factions.map((f, i) => `<polyline points="${points(s, s.series.groups[i][key], max)}" fill="none" stroke="${f.color}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`).join("");
  return svg(`${lines}<polyline points="${points(s, mine, max)}" fill="none" stroke="${PLAYER_COLOR}" stroke-width="2.4" vector-effect="non-scaling-stroke"/>`, "tl-cur2", max);
}

// Values at the frame shown: you first, then the groups by the charted metric.
export function valuesHTML(s, info) {
  const key = s.metric;
  const rows = [...info.groups].sort((a, b) => b.alive - a.alive || b[key] - a[key]).map((g) => `<tr class="${g.alive ? "" : "muted"}">
    <td><span class="dot" style="background:${g.color}"></span>${esc(g.name)}</td><td>${g.alive ? g.pop : "gone"}</td><td>${g.land}</td><td>${g.bases}</td></tr>`).join("");
  return `<table class="tl-table"><tr class="muted"><td>Group</td><td>Pop</td><td>Land</td><td>Bases</td></tr>
    <tr class="tl-you"><td><span class="dot" style="background:${PLAYER_COLOR}"></span>You</td><td>${info.fallen ? "fallen" : info.pop}</td><td>${info.fallen ? 0 : info.land}</td><td>${info.fallen ? 0 : info.bases}</td></tr>${rows}</table>`;
}

// The last few captions up to the time shown, newest first; older ones fade.
export function captionsHTML(s) {
  const ev = s.reader.events, out = [];
  for (let i = lastEventAt(s, s.t); i >= 0 && out.length < CAPTIONS; i--) {
    const e = ev[i], ageDays = (s.t - e.h) / 24;
    const op = ageDays <= 2 ? 1 : Math.max(0.4, 1 - (ageDays - 2) / 20);
    out.push(`<div class="tl-cap${e.tile >= 0 ? " link" : ""}" style="border-left-color:${kindColor(e)};opacity:${op.toFixed(2)}"${e.tile >= 0 ? ` data-action="tl-goto" data-tile="${e.tile}"${tip("Show where on the map")}` : ""}>
      <span class="muted">${clockOf(e.h)}</span> <span class="k-${e.kind === "world" ? "info" : e.kind}">${esc(e.text)}</span></div>`);
  }
  return out.join("") || `<div class="muted small">Nothing yet.</div>`;
}

function updateOverlay(s, fs) {
  const hour = Math.floor(s.t);
  const $ = (id) => document.getElementById(id);
  if (hour !== s.shownHour) {
    s.shownHour = hour;
    $("tl-day").textContent = clockOf(hour);
    const x = chartX(s, s.t).toFixed(1);
    for (const id of ["tl-cur1", "tl-cur2"]) { const l = $(id); if (l) { l.setAttribute("x1", x); l.setAttribute("x2", x); } }
    const sc = $("tl-scrub");
    if (sc && !s.dragging) sc.value = String(hour);
  }
  if (fs.frame !== s.shownK || s.dirty) {
    s.shownK = fs.frame;
    const info = fs.info;
    const inf = s.reader.decode(fs.frame).inf;
    let hot = 0;
    for (let i = 0; i < inf.length; i++) if (inf[i] >= HOT) hot++;
    $("tl-people").innerHTML = info.fallen ? `<span class="danger">fallen</span>` : `${info.pop} alive · ${info.bases} base${info.bases === 1 ? "" : "s"}`;
    $("tl-stock").innerHTML = info.fallen ? "" : `<span class="muted">Hub:</span> food ${info.stock.food} · water ${info.stock.water} · ammo ${info.stock.ammo} · meds ${info.stock.meds}`;
    $("tl-vals").innerHTML = valuesHTML(s, info);
    $("tl-world").textContent = `Hordes ${info.hordes} (${info.zombies} dead) · hives ${info.hives}${info.sites ? ` (+${info.sites} being built)` : ""} · hotzone tiles ${hot}`;
  }
  // Captions: when a new one comes up, and once a day for the fading (an event can fall between two frames).
  const capKey = `${lastEventAt(s, s.t)}:${Math.floor(s.t / 24)}`;
  if (capKey !== s.shownCaps || s.dirty) {
    s.shownCaps = capKey;
    $("tl-caps").innerHTML = captionsHTML(s);
  }
  if (s.dirty) {
    s.dirty = false;
    $("tl-ctl").innerHTML = controlsHTML(s);
  }
}
