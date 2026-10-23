// @ts-check
// Terraforming the base map (the user's request 2026-10-23: "Add the ability to terraform the base build to add hills
// and create hollows it takes time requires a shovel and the more shovels and people the faster it is one shovel per
// person. If you have one shovel and 3 people building only one can work on the hollow until you have two more shovels
// in the base inventory or on the survivors building to dig the hollow together. Digging a hollow only works on dirt
// tiles and provides dirt when finished. This dirt can be used to create hills. When making a hill if it is adjacent to
// a hill meld them together to look smooth like they were created by the seed. Creating hills requires shovels too").
//
// Two orders on the base map's Build list (Terrain: Dig a hollow, Raise a hill), each over a rectangle the player picks
// (two clicks, its corners: the same click and hover as any build), up to TERRA.LEVELS levels at once (R steps it).
//   - The ground: only dirt (dirtProblem): plain ground (grass, the yard's trodden dirt, a crop field's soil, a hill or
//     a hollow of the tile's own), never the road or a paved lot (basemap.js NOT_SOIL), a tree, a rock, the crag, the
//     river, a wreck, a building, the wall's band, a doorway or what is being worked already.
//   - The shape (terraPlan): each cell up (or down) as many levels as asked, within the relief's range (−1 to 3: a
//     hollow a level down at most, the playtest 2026-10-23), then settled as the tile's own hills are (basescatter.js relaxHeights: never more than a level between neighbours,
//     eight ways; no hill or hollow a cell wide at any level, a 2 × 2 at least): a cell that breaks either rule comes a
//     level back toward where it was until none does. So the area becomes a hill (or a hollow) with nested levels and
//     the slopes round it, and next to a hill of the seed's it joins it: the same field, drawn the same way (ui/isoview.js
//     terrainPrims), the same to walk and to shoot over (combat.js c.h, c.ter).
//   - The work: one job in the construction queue (type "terra"), a step a cell-level (TERRA.HOURS work-hours each),
//     the lowest first when raising and the highest first when digging (no step of two between neighbours on the way).
//     Only builders with a shovel work it, one shovel a person (shovelCrew: the shovels on the builders and those in
//     the armory, TOOL_KINDS.dig): min(builders, shovels) of them, at their share of the builders' rate. With no shovel
//     it waits ("Needs a shovel") and the queue goes on to the next job (buildings.js constructionHour).
//   - Dirt (base.stock.dirt): a cell-level dug gives TERRA.DIRT, a cell-level raised takes as much (a dug hollow raises
//     an equal hill). Heaped in the yard like the woodpile: it takes no storage room, is not carried nor traded, and
//     raiders leave it (basestorage.js). A raise needs its dirt in the stores when it is ordered (less what the raises
//     queued still need), and waits for it should it run short.
//   - What is done is kept by cell (base.land.heightEdits: grid "x,y" → the level), laid over the tile's own relief
//     (basescatter.js landOf: the same accessors, land.heights and the rise and dip pieces), so the base map, a raid's
//     and a horde's map show it, a save keeps it, and building on it follows the levelled-ground rule (a hill dug down,
//     a hollow filled in first: CLEAR rise, dip). Clearing a cell (finishClear) drops its edit: it is level again.
// The governor never terraforms (autopilot.js: no reason to, and dirt has no other use). AI groups have no grid: none.
import { atBase, newId, log } from "./world.js";
import { allCarried } from "./inventory.js";
import { TOOL_KINDS } from "./data-tools.js";
import { landFor, occupancy, autoLayout, placeProblemAt, holdAuto, NOT_SOIL, LAND_WHY } from "./basemap.js"; // call-time only (the modules load in a circle)
import { pieceWord } from "./basescatter.js";
import { buildRate, onUpkeep } from "./buildings.js"; // call-time only
import { wearBaseTools } from "./toolreqs.js"; // call-time only
import { noteOutput } from "./output.js";

export const TERRA = {
  HOURS: { dig: 1, raise: 1 }, // work-hours a cell-level for one with a shovel (as CLEAR.rise and CLEAR.dip a level)
  DIRT: 10,                    // dirt a cell-level dug gives and a cell-level raised takes
  MAX: 16,                     // the area's longest side, in cells
  LO: -1, HI: 3,               // the relief's range (basescatter.js reliefLayer: hollows a level down at most, the playtest 2026-10-23)
  LEVELS: 3,                   // the most levels one order raises or sinks (R steps it: 1, 2, 3)
};
// The Build list's picks (ui/basemap.js; basemap.js layoutAct pickType).
export const TERRA_PICK = { dig: "terra:dig", raise: "terra:raise" };
export const terraModeOf = (bt) => (bt === TERRA_PICK.dig ? "dig" : bt === TERRA_PICK.raise ? "raise" : null);
export const TERRA_NAME = { dig: "Dig a hollow", raise: "Raise a hill" };
export const TERRA_VERB = { dig: "Digging a hollow", raise: "Raising a hill" };
/** The levels an order goes, from the pick's turn (layoutAct rotate). @param {number} rot */
export const terraLevels = (rot) => ((rot || 0) % TERRA.LEVELS) + 1;
const ck = (x, y) => `${x},${y}`;
const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

// ---------- the shovels ----------
const DIG_KEYS = new Set(TOOL_KINDS.dig.items);
const isShovel = (it) => !!it && DIG_KEYS.has(it.key) && !(it.dur != null && it.dur <= 0);
/**
 * Who digs: the builders here (buildings.js buildRate's: not in a hospital bed, not on upkeep), the shovels (one a
 * person: those the builders carry, then the armory's), and the workers, min(builders, shovels) of them (the ones with
 * their own first). { builders, workers, shovels }.
 * @param {any} state @param {any} base
 */
export function shovelCrew(state, base) {
  const builders = atBase(state, base.id).filter((s) => s.role === "build" && !s.inBed && !onUpkeep(state, base, s));
  const own = builders.filter((s) => allCarried(s).some(isShovel));
  const shelf = (base.armory || []).filter(isShovel).length;
  const rest = builders.filter((s) => !own.includes(s));
  return { builders, workers: [...own, ...rest.slice(0, shelf)], shovels: own.length + shelf };
}
/** The work-hours an hour on a terraforming job: the builders' rate, the share of them with a shovel. @param {any} state @param {any} base */
export function terraRate(state, base) {
  const c = shovelCrew(state, base);
  return c.builders.length && c.workers.length ? (buildRate(state, base) * c.workers.length) / c.builders.length : 0;
}
// "2 of 3 with shovels".
export const crewWords = (c) => `${c.workers.length} of ${c.builders.length} with shovels`;

// ---------- the ground ----------
// The 1 × 1 the placement rules are asked about (basemap.js placeProblemAt: off the map, the no-build margin, the wall's
// band, on top of or in the doorway of anything, a building's floor, a cell being worked already).
const PROBE = { kind: "prop", k: "crate", w: 1, h: 1, key: null, label: "the ground" };
/** The terraforming jobs here. @param {any} base */
export const terraJobs = (base) => ((base && base.construction) || []).filter((c) => c.type === "terra");
/** The cells of the queued terraforming jobs: grid "x,y" → the job (occupancy's work: nothing is placed there). @param {any} base */
export function terraBusy(base) {
  const out = new Map();
  for (const j of terraJobs(base)) for (const [x, y] of j.cells || []) out.set(ck(x, y), j);
  return out;
}
/**
 * Why a grid cell is no ground to dig or raise, or "": dirt is plain ground (grass, trodden dirt, a field's soil; a
 * hill's or a hollow's of the tile too), never the road or a paved lot, the land's pieces (a tree, a rock, the crag,
 * the river, a wreck, a building of a town), nor what stands or is going up on the map.
 * @param {any} base @param {any} land landFor @param {any} occ occupancy (its land left out) @param {number} x @param {number} y
 */
export function dirtProblem(base, land, occ, x, y) {
  const why = placeProblemAt(base, PROBE, x, y, 0, occ);
  if (why) return why.replace(/^On top of (.*)$/, (m, w) => `${w.charAt(0).toUpperCase()}${w.slice(1)} stands there`).replace(/^In the doorway of (.*)$/, "The doorway of $1: kept clear");
  const p = land.pieces.get(ck(x, y));
  if (p && p.spring) return "The pond: spring-fed, never filled in"; // basescatter.js SPRING
  if (p && p.k !== "rise" && p.k !== "dip") {
    if (p.k === "water") return "The river: not dirt";
    if (p.k === "crag" || p.k === "rock" || p.k === "boulder") return `${p.k === "crag" ? "The mountainside" : "Rock"}: not dirt`;
    if (p.parts) return `${pieceWord(p).replace(/^an? /, "A ")}: not dirt`;
    return `${LAND_WHY}: ${pieceWord(p)}`;
  }
  const f = land.floors.get(ck(x, y));
  if (NOT_SOIL.has(f)) return f === "road" ? "The road: not dirt" : "Paved ground: not dirt";
  return "";
}

// ---------- the plan ----------
/**
 * An order over the rectangle with corners a and b (grid cells): { ok, why, mode, levels, rect, cells (the cells that
 * change: [x, y, from, to]), out ([x, y, why]: left out), steps (cell-levels), hours, dirt (+ given, − taken),
 * have (dirt to hand for a raise), crew (shovelCrew), eta (hours at the crew's pace, or null) }.
 * @param {any} state @param {any} base @param {"dig" | "raise"} mode @param {number[]} a @param {number[]} b @param {number} [levels]
 */
export function terraPlan(state, base, mode, a, b, levels = 1) {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const crew = shovelCrew(state, base);
  const out = { ok: false, why: "", mode, levels, rect: { x0, y0, x1, y1 }, cells: [], out: [], steps: 0, hours: 0, dirt: 0, have: 0, crew, eta: null };
  const land = landFor(state, base);
  if (!land) return { ...out, why: "No base map here" };
  if (x1 - x0 + 1 > TERRA.MAX || y1 - y0 + 1 > TERRA.MAX) return { ...out, why: `At most ${TERRA.MAX} × ${TERRA.MAX} cells at a time` };
  const occ = occupancy(state, base, null, autoLayout(state, base));
  occ.land = null; // the land is dirtProblem's
  const crag = new Set(land.list.filter((p) => p.k === "crag").flatMap((p) => p.cells.map(([x, y]) => ck(x, y))));
  // The ground as it will be once the jobs queued are done (theirs are never this one's cells: occupancy work).
  const P = new Map(land.heights);
  for (const j of terraJobs(base)) for (const [x, y, , to] of j.cells || []) P.set(ck(x, y), to);
  const sgn = mode === "raise" ? 1 : -1, T = new Map();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const why = dirtProblem(base, land, occ, x, y);
    if (why) { out.out.push([x, y, why]); continue; }
    const p = P.get(ck(x, y)) || 0, t = Math.max(TERRA.LO, Math.min(TERRA.HI, p + sgn * levels));
    if (t !== p) T.set(ck(x, y), t); else out.out.push([x, y, mode === "raise" ? "As high as the land goes (3 levels)" : "As deep as a hollow goes (a level down)"]);
  }
  // Settled as the seed's hills are (basescatter.js relaxHeights): a level at most to any neighbour, and a 2 × 2 at
  // least at every level; a cell that breaks either comes a level back toward where it was, until none does.
  const lv = (x, y, h) => { const k = ck(x, y); return crag.has(k) ? (h > 0 ? 9 : -9) : T.has(k) ? T.get(k) : P.get(k) || 0; };
  for (let pass = 0, changed = true; changed && pass < 60; pass++) {
    changed = false;
    for (const [k, t] of [...T]) {
      const [x, y] = k.split(",").map(Number);
      let bad = N8.some(([dx, dy]) => !crag.has(ck(x + dx, y + dy)) && Math.abs(t - lv(x + dx, y + dy, t)) > 1);
      if (!bad && t) bad = ![[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([ox, oy]) => [[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dy]) => { const v = lv(x + ox + dx, y + oy + dy, t); return t > 0 ? v >= t : v <= t; }));
      if (!bad) continue;
      const nt = t - sgn, p = P.get(k) || 0;
      if (nt === p) { T.delete(k); out.out.push([x, y, mode === "raise" ? "Too narrow or too steep: a hill is at least 2 × 2 at each level, a level a step" : "Too narrow or too steep: a hollow is at least 2 × 2, a level a step"]); }
      else T.set(k, nt);
      changed = true;
    }
  }
  for (const [k, t] of T) { const [x, y] = k.split(",").map(Number); out.cells.push([x, y, P.get(k) || 0, t]); out.steps += Math.abs(t - (P.get(k) || 0)); }
  out.hours = Math.round(out.steps * TERRA.HOURS[mode] * 10) / 10;
  out.dirt = sgn > 0 ? -out.steps * TERRA.DIRT : out.steps * TERRA.DIRT;
  out.have = Math.max(0, Math.floor(base.stock.dirt || 0) - dirtOwed(base));
  const rate = terraRate(state, base);
  out.eta = rate > 0 ? Math.ceil(out.hours / rate) : null;
  if (!out.cells.length) return { ...out, why: out.out.length ? out.out[out.out.length - 1][2] : "Nothing to change there" };
  if (mode === "raise" && out.have < -out.dirt) return { ...out, why: `Needs ${-out.dirt} dirt (${out.have} to hand${dirtOwed(base) ? `, the rest owed to the hills queued` : ""}): dig a hollow for it` };
  return { ...out, ok: true };
}
/** The dirt the raises queued here still take. @param {any} base */
export const dirtOwed = (base) => terraJobs(base).filter((j) => j.mode === "raise").reduce((a, j) => a + (j.steps.length - (j.done || 0)) * TERRA.DIRT, 0);

// ---------- the job ----------
/**
 * Queue an order (terraPlan ok): one job, its steps a cell-level each, the lowest first raising (the highest first
 * digging), the cells held from building until it is done. Returns the job.
 * @param {any} state @param {any} base @param {any} plan
 */
export function queueTerra(state, base, plan) {
  holdAuto(state, base); // what the game placed stays where it is (basemap.js autoLayout)
  const sgn = plan.mode === "raise" ? 1 : -1, steps = [];
  for (const [x, y, from, to] of plan.cells) for (let v = from; v !== to; v += sgn) steps.push([x, y, v + sgn]);
  steps.sort((p, q) => sgn * (p[2] - q[2]) || p[1] - q[1] || p[0] - q[0]);
  const job = { id: newId(), type: "terra", mode: plan.mode, label: TERRA_NAME[plan.mode], levels: plan.levels, cells: plan.cells.map((c) => c.slice()), steps, done: 0, progress: 0, hours: plan.hours };
  base.construction.push(job);
  wearBaseTools(state, base, ["dig"]); // toolreqs.js: a makeshift shovel loses a use
  return job;
}
/** Why a terraforming job cannot go on now ("" when it can): no shovel at all, or a raise short of dirt. @param {any} state @param {any} base @param {any} job */
export function terraWaits(state, base, job) {
  if (!job || job.type !== "terra") return "";
  if (!shovelCrew(state, base).shovels) return "Needs a shovel";
  if (job.mode === "raise" && (base.stock.dirt || 0) < TERRA.DIRT) return `Needs ${TERRA.DIRT} dirt`;
  return "";
}
// A cell-level done: the cell's level kept (base.land.heightEdits), its dirt into (or out of) the heap.
function applyStep(base, job, [x, y, to]) {
  const L = base.land, E = L.heightEdits || (L.heightEdits = {});
  E[ck(x, y)] = to;
  base.stock.dirt = Math.max(0, (base.stock.dirt || 0) + (job.mode === "raise" ? -TERRA.DIRT : TERRA.DIRT));
}
/**
 * An hour of the builders on a terraforming job (buildings.js constructionHour, when it is the first job they can
 * work): the crew's work-hours added, each cell-level whose work is done laid (a raise's only with its dirt to hand),
 * the job gone when its last is. Returns the work-hours done.
 * @param {any} state @param {any} base @param {any} job
 */
export function terraHour(state, base, job) {
  const crew = shovelCrew(state, base), rate = terraRate(state, base);
  if (rate <= 0) return 0;
  const per = TERRA.HOURS[job.mode], was = job.progress;
  job.progress = Math.min(job.hours, job.progress + rate);
  job.built = state.hour; job.crew = crew.workers.map((s) => s.id); // who dug this hour (the map's tag, the activity line)
  const n0 = job.done || 0;
  while (job.done < job.steps.length && job.progress >= (job.done + 1) * per - 1e-9) {
    if (job.mode === "raise" && (base.stock.dirt || 0) < TERRA.DIRT) { job.progress = job.done * per; break; } // no more dirt: it waits (terraWaits)
    applyStep(base, job, job.steps[job.done]);
    job.done++;
  }
  if (job.done > n0) base.land.n = (base.land.n || 0) + 1; // basemap.js landFor made again
  noteOutput(state, base, "build", Math.max(0, job.progress - was), "workh");
  if (job.done >= job.steps.length) {
    base.construction.splice(base.construction.indexOf(job), 1);
    noteOutput(state, base, "build", 1, "done");
    const d = job.steps.length * TERRA.DIRT;
    log(state, `${base.name}: ${job.mode === "raise" ? `a hill raised on the base map (${job.cells.length} cells, −${d} dirt)` : `a hollow dug on the base map (${job.cells.length} cells, +${d} dirt)`}.`, "good");
  }
  return Math.max(0, job.progress - was);
}
/** Cancel a terraforming job: what is dug or raised stays (its dirt with it); the rest is not done. @param {any} base @param {number} id */
export function cancelTerra(base, id) {
  const job = terraJobs(base).find((c) => c.id === id);
  if (!job) return "That job is gone.";
  base.construction.splice(base.construction.indexOf(job), 1);
  return `${job.label} cancelled${job.done ? `: the ${job.done} cell-level${job.done === 1 ? "" : "s"} done stay${job.done === 1 ? "s" : ""} as ${job.mode === "raise" ? "raised" : "dug"}` : ""}.`;
}
/** The cells a job has still to work (the map's amber wash). @param {any} job */
export const terraLeft = (job) => { const s = new Map(); for (const [x, y] of job.steps.slice(job.done || 0)) s.set(ck(x, y), [x, y]); return [...s.values()]; };
/** A job's work done, 0-100. @param {any} job */
export const terraPct = (job) => Math.round((100 * (job.progress || 0)) / Math.max(1e-9, job.hours));
// A cell's edit dropped (the cell cleared: level ground again, basemap.js finishClear, clearUnder, clearAllLand).
/** @param {any} base @param {number} x @param {number} y */
export function unEdit(base, x, y) { if (base.land && base.land.heightEdits) delete base.land.heightEdits[ck(x, y)]; }
