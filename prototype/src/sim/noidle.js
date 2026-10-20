// No idle workers (the user's requests 2026-10-20: "Have the governor put a woodcutter on its own felling, not just idle
// builders" and "There should never be idle workers for any profession. If there are no buildings to build do not
// leave any survivors as builders").
//
// "Has work": a person's job has work this hour when its activity line (activity.js describeActivity, by the hour; the
// by-the-job view workingActivity / jobCheck for the governor and the alert) is not "idle" or "stalled". Per role:
//   build     a construction job they can work (not waiting for its materials: gatherStalled; not on alert or under
//             siege), a field work out on the land, a repair order they hold, or a worn building to mend (upkeep);
//             clearing jobs count (the felling too: builders work the first job in the queue they can)
//   wood      felling or clearing marked on the base map (woodwork.js hasChopWork), else wood land around the base
//             (woodcutting.js woodWorkWhy); outside the daylight hours they are off, not idle
//   farm      a plot growing, ripe or to sow (farming.js farmersWanted active + toSow)
//   cook      a kitchen, its stove lit (kitchen.js kitchenCanLight: the wood for it) and food in store; off 22–05
//   medic     a patient in a bed, anyone else here hurt or ill, or a trainee on the ward (the doctor teaches)
//   craft     a job in the craft queue they can do now (crafting.js craftJobStatus)
//   operate   their station running (buildings.js stationStatus)
//   scavenge  the ruins round the base not picked clean (economy.js scavLeft over SCAV_FLOOR)
//   forage, hunt, fish, water   the land for it (forageWorkWhy, huntWorkWhy, fishWorkWhy and a tool, fetchWaterWhy)
//   teach     someone 4+ below them in a skill; read: a book or blueprint here
//   guard, trainee, rest   always (rest is not work; a guard is a lookout whenever they are on the walls)
// Not idle whatever the job: asleep, eating, resting or sick (in a bed, health rest, sickrest.js), off duty (the job's
// hours: a woodcutter after dark), on the watch roster, away, too weak to work (workFactor under MIN_WORK).
//
// 1. The governor (autopilot.js planRoles): every person it plans (not pinned, not on work priorities, not in an area a
//    steward was not handed) whose role has no work by the job (jobCheck) is given the most useful role that has work,
//    planNoIdle: the base's needs (idlework.js baseNeeds: a patient, wood for the cold, food, water, repairs, the build
//    queue, the kitchen, a station, the craft queue, the felling marked, scavenging) with room left by what the
//    governor has already planned, then wood while the woodpile is under NOIDLE.woodSpare (wood is the builds'
//    material), then a lookout on the walls; the best need first, the one they are best at between equal needs. The
//    governor's own steps (food, water, heat, defence first) are untouched: only the people it left with no work move.
//    Its builders come only with work they can do now (step 5: a job in the queue not waiting for its materials, the
//    felling and clearing too, a field work; nothing on alert); the felling gets woodcutters on top (fellCrew: one, two
//    when the woodpile is under the fires' days and three days' burn, three under the fires' days alone; never more
//    than the trees queued or a third of the people), the best first by skill, tools, traits and health (fellScore),
//    ahead of the builders while the woodpile is that low (fellUrgent: heat first) or the felling is all that is
//    queued, after them otherwise; off again once the felling is done and the woodpile needs nobody. (Builders fell
//    all day, woodcutters by daylight: taking the felling from the builders cost the hub openings builds, 12 seeds.)
// 2. Manual people (the player's roles, pinned people too; and anyone the governor's hour left with no work, the last
//    tree felled within the hour): helpHour, every hour after every role is set (world.js, after sickRestHour, and
//    again after the job trips): someone at a base whose job has no work this hour helps with the first of HELP_ORDER that
//    has work now and room: the builders (a construction job to work, NOIDLE.buildMax builders at most), the felling
//    marked on the base map (its daylight hours, NOIDLE.chopEach a tree) or the wood for the cold (woodNeed short, wood
//    land), Fetch water while it runs short (the hauling there is), the fields (a plot to tend, up to the plots' ideal
//    crew), else a lookout on the walls. Their role is kept: s.role is what they do this hour (as kitchen.js's Cook +
//    second job), s.helpWas = { role, station, base, as, hour, why } what comes back; helpRestore puts it back at the
//    start of the next hour's role setting (world.js, before work.js workHour), so the work priorities, the stewards,
//    the watch, the jail and the sick see their own job, and they stay on the help only while their job has none (the
//    same help as last hour first, so a trip out is not cut short). Changed by hand meanwhile: the change holds.
//    The daily jobs (farming, XP) count people at midnight: helpDayRoles (world.js, with work.js workDayRoles) counts a
//    Manual person whose job had no work at the job they helped with last that day.
//    The activity line: "No building to do: helping chop wood" (helpLine), the help's own line in the tooltip.
//    The alert (ui/activity.js noWorkAlerts, quiet: tone info): the roles with no work at each base, by the job
//    (noWorkRoles), and who helps where, so the player can reassign.
// 3. AI parity: the AI groups have no people with jobs of their own (factions.js counts); their builders are their crew
//    (groupworks.js groupWorksDaily: people / CREW crew-days a day), coarse and daily, by the same rule: no crew-days are
//    left on work that does not exist. A job finished part-way through the day hands the rest of its crew-days to the
//    next job (f.crewCarry = { n, day }, spent on it the next day: they were lost), and a day with nothing to build leaves the crew
//    on the land, where their fields and hunting already count every working head (f.crewDay = { day, crew, carried,
//    built, carry, land }: carried + crew = built + carry + land). Their cooks: groupworks.js groupCookShare is 0 while
//    the kitchens are cold (back in the fields), as before.
// tools/noidletest.js.
import { atBase, hourOfDay, skill } from "./world.js";
import { ROLES } from "./economy.js";
import { isManaged, healthRest } from "./work.js";
import { underAttack, gatherStalled, assignStations } from "./buildings.js";
import { describeActivity, workingActivity, jobCheck, jobCheckAt } from "./activity.js";
import { hasChopWork, chopJobs } from "./woodwork.js";
import { woodNeed, woodWorkWhy, woodcutterMult, bestChop } from "./woodcutting.js";
import { farmersWanted } from "./farming.js";
import { waterRunningShort, fetchWaterWhy } from "./economy.js";
import { inTripHours } from "./tripland.js";
import { workFactor } from "./health.js";
import { hasTrait } from "./traits.js";
import { baseNeeds, JOB_SKILL } from "./idlework.js";
import { ROLE_AREA } from "./autopilot.js";
import { helpHaulOpen, localWork } from "./hauling.js"; // hauling: local hauling as a help and a fallback (call-time only)

export const NOIDLE = {
  minWork: 0.35,     // under this work factor they are resting for their health, not idle (activity.js MIN_WORK)
  buildMax: 4,       // builders a helper may make up (more add little on one job)
  chopEach: 2,       // helpers a tree marked for felling
  waterMax: 2,       // helpers on Fetch water
  woodSpare: 1500,   // the governor's spare hands cut wood while the woodpile is under this (the builds' material)
  fellThird: 3,      // the governor's felling crew: at most a third of the people
};
const NO_WORK = new Set(["idle", "stalled"]);
export const HELP_ORDER = ["build", "wood", "water", "farm", "haul", "guard"]; // haul: local hauling (hauling.js: salvage, the ruins)
const NO_WORK_TEXT = { rest: "Nothing to do on their priorities", build: "No building to do", wood: "No wood to cut", farm: "No field work", cook: "Nothing to cook", medic: "Nobody to look after", craft: "Nothing to craft", operate: "The station is idle", scavenge: "Nothing left to scavenge", forage: "Nothing to forage", hunt: "No hunting here", fish: "No fishing here", water: "No water to fetch", teach: "Nobody to teach", read: "Nothing to read", trainee: "No training", haul: "Nothing to haul" };
const HELP_TEXT = { build: "helping the builders", wood: "helping chop wood", water: "helping fetch water", farm: "helping tend the fields", guard: "standing guard", scavenge: "helping scavenge", forage: "helping forage", haul: "helping haul salvage" };
const roleName = (k) => (ROLES[k] ? ROLES[k].name : k);
const first = (s) => s.name.split(" ")[0];

// ---------- who is helping ----------
/** The job a Manual person helps with this hour (their own has no work), or null. @param {any} s */
export const helpingAs = (s) => (s && s.helpWas && s.role === s.helpWas.as ? s.helpWas.as : null);
/** Their own job (the role kept while they help). @param {any} s */
export const assignedRole = (s) => (helpingAs(s) ? s.helpWas.role : s && s.role);
/** The activity line of a helper. @param {any} s @param {any} a the help's own activity */
export function helpLine(s, a) {
  const was = s.helpWas.role;
  const text = `${NO_WORK_TEXT[was] || `No ${roleName(was).toLowerCase()} work`}: ${HELP_TEXT[s.helpWas.as] || `helping with ${roleName(s.helpWas.as).toLowerCase()}`}`;
  return { ...a, text, why: `${roleName(was)} has no work this hour (${String(s.helpWas.why || "nothing to do").replace(/^[^:–]*[:–]\s*/, "").toLowerCase()}), so they help elsewhere and go back to it as soon as there is work. Now: ${a.text}.${a.why ? ` ${a.why}` : ""}` };
}

// ---------- has work ----------
// Someone on work priorities whose plan this hour found nothing (work.js planBase: "Nothing to do, resting", task kind
// idle): resting for want of work, not for their health, sleep or mood. They get the hour's help as a Manual person
// does (pt-int round 5: they rested instead).
export const prioIdle = (state, s) => isManaged(state, s) && !!s.task && s.task.kind === "idle" && s.task.hour === state.hour;
// At a base, able to work and not resting, asleep, eating or away: may their job be judged idle at all?
function canHelp(state, base, s, role = s.role, idleRest = false) {
  if (!s.alive || !s.location || s.location.kind !== "base" || s.location.baseId !== base.id) return false;
  if (s.inBed || s.restUntil != null || s.sickWas || healthRest(s, state) || workFactor(s) < NOIDLE.minWork) return false;
  return (role !== "rest" || idleRest) && role !== "guard";
}
/** No work for their job this hour (the activity line idle or stalled; on work priorities, a plan that found nothing). @param {any} state @param {any} base @param {any} s */
export function noWorkNow(state, base, s) {
  if (prioIdle(state, s)) return canHelp(state, base, s, s.role, true);
  return canHelp(state, base, s) && !isManaged(state, s) && NO_WORK.has(describeActivity(state, s).kind);
}
/** No work for this role by the job (at its working hour): the governor and the alert. */
export function noWorkFor(state, base, s, role, station = null) {
  if (!role || role === "rest" || role === "guard" || workFactor(s) < NOIDLE.minWork) return false;
  return NO_WORK.has(jobCheck(state, base, s, role, station).kind);
}

// ---------- 2. Manual people: help for the hour ----------
// May one more help with this job at hour h? count: people on each job here now.
function helpOpen(state, base, s, job, h, count) {
  const n = count[job] || 0;
  switch (job) {
    case "build": return n < NOIDLE.buildMax && !underAttack(state, base) && base.construction.some((c) => !gatherStalled(c)) && jobCheckAt(state, base, s, "build", h).kind === "work";
    case "wood": {
      if (underAttack(state, base) || !inTripHours("wood", h)) return false;
      if (hasChopWork(base)) return n < chopJobs(base).length * NOIDLE.chopEach;
      return !woodWorkWhy(state, base) && woodNeed(state, base).short && n < 3;
    }
    case "water": return n < NOIDLE.waterMax && !underAttack(state, base) && inTripHours("water", h) && waterRunningShort(state, base) && !fetchWaterWhy(state, base);
    case "farm": { const fw = farmersWanted(state, base); return fw.active + fw.toSow > 0 && n < fw.ideal; }
    case "haul": return !underAttack(state, base) && helpHaulOpen(state, base, h, n); // hauling.js: salvage, the ruins
    case "guard": return true;
    default: return false;
  }
}
// Start of the hour's role setting (world.js, before work.js workHour): everyone helping goes back to their own job.
export function helpRestore(state) {
  for (const s of state.survivors) {
    if (!s.helpWas) continue;
    const w = s.helpWas;
    delete s.helpWas;
    if (s.alive && s.role === w.as) { s.role = w.role; s.station = w.role === "operate" ? w.station : null; }
  }
}
// Every hour after every role is set (world.js, after sickrest.js sickRestHour): a Manual person whose job has no
// work this hour helps with the first job in HELP_ORDER that has work and room (last hour's help first).
export function helpHour(state) {
  const h = hourOfDay(state);
  for (const base of state.bases) {
    const ppl = atBase(state, base.id);
    if (!ppl.length) continue;
    const count = {};
    for (const s of ppl) count[s.role] = (count[s.role] || 0) + 1;
    let stations = false;
    for (const s of [...ppl].sort((a, b) => a.id - b.id)) {
      if (!noWorkNow(state, base, s)) continue;
      const why = describeActivity(state, s).text;
      const prev = s.helpLast && s.helpLast.hour === state.hour - 1 && s.helpLast.from === s.role ? s.helpLast.role : null;
      const order = prev ? [prev, ...HELP_ORDER.filter((j) => j !== prev)] : HELP_ORDER;
      const job = order.find((j) => j !== s.role && helpOpen(state, base, s, j, h, count));
      if (!job) continue;
      if (s.role === "operate") stations = true;
      s.helpWas = { role: s.role, station: s.station ?? null, base: base.id, as: job, hour: state.hour, why };
      count[s.role]--; count[job] = (count[job] || 0) + 1;
      s.helpLast = { role: job, from: s.role, hour: state.hour };
      s.role = job;
      s.station = null;
    }
    if (stations) assignStations(state, base);
  }
}
// Midnight, before the bases' day (world.js, with work.js workDayRoles): a Manual person whose job has no work, who
// helped today, counts at the job they helped with last (the farms count their farmers then); back at the hour's
// role setting (helpRestore).
export function helpDayRoles(state) {
  for (const base of state.bases) {
    for (const s of atBase(state, base.id)) {
      const L = s.helpLast;
      if (!L || s.helpWas || state.hour - L.hour > 24 || s.role !== L.from || isManaged(state, s) || !canHelp(state, base, s)) continue;
      if (!NO_WORK.has(workingActivity(state, s).kind)) continue;
      s.helpWas = { role: s.role, station: s.station ?? null, base: base.id, as: L.role, hour: state.hour, why: "the day's work" };
      s.role = L.role;
      s.station = null;
    }
  }
}

// ---------- the alert: roles with no work (by the job) ----------
// [{ base, job, name, people, why, helping: [{ s, as }] }] for Manual and pinned people at your bases (not while the
// dev autopilot runs: it moves them itself).
export function noWorkRoles(state) {
  if (state.autopilot) return [];
  const out = [];
  for (const base of state.bases) {
    const rows = new Map();
    for (const s of atBase(state, base.id)) {
      if (isManaged(state, s)) continue;
      const role = assignedRole(s);
      if (!canHelp(state, base, s, role)) continue;
      const a = jobCheck(state, base, s, role, helpingAs(s) ? s.helpWas.station : s.station);
      if (!NO_WORK.has(a.kind)) continue;
      if (!rows.has(role)) rows.set(role, { base, job: role, name: roleName(role), people: [], why: a.text, helping: [] });
      const r = rows.get(role);
      r.people.push(s);
      if (helpingAs(s)) r.helping.push({ s, as: helpingAs(s) });
    }
    out.push(...rows.values());
  }
  return out;
}
/** "Ana and Bo help chop wood" for the alert's tip. */
export const helpingText = (row) => row.helping.map((x) => `${first(x.s)} ${(HELP_TEXT[x.as] || roleName(x.as)).replace(/^helping /, "helps ").replace(/^standing guard$/, "stands guard")}`).join(", ");

// ---------- 1. The governor ----------
// Its felling crew: woodcutters while felling or wood-giving clearing is queued here.
export function fellCrew(state, base, heads) {
  const left = chopJobs(base).filter((c) => (c.progress || 0) < c.hours - 1e-9).length;
  if (!left || underAttack(state, base)) return 0;
  const wn = woodNeed(state, base);
  const w = Math.max(0, base.stock.wood || 0);
  const n = 1 + (w < wn.dailyKeep + 3 * (wn.daily || 0) ? 1 : 0) + (w < wn.dailyKeep ? 1 : 0);
  return Math.min(n, left, Math.max(1, Math.floor(heads / NOIDLE.fellThird)));
}
/** The woodpile under the fires' days and three days' burn (autopilot.js govWoodwork's front of the queue): the felling's woodcutters go ahead of the builders. */
export function fellUrgent(state, base) {
  const wn = woodNeed(state, base);
  return Math.max(0, base.stock.wood || 0) < wn.dailyKeep + 3 * (wn.daily || 0);
}
/** The best woodcutter first: skill (woodcutterMult: Farming and Mechanics, health, wounds), the tool they carry, traits. */
export function fellScore(s) {
  let t = 1;
  if (hasTrait(s, "strongback")) t *= 1.05;
  if (hasTrait(s, "clumsy")) t *= 0.9; // axes slip
  if (hasTrait(s, "feeble")) t *= 0.9;
  return woodcutterMult(s) * bestChop(s).mult * t * Math.max(0.2, (s.health ?? 100) / 100);
}
export const fellFit = (small) => (x) => !x.inBed && (small || !x.leader) && (x.health ?? 100) >= 50 && !x.woundInfected;

// People the governor left with no work: [{ s, job, station, why }], one each, by the base's needs (idlework.js
// baseNeeds, room counted by roleOf: what the governor planned), then wood, then a lookout. areas: a steward's.
export function planNoIdle(state, base, list, roleOf, areas = null) {
  const needs = baseNeeds(state, base, roleOf).filter((n) => !areas || areas[ROLE_AREA[n.job]] !== false);
  const ppl = atBase(state, base.id);
  if (!woodWorkWhy(state, base) && Math.max(0, base.stock.wood || 0) < NOIDLE.woodSpare && !needs.some((n) => n.job === "wood") && (!areas || areas.production !== false)) needs.push({ job: "wood", score: 0.6, cap: 3 - ppl.filter((x) => roleOf(x) === "wood").length, why: `wood ${Math.round(base.stock.wood || 0)}: the builds' material`, station: null });
  if ((!areas || areas.production !== false) && localWork(state, base) && !needs.some((n) => n.job === "haul")) needs.push({ job: "haul", score: 0.3, cap: 2 - ppl.filter((x) => roleOf(x) === "haul").length, why: "local hauling: salvage and scrap near the base", station: null }); // hauling.js
  if (!areas || areas.defence !== false) needs.push({ job: "guard", score: 0.05, cap: 99, why: "a lookout on the walls", station: null });
  const plan = [];
  for (const s of [...list].sort((a, b) => a.id - b.id)) {
    const from = roleOf(s);
    const cands = needs.filter((n) => n.cap > 0 && n.job !== from && (n.job !== "medic" || skill(s, "medicine") >= 2));
    cands.sort((a, b) => (b.score - a.score) || (skill(s, JOB_SKILL[b.job] || "scavenging") - skill(s, JOB_SKILL[a.job] || "scavenging")));
    const pick = cands.find((n) => n.job === "guard" || !noWorkFor(state, base, s, n.job, n.station));
    if (!pick) continue;
    pick.cap--;
    if (pick.station != null) pick.cap = 0;
    plan.push({ s, from, job: pick.job, station: pick.station, why: pick.why });
  }
  return plan;
}
