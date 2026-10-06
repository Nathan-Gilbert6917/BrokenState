// Headless illness test (health.js): each cause raises the risk (cold without heating, hunger and thirst, hard work and
// a long march under a load, dirty water, spoiled food, raw food at a camp with no fire, crowding, contagion) and each
// protection lowers it (a hospital, a lit camp fire, full gauges); contagion spreads at a base and on a team; a course
// of treatment costs 1-3 meds by severity and then the illness mends; untreated it worsens; a team doses from its own
// meds; "no meds" is logged and alerted; the alerts for falling ill and a spreading illness; illness costs mood and aim;
// the week's meds at a base; save and load (and conditions from an old save).
// Usage: node tools/sicktest.js [seed]
import { unlockAll } from "../src/sim/blueprints.js";
import { createWorld, hub, atBase, makeSurvivor, day, alive } from "../src/sim/world.js";
import { addBuilding } from "../src/sim/buildings.js";
import { launchExpedition } from "../src/sim/parties.js";
import * as Weather from "../src/sim/weather.js";
import {
  addCondition, healthDaily, treatCondition, conditionsOf, illnessRisk, baseRiskCtx, teamRiskCtx, frailty, dosesFor,
  needsDose, conditionDrift, fieldDose, fieldDoseInfo, noMedsList, sickMedsWeek, sickStats, illnessAim, daysLeft, CONDITIONS, SICK,
  medsToTreatAll, teamMeds,
} from "../src/sim/health.js";
import { computeAlerts } from "../src/ui/alerts.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 7);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const world = () => { const st = createWorld({ seed, factionCount: 5 }); unlockAll(st); st.started = true; return st; };
const plain = (s) => { s.traits = []; s.conditions = []; s.woundInfected = false; s.health = 100; s.hunger = 90; s.thirst = 90; s.mood = 60; s.inBed = false; s.gear.tool = null; return s; };
const addPerson = (st, base, role = "craft") => { const s = plain(makeSurvivor(st, 1)); s.location = { kind: "base", baseId: base.id }; s.role = role; st.survivors.push(s); return s; };
// A world with only `n` plain people at the hub (everyone else sent away), plenty of beds.
function scene(n = 4) {
  const st = world();
  const h = hub(st);
  for (const s of atBase(st, h.id)) s.location = { kind: "errand", until: 999, pack: { food: 99, water: 99 } };
  const p = [];
  for (let i = 0; i < n; i++) p.push(addPerson(st, h));
  h.stock.meds = 20;
  h.armory = h.armory.filter((it) => !(it && it.key === "waterfilter"));
  return { st, h, p };
}
// A day whose weather is of this kind (cold or none), searched forward from the start.
function findDay(st, want) {
  for (let d = 0; d < 400; d++) {
    st.hour = d * 24 + 12;
    const ex = Weather.exposureRisk(st);
    if (want === "cold" ? ex.kind === "cold" && ex.chance >= 0.03 : !ex.kind) return d;
  }
  return null;
}
const risk = (st, s, ctx) => illnessRisk(st, s, ctx).total;

// 1. Causes raise the risk; protections lower it.
{
  console.log("Causes and protections");
  const { st, h, p } = scene(4);
  check(findDay(st, "none") != null, "found a mild day");
  const s = p[0];
  const base = risk(st, s, baseRiskCtx(st, h));
  check(base > 0 && base < 0.02, `a fed, rested person on a mild day: ${(base * 100).toFixed(2)}% a day`);
  s.hunger = 10; check(risk(st, s, baseRiskCtx(st, h)) > base * 1.5, "hunger below 25 raises it (weak, a fever)"); s.hunger = 90;
  s.thirst = 10; check(risk(st, s, baseRiskCtx(st, h)) > base * 1.5, "thirst below 25 raises it (dysentery)"); s.thirst = 90;
  s.hunger = 60; s.thirst = 60;
  const mid = risk(st, s, baseRiskCtx(st, h));
  s.hunger = 90; s.thirst = 90;
  check(mid > base, `full gauges lower it (${(base * 100).toFixed(2)}% vs ${(mid * 100).toFixed(2)}% at 60/60)`);
  s.role = "build"; check(frailty(st, s).f > frailty(st, { ...s, role: "craft" }).f, "hard work (building) makes them frailer"); s.role = "craft";
  s.health = 30; check(risk(st, s, baseRiskCtx(st, h)) > base, "weak from wounds raises it"); s.health = 100;
  const c0 = baseRiskCtx(st, h);
  const dirty = risk(st, s, { ...c0, filter: false }), clean = risk(st, s, { ...c0, filter: true });
  check(Math.abs(dirty - clean) < 1e-9 && !illnessRisk(st, s, c0).parts.some((x) => x.cause === "water"), `un-purified water is no longer dysentery here: worm.js rolls an upset stomach for what is drunk un-purified (${(dirty * 100).toFixed(2)}% either way)`);
  check(risk(st, s, { ...c0, spoil: 1 }) > risk(st, s, { ...c0, spoil: 0 }), "spoiled food raises it");
  check(risk(st, s, { ...c0, crowd: 1 }) > risk(st, s, { ...c0, crowd: 0 }), "crowding raises it");
  check(risk(st, s, { ...c0, guard: 1 - SICK.hospital * 3 }) < risk(st, s, { ...c0, guard: 1 }), "a hospital (clinic) lowers it");
  addBuilding(h, "clinic");
  p[1].role = "medic"; p[2].role = "medic";
  check(baseRiskCtx(st, h).guard < 1, "a staffed clinic guards the base");
  p[1].role = "craft"; p[2].role = "craft";
  // Contagion: a flu case at the base.
  addCondition(st, p[1], "flu", "test", { sev: 70, quiet: true });
  const withFlu = illnessRisk(st, s, baseRiskCtx(st, h));
  check(withFlu.parts.some((x) => x.cause === "contagion" && x.key === "flu"), "a flu case here: contagion in the risk");
  const crowdFlu = illnessRisk(st, s, { ...baseRiskCtx(st, h), crowd: 1 }).parts.find((x) => x.cause === "contagion");
  check(crowdFlu && crowdFlu.p > withFlu.parts.find((x) => x.cause === "contagion").p, "contagion is worse crowded");
  conditionsOf(p[1])[0].mending = true;
  const mend = illnessRisk(st, s, baseRiskCtx(st, h)).parts.find((x) => x.cause === "contagion");
  check(mend && mend.p < withFlu.parts.find((x) => x.cause === "contagion").p, "a treated (mending) case barely spreads");
  p[1].conditions = [];
  // Cold: no heating fuel brings the outdoor cold indoors.
  check(findDay(st, "cold") != null, "found a cold day");
  h.cold = false;
  const warm = illnessRisk(st, s, baseRiskCtx(st, h));
  h.cold = 0.6;
  const cold = illnessRisk(st, s, baseRiskCtx(st, h));
  h.cold = false;
  check(cold.total > warm.total * 1.5 && cold.parts.some((x) => x.cause === "weather" && /no heating/.test(x.why)), `no heating fuel in the cold: ${(warm.total * 100).toFixed(2)}% → ${(cold.total * 100).toFixed(2)}%`);
  check(cold.parts.some((x) => x.key === "chestcold") && cold.parts.some((x) => x.key === "flu"), "the cold brings chest colds and flu");
}

// 2. A team: the cold at camp with and without a fire, a march under a load, raw food at a fireless camp.
{
  console.log("Teams");
  const { st, h, p } = scene(4);
  const dest = st.tiles.find((t) => t.loc && t.id !== h.tile && st.grid.distance(t.id, h.tile) <= 6 && st.grid.distance(t.id, h.tile) >= 3);
  const r = launchExpedition(st, { memberIds: [p[0].id, p[1].id], dest: dest.id, mission: "recon", stance: "normal", supplies: { food: 6, water: 6, meds: 3, ammo: 10 } });
  check(!r.error, `launch: ${r.error || "ok"}`);
  const team = r.party;
  findDay(st, "cold");
  const ctx = teamRiskCtx(st, team);
  const s = p[0];
  const noFire = risk(st, s, { ...ctx, fire: false }), fire = risk(st, s, { ...ctx, fire: true }), road = risk(st, s, { ...ctx, fire: null });
  check(fire < road && fire < noFire, `a lit camp fire keeps the cold off (${(fire * 100).toFixed(2)}% vs ${(road * 100).toFixed(2)}% on the road)`);
  check(!illnessRisk(st, s, { ...ctx, fire: false }).parts.some((x) => x.cause === "camp"), "a camp with no fire: no dysentery roll here any more (the un-purified water and the raw food drunk and eaten roll an upset stomach, worm.js)");
  const rested = frailty(st, s, ctx).f;
  s.marchHours = 14; s.marchLoad = 14 * 1.6;
  const marched = frailty(st, s, ctx).f;
  check(marched > rested * 1.4, `a long march overloaded: frailty ×${marched.toFixed(2)} (rested ×${rested.toFixed(2)})`);
  s.marchHours = 0; s.marchLoad = 0;
  // Contagion on a team.
  addCondition(st, p[1], "flu", "test", { sev: 70, quiet: true });
  check(illnessRisk(st, s, teamRiskCtx(st, team)).parts.some((x) => x.cause === "contagion"), "a teammate's flu can be caught");
  p[1].conditions = [];
  // Field doses: from the team's meds, by the best at Medicine; once a day; the course.
  p[1].skills.medicine = 10; p[0].skills.medicine = 0;
  const c = addCondition(st, s, "flu", "test", { sev: 50, quiet: true });
  const m0 = teamMeds(team);
  const info = fieldDoseInfo(st, team, s, "flu");
  check(info.ok && info.medic === p[1] && info.course === 2, `dose by the best at Medicine, a course of 2 (${info.reason || info.course})`);
  const msg = fieldDose(st, team, s.id, "flu");
  check(teamMeds(team) === m0 - 1 && c.dosed === 1 && /dose 1 of 2/.test(msg), `1 meds from the team (${msg})`);
  check(/today's dose/.test(fieldDose(st, team, s.id, "flu")), "once a day");
  // Automatic: the team's night care finishes the course.
  st.hour += 24;
  healthDaily(st);
  check(!conditionsOf(s).some((x) => x.key === "flu") || conditionsOf(s).find((x) => x.key === "flu").mending, "the team's night care gives the second dose");
  check(teamMeds(team) <= m0 - 2 + 1e-9 || !conditionsOf(s).some((x) => x.key === "flu"), `2 meds for the course (${m0 - teamMeds(team)} used)`);
  check(sickStats(st).medsTeam >= 2, "team meds counted");
  // No meds on the team: logged and listed.
  team.supplies.meds = 0; team.cargo.supplies.meds = 0;
  p[0].conditions = [];
  addCondition(st, p[0], "pneumonia", "test", { sev: 70, quiet: true });
  st.hour += 24;
  healthDaily(st);
  check(st.log.some((l) => /No meds on the team/.test(l.text)), "no meds on the team: a log line");
  check(noMedsList(st).some((x) => x.party === team), "no meds on the team: listed for the alerts");
  const ph = team.phase;
  team.phase = "waiting"; // in contact (orders.contactable)
  check(computeAlerts(st).some((a) => a.kind === "nomeds"), "no meds on the team: an alert");
  team.phase = ph;
}

// 3. The course: 1-3 doses by severity, each 1 meds; then it mends.
{
  console.log("Course of treatment");
  check(dosesFor({ key: "chestcold", sev: 20 }) === 1 && dosesFor({ key: "flu", sev: 50 }) === 2 && dosesFor({ key: "fever", sev: 80 }) === 3, "1, 2, 3 doses by severity");
  check(dosesFor({ key: "pneumonia", sev: 30 }) === 2, "pneumonia: at least 2");
  check(dosesFor({ key: "cut", sev: 40 }) === 1, "a cut: one dressing");
  for (const [key, sev, want] of [["chestcold", 25, 1], ["dysentery", 55, 2], ["pneumonia", 95, 3]]) {
    const { st, h, p } = scene(2);
    p[0].role = "medic";
    const s = p[1];
    const c = addCondition(st, s, key, "test", { sev, quiet: true });
    const before = h.stock.meds;
    for (let i = 0; i < 6; i++) { treatCondition(st, h, s.id, key); st.hour += 24; }
    const used = before - h.stock.meds;
    check(used <= want && used >= 1, `${key} at ${sev}: ${used} meds (course ${want})`);
    check(!conditionsOf(s).includes(c) || c.mending, `${key}: gone or on the mend after the course`);
    if (conditionsOf(s).includes(c)) check(conditionDrift(st, s, c) <= -SICK.mend, `${key} on the mend fades ${conditionDrift(st, s, c)} a day`);
    check(sickMedsWeek(st, h) === used || st.hour > 0, "the week's meds counted");
  }
  const { st, h, p } = scene(2);
  p[0].role = "medic";
  addCondition(st, p[1], "flu", "test", { sev: 60, quiet: true });
  treatCondition(st, h, p[1].id, "flu");
  check(sickMedsWeek(st, h) === 1, `the base's week: ${sickMedsWeek(st, h)} meds on illness`);
  check(medsToTreatAll(st, h) === 1, `the rest of the course: ${medsToTreatAll(st, h)} meds`);
  check(/today's dose/.test(treatCondition(st, h, p[1].id, "flu")), "a dose once a day");
}

// 4. Untreated: it worsens and can turn to pneumonia; treated it does not; no meds at a base is logged and alerted.
{
  console.log("Untreated");
  const { st, h, p } = scene(12);
  h.autoTreat = false;
  h.stock.meds = 0;
  for (const s of p) { s.skills.medicine = 0; addCondition(st, s, "fever", "test", { sev: 85, quiet: true }); }
  check(conditionDrift(st, p[0], conditionsOf(p[0])[0]) > -1, "an untreated fever does not get better by itself (drift ≥ -1)");
  check(daysLeft(st, p[0], conditionsOf(p[0])[0]) == null || daysLeft(st, p[0], conditionsOf(p[0])[0]) > 10, "untreated it lasts");
  let pneu = 0;
  for (let d = 0; d < 15; d++) { st.hour += 24; healthDaily(st); st.cards.length = 0; pneu += p.filter((s) => conditionsOf(s).some((c) => c.key === "pneumonia")).length; }
  check(pneu > 0, `untreated fevers turn to pneumonia (${pneu} person-days of pneumonia)`);
  check(sickStats(st).byCause.worsened > 0, "counted as worsened");
  const dead = p.filter((s) => !s.alive).length;
  console.log(`  12 untreated fevers at 85: ${dead} dead after 15 days, health of the rest ${p.filter((s) => s.alive).map((s) => Math.round(s.health)).join(", ")}`);
  check(p.some((s) => !s.alive || s.health < 70), "untreated illness costs health");
  check(p.some((s) => s.alive && s.mood < 60), "and mood");
  // No meds and automatic care on: logged, alerted.
  h.autoTreat = true;
  for (const s of p) if (s.alive && !conditionsOf(s).length) addCondition(st, s, "flu", "test", { sev: 60, quiet: true });
  st.hour += 24;
  healthDaily(st);
  check(st.log.some((l) => /^No meds at /.test(l.text)), "no meds at a base: a log line each night");
  check(computeAlerts(st).some((a) => a.kind === "nomeds" && /No meds at/.test(a.text)), "and an alert");
  // Pneumonia costs aim and work.
  const pn = { conditions: [{ key: "pneumonia", sev: 70 }] };
  check(illnessAim(pn) <= -10, `pneumonia costs aim (${illnessAim(pn)})`);
}

// 5. Contagion at a base: a crowded base with one bad flu.
{
  console.log("Contagion");
  const { st, h, p } = scene(14);
  h.autoTreat = false; h.stock.meds = 0;
  findDay(st, "none");
  addCondition(st, p[0], "flu", "test", { sev: 90, quiet: true });
  for (let d = 0; d < 8; d++) { st.hour += 24; healthDaily(st); st.cards.length = 0; }
  check(sickStats(st).caught > 0, `the flu spread (${sickStats(st).caught} caught it)`);
  check((st.sickNews || []).some((n) => n.caught), "news of it spreading");
  const kinds = computeAlerts(st).map((a) => a.kind);
  check(kinds.includes("ill") || kinds.includes("spread"), `alerts for falling ill / spreading (${kinds.join(", ")})`);
}

// 6. Falling ill: a log line and an alert.
{
  console.log("Falling ill alert");
  const { st, p } = scene(3);
  addCondition(st, p[0], "flu", "in the rain at the hub", { cause: "weather" });
  check(st.log.some((l) => /came down with flu/.test(l.text)), "a log line");
  check(computeAlerts(st).some((a) => a.kind === "ill" && /fell ill/.test(a.text)), "an alert");
  st.hour += 30;
  check(!computeAlerts(st).some((a) => a.kind === "ill"), "the alert goes after a day");
}

// 7. Save and load: the course, the news, the stats, the week's meds; an old save's conditions still work.
{
  console.log("Save and load");
  const { st, h, p } = scene(3);
  p[0].role = "medic";
  addCondition(st, p[1], "dysentery", "test", { sev: 60 });
  treatCondition(st, h, p[1].id, "dysentery");
  st.cards.length = 0;
  const B = loadFromString(saveToString(st));
  const s1 = B.survivors.find((x) => x.id === p[1].id);
  const c = conditionsOf(s1)[0];
  check(c && c.course === 2 && c.dosed === 1 && !c.mending, "the course survives a save");
  check(B.sickStats && B.sickStats.medsBase === 1 && (B.sickNews || []).length === 1, "stats and news survive");
  check(sickMedsWeek(B, hub(B)) === 1, "the week's meds survive");
  // An old save: conditions without the course fields.
  delete c.course; delete c.dosed; delete c.mending; delete B.sickStats; delete B.sickNews; delete hub(B).sickMeds;
  check(needsDose(c) && dosesFor(c) >= 1, "an old condition wants a course");
  let err = null;
  try { for (let d = 0; d < 5; d++) { B.hour += 24; healthDaily(B); B.cards.length = 0; } } catch (e) { err = e; }
  check(!err, `an old save's illness runs${err ? `: ${err.stack}` : ""}`);
  check(alive(B).every((s) => conditionsOf(s).every((x) => Number.isFinite(x.sev))), "no NaN severity");
}

// 8. Every condition key is described and has an icon.
check(Object.values(CONDITIONS).every((d) => d.icon && d.desc && d.meds === 1), "every condition: an icon, a description, 1 meds a dose");

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
