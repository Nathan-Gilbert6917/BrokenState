// What people are doing and how the base's work is getting on (src/sim/activity.js, src/sim/output.js,
// src/ui/activity.js, the People tab and the base's Overview in src/ui/ui.js).
// Usage: node tools/activitytest.js [seed] (default 42).
// - Someone put on Cut wood (Manual) at the hub: "Chopping wood" by day, "Done chopping" after dark, "Asleep" at
//   night; a day ticks and the job's output counter shows the firewood that came in (and matches the store).
// - The Work now panel: the row, its progress bar toward midnight, the winter target, the last output line.
// - Why a job brings in nothing: the land cut bare, nothing to build (hunting needs no cabin: the tiles next to the base).
// - Health, the walls, away on a team; people on work priorities (sleep, idle).
// - The People tab (cards and compact rows) and the base Overview show it; the find box finds "chopping".
// - Saves: base.output survives a save and load; an older save without it reads as nothing recorded; 7 days kept.
// - Mealtimes: breakfast 06:00 (hunters 08:00) and dinner 20:00 show as Eating, outside the daily jobs' hours; asking
//   what everyone does changes nothing (a day's output with and without looking is the same).
// - The Idle list (by the job, not the clock), the People tab's Idle filter and badge, the Bases card's N of M
//   working, the stalled-job alert after 2 days (gone when the job can work again).
// - Teaching, reading and the medic's healing are counted a day; their rows get bars; the 7-day sparkline.
// - Assign all idle (idlework.js planIdle: what the base needs, a job they can do there; the preview, the jobs), the
//   Bases tab's Idle drop-downs; the governor and a base leader move people off a job stalled since a day (07:00, a
//   log line, held for the day against the hourly plan).
// - Meals cost the all-day jobs an hour each: construction and crafting work 22 of 24 hours.
import { createWorld, tickHour, hub, atBase, hourOfDay, day } from "../src/sim/world.js";
import { describeActivity, baseWork, lastOutput, amountText, idlePeople, workCount, stalledJobs, outputSeries, workingActivity, mealAt, STALL_ALERT_DAYS } from "../src/sim/activity.js";
import { noteOutput, outputDays, workDay } from "../src/sim/output.js";
import * as Wd from "../src/sim/woodcutting.js";
import * as JC from "../src/sim/activity.js";
import { newItem } from "../src/sim/inventory.js";
import { launchExpedition } from "../src/sim/parties.js";
import { workState, assignRole } from "../src/sim/work.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { renderLeft, renderModal } from "../src/ui/ui.js";
import { workNowPanel, activityChip, togglePeopleIdle, peopleIdleOn, workChip } from "../src/ui/activity.js";
import { computeAlerts } from "../src/ui/alerts.js";
import { planIdle, applyIdlePlan, leaderIdleHour, baseNeeds, IDLE_HOUR } from "../src/sim/idlework.js";
import { assignIdlePreview } from "../src/ui/activity.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { setSteward } from "../src/sim/steward.js";
import { buildRate } from "../src/sim/buildings.js";
import { MEAL_WORK_SHARE, isMealHour } from "../src/sim/meals.js";
import { SCAV_FLOOR } from "../src/sim/economy.js";
import { setPeopleCompact } from "../src/ui/panelfold.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);
const note = (s) => console.log(`  ${s}`);
const BAD = /\b(undefined|NaN)\b|\[object [A-Za-z]+\]/;

function mk(seed) {
  const state = createWorld({ seed, factionCount: 6 });
  state.started = true;
  state.autoCombat = true;
  state.visitorsOff = true;
  Object.assign(hub(state).stock, { food: 400, water: 400, fuel: 100, meds: 20, scrap: 100, wood: 0 });
  return state;
}
// A world whose hub has trees around it (the Cut wood job can work there).
function woodWorld() {
  for (let seed = SEED; seed < SEED + 40; seed++) {
    const st = mk(seed);
    if (!Wd.woodWorkWhy(st, hub(st))) return st;
  }
  throw new Error("no seed with trees around the hub");
}
const jobCheckOk = (st, b, p) => describeActivity.length >= 0 && JC.jobCheck(st, b, p.s, p.job, p.station).kind !== "stalled";
const tickTo = (state, h) => { let n = 0; while (hourOfDay(state) !== h && n++ < 48) tickHour(state); };
const freshUi = (extra = {}) => ({ started: true, speed: 0, tab: "people", selected: -1, survivor: null, baseView: null, expedition: null, diary: null, roster: null, help: false, ...extra });

// ======================================================================
section("Cut wood: the activity by the hour, and a day's firewood in the output counter");
const state = woodWorld();
const base = hub(state);
const people = atBase(state, base.id);
const cutter = people[0];
cutter.role = "wood"; cutter.station = null; cutter.pinned = true; // Manual and pinned: nothing moves them off it
cutter.health = 100; cutter.inBed = false; cutter.conditions = [];
base.armory.push(newItem("fireaxe"));
tickTo(state, 10);
let a = describeActivity(state, cutter);
note(`${cutter.name} at 10:00: ${a.icon} ${a.text} (${a.kind})`);
check(a.kind === "work" && /Chopping wood|Felling|Splitting|Heading to/.test(a.text) && a.job === "wood", `10:00: out cutting wood (${a.text})`);
check(/fire axe/.test(a.why), `with the armory's fire axe (${a.why})`);
let rows = baseWork(state, base);
let row = rows.find((r) => r.job === "wood");
check(row && row.people.some((x) => x.s === cutter) && row.now >= 1, "the Work now panel has a Cut wood row with them working now");
check(row && row.progress && row.progress.frac >= 0 && row.progress.frac < 1 && /firewood/.test(row.progress.text), `the day's progress: ${row && row.progress && Math.round(row.progress.frac * 100)}% (${row && row.progress && row.progress.text})`);
check(row && row.goal && /Winter store/.test(row.goal.text), `the winter target (${row && row.goal ? row.goal.text : "none"})`);
check(row && row.last.length === 0, "nothing recorded yet before the first load comes home");
tickTo(state, 15); // the morning's trip is home (jobtrips.js): its load is in
row = baseWork(state, base).find((r) => r.job === "wood");
check(row && row.progress && row.progress.frac > 0 && /firewood \(.*in today/.test(row.progress.text), `after the morning trip: ${row && row.progress && Math.round(row.progress.frac * 100)}% (${row && row.progress && row.progress.text})`);
tickTo(state, 20);
a = describeActivity(state, cutter);
check(a.kind === "eat" && a.text === "Eating dinner", `20:00: dinner (${a.text})`);
tickTo(state, 21);
a = describeActivity(state, cutter);
check(a.kind === "off" && /Done chopping/.test(a.text), `21:00: done for the day (${a.text})`);
tickTo(state, 23);
a = describeActivity(state, cutter);
check(a.kind === "sleep" && a.text === "Asleep", `23:00: asleep (${a.text})`);
const w0 = base.stock.wood || 0;
const dayWorked = day(state);
tickTo(state, 1); // through midnight: woodDaily
const got = (base.stock.wood || 0) - w0;
const days = outputDays(base, "wood");
note(`midnight: the store went up by ${Math.round(got)} firewood (heating may burn some); output counter ${JSON.stringify(days)}`);
check(days.length === 1 && days[0].day === dayWorked && days[0].by.wood > 0, `the counter has day ${dayWorked}'s firewood (${days[0] && days[0].by.wood})`);
check(Math.abs(days[0].by.wood - base.woodToday) < 0.06, `the counter matches the day's cutting (${base.woodToday})`);
const last = lastOutput(state, base, "wood");
check(last[0] && last[0].when === "yesterday" && /\+\d+ firewood \([\d.]+ kg\)/.test(last[0].text), `last output: "${last[0] && last[0].text} ${last[0] && last[0].when}"`);
check(workDay(24) === 1 && workDay(25) === 2 && workDay(23) === 1, "the midnight tick counts for the day before it");
tickTo(state, 6);
check(describeActivity(state, cutter).text === "Eating breakfast", `06:00: breakfast (${describeActivity(state, cutter).text})`);
check(mealAt("hunt", 6) === null && mealAt("hunt", 8) === "breakfast" && mealAt("wood", 6) === "breakfast" && mealAt("farm", 20) === "dinner", "hunters and fishers eat after the dawn hunt (08:00); everyone dines at 20:00");
// Meals are outside the jobs' hours: the daily jobs' sampled hours (wood 08–18, forage 09–19, hunt/fish 06, 07, 17).
check([8, 10, 12, 14, 16, 18].every((h) => !mealAt("wood", h)) && [9, 11, 13, 15, 17, 19].every((h) => !mealAt("forage", h)) && [6, 7, 17].every((h) => !mealAt("hunt", h)), "no meal falls on a daily job's working hours");
row = baseWork(state, base).find((r) => r.job === "wood");
check(row && row.last[0] && !row.last[0].zero, "the panel's last line shows it");

// ======================================================================
section("Why a job brings in nothing");
{
  const st = woodWorld();
  const b = hub(st);
  const s = atBase(st, b.id)[0];
  s.role = "wood"; s.pinned = true; s.inBed = false; s.conditions = []; s.health = 100;
  tickTo(st, 10);
  for (const t of Wd.baseWoodTiles(st, b)) Wd.takeWood(st, t.id, Wd.WOOD.deplete * 10);
  const x = describeActivity(st, s);
  check(x.kind === "stalled" && /Can't cut wood/.test(x.text) && /cut bare/.test(x.text), `the land cut bare: "${x.text}"`);
  const r = baseWork(st, b).find((q) => q.job === "wood");
  check(r && r.why && /cut bare/.test(r.why) && !r.progress, `the panel says why (${r && r.why})`);
  s.role = "hunt";
  const hx = describeActivity(st, s);
  check(!/no hunting cabin/.test(hx.text) && (hx.kind !== "stalled" || /game land/.test(hx.text)), `no cabin needed to hunt (the tiles next to the base): "${hx.text}"`); // the rule changed 2026-10-10: it was "no hunting cabin"
  s.role = "build"; b.construction = []; b.repairs = [];
  const bx = describeActivity(st, s);
  check(bx.kind === "stalled" && /nothing to build/.test(bx.text), `nothing queued: "${bx.text}"`);
  s.role = "farm";
  check(/crops|Farmer/.test(describeActivity(st, s).text), `farming: "${describeActivity(st, s).text}"`);
}

// ======================================================================
section("Health, the walls, away on a team, work priorities");
{
  const st = woodWorld();
  const b = hub(st);
  const ppl = atBase(st, b.id);
  tickTo(st, 10);
  const [p1, p2, p3, p4] = ppl;
  p1.inBed = true; p1.health = 30;
  check(/hospital bed/.test(describeActivity(st, p1).text) && describeActivity(st, p1).kind === "hurt", `in bed: "${describeActivity(st, p1).text}"`);
  p1.inBed = false; p1.health = 100;
  p2.role = "guard"; p2.pinned = true;
  check(describeActivity(st, p2).kind === "guard", `a guard: "${describeActivity(st, p2).text}"`);
  b.alert = true;
  check(/Manning the walls/.test(describeActivity(st, p2).text), `on alert: "${describeActivity(st, p2).text}"`);
  b.alert = false;
  const p = launchExpedition(st, { memberIds: [p3.id], dest: st.grid.neighbors(b.tile)[0], mission: "move", stance: "normal", supplies: { food: 4, water: 4 } });
  const ax = describeActivity(st, p3);
  check(p && ax.kind === "away" && /^Away(:| with) .*team/.test(ax.text), `on a team: "${ax.text}"`);
  // Work priorities: a Generalist; the hour's plan decides.
  workState(st);
  const gen = st.work.roles.find((r) => r.name === "Generalist");
  assignRole(st, p4, gen.id);
  p4.pinned = false;
  tickHour(st);
  const g = describeActivity(st, p4);
  note(`${p4.name} on Generalist at ${hourOfDay(st)}:00: ${g.text} (${g.kind}) — ${g.why.slice(0, 120)}`);
  check(g.text && !BAD.test(g.text) && g.kind !== "away", "a person on priorities gets a plain activity");
  tickTo(st, 23);
  check(describeActivity(st, p4).kind === "sleep", `on priorities at 23:00: "${describeActivity(st, p4).text}"`);
  for (const s of ppl) check(!BAD.test(JSON.stringify(describeActivity(st, s))), `no undefined/NaN for ${s.name}`);
}

// ======================================================================
section("The People tab and the base Overview");
{
  const html = renderLeft(state, freshUi());
  check(/class="act act-/.test(html) && html.includes("act-line"), "People tab cards carry the activity chip");
  check(!BAD.test(html), "People tab: no undefined/NaN");
  setPeopleCompact(true);
  const compact = renderLeft(state, freshUi());
  setPeopleCompact(false);
  check(/prow-stack/.test(compact) && /act act-[a-z]+ act-short/.test(compact), "the compact People tab carries the short chip");
  const chip = activityChip(state, cutter, { short: true });
  check(/act-short/.test(chip) && /data-tip=/.test(chip), "the compact chip has its tooltip");
  const ov = renderModal(state, freshUi({ baseView: { id: base.id, tab: "overview" } }));
  check(/Work now/.test(ov) && /wn-wood/.test(ov) && /firewood/.test(ov), "the base Overview shows the Work now panel with Cut wood");
  check(!BAD.test(ov), "Overview: no undefined/NaN");
  check(/yesterday/.test(workNowPanel(state, base)), "the panel shows yesterday's firewood");
  note(workNowPanel(state, base).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 400));
}

// ======================================================================
section("Saves: the output counter survives; an old save has none");
{
  const text = saveToString(state);
  const back = loadFromString(text);
  const bb = back.bases.find((b) => b.id === base.id);
  check(JSON.stringify(outputDays(bb, "wood")) === JSON.stringify(outputDays(base, "wood")), "base.output saved and loaded");
  delete bb.output;
  check(outputDays(bb, "wood").length === 0 && baseWork(back, bb).every((r) => Array.isArray(r.last)), "an older save without it: nothing recorded, no errors");
  noteOutput(back, bb, "wood", 5, "wood");
  noteOutput(back, bb, "wood", 2.5, "wood");
  check(outputDays(bb, "wood")[0].by.wood === 7.5 && amountText("wood", 140) === "140 firewood (14 kg)", "notes add up by day; firewood reads in kg");
  for (let d = 0; d < 10; d++) { back.hour += 24; noteOutput(back, bb, "farm", 1, "food"); }
  check(outputDays(bb, "farm").length === 7, "the last 7 days are kept a job");
  const ser = outputSeries(back, bb, "farm");
  check(ser.days.length === 7 && ser.days.filter((d) => d.rec).length >= 6 && ser.unit === "food", `the sparkline's series: 7 days of food (${ser.days.map((d) => d.n).join(", ")})`);
}

// ======================================================================
section("Asking what everyone does changes nothing");
{
  const run = (look) => {
    const st = woodWorld();
    const b = hub(st);
    const s = atBase(st, b.id)[0];
    s.role = "wood"; s.pinned = true;
    for (let i = 0; i < 72; i++) { tickHour(st); if (look) for (const p of atBase(st, b.id)) describeActivity(st, p); }
    return JSON.stringify([b.stock, b.output, st.rng.next()]); // the next roll: the same dice drawn
  };
  check(run(false) === run(true), "three days with and without asking what everyone does: the same stores, output and dice");
}

// ======================================================================
section("The Idle list, the People tab's Idle filter, the Bases chip, the stalled-job alert");
{
  const st = woodWorld();
  const b = hub(st);
  const ppl = atBase(st, b.id);
  const [w, r, sick] = ppl;
  for (const s of ppl) { s.pinned = true; s.role = "farm"; s.inBed = false; s.conditions = []; s.health = 100; }
  w.role = "wood"; r.role = "rest";
  sick.health = 20; sick.inBed = true;
  tickTo(st, 10);
  for (const t of Wd.baseWoodTiles(st, b)) Wd.takeWood(st, t.id, Wd.WOOD.deplete * 10);
  let idle = idlePeople(st, b);
  check(idle.some((x) => x.s === w && /cut bare/.test(x.why)), `the woodcutter on cut-bare land is idle (${idle.map((x) => `${x.s.name}: ${x.why}`).join("; ")})`);
  check(!idle.some((x) => x.s === r) && !idle.some((x) => x.s === sick), "resting and in bed are left out");
  tickTo(st, 23);
  check(describeActivity(st, w).kind === "sleep" && idlePeople(st, b).some((x) => x.s === w), "by the job, not the clock: still listed while asleep");
  check(workingActivity(st, w).kind === "stalled", "workingActivity: stalled");
  const c = workCount(st, b);
  check(c.total === ppl.length && c.idle >= 1 && c.hurt >= 1 && c.resting >= 1 && c.working + c.idle + c.hurt + c.resting === c.total, `N of M working: ${JSON.stringify(c)}`);
  check(/⚒ \d+\/\d+ working/.test(workChip(st, b)), "the Bases card chip");
  const bases = renderLeft(st, freshUi({ tab: "bases" }));
  check(/working/.test(bases) && !BAD.test(bases), "the Bases tab shows it");
  // The People tab's Idle filter and badge.
  check(!peopleIdleOn(), "the Idle filter starts off");
  let html = renderLeft(st, freshUi());
  check(/data-action="ppl-idle"/.test(html) && /idle-badge">\d+</.test(html), "the Idle button with its count");
  check(/No work: Can't cut wood/.test(html), "a card says why they have no work when the chip shows the hour (asleep)");
  togglePeopleIdle();
  html = renderLeft(st, freshUi());
  togglePeopleIdle();
  const names = ppl.filter((s) => html.includes(s.name)).map((s) => s.name);
  check(names.includes(w.name) && !names.includes(r.name) && !names.includes(sick.name), `the filter shows only the idle (${names.join(", ")})`);
  // The Work now panel: the Idle list on top with a role drop-down.
  const panel = workNowPanel(st, b);
  check(/idle-list/.test(panel) && panel.indexOf("idle-list") < panel.indexOf("wn-row") && new RegExp(`data-action="role" data-id="${w.id}"`).test(panel), "the Work now panel opens with the Idle list and a role drop-down");
  // Stalled for days: the alert, and gone when it can work again.
  tickTo(st, 1);
  check(b.stall && b.stall.wood != null, `the stall is noted (day ${b.stall && b.stall.wood})`);
  check(!computeAlerts(st, { all: true }).some((x) => x.kind === "stalled"), "no alert on the first day");
  for (let d = 0; d < STALL_ALERT_DAYS; d++) { for (let i = 0; i < 24; i++) tickHour(st); for (const t of Wd.baseWoodTiles(st, b)) Wd.takeWood(st, t.id, Wd.WOOD.deplete * 10); }
  const al = computeAlerts(st, { all: true }).filter((x) => x.kind === "stalled");
  check(al.length === 1 && al[0].key === `stall:${b.id}:wood` && /Cut wood stalled \d+ days/.test(al[0].text), `the alert: ${al[0] && al[0].text}`);
  check(stalledJobs(st).length === 1 && /days\)/.test(workNowPanel(st, b)), "the row says for how long");
  st.wood = {}; // the land grows back (for the test)
  check(!computeAlerts(st, { all: true }).some((x) => x.kind === "stalled"), "the job can work again: the alert is gone at once");
  for (let i = 0; i < 24; i++) tickHour(st);
  check(!b.stall || b.stall.wood == null, "and the stall is cleared at the next day");
}

// ======================================================================
section("Teaching, reading and the medic's healing: counted a day, with bars");
{
  const st = woodWorld();
  const b = hub(st);
  const ppl = atBase(st, b.id);
  for (const s of ppl) { s.pinned = true; s.role = "farm"; s.inBed = false; s.conditions = []; s.health = 100; }
  const [T, L, R, M, P] = ppl;
  T.skills.medicine = 12; L.skills.medicine = 2; T.role = "teach"; T.teach = { skill: "medicine", learners: [L.id] };
  R.role = "read"; R.skills.medicine = 1; b.armory.push(newItem("medbook"));
  M.role = "medic"; M.skills.medicine = 6; P.health = 55;
  tickTo(st, 12);
  const rows = baseWork(st, b);
  const tr = rows.find((x) => x.job === "teach"), mr = rows.find((x) => x.job === "medic");
  check(tr && tr.progress && /Medicine \d+→\d+/.test(tr.progress.text), `teach: ${tr && tr.progress && tr.progress.text}`);
  check(mr && mr.progress && /hurt or ill/.test(mr.progress.text) && mr.progress.frac > 0 && mr.progress.frac < 1, `medic: ${mr && mr.progress && mr.progress.text}`);
  for (let i = 0; i < 24; i++) tickHour(st);
  const lt = lastOutput(st, b, "teach")[0], lr = lastOutput(st, b, "read")[0], lm = lastOutput(st, b, "medic")[0];
  check(lt && /\+[\d.]+ XP/.test(lt.text), `teaching counted: ${lt && lt.text} ${lt && lt.when}`);
  check(lr && /hours read/.test(lr.text), `reading counted: ${lr && lr.text}`);
  check(lm && /health healed/.test(lm.text), `healing counted: ${lm && lm.text}`);
  const rr = baseWork(st, b).find((x) => x.job === "read");
  check(rr && rr.progress && /of \d+ h/.test(rr.progress.text), `read: ${rr && rr.progress && rr.progress.text}`);
  const html = workNowPanel(st, b);
  check(/wn-spark/.test(html) && /<polyline/.test(html) && !BAD.test(html), "the sparklines are drawn");
}

// ======================================================================
section("Assign all idle: what the base needs, a job they can do there");
{
  const st = woodWorld();
  const b = hub(st);
  const ppl = atBase(st, b.id);
  for (const s of ppl) { s.pinned = true; s.role = "farm"; s.inBed = false; s.conditions = []; s.health = 100; }
  const [x, y] = ppl;
  x.role = "scavenge"; x.pinned = false; b.scavLeft = SCAV_FLOOR; // the ruins picked clean: stalled (job trips: hunting needs no cabin now)
  y.role = "build"; y.pinned = false; b.construction = []; b.repairs = [];
  for (const f of (b.buildings || [])) if (f.wear) f.wear = 0;
  tickTo(st, 10);
  b.construction = [{ id: 777001, type: "bunkhouse", hours: 40, progress: 0 }];
  const needs = baseNeeds(st, b);
  check(needs.some((n) => n.job === "build"), `the base's needs: ${needs.map((n) => `${n.job} ${n.score}`).join(", ")}`);
  const plan = planIdle(st, b);
  note(`plan: ${plan.map((p) => `${p.s.name}: ${p.from} → ${p.job} (${p.why})`).join("; ")}`);
  check(plan.some((p) => p.s === x) && plan.every((p) => p.job !== p.from && p.why), "the stalled scavenger gets a job the base needs, with why");
  check(plan.every((p) => jobCheckOk(st, b, p)), "every job in the plan can run for them");
  const pv = assignIdlePreview(st, b);
  check(/→/.test(pv.text) && pv.plan.length === plan.length, `the preview: ${pv.text}`);
  const ov = renderModal(st, freshUi({ baseView: { id: b.id, tab: "overview" } }));
  check(/data-action="idle-assign"/.test(ov), "the Work now panel has Assign all idle");
  const bases = renderLeft(st, freshUi({ tab: "bases" }));
  check(/Idle colonists/.test(bases) && /data-fold="idle:/.test(bases) && /data-action="idle-assign"/.test(bases) && new RegExp(`data-action="role" data-id="${x.id}"`).test(bases), "the Bases tab: a drop-down per base with its idle, a role picker and Assign all");
  const msg = applyIdlePlan(st, b, plan);
  check(x.role === plan.find((p) => p.s === x).job && !idlePeople(st, b).some((q) => q.s === x), `assigned (${msg})`);
}

// ======================================================================
section("The governor and a base leader move people off a stalled job once a day");
for (const mode of ["governor", "leader"]) {
  const st = woodWorld();
  const b = hub(st);
  const ppl = atBase(st, b.id);
  for (const s of ppl) { s.inBed = false; s.conditions = []; s.health = 100; }
  if (mode === "governor") setAutopilot(st, true); else setSteward(st, b, true);
  const leaderId = b.steward && b.steward.leaderId;
  const x = ppl.find((s) => s.id !== leaderId);
  x.pinned = false; x.role = "scavenge"; x.station = null;
  b.scavLeft = SCAV_FLOOR; // the ruins around are picked clean: stalled
  b.construction = [{ id: 777002, type: "bunkhouse", hours: 400, progress: 0 }];
  const d = day(st);
  b.stall = { scavenge: d - 1 };
  st.hour = (d - 1) * 24 + IDLE_HOUR;
  leaderIdleHour(st);
  const lines = st.log.map((l) => l.text || l.msg || String(l)).filter((t) => /moved .* from Scavenge/.test(t));
  check(x.role !== "scavenge" && x.govIdle && lines.length === 1, `${mode}: moved off the stalled job: "${lines[0] || "none"}"`);
  const role = x.role;
  for (let i = 0; i < 6; i++) tickHour(st);
  check(x.role === role, `${mode}: held there against the hourly plan (${x.role})`);
  st.hour = (d) * 24 + IDLE_HOUR - 1;
  delete x.govIdle;
  leaderIdleHour(st);
  check(st.log.map((l) => l.text || l.msg || String(l)).filter((t) => /moved .* from Scavenge/.test(t)).length === 1, `${mode}: nothing at other hours`);
}
{
  const st = woodWorld();
  const b = hub(st);
  const x = atBase(st, b.id)[0];
  x.role = "scavenge"; b.scavLeft = SCAV_FLOOR; b.stall = { scavenge: day(st) - 1 };
  st.hour = (day(st) - 1) * 24 + IDLE_HOUR;
  leaderIdleHour(st);
  check(x.role === "scavenge" && !x.govIdle, "a base you run yourself: nobody is moved");
}

// ======================================================================
section("Meals cost the all-day jobs an hour each");
{
  const st = woodWorld();
  const b = hub(st);
  const ppl = atBase(st, b.id);
  for (const s of ppl) { s.pinned = true; s.role = "farm"; s.inBed = false; s.conditions = []; s.health = 100; }
  ppl[0].role = "build"; ppl[1].role = "build";
  b.construction = [{ id: 777003, type: "bunkhouse", hours: 1e6, progress: 0 }];
  const rate = buildRate(st, b);
  let expect = 0;
  for (let i = 0; i < 24; i++) { tickHour(st); }
  const got = b.construction[0].progress;
  check(isMealHour(6) && isMealHour(20) && !isMealHour(12) && Math.abs(MEAL_WORK_SHARE - 22 / 24) < 1e-9, "the meal hours: 06:00 and 20:00");
  check(Math.abs(got - rate * 22) < rate * 0.6, `a day of building: ${Math.round(got * 10) / 10} work-hours, 22 hours at ${Math.round(rate * 100) / 100} (${Math.round(rate * 24 * 10) / 10} without the meals)`);
  void expect;
}

console.log(`\n${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
