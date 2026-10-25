// The run's achievements (sim/achievements.js) on screen: the 🏆 Achievements window from the top bar (beside the
// Ledger and the Diary), the list on the victory and game-over screens, and a toast when one is earned (ui.flash, as
// the first-week guide's). The window lists every row this run's mode can earn by group: earned ones with their day,
// the rest greyed, the hidden ones as "???" until earned.
import { ACH_BY_ID, achievementsOf, achievementsFor, hasAch } from "../sim/achievements.js";
import { day } from "../sim/world.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export const ACH_ACTIONS = {
  "ach-open": (state, ui) => { ui.achView = true; },
  "ach-close": (state, ui) => { ui.achView = null; },
};

/** The top bar's button. @param {any} state */
export function achButton(state) {
  const n = achievementsOf(state).length, of = achievementsFor(state).length;
  return `<button data-action="ach-open"${tip(`Achievements: what this run has done, ${n} of ${of} so far`)}>🏆 ${n}</button>`;
}

// One row: earned (with its day), or greyed; a hidden one unearned is "???".
/** @param {any} state @param {any} a */
function row(state, a) {
  const got = hasAch(state, a.id);
  const veil = a.hidden && !got;
  return `<div class="card small" style="display:flex;gap:0.6rem;align-items:center;${got ? "" : "opacity:0.45"}">
    <span style="font-size:1.6em;width:1.8em;text-align:center">${veil ? "❔" : a.icon}</span>
    <div style="flex:1"><b>${veil ? "???" : esc(a.name)}</b><div class="muted">${veil ? "A hidden achievement." : esc(a.desc)}</div></div>
    <span class="${got ? "" : "muted"}">${got ? `Day ${state.ach[a.id]}` : "—"}</span></div>`;
}

/** The window. @param {any} state @param {any} ui */
export function achievementsModal(state, ui) {
  const list = achievementsFor(state);
  const n = list.filter((a) => hasAch(state, a.id)).length;
  const groups = [...new Set(list.map((a) => a.group))];
  return `<div class="box wide">
    <div class="spread"><h1>🏆 Achievements</h1><span class="muted">${n} of ${list.length} · Day ${day(state)}</span><button class="primary" data-action="ach-close"${tip("Close (Esc)")}>Close</button></div>
    <div class="muted small">This run's own: each new run starts with none.</div>
    ${groups.map((g) => `<h3>${esc(g)}</h3><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr));gap:0.4rem">${list.filter((a) => a.group === g).map((a) => row(state, a)).join("")}</div>`).join("")}
  </div>`;
}

// The victory and game-over screens: what the run earned, in the order it came.
/** @param {any} state */
export function achievementsEndHTML(state) {
  const got = achievementsOf(state);
  const of = achievementsFor(state).length;
  if (!got.length) return `<div class="small muted" style="margin:0.5rem 0">🏆 No achievements this run (0 of ${of}).</div>`;
  return `<div class="small" style="margin:0.5rem 0"><b>🏆 Achievements: ${got.length} of ${of}</b><div style="display:flex;flex-wrap:wrap;gap:0.3rem;margin-top:0.3rem">${got.map((x) => {
    const a = ACH_BY_ID[x.id];
    return `<span class="lgchip"${tip(`${a.desc} (day ${x.day})`)}>${a.icon} ${esc(a.name)}</span>`;
  }).join("")}</div></div>`;
}

// On every redraw (main.js refresh): a toast for what was earned since the last look. The first look at a world (a
// new run, a save loaded) only notes what it has.
/** @param {any} state @param {any} ui */
export function achievementsFlash(state, ui) {
  if (!state || !ui.started) return;
  const ids = Object.keys(state.ach || {});
  if (ui.achSeen && ui.achSeen.state === state) {
    const fresh = ids.filter((id) => !ui.achSeen.ids.has(id) && ACH_BY_ID[id]);
    if (fresh.length) ui.flash = { text: `🏆 Achievement: ${fresh.map((id) => ACH_BY_ID[id].name).join("; ")}`, at: now() };
  }
  ui.achSeen = { state, ids: new Set(ids) };
}
