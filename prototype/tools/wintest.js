// Win conditions under the autopilot: plays long campaigns (default 3 years) on many seeds per style and counts how
// each one ends: hive victory (every hive destroyed, none being built: hives.js hivesSecured), coalition victory
// (alliance.js allianceVictory: at least one member and over half the land, hives or not; groups outside do not
// block it any more; also after "Keep playing" on a hive victory: --keep), loss (everyone dead
// or gone) or still going. Per style it also counts the conquest (bases taken, groups broken) and the bases the
// groups took from you (and hubs lost, retreats). For every victory it
// prints the day and a short timeline (hives destroyed by day, coalition members and land, population); for the
// runs still going, what blocks each victory at the end. Seeds run in parallel worker threads.
// Usage: node tools/wintest.js [days=1095] [seeds=30 | 1-30 | 1,2,5] [styles=all | balanced,aggressive] [--keep] [--log N] [--tune T] [--force hive|alliance|conquest|keep|loss]
//   --keep       on a hive victory, keep playing (as the "Keep playing" button) to see whether the coalition wins too
//   --log N      print the last N log lines of the first run of each outcome (to read how it played)
//   --tune T     what-if balance numbers for these runs only (see applyTune), e.g. --tune HIVE.BOSS_DAY=240
//   --force X    a forced scenario (not natural play): checks the path end to end (game state, log line, chronicle
//                caption, the end screen) on seed 1: hive, alliance, conquest, keep (coalition after Keep playing) or loss.
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { createWorld, tickHour, day, alive, hub, killSurvivor, makeSurvivor, newId, snapshot } from "../src/sim/world.js";
import { launchExpedition, outpostName } from "../src/sim/parties.js";
import { finishChronicle } from "../src/sim/chronicle.js";
import { GEAR } from "../src/sim/data.js";
import { setAutopilot, autopilotStats, PERSONALITIES } from "../src/sim/autopilot.js";
import { hiveStats, destroyHive, ensureHives } from "../src/sim/hives.js";
import { goalsProgress, inviteProblem, ensureAlliance, isMember, ALLIANCE, controlledLand, landCentres } from "../src/sim/alliance.js";
import { HIVE } from "../src/sim/hiveconst.js";
import { captureBase, ensureConquest } from "../src/sim/conquest.js";
import { RAIDS } from "../src/sim/factions.js";
import { DEFENCE } from "../src/sim/defences.js";
import { HORDE_SIZES } from "../src/sim/hordes.js";
import { ERAS } from "../src/sim/eras.js";
import { deathCounter } from "./deathcount.js"; // your people's deaths, one per survivor, in buckets

// --tune: try a balance number for this run only (nothing in the game files changes), e.g.
// --tune HIVE.NEW_CAP=3:5,HIVE.BOSS_DAY=240. Tables: HIVE (hiveconst.js), DEFENCE (defences.js), ALLIANCE
// (alliance.js), HORDE_SIZES (hordes.js, e.g. HORDE_SIZES.large.max=150), ERAS (eras.js, e.g. ERAS.WIN_FROM_YEAR=5). a:b is a pair.
const TABLES = { HIVE, DEFENCE, ALLIANCE, HORDE_SIZES, RAIDS, ERAS };
function applyTune(spec) {
  for (const part of (spec || "").split(",").filter(Boolean)) {
    const [path, raw] = part.split("=");
    const keys = path.split(".");
    let obj = TABLES[keys.shift()];
    while (obj && keys.length > 1) obj = obj[keys.shift()];
    if (!obj || !(keys[0] in obj)) throw new Error(`--tune: unknown ${path}`);
    obj[keys[0]] = raw.includes(":") ? raw.split(":").map(Number) : Number(raw);
  }
}

const FACTIONS = 8;

// ---------- one campaign ----------
const EVENT = /Your team took|is no more|has fallen$|moved into|hive was destroyed|hive at .* was destroyed|was destroyed by your team|A new hive has risen|joined The Calder Coalition|left The Calder Coalition|has collapsed|Every hive is destroyed|Calder Coalition holds|holdout has fallen|storming a hive|fell back from the hive|brood drove the team off|\(hive\) to/;
function runOne({ seed, style, days, keep, logN, tune }) {
  applyTune(tune);
  const state = createWorld({ seed, factionCount: FACTIONS });
  state.started = true;
  setAutopilot(state, true, style);
  const samples = [], events = [], deaths = {};
  const newDeaths = deathCounter(state);
  let lastTop = state.log[0], hiveWinDay = null, error = null;
  const sample = () => {
    const gp = goalsProgress(state);
    samples.push({ day: day(state), pop: alive(state).length, hives: gp.hives.left, destroyed: gp.hives.destroyed, building: gp.hives.building,
      members: gp.alliance.members, groups: gp.alliance.groups, land: Math.round(gp.alliance.land.pct * 100) });
  };
  sample();
  try {
    while (day(state) <= days) {
      tickHour(state);
      const fresh = [];
      for (let i = 0; i < state.log.length && state.log[i] !== lastTop; i++) {
        const l = state.log[i];
        fresh.push(l);
        if (EVENT.test(l.text) && (!l.text.startsWith("🤖") || /\(hive\) to/.test(l.text))) events.push({ day: day(state), text: l.text.replace(/^🤖 /, "") }); // the governor's own copy of a line is skipped
        if (!(l.kind === "death" && / died /.test(l.text)) && /walked away|deserted|changed sides/.test(l.text)) deaths.left = (deaths.left || 0) + 1;
      }
      for (const d of newDeaths(fresh)) deaths[d.cause] = (deaths[d.cause] || 0) + 1; // one per survivor (deathcount.js)
      lastTop = state.log[0];
      if (state.hour % (24 * 30) === 0) sample();
      if (state.gameOver) {
        if (keep && state.victory && state.victoryReason === "hives" && !state.victoryKept) {
          // As the victory screen's "Keep playing" (main.js): the world carries on, the coalition can still win.
          hiveWinDay = day(state);
          state.gameOver = false; state.victory = false; state.victoryKept = true;
          continue;
        }
        break;
      }
    }
  } catch (e) { error = e.stack.split("\n").slice(0, 4).join(" | "); }
  sample();
  const gp = goalsProgress(state);
  const outcome = error ? "crash" : state.gameOver ? (state.victory ? (state.victoryReason === "alliance" ? "alliance" : "hives") : "loss") : hiveWinDay != null ? "hives" : "going";
  const outside = state.factions.filter((f) => f.alive && !isMember(state, f)).map((f) => `${f.name}: ${inviteProblem(state, f) || "could join"}`);
  const g = autopilotStats(state);
  const res = {
    seed, style, outcome, day: day(state), hiveWinDay, error, samples, events, deaths,
    end: { pop: alive(state).length, hives: gp.hives.left, destroyed: gp.hives.destroyed, building: gp.hives.building, sites: gp.hives.sites,
      members: gp.alliance.members, groups: gp.alliance.groups, land: Math.round(gp.alliance.land.pct * 1000) / 10, outside, outposts: state.bases.filter((b) => b.type === "outpost").length,
      hiveTrips: events.filter((x) => /\(hive\) to/.test(x.text)).length, built: hiveStats(state).built, reason: state.victoryReason || null, screen: !!(state.gameOver && state.victory),
      blocks: gp.alliance.blocks, // alliance.js: what blocks the coalition's win today (no member, land short)
      conquest: { ...ensureConquest(state).stats },
      // The world's groups: collapsed (all causes), new gangs from the border, raider bands that settled, bases razed
      // (yours / between groups).
      world: { collapsed: state.factions.filter((f) => !f.alive).length, newGangs: state.stats.newGangs || 0, settled: state.stats.bandsSettled || 0,
        razedYours: state.stats.razedYours || 0, razedGroups: state.stats.razedGroups || 0 } },
    log: logN ? state.log.slice(0, logN).reverse().map((l) => `d${Math.floor(l.hour / 24) + 1} ${l.text}`) : null,
  };
  return res;
}

// ---------- forced scenarios (only to check the victory paths end to end, not natural play) ----------
// --force hive: on seed 1 (Balanced autopilot, 30 days in) every hive but the one nearest the hub is removed and
//   no site is under way; six well-armed fighters join the hub and are sent on a real Destroy hive mission to the
//   last one (guard cut to 40). The governor answers the hive card and the battle is played out.
// --force alliance: the same, and before the storm every living group is put in the coalition (pact, goodwill
//   80) and outposts are placed until the coalition holds over half the land.
// --force conquest: every group but two broken by taking its bases (conquest.js captureBase), the two left put in
//   the coalition, outposts placed until over half the land: the coalition's victory with hives still standing.
// --force keep: the hive victory first, "Keep playing" (as main.js), then the coalition set up as above: the
//   coalition victory after a hive victory.
// --force loss: everyone dies.
function forcedOutposts(state) {
  // Outposts (staffed by two new people each) on the land the coalition does not hold yet, the best gain first.
  const g = state.grid;
  let added = 0;
  while (controlledLand(state).pct <= ALLIANCE.LAND_NEEDED && added < 40) {
    const held = new Uint8Array(state.tiles.length);
    for (const c of landCentres(state)) for (const id of g.within(c.tile, c.r)) held[id] = 1;
    let best = null;
    for (const t of state.tiles) {
      if (t.terrain === "water" || t.hive || held[t.id] || state.factions.some((f) => f.bases.includes(t.id))) continue;
      const gain = g.within(t.id, ALLIANCE.CONTROL_RANGE).filter((id) => !held[id] && state.tiles[id].terrain !== "water").length;
      if (!best || gain > best.gain) best = { t, gain };
    }
    if (!best) break;
    const base = { id: newId(), tile: best.t.id, type: "outpost", name: outpostName(state, best.t.id),
      stock: { food: 60, water: 40, fuel: 0, meds: 2, ammo: 20, parts: 0, scrap: 10, preserved: 0, jars: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
    state.bases.push(base);
    for (let i = 0; i < 2; i++) { const p = makeSurvivor(state, 0.9); p.location = { kind: "base", baseId: base.id }; p.role = "farm"; state.survivors.push(p); }
    added++;
  }
  return added;
}
function forcedCoalition(state) {
  const A = ensureAlliance(state);
  for (const f of state.factions) if (f.alive) { f.known = true; f.pact = "trade"; f.goodwill = 80; if (!A.members.includes(f.id)) A.members.push(f.id); }
  if (A.founded == null) A.founded = day(state);
  return forcedOutposts(state);
}
function forcedStorm(state) {
  ensureHives(state);
  const h = hub(state);
  state.hiveSites.length = 0; // no new hive under way
  const last = [...state.hives].sort((a, b) => state.grid.distance(a.tile, h.tile) - state.grid.distance(b.tile, h.tile))[0];
  for (const hv of [...state.hives]) if (hv !== last) destroyHive(state, hv, "(forced by the test)");
  for (const hd of state.hordes) if (hd.hive === last.id && hd.role === "guard") hd.size = Math.min(hd.size, 40);
  state.knowledge[last.tile] = snapshot(state, last.tile);
  const squad = [];
  for (let i = 0; i < 6; i++) {
    const p = makeSurvivor(state, 1);
    p.traits = []; p.skills.shooting = 10; p.health = 100;
    p.gear.weapon = { key: "shotgun", name: GEAR.shotgun.name, quality: 1 };
    p.gear.armor = { key: "vest", name: GEAR.vest.name, quality: 1 };
    p.location = { kind: "base", baseId: h.id };
    state.survivors.push(p);
    squad.push(p);
  }
  h.stock.ammo = Math.max(h.stock.ammo || 0, 200); h.stock.food = Math.max(h.stock.food || 0, 100); h.stock.water = Math.max(h.stock.water || 0, 80);
  const res = launchExpedition(state, { memberIds: squad.map((p) => p.id), dest: last.tile, mission: "hive", stance: "normal", supplies: { food: 30, water: 30, ammo: 150, meds: 4 } });
  if (res.error) throw new Error(`forced storm: ${res.error}`);
  return last;
}
async function forceScenario(kind) {
  const state = createWorld({ seed: 1, factionCount: FACTIONS });
  state.started = true;
  state.erasOff = true; // the eras' clocks (eras.js: no victory before year 6, the Accord, the containment) are skipped here: this checks the path, not the pacing (tools/eratest.js checks those)
  setAutopilot(state, true, "balanced");
  while (day(state) < 30 && !state.gameOver) tickHour(state);
  const notes = [];
  let keptAt = null;
  if (kind === "loss") {
    for (const p of alive(state)) killSurvivor(state, p, null, "in a forced test");
  } else {
    if (kind === "alliance" || kind === "conquest") {
      // The coalition is its own victory now: no hive needs to fall.
      if (kind === "conquest") {
        let broken = 0;
        for (const f of state.factions.filter((x) => x.alive).slice(2)) { for (const t of [...f.bases]) if (f.alive) captureBase(state, f, t, null, {}); broken++; }
        notes.push(`${broken} groups broken by taking their bases (${state.bases.filter((b) => b.captured).length} captured bases)`);
      }
      notes.push(`${forcedCoalition(state)} outposts placed, every group left in the coalition; ${(state.hives || []).length} hives still stand`);
      for (let i = 0; i < 48 && !state.gameOver; i++) tickHour(state);
    } else {
      const last = forcedStorm(state);
      notes.push(`last hive: ${last.name}, ${state.grid.distance(last.tile, hub(state).tile)} tiles from the hub`);
      while (!state.gameOver && day(state) < 75) tickHour(state);
    }
    if (kind === "keep" && state.gameOver && state.victory) {
      keptAt = { day: day(state), reason: state.victoryReason };
      state.victoryKept = true; state.gameOver = false; // the victory screen's "Keep playing" (main.js)
      notes.push(`${forcedCoalition(state)} outposts placed after Keep playing, every group in the coalition`);
      for (let i = 0; i < 48 && !state.gameOver; i++) tickHour(state);
    }
  }
  for (let i = 0; i < 2 && !state.gameOver; i++) tickHour(state);
  const c = finishChronicle(state); // as the timelapse does when it opens
  const gp = goalsProgress(state);
  let screen = null;
  try {
    const ui = await import("../src/ui/ui.js");
    const html = ui.renderModal(state, { started: true });
    screen = html ? (/<h1>([^<]*)<\/h1>/.exec(html) || [null, html.slice(0, 80)])[1] : "(no window)";
  } catch (e) { screen = `(not rendered headless: ${e.message.split("\n")[0]})`; }
  return {
    kind, day: day(state), gameOver: !!state.gameOver, victory: !!state.victory, reason: state.victoryReason || null, keptAt, notes,
    logLine: (state.log.find((l) => /^(Every hive is destroyed|The Calder Coalition holds|Every survivor is dead)/.test(l.text)) || {}).text || null,
    caption: c ? (c.events.filter((e) => e.major && /won on day|has fallen on day|Calder Coalition holds/.test(e.text)).slice(-1)[0] || {}).text || null : null,
    land: Math.round(gp.alliance.land.pct * 1000) / 10, members: gp.alliance.members, groups: gp.alliance.groups, hives: gp.hives.left, screen,
  };
}

if (!isMainThread) {
  parentPort.on("message", (job) => {
    if (job === "done") return process.exit(0);
    parentPort.postMessage(runOne(job));
  });
} else await main();

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const keep = args.includes("--keep");
  if (keep) args.splice(args.indexOf("--keep"), 1);
  const logN = Number(flag("--log") || 0);
  const force = flag("--force");
  const tune = flag("--tune");
  if (force) return runForced(force);
  const days = Number(args[0] || 1095);
  const seedArg = args[1] || "30";
  const seeds = /^\d+$/.test(seedArg) ? Array.from({ length: Number(seedArg) }, (_, i) => i + 1)
    : seedArg.includes("-") ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(seedArg.split("-").map(Number)) : seedArg.split(",").map(Number);
  const styles = !args[2] || args[2] === "all" ? Object.keys(PERSONALITIES) : args[2].split(",");
  if (styles.some((s) => !PERSONALITIES[s])) { console.log(`Unknown style. Use ${Object.keys(PERSONALITIES).join(", ")} or all.`); process.exit(1); }

  const jobs = [];
  for (const style of styles) for (const seed of seeds) jobs.push({ seed, style, days, keep, logN, tune });
  if (tune) console.log(`TUNED (this run only, not the game's numbers): ${tune}`);
  const t0 = Date.now();
  const results = await pool(jobs);
  const ms = Date.now() - t0;

  const pad = (v, n) => String(v).padEnd(n);
  const tl = (r) => r.samples.filter((s, i) => i % 3 === 0 || i === r.samples.length - 1)
    .map((s) => `d${s.day} pop ${s.pop} hives ${s.hives}${s.building ? `+${s.building}b` : ""} (−${s.destroyed}) coal ${s.members}/${s.groups} land ${s.land}%`).join(" · ");
  for (const style of styles) {
    const list = results.filter((r) => r.style === style).sort((a, b) => a.seed - b.seed);
    console.log(`\n=== ${PERSONALITIES[style].name}: ${list.length} seeds, up to ${days} days ===`);
    for (const r of list) {
      const mark = { hives: "HIVE WIN", alliance: "COALITION WIN", loss: "fell", going: "going", crash: "CRASH" }[r.outcome];
      const e = r.end;
      console.log(`seed ${pad(r.seed, 3)} ${pad(mark, 13)} day ${pad(r.outcome === "hives" && r.hiveWinDay != null ? r.hiveWinDay : r.day, 5)}${r.hiveWinDay != null && r.outcome !== "hives" ? `(hives d${r.hiveWinDay}) ` : ""}pop ${pad(e.pop, 3)} hives left ${pad(e.hives, 2)} destroyed ${pad(e.destroyed, 2)} new ${pad(e.built, 2)} building ${e.building} | ` +
        `coalition ${e.members}/${e.groups} land ${e.land}% outposts ${e.outposts} hive trips ${e.hiveTrips}`);
      if (r.error) console.log(`         ${r.error}`);
      if (r.outcome === "hives" || r.outcome === "alliance") {
        console.log(`         ${tl(r)}`);
        const hv = r.events.filter((x) => /was destroyed/.test(x.text)).map((x) => `d${x.day}`);
        const jn = r.events.filter((x) => /joined/.test(x.text)).map((x) => `d${x.day}`);
        console.log(`         hives destroyed on ${hv.join(", ") || "-"}; members joined on ${jn.join(", ") || "-"}`);
      }
    }
    const n = (o) => list.filter((r) => r.outcome === o).length;
    const winDay = (r) => (r.outcome === "hives" && r.hiveWinDay != null ? r.hiveWinDay : r.day); // --keep: the day the hives fell
    const avgDay = (o) => { const l = list.filter((r) => r.outcome === o); return l.length ? Math.round(l.reduce((a, r) => a + winDay(r), 0) / l.length) : "-"; };
    const going = list.filter((r) => r.outcome === "going");
    console.log(`--- ${PERSONALITIES[style].name}: hive win ${n("hives")} (avg day ${avgDay("hives")}), coalition win ${n("alliance")} (avg day ${avgDay("alliance")}), fell ${n("loss")} (avg day ${avgDay("loss")}), going ${n("going")}${n("crash") ? `, CRASH ${n("crash")}` : ""}`);
    if (going.length) {
      const av = (f) => (going.reduce((a, r) => a + f(r), 0) / going.length).toFixed(1);
      console.log(`    still going: hives left ${av((r) => r.end.hives)}, destroyed ${av((r) => r.end.destroyed)}, new hives built ${av((r) => r.end.built)}, hive trips ${av((r) => r.end.hiveTrips)}, ` +
        `members ${av((r) => r.end.members)} of ${av((r) => r.end.groups)} groups, land ${av((r) => r.end.land)}%, outposts ${av((r) => r.end.outposts)}, pop ${av((r) => r.end.pop)}`);
      const why = {};
      for (const r of going) for (const o of r.end.outside) { const k = o.replace(/^[^:]*: /, "").replace(/\d+/g, "#").replace(/\b[A-Z][\w']+( [A-Z][\w']+)*\b/g, "X"); why[k] = (why[k] || 0) + 1; }
      const top = Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 6);
      if (top.length) console.log(`    groups outside the coalition, why: ${top.map(([k, v]) => `${v}× "${k}"`).join("; ")}`);
      const bl = {};
      for (const r of going) for (const b of r.end.blocks || []) { const k = b.replace(/\d+/g, "#"); bl[k] = (bl[k] || 0) + 1; }
      if (Object.keys(bl).length) console.log(`    what blocks the coalition's win: ${Object.entries(bl).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}× ${k}`).join("; ")}`);
    }
    const cq = (k) => (list.reduce((a, r) => a + ((r.end && r.end.conquest && r.end.conquest[k]) || 0), 0) / Math.max(1, list.length)).toFixed(1);
    const lostRuns = list.filter((r) => r.end && r.end.conquest && r.end.conquest.basesLost > 0).length;
    const hubRuns = list.filter((r) => r.end && r.end.conquest && r.end.conquest.hubsLost > 0).length;
    console.log(`    conquest per run: ${cq("assaults")} assaults, ${cq("taken")} bases taken (${cq("retaken")} of them yours back), ${cq("defeated")} groups broken; ` +
      `lost to raids: ${cq("basesLost")} bases (in ${lostRuns} of ${list.length} runs), the hub in ${hubRuns} runs, ${cq("retreats")} retreats, ${cq("exiles")} times with no base left`);
    const wq = (k) => (list.reduce((a, r) => a + ((r.end && r.end.world && r.end.world[k]) || 0), 0) / Math.max(1, list.length)).toFixed(1);
    console.log(`    world per run: ${wq("collapsed")} groups collapsed, ${wq("newGangs")} new gangs, ${wq("settled")} raider bands settled, bases razed: ${wq("razedYours")} yours, ${wq("razedGroups")} between groups`);
    const dt = {};
    for (const r of list) for (const [k, v] of Object.entries(r.deaths || {})) dt[k] = (dt[k] || 0) + v;
    console.log(`    deaths per run by cause: ${Object.entries(dt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / list.length).toFixed(1)}`).join(", ")}`);
    if (logN) for (const o of ["hives", "alliance", "loss"]) {
      const r = list.find((x) => x.outcome === o);
      if (!r) continue;
      console.log(`\n    --- seed ${r.seed} (${o}) key events ---`);
      for (const e of r.events) console.log(`    d${e.day} ${e.text}`);
      console.log(`    --- last ${logN} log lines ---`);
      for (const l of r.log) console.log(`    ${l}`);
    }
  }
  const crashes = results.filter((r) => r.outcome === "crash").length;
  console.log(`\n${results.length} runs in ${(ms / 1000).toFixed(1)} s${crashes ? `, ${crashes} CRASHED` : ""}.`);
  process.exit(crashes ? 1 : 0);
}

function pool(jobs) {
  return new Promise((resolve) => {
    const out = [];
    const n = Math.max(1, Math.min(jobs.length, cpus().length - 1, 12));
    let next = 0, live = n;
    for (let i = 0; i < n; i++) {
      const w = new Worker(fileURLToPath(import.meta.url));
      const feed = () => { if (next < jobs.length) w.postMessage(jobs[next++]); else { w.postMessage("done"); if (--live === 0) resolve(out); } };
      w.on("message", (r) => { out.push(r); process.stdout.write("."); feed(); });
      w.on("error", (e) => { console.log(`\nworker error: ${e.stack}`); out.push({ outcome: "crash", error: String(e), samples: [], events: [], end: {} }); feed(); });
      feed();
    }
  });
}

async function runForced(kind) {
  console.log(`FORCED scenario "${kind}" (not natural play: the setup is rigged to check the path end to end)`);
  const r = await forceScenario(kind);
  for (const n of r.notes) console.log(`  setup: ${n}`);
  if (r.keptAt) console.log(`  first: ${r.keptAt.reason} victory on day ${r.keptAt.day}, then Keep playing`);
  console.log(`  day ${r.day}: game over ${r.gameOver}, victory ${r.victory}, reason ${r.reason}; hives left ${r.hives}; coalition ${r.members}/${r.groups}, land ${r.land}%`);
  console.log(`  log:     ${r.logLine}`);
  console.log(`  caption: ${r.caption}`);
  console.log(`  screen:  ${r.screen}`);
  const want = { hive: ["hives", true], alliance: ["alliance", true], conquest: ["alliance", true], keep: ["alliance", true], loss: [null, false] }[kind];
  const ok = want && r.gameOver && r.victory === want[1] && r.reason === want[0] && !!r.logLine && !!r.caption;
  console.log(ok ? "  ok" : "  FAIL: the run did not end the way this scenario should");
  process.exit(ok ? 0 : 1);
}
