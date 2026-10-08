// Training medics in the hospital (the clinic request, 2026-10-08: "survivors can heal and increase skill levels for
// medic/doctor"). Healing was there (medical.js: infirmary → field hospital → clinic → trauma hospital); what was
// missing was a way to *make* medics. Two parts, both once a day (world.js, after skills.js skillsDaily):
//
// Ward rounds (medics on duty learn from the patients): every Medic-role survivor at a base with a running hospital
// earns Medicine XP from the ward, on top of the Medic role's flat 8 a day and the 5 / 10 / 4 for each wound,
// surgery and illness they treat (skills.js USE). The ward's points (WARD): 2 for each patient in a bed, 0.5 for each
// hurt or ill person on their feet, +2 for a severe wound (below 30 health), +2 for an infected one, +1 for each illness.
// The points × the hospital's teach factor (BUILDINGS med.teach: 1 / 1.2 / 1.45 / 1.75 by tier) are shared among the
// medics on duty, and each medic's share is capped at the tier's med.ward (4 / 6 / 8 / 10 a day; their own daily
// bucket, skills.js CAP_WARD, so it is not lost under the 20-a-day use cap that a busy medic fills with treatments).
// An empty ward gives nothing here: a quiet hospital trains only by the role's 8 a day.
//
// Lessons (a doctor teaches the trainees): a survivor on the Trainee role ("Medic trainee", economy.js ROLES) works
// on the ward instead of their old job. The doctor is whoever at the base gives the best lesson (doctorAt): the
// medic on duty with the most Medicine, or, when nobody on duty has Medicine TRAINING.docMin, the best Medicine
// at the base off duty (evening lessons, × TRAINING.offDuty). Each trainee with a place (med.train: 1 / 1 / 2 / 3
// by tier; the lowest ids first) gains
//     (TRAINING.base + TRAINING.perSkill × the doctor's Medicine) × med.teach × (quiet ward: × TRAINING.quiet)
//     × the doctor's work factor (× TRAINING.mentor with the Mentor perk)
// study XP a day (skills.js CAP_STUDY: 25 with any other lessons and books), while their Medicine (as shown) is below
// the doctor's − TRAINING.gap. Every trainee also earns TRAINING.practice use XP a day for the ward work, place or
// not, doctor or not. The doctor gains TRAINING.docLead Leadership a day for teaching. A trainee counts as half a
// medic toward the staff a tier needs (medical.js TRAINEE_STAFF, staffCount; beside one full medic), takes no
// treatments of their own, catches contagious illness like a medic (health.js) and can still be a patient.
// Compare the Teach role (skills.js): 4 + 0.4 × the teacher's skill + 0.15 × their Leadership and Speech, gap 4, and
// the teacher does no other work; here the doctor keeps treating and the trainee gives up their job instead.
//
// Who assigns trainees: the player (Trainee role, or the Work tab's Trainee column), the governor and base leaders
// (autopilot.js planRoles → planTrainees, Medical area: one trainee while the base has fewer skilled medics than its
// hospital's staff + 1), and the AI groups grow their medics the same way, coarsely (groupcare.js medicTraining).
// tools/clinictest.js tests all of it and measures a medic's Medicine after 180 days with and without lessons.
import { atBase, residents, skill, log, day } from "./world.js";
import { hospitalDef, activeHospital, traineesHere, isHurt, isSevere } from "./medical.js";
import { workFactor, conditionsOf } from "./health.js";
import { gainXp, hasPerk } from "./skills.js";

export const TRAINING = {
  docMin: 6,        // the doctor needs Medicine 6+ (as shown; the clinic's own requirement)
  gap: 2,           // a trainee learns until their Medicine is the doctor's − 2 (the Teach role's gap is 4)
  base: 3,          // lesson XP a day: 3 + 0.4 × the doctor's Medicine (doctor 6: 5.4, 10: 7, 15: 9), × med.teach
  perSkill: 0.4,
  offDuty: 0.5,     // the doctor is not on Medic duty: lessons in the evenings, half as much
  quiet: 0.75,      // nobody here hurt or ill: lessons from the book and the drills
  mentor: 1.5,      // the doctor has the Mentor perk (skills.js, as for the Teach role)
  practice: 4,      // use XP a day for every trainee on the ward (the Medic role's 8 is a full medic's day)
  docLead: 2,       // Leadership a day for the doctor while they teach anyone
  // The governor and base leaders (planTrainees): a trainee while the base has fewer people with Medicine `skilled`+
  // than its hospital's staff + 1, food for `foodDays` days, at least `minPeople` people and nothing attacking; one
  // trainee (two at `twoAt`+ people), never more than the tier's places. Planned ahead of the comfortable farm crew.
  skilled: 6, foodDays: 20, minPeople: 4, twoAt: 12, minMood: 35,
};
// Ward points per person at the base (the ward rounds above).
export const WARD = { bed: 2, walking: 0.5, severe: 2, infected: 2, ill: 1 };

const first = (s) => String(s.name).split(" ")[0];
const fit = (s) => !!s && s.alive && !s.inBed && workFactor(s) > 0;

// Medics on duty at a base today (the Medic role, not in a bed, fit to work).
export const medicsOnDuty = (state, base) => atBase(state, base.id).filter((s) => s.role === "medic" && fit(s));

// The ward's points: what the patients at this base teach the medics on duty today.
export function wardPoints(state, base) {
  let pts = 0;
  for (const s of residents(state, base.id)) {
    if (!s.alive) continue;
    const ill = conditionsOf(s).length;
    if (!isHurt(s) && !ill) continue;
    pts += s.inBed ? WARD.bed : WARD.walking;
    if (isSevere(s)) pts += WARD.severe;
    if (s.woundInfected) pts += WARD.infected;
    pts += ill * WARD.ill;
  }
  return pts;
}

// Ward XP a survivor already had today.
const wardToday = (state, s) => (s.xpDay && s.xpDay.d === day(state) && s.xpDay.ward && s.xpDay.ward.medicine) || 0;

// Each medic's ward XP today (before their work factor): the points × the tier's teach factor, shared, capped.
export function wardXpEach(state, base, hosp = activeHospital(state, base), medics = medicsOnDuty(state, base)) {
  if (!hosp.tier || !medics.length) return 0;
  return Math.min(hosp.ward || 0, (wardPoints(state, base) * (hosp.teach || 1)) / medics.length);
}

// A lesson's XP a day from doctor D (before the trainee's own work factor).
export function lessonRate(state, base, D, onDuty, def = hospitalDef(base), quiet = wardPoints(state, base) <= 0) {
  if (!D || !def.tier) return 0;
  return (TRAINING.base + TRAINING.perSkill * skill(D, "medicine")) * (def.teach || 1) * (onDuty ? 1 : TRAINING.offDuty) * (quiet ? TRAINING.quiet : 1)
    * workFactor(D) * (hasPerk(D, "mentor") ? TRAINING.mentor : 1);
}

// The doctor at a base: { s, onDuty } giving the best lesson (a medic on duty first at equal worth), or null.
// Nobody on the Trainee role teaches; someone in a bed or too ill to work does not either.
export function doctorAt(state, base) {
  const def = hospitalDef(base);
  if (!def.tier) return null;
  let best = null, bestV = -1;
  for (const s of atBase(state, base.id)) {
    if (s.role === "trainee" || !fit(s) || skill(s, "medicine") < TRAINING.docMin) continue;
    const onDuty = s.role === "medic";
    const v = (TRAINING.base + TRAINING.perSkill * skill(s, "medicine")) * (onDuty ? 1 : TRAINING.offDuty) * workFactor(s) * (hasPerk(s, "mentor") ? TRAINING.mentor : 1) + (onDuty ? 1e-6 : 0);
    if (v > bestV || (v === bestV && best && s.id < best.s.id)) { best = { s, onDuty }; bestV = v; }
  }
  return best;
}

// Why a trainee learns nothing from the doctor today ("" when they do).
export function lessonWhy(state, base, t, doc, place) {
  if (!place) return `no trainee place left (the ${hospitalDef(base).name.toLowerCase()} takes ${hospitalDef(base).train})`;
  if (!doc) return `no doctor here (someone with Medicine ${TRAINING.docMin}+ to teach)`;
  if (doc.s === t) return "they are the best medic here";
  if (!fit(t)) return t.inBed ? "in a hospital bed" : "too ill to work";
  const cap = skill(doc.s, "medicine") - TRAINING.gap;
  if (skill(t, "medicine") >= cap) return `Medicine ${skill(t, "medicine")}: lessons go up to ${cap} (${first(doc.s)}'s ${skill(doc.s, "medicine")} − ${TRAINING.gap})`;
  return "";
}

// Everything the Medical tab shows (and the daily tick uses): the doctor, the trainees with their places, today's
// lesson for each, and the ward rounds.
export function trainingInfo(state, base) {
  const def = hospitalDef(base);
  const hosp = activeHospital(state, base);
  const medics = medicsOnDuty(state, base);
  const pts = wardPoints(state, base);
  const doc = doctorAt(state, base);
  const quiet = pts <= 0;
  const rate = doc ? lessonRate(state, base, doc.s, doc.onDuty, def, quiet) : 0;
  const trainees = traineesHere(state, base).map((s, i) => {
    const place = i < (def.train || 0);
    const why = def.tier ? lessonWhy(state, base, s, doc, place) : "no infirmary or hospital here";
    return { s, place, why, xp: why ? 0 : rate * workFactor(s), practice: def.tier && fit(s) ? TRAINING.practice * workFactor(s) : 0, cap: doc ? skill(doc.s, "medicine") - TRAINING.gap : null };
  });
  return { def, hosp, doc, rate, quiet, slots: def.train || 0, trainees, medics, wardPts: pts, wardEach: wardXpEach(state, base, hosp, medics) };
}

// Once a day for every base (world.js): ward rounds, then lessons.
export function trainingDaily(state) {
  for (const base of state.bases) trainBase(state, base);
}
function trainBase(state, base) {
  const def = hospitalDef(base);
  if (!def.tier) return;
  const info = trainingInfo(state, base);
  // The tier's cap holds for the day (CAP_WARD is only the bucket's ceiling over every tier).
  if (info.wardEach > 0) for (const m of info.medics) gainXp(state, m, "medicine", Math.min(info.wardEach * workFactor(m), (info.hosp.ward || 0) - wardToday(state, m)), "ward");
  let taught = 0;
  for (const t of info.trainees) {
    if (t.practice > 0) gainXp(state, t.s, "medicine", t.practice);
    if (t.xp > 0) { gainXp(state, t.s, "medicine", t.xp, "study"); taught++; t.s.trainIdle = false; }
    else if (!t.s.trainIdle && t.why) { log(state, `${first(t.s)} is a Medic trainee at ${base.name} but learns nothing from a doctor: ${t.why}.`, "info"); t.s.trainIdle = true; }
  }
  if (taught && info.doc) gainXp(state, info.doc.s, "leadership", TRAINING.docLead);
}

// ---------- the governor and base leaders (autopilot.js planRoles) ----------
// free: the people still without a role this hour; give(s, role). A trainee while the base has fewer skilled medics
// (Medicine TRAINING.skilled+) than its hospital's staff + 1, food is comfortable and nothing is attacking. Those
// already training keep it first (they stop once they reach the skill or the lessons stop).
export function planTrainees(state, base, free, give, { foodDays = 0, urgent = false } = {}) {
  const def = hospitalDef(base);
  const people = atBase(state, base.id);
  if (!def.tier || !def.train || urgent || people.length < TRAINING.minPeople || foodDays < TRAINING.foodDays) return 0;
  const skilled = people.filter((s) => skill(s, "medicine") >= TRAINING.skilled).length;
  if (skilled >= def.staff + 1) return 0;
  const doc = doctorAt(state, base);
  if (!doc) return 0;
  const want = Math.min(def.train, people.length >= TRAINING.twoAt ? 2 : 1);
  let n = people.filter((s) => s.role === "trainee" && !free.has(s)).length; // trainees someone else keeps (pinned, priorities)
  const cap = skill(doc.s, "medicine") - TRAINING.gap;
  const pool = [...free].filter((s) => s !== doc.s && fit(s) && !s.leader && s.mood >= TRAINING.minMood && skill(s, "medicine") < cap)
    .sort((a, b) => (b.role === "trainee") - (a.role === "trainee") || (b.traits.includes("medic") - a.traits.includes("medic")) || skill(b, "medicine") - skill(a, "medicine") || a.id - b.id);
  let given = 0;
  for (const s of pool) {
    if (n >= want) break;
    give(s, "trainee");
    n++; given++;
  }
  return given;
}

// The Help topic (ui/help.js) and the codex.
export const TRAINING_HELP = `<p><b>Training medics.</b> Every hospital (from the makeshift infirmary up) trains medics two ways.</p>
<p><i>Ward rounds:</i> medics on duty learn from the patients. On top of the Medic role's 8 Medicine XP a day and the XP for each treatment, each patient adds to the ward (${WARD.bed} in a bed, ${WARD.walking} on their feet, +${WARD.severe} for a severe wound, +${WARD.infected} for an infected one, +${WARD.ill} an illness), shared among the medics on duty and capped a day by the tier: infirmary 4, field hospital 6, clinic 8, trauma hospital 10. A better hospital teaches more from each case (× 1, 1.2, 1.45, 1.75). An empty ward teaches nothing extra.</p>
<p><i>Medic trainees:</i> put someone on the <b>Trainee</b> role (or set Trainee in the Work tab). The doctor, the best medic at the base with Medicine ${TRAINING.docMin}+, teaches them Medicine every day: ${TRAINING.base} + ${TRAINING.perSkill} × the doctor's Medicine XP, × the tier's factor, × ${TRAINING.quiet} on a quiet ward, half when the doctor is not on Medic duty (evening lessons), × ${TRAINING.mentor} with the Mentor perk. Lessons stop ${TRAINING.gap} below the doctor's Medicine. Every trainee also gets ${TRAINING.practice} XP a day for the ward work. Places: 1 in an infirmary or field hospital, 2 in a clinic, 3 in a trauma hospital. A trainee counts as half a medic toward the staff a hospital needs (beside at least one full medic), gives no treatments and catches illness on the ward like a medic. The Medical tab shows the doctor, the trainees and their progress. The governor and base leaders put one trainee on the ward while a base has fewer medics with Medicine ${TRAINING.skilled}+ than its hospital needs plus one.</p>`;
