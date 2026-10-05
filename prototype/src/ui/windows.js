// On the page: the bars between the map and its panels (fold, unfold, drag to resize), the grips and title drag of
// resizable windows, and the timelapse's floating boxes. The rules (what folds, sizes, clamping) are in
// ui/layout.js; main.js owns the layout object and redraws the map when the space for it changes (relayout).
import {
  PANEL_SIZE, setFolded, setPanelSize, saveLayout, loadWindows, saveWindows, dragRect, clampRect,
} from "./layout.js";

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
let ctx = null;  // { layout, relayout(fn), refresh() } from main.js
let wins = {};   // window kind -> { w, h (rem), x, y (px) }
let drag = null; // a bar or window being dragged

// ---------- panels ----------
const GUTTERS = {
  left: { id: "gut-left", open: "⟨", shut: "⟩", label: "Bases · People · Groups · Teams", key: "[" },
  right: { id: "gut-right", open: "⟩", shut: "⟨", label: "Info", key: "]" },
  log: { id: "gut-log", open: "▾", shut: "▴", label: "Log", key: "L" },
};

// The body classes and sizes that set the page's grid (styles.css), and the bars' hover text.
export function applyLayout(L) {
  const b = document.body, root = document.documentElement;
  for (const p of ["left", "right", "log"]) {
    b.classList.toggle(`fold-${p}`, !!L[p]);
    // A width set on a big screen (or at a big UI size) never leaves the map less than about a third of a smaller one.
    if (L.size[p] != null) root.style.setProperty(`--${p}-size`, `min(${L.size[p]}rem, ${p === "log" ? "45vh" : "35vw"})`);
    else root.style.removeProperty(`--${p}-size`);
    const g = document.getElementById(GUTTERS[p].id);
    if (g) g.dataset.tip = L[p] ? `Show the ${p === "log" ? "log" : `${p} panel`} (${GUTTERS[p].key})` : `Click: fold the ${p === "log" ? "log" : `${p} panel`} away (${GUTTERS[p].key}). Drag: resize it`;
  }
  b.classList.toggle("map-only", !!L.all);
  const btn = document.getElementById("tb-maponly");
  if (btn) btn.classList.toggle("active", !!L.all);
}

// Builds the three bars (once) and listens to them.
export function initPanels(api) {
  ctx = api;
  wins = loadWindows();
  const app = document.getElementById("app");
  for (const [p, g] of Object.entries(GUTTERS)) {
    if (document.getElementById(g.id)) continue;
    const el = document.createElement("div");
    el.id = g.id;
    el.className = `gut gut-${p}`;
    el.dataset.p = p;
    el.innerHTML = `<span class="gut-open">${g.open}</span><span class="gut-shut">${g.shut}<span class="gut-label">${g.label}</span><span class="gut-line"></span><kbd>${g.key}</kbd></span>`;
    app.appendChild(el);
  }
  // The map-only button in the top bar (static; the top bar's other slots are redrawn by main.js).
  const top = document.getElementById("topbar");
  if (top && !document.getElementById("tb-maponly")) {
    const b = document.createElement("button");
    b.id = "tb-maponly";
    b.className = "mini";
    b.dataset.action = "panel-all";
    b.dataset.tip = "Map only: fold every panel away, again to bring them back (\\)";
    b.textContent = "▣";
    top.appendChild(b);
  }
  applyLayout(ctx.layout);
  document.addEventListener("mousedown", onDown, true);
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("mouseup", onUp, true);
  document.addEventListener("dblclick", onDbl, true);
  window.addEventListener("resize", () => { fitWindows(); });
}

// The folded log's strip shows the latest line.
export function setLogLine(text) {
  const el = document.querySelector("#gut-log .gut-line");
  if (el && el.textContent !== text) el.textContent = text;
}

// ---------- windows ----------
// Puts a remembered size and place on the window on screen (after the modal was written, the window resized, the
// UI size changed). Clamped to the screen; the stored values stay as they were.
export function fitWindows() {
  for (const w of document.querySelectorAll("#modal .win")) fitWindow(w);
}
function fitWindow(win) {
  const g = wins[win.dataset.win];
  const rem = remPx(), vw = window.innerWidth, vh = window.innerHeight;
  win.classList.toggle("sized", !!(g && g.w));
  win.classList.toggle("placed", !!(g && g.x != null));
  if (!g) { win.removeAttribute("style"); return; }
  if (g.w) {
    const c = clampRect({ w: g.w * rem, h: g.h * rem, x: null, y: null }, vw, vh, rem);
    win.style.width = `${Math.round(c.w)}px`;
    win.style.height = `${Math.round(c.h)}px`;
  } else { win.style.width = ""; win.style.height = ""; }
  if (g.x != null) {
    const r = win.getBoundingClientRect();
    const c = clampRect({ x: g.x, y: g.y, w: null, h: null, bw: r.width, bh: r.height }, vw, vh, rem);
    win.style.left = `${Math.round(c.x)}px`;
    win.style.top = `${Math.round(c.y)}px`;
  }
}
// Every window back to its usual size and place.
export function resetWindows(key) {
  if (key) delete wins[key];
  else wins = {};
  saveWindows(wins);
  fitWindows();
}
export const windowSizes = () => wins;

// The title of a window: its first line when that holds a heading (or the base screen's name), else its h1.
function titleOf(box) {
  const first = box.firstElementChild;
  if (first && (/^H[12]$/.test(first.tagName) || first.querySelector("h1, h2, .basename"))) return first;
  return box.querySelector(":scope > h1");
}
const INTERACTIVE = "button, input, select, textarea, a, label, [data-action], [data-drag], [data-drop]";

// ---------- dragging ----------
function onDown(e) {
  if (e.button !== 0) return;
  const t = e.target;
  if (!t || !t.closest) return;
  const gut = t.closest(".gut");
  if (gut) {
    e.preventDefault();
    const p = gut.dataset.p;
    const panel = document.getElementById(p);
    const r = panel ? panel.getBoundingClientRect() : { width: 0, height: 0 };
    drag = { kind: "gut", p, x: e.clientX, y: e.clientY, size: p === "log" ? r.height : r.width, moved: false, folded: !!ctx.layout[p] };
    return;
  }
  const win = t.closest("#modal .win");
  if (!win) return;
  const grip = t.closest(".wgrip");
  let dir = grip ? grip.dataset.grip : null;
  if (!dir) {
    const box = win.querySelector(":scope > .box");
    const title = box && titleOf(box);
    if (!title || !title.contains(t) || t.closest(INTERACTIVE)) return;
    dir = "move";
  }
  e.preventDefault();
  const r = win.getBoundingClientRect();
  drag = { kind: "win", win, key: win.dataset.win, dir, x: e.clientX, y: e.clientY, start: { x: r.left, y: r.top, w: r.width, h: r.height }, moved: false };
  document.body.classList.add("win-dragging");
}

let raf = 0, pending = null;
function onMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
  drag.moved = true;
  if (drag.kind === "gut") {
    if (drag.folded) return; // a folded strip only opens
    const rem = remPx(), p = drag.p;
    const px = p === "left" ? drag.size + dx : p === "right" ? drag.size - dx : drag.size - dy;
    const cap = (p === "log" ? window.innerHeight * 0.45 : window.innerWidth * 0.35) / rem; // as styles cap them (applyLayout)
    const v = Math.max(PANEL_SIZE[p].min, Math.min(cap, px / rem));
    pending = () => { if (setPanelSize(ctx.layout, p, Math.round(v * 10) / 10)) ctx.relayout(() => applyLayout(ctx.layout)); };
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; const f = pending; pending = null; if (f) f(); });
    return;
  }
  const rem = remPx();
  const c = dragRect(drag.start, drag.dir, dx, dy, window.innerWidth, window.innerHeight, rem);
  const win = drag.win;
  win.classList.add("placed");
  win.style.left = `${Math.round(c.x)}px`;
  win.style.top = `${Math.round(c.y)}px`;
  if (drag.dir !== "move") {
    win.classList.add("sized");
    win.style.width = `${Math.round(c.w)}px`;
    win.style.height = `${Math.round(c.h)}px`;
  }
  drag.rect = c;
}

function onUp() {
  if (!drag) return;
  const d = drag;
  drag = null;
  document.body.classList.remove("win-dragging");
  if (d.kind === "gut") {
    if (raf) { cancelAnimationFrame(raf); raf = 0; if (pending) pending(); pending = null; }
    if (!d.moved) { // a click: fold or unfold
      ctx.relayout(() => { setFolded(ctx.layout, d.p); applyLayout(ctx.layout); });
      ctx.refresh();
    }
    saveLayout(ctx.layout);
    return;
  }
  if (!d.moved || !d.rect) return;
  const rem = remPx();
  const old = wins[d.key] || {};
  const c = d.rect;
  wins[d.key] = d.dir === "move" ? { ...(old.w ? { w: old.w, h: old.h } : {}), x: Math.round(c.x), y: Math.round(c.y) } :
    { w: Math.round((c.w / rem) * 100) / 100, h: Math.round((c.h / rem) * 100) / 100, x: Math.round(c.x), y: Math.round(c.y) };
  saveWindows(wins);
}

// Double-click on a window's title: back to its usual size and place.
function onDbl(e) {
  const t = e.target;
  const win = t && t.closest && t.closest("#modal .win");
  if (!win) return;
  const box = win.querySelector(":scope > .box");
  const title = box && titleOf(box);
  if (!title || !title.contains(t) || t.closest(INTERACTIVE)) return;
  resetWindows(win.dataset.win);
}

// ---------- the timelapse's floating boxes ----------
// They resize from their corner (CSS resize); the size is remembered like a window's.
let floatWatch = []; // the observers of the timelapse boxes on screen (dropped when it opens again)
export function watchFloating(root) {
  for (const o of floatWatch) o.disconnect();
  floatWatch = [];
  if (!root || typeof ResizeObserver === "undefined") return;
  for (const el of root.querySelectorAll(".tl-info, .tl-caps")) {
    const key = el.classList.contains("tl-info") ? "tlinfo" : "tlcaps";
    const g = wins[key];
    const rem = remPx();
    if (g && g.w) { el.style.width = `${Math.min(g.w, window.innerWidth / rem - 2)}rem`; el.style.height = `${Math.min(g.h, window.innerHeight / rem - 8)}rem`; }
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) { first = false; return; } // the first call is the box appearing
      if (!el.style.width && !el.style.height) return; // only sizes the player set with the corner
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) return;
      wins[key] = { w: Math.round((r.width / remPx()) * 100) / 100, h: Math.round((r.height / remPx()) * 100) / 100 };
      saveWindows(wins);
    });
    ro.observe(el);
    floatWatch.push(ro);
  }
}
