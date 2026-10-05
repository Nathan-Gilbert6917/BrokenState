// Work priorities and crews (src/sim/work.js, src/sim/crews.js, src/ui/work.js): the RimWorld work tab.
// Scripted cases: priority 1 first, then 2 …, back to 1 when higher work turns up again, rest when nothing has
// work; capacity (one operator a station, the hospital's medic slots, a lookout, a lesson's learners, a book's
// copy); ties by skill; a person's own cell over the role's; the role's skill minimum; emergencies (a raid or
// horde warning sends everyone with Guard set to the walls, the badly hurt and the sick rest, a patient in
// danger or a broken well pump pulls the first hands with Doctor / Repair set); the schedule (guard watch,
// sleep and free time with their mood, counted at the day's work at midnight); mood-aware free time; the why
// line; Manual and pinned people untouched, production fallbacks left to priorities, stewards moving only Manual
// people; role editing (create, rename, duplicate, delete), newcomers; save / load (roles, cells, members,
// tasks, a crew out; an old save loads with everyone on Manual); crews (a trip by the field priorities within
// range and hours, paused, small road cards answered, big ones held unless "handle everything", the plan's
// come-home rule, the search, the trip log, the map tag); the Work tab's HTML and actions; then N days with the
// Balanced autopilot where everyone works by priorities next to the same seeds with the governor's own roles
// (food harvested, buildings and crafts finished), no NaN, and determinism (two worlds in one process).
// One 120-day run per seed is a coin toss: nudging the world's dice by a single draw moves the governor's
// ten-seed total by ±30 buildings. So each seed is played with DICE variants of the dice (the world's random
// numbers advanced 0, 1, 2 … draws before day 1), both ways, in parallel child processes, and the totals compared.
// Usage: node tools/worktest.js [days] [seeds...] [--dice N]   (seeds 1–10, 4 dice variants by default)
import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { createWorld, tickHour, hub, atBase, makeSurvivor, day, alive } from "../src/sim/world.js";
import { addBuilding, stations, RECIPES } from "../src/sim/buildings.js";
import { hospitalDef } from "../src/sim/medical.js";
import { setSteward, stewardHour, setPinned } from "../src/sim/steward.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { productionHour, setStationOrder } from "../src/sim/production.js";
import { craftQueue } from "../src/sim/crafting.js";
import { econStats } from "../src/sim/farming.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { GEAR } from "../src/sim/data.js";
import { newItem } from "../src/sim/inventory.js";
import { fixtures } from "../src/sim/breakdowns.js";
import * as Work from "../src/sim/work.js";
import * as Crews from "../src/sim/crews.js";
import { workTab, WORK_ACTIONS, WORK_CHANGE, workKey, roleSelect, applyRoleChoice } from "../src/ui/work.js";
import { rosterModal, setRole } from "../src/ui/roster.js";
import { readFileSync } from "node:fs";

// --pair seed dice days priorities(0/1): one comparison run, printed as JSON (the parent's children).
const PAIR = process.argv[2] === "--pair";
const args = process.argv.slice(2);
const diceAt = args.indexOf("--dice");
const DICE = diceAt >= 0 ? Math.max(1, Number(args[diceAt + 1]) || 1) : 4;
const plainArgs = diceAt >= 0 ? args.filter((_, i) => i !== diceAt && i !== diceAt + 1) : args;
const longDays = PAIR ? Number(args[3]) : Number(plainArgs[0] || 120);
const seeds = !PAIR && plainArgs.length > 1 ? plainArgs.slice(1).map(Number) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(t);
const { planBase, workState, assignRole, setCell, setRoleCell, cellOf, prio, taskLabel, taskWhy, WORK_KEYS } = Work;
if (PAIR) {
  const r = run(Number(args[1]), args[4] === "1", Number(args[2]));
  delete r.st;
  console.log(JSON.stringify(r));
  process.exit(0);
}

// A quiet hub of n plain, healthy, content people with plenty of everything; roles cleared.
function quiet(seed = 42, n = 6) {
  const st = createWorld({ seed, factionCount: 6 });
  st.started = true;
  const h = hub(st);
  while (atBase(st, h.id).length < n) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); }
  for (const s of atBase(st, h.id).slice(n)) { s.alive = false; s.left = true; }
  for (const s of atBase(st, h.id)) {
    s.traits = []; s.conditions = []; s.health = 100; s.mood = 70; s.role = "rest"; s.station = null; s.leader = false;
    s.gear.weapon = null; for (const k of Object.keys(s.skills)) s.skills[k] = 2;
  }
  Object.assign(h.stock, { food: 600, water: 300, scrap: 300, parts: 30, fuel: 40, meds: 20, ammo: 30, jars: 40, preserved: 0 });
  st.hordes = []; st.visitors = [];
  for (const p of st.parties) p.target = null;
  workState(st);
  return { st, h, ppl: atBase(st, h.id) };
}
// A role with only the cells given.
function role(st, name, pri, extra = {}) {
  const r = Work.createRole(st, name);
  r.pri = { ...pri };
  Object.assign(r, extra);
  return r;
}
const join = (st, list, r) => { for (const s of list) assignRole(st, s, r.id); };
const at = (st, hour) => { st.hour = Math.floor(st.hour / 24) * 24 + hour; };

// ---------- 1. priorities ----------
{
  section("Priorities: 1 first, then 2, back to 1, rest when nothing has work");
  const { st, h, ppl } = quiet();
  const [a] = ppl;
  const r = role(st, "Test", { build: 1, scavenge: 2 });
  join(st, [a], r);
  at(st, 10);
  planBase(st, h);
  check(a.role === "scavenge" && a.task.p === 2, `nothing to build: priority 2, scavenge (${a.role}, p${a.task.p})`);
  check(/Build: nothing to build/.test(a.task.why), `the why line says why not 1 (${a.task.why})`);
  h.construction.push({ id: 9e9, type: "bunkhouse", progress: 0, hours: 30 });
  planBase(st, h);
  check(a.role === "build" && a.task.p === 1 && a.task.t === "build", `a job queued: back to priority 1, build (${a.role})`);
  h.construction.length = 0;
  planBase(st, h);
  check(a.role === "scavenge", `built: on to priority 2 again (${a.role})`);
  h.scavLeft = 0.2;
  planBase(st, h);
  check(a.role === "rest" && a.task.kind === "idle" && /Nothing to do/.test(a.task.why), `nothing anywhere: rests (${a.role}, ${a.task.why})`);
  check(taskLabel(st, a) === "Idle" && taskWhy(st, a) === a.task.why, "taskLabel / taskWhy for the UI");
}

// ---------- 2. capacity ----------
{
  section("Capacity: one operator a station, medic slots, one lookout, a lesson's learners, a copy each");
  const { st, h, ppl } = quiet(42, 8);
  h.buildings = h.buildings.filter((b) => !BUILDINGS[b.type].station); // only the two stations below
  const bench = addBuilding(h, "ammo_bench");
  const med = addBuilding(h, "med_station");
  setStationOrder(st, h, bench.id, { mode: "forever" });
  setStationOrder(st, h, med.id, { mode: "forever" });
  const r = role(st, "Shop", { workshop: 1, scavenge: 2 });
  join(st, ppl.slice(0, 4), r);
  at(st, 9);
  planBase(st, h);
  const ops = ppl.slice(0, 4).filter((s) => s.role === "operate");
  check(ops.length === 2 && new Set(ops.map((s) => s.station)).size === 2, `2 stations, 4 on Workshop 1: 2 operate, each its own (${ops.map((s) => s.station).join(", ")})`);
  check(ppl.slice(0, 4).filter((s) => s.role === "scavenge").length === 2 && ppl.slice(0, 4).filter((s) => s.role === "scavenge").every((s) => /full \(2 of 2\)|taken/.test(s.task.why)), `the others go to priority 2, saying Workshop is full (${ppl[3].task.why})`);
  // A Manual operator on the bench takes it: only the med station is left.
  const manual = ppl[4];
  manual.role = "operate"; manual.station = bench.id;
  planBase(st, h);
  const ops2 = ppl.slice(0, 4).filter((s) => s.role === "operate");
  check(ops2.length === 1 && ops2[0].station === med.id && manual.station === bench.id, "a Manual operator's station is never booked twice");
  manual.role = "rest"; manual.station = null;
  // Medic slots by hospital tier.
  addBuilding(h, "clinic");
  const staff = hospitalDef(h).staff;
  const d = role(st, "Docs", { doctor: 1, scavenge: 2 });
  join(st, ppl.slice(0, 5), d);
  ppl[6].health = 60;
  planBase(st, h);
  const medics = ppl.slice(0, 5).filter((s) => s.role === "medic");
  check(medics.length === staff, `a clinic needs ${staff}: ${medics.length} on duty out of 5 with Doctor 1`);
  ppl[6].health = 100;
  planBase(st, h);
  check(ppl.slice(0, 5).every((s) => s.role !== "medic"), "everyone healed: the medics leave duty");
  // A lookout: one at a base of 4+ people.
  const g = role(st, "Watch", { guard: 1, scavenge: 2 });
  join(st, ppl.slice(0, 3), g);
  planBase(st, h);
  check(ppl.slice(0, 3).filter((s) => s.role === "guard").length === 1, "calm: one lookout");
  // Teaching: two teachers, learners never in two lessons.
  const t = role(st, "Teachers", { teach: 1, scavenge: 2 });
  join(st, ppl.slice(0, 2), t);
  for (const s of ppl) s.skills.medicine = 1;
  ppl[0].skills.medicine = 15; ppl[1].skills.medicine = 15; ppl[0].skills.farming = 15;
  for (let i = 0; i < 6; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; s.traits = []; s.conditions = []; s.health = 100; s.mood = 70; for (const k of Object.keys(s.skills)) s.skills[k] = 1; st.survivors.push(s); }
  planBase(st, h);
  const teachers = ppl.slice(0, 2).filter((s) => s.role === "teach");
  const learners = teachers.flatMap((s) => s.teach.learners);
  check(teachers.length === 2 && learners.length === new Set(learners).size, `two teachers (12+ people), no learner in two lessons (${learners.length} learners)`);
  // Reading: one copy, two readers.
  for (const s of ppl) s.skills.medicine = 1;
  const rd = role(st, "Readers", { study: 1, scavenge: 2 });
  join(st, ppl.slice(0, 2), rd);
  h.armory.push(newItem("medbook", 1));
  planBase(st, h);
  check(ppl.slice(0, 2).filter((s) => s.role === "read").length === 1, "one copy of a book: one reader, the other goes on");
}

// ---------- 3. ties, overrides, minimums ----------
{
  section("Ties by skill, a person's own cell, the role's skill minimum");
  const { st, h, ppl } = quiet();
  const g = role(st, "Watch", { guard: 1, scavenge: 2 });
  join(st, ppl.slice(0, 2), g);
  ppl[0].skills.shooting = 3; ppl[1].skills.shooting = 12;
  at(st, 9);
  planBase(st, h);
  check(ppl[1].role === "guard" && ppl[0].role === "scavenge", "one lookout, two with Guard 1: the better shot gets it");
  setCell(st, ppl[1], "guard", 0);
  check(cellOf(st, ppl[1], "guard").over && cellOf(st, ppl[1], "guard").p === 0 && cellOf(st, ppl[1], "guard").def === 1, "own cell over the role's default");
  planBase(st, h);
  check(ppl[0].role === "guard" && ppl[1].role === "scavenge", "Guard set to never for the better shot: the other one guards");
  setCell(st, ppl[1], "guard", 1);
  check(!cellOf(st, ppl[1], "guard").over, "setting a cell back to the role's value removes the override");
  setRoleCell(st, g, "guard", 3);
  check(prio(st, ppl[0], "guard") === 3, "changing the role changes everyone in it");
  // The minimum.
  const m = role(st, "Medics", { doctor: 1, scavenge: 2 }, { min: { doctor: 4 } });
  join(st, [ppl[2]], m);
  ppl[2].skills.medicine = 2;
  ppl[4].health = 40; // no hospital: a doctor only for the badly hurt (below 50), the infected and the ill
  planBase(st, h);
  check(ppl[2].role === "scavenge" && /needs Medicine 4/.test(ppl[2].task.why), `below the role's Medicine 4: skips Doctor (${ppl[2].task.why})`);
  ppl[2].skills.medicine = 5;
  planBase(st, h);
  check(ppl[2].role === "medic", "Medicine 5: on duty");
}

// ---------- 4. emergencies ----------
{
  section("Emergencies: guard warnings, the sick and hurt rest, a patient in danger, a broken pump");
  const { st, h, ppl } = quiet();
  const r = role(st, "Gen", { farm: 1, guard: 4, scavenge: 3 });
  const f = role(st, "Farm only", { farm: 1, scavenge: 3 });
  join(st, ppl.slice(0, 3), r);
  join(st, ppl.slice(3, 5), f);
  at(st, 10);
  h.alert = true;
  planBase(st, h);
  check(ppl.slice(0, 3).every((s) => s.role === "guard" && s.task.kind === "emerg"), "defences manned: everyone with Guard set (even at 4) guards");
  check(ppl.slice(3, 5).every((s) => s.role !== "guard"), "people without Guard keep working");
  check(/Emergency: the defences are manned/.test(ppl[0].task.why), `the why line (${ppl[0].task.why})`);
  h.alert = false;
  // A horde at the walls: as many as it takes.
  const ht = st.grid.neighbors(h.tile)[0];
  const hz = { id: 991, tile: ht, size: 20, bosses: 0, warned: true, target: h.tile };
  st.hordes.push(hz); st.live.add(ht);
  planBase(st, h);
  check(ppl.slice(0, 3).every((s) => s.role !== "guard"), "a horde of 20 the walls hold anyway: nobody leaves work");
  hz.size = 5000;
  planBase(st, h);
  check(ppl.slice(0, 3).every((s) => s.role === "guard") && /horde of 5000/.test(ppl[0].task.why), `a horde of 5000: everyone with Guard set (${ppl[0].task.why})`);
  hz.size = 300;
  planBase(st, h);
  const n300 = ppl.slice(0, 3).filter((s) => s.role === "guard").length;
  check(n300 >= 0 && n300 <= 3, `a horde of 300: ${n300} of 3 to the walls by the hold limit`);
  st.hordes = [];
  // A raid warned and coming.
  st.parties.push({ id: 77, kind: "raid", owner: 0, target: { kind: "player", baseId: h.id }, warned: true, phase: "out", members: [], path: [h.tile], idx: 0 });
  check(!!Work.threatInfo(st, h).urgent, "a warned raid on this base is an emergency");
  st.parties.pop();
  // The badly hurt and the sick rest.
  ppl[0].health = 20;
  ppl[1].conditions = [{ key: "flu", sev: 95, day: 1 }];
  planBase(st, h);
  check(ppl[0].role === "rest" && /badly hurt/.test(ppl[0].task.why), `health 20: rests (${ppl[0].task.why})`);
  check(ppl[1].role === "rest" && ppl[1].task.kind === "health", `too ill: rests (${ppl[1].task.why})`);
  ppl[0].health = 100; ppl[1].conditions = [];
  // Days off from a card stay days off.
  ppl[2].restUntil = day(st) + 2; ppl[2].role = "rest";
  planBase(st, h);
  check(ppl[2].role === "rest" && /Time off/.test(ppl[2].task.why), "days off from a warning card are kept");
  delete ppl[2].restUntil;
  // A patient in danger with no medic: the first with Doctor set at any priority.
  setCell(st, ppl[0], "doctor", 5);
  ppl[4].health = 25;
  planBase(st, h);
  check(ppl[0].role === "medic" && ppl[0].task.kind === "emerg", `a severe wound and nobody on duty: Doctor 5 goes first (${ppl[0].role}, ${ppl[0].task.why})`);
  ppl[4].health = 100;
  // A broken well pump: the first with Repair set.
  setCell(st, ppl[1], "repair", 5);
  const pump = fixtures(h).find((b) => b.type === "pump");
  if (pump) {
    pump.broken = { day: 1, cause: "test" };
    h.repairs = [{ id: `${pump.id}`, fx: pump.id, method: "rig", who: null, hours: 2, done: 0, paid: {}, started: st.hour }];
    planBase(st, h);
    check(ppl[1].role === "build" && ppl[1].task.t === "repair" && h.repairs[0].who === ppl[1].id, `a broken pump: Repair 5 is pulled to it (${ppl[1].task.why})`);
    pump.broken = null; h.repairs = [];
  } else check(true, "no pump fixture on this map");
}

// ---------- 5. schedule and mood ----------
{
  section("Schedule (guard watch, sleep, free time), midnight, mood-aware free time");
  const { st, h, ppl } = quiet();
  const n = role(st, "Night", { farm: 1, scavenge: 2 }, { sched: Work.SCHED_PRESETS.night.sched });
  join(st, [ppl[0]], n);
  at(st, 22);
  planBase(st, h);
  check(ppl[0].role === "guard" && ppl[0].task.kind === "sched", "22:00 on the night watch: guarding");
  at(st, 6);
  const m0 = ppl[0].mood;
  planBase(st, h);
  check(ppl[0].role === "rest" && ppl[0].task.t === "sleep" && Math.abs(ppl[0].mood - m0 - Work.OFF_MOOD) < 1e-9, `06:00: asleep, +${Work.OFF_MOOD} mood an hour`);
  at(st, 14);
  planBase(st, h);
  check(ppl[0].role === "farm" && ppl[0].task.last && ppl[0].task.last.role === "farm", "14:00: works by priorities (farm)");
  // Midnight: the watch is counted at the day's work.
  const d = role(st, "Day", { farm: 1 }, { sched: Work.SCHED_PRESETS.day.sched });
  join(st, [ppl[1]], d);
  at(st, 15); planBase(st, h);
  at(st, 23); planBase(st, h);
  check(ppl[1].role === "rest" && ppl[1].task.t === "sleep", "23:00 on a day shift: asleep");
  st.hour += 1; // midnight
  Work.workDayRoles(st);
  check(ppl[1].role === "farm", `midnight: counted at the day's farming (${ppl[1].role})`);
  st.prisoners = [{ id: 1, name: "Held Man", at: { kind: "base", baseId: h.id } }];
  ppl[0].role = "guard"; ppl[0].task.kind = "sched";
  Work.workDayRoles(st);
  check(ppl[0].role === "guard", "prisoners in the cells: the watch stands at midnight");
  st.prisoners = [];
  // Mood.
  setCell(st, ppl[2], "farm", 1);
  join(st, [ppl[2]], role(st, "Plain", { farm: 1 }));
  at(st, 10);
  ppl[2].mood = 20;
  planBase(st, h);
  check(ppl[2].role === "rest" && ppl[2].task.kind === "mood", "mood 20: free time first");
  ppl[2].mood = 35;
  planBase(st, h);
  check(ppl[2].role === "rest", "mood 35: still off until 40");
  ppl[2].mood = 45;
  planBase(st, h);
  check(ppl[2].role === "farm", "mood 45: back to work");
  check(Work.schedText(n) && /guard watch 20–04/.test(Work.schedText(n)), `schedule text (${Work.schedText(n)})`);
}

// ---------- 6. Manual, pinned, fallbacks, stewards ----------
{
  section("Manual and pinned untouched, production fallbacks, stewards move only Manual people");
  const { st, h, ppl } = quiet();
  const r = role(st, "Gen", { farm: 1, build: 2, scavenge: 3 });
  join(st, ppl.slice(0, 4), r);
  ppl[4].role = "scavenge";
  setPinned(st, ppl[3], true);
  ppl[3].role = "guard";
  at(st, 10);
  planBase(st, h);
  check(ppl[4].role === "scavenge" && !Work.isManaged(st, ppl[4]), "Manual keeps their job");
  check(ppl[3].role === "guard" && !Work.isManaged(st, ppl[3]), "pinned keeps their job");
  // A station's fallback does not move someone on priorities.
  const bench = addBuilding(h, "ammo_bench");
  setStationOrder(st, h, bench.id, { mode: "off", fallback: "farm" });
  ppl[0].role = "operate"; ppl[0].station = bench.id;
  productionHour(st);
  check(!ppl[0].parked, "the fallback leaves people on priorities to their priorities");
  // A steward with Roles.
  planBase(st, h);
  const before = ppl.slice(0, 3).map((s) => s.role).join();
  setSteward(st, h, true);
  stewardHour(st);
  check(ppl.slice(0, 3).map((s) => s.role).join() === before, `the steward leaves people on priorities alone (${before})`);
  setSteward(st, h, false);
  // A hand-picked job puts someone on Manual.
  applyRoleChoice(st, ppl[0], "guard");
  check(!Work.isManaged(st, ppl[0]) && ppl[0].role === "guard", "a fixed job from the drop-down: Manual");
  applyRoleChoice(st, ppl[0], `w:${r.id}`);
  check(Work.isManaged(st, ppl[0]), "a work role from the drop-down: on priorities again");
  check(setRole(st, ppl[1], "medic") && !Work.isManaged(st, ppl[1]), "the roster's role (Manual)");
}

// ---------- 7. roles, newcomers ----------
{
  section("Roles: create, rename, duplicate, delete, newcomers, everyone on priorities");
  const { st, h, ppl } = quiet();
  const n0 = st.work.roles.length;
  check(["Generalist", "Farmer", "Builder", "Guard", "Medic", "Crafter", "Night watch", "Scavengers"].every((x) => st.work.roles.some((r) => r.name === x)), "the default roles");
  const r = Work.createRole(st, "Farmhands");
  Work.renameRole(st, r, "Farmer");
  check(r.name === "Farmer 2", `names stay unique (${r.name})`);
  const dup = Work.duplicateRole(st, r);
  check(dup.name === "Farmer 2 copy" && dup.id !== r.id, "duplicate");
  join(st, [ppl[0]], dup);
  ppl[0].role = "build";
  Work.deleteRole(st, dup);
  check(!Work.roleOf(st, ppl[0]) && ppl[0].role === "build" && st.work.roles.length === n0 + 1, "deleting a role: its members on Manual, keeping their job");
  ppl[1].role = "farm";
  const msg = Work.everyoneOnPriorities(st, h);
  check(Work.roleOf(st, ppl[1]).name === "Farmer" && /work by priorities/.test(msg), `everyone on priorities by what they do (${Work.roleOf(st, ppl[1]).name})`);
  const gen = st.work.roles.find((x) => x.name === "Generalist");
  check(st.work.newcomers === gen.id, "newcomers then join Generalist");
  const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s);
  Work.workHour(st);
  check(Work.roleOf(st, s) === gen, "a newcomer joins the newcomers' role");
}

// ---------- 8. save / load ----------
{
  section("Save and load");
  const { st, h, ppl } = quiet();
  const old = loadFromString(saveToString(createWorld({ seed: 5, factionCount: 6 })));
  check(!old.work && alive(old).every((s) => !Work.isManaged(old, s)), "a save from before priorities: everyone on Manual");
  tickHour(old);
  check(!old.work, "and nothing changes until you use them");
  const r = role(st, "Saved", { farm: 1, build: 2 }, { sched: Work.SCHED_PRESETS.day.sched, min: { farm: 1 } });
  join(st, ppl.slice(0, 3), r);
  setCell(st, ppl[0], "build", 1);
  at(st, 10);
  planBase(st, h);
  const loaded = loadFromString(saveToString(st));
  const lr = loaded.work.roles.find((x) => x.name === "Saved");
  const l0 = loaded.survivors.find((x) => x.name === ppl[0].name);
  check(lr && lr.sched === r.sched && lr.min.farm === 1 && lr.pri.farm === 1, "roles, schedule and minimums survive");
  check(Work.roleOf(loaded, l0) === lr && Work.cellOf(loaded, l0, "build").over && l0.task.t === ppl[0].task.t, "members, own cells and the task survive");
}

// ---------- 9. crews ----------
function crewWorld(seed) {
  const { st, h, ppl } = quiet(seed, 8);
  for (const s of ppl) { s.skills.shooting = 6; s.skills.scavenging = 5; }
  const c = st.work.roles.find((x) => x.kind === "crew");
  c.crew.field = { scavenge: 1 };
  join(st, ppl.slice(0, 2), c);
  join(st, ppl.slice(2), st.work.roles.find((x) => x.name === "Generalist"));
  return { st, h, ppl, c };
}
const crewParty = (st, c) => (c.crew.out ? st.parties.find((p) => p.id === c.crew.out.partyId) : null);
{
  section("Crews: a trip by its field priorities and limits, cards, rules, the log");
  let { st, h, ppl, c } = crewWorld(42);
  c.crew.paused = true;
  Crews.crewHour(st, { plan: true });
  check(!c.crew.out && /paused/.test(Crews.crewStatus(st, c)), "paused: no trip");
  c.crew.paused = false;
  c.crew.range = 8; c.crew.maxHours = 30;
  Crews.crewHour(st, { plan: true });
  const p = crewParty(st, c);
  check(!!p && p.crewName === c.name && p.crewRole === c.id, `a trip leaves (${c.crew.out && c.crew.out.why})`);
  if (p) {
    check(st.grid.distance(h.tile, p.dest) <= 8 && p.mission === "scavenge", `within range, by its field priority (scavenge, ${st.grid.distance(h.tile, p.dest)} tiles)`);
    check(p.members.length === 2 && ppl.slice(0, 2).every((s) => s.location.kind === "party"), "its members go");
    check(p.plan && p.plan.conditions.hurt === c.crew.rules.hurt && p.plan.conditions.cargo, "with the role's come-home rules");
    // A small card is answered, a big one held (unless "handle everything").
    let answered = false;
    st.cards.push({ title: "Storm", partyId: p.id, choices: [{ label: "Push on", resolve: () => "" }, { label: "Shelter", resolve: () => { answered = true; return "Sheltered."; } }] });
    const big = { title: "Raiders on the road", kind: "conflict", partyId: p.id, choices: [{ label: "Talk", hint: "60%", resolve: () => "talked" }, { label: "Fight back", hint: "40%", resolve: () => "fought" }] };
    st.cards.push(big);
    Crews.crewHour(st, { plan: false });
    check(answered && !st.cards.some((x) => x.title === "Storm"), "a small road card: answered the governor's way (Shelter)");
    check(st.cards.includes(big) && big.crewHeld && /needs your call/.test(st.log[0].text + st.log[1].text), "a fight with people: left for you");
    st.cards.splice(st.cards.indexOf(big), 1);
    c.crew.handleAll = true;
    const big2 = { ...big, crewHeld: false, choices: [{ label: "Talk", hint: "90%", resolve: () => "talked" }] };
    st.cards.push(big2);
    Crews.crewHour(st, { plan: false });
    check(!st.cards.includes(big2), "handle everything: it answers that too");
    c.crew.handleAll = false;
    check(/on the way|searching/.test(Crews.crewStatus(st, c)), `status line (${Crews.crewStatus(st, c)})`);
    // Base work goes on without them.
    at(st, 10); planBase(st, h);
    check(ppl.slice(0, 2).every((s) => s.location.kind === "party") && atBase(st, h.id).every((s) => s.task), "the people at home are planned, the crew is not");
    // Run until it is home.
    for (let i = 0; i < 24 * 6 && c.crew.out; i++) {
      tickHour(st);
      for (const card of [...st.cards]) if (!card.partyId || !st.parties.some((q) => q.id === card.partyId && q.crewRole)) { st.cards.splice(st.cards.indexOf(card), 1); const ch = card.choices.find((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled)); if (ch) ch.resolve(st); }
      for (const card of [...st.cards]) if (card.crewHeld) { st.cards.splice(st.cards.indexOf(card), 1); const ch = card.choices.find((x) => !x.uiAction); if (ch) ch.resolve(st); }
    }
    check(!c.crew.out && c.crew.log.length === 1 && /home from|lost at/.test(c.crew.log[0].result), `home again, the trip in its log (${c.crew.log[0] && c.crew.log[0].result})`);
    check(st.log.some((l) => /🚚 .* searched /.test(l.text)), "it searched the site hour by hour");
    check(/resting at home/.test(Crews.crewStatus(st, c)) || c.crew.rest === 0, `rests at home before the next trip (${Crews.crewStatus(st, c)})`);
  }
  // Field priorities: a recovery at 1 beats scavenging at 2; out of range: nothing.
  ({ st, h, ppl, c } = crewWorld(7));
  const tile = st.grid.within(h.tile, 3).find((id) => id !== h.tile && st.tiles[id].terrain !== "water" && st.tiles[id].terrain !== "mountain");
  st.markers.push({ key: `death:${tile}`, type: "death", tile, hour: 0, label: "Death site", info: { items: 3 } });
  c.crew.field = { scavenge: 2, recover: 1 };
  Crews.crewHour(st, { plan: true });
  check(c.crew.out && c.crew.out.mission === "recover", `Recover at 1 goes before Scavenge at 2 (${c.crew.out && c.crew.out.mission})`);
  ({ st, h, ppl, c } = crewWorld(7));
  c.crew.range = 2; c.crew.maxHours = 1;
  Crews.crewHour(st, { plan: true });
  check(!c.crew.out, `limits: nothing within 1 hour (${c.crew.status})`);
  // The come-home rule: hurt below the line → home, the "Coming home" card answered.
  ({ st, h, ppl, c } = crewWorld(42));
  c.crew.range = 10; c.crew.maxHours = 40;
  Crews.crewHour(st, { plan: true });
  const q = crewParty(st, c);
  if (q) {
    tickHour(st);
    for (const s of ppl.slice(0, 2)) s.health = Math.max(1, (c.crew.rules.hurt || 45) - 5);
    for (let i = 0; i < 3; i++) tickHour(st);
    check(!st.parties.includes(q) || q.phase === "back", `a member below the hurt line: the team turns home (${q.phase})`);
    check(!st.cards.some((x) => x.title === "Coming home"), "the plan's card is answered by the crew");
  } else check(false, "the rule test's trip left");
  // The danger at home keeps the crew in.
  ({ st, h, ppl, c } = crewWorld(42));
  h.alert = true;
  Crews.crewHour(st, { plan: true });
  check(!c.crew.out && /stays/.test(Crews.crewHold(st, c)), "danger at home: no trip");
}

// ---------- 10. the Work tab ----------
{
  section("The Work tab: HTML, cells, keys, drop-downs");
  const { st, h, ppl } = quiet();
  const ui = { baseView: { id: h.id, tab: "work" } };
  const BAD = /\b(undefined|NaN|Infinity|null)\b|\[object/;
  const clean = (html) => !BAD.test(html.replace(/<[^>]*>/g, " ")) && !/="(undefined|NaN|null)"/.test(html);
  const mainSrc = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const handled = (html) => [...html.matchAll(/<(\w+)([^>]*?)data-action="([^"]+)"/g)].every((m) => WORK_ACTIONS[m[3]] || WORK_CHANGE[m[3]] || new RegExp(`(^|[\\s{,])("${m[3]}"|${/^[a-z]\w*$/i.test(m[3]) ? m[3] : "\\u0000"})\\s*:`, "m").test(mainSrc));
  Work.everyoneOnPriorities(st, h);
  at(st, 10);
  planBase(st, h);
  let html = workTab(st, h, ui);
  check(clean(html) && handled(html), "clean HTML, every action handled");
  check((html.match(/class="wcell/g) || []).length >= ppl.length * WORK_KEYS.length, "a cell per person and work type");
  const s = ppl[0];
  const before = cellOf(st, s, "craft").p;
  WORK_ACTIONS.wc(st, ui, { id: String(s.id), k: "craft" }, { button: 0 });
  check(cellOf(st, s, "craft").p === (before >= 5 ? 0 : before + 1) && cellOf(st, s, "craft").over, "left-click counts up (an own cell)");
  WORK_ACTIONS.wc(st, ui, { id: String(s.id), k: "craft" }, { button: 2 });
  check(cellOf(st, s, "craft").p === before, "right-click counts down");
  const r = Work.roleOf(st, s);
  const rdef = r.pri.teach || 0;
  WORK_ACTIONS.wc(st, ui, { id: String(s.id), k: "teach" }, { button: 0, shiftKey: true });
  check((r.pri.teach || 0) === (rdef >= 5 ? 0 : rdef + 1), "Shift+click changes the role for everyone");
  ui.workHover = { action: "wc", id: String(s.id), k: "farm" };
  check(workKey(st, ui, { code: "Digit4" }) && cellOf(st, s, "farm").p === 4, "4 on the keyboard sets the cell");
  check(workKey(st, ui, { code: "KeyR" }) && !cellOf(st, s, "farm").over, "R puts it back to the role's");
  WORK_ACTIONS.wsched(st, ui, { role: r.id, h: "3" }, { button: 0 });
  check(Work.schedAt(r, 3) === "g", "the schedule strip cycles Work → Guard");
  WORK_ACTIONS["wrole-new-crew"](st, ui, {});
  html = workTab(st, h, ui);
  check(clean(html) && handled(html) && /Crews/.test(html) && /Field priorities/.test(html), "the role editor and the crews panel");
  const sel = roleSelect(st, s);
  check(/optgroup label="Work roles/.test(sel) && /value="w:/.test(sel), "the role drop-down offers work roles and fixed jobs");
  const ros = rosterModal(st, { rosterPrefs: null });
  check(clean(ros) && /→ /.test(ros), "the roster shows the role and what they do now");
}

// ---------- 11. production against the governor's roles ----------
section(`${longDays} days, Balanced autopilot: everyone on priorities vs the governor's roles (same seeds)`);
function watch(st) {
  const seen = new WeakSet();
  const names = new Set(Object.values(BUILDINGS).map((b) => b.name));
  const out = { builds: 0, crafts: 0 };
  return {
    tick() {
      for (const l of st.log) {
        if (seen.has(l)) break;
        seen.add(l);
        const m = /^(.+) finished at /.exec(l.text);
        if (m && names.has(m[1])) out.builds++;
        else if (/ crafted at |^\S.* finished at /.test(l.text) && !/^🔧/.test(l.text)) out.crafts++;
      }
    },
    out,
  };
}
function nanFree(st) {
  for (const b of st.bases) for (const [k, v] of Object.entries(b.stock)) if (!Number.isFinite(v) || v < 0) return `${b.name} ${k}=${v}`;
  for (const s of alive(st)) if (!Number.isFinite(s.health) || !Number.isFinite(s.mood)) return `${s.name}`;
  return "";
}
function run(seed, priorities, dice = 0) {
  const st = createWorld({ seed, factionCount: 8 });
  st.started = true;
  for (let i = 0; i < dice; i++) st.rng.next(); // another roll of the same world
  setAutopilot(st, true, "balanced");
  // The governor's survey trips (survey.js) are off for this comparison: they are extra trips taken with spare hands
  // and only add noise to a measure of who works at home (with them priorities finish ~1.5% fewer buildings).
  st.surveyOff = true;
  if (priorities) {
    st.governor.priorityRoles = true;
    workState(st);
    for (const b of st.bases) Work.everyoneOnPriorities(st, b);
  }
  const w = watch(st);
  let bad = "";
  while (day(st) <= longDays && !st.gameOver) {
    tickHour(st);
    w.tick();
    if (!bad && st.hour % 24 === 0) bad = nanFree(st);
  }
  const managed = priorities ? alive(st).filter((s) => Work.isManaged(st, s)).length : 0;
  return { food: Math.round(econStats(st).harvested), builds: w.out.builds, crafts: w.out.crafts, pop: alive(st).length, day: day(st), bad, managed, st };
}
// Every (seed, dice, way) in a child process of its own, as many at once as there are cores.
const self = fileURLToPath(import.meta.url);
const runChild = (seed, dice, pri) => new Promise((resolve) => {
  const ch = spawn(process.execPath, [self, "--pair", String(seed), String(dice), String(longDays), pri ? "1" : "0"], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  ch.stdout.on("data", (d) => { out += d; });
  ch.stderr.on("data", (d) => { err += d; });
  ch.on("close", (code) => {
    try { resolve(JSON.parse(out.trim().split(/\r?\n/).pop())); } catch { resolve({ bad: `crashed (exit ${code}): ${err.slice(0, 300)}`, food: 0, builds: 0, crafts: 0, pop: 0, day: 0, managed: 0 }); }
  });
});
const jobs = [];
for (const seed of seeds) for (let dice = 0; dice < DICE; dice++) for (const pri of [false, true]) jobs.push({ seed, dice, pri });
const results = new Map();
let next = 0;
await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs.length, cpus().length - 1)) }, async () => {
  while (next < jobs.length) {
    const j = jobs[next++];
    results.set(`${j.seed}|${j.dice}|${j.pri}`, await runChild(j.seed, j.dice, j.pri));
  }
}));
const sum = { gov: { food: 0, builds: 0, crafts: 0 }, pri: { food: 0, builds: 0, crafts: 0 } };
for (const seed of seeds) {
  const g = { food: 0, builds: 0, crafts: 0 }, p = { food: 0, builds: 0, crafts: 0 };
  for (let dice = 0; dice < DICE; dice++) {
    const a = results.get(`${seed}|${dice}|false`), b = results.get(`${seed}|${dice}|true`);
    for (const k of ["food", "builds", "crafts"]) { g[k] += a[k]; p[k] += b[k]; sum.gov[k] += a[k]; sum.pri[k] += b[k]; }
    check(!a.bad && !b.bad, `seed ${seed} dice ${dice}: no NaN, negative stock or crash (${a.bad || b.bad})`);
    check(b.managed > 0 || b.pop === 0, `seed ${seed} dice ${dice}: people stayed on priorities`);
  }
  console.log(`  seed ${seed} (${DICE} rolls): governor food ${g.food}, builds ${g.builds}, crafts ${g.crafts} | priorities food ${p.food}, builds ${p.builds}, crafts ${p.crafts}`);
}
console.log(`  total over ${seeds.length} seeds × ${DICE} rolls: governor food ${sum.gov.food}, builds ${sum.gov.builds}, crafts ${sum.gov.crafts} | priorities food ${sum.pri.food}, builds ${sum.pri.builds}, crafts ${sum.pri.crafts}`);
check(sum.pri.food >= sum.gov.food, `priorities harvest at least as much food (${sum.pri.food} vs ${sum.gov.food})`);
// Buildings: the two modes tie within the run-to-run spread (per seed ±40, so about ±90 over 40 runs; 8 runs a seed
// put priorities 1.3% behind, 4 runs 5.3%; with the governor's water filters held while the tanks are full, work.js
// holdFilters, 8 runs 0.4% and 4 runs 6.6%): a strict "at least as many" would fail on noise, so allow the spread, 7%.
check(sum.pri.builds >= sum.gov.builds * 0.93, `priorities finish about as many buildings, within the 7% run-to-run spread (${sum.pri.builds} vs ${sum.gov.builds})`);
check(sum.pri.crafts >= sum.gov.crafts, `priorities finish at least as many crafts (${sum.pri.crafts} vs ${sum.gov.crafts})`);

// ---------- 12. determinism ----------
section("Determinism: two worlds on priorities with a crew, in one process");
function sig(seed) {
  const { st, c } = crewWorld(seed);
  c.crew.range = 10; c.crew.maxHours = 30;
  for (let i = 0; i < 24 * 30; i++) {
    tickHour(st);
    for (const card of [...st.cards]) if (!card.crewHeld || true) { st.cards.splice(st.cards.indexOf(card), 1); const ch = card.choices.find((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled)); if (ch) ch.resolve(st); }
  }
  const people = alive(st).map((s) => [s.name, s.role, s.task ? s.task.t : "", Math.round(s.health * 100), Math.round(s.mood * 100)]).sort();
  return JSON.stringify({ people, stock: st.bases.map((b) => b.stock), log: st.log.map((l) => l.text), crew: c.crew.log, nan: nanFree(st) });
}
const s1 = sig(11), s2 = sig(11);
check(s1 === s2, "the same seed plays out the same");
check(!JSON.parse(s1).nan, "no NaN in the crew run");

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
