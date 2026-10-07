// "Why?" (suggestions-4 #4): the link on a death or a lost base (the log, the diary, the memorial wall, the survivor
// screen of the dead, the lost-base card) and the small panel with its chain of causes (sim/causes.js). Names, places
// and "day N" in the chain are links: a day opens the diary there, a name or place works like the diary's links.
import { deathCause, lossesOf } from "../sim/causes.js";
import { findRefs, decodeRefs } from "../sim/diary.js";
import { day } from "../sim/world.js";
import { openDiary } from "./diary.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const memorial = (state) => state.memorial || [];
// The lines that say a base is gone (world.js removeBase, conquest.js occupyPlayerBase / razePlayerBase).
const LOSS_RX = /has been lost|was overrun by the dead|\btook\b|moved into|to the ground/;

// What a log or diary line is about: { s: survivor id } for "<name> died …", { b, d } for a lost base, or null.
export function lineWhy(state, text, kind, refs, dayNo) {
  if (kind !== "death" || !text) return null;
  const m = /^(.+?) died\b/.exec(text);
  if (m) {
    const list = typeof refs === "string" ? decodeRefs(refs) : refs || [];
    const r = list.find((x) => x.type === "s" && x.start === 0);
    const e = memorial(state).find((x) => x.died === dayNo && (r ? x.id === r.id : x.name === m[1]));
    return e ? { s: e.id } : null;
  }
  const L = lossesOf(state).find((x) => x.day === dayNo && text.includes(x.name) && LOSS_RX.test(text));
  return L ? { b: L.id, d: L.day } : null;
}
const linkFor = (w, label = "Why?") => (w.s != null
  ? `<a class="lk why-lk" data-action="why" data-s="${w.s}"${tip("Why did this happen? The causes that led to it")}>${label}</a>`
  : `<a class="lk why-lk" data-action="why" data-b="${w.b}" data-d="${w.d}"${tip("Why was this base lost? The causes that led to it")}>${label}</a>`);
// The "Why?" link after a death or lost-base line ("" for any other line).
export function whyLink(state, text, kind, refs, dayNo) {
  const w = lineWhy(state, text, kind, refs, dayNo);
  return w ? ` ${linkFor(w)}` : "";
}
// The memorial wall and the survivor screen of the dead: m = a memorial entry (relations.js onDeath).
export const whyButton = (m) => (m && m.id != null ? linkFor({ s: m.id }) : "");
// The lost-base card ("<base> has fallen", "<base> burned"): card.lostBase = its tile.
export function cardWhy(state, card) {
  if (!card || card.lostBase == null) return "";
  const L = lossesOf(state).find((x) => x.tile === card.lostBase);
  return L ? `<div class="why-card">${linkFor({ b: L.id, d: L.day }, "Why was it lost?")}</div>` : "";
}

// A chain's text with its names, places and days as links.
function linked(state, text) {
  const list = [];
  for (const [type, id, start, len] of findRefs(state, text)) list.push({ type, id, start, len });
  const rx = /\bday (\d+)\b/gi;
  let m;
  while ((m = rx.exec(text))) list.push({ type: "d", id: Number(m[1]), start: m.index, len: m[0].length });
  list.sort((a, b) => a.start - b.start || b.len - a.len);
  let out = "", at = 0;
  for (const r of list) {
    if (r.start < at) continue;
    out += esc(text.slice(at, r.start));
    const label = esc(text.substr(r.start, r.len));
    out += r.type === "d"
      ? `<a class="lk lk-d" data-action="why-day" data-d="${r.id}"${tip("Open the diary on this day")}>${label}</a>`
      : `<a class="lk lk-${r.type}" data-action="why-lk" data-k="${r.type}" data-id="${r.id}">${label}</a>`;
    at = r.start + r.len;
  }
  return out + esc(text.slice(at));
}

// The chain shown by the panel: { title, label, head, factors, recorded, day } or null.
function chainOf(state, w) {
  if (!w) return null;
  if (w.s != null) {
    const c = deathCause(state, w.s);
    return c && { title: `Why did ${c.name} die?`, label: c.label, head: c.head, factors: c.factors, recorded: c.recorded, day: c.day };
  }
  const L = lossesOf(state).find((x) => x.id === w.b && x.day === w.d);
  return L && { title: `Why was ${L.name} lost?`, label: "Lost base", head: L.why.h, factors: L.why.f, recorded: true, day: L.day };
}

export function whyModal(state, ui) {
  const c = chainOf(state, ui.why);
  if (!c) return `<div class="box"><h1>Why?</h1><div class="muted">Nothing was written down about this.</div><div class="row" style="justify-content:flex-end"><button class="primary" data-action="why-close">Close</button></div></div>`;
  return `<div class="box whybox">
    <div class="spread"><h1>${esc(c.title)}</h1><span class="muted small">${esc(c.label)}</span></div>
    <div class="why-head">${linked(state, c.head)}</div>
    ${c.factors.length ? `<ol class="why-chain">${c.factors.map((f) => `<li>${linked(state, f.t)}</li>`).join("")}</ol>` : `<div class="muted small">Nothing more was written down about it.</div>`}
    ${c.recorded ? "" : `<div class="muted small">Pieced together from the diary: this happened before causes were recorded.</div>`}
    <div class="row" style="justify-content:flex-end;margin-top:0.6rem">
      <button data-action="why-day" data-d="${c.day}"${tip("Everything written down that day")}>📖 Day ${c.day} in the diary</button>
      <button class="primary" data-action="why-close"${tip("Close (Esc)")}>Close</button>
    </div></div>`;
}

export const WHY_ACTIONS = {
  why: (state, ui, d) => { ui.why = d.s != null ? { s: Number(d.s) } : { b: Number(d.b), d: Number(d.d) }; },
  "why-close": (state, ui) => { ui.why = null; },
  "why-day": (state, ui, d) => {
    ui.why = null;
    ui.survivor = null;
    ui.memorial = null;
    ui.baseView = null;
    openDiary(ui, Math.max(1, Math.min(day(state), Number(d.d) || 1)));
  },
  "why-lk": (state, ui, d, act) => { ui.why = null; act.lk(d); },
};
