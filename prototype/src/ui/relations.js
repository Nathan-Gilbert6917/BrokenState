// Relationships, mood breakdown, service record and the memorial wall in the UI (sim/relations.js).
// - relChip: a compact chip for the People tab / roster (♥ partner, +n friends, −n rivals; names in the tooltip);
// - moodTipAttr: every mood factor with its number, as a multi-line tooltip for a mood bar;
// - relationsSection: the survivor screen's mood, people, service record and notable moments;
// - memorialModal / memorialButton: the Memorial wall (from the base panel), with a memorial service;
// - REL_ACTIONS: the handlers (main.js registers them).
import { day, survivorById, baseById, hub } from "../sim/world.js";
import {
  survivorSummary, relationsOf, KIND_NAMES, RECORD_KEYS, daysWith, memorialList, memorialInfo, holdMemorial, peaceInfo, makePeace,
  PEACE, MEMORIAL, compat, temperName, REL,
} from "../sim/relations.js";
import { moodWork, MOOD_WORK } from "../sim/morale.js";
import { survivorURL, spriteImg } from "./sprites.js";
import { whyButton } from "./causes.js"; // the "Why?" link of a death (sim/causes.js)

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n1 = (v) => (Math.round((v || 0) * 10) / 10).toString();
const sgn = (v) => `${v >= 0 ? "+" : "−"}${n1(Math.abs(v))}`;
const first = (s) => s.name.split(" ")[0];
const bar = (v, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></div>`;

// ---------- People tab / roster ----------
export function relChip(state, s) {
  if (!s || !s.alive) return "";
  const r = survivorSummary(state, s);
  const bits = [];
  if (r.partner) bits.push("♥");
  if (r.friends.length) bits.push(`+${r.friends.length}`);
  if (r.rivals.length) bits.push(`−${r.rivals.length}`);
  const states = r.states.length ? r.states : [];
  if (!bits.length && !states.length) return "";
  const lines = [];
  if (r.partner) lines.push(`Partner: ${r.partner.name}`);
  if (r.friends.length) lines.push(`Friends: ${r.friends.map(first).join(", ")}`);
  if (r.rivals.length) lines.push(`Rivals: ${r.rivals.map(first).join(", ")}`);
  for (const st of states) lines.push(st);
  return `${bits.length ? `<span class="chip rel"${tip(lines.join(" · "))}>${bits.join(" ")}</span>` : ""}${states.map((t) => `<span class="chip ${/Grieving|break/.test(t) ? "off" : ""}"${tip(lines.join(" · "))}>${esc(t)}</span>`).join("")}`;
}

// ---------- mood breakdown ----------
export function moodTipText(state, s) {
  const r = survivorSummary(state, s);
  const lines = [`Mood ${Math.round(s.mood)} · ${sgn(r.moodPerDay)} a day · works at ${Math.round(moodWork(s) * 100)}%`];
  for (const f of [...r.factors].sort((a, b) => b.v - a.v)) lines.push(`${sgn(f.v).padStart(5)}  ${f.label}`);
  if (!r.factors.length) lines.push("  (no daily factors here)");
  if (r.notes.length) {
    lines.push("Lately:");
    for (const n of r.notes.slice(0, 6)) lines.push(`${sgn(n.v).padStart(5)}  ${n.label} (day ${n.d})`);
  }
  lines.push(`Work: ${MOOD_WORK.map(([m, w]) => `${m}→${Math.round(w * 100)}%`).join(", ")}; grieving up to −20%; a break: no work that day.`);
  return lines.join("\n");
}
export const moodTipAttr = (state, s) => ` data-tip="${esc(moodTipText(state, s))}" data-tip-pre`;

// ---------- survivor screen ----------
export function relationsSection(state, s, ui = {}) {
  const r = survivorSummary(state, s);
  const dead = !s.alive && !s.left;
  const mem = dead ? memorialList(state).find((m) => m.id === s.id) : null;
  const moodBlock = s.alive ? `<h3>Mood</h3><div class="card small"${moodTipAttr(state, s)}>
      <div class="spread"><span>${Math.round(s.mood)} · <span class="${r.moodPerDay < 0 ? "danger" : "good"}">${sgn(r.moodPerDay)} a day</span> · works at ${Math.round(moodWork(s) * 100)}%</span><span class="muted">${esc(r.temper)}</span></div>
      ${r.states.length ? `<div>${r.states.map((t) => `<span class="chip off">${esc(t)}</span>`).join("")}</div>` : ""}
      <div class="kv" style="margin-top:0.2rem">${[...r.factors].sort((a, b) => b.v - a.v).map((f) => `<div class="${f.v < 0 ? "danger" : "good"}">${sgn(f.v)}</div><div>${esc(f.label)}</div>`).join("") || `<div>—</div><div class="muted">No daily factors here</div>`}</div>
      ${r.notes.length ? `<div class="muted" style="margin-top:0.2rem">Lately: ${r.notes.slice(0, 4).map((n) => `${esc(n.label)} ${sgn(n.v)} (day ${n.d})`).join(" · ")}</div>` : ""}
    </div>` : "";
  return `${ui.relMsg ? `<div class="result small">${esc(ui.relMsg)}</div>` : ""}${mem ? memorialHeader(state, mem) : ""}
    <div class="grid2">
      <div>${moodBlock}${peopleBlock(state, s)}</div>
      <div>${recordBlock(state, s, r)}</div>
    </div>`;
}

function peopleBlock(state, s) {
  const list = relationsOf(state, s).filter((x) => x.kind !== "known" || Math.abs(x.o) >= 20).slice(0, 10);
  const rows = list.map((x) => {
    const o = x.other;
    const c = compat(state, s, o);
    const why = `${KIND_NAMES[x.kind]} · opinion ${Math.round(x.o)} (friends at ${REL.friend}+, rivals at ${REL.rival} or below). Why: ${c.parts.map(([k, v]) => `${k} ${sgn(v)}`).join(", ")}${Math.abs(x.rel.h) >= 1 ? `, shared history ${sgn(x.rel.h)}` : ""}. They drift toward that each day they share a base, a team or a job.`;
    const tone = x.kind === "rival" ? "var(--danger)" : x.kind === "known" ? "var(--muted)" : "var(--good)";
    let act = "";
    if (s.alive && o.alive && x.kind === "rival") {
      const p = peaceInfo(state, s, o);
      act = `<button class="mini" data-action="rel-peace" data-id="${s.id}" data-other="${o.id}" ${p.ok && p.who ? "" : "disabled"}${tip(p.ok ? (p.who ? `${first(p.who)} talks it out with them: ${Math.round(p.chance * 100)}% to bury the hatchet (+${PEACE.talkOk / 2} now and lasting history), else it gets a little worse. Once in ${PEACE.cooldown} days.` : "Nobody else at the base can talk them round") : p.reason)}>Talk it out</button><button class="mini" data-action="rel-gift" data-id="${s.id}" data-other="${o.id}" ${p.ok && p.hasFood ? "" : "disabled"}${tip(p.ok ? (p.hasFood ? `A shared meal (${PEACE.food} days of food from the base): +${PEACE.gift / 2} now and lasting history. Once in ${PEACE.cooldown} days.` : `Needs ${PEACE.food} food at the base`) : p.reason)}>Shared meal</button>`;
    }
    return `<div class="row small"${tip(why)}><span style="width:7.5rem"><a data-action="survivor" data-id="${o.id}" class="link">${esc(o.name)}</a>${o.alive ? "" : " †"}</span><span style="width:6rem" class="muted">${esc(x.partner ? "♥ Partner" : KIND_NAMES[x.kind])}</span><div style="flex:1">${bar((x.o + 100) / 2, tone)}</div><span style="width:2rem">${Math.round(x.o)}</span>${act}</div>`;
  });
  return `<h3>People</h3><div class="card small">${rows.join("") || `<span class="muted">No close ties yet. People get to know each other at a base, on a team, at the same job and in a fight.</span>`}</div>`;
}

function recordBlock(state, s, r) {
  const rec = r.record;
  const cells = [["Days with the group", rec.days], ...RECORD_KEYS.map(([k, label]) => [label, k === "harvested" ? Math.round(rec[k]) : rec[k]])];
  return `<h3>Service record</h3><div class="card small"><div class="kv">${cells.map(([k, v]) => `<div>${esc(k)}</div><div>${esc(v)}</div>`).join("")}</div></div>
    <h3>Notable moments</h3><div class="card small">${r.moments.length ? r.moments.map((m) => `<div>${esc(m.t)}</div>`).join("") : `<span class="muted">Nothing yet.</span>`}</div>`;
}

function memorialHeader(state, m) {
  return `<div class="card small"><b>In memory</b> · died on day ${m.died}${m.cause ? ` ${esc(m.cause)}` : ""} (${esc(m.place)}) ${whyButton(m)}, after ${m.days} day${m.days === 1 ? "" : "s"} with the group.${m.grievedBy.length ? ` Grieved by ${esc(m.grievedBy.join(", "))}.` : ""}</div>`;
}

// ---------- the memorial wall ----------
export function memorialButton(state, b) {
  const n = memorialList(state).length;
  if (!b) return "";
  return `<button class="mini" data-action="memorial-open" data-base="${b.id}"${tip("The memorial wall: everyone the group has lost, with their record. Hold a memorial service from there.")}>Memorial wall (${n})</button>`;
}

function highlights(m) {
  const bits = [];
  const r = m.record || {};
  for (const [k, label] of RECORD_KEYS) if (r[k] > 0 && k !== "downed") bits.push(`${label.toLowerCase()} ${k === "harvested" ? Math.round(r[k]) : r[k]}`);
  return bits.slice(0, 5).join(" · ");
}

export function memorialModal(state, ui) {
  const b = (ui.memorial && baseById(state, ui.memorial.baseId)) || hub(state);
  const list = memorialList(state);
  const info = b ? memorialInfo(state, b) : { ok: false, reason: "No base.", food: 0, chapel: false };
  const lift = MEMORIAL.all + (info.chapel ? MEMORIAL.chapel : 0);
  return `<div class="box wide">
    <div class="spread"><h1>Memorial wall</h1><span class="muted">${list.length} name${list.length === 1 ? "" : "s"} · Day ${day(state)}</span></div>
    ${ui.memorialMsg ? `<div class="result small">${esc(ui.memorialMsg)}</div>` : ""}
    <div class="memorial">${list.length ? list.map((m) => {
      const s = survivorById(state, m.id);
      return `<div class="card small mem">
        <div class="spread"><b>${s ? spriteImg(survivorURL(s, state.seed), 1.6) : ""}<a data-action="survivor" data-id="${m.id}" class="link">${esc(m.name)}</a>${m.leader ? " · leader" : ""}</b><span class="muted">day ${m.joined}–${m.died} · ${m.days} day${m.days === 1 ? "" : "s"}</span></div>
        <div>Died ${esc(m.cause || "")} <span class="muted">(${esc(m.place)})</span> ${whyButton(m)}</div>
        ${highlights(m) ? `<div class="muted">${esc(highlights(m))}</div>` : ""}
        ${m.moments.length ? `<div>${m.moments.slice(0, 2).map((x) => esc(x.t)).join("<br>")}</div>` : ""}
        <div class="muted">${m.partner ? `Partner: ${esc(m.partner)} · ` : ""}${m.grievedBy.length ? `Grieved by ${esc(m.grievedBy.join(", "))}` : "Nobody close enough to grieve"}${m.honored ? ` · remembered on day ${m.honored}` : ""}</div>
      </div>`;
    }).join("") : `<div class="muted">Nobody has died yet.</div>`}</div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end">
      ${b ? `<button data-action="memorial-service" data-base="${b.id}" ${info.ok ? "" : "disabled"}${tip(info.ok ? `${info.food} food at ${b.name}: everyone there mood +${lift}${info.chapel ? " (in the chapel)" : ""}, the grieving +${lift + MEMORIAL.grievers} and ${MEMORIAL.griefDays} days less grief. Once a week.` : info.reason)}>Hold a memorial service (${info.food} days of food)</button>` : ""}
      <button class="primary" data-action="memorial-close">Close</button>
    </div></div>`;
}

// ---------- handlers ----------
export const REL_ACTIONS = {
  "memorial-open": (state, ui, d) => { ui.memorial = { baseId: d.base != null ? Number(d.base) : (hub(state) || {}).id }; ui.memorialMsg = ""; },
  "memorial-close": (state, ui) => { ui.memorial = null; ui.memorialMsg = ""; },
  "memorial-service": (state, ui, d) => { const b = baseById(state, Number(d.base)) || hub(state); if (b) ui.memorialMsg = holdMemorial(state, b); },
  "rel-peace": (state, ui, d) => { const a = survivorById(state, Number(d.id)), o = survivorById(state, Number(d.other)); if (a && o) ui.relMsg = makePeace(state, a, o, "talk"); },
  "rel-gift": (state, ui, d) => { const a = survivorById(state, Number(d.id)), o = survivorById(state, Number(d.other)); if (a && o) ui.relMsg = makePeace(state, a, o, "gift"); },
};

export { daysWith, temperName };
