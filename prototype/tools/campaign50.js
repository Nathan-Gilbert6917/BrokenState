// Long campaign census (requested 2026-10-05): many full games under the autopilot on big maps, half from a normal
// start and half from hardcore, trying to survive as long as possible and to win every way the game allows (every
// hive destroyed; the coalition over half the land; conquest breaking the groups, which counts as a coalition win;
// "Keep playing" after a hive win so the coalition can still win). The autopilot's styles are rotated so each one
// gets both starts. Reports every run (outcome, day, population, hives, coalition, conquest, deaths by cause),
// totals by start and by style, every crash with its stack, runs that look stuck (no events for a long stretch),
// and writes a JSON report for later reading. Seeds run in parallel worker threads (tools/wintest.js's pool).
// Usage: node tools/campaign50.js [games=50] [days=1095] [--size huge|120x80|normal,large,huge,120x80] [--groups 15-20] [--seed 1000]
//                                [--styles balanced,aggressive,cautious] [--mode both|normal|hardcore] [--preset hardcore-cautious|normal-cautious|all]
//                                [--out path.json] [--census] [--no-keep] [--log N] [--grep regex] [--fallen-grep] [--jsonl path]
// --jsonl path: every game is appended to that file as it finishes, and the games already in it are not run again
// (they join the report): a long census killed half way picks up where it stopped when run again.
// The testing items of docs/campaign-census-2026-10-06.md (2026-10-06):
//   - per-season columns: thirst and hunger deaths by season (weather.js season) per run and in the totals;
//   - `--size a,b,c`: the same set of games on each size, a report block per size and a comparison table at the end;
//   - coalition blockers at month 12, 24 and the end (alliance.js inviteProblem per living group outside), bucketed
//     the way the "why groups are outside" list is, printed per pass;
//   - hive storm rejections: autopilotStats(state).hiveRejects per run and summed (when the autopilot keeps them);
//   - `--preset`: a fixed mode / styles / groups / seed set for repeatable tuning (hardcore-cautious: 25 hardcore
//     cautious games from seed 5000, groups 15-20); `--fallen-grep`: `--grep` lines only for the runs that fell
//     (default pattern "ration|walked away" when no --grep is given);
//   - `--census`: the JSON goes to tools/census/<date>-<commit>.json (see tools/census/README.md).
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync, existsSync, appendFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { createWorld, tickHour, day, alive, hub, residents } from "../src/sim/world.js";
import { baseBeds } from "../src/sim/buildings.js";
import { setAutopilot, autopilotStats, PERSONALITIES } from "../src/sim/autopilot.js";
import { hiveStats } from "../src/sim/hives.js";
import { goalsProgress, inviteProblem, isMember } from "../src/sim/alliance.js";
import { ensureConquest } from "../src/sim/conquest.js";
import { clampGroups } from "../src/sim/worldsize.js";
import { season, SEASONS } from "../src/sim/weather.js";

// ---------- arguments ----------
const argv = process.argv.slice(2);
const BOOL_FLAGS = ["--no-keep", "--census", "--fallen-grep"];
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; };
const has = (name) => argv.includes(name);
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && !BOOL_FLAGS.includes(argv[i - 1])));
// Presets fix the knobs a tuning pass wants held still (the flags given on top still win).
const PRESETS = {
  "hardcore-cautious": { games: 25, mode: "hardcore", styles: "cautious", groups: "15-20", seed: 5000, grep: "ration|walked away", fallenGrep: true },
  "normal-cautious": { games: 25, mode: "normal", styles: "cautious", groups: "15-20", seed: 5000 },
  all: { games: 50, mode: "both", styles: Object.keys(PERSONALITIES).join(","), groups: "15-20", seed: 5000 },
};
const PRESET_NAME = flag("--preset", null);
if (PRESET_NAME && !PRESETS[PRESET_NAME]) { console.log(`unknown preset ${PRESET_NAME}; presets: ${Object.keys(PRESETS).join(", ")}`); process.exit(2); }
const PRESET = PRESETS[PRESET_NAME] || {};
const GAMES = Number(positional[0] || PRESET.games || 50);
const DAYS = Number(positional[1] || 1095);
const SIZES = flag("--size", "huge").split(",").map((s) => s.trim()).filter(Boolean); // one, or several for a sweep
const SIZE = SIZES[0];
const [GMIN, GMAX] = flag("--groups", PRESET.groups || "15-20").split("-").map(Number);
const SEED0 = Number(flag("--seed", PRESET.seed ?? 1000));
const STYLES = flag("--styles", PRESET.styles || Object.keys(PERSONALITIES).join(",")).split(",").filter((s) => PERSONALITIES[s]);
const KEEP = !has("--no-keep");
const MODE = flag("--mode", PRESET.mode || "both"); // both: the first half normal, the second hardcore; or one start for every game
const LOGN = Number(flag("--log", 0));
const FALLEN_GREP = has("--fallen-grep") || !!PRESET.fallenGrep; // print the grep lines only for the runs that fell
const GREP = flag("--grep", FALLEN_GREP ? PRESET.grep || "ration|walked away" : null); // collect every log line matching this regex (up to 300 a run), printed per run
const CENSUS = has("--census");
const COMMIT = (() => { try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "nocommit"; } })();
const TODAY = new Date().toISOString().slice(0, 10);
const CENSUS_DIR = join(dirname(fileURLToPath(import.meta.url)), "census");
const OUT = flag("--out", CENSUS ? join(CENSUS_DIR, `${TODAY}-${COMMIT}.json`) : null);
const JSONL = flag("--jsonl", null);
const STUCK_DAYS = 60; // a run with no log line of any kind for this long is reported as possibly stuck
const MONTHS = [12, 24]; // coalition blockers are recorded at these months and at the end
const SEASON_KEYS = SEASONS.map((s) => s.key);

// Why a group is outside the coalition (alliance.js inviteProblem's text), in a few buckets.
export function blockerBucket(why) {
  if (!why) return "could join";
  if (/not met/i.test(why)) return "not met";
  if (/radio reach|out of reach/i.test(why)) return "out of radio reach";
  if (/hostile/i.test(why)) return "hostile";
  if (/goodwill/i.test(why)) return "goodwill";
  if (/pact/i.test(why)) return "no pact";
  if (/at war/i.test(why)) return "at war with a member";
  if (/job|council/i.test(why)) return "job or council";
  if (/gone|already/i.test(why)) return "gone";
  return "other";
}
const BUCKETS = ["not met", "out of radio reach", "hostile", "goodwill", "no pact", "at war with a member", "job or council", "could join", "gone", "other"];

// A size argument: a preset key, or WxH for a custom map (worldsize.js customDef: huge is 100x66).
function sizeOpts(spec) {
  const m = /^(\d+)x(\d+)$/.exec(spec);
  return m ? { size: "custom", customW: Number(m[1]), customH: Number(m[2]) } : { size: spec };
}

// ---------- one campaign ----------
const EVENT = /Your team took|is no more|has fallen$|moved into|hive was destroyed|hive at .* was destroyed|was destroyed by your team|A new hive has risen|joined The Calder Coalition|left The Calder Coalition|has collapsed|Every hive is destroyed|Calder Coalition holds|holdout has fallen|storming a hive|fell back from the hive|brood drove the team off|\(hive\) to|founded|first hub|staging camp/;
function deathCause(text) {
  if (/hunger|starv/.test(text)) return "hunger";
  if (/thirst/.test(text)) return "thirst";
  if (/worm|parasite/.test(text)) return "worm";
  if (/cold|froze|exposure/.test(text)) return "cold";
  if (/hive/.test(text)) return "hive assault";
  if (/horde|Wallbreaker|the dead/.test(text) && !/defending|raid/.test(text)) return "horde";
  if (/defending|raid|overrun|was overrun/.test(text)) return "raid";
  if (/dysentery|flu|pneumonia|infect|fever|illness|sick|wound/.test(text)) return "illness";
  return "in the field";
}

function runOne(job) {
  const { seed, mode, style, groups, size, days, keep, logN, grep } = job;
  const grepRe = grep ? new RegExp(grep, "i") : null, grepLines = [];
  const t0 = Date.now();
  let state, error = null, crashDay = null;
  try {
    state = createWorld({ seed, factionCount: groups, mode, ...sizeOpts(size) });
  } catch (e) {
    return { ...job, outcome: "crash", error: `createWorld: ${e.stack.split("\n").slice(0, 4).join(" | ")}`, day: 0, ms: Date.now() - t0, samples: [], events: [], deaths: {}, end: {} };
  }
  state.started = true;
  setAutopilot(state, true, style);
  const samples = [], events = [], deaths = {};
  // Thirst and hunger deaths by season (weather.js season): { thirst: { spring, summer, autumn, winter }, hunger: {...} }.
  const bySeason = { thirst: {}, hunger: {} };
  for (const k of SEASON_KEYS) { bySeason.thirst[k] = 0; bySeason.hunger[k] = 0; }
  // Why each living group is outside the coalition, at month 12, 24 and the end (blockerBucket counts).
  const blockers = {};
  const recordBlockers = (label) => {
    const counts = {};
    try {
      for (const f of state.factions) {
        if (!f.alive || isMember(state, f)) continue;
        const k = blockerBucket(inviteProblem(state, f));
        counts[k] = (counts[k] || 0) + 1;
      }
    } catch { /* the alliance module mid-change: no blockers recorded */ }
    blockers[label] = counts;
  };
  let lastTop = state.log[0], hiveWinDay = null, lastEventDay = 1, longestQuiet = 0, lastLogDay = 1, longestSilent = 0, hubDay = null, monthAt = 0;
  const sample = () => {
    const gp = goalsProgress(state);
    samples.push({ day: day(state), pop: alive(state).length, bases: state.bases.length, hives: gp.hives.left, destroyed: gp.hives.destroyed, building: gp.hives.building,
      members: gp.alliance.members, groups: gp.alliance.groups, land: Math.round(gp.alliance.land.pct * 100), groupsAlive: state.factions.filter((f) => f.alive).length, ...housing() });
  };
  // Housing (since 2026-10-07): the hub's residents and beds, and the outposts' (buildings.js baseBeds).
  const housing = () => {
    const h = hub(state);
    const outs = state.bases.filter((b) => b.type === "outpost");
    return { hubRes: h ? residents(state, h.id).length : 0, hubBeds: h ? baseBeds(h) : 0,
      outRes: outs.reduce((a, b) => a + residents(state, b.id).length, 0), outBeds: outs.reduce((a, b) => a + baseBeds(b), 0) };
  };
  sample();
  try {
    while (day(state) <= days) {
      tickHour(state);
      if (hubDay == null && hub(state)) hubDay = day(state);
      for (let i = 0; i < state.log.length && state.log[i] !== lastTop; i++) {
        const l = state.log[i];
        if (EVENT.test(l.text) && (!l.text.startsWith("🤖") || /\(hive\) to/.test(l.text))) { events.push({ day: day(state), text: l.text.replace(/^🤖 /, "") }); lastEventDay = day(state); }
        if (grepRe && grepLines.length < 300 && grepRe.test(l.text)) grepLines.push(`d${day(state)} ${l.text}`);
        if (l.kind === "death" && / died /.test(l.text)) {
          const c = deathCause(l.text); deaths[c] = (deaths[c] || 0) + 1;
          if (bySeason[c]) { const sk = season(state, l.hour ?? state.hour).key; bySeason[c][sk] = (bySeason[c][sk] || 0) + 1; }
        }
        else if (/walked away|deserted|changed sides/.test(l.text)) deaths.left = (deaths.left || 0) + 1;
      }
      if (state.log[0] !== lastTop) lastLogDay = day(state);
      lastTop = state.log[0];
      longestQuiet = Math.max(longestQuiet, day(state) - lastEventDay);
      longestSilent = Math.max(longestSilent, day(state) - lastLogDay);
      if (state.hour % (24 * 30) === 0) {
        sample();
        monthAt++;
        if (MONTHS.includes(monthAt)) recordBlockers(`m${monthAt}`);
      }
      if (state.gameOver) {
        if (keep && state.victory && state.victoryReason === "hives" && !state.victoryKept) {
          hiveWinDay = day(state);
          state.gameOver = false; state.victory = false; state.victoryKept = true;
          continue;
        }
        break;
      }
    }
  } catch (e) { error = e.stack.split("\n").slice(0, 5).join(" | "); crashDay = day(state); }
  sample();
  recordBlockers("end");
  let gp, g, conquest, outside = [];
  try { gp = goalsProgress(state); g = autopilotStats(state); conquest = { ...ensureConquest(state).stats }; outside = state.factions.filter((f) => f.alive && !isMember(state, f)).map((f) => `${f.name}: ${inviteProblem(state, f) || "could join"}`); }
  catch (e) { gp = { hives: {}, alliance: { land: {} } }; g = {}; conquest = {}; if (!error) error = `end stats: ${e.stack.split("\n").slice(0, 3).join(" | ")}`; }
  const outcome = error ? "crash" : state.gameOver ? (state.victory ? (state.victoryReason === "alliance" ? "alliance" : "hives") : "loss") : hiveWinDay != null ? "hives" : "going";
  // The autopilot's count of why no hive storm was offered each morning (autopilot.js autopilotStats().hiveRejects:
  // { unknown, far, odds, ammo, squad, rest }), when it keeps one.
  const hiveRejects = g && g.hiveRejects && typeof g.hiveRejects === "object" ? { ...g.hiveRejects } : null;
  return {
    ...job, outcome, day: day(state), crashDay, hiveWinDay, hubDay, error, ms: Date.now() - t0, samples, events, deaths, bySeason, blockers, hiveRejects, longestQuiet, longestSilent,
    end: {
      bands: (state.hardcore && state.hardcore.groups && state.hardcore.groups.bands ? state.hardcore.groups.bands.length : 0), // hardcore groups still on the road (not factions yet)
      pop: alive(state).length, bases: state.bases.length, hives: gp.hives.left, destroyed: gp.hives.destroyed, building: gp.hives.building,
      members: gp.alliance.members, groups: gp.alliance.groups, land: Math.round((gp.alliance.land.pct || 0) * 1000) / 10, outside,
      outposts: state.bases.filter((b) => b.type === "outpost").length, built: (() => { try { return hiveStats(state).built; } catch { return null; } })(),
      reason: state.victoryReason || null, conquest, mapW: state.grid.width, mapH: state.grid.height,
      world: { collapsed: state.factions.filter((f) => !f.alive).length, newGangs: state.stats.newGangs || 0, razedYours: state.stats.razedYours || 0, razedGroups: state.stats.razedGroups || 0 },
    },
    log: logN ? state.log.slice(0, logN).reverse().map((l) => `d${Math.floor(l.hour / 24) + 1} ${l.text}`) : null,
    grepLines: grepRe ? grepLines : null,
  };
}

// ---------- the pool ----------
if (!isMainThread) {
  parentPort.on("message", (job) => { if (job === "done") process.exit(0); parentPort.postMessage(runOne(job)); });
} else {
  main();
}

function pool(jobs) {
  return new Promise((resolve) => {
    const out = [];
    const n = Math.max(1, Math.min(jobs.length, cpus().length - 1, 12));
    let next = 0, live = n;
    for (let i = 0; i < n; i++) {
      const w = new Worker(fileURLToPath(import.meta.url));
      let current = null;
      const feed = () => { if (next < jobs.length) { current = jobs[next++]; w.postMessage(current); } else { w.postMessage("done"); if (--live === 0) resolve(out); } };
      w.on("message", (r) => { out.push(r); if (JSONL) appendFileSync(JSONL, JSON.stringify(r) + "\n"); process.stdout.write(r.outcome === "crash" ? "X" : r.outcome[0]); feed(); });
      w.on("error", (e) => { console.log(`\nworker error: ${e.stack}`); out.push({ ...(current || {}), outcome: "crash", error: `worker: ${String(e.stack || e)}`, samples: [], events: [], deaths: {}, end: {} }); feed(); });
      feed();
    }
  });
}

const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
const topDeaths = (d) => Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ") || "-";

// "a/b/c/d": a count per season, spring first (weather.js SEASONS).
const seasonCols = (m) => SEASON_KEYS.map((k) => (m && m[k]) || 0).join("/");
const sumInto = (into, from) => { for (const [k, v] of Object.entries(from || {})) into[k] = (into[k] || 0) + v; return into; };
const rejectsText = (hr) => (hr ? Object.entries(hr).map(([k, v]) => `${k} ${v}`).join(", ") : "-");

async function main() {
  const jobs = [];
  for (const size of SIZES) for (let i = 0; i < GAMES; i++) {
    const mode = MODE === "both" ? (i < Math.ceil(GAMES / 2) ? "normal" : "hardcore") : MODE;
    const k = MODE !== "both" || mode === "normal" ? i : i - Math.ceil(GAMES / 2);
    const style = STYLES[k % STYLES.length];
    const groups = clampGroups(size, GMIN + (k % (GMAX - GMIN + 1)));
    jobs.push({ seed: SEED0 + i, mode, style, groups, size, days: DAYS, keep: KEEP, logN: LOGN, grep: GREP });
  }
  const perSize = jobs.filter((j) => j.size === SIZE);
  console.log(`${GAMES} games to day ${DAYS}${SIZES.length > 1 ? ` on each of ${SIZES.length} sizes (${SIZES.join(", ")})` : ""}: ${perSize.filter((j) => j.mode === "normal").length} normal + ${perSize.filter((j) => j.mode === "hardcore").length} hardcore starts, size ${SIZES.join("/")}, ${GMIN}-${GMAX} AI groups, styles ${STYLES.join("/")}, keep playing after a hive win: ${KEEP}${PRESET_NAME ? `, preset ${PRESET_NAME}` : ""}, commit ${COMMIT}`);
  console.log(`legend: h hive win, a coalition win, l loss, g still going at the cap, X crash`);
  const t0 = Date.now();
  // --jsonl: the games already done (the same seed, size, mode and days) are read back instead of run again.
  const done = JSONL && existsSync(JSONL) ? readFileSync(JSONL, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const key = (j) => `${j.seed}|${j.size}|${j.mode}|${j.days}`;
  const doneKeys = new Set(done.map(key));
  if (done.length) console.log(`${done.filter((r) => jobs.some((j) => key(j) === key(r))).length} games read back from ${JSONL}`);
  const results = [...done.filter((r) => jobs.some((j) => key(j) === key(r))), ...(await pool(jobs.filter((j) => !doneKeys.has(key(j)))))].sort((a, b) => SIZES.indexOf(a.size) - SIZES.indexOf(b.size) || a.seed - b.seed);
  const ms = Date.now() - t0;
  console.log("\n");
  for (const size of SIZES) report(results.filter((r) => r.size === size), SIZES.length > 1 ? size : "");
  if (SIZES.length > 1) compareSizes(results);
  const crashes = results.filter((r) => r.outcome === "crash");
  if (OUT) {
    if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({ args: { GAMES, DAYS, SIZE, SIZES, GMIN, GMAX, SEED0, STYLES, KEEP, MODE, PRESET: PRESET_NAME }, commit: COMMIT, date: TODAY, ms, results }, null, 1));
    console.log(`\nreport written to ${OUT}`);
  }
  console.log(`\n${results.length} runs in ${(ms / 60000).toFixed(1)} min${crashes.length ? `, ${crashes.length} CRASHED` : ""}.`);
  process.exit(crashes.length ? 1 : 0);
}

// The sizes side by side: where the win conditions stop scaling (the census's testing item 2).
function compareSizes(results) {
  console.log(`\n=== Sizes compared (${GAMES} games each) ===`);
  console.log(pad("size", 8) + rpad("map", 8) + rpad("fell", 5) + rpad("going", 6) + rpad("hive", 5) + rpad("coal", 5) + rpad("crash", 6) + rpad("pop", 5) + rpad("land%", 6) + rpad("hives", 6) + rpad("dstr", 5) + rpad("deaths", 7) + rpad("thirst", 7) + rpad("hunger", 7) + rpad("horde", 6) + rpad("left", 5) + "  top blocker at the end");
  for (const size of SIZES) {
    const list = results.filter((r) => r.size === size), ok = list.filter((r) => r.outcome !== "crash");
    const n = (o) => list.filter((r) => r.outcome === o).length;
    const avg = (f) => (ok.length ? Math.round(ok.reduce((a, r) => a + f(r), 0) / ok.length * 10) / 10 : "-");
    const deaths = {};
    for (const r of list) sumInto(deaths, r.deaths);
    const bl = {};
    for (const r of list) sumInto(bl, (r.blockers || {}).end);
    const top = Object.entries(bl).sort((a, b) => b[1] - a[1])[0];
    const map = ok[0] && ok[0].end ? `${ok[0].end.mapW}x${ok[0].end.mapH}` : "-";
    console.log(pad(size, 8) + rpad(map, 8) + rpad(n("loss"), 5) + rpad(n("going"), 6) + rpad(n("hives"), 5) + rpad(n("alliance"), 5) + rpad(n("crash"), 6) + rpad(avg((r) => r.end.pop || 0), 5) + rpad(avg((r) => r.end.land || 0), 6) + rpad(avg((r) => r.end.hives || 0), 6) + rpad(avg((r) => r.end.destroyed || 0), 5) +
      rpad(Object.values(deaths).reduce((a, v) => a + v, 0), 7) + rpad(deaths.thirst || 0, 7) + rpad(deaths.hunger || 0, 7) + rpad(deaths.horde || 0, 6) + rpad(deaths.left || 0, 5) + "  " + (top ? `${top[0]} ${top[1]} of ${Object.values(bl).reduce((a, v) => a + v, 0)}` : "-"));
  }
}

// The full report for one size's runs (every run, totals, deaths, seasons, blockers, hive rejections, stuck runs, crashes, grep).
function report(results, label) {
  if (label) console.log(`\n=== Size ${label} ===`);
  // Every run.
  console.log(pad("seed", 5) + pad("start", 9) + pad("style", 11) + pad("grp", 4) + pad("outcome", 10) + rpad("day", 5) + rpad("pop", 5) + rpad("bases", 6) + rpad("hives", 6) + rpad("dstr", 5) + rpad("coal", 8) + rpad("land%", 6) + rpad("taken", 6) + rpad("broke", 6) + rpad("quiet", 6) + rpad("min", 5) + rpad("thirst sp/su/au/wi", 20) + rpad("hunger sp/su/au/wi", 20) + "  deaths");
  console.log("  (coal: coalition members / groups with a hub, +bands still on the road in hardcore; quiet: longest stretch with no major event; taken/broke: bases taken, groups defeated by conquest; thirst/hunger: deaths by season, spring first)");
  for (const r of results) {
    const e = r.end || {};
    const c = e.conquest || {};
    const mark = { hives: "HIVE WIN", alliance: "COALITION", loss: "fell", going: "going", crash: "CRASH" }[r.outcome] || r.outcome;
    console.log(pad(r.seed, 5) + pad(r.mode, 9) + pad(r.style, 11) + pad(r.groups, 4) + pad(mark, 10) + rpad(r.outcome === "hives" && r.hiveWinDay != null ? r.hiveWinDay : r.day, 5) + rpad(e.pop ?? "-", 5) + rpad(e.bases ?? "-", 6) +
      rpad(e.hives ?? "-", 6) + rpad(e.destroyed ?? "-", 5) + rpad(e.members != null ? `${e.members}/${e.groups}${e.bands ? `+${e.bands}` : ""}` : "-", 8) + rpad(e.land ?? "-", 6) + rpad(c.taken ?? "-", 6) + rpad(c.defeated ?? "-", 6) +
      rpad(r.longestQuiet ?? "-", 6) + rpad(Math.round((r.ms || 0) / 60000), 5) + rpad(seasonCols(r.bySeason && r.bySeason.thirst), 20) + rpad(seasonCols(r.bySeason && r.bySeason.hunger), 20) + "  " + topDeaths(r.deaths || {}));
    if (r.hiveRejects) console.log(`      hive storm rejections: ${rejectsText(r.hiveRejects)}`);
    if (r.outcome === "crash") console.log(`      ${r.error}`);
  }

  // Totals by start and by style.
  const groupsBy = (key) => { const m = new Map(); for (const r of results) { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  const line = (label, list) => {
    const n = (o) => list.filter((r) => r.outcome === o).length;
    const avg = (f) => { const l = list.filter((r) => r.outcome !== "crash"); return l.length ? Math.round(l.reduce((a, r) => a + f(r), 0) / l.length) : "-"; };
    const wins = list.filter((r) => r.outcome === "hives" || r.outcome === "alliance");
    const both = list.filter((r) => r.hiveWinDay != null && r.outcome === "alliance").length;
    console.log(`  ${pad(label, 22)} ${rpad(list.length, 3)} runs: hive wins ${n("hives")}, coalition wins ${n("alliance")} (${both} after a hive win), fell ${n("loss")}, going ${n("going")}, crashed ${n("crash")} | ` +
      `avg day ${avg((r) => r.day)}, avg end pop ${avg((r) => (r.end && r.end.pop) || 0)}, avg win day ${wins.length ? Math.round(wins.reduce((a, r) => a + r.day, 0) / wins.length) : "-"}, avg time ${avg((r) => r.ms / 60000)} min`);
  };
  console.log("\nBy start:");
  for (const [k, l] of groupsBy("mode")) line(k, l);
  console.log("By style:");
  for (const [k, l] of groupsBy("style")) line(k, l);
  console.log("By start and style:");
  for (const [k, l] of groupsBy("mode")) for (const [s, ls] of (() => { const m = new Map(); for (const r of l) { if (!m.has(r.style)) m.set(r.style, []); m.get(r.style).push(r); } return m; })()) line(`${k} ${s}`, ls);
  line("all", results);

  // Deaths by cause, overall; thirst and hunger by season (the census's testing item 1).
  const deaths = {};
  for (const r of results) for (const [k, v] of Object.entries(r.deaths || {})) deaths[k] = (deaths[k] || 0) + v;
  console.log(`\nDeaths by cause: ${Object.entries(deaths).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);
  const seasonTot = { thirst: {}, hunger: {} }, seasonBy = { normal: { thirst: {}, hunger: {} }, hardcore: { thirst: {}, hunger: {} } };
  for (const r of results) for (const c of ["thirst", "hunger"]) { sumInto(seasonTot[c], r.bySeason && r.bySeason[c]); if (seasonBy[r.mode]) sumInto(seasonBy[r.mode][c], r.bySeason && r.bySeason[c]); }
  console.log(`Deaths by season (${SEASON_KEYS.join("/")}): thirst ${seasonCols(seasonTot.thirst)}, hunger ${seasonCols(seasonTot.hunger)}` +
    ["normal", "hardcore"].filter((m) => results.some((r) => r.mode === m)).map((m) => `; ${m}: thirst ${seasonCols(seasonBy[m].thirst)}, hunger ${seasonCols(seasonBy[m].hunger)}`).join(""));

  // Why the groups stay outside the coalition, at month 12, 24 and the end (the census's testing item 3): the count
  // of living groups outside in each bucket, summed over the runs (per run in the JSON: results[].blockers).
  const labels = [...MONTHS.map((m) => `m${m}`), "end"];
  const bl = {};
  for (const l of labels) bl[l] = {};
  for (const r of results) for (const l of labels) sumInto(bl[l], (r.blockers || {})[l]);
  const seen = BUCKETS.filter((k) => labels.some((l) => bl[l][k]));
  if (seen.length) {
    console.log(`\nCoalition blockers (living groups outside, summed over ${results.length} runs):`);
    console.log("  " + pad("", 22) + labels.map((l) => rpad(l === "end" ? `end (d${DAYS})` : `month ${l.slice(1)}`, 12)).join(""));
    for (const k of seen) console.log("  " + pad(k, 22) + labels.map((l) => rpad(bl[l][k] || 0, 12)).join(""));
    console.log("  " + pad("groups outside", 22) + labels.map((l) => rpad(Object.values(bl[l]).reduce((a, v) => a + v, 0), 12)).join(""));
  }

  // Hive storm rejections (the census's testing item 4): why the autopilot offered no storm each morning, summed.
  const withRej = results.filter((r) => r.hiveRejects);
  if (withRej.length) {
    const sum = {};
    for (const r of withRej) sumInto(sum, r.hiveRejects);
    console.log(`\nHive storm rejections (autopilotStats().hiveRejects, ${withRej.length} runs): ${rejectsText(sum)}`);
  } else console.log(`\nHive storm rejections: not kept by this build's autopilot (autopilotStats().hiveRejects)`);

  // Hardcore: how long the first hub took.
  const hc = results.filter((r) => r.mode === "hardcore" && r.outcome !== "crash");
  if (hc.length) {
    const founded = hc.filter((r) => r.hubDay != null);
    console.log(`Hardcore first hub: founded in ${founded.length}/${hc.length} runs${founded.length ? `, day ${Math.min(...founded.map((r) => r.hubDay))}–${Math.max(...founded.map((r) => r.hubDay))} (avg ${Math.round(founded.reduce((a, r) => a + r.hubDay, 0) / founded.length)})` : ""}${hc.length > founded.length ? `; never founded: seeds ${hc.filter((r) => r.hubDay == null).map((r) => r.seed).join(", ")}` : ""}`);
  }

  // What blocks the wins in the runs still going.
  const going = results.filter((r) => r.outcome === "going");
  if (going.length) {
    console.log(`\nStill going at day ${DAYS} (${going.length}): what blocks each victory`);
    for (const r of going) {
      const e = r.end;
      console.log(`  seed ${r.seed} ${r.mode}/${r.style}: hives left ${e.hives} (building ${e.building}); coalition ${e.members}/${e.groups}, land ${e.land}%; outside: ${(e.outside || []).slice(0, 4).join("; ")}${(e.outside || []).length > 4 ? "; …" : ""}`);
    }
  }
  // Runs that look stuck: a long stretch without any event while still going.
  const stuck = results.filter((r) => r.outcome !== "crash" && r.longestSilent >= STUCK_DAYS);
  if (stuck.length) console.log(`\nPossibly stuck (no log line of any kind for ${STUCK_DAYS}+ days): seeds ${stuck.map((r) => `${r.seed} (${r.longestSilent}d silent)`).join(", ")}`);

  // Crashes in full.
  const crashes = results.filter((r) => r.outcome === "crash");
  if (crashes.length) {
    console.log(`\nCRASHES (${crashes.length}):`);
    for (const r of crashes) console.log(`  seed ${r.seed} ${r.mode}/${r.style} groups ${r.groups} day ${r.crashDay ?? r.day}: ${r.error}`);
  }
  // The grep lines: every run, or (--fallen-grep, the census's testing item 5) only the runs that fell.
  if (GREP) for (const r of results) if (r.grepLines && r.grepLines.length && (!FALLEN_GREP || r.outcome === "loss")) {
    console.log(`\n--- seed ${r.seed} (${r.mode}/${r.style}${FALLEN_GREP ? `, fell day ${r.day}` : ""}): ${r.grepLines.length} log lines matching /${GREP}/ ---`);
    for (const l of r.grepLines) console.log(`  ${l}`);
  }
  if (LOGN) for (const o of ["hives", "alliance", "loss", "going", "crash"]) {
    const r = results.find((x) => x.outcome === o && x.log);
    if (!r) continue;
    console.log(`\n--- last ${LOGN} log lines of seed ${r.seed} (${o}) ---`);
    for (const l of r.log) console.log(`  ${l}`);
  }
}
