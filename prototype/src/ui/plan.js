// The trip planner's PLAN section: presets, editable steps, "If … then come home" conditions, and the estimate
// for the whole plan (sim/plans.js). main.js keeps the planner state in ui.planner and merges PLAN_ACTIONS (clicks)
// and PLAN_CHANGE (inputs and selects) into its dispatchers.
import { MISSIONS, tileLabel, STAY_MISSIONS } from "../sim/parties.js";
import { PRESETS, STEP_KINDS, CONDITIONS, estimatePlan, stepLabel, nearbySites, knownLoot } from "../sim/plans.js";
import { activeCrashes } from "../sim/crashes.js";
import { heatPreview } from "../sim/fieldheat.js";
import { jobTargets } from "./diplomacy.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const hrs = (h) => (h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`);
const MAX_STEPS = 10;

// The plan a fresh planner starts with: missions that go somewhere and come back get "return home" after them.
export function defaultPlan(mission) {
  const back = !STAY_MISSIONS.includes(mission) || mission === "recon";
  const preset = mission === "recon" ? "recon" : mission === "scavenge" ? "scavenge" : "custom";
  return { preset, steps: back ? [{ kind: "home" }] : [], days: 1, cond: { hurt: null, food: null, cargo: false }, add: { camp: 24, wait: 6, radius: 3, count: 2, move: null } };
}
const ensure = (pl) => (pl.plan = pl.plan || defaultPlan(pl.mission));

// Estimate for the whole plan (null without a route). ids/v: the planner's crew and vehicle.
export function planEstimate(state, pl) {
  const plan = ensure(pl);
  const v0 = pl.vehicleId ? state.vehicles.find((x) => x.id === pl.vehicleId) : null;
  const v = v0 && v0.type === "bike" ? { ...v0, count: Math.max(1, pl.crew.size || 0) } : v0; // one bike each
  return estimatePlan(state, {
    memberIds: [...pl.crew].length ? [...pl.crew] : [0], dest: pl.dest, vehicle: !v ? false : v.type === "bike" ? "bike" : true, v, stance: pl.stance,
    fuel: v && v.type !== "bike" ? v.fuel + (pl.supplies.fuel || 0) : 0, mission: pl.mission, steps: plan.steps, supplies: pl.supplies,
  });
}
// For main.js autofill: the plan's needs when it has steps, else null (the plain round-trip estimate is used).
export const planAutofill = (state, pl) => (ensure(pl).steps.length ? planEstimate(state, pl) : null);
export const planLaunchOpts = (pl) => {
  const plan = ensure(pl);
  return { preset: plan.preset, steps: plan.steps.map((s) => ({ ...s })), conditions: { ...plan.cond } };
};

// Known sites near the plan's target for "Move to a site" (closest first).
function moveTargets(state, pl) {
  // Jobs you took (ui/diplomacy.js) come first: their targets, wherever they are.
  const jobs = jobTargets(state).filter((t) => t.tile !== pl.dest).map((t) => ({ ...t, dist: state.grid.distance(pl.dest, t.tile) }));
  return [...jobs, ...nearbySites(state, { center: pl.dest, radius: 6 }).filter((s) => s.tile !== pl.dest && !jobs.some((j) => j.tile === s.tile)).sort((a, b) => a.dist - b.dist).slice(0, 12)];
}

// Heat look-ahead for the camp and wait steps at the target (where the plan is when they start, if known).
function heatNote(state, pl, est) {
  const plan = ensure(pl);
  const notes = [];
  let tile = pl.dest, known = true;
  for (const s of plan.steps) {
    if (s.kind === "nearby") known = false;
    if (s.kind === "move" && s.tile != null) { tile = s.tile; known = true; }
    if ((s.kind === "camp" || s.kind === "wait") && known) {
      const fake = { owner: "player", members: [...pl.crew], path: [tile], idx: 0, stance: pl.stance, heat: 0 };
      const leg = est && est.legs.find((l) => l.label === stepLabel(state, s));
      const pv = heatPreview(state, fake, s.kind, s.hours || 24, leg ? leg.start : state.hour);
      notes.push(`${stepLabel(state, s)} at ${tileLabel(state, tile)} (${pv.word}): Heat reaches ~${Math.round(pv.heat)}, about ${Math.round(pv.risk * 100)}% chance of trouble.`);
    }
  }
  return notes;
}

export function planSection(state, pl, est) {
  const plan = ensure(pl);
  const preset = PRESETS[plan.preset] || PRESETS.custom;
  const presetBtn = (k) => {
    const pr = PRESETS[k];
    const label = k === "camp" ? `Camp ${plan.days} day${plan.days === 1 ? "" : "s"}, then return` : pr.name;
    return `<button class="mini ${plan.preset === k ? "active" : ""}" data-action="pl-preset" data-v="${k}"${tip(pr.desc)}>${esc(label)}</button>`;
  };
  const legs = est ? est.legs : [];
  const first = legs[0] ? `${legs[0].hours}h` : "no route";
  const steps = plan.steps.map((s, i) => `<li><span>${esc(stepLabel(state, s))}${s.kind === "camp" || s.kind === "wait" ? ` <span class="muted">~${hrs(s.hours)}</span>` : s.kind === "survey" ? ` <span class="muted">~2h</span>` : s.kind === "scavenge" ? ` <span class="muted">~6h</span>` : ""}</span>
      <button class="mini" data-action="pl-step" data-op="up" data-i="${i}" ${i ? "" : "disabled"}${tip("Earlier")}>▲</button><button class="mini" data-action="pl-step" data-op="down" data-i="${i}" ${i < plan.steps.length - 1 ? "" : "disabled"}${tip("Later")}>▼</button><button class="mini" data-action="pl-step" data-op="del" data-i="${i}"${tip("Remove this step")}>✕</button></li>`).join("");
  const add = plan.add;
  const full = plan.steps.length >= MAX_STEPS || plan.steps.some((s) => s.kind === "home");
  const addBtn = (kind, label, extra = "") => `<button class="mini" data-action="pl-add" data-k="${kind}"${extra} ${full ? "disabled" : ""}${tip(full ? (plan.steps.some((s) => s.kind === "home") ? "Nothing runs after Return home: remove it first, add, then add it back." : "That is enough steps.") : STEP_KINDS[kind].desc)}>${label}</button>`;
  const num = (k, val, min, max, step = 1) => `<input type="number" class="tiny" style="width:3.6rem" data-action="pl-addv" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}">`;
  const targets = moveTargets(state, pl);
  const cond = plan.cond;
  const condRow = (k) => {
    const d = CONDITIONS[k];
    const on = k === "cargo" ? !!cond.cargo : cond[k] != null;
    return `<label class="small"${tip(`Checked hourly while the plan runs: the team turns for home by itself and reports why (a card lets you undo it).`)}><input type="checkbox" data-action="pl-cond" data-k="${k}" ${on ? "checked" : ""}> ${d.label}${k === "cargo" ? "" : ` <input type="number" class="tiny" style="width:3.6rem" data-action="pl-condv" data-k="${k}" min="${d.min}" max="${d.max}" step="${d.step}" value="${cond[k] ?? d.def}"> ${d.unit}`}</label>`;
  };
  const whole = est ? `<div class="small" style="margin-top:0.35rem"${tip("Every leg stepped hour by hour like the real trip (weather included); searches count 6 hours, Look around 2. Food and water: one each per person per day for the whole plan, plus the way home if the plan does not end there.")}>Whole plan: <b>~${(est.total / 24).toFixed(1)} days</b> (${est.hours}h${est.backHours ? ` + ${est.backHours}h home` : ""}) · needs ${est.food} food · ${est.water} water${est.fuel ? ` · ${est.fuel} fuel` : ""}${est.returns ? "" : ` · <span class="warn">${est.open ? "a step has no route" : "ends away from home: it waits for orders there"}</span>`}</div>` : "";
  const notes = est ? heatNote(state, pl, est) : [];
  return `<h3${tip("What the team does after reaching the target, in order. Out of radio contact the team follows this plan; it reports in with a card on important finds (a horde in sight, a rich site, supplies running short) and when the plan ends. In radio range you can change its orders any time.")}>Plan</h3>
    <div class="row" style="flex-wrap:wrap;gap:0.3rem">${["recon", "scavenge", "explore", "camp", "custom"].map(presetBtn).join("")}
      <span class="small muted">days <input type="number" class="tiny" style="width:3.2rem" data-action="pl-days" min="1" max="10" value="${plan.days}"></span></div>
    <div class="small muted" style="margin:0.2rem 0">${esc(preset.desc)}</div>
    <ol class="xpqueue small">
      <li><span>${esc(`Travel to ${tileLabel(state, pl.dest)}: ${MISSIONS[pl.mission]?.name || pl.mission}`)} <span class="muted">~${first}</span></span></li>
      ${steps}
      ${plan.steps.some((s) => s.kind === "home") ? "" : `<li><span class="muted">Then wait there for orders</span></li>`}
    </ol>
    <div class="row small" style="flex-wrap:wrap;gap:0.3rem">Add:
      ${addBtn("survey", "Look around")}${addBtn("scavenge", "Scavenge here")}
      ${addBtn("nearby", `Scavenge nearby (${add.count} within ${add.radius})`)} ×${num("count", add.count, 1, 4)} r${num("radius", add.radius, 1, 6)}
      ${addBtn("camp", `Camp ${hrs(add.camp)}`)}${num("camp", add.camp, 1, 240)}h
      ${addBtn("wait", `Wait ${add.wait}h`)}${num("wait", add.wait, 1, 72)}h
      ${addBtn("gather", "Gather")}${activeCrashes(state).length ? addBtn("searcharea", "Search the area") : ""}
      <select data-action="pl-addmove"${tip("Move on to another known site near the target")}><option value="">Move to a site…</option>${targets.map((t) => `<option value="${t.tile}">${esc(t.name)} (${t.dist} tiles${t.job ? "" : `, loot ~${Math.round((knownLoot(state, t.tile) || 0) * 100)}%`})</option>`).join("")}</select>
      ${addBtn("home", "Return home")}
    </div>
    <div class="small" style="margin-top:0.35rem"><b>If</b> ${["hurt", "food", "cargo"].map(condRow).join(" · ")} <b>then come home</b></div>
    ${whole}
    ${notes.length ? `<div class="small warn" style="margin-top:0.2rem"${tip("Staying in one place builds Heat (noise, smoke, smell); the more Heat and the more dangerous the place, the likelier the dead, a horde or raiders find the team. Quiet countryside for a night is mostly safe; days next to a city or a hive are not.")}>${notes.map(esc).join("<br>")}</div>` : ""}`;
}

// ---------- handlers (main.js) ----------
const clampN = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
function setPreset(pl, k) {
  const plan = ensure(pl);
  const pr = PRESETS[k];
  if (!pr) return;
  plan.preset = k;
  if (k === "custom") return;
  plan.steps = pr.steps(plan.days);
  if (pr.mission) pl.mission = pr.mission;
}

export const PLAN_ACTIONS = {
  "pl-preset": (state, ui, d) => setPreset(ui.planner, d.v),
  "pl-step": (state, ui, d) => {
    const plan = ensure(ui.planner), i = Number(d.i), s = plan.steps;
    if (!(i >= 0 && i < s.length)) return;
    if (d.op === "del") s.splice(i, 1);
    else if (d.op === "up" && i > 0) [s[i - 1], s[i]] = [s[i], s[i - 1]];
    else if (d.op === "down" && i < s.length - 1) [s[i + 1], s[i]] = [s[i], s[i + 1]];
    plan.preset = "custom";
  },
  "pl-add": (state, ui, d) => {
    const plan = ensure(ui.planner), a = plan.add;
    if (plan.steps.length >= MAX_STEPS || plan.steps.some((s) => s.kind === "home") || !STEP_KINDS[d.k]) return;
    const step = { kind: d.k };
    if (d.k === "camp") step.hours = a.camp;
    if (d.k === "wait") step.hours = a.wait;
    if (d.k === "nearby") { step.radius = a.radius; step.count = a.count; }
    if (d.k === "move") return;
    plan.steps.push(step);
    plan.preset = "custom";
  },
  "pl-cond": (state, ui, d) => {
    const c = ensure(ui.planner).cond, def = CONDITIONS[d.k];
    if (!def) return;
    if (d.k === "cargo") c.cargo = !c.cargo;
    else c[d.k] = c[d.k] == null ? def.def : null;
  },
};

export const PLAN_CHANGE = {
  "pl-days": (state, ui, el) => {
    const plan = ensure(ui.planner);
    plan.days = clampN(el.value, 1, 10, 1);
    if (plan.preset === "camp") plan.steps = PRESETS.camp.steps(plan.days);
  },
  "pl-addv": (state, ui, el) => {
    const a = ensure(ui.planner).add, k = el.dataset.k;
    const lim = { camp: [1, 240, 24], wait: [1, 72, 6], radius: [1, 6, 3], count: [1, 4, 2] }[k];
    if (lim) a[k] = Math.round(clampN(el.value, lim[0], lim[1], lim[2]));
  },
  "pl-condv": (state, ui, el) => {
    const c = ensure(ui.planner).cond, def = CONDITIONS[el.dataset.k];
    if (!def || def.unit === "") return;
    c[el.dataset.k] = clampN(el.value, def.min, def.max, def.def);
  },
  "pl-addmove": (state, ui, el) => {
    const plan = ensure(ui.planner);
    const tile = Number(el.value);
    if (!el.value || !Number.isFinite(tile) || plan.steps.length >= MAX_STEPS || plan.steps.some((s) => s.kind === "home")) return;
    plan.steps.push({ kind: "move", tile });
    plan.preset = "custom";
  },
};
