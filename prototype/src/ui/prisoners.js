// The Prisoners tab of a base (sim/prisoners.js): who is held here, in a cell or a shed, what they eat and do, and
// what to do with each: rations, labour, question (or roughly), ask to join, win over, ransom, trade back, release,
// execute. A summary on top: food a day at their rations, labour by task, guards and the day's escape risk.
import { SKILL_NAMES, TRAITS, FACTION_TYPES } from "../sim/data.js";
import { day } from "../sim/world.js";
import { CONQUEST } from "../sim/conquest.js";
import { teamName } from "../sim/parties.js";
import { WEAR } from "../sim/breakdowns.js";
import {
  PRISON, TASKS, prisonersAt, cellCap, prisonerView, prisonSummary, tasksAt, guardsAt, questionPrisoner, askRansom,
  tradeBack, releasePrisoner, setMode, executePrisoner, askToJoin, setRation, setAllRations, setTask, setAllTasks,
} from "../sim/prisoners.js";
import { wormOthersAt, WORM } from "../sim/worm.js"; // the worm in a prisoner: spotted, treated like a resident
import { otherWormRow } from "./health.js";

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
const TASKS_TIP = `Labour: out of the cell 07–19 at ${pctTxt(L.min)}–${pctTxt(L.max)} of a survivor (${pctTxt(L.perSkill)} a point of the task's skill) × rations × health (too weak under ${L.minHealth}). ${Object.entries(TASKS).filter(([k]) => k !== "idle").map(([, t]) => `${t.name}${t.skill ? ` (${SKILL_NAMES[t.skill]})` : ""}: ${t.out}.`).join(" ")} A guard watches up to ${L.guardWatch} at work: watched they escape ${pctTxt(L.escapeGuarded)} a day, unwatched ${pctTxt(L.escapeUnguarded)}. Work tires them (mood, and health on Short or less). Days of good work make them easier to win over.`;

function rationOptions(cur, all = false) {
  return (all ? `<option value="">Set all…</option>` : "") + Object.entries(R).map(([k, r]) => `<option value="${k}"${!all && k === cur ? " selected" : ""}>${esc(r.name)} (${n1(r.share * PRISON.FOOD)})</option>`).join("");
}
function taskOptions(state, base, cur, all = false) {
  const ok = tasksAt(state, base);
  return (all ? `<option value="">Set all…</option>` : "") + Object.entries(TASKS).filter(([k]) => ok.includes(k) || k === cur).map(([k, t]) => `<option value="${k}"${!all && k === cur ? " selected" : ""}>${esc(t.name)}</option>`).join("");
}

export function prisonTab(state, base, ui) {
  const list = prisonersAt(state, base.id);
  const cap = cellCap(base);
  const guards = guardsAt(state, base);
  const shed = Math.max(0, list.length - cap);
  const out = (state.prisoners || []).filter((p) => p.at.kind === "party" && (() => { const t = state.parties.find((x) => x.id === p.at.partyId); return t && t.homeBaseId === base.id; })());
  let html = `<h3>Prisoners at ${esc(base.name)}</h3>
    <div class="small muted">Holding cells: ${list.length - shed} of ${cap} used${shed ? `, <span class="warn">${shed} in a shed (${pctTxt(PRISON.ESCAPE.shed)} a day to escape)</span>` : ""}${cap ? "" : " (build Holding cells: 3 prisoners each)"}.
      On guard: ${guards.length ? esc(guards.map((s) => s.name).join(", ")) : `<span class="warn">nobody</span> (escapes ${pctTxt(PRISON.ESCAPE.unguarded)} a day instead of ${pctTxt(PRISON.ESCAPE.guarded)}; set someone's role to Guard)`}.</div>`;
  if (out.length) html += `<div class="small" style="margin-top:0.3rem">On the way here: ${esc(out.map((p) => `${p.name} (with ${teamName(state, state.parties.find((x) => x.id === p.at.partyId))})`).join(", "))}.</div>`;
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
  const unwatched = w.workers.length - w.watched.size;
  const shelterNote = tasksAt(state, base).length < Object.keys(TASKS).length ? ` A shelter has less to do: ${Object.entries(TASKS).filter(([k]) => !tasksAt(state, base).includes(k)).map(([, t]) => t.name).join(", ")} not here.` : "";
  return `<div class="card" style="margin-top:0.5rem">
    <div class="spread"><b>${list.length} held</b><span class="small muted">day ${day(state)}</span></div>
    <div class="small"${tip("Food a day for the prisoners at their rations (× the cold), counted in the base's food line (upkeep.js). Water is the same for everyone (× the day's thirst).")}>Food: <b>${n1(s.food)}</b> a day at their rations${s.fullFood - s.food > 0.05 ? ` (saves ${n1(s.fullFood - s.food)} against Full)` : ""}; water ${n1(s.water)} a day.</div>
    <div class="small"${tip(TASKS_TIP)}>Labour: ${w.workers.length ? `${w.workers.length} out at work, ${w.watched.size} watched by ${w.guards} guard${w.guards === 1 ? "" : "s"} (each watches ${L.guardWatch})${unwatched ? `, <span class="warn">${unwatched} unwatched (${pctTxt(L.escapeUnguarded)} a day to run)</span>` : ""}. ${esc(lab.join("; ") || "nothing to show yet")}.` : "everyone is in the cells."}${esc(shelterNote)}</div>
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
  const traits = (s.traits || []).map((t) => (TRAITS[t] ? TRAITS[t].name : t)).join(", ");
  const kind = KIND[p.kit] || "Fighter";
  const where = v.cell ? (v.guarded ? "In a cell, guarded" : "In a cell, unguarded") : "In a shed (no free cell)";
  const opinion = Math.max(0, Math.min(100, Math.round(p.opinion)));
  const ransom = p.ransom ? `Ransom asked: ${p.ransom.qty} ${p.ransom.key}, answer due on day ${p.ransom.due}.` : "";
  const confirm = ui.prisonConfirm === p.id;
  const Q = PRISON.QUESTION, RQ = Q.rough;
  const qWhat = p.intelDone ? "Again: where their parties (raids too) and the hives near them are now." : "First answers: their bases, people and stock, their parties out (raids too), hives near them (onto your map).";
  const qTip = v.question.ok ? `Question ${p.name}: ${pctTxt(v.question.odds)} to get answers (the best talker's Speech +${pctTxt(Q.speech)} a point, the leader's Leadership +${pctTxt(Q.lead)}; zealots and soldiers say less; hunger loosens tongues: Starvation +${pctTxt(R.starve.question)}, None +${pctTxt(R.none.question)}). ${qWhat} Sours them (${Q.sour}).` : `Questioned on day ${p.questioned}: again from day ${p.questioned + Q.every}.`;
  const roughTip = v.question.ok ? `Question ${p.name} roughly: ${pctTxt(v.question.rough)} (+${pctTxt(RQ.odds)}). Costs: their health ${RQ.health} and mood ${RQ.mood}, opinion ${RQ.sour}; everyone here ${RQ.baseMood} mood (a Former Medic ${RQ.soft}, the Brave and Tough nothing); goodwill ${RQ.goodwill} with ${f ? f.name : "their group"}. ${qWhat}` : qTip;
  const rTip = v.ransom ? `Ask ${f ? f.name : p.group} for ${v.ransom.qty} ${v.ransom.key} (worth about ${v.ransom.value}). They answer in ${PRISON.RANSOM.days[0]}–${PRISON.RANSOM.days[1]} days: pay (goodwill ${PRISON.RANSOM.goodwillPaid}) or refuse (goodwill ${PRISON.RANSOM.goodwillRefused}, and a rescue raid becomes twice as likely for ${PRISON.RANSOM.angryDays} days).` : "Their group is gone: nobody to pay.";
  const rateTxt = p.mode === "recruit" ? `Winning them over: ${opinion}/100, about +${v.rate.toFixed(1)} a day${v.rate > 0 ? ` (≈${Math.ceil((100 - p.opinion) / Math.max(0.1, v.rate))} days)` : ""}.` : `Opinion of you: ${opinion}/100.`;
  const A = PRISON.ASK;
  const askTip = v.ask.ok ? `Ask ${p.name} to join now: ${pctTxt(v.ask.odds)}. By their opinion of you (from ${A.from}, +${pct1(1 / A.span)} a point above it; ${opinion} now), who they were (zealots ×${A.kind.zealots}, soldiers ×${A.kind.soldiers}, a loner ×${A.kind.none}), the leader's Leadership and the best talker's Speech (+${pct1(A.lead)} a point each), rations (Full +${pctTxt(R.full.ask)}, Starvation ${pctTxt(R.starve.ask)}, None ${pctTxt(R.none.ask)}), weeks of good work (+${pct1(L.askPerDay)} a day, up to +${pctTxt(L.askMax)}: ${p.labourDays || 0} days so far) and their mood. Raise it: time on Win them over, Full rations, labour, a leader with Leadership. No: opinion ${A.fail}, ask again in ${A.gap} days.` : `Asked on day ${p.asked}: again from day ${p.asked + A.gap}.`;
  const E = v.execute;
  const exTip = `Execute ${p.name}. Everyone here takes it hard: mood ${E.mood} (Brave or Tough ${E.hardened}, a Former Medic ${E.soft}). Goodwill ${E.goodwill} with ${E.group || "their group"} and ${E.others} with ${E.known} other group${E.known === 1 ? "" : "s"} you know. Infamy +${E.infamy} (now ${Math.round(E.infamyNow)}; above ${CONQUEST.INFAMY.wary} peaceful groups cool toward you). The others held here are cowed for ${E.fearDays} days (escapes ×${E.fear}, mood ${E.fearMood}).${confirm ? " Click again to do it." : ""}`;
  const workTxt = v.task === "idle" ? "in the cell" : v.work > 0 ? `${pctTxt(v.work)} of a survivor, ${v.watched ? "watched" : '<span class="warn">unwatched</span>'}` : `<span class="warn">not working</span> (${s.health < L.minHealth ? "too weak" : "nothing to do here now"})`;
  const hp = Math.round(s.health);
  const wo = wormOthersAt(state, base).find((x) => x.kind === "prisoner" && x.p === p);
  const worm = wo ? otherWormRow(state, base, wo) : ""; // "" until it is spotted
  const cured = p.wormTreated && f ? WORM.OTHERS.RETURN_GOODWILL : 0; // treated for the worm: their group remembers it
  return `<div class="card" style="margin-top:0.5rem">
    <div class="spread"><b>${esc(p.name)}</b><span class="small muted">${esc(kind)} of ${esc(p.group)}${f ? ` (${esc(FACTION_TYPES[f.type].label)})` : ""} · held ${v.days} day${v.days === 1 ? "" : "s"}</span></div>
    <div class="small">${esc(where)} · <span class="${hp < 30 ? "danger" : hp < 50 ? "warn" : ""}">health ${hp}</span> · mood ${Math.round(s.mood)} · ${esc(top)}${traits ? ` · ${esc(traits)}` : ""}${p.unfed ? ` · <span class="danger">unfed ${p.unfed} day${p.unfed === 1 ? "" : "s"}</span>` : ""}</div>
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
      <button class="mini" data-action="pr-ransom" data-id="${p.id}" ${v.ransom && !p.ransom ? "" : "disabled"}${tip(rTip)}>Ask a ransom${v.ransom ? ` (${v.ransom.qty} ${esc(v.ransom.key)})` : ""}</button>
      <button class="mini" data-action="pr-tradeback" data-id="${p.id}" ${f ? "" : "disabled"}${tip(f ? `Send ${p.name} back to ${f.name} unharmed: goodwill +${PRISON.TRADE_BACK + cured}${cured ? " (+" + cured + " for treating their worm)" : ""}.` : "Their group is gone.")}>Trade back (+${PRISON.TRADE_BACK + cured})</button>
      <button class="mini" data-action="pr-release" data-id="${p.id}"${tip(`Let ${p.name} go${f ? `: they head back to ${f.name} (goodwill +${PRISON.RELEASE + cured}${cured ? ", " + cured + " of it for treating their worm" : ""})` : ""}.`)}>Release</button>
      <button class="mini ${confirm ? "danger" : ""}" data-action="pr-execute" data-id="${p.id}"${tip(exTip)}>${confirm ? "Really execute?" : "Execute"}</button>
    </div>
    <div class="small muted" style="margin-top:0.2rem">Rough questioning: their health ${RQ.health}, your people's mood ${RQ.baseMood}, goodwill ${RQ.goodwill}. Execute: mood ${E.mood} here, goodwill ${E.goodwill}${E.group ? ` with ${esc(E.group)}` : ""} and ${E.others} with ${E.known} other${E.known === 1 ? "" : "s"}, infamy +${E.infamy}.</div>
  </div>`;
}

const done = (ui, text) => { ui.baseMsg = text || ""; ui.prisonConfirm = null; };
export const PRISON_ACTIONS = {
  "pr-question": (state, ui, d) => done(ui, questionPrisoner(state, d.id, d.method === "rough" ? "rough" : "talk")),
  "pr-ask": (state, ui, d) => done(ui, askToJoin(state, d.id)),
  "pr-ransom": (state, ui, d) => done(ui, askRansom(state, d.id)),
  "pr-tradeback": (state, ui, d) => done(ui, tradeBack(state, d.id)),
  "pr-release": (state, ui, d) => done(ui, releasePrisoner(state, d.id)),
  "pr-mode": (state, ui, d) => done(ui, setMode(state, d.id, d.mode)),
  "pr-execute": (state, ui, d) => {
    const id = Number(d.id);
    if (ui.prisonConfirm !== id) { ui.prisonConfirm = id; ui.baseMsg = "Click Execute again to confirm."; return; }
    done(ui, executePrisoner(state, id));
  },
};
// The selects: rations and work, one prisoner or everyone at the base.
export const PRISON_CHANGE = {
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
