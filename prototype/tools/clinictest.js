// Training medics (src/sim/training.js): ward rounds for medics on duty (by the patients, the tier's cap, their own
// daily bucket), the doctor and the Medic trainees' lessons (rate, places, the cap below the doctor, off duty, quiet
// ward), trainees as half a medic for staffing, the governor's and base leaders' trainee (autopilot.js planTrainees),
// the Trainee work type (work.js), the AI groups' medics (groupcare.js medicTraining), save and load, and a short
// autopilot run without NaN.
// --measure: a medic's Medicine after 180 days (autopilot campaigns, a clinic at the hub with a Medicine 10 doctor
// pinned on Medic duty): the subject (Medicine 3) pinned on the Medic role (no lessons) against the same person on the
// Trainee role, on a few seeds.
// Usage: node tools/clinictest.js [seed] [--measure] [--days 180] [--seeds 1,2,3]
import { createWorld, tickHour, day, hub, atBase, alive, makeSurvivor, skill } from "../src/sim/world.js";
import { SKILLS } from "../src/sim/data.js";
import { BUILDINGS, addBuilding } from "../src/sim/buildings.js";
import { activeHospital, TRAINEE_STAFF, medicalHour } from "../src/sim/medical.js";
import * as T from "../src/sim/training.js";
import { ensureSkills, CAP_WARD, CAP_STUDY, USE, EARNED_PERKS, PERKS, hasPerk, xpNeed } from "../src/sim/skills.js";
import { addCondition } from "../src/sim/health.js";
import { governRoles, setAutopilot } from "../src/sim/autopilot.js";
import { WORK_TYPES, workState, planBase } from "../src/sim/work.js";
import { medicTraining, medOf, medicSkillMult, groupHospitalTier, healRate, GROUP_MED } from "../src/sim/groupcare.js";
import { nextWork, groupWorksDaily, sickbayTier, worksText, groupsBuild, GROUP_WORKS } from "../src/sim/groupworks.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { ROLES } from "../src/sim/economy.js";

const args = process.argv.slice(2);
const SEED = Number(args.find((a) => /^\d+$/.test(a)) || 7);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
let pass = 0, fail = 0;
const check = (ok, text) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${text}`); };
const r1 = (v) => Math.round(v * 10) / 10;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// A bare hub (everyone moved to a far-off party-free limbo: they stay alive but not at the base), plus a hospital.
function world(seed = SEED, hosp = "infirmary") {
  const st = createWorld({ seed, factionCount: 4 });
  st.started = true;
  const h = hub(st);
  for (const s of atBase(st, h.id)) { s.alive = false; s.location = { kind: "gone" }; }
  if (hosp) addBuilding(h, hosp);
  return { st, h };
}
function person(st, med, role = "rest", other = {}) {
  const s = makeSurvivor(st);
  for (const k of SKILLS) s.skills[k] = 0;
  s.skills.medicine = med;
  Object.assign(s.skills, other);
  s.traits = [];
  s.mood = 60;
  s.health = 100;
  s.conditions = [];
  s.woundInfected = false;
  s.role = role;
  s.location = { kind: "base", baseId: hub(st).id };
  st.survivors.push(s);
  ensureSkills(st, s);
  s.perkPending = [];
  return s;
}
const xpToday = (s, src) => ((s.xpDay && s.xpDay[src] && s.xpDay[src].medicine) || 0);
const nextDay = (st) => { st.hour += 24; };

// ---------- 0. tables ----------
console.log("Tables");
{
  const tiers = ["infirmary", "field_hosp", "clinic", "hospital"].map((k) => BUILDINGS[k].med);
  check(tiers.map((m) => m.train).join() === "1,1,2,3", `trainee places by tier ${tiers.map((m) => m.train)}`);
  check(tiers.every((m, i) => !i || (m.teach > tiers[i - 1].teach && m.ward > tiers[i - 1].ward)), "teach factor and ward cap grow with the tier");
  check(tiers.every((m) => m.ward <= CAP_WARD), `every tier's ward cap within CAP_WARD ${CAP_WARD}`);
  check(!!ROLES.trainee && !!WORK_TYPES.trainee, "Trainee role and work type exist");
  check(/Medic trainee/.test(BUILDINGS.clinic.desc), "the clinic's description names its trainee places");
}

// ---------- 1. ward rounds ----------
console.log("Ward rounds");
{
  const { st, h } = world();
  const m = person(st, 4, "medic");
  // An empty ward: no ward XP.
  check(T.wardPoints(st, h) === 0 && T.wardXpEach(st, h) === 0, "empty ward: no ward XP");
  T.trainingDaily(st);
  check(xpToday(m, "ward") === 0, "empty ward: the medic's ward bucket stays empty");
  // One patient in a bed with a severe infected wound, one walking with an illness.
  const p1 = person(st, 0, "rest"); p1.health = 20; p1.woundInfected = true;
  const p2 = person(st, 0, "farm"); p2.health = 90; addCondition(st, p2, "chestcold");
  medicalHour(st);
  check(p1.inBed, "the badly hurt patient takes a bed");
  const pts = T.wardPoints(st, h);
  const want = T.WARD.bed + T.WARD.severe + T.WARD.infected + T.WARD.walking + T.WARD.ill * p2.conditions.length;
  check(near(pts, want), `ward points ${pts} = ${want} (bed, severe, infected, walking, illness)`);
  const each = T.wardXpEach(st, h);
  check(near(each, Math.min(BUILDINGS.infirmary.med.ward, pts)), `infirmary: ${r1(each)} a day, capped at ${BUILDINGS.infirmary.med.ward}`);
  nextDay(st);
  T.trainingDaily(st);
  check(near(xpToday(m, "ward"), each), `the medic earned ${r1(xpToday(m, "ward"))} ward XP (own bucket)`);
  T.trainingDaily(st);
  check(near(xpToday(m, "ward"), each), "a second call the same day adds nothing past the tier's cap");
  // Shared among medics.
  const m2 = person(st, 4, "medic");
  check(near(T.wardXpEach(st, h), Math.min(4, pts / 2)), `two medics share the ward: ${r1(T.wardXpEach(st, h))} each`);
  // Clinic: teach factor and a higher cap.
  addBuilding(h, "clinic");
  const hc = activeHospital(st, h);
  check(hc.tier === 3, "two medics run the clinic");
  check(near(T.wardXpEach(st, h), Math.min(8, (pts * 1.45) / 2)), `clinic: × 1.45, cap 8: ${r1(T.wardXpEach(st, h))} each`);
  void m2;
}

// ---------- 2. doctor and lessons ----------
console.log("Doctor and lessons");
{
  const { st, h } = world(SEED, "infirmary");
  check(T.doctorAt(st, h) === null, "nobody: no doctor");
  const low = person(st, 5, "medic");
  check(T.doctorAt(st, h) === null, `a medic below Medicine ${T.TRAINING.docMin} is no doctor`);
  const doc = person(st, 10, "medic");
  const d = T.doctorAt(st, h);
  check(d && d.s === doc && d.onDuty, "the best medic on duty is the doctor");
  const tr = person(st, 2, "trainee");
  const info = T.trainingInfo(st, h);
  const rate = (T.TRAINING.base + T.TRAINING.perSkill * 10) * BUILDINGS.infirmary.med.teach * T.TRAINING.quiet;
  check(info.quiet && near(info.trainees[0].xp, rate), `quiet ward, infirmary, doctor 10: ${r1(info.trainees[0].xp)} = ${r1(rate)} a day`);
  nextDay(st);
  T.trainingDaily(st);
  check(near(xpToday(tr, "study"), rate) && near(tr.xpDay.use.medicine, T.TRAINING.practice), `the trainee got ${r1(xpToday(tr, "study"))} study + ${tr.xpDay.use.medicine} ward-work XP`);
  check((doc.xpDay.use.leadership || 0) === T.TRAINING.docLead, "the doctor gains Leadership for teaching");
  // A patient: no longer quiet.
  const p = person(st, 0, "rest"); p.health = 50;
  check(near(T.trainingInfo(st, h).trainees[0].xp, rate / T.TRAINING.quiet), "with a patient the lesson is full speed");
  // Places: a second trainee in an infirmary has none.
  const tr2 = person(st, 1, "trainee");
  const i2 = T.trainingInfo(st, h);
  check(i2.trainees[1].s === tr2 && !i2.trainees[1].place && i2.trainees[1].xp === 0 && /place/.test(i2.trainees[1].why), "the infirmary's second trainee has no place");
  addBuilding(h, "clinic");
  const i3 = T.trainingInfo(st, h);
  check(i3.trainees.every((x) => x.place && x.xp > 0), "the clinic takes both");
  check(near(i3.trainees[0].xp, (T.TRAINING.base + T.TRAINING.perSkill * 10) * 1.45), `clinic lesson × 1.45: ${r1(i3.trainees[0].xp)}`);
  // The cap: doctor − gap.
  tr.skills.medicine = 9;
  check(T.trainingInfo(st, h).trainees[0].xp === 0 && /up to 9/.test(T.trainingInfo(st, h).trainees[0].why), "clinic: lessons stop at the doctor's Medicine − 1");
  tr.skills.medicine = 8;
  check(T.trainingInfo(st, h).trainees[0].xp > 0, "one below the cap still learns");
  addBuilding(h, "hospital");
  tr.skills.medicine = 9;
  check(T.trainingInfo(st, h).trainees[0].xp > 0, "trauma hospital: a trainee at the doctor's − 1 still learns (up to the doctor's own level)");
  tr.skills.medicine = 10;
  check(T.trainingInfo(st, h).trainees[0].xp === 0 && /own Medicine/.test(T.trainingInfo(st, h).trainees[0].why), "…and stops at the doctor's own Medicine");
  addBuilding(h, "clinic");
  tr.skills.medicine = 8;
  // Off duty: the doctor on another job teaches in the evenings at half speed.
  doc.role = "farm";
  low.role = "farm";
  const od = T.doctorAt(st, h);
  check(od && od.s === doc && !od.onDuty, "off duty, still the doctor");
  check(near(T.trainingInfo(st, h).trainees[0].xp, (T.TRAINING.base + T.TRAINING.perSkill * 10) * 1.45 * T.TRAINING.offDuty), "off duty: half the lesson");
  // A trainee is never the doctor.
  doc.role = "trainee";
  check(!T.doctorAt(st, h) || T.doctorAt(st, h).s !== doc, "someone on the Trainee role does not teach");
}

// ---------- 2b. junior medics on a free place ----------
console.log("Junior medics");
{
  const { st, h } = world(SEED, "clinic");
  const doc = person(st, 10, "medic");
  const jr = person(st, 3, "medic");
  const i1 = T.trainingInfo(st, h);
  check(i1.juniors.length === 1 && i1.juniors[0].s === jr && near(i1.juniors[0].xp, i1.rate), `a junior medic on duty takes a free place: +${r1(i1.juniors[0].xp)} a day`);
  nextDay(st);
  T.trainingDaily(st);
  check(near(xpToday(jr, "study"), i1.rate) && xpToday(doc, "study") === 0, "the junior learns, the doctor does not");
  person(st, 1, "trainee"); person(st, 2, "trainee");
  const i2 = T.trainingInfo(st, h);
  check(i2.juniors.length === 0 && i2.trainees.every((x) => x.place), "trainees take the places first");
  const capped = person(st, 9, "trainee");
  check(!T.trainingInfo(st, h).trainees.find((x) => x.s === capped).place, "a trainee at the cap takes no place");
}

// ---------- 3. staffing: a trainee is half a medic ----------
console.log("Staffing");
{
  const { st, h } = world(SEED, "clinic");
  const a = person(st, 8, "medic");
  check(activeHospital(st, h).tier === 2 && !activeHospital(st, h).staffed, "clinic with 1 medic runs as a field hospital");
  const t1 = person(st, 1, "trainee");
  check(activeHospital(st, h).staffCount === 1 + TRAINEE_STAFF && !activeHospital(st, h).staffed, "one trainee: 1.5 of 2");
  person(st, 1, "trainee");
  check(activeHospital(st, h).staffed && activeHospital(st, h).tier === 3, "two trainees and a medic run the clinic");
  person(st, 1, "trainee");
  check(activeHospital(st, h).staffCount === 2, "a third trainee has no place: still 2");
  a.role = "farm";
  check(activeHospital(st, h).tier === 0, "trainees alone do not run a hospital");
  a.role = "medic";
  t1.inBed = true;
  check(activeHospital(st, h).staffCount === 1 + 2 * TRAINEE_STAFF, "a trainee in a bed does not count (the next one takes the place)");
}

// ---------- 4. the governor and base leaders ----------
console.log("Governor");
{
  const { st, h } = world(SEED, "infirmary");
  h.stock.food = 400;
  const doc = person(st, 10, "medic");
  const cand = [1, 4, 2, 0].map((m) => person(st, m, "farm"));
  doc.pinned = true;
  governRoles(st, h);
  const tr = atBase(st, h.id).filter((s) => s.role === "trainee");
  check(tr.length === 1 && tr[0] === cand[1], `one trainee, the most Medicine below the cap (${tr.map((s) => skill(s, "medicine"))})`);
  governRoles(st, h);
  check(atBase(st, h.id).filter((s) => s.role === "trainee").length === 1 && cand[1].role === "trainee", "kept the next hour");
  // Enough skilled medics: no trainee.
  cand[1].skills.medicine = 7;
  cand[0].skills.medicine = 0;
  governRoles(st, h);
  check(!atBase(st, h.id).some((s) => s.role === "trainee"), "two people with Medicine 6+ at an infirmary: no trainee");
  // Food short: none.
  cand[1].skills.medicine = 3;
  h.stock.food = 5;
  for (const k of Object.keys(h.stock)) if (/food|preserved/.test(k)) h.stock[k] = 0;
  governRoles(st, h);
  check(!atBase(st, h.id).some((s) => s.role === "trainee"), "food short: no trainee");
}

// ---------- 5. work priorities ----------
console.log("Work priorities");
{
  const { st, h } = world(SEED, "infirmary");
  h.stock.food = 400;
  workState(st);
  const medicRole = st.work.roles.find((r) => r.name === "Medic");
  check(medicRole && medicRole.pri.trainee === 2, "the default Medic role has Trainee at 2");
  const doc = person(st, 10, "medic"); doc.pinned = true;
  const a = person(st, 3, "farm"), b = person(st, 9, "farm");
  for (const s of [a, b]) s.work = { role: medicRole.id, over: {} };
  st.hour = Math.floor(st.hour / 24) * 24 + 10;
  planBase(st, h);
  check(a.role === "trainee", `Medicine 3 on the Medic role trains (${a.role}: ${a.task && a.task.why})`);
  check(b.role !== "trainee", `Medicine 9 is within 2 of the doctor: not a trainee (${b.role})`);
}

// ---------- 6. AI groups ----------
console.log("AI groups");
{
  const st = createWorld({ seed: SEED, factionCount: 6 });
  const f = st.factions.find((x) => x.type === "military") || st.factions[0];
  f.pop = Math.max(f.pop, 30);
  delete f.med;
  const m = medOf(f);
  const start = GROUP_MED.start[f.type] || GROUP_MED.dflt;
  check(m.doc === start[0] && m.staff === start[1], `starts by type: doctor ${m.doc}, medics ${m.staff}`);
  const t0 = groupHospitalTier(st, f);
  f.works = f.works || {};
  f.works[f.bases[0]] = { ...(f.works[f.bases[0]] || {}), beds: 1, bench: 1, sickbay: 3 }; // a clinic built
  const tier = groupHospitalTier(st, f);
  check(tier === (st.groupWorks ? 3 : GROUP_MED.builtTier[f.type]), `sick bay tier ${t0} → ${tier} with a clinic built`);
  f.wounded = 6;
  const before = healRate(f).rate;
  let xp = 0;
  // Wounded a third of the time (a fight's wounded heal in about ten days).
  const wounds = (g, d) => { g.wounded = d % 30 < 10 ? 6 : 0; };
  for (let d = 0; d < 180; d++) { wounds(f, d); xp += medicTraining(st, f); }
  f.wounded = 6;
  check(xp > 0 && m.staff > start[1], `180 days: medics ${start[1]} → ${m.staff}, doctor ${start[0]} → ${m.doc}`);
  check(m.staff <= m.doc, "the medics stay at or below the doctor");
  check(healRate(f).rate > before && medicSkillMult(f) > 1, `better medics heal faster (${r1(medicSkillMult(f) * 100) / 100}×)`);
  // Without a sick bay: no lessons, slower.
  const g = { type: f.type, pop: 30, wounded: 6, bases: [], works: {}, stock: { meds: 0 } };
  const saveWorks = st.groupWorks; st.groupWorks = true; // bare-start rules: nothing built, no sick bay
  check(groupHospitalTier(st, g) === 0, "a bare group has no sick bay");
  let xpG = 0;
  for (let d = 0; d < 180; d++) { wounds(g, d); xpG += medicTraining(st, g); }
  check(xpG < xp * 0.8, `no sick bay: the medics' XP ${Math.round(xpG)} against ${Math.round(xp)} with one (Medicine ${medOf(g).staff} and ${m.staff}; both stop at their doctor's)`);
  st.groupWorks = saveWorks;
}

// ---------- 6b. AI groups build their sick bays (groupworks.js) ----------
console.log("AI sick bays");
{
  const st = createWorld({ seed: SEED, factionCount: 6 });
  const f = st.factions.find((x) => x.alive && x.bases && x.bases.length) || st.factions[0];
  check(!!st.groupWorks && groupsBuild(st, f), "a new world's groups build");
  const main = f.bases[0];
  f.works = { [main]: { water: 9, farms: 9, beds: 9, walls: 9, bench: 1, store: 1 } };
  f.pop = 30; f.wounded = 3; f.stock.food = 9999;
  const nw = nextWork(st, f);
  check(nw && nw.type === "sickbay" && nw.tile === main, `with wounded and quarters up, the next job is the sick bay (${nw && nw.type}: ${nw && nw.why})`);
  const before = healRate(f, 0).rate, bay = healRate(f, 1).rate;
  f.stock.scrap = 500; f.stock.parts = 50; f.stock.meds = 50;
  for (let d = 0; d < 400 && sickbayTier(f) < 2; d++) groupWorksDaily(st, f);
  check(sickbayTier(f) >= 2, `they build it and upgrade it once the workshop is up (tier ${sickbayTier(f)})`);
  check(/infirmary|field hospital|clinic/.test(worksText(st, f)), `the Groups card shows it: "${worksText(st, f)}"`);
  check(bay > before && groupHospitalTier(st, f) === sickbayTier(f), "the sick bay speeds their healing and sets their medics' training");
  medOf(f).doc = 5;
  for (let d = 0; d < 200; d++) groupWorksDaily(st, f);
  check(sickbayTier(f) === 2, `no clinic without a Medicine ${GROUP_WORKS.SICKBAY[2].doc} doctor (tier ${sickbayTier(f)})`);
  medOf(f).doc = 12;
  for (let d = 0; d < 400 && sickbayTier(f) < 4; d++) groupWorksDaily(st, f);
  check(sickbayTier(f) === 4, `with a Medicine 12 doctor they reach the trauma hospital (tier ${sickbayTier(f)})`);
}

// ---------- 6c. the doctor stays on duty, the doctor's career, graduation ----------
console.log("Doctor on duty, career, graduation");
{
  const { st, h } = world(SEED, "infirmary");
  h.stock.food = 400;
  const doc = person(st, 10, "farm");
  const tr = person(st, 2, "trainee"); tr.pinned = true;
  [1, 2, 3].forEach((m) => person(st, m, "farm"));
  governRoles(st, h);
  check(doc.role === "medic" && T.wardPoints(st, h) === 0, `a quiet ward with a trainee: the governor keeps the doctor on Medic duty (${doc.role})`);
  tr.role = "farm"; tr.pinned = false;
  for (const s of atBase(st, h.id)) if (s.role === "trainee") s.role = "farm";
  const st2 = world(SEED, "infirmary"); st2.h.stock.food = 5;
  const d2 = person(st2.st, 10, "farm"); [1, 2, 3, 4].forEach((m) => person(st2.st, m, "farm"));
  governRoles(st2.st, st2.h);
  check(d2.role !== "medic", "no trainees and nobody hurt: the doctor is not kept on duty");
  // Work priorities: the Doctor type opens for trainees on a quiet ward.
  const w3 = world(SEED, "infirmary"); w3.h.stock.food = 400;
  workState(w3.st);
  const medicRole = w3.st.work.roles.find((r) => r.name === "Medic");
  const dd = person(w3.st, 10, "farm"); dd.work = { role: medicRole.id, over: {} };
  const tt = person(w3.st, 2, "trainee"); tt.pinned = true;
  w3.st.hour = Math.floor(w3.st.hour / 24) * 24 + 10;
  planBase(w3.st, w3.h);
  check(dd.role === "medic", `priorities: the doctor stays on duty for the trainee (${dd.role}: ${dd.task && dd.task.why})`);
  // Career: Leadership and Speech a day of teaching, Professor after PROFESSOR.days.
  const c = world(SEED, "clinic");
  const D = person(c.st, 12, "medic"), L = person(c.st, 2, "trainee");
  const r0 = T.trainingInfo(c.st, c.h).rate;
  nextDay(c.st); T.trainingDaily(c.st);
  check((D.xpDay.use.leadership || 0) === T.TRAINING.docLead && (D.xpDay.use.speech || 0) === T.TRAINING.docSpeech && D.teachDays === 1, `a day of teaching: Leadership ${D.xpDay.use.leadership}, Speech ${D.xpDay.use.speech}, 1 day toward Professor`);
  D.teachDays = T.PROFESSOR.days - 1;
  nextDay(c.st); T.trainingDaily(c.st);
  check(D.perks.includes("professor") && c.st.log.some((l) => /Professor of Medicine/.test(l.text)), "after 60 days of teaching with Medicine 10+: Professor of Medicine (logged)");
  check(near(T.trainingInfo(c.st, c.h).rate, r0 * T.PROFESSOR.mult), `a Professor's lessons × ${T.PROFESSOR.mult}`);
  check(!!EARNED_PERKS.professor && !PERKS.professor, "Professor is an earned perk, not a milestone choice");
  const low = world(SEED, "clinic"); const D2 = person(low.st, 8, "medic"); person(low.st, 2, "trainee");
  D2.teachDays = 200; nextDay(low.st); T.trainingDaily(low.st);
  check(!hasPerk(D2, "professor"), "a doctor below Medicine 10 does not become a Professor");
  // Graduation.
  const g = world(SEED, "clinic");
  const GD = person(g.st, 12, "medic"), G = person(g.st, 5, "trainee");
  void GD;
  nextDay(g.st); T.trainingDaily(g.st); // seen as a trainee at 5
  G.xp.medicine = xpNeed(5) - 1;
  nextDay(g.st); T.trainingDaily(g.st);
  const card = g.st.cards.find((x) => /graduated/.test(x.title));
  check(skill(G, "medicine") === 6 && !!G.graduated && !!card && g.st.log.some((l) => /graduated as a medic/.test(l.text)), "reaching Medicine 6 as a trainee: graduation logged, a card");
  nextDay(g.st); T.trainingDaily(g.st);
  check(g.st.cards.filter((x) => /graduated/.test(x.title)).length === 1, "only once");
  const mk = card.choices.find((ch) => ch.label === "Make medic");
  mk.resolve(g.st);
  check(G.role === "medic", "Make medic: they take the Medic role");
  const already = person(g.st, 7, "trainee");
  nextDay(g.st); T.trainingDaily(g.st);
  check(!already.graduated, "someone who was already past 6 when put on the ward does not graduate");
  // The governor moves a graduate to Medic while the hospital is short of medics.
  const gv = world(SEED, "clinic"); gv.h.stock.food = 400;
  const gd = person(gv.st, 12, "medic"); gd.pinned = true;
  const grad = person(gv.st, 7, "trainee");
  [1, 2, 3].forEach((m) => person(gv.st, m, "farm"));
  governRoles(gv.st, gv.h);
  check(grad.role === "medic", `the clinic needs 2 medics: the governor moves the graduate to Medic (${grad.role})`);
}

// ---------- 7. save and load, and a short run ----------
console.log("Save, load, short run");
{
  const st = createWorld({ seed: SEED, factionCount: 4 });
  st.started = true;
  setAutopilot(st, true, "balanced");
  const h = hub(st);
  addBuilding(h, "clinic");
  const ppl = atBase(st, h.id);
  ppl[0].skills.medicine = 12; ppl[0].role = "medic"; ppl[0].pinned = true;
  ppl[1].skills.medicine = 2; ppl[1].role = "trainee"; ppl[1].pinned = true;
  ppl[2].health = 40;
  let err = null;
  try { for (let i = 0; i < 24 * 40; i++) { tickHour(st); st.cards.length = 0; } } catch (e) { err = e; }
  check(!err, `40 autopilot days ran${err ? `: ${err.stack}` : ""}`);
  check(alive(st).every((s) => SKILLS.every((k) => Number.isFinite(s.skills[k]) && Number.isFinite((s.xp && s.xp[k]) || 0))), "no NaN in skills or XP");
  check(st.factions.every((f) => !f.med || (Number.isFinite(f.med.staff) && Number.isFinite(f.med.doc))), "no NaN in the groups' medics");
  check(skill(ppl[1], "medicine") > 2, `the trainee learned (Medicine 2 → ${skill(ppl[1], "medicine")})`);
  const again = deserializeState(JSON.parse(JSON.stringify(serializeState(st, { dropCards: true }))));
  const s1 = again.survivors.find((s) => s.id === ppl[1].id);
  check(s1.role === "trainee" && s1.skills.medicine === ppl[1].skills.medicine && Math.abs((s1.xp.medicine || 0) - (ppl[1].xp.medicine || 0)) < 1e-9, "the trainee, their Medicine and progress survive save and load");
  const f0 = st.factions.find((f) => f.med);
  const f1 = f0 && again.factions.find((f) => f.name === f0.name);
  check(!f0 || (f1 && f1.med && f1.med.staff === f0.med.staff && f1.med.staffXp === f0.med.staffXp), "a group's medics survive save and load");
  const h2 = again.bases.find((b) => b.id === h.id);
  check(T.trainingInfo(again, h2).trainees.length === 1, "the loaded world shows the trainee");
  // The screens: the Medical tab's Training card, the Overview's role count, the Help topic.
  const UI = await import("../src/ui/ui.js");
  const { helpTopics } = await import("../src/ui/help.js");
  const ui = { started: true, speed: 0, tab: "bases", selected: h.tile, survivor: null, baseView: { id: h.id, tab: "medical" }, expedition: null, diary: null, roster: null, help: false };
  let html = "", crash = "";
  try { html = UI.renderModal(st, ui) || ""; ui.baseView.tab = "overview"; html += "@@SPLIT@@" + (UI.renderModal(st, ui) || ""); } catch (e) { crash = e.stack.split(String.fromCharCode(10)).slice(0, 3).join(" | "); }
  check(!crash, `Medical and Overview tabs drawn ${crash}`);
  const med = html.split("@@SPLIT@@")[0];
  check(/<h3[^>]*>Training<\/h3>/.test(med) && med.includes("Doctor: <b>") && med.includes(ppl[1].name) && med.includes('data-action="traineeop"'), "the Medical tab shows the doctor, the trainee and the trainee picker");
  check(/places? used · a trainee counts as half a medic/.test(med) && /Ward rounds:/.test(med), "…the places and the ward rounds");
  check(/<b>Trainee<\/b> 1/.test(html.split("@@SPLIT@@")[1] || ""), "the Overview counts the trainee");
  check(skill(ppl[1], "medicine") < T.TRAINING.graduate || med.includes('data-action="makemedic"'), `a trainee at Medicine ${skill(ppl[1], "medicine")} has the Make medic button`);
  check(/to Professor|Professor<\/span>/.test(med), "the doctor's road to Professor is shown");
  check(helpTopics().some((t) => /Training medics/.test(t.title) && /Medic trainees/.test(t.html || t.body || "")), "Help has a Training medics topic");
}

// ---------- --measure ----------
if (args.includes("--measure")) {
  const days = Number(opt("--days", 180));
  const seeds = String(opt("--seeds", "1,2,3")).split(",").map(Number);
  console.log(`Measure: Medicine 3 → after ${days} days at a clinic with a Medicine 10 doctor on duty (autopilot)`);
  // lessons: false runs with no trainee places (the arm without teaching: the tables put back after).
  const run = (seed, role, lessons = true) => {
    const keep = Object.fromEntries(Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].family === "hospital").map((k) => [k, BUILDINGS[k].med.train]));
    if (!lessons) for (const k of Object.keys(keep)) BUILDINGS[k].med.train = 0;
    try {
      const st = createWorld({ seed, factionCount: 4 });
      st.started = true;
      setAutopilot(st, true, "balanced");
      const h = hub(st);
      addBuilding(h, "clinic");
      const doc = person(st, 10, "medic"); doc.pinned = true;
      const sub = person(st, 3, role); sub.pinned = true;
      const lv = {};
      const srcs = { use: 0, ward: 0, study: 0 };
      let lastD = -1;
      for (let i = 0; i < days * 24 && !st.gameOver; i++) {
        tickHour(st);
        st.cards.length = 0;
        const t = sub.xpDay;
        if (t && t.d !== lastD && st.hour % 24 === 23) { lastD = t.d; for (const k of Object.keys(srcs)) srcs[k] += (t[k] && t[k].medicine) || 0; }
        if ((i + 1) % (24 * 30) === 0) lv[(i + 1) / 24] = skill(sub, "medicine");
      }
      return { end: skill(sub, "medicine"), lv, srcs, doc: skill(doc, "medicine") };
    } finally { for (const [k, v] of Object.entries(keep)) BUILDINGS[k].med.train = v; }
  };
  for (const seed of seeds) {
    const fmt = (x) => `${x.end} (by month ${Object.values(x.lv).join(" ")}; XP use ${Math.round(x.srcs.use)}, ward ${Math.round(x.srcs.ward)}, lessons ${Math.round(x.srcs.study)}; doctor ${x.doc})`;
    console.log(`  seed ${seed}: Medic, no lessons    ${fmt(run(seed, "medic", false))}`);
    console.log(`          Medic, lessons       ${fmt(run(seed, "medic"))}`);
    console.log(`          Trainee              ${fmt(run(seed, "trainee"))}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
console.log(fail ? "failed" : "passed");
process.exit(fail ? 1 : 0);
