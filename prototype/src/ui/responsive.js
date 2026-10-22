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
//   keys      what only a key did on the map: ◀ ❗ Next team (Shift+N / N) and the camera spots (Shift+1–9 go,
//             Ctrl+1–9 save), in the ⋯ drop-down on a phone and in the top bar on a tablet. Other modules ask
//             touchUI() to add their own (Cancel on the pick banners, main.js; the Work tab's picker, ui/work.js)
// Gestures (pan, pinch, long press) are ui/touch.js's.

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
export const pickCancel = (what) => (touchUI() ? ` <button class="mini" data-action="pick-cancel" data-what="${what}" data-tip="Cancel (Esc)">✕ Cancel</button>` : "");
let drawers = false; // the dock and the drawers are up
let saved = null;    // which drawers were folded before (put back when the window grows again)
let legendFolded = false; // the phone folded the Layers box (opened again when it grows)
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
}
function leaveDrawers() {
  drawers = false;
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
// One drawer at a time: the one just opened (a dock button, a key, a tile picked, a tab switched) folds the others.
function onBodyClass() {
  if (!drawers) return;
  const now = DRAWERS.filter(isOpen);
  const fresh = now.filter((p) => !lastOpen.has(p));
  const keep = fresh.length ? fresh[fresh.length - 1] : null;
  if (keep) for (const p of now) if (p !== keep) act("panel-toggle", { p, v: "1" });
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
  const more = el("button", { id: "rs-morebtn", "aria-label": "More", "aria-expanded": "false", "aria-controls": "rs-more", "data-tip": "Ledger, Diary, Roster, Codex, Search, Help, the threat forecast" }, "⋯");
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
  // The Layers box is a third of a phone's map: folded to its tab (the player opens it as on a desktop).
  const lg = $("legend");
  legendFolded = !!(lg && lg.dataset.fold !== "1");
  if (legendFolded) act("panel-toggle", { p: "legend", v: "1" });
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
  if (legendFolded) act("panel-toggle", { p: "legend", v: "0" });
  legendFolded = false;
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
  x.classList.toggle("hidden", !win);
  if (!win) return;
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
