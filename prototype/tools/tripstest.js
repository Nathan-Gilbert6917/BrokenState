// Headless checks for order templates, Repeat trip and undo in the planners (sim/trips.js, ui/trips.js, ui/undo.js):
// - templates: save (the planner's setup without its target), the same name updates, rename, delete, the cap
// - applying a setup: fit people kept, stand-ins by job for the hurt, the dead and the away, the vehicle by kind,
//   "Move to a site" steps dropped for another target, supplies capped at the hub's stock and flagged, a mission that
//   cannot go there replaced, the retreat policy set on the launched team
// - a planner-sent team remembers its setup and lands in the recent trips when it gets home (the alert for a day);
//   autopilot-style launches do not
// - save and load keep the templates, the recent trips and a team's setup; a world from before them loads with none
// - undo: the planner (steps, crew, a template applied), the build queue (queue, cancel, reorder, refused once the
//   builders started, the job finished or the refund was used), the Work tab (cells, a deleted role), Ctrl+Z only on
//   those screens and never in a battle; at most UNDO_MAX steps
// - the screens: clean HTML and a handler for every data-action
// Usage: node tools/tripstest.js [seed]
import { setRounds } from "../src/sim/ammo.js"; // rounds by calibre
import { createWorld, tickHour, hub, atBase, survivorById } from "../src/sim/world.js";
import { launchExpedition, planPath, partyTile, startReturn, missionProblem, STANCES } from "../src/sim/parties.js";
import { vehiclesAtBase } from "../src/sim/vehicles.js";
import { queueBuild, cancelBuild, canBuild, BUILDINGS, constructionHour } from "../src/sim/buildings.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { workState, cellOf, roleById } from "../src/sim/work.js";
import {
  TRIPS, templates, recentTrips, saveTemplate, renameTemplate, deleteTemplate, applySpec, applyPacking, specOf, rememberLaunch, unfitWhy,
} from "../src/sim/trips.js";
import { plannerTrips, teamsTrips, tripAlerts, TRIP_ACTIONS, TRIP_CHANGE, useArmedTemplate } from "../src/ui/trips.js";
import { UNDO_ACTIONS, UNDO_MAX, installUndo, undoKey, undoCount, undoStep, undoBtn } from "../src/ui/undo.js";
import { PLAN_ACTIONS, PLAN_CHANGE, defaultPlan } from "../src/ui/plan.js";
import { WORK_ACTIONS, WORK_CHANGE } from "../src/ui/work.js";
import { readFileSync } from "node:fs";
import { helpTopics } from "../src/ui/help.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 6 });
  state.started = true;
  state.autoCombat = true;
  state.noWanderers = true;
  Object.assign(hub(state).stock, { food: 300, water: 300, fuel: 100, meds: 20, ammo: 300, parts: 30, scrap: 300 });
  for (const s of atBase(state, hub(state).id)) { s.health = 100; s.conditions = []; }
  return state;
}
// A scavenge site near the hub and another one further off.
function sites(state) {
  const h = hub(state);
  const out = [];
  for (const t of state.tiles) {
    const d = state.grid.distance(h.tile, t.id);
    if (d < 2 || d > 9 || !t.loc || t.terrain === "water" || missionProblem(state, t.id, "scavenge") || !planPath(state, h.tile, t.id, false)) continue;
    out.push(t.id);
  }
  return out.sort((a, b) => state.grid.distance(h.tile, a) - state.grid.distance(h.tile, b));
}
// A planner object as main.js makes it.
const planner = (dest, mission = "scavenge") => ({ dest, mission, crew: new Set(), vehicleId: null, stance: "normal", supplies: {} });
const autofillStub = (pl) => { pl.supplies = { food: 4, water: 4, ammo: 15, meds: 1 }; pl.tabs = false; };

// ---------- HTML checks (as uitest) ----------
const BAD = /\b(undefined|NaN|Infinity)\b|\[object [A-Za-z]+\]|\bnull\b/;
const mainSrc = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const inMain = (name) => new RegExp(`(^|[\\s{,])("${name}"|${/^[a-z]\w*$/i.test(name) ? name : "\\u0000"})\\s*:`, "m").test(mainSrc);
const CLICK = { ...TRIP_ACTIONS, ...UNDO_ACTIONS, ...PLAN_ACTIONS, ...WORK_ACTIONS };
const CHANGE = { ...TRIP_CHANGE, ...PLAN_CHANGE, ...WORK_CHANGE };
function htmlOk(html, where) {
  const text = html.replace(/<[^>]*>/g, " ");
  check(!BAD.test(text) && !/="(undefined|NaN|null)"/.test(html), `${where}: no undefined / NaN / null`);
  const missing = [];
  for (const m of html.matchAll(/<(\w+)([^>]*?)data-action="([^"]+)"([^>]*)>/g)) {
    const tag = m[1].toLowerCase(), attrs = m[2] + m[4], a = m[3];
    const isChange = tag === "select" || (tag === "input" && !/type="checkbox"/.test(attrs));
    if (!(isChange ? CHANGE[a] : CLICK[a]) && !inMain(a)) missing.push(a);
  }
  check(!missing.length, `${where}: every data-action has a handler (missing ${missing.join(", ")})`);
}

// ---------------------------------------------------------------------------------------------------------
section("Templates: save, update, rename, delete");
{
  const state = mk();
  const [near] = sites(state);
  const crew = atBase(state, hub(state).id).slice(0, 3);
  const pl = planner(near);
  for (const s of crew) pl.crew.add(s.id);
  pl.stance = Object.keys(STANCES).find((k) => k !== "normal") || "normal";
  pl.supplies = { food: 9, water: 8, ammo: 20 };
  pl.plan = { preset: "custom", steps: [{ kind: "survey" }, { kind: "move", tile: near }, { kind: "home" }], days: 1, cond: { hurt: 40, food: null, cargo: true }, add: {} };
  pl.lights = false; pl.tabs = true; pl.policy = "losing";
  const r = saveTemplate(state, pl, "  Scav   team A ");
  check(r.template && r.template.name === "Scav team A", "saved under the cleaned-up name");
  const t = r.template;
  check(t.members.length === 3 && t.members.every((m) => m.role && m.top.length === 2), "members kept by id with job and best skills");
  check(t.supplies.food === 9 && t.lights === false && t.tabs === true && t.policy === "losing" && t.stance === pl.stance, "supplies, lights, tablets, policy, stance kept");
  check(t.plan.steps.length === 3 && t.plan.cond.hurt === 40 && t.dest === near, "plan and the target it was saved at kept");
  pl.supplies.food = 12;
  const r2 = saveTemplate(state, pl, "scav team a");
  check(r2.template === t && templates(state).length === 1 && t.supplies.food === 12, "the same name (any case) updates the template");
  const r3 = saveTemplate(state, pl, "");
  check(r3.template && /team [A-Z]$/.test(r3.template.name), `no name: a default name (${r3.template && r3.template.name})`);
  check(/already/.test(renameTemplate(state, r3.template.id, "Scav team A")), "renaming to a name in use is refused");
  check(/Renamed/.test(renameTemplate(state, r3.template.id, "Long haul")) && r3.template.name === "Long haul", "rename");
  check(!saveTemplate(state, planner(near), "Empty").template, "a template needs a crew");
  check(/deleted/.test(deleteTemplate(state, r3.template.id)) && templates(state).length === 1, "delete");
  for (let i = 0; i < TRIPS.MAX_TEMPLATES + 2; i++) saveTemplate(state, pl, `T${i}`);
  check(templates(state).length === TRIPS.MAX_TEMPLATES, `at most ${TRIPS.MAX_TEMPLATES} templates`);
}

// ---------------------------------------------------------------------------------------------------------
section("Applying a setup: stand-ins, vehicle, steps, supplies, mission");
{
  const state = mk();
  const h = hub(state);
  const [near, far] = [sites(state)[0], sites(state).at(-1)];
  const people = atBase(state, h.id);
  const [a, b, c] = people;
  const pl = planner(near);
  [a, b, c].forEach((s) => pl.crew.add(s.id));
  const car = vehiclesAtBase(state, h.id).find((v) => v.type !== "bike");
  if (car) { car.condition = 100; pl.vehicleId = car.id; }
  pl.plan = { preset: "custom", steps: [{ kind: "survey" }, { kind: "move", tile: near }, { kind: "home" }], days: 1, cond: { hurt: null, food: null, cargo: false }, add: {} };
  pl.supplies = { food: 10, water: 10, ammo: 30 };
  const spec = { ...specOf(state, pl), dest: near };
  // b is hurt, c is dead: stand-ins with the same job if there is one.
  b.health = 30;
  c.alive = false;
  const spare = people.filter((s) => ![a, b, c].includes(s));
  if (spare.length) spare[spare.length - 1].role = b.role;
  check(unfitWhy(state, b).startsWith("hurt") && unfitWhy(state, c) === "dead" && unfitWhy(state, a) === "", "unfitWhy: hurt, dead, fit");
  const p2 = planner(far);
  const notes = applySpec(state, p2, spec);
  check(p2.crew.has(a.id) && !p2.crew.has(b.id) && !p2.crew.has(c.id), "the fit member kept, the hurt and the dead left out");
  check(p2.crew.size === Math.min(3, 1 + spare.length), `stand-ins found (${p2.crew.size} people)`);
  if (spare.length) check([...p2.crew].some((id) => survivorById(state, id).role === b.role && id !== a.id), "a stand-in with the hurt member's job");
  check(notes.some((n) => /stands in for/.test(n)), "the notes say who stands in");
  check(!p2.plan.steps.some((s) => s.kind === "move") && notes.some((n) => /dropped/.test(n)), "Move steps of the old target dropped (another target)");
  const p3 = planner(near);
  applySpec(state, p3, spec);
  check(p3.plan.steps.some((s) => s.kind === "move"), "the same target keeps its Move steps");
  if (car) {
    check(p2.vehicleId === car.id, "the same vehicle when it is at the hub");
    car.loc = { kind: "party", partyId: -1 };
    const p4 = planner(far);
    const n4 = applySpec(state, p4, spec);
    const other = vehiclesAtBase(state, h.id).find((v) => v.type === car.type && v.condition > 0);
    check(other ? p4.vehicleId === other.id : p4.vehicleId == null && n4.some((n) => /on foot/.test(n)), "a missing vehicle: one of its kind, else on foot (said)");
    car.loc = { kind: "base", baseId: h.id };
  }
  // Supplies capped at the hub's stock, the shortfall flagged; tablets and lights from the setup.
  setRounds(h.stock, 7); // ammo.js: 7 rounds at the hub, any calibre
  autofillStub(p2);
  const short = applyPacking(state, p2, { ...spec, tabs: true, lights: false });
  check(p2.supplies.ammo === 7 && p2.supplies.food === 10 && short.length && /ammo 7 of 30/.test(short[0]), "supplies: as saved, capped at the stock, short flagged");
  check(p2.tabs === true && p2.lights === false, "tablets and lights as saved");
  // A mission that cannot go to the target: one that can, said so.
  const p5 = planner(far);
  const n5 = applySpec(state, p5, { ...spec, mission: "outpost" });
  check(!missionProblem(state, far, p5.mission) && (p5.mission === "outpost" || n5.some((n) => /cannot go/.test(n))), `a mission that cannot go is replaced (${p5.mission})`);
}

// ---------------------------------------------------------------------------------------------------------
section("Repeat trip: a planner team remembers its setup and lands in the recent trips");
{
  const state = mk();
  const h = hub(state);
  const [near] = sites(state);
  const ids = atBase(state, h.id).slice(0, 2).map((s) => s.id);
  const pl = planner(near, "move");
  ids.forEach((id) => pl.crew.add(id));
  pl.supplies = { food: 6, water: 6 };
  pl.policy = "blood";
  const res = launchExpedition(state, { memberIds: ids, dest: near, mission: "move", stance: "normal", supplies: { ...pl.supplies } });
  check(!res.error, `launched (${res.error || "ok"})`);
  rememberLaunch(state, res.party, pl);
  const p = res.party;
  check(p.tripSpec && p.tripSpec.dest === near && p.tripSpec.members.length === 2 && p.retreatPolicy === "blood", "the team carries its setup and the retreat policy");
  const other = launchExpedition(state, { memberIds: [atBase(state, h.id)[0].id], dest: near, mission: "move", stance: "normal", supplies: { food: 2, water: 2 } }).party;
  // A save mid-trip keeps the setup.
  const st2 = deserializeState(JSON.parse(JSON.stringify(serializeState(state))));
  check(st2.parties.find((x) => x.id === p.id).tripSpec.dest === near, "save and load keep the team's setup");
  const tick = (n, until) => { for (let i = 0; i < n; i++) { state.hordes.length = 0; tickHour(state); if (state.combat) state.combat = null; for (let j = state.cards.length - 1; j >= 0; j--) if (!state.cards[j].isOrders) state.cards.splice(j, 1); if (until()) return true; } return false; };
  check(tick(60, () => partyTile(p) === near && p.phase === "waiting"), "it arrived");
  startReturn(state, p);
  if (other) startReturn(state, other);
  check(tick(80, () => !state.parties.includes(p) && (!other || !state.parties.includes(other))), "it got home");
  const rec = recentTrips(state);
  check(rec.length === 1 && rec[0].dest === near && rec[0].spec.policy === "blood", "one recent trip (the planner's team only, not the other launch)");
  const out = [];
  tripAlerts(state, out);
  check(out.length === 1 && out[0].go.act === "tr-repeat" && out[0].event, "the home alert offers Repeat trip");
  state.hour += TRIPS.HOME_HOURS;
  const out2 = [];
  tripAlerts(state, out2);
  check(!out2.length, "the alert goes after a day");
  // tr-repeat opens the planner on the target with the same people.
  const ui = { started: true };
  const api = { plan: (d) => { ui.planner = planner(Number(d.tile), d.mission); }, autofill: autofillStub };
  TRIP_ACTIONS["tr-repeat"](state, ui, { id: rec[0].id }, api);
  check(ui.planner && ui.planner.dest === near && ids.every((id) => ui.planner.crew.has(id)) && ui.planner.supplies.food === 6 && ui.planner.policy === "blood", "Repeat trip: the planner on the same target with the same people and supplies");
  // A world from before templates loads with none; the book survives save and load.
  saveTemplate(state, ui.planner, "Again");
  const st3 = deserializeState(JSON.parse(JSON.stringify(serializeState(state))));
  check(templates(st3).length === 1 && recentTrips(st3).length === 1, "save and load keep templates and recent trips");
  delete state.tripBook;
  const st4 = deserializeState(JSON.parse(JSON.stringify(serializeState(state))));
  check(templates(st4).length === 0 && recentTrips(st4).length === 0 && teamsTrips(st4, {}).includes("None yet"), "an older world loads with no templates");
  // A picked template applies to the next planner opened (main.js plan action).
  const t = templates(st3)[0];
  const ui2 = { tplArmed: t.id };
  const pl2 = planner(near);
  useArmedTemplate(st3, ui2, pl2, autofillStub);
  check(ui2.tplArmed == null && pl2.crew.size > 0 && pl2.tplNotes, "Pick target…: the next planner gets the template");
}

// ---------------------------------------------------------------------------------------------------------
section("Undo: planner, build queue, Work tab, keys");
{
  let state = mk();
  const h = hub(state);
  const [near] = sites(state);
  const ui = { started: true, planner: null, baseView: null };
  const actions = {}, change = {};
  for (const [k, fn] of Object.entries(PLAN_ACTIONS)) actions[k] = (d) => { if (!ui.planner) return; fn(state, ui, d); };
  for (const [k, fn] of Object.entries(PLAN_CHANGE)) change[k] = (el) => { if (!ui.planner) return; fn(state, ui, el); };
  actions["pl-crew"] = (d) => { const s = ui.planner.crew, id = Number(d.id); s.has(id) ? s.delete(id) : s.add(id); };
  actions["pl-launch"] = () => { ui.planner = null; };
  actions.queuebuild = (d) => { ui.baseMsg = queueBuild(state, hub(state), d.type); };
  actions.cancelbuild = (d) => { ui.baseMsg = cancelBuild(state, hub(state), Number(d.id)); };
  const api = { plan: (d) => { ui.planner = planner(Number(d.tile), d.mission); }, autofill: autofillStub };
  for (const [k, fn] of Object.entries({ ...UNDO_ACTIONS, ...TRIP_ACTIONS })) actions[k] = (d) => fn(state, ui, d, api);
  for (const [k, fn] of Object.entries(WORK_ACTIONS)) actions[k] = (d, ev) => fn(state, ui, d, ev);
  for (const [k, fn] of Object.entries({ ...WORK_CHANGE, ...TRIP_CHANGE })) change[k] = (el) => fn(state, ui, el);
  installUndo(actions, change, () => state, ui);
  // Planner.
  ui.planner = planner(near);
  const pl = ui.planner;
  pl.plan = defaultPlan("move"); // as the planner's auto-fill leaves it, with no steps
  const ids = atBase(state, h.id).slice(0, 2).map((s) => s.id);
  actions["pl-crew"]({ id: ids[0] });
  actions["pl-crew"]({ id: ids[1] });
  actions["pl-add"]({ k: "survey" });
  actions["pl-add"]({ k: "home" });
  change["pl-policy"]({ value: "most", dataset: {} });
  check(undoCount(state, ui, "plan") === 5, `five planner steps recorded (${undoCount(state, ui, "plan")})`);
  actions["pl-add"]({ k: "camp" }); // after Return home: refused, nothing changes
  check(undoCount(state, ui, "plan") === 5, "an action that changes nothing is not a step");
  actions["undo-step"]({ kind: "plan" });
  check(pl.policy == null && /Undone/.test(pl.note), "undo: the retreat policy back");
  check(undoKey(state, ui, { code: "KeyZ", ctrlKey: true }) && pl.plan.steps.length === 1, "Ctrl+Z: the last step removed");
  undoStep(state, ui, "plan"); undoStep(state, ui, "plan");
  check(pl.crew.size === 1 && pl.crew.has(ids[0]) && pl.plan.steps.length === 0, "undo: the plan steps and the second person back out");
  check(!undoKey(state, ui, { code: "KeyZ", ctrlKey: false }) && !undoKey(state, ui, { code: "KeyY", ctrlKey: true }), "only Ctrl+Z");
  for (let i = 0; i < UNDO_MAX + 5; i++) actions["pl-crew"]({ id: ids[1] });
  check(undoCount(state, ui, "plan") === UNDO_MAX, `at most ${UNDO_MAX} steps kept`);
  // A template applied is one step back.
  saveTemplate(state, pl, "Undo me");
  const before = [...pl.crew];
  pl.crew.clear();
  const n0 = undoCount(state, ui, "plan");
  actions["tpl-use"]({ id: templates(state)[0].id });
  check(undoCount(state, ui, "plan") === Math.min(UNDO_MAX, n0 + 1) && pl.crew.size === before.length, "applying a template is a step");
  undoStep(state, ui, "plan");
  check(pl.crew.size === 0, "undo: the template taken off again");
  htmlOk(plannerTrips(state, ui), "planner Templates box");
  actions["pl-launch"]();
  check(!undoKey(state, ui, { code: "KeyZ", ctrlKey: true }), "the planner closed (team sent): nothing to undo there");

  // Build queue.
  ui.baseView = { id: h.id, tab: "construction" };
  const types = Object.keys(BUILDINGS).filter((k) => canBuild(state, h, k).ok);
  check(types.length >= 2, `two things to build (${types.length})`);
  const stock0 = { ...h.stock };
  actions.queuebuild({ base: h.id, type: types[0] });
  actions.queuebuild({ base: h.id, type: types[1] });
  check(h.construction.length === 2 && undoCount(state, ui, "build", h.id) === 2, "two jobs queued, two steps");
  const [j0, j1] = h.construction;
  actions["bq-move"]({ base: h.id, i: 1, dir: -1 });
  check(h.construction[0] === j1 && undoCount(state, ui, "build", h.id) === 3, "reorder ▲");
  undoKey(state, ui, { code: "KeyZ", ctrlKey: true });
  check(h.construction[0] === j0, "Ctrl+Z on the Construction tab: the order back");
  actions.cancelbuild({ base: h.id, id: j0.id });
  check(h.construction.length === 1, "cancelled");
  undoStep(state, ui, "build", h.id);
  check(h.construction.length === 2 && h.construction[0] === j0, "undo: the cancelled job back in its place");
  undoStep(state, ui, "build", h.id); undoStep(state, ui, "build", h.id);
  check(!h.construction.length && Object.keys(stock0).every((k) => h.stock[k] === stock0[k]), "undo both: queue empty, every material back");
  // Refused once the builders started on it; stale once a job finished.
  actions.queuebuild({ base: h.id, type: types[0] });
  h.construction[0].progress = 1;
  const msg = undoStep(state, ui, "build", h.id);
  check(/started/.test(msg) && h.construction.length === 1, "undo refused: the builders started on it");
  h.construction[0].progress = h.construction[0].hours;
  const builder = atBase(state, h.id)[0]; builder.role = "build";
  constructionHour(state);
  check(!h.construction.length, "the job finished");
  check(/moved on/.test(undoStep(state, ui, "build", h.id)) && undoCount(state, ui, "build", h.id) === 0, "a finished build is past undoing");
  // A refund that has been used since.
  actions.queuebuild({ base: h.id, type: types[0] });
  const jc = h.construction[0];
  actions.cancelbuild({ base: h.id, id: jc.id });
  const paid = Object.keys(BUILDINGS[types[0]].cost)[0];
  h.stock[paid] = 0;
  check(/used since/.test(undoStep(state, ui, "build", h.id)), "undo refused: the refund was used");
  htmlOk(undoBtn(state, ui, "build", h.id), "build undo button");

  // Work tab.
  ui.baseView = { id: h.id, tab: "work" };
  workState(state);
  const s = atBase(state, h.id)[0];
  const gen = state.work.roles[0];
  s.work = { role: gen.id, over: {} };
  const k = "farm" in (gen.pri || {}) ? "farm" : Object.keys(gen.pri)[0];
  const p0 = cellOf(state, s, k).p;
  actions.wc({ id: s.id, k }, { button: 0 });
  check(cellOf(state, s, k).p !== p0 && undoCount(state, ui, "work") === 1, "a Work tab cell click is a step");
  undoKey(state, ui, { code: "KeyZ", ctrlKey: true });
  check(cellOf(state, s, k).p === p0, "Ctrl+Z on the Work tab: the cell back");
  const roleId = gen.id, members = state.survivors.filter((x) => x.work && x.work.role === roleId).map((x) => x.id);
  actions["wrole-del"]({ role: roleId, ok: "1" }); // ok: the confirmation box answered Yes (ui/confirm.js)
  check(!roleById(state, roleId), "role deleted");
  undoStep(state, ui, "work");
  check(roleById(state, roleId) && members.every((id) => survivorById(state, id).work.role === roleId), "undo: the role and its members back");
  // Not in a battle; not on other screens.
  state.combat = { fake: true };
  check(!undoKey(state, ui, { code: "KeyZ", ctrlKey: true }), "Ctrl+Z does nothing in a battle");
  state.combat = null;
  ui.baseView = { id: h.id, tab: "overview" };
  check(!undoKey(state, ui, { code: "KeyZ", ctrlKey: true }), "Ctrl+Z does nothing on other screens");
  // A new world starts with no steps.
  const old = state;
  state = mk(SEED + 1);
  check(undoCount(state, ui, "work") === 0 && undoCount(old, ui, "work") >= 0, "each world keeps its own steps");
  htmlOk(teamsTrips(old, ui), "Teams tab: templates");
}

// The hooks are in place (main.js, parties.js, ui.js, work.js, alerts.js).
section("Hooks");
{
  const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
  check(/rememberLaunch\(state, res\.party, pl\)/.test(mainSrc) && /installUndo\(actions, changeActions/.test(mainSrc) && /undoKey\(state, ui, e\)/.test(mainSrc) && /useArmedTemplate\(/.test(mainSrc), "main.js: launch, undo wrappers, Ctrl+Z, picked template");
  check(/noteTripHome\(state, p\)/.test(src("sim/parties.js")), "parties.js: a team home goes to the recent trips");
  check(/plannerTrips\(state, ui\)/.test(src("ui/ui.js")) && /teamsTrips\(state, ui\)/.test(src("ui/ui.js")) && /undoBtn\(state, ui, "build"/.test(src("ui/ui.js")), "ui.js: planner box, Teams tab lists, build undo");
  check(/undoBtn\(state, ui, "work"\)/.test(src("ui/work.js")) && /tripAlerts/.test(src("ui/alerts.js")), "work.js undo button, alerts.js trip alert");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  check(/Ctrl\+Z/.test(readme) && /Repeat trip/.test(readme) && /template/i.test(readme), "README: templates, Repeat trip, Ctrl+Z");
  const topics = helpTopics();
  const ti = topics.findIndex((t) => t.id === "templates-repeat-trip-and-undo");
  check(ti > 0 && /Ctrl\+Z/.test(topics[ti].html) && /Repeat trip/.test(topics[ti].html) && topics[ti - 1].id === "sending-a-team", "Help: a topic on templates, Repeat trip and undo, after Sending a team");
}

console.log(`\n${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
