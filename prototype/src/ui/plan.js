// The trip planner's PLAN section: presets, editable steps, "If … then come home" conditions, and the estimate
// for the whole plan (sim/plans.js). main.js keeps the planner state in ui.planner and merges PLAN_ACTIONS (clicks)
// and PLAN_CHANGE (inputs and selects) into its dispatchers.
import { MISSIONS, tileLabel, STAY_MISSIONS } from "../sim/parties.js";
import { PRESETS, STEP_KINDS, CONDITIONS, estimatePlan, stepLabel, nearbySites, knownLoot } from "../sim/plans.js";
import { activeCrashes } from "../sim/crashes.js";
import { heatPreview } from "../sim/fieldheat.js";
import { searchRiskText } from "../sim/worm.js"; // the worm: searching badly infected ground
import { jobTargets } from "./diplomacy.js";
import { sweepPreview, sweepOpts, rumoursOf, SURVEY } from "../sim/survey.js";
import { survivorById } from "../sim/world.js";
import { travelMode } from "../sim/vehicles.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const hrs = (h) => (h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`);
const MAX_STEPS = 10;

// The plan a fresh planner starts with: missions that go somewhere and come back get "return home" after them.
export function defaultPlan(mission) {
  const back = !STAY_MISSIONS.includes(mission) || mission === "recon";
  const preset = mission === "recon" ? "recon" : mission === "scavenge" ? "scavenge" : mission === "sweep" ? "survey" : "custom";
  return { preset, steps: back ? [{ kind: "home" }] : [], days: 1, cond: { hurt: null, food: null, cargo: false }, add: { camp: 24, wait: 6, radius: 3, count: 2, move: null, hunt: 8, sradius: 3, shours: 12 } };
}
const ensure = (pl) => (pl.plan = pl.plan || defaultPlan(pl.mission));
// The Survey mission's radius and hours (sim/survey.js), kept with the planner.
export const ensureSweep = (pl) => (pl.sweep = sweepOpts(pl.sweep || {}));

// Estimate for the whole plan (null without a route). ids/v: the planner's crew and vehicle.
export function planEstimate(state, pl) {
  const plan = ensure(pl);
  const v0 = pl.vehicleId ? state.vehicles.find((x) => x.id === pl.vehicleId) : null;
  const v = v0 && v0.type === "bike" ? { ...v0, count: Math.max(1, pl.crew.size || 0) } : v0; // one bike each
  return estimatePlan(state, {
    memberIds: [...pl.crew].length ? [...pl.crew] : [0], dest: pl.dest, vehicle: !v ? false : v.type === "bike" ? "bike" : true, v, stance: pl.stance,
    fuel: v && v.type !== "bike" ? v.fuel + (pl.supplies.fuel || 0) : 0, mission: pl.mission, steps: plan.steps, supplies: pl.supplies, sweep: ensureSweep(pl),
  });
}
// For main.js autofill: the plan's needs when it has steps, else null (the plain round-trip estimate is used).
export const planAutofill = (state, pl) => (ensure(pl).steps.length || pl.mission === "sweep" ? planEstimate(state, pl) : null);
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
  // The worm (sim/worm.js): a search on badly infected ground is a risk to the hands that do it.
  const searches = [pl.dest, ...plan.steps.filter((s) => s.kind === "move" && s.tile != null).map((s) => s.tile)];
  for (const t of [...new Set(searches)]) { const w = searchRiskText(state, t); if (w) notes.push(`${tileLabel(state, t)}: ${w}.`); }
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
  const haulOf = (i) => { const l = est && est.legs.find((x) => x.label === stepLabel(state, plan.steps[i]) && x.haul != null); return l ? ` <span class="good"${tip("Expected haul of fresh game (an average: luck decides). Carried, it weighs 1 kg a ration; it spoils fast in the warm.")}>~${Math.round(l.haul)} food</span>` : ""; };
  // Firewood (sim/woodcutting.js): what the step is expected to bring home, as far as the team can carry it.
  const woodOf = (i) => { const l = est && est.legs.find((x) => x.label === stepLabel(state, plan.steps[i]) && x.wood != null); return l ? ` <span class="good"${tip("Expected firewood (an average: the land, the season, the team's axes), as much as the team can carry (3 kg each).")}>~${Math.round(l.wood)} firewood</span>` : ""; };
  const steps = plan.steps.map((s, i) => `<li><span>${esc(stepLabel(state, s))}${s.kind === "camp" || s.kind === "wait" ? ` <span class="muted">~${hrs(s.hours)}</span>` : s.kind === "survey" ? ` <span class="muted">~2h</span>` : s.kind === "scavenge" ? ` <span class="muted">~6h</span>` : s.kind === "sweep" ? ` <span class="muted">~${hrs(sweepOpts(s).hours)}</span>` : ""}${s.kind === "hunt" || s.kind === "fish" || s.kind === "snare" || s.kind === "forage" ? haulOf(i) : s.kind === "wood" ? woodOf(i) : ""}</span>
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
  const whole = est ? `<div class="small" style="margin-top:0.35rem"${tip("Every leg stepped hour by hour like the real trip (weather included); searches count 6 hours, Look around 2. Food and water: one each per person per day for the whole plan (more on the move under a load; water times each day's thirst: 1.3 in summer, at least 1.6 on a hot day, 0.9 in winter), plus the way home if the plan does not end there.")}>Whole plan: <b>~${(est.total / 24).toFixed(1)} days</b> (${est.hours}h${est.backHours ? ` + ${est.backHours}h home` : ""}) · needs ${est.food} food · ${est.water} water${est.fuel ? ` · ${est.fuel} fuel` : ""}${est.haul ? ` · <span class="good">brings home ~${Math.round(est.haul)} food of game (${Math.round(est.haulKg)} kg)</span>` : ""}${est.returns ? "" : ` · <span class="warn">${est.open ? "a step has no route" : "ends away from home: it waits for orders there"}</span>`}</div>` : "";
  const notes = est ? heatNote(state, pl, est) : [];
  return `<h3${tip("What the team does after reaching the target, in order. Out of radio contact the team follows this plan; it reports in with a card on important finds (a horde in sight, a rich site, supplies running short) and when the plan ends. In radio range you can change its orders any time.")}>Plan</h3>
    ${surveyBox(state, pl, est)}
    <div class="row" style="flex-wrap:wrap;gap:0.3rem">${["recon", "scavenge", "survey", "explore", "camp", "hunt", "fish", "custom"].map(presetBtn).join("")}
      <span class="small muted">days <input type="number" class="tiny" style="width:3.2rem" data-action="pl-days" min="1" max="10" value="${plan.days}"></span></div>
    <div class="small muted" style="margin:0.2rem 0">${esc(preset.desc)}</div>
    <ol class="xpqueue small">
      <li><span>${esc(`Travel to ${tileLabel(state, pl.dest)}: ${pl.mission === "sweep" ? `Survey ${ensureSweep(pl).radius} tiles around for ${ensureSweep(pl).hours}h` : MISSIONS[pl.mission]?.name || pl.mission}`)} <span class="muted">~${first}${pl.mission === "sweep" ? ` + ${hrs(ensureSweep(pl).hours)}` : ""}</span></span></li>
      ${steps}
      ${plan.steps.some((s) => s.kind === "home") ? "" : `<li><span class="muted">Then wait there for orders</span></li>`}
    </ol>
    <div class="row small" style="flex-wrap:wrap;gap:0.3rem">Add:
      ${addBtn("survey", "Look around")}${addBtn("sweep", `Survey ${add.shours ?? 12}h`)} r${num("sradius", add.sradius ?? 3, SURVEY.radius.min, SURVEY.radius.max)} ${num("shours", add.shours ?? 12, SURVEY.hours.min, SURVEY.hours.max)}h${addBtn("scavenge", "Scavenge here")}
      ${addBtn("nearby", `Scavenge nearby (${add.count} within ${add.radius})`)} ×${num("count", add.count, 1, 4)} r${num("radius", add.radius, 1, 6)}
      ${addBtn("camp", `Camp ${hrs(add.camp)}`)}${num("camp", add.camp, 1, 240)}h
      ${addBtn("wait", `Wait ${add.wait}h`)}${num("wait", add.wait, 1, 72)}h
      ${addBtn("forage", `Forage ${add.hunt ?? 8}h`)}${addBtn("hunt", `Hunt ${add.hunt ?? 8}h`)}${addBtn("fish", `Fish ${add.hunt ?? 8}h`)}${addBtn("wood", `Cut wood ${add.hunt ?? 8}h`)}${num("hunt", add.hunt ?? 8, 2, 24)}h ${addBtn("snare", "Snares")}
      ${addBtn("gather", "Gather")}${addBtn("water", "Fetch water")}${activeCrashes(state).length ? addBtn("searcharea", "Search the area") : ""}
      <select data-action="pl-addmove"${tip("Move on to another known site near the target")}><option value="">Move to a site…</option>${targets.map((t) => `<option value="${t.tile}">${esc(t.name)} (${t.dist} tiles${t.job ? "" : `, loot ~${Math.round((knownLoot(state, t.tile) || 0) * 100)}%`})</option>`).join("")}</select>
      ${addBtn("home", "Return home")}
    </div>
    <div class="small" style="margin-top:0.35rem"><b>If</b> ${["hurt", "food", "cargo"].map(condRow).join(" · ")} <b>then come home</b></div>
    ${whole}
    ${notes.length ? `<div class="small warn" style="margin-top:0.2rem"${tip("Staying in one place builds Heat (noise, smoke, smell); the more Heat and the more dangerous the place, the likelier the dead, a horde or raiders find the team. Quiet countryside for a night is mostly safe; days next to a city or a hive are not.")}>${notes.map(esc).join("<br>")}</div>` : ""}`;
}

// ---------- handlers (main.js) ----------
const clampN = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
// A preset picked from outside the planner (the map's right-click "Hunting trip", main.js).
export const applyPreset = (pl, k) => setPreset(pl, k);
function setPreset(pl, k) {
  const plan = ensure(pl);
  const pr = PRESETS[k];
  if (!pr) return;
  plan.preset = k;
  if (k === "custom") return;
  plan.steps = pr.steps(plan.days, plan);
  if (pr.mission) pl.mission = pr.mission;
}

export const PLAN_ACTIONS = {
  "pl-preset": (state, ui, d) => setPreset(ui.planner, d.v),
  "pl-sweep-r": (state, ui, d) => { ensureSweep(ui.planner).radius = sweepOpts({ radius: d.v }).radius; },
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
    if (d.k === "sweep") Object.assign(step, sweepOpts({ radius: a.sradius ?? 3, hours: a.shours ?? 12 }));
    if (d.k === "hunt" || d.k === "fish" || d.k === "forage" || d.k === "wood") step.hours = a.hunt ?? 8;
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
  "pl-sweep-h": (state, ui, el) => { ensureSweep(ui.planner).hours = sweepOpts({ hours: el.value }).hours; },
  "pl-days": (state, ui, el) => {
    const plan = ensure(ui.planner);
    plan.days = clampN(el.value, 1, 10, 1);
    if (plan.preset === "camp") plan.steps = PRESETS.camp.steps(plan.days);
  },
  "pl-addv": (state, ui, el) => {
    const a = ensure(ui.planner).add, k = el.dataset.k;
    const lim = { camp: [1, 240, 24], wait: [1, 72, 6], radius: [1, 6, 3], count: [1, 4, 2], hunt: [2, 24, 8], sradius: [SURVEY.radius.min, SURVEY.radius.max, 3], shours: [SURVEY.hours.min, SURVEY.hours.max, 12] }[k];
    if (lim) a[k] = Math.round(clampN(el.value, lim[0], lim[1], lim[2]));
    const plan = ensure(ui.planner);
    if (k === "hunt" && (plan.preset === "hunt" || plan.preset === "fish")) plan.steps = PRESETS[plan.preset].steps(plan.days, plan);
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

// The Survey mission's settings and its odds (sim/survey.js sweepPreview): radius, hours, a word with the reasons.
function surveyBox(state, pl, est) {
  if (pl.mission !== "sweep") return "";
  const sw = ensureSweep(pl);
  const members = [...pl.crew].map((id) => survivorById(state, id)).filter(Boolean);
  const v0 = pl.vehicleId ? state.vehicles.find((x) => x.id === pl.vehicleId) : null;
  const leg = est && est.legs.find((l) => l.sweep);
  const pv = members.length ? sweepPreview(state, { members, center: pl.dest, radius: sw.radius, hours: sw.hours, mode: travelMode(v0), stance: pl.stance, startHour: leg ? leg.start : state.hour }) : null;
  const rBtn = (r) => `<button class="mini ${sw.radius === r ? "active" : ""}" data-action="pl-sweep-r" data-v="${r}"${tip(`Sweep ${r} tiles around the target (${r === 2 ? "19" : r === 3 ? "37" : "61"} tiles): wider covers more ground, but each spot gets fewer hours.`)}>${r} tiles</button>`;
  const cls = pv ? (pv.word === "good" ? "good" : pv.word === "fair" ? "warn" : "danger") : "muted";
  const rum = rumoursOf(state).filter((r) => state.grid.distance(r.center, pl.dest) <= r.radius);
  return `<div class="card small" style="margin:0.3rem 0"${tip("The team sweeps the land around the target hour by hour, moving from spot to spot inside the circle, and ends back at the centre. Each hour it may spot hidden places (farms, cabins, lodges, camps off the roads) and finds (caches, wrecks, camps). Food and water at the moving rate; Heat builds at half the rate of standing still; every tile it walks into can bring an encounter, as on the road.")}>
    <b>Survey</b> ${[2, 3, 4].map(rBtn).join("")} · <input type="number" class="tiny" style="width:3.6rem" data-action="pl-sweep-h" min="${SURVEY.hours.min}" max="${SURVEY.hours.max}" value="${sw.hours}"> hours
    ${pv ? `<div style="margin-top:0.25rem"${tip(pv.reasons.join(" · "))}>Odds: <b class="${cls}">${pv.word}</b> <span class="muted">(~${Math.round(pv.chance * 100)}% for a place hidden somewhere in the circle; ${pv.moves} moves, ${pv.seenTiles} of ${pv.tiles} tiles seen up close)</span></div>
      <div class="muted">${esc(pv.reasons.slice(0, 5).join(" · "))}</div>
      ${pv.hive ? `<div class="danger">Hive land in the circle: the dead there are tougher, and walking about draws them.</div>` : ""}` : `<div class="muted" style="margin-top:0.25rem">Pick a crew to see the odds.</div>`}
    ${rum.length ? `<div class="good">${rum.map((r) => `Inside the rumour of ${esc(r.what)} ${esc(r.where)}: ×${SURVEY.rumour} odds for it.`).join(" ")}</div>` : ""}
  </div>`;
}
