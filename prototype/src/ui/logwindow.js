// The battle log as a small window over the raid map (the user's request 2026-10-18): shown or hidden by the 📜 Log
// button in the top strip (ui/combat.js renderRaidTop; the key bview.log), minimized to its title bar, dragged by that
// bar to anywhere over the map and resized by its corner grip, with the mouse, a finger or a pen (pointer events).
// - The frame (#cblogwin in index.html) is fixed markup: its body (#cblogbody) and footer (#cblogfoot) are rewritten by
//   main.js (setHTML) when the log changes, so a redraw never moves the window or loses a drag.
// - Where it is and how big is kept per machine (localStorage LOGWIN_KEY, failures ignored) as the distance from the
//   map's right and top edges in rem, so a window put by the controls stays there when the map changes size and grows
//   with the UI size. It is always clamped inside the map's box (place(), each sync).
// - The rules (toggle, minimize, clamp, drag and resize arithmetic) are plain functions on the LOGWIN object
//   (tools/raidscreentest.js runs them without a browser); initLogWindow / syncLogWindow put them on the page.
export const LOGWIN_KEY = "bs.battle.logwin";
export const LOGWIN_MIN = { w: 14, h: 6 }; // rem: the smallest a drag may make it
export const LOGWIN_DEFAULT = { open: true, min: false, right: 0.5, top: 3.4, w: 22, h: 11 }; // right / top / w / h in rem
const DRAG_PX = 4; // a press that moves less than this is a click (the title's buttons work as before)

export const LOGWIN = { ...LOGWIN_DEFAULT };
export function loadLogWin() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LOGWIN_KEY) : null;
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v === "object") for (const k of Object.keys(LOGWIN_DEFAULT)) if (v[k] != null && typeof v[k] === typeof LOGWIN_DEFAULT[k] && (typeof v[k] !== "number" || Number.isFinite(v[k]))) LOGWIN[k] = v[k];
  } catch { /* private mode or a bad value: the defaults */ }
  return LOGWIN;
}
export function saveLogWin() {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(LOGWIN_KEY, JSON.stringify(LOGWIN)); } catch { /* storage blocked: this session only */ }
}
export function resetLogWin() { Object.assign(LOGWIN, LOGWIN_DEFAULT); saveLogWin(); }

// The buttons (data-action="cb-log"): toggle (the top strip's 📜 Log), min (the title's – / +), close (×), show.
export function logAction(v) {
  if (v === "toggle") { LOGWIN.open = !LOGWIN.open; if (LOGWIN.open) LOGWIN.min = false; }
  else if (v === "show") { LOGWIN.open = true; LOGWIN.min = false; }
  else if (v === "close") LOGWIN.open = false;
  else if (v === "min") LOGWIN.min = !LOGWIN.min;
  else if (v === "reset") Object.assign(LOGWIN, LOGWIN_DEFAULT);
  else return false;
  saveLogWin();
  return true;
}

// Where the window sits in the map's box, in CSS px: { x, y, w, h }, clamped so all of it stays inside (a minimized
// window keeps only its title bar's height). box: { w, h } the map's size in px; rem: px a rem; headH: the title bar in px.
export function place(box, rem, headH = 28, L = LOGWIN) {
  const w = Math.max(LOGWIN_MIN.w * rem, Math.min(L.w * rem, box.w));
  const h = L.min ? headH : Math.max(LOGWIN_MIN.h * rem, Math.min(L.h * rem, box.h));
  let x = box.w - L.right * rem - w, y = L.top * rem;
  x = Math.max(0, Math.min(x, box.w - w));
  y = Math.max(0, Math.min(y, Math.max(0, box.h - h)));
  return { x, y, w, h };
}
// A drag of the title bar by (dx, dy) px from where it was pressed (from: the place at the press): the new anchors.
export function dragTo(from, dx, dy, box, rem, L = LOGWIN) {
  const x = Math.max(0, Math.min(from.x + dx, box.w - from.w));
  const y = Math.max(0, Math.min(from.y + dy, Math.max(0, box.h - from.h)));
  L.right = (box.w - x - from.w) / rem;
  L.top = y / rem;
  return L;
}
// A drag of the corner grip: the new size (the left and top edges stay put, so the right anchor moves with the width).
export function resizeTo(from, dx, dy, box, rem, L = LOGWIN) {
  const w = Math.max(LOGWIN_MIN.w * rem, Math.min(from.w + dx, box.w - from.x));
  const h = Math.max(LOGWIN_MIN.h * rem, Math.min(from.h + dy, box.h - from.y));
  L.w = w / rem;
  L.h = h / rem;
  L.right = (box.w - from.x - w) / rem;
  return L;
}

// ---------- on the page ----------
let ctx = null; // { el, map, refresh }
let drag = null; // { kind: "move" | "size", from: place, x0, y0, moved }
const remPx = () => (typeof getComputedStyle === "function" && typeof document !== "undefined" ? parseFloat(getComputedStyle(document.documentElement).fontSize) : 16) || 16;
const boxOf = () => { const m = ctx && ctx.map; return m ? { w: m.clientWidth || 0, h: m.clientHeight || 0 } : { w: 0, h: 0 }; };
const headOf = () => { const h = ctx && ctx.el && ctx.el.querySelector(".lw-head"); return (h && h.offsetHeight) || 28; };

// Shown or hidden, minimized, and where: applied every refresh of the raid screen (cheap: a few style writes).
export function syncLogWindow(on) {
  const el = ctx && ctx.el;
  if (!el) return;
  const show = !!on && LOGWIN.open;
  el.classList.toggle("hidden", !show);
  if (!show) return;
  el.classList.toggle("min", LOGWIN.min);
  const box = boxOf();
  if (!box.w || !box.h) return;
  const p = place(box, remPx(), headOf());
  el.style.left = `${Math.round(p.x)}px`;
  el.style.top = `${Math.round(p.y)}px`;
  el.style.width = `${Math.round(p.w)}px`;
  el.style.height = LOGWIN.min ? "" : `${Math.round(p.h)}px`;
}

function onDown(e) {
  if (!ctx || !ctx.el || ctx.el.classList.contains("hidden") || e.button !== 0) return;
  const grip = e.target.closest && e.target.closest(".lw-grip");
  const head = !grip && e.target.closest && e.target.closest(".lw-head");
  if (!grip && !head) return;
  if (!ctx.el.contains(e.target)) return;
  if (head && e.target.closest("button")) return; // the title's buttons: their click
  if (grip && LOGWIN.min) return;
  const r = ctx.el.getBoundingClientRect(), m = ctx.map.getBoundingClientRect();
  drag = { kind: grip ? "size" : "move", from: { x: r.left - m.left, y: r.top - m.top, w: r.width, h: r.height }, x0: e.clientX, y0: e.clientY, moved: false, id: e.pointerId };
  try { ctx.el.setPointerCapture(e.pointerId); } catch { /* not capturable: the window still hears the release */ }
  e.preventDefault();
  e.stopPropagation();
}
function onMove(e) {
  if (!drag || (drag.id != null && e.pointerId !== drag.id)) return;
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.moved && Math.abs(dx) < DRAG_PX && Math.abs(dy) < DRAG_PX) return;
  drag.moved = true;
  if (typeof document !== "undefined" && document.body) document.body.classList.add("lw-dragging");
  const box = boxOf(), rem = remPx();
  if (drag.kind === "move") dragTo(drag.from, dx, dy, box, rem);
  else resizeTo(drag.from, dx, dy, box, rem);
  syncLogWindow(true);
  e.preventDefault();
}
function onUp(e) {
  if (!drag || (drag.id != null && e.pointerId !== drag.id)) return;
  const moved = drag.moved;
  drag = null;
  if (typeof document !== "undefined" && document.body) document.body.classList.remove("lw-dragging");
  if (moved) { saveLogWin(); if (ctx.refresh) ctx.refresh(); }
}

// el: #cblogwin; map: #cbmapwrap (the box it stays inside); refresh(): main.js redraws.
export function initLogWindow(el, map, { refresh } = {}) {
  if (!el || !map || typeof window === "undefined") return;
  loadLogWin();
  ctx = { el, map, refresh };
  el.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  // A drag on the title or the grip must not click the map or start a pan under the window.
  for (const ev of ["mousedown", "wheel", "contextmenu"]) el.addEventListener(ev, (e) => e.stopPropagation());
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => syncLogWindow(!el.classList.contains("hidden"))).observe(map);
}
