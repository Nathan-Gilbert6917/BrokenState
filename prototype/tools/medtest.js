// Headless medical test: hospital tiers through the build queue, staffing, passive healing and bed caps,
// treating at a base (meds use, tier effects), field treatment with a team's carried meds, infected
// wounds, and a short campaign with a staffed clinic to check nothing crashes. Treatment limits (B-20, P-10): one
// wound treatment per patient per day (base and field), worst off first in automatic care, the meds reserve kept by
// every automatic dose, medic treatment capacity and surgery time; the admit line for beds and an understaffed
// upgrade running as a lower tier (B-10); the Medical tab's rate against the real change (P-21); 200 days, no NaN.
// Usage: node tools/medtest.js [days] [seed]
import { stockTools } from "./toolset.js"; // every tool a build or recipe can need (toolreqs.js)
import { food, addDays } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { unlockAll } from "../src/sim/blueprints.js";
import { createWorld, tickHour, hub, atBase, alive, residents, makeSurvivor, day } from "../src/sim/world.js";
import { addBuilding, queueBuild, canBuild, constructionHour, BUILDINGS } from "../src/sim/buildings.js";
import { launchExpedition } from "../src/sim/parties.js";
import {
  hospitalTier, activeHospital, patients, healRatePerHour, medicalHour, medicalDaily, treatAtBase, treatAtBaseInfo,
  fieldTreat, fieldTreatInfo, partyMeds, nextHospitalType, hospitalTypes,
  autoCare, careNeed, medicCapacity, medicTime, treaters, bedReason, dailyHealthChange, AUTO_BELOW, SURGERY_LOAD, UNTRAINED_TREATS,
} from "../src/sim/medical.js";
import { addCondition, healthDaily, treatCondition, treatConditionInfo, conditionsOf, workFactor } from "../src/sim/health.js";
import { buildRate } from "../src/sim/buildings.js";

const days = Number(process.argv[2] || 30);
const seed = Number(process.argv[3] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
// Tech locks (blueprints.js) are tested in exploretest.js: here every manual is already studied.
const world = () => { const st = createWorld({ seed, factionCount: 5 }); unlockAll(st); stockTools(hub(st)); return st; }; // every tool (toolset.js)
const setHospital = (base, type) => { addBuilding(base, type); };
const plenty = (b) => Object.assign(b.stock, { scrap: 500, parts: 50, meds: 100 });
const nextDay = (st) => { st.hour += 24; };
const given = (msg) => /: health \d+ → \d+/.test(msg); // a treatment message (not a refusal)
const plainP = (s) => { s.traits = []; s.conditions = []; s.woundInfected = false; s.health = 100; s.gear.tool = null; return s; };
const addPerson = (st, base, role) => { const s = plainP(makeSurvivor(st, 1)); s.location = { kind: "base", baseId: base.id }; s.role = role; st.survivors.push(s); return s; };

// 1. Tiers through the build queue: one step at a time, upgrade replaces the old tier.
{
  console.log("Tiers and build queue");
  const st = world();
  const h = hub(st);
  plenty(h);
  const ppl = atBase(st, h.id);
  ppl.forEach((s) => { s.skills.medicine = 12; s.skills.mechanics = 6; });
  check(hospitalTypes().join(",") === "infirmary,field_hosp,clinic,hospital", "four tiers in order");
  check(!canBuild(st, h, "field_hosp").ok, "field hospital needs an infirmary first");
  check(nextHospitalType(h) === "infirmary", "next step is the infirmary");
  for (const type of hospitalTypes()) {
    const msg = queueBuild(st, h, type);
    check(/queued/.test(msg), `queue ${type}: ${msg}`);
    check(!canBuild(st, h, nextHospitalType(h) || type).ok, `no second hospital job while ${type} is queued`);
    ppl.forEach((s) => (s.role = "build"));
    let hours = 0;
    while (h.construction.length && hours < 500) { constructionHour(st); hours++; }
    check(hospitalTier(h) === BUILDINGS[type].tier, `${type} finished (tier ${hospitalTier(h)}) in ${hours}h`);
    check(h.buildings.filter((b) => BUILDINGS[b.type].family === "hospital").length === 1, `only one hospital building after ${type}`);
  }
  check(nextHospitalType(h) === null, "nothing above the top tier");
  check(!canBuild(st, h, "hospital").ok, "cannot build the top tier twice");
}

// 2. Staffing: buildings need medics.
{
  console.log("Staffing");
  const st = world();
  const h = hub(st);
  setHospital(h, "clinic");
  const ppl = atBase(st, h.id);
  ppl.forEach((s) => (s.role = "farm"));
  check(activeHospital(st, h).tier === 0, "unstaffed clinic works as no hospital");
  ppl[0].role = "medic";
  // B-10: an understaffed hospital runs as the highest tier its medics can staff (was: tier 0, "works as none").
  const one = activeHospital(st, h);
  check(one.tier === 2 && !one.staffed && one.fallback && one.built.tier === 3, `clinic with 1 of 2 medics runs as a field hospital (tier ${one.tier})`);
  ppl[1].role = "medic";
  check(activeHospital(st, h).tier === 3, "clinic with 2 medics runs at tier 3");
}

// 3. Treat at base: meds use, tier effects, can't messages.
{
  console.log("Treat at base");
  const gains = [];
  for (const type of [null, ...hospitalTypes()]) {
    const st = world();
    const h = hub(st);
    const ppl = atBase(st, h.id);
    ppl.forEach((s) => { s.role = "medic"; s.skills.medicine = 5; s.traits = s.traits.filter((t) => t !== "medic"); });
    if (type) setHospital(h, type);
    const s = ppl[0];
    s.health = 20;
    h.stock.meds = 5;
    const msg = treatAtBase(st, h, s.id);
    check(h.stock.meds === 4, `${type || "none"}: one dose used (${msg})`);
    gains.push([type || "none", s.health - 20]);
    s.health = 100;
    check(/not hurt/.test(treatAtBase(st, h, s.id)) && h.stock.meds === 4, `${type || "none"}: healthy person not treated`);
    s.health = 50;
    check(/Already treated today/.test(treatAtBase(st, h, s.id)) && h.stock.meds === 4, `${type || "none"}: one wound treatment a day`);
    s.woundTreatedDay = -1; // (was: no per-day limit) a new day for the meds check
    h.stock.meds = 0;
    check(/Needs 1 meds/.test(treatAtBase(st, h, s.id)), `${type || "none"}: no meds message`);
  }
  console.log(`  heal per treatment: ${gains.map(([t, g]) => `${t} +${g}`).join(", ")}`);
  for (let i = 1; i < gains.length; i++) check(gains[i][1] > gains[i - 1][1], `${gains[i][0]} heals more than ${gains[i - 1][0]}`);
}

// 4. Passive healing per hour and the bed cap.
{
  console.log("Passive healing and beds");
  const res = [];
  for (const type of [null, "infirmary", "clinic", "hospital"]) {
    const st = world();
    const h = hub(st);
    const ppl = atBase(st, h.id);
    ppl.forEach((s) => { s.role = "farm"; s.skills.medicine = 4; s.traits = s.traits.filter((t) => t !== "medic"); });
    ppl.slice(0, 3).forEach((s) => (s.role = "medic"));
    if (type) setHospital(h, type);
    const hurtOnes = ppl.slice(3);
    hurtOnes.forEach((s) => (s.health = 30));
    const beds = patients(st, h).length;
    const before = hurtOnes.reduce((a, s) => a + s.health, 0);
    for (let i = 0; i < 24; i++) medicalHour(st);
    const gain = hurtOnes.reduce((a, s) => a + s.health, 0) - before;
    res.push([type || "none", gain, beds]);
    const cap = type ? BUILDINGS[type].med.beds : 0;
    check(beds === Math.min(cap, hurtOnes.length), `${type || "none"}: ${beds} patients in ${cap} beds`);
  }
  console.log(`  24h total gain for 3 injured: ${res.map(([t, g, b]) => `${t} +${g.toFixed(1)} (${b} in bed)`).join(", ")}`);
  for (let i = 1; i < res.length; i++) check(res[i][1] > res[i - 1][1], `${res[i][0]} heals faster than ${res[i - 1][0]}`);
  // Bed cap: an infirmary has 2 beds; the third patient heals at the base rate.
  const st = world();
  const h = hub(st);
  setHospital(h, "infirmary");
  const ppl = atBase(st, h.id);
  ppl[0].role = "medic";
  ppl.slice(1, 4).forEach((s, i) => (s.health = 20 + i * 10));
  const inBed = patients(st, h);
  check(inBed.length === 2 && !inBed.includes(ppl[3]), "infirmary beds go to the worst off");
  check(healRatePerHour(st, h, ppl[1]) > healRatePerHour(st, h, ppl[3]), "in bed heals faster than out of bed");
}

// 5. Field treatment with carried meds.
{
  console.log("Field treatment");
  const st = world();
  const h = hub(st);
  const ppl = atBase(st, h.id);
  const [a, b] = ppl;
  a.skills.medicine = 10;
  b.skills.medicine = 0;
  const dest = st.tiles.find((t) => t.loc && t.id !== h.tile && st.grid.distance(t.id, h.tile) <= 6 && st.grid.distance(t.id, h.tile) >= 3);
  const r = launchExpedition(st, { memberIds: [a.id, b.id], dest: dest.id, mission: "recon", stance: "normal", supplies: { food: 4, water: 4, meds: 2, ammo: 10 } });
  check(!r.error, `launch: ${r.error || "ok"}`);
  const p = r.party;
  p.cargo.supplies.meds = 1;
  b.health = 40;
  check(/not hurt/.test(fieldTreat(st, p, a.id)), "healthy member not treated");
  check(/not with this team/.test(fieldTreat(st, p, ppl[2].id)), "someone at the hub is not treated by the team");
  const info = fieldTreatInfo(st, p, b);
  const msg = fieldTreat(st, p, b.id);
  check(b.health === 40 + info.heal && partyMeds(p) === 2 && p.cargo.supplies.meds === 0, `field treat: ${msg}`);
  const baseInfo = treatAtBaseInfo(st, h, { ...b, location: { kind: "base", baseId: h.id }, health: 40 });
  console.log(`  field heal +${info.heal} with Medicine ${a.skills.medicine} vs base (no hospital) +${baseInfo.heal}`);
  b.health = 30;
  check(/Already treated today/.test(fieldTreat(st, p, b.id)) && partyMeds(p) === 2, "field: one wound treatment a day");
  nextDay(st); // (was: two treatments back to back) one a day now
  fieldTreat(st, p, b.id);
  nextDay(st);
  fieldTreat(st, p, b.id);
  check(partyMeds(p) === 0, "team meds used up");
  b.health = 30;
  nextDay(st);
  check(/carries 0/.test(fieldTreat(st, p, b.id)), "no meds message");
  // Infected wound: worse on the road, costs an extra dose to treat.
  b.woundInfected = true;
  const hp = b.health;
  for (let i = 0; i < 24; i++) medicalHour(st);
  check(b.health < hp, `infected wound hurts on the road (${hp} → ${b.health.toFixed(1)})`);
  p.supplies.meds = 2;
  nextDay(st);
  check(fieldTreatInfo(st, p, b).cost === 2, "infected wound costs 2 meds to treat");
  fieldTreat(st, p, b.id);
  check(partyMeds(p) === 0, "both doses used");
}

// 6. Infected wounds at a base: a staffed clinic cleans them; a field hospital bed prevents them.
{
  console.log("Infected wounds at base");
  const st = world();
  const h = hub(st);
  setHospital(h, "clinic");
  const ppl = atBase(st, h.id);
  ppl[0].role = "medic"; ppl[1].role = "medic";
  const s = ppl[2];
  s.health = 30;
  s.woundInfected = true;
  h.stock.meds = 10;
  medicalDaily(st, h);
  check(s.woundInfected && h.stock.meds === 10, "medicalDaily itself uses no meds (all meds go through automatic care)");
  autoCare(st, h); // (was: medicalDaily cleaned it for 1 meds) night care treats it: 2 meds, a Clinic cleans for sure
  check(!s.woundInfected && h.stock.meds === 8, `clinic night care cleans an infected wound (meds ${h.stock.meds})`);
  // Field hospital: patients in bed never get infected.
  const st2 = world();
  const h2 = hub(st2);
  setHospital(h2, "field_hosp");
  const p2 = atBase(st2, h2.id);
  p2[0].role = "medic";
  p2[1].health = 20;
  h2.stock.meds = 0;
  for (let d = 0; d < 200; d++) { p2[1].health = 20; medicalDaily(st2, h2); }
  check(!p2[1].woundInfected, "field hospital bed prevents infection over 200 days");
  const st3 = world();
  const h3 = hub(st3);
  const p3 = atBase(st3, h3.id);
  h3.stock.meds = 0;
  let infected = 0;
  for (let d = 0; d < 200; d++) { p3[1].health = 20; p3[1].woundInfected = false; medicalDaily(st3, h3); if (p3[1].woundInfected) infected++; }
  check(infected > 0, `no hospital: wounds get infected (${infected} of 200 days)`);
}

// 7. Beds (s.inBed), medics never admitted, severe wounds and surgery.
{
  console.log("Beds, severe wounds and surgery");
  const st = world();
  const h = hub(st);
  setHospital(h, "clinic");
  const ppl = atBase(st, h.id);
  ppl.forEach((s) => (s.role = "farm"));
  ppl[0].role = "medic"; ppl[1].role = "medic";
  ppl[0].health = 10; // a hurt medic stays on duty
  ppl[2].health = 50;
  medicalHour(st);
  check(!ppl[0].inBed, "medics are never admitted as patients");
  check(ppl[2].inBed, "hurt farmer gets a bed (inBed set)");
  check(!ppl[3].inBed, "healthy person not in bed");
  ppl[2].location = { kind: "party", partyId: -1 }; // left on a team
  medicalHour(st);
  check(!ppl[2].inBed, "leaving the base clears inBed");
  ppl[2].location = { kind: "base", baseId: h.id };
  ppl[2].health = 100;
  medicalHour(st);
  check(!ppl[2].inBed, "healed patient leaves the bed");
  ppl[2].health = 80;
  medicalHour(st);
  check(!ppl[2].inBed, "a patient at 80 health keeps working (admit line 70)");
  // Severe wounds: 40% speed without a bed, the tier's speed in a bed.
  const sev = ppl[3];
  sev.woundInfected = false;
  const hosp = activeHospital(st, h);
  sev.health = 50;
  const normalNoBed = healRatePerHour(st, h, sev, hosp, false);
  const normalBed = healRatePerHour(st, h, sev, hosp, true);
  sev.health = 20;
  check(Math.abs(healRatePerHour(st, h, sev, hosp, false) - normalNoBed * 0.4) < 1e-9, "severe wound heals at 40% without a bed");
  check(Math.abs(healRatePerHour(st, h, sev, hosp, true) - normalBed * BUILDINGS.clinic.med.severe) < 1e-9, "severe wound heals at the clinic's severe speed in bed");
  const st0 = world();
  const h0 = hub(st0);
  const s0 = atBase(st0, h0.id)[2];
  s0.health = 50;
  const r50 = healRatePerHour(st0, h0, s0);
  s0.health = 20;
  check(Math.abs(healRatePerHour(st0, h0, s0) - r50 * 0.4) < 1e-9, "no hospital: severe wound heals at 40%");
  // Surgery: bigger treatment for severe wounds at a Clinic+, not at a field hospital.
  h.stock.meds = 10;
  sev.health = 50;
  const normal = treatAtBaseInfo(st, h, sev).heal;
  sev.health = 20;
  const surg = treatAtBaseInfo(st, h, sev);
  check(surg.surgery && surg.heal > normal, `clinic surgery on a severe wound: +${surg.heal} vs +${normal}`);
  const msg = treatAtBase(st, h, sev.id);
  check(/operated on/.test(msg), `surgery message: ${msg}`);
  const st2 = world();
  const h2 = hub(st2);
  setHospital(h2, "field_hosp");
  const p2 = atBase(st2, h2.id);
  p2[0].role = "medic";
  p2[1].health = 50;
  const n2 = treatAtBaseInfo(st2, h2, p2[1]).heal;
  p2[1].health = 20;
  const f2 = treatAtBaseInfo(st2, h2, p2[1]);
  check(!f2.surgery && f2.heal === n2, "field hospital: no surgery");
}

// 8. Short campaign with a staffed clinic: nothing crashes, meds are used.
{
  console.log(`Campaign ${days} days, seed ${seed}`);
  const st = world();
  st.started = true;
  const h = hub(st);
  setHospital(h, "clinic");
  atBase(st, h.id).slice(4).forEach((s) => (s.role = "medic"));
  atBase(st, h.id)[0].health = 25;
  const meds0 = h.stock.meds;
  let err = null;
  try {
    for (let i = 0; i < days * 24 && !st.gameOver; i++) {
      tickHour(st);
      st.cards.length = 0; // nobody answers cards in this test
    }
  } catch (e) { err = e; }
  check(!err, `campaign ran${err ? `: ${err.stack}` : ""}`);
  check(alive(st).every((s) => s.health <= 100 && s.health > 0), "health stays in range");
  console.log(`  alive ${alive(st).length}, hub meds ${meds0} → ${h.stock.meds}, infected ${alive(st).filter((s) => s.woundInfected).length}`);
}

// A hub with only the given people (everyone else sent away), no traits or gear.
function scene(type = null, medics = 0, others = 4, med = 0) {
  const st = world();
  const h = hub(st);
  for (const s of atBase(st, h.id)) { s.alive = false; s.left = true; }
  if (type) setHospital(h, type);
  const m = [], p = [];
  for (let i = 0; i < medics; i++) { const s = addPerson(st, h, "medic"); s.skills.medicine = med; m.push(s); }
  for (let i = 0; i < others; i++) { const s = addPerson(st, h, "farm"); s.skills.medicine = 0; p.push(s); }
  h.stock.meds = 100; h.stock.food = 500; h.stock.water = 200;
  h.medsReserve = 0;
  return { st, h, m, p };
}

// 9. One wound treatment per patient per day, at a base and in the field, shared between the two.
{
  console.log("One treatment a day");
  const { st, h, p } = scene(null, 1, 2, 4);
  const s = p[0];
  s.health = 20;
  const first = treatAtBase(st, h, s.id);
  const hp = s.health;
  check(/treated/.test(first), `first treatment: ${first}`);
  const again = treatAtBase(st, h, s.id);
  check(/Already treated today/.test(again) && /from midnight \(in \d+h\)/.test(again) && s.health === hp, `second the same day refused: ${again}`);
  check(!treatAtBaseInfo(st, h, s).ok && treatAtBaseInfo(st, h, s).treatedToday, "the info says why (treatedToday)");
  nextDay(st);
  check(treatAtBaseInfo(st, h, s).ok, "next day: can be treated again");
  check(/treated/.test(treatAtBase(st, h, s.id)), "next day treatment given");
  // Twenty clicks a day for five days: at most one each day (P-10: was 20 -> 100 in one hour).
  const { st: st2, h: h2, p: p2 } = scene(null, 1, 1, 4);
  const v = p2[0];
  v.health = 10;
  let n = 0;
  for (let d = 0; d < 5; d++) { for (let i = 0; i < 20; i++) if (given(treatAtBase(st2, h2, v.id))) n++; nextDay(st2); }
  check(n === 5, `20 clicks a day for 5 days: ${n} treatments`);
  // Field: a treatment at the base today blocks the team treating them today.
  const { st: st3, h: h3, p: p3 } = scene(null, 0, 3, 0);
  const [a, b] = p3;
  a.skills.medicine = 6;
  b.health = 40;
  check(/treated/.test(treatAtBase(st3, h3, b.id)), "treated at the base");
  const dest = st3.tiles.find((t) => t.loc && t.id !== h3.tile && st3.grid.distance(t.id, h3.tile) <= 6 && st3.grid.distance(t.id, h3.tile) >= 3);
  const r = launchExpedition(st3, { memberIds: [a.id, b.id], dest: dest.id, mission: "recon", stance: "normal", supplies: { food: 4, water: 4, meds: 4, ammo: 10 } });
  check(!r.error, `launch: ${r.error || "ok"}`);
  if (r.party) {
    check(/Already treated today/.test(fieldTreat(st3, r.party, b.id)), "the team cannot treat them again the same day");
    nextDay(st3);
    check(/patches/.test(fieldTreat(st3, r.party, b.id)), "the team treats them the next day");
  }
}

// 10. Medic time: 3 + Medicine/4 a day per Medic, 2 a day untrained, surgery takes 3 from one medic.
{
  console.log("Medic time");
  const { st, m } = scene(null, 1, 0, 0);
  const cap = (med) => { m[0].skills.medicine = med; return medicCapacity(m[0]); };
  check(cap(0) === 3 && cap(4) === 4 && cap(8) === 5 && cap(12) === 6, `capacity by Medicine 0/4/8/12: ${[0, 4, 8, 12].map(cap).join("/")}`);
  m[0].skills.medicine = 4;
  addCondition(st, m[0], "pneumonia", "test", { sev: 80, quiet: true });
  check(medicCapacity(m[0]) < 4, `a sick medic gives fewer (${medicCapacity(m[0])} at work ${workFactor(m[0])})`);
  m[0].conditions = [];
  // Five patients, one medic at Medicine 4 (4 a day): the fifth waits until tomorrow.
  const { st: s2, h: h2, p: p2 } = scene(null, 1, 5, 4);
  p2.forEach((s, i) => (s.health = 40 + i));
  const out = p2.map((s) => treatAtBase(s2, h2, s.id));
  const n2 = out.filter(given).length;
  check(n2 === 4, `4 treatments with one Medicine-4 medic (${n2})`);
  check(/No medic time left today \(4 of 4 treatments given\)/.test(out[4]), `the fifth: ${out[4]}`);
  check(medicTime(s2, h2).left === 0 && medicTime(s2, h2).used === 4, "medic time used up");
  // Illness treatments use the same time.
  addCondition(s2, p2[0], "flu", "test", { sev: 50, quiet: true });
  check(/No medic time/.test(treatConditionInfo(s2, h2, p2[0], "flu").reason), "an illness treatment needs medic time too");
  nextDay(s2);
  check(medicTime(s2, h2).left === 4 && /treated/.test(treatAtBase(s2, h2, p2[4].id)), "medic time resets the next day");
  // Untrained: nobody on the Medic role, the best at Medicine gives 2 a day.
  const { st: s3, h: h3, p: p3 } = scene(null, 0, 4, 0);
  p3[3].skills.medicine = 5;
  p3.forEach((s) => (s.health = 50));
  const tr = treaters(s3, h3);
  check(tr.length === 1 && tr[0].s === p3[3] && !tr[0].trained, "untrained: the best at Medicine treats");
  const u = p3.map((s) => treatAtBase(s3, h3, s.id)).filter(given).length;
  check(u === UNTRAINED_TREATS, `untrained: ${UNTRAINED_TREATS} a day (${u})`);
  // Surgery: a Clinic, two medics at Medicine 0 (3 a day each): a surgery takes one medic's whole day.
  const { st: s4, h: h4, p: p4 } = scene("clinic", 2, 4, 0);
  p4.forEach((s) => (s.health = 20));
  const i1 = treatAtBaseInfo(s4, h4, p4[0]);
  check(i1.surgery && i1.load === SURGERY_LOAD, "a severe wound at a Clinic gets surgery (3 treatments of time)");
  treatAtBase(s4, h4, p4[0].id);
  const busy = medicTime(s4, h4);
  check(busy.list.some((t) => t.used === 3) && busy.used === 3, `surgery used one medic's day (${busy.list.map((t) => `${t.used}/${t.cap}`).join(", ")})`);
  check(/operated on/.test(treatAtBase(s4, h4, p4[1].id)), "the second medic operates too");
  const i3 = treatAtBaseInfo(s4, h4, p4[2]);
  check(!i3.ok && /No medic time/.test(i3.reason), `no medic left for a third: ${i3.reason}`);
  // A medic with 1 left: a plain treatment instead of surgery.
  const { st: s5, h: h5, m: m5, p: p5 } = scene("clinic", 2, 2, 0);
  p5.forEach((s) => (s.health = 20));
  treatAtBase(s5, h5, p5[0].id); // surgery: one medic 3/3
  h5.medWork.used[m5.find((x) => !h5.medWork.used[x.id]).id] = 2; // the other has 1 left
  const i5 = treatAtBaseInfo(s5, h5, p5[1]);
  check(i5.ok && !i5.surgery && i5.noSurgeryTime, "no medic free for surgery: a plain treatment, and it says so");
}

// 11. Worst off first in automatic care; the reserve kept by every automatic dose.
{
  console.log("Automatic care: worst first, reserve");
  // B-20: 3 meds, health 69, 69, 69, 12 (no hospital, one medic): the survivor at 12 is treated.
  const { st, h, p } = scene(null, 1, 4, 0);
  [69, 69, 69, 12].forEach((v, i) => (p[i].health = v));
  h.stock.meds = 3;
  const out = autoCare(st, h);
  check(out.list[0].s === p[3] && p[3].woundTreatedDay === day(st), `the survivor at 12 is treated first (${out.list.map((e) => Math.round(e.s.health)).join(", ")})`);
  check(h.stock.meds === 0 && out.list.length === 3, `3 meds, 3 treatments (${out.list.length})`);
  // Pneumonia ranks first; an infected wound above a lower clean one.
  const { st: s2, h: h2, p: p2 } = scene(null, 1, 3, 0);
  p2[0].health = 30; p2[1].health = 55; p2[1].woundInfected = true; p2[2].health = 90;
  addCondition(s2, p2[2], "pneumonia", "test", { sev: 75, quiet: true });
  h2.stock.meds = 2;
  const o2 = autoCare(s2, h2);
  check(o2.list.length >= 1 && o2.list[0].s === p2[2] && o2.list[0].key === "pneumonia", `pneumonia first (${o2.list.map((e) => `${e.kind}${e.key ? ":" + e.key : ""}`).join(", ")})`);
  check(careNeed(p2[1]) > careNeed(p2[0]), "an infected wound at 55 ranks above a clean one at 30");
  // Medic time limits the night too: one untrained treater (2 a day), 4 hurt: the two worst.
  const { st: s3, h: h3, p: p3 } = scene(null, 0, 4, 0);
  [60, 20, 50, 30].forEach((v, i) => (p3[i].health = v));
  const o3 = autoCare(s3, h3);
  const got = o3.list.map((e) => e.s);
  check(got.length === 2 && got.includes(p3[1]) && got.includes(p3[3]), `medic time: the two worst (${o3.list.map((e) => Math.round(e.s.health)).join(", ")})`);
  check(o3.skipped.length === 2 && o3.skipped.every((x) => /medic time/.test(x.reason)), "the rest wait for medic time");
  // Reserve: wounds, illnesses (even pneumonia), infected wounds at a Clinic, through the whole night tick.
  for (const reserve of [0, 3, 6]) {
    const { st: s4, h: h4, p: p4 } = scene("clinic", 3, 6, 8);
    h4.medsReserve = reserve;
    h4.stock.meds = 8;
    p4[0].health = 15; p4[1].health = 40; p4[1].woundInfected = true; p4[2].health = 60;
    addCondition(s4, p4[3], "pneumonia", "test", { sev: 80, quiet: true });
    addCondition(s4, p4[4], "dysentery", "test", { sev: 60, quiet: true });
    addCondition(s4, p4[5], "cut", "test", { sev: 40, quiet: true });
    let low = Infinity;
    // Spirits kept up: nine people in a bare hub's four beds (barestart) lose hope, and a deserter takes meds with
    // them (morale.js), which is not a dose; this check is about automatic care keeping the reserve.
    for (let i = 0; i < 5 * 24; i++) { for (const s of alive(s4)) s.mood = Math.max(s.mood, 60); tickHour(s4); s4.cards.length = 0; low = Math.min(low, h4.stock.meds); }
    check(low >= reserve && (reserve > 0 || h4.stock.meds < 8), `reserve ${reserve}: meds never below it over 5 nights (lowest ${low}, now ${h4.stock.meds})`);
  }
  // Pneumonia with meds only at the reserve: not treated automatically (one rule), but by hand it can be.
  const { st: s5, h: h5, p: p5 } = scene(null, 1, 1, 0);
  addCondition(s5, p5[0], "pneumonia", "test", { sev: 80, quiet: true });
  h5.stock.meds = 4; h5.medsReserve = 4;
  const o5 = autoCare(s5, h5);
  check(!o5.list.length && h5.stock.meds === 4 && /reserve of 4/.test(o5.skipped[0] ? o5.skipped[0].reason : ""), `automatic care keeps the reserve even for pneumonia (${o5.skipped[0] && o5.skipped[0].reason})`);
  check(/treated/.test(treatCondition(s5, h5, p5[0].id, "pneumonia")) && h5.stock.meds === 3, "a hand treatment (a dose: 1 meds) may use the reserve");
  // Automatic care off: no meds used at all at night.
  const { st: s6, h: h6, p: p6 } = scene(null, 1, 3, 0);
  h6.autoTreat = false;
  p6[0].health = 20; p6[1].woundInfected = true; p6[1].health = 50;
  addCondition(s6, p6[2], "pneumonia", "test", { sev: 80, quiet: true });
  for (let i = 0; i < 48; i++) { tickHour(s6); s6.cards.length = 0; }
  check(h6.stock.meds === 100, `automatic care off: no meds used (${h6.stock.meds})`);
}

// 12. The admit line: below it (or severe / infected / too ill) take beds, worst first; the rest keep working.
{
  console.log("Admit line");
  for (const line of [30, 50, 70, 90, 100]) {
    const { st, h, p } = scene("hospital", 3, 7, 4);
    if (line !== 70) h.admitBelow = line; // 70 is the default
    p.forEach((s) => (s.role = "build"));
    [25, 45, 65, 85, 98, 100, 95].forEach((v, i) => (p[i].health = v));
    addCondition(st, p[5], "pneumonia", "test", { sev: 80, quiet: true }); // at 100 health but too ill to work
    p[6].woundInfected = true; // infected at 95
    const r0 = buildRate(st, h);
    const expect = p.filter((s) => s.health < line || s === p[5] || s === p[6]);
    medicalHour(st);
    const inBed = p.filter((s) => s.inBed);
    check(inBed.length === expect.length && expect.every((s) => s.inBed), `admit below ${line}: ${inBed.length} in bed (health ${inBed.map((s) => Math.round(s.health)).join(", ")}), expected ${expect.length}`);
    check(patients(st, h).every((s) => s.inBed) && inBed.every((s) => bedReason(st, h, s)), `admit ${line}: inBed matches patients() and each has a reason`);
    const workers = p.filter((s) => !s.inBed);
    check(workers.every((s) => !bedReason(st, h, s)), `admit ${line}: everyone out of bed is fit to work`);
    check(buildRate(st, h) <= r0 + 1e-9 && (workers.length === 0 || buildRate(st, h) > 0), `admit ${line}: builders out of bed still build (${buildRate(st, h).toFixed(2)})`);
  }
  // Worst first when beds run out: infirmary (2 beds), admit 100.
  const { st, h, p } = scene("infirmary", 1, 4, 0);
  h.admitBelow = 100;
  [90, 35, 60, 80].forEach((v, i) => (p[i].health = v));
  p[3].woundInfected = true;
  const pts = patients(st, h);
  check(pts.length === 2 && pts.includes(p[3]) && pts.includes(p[1]), `2 beds: the infected and the worst (${pts.map((s) => Math.round(s.health)).join(", ")})`);
  // Out of range values are clamped.
  h.admitBelow = 5;
  p[2].health = 35;
  check(bedReason(st, h, p[2]) === "", "an admit line below 30 is clamped to 30");
}

// 13. A tier upgrade the medics cannot staff runs as the highest staffed tier, with a warning (B-10).
{
  console.log("Understaffed upgrade");
  const { st, h, m, p } = scene("field_hosp", 1, 3, 12);
  m[0].skills.mechanics = 6;
  plenty(h);
  medicalHour(st); // first look: no warning for what was already there
  check(!st.log.some((l) => /needs \d+ medics/.test(l.text)), "no warning for a staffed field hospital");
  p.forEach((s) => { s.role = "build"; s.skills.mechanics = 6; s.skills.medicine = 12; });
  check(/queued/.test(queueBuild(st, h, "clinic")), "clinic queued");
  let hours = 0;
  while (h.construction.length && hours < 500) { constructionHour(st); hours++; }
  medicalHour(st);
  const a = activeHospital(st, h);
  check(hospitalTier(h) === 3 && a.tier === 2 && a.fallback && a.beds === BUILDINGS.field_hosp.med.beds, `clinic with 1 medic runs as a field hospital (tier ${a.tier}, ${a.beds} beds)`);
  const warn = st.log.find((l) => /Clinic at .* needs 2 medics and has 1: it runs as a Field hospital/.test(l.text));
  check(!!warn, `upgrade warning logged: ${warn ? warn.text : "none"}`);
  p[0].health = 20;
  medicalHour(st);
  check(p[0].inBed, "patients still get beds in the fallback tier");
  p[1].role = "medic";
  check(activeHospital(st, h).tier === 3 && activeHospital(st, h).staffed, "a second medic: the clinic runs");
  // Trauma hospital: 2 medics -> clinic, 1 -> field hospital, 0 -> none.
  const { st: s2, h: h2, m: m2 } = scene("hospital", 2, 1, 0);
  check(activeHospital(s2, h2).tier === 3, "trauma hospital with 2 medics runs as a clinic");
  m2[1].role = "farm";
  check(activeHospital(s2, h2).tier === 2, "with 1 medic as a field hospital");
  m2[0].role = "farm";
  check(activeHospital(s2, h2).tier === 0, "with none as no hospital");
}

// 14. The Medical tab's rate matches the real change over a day (P-21).
{
  console.log("Shown rate vs real change");
  const rows = [];
  for (const [type, hp, cond] of [[null, 45, null], ["infirmary", 45, null], ["clinic", 50, null], [null, 90, null], ["infirmary", 60, "pneumonia"], [null, 25, null]]) {
    for (const at of [0, 10]) { // looked at midnight (the night 24h later) or at 10:00 (the night 14h later)
      const { st, h, p } = scene(type, type === "clinic" ? 2 : 1, 1, 4);
      const s = p[0];
      s.health = hp;
      if (cond) { const c = addCondition(st, s, cond, "test", { sev: 40, quiet: true }); c.days = 2; }
      st.hour = 24 * 3 + at;
      medicalHour(st); // beds
      s.health = hp;
      const shown = dailyHealthChange(st, h, s, { inBed: s.inBed }).total;
      const before = s.health;
      // The real day: hours to midnight, the night (illness, then automatic care), the rest of the 24 hours.
      const toNight = 24 - (st.hour % 24);
      for (let i = 0; i < toNight; i++) medicalHour(st);
      st.hour += toNight;
      healthDaily(st);
      for (let i = toNight; i < 24; i++) medicalHour(st);
      const real = s.health - before;
      const tol = cond ? 3 : 0.6;
      rows.push(`${type || "none"} ${hp}${cond ? "+" + cond : ""}@${at}h ${shown.toFixed(1)}/${real.toFixed(1)}`);
      check(Math.abs(real - shown) <= tol, `${type || "none"}, ${hp} health${cond ? ` + ${cond}` : ""}, at ${at}:00: shown ${shown.toFixed(1)}/day, real ${real.toFixed(1)}`);
    }
  }
  console.log(`  shown/real: ${rows.join(", ")}`);
}

// 15. 200 days with a staffed clinic, an admit line and a reserve: no NaN anywhere in medical state.
{
  console.log("200 days, no NaN");
  const st = world();
  st.started = true;
  const h = hub(st);
  setHospital(h, "clinic");
  atBase(st, h.id).slice(3, 5).forEach((s) => (s.role = "medic"));
  h.admitBelow = 50; h.medsReserve = 4;
  atBase(st, h.id)[0].health = 25;
  atBase(st, h.id)[1].woundInfected = true;
  let bad = null, err = null;
  try {
    for (let i = 0; i < 200 * 24 && !st.gameOver; i++) {
      // A medical soak: hordes and the groups' raids on the hub cleared (raids are sized to the hub's defence now,
      // and a hands-off colony never prepares for them) and food and water topped up so it lasts the 200 days.
      st.hordes.length = 0;
      st.parties = st.parties.filter((p) => !(p.kind === "raid" && p.target && p.target.kind === "player"));
      if (food(h) < 150) addDays(h, 150 - food(h)); h.stock.water = Math.max(h.stock.water, 60); // food by type (tools/foodkit.js): there is no plain "food" stock
      tickHour(st);
      st.cards.length = 0;
      for (const s of st.survivors) if (s.alive) s.mood = Math.max(s.mood, 50); // nobody walks away in despair: this is about health (a hands-off colony's spirits sank and it emptied by day 23)
      for (const s of st.survivors) {
        if (!Number.isFinite(s.health) || conditionsOf(s).some((c) => !Number.isFinite(c.sev))) bad = bad || `${s.name} health ${s.health}`;
      }
      for (const b of st.bases) {
        if (!Number.isFinite(b.stock.meds) || b.stock.meds < 0) bad = bad || `${b.name} meds ${b.stock.meds}`;
        if (b.medWork && Object.values(b.medWork.used).some((v) => !Number.isFinite(v))) bad = bad || `${b.name} medWork`;
      }
    }
  } catch (e) { err = e; }
  check(!err, `200 days ran${err ? `: ${err.stack}` : ""}`);
  check(day(st) >= 200 && alive(st).length > 0, `the colony lasted (day ${day(st)}, ${alive(st).length} alive)`);
  check(!bad, `no NaN or negative meds${bad ? `: ${bad}` : ""}`);
  check(alive(st).every((s) => s.health <= 100 && s.health > 0), "health stays in range");
  const plan = autoCare(st, h, { plan: true });
  check(plan.list.every((e) => Number.isFinite(e.heal) && Number.isFinite(e.cost)), "plan numbers finite");
  console.log(`  day ${day(st)}, alive ${alive(st).length}, hub meds ${h.stock.meds}, in bed ${alive(st).filter((s) => s.inBed).length}, infected ${alive(st).filter((s) => s.woundInfected).length}`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
