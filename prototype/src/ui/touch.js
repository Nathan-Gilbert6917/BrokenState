// Touch input (phones, tablets): what a finger does where the game was built for a mouse. Nothing here runs for a
// mouse: every path starts from a pointer whose pointerType is not "mouse", so a desktop plays exactly as before.
//   initTouch({ showTip, hideTip, tipShown, skip })   main.js, once: the page-wide long press (below)
//   touchGestures(el, { down, tap, hold, pan, pinch, end })   a canvas of its own (the State Map, the battle map)
//   touchRecent(ms)    a finger was on the screen just now: the mouse events a tap is followed by are not a mouse
//   swallowTap()       the gesture was handled: the touchend that ends it is cancelled (no mouse events, no click)
// The page-wide long press (~500 ms without moving) is a right-click: a contextmenu goes to the element under the
// finger with its clientX / clientY, so main.js's contextmenu listeners (the item menu, the Work tab's [data-rc]) run
// the same code as for the mouse. Android's own contextmenu for a long press, and the click after it, are swallowed so
// nothing fires twice. A long press nothing takes as a menu shows the element's data-tip; the next touch hides it.

export const HOLD_MS = 500; // how long a press is held before it is a right-click
const SLOP = 10;            // CSS px a finger may wander and still be a tap or a hold (fingers are not mice)
let lastTouch = -1e9;       // performance.now() of the last finger down or up
let eatEnd = false;         // the next touchend is cancelled (swallowTap)
let eatUntil = 0;           // until then a click or a mouse press is the tail of a long press (a backup for touchend)
let press = null;           // the page-wide long press under way: { id, x, y, target, timer, fired }
let opts = {};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const isTouch = (e) => !!e.pointerType && e.pointerType !== "mouse";
const mark = () => { lastTouch = now(); };
export const touchRecent = (ms = 800) => now() - lastTouch < ms;
export function swallowTap() { eatEnd = true; eatUntil = now() + 600; }
// A finger move may be queued behind a slow frame when the hold timer comes due: the timer waits for it (Chromium).
const inputWaiting = () => { try { const s = /** @type {any} */ (navigator).scheduling; return !!(s && s.isInputPending && s.isInputPending({ includeContinuous: true })); } catch { return false; } };
const buzz = () => { try { if (navigator.vibrate) navigator.vibrate(12); } catch { /* not allowed here: no buzz */ } };

// ---------- a canvas of its own ----------
// One finger: a tap (down and up without moving), a hold (still for HOLD_MS) or a drag (pan(dx, dy) as it moves).
// Two: pinch(factor, midX, midY) and pan with the midpoint; the gesture is then neither a tap nor a hold, and the
// finger left behind pans on without a jump. Points are clientX / clientY. Mouse pointers are left to the mouse code;
// the touches are cancelled so the browser neither scrolls, zooms nor sends the mouse events a tap would.
export function touchGestures(el, h) {
  if (!el || !el.addEventListener) return;
  const pts = new Map(); // pointerId -> { x, y }
  let g = null;          // { x0, y0, moved, multi, held, timer, mid, dist }
  const midDist = () => {
    const [a, b] = [...pts.values()];
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  };
  const stopHold = () => { if (g && g.timer) { clearTimeout(g.timer); g.timer = 0; } };
  el.addEventListener("pointerdown", (e) => {
    if (!isTouch(e)) return;
    mark();
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* the window still hears it */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      g = { x0: e.clientX, y0: e.clientY, moved: false, multi: false, held: false, timer: 0, mid: null, dist: 0 };
      const due = () => {
        if (!g) return;
        if (inputWaiting()) { g.timer = setTimeout(due, 16); return; }
        g.timer = 0;
        if (g.moved || g.multi || pts.size !== 1) return;
        g.held = true;
        buzz();
        if (h.hold) h.hold(g.x0, g.y0);
      };
      g.timer = setTimeout(due, HOLD_MS);
      if (h.down) h.down(e.clientX, e.clientY);
    } else if (g && pts.size === 2) {
      stopHold();
      g.multi = true;
      const m = midDist();
      g.mid = { x: m.mx, y: m.my }; g.dist = m.d;
    }
  });
  el.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId);
    if (!p || !g) return;
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size >= 2) {
      const m = midDist();
      if (g.mid && h.pan) h.pan(m.mx - g.mid.x, m.my - g.mid.y);
      if (g.dist && h.pinch) h.pinch(m.d / g.dist, m.mx, m.my);
      g.mid = { x: m.mx, y: m.my }; g.dist = m.d;
      return;
    }
    if (g.held) return; // a hold is a right-click: the finger lifting after it does not drag
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > SLOP) { g.moved = true; stopHold(); }
    if (g.moved && h.pan) h.pan(e.clientX - px, e.clientY - py);
  });
  const up = (e, cancel) => {
    if (!pts.has(e.pointerId)) return;
    mark();
    pts.delete(e.pointerId);
    if (!g) return;
    if (pts.size === 1) { g.mid = null; g.dist = 0; return; } // one finger left: it pans on from where it is
    if (pts.size) return;
    stopHold();
    const tap = !cancel && !g.moved && !g.multi && !g.held;
    const done = g;
    g = null;
    if (tap && h.tap) h.tap(e.clientX, e.clientY);
    if (h.end) h.end(done);
  };
  el.addEventListener("pointerup", (e) => up(e, false));
  el.addEventListener("pointercancel", (e) => up(e, true));
  // iOS sends a tap's mouse events and a click from the touch events: cancelled here, they never come. Android's long
  // press menu goes with them.
  el.addEventListener("touchstart", (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  el.addEventListener("touchend", (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
}

// ---------- the page-wide long press ----------
const TYPING = "input, textarea, select, [contenteditable]"; // the browser's own long press (select, paste)
function cancelPress() {
  if (press && press.timer) clearTimeout(press.timer);
  press = null;
}
function firePress() {
  const p = press;
  if (!p) return;
  if (inputWaiting() && !p.fired) { p.timer = setTimeout(firePress, 16); return; }
  p.timer = 0;
  p.fired = true;
  const t = p.target && p.target.isConnected ? p.target : document.elementFromPoint(p.x, p.y);
  if (!t) return;
  // The same path as a right-click: main.js's listeners take it (and cancel it) when it opens a menu.
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y, button: 2, buttons: 2, view: window });
  const taken = !t.dispatchEvent(ev);
  const tipEl = !taken && t.closest ? t.closest("[data-tip]") : null;
  if (tipEl && tipEl.dataset.tip && opts.showTip) { opts.showTip(tipEl, p.x, p.y); buzz(); }
  else if (taken) buzz();
}
function onDown(e) {
  if (!isTouch(e)) return;
  mark();
  eatUntil = 0; // a new touch: the clicks the last one swallowed have been and gone, this one's are its own
  if (opts.tipShown && opts.tipShown() && opts.hideTip) opts.hideTip(); // a touch anywhere puts a held tip away
  cancelPress();
  const t = /** @type {Element} */ (e.target);
  if (!e.isPrimary || !t || !t.closest || t.closest(TYPING) || (opts.skip && t.closest(opts.skip))) return;
  press = { id: e.pointerId, x: e.clientX, y: e.clientY, target: t, timer: 0, fired: false };
  press.timer = setTimeout(firePress, HOLD_MS);
}
function onMove(e) {
  if (!press || e.pointerId !== press.id || press.fired) return;
  if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) cancelPress();
}
function onUp(e) {
  if (!isTouch(e)) return;
  mark();
  if (!press || e.pointerId !== press.id) return;
  if (press.fired) swallowTap(); // the click a long press would end with
  cancelPress();
}
// A contextmenu the browser makes from a finger (Android's long press; a pen's barrel button) is not the mouse's:
// it is stopped before main.js hears it, and ours goes instead (once per press).
function onNativeMenu(e) {
  if (!e.isTrusted) return;
  const t = /** @type {Element} */ (e.target);
  if (t && t.closest && t.closest(TYPING)) return; // a text box's own menu (paste)
  const pt = e.pointerType;
  if (!(pt === "touch" || pt === "pen" || (!pt && (press || touchRecent())))) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  // Android's long press can come before our timer, and on a draggable item a drag (pointercancel) right after it.
  if (press && !press.fired) { clearTimeout(press.timer); firePress(); }
}
function eat(e) {
  if (now() > eatUntil || !touchRecent(1000)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.type === "click") eatUntil = 0;
}

// main.js, once. showTip(el, x, y): the element's data-tip at that point; hideTip(); tipShown(): is one up;
// skip: a selector for the elements with gestures of their own (touchGestures).
export function initTouch(o = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  opts = o;
  document.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", (e) => { if (press && e.pointerId === press.id) cancelPress(); }, true);
  window.addEventListener("contextmenu", onNativeMenu, true);
  window.addEventListener("touchend", (e) => { if (eatEnd) { eatEnd = false; if (e.cancelable) e.preventDefault(); } }, { capture: true, passive: false });
  window.addEventListener("touchstart", () => { eatEnd = false; }, { capture: true, passive: true });
  for (const k of ["click", "mousedown", "mouseup"]) window.addEventListener(k, eat, true);
  // A finger that scrolls a panel ends in pointercancel (above); a scroll event is no sign, as the log scrolls itself.
}
