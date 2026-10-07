// Menu → Controls (ui/settings.js tab "controls"): every key in the key table (ui/keymap.js) by group, each one a
// button: click it and press the new key (Esc cancels), + adds another key, ✕ takes one off, Reset puts the action
// back to its default, Reset all every action. Two actions of one context on the same key are flagged (the first in
// the table wins until it is fixed). The bindings are a machine option (options.keys, saved with saveOptions).
// Help → Keys (ui/help.js) shows the same table as a printable key sheet (keysSheet; the print button prints only it).
import {
  KEYMAP, KEY_GROUPS, KEY_CTX, KEY_BY_ID, keysOf, isCustom, chordName, conflicts, capturing, startCapture, stopCapture, captureKey,
  removeBinding, resetBinding, resetAll,
} from "./keymap.js";
import { saveOptions } from "./saves.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const save = (api) => { if (api && api.options) saveOptions(api.options); };
const labelOf = (id) => (KEY_BY_ID.get(id) || { label: id }).label;

// The actions by group, in the table's order.
function grouped(filter = () => true) {
  const out = [];
  for (const g of KEY_GROUPS) {
    const list = KEYMAP.filter((k) => k.group === g && filter(k));
    if (list.length) out.push([g, list]);
  }
  const extra = KEYMAP.filter((k) => !KEY_GROUPS.includes(k.group) && filter(k)); // a group a later key brought
  for (const g of [...new Set(extra.map((k) => k.group))]) out.push([g, extra.filter((k) => k.group === g)]);
  return out;
}

// ---------- the Controls tab ----------
export function controlsTab(ui) {
  const cap = capturing();
  const clash = conflicts();
  const clashIds = new Set(clash.flatMap((c) => c.ids));
  const warn = clash.length ? `<div class="setmsg danger keyclash">⚠ ${clash.map((c) => `<b>${esc(chordName(c.chord))}</b> (${esc(KEY_CTX[c.ctx] || c.ctx)}) is ${c.ids.map((id) => esc(labelOf(id))).join(" and ")}`).join("; ")}. Only the first one answers until one of them gets another key.</div>` : "";
  const row = (k) => {
    const keys = keysOf(k.id);
    const chips = keys.map((c, i) => {
      if (k.fixed) return `<span class="keychip fixed"${tip("Fixed: this key cannot be changed")}>${esc(chordName(c))}</span>`;
      const on = cap && cap.id === k.id && cap.i === i;
      return `<span class="keyslot"><button class="keychip${on ? " capture" : ""}" data-action="key-capture" data-id="${k.id}" data-i="${i}"${tip("Click, then press the new key (Esc cancels)")}>${on ? "press a key…" : esc(chordName(c))}</button><button class="mini keyx" data-action="key-remove" data-id="${k.id}" data-i="${i}"${tip("Take this key off")}>✕</button></span>`;
    }).join("");
    const adding = cap && cap.id === k.id && cap.i == null;
    const add = k.fixed ? "" : `<button class="keychip add${adding ? " capture" : ""}" data-action="key-capture" data-id="${k.id}"${tip("Add another key for this")}>${adding ? "press a key…" : "+"}</button>`;
    const reset = isCustom(k.id) ? `<button class="mini" data-action="key-reset" data-id="${k.id}"${tip("Back to the default key")}>Reset</button>` : "";
    return `<tr class="${clashIds.has(k.id) ? "clash" : ""}"><td>${esc(k.label)}</td><td class="keychips">${chips || `<span class="muted small">no key</span>`}${add}</td><td>${reset}</td></tr>`;
  };
  const changed = KEYMAP.some((k) => isCustom(k.id));
  return `<div class="setrow"><span class="small">Click a key and press the new one (Esc cancels); <b>+</b> adds another key, ✕ takes one off. A key works only where its group does (the map, a battle, the timelapse…), and two things on the same key there are flagged.</span>
      <span style="margin-left:auto"></span><button data-action="key-resetall"${changed ? "" : " disabled"}${tip("Every key back to its default")}>Reset all</button>
      <button data-action="help-open" data-sec="keys"${tip("The printable key sheet (Help → Keys)")}>Key sheet…</button></div>
    ${warn}
    <div class="keygroups">${grouped().map(([g, list]) => `<div class="keygroup"><h3>${esc(g)}</h3><table class="setkeys keytable">${list.map(row).join("")}</table></div>`).join("")}</div>`;
}

// main.js keydown, first: while the Controls tab waits for a key, that key is the new binding. Returns true when the
// key was used. Anywhere else a capture left over is dropped.
export function controlsKey(ui, e, api) {
  if (!capturing()) return false;
  if (!ui.settings || ui.settings.tab !== "controls") { stopCapture(); return false; }
  const r = captureKey(e);
  if (!r || r.wait) return true;
  const S = ui.settings;
  if (!r.done) { S.msg = ""; return true; }
  save(api);
  S.err = r.clash.length > 0;
  S.msg = r.clash.length
    ? `${chordName(r.chord)} is now ${labelOf(r.id)}, and also ${r.clash.map(labelOf).join(" and ")}: give one of them another key.`
    : `${chordName(r.chord)}: ${labelOf(r.id)}.`;
  return true;
}

// ---------- the key sheet (Help → Keys) ----------
export function keysSheet() {
  const groups = grouped((k) => keysOf(k.id).length > 0);
  return `<div class="keysheet"><div class="spread noprint"><span class="small">Every key as it is set now (Menu → Controls changes them).</span>
      <span class="row"><button data-action="set-tab" data-tab="controls"${tip("Change the keys")}>Controls…</button><button class="primary" data-action="key-print"${tip("Print this sheet (only the sheet is printed)")}>🖨 Print</button></span></div>
    <h2 class="printonly">Broken State: keys</h2>
    <div class="keysheetcols">${groups.map(([g, list]) => `<div class="keygroup"><h3>${esc(g)}</h3><table class="helptable keytable">${list.map((k) => `<tr><td class="keycell">${keysOf(k.id).map((c) => `<kbd>${esc(chordName(c))}</kbd>`).join(" ")}</td><td>${esc(k.label)}</td></tr>`).join("")}</table></div>`).join("")}</div></div>`;
}

// Prints the key sheet alone: a copy of it at the top of the page, everything else hidden (styles.css @media print).
function printSheet() {
  if (typeof document === "undefined") return;
  const src = document.querySelector(".keysheet");
  if (!src) return;
  const old = document.getElementById("printsheet");
  if (old) old.remove();
  const copy = document.createElement("div");
  copy.id = "printsheet";
  copy.innerHTML = src.outerHTML;
  document.body.appendChild(copy);
  document.body.classList.add("printkeys");
  const done = () => { document.body.classList.remove("printkeys"); copy.remove(); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  try { window.print(); } catch { done(); }
}

// main.js registers them: fn(state, ui, data, api).
export const CONTROLS_ACTIONS = {
  "key-capture": (state, ui, d) => { startCapture(d.id, d.i); if (ui.settings) ui.settings.msg = ""; },
  "key-remove": (state, ui, d, api) => { stopCapture(); removeBinding(d.id, Number(d.i)); save(api); if (ui.settings) ui.settings.msg = ""; },
  "key-reset": (state, ui, d, api) => { stopCapture(); resetBinding(d.id); save(api); if (ui.settings) { ui.settings.msg = `${labelOf(d.id)}: back to its default key.`; ui.settings.err = false; } },
  "key-resetall": (state, ui, d, api) => { stopCapture(); resetAll(); save(api); if (ui.settings) { ui.settings.msg = "Every key is back to its default."; ui.settings.err = false; } },
  "key-print": () => printSheet(),
};
