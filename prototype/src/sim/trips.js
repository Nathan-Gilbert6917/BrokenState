// Order templates and repeat trips (the trip planner's "Save as template", the Teams tab's Templates and Recent
// trips lists, the "Home from … : repeat the trip" alert).
//
// A trip's setup (a "spec") is what the planner holds apart from the target: the mission, stance, retreat policy,
// crew (by id, with each person's job and best skills as the fallback), vehicle, supplies, tablets and lights, the
// plan's steps and conditions, and the Survey settings. A template is a named spec; a team the planner sent carries
// its spec (p.tripSpec) and leaves it in the recent trips when it gets home (parties.js returnHome).
//
// Applying a spec to a planner (applySpec, then applyPacking after the planner's auto-fill) keeps what still works and
// says what changed: people who are dead, away, hurt (under FIT_HEALTH), in a hospital bed, too ill to work or resting
// sick (sickrest.js: "sick: Flu") are replaced by the best fit person at the hub with the same job (else the same best skills), a missing vehicle by one of
// the same kind, "Move to a site" steps of another target are dropped, and supplies the hub is short of are flagged.
// Everything lives in state.tripBook (saved with the campaign); worlds from before it simply have none yet.
import { hub, atBase, survivorById, skill } from "./world.js";
import { SUPPLIES, SKILL_NAMES } from "./data.js";
import { MISSIONS, STANCES, missionProblem, teamName, tileLabel } from "./parties.js";
import { vehiclesAtBase, isBike, isCar } from "./vehicles.js";
import { stockHas } from "./water.js";
import { tooIllToWork } from "./health.js";
import { sickRestWhy } from "./sickrest.js"; // the sick rest at home (Sick people rest, the Work tab)
import { RETREAT_POLICIES, setTeamPolicy } from "./breakoff.js";

export const TRIPS = {
  MAX_TEMPLATES: 24, // templates kept
  RECENT: 6,         // recent trips kept (newest first)
  FIT_HEALTH: 60,    // under this a template's member is replaced
  HOME_HOURS: 24,    // the "home: repeat the trip?" alert stays up this long
  NAME_LEN: 30,
};

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const first = (name) => String(name || "").split(" ")[0];

export function tripBook(state) {
  if (!state.tripBook) state.tripBook = { next: 1, templates: [], recent: [] };
  return state.tripBook;
}
export const templates = (state) => (state.tripBook ? state.tripBook.templates : []);
export const recentTrips = (state) => (state.tripBook ? state.tripBook.recent : []);
export const templateById = (state, id) => templates(state).find((t) => t.id === Number(id)) || null;
export const recentById = (state, id) => recentTrips(state).find((r) => r.id === Number(id)) || null;

// A person's two best skills (the fallback for a stand-in).
const topSkills = (s) => Object.keys(SKILL_NAMES).sort((a, b) => skill(s, b) - skill(s, a)).slice(0, 2);

// The planner's setup without its target, as plain data.
export function specOf(state, pl) {
  const v = pl.vehicleId ? state.vehicles.find((x) => x.id === pl.vehicleId) : null;
  const supplies = {};
  for (const [k, q] of Object.entries(pl.supplies || {})) if ((SUPPLIES[k] || k === "food") && Number.isFinite(q) && q > 0) supplies[k] = Math.floor(q); // food: days of it (foods.js)
  return {
    mission: pl.mission, stance: pl.stance, policy: RETREAT_POLICIES[pl.policy] ? pl.policy : null,
    members: [...pl.crew].map((id) => survivorById(state, id)).filter(Boolean).map((s) => ({ id: s.id, name: s.name, role: s.role, wrole: (s.work && s.work.role) || null, top: topSkills(s) })),
    vehicleId: v ? v.id : null, vehicleType: v ? v.type : null, vehicleName: v ? v.name : null,
    supplies, packFood: pl.packFood || null, tabs: !!pl.tabs, lights: pl.lights !== false, spares: pl.spares !== false, // packFood: the planner's Pack first (a food item)
    plan: pl.mission === "outpost" || pl.mission === "occupy" ? null : clone(pl.plan) || null, sweep: clone(pl.sweep) || null,
  };
}

// One line about a spec: "Scavenge · 3 people · Careful · car".
export function specSummary(spec) {
  const n = (spec.members || []).length;
  const ride = spec.vehicleType == null ? "on foot" : spec.vehicleType === "bike" ? "bikes" : spec.vehicleName || "a vehicle";
  const steps = spec.plan && spec.plan.steps ? spec.plan.steps.length : 0;
  return `${MISSIONS[spec.mission]?.name || spec.mission} · ${n} ${n === 1 ? "person" : "people"} · ${STANCES[spec.stance]?.name || spec.stance} · ${ride}${steps ? ` · ${steps} step${steps === 1 ? "" : "s"}` : ""}`;
}

// ---------- templates ----------
const cleanName = (name) => String(name || "").replace(/\s+/g, " ").trim().slice(0, TRIPS.NAME_LEN);
export function defaultTemplateName(state, pl) {
  const base = `${MISSIONS[pl.mission]?.name || "Trip"} team`;
  for (const L of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!templates(state).some((t) => t.name === `${base} ${L}`)) return `${base} ${L}`;
  return base;
}
// Saves the planner's setup under a name (the same name again replaces that template). Returns { template, msg }.
export function saveTemplate(state, pl, name) {
  const book = tripBook(state);
  const nm = cleanName(name) || defaultTemplateName(state, pl);
  if (!pl.crew || !pl.crew.size) return { template: null, msg: "Pick a crew first: a template needs at least one person." };
  const spec = { ...specOf(state, pl), dest: pl.dest, savedHour: state.hour };
  const old = book.templates.find((t) => t.name.toLowerCase() === nm.toLowerCase());
  if (old) { Object.assign(old, spec, { name: nm }); return { template: old, msg: `Template "${nm}" updated.` }; }
  if (book.templates.length >= TRIPS.MAX_TEMPLATES) return { template: null, msg: `That is ${TRIPS.MAX_TEMPLATES} templates: delete one first (Teams tab).` };
  const t = { id: book.next++, name: nm, ...spec };
  book.templates.push(t);
  return { template: t, msg: `Saved as template "${nm}".` };
}
export function renameTemplate(state, id, name) {
  const t = templateById(state, id);
  const nm = cleanName(name);
  if (!t) return "That template is gone.";
  if (!nm) return "A template needs a name.";
  if (templates(state).some((x) => x !== t && x.name.toLowerCase() === nm.toLowerCase())) return `There is already a template called "${nm}".`;
  t.name = nm;
  return `Renamed to "${nm}".`;
}
export function deleteTemplate(state, id) {
  const book = tripBook(state);
  const i = book.templates.findIndex((t) => t.id === Number(id));
  if (i < 0) return "That template is gone.";
  const [t] = book.templates.splice(i, 1);
  return `Template "${t.name}" deleted.`;
}

// ---------- the trips teams make ----------
// The planner's "Send team" (main.js): the team remembers its setup, and the retreat policy picked goes on it.
export function rememberLaunch(state, p, pl) {
  if (!p) return;
  p.tripSpec = { ...specOf(state, pl), dest: pl.dest };
  if (RETREAT_POLICIES[pl.policy]) setTeamPolicy(state, p, pl.policy);
}
// A team with a remembered setup got home (parties.js returnHome): it goes to the top of the recent trips.
export function noteTripHome(state, p) {
  if (!p || !p.tripSpec) return;
  const book = tripBook(state);
  book.recent.unshift({ id: book.next++, spec: p.tripSpec, dest: p.tripSpec.dest, label: teamName(state, p), home: state.hour });
  book.recent.length = Math.min(book.recent.length, TRIPS.RECENT);
}

// ---------- applying a spec to the planner ----------
// Why a person cannot go now ("" when they can).
export function unfitWhy(state, s, h = hub(state)) {
  if (!s) return "gone";
  if (!s.alive) return s.left ? "gone" : "dead";
  if (!h || !s.location || s.location.kind !== "base" || s.location.baseId !== h.id) return s.location && s.location.kind === "party" ? "out with a team" : "not at the hub";
  if (s.inBed) return "in a hospital bed";
  if (tooIllToWork(s)) return "too ill";
  const sick = sickRestWhy(state, s);
  if (sick) return sick; // "sick: Flu"
  if (s.health < TRIPS.FIT_HEALTH) return `hurt (health ${Math.round(s.health)})`;
  return "";
}

// The best fit stand-in at the hub for a member who cannot go: the same job first, then their best skills.
function standIn(state, m, h, taken) {
  let best = null, bestScore = -1;
  for (const c of atBase(state, h.id)) {
    if (taken.has(c.id) || unfitWhy(state, c, h)) continue;
    const same = (m.wrole && c.work && c.work.role === m.wrole) || c.role === m.role ? 100 : 0;
    const score = same + (m.top || []).reduce((a, k) => a + skill(c, k), 0) + c.health / 100;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

// Mission, stance, policy, crew, vehicle and plan onto the planner (pl.dest is the target). Returns the notes.
export function applySpec(state, pl, spec) {
  const notes = [];
  const h = hub(state);
  if (!h) return ["There is no hub to send a team from."];
  // The mission, if it can go to this target; else the first of Scavenge, Recon, Move that can.
  if (MISSIONS[spec.mission] && !missionProblem(state, pl.dest, spec.mission)) pl.mission = spec.mission;
  else {
    const alt = ["scavenge", "recon", "move"].find((k) => MISSIONS[k] && !missionProblem(state, pl.dest, k)) || pl.mission;
    notes.push(`${MISSIONS[spec.mission]?.name || spec.mission} cannot go to ${tileLabel(state, pl.dest)}: ${MISSIONS[alt]?.name || alt} instead.`);
    pl.mission = alt;
  }
  if (STANCES[spec.stance]) pl.stance = spec.stance;
  pl.policy = RETREAT_POLICIES[spec.policy] ? spec.policy : null;
  // The crew: everyone fit first, then a stand-in for each of the others.
  pl.crew = new Set();
  const out = [];
  for (const m of spec.members || []) {
    const s = survivorById(state, m.id);
    const why = unfitWhy(state, s, h);
    if (why) out.push([m, why]); else pl.crew.add(s.id);
  }
  for (const [m, why] of out) {
    const sub = standIn(state, m, h, pl.crew);
    if (sub) { pl.crew.add(sub.id); notes.push(`${first(sub.name)} stands in for ${first(m.name)}: ${why}.`); }
    else notes.push(`${first(m.name)} cannot go (${why.split(" (")[0]}) and nobody fit at the hub can stand in.`);
  }
  // The vehicle: the same one, else one of the same kind, else any car for a car trip; else on foot.
  pl.vehicleId = null;
  if (spec.vehicleType) {
    const here = vehiclesAtBase(state, h.id).filter((v) => v.condition > 0);
    const v = here.find((x) => x.id === spec.vehicleId) || here.find((x) => x.type === spec.vehicleType) || (spec.vehicleType !== "bike" ? here.find(isCar) : null);
    if (v) {
      pl.vehicleId = v.id;
      if (v.id !== spec.vehicleId && !isBike(v)) notes.push(`The ${spec.vehicleName || "vehicle"} is not at the hub: the ${v.name} instead.`);
    } else notes.push(`No ${spec.vehicleType === "bike" ? "bikes" : spec.vehicleName || "vehicle"} at the hub: on foot.`);
  }
  // The plan: "Move to a site" steps belong to the target they were planned from.
  if (spec.plan && pl.mission !== "outpost" && pl.mission !== "occupy") {
    const plan = clone(spec.plan);
    if (spec.dest !== pl.dest) {
      const moves = plan.steps.filter((s) => s.kind === "move").length;
      if (moves) {
        plan.steps = plan.steps.filter((s) => s.kind !== "move");
        plan.preset = "custom";
        notes.push(`${moves} "Move to a site" step${moves === 1 ? "" : "s"} dropped (planned from another target).`);
      }
    }
    pl.plan = plan;
  }
  if (spec.sweep) pl.sweep = clone(spec.sweep);
  return notes;
}

// After the planner's auto-fill: the spec's supplies (as far as the hub has them), tablets and lights. Returns notes.
export function applyPacking(state, pl, spec) {
  const h = hub(state);
  if (!h) return [];
  const short = [];
  pl.supplies = {};
  for (const [k, want] of Object.entries(spec.supplies || {})) {
    if ((!SUPPLIES[k] && k !== "food") || !(want > 0)) continue; // food: days of it (packed as items at launch)
    const have = Math.max(0, Math.floor(stockHas(h.stock, k)));
    pl.supplies[k] = Math.min(want, have);
    if (have < want) short.push(`${k === "water" ? "water" : k === "food" ? "days of food" : SUPPLIES[k].name.toLowerCase()} ${have} of ${want}`);
  }
  if (spec.tabs != null) pl.tabs = !!spec.tabs;
  if (spec.packFood && (h.stock[spec.packFood] || 0) > 0) pl.packFood = spec.packFood; // the planner's Pack first, while the hub has it
  pl.lights = spec.lights !== false;
  pl.spares = spec.spares !== false;
  return short.length ? [`Short at the hub: ${short.join(", ")}.`] : [];
}

// The recent trip a team made, for "Home from …" (the alert's text).
export function recentLabel(state, r) {
  return `${MISSIONS[r.spec.mission]?.name || "Trip"} to ${tileLabel(state, r.dest)}`;
}
