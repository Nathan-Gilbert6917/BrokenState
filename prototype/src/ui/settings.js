// The settings view (⚙ in the top bar, the ⚙ Menu button in a battle, or Esc on the map with nothing else open):
// Game (resume, save, load, save and exit, new campaign, quit to desktop in the app, the save list, files),
// Options (autosave, confirmations, pause on focus loss, UI size, map detail, the battle's end-turn question, zombie look,
// the keys), Help (how the game works, one topic at a time: ui/help.js) and About. Saving and loading go through ui/saves.js (storage) and sim/save.js (the world). The autosave
// (autosaveCheck, called every frame by main.js) runs at dawn every N days, when a hive assault starts and when the
// run ends.
import {
  listSaves, latestSave, saveEntry, writeSave, readSave, deleteSave, exportSave, importSaveText, readSaveFile, newSlotId,
  defaultSaveName, AUTOSAVE, AUTOSAVE_DAYS, MAX_SLOTS, saveOptions, storageUsed, downloadText, canCompress,
} from "./saves.js";
import { saveBlocker, saveToString, SAVE_VERSION, GAME_VERSION, SaveError } from "../sim/save.js";
import { day, hub, alive } from "../sim/world.js";
import { WORLD_SIZES, worldSizeOf, sizeDef } from "../sim/worldsize.js";
import { cui, setConfirmEnd, setAutoRedeploy, setBattleView } from "./combat.js";
import { helpTab } from "./help.js";
import { setMapDetail } from "./terraindeco.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const pad2 = (n) => String(n).padStart(2, "0");
const kb = (chars) => `${Math.max(1, Math.round((chars * 2) / 1024))} KB`;
const MAX_SPEED = 3; // main.js: anything faster is a dev fast-forward

// The desktop app (desktop/main.js, Electron): window.close() closes the game's window and quits.
export const inDesktopApp = () => typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent || "");

// main.js hands over what the view needs from it (options, the desktop flag, the autosave's state; see run() below).
let API = null;
export function initSettings(api) {
  API = api;
  if (api && api.options) setMapDetail(api.options.mapDetail !== false); // ui/terraindeco.js: the State Map's terrain detail
}

// sec: the Help tab's topic (a ui/help.js topic id).
export const openSettings = (ui, tab = "game", sec = "") => {
  ui.settings = { tab, msg: "", err: false, confirm: null, name: "", busy: false, help: sec };
};

// Has the world moved on since it was last saved or loaded (the autosave counts)?
export function unsaved(state, ui) {
  if (!ui.started || !state) return false;
  const m = ui.savedMark;
  return !(m && m.state === state && m.hour === state.hour);
}
const markSaved = (state, ui, hour = state.hour) => { ui.savedMark = { state, hour }; };

function ago(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
const entryLine = (e) => `Day ${e.day ?? "?"}, ${pad2(e.hour ?? 0)}:00 · ${esc(e.hub || "?")} · ${e.survivors ?? "?"} alive · seed ${e.seed ?? "?"}${WORLD_SIZES[e.world] && e.world !== "normal" ? ` · ${WORLD_SIZES[e.world].label} map` : ""}${e.gameOver ? (e.victory ? " · won" : " · fallen") : ""}`;

// ---------- the view ----------
export function settingsModal(state, ui, api = API) {
  const S = ui.settings;
  const tabs = [["game", "Game"], ["options", "Options"], ["help", "Help"], ["about", "About"]];
  const head = `<div class="row settabs">${tabs.map(([k, l]) => `<button data-action="set-tab" data-tab="${k}" class="${S.tab === k ? "active" : ""}">${l}</button>`).join("")}
    <span style="margin-left:auto"></span><button class="primary" data-action="set-close"${tip("Back to the game (Esc)")}>${ui.started ? "Resume" : "Back"}</button></div>`;
  const msg = S.msg ? `<div class="setmsg ${S.err ? "danger" : "good"}">${esc(S.msg)}</div>` : "";
  const body = S.tab === "options" ? optionsTab(state, ui, api) : S.tab === "about" ? aboutTab(state, ui, api) : S.tab === "help" ? helpTab(S.help) : gameTab(state, ui, api);
  return `<div class="box wide settings"><h1>⚙ Menu</h1>${head}${msg}${confirmBox(S)}${body}</div>`;
}

function confirmBox(S) {
  const c = S.confirm;
  if (!c) return "";
  return `<div class="setconfirm"><span>${esc(c.text)}</span><button class="primary" data-action="set-yes">${esc(c.yes || "Yes")}</button><button data-action="set-no">Cancel</button></div>`;
}

function gameTab(state, ui, api) {
  const S = ui.settings;
  const saves = listSaves();
  const manual = saves.filter((e) => !e.auto).length;
  const blocker = ui.started ? saveBlocker(state) : "Start or load a game first.";
  const busy = !!S.busy;
  const dis = (on) => (on ? "" : " disabled");
  const cur = ui.slot ? saveEntry(ui.slot) : null;
  const curOk = cur && !cur.auto;
  let html = "";
  if (ui.started) {
    const savable = !blocker && !busy;
    const room = curOk || manual < MAX_SLOTS;
    html += `<div class="setrow">
      <button data-action="set-save"${dis(savable && room)}${tip(curOk ? `Save over “${cur.name}”, the save this game was last saved to or loaded from` : "Save to a new slot")}>💾 Save${curOk ? ` (${esc(cur.name)})` : ""}</button>
      <label class="setname"${tip("Name for a new save (empty: the hub's name and the day)")}><input type="text" maxlength="60" data-action="set-name" placeholder="${esc(defaultSaveName(state))}" value="${esc(S.name)}"></label>
      <button data-action="set-savenew"${dis(savable && manual < MAX_SLOTS)}${tip(`Save to a new slot (${manual} of ${MAX_SLOTS} used)`)}>Save as new</button>
      <button data-action="set-tofile"${dis(savable)}${tip("Save this game straight to a .bsave file (a backup, or to carry it to another browser or the desktop app)")}>Save to file…</button>
    </div>`;
    if (blocker) html += `<div class="small warn" style="margin:0.2rem 0 0.5rem">${esc(blocker)}</div>`;
    html += `<div class="setrow">
      <button data-action="set-saveexit"${dis(!busy && !state.gameOver)}${tip("Save (as above), then go back to the new-run screen, where Continue picks this game up again")}>Save and exit</button>
      <button data-action="set-exit"${dis(!busy)}${tip("Back to the new-run screen without saving")}>Exit without saving</button>
      <button data-action="set-new"${dis(!busy)}${tip("A new map and colonists (the new-run screen)")}>New campaign</button>
      ${api.desktop ? `<button data-action="set-quit"${dis(!busy)}${tip("Save (if the game can be saved now), then close the game")}>Save and quit to desktop</button><button data-action="set-quitnosave"${dis(!busy)}${tip("Close the game without saving")}>Quit</button>` : ""}
    </div>`;
  } else {
    const last = latestSave();
    html += `<div class="setrow">${last ? `<button class="primary" data-action="set-continue"${dis(!busy)}${tip(`Load the latest save: ${last.name}`)}>▶ Continue: ${esc(last.name)}</button>` : `<span class="muted small">No saves yet in this browser.</span>`}
      ${api.desktop ? `<button data-action="set-quitnosave"${dis(!busy)}>Quit</button>` : ""}</div>`;
  }
  const auto = api.autosaveInfo();
  html += `<h3>Saves <span class="small muted">(${manual} of ${MAX_SLOTS} slots, plus the autosave · ${kb(storageUsed() / 2)} in this browser${canCompress() ? ", compressed" : ""})</span></h3>`;
  if (auto.error) html += `<div class="small danger">The last autosave failed: ${esc(auto.error)}</div>`;
  html += saves.length ? `<div class="slots">${saves.map((e) => slotRow(state, ui, e, !!blocker || !ui.started, busy)).join("")}</div>` : `<div class="muted small">No saves yet. ${ui.started ? "Save above, or wait for the autosave at dawn." : ""}</div>`;
  html += `<div class="setrow" style="margin-top:0.6rem"><label class="btnlike${busy ? " disabled" : ""}"${tip("Load a .bsave file (it is also added to the list)")}>📂 Load from file…<input type="file" accept=".bsave,.json,application/json" data-action="set-import" class="hidden"${busy ? " disabled" : ""}></label>
    <span class="small muted">Saves are kept in this browser${api.desktop ? " (the desktop app keeps them in its own profile)" : ""}; Export makes a file you can keep or move.</span></div>`;
  return html;
}

function slotRow(state, ui, e, cannotSave, busy) {
  const cur = ui.slot === e.id;
  const thumb = e.thumb ? `<img class="sthumb" src="${esc(e.thumb)}" alt="">` : `<div class="sthumb none">${e.auto ? "auto" : "💾"}</div>`;
  const dis = (on) => (on ? "" : " disabled");
  return `<div class="slot${cur ? " cur" : ""}">${thumb}
    <div class="sinfo"><b>${esc(e.name)}</b>${e.auto ? ` <span class="tag">autosave${e.why ? `: ${esc(e.why)}` : ""}</span>` : ""}${cur ? ` <span class="tag">this game</span>` : ""}
      <div class="small muted">${entryLine(e)}</div>
      <div class="small muted">${esc(ago(e.ts))} · ${kb(e.size || 0)}${e.v && e.v !== SAVE_VERSION ? ` · save format ${e.v}` : ""}</div></div>
    <div class="sbtns">
      <button data-action="set-load" data-id="${esc(e.id)}"${dis(!busy)}${tip("Load this save (the game is paused after loading)")}>Load</button>
      ${e.auto ? "" : `<button data-action="set-save" data-id="${esc(e.id)}"${dis(!cannotSave && !busy)}${tip("Save the current game over this one")}>Save here</button>`}
      <button data-action="set-export" data-id="${esc(e.id)}"${dis(!busy)}${tip("Download this save as a .bsave file")}>Export</button>
      <button data-action="set-delete" data-id="${esc(e.id)}"${dis(!busy)}${tip("Delete this save")}>✕</button>
    </div></div>`;
}

const KEYS = [
  ["Esc", "Close the top window; with nothing open, this menu"], ["Space", "Pause / run"], ["1–4", "Speed 0.5× / 1× / 2× / 3×"],
  ["W A S D, arrows, drag, wheel", "Pan and zoom the map"], ["H", "Center on the hub"], ["I", "Infection overlay"],
  ["B / P / G / T", "Bases / People / Groups / Teams tab"], ["Tab or N", "Next team waiting for orders (Shift+Tab back)"],
  ["F1–F9", "Jump to your bases"], ["Ctrl+1–9 (Alt+1–9)", "Save a camera spot; Shift+1–9 goes back to it"],
  ["J", "Diary"], ["R", "Roster"],
  ["[ / ] / L", "Fold or show the left panel / right panel / log (or click the bar beside it; drag the bar to resize)"],
  ["Shift+[ / Shift+]", "Fold or show the running orders / the alerts"], ["\\ (backslash)", "Map only: fold every panel, again to bring them back"],
  ["Window edges, title", "Drag to resize or move a window; double-click the title for its usual size"], ["` (backquote)", "Dev tools"], ["Shift+P", "Autopilot (dev)"],
  ["Battle", "Click a unit, then a tile or an enemy; F shoot, E melee, O overwatch, H hunker, M meds, R retreat (from the strip), Shift+R sound the retreat (everyone; on a base's wall map: fall back to the yard), Enter ends the turn"],
  ["Battle view", "I isometric / top-down; in the isometric view: drag (or the arrow keys, or the mouse at the edge) to pan, the wheel or + / − to zoom, , and . to turn it, V to center on the selected unit, B roofs on / off"],
  ["Timelapse", "Space play, ← / → a day, 1–4 speed, Esc close"],
];

function optionsTab(state, ui, api) {
  const o = api.options;
  const box = (k, on, label, t) => `<button class="setopt ${on ? "active" : ""}" data-action="set-opt" data-k="${k}"${tip(t)}>${on ? "✔" : "✗"} ${label}</button>`;
  return `<h3>Saving</h3><div class="setrow">
      ${box("autosave", o.autosave, "Autosave", "Save to the autosave slot at dawn, when a hive assault starts and when the run ends. It waits while a card needs an answer.")}
      <label${tip("How often the dawn autosave runs")}>every <select data-action="set-autodays"${o.autosave ? "" : " disabled"}>${AUTOSAVE_DAYS.map((d) => `<option value="${d}" ${o.autosaveDays === d ? "selected" : ""}>${d === 1 ? "day" : `${d} days`}</option>`).join("")}</select></label>
      ${box("confirmQuit", o.confirmQuit, "Confirm before leaving a game", "Ask before loading, exiting or starting a new campaign with progress that is not saved (and, in a browser tab, before closing it)")}
    </div>
    <h3>Play</h3><div class="setrow">
      ${box("pauseOnBlur", o.pauseOnBlur, "Pause when the window loses focus", "Switching to another window or tab pauses the clock")}
      ${box("confirmEnd", !!cui.confirmEnd, "Battles: ask before ending a turn with actions left", "Space or End turn asks once while units still have actions (Enter always ends at once)")}
      ${box("autoRedeploy", !!cui.autoRedeploy, "Base battles: skip the redeploy after falling back", "When your people fall back from the walls to the yard and the buildings, keep the default posts and fight on at once instead of placing them again")}
    </div>
    <h3>Display</h3><div class="setrow">
      <label${tip("Interface size (also in the top bar)")}>UI size <select data-action="uiscale">${[0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2].map((v) => `<option value="${v}" ${ui.scale === v ? "selected" : ""}>${Math.round(v * 100)}%</option>`).join("")}</select></label>
      <label${tip("State Map terrain: Detailed scatters trees, fields, rocks, houses and wrecks over the ground and ripples the water when zoomed in; Flat keeps plain colors at every zoom")}>Map detail <select data-action="set-mapdetail">${[["detailed", "Detailed"], ["flat", "Flat"]].map(([v, l]) => `<option value="${v}" ${(o.mapDetail !== false) === (v === "detailed") ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label${tip("How battles are drawn: Isometric is the pseudo-3D view (walls, roofs cut away when your people are inside, heights; drag, the wheel and , . to pan, zoom and turn it); Top-down is the flat grid. I switches it in a battle.")}>Battle view <select data-action="set-battleview">${[["iso", "Isometric"], ["top", "Top-down"]].map(([v, l]) => `<option value="${v}" ${(cui.view === "top" ? "top" : "iso") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <button data-action="zlook-open"${tip("Palette, gore and variants of the dead in battle")}>Zombie look…</button>
    </div>
    <h3>Windows and panels</h3><div class="setrow">
      ${box("autoOpen", o.autoOpen !== false, "Auto-open panels on select", "A folded panel opens when you pick something it shows: a tile, site or team on the map (right panel), a tab key (left panel), a new urgent alert")}
      <button data-action="win-reset"${tip("Every window back to its usual size and place; the side panels and the log shown again at their usual width")}>Reset window sizes</button>
      <button class="mini" data-action="help-open" data-sec="windows-and-panels"${tip("Help: windows and panels")}>?</button>
    </div>
    <h3>Keys</h3><table class="setkeys">${KEYS.map(([k, d]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(d)}</td></tr>`).join("")}</table>`;
}

function aboutTab(state, ui, api) {
  const h = hub(state);
  return `<div class="text small" style="line-height:1.7">
    <b>Broken State</b> prototype ${esc(GAME_VERSION)} · save format ${SAVE_VERSION}${api.desktop ? " · desktop app" : " · browser"}<br>
    ${ui.started ? `This game: seed <b>${state.seed}</b>, ${sizeDef(worldSizeOf(state)).label} map (${state.grid.width}×${state.grid.height}), ${state.factions.length} other groups, day ${day(state)}, ${h ? esc(h.name) : ""}, ${alive(state).length} alive.` : `New run: seed <b>${state.seed}</b>.`}<br>
    A save holds the whole world: map, people, bases, teams and their plans, groups and their diplomacy, hordes and hives, battles under way, the diary and the timelapse recording. A card waiting for an answer cannot be saved: answer it first (the autosave waits for that too). Saves stay in this browser's storage${canCompress() ? " (compressed)" : ""}; use Export or Save to file for a backup.
  </div>`;
}

// ---------- actions (main.js registers them: fn(state, ui, data, api)) ----------
// api: { options, desktop, refresh(), track(promise), adopt(state, entry), newWorld(), thumb(), quit(), applyScale(v), autosaveInfo() }
function run(ui, api, label, fn) {
  const S = ui.settings;
  if (!S || S.busy) return;
  S.busy = label;
  S.msg = `${label}…`;
  S.err = false;
  S.confirm = null;
  const p = Promise.resolve().then(fn).then(
    (text) => { if (ui.settings === S) { S.msg = text || ""; S.err = false; } },
    (e) => {
      if (ui.settings === S) { S.msg = e && e.message ? e.message : String(e); S.err = true; }
      if (!(e instanceof SaveError)) console.error("Broken State: save / load failed:", e);
    },
  ).finally(() => { S.busy = false; api.refresh(); });
  api.track(p);
  return p;
}
// Asks first when the option is on and there is progress that is not saved.
function guarded(state, ui, api, confirm, go) {
  if (api.options.confirmQuit && unsaved(state, ui) && !state.gameOver) { ui.settings.confirm = { ...confirm, go }; return; }
  go();
}

async function saveTo(state, ui, api, id, name) {
  const entry = await writeSave(id, state, { name, thumb: api.thumb() });
  ui.slot = entry.id;
  markSaved(state, ui);
  return entry;
}
const targetSlot = (ui) => { const cur = ui.slot ? saveEntry(ui.slot) : null; return cur && !cur.auto ? cur.id : null; };

function loadSlot(ui, api, id) {
  return run(ui, api, "Loading", async () => {
    const entry = saveEntry(id);
    const st = await readSave(id);
    api.adopt(st, entry); // closes this view; the game is paused
    return "";
  });
}

export const SETTINGS_ACTIONS = {
  "set-open": (state, ui, d) => openSettings(ui, d.tab || "game"),
  "set-close": (state, ui) => { if (!ui.settings || !ui.settings.busy) ui.settings = null; },
  "set-tab": (state, ui, d) => { ui.settings.tab = d.tab; ui.settings.msg = ""; ui.settings.confirm = null; },
  // Help: a topic of the Help tab; help-open (the "?" buttons, the top bar's Help) opens the menu at a topic.
  "set-help": (state, ui, d) => { if (ui.settings) ui.settings.help = d.sec || ""; },
  "help-open": (state, ui, d) => {
    if (!ui.settings) { openSettings(ui, "help", d.sec || ""); return; }
    Object.assign(ui.settings, { tab: "help", help: d.sec || "", msg: "", confirm: null });
  },
  "set-no": (state, ui) => { ui.settings.confirm = null; },
  "set-yes": (state, ui) => { const c = ui.settings.confirm; ui.settings.confirm = null; if (c && c.go) c.go(); },
  // Save to the slot this game came from (or a new one); with data-id, over that slot (asks first).
  "set-save": (state, ui, d, api) => {
    const why = saveBlocker(state);
    if (why) { ui.settings.msg = why; ui.settings.err = true; return; }
    const id = d.id || targetSlot(ui);
    const go = () => run(ui, api, "Saving", async () => {
      const e = await saveTo(state, ui, api, id || newSlotId(), id ? undefined : ui.settings.name.trim() || undefined);
      ui.settings.name = "";
      return `Saved: ${e.name}.`;
    });
    if (d.id && d.id !== targetSlot(ui)) {
      const e = saveEntry(d.id);
      ui.settings.confirm = { text: `Save over “${e ? e.name : d.id}”?`, yes: "Save over it", go };
    } else go();
  },
  "set-savenew": (state, ui, d, api) => {
    const why = saveBlocker(state);
    if (why) { ui.settings.msg = why; ui.settings.err = true; return; }
    run(ui, api, "Saving", async () => {
      const e = await saveTo(state, ui, api, newSlotId(), ui.settings.name.trim() || undefined);
      ui.settings.name = "";
      return `Saved: ${e.name}.`;
    });
  },
  "set-tofile": (state, ui, d, api) => {
    const why = saveBlocker(state);
    if (why) { ui.settings.msg = why; ui.settings.err = true; return; }
    run(ui, api, "Writing the file", async () => {
      const name = (ui.settings.name.trim() || defaultSaveName(state)).replace(/[^\w\- ,]+/g, "").replace(/[\s,]+/g, "-");
      downloadText(`${name || "broken-state"}.bsave`, saveToString(state));
      return "The save file is on its way (your browser's downloads, or the save dialog in the desktop app).";
    });
  },
  "set-load": (state, ui, d, api) => {
    const e = saveEntry(d.id);
    if (!e) return;
    guarded(state, ui, api, { text: `Load “${e.name}”? Progress since your last save is lost.`, yes: "Load" }, () => loadSlot(ui, api, d.id));
  },
  "set-continue": (state, ui, d, api) => {
    const last = latestSave();
    if (!last) return;
    if (!ui.settings) openSettings(ui, "game");
    loadSlot(ui, api, last.id);
  },
  "set-delete": (state, ui, d) => {
    const e = saveEntry(d.id);
    if (!e) return;
    ui.settings.confirm = { text: `Delete “${e.name}”? This cannot be undone.`, yes: "Delete", go: () => {
      deleteSave(d.id);
      if (ui.slot === d.id) ui.slot = null;
      ui.settings.msg = `Deleted: ${e.name}.`;
      ui.settings.err = false;
    } };
  },
  "set-export": (state, ui, d, api) => {
    run(ui, api, "Exporting", async () => { const e = await exportSave(d.id); return `Exported ${e ? e.name : "the save"} as a file.`; });
  },
  "set-saveexit": (state, ui, d, api) => {
    const why = saveBlocker(state);
    if (why) {
      ui.settings.confirm = { text: `${why} Exit without saving instead?${listSaves().some((e) => e.auto) ? " (The last autosave is in the list.)" : ""}`, yes: "Exit without saving", go: () => api.newWorld() };
      return;
    }
    run(ui, api, "Saving", async () => {
      await saveTo(state, ui, api, targetSlot(ui) || newSlotId(), ui.settings.name.trim() || undefined);
      api.newWorld(); // the new-run screen, where Continue loads it again
      return "";
    });
  },
  "set-exit": (state, ui, d, api) => guarded(state, ui, api, { text: "Exit without saving? Progress since your last save is lost.", yes: "Exit" }, () => api.newWorld()),
  "set-new": (state, ui, d, api) => guarded(state, ui, api, { text: "Start a new campaign? Progress since your last save is lost.", yes: "New campaign" }, () => api.newWorld()),
  "set-quit": (state, ui, d, api) => {
    if (!ui.started || state.gameOver) { api.quit(); return; }
    const why = saveBlocker(state);
    if (why) { ui.settings.confirm = { text: `${why} Quit without saving?`, yes: "Quit", go: () => api.quit() }; return; }
    run(ui, api, "Saving", async () => { await saveTo(state, ui, api, targetSlot(ui) || newSlotId()); api.quit(); return "Saved."; });
  },
  "set-quitnosave": (state, ui, d, api) => guarded(state, ui, api, { text: "Quit without saving? Progress since your last save is lost.", yes: "Quit" }, () => api.quit()),
  "set-opt": (state, ui, d, api) => {
    if (d.k === "confirmEnd") { setConfirmEnd(!cui.confirmEnd); return; }
    if (d.k === "autoRedeploy") { setAutoRedeploy(!cui.autoRedeploy); return; }
    if (!(d.k in api.options) || typeof api.options[d.k] !== "boolean") return;
    api.options[d.k] = !api.options[d.k];
    saveOptions(api.options);
  },
};

export const SETTINGS_CHANGE = {
  "set-name": (state, ui, el) => { if (ui.settings) ui.settings.name = String(el.value ?? "").slice(0, 60); },
  "set-battleview": (state, ui, el) => setBattleView(el.value === "top" ? "top" : "iso"),
  "set-mapdetail": (state, ui, el, api) => {
    api.options.mapDetail = el.value !== "flat";
    setMapDetail(api.options.mapDetail);
    saveOptions(api.options);
  },
  "set-autodays": (state, ui, el, api) => {
    const n = Number(el.value);
    if (AUTOSAVE_DAYS.includes(n)) { api.options.autosaveDays = n; saveOptions(api.options); }
  },
  "set-import": (state, ui, el, api) => {
    const file = el.files && el.files[0];
    if (!file) return;
    if (!ui.settings) openSettings(ui, "game");
    run(ui, api, "Reading the file", async () => {
      const text = await readSaveFile(file);
      const e = await importSaveText(text, file.name ? `Imported: ${String(file.name).replace(/\.(bsave|json)$/i, "")}` : "");
      try { el.value = ""; } catch { /* ignore */ }
      return `Added “${e.name}” to the list (day ${e.day ?? "?"}). Press Load to play it.`;
    });
  },
};

// ---------- autosave ----------
// Dawn (06:00) every N days, when a hive assault starts (the battle is saved before the first shot), and when the
// run ends (that save drops any open card: nothing is left to answer). A card waiting for an answer holds the
// dawn autosave until it is answered. At dev fast-forward speeds it runs at most once a minute.
let auto = { state: null };
const dawnIndex = (st) => Math.floor((st.hour - 6) / 24);
export const autosaveState = () => auto;

export function autosaveCheck(state, ui, api, now) {
  if (!ui.started || ui.settings) return;
  if (auto.state !== state) {
    auto = { state, dawn: dawnIndex(state), lastDay: day(state), pending: null, busy: false, lastReal: -1e12, assault: state.combat || null, over: !!state.gameOver, error: "", lastAt: null };
    return;
  }
  const o = api.options;
  if (auto.busy || !o.autosave) return;
  if (state.gameOver) {
    if (!auto.over) { auto.over = true; doAutosave(state, ui, api, "the run ended", { dropCards: true }, now); }
    return;
  }
  auto.over = false;
  const b = state.combat;
  if (b && b.setup && b.setup.handler === "hiveAssault" && auto.assault !== b) {
    auto.assault = b;
    doAutosave(state, ui, api, "before the hive assault", {}, now);
    return;
  }
  const di = dawnIndex(state);
  if (di > auto.dawn) {
    auto.dawn = di;
    if (day(state) - auto.lastDay >= o.autosaveDays) auto.pending = "dawn";
  }
  if (!auto.pending || saveBlocker(state)) return;
  if (ui.speed > MAX_SPEED && now - auto.lastReal < 60000) return;
  doAutosave(state, ui, api, auto.pending, {}, now);
}

function doAutosave(state, ui, api, why, opts, now) {
  auto.busy = true;
  auto.pending = null;
  auto.lastReal = now;
  const d = day(state), h = hub(state), hour = state.hour; // the world keeps running while the save is compressed
  const p = writeSave(AUTOSAVE, state, { name: `Autosave: ${h ? h.name : "holdout"}, day ${d}`, why, thumb: api.thumb(), dropCards: !!opts.dropCards })
    .then(() => {
      auto.lastDay = d;
      auto.error = "";
      auto.lastAt = { day: d, why };
      if (!ui.slot) ui.slot = AUTOSAVE;
      markSaved(state, ui, hour);
    }, (e) => {
      auto.error = e && e.message ? e.message : String(e);
      if (!(e instanceof SaveError)) console.error("Broken State: autosave failed:", e);
    })
    .finally(() => { auto.busy = false; api.refresh(); });
  api.track(p);
}
