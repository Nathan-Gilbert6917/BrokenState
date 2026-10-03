// Entry point: game loop, input, and the action dispatcher that connects the UI to the simulation.
import { createWorld, tickHour, hub, survivorById, baseById, log, day } from "./sim/world.js";
import { GEAR } from "./sim/data.js";
import { launchExpedition, estimateTrip, ordersCard, orderMove, startReturn, planPath, partyTile } from "./sim/parties.js";
import { searchHour, extract } from "./sim/scavenge.js";
import { executeTrade, giftAll, proposePact, endTrade, radioTalk } from "./sim/trade.js";
import { releaseEscorts, ESCORTS } from "./sim/economy.js";
import { factionById, addCard } from "./sim/world.js";
import { queueBuild, cancelBuild, assignStations } from "./sim/buildings.js";
import { refuel, repair } from "./sim/vehicles.js";
import {
  saveSupplyRun, dispatchSupplyRun, supplyRunById, jobForm, releaseHeld, pauseSupplyRun, deleteSupplyRun,
} from "./sim/supply.js";
import { SUPPLY_KEYS } from "./sim/data.js";
import { treatAtBase, fieldTreat } from "./sim/medical.js";
import { queueCraft, cancelCraft } from "./sim/crafting.js";
import { initRenderer, render, resize, centerOn, screenToTile, zoomAt, camera, view, tileTooltip } from "./ui/render.js";
import { renderTopbar, renderLeft, renderRight, renderLog, renderModal, renderLegend, tileActions } from "./ui/ui.js";
import { startCombat, combatAct, runEnemyPhase } from "./sim/combat.js";
import { queueOrder, startOrder, stopTask, resumeQueue, removeQueued, contactable, queueEndTile } from "./sim/orders.js";
import { renderRunningOrders } from "./ui/expedition.js";
import { boatOrder, boatPlan, boatTip, crossingTo } from "./sim/crossing.js";
import { initCombatUI, drawCombat, renderCombatPanel, combatTick, combatMouse, combatClick, combatKey, combatAction, cui } from "./ui/combat.js";
import { LOOK_ACTIONS, LOOK_CHANGE_ACTIONS, crewSnapshot } from "./ui/newgame.js";
import { INV_ACTIONS, invDrop } from "./ui/inventory.js";
import { renderDevPanel, devSample } from "./ui/devtools.js";
import { TL_ACTIONS, tlFrame, tlKey } from "./ui/timelapse.js";
import { setAutopilot, setPersonality, autopilotResolve } from "./sim/autopilot.js";

const HOURS_PER_SECOND = 1 / 3; // at 1× speed an hour takes 3 seconds and a day 72 seconds

const ui = {
  started: false, speed: 1, lastSpeed: 1, tab: "bases", selected: -1, scale: 1, factionCount: 7,
  planner: null, plannerError: "", routeSetup: null, survivor: null, help: false, cardResult: null, tradeMsg: "",
  baseView: null, baseMsg: "", moveParty: null, legendCollapsed: false, supplyForm: null, supplyError: "",
  expedition: null, xpMsg: "", xpQueue: false, moveQueue: false, ordersCollapsed: false, // team panel and order queue
  inv: null, invSel: null, invMsg: "", // inventory / loot screen (ui/inventory.js)
};
let state = createWorld({ seed: randomSeed(), factionCount: ui.factionCount });
let dirty = true;

function randomSeed() {
  return Math.floor(Math.random() * 1e6);
}

const $ = (id) => document.getElementById(id);
const canvas = $("map");
initRenderer(canvas);
initCombatUI($("combatmap"));
centerOn(state, hub(state).tile);

// ---------- loop ----------
let last = performance.now();
let acc = 0;
function blocked() {
  // On autopilot the governor answers cards, runs searches and trades itself (sim/autopilot.js), so they do not stop the clock.
  const pending = !state.autopilot && (state.cards.length > 0 || !!state.engagement || !!state.trade);
  return !ui.started || !!state.combat || state.gameOver || !!ui.cardResult || pending ||
    !!ui.planner || !!ui.routeSetup || !!ui.survivor || !!ui.baseView || ui.help || !!ui.zombieLook || !!ui.inv || !!ui.timelapse;
}
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (state.autopilot && ui.started && autopilotResolve(state)) dirty = true; // cards and battles never wait for a click
  if (!blocked() && ui.speed > 0 && !ui.moveParty) {
    acc += dt * ui.speed * HOURS_PER_SECOND;
    let n = 0;
    while (acc >= 1 && n < 12) {
      tickHour(state);
      acc -= 1;
      n++;
      dirty = true;
      if (blocked()) {
        acc = 0;
        break;
      }
    }
  }
  if (ui.timelapse) tlFrame(state, ui, now); // recorded frames instead of the live map (ui/timelapse.js)
  else if (state.combat) {
    if (combatTick(state, now)) dirty = true;
    drawCombat(state, now);
  } else render(state);
  if (dirty) refresh();
  requestAnimationFrame(frame);
}

function refresh() {
  dirty = false;
  $("topbar").innerHTML = renderTopbar(state, ui);
  const active = document.activeElement;
  if (!(active && $("left").contains(active) && active.tagName === "SELECT")) $("left").innerHTML = renderLeft(state, ui);
  $("right").innerHTML = renderRight(state, ui);
  $("log").innerHTML = renderLog(state);
  const html = renderModal(state, ui);
  const modal = $("modal");
  if (html) {
    const box = modal.querySelector(".basebody");
    const scroll = box ? box.scrollTop : 0;
    modal.innerHTML = html;
    modal.classList.remove("hidden");
    modal.classList.toggle("over-combat", !!state.combat); // the loot screen sits on top of the battle
    const nb = modal.querySelector(".basebody");
    if (nb) nb.scrollTop = scroll;
    const elog = $("elog");
    if (elog) elog.scrollTop = elog.scrollHeight;
  } else {
    modal.classList.add("hidden");
    modal.innerHTML = "";
  }
  $("legend").innerHTML = renderLegend(view, ui);
  const dp = $("devpanel");
  if (dp) {
    if (ui.started) devSample(state);
    const html = ui.started ? renderDevPanel(state, ui) : "";
    dp.innerHTML = html;
    dp.classList.toggle("hidden", !html);
  }
  const ro = $("orders");
  if (ro) {
    const html = ui.started ? renderRunningOrders(state, ui) : "";
    ro.innerHTML = html;
    ro.classList.toggle("hidden", !html);
  }
  renderCombat();
  const banner = $("banner");
  if (ui.moveParty) {
    banner.innerHTML = `Move mode: <b>left-click a tile</b> to ${ui.moveQueue ? "add a move to the team's queue" : "send the team there"}. Time is paused until you pick. <b>Esc</b> cancels.`;
    banner.classList.remove("hidden");
  } else banner.classList.add("hidden");
  hideTip();
}

// Tactical battle overlay.
function renderCombat() {
  const box = $("combat");
  if (!state.combat) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  const panel = $("cbpanel");
  panel.innerHTML = renderCombatPanel(state);
  const clog = $("cblog");
  if (clog) clog.scrollTop = clog.scrollHeight;
}

// ---------- actions ----------
function autofill(pl) {
  const h = hub(state);
  const ids = [...pl.crew];
  const v = pl.vehicleId ? state.vehicles.find((x) => x.id === pl.vehicleId) : null;
  const est = estimateTrip(state, { memberIds: ids.length ? ids : [0], dest: pl.dest, vehicle: !!v, stance: pl.stance });
  view.preview = est ? est.path : null;
  if (!est) return;
  const n = Math.max(1, ids.length);
  const want = {
    food: Math.ceil(est.food * 1.25), water: Math.ceil(est.water * 1.25),
    fuel: (v ? Math.max(0, Math.ceil(est.fuel * 1.25 - v.fuel)) : 0) + (pl.mission === "getvehicle" ? 10 : 0),
    meds: Math.min(2, n), ammo: 15 * n, parts: pl.mission === "getvehicle" || pl.mission === "investigate" ? 2 : 0,
    scrap: pl.mission === "outpost" ? 15 : 0,
  };
  for (const k of Object.keys(want)) pl.supplies[k] = Math.max(0, Math.min(Math.floor(h.stock[k] || 0), want[k]));
}

const partyById = (id) => state.parties.find((p) => p.id === Number(id));
const baseOf = (d) => baseById(state, Number(d.base));

const actions = {
  speed: (d) => { ui.speed = Number(d.speed); if (ui.speed > 0) ui.lastSpeed = ui.speed; },
  tab: (d) => { ui.tab = d.tab; },
  "dev-toggle": () => { ui.dev = !ui.dev; },
  "dev-reveal": () => { view.devReveal = !view.devReveal; },
  "dev-infection": () => { view.layers.has("infection") ? view.layers.delete("infection") : view.layers.add("infection"); },
  // Autopilot: an AI governor runs the holdout (sim/autopilot.js). A battle or loot screen left open is finished for you.
  "dev-autopilot": () => {
    if (!ui.started || state.gameOver) return;
    if (!state.autopilot) { ui.cardResult = null; if (ui.inv && ui.inv.loot) { ui.inv = null; ui.invSel = null; } }
    setAutopilot(state, !state.autopilot);
  },
  "dev-persona": (d) => { setPersonality(state, d.v); },
  center: (d) => { centerOn(state, Number(d.tile)); ui.selected = Number(d.tile); view.selected = ui.selected; },
  help: () => { ui.help = true; },
  closehelp: () => { ui.help = false; },
  legendtoggle: () => { ui.legendCollapsed = !ui.legendCollapsed; },
  // Base management.
  openbase: (d) => { ui.baseView = { id: Number(d.id), tab: d.tab || "overview" }; ui.baseMsg = ""; ui.supplyForm = null; },
  basetab: (d) => { ui.baseView.tab = d.tab; ui.baseMsg = ""; },
  closebase: () => { ui.baseView = null; ui.baseMsg = ""; ui.supplyForm = null; },
  // Supply runs (Supply runs tab of the base screen).
  "sr-new": (d) => { ui.supplyForm = jobForm(state, null, Number(d.base)); ui.supplyError = ""; },
  "sr-edit": (d) => {
    const j = supplyRunById(state, Number(d.id));
    if (!j) return;
    ui.supplyForm = jobForm(state, j, j.originId, "edit");
    if (ui.baseView) ui.baseView.id = j.originId;
    ui.supplyError = "";
  },
  "sr-recreate": (d) => {
    const j = supplyRunById(state, Number(d.id));
    if (!j) return;
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
  "sr-dispatch": (d) => { const j = supplyRunById(state, Number(d.id)); if (j) ui.baseMsg = dispatchSupplyRun(state, j, true); },
  "sr-pause": (d) => { const j = supplyRunById(state, Number(d.id)); if (j) ui.baseMsg = pauseSupplyRun(state, j, true); },
  "sr-resume": (d) => { const j = supplyRunById(state, Number(d.id)); if (j) ui.baseMsg = pauseSupplyRun(state, j, false); },
  "sr-release": (d) => { const j = supplyRunById(state, Number(d.id)); if (j) ui.baseMsg = releaseHeld(state, j, d.how); },
  "sr-delete": (d) => { const j = supplyRunById(state, Number(d.id)); if (j) ui.baseMsg = deleteSupplyRun(state, j); },
  queuebuild: (d) => { ui.baseMsg = queueBuild(state, baseOf(d), d.type); },
  // Medical: treat at a base (base meds) or in the field (the team's carried meds).
  treat: (d) => { const msg = treatAtBase(state, baseOf(d), Number(d.id)); if (ui.baseView) ui.baseMsg = msg; else log(state, msg, "info"); },
  fieldtreat: (d) => { const p = state.parties.find((x) => x.id === Number(d.party)); log(state, p ? fieldTreat(state, p, Number(d.id)) : "That team is gone.", "info"); },
  cancelbuild: (d) => { cancelBuild(state, baseOf(d), Number(d.id)); ui.baseMsg = "Cancelled. Half the materials were returned."; },
  // Hand crafting (base Crafting tab).
  queuecraft: (d) => { ui.baseMsg = queueCraft(state, baseOf(d), d.recipe); },
  cancelcraft: (d) => { ui.baseMsg = cancelCraft(state, baseOf(d), Number(d.id)); },
  refuel: (d) => { ui.baseMsg = refuel(state, baseOf(d), state.vehicles.find((v) => v.id === Number(d.id))); },
  repairv: (d) => { ui.baseMsg = repair(state, baseOf(d), state.vehicles.find((v) => v.id === Number(d.id))); },
  survivor: (d) => { ui.survivor = Number(d.id); },
  closesurv: () => { ui.survivor = null; ui.lookEdit = null; },
  unequip: (d) => {
    const s = survivorById(state, Number(d.id));
    const b = baseOf(d);
    if (s.gear[d.slot] && b) b.armory.push(s.gear[d.slot]);
    s.gear[d.slot] = null;
  },
  // Teams and orders.
  orders: (d) => {
    const p = partyById(d.id);
    if (p && !state.cards.some((c) => c.partyId === p.id)) addCard(state, ordersCard(state, p, ""));
  },
  movemode: (d) => {
    ui.moveParty = ui.moveParty === Number(d.id) ? null : Number(d.id);
    ui.moveQueue = false;
    ui.baseView = null;
    const p = partyById(d.id);
    if (p) centerOn(state, partyTile(p));
  },
  gohome: (d) => { const p = partyById(d.id); if (p) { startReturn(state, p); log(state, "Team ordered home.", "info"); resumeTime(); } },
  // Team panel (right sidebar) and the order queue. Timed orders resume the clock.
  "xp-open": (d) => { ui.expedition = Number(d.id); ui.xpMsg = ""; const p = partyById(d.id); if (p && contactable(p)) { ui.selected = partyTile(p); view.selected = ui.selected; } },
  "xp-close": () => { ui.expedition = null; ui.xpMsg = ""; },
  "xp-queuemode": () => { ui.xpQueue = !ui.xpQueue; },
  "xp-orderstoggle": () => { ui.ordersCollapsed = !ui.ordersCollapsed; },
  "xp-order": (d) => {
    const p = partyById(d.id);
    if (!p) return;
    const o = { type: d.type };
    if (d.mission) o.mission = d.mission;
    if (d.type === "camp") o.hours = d.hours ? Number(d.hours) : null;
    if (d.sid) o.survivorId = Number(d.sid);
    if (d.recipe) o.recipe = d.recipe; // field crafting
    issueOrder(p, o);
  },
  // Build a boat and cross one water tile (sim/crossing.js). Hours and materials are fixed now.
  "xp-cross": (d) => {
    const p = partyById(d.id);
    if (!p) return;
    const now = (p.phase === "waiting" || p.phase === "task") && !ui.xpQueue;
    const o = boatOrder(state, p, now ? partyTile(p) : queueEndTile(state, p), Number(d.tile), d.mode);
    if (o.error) { ui.xpMsg = o.error; return; }
    issueOrder(p, o);
  },
  "xp-move": (d) => {
    const p = partyById(d.id);
    if (!p) return;
    ui.moveParty = p.id;
    // A team on the move (or with queue mode on) gets the move added to its queue.
    ui.moveQueue = !(p.phase === "waiting" || p.phase === "task") || ui.xpQueue;
    centerOn(state, ui.moveQueue ? queueEndTile(state, p) : partyTile(p));
  },
  "xp-stop": (d) => { const p = partyById(d.id); if (p) { ui.xpMsg = stopTask(state, p); resumeTime(); } },
  "xp-resume": (d) => { const p = partyById(d.id); if (p) { ui.xpMsg = resumeQueue(state, p); resumeTime(); } },
  "xp-unqueue": (d) => { const p = partyById(d.id); if (p) ui.xpMsg = removeQueued(state, p, Number(d.i)); },
  "xp-clearq": (d) => { const p = partyById(d.id); if (p) { p.orders = []; ui.xpMsg = "Queue cleared."; } },
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
    const route = { id: Date.now(), factionId: r.factionId, sendKey: r.sendKey, sendQty: r.sendQty, recvKey: r.recvKey, recvQty: r.recvQty, interval: Math.max(2, r.interval), escort: r.escort, escortIds: [...r.escortIds], nextDay: day(state), active: true };
    state.routes.push(route);
    for (const id of route.escortIds) survivorById(state, id).location = { kind: "route", routeId: route.id };
    log(state, `Trade route to ${factionById(state, r.factionId).name} set up. The first convoy leaves at the next dawn.`, "good");
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
    ui.planner = pl;
    ui.plannerError = "";
    autofill(pl);
    hideCtx();
  },
  "pl-crew": (d) => { const s = ui.planner.crew, id = Number(d.id); s.has(id) ? s.delete(id) : s.add(id); autofill(ui.planner); },
  "pl-vehicle": (d) => { ui.planner.vehicleId = d.v ? Number(d.v) : null; autofill(ui.planner); },
  "pl-stance": (d) => { ui.planner.stance = d.v; autofill(ui.planner); },
  "pl-autofill": () => autofill(ui.planner),
  "pl-cancel": () => { ui.planner = null; view.preview = null; },
  "pl-launch": () => {
    const pl = ui.planner;
    const res = launchExpedition(state, { memberIds: [...pl.crew], dest: pl.dest, mission: pl.mission, stance: pl.stance, vehicleId: pl.vehicleId, supplies: { ...pl.supplies } });
    if (res.error) { ui.plannerError = res.error; return; }
    ui.planner = null;
    view.preview = null;
  },
  choice: (d) => {
    const card = state.cards.shift();
    const c = card.choices[Number(d.i)];
    const text = c.resolve(state);
    if (c.uiAction && c.uiAction.type === "move") {
      ui.moveParty = c.uiAction.partyId;
      ui.moveQueue = false;
      const p = partyById(c.uiAction.partyId);
      if (p) centerOn(state, partyTile(p));
      return;
    }
    if (c.uiAction && c.uiAction.type === "expedition") {
      actions["xp-open"]({ id: c.uiAction.partyId });
      return;
    }
    // Orders that take time: the clock runs on, the result goes to the log instead of a screen.
    if (c.order) {
      if (text) log(state, text, "info");
      resumeTime();
      return;
    }
    // Orders that lead straight into another card skip the result screen.
    if (text) ui.cardResult = { title: card.title, text };
  },
  cardok: () => { ui.cardResult = null; },
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
  pickleader: (d) => { state.survivors.forEach((s) => (s.leader = s.id === Number(d.id))); ui.crewEdited = true; },
  begin: () => {
    ui.started = true;
    ui.lookEdit = null;
    state.started = true;
    centerOn(state, hub(state).tile);
    log(state, `${state.survivors.find((s) => s.leader).name} leads the group.`, "info");
  },
  restart: () => { ui.started = false; newWorld(randomSeed()); },
};

for (const k of ["cb-sel", "cb-act", "cb-target", "cb-end", "cb-auto", "cb-close"]) actions[k] = (d) => combatAction(state, k, d);
// Look editor, new-run randomizers and zombie look settings (ui/newgame.js).
for (const [k, fn] of Object.entries(LOOK_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Inventory and loot screens (ui/inventory.js).
for (const [k, fn] of Object.entries(INV_ACTIONS)) actions[k] = (d) => fn(state, ui, d);
// Timelapse viewer (ui/timelapse.js).
for (const [k, fn] of Object.entries(TL_ACTIONS)) actions[k] = (d) => fn(state, ui, d);

// Inventory drag and drop: tiles carry data-drag (their location), slots and storage boxes data-drop.
document.addEventListener("dragstart", (ev) => {
  const el = ev.target.closest && ev.target.closest("[data-drag]");
  if (!el || !ui.inv) return;
  ev.dataTransfer.setData("text/plain", el.dataset.drag);
  ev.dataTransfer.effectAllowed = "move";
  hideTip();
});
document.addEventListener("dragover", (ev) => {
  if (ui.inv && ev.target.closest && ev.target.closest("[data-drop]")) ev.preventDefault();
});
document.addEventListener("drop", (ev) => {
  const el = ev.target.closest && ev.target.closest("[data-drop]");
  if (!el || !ui.inv) return;
  ev.preventDefault();
  const from = ev.dataTransfer.getData("text/plain");
  if (from) { invDrop(state, ui, from, el.dataset.drop); refresh(); }
});

const changeActions = {
  uiscale: (el) => { ui.scale = Number(el.value); document.documentElement.style.setProperty("--ui-scale", ui.scale); setTimeout(resize, 50); },
  role: (el) => {
    const s = survivorById(state, Number(el.dataset.id));
    s.role = el.value;
    if (s.role !== "operate") s.station = null;
    if (s.location.kind === "base") assignStations(state, baseById(state, s.location.baseId));
  },
  medicop: (el) => {
    if (!el.value) return;
    const s = survivorById(state, Number(el.value));
    s.role = "medic";
    s.station = null;
    if (s.location.kind === "base") assignStations(state, baseById(state, s.location.baseId));
    ui.baseMsg = `${s.name} now works as a medic.`;
  },
  craftop: (el) => {
    if (!el.value) return;
    const s = survivorById(state, Number(el.value));
    s.role = "craft";
    s.station = null;
    if (s.location.kind === "base") assignStations(state, baseById(state, s.location.baseId));
    ui.baseMsg = `${s.name} now crafts by hand.`;
  },
  stationop: (el) => {
    const b = baseOf(el.dataset);
    const stationId = Number(el.dataset.station);
    // Whoever was on this station is freed up.
    for (const s of state.survivors) if (s.station === stationId) { s.station = null; if (s.role === "operate") s.role = "rest"; }
    if (el.value) {
      const s = survivorById(state, Number(el.value));
      s.role = "operate";
      s.station = stationId;
      ui.baseMsg = `${s.name} now runs this station.`;
    }
    if (b) ui.baseMsg = ui.baseMsg || "Station has no operator.";
  },
  equip: (el) => {
    if (el.value === "") return;
    const s = survivorById(state, Number(el.dataset.id));
    const b = baseOf(el.dataset);
    if (!b) return;
    const item = b.armory.splice(Number(el.value), 1)[0];
    const slot = GEAR[item.key].slot;
    if (s.gear[slot]) b.armory.push(s.gear[slot]);
    s.gear[slot] = item;
  },
  layer: (el) => { el.checked ? view.layers.add(el.dataset.k) : view.layers.delete(el.dataset.k); },
  rt: (el) => { const f = el.dataset.f; ui.routeSetup[f] = el.tagName === "SELECT" ? el.value : Math.max(0, Number(el.value)); },
  "sr-dest": (el) => { ui.supplyForm.destId = Number(el.value); },
  "sr-line": (el) => {
    const l = ui.supplyForm[el.dataset.list][Number(el.dataset.i)];
    if (!l) return;
    if (el.dataset.f === "key") l.key = el.value;
    else l.qty = Math.max(0, Math.floor(Number(el.value) || 0));
  },
  "sr-every": (el) => { ui.supplyForm.every = Math.max(1, Math.floor(Number(el.value) || 1)); },
  "pl-mission": (el) => { ui.planner.mission = el.value; autofill(ui.planner); },
  "pl-supply": (el) => { ui.planner.supplies[el.dataset.k] = Math.max(0, Math.floor(Number(el.value) || 0)); },
  ...Object.fromEntries(Object.entries(LOOK_CHANGE_ACTIONS).map(([k, fn]) => [k, (el) => fn(state, ui, el)])),
  seed: (el) => newWorld(Number(el.value) || 1, true),
  factioncount: (el) => { ui.factionCount = Number(el.value); newWorld(state.seed, true); },
  rename: (el) => { const s = survivorById(state, Number(el.dataset.id)); if (el.value.trim()) { s.name = el.value.trim(); if (!ui.started) ui.crewEdited = true; } },
};

// keepCrew: carry colonists edited on the new-run screen into the rebuilt world.
function newWorld(seed, keepCrew = false) {
  const crew = keepCrew && ui.crewEdited ? crewSnapshot(state) : null;
  if (!crew) ui.crewEdited = false;
  ui.lookEdit = null;
  ui.inv = null;
  ui.invSel = null;
  state = createWorld({ seed, factionCount: ui.factionCount, crew });
  ui.selected = -1;
  view.selected = -1;
  centerOn(state, hub(state).tile);
}

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el || el.tagName === "SELECT" || (el.tagName === "INPUT" && el.type !== "checkbox")) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  if (el.tagName === "INPUT" && el.type === "checkbox" && el.dataset.action !== "layer") ev.preventDefault();
  fn(el.dataset);
  refresh();
});
document.addEventListener("change", (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el) return;
  const fn = changeActions[el.dataset.action];
  if (!fn) return;
  fn(el);
  refresh();
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
  tipEl.classList.remove("hidden");
  placeTip(e);
});
document.addEventListener("mousemove", (e) => { if (tipTarget) placeTip(e); });
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
  if (inside && !drag && e.target === canvas && !ui.timelapse) { // the timelapse shows no live tile info
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
  if (!drag.moved && !ui.timelapse) {
    const r = canvas.getBoundingClientRect();
    const id = screenToTile(state, e.clientX - r.left, e.clientY - r.top);
    const picking = ui.moveParty && id >= 0;
    if (picking) {
      const p = partyById(ui.moveParty);
      if (p) {
        const msg = ui.moveQueue ? queueOrder(state, p, { type: "move", tile: id }) : orderMove(state, p, id);
        log(state, msg, "info");
        if (ui.expedition === p.id) ui.xpMsg = msg;
        resumeTime();
      }
      ui.moveParty = null;
      ui.moveQueue = false;
      view.preview = null;
    } else if (id >= 0) {
      // Clicking a team you are in touch with opens its panel; any other tile goes back to the tile view.
      const team = state.parties.find((p) => contactable(p) && partyTile(p) === id);
      ui.expedition = team ? team.id : null;
      ui.xpMsg = "";
    }
    ui.selected = id;
    view.selected = id;
    dirty = true;
  }
  drag = null;
  canvas.style.cursor = "grab";
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const id = screenToTile(state, e.clientX - r.left, e.clientY - r.top);
  if (id < 0 || ui.timelapse) return;
  ui.selected = id;
  view.selected = id;
  const t = state.tiles[id];
  const acts = tileActions(state, id);
  const waiting = state.parties.filter((p) => contactable(p));
  const menu = $("ctxmenu");
  menu.innerHTML = `<div class="head">${t.loc ? t.loc.name : `Tile ${t.x},${t.y}`}</div>` +
    waiting.map((p) => `<button data-action="ctxmove" data-id="${p.id}" data-tile="${id}">Move team (${p.members.length}) here</button>`).join("") +
    ctxBoats(waiting, id) +
    (acts.length ? acts.map(([m, l]) => `<button data-action="plan" data-tile="${id}" data-mission="${m}">${l} (from hub)</button>`).join("") : `<div class="small muted" style="padding:0.3rem 0.5rem">Your base</div>`);
  menu.style.left = `${e.clientX - r.left}px`;
  menu.style.top = `${e.clientY - r.top}px`;
  menu.classList.remove("hidden");
  dirty = true;
});
// Right-click on the land straight across one water tile from a team you are in touch with: build a boat.
function ctxBoats(teams, id) {
  const q = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return teams.filter((p) => p.kind !== "convoy" && crossingTo(state, partyTile(p), id)).flatMap((p) =>
    (p.vehicleId ? ["raft", "leave"] : ["raft"]).map((m) => {
      const plan = boatPlan(state, p, partyTile(p), id, m);
      return `<button data-action="ctxcross" data-id="${p.id}" data-tile="${id}" data-mode="${m}" ${plan.ok ? "" : "disabled"} data-tip="${q(boatTip(state, plan, id))}">Boat team (${p.members.length}) across${p.vehicleId ? (m === "raft" ? ", raft vehicle" : ", leave vehicle") : ""} · ${plan.mats.scrap} scrap, ${plan.hours}h</button>`;
    })).join("");
}
actions.ctxcross = (d) => {
  const p = partyById(d.id);
  if (p) {
    const o = boatOrder(state, p, partyTile(p), Number(d.tile), d.mode);
    const msg = o.error || startOrder(state, p, o);
    log(state, msg, "info");
    if (ui.expedition === p.id) ui.xpMsg = msg;
    resumeTime();
  }
  hideCtx();
};
actions.ctxmove = (d) => {
  const p = partyById(d.id);
  if (p) { log(state, orderMove(state, p, Number(d.tile)), "info"); resumeTime(); }
  hideCtx();
};

// Giving a timed order un-pauses the game at the speed it last ran at.
function resumeTime() {
  if (ui.speed === 0) ui.speed = ui.lastSpeed || 1;
}

// Team panel actions: start now if the team is waiting or working on the spot (unless queue mode is on),
// otherwise add to the end of its queue.
function issueOrder(p, o) {
  const now = (p.phase === "waiting" || p.phase === "task") && !ui.xpQueue;
  const msg = now ? startOrder(state, p, o) : queueOrder(state, p, o);
  ui.xpMsg = msg || "";
  if (msg) log(state, msg, "info");
  resumeTime();
}
function hideCtx() {
  $("ctxmenu").classList.add("hidden");
}

// ---------- combat input ----------
// The enemy turn keeps playing even when animation frames are throttled (hidden tab).
setInterval(() => { if (state.combat && combatTick(state, performance.now())) refresh(); }, 200);
const cbCanvas = $("combatmap");
const cbPos = (e) => { const r = cbCanvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
cbCanvas.addEventListener("mousemove", (e) => { if (state.combat) combatMouse(state, ...cbPos(e)); });
cbCanvas.addEventListener("mouseleave", () => { if (state.combat) cui.hover = null; });
cbCanvas.addEventListener("mousedown", (e) => {
  if (!state.combat || e.button !== 0) return;
  combatClick(state, ...cbPos(e));
  refresh();
});
cbCanvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (state.combat) { cui.mode = "move"; cui.msg = ""; refresh(); }
});

window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  // The timelapse viewer takes the keyboard (play, step, speed, pan, Esc closes).
  if (ui.timelapse) {
    if (tlKey(state, ui, e)) { e.preventDefault(); refresh(); }
    return;
  }
  // The inventory / loot screen takes the keyboard: Esc drops the selection, then closes it.
  if (ui.inv) {
    if (e.code === "Escape") { if (ui.invSel) ui.invSel = null; else { ui.inv = null; ui.invMsg = ""; } refresh(); }
    return;
  }
  if (state.combat) {
    if (combatKey(state, e)) { e.preventDefault(); refresh(); }
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (ui.speed > 0) { ui.lastSpeed = ui.speed; ui.speed = 0; } else ui.speed = ui.lastSpeed || 1;
  } else if (["Digit1", "Digit2", "Digit3", "Digit4"].includes(e.code)) {
    ui.speed = [0.5, 1, 2, 3][Number(e.code.slice(5)) - 1];
    ui.lastSpeed = ui.speed;
  } else if (e.code === "KeyH") centerOn(state, hub(state).tile);
  else if (e.code === "Backquote") ui.dev = !ui.dev;
  else if (e.code === "KeyP") actions["dev-autopilot"]();
  else if (e.code === "KeyI") view.layers.has("infection") ? view.layers.delete("infection") : view.layers.add("infection");
  else if (e.code === "Escape") {
    hideCtx();
    if (ui.planner) { ui.planner = null; view.preview = null; }
    if (ui.moveParty) { ui.moveParty = null; ui.moveQueue = false; view.preview = null; }
    else if (ui.expedition != null) { ui.expedition = null; ui.xpMsg = ""; }
    ui.survivor = null;
    ui.help = false;
    ui.zombieLook = false;
    ui.lookEdit = null;
    ui.routeSetup = null;
    ui.baseView = null;
    ui.supplyForm = null;
  } else {
    const pan = 40 / camera.zoom;
    if (e.code === "KeyW" || e.code === "ArrowUp") camera.y -= pan;
    if (e.code === "KeyS" || e.code === "ArrowDown") camera.y += pan;
    if (e.code === "KeyA" || e.code === "ArrowLeft") camera.x -= pan;
    if (e.code === "KeyD" || e.code === "ArrowRight") camera.x += pan;
  }
  refresh();
});

// Expose for debugging in the console.
window.game = {
  get state() { return state; }, ui, tickHour: () => { tickHour(state); refresh(); }, refresh: () => refresh(),
  combat: {
    ui: cui,
    start: (setup) => { const b = startCombat(state, setup); refresh(); return b; },
    act: (a) => { const err = combatAct(state, a); refresh(); return err; },
    enemyPhase: () => { runEnemyPhase(state); cui.sel = null; refresh(); },
  },
};
refresh();
requestAnimationFrame(frame);
