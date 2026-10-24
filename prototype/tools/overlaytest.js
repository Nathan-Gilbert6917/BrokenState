// Moving the boxes over the State Map (src/ui/overlaydrag.js): the rules (clamp inside the map, snap to edges and
// corners, a free spot beside another box, the anchors kept in rem from the nearest edges, the click-vs-drag
// threshold, Alt+arrow nudges), the stored places (read back, bad values dropped, blocked storage), and the page
// side on a small stand-in DOM: a press that barely moves stays a click, a drag moves the box and remembers it and
// eats the click that follows, header buttons never start a drag, the box is kept on a map that shrinks, a reset
// puts everything back.
// Usage: node tools/overlaytest.js
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "passed" : "failed"} ${what}`); return ok; };
const section = (t) => console.log(t);
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
globalThis.localStorage = mem();

const O = await import("../src/ui/overlaydrag.js");
const REM = 16, W = 900, H = 600;
const near = (a, b, e = 0.6) => Math.abs(a - b) <= e;

section("Rules: clamp, snap, free spot, anchors, threshold, nudge");
{
  const c = O.clampBox({ x: -50, y: 700, w: 200, h: 100 }, W, H);
  check(c.x === 0 && c.y === H - 100, "a box dragged off the map is kept on it (left and bottom edges)");
  const big = O.clampBox({ x: 30, y: 30, w: 1200, h: 100 }, W, H);
  check(big.x === 0, "a box wider than the map keeps its left edge on it");
  const s = O.snapBox({ x: 20, y: H - 100 - 25, w: 200, h: 100 }, W, H, REM);
  check(s.x === O.EDGE_REM * REM && s.y === H - 100 - O.EDGE_REM * REM, "near the bottom-left corner: snapped into it (the usual gap from both edges)");
  const free = O.snapBox({ x: 300, y: 200, w: 200, h: 100 }, W, H, REM);
  check(free.x === 300 && free.y === 200, "in the middle of the map: left where it was dropped");
  const right = O.snapBox({ x: W - 200 - 15, y: 250, w: 200, h: 100 }, W, H, REM);
  check(right.x === W - 200 - O.EDGE_REM * REM && right.y === 250, "near the right edge only: snapped to that edge, height kept");
  const other = { x: 400, y: 200, w: 200, h: 200 };
  const av = O.avoidOverlap({ x: 450, y: 250, w: 100, h: 60 }, [other], W, H, REM);
  check(!(av.x < other.x + other.w && other.x < av.x + av.w && av.y < other.y + other.h && other.y < av.y + av.h), "dropped on another box: moved clear of it");
  check(Math.hypot(av.x - 450, av.y - 250) <= 160, "… to the nearest free spot beside it");
  const full = O.avoidOverlap({ x: 10, y: 10, w: 100, h: 60 }, [{ x: 0, y: 0, w: W, h: H }], W, H, REM);
  check(full.x === 10 && full.y === 10, "no free spot anywhere: left where it was dropped");
  const clear = O.avoidOverlap({ x: 10, y: 10, w: 100, h: 60 }, [other], W, H, REM);
  check(clear.x === 10 && clear.y === 10, "not on another box: not moved");
  const drop = O.dropBox({ x: 10, y: 10, w: 200, h: 100 }, 5000, 5000, W, H, [], REM);
  check(drop.x === W - 200 - O.EDGE_REM * REM && drop.y === H - 100 - O.EDGE_REM * REM, "dragged far past the corner: ends snapped in the bottom-right corner");
  const a = O.toAnchor({ x: W - 200 - 32, y: 48, w: 200, h: 100 }, W, H, REM);
  check(a.h === "r" && a.x === 2 && a.v === "t" && a.y === 3, "the place is kept from the nearest edges, in rem (right 2rem, top 3rem)");
  const back = O.fromAnchor(a, 200, 100, W, H, REM);
  check(back.x === W - 232 && back.y === 48, "and comes back to the same spot");
  const wide = O.fromAnchor(a, 200, 100, 1400, H, REM);
  check(wide.x === 1400 - 232, "a wider map: still 2rem from its right edge (a box in a corner stays in it)");
  const tiny = O.fromAnchor({ h: "l", x: 50, v: "b", y: 50 }, 200, 100, 400, 300, REM);
  check(tiny.x === 200 && tiny.y === 0, "a place too far out for a small map: clamped onto it");
  const scaled = O.fromAnchor({ h: "l", x: 10, v: "t", y: 5 }, 200, 100, W, H, 24);
  check(scaled.x === 240 && scaled.y === 120, "a bigger UI size moves it with the rem");
  check(!O.pastThreshold(3, 2) && O.pastThreshold(5, 0) && O.pastThreshold(4, 4), "mouse: under 5 px is a click, 5 px or more a drag");
  check(!O.pastThreshold(8, 0, true) && O.pastThreshold(10, 0, true), "touch: a little more slack (10 px)");
  const n = O.nudgeBox({ x: 100, y: 100, w: 200, h: 100 }, "ArrowRight", false, W, H, REM);
  const nf = O.nudgeBox({ x: 100, y: 100, w: 200, h: 100 }, "ArrowUp", true, W, H, REM);
  check(n.x === 116 && n.y === 100 && nf.y === 36, "Alt+arrow nudges by 1rem, with Shift by 4rem");
  check(O.nudgeBox({ x: 0, y: 0, w: 200, h: 100 }, "ArrowLeft", false, W, H, REM).x === 0, "a nudge stops at the map's edge");
  check(O.nudgeBox({ x: 0, y: 0, w: 200, h: 100 }, "KeyA", false, W, H, REM) === null, "other keys: no nudge");
}

section("Stored places: read back, bad values dropped, blocked storage");
{
  const st = mem();
  const P = { watchlist: { h: "r", x: 2, v: "b", y: 3.5 }, minimap: { h: "l", x: 0.6, v: "t", y: 0.6 } };
  check(O.saveOverlayPos(P, st) && JSON.stringify(O.loadOverlayPos(st)) === JSON.stringify(P), "saved and read back the same");
  st.setItem(O.OVERLAY_KEY, JSON.stringify({ watchlist: { h: "x", x: 1, v: "t", y: 1 }, legend: { h: "l", x: "a", v: "t", y: 1 }, bogus: { h: "l", x: 1, v: "t", y: 1 }, alerts: { h: "r", x: -4, v: "b", y: 1e9 } }));
  const r = O.loadOverlayPos(st);
  check(!r.watchlist && !r.legend && !r.bogus && r.alerts && r.alerts.x === 0 && r.alerts.y === 500, "bad sides, non-numbers and unknown boxes dropped; out-of-range numbers clamped");
  st.setItem(O.OVERLAY_KEY, "{broken");
  check(Object.keys(O.loadOverlayPos(st)).length === 0, "an unreadable record: every box where it starts");
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
  check(Object.keys(O.loadOverlayPos(blocked)).length === 0 && O.saveOverlayPos(P, blocked) === false, "blocked storage: nothing thrown, this session only");
  const Q = { ...P };
  check(O.resetOverlayPos(Q, "watchlist") && !Q.watchlist && Q.minimap, "reset one box");
  check(O.resetOverlayPos(Q) && !Object.keys(Q).length && !O.resetOverlayPos(Q), "reset all (again: nothing to do)");
  O.saveOverlayPos({}, st);
  check(st.getItem(O.OVERLAY_KEY) === null, "nothing moved: the record is removed");
}

// ---------- a small stand-in DOM ----------
// Elements are placed by their inline left / right / top / bottom (px) inside a W × H map, or at their stylesheet
// spot (css) when there is none. Selectors: comma lists of .class, #id or a tag name.
class El {
  constructor(tag, opts = {}) {
    this.tagName = tag.toUpperCase(); this.id = opts.id || ""; this.w = opts.w || 0; this.h = opts.h || 0; this.css = opts.css || { x: 0, y: 0 };
    this.style = {}; this.dataset = {}; this.children = []; this.parent = null; this.attrs = {};
    this._cls = new Set((opts.cls || "").split(" ").filter(Boolean));
    const self = this;
    this.classList = { add: (c) => self._cls.add(c), remove: (...cs) => cs.forEach((c) => self._cls.delete(c)), contains: (c) => self._cls.has(c), toggle: (c, v) => (v ?? !self._cls.has(c)) ? self._cls.add(c) : self._cls.delete(c) };
  }
  set className(v) { this._cls = new Set(String(v).split(" ").filter(Boolean)); }
  get className() { return [...this._cls].join(" "); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  appendChild(c) { c.parent = this; this.children.push(c); if (c.id) ids.set(c.id, c); return c; }
  get firstElementChild() { return this.children[0] || null; }
  get offsetWidth() { return this._cls.has("hidden") ? 0 : this.w; }
  get offsetHeight() { return this._cls.has("hidden") ? 0 : this.h; }
  get clientWidth() { return this.w; }
  get clientHeight() { return this.h; }
  get clientLeft() { return 0; }
  get clientTop() { return 0; }
  matches(sel) {
    return sel.split(",").map((s) => s.trim()).some((s) => (s[0] === "." ? this._cls.has(s.slice(1)) : s[0] === "#" ? this.id === s.slice(1) : this.tagName === s.toUpperCase()));
  }
  closest(sel) { for (let e = this; e; e = e.parent) if (e.matches(sel)) return e; return null; }
  contains(t) { for (let e = t; e; e = e.parent) if (e === this) return true; return false; }
  querySelectorAll(sel) { const out = []; const walk = (e) => { for (const c of e.children) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getBoundingClientRect() {
    if (this === wrapEl) return { left: 100, top: 50, width: this.w, height: this.h };
    const px = (v) => (v && v !== "auto" ? parseFloat(v) : null);
    const box = this.parent && this.parent !== wrapEl ? this.parent.getBoundingClientRect() : null;
    if (box) return { left: box.left + this.css.x, top: box.top + this.css.y, width: this.offsetWidth, height: this.offsetHeight };
    const s = this.style;
    const x = px(s.left) ?? (px(s.right) != null ? wrapEl.w - px(s.right) - this.w : this.css.x);
    const y = px(s.top) ?? (px(s.bottom) != null ? wrapEl.h - px(s.bottom) - this.h : this.css.y);
    return { left: 100 + x, top: 50 + y, width: this.offsetWidth, height: this.offsetHeight };
  }
}
const ids = new Map();
const listeners = [];
const on = (where) => (type, fn, cap) => listeners.push({ where, type, fn, cap: !!cap });
const off = (where) => (type, fn) => { const i = listeners.findIndex((l) => l.where === where && l.type === type && l.fn === fn); if (i >= 0) listeners.splice(i, 1); };
const fire = (type, ev) => { for (const l of [...listeners]) if (l.type === type) l.fn(ev); return ev; };
const wrapEl = new El("main", { id: "mapwrap", w: W, h: H });
ids.set("mapwrap", wrapEl);
const body = new El("body");
globalThis.document = {
  getElementById: (id) => ids.get(id) || null, createElement: (t) => new El(t),
  documentElement: { fontSize: "16px" }, body, addEventListener: on("doc"), removeEventListener: off("doc"),
};
globalThis.window = { addEventListener: on("win"), removeEventListener: off("win"), innerWidth: 1200, innerHeight: 800 };
globalThis.getComputedStyle = () => ({ fontSize: "16px" });
// The boxes at their stylesheet spots: Watching top left, Layers bottom left, alerts top right, minimap bottom right.
const box = (id, w, h, css, head) => { const b = wrapEl.appendChild(new El("div", { id, w, h, css })); if (head) head(b); return b; };
const orders = box("watchlist", 256, 110, { x: 10, y: 10 }, (b) => { // the Watching panel (the running orders are a tab of the left panel now)
  const hd = b.appendChild(new El("div", { cls: "fp-head", w: 256, h: 28, css: { x: 0, y: 0 } }));
  hd.appendChild(new El("button", { cls: "fp-toggle", w: 200, h: 26, css: { x: 2, y: 1 } }));
  const ex = hd.appendChild(new El("span", { cls: "fp-extra", w: 40, h: 26, css: { x: 210, y: 1 } }));
  ex.appendChild(new El("button", { cls: "mini", w: 30, h: 22, css: { x: 0, y: 0 } }));
  b.appendChild(new El("div", { cls: "wl-row", w: 250, h: 70, css: { x: 3, y: 32 } }));
});
box("legend", 180, 300, { x: 10, y: H - 310 }, (b) => b.appendChild(new El("div", { cls: "fp-head", w: 180, h: 28, css: { x: 0, y: 0 } })));
box("alerts", 368, 90, { x: W - 378, y: 10 }, (b) => b.appendChild(new El("div", { cls: "fp-head", w: 368, h: 28, css: { x: 0, y: 0 } }))); // the same header bar as the other boxes (ui/layout.js alertsFoldButton)
const mm = box("minimap", 240, 136, { x: W - 250, y: H - 146 });
box("mm-show", 90, 24, { x: W - 100, y: H - 34 }).classList.add("hidden");
let refreshed = 0;
O.initOverlays({ refresh: () => { refreshed++; } });
const pe = (target, x, y, extra = {}) => ({ target, clientX: x, clientY: y, button: 0, isPrimary: true, pointerId: 1, pointerType: "mouse", prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra });
const rel = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - 100, y: r.top - 50, w: r.width, h: r.height }; };
const toggle = orders.querySelector(".fp-toggle");
const press = (target, dx, dy, extra = {}) => {
  const r = target.getBoundingClientRect(), x = r.left + 5, y = r.top + 5;
  fire("pointerdown", pe(target, x, y, extra));
  for (let i = 1; i <= 4; i++) fire("pointermove", pe(target, x + (dx * i) / 4, y + (dy * i) / 4, extra));
  fire("pointerup", pe(target, x + dx, y + dy, extra));
  return fire("click", pe(target, x + dx, y + dy));
};

section("On the page: click or drag, remembered, kept on the map, reset");
{
  check(!!mm.querySelector(".ov-grip"), "the minimap gets its ✥ grip");
  const c1 = press(toggle, 3, 1);
  check(!c1.stopped && !O.overlayPositions().watchlist && !orders.classList.contains("ov-placed"), "a press that moves 3 px is a click: it reaches the fold button, nothing moves or is stored");
  const c2 = press(toggle, 300, 200);
  const p = O.overlayPositions().watchlist;
  check(c2.stopped && c2.prevented, "a drag past the threshold eats the click that ends it (the box does not fold)");
  check(p && orders.classList.contains("ov-placed"), "the box is moved and its place remembered");
  const r = rel(orders);
  check(near(r.x, 310) && near(r.y, 210), `it is where it was dropped (${Math.round(r.x)}, ${Math.round(r.y)})`);
  check(!!localStorage.getItem(O.OVERLAY_KEY) && O.loadOverlayPos().watchlist.x === p.x, "the place is in the browser's storage (it survives a reload)");
  check(refreshed > 0, "the page is redrawn after a drop (the Watching panel follows)");
  const c3 = press(orders.querySelector(".mini"), 200, 0);
  check(!c3.stopped && near(rel(orders).x, 310), "a drag that starts on a header's own button (? ✕) does not move the box");
  const c4 = press(orders.querySelector(".wl-row"), 200, 0);
  check(!c4.stopped && near(rel(orders).x, 310), "a drag on the box's body (its rows) does not move it");
  press(toggle, 5000, 5000);
  const corner = rel(orders);
  check(corner.x + corner.w <= W && corner.y + corner.h <= H, "dragged far off the map: kept on it");
  const mmR = rel(mm);
  const hit = corner.x < mmR.x + mmR.w && mmR.x < corner.x + corner.w && corner.y < mmR.y + mmR.h && mmR.y < corner.y + corner.h;
  check(!hit, "dropped on the minimap's corner: moved beside it instead of over it");
  // Touch: a 7 px wobble is still a tap.
  const before = rel(orders);
  const c5 = press(toggle, 7, 0, { pointerType: "touch" });
  check(!c5.stopped && near(rel(orders).x, before.x), "a finger that wobbles 7 px still taps");
  // The keyboard.
  const k = (key, more = {}) => fire("keydown", { key, target: toggle, altKey: true, shiftKey: false, ctrlKey: false, metaKey: false, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...more });
  const b0 = rel(orders);
  const ke = k("ArrowLeft");
  check(ke.prevented && near(rel(orders).x, b0.x - 16), "Alt+Left on the focused header nudges the box 1rem left");
  k("ArrowUp", { shiftKey: true });
  check(near(rel(orders).y, b0.y - 64), "Alt+Shift+Up: 4rem up");
  const plain = fire("keydown", { key: "ArrowLeft", target: toggle, altKey: false, preventDefault() { this.prevented = true; }, stopPropagation() {} });
  check(!plain.prevented, "the arrow keys without Alt are left to the game");
  // The map shrinks (window, UI size, a side panel opened): kept on it; grows back: the remembered place again.
  press(mm.querySelector(".ov-grip"), -600, -400);
  const mmPlaced = rel(mm);
  wrapEl.w = 500; wrapEl.h = 350;
  O.syncOverlays();
  const sm = rel(orders), smm = rel(mm);
  check(sm.x >= 0 && sm.y >= 0 && sm.x + sm.w <= 500 && sm.y + sm.h <= 350 && smm.x + smm.w <= 500 && smm.y + smm.h <= 350, "a smaller map: every moved box kept inside it");
  wrapEl.w = W; wrapEl.h = H;
  O.syncOverlays();
  check(near(rel(mm).x, mmPlaced.x) && near(rel(mm).y, mmPlaced.y), "the map back to its size: the box back where it was put");
  // Alt+Home on one box, then the menu's reset for all.
  fire("keydown", { key: "Home", target: mm.querySelector(".ov-grip"), altKey: true, preventDefault() {}, stopPropagation() {} });
  check(!O.overlayPositions().minimap && !mm.classList.contains("ov-placed") && O.overlayPositions().watchlist, "Alt+Home puts that one box back");
  press(mm.querySelector(".ov-grip"), -300, -100);
  O.resetOverlays();
  check(!Object.keys(O.overlayPositions()).length && localStorage.getItem(O.OVERLAY_KEY) === null, "Reset overlay positions: nothing remembered");
  check(!orders.classList.contains("ov-placed") && !orders.style.left && !orders.style.top && !orders.style.maxHeight && !mm.style.left && !mm.style.right, "… and every box back on its stylesheet spot");
  // Esc while dragging: back where it was.
  const r0 = rel(orders);
  const t = toggle.getBoundingClientRect();
  fire("pointerdown", pe(toggle, t.left + 5, t.top + 5));
  fire("pointermove", pe(toggle, t.left + 205, t.top + 105));
  fire("keydown", { key: "Escape", target: toggle, altKey: false, preventDefault() {}, stopPropagation() {} });
  fire("pointerup", pe(toggle, t.left + 205, t.top + 105));
  check(near(rel(orders).x, r0.x) && !O.overlayPositions().watchlist, "Esc during a drag: the box goes back, nothing stored");
}

section("A box left where it starts is set beside a moved box that covers it");
{
  const legend = document.getElementById("legend"), alerts = document.getElementById("alerts");
  alerts.classList.add("hidden"); // no alerts while the Layers box goes to the top-right corner, the alerts' spot
  press(legend.querySelector(".fp-head"), 2000, -2000);
  alerts.classList.remove("hidden"); // then an alert comes in
  O.syncOverlays();
  const l = rel(legend), a = rel(alerts);
  const overlap = a.x < l.x + l.w && l.x < a.x + a.w && a.y < l.y + l.h && l.y < a.y + a.h;
  check(l.x + l.w > W - 20 && l.y < 20, "the Layers box is in the top-right corner");
  check(!overlap && alerts.classList.contains("ov-bumped") && !O.overlayPositions().alerts, "the alerts move beside it for now (not remembered)");
  O.resetOverlays();
  O.syncOverlays();
  check(!alerts.classList.contains("ov-bumped") && !alerts.style.left && near(rel(alerts).x, W - 378), "after the reset the alerts are back on their own spot");
}

console.log(`${fail ? "failed" : "passed"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
