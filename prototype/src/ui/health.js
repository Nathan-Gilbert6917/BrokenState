// Illness and injuries in the UI: condition chips (People tab, survivor screen), the Medical tab's list with a
// Treat button per condition, the base's care settings (automatic care, meds reserve, admit line, medic time),
// and per patient: bed status, health per day and when they can next be treated. Actions are merged into main.js
// (HEALTH_ACTIONS, HEALTH_CHANGE).
import { CONDITIONS, conditionsOf, conditionTip, treatConditionInfo, treatCondition, autoTreatOn, workFactor, isSick, medsToTreatAll } from "../sim/health.js";
import { baseById, residents, day } from "../sim/world.js";
import {
  admitBelow, medsReserve, medicTime, bedReason, dailyHealthChange, autoCare, treatAtBaseInfo, isHurt, nextDayText,
  AUTO_BELOW, ADMIT_MIN, ADMIT_MAX, ADMIT_STEP, TREATS_PER_MEDIC, UNTRAINED_TREATS, SURGERY_LOAD,
} from "../sim/medical.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const sign = (v) => `${v >= 0 ? "+" : "−"}${n1(Math.abs(v))}`;
const noDot = (t) => String(t || "").replace(/\.$/, "");

export { isSick };

// Chips for someone's conditions (empty string when well).
export function conditionChips(state, s) {
  const list = conditionsOf(s);
  if (!list.length) return "";
  const wf = workFactor(s);
  return list.map((c) => `<span class="chip off"${tip(conditionTip(state, s, c))}>${esc(CONDITIONS[c.key].name)} ${Math.round(c.sev)}</span>`).join("") +
    (wf < 1 ? `<span class="chip"${tip("How much of a normal day's work they can do while ill or hurt")}>works at ${Math.round(wf * 100)}%</span>` : "");
}

// Medical tab: Treat buttons per condition for someone at this base.
export function conditionTreatRow(state, b, s) {
  const list = conditionsOf(s);
  if (!list.length) return "";
  return `<div class="row small" style="flex-wrap:wrap">${list.map((c) => {
    const info = treatConditionInfo(state, b, s, c.key);
    const d = CONDITIONS[c.key];
    const by = info.medic ? `${info.medic.name.split(" ")[0]}'s` : "a medic's";
    return `<span class="chip off"${tip(conditionTip(state, s, c))}>${esc(d.name)} ${Math.round(c.sev)}</span><button class="mini" data-action="treatcond" data-base="${b.id}" data-id="${s.id}" data-key="${c.key}" ${info.ok ? "" : "disabled"}${tip(info.ok ? `Use ${info.cost} of ${b.name}'s meds and one of ${by} treatments for today: takes about ${info.amount} off the severity${info.cures ? " (enough to end it)" : ""}. Once a day per condition.` : info.reason)}>Treat (${d.meds} meds)</button>`;
  }).join(" ")}</div>`;
}

// Medical tab: the base's care settings (one rule for every automatic dose), medic time today, and the illness
// summary.
const RESERVE_STEPS = [0, 2, 4, 6, 10, 15, 20];
export function illnessCard(state, b) {
  const sick = residents(state, b.id).filter(isSick);
  const contagious = sick.filter((s) => conditionsOf(s).some((c) => CONDITIONS[c.key].spread > 0)).length;
  const q = (b.quarantineUntil || 0) >= day(state);
  const reserve = medsReserve(b);
  const admit = admitBelow(b);
  const admitSteps = [];
  for (let v = ADMIT_MIN; v <= ADMIT_MAX; v += ADMIT_STEP) admitSteps.push(v);
  if (!admitSteps.includes(admit)) admitSteps.push(admit);
  admitSteps.sort((x, y) => x - y);
  const time = medicTime(state, b);
  const plan = autoCare(state, b, { plan: true });
  const who = time.list.map((t) => `${t.s.name.split(" ")[0]} ${t.used}/${t.cap}`).join(", ");
  const tonight = plan.off ? "Automatic care is off."
    : plan.list.length ? `Tonight: ${plan.list.length} treatment${plan.list.length === 1 ? "" : "s"}, ${plan.meds} meds${plan.skipped.length ? `; ${plan.skipped.length} waiting (reserve, meds or medic time)` : ""}.`
    : plan.skipped.length ? `Tonight: nothing (${noDot(plan.skipped[0].reason)}).` : "Tonight: nobody needs treatment.";
  return `<h3>Care settings</h3>
    <div class="card small">
      <label style="display:block"${tip(`Each night the injured and sick here are treated with base meds, worst off first: wounds below ${AUTO_BELOW} health or infected, and illnesses that matter. Every automatic dose keeps the reserve below and needs a medic's time. Off: only the treatments you give.`)}><input type="checkbox" data-action="health-auto" data-base="${b.id}" ${autoTreatOn(b) ? "checked" : ""}> Automatic care each night</label>
      <div style="margin-top:0.3rem"${tip("Automatic care never takes the meds below this. Your own Treat buttons can still use them.")}>Keep <select data-action="health-reserve" data-base="${b.id}">${RESERVE_STEPS.map((v) => `<option value="${v}" ${reserve === v ? "selected" : ""}>${v}</option>`).join("")}${RESERVE_STEPS.includes(reserve) ? "" : `<option value="${reserve}" selected>${reserve}</option>`}</select> meds in reserve</div>
      <div style="margin-top:0.3rem"${tip("Who takes a hospital bed: people below this health, and anyone with a severe (below 30) or infected wound or too ill to work, worst off first. Everyone else keeps working and heals slowly. 100 = anyone hurt.")}>Admit below <select data-action="health-admit" data-base="${b.id}">${admitSteps.map((v) => `<option value="${v}" ${admit === v ? "selected" : ""}>${v}</option>`).join("")}</select> health to a bed</div>
      <div style="margin-top:0.3rem"${tip(`Each treatment (a wound, or one illness) takes a medic's time: ${TREATS_PER_MEDIC} + Medicine/4 a day per person on the Medic role (less while ill). With nobody on the role, the best at Medicine here gives ${UNTRAINED_TREATS} a day between other work. Surgery takes ${SURGERY_LOAD} from one medic. Resets at midnight.`)}>Medic time today: ${time.cap ? `${time.used} of ${time.cap} treatments given${who ? ` <span class="muted">(${esc(who)}${time.trained ? "" : "; nobody on the Medic role"})</span>` : ""}` : `<span class="danger">nobody can treat</span>`}</div>
      <div class="muted" style="margin-top:0.3rem">${esc(tonight)}</div>
    </div>
    <h3>Illness</h3>
    <div class="card small">
      <div>${sick.length ? `${sick.length} ill or injured${contagious ? `, <span class="danger">${contagious} contagious</span>` : ""}${q ? " · quarantine on" : ""} · ${medsToTreatAll(state, b)} meds to treat everyone once` : "<span class='muted'>Nobody here is ill or injured.</span>"}</div>
      <div class="muted" style="margin-top:0.3rem">Work brings cuts and sprains, cold and heat bring flu and fever, dirty water dysentery (a water filter helps), hunger and thirst weaken everyone, and flu, dysentery and pneumonia spread in a crowded base. Rest and a hospital bed speed recovery.</div>
    </div>`;
}

// Medical tab, per patient: the bed chip with the reason they are (or are not) in one.
export function bedChip(state, b, s, h, inBed) {
  const why = bedReason(state, b, s);
  if (inBed) return `<span class="chip on"${tip(`In a hospital bed (${why}): gets the bed healing bonus and +3 mood a day, but does not work their role. Leaves the bed at ${admitBelow(b)}+ health once nothing else keeps them there.`)}>In bed</span>`;
  if (!h.beds) return "";
  if (s.role === "medic" && s.location.kind === "base") return `<span class="chip"${tip("Medics stay on duty and are never admitted as patients")}>On duty</span>`;
  if (why) return `<span class="chip off"${tip(`Needs a bed (${why}), but all ${h.beds} are taken by people worse off`)}>No free bed</span>`;
  return `<span class="chip"${tip(`Not admitted: at or above the admit line (${admitBelow(b)} health) and well enough to work. Keeps working and heals slowly.`)}>Working</span>`;
}

// Medical tab, per patient: health per day as it will really go (passive healing, tonight's automatic treatment,
// illness), with what is in the number (P-21). Pass `plan` (autoCare plan) to share one across the list.
export function healPerDayText(state, b, s, h, inBed, plan = null) {
  const r = dailyHealthChange(state, b, s, { hosp: h, inBed, plan });
  const parts = [`passive ${sign(r.passive)}`];
  if (r.treat) parts.push(`tonight's treatment ${sign(r.treat)}`);
  if (r.illness) parts.push(`illness ${sign(-r.illness)}`);
  const ill = r.illness ? `, illness ${sign(-r.illness)}` : "";
  let note;
  if ((b.hungerDays || 0) > 0 || (b.thirstDays || 0) > 0) note = "nobody heals while the base is out of food or water";
  else if (r.treat) note = `incl. ${sign(r.treat)} from tonight's treatment${ill}`;
  else if (!isHurt(s)) note = r.illness ? `illness ${sign(-r.illness)}` : "not hurt";
  else if (r.off) note = `automatic care is off${ill}`;
  else if (s.health >= AUTO_BELOW && !s.woundInfected) note = `no automatic treatment at ${AUTO_BELOW}+ health${ill}`;
  else note = `no treatment tonight: ${noDot(r.skipped || "not planned").toLowerCase()}${ill}`;
  const capped = r.total < r.passive + r.treat - r.illness - 1e-9;
  return `${sign(r.total)} health/day <span${tip(`Over the next day: ${parts.join(", ")}${capped ? " (capped at 100)" : ""}.`)}>(${esc(note)})</span>`;
}

// Medical tab, per patient: when they can next be treated (wound and each illness) and why not now.
export function nextTreatLine(state, b, s) {
  const bits = [];
  if (isHurt(s)) {
    const info = treatAtBaseInfo(state, b, s);
    bits.push(info.ok ? `Wound: can be treated now${info.noSurgeryTime ? " (no medic has time for surgery today)" : ""}` : info.treatedToday ? `Wound: treated today, next ${nextDayText(state)}` : `Wound: ${noDot(info.reason)}`);
  }
  for (const c of conditionsOf(s)) {
    if (c.treatedDay === day(state)) bits.push(`${CONDITIONS[c.key].name}: treated today, next ${nextDayText(state)}`);
  }
  return bits.length ? `<div class="small muted">${esc(bits.join(" · "))}</div>` : "";
}

const baseOf = (state, d) => baseById(state, Number(d.base));
export const HEALTH_ACTIONS = {
  treatcond: (state, ui, d) => {
    const b = baseOf(state, d);
    if (!b) return;
    const msg = treatCondition(state, b, Number(d.id), d.key);
    if (ui.baseView) ui.baseMsg = msg;
    else state.log.unshift({ hour: state.hour, text: msg, kind: "info" });
  },
  "health-auto": (state, ui, d) => {
    const b = baseOf(state, d);
    if (!b) return;
    b.autoTreat = !autoTreatOn(b);
    ui.baseMsg = b.autoTreat ? `The injured and sick at ${b.name} are treated automatically each night, keeping ${medsReserve(b)} meds in reserve.` : "Only the treatments you give.";
  },
};
export const HEALTH_CHANGE = {
  "health-reserve": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) b.medsReserve = Math.max(0, Number(el.value) || 0); },
  "health-admit": (state, ui, el) => {
    const b = baseOf(state, el.dataset);
    if (!b) return;
    const v = Number(el.value);
    b.admitBelow = Number.isFinite(v) && v > 0 ? Math.max(ADMIT_MIN, Math.min(ADMIT_MAX, v)) : admitBelow(b);
    ui.baseMsg = `Hospital beds at ${b.name} go to people below ${b.admitBelow} health, and to anyone with a severe or infected wound or too ill to work.`;
  },
};
