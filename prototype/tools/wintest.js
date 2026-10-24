// How the game ends, in about 2-3 minutes (the long census of natural endings is tools/wincensus.js, a tool, not a test).
// - The five forced endings (tools/winforce.js: the setup rigged, the rules the game's), each played from one shared
//   start (seed 1, Balanced autopilot, 30 days, the eras' clocks off; saved once and loaded for each): it ends the way
//   it is forced to, with the game over, the victory flag and victoryReason ("hives" / "alliance" / none for a loss),
//   the log line and the timelapse caption the chronicle reads (chronicle.js), and the end screen (ui.js
//   gameOverWords: its title, Keep playing on a victory only, no NaN or undefined).
//   hive: the last hive stormed by a squad: "hives", every hive gone, hivesWon. alliance: every group in the coalition,
//   the land over ALLIANCE.LAND_NEEDED, the hives destroyed: "alliance". conquest: groups broken by taking their bases
//   first, then the coalition: "alliance". keep: the hive victory, Keep playing, then the coalition's: "alliance" after
//   "hives" (both flags, victoryKept). loss: everyone dead: no victory, no reason, nobody alive.
// - A small census of natural play (eras on): seeds × styles of autopilot campaigns of a few game days: no crash, no
//   NaN or Infinity in the key state (people, base stocks, groups, hordes, the Goals panel's numbers) every 10 days,
//   and the game either still going (people alive, no victory, played to the last day) or ended in a valid way (a
//   loss with nobody alive; no victory this early: eras.js opens them in year WIN_FROM_YEAR).
// Usage: node tools/wintest.js [days] [seeds=2,3] [styles=cautious,aggressive]
//   default 40 days; BS_QUICK=1 (runtests.js --quick): 30 days on seed 2. Everything runs in two worker threads
//   (each holds a whole world, about 1 GB: more would crowd the machine's memory when runtests runs others beside it).
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { createWorld, tickHour, day, alive } from "../src/sim/world.js";
import { setAutopilot, PERSONALITIES } from "../src/sim/autopilot.js";
import { goalsProgress } from "../src/sim/alliance.js";
import { ERAS, yearOf } from "../src/sim/eras.js";
import { saveBlocker, saveToString, loadFromString } from "../src/sim/save.js";
import { forcedStart, forcedPlay, FORCED, FACTIONS } from "./winforce.js";

const QUICK = process.env.BS_QUICK === "1";

// ---------- worker jobs ----------
function warm() {
  const state = forcedStart(1);
  for (let h = 0; h < 48 && saveBlocker(state); h++) tickHour(state); // an open card cannot be saved: the governor answers it
  const why = saveBlocker(state);
  if (why) throw new Error(`the forced start cannot be saved: ${why}`);
  return { day: day(state), gameOver: !!state.gameOver, save: saveToString(state) };
}
async function scenario(kind, save) {
  const state = loadFromString(save);
  state.started = true; state.erasOff = true; // as forcedStart (kept in the save; set again in case)
  return forcedPlay(state, kind);
}

// Numbers in the state that must stay finite: paths of the bad ones (the first few).
function badNumbers(state) {
  const bad = [];
  const num = (path, v, required = false) => {
    if (bad.length >= 8) return;
    if (typeof v === "number" ? !Number.isFinite(v) : required) bad.push(`${path}=${v}`);
  };
  const walk = (path, o, depth) => {
    if (!o || typeof o !== "object" || depth > 3) return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "number") num(`${path}.${k}`, v);
      else if (v && typeof v === "object" && !Array.isArray(v)) walk(`${path}.${k}`, v, depth + 1);
    }
  };
  num("hour", state.hour, true);
  for (const s of alive(state)) {
    num(`${s.name}.health`, s.health, true);
    for (const k of ["hunger", "thirst", "mood", "fatigue", "infection"]) num(`${s.name}.${k}`, s[k]);
    walk(`${s.name}.skills`, s.skills, 0);
  }
  for (const b of state.bases) walk(`${b.name}.stock`, b.stock, 0);
  for (const f of state.factions) { num(`${f.name}.pop`, f.pop); num(`${f.name}.goodwill`, f.goodwill); }
  for (const hd of state.hordes || []) num(`horde ${hd.id}.size`, hd.size, true);
  const gp = goalsProgress(state);
  num("goals.land", gp.alliance.land.pct, true);
  for (const k of ["left", "destroyed", "building", "sites"]) num(`goals.hives.${k}`, gp.hives[k], true);
  num("goals.members", gp.alliance.members, true); num("goals.groups", gp.alliance.groups, true);
  return bad;
}
function census({ seed, style, days }) {
  const state = createWorld({ seed, factionCount: FACTIONS });
  state.started = true;
  setAutopilot(state, true, style);
  const nan = [];
  let error = null;
  try {
    while (day(state) <= days && !state.gameOver) {
      tickHour(state);
      if (state.hour % 240 === 0 && !nan.length) { const b = badNumbers(state); if (b.length) nan.push(`day ${day(state)}: ${b.join(", ")}`); }
    }
    if (!nan.length) { const b = badNumbers(state); if (b.length) nan.push(`end: ${b.join(", ")}`); }
  } catch (e) { error = e.stack.split("\n").slice(0, 4).join(" | "); }
  return { seed, style, days, error, nan, day: day(state), year: yearOf(state), gameOver: !!state.gameOver, victory: !!state.victory,
    reason: state.victoryReason || null, alive: alive(state).length, people: state.survivors.length };
}

if (!isMainThread) {
  parentPort.on("message", async (job) => {
    if (job === "done") return process.exit(0);
    const t = Date.now(), secs = () => Math.round((Date.now() - t) / 1000);
    try {
      const out = job.type === "warm" ? warm() : job.type === "scenario" ? await scenario(job.kind, job.save) : census(job);
      parentPort.postMessage({ job: { ...job, save: undefined }, out, secs: secs() });
    } catch (e) { parentPort.postMessage({ job: { ...job, save: undefined }, error: e.stack.split("\n").slice(0, 4).join(" | "), secs: secs() }); }
  });
} else await main();

// ---------- the checks ----------
async function main() {
  const t0 = Date.now();
  const args = process.argv.slice(2);
  const days = Number(args[0] || (QUICK ? 30 : 40));
  const seeds = (args[1] || (QUICK ? "2" : "2,3")).split(",").map(Number);
  const styles = (args[2] || "cautious,aggressive").split(",");
  if (styles.some((s) => !PERSONALITIES[s])) { console.log(`Unknown style. Use ${Object.keys(PERSONALITIES).join(", ")}.`); process.exit(1); }
  let pass = 0, fail = 0;
  const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };

  const results = { warm: null, scenario: {}, census: [] };
  const jobs = [{ type: "warm" }];
  for (const style of styles) for (const seed of seeds) jobs.push({ type: "census", seed, style, days });
  await pool(jobs, (msg, queue) => {
    if (msg.job.type === "warm") {
      results.warm = msg;
      if (msg.out) for (const kind of FORCED) queue.unshift({ type: "scenario", kind, save: msg.out.save }); // ahead of the census runs
    } else if (msg.job.type === "scenario") results.scenario[msg.job.kind] = msg;
    else results.census.push(msg);
  });

  const took = (m) => (m && m.secs != null ? ` [${m.secs} s]` : "");
  console.log(`\nForced endings (seed 1, Balanced, from day ${results.warm.out ? results.warm.out.day : "?"}; the start took ${results.warm.secs} s, the scenarios${FORCED.map((k) => ` ${k}${took(results.scenario[k])}`).join(",")}):`);
  check(!!results.warm.out && !results.warm.out.gameOver, `the shared start played to day 30 and saved${results.warm.error ? `: ${results.warm.error}` : ""}`);
  const WANT = {
    hive: { victory: true, reason: "hives", log: /^Every hive is destroyed/, caption: /^Every hive is destroyed\. .* has won on day \d+/, screen: "Every hive is destroyed" },
    alliance: { victory: true, reason: "alliance", log: /^The Calder Coalition holds the State of Calder/, caption: /^The Calder Coalition holds the state\. .* won on day \d+/, screen: "The Calder Coalition holds the state" },
    loss: { victory: false, reason: null, log: /^Every survivor is dead/, caption: /^Every survivor is dead/, screen: "The holdout has fallen" },
  };
  WANT.conquest = WANT.alliance;
  // After Keep playing the timelapse has its end caption from the hive victory already: the coalition's comes from its log line.
  WANT.keep = { ...WANT.alliance, caption: /^The Calder Coalition holds the [Ss]tate/ };
  for (const kind of FORCED) {
    const msg = results.scenario[kind];
    if (!check(!!msg && !msg.error, `${kind}: played without a crash${!msg ? ": not played (no shared start)" : msg.error ? `: ${msg.error}` : ""}`)) continue;
    const r = msg.out, w = WANT[kind];
    for (const n of r.notes) console.log(`       setup: ${n}`);
    const ended = check(r.gameOver && r.victory === w.victory && r.reason === w.reason,
      `${kind}: game over on day ${r.day}, victory ${r.victory}, reason ${r.reason} (want ${w.victory}, ${w.reason})`);
    if (!ended && r.hiveLog && (kind === "hive" || kind === "keep")) for (const t of r.hiveLog) console.log(`       | ${t.slice(0, 200)}`); // what the hive mission did (newest first)
    check(!!r.logLine && w.log.test(r.logLine), `${kind}: the log line: ${r.logLine}`);
    check(!!r.caption && w.caption.test(r.caption), `${kind}: the timelapse caption: ${r.caption}`);
    check(r.screen === w.screen && !r.screenBad && r.keepButton === w.victory,
      `${kind}: the end screen "${r.screen}"${r.screenBad ? " (NaN or undefined in it)" : ""}, Keep playing ${r.keepButton ? "offered" : "not offered"}`);
    if (kind === "hive") check(r.hives === 0 && r.building === 0 && r.hivesWon && !r.allianceWon && r.alive > 0, `hive: no hive left or being built (${r.hives}+${r.building}), hivesWon, not the coalition's, ${r.alive} alive`);
    if (kind === "alliance" || kind === "conquest" || kind === "keep")
      check(r.allianceWon && r.hives === 0 && r.members === r.groups && r.members > 0 && r.landPct > r.landNeeded && r.alive > 0,
        `${kind}: allianceWon, coalition ${r.members}/${r.groups} groups, land ${r.land}% over ${Math.round(r.landNeeded * 100)}%, hives left ${r.hives}, ${r.alive} alive`);
    if (kind === "conquest") check(r.broken > 0 && r.captured > 0, `conquest: ${r.broken} groups broken, ${r.captured} bases captured before the coalition won`);
    if (kind === "keep") check(r.captions.some((t) => WANT.hive.caption.test(t)), `keep: the timelapse has the hive victory's caption too`);
    if (kind === "keep") check(!!r.keptAt && r.keptAt.reason === "hives" && r.victoryKept && r.hivesWon && r.day >= r.keptAt.day,
      `keep: first the hive victory (${r.keptAt ? `${r.keptAt.reason}, day ${r.keptAt.day}` : "none"}), Keep playing, then the coalition's on day ${r.day} (hivesWon ${r.hivesWon}, victoryKept ${r.victoryKept})`);
    if (kind === "loss") check(r.alive === 0 && !r.hivesWon && !r.allianceWon, `loss: nobody alive (${r.alive}), neither victory flag`);
  }

  console.log(`\nNatural play (eras on): ${seeds.length} seed(s) × ${styles.join(", ")}, ${days} days:`);
  for (const msg of results.census.sort((a, b) => a.job.style.localeCompare(b.job.style) || a.job.seed - b.job.seed)) {
    const { seed, style } = msg.job;
    const tag = `${PERSONALITIES[style].name} seed ${seed}`;
    const r = msg.out || { error: msg.error, nan: [] };
    if (!check(!r.error, `${tag}: no crash${r.error ? `: ${r.error}` : ""}${took(msg)}`)) continue;
    check(!r.nan.length, `${tag}: no NaN or Infinity in the key state${r.nan.length ? `: ${r.nan.join("; ")}` : ""}`);
    if (r.gameOver) {
      const lossOk = !r.victory && !r.reason && r.alive === 0 && r.people > 0;
      const winOk = r.victory && ["hives", "alliance"].includes(r.reason) && r.alive > 0 && r.year >= ERAS.WIN_FROM_YEAR;
      check(lossOk || winOk, `${tag}: ended on day ${r.day} validly (victory ${r.victory}, reason ${r.reason}, ${r.alive} alive, year ${r.year}; no victory before year ${ERAS.WIN_FROM_YEAR})`);
    } else {
      check(r.alive > 0 && !r.victory && !r.reason && r.day > days, `${tag}: still going after day ${days} (day ${r.day}, ${r.alive} alive, no victory)`);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  process.exit(fail ? 1 : 0);
}

// Worker threads, one job each at a time; onResult may add jobs to the queue (the scenarios after the shared start).
function pool(queue, onResult) {
  return new Promise((resolve) => {
    const n = Math.max(1, Math.min(cpus().length - 1, 2));
    const idle = [], live = new Set();
    let busy = 0, finished = false;
    const feedIdle = () => {
      while (idle.length && queue.length) { const w = idle.pop(); w.job = queue.shift(); busy++; w.postMessage(w.job); }
      if (!queue.length && !busy && !finished) { finished = true; for (const w of live) w.postMessage("done"); resolve(); }
    };
    for (let i = 0; i < n; i++) {
      const w = new Worker(fileURLToPath(import.meta.url));
      live.add(w);
      w.on("message", (msg) => { busy--; const j = msg.job; console.log(`  (${j.type} ${j.kind || (j.style ? `${j.style} seed ${j.seed}` : "")} done in ${msg.secs} s)`); onResult(msg, queue); idle.push(w); feedIdle(); });
      w.on("error", (e) => { busy--; live.delete(w); onResult({ job: { ...w.job, save: undefined }, error: `worker error: ${e.stack}` }, queue); feedIdle(); });
      idle.push(w);
    }
    feedIdle();
  });
}
