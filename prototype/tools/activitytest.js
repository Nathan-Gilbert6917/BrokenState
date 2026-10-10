// What people are doing and how the base's work is getting on (src/sim/activity.js, src/sim/output.js,
// src/ui/activity.js, the People tab and the base's Overview in src/ui/ui.js).
// Usage: node tools/activitytest.js [seed] (default 42).
// - Someone put on Cut wood (Manual) at the hub: "Chopping wood" by day, "Done chopping" after dark, "Asleep" at
//   night; a day ticks and the job's output counter shows the firewood that came in (and matches the store).
// - The Work now panel: the row, its progress bar toward midnight, the winter target, the last output line.
// - Why a job brings in nothing: the land cut bare, no hunting cabin, nothing to build.
// - Health, the walls, away on a team; people on work priorities (sleep, idle).
// - The People tab (cards and compact rows) and the base Overview show it; the find box finds "chopping".
// - Saves: base.output survives a save and load; an older save without it reads as nothing recorded.
import { createWorld, tickHour, hub, atBase, hourOfDay, day } from "../src/sim/world.js";
import { describeActivity, baseWork, lastOutput, amountText } from "../src/sim/activity.js";
import { noteOutput, outputDays, workDay } from "../src/sim/output.js";
import * as Wd from "../src/sim/woodcutting.js";
import { newItem } from "../src/sim/inventory.js";
import { launchExpedition } from "../src/sim/parties.js";
import { workState, assignRole } from "../src/sim/work.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { renderLeft, renderModal } from "../src/ui/ui.js";
import { workNowPanel, activityChip } from "../src/ui/activity.js";
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
check(a.kind === "work" && /Chopping wood/.test(a.text) && a.job === "wood", `10:00: chopping wood (${a.text})`);
check(/fire axe/.test(a.text), "with the armory's fire axe");
let rows = baseWork(state, base);
let row = rows.find((r) => r.job === "wood");
check(row && row.people.some((x) => x.s === cutter) && row.now >= 1, "the Work now panel has a Cut wood row with them working now");
check(row && row.progress && row.progress.frac > 0 && row.progress.frac < 1 && /firewood/.test(row.progress.text), `progress toward midnight: ${row && row.progress && Math.round(row.progress.frac * 100)}% (${row && row.progress && row.progress.text})`);
check(row && row.goal && /Winter store/.test(row.goal.text), `the winter target (${row && row.goal ? row.goal.text : "none"})`);
check(row && row.last.length === 0, "nothing recorded yet before the first midnight");
tickTo(state, 20);
a = describeActivity(state, cutter);
check(a.kind === "off" && /Done chopping/.test(a.text), `20:00: done for the day (${a.text})`);
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
  check(hx.kind === "stalled" && /hunting cabin/.test(hx.text), `no hunting cabin: "${hx.text}"`);
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
  for (let d = 0; d < 6; d++) { back.hour += 24; noteOutput(back, bb, "farm", 1, "food"); }
  check(outputDays(bb, "farm").length === 3, "only the last 3 days are kept a job");
}

console.log(`\n${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
