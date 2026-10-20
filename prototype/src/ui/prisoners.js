// The Prisoners tab of a base (sim/prisoners.js): the jail here (its tier and room, and every base's), who is held
// here, in a cell or a shed, what they eat and do, and
// what to do with each: rations, labour, question (or roughly), ask to join, win over, ransom, trade back, release,
// execute. A summary on top: food a day at their rations, labour by task, guards and the day's escape risk.
import { keyWord } from "../sim/water.js"; // "rounds", "9mm FMJ"
import { SKILL_NAMES, TRAITS, FACTION_TYPES } from "../sim/data.js";
import { traitChips } from "./traitpick.js"; // trait chips: coloured by kind, the tier
import { day, atBase, baseById, survivorById, skill } from "../sim/world.js";
import { CONQUEST } from "../sim/conquest.js";
import { teamName } from "../sim/parties.js";
import { WEAR } from "../sim/breakdowns.js";
import {
  PRISON, TASKS, JAIL, SHED, prisonersAt, cellCap, prisonerView, prisonSummary, tasksAt, guardsAt, questionPrisoner, askRansom,
  tradeBack, releasePrisoner, setMode, executePrisoner, askToJoin, setRation, setAllRations, setTask, setAllTasks,
  jailOf, jailTier, freeCells, incomingTo, basesWithRoom, movePrisoner,
  JAIL_GUARD, jailGuardIds, jailGuardsOn, guardStrength, guardWeight, cellEscape, stackGuards, toggleJailGuard, fillJailGuards, jailGuardsWanted,
} from "../sim/prisoners.js";
import { BUILDINGS } from "../sim/buildings.js";
import { wormOthersAt, WORM } from "../sim/worm.js"; // the worm in a prisoner: spotted, treated like a resident
import { otherWormRow } from "./health.js";
import { ask } from "./confirm.js"; // execute and release ask first (one confirmation style)

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => ` data-tip="${esc(t)}"`;
const pctTxt = (v) => `${Math.round(v * 100)}%`;
const pct1 = (v) => `${Math.round(v * 1000) / 10}%`;
const n1 = (v) => Math.round((v || 0) * 10) / 10;
const KIND = { raiders: "Raider", soldiers: "Soldier", zealots: "Zealot", fighters: "Fighter", guards: "Guard", militia: "Militia" };
const R = PRISON.RATIONS;

// What each ration does, for the selects' tooltips.
const rationTip = (k) => {
  const r = R[k];
  const health = r.heal > 0 ? `health +${r.heal} a day up to ${r.healTo}` : `health ${r.heal} a day`;
  return `${r.name}: ${n1(r.share * PRISON.FOOD)} food a day (× the cold); ${health}; escapes ×${r.escape}${k === "none" ? " (+ unfed " + pctTxt(PRISON.ESCAPE.unfed) + ", dead in " + PRISON.STARVE_DAYS + " days)" : ""}; winning over ×${r.recruit}; asking to join ${r.ask >= 0 ? "+" : ""}${pctTxt(r.ask)}; questioning +${pctTxt(r.question)}; work ×${r.labour}.`;
};
const RATIONS_TIP = `Rations. ${Object.keys(R).map(rationTip).join(" ")} While anyone here is on Starvation or None, your people here lose ${-PRISON.SEEN.mood} mood a day (a Former Medic ${-PRISON.SEEN.soft}; the Brave and Tough shrug it off).`;
const L = PRISON.LABOUR;
const TASKS_TIP = `Labour: out of the cell 07–19 at ${pctTxt(L.min)}–${pctTxt(L.max)} of a survivor (${pctTxt(L.perSkill)} a point of the task's skill) × rations × health (too weak under ${L.minHealth}) × mood (${L.moodBase} + ${L.moodPer} × mood/100, ${pctTxt(L.moodMin)}–${pctTxt(L.moodMax)}). ${Object.entries(TASKS).filter(([k]) => k !== "idle").map(([, t]) => `${t.name}${t.skill ? ` (${SKILL_NAMES[t.skill]})` : ""}: ${t.out}.`).join(" ")} A guard watches up to ${L.guardWatch} at work (${JAIL.lockup.watch} from makeshift cells, all of them from a jailhouse's guard post): watched they escape ${pctTxt(L.escapeGuarded)} a day, unwatched ${pctTxt(L.escapeUnguarded)}, × the jail (makeshift ×${JAIL.lockup.labour}, a jailhouse ×${JAIL.jailhouse.labour}); under mood ${L.lowMood} ×${L.lowMoodMult}, and now and then (${pctTxt(L.sabotage.chance)} a day) they spoil a little of what they worked on. Work tires them (mood, and health on Short or less). Days of good work make them easier to win over.`;
// The jail tiers, for the tooltips.
const JAIL_TIP = `Jails (Construction): ${Object.values(JAIL).map((j) => `${j.name}: ${j.cap} prisoners, escapes ${pct1(j.unguarded)} a day with no guard, ${pct1(j.guarded)} with one, ${pct1(cellEscape(j, stackGuards([1, 1])))} with two, ${pct1(cellEscape(j, stackGuards([1, 1, 1])))} with three, a smuggled pick or a loner's tricks ×${j.bonus} each${j.mood ? `, mood ${j.mood} a day, won over ×${j.opinion}` : ""}, a rescue meets the defence ×${j.defence}`).join(". ")}. Each upgrades the one below in place. No jail, no prisoners: more than there is room for get a card (release, execute, ask to join, or walk them to a base with room).`;

function rationOptions(cur, all = false) {
  return (all ? `<option value="">Set all…</option>` : "") + Object.entries(R).map(([k, r]) => `<option value="${k}"${!all && k === cur ? " selected" : ""}>${esc(r.name)} (${n1(r.share * PRISON.FOOD)})</option>`).join("");
}
function taskOptions(state, base, cur, all = false) {
  const ok = tasksAt(state, base);
  return (all ? `<option value="">Set all…</option>` : "") + Object.entries(TASKS).filter(([k]) => ok.includes(k) || k === cur).map(([k, t]) => `<option value="${k}"${!all && k === cur ? " selected" : ""}>${esc(t.name)}</option>`).join("");
}

// The next tier up from this jail (null at the top).
const nextJail = (base) => ["lockup", "cells", "jailhouse"][jailTier(base)] || null;
const costTxt = (c) => Object.entries(c).map(([k, v]) => `${v} ${k === "parts" ? (v === 1 ? "part" : "parts") : k}`).join(", ");
// The jail's guards (sim/prisoners.js JAIL_GUARD): who is on its roster, who stands it now, and what each does to the
// escapes; add one, take one off, or fill it with the sharpest here.
const GUARD_TIP = `Jail guards: the people named here guard the jail with their work hours while anyone is held (Manual people take the Guard role for it and get their job back when the cells are empty; people on work priorities guard in their Work hours; a base leader with Defence picks them). Each counts by Scouting (${JAIL_GUARD.base} + ${JAIL_GUARD.perSkill} a point, ${JAIL_GUARD.min}–${JAIL_GUARD.max}; Tired ×${JAIL_GUARD.tired}, Exhausted less), each next one ×${JAIL_GUARD.dim} of the one before; a lookout on the walls (the Guard role, not named here) counts ${JAIL_GUARD.lookout} and watches nobody at work. Every guard makes the cells harder to get out of; the work detail is watched only by the jail's guards.`;
function guardRow(state, base, J) {
  const ids = jailGuardIds(base);
  const on = jailGuardsOn(state, base);
  const gs = guardStrength(state, base);
  const roster = ids.map((id) => survivorById(state, id)).filter(Boolean);
  const held = prisonersAt(state, base.id).length;
  const chips = roster.map((s) => {
    const duty = on.includes(s);
    const why = !s.alive ? "dead" : s.location.kind !== "base" || s.location.baseId !== base.id ? "away" : s.inBed ? "in a hospital bed" : !held ? "nobody held" : !duty ? (s.pinned ? "pinned to another job" : "not fit to stand it") : "";
    return `<button class="chip ${duty ? "on" : "off"}" data-action="pr-guard-toggle" data-base="${base.id}" data-id="${s.id}"${tip(`${s.name}: Scouting ${skill(s, "scouting")}, counts ${n1(guardWeight(s))}${why ? ` (not standing it: ${why})` : ""}. Click to take them off the jail.`)}>${esc(s.name.split(" ")[0])} ✕</button>`;
  }).join(" ");
  const others = atBase(state, base.id).filter((s) => !ids.includes(s.id)).sort((a, b) => guardWeight(b) - guardWeight(a));
  const add = others.length ? `<select data-action="pr-guard-add" data-base="${base.id}"><option value="">Add a guard…</option>${others.map((s) => `<option value="${s.id}">${esc(s.name)} (Scouting ${skill(s, "scouting")}, ${esc(s.role)})</option>`).join("")}</select>` : "";
  const want = jailGuardsWanted(state, base);
  const now = cellEscape(J, gs.G), more = cellEscape(J, stackGuards([...on.map(guardWeight), 1, ...Array(gs.lookouts).fill(JAIL_GUARD.lookout)]));
  return `<div class="small"${tip(GUARD_TIP)}>Jail guards: ${chips || `<span class="warn">nobody named</span>`} ${add} <button class="mini" data-action="pr-guard-fill" data-base="${base.id}"${tip(`Name the ${want || 1} sharpest here (Scouting): one per ${JAIL_GUARD.want.per} held and enough to watch the work detail, at most a quarter of the people.`)}>Fill${want ? ` (${want})` : ""}</button>
    · ${on.length} standing it${gs.lookouts ? ` + ${gs.lookouts} lookout${gs.lookouts === 1 ? "" : "s"} on the walls` : ""}: escapes from the cell <b class="${now >= J.unguarded * 0.5 ? "warn" : ""}">${pct1(now)}</b> a day (nobody: ${pct1(J.unguarded)}; one more guard: ${pct1(more)}).</div>`;
}
export function prisonTab(state, base, ui) {
  const list = prisonersAt(state, base.id);
  const cap = cellCap(base);
  const J = jailOf(base);
  const waiting = list.filter((p) => p.awaiting).length;
  const kept = list.length - waiting;
  const shed = Math.max(0, kept - cap);
  const out = (state.prisoners || []).filter((p) => p.at.kind === "party" && (p.dest === base.id || (p.dest == null && (() => { const t = state.parties.find((x) => x.id === p.at.partyId); return t && t.homeBaseId === base.id; })())));
  const walking = (state.prisoners || []).filter((p) => p.at.kind === "transit" && p.at.baseId === base.id);
  const up = nextJail(base);
  const G = J || SHED;
  let html = `<h3>Prisoners at ${esc(base.name)}</h3>
    <div class="small"${tip(JAIL_TIP)}><b>${esc(J ? `${J.name} (tier ${J.tier} of 3)` : "No jail")}</b>: ${cap ? `${Math.min(cap, kept)} of ${cap} used, ${freeCells(state, base)} free${incomingTo(state, base) ? ` (${incomingTo(state, base)} on the way)` : ""}` : `<span class="warn">no room for prisoners</span>`}${J ? ` · escapes ${pct1(J.guarded)} a day guarded, ${pct1(J.unguarded)} unguarded` : ""}${up ? ` · next: ${esc(BUILDINGS[up].name)} (${costTxt(BUILDINGS[up].cost)}, ${JAIL[up].cap} prisoners; Construction)` : ""}.</div>
    <div class="small muted">${shed ? `<span class="warn">${shed} in a shed from before the jails (${pctTxt(PRISON.ESCAPE.shed)} a day to escape) until a cell frees up or they are moved</span>. ` : ""}${waiting ? `<span class="warn">${waiting} waiting on your decision (a card)</span>. ` : ""}</div>
    ${guardRow(state, base, G)}
    <div class="small muted">Room at your bases: ${esc(state.bases.map((b) => `${b.name} ${cellCap(b) ? `${freeCells(state, b)}/${cellCap(b)} (${jailOf(b).name.toLowerCase()})` : "none"}`).join(" · "))}.</div>`;
  if (out.length) html += `<div class="small" style="margin-top:0.3rem">On the way here: ${esc(out.map((p) => `${p.name} (with ${teamName(state, state.parties.find((x) => x.id === p.at.partyId))})`).join(", "))}.</div>`;
  if (walking.length) html += `<div class="small" style="margin-top:0.3rem">Walked here by an escort: ${esc(walking.map((p) => `${p.name} (in about ${Math.max(1, Math.round(p.at.arrive - state.hour))} h)`).join(", "))}.</div>`;
  if (!list.length) return html + `<div class="card small muted" style="margin-top:0.5rem">Nobody is held here. In battle, Subdue (C) knocks an enemy out instead of killing them (a takedown from behind on the unaware is best); after a won fight the knocked out come home as prisoners.</div>`;
  const sum = prisonSummary(state, base);
  html += summaryCard(state, base, list, sum);
  for (const p of list) html += prisonerCard(state, base, p, ui, sum.watch);
  return html;
}

function summaryCard(state, base, list, s) {
  const w = s.watch;
  const lab = [];
  if (s.labour.farm > 0) lab.push(`Farm ${n1(s.labour.farm)} farmer${s.labour.farm === 1 ? "" : "s"}' worth of tending`);
  if (s.labour.build > 0) lab.push(`Build ${n1(s.build)} builder-hours a day${base.construction.length ? "" : " (nothing queued)"}`);
  if (s.labour.water > 0) lab.push(`Fetch water +${n1(s.water_hauled)} a day`);
  if (s.labour.kitchen > 0) lab.push(`Kitchen dries ${n1(s.kitchen.take)} of up to ${n1(s.kitchen.cap)} fresh food → ${n1(s.kitchen.out)} preserved today${s.kitchen.take < 0.05 ? " (no surplus fresh food)" : ""}`);
  if (s.labour.upkeep > 0) lab.push(`Clean and mend −${n1(s.labour.upkeep * WEAR.upkeep)} wear a day`);
  if (s.labour.wood > 0) lab.push(`Cut wood about ${Math.round(s.wood)} wood a day`);
  if (s.labour.scrap > 0) lab.push(`Haul and sort scrap +${n1(s.scrap)} a day`);
  const unwatched = w.workers.length - w.watched.size;
  const shelterNote = tasksAt(state, base).length < Object.keys(TASKS).length ? ` A shelter has less to do: ${Object.entries(TASKS).filter(([k]) => !tasksAt(state, base).includes(k)).map(([, t]) => t.name).join(", ")} not here.` : "";
  return `<div class="card" style="margin-top:0.5rem">
    <div class="spread"><b>${list.length} held</b><span class="small muted">day ${day(state)}</span></div>
    <div class="small"${tip("Food a day for the prisoners at their rations (× the cold), counted in the base's food line (upkeep.js). Water is the same for everyone (× the day's thirst).")}>Food: <b>${n1(s.food)}</b> a day at their rations${s.fullFood - s.food > 0.05 ? ` (saves ${n1(s.fullFood - s.food)} against Full)` : ""}; water ${n1(s.water)} a day.</div>
    <div class="small"${tip(TASKS_TIP)}>Labour: ${w.workers.length ? `${w.workers.length} out at work, ${w.watched.size} watched by ${w.guards} guard${w.guards === 1 ? "" : "s"} (each watches ${w.each >= 99 ? "every one, from the jailhouse's guard post" : w.each})${unwatched ? `, <span class="warn">${unwatched} unwatched (${pctTxt(L.escapeUnguarded)} a day to run)</span>` : ""}. ${esc(lab.join("; ") || "nothing to show yet")}.` : "everyone is in the cells."}${esc(shelterNote)}</div>
    <div class="small"${tip("The chance someone gets away today: by cell, shed or work detail, guards, rations, their mood and an execution's fear. Expected: the sum of everyone's chances.")}>Escape risk today: <b class="${s.escapeAny > 0.1 ? "warn" : ""}">${pct1(s.escapeAny)}</b> that anyone runs (about ${n1(s.escapeExpected * 7)} a week at this rate)${base.prisonFear && day(state) <= base.prisonFear ? ` · cowed by an execution until day ${base.prisonFear} (escapes ×${PRISON.EXECUTE.fear})` : ""}.</div>
    ${s.hungry ? `<div class="small warn">${s.hungry} on Starvation or None: your people here lose ${-PRISON.SEEN.mood} mood a day seeing it (a Former Medic ${-PRISON.SEEN.soft}).</div>` : ""}
    <div class="row" style="margin-top:0.35rem;flex-wrap:wrap;gap:0.4rem">
      <label class="small"${tip(RATIONS_TIP)}>Rations for all <select data-action="pr-ration-all" data-base="${base.id}">${rationOptions(null, true)}</select></label>
      <label class="small"${tip(TASKS_TIP)}>Work for all <select data-action="pr-task-all" data-base="${base.id}">${taskOptions(state, base, null, true)}</select></label>
    </div>
  </div>`;
}

function prisonerCard(state, base, p, ui, watch) {
  const v = prisonerView(state, p, watch);
  const f = v.faction;
  const s = p.s;
  const top = Object.entries(s.skills).sort((a, c) => c[1] - a[1]).slice(0, 3).map(([k, n]) => `${SKILL_NAMES[k]} ${n}`).join(", ");
  const traits = traitChips(s);
  const kind = KIND[p.kit] || "Fighter";
  const where = v.awaiting ? "Tied up in the yard, waiting on your decision (the card)" : v.cell ? `In the ${v.hold.name.toLowerCase()}, ${v.guarded ? "guarded" : "unguarded"}` : "In a shed (no free cell)";
  const opinion = Math.max(0, Math.min(100, Math.round(p.opinion)));
  const ransom = p.ransom ? `Ransom asked: ${p.ransom.qty} ${keyWord(p.ransom.key)}, answer due on day ${p.ransom.due}.` : "";
  const Q = PRISON.QUESTION, RQ = Q.rough;
  const qWhat = p.intelDone ? "Again: where their parties (raids too) and the hives near them are now." : "First answers: their bases, people and stock, their parties out (raids too), hives near them (onto your map).";
  const qTip = v.question.ok ? `Question ${p.name}: ${pctTxt(v.question.odds)} to get answers (the best talker's Speech +${pctTxt(Q.speech)} a point, the leader's Leadership +${pctTxt(Q.lead)}; zealots and soldiers say less; hunger loosens tongues: Starvation +${pctTxt(R.starve.question)}, None +${pctTxt(R.none.question)}). ${qWhat} Sours them (${Q.sour}).` : `Questioned on day ${p.questioned}: again from day ${p.questioned + Q.every}.`;
  const roughTip = v.question.ok ? `Question ${p.name} roughly: ${pctTxt(v.question.rough)} (+${pctTxt(RQ.odds)}). Costs: their health ${RQ.health} and mood ${RQ.mood}, opinion ${RQ.sour}; everyone here ${RQ.baseMood} mood (a Former Medic ${RQ.soft}, the Brave and Tough nothing); goodwill ${RQ.goodwill} with ${f ? f.name : "their group"}. ${qWhat}` : qTip;
  const rTip = v.ransom ? `Ask ${f ? f.name : p.group} for ${v.ransom.qty} ${keyWord(v.ransom.key)} (worth about ${v.ransom.value}). They answer in ${PRISON.RANSOM.days[0]}–${PRISON.RANSOM.days[1]} days: pay (goodwill ${PRISON.RANSOM.goodwillPaid}) or refuse (goodwill ${PRISON.RANSOM.goodwillRefused}, and a rescue raid becomes twice as likely for ${PRISON.RANSOM.angryDays} days).` : "Their group is gone: nobody to pay.";
  const rateTxt = p.mode === "recruit" ? `Winning them over: ${opinion}/100, about +${v.rate.toFixed(1)} a day${v.rate > 0 ? ` (≈${Math.ceil((100 - p.opinion) / Math.max(0.1, v.rate))} days)` : ""}.` : `Opinion of you: ${opinion}/100.`;
  const A = PRISON.ASK;
  const askTip = v.ask.ok ? `Ask ${p.name} to join now: ${pctTxt(v.ask.odds)}. By their opinion of you (from ${A.from}, +${pct1(1 / A.span)} a point above it; ${opinion} now), who they were (zealots ×${A.kind.zealots}, soldiers ×${A.kind.soldiers}, a loner ×${A.kind.none}), the leader's Leadership and the best talker's Speech (+${pct1(A.lead)} a point each), rations (Full +${pctTxt(R.full.ask)}, Starvation ${pctTxt(R.starve.ask)}, None ${pctTxt(R.none.ask)}), weeks of good work (+${pct1(L.askPerDay)} a day, up to +${pctTxt(L.askMax)}: ${p.labourDays || 0} days so far) and their mood. Raise it: time on Win them over, Full rations, labour, a leader with Leadership. No: opinion ${A.fail}, ask again in ${A.gap} days.` : `Asked on day ${p.asked}: again from day ${p.asked + A.gap}.`;
  const E = v.execute;
  const exTip = `Execute ${p.name}. Everyone here takes it hard: mood ${E.mood} (Brave or Tough ${E.hardened}, a Former Medic ${E.soft}). Goodwill ${E.goodwill} with ${E.group || "their group"} and ${E.others} with ${E.known} other group${E.known === 1 ? "" : "s"} you know. Infamy +${E.infamy} (now ${Math.round(E.infamyNow)}; above ${CONQUEST.INFAMY.wary} peaceful groups cool toward you). The others held here are cowed for ${E.fearDays} days (escapes ×${E.fear}, mood ${E.fearMood}). Asks first.`;
  const workTxt = v.task === "idle" ? "in the cell" : v.work > 0 ? `works at ${pctTxt(v.work)}${v.why ? `: <span class="${v.moodWork < 0.85 ? "warn" : ""}">${esc(v.why)}</span>` : ""}, ${v.watched ? "watched" : '<span class="warn">unwatched</span>'}` : `<span class="warn">not working</span> (${s.health < L.minHealth ? "too weak" : "nothing to do here now"})`;
  const hp = Math.round(s.health);
  const wo = wormOthersAt(state, base).find((x) => x.kind === "prisoner" && x.p === p);
  const worm = wo ? otherWormRow(state, base, wo) : ""; // "" until it is spotted
  const cured = p.wormTreated && f ? WORM.OTHERS.RETURN_GOODWILL : 0; // treated for the worm: their group remembers it
  return `<div class="card" style="margin-top:0.5rem">
    <div class="spread"><b>${esc(p.name)}</b><span class="small muted">${esc(kind)} of ${esc(p.group)}${f ? ` (${esc(FACTION_TYPES[f.type].label)})` : ""} · held ${v.days} day${v.days === 1 ? "" : "s"}</span></div>
    <div class="small">${esc(where)} · <span class="${hp < 30 ? "danger" : hp < 50 ? "warn" : ""}">health ${hp}</span> · <span class="${s.mood < L.lowMood ? "warn" : ""}"${tip(`Mood sets how well they work (×${n1(v.moodWork)} now: ${L.moodBase} + ${L.moodPer} × mood/100) and, under ${L.lowMood}, how often they run from the work detail and spoil things. Rations, labour, questioning, executions and the jail move it (makeshift cells and the shed: ${JAIL.lockup.mood} a day).`)}>mood ${Math.round(s.mood)}</span>${v.kit.length ? ` · <span class="warn"${tip(`Something to slip out with: each counts ×${v.hold ? v.hold.bonus : SHED.bonus} on their escapes here (a makeshift cage ×${JAIL.lockup.bonus}, a jailhouse ×${JAIL.jailhouse.bonus}).`)}>${esc(v.kit.join(", "))}</span>` : ""} · ${esc(top)}${traits ? ` · ${traits}` : ""}${p.unfed ? ` · <span class="danger">unfed ${p.unfed} day${p.unfed === 1 ? "" : "s"}</span>` : ""}</div>
    ${worm}
    <div class="row small" style="margin-top:0.25rem;flex-wrap:wrap;gap:0.5rem;align-items:center">
      <label${tip(RATIONS_TIP)}>Rations <select data-action="pr-ration" data-id="${p.id}">${rationOptions(v.ration)}</select></label>
      <span class="muted">${n1(v.food)} food a day</span>
      <label${tip(TASKS_TIP)}>Work <select data-action="pr-task" data-id="${p.id}">${taskOptions(state, base, v.task)}</select></label>
      <span class="muted">${workTxt}${p.labourDays ? ` · ${p.labourDays} good day${p.labourDays === 1 ? "" : "s"} of work` : ""}</span>
      <span${tip("Their chance of getting away today (cell or shed, guards, the work detail, rations, mood).")} class="${v.escape >= L.escapeUnguarded - 1e-9 ? "warn" : "muted"}">escape ${pct1(v.escape)} today</span>
    </div>
    <div class="small muted">${esc(rateTxt)}${v.rescue ? ` Their group may come for them: about ${pctTxt(v.rescue)} a day.` : ""}${ransom ? ` ${esc(ransom)}` : ""}</div>
    ${p.report ? `<div class="small" style="margin-top:0.2rem">Last answers: ${esc(p.report)}</div>` : ""}
    <div class="row" style="margin-top:0.35rem;flex-wrap:wrap;gap:0.3rem">
      <button class="mini" data-action="pr-question" data-id="${p.id}" ${v.question.ok ? "" : "disabled"}${tip(qTip)}>Question (${pctTxt(v.question.odds)})</button>
      <button class="mini" data-action="pr-question" data-method="rough" data-id="${p.id}" ${v.question.ok ? "" : "disabled"}${tip(roughTip)}>Roughly (${pctTxt(v.question.rough)})</button>
      <button class="mini" data-action="pr-ask" data-id="${p.id}" ${v.ask.ok ? "" : "disabled"}${tip(askTip)}>Ask to join (${pctTxt(v.ask.odds)})</button>
      <button class="mini ${p.mode === "recruit" ? "active" : ""}" data-action="pr-mode" data-id="${p.id}" data-mode="${p.mode === "recruit" ? "hold" : "recruit"}"${tip(p.mode === "recruit" ? "Stop trying to win them over: just hold them." : `Treat them well and talk: they come round slowly (1 a day × Speech, Leadership, the base's mood, who they were, rations: Full ×${R.full.recruit}, Starvation ×${R.starve.recruit}; weeks of good work up to +${pctTxt(L.recruitMax)}). At 100 they ask to join. Months, not days.`)}>${p.mode === "recruit" ? "Winning over ✔" : "Win them over"}</button>
      <button class="mini" data-action="pr-ransom" data-id="${p.id}" ${v.ransom && !p.ransom ? "" : "disabled"}${tip(rTip)}>Ask a ransom${v.ransom ? ` (${v.ransom.qty} ${esc(keyWord(v.ransom.key))})` : ""}</button>
      <button class="mini" data-action="pr-tradeback" data-id="${p.id}" ${f ? "" : "disabled"}${tip(f ? `Send ${p.name} back to ${f.name} unharmed: goodwill +${PRISON.TRADE_BACK + cured}${cured ? " (+" + cured + " for treating their worm)" : ""}.` : "Their group is gone.")}>Trade back (+${PRISON.TRADE_BACK + cured})</button>
      <button class="mini" data-action="pr-release" data-id="${p.id}"${tip(`Let ${p.name} go${f ? `: they head back to ${f.name} (goodwill +${PRISON.RELEASE + cured}${cured ? ", " + cured + " of it for treating their worm" : ""})` : ""}.`)}>Release</button>
      <button class="mini" data-action="pr-execute" data-id="${p.id}"${tip(exTip)}>Execute</button>
      ${moveButtons(state, base, p)}
    </div>
    <div class="small muted" style="margin-top:0.2rem">Rough questioning: their health ${RQ.health}, your people's mood ${RQ.baseMood}, goodwill ${RQ.goodwill}. Execute: mood ${E.mood} here, goodwill ${E.goodwill}${E.group ? ` with ${esc(E.group)}` : ""} and ${E.others} with ${E.known} other${E.known === 1 ? "" : "s"}, infamy +${E.infamy}.</div>
  </div>`;
}

// Walk a prisoner to another base with room (an escort; idle on the way).
function moveButtons(state, base, p) {
  if (p.awaiting) return "";
  return basesWithRoom(state, base).slice(0, 2).map(({ base: b, room }) => `<button class="mini" data-action="pr-move" data-id="${p.id}" data-base="${b.id}"${tip(`An escort walks ${p.name} to ${b.name} (${jailOf(b).name.toLowerCase()}, ${room} free): ${Math.round(PRISON.WALK.escape * 100)}% a day they slip away on the road.`)}>Move to ${esc(b.name)}</button>`).join("");
}
const done = (ui, text) => { ui.baseMsg = text || ""; };
// The questions before releasing or executing someone (ui/confirm.js): what happens, in full.
const heldBy = (state, id) => (state.prisoners || []).find((x) => x.id === Number(id));
function releaseQ(state, p) {
  const f = p.factionId != null ? (state.factions || []).find((x) => x.id === p.factionId) : null;
  return { kind: "release", title: `Let ${p.name} go?`, text: `They leave at once${f ? ` and head back to ${f.name} (goodwill +${PRISON.RELEASE})` : ""}. Nothing they could have told you or done for you comes with them.`, yes: "Release" };
}
function executeQ(state, p) {
  const E = prisonerView(state, p).execute;
  return { kind: "execute", title: `Execute ${p.name}?`, text: `There is no undoing it. Everyone here takes it hard (mood ${E.mood}; Brave or Tough ${E.hardened}, a Former Medic ${E.soft}). Goodwill ${E.goodwill} with ${E.group || "their group"} and ${E.others} with ${E.known} other group${E.known === 1 ? "" : "s"} you know; infamy +${E.infamy}. The others held here are cowed for ${E.fearDays} days.`, yes: "Execute" };
}
export const PRISON_ACTIONS = {
  "pr-guard-toggle": (state, ui, d) => done(ui, toggleJailGuard(state, baseById(state, Number(d.base)), d.id)),
  "pr-guard-fill": (state, ui, d) => { const b = baseById(state, Number(d.base)); if (b) done(ui, fillJailGuards(state, b)); },
  "pr-question": (state, ui, d) => done(ui, questionPrisoner(state, d.id, d.method === "rough" ? "rough" : "talk")),
  "pr-ask": (state, ui, d) => done(ui, askToJoin(state, d.id)),
  "pr-ransom": (state, ui, d) => done(ui, askRansom(state, d.id)),
  "pr-tradeback": (state, ui, d) => done(ui, tradeBack(state, d.id)),
  "pr-release": (state, ui, d) => { const p = heldBy(state, d.id); if (p && ask(ui, d, "pr-release", releaseQ(state, p))) return; done(ui, releasePrisoner(state, d.id)); },
  "pr-mode": (state, ui, d) => done(ui, setMode(state, d.id, d.mode)),
  "pr-move": (state, ui, d) => done(ui, movePrisoner(state, d.id, d.base)),
  "pr-execute": (state, ui, d) => {
    const p = heldBy(state, d.id);
    if (p && ask(ui, d, "pr-execute", executeQ(state, p))) return;
    done(ui, executePrisoner(state, Number(d.id)));
  },
};
// The selects: rations and work, one prisoner or everyone at the base.
export const PRISON_CHANGE = {
  "pr-guard-add": (state, ui, el) => { if (el.value) done(ui, toggleJailGuard(state, baseById(state, Number(el.dataset.base)), el.value)); },
  "pr-ration": (state, ui, el) => done(ui, setRation(state, el.dataset.id, el.value)),
  "pr-ration-all": (state, ui, el) => { if (el.value) done(ui, setAllRations(state, el.dataset.base, el.value)); },
  "pr-task": (state, ui, el) => done(ui, setTask(state, el.dataset.id, el.value)),
  "pr-task-all": (state, ui, el) => { if (el.value) done(ui, setAllTasks(state, el.dataset.base, el.value)); },
};

// One line for a team panel: prisoners walking with the team.
export function teamPrisonersLine(state, p) {
  const list = (state.prisoners || []).filter((x) => x.at.kind === "party" && x.at.partyId === p.id);
  if (!list.length) return "";
  return `${list.length} prisoner${list.length === 1 ? "" : "s"} (${list.map((x) => x.name).join(", ")})${p.prisonSpeed ? `, the team walks at ${Math.round(p.prisonSpeed * 100)}%` : ""}; caught on day ${Math.min(...list.map((x) => x.caught))}, today is day ${day(state)}`;
}
