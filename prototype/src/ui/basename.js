// The naming popup (sim/basenames.js): a base you just founded asks for its name, the suggestion filled in; the same
// window renames any base later (the ✎ Rename buttons: the base screen, the Bases tab, the tile panel).
//   nameModalUp(state, ui)   is the popup showing (it holds the clock, main.js blocked)
//   nameBaseModal(state, ui) its HTML
//   renameButton(base)       the small ✎ button that opens it for a base
//   BN_ACTIONS / BN_INPUT    click and typing handlers (main.js); bnKey: Enter names it, Esc keeps the name it has
import { pendingName, nameDone, renameBase, nameSuggestions, nameProblem, cleanName, NAME_MAX } from "../sim/basenames.js";
import { tileLabel } from "../sim/parties.js";
import { tierName } from "../sim/buildings.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");

// The base the window is about: one you asked to rename, else the first founded one waiting for a name.
function target(state, ui) {
  if (ui.nameBase != null) {
    const b = state.bases.find((x) => x.id === ui.nameBase);
    if (b) return { base: b, fresh: false };
    ui.nameBase = null;
  }
  if (state.autopilot || state.combat || state.gameOver || !ui.started) return null;
  const b = pendingName(state);
  return b ? { base: b, fresh: true } : null;
}
export const nameModalUp = (state, ui) => !!target(state, ui);

// The draft follows the base the window is on (a new base starts from its suggested name).
function draft(ui, base) {
  if (ui.nameFor !== base.id) { ui.nameFor = base.id; ui.nameDraft = base.name; ui.nameMsg = ""; }
  return ui.nameDraft ?? base.name;
}

export function nameBaseModal(state, ui) {
  const t = target(state, ui);
  if (!t) return "";
  const { base, fresh } = t;
  const value = draft(ui, base);
  const kind = tierName(base).toLowerCase();
  const where = tileLabel(state, base.tile);
  const ideas = nameSuggestions(state, base);
  const why = ui.nameMsg || nameProblem(state, base, cleanName(value));
  const chips = ideas.map((n) => `<button class="mini${n === cleanName(value) ? " active" : ""}" data-action="bn-pick" data-name="${esc(n)}"${tip(`Call it ${n}`)}>${esc(n)}</button>`).join("");
  return `<div class="box namebox">
    <h1>${fresh ? `Name your new ${esc(kind)}` : `Rename ${esc(base.name)}`}</h1>
    <div class="text small">${fresh ? `Your people have a new ${esc(kind)} at ${esc(where)}. What do they call it? The name shows on the map, in the log and in your diary.` : `Your ${esc(kind)} at ${esc(where)}. A new name shows on the map, in the log and in your diary from now on.`}</div>
    <input class="nameinput" type="text" data-action="bn-input" data-keep="basename" maxlength="${NAME_MAX}" value="${esc(value)}" autofocus spellcheck="false"${tip("Type a name (Enter to confirm)")}>
    <div class="small ${why ? "danger" : "muted"}" style="min-height:1.2em;margin-top:0.25rem">${esc(why || `${NAME_MAX} letters at most.`)}</div>
    ${chips ? `<div class="small muted" style="margin-top:0.4rem">Ideas:</div><div class="row namechips">${chips}</div>` : ""}
    <div class="row" style="margin-top:0.9rem;justify-content:flex-end">
      <button data-action="bn-cancel"${tip(fresh ? `Keep the name ${base.name} (you can rename it any time: ✎ on its screen)` : "Keep the name it has")}>${fresh ? `Keep “${esc(base.name)}”` : "Cancel"}</button>
      <button class="primary" data-action="bn-ok" ${why ? "disabled" : ""}>${fresh ? "Name it" : "Rename"}</button>
    </div>
  </div>`;
}

// The ✎ button that opens the window for a base.
export const renameButton = (base, label = "✎") => `<button class="mini" data-action="bn-open" data-base="${base.id}"${tip(`Rename ${base.name}`)}>${label}</button>`;

function close(state, ui, base) {
  if (base) nameDone(state, base.id);
  ui.nameBase = null; ui.nameFor = null; ui.nameDraft = null; ui.nameMsg = "";
}
function confirm(state, ui) {
  const t = target(state, ui);
  if (!t) return;
  const why = renameBase(state, t.base, ui.nameDraft ?? t.base.name);
  if (why) { ui.nameMsg = why; return; }
  close(state, ui, t.base);
}
export const BN_ACTIONS = {
  "bn-open": (state, ui, d) => { ui.nameBase = Number(d.base); ui.nameFor = null; },
  "bn-pick": (state, ui, d) => { ui.nameDraft = d.name; ui.nameMsg = ""; },
  "bn-ok": (state, ui) => confirm(state, ui),
  "bn-cancel": (state, ui) => { const t = target(state, ui); close(state, ui, t && t.base); },
};
export const BN_INPUT = {
  "bn-input": (state, ui, el) => { ui.nameDraft = String(el.value ?? ""); ui.nameMsg = ""; },
};
// Enter names it (from the text box too), Esc keeps the name it has. True when the key was used.
export function bnKey(state, ui, e) {
  if (!nameModalUp(state, ui)) return false;
  if (e.code === "Enter" || e.code === "NumpadEnter") {
    const el = e.target;
    if (el && el.dataset && el.dataset.action === "bn-input") ui.nameDraft = String(el.value ?? "");
    confirm(state, ui);
    return true;
  }
  if (e.code === "Escape") { BN_ACTIONS["bn-cancel"](state, ui); return true; }
  return false;
}
