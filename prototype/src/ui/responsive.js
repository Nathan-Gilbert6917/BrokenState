// Phones and tablets: the DOM the small-screen layouts in responsive.css need, built only while one of their media
// queries matches and taken away again when the window grows (a desktop window ≥760px with a mouse never sees any of
// it). The layouts themselves are all CSS; this file adds the controls a finger needs:
//   drawers   on a phone (and a portrait tablet) the left panel, the right panel and the log are slide-over drawers
//             and bottom sheets. A dock of big buttons (Lists · Info · Log) opens them, one at a time, through the
//             same fold state as the strips on a desktop (main.js "panel-toggle", ui/layout.js setFolded), so the
//             keys, autoReveal and the saved layout all keep working. A tap on the dimmed map closes the left drawer.
//   top bar   on a phone: the clock, the speeds and the Needs button stay; the threat forecast, the head count and
//             the tool buttons (Ledger … Menu) move into a "⋯" drop-down, with ⚙ Menu kept as a button of its own
//   close     a ✕ on every big window and on the tile menu, as Esc (closeTopLayer): no Esc key under a finger;
//             and a ✕ beside the open drawer or sheet
//   battle    on a phone: the battle's side panel becomes a drawer from the left (☰), and the orders bar folds
//             to End turn (▾)
//   raid      on a phone and an upright tablet: the raid's strip one row (ui/combat.js raidTopCompact), its cards a
//             sheet that folds (raidCardsCompact), the log a drawer that starts closed, the first-week guide's note
//             folded to its title (a tap opens it). RAIDUI holds what is open; a tap on a data-rs button toggles it
//   keys      what only a key did on the map: ◀ ❗ Next team (Shift+N / N) and the camera spots (Shift+1–9 go,
//             Ctrl+1–9 save), in the ⋯ drop-down on a phone and in the top bar on a tablet. Other modules ask
//             touchUI() to add their own (Cancel on the pick banners, main.js; the Work tab's picker, ui/work.js)
//   strip     with the drawers: the boxes over the State Map (the alerts with the first-week guide, Running orders,
//             Watching, Layers, the minimap) are closed and a strip of chips across the top of the map carries their
//             counts; a tap opens one box as a sheet under the strip, one at a time (the user's request 2026-10-24:
//             "for the phone version move the alerts and the other things shown on the world map overlay into a
//             collapsible display"). The boxes have fixed slots here and do not drag (ui/overlaydrag.js).
// Gestures (pan, pinch, long press) are ui/touch.js's.
import { LOGWIN } from "./logwindow.js"; // the raid's log window: a drawer, closed when a phone layout comes up
import { setOverlaysFixed } from "./overlaydrag.js"; // the boxes over the map stay put while the strip is up

export const PHONE = "(max-width: 759px)";
// A phone on its side (844×390 and the like) is wider than that: a touch screen this short is a phone too.
export const SHORT = "(pointer: coarse) and (min-width: 760px) and (max-height: 500px)";
// A tablet held upright (an iPad at 768–834px): the desktop arrangement leaves the map a strip, so drawers.
export const TIGHT = "(pointer: coarse) and (min-width: 760px) and (max-width: 1023px)";
export const TABLET = "(pointer: coarse) and (min-width: 760px)";
const DRAWERS = ["left", "right", "log"];
const DOCK = [["left", "☰", "Lists", "Bases, People, Groups and Teams ([)"], ["right", "ℹ", "Info", "What is picked: a tile, a site, a team (])"], ["log", "📜", "Log", "The log (L)"]];
const MOVED = ["tb-threat", "tb-people", "tb-tools"]; // into the phone's ⋯ drop-down, in this order

const $ = (id) => document.getElementById(id);
const body = () => document.body;
let mode = "";       // "phone" | "tight" | "tablet" | ""
// A phone or tablet layout is up: the controls that stand in for keys are drawn (a desktop window never draws them).
export const touchUI = () => mode !== "";
// The pick banners' Cancel (a team's move, a field work's tile, a meeting tile; main.js "pick-cancel"): Esc, where
// there is no Esc key.
// A phone or a tablet held upright (the drawers layouts): the strip over the map is up (enterHud), the banners at the
// top of the map are one line (main.js bannerHTML) and the Help says where the boxes are (ui/layout.js windowsHelp,
// ui/display.js, ui/watchlist.js). A desktop window with a mouse is never compact.
export const compactUI = () => mode === "phone" || mode === "tight";
export const phoneUI = () => mode === "phone"; // a phone (or a phone on its side): windows fill the screen (responsive.css)
// A raid on a phone or a tablet held upright (the same layouts): ui/combat.js draws its strip and cards compact.
export const raidCompact = () => mode === "phone" || mode === "tight";
// What is open on a compact raid screen: the strip's drop-downs (info: what is carried and the rest; view: the Menu
// and the view's buttons), the cards' sheet folded (cardsKey: the cards it held, a new one opens it), the log lines
// seen (logSeen of the battle logOf: 📜 counts the rest), the battle whose end closed the log once (overOf).
export const RAIDUI = { info: false, view: false, cardsMin: false, cardsKey: "", logOf: null, logSeen: 0, overOf: null };
export const pickCancel = (what) => (touchUI() ? ` <button class="mini" data-action="pick-cancel" data-what="${what}" data-tip="Cancel (Esc)">✕ Cancel</button>` : "");
let drawers = false; // the dock and the drawers are up
let saved = null;    // which drawers were folded before (put back when the window grows again)
let lastOpen = new Set();
let bodyObs = null, railObs = null, modalObs = null, topObs = null;
const parked = [];   // [node, placeholder]: top-bar slots moved into the ⋯ drop-down

// A click on a main.js action, as the player's own (its listener folds, saves the layout and redraws).
function act(action, data = {}) {
  const b = document.createElement("button");
  b.hidden = true;
  b.dataset.action = action;
  for (const [k, v] of Object.entries(data)) b.dataset[k] = v;
  body().appendChild(b);
  b.click();
  b.remove();
}
const isOpen = (p) => !body().classList.contains(`fold-${p}`);
function el(tag, attrs = {}, html = "") {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}
const drop = (id) => { const e = $(id); if (e) e.remove(); };

export function initResponsive() {
  if (typeof window === "undefined" || !window.matchMedia || typeof document === "undefined") return;
  const qs = [`${PHONE}, ${SHORT}`, TIGHT, TABLET].map((q) => window.matchMedia(q));
  const check = () => setMode(qs[0].matches ? "phone" : qs[1].matches ? "tight" : qs[2].matches ? "tablet" : "");
  for (const q of qs) q.addEventListener("change", check);
  setTimeout(check, 0); // after main.js has finished loading: the folds go through its click listener and actions
  // Another device picked up (ui/inputmode.js): the panels again, so the key hints say what it presses (ui/hints.js).
  window.addEventListener("inputmode", redraw);
}

function setMode(m) {
  if (m === mode) return;
  const was = mode;
  mode = m;
  const wantDrawers = m === "phone" || m === "tight";
  if (wantDrawers && !drawers) enterDrawers();
  if (!wantDrawers && drawers) leaveDrawers();
  if (m === "phone" && was !== "phone") enterPhone();
  if (m !== "phone" && was === "phone") leavePhone();
  if (m && !was) enterTouch();
  if (!m && was) leaveTouch();
  const rc = m === "phone" || m === "tight", wasRc = was === "phone" || was === "tight";
  if (rc && !wasRc) enterRaid();
  if (!rc && wasRc) leaveRaid();
  placeKeys();
  const g = window.game;
  if (g && g.refresh) g.refresh(); // the banners' Cancel (touchUI) comes or goes
}

// ---------- drawers ----------
function enterDrawers() {
  drawers = true;
  saved = Object.fromEntries(DRAWERS.map((p) => [p, !isOpen(p)]));
  for (const p of DRAWERS) if (isOpen(p)) act("panel-toggle", { p, v: "1" }); // the map first; the dock opens them
  lastOpen = new Set();
  const app = $("app");
  const dock = el("nav", { id: "rs-dock", "aria-label": "Panels" }, DOCK.map(([p, ic, name, tip]) =>
    `<button class="rs-db" data-action="panel-toggle" data-p="${p}" aria-controls="${p}" aria-expanded="false" data-tip="${tip}"><span class="rs-ic" aria-hidden="true">${ic}</span><span class="rs-dl">${name}</span>${p === "left" ? `<b class="rs-badge hidden"></b>` : ""}</button>`).join(""));
  app.appendChild(dock);
  app.appendChild(el("div", { id: "rs-scrim", "data-action": "panel-toggle", "data-p": "left", "data-v": "1", "aria-hidden": "true" }));
  // A ✕ beside the drawer or sheet that is open (outside it, over the map, so it covers none of the panel).
  app.appendChild(el("button", { id: "rs-dx", class: "hidden", "data-action": "panel-toggle", "data-p": "right", "data-v": "1", "aria-label": "Close the panel", "data-tip": "Close" }, "✕"));
  bodyObs = new MutationObserver(onBodyClass);
  bodyObs.observe(body(), { attributes: true, attributeFilter: ["class"] });
  // The teams waiting, as on the folded left panel's rail (ui/windows.js setRailBadges).
  const rail = document.querySelector('#gut-left .gut-badge[data-rail="teams"]');
  if (rail) { railObs = new MutationObserver(syncBadge); railObs.observe(rail, { attributes: true, childList: true, characterData: true, subtree: true }); }
  // The drawers hang under the top bar (and over the dock); the top bar's height changes as it wraps.
  if (typeof ResizeObserver !== "undefined") {
    topObs = new ResizeObserver(() => { syncTop(); placeDx(); });
    for (const n of [$("topbar"), dock, $("left"), $("right"), $("log")]) if (n) topObs.observe(n);
  }
  syncTop();
  syncBadge();
  onBodyClass();
  enterHud();
}
function leaveDrawers() {
  drawers = false;
  leaveHud();
  if (bodyObs) bodyObs.disconnect();
  if (railObs) railObs.disconnect();
  if (topObs) topObs.disconnect();
  bodyObs = railObs = topObs = null;
  drop("rs-dock");
  drop("rs-scrim");
  drop("rs-dx");
  const app = $("app");
  app.style.removeProperty("--rs-top");
  app.style.removeProperty("--rs-dock");
  app.style.removeProperty("--rs-dockr");
  if (saved) for (const p of DRAWERS) if (saved[p] !== !isOpen(p)) act("panel-toggle", { p, v: saved[p] ? "1" : "0" });
  saved = null;
}
// One drawer at a time: the one just opened (a dock button, a key, a tile picked, a tab switched) folds the others,
// and closes the sheet open under the strip over the map (one thing over the map at a time).
function onBodyClass() {
  if (!drawers) return;
  const now = DRAWERS.filter(isOpen);
  const fresh = now.filter((p) => !lastOpen.has(p));
  const keep = fresh.length ? fresh[fresh.length - 1] : null;
  if (keep) for (const p of now) if (p !== keep) act("panel-toggle", { p, v: "1" });
  if (keep && hud) { hudCloseAll(); queueHud(); }
  lastOpen = new Set(DRAWERS.filter(isOpen));
  for (const b of document.querySelectorAll("#rs-dock .rs-db")) {
    const on = isOpen(b.dataset.p);
    b.classList.toggle("active", on);
    b.setAttribute("aria-expanded", String(on));
  }
  placeDx();
}
// The drawer's ✕: right of the left drawer, left of the right one, above a sheet (the log, the right panel on an
// upright phone).
function placeDx() {
  const x = $("rs-dx");
  if (!x) return;
  const p = DRAWERS.find(isOpen), n = p && $(p);
  const r = n ? n.getBoundingClientRect() : null;
  x.classList.toggle("hidden", !r || !r.width);
  if (!r || !r.width) return;
  x.dataset.p = p;
  x.setAttribute("aria-label", `Close the ${p === "log" ? "log" : p === "left" ? "lists" : "info panel"}`);
  const s = x.offsetWidth || 44, g = 8, vw = window.innerWidth;
  const sheet = r.width > vw * 0.9 || p === "log";
  const left = sheet ? r.right - s - g : p === "left" ? r.right + g : r.left - s - g;
  const top = sheet ? r.top - s - g : r.top + g;
  x.style.left = `${Math.round(Math.max(g, Math.min(vw - s - g, left)))}px`;
  x.style.top = `${Math.round(Math.max(g, top))}px`;
}
function syncBadge() {
  const rail = document.querySelector('#gut-left .gut-badge[data-rail="teams"]');
  const b = document.querySelector("#rs-dock .rs-badge");
  if (!b) return;
  const t = rail && !rail.classList.contains("hidden") ? rail.textContent : "";
  if (b.textContent !== t) b.textContent = t;
  b.classList.toggle("hidden", !t);
}
function syncTop() {
  const app = $("app"), top = $("topbar"), dock = $("rs-dock");
  if (!app || !top) return;
  const r = top.getBoundingClientRect();
  app.style.setProperty("--rs-top", `${Math.round(r.bottom)}px`);
  // The dock under the map (upright) leaves the drawers and sheets its height; on its side it stands at the map's
  // right edge and leaves them its width.
  const d = dock ? dock.getBoundingClientRect() : null;
  const side = !!(d && d.height > d.width);
  app.style.setProperty("--rs-dock", d && !side ? `${Math.round(window.innerHeight - d.top)}px` : "0px");
  app.style.setProperty("--rs-dockr", d && side ? `${Math.round(window.innerWidth - d.left)}px` : "0px");
}

// ---------- the phone's top bar ----------
function enterPhone() {
  const top = $("topbar");
  if (!top) return;
  const menu = el("button", { id: "rs-menu", "data-action": "set-open", "aria-label": "Menu", "data-tip": "Menu: save, load, options (Esc)" }, "⚙");
  // Its tip lists what is in it (MOVED, then the keys): the threat forecast, the head count, the tool buttons less the
  // Menu (⚙ beside it has that; responsive.css hides the second), ❗ Next team and 📷 Spots.
  const more = el("button", { id: "rs-morebtn", "aria-label": "More", "aria-expanded": "false", "aria-controls": "rs-more", "data-tip": "More: the threat forecast, how many people you have, Ledger, Diary, Roster, Codex, Search, Help (and Dev tools when they are on), ❗ Next team and the 📷 camera spots" }, "⋯");
  const panel = el("div", { id: "rs-more", role: "menu" });
  for (const id of MOVED) {
    const n = $(id);
    if (!n) continue;
    const ph = document.createComment(`rs:${id}`);
    n.parentNode.insertBefore(ph, n);
    panel.appendChild(n);
    parked.push([n, ph]);
  }
  // The map's keys (enterTouch builds them; placeKeys moves them in here).
  panel.appendChild(el("div", { id: "rs-keyslot" }));
  top.appendChild(menu);
  top.appendChild(more);
  top.appendChild(panel);
  more.addEventListener("click", (e) => { e.stopPropagation(); setMore(!body().classList.contains("rs-more")); });
  // A button in the drop-down did its job (an action: main.js's listener runs on the document): close it. The threat
  // forecast's own button only opens its list.
  panel.addEventListener("click", (e) => { if (e.target.closest("[data-action]")) setTimeout(() => setMore(false), 0); });
  document.addEventListener("pointerdown", outsideMore, true);
  window.addEventListener("resize", syncTop);
}
function leavePhone() {
  setMore(false);
  for (const [n, ph] of parked.splice(0)) { if (ph.parentNode) { ph.parentNode.insertBefore(n, ph); ph.remove(); } }
  const k = $("rs-keys");
  if (k) body().appendChild(k); // out of the drop-down before it goes (placeKeys puts it in the top bar)
  drop("rs-menu");
  drop("rs-morebtn");
  drop("rs-more");
  document.removeEventListener("pointerdown", outsideMore, true);
  window.removeEventListener("resize", syncTop);
}
function setMore(on) {
  body().classList.toggle("rs-more", !!on);
  if (on) syncKeys();
  const b = $("rs-morebtn");
  if (b) b.setAttribute("aria-expanded", String(!!on));
}
function outsideMore(e) {
  if (!body().classList.contains("rs-more")) return;
  if (e.target.closest && e.target.closest("#rs-more, #rs-morebtn")) return;
  setMore(false);
}

// ---------- phones and tablets: a ✕ on windows, the battle's controls ----------
function enterTouch() {
  const x = el("button", { id: "rs-close", class: "hidden", "aria-label": "Close (Esc)", "data-tip": "Close (Esc)" }, "✕");
  x.addEventListener("click", closeTop);
  body().appendChild(x);
  const cb = el("div", { id: "rs-cbtools" },
    `<button id="rs-cbpanel" aria-label="Battle panel" aria-expanded="false" data-tip="The battle panel: your team, the Menu, the log">☰</button>` +
    `<button id="rs-cbmin" aria-label="Fold the orders" aria-expanded="true" data-tip="Fold the orders bar to End turn, again to open it">▾</button>`);
  cb.querySelector("#rs-cbpanel").addEventListener("click", () => { body().classList.toggle("rs-cbpanel"); syncCb(); });
  cb.querySelector("#rs-cbmin").addEventListener("click", () => { body().classList.toggle("rs-cbmin"); syncCb(); });
  ($("cbmapwrap") || body()).appendChild(cb); // over the battle map, above its orders bar (--cbbar-h, ui/combat.js)
  buildKeys();
  const modal = $("modal");
  modalObs = new MutationObserver(queueClose);
  if (modal) modalObs.observe(modal, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true });
  if ($("ctxmenu")) modalObs.observe($("ctxmenu"), { attributes: true, attributeFilter: ["class", "style"] }); // the tile menu (a long press)
  window.addEventListener("resize", queueClose);
  window.addEventListener("pointerup", queueClose, true); // a window dragged or resized
  queueClose();
}
function leaveTouch() {
  if (modalObs) modalObs.disconnect();
  modalObs = null;
  window.removeEventListener("resize", queueClose);
  window.removeEventListener("pointerup", queueClose, true);
  drop("rs-close");
  drop("rs-cbtools");
  drop("rs-keys");
  document.removeEventListener("pointerdown", outsideCams, true);
  body().classList.remove("rs-cams");
  body().classList.remove("rs-cbpanel", "rs-cbmin");
}
function syncCb() {
  const p = $("rs-cbpanel"), m = $("rs-cbmin");
  if (p) p.setAttribute("aria-expanded", String(body().classList.contains("rs-cbpanel")));
  if (m) { const min = body().classList.contains("rs-cbmin"); m.setAttribute("aria-expanded", String(!min)); m.textContent = min ? "▴" : "▾"; }
}

// The ✕ sits on the big window on top (a resizable .win: base, survivor, menu, trade, inventory …): above its top
// right corner when there is room, else inside it. Kept in step once a frame at most.
let closeRaf = 0;
function queueClose() {
  if (!closeRaf) closeRaf = requestAnimationFrame(() => { closeRaf = 0; placeClose(); });
}
function placeClose() {
  const x = $("rs-close"), modal = $("modal");
  if (!x) return;
  const wins = modal && !modal.classList.contains("hidden") ? modal.querySelectorAll(".win") : [];
  const ctx = $("ctxmenu");
  const win = ctx && !ctx.classList.contains("hidden") ? ctx : wins.length ? wins[wins.length - 1] : null; // the tile menu closes first (Esc)
  // A window with a ✕ of its own (ui/windows.js winBar in its title bar, ui/layout.js windowFrame in its corner)
  // gets no second one: the floating ✕ is for the tile menu and the windows without one.
  const own = win && win !== ctx && win.querySelector(".wx");
  x.classList.toggle("hidden", !win || !!own);
  if (!win || own) return;
  x.dataset.for = win === ctx ? "ctx" : "win";
  x.classList.toggle("over-combat", modal.classList.contains("over-combat"));
  const r = win.getBoundingClientRect(), vw = window.innerWidth;
  const s = x.offsetWidth || 44, gap = 6;
  const inside = (mode === "phone" && win !== ctx) || r.top < s + gap * 2;
  x.style.top = `${Math.round(inside ? Math.max(r.top, 0) + gap : r.top - s - gap)}px`;
  x.style.left = `${Math.round(Math.max(gap, Math.min(vw - s - gap, r.right - s - (inside ? gap : 0))))}px`;
}
// Esc, as main.js's keyboard handler takes it (closeTopLayer). A window that needs an answer stays; Esc would open
// the Menu over it then, so that is undone.
function closeTop() {
  const x = $("rs-close"), ctx = $("ctxmenu");
  // The tile menu: a press outside it closes it already (main.js), so this press may have done the job.
  if (x && x.dataset.for === "ctx" && ctx && ctx.classList.contains("hidden")) { queueClose(); return; }
  const g = window.game, u = g && g.ui;
  const had = !!(u && u.settings);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  if (u && !had && u.settings) { u.settings = null; if (g.refresh) g.refresh(); }
  queueClose();
}

// ---------- a raid on a phone or an upright tablet ----------
let logWas = null; // the log window was open on the larger screen (put back when it grows again)
let raidObs = null, guideObs = null;
function enterRaid() {
  // The log is a drawer here: closed until 📜 opens it (not saved: the desktop's window keeps its own state).
  logWas = LOGWIN.open;
  LOGWIN.open = false;
  document.addEventListener("click", onRaidTap);
  document.addEventListener("pointerdown", outsideRaid, true);
  // The strip's and the orders bar's heights for what sits outside the battle's box (the guide's note).
  if (typeof ResizeObserver !== "undefined") {
    raidObs = new ResizeObserver(syncRaidVars);
    for (const id of ["cbtop", "cbbar"]) if ($(id)) raidObs.observe($(id));
  }
  // A new guide note comes folded.
  const gt = $("guidetip");
  if (gt) { guideObs = new MutationObserver(() => { const t = gt.querySelector(".gd-title"), s = t ? t.textContent : ""; if (s !== gt.dataset.rsTip) { gt.dataset.rsTip = s; gt.classList.remove("rs-gdopen"); } }); guideObs.observe(gt, { childList: true }); }
}
function leaveRaid() {
  if (logWas && !LOGWIN.open) LOGWIN.open = true;
  logWas = null;
  document.removeEventListener("click", onRaidTap);
  document.removeEventListener("pointerdown", outsideRaid, true);
  if (raidObs) raidObs.disconnect();
  if (guideObs) guideObs.disconnect();
  raidObs = guideObs = null;
  for (const v of ["--rs-cbtop", "--rs-cbbar"]) document.documentElement.style.removeProperty(v);
  const gt = $("guidetip");
  if (gt) gt.classList.remove("rs-gdopen");
  Object.assign(RAIDUI, { info: false, view: false, cardsMin: false });
}
function syncRaidVars() {
  const t = $("cbtop"), bar = $("cbbar"), root = document.documentElement.style;
  const r = t && t.firstElementChild ? t.firstElementChild.getBoundingClientRect() : null;
  root.setProperty("--rs-cbtop", `${r && r.height ? Math.round(r.bottom) : 0}px`);
  root.setProperty("--rs-cbbar", `${bar ? Math.round(bar.offsetHeight) : 0}px`);
}
const redraw = () => { const g = window.game; if (g && g.refresh) g.refresh(); };
// The strip's ⋯ and its status button, the sheet's handle (data-rs: no main.js action), the guide note's title.
function onRaidTap(e) {
  const t = e.target;
  if (!t || !t.closest) return;
  const b = t.closest("[data-rs]");
  if (b) {
    const k = b.dataset.rs;
    if (k === "info") { RAIDUI.info = !RAIDUI.info; RAIDUI.view = false; }
    else if (k === "view") { RAIDUI.view = !RAIDUI.view; RAIDUI.info = false; }
    else if (k === "sheet") RAIDUI.cardsMin = !RAIDUI.cardsMin;
    redraw();
    return;
  }
  const gh = t.closest("#guidetip .gd-head");
  if (gh && !t.closest("button, a")) $("guidetip").classList.toggle("rs-gdopen");
}
// A tap anywhere but the open drop-down (or its button) closes it.
function outsideRaid(e) {
  if (!RAIDUI.info && !RAIDUI.view) return;
  if (e.target.closest && e.target.closest(".rs-ctdrop, [data-rs=info], [data-rs=view]")) return;
  RAIDUI.info = RAIDUI.view = false;
  redraw();
}

// ---------- the strip over the map: phones and tablets held upright ----------
// The boxes over the State Map covered most of a phone's map when they were open (the user's request 2026-10-24). With
// the drawers they are closed by default and a strip of chips across the top of the map, under the top bar, carries
// their counts: 🔔 Alerts (red with an urgent one), 🚶 Orders (or "N waiting"), 👁 Watching, 🗺 Layers (how many are
// on), ▣ Minimap, 🧭 First week (while the guide is on). A tap opens that one box as a sheet under the strip; the chip
// again, another chip or a tap on the dimmed map closes it; one at a time. The chips go through the boxes' own fold
// state (main.js "panel-toggle" for the alerts, orders and Layers, ui/layout.js setFolded; "wl-collapse" for
// Watching), so the keys, the pad, autoReveal and the saved layout keep working: a new urgent alert opens the alerts
// sheet by itself while Options → "Auto-open panels on select" is on (ui/layout.js autoReveal), and the 🔔 chip
// flashes either way (the alerts' own 4-second flash line is a toast at the foot of the map while neither the alerts
// nor the guide sheet is open; responsive.css). The minimap's sheet and
// the guide's are the strip's own (hudMini, hudGuide): Options → Display → Minimap says whether there is a minimap at
// all (off: no chip), and the guide's own fold is its one-line form. Whatever was open before the strip came up is put
// back when the window grows. The boxes have fixed slots here (responsive.css) and do not drag (ui/overlaydrag.js
// setOverlaysFixed); a chip is a long press from its description.
const HUD = [
  ["alerts", "🔔", "Alerts", "What needs you now: a team waiting, food or water running low, a horde near a base, someone sick… Red when something is urgent. Tap an alert to go there"],
  ["orders", "🚶", "Orders", "Your teams out: what each is doing and how long it has left. Tap a team for its panel"],
  ["watch", "👁", "Watching", "What you pinned with 📌 (a person, a team, a horde, a group, a base) with its status live, and your map notes"],
  ["legend", "🗺", "Layers", "The map's layers: switch each on or off (the count is how many are on)"],
  ["minimap", "▣", "Minimap", "The whole state as far as you know it: tap or drag on it to look there"],
  ["guide", "🧭", "First week", "The first-week guide: steps for a new holdout, ticked off as you do them, with Show me"],
];
const HUD_BOXES = ["alerts", "orders", "watchlist", "legend", "minimap", "mm-show"]; // watched for a change (a redraw, a fold, the minimap shown)
let hud = false;              // the strip is up
let hudSaved = null;          // the boxes open before it came up ({ key: true }), put back when it goes
let hudOpen = new Set();      // the boxes open at the last sync: a fresh one closes the others
let hudShown = new Set();     // the chips shown at the last sync: a box that comes unfolded (the first 📌 pin) starts closed here
let hudGuide = false, hudMini = false; // the guide's and the minimap's sheets
let hudFor = null;            // the game the sheets belong to: a new game starts with everything closed again
let hudObs = null, hudSizeObs = null, hudRaf = 0;
let dangerSeen = null;        // the danger alerts' keys at the last sync: a new one flashes 🔔

// The box's own flag, open or not, whatever is on the screen (ui/layout.js's layout, the campaign's watch list).
function rawOpen(k) {
  const g = window.game;
  if (!g) return false;
  if (k === "watch") { const w = g.state && g.state.watchList; return !!w && !w.collapsed; }
  return !!g.layout && !g.layout[k];
}
// What each chip shows and whether its sheet is open, from the game and the boxes as drawn.
function hudState() {
  const g = window.game, st = g && g.state, ui = g && g.ui;
  const live = !!(ui && ui.started && st && !st.combat && !st.gameOver && !ui.timelapse);
  const parties = live ? st.parties.filter((p) => p.owner === "player" && p.kind !== "convoy") : [];
  const waiting = parties.filter((p) => p.phase === "waiting").length;
  const w = live ? st.watchList : null, pins = w && w.items ? w.items.length : 0, notes = live && st.mapNotes && st.mapNotes.list ? st.mapNotes.list.length : 0;
  const alerts = live && ui.alertList ? ui.alertList : [];
  const danger = alerts.filter((a) => a && a.tone === "danger").map((a) => a.key);
  const lg = $("legend"), lgBadge = lg && lg.querySelector(".fp-badge");
  const al = $("alerts"), gd = al && al.querySelector(".guide"), gdCount = gd && gd.querySelector(".gd-count");
  const mm = $("minimap"), mmOn = !!(mm && !mm.classList.contains("hidden"));
  return {
    alerts: { show: live, open: live && rawOpen("alerts"), n: alerts.length, danger: danger.length > 0, keys: danger },
    orders: { show: live && parties.length > 0, open: live && rawOpen("orders"), n: parties.length, waiting },
    watch: { show: live && pins + notes > 0, open: live && rawOpen("watch"), n: pins + notes },
    legend: { show: live, open: live && rawOpen("legend"), n: lgBadge ? lgBadge.textContent : "" },
    minimap: { show: live && mmOn, open: live && mmOn && hudMini, n: "" },
    guide: { show: live && !!gd, open: live && !!gd && hudGuide, n: gdCount ? gdCount.textContent : "" },
  };
}
// Opens or closes one box the way its own control would (its key, its tab, the pad).
function hudSet(k, on) {
  if (k === "guide") { hudGuide = !!on; return; }
  if (k === "minimap") { hudMini = !!on; return; }
  if (k === "watch") { if (rawOpen("watch") !== !!on) act("wl-collapse", { v: on ? "0" : "1" }); return; }
  if (rawOpen(k) !== !!on) act("panel-toggle", { p: k, v: on ? "0" : "1" });
}
const hudOpenKeys = (S) => Object.keys(S).filter((k) => S[k].show && S[k].open);
function hudCloseAll(S = hudState(), except = null) { for (const k of hudOpenKeys(S)) if (k !== except) hudSet(k, false); }

function enterHud() {
  if (hud) return;
  hud = true;
  hudSaved = Object.fromEntries(["alerts", "orders", "legend", "watch"].map((k) => [k, rawOpen(k)]));
  for (const k of Object.keys(hudSaved)) if (hudSaved[k]) hudSet(k, false); // everything closed: the chips carry the counts
  hudFor = window.game ? window.game.state : null;
  hudGuide = hudMini = false;
  hudOpen = new Set();
  hudShown = new Set();
  dangerSeen = null;
  const wrap = $("mapwrap");
  if (!wrap) return;
  const strip = el("nav", { id: "rs-hud", class: "hidden", "aria-label": "The boxes over the map" }, HUD.map(([k, ic, name, t]) =>
    `<button class="rs-hc hidden" data-hud="${k}" aria-expanded="false" data-tip="${t}"><span class="rs-ic" aria-hidden="true">${ic}</span><span class="rs-hl">${name}</span><b class="rs-badge hidden"></b></button>`).join(""));
  strip.addEventListener("click", onHudTap);
  wrap.appendChild(strip);
  const scrim = el("div", { id: "rs-hudscrim", "aria-hidden": "true" });
  scrim.addEventListener("click", () => { hudCloseAll(); syncHud(); });
  wrap.appendChild(scrim);
  body().classList.add("rs-hud");
  setOverlaysFixed(true);
  hudObs = new MutationObserver(queueHud);
  for (const id of HUD_BOXES) if ($(id)) hudObs.observe($(id), { childList: true, attributes: true, attributeFilter: ["class", "data-fold"] });
  if (typeof ResizeObserver !== "undefined") { hudSizeObs = new ResizeObserver(syncHudTop); hudSizeObs.observe(strip); }
  syncHud();
}
function leaveHud() {
  if (!hud) return;
  hud = false;
  if (hudObs) hudObs.disconnect();
  if (hudSizeObs) hudSizeObs.disconnect();
  hudObs = hudSizeObs = null;
  if (hudRaf) { cancelAnimationFrame(hudRaf); hudRaf = 0; }
  drop("rs-hud");
  drop("rs-hudscrim");
  body().classList.remove("rs-hud");
  delete body().dataset.rshud;
  const app = $("app");
  if (app) app.style.removeProperty("--rs-hud");
  setOverlaysFixed(false);
  // What was open before the strip came up (the Watching panel: the same campaign's only).
  if (hudSaved) for (const k of Object.keys(hudSaved)) if (hudSaved[k] && (k !== "watch" || (window.game && window.game.state === hudFor))) hudSet(k, true);
  hudSaved = null;
  hudFor = null;
  hudGuide = hudMini = false;
}
function queueHud() { if (hud && !hudRaf) hudRaf = requestAnimationFrame(() => { hudRaf = 0; syncHud(); }); }
function syncHud() {
  if (!hud) return;
  const strip = $("rs-hud");
  if (!strip) return;
  const g = window.game;
  // A new game: its own Watching panel starts closed too, and none of its danger alerts counts as new.
  if (g && g.state !== hudFor) { hudFor = g.state; hudGuide = hudMini = false; dangerSeen = null; hudShown = new Set(); if (rawOpen("watch")) hudSet("watch", false); }
  let S = hudState();
  // A box that comes into being unfolded (the Watching panel on the first 📌 pin) starts closed here: its chip is the way in.
  const shown = Object.keys(S).filter((k) => S[k].show);
  for (const k of shown) if (!hudShown.has(k) && hudShown.size && S[k].open && !hudOpen.has(k) && k === "watch") hudSet(k, false);
  hudShown = new Set(shown);
  S = hudState();
  // One sheet at a time: the one just opened (a chip, a key, the pad, a new urgent alert) closes the rest.
  const open = hudOpenKeys(S);
  if (open.length > 1) {
    const fresh = open.filter((k) => !hudOpen.has(k));
    hudCloseAll(S, fresh.length ? fresh[fresh.length - 1] : open[open.length - 1]);
    S = hudState();
  }
  const now = hudOpenKeys(S);
  hudOpen = new Set(now);
  if (now.length) body().dataset.rshud = now[0]; else delete body().dataset.rshud;
  // The chips: one while its box has anything to show, lit while its sheet is open, the count on a badge.
  let any = false;
  for (const b of strip.querySelectorAll(".rs-hc")) {
    const k = b.dataset.hud, s = S[k];
    b.classList.toggle("hidden", !s.show);
    if (!s.show) continue;
    any = true;
    b.classList.toggle("active", s.open);
    b.setAttribute("aria-expanded", String(s.open));
    const bd = b.querySelector(".rs-badge"), lb = b.querySelector(".rs-hl");
    const n = String(s.n ?? "");
    if (bd.textContent !== n) bd.textContent = n;
    bd.classList.toggle("hidden", !n || n === "0");
    const red = k === "alerts" && s.danger;
    bd.classList.toggle("danger", red);
    b.classList.toggle("danger", red);
    if (k === "orders") { const t = s.waiting ? `${s.waiting} waiting` : "Orders"; if (lb.textContent !== t) lb.textContent = t; lb.classList.toggle("warn", s.waiting > 0); }
  }
  strip.classList.toggle("hidden", !any);
  syncHudTop();
  const keys = new Set(S.alerts.keys);
  if (dangerSeen && [...keys].some((k) => !dangerSeen.has(k))) flashChip("alerts");
  dangerSeen = keys;
}
// The 🔔 chip flashes for a new urgent alert (as long as the alerts' flash line, ui/alerts.js; nothing with Reduce motion).
function flashChip(k) {
  const b = strip().querySelector(`.rs-hc[data-hud="${k}"]`);
  if (!b) return;
  b.classList.remove("rs-flash");
  void b.offsetWidth; // restart the animation
  b.classList.add("rs-flash");
  setTimeout(() => b.classList.remove("rs-flash"), 4000);
}
const strip = () => $("rs-hud") || el("div");
// The strip's height, for the sheets and the banners under it (responsive.css --rs-hud).
function syncHudTop() {
  const app = $("app"), s = $("rs-hud");
  if (!app || !s) return;
  const h = s.classList.contains("hidden") ? 0 : s.getBoundingClientRect().height;
  app.style.setProperty("--rs-hud", `${Math.round(h)}px`);
}
// A chip: its sheet open (the others closed, and the drawers: one thing over the map at a time) or closed again.
function onHudTap(e) {
  const b = e.target.closest && e.target.closest(".rs-hc");
  if (!b) return;
  const k = b.dataset.hud, S = hudState(), open = !!(S[k] && S[k].open);
  hudCloseAll(S, k);
  hudSet(k, !open);
  if (!open) for (const p of DRAWERS) if (isOpen(p)) act("panel-toggle", { p, v: "1" });
  syncHud();
}

// ---------- the map's keys, as buttons ----------
// ◀ ❗ Next team: the teams waiting for orders, one after another (main.js "team-next", ui/alerts.js nextWaitingTeam;
// the count as on the dock's Lists). 📷 Spots: camera spots 1–9 (main.js "cam-spot", ui/alerts.js camSpot): a tap
// goes to a saved spot or saves the view on an empty one; with "Save here" lit, a tap saves the view on any number.
// On a phone the spots sit open in the ⋯ drop-down; on a tablet 📷 drops them down under the top bar.
function buildKeys() {
  if ($("rs-keys")) return;
  const nums = Array.from({ length: 9 }, (_, i) => `<button class="rs-cam" data-action="cam-spot" data-n="${i + 1}" aria-label="Camera spot ${i + 1}">${i + 1}</button>`).join("");
  const k = el("div", { id: "rs-keys", class: "row" },
    `<span class="rs-team"><button data-action="team-next" data-back="1" aria-label="Previous team waiting for orders" data-tip="The team before, of those waiting for orders (Shift+N)">◀</button>` +
    `<button data-action="team-next" aria-label="Next team waiting for orders" data-tip="The next team waiting for orders: the map goes to it and its panel opens (N)">❗ Next team<b class="rs-badge hidden"></b></button></span>` +
    `<span class="rs-spots"><button id="rs-cambtn" aria-expanded="false" aria-controls="rs-cams" data-tip="Camera spots: views of the map to come back to (Shift+1–9 go, Ctrl+1–9 save)">📷 Spots</button>` +
    `<span id="rs-cams" role="group" aria-label="Camera spots"><span class="rs-camh">Camera spots</span><span class="rs-camgrid">${nums}</span>` +
    `<button id="rs-camsave" aria-pressed="false" data-tip="Then tap a number: this view is saved there">Save here…</button></span></span>`);
  k.querySelector("#rs-cambtn").addEventListener("click", (e) => { e.stopPropagation(); setCams(!body().classList.contains("rs-cams")); });
  k.querySelector("#rs-camsave").addEventListener("click", (e) => { e.stopPropagation(); setSave(!saving); });
  // Before main.js's click listener (on the document): the number says save or go. After it: the lit numbers.
  k.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".rs-cam");
    if (!b) return;
    b.dataset.save = saving || !spotSaved(b.dataset.n) ? "1" : "";
    setTimeout(() => { setSave(false); if (mode !== "phone") setCams(false); }, 0);
  });
  body().appendChild(k);
  document.addEventListener("pointerdown", outsideCams, true);
  syncKeys();
}
let saving = false;
function setSave(on) {
  saving = !!on;
  const b = $("rs-camsave");
  if (b) { b.classList.toggle("active", saving); b.setAttribute("aria-pressed", String(saving)); b.textContent = saving ? "Tap a number to save" : "Save here…"; }
}
function spotSaved(n) {
  const g = window.game, sp = g && g.ui && g.ui.camSpots && g.ui.camSpots[n];
  return !!(sp && g.state && sp.seed === g.state.seed);
}
function setCams(on) {
  body().classList.toggle("rs-cams", !!on);
  const b = $("rs-cambtn");
  if (b) b.setAttribute("aria-expanded", String(!!on));
  if (!on) setSave(false);
  syncKeys();
}
function outsideCams(e) {
  if (!body().classList.contains("rs-cams")) return;
  if (e.target.closest && e.target.closest("#rs-cams, #rs-cambtn")) return;
  setCams(false);
}
// The count of teams waiting for orders on ❗ Next team: main.js, each redraw while touchUI().
let waitingN = 0;
export function setKeysBadge(n) {
  if (n === waitingN) return;
  waitingN = n;
  syncKeys();
}
// The saved spots lit, the count of teams waiting.
function syncKeys() {
  const k = $("rs-keys");
  if (!k) return;
  for (const b of k.querySelectorAll(".rs-cam")) b.classList.toggle("on", spotSaved(b.dataset.n));
  const t = waitingN > 0 ? String(waitingN) : "";
  const bd = k.querySelector(".rs-badge");
  if (bd && bd.textContent !== t) bd.textContent = t;
  if (bd) bd.classList.toggle("hidden", !t);
}
// In the ⋯ drop-down on a phone, else at the end of the top bar.
function placeKeys() {
  const k = $("rs-keys");
  if (!k) return;
  const slot = mode === "phone" ? $("rs-keyslot") : $("topbar");
  if (slot && k.parentNode !== slot) slot.appendChild(k);
  setCams(false);
}
