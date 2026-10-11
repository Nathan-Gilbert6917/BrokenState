// Putting the idle to work: the job a base needs most for each person with nothing to do (activity.js idlePeople),
// for the "Assign all idle" button (a preview, then the roles) and for the base leader and the governor, who read the
// stalled jobs once a day and move the people on them.
//
// planIdle(state, base, people?) → [{ s, from, job, station, why }]: one job each, by what the base needs now, best
//   first, each job only while it has room (a hand count from the base's own sizing: woodHandsWanted, farmersWanted,
//   the build queue's builders, one crafter, a free station each, one medic …), and only a job this person can do
//   here (activity.js jobCheck: not "stalled" for them: the land, the tools, the skill a craft needs …).
//   Needs, highest first: a patient in danger with nobody on Medic; firewood short as the cold comes (by how near);
//   food under a week (the plots first, then wild food: forage, hunt, fish); water running short (Fetch water); a broken well, pump or wall to repair; the
//   build queue (water builds first); food under 20 days; the Kitchen short of cooks (kitchen.js: one per 12 people);
//   a free station with work; the craft queue; firewood for the
//   coming season; scavenging around the base while it is not picked clean (the last resort).
// applyIdlePlan(state, base, plan, hold?) puts each on their job by hand (Manual, as the role drop-down does).
// leaderIdleHour(state) (world.js, hourly; acts at IDLE_HOUR): at each base run by the governor (the dev autopilot) or
//   by a leader with Roles handed over, the people on a job found stalled at a midnight before (base.stall: at least a
//   day) are moved to what the base needs, by planIdle, and held there for a day (s.govIdle: autopilot.js planRoles
//   keeps them, so the hourly plan does not move them back). Not pinned people, people on work priorities (they plan
//   themselves), the leader, or roles in an area the leader was not handed. One log line each:
//   "Leader Ana moved Sam from Build (nothing to build) to Cut wood (firewood 120 of 900 for the cold)."
// The AI groups have no people with jobs of their own (factions.js: counts and stores), so nothing of theirs idles.
import { gearOutdoorWorkers, gearText } from "./tripgear.js"; // Assign all idle: the outdoor workers geared for the land (trips-plus #2)
import { atBase, hourOfDay, day, log, skill } from "./world.js";
import { ROLES, scavLeft, SCAV_FLOOR, waterRunningShort, waterOutlook, fetchWaterWhy, fetchWaterDay } from "./economy.js";
import { isManaged, toManual, stationWork } from "./work.js";
import { BUILDINGS, stations, underAttack, assignStations, gatherStalled } from "./buildings.js";
import { craftQueue, craftJobStatus } from "./crafting.js";
import { farmersWanted } from "./farming.js";
import { woodNeed, woodHandsWanted, woodWorkWhy } from "./woodcutting.js";
import { forageWorkWhy } from "./foraging.js";
import { huntWorkWhy, fishWorkWhy } from "./hunting.js";
import { isHurt, isSevere } from "./medical.js";
import { isSick } from "./health.js";
import { edibleFood } from "./storage.js";
import { actingLeader } from "./steward.js";
import { ROLE_AREA } from "./autopilot.js";
import { idlePeople, jobCheck, dayJob } from "./activity.js";
import { hasKitchen, cooksWanted, isCook, kitchenCanLight } from "./kitchen.js"; // the Kitchen's cooks

export const IDLE_HOUR = 7; // the leader's and the governor's daily look at the stalled jobs
const first = (s) => s.name.split(" ")[0];
const n0 = (v) => Math.round(v || 0);

// What this base needs, as open jobs: [{ job, score, cap, why, station? }], best first.
export function baseNeeds(state, base) {
  const ppl = atBase(state, base.id);
  const on = (job) => ppl.filter((s) => s.role === job).length;
  const foodDays = edibleFood(base) / Math.max(1, ppl.length);
  const out = [];
  const add = (job, score, cap, why, station = null) => { if (cap > 0 && score > 0) out.push({ job, score, cap, why, station }); };
  // Care: a patient in danger and nobody on Medic.
  const pts = ppl.filter((s) => isSevere(s) || s.woundInfected || (isSick(s) && isHurt(s)));
  if (pts.length && !on("medic")) add("medic", 9, 1, `${pts.length} badly hurt or ill here and no medic`);
  // Firewood: by how near the cold is.
  const w = woodNeed(state, base);
  if (w.short && w.need > 0 && !woodWorkWhy(state, base) && !(state.governor && state.governor.noWood)) { // gov.noWood: the test switch (woodtest.js)
    const score = w.cold ? 8.5 : w.toCold <= 14 ? 7 : w.soon ? 5 : 1.5;
    add("wood", score, Math.max(1, woodHandsWanted(state, base, { w })) - on("wood"), `firewood ${n0(w.have)} of ${n0(w.need)} for the cold${w.cold ? " (it is here)" : ` (in ${w.toCold} days)`}`);
  }
  // Food.
  const fw = farmersWanted(state, base);
  const hungry = foodDays < 7 ? 8 : foodDays < 20 ? 4.5 : 0;
  const foodWhy = `food for ${Math.floor(foodDays)} days`;
  if (fw.active + fw.toSow > 0) add("farm", hungry ? hungry + 0.5 : 2, Math.max(0, fw.ideal - on("farm")), hungry ? foodWhy : `the plots want ${fw.ideal} farmers`);
  if (hungry) {
    if (!forageWorkWhy(state, base)) add("forage", hungry, 3 - on("forage"), foodWhy);
    if (!huntWorkWhy(state, base)) add("hunt", hungry - 0.2, 2 - on("hunt"), foodWhy);
    if (!fishWorkWhy(state, base)) add("fish", hungry - 0.4, 1 - on("fish"), foodWhy);
  }
  // Water running short with water to fetch on the base's land (job trips: Fetch water, as work.js WORK_TYPES.water sizes it).
  if (waterRunningShort(state, base) && !fetchWaterWhy(state, base)) {
    const wo = waterOutlook(state, base), each = Math.max(0.5, fetchWaterDay(state, base));
    add("water", wo.daysLeft < 3 ? 8 : 5, Math.max(1, Math.min(4, Math.ceil(Math.max(0, -wo.net) / each))) - on("water"), isFinite(wo.daysLeft) ? `water for ${Math.floor(Math.max(0, wo.daysLeft))} days` : "the water is low");
  }
  // Repairs: a broken well, pump or wall with nobody on it.
  const open = (base.repairs || []).filter((j) => j.who == null).length;
  if (open) add("build", 6.5, open, `${open} repair${open === 1 ? "" : "s"} waiting`);
  // The build queue.
  const job = base.construction.find((c) => !gatherStalled(c));
  if (job && !underAttack(state, base)) {
    const water = ["well", "rain_catcher", "cistern"].includes(job.type);
    add("build", water ? 7 : 4, (water ? 4 : 3) - on("build"), `${BUILDINGS[job.type] ? BUILDINGS[job.type].name : job.type} queued (${n0(job.hours - job.progress)} work-hours left)`);
  }
  // The Kitchen short of cooks (kitchen.js): hot meals stretch the food (−10%) for the people a cook feeds.
  if (hasKitchen(base) && kitchenCanLight(state, base)) add("cook", 3.5, cooksWanted(state, base) - ppl.filter((s) => isCook(state, s)).length, `the kitchen wants ${cooksWanted(state, base)} cook${cooksWanted(state, base) === 1 ? "" : "s"} for ${ppl.length} people: hot meals stretch the food`);
  // Stations with work and nobody on them.
  const busy = new Set(ppl.filter((s) => s.role === "operate").map((s) => s.station));
  for (const st of stations(base)) if (!busy.has(st.id) && !st.broken && BUILDINGS[st.type].station !== "power" && !stationWork(state, base, st)) add("operate", 3, 1, `the ${BUILDINGS[st.type].name.toLowerCase()} has work and no operator`, st.id);
  // The craft queue.
  if (!on("craft") && craftQueue(base).length) add("craft", 3, 1, `${craftQueue(base).length} in the craft queue`);
  // The last resort.
  if (scavLeft(base) > SCAV_FLOOR + 0.02) add("scavenge", 0.5, 99, "picking through the ruins around the base");
  return out.sort((a, b) => b.score - a.score);
}

const JOB_SKILL = { water: "scouting", cook: "cooking", medic: "medicine", wood: "farming", farm: "farming", forage: "farming", hunt: "shooting", fish: "scouting", build: "mechanics", operate: "mechanics", craft: "crafting", scavenge: "scavenging" };

// One job each for these people (default: the base's idle), by the base's needs. areas: a leader's areas (only jobs
// in an area handed over).
export function planIdle(state, base, people = null, { areas = null } = {}) {
  const list = people || idlePeople(state, base).map((x) => x.s);
  const needs = baseNeeds(state, base).filter((n) => !areas || areas[ROLE_AREA[n.job]] !== false);
  const plan = [];
  for (const s of [...list].sort((a, b) => a.id - b.id)) {
    const from = dayJob(state, s);
    const cands = needs.filter((n) => n.cap > 0 && n.job !== from && (n.job !== "medic" || skill(s, "medicine") >= 2));
    // Best need first; between needs within a point, the one they are best at.
    cands.sort((a, b) => (b.score - a.score) || (skill(s, JOB_SKILL[b.job] || "scavenging") - skill(s, JOB_SKILL[a.job] || "scavenging")));
    const pick = cands.find((n) => jobCheck(state, base, s, n.job, n.station).kind !== "stalled");
    if (!pick) continue;
    pick.cap--;
    if (pick.station != null) pick.cap = 0;
    plan.push({ s, from, job: pick.job, station: pick.station, why: pick.why });
  }
  return plan;
}

// "Sam → Cut wood, Ana → Forage".
export const planText = (plan) => plan.map((p) => `${first(p.s)} → ${ROLES[p.job] ? ROLES[p.job].name : p.job}`).join(", ");

// Puts each on their job by hand (Manual). hold: hours the governor's hourly plan keeps them there (s.govIdle).
export function applyIdlePlan(state, base, plan, hold = 0) {
  for (const p of plan) {
    toManual(state, p.s);
    p.s.role = p.job;
    p.s.station = p.job === "operate" ? p.station : null;
    if (hold > 0) p.s.govIdle = { role: p.job, station: p.station ?? null, until: state.hour + hold };
  }
  if (plan.length) assignStations(state, base);
  // tripgear.js (trips-plus #2): those put on an outdoor job get what the armory can spare for the land
  const geared = plan.length ? gearOutdoorWorkers(state, base, { who: plan.map((p) => p.s), pinned: true }) : [];
  return plan.length ? `${base.name}: ${planText(plan)}.${geared.length ? ` Geared for the land: ${gearText(geared)}.` : ""}` : `${base.name}: nothing here has room for them now.`;
}

// Hourly (world.js, after the governor and the stewards); acts once a day at IDLE_HOUR.
export function leaderIdleHour(state) {
  for (const s of state.survivors) if (s.govIdle && state.hour >= s.govIdle.until) delete s.govIdle;
  if (hourOfDay(state) !== IDLE_HOUR || state.gameOver) return;
  for (const base of state.bases) {
    const gov = !!state.autopilot;
    const st = base.steward && base.steward.on ? base.steward : null;
    if (!gov && !(st && st.areas && st.areas.roles !== false)) continue;
    const L = gov ? null : actingLeader(state, base);
    if (!gov && !L) continue; // nobody to lead it this hour
    const areas = gov ? null : st.areas;
    const stall = base.stall || {};
    const cands = idlePeople(state, base).filter((x) => {
      const s = x.s, job = dayJob(state, s);
      return x.act.kind === "stalled" && !s.pinned && !isManaged(state, s) && (!L || s.id !== L.id) && stall[job] != null && day(state) - stall[job] >= 1 && (!areas || areas[ROLE_AREA[job]] !== false);
    }).map((x) => x.s);
    if (!cands.length) continue;
    const whyOf = new Map(idlePeople(state, base).map((x) => [x.s.id, x.why]));
    const plan = planIdle(state, base, cands, { areas });
    if (!plan.length) continue;
    applyIdlePlan(state, base, plan, 24);
    const who = gov ? "The governor" : `Leader ${first(L)}`;
    for (const p of plan) log(state, `${base.name}: ${who} moved ${first(p.s)} from ${ROLES[p.from] ? ROLES[p.from].name : p.from} (${String(whyOf.get(p.s.id) || "stalled").replace(/^[^:–]*[:–]\s*/, "")}) to ${ROLES[p.job] ? ROLES[p.job].name : p.job} (${p.why}).`, "info");
  }
}
