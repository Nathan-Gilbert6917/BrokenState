// The watch roster (src/sim/watch.js) and the defence plan (src/sim/defenceplan.js).
// Checks: presets and editing, people on work priorities and Manual people standing their watch (and back to their
// job after it, and at midnight), the hurt and the away left off, coverage and gaps, the watch in the walls' hold
// limit; the defence drill (the base's battle map, nobody to fight, nothing starts), saving a plan, the plan taken up
// at the deploy step of a real attack (on the fort map and on a map turned to face the attack), changed there and
// saved back, a map that changed (the plan is not used), headless battles, saving and loading.
// Tiredness (sleep.js): a normal day never Tired, a night watch slept off, back-to-back watches warned of and Tired in
// play, the costs (aim, mood, the hold limit), away from base. Unwatched nights: surprise (nobody on guard, a dozing
// exhausted watcher, the alert and a tripwire undo it), a raid and a horde by the numbers, the cards and the log say
// why, a surprise battle with a deploy step played out; the watch's early warning. The governor's night watch.
// Usage: node tools/watchplantest.js [seed]
import { createWorld, hub, atBase, makeSurvivor, hourOfDay } from "../src/sim/world.js";
import { tickHour } from "../src/sim/world.js";
import { createBattle, combatAct, autoPlayerTurn, runEnemyPhase, registerCombatHandler, active, unitAt } from "../src/sim/combat.js";
import { addBuilding } from "../src/sim/buildings.js";
import { deployProblems, canPlace, sideUntf, endDeploy } from "../src/sim/deploy.js";
import { guardHold, holdLimit, raidTier, hordeAttackBase, hordeWarnings } from "../src/sim/defences.js";
import { workState, assignRole, planBase } from "../src/sim/work.js";
import { WATCH_PRESETS, setWatchPreset, toggleWatch, fillWatch, watchCoverage, watchHour, watchDayRoles, onWatchNow, watchLine, addShift, setShiftHours, removeShift, readiness, surpriseAt, lookoutsSpot, watchSawText, SURPRISE } from "../src/sim/watch.js";
import { TIRED, TIRED_WORDS, tiredHour, tiredLevel, tiredAim, tiredText, sleepingIn, rosterStrain } from "../src/sim/sleep.js";
import { baseDefense, resolveRaidOnPlayer } from "../src/sim/factions.js";
import { spawnAiParty, movePartiesHour } from "../src/sim/parties.js";
import { makeHorde } from "../src/sim/hordes.js";
import { setAutopilot, autopilotDaily } from "../src/sim/autopilot.js";
import { defenceTab } from "../src/ui/defence.js";
import { gaugeRows } from "../src/ui/needs.js";
import { startDrill, endDrill, savePlan, applyPlan, planFor, planKey, planStale, clearPlan, plansOf, pickPlan, currentPlan, roleOf, startText, defaultRolePlan, PLAN, PLAN_ROLES } from "../src/sim/defenceplan.js";
import { fightNow } from "../src/sim/defences.js";
import { newItem } from "../src/sim/inventory.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(`\n${t}`);
registerCombatHandler("wp", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; return st; };
const setHour = (st, h) => { st.hour = Math.floor(st.hour / 24) * 24 + 24 + h; };
function armHub(st, list = ["walls", "walls", "watchtower", "barricades", "bunkhouse", "storehouse", "gate"], extra = 3) {
  const h = hub(st);
  for (const t of list) addBuilding(h, t);
  for (let i = 0; i < extra; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); }
  for (const s of atBase(st, h.id)) { s.health = 100; s.pinned = false; if (!s.gear.weapon) s.gear.weapon = newItem("pistol"); }
  h.stock.ammo = 300;
  return h;
}
// An attack on the base as the browser opens it. ready: who is at a post (defenceplan.js openStart; the defences
// manned unless a test says otherwise). enemy: the horde unless given.
function attack(st, h, context = {}, enemy = { kind: "zombies", count: 10, power: 3, name: "the horde" }) {
  globalThis.window = {};
  try {
    st.combat = createBattle(st, { tile: h.tile, baseId: h.id, enemy, ambush: null, canRetreat: true, handler: "wp", layout: "baseDefence", deploy: true, downedLive: 0.4, context: { night: false, ready: { manned: true }, ...context } });
  } finally { delete globalThis.window; }
  return st.combat;
}
const playersOf = (b) => b.units.filter((u) => u.side === "player" && active(u));

// ---------- the watch roster ----------
section("The watch roster: presets and editing");
{
  const st = world();
  const h = armHub(st);
  check(setWatchPreset(st, h, "three") && h.watch.shifts.length === 3 && h.watch.shifts.map((s) => `${s.from}-${s.to}`).join(",") === "6-14,14-22,22-6", "three 8-hour watches: 06–14, 14–22, 22–06");
  const ppl = atBase(st, h.id);
  toggleWatch(st, h, 2, ppl[0].id);
  setWatchPreset(st, h, "two");
  check(h.watch.shifts.find((s) => s.name === "Night").ids.includes(ppl[0].id), "switching to two watches keeps the night watch's people");
  addShift(st, h, 12, 13); setShiftHours(st, h, 2, 11, 14);
  check(h.watch.shifts.length === 3 && h.watch.shifts[2].from === 11 && h.watch.shifts[2].to === 14 && h.watch.preset === null, "a watch added by hand, its hours set");
  removeShift(st, h, 2);
  const msg = fillWatch(st, h);
  const all = h.watch.shifts.flatMap((s) => s.ids);
  check(all.length >= 2 && new Set(all).size === all.length, `fill: everyone on at most one watch, every watch someone (${msg})`);
  setWatchPreset(st, h, "none");
  check(!h.watch, "no roster");
  check(Object.keys(WATCH_PRESETS).length === 4, "four presets");
}

section("Standing the watch: people on priorities and Manual people");
{
  const st = world();
  const h = armHub(st);
  workState(st);
  const ppl = atBase(st, h.id);
  const [a, m] = ppl;
  assignRole(st, a, st.work.roles.find((r) => r.name === "Generalist").id); // on priorities
  m.role = "farm"; m.work = null;                                          // Manual
  setWatchPreset(st, h, "two");
  toggleWatch(st, h, 1, a.id); toggleWatch(st, h, 1, m.id); // the night watch, 18–06
  setHour(st, 23);
  planBase(st, h);
  check(a.role === "guard" && a.task && a.task.why.includes("On watch: Night"), `on priorities: on guard at 23:00 (${a.task && a.task.why})`);
  watchHour(st);
  check(m.role === "guard" && m.watchWas && m.watchWas.role === "farm", "Manual: on guard at 23:00, their farm job kept to go back to");
  const hold = guardHold(st, h);
  watchDayRoles(st);
  check(m.role === "farm" && !m.watchWas, "at midnight the Manual watcher counts at their own job (the day's farming)");
  check(guardHold(st, h) < hold, `the watch counts in the walls' hold limit (${Math.round(hold)} on watch, ${Math.round(guardHold(st, h))} off)`);
  watchHour(st);
  check(m.role === "guard", "and is back on watch for the rest of the night");
  setHour(st, 9);
  planBase(st, h); watchHour(st);
  check(a.role !== "guard" && m.role === "farm" && !m.watchWas, `off watch at 09:00: back to work (${a.role}, ${m.role})`);
  setHour(st, 2);
  m.health = 20; // badly hurt
  watchHour(st);
  check(m.role !== "guard" && !onWatchNow(st, h, m), "the badly hurt do not stand their watch");
  m.health = 100;
  m.location = { kind: "party", partyId: 999 };
  check(!onWatchNow(st, h, m) && watchCoverage(st, h)[2].n === 1, "away from the base: off the watch, coverage counts who is here");
  m.location = { kind: "base", baseId: h.id };
  m.pinned = true;
  watchHour(st);
  check(m.role !== "guard", "pinned people keep their job");
  m.pinned = false;
  const line = watchLine(st, h);
  check(/no watch 06–18/.test(line), `gaps shown: ${line}`);
  // Through the real hourly tick.
  setHour(st, 21);
  for (let i = 0; i < 3; i++) tickHour(st);
  check(hourOfDay(st) === 0 || a.role === "guard", `through tickHour: on watch at ${hourOfDay(st)}:00 (${a.role}, ${m.role})`);
}

// ---------- the defence plan ----------
section("The drill: the base's battle map, nobody to fight");
let planned = null;
{
  const st = world();
  const h = armHub(st);
  check(startDrill(st, h.id) === "" && st.combat && st.combat.drill, "the drill opens on the base's battle map");
  const b = st.combat;
  check(b.phase === "deploy" && !b.units.some((u) => u.side !== "player") && !deployProblems(b).length, `deploy step, only your people, default posts valid (${b.tier.map} map ${b.w}×${b.h}, key ${planKey(b)})`);
  check(combatAct(st, { type: "start" }) !== "" && b.phase === "deploy", "Start is refused: a drill never starts");
  autoPlayerTurn(st);
  check(st.combat === b && b.phase === "deploy" && !b.over, "the AI's turn does not start it either");
  // Move the first defender somewhere else inside.
  const u = playersOf(b)[0];
  let target = null;
  for (let y = 0; y < b.h && !target; y++) for (let x = 0; x < b.w && !target; x++) if (canPlace(b, x, y) && !unitAt(b, x, y) && Math.hypot(x - u.x, y - u.y) > 3) target = [x, y];
  check(combatAct(st, { type: "place", unit: u.id, x: target[0], y: target[1] }) === "" && u.x === target[0] && u.y === target[1], `${u.name} placed by hand at ${target}`);
  check(combatAct(st, { type: "plan" }) !== "", "no plan yet: Planned posts says so");
  check(combatAct(st, { type: "savePlan" }) === "" && plansOf(h).length === 1 && plansOf(h)[0].maps[planKey(b)], "Save as plan (a first plan, \"Default\")");
  planned = { sid: u.sid, key: planKey(b), cell: target.slice(), n: playersOf(b).length };
  check(plansOf(h)[0].maps[planned.key].posts.length === planned.n, `everyone in the plan (${planned.n})`);
  combatAct(st, { type: "endDrill" });
  check(!st.combat, "Close: no battle left behind");
  // The real attack.
  const r = attack(st, h);
  const ru = playersOf(r).find((x) => x.sid === planned.sid);
  const back = r.tier.map === "fort" ? [ru.x, ru.y] : sideUntf(r.deploy.side, r.deploy.frame.w0, r.deploy.frame.h0)(ru.x, ru.y);
  check(planFor(st, r) && back[0] === planned.cell[0] && back[1] === planned.cell[1], `the attack (from the ${r.deploy.side}): ${ru.name} is at the planned cell`);
  check(!deployProblems(r).length && r.log.some((l) => /defence plan/.test(l.text)), `valid posts, the log says so (${(r.log.find((l) => /defence plan/.test(l.text)) || {}).text})`);
  const others = playersOf(r).filter((x) => x !== ru);
  const mapped = (x) => (r.tier.map === "fort" ? [x.x, x.y] : sideUntf(r.deploy.side, r.deploy.frame.w0, r.deploy.frame.h0)(x.x, x.y));
  const same = others.filter((x) => { const p = plansOf(h)[0].maps[planned.key].posts.find((q) => q[0] === x.sid); const c = mapped(x); return p && p[1] === c[0] && p[2] === c[1]; }).length;
  check(same >= others.length - 1, `the others at theirs too (${same} of ${others.length}; a breach can take one)`);
  // Changed for this fight, then the defaults, then back to the plan.
  combatAct(r, { type: "defaults" });
  combatAct(st, { type: "defaults" });
  const d = r.deploy.defaults.find(([id]) => id === ru.id);
  check(ru.x === d[1] && ru.y === d[2], "Default positions: the automatic layout");
  check(combatAct(st, { type: "plan" }) === "" && mapped(ru)[0] === planned.cell[0], "Planned posts: back to the plan");
  st.combat = null;
}

section("A map turned to face the attack (no walls: the yard and buildings)");
{
  const st = world(seed + 1);
  const h = armHub(st, ["bunkhouse", "storehouse", "barricades"], 4);
  h.buildings = h.buildings.filter((x) => x.type !== "walls"); // a hub starts with a wall section
  startDrill(st, h.id);
  const b = st.combat;
  check(b.tier.map === "interior" && b.deploy.side === "east", `the drill faces east (${b.tier.map})`);
  const u = playersOf(b)[1];
  let target = null;
  for (let y = 0; y < b.h && !target; y++) for (let x = 0; x < b.w && !target; x++) if (canPlace(b, x, y) && !unitAt(b, x, y) && Math.abs(y - b.h / 2) > 2) target = [x, y];
  combatAct(st, { type: "place", unit: u.id, x: target[0], y: target[1] });
  combatAct(st, { type: "savePlan" });
  endDrill(st);
  // From the north: a tile north of the hub.
  const g = st.grid, [hx, hy] = g.toPixel(h.tile, 1);
  const north = g.within(h.tile, 3).map((id) => [id, g.toPixel(id, 1)]).filter(([, [x, y]]) => Math.abs(x - hx) < (hy - y) * 0.6 && hy - y > 0).map(([id]) => id)[0];
  const r = attack(st, h, { fromTile: north });
  const ru = playersOf(r).find((x) => x.sid === u.sid);
  const back = sideUntf(r.deploy.side, r.deploy.frame.w0, r.deploy.frame.h0)(ru.x, ru.y);
  check(r.deploy.side === "north" && back[0] === target[0] && back[1] === target[1], `the attack from the ${r.deploy.side}: the plan turns with the map (${ru.x},${ru.y} ← ${target})`);
  check(!deployProblems(r).length, "valid posts");
  // Changed in the deploy step and saved back.
  let t2 = null;
  for (let y = r.h - 1; y >= 0 && !t2; y--) for (let x = r.w - 1; x >= 0 && !t2; x--) if (canPlace(r, x, y) && !unitAt(r, x, y)) t2 = [x, y];
  combatAct(st, { type: "place", unit: ru.id, x: t2[0], y: t2[1] });
  combatAct(st, { type: "savePlan" });
  const p = plansOf(h)[0].maps.interior.posts.find((q) => q[0] === ru.sid);
  const want = sideUntf("north", r.deploy.frame.w0, r.deploy.frame.h0)(t2[0], t2[1]);
  check(p[1] === want[0] && p[2] === want[1], "changed in the deploy step, saved back as the plan (on the east-facing layout)");
  st.combat = null;
  // The base grows a wall: a new map, the plan is not used.
  addBuilding(h, "walls");
  const r2 = attack(st, h);
  check(planKey(r2) !== "interior" || planStale(st, r2) || !planFor(st, r2), `walls built: another map (${r2.tier.map}), the yard plan is not used for it`);
  st.combat = null;
  clearPlan(st, h);
  check(!plansOf(h).length, "cleared");
}

section("A bridge barricade's wall map (turned to face the attack)");
{
  const st = world(seed + 3);
  const h = armHub(st);
  // The wall map (deploy.js) as a bridge base gets it; context.strip makes it on land (the tools' switch).
  const r = attack(st, h, { strip: true });
  check(r.tier.map === "wall" && planKey(r) === "wall", `the wall map (${r.w}×${r.h}, from the ${r.deploy.side})`);
  const u = playersOf(r)[0];
  let target = null;
  for (let y = 0; y < r.h && !target; y++) for (let x = 0; x < r.w && !target; x++) if (canPlace(r, x, y) && !unitAt(r, x, y) && Math.hypot(x - u.x, y - u.y) > 3) target = [x, y];
  combatAct(st, { type: "place", unit: u.id, x: target[0], y: target[1] });
  combatAct(st, { type: "savePlan" });
  const east = sideUntf(r.deploy.side, r.deploy.frame.w0, r.deploy.frame.h0)(target[0], target[1]);
  st.combat = null;
  const g = st.grid, [hx, hy] = g.toPixel(h.tile, 1);
  const west = g.within(h.tile, 3).map((id) => [id, g.toPixel(id, 1)]).filter(([, [x, y]]) => hx - x > Math.abs(y - hy) * 1.6).map(([id]) => id)[0];
  const r2 = attack(st, h, { strip: true, fromTile: west });
  const u2 = playersOf(r2).find((x) => x.sid === u.sid);
  const back = sideUntf(r2.deploy.side, r2.deploy.frame.w0, r2.deploy.frame.h0)(u2.x, u2.y);
  check(r2.deploy.side === "west" && back[0] === east[0] && back[1] === east[1], `from the ${r2.deploy.side} next time: the same post on the wall, turned (${u2.x},${u2.y})`);
  check(!deployProblems(r2).length, "valid posts");
  st.combat = null;
}

section("Headless battles take the plan up; save and load");
{
  const st = world(seed + 2);
  const h = armHub(st);
  setWatchPreset(st, h, "four");
  fillWatch(st, h);
  startDrill(st, h.id);
  const b = st.combat;
  const u = playersOf(b)[0];
  let target = null;
  for (let y = 0; y < b.h && !target; y++) for (let x = 0; x < b.w && !target; x++) if (canPlace(b, x, y) && !unitAt(b, x, y) && Math.hypot(x - u.x, y - u.y) > 4) target = [x, y];
  combatAct(st, { type: "place", unit: u.id, x: target[0], y: target[1] });
  combatAct(st, { type: "savePlan" });
  // Save in the middle of the drill and load it.
  const st2 = loadFromString(saveToString(st));
  check(st2.combat && st2.combat.drill && st2.bases[0].watch && st2.bases[0].watch.shifts.length === 4 && plansOf(st2.bases[0]).length === 1, "saved and loaded mid-drill: the drill, the roster and the plan");
  endDrill(st);
  // A battle without the browser (the autopilot, headless): createBattle with no deploy step lays the plan too.
  const r = createBattle(st, { tile: h.tile, baseId: h.id, enemy: { kind: "zombies", count: 8, power: 3 }, ambush: null, canRetreat: true, handler: "wp", layout: "baseDefence", context: { night: false, ready: { manned: true } } });
  st.combat = r;
  const ru = playersOf(r).find((x) => x.sid === u.sid);
  const back = r.tier.map === "fort" ? [ru.x, ru.y] : sideUntf(r.deploy.side, r.deploy.frame.w0, r.deploy.frame.h0)(ru.x, ru.y);
  check(back[0] === target[0] && back[1] === target[1] && r.phase !== "deploy", "an auto-played battle starts from the plan too");
  st.combat = null;
  void applyPlan; void savePlan;
}

// ---------- tiredness (sleep.js) ----------
// Runs hours by hand: the work planner (priorities), the Manual watch, then the sleep pass, as tickHour does.
const runHours = (st, h, n) => {
  let peak = 0;
  for (let i = 0; i < n; i++) {
    st.hour++; planBase(st, h); watchHour(st); tiredHour(st);
    for (const s of atBase(st, h.id)) peak = Math.max(peak, s.tired || 0);
  }
  return peak;
};
const battleAt = (st, h, setup) => { globalThis.window = {}; try { return createBattle(st, { tile: h.tile, baseId: h.id, canRetreat: true, handler: "wp", ...setup }); } finally { delete globalThis.window; } };
section("Tiredness: a normal day, a night watch, back-to-back watches");
{
  const st = world();
  const h = armHub(st);
  workState(st);
  const [a, m, x] = atBase(st, h.id);
  assignRole(st, a, st.work.roles.find((r) => r.name === "Generalist").id); // on priorities, Anytime schedule
  m.role = "farm"; m.work = null;                                          // Manual
  setHour(st, 6);
  const peak = runHours(st, h, 72);
  check(peak <= 16 && atBase(st, h.id).every((s) => tiredLevel(s) === 0), `no roster: a normal day peaks at ${peak} h owed (Tired from ${TIRED.TIRED}), nobody Tired`);
  // A night watch, 22–06, for both.
  setWatchPreset(st, h, "three");
  toggleWatch(st, h, 2, a.id); toggleWatch(st, h, 2, m.id);
  setHour(st, 21);
  runHours(st, h, 8); // the hour 05:00
  st.hour++;
  check(sleepingIn(st, h, a) && sleepingIn(st, h, m), `off the night watch at 06:00 they sleep in (owing ${a.tired}, ${m.tired})`);
  st.hour--;
  runHours(st, h, 2);
  check(a.role === "rest" && a.task && /Sleeping off the watch/.test(a.task.why), `on priorities: put to bed for it (${a.task && a.task.why})`);
  const p2 = runHours(st, h, 24 * 4);
  check(p2 < TIRED.TIRED && tiredLevel(a) === 0 && tiredLevel(m) === 0, `night after night on the 22–06 watch nobody gets Tired (most owed ${p2})`);
  check(rosterStrain(st, h, a).level === 0 && !/would end up/.test(defenceTab(st, h, {})), "the roster card's forecast agrees (no warning)");
  // The same person on the night and the morning watch: 16 hours on watch in a row.
  toggleWatch(st, h, 0, m.id);
  const sm = rosterStrain(st, h, m);
  check(sm.run === 16 && sm.level >= 1, `night then morning watch: ${sm.run} hours in a row, forecast ${TIRED_WORDS[sm.level]} (most owed ${sm.peak})`);
  const tab = defenceTab(st, h, {});
  check(/back to back/.test(tab) && /would end up (Tired|Exhausted)/.test(tab), "the roster card warns: back to back, and Tired");
  const p3 = runHours(st, h, 24 * 3);
  check(p3 >= TIRED.TIRED, `and in play they do get Tired (most owed ${p3}, now ${m.tired})`);
  m.tired = 25;
  check(/>Tired</.test(defenceTab(st, h, {})) && gaugeRows(m).includes("Tired"), "a Tired chip on the roster and a line under the survivor's gauges");
  // What it costs: aim, mood, the walls.
  check(tiredAim(m) === TIRED.AIM[1] && tiredText(m).startsWith("Tired"), `Tired: aim ${tiredAim(m)}`);
  m.tired = 40;
  check(tiredAim(m) === TIRED.AIM[2], `Exhausted: aim ${tiredAim(m)}`);
  const um = battleAt(st, h, { enemy: { kind: "zombies", count: 4, power: 2 }, ambush: null, context: {} }).units.find((u) => u.sid === m.id);
  m.tired = 0;
  const um2 = battleAt(st, h, { enemy: { kind: "zombies", count: 4, power: 2 }, ambush: null, context: {} }).units.find((u) => u.sid === m.id);
  check(um && um2 && Math.round(um.aim - um2.aim) === TIRED.AIM[2], `on the battle map: aim ${um && Math.round(um.aim)} exhausted, ${um2 && Math.round(um2.aim)} rested`);
  for (const s of atBase(st, h.id)) { s.role = "farm"; s.tired = 0; s.work = null; }
  setWatchPreset(st, h, "none");
  m.role = "guard";
  const fresh = guardHold(st, h);
  m.tired = 40;
  check(Math.abs(guardHold(st, h) - fresh * TIRED.GUARD) < 0.01, `an exhausted guard counts half in the hold limit (${Math.round(fresh)} → ${Math.round(guardHold(st, h))})`);
  const mood = m.mood;
  setHour(st, 12); tiredHour(st);
  check(m.mood < mood, `and loses mood (${mood.toFixed(1)} → ${m.mood.toFixed(1)})`);
  // Away: no more tired; asleep at night on the road.
  m.location = { kind: "party", partyId: 999 }; m.tired = 10;
  setHour(st, 14); tiredHour(st);
  check(m.tired === 10, "away from the base by day: no more tired");
  setHour(st, 23); tiredHour(st);
  check(m.tired === 10 - TIRED.AWAY, `at night on the road: −${TIRED.AWAY} an hour`);
  m.location = { kind: "base", baseId: h.id };
  void x;
}

// ---------- unwatched nights ----------
section("Unwatched nights: surprise, and the watch's early warning");
{
  const st = world();
  const h = armHub(st, ["walls", "walls", "barricades", "barricades", "gate", "bunkhouse"]);
  for (const s of atBase(st, h.id)) { s.role = "farm"; s.tired = 0; s.work = null; }
  setHour(st, 2);
  const sp = surpriseAt(st, h);
  check(sp && /^Nobody was on watch at /.test(sp.why), `at night with nobody on guard: caught asleep ("${sp && sp.why}")`);
  setHour(st, 13);
  check(!surpriseAt(st, h), "by day: no surprise");
  setHour(st, 2);
  const g = atBase(st, h.id)[0];
  g.role = "guard";
  const r = readiness(st, h);
  check(!surpriseAt(st, h) && r.watchers.includes(g.id) && r.alert === 1 && !r.dozing.length, "one awake on guard: no surprise (readiness: alert 1)");
  g.tired = 40;
  let caught = 0, why = "";
  for (let i = 0; i < 40; i++) { st.hour += 24; const x = surpriseAt(st, h); if (x) { caught++; why = x.why; } }
  check(readiness(st, h).dozing.includes(g.id) && caught > 5 && caught < 35 && /dozed off on watch/.test(why), `an exhausted lone watcher dozes off about half the nights (${caught} of 40): "${why}"`);
  g.tired = 0; g.role = "farm";
  h.alert = true;
  check(!surpriseAt(st, h), "defences manned (Prepare defenses): no surprise");
  h.alert = false;
  h.armory = (h.armory || []).concat([newItem("tripwire")]);
  check(!surpriseAt(st, h), "a tripwire alarm in the armory wakes everyone: no surprise");
  h.armory = h.armory.filter((it) => it.key !== "tripwire");
  // By the numbers.
  const def = baseDefense(st, h), defS = baseDefense(st, h, true);
  check(defS < def, `a raid that catches them asleep: everyone but the guards ${SURPRISE.ASLEEP}× (defence ${Math.round(def)} → ${Math.round(defS)})`);
  const rt = raidTier(st, h, 50, 40, 1.2, 0.8), rtS = raidTier(st, h, 50, 40, 1.2, 0.8, null, true);
  check(rt.mults.wall > 1 && rtS.mults.wall === 1 && rtS.ratio < rt.ratio, `and the walls do not count (wall tier ×${rt.mults.wall.toFixed(2)} → ×1)`);
  const lim = holdLimit(st, h), limS = holdLimit(st, h, 0, true);
  check(limS < lim, `a horde on an unwatched night: the defence buildings count half (hold ${lim} → ${limS})`);
  // A raid party arriving at night, not seen coming: the card and the result say why.
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const from = st.grid.within(h.tile, 3).find((id) => st.grid.distance(id, h.tile) === 3 && st.tiles[id].terrain !== "water");
  const p = spawnAiParty(st, f, "raid", from, h.tile, { strength: 30, target: { kind: "player", baseId: h.id, tile: h.tile } });
  check(!!p, "a raid party on its way");
  if (p) {
    p.idx = p.path.length - 1;
    const cards = st.cards.length;
    setHour(st, 1);
    st.live = new Set(st.grid.within(h.tile, 1));
    movePartiesHour(st);
    const card = st.cards.slice(cards).find((c) => /^Raiders heading for/.test(c.title));
    check(p.phase === "siege" && /^Nobody was on watch/.test(p.surprise || "") && card && /over the wall before anyone woke/.test(card.text), "at the walls at 01:00 unseen: caught asleep, and the card says why");
    const res = resolveRaidOnPlayer(st, p);
    check(res && /over the wall before anyone woke/.test(res.text), `the raid's report says it too (${res && res.outcome})`);
  }
  // The early warning (watch.js lookoutsSpot).
  const three = st.grid.within(h.tile, 3).find((id) => st.grid.distance(id, h.tile) === 3);
  setHour(st, 23);
  st.live = new Set(st.grid.within(h.tile, 1));
  check(!lookoutsSpot(st, h, three, 4) && !lookoutsSpot(st, h, st.grid.neighbors(h.tile)[0], 4), "night, nobody on watch: nothing seen coming, not even next to the walls");
  g.role = "guard";
  check(lookoutsSpot(st, h, three, 4), "someone on watch sees it 3 tiles out in the dark");
  setHour(st, 12);
  const six = st.grid.within(h.tile, 6).find((id) => st.grid.distance(id, h.tile) === 6);
  st.live = new Set(st.grid.within(h.tile, 8));
  check(lookoutsSpot(st, h, six, 4) && watchSawText(st, h, six, 4) !== "", "by day the watch warns 2 tiles further out (6 for a raid), and the card says the watch saw them early");
  g.role = "farm";
  check(!lookoutsSpot(st, h, six, 4) && lookoutsSpot(st, h, three, 4), "by day without a watch: as before (in sight, within 4)");
  // A horde coming at night: unwatched, no warning card; watched, a card that says the watch saw it.
  setHour(st, 23);
  st.live = new Set(st.grid.within(h.tile, 1));
  const coming = makeHorde(st, { tile: three, size: 40, role: "attack", target: h.tile });
  hordeWarnings(st);
  check(!coming.warned, "a horde coming at night to an unwatched base: no warning");
  g.role = "guard";
  const c0 = st.cards.length;
  hordeWarnings(st);
  const hc = st.cards.slice(c0).find((c) => /^Horde heading for/.test(c.title));
  check(coming.warned && hc && /The watch on the walls saw them early/.test(hc.text), "with someone on watch: warned, and the card says the watch saw it");
  st.hordes.splice(st.hordes.indexOf(coming), 1);
  g.role = "farm";
  // A horde at the walls of an unwatched base at night: the log says why.
  setHour(st, 3);
  const hd = makeHorde(st, { tile: h.tile, size: 60, role: "attack" });
  st.combat = null;
  const before = JSON.stringify(st.log.slice(0, 5));
  hordeAttackBase(st, hd, h);
  const all = st.log.map((x) => (typeof x === "string" ? x : x.text || "")).join(" | ");
  check(JSON.stringify(st.log.slice(0, 5)) !== before && /Nobody was on watch at .*before anyone woke/.test(all), "a horde at night: the log says nobody was on watch");
}

section("A surprise battle with a deploy step");
for (const walls of [true, false]) {
  const st = world(seed + (walls ? 0 : 1));
  const h = armHub(st, walls ? ["walls", "walls", "barricades", "bunkhouse"] : ["barricades", "bunkhouse"]);
  for (const s of atBase(st, h.id)) s.role = "farm"; // nobody on watch: the surprise
  const b = battleAt(st, h, { enemy: { kind: "raiders", count: 6, power: 3, name: "raiders" }, ambush: "enemy", layout: "baseDefence", deploy: true, context: { night: true, surprise: true } });
  st.combat = b;
  // A base battle has one start for a surprise (defenceplan.js openStart): no volley, everyone in the buildings, and
  // the attackers move first once the deploy step ends.
  const mine = b.units.filter((u) => u.side === "player");
  check(b.phase === "deploy" && b.setup.context.surprise && mine.every((u) => u.late && u.hp === u.maxHp), `${walls ? "walled" : "open"} base: no volley, the deploy step, everyone still in the buildings (${b.tier ? b.tier.map : "field"} map)`);
  endDeploy(b);
  check(b.tier && b.tier.enemyNext && mine.every((u) => u.ap === 0), "the deploy step ends: the attackers move first");
  for (let i = 0; i < 300 && !b.over; i++) { if (b.phase === "player" || b.phase === "deploy") autoPlayerTurn(st); else runEnemyPhase(st); }
  check(b.over, `and it plays to the end (${b.outcome || (b.result && b.result.outcome) || "over"})`);
  st.combat = null;
}

// ---------- the governor's night watch ----------
section("The governor's night watch (autopilot.js govWatch)");
{
  const st = world();
  const h = armHub(st, ["walls", "bunkhouse", "bunkhouse"], 5);
  setAutopilot(st, true, "balanced");
  setHour(st, 17);
  for (let i = 0; i < 2; i++) tickHour(st); // to 19:00: the day's jobs, before the watch
  const dayRole = new Map(atBase(st, h.id).map((s) => [s.id, s.role]));
  for (let i = 0; i < 4; i++) tickHour(st); // to 23:00
  const W = h.watch;
  check(W && W.gov && W.shifts.length === 2 && W.shifts.every((sh) => sh.ids.length >= 1), `a base of ${atBase(st, h.id).length}: a night watch in two shifts (${W ? W.shifts.map((sh) => `${sh.name} ${sh.from}–${sh.to}: ${sh.ids.length}`).join(", ") : "none"})`);
  const tonight = W ? W.shifts.flatMap((sh) => sh.ids) : [];
  // The first watch at 23:00 stands guard with their own job kept (s.govWatch), and at midnight counts at it in the
  // day's work. The best shot (picked first) can be the hub's standing lookout (planRoles 9), already on guard by day:
  // nothing to keep, and the lookout's job is guard (seed 42 since the bare start: no plots to tend, so the best shot is
  // free when the lookout is posted). Either way the kept job is checked on two nights (the watch rotates).
  let keptJob = 0;
  const firstWatch = (label, before) => {
    const w = h.watch;
    const fw = w ? st.survivors.find((s) => s.id === w.shifts[0].ids[0]) : null;
    const kept = fw && (fw.govWatch ? fw.govWatch.role : before(fw) === "guard" ? "guard" : null);
    check(fw && fw.role === "guard" && kept && (!fw.govWatch || kept !== "guard"), `${label} at 23:00 the first watch stands guard, their job kept (${fw && fw.name.split(" ")[0]}: ${kept}${fw && !fw.govWatch ? ", the lookout" : ""})`);
    if (fw && fw.govWatch) keptJob++;
    return { fw, kept };
  };
  const n1 = firstWatch("night 1:", (s) => dayRole.get(s.id));
  check(!surpriseAt(st, h), "so the base is not caught asleep");
  watchDayRoles(st);
  check(n1.fw && n1.fw.role === n1.kept && !n1.fw.govWatch, `at midnight they count at their own job in the day's work (${n1.fw && n1.fw.role})`);
  for (let i = 0; i < 20; i++) tickHour(st); // to 19:00 the next day
  const dayRole2 = new Map(atBase(st, h.id).map((s) => [s.id, s.role]));
  for (let i = 0; i < 4; i++) tickHour(st); // 23:00
  const next = h.watch ? h.watch.shifts.flatMap((sh) => sh.ids) : [];
  check(next.length && next.some((id) => !tonight.includes(id)), `the next night others take it (${next.filter((id) => !tonight.includes(id)).length} of ${next.length} new)`);
  const n2 = firstWatch("night 2:", (s) => dayRole2.get(s.id));
  if (n2.fw && n2.fw.govWatch) {
    watchDayRoles(st); // the next hour's planRoles puts them back on watch
    check(n2.fw.role === n2.kept && !n2.fw.govWatch, `night 2: at midnight their own job again (${n2.fw.role})`);
  }
  check(keptJob >= 1, `a watcher's own job kept and given back on at least one of the two nights (${keptJob})`);
  let peak = 0;
  for (let i = 0; i < 24 * 8; i++) { tickHour(st); for (const s of atBase(st, h.id)) peak = Math.max(peak, s.tired || 0); }
  check(peak < TIRED.TIRED, `eight days on the governor's watch: nobody Tired (most owed ${peak})`);
  const small = world(seed + 3);
  const sh = hub(small);
  setAutopilot(small, true, "balanced");
  const keep = new Set(atBase(small, sh.id).slice(0, 2).map((s) => s.id));
  small.survivors = small.survivors.filter((s) => keep.has(s.id));
  for (let i = 0; i < 3; i++) tickHour(small);
  check(!sh.watch || !sh.watch.gov, `two people at a base: no roster (${atBase(small, sh.id).length} there)`);
}


// ---------- who is at a post when the attack hits (defenceplan.js openStart) ----------
section("Watchers start on the walls: an attack on a base whose defences are not manned");
{
  const st = world(seed + 4);
  const h = armHub(st, undefined, 0);
  const ppl = atBase(st, h.id).slice(0, 6);
  for (const s of atBase(st, h.id).slice(6)) s.location = { kind: "party", partyId: 999 }; // six here: all in the fight
  for (const s of ppl) s.role = "farm";
  const [w1, w2] = ppl;
  w1.role = "guard"; w2.role = "guard";
  const R = readiness(st, h);
  check(!R.manned && R.watchers.length === 2 && R.watchers.includes(w1.id), `readiness: not manned, 2 on guard (${R.watchers.length})`);
  const b = attack(st, h, { ready: undefined });
  const late = playersOf(b).filter((u) => u.late), on = playersOf(b).filter((u) => !u.late);
  check(on.length === 2 && on.every((u) => u.sid === w1.id || u.sid === w2.id) && late.length === playersOf(b).length - 2, `only the 2 on watch at their posts, ${late.length} still inside (${on.map((u) => `${u.sid}:${u.post}`).join(" ")} / ${w1.id},${w2.id})`);
  const T = b.tier;
  check(late.every((u) => T.indoor && T.indoor[u.y * b.w + u.x]), `the rest start in the buildings (${T.map} map)`);
  check(on.some((u) => ["tower", "wall", "gate"].includes(u.post)), `a watcher is on the wall (${on.map((u) => u.post).join(", ")})`);
  check(!deployProblems(b).length, "valid cells");
  const txt = startText(st, b);
  check(txt.startsWith("Only ") && txt.includes(w1.name.split(" ")[0]) && /coming out of the buildings/.test(txt), `the deploy step says so: "${txt}"`);
  check(b.log.some((l) => l.text === txt), "and the log");
  check(combatAct(st, { type: "place", unit: late[0].id, x: on[0].x, y: on[0].y }) !== "" && late[0].late, "someone not on watch cannot be placed in the deploy step");
  check(combatAct(st, { type: "place", unit: on[0].id, x: late[0].x, y: late[0].y }) !== "", "nor swapped out of the buildings");
  combatAct(st, { type: "defaults" });
  check(late.every((u) => T.indoor[u.y * b.w + u.x]), "Default positions keeps them inside");
  combatAct(st, { type: "start" });
  check(b.phase === "player" && late.every((u) => u.ap === 0) && on.every((u) => u.ap === 2), "turn 1: the watchers act, the rest cannot");
  combatAct(st, { type: "end" });
  runEnemyPhase(st);
  const out = b.log.find((l) => /out to fight/.test(l.text));
  check(b.over || (b.turn === 2 && b.phase === "player" && late.filter((u) => active(u)).every((u) => !u.late && u.ap === 2)), `turn 2: they come out (${out ? out.text : "no line"})`);
  st.combat = null;
}
section("Nobody on watch, a manned base, the wall map, headless");
{
  const st = world(seed + 5);
  const h = armHub(st, undefined, 4);
  for (const s of atBase(st, h.id)) s.role = "farm";
  const b = attack(st, h, { ready: undefined });
  check(playersOf(b).every((u) => u.late) && /^Nobody was on watch/.test(startText(st, b)), `nobody on watch: nobody at a post ("${startText(st, b)}")`);
  combatAct(st, { type: "start" });
  check(b.phase === "enemy", `the attackers move first (turn ${b.turn}, ${b.phase})`);
  runEnemyPhase(st);
  check(b.over || (b.turn === 2 && b.phase === "player" && playersOf(b).every((u) => !u.late && u.ap === 2)), "then everyone comes out and acts");
  st.combat = null;
  h.alert = true;
  const m = attack(st, h, { ready: undefined });
  check(!playersOf(m).some((u) => u.late) && /manned/.test(startText(st, m)), `"Prepare defenses": everyone at their post ("${startText(st, m)}")`);
  st.combat = null;
  h.alert = false;
  const ppl = atBase(st, h.id);
  ppl[0].role = "guard";
  const w = attack(st, h, { ready: undefined, strip: true });
  const wl = playersOf(w).filter((u) => u.late);
  const un = sideUntf(w.deploy.side, w.deploy.frame.w0, w.deploy.frame.h0);
  check(w.tier.map === "wall" && wl.length === playersOf(w).length - 1 && wl.every((u) => { const [x] = un(u.x, u.y); return x >= PLAN.BACK[0] && x <= PLAN.BACK[1] + 3; }), `the wall map (no buildings): the rest at the back (columns ${wl.map((u) => un(u.x, u.y)[0]).join(",")})`);
  check(/from the back/.test(startText(st, w)) && !deployProblems(w).length, "valid cells, the text says so");
  st.combat = null;
  // Headless: the same start, played to the end.
  ppl[0].role = "farm";
  const hd = fightNow(st, { tile: h.tile, baseId: h.id, enemy: { kind: "zombies", count: 8, power: 2.5, name: "the horde" }, ambush: null, canRetreat: true, handler: "wp", layout: "baseDefence", deploy: true, downedLive: 0.4, context: { night: true, through: 60 } });
  check(hd === null && !st.combat, "a headless fight with nobody on watch is played to the end");
}

// ---------- several plans ----------
section("Several plans: named, tagged, picked by the attack");
{
  const st = world(seed + 6);
  const h = armHub(st);
  startDrill(st, h.id);
  let b = st.combat;
  const u = playersOf(b)[0];
  const cell0 = [u.x, u.y];
  combatAct(st, { type: "savePlan" });
  check(plansOf(h).length === 1 && plansOf(h)[0].name === "Default", "the first plan is \"Default\"");
  // A second plan, made from where everyone stands, renamed and tagged for hordes at night.
  let target = null;
  for (let y = 0; y < b.h && !target; y++) for (let x = 0; x < b.w && !target; x++) if (canPlace(b, x, y) && !unitAt(b, x, y) && Math.hypot(x - u.x, y - u.y) > 4) target = [x, y];
  combatAct(st, { type: "place", unit: u.id, x: target[0], y: target[1] });
  check(combatAct(st, { type: "newPlan", name: "Night horde" }) === "" && plansOf(h).length === 2 && currentPlan(st, b).name === "Night horde", "New plan: made from where everyone stands now, and edited");
  combatAct(st, { type: "tagPlan", who: "dead", when: "night" });
  combatAct(st, { type: "renamePlan", name: "  Horde at night  " });
  const night = plansOf(h)[1];
  check(night.name === "Horde at night" && night.who === "dead" && night.when === "night", `renamed and tagged (${night.name}: ${night.who}, ${night.when})`);
  combatAct(st, { type: "pickPlan", id: plansOf(h)[0].id });
  check(currentPlan(st, b).name === "Default" && u.x === cell0[0] && u.y === cell0[1], "the drill switches to the other plan (its posts shown)");
  endDrill(st);
  const at = (r) => playersOf(r).find((x) => x.sid === u.sid);
  const r1 = attack(st, h, { night: true });
  check(currentPlan(st, r1).name === "Horde at night" && at(r1).x === target[0] && at(r1).y === target[1], "a horde at night: the night horde plan");
  st.combat = null;
  const r2 = attack(st, h, { night: false });
  check(currentPlan(st, r2).name === "Default", "a horde by day: the default plan");
  // The deploy step's picker.
  combatAct(st, { type: "pickPlan", id: night.id });
  check(currentPlan(st, r2).name === "Horde at night" && at(r2).x === target[0], "picked by hand in the deploy step: taken up for this fight");
  combatAct(st, { type: "pickPlan", id: 0 });
  const d = r2.deploy.defaults.find(([id]) => id === at(r2).id);
  check(!currentPlan(st, r2) && at(r2).x === d[1] && at(r2).y === d[2], "no plan: the default posts");
  check(combatAct(st, { type: "newPlan", name: "x" }) !== "", "plans are made in a drill, not in a fight");
  st.combat = null;
  const r3 = attack(st, h, { night: true }, { kind: "raiders", count: 6, power: 3, name: "raiders" });
  check(currentPlan(st, r3).name === "Default", "raiders at night: not the horde plan");
  st.combat = null;
  plansOf(h)[0].who = "people";
  const r4 = attack(st, h, { night: false });
  check(!currentPlan(st, r4), "a plan tagged for another attacker is never taken up (a horde by day: defaults)");
  st.combat = null;
  // Delete in a drill, the limit, save and load, the old shape.
  startDrill(st, h.id, night.id);
  b = st.combat;
  check(currentPlan(st, b).id === night.id, "a drill opens on the plan asked for");
  combatAct(st, { type: "deletePlan" });
  check(plansOf(h).length === 1 && currentPlan(st, b).name === "Default", "deleted: the drill goes on with the other");
  endDrill(st);
  for (let i = 0; i < PLAN.MAX + 2; i++) { startDrill(st, h.id); combatAct(st, { type: "newPlan", name: `P${i}` }); endDrill(st); }
  check(plansOf(h).length === PLAN.MAX, `at most ${PLAN.MAX} plans`);
  const st2 = loadFromString(saveToString(st));
  check(plansOf(st2.bases[0]).length === PLAN.MAX, "saved and loaded");
  const hb = st2.bases[0];
  delete hb.defencePlans;
  hb.defencePlan = { fort: { w0: 1, h0: 1, posts: [[1, 0, 0]], lit: "center", day: 3 } };
  const st3 = loadFromString(saveToString(st2));
  const mig = plansOf(st3.bases[0]);
  check(mig.length === 1 && mig[0].name === "Default" && mig[0].maps.fort.day === 3 && !st3.bases[0].defencePlan, "an old save's plan (one per map) loads as \"Default\"");
}

// ---------- posts by role ----------
section("Posts by role: the best available person for the post");
{
  const st = world(seed + 7);
  const h = armHub(st, undefined, 3);
  const ppl = atBase(st, h.id).slice(0, 6);
  for (const s of atBase(st, h.id).slice(6)) s.location = { kind: "party", partyId: 999 }; // six here: all in the fight
  ppl[0].gear.weapon = newItem("huntrifle"); ppl[0].skills.shooting = 18;
  ppl[1].gear.weapon = newItem("huntrifle"); ppl[1].skills.shooting = 14;
  ppl[2].gear.weapon = newItem("machete");
  for (const s of ppl.slice(3)) { s.gear.weapon = newItem("pistol"); s.skills.shooting = Math.min(s.skills.shooting, 8); }
  startDrill(st, h.id);
  const b = st.combat;
  const best = playersOf(b).find((x) => x.sid === ppl[0].id);
  check(roleOf(best) === "shooter" && roleOf(playersOf(b).find((x) => x.sid === ppl[2].id)) === "close", "roles from the weapon: a rifle shoots, a machete fights close");
  combatAct(st, { type: "roles", by: "role" });
  const keep = playersOf(b).find((x) => x.sid === ppl[3].id);
  combatAct(st, { type: "role", unit: keep.id, role: null }); // one stays by name
  combatAct(st, { type: "savePlan" });
  const posts = plansOf(h)[0].maps[planKey(b)].posts;
  check(posts.filter((p) => p[3]).length === posts.length - 1 && posts.find((p) => p[0] === ppl[0].id)[3] === "shooter", `saved: ${posts.length - 1} posts by role, 1 by name`);
  const bestCell = [best.x, best.y];
  endDrill(st);
  ppl[0].location = { kind: "party", partyId: 999 };
  const r = attack(st, h);
  const second = playersOf(r).find((x) => x.sid === ppl[1].id);
  check(second.x === bestCell[0] && second.y === bestCell[1] && second.planRole === "shooter", `${ppl[0].name.split(" ")[0]} away: ${second.name.split(" ")[0]}, the next best shot, takes the post`);
  check(!deployProblems(r).length && r.log.some((l) => /by role/.test(l.text)), "valid, the log counts the posts by role");
  st.combat = null;
  ppl[0].location = { kind: "base", baseId: h.id };
  const r2 = attack(st, h);
  check(playersOf(r2).find((x) => x.sid === ppl[0].id).x === bestCell[0], "back again: the one who stood there keeps the post");
  const named = playersOf(r2).find((x) => x.sid === ppl[3].id);
  const np = posts.find((p) => p[0] === ppl[3].id);
  const back = r2.tier.map === "fort" ? [named.x, named.y] : sideUntf(r2.deploy.side, r2.deploy.frame.w0, r2.deploy.frame.h0)(named.x, named.y);
  check(!np[3] && Math.hypot(back[0] - np[1], back[1] - np[2]) <= PLAN.NEAR * 1.5, "the post by name keeps its person");
  st.combat = null;
}

// ---------- the governor's plan (autopilot.js governorPlans, defenceplan.js defaultRolePlan) ----------
section("The governor's plan: by role from the default posts, and not worse in its fights");
{
  const st = world(seed + 8);
  const h = armHub(st, ["bunkhouse", "storehouse", "barricades", "watchtower"], 3);
  h.buildings = h.buildings.filter((x) => x.type !== "walls");
  const rng0 = st.rng.state;
  const line = defaultRolePlan(st, h);
  const gp = plansOf(h).find((p) => p.by === "governor");
  check(line && gp && gp.maps.interior && gp.maps.interior.posts.every((p) => PLAN_ROLES[p[3]]), `no walls: a plan by role (${line})`);
  check(st.rng.state === rng0 && !st.combat, "it draws nothing from the game's dice and leaves no battle open");
  const roles = gp.maps.interior.posts.map((p) => p[3]);
  check(roles.includes("shooter"), `best shots on the perches and at the windows (${roles.join(", ")})`);
  const st2 = world(seed + 8);
  const h2 = armHub(st2);
  check(defaultRolePlan(st2, h2) === "" && !plansOf(h2).length, "a walled base (the fort map): no plan, the default posts face the attack");
  // The morning pass: once per change of the base's buildings.
  setAutopilot(st, true);
  setHour(st, 6);
  delete h.defencePlans;
  autopilotDaily(st);
  const n1 = plansOf(h).length;
  const g = st.governor.planSig[h.id];
  autopilotDaily(st);
  check(n1 === 1 && plansOf(h).length === 1 && st.governor.planSig[h.id] === g, "the governor lays it out once, and again only when the base changes");
  setAutopilot(st, false);
  // Paired fights: the same world and the same horde with the governor's plan and without, a day later (one away, a
  // newcomer), by day with the defences manned and at night with two on watch.
  const out = { with: { hp: 0, dead: 0, won: 0 }, without: { hp: 0, dead: 0, won: 0 } };
  registerCombatHandler("wpg", () => {});
  for (const sd of [11, 12, 13]) for (const night of [false, true]) for (const withPlan of [true, false]) {
    const w = world(seed + 100 + sd);
    const hb = armHub(w, ["bunkhouse", "storehouse", "barricades", "watchtower", "barricades"], 3);
    hb.buildings = hb.buildings.filter((x) => x.type !== "walls");
    if (withPlan) defaultRolePlan(w, hb);
    const ppl = atBase(w, hb.id);
    ppl[0].location = { kind: "party", partyId: 999 };
    const nu = makeSurvivor(w); nu.location = { kind: "base", baseId: hb.id }; nu.health = 100; nu.gear.weapon = newItem("huntrifle"); w.survivors.push(nu);
    for (const s of atBase(w, hb.id)) s.role = "farm";
    atBase(w, hb.id)[1].role = "guard"; atBase(w, hb.id)[2].role = "guard";
    const here = atBase(w, hb.id);
    const before = here.reduce((a, s) => a + s.health, 0);
    let result = null;
    registerCombatHandler("wpg", (state, r) => { result = r; });
    fightNow(w, { tile: hb.tile, baseId: hb.id, enemy: { kind: "zombies", count: 14, power: 3, name: "the horde" }, ambush: null, canRetreat: true, handler: "wpg", layout: "baseDefence", deploy: true, downedLive: 0.4, context: { night, through: 100, ...(night ? {} : { ready: { manned: true } }) } });
    const o = out[withPlan ? "with" : "without"];
    o.hp += before - here.reduce((a, s) => a + (s.alive ? s.health : 0), 0);
    o.dead += here.filter((s) => !s.alive).length;
    o.won += result && result.outcome === "victory" ? 1 : 0;
  }
  const txt = (o) => `${o.won}/6 won, ${o.dead} dead, ${Math.round(o.hp)} health lost`;
  check(out.with.won >= out.without.won - 1 && out.with.dead <= out.without.dead + 1, `paired fights (3 seeds × day manned / night 2 on watch): with the plan ${txt(out.with)}; without ${txt(out.without)}`);
}
console.log(`\nwatchplantest: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
