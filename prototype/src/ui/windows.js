// On the page: the bars between the map and its panels (fold, unfold, drag to resize), the grips and title drag of
// resizable windows, the title bar the big windows share (winBar: the title, the window's buttons, a ✕; a row of
// tabs that scrolls sideways under it), and the timelapse's floating boxes. The rules (what folds, sizes, clamping)
// are in ui/layout.js; main.js owns the layout object and redraws the map when the space for it changes (relayout).
import {
  PANEL_SIZE, SHUT_KEYS, PANEL_NAMES, RAIL_TABS, isShut, shutTip, setFolded, setPanelSize, saveLayout, loadWindows, saveWindows, dragRect, clampRect,
} from "./layout.js";
import { swallowTap, HOLD_MS } from "./touch.js"; // a bar tapped or a window dragged by a finger: no mouse events or click after it

const coarse = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches; // a finger: its own hints
const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let ctx = null;  // { layout, relayout(fn), refresh() } from main.js
let wins = {};   // window kind -> { w, h (rem), x, y (px) }
let drag = null; // a bar or window being dragged

// ---------- panels ----------
const GUTTERS = {
  left: { id: "gut-left", open: "⟨", shut: "⟩", label: "Bases · People · Groups · Teams", key: "[", name: "left panel", short: "Lists" },
  right: { id: "gut-right", open: "⟩", shut: "⟨", label: "Info", icon: "ℹ", key: "]", name: "right panel", short: "Info" },
  log: { id: "gut-log", open: "▾", shut: "▴", label: "Log", icon: "📜", key: "L", name: "log", short: "Log" },
};
// The bar's own keys (it takes the focus with Tab): Enter or Space folds or shows the panel, the arrows make an open
// panel narrower or wider (Shift: by more), Home its usual size.
const GUT_GROW = { left: { ArrowRight: 1, ArrowLeft: -1 }, right: { ArrowLeft: 1, ArrowRight: -1 }, log: { ArrowUp: 1, ArrowDown: -1 } };

// The body classes and sizes that set the page's grid (styles.css), the bars' hover text and the state of the
// top-bar buttons that close a panel completely (lit while the panel is there, dark while it is closed).
export function applyLayout(L) {
  const b = document.body, root = document.documentElement;
  for (const p of ["left", "right", "log"]) {
    b.classList.toggle(`fold-${p}`, !!L[p]);
    b.classList.toggle(`shut-${p}`, isShut(L, p));
    const sb = document.getElementById(`tb-panel-${p}`);
    if (sb) { sb.classList.toggle("active", !isShut(L, p)); sb.dataset.tip = shutTip(L, p); }
    const tab = document.getElementById(`tab-${p}`);
    if (tab) tab.dataset.tip = shutTip(L, p);
    // A width set on a big screen (or at a big UI size) never leaves the map less than about a third of a smaller one.
    if (L.size[p] != null) root.style.setProperty(`--${p}-size`, `min(${L.size[p]}rem, ${p === "log" ? "45vh" : "35vw"})`);
    else root.style.removeProperty(`--${p}-size`);
    const g = document.getElementById(GUTTERS[p].id);
    if (g) {
      g.dataset.tip = L[p] ? `Show the ${p === "log" ? "log" : `${p} panel`} (${GUTTERS[p].key})` : `Click: fold the ${p === "log" ? "log" : `${p} panel`} away (${GUTTERS[p].key}). Drag: resize it${coarse() ? ". Long press: its usual size" : ""}`;
      if (g.setAttribute) { g.setAttribute("aria-expanded", String(!L[p])); g.setAttribute("aria-label", L[p] ? `Show the ${GUTTERS[p].name}` : `Fold the ${GUTTERS[p].name} away; arrow keys resize it`); }
    }
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
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-controls", p);
    // Open: a slim bar with a handle (click folds, drag resizes). Folded: a rail with the panel's name, its key and
    // a ✕; the left panel's rail has a button per tab (main.js "panel-tab": opens the panel on it, with the count of
    // teams waiting on Teams). The rail's buttons and its ✕ (main.js "panel-close") are left to the click (onDown).
    const tabs = p === "left" ? `<span class="gut-tabs">${RAIL_TABS.map(([k, ic, name, key]) =>
      `<button class="gut-tab" data-action="panel-tab" data-tab="${k}" aria-label="${name}" data-tip="${name} (${key})"><span aria-hidden="true">${ic}</span><b class="gut-badge hidden" data-rail="${k}"></b></button>`).join("")}</span>` : "";
    el.innerHTML = `<span class="gut-open"><span class="gut-grip" aria-hidden="true"></span><span class="gut-chev" aria-hidden="true">${g.open}</span></span>` +
      `<span class="gut-shut"><span class="gut-chev" aria-hidden="true">${g.shut}</span>${tabs}${g.icon ? `<span class="gut-icon" aria-hidden="true">${g.icon}</span>` : ""}<span class="gut-label">${g.label}</span><span class="gut-line"></span><kbd>${g.key}</kbd>` +
      `<button class="gut-close" data-action="panel-close" data-p="${p}" aria-label="Close the ${PANEL_NAMES[p].name} completely" data-tip="Close the ${PANEL_NAMES[p].name} completely, strip and all (Alt+${g.key}). Back: the ${PANEL_NAMES[p].glyph} button in the top bar, the ${PANEL_NAMES[p].tab} tab at the map's edge, Alt+${g.key} or ${g.key}">✕</button></span>`;
    el.addEventListener("keydown", (e) => onGutKey(e, p));
    app.appendChild(el);
  }
  // A closed panel's way back: a slim tab at that edge of the map (styles.css shows it only while the panel is closed).
  const wrap = document.getElementById("mapwrap");
  for (const p of SHUT_KEYS) {
    if (!wrap || document.getElementById(`tab-${p}`)) continue;
    const t = document.createElement("button");
    t.id = `tab-${p}`;
    t.className = `edgetab edgetab-${p}`;
    t.dataset.action = "panel-close";
    t.dataset.p = p;
    t.setAttribute("aria-label", `Open the ${PANEL_NAMES[p].name}`);
    t.innerHTML = `<span aria-hidden="true">${PANEL_NAMES[p].tab}</span><span class="edgetab-label">${GUTTERS[p].short}</span>`;
    wrap.appendChild(t);
  }
  // The top bar's panel buttons (◧ ◨ ⬓: close a panel completely, again to open it) and the map-only button
  // (static; the top bar's other slots are redrawn by main.js).
  const top = document.getElementById("topbar");
  if (top && !document.getElementById("tb-panels")) {
    const g = document.createElement("span");
    g.id = "tb-panels";
    g.className = "row";
    for (const p of SHUT_KEYS) {
      const b = document.createElement("button");
      b.id = `tb-panel-${p}`;
      b.className = "mini";
      b.dataset.action = "panel-close";
      b.dataset.p = p;
      b.textContent = PANEL_NAMES[p].glyph;
      g.appendChild(b);
    }
    top.appendChild(g);
  }
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
  // A finger (or a pen) drags the bars and windows by Pointer Events, the mouse by the listeners above (unchanged).
  document.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse" && e.isPrimary && !drag) { onDown(e); if (drag) { drag.pid = e.pointerId; drag.t0 = performance.now(); } } }, true);
  window.addEventListener("pointermove", (e) => { if (drag && drag.pid === e.pointerId) onMove(e); }, true);
  for (const k of ["pointerup", "pointercancel"]) window.addEventListener(k, (e) => {
    if (!drag || drag.pid !== e.pointerId) return;
    const d = drag, held = k === "pointerup" && !d.moved && performance.now() - d.t0 >= HOLD_MS;
    // The browser took the finger (a scroll), or it was a long press (its tip, ui/touch.js): no fold, nothing pressed.
    if (k === "pointercancel" || performance.now() - drag.t0 >= HOLD_MS) drag.moved = true;
    onUp();
    swallowTap();
    if (k === "pointerup") fingerReset(d, held);
  }, true);
  document.addEventListener("dblclick", onDbl, true);
  window.addEventListener("resize", () => { fitWindows(); });
  watchFolds();
  watchChrome();
}

// The folded log's strip shows the latest line.
export function setLogLine(text) {
  const el = document.querySelector("#gut-log .gut-line");
  if (el && el.textContent !== text) el.textContent = text;
}
// The folded left panel's rail: the tab on show lit, and the count of teams waiting on Teams.
export function setRailBadges({ teams = 0, tab = "" } = {}) {
  if (typeof document === "undefined" || !document.querySelectorAll) return;
  for (const b of document.querySelectorAll("#gut-left .gut-tab")) b.classList.toggle("on", b.dataset.tab === tab);
  const el = document.querySelector('#gut-left .gut-badge[data-rail="teams"]');
  if (!el) return;
  const txt = teams > 0 ? String(teams) : "";
  if (el.textContent !== txt) el.textContent = txt;
  el.classList.toggle("hidden", !txt);
}

// A bar with the focus: Enter / Space folds or shows its panel, the arrows resize an open one, Home its usual size.
function onGutKey(e, p) {
  if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return; // a button on the rail handles its own keys
  const L = ctx.layout;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault(); e.stopPropagation();
    ctx.relayout(() => { setFolded(L, p); applyLayout(L); });
    saveLayout(L);
    ctx.refresh();
    return;
  }
  const grow = GUT_GROW[p][e.key];
  if ((grow || e.key === "Home") && !L[p]) {
    e.preventDefault(); e.stopPropagation();
    const panel = document.getElementById(p), rem = remPx();
    const now = panel ? (p === "log" ? panel.getBoundingClientRect().height : panel.getBoundingClientRect().width) / rem : PANEL_SIZE[p].def;
    const cap = (p === "log" ? window.innerHeight * 0.45 : window.innerWidth * 0.35) / rem;
    const v = e.key === "Home" ? null : Math.max(PANEL_SIZE[p].min, Math.min(cap, Math.round(now + grow * (e.shiftKey ? 4 : 1))));
    if (setPanelSize(L, p, v)) { ctx.relayout(() => applyLayout(L)); saveLayout(L); }
  }
}

// The boxes over the map (Watching, Layers, alerts, the first-week guide) are written by main.js; when one folds to its
// tab or opens again, it eases in (styles.css .fp-anim; none with Reduce motion).
const FOLD_BOXES = ["watchlist", "legend", "alerts", "guide"];
function boxFolded(el) {
  const kids = el.children;
  if (el.id === "alerts") return !!el.querySelector(":scope > .al-pill");
  return kids.length === 1 && kids[0].classList.contains("fp-tab");
}
function watchFolds() {
  if (typeof MutationObserver === "undefined") return;
  for (const id of FOLD_BOXES) {
    const el = document.getElementById(id);
    if (!el) continue;
    new MutationObserver(() => {
      const f = boxFolded(el) ? "1" : el.children.length ? "0" : "";
      const was = el.dataset.fold;
      el.dataset.fold = f;
      if (!f || was === undefined || was === "" || was === f) return;
      el.classList.remove("fp-anim");
      void el.offsetWidth; // restart the animation
      el.classList.add("fp-anim");
    }).observe(el, { childList: true });
    el.addEventListener("animationend", (e) => { if (e.target === el) el.classList.remove("fp-anim"); });
  }
}

// ---------- the chrome of a window ----------
// The title bar every big window shares (the user's request 2026-10-24: one window chrome, no button that only
// duplicates the ✕): the title at the left (an h1, or the base screen's name box), the window's own buttons after
// it, and a ✕ at the right that fires the window's own close action (closebase, closesurv, set-close; for the windows
// without a bar ui/layout.js windowFrame puts a ✕ in the corner that is Esc, main.js "win-close"). The head is sticky
// at the top of the box (styles.css .whead), so the ✕ and the tabs stay in reach while the body scrolls, on a desktop
// and on a phone on its side; dragging the bar moves the window (titleOf). tabs: a row of tabs in the same sticky
// head, one row that scrolls sideways (fitTabs: the lit tab scrolled into view, a fade at an end where more hide).
// The ✕'s tip says "(Esc)" to a keyboard only: every tip goes through ui/hints.js devText, which drops the key for
// a finger and makes it Ⓑ for a pad.
export function winBar({ title, tools = "", close = "", closeTip = "Close (Esc)", tabs = "", cls = "" }) {
  const x = close ? `<button class="wx" data-action="${close}" aria-label="Close" data-tip="${esc(closeTip)}">✕</button>` : "";
  const strip = tabs ? `<div class="wtabwrap"><i class="wtab-l" aria-hidden="true"></i><div class="tabs wtabs">${tabs}</div><i class="wtab-r" aria-hidden="true"></i></div>` : "";
  return `<div class="whead${cls ? ` ${cls}` : ""}"><div class="wbar">${title}${tools ? `<span class="wtools">${tools}</span>` : ""}${x}</div>${strip}</div>`;
}

// The row of tabs of a window (winBar tabs): the lit tab scrolled into view, and a fade at an end where more tabs
// hide (styles.css .wtabwrap.more-l / .more-r). After a window is written (fitWindows) and as the row scrolls; a
// scroll position the player gave the row is kept through a redraw of the same window (tabScroll, by window kind).
const tabScroll = new Map();
let tabsRaf = 0;
export function fitTabs() {
  for (const strip of document.querySelectorAll("#modal .wtabs")) {
    if (!strip.clientWidth) { if (!tabsRaf) tabsRaf = requestAnimationFrame(() => { tabsRaf = 0; fitTabs(); }); continue; } // written while the modal is still hidden: measured on the next frame
    const win = strip.closest(".win"), key = win ? win.dataset.win : "";
    const kept = tabScroll.get(key);
    if (kept != null && strip.scrollLeft !== kept) strip.scrollLeft = kept;
    const a = strip.querySelector(".active");
    if (a) {
      const pad = 1.5 * remPx(), l = a.offsetLeft, r = l + a.offsetWidth;
      if (l < strip.scrollLeft + pad) strip.scrollLeft = Math.max(0, l - pad);
      else if (r > strip.scrollLeft + strip.clientWidth - pad) strip.scrollLeft = r - strip.clientWidth + pad;
    }
    if (key) tabScroll.set(key, strip.scrollLeft);
    fadeTabs(strip);
  }
}
function fadeTabs(strip) {
  const wrap = strip.parentElement;
  if (!wrap || !wrap.classList.contains("wtabwrap")) return;
  wrap.classList.toggle("more-l", strip.scrollLeft > 2);
  wrap.classList.toggle("more-r", strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2);
}
// The row scrolled by the player (its fades follow); the mouse wheel over it scrolls it sideways (a row has no
// scrollbar to grab: styles.css hides it); a click on a fade scrolls a screenful that way. The survivor screen's
// gear rows: ⋯ shows or hides the row's equip controls (styles.css .gslot.open; a mouse sees them by hovering).
function watchChrome() {
  document.addEventListener("scroll", (e) => {
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains("wtabs")) return;
    const win = t.closest(".win");
    if (win) tabScroll.set(win.dataset.win, t.scrollLeft);
    fadeTabs(t);
  }, true);
  document.addEventListener("wheel", (e) => {
    const strip = e.target && e.target.closest && e.target.closest("#modal .wtabs");
    if (!strip || strip.scrollWidth <= strip.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    strip.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const fade = t.closest("#modal .wtab-l, #modal .wtab-r");
    if (fade) {
      const strip = fade.parentElement.querySelector(".wtabs");
      if (strip) strip.scrollBy({ left: (fade.classList.contains("wtab-l") ? -0.6 : 0.6) * strip.clientWidth, behavior: "smooth" });
      return;
    }
    const more = t.closest("#modal .gs-more");
    const row = more ? more.closest(".gslot") : null, on = row && !row.classList.contains("open");
    for (const r of document.querySelectorAll("#modal .gslot.open")) if (r !== row || on) if (!r.contains(t) || more) r.classList.remove("open"); // a press elsewhere closes an open row's controls
    if (row && on) row.classList.add("open");
  });
}

// ---------- windows ----------
// Puts a remembered size and place on the window on screen (after the modal was written, the window resized, the
// UI size changed). Clamped to the screen; the stored values stay as they were.
export function fitWindows() {
  for (const w of document.querySelectorAll("#modal .win")) fitWindow(w);
  fitTabs();
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
  if (t.closest(".gut-close, .gut-tab")) return; // the strip's ✕ and the rail's tabs: main.js's click handler
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

// A finger has no Home key and its double tap is no dblclick (the drag above swallows the tap): a long press on an
// open bar puts its panel back to its usual size, and a double tap on a window's title puts the window back to its
// usual size and place (as Home and the double-click do for a mouse; Options → Reset window sizes does them all).
let lastTap = null; // { key, t }: a window's title tapped once
function fingerReset(d, held) {
  if (d.kind === "gut") {
    if (held && !d.folded && setPanelSize(ctx.layout, d.p, null)) { ctx.relayout(() => applyLayout(ctx.layout)); saveLayout(ctx.layout); }
    return;
  }
  if (d.dir !== "move" || d.moved) { lastTap = null; return; }
  const t = performance.now();
  if (lastTap && lastTap.key === d.key && t - lastTap.t < 500) { lastTap = null; resetWindows(d.key); }
  else lastTap = { key: d.key, t };
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
