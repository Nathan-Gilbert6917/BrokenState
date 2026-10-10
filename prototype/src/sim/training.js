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
// by tier; to those who can learn, lowest ids first; a place left over goes to a junior medic on duty) gains
//     (TRAINING.base + TRAINING.perSkill × the doctor's Medicine) × med.teach × (quiet ward: × TRAINING.quiet)
//     × the doctor's work factor (× TRAINING.mentor with the Mentor perk)
// study XP a day (skills.js CAP_STUDY: 25 with any other lessons and books), while their Medicine (as shown) is below
// the doctor's − the tier's med.gap (1; 0 in a trauma hospital: up to the doctor's own level). Every trainee also earns
// TRAINING.practice use XP a day for the ward work, place or not, doctor or not.
// The doctor's career: each day they teach anyone gives TRAINING.docLead Leadership and docSpeech Speech, and counts
// toward Professor of Medicine (PROFESSOR: an earned perk, lessons × 1.25). A trainee who reaches Medicine
// TRAINING.graduate graduates (a log line and a card: Make medic / Keep training; the Training card has the same
// button); the governor and base leaders move a graduate to Medic while the hospital is short of medics, and keep the
// doctor on Medic duty while anyone trains (planDoctor), quiet ward or not. A trainee counts as half a
// medic toward the staff a tier needs (medical.js TRAINEE_STAFF, staffCount; beside one full medic), takes no
// treatments of their own, catches contagious illness like a medic (health.js) and can still be a patient.
// Compare the Teach role (skills.js): 4 + 0.4 × the teacher's skill + 0.15 × their Leadership and Speech, gap 4, and
// the teacher does no other work; here the doctor keeps treating and the trainee gives up their job instead.
//
// Who assigns trainees: the player (Trainee role, or the Work tab's Trainee column), the governor and base leaders
// (autopilot.js planRoles → planTrainees, Medical area: one trainee while the base has fewer skilled medics than its
// hospital's staff + 1), and the AI groups grow their medics the same way, coarsely (groupcare.js medicTraining).
// tools/clinictest.js tests all of it and measures a medic's Medicine after 180 days with and without lessons.
import { atBase, residents, skill, log, day, addCard } from "./world.js";
import { hospitalDef, activeHospital, traineesHere, isHurt, isSevere } from "./medical.js";
import { workFactor, conditionsOf } from "./health.js";
import { gainXp, hasPerk } from "./skills.js";
import { toManual } from "./work.js"; // "Make medic": a job set by hand
import { noteOutput } from "./output.js"; // the base's Work now panel: what each job brought in a day (activity.js)

export const TRAINING = {
  docMin: 6,        // the doctor needs Medicine 6+ (as shown; the clinic's own requirement)
  gap: 1,           // a trainee learns until their Medicine is the doctor's − 1 (the tier's med.gap: 0 in a trauma
                    // hospital, up to the doctor's own level; the Teach role's gap is 4)
  base: 3,          // lesson XP a day: 3 + 0.4 × the doctor's Medicine (doctor 6: 5.4, 10: 7, 15: 9), × med.teach
  perSkill: 0.4,
  offDuty: 0.5,     // the doctor is not on Medic duty: lessons in the evenings, half as much
  quiet: 0.75,      // nobody here hurt or ill: lessons from the book and the drills
  mentor: 1.5,      // the doctor has the Mentor perk (skills.js, as for the Teach role)
  practice: 4,      // use XP a day for every trainee on the ward (the Medic role's 8 is a full medic's day)
  // The doctor's career: a day they teach anyone gives Leadership and Speech (use XP; the Teach role gives 6 and 4 for a
  // whole day of teaching, the doctor teaches beside the ward work), and counts toward Professor (PROFESSOR below).
  docLead: 4, docSpeech: 3,
  graduate: 6,      // a trainee reaching Medicine 6 graduates: a log line and a card (Make medic / Keep training)
  // The governor and base leaders (planTrainees): a trainee while the base has fewer people with Medicine `skilled`+
  // than its hospital's staff + 1, food for `foodDays` days, at least `minPeople` people and nothing attacking; one
  // trainee (two at `twoAt`+ people), never more than the tier's places. Planned ahead of the comfortable farm crew.
  // While anyone trains, the doctor stays on Medic duty, quiet ward or not (planDoctor).
  skilled: 6, foodDays: 20, minPeople: 4, twoAt: 12, minMood: 35,
};
// Professor of Medicine (an earned perk, skills.js EARNED_PERKS: not one of the milestone choices): a doctor with
// Medicine `minMed`+ who has taught on `days` days earns it for good. Their lessons teach × `mult` (on top of Mentor).
export const PROFESSOR = { days: 60, minMed: 10, mult: 1.25 };
// The lessons' cap below the doctor's Medicine at this hospital (BUILDINGS med.gap).
export const lessonGap = (def) => (def && Number.isFinite(def.gap) ? def.gap : TRAINING.gap);
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
    * workFactor(D) * teacherMult(D);
}
// Mentor (skills.js) and Professor (PROFESSOR) on the doctor.
const teacherMult = (D) => (hasPerk(D, "mentor") ? TRAINING.mentor : 1) * (hasPerk(D, "professor") ? PROFESSOR.mult : 1);

// The doctor at a base: { s, onDuty } giving the best lesson (a medic on duty first at equal worth), or null.
// Nobody on the Trainee role teaches; someone in a bed or too ill to work does not either.
export function doctorAt(state, base) {
  const def = hospitalDef(base);
  if (!def.tier) return null;
  let best = null, bestV = -1;
  for (const s of atBase(state, base.id)) {
    if (s.role === "trainee" || !fit(s) || skill(s, "medicine") < TRAINING.docMin) continue;
    const onDuty = s.role === "medic";
    const v = (TRAINING.base + TRAINING.perSkill * skill(s, "medicine")) * (onDuty ? 1 : TRAINING.offDuty) * workFactor(s) * teacherMult(s) + (onDuty ? 1e-6 : 0);
    if (v > bestV || (v === bestV && best && s.id < best.s.id)) { best = { s, onDuty }; bestV = v; }
  }
  return best;
}

// Why someone learns nothing from the doctor today ("" when they could, place aside).
export function lessonWhy(state, base, t, doc) {
  if (!doc) return `no doctor here (someone with Medicine ${TRAINING.docMin}+ to teach)`;
  if (doc.s === t) return "they are the best medic here";
  if (!fit(t)) return t.inBed ? "in a hospital bed" : "too ill to work";
  const gap = lessonGap(hospitalDef(base));
  const cap = skill(doc.s, "medicine") - gap;
  if (skill(t, "medicine") >= cap) return `Medicine ${skill(t, "medicine")}: lessons go up to ${cap} (${gap ? `${first(doc.s)}'s ${skill(doc.s, "medicine")} − ${gap}` : `${first(doc.s)}'s own Medicine`})`;
  return "";
}
const noPlace = (def) => `no trainee place left (the ${def.name.toLowerCase()} takes ${def.train})`;

// Everything the Medical tab shows (and the daily tick uses): the doctor, the trainees with their places, today's
// lesson for each, the junior medics learning on a place left over, and the ward rounds.
// Places (med.train) go first to the trainees who can learn (lowest ids first), then to junior medics on duty below
// the doctor's cap (they keep the Medic role's 8 a day and their treatments, and take the lesson on top).
export function trainingInfo(state, base) {
  const def = hospitalDef(base);
  const hosp = activeHospital(state, base);
  const medics = medicsOnDuty(state, base);
  const pts = wardPoints(state, base);
  const doc = doctorAt(state, base);
  const quiet = pts <= 0;
  const rate = doc ? lessonRate(state, base, doc.s, doc.onDuty, def, quiet) : 0;
  const cap = doc ? skill(doc.s, "medicine") - lessonGap(def) : null;
  let left = def.train || 0;
  const trainees = traineesHere(state, base).map((s) => {
    let why = def.tier ? lessonWhy(state, base, s, doc) : "no infirmary or hospital here";
    let place = false;
    if (!why) { if (left > 0) { left--; place = true; } else why = noPlace(def); }
    return { s, place, why, xp: why ? 0 : rate * workFactor(s), practice: def.tier && fit(s) ? TRAINING.practice * workFactor(s) : 0, cap };
  });
  const juniors = [];
  if (def.tier && doc) for (const m of medics) {
    if (left <= 0) break;
    if (lessonWhy(state, base, m, doc)) continue;
    left--;
    juniors.push({ s: m, place: true, why: "", xp: rate * workFactor(m), practice: 0, cap, medic: true });
  }
  return { def, hosp, doc, rate, quiet, slots: def.train || 0, left, trainees, juniors, medics, wardPts: pts, wardEach: wardXpEach(state, base, hosp, medics) };
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
    let xp = 0;
    if (t.practice > 0) xp += gainXp(state, t.s, "medicine", t.practice);
    if (t.xp > 0) { xp += gainXp(state, t.s, "medicine", t.xp, "study"); taught++; t.s.trainIdle = false; }
    else if (!t.s.trainIdle && t.why) { log(state, `${first(t.s)} is a Medic trainee at ${base.name} but learns nothing from a doctor: ${t.why}.`, "info"); t.s.trainIdle = true; }
    noteOutput(state, base, "trainee", xp, "xp");
  }
  for (const j of info.juniors) if (j.xp > 0) { gainXp(state, j.s, "medicine", j.xp, "study"); taught++; }
  if (taught && info.doc) doctorCareer(state, base, info.doc.s);
  // Graduation: only for someone who started training below the mark (s.trainFrom: their Medicine the first day seen
  // as a trainee; a medic sent back to the ward to learn more does not "graduate").
  for (const t of info.trainees) {
    if (t.s.trainFrom == null) t.s.trainFrom = skill(t.s, "medicine");
    if (skill(t.s, "medicine") >= TRAINING.graduate && t.s.trainFrom < TRAINING.graduate && !t.s.graduated) graduate(state, base, t.s);
  }
}

// The doctor's career: Leadership and Speech for each day of teaching, and the days toward Professor.
function doctorCareer(state, base, D) {
  gainXp(state, D, "leadership", TRAINING.docLead);
  gainXp(state, D, "speech", TRAINING.docSpeech);
  D.teachDays = (D.teachDays || 0) + 1;
  if (!hasPerk(D, "professor") && D.teachDays >= PROFESSOR.days && skill(D, "medicine") >= PROFESSOR.minMed) {
    (D.perks = D.perks || []).push("professor");
    log(state, `${D.name} has taught medicine at ${base.name} for ${D.teachDays} days: Professor of Medicine (their lessons teach ${Math.round((PROFESSOR.mult - 1) * 100)}% faster, for good).`, "good");
  }
}

// ---------- graduation ----------
// Does this base want another medic? Fewer people on Medic duty than its hospital needs, or fewer skilled medics than
// that + 1 (the governor's own measure, planTrainees).
export function medicWanted(state, base) {
  const def = hospitalDef(base);
  const people = atBase(state, base.id);
  return people.filter((s) => s.role === "medic").length < Math.max(1, def.staff) || people.filter((s) => skill(s, "medicine") >= TRAINING.skilled && s.role !== "trainee").length < def.staff + 1;
}
// Puts someone on the Medic role (the card's and the Training card's "Make medic"): a job set by hand, so they leave
// work priorities (work.js toManual) and the trainee place.
export function makeMedic(state, s) {
  if (!s || !s.alive || !s.location || s.location.kind !== "base") return "They are not at a base.";
  toManual(state, s);
  s.role = "medic";
  s.station = null;
  return `${s.name} now works as a medic.`;
}
// A trainee reached Medicine TRAINING.graduate: a log line and a card. The governor answers it by what the base needs
// (and its roles plan moves graduates to Medic the same way, planTrainees).
function graduate(state, base, s) {
  s.graduated = day(state);
  log(state, `${s.name} graduated as a medic at ${base.name} (Medicine ${skill(s, "medicine")}).`, "good");
  addCard(state, {
    title: `${first(s)} graduated`,
    text: `${s.name} reached Medicine ${skill(s, "medicine")} as a trainee at ${base.name}. Put them on the Medic role, or keep them training under the doctor (the lessons go on while their Medicine is below the doctor's cap).`,
    choices: [
      { label: "Make medic", hint: "They take the Medic role (by hand: off work priorities): they treat patients and count as a full medic.",
        disabled: () => !s.alive || s.location.kind !== "base", ai: (st) => (!s.pinned && medicWanted(st, base) ? 2 : 0), resolve: (st) => makeMedic(st, s) },
      // The governor leaves a pinned trainee where they are (pinned: nobody but you moves them).
      { label: "Keep training", hint: "They stay a trainee on the ward.", ai: (st) => (!s.pinned && medicWanted(st, base) ? 0 : 1), resolve: () => `${first(s)} keeps training.` },
    ],
  });
}

// ---------- the governor and base leaders (autopilot.js planRoles) ----------
// free: the people still without a role this hour; give(s, role). A trainee while the base has fewer skilled medics
// (Medicine TRAINING.skilled+) than its hospital's staff + 1, food is comfortable and nothing is attacking. Those
// already training keep it first (they stop once they reach the skill or the lessons stop). A graduate (Medicine
// TRAINING.graduate+) goes to Medic while fewer people are on Medic duty than the hospital needs (medics: the ones the
// plan has on it already).
export function planTrainees(state, base, free, give, { foodDays = 0, urgent = false, medics = 0 } = {}) {
  const def = hospitalDef(base);
  const people = atBase(state, base.id);
  if (!def.tier || !def.train) return 0;
  let onDuty = medics;
  for (const s of [...free].filter((x) => x.role === "trainee" && skill(x, "medicine") >= TRAINING.graduate && fit(x)).sort((a, b) => skill(b, "medicine") - skill(a, "medicine") || a.id - b.id)) {
    if (onDuty >= def.staff) break;
    give(s, "medic");
    onDuty++;
  }
  if (urgent || people.length < TRAINING.minPeople || foodDays < TRAINING.foodDays) return 0;
  const skilled = people.filter((s) => skill(s, "medicine") >= TRAINING.skilled).length;
  if (skilled >= def.staff + 1) return 0;
  const doc = doctorAt(state, base);
  if (!doc) return 0;
  const want = Math.min(def.train, people.length >= TRAINING.twoAt ? 2 : 1);
  let n = people.filter((s) => s.role === "trainee" && !free.has(s)).length; // trainees someone else keeps (pinned, priorities)
  const cap = skill(doc.s, "medicine") - lessonGap(def);
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

// The doctor stays on Medic duty while anyone trains here, quiet ward or not (the governor sends medics only to a
// ward with patients; off duty the lessons are halved). trainees: the people on the Trainee role in the plan (and
// those kept by someone else); medics: the people the plan already has on Medic duty. Takes the best Medicine
// TRAINING.docMin+ among the people still free; gives nothing when a medic on duty already teaches.
export function planDoctor(state, base, free, give, { trainees = 0, medics = [] } = {}) {
  if (!trainees || !hospitalDef(base).tier) return null;
  if (medics.some((m) => skill(m, "medicine") >= TRAINING.docMin)) return null;
  const D = [...free].filter((s) => fit(s) && s.role !== "trainee" && skill(s, "medicine") >= TRAINING.docMin)
    .sort((a, b) => skill(b, "medicine") - skill(a, "medicine") || a.id - b.id)[0];
  if (D) give(D, "medic");
  return D || null;
}

// The Help topic (ui/help.js) and the codex.
export const TRAINING_HELP = `<p><b>Training medics.</b> Every hospital (from the makeshift infirmary up) trains medics two ways.</p>
<p><i>Ward rounds:</i> medics on duty learn from the patients. On top of the Medic role's 8 Medicine XP a day and the XP for each treatment, each patient adds to the ward (${WARD.bed} in a bed, ${WARD.walking} on their feet, +${WARD.severe} for a severe wound, +${WARD.infected} for an infected one, +${WARD.ill} an illness), shared among the medics on duty and capped a day by the tier: infirmary 4, field hospital 6, clinic 8, trauma hospital 10. A better hospital teaches more from each case (× 1, 1.2, 1.45, 1.75). An empty ward teaches nothing extra.</p>
<p><i>Medic trainees:</i> put someone on the <b>Trainee</b> role (or set Trainee in the Work tab). The doctor, the best medic at the base with Medicine ${TRAINING.docMin}+, teaches them Medicine every day: ${TRAINING.base} + ${TRAINING.perSkill} × the doctor's Medicine XP, × the tier's factor, × ${TRAINING.quiet} on a quiet ward, half when the doctor is not on Medic duty (evening lessons), × ${TRAINING.mentor} with the Mentor perk. Lessons stop ${TRAINING.gap} below the doctor's Medicine (in a trauma hospital, at the doctor's own level). A doctor who has taught on ${PROFESSOR.days} days with Medicine ${PROFESSOR.minMed}+ becomes a <b>Professor of Medicine</b> (lessons ${Math.round((PROFESSOR.mult - 1) * 100)}% faster, for good), and every day of teaching gives the doctor ${TRAINING.docLead} Leadership and ${TRAINING.docSpeech} Speech XP. A trainee reaching Medicine ${TRAINING.graduate} <b>graduates</b>: a card offers <i>Make medic</i> (the Medical tab has the same button). Every trainee also gets ${TRAINING.practice} XP a day for the ward work. Places: 1 in an infirmary or field hospital, 2 in a clinic, 3 in a trauma hospital; a place no trainee uses goes to a junior medic on duty below that cap, who takes the lesson on top of their own work. A trainee counts as half a medic toward the staff a hospital needs (beside at least one full medic), gives no treatments and catches illness on the ward like a medic. The Medical tab shows the doctor, the trainees and their progress. The governor and base leaders put one trainee on the ward while a base has fewer medics with Medicine ${TRAINING.skilled}+ than its hospital needs plus one, keep the doctor on Medic duty while anyone trains, and move a graduate to Medic while the hospital is short of medics.</p>
<p><i>The other groups</i> build sick bays too (an infirmary up to a trauma hospital, shown on their Groups card): it speeds their healing, and their doctor trains their medics the same way.</p>`;
