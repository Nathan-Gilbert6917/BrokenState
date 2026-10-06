// The Prisoners tab (src/sim/prisoners.js, ui/prisoners.js): rations (food use through upkeep.js, health over time,
// starving to death, your people's mood by trait), labour (output by skill into the farm, the build queue, the water,
// the kitchen and upkeep; the guard it needs and the escapes without one; tiring; weeks of work easing recruiting; a
// shelter's smaller job set), the actions' odds and effects (questioning and rough questioning, asking to join,
// executing), save/load (old saves default to Short rations and Idle), the tab's HTML and selects, determinism.
// Usage: node tools/prisonertest.js [seed]
import { createWorld, hub, atBase, day } from "../src/sim/world.js";
import { addBuilding, buildRate } from "../src/sim/buildings.js";
import { careToday } from "../src/sim/farming.js";
import { waterProduction } from "../src/sim/economy.js";
import { breakdownsDaily, fixtures } from "../src/sim/breakdowns.js";
import { foodUse } from "../src/sim/upkeep.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { infamy } from "../src/sim/conquest.js";
import {
  PRISON, TASKS, prisonersAt, captiveRecords, capturePrisoners, prisonersDaily, rationOf, taskOf, prisonerFood,
  labourOutput, prisonLabour, prisonBuildRate, prisonWater, labourWatch, escapeOdds, prisonGuardsWanted, tasksAt,
  setRation, setAllRations, setTask, setAllTasks, questionOdds, questionPrisoner, askOdds, askToJoin, recruitRate,
  executePrisoner, prisonSummary, kitchenPlan,
} from "../src/sim/prisoners.js";
import { prisonTab, PRISON_CHANGE, PRISON_ACTIONS } from "../src/ui/prisoners.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const pct = (v) => `${Math.round(v * 1000) / 10}%`;
const r2 = (v) => Math.round(v * 100) / 100;
const t0 = Date.now();

// A hub with a Holding cells building and n prisoners of a living group; plenty of food and water; everyone resting.
function prisonWorld(s = seed, n = 2, cells = 1) {
  const st = createWorld({ seed: s, factionCount: 6 });
  st.started = true; st.visitorsOff = true;
  const h = hub(st);
  for (let i = 0; i < cells; i++) addBuilding(h, "cells");
  for (const p of atBase(st, h.id)) { p.role = "rest"; p.station = null; p.traits = []; p.mood = 60; }
  const f = st.factions.find((x) => x.alive && x.pop >= 10);
  const fakeB = { setup: { enemy: { kind: "raiders", power: 4, factionId: f.id, name: f.name } }, tileId: h.tile };
  const recs = captiveRecords(st, fakeB, Array.from({ length: n }, (_, i) => ({ kit: "raiders", name: `Raider ${i + 1}`, factionId: f.id })));
  capturePrisoners(st, { baseId: h.id, tile: h.tile, enemy: fakeB.setup.enemy }, { outcome: "victory", tactical: true, prisoners: recs }, null);
  Object.assign(h.stock, { food: 300, water: 300, preserved: 0 });
  const list = prisonersAt(st, h.id);
  for (const p of list) { p.s.health = 60; p.s.mood = 30; }
  return { st, h, f, list };
}
const guardOn = (st, h) => { const g = atBase(st, h.id).find((s) => !s.leader) || atBase(st, h.id)[0]; g.role = "guard"; return g; };
// Run with escapes switched off (the rules under test are not the dice).
function noEscapes(fn) {
  const keep = { ...PRISON.ESCAPE }, keepL = { g: PRISON.LABOUR.escapeGuarded, u: PRISON.LABOUR.escapeUnguarded }, keepW = PRISON.WEAK.death;
  for (const k of ["guarded", "unguarded", "shed", "unfed"]) PRISON.ESCAPE[k] = 0;
  PRISON.LABOUR.escapeGuarded = 0; PRISON.LABOUR.escapeUnguarded = 0; PRISON.WEAK.death = 0;
  try { return fn(); } finally { Object.assign(PRISON.ESCAPE, keep); PRISON.LABOUR.escapeGuarded = keepL.g; PRISON.LABOUR.escapeUnguarded = keepL.u; PRISON.WEAK.death = keepW; }
}
const day1 = (st) => { st.hour += 24; prisonersDaily(st); };

// ---------- 1. defaults ----------
{
  console.log("Defaults");
  const { list } = prisonWorld();
  check(list.every((p) => p.ration === "short" && p.task === "idle"), "new prisoners are on Short rations, Idle in the cell");
  check(rationOf({}) === "short" && taskOf({}) === "idle" && rationOf({ ration: "bogus" }) === "short", "a record without them (old saves) reads Short and Idle");
  check(PRISON.RATIONS.short.share === 0.6 && near(prisonerFood(list[0]), 0.6), `Short is 60% (${prisonerFood(list[0])} food a day before the cold)`);
}

// ---------- 2. rations: food use ----------
{
  console.log("Rations: food");
  const { st, h, list } = prisonWorld(seed, 4, 2);
  const keys = ["full", "short", "starve", "none"];
  list.forEach((p, i) => setRation(st, p.id, keys[i]));
  const use = foodUse(st, h);
  const g = use.groups.find((x) => x.key === "prisoners");
  const expect = (1 + 0.6 + 0.3 + 0) * PRISON.FOOD * (use.cold || 1);
  check(g && g.n === 4 && near(g.total, expect, 1e-6), `upkeep.js counts them by their rations: 4 prisoners × ${g && g.each} = ${g && r2(g.total)} (Full + Short + Starvation + None = ${r2(expect)})`);
  const f0 = h.stock.food;
  noEscapes(() => prisonersDaily(st));
  check(near(f0 - h.stock.food, expect, 1e-6), `the day eats exactly that from the stores (${r2(f0 - h.stock.food)})`);
  check(list[3].unfed === 1 && list[0].unfed === 0 && list[2].unfed === 0, "None is unfed (Starvation still eats)");
  setAllRations(st, h.id, "full");
  check(list.every((p) => rationOf(p) === "full") && near(foodUse(st, h).groups.find((x) => x.key === "prisoners").total, 4 * (use.cold || 1)), "set all: everyone on Full eats 1 each");
  check(prisonSummary(st, h).food > prisonSummary(st, h).fullFood - 1e-6, "the summary's food matches");
}

// ---------- 3. rations: health over time, starving, your people's mood ----------
{
  console.log("Rations: health and mood");
  const run = (ration, days = 30) => noEscapes(() => {
    const { st, h, list } = prisonWorld(seed + 1, 1);
    guardOn(st, h);
    setRation(st, list[0].id, ration);
    let died = 0;
    for (let d = 1; d <= days && !died; d++) { h.stock.food = 300; h.stock.water = 300; day1(st); if (!st.prisoners.includes(list[0])) died = d; }
    return { hp: list[0].s.health, mood: list[0].s.mood, died, opinion: list[0].opinion };
  });
  const full = run("full"), short = run("short"), starve = run("starve"), none = run("none");
  check(full.hp >= 99 && !full.died, `Full heals: health 60 → ${full.hp} in 30 days`);
  check(near(short.hp, 60, 0.6) && !short.died, `Short holds them near 60 (${short.hp})`);
  check(starve.hp <= 60 - 30 * 1.5 + 1 && starve.hp < short.hp, `Starvation wastes them: 60 → ${starve.hp} in 30 days`);
  check(none.died > 0 && none.died <= PRISON.STARVE_DAYS, `None: dead on day ${none.died} (within ${PRISON.STARVE_DAYS})`);
  check(full.mood > short.mood && short.mood > starve.mood, `their mood by rations: Full ${full.mood}, Short ${short.mood}, Starvation ${starve.mood}`);
  check(starve.opinion < 0 && full.opinion > 0, `held on Starvation they sour (opinion ${r2(starve.opinion)}), on Full they warm (${r2(full.opinion)})`);
  // Weak and starving: a death chance a day.
  {
    let deaths = 0, n = 0;
    for (let i = 0; i < 200; i++) {
      const { st, h, list } = prisonWorld(seed + 500 + i, 1);
      guardOn(st, h);
      setRation(st, list[0].id, "starve");
      list[0].s.health = 15;
      const keep = { ...PRISON.ESCAPE }; for (const k of ["guarded", "unguarded", "shed", "unfed"]) PRISON.ESCAPE[k] = 0;
      day1(st); n++;
      Object.assign(PRISON.ESCAPE, keep);
      if (!st.prisoners.includes(list[0])) deaths++;
    }
    check(deaths > 0 && deaths / n < 0.1, `weak and starving: ${deaths} of ${n} died in a day (rule ${pct(PRISON.WEAK.death)})`);
  }
  // Your people see it.
  noEscapes(() => {
    const { st, h, list } = prisonWorld(seed + 2, 1);
    const ppl = atBase(st, h.id);
    ppl[0].traits = ["medic"]; ppl[1].traits = ["brave"]; ppl[2].traits = [];
    for (const s of ppl) s.mood = 60;
    setRation(st, list[0].id, "starve");
    day1(st);
    check(near(ppl[2].mood, 60 + PRISON.SEEN.mood) && near(ppl[0].mood, 60 + PRISON.SEEN.soft) && near(ppl[1].mood, 60 + PRISON.SEEN.hard), `a prisoner starved: mood ${PRISON.SEEN.mood} for most, ${PRISON.SEEN.soft} for a Former Medic, ${PRISON.SEEN.hard} for the Brave (${ppl[2].mood - 60} / ${ppl[0].mood - 60} / ${ppl[1].mood - 60})`);
    for (const s of ppl) s.mood = 60;
    setRation(st, list[0].id, "short");
    day1(st);
    check(ppl.every((s) => s.mood === 60), "on Short nobody minds");
  });
}

// ---------- 4. labour: output into production ----------
{
  console.log("Labour: output");
  const { st, h, list } = prisonWorld(seed + 3, 3, 1);
  const p = list[0];
  p.s.health = 80;
  setRation(st, p.id, "full");
  check(labourOutput(st, p, h) === 0, "Idle: no work");
  p.s.skills.farming = 0;
  setTask(st, p.id, "farm");
  const lo = labourOutput(st, p, h);
  p.s.skills.farming = 10;
  const hi = labourOutput(st, p, h);
  check(near(lo, PRISON.LABOUR.min) && near(hi, PRISON.LABOUR.max), `50–70% of a survivor by skill: Farming 0 ${pct(lo)}, Farming 10 ${pct(hi)}`);
  setRation(st, p.id, "starve");
  check(labourOutput(st, p, h) < hi * 0.7, `on Starvation less (${pct(labourOutput(st, p, h))})`);
  setRation(st, p.id, "full");
  p.s.health = 20;
  check(labourOutput(st, p, h) === 0, `too weak under ${PRISON.LABOUR.minHealth} health`);
  p.s.health = 80;
  // Farm: the crops' care.
  setTask(st, p.id, "idle");
  const care0 = careToday(st, h).labour;
  setTask(st, p.id, "farm");
  check(near(careToday(st, h).labour - care0, labourOutput(st, p, h)), `Farm adds ${r2(labourOutput(st, p, h))} to the farm labour (farming.js careToday ${r2(care0)} → ${r2(careToday(st, h).labour)})`);
  // Build: construction an hour.
  setTask(st, p.id, "build");
  const b0 = buildRate(st, h) - prisonBuildRate(st, h);
  check(prisonBuildRate(st, h) > 0 && near(buildRate(st, h) - b0, labourOutput(st, p, h) * PRISON.LABOUR.hours / 24), `Build adds ${r2(prisonBuildRate(st, h) * 24)} builder-hours a day (buildings.js buildRate)`);
  // Water.
  setTask(st, p.id, "idle");
  const w0 = waterProduction(st, h).total;
  setTask(st, p.id, "water");
  check(prisonWater(st, h) > 0 && near(waterProduction(st, h).total, Math.round((w0 + prisonWater(st, h)) * 10) / 10, 0.11), `Fetch water: +${prisonWater(st, h)} a day (economy.js waterProduction ${w0} → ${waterProduction(st, h).total})`);
  // Kitchen: surplus fresh food dried by hand.
  setTask(st, p.id, "kitchen");
  guardOn(st, h);
  h.stock.food = 2000; h.stock.preserved = 0;
  const plan = kitchenPlan(st, h);
  noEscapes(() => day1(st));
  check(plan.take > 0 && h.stock.preserved > 0 && near(h.stock.preserved, plan.out, 0.5), `Kitchen dries ${r2(plan.take)} fresh food into ${r2(h.stock.preserved)} preserved a day`);
  // Clean and mend: wear off the buildings (two identical worlds, one with a prisoner cleaning).
  const wear = (task) => {
    const w = prisonWorld(seed + 4, 1, 1);
    w.list[0].s.health = 80;
    setTask(w.st, w.list[0].id, task);
    for (const fx of fixtures(w.h)) fx.wear = 50;
    w.h.construction = [{ id: 1, type: "farm_plot", progress: 0, hours: 999 }]; // builders busy: only the prisoner mends
    breakdownsDaily(w.st);
    return fixtures(w.h).reduce((a, fx) => a + (fx.wear || 0), 0);
  };
  const dirty = wear("idle"), clean = wear("upkeep");
  check(clean < dirty, `Clean and mend takes wear off the buildings (${r2(dirty)} → ${r2(clean)} in all)`);
  // The tab's numbers.
  const sum = prisonSummary(st, h);
  check(sum.labour.kitchen > 0 && sum.watch.workers.length === 1, `summary: ${sum.watch.workers.length} at work, kitchen ${r2(sum.labour.kitchen)}`);
}

// ---------- 5. labour: guards, escapes, tiring, recruiting ----------
{
  console.log("Labour: guards and escapes");
  const { st, h, list } = prisonWorld(seed + 5, 6, 2);
  check(prisonGuardsWanted(st, h) === 1, "prisoners in the cells want one guard");
  setAllTasks(st, h.id, "farm");
  check(prisonGuardsWanted(st, h) === 2 && list.every((p) => taskOf(p) === "farm"), `six out at work want ${prisonGuardsWanted(st, h)} guards (one per ${PRISON.LABOUR.guardWatch})`);
  let w = labourWatch(st, h);
  check(w.workers.length === 6 && w.watched.size === 0, "no guard: nobody at work is watched");
  const unwatched = escapeOdds(st, list[0], { watch: w });
  guardOn(st, h);
  w = labourWatch(st, h);
  check(w.watched.size === PRISON.LABOUR.guardWatch, `one guard watches ${w.watched.size}`);
  const watched = escapeOdds(st, list[0], { watch: w }), extra = escapeOdds(st, list[5], { watch: w });
  check(near(watched, PRISON.LABOUR.escapeGuarded) && near(unwatched, PRISON.LABOUR.escapeUnguarded) && near(extra, PRISON.LABOUR.escapeUnguarded), `escape a day at work: watched ${pct(watched)}, unwatched ${pct(unwatched)} (the 5th and 6th with one guard ${pct(extra)})`);
  const idleCell = (() => { setTask(st, list[0].id, "idle"); const e = escapeOdds(st, list[0]); setTask(st, list[0].id, "farm"); return e; })();
  check(idleCell < watched, `in a guarded cell less (${pct(idleCell)})`);
  // Monte Carlo: labourers with and without a guard.
  const rate = (guard) => {
    let esc = 0, days = 0;
    for (let i = 0; i < 120; i++) {
      const x = prisonWorld(seed + 900 + i, 1);
      x.list[0].s.health = 80;
      setTask(x.st, x.list[0].id, "farm");
      if (guard) guardOn(x.st, x.h);
      for (let d = 0; d < 5 && x.st.prisoners.length; d++) { day1(x.st); days++; }
      esc += 1 - x.st.prisoners.length;
    }
    return esc / days;
  };
  const g = rate(true), u = rate(false);
  check(g < 0.03 && u > 0.035 && u > g * 2, `labourers run off: ${pct(g)} a day with a guard, ${pct(u)} without`);
  // Tiring, and weeks of work.
  noEscapes(() => {
    const a = prisonWorld(seed + 6, 2, 1);
    guardOn(a.st, a.h);
    const [worker, idler] = a.list;
    for (const p of a.list) { p.s.health = 80; p.s.mood = 40; setRation(a.st, p.id, "short"); }
    setTask(a.st, worker.id, "farm");
    for (let d = 0; d < 10; d++) day1(a.st);
    check(worker.s.mood < idler.s.mood && worker.s.health < idler.s.health, `work tires them on Short: mood ${worker.s.mood} vs ${idler.s.mood} idle, health ${worker.s.health} vs ${idler.s.health}`);
    check(worker.labourDays === 10 && !idler.labourDays, `${worker.labourDays} good days of work counted`);
    worker.opinion = idler.opinion = 60;
    const rw = (() => { worker.mode = "recruit"; idler.mode = "recruit"; return [recruitRate(a.st, worker), recruitRate(a.st, idler)]; })();
    worker.labourDays = 40;
    check(recruitRate(a.st, worker) > rw[1] * 1.3, `weeks of work: winning over ${r2(recruitRate(a.st, worker))} a day vs ${r2(rw[1])}`);
    worker.s.mood = idler.s.mood;
    check(askOdds(a.st, worker) > askOdds(a.st, idler), `and asking to join: ${pct(askOdds(a.st, worker))} vs ${pct(askOdds(a.st, idler))}`);
  });
  // Under attack nobody goes out.
  {
    const x = prisonWorld(seed + 7, 1);
    x.list[0].s.health = 80;
    setTask(x.st, x.list[0].id, "farm");
    const before = labourOutput(x.st, x.list[0], x.h);
    x.h.alert = true; // buildings.js underAttack
    check(before > 0 && labourOutput(x.st, x.list[0], x.h) === 0, "on alert they are locked in: no work");
  }
  // A shelter: a smaller job set.
  {
    const x = prisonWorld(seed + 8, 1);
    x.h.tier = 0;
    const ok = tasksAt(x.st, x.h);
    check(!ok.includes("upkeep") && ok.includes("farm") && ok.includes("build") && ok.includes("kitchen"), `a shelter: ${ok.join(", ")} (no clean and mend${ok.includes("water") ? "" : ", no water away from a river"})`);
    const msg = setTask(x.st, x.list[0].id, "upkeep");
    check(taskOf(x.list[0]) === "idle" && /Nothing of that kind/.test(msg), "setting a task the shelter has no work for is refused");
    x.list[0].task = "upkeep"; // set at a base that then fell back to a shelter (or an old save)
    check(labourOutput(x.st, x.list[0], x.h) === 0, "and does nothing there");
    setTask(x.st, x.list[0].id, "build");
    x.list[0].s.health = 80;
    check(labourOutput(x.st, x.list[0], x.h) > 0, "Build works at a shelter");
  }
}

// ---------- 6. actions: odds and effects ----------
{
  console.log("Actions");
  const { st, h, f, list } = prisonWorld(seed + 9, 3, 1);
  const p = list[0];
  const talk = questionOdds(st, p), rough = questionOdds(st, p, "rough");
  check(near(rough - talk, PRISON.QUESTION.rough.odds) || rough === 0.95, `questioning ${pct(talk)}, roughly ${pct(rough)}`);
  setRation(st, p.id, "starve");
  check(near(questionOdds(st, p) - talk, PRISON.RATIONS.starve.question) || questionOdds(st, p) === 0.95, `hunger loosens tongues: on Starvation ${pct(questionOdds(st, p))}`);
  setRation(st, p.id, "short");
  const lead = atBase(st, h.id).find((s) => s.leader);
  if (lead) { const l0 = lead.skills.leadership; lead.skills.leadership = l0 + 5; check(questionOdds(st, p) > talk || talk >= 0.95, `the leader's Leadership helps (${pct(questionOdds(st, p))} with +5)`); lead.skills.leadership = l0; }
  const ppl = atBase(st, h.id);
  for (const s of ppl) { s.mood = 60; s.traits = []; }
  ppl[0].traits = ["medic"];
  const hp0 = p.s.health, op0 = p.opinion, gw0 = f.goodwill;
  questionPrisoner(st, p.id, "rough");
  check(near(p.s.health, hp0 + PRISON.QUESTION.rough.health) && near(p.opinion, op0 + PRISON.QUESTION.rough.sour), `rough questioning: their health ${hp0} → ${p.s.health}, opinion ${op0} → ${p.opinion}`);
  check(near(ppl[1].mood, 60 + PRISON.QUESTION.rough.baseMood) && near(ppl[0].mood, 60 + PRISON.QUESTION.rough.soft) && f.goodwill === Math.max(-100, gw0 + PRISON.QUESTION.rough.goodwill), `your people ${ppl[1].mood - 60} (a Former Medic ${ppl[0].mood - 60}), goodwill ${gw0} → ${f.goodwill}`);
  // Asking to join.
  const q = list[1];
  q.opinion = 10;
  check(near(askOdds(st, q), PRISON.ASK.min), `asking with opinion 10: ${pct(askOdds(st, q))}`);
  q.opinion = 80;
  const shortOdds = askOdds(st, q);
  setRation(st, q.id, "full"); const fullOdds = askOdds(st, q);
  setRation(st, q.id, "starve"); const starveOdds = askOdds(st, q);
  setRation(st, q.id, "short");
  check(fullOdds > shortOdds && shortOdds > starveOdds, `opinion 80: Full ${pct(fullOdds)}, Short ${pct(shortOdds)}, Starvation ${pct(starveOdds)}`);
  let yes = 0, no = 0, n = 0;
  for (let i = 0; i < 80; i++) {
    const x = prisonWorld(seed + 1200 + i, 1);
    x.list[0].opinion = 80;
    const odds = askOdds(x.st, x.list[0]);
    const msg = askToJoin(x.st, x.list[0].id);
    n++;
    if (!x.st.prisoners.includes(x.list[0])) { if (x.st.cards.some((c) => c.recruit && c.recruit.source === "prisoner")) yes++; }
    else if (x.list[0].opinion === 80 + PRISON.ASK.fail && /not yet/.test(msg)) { no++; if (no === 1) check(/Give it until/.test(askToJoin(x.st, x.list[0].id)), `once every ${PRISON.ASK.gap} days`); }
    if (i === 0) console.log(`    ${msg} (${pct(odds)})`);
  }
  check(yes + no === n && yes > n * 0.2 && no > n * 0.1, `asked ${n} times at opinion 80 (about ${pct(shortOdds)}): ${yes} joined (a recruit card), ${no} said no (opinion ${PRISON.ASK.fail})`);
  // Execute.
  const inf0 = infamy(st);
  for (const s of ppl) s.mood = 60;
  const other = list[2];
  other.s.mood = 30;
  executePrisoner(st, q.id);
  check(near(infamy(st), inf0 + PRISON.EXECUTE.infamy), `execute: infamy ${inf0} → ${infamy(st)}`);
  check(near(ppl[0].mood, 60 + PRISON.EXECUTE.soft) && near(ppl[1].mood, 60 + PRISON.EXECUTE.mood), `a Former Medic ${ppl[0].mood - 60}, most ${ppl[1].mood - 60}`);
  check(h.prisonFear === day(st) + PRISON.EXECUTE.fearDays && near(other.s.mood, 30 + PRISON.EXECUTE.fearMood), `the others are cowed until day ${h.prisonFear} (mood ${other.s.mood})`);
  const cowed = escapeOdds(st, other);
  h.prisonFear = 0;
  check(near(cowed, escapeOdds(st, other) * PRISON.EXECUTE.fear), `cowed, they run less (${pct(cowed)} vs ${pct(escapeOdds(st, other))})`);
}

// ---------- 7. save and load ----------
{
  console.log("Save and load");
  const { st, h, list } = prisonWorld(seed + 10, 2);
  st.cards = [];
  setRation(st, list[0].id, "full");
  setTask(st, list[0].id, "build");
  list[0].labourDays = 12;
  delete list[1].ration; delete list[1].task; delete list[1].labourDays; delete list[1].asked; // as an old save has them
  const w = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const [a, b] = prisonersAt(w, h.id);
  check(a.ration === "full" && a.task === "build" && a.labourDays === 12, "rations, work and days of labour survive a save");
  check(rationOf(b) === "short" && taskOf(b) === "idle", "an old save's prisoner loads on Short rations, Idle");
  const f0 = hub(w).stock.food;
  noEscapes(() => { w.hour += 24; prisonersDaily(w); });
  check(f0 - hub(w).stock.food > 0 && Number.isFinite(b.s.health), "and the day runs on it");
}

// ---------- 8. the tab ----------
{
  console.log("The tab");
  const { st, h, list } = prisonWorld(seed + 11, 2);
  const ui = { baseMsg: "" };
  setTask(st, list[0].id, "farm");
  const html = prisonTab(st, h, ui);
  check(/data-action="pr-ration"/.test(html) && /data-action="pr-task"/.test(html) && /pr-ration-all/.test(html) && /pr-task-all/.test(html), "rations and work selects, one and all");
  check(/Escape risk today/.test(html) && /Food: <b>/.test(html) && /Labour: /.test(html), "the summary: food, labour, escape risk");
  check(/Ask to join \(\d+%\)/.test(html) && /Roughly \(\d+%\)/.test(html) && /infamy \+/.test(html), "the actions show their odds and costs");
  check(!/NaN|undefined/.test(html), "no NaN or undefined in the tab");
  PRISON_CHANGE["pr-ration"](st, ui, { dataset: { id: String(list[1].id) }, value: "starve" });
  check(rationOf(list[1]) === "starve" && /Starvation/.test(ui.baseMsg), `the select sets rations ("${ui.baseMsg}")`);
  PRISON_CHANGE["pr-task-all"](st, ui, { dataset: { base: String(h.id) }, value: "water" });
  check(list.every((p) => taskOf(p) === "water"), "work for all");
  PRISON_ACTIONS["pr-question"](st, ui, { id: String(list[0].id), method: "rough" });
  check(list[0].questioned === day(st), `rough questioning from the button ("${ui.baseMsg.slice(0, 60)}")`);
  check(Object.keys(TASKS).length === 6, `tasks: ${Object.values(TASKS).map((t) => t.name).join(", ")}`);
}

// ---------- 9. determinism ----------
{
  console.log("Determinism");
  const play = () => {
    const { st, h, list } = prisonWorld(seed + 12, 3, 1);
    guardOn(st, h);
    setTask(st, list[0].id, "farm"); setTask(st, list[1].id, "kitchen"); setRation(st, list[2].id, "starve");
    for (let d = 0; d < 20; d++) { h.stock.food = 300; h.stock.water = 300; day1(st); }
    return JSON.stringify((st.prisoners || []).map((p) => [p.name, p.s.health, p.s.mood, r2(p.opinion), p.labourDays])) + JSON.stringify(h.stock);
  };
  check(play() === play(), "the same seed plays the same 20 days");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
