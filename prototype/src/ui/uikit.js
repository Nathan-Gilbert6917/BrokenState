// Small shared pieces for game-like panels (the base window first; any window may use them): costs and
// requirements as chips (icon, name, have/need: green when met, red when short), stat rows (label left, value right),
// status badges, labelled progress bars and section heads. HTML strings only, no DOM: the headless tools render them.
// The styles live in styles.css under "uikit" and use the palette's variables (--good, --danger, --accent, --info…),
// so the colour-blind set (:root.cb) carries over.
import { SUPPLIES } from "../sim/data.js";
import { stockHas } from "../sim/water.js";
import { supplyIcon } from "./stackmove.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);

// A supply's display name and icon ("Scrap", 🔩); keys that are not supplies keep their key.
export const supName = (k) => (SUPPLIES[k] ? SUPPLIES[k].name : k === "ammo" ? "Rounds" : String(k));
export const supIcon = (k) => supplyIcon(k);

// One requirement chip. have: what there is (omit for a plain cost); need: what it takes; ok: met (by default
// have >= need). icon/name free text, so it serves skills, buildings and items too.
export function chip({ icon = "", name, have, need, ok, t, tone } = {}) {
  const hasQty = need != null;
  const met = ok ?? (have == null ? null : have >= (need || 0));
  const cls = tone || (met == null ? "" : met ? "ok" : "short");
  const qty = !hasQty ? "" : have == null ? `${need}` : `${n0(have)}/${need}`;
  return `<span class="ck ${cls}"${tip(t)}>${icon ? `<i class="ck-ico">${icon}</i>` : ""}<span class="ck-n">${esc(name)}</span>${qty ? ` <b class="ck-q">${qty}</b>` : ""}</span>`;
}

// A cost as chips: { scrap: 20, parts: 4 } against a stock (b.stock) when given; have(k) overrides what counts.
// opts.word(k): the name to show; opts.tips(k, have, need): a chip's tooltip.
export function costChips(cost, stock, opts = {}) {
  const list = Object.entries(cost || {}).filter(([, v]) => v > 0);
  if (!list.length) return "";
  return `<span class="ck-list">${list.map(([k, need]) => {
    const have = opts.have ? opts.have(k) : stock ? stockHas(stock, k) : null;
    return chip({ icon: supIcon(k), name: opts.word ? opts.word(k) : supName(k), have, need, t: opts.tips ? opts.tips(k, have, need) : `${supName(k)}: ${need} needed${have != null ? `, ${n0(have)} in the stores` : ""}` });
  }).join("")}</span>`;
}

// A row of chips (already built) in one wrapping list.
export const chipList = (chips) => (chips.filter(Boolean).length ? `<span class="ck-list">${chips.filter(Boolean).join("")}</span>` : "");

// Stat rows: [label, value, tooltip?, valueClass?] → label left, value right. Falsy rows are skipped.
export function statRows(rows) {
  return `<div class="sk-rows">${rows.filter(Boolean).map(([l, v, t, cls]) => `<div class="sk-row"${tip(t)}><span class="sk-l">${l}</span><span class="sk-v${cls ? ` ${cls}` : ""}">${v}</span></div>`).join("")}</div>`;
}

// A status badge. tone: good | warn | bad | info | busy | muted.
export const badge = (text, tone = "muted", t = "") => `<span class="bdg bdg-${tone}"${tip(t)}>${text}</span>`;

// A labelled progress bar: pct 0–100, tone good | warn | bad | info | accent; label on the left of the bar, right
// text on its right (both optional). cap: a lighter part up to cap% (what the materials delivered allow).
export function pbar(pct, tone = "accent", label = "", right = "", cap = null, t = "") {
  const w = Math.max(0, Math.min(100, pct || 0));
  return `<div class="kbar kb-${tone}"${tip(t)}>${cap != null ? `<i class="kb-cap" style="width:${Math.max(0, Math.min(100, cap))}%"></i>` : ""}<i class="kb-fill" style="width:${w}%"></i>${label || right ? `<span class="kb-txt"><span>${label}</span><span>${right}</span></span>` : ""}</div>`;
}

// A section head: the title, an optional count bubble and anything on the right (buttons).
export const sectionHead = (title, right = "", count = null, t = "") =>
  `<div class="sk-head"><h3${tip(t)}>${title}${count != null ? ` <span class="sk-count">${count}</span>` : ""}</h3>${right ? `<span class="row">${right}</span>` : ""}</div>`;

// A small ⓘ that carries a longer explanation in its tooltip, in place of a paragraph.
export const infoTip = (text) => (text ? ` <span class="sk-info"${tip(text)}>ⓘ</span>` : "");

// A short hint line (one line, the rest in its tooltip).
export const hint = (text, t = "", cls = "") => `<div class="sk-hint${cls ? ` ${cls}` : ""}"${tip(t)}>${text}</div>`;

// The first sentence of a description (for a one-line summary; the whole text goes in the tooltip).
export function firstSentence(s) {
  const m = String(s || "").match(/^.*?[.!?](?=\s|$)/);
  return m ? m[0] : String(s || "");
}

// A stock tile: icon, amount, name (a grid of them reads like an inventory). dim: nothing in stock.
export const stockTile = (k, qty, t = "") =>
  `<div class="sk-tile${qty < 1 ? " dim" : ""}"${tip(t || supName(k))}><i>${supIcon(k)}</i><b>${n0(qty)}</b><span>${esc(supName(k))}</span></div>`;
