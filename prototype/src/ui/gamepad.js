// @ts-check
// Game controllers: an Xbox pad (or any pad the browser gives the "standard" mapping: Chrome and Edge on Windows, the
// desktop app's Chromium, Chrome on Android, Safari on iOS and iPadOS, all of which report an Xbox pad that way). The
// player plays from a sofa with the phone on a stand out of reach, so everything has to work from the pad alone.
//
// Nothing happens without a pad: no listener but gamepadconnected / gamepaddisconnected and a cheap look for one now
// and then, no DOM, no frame loop. With one connected, its own requestAnimationFrame loop reads navigator.getGamepads()
// (every pad is a snapshot to be read again each frame: no events for buttons), and only while a pad is connected.
// iOS only shows a pad to the page after a button is pressed with the page in front, and Chrome only after a press
// too: gamepadconnected comes then, and the lazy look (start, focus, a tab shown again, every couple of seconds while
// none is known) catches one the event missed.
// Input is ignored while the page is hidden or the window is not focused (the pad is shared with the rest of the
// machine: a press meant for another window must not move a team), and a button already down when the window comes
// back is not a press.
//
// Every button press, or a stick past its dead zone, makes the input mode "pad" (ui/inputmode.js setInputMode): the
// cursors, the focus ring and the button legend are drawn only in that mode, and the mouse moved or a key pressed
// takes it back (inputmode.js), so a desktop played with the mouse never sees any of it.
//
// ---------- the API (for the map and battle layers in main.js, and the menus and windows that build on it) ----------
//   claimPad(id, { on, frame, legend, dock, when, transient }) → release()
//       Pushes a layer on the stack. The top layer whose when() holds (default: always) gets the events; layers under
//       it get nothing, unless on() returns false (exactly false): then the event goes on to the next layer down.
//       on(ev): ev = { name, type, dx, dy, value, long }
//         name  "A" | "B" | "X" | "Y" | "LB" | "RB" | "LT" | "RT" | "View" | "Menu" | "LS" | "RS" | "Home"
//               | "Up" | "Down" | "Left" | "Right"
//         type  "down" (pressed), "repeat" (held: after PAD.delay ms, then every PAD.every ms; the directions and the
//               triggers only), "hold" (held PAD.hold ms, once; every button), "up" (let go; long: the hold fired)
//         dx dy the direction as −1 / 0 / 1 each (eight ways; the directions only): the D-pad, else the left stick.
//               name is its main axis (the D-pad's vertical wins a diagonal), for a list that only goes one way.
//         value a trigger's or a stick's travel (0–1)
//       frame(dt, axes): each frame, for the top layer only, while the mode is "pad": continuous input (the right
//               stick, the triggers held). dt in seconds.
//       legend(): the button legend for the layer, [[button, label], ...] (button: a name above, or "LB RB", "LT RT"…);
//               drawn as a strip at the bottom only in pad mode. dock(): the element to put the strip in (default body).
//       transient: the layer is dropped from the stack as soon as when() stops holding (a list that closed).
//   onPad(fn) → off(): sees every event first (whatever layer takes it); for tools and hints, never to act on.
//   padAxes(): { lx, ly, rx, ry, lt, rt }: the sticks with the radial dead zone taken out (0 inside it, rising from
//               0 at its edge to 1), the triggers 0–1.
//   padHeld(name): is it down now.  padConnected(): a pad is there.  padGlyph(name): the button as HTML (pad.css).
//   onPadFrame(fn) → off(): fn(top) every frame while a pad is connected (top: the layer taking the pad, or null),
//               whatever the mode; ui/padnav.js draws or hides its ring by it.
// The windows, menus and panels (their focus ring, the tile menu, the orders bar) are ui/padnav.js, a layer on this.
//   PAD: the tunables (dead zone, repeat timing, trigger threshold, hold time).
import { setInputMode, inputMode, homeMode } from "./inputmode.js";

export const PAD = { dead: 0.25, delay: 380, every: 110, trigger: 0.5, triggerOff: 0.3, hold: 550, look: 2000 };
// The standard mapping's buttons, by index (w3c.github.io/gamepad/#remapping); 12–15 are the D-pad.
const BTN = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "LS", "RS", "Up", "Down", "Left", "Right", "Home"];
const DIRS = new Set(["Up", "Down", "Left", "Right"]);
const REPEATS = new Set(["LT", "RT"]); // held triggers repeat (a zoom step at a time where the view has steps)

const layers = [];   // the stack, bottom first: { id, on, frame, legend, dock, when, transient }
const watchers = new Set();
let known = false;   // a pad is connected
let raf = 0, lastT = 0, lookTimer = 0;
const mute = new Array(BTN.length).fill(false); // pressed while the page was away: no events until let go
const down = new Array(BTN.length).fill(false);
const since = new Array(BTN.length).fill(0);
const held = new Array(BTN.length).fill(false); // the hold event was sent for this press
const nextRep = new Array(BTN.length).fill(0);
let dir = { dx: 0, dy: 0, at: 0, next: 0, name: "" }; // the D-pad and the left stick, as one eight-way direction
let axes = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };

const list = () => {
  try { return typeof navigator !== "undefined" && navigator.getGamepads ? Array.from(navigator.getGamepads() || []).filter((p) => p && p.connected) : []; } catch { return []; }
};
export const padConnected = () => known;
export const padAxes = () => ({ ...axes });
export const padHeld = (name) => { const i = BTN.indexOf(name); return i >= 0 ? down[i] : DIRS.has(name) ? dir.name === name : false; };
export function onPad(fn) { watchers.add(fn); return () => watchers.delete(fn); }
const framers = new Set();
export function onPadFrame(fn) { framers.add(fn); return () => framers.delete(fn); }
const framed = (T) => { for (const f of framers) try { f(T); } catch (e) { console.error(e); } };

export function claimPad(id, o = {}) {
  const L = { id, on: o.on || null, frame: o.frame || null, legend: o.legend || null, dock: o.dock || null, when: o.when || null, transient: !!o.transient };
  layers.push(L);
  return () => { const i = layers.indexOf(L); if (i >= 0) layers.splice(i, 1); };
}
const live = (L) => { try { return !L.when || !!L.when(); } catch { return false; } };
function tidy() { for (let i = layers.length - 1; i >= 0; i--) if (layers[i].transient && !live(layers[i])) layers.splice(i, 1); }
const top = () => { for (let i = layers.length - 1; i >= 0; i--) if (live(layers[i])) return layers[i]; return null; };

function emit(ev) {
  for (const w of watchers) try { w(ev); } catch (e) { console.error(e); }
  tidy();
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i];
    if (!live(L) || !L.on) continue;
    if (L.on(ev) !== false) return;
  }
}

// A stick with the radial dead zone taken out: inside it nothing; outside, 0 at its edge rising to 1.
function stick(x, y) {
  const r = Math.hypot(x, y);
  if (r < PAD.dead) return [0, 0];
  const k = Math.min(1, (r - PAD.dead) / (1 - PAD.dead)) / r;
  return [x * k, y * k];
}
// Eight ways from a stick (each 45°), or none inside the dead zone.
function eight(x, y) {
  if (!x && !y) return [0, 0];
  const s = Math.round(Math.atan2(y, x) / (Math.PI / 4));
  return [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]][(s + 8) % 8];
}
const pushed = (b, L) => b[12] || b[13] || b[14] || b[15] || !!(L[0] || L[1]);
const dirName = (dx, dy, vFirst) => (dy && (vFirst || !dx) ? (dy < 0 ? "Up" : "Down") : dx < 0 ? "Left" : dx > 0 ? "Right" : "");

// One frame: read every pad (two pads act as one), send what changed.
function poll(now) {
  raf = 0;
  const pads = list();
  if (!pads.length) { lost(); return; }
  raf = requestAnimationFrame(poll);
  const dt = Math.min(0.1, lastT ? (now - lastT) / 1000 : 0);
  const gap = lastT > 0 && now - lastT > 400; // no frames for a while: a hidden tab (rAF stops there), a minimized window
  lastT = now;
  // Merged: a button is down on any pad; each stick is the pad's pushed furthest.
  const b = new Array(BTN.length).fill(false);
  let L = [0, 0], R = [0, 0], lt = 0, rt = 0;
  for (const p of pads) {
    for (let i = 0; i < BTN.length && i < p.buttons.length; i++) {
      const q = p.buttons[i], v = typeof q === "object" ? q.value : Number(q);
      if (i === 6 || i === 7) { // the triggers: analog, with a gap between pressed and let go so a half press does not flicker
        if (i === 6) lt = Math.max(lt, v || 0); else rt = Math.max(rt, v || 0);
        b[i] = b[i] || (v || 0) >= (down[i] ? PAD.triggerOff : PAD.trigger);
      } else b[i] = b[i] || !!(typeof q === "object" ? q.pressed || q.value > 0.5 : q > 0.5);
    }
    const a = p.axes || [];
    const l = stick(a[0] || 0, a[1] || 0), r = stick(a[2] || 0, a[3] || 0);
    if (Math.hypot(...l) > Math.hypot(...L)) L = l;
    if (Math.hypot(...r) > Math.hypot(...R)) R = r;
  }
  axes = { lx: L[0], ly: L[1], rx: R[0], ry: R[1], lt, rt };
  // Hidden, or another window in front: nothing is sent, and what is pressed meanwhile is muted until it is let go
  // (its press was not for us, nor is its release when the page comes back).
  // Back after a gap with no frames is the same: what changed meanwhile was not seen happen, so it is not acted on.
  const off = typeof document !== "undefined" && (document.hidden || (!!document.hasFocus && !document.hasFocus()));
  if (off || gap) {
    for (let i = 0; i < BTN.length; i++) { if (b[i] && !down[i]) mute[i] = true; if (!b[i]) mute[i] = false; if (b[i] !== down[i]) held[i] = false; down[i] = b[i]; } // let go meanwhile: the next press counts
    if (dir.dx || dir.dy || pushed(b, L)) dir = { dx: 0, dy: 0, at: 0, next: 0, name: "", stale: true };
    if (off) return;
  }
  const any = b.some((x, i) => x && !down[i]) || L[0] || L[1] || R[0] || R[1];
  if (any && inputMode() !== "pad") setInputMode("pad");
  // The buttons (the D-pad's four go through the direction below).
  for (let i = 0; i < BTN.length; i++) {
    const n = BTN[i], quiet = DIRS.has(n) || mute[i];
    if (b[i] && !down[i]) {
      down[i] = true; since[i] = now; held[i] = false; nextRep[i] = now + PAD.delay;
      if (!quiet) emit({ name: n, type: "down", dx: 0, dy: 0, value: i === 6 ? lt : i === 7 ? rt : 1, long: false });
    } else if (!b[i] && down[i]) {
      down[i] = false;
      const long = held[i];
      held[i] = false;
      if (!quiet) emit({ name: n, type: "up", dx: 0, dy: 0, value: 0, long });
      mute[i] = false;
    } else if (b[i] && !quiet && !held[i] && now - since[i] >= PAD.hold) {
      held[i] = true;
      emit({ name: n, type: "hold", dx: 0, dy: 0, value: 1, long: true });
    } else if (b[i] && !quiet && REPEATS.has(n) && now >= nextRep[i]) {
      nextRep[i] = now + PAD.every * 2;
      emit({ name: n, type: "repeat", dx: 0, dy: 0, value: i === 6 ? lt : rt, long: false });
    }
  }
  // The direction: the D-pad if pressed, else the left stick's eighth. A fresh push (from the middle, or a turn the
  // other way) is a press now; a stick wandering into the eighth beside it goes on repeating as it was (no new press
  // for a wobble); held, it repeats after PAD.delay every PAD.every.
  const pdx = (b[15] ? 1 : 0) - (b[14] ? 1 : 0), pdy = (b[13] ? 1 : 0) - (b[12] ? 1 : 0);
  const [sdx, sdy] = eight(L[0], L[1]);
  const pad = !!(pdx || pdy);
  const dx = pad ? pdx : sdx, dy = pad ? pdy : sdy;
  if (dir.stale) { if (!dx && !dy) dir = { dx: 0, dy: 0, at: 0, next: 0, name: "" }; } // held through coming back: let go first
  else if (!dx && !dy) {
    if (dir.name) emit({ name: dir.name, type: "up", dx: 0, dy: 0, value: 0, long: false });
    dir = { dx: 0, dy: 0, at: 0, next: 0, name: "" };
  } else {
    const was = dir.dx || dir.dy, beside = was && dx * dir.dx + dy * dir.dy > 0;
    const value = pad ? 1 : Math.min(1, Math.hypot(L[0], L[1]));
    if (!was || (!beside)) {
      if (dir.name) emit({ name: dir.name, type: "up", dx: 0, dy: 0, value: 0, long: false });
      dir = { dx, dy, at: now, next: now + PAD.delay, name: dirName(dx, dy, pad) };
      emit({ name: dir.name, type: "down", dx, dy, value, long: false });
    } else {
      dir.dx = dx; dir.dy = dy;
      if (now >= dir.next) {
        // A stick pushed all the way repeats faster than one barely past its dead zone.
        dir.next = now + (pad ? PAD.every : PAD.every * (1.6 - 0.8 * value));
        emit({ name: dir.name, type: "repeat", dx, dy, value, long: false });
      }
    }
  }
  const T = top();
  if (T && T.frame && inputMode() === "pad") try { T.frame(dt, axes); } catch (e) { console.error(e); }
  framed(T);
  legendFrame(T);
}

// ---------- connect and disconnect ----------
function found() {
  if (known) return;
  known = true; // the press that showed it (iOS, Chrome) is read as a press on the first poll
  if (lookTimer) { clearInterval(lookTimer); lookTimer = 0; }
  if (!raf) { lastT = 0; raf = requestAnimationFrame(poll); }
}
function lost() {
  if (!known) return;
  known = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  for (let i = 0; i < BTN.length; i++) { down[i] = false; held[i] = false; mute[i] = false; }
  dir = { dx: 0, dy: 0, at: 0, next: 0, name: "" };
  axes = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };
  if (inputMode() === "pad") setInputMode(homeMode()); // the cursors and the legend go with it
  framed(null);
  legendFrame(null);
  lookLater();
}
const look = () => { if (!known && list().length) found(); };
function lookLater() {
  if (lookTimer || typeof setInterval === "undefined") return;
  lookTimer = setInterval(() => { if (typeof document === "undefined" || !document.hidden) look(); }, PAD.look);
}

export function initGamepad() {
  if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.getGamepads) return;
  window.addEventListener("gamepadconnected", () => found());
  window.addEventListener("gamepaddisconnected", () => { if (!list().length) lost(); });
  window.addEventListener("focus", look);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) look(); });
  look();
  if (!known) lookLater();
}

// ---------- the button legend ----------
// One strip at the bottom of whatever the top layer docks it in (the map, the battle map), drawn only in pad mode
// (pad.css: shown under .input-pad), made the first time a pad is used: a desktop with no pad has no such element.
const GLYPH = { A: "A", B: "B", X: "X", Y: "Y", LB: "LB", RB: "RB", LT: "LT", RT: "RT", View: "⧉", Menu: "☰", LS: "L3", RS: "R3", Home: "⌂", Up: "▲", Down: "▼", Left: "◀", Right: "▶" };
export const padGlyph = (n) => `<b class="pb pb-${n}">${GLYPH[n] || n}</b>`;
let legEl = null, legShown = "", legDock = null, legMeasure = true;
function legendFrame(T) {
  const want = T && T.legend && inputMode() === "pad" ? T.legend() : null;
  const html = want && want.length ? want.map(([btn, label]) => `<span class="ph">${String(btn).split(" ").map(padGlyph).join("")}<i>${label}</i></span>`).join("") : "";
  if (!html && !legEl) return;
  if (!legEl && typeof document !== "undefined") {
    legEl = document.createElement("div"); legEl.id = "padhints"; legEl.setAttribute("aria-hidden", "true");
    window.addEventListener("resize", () => { legMeasure = true; });
  }
  if (!legEl) return;
  const dock = (T && T.dock && T.dock()) || document.body;
  if (legDock !== dock || !legEl.isConnected) { dock.appendChild(legEl); legDock = dock; legMeasure = true; }
  if (html !== legShown) { legEl.innerHTML = html; legShown = html; legMeasure = true; }
  legEl.hidden = !html;
  // Its height for what sits at the bottom of the same box (pad.css lifts the battle's target card above it): measured
  // when it changes, moves or the window is resized, not every frame.
  if (!legMeasure) return;
  legMeasure = false;
  const hh = html ? `${legEl.offsetHeight}px` : "0px";
  if (dock.style && dock.style.getPropertyValue("--padhints-h") !== hh) dock.style.setProperty("--padhints-h", hh);
}
