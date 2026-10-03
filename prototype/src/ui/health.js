// Illness and injuries in the UI: condition chips (People tab, survivor screen), the Medical tab's list with a
// Treat button per condition, and the base's automatic treatment setting. Actions are merged into main.js
// (HEALTH_ACTIONS, HEALTH_CHANGE).
import { CONDITIONS, conditionsOf, conditionTip, treatConditionInfo, treatCondition, autoTreatOn, workFactor, isSick, medsToTreatAll } from "../sim/health.js";
import { baseById, residents } from "../sim/world.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");

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
    return `<span class="chip off"${tip(conditionTip(state, s, c))}>${esc(d.name)} ${Math.round(c.sev)}</span><button class="mini" data-action="treatcond" data-base="${b.id}" data-id="${s.id}" data-key="${c.key}" ${info.ok ? "" : "disabled"}${tip(info.ok ? `Use ${info.cost} of ${b.name}'s meds: takes about ${info.amount} off the severity${info.cures ? " (enough to end it)" : ""}. Once a day per condition.` : info.reason)}>Treat (${d.meds} meds)</button>`;
  }).join(" ")}</div>`;
}

// Medical tab: the base's illness setting and a summary.
export function illnessCard(state, b) {
  const sick = residents(state, b.id).filter(isSick);
  const contagious = sick.filter((s) => conditionsOf(s).some((c) => CONDITIONS[c.key].spread > 0)).length;
  const q = (b.quarantineUntil || 0) >= Math.floor(state.hour / 24) + 1;
  return `<h3>Illness</h3>
    <div class="card small">
      <div>${sick.length ? `${sick.length} ill or injured${contagious ? `, <span class="danger">${contagious} contagious</span>` : ""}${q ? " · quarantine on" : ""} · ${medsToTreatAll(state, b)} meds to treat everyone once` : "<span class='muted'>Nobody here is ill or injured.</span>"}</div>
      <label style="display:block;margin-top:0.3rem"${tip("Each night the sick and injured here are treated with base meds, worst first: anything that can kill always, the rest only while more than the reserve is left.")}><input type="checkbox" data-action="health-auto" data-base="${b.id}" ${autoTreatOn(b) ? "checked" : ""}> Treat the sick automatically</label>
      <div style="margin-top:0.3rem"${tip("Meds the automatic treatment leaves alone (except for anything life-threatening)")}>Keep <select data-action="health-reserve" data-base="${b.id}">${[0, 2, 4, 6, 10, 15, 20].map((v) => `<option value="${v}" ${(b.medsReserve || 0) === v ? "selected" : ""}>${v}</option>`).join("")}${[0, 2, 4, 6, 10, 15, 20].includes(b.medsReserve || 0) ? "" : `<option value="${b.medsReserve}" selected>${b.medsReserve}</option>`}</select> meds in reserve</div>
      <div class="muted" style="margin-top:0.3rem">Work brings cuts and sprains, cold and heat bring flu and fever, dirty water dysentery (a water filter helps), hunger and thirst weaken everyone, and flu, dysentery and pneumonia spread in a crowded base. Rest and a hospital bed speed recovery.</div>
    </div>`;
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
  "health-auto": (state, ui, d) => { const b = baseOf(state, d); if (b) { b.autoTreat = !autoTreatOn(b); ui.baseMsg = b.autoTreat ? "The sick are treated automatically each night." : "Only the treatments you give."; } },
};
export const HEALTH_CHANGE = {
  "health-reserve": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) b.medsReserve = Number(el.value) || 0; },
};
