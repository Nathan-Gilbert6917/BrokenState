// The first-week guide (suggestions-4 #2): an opt-in checklist pinned under the alerts stack on the right of the map.
// A handful of steps a new player needs in the first days, each with a line on why it matters and a "Show me" that
// opens the right screen and pulses the button to press. Steps tick off from the state of the game (a team really
// out, a building really queued, the clock really past the first dawn), never by clicking them; a small toast says so.
// - Two lists: a normal start (a hub with people: the stores, work priorities, a building, a team out and home, the
//   first night, the diary) and a Hardcore start on the road (the team, water, the camp (Establish base), its needs, the
//   shelter, the first night, the diary). Which one is picked when the guide starts: no base yet = the road list.
// - state.guide = { kind: "base" | "road", on, keep, fold, done: { step id: hour }, h0, b0, sent: [{ id, who }], wLow,
//   ended }. Saved with the world (sim/save.js writes the whole state); an older save has none and shows nothing.
//   h0: the hour it started (the clock and the first dawn count from it); b0: buildings then; sent: player teams seen
//   leaving a base (for "bring them home"); wLow: the least water held so far (for "find water").
// - Off by itself once every step is done or after day GUIDE.DAYS (not when brought back by hand from the menu:
//   keep), or with its ✕. The menu's Game tab brings it back or hides it (gd-toggle).
// - The new-run screen's "First-week guide" box (ui/newgame.js, ui.guide): on by default for the first campaign on
//   this machine (no saves, options.guideSeen unset), off after that (main.js begin).
// - Purely the player's: it never pauses the clock, adds cards or touches the simulation; the autopilot and the
//   headless tools never start it.
import { day, hub, alive } from "../sim/world.js";
import { partyTile, partyMembers } from "../sim/parties.js";
import { teamWaterIn, waterIn } from "../sim/water.js";
import { waterSource, ESTABLISH_LABEL } from "../sim/staging.js";
import { isCamp, tierUpJob, gatherRows } from "../sim/buildings.js";
import { roadTeam } from "../sim/hardcore-start.js";
import { tileActions } from "./ui.js";
import { listSaves } from "./saves.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export const GUIDE = {
  DAYS: 7,          // off by itself after this day (unless brought back by hand)
  PULSE_MS: 12000,  // how long a "Show me" pulse lasts
  SENT_MAX: 8,      // teams remembered for "bring them home"
  WATER_GAIN: 3,    // water held above the lowest seen that counts as "found water"
  SITE_REACH: 8,    // how far from the hub "Show me" looks for a site to scavenge
};

// ---------- what counts ----------
const mine = (state) => state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && partyMembers(state, p).length);
const buildingCount = (state) => state.bases.reduce((a, b) => a + (b.buildings || []).length, 0);
// Water the player holds anywhere: every team, the bases (camps too).
function waterHeld(state) {
  let w = 0;
  for (const p of mine(state)) w += teamWaterIn(p);
  for (const b of state.bases) w += waterIn(b.stock);
  return w;
}
// The first dawn after the guide started (06:00 of the next day).
const firstDawn = (g) => (Math.floor(g.h0 / 24) + 1) * 24 + 6;
const homeTeams = (state, g) => g.sent.filter((x) => !state.parties.some((p) => p.id === x.id));

// ---------- the steps ----------
// done(state, g, ui): true once it is done. show(state, ui, act): opens what it needs and returns the CSS selectors
// to pulse. Show-me helpers below.
const STEPS = {
  stores: {
    title: "Check your food and water", why: "Food and water run out first. The top bar's Needs button (hover it for every supply) and the base's Farming tab show how many days you have left.",
    done: (state, g, ui) => !!ui.baseView && ["farming", "overview"].includes(ui.baseView.tab),
    show: (state, ui, act) => (openHub(state, ui, act, "farming") ? ["#tb-stock", '[data-action="basetab"][data-tab="farming"]'] : ["#tb-stock"]),
  },
  work: {
    title: "Put your people on work priorities", why: "On priorities everyone picks the most urgent job they are set for, hour by hour: farming, building, guarding when the dead come. One click sets everyone up.",
    done: (state) => alive(state).some((s) => s.work && s.work.role != null),
    show: (state, ui, act) => { openHub(state, ui, act, "work"); return ['[data-action="weveryone"]', '[data-action="basetab"][data-tab="work"]']; },
  },
  build: {
    title: "Queue a building", why: "Your hub starts bare: the town hall has four beds for six people, six crop plots, a well and a fence, and nothing else is built. What goes up first is your call: a bunkhouse so nobody sleeps crowded, a crafting bench for gear, farm plots, a wall. Scrap and parts pay for them; your builders do the work.",
    done: (state, g) => state.bases.some((b) => (b.construction || []).length) || buildingCount(state) > g.b0,
    show: (state, ui, act) => { openHub(state, ui, act, "construction"); return ['[data-action="queuebuild"]:not([disabled])']; },
  },
  scavenge: {
    title: "Send a team to scavenge", why: "Scrap, parts, meds and ammo come from the ruins. Click a site, pick Scavenge / raid, choose who goes and launch: the planner packs their supplies.",
    done: (state, g) => g.sent.length > 0,
    show: (state, ui, act) => showSite(state, ui, act),
  },
  clock: {
    title: "Start the clock", why: "A new game waits paused while you look around and give orders. Space (or ▶ Run on the banner) runs it; 0–5 pick the speed.",
    done: (state, g) => state.hour > g.h0,
    show: (state, ui) => { closeWindows(ui); return ['#tb-speed [data-action="speed"][data-speed="1"]', '#banner [data-action="speed"]']; },
  },
  night: {
    title: "Get through the first night", why: "Night runs from 20:00 to 06:00, and a team out sees only the tile it stands on. Guards and walls hold a base through it; a team in the field can set up camp (the barest base: its people rest there; a fire warms, but its light draws trouble).",
    done: (state, g) => state.hour >= firstDawn(g),
    show: (state, ui, act) => {
      const p = state.bases.length ? null : openTeam(state, ui, act);
      if (p) return ['[data-action="xp-order"][data-mission="camp"]', '[data-action="campfire"]'];
      closeWindows(ui);
      ui.tab = "bases";
      act["panel-toggle"]({ p: "left", v: "0" });
      return ["#left .tabs + .card", "#tb-clock"];
    },
  },
  home: {
    title: "Bring a team home", why: "What a team finds only counts once it is home (or a convoy brings it). Out of radio range it reports when it gets back; Return home calls it in.",
    done: (state, g) => homeTeams(state, g).some((x) => x.who.some((id) => { const s = state.survivors.find((y) => y.id === id); return s && s.alive && s.location && s.location.kind === "base"; })),
    show: (state, ui, act, g) => {
      const out = g.sent.map((x) => state.parties.find((p) => p.id === x.id)).find(Boolean);
      if (!out) return showSite(state, ui, act); // nobody out yet: send one first
      openTeam(state, ui, act, out);
      ui.tab = "teams"; // the Teams tab lists it too, with its own Return home
      act["panel-toggle"]({ p: "left", v: "0" });
      return ['[data-action="xp-order"][data-type="home"]', '[data-action="gohome"]'];
    },
  },
  diary: {
    title: "Read the diary", why: "Every day of the run is written down: what happened while you looked away, who did what. J opens it.",
    done: (state, g, ui) => !!ui.diary,
    show: (state, ui) => { closeWindows(ui); return ['[data-action="dy-open"]']; },
  },
  // Hardcore: on the road with no base.
  team: {
    title: "Meet your team", why: "You are with these three on the road. Their panel holds their orders, people and supplies: what they carry is all you have.",
    done: (state, g, ui) => ui.expedition != null && state.parties.some((p) => p.id === ui.expedition && p.owner === "player"),
    show: (state, ui, act) => (openTeam(state, ui, act) ? ['[data-action="xp-move"]', "#right h2"] : []),
  },
  water: {
    title: "Find water", why: "Thirst kills in days. Rivers and lakes (Fetch water from the shore), shops, diners and churches. Boil it or use tablets: raw water can carry the worm.",
    done: (state, g) => state.bases.length > 0 || waterHeld(state) >= g.wLow + GUIDE.WATER_GAIN,
    show: (state, ui, act) => {
      const p = openTeam(state, ui, act);
      if (!p) return [];
      const w = waterSource(state, partyTile(p), 8);
      if (w) { act.center({ tile: w.tile }); }
      return ['[data-action="xp-order"][data-type="water"]', '[data-action="xp-move"]'];
    },
  },
  camp: {
    title: `Set up your camp (${ESTABLISH_LABEL})`, why: "Your hub starts as a camp, the barest base: pick a spot beside a river or lake, with sites around and few of the dead, and give the team the order there. Your people live there from the start.",
    done: (state) => state.bases.length > 0,
    show: (state, ui, act) => (openTeam(state, ui, act) ? ['[data-action="xp-order"][data-mission="establish"]', '[data-action="xp-move"]'] : []),
  },
  needs: {
    title: "Bring in what the camp needs", why: "Building the camp up into a shelter takes scrap and building materials (its Construction tab lists them). Send teams out from the camp to scavenge sites around it; what they bring home goes into its stores and the step up takes it as it comes in.",
    done: (state) => { const h = hub(state); if (!h) return false; const job = isCamp(h) ? tierUpJob(h) : null; return !isCamp(h) || (!!job && gatherRows(job).every((r) => r.have + (h.stock[r.key] || 0) >= r.need - 1e-9)); }, // taken by the step up or waiting in the stores
    show: (state, ui, act) => { const h = hub(state); if (h && isCamp(h)) { ui.baseView = { id: h.id, tab: "construction" }; return ['[data-action="tf-open"]', ".basebody"]; } return openTeam(state, ui, act) ? ['[data-action="xp-order"][data-mission="establish"]'] : []; },
  },
  found: {
    title: "Found your shelter", why: "With everything in, the camp's builders build it up (more hands and Mechanics go faster). Done, it becomes a shelter you can live at and build up.",
    done: (state) => state.bases.some((b) => b.type === "hub" && !isCamp(b)),
    show: (state, ui, act) => (openTeam(state, ui, act) ? ['[data-action="xp-order"][data-mission="establish"]'] : []),
  },
};
// The lists, in the order they are shown. Steps can be done in any order; the first one not done is "next".
export const GUIDE_LISTS = {
  base: ["stores", "work", "build", "scavenge", "clock", "night", "home", "diary"],
  road: ["team", "clock", "water", "camp", "needs", "found", "night", "diary"],
};
export const guideSteps = (g) => (GUIDE_LISTS[g && g.kind] || GUIDE_LISTS.base).map((id) => ({ id, ...STEPS[id] }));
export const guideStep = (id) => (STEPS[id] ? { id, ...STEPS[id] } : null);

// ---------- show-me helpers ----------
function closeWindows(ui) {
  ui.baseView = null; ui.baseMsg = ""; ui.supplyForm = null;
  ui.diary = null; ui.roster = null; ui.survivor = null;
}
// The hub's screen at a tab (false when there is no hub).
function openHub(state, ui, act, tab) {
  const h = hub(state) || state.bases[0];
  closeWindows(ui);
  if (!h) return false;
  act.openbase({ id: h.id, tab });
  return true;
}
// A team's panel (the road team, or the given one), centered, the right panel shown. Returns the team or null.
function openTeam(state, ui, act, p = null) {
  const team = p || roadTeam(state) || mine(state)[0];
  closeWindows(ui);
  if (!team) return null;
  act["xp-open"]({ id: team.id });
  act.center({ tile: partyTile(team) });
  act["panel-toggle"]({ p: "right", v: "0" });
  return team;
}
// The nearest site to the hub that a team could scavenge: its tile panel, with the Scavenge button to press.
function showSite(state, ui, act) {
  const h = hub(state) || state.bases[0];
  closeWindows(ui);
  ui.expedition = null;
  act["panel-toggle"]({ p: "right", v: "0" });
  const sels = ['[data-action="plan"][data-mission="scavenge"]', '[data-action="pl-launch"]'];
  if (!h) return sels;
  for (let r = 1; r <= GUIDE.SITE_REACH; r++) {
    const ring = state.grid.within(h.tile, r).filter((id) => state.grid.distance(h.tile, id) === r && state.tiles[id] && state.tiles[id].loc);
    const tile = ring.find((id) => tileActions(state, id).some(([m]) => m === "scavenge"));
    if (tile != null) { act.center({ tile }); return sels; }
  }
  return sels;
}

// ---------- starting, checking, ending ----------
// A new guide for this world (main.js begin, or the menu). Nothing is made when it is off.
export function startGuide(state, on = true, { keep = false } = {}) {
  if (!on) return null;
  state.guide = {
    kind: state.bases.length ? "base" : "road", on: true, keep: !!keep, fold: false, done: {},
    h0: state.hour, b0: buildingCount(state), sent: [], wLow: waterHeld(state), ended: null,
  };
  return state.guide;
}
export const guideOn = (state) => !!(state && state.guide && state.guide.on);
// The new-run screen's box: on for the first campaign on this machine (no saves yet and never started one).
export const guideDefault = (options) => !(options && options.guideSeen) && !listSaves().length;

// Called on every redraw (main.js refresh, before the alerts): notes teams leaving and the water low, ticks off what is
// done (with a toast), and switches the guide off when all is done or the first week is over. Returns the steps just done.
export function guideCheck(state, ui) {
  const g = state && state.guide;
  if (!g || !g.on || !ui.started || state.gameOver) return [];
  if (!g.done) g.done = {};
  if (!g.sent) g.sent = [];
  // Teams that set out from a base (any mission), remembered by who is on them.
  if (g.kind === "base") {
    for (const p of mine(state)) {
      if (p.homeBaseId == null || g.sent.some((x) => x.id === p.id)) continue;
      g.sent.push({ id: p.id, who: partyMembers(state, p).map((s) => s.id) });
      if (g.sent.length > GUIDE.SENT_MAX) g.sent.shift();
    }
  } else g.wLow = Math.min(g.wLow ?? Infinity, waterHeld(state));
  const steps = guideSteps(g);
  const fresh = [];
  for (const st of steps) {
    if (g.done[st.id] != null) continue;
    let ok = false;
    try { ok = !!st.done(state, g, ui); } catch { ok = false; } // a step that cannot tell stays open
    if (ok) { g.done[st.id] = state.hour; fresh.push(st); }
  }
  const n = steps.filter((st) => g.done[st.id] != null).length;
  if (fresh.length) {
    if (ui.guidePulse && fresh.some((st) => st.id === ui.guidePulse.step)) ui.guidePulse.until = 0;
    ui.flash = { text: `✔ First week: ${fresh.map((st) => st.title).join("; ")} (${n} of ${steps.length})`, at: now() };
  }
  if (n === steps.length) endGuide(state, ui, "done", "✔ First week: every step done. The guide steps aside; the menu brings it back.");
  else if (!g.keep && day(state) > GUIDE.DAYS) endGuide(state, ui, "days", "The first-week guide steps aside after day 7. The menu (Game tab) brings it back.");
  return fresh;
}
function endGuide(state, ui, why, text) {
  const g = state.guide;
  g.on = false;
  g.ended = why;
  if (ui.guidePulse) ui.guidePulse.until = 0;
  if (text) ui.flash = { text, at: now() };
}

// ---------- the card under the alerts ----------
export function renderGuide(state, ui) {
  const g = state && state.guide;
  if (!g || !g.on || !ui.started || state.gameOver || state.combat || ui.timelapse) return "";
  const steps = guideSteps(g);
  const open = steps.filter((st) => g.done[st.id] == null);
  const cur = open.find((st) => st.id === ui.guideSel) || open[0];
  const n = steps.length - open.length;
  const head = `<div class="gd-head"><span class="gd-title"${tip("The first-week guide: what a new holdout needs in its first days. Steps tick off by themselves as you do them, in any order. Show me opens the screen and pulses the button to press.")}>🧭 First week</span>
    <span class="gd-count"${tip(`${n} of ${steps.length} steps done · day ${day(state)} of ${GUIDE.DAYS}`)}>${n}/${steps.length}</span>
    <button class="gd-btn" data-action="help-open" data-sec="start-here"${tip("Help: Start here, the game in a few lines")}>?</button>
    <button class="gd-btn" data-action="gd-fold"${tip(g.fold ? "Show the steps" : "Fold the guide to one line")}>${g.fold ? "▸" : "▾"}</button>
    <button class="gd-btn" data-action="gd-close"${tip("Hide the guide (⚙ Menu → Game brings it back)")}>✕</button></div>`;
  if (g.fold) return `<div class="guide folded">${head}${cur ? `<div class="gd-next small">Next: ${esc(cur.title)}</div>` : ""}</div>`;
  const rows = steps.map((st) => {
    if (g.done[st.id] != null) return `<div class="gd-step done"${tip(st.why)}><span class="gd-mark">✔</span><span class="gd-name">${esc(st.title)}</span></div>`;
    const on = cur && st.id === cur.id;
    return `<div class="gd-step${on ? " cur" : ""}"><button class="gd-go" data-action="gd-pick" data-id="${st.id}"${tip(st.why)}><span class="gd-mark">${on ? "▶" : "○"}</span>${esc(st.title)}</button>` +
      `<button class="gd-show" data-action="gd-show" data-id="${st.id}"${tip("Open the screen for this step and point at the button to press")}>Show me</button></div>` +
      (on ? `<div class="gd-why">${esc(st.why)}</div>` : "");
  }).join("");
  return `<div class="guide">${head}${rows}</div>`;
}

// Pulses what "Show me" points at (main.js calls it after each redraw; the panels are HTML strings, so the class is
// put back on whatever was rebuilt). A new pulse restarts the animation on elements that kept the class.
export function guidePulse(ui, doc = typeof document !== "undefined" ? document : null) {
  if (!doc) return;
  const P = ui.guidePulse;
  const live = !!P && now() < P.until;
  const want = new Set();
  if (live) for (const s of P.sels) { try { for (const el of doc.querySelectorAll(s)) want.add(el); } catch { /* a bad selector pulses nothing */ } }
  for (const el of [...doc.querySelectorAll(".gd-pulse")]) if (!want.has(el) || (P && P.fresh)) el.classList.remove("gd-pulse");
  if (!live) { ui.guidePulse = null; return; }
  if (P.fresh) { P.fresh = false; void (doc.body && doc.body.offsetWidth); } // restart the animation
  for (const el of want) el.classList.add("gd-pulse");
}

// ---------- actions (main.js registers them: fn(state, ui, data, act)) ----------
export const GUIDE_ACTIONS = {
  "gd-show": (state, ui, d, act) => {
    const g = state.guide;
    const st = g && guideSteps(g).find((x) => x.id === d.id);
    if (!st) return;
    ui.guideSel = st.id;
    const sels = st.show(state, ui, act, g) || [];
    ui.guidePulse = { step: st.id, sels, until: now() + GUIDE.PULSE_MS, fresh: true };
  },
  "gd-pick": (state, ui, d) => { ui.guideSel = d.id; },
  "gd-fold": (state) => { if (state.guide) state.guide.fold = !state.guide.fold; },
  "gd-close": (state, ui) => { if (state.guide) endGuide(state, ui, "closed", "First-week guide hidden. ⚙ Menu → Game brings it back."); },
};

// The menu's Game tab (ui/settings.js): show the guide again (a fresh one for a save that never had it) or hide it.
export function guideMenuRow(state, ui) {
  if (!ui.started || state.gameOver) return "";
  const on = guideOn(state);
  return `<div class="setrow"><button data-action="gd-toggle"${tip(on ? "Hide the first-week checklist under the alerts" : "Show the first-week checklist under the alerts again: steps for a new holdout, with Show me buttons. Brought back by hand, it stays past day 7 until you hide it or finish it.")}>🧭 ${on ? "Hide" : "Show"} the first-week guide</button>
    <button class="mini" data-action="set-help" data-sec="start-here"${tip("Help: Start here")}>?</button></div>`;
}
export const GUIDE_MENU_ACTIONS = {
  "gd-toggle": (state, ui) => {
    const S = ui.settings;
    if (guideOn(state)) { endGuide(state, ui, "closed", ""); if (S) { S.msg = "The first-week guide is hidden."; S.err = false; } return; }
    const g = state.guide;
    const done = g ? guideSteps(g).every((st) => g.done[st.id] != null) : false;
    if (!g || done || (g.kind === "road" && state.bases.length)) startGuide(state, true, { keep: true }); // a fresh list (none yet, finished, or the road is over)
    else Object.assign(g, { on: true, keep: true, ended: null });
    if (S) { S.msg = "The first-week guide is back under the alerts."; S.err = false; }
  },
};
