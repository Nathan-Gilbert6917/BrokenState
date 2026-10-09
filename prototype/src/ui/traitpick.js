// The trait picker (2026-10-08, with the newer traits): the new-run screen's Customize (ui/newgame.js) and a custom
// background (ui/backgrounds.js). Two compact rows, the good traits and the bad ones (data.js TRAITS bad); a trait that
// clashes with one already picked (data.js TRAIT_CLASH) or that would go over the cap is shown off, with why in its
// hover text.
import { TRAITS, clashIn } from "../sim/data.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");

// Why trait t cannot be added to `picked` now ("" when it can).
/** @param {string[]} picked @param {string} t @param {number} max @returns {string} */
export function traitBlock(picked, t, max) {
  if (picked.includes(t)) return "";
  const c = clashIn(picked, t);
  if (c) return `Not with ${TRAITS[c] ? TRAITS[c].name : c}`;
  if (picked.length >= max) return `At most ${max} traits`;
  return "";
}

// keys: the traits on offer; picked: the ones chosen; max: the cap; attrs: the button's data attributes
// (data-action and the rest, the trait's key is added as data-k).
/** @param {string[]} keys @param {string[]} picked @param {number} max @param {string} attrs @returns {string} */
export function traitPickerHtml(keys, picked, max, attrs) {
  const chip = (t) => {
    const on = picked.includes(t);
    const why = traitBlock(picked, t, max);
    const hint = on ? "Click to remove" : why || "Click to add";
    return `<button class="mini tp-chip ${on ? "active" : ""} ${TRAITS[t].bad ? "tp-bad" : ""}" ${attrs} data-k="${t}" ${!on && why ? "disabled" : ""}${tip(`${TRAITS[t].desc}. ${hint}`)}>${esc(TRAITS[t].name)}</button>`;
  };
  const good = keys.filter((t) => TRAITS[t] && !TRAITS[t].bad), bad = keys.filter((t) => TRAITS[t] && TRAITS[t].bad);
  const row = (label, list) => (list.length ? `<div class="tp-row"><span class="tp-label small muted">${label}</span>${list.map(chip).join("")}</div>` : "");
  return `<div class="tp">${row("Good", good)}${row("Bad", bad)}</div>`;
}
