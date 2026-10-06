// Long campaign census (requested 2026-10-05): many full games under the autopilot on big maps, half from a normal
// start and half from hardcore, trying to survive as long as possible and to win every way the game allows (every
// hive destroyed; the coalition over half the land; conquest breaking the groups, which counts as a coalition win;
// "Keep playing" after a hive win so the coalition can still win). The autopilot's styles are rotated so each one
// gets both starts. Reports every run (outcome, day, population, hives, coalition, conquest, deaths by cause),
// totals by start and by style, every crash with its stack, runs that look stuck (no events for a long stretch),
// and writes a JSON report for later reading. Seeds run in parallel worker threads (tools/wintest.js's pool).
// Usage: node tools/campaign50.js [games=50] [days=1095] [--size huge|120x80|...] [--groups 15-20] [--seed 1000]
//                                [--styles balanced,aggressive,cautious] [--mode both|normal|hardcore] [--out path.json] [--no-keep] [--log N]
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { createWorld, tickHour, day, alive, hub } from "../src/sim/world.js";
import { setAutopilot, autopilotStats, PERSONALITIES } from "../src/sim/autopilot.js";
import { hiveStats } from "../src/sim/hives.js";
import { goalsProgress, inviteProblem, isMember } from "../src/sim/alliance.js";
import { ensureConquest } from "../src/sim/conquest.js";
import { clampGroups } from "../src/sim/worldsize.js";

// ---------- arguments ----------
const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; };
const has = (name) => argv.includes(name);
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && !["--no-keep"].includes(argv[i - 1])));
const GAMES = Number(positional[0] || 50);
const DAYS = Number(positional[1] || 1095);
const SIZE = flag("--size", "huge");
const [GMIN, GMAX] = flag("--groups", "15-20").split("-").map(Number);
const SEED0 = Number(flag("--seed", 1000));
const STYLES = flag("--styles", Object.keys(PERSONALITIES).join(",")).split(",").filter((s) => PERSONALITIES[s]);
const OUT = flag("--out", null);
const KEEP = !has("--no-keep");
const MODE = flag("--mode", "both"); // both: the first half normal, the second hardcore; or one start for every game
const LOGN = Number(flag("--log", 0));
const GREP = flag("--grep", null); // collect every log line matching this regex (up to 300 a run), printed per run
const STUCK_DAYS = 60; // a run with no log line of any kind for this long is reported as possibly stuck

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
  let lastTop = state.log[0], hiveWinDay = null, lastEventDay = 1, longestQuiet = 0, lastLogDay = 1, longestSilent = 0, hubDay = null;
  const sample = () => {
    const gp = goalsProgress(state);
    samples.push({ day: day(state), pop: alive(state).length, bases: state.bases.length, hives: gp.hives.left, destroyed: gp.hives.destroyed, building: gp.hives.building,
      members: gp.alliance.members, groups: gp.alliance.groups, land: Math.round(gp.alliance.land.pct * 100), groupsAlive: state.factions.filter((f) => f.alive).length });
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
        if (l.kind === "death" && / died /.test(l.text)) { const c = deathCause(l.text); deaths[c] = (deaths[c] || 0) + 1; }
        else if (/walked away|deserted|changed sides/.test(l.text)) deaths.left = (deaths.left || 0) + 1;
      }
      if (state.log[0] !== lastTop) lastLogDay = day(state);
      lastTop = state.log[0];
      longestQuiet = Math.max(longestQuiet, day(state) - lastEventDay);
      longestSilent = Math.max(longestSilent, day(state) - lastLogDay);
      if (state.hour % (24 * 30) === 0) sample();
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
  let gp, g, conquest, outside = [];
  try { gp = goalsProgress(state); g = autopilotStats(state); conquest = { ...ensureConquest(state).stats }; outside = state.factions.filter((f) => f.alive && !isMember(state, f)).map((f) => `${f.name}: ${inviteProblem(state, f) || "could join"}`); }
  catch (e) { gp = { hives: {}, alliance: { land: {} } }; g = {}; conquest = {}; if (!error) error = `end stats: ${e.stack.split("\n").slice(0, 3).join(" | ")}`; }
  const outcome = error ? "crash" : state.gameOver ? (state.victory ? (state.victoryReason === "alliance" ? "alliance" : "hives") : "loss") : hiveWinDay != null ? "hives" : "going";
  return {
    ...job, outcome, day: day(state), crashDay, hiveWinDay, hubDay, error, ms: Date.now() - t0, samples, events, deaths, longestQuiet, longestSilent,
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
      w.on("message", (r) => { out.push(r); process.stdout.write(r.outcome === "crash" ? "X" : r.outcome[0]); feed(); });
      w.on("error", (e) => { console.log(`\nworker error: ${e.stack}`); out.push({ ...(current || {}), outcome: "crash", error: `worker: ${String(e.stack || e)}`, samples: [], events: [], deaths: {}, end: {} }); feed(); });
      feed();
    }
  });
}

const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
const topDeaths = (d) => Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(", ") || "-";

async function main() {
  const jobs = [];
  for (let i = 0; i < GAMES; i++) {
    const mode = MODE === "both" ? (i < Math.ceil(GAMES / 2) ? "normal" : "hardcore") : MODE;
    const k = MODE !== "both" || mode === "normal" ? i : i - Math.ceil(GAMES / 2);
    const style = STYLES[k % STYLES.length];
    const groups = clampGroups(SIZE, GMIN + (k % (GMAX - GMIN + 1)));
    jobs.push({ seed: SEED0 + i, mode, style, groups, size: SIZE, days: DAYS, keep: KEEP, logN: LOGN, grep: GREP });
  }
  console.log(`${GAMES} games to day ${DAYS}: ${jobs.filter((j) => j.mode === "normal").length} normal + ${jobs.filter((j) => j.mode === "hardcore").length} hardcore starts, size ${SIZE}, ${GMIN}-${GMAX} AI groups, styles ${STYLES.join("/")}, keep playing after a hive win: ${KEEP}`);
  console.log(`legend: h hive win, a coalition win, l loss, g still going at the cap, X crash`);
  const t0 = Date.now();
  const results = (await pool(jobs)).sort((a, b) => a.seed - b.seed);
  const ms = Date.now() - t0;
  console.log("\n");

  // Every run.
  console.log(pad("seed", 5) + pad("start", 9) + pad("style", 11) + pad("grp", 4) + pad("outcome", 10) + rpad("day", 5) + rpad("pop", 5) + rpad("bases", 6) + rpad("hives", 6) + rpad("dstr", 5) + rpad("coal", 8) + rpad("land%", 6) + rpad("taken", 6) + rpad("broke", 6) + rpad("quiet", 6) + rpad("min", 5) + "  deaths");
  console.log("  (coal: coalition members / groups with a hub, +bands still on the road in hardcore; quiet: longest stretch with no major event; taken/broke: bases taken, groups defeated by conquest)");
  for (const r of results) {
    const e = r.end || {};
    const c = e.conquest || {};
    const mark = { hives: "HIVE WIN", alliance: "COALITION", loss: "fell", going: "going", crash: "CRASH" }[r.outcome] || r.outcome;
    console.log(pad(r.seed, 5) + pad(r.mode, 9) + pad(r.style, 11) + pad(r.groups, 4) + pad(mark, 10) + rpad(r.outcome === "hives" && r.hiveWinDay != null ? r.hiveWinDay : r.day, 5) + rpad(e.pop ?? "-", 5) + rpad(e.bases ?? "-", 6) +
      rpad(e.hives ?? "-", 6) + rpad(e.destroyed ?? "-", 5) + rpad(e.members != null ? `${e.members}/${e.groups}${e.bands ? `+${e.bands}` : ""}` : "-", 8) + rpad(e.land ?? "-", 6) + rpad(c.taken ?? "-", 6) + rpad(c.defeated ?? "-", 6) +
      rpad(r.longestQuiet ?? "-", 6) + rpad(Math.round((r.ms || 0) / 60000), 5) + "  " + topDeaths(r.deaths || {}));
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

  // Deaths by cause, overall.
  const deaths = {};
  for (const r of results) for (const [k, v] of Object.entries(r.deaths || {})) deaths[k] = (deaths[k] || 0) + v;
  console.log(`\nDeaths by cause: ${Object.entries(deaths).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`);

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
  if (GREP) for (const r of results) if (r.grepLines && r.grepLines.length) {
    console.log(`\n--- seed ${r.seed} (${r.mode}/${r.style}): ${r.grepLines.length} log lines matching /${GREP}/ ---`);
    for (const l of r.grepLines) console.log(`  ${l}`);
  }
  if (LOGN) for (const o of ["hives", "alliance", "loss", "going", "crash"]) {
    const r = results.find((x) => x.outcome === o && x.log);
    if (!r) continue;
    console.log(`\n--- last ${LOGN} log lines of seed ${r.seed} (${o}) ---`);
    for (const l of r.log) console.log(`  ${l}`);
  }
  if (OUT) { writeFileSync(OUT, JSON.stringify({ args: { GAMES, DAYS, SIZE, GMIN, GMAX, SEED0, STYLES, KEEP }, ms, results }, null, 1)); console.log(`\nreport written to ${OUT}`); }
  console.log(`\n${results.length} runs in ${(ms / 60000).toFixed(1)} min${crashes.length ? `, ${crashes.length} CRASHED` : ""}.`);
  process.exit(crashes.length ? 1 : 0);
}
