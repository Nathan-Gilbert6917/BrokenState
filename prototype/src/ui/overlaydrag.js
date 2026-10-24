// The boxes over the State Map move: Watching, Layers, the alerts, the first-week guide (under
// them), the minimap (and its ▣ Minimap button while it is hidden) and the dev tools. Each is dragged by its header
// bar (every box has the same one: icon, title, count, chevron and a ✥ at its end; a folded box by its slim tab; the
// alerts also by the guide's title; the minimap by its top edge or its ✥ grip) to anywhere over the map, with the
// mouse, a finger or a pen (pointer events). A short move (DRAG_PX) is still a click, so the fold chevron and the
// header's buttons work as before; a drag never pans the map or clicks it. On a phone or a tablet held upright the
// boxes have fixed slots under the strip over the map and nothing drags (setOverlaysFixed, ui/responsive.js; the
// user's request 2026-10-24: "some can freely move around, others don't" is now every box the same way on a desktop
// and none on a phone).
// - Kept inside the map: the place is clamped to the map whenever it is put on the page (each refresh, the map's box
//   resized: the window, the UI size, a side panel folded or opened); near an edge or corner it snaps to it.
// - Dropped on another box, it moves to the nearest free spot beside it when there is one.
// - Remembered per box in the browser (localStorage OVERLAY_KEY, failures ignored) as the distance from the nearest
//   edges of the map in rem, so a box put in a corner stays in that corner when the map changes size and grows with
//   the UI size. Menu → Options → Windows and panels → Reset overlay positions (and Alt+Home on a header for one box)
//   puts them back where they start.
// - Keyboard: with a header (or tab, or the grip) focused, Alt+arrow keys nudge the box (Shift: further).
// - Nothing eases while a box is dragged (styles.css body.ov-dragging), and no move is animated at all, so Reduce
//   motion has nothing to stop.
// The rules (snap, clamp, the free spot, the anchors, storage) are plain functions on plain objects
// (tools/overlaytest.js runs them without a browser); initOverlays / syncOverlays put them on the page (main.js).

export const OVERLAY_KEY = "brokenstate.overlays";
export const DRAG_PX = 5;          // a press that moves less than this (CSS px; a finger: DRAG_PX_TOUCH) is a click
export const DRAG_PX_TOUCH = 10;
export const EDGE_REM = 0.6;       // the gap from the map's edge the boxes start with (styles.css)
export const SNAP_REM = 1.25;      // closer than this to that gap: snapped to it
export const GAP_REM = 0.5;        // the gap kept from another box
export const NUDGE_REM = 1, NUDGE_FAR_REM = 4;

// The boxes: the elements (the first one is measured; the others share its place), what starts a drag, the name
// for Help and the hover text, and the height it may take (its stylesheet's max-height) when it is placed.
export const OVERLAYS = {
  watchlist: { els: ["watchlist"], head: ".fp-head, .fp-tab", name: "Watching", maxH: "50%" },
  legend: { els: ["legend"], head: ".fp-head, .fp-tab", name: "Layers", maxH: "calc(100% - 1.2rem)" },
  alerts: { els: ["alerts"], head: ".fp-head, .fp-tab", name: "Alerts", maxH: "calc(100% - 1.2rem)" },
  guide: { els: ["guide"], head: ".gd-head, .fp-tab", name: "First week", maxH: "60%" },
  minimap: { els: ["minimap", "mm-show"], head: ".ov-grip, .mm-bar, #mm-show", name: "Minimap", maxH: "" },
  devpanel: { els: ["devpanel"], head: ".ov-devhead", name: "Dev tools", maxH: "70%" },
};
// The buttons a drag may start on (they are the header itself); any other button, field or link in a header is
// left to its click.
const DRAG_BUTTONS = ".fp-toggle, .fp-tab, .ov-grip, #mm-show";
const NO_DRAG = "button, input, select, textarea, a, label";
// The handles whose hover text says they move too (the grip and the minimap's top edge say so themselves).
const TIP_HANDLES = ".fp-toggle, .fp-tab, #mm-show, .gd-title";
let fixed = false; // a phone or a tablet held upright: the boxes keep their slots (ui/responsive.js setOverlaysFixed)

const num = (v) => (Number.isFinite(v) ? v : null);
const storage = () => {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
};

// ---------- storage ----------
// { key: { h: "l" | "r", x: rem from that edge, v: "t" | "b", y: rem from that edge } }; unknown boxes and bad
// values are dropped.
export function readOverlayPos(v) {
  const out = {};
  if (!v || typeof v !== "object") return out;
  for (const k of Object.keys(OVERLAYS)) {
    const a = v[k];
    if (!a || typeof a !== "object") continue;
    const x = num(a.x), y = num(a.y);
    if ((a.h !== "l" && a.h !== "r") || (a.v !== "t" && a.v !== "b") || x == null || y == null) continue;
    out[k] = { h: a.h, x: Math.max(0, Math.min(500, x)), v: a.v, y: Math.max(0, Math.min(500, y)) };
  }
  return out;
}
export function loadOverlayPos(store = storage()) {
  try {
    const raw = store && store.getItem(OVERLAY_KEY);
    return raw ? readOverlayPos(JSON.parse(raw)) : {};
  } catch { return {}; } // unreadable or blocked: where they start
}
export function saveOverlayPos(P, store = storage()) {
  try {
    if (!store) return false;
    if (Object.keys(P).length) store.setItem(OVERLAY_KEY, JSON.stringify(P));
    else store.removeItem(OVERLAY_KEY);
    return true;
  } catch { return false; } // blocked: this session only
}
// Back where they start: one box (key) or all of them. Returns true when something changed.
export function resetOverlayPos(P, key) {
  const keys = key ? [key] : Object.keys(P);
  let changed = false;
  for (const k of keys) if (P[k]) { delete P[k]; changed = true; }
  return changed;
}

// ---------- the rules (rectangles in CSS px, relative to the map's box W × H) ----------
export const pastThreshold = (dx, dy, touch = false) => Math.hypot(dx, dy) >= (touch ? DRAG_PX_TOUCH : DRAG_PX);

// Inside the map: the top left kept so the box stays on it (a box bigger than the map keeps its top left corner).
export function clampBox(r, W, H) {
  return { x: Math.max(0, Math.min(W - r.w, r.x)), y: Math.max(0, Math.min(H - r.h, r.y)), w: r.w, h: r.h };
}
// Near an edge (within the start gap plus SNAP_REM): onto the start gap from it; both edges near: a corner.
export function snapBox(r, W, H, rem = 16) {
  const m = EDGE_REM * rem, s = SNAP_REM * rem;
  let { x, y } = r;
  if (x < m + s) x = m;
  else if (W - (x + r.w) < m + s) x = W - r.w - m;
  if (y < m + s) y = m;
  else if (H - (y + r.h) < m + s) y = H - r.h - m;
  return clampBox({ x, y, w: r.w, h: r.h }, W, H);
}
const hits = (a, b, g = 0) => a.x < b.x + b.w + g && b.x < a.x + a.w + g && a.y < b.y + b.h + g && b.y < a.y + a.h + g;
// Dropped over other boxes: the nearest spot beside one of them (left, right, above, below, the gap kept) that is
// on the map and clear of all of them; none: where it was dropped.
export function avoidOverlap(r, others, W, H, rem = 16) {
  const list = (others || []).filter((o) => o && o.w > 0 && o.h > 0);
  if (!list.some((o) => hits(r, o))) return r;
  const g = GAP_REM * rem;
  const cand = [];
  for (const o of list) {
    cand.push({ x: o.x - r.w - g, y: r.y }, { x: o.x + o.w + g, y: r.y }, { x: r.x, y: o.y - r.h - g }, { x: r.x, y: o.y + o.h + g });
  }
  let best = null, bd = Infinity;
  for (const c of cand) {
    const b = clampBox({ x: c.x, y: c.y, w: r.w, h: r.h }, W, H);
    if (list.some((o) => hits(b, o))) continue;
    const d = Math.hypot(b.x - r.x, b.y - r.y);
    if (d < bd) { bd = d; best = b; }
  }
  return best || r;
}
// Where a drag ends: the start moved by dx, dy, clamped, snapped, clear of the others when it can be.
export function dropBox(start, dx, dy, W, H, others = [], rem = 16) {
  const moved = clampBox({ x: start.x + dx, y: start.y + dy, w: start.w, h: start.h }, W, H);
  return avoidOverlap(snapBox(moved, W, H, rem), others, W, H, rem);
}
// The place to remember: the distance from the nearer edge each way, in rem.
const r2 = (v) => Math.round(v * 100) / 100;
export function toAnchor(r, W, H, rem = 16) {
  const h = r.x + r.w / 2 > W / 2 ? "r" : "l", v = r.y + r.h / 2 > H / 2 ? "b" : "t";
  return { h, x: r2(Math.max(0, h === "l" ? r.x : W - r.x - r.w) / rem), v, y: r2(Math.max(0, v === "t" ? r.y : H - r.y - r.h) / rem) };
}
// And back: the top left of a w × h box placed by an anchor, kept on the map.
export function fromAnchor(a, w, h, W, H, rem = 16) {
  const x = a.h === "l" ? a.x * rem : W - w - a.x * rem, y = a.v === "t" ? a.y * rem : H - h - a.y * rem;
  return clampBox({ x, y, w, h }, W, H);
}
// Alt+arrow: the box moved by a step, kept on the map (no snap: small steps away from an edge must work).
export function nudgeBox(r, key, far, W, H, rem = 16) {
  const s = (far ? NUDGE_FAR_REM : NUDGE_REM) * rem;
  const d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[key];
  if (!d) return null;
  return clampBox({ x: r.x + d[0], y: r.y + d[1], w: r.w, h: r.h }, W, H);
}

// ---------- on the page ----------
let P = {};        // the remembered places
let ctx = null;    // { refresh } from main.js
let wrap = null;   // #mapwrap
let pend = null;   // a press on a header: { key, el, id, x, y, touch, start, others, moved }
const hasDoc = () => typeof document !== "undefined" && !!document.getElementById;
const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const shown = (el) => !!el && !el.classList.contains("hidden") && el.offsetWidth > 0 && el.offsetHeight > 0;
// The box's rectangle relative to the map's box.
function rectIn(el) {
  const w = wrap.getBoundingClientRect(), r = el.getBoundingClientRect();
  return { x: r.left - w.left - wrap.clientLeft, y: r.top - w.top - wrap.clientTop, w: r.width, h: r.height };
}
// The visible box of each key (the minimap or its button, whichever shows).
function visibleEl(k) {
  for (const id of OVERLAYS[k].els) { const el = document.getElementById(id); if (shown(el)) return el; }
  return null;
}
function otherRects(key) {
  const out = [];
  for (const k of Object.keys(OVERLAYS)) {
    if (k === key) continue;
    const el = visibleEl(k);
    if (el) out.push(rectIn(el));
  }
  // The banner's notes at the top of the map (Paused, move mode, the card tray) count too, and the row of buttons at the
  // bottom left (ui/hudbar.js).
  const banner = document.getElementById("banner");
  if (shown(banner)) for (const c of banner.children) if (c.offsetWidth && c.offsetHeight) out.push(rectIn(c));
  const hb = document.getElementById("hudbar");
  if (shown(hb)) out.push(rectIn(hb));
  return out;
}
const SIDES = ["left", "right", "top", "bottom"];
function clearPlace(el) {
  el.classList.remove("ov-placed", "ov-bumped");
  for (const s of SIDES) el.style[s] = "";
  el.style.maxHeight = "";
}
// Puts one box where it is remembered (or back on its stylesheet), kept on the map. With the boxes fixed (a phone),
// every one goes back on its stylesheet slot; the remembered place waits for a bigger window.
function applyOne(k) {
  const def = OVERLAYS[k], a = fixed ? null : P[k];
  const W = wrap.clientWidth, H = wrap.clientHeight, rem = remPx();
  for (const id of def.els) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (!a) {
      if (el.classList.contains("ov-placed") || el.classList.contains("ov-bumped")) clearPlace(el);
      continue;
    }
    el.classList.add("ov-placed");
    const off = (v) => Math.max(0, v * rem);
    // It may reach from its edge to the far side of the map (never less than 40% of it), and no further than its
    // stylesheet lets it.
    if (def.maxH) el.style.maxHeight = `min(${def.maxH}, ${Math.round(Math.max(H * 0.4, H - off(a.y) - 0.3 * rem))}px)`;
    el.style.left = a.h === "l" ? `${Math.round(off(a.x))}px` : "auto";
    el.style.right = a.h === "r" ? `${Math.round(off(a.x))}px` : "auto";
    el.style.top = a.v === "t" ? `${Math.round(off(a.y))}px` : "auto";
    el.style.bottom = a.v === "b" ? `${Math.round(off(a.y))}px` : "auto";
    if (!shown(el) || !W || !H) continue;
    // Off the map (it grew, the map shrank): pulled back in, the remembered place kept for when there is room.
    const r = rectIn(el), c = clampBox(r, W, H);
    if (Math.abs(c.x - r.x) > 0.5) el.style[a.h === "l" ? "left" : "right"] = `${Math.round(a.h === "l" ? c.x : W - c.x - c.w)}px`;
    if (Math.abs(c.y - r.y) > 0.5) el.style[a.v === "t" ? "top" : "bottom"] = `${Math.round(a.v === "t" ? c.y : H - c.y - c.h)}px`;
  }
}
// Every box put in its place: after each refresh (main.js), when the map's box changes size, after a reset.
export function syncOverlays() {
  if (!wrap || !hasDoc()) return;
  addGrips();
  tipHandles();
  for (const k of Object.keys(OVERLAYS)) if (!(pend && pend.moved && pend.key === k)) applyOne(k);
  if (!fixed) bumpDefaults();
}
// ui/responsive.js: the boxes keep their slots while a phone's or an upright tablet's layout is up (no drag, no nudge,
// no remembered place applied, no "drag to move" in the hover text), and move again when the window grows.
export function setOverlaysFixed(on) {
  if (fixed === !!on) return;
  fixed = !!on;
  if (pend && pend.moved) finish(null, true);
  pend = null;
  if (wrap && hasDoc()) syncOverlays();
}
export const overlaysFixed = () => fixed;
// A box still on its stylesheet spot that a moved box now covers (the alerts showing up where the Layers box was
// put): set beside it for now, its own spot kept (it goes back once the way is clear). The Watching panel places
// itself (ui/watchlist.js).
function bumpDefaults() {
  const keys = Object.keys(P).filter((k) => !(pend && pend.moved && pend.key === k));
  if (!keys.length) return;
  const placed = keys.map(visibleEl).filter(Boolean).map(rectIn);
  if (!placed.length) return;
  const W = wrap.clientWidth, H = wrap.clientHeight, rem = remPx();
  for (const k of Object.keys(OVERLAYS)) {
    if (P[k] || k === "watchlist" || (pend && pend.moved && pend.key === k)) continue;
    const el = visibleEl(k);
    if (!el) continue;
    const r = rectIn(el);
    if (!placed.some((o) => hits(r, o))) continue;
    const c = avoidOverlap(r, otherRects(k), W, H, rem);
    if (c === r) continue;
    el.classList.add("ov-bumped");
    place(el, c);
  }
}
export const overlayPositions = () => P;
// Menu → Options → Reset overlay positions (main.js "ov-reset"), or Alt+Home on one box.
export function resetOverlays(key) {
  const changed = resetOverlayPos(P, key);
  saveOverlayPos(P);
  if (wrap) for (const k of key ? [key] : Object.keys(OVERLAYS)) applyOne(k);
  if (ctx && ctx.refresh) ctx.refresh(); // the Watching panel goes back to its spot
  return changed;
}

// The handles the boxes do not have by themselves: the minimap's grip (its canvas is for looking around) and the
// dev tools' title line.
function addGrips() {
  const mm = document.getElementById("minimap");
  if (mm && !mm.querySelector(".ov-grip")) {
    const g = document.createElement("button");
    g.className = "ov-grip";
    g.type = "button";
    g.textContent = "✥";
    g.setAttribute("aria-label", "Move the minimap: drag, or Alt+arrow keys");
    g.dataset.tip = "Drag to move the minimap over the map (its top edge drags too; Alt+arrow keys with the keyboard, Alt+Home: back to its corner)";
    mm.appendChild(g);
  }
  const dev = document.getElementById("devpanel");
  const first = dev && dev.firstElementChild;
  if (first && !first.classList.contains("ov-devhead")) first.classList.add("ov-devhead");
}

// The headers' hover text says they move too (once per header written; taken off again while the boxes are fixed).
// The keys only where there is a keyboard: main.js shows every tip through ui/hints.js devText, which drops a key in
// brackets for a finger or a pad, so one wording serves.
const MOVE_TIP = " · Drag to move it over the map (Alt+arrow keys)";
function tipHandles() {
  for (const k of Object.keys(OVERLAYS)) {
    for (const id of OVERLAYS[k].els) {
      const el = document.getElementById(id);
      if (!el || el.classList.contains("hidden")) continue;
      const hs = [...el.querySelectorAll(TIP_HANDLES)].filter((h) => h.dataset.tip && h.closest(OVERLAYS[k].head));
      if (el.matches(TIP_HANDLES) && el.dataset.tip) hs.push(el);
      for (const h of hs) {
        if (fixed) { if (h.dataset.tip.endsWith(MOVE_TIP)) h.dataset.tip = h.dataset.tip.slice(0, -MOVE_TIP.length); }
        else if (!h.dataset.tip.endsWith(MOVE_TIP)) h.dataset.tip += MOVE_TIP;
      }
    }
  }
}

// Which box a press is on, and whether it is on its handle.
function overlayAt(t) {
  if (!t || !t.closest) return null;
  for (const k of Object.keys(OVERLAYS)) {
    const def = OVERLAYS[k];
    for (const id of def.els) {
      const el = document.getElementById(id);
      if (!el || !el.contains(t)) continue;
      const head = t.closest(def.head);
      if (!head || !el.contains(head)) return null;
      const btn = t.closest(NO_DRAG);
      if (btn && el.contains(btn) && !btn.matches(DRAG_BUTTONS)) return null; // the header's own buttons: a click
      return { key: k, el };
    }
  }
  return null;
}

function onDown(e) {
  if (pend && pend.moved) finish(null, true); // a drag whose release was lost (outside the window): put back
  pend = null;
  if (fixed || e.button !== 0 || !e.isPrimary) return;
  const hit = overlayAt(e.target);
  if (!hit || !shown(hit.el)) return;
  pend = { key: hit.key, el: hit.el, id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType === "touch", moved: false };
}
function onMove(e) {
  if (!pend || e.pointerId !== pend.id) return;
  if (e.pointerType === "mouse" && e.buttons === 0) { finish(e, false); return; } // released where we did not hear it
  const dx = e.clientX - pend.x, dy = e.clientY - pend.y;
  if (!pend.moved) {
    if (!pastThreshold(dx, dy, pend.touch)) return;
    pend.moved = true;
    try { pend.el.setPointerCapture(e.pointerId); } catch { /* not capturable: the window still hears the release */ }
    pend.start = rectIn(pend.el);
    pend.others = otherRects(pend.key);
    pend.el.classList.add("ov-drag");
    document.body.classList.add("ov-dragging");
  }
  e.preventDefault();
  const W = wrap.clientWidth, H = wrap.clientHeight;
  const c = snapBox(clampBox({ x: pend.start.x + dx, y: pend.start.y + dy, w: pend.start.w, h: pend.start.h }, W, H), W, H, remPx());
  place(pend.el, c);
}
// While dragging: plain left / top in px.
function place(el, c) {
  el.style.left = `${Math.round(c.x)}px`;
  el.style.top = `${Math.round(c.y)}px`;
  el.style.right = "auto";
  el.style.bottom = "auto";
}
function finish(e, cancel) {
  if (!pend || (e && e.pointerId !== pend.id)) return;
  const d = pend;
  pend = null;
  if (!d.moved) return; // a click: left to the header's button
  d.el.classList.remove("ov-drag");
  document.body.classList.remove("ov-dragging");
  swallowClick();
  if (!cancel) {
    const W = wrap.clientWidth, H = wrap.clientHeight, rem = remPx();
    const c = dropBox(d.start, e.clientX - d.x, e.clientY - d.y, W, H, d.others, rem);
    P[d.key] = toAnchor(c, W, H, rem);
    saveOverlayPos(P);
  }
  if (!P[d.key]) clearPlace(d.el); // cancelled before it was ever moved: back on its stylesheet spot
  applyOne(d.key);
  if (d.key === "legend") applyOne("watchlist");
  if (d.key === "alerts") applyOne("guide"); // the guide sits under the alerts (ui/hudbar.js placeGuide)
  if (ctx && ctx.refresh) ctx.refresh();
}
// The click that ends a drag is not a click on the header (it would fold the box).
function swallowClick() {
  const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); window.removeEventListener("click", stop, true); };
  window.addEventListener("click", stop, true);
  setTimeout(() => window.removeEventListener("click", stop, true), 60);
}
// Alt+arrows on a focused header nudge its box, Alt+Home puts it back; Esc while dragging puts it back where it was.
function onKey(e) {
  if (pend && pend.moved && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(null, true); return; }
  if (fixed || !e.altKey || e.ctrlKey || e.metaKey) return;
  const hit = overlayAt(e.target);
  if (!hit) return;
  if (e.key === "Home") { e.preventDefault(); e.stopPropagation(); resetOverlays(hit.key); return; }
  const el = visibleEl(hit.key);
  if (!el) return;
  const W = wrap.clientWidth, H = wrap.clientHeight, rem = remPx();
  const c = nudgeBox(rectIn(el), e.key, e.shiftKey, W, H, rem);
  if (!c) return;
  e.preventDefault(); e.stopPropagation();
  P[hit.key] = toAnchor(c, W, H, rem);
  saveOverlayPos(P);
  applyOne(hit.key);
}

// main.js, once: { refresh }.
export function initOverlays(api = {}) {
  if (!hasDoc()) return;
  ctx = api;
  wrap = document.getElementById("mapwrap");
  if (!wrap) return;
  P = loadOverlayPos();
  addGrips();
  document.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", (e) => finish(e, false), true);
  window.addEventListener("pointercancel", (e) => finish(e, true), true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", syncOverlays);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => syncOverlays()).observe(wrap);
  syncOverlays();
}

// Help → Windows and panels (ui/layout.js windowsHelp adds it): what moves and how, on this device. With a mouse the
// words are a desktop's; a finger on a tablet drags the same handles (main.js shows the Help as written, so the
// keyboard lines name the keyboard).
export const OVERLAYS_HELP = `<b>Moving the boxes over the map:</b> every box has the same header bar (its icon, name, count, the fold chevron and a ✥ at the end): drag it to put Watching, Layers, the alerts or the first-week guide (by its title line) anywhere over the map so they are not in the way (the row of buttons at the bottom left shows and hides them and stays put); the dev tools move by their title, the minimap by its top edge or its ✥ grip; a folded box moves by its slim tab. A short click still folds or opens it. Near an edge or a corner a box snaps to it; dropped on another box it moves beside it when there is room. With the keyboard: Tab to a box's header and press <b>Alt+arrow keys</b> to nudge it (Shift for bigger steps), <b>Alt+Home</b> puts that box back. Boxes stay inside the map when the window, the UI size or the panels change. Their places are remembered in this browser; Options → <i>Reset overlay positions</i> puts them all back.`;
export const OVERLAYS_HELP_FIXED = `<b>The boxes over the map stay put here:</b> on a phone, or a tablet held upright, each box has a fixed slot under the strip across the top of the map and nothing drags. A place you gave a box on a bigger screen waits there for when the window grows (Options → <i>Reset overlay positions</i> forgets it).`;
export const overlaysHelp = () => (fixed ? OVERLAYS_HELP_FIXED : OVERLAYS_HELP);
