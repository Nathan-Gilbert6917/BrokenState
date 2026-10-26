// @ts-check
// Woodwork (the user's picks 2026-10-20, branch woodwork): the woodcutters fell the trees marked on the base map, and
// the governor fells trees for wood and clears its building sites ahead.
//
// - Chop jobs: a clearing job in the construction queue (basemap.js queueClear, basescatter.js CLEAR) that gives wood
//   (a tree, a fallen log, a stump, a bush, a fence panel: isChopJob; never a strip of a wreck). The builders work it
//   from the queue as before (buildings.js constructionHour, the first job they can); the people on Cut wood (role
//   "wood") work every chop job ahead of their trips out to the land (jobtrips.js stepPerson: in the job's daylight
//   hours, chopHour instead of a trip; one out on a trip when it is marked finishes that trip first), the first in the
//   queue first, at chopRate work-hours an hour (WOODWORK.pace a woodcutter of average skill, ×their skill, health and
//   the season, as woodcutting.js: an average one fells a tree in about 4 hours; the job's own hours already count
//   the want of a cutting tool, CLEAR.NO_TOOL). The yield goes into the stores when the job is done (finishClear), the
//   Work now panel's Cut wood line with it. Who worked it in the last hour (job.chop: survivor id → hour; the builders:
//   job.built) is shown on the base map with its progress (basemap.js F.clearing who, ui/isoview.js, ui/basemap.js).
// - The governor (autopilot.js govWoodwork, every WOODWORK.govEvery hours): when the woodpile (with the wood the chop
//   jobs queued will bring) is under the fires' reserve (the same keep its builds leave: buildWoodKeep) plus the wood
//   of its next builds (the Ring wall's still to come in, the next wish's), it queues the felling of the nearest trees
//   beyond the walls (nearestTrees: outside the ring by WOODWORK.beyond cells, so the yard's layout never shifts), one
//   job a tree, at most WOODWORK.govMax of its own waiting at a time. And it clears ahead (clearAhead): the sites of the
//   builds it has queued (basemap.js siteWaits, at once rather than when the build comes up) and of the one it will
//   queue next (siteFor: where the auto layout would put it), only where the layout found no open ground; nothing else.
// AI groups have no grid: their land clearing stays coarse (groupworks.js: their crew cuts a build's wood).
import { atBase } from "./world.js";
import { woodcutterMult, seasonWood, WOOD } from "./woodcutting.js";
import { landFor, queueClear, finishClear, siteWaits, itemByKey, autoLayout, landUnder, ringHalf, FOOT, WALL_KINDS } from "./basemap.js"; // call-time only (the modules load in a circle)
import { noteOutput } from "./output.js";
import { BUILDINGS } from "./buildings.js"; // call-time only
import * as Weather from "./weather.js";
import { gainXp, USE } from "./skills.js"; // the felling teaches as the trips do (woodcutting.js woodTrip)

export const WOODWORK = {
  pace: 1,        // work-hours an hour of an average woodcutter (woodcutterMult avg) felling on the base map
  avg: 0.85,      // an average woodcutter's woodcutterMult (skill ~3)
  storm: 0.4,     // a storm over the base (woodcutting.js WOOD.storm)
  govEvery: 2,    // the governor looks every this many hours
  govMax: 3,      // its own felling jobs waiting at a time (a tree each: no mass clearing)
  beyond: 6,      // cells beyond the ring (ringHalf) a tree it fells for wood stands at least (the trench lines, the yard untouched)
  kinds: ["tree", "log"], // what it fells for wood (120 and 40 wood: basescatter.js CLEAR)
};
const TEMP_ID = -7; // siteFor's stand-in job (never a real id: newId starts at 1)

// ---------- chop jobs ----------
/** A clearing job that gives wood. @param {any} c */
export const isChopJob = (c) => !!c && c.type === "clear" && c.mode !== "strip" && !!c.get && (c.get.wood || 0) > 0;
/** The chop jobs at a base, queue order. @param {any} base */
export const chopJobs = (base) => ((base && base.construction) || []).filter(isChopJob);
export const hasChopWork = (base) => chopJobs(base).some((c) => (c.progress || 0) < c.hours - 1e-9);
/** Work-hours an hour s puts into felling (their skill, health, the season, a storm). @param {any} state @param {any} s */
export function chopRate(state, s, hour = state.hour) {
  const storm = Weather.weather(state, hour).severe ? WOODWORK.storm : 1;
  return Math.round(WOODWORK.pace * (woodcutterMult(s) / WOODWORK.avg) * seasonWood(state, hour) * storm * 1000) / 1000;
}
/**
 * One hour of a woodcutter at the chop jobs (jobtrips.js stepPerson, in the Cut wood hours): the first job with work
 * left; done, its yield into the stores. Returns the job worked, or null (nothing to fell).
 * @param {any} state @param {any} base @param {any} s
 */
export function chopHour(state, base, s, now = state.hour) {
  const job = chopJobs(base).find((c) => (c.progress || 0) < c.hours - 1e-9);
  if (!job) return null;
  const rate = chopRate(state, s, now);
  job.progress = (job.progress || 0) + rate;
  (job.chop || (job.chop = {}))[s.id] = now;
  s.chop = { base: base.id, job: job.id, hour: now };
  gainXp(state, s, "farming", USE.wood / WOOD.base.hours); // an hour of the trips' day's
  gainXp(state, s, "mechanics", USE.woodMech / WOOD.base.hours);
  noteOutput(state, base, "wood", 0, "wood"); // the day on the job (the Work now panel), the wood when it is done
  if (job.progress >= job.hours - 1e-9) {
    base.construction.splice(base.construction.indexOf(job), 1);
    finishClear(state, base, job);
    noteOutput(state, base, "wood", job.get.wood || 0, "wood");
  }
  return job;
}
/** Felling now, for the activity line: { job, pct } or null. @param {any} state @param {any} s */
export function chopNow(state, s) {
  const c = s && s.chop;
  if (!c || c.hour < state.hour - 1) return null;
  const base = state.bases.find((b) => b.id === c.base);
  const job = base && base.construction.find((x) => x.id === c.job);
  return job ? { job, base, pct: Math.min(100, Math.round((100 * (job.progress || 0)) / Math.max(1e-9, job.hours))) } : null;
}
/** Who is on a clearing job now (the last hour): the woodcutters on it and the builders working it. [names] @param {any} state @param {any} base @param {any} job */
export function chopHands(state, base, job) {
  const out = [];
  const recent = (h) => h != null && h >= state.hour - 1;
  for (const s of atBase(state, base.id)) {
    if (job.chop && recent(job.chop[s.id])) out.push(s.name.split(" ")[0]);
    else if (recent(job.built) && s.role === "build" && !s.inBed && !s.upkeep) out.push(s.name.split(" ")[0]);
  }
  return out;
}

// ---------- the governor's felling ----------
/** Wood the chop jobs queued here will still bring (the whole yield of each). @param {any} base */
export const queuedChopWood = (base) => chopJobs(base).reduce((a, c) => a + (c.get.wood || 0), 0);
/**
 * The nearest trees (and fallen logs) beyond the walls not already queued: [piece] nearest first.
 * @param {any} state @param {any} base @param {number} n
 */
export function nearestTrees(state, base, n) {
  const land = landFor(state, base);
  if (!land) return [];
  const busy = new Set(base.construction.filter((c) => c.type === "clear" && c.pieces).flatMap((c) => c.pieces.map((p) => p.g)));
  const R = ringHalf(base) + WOODWORK.beyond;
  const out = [];
  for (const p of land.list) {
    if (!WOODWORK.kinds.includes(p.k) || busy.has(p.g)) continue;
    const [x, y] = p.cells[0];
    if (Math.max(Math.abs(x), Math.abs(y)) <= R) continue;
    out.push({ p, d: Math.hypot(x, y) });
  }
  return out.sort((a, b) => a.d - b.d || (a.p.g < b.p.g ? -1 : 1)).slice(0, n).map((q) => q.p);
}
/**
 * Queue the felling of the nearest trees beyond the walls until the queued wood covers `wood`, at most WOODWORK.govMax
 * of the governor's own felling jobs waiting. Returns the jobs queued.
 * @param {any} state @param {any} base @param {number} wood
 */
export function queueChop(state, base, wood) {
  const mine = base.construction.filter((c) => c.type === "clear" && c.gov === "wood").length;
  const room = WOODWORK.govMax - mine;
  if (room <= 0 || !(wood > 0)) return [];
  const out = [];
  let left = wood;
  for (const p of nearestTrees(state, base, room)) {
    if (left <= 0) break;
    const job = queueClear(state, base, [p], { label: p.k === "tree" ? "Fell a tree for wood" : "Saw up a fallen log for wood" });
    if (!job) continue;
    job.gov = "wood";
    out.push(job);
    left -= job.get.wood || 0;
  }
  return out;
}
/**
 * Where the auto layout would put a build of this type if it were queued now, and the land in the way there: [piece]
 * (empty: open ground, no footprint, or no land).
 * @param {any} state @param {any} base @param {string} type
 */
export function siteFor(state, base, type) {
  const f = FOOT[type];
  const land = f && !f.fit && !WALL_KINDS.has(f.kind) ? landFor(state, base) : null;
  if (!land) return [];
  const temp = { id: TEMP_ID, type, progress: 0, hours: 1 };
  base.construction.push(temp);
  try {
    const key = `c:${TEMP_ID}`, it = itemByKey(state, base, key), at = it && autoLayout(state, base).get(key);
    return it && at ? landUnder(land, it, at).filter((p) => p.k !== "water") : [];
  } finally { base.construction.splice(base.construction.indexOf(temp), 1); }
}
/**
 * Clear ahead: the sites of the builds queued here (siteWaits queues each one's clearing just before it) and of the
 * next one (nextType), only where the land is in the way. Returns the clearing jobs queued.
 * @param {any} state @param {any} base @param {string | null} nextType
 */
export function clearAhead(state, base, nextType = null) {
  // Looked at again only when the queue or the next build changed (the auto layout is dear; the felling beyond the
  // walls moves nothing in the yard). The last look is kept on the base (base.aheadSig), so it is saved: kept by
  // module (a WeakMap, before issue #72), a loaded world looked again on its first hours, queued a clearing the
  // original never did, and played on differently (savetest's seed 42).
  const sig = `${base.construction.filter((c) => c.type !== "clear").map((c) => c.id).join(",")}|${nextType || ""}|${base.buildings.length}`;
  if (base.aheadSig === sig) return [];
  base.aheadSig = sig;
  if (!landFor(state, base)) return [];
  const before = new Set(base.construction.map((c) => c.id));
  for (const job of [...base.construction]) if (job.type !== "clear") siteWaits(state, base, job);
  if (nextType && BUILDINGS[nextType] && !base.construction.some((c) => c.gov === "ahead")) { // one site ahead at a time
    const hit = siteFor(state, base, nextType);
    if (hit.length) {
      const job = queueClear(state, base, hit, { label: `Clear ahead: the site for the ${BUILDINGS[nextType].name.toLowerCase()}` });
      if (job) job.gov = "ahead";
    }
  }
  return base.construction.filter((c) => !before.has(c.id));
}
