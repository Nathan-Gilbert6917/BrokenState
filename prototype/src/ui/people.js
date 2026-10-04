// People in the UI: the recruit card window (who asks to join, and the beds, food and water of the base they would
// join, or the team's rations), the crowding line in the base panel, and the mood-risk chip in the People tab.
// Recruit choices use the normal card "choice" action (main.js), so nothing here needs a handler of its own.
import { SKILL_NAMES, TRAITS, GEAR } from "../sim/data.js";
import { day, hourOfDay, skill } from "../sim/world.js";
import { recruitView, daysText } from "../sim/recruits.js";
import { crowdInfo, moodRisk, MOOD_RISK_TIP, CROWD, LEADER_LIFT } from "../sim/morale.js";
import { survivorURL, spriteImg } from "./sprites.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n1 = (v) => (Math.round((v || 0) * 10) / 10).toString();
const sgn = (v) => `${v >= 0 ? "+" : "−"}${n1(Math.abs(v))}`;
const bar = (v, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></div>`;
const clock = (state) => `${String(hourOfDay(state)).padStart(2, "0")}:00`;

function candidateCard(state, c) {
  const s = c.s;
  const skills = Object.keys(s.skills).sort((a, b) => skill(s, b) - skill(s, a)).slice(0, 5)
    .map((k) => `<span class="chip">${esc(SKILL_NAMES[k])} ${skill(s, k)}</span>`).join("");
  const traits = s.traits.map((t) => `<span class="chip trait"${tip(TRAITS[t].desc)}>${esc(TRAITS[t].name)}</span>`).join("");
  const gear = c.items.length ? c.items.map((g) => `<span class="chip"${tip(GEAR[g.key] ? GEAR[g.key].desc || GEAR[g.key].name : g.name)}>${esc(g.name)}${g.quality != null && g.quality < 1 ? ` ${Math.round(g.quality * 100)}%` : ""}</span>`).join("") : `<span class="muted small">No gear</span>`;
  return `<div class="card small">
    <div class="spread"><b>${spriteImg(survivorURL(s, state.seed), 1.6)}${esc(s.name)}</b>${s.pending ? "" : `<span class="muted small">answered</span>`}</div>
    <div class="row small"><span style="width:3.5rem" class="muted">Health</span><div style="flex:1">${bar(s.health, s.health < 40 ? "var(--danger)" : "var(--good)")}</div><span style="width:2rem">${Math.round(s.health)}</span></div>
    <div>${skills}${traits}</div>
    <div class="small" style="margin-top:0.2rem"><span class="muted">Carries </span>${gear}</div>
  </div>`;
}

// The recruit card window (ui.js cardModal hands cards with card.recruit here).
export function recruitModal(state, card) {
  const v = recruitView(state, card);
  const o = v.outlook;
  const k = v.k;
  const after = (withK) => (k ? ` <span class="muted">→ ${withK} with ${k === 1 ? "them" : "them all"}</span>` : "");
  const water = (d, net) => (d == null ? `steady (${net >= 0 ? "+" : ""}${n1(net)} a day)` : daysText(d));
  const t = v.team;
  const baseBox = !o ? `<div class="card small muted">You have no base left: they can only join the team.</div>` : `<div class="card small"><div class="kv">
      <div${tip("Beds at the base, and how many are free now")}>Beds</div><div class="${o.freeWith < 0 ? "danger" : ""}">${Math.max(0, o.free)} of ${o.beds} free${after(o.freeWith >= 0 ? `${o.freeWith} free` : `${-o.freeWith} without a bed`)}</div>
      <div${tip("Days of food at today's eating and spoilage, without harvests (taking someone in costs 5 food each on arrival)")}>Food</div><div>${Math.floor(o.food)} · ${daysText(o.foodDays)}${after(daysText(o.foodDaysWith))}</div>
      <div${tip("Days of water left at today's rate (steady: the well and rain keep up)")}>Water</div><div>${Math.floor(o.water)} · ${water(o.waterDays, o.waterNet)}${after(water(o.waterDaysWith, o.waterNetWith))}</div>
    </div></div>`;
  const teamBox = t ? `<h3>The team</h3><div class="card small"><div class="kv">
      <div>People</div><div>${t.members}${k ? ` <span class="muted">→ ${t.members + k}</span>` : ""}</div>
      <div${tip("Food and water the team carries (1 of each a day per person)")}>Rations</div><div class="${t.ok ? "" : "danger"}">${Math.floor(t.food)} food, ${Math.floor(t.water)} water · ${n1(t.days)} days${k ? ` <span class="muted">→ ${n1(t.daysWith)} with them</span>` : ""}</div>
      <div>Way home</div><div>about ${t.hours} hours to ${esc(t.home.name)}${t.ok ? "" : ` · <span class="danger">needs ${t.need} of each</span>`}</div>
    </div></div>` : "";
  return `<div class="box wide">
    <h1>${esc(card.title)}</h1>
    ${card.where ? `<div class="where">Near ${esc(card.where)} · Day ${day(state)} ${clock(state)}</div>` : ""}
    ${card.recruit.intro ? `<div class="text">${esc(card.recruit.intro)}</div>` : ""}
    <div class="grid2">
      <div><h3>${v.candidates.length === 1 ? "Who" : `Who (${v.candidates.length})`}</h3>${v.candidates.map((c) => candidateCard(state, c)).join("")}</div>
      <div>${teamBox}<h3>${esc(v.base.name)}</h3>${baseBox}</div>
    </div>
    <div class="choices">${card.choices.map((c, i) => {
      const dis = typeof c.disabled === "function" ? c.disabled(state) : c.disabled;
      return `<button data-action="choice" data-i="${i}" ${dis ? "disabled" : ""}${tip(c.hint)}>${esc(c.label)}${c.hint ? `<span class="hint">${esc(c.hint)}</span>` : ""}</button>`;
    }).join("")}</div></div>`;
}

// Base panel: beds, how crowded, and what it does to mood a day.
export function crowdingRow(state, b) {
  const ci = crowdInfo(state, b);
  const text = ci.penalty > 0
    ? `Crowding costs everyone here ${n1(ci.penalty)} mood a day (2 + 8 per 100% over the beds, up to ${CROWD.cap}).${ci.leader ? ` The leader gives +${n1(ci.lift)} of their +${n1(ci.rawLift)} (Leadership × ${LEADER_LIFT}, at most half the crowding).` : " No leader here to soften it."} Illness spreads more easily too. Build bunkhouses (+6 beds) or move people out.`
    : `Everyone has a bed: +${CROWD.roomy} mood a day.${ci.leader ? ` The leader adds +${n1(ci.lift)} (Leadership × ${LEADER_LIFT}).` : ""}`;
  return `<div${tip(text)}>Beds</div><div><span class="${ci.level.tone}">${ci.beds} for ${ci.people} · ${esc(ci.level.name)}${ci.penalty > 0 ? ` (${Math.round(ci.ratio * 100)}%)` : ""}</span> <span class="muted">mood ${sgn(ci.net)}/day</span></div>`;
}

// People tab: a chip next to someone's mood when they are at risk of leaving.
export function moodRiskChip(s) {
  const r = moodRisk(s);
  if (!r) return "";
  return `<span class="chip ${r.level >= 2 ? "off" : ""}"${tip(MOOD_RISK_TIP)}><span class="${r.tone}">${esc(r.text)}</span></span>`;
}
