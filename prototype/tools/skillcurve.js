// Skill progression census (a measurement, not pass/fail): autopilot campaigns run headless, every gainXp call
// recorded by where it came from (skills.js xpHooks), and per skill: the level gain per colonist over time (by how
// long they have been with the colony: 28 / 112 / 224 days), the gain in their main job's skill (the skill they got
// the most use XP in), the best gain, the share of colonists who crossed 5 / 8 / 10, the XP sources that fire
// (count, XP asked, XP added after the daily caps), the XP the caps clipped and the XP decay took. Also the designed
// curve from xpNeed and USE (what a full day of one job is worth). --drill adds one person per base role, every skill
// at 3 and pinned to that role all game, and prints their level in the role's skill after 28 / 56 / 112 / 224 days
// (the autopilot rarely keeps anyone on Guard, Medic or Build long enough for the census to show those jobs).
// Usage: node tools/skillcurve.js [days=224] [seeds=1,2,3] [--style balanced|cautious|aggressive|rotate] [--drill]
//                                 [--size normal] [--groups 8] [--json out.json] [--sources N] [--workers 3]
// (skills.js xpHooks is the only thing it needs from the game, so it also runs against an older checkout for an A/B.)
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { createWorld, tickHour, day, alive, hub, makeSurvivor, newId } from "../src/sim/world.js";
import { craftQueue, queueCraft } from "../src/sim/crafting.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { setAutopilot, PERSONALITIES } from "../src/sim/autopilot.js";
import { SKILLS } from "../src/sim/data.js";
import * as SK from "../src/sim/skills.js";
const { xpHooks, xpNeed, USE, CAP_USE, CAP_STUDY, BOOK_XP } = SK;

const SEASON = 28, YEAR = 112;
const TENURES = [SEASON, YEAR, 2 * YEAR];
const LEVELS = [5, 8, 10];
// The skill each base role trains (the XP the role's daily work gives; craft: the Crafting skill the role is named for).
const ROLE_SKILL = { farm: "farming", medic: "medicine", guard: "shooting", scavenge: "scavenging", build: "mechanics", craft: "crafting", operate: "mechanics",
  hunt: "scouting", fish: "scouting", forage: "farming", wood: "farming", teach: "leadership" };
const BANDS = [[0, 3], [4, 6], [7, 9], [10, 20]];
// The job drill (--drill): one extra person per role at the hub, every skill 3, pinned to that role all game (the
// autopilot runs the rest of the colony); a builder always has something to build and a crafter something to make.
const DRILL = { farm: "farming", guard: "shooting", medic: "medicine", scavenge: "scavenging", build: "mechanics", craft: "crafting", forage: "farming", wood: "farming" };
const DRILL_AT = [SEASON, 2 * SEASON, YEAR, 2 * YEAR];

// ---------- one campaign (in a worker) ----------
const SKIP_FN = new Set(["gainXp", "gainXpAll", "onGain", "gainXpRaw"]);
// The first stack frame outside gainXp / gainXpAll: "fn file:line"; for fightXp / battleXp also who called them.
function sourceOf() {
  const prev = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, cs) => cs;
  const err = {};
  Error.captureStackTrace(err, sourceOf);
  const cs = err.stack;
  Error.prepareStackTrace = prev;
  const frames = [];
  for (const c of cs) {
    const fn = c.getFunctionName() || "(anon)";
    if (SKIP_FN.has(fn.split(".").pop())) continue;
    const file = String(c.getFileName() || "").split(/[\\/]/).pop();
    frames.push(`${fn} ${file}:${c.getLineNumber()}`);
    if (frames.length >= 2) break;
  }
  if (!frames.length) return "?";
  const head = frames[0];
  return /^(fightXp|battleXp|(anon)) /.test(head) && frames[1] ? `${head} < ${frames[1].split(" ")[0]}` : head;
}

function runCampaign({ seed, days, style, size, groups, drill }) {
  const state = createWorld({ seed, factionCount: groups, size });
  state.started = true;
  setAutopilot(state, true, style);
  const drills = [];
  if (drill) {
    const h = hub(state);
    for (const role of Object.keys(DRILL)) {
      const s = makeSurvivor(state);
      for (const k of SKILLS) s.skills[k] = 3;
      s.traits = []; s.mood = 60; s.role = role; s.pinned = true; s.drill = role;
      s.location = { kind: "base", baseId: h.id };
      state.survivors.push(s);
      drills.push({ role, s, at: {}, days: 0, xp: { use: 0, study: 0, fight: 0 } });
    }
  }
  const DUMMY = Object.keys(BUILDINGS)[0];
  const drillHour = () => {
    const h = hub(state);
    if (!h) return;
    h.construction = h.construction.filter((j) => !j.drill);
    if (!h.construction.length) h.construction.push({ id: newId(state), type: DUMMY, target: -1, progress: 0, hours: 1e9, drill: true });
    if (!craftQueue(h).length) { h.stock.scrap = (h.stock.scrap || 0) + 3; queueCraft(state, h, "pipespear"); }
    for (const d of drills) if (d.s.alive) { d.s.role = d.role; d.s.pinned = true; d.s.mood = Math.max(d.s.mood, 50); }
  };
  const people = new Map(); // id -> { first, start, at: { tenure: levels }, last, lastDay, useXp: {}, studyXp: {} }
  const sources = {}; // "key|src|where" -> { n, asked, added }
  const clip = {}; // key -> { use: xp clipped, study, events }
  const decayLost = {}; // key -> xp
  const capDays = {}; // key -> survivor-days that hit CAP_USE
  const track = (s) => {
    let r = people.get(s.id);
    if (!r) { r = { id: s.id, first: day(state), start: { ...s.skills }, at: {}, last: { ...s.skills }, lastDay: day(state), useXp: {}, studyXp: {}, roles: {}, away: 0 }; people.set(s.id, r); }
    return r;
  };
  xpHooks.onGain = (st, s, key, asked, added, src) => {
    if (st !== state) return;
    if (s.drill) { const dr = drills.find((x) => x.s === s); if (dr && key === DRILL[dr.role]) dr.xp[src] = (dr.xp[src] || 0) + added; return; }
    const r = track(s);
    const where = sourceOf();
    const k = `${key}|${src}|${where}`;
    const e = sources[k] || (sources[k] = { n: 0, asked: 0, added: 0 });
    e.n++; e.asked += asked; e.added += added;
    (src === "study" ? r.studyXp : r.useXp)[key] = ((src === "study" ? r.studyXp : r.useXp)[key] || 0) + added;
    if (added < asked - 1e-6) {
      const c = clip[key] || (clip[key] = { use: 0, study: 0, events: 0 });
      c[src === "study" ? "study" : "use"] += asked - added; c.events++;
    }
  };
  xpHooks.onDecay = (st, s, key, lost) => { if (st === state) decayLost[key] = (decayLost[key] || 0) + lost; };
  let lastDay = day(state), crash = null;
  for (const s of alive(state)) if (!s.drill) track(s);
  const t0 = Date.now();
  try {
    while (day(state) <= days && !state.gameOver) {
      if (drills.length) drillHour();
      tickHour(state);
      const d = day(state);
      // Roles at noon (the night watch and midnight's day-work roles would blur them).
      if (state.hour % 24 === 12) for (const s of alive(state)) { if (s.drill) continue; const r = track(s); if (s.location && s.location.kind === "base") r.roles[s.role || "rest"] = (r.roles[s.role || "rest"] || 0) + 1; else r.away++; }
      if (d === lastDay) continue;
      // A new day: yesterday's caps, everyone's levels, tenure snapshots.
      for (const dr of drills) {
        if (!dr.s.alive) continue;
        if (dr.s.location.kind === "base") dr.days++;
        for (const T of DRILL_AT) if (d - 1 === T && !dr.at[T]) dr.at[T] = dr.s.skills[DRILL[dr.role]];
      }
      for (const s of alive(state)) {
        if (s.drill) continue;
        if (s.xpDay && s.xpDay.d === lastDay) for (const [k, v] of Object.entries(s.xpDay.use || {})) if (v >= CAP_USE - 1e-6) capDays[k] = (capDays[k] || 0) + 1;
        const r = track(s);
        r.last = { ...s.skills }; r.lastDay = d;
        const ten = d - r.first;
        for (const T of TENURES) if (ten >= T && !r.at[T]) r.at[T] = { ...s.skills };
      }
      lastDay = d;
    }
  } catch (e) { crash = `day ${day(state)}: ${e.stack.split("\n").slice(0, 4).join(" | ")}`; }
  xpHooks.onGain = null; xpHooks.onDecay = null;
  const drillOut = drills.map((d) => ({ role: d.role, skill: DRILL[d.role], alive: d.s.alive, days: d.days, at: d.at, end: d.s.skills[DRILL[d.role]], xp: d.xp }));
  return { seed, style, drill: drillOut, days: day(state), gameOver: !!state.gameOver, crash, ms: Date.now() - t0, people: [...people.values()], sources, clip, decayLost, capDays };
}

if (!isMainThread) {
  parentPort.postMessage(runCampaign(workerData));
} else {
  main();
}

// ---------- report ----------
function main() {
  const argv = process.argv.slice(2);
  const BOOL = new Set(["--drill"]);
  const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
  const pos = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && !BOOL.has(argv[i - 1])));
  const DAYS = Number(pos[0] || 2 * YEAR);
  const SEEDS = String(pos[1] || "1,2,3").split(",").map(Number);
  const STYLE = flag("--style", "balanced");
  const SIZE = flag("--size", "normal");
  const GROUPS = Number(flag("--groups", 8));
  const JSON_OUT = flag("--json", null);
  const NSRC = Number(flag("--sources", 40));
  const WORKERS = Math.max(1, Math.min(3, Number(flag("--workers", 3))));
  const DRILL_ON = argv.includes("--drill");
  const styles = Object.keys(PERSONALITIES);
  const jobs = SEEDS.map((seed, i) => ({ seed, days: DAYS, style: STYLE === "rotate" ? styles[i % styles.length] : STYLE, size: SIZE, groups: GROUPS, drill: DRILL_ON }));

  designedCurve();
  console.log(`\nRunning ${jobs.length} campaign(s), ${DAYS} days, style ${STYLE}, size ${SIZE}, ${GROUPS} groups, ${WORKERS} worker(s)...`);
  const results = [];
  let next = 0, running = 0;
  const file = fileURLToPath(import.meta.url);
  const launch = () => {
    while (running < WORKERS && next < jobs.length) {
      const job = jobs[next++];
      running++;
      const w = new Worker(file, { workerData: job });
      w.on("message", (r) => { results.push(r); console.log(`  seed ${r.seed} (${r.style}): day ${r.days}${r.gameOver ? " (fell)" : ""}${r.crash ? " CRASH " + r.crash : ""}, ${r.people.length} people, ${(r.ms / 1000).toFixed(0)}s`); });
      w.on("error", (e) => { results.push({ seed: job.seed, crash: String(e), people: [], sources: {}, clip: {}, decayLost: {}, capDays: {} }); console.log(`  seed ${job.seed}: worker error ${e}`); });
      w.on("exit", () => { running--; if (next < jobs.length) launch(); else if (running === 0) report(results, { DAYS, NSRC, JSON_OUT }); });
    }
  };
  launch();
}

function designedCurve() {
  const days = (from, to, perDay) => { let xp = 0; for (let L = from; L < to; L++) xp += xpNeed(L); return { xp, d: xp / perDay }; };
  const full = Math.max(USE.farm, USE.operate, USE.craft, USE.build);
  console.log(`Designed curve: xpNeed(L) = ${[0, 3, 5, 7, 10, 15, 19].map((L) => `${L}:${xpNeed(L)}`).join(" ")}; a full day of one job = ${full} XP (CAP_USE ${CAP_USE}, CAP_FIGHT ${SK.CAP_FIGHT ?? "-"}, CAP_STUDY ${CAP_STUDY}, BOOK_XP ${BOOK_XP}/h)`);
  for (const [a, b] of [[2, 6], [3, 7], [2, 10], [3, 10], [5, 10], [10, 15], [15, 16]]) {
    const r = days(a, b, full);
    console.log(`  ${String(a).padStart(2)} -> ${String(b).padStart(2)}: ${String(r.xp).padStart(5)} XP = ${r.d.toFixed(0).padStart(4)} days of daily work (${(r.d / SEASON).toFixed(1)} seasons)`);
  }
  // A day of each base role on paper (before treatments, kills and the like): days for a 3 to reach 7 and 10.
  const perDay = { farm: USE.farm, guard: USE.guard + 24 * (USE.watchHour || 0), medic: USE.medicRole, scavenge: USE.scavRole, build: USE.build,
    leader: USE.leader, forage: USE.forage ?? 4, wood: USE.wood ?? 3 };
  console.log(`  A day on each post (XP, capped at CAP_USE) and days for a 3 to reach 7 / 10: ${Object.entries(perDay).map(([k, v]) => { const x = Math.min(v, CAP_USE); return `${k} ${x} (${days(3, 7, x).d.toFixed(0)}/${days(3, 10, x).d.toFixed(0)})`; }).join(", ")}`);
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "-");
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : "-");
const pad = (s, n) => String(s).padStart(n);
const padr = (s, n) => String(s).padEnd(n);

function report(results, { DAYS, NSRC, JSON_OUT }) {
  results.sort((a, b) => a.seed - b.seed);
  const people = results.flatMap((r) => r.people.map((p) => ({ ...p, seed: r.seed })));
  // Main job skill: the skill with the most use XP added.
  for (const p of people) {
    let best = null, bv = 0;
    for (const [k, v] of Object.entries(p.useXp)) if (v > bv) { best = k; bv = v; }
    p.job = best;
  }
  // Main role: the base role they held most days (needs one that trains a skill and half their days in it).
  for (const p of people) {
    const ten = Math.max(1, p.lastDay - p.first);
    const [role, n] = Object.entries(p.roles).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    p.role = role; p.roleSkill = ROLE_SKILL[role] && n >= ten / 2 ? ROLE_SKILL[role] : null;
  }
  const roleDays = {};
  for (const p of people) { for (const [k, v] of Object.entries(p.roles)) roleDays[k] = (roleDays[k] || 0) + v; roleDays["(away)"] = (roleDays["(away)"] || 0) + p.away; }
  console.log(`
Colonist-days by role: ${Object.entries(roleDays).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  const colonyDays = people.reduce((a, p) => a + Math.max(0, p.lastDay - p.first), 0);
  console.log(`\n${people.length} colonists tracked over ${results.length} campaign(s), ${colonyDays} colonist-days.`);

  // The job drill.
  const drills = results.flatMap((r) => r.drill || []);
  if (drills.length) {
    console.log(`
Job drill: a 3 in every skill, pinned to one role at the hub (level in the role's skill at day ${DRILL_AT.join(" / ")}; days at a base)`);
    const roleRows = {};
    for (const role of Object.keys(DRILL)) {
      const xs = drills.filter((d) => d.role === role);
      const cell = (T) => { const v = xs.map((d) => d.at[T]).filter((x) => x != null); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : "-"; };
      roleRows[role] = Object.fromEntries(DRILL_AT.map((T) => [T, cell(T)]));
      const perDay = (src) => xs.reduce((a, d) => a + (d.xp[src] || 0), 0) / Math.max(1, xs.reduce((a, d) => a + d.days, 0));
      console.log(`  ${padr(role, 9)}${padr(DRILL[role], 11)}${DRILL_AT.map((T) => pad(cell(T), 7)).join("")}   XP a day: use ${perDay("use").toFixed(1)}, study ${perDay("study").toFixed(1)}, fight ${perDay("fight").toFixed(1)}; days ${xs.map((d) => d.days + (d.alive ? "" : "†")).join(",")}`);
    }
    results.drillRows = roleRows;
  }

  // Gains by tenure, every skill.
  console.log(`\nLevel gain per colonist by tenure (raw level; n = colonists who stayed that long). "job": colonists whose main-use skill it is.`);
  console.log(`${padr("skill", 11)}${TENURES.map((T) => `${pad(`all+${T}d`, 10)}${pad("best", 5)}${pad(`job+${T}d`, 10)}${pad("n", 4)}`).join("")}`);
  const rows = {};
  for (const k of SKILLS) {
    const row = { skill: k };
    let line = padr(k, 11);
    for (const T of TENURES) {
      const xs = people.filter((p) => p.at[T]);
      const gains = xs.map((p) => p.at[T][k] - (p.start[k] || 0));
      const jobs = xs.filter((p) => p.job === k).map((p) => p.at[T][k] - (p.start[k] || 0));
      const avg = gains.length ? gains.reduce((a, b) => a + b, 0) / gains.length : NaN;
      const javg = jobs.length ? jobs.reduce((a, b) => a + b, 0) / jobs.length : NaN;
      const best = gains.length ? Math.max(...gains) : NaN;
      row[`all${T}`] = avg; row[`best${T}`] = best; row[`job${T}`] = javg; row[`jobn${T}`] = jobs.length;
      line += `${pad(f1(avg), 10)}${pad(Number.isFinite(best) ? best : "-", 5)}${pad(f1(javg), 10)}${pad(jobs.length, 4)}`;
    }
    rows[k] = row;
    console.log(line);
  }

  // Role workers: colonists who held one role at least half their days, the gain in that role's skill by start band.
  console.log(`
Role workers (a role held >= half their days): gain in the role's skill by tenure, by starting level band`);
  console.log(`${padr("role skill", 11)}${BANDS.map(([a, b]) => TENURES.map((T) => pad(`${a}-${b}+${T}`, 11)).join("")).join("")}`);
  const roleRows = {};
  for (const k of [...new Set(Object.values(ROLE_SKILL))]) {
    let line = padr(k, 11);
    roleRows[k] = {};
    for (const [a, b] of BANDS) for (const T of TENURES) {
      const xs = people.filter((p) => p.roleSkill === k && p.at[T] && (p.start[k] || 0) >= a && (p.start[k] || 0) <= b).map((p) => p.at[T][k] - (p.start[k] || 0));
      const avg = xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : NaN;
      roleRows[k][`${a}-${b}+${T}`] = { avg, n: xs.length };
      line += pad(xs.length ? `${f1(avg)} (${xs.length})` : "-", 11);
    }
    console.log(line);
  }

  // Trip-goers: colonists away from base (on teams) at least a quarter of their days: the field skills.
  const trippers = people.filter((p) => p.away >= Math.max(1, p.lastDay - p.first) / 4);
  console.log(`
Trip-goers (away >= 1/4 of their days; n at +${SEASON}/+${YEAR}/+${2 * YEAR}): ${TENURES.map((T) => trippers.filter((p) => p.at[T]).length).join("/")}`);
  for (const k of ["scouting", "scavenging", "stealth", "shooting", "speech", "leadership", "medicine"]) {
    const cells = TENURES.map((T) => { const xs = trippers.filter((p) => p.at[T]).map((p) => p.at[T][k] - (p.start[k] || 0)); return pad(xs.length ? `${f1(xs.reduce((a, b) => a + b, 0) / xs.length)} max ${Math.max(...xs)}` : "-", 14); }).join("");
    console.log(`${padr(k, 11)}${cells}`);
    rows[k].trip = TENURES.map((T) => { const xs = trippers.filter((p) => p.at[T]).map((p) => p.at[T][k] - (p.start[k] || 0)); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; });
  }

  // Milestones crossed (started below, ever reached by the last look) and XP per colonist-day.
  console.log(`\nMilestones crossed (of colonists who started below it, with >= ${SEASON} days in the colony) and XP per colonist-day`);
  console.log(`${padr("skill", 11)}${LEVELS.map((L) => pad(`->${L}`, 12)).join("")}${pad("use/day", 9)}${pad("study/d", 9)}${pad("capDays", 9)}${pad("clipped", 9)}${pad("decay", 7)}`);
  const stayers = people.filter((p) => p.lastDay - p.first >= SEASON);
  const sumAll = (pick) => { const o = {}; for (const r of results) for (const [k, v] of Object.entries(pick(r) || {})) o[k] = (o[k] || 0) + (typeof v === "number" ? v : v.use + v.study); return o; };
  const capDays = sumAll((r) => r.capDays), clipped = sumAll((r) => r.clip), decay = sumAll((r) => r.decayLost);
  for (const k of SKILLS) {
    const cells = LEVELS.map((L) => {
      const below = stayers.filter((p) => (p.start[k] || 0) < L);
      const crossed = below.filter((p) => (p.last[k] || 0) >= L);
      rows[k][`cross${L}`] = below.length ? crossed.length / below.length : NaN;
      return pad(`${crossed.length}/${below.length} ${pct(crossed.length, below.length)}`, 12);
    }).join("");
    const use = people.reduce((a, p) => a + (p.useXp[k] || 0), 0) / Math.max(1, colonyDays);
    const study = people.reduce((a, p) => a + (p.studyXp[k] || 0), 0) / Math.max(1, colonyDays);
    rows[k].useDay = use; rows[k].studyDay = study;
    console.log(`${padr(k, 11)}${cells}${pad(use.toFixed(2), 9)}${pad(study.toFixed(2), 9)}${pad(capDays[k] || 0, 9)}${pad(Math.round(clipped[k] || 0), 9)}${pad(Math.round(decay[k] || 0), 7)}`);
  }

  // Sources.
  const src = {};
  for (const r of results) for (const [k, v] of Object.entries(r.sources)) { const e = src[k] || (src[k] = { n: 0, asked: 0, added: 0 }); e.n += v.n; e.asked += v.asked; e.added += v.added; }
  const list = Object.entries(src).map(([k, v]) => { const [skill, kind, where] = k.split("|"); return { skill, kind, where, ...v }; });
  console.log(`\nXP sources by skill (count of calls, XP asked, XP added after caps; per campaign averages), top ${NSRC} overall then any skill's top 3:`);
  const n = Math.max(1, results.length);
  const shown = new Set();
  const printSrc = (e) => { const id = `${e.skill}|${e.kind}|${e.where}`; if (shown.has(id)) return; shown.add(id); console.log(`  ${padr(e.skill, 11)}${padr(e.kind, 6)}${pad(Math.round(e.n / n), 8)}${pad(Math.round(e.asked / n), 8)}${pad(Math.round(e.added / n), 8)}  ${e.where}`); };
  console.log(`  ${padr("skill", 11)}${padr("src", 6)}${pad("calls", 8)}${pad("asked", 8)}${pad("added", 8)}  where`);
  [...list].sort((a, b) => b.added - a.added).slice(0, NSRC).forEach(printSrc);
  for (const k of SKILLS) list.filter((e) => e.skill === k).sort((a, b) => b.added - a.added).slice(0, 3).forEach(printSrc);
  const totals = {};
  for (const e of list) totals[e.skill] = (totals[e.skill] || 0) + e.added;
  console.log(`\nXP added per campaign by skill: ${SKILLS.map((k) => `${k} ${Math.round((totals[k] || 0) / n)}`).join(", ")}`);
  const still = SKILLS.filter((k) => rows[k].all112 < 0.5 || !Number.isFinite(rows[k].all112));
  if (still.length) console.log(`Barely moving (avg gain < 0.5 a level per colonist over ${YEAR} days): ${still.join(", ")}`);
  if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify({ days: DAYS, seeds: results.map((r) => r.seed), rows, roleRows, roleDays, drill: results.drillRows || null, sources: list, crashes: results.filter((r) => r.crash).map((r) => r.crash) }, null, 1)); console.log(`wrote ${JSON_OUT}`); }
  const crashes = results.filter((r) => r.crash);
  if (crashes.length) { console.log(`\n${crashes.length} crash(es):`); for (const r of crashes) console.log(`  seed ${r.seed}: ${r.crash}`); }
}
