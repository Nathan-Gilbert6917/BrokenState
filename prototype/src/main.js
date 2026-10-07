// Entry point: game loop, input, and the action dispatcher that connects the UI to the simulation.
import {
  createWorld, tickHour, hub, survivorById, baseById, log, day, atBase, factionById, addCard, newId, renameSurvivor, assignStartingRoles,
} from "./sim/world.js";
import { GEAR, SUPPLIES, SUPPLY_KEYS } from "./sim/data.js";
import * as Parties from "./sim/parties.js";
import { launchExpedition, estimateTrip, ordersCard, orderMove, startReturn, planPath, partyTile } from "./sim/parties.js";
import { stockHas } from "./sim/water.js"; // purified and un-purified water
import { armoryTabs, TABS_TRIP_DAYS } from "./sim/worm.js"; // purification tablets for the road
import { searchHour, extract } from "./sim/scavenge.js";
import * as TradeSim from "./sim/trade.js";
import { executeTrade, giftAll, proposePact, endTrade, radioTalk } from "./sim/trade.js";
import { releaseEscorts, ESCORTS } from "./sim/economy.js";
import { queueBuild, cancelBuild, assignStations, queueBarrelUpgrade, setBarrelHolds, demolish } from "./sim/buildings.js";
import { refuel, repair } from "./sim/vehicles.js";
import { buryBody, burnBodyHome } from "./sim/carriers.js"; // bodies brought home in a team's car
import {
  saveSupplyRun, dispatchSupplyRun, supplyRunById, jobForm, releaseHeld, pauseSupplyRun, deleteSupplyRun,
} from "./sim/supply.js";
import { treatAtBase } from "./sim/medical.js";
import { queueCraft, cancelCraft, craftQueue } from "./sim/crafting.js";
import { initRenderer, render, resize, centerOn, screenToTile, zoomAt, camera, view, tileTooltip, resetView, mapLoc } from "./ui/render.js";
import { topbarParts, renderLeft, renderRight, renderLog, renderModal, modalKind, renderLegend, tileActions, plannerLoad, plannerVehicle, routeCheck } from "./ui/ui.js";
import { isCar, travelMode } from "./sim/vehicles.js";
import { startCombat, combatAct, runEnemyPhase } from "./sim/combat.js";
import { queueOrder, startOrder, stopTask, resumeQueue, removeQueued, reorderQueued, cancelMove, contactable, queueEndTile } from "./sim/orders.js";
import { setFire } from "./sim/fieldheat.js";
import { commandable, NO_RADIO } from "./sim/plans.js";
import { PLAN_ACTIONS, PLAN_CHANGE, planAutofill, planLaunchOpts, applyPreset } from "./ui/plan.js";
import { orderSweepAt, sweepOpts } from "./sim/survey.js";
import { renderRunningOrders, armedList } from "./ui/expedition.js";
import { boatOrder, boatPlan, boatTip, crossingTo } from "./sim/crossing.js";
import { fishSpot, gameAbundance } from "./sim/hunting.js";
import { forageAbundance } from "./sim/foraging.js";
import { woodAbundance } from "./sim/woodcutting.js";
import { canClaim, wellProblem, CLAIM } from "./sim/claims.js"; // land claims and wells (the right-click menu)
import { initCombatUI, drawCombat, renderCombatPanel, combatTick, combatMouse, combatClick, combatKey, combatKeyUp, combatAction, combatPress, combatRelease, combatWheel, combatLeave, cui } from "./ui/combat.js";
import { LOOK_ACTIONS, LOOK_CHANGE_ACTIONS, crewSnapshot, randomizeAllCrew } from "./ui/newgame.js";
import { DEFAULT_SIZE, sizeDef, clampGroups, clampHives, customDef, clampCustomW, clampCustomH, BASE_W, BASE_H } from "./sim/worldsize.js";
import { INV_ACTIONS, INV_CHANGE, invDrop } from "./ui/inventory.js";
import { FARM_ACTIONS, FARM_CHANGE } from "./ui/farming.js";
import { PROD_ACTIONS, PROD_CHANGE } from "./ui/production.js";
import { HEALTH_ACTIONS, HEALTH_CHANGE } from "./ui/health.js";
import { SKILL_ACTIONS, SKILL_CHANGE } from "./ui/skills.js";
import { TRADE_ACTIONS, TRADE_CHANGE_ACTIONS } from "./ui/tradewindow.js";
import { VISITOR_ACTIONS } from "./ui/visitors.js";
import { DIPLO_ACTIONS, DIPLO_CHANGE } from "./ui/diplomacy.js";
import { renderDevPanel, devSample, DEV_SPEEDS } from "./ui/devtools.js";
import { TL_ACTIONS, tlFrame, tlKey, closeTimelapse } from "./ui/timelapse.js";
import { REL_ACTIONS } from "./ui/relations.js";
import { PRISON_ACTIONS, PRISON_CHANGE } from "./ui/prisoners.js";
import { setAutopilot, setPersonality, autopilotResolve } from "./sim/autopilot.js";
import { playerTile } from "./sim/hardcore-start.js";
import { setTeamPolicy } from "./sim/breakoff.js";
import { noteNames } from "./ui/names.js";
import { renderLogPanel, DIARY_ACTIONS, DIARY_CHANGE } from "./ui/diary.js";
import { renderAlerts, ALERT_ACTIONS, mapHotkey } from "./ui/alerts.js";
import { ROSTER_ACTIONS, ROSTER_CHANGE } from "./ui/roster.js";
import { EXPLORE_ACTIONS, EXPLORE_CHANGE } from "./ui/explore.js";
import { LOCK_ACTIONS } from "./ui/locks.js";
import { CRAWL_ACTIONS } from "./ui/citycrawl.js";
import { NEEDS_ACTIONS } from "./ui/needs.js";
import { LISTEN_ACTIONS } from "./ui/radiolisten.js"; // Listen in on radio traffic: a team order, a base's set (sim/radiolisten.js)
import { activeCrawl } from "./sim/citycrawl.js";
import { SETTINGS_ACTIONS, SETTINGS_CHANGE, initSettings, openSettings, autosaveCheck, autosaveState, unsaved, inDesktopApp } from "./ui/settings.js";
import { loadOptions, saveOptions } from "./ui/saves.js";
import { initTitle, showTitle, syncTitle, titleFrame, titleKey, titleCovers, TITLE_ACTIONS } from "./ui/title.js"; // the title screen the game opens on
import { WORK_ACTIONS, WORK_CHANGE, workKey, applyRoleChoice } from "./ui/work.js";
import { toManual } from "./sim/work.js";
import {
  loadLayout, saveLayout, setFolded, setShut, toggleAll, resetLayout, autoReveal, newDangerAlerts, alertsPill, alertsFoldButton, windowFrame,
} from "./ui/layout.js";
import { initPanels, applyLayout, setLogLine, fitWindows, resetWindows, windowSizes, watchFloating } from "./ui/windows.js";

const HOURS_PER_SECOND = 1 / 20; // at 1× speed an hour takes 20 seconds and a day 8 minutes
const MAX_SPEED = 3;            // the fastest normal speed; anything above is a dev fast-forward
const SLOW_REFRESH_MS = 250;    // above MAX_SPEED the panels are redrawn about 4 times a second, not every tick

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Orders given while the game is paused wait for the clock: parties touched (id -> how long their queue was
// before), construction and craft jobs queued. Cleared as soon as an hour passes. The banner counts them.
const newArmed = () => ({ parties: new Map(), builds: new Set(), crafts: new Set() });

// Everything about one run of the game. A new world (new campaign, new seed, new map) starts from these again;
// the interface size, the group count and the collapsed panels are the player's preferences and stay.
const freshUi = () => ({
  started: false, speed: 0, lastSpeed: 1, tab: "bases", selected: -1,
  planner: null, plannerError: "", routeSetup: null, survivor: null, cardResult: null, tradeMsg: "",
  baseView: null, baseMsg: "", moveParty: null, moveMsg: "", supplyForm: null, supplyError: "",
  expedition: null, xpMsg: "", xpQueue: false, moveQueue: false, qSel: null, // team panel and order queue (qSel: the selected queued order)
  inv: null, invSel: null, invMsg: "", // inventory / loot screen (ui/inventory.js)
  lookEdit: null, zombieLook: false, nrMsg: "", timelapse: null,
  dev: false, showFps: false, armed: newArmed(),
  radioWith: null, radioMsg: "", radioDeal: null, caravanPlan: null, cvMsg: "", attackConfirm: null, // ui/tradewindow.js
  settings: null, slot: null, savedMark: null, // ui/settings.js: the menu, the save slot this game uses, when it was last saved
});
const ui = { title: false, scale: 1, factionCount: 7, worldSize: DEFAULT_SIZE, customW: BASE_W, customH: BASE_H, hiveCount: null, mode: "normal", crewEdited: false, crewRoll: null, ...freshUi() }; // mode: Normal or Hardcore (sim/hardcore.js)
// Folded panels and their widths (ui/layout.js), remembered in the browser. The Layers box and the running orders
// keep their old ui flags, which read and write the layout.
const layout = loadLayout();
for (const [prop, p] of [["legendCollapsed", "legend"], ["ordersCollapsed", "orders"]]) {
  Object.defineProperty(ui, prop, { enumerable: true, get: () => layout[p], set: (v) => { layout[p] = !!v; saveLayout(layout); } });
}
// The Options tab (ui/settings.js), remembered in the browser (ui/saves.js): autosave, confirmations, pause on focus loss, UI size.
const options = loadOptions();
ui.scale = options.uiScale;
if (ui.scale !== 1) document.documentElement.style.setProperty("--ui-scale", ui.scale);
let state = createWorld({ seed: randomSeed(), factionCount: ui.factionCount, size: ui.worldSize });
let dirty = true;      // a tick changed something: redraw the panels (throttled at dev speeds)
let dirtyNow = false;  // the player did something on the map: redraw on the next frame

function randomSeed() {
  return Math.floor(Math.random() * 1e6);
}
// Seeds are whole positive numbers.
function cleanSeed(v) {
  const n = Math.floor(Math.abs(Number(v)));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 999999999) : 1;
}

const $ = (id) => document.getElementById(id);
const canvas = $("map");
// The top bar's slots (index.html). Built here when the page does not have them.
if (!$("tb-clock")) {
  $("topbar").innerHTML = `<span class="title">BROKEN STATE</span><span class="clock" id="tb-clock"></span><span class="speed row" id="tb-speed"></span>
    <span class="stock" id="tb-stock"></span><span id="tb-people"></span><span class="row small" id="tb-tools"></span>`;
}
// The alerts stack on the map (index.html has it; built here when the page does not).
if (!$("alerts")) {
  const al = document.createElement("div");
  al.id = "alerts";
  al.className = "hidden";
  $("mapwrap").appendChild(al);
}
// The bars between the map and its panels, the map-only button and resizable windows (ui/windows.js), set up before
// the map measures itself so a folded panel's room is the map's from the start.
initPanels({ layout, relayout: (fn) => relayout(fn), refresh: () => { dirtyNow = true; } });
initRenderer(canvas);
initCombatUI($("combatmap"));
// The map follows its box whatever changes it (a panel folded or dragged wider, the UI size).
if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => {
    const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    if (Math.round(r.width * d) !== canvas.width || Math.round(r.height * d) !== canvas.height) resize();
  }).observe(canvas);
}
centerOn(state, playerTile(state));

// ---------- loop ----------
let last = performance.now();
let acc = 0;
let lastRefresh = 0;
const paused = () => ui.started && ui.speed === 0;
function blocked() {
  // On autopilot the governor answers cards, runs searches and trades itself (sim/autopilot.js), so they do not stop the clock.
  const pending = !state.autopilot && (state.cards.length > 0 || !!state.engagement || !!state.trade || !!activeCrawl(state)); // activeCrawl: a city crawl's block card (sim/citycrawl.js)
  return !ui.started || !!state.combat || state.gameOver || !!ui.cardResult || pending ||
    !!ui.planner || !!ui.routeSetup || ui.radioWith != null || !!ui.caravanPlan || !!ui.survivor || !!ui.memorial || !!ui.baseView || !!ui.zombieLook || !!ui.inv || !!ui.timelapse || !!ui.diary || !!ui.roster || !!ui.settings;
}

// One exception must not stop the game for good: it is logged once (per message) and the loop goes on.
const frameErrors = new Map();
function frame(now) {
  try {
    step(now);
  } catch (e) {
    const key = String(e && e.message);
    const n = (frameErrors.get(key) || 0) + 1;
    frameErrors.set(key, n);
    if (n === 1 && frameErrors.size <= 10) console.error("Broken State: error in the frame loop (logged once; the loop keeps running):", e);
  }
  requestAnimationFrame(frame);
}

function step(now) {
  const t0 = ui.showFps ? performance.now() : 0;
  const gap = now - last;
  const dt = Math.min(0.25, gap / 1000);
  last = now;
  let ticks = 0;
  if (state.autopilot && ui.started && !ui.settings && autopilotResolve(state)) dirty = true; // cards and battles never wait for a click (the menu holds everything)
  if (!blocked() && ui.speed > 0 && !ui.moveParty) {
    acc += dt * ui.speed * HOURS_PER_SECOND;
    while (acc >= 1 && ticks < 12) {
      tickHour(state);
      acc -= 1;
      ticks++;
      dirty = true;
      if (blocked()) {
        acc = 0;
        break;
      }
    }
    if (ticks >= 12) acc = Math.min(acc, 1); // too slow to keep up: drop the backlog instead of running on after a speed change
    if (ticks) ui.armed = newArmed();        // time moved: nothing is waiting for the unpause any more
  }
  // The minutes of the coming hour tick by on the clock, and your moving teams glide towards their next tile by them.
  view.hourFrac = Math.max(0, Math.min(0.999, acc));
  const mins = $("tb-min"), mm = String(Math.floor(view.hourFrac * 60)).padStart(2, "0");
  if (mins && mins.textContent !== mm) mins.textContent = mm;
  autosaveCheck(state, ui, settingsApi, now); // dawn, a hive assault, the end of the run (ui/settings.js)
  if (ui.timelapse) tlFrame(state, ui, now); // recorded frames instead of the live map (ui/timelapse.js)
  else if (state.combat) {
    if (!ui.settings && combatTick(state, now)) dirtyNow = true; // the enemy turn waits while the menu is open
    drawCombat(state, now);
  } else if (!titleCovers(ui)) render(state); // the title screen hides the map (unless the map is its background)
  if (ui.title) titleFrame(state, ui, now);
  if (dirtyNow || (dirty && (ui.speed <= MAX_SPEED || now - lastRefresh >= SLOW_REFRESH_MS))) refresh(false);
  if (ui.showFps) fpsFrame(now, gap, performance.now() - t0, ticks);
}

// ---------- drawing the panels ----------
// Each panel keeps the HTML it shows; a refresh that produces the same string leaves the DOM alone, so buttons
// stay clickable and hover descriptions stay up while the clock runs. A panel is not rebuilt while the mouse
// button is down on it (the click would be lost), nor under an open drop-down when only a tick asked for it.
const PANELS = ["tb-clock", "tb-speed", "tb-stock", "tb-people", "tb-tools", "left", "right", "log", "modal", "legend", "devpanel", "orders", "cbpanel", "banner", "alerts"];
const shown = new Map(); // element id -> the HTML last written
let held = null;         // panel the mouse button went down in
let heldBack = false;    // a rebuild was skipped because of it
let selectFocusAt = 0;   // when a drop-down last took the focus
let modalShown = null;   // which modal is on screen (for keeping its scroll position)

function panelOf(target) {
  for (const id of PANELS) {
    const el = $(id);
    if (el && el.contains && el.contains(target)) return id;
  }
  return null;
}
function selectOpenIn(el) {
  const a = document.activeElement;
  return !!a && a.tagName === "SELECT" && el.contains(a) && performance.now() - selectFocusAt < 20000;
}
// Writes a panel's HTML if it changed. Returns true when the DOM was touched.
function setHTML(id, html, user) {
  const el = $(id);
  if (!el || shown.get(id) === html) return false;
  if (held === id || (!user && selectOpenIn(el))) {
    heldBack = true;
    return false;
  }
  el.innerHTML = html;
  shown.set(id, html);
  return true;
}
function setPanel(id, html, user) {
  const wrote = setHTML(id, html, user);
  const el = $(id);
  if (el && (wrote || shown.get(id) === html)) el.classList.toggle("hidden", !html);
  return wrote;
}
function releaseHold() {
  held = null;
  if (heldBack) { heldBack = false; dirtyNow = true; }
}
document.addEventListener("mousedown", (e) => {
  const t = e.target;
  // A drop-down is guarded by its focus instead (its mouseup may never reach the page).
  held = e.button === 0 && !(t && (t.tagName === "SELECT" || t.tagName === "OPTION")) ? panelOf(t) : null;
}, true);
document.addEventListener("mouseup", releaseHold, true); // the click that follows redraws
document.addEventListener("dragend", releaseHold, true);
document.addEventListener("focusin", (e) => { if (e.target && e.target.tagName === "SELECT") selectFocusAt = performance.now(); });
window.addEventListener("blur", releaseHold);
// Options: pause when the window loses focus; in a browser tab, ask before closing it with progress not saved (the
// desktop app quits through the menu, so it never asks there).
window.addEventListener("blur", () => {
  if (!options.pauseOnBlur || !ui.started || ui.speed === 0) return;
  if (ui.speed <= MAX_SPEED) ui.lastSpeed = ui.speed;
  ui.speed = 0;
  dirtyNow = true;
});
window.addEventListener("beforeunload", (e) => {
  if (!options.confirmQuit || settingsApi.desktop || !unsaved(state, ui) || state.gameOver) return;
  e.preventDefault();
  e.returnValue = "";
});

// Screens and panels that point at something that no longer exists (a lost outpost, a team that got home) close.
function tidyUi() {
  if (ui.baseView && !baseById(state, ui.baseView.id)) { ui.baseView = null; ui.baseMsg = ""; }
  if (ui.supplyForm && (!ui.baseView || !baseById(state, ui.supplyForm.originId))) { ui.supplyForm = null; ui.supplyError = ""; }
  if (ui.survivor != null && !survivorById(state, ui.survivor)) { ui.survivor = null; ui.lookEdit = null; }
  if (ui.expedition != null && !partyById(ui.expedition)) { ui.expedition = null; ui.xpMsg = ""; ui.xpQueue = false; ui.qSel = null; }
  if (ui.qSel != null && (ui.expedition == null || ui.qSel >= (partyById(ui.expedition).orders || []).length)) ui.qSel = null; // the queue got shorter
  if (ui.moveParty != null && !partyById(ui.moveParty)) endMoveMode();
  if (state.combat && ui.inv && !ui.inv.loot && !ui.inv.raid) { ui.inv = null; ui.invSel = null; } // only the loot screen and a raid's search window go over a battle
}

// ---------- folded panels ----------
// Runs fn (which folds, unfolds or resizes panels) and gives the map the room: the canvas is measured again and
// the camera moved so the land under the mouse stays where it was. One redraw, no cache rebuilt.
function relayout(fn) {
  const a = canvas.getBoundingClientRect();
  fn();
  const b = canvas.getBoundingClientRect();
  if (a.left !== b.left || a.top !== b.top || a.width !== b.width || a.height !== b.height) {
    if (!ui.timelapse) { camera.x += (b.left - a.left) / camera.zoom; camera.y += (b.top - a.top) / camera.zoom; }
    resize();
  }
  dirtyNow = true;
}
function foldPanel(p, v) {
  relayout(() => { setFolded(layout, p, v); applyLayout(layout); });
  saveLayout(layout);
}
// Close the left panel, the right panel or the log completely (no strip), or open a closed one (ui/layout.js setShut).
function shutPanel(p, v) {
  relayout(() => { setShut(layout, p, v); applyLayout(layout); });
  saveLayout(layout);
}
// What was picked at the last refresh (autoReveal compares), the danger alerts already seen, and a tile clicked on
// the map since (that shows the right panel even when the same tile is clicked again).
let picked = null, dangerSeen = null, dangerState = null, mapClicked = false, rightToTop = false;
function autoShow() {
  const now = { state, started: ui.started, sel: ui.selected, xp: ui.expedition, tab: ui.tab };
  if (dangerState !== state) { dangerSeen = null; dangerState = state; }
  const d = newDangerAlerts(dangerSeen, ui.alertList);
  dangerSeen = d.seen;
  const show = autoReveal(layout, picked, now, { autoOpen: options.autoOpen, newDanger: d.fresh.length > 0, clicked: mapClicked });
  picked = now;
  mapClicked = false;
  if (!show.length) return;
  relayout(() => { for (const p of show) setFolded(layout, p, false); applyLayout(layout); });
  saveLayout(layout);
  if (show.includes("right")) rightToTop = true; // what was picked, from the top
}
// The alerts stack, or its folded button (ui/layout.js alertsPill).
function alertsHTML(html) {
  if (layout.alerts) return alertsPill(ui.alertList, (/<div class="al-flash">[\s\S]*?<\/div>/.exec(html) || [""])[0]);
  return html.includes('class="al ') ? alertsFoldButton() + html : html;
}

function refresh(user = true) {
  dirty = false;
  dirtyNow = false;
  lastRefresh = last;
  tidyUi();
  noteNames(state);
  const alerts = renderAlerts(state, ui); // the alerts stack on the right of the map (ui/alerts.js); also sets ui.alertList
  autoShow();
  const tb = topbarParts(state, ui);
  setHTML("tb-clock", tb.clock, user);
  setHTML("tb-speed", tb.speed, user);
  setHTML("tb-stock", tb.stock, user);
  setHTML("tb-people", tb.people, user);
  setHTML("tb-tools", tb.tools, user);
  // A folded panel is not drawn (it is drawn again when it opens).
  if (!layout.left) setHTML("left", renderLeft(state, ui), user);
  if (!layout.right) {
    setHTML("right", renderRight(state, ui), user);
    if (rightToTop) { rightToTop = false; $("right").scrollTop = 0; }
  }
  if (!layout.log) setHTML("log", renderLogPanel(state, ui), user); // filters and links (ui/diary.js)
  else setLogLine(state.log && state.log[0] ? String(state.log[0].text || "") : "");
  refreshModal(user);
  setHTML("legend", renderLegend(view, ui, ui.started ? state : null), user);
  if (ui.started) devSample(state);
  setPanel("devpanel", ui.started ? renderDevPanel(state, ui) : "", user);
  setPanel("orders", ui.started ? renderRunningOrders(state, ui) : "", user);
  setPanel("alerts", alertsHTML(alerts), user);
  renderCombat(user);
  setPanel("banner", bannerHTML(), user);
  syncTitle(state, ui); // ui/title.js
  $("banner").classList.toggle("dev", !!ui.dev);
  const fps = $("fps");
  if (fps) {
    fps.classList.toggle("hidden", !ui.showFps);
    fps.classList.toggle("fixed", !!state.combat);
  }
  if (tipTarget && tipTarget.isConnected === false) hideTip(); // only when the hovered element was replaced
}

function refreshModal(user) {
  const html = windowFrame(renderModal(state, ui), modalKind(state, ui)); // big windows get resize grips (ui/layout.js)
  const modal = $("modal");
  if (!html) {
    modal.classList.add("hidden");
    if (shown.get("modal")) { modal.innerHTML = ""; shown.set("modal", ""); }
    modalShown = null;
    return;
  }
  const kind = `${modalKind(state, ui)}${ui.baseView ? `:${ui.baseView.id}:${ui.baseView.tab}:${ui.supplyForm ? "form" : ""}` : ""}`;
  if (shown.get("modal") !== html) {
    // The same screen redrawn keeps its scroll position (the whole box, and the base screen's body).
    const same = kind === modalShown;
    const box = modal.querySelector(".box"), body = modal.querySelector(".basebody");
    const boxTop = same && box ? box.scrollTop : 0, bodyTop = same && body ? body.scrollTop : 0;
    if (setHTML("modal", html, user)) {
      modalShown = kind;
      fitWindows(); // the size and place the player gave this kind of window (ui/windows.js)
      const nb = modal.querySelector(".box"), nbody = modal.querySelector(".basebody");
      if (nb && boxTop) nb.scrollTop = boxTop;
      if (nbody && bodyTop) nbody.scrollTop = bodyTop;
      const elog = $("elog");
      if (elog) elog.scrollTop = elog.scrollHeight;
    }
  }
  modal.classList.remove("hidden");
  modal.classList.toggle("over-combat", !!state.combat); // the loot screen sits on top of the battle
}

// Tactical battle overlay.
function renderCombat(user) {
  const box = $("combat");
  if (!state.combat) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  if (setHTML("cbpanel", renderCombatPanel(state), user)) {
    const clog = $("cblog");
    if (clog) clog.scrollTop = clog.scrollHeight;
  }
}

// Banners at the top of the map: paused (with the orders waiting for the unpause) and move mode.
function bannerHTML() {
  if (!ui.started || state.gameOver || state.combat || ui.timelapse) return "";
  let html = "";
  if (ui.speed === 0) {
    const waiting = armedList(state, ui);
    const n = waiting.length;
    // One short line; the rest is a hover description and Help → Time ("?").
    html += `<div class="paused" data-tip="The clock is stopped. Orders you give now start when you unpause."><b class="big">Paused</b> <b>Space</b> to run` +
      `<button data-action="speed" data-speed="${ui.lastSpeed || 1}" data-tip="Run at ${ui.lastSpeed || 1}× (Space)">▶ Run</button>` +
      `<button class="mini" data-action="help-open" data-sec="time" data-tip="Help: time, pausing and speeds">?</button>` +
      (n ? `<span class="armed" data-tip="${esc(waiting.join(" · "))}">${n} order${n === 1 ? "" : "s"} will start when you unpause</span>` : "") + `</div>`;
  }
  if (ui.moveParty) {
    html += `<div class="movemode" data-tip="The clock waits until you pick a tile.">Move: <b>click a tile</b> to ${ui.moveQueue ? "queue a move" : "send the team"} · <b>Esc</b> cancels` +
      (ui.moveMsg ? `<br><span class="danger">${esc(ui.moveMsg)}</span>` : "") + `</div>`;
  }
  return html;
}

// ---------- dev tools: frame rate overlay ----------
// Measured in the real frame loop: frames per second and time between frames over the last second, the time
// this script spent per frame, and simulation hours ticked per second. Costs one check per frame when off.
const fpsLog = [];
let fpsShownAt = 0;
function fpsFrame(now, gap, work, ticks) {
  fpsLog.push({ t: now, gap, work, ticks });
  while (fpsLog.length > 2 && now - fpsLog[0].t > 1000) fpsLog.shift();
  if (now - fpsShownAt < 250) return;
  fpsShownAt = now;
  const el = $("fps");
  if (!el) return;
  const rest = fpsLog.slice(1); // each of these frames is measured from the one before it
  const span = Math.max(1, now - fpsLog[0].t);
  const avg = rest.length ? span / rest.length : 0;
  const worst = rest.length ? Math.max(...rest.map((f) => f.gap)) : 0;
  const workAvg = fpsLog.reduce((a, f) => a + f.work, 0) / fpsLog.length, workMax = Math.max(...fpsLog.map((f) => f.work));
  const tps = (rest.reduce((a, f) => a + f.ticks, 0) * 1000) / span;
  el.textContent = `${avg > 0 ? (1000 / avg).toFixed(0) : "–"} FPS\nframe ${avg.toFixed(1)} ms avg · ${worst.toFixed(1)} worst\nscript ${workAvg.toFixed(1)} ms avg · ${workMax.toFixed(1)} worst\nsim ${tps.toFixed(1)} ticks/s`;
}

// ---------- orders given while paused ----------
const partySig = (p) => `${p.phase}|${p.orderStart}|${p.dest}|${p.task ? p.task.type : ""}|${p.mission}|${(p.orders || []).length}`;
// Call before an action; returns what to compare with afterwards (null when the clock is not paused).
function armSnap() {
  if (!paused()) return null;
  const mine = state.parties.filter((p) => p.owner === "player");
  return {
    sig: new Map(mine.map((p) => [p.id, partySig(p)])),
    queue: new Map(mine.map((p) => [p.id, (p.orders || []).length])),
    builds: new Set(state.bases.flatMap((b) => b.construction.map((j) => j.id))),
    crafts: new Set(state.bases.flatMap((b) => craftQueue(b).map((j) => j.id))),
  };
}
function armDiff(before) {
  if (!before || !paused()) return;
  const a = ui.armed;
  for (const p of state.parties) {
    if (p.owner !== "player" || before.sig.get(p.id) === partySig(p)) continue;
    if (!a.parties.has(p.id)) a.parties.set(p.id, before.queue.get(p.id) || 0);
  }
  for (const b of state.bases) {
    for (const j of b.construction) if (!before.builds.has(j.id)) a.builds.add(j.id);
    for (const j of craftQueue(b)) if (!before.crafts.has(j.id)) a.crafts.add(j.id);
  }
}

// ---------- actions ----------
function autofill(pl) {
  const h = hub(state);
  if (!h) return; // no base to send a team from (the planner says so): exiles, hardcore before its first hub
  const ids = [...pl.crew];
  const v = plannerVehicle(state, pl);
  // A plan with steps (ui/plan.js) packs for the whole plan; otherwise for the round trip. Estimated twice: what the
  // team packs is part of its load, and its load sets its pace and how much it eats on the way (sim/load.js).
  const n = Math.max(1, ids.length);
  let est = null;
  for (let pass = 0; pass < 2; pass++) {
    est = (pl.mission !== "outpost" && planAutofill(state, pl)) || estimateTrip(state, { memberIds: ids.length ? ids : [0], dest: pl.dest, vehicle: travelMode(v), v, stance: pl.stance, supplies: pl.supplies });
    view.preview = est ? est.path : null;
    if (!est) return;
    const want = {
      food: Math.ceil(est.food * 1.25), water: Math.ceil(est.water * 1.25),
      fuel: (isCar(v) ? Math.max(0, Math.ceil(est.fuel * 1.25 - v.fuel)) : 0) + (pl.mission === "getvehicle" ? 10 : 0),
      meds: Math.min(2, n), ammo: 15 * n, parts: pl.mission === "getvehicle" || pl.mission === "investigate" ? 2 : 0,
      // Snares without snare wire in the hub's armory: 2 scrap of fence wire for each line (sim/hunting.js).
      scrap: pl.mission === "outpost" ? 15 : ((pl.plan && pl.plan.steps) || []).filter((s) => s.kind === "snare").length * (h.armory.some((it) => it && it.key === "snarewire") ? 0 : 2),
    };
    for (const k of Object.keys(want)) pl.supplies[k] = Math.max(0, Math.min(Math.floor(stockHas(h.stock, k)), want[k])); // water: both kinds, purified packed first (sim/water.js)
  }
  // A tube of purification tablets for a team going to fetch water or out more than two days (sim/worm.js packTablets).
  const fetches = ((pl.plan && pl.plan.steps) || []).some((s) => s.kind === "water");
  pl.tabs = armoryTabs(h).length > 0 && (fetches || (est.hours || 0) > TABS_TRIP_DAYS * 24);
  // Too heavy for the crew (and vehicle): less ammo, then fewer meds, then the 25% margin on food and water.
  if (!ids.length) return;
  const trim = (k, floor) => {
    const c = plannerLoad(state, pl);
    const over = c.load - c.cap;
    if (over > 0) pl.supplies[k] = Math.max(Math.min(pl.supplies[k], floor), pl.supplies[k] - Math.ceil(over / SUPPLIES[k].weight));
  };
  trim("ammo", 5 * n);
  trim("meds", 1);
  trim("food", est.food);
  trim("water", est.water);
}

const partyById = (id) => state.parties.find((p) => p.id === Number(id));
const baseOf = (d) => baseById(state, Number(d.base));
// A message from a base action: on the base screen when it is open, otherwise in the log.
function baseSay(msg) {
  if (!msg) return;
  if (ui.baseView) ui.baseMsg = msg;
  else log(state, msg, "info");
}
function endMoveMode() {
  ui.moveParty = null;
  ui.moveQueue = false;
  ui.moveMsg = "";
  view.preview = null;
}

const actions = {
  // Dev fast-forward speeds never become the speed that Space goes back to.
  speed: (d) => { ui.speed = Number(d.speed) || 0; if (ui.speed > 0 && ui.speed <= MAX_SPEED) ui.lastSpeed = ui.speed; },
  tab: (d) => { ui.tab = d.tab; },
  "dev-toggle": () => { ui.dev = !ui.dev; },
  "dev-reveal": () => { view.devReveal = !view.devReveal; },
  "dev-infection": () => { view.layers.has("infection") ? view.layers.delete("infection") : view.layers.add("infection"); },
  "dev-fps": () => { ui.showFps = !ui.showFps; fpsLog.length = 0; fpsShownAt = 0; const el = $("fps"); if (el) el.textContent = "… FPS"; },
  // Autopilot: an AI governor runs the holdout (sim/autopilot.js). A battle or loot screen left open is finished for you.
  "dev-autopilot": () => {
    if (!ui.started || state.gameOver) return;
    if (!state.autopilot) { ui.cardResult = null; if (ui.inv && (ui.inv.loot || ui.inv.raid)) { ui.inv = null; ui.invSel = null; } }
    setAutopilot(state, !state.autopilot);
  },
  "dev-persona": (d) => { setPersonality(state, d.v); },
  center: (d) => { centerOn(state, Number(d.tile)); ui.selected = Number(d.tile); view.selected = ui.selected; },
  help: () => openSettings(ui, "help"), // the menu's Help tab (ui/settings.js, ui/help.js)
  legendtoggle: () => { ui.legendCollapsed = !ui.legendCollapsed; },
  // Panels around the map (ui/layout.js): fold or show one (data-p: left, right, log, alerts, orders, legend), close
  // one completely or open it again (data-p: left, right, log: the strip's ✕, the top bar's ◧ ◨ ⬓, the tab at the
  // map's edge), map only (fold them all; again: back as they were), and the menu's reset (windows and panels as
  // they first were).
  "panel-toggle": (d) => foldPanel(d.p, d.v === undefined ? undefined : d.v === "1"),
  "panel-close": (d) => shutPanel(d.p, d.v === undefined ? undefined : d.v === "1"),
  "panel-all": () => { relayout(() => { toggleAll(layout); applyLayout(layout); }); saveLayout(layout); },
  "win-reset": () => {
    resetWindows();
    relayout(() => { resetLayout(layout); applyLayout(layout); });
    saveLayout(layout);
    if (ui.settings) { ui.settings.msg = "Windows and panels are back to their usual size and place."; ui.settings.err = false; }
  },
  // Base management.
  openbase: (d) => {
    if (!baseById(state, Number(d.id))) { log(state, "That base is gone.", "info"); return; }
    ui.baseView = { id: Number(d.id), tab: d.tab || "overview" };
    ui.baseMsg = "";
    ui.supplyForm = null;
  },
  basetab: (d) => { ui.baseView.tab = d.tab; ui.baseMsg = ""; },
  closebase: () => { ui.baseView = null; ui.baseMsg = ""; ui.supplyForm = null; },
  // Supply runs (Supply runs tab of the base screen).
  "sr-new": (d) => { ui.supplyForm = jobForm(state, null, Number(d.base)); ui.supplyError = ""; },
  "sr-edit": (d) => {
    const j = supplyRunById(state, Number(d.id));
    if (!j) return;
    if (!baseById(state, j.originId)) { baseSay("That supply run's home base is gone. Recreate the job from another base, or delete it."); return; }
    ui.supplyForm = jobForm(state, j, j.originId, "edit");
    if (ui.baseView) ui.baseView.id = j.originId;
    ui.supplyError = "";
  },
  "sr-recreate": (d) => {
    const j = supplyRunById(state, Number(d.id));
    if (!j || !baseById(state, Number(d.base))) return;
    ui.supplyForm = jobForm(state, j, Number(d.base), "recreate");
    if (ui.baseView) ui.baseView.id = ui.supplyForm.originId;
    ui.supplyError = "";
  },
  "sr-cancel": () => { ui.supplyForm = null; ui.supplyError = ""; },
  "sr-save": () => {
    const res = saveSupplyRun(state, ui.supplyForm);
    if (res.error) { ui.supplyError = res.error; return; }
    ui.supplyForm = null;
    ui.supplyError = "";
    ui.baseMsg = `Supply run saved. ${res.job.nextDay != null && !res.job.partyId ? `First departure day ${res.job.nextDay}, or press Dispatch now.` : ""}`;
  },
  "sr-crew": (d) => { const c = ui.supplyForm.crew, id = Number(d.id); const i = c.indexOf(id); i >= 0 ? c.splice(i, 1) : c.push(id); },
  "sr-vehicle": (d) => { ui.supplyForm.vehicleId = d.v ? Number(d.v) : null; },
  "sr-stance": (d) => { ui.supplyForm.stance = d.v; },
  "sr-atdest": (d) => { ui.supplyForm.atDest = d.v; },
  "sr-sched": (d) => { ui.supplyForm.schedule = d.v; },
  "sr-partial": () => { ui.supplyForm.allowPartial = !ui.supplyForm.allowPartial; },
  "sr-addline": (d) => {
    const list = ui.supplyForm[d.list];
    list.push({ key: SUPPLY_KEYS.find((k) => !list.some((l) => l.key === k)) || "food", qty: 10 });
  },
  "sr-delline": (d) => { ui.supplyForm[d.list].splice(Number(d.i), 1); },
  // From the Teams tab (no base screen open) the answer goes to the log.
  "sr-dispatch": (d) => { const j = supplyRunById(state, Number(d.id)); if (j) baseSay(dispatchSupplyRun(state, j, true)); },
  "sr-pause": (d) => { const j = supplyRunById(state, Number(d.id)); if (j) baseSay(pauseSupplyRun(state, j, true)); },
  "sr-resume": (d) => { const j = supplyRunById(state, Number(d.id)); if (j) baseSay(pauseSupplyRun(state, j, false)); },
  "sr-release": (d) => { const j = supplyRunById(state, Number(d.id)); if (j) baseSay(releaseHeld(state, j, d.how)); },
  "sr-delete": (d) => { const j = supplyRunById(state, Number(d.id)); if (j) baseSay(deleteSupplyRun(state, j)); },
  queuebuild: (d) => { ui.baseMsg = queueBuild(state, baseOf(d), d.type); },
  // Construction tab (sim/buildings.js): a water barrel's next tier, and pulling a building down (two clicks) to free its plot.
  "barrel-up": (d) => { ui.baseMsg = queueBarrelUpgrade(state, baseOf(d), Number(d.id)); },
  demolish: (d) => {
    const id = Number(d.id);
    if (ui.demolishArm !== id) { ui.demolishArm = id; ui.baseMsg = "Click Confirm to pull it down (half its scrap and parts come back)."; return; }
    ui.demolishArm = null;
    ui.baseMsg = demolish(state, baseOf(d), id);
  },
  // The camp fire (sim/fieldheat.js): the staging camp's, a shelter's (data-base) or a camping team's (data-team).
  campfire: (d) => {
    const lit = d.lit === "1";
    if (d.base) { ui.baseMsg = setFire(state, baseOf(d), lit); return; }
    if (d.team) { ui.xpMsg = setFire(state, partyById(d.team), lit); return; }
    if (state.staging) log(state, setFire(state, state.staging, lit), "info");
  },
  // Medical: treat at a base with the base's meds. In the field it is a 1-hour team order (xp-order, type treat).
  treat: (d) => { baseSay(treatAtBase(state, baseOf(d), Number(d.id))); },
  cancelbuild: (d) => { ui.baseMsg = cancelBuild(state, baseOf(d), Number(d.id)) || "Cancelled."; },
  // Hand crafting (base Crafting tab).
  queuecraft: (d) => { ui.baseMsg = queueCraft(state, baseOf(d), d.recipe); },
  cancelcraft: (d) => { ui.baseMsg = cancelCraft(state, baseOf(d), Number(d.id)); },
  refuel: (d) => { ui.baseMsg = refuel(state, baseOf(d), state.vehicles.find((v) => v.id === Number(d.id))); },
  repairv: (d) => { ui.baseMsg = repair(state, baseOf(d), state.vehicles.find((v) => v.id === Number(d.id))); },
  burybody: (d) => { ui.baseMsg = buryBody(state, baseOf(d), Number(d.id)); }, // sim/carriers.js: a body brought home
  burnbody: (d) => { ui.baseMsg = burnBodyHome(state, baseOf(d), Number(d.id)); },
  survivor: (d) => { ui.survivor = Number(d.id); },
  closesurv: () => { ui.survivor = null; ui.lookEdit = null; ui.relMsg = ""; ui.skillTree = null; ui.skillMsg = ""; },
  unequip: (d) => {
    const s = survivorById(state, Number(d.id));
    const b = baseOf(d);
    if (!s || !b) return;
    if (s.gear[d.slot]) b.armory.push(s.gear[d.slot]);
    s.gear[d.slot] = null;
  },
  // Teams and orders.
  orders: (d) => {
    const p = partyById(d.id);
    if (p && !state.cards.some((c) => c.partyId === p.id)) addCard(state, ordersCard(state, p, ""));
  },
  movemode: (d) => {
    const on = ui.moveParty !== Number(d.id);
    endMoveMode();
    if (on) ui.moveParty = Number(d.id);
    ui.baseView = null;
    const p = partyById(d.id);
    if (p) centerOn(state, partyTile(p));
  },
  gohome: (d) => {
    const p = partyById(d.id);
    if (!p) return;
    startReturn(state, p);
    if (!state.parties.includes(p) || p.phase === "back") log(state, "Team ordered home.", "info");
  },
  // Team panel (right sidebar) and the order queue. Orders given while paused start when the clock runs again.
  "xp-open": (d) => { if (ui.expedition !== Number(d.id)) ui.qSel = null; ui.expedition = Number(d.id); ui.xpMsg = ""; const p = partyById(d.id); if (p && contactable(p)) { ui.selected = partyTile(p); view.selected = ui.selected; } },
  "xp-close": () => { ui.expedition = null; ui.xpMsg = ""; ui.qSel = null; },
  "xp-queuemode": () => { ui.xpQueue = !ui.xpQueue; },
  "xp-orderstoggle": () => { ui.ordersCollapsed = !ui.ordersCollapsed; },
  "xp-order": (d) => {
    const p = partyById(d.id);
    if (!p || !(contactable(p) || commandable(state, p))) return; // the radio rule is checked for every team order below
    const o = { type: d.type };
    if (d.mission) o.mission = d.mission;
    if (d.type === "camp") o.hours = d.hours ? Number(d.hours) : null;
    if (d.sid) o.survivorId = Number(d.sid);
    if (d.recipe) o.recipe = d.recipe; // field crafting
    if (d.type === "sweep") Object.assign(o, sweepOpts({ radius: d.radius, hours: d.hours })); // a survey here (sim/survey.js)
    if (d.hours && d.type !== "camp") o.hours = Number(d.hours); // hunt, fish (sim/hunting.js)
    if (d.mode) o.mode = d.mode; // snares: set, check, lift
    issueOrder(p, o);
  },
  // Build a boat and cross one water tile (sim/crossing.js). Hours and materials are fixed now.
  "xp-cross": (d) => {
    const p = partyById(d.id);
    if (!p) return;
    const o = boatOrder(state, p, startsNow(p) ? partyTile(p) : queueEndTile(state, p), Number(d.tile), d.mode);
    if (o.error) { ui.xpMsg = o.error; return; }
    issueOrder(p, o);
  },
  "xp-move": (d) => {
    const p = partyById(d.id);
    if (!p) return;
    endMoveMode();
    ui.moveParty = p.id;
    // A team on the move (or with queue mode on) gets the move added to its queue.
    ui.moveQueue = !startsNow(p);
    centerOn(state, ui.moveQueue ? queueEndTile(state, p) : partyTile(p));
  },
  "xp-stop": (d) => { const p = partyById(d.id); if (p) ui.xpMsg = stopTask(state, p); },
  "xp-resume": (d) => { const p = partyById(d.id); if (p) ui.xpMsg = resumeQueue(state, p); },
  "xp-unqueue": (d) => {
    const p = partyById(d.id);
    if (!p) return;
    const i = Number(d.i);
    ui.xpMsg = removeQueued(state, p, i);
    if (ui.qSel != null && ui.expedition === p.id) ui.qSel = ui.qSel === i ? null : ui.qSel > i ? ui.qSel - 1 : ui.qSel; // the selection follows its order
  },
  "xp-clearq": (d) => { const p = partyById(d.id); if (p) { p.orders = []; ui.xpMsg = "Queue cleared."; ui.qSel = null; } },
  // The queue's "Now" line: cancel the move under way (sim/orders.js cancelMove; the team stops where it is).
  "xp-cancelmove": (d) => { const p = partyById(d.id); if (p) ui.xpMsg = cancelMove(state, p); },
  // Reordering the queue: select a line (click; again to unselect), move it with ▲ ▼ (or ↑ ↓, keydown below),
  // or drag it onto another line (xp-qdrop, from the drop listener). The selection follows the order it was on.
  "xp-qsel": (d) => { const i = Number(d.i); ui.qSel = ui.qSel === i ? null : i; },
  "xp-qmove": (d) => {
    const p = partyById(d.id);
    if (!p) return;
    const i = Number(d.i), to = i + Number(d.dir);
    const msg = reorderQueued(state, p, i, to);
    if (!msg) return;
    ui.xpMsg = msg;
    if (ui.expedition === p.id && (ui.qSel === i || ui.qSel == null)) ui.qSel = to;
  },
  "xp-qdrop": (d) => {
    const p = partyById(d.id);
    if (!p) return;
    const from = Number(d.from), to = Number(d.to);
    const msg = reorderQueued(state, p, from, to);
    if (!msg) return;
    ui.xpMsg = msg;
    if (ui.expedition === p.id && ui.qSel != null) ui.qSel = ui.qSel === from ? to : from < ui.qSel && to >= ui.qSel ? ui.qSel - 1 : from > ui.qSel && to <= ui.qSel ? ui.qSel + 1 : ui.qSel;
  },
  radiotalk: (d) => { log(state, radioTalk(state, factionById(state, Number(d.id))), "info"); },
  routesetup: (d) => {
    ui.routeSetup = { factionId: Number(d.id), sendKey: "food", sendQty: 20, recvKey: "ammo", recvQty: 60, interval: 5, escort: "standard", escortIds: new Set() };
  },
  "rt-escort": (d) => { ui.routeSetup.escort = d.v; ui.routeSetup.escortIds = new Set(); },
  "rt-crew": (d) => {
    const set = ui.routeSetup.escortIds, id = Number(d.id);
    if (set.has(id)) set.delete(id);
    else if (set.size < ESCORTS[ui.routeSetup.escort].people) set.add(id);
  },
  "rt-cancel": () => { ui.routeSetup = null; },
  "rt-create": () => {
    const r = ui.routeSetup;
    if (!routeCheck(state, r).ok) return; // the form says why and keeps Start disabled
    if (TradeSim.createRoute) {
      // trade.js checks the terms again and sets the route up.
      if (TradeSim.createRoute(state, { ...r, escortIds: [...r.escortIds] }).error) return;
    } else {
      const route = { id: newId(), factionId: r.factionId, sendKey: r.sendKey, sendQty: r.sendQty, recvKey: r.recvKey, recvQty: r.recvQty, interval: Math.max(2, r.interval), escort: r.escort, escortIds: [...r.escortIds], nextDay: day(state), active: true };
      state.routes.push(route);
      for (const id of route.escortIds) survivorById(state, id).location = { kind: "route", routeId: route.id };
      log(state, `Trade route to ${factionById(state, r.factionId).name} set up. The first convoy leaves at the next dawn.`, "good");
    }
    ui.routeSetup = null;
  },
  cancelroute: (d) => {
    const r = state.routes.find((x) => x.id === Number(d.id));
    if (!r) return;
    r.active = false;
    releaseEscorts(state, r);
    log(state, "Trade route ended.", "info");
  },
  plan: (d) => {
    const pl = { dest: Number(d.tile), mission: d.mission, crew: new Set(), vehicleId: null, stance: "normal", supplies: {} };
    if (d.preset) applyPreset(pl, d.preset); // "Hunting trip" / "Fishing trip" (right-click, tile panel)
    ui.planner = pl;
    ui.plannerError = "";
    endMoveMode();
    autofill(pl);
    hideCtx();
  },
  "pl-tabs": () => { ui.planner.tabs = !ui.planner.tabs; ui.plannerError = ""; }, // a tube of purification tablets from the armory
  "pl-lights": () => { ui.planner.lights = ui.planner.lights === false; ui.plannerError = ""; }, // a light each from the armory (sim/lights.js), on by default
  "pl-crew": (d) => { const s = ui.planner.crew, id = Number(d.id); s.has(id) ? s.delete(id) : s.add(id); autofill(ui.planner); ui.plannerError = ""; },
  "pl-vehicle": (d) => { ui.planner.vehicleId = d.v ? Number(d.v) : null; autofill(ui.planner); ui.plannerError = ""; },
  "pl-stance": (d) => { ui.planner.stance = d.v; autofill(ui.planner); },
  "pl-autofill": () => { autofill(ui.planner); ui.plannerError = ""; },
  "pl-cancel": () => { ui.planner = null; view.preview = null; },
  "pl-launch": () => {
    const pl = ui.planner;
    const c = plannerLoad(state, pl);
    if (c.over) { ui.plannerError = c.why; return; }
    const res = launchExpedition(state, { memberIds: [...pl.crew], dest: pl.dest, mission: pl.mission, stance: pl.stance, vehicleId: pl.vehicleId, supplies: { ...pl.supplies }, plan: pl.mission === "outpost" ? null : planLaunchOpts(pl), sweep: pl.sweep, tabs: !!pl.tabs, lights: pl.lights !== false });
    if (res.error) { ui.plannerError = res.error; return; }
    ui.planner = null;
    view.preview = null;
  },
  choice: (d) => {
    const card = state.cards[0];
    const c = card && card.choices[Number(d.i)];
    if (!c) return;
    state.cards.shift();
    // Answering a team's card is a moment of contact: orders from its panel work for the rest of this hour.
    if (card.partyId != null) { const cp = partyById(card.partyId); if (cp) cp.contactHour = state.hour; }
    const text = c.resolve(state);
    if (Parties.pruneCards) Parties.pruneCards(state); // cards about a team or person that is gone now (parties.js)
    if (c.uiAction && c.uiAction.type === "move") {
      endMoveMode();
      ui.moveParty = c.uiAction.partyId;
      const p = partyById(c.uiAction.partyId);
      if (p) centerOn(state, partyTile(p));
      return;
    }
    if (c.uiAction && c.uiAction.type === "expedition") {
      actions["xp-open"]({ id: c.uiAction.partyId });
      return;
    }
    // Orders that take time, and choices that open a battle: the result goes to the log instead of a screen.
    if (c.order || state.combat) {
      if (text) log(state, text, "info");
      return;
    }
    // Orders that lead straight into another card skip the result screen.
    if (text) ui.cardResult = { title: card.title, text };
  },
  cardok: () => { ui.cardResult = null; },
  // The card's "Retreat if it goes badly" buttons (breakoff.js): kept on the team for fights resolved by the numbers.
  "retreat-policy": (d) => { const card = state.cards[0]; const p = card && card.partyId != null ? partyById(card.partyId) : null; if (p) setTeamPolicy(state, p, d.v); },
  approach: (d) => { state.engagement.approach = d.v; },
  search: () => { searchHour(state); tickHour(state); },
  extract: () => { extract(state); },
  engclose: () => { state.engagement = null; },
  offer: (d) => { const o = state.trade.offer; o[d.k] = Math.max(0, (o[d.k] || 0) + Number(d.d)); ui.tradeMsg = ""; },
  ask: (d) => { const o = state.trade.ask; o[d.k] = Math.max(0, (o[d.k] || 0) + Number(d.d)); ui.tradeMsg = ""; },
  dotrade: () => { ui.tradeMsg = executeTrade(state); },
  gift: () => { ui.tradeMsg = giftAll(state); },
  pact: (d) => { const f = factionById(state, state.trade.factionId); ui.tradeMsg = proposePact(state, f, d.k); },
  tradeleave: () => { endTrade(state); ui.tradeMsg = ""; },
  reroll: () => newWorld(randomSeed()),
  // Randomize all (ui/newgame.js): in Hardcore the world is built again on the same seed with the new crew roll.
  "nr-allcrew": () => { state = randomizeAllCrew(state, ui, (crew, crewRoll) => { newWorld(state.seed, true, { crew, crewRoll }); return state; }); },
  pickleader: (d) => { state.survivors.forEach((s) => (s.leader = s.id === Number(d.id))); ui.crewEdited = true; },
  // A new game starts paused: look around and give the first orders, then press Space.
  begin: () => {
    ui.started = true;
    ui.speed = 0;
    ui.lastSpeed = 1;
    ui.lookEdit = null;
    ui.nrMsg = "";
    state.started = true;
    assignStartingRoles(state); // jobs by skill, after any edits made on this screen (world.js)
    centerOn(state, playerTile(state));
    const lead = state.survivors.find((s) => s.leader) || state.survivors[0];
    if (lead) log(state, `${lead.name} leads the group.`, "info");
  },
  restart: () => newWorld(randomSeed()),
  // Victory screen: carry on in the same world (sim/world.js checkGameOver does not end it again for the hives).
  keepplaying: () => { if (state.victory) { state.victoryKept = true; state.gameOver = false; } },
};

for (const k of ["cb-sel", "cb-act", "cb-target", "cb-end", "cb-confirm", "cb-auto", "cb-close", "cb-deploy", "cb-prison", "cb-retreat", "cb-view", "cb-fallback", "cb-redeploy", "cb-clear"]) actions[k] = (d) => combatAction(state, k, d);
// Prisoners tab of a base (ui/prisoners.js): question, ransom, trade back, release, recruit, execute.
for (const [k, fn] of Object.entries(PRISON_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// The planner's PLAN section (ui/plan.js): presets, steps, conditions; supplies are packed again for the new plan.
for (const [k, fn] of Object.entries(PLAN_ACTIONS)) actions[k] = (d) => { if (!ui.planner) return; fn(state, ui, d); autofill(ui.planner); ui.plannerError = ""; };
// Look editor, new-run randomizers and zombie look settings (ui/newgame.js).
for (const [k, fn] of Object.entries(LOOK_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Inventory and loot screens (ui/inventory.js).
for (const [k, fn] of Object.entries(INV_ACTIONS)) actions[k] = (d, ev) => fn(state, ui, d, ev); // ev: Shift+click on a supply stack (raid search window)
// Farming tab and illness (ui/farming.js, ui/health.js).
for (const [k, fn] of Object.entries({ ...FARM_ACTIONS, ...HEALTH_ACTIONS })) actions[k] = (d) => fn(state, ui, d);
// Skills, perks, teaching and reading in the survivor screen (ui/skills.js).
for (const [k, fn] of Object.entries(SKILL_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Production orders, power, standing craft orders, stewards and pins (ui/production.js).
for (const [k, fn] of Object.entries(PROD_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Trade window, radio panel and trade caravans (ui/tradewindow.js); these replace the older trade handlers above.
for (const [k, fn] of Object.entries(TRADE_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Outsiders (ui/visitors.js): the Groups tab's radio calls, trading with merchants, robbing them.
for (const [k, fn] of Object.entries(VISITOR_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Jobs, market board, world affairs and the coalition (ui/diplomacy.js); some reuse the handlers above (plan, center, rd-open).
for (const [k, fn] of Object.entries(DIPLO_ACTIONS)) actions[k] = (d) => fn(state, ui, d, actions);
// Timelapse viewer (ui/timelapse.js). It never opens over a battle (the battle screen would cover it).
for (const [k, fn] of Object.entries(TL_ACTIONS)) actions[k] = (d) => {
  if (k === "tl-open" && state.combat) return;
  fn(state, ui, d);
  if (k === "tl-open") watchFloating($("timelapse")); // its boxes resize from the corner (ui/windows.js)
};
// Relationships, the mood breakdown and the memorial wall (ui/relations.js).
for (const [k, fn] of Object.entries(REL_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Diary, log filters and links, alerts and the roster (ui/diary.js, ui/alerts.js, ui/roster.js); links and alerts
// use the handlers above (center, openbase, xp-open).
for (const [k, fn] of Object.entries({ ...DIARY_ACTIONS, ...ALERT_ACTIONS, ...ROSTER_ACTIONS })) actions[k] = (d) => fn(state, ui, d, actions);
// Repairs, and opening locks in a raid (ui/explore.js, ui/locks.js).
for (const [k, fn] of Object.entries({ ...EXPLORE_ACTIONS, ...LOCK_ACTIONS })) actions[k] = (d) => fn(state, ui, d);
// The city crawl window: places, street events, encounters, the next block, leaving (ui/citycrawl.js).
for (const [k, fn] of Object.entries(CRAWL_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Needs (ui/needs.js): a team's rations and who eats first, a treat used by hand.
for (const [k, fn] of Object.entries(NEEDS_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
for (const [k, fn] of Object.entries(LISTEN_ACTIONS)) actions[k] = (d) => fn(state, ui, d); // xp-listen, bl-listen
// The menu: save, load, save and exit, options (ui/settings.js; settingsApi below).
for (const [k, fn] of Object.entries(SETTINGS_ACTIONS)) actions[k] = (d) => fn(state, ui, d, settingsApi);
// The Work tab: priority cells take the click event (right-click counts down, Shift+click edits the role) (ui/work.js).
for (const [k, fn] of Object.entries(WORK_ACTIONS)) actions[k] = (d, ev) => fn(state, ui, d, ev);

// Inventory drag and drop: tiles carry data-drag (their location), slots and storage boxes data-drop.
// The team panel's order queue (ui/expedition.js queueBlock): lines carry data-qdrag / data-qdrop (their index);
// dropping one on another puts it in that place (xp-qdrop). The dragged line is dimmed, the target underlined.
const QDRAG = "queue:"; // the queue's dataTransfer payload: queue:<party id>:<index>
const clearQueueDrag = () => { for (const li of document.querySelectorAll(".xpqueue li.over, .xpqueue li.dragging")) li.classList.remove("over", "dragging"); };
document.addEventListener("dragstart", (ev) => {
  const q = ev.target.closest && ev.target.closest("[data-qdrag]");
  if (q) {
    ev.dataTransfer.setData("text/plain", `${QDRAG}${q.dataset.id}:${q.dataset.qdrag}`);
    ev.dataTransfer.effectAllowed = "move";
    q.classList.add("dragging");
    hideTip();
    return;
  }
  const el = ev.target.closest && ev.target.closest("[data-drag]");
  if (!el || !ui.inv) return;
  ev.dataTransfer.setData("text/plain", el.dataset.drag);
  ev.dataTransfer.effectAllowed = "move";
  hideTip();
});
document.addEventListener("dragover", (ev) => {
  const q = ev.target.closest && ev.target.closest("[data-qdrop]");
  if (q) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    if (!q.classList.contains("over")) { for (const li of document.querySelectorAll(".xpqueue li.over")) li.classList.remove("over"); q.classList.add("over"); }
    return;
  }
  if (ui.inv && ev.target.closest && ev.target.closest("[data-drop]")) ev.preventDefault();
});
document.addEventListener("dragleave", (ev) => {
  const q = ev.target.closest && ev.target.closest("[data-qdrop]");
  if (q && !q.contains(ev.relatedTarget)) q.classList.remove("over");
});
document.addEventListener("dragend", clearQueueDrag);
document.addEventListener("drop", (ev) => {
  const q = ev.target.closest && ev.target.closest("[data-qdrop]");
  if (q) {
    ev.preventDefault();
    clearQueueDrag();
    releaseHold();
    const data = ev.dataTransfer.getData("text/plain") || "";
    if (data.startsWith(QDRAG)) {
      const [id, from] = data.slice(QDRAG.length).split(":");
      if (id === q.dataset.id) act(() => actions["xp-qdrop"]({ id, from, to: q.dataset.qdrop }));
    }
    refresh();
    return;
  }
  const el = ev.target.closest && ev.target.closest("[data-drop]");
  if (!el || !ui.inv) return;
  ev.preventDefault();
  releaseHold();
  const from = ev.dataTransfer.getData("text/plain");
  if (from) { invDrop(state, ui, from, el.dataset.drop, ev.shiftKey, ev.ctrlKey || ev.metaKey); refresh(); } // Shift: half a supply stack, Ctrl: one (raid search window)
});

const changeActions = {
  uiscale: (el) => { ui.scale = Number(el.value); document.documentElement.style.setProperty("--ui-scale", ui.scale); setTimeout(() => { resize(); fitWindows(); }, 50); options.uiScale = ui.scale; saveOptions(options); },
  // A work role ("w:…", priorities) or a fixed job (Manual) (ui/work.js).
  role: (el) => {
    const s = survivorById(state, Number(el.dataset.id));
    if (!s) return;
    const msg = applyRoleChoice(state, s, el.value);
    if (msg && ui.baseView) ui.baseMsg = msg;
  },
  medicop: (el) => {
    if (!el.value) return;
    const s = survivorById(state, Number(el.value));
    toManual(state, s); // a job picked by hand: off work priorities
    s.role = "medic";
    s.station = null;
    if (s.location.kind === "base") assignStations(state, baseById(state, s.location.baseId));
    ui.baseMsg = `${s.name} now works as a medic.`;
  },
  craftop: (el) => {
    if (!el.value) return;
    const s = survivorById(state, Number(el.value));
    toManual(state, s);
    s.role = "craft";
    s.station = null;
    if (s.location.kind === "base") assignStations(state, baseById(state, s.location.baseId));
    ui.baseMsg = `${s.name} now crafts by hand.`;
  },
  "barrel-holds": (el) => { ui.baseMsg = setBarrelHolds(baseOf(el.dataset), Number(el.dataset.id), el.value); },
  stationop: (el) => {
    const b = baseOf(el.dataset);
    const stationId = Number(el.dataset.station);
    // Whoever was on this station is freed up. Only people at this base change role: an operator away on a
    // trip keeps their job and takes a free station when they are back.
    for (const s of state.survivors) {
      if (s.station !== stationId) continue;
      s.station = null;
      if (s.role === "operate" && b && s.location.kind === "base" && s.location.baseId === b.id) s.role = "rest";
    }
    ui.baseMsg = "Station has no operator.";
    if (el.value) {
      const s = survivorById(state, Number(el.value));
      toManual(state, s);
      s.role = "operate";
      s.station = stationId;
      ui.baseMsg = `${s.name} now runs this station.`;
    }
  },
  equip: (el) => {
    if (el.value === "") return;
    const s = survivorById(state, Number(el.dataset.id));
    const b = baseOf(el.dataset);
    if (!b || !s) return;
    const item = b.armory.splice(Number(el.value), 1)[0];
    if (!item) return;
    const slot = GEAR[item.key].slot;
    if (s.gear[slot]) b.armory.push(s.gear[slot]);
    s.gear[slot] = item;
  },
  layer: (el) => { el.checked ? view.layers.add(el.dataset.k) : view.layers.delete(el.dataset.k); },
  rt: (el) => { const f = el.dataset.f; ui.routeSetup[f] = el.tagName === "SELECT" ? el.value : Math.max(0, Math.floor(Number(el.value) || 0)); },
  "sr-dest": (el) => { ui.supplyForm.destId = Number(el.value); },
  "sr-line": (el) => {
    const l = ui.supplyForm[el.dataset.list][Number(el.dataset.i)];
    if (!l) return;
    if (el.dataset.f === "key") l.key = el.value;
    else l.qty = Math.max(0, Math.floor(Number(el.value) || 0));
  },
  "sr-every": (el) => { ui.supplyForm.every = Math.max(1, Math.floor(Number(el.value) || 1)); },
  "pl-mission": (el) => { ui.planner.mission = el.value; autofill(ui.planner); ui.plannerError = ""; },
  "pl-supply": (el) => { ui.planner.supplies[el.dataset.k] = Math.max(0, Math.floor(Number(el.value) || 0)); ui.plannerError = ""; },
  ...Object.fromEntries(Object.entries(LOOK_CHANGE_ACTIONS).map(([k, fn]) => [k, (el) => fn(state, ui, el)])),
  ...Object.fromEntries(Object.entries(TRADE_CHANGE_ACTIONS).map(([k, fn]) => [k, (el) => fn(state, ui, el)])),
  ...Object.fromEntries(Object.entries(DIPLO_CHANGE).map(([k, fn]) => [k, (el) => fn(state, ui, el)])),
  seed: (el) => newWorld(cleanSeed(el.value), true),
  factioncount: (el) => { ui.factionCount = clampGroups(ui.worldSize, el.value); newWorld(state.seed, true); },
  // A new world size: the same seed on the new map, with that size's usual number of groups (sim/worldsize.js).
  // Custom (experimental): the width × height below the row, starting from the map on screen.
  worldsize: (el) => {
    if (el.value === "custom") { ui.worldSize = "custom"; ui.customW = state.grid.width; ui.customH = state.grid.height; }
    else ui.worldSize = sizeDef(el.value).key;
    ui.factionCount = (ui.worldSize === "custom" ? customDef(ui.customW, ui.customH) : sizeDef(ui.worldSize)).defGroups;
    newWorld(state.seed, true);
  },
  customw: (el) => { ui.customW = clampCustomW(el.value); newWorld(state.seed, true); },
  customh: (el) => { ui.customH = clampCustomH(el.value); newWorld(state.seed, true); },
  hivecount: (el) => { ui.hiveCount = clampHives(el.value); newWorld(state.seed, true); },
  // Normal or Hardcore (sim/hardcore.js): the same seed and the edited crew (the first three in Hardcore).
  gamemode: (el) => { ui.mode = el.value === "hardcore" ? "hardcore" : "normal"; newWorld(state.seed, true); },
  rename: (el) => {
    // Empty names and a full name someone else already has are refused (world.renameSurvivor).
    const s = survivorById(state, Number(el.dataset.id));
    const before = s ? s.name : "";
    const why = renameSurvivor(state, s, String(el.value ?? "").slice(0, 40));
    ui.nrMsg = why || "";
    if (why) { if (s) el.value = s.name; if (ui.started) log(state, why, "info"); }
    else if (s && s.name !== before && !ui.started) ui.crewEdited = true;
  },
  // Any base can be renamed from its screen (the name shows on the map, in the log and in the timelapse).
  baserename: (el) => {
    const b = baseOf(el.dataset);
    const name = String(el.value ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!b || !name || name === b.name) return;
    if (state.bases.some((x) => x !== b && x.name.toLowerCase() === name.toLowerCase())) { ui.baseMsg = `Another base is already called ${name}.`; return; }
    ui.baseMsg = `${b.name} is now called ${name}.`;
    b.name = name;
  },
};
for (const [k, fn] of Object.entries({ ...FARM_CHANGE, ...HEALTH_CHANGE })) changeActions[k] = (el) => fn(state, ui, el);
for (const [k, fn] of Object.entries(SKILL_CHANGE)) changeActions[k] = (el) => fn(state, ui, el);
for (const [k, fn] of Object.entries(PROD_CHANGE)) changeActions[k] = (el) => fn(state, ui, el);
for (const [k, fn] of Object.entries(PLAN_CHANGE)) changeActions[k] = (el) => { if (!ui.planner) return; fn(state, ui, el); autofill(ui.planner); ui.plannerError = ""; };
for (const [k, fn] of Object.entries({ ...DIARY_CHANGE, ...ROSTER_CHANGE })) changeActions[k] = (el) => fn(state, ui, el);
for (const [k, fn] of Object.entries(EXPLORE_CHANGE)) changeActions[k] = (el) => fn(state, ui, el);
for (const [k, fn] of Object.entries(SETTINGS_CHANGE)) changeActions[k] = (el) => fn(state, ui, el, settingsApi);
for (const [k, fn] of Object.entries(WORK_CHANGE)) changeActions[k] = (el) => fn(state, ui, el);
for (const [k, fn] of Object.entries(PRISON_CHANGE)) changeActions[k] = (el) => fn(state, ui, el); // prisoners-tab: the rations and work selects (ui/prisoners.js)
for (const [k, fn] of Object.entries(INV_CHANGE)) changeActions[k] = (el) => fn(state, ui, el); // how many of a supply stack to move (ui/inventory.js)

// A new world: new campaign, new map and colonists, or the same colonists on another seed or group count.
// Everything about the old run goes: open screens, selections, the team panel, card results, move mode, the
// speed (a new game starts paused), dev tools and their map overlays.
// keepCrew: carry colonists edited on the new-run screen into the rebuilt world (and their Hardcore crew roll).
// fresh: { crew, crewRoll } from Randomize all, in place of the edited colonists.
function newWorld(seed, keepCrew = false, fresh = null) {
  const crew = fresh ? fresh.crew : keepCrew && ui.crewEdited ? crewSnapshot(state) : null;
  if (fresh) ui.crewRoll = fresh.crewRoll;
  else if (!crew) ui.crewRoll = null;
  if (ui.timelapse) closeTimelapse(state, ui);
  Object.assign(ui, freshUi());
  ui.crewEdited = !!crew;
  state = createWorld({ seed, factionCount: ui.factionCount, crew, size: ui.worldSize, customW: ui.customW, customH: ui.customH, hives: ui.hiveCount, mode: ui.mode, crewRoll: ui.crewRoll });
  resetView();
  hideCtx();
  hideTip();
  $("tooltip").classList.add("hidden");
  acc = 0;
  fpsLog.length = 0;
  centerOn(state, playerTile(state));
}

// A loaded world (ui/settings.js): like a new world, but already started, paused, and remembering its save slot.
function adopt(st, entry) {
  if (ui.timelapse) closeTimelapse(state, ui);
  Object.assign(ui, freshUi());
  ui.crewEdited = false;
  state = st;
  ui.title = false;
  if (!state.mode) state.mode = "normal"; // saves from before the modes
  ui.mode = state.mode; // a new campaign from here keeps the mode you were playing
  ui.started = true;
  ui.speed = 0;
  ui.slot = entry ? entry.id : null;
  ui.savedMark = { state, hour: state.hour };
  resetView();
  hideCtx();
  hideTip();
  $("tooltip").classList.add("hidden");
  acc = 0;
  fpsLog.length = 0;
  centerOn(state, playerTile(state)); // the hub, else the team on the road (hardcore before its first hub)
  dirtyNow = true;
}

// A small picture of the map (or the battle) for the save list. Empty when the canvas cannot be read.
function thumbnail() {
  try {
    const src = state.combat ? $("combatmap") : canvas;
    if (!src || !(src.width > 0) || !(src.height > 0)) return "";
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = Math.max(40, Math.min(120, Math.round((160 * src.height) / src.width)));
    const g = c.getContext("2d");
    g.drawImage(src, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", 0.7);
    return typeof url === "string" && url.startsWith("data:image/") && url.length < 30000 ? url : "";
  } catch { return ""; }
}

// What the menu needs from here (ui/settings.js). Saves and loads are asynchronous (compression); track() keeps the
// promises so tools can wait for them (window.game.settle()).
const pendingIo = new Set();
const settingsApi = {
  options,
  desktop: inDesktopApp(),
  refresh: () => { dirtyNow = true; refresh(false); },
  track: (p) => { pendingIo.add(p); p.finally(() => pendingIo.delete(p)); },
  adopt,
  newWorld: () => newWorld(randomSeed()),
  toTitle: () => { newWorld(randomSeed()); showTitle(ui); }, // exit: back to the title screen (ui/title.js)
  thumb: thumbnail,
  quit: () => { try { window.close(); } catch { /* not allowed here */ } },
  autosaveInfo: autosaveState,
};
initSettings(settingsApi);
// The title screen (ui/title.js). Its living-map background runs the world created at startup on its own, so New game
// makes a fresh one.
let titleTicked = false;
initTitle({
  options, desktop: settingsApi.desktop, quit: settingsApi.quit, saveOptions: () => saveOptions(options),
  tick: () => { titleTicked = true; tickHour(state); },
  newGame: () => { if (titleTicked) { titleTicked = false; newWorld(randomSeed()); } else { resetView(); centerOn(state, playerTile(state)); } },
});
for (const [k, fn] of Object.entries(TITLE_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
if (!/[?&]notitle\b/.test(location.search)) showTitle(ui); // ?notitle: straight to the new-run screen (tests)

function act(fn) {
  const before = armSnap();
  fn();
  armDiff(before);
}
// After a click the button would keep the keyboard focus (the panels are no longer rebuilt under it), and Space
// or Enter would press it again instead of pausing.
function dropFocus() {
  const a = document.activeElement;
  if (a && a.blur && (a.tagName === "BUTTON" || a.tagName === "SELECT" || (a.tagName === "INPUT" && a.type === "checkbox"))) a.blur();
}

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el || el.tagName === "SELECT" || (el.tagName === "INPUT" && el.type !== "checkbox")) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  if (el.tagName === "INPUT" && el.type === "checkbox" && el.dataset.action !== "layer") ev.preventDefault();
  releaseHold();
  if (ui.nrMsg) ui.nrMsg = "";
  act(() => fn(el.dataset, ev));
  dropFocus();
  refresh();
});
// Right-click on a Work tab cell counts down (ui/work.js); elsewhere the browser's menu is left alone.
document.addEventListener("contextmenu", (ev) => {
  const el = ev.target.closest && ev.target.closest("[data-rc]");
  if (!el) return;
  ev.preventDefault();
  const fn = actions[el.dataset.action];
  if (!fn) return;
  releaseHold();
  act(() => fn(el.dataset, { button: 2, shiftKey: ev.shiftKey }));
  refresh();
});
// The Work tab cell under the mouse takes the number keys (workKey).
document.addEventListener("mouseover", (ev) => {
  const el = ev.target.closest && ev.target.closest(".wcell");
  ui.workHover = el ? { ...el.dataset } : null;
});
document.addEventListener("change", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const fn = changeActions[el.dataset.action];
  if (!fn) return;
  fn(el);
  if (el.tagName === "SELECT" || el.type === "checkbox") { releaseHold(); dropFocus(); }
  refresh(); // a panel with the mouse button down on it waits (so the click on a button after typing lands)
});

// ---------- hover descriptions ----------
const tipEl = $("tip");
let tipTarget = null;
function hideTip() {
  tipEl.classList.add("hidden");
  tipTarget = null;
}
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest("[data-tip]");
  if (!el || !el.dataset.tip) return hideTip();
  tipTarget = el;
  tipEl.textContent = el.dataset.tip;
  tipEl.classList.toggle("pre", el.hasAttribute("data-tip-pre")); // multi-line tips (the weather report)
  tipEl.classList.remove("hidden");
  placeTip(e);
});
document.addEventListener("mousemove", (e) => {
  if (held && e.buttons === 0) releaseHold(); // the button was let go where we did not see it (a drop-down, another window)
  if (tipTarget) placeTip(e);
});
function placeTip(e) {
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 16;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
  if (y + h > window.innerHeight - 8) y = e.clientY - h - 12;
  tipEl.style.left = `${x}px`;
  tipEl.style.top = `${y}px`;
}

// ---------- map input ----------
let drag = null;
canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  drag = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y, moved: false };
  hideCtx();
});
window.addEventListener("mousemove", (e) => {
  const r = canvas.getBoundingClientRect();
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) {
      camera.x = drag.cx - dx / camera.zoom;
      camera.y = drag.cy - dy / camera.zoom;
      canvas.style.cursor = "grabbing";
    }
  }
  const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  const tip = $("tooltip");
  if (inside && !drag && e.target === canvas && !ui.timelapse && ui.started) { // the timelapse shows no live tile info
    const id = screenToTile(state, e.clientX - r.left, e.clientY - r.top);
    if (id !== view.hover && ui.moveParty) {
      // Preview the route the team would take.
      const p = partyById(ui.moveParty);
      const res = p && id >= 0 ? planPath(state, ui.moveQueue ? queueEndTile(state, p) : partyTile(p), id, p.vehicle) : null;
      view.preview = res ? res.path : null;
    }
    view.hover = id;
    if (id >= 0) {
      tip.innerHTML = tileTooltip(state, id);
      tip.style.left = `${e.clientX - r.left + 16}px`;
      tip.style.top = `${e.clientY - r.top + 16}px`;
      tip.classList.remove("hidden");
    } else tip.classList.add("hidden");
  } else {
    view.hover = -1;
    tip.classList.add("hidden");
  }
});
window.addEventListener("mouseup", (e) => {
  if (!drag) return;
  if (!drag.moved && !ui.timelapse && ui.started) {
    const r = canvas.getBoundingClientRect();
    const id = screenToTile(state, e.clientX - r.left, e.clientY - r.top);
    const p = ui.moveParty != null && id >= 0 ? partyById(ui.moveParty) : null;
    if (p) act(() => pickMove(p, id));
    else if (id >= 0 && ui.moveParty == null) {
      // Clicking a team you are in touch with opens its panel; any other tile goes back to the tile view.
      const team = state.parties.find((q) => contactable(q) && partyTile(q) === id);
      ui.expedition = team ? team.id : null;
      ui.xpMsg = "";
      mapClicked = true; // its info is in the right panel: a folded one opens (autoShow)
    }
    ui.selected = id;
    view.selected = id;
    dirtyNow = true;
  }
  drag = null;
  canvas.style.cursor = "grab";
});
// Move mode: a tile was picked. A pick that cannot work (water, no route, the team's own tile) says why and
// keeps the mode on, so the team is not left standing with the clock running.
function pickMove(p, id) {
  let msg, ok;
  if (!commandable(state, p)) { ui.moveMsg = NO_RADIO; if (ui.expedition === p.id) ui.xpMsg = NO_RADIO; return; } // radio rule (plans.js)
  if (ui.moveQueue) {
    const from = queueEndTile(state, p);
    ok = id !== from && !!planPath(state, from, id, p.vehicle);
    msg = ok ? queueOrder(state, p, { type: "move", tile: id }) :
      id === from ? "The team will already be there." : p.vehicle ? "The vehicle cannot get there from the end of the queue." : "No route there over land from the end of the queue.";
  } else {
    msg = orderMove(state, p, id);
    ok = p.phase === "out" && p.dest === id;
  }
  if (ui.expedition === p.id) ui.xpMsg = msg;
  if (!ok) { ui.moveMsg = msg; return; }
  log(state, msg, "info");
  endMoveMode();
}
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const id = screenToTile(state, e.clientX - r.left, e.clientY - r.top);
  if (id < 0 || ui.timelapse || !ui.started) return;
  ui.selected = id;
  view.selected = id;
  const t = state.tiles[id];
  const acts = tileActions(state, id);
  const waiting = state.parties.filter((p) => contactable(p) && commandable(state, p)); // radio rule (plans.js)
  const own = state.bases.some((b) => b.tile === id);
  const none = own ? "Your base" : t.terrain === "water" && !t.bridge ? "Open water: teams cross it by boat from a shore" : "Nothing to do here";
  const menu = $("ctxmenu");
  const loc = mapLoc(state, id); // a hidden site nobody has found (sim/discovery.js) is just a tile
  menu.innerHTML = `<div class="head">${esc(loc ? loc.name : `Tile ${t.x},${t.y}`)}</div>` +
    waiting.map((p) => `<button data-action="ctxmove" data-id="${p.id}" data-tile="${id}">Move team (${p.members.length}) here</button>`).join("") +
    (t.terrain === "water" && !t.bridge ? "" : waiting.filter((p) => p.kind !== "convoy").map((p) => `<button data-action="ctxsweep" data-id="${p.id}" data-tile="${id}" data-tip="Go there and survey 3 tiles around it for 12 hours: hidden places and finds (sim/survey.js). Then it waits for orders.">Survey here with team (${p.members.length}): 3 tiles, 12h</button>`).join("")) +
    ctxBoats(waiting, id) + ctxLand(waiting, id) + ctxClaim(waiting, id) +
    (acts.length ? acts.map(([m, l, pre]) => `<button data-action="plan" data-tile="${id}" data-mission="${m}"${pre ? ` data-preset="${pre}"` : ""}>${l} (from hub)</button>`).join("") : `<div class="small muted" style="padding:0.3rem 0.5rem">${none}</div>`);
  menu.style.left = `${e.clientX - r.left}px`;
  menu.style.top = `${e.clientY - r.top}px`;
  menu.classList.remove("hidden");
  dirtyNow = true;
});
// Right-click on the land straight across one water tile from a team you are in touch with: build a boat.
function ctxBoats(teams, id) {
  return teams.filter((p) => p.kind !== "convoy" && crossingTo(state, partyTile(p), id)).flatMap((p) =>
    (p.vehicleId ? ["raft", "leave"] : ["raft"]).map((m) => {
      const plan = boatPlan(state, p, partyTile(p), id, m);
      return `<button data-action="ctxcross" data-id="${p.id}" data-tile="${id}" data-mode="${m}" ${plan.ok ? "" : "disabled"} data-tip="${esc(boatTip(state, plan, id))}">Boat team (${p.members.length}) across${p.vehicleId ? (m === "raft" ? ", raft vehicle" : ", leave vehicle") : ""} · ${plan.mats.scrap} scrap, ${plan.hours}h</button>`;
    })).join("");
}
// Right-click a land tile with a team you are in touch with: go there and forage, hunt or fish 8 hours (sim/foraging.js,
// sim/hunting.js). The team panel's low-food list uses the same action.
function ctxLand(teams, id) {
  const t = state.tiles[id];
  if (!t || t.terrain === "water") return "";
  const fish = !!fishSpot(state, id);
  return teams.filter((p) => p.kind !== "convoy").flatMap((p) => [
    forageAbundance(state, id) >= 0.05 ? `<button data-action="ctxhunt" data-id="${p.id}" data-tile="${id}" data-type="forage">${partyTile(p) === id ? "Forage here" : "Go and forage here"}, team (${p.members.length}) · 8h</button>` : "",
    gameAbundance(state, id) >= 0.08 ? `<button data-action="ctxhunt" data-id="${p.id}" data-tile="${id}" data-type="hunt">${partyTile(p) === id ? "Hunt here" : "Go and hunt here"}, team (${p.members.length}) · 8h</button>` : "",
    fish ? `<button data-action="ctxhunt" data-id="${p.id}" data-tile="${id}" data-type="fish">${partyTile(p) === id ? "Fish here" : "Go and fish here"}, team (${p.members.length}) · 8h</button>` : "",
    woodAbundance(state, id) >= 0.1 ? `<button data-action="ctxhunt" data-id="${p.id}" data-tile="${id}" data-type="wood">${partyTile(p) === id ? "Cut wood here" : "Go and cut wood here"}, team (${p.members.length}) · 8h</button>` : "", // sim/woodcutting.js
  ]).join("");
}
// Right-click a land tile with a team you are in touch with: go there and claim it (sim/claims.js: a marker post, the
// land counts for the coalition), or dig a well on a claim of yours next to one of your bases.
function ctxClaim(teams, id) {
  const t = state.tiles[id];
  if (!t || t.terrain === "water" || !state.bases.length) return "";
  const cw = canClaim(state, id), ww = wellProblem(state, null, id);
  if (cw && ww) return "";
  return teams.filter((p) => p.kind !== "convoy").flatMap((p) => [
    !cw ? `<button data-action="ctxclaim" data-id="${p.id}" data-tile="${id}" data-type="claim" data-tip="${esc(`Raise a marker post (${CLAIM.SCRAP} scrap carried): the tile counts as land the coalition holds, toward the 50% the alliance victory needs.`)}">${partyTile(p) === id ? "Claim this tile" : "Go and claim this tile"}, team (${p.members.length}) · ${CLAIM.HOURS}h</button>` : "",
    !ww ? `<button data-action="ctxclaim" data-id="${p.id}" data-tile="${id}" data-type="well" data-tip="${esc(`Dig a well on this claim (${CLAIM.WELL_SCRAP} scrap, ${CLAIM.WELL_PARTS} part carried): the people at your base next to it haul its water.`)}">${partyTile(p) === id ? "Dig a well here" : "Go and dig a well here"}, team (${p.members.length}) · ${CLAIM.WELL_HOURS}h</button>` : "",
  ]).join("");
}
actions.ctxclaim = (d) => {
  const p = partyById(d.id);
  if (p) {
    const tile = Number(d.tile);
    const job = { type: d.type === "well" ? "well" : "claim" };
    let msg;
    if (partyTile(p) === tile && (p.phase === "waiting" || p.phase === "task")) msg = startOrder(state, p, job);
    else {
      p.orders = [];
      msg = orderMove(state, p, tile);
      if (p.phase === "out" && p.dest === tile) msg = `${msg} ${queueOrder(state, p, { ...job, at: tile })}`;
    }
    if (msg) log(state, msg, "info");
    if (ui.expedition === p.id) ui.xpMsg = msg;
  }
  endMoveMode();
  hideCtx();
};
actions.ctxhunt = (d) => {
  const p = partyById(d.id);
  if (p) {
    const tile = Number(d.tile);
    const job = { type: d.type === "fish" || d.type === "forage" || d.type === "wood" ? d.type : "hunt", hours: 8 };
    let msg;
    if (partyTile(p) === tile && (p.phase === "waiting" || p.phase === "task")) msg = startOrder(state, p, job);
    else {
      p.orders = [];
      msg = orderMove(state, p, tile);
      if (p.phase === "out" && p.dest === tile) msg = `${msg} ${queueOrder(state, p, { ...job, at: tile })}`;
    }
    if (msg) log(state, msg, "info");
    if (ui.expedition === p.id) ui.xpMsg = msg;
  }
  endMoveMode();
  hideCtx();
};
actions.ctxcross = (d) => {
  const p = partyById(d.id);
  if (p) {
    const o = boatOrder(state, p, partyTile(p), Number(d.tile), d.mode);
    const msg = o.error || startOrder(state, p, o);
    log(state, msg, "info");
    if (ui.expedition === p.id) ui.xpMsg = msg;
  }
  hideCtx();
};
actions.ctxsweep = (d) => {
  const p = partyById(d.id);
  if (p) {
    const msg = orderSweepAt(state, p, Number(d.tile), { radius: 3, hours: 12 });
    log(state, msg, "info");
    if (ui.expedition === p.id) ui.xpMsg = msg;
  }
  endMoveMode();
  hideCtx();
};
actions.ctxmove = (d) => {
  const p = partyById(d.id);
  if (p) log(state, orderMove(state, p, Number(d.tile)), "info");
  endMoveMode(); // the menu's move replaces a pick that was still open
  hideCtx();
};
// Radio rule (sim/plans.js commandable): out of radio contact a team follows its plan; orders only through the
// cards it raises (answering one opens contact for that hour) or once it is back in coverage.
for (const k of ["orders", "movemode", "gohome", "xp-order", "xp-cross", "xp-move", "xp-stop", "xp-resume", "xp-unqueue", "xp-clearq", "xp-cancelmove", "xp-qmove", "xp-qdrop", "ctxmove", "ctxcross", "ctxhunt", "ctxsweep", "ctxclaim"]) {
  const fn = actions[k];
  actions[k] = (d) => {
    const p = partyById(d.id);
    if (p && !commandable(state, p)) { ui.xpMsg = NO_RADIO; if (k === "ctxmove" || k === "ctxcross" || k === "ctxhunt" || k === "ctxsweep" || k === "ctxclaim") hideCtx(); else if (ui.expedition == null) log(state, NO_RADIO, "info"); return; }
    return fn(d);
  };
}

// Team panel actions: start now if the team is waiting or working on the spot (unless queue mode is on in its
// panel), otherwise add to the end of its queue. Nothing here touches the speed: an order given while the game
// is paused starts when the player unpauses.
const startsNow = (p) => (p.phase === "waiting" || p.phase === "task") && !(ui.xpQueue && ui.expedition === p.id);
function issueOrder(p, o) {
  const msg = startsNow(p) ? startOrder(state, p, o) : queueOrder(state, p, o);
  ui.xpMsg = msg || "";
  if (msg) log(state, msg, "info");
}
function hideCtx() {
  $("ctxmenu").classList.add("hidden");
}

// ---------- combat input ----------
// The enemy turn keeps playing even when animation frames are throttled (hidden tab).
setInterval(() => { if (state.combat && !ui.settings && combatTick(state, performance.now())) refresh(false); }, 200);
const cbCanvas = $("combatmap");
const cbPos = (e) => { const r = cbCanvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
cbCanvas.addEventListener("mousemove", (e) => { if (state.combat) combatMouse(state, ...cbPos(e)); });
cbCanvas.addEventListener("mouseleave", () => { if (state.combat) combatLeave(); });
// The isometric view (ui/isoview.js): a press that moves pans the map, one that does not is the click (on release);
// the top-down view clicks on the press, as it always did. Right click cancels the current action.
const cancelAction = () => { if (state.combat) { cui.mode = "move"; cui.msg = ""; refresh(); } };
cbCanvas.addEventListener("mousedown", (e) => {
  if (!state.combat) return;
  if (e.button === 1) e.preventDefault();
  if (!combatPress(state, ...cbPos(e), e.button)) return;
  combatClick(state, ...cbPos(e));
  refresh();
});
window.addEventListener("mouseup", (e) => {
  if (!state.combat) return;
  const what = combatRelease(state, ...cbPos(e));
  if (what === "click") { combatClick(state, ...cbPos(e)); refresh(); }
  else if (what === "cancel") cancelAction();
});
cbCanvas.addEventListener("wheel", (e) => { if (state.combat && combatWheel(state, ...cbPos(e), e.deltaY)) e.preventDefault(); }, { passive: false });
cbCanvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (state.combat && cui.view === "top") cancelAction(); // the isometric view cancels on the release (a drag does not)
});

// ---------- keyboard ----------
// Esc closes one layer per press, the topmost first. Returns false when there was nothing of ours to close.
function closeTopLayer() {
  if (!$("ctxmenu").classList.contains("hidden")) { hideCtx(); return true; }
  if (ui.zombieLook) { ui.zombieLook = false; return true; }
  if (ui.settings) { // a question first, then the menu itself (not while a save or load is running)
    if (ui.settings.confirm) ui.settings.confirm = null;
    else if (!ui.settings.busy) ui.settings = null;
    return true;
  }
  if (ui.inv) { // drops the selection first, then closes
    if (ui.invSel) ui.invSel = null;
    else { ui.inv = null; ui.invMsg = ""; }
    return true;
  }
  if (state.combat) return false; // the battle has its own Esc (cancel the current action)
  if (!ui.started) {
    if (ui.lookEdit == null) return false;
    ui.lookEdit = null;
    return true;
  }
  if (state.gameOver) return false;
  if (ui.cardResult) { ui.cardResult = null; return true; }
  if (!state.autopilot && (state.cards.length || state.engagement || state.trade || activeCrawl(state))) return false; // these need an answer
  if (ui.planner) { ui.planner = null; view.preview = null; return true; }
  if (ui.routeSetup) { ui.routeSetup = null; return true; }
  if (ui.diplo) { ui.diplo = null; ui.diploMsg = ""; return true; } // ui/diplomacy.js (it opens over the radio panel)
  if (ui.radioWith != null) { ui.radioWith = null; ui.radioMsg = ""; return true; }
  if (ui.caravanPlan) { ui.caravanPlan = null; ui.cvMsg = ""; return true; }
  if (ui.survivor != null) {
    if (ui.lookEdit != null) ui.lookEdit = null;
    else ui.survivor = null;
    return true;
  }
  if (ui.memorial) { ui.memorial = null; ui.memorialMsg = ""; return true; } // ui/relations.js
  if (ui.baseView) {
    if (ui.supplyForm) { ui.supplyForm = null; ui.supplyError = ""; }
    else { ui.baseView = null; ui.baseMsg = ""; }
    return true;
  }
  if (ui.roster) { ui.roster = null; return true; }
  if (ui.diary) { ui.diary = null; return true; }
  if (ui.moveParty != null) { endMoveMode(); return true; }
  if (ui.expedition != null && ui.qSel != null) { ui.qSel = null; return true; } // a selected queued order: unselect first
  if (ui.expedition != null) { ui.expedition = null; ui.xpMsg = ""; return true; }
  return false;
}

window.addEventListener("keydown", (e) => {
  const t = e.target || {};
  if (t.tagName === "SELECT" || t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && t.type !== "checkbox")) return;
  // The timelapse viewer takes the keyboard (play, step, speed, pan, Esc closes).
  if (ui.timelapse) {
    if (tlKey(state, ui, e)) { e.preventDefault(); refresh(); }
    return;
  }
  if (e.code === "Escape" && closeTopLayer()) { e.preventDefault(); refresh(); return; }
  // Esc with nothing of ours to close opens the menu (in a battle Esc cancels the current action; ⚙ Menu is in the panel).
  if (ui.title) { if (!ui.settings && !ui.zombieLook && titleKey(ui, e)) e.preventDefault(); return; } // the title screen (ui/title.js): only the menu's keys
  if (e.code === "Escape" && !state.combat) { e.preventDefault(); openSettings(ui); refresh(); return; }
  if (ui.zombieLook || ui.inv || ui.settings) return; // these screens take the keyboard
  if (state.combat) {
    if (combatKey(state, e)) { e.preventDefault(); refresh(); }
    return;
  }
  // A selected order in the team panel's queue (ui/expedition.js queueBlock): ↑ ↓ move it, Delete removes it.
  if (ui.expedition != null && ui.qSel != null && ["ArrowUp", "ArrowDown", "Delete", "Backspace"].includes(e.code) && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    const p = partyById(ui.expedition);
    if (p) {
      if (e.code === "Delete" || e.code === "Backspace") actions["xp-unqueue"]({ id: p.id, i: ui.qSel });
      else actions["xp-qmove"]({ id: p.id, i: ui.qSel, dir: e.code === "ArrowUp" ? -1 : 1 });
    }
    refresh();
    return;
  }
  // The Work tab: 1–5, 0 / Backspace / Delete and R on the cell under the mouse (ui/work.js).
  if (workKey(state, ui, e)) { e.preventDefault(); refresh(); return; }
  // Tabs, next waiting team, bases, camera spots, diary and roster (ui/alerts.js); J and R also close their window.
  if (mapHotkey(state, ui, e, actions, modalKind(state, ui))) { e.preventDefault(); refresh(); return; }
  // Map shortcuts do nothing behind a window (a card, the planner, a base, help) or on the new-run screen.
  if (modalKind(state, ui)) return;
  // Panels (ui/layout.js): [ left, ] right, L log, Shift+[ running orders, Shift+] alerts, \ map only. A panel's key
  // opens it whether it is folded or closed completely. Alt + the key closes the panel completely (strip and
  // all), and brings a closed one back.
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    const shut = e.code === "BracketLeft" ? "left" : e.code === "BracketRight" ? "right" : e.code === "KeyL" ? "log" : null;
    if (shut) { e.preventDefault(); actions["panel-close"]({ p: shut }); refresh(); return; }
  }
  if (!e.ctrlKey && !e.altKey && !e.metaKey) {
    const fold = e.code === "BracketLeft" ? (e.shiftKey ? "orders" : "left") : e.code === "BracketRight" ? (e.shiftKey ? "alerts" : "right") :
      e.code === "KeyL" && !e.shiftKey ? "log" : null;
    if (fold) { e.preventDefault(); actions["panel-toggle"]({ p: fold }); refresh(); return; }
    if (e.code === "Backslash" || e.code === "IntlBackslash") { e.preventDefault(); actions["panel-all"](); refresh(); return; }
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (ui.speed > 0) { if (ui.speed <= MAX_SPEED) ui.lastSpeed = ui.speed; ui.speed = 0; } else ui.speed = ui.lastSpeed || 1;
  } else if (["Digit1", "Digit2", "Digit3", "Digit4"].includes(e.code)) {
    ui.speed = [0.5, 1, 2, 3][Number(e.code.slice(5)) - 1];
    ui.lastSpeed = ui.speed;
  } else if (e.code === "KeyH") centerOn(state, playerTile(state));
  else if (e.code === "Backquote") ui.dev = !ui.dev;
  else if (e.code === "KeyI") view.layers.has("infection") ? view.layers.delete("infection") : view.layers.add("infection");
  else {
    const pan = 40 / camera.zoom;
    if (e.code === "KeyW" || e.code === "ArrowUp") camera.y -= pan;
    else if (e.code === "KeyS" || e.code === "ArrowDown") camera.y += pan;
    else if (e.code === "KeyA" || e.code === "ArrowLeft") camera.x -= pan;
    else if (e.code === "KeyD" || e.code === "ArrowRight") camera.x += pan;
    else return;
    if (e.code.startsWith("Arrow")) e.preventDefault();
    return; // panning changes no panel
  }
  refresh();
});
// Space let go on a focused button or checkbox must not press it as well.
window.addEventListener("keyup", (e) => {
  if (state.combat) combatKeyUp(state, e); // the battle view's held pan keys
  const t = e.target || {};
  if (e.code === "Space" && (t.tagName === "BUTTON" || (t.tagName === "INPUT" && t.type === "checkbox"))) e.preventDefault();
});

// Expose for debugging in the console.
window.game = {
  get state() { return state; }, ui, tickHour: () => { tickHour(state); refresh(); }, refresh: () => refresh(),
  frameErrors, devSpeeds: DEV_SPEEDS, options, layout, windowSizes,
  // Saves and loads in flight (ui/settings.js): await game.settle() before reading their result.
  skipTitle: () => { ui.title = false; refresh(); }, // the title screen's New game without a fresh world
  settle: async () => { while (pendingIo.size) await Promise.allSettled([...pendingIo]); refresh(); },
  combat: {
    ui: cui,
    start: (setup) => { const b = startCombat(state, setup); refresh(); return b; },
    act: (a) => { const err = combatAct(state, a); refresh(); return err; },
    enemyPhase: () => { runEnemyPhase(state); cui.sel = null; refresh(); },
  },
};
refresh();
requestAnimationFrame(frame);
