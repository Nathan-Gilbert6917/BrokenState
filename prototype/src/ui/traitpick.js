// The trait picker (2026-10-08, with the newer traits; tiers and points the same day): the new-run screen's Customize
// (ui/newgame.js) and a custom background (ui/backgrounds.js). Three compact rows, the good traits, the neutral ones and
// the bad ones (data.js traitKind); a trait that clashes with one already picked (data.js TRAIT_CLASH) or that would go
// over the cap is shown off, with why in its hover text. A picked trait with tiers has − and + beside it (traits.js
// TRAIT_TIERS), and with points on each chip says what it costs (or gives back) at that tier.
// Also the trait chip every screen shows (traitChip): green for a good trait, red for a bad one, grey for a neutral one
// (styles.css .t-good / .t-bad / .t-neutral; blue and orange with the colour-blind palette), "Tough II" with what it
// does at that tier in the hover text.
import { TRAITS, clashIn, traitKind } from "../sim/data.js";
import { traitTier, traitLabel, traitDesc, tierCount, traitPoints, cleanTier } from "../sim/traits.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const KIND_WORD = { good: "Good trait", bad: "Bad trait", neutral: "Neutral trait (a trade-off)" };
const ptsText = (p) => (p > 0 ? `${p} points` : p < 0 ? `gives ${-p} points back` : "free");

// The chip's colour class for a trait.
/** @param {string} t */
export const traitClass = (t) => `t-${traitKind(t)}`;
// A trait chip at a tier: "Tough II", coloured by kind, what it does in the hover text.
/** @param {string} t @param {number} [tier] @param {string} [more] text added to the hover text */
export function traitChipAt(t, tier = 1, more = "") {
  if (!TRAITS[t]) return `<span class="chip trait t-neutral">${esc(t)}</span>`;
  return `<span class="chip trait ${traitClass(t)}"${tip(`${traitLabel(t, tier)} (${KIND_WORD[traitKind(t)].toLowerCase()}): ${traitDesc(t, tier)}${more ? `. ${more}` : ""}`)}>${esc(traitLabel(t, tier))}</span>`;
}
// Someone's trait as a chip (their tier).
/** @param {any} s @param {string} t @param {string} [more] */
export const traitChip = (s, t, more = "") => traitChipAt(t, traitTier(s, t) || cleanTier(t, s && s.traitTier && s.traitTier[t]), more);
// All of someone's traits as chips.
/** @param {any} s */
export const traitChips = (s) => ((s && s.traits) || []).map((t) => traitChip(s, t)).join("");
// Someone's traits as words ("Tough II, Loud I"): tables, sorting, the find box.
/** @param {any} s */
export const traitWords = (s) => ((s && s.traits) || []).map((t) => (TRAITS[t] ? traitLabel(t, traitTier(s, t) || 1) : t)).join(", ");

// Why trait t cannot be added to `picked` now ("" when it can).
/** @param {string[]} picked @param {string} t @param {number} max @returns {string} */
export function traitBlock(picked, t, max) {
  if (picked.includes(t)) return "";
  const c = clashIn(picked, t);
  if (c) return `Not with ${TRAITS[c] ? TRAITS[c].name : c}`;
  if (picked.length >= max) return `At most ${max} traits`;
  return "";
}

// keys: the traits on offer; picked: the ones chosen; max: the cap; attrs: the button's data attributes (data-action
// and the rest, the trait's key is added as data-k). opts: { tiers: { t: tier } (the picked ones' tiers), tierAttrs:
// the − and + buttons' data attributes (data-d -1 / 1 added; none: no tier buttons), points: show what each costs }.
/** @param {string[]} keys @param {string[]} picked @param {number} max @param {string} attrs @param {{ tiers?: Record<string, number>, tierAttrs?: string, points?: boolean }} [opts] @returns {string} */
export function traitPickerHtml(keys, picked, max, attrs, opts = {}) {
  const tiers = opts.tiers || {};
  const chip = (t) => {
    const on = picked.includes(t);
    const tier = on ? cleanTier(t, tiers[t]) : 1;
    const why = traitBlock(picked, t, max);
    const hint = on ? "Click to remove" : why || "Click to add";
    const p = traitPoints(t, tier);
    const pts = opts.points ? ` <i class="tp-pts">${p > 0 ? `+${p}` : p < 0 ? `−${-p}` : "0"}</i>` : "";
    const n = tierCount(t);
    const tierTip = n > 1 ? ` Tiers: ${Array.from({ length: n }, (_, i) => `${traitLabel(t, i + 1)} ${opts.points ? `(${ptsText(traitPoints(t, i + 1))})` : ""}`.trim()).join(", ")}.` : "";
    const btn = `<button class="mini tp-chip ${traitClass(t)} ${on ? "active" : ""}" ${attrs} data-k="${t}" ${!on && why ? "disabled" : ""}${tip(`${traitLabel(t, tier)}: ${traitDesc(t, tier)}.${opts.points ? ` ${ptsText(p)[0].toUpperCase()}${ptsText(p).slice(1)}.` : ""}${tierTip} ${hint}`)}>${esc(on ? traitLabel(t, tier) : TRAITS[t].name)}${pts}</button>`;
    if (!on || n < 2 || !opts.tierAttrs) return btn;
    return `<span class="tp-sel">${btn}<button class="mini tp-tier" ${opts.tierAttrs} data-k="${t}" data-d="-1" ${tier <= 1 ? "disabled" : ""}${tip(`A tier lower: ${traitLabel(t, tier - 1)}`)}>−</button><button class="mini tp-tier" ${opts.tierAttrs} data-k="${t}" data-d="1" ${tier >= n ? "disabled" : ""}${tip(tier < n ? `A tier higher: ${traitLabel(t, tier + 1)}, ${traitDesc(t, tier + 1)}` : "The top tier")}>+</button></span>`;
  };
  const of = (kind) => keys.filter((t) => TRAITS[t] && traitKind(t) === kind);
  const row = (label, list) => (list.length ? `<div class="tp-row"><span class="tp-label small muted">${label}</span>${list.map(chip).join("")}</div>` : "");
  return `<div class="tp">${row("Good", of("good"))}${row("Neutral", of("neutral"))}${row("Bad", of("bad"))}</div>`;
}
