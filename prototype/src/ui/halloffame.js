// The hall of fame on screen and in storage (sim/halloffame.js builds the entries). The list lives outside any save,
// in browser storage under brokenstate.halloffame (localStorage, as the save list's index: ui/saves.js; the desktop
// app's page keeps it the same way), so it outlives new runs and deleted saves. Every storage access is in try/catch:
// with no storage, or one that throws, the game goes on and the list is empty. Nothing leaves the device but what
// Export downloads.
//
// hallRecord (main.js refresh): at an ending (the victory or game-over screen up) the run's entry is added once, by
// its key (campaign + ending), and the end screen says "Added to the Hall of fame" (hallEndHTML) with a button to it.
// The window (🏆 Hall of fame on the title screen, and from the end screens): the list newest first, filtered by
// ending and mode, and an entry's detail with Export (the entry as JSON) and Delete (asked first).
import { hallEntry, hallAdd, hallFilter, endingOf, hallKey, ENDINGS, HALL } from "../sim/halloffame.js";
import { ACH_BY_ID } from "../sim/achievements.js";
import { MODES } from "../sim/hardcore.js";
import { SKILL_NAMES } from "../sim/data.js";
import { downloadText } from "./saves.js";

export const HALL_KEY = "brokenstate.halloffame";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const storage = () => { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; } };

// ---------- storage ----------
/** The list, newest first ([] with no storage or a bad one). @param {any} [store] */
export function readHall(store = storage()) {
  try {
    const raw = store ? store.getItem(HALL_KEY) : null;
    const L = raw ? JSON.parse(raw) : [];
    return Array.isArray(L) ? L.filter((x) => x && typeof x === "object" && x.key) : [];
  } catch { return []; }
}
// Written whole; full storage: the older half dropped and tried once more. Returns true when it was written.
/** @param {any[]} list @param {any} [store] */
export function writeHall(list, store = storage()) {
  if (!store) return false;
  try { store.setItem(HALL_KEY, JSON.stringify(list)); return true; } catch { /* full or refused */ }
  try { store.setItem(HALL_KEY, JSON.stringify(list.slice(0, Math.ceil(list.length / 2)))); return true; } catch { return false; }
}
/** @param {string} key @param {any} [store] */
export function deleteHall(key, store = storage()) {
  const L = readHall(store);
  const out = L.filter((x) => x.key !== key);
  return out.length !== L.length && writeHall(out, store);
}
// At an ending: the run's entry, once per key. ui.hallNote: { key, added } for the end screen. Returns the entry
// added, or null.
/** @param {any} state @param {any} ui @param {any} [store] @param {number} [now] */
export function hallRecord(state, ui, store = storage(), now = Date.now()) {
  const ending = endingOf(state);
  if (!ending || !ui || !ui.started || state.preview) return null;
  const key = hallKey(state, ending);
  if (ui.hallNote && ui.hallNote.key === key) return null;
  try {
    const entry = hallEntry(state, ending, { date: now });
    const { list, added } = hallAdd(readHall(store), entry);
    const ok = added && writeHall(list, store);
    ui.hallNote = { key, added: !!ok, had: !added };
    return ok ? entry : null;
  } catch {
    ui.hallNote = { key, added: false };
    return null;
  }
}

// ---------- the end screens ----------
/** @param {any} ui */
export function hallEndHTML(ui) {
  const n = ui && ui.hallNote;
  if (!n) return "";
  const text = n.added ? "Added to the Hall of fame." : n.had ? "This ending is in the Hall of fame." : "The Hall of fame could not be written here.";
  return `<div class="small" style="margin:0.4rem 0">🏛 ${text} <button class="mini" data-action="hall-open" data-key="${esc(n.key)}"${tip("Your past runs: every ending, newest first")}>Hall of fame</button></div>`;
}

// ---------- the window ----------
export const HALL_ACTIONS = {
  "hall-open": (state, ui, d) => { ui.hall = { ending: "all", mode: "all", sel: d && d.key ? d.key : null, confirm: false, msg: "" }; },
  "hall-close": (state, ui) => { ui.hall = null; },
  "hall-filter": (state, ui, d) => { if (ui.hall && (d.f === "ending" || d.f === "mode")) { ui.hall[d.f] = d.v || "all"; ui.hall.sel = null; } },
  "hall-sel": (state, ui, d) => { if (ui.hall) { ui.hall.sel = d.key || null; ui.hall.confirm = false; ui.hall.msg = ""; } },
  "hall-back": (state, ui) => { if (ui.hall) { ui.hall.sel = null; ui.hall.confirm = false; } },
  "hall-export": (state, ui) => {
    const e = ui.hall && readHall().find((x) => x.key === ui.hall.sel);
    if (!e) return;
    try { downloadText(`brokenstate-hall-${String(e.campaign).replace(/[^\w-]+/g, "_")}-${e.ending.kind}.json`, JSON.stringify(e, null, 2)); ui.hall.msg = "Exported."; } catch (err) { ui.hall.msg = String((err && err.message) || err); }
  },
  "hall-del": (state, ui) => { if (ui.hall) ui.hall.confirm = true; },
  "hall-del-no": (state, ui) => { if (ui.hall) ui.hall.confirm = false; },
  "hall-del-yes": (state, ui) => { if (!ui.hall) return; deleteHall(ui.hall.sel); ui.hall.sel = null; ui.hall.confirm = false; ui.hall.msg = "Deleted."; },
};

const KIND_ICON = { hives: "🔥", alliance: "🏛", reunited: "🏔", defeat: "🪦" };
const modeName = (m) => (MODES[m] ? MODES[m].label : m || "?");
const when = (e) => (e.date ? String(e.date).slice(0, 10) : "");
/** @param {any} p */
const personLine = (p) => `<b>${esc(p.n)}</b>${p.bg ? ` <span class="muted">${esc(p.bg)}</span>` : ""}${p.sk ? ` · ${esc(SKILL_NAMES[p.sk[0]] || p.sk[0])} ${p.sk[1]}` : ""}${p.why ? ` · <span class="muted">${esc(p.why)}</span>` : ""} · ${p.fate === "alive" ? "alive" : `<span class="muted">${esc(p.fate)}</span>`}`;

/** @param {any} state @param {any} ui */
export function hallModal(state, ui) {
  const H = ui.hall || {};
  const all = readHall();
  const head = (title) => `<div class="spread"><h1>${title}</h1><button class="primary" data-action="hall-close"${tip("Close (Esc)")}>Close</button></div>`;
  const e = H.sel ? all.find((x) => x.key === H.sel) : null;
  if (e) return `<div class="box wide">${head(`🏛 ${esc(e.ending.label)} · day ${e.days}`)}${detail(e, H)}</div>`;
  const list = hallFilter(all, H);
  const modes = [...new Set(all.map((x) => x.mode))];
  const chip = (f, v, label) => `<button class="lgchip ${(H[f] || "all") === v ? "active" : ""}" data-action="hall-filter" data-f="${f}" data-v="${v}">${esc(label)}</button>`;
  const filters = `<div class="row">${chip("ending", "all", "Every ending")}${Object.entries(ENDINGS).map(([k, l]) => chip("ending", k, `${KIND_ICON[k]} ${l}`)).join("")}</div>` +
    (modes.length > 1 ? `<div class="row">${chip("mode", "all", "Every mode")}${modes.map((m) => chip("mode", m, modeName(m))).join("")}</div>` : "");
  const rows = list.map((x) => `<div class="card small" style="cursor:pointer" data-action="hall-sel" data-key="${esc(x.key)}">
      <div class="spread"><b>${KIND_ICON[x.ending.kind] || ""} ${esc(x.ending.label)} · day ${x.days}</b><span class="muted">${esc(when(x))}</span></div>
      <div class="muted">${esc(modeName(x.mode))} · ${esc(x.size)} · seed ${esc(x.seed)} · ${x.alive} alive of ${x.peak} at most · ${x.deaths} lost${x.ach ? ` · 🏆 ${x.ach.length}` : ""}${x.leader ? ` · led by ${esc(x.leader)}` : ""}</div></div>`).join("");
  return `<div class="box wide">${head("🏛 Hall of fame")}
    <div class="muted small">Every ending you reach is kept here, outside your saves (at most ${HALL.MAX}, the oldest dropped). ${all.length} so far.</div>
    ${H.msg ? `<div class="result small">${esc(H.msg)}</div>` : ""}
    ${all.length ? filters : ""}
    <div style="display:grid;gap:0.4rem;margin-top:0.5rem">${rows || `<div class="muted">${all.length ? "None with these filters." : "No endings yet. Win, or fall, and the run is written here."}</div>`}</div></div>`;
}
/** @param {any} e @param {any} H */
function detail(e, H) {
  const num = [["Days", e.days], ["People at the end", e.alive], ["At most", e.peak], ["Lost", e.deaths], ["Bases at the end", e.bases && e.bases.end], ["Bases at most", e.bases && e.bases.peak], ["Hives destroyed", e.hives], ["Groups in the coalition", e.coalition]].filter(([, v]) => v != null);
  const custom = e.custom ? Object.entries(e.custom).filter(([, v]) => typeof v === "number" || typeof v === "string").map(([k, v]) => `${k} ${v}`).join(", ") : "";
  const ach = (e.ach || []).map(([id, d]) => { const a = ACH_BY_ID[id]; return a ? `<span class="lgchip"${tip(`${a.desc} (day ${d})`)}>${a.icon} ${esc(a.name)}</span>` : ""; }).join("");
  return `
    <div class="muted">${esc(modeName(e.mode))}${e.ironman ? " · Ironman" : ""} · ${esc(e.size)} map · seed ${esc(e.seed)}${custom ? ` · Custom: ${esc(custom)}` : ""} · played ${esc(when(e))}</div>
    <div class="text">${esc(e.ending.label)} on day ${e.ending.day}, ${esc(e.ending.season)} of year ${e.ending.year}${e.ending.how ? `: ${esc(e.ending.how)}` : ""}.${e.leader ? ` ${esc(e.leader)} led them at the end.` : ""}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(10rem,1fr));gap:0.3rem;margin:0.5rem 0">${num.map(([k, v]) => `<div class="card small"><div class="muted">${k}</div><b>${v}</b></div>`).join("")}</div>
    ${e.founders && e.founders.length ? `<h3>The founders</h3>${e.founders.map((p) => `<div class="small">${personLine(p)}</div>`).join("")}` : ""}
    ${e.notable && e.notable.length ? `<h3>Notable survivors</h3>${e.notable.map((p) => `<div class="small">${personLine(p)}</div>`).join("")}` : ""}
    ${ach ? `<h3>Achievements</h3><div style="display:flex;flex-wrap:wrap;gap:0.3rem">${ach}</div>` : ""}
    ${H.msg ? `<div class="result small">${esc(H.msg)}</div>` : ""}
    <div class="row" style="margin-top:0.6rem"><button data-action="hall-back">◀ Back to the list</button>
      <button data-action="hall-export"${tip("Download this entry as a JSON file")}>Export</button>
      ${H.confirm ? `<span>Delete this entry for good?</span><button class="danger" data-action="hall-del-yes">Delete</button><button data-action="hall-del-no">Keep it</button>` : `<button data-action="hall-del"${tip("Remove this entry from the Hall of fame (asks first)")}>Delete</button>`}</div>`;
}
