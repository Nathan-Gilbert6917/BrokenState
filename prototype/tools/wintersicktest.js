// Winter and disease (src/sim/winter.js, src/sim/disease.js; the user's request 2026-10-21: "Winters can kill crops
// easier, food is hard to find in winter wood can be found but yields less in winter. Add disease, and other sickness
// system events that need to be treated with rest and meds. More people higher chances of sicknesses as well as new
// additions to a base").
// Checks: frost bites harder in winter and at its edges (tender crops), a cold snap takes hardy crops outdoors and none
// under glass, a frost loss gets its own log line; forage, game, fish, wood (trips and felling) and scavenged food yield
// less in winter; camp fever and wound fever (illnesses, catching or not, a course of two doses or more, climbing first,
// dragging on and costing health untreated, cleared by meds); the everyday chances rise with headcount and camp fever
// with crowding past the beds, flu season in winter only, wound fever from an infected wound; newcomers to a base carry
// something in after an incubation (not on the first pass, not births; moved between your bases less often; the
// Sickness dial honoured); the hub cards (flu season: quarantine, dose now, wait; bad water: boil, dump, drink; a
// coughing stranger: kept apart); AI parity (their food and wood by the season, their ill × headcount and flu season,
// dosed from their meds, dying without them, newcomers carrying it in); save and load.
// Usage: node tools/wintersicktest.js [seed]
import { createWorld, hub, atBase, makeSurvivor, day } from "../src/sim/world.js";
import { addBuilding } from "../src/sim/buildings.js";
import * as Weather from "../src/sim/weather.js";
import { WINTER, FROST, frostPhase, frostMult, coldSnap, winterScavFood, groupWildSeason, wildSeason } from "../src/sim/winter.js";
import { HEAD, CARRY, GROUP_SICK, QUAR, headMult, newcomersDaily, groupSickMult } from "../src/sim/disease.js";
import { CONDITIONS, addCondition, conditionsOf, dosesFor, conditionDrift, illnessRisk, baseRiskCtx, healthDaily, isIll } from "../src/sim/health.js";
import { farmOf, farmingDaily, plotClimate, CROPS } from "../src/sim/farming.js";
import { seasonForage } from "../src/sim/foraging.js";
import { seasonGame, seasonFish } from "../src/sim/hunting.js";
import { seasonWood } from "../src/sim/woodcutting.js";
import { chopRate } from "../src/sim/woodwork.js";
import { groupFoodLand, groupWoodLand } from "../src/sim/grouptrips.js";
import { illDaily, illOf } from "../src/sim/groupcare.js";
import { hubEventCard, hubEventWeights } from "../src/sim/hubevents.js";
import { setWorldCfg } from "../src/sim/worldcfg.js";
import { waterIn } from "../src/sim/water.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 11);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
const r2 = (v) => Math.round(v * 100) / 100;
// Campaign day indexes: day 1 is spring day 15, so summer starts at 14, autumn 42, winter 70, spring again 98.
const IDX = { summer: 28, autumnMid: 50, autumnLate: 65, winter: 80, springEarly: 100, springLate: 120 };
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 5 }); st.started = true; st.hour = 24 * 3 + 12; return st; };
const at = (st, idx) => { st.hour = idx * 24 + 12; };
const plain = (s) => { s.traits = []; s.conditions = []; s.woundInfected = false; s.health = 100; s.hunger = 90; s.thirst = 90; s.mood = 60; s.inBed = false; return s; };
const addPerson = (st, base, role = "craft") => { const s = plain(makeSurvivor(st, 1)); s.location = { kind: "base", baseId: base.id }; s.role = role; st.survivors.push(s); return s; };
// Only `n` plain people at the hub (everyone else away on an errand).
function scene(n = 4, st = world()) {
  const h = hub(st);
  for (const s of atBase(st, h.id)) s.location = { kind: "errand", until: 9999, pack: { food: 99, water: 99 } };
  const p = [];
  for (let i = 0; i < n; i++) p.push(addPerson(st, h));
  h.stock.meds = 30;
  return { st, h, p };
}
// The first winter day (index from..to) whose weather fits.
const findDay = (st, from, to, fit) => { for (let i = from; i <= to; i++) { const w = Weather.weatherOnDay(st, i + 1); if (fit(w)) return i; } return null; };

section("Winter crops: frost and cold snaps");
{
  const st = world();
  check(frostPhase(IDX.winter) === "winter" && frostPhase(IDX.autumnLate) === "edge" && frostPhase(IDX.springEarly) === "edge", "winter, late autumn and early spring are the frost's parts of the year");
  check(frostPhase(IDX.summer) === "" && frostPhase(IDX.autumnMid) === "" && frostPhase(IDX.springLate) === "", "summer, mid autumn and late spring are not");
  check(frostMult(IDX.winter) === FROST.winter && frostMult(IDX.autumnLate) === FROST.edge && frostMult(IDX.summer) === 1, `frost × ${FROST.winter} in winter, × ${FROST.edge} at its edges`);
  const cold = findDay(st, 70, 97, (w) => w.lo <= FROST.snap && (w.snowCover || 0) < 0.5);
  const snowy = findDay(st, 70, 97, (w) => w.lo <= FROST.snap && (w.snowCover || 0) >= 0.5);
  check(cold != null, `a bitter winter night with bare ground (day index ${cold})`);
  if (cold != null) {
    const potato = Weather.cropDamage(st, plotClimate("potato"), cold);
    const plain0 = 0.65 * (1 - CROPS.potato.climate.hardy);
    check(potato.kill > plain0 + 0.1, `potatoes outdoors in a winter freeze: ${r2(potato.kill)} a day to die (${r2(plain0)} by the old rule)`);
    const kale = Weather.cropDamage(st, plotClimate("kale"), cold);
    check(kale.kill > 0 && kale.reason === "cold snap", `hardy kale outdoors: ${r2(kale.kill)} a day to a cold snap (it never died of frost before)`);
    const gh = Weather.cropDamage(st, plotClimate("kale", true), cold);
    check(gh.kill === 0, `kale under glass the same night: ${gh.kill}`);
    const w = Weather.weatherOnDay(st, cold + 1);
    check(coldSnap(cold, { lo: w.lo, cover: 0.8 }) < coldSnap(cold, { lo: w.lo, cover: 0 }), "deep snow blankets a crop: a cold snap takes fewer");
  }
  if (snowy != null) check(Weather.cropDamage(st, plotClimate("kale"), snowy).kill <= FROST.snapKill + FROST.deepKill, "under deep snow a hardy crop's risk stays small");
  // The planners read it too: a hardy crop's survival through winter outdoors is below what it was, under glass high.
  // The log: a frost loss gets its own line, naming the crop.
  const h = hub(st);
  const f = farmOf(st, h);
  let line = null;
  for (let tries = 0; tries < 40 && !line; tries++) {
    for (const p of f.plots.filter((x) => !x.gh)) Object.assign(p, { stage: "growing", crop: "potato", grown: 1, care: 1, careDays: 1, ripeDays: 0, thirsty: false });
    at(st, cold != null ? cold : IDX.winter);
    st.log.length = 0;
    const out = farmingDaily(st, h, 1);
    if (out.frost.length) line = st.log.find((l) => /the frost killed/.test(l.text || l));
  }
  check(!!line && /Potatoes/.test(line.text || line), `a frost loss is logged: "${line ? line.text || line : "none"}"`);
  addBuilding(h, "greenhouse");
  farmOf(st, h);
  const ghPlots = f.plots.filter((x) => x.gh);
  let lost = 0;
  for (let i = 70; i <= 97; i++) {
    for (const p of ghPlots) Object.assign(p, { stage: "growing", crop: "kale", grown: 1, care: 1, careDays: 1, ripeDays: 0, thirsty: false });
    at(st, i);
    const w = Weather.weatherOnDay(st, i + 1);
    if (w.key === "blizzard" || w.key === "storm") continue;
    for (const p of ghPlots) p.stage = "growing";
    farmingDaily(st, h, 1);
    lost += ghPlots.filter((p) => p.stage === "dead").length;
  }
  check(ghPlots.length > 0 && lost === 0, `greenhouse kale through a winter: ${lost} plots lost of ${ghPlots.length} a day`);
}

section("Winter food and wood");
{
  const st = world();
  at(st, IDX.winter);
  const wF = seasonForage(st), wG = seasonGame(st), wFi = seasonFish(st), wW = seasonWood(st);
  at(st, IDX.autumnMid);
  const aF = seasonForage(st), aG = seasonGame(st), aW = seasonWood(st);
  check(wF <= WINTER.forage + 1e-9 && wF < aF / 5, `forage: winter ${r2(wF)} against autumn ${r2(aF)}`);
  check(wG <= WINTER.game * 1.2 + 1e-9 && wG < aG / 1.5, `game (hunts, snares, the cabin): winter ${r2(wG)} against autumn ${r2(aG)}`);
  check(wFi === WINTER.fish, `fish: winter ${wFi}`);
  check(wW <= WINTER.wood + 1e-9 && aW === 1, `wood: winter ${r2(wW)} (trips), the rest of the year 1`);
  const s = plain(makeSurvivor(st, 1));
  at(st, IDX.summer); const cs = chopRate(st, s, st.hour);
  at(st, IDX.winter); const cw = chopRate(st, s, st.hour);
  check(cw < cs * 0.75, `felling a tree: ${cw} work-hours an hour in winter against ${cs} in summer`);
  at(st, IDX.winter);
  check(winterScavFood(st, 10) === Math.round(10 * WINTER.scavFood) && winterScavFood(st, 1) === 1, `a scavenged food find in winter: 10 → ${winterScavFood(st, 10)}, never below 1`);
  at(st, IDX.summer);
  check(winterScavFood(st, 10) === 10, "the rest of the year unchanged");
  // AI parity: their food's wild share by the season, a year's total as before; their wood by yours.
  const seasons = ["spring", "summer", "autumn", "winter"];
  const mean = seasons.reduce((a, k) => a + wildSeason(k), 0) / 4;
  check(wildSeason("winter") < wildSeason("spring") && wildSeason("autumn") > wildSeason("summer"), `wild food: ${seasons.map((k) => `${k} ${r2(wildSeason(k))}`).join(", ")}`);
  const f = st.factions.find((x) => x.alive && x.bases.length);
  at(st, IDX.winter); const gw = groupWildSeason(st), fw = groupFoodLand(st, f), ww = groupWoodLand(st, f);
  at(st, IDX.autumnMid); const ga = groupWildSeason(st), fa = groupFoodLand(st, f), wa = groupWoodLand(st, f);
  check(gw < 0.9 && ga > 1, `a group's food × ${gw} in winter, × ${ga} in autumn (a year's mean ${r2(seasons.reduce((a, k) => a + (1 - WINTER.wild + WINTER.wild * wildSeason(k) / mean), 0) / 4)})`);
  check(Math.abs(fw / fa - gw / ga) < 0.01, `their land's food follows it (${r2(fw)} winter, ${r2(fa)} autumn)`);
  check(ww < wa * 0.8, `their wood: ${r2(ww)} in winter against ${r2(wa)} (your seasonWood)`);
}

section("Camp fever and wound fever");
{
  for (const k of ["campfever", "woundfever"]) {
    const d = CONDITIONS[k];
    check(d && d.kind === "illness" && d.hp > 0 && d.meds === 1 && d.minCourse >= 2, `${k}: an illness that costs health, ${d.meds} meds a dose, a course of ${d.minCourse}+`);
    check(dosesFor({ key: k, sev: 20 }) >= 2, `${k}: even a mild case takes two doses`);
  }
  check(CONDITIONS.campfever.spread > 0 && CONDITIONS.woundfever.spread === 0, "camp fever is catching, wound fever not");
  // Untreated against treated: the same case, two worlds, no other sickness (the Sickness dial at 0 stops new cases).
  const run = (meds) => {
    const { st, h, p } = scene(3);
    setWorldCfg(st, { sickness: 0 });
    at(st, IDX.summer);
    h.stock.meds = meds;
    const s = p[0];
    s.role = "rest";
    const c = addCondition(st, s, "campfever", "test", { sev: 45, quiet: true });
    const drift0 = conditionDrift(st, s, c);
    let days = 0;
    for (; days < 30 && s.alive && conditionsOf(s).some((x) => x.key === "campfever"); days++) { healthDaily(st); st.hour += 24; }
    return { s, days, drift0, gone: !conditionsOf(s).some((x) => x.key === "campfever"), meds: h.stock.meds };
  };
  const none = run(0), some = run(20);
  check(none.drift0 > 0, `camp fever climbs at first even resting (${none.drift0} a day)`);
  check(!none.gone && none.s.health < 80, `untreated, resting: still ill after ${none.days} days, health ${Math.round(none.s.health)}`);
  check(some.gone && some.days < none.days && some.s.health > none.s.health && some.meds < 20, `treated (automatic care): gone in ${some.days} days, health ${Math.round(some.s.health)}, ${20 - some.meds} meds`);
  const { st, h, p } = scene(4);
  at(st, IDX.summer);
  p[0].woundInfected = true;
  const part = illnessRisk(st, p[0], baseRiskCtx(st, h)).parts.find((x) => x.key === "woundfever");
  check(!!part && part.cause === "wound" && part.hash, `an infected wound: ${part ? r2(part.p * 100) : 0}% a day of wound fever`);
  check(!illnessRisk(st, p[1], baseRiskCtx(st, h)).parts.some((x) => x.key === "woundfever"), "a clean one: none");
}

section("More people, more sickness");
{
  check(headMult(4) === 1 && Math.abs(headMult(20) - (1 + HEAD.per * 14)) < 1e-9 && headMult(100) === HEAD.cap, `headcount: 4 ×${headMult(4)}, 10 ×${r2(headMult(10))}, 20 ×${r2(headMult(20))}, 30 ×${r2(headMult(30))}, at most ×${HEAD.cap}`);
  const small = scene(4), big = scene(24);
  for (const x of [small, big]) at(x.st, IDX.summer);
  const part = (x, key, cause) => (illnessRisk(x.st, x.p[0], baseRiskCtx(x.st, x.h)).parts.find((y) => y.key === key && y.cause === cause) || { p: 0 }).p;
  check(part(big, "chestcold", "common") > part(small, "chestcold", "common") * 1.5, `a cold going round: ${r2(part(small, "chestcold", "common") * 100)}% a day among 4, ${r2(part(big, "chestcold", "common") * 100)}% among 24`);
  check(part(big, "campfever", "crowding") > part(small, "campfever", "crowding"), `camp fever: ${r2(part(small, "campfever", "crowding") * 100)}% among 4, ${r2(part(big, "campfever", "crowding") * 100)}% among 24`);
  const ctx = baseRiskCtx(big.st, big.h);
  const roomy = illnessRisk(big.st, big.p[0], { ...ctx, crowd: 0 }).parts.find((y) => y.key === "campfever").p;
  const packed = illnessRisk(big.st, big.p[0], { ...ctx, crowd: 0.5 }).parts.find((y) => y.key === "campfever").p;
  check(packed > roomy * 2.5, `past the beds (half again as many as beds): camp fever ${r2(roomy * 100)}% → ${r2(packed * 100)}%`);
  at(big.st, IDX.winter);
  check(illnessRisk(big.st, big.p[0], baseRiskCtx(big.st, big.h)).parts.some((y) => y.cause === "season"), "flu season in winter");
  at(big.st, IDX.summer);
  check(!illnessRisk(big.st, big.p[0], baseRiskCtx(big.st, big.h)).parts.some((y) => y.cause === "season"), "none in summer");
  setWorldCfg(big.st, { sickness: 0 });
  check(illnessRisk(big.st, big.p[0], baseRiskCtx(big.st, big.h)).parts.length === 0, "the Sickness dial at 0: no chances at all");
}

section("Newcomers carry it in");
{
  const { st, h, p } = scene(4);
  at(st, IDX.winter);
  setWorldCfg(st, { sickness: 4 });
  newcomersDaily(st);
  check(st.sickHomes === true && p.every((s) => s.sickHome === h.id && !s.incubating), "the first pass only notes where everyone lives");
  const away = st.survivors.filter((s) => s.alive && s.location.kind === "errand");
  for (const s of away) s.location = { kind: "base", baseId: h.id };
  newcomersDaily(st);
  check(away.length > 0 && away.every((s) => !s.incubating && s.sickHome === h.id), `${away.length} away on the first pass come home carrying nothing (known to the group)`);
  for (const s of away) s.location = { kind: "errand", until: 9999, pack: { food: 99, water: 99 } };
  const fresh = [], born = [];
  for (let i = 0; i < 40; i++) fresh.push(addPerson(st, h));
  for (let i = 0; i < 10; i++) { const b = addPerson(st, h); b.born = day(st); born.push(b); }
  newcomersDaily(st);
  const carrying = fresh.filter((s) => s.incubating);
  const share = carrying.length / fresh.length;
  check(share > CARRY.outside * 4 * 0.5 && share < Math.min(1, CARRY.outside * 4 * 1.6), `newcomers (the Sickness dial ×4): ${carrying.length} of ${fresh.length} carry something in`);
  check(born.every((s) => !s.incubating) && p.every((s) => !s.incubating), "births and the people already there carry nothing");
  check(carrying.every((s) => CONDITIONS[s.incubating.key] && s.incubating.day >= day(st) + CARRY.incubate[0] && s.incubating.day <= day(st) + CARRY.incubate[1] && !isIll(s)), `hidden for ${CARRY.incubate.join("–")} days first`);
  const one = carrying[0];
  if (one) {
    st.hour = (one.incubating.day - 1) * 24 + 12;
    const key = one.incubating.key;
    newcomersDaily(st);
    const c = conditionsOf(one).find((x) => x.key === key);
    check(!!c && c.cause === "newcomer" && /carried in/.test(c.why) && !one.incubating, `then it shows: ${one.name} comes down with ${CONDITIONS[key].name.toLowerCase()} (${c ? c.why : "nothing"})`);
  }
  // Moved in from another of your bases: a smaller chance; the dial at 0: none.
  const moved = [];
  for (let i = 0; i < 60; i++) { const s = addPerson(st, h); s.sickHome = 99999; moved.push(s); }
  newcomersDaily(st);
  const mShare = moved.filter((s) => s.incubating).length / moved.length;
  check(mShare < share, `moved in from another base: ${Math.round(mShare * 100)}% (from outside ${Math.round(share * 100)}%)`);
  setWorldCfg(st, { sickness: 0 });
  const none = [];
  for (let i = 0; i < 30; i++) none.push(addPerson(st, h));
  newcomersDaily(st);
  check(none.every((s) => !s.incubating), "the Sickness dial at 0: nobody carries anything");
  // Save and load keep it.
  setWorldCfg(st, { sickness: 1 });
  const B = loadFromString(saveToString(st));
  // Everyone still carrying something at the save (carrying[1] may already have come down with it when the clock went
  // to carrying[0]'s day), and everyone's home.
  const still = st.survivors.filter((s) => s.incubating);
  const backOf = (s) => B.survivors.find((x) => x.id === s.id);
  check(B.sickHomes === true && still.length > 0 && still.every((s) => backOf(s) && backOf(s).incubating && backOf(s).incubating.key === s.incubating.key && backOf(s).incubating.day === s.incubating.day) && st.survivors.every((s) => s.sickHome == null || (backOf(s) && backOf(s).sickHome === s.sickHome)), `save and load keep who carries what and where they live (${still.length} carrying)`);
}

section("Cards at the hub");
{
  const { st, h, p } = scene(8);
  at(st, IDX.winter);
  addCondition(st, p[0], "flu", "test", { sev: 85, quiet: true });
  check(hubEventWeights(st, h).fluseason > 0, `flu season: weighed in winter with someone catching (${r2(hubEventWeights(st, h).fluseason)})`);
  const card = hubEventCard(st, "fluseason", h);
  check(card.choices.length === 3 && /Keep the sick apart/.test(card.choices[0].label) && /Dose/.test(card.choices[1].label) && /Wait/.test(card.choices[2].label), `three answers: ${card.choices.map((c) => c.label).join(" / ")}`);
  card.choices[0].resolve(st);
  check(h.quarantineUntil >= day(st) + QUAR - 1 && baseRiskCtx(st, h).quarantine, `kept apart: quarantine to day ${h.quarantineUntil}`);
  check(hubEventWeights(st, h).fluseason === 0, "not again while the quarantine lasts");
  delete h.quarantineUntil;
  const m0 = h.stock.meds;
  hubEventCard(st, "fluseason", h).choices[1].resolve(st);
  check(h.stock.meds < m0 && conditionsOf(p[0]).find((c) => c.key === "flu").dosed >= 1, `dosed now: ${m0 - h.stock.meds} meds`);
  at(st, IDX.summer);
  check(hubEventWeights(st, h).fluseason === 0, "no flu season card in summer");
  // Bad water.
  h.stock.water = 100; h.stock.wood = 10000;
  const bw = hubEventCard(st, "badwater", h);
  const w0 = h.stock.wood;
  bw.choices[0].resolve(st);
  check(h.stock.wood < w0, `boiled: ${w0 - h.stock.wood} wood`);
  const wa = waterIn(h.stock);
  hubEventCard(st, "badwater", h).choices[1].resolve(st);
  check(waterIn(h.stock) < wa, `dumped: ${Math.round(wa - waterIn(h.stock))} water`);
  for (let i = 0; i < 6; i++) hubEventCard(st, "badwater", h).choices[2].resolve(st);
  check(atBase(st, h.id).some((s) => conditionsOf(s).some((c) => c.key === "dysentery")), "drunk anyway (six times): dysentery");
  // A coughing stranger: they bring it; kept apart, a quarantine.
  const cc = hubEventCard(st, "cough", h);
  const who = cc.recruit.candidates[0];
  check(conditionsOf(who).some((c) => CONDITIONS[c.key].spread > 0), `the stranger is ill with something catching (${conditionsOf(who).map((c) => c.key).join(", ")})`);
  const apart = cc.choices.find((c) => /kept apart/.test(c.label));
  check(!!apart && apart.kind === "take" && cc.choices.some((c) => c.kind === "away"), "answers: take in kept apart (first of the take-ins), take in, turn away …");
  delete h.quarantineUntil;
  apart.resolve(st);
  check(!who.pending && who.location.kind === "base" && who.location.baseId === h.id && h.quarantineUntil >= day(st), `${who.name} joins, kept apart to day ${h.quarantineUntil}`);
}

section("AI parity: the groups' ill");
{
  const st = world();
  const f = st.factions.find((x) => x.alive && x.bases.length && Array.isArray(x.people) && x.people.length >= 6);
  check(!!f, `a group with people (${f ? f.name : "none"})`);
  if (f) {
    at(st, IDX.summer); const ms = groupSickMult(st, f, 0.0075);
    at(st, IDX.winter); const mw = groupSickMult(st, f, 0.0075);
    check(mw > ms, `their rate × ${r2(mw)} in winter (flu season), × ${r2(ms)} in summer`);
    const pop0 = f.pop;
    f.pop = 40 * f.bases.length; const big = groupSickMult(st, f, 0.0075);
    f.pop = 4 * f.bases.length; const small = groupSickMult(st, f, 0.0075);
    f.pop = pop0;
    check(big > small, `more people a base, more of it: × ${r2(big)} at 40 a base, × ${r2(small)} at 4`);
    // Dosed from their meds.
    at(st, IDX.summer);
    f.ill = 4; f.stock.meds = 50; f.sickSeen = f.pop;
    illDaily(st, f);
    check(f.stock.meds < 50 && Math.abs(50 - f.stock.meds - 4 * GROUP_SICK.meds) < 1e-6, `their ill dosed: ${r2(50 - f.stock.meds)} meds for 4 ill`);
    // Without meds some die.
    const pop1 = f.pop, list1 = f.people.length;
    f.stock.meds = 0;
    for (let i = 0; i < 120; i++) { f.ill = Math.max(f.ill, 5); f.careTick = (f.careTick || 0) + 1; st.hour += 24; illDaily(st, f); }
    check((f.diedOfIllness || 0) > 0 && f.pop < pop1 && f.people.length < list1, `no meds, 5 ill for 120 days: ${f.diedOfIllness || 0} died of it (people ${list1} → ${f.people.length})`);
    // Newcomers carry it in.
    f.ill = 0; f.sickSeen = f.pop; f.pop += 10;
    illDaily(st, f);
    check(illOf(f) > 10 * CARRY.outside * 0.9, `10 newcomers: ${r2(illOf(f))} ill the next day`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
