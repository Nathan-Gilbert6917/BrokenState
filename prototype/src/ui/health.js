// Illness and injuries in the UI: condition chips (People tab, survivor screen), the Medical tab's list with a
// Treat button per condition, the base's care settings (automatic care, meds reserve, admit line, medic time),
// and per patient: bed status, health per day and when they can next be treated. Actions are merged into main.js
// (HEALTH_ACTIONS, HEALTH_CHANGE).
import {
  CONDITIONS, conditionsOf, conditionTip, treatConditionInfo, treatCondition, autoTreatOn, workFactor, isSick as hasCondition, medsToTreatAll,
  daysLeftText, courseText, needsDose, fieldDoseInfo, treatConditionAnywhere, sickMedsWeek, illnessRisk, baseRiskCtx, isIll, teamMeds,
} from "../sim/health.js";
import { wormSeen, wormOf, wormLabel, wormTip, wormTreatInfo, treatWorm, baseWater, WORM, wormCureText, wormOthersSeen, otherTreatInfo, treatOtherWorm, othersCareOn, dayHp } from "../sim/worm.js";
import { boilerJunkOn } from "../sim/woodcutting.js"; // the base's "Boiler may burn spare wooden items and paper"
import { baseById, residents, day } from "../sim/world.js";
import {
  admitBelow, medsReserve, medicTime, bedReason, dailyHealthChange, autoCare, treatAtBaseInfo, isHurt, nextDayText,
  AUTO_BELOW, ADMIT_MIN, ADMIT_MAX, ADMIT_STEP, TREATS_PER_MEDIC, UNTRAINED_TREATS, SURGERY_LOAD,
} from "../sim/medical.js";
import { contactable } from "../sim/orders.js";
import { commandable } from "../sim/plans.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const sign = (v) => `${v >= 0 ? "+" : "−"}${n1(Math.abs(v))}`;
const noDot = (t) => String(t || "").replace(/\.$/, "");
const pct = (p) => `${Math.round(p * 1000) / 10}%`;

// Ill, hurt by a condition, or known to carry the worm (sim/worm.js: only once it has been spotted).
export const isSick = (s) => hasCondition(s) || wormSeen(s);

// The worm's chip, once it has been spotted (sim/worm.js).
export const wormChip = (state, s) => (wormSeen(s) ? `<span class="chip off"${tip(`${wormTip(state, s)} If they die, they get up as one of the dead.`)}>${esc(wormLabel(s))}</span>` : "");

// One condition as a chip: its icon, name and days left ("🤒 Flu · 4 days left"), the course in the tooltip.
export function condChip(state, s, c) {
  const d = CONDITIONS[c.key];
  if (!d) return "";
  const left = daysLeftText(state, s, c);
  return `<span class="chip ${c.mending ? "" : "off"}"${tip(conditionTip(state, s, c))}>${d.icon || ""} ${esc(d.name)} · ${esc(left)}${c.mending ? " · mending" : c.course != null ? ` · dose ${c.dosed}/${c.course}` : ""}</span>`;
}

// The Treat button for one condition wherever the person is: their base's meds (a medic's time too) or their team's
// (the best at Medicine gives it; the team must be in contact). "" when there is nothing to do from here.
export function condTreatButton(state, s, c) {
  if (!needsDose(c)) return "";
  const d = CONDITIONS[c.key];
  if (s.location.kind === "party") {
    const p = state.parties.find((x) => x.id === s.location.partyId);
    if (!p || p.owner !== "player" || !contactable(p) || !commandable(state, p)) return "";
    const info = fieldDoseInfo(state, p, s, c.key);
    const effect = d.cure ? `cures the ${d.name.toLowerCase()} at once (optional: it passes on its own in a few days)${info.medic ? ` (${info.medic.name.split(" ")[0]} gives it)` : ""}.` : `takes about ${info.amount} off the severity${info.medic ? ` (${info.medic.name.split(" ")[0]} gives it)` : ""}. Dose ${info.dose} of ${info.course}: once a day, and it stops worsening.`;
    return `<button class="mini" data-action="treatcond-any" data-id="${s.id}" data-key="${c.key}" ${info.ok ? "" : "disabled"}${tip(info.ok ? `Give a dose from the team's meds (${Math.floor(teamMeds(p))} carried): 1 meds, ${effect}` : info.reason)}>Treat (1 meds)</button>`;
  }
  const b = s.location.kind === "base" ? baseById(state, s.location.baseId) : null;
  if (!b) return "";
  const info = treatConditionInfo(state, b, s, c.key);
  const by = info.medic ? `${info.medic.name.split(" ")[0]}'s` : "a medic's";
  const effect = d.cure ? `cures the ${d.name.toLowerCase()} at once (optional: it passes on its own in a few days; automatic care leaves it alone).` : `takes about ${info.amount} off the severity${info.cures ? " (enough to end it)" : ""}. Dose ${info.dose} of ${info.course}: once a day, and it stops worsening.`;
  return `<button class="mini" data-action="treatcond" data-base="${b.id}" data-id="${s.id}" data-key="${c.key}" ${info.ok ? "" : "disabled"}${tip(info.ok ? `Use ${info.cost} of ${b.name}'s meds and one of ${by} treatments for today: ${effect}` : info.reason)}>Treat (${d.meds} meds)</button>`;
}

// Chips for someone's conditions (empty string when well), with Treat buttons when treat is on.
export function conditionChips(state, s, { treat = true } = {}) {
  const list = conditionsOf(s);
  if (!list.length && !wormSeen(s)) return "";
  const wf = workFactor(s);
  return wormChip(state, s) + list.map((c) => `${condChip(state, s, c)}${treat ? condTreatButton(state, s, c) : ""}`).join(" ") +
    (wf < 1 ? `<span class="chip"${tip("How much of a normal day's work they can do while ill or hurt")}>works at ${Math.round(wf * 100)}%</span>` : "");
}

// Medical tab: the worm's treatments for someone at this base (a dewormer, a purge, surgery), once it is spotted.
function wormTreatRow(state, b, s) {
  if (!wormSeen(s)) return "";
  const w = wormOf(s);
  const kinds = w.stage === "gut" ? ["dewormer", "purge"] : ["surgery"];
  const label = { dewormer: "Dewormer", purge: `Purge (${WORM.PURGE_MEDS} meds)`, surgery: `Surgery (${WORM.SURGERY_MEDS} meds)` };
  const what = {
    dewormer: () => `Give ${s.name.split(" ")[0]} a dewormer from ${b.name}'s armory: a sure cure while the worm is in the gut. No medic needed.`,
    purge: (i) => `Use ${WORM.PURGE_MEDS} of ${b.name}'s meds and one of ${i.treater ? `${i.treater.s.name.split(" ")[0]}'s` : "a medic's"} treatments: ${Math.round(i.chance * 100)}% it passes the worm (costs ${WORM.PURGE_HP} health), otherwise it holds on (−${WORM.PURGE_FAIL_HP}; try again tomorrow). Better Medicine and a hospital raise the odds.`,
    surgery: (i) => `Cut the larvae out (${WORM.SURGERY_MEDS} meds, most of ${i.treater ? `${i.treater.s.name.split(" ")[0]}'s` : "a medic's"} day): ${Math.round(i.chance * 100)}% they live (at a heavy cost in health); otherwise they die on the table.`,
  };
  return `<div class="row small" style="flex-wrap:wrap">${wormChip(state, s)}${kinds.map((k) => {
    const info = wormTreatInfo(state, b, s, k);
    return `<button class="mini" data-action="treatworm" data-base="${b.id}" data-id="${s.id}" data-kind="${k}" ${info.ok ? "" : "disabled"}${tip(info.ok ? what[k](info) : info.reason)}>${label[k]}</button>`;
  }).join(" ")}<span class="muted">${esc(wormCureText(s))}</span></div>`;
}

// The worm in a prisoner or a guest (sim/worm.js wormOthersAt: o), once spotted: its chip and the three treatments,
// as for a resident. Treating a guest wins their group's goodwill; a prisoner's opinion of you rises.
export function otherWormRow(state, b, o) {
  if (!o || o.w.seen == null) return "";
  const w = o.w;
  const O = WORM.OTHERS;
  const d = Math.max(1, w.day);
  const label = `Infected (day ${w.day} of about ${WORM.COURSE})${o.kind === "prisoner" ? `: −${dayHp(d)} health today` : ""}`;
  const thanks = o.kind === "guest" ? `Cured, their group's goodwill +${O.GUEST} (a failed but honest attempt +${O.GUEST_TRIED}).` : `Cured, their opinion of you +${O.OPINION} (a failed purge +${O.OPINION_TRIED})${o.p.factionId != null ? `, and their group's goodwill +${O.RETURN_GOODWILL} more when you release them or trade them back` : ""}.`;
  const chip = `<span class="chip off"${tip(`The worm in ${o.name}: day ${w.day} of about ${WORM.COURSE}, ${w.stage === "gut" ? "in the gut" : "in the brain"}. Untreated it kills them${o.kind === "guest" ? ` on day ${WORM.COURSE}` : " in about a week"} and they get up among your people. ${thanks}`)}>${esc(label)}</span>`;
  const kinds = w.stage === "gut" ? ["dewormer", "purge"] : ["surgery"];
  const name = { dewormer: "Dewormer", purge: `Purge (${WORM.PURGE_MEDS} meds)`, surgery: `Surgery (${WORM.SURGERY_MEDS} meds)` };
  const what = {
    dewormer: () => `A dewormer from ${b.name}'s armory: a sure cure in the gut stage. No medic needed.`,
    purge: (i) => `${WORM.PURGE_MEDS} of ${b.name}'s meds and one of ${i.treater ? `${i.treater.s.name.split(" ")[0]}'s` : "a medic's"} treatments: ${Math.round(i.chance * 100)}% it passes the worm.`,
    surgery: (i) => `${WORM.SURGERY_MEDS} meds and most of ${i.treater ? `${i.treater.s.name.split(" ")[0]}'s` : "a medic's"} day: ${Math.round(i.chance * 100)}% they live; otherwise they die on the table.`,
  };
  return `<div class="row small" style="flex-wrap:wrap">${chip}${kinds.map((k) => {
    const info = otherTreatInfo(state, b, o, k);
    return `<button class="mini" data-action="treatworm-other" data-base="${b.id}" data-key="${o.key}" data-kind="${k}" ${info.ok ? "" : "disabled"}${tip(info.ok ? `${what[k](info)} ${thanks}` : info.reason)}>${name[k]}</button>`;
  }).join(" ")}</div>`;
}
// Medical tab: prisoners and guests at this base known to carry the worm, under "Prisoners" and "Guests".
export function othersWormHtml(state, b) {
  const list = wormOthersSeen(state, b);
  if (!list.length) return "";
  const part = (kind, title) => {
    const xs = list.filter((o) => o.kind === kind);
    return xs.length ? `<h3>${title} (${xs.length})</h3>${xs.map((o) => `<div class="card small"><b>${esc(o.kind === "prisoner" ? o.p.name : o.name[0].toUpperCase() + o.name.slice(1))}</b>${otherWormRow(state, b, o)}</div>`).join("")}` : "";
  };
  return part("prisoner", "Prisoners") + part("guest", "Guests");
}

// Medical tab: Treat buttons per condition for someone at this base.
export function conditionTreatRow(state, b, s) {
  const list = conditionsOf(s);
  const worm = wormTreatRow(state, b, s); // the worm's own row (a dewormer, a purge, surgery) beside the illnesses
  if (!list.length) return worm;
  return worm + `<div class="row small" style="flex-wrap:wrap">${list.map((c) => `${condChip(state, s, c)}${condTreatButton(state, s, c)}<span class="muted">${esc(courseText(c))}</span>`).join(" ")}</div>`;
}

// The base's illness line (Bases tab and Overview): who is ill, meds spent on illness this week, today's risk.
// The numbers behind it: { ill, worm, week, avg, causes, noMeds } (noMeds: people ill or with the worm, no meds left).
export function illnessSummary(state, b) {
  const people = residents(state, b.id);
  const ill = people.filter(isIll);
  const week = sickMedsWeek(state, b);
  let avg = 0;
  const why = {};
  if (people.length) {
    const ctx = baseRiskCtx(state, b);
    for (const s of people) {
      const r = illnessRisk(state, s, ctx);
      avg += r.total / people.length;
      for (const x of r.parts) why[x.cause] = (why[x.cause] || 0) + x.p / people.length;
    }
  }
  const causes = Object.entries(why).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${CAUSE_NAMES[k] || k} ${pct(v)}`).join(", ");
  const worm = people.filter(wormSeen).length; // the worm (sim/worm.js), once spotted: its own stages and cures
  const noMeds = !!((b.stock.meds || 0) < 1 && (ill.length || worm));
  return { ill: ill.length, worm, week, avg, causes, noMeds };
}
// A headline (who is ill), a red "no meds!" chip when they need meds there are none of, and the detail muted on a
// second line (spans, not divs: a .kv grid mutes its odd-numbered divs).
export function illnessRowHtml(state, b) {
  const { ill, worm, week, avg, causes, noMeds } = illnessSummary(state, b);
  return `<div${tip(`Illness here: the ill (and anyone known to carry the worm), the meds spent on illness and injuries over the last 7 days (1 meds a dose, a course of 1-3 doses an illness), and today's chance a person falls ill${causes ? ` (${causes})` : ""}. Warmth, clean water, full stomachs, room to sleep and a hospital lower it.`)}>Illness</div><div class="${noMeds ? "danger" : ill || worm ? "warn" : ""}"><span class="ill-head">${ill ? `${ill} ill` : "nobody ill"}${worm ? ` · ${worm} with the worm` : ""}${noMeds ? ` <span class="chip off ill-nomeds"${tip("People here are ill and there are no meds at this base to treat them")}>no meds!</span>` : ""}</span><span class="ill-sub small muted">${week} meds this week · risk ${pct(avg)}/day</span></div>`;
}
export const CAUSE_NAMES = { weather: "weather", common: "colds going round", hunger: "hunger and thirst", water: "dirty water", food: "spoiled food", crowding: "crowding", contagion: "contagion", camp: "no camp fire", work: "work", search: "searching", wound: "wounds", worsened: "worsened", mushroom: "mushrooms" };

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
      <label style="display:block;margin-top:0.3rem"${tip(`With automatic care on, the night's care also treats the worm in prisoners and guests here (after your own people): a dewormer, a purge or surgery, as for a resident. Curing a guest wins their group's goodwill (+${WORM.OTHERS.GUEST}); a prisoner's opinion of you rises (+${WORM.OTHERS.OPINION}). Off: only when you press the buttons.`)}><input type="checkbox" data-action="health-others" data-base="${b.id}" ${othersCareOn(b) ? "checked" : ""}> Treat prisoners and guests too</label>
      <div style="margin-top:0.3rem"${tip("Automatic care never takes the meds below this. Your own Treat buttons can still use them.")}>Keep <select data-action="health-reserve" data-base="${b.id}">${RESERVE_STEPS.map((v) => `<option value="${v}" ${reserve === v ? "selected" : ""}>${v}</option>`).join("")}${RESERVE_STEPS.includes(reserve) ? "" : `<option value="${reserve}" selected>${reserve}</option>`}</select> meds in reserve</div>
      <div style="margin-top:0.3rem"${tip("Who takes a hospital bed: people below this health, and anyone with a severe (below 30) or infected wound or too ill to work, worst off first. Everyone else keeps working and heals slowly. 100 = anyone hurt.")}>Admit below <select data-action="health-admit" data-base="${b.id}">${admitSteps.map((v) => `<option value="${v}" ${admit === v ? "selected" : ""}>${v}</option>`).join("")}</select> health to a bed</div>
      <div style="margin-top:0.3rem"${tip(`Each treatment (a wound, or one illness) takes a medic's time: ${TREATS_PER_MEDIC} + Medicine/4 a day per person on the Medic role (less while ill). With nobody on the role, the best at Medicine here gives ${UNTRAINED_TREATS} a day between other work. Surgery takes ${SURGERY_LOAD} from one medic. Resets at midnight.`)}>Medic time today: ${time.cap ? `${time.used} of ${time.cap} treatments given${who ? ` <span class="muted">(${esc(who)}${time.trained ? "" : "; nobody on the Medic role"})</span>` : ""}` : `<span class="danger">nobody can treat</span>`}</div>
      <div class="muted" style="margin-top:0.3rem">${esc(tonight)}</div>
    </div>
    <h3>Illness</h3>
    <div class="card small">
      <div>${sick.length ? `${sick.length} ill or injured${contagious ? `, <span class="danger">${contagious} contagious</span>` : ""}${q ? " · quarantine on" : ""} · ${medsToTreatAll(state, b)} meds to finish everyone's courses` : "<span class='muted'>Nobody here is ill or injured.</span>"}</div>
      <div class="kv" style="margin-top:0.3rem">${illnessRowHtml(state, b)}</div>
      <div class="muted" style="margin-top:0.3rem">An illness is treated with a course of 1-3 doses (1 meds a day each, by severity): it stops worsening and ends sooner. Untreated it lasts longer, can turn to pneumonia and kill the weak. Automatic care gives the doses each night (the medic, or the best at Medicine here); the Treat buttons give one now. Cold (no heating, the fire out), dirty water (a water filter helps), spoiled food, hunger and thirst, hard work and crowding make people ill; flu, chest colds, dysentery and pneumonia spread. Rest and a hospital bed speed recovery.</div>
      ${wormWaterLine(state, b)}
    </div>`;
}

// The worm (sim/worm.js): whether the water here is safe, and how it is caught and cured.
function wormWaterLine(state, b) {
  const w = baseWater(state, b);
  const water = !w.drawn ? "no un-purified water here" : w.safe ? `<span class="good">safe</span> (${esc(w.why)})` : `<span class="danger">${w.raw > 0 ? "carries the worm's eggs" : "un-purified: it can carry the worm"}</span> (${esc(w.why)})`;
  return `<div style="margin-top:0.3rem"${tip(`The worm: any un-purified water can carry it (${Math.round(WORM.RAW_BASE * 1000) / 10}% a day drinking nothing else, far more from infected ground), and game from infected land not cooked through, and camping on badly infested land. A water boiler or a water filter makes the water safe, a cook fire or a preserving room cooks the game. It hurts more every day and kills in about a week: a medic spots it from the first day (better Medicine sooner); days 1–${WORM.BRAIN_FROM - 1} a dewormer or a purge (${WORM.PURGE_MEDS} meds) clears it, from day ${WORM.BRAIN_FROM} only surgery in a Clinic. Un-purified water also gives an upset stomach now and then: mood only, it passes.`)}>Water: ${water}</div>`;
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
  // A dose wherever they are (a team member: from the team's meds, only while the team is in contact).
  "treatcond-any": (state, ui, d) => {
    const s = state.survivors.find((x) => x.id === Number(d.id));
    if (!s) return;
    if (s.location.kind === "party") {
      const p = state.parties.find((x) => x.id === s.location.partyId);
      if (!p || !contactable(p) || !commandable(state, p)) return;
    }
    const msg = treatConditionAnywhere(state, s.id, d.key);
    if (ui.baseView) ui.baseMsg = msg;
    else state.log.unshift({ hour: state.hour, text: msg, kind: "info" });
  },
  // The worm (sim/worm.js): a dewormer, a purge or surgery. treatWorm logs the result itself.
  treatworm: (state, ui, d) => {
    const b = baseOf(state, d);
    if (!b) return;
    const msg = treatWorm(state, b, Number(d.id), d.kind);
    if (ui.baseView) ui.baseMsg = msg;
  },
  // The worm in a prisoner or a guest (sim/worm.js treatOtherWorm logs the result itself).
  "treatworm-other": (state, ui, d) => {
    const b = baseOf(state, d);
    if (!b) return;
    const msg = treatOtherWorm(state, b, d.key, d.kind);
    if (ui.baseView) ui.baseMsg = msg;
  },
  "health-others": (state, ui, d) => {
    const b = baseOf(state, d);
    if (!b) return;
    b.wormCareOthers = !othersCareOn(b);
    ui.baseMsg = b.wormCareOthers ? `The night's care at ${b.name} treats the worm in prisoners and guests too.` : `The night's care at ${b.name} treats only your own people.`;
  },
  // The water boiler (sim/worm.js): may it burn the armory's cheap wooden, paper and cloth junk when the wood runs short?
  "boiler-junk": (state, ui, d) => {
    const b = baseOf(state, d);
    if (!b) return;
    b.boilerJunk = !boilerJunkOn(b);
    ui.baseMsg = b.boilerJunk ? `The water boiler at ${b.name} may burn spare wooden items and paper from the armory when the wood runs short.` : `The water boiler at ${b.name} burns only wood, items marked to burn, and fuel.`;
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
