// The watch roster (src/sim/watch.js) and the defence plan (src/sim/defenceplan.js).
// Checks: presets and editing, people on work priorities and Manual people standing their watch (and back to their
// job after it, and at midnight), the hurt and the away left off, coverage and gaps, the watch in the walls' hold
// limit; the defence drill (the base's battle map, nobody to fight, nothing starts), saving a plan, the plan taken up
// at the deploy step of a real attack (on the fort map and on a map turned to face the attack), changed there and
// saved back, a map that changed (the plan is not used), headless battles, saving and loading.
// Usage: node tools/watchplantest.js [seed]
import { createWorld, hub, atBase, makeSurvivor, hourOfDay } from "../src/sim/world.js";
import { tickHour } from "../src/sim/world.js";
import { createBattle, combatAct, autoPlayerTurn, registerCombatHandler, active, unitAt } from "../src/sim/combat.js";
import { addBuilding } from "../src/sim/buildings.js";
import { deployProblems, canPlace, sideUntf } from "../src/sim/deploy.js";
import { guardHold } from "../src/sim/defences.js";
import { workState, assignRole, planBase } from "../src/sim/work.js";
import { WATCH_PRESETS, setWatchPreset, toggleWatch, fillWatch, watchCoverage, watchHour, watchDayRoles, onWatchNow, watchLine, addShift, setShiftHours, removeShift } from "../src/sim/watch.js";
import { startDrill, endDrill, savePlan, applyPlan, planFor, planKey, planStale, clearPlan } from "../src/sim/defenceplan.js";
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
function attack(st, h, context = {}) {
  globalThis.window = {};
  try {
    st.combat = createBattle(st, { tile: h.tile, baseId: h.id, enemy: { kind: "zombies", count: 10, power: 3, name: "the horde" }, ambush: null, canRetreat: true, handler: "wp", layout: "baseDefence", deploy: true, downedLive: 0.4, context: { night: false, ...context } });
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
  check(combatAct(st, { type: "savePlan" }) === "" && h.defencePlan && h.defencePlan[planKey(b)], "Save as plan");
  planned = { sid: u.sid, key: planKey(b), cell: target.slice(), n: playersOf(b).length };
  check(h.defencePlan[planned.key].posts.length === planned.n, `everyone in the plan (${planned.n})`);
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
  const same = others.filter((x) => { const p = h.defencePlan[planned.key].posts.find((q) => q[0] === x.sid); const c = mapped(x); return p && p[1] === c[0] && p[2] === c[1]; }).length;
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
  const p = h.defencePlan.interior.posts.find((q) => q[0] === ru.sid);
  const want = sideUntf("north", r.deploy.frame.w0, r.deploy.frame.h0)(t2[0], t2[1]);
  check(p[1] === want[0] && p[2] === want[1], "changed in the deploy step, saved back as the plan (on the east-facing layout)");
  st.combat = null;
  // The base grows a wall: a new map, the plan is not used.
  addBuilding(h, "walls");
  const r2 = attack(st, h);
  check(planKey(r2) !== "interior" || planStale(st, r2) || !planFor(st, r2), `walls built: another map (${r2.tier.map}), the yard plan is not used for it`);
  st.combat = null;
  clearPlan(st, h);
  check(!h.defencePlan, "cleared");
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
  check(st2.combat && st2.combat.drill && st2.bases[0].watch && st2.bases[0].watch.shifts.length === 4 && st2.bases[0].defencePlan, "saved and loaded mid-drill: the drill, the roster and the plan");
  endDrill(st);
  // A battle without the browser (the autopilot, headless): createBattle with no deploy step lays the plan too.
  const r = createBattle(st, { tile: h.tile, baseId: h.id, enemy: { kind: "zombies", count: 8, power: 3 }, ambush: null, canRetreat: true, handler: "wp", layout: "baseDefence", context: { night: false } });
  st.combat = r;
  const ru = playersOf(r).find((x) => x.sid === u.sid);
  const back = r.tier.map === "fort" ? [ru.x, ru.y] : sideUntf(r.deploy.side, r.deploy.frame.w0, r.deploy.frame.h0)(ru.x, ru.y);
  check(back[0] === target[0] && back[1] === target[1] && r.phase !== "deploy", "an auto-played battle starts from the plan too");
  st.combat = null;
  void applyPlan; void savePlan;
}

console.log(`\nwatchplantest: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
