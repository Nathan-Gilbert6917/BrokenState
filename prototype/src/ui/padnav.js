// @ts-check
// A controller in the windows, menus and panels (ui/gamepad.js is the pad itself; the State Map's and the battle's own
// layers are main.js's). One layer, claimed above the map and the battle and under the confirmation box: while
// anything but the bare map or battle is in front (a window, the tile menu, the item menu, the title screen, the
// new-run screen, a drop-down, a raid's search window, a battle's question) it takes the pad, and a ring shows the
// button it points at. View takes it into the side panels from the map (and the battle panel in a battle), X into the
// battle's orders bar.
//
//   ◀ ▶ ▲ ▼ (the D-pad or the left stick)  the ring to the nearest button that way (below)
//   A      press it: a click as the mouse makes it (main.js's data-action listener); a drop-down opens a list of its
//          choices (▲ ▼, A sets it, B leaves it as it was); a text or number box takes the focus (a phone's keyboard
//          comes up; B or A leaves it); a slider or a number box steps with ◀ ▶
//   B      back: Esc, as the keyboard has it (main.js closeTopLayer: one layer at a time); out of the panels or the
//          orders bar back to the map
//   X      its right-click (the item menu, the Work tab's picker), where it has one
//   Y      the window's one main button (its .primary, when it has exactly one that is not Close), or "put it here"
//          on a list an item is picked for (the inventory's boxes)
//   LB RB  the tab before or after, in the window's (or the panel's) row of tabs
//   right stick  scrolls what the ring is in
//   View   the panels: map → the left panel → the right one → the top bar → map on a desktop, each stop on the button
//          the ring had there last; the drawers in turn on a phone or upright tablet (Lists, Info, Log, then the map)
//
// Where the ring goes: every visible, enabled button, link, box, drop-down and clickable row in the layer, scored by
// how far it is that way plus three times how far off to the side (the edges, so a row of buttons stays a row), the
// side offset of the middles breaking ties. Something scrolled out of its list counts (it is scrolled into view);
// something under another layer (a drawer over the map's boxes) does not. The ring follows a button by what it does
// (data-action and its data), not by its node: the windows are drawn again on every refresh. Each layer keeps the
// last button it was on (closing a window gives the ring back where it was); a new one starts on its row of tabs, its
// first choice, its main button in sight or its first button, in that order.
//
// A box in front with nothing to press (a note over a raid's deploy screen) leaves the pad to the layer under it, and
// is looked at again every quarter second for a button that came.
//
// Checked in the real game by tools/padnavtest.cjs (headless Chromium, a made-up pad; a desktop and a phone).
// Nothing without a pad: no listener of its own but "inputmode", no DOM until a pad is the device in use (the ring,
// the drop-down list); the ring and the legend are drawn only under html.input-pad (pad.css) and go when the mouse, a
// key or a finger is used.
import { claimPad, onPadFrame } from "./gamepad.js";
import { inputMode } from "./inputmode.js";

let api = null; // main.js: { ui, state(), actions, refresh(), mapPick() }
const nav = { mode: "", cb: "", cbPanel: false, sk: "", base: "", el: null, key: "", cx: -1, cy: -1, tip: null, tipAt: 0, top: false, vis: false }; // vis: the ring was drawn last frame
const mem = new Map(); // a layer's key → { key, cx, cy }: the button it was on
let pick = null;       // a drop-down's list: { sel, box }
let ringEl = null, legendSc = null;
const $ = (id) => (typeof document === "undefined" ? null : document.getElementById(id));
const DIRS = new Set(["Up", "Down", "Left", "Right"]);
const SEL = "button, [data-action], a[href], input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex='-1']), [role=button]";
const CONTROL = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "LABEL"]);
const shown = (el) => !!el && !el.classList.contains("hidden") && !el.hidden && el.getClientRects().length > 0;
const isText = (el) => !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "range", "button", "submit", "color", "file"].includes(el.type)));
const isStep = (el) => !!el && el.tagName === "INPUT" && el.type === "range"; // a number box steps once A has taken it (in a row it would trap ◀ ▶)
const isNum = (el) => !!el && el.tagName === "INPUT" && el.type === "number";
const closeish = (el) => /(^|-)(close|cancel|back)$|^close|^set-close/.test(el.dataset.action || "") || /^(✕|×|Close|Cancel|Back|Resume)$/.test((el.textContent || "").trim());
const drawers = () => !!$("rs-dock"); // ui/responsive.js: a phone or upright tablet
const DRAWERS = ["left", "right", "log"];
const isOpen = (p) => !document.body.classList.contains(`fold-${p}`);

// ---------- the layer in front ----------
// { k: what the ring is remembered under, base: the window (a tab change keeps the ring where it is), roots, dock,
//   y: "pass" (Y goes on to the layer under it), mode ("panels", "cb": the battle's bar or panel; B and View leave it),
//   back (B's own way out) }
/** @typedef {{ k: string, base: string, roots: HTMLElement[], mode?: string, y?: string, dock?: () => HTMLElement, back?: () => void }} Scope */
/** @param {string} k @param {HTMLElement[]} roots @param {{ base?: string, mode?: string, y?: string, dock?: () => HTMLElement, back?: () => void }} [o] @returns {Scope} */
function S(k, roots, o = {}) { return { k, base: o.base || k, roots: roots.filter(Boolean), ...o }; }
function scope() {
  if (!api || typeof document === "undefined") return null;
  const ui = api.ui, st = api.state();
  if (ui.timelapse) { const t = $("timelapse"); return shown(t) ? S("timelapse", [t]) : null; } // ui/timelapse.js: its own keys (Esc closes)
  if (pick && pick.box.isConnected) return S("pick", [pick.box], { y: "pass" });
  for (const id of ["crash", "palette"]) { const e = $(id); if (shown(e)) return S(id, [e]); }
  if (shown($("itemmenu"))) return S("itemmenu", [$("itemmenu")]);
  if (shown($("ctxmenu"))) return S("ctx", [$("ctxmenu")], { dock: () => $("mapwrap") });
  if (!ui.ask && shown($("ask")) && $("ask").children.length) return S("ask", [$("ask")]); // ui/carry.js: how much to pick up (the question itself is main.js's "ask" layer)
  const modal = $("modal"), up = shown(modal) && modal.children.length > 0;
  if (up) {
    const sub = modal.querySelector(".wpick, .smove.pop"); // the Work tab's picker (ui/work.js), a stack's "how many" (ui/stackmove.js)
    if (sub && shown(sub)) return S(sub.classList.contains("wpick") ? "wpick" : "smove", [/** @type {HTMLElement} */ (sub)]);
  }
  if (shown($("boxview"))) return S("box", [$("boxview")]); // ui/boxview.js: an opened box, over the windows
  // The phone's ⋯ drop-down and the camera spots (ui/responsive.js): B closes them by their own button.
  if (document.body.classList.contains("rs-more") && shown($("rs-more"))) return S("rsmore", [$("rs-more")], { back: () => $("rs-morebtn").click() });
  if (document.body.classList.contains("rs-cams") && shown($("rs-cams"))) return S("rscams", [$("rs-cams")], { back: () => $("rs-cambtn").click() });
  if (up) {
    const wins = modal.querySelectorAll(".win"), win = /** @type {HTMLElement} */ (wins[wins.length - 1]);
    const box = win || modal.firstElementChild;
    const base = `modal:${win ? win.dataset.win : box ? box.className : ""}`;
    const g = shown($("guidetip")) ? $("guidetip") : null; // the first-week guide's note over a window (ui/guide.js)
    return S(`${base}:${activeTab([modal])}`, [modal, g], { base });
  }
  const tt = $("title");
  if (ui.title && shown(tt) && !tt.classList.contains("covered")) return S("title", [$("tt-menu") || tt]);
  if (st && st.combat && shown($("combat"))) {
    const ask = Array.from(document.querySelectorAll("#combat .cbconfirm")).find((e) => shown(e) && e.querySelector("button:not([disabled])")); // the retreat, the fall back, End turn's "actions left" (not a note with nothing to press: the kit warning before a raid)
    if (ask) return S("cbask", [/** @type {HTMLElement} */ (ask)], { y: "pass", dock: () => $("cbmapwrap") });
    if (nav.cb === "cbbar") return S("cbbar", [$("cbbar")], { mode: "cb", dock: () => $("cbmapwrap") });
    if (nav.cb === "cbui") return S("cbui", [$("combat")], { mode: "cb", dock: () => $("cbmapwrap") });
    return null;
  }
  if (nav.mode === "panels" || (!ui.started && !ui.title)) return S("panels", [$("app"), $("rs-keys"), shown($("guidetip")) ? $("guidetip") : null], { mode: nav.mode }); // the new-run screen's View map: its banner
  return null;
}
// The layer takes the pad while something is in front with a button to point at. A box with none (a note over the
// deploy screen, a window of words) is left to the layer under it, and looked at again now and then for a button
// that came (sync marks it empty: the full look at every button is not for every frame).
const empty = { k: "", at: 0 };
function when() {
  const sc = scope();
  if (!sc) return false;
  if (empty.k !== sc.k) return true;
  if (performance.now() - empty.at < 250) return false;
  if (!cands(sc).length) { empty.at = performance.now(); return false; }
  empty.k = "";
  return true;
}
// A layer of our own (the panels, the orders bar) that went: its mode ends.
function modeOk() {
  if (!api) return;
  const st = api.state();
  if (nav.mode && !api.ui.started) nav.mode = ""; // the panels wait under a battle (the base map) and come back after it
  if (nav.cb && !(st && st.combat)) { nav.cb = ""; cbPanelBack(); }
}

// ---------- what the ring can go to ----------
// The part of r in sight (inside every box that clips it and the window), and the list that scrolls it.
function seen(el, r) {
  let L = Math.max(r.left, 0), T = Math.max(r.top, 0), R = Math.min(r.right, innerWidth), B = Math.min(r.bottom, innerHeight), sc = null;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
    const q = p.getBoundingClientRect();
    L = Math.max(L, q.left); T = Math.max(T, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom);
    if (!sc && ((/auto|scroll/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 1) || (/auto|scroll/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1))) sc = p;
  }
  return { L, T, R, B, sc, any: R - L >= 2 && B - T >= 2 };
}
// Not under another layer: what is at the middle of its part in sight is it (or in it). Scrolled out of its list: the
// list itself is in sight.
function reachable(el, r) {
  const v = seen(el, r);
  if (v.any) {
    const hit = document.elementFromPoint((v.L + v.R) / 2, (v.T + v.B) / 2);
    return !!hit && (el.contains(hit) || hit.contains(el));
  }
  if (!v.sc) return false;
  const q = v.sc.getBoundingClientRect(), w = seen(v.sc, q);
  if (!w.any) return false;
  const hit = document.elementFromPoint((w.L + w.R) / 2, (w.T + w.B) / 2);
  return !!hit && (v.sc.contains(hit) || hit.contains(v.sc));
}
function cands(sc) {
  const out = [], seenEls = new Set();
  for (const R of sc.roots) for (const raw of R.querySelectorAll(SEL)) {
    let el = /** @type {HTMLElement} */ (raw);
    if (el.tagName === "CANVAS" || el.tagName === "OPTION" || el.matches(":disabled") || el.getAttribute("aria-disabled") === "true") continue;
    if (el.closest('[aria-hidden="true"], [inert], .hidden')) continue;
    // A checkbox in its label: the label (a bigger target, its text in the ring).
    const ty = /** @type {HTMLInputElement} */ (el).type;
    if (el.tagName === "INPUT" && (ty === "checkbox" || ty === "radio")) { const lab = el.closest("label"); if (lab && lab.querySelectorAll(SEL).length <= 1) el = lab; }
    if (seenEls.has(el)) continue;
    seenEls.add(el);
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || getComputedStyle(el).visibility === "hidden" || !reachable(el, r)) continue;
    out.push(el);
  }
  // A row or box that holds other buttons (an inventory's list of slots): its buttons, not it (Y puts a picked item in
  // it). A slot with a small button in a corner (a gun's ⚙) keeps both.
  return out.filter((el) => {
    if (CONTROL.has(el.tagName)) return true;
    const kids = out.filter((o) => o !== el && el.contains(o));
    if (!kids.length) return true;
    if (kids.length > 1) return false;
    const a = el.getBoundingClientRect(), b = kids[0].getBoundingClientRect();
    return b.width * b.height < a.width * a.height * 0.4;
  });
}
const inRoots = (sc, el) => sc.roots.some((R) => R.contains(el));
const mid = (r) => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
// What a button is, for finding it again after a redraw: its tag, action and data, then its words.
const keyOf = (el) => `${el.tagName}|${el.id}|${Object.entries(el.dataset).filter(([k]) => k !== "tip" && !k.startsWith("tip")).map(([k, v]) => `${k}=${v}`).join(",")}|${el.getAttribute("name") || ""}#${(el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40)}`;
const keyBase = (k) => k.slice(0, k.indexOf("#"));

// The tabs: buttons with the same data-action and a data-tab, two or more side by side, one lit (.active).
const lit = (el) => el.classList.contains("active") || el.getAttribute("aria-selected") === "true";
function tabGroups(roots) {
  const by = new Map();
  for (const R of roots) for (const el of R.querySelectorAll("[data-action][data-tab]")) {
    const h = /** @type {HTMLElement} */ (el);
    if (!shown(h)) continue;
    const k = h.dataset.action;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(h);
  }
  return [...by.values()].map((g) => g.filter((e) => g.some((o) => o !== e && o.parentElement === e.parentElement))).filter((g) => g.length >= 2 && g.some(lit));
}
function activeTab(roots) {
  const g = tabGroups(roots)[0];
  const a = g && g.find(lit);
  return a ? a.dataset.tab : "";
}
const tabsFor = (sc, el) => { const gs = tabGroups(sc.roots); return gs.find((g) => g.includes(el)) || gs[0] || null; };

// Where a layer starts: its tabs, its first choice, its main button in sight, the first button (reading order).
function start(sc, cs) {
  const inView = (el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; };
  if (sc.k === "cbbar") { const o = cs.find((el) => el.classList.contains("bb-btn") && el.dataset.action === "cb-act"); if (o) return o; }
  if (sc.k === "wpick") { const o = cs.find((el) => el.classList.contains("on")); if (o) return o; } // the Work picker: on the cell's value
  if (sc.mode === "panels") { // a phone: the open drawer; a desktop: the first stop (the left panel), on the button it had there
    const p = drawers() ? DRAWERS.find(isOpen) : stops()[0];
    const inP = p ? cs.filter((el) => $(p).contains(el)) : [], m = p && !drawers() ? mem.get(`panels:${p}`) : null;
    if (inP.length) return (m && inP.find((e) => keyOf(e) === m.key)) || firstOf(inP);
  }
  const g = tabsFor(sc, null), t = g && g.find(lit);
  if (t && cs.includes(t)) return t;
  const ch = cs.find((el) => el.closest(".choices"));
  if (ch) return ch;
  const pr = cs.find((el) => el.classList.contains("primary") && !closeish(el) && inView(el));
  if (pr) return pr;
  return firstOf(cs.filter((el) => !closeish(el) && inView(el))) || firstOf(cs);
}
function firstOf(cs) {
  let best = null, bs = Infinity;
  for (const el of cs) { const r = el.getBoundingClientRect(), s = Math.round(r.top / 8) * 1e5 + r.left; if (s < bs) { bs = s; best = el; } }
  return best;
}

// ---------- the ring ----------
function setEl(el, sc) {
  for (const o of Array.from(document.querySelectorAll(".pad-focus"))) if (o !== el) o.classList.remove("pad-focus");
  nav.el = el;
  if (!el) return;
  el.classList.add("pad-focus");
  nav.key = keyOf(el);
  const [cx, cy] = mid(el.getBoundingClientRect());
  nav.cx = cx; nav.cy = cy;
  const m = { key: nav.key, cx, cy };
  if (sc) { mem.set(sc.k, m); mem.set(sc.base, m); }
}
// The layer in front and the button the ring is on in it (found again by what it does after a redraw).
function sync() {
  modeOk();
  const sc = scope();
  if (!sc) { if (nav.sk) { nav.sk = ""; nav.base = ""; setEl(null); } return null; }
  if (sc.k !== nav.sk) {
    const same = sc.base === nav.base;
    nav.sk = sc.k; nav.base = sc.base;
    if (!same) { const m = mem.get(sc.k) || mem.get(sc.base); if (nav.el) nav.el.classList.remove("pad-focus"); nav.el = null; nav.key = m ? m.key : ""; nav.cx = m ? m.cx : -1; nav.cy = m ? m.cy : -1; }
  }
  if (nav.el && nav.el.isConnected && inRoots(sc, nav.el) && nav.el.getClientRects().length) { if (!nav.el.classList.contains("pad-focus")) nav.el.classList.add("pad-focus"); return sc; }
  const cs = cands(sc);
  let el = null;
  if (nav.key) {
    el = cs.find((e) => keyOf(e) === nav.key) || null;
    const near = (xs) => { let b = null, bd = Infinity; for (const e of xs) { const [x, y] = mid(e.getBoundingClientRect()), d = Math.hypot(x - nav.cx, y - nav.cy); if (d < bd) { bd = d; b = e; } } return b; };
    if (!el) { const kb = keyBase(nav.key); el = near(cs.filter((e) => keyBase(keyOf(e)) === kb)); } // its words changed (✔ ⇄ ✗, a count)
    if (!el && nav.cx >= 0) el = near(cs);
  }
  if (!el) el = start(sc, cs);
  // A battle's question under the phone's battle panel: the panel goes, so the question is in sight.
  if (!el && sc.k === "cbask" && document.body.classList.contains("rs-cbpanel") && $("rs-cbpanel")) { $("rs-cbpanel").click(); return sc; }
  if (!el && sc.mode) { if (sc.mode === "cb") nav.cb = ""; else nav.mode = ""; nav.sk = ""; nav.base = ""; setEl(null); return null; } // the orders bar or the panels with nothing in them: back to the map
  if (!el) { empty.k = sc.k; empty.at = performance.now(); nav.sk = ""; nav.base = ""; setEl(null); return null; } // nothing to point at: the layer under this one has the pad (when)
  setEl(el, sc);
  if (el) reveal(el);
  return sc;
}
// Into view in every list that scrolls it, the innermost first (never a box that only clips: the map's), and clear of
// the button legend where it lies over the list's foot (a phone's drawer, a window full screen).
function reveal(el) {
  const lg = $("padhints"), L = lg && !lg.hidden && lg.offsetHeight ? lg.getBoundingClientRect() : null;
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p), sx = /auto|scroll/.test(cs.overflowX) && p.scrollWidth > p.clientWidth, sy = /auto|scroll/.test(cs.overflowY) && p.scrollHeight > p.clientHeight;
    if (!sx && !sy) continue;
    const r = el.getBoundingClientRect(), q = p.getBoundingClientRect(), m = 12;
    const foot = L && L.top < q.bottom && L.bottom > q.top + q.height / 2 && L.left < r.right && L.right > r.left ? L.top - 4 : q.bottom;
    if (sy) p.scrollTop += r.top < q.top + m ? r.top - q.top - m : r.bottom > foot - m ? Math.min(r.bottom - foot + m, r.top - q.top - m) : 0;
    if (sx) p.scrollLeft += r.left < q.left + m ? r.left - q.left - m : r.right > q.right - m ? Math.min(r.right - q.right + m, r.left - q.left - m) : 0;
  }
}
function drawRing(on) {
  const el = on ? nav.el : null;
  if (!el && !ringEl) { nav.vis = false; return; }
  if (!ringEl) { ringEl = document.createElement("div"); ringEl.id = "padring"; ringEl.setAttribute("aria-hidden", "true"); document.body.appendChild(ringEl); }
  if (!el || !el.isConnected) { ringEl.hidden = true; nav.vis = false; return; }
  nav.vis = true;
  const r = el.getBoundingClientRect(), g = 3;
  ringEl.hidden = false;
  const s = ringEl.style;
  s.left = `${Math.round(r.left - g)}px`; s.top = `${Math.round(r.top - g)}px`; s.width = `${Math.round(r.width + g * 2)}px`; s.height = `${Math.round(r.height + g * 2)}px`;
}
// The hover description (data-tip) once the ring has rested on a button for a moment, as the mouse shows it.
function tipFrame(now) {
  const el = nav.el;
  if (el !== nav.tip) {
    if (nav.tip) document.body.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); // main.js: nothing with a tip there, so it hides
    nav.tip = el; nav.tipAt = now;
    return;
  }
  if (el && nav.tipAt && now - nav.tipAt > 700) {
    nav.tipAt = 0;
    if (!el.closest("[data-tip]")) return;
    const r = el.getBoundingClientRect();
    const e = new MouseEvent("mouseover", { bubbles: true, clientX: (r.left + r.right) / 2, clientY: r.top });
    Object.defineProperty(e, "touch", { value: true }); // main.js placeTip: above it, kept on screen (as a long press's), clear of the ring
    el.dispatchEvent(e);
  }
}
function hideTip() { if (nav.tip) { document.body.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); nav.tip = null; } }

// ---------- moving ----------
function move(sc, name) {
  const cs = cands(sc), cur = nav.el;
  if (!cur || !cs.includes(cur)) { const el = start(sc, cs); setEl(el, sc); if (el) reveal(el); return; }
  const c = cur.getBoundingClientRect(), [cx, cy] = mid(c);
  // Scrolled away from it with the right stick: the first one in sight in its list instead.
  const v = seen(cur, c);
  if (!v.any && v.sc) { const inList = cs.filter((e) => v.sc.contains(e) && seen(e, e.getBoundingClientRect()).any); if (inList.length) { setEl(firstOf(inList), sc); return; } }
  const h = name === "Left" || name === "Right", sg = name === "Right" || name === "Down" ? 1 : -1;
  let best = null, bs = Infinity;
  for (const el of cs) {
    if (el === cur || el.contains(cur) || cur.contains(el)) continue;
    const r = el.getBoundingClientRect(), [x, y] = mid(r);
    const ahead = h ? (sg > 0 ? r.right > c.right + 1 && x > cx + 1 : r.left < c.left - 1 && x < cx - 1) : (sg > 0 ? r.bottom > c.bottom + 1 && y > cy + 1 : r.top < c.top - 1 && y < cy - 1);
    if (!ahead) continue;
    const along = Math.max(0, h ? (sg > 0 ? r.left - c.right : c.left - r.right) : (sg > 0 ? r.top - c.bottom : c.top - r.bottom));
    const side = h ? Math.max(0, r.top - c.bottom, c.top - r.bottom) : Math.max(0, r.left - c.right, c.left - r.right);
    if (h && side > along + c.height) continue; // ◀ ▶ stay near the row (the end of a row is the end); ▲ ▼ always find the next line
    const s = along + side * 3 + Math.abs(h ? y - cy : x - cx) * 0.2;
    if (s < bs) { bs = s; best = el; }
  }
  if (best) { setEl(best, sc); reveal(best); return; }
  // Nothing more that way: the list goes on scrolling (words below the last button).
  const p = v.sc;
  if (p) { if (h) p.scrollLeft += sg * p.clientWidth * 0.5; else p.scrollTop += sg * p.clientHeight * 0.5; }
}
// A slider or number box: ◀ ▶ a step (a slider with no step: a twentieth of its range).
function stepInput(el, d) {
  const min = el.min !== "" ? Number(el.min) : -Infinity, max = el.max !== "" ? Number(el.max) : Infinity;
  const st = el.step && el.step !== "any" ? Number(el.step) : el.type === "range" ? (max - min) / 20 : 1;
  const v = Math.max(min, Math.min(max, (Number(el.value) || 0) + d * (st || 1)));
  if (String(v) === el.value) return;
  el.value = String(v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// ---------- a drop-down's choices ----------
function openPick(sel) {
  closePick();
  const box = document.createElement("div");
  box.id = "padpick"; box.setAttribute("role", "listbox");
  const opts = [...sel.options];
  box.innerHTML = opts.map((o, i) => (o.hidden ? "" : `<button type="button" class="pp-opt${i === sel.selectedIndex ? " on" : ""}" data-pp="${i}"${o.disabled ? " disabled" : ""}></button>`)).join("");
  for (const b of Array.from(box.querySelectorAll("button"))) b.textContent = opts[Number(/** @type {HTMLElement} */ (b).dataset.pp)].textContent;
  document.body.appendChild(box);
  const r = sel.getBoundingClientRect(), h = box.offsetHeight, w = Math.max(r.width, box.offsetWidth);
  box.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - w - 8, r.left)))}px`;
  box.style.minWidth = `${Math.round(r.width)}px`;
  box.style.top = `${Math.round(r.bottom + 4 + h <= innerHeight - 8 ? r.bottom + 4 : Math.max(8, r.top - 4 - h))}px`;
  pick = { sel, box };
  const on = /** @type {HTMLElement} */ (box.querySelector(".pp-opt.on")) || /** @type {HTMLElement} */ (box.querySelector("button:not([disabled])"));
  nav.sk = "pick"; nav.base = "pick";
  setEl(on, null);
  if (on) reveal(on);
}
function closePick() {
  if (!pick) return;
  pick.box.remove();
  pick = null;
}
function choose(i) {
  const sel = pick.sel;
  closePick();
  if (!sel.isConnected || sel.selectedIndex === i) return;
  sel.selectedIndex = i;
  sel.dispatchEvent(new Event("input", { bubbles: true }));
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}

// ---------- the buttons ----------
// Esc as the keyboard sends it (main.js: the stack mover, the naming window, the timelapse, closeTopLayer, a battle's
// own Esc). A window that needs an answer stays; Esc would open the Menu over it then, so that is undone.
function esc() {
  const u = api.ui, had = !!u.settings;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  if (!had && u.settings) { u.settings = null; api.refresh(); }
}
function press(sc, el) {
  if (el.tagName === "SELECT") { openPick(el); return; }
  if (isText(el)) { el.focus(); if (el.select) try { el.select(); } catch { /* a number box */ } return; }
  if (el.tagName === "INPUT" && el.type === "range") return;
  const keep = sc.k === "cbbar" && el.dataset.action === "cb-bar" && (el.dataset.v === "tray" || el.dataset.v === "all"); // a tray opened: stay in the bar
  if (!CONTROL.has(el.tagName) && !el.dataset.action && el.getAttribute("role") === "button") { // a bar that folds a panel (ui/windows.js): its keys
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
  } else el.click();
  if (sc.k === "cbbar" && !keep) leaveMode(sc);
  if (sc.mode === "panels" && api.mapPick()) leaveMode(sc); // a team's move, a field work's tile, a meeting tile: picked on the map
  api.refresh();
}
// X: the right-click at its middle (the item menu, the Work tab's picker: main.js's contextmenu listener).
const ctxOf = (el) => (el ? /** @type {HTMLElement} */ (el.closest("[data-imenu], [data-loc], [data-rc]")) : null);
function context(el) {
  const r = el.getBoundingClientRect(), [x, y] = mid(r);
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
  api.refresh();
}
// Y: a picked item's list (the box the ring's slot is in), else the window's one main button.
function dropBox(sc, el) {
  if (!el || !api.ui.invSel) return null;
  const box = el.parentElement && /** @type {HTMLElement} */ (el.parentElement.closest("[data-action][data-drop]"));
  return box && inRoots(sc, box) ? box : null;
}
function mainBtn(sc) {
  if (sc.y === "pass" || sc.mode) return null;
  const xs = [];
  for (const R of sc.roots) for (const el of R.querySelectorAll(".primary")) { const h = /** @type {HTMLElement} */ (el); if (!closeish(h) && !h.matches(":disabled") && shown(h) && !lit(h)) xs.push(h); }
  return xs.length === 1 ? xs[0] : null;
}
const short = (el) => { const t = (el.textContent || "").trim().replace(/\s+/g, " "); return t.length > 22 ? `${t.slice(0, 21)}…` : t; };

// ---------- the panels and the orders bar ----------
function leaveMode(sc) {
  if (sc.mode === "cb") { if (nav.cb === "cbui") cbPanelBack(); nav.cb = ""; }
  else {
    if (drawers()) for (const p of DRAWERS) if (isOpen(p)) api.actions["panel-toggle"]({ p, v: "1" });
    else rememberStop(); // the button it was on in its panel, for the next ⧉
    nav.mode = "";
  }
  hideTip();
  api.refresh();
}
// ⧉ on the map: into the panels (a desktop: the left panel first, on the button the ring had there; a phone: the
// Lists drawer first).
export function navPanels() {
  if (!api) return;
  if (drawers() && !DRAWERS.some(isOpen)) api.actions["panel-toggle"]({ p: "left", v: "0" });
  mem.delete("panels"); // the first stop (start), not wherever the ring was last
  nav.mode = "panels";
  const t = $("tooltip");
  if (t) t.classList.add("hidden"); // the map cursor's tooltip waits with it
  api.refresh();
}
// ⧉ in the panels: a phone's next drawer (Lists, Info, Log, then the map), a desktop's next stop.
// A desktop's stops for ⧉: the left panel, the right one, the top bar (those in sight), then the map. The ring goes
// between them by the D-pad too; ⧉ is the long way made short (a team's Move is in the right panel).
const STOPS = ["left", "right", "topbar"];
const stops = () => STOPS.filter((id) => { const e = $(id), r = e && e.getBoundingClientRect(); return !!r && r.width > 40 && r.height > 10; });
const stopAfter = () => { const xs = stops(), i = xs.findIndex((id) => nav.el && $(id).contains(nav.el)); return xs[i + 1] || null; };
const rememberStop = () => { const from = STOPS.find((id) => nav.el && $(id).contains(nav.el)); if (from) mem.set(`panels:${from}`, { key: nav.key, cx: nav.cx, cy: nav.cy }); };
function nextPanel(cur) {
  const sc = { mode: "panels" };
  if (!drawers()) {
    const to = stopAfter();
    if (!to) { leaveMode(sc); return; }
    rememberStop();
    const cs = cands(cur).filter((e) => $(to).contains(e)), m = mem.get(`panels:${to}`);
    const el = (m && cs.find((e) => keyOf(e) === m.key)) || firstOf(cs);
    if (!el) { leaveMode(sc); return; }
    setEl(el, cur); reveal(el);
    return;
  }
  const open = DRAWERS.findIndex(isOpen);
  if (open >= 0) api.actions["panel-toggle"]({ p: DRAWERS[open], v: "1" });
  if (open + 1 >= DRAWERS.length || open < 0) { leaveMode(sc); return; }
  api.actions["panel-toggle"]({ p: DRAWERS[open + 1], v: "0" });
  mem.delete("panels");
  setEl(null); nav.key = ""; nav.cx = -1;
  api.refresh();
}
// X in a battle: the orders bar (the selected order first; A gives one and goes back to the map, a tray stays).
export function navBar() { if (api) { nav.cb = "cbbar"; mem.delete("cbbar"); } }
// ⧉ in a battle: the battle panel, the raid's strip, the cards and the bar, all of them.
// The phone's battle panel opened with ⧉ closed again (ui/responsive.js's ☰ over the battle map).
function cbPanelBack() {
  if (nav.cbPanel && document.body.classList.contains("rs-cbpanel") && $("rs-cbpanel")) $("rs-cbpanel").click();
  nav.cbPanel = false;
}
export function navBattle() {
  if (!api) return;
  nav.cb = "cbui";
  const t = $("rs-cbpanel"); // a phone or tablet: the battle panel opens with it (ui/responsive.js), and closes after
  nav.cbPanel = !!t && shown(t) && !document.body.classList.contains("rs-cbpanel");
  if (nav.cbPanel) t.click();
}

// ---------- the layer ----------
function on(ev) {
  const n = ev.name;
  const sc = sync();
  if (!sc) return false;
  if (n === "Menu" || n === "Home") return false; // ☰: the map's and the battle's (pause, the game menu)
  if (n === "View") {
    if (ev.type === "hold") return false; // held: map only (main.js)
    if (ev.type === "up" && !ev.long && sc.mode) { if (sc.mode === "panels") nextPanel(sc); else leaveMode(sc); }
    return true;
  }
  if (ev.type === "up" || ev.type === "hold") return true;
  // The ring not in sight yet (the mouse or a finger was used last): the first press only shows it.
  if (!nav.vis && n !== "B" && !(ev.type === "repeat")) { nav.vis = true; return true; }
  const el = nav.el, a = document.activeElement;
  // Typing in a box: B or A leaves it (the change goes in as the box loses the focus), a direction moves on.
  if (a && isText(a) && inRoots(sc, a)) {
    if (n === "A" || n === "B") { if (ev.type === "down") /** @type {HTMLElement} */ (a).blur(); return true; }
    if (isNum(a) && (n === "Left" || n === "Right")) { stepInput(a, n === "Right" ? 1 : -1); return true; }
    if (DIRS.has(n)) /** @type {HTMLElement} */ (a).blur();
  }
  if (DIRS.has(n)) {
    if (pick) { move(sc, n); return true; }
    if (el && isStep(el) && (n === "Left" || n === "Right")) { stepInput(el, n === "Right" ? 1 : -1); return true; }
    move(sc, n);
    return true;
  }
  if (ev.type !== "down") return n === "LT" || n === "RT" ? false : true;
  if (n === "A") {
    if (pick) { if (el && el.dataset.pp != null) choose(Number(el.dataset.pp)); return true; }
    if (el) press(sc, el);
    return true;
  }
  if (n === "B") {
    if (pick) { closePick(); return true; }
    if (sc.mode) { leaveMode(sc); return true; }
    hideTip();
    if (sc.back) { sc.back(); api.refresh(); return true; }
    esc();
    return true;
  }
  if (n === "X") { const c = ctxOf(el); if (c && !pick) context(c); return true; }
  if (n === "Y") {
    const box = dropBox(sc, el);
    if (box) { box.click(); api.refresh(); return true; }
    const m = mainBtn(sc);
    if (m) { m.click(); api.refresh(); return true; }
    return sc.y === "pass" || sc.mode ? false : true;
  }
  if (n === "LB" || n === "RB") {
    const g = tabsFor(sc, el);
    if (!g) return !!sc.mode ? false : true;
    const i = g.findIndex(lit), t = g[(i + (n === "RB" ? 1 : -1) + g.length) % g.length];
    t.click();
    setEl(t, sc);
    api.refresh();
    return true;
  }
  return n === "LT" || n === "RT" ? false : true;
}
function frame(dt, axes) {
  nav.top = true;
  const sc = sync();
  if (!sc) return;
  // The right stick scrolls the list the ring is in, else the layer's biggest list.
  if (axes.rx || axes.ry) {
    let p = null;
    for (let q = nav.el && nav.el.parentElement; q && q !== document.body; q = q.parentElement) { const cs = getComputedStyle(q); if ((/auto|scroll/.test(cs.overflowY) && q.scrollHeight > q.clientHeight) || (/auto|scroll/.test(cs.overflowX) && q.scrollWidth > q.clientWidth)) { p = q; break; } }
    if (!p) { let big = 0; for (const R of sc.roots) for (const q of [R, ...Array.from(R.querySelectorAll("*"))]) { if (q.scrollHeight > q.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(q).overflowY) && q.clientHeight > big) { big = q.clientHeight; p = q; } } }
    if (p) { p.scrollTop += axes.ry * 1100 * dt; p.scrollLeft += axes.rx * 1100 * dt; }
  }
  tipFrame(performance.now());
}
function legend() {
  const sc = legendSc = sync();
  if (!sc) return null;
  if (pick) return [["Up Down", "Choose"], ["A", "Set"], ["B", "Cancel"]];
  const el = nav.el, a = document.activeElement, out = [];
  if (a && isText(a) && inRoots(sc, a)) return [...(isNum(a) ? [["Left Right", "Change"]] : []), ["A", "Done"], ["B", "Done"]];
  if (el) {
    if (isStep(el)) out.push(["Left Right", "Change"]);
    const t = el.tagName === "SELECT" ? "Choose…" : isNum(el) ? "Change" : isText(el) ? "Type" : el.tagName === "INPUT" && el.type === "range" ? "" : el.tagName === "LABEL" || (el.tagName === "INPUT" && el.type === "checkbox") ? "Toggle" : "Select";
    if (t) out.push(["A", t]);
  }
  out.push(["B", sc.mode === "panels" ? "Map" : "Back"]);
  const c = ctxOf(el);
  if (c) out.push(["X", c.dataset.rc ? "Picker" : "Item menu"]);
  const box = dropBox(sc, el), m = box ? null : mainBtn(sc);
  if (box) out.push(["Y", "Put here"]);
  else if (m) out.push(["Y", short(m)]);
  if (tabsFor(sc, el)) out.push(["LB RB", "Tabs"]);
  if (sc.mode) out.push(["View", sc.mode === "panels" && (drawers() || stopAfter()) ? "Next panel" : "Map"]);
  return out;
}

// For the tools: the layer in front and the mode.
export const navState = () => ({ mode: nav.mode, cb: nav.cb, scope: nav.sk, vis: nav.vis, el: nav.el ? nav.el.outerHTML.slice(0, 90) : null, conn: !!(nav.el && nav.el.isConnected) });

export function initPadNav(o) {
  api = o;
  claimPad("nav", { when, on, frame, legend, dock: () => (legendSc && legendSc.dock ? legendSc.dock() : null) });
  // Every frame while a pad is connected: the ring only while this layer is the one taking the pad, in pad mode.
  onPadFrame((T) => {
    const mine = !!T && T.id === "nav" && inputMode() === "pad";
    if (!mine) {
      if (nav.top) { nav.top = false; hideTip(); }
      if (nav.el) nav.el.classList.remove("pad-focus"); // the map's or the battle's turn (sync puts it back)
      if (pick && inputMode() !== "pad") closePick();
      if (nav.sk && !scope()) { nav.sk = ""; nav.base = ""; setEl(null); } // what was in front went (B closed it): the next layer starts afresh, from its memory
    }
    drawRing(mine);
  });
  if (typeof window !== "undefined") window.addEventListener("inputmode", (e) => {
    if (/** @type {CustomEvent} */ (e).detail === "pad") return;
    closePick(); drawRing(false); hideTip();
  });
}
