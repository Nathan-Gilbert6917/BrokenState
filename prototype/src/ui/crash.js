// The error screen: an exception nobody caught (in the frame loop, a sim tick, a click, a timer, a promise) stops
// the clock, writes the world to the crash save and says what happened, instead of a game that silently stalls or
// throws the same error sixty times a second.
// - Caught: main.js's frame loop hands its exceptions here (reportCrash); window "error" and "unhandledrejection"
//   catch the rest (clicks, keys, timers, saves). Not the browser's own noise (a ResizeObserver loop, an aborted or
//   refused media play).
// - On a crash: the clock stops (speed 0; main.js skips its frames while the screen is up), the world goes to the
//   crash slot (ui/saves.js CRASH_SAVE, one slot of its own: never a manual save, the autosaves or an Ironman game's
//   slot; in Ironman the copy sits beside the game's own slot, which keeps its last save, and goes once the game
//   saves itself again: ui/saves.js dropIronCrash). Open cards are left out of it, as in the game-over autosave.
// - The screen: what happened in plain words; Copy report (the error and its stack, day, seed, map, mode, the build,
//   the last 20 log lines); Try to keep playing (paused); Load the crash save; Back to title.
// - No loops: errors while the screen is up are only counted; a crash within REPEAT_MS of Try to keep playing shows
//   the screen again with a warning and keeps the first crash save (it is not written over by a world that is
//   breaking again).
// The screen is built here with its own DOM and listeners (not main.js's panels and data-action dispatcher, which
// may be what broke). Nothing runs at import time.
import { writeSave, readSave, saveEntry, CRASH_SAVE } from "./saves.js";
import { GAME_VERSION, SAVE_VERSION } from "../sim/save.js";
import { saveSummary } from "../sim/savesummary.js";
import { stateSizeDef } from "../sim/worldsize.js";

export const REPEAT_MS = 5000;  // a crash this soon after Try to keep playing is the same trouble again
const LOG_LINES = 20;

let API = null;     // { state(), ui, adopt(st, entry), toTitle(), desktop, track(p), refresh() } from main.js
let cur = null;     // the crash on screen: { error, where, at, again, more, saved, savedName, report, build }
let lastClosed = -Infinity;
let lastSaved = null; // the crash save's outcome, kept for a repeat crash
let build = null;   // build.json (the desktop build's stamp, or the dev server's git commit), fetched at the first crash

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const crashUp = () => !!(cur && cur.open);
export const crashState = () => cur; // tests

export function initCrash(api) {
  API = api;
  if (typeof window === "undefined") return;
  window.addEventListener("error", (ev) => {
    const err = ev.error || new Error(ev.message || "Unknown error");
    if (!ignorable(err)) reportCrash(err, "a click, key or timer");
  });
  window.addEventListener("unhandledrejection", (ev) => {
    if (!ignorable(ev.reason)) reportCrash(ev.reason, "a background task (a save, a load, a file)");
  });
  // The keys belong to the screen while it is up (Space must not start the clock under it).
  window.addEventListener("keydown", (ev) => { if (crashUp()) ev.stopImmediatePropagation(); }, true);
}

// The browser's own noise, not the game's errors.
function ignorable(err) {
  const msg = String((err && err.message) || err || "");
  if (/ResizeObserver loop/i.test(msg)) return true;
  if (err && (err.name === "AbortError" || err.name === "NotAllowedError")) return true; // a media play() refused or cut short
  return false;
}

// A crash: err (anything thrown), where (in words: "the game loop").
export function reportCrash(err, where = "the game loop") {
  const error = err instanceof Error ? err : new Error(typeof err === "string" ? err : (err && err.message) || JSON.stringify(err) || "Unknown error");
  try { console.error(`Broken State: crash in ${where}:`, error); } catch { /* ignore */ }
  if (!API) return;
  if (crashUp()) { cur.more++; draw(); return; }
  const now = Date.now();
  const again = now - lastClosed < REPEAT_MS;
  const ui = API.ui;
  let state = null;
  try { state = API.state(); } catch { /* ignore */ }
  if (ui.speed > 0) { if (ui.speed <= 3) ui.lastSpeed = ui.speed; ui.speed = 0; } // the clock stops
  cur = { open: true, error, where, at: now, again, againAfter: again ? now - lastClosed : 0, more: 0, saved: again && lastSaved ? lastSaved.saved : "pending", savedName: again && lastSaved ? lastSaved.name : "", info: gameInfo(state, ui), log: logLines(state), iron: !!(state && state.ironman), started: !!ui.started, msg: "" };
  draw();
  fetchBuild();
  if (!again) writeCrashSave(state, ui, cur);
  else if (!lastSaved) cur.saved = "none";
}

// The world to the crash slot (asynchronous: compressed). The outcome goes on the screen.
function writeCrashSave(state, ui, c) {
  if (!ui.started || !state) { c.saved = "none"; lastSaved = { saved: "none", name: "" }; draw(); return; }
  let name = "Crash";
  try { name = `Crash: ${saveSummary(state)}`; } catch { /* a broken world: the plain name */ }
  const p = Promise.resolve().then(() => writeSave(CRASH_SAVE, state, { name, why: "crash", dropCards: true })).then(
    (e) => { c.saved = "ok"; c.savedName = e.name; },
    (e) => { c.saved = `failed: ${e && e.message ? e.message : String(e)}`; },
  ).finally(() => { lastSaved = { saved: c.saved, name: c.savedName }; draw(); });
  try { API.track(p); } catch { /* ignore */ }
  return p;
}

function fetchBuild() {
  if (build || typeof fetch !== "function") return;
  build = { pending: true };
  const t = setTimeout(() => { if (build.pending) build = { none: true }; }, 2000);
  fetch("build.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { clearTimeout(t); build = j && j.commit ? j : { none: true }; draw(); }, () => { clearTimeout(t); build = { none: true }; });
}
const buildLine = () => (build && build.commit ? `commit ${build.commit}${build.date ? ` (${build.date})` : ""}${build.source ? ", running from source" : ""}` : build && build.pending ? "looking it up" : "no build stamp (running from source)");

// What the report says about the game.
function gameInfo(state, ui) {
  if (!state) return "no world";
  const out = [];
  try {
    const d = Math.floor(state.hour / 24) + 1, h = state.hour % 24;
    const size = stateSizeDef(state);
    out.push(`day ${d}, ${String(h).padStart(2, "0")}:00`, `seed ${state.seed}`, `${size.label} map (${state.grid.width}×${state.grid.height})`, `${state.mode === "hardcore" ? "Hardcore" : "Normal"} mode`);
    if (state.ironman) out.push("Ironman");
    if (state.autopilot) out.push("autopilot on");
    out.push(`speed ${ui.lastSpeed || 0}×`);
    if (state.combat) out.push(`in a battle (turn ${state.combat.turn ?? "?"})`);
    if (!ui.started) out.push("not started (title or new-run screen)");
    out.push(`summary: ${saveSummary(state)}`);
  } catch (e) { out.push(`(the world could not be read: ${e.message})`); }
  return out.join(" · ");
}
function logLines(state) {
  try {
    return (state.log || []).slice(0, LOG_LINES).reverse().map((l) => `Day ${Math.floor(l.hour / 24) + 1} ${String(l.hour % 24).padStart(2, "0")}:00  ${l.text}`);
  } catch { return []; }
}
const stamp = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
function savedText(c) {
  if (c.saved === "ok") return `written to the crash slot ("${c.savedName}")`;
  if (c.saved === "pending") return "being written";
  if (c.saved === "none") return "none (no game was running)";
  return c.saved;
}

// The report to copy (plain text).
export function crashReport(c = cur) {
  if (!c) return "";
  const e = c.error;
  const nav = typeof navigator !== "undefined" ? navigator.userAgent : "node";
  return [
    "Broken State crash report",
    `Time: ${stamp(c.at)} (local), ${new Date(c.at).toISOString()}`,
    `Error: ${e.name}: ${e.message}`,
    `Where: ${c.where}${c.again ? ` (again, ${Math.round(c.againAfter / 1000)} s after Try to keep playing)` : ""}`,
    `Game version ${GAME_VERSION}, save format ${SAVE_VERSION}, build: ${buildLine()}`,
    `Running in: ${API && API.desktop ? "the desktop app" : "a browser"} (${nav})`,
    `Game: ${c.info}`,
    `Crash save: ${savedText(c)}`,
    c.more ? `Errors after this one: ${c.more}` : "",
    "",
    "Stack:",
    String(e.stack || "(none)"),
    "",
    `Last ${c.log.length} log lines (oldest first):`,
    ...c.log,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

// ---------- the screen ----------
function draw() {
  if (typeof document === "undefined" || !cur) return;
  let el = document.getElementById("crash");
  if (!cur.open) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "crash";
    el.setAttribute("role", "alertdialog");
    el.addEventListener("click", onClick);
    document.body.appendChild(el);
  }
  const c = cur;
  const opened = !!el.querySelector("details[open]"); // the report stays open when the screen is drawn again
  const canLoad = c.saved === "ok" || (!!saveEntry(CRASH_SAVE) && c.saved !== "pending");
  const saveLine = c.saved === "ok" ? `The game as it was is in the <b>crash save</b> (“${esc(c.savedName)}”, also in ⚙ Menu → Saves).`
    : c.saved === "pending" ? "Writing the game to the crash save…"
    : c.saved === "none" ? "No game was running, so there is nothing to save."
    : `The crash save could not be written (${esc(c.saved.replace(/^failed: /, ""))}). Your other saves are as they were.`;
  el.innerHTML = `<div class="crashbox">
    <h1>Something broke</h1>
    <p>The game hit an error it did not expect (in ${esc(c.where)}). The clock is stopped, so nothing else happens while you choose.</p>
    <p class="crasherr">${esc(c.error.name)}: ${esc(c.error.message)}</p>
    <p>${saveLine}${c.iron ? " Ironman: your game's own save is untouched (its last save stands); the crash save sits beside it and is removed once the game saves itself again." : ""}</p>
    ${c.again ? `<p class="warn">It broke again ${Math.max(1, Math.round(c.againAfter / 1000))} s after you went back to it. Loading the crash save or going back to the title is safer.</p>` : ""}
    ${c.more ? `<p class="muted small">${c.more} more error${c.more === 1 ? "" : "s"} since (in the console).</p>` : ""}
    <p class="muted small">Copy report puts the details on the clipboard (the error, the day, seed and map, the last ${LOG_LINES} log lines) to paste wherever you note bugs.</p>
    ${c.msg ? `<p class="good">${esc(c.msg)}</p>` : ""}
    <div class="crashbtns">
      <button class="primary" data-c="copy">Copy report</button>
      <button data-c="keep">Try to keep playing</button>
      <button data-c="load"${canLoad ? "" : " disabled"}>Load the crash save</button>
      <button data-c="title">Back to title</button>
    </div>
    <details${opened ? " open" : ""}><summary class="small muted">The report</summary><textarea readonly rows="12">${esc(crashReport(c))}</textarea></details>
  </div>`;
}

function onClick(ev) {
  const b = ev.target && ev.target.closest && ev.target.closest("[data-c]");
  if (!b || b.disabled || !cur) return;
  ev.stopPropagation();
  crashChoose(b.dataset.c);
}
// A button of the screen: copy, keep (Try to keep playing), load (the crash save), title. Returns the load's promise.
export function crashChoose(k) {
  const c = cur;
  if (!c || !c.open) return null;
  if (k === "copy") copyReport(c);
  else if (k === "keep") { close(); API.ui.speed = 0; safe(() => API.refresh()); }
  else if (k === "load") {
    c.msg = "Loading the crash save…";
    draw();
    const p = readSave(CRASH_SAVE).then((st) => { close(); API.adopt(st, saveEntry(CRASH_SAVE)); safe(() => API.refresh()); }, (e) => { c.msg = ""; c.saved = `failed: the crash save would not load (${e && e.message ? e.message : e})`; draw(); });
    safe(() => API.track(p));
    return p;
  } else if (k === "title") {
    // A fresh world on the title screen; if even that fails, the page again (it opens on the title screen; the screen
    // stays up until then, so main.js's page-closing save leaves an Ironman slot alone).
    try { API.toTitle(); close(); API.refresh(); } catch { location.reload(); }
  }
  return null;
}
function close() { if (cur) { cur.open = false; lastClosed = Date.now(); draw(); } }
const safe = (fn) => { try { fn(); } catch (e) { reportCrash(e, "the screen after a crash"); } };

function copyReport(c) {
  const text = crashReport(c);
  const done = (ok) => { c.msg = ok ? "The report is on the clipboard." : "Copying was refused: open The report below and copy it from there."; draw(); };
  const fallback = () => {
    try {
      const ta = document.querySelector("#crash textarea");
      if (ta) { ta.closest("details").open = true; ta.focus(); ta.select(); }
      done(!!(ta && document.execCommand && document.execCommand("copy")));
    } catch { done(false); }
  };
  if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), fallback);
  else fallback();
}
