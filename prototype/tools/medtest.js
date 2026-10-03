// Headless medical test: hospital tiers through the build queue, staffing, passive healing and bed caps,
// treating at a base (meds use, tier effects), field treatment with a team's carried meds, infected
// wounds, and a short campaign with a staffed clinic to check nothing crashes.
// Usage: node tools/medtest.js [days] [seed]
import { createWorld, tickHour, hub, atBase, alive } from "../src/sim/world.js";
import { addBuilding, queueBuild, canBuild, constructionHour, BUILDINGS } from "../src/sim/buildings.js";
import { launchExpedition } from "../src/sim/parties.js";
import {
  hospitalTier, activeHospital, patients, healRatePerHour, medicalHour, medicalDaily, treatAtBase, treatAtBaseInfo,
  fieldTreat, fieldTreatInfo, partyMeds, nextHospitalType, hospitalTypes,
} from "../src/sim/medical.js";

const days = Number(process.argv[2] || 30);
const seed = Number(process.argv[3] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const world = () => createWorld({ seed, factionCount: 5 });
const setHospital = (base, type) => { addBuilding(base, type); };
const plenty = (b) => Object.assign(b.stock, { scrap: 500, parts: 50, meds: 100 });

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
  check(activeHospital(st, h).tier === 0, "clinic with 1 of 2 medics still unstaffed");
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
  fieldTreat(st, p, b.id);
  fieldTreat(st, p, b.id);
  check(partyMeds(p) === 0, "team meds used up");
  b.health = 30;
  check(/carries 0/.test(fieldTreat(st, p, b.id)), "no meds message");
  // Infected wound: worse on the road, costs an extra dose to treat.
  b.woundInfected = true;
  const hp = b.health;
  for (let i = 0; i < 24; i++) medicalHour(st);
  check(b.health < hp, `infected wound hurts on the road (${hp} → ${b.health.toFixed(1)})`);
  p.supplies.meds = 2;
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
  check(!s.woundInfected, "clinic bed cleans an infected wound");
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

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
