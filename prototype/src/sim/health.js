// @ts-check
// Illness and work injuries: named conditions people pick up from how they live and work, that cost meds to treat.
// A condition has a severity (0-100). Each day it gets better or worse (drift: conditionDrift), costs health while it
// lasts (hp at severity 100, raw damage), cuts how much the person can work, their mood and their aim, may spread to
// the people they live or travel with, and may turn into something worse. Rest, a camp fire, a hospital bed and a good
// medic speed recovery.
//
// Treatment is a course of doses (1 meds each, one a day): the course is set by the severity when it starts (SICK.dose:
// 1 below 35, 2 below 65, else 3; pneumonia at least 2). Each dose takes some severity off and stops it worsening for a
// day; after the last dose the illness is "on the mend": it no longer worsens or turns into anything else, spreads far
// less, costs half the health, and fades by SICK.mend a day (faster with rest). So an illness costs 1-3 meds, and an
// untreated one runs longer, worsens and can kill the weak.
// Who gives the doses:
//   - at a base, automatically each night (medical.js autoCare: the medic, or the best at Medicine there, keeping the
//     base's meds reserve and within the medics' time), or by hand (the Treat buttons: Medical tab, People tab, the
//     survivor screen), from the base's meds;
//   - on a team (and at a camp), automatically each night once it is worth it (SICK.teamAuto) by the member with the
//     best Medicine (+ a kit), from the team's own meds (packed, then found), or by hand (team panel, People tab).
// No meds where the patient is: the dose is not given (a log line each night and an alert: ui/alerts.js noMeds).
//
// Where people fall ill (chances per person per day; all × frailty and the place's protections, see illnessRisk):
//   - ordinary life: SICK.common a chest cold (colds go round);
//   - cold and wet weather (weather.exposureRisk): teams on the road in full (a lit camp fire × FIRE.warm), at a base
//     outdoor workers at 60% and everyone else indoors at a quarter of half, unless the base is cold (needs.js heatDaily:
//     no heating fuel below 0°C; a shelter with its fire out): then indoors is as cold as out. Cold brings a chest cold
//     or flu (pneumonia on top of flu), heat a fever;
//   - hunger or thirst gauges below 25 (needs.js): a fever from weakness, dysentery from drinking whatever there is;
//   - un-purified water and uncooked food (worm.js: the water a base or a team drinks un-purified, game, crops and
//     forage with the worm's eggs eaten raw): an upset stomach (stomach), WORM.SICK_X times the worm's own chance, rolled
//     where the worm is (worm.js sickRoll). It costs no health, no thirst and hardly any work: a little mood a day for
//     two to four days, then it passes. Treating it is optional: one dose by hand (1 meds, the Medical tab or a team's
//     panel) cures it at once; automatic care and the autopilot leave it alone. Only the worm hurts.
//     Spoiled food stays dysentery: SICK.spoiled × the share of the fresh food stored outside in the warm (storage.js);
//   - crowding: more people than beds, flu 0.2% + 1% x overcrowding (up to 3%);
//   - contagion: each contagious case passes it on with its own chance per person a day (×1.6 crowded, ×0.4 in
//     quarantine, ×SICK.spread.team in a team's close quarters, ×SICK.spread.mending once on the mend); medics catch it
//     half again as often (treating the sick);
//   - work: farming 0.6%, building 1.2%, crafting 0.8%, workshop 0.6%, base scavenging 2%, guard 0.2% (cuts and
//     sprains); searching a site 0.8% a cut and 0.25% a fever per person per search hour (scavenge.js); a quick
//     rummage on a raid map up to 9% a cut, 6% by day with no skill (search.js quickHurt);
//   - wounds: a hit of 10+ health that does not kill: 25% a deep cut that needs dressing (world.hurt); an untreated
//     cut can become an infected wound (medical.js woundInfected);
//   - foraged mushrooms (foraging.js), the bites of the dead (combat.js: their own rules).
// Frailty (frailty): hunger or thirst below 50 up to ×2 each, below 50 health ×1.3, the Sickly trait ×1.5 (traits.js), hard work at a base (building,
// scavenging, foraging) or a long march under a load (needs.js counts the hours) up to ×SICK.march.cap, sleeping rough
// on a team ×SICK.rough; both gauges at 75+ ×SICK.fed. A base's hospital (×(1 − SICK.hospital × tier): cleaner, the sick kept apart) lowers everything but
// the weather and work.
// The worm is not a condition here: it has its own stages, spotting and cures (worm.js), and only its work factor
// joins the rest (workFactor). The UI shows it beside these (ui/health.js wormChip, the Illness line, the alerts).
import { hasTrait, accidentMult, sicklyMult, sicklyDrift } from "./traits.js"; // Sickly, Clumsy (by tier)
import { log, addCard, alive, atBase, residents, skill, hurt, day, baseById } from "./world.js";
import { wormWork } from "./worm.js";
import { fireWarmed } from "./upkeep.js"; // a shelter's fire warms only while lit and fed (woodcutting.js shelterFire)
import { activeHospital, careCtx, pickTreater, noTimeReason, nextDayText, spendMedicTime, autoCare, autoCareOn } from "./medical.js";
import * as Weather from "./weather.js";
import { GEAR } from "./data.js";
import { crowding, moodWork } from "./morale.js";
import { hasPerk, gainXp, USE } from "./skills.js";
import { teamFire, FIRE } from "./fieldheat.js";
import { hungerOf, thirstOf } from "./needs.js";
import { partyMembers, onTheMove } from "./parties.js";
import { foodStore } from "./storage.js";
import { medKitBonus } from "./crafting.js";

// sev = starting severity [min, max]; drift = change per day untreated (before rest and care);
// hp = health lost per day at severity 100; work = how much they can work at severity 100 (1 = fully);
// meds = meds per dose; treat = the severity a dose takes off (× the hospital's meds effect, the medic's Medicine);
// spread = chance per day to pass it to each other person at the base or on the team.
export const CONDITIONS = {
  cut:       { name: "Deep cut",   kind: "injury",  icon: "🩹", sev: [20, 45], drift: -4, hp: 0,  work: 0.75, meds: 1, treat: 100, spread: 0,
               desc: "A deep gash that needs cleaning and dressing. Untreated it can get infected (3% a day)." },
  sprain:    { name: "Sprain",     kind: "injury",  icon: "🩹", sev: [30, 60], drift: -5, hp: 0,  work: 0.35, meds: 1, treat: 40, spread: 0,
               desc: "A twisted ankle or wrist: barely able to work until it heals. A splint and painkillers help." },
  chestcold: { name: "Chest cold", kind: "illness", icon: "🤧", sev: [15, 40], drift: -2, hp: 2,  work: 0.7,  meds: 1, treat: 40, spread: 0.02,
               desc: "Coughing and aching: works slower. Catching. In the cold or when weak it can go to the lungs (pneumonia)." },
  fever:     { name: "Fever",      kind: "illness", icon: "🤒", sev: [25, 50], drift: 1,  hp: 6,  work: 0.3,  meds: 1, treat: 45, spread: 0,
               desc: "Burning up: weak and sweating. It can turn into pneumonia if it runs high (3% a day above 60)." },
  flu:       { name: "Flu",        kind: "illness", icon: "🤒", sev: [30, 55], drift: -3, hp: 4,  work: 0.3,  meds: 1, treat: 35, spread: 0.035,
               desc: "Catching, and spreads fast in a crowded base. Gets worse for the first days. In the cold it can become pneumonia." },
  dysentery: { name: "Dysentery",  kind: "illness", icon: "🤢", sev: [30, 60], drift: 1,  hp: 8,  work: 0.2,  meds: 1, treat: 50, spread: 0.015, thirst: 1,
               desc: "From spoiled food or drinking whatever there is when parched. Drains health and water (+1 water a day). Good storage and full water tanks make it rarer." },
  // From un-purified water or uncooked food (worm.js sickRoll): mild, never kills, no thirst: mood only (mood: a flat
  // amount a day in place of SICK.mood × severity). mild: automatic care (a base's and a team's) does not spend meds on
  // it; cure: treating it is optional, and one dose (by hand: the Medical tab, a team panel) ends it at once.
  stomach:   { name: "Upset stomach", kind: "illness", icon: "🥴", sev: [20, 40], drift: -7, hp: 0, work: 0.95, meds: 1, treat: 60, spread: 0, mood: 1.5, mild: true, cure: true,
               desc: "Cramps and an uneasy gut from un-purified water or food that was not cooked: no health lost, just a low mood for a few days, then it passes. If you want it gone now, 1 meds cures it at once (automatic care leaves it alone). It is not the worm: the worm hurts more every day." },
  pneumonia: { name: "Pneumonia",  kind: "illness", icon: "🫁", sev: [50, 75], drift: 4,  hp: 12, work: 0,    meds: 1, treat: 30, spread: 0.01,
               desc: "Fluid in the lungs: cannot work, and it kills without meds. A hospital bed helps a lot." },
};
export const CONDITION_KEYS = Object.keys(CONDITIONS);
const RESPIRATORY = new Set(["chestcold", "flu", "pneumonia"]);

// Every number of the illness model.
export const SICK = {
  common: 0.006,                           // a chest cold a day from ordinary life (colds go round)
  rough: 1.25,                             // on a team: sleeping rough, no roof (× frailty)
  coldSplit: 0.6,                          // share of cold-weather cases that are a chest cold (the rest flu)
  weak: { below: 50, max: 1 },             // hunger / thirst below 50: risk × (1 + max × how far below), each
  fed: 75, fedMult: 0.85,                  // both gauges at 75+: risk ×0.85
  frailHealth: { below: 50, mult: 1.3 },   // below 50 health: risk ×1.3
  hardWork: { build: 1.25, scavenge: 1.25, wood: 1.25, forage: 1.15, farm: 1.1 }, // exhaustion at a base by role
  march: { per: 0.08, long: 10, perLong: 0.03, cap: 2.5 }, // a team's day: 1 + per × load-hours over a light load + perLong × hours marched past 10
  gauge: { below: 25, base: 0.01, add: 0.04, addThirst: 0.05 }, // hunger / thirst below 25: fever / dysentery a day
  water: { none: 0.004, filter: 0.001, thirsty: 3, noFire: 2 },
  spoiled: 0.004,                          // dysentery × the share of the fresh food stored outside (warm weather)
  hospital: 0.12,                          // risk at a base × (1 − this × hospital tier) for all but weather and work
  spread: { crowd: 1.6, quarantine: 0.4, team: 1.3, mending: 0.3, medic: 1.5, cap: 0.25 },
  mood: 1.5,                               // mood a day at severity 100
  aim: 15,                                 // aim lost in battle at nothing left to work with (combat.js)
  dose: { one: 35, two: 65 },              // a course: 1 dose below 35 severity, 2 below 65, else 3 (pneumonia 2+)
  mend: 6,                                 // drift a day once the course is done
  field: { base: 0.7, perSkill: 0.03 },    // a field dose takes off treat × (0.7 + 0.03 × Medicine and kit)
  teamAuto: 40,                            // a team starts a course on its own from this severity (pneumonia, or 5+ health a day, at once)
  dysThirst: 20,                           // thirst lost a day on a team at dysentery severity 100
  news: 24,                                // hours "fell ill" stays an alert
};

const r1 = (v) => Math.round(v * 10) / 10;
const first = (s) => s.name.split(" ")[0];
export const conditionsOf = (s) => (s && Array.isArray(s.conditions) ? s.conditions : []);
export const isSick = (s) => !!s && s.alive && conditionsOf(s).length > 0;
export const isIll = (s) => !!s && s.alive && conditionsOf(s).some((c) => CONDITIONS[c.key] && CONDITIONS[c.key].kind === "illness");
export const isContagious = (s) => conditionsOf(s).some((c) => CONDITIONS[c.key] && CONDITIONS[c.key].spread > 0);
export const hasCondition = (s, key) => conditionsOf(s).some((c) => c.key === key);
export const sickStats = (state) => state.sickStats || (state.sickStats = { cases: 0, injuries: 0, caught: 0, medsBase: 0, medsTeam: 0, deaths: 0, byKey: {}, byCause: {} });

// How much someone can work: the worst of their conditions, by severity; nothing while quarantined; times their
// mood (morale.js moodWork: 70% at rock bottom, 100% from 45 to 80, 110% at 100; grief and breaks too).
export function workFactor(s) {
  if (!s) return 1;
  const mw = moodWork(s);
  const list = conditionsOf(s);
  const ww = wormWork(s); // worm.js: the worm in the gut or the brain, seen or not
  if (!list.length) return ww < 1 ? Math.round(ww * mw * 100) / 100 : mw;
  if (s.quarantined && isContagious(s)) return 0;
  return Math.max(0, Math.round(Math.min(healthWork(s), ww) * mw * 100) / 100);
}
// The illness part alone (0..1).
export function healthWork(s) {
  const list = conditionsOf(s);
  if (!list.length) return 1;
  let f = 1;
  for (const c of list) {
    const d = CONDITIONS[c.key];
    if (!d) continue;
    f = Math.min(f, 1 - (1 - d.work) * Math.min(1, Math.max(0.3, c.sev / 100) + 0.2));
  }
  return Math.max(0, Math.round(f * 100) / 100);
}
// Aim lost in battle to illness (combat.js): up to SICK.aim at nothing left to work with.
export const illnessAim = (s) => (conditionsOf(s).length ? -Math.round(SICK.aim * (1 - healthWork(s))) : 0);

// Below this work factor someone is too ill to work: they leave a workshop station and take a hospital bed
// (medical.bedReason). Quarantine is left out here: it keeps people from work, not in bed.
export const WORK_STOP = 0.35;
export const tooIllToWork = (s) => !!s && s.alive && conditionsOf(s).length > 0 && workFactor({ conditions: conditionsOf(s) }) < WORK_STOP;

// Mood a condition costs a day: its own flat amount (an upset stomach), else SICK.mood × severity.
export const conditionMood = (c) => { const d = CONDITIONS[c.key]; return d && d.mood != null ? d.mood : SICK.mood * c.sev / 100; };

// How dangerous a condition is (for "worst off first" in beds and automatic care): health it costs, pneumonia
// above everything, and some weight for severity.
export function conditionDanger(c) {
  const d = CONDITIONS[c.key];
  if (!d) return 0;
  return d.hp * c.sev / 100 * (c.mending ? 2 : 4) + (c.key === "pneumonia" && !c.mending ? 50 : 0) + c.sev * 0.1;
}

// Gives someone a condition (or makes the one they have worse). Returns the condition, or null.
// opts: sev, quiet (no log line or alert), cause (a tag for the census: weather, water, contagion…), from (who passed it).
export function addCondition(state, s, key, why = "", opts = {}) {
  const d = CONDITIONS[key];
  if (!d || !s || !s.alive) return null;
  if (!Array.isArray(s.conditions)) s.conditions = [];
  const sev = opts.sev ?? state.rng.int(d.sev[0], d.sev[1]);
  const have = s.conditions.find((c) => c.key === key);
  if (have) {
    have.sev = Math.min(100, have.sev + sev * 0.4);
    if (have.mending) { have.mending = false; have.course = Math.min(3, (have.course || 1) + 1); } // a relapse: one more dose
    return have;
  }
  const c = { key, sev, days: 0, since: day(state), why, treatedDay: -99, course: null, dosed: 0, mending: false };
  if (opts.cause) c.cause = opts.cause;
  s.conditions.push(c);
  const st = sickStats(state);
  if (d.kind === "illness") {
    st.cases++;
    st.byKey[key] = (st.byKey[key] || 0) + 1;
    const cs = opts.cause || "other";
    st.byCause[cs] = (st.byCause[cs] || 0) + 1;
    if (opts.from) st.caught++;
  } else st.injuries++;
  if (!opts.quiet) {
    log(state, `${s.name} ${d.kind === "injury" ? "got" : "came down with"} ${d.kind === "injury" ? `a ${d.name.toLowerCase()}` : d.name.toLowerCase()}${why ? ` ${why}` : ""}.`, "danger");
    if (d.kind === "illness") addNews(state, s, key, !!opts.from);
  }
  return c;
}

export function removeCondition(s, key) {
  if (!Array.isArray(s.conditions)) return;
  s.conditions = s.conditions.filter((c) => c.key !== key);
}

// ---------- the course of treatment ----------
// Doses a course takes, set by the severity when it starts (1-3; injuries 1).
export function dosesFor(c) {
  const d = CONDITIONS[c.key];
  if (!d || d.kind !== "illness" || d.cure) return 1; // cure: one dose ends it (an upset stomach)
  const n =c.sev < SICK.dose.one ? 1 : c.sev < SICK.dose.two ? 2 : 3;
  return c.key === "pneumonia" ? Math.max(2, n) : n;
}
// Does it still want a dose (no course yet, or a course not finished)?
export const needsDose = (c) => !!c && !c.mending && (c.course == null || (c.dosed || 0) < c.course);
// Doses still to give: the rest of the course, or a new course.
export const dosesLeft = (c) => (!needsDose(c) ? 0 : c.course == null ? dosesFor(c) : c.course - (c.dosed || 0));
// "dose 1 of 2" / "course of 2" / "on the mend".
export function courseText(c) {
  if (c.mending) return "on the mend";
  if (c.course == null) return `needs a course of ${dosesFor(c)} med${dosesFor(c) === 1 ? "" : "s"}`;
  return `${c.dosed} of ${c.course} doses`;
}

// Gives one dose: severity off, no worsening for a day, the course counted. Returns true when it ended the condition.
function giveDose(state, s, c, amount) {
  if (c.course == null) c.course = dosesFor(c);
  c.dosed = (c.dosed || 0) + 1;
  c.sev -= amount;
  c.treatedDay = day(state);
  if (c.dosed >= c.course) c.mending = true;
  if (c.sev <= 0 || (CONDITIONS[c.key] && CONDITIONS[c.key].cure)) { removeCondition(s, c.key); return true; } // cure: one dose ends it
  return false;
}

// Meds spent on illness and injuries: the totals (sickStats) and each base's last 7 days (base.sickMeds: [[day, n]]).
function noteMeds(state, base, n, team = null) {
  const st = sickStats(state);
  state.medsUsed = (state.medsUsed || 0) + n;
  if (team) { st.medsTeam += n; team.sickMeds = (team.sickMeds || 0) + n; return; }
  st.medsBase += n;
  if (!base) return;
  const d = day(state);
  const log7 = (base.sickMeds || []).filter((x) => x[0] > d - 7);
  const today = log7.find((x) => x[0] === d);
  if (today) today[1] += n; else log7.push([d, n]);
  base.sickMeds = log7;
}
// Meds this base spent on illness and injuries over the last 7 days.
export const sickMedsWeek = (state, base) => (base.sickMeds || []).filter((x) => x[0] > day(state) - 7).reduce((a, x) => a + x[1], 0);

// ---------- treatment at a base ----------
// One dose per condition a day, with base meds and a medic's time (medical.js: careCtx, the same medic time as wound
// treatments). opts.auto = an automatic dose (keeps the base's meds reserve).
export function conditionInfoCtx(state, base, s, key, ctx) {
  const c = conditionsOf(s).find((x) => x.key === key);
  const d = CONDITIONS[key];
  const t = ctx ? pickTreater(ctx, 1) : null;
  const shown = t || (ctx && ctx.treaters[0]) || null;
  const treatedToday = !!c && !!ctx && c.treatedDay === ctx.day;
  let reason = "";
  if (!s || !s.alive) reason = "Nobody to treat.";
  else if (!c || !d) reason = `${s.name} does not have that.`;
  else if (!base || !residents(state, base.id).includes(s)) reason = `${s.name} is not at ${base ? base.name : "a base"}.`;
  else if (!needsDose(c)) reason = `The course is done: ${first(s)}'s ${d.name.toLowerCase()} is on the mend.`;
  else if (treatedToday) reason = `Already had today's dose. Next ${nextDayText(state)}.`;
  else if (!t) reason = noTimeReason(state, ctx);
  else if (ctx.meds < d.meds) reason = `No meds: needs ${d.meds} (have ${Math.floor(ctx.meds)}).`;
  else if (ctx.auto && ctx.meds - d.meds < ctx.reserve) reason = `Would take the meds below the reserve of ${ctx.reserve}.`;
  const hosp = base ? activeHospital(state, base) : null;
  const medSkill = shown ? skill(shown.s, "medicine") : 0;
  const amount = d ? Math.round(d.treat * (hosp ? hosp.eff : 1) * (1 + medSkill * 0.02) * (shown && hasPerk(shown.s, "plaguedoctor") ? 1.5 : 1)) : 0; // Plague Doctor (skills.js)
  const course = c ? (c.course == null ? dosesFor(c) : c.course) : 0;
  return { ok: !reason, reason, cost: d ? d.meds : 0, amount, cures: c ? amount >= c.sev || !!d.cure : false, treater: t, medic: t ? t.s : null, load: 1, treatedToday, course, dose: c ? (c.dosed || 0) + 1 : 0 };
}

export function treatConditionInfo(state, base, s, key, opts = {}) {
  return conditionInfoCtx(state, base, s, key, base ? opts.ctx || careCtx(state, base, opts) : null);
}

// Applies a checked dose: 1 meds from the base, the medic's time, severity off.
export function applyCondition(state, base, s, key, info) {
  const c = conditionsOf(s).find((x) => x.key === key);
  base.stock.meds = Math.max(0, (base.stock.meds || 0) - info.cost);
  noteMeds(state, base, info.cost);
  if (info.cost > 0) s.medsHour = state.hour; // medical.js medsToday: the worm heals at the full rate in a hospital bed today
  spendMedicTime(state, base, info.treater, info.load);
  gainXp(state, info.medic, "medicine", USE.illness); // skills.js
  const gone = giveDose(state, s, c, info.amount);
  const name = CONDITIONS[key].name.toLowerCase();
  const by = info.medic && info.medic !== s ? ` by ${first(info.medic)}` : "";
  const dose = `${info.cost} meds, dose ${c.dosed} of ${c.course}`;
  if (gone) return `${s.name}'s ${name} was treated${by} at ${base.name} (${dose}). It is gone.`;
  return `${s.name}'s ${name} was treated${by} at ${base.name} (${dose}): severity now ${Math.round(c.sev)}${c.mending ? ", on the mend" : ""}.`;
}

// One dose with base meds.
export function treatCondition(state, base, survivorId, key, opts = {}) {
  const s = state.survivors.find((x) => x.id === Number(survivorId));
  const info = treatConditionInfo(state, base, s, key, opts);
  if (!info.ok) return info.reason;
  return applyCondition(state, base, s, key, info);
}

// Meds to finish everyone's courses here (and how many need a dose today).
export function medsToTreatAll(state, base) {
  let n = 0;
  for (const s of residents(state, base.id)) for (const c of conditionsOf(s)) n += dosesLeft(c) * (CONDITIONS[c.key] ? CONDITIONS[c.key].meds : 1);
  return n;
}

// Base setting: automatic care each night (medical.autoCare: wounds and illnesses, worst off first, keeping the
// base's meds reserve, base.medsReserve, and within the medics' time).
export const autoTreatOn = autoCareOn;

// Illnesses automatic care doses: a course once started is finished; a new one for anything that costs real health
// or can kill, any deep cut (it can get infected), the rest from severity 30.
export function autoWantsCondition(c) {
  const d = CONDITIONS[c.key];
  if (!d || !needsDose(c) || d.mild) return false; // an upset stomach passes on its own: meds by hand only
  if (c.course != null) return true;
  const urgent = d.hp * c.sev / 100 >= 6 || c.key === "pneumonia";
  return urgent || c.sev >= 30 || c.key === "cut";
}

// ---------- treatment on a team ----------
const partyOf = (state, s) => (s && s.location && s.location.kind === "party" ? state.parties.find((x) => x.id === s.location.partyId) || null : null);
export const teamMeds = (p) => Math.max(0, (p.supplies && p.supplies.meds) || 0) + Math.max(0, (p.cargo && p.cargo.supplies && p.cargo.supplies.meds) || 0);
function takeTeamMeds(p, n) {
  const fromCargo = Math.min(n, Math.max(0, (p.cargo && p.cargo.supplies && p.cargo.supplies.meds) || 0));
  if (fromCargo) p.cargo.supplies.meds -= fromCargo;
  p.supplies.meds = (p.supplies.meds || 0) - (n - fromCargo);
}
// The member who gives the doses: best Medicine plus a kit in the off hand.
function teamMedic(state, p) {
  let best = null, val = -1;
  for (const m of partyMembers(state, p)) {
    if (!m.alive) continue;
    const v = skill(m, "medicine") + medKitBonus(m);
    if (v > val) { best = m; val = v; }
  }
  return { medic: best, value: Math.max(0, val) };
}
export function fieldDoseInfo(state, p, s, key) {
  const c = conditionsOf(s).find((x) => x.key === key);
  const d = CONDITIONS[key];
  const { medic, value } = p ? teamMedic(state, p) : { medic: null, value: 0 };
  const amount = d ? Math.round(d.treat * (SICK.field.base + SICK.field.perSkill * value) * (medic && hasPerk(medic, "plaguedoctor") ? 1.5 : 1)) : 0;
  let reason = "";
  if (!s || !s.alive) reason = "Nobody to treat.";
  else if (!p || !(p.members || []).includes(s.id) || s.location.kind !== "party") reason = `${s.name} is not with this team.`;
  else if (!c || !d) reason = `${s.name} does not have that.`;
  else if (!needsDose(c)) reason = `The course is done: ${first(s)}'s ${d.name.toLowerCase()} is on the mend.`;
  else if (c.treatedDay === day(state)) reason = `Already had today's dose. Next ${nextDayText(state)}.`;
  else if (teamMeds(p) < d.meds) reason = `No meds: the team carries ${Math.floor(teamMeds(p))}.`;
  const course = c ? (c.course == null ? dosesFor(c) : c.course) : 0;
  return { ok: !reason, reason, cost: d ? d.meds : 0, amount, cures: c ? amount >= c.sev || !!d.cure : false, medic, value, course, dose: c ? (c.dosed || 0) + 1 : 0 };
}
// One dose from the team's meds (by hand: the team panel; automatically: teamCare).
export function fieldDose(state, p, survivorId, key) {
  const s = state.survivors.find((x) => x.id === Number(survivorId));
  const info = fieldDoseInfo(state, p, s, key);
  if (!info.ok) return info.reason;
  const c = conditionsOf(s).find((x) => x.key === key);
  takeTeamMeds(p, info.cost);
  noteMeds(state, null, info.cost, p);
  gainXp(state, info.medic, "medicine", USE.illness);
  const gone = giveDose(state, s, c, info.amount);
  const by = info.medic && info.medic !== s ? `${first(info.medic)} gives ${first(s)}` : `${first(s)} takes`;
  return `${by} a dose for the ${CONDITIONS[key].name.toLowerCase()} from the team's meds (dose ${c.dosed} of ${c.course})${gone ? ": it is gone" : c.mending ? ": on the mend" : ""}.`;
}
// Treat an illness wherever they are: their base's meds or their team's.
export function treatConditionAnywhere(state, survivorId, key) {
  const s = state.survivors.find((x) => x.id === Number(survivorId));
  if (!s || !s.alive) return "Nobody to treat.";
  const p = partyOf(state, s);
  if (p) return fieldDose(state, p, s.id, key);
  const b = s.location.kind === "base" ? baseById(state, s.location.baseId) : null;
  return b ? treatCondition(state, b, s.id, key) : `${s.name} cannot be treated from here.`;
}
// Does the team dose this on its own tonight?
export function teamWants(c) {
  const d = CONDITIONS[c.key];
  if (!d || !needsDose(c) || d.mild) return false;
  if (c.course != null) return true;
  return c.key === "pneumonia" || d.hp * c.sev / 100 >= 5 || c.sev >= SICK.teamAuto || (c.key === "cut" && c.sev >= 30);
}
// A team's night: doses for anything worth it, worst first, while its meds last; a line when there are none.
function teamCare(state, p) {
  if (state.combat && state.combat.setup && state.combat.setup.partyId === p.id) return;
  const want = [];
  for (const s of partyMembers(state, p)) {
    if (!s.alive || s.location.kind !== "party") continue;
    for (const c of conditionsOf(s)) if (teamWants(c) && c.treatedDay !== day(state)) want.push({ s, c });
  }
  if (!want.length) return;
  want.sort((a, b) => conditionDanger(b.c) - conditionDanger(a.c));
  const lines = [], missed = [];
  for (const { s, c } of want) {
    const info = fieldDoseInfo(state, p, s, c.key);
    if (!info.ok) { if (/No meds/.test(info.reason)) missed.push(`${first(s)} (${CONDITIONS[c.key].name.toLowerCase()})`); continue; }
    lines.push(fieldDose(state, p, s.id, c.key));
  }
  if (lines.length) log(state, lines.join(" "), "info");
  if (missed.length) log(state, `No meds on the team for ${missed.join(", ")}: it goes untreated.`, "danger");
}

// ---------- risk ----------
const coldNow = (state) => {
  const w = Weather.weather ? Weather.weather(state) : null;
  return !!w && w.lo <= 3;
};
const exposure = (state, sheltered) => (Weather.exposureRisk ? Weather.exposureRisk(state, { sheltered }) : { chance: 0, kind: null, reason: "" });

// wood: felling and splitting (woodcutting.js): axes slip, limbs fall.
const WORK_RISK = { farm: 0.006, build: 0.012, craft: 0.008, operate: 0.006, scavenge: 0.02, guard: 0.002, wood: 0.012, medic: 0, rest: 0 };
const OUTDOORS = new Set(["farm", "scavenge", "guard", "build", "forage", "wood"]);

export function hasWaterFilter(state, base) {
  if (base.armory.some((it) => it && GEAR[it.key] && GEAR[it.key].water)) return true;
  return atBase(state, base.id).some((s) => s.gear.tool && GEAR[s.gear.tool.key] && GEAR[s.gear.tool.key].water);
}

// What a place does to the risk (one per base or team a day; illnessRisk builds it when not given).
export function baseRiskCtx(state, base) {
  const people = residents(state, base.id);
  const over = Math.max(0, crowding(state, base) - 1);
  const filter = hasWaterFilter(state, base);
  // A shelter (tier 0) whose fire does not warm it (out, or nothing left to burn: upkeep.js fireWarmed): unboiled
  // water and no warmth indoors.
  const coldCamp = base.tier === 0 && !fireWarmed(base);
  const hosp = activeHospital(state, base);
  // Spoiled food: the share of the fresh food stored outside, as fast as it rots there (storage.js).
  let spoil = 0;
  try {
    const fs = foodStore(state, base);
    if (fs.fresh > 0 && fs.outside > 0) spoil = (fs.outside / fs.fresh) * Math.min(1, fs.outRate / 0.03);
  } catch { spoil = 0; }
  return {
    kind: "base", base, people, crowd: over, filter, coldCamp, hosp, guard: Math.max(0, 1 - SICK.hospital * (hosp.tier || 0)),
    quarantine: (base.quarantineUntil || 0) >= day(state), spoil,
    outside: exposure(state, false), inside: exposure(state, !coldCamp && !base.cold), where: `at ${base.name}`,
  };
}
export function teamRiskCtx(state, p) {
  const people = partyMembers(state, p).filter((s) => s.alive && s.location.kind === "party");
  return { kind: "team", party: p, people, fire: teamFire(state, p), ex: exposure(state, false), guard: 1, where: "on the road" };
}

// How much more likely someone is to fall ill today: weakness from hunger, thirst and wounds, and exhaustion.
// Returns { f, why: [text] }.
export function frailty(state, s, ctx = null) {
  let f = 1;
  const why = [];
  const mul = (m, text) => { if (Math.abs(m - 1) > 0.005) { f *= m; why.push(`${text} ×${r1(m)}`); } };
  const h = hungerOf(s), t = thirstOf(s);
  const W = SICK.weak;
  if (h < W.below) mul(1 + W.max * (W.below - h) / W.below, "hungry");
  if (t < W.below) mul(1 + W.max * (W.below - t) / W.below, "thirsty");
  if (h >= SICK.fed && t >= SICK.fed) mul(SICK.fedMult, "well fed");
  if (s.health < SICK.frailHealth.below) mul(SICK.frailHealth.mult, "weak from wounds");
  if (hasTrait(s, "sickly")) mul(sicklyMult(s), "sickly"); // traits.js, by tier
  const kind = ctx ? ctx.kind : s.location.kind === "party" ? "team" : "base";
  if (kind === "base" && s.location.kind === "base" && !s.inBed) mul(SICK.hardWork[s.role] || 1, "hard work");
  if (kind === "team") {
    mul(SICK.rough, "sleeping rough");
    const M = SICK.march;
    const load = Math.max(0, (s.marchLoad || 0) - (s.marchHours || 0)), long = Math.max(0, (s.marchHours || 0) - M.long);
    mul(Math.min(M.cap, 1 + M.per * load + M.perLong * long), (s.marchLoad || 0) - (s.marchHours || 0) > 0.5 ? "marching under a load" : "a long march");
  }
  return { f, why };
}

// Someone's chances today, before the dice: { parts: [{ key, p, cause, why }] (each × frailty), total, frail }.
// Contagion is in it (the people they live or travel with).
export function illnessRisk(state, s, ctx = null) {
  const out = { parts: [], total: 0, frail: { f: 1, why: [] } };
  if (!s || !s.alive) return out;
  if (!ctx) {
    const p = partyOf(state, s);
    const b = !p && (s.location.kind === "base" || s.location.kind === "route") ? (s.location.kind === "base" ? baseById(state, s.location.baseId) : state.bases.find((x) => residents(state, x.id).includes(s))) : null;
    ctx = p ? teamRiskCtx(state, p) : b ? baseRiskCtx(state, b) : null;
    if (!ctx) return out;
  }
  const frail = frailty(state, s, ctx);
  out.frail = frail;
  const add = (key, p, cause, why, guarded = true) => { if (p > 0) out.parts.push({ key, p: Math.min(0.5, p * frail.f * (guarded ? ctx.guard : 1)), cause, why }); };
  const where = ctx.where;
  // Weather.
  let ex;
  if (ctx.kind === "base") {
    const working = s.location.kind === "base" && !s.inBed;
    ex = working && OUTDOORS.has(s.role) ? { ...ctx.outside, chance: ctx.outside.chance * 0.6 } : { ...ctx.inside, chance: ctx.inside.chance * 0.5 };
  } else ex = ctx.fire === true && ctx.ex.kind === "cold" ? { ...ctx.ex, chance: ctx.ex.chance * FIRE.warm } : ctx.ex;
  if (ex.kind === "heat") add("fever", ex.chance, "weather", `from the heat (${ex.reason}) ${where}`, false);
  else if (ex.kind) {
    const coldWhy = ctx.kind === "base" && (ctx.base.cold || ctx.coldCamp) ? ` (${ctx.coldCamp ? "the fire out" : "no heating"})` : ctx.kind === "team" && ctx.fire === false ? " (no fire)" : "";
    if (hasCondition(s, "flu")) add("pneumonia", ex.chance, "weather", `in the ${ex.reason}${coldWhy} ${where}`, false);
    else {
      add("chestcold", ex.chance * SICK.coldSplit, "weather", `in the ${ex.reason}${coldWhy} ${where}`, false);
      add("flu", ex.chance * (1 - SICK.coldSplit), "weather", `in the ${ex.reason}${coldWhy} ${where}`, false);
    }
  }
  // Ordinary life.
  add("chestcold", SICK.common, "common", `from a cold going round ${where}`);
  // Hunger and thirst.
  const G = SICK.gauge, h = hungerOf(s), t = thirstOf(s);
  if (t < G.below) add("dysentery", G.base + G.addThirst * (G.below - t) / G.below, "hunger", `drinking whatever they could find ${where}`);
  if (h < G.below) add("fever", G.base + G.add * (G.below - h) / G.below, "hunger", `weak from hunger ${where}`);
  // Water and food.
  if (ctx.kind === "base") {
    // Un-purified water: worm.js rolls an upset stomach (stomach) for the share drunk un-purified (baseWormDaily).
    if (ctx.spoil > 0) add("dysentery", SICK.spoiled * ctx.spoil, "food", `from spoiled food ${where} (food stored outside)`);
    if (ctx.crowd > 0) add("flu", Math.min(0.03, 0.002 + 0.01 * ctx.crowd), "crowding", `in the crowded bunks ${where}`);
  } // A team's un-purified water and uncooked food: worm.js rolls an upset stomach as it is drunk or eaten (drinkHour, eatRaw).
  // Contagion: the worst of what the others here carry.
  let best = 0, from = null;
  for (const src of ctx.people) {
    if (src === s || !src.alive) continue;
    for (const c of conditionsOf(src)) {
      const d = CONDITIONS[c.key];
      if (!d || !d.spread || hasCondition(s, c.key)) continue;
      const Sp = SICK.spread;
      let q = d.spread * (0.5 + c.sev / 100) * (c.mending ? Sp.mending : 1);
      if (ctx.kind === "base") q *= (ctx.crowd > 0 ? Sp.crowd : 1) * (ctx.quarantine ? Sp.quarantine : 1);
      else q *= Sp.team;
      if ((s.role === "medic" || s.role === "trainee") && s.location.kind === "base" && !hasPerk(s, "plaguedoctor")) q *= Sp.medic; // Plague Doctor (skills.js); a Medic trainee works the ward too (training.js)
      if (q > best) { best = q; from = { src, key: c.key }; }
    }
  }
  if (from) {
    const n = ctx.people.filter((o) => o !== s && o.alive && isContagious(o)).length;
    add(from.key, Math.min(SICK.spread.cap, best * Math.max(1, Math.sqrt(n))), "contagion", `caught from ${first(from.src)} ${where}`);
    out.parts[out.parts.length - 1].from = from.src;
  }
  out.total = 1 - out.parts.reduce((a, x) => a * (1 - x.p), 1);
  return out;
}

// Rolls today's new case for someone (at most one). Returns the condition or null.
function rollOnset(state, s, ctx) {
  const r = illnessRisk(state, s, ctx);
  for (const x of r.parts) {
    if (!state.rng.chance(x.p)) continue;
    return addCondition(state, s, x.key, x.why, { cause: x.cause, from: x.from });
  }
  return null;
}

// ---------- the course of an illness ----------
// The expected change in severity a day (before the dice): the illness's own drift, rest and care, hunger and the cold.
export function conditionDrift(state, s, c) {
  const d = CONDITIONS[c.key];
  if (!d) return -100;
  const today = day(state);
  let drift = d.drift;
  if (c.key === "flu" && c.days < 3) drift = 4;
  if (c.key === "fever" && c.days < 2) drift += 2;
  const weak = hungerOf(s) < SICK.gauge.below || thirstOf(s) < SICK.gauge.below;
  const p = partyOf(state, s);
  if (p) {
    if (weak || p.noFood || p.noWater) drift += 4;
    const fire = teamFire(state, p);
    if (onTheMove(p) && !p.vehicle) drift += 1; // walking it off does not work
    else if (!onTheMove(p)) drift -= fire === true ? 2.5 : 1.5; // resting, best by a fire
    if (RESPIRATORY.has(c.key) && fire !== true && coldNow(state)) drift += 1.5;
  } else {
    const base = s.location.kind === "base" ? baseById(state, s.location.baseId) : null;
    if (base) {
      const hosp = activeHospital(state, base);
      drift -= 1.5;
      if (s.role === "rest") drift -= 2;
      if (s.inBed && hosp && hosp.tier > 0) drift -= 4 + hosp.tier * 2;
      drift -= (hosp ? hosp.baseSkill : 0) * 0.15;
      if (base.hungerDays > 0 || base.thirstDays > 0 || weak) drift += 4;
      if (RESPIRATORY.has(c.key) && (base.cold || (base.tier === 0 && !fireWarmed(base))) && coldNow(state)) drift += 1.5;
    }
  }
  if (c.treatedDay >= today - 1) drift = Math.min(drift, -2);
  if (c.mending) drift = Math.min(drift, 0) - SICK.mend;
  if (d.kind === "illness" && hasTrait(s, "sickly")) drift += sicklyDrift(s); // Sickly (traits.js): it clears slower
  return drift;
}
// Days until it is gone at today's rate, or null while it is getting worse (or holding).
export function daysLeft(state, s, c) {
  const dr = conditionDrift(state, s, c);
  return dr < -0.5 ? Math.max(1, Math.ceil(c.sev / -dr)) : null;
}
// "4 days" / "worsening".
export function daysLeftText(state, s, c) {
  const n = daysLeft(state, s, c);
  return n == null ? "worsening" : `${n} day${n === 1 ? "" : "s"} left`;
}

// ---------- the daily tick ----------
// Everyone with a condition: it drifts, hurts, maybe turns worse; then new cases; then the night's care (bases:
// medical.autoCare; teams: teamCare).
export function healthDaily(state) {
  const rng = state.rng;
  const today = day(state);
  const st = sickStats(state);
  for (const s of alive(state)) {
    const list = conditionsOf(s);
    if (!list.length) continue;
    const p = partyOf(state, s);
    const base = !p && s.location.kind === "base" ? baseById(state, s.location.baseId) : null;
    for (const c of [...list]) {
      const d = CONDITIONS[c.key];
      if (!d) { removeCondition(s, c.key); continue; }
      c.sev = Math.min(100, c.sev + conditionDrift(state, s, c) + rng.range(-2, 2));
      if (c.sev <= 0) {
        removeCondition(s, c.key);
        log(state, `${s.name} got over the ${d.name.toLowerCase()}.`, "good");
        continue;
      }
      // Health and mood: not on the day it starts. Half the health once on the mend.
      if (c.days > 0) {
        s.mood = Math.max(0, s.mood - conditionMood(c));
        if (d.hp > 0) {
          const tile = base ? base.tile : p && p.path ? p.path[p.idx] : null;
          hurt(state, s, d.hp * c.sev / 100 * (c.mending ? 0.5 : 1), tile, `of ${d.name.toLowerCase()}`, { raw: true });
          if (!s.alive) { if (d.kind === "illness") st.deaths++; break; }
        }
        if (p && d.thirst) s.thirst = Math.max(0, (s.thirst ?? 100) - SICK.dysThirst * c.sev / 100);
      }
      c.days += 1;
      // Turning worse (never on the mend, nor the day after a dose).
      if (c.mending || c.treatedDay >= today - 1) continue;
      const cold = coldNow(state) || (base && base.cold) || (p && teamFire(state, p) === false);
      if (c.key === "cut" && !s.woundInfected && rng.chance(0.03)) {
        removeCondition(s, "cut");
        s.woundInfected = true;
        log(state, `${s.name}'s untreated cut is infected. Treat it with meds.`, "danger");
      } else if ((c.key === "fever" && c.sev > 60 && rng.chance(0.03))
        || (c.key === "flu" && ((c.sev > 50 && cold && rng.chance(0.04)) || (c.sev > 70 && rng.chance(0.02))))
        || (c.key === "chestcold" && c.sev > 55 && (cold || hungerOf(s) < SICK.weak.below) && rng.chance(0.03))) {
        removeCondition(s, c.key);
        addCondition(state, s, "pneumonia", `after the ${d.name.toLowerCase()} went to the lungs`, { cause: "worsened" });
      }
    }
  }
  for (const s of state.survivors) { s.marchLoad = 0; s.marchHours = 0; } // needs.js counts a team's march by the hour
  // New cases.
  for (const base of state.bases) baseOnsets(state, base);
  teamOnsets(state);
  // The night's care, and the alerts for what goes untreated.
  for (const base of state.bases) {
    const out = autoCare(state, base);
    noMedsLog(state, base, out);
    outbreakCheck(state, base);
  }
  for (const p of state.parties) if (p.owner === "player" && Array.isArray(p.members)) teamCare(state, p);
}

// Automatic care skipped people for want of meds: one line a night per base.
function noMedsLog(state, base, out) {
  if (!out || out.off) return;
  const missed = out.skipped.filter((x) => x.kind === "cond" && /^No meds/.test(x.reason));
  if (!missed.length) return;
  log(state, `No meds at ${base.name}: ${missed.map((x) => `${first(x.s)}'s ${CONDITIONS[x.key].name.toLowerCase()}`).join(", ")} ${missed.length === 1 ? "goes" : "go"} untreated.`, "danger");
}

function baseOnsets(state, base) {
  const rng = state.rng;
  const ctx = baseRiskCtx(state, base);
  if (!ctx.people.length) return;
  for (const s of ctx.people) {
    if (!s.alive) continue;
    s.quarantined = ctx.quarantine && isContagious(s);
    const role = s.location.kind === "base" ? s.role : "rest";
    const working = s.location.kind === "base" && !s.inBed;
    // Work accidents.
    if (working && rng.chance((WORK_RISK[role] || 0) * workFactor(s) * accidentMult(s))) { // Clumsy (traits.js): more cuts and sprains
      const key = rng.chance(role === "scavenge" ? 0.65 : 0.55) ? "cut" : "sprain";
      const what = { farm: "in the fields", wood: "cutting wood", build: "on the building site", craft: "at the workbench", operate: "at a workshop station", scavenge: "scavenging around the base", guard: "on watch" }[role] || "at work";
      addCondition(state, s, key, `${what} ${ctx.where}`, { cause: "work" });
      if (role === "scavenge") hurt(state, s, rng.int(4, 12), base.tile, `scavenging near ${base.name}`);
      continue;
    }
    rollOnset(state, s, ctx);
  }
}

function teamOnsets(state) {
  for (const p of state.parties) {
    if (p.owner !== "player" || !Array.isArray(p.members)) continue;
    const ctx = teamRiskCtx(state, p);
    for (const s of ctx.people) rollOnset(state, s, ctx);
  }
}

// Search hours at a site (scavenge.js): cuts on broken glass and rusty metal, fevers from what lies there.
export function searchHazards(state, members, where = "") {
  for (const s of members) {
    if (!s || !s.alive) continue;
    if (state.rng.chance(0.008 * accidentMult(s))) addCondition(state, s, "cut", `searching ${where}`.trim(), { cause: "search" }); // Clumsy (traits.js)
    else if (state.rng.chance(0.0025)) addCondition(state, s, "fever", `from the filth at ${where}`.trim(), { cause: "search" });
  }
}

// A wound that did not kill (world.hurt, plain damage only): it may need dressing.
export function woundTrauma(state, s, amount) {
  if (!s || !s.alive || amount < 10 || hasCondition(s, "cut")) return;
  if (state.rng.chance(0.25)) addCondition(state, s, "cut", "from the wound", { quiet: true, cause: "wound" });
}

// ---------- news for the alerts ----------
// Who fell ill lately: state.sickNews [{ h, id, key, base, party, caught }], kept two days.
function addNews(state, s, key, caught) {
  const p = partyOf(state, s);
  const b = !p && s.location.kind === "base" ? s.location.baseId : null;
  const list = (state.sickNews || []).filter((x) => state.hour - x.h < 48);
  list.push({ h: state.hour, id: s.id, key, base: b, party: p ? p.id : null, caught });
  state.sickNews = list.slice(-40);
}
export const recentNews = (state, hours = SICK.news) => (state.sickNews || []).filter((x) => state.hour - x.h < hours);

// People who need a dose and have no meds where they are: [{ base | party, who: [{ s, c }] }].
export function noMedsList(state) {
  const out = [];
  for (const b of state.bases) {
    if ((b.stock.meds || 0) >= 1) continue;
    const who = [];
    for (const s of residents(state, b.id)) for (const c of conditionsOf(s)) if (autoWantsCondition(c)) who.push({ s, c });
    if (who.length) out.push({ base: b, who });
  }
  for (const p of state.parties) {
    if (p.owner !== "player" || !Array.isArray(p.members) || teamMeds(p) >= 1) continue;
    const who = [];
    for (const s of partyMembers(state, p)) if (s.alive) for (const c of conditionsOf(s)) if (teamWants(c)) who.push({ s, c });
    if (who.length) out.push({ party: p, who });
  }
  return out;
}

// ---------- outbreaks ----------
function outbreakCheck(state, base) {
  const sick = residents(state, base.id).filter((s) => isContagious(s));
  if (sick.length < 3) return;
  if ((base.outbreakDay || -99) > day(state) - 10) return;
  if (state.cards.some((c) => c.outbreakBase === base.id)) return;
  base.outbreakDay = day(state);
  const names = {};
  for (const s of sick) for (const c of conditionsOf(s)) if (CONDITIONS[c.key].spread) names[CONDITIONS[c.key].name.toLowerCase()] = true;
  const what = Object.keys(names).join(" and ");
  const baseId = base.id;
  addCard(state, {
    title: `Outbreak at ${base.name}`,
    outbreakBase: baseId,
    text: `${sick.length} people at ${base.name} have ${what}: ${sick.map(first).join(", ")}. It is spreading.`,
    choices: [
      {
        label: "Quarantine the sick (10 days)", hint: "The sick do not work while contagious; the spread drops by 60% for 10 days",
        resolve: (st) => {
          const b = baseById(st, baseId);
          if (!b) return "That base is gone.";
          b.quarantineUntil = day(st) + 10;
          return `The sick at ${b.name} are kept apart for 10 days.`;
        },
      },
      {
        label: "Treat everyone now", get hint() { const b = baseById(state, baseId); return b ? `A dose each today (1 meds a dose; about ${medsToTreatAll(state, b)} meds for everyone's full course; have ${Math.floor(b.stock.meds || 0)})` : ""; },
        disabled: (st) => { const b = baseById(st, baseId); return !b || (b.stock.meds || 0) < 1; },
        resolve: (st) => {
          const b = baseById(st, baseId);
          if (!b) return "That base is gone.";
          let used = 0;
          for (const s of residents(st, b.id)) for (const c of [...conditionsOf(s)]) {
            const info = treatConditionInfo(st, b, s, c.key);
            if (!info.ok) continue;
            applyCondition(st, b, s, c.key, info);
            used += info.cost;
          }
          return used ? `Treated the sick at ${b.name} (${used} meds).` : "There were not enough meds or medic time to treat anyone.";
        },
      },
      { label: "Carry on", hint: "No cost now", resolve: () => "Life goes on. The sick keep working as they can." },
    ],
  });
}

// ---------- text for the UI ----------
export function conditionText(c) {
  const d = CONDITIONS[c.key];
  return `${d.name} (${Math.round(c.sev)})`;
}

export function conditionTip(state, s, c) {
  const d = CONDITIONS[c.key];
  const bits = [d.desc, `Severity ${Math.round(c.sev)} of 100, day ${c.days + 1}${c.why ? `, ${c.why}` : ""}.`];
  const dl = daysLeft(state, s, c);
  bits.push(dl == null ? "Getting worse at today's rate: it needs meds or rest." : `About ${dl} day${dl === 1 ? "" : "s"} left at today's rate.`);
  if (d.hp) bits.push(`Costs about ${r1(d.hp * c.sev / 100 * (c.mending ? 0.5 : 1))} health a day.`);
  bits.push(`Can work at ${Math.round(workFactor({ conditions: [c] }) * 100)}%${illnessAim({ conditions: [c] }) ? `, aim ${illnessAim({ conditions: [c] })}` : ""}, mood −${r1(conditionMood(c))} a day.`);
  bits.push(d.cure ? `Treatment is optional: it passes on its own; ${d.meds} meds by hand (the Treat button) cures it at once. Automatic care leaves it alone.` : c.mending ? "Treated: on the mend (no longer worsens)." : c.course != null ? `Treatment: ${c.dosed} of ${c.course} doses given (1 meds a day each).` : `Treatment: a course of ${dosesFor(c)} dose${dosesFor(c) === 1 ? "" : "s"}, 1 meds a day each (at a base a medic's time too); each takes about ${d.treat} severity off (more with a hospital and Medicine) and stops it worsening.`);
  if (d.spread) bits.push(c.mending ? "Barely catching now." : "Contagious.");
  return bits.join(" ");
}
