// @ts-check
// Sick people rest (user, 2026-10-10: "When a survivor is sick at base they will be reassigned to rest", then "Food
// poisoning counts"). Anyone alive at one of your bases with an illness rests until it is gone, whoever runs their job.
//
// What counts: any condition of kind "illness" (health.js CONDITIONS, isIll). The rule reads the kind, never a list of
// names, so a chest cold, the flu, an upset stomach (un-purified water or uncooked food: food poisoning in all but name)
// and any illness added later (the food overhaul's own food poisoning) count without a change here. Injuries keep
// work.js healthRest's rules (a hospital bed, badly hurt, an infected wound, too ill to work): a deep cut still works.
// The worm is not a condition (worm.js): it keeps its own rules.
//
// The setting (state.sickRest, the Work tab's "Sick people rest"; new worlds and old saves "all", save.js):
//   all      every illness rests (the default);
//   serious  mild ones keep working: an illness that alone leaves them SICK_REST.mildWork of their work or more
//            (conditionWork), or one marked mild (an upset stomach). A chest cold is mild at any severity; the flu,
//            a fever, dysentery and pneumonia are not. For when every hand counts;
//   off      the old rules only (too ill to work: health.js WORK_STOP).
//
// The doctor's exception: a doctor (Manual Medic, or on priorities with Doctor as their first priority) who is ill
// keeps working while they are the only doctor fit at the base and someone there is in worse shape than they are
// (medical.js careNeed: wounds, infection and illness). They rest once another doctor is fit or nobody is worse off.
// Too ill to work (the hard rules) is never excepted.
//
// Who runs whose rest:
//   - People on work priorities (work.js planBase): the health-first step, "Resting: sick (Flu)"; back to their
//     priorities the hour they are well.
//   - The governor and the stewards (autopilot.js planRoles step 1): rest, before any other job.
//   - Manual and pinned people (sickRestHour, every hour after the stewards, the watch and the jail's guards): their
//     role becomes Rest and their job is kept in s.sickWas = { role, station, base }; when they are well (or leave
//     the base, or the setting is turned off) it is given back, unless someone gave them another job meanwhile.
// Where the sick do not go: the watch roster (watch.js onWatchNow), the governor's watch (govWatch), the jail's guards
// (prisoners.js), workshop stations, crafting and the rest of the work (their role is Rest), crew trips (crews.js),
// order templates' crews (trips.js unfitWhy: "sick: Flu"), the governor's trips, errands and runs (autopilot.js
// tripFit), and the Fit filter of the team-forming window (ui/teamform.js: a warning when one is picked anyway).
// Emergencies: a raid or a horde warned or at the walls still takes them to the walls as before (work.js planBase:
// only the hard rules keep people off them; planRoles step 3; a Manual guard is left on guard while it lasts), and a
// battle at the base takes everyone out of a hospital bed as before (defences.js; combat.js illnessAim costs them aim).
// Resting heals an illness 2 severity a day faster (health.js conditionDrift) and counts as sleep (sleep.js).
//
// The log: one line when someone starts resting sick (s.sickOff = { why, base, hour }) and one when they go back to
// work, whoever moved them.
//
// AI parity: the other groups keep a coarse count of their ill (groupcare.js GROUP_ILL, f.ill) whose work they lose.
import { atBase, baseById, log } from "./world.js";
import { CONDITIONS, conditionsOf, conditionWork } from "./health.js";
import { careNeed } from "./medical.js";
import { isManaged, prio, topPrio, mustRest, threatInfo } from "./work.js";
import { ROLES } from "./economy.js";
import { assignStations } from "./buildings.js";

export const SICK_REST = { mildWork: 0.7 };
export const SICK_REST_MODES = {
  all: { name: "Every illness", desc: "Anyone ill at a base rests until it is gone (a chest cold, an upset stomach, the flu …). They heal faster and go back to their job when well." },
  serious: { name: "Keep mild ones working", desc: `Mild illnesses (a chest cold, an upset stomach: ${Math.round(SICK_REST.mildWork * 100)}% of their work or more) keep working at reduced output; the flu, a fever, dysentery and pneumonia rest.` },
  off: { name: "Off", desc: "Only the too ill (under 35% of their work) stop; everyone else works through it at reduced output." },
};
export const sickRestMode = (state) => (state && SICK_REST_MODES[state.sickRest] ? state.sickRest : "all");
export function setSickRest(state, mode) {
  if (!SICK_REST_MODES[mode]) return "";
  state.sickRest = mode;
  return `Sick people rest: ${SICK_REST_MODES[mode].name.toLowerCase()}.`;
}

// A mild illness: marked mild, or one that alone leaves them SICK_REST.mildWork of their work or more.
export const mildIllness = (c) => { const d = CONDITIONS[c.key]; return !!d && (!!d.mild || conditionWork(c) >= SICK_REST.mildWork - 1e-9); };
// The illnesses that make them rest under the setting, worst first (by how little work it leaves them).
export function restIllnesses(state, s) {
  const mode = sickRestMode(state);
  if (mode === "off" || !s || !s.alive) return [];
  return conditionsOf(s).filter((c) => CONDITIONS[c.key] && CONDITIONS[c.key].kind === "illness" && (mode === "all" || !mildIllness(c)))
    .sort((a, b) => conditionWork(a) - conditionWork(b));
}
const atABase = (s) => !!s && s.alive && !!s.location && s.location.kind === "base";

// A doctor: a Manual Medic (or one resting sick from it), or on priorities with Doctor as their first priority.
export function isDoctor(state, s) {
  if (s.role === "medic" || (s.sickWas && s.sickWas.role === "medic")) return true;
  if (!isManaged(state, s)) return false;
  const p = prio(state, s, "doctor");
  return p > 0 && p <= topPrio(state, s);
}
// The doctor's exception (above): "" when it does not apply, else why they keep working.
export function doctorKeepsWorking(state, s) {
  if (!atABase(s) || !isDoctor(state, s) || mustRest(s)) return "";
  const others = atBase(state, s.location.baseId).filter((o) => o !== s);
  if (others.some((o) => isDoctor(state, o) && !mustRest(o) && !restIllnesses(state, o).length)) return "";
  const mine = careNeed(s);
  const worse = others.filter((o) => careNeed(o) > mine);
  return worse.length ? `the only doctor fit here, and ${worse.length === 1 ? `${worse[0].name.split(" ")[0]} is` : `${worse.length} are`} worse off` : "";
}

// Why this person rests sick ("sick: Flu"), or "". Only at a base; the hard rules (work.js mustRest) come first there.
export function sickRestWhy(state, s) {
  if (!atABase(s)) return "";
  const ill = restIllnesses(state, s);
  if (!ill.length) return "";
  if (doctorKeepsWorking(state, s)) return "";
  return `sick: ${CONDITIONS[ill[0].key].name}`;
}
// The label for the UI: "Resting: sick (Flu)" while the rule holds, else "".
export function sickRestLabel(state, s) {
  const w = s && s.sickOff && atABase(s) ? sickRestWhy(state, s) : "";
  return w ? `Resting: sick (${w.slice(6)})` : "";
}

// ---------- the hourly pass (world.js, after the stewards, the watch and the jail's guards) ----------
const jobName = (role) => (ROLES[role] ? ROLES[role].name : role || "work");
export function sickRestHour(state) {
  const threats = new Map();
  const urgent = (base) => { if (!threats.has(base.id)) threats.set(base.id, !!threatInfo(state, base).urgent); return threats.get(base.id); };
  const touched = new Set();
  for (const s of state.survivors) {
    if (!s.sickOff && !s.sickWas && !(s.alive && s.conditions && s.conditions.length)) continue;
    const base = atABase(s) ? baseById(state, s.location.baseId) || null : null;
    const why = base ? sickRestWhy(state, s) : "";
    const manual = s.alive && !isManaged(state, s);
    // Manual and pinned people: Rest, the job they had kept (the latest, if someone changed it meanwhile); a Manual
    // guard stays on the walls while an emergency lasts.
    if (why && manual && s.role !== "rest" && !(s.role === "guard" && urgent(base))) {
      s.sickWas = { role: s.role, station: s.station ?? null, base: base.id };
      s.role = "rest";
      s.station = null;
      touched.add(base);
    }
    if (why && !s.sickOff) {
      log(state, `${s.name} is ill (${why.slice(6)}): resting at ${base.name} until it is gone${s.sickWas ? ` (${jobName(s.sickWas.role)} again when well)` : ""}.`, "info");
      s.sickOff = { why, base: base.id, hour: state.hour };
    }
    if (why) { s.sickOff.why = why; continue; }
    // Well again (or away, or the setting changed): their job back, unless someone gave them another.
    let back = "";
    if (s.sickWas) {
      const was = s.sickWas;
      delete s.sickWas;
      if (manual && s.role === "rest" && base && base.id === was.base) {
        s.role = was.role;
        s.station = was.role === "operate" ? was.station : null;
        back = jobName(was.role).toLowerCase();
        if (was.role === "operate") touched.add(base);
      }
    }
    if (s.sickOff) {
      const from = s.sickOff.base;
      delete s.sickOff;
      if (!s.alive || !base || base.id !== from) continue;
      const doc = restIllnesses(state, s).length ? doctorKeepsWorking(state, s) : "";
      const ill = conditionsOf(s).some((c) => CONDITIONS[c.key] && CONDITIONS[c.key].kind === "illness");
      const to = back || (isManaged(state, s) ? "their work priorities" : "work");
      log(state, doc ? `${s.name} is still ill but back to ${to} at ${base.name}: ${doc}.`
        : ill ? `${s.name} is still a little ill but back to ${to} at ${base.name} (Sick people rest: ${SICK_REST_MODES[sickRestMode(state)].name.toLowerCase()}).`
        : `${s.name} is well again: back to ${to} at ${base.name}.`, "info");
    }
  }
  for (const b of touched) assignStations(state, b);
}
