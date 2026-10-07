// Undo in the planners: one step back at a time (the ↶ Undo button, or Ctrl+Z while that screen is open), up to
// UNDO_MAX steps, in three places:
//   - the trip planner: crew, vehicle, stance, mission, supplies, tablets and lights, retreat policy, plan steps and
//     conditions, a template applied (one stack per planner: it goes when the planner closes);
//   - a base's build queue (Construction tab): queueing, cancelling and reordering jobs, barrel upgrades;
//   - the Work tab: priorities, roles, schedules, minimums, crews' settings, who is in which role.
// Each step keeps a copy of just the structure it edits (the planner's fields; the base's job list and the stock it
// paid or got back; the work roles and people's work settings), taken around the click by installUndo's wrappers.
// What the sim has already acted on is never undone: a launched team is gone from the planner, and a build step is
// refused once its job finished, the builders started on a job it would take back, or the materials it would take
// back are used. Not in battles (state.combat: the battle keys come first, and Ironman counts on that).
// The stacks are kept per world (a load or a new game starts with none) and are not saved.
import { baseById, survivorById } from "../sim/world.js";
import { BUILDINGS, assignStations } from "../sim/buildings.js";
import { planBase } from "../sim/work.js";
import { keyAction } from "./keymap.js"; // the key table (Menu → Controls)

export const UNDO_MAX = 20;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What each wrapped action is called on the button's tooltip ("Undo: crew").
const LABELS = {
  "pl-crew": "crew", "pl-vehicle": "transport", "pl-stance": "stance", "pl-mission": "mission", "pl-supply": "supplies",
  "pl-autofill": "auto-fill", "pl-tabs": "tablets", "pl-lights": "lights", "pl-policy": "retreat policy",
  "pl-preset": "plan preset", "pl-step": "plan step", "pl-add": "added step", "pl-addmove": "added move", "pl-cond": "condition",
  "pl-condv": "condition", "pl-days": "days", "pl-addv": "step setting", "pl-sweep-r": "survey radius", "pl-sweep-h": "survey hours",
  "tpl-use": "template", queuebuild: "queued build", cancelbuild: "cancelled build", "barrel-up": "barrel upgrade", "bq-move": "queue order",
  wc: "priority", wrc: "role priority", wfc: "field priority", wsched: "schedule", wreset: "reset to role", weveryone: "everyone on priorities",
  "wrole-new": "new role", "wrole-new-crew": "new crew", "wrole-dup": "duplicated role", "wrole-del": "deleted role", "wcrew-pause": "crew pause",
  "wcrew-all": "handle everything", "wcrew-cargo": "cargo rule", wnew: "newcomers", "wrole-name": "role name", wmin: "minimum",
  "wsched-preset": "schedule preset", "wcrew-set": "crew setting", role: "role", key: "priority",
};
const BUILD_KEYS = new Set(["queuebuild", "cancelbuild", "barrel-up", "bq-move"]);
const WORK_KEYS = new Set(["wc", "wrc", "wfc", "wsched", "wreset", "weveryone", "wrole-new", "wrole-new-crew", "wrole-dup", "wrole-del", "wcrew-pause", "wcrew-all", "wcrew-cargo", "wnew", "wrole-name", "wmin", "wsched-preset", "wcrew-set"]);
const PLAN_SKIP = new Set(["pl-launch", "pl-cancel"]); // sending the team is final; cancelling closes the planner

// ---------- the stacks ----------
const planStacks = new WeakMap(); // planner object → steps
const worldStacks = new WeakMap(); // state → { work: steps, build: Map baseId → steps }
function stack(state, ui, kind, baseId) {
  if (kind === "plan") {
    const pl = ui.planner;
    if (!pl) return null;
    if (!planStacks.has(pl)) planStacks.set(pl, []);
    return planStacks.get(pl);
  }
  if (!worldStacks.has(state)) worldStacks.set(state, { work: [], build: new Map() });
  const w = worldStacks.get(state);
  if (kind === "work") return w.work;
  if (!baseById(state, baseId)) return null;
  if (!w.build.has(baseId)) w.build.set(baseId, []);
  return w.build.get(baseId);
}
const push = (st, step) => { st.push(step); if (st.length > UNDO_MAX) st.shift(); };
export const undoCount = (state, ui, kind, baseId = null) => { const st = stack(state, ui, kind, baseId); return st ? st.length : 0; };

// ---------- snapshots ----------
function snapPlanner(pl) {
  return { mission: pl.mission, stance: pl.stance, crew: [...pl.crew], vehicleId: pl.vehicleId ?? null, supplies: { ...pl.supplies }, plan: clone(pl.plan) ?? null, sweep: clone(pl.sweep) ?? null, tabs: !!pl.tabs, lights: pl.lights !== false, policy: pl.policy ?? null, tplNotes: clone(pl.tplNotes) ?? null };
}
function restorePlanner(pl, s) {
  Object.assign(pl, { mission: s.mission, stance: s.stance, crew: new Set(s.crew), vehicleId: s.vehicleId, supplies: { ...s.supplies }, plan: clone(s.plan) || undefined, sweep: clone(s.sweep) || undefined, tabs: s.tabs, lights: s.lights, policy: s.policy, tplNotes: clone(s.tplNotes) });
  if (!pl.plan) delete pl.plan;
  if (!pl.sweep) delete pl.sweep;
  if (!pl.tplNotes) delete pl.tplNotes; // what a template changed (ui/trips.js)
}

function snapBuild(base) {
  return { jobs: base.construction.slice(), ids: base.construction.map((j) => j.id), prog: Object.fromEntries(base.construction.map((j) => [j.id, j.progress])), stock: { ...base.stock } };
}

// A crew's own record of its trips is not a setting: it stays as it is.
const RUNTIME = ["out", "log", "lastTrip", "lastTrade", "status"];
function roleSettings(r) {
  const { crew, ...rest } = r;
  const c = clone(rest);
  if (crew) { c.crew = {}; for (const [k, v] of Object.entries(crew)) if (!RUNTIME.includes(k)) c.crew[k] = clone(v); }
  return c;
}
function snapWork(state) {
  const w = state.work;
  return {
    has: !!w, next: w ? w.next : 1, newcomers: w ? w.newcomers ?? null : null, roles: w ? w.roles.map(roleSettings) : [],
    people: state.survivors.filter((s) => s.alive).map((s) => [s.id, s.work ? clone(s.work) : null, s.role]),
  };
}

// ---------- recording ----------
// Runs fn (an action) and keeps a step if it changed what the screen edits. Returns what fn returns.
export function undoable(state, ui, kind, fn, baseId = null, label = "") {
  const st = state && stack(state, ui, kind, baseId);
  if (!st || state.combat) return fn();
  const base = kind === "build" ? baseById(state, baseId) : null;
  const pl = kind === "plan" ? ui.planner : null;
  if (pl) pl.note = ""; // the last undo's message goes with the next change
  const before = kind === "plan" ? snapPlanner(pl) : kind === "build" ? snapBuild(base) : snapWork(state);
  const r = fn();
  if (kind === "plan") {
    if (ui.planner === pl && !same(before, snapPlanner(pl))) push(st, { label, before });
  } else if (kind === "build") {
    const after = snapBuild(base);
    const delta = {};
    for (const k of new Set([...Object.keys(before.stock), ...Object.keys(after.stock)])) {
      const d = (after.stock[k] || 0) - (before.stock[k] || 0);
      if (d) delta[k] = d;
    }
    if (!same(before.ids, after.ids) || Object.keys(delta).length) push(st, { label, before: before.jobs, afterIds: after.ids, afterProg: after.prog, delta });
  } else if (!same(before, snapWork(state))) push(st, { label, before });
  return r;
}

// ---------- undoing ----------
function undoBuild(state, base, step) {
  const ids = base.construction.map((j) => j.id);
  if (!same(ids, step.afterIds)) return { stale: true, msg: "The build queue has moved on since (a job finished or changed): nothing older to undo." };
  const back = step.before.map((j) => j.id);
  const started = base.construction.find((j) => !back.includes(j.id) && j.progress > (step.afterProg[j.id] || 0));
  if (started) return { msg: `The builders have started on ${BUILDINGS[started.type]?.name || "that job"}: cancel it instead.` };
  const used = Object.entries(step.delta).filter(([k, d]) => d > 0 && (base.stock[k] || 0) < d).map(([k]) => k);
  if (used.length) return { msg: `The ${used.join(", ")} it gave back has been used since: cannot undo that.` };
  for (const [k, d] of Object.entries(step.delta)) base.stock[k] = (base.stock[k] || 0) - d;
  base.construction.splice(0, base.construction.length, ...step.before);
  return { ok: true };
}

function undoWork(state, snap) {
  const w = state.work;
  const cur = new Map((w ? w.roles : []).map((r) => [r.id, r]));
  const busy = [...cur.values()].find((r) => r.crew && r.crew.out && !snap.roles.some((x) => x.id === r.id));
  if (busy) return { msg: `${busy.name} has a team out: that is past undoing.` };
  if (!snap.has) state.work = null;
  else {
    const ww = w || (state.work = { roles: [], next: snap.next, newcomers: null });
    ww.roles = snap.roles.map((sr) => {
      const r = cur.get(sr.id);
      const fresh = clone(sr);
      if (!r) { if (fresh.crew) Object.assign(fresh.crew, { out: null, log: [], lastTrip: -99 }); return fresh; }
      const rt = {};
      if (r.crew) for (const k of RUNTIME) if (k in r.crew) rt[k] = r.crew[k];
      for (const k of Object.keys(r)) delete r[k];
      Object.assign(r, fresh);
      if (r.crew) Object.assign(r.crew, { out: null, log: [], lastTrip: -99 }, rt);
      return r;
    });
    ww.next = Math.max(ww.next || 1, snap.next || 1);
    ww.newcomers = snap.newcomers;
  }
  for (const [id, work, role] of snap.people) {
    const s = survivorById(state, id);
    if (!s || !s.alive || (same(s.work || null, work) && s.role === role)) continue;
    if (work) s.work = clone(work); else delete s.work;
    s.role = role;
    s.task = null;
  }
  for (const b of state.bases) { planBase(state, b); assignStations(state, b); }
  return { ok: true };
}

// One step back on a screen. Returns the message to show.
export function undoStep(state, ui, kind, baseId = null) {
  if (state.combat) return "";
  const st = stack(state, ui, kind, baseId);
  if (!st || !st.length) return "Nothing to undo.";
  const step = st[st.length - 1];
  let res;
  if (kind === "plan") { restorePlanner(ui.planner, step.before); ui.plannerError = ""; res = { ok: true }; }
  else if (kind === "build") res = undoBuild(state, baseById(state, baseId), step);
  else res = undoWork(state, step.before);
  if (res.ok) { st.pop(); return `Undone: ${step.label || "last change"}.`; }
  if (res.stale) st.length = 0;
  return res.msg;
}

// Where an undo goes: the planner, else the base screen's Work or Construction tab (null elsewhere and in battles).
export function undoScreen(state, ui) {
  if (!state || state.combat) return null;
  if (ui.planner) return { kind: "plan", baseId: null };
  const bv = ui.baseView;
  if (bv && bv.tab === "work") return { kind: "work", baseId: null };
  if (bv && bv.tab === "construction" && baseById(state, bv.id)) return { kind: "build", baseId: bv.id };
  return null;
}
// The message goes where the screen shows its messages.
function say(ui, kind, msg) {
  if (!msg) return;
  if (kind === "plan") { if (ui.planner) ui.planner.note = msg; } // shown in the planner's Templates box (ui/trips.js)
  else if (kind === "build") ui.baseMsg = msg;
  else (ui.work || (ui.work = { filter: "all", edit: null, msg: "" })).msg = msg;
}
// Ctrl+Z (main.js keydown, after the battle keys). Returns true when it was used.
export function undoKey(state, ui, e) {
  if (keyAction(e, "edit") !== "edit.undo") return false; // Ctrl+Z (or Cmd+Z) by default: ui/keymap.js, Menu → Controls
  const scr = undoScreen(state, ui);
  if (!scr) return false;
  say(ui, scr.kind, undoStep(state, ui, scr.kind, scr.baseId));
  return true;
}

// The ↶ Undo button for a screen.
export function undoBtn(state, ui, kind, baseId = null) {
  const st = state ? stack(state, ui, kind, baseId) : null;
  const n = st ? st.length : 0;
  const last = n ? st[n - 1].label : "";
  return `<button class="mini" data-action="undo-step" data-kind="${kind}"${baseId != null ? ` data-base="${baseId}"` : ""} ${n ? "" : "disabled"}${tip(n ? `Undo the last change (${last || "last change"}; Ctrl+Z). ${n} step${n === 1 ? "" : "s"} back kept, up to ${UNDO_MAX}.` : "Nothing to undo yet (Ctrl+Z undoes the last change on this screen).")}>↶ Undo${n ? ` (${n})` : ""}</button>`;
}
// ▲ ▼ on a job in the build queue (ui.js Construction tab). The first job is the one being built; work done on a job
// stays with it when it moves.
export function buildMoveBtns(b, i) {
  const n = b.construction.length;
  if (n < 2) return "";
  return `<span class="bqmove"><button class="mini" data-action="bq-move" data-base="${b.id}" data-i="${i}" data-dir="-1" ${i ? "" : "disabled"}${tip("Earlier in the queue: the first job is the one the builders work on (work already done on a job stays with it)")}>▲</button><button class="mini" data-action="bq-move" data-base="${b.id}" data-i="${i}" data-dir="1" ${i < n - 1 ? "" : "disabled"}${tip("Later in the queue")}>▼</button></span>`;
}
export function moveBuild(state, base, i, dir) {
  const q = base ? base.construction : [];
  const j = i + dir;
  if (!(i >= 0 && i < q.length && j >= 0 && j < q.length)) return "";
  [q[i], q[j]] = [q[j], q[i]];
  return `${BUILDINGS[q[j].type]?.name || "The job"} moved ${dir < 0 ? "up" : "down"} the queue${j === 0 ? ": the builders work on it now" : ""}.`;
}

export const UNDO_ACTIONS = {
  "undo-step": (state, ui, d) => { const kind = d.kind; say(ui, kind, undoStep(state, ui, kind, d.base != null ? Number(d.base) : null)); },
  "bq-move": (state, ui, d) => { const msg = moveBuild(state, baseById(state, Number(d.base)), Number(d.i), Number(d.dir)); if (msg) ui.baseMsg = msg; },
};

// Wraps main.js's action tables (clicks and changes) so the screens' edits are recorded. Call it once every action
// is registered. getState: the live world (main.js replaces it on a load).
export function installUndo(actions, changeActions, getState, ui) {
  const kindOf = (k) => (BUILD_KEYS.has(k) ? "build" : WORK_KEYS.has(k) ? "work" : (k.startsWith("pl-") && !PLAN_SKIP.has(k)) || k === "tpl-use" ? "plan" : null);
  for (const table of [actions, changeActions]) {
    for (const [k, fn] of Object.entries(table)) {
      const kind = kindOf(k);
      if (kind === "plan") table[k] = (x, ev) => (ui.planner ? undoable(getState(), ui, "plan", () => fn(x, ev), null, LABELS[k]) : fn(x, ev));
      else if (kind === "build") table[k] = (d, ev) => undoable(getState(), ui, "build", () => fn(d, ev), Number(d && d.base), LABELS[k]);
      else if (kind === "work") table[k] = (x, ev) => undoable(getState(), ui, "work", () => fn(x, ev), null, LABELS[k]);
    }
  }
  // The role drop-down is on other screens too (base overview, roster): recorded on the Work tab only.
  const role = changeActions.role;
  if (role) changeActions.role = (el) => (ui.baseView && ui.baseView.tab === "work" ? undoable(getState(), ui, "work", () => role(el), null, LABELS.role) : role(el));
}
export const UNDO_LABELS = LABELS;
